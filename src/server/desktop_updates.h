#pragma once
// Administrator-published, immutable packages. Metadata changes share the API transaction.
J desktopUpdates(DB&db,const J&u,const httplib::Request&r,const J&b){
 const auto method=r.method;
 auto platform=method=="POST"?str(b,"platform",20):r.get_param_value("platform");
 if(method=="GET"&&r.path=="/api/desktop-updates"&&platform.empty())
   return db.query("SELECT platform,version,sha256,filename,size_bytes,release_notes,published FROM desktop_updates ORDER BY platform");
 check(platform=="windows"||platform=="linux","Оберіть Windows або Linux");
 auto rows=db.query("SELECT platform,version,sha256,filename,size_bytes,release_notes,published FROM desktop_updates WHERE platform=?",{platform});
 auto configured=environmentUtf8("SOLVIA_DESKTOP_UPDATE_DIR");
#ifdef _WIN32
 if(configured.empty()){auto data=environmentUtf8("ProgramData");check(!data.empty(),"Немає ProgramData",500);configured=data+"/QureMed/Solvia/desktop-updates";}
#else
 if(configured.empty())configured="/var/lib/solvia/desktop-updates";
#endif
 const auto root=std::filesystem::path(configured);
 if(r.path=="/api/desktop-updates/package"){
   check(method=="GET","Метод не дозволений",405);check(!rows.empty(),"Оновлення відкликане або ще не опубліковане",404);
   auto sha=r.get_param_value("sha");check(sha==rows[0]["sha256"],"Опис оновлення змінився. Перевірте ще раз",409);
   const auto file=root/(sha+(platform=="windows"?".exe":".tar.gz"));check(std::filesystem::is_regular_file(file),"Пакет відсутній на сервері",404);
   return {{"desktop_file",file.string()},{"filename",rows[0]["filename"]},{"content_type",platform=="windows"?"application/vnd.microsoft.portable-executable":"application/gzip"}};
 }
 if(method=="GET"){if(rows.empty())return {{"available",false},{"platform",platform}};auto result=rows[0];result["available"]=true;return result;}
 allow(u,{"admin"});
 if(method=="DELETE"){db.query("DELETE FROM desktop_updates WHERE platform=?",{platform});audit(db,u,"withdraw","desktop_update",0);return {{"ok",true}};}
 check(method=="POST","Метод не дозволений",405);
 auto version=str(b,"version",30),sha=str(b,"sha256",64),encoded=str(b,"package_base64",44739244);
 check(std::regex_match(version,std::regex("(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})")),"Версія: наприклад 2.5.2");
 check(std::regex_match(sha,std::regex("[a-f0-9]{64}")),"Некоректна контрольна сума");
 auto versionParts=[](const std::string&v){std::vector<int> parts;std::istringstream input(v);std::string part;while(std::getline(input,part,'.'))parts.push_back(std::stoi(part));return parts;};
 if(!rows.empty())check(versionParts(version)>versionParts(rows[0]["version"].get<std::string>())||(version==rows[0]["version"]&&sha==rows[0]["sha256"]),"Версія має бути новішою за опубліковану",409);
 check(!encoded.empty()&&encoded.size()%4==0&&encoded.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")==std::string::npos,"Некоректний пакет");
 auto padding=encoded.find('=');check(padding==std::string::npos||(padding>=encoded.size()-2&&encoded.find_first_not_of("=",padding)==std::string::npos),"Некоректний пакет");
 std::vector<unsigned char> data(encoded.size());int size=EVP_DecodeBlock(data.data(),reinterpret_cast<const unsigned char*>(encoded.data()),static_cast<int>(encoded.size()));
 if(encoded.back()=='=')--size;if(encoded.size()>1&&encoded[encoded.size()-2]=='=')--size;
 check(size>=4&&size<=32*1024*1024,"Пакет: максимум 32 МБ");
 check(platform=="windows"?(data[0]=='M'&&data[1]=='Z'):(data[0]==0x1f&&data[1]==0x8b),"Оберіть EXE для Windows або tar.gz для Linux");
 auto bytes=std::string(reinterpret_cast<const char*>(data.data()),size);check(digest(bytes)==sha,"Контрольна сума пакета не збігається");
 const auto filename="SOLVIA-"+version+(platform=="windows"?"-Windows-x64.exe":"-Linux-x64.tar.gz");
 std::filesystem::create_directories(root);const auto file=root/(sha+(platform=="windows"?".exe":".tar.gz"));
 if(!std::filesystem::exists(file)){auto temp=root/(sha+".part");std::ofstream output(temp,std::ios::binary);output.write(bytes.data(),bytes.size());output.close();check(output.good(),"Не вдалося зберегти пакет",500);std::filesystem::rename(temp,file);}
 db.query("INSERT INTO desktop_updates(platform,version,sha256,filename,size_bytes,release_notes,published,published_by) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(platform) DO UPDATE SET version=EXCLUDED.version,sha256=EXCLUDED.sha256,filename=EXCLUDED.filename,size_bytes=EXCLUDED.size_bytes,release_notes=EXCLUDED.release_notes,published=EXCLUDED.published,published_by=EXCLUDED.published_by",{platform,version,sha,filename,size,str(b,"release_notes",3000,false),now(),u["id"]});
 audit(db,u,"publish","desktop_update",0);return {{"ok",true},{"version",version},{"platform",platform}};
}
