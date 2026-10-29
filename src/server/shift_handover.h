#pragma once
// Operational handover: deliberately excludes patient records and private
// consultation content. Access is limited to reception and administrators.
J shiftHandover(DB&db,const J&u,const httplib::Request&r,const J&body){
    allow(u,{"admin","reception"});
    const auto &path=r.path;
    if(path=="/api/operations/handover"){
        if(r.method=="GET"){
            return db.query("SELECT h.id,h.shift_date,h.summary,h.priority,h.state,h.created_at,"
                "u.name created_by,coalesce(c.name,'') resolved_by,h.resolved_at "
                "FROM shift_handover h JOIN users u ON u.id=h.created_by "
                "LEFT JOIN users c ON c.id=h.resolved_by "
                "ORDER BY (CASE WHEN h.state='open' THEN 0 ELSE 1 END),h.id DESC LIMIT 100");
        }
        check(r.method=="POST","Метод не дозволений",405);
        const auto summary=str(body,"summary",300);
        const auto priority=str(body,"priority",12);
        const auto key=str(body,"client_key",80);
        check(priority=="normal"||priority=="important"||priority=="urgent","Невірний пріоритет",400);
        check(!summary.empty()&&summary.find_first_not_of(" \t\n\r")!=std::string::npos,"Введіть завдання передачі зміни",400);
        auto previous=db.query("SELECT id,summary,priority FROM shift_handover WHERE created_by=? AND client_key=?",{u["id"],key});
        if(!previous.empty()){
            check(previous[0]["summary"]==summary&&previous[0]["priority"]==priority,"Ключ запису вже використано для іншого завдання",409);
            return {{"id",previous[0]["id"]},{"replayed",true}};
        }
        const auto shift=db.query("SELECT shift_date FROM shift_days WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1");
        check(!shift.empty(),"Зміна не відкрита",423);
        const auto inserted=db.query("INSERT INTO shift_handover(shift_date,summary,priority,created_by,client_key,created_at) "
            "VALUES(?,?,?,?,?,?) RETURNING id",{shift[0]["shift_date"],summary,priority,u["id"],key,now()});
        const int id=inserted[0]["id"].get<int>();
        audit(db,u,"create","shift_handover",id);
        return {{"id",id},{"replayed",false}};
    }
    check(std::regex_match(path,std::regex("/api/operations/handover/[0-9]+")),"Невідомий запис",404);
    check(r.method=="PATCH","Метод не дозволений",405);
    check(str(body,"state",16)=="resolved","Дозволено лише завершення завдання",400);
    const int id=std::stoi(path.substr(std::string("/api/operations/handover/").size()));
    const auto rows=db.query("UPDATE shift_handover SET state='resolved',resolved_by=?,resolved_at=? "
        "WHERE id=? AND state='open' RETURNING id",{u["id"],now(),id});
    if(rows.empty()){
        const auto existing=db.query("SELECT state FROM shift_handover WHERE id=?",{id});
        check(!existing.empty(),"Завдання не знайдено",404);
        check(false,"Завдання вже завершено",409);
    }
    audit(db,u,"resolve","shift_handover",id);
    return {{"id",id},{"state","resolved"}};
}
