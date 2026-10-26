#pragma once

// Transactional, operational events only. Never copy clinical text into this feed.
void workflowEvent(DB&db,const J&actor,const std::string&kind,int appointment,int patient=0){
    auto rows=db.query("SELECT a.psychologist_id,a.start,r.name room FROM appointments a JOIN rooms r ON r.id=a.room_id WHERE a.id=?",{appointment});
    if(rows.empty())return;
    J payload={{"appointment_id",appointment},{"patient_id",patient},{"psychologist_id",rows[0]["psychologist_id"]},{"start",rows[0]["start"]},{"room",rows[0]["room"]},{"actor_id",actor["id"]},{"actor",actor.value("name","")}};
    db.query("INSERT INTO outbox(event,payload,created) VALUES(?,?,?)",{"workflow."+kind,payload.dump(),now()});
}
J workflowEvents(DB&db,const J&u,const httplib::Request&r){
    allow(u,{"admin","reception","psychologist","director"});check(r.method=="GET","Метод не дозволений",405);
    auto maximum=db.query("SELECT coalesce(max(id),0) cursor FROM outbox WHERE event LIKE 'workflow.%'")[0]["cursor"].get<long long>();
    long long after=0;bool initial=!r.has_param("after");
    if(!initial){auto input=r.get_param_value("after");check(std::regex_match(input,std::regex("[0-9]{1,18}")),"Некоректний курсор подій");after=std::stoll(input);if(after>maximum)initial=true;}
    auto rows=initial?db.query("SELECT id,event,payload,created FROM outbox WHERE event LIKE 'workflow.%' ORDER BY id DESC LIMIT 500"):db.query("SELECT id,event,payload,created FROM outbox WHERE event LIKE 'workflow.%' AND id>? ORDER BY id LIMIT 200",{after});
    J events=J::array();long long cursor=initial?maximum:after;
    for(auto&row:rows){cursor=std::max(cursor,row["id"].get<long long>());J data=J::parse(row["payload"].get<std::string>());
        if(row["event"]=="workflow.appointment.draft"&&u["role"]!="admin"&&u["role"]!="reception")continue;
        if(u["role"]=="psychologist"&&data.value("psychologist_id",J())!=u["id"])continue;
        J event={{"id",row["id"]},{"kind",row["event"].get<std::string>().substr(9)},{"created",row["created"]},{"actor_id",data["actor_id"]},{"actor",data["actor"]}};
        if(u["role"]!="director"){event["appointment_id"]=data["appointment_id"];event["patient_id"]=data["patient_id"];event["start"]=data["start"];event["room"]=data["room"];}
        events.push_back(event);
    }
    if(initial){std::reverse(events.begin(),events.end());if(events.size()>30)events.erase(events.begin(),events.end()-30);}
    return {{"events",events},{"cursor",cursor},{"initial",initial},{"has_more",!initial&&rows.size()==200}};
}
