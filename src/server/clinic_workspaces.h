// These routes share the normal authorization, licensing and audit checks.
std::string approvedDesktopHash(const J& fields, const std::string& role, const std::string& current = {}) {
    if (role != "psychologist") return "";
    if (fields.contains("allow_desktop")) {
        check(fields["allow_desktop"].is_boolean(), "Некоректний дозвіл ПК");
        if (!fields["allow_desktop"].get<bool>()) return "";
    }
    auto code = str(fields, "desktop_code", 32, false);
    if (code.empty()) {
        check(!fields.value("allow_desktop", false) || !current.empty(), "Введіть код робочого ПК");
        return current;
    }
    check(std::regex_match(code, std::regex("[a-f0-9]{32}")), "Код ПК має містити 32 символи");
    return digest(code);
}

bool shiftArchivePermission(const J& fields, const std::string& role, bool current = false) {
    if (role != "director") return false;
    check(!fields.contains("shift_archive_access") || fields["shift_archive_access"].is_boolean(),
          "Некоректний дозвіл архіву зміни");
    return fields.value("shift_archive_access", current);
}

J clinicalShiftArchive(DB& db, const J& user, const httplib::Request& request) {
    allow(user, {"admin", "director", "psychologist"});
    if (user["role"] == "director")
        check(!db.query("SELECT id FROM users WHERE id=? AND shift_archive_access", {user["id"]}).empty(),
              "Адміністратор має надати доступ до архіву зміни", 403);
    auto shift = db.query("SELECT shift_date FROM shift_days ORDER BY (closed_at IS NULL) DESC,shift_date DESC LIMIT 1");
    auto day = request.has_param("date") ? request.get_param_value("date")
        : shift.empty() ? now().substr(0, 10) : shift[0]["shift_date"].get<std::string>();
    validDate(day);
    J params = {day, day};
    std::string owner;
    if (user["role"] == "psychologist") {
        owner = " AND c.psychologist_id=?";
        params.push_back(user["id"]);
    }
    auto visits = db.query(
        "SELECT c.id,c.patient_id,p.patient_no,p.name patient,u.name psychologist,a.start,c.created "
        "FROM consultations c JOIN patients p ON p.id=c.patient_id "
        "JOIN users u ON u.id=c.psychologist_id JOIN appointments a ON a.id=c.appointment_id "
        "WHERE (c.shift_date=? OR (c.shift_date='' AND LEFT(a.start,10)=?))" + owner +
        " ORDER BY a.start DESC,c.id DESC LIMIT 1001", params);
    const bool truncated = visits.size() > 1000;
    if (truncated) visits.erase(visits.end() - 1);
    audit(db, user, "view", "shift_archive", 0);
    return {{"shift_date",day},{"items",visits},{"truncated",truncated}};
}

J patientRequestResult(const J& row) {
    auto result = J::parse(row["snapshot"].get<std::string>());
    std::ostringstream number;
    number << "LC-ZV-" << row["created"].get<std::string>().substr(0, 4) << "-" << std::setfill('0')
           << std::setw(6) << row["id"].get<long long>();
    result["id"] = row["id"];
    result["number"] = number.str();
    result["created"] = row["created"];
    return result;
}

J patientRequests(DB& db, const J& user, const std::string& method, int patientId, const J& fields) {
    const auto patient = getPatient(db, user, patientId);
    if (method == "GET") {
        J result = J::array();
        for (const auto& row : db.query(
            "SELECT id,snapshot,created FROM patient_requests WHERE patient_id=? ORDER BY id DESC LIMIT 100", {patientId}))
            result.push_back(patientRequestResult(row));
        return result;
    }
    allow(user, {"admin", "reception"});
    check(method == "POST", "Метод не дозволений", 405);
    auto service = str(fields, "service_code", 80);
    auto clientKey = str(fields, "client_key", 80);
    check(std::regex_match(clientKey, std::regex("[a-zA-Z0-9-]{16,80}")), "Некоректний ключ заяви");
    const auto existing = db.query(
        "SELECT id,service_code,snapshot,created FROM patient_requests WHERE patient_id=? AND created_by=? AND client_key=?",
        {patientId,user["id"],clientKey});
    if (!existing.empty()) {
        check(existing[0]["service_code"].get<std::string>() == service, "Ця заява вже має інший напрямок", 409);
        return patientRequestResult(existing[0]);
    }
    const auto services = db.query("SELECT name FROM center_services WHERE code=? AND active", {service});
    check(!services.empty(), "Оберіть активний напрямок центру", 422);
    const auto center = db.query("SELECT center_name,department_name,address,phone FROM center_settings WHERE id=1")[0];
    J snapshot = {{"template_version",1},{"patient_no",patient["patient_no"]},{"patient_name",patient["name"]},
        {"dob",patient["dob"]},{"service",services[0]["name"]},{"center",center}};
    const auto row = db.query(
        "INSERT INTO patient_requests(patient_id,created_by,client_key,service_code,snapshot,created) "
        "VALUES(?,?,?,?,?,?) RETURNING id,snapshot,created",
        {patientId,user["id"],clientKey,service,snapshot.dump(),now()})[0];
    audit(db, user, "create", "patient_request", row["id"].get<int>());
    return patientRequestResult(row);
}
