// Included after DB/validation/booking helpers. All routes run in the caller's transaction.
J privateDraft(DB&db,const J&u,int pid,const std::string&method,const J&body){
    allow(u,{"psychologist"});getPatient(db,u,pid);
    auto rows=db.query("SELECT version,payload,updated FROM consultation_drafts WHERE patient_id=? AND user_id=?",{pid,u["id"]});
    if(method=="GET"){
        if(rows.empty())return {{"version",0},{"payload",nullptr}};
        auto result=rows[0];result["payload"]=J::parse(result["payload"].get<std::string>());return result;
    }
    check(method=="PATCH"||method=="DELETE","Метод не дозволений",405);
    int revision=num(body,"version");check(revision>=0,"Некоректна версія чернетки");
    int saved=rows.empty()?0:rows[0]["version"].get<int>();
    check(saved<std::numeric_limits<int>::max(),"Ліміт версій чернетки вичерпано",409);
    check(revision==saved,"Чернетку змінено на іншому пристрої. Відкрийте актуальну версію перед збереженням.",409);
    if(method=="DELETE"){
        if(!rows.empty())db.query("UPDATE consultation_drafts SET payload='null',version=version+1,updated=? WHERE patient_id=? AND user_id=?",{now(),pid,u["id"]});
        return {{"ok",true},{"version",rows.empty()?0:saved+1}};
    }
    check(body.contains("payload")&&body["payload"].is_object(),"Очікується чернетка");
    auto input=body["payload"];J payload=J::object();
    for(auto key:{"note","goals","next_plan","homework","request_text","state_text","work_done","recommendations","result_text"})payload[key]=str(input,key,10000,false);
    for(auto key:{"consultation_type","risk_level","consult_date","client_key","appointment_id","duration_minutes"}){
        if(input.contains(key)){
            check(input[key].is_string()||input[key].is_number_integer(),"Некоректне поле чернетки");
            payload[key]=input[key].is_string()?str(input,key,80,false):std::to_string(num(input,key));
        }
    }
    auto flags=input.value("risk_flags",J::array());check(flags.is_array()&&flags.size()<=20,"Некоректні позначки");
    for(auto&flag:flags)check(flag.is_string()&&flag.get<std::string>().size()<=60&&flag.get<std::string>().find('\0')==std::string::npos,"Некоректна позначка");
    payload["risk_flags"]=flags;
    check(payload.dump().size()<=100000,"Чернетка завелика");
    auto updated=now();
    db.query("INSERT INTO consultation_drafts(patient_id,user_id,version,payload,updated) VALUES(?,?,?,?,?) ON CONFLICT(patient_id,user_id) DO UPDATE SET version=EXCLUDED.version,payload=EXCLUDED.payload,updated=EXCLUDED.updated",{pid,u["id"],saved+1,payload.dump(),updated});
    return {{"version",saved+1},{"updated",updated}};
}

J waitingList(DB&db,const J&u,const httplib::Request&r,const J&b){
    allow(u,{"admin","reception"});auto path=r.path,method=r.method;
    if(path=="/api/waiting-list"){
        if(method=="GET")return db.query("SELECT w.*,p.name patient,p.phone,p.patient_no,us.name psychologist FROM waiting_list w JOIN patients p ON p.id=w.patient_id JOIN users us ON us.id=w.psychologist_id ORDER BY CASE WHEN w.status IN ('waiting','offered') THEN 0 ELSE 1 END,CASE WHEN w.priority='high' THEN 0 ELSE 1 END,w.created,w.id LIMIT 500");
        check(method=="POST","Метод не дозволений",405);
        int pid=num(b,"patient_id"),psy=num(b,"psychologist_id");auto patient=getPatient(db,u,pid);
        check(patient["status"]=="active"&&patient["psychologist_id"]==psy,"Оберіть активного пацієнта та його психолога");
        auto from=str(b,"date_from",10),to=str(b,"date_to",10),first=str(b,"time_from",5),last=str(b,"time_to",5);
        validDate(from);validDate(to);validTime(from+"T"+first);validTime(to+"T"+last);check(from<=to&&first<last,"Некоректний діапазон дат або часу");
        auto priority=str(b,"priority",10);check(priority=="normal"||priority=="high","Некоректний пріоритет");
        db.query("INSERT INTO waiting_list(patient_id,psychologist_id,date_from,date_to,time_from,time_to,priority,contact_note,created_by,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)",{pid,psy,from,to,first,last,priority,str(b,"contact_note",1000,false),u["id"],now(),now()});
        int id=db.id();audit(db,u,"create","waiting_list",id);return {{"id",id}};
    }
    std::smatch match;check(std::regex_match(path,match,std::regex("/api/waiting-list/([0-9]+)(/book)?")),"Не знайдено",404);
    int id=std::stoi(match[1]);auto rows=db.query("SELECT * FROM waiting_list WHERE id=?",{id});check(!rows.empty(),"Запис листа очікування не знайдено",404);auto item=rows[0];
    if(match[2]=="/book"){
        check(method=="POST","Метод не дозволений",405);
        if(item["status"]=="booked")return {{"id",item["appointment_id"]},{"already_booked",true}};
        check(item["status"]=="waiting"||item["status"]=="offered","Запис закрито",409);
        check(num(b,"version")==item["version"],"Запис змінено іншим реєстратором. Оновіть список.",409);
        auto start=str(b,"start",16),end=str(b,"end",16);validTime(start);validTime(end);
        check(start.substr(0,10)>=item["date_from"].get<std::string>()&&start.substr(0,10)<=item["date_to"].get<std::string>()&&start.substr(11)>=item["time_from"].get<std::string>()&&end.substr(11)<=item["time_to"].get<std::string>(),"Слот поза побажаннями пацієнта");
        J booking={{"psychologist_id",item["psychologist_id"]},{"room_id",num(b,"room_id")},{"patient_ids",J::array({item["patient_id"]})},{"start",start},{"end",end},{"kind","individual"},{"note","Запис із листа очікування"}};
        auto result=book(db,u,booking);
        db.query("UPDATE waiting_list SET status='booked',appointment_id=?,version=version+1,updated=? WHERE id=?",{result["id"],now(),id});
        audit(db,u,"book","waiting_list",id);return result;
    }
    check(method=="PATCH","Метод не дозволений",405);
    check(num(b,"version")==item["version"],"Запис змінено. Оновіть список.",409);
    check(item["status"]!="booked"&&item["status"]!="cancelled","Закритий запис змінювати не можна",409);
    auto status=str(b,"status",20);check(status=="waiting"||status=="offered"||status=="cancelled","Некоректний статус");
    db.query("UPDATE waiting_list SET status=?,version=version+1,updated=? WHERE id=?",{status,now(),id});audit(db,u,"update","waiting_list",id);return {{"ok",true}};
}
