#pragma once
J centerAccess(DB&db);
J currentConsentPolicy(DB&db){
 auto policy=db.query("SELECT required,revision FROM center_consent_policy WHERE id=1")[0];
 if(centerAccess(db).value("version",1)==2)policy["required"]=true;
 policy["templates"]=db.query("SELECT document_type,title,content,version,required FROM center_consent_templates ORDER BY document_type");
 return policy;
}
J patientConsentPolicy(DB&db,const J&u,const std::string&method,const J&body){
 allow(u,{"admin","reception","psychologist"});
 if(method=="GET")return currentConsentPolicy(db);
 allow(u,{"admin"});check(method=="PATCH","Метод не дозволений",405);
 auto current=currentConsentPolicy(db);
 check(num(body,"revision")==current["revision"],"Правила згод змінено. Відкрийте актуальну версію.",409);
 check(body.contains("required")&&body["required"].is_boolean(),"Укажіть стан перевірки згод");
 check(centerAccess(db).value("version",1)!=2||body["required"].get<bool>(),"У керованому центрі підписані згоди обов’язкові",403);
 check(body.contains("templates")&&body["templates"].is_array()&&body["templates"].size()<=4,"Некоректні шаблони згод");
 std::vector<std::string> seen;
 for(const auto&entry:body["templates"]){
  auto type=str(entry,"document_type",40),title=str(entry,"title",200),content=str(entry,"content",30000,false);
  check(std::find(seen.begin(),seen.end(),type)==seen.end(),"Тип згоди повторюється");seen.push_back(type);
  check(type=="informed_consent"||type=="data_processing"||type=="center_rules"||type=="family_consent","Некоректний тип згоди");
  check(entry.contains("required")&&entry["required"].is_boolean(),"Позначте обов’язковість згоди");
  if(body["required"].get<bool>()&&entry["required"].get<bool>())check(content.size()>=20,"Спочатку затвердьте повний текст обов’язкової згоди");
  auto previous=db.query("SELECT title,content,required,version FROM center_consent_templates WHERE document_type=?",{type});
  int version=previous.empty()?1:previous[0]["version"].get<int>()+(previous[0]["title"]!=title||previous[0]["content"]!=content||previous[0]["required"]!=entry["required"]?1:0);
  db.query("INSERT INTO center_consent_templates(document_type,title,content,version,required) VALUES(?,?,?,?,?) ON CONFLICT(document_type) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,version=EXCLUDED.version,required=EXCLUDED.required",{type,title,content,version,entry["required"]});
 }
 if(body["required"].get<bool>()){
  const auto all=db.query("SELECT content FROM center_consent_templates WHERE required=TRUE");
  check(!all.empty(),"Оберіть хоча б одну обов’язкову згоду");
  for(const auto&entry:all)check(entry["content"].get<std::string>().size()>=20,"Затвердьте текст кожної обов’язкової згоди");
 }
 auto changed=db.query("UPDATE center_consent_policy SET required=?,revision=revision+1 WHERE id=1 AND revision=? RETURNING revision",{body["required"],num(body,"revision")});check(!changed.empty(),"Правила згод змінено іншим адміністратором",409);
 audit(db,u,"configure","consent_policy",1);return currentConsentPolicy(db);
}
void validateRegistrationConsents(DB&db,const J&body){
 db.query("SELECT id FROM center_consent_policy WHERE id=1 FOR SHARE");
 const auto policy=currentConsentPolicy(db);
 auto submitted=body.value("consents",J::array());
 check(submitted.is_array()&&submitted.size()<=8,"Некоректні згоди");
 if(!policy["required"].get<bool>())return;
 check(!submitted.empty(),"Реєстрацію не завершено: роздрукуйте, підпишіть і завантажте обов’язкові згоди",428);
 for(const auto&rule:policy["templates"]){
  if(!rule["required"].get<bool>())continue;
  check(rule["content"].get<std::string>().size()>=20,"Адміністратор має затвердити тексти згод центру",409);
  int found=0;
  for(const auto&document:submitted)if(document.value("document_type",std::string())==rule["document_type"].get<std::string>()){
   ++found;
   check(document.value("status",std::string())=="signed"&&document.value("source",std::string())=="paper_scan"&&document.value("paper_signed",false),"Потрібен перевірений скан власноруч підписаної згоди",428);
   check(num(document,"consent_version")==rule["version"]&&str(document,"content",30000)==rule["content"].get<std::string>(),"Текст згоди оновлено. Роздрукуйте актуальний бланк",409);
   check(str(document,"signed_patient_name",150)==str(body,"name",150)&&str(document,"signed_patient_dob",10)==str(body,"dob",10),"Підписана згода оформлена на інші реєстраційні дані",409);
   check(std::regex_match(str(document,"registration_reference",80),std::regex("[a-zA-Z0-9-]{16,80}")),"Роздрукуйте бланк перед скануванням");
   str(document,"signed_by_name",200);imageData(str(document,"scan_data",6000000));imageData(str(document,"original_data",6000000));
  }
  check(found==1,"Відсутня або повторюється обов’язкова згода",428);
 }
}
J patientConsentStatus(DB&db,int patientId){
 auto policy=currentConsentPolicy(db);J missing=J::array();
 auto patient=db.query("SELECT name,dob FROM patients WHERE id=?",{patientId})[0];
 auto identity=digest(patient["name"].get<std::string>()+"\n"+patient["dob"].get<std::string>());
 for(const auto&rule:policy["templates"])if(rule["required"].get<bool>()){
  auto rows=db.query("SELECT d.id FROM patient_documents d JOIN patients p ON p.id=d.patient_id WHERE d.patient_id=? AND d.document_type=? AND d.status='signed' AND d.consent_version=? AND d.patient_identity_hash=? AND d.source='paper_scan' AND d.paper_signed=TRUE LIMIT 1",{patientId,rule["document_type"],rule["version"],identity});
  if(rows.empty())missing.push_back(rule["title"]);
 }
 return {{"complete",missing.empty()},{"enforced",policy["required"]},{"missing",missing}};
}
