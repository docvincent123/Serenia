#pragma once
J savePatientDocument(DB&db,const J&u,int pid,const J&b){
 auto patient=getPatient(db,u,pid);
 const int consentVersion=b.value("consent_version",0);
 if(consentVersion>0){
  const auto policy=currentConsentPolicy(db);
  bool matched=false;for(const auto&rule:policy["templates"])
   if(rule["document_type"]==b.value("document_type",std::string())&&rule["version"]==consentVersion&&rule["content"]==b.value("content",std::string()))matched=true;
  check(matched,"Згода має відповідати затвердженій версії центру",409);
 }
auto type=str(b,"document_type",40),title=str(b,"title",200),content=str(b,"content",30000,false),status=str(b,"status",20),signedName=str(b,"signed_by_name",200,false),signature=str(b,"signature_data",2000000,false);check(type=="informed_consent"||type=="data_processing"||type=="center_rules"||type=="family_consent"||type=="service_refusal"||type=="other","Некоректний тип документа");check(status=="signed"||status=="refused","Некоректний статус документа");auto source=str(b,"source",20,false);if(source.empty())source="digital";
check(source=="digital"||source=="paper_scan","Некоректне джерело документа");
auto scan=str(b,"scan_data",6000000,false),original=str(b,"original_data",6000000,false);
check(!b.contains("paper_signed")||b["paper_signed"].is_boolean(),"Перевірте підтвердження підпису");
bool paperSigned=b.value("paper_signed",false);
if(source=="paper_scan"){
 imageData(scan);imageData(original);
 check(signature.empty(),"Паперовий документ не потребує цифрового підпису");
 if(status=="signed")check(paperSigned&&!signedName.empty(),"Перевірте підпис на папері та вкажіть ПІБ підписанта");
}else{
 check(scan.empty()&&original.empty()&&!paperSigned,"Вкладення доступні для паперового документа");
 if(status=="signed"){check(!signedName.empty(),"Вкажіть ПІБ підписанта");imageData(signature);}
}auto centerRows=db.query("SELECT center_name,address,phone,email FROM center_settings WHERE id=1");auto center=centerRows.empty()?J::object():centerRows[0];auto signedAt=now();db.query("INSERT INTO patient_documents(patient_id,document_type,title,content,status,signed_by_name,signature_data,signed_at,patient_name,patient_no_snapshot,patient_dob,patient_category,center_name_snapshot,center_address_snapshot,center_phone_snapshot,center_email_snapshot,created_by,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",{pid,type,title,content,status,signedName,signature,signedAt,patient["name"],patient["patient_no"],patient["dob"],patient["category"],center.value("center_name",std::string("Lemvori Care")),center.value("address",std::string{}),center.value("phone",std::string{}),center.value("email",std::string{}),u["id"],signedAt});int id=db.id();db.query("UPDATE patient_documents SET source=?,scan_data=?,original_data=?,paper_signed=? WHERE id=?",{source,scan,original,paperSigned,id});db.query("UPDATE patient_documents SET consent_version=?,registration_reference=?,patient_identity_hash=? WHERE id=?",{b.value("consent_version",0),str(b,"registration_reference",80,false),digest(patient["name"].get<std::string>()+"\n"+patient["dob"].get<std::string>()),id});audit(db,u,"create","patient_document",id);return {{"id",id},{"signed_at",signedAt},{"patient_name",patient["name"]},{"patient_no_snapshot",patient["patient_no"]}};
}
