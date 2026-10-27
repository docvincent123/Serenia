// Reusable centre-authored text templates; no clinical data is stored here.
J documentTemplateApi(DB&db,const J&u,const httplib::Request&r,const J&b){
 const auto& path=r.path;const auto& method=r.method;
 allow(u,{"admin","reception","psychologist"});
 if(path=="/api/document-templates"){
  if(method=="GET"){
   return u["role"]=="admin"?
    db.query("SELECT id,title,content,active,updated FROM center_document_templates ORDER BY active DESC,title"):
    db.query("SELECT id,title,content,active,updated FROM center_document_templates WHERE active=TRUE ORDER BY title");
  }
  allow(u,{"admin"});check(method=="POST","Метод не дозволений",405);
  auto title=str(b,"title",200),content=str(b,"content",30000);
  db.query("INSERT INTO center_document_templates(title,content,active,created_by,updated) VALUES(?,?,TRUE,?,?)",{title,content,u["id"],now()});
  int id=db.id();audit(db,u,"create","document_template",id);return {{"id",id}};
 }
 if(std::regex_match(path,std::regex("/api/document-templates/[0-9]+"))){
  allow(u,{"admin"});check(method=="PATCH","Метод не дозволений",405);
  int id=std::stoi(path.substr(24));
  auto rows=db.query("SELECT * FROM center_document_templates WHERE id=?",{id});
  check(!rows.empty(),"Шаблон не знайдено",404);
  auto title=b.contains("title")?str(b,"title",200):rows[0]["title"].get<std::string>();
  auto content=b.contains("content")?str(b,"content",30000):rows[0]["content"].get<std::string>();
  auto active=b.contains("active")?(check(b["active"].is_boolean(),"Некоректний статус шаблону"),b["active"].get<bool>()):rows[0]["active"].get<bool>();
  db.query("UPDATE center_document_templates SET title=?,content=?,active=?,updated=? WHERE id=?",{title,content,active,now(),id});
  audit(db,u,"update","document_template",id);return {{"ok",true}};
 }
 throw Error(404,"Невідомий маршрут");
}
