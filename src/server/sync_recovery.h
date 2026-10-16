// Recovery preserves the uploaded source; only an administrator may resolve it.
int recoveryAppointmentId(const J&payload){
 if(!payload.is_object()||!payload.contains("appointment_id"))return 0;
 auto value=payload["appointment_id"];
 if(value.is_number_integer())return num(payload,"appointment_id");
 if(value.is_string()&&std::regex_match(value.get<std::string>(),std::regex("[0-9]{1,9}")))return std::stoi(value.get<std::string>());
 return 0;
}
std::string recoveryFingerprint(J payload){
 if(payload.contains("duration_minutes")&&payload["duration_minutes"].is_string()){
  auto value=payload["duration_minutes"].get<std::string>();
  if(!std::regex_match(value,std::regex("[0-9]{1,3}")))return digest("invalid-duration:"+payload.dump());
  payload["duration_minutes"]=std::stoi(value);
 }
 return consultationFingerprint(payload);
}
J recoveryDetail(DB&db,int id){
 auto rows=db.query("SELECT r.*,p.name patient,p.patient_no,u.name psychologist,m.device_name FROM mobile_recovery r JOIN patients p ON p.id=r.patient_id JOIN users u ON u.id=r.user_id LEFT JOIN mobile_devices m ON m.user_id=r.user_id AND m.device_id=r.device_id WHERE r.id=?",{id});
 check(!rows.empty(),"Проблемний запис не знайдено",404);auto result=rows[0];result["payload"]=J::parse(result["payload"].get<std::string>());
 auto draft=db.query("SELECT version,payload FROM consultation_drafts WHERE patient_id=? AND user_id=?",{result["patient_id"],result["user_id"]});
 result["draft_version"]=draft.empty()?0:draft[0]["version"].get<int>();
 result["server_draft"]=draft.empty()?J(nullptr):J::parse(draft[0]["payload"].get<std::string>());
 result["existing"]=db.query("SELECT c.*,u.name psychologist FROM consultations c JOIN users u ON u.id=c.psychologist_id WHERE c.patient_id=? AND c.appointment_id=?",{result["patient_id"],result["appointment_id"]});
 auto appointment=db.query("SELECT a.start,a.status,t.visit_status FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE a.id=? AND t.patient_id=?",{result["appointment_id"],result["patient_id"]});
 result["appointment"]=appointment.empty()?J(nullptr):appointment[0];return result;
}
J syncRecovery(DB&db,const J&u,const httplib::Request&r,const J&b,const std::string&token){
 auto path=r.path,method=r.method;
 if(path=="/api/mobile-recovery"){
  allow(u,{"psychologist"});check(method=="POST","Метод не дозволений",405);
  auto session=db.query("SELECT device_id FROM sessions WHERE token=?",{token});check(!session.empty()&&session[0]["device_id"]!="","Пристрій не визначено",400);
  auto device=session[0]["device_id"];auto items=b.value("items",J::array());check(items.is_array()&&items.size()<=5,"Передавайте не більше 5 записів за раз");J result=J::array();
  for(auto&item:items){
   check(item.is_object()&&item.contains("payload")&&item["payload"].is_object(),"Потрібен збережений запис");auto payload=item["payload"];
   auto key=str(payload,"client_key",80),kind=str(item,"kind",20);check(std::regex_match(key,std::regex("[a-zA-Z0-9-]{16,80}")),"Некоректний ключ");check(kind=="draft"||kind=="consultation","Некоректний тип запису");
   for(auto field:{"note","request_text","state_text","work_done","goals","result_text","recommendations","homework","next_plan"})str(payload,field,10000,false);
   str(payload,"consultation_type",40,false);str(payload,"risk_level",20,false);
   if(payload.contains("duration_minutes"))num(payload,"duration_minutes");
   if(payload.contains("risk_flags")){check(payload["risk_flags"].is_array()&&payload["risk_flags"].size()<=30,"Некоректні позначки ризику");for(auto&flag:payload["risk_flags"])check(flag.is_string()&&flag.get<std::string>().size()<=80,"Некоректна позначка ризику");}
   int pid=num(payload,"patient_id"),aid=num(payload,"appointment_id");check(payload.dump().size()<=200000,"Запис завеликий",413);
   // Appointment authorship remains checkable even after the patient was reassigned.
   check(!db.query("SELECT a.id FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE a.id=? AND t.patient_id=? AND a.psychologist_id=?",{aid,pid,u["id"]}).empty(),"Цей прийом не належить психологу",403);
   auto old=db.query("SELECT * FROM mobile_recovery WHERE user_id=? AND device_id=? AND client_key=?",{u["id"],device,key});
   auto error=str(item,"error",1000,false);int id;
   if(old.empty()){
    auto inserted=db.query("INSERT INTO mobile_recovery(user_id,device_id,client_key,patient_id,appointment_id,kind,payload,error,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id",{u["id"],device,key,pid,aid,kind,payload.dump(),error,now(),now()});id=inserted[0]["id"].get<int>();
   }else{
    id=old[0]["id"];check(old[0]["patient_id"]==pid&&old[0]["appointment_id"]==aid,"Ключ належить іншому прийому",409);
    if(old[0]["state"]=="open"&&(old[0]["payload"]!=payload.dump()||old[0]["kind"]!=kind||old[0]["error"]!=error))
     db.query("UPDATE mobile_recovery SET payload=?,kind=?,error=?,revision=revision+1,updated=? WHERE id=?",{payload.dump(),kind,error,now(),id});
   }
   auto saved=db.query("SELECT client_key,state,consultation_id,payload FROM mobile_recovery WHERE id=?",{id})[0];saved["source"]=J::parse(saved["payload"].get<std::string>());saved.erase("payload");result.push_back(saved);
  }
  return {{"items",result}};
 }
 allow(u,{"admin"});
 if(path=="/api/admin/recovery"){
  check(method=="GET","Метод не дозволений",405);J args=J::array();std::string filter;
  if(r.has_param("user_id")){auto user=r.get_param_value("user_id");check(std::regex_match(user,std::regex("[0-9]+")),"Некоректний працівник");filter=" WHERE r.user_id=?";args.push_back(std::stoll(user));}
  if(r.has_param("device_id")){filter+=filter.empty()?" WHERE":" AND";filter+=" r.device_id=?";args.push_back(r.get_param_value("device_id"));}
  return db.query("SELECT r.id,r.user_id,r.device_id,r.patient_id,r.appointment_id,r.client_key,r.kind,r.error,r.revision,r.state,r.consultation_id,r.created,r.updated,p.name patient,p.patient_no,u.name psychologist FROM mobile_recovery r JOIN patients p ON p.id=r.patient_id JOIN users u ON u.id=r.user_id"+filter+" ORDER BY (r.state='open') DESC,r.updated DESC,r.id DESC LIMIT 200",args);
 }
 auto tail=path.substr(std::string("/api/admin/recovery/").size());int id=std::stoi(tail);auto item=recoveryDetail(db,id);
 if(method=="GET")return item;
 check(method=="POST","Метод не дозволений",405);
 check(item["state"]=="open","Запис уже оброблено. Оновіть список.",409);
 check(num(b,"revision")==item["revision"],"Телефон передав новішу версію. Оновіть запис перед проведенням.",409);
 auto reason=str(b,"reason",1000),action=str(b,"action",20);int consultationId=0;J resolved;
 check(num(b,"draft_version")==item["draft_version"],"Серверну чернетку змінено. Оновіть запис.",409);
 if(action=="link"){
  consultationId=num(b,"consultation_id");auto existing=db.query("SELECT * FROM consultations WHERE id=? AND patient_id=? AND appointment_id=? AND psychologist_id=?",{consultationId,item["patient_id"],item["appointment_id"],item["user_id"]});
  check(!existing.empty(),"Потрібна консультація цього пацієнта, прийому та психолога",409);check(b.value("confirmed",false),"Підтвердьте звірку записів");resolved=existing[0];
  auto remote=item["server_draft"];
  if(!remote.is_null()&&remote.value("client_key",std::string())==item["client_key"].get<std::string>()&&recoveryAppointmentId(remote)==item["appointment_id"]&&recoveryFingerprint(remote)==recoveryFingerprint(item["payload"]))
   db.query("UPDATE consultation_drafts SET payload='null',version=version+1,updated=? WHERE patient_id=? AND user_id=? AND version=?",{now(),item["patient_id"],item["user_id"],item["draft_version"]});

 }else{
  check(action=="complete","Невідома дія");check(item["existing"].empty(),"Консультація вже є в базі. Звірте її замість повторного проведення.",409);check(b.value("confirmed",false),"Підтвердьте, що консультація фактично проведена");
  check(b.contains("payload")&&b["payload"].is_object(),"Потрібен текст консультації");auto payload=b["payload"];
  check(num(payload,"patient_id")==item["patient_id"]&&num(payload,"appointment_id")==item["appointment_id"]&&str(payload,"client_key",80)==item["client_key"].get<std::string>(),"Не можна змінити пацієнта, прийом або ключ");
  auto currentDraft=num(b,"draft_version");payload.erase("draft_version");
  bool sameDraft=!item["server_draft"].is_null()&&item["server_draft"].value("client_key",std::string())==item["client_key"].get<std::string>()&&recoveryAppointmentId(item["server_draft"])==item["appointment_id"];
  if(sameDraft){
   bool conflict=recoveryFingerprint(item["server_draft"])!=recoveryFingerprint(item["payload"]);
   check(!conflict||b.value("confirm_server_conflict",false),"Звірте відмінну серверну чернетку й підтвердьте вибір тексту",409);
   payload["draft_version"]=currentDraft;
  }
  auto authors=db.query("SELECT id,role FROM users WHERE id=? AND role='psychologist' AND active=TRUE",{item["user_id"]});check(!authors.empty(),"Психолог неактивний. Потрібна перевірка адміністратора.",409);
  check(!item["appointment"].is_null(),"Учасника більше немає у прийомі",409);
  auto appointment=item["appointment"];check(appointment["start"].get<std::string>()<=now().substr(0,16),"Майбутню консультацію ще не можна провести",409);
  if(appointment["status"]=="cancelled"||appointment["status"]=="no_show"||appointment["visit_status"]!=""){
   check(b.value("restore_attendance",false),"Підтвердьте відновлення скасованого прийому або неявки",409);
   check(item["existing"].empty(),"Консультація вже існує: звірте її з проблемним записом",409);
   db.query("UPDATE attendees SET visit_status='',exclusion_reason='' WHERE appointment_id=? AND patient_id=?",{item["appointment_id"],item["patient_id"]});
   if(appointment["status"]=="cancelled"||appointment["status"]=="no_show"||appointment["status"]=="completed")db.query("UPDATE appointments SET status='scheduled' WHERE id=?",{item["appointment_id"]});
   audit(db,u,"recovery_restore_attendance","appointment",item["appointment_id"].get<int>());
  }
  auto saved=saveConsultation(db,authors[0],payload,&u);consultationId=saved["id"];resolved=payload;
 }
 db.query("UPDATE mobile_recovery SET state=?,consultation_id=?,resolved_by=?,resolution_reason=?,resolved_payload=?,server_snapshot=?,updated=?,revision=revision+1 WHERE id=?",{action=="link"?"linked":"completed",consultationId,u["id"],reason,resolved.dump(),J{{"version",item["draft_version"]},{"payload",item["server_draft"]}}.dump(),now(),id});
 audit(db,u,action=="link"?"recovery_link":"recovery_complete","mobile_recovery",id);
 return {{"ok",true},{"consultation_id",consultationId}};
}
