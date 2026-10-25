#pragma once

// TV credentials never create a staff session and are valid only for TV reads.
J tvRows(DB& db, int roomId = 0, int psychologistId = 0) {
    auto stamp = now(), day = stamp.substr(0, 10);
    J args = {epoch() - 120, day + "T00:00", day + "T24:00", stamp.substr(0, 16)};
    std::string sql =
        "SELECT a.id appointment_id,p.id patient_id,p.name patient,u.name psychologist,"
        "r.name room,a.start,a.\"end\",t.arrived_at,t.started_at,COALESCE(tc.called_at,0) called_at "
        "FROM appointments a JOIN attendees t ON t.appointment_id=a.id "
        "JOIN patients p ON p.id=t.patient_id JOIN users u ON u.id=a.psychologist_id "
        "JOIN rooms r ON r.id=a.room_id LEFT JOIN tv_calls tc ON tc.appointment_id=a.id "
        "AND tc.patient_id=p.id AND tc.called_at>=? "
        "WHERE a.start>=? AND a.start<? AND a.status IN ('scheduled','confirmed') "
        "AND t.visit_status='' AND (a.\"end\">=? OR t.arrived_at<>'') "
        "AND NOT EXISTS(SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=p.id)";
    if (roomId) { sql += " AND a.room_id=?"; args.push_back(roomId); }
    if (psychologistId) { sql += " AND a.psychologist_id=?"; args.push_back(psychologistId); }
    return db.query(sql + " ORDER BY a.start,a.id,p.name LIMIT 500", args);
}

std::string tvShortName(const std::string& name) {
    std::istringstream input(name); std::string surname, part;
    input >> surname;
    while (input >> part) {
        auto first = static_cast<unsigned char>(part[0]);
        size_t bytes = first < 0x80 ? 1 : first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
        surname += " " + part.substr(0, bytes) + ".";
    }
    return surname;
}

J tvPublic(DB& db, const httplib::Request& r) {
    check(r.method == "GET", "Метод не дозволений", 405);
    auto bearer = r.get_header_value("Authorization");
    check(bearer.rfind("Bearer ", 0) == 0 && bearer.size() == 71, "Підключіть телевізор", 401);
    auto key = digest(bearer.substr(7));
    auto devices = db.query("SELECT id,name,enabled,room_id,message,page_seconds,show_full_names FROM tv_displays WHERE token_hash=?", {key});
    if (devices.empty()) {
        if (r.path == "/api/tv/pairing") {
            auto pending = db.query("SELECT expires FROM tv_pairings WHERE token_hash=? AND expires>?", {key, epoch()});
            check(!pending.empty(), "Код підключення прострочений або доступ відкликано", 401);
            return {{"paired", false}};
        }
        throw Error(401, "Підключіть телевізор");
    }
    auto device = devices[0]; check(device["enabled"].get<bool>(), "Доступ до табло призупинено", 403);
    if (r.path == "/api/tv/pairing") return {{"paired", true}};
    check(r.path == "/api/tv/schedule", "Не знайдено", 404);
    db.query("UPDATE tv_displays SET last_seen=? WHERE id=?", {now(), device["id"]});
    auto entries = tvRows(db, device["room_id"].is_null() ? 0 : device["room_id"].get<int>());
    for (auto& entry : entries) {
        entry["state"] = entry["started_at"] != "" ? "in_progress" : entry["called_at"].get<long long>() > 0 ? "called" : entry["arrived_at"] != "" ? "waiting" : "scheduled";
        if (!device["show_full_names"].get<bool>()) entry["patient"] = tvShortName(entry["patient"].get<std::string>());
        entry.erase("arrived_at"); entry.erase("started_at");
    }
    auto settings = db.query("SELECT center_name FROM center_settings WHERE id=1");
    return {{"server_time", now()}, {"server_epoch", epoch()}, {"date", now().substr(0, 10)},
            {"center", settings.empty() ? "SOLVIA" : settings[0]["center_name"].get<std::string>()},
            {"display_name", device["name"]}, {"message", device["message"]},
            {"page_seconds", device["page_seconds"]}, {"entries", entries}};
}

