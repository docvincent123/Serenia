#pragma once
J applyWorkflowPolicy(DB&db,const J&u,const J&b){
 allow(u,{"admin"});auto policy=workflow(db);
    for(auto key:{"opening_time","closing_time","working_days"})if(b.contains(key))policy[key]=str(b,key,20);
    for(auto key:{"slot_step_minutes","default_duration_minutes","session_hours"})if(b.contains(key))policy[key]=num(b,key);
    auto opening=policy["opening_time"].get<std::string>(),closing=policy["closing_time"].get<std::string>(),days=policy["working_days"].get<std::string>();
    validTime("2000-01-01T"+opening);validTime("2000-01-01T"+closing);check(opening<closing,"Початок роботи має бути раніше завершення");
    check(days.size()<=7&&days.find_first_not_of("1234567")==std::string::npos,"Робочі дні: цифри 1–7");
    int step=policy["slot_step_minutes"],duration=policy["default_duration_minutes"],hours=policy["session_hours"];
    check(step==15||step==30||step==60,"Крок запису: 15, 30 або 60 хвилин");
    check(duration>=15&&duration<=240&&duration<=timeMinutes(closing)-timeMinutes(opening),"Тривалість: 15–240 хвилин у межах робочого дня");check(hours>=1&&hours<=24,"Сесія: 1–24 години");
    db.query("UPDATE workflow_settings SET opening_time=?,closing_time=?,working_days=?,slot_step_minutes=?,default_duration_minutes=?,session_hours=? WHERE id=1",{opening,closing,days,step,duration,hours});
    db.query("UPDATE sessions SET expires=LEAST(expires,?)",{epoch()+hours*3600});
    audit(db,u,"update","workflow_settings",1);return policy;

}
