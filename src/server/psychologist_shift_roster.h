#pragma once
// Live operational overview of psychological staff. No patient names or clinical notes.
// A roster is an administrative shift assignment, not a claim that Android is online.
J psychologistShiftRoster(DB&db,const J&u,const httplib::Request&r,const J&b){
    allow(u,{"admin","reception","director"});
    const auto active=db.query("SELECT shift_date,psychologist_roster_enabled FROM shift_days WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1");
    const std::string day=r.has_param("date")?r.get_param_value("date"):(active.empty()?now().substr(0,10):active[0]["shift_date"].get<std::string>());
    validDate(day);
    const auto activeRows=db.query("SELECT psychologist_roster_enabled FROM shift_days WHERE shift_date=? AND closed_at IS NULL",{day});
    if(r.method=="POST"){
        allow(u,{"admin"});
        check(!activeRows.empty(),"Спочатку відкрийте робочу зміну",409);
        const int id=num(b,"psychologist_id");
        check(b.contains("on_shift")&&b["on_shift"].is_boolean(),"Вкажіть присутність психолога",400);
        const bool assign=b["on_shift"].get<bool>();
        check(!db.query("SELECT id FROM users WHERE id=? AND role='psychologist' AND active=TRUE",{id}).empty(),"Оберіть активного психолога",400);
        if(!assign){
            // Do not silently abandon arrived/in-progress or future booked patients today.
            const auto unfinished=db.query("SELECT count(*) n FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE a.psychologist_id=? AND substr(a.start,1,10)=? AND a.status IN ('scheduled','confirmed') AND t.visit_status='' AND NOT EXISTS(SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)",{id,day});
            check(unfinished[0]["n"].get<long long>()==0,"Є незавершені прийоми. Спочатку передайте або завершіть їх",409);
        }
        db.query("UPDATE shift_days SET psychologist_roster_enabled=TRUE WHERE shift_date=?",{day});
        if(assign){
            db.query("INSERT INTO psychologist_shift_roster(shift_date,psychologist_id,assigned_by,assigned_at,removed_at) VALUES(?,?,?,?,?) ON CONFLICT(shift_date,psychologist_id) DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=EXCLUDED.assigned_at,removed_at=''",{day,id,u["id"],now(),""});
        }else{
            db.query("UPDATE psychologist_shift_roster SET removed_at=? WHERE shift_date=? AND psychologist_id=? AND removed_at=''",{now(),day,id});
        }
        audit(db,u,assign?"assign_shift":"remove_shift","psychologist",id);
        return {{"ok",true},{"date",day},{"on_shift",assign}};
    }
    check(r.method=="GET","Метод не дозволений",405);
    const bool configured=!activeRows.empty()&&activeRows[0]["psychologist_roster_enabled"].get<bool>();
    J items=db.query("SELECT u.id,u.name,(p.psychologist_id IS NOT NULL AND p.removed_at='') on_shift FROM users u LEFT JOIN psychologist_shift_roster p ON p.psychologist_id=u.id AND p.shift_date=? WHERE u.role='psychologist' AND u.active=TRUE ORDER BY u.name",{day});
    for(auto &person:items){
        const int id=person["id"].get<int>();
        person["status"]="off_shift";
        person["busy_count"]=0;person["waiting_count"]=0;person["upcoming_count"]=0;
        person["next_at"]="";person["room"]="";person["connected"]=false;
        if(!person["on_shift"].get<bool>())continue;
        const auto stats=db.query(
            "SELECT count(*) FILTER (WHERE t.started_at<>'' AND c.patient_id IS NULL) AS busy,"
            "count(*) FILTER (WHERE t.arrived_at<>'' AND t.started_at='' AND c.patient_id IS NULL) AS waiting,"
            "count(*) FILTER (WHERE a.start>? AND t.started_at='' AND c.patient_id IS NULL) AS upcoming "
            "FROM appointments a JOIN attendees t ON t.appointment_id=a.id "
            "LEFT JOIN consultations c ON c.appointment_id=a.id AND c.patient_id=t.patient_id "
            "WHERE a.psychologist_id=? AND substr(a.start,1,10)=? AND a.status IN ('scheduled','confirmed') AND t.visit_status=''",
            {now().substr(0,16),id,day});
        if(!stats.empty()){
            person["busy_count"]=stats[0]["busy"];
            person["waiting_count"]=stats[0]["waiting"];
            person["upcoming_count"]=stats[0]["upcoming"];
        }
        const auto upcoming=db.query("SELECT min(start) next_at FROM appointments WHERE psychologist_id=? AND substr(start,1,10)=? AND start>? AND status IN ('scheduled','confirmed')",{id,day,now().substr(0,16)});
        if(!upcoming.empty()&&!upcoming[0]["next_at"].is_null())person["next_at"]=upcoming[0]["next_at"];
        const auto room=db.query("SELECT r.name FROM appointments a JOIN rooms r ON r.id=a.room_id JOIN attendees t ON t.appointment_id=a.id LEFT JOIN consultations c ON c.appointment_id=a.id AND c.patient_id=t.patient_id WHERE a.psychologist_id=? AND substr(a.start,1,10)=? AND a.status IN ('scheduled','confirmed') AND t.started_at<>'' AND t.visit_status='' AND c.patient_id IS NULL ORDER BY t.started_at DESC LIMIT 1",{id,day});
        if(!room.empty())person["room"]=room[0]["name"];
        const auto connection=db.query("SELECT count(*) n FROM mobile_devices WHERE user_id=? AND last_seen_epoch>=?",{id,epoch()-120});
        person["connected"]=!connection.empty()&&connection[0]["n"].get<long long>()>0;
        if(person["busy_count"].get<long long>()>0)person["status"]="busy";
        else if(person["waiting_count"].get<long long>()>0)person["status"]="waiting";
        else person["status"]="available";
    }
    return {{"date",day},{"shift_open",!activeRows.empty()},{"configured",configured},{"server_time",now()},{"psychologists",items}};
}
