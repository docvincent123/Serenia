// All operations use the authenticated caller and the surrounding transaction.
J shiftReadiness(DB&db,const J&u,const std::string&day){
    validDate(day);allow(u,{"admin","psychologist"});
    auto own=u["role"]=="psychologist";J args={day};
    auto filter=own?" AND a.psychologist_id=?":"";if(own)args.push_back(u["id"]);
    auto unfinished=db.query(std::string("SELECT a.id appointment_id,p.id patient_id,p.name patient,us.name psychologist,a.start,t.arrived_at,t.started_at FROM appointments a JOIN attendees t ON t.appointment_id=a.id JOIN patients p ON p.id=t.patient_id JOIN users us ON us.id=a.psychologist_id WHERE substr(a.start,1,10)=? AND a.status IN ('scheduled','confirmed') AND t.visit_status='' AND NOT EXISTS(SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)")+filter+" ORDER BY a.start,p.name",args);
    J dargs=J::array();std::string where=" WHERE us.active=TRUE AND (substr(m.last_seen,1,10)=? OR m.pending_count>0 OR m.blocked_count>0)";dargs.push_back(day);if(own){where+=" AND m.user_id=?";dargs.push_back(u["id"]);}
    auto devices=db.query("SELECT m.*,us.name,(m.last_seen_epoch >= extract(epoch from now())::bigint-120) fresh FROM mobile_devices m JOIN users us ON us.id=m.user_id"+where+" ORDER BY m.last_seen DESC",dargs);
    bool safe=unfinished.empty();for(auto&d:devices)if(!d["fresh"].get<bool>()||d["pending_count"].get<int>()||d["blocked_count"].get<int>())safe=false;
    // A legacy client cannot assert that its queue is empty.
    auto unknown=db.query(std::string("SELECT DISTINCT us.id,us.name FROM appointments a JOIN users us ON us.id=a.psychologist_id WHERE substr(a.start,1,10)=? AND a.status NOT IN ('cancelled','no_show','draft') AND us.active=TRUE AND NOT EXISTS(SELECT 1 FROM mobile_devices m WHERE m.user_id=us.id AND substr(m.last_seen,1,10)=substr(a.start,1,10))")+filter,args);
    return {{"date",day},{"unfinished",unfinished},{"devices",devices},{"unknown_psychologists",unknown},{"ready",safe&&unknown.empty()}};
}
J operations(DB&db,const J&u,const httplib::Request&r,const J&b,const std::string&token){
    auto path=r.path,method=r.method;
    if(path=="/api/mobile-status"){
        allow(u,{"psychologist"});check(method=="POST","Метод не дозволений",405);
        auto session=db.query("SELECT device_id,device_name FROM sessions WHERE token=?",{token});
        check(!session.empty()&&!session[0]["device_id"].get<std::string>().empty(),"Пристрій не визначено",400);
        auto code=num(b,"version_code"),pending=num(b,"pending_count"),blocked=num(b,"blocked_count");
        check(code>0&&pending>=0&&pending<=10000&&blocked>=0&&blocked<=10000,"Некоректні лічильники");
        auto sync=str(b,"last_sync",19,false);if(!sync.empty()){check(sync.size()==19,"Некоректний час синхронізації");validTime(sync.substr(0,16));check(std::regex_match(sync.substr(16),std::regex(":[0-5][0-9]")),"Некоректний час синхронізації");check(sync<=now(),"Час синхронізації з майбутнього");}
        auto error=str(b,"error_code",40,false);check(error.empty()||error=="pending"||error=="conflict"||error=="network"||error=="server","Некоректний код помилки");
        if(pending==0&&blocked==0)sync=now();
        db.query("INSERT INTO mobile_devices(user_id,device_id,device_name,version_code,version_name,last_seen,last_sync,pending_count,blocked_count,error_code,last_seen_epoch) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,device_id) DO UPDATE SET device_name=EXCLUDED.device_name,version_code=EXCLUDED.version_code,version_name=EXCLUDED.version_name,last_seen=EXCLUDED.last_seen,last_sync=EXCLUDED.last_sync,pending_count=EXCLUDED.pending_count,blocked_count=EXCLUDED.blocked_count,error_code=EXCLUDED.error_code,last_seen_epoch=EXCLUDED.last_seen_epoch",{u["id"],session[0]["device_id"],session[0]["device_name"],code,str(b,"version_name",50),now(),sync,pending,blocked,error,epoch()});
        return {{"ok",true},{"server_time",now()}};
    }
    if(path=="/api/admin/devices"){
        allow(u,{"admin"});check(method=="GET","Метод не дозволений",405);
        return db.query("SELECT m.*,u.name,u.active,(m.last_seen_epoch >= extract(epoch from now())::bigint-120) fresh FROM mobile_devices m JOIN users u ON u.id=m.user_id ORDER BY fresh DESC,m.last_seen DESC");
    }
    if(path=="/api/shift-readiness"){check(method=="GET","Метод не дозволений",405);return shiftReadiness(db,u,r.has_param("date")?r.get_param_value("date"):now().substr(0,10));}
    std::smatch match;
    if(std::regex_match(path,match,std::regex("/api/appointments/([0-9]+)/attendance"))){
        allow(u,{"admin","reception"});check(method=="PATCH","Метод не дозволений",405);
        int aid=std::stoi(match[1]),pid=num(b,"patient_id");auto status=str(b,"status",20);check(status=="cancelled"||status=="no_show","Некоректний статус");
        auto rows=db.query("SELECT a.status,a.start,t.visit_status FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE a.id=? AND t.patient_id=?",{aid,pid});check(!rows.empty(),"Пацієнта немає у прийомі",404);
        check(rows[0]["status"]=="scheduled"||rows[0]["status"]=="confirmed","Прийом закрито",409);
        check(status!="no_show"||rows[0]["start"].get<std::string>().substr(0,10)<=now().substr(0,10),"Неявку майбутнього дня ще не можна відмітити",409);
        check(db.query("SELECT id FROM consultations WHERE appointment_id=? AND patient_id=?",{aid,pid}).empty(),"Консультацію вже проведено",409);
        db.query("UPDATE attendees SET visit_status=?,exclusion_reason=? WHERE appointment_id=? AND patient_id=?",{status,str(b,"reason",1000),aid,pid});
        auto count=db.query("SELECT count(*) total,count(*) FILTER(WHERE t.visit_status<>'' OR EXISTS(SELECT 1 FROM consultations c WHERE c.appointment_id=t.appointment_id AND c.patient_id=t.patient_id)) done FROM attendees t WHERE appointment_id=?",{aid})[0];
        if(count["total"]==count["done"]){auto completed=db.query("SELECT id FROM consultations WHERE appointment_id=?",{aid});db.query("UPDATE appointments SET status=? WHERE id=?",{completed.empty()?status:"completed",aid});}
        audit(db,u,status,"attendance",aid);return {{"ok",true}};
    }
    if(std::regex_match(path,match,std::regex("/api/appointments/([0-9]+)/start"))){
        allow(u,{"psychologist"});check(method=="POST","Метод не дозволений",405);
        int aid=std::stoi(match[1]),pid=num(b,"patient_id");
        auto rows=db.query("SELECT a.status,a.start,t.arrived_at,t.started_at FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE a.id=? AND a.psychologist_id=? AND t.patient_id=? AND t.visit_status=''",{aid,u["id"],pid});
        check(!rows.empty(),"Прийом не знайдено",404);auto a=rows[0];
        check(a["status"]=="scheduled"||a["status"]=="confirmed","Прийом уже закрито",409);
        check(a["start"].get<std::string>().substr(0,10)==now().substr(0,10),"Початок можна відмітити лише сьогодні",409);
        check(!a["arrived_at"].get<std::string>().empty(),"Спочатку відмітьте прибуття пацієнта",409);
        check(db.query("SELECT id FROM consultations WHERE appointment_id=? AND patient_id=?",{aid,pid}).empty(),"Консультацію вже завершено",409);
        if(a["started_at"]==""){db.query("UPDATE attendees SET started_at=? WHERE appointment_id=? AND patient_id=? AND started_at=''",{now(),aid,pid});audit(db,u,"start","appointment",aid);}
        return {{"ok",true},{"started_at",db.query("SELECT started_at FROM attendees WHERE appointment_id=? AND patient_id=?",{aid,pid})[0]["started_at"]}};
    }
    if(std::regex_match(path,match,std::regex("/api/consultations/([0-9]+)/addenda"))){
        allow(u,{"admin","psychologist"});int id=std::stoi(match[1]);auto rows=db.query("SELECT patient_id,psychologist_id FROM consultations WHERE id=?",{id});check(!rows.empty(),"Запис не знайдено",404);
        if(u["role"]=="psychologist"){check(rows[0]["psychologist_id"]==u["id"],"Це запис іншого психолога",403);getPatient(db,u,rows[0]["patient_id"].get<int>());}
        if(method=="GET")return db.query("SELECT a.*,u.name author FROM consultation_addenda a JOIN users u ON u.id=a.author_id WHERE a.consultation_id=? ORDER BY a.id",{id});
        allow(u,{"psychologist"});check(method=="POST","Метод не дозволений",405);
        auto key=str(b,"client_key",80);check(std::regex_match(key,std::regex("[a-zA-Z0-9-]{16,80}")),"Некоректний ключ");
        auto reason=str(b,"reason",1000),content=str(b,"content",10000);
        auto old=db.query("SELECT * FROM consultation_addenda WHERE author_id=? AND client_key=?",{u["id"],key});
        if(!old.empty()){check(old[0]["consultation_id"]==id&&old[0]["reason"]==reason&&old[0]["content"]==content,"Ключ уже використано",409);return {{"id",old[0]["id"]},{"already_saved",true}};}
        db.query("INSERT INTO consultation_addenda(consultation_id,author_id,reason,content,client_key,created) VALUES(?,?,?,?,?,?)",{id,u["id"],reason,content,key,now()});int added=db.id();audit(db,u,"addendum","consultation",id);return {{"id",added}};
    }
    if(std::regex_match(path,match,std::regex("/api/patients/([0-9]+)/progress"))){
        allow(u,{"admin","psychologist"});int pid=std::stoi(match[1]);getPatient(db,u,pid);
        if(method=="GET"){J args={pid};std::string filter;if(u["role"]=="psychologist"){filter=" AND p.author_id=?";args.push_back(u["id"]);}audit(db,u,"read_progress","patient",pid);return db.query("SELECT p.*,u.name author FROM patient_progress p JOIN users u ON u.id=p.author_id WHERE p.patient_id=?"+filter+" ORDER BY p.id DESC",args);}
        allow(u,{"psychologist"});check(method=="POST","Метод не дозволений",405);auto status=str(b,"status",20);
        check(status=="planned"||status=="in_progress"||status=="achieved"||status=="paused","Некоректний статус цілі");
        db.query("INSERT INTO patient_progress(patient_id,author_id,goal,status,observation,created) VALUES(?,?,?,?,?,?)",{pid,u["id"],str(b,"goal",1000),status,str(b,"observation",3000,false),now()});int id=db.id();audit(db,u,"progress","patient",pid);return {{"id",id}};
    }
    throw Error(404,"Не знайдено");
}
