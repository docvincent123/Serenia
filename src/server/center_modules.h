#pragma once
bool centerModuleEnabled(DB&db,const std::string&name,const J&access){
 if(name.empty())return true;
 bool licensed=!access.contains("modules");
 if(access.contains("modules"))for(const auto&entry:access["modules"])if(entry==name)licensed=true;
 if(!licensed)return false;
 for(const auto&module:careModuleCatalog())if(module["id"]==name&&module["core"].get<bool>())return true;
 auto rows=db.query("SELECT enabled FROM center_modules WHERE module=?",{name});
 return rows.empty()||rows[0]["enabled"].get<bool>();
}
J centerModules(DB&db,const J&u,const std::string&method,const J&body){
 auto access=centerAccess(db);
 if(method!="GET"){
  allow(u,{"admin"});check(method=="PATCH","Метод не дозволений",405);
  check(body.contains("enabled")&&body["enabled"].is_array()&&body["enabled"].size()<=careModuleCatalog().size(),"Оберіть модулі центру");
  const auto&enabled=body["enabled"];
  for(const auto&name:enabled){bool known=false;for(const auto&module:careModuleCatalog())if(module["id"]==name)known=true;check(known,"Невідомий модуль");}
  for(const auto&module:careModuleCatalog()){
   bool wanted=std::find(enabled.begin(),enabled.end(),module["id"])!=enabled.end();
   check(!module["core"].get<bool>()||wanted,"Базовий модуль не можна вимкнути");
   if(wanted){
    bool licensed=!access.contains("modules")||std::find(access["modules"].begin(),access["modules"].end(),module["id"])!=access["modules"].end();
    check(licensed,"Модуль відсутній у ліцензії",403);
    for(const auto&dependency:module["depends"])check(std::find(enabled.begin(),enabled.end(),dependency)!=enabled.end(),"Увімкніть залежності модуля");
   }
  }
  for(const auto&module:careModuleCatalog())db.query("INSERT INTO center_modules(module,enabled) VALUES(?,?) ON CONFLICT(module) DO UPDATE SET enabled=EXCLUDED.enabled",{module["id"],std::find(enabled.begin(),enabled.end(),module["id"])!=enabled.end()});
  audit(db,u,"configure","center_modules",0);
 }
 J rows=careModuleCatalog();
 for(auto&module:rows){
  auto id=module["id"].get<std::string>();
  module["licensed"]=!access.contains("modules")||std::find(access["modules"].begin(),access["modules"].end(),module["id"])!=access["modules"].end();
  module["enabled"]=centerModuleEnabled(db,id,access);
 }
 return {{"modules",rows},{"license",access}};
}
