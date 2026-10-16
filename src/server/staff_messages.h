J staffMessages(DB&db,const J&u,const httplib::Request&r,const J&b,const std::string&token){
    auto path=r.path,method=r.method;
    if(path=="/api/staff/recipients"){
        allow(u,{"admin","director"});check(method=="GET","Метод не дозволений",405);
        auto people=db.query("SELECT id,name,phone FROM users WHERE role='psychologist' AND active=TRUE ORDER BY name");
        for(auto&p:people)p["devices"]=db.query("SELECT device_id,device_name,version_name,last_seen,(last_seen_epoch >= extract(epoch from now())::bigint-120) online FROM mobile_devices WHERE user_id=? ORDER BY last_seen DESC",{p["id"]});
        return people;
    }
    if(path=="/api/staff/messages"){
        if(method=="POST"){
            allow(u,{"admin","director"});
            auto recipient=num(b,"recipient_id");auto device=str(b,"device_id",160,false),body=str(b,"body",4000),key=str(b,"client_key",100);
            check(body.find_first_not_of(" \t\r\n")!=std::string::npos,"Введіть повідомлення");
            check(!db.query("SELECT id FROM users WHERE id=? AND role='psychologist' AND active=TRUE",{recipient}).empty(),"Психолога не знайдено",404);
            if(!device.empty())check(!db.query("SELECT device_id FROM mobile_devices WHERE user_id=? AND device_id=?",{recipient,device}).empty(),"Телефон не належить цьому психологу",400);
            auto saved=db.query("INSERT INTO staff_messages(sender_id,recipient_id,device_id,body,client_key,created) VALUES(?,?,?,?,?,?) ON CONFLICT(sender_id,client_key) DO NOTHING RETURNING id",{u["id"],recipient,device,body,key,now()});
            if(saved.empty()){
                auto existing=db.query("SELECT id,recipient_id,device_id,body FROM staff_messages WHERE sender_id=? AND client_key=?",{u["id"],key})[0];
                check(existing["recipient_id"]==recipient&&existing["device_id"]==device&&existing["body"]==body,"Ключ уже використано для іншого повідомлення",409);
                return {{"id",existing["id"]},{"already_saved",true}};
            }
            audit(db,u,"send","staff_message",saved[0]["id"].get<int>());return saved[0];
        }
        check(method=="GET","Метод не дозволений",405);
        if(u["role"]=="psychologist"){
            auto session=db.query("SELECT device_id FROM sessions WHERE token=?",{token})[0];
            return db.query("SELECT m.*,s.name sender FROM staff_messages m JOIN users s ON s.id=m.sender_id WHERE m.recipient_id=? AND (m.device_id='' OR m.device_id=?) ORDER BY m.id DESC LIMIT 200",{u["id"],session["device_id"]});
        }
        allow(u,{"admin","director"});
        return db.query("SELECT m.*,s.name sender,p.name recipient FROM staff_messages m JOIN users s ON s.id=m.sender_id JOIN users p ON p.id=m.recipient_id WHERE m.sender_id=? ORDER BY m.id DESC LIMIT 200",{u["id"]});
    }
    allow(u,{"psychologist"});check(method=="POST","Метод не дозволений",405);
    int id=std::stoi(path.substr(20));auto session=db.query("SELECT device_id FROM sessions WHERE token=?",{token})[0];
    auto rows=db.query("SELECT id FROM staff_messages WHERE id=? AND recipient_id=? AND (device_id='' OR device_id=?)",{id,u["id"],session["device_id"]});
    check(!rows.empty(),"Повідомлення не знайдено",404);
    if(path.ends_with("/read"))db.query("UPDATE staff_messages SET delivered_at=coalesce(delivered_at,?),read_at=coalesce(read_at,?) WHERE id=?",{now(),now(),id});
    else db.query("UPDATE staff_messages SET delivered_at=coalesce(delivered_at,?) WHERE id=?",{now(),id});
    return {{"ok",true}};
}
