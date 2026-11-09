#pragma once
// Internal clinical-document approval. This is an audit trail, NOT a digital
// signature or qualified electronic signature (KEP). Printed documents still
// require the centre's normal signature/issuance procedure.
J dischargeWorkflow(DB&db,const J&u,const httplib::Request&r,const J&body){
    check(r.method=="POST","Метод не дозволений",405);
    allow(u,{"admin","director","psychologist"});
    const auto separator=r.path.find("/workflow");
    const int id=std::stoi(r.path.substr(16,separator-16));
    const auto rows=db.query("SELECT * FROM discharge_summaries WHERE id=? FOR UPDATE",{id});
    check(!rows.empty(),"Виписку не знайдено",404);
    const auto current=rows[0];
    check(num(body,"revision")==current["revision"].get<int>(),"Виписку вже змінено. Оновіть документ",409);
    const auto action=str(body,"action",20);
    const auto state=current["workflow_status"].get<std::string>();
    std::string reason;
    if(action=="submit"){
        check(u["role"]=="psychologist","На погодження може подати тільки відповідальний психолог",403);
        check(current["psychologist_id"]==u["id"],"Ця виписка належить іншому психологу",403);
        getPatient(db,u,current["patient_id"].get<int>());
        check(state=="draft","На погодження можна подати лише чернетку",409);
        check(current["summary"].get<std::string>().size()>=20,"Перевірте підсумок виписки перед погодженням",409);
        reason="Подано психологом на погодження";
        db.query("UPDATE discharge_summaries SET workflow_status='review',submitted_by=?,submitted_at=?,approved_by=NULL,approved_at='',return_reason='',revision=revision+1,updated=? WHERE id=?",
            {u["id"],now(),now(),id});
    }else if(action=="approve"){
        allow(u,{"admin","director"});
        check(state=="review","Спочатку психолог має подати виписку на погодження",409);
        check(!current["submitted_by"].is_null()&&!current["submitted_at"].get<std::string>().empty(),"Потрібне підтвердження психолога",409);
        reason="Погоджено керівником";
        db.query("UPDATE discharge_summaries SET workflow_status='approved',approved_by=?,approved_at=?,revision=revision+1,updated=? WHERE id=?",
            {u["id"],now(),now(),id});
    }else if(action=="return"){
        allow(u,{"admin","director"});
        check(state=="review","Повернути можна лише виписку на погодженні",409);
        reason=str(body,"reason",1000);
        db.query("UPDATE discharge_summaries SET workflow_status='draft',submitted_by=NULL,submitted_at='',approved_by=NULL,approved_at='',return_reason=?,revision=revision+1,updated=? WHERE id=?",
            {reason,now(),id});
    }else{
        throw Error(400,"Невідома дія з випискою");
    }
    db.query("INSERT INTO discharge_revisions(discharge_id,revision,snapshot,reason,author_id,created) VALUES(?,?,?,?,?,?)",
        {id,current["revision"],current.dump(),reason,u["id"],now()});
    audit(db,u,action,"discharge",id);
    return db.query("SELECT d.*,u.name approved_by_name FROM discharge_summaries d LEFT JOIN users u ON u.id=d.approved_by WHERE d.id=?",{id})[0];
}
