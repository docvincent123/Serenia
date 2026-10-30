#pragma once
// Registration-only visit history. Clinical notes and other group attendees
// are deliberately excluded from this projection.
J patientVisits(DB&db,const J&u,const httplib::Request&r,int patientId){
    getPatient(db,u,patientId);
    auto period=r.has_param("period")?r.get_param_value("period"):"upcoming";
    check(period=="upcoming"||period=="history","Оберіть період прийомів",400);
    int page=1;
    if(r.has_param("page")){
        const auto value=r.get_param_value("page");
        check(!value.empty()&&value.size()<=6&&value.find_first_not_of("0123456789")==std::string::npos,"Некоректна сторінка",400);
        page=std::stoi(value);check(page>=1&&page<=100000,"Некоректна сторінка",400);
    }
    std::string source=" FROM appointments a JOIN attendees t ON t.appointment_id=a.id JOIN users u ON u.id=a.psychologist_id JOIN rooms r ON r.id=a.room_id LEFT JOIN consultations c ON c.appointment_id=a.id AND c.patient_id=t.patient_id WHERE t.patient_id=?";
    J args={patientId};
    if(u["role"]=="psychologist"){source+=" AND a.psychologist_id=?";args.push_back(u["id"]);}
    source+=" AND ";
    if(period=="history")source+="NOT ";
    source+="(a.\"end\">=? AND a.status IN ('scheduled','confirmed') AND t.visit_status='' AND c.id IS NULL)";
    args.push_back(now().substr(0,16));
    auto total=db.query("SELECT count(*) total"+source,args)[0]["total"];
    args.push_back(10);args.push_back((page-1)*10);
    auto items=db.query("SELECT a.id,a.start,a.\"end\",a.status,a.kind,u.name psychologist,r.name room,t.arrived_at,t.started_at,t.visit_status,COALESCE(c.created,'') completed_at,"
        "(a.status IN ('scheduled','confirmed') AND NOT EXISTS(SELECT 1 FROM consultations all_c WHERE all_c.appointment_id=a.id)) can_reschedule"+
        source+" ORDER BY a.start "+(period=="upcoming"?"ASC":"DESC")+",a.id LIMIT ? OFFSET ?",args);
    return {{"items",items},{"total",total},{"page",page},{"page_size",10}};
}