J tvAdmin(DB& db, const J& u, const httplib::Request& r, const J& b) {
    auto path = r.path, method = r.method;
    if (path == "/api/tv/candidates" || path == "/api/tv/call") {
        allow(u, {"admin", "reception", "psychologist"});
        if (path == "/api/tv/candidates") {
            check(method == "GET", "Метод не дозволений", 405);
            return tvRows(db, 0, u["role"] == "psychologist" ? u["id"].get<int>() : 0);
        }
        check(method == "POST" || method == "DELETE", "Метод не дозволений", 405);
        auto aid = num(b, "appointment_id"), pid = num(b, "patient_id");
        auto rows = db.query("SELECT a.psychologist_id,a.start,a.status,t.started_at,t.arrived_at,t.visit_status FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE a.id=? AND t.patient_id=?", {aid, pid});
        check(!rows.empty(), "Запис не знайдено", 404); auto a = rows[0];
        check(u["role"] != "psychologist" || a["psychologist_id"] == u["id"], "Це запис іншого психолога", 403);
        if (method == "DELETE") { db.query("DELETE FROM tv_calls WHERE appointment_id=? AND patient_id=?", {aid, pid}); return {{"ok", true}}; }
        check(a["start"].get<std::string>().substr(0, 10) == now().substr(0, 10) && (a["status"] == "scheduled" || a["status"] == "confirmed") && a["visit_status"] == "" && a["started_at"] == "", "Цей запис недоступний для виклику", 409);
        check(a["arrived_at"] != "", "Спочатку відмітьте прибуття пацієнта", 409);
        check(db.query("SELECT id FROM consultations WHERE appointment_id=? AND patient_id=?", {aid, pid}).empty(), "Консультацію завершено", 409);
        db.query("INSERT INTO tv_calls(appointment_id,patient_id,called_at,called_by) VALUES(?,?,?,?) ON CONFLICT(appointment_id,patient_id) DO UPDATE SET called_at=EXCLUDED.called_at,called_by=EXCLUDED.called_by", {aid, pid, epoch(), u["id"]});
        audit(db, u, "tv_call", "appointment", aid);workflowEvent(db,u,"patient.called",aid,pid); return {{"ok", true}};
    }
    allow(u, {"admin"});
    const std::string fields = "id,name,enabled,room_id,message,page_seconds,show_full_names,last_seen,created";
    if (path == "/api/admin/tv-displays" && method == "GET") return db.query("SELECT " + fields + " FROM tv_displays ORDER BY id");
    std::smatch match; int id = 0;
    if (std::regex_match(path, match, std::regex("/api/admin/tv-displays/([0-9]+)"))) {
        id = std::stoi(match[1]);
        check(!db.query("SELECT id FROM tv_displays WHERE id=?", {id}).empty(), "Табло не знайдено", 404);
        if (method == "DELETE") { db.query("DELETE FROM tv_displays WHERE id=?", {id}); audit(db,u,"revoke","tv_display",id); return {{"ok",true}}; }
        check(method == "PATCH", "Метод не дозволений", 405);
    } else check(path == "/api/admin/tv-displays" && method == "POST", "Метод не дозволений", 405);
    auto name = str(b,"name",120), message = str(b,"message",1000,false);
    int seconds = num(b,"page_seconds"), room = num(b,"room_id");
    check(seconds >= 6 && seconds <= 60 && room >= 0, "Час сторінки: 6–60 секунд; оберіть кабінет");
    if (room) check(!db.query("SELECT id FROM rooms WHERE id=? AND active=TRUE", {room}).empty(), "Кабінет недоступний");
    check(b.contains("show_full_names") && b["show_full_names"].is_boolean() && b.contains("enabled") && b["enabled"].is_boolean(), "Оберіть формат імен та стан табло");
    J roomValue = room ? J(room) : J(nullptr);
    if (!id) {
        auto code = str(b,"code",6);check(std::regex_match(code,std::regex("[0-9]{6}")),"Введіть 6 цифр із телевізора");
        auto pending = db.query("SELECT token_hash FROM tv_pairings WHERE code=? AND expires>? FOR UPDATE", {code, epoch()});
        check(!pending.empty(),"Код прострочений або вже використаний",409);
        id = db.query("INSERT INTO tv_displays(name,token_hash,enabled,room_id,message,page_seconds,show_full_names,created,last_seen) VALUES(?,?,?,?,?,?,?,?,'') RETURNING id", {name,pending[0]["token_hash"],b["enabled"],roomValue,message,seconds,b["show_full_names"],now()})[0]["id"].get<int>();
        db.query("DELETE FROM tv_pairings WHERE code=?", {code});audit(db,u,"pair","tv_display",id);
    } else {
        db.query("UPDATE tv_displays SET name=?,enabled=?,room_id=?,message=?,page_seconds=?,show_full_names=? WHERE id=?", {name,b["enabled"],roomValue,message,seconds,b["show_full_names"],id});audit(db,u,"update","tv_display",id);
    }
    return db.query("SELECT " + fields + " FROM tv_displays WHERE id=?", {id})[0];
}
