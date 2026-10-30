// Bounded registration projection; legacy /api/patients remains compatible
// with Android, booking and family selection.
J patientDirectory(DB&db,const J&u,const httplib::Request&r){
 allow(u,{"admin","reception","psychologist"});
 auto integer=[&](const char*key,int fallback,int maximum){
  if(!r.has_param(key))return fallback;
  const auto value=r.get_param_value(key);
  check(!value.empty()&&value.size()<=7&&value.find_first_not_of("0123456789")==std::string::npos,"Некоректна сторінка реєстру");
  const int parsed=std::stoi(value);
  check(parsed>=1&&parsed<=maximum,"Некоректна сторінка реєстру");
  return parsed;
 };
 const int page=integer("page",1,100000),size=integer("page_size",25,100);
 const auto query=r.get_param_value("q");
 check(query.size()<=300&&query.find('\0')==std::string::npos,"Завеликий пошуковий запит");
 const auto status=r.has_param("status")?r.get_param_value("status"):"current";
 check(status=="current"||status=="active"||status=="completed"||status=="archived"||status=="all","Некоректний статус");
 std::string source=" FROM patients p JOIN users u ON u.id=p.psychologist_id LEFT JOIN families f ON f.id=p.family_id WHERE ";
 J args=J::array();
 if(status=="all")source+="TRUE";
 else if(status=="current")source+="p.status<>'archived'";
 else {source+="p.status=?";args.push_back(status);}
 if(u["role"]=="psychologist"){source+=" AND p.psychologist_id=?";args.push_back(u["id"]);}
 if(r.has_param("family_id")){source+=" AND p.family_id=?";args.push_back(integer("family_id",1,1000000));}
 if(!query.empty()){
  source+=" AND (strpos(lower(concat_ws(' ',p.patient_no,p.name,p.phone,p.category,u.name,f.name)),lower(?))>0";
  args.push_back(query);
  std::string digits;bool phoneQuery=true;
  for(unsigned char c:query){
   if(c>='0'&&c<='9')digits+=char(c);
   else if(c!=' '&&c!='+'&&c!='-'&&c!='('&&c!=')'&&c!='.')phoneQuery=false;
  }
  if(phoneQuery&&digits.size()>=3){source+=" OR strpos(regexp_replace(p.phone,'[^0-9]','','g'),?)>0";args.push_back(digits);}
  source+=")";
 }
 const auto total=db.query("SELECT count(*) total"+source,args)[0]["total"];
 args.push_back(size);args.push_back((page-1)*size);
 auto items=db.query("SELECT p.id,p.patient_no,p.name,p.phone,p.dob,p.category,p.status,p.family_role,p.psychologist_id,u.name psychologist,f.name family"+source+" ORDER BY p.created DESC,p.id DESC LIMIT ? OFFSET ?",args);
 return {{"items",items},{"total",total},{"page",page},{"page_size",size}};
}
