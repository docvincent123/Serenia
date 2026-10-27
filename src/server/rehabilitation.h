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
        return {{"id",id},{"revision",1}};
    }
    if(std::regex_match(path,std::regex("/api/rehab-goals/[0-9]+"))){
        int id=std::stoi(path.substr(17));
        auto rows=db.query("SELECT g.*,c.status course_status,c.psychologist_id course_psychologist_id FROM rehabilitation_goals g JOIN patient_courses c ON c.id=g.course_id WHERE g.id=?",{id});
        check(!rows.empty(),"Ціль не знайдено",404);
        auto goal=rows[0];
        getPatient(db,u,goal["patient_id"].get<int>());
        if(method=="GET")return goal;
        allow(u,{"psychologist"});check(method=="PATCH","Метод не дозволений",405);
        check(goal["course_status"]=="active"&&goal["course_psychologist_id"]==u["id"],"Завершений або чужий курс не можна редагувати",409);
        auto revision=num(b,"revision");check(revision==goal["revision"].get<int>(),"Ціль змінено на іншому пристрої. Оновіть дані.",409);
        auto state=str(b,"state",20);
        check(state=="planned"||state=="in_progress"||state=="achieved"||state=="paused","Некоректний статус цілі");
        auto progress=str(b,"progress_value",500,false),note=str(b,"note",2000,false);
        check(!note.empty(),"Вкажіть обґрунтування зміни прогресу");
        auto ts=now();
        db.query("UPDATE rehabilitation_goals SET state=?,progress_value=?,revision=revision+1,updated=? WHERE id=? AND revision=?",{state,progress,ts,id,revision});
        db.query("INSERT INTO rehabilitation_goal_updates(goal_id,state,progress_value,note,author_id,created) VALUES(?,?,?,?,?,?)",{id,state,progress,note,u["id"],ts});
        audit(db,u,"update","rehabilitation_goal",id);
        return {{"ok",true},{"revision",revision+1}};
    }
    throw Error(404,"Невідомий маршрут");
}
