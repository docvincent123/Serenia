#pragma once
J serviceStatus(DB&db){
 auto state=db.query("SELECT mode,message,expected_until,updated FROM client_service_state WHERE id=1")[0];
 state["server_time"]=epoch();state["server_id"]=installationId(db);state["version"]=SOLVIA_VERSION;
 return state;
}
J updateServiceStatus(DB&db,const J&u,const J&b){
 allow(u,{"admin"});auto mode=str(b,"mode",20),message=str(b,"message",300,false);
 check(mode=="ready"||mode=="maintenance","Режим: ready або maintenance");
 check(!b.contains("expected_until")||b["expected_until"].is_number_integer(),"Некоректний час завершення");
 long long until=b.value("expected_until",0LL);
 check(until==0||(until>epoch()&&until<=epoch()+86400),"Час завершення: протягом 24 годин");
 db.query("UPDATE client_service_state SET mode=?,message=?,expected_until=?,updated=? WHERE id=1",{mode,message,until,now()});
 audit(db,u,"update","service_state",1);return serviceStatus(db);
}
