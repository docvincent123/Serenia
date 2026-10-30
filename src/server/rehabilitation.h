// The surrounding HTTP transaction owns this advisory lock until commit/rollback.
// Two API processes therefore share the same author-scoped retry protection.
std::string rehabRequestKey(DB&db,const J&u,const J&b){
    auto key=str(b,"client_key",80,false);
    if(!key.empty()){
        check(std::regex_match(key,std::regex("[a-zA-Z0-9-]{16,80}")),"Некоректний ключ збереження");
        db.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",{"rehabilitation:"+std::to_string(u["id"].get<int>())+":"+key});
    }
    return key;
}
J rehabReplay(DB&db,const J&u,const std::string&key,const std::string&fingerprint){
    if(key.empty())return nullptr;
    auto saved=db.query("SELECT fingerprint,response FROM rehabilitation_requests WHERE user_id=? AND client_key=?",{u["id"],key});
    if(saved.empty())return nullptr;
    check(saved[0]["fingerprint"]==fingerprint,"Цей запит уже збережено з іншими даними. Оновіть план перед повтором.",409);
    auto response=J::parse(saved[0]["response"].get<std::string>());response["already_saved"]=true;return response;
}
void rehabReceipt(DB&db,const J&u,const std::string&key,const std::string&fingerprint,int id,const J&response){
    if(!key.empty())db.query("INSERT INTO rehabilitation_requests(user_id,client_key,fingerprint,response,goal_id,created) VALUES(?,?,?,?,?,?)",{u["id"],key,fingerprint,response.dump(),id,now()});
}

// SOLVIA patient rehabilitation goals. Clinical text never enters operational feeds.
J rehabilitation(DB&db,const J&u,const httplib::Request&r,const J&b){
    const auto& path=r.path;const auto& method=r.method;
    allow(u,{"admin","psychologist"}); // Reception never receives clinical plan text.
    if(std::regex_match(path,std::regex("/api/patients/[0-9]+/rehab-goals"))){
        int pid=std::stoi(path.substr(14,path.find("/rehab-goals")-14));
        auto patient=getPatient(db,u,pid); // Psychologist: only assigned patients.
        if(method=="GET"){
            auto rows=db.query("SELECT g.*,c.course_no,c.status course_status,owner.name owner_name,author.name author_name FROM rehabilitation_goals g JOIN patient_courses c ON c.id=g.course_id JOIN users owner ON owner.id=g.owner_id JOIN users author ON author.id=g.created_by WHERE g.patient_id=? ORDER BY (CASE WHEN c.status='active' THEN 0 ELSE 1 END),g.id DESC LIMIT 250",{pid});
            for(auto&goal:rows)
                goal["updates"]=db.query("SELECT h.id,h.state,h.progress_value,h.note,h.created,u.name author_name FROM rehabilitation_goal_updates h JOIN users u ON u.id=h.author_id WHERE h.goal_id=? ORDER BY h.id DESC LIMIT 50",{goal["id"]});
            audit(db,u,"read","rehabilitation_plan",pid);
            return rows;
        }
        allow(u,{"psychologist"});
        check(method=="POST","Метод не дозволений",405);
        auto key=rehabRequestKey(db,u,b),fingerprint=digest(path+"\n"+b.dump());
        auto replay=rehabReplay(db,u,key,fingerprint);if(!replay.is_null())return replay;
        auto course=db.query("SELECT id FROM patient_courses WHERE patient_id=? AND status='active' AND psychologist_id=?",{pid,u["id"]});
        check(!course.empty(),"Немає активного курсу, закріпленого за психологом",409);
        int owner=b.contains("owner_id")?num(b,"owner_id"):u["id"].get<int>();
        // The current product has four roles; only an active psychologist can own a clinical goal.
        check(!db.query("SELECT id FROM users WHERE id=? AND role='psychologist' AND active=TRUE",{owner}).empty(),"Відповідальний має бути активним психологом");
        check(owner==u["id"].get<int>(),"Не можна призначити ціль іншому психологу без передачі пацієнта",403);
        auto title=str(b,"title",300),measure=str(b,"measurement",500,false),baseline=str(b,"baseline",500,false),target=str(b,"target_value",500,false);
        auto deadline=str(b,"target_date",10,false);if(!deadline.empty())validDate(deadline);
        auto ts=now();
        db.query("INSERT INTO rehabilitation_goals(patient_id,course_id,owner_id,title,measurement,baseline,target_value,target_date,state,progress_value,created_by,created,updated,revision) VALUES(?,?,?,?,?,?,?,?, 'planned','',?,?,?,1)",{pid,course[0]["id"],owner,title,measure,baseline,target,deadline,u["id"],ts,ts});
        int id=db.id();
        db.query("INSERT INTO rehabilitation_goal_updates(goal_id,state,progress_value,note,author_id,created) VALUES(?,'planned','','Ціль створено',?,?)",{id,u["id"],ts});
        audit(db,u,"create","rehabilitation_goal",id);
        J response={{"id",id},{"revision",1}};rehabReceipt(db,u,key,fingerprint,id,response);return response;
    }
    if(std::regex_match(path,std::regex("/api/rehab-goals/[0-9]+"))){
        int id=std::stoi(path.substr(17));
        auto rows=db.query("SELECT g.*,c.status course_status,c.psychologist_id course_psychologist_id FROM rehabilitation_goals g JOIN patient_courses c ON c.id=g.course_id WHERE g.id=?",{id});
        check(!rows.empty(),"Ціль не знайдено",404);
        auto goal=rows[0];
        getPatient(db,u,goal["patient_id"].get<int>());
        if(method=="GET")return goal;
        allow(u,{"psychologist"});check(method=="PATCH","Метод не дозволений",405);
        auto key=rehabRequestKey(db,u,b),fingerprint=digest(path+"\n"+b.dump());
        auto replay=rehabReplay(db,u,key,fingerprint);if(!replay.is_null())return replay;
        check(goal["course_status"]=="active"&&goal["course_psychologist_id"]==u["id"],"Завершений або чужий курс не можна редагувати",409);
        auto revision=num(b,"revision");check(revision==goal["revision"].get<int>(),"Ціль змінено на іншому пристрої. Оновіть дані.",409);
        auto state=str(b,"state",20);
        check(state=="planned"||state=="in_progress"||state=="achieved"||state=="paused","Некоректний статус цілі");
        auto progress=str(b,"progress_value",500,false),note=str(b,"note",2000,false);
        check(!note.empty(),"Вкажіть обґрунтування зміни прогресу");
        auto ts=now();
        auto changed=db.query("UPDATE rehabilitation_goals SET state=?,progress_value=?,revision=revision+1,updated=? WHERE id=? AND revision=? RETURNING id",{state,progress,ts,id,revision});
        check(!changed.empty(),"Ціль змінено на іншому пристрої. Оновіть дані.",409);
        db.query("INSERT INTO rehabilitation_goal_updates(goal_id,state,progress_value,note,author_id,created) VALUES(?,?,?,?,?,?)",{id,state,progress,note,u["id"],ts});
        audit(db,u,"update","rehabilitation_goal",id);
        J response={{"ok",true},{"revision",revision+1}};rehabReceipt(db,u,key,fingerprint,id,response);return response;
    }
    throw Error(404,"Невідомий маршрут");
}
