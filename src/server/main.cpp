#include <httplib.h>
#include <nlohmann/json.hpp>
#include <libpq-fe.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/crypto.h>
#include <algorithm>
#include <chrono>
#include <ctime>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <vector>
#include <cstdlib>
#include "schema.h"
using J=nlohmann::json;
struct Error:std::runtime_error {int status; Error(int s,const std::string&m):runtime_error(m),status(s){}};
void check(bool yes,const std::string&m,int status=400){if(!yes)throw Error(status,m);}
long long epoch(){return std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
std::string now(){auto t=std::time(nullptr);std::tm tm{};
#ifdef _WIN32
localtime_s(&tm,&t);
#else
localtime_r(&t,&tm);
#endif
char buf[32]{}; std::strftime(buf,sizeof(buf),"%Y-%m-%dT%H:%M:%S",&tm);return buf;}
std::string hex(const unsigned char*p,size_t n){const char*digits="0123456789abcdef";std::string s;for(size_t i=0;i<n;++i){s+=digits[p[i]>>4];s+=digits[p[i]&15];}return s;}
std::string randomToken(){unsigned char b[32];if(RAND_bytes(b,sizeof b)!=1)throw std::runtime_error("RNG");return hex(b,sizeof b);}
std::string digest(const std::string&s){unsigned char b[EVP_MAX_MD_SIZE];unsigned int n=0;if(!EVP_Digest(s.data(),s.size(),b,&n,EVP_sha256(),nullptr))throw std::runtime_error("Digest");return hex(b,n);}
std::string hashPassword(const std::string&pw,std::string salt=""){if(salt.empty())salt=randomToken();unsigned char b[32];if(!PKCS5_PBKDF2_HMAC(pw.data(),(int)pw.size(),(const unsigned char*)salt.data(),(int)salt.size(),600000,EVP_sha256(),32,b))throw std::runtime_error("PBKDF2");return salt+":"+hex(b,32);}
bool verify(const std::string&pw,const std::string&saved){auto h=hashPassword(pw,saved.substr(0,saved.find(':')));return h.size()==saved.size()&&CRYPTO_memcmp(h.data(),saved.data(),h.size())==0;}
std::string str(const J&b,const char*k,size_t max=10000,bool needed=true){check(b.contains(k)?b[k].is_string():!needed,std::string("Перевірте поле: ")+k);auto s=b.value(k,std::string{});check(s.size()<=max&&(!needed||s.find_first_not_of(" \t\r\n")!=std::string::npos),std::string("Перевірте поле: ")+k);return s;}
int num(const J&b,const char*k){check(b.contains(k)&&b[k].is_number_integer(),std::string("Оберіть поле: ")+k);return b[k].get<int>();}
void validDate(const std::string&s){check(std::regex_match(s,std::regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")),"Дата: YYYY-MM-DD");auto y=std::stoi(s.substr(0,4)),m=std::stoi(s.substr(5,2)),d=std::stoi(s.substr(8,2));check(std::chrono::year_month_day(std::chrono::year(y),std::chrono::month(m),std::chrono::day(d)).ok(),"Некоректна дата");}
void validTime(const std::string&s){check(s.size()==16&&s[10]=='T',"Дата і час: YYYY-MM-DDTHH:MM");validDate(s.substr(0,10));check(std::regex_match(s.substr(11),std::regex("([01][0-9]|2[0-3]):[0-5][0-9]")),"Некоректний час");}
const J categories={"Військовий/військова","Ветеран/ветеранка","Партнер/партнерка","Дитина","Інше"};
const J questions={"Наскільки спокійно ви почуваєтеся сьогодні?","Наскільки відновлювальним був ваш сон?","Скільки сил ви відчуваєте для щоденних справ?"};
class DB{
PGconn* db=nullptr;
int lastId=0;

static std::string placeholders(const std::string&sql){
    std::string out;out.reserve(sql.size()+16);int n=1;
    for(char ch:sql){if(ch=='?'){out+='$';out+=std::to_string(n++);}else out+=ch;}
    return out;
}
static std::string tableForInsert(const std::string&sql){
    std::smatch m;std::regex r(R"(^\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*))",std::regex::icase);
    return std::regex_search(sql,m,r)?m[1].str():"";
}
static bool hasSerialId(const std::string&table){
    static const std::vector<std::string> tables={"users","families","patients","rooms","appointments","consultations","assessments","audit","outbox"};
    return std::find(tables.begin(),tables.end(),table)!=tables.end();
}
static std::string arg(const J&v){
    if(v.is_boolean())return v.get<bool>()?"true":"false";
    if(v.is_number_integer())return std::to_string(v.get<long long>());
    if(v.is_number_float())return std::to_string(v.get<double>());
    if(v.is_string())return v.get<std::string>();
    return {};
}
void ensure(PGresult*r,const char*context){
    if(!r)throw std::runtime_error(std::string(context)+": PostgreSQL returned no result");
    auto status=PQresultStatus(r);
    if(status==PGRES_COMMAND_OK||status==PGRES_TUPLES_OK)return;
    const char*state=PQresultErrorField(r,PG_DIAG_SQLSTATE);
    std::string stateCode=state?state:"";
    std::string message=PQresultErrorMessage(r)?PQresultErrorMessage(r):context;
    PQclear(r);
    if(stateCode.rfind("23",0)==0)throw Error(409,"Такий запис уже існує або пов’язані дані некоректні");
    throw std::runtime_error(std::string(context)+": "+message);
}
public:
explicit DB(const std::string&connection){
    db=PQconnectdb(connection.c_str());
    if(!db||PQstatus(db)!=CONNECTION_OK){
        std::string message=db?PQerrorMessage(db):"PostgreSQL connection failed";
        if(db){PQfinish(db);db=nullptr;}
        throw std::runtime_error(message);
    }
    exec(Schema);
}
~DB(){if(db)PQfinish(db);}
DB(const DB&)=delete;
void exec(const std::string&s){
    PGresult*r=PQexec(db,s.c_str());
    ensure(r,"Database operation failed");
    PQclear(r);
}
J query(const std::string&s,const J&args=J::array()){
    std::string sql=s;
    auto table=tableForInsert(sql);
    bool autoReturn=hasSerialId(table)&&sql.find("RETURNING")==std::string::npos&&sql.find("returning")==std::string::npos;
    if(autoReturn)sql+=" RETURNING id";
    sql=placeholders(sql);

    std::vector<std::string> storage;storage.reserve(args.size());
    std::vector<const char*> values;values.reserve(args.size());
    for(const auto&a:args){
        if(a.is_null()){storage.emplace_back();values.push_back(nullptr);}
        else{storage.push_back(arg(a));values.push_back(storage.back().c_str());}
    }

    PGresult*r=PQexecParams(db,sql.c_str(),static_cast<int>(values.size()),nullptr,values.data(),nullptr,nullptr,0);
    ensure(r,"Database query failed");
    J rows=J::array();
    if(PQresultStatus(r)==PGRES_TUPLES_OK){
        for(int row=0;row<PQntuples(r);++row){
            J item=J::object();
            for(int col=0;col<PQnfields(r);++col){
                std::string key=PQfname(r,col);
                if(PQgetisnull(r,row,col)){item[key]=nullptr;continue;}
                std::string value=PQgetvalue(r,row,col);
                Oid type=PQftype(r,col);
                try{
                    if(type==16)item[key]=(value=="t"||value=="true"||value=="1");
                    else if(type==20||type==21||type==23)item[key]=std::stoll(value);
                    else if(type==700||type==701||type==1700)item[key]=std::stod(value);
                    else item[key]=value;
                }catch(...){item[key]=value;}
            }
            rows.push_back(item);
        }
    }
    if(autoReturn&&!rows.empty()&&rows[0].contains("id"))lastId=rows[0]["id"].get<int>();
    PQclear(r);
    return rows;
}
int id()const{return lastId;}
};
struct Transaction{DB&db;bool done=false;explicit Transaction(DB&d):db(d){db.exec("BEGIN");}void commit(){db.exec("COMMIT");done=true;}~Transaction(){if(!done)try{db.exec("ROLLBACK");}catch(...){}}};
void allow(const J&u,std::initializer_list<std::string> roles){check(std::find(roles.begin(),roles.end(),u.at("role").get<std::string>())!=roles.end(),"Недостатньо прав",403);}
void audit(DB&d,const J&u,const std::string&event,const std::string&entity,int id){d.query("INSERT INTO audit(user_id,event,entity,entity_id,created) VALUES(?,?,?,?,?)",{u.at("id"),event,entity,id,now()});}
J getPatient(DB&d,const J&u,int id){allow(u,{"admin","reception","psychologist"});auto rows=d.query("SELECT p.*,f.name family FROM patients p LEFT JOIN families f ON f.id=p.family_id WHERE p.id=?",{id});check(!rows.empty(),"Пацієнта не знайдено",404);auto p=rows[0];check(u["role"]!="psychologist"||p["psychologist_id"]==u["id"],"Недостатньо прав",403);return p;}
J book(DB&d,const J&u,const J&b,int id=0){allow(u,{"admin","reception"});int psy=num(b,"psychologist_id"),room=num(b,"room_id");check(!d.query("SELECT id FROM users WHERE id=? AND role='psychologist' AND active=TRUE",{psy}).empty(),"Оберіть психолога");check(!d.query("SELECT id FROM rooms WHERE id=?",{room}).empty(),"Оберіть кабінет");auto start=str(b,"start",16),end=str(b,"end",16),kind=str(b,"kind",20);validTime(start);validTime(end);check(start<end&&start.substr(0,10)==end.substr(0,10),"Кінець має бути пізніше початку в межах дня");check(start.substr(11)>="08:00"&&end.substr(11)<="20:00","Години роботи: 08:00–20:00");check(b.contains("patient_ids")&&b["patient_ids"].is_array()&&!b["patient_ids"].empty()&&b["patient_ids"].size()<=30,"Оберіть від 1 до 30 учасників");auto ids=b["patient_ids"];check(kind=="group"||(kind=="individual"&&ids.size()==1),"Некоректний тип запису");if(id){auto old=d.query("SELECT status FROM appointments WHERE id=?",{id});check(!old.empty(),"Запис не знайдено",404);check(old[0]["status"]=="scheduled"&&d.query("SELECT id FROM consultations WHERE appointment_id=?",{id}).empty(),"Цей запис уже не можна переносити",409);}
check(d.query("SELECT id FROM appointments WHERE status!='cancelled' AND id!=? AND start<? AND \"end\">? AND (psychologist_id=? OR room_id=?)",{id,end,start,psy,room}).empty(),"Психолог або кабінет уже зайняті",409);
for(auto&pid:ids){check(pid.is_number_integer(),"Некоректний учасник");auto p=getPatient(d,u,pid.get<int>());check(p["psychologist_id"]==psy,"Психолог має бути призначений усім учасникам");check(d.query("SELECT a.id FROM appointments a JOIN attendees t ON a.id=t.appointment_id WHERE t.patient_id=? AND a.status!='cancelled' AND a.id!=? AND a.start<? AND a.\"end\">?",{pid,id,end,start}).empty(),"Пацієнт має інший запис у цей час",409);}
if(id){d.query("UPDATE appointments SET psychologist_id=?,room_id=?,start=?,\"end\"=?,kind=? WHERE id=?",{psy,room,start,end,kind,id});d.query("DELETE FROM attendees WHERE appointment_id=?",{id});}else{d.query("INSERT INTO appointments(psychologist_id,room_id,start,\"end\",kind,created) VALUES(?,?,?,?,?,?)",{psy,room,start,end,kind,now()});id=d.id();}
for(auto&pid:ids)d.query("INSERT INTO attendees VALUES(?,?)",{id,pid});audit(d,u,"save","appointment",id);d.query("INSERT INTO outbox(event,payload,created) VALUES(?,?,?)",{"appointment.saved",J({{"appointment_id",id}}).dump(),now()});return {{"id",id}};}

struct App{DB db;std::mutex mutex;std::map<std::string,std::vector<long long>> attempts;explicit App(const std::string&file):db(file){}
J route(const httplib::Request&r){std::lock_guard<std::mutex> lock(mutex);Transaction tx(db);auto result=dispatch(r);tx.commit();return result;}
J dispatch(const httplib::Request&r){auto path=r.path,method=r.method;J b=J::object();if(method!="GET"){check(r.get_header_value("Content-Type").find("application/json")==0,"Потрібен JSON",415);try{b=J::parse(r.body);}catch(...){throw Error(400,"Некоректний JSON");}check(b.is_object(),"Очікується JSON-об’єкт");}
if(path=="/api/login"&&method=="POST"){auto&v=attempts[r.remote_addr];auto t=epoch();std::erase_if(v,[&](auto x){return t-x>300;});check(v.size()<10,"Забагато спроб. Зачекайте 5 хвилин.",429);v.push_back(t);auto login=str(b,"login",100),pw=str(b,"password",256);auto rows=db.query("SELECT * FROM users WHERE login=? AND active=TRUE",{login});auto dummy=std::string(64,'0')+":"+std::string(64,'0');bool ok=verify(pw,rows.empty()?dummy:rows[0]["password"].get<std::string>());check(!rows.empty()&&ok,"Неправильний логін або пароль",401);auto u=rows[0];auto token=randomToken();db.query("DELETE FROM sessions WHERE expires<?",{epoch()});db.query("INSERT INTO sessions VALUES(?,?,?,?)",{digest(token),u["id"],"",epoch()+28800});audit(db,u,"login","user",u["id"]);return {{"token",token},{"user",{{"id",u["id"]},{"name",u["name"]},{"role",u["role"]}}}};}
if(path.rfind("/api/respond/",0)==0){auto token=path.substr(13);check(token.size()==64,"Недійсне посилання",404);auto rows=db.query("SELECT * FROM assessments WHERE token=? AND expires>? AND completed IS NULL",{digest(token),epoch()});check(!rows.empty(),"Посилання недійсне, прострочене або використане",404);if(method=="GET")return {{"questions",questions},{"title","Самопочуття сьогодні"},{"description","Авторська анкета самоспостереження, не діагностична шкала. 0 — найнижче, 10 — найвище."}};check(method=="POST","Метод не дозволений",405);check(b.contains("answers")&&b["answers"].is_array()&&b["answers"].size()==3,"Потрібно три відповіді");int score=0;for(auto&a:b["answers"]){check(a.is_number_integer()&&a>=0&&a<=10,"Відповіді: 0–10");score+=a.get<int>();}db.query("UPDATE assessments SET answers=?,score=?,completed=? WHERE id=?",{b["answers"].dump(),score,now(),rows[0]["id"]});return {{"ok",true}};}
auto bearer=r.get_header_value("Authorization");check(bearer.rfind("Bearer ",0)==0,"Увійдіть у систему",401);auto token=digest(bearer.substr(7));auto rows=db.query("SELECT u.id,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=TRUE",{token,epoch()});check(!rows.empty(),"Сесія завершилася. Увійдіть знову.",401);auto u=rows[0];
if(path=="/api/me"&&method=="GET")return u;
if(path=="/api/logout"&&method=="POST"){db.query("DELETE FROM sessions WHERE token=?",{token});return {{"ok",true}};}
if(path=="/api/meta"&&method=="GET")return {{"psychologists",db.query("SELECT id,name FROM users WHERE role='psychologist' AND active=TRUE")},{"rooms",db.query("SELECT * FROM rooms ORDER BY name")},{"categories",categories}};
if(path=="/api/users"){allow(u,{"admin"});if(method=="GET")return db.query("SELECT id,name,login,role,active FROM users ORDER BY name");check(method=="POST","Метод не дозволений",405);auto role=str(b,"role",20);check(role=="admin"||role=="reception"||role=="psychologist"||role=="director","Невідома роль");auto pw=str(b,"password",256);check(pw.size()>=12,"Пароль: мінімум 12 символів");db.query("INSERT INTO users(name,login,password,role) VALUES(?,?,?,?)",{str(b,"name",150),str(b,"login",100),hashPassword(pw),role});auto id=db.id();audit(db,u,"create","user",id);return {{"id",id}};}
if(std::regex_match(path,std::regex("/api/users/[0-9]+"))&&method=="PATCH"){allow(u,{"admin"});int id=std::stoi(path.substr(11));auto target=db.query("SELECT id,name,login,role,active FROM users WHERE id=?",{id});check(!target.empty(),"Працівника не знайдено",404);auto current=target[0];auto role=b.contains("role")?str(b,"role",20):current["role"].get<std::string>();check(role=="admin"||role=="reception"||role=="psychologist"||role=="director","Невідома роль");bool active=b.contains("active")?(check(b["active"].is_boolean(),"Некоректний статус"),b["active"].get<bool>()):current["active"].get<bool>();auto name=b.contains("name")?str(b,"name",150):current["name"].get<std::string>();if(current["role"]=="admin"&&(role!="admin"||!active)){auto count=db.query("SELECT count(*) n FROM users WHERE role='admin' AND active=TRUE")[0]["n"].get<long long>();check(count>1,"Не можна вимкнути або змінити роль останнього адміністратора",409);}check(!(id==u["id"].get<int>()&&!active),"Не можна вимкнути власний обліковий запис",409);db.query("UPDATE users SET name=?,role=?,active=? WHERE id=?",{name,role,active,id});if(b.contains("password")){auto pw=str(b,"password",256,false);if(!pw.empty()){check(pw.size()>=12,"Пароль: мінімум 12 символів");db.query("UPDATE users SET password=? WHERE id=?",{hashPassword(pw),id});}}audit(db,u,"update","user",id);return {{"ok",true}};}
if(path=="/api/rooms"&&method=="POST"){allow(u,{"admin"});db.query("INSERT INTO rooms(name) VALUES(?)",{str(b,"name",100)});auto id=db.id();audit(db,u,"create","room",id);return {{"id",id}};}
if(path=="/api/families"){allow(u,{"admin","reception"});if(method=="GET")return db.query("SELECT * FROM families ORDER BY name");check(method=="POST","Метод не дозволений",405);db.query("INSERT INTO families(name) VALUES(?)",{str(b,"name",150)});auto id=db.id();audit(db,u,"create","family",id);return {{"id",id}};}
if(path=="/api/patients"){allow(u,{"admin","reception","psychologist"});if(method=="GET")return db.query("SELECT p.*,u.name psychologist,f.name family FROM patients p JOIN users u ON u.id=p.psychologist_id LEFT JOIN families f ON f.id=p.family_id"+std::string(u["role"]=="psychologist"?" WHERE p.psychologist_id=?":"")+" ORDER BY p.created DESC",u["role"]=="psychologist"?J::array({u["id"]}):J::array());check(method=="POST","Метод не дозволений",405);allow(u,{"admin","reception"});auto name=str(b,"name",150),dob=str(b,"dob",10),phone=str(b,"phone",30),cat=str(b,"category",80);validDate(dob);check(dob>="1900-01-01"&&dob<=now().substr(0,10),"Перевірте дату народження");auto digits=std::count_if(phone.begin(),phone.end(),[](unsigned char c){return c>='0'&&c<='9';});check(digits>=7&&digits<=15,"Перевірте номер телефону");check(std::find(categories.begin(),categories.end(),cat)!=categories.end(),"Оберіть категорію");int psy=num(b,"psychologist_id");check(!db.query("SELECT id FROM users WHERE id=? AND role='psychologist' AND active=TRUE",{psy}).empty(),"Оберіть психолога");check(db.query("SELECT id FROM patients WHERE name=? AND dob=? AND phone=?",{name,dob,phone}).empty(),"Пацієнт із такими даними вже існує",409);J fid=b.value("family_id",J(nullptr));check(fid.is_null()||fid.is_number_integer(),"Некоректна сім’я");db.query("INSERT INTO patients(name,phone,dob,category,psychologist_id,family_id,family_role,created) VALUES(?,?,?,?,?,?,?,?)",{name,phone,dob,cat,psy,fid,str(b,"family_role",80,false),now()});auto id=db.id();audit(db,u,"create","patient",id);return {{"id",id}};}
if(std::regex_match(path,std::regex("/api/patients/[0-9]+"))&&method=="GET"){int id=std::stoi(path.substr(14));auto p=getPatient(db,u,id);if(u["role"]=="psychologist"){p["consultations"]=db.query("SELECT * FROM consultations WHERE patient_id=? AND psychologist_id=? ORDER BY id DESC",{id,u["id"]});p["assessments"]=db.query("SELECT id,created,completed,score,answers FROM assessments WHERE patient_id=? AND psychologist_id=? ORDER BY id",{id,u["id"]});}audit(db,u,"read","patient",id);return p;}
if(path=="/api/appointments"){allow(u,{"admin","reception","psychologist"});if(method=="POST")return book(db,u,b);check(method=="GET","Метод не дозволений",405);auto day=r.has_param("date")?r.get_param_value("date"):now().substr(0,10);validDate(day);J args={day};std::string sql="SELECT a.*,u.name psychologist,r.name room FROM appointments a JOIN users u ON u.id=a.psychologist_id JOIN rooms r ON r.id=a.room_id WHERE substr(start,1,10)=?";if(u["role"]=="psychologist"){sql+=" AND a.psychologist_id=?";args.push_back(u["id"]);}auto apps=db.query(sql+" ORDER BY start",args);for(auto&a:apps)a["patients"]=db.query("SELECT p.id,p.name FROM attendees t JOIN patients p ON p.id=t.patient_id WHERE t.appointment_id=?",{a["id"]});return apps;}
if(std::regex_match(path,std::regex("/api/appointments/[0-9]+"))&&method=="PATCH"){allow(u,{"admin","reception"});int id=std::stoi(path.substr(18));if(b.value("status","")=="cancelled"){auto a=db.query("SELECT status FROM appointments WHERE id=?",{id});check(!a.empty(),"Запис не знайдено",404);check(a[0]["status"]=="scheduled"&&db.query("SELECT id FROM consultations WHERE appointment_id=?",{id}).empty(),"Проведений або частково проведений запис не можна скасувати",409);db.query("UPDATE appointments SET status='cancelled' WHERE id=?",{id});audit(db,u,"cancel","appointment",id);return {{"ok",true}};}return book(db,u,b,id);}
if(path=="/api/slots"&&method=="GET"){allow(u,{"admin","reception"});auto day=r.get_param_value("date");validDate(day);int psy=std::stoi(r.get_param_value("psychologist_id")),room=std::stoi(r.get_param_value("room_id"));auto busy=db.query("SELECT start,\"end\" FROM appointments WHERE status!='cancelled' AND substr(start,1,10)=? AND (psychologist_id=? OR room_id=?)",{day,psy,room});J slots=J::array();for(int h=8;h<20;++h){auto hh=[](int v){return std::string(v<10?"0":"")+std::to_string(v)+":00";};auto s=day+"T"+hh(h),e=day+"T"+hh(h+1);bool free=true;for(auto&a:busy)if(a["start"].get<std::string>()<e&&a["end"].get<std::string>()>s)free=false;if(free)slots.push_back(hh(h));}return slots;}
if(path=="/api/consultations"&&method=="POST"){allow(u,{"psychologist"});int pid=num(b,"patient_id"),aid=num(b,"appointment_id");getPatient(db,u,pid);auto apps=db.query("SELECT a.* FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE a.id=? AND a.psychologist_id=? AND t.patient_id=? AND a.status='scheduled'",{aid,u["id"],pid});check(!apps.empty(),"Немає доступного запису для консультації",403);check(apps[0]["start"].get<std::string>()<=now().substr(0,16),"Майбутню консультацію ще не можна завершити");db.query("INSERT INTO consultations(patient_id,psychologist_id,appointment_id,note,goals,next_plan,homework,created) VALUES(?,?,?,?,?,?,?,?)",{pid,u["id"],aid,str(b,"note"),str(b,"goals",10000,false),str(b,"next_plan",10000,false),str(b,"homework",10000,false),now()});int id=db.id();auto count=db.query("SELECT (SELECT count(*) FROM attendees WHERE appointment_id=?) total,(SELECT count(*) FROM consultations WHERE appointment_id=?) done",{aid,aid})[0];if(count["total"]==count["done"])db.query("UPDATE appointments SET status='completed' WHERE id=?",{aid});audit(db,u,"create","consultation",id);return {{"id",id}};}
if(path=="/api/assessments"&&method=="POST"){allow(u,{"psychologist"});int pid=num(b,"patient_id");getPatient(db,u,pid);auto tok=randomToken();db.query("INSERT INTO assessments(patient_id,psychologist_id,token,created,expires) VALUES(?,?,?,?,?)",{pid,u["id"],digest(tok),now(),epoch()+604800});int id=db.id();audit(db,u,"assign","assessment",id);return {{"id",id},{"link","/assessment#"+tok}};}
if(path=="/api/stats"&&method=="GET"){allow(u,{"admin","director"});auto from=r.has_param("from")?r.get_param_value("from"):now().substr(0,8)+"01",to=r.has_param("to")?r.get_param_value("to"):now().substr(0,10);validDate(from);validDate(to);check(from<=to,"Перевірте період");J statuses=J::object();for(auto&a:db.query("SELECT status,count(*) n FROM appointments WHERE substr(start,1,10) BETWEEN ? AND ? GROUP BY status",{from,to}))statuses[a["status"].get<std::string>()]=a["n"];return {{"total_patients",db.query("SELECT count(*) n FROM patients")[0]["n"]},{"new_patients",db.query("SELECT count(*) n FROM patients WHERE substr(created,1,10) BETWEEN ? AND ?",{from,to})[0]["n"]},{"consultations",db.query("SELECT count(*) n FROM consultations WHERE substr(created,1,10) BETWEEN ? AND ?",{from,to})[0]["n"]},{"repeat_visits",db.query("SELECT count(*) n FROM consultations c WHERE substr(c.created,1,10) BETWEEN ? AND ? AND EXISTS(SELECT 1 FROM consultations old WHERE old.patient_id=c.patient_id AND old.id<c.id)",{from,to})[0]["n"]},{"appointments",statuses},{"load",db.query("SELECT u.name,count(a.id) appointments,coalesce(round((sum(extract(epoch from (a.\"end\"::timestamp-a.start::timestamp)))/3600.0)::numeric,1),0) hours FROM users u LEFT JOIN appointments a ON a.psychologist_id=u.id AND a.status!='cancelled' AND substr(a.start,1,10) BETWEEN ? AND ? WHERE u.role='psychologist' GROUP BY u.id",{from,to})}};}
if(path=="/api/audit"&&method=="GET"){allow(u,{"admin"});return db.query("SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100");}
throw Error(404,"Не знайдено");}
};

const char* assessmentHtml=R"HTML(<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SOLVIA • Самопочуття</title><link rel="stylesheet" href="/assessment.css"><main><small>SOLVIA by QureMed</small><h1>Як ви сьогодні?</h1><p>Авторська анкета самоспостереження. Це не діагностична шкала. 0 — найнижче, 10 — найвище.</p><form id="form"></form><p id="status" role="status"></p></main><script src="/assessment.js"></script></html>)HTML";
const char* assessmentJs=R"JS('use strict';const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const form=document.querySelector('#form'),status=document.querySelector('#status');async function call(method,body){const r=await fetch('/api/respond/'+token,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(j.error);return j;}call('GET').then(j=>{j.questions.forEach((q,i)=>{let label=document.createElement('label');label.textContent=q;let input=document.createElement('select');input.name='q'+i;input.required=true;let empty=new Option('Оберіть відповідь','');input.add(empty);for(let n=0;n<=10;n++)input.add(new Option(n,n));label.append(input);form.append(label)});const b=document.createElement('button');b.textContent='Зберегти відповіді';form.append(b)}).catch(e=>status.textContent=e.message);form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;try{await call('POST',{answers:[...form.querySelectorAll('select')].map(x=>Number(x.value))});form.replaceChildren();status.textContent='Дякуємо. Ваші відповіді збережено.'}catch(e){status.textContent=e.message;b.disabled=false}};)JS";
void serve(App&app,httplib::Server&server,const std::string&host,int port,const std::string&uiDir){server.set_payload_max_length(65536);server.set_read_timeout(10,0);server.set_write_timeout(10,0);server.set_default_headers({{"Cache-Control","no-store"},{"X-Content-Type-Options","nosniff"},{"Referrer-Policy","no-referrer"},{"Content-Security-Policy","default-src 'self'; frame-ancestors 'none'; base-uri 'none'"},{"Access-Control-Allow-Origin","http://app.solvia.local"},{"Access-Control-Allow-Headers","Authorization, Content-Type"},{"Access-Control-Allow-Methods","GET, POST, PATCH, OPTIONS"}});
auto handler=[&](const httplib::Request&r,httplib::Response&res){try{res.set_content(app.route(r).dump(),"application/json; charset=utf-8");}catch(const Error&e){res.status=e.status;res.set_content(J({{"error",e.what()}}).dump(),"application/json; charset=utf-8");}catch(const J::exception&){res.status=400;res.set_content(J({{"error","Некоректні поля запиту"}}).dump(),"application/json; charset=utf-8");}catch(const std::invalid_argument&){res.status=400;res.set_content(J({{"error","Некоректний ідентифікатор"}}).dump(),"application/json; charset=utf-8");}catch(const std::out_of_range&){res.status=400;res.set_content(J({{"error","Значення поза допустимими межами"}}).dump(),"application/json; charset=utf-8");}catch(const std::exception&){res.status=500;res.set_content(J({{"error","Внутрішня помилка сервера"}}).dump(),"application/json; charset=utf-8");}};
server.Options("/api/.*",[](const auto&,auto&res){res.status=204;});server.Get("/api/.*",handler);server.Post("/api/.*",handler);server.Patch("/api/.*",handler);
server.Get("/assessment",[](const auto&,auto&res){res.set_content(assessmentHtml,"text/html; charset=utf-8");});
server.Get("/assessment.js",[](const auto&,auto&res){res.set_content(assessmentJs,"text/javascript; charset=utf-8");});
server.Get("/assessment.css",[](const auto&,auto&res){res.set_content("body{font:18px system-ui;color:#173c34;background:#f3f5f1;margin:0}main{max-width:540px;margin:7vh auto;padding:40px;background:white;border-radius:24px}small{letter-spacing:3px}h1{font-size:38px}p{line-height:1.7;color:#63756f}label{display:block;margin:24px 0}select,button{display:block;box-sizing:border-box;width:100%;padding:14px;margin-top:12px;border:1px solid #c8d4cd;border-radius:10px;font:inherit}button{background:#195844;color:white;cursor:pointer}","text/css");});
if(!uiDir.empty()&&std::filesystem::exists(std::filesystem::path(uiDir)/"index.html")){server.set_mount_point("/",uiDir);}
std::cout<<"SOLVIA server: "<<host<<":"<<port<<std::endl;if(!server.listen(host,port))throw std::runtime_error("Cannot start listener");}
int main(int argc,char**argv){try{
std::map<std::string,std::string> args;
for(int i=1;i<argc;++i){std::string k=argv[i];if(k=="--init"||k=="--demo")args[k]="1";else if(i+1<argc)args[k]=argv[++i];else throw std::runtime_error("Missing argument");}
const char* envDb=std::getenv("SOLVIA_DATABASE_URL");
std::string database=args.count("--database")?args["--database"]:(envDb?envDb:"");
check(!database.empty(),"SOLVIA_DATABASE_URL or --database is required");
App app(database);
if(args.count("--init")||args.count("--demo")){
    check(app.db.query("SELECT id FROM users").empty(),"Database already initialized");
    Transaction tx(app.db);
    if(args.count("--demo")){
        J users=J::array({J::array({"Administrator","admin","admin"}),J::array({"Reception","reception","reception"}),J::array({"Psychologist","psychologist","psychologist"}),J::array({"Director","director","director"})});
        for(auto&u:users){auto pw=randomToken().substr(0,20);app.db.query("INSERT INTO users(name,login,password,role) VALUES(?,?,?,?)",{u[0],u[1],hashPassword(pw),u[2]});std::cout<<u[1].get<std::string>()<<": "<<pw<<std::endl;}
    }else{
        const char* raw=std::getenv("SOLVIA_ADMIN_PASSWORD");std::string pw=raw?raw:"";
        check(pw.size()>=12&&pw.size()<=128&&pw.find('\n')==std::string::npos&&pw.find('\r')==std::string::npos,"SOLVIA_ADMIN_PASSWORD must contain 12-128 characters");
        const char* rawName=std::getenv("SOLVIA_ADMIN_NAME");std::string name=rawName&&*rawName?rawName:"Administrator";
        app.db.query("INSERT INTO users(name,login,password,role) VALUES(?,?,?,?)",{name,"admin",hashPassword(pw),"admin"});
    }
    for(auto n:{"Кабінет 1","Кабінет 2","Групова зала"})app.db.query("INSERT INTO rooms(name) VALUES(?)",{n});
    for(auto n:{"payments","reminders","consents","patient_portal","rehaflow"})app.db.query("INSERT INTO module_settings(name) VALUES(?)",{n});
    tx.commit();std::cout<<"SOLVIA database initialized.\n";return 0;
}
check(!app.db.query("SELECT id FROM users").empty(),"Run SolviaServer --init first");
auto host=args.count("--host")?args["--host"]:"127.0.0.1";
int port=args.count("--port")?std::stoi(args["--port"]):8765;
auto ui=args.count("--ui")?args["--ui"]:"ui";
if(args.count("--cert")&&args.count("--key")){httplib::SSLServer server(args["--cert"].c_str(),args["--key"].c_str());check(server.is_valid(),"Cannot load TLS certificate");serve(app,server,host,port,ui);}
else{check(host=="127.0.0.1"||host=="localhost"||host=="::1","Direct LAN access is disabled; use the local HTTPS reverse proxy");httplib::Server server;serve(app,server,host,port,ui);}
return 0;
}catch(const std::exception&e){std::cerr<<e.what()<<std::endl;return 1;}}