#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#endif
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
// Windows environment strings are UTF-16; getenv converts them through the
// current ANSI code page, corrupting Ukrainian names and passwords.
std::string environmentUtf8(const char* key) {
#ifdef _WIN32
    std::wstring wideKey(key, key + std::char_traits<char>::length(key));
    const wchar_t* value = _wgetenv(wideKey.c_str());
    if (!value || !*value) return {};
    int length = static_cast<int>(wcslen(value));
    int bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, length, nullptr, 0, nullptr, nullptr);
    if (!bytes) throw std::runtime_error("Invalid Unicode environment value");
    std::string result(bytes, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, length, result.data(), bytes, nullptr, nullptr);
    return result;
#else
    const char* value = std::getenv(key);
    return value ? value : "";
#endif
}
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
    static const std::vector<std::string> tables={"users","families","patients","rooms","appointments","consultations","shift_reports","assessments","audit","outbox","admin_notes","discharge_summaries","backup_events"};
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
    if (PQsetClientEncoding(db, "UTF8") != 0) {
        std::string message = PQerrorMessage(db);
        PQfinish(db); db = nullptr;
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
std::string patientNumber(DB&d){
    for(int attempt=0;attempt<200;++attempt){
        auto value=10000+(std::stoul(randomToken().substr(0,8),nullptr,16)%90000);
        auto code=std::to_string(value);
        if(d.query("SELECT id FROM patients WHERE patient_no=?",{code}).empty())return code;
    }
    throw std::runtime_error("Cannot allocate patient number");
}

void allow(const J&u,std::initializer_list<std::string> roles){check(std::find(roles.begin(),roles.end(),u.at("role").get<std::string>())!=roles.end(),"Недостатньо прав",403);}
void audit(DB&d,const J&u,const std::string&event,const std::string&entity,int id){d.query("INSERT INTO audit(user_id,event,entity,entity_id,created) VALUES(?,?,?,?,?)",{u.at("id"),event,entity,id,now()});}
J getPatient(DB&d,const J&u,int id){allow(u,{"admin","reception","psychologist"});auto rows=d.query("SELECT p.*,f.name family FROM patients p LEFT JOIN families f ON f.id=p.family_id WHERE p.id=?",{id});check(!rows.empty(),"Пацієнта не знайдено",404);auto p=rows[0];check(u["role"]!="psychologist"||p["psychologist_id"]==u["id"],"Недостатньо прав",403);return p;}
J book(DB&d,const J&u,const J&b,int id=0){allow(u,{"admin","reception"});int psy=num(b,"psychologist_id"),room=num(b,"room_id");check(!d.query("SELECT id FROM users WHERE id=? AND role='psychologist' AND active=TRUE",{psy}).empty(),"Оберіть психолога");check(!d.query("SELECT id FROM rooms WHERE id=?",{room}).empty(),"Оберіть кабінет");auto start=str(b,"start",16),end=str(b,"end",16),kind=str(b,"kind",20);auto requestedStatus=b.contains("status")?str(b,"status",20):"scheduled";auto bookingNote=str(b,"note",2000,false);validTime(start);validTime(end);check(start<end&&start.substr(0,10)==end.substr(0,10),"Кінець має бути пізніше початку в межах дня");check(start.substr(11)>="08:00"&&end.substr(11)<="20:00","Години роботи: 08:00–20:00");check(b.contains("patient_ids")&&b["patient_ids"].is_array()&&!b["patient_ids"].empty()&&b["patient_ids"].size()<=30,"Оберіть від 1 до 30 учасників");auto ids=b["patient_ids"];check(kind=="group"||kind=="family"||((kind=="individual"||kind=="child"||kind=="crisis")&&ids.size()==1),"Некоректний тип запису");if(id){auto old=d.query("SELECT status FROM appointments WHERE id=?",{id});check(!old.empty(),"Запис не знайдено",404);if(!b.contains("status"))requestedStatus=old[0]["status"].get<std::string>();check((old[0]["status"]=="scheduled"||old[0]["status"]=="draft"||old[0]["status"]=="confirmed")&&d.query("SELECT id FROM consultations WHERE appointment_id=?",{id}).empty(),"Цей запис уже не можна переносити",409);}check(requestedStatus=="draft"||requestedStatus=="scheduled"||requestedStatus=="confirmed","Для нового/редагованого запису доступні статуси draft, scheduled або confirmed");
check(d.query("SELECT id FROM appointments WHERE status!='cancelled' AND id!=? AND start<? AND \"end\">? AND (psychologist_id=? OR room_id=?)",{id,end,start,psy,room}).empty(),"Психолог або кабінет уже зайняті",409);
for(auto&pid:ids){check(pid.is_number_integer(),"Некоректний учасник");auto p=getPatient(d,u,pid.get<int>());check(p["psychologist_id"]==psy,"Психолог має бути призначений усім учасникам");check(d.query("SELECT a.id FROM appointments a JOIN attendees t ON a.id=t.appointment_id WHERE t.patient_id=? AND a.status!='cancelled' AND a.id!=? AND a.start<? AND a.\"end\">?",{pid,id,end,start}).empty(),"Пацієнт має інший запис у цей час",409);}
if(id){d.query("UPDATE appointments SET psychologist_id=?,room_id=?,start=?,\"end\"=?,kind=?,status=?,note=? WHERE id=?",{psy,room,start,end,kind,requestedStatus,bookingNote,id});d.query("DELETE FROM attendees WHERE appointment_id=?",{id});}else{d.query("INSERT INTO appointments(psychologist_id,room_id,start,\"end\",kind,status,note,created_by,created) VALUES(?,?,?,?,?,?,?,?,?)",{psy,room,start,end,kind,requestedStatus,bookingNote,u["id"],now()});id=d.id();}
for(auto&pid:ids)d.query("INSERT INTO attendees VALUES(?,?)",{id,pid});audit(d,u,"save","appointment",id);d.query("INSERT INTO outbox(event,payload,created) VALUES(?,?,?)",{"appointment.saved",J({{"appointment_id",id}}).dump(),now()});return {{"id",id}};}

struct App{DB db;std::mutex mutex;std::map<std::string,std::vector<long long>> attempts;explicit App(const std::string&file):db(file){}
J route(const httplib::Request&r){std::lock_guard<std::mutex> lock(mutex);Transaction tx(db);auto result=dispatch(r);tx.commit();return result;}
J dispatch(const httplib::Request&r){auto path=r.path,method=r.method;J b=J::object();if(method!="GET"){check(r.get_header_value("Content-Type").find("application/json")==0,"Потрібен JSON",415);try{b=J::parse(r.body);}catch(...){throw Error(400,"Некоректний JSON");}check(b.is_object(),"Очікується JSON-об’єкт");}
if(path=="/api/health"&&method=="GET")return {{"ok",true},{"version","2.0.0"}};
if(path=="/api/login"&&method=="POST"){auto&v=attempts[r.remote_addr];auto t=epoch();std::erase_if(v,[&](auto x){return t-x>300;});check(v.size()<10,"Забагато спроб. Зачекайте 5 хвилин.",429);v.push_back(t);auto login=str(b,"login",100),pw=str(b,"password",256),platform=str(b,"platform",40,false),deviceId=str(b,"device_id",160,false),deviceName=str(b,"device_name",160,false);if(platform.empty())platform="Unknown";if(deviceName.empty())deviceName=platform;auto rows=db.query("SELECT * FROM users WHERE login=? AND active=TRUE",{login});auto dummy=std::string(64,'0')+":"+std::string(64,'0');bool ok=verify(pw,rows.empty()?dummy:rows[0]["password"].get<std::string>());check(!rows.empty()&&ok,"Неправильний логін або пароль",401);auto u=rows[0];auto token=randomToken();auto clientIp=r.get_header_value("X-Forwarded-For");if(clientIp.empty())clientIp=r.remote_addr;auto comma=clientIp.find(',');if(comma!=std::string::npos)clientIp=clientIp.substr(0,comma);db.query("DELETE FROM sessions WHERE expires<?",{epoch()});db.query("INSERT INTO sessions(token,user_id,csrf,expires,platform,device_id,device_name,ip_address,created,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?)",{digest(token),u["id"],"",epoch()+28800,platform,deviceId,deviceName,clientIp,now(),now()});audit(db,u,"login","user",u["id"]);return {{"token",token},{"user",{{"id",u["id"]},{"name",u["name"]},{"role",u["role"]},{"phone",u["phone"]}}}};}
if(path.rfind("/api/respond/",0)==0){auto token=path.substr(13);check(token.size()==64,"Недійсне посилання",404);auto rows=db.query("SELECT * FROM assessments WHERE token=? AND expires>? AND completed IS NULL",{digest(token),epoch()});check(!rows.empty(),"Посилання недійсне, прострочене або використане",404);if(method=="GET")return {{"questions",questions},{"title","Самопочуття сьогодні"},{"description","Авторська анкета самоспостереження, не діагностична шкала. 0 — найнижче, 10 — найвище."}};check(method=="POST","Метод не дозволений",405);check(b.contains("answers")&&b["answers"].is_array()&&b["answers"].size()==3,"Потрібно три відповіді");int score=0;for(auto&a:b["answers"]){check(a.is_number_integer()&&a>=0&&a<=10,"Відповіді: 0–10");score+=a.get<int>();}db.query("UPDATE assessments SET answers=?,score=?,completed=? WHERE id=?",{b["answers"].dump(),score,now(),rows[0]["id"]});return {{"ok",true}};}
auto bearer=r.get_header_value("Authorization");check(bearer.rfind("Bearer ",0)==0,"Увійдіть у систему",401);auto token=digest(bearer.substr(7));auto rows=db.query("SELECT u.id,u.name,u.role,u.phone FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=TRUE",{token,epoch()});check(!rows.empty(),"Сесія завершилася. Увійдіть знову.",401);auto u=rows[0];db.query("UPDATE sessions SET last_seen=? WHERE token=?",{now(),token});
if(path=="/api/me"&&method=="GET")return u;
if(path=="/api/logout"&&method=="POST"){db.query("DELETE FROM sessions WHERE token=?",{token});return {{"ok",true}};}
if(u["role"]!="admin"&&path!="/api/shift-day"){auto day=now().substr(0,10);auto openShift=db.query("SELECT shift_date FROM shift_days WHERE shift_date=? AND closed_at IS NULL",{day});check(!openShift.empty(),"Робоча зміна ще не відкрита або вже завершена адміністратором",423);}
if(path=="/api/admin/sessions"&&method=="GET"){allow(u,{"admin"});db.query("DELETE FROM sessions WHERE expires<?",{epoch()});return db.query("SELECT s.token session_id,s.user_id,u.name,u.role,s.platform,s.device_id,s.device_name,s.ip_address,s.created,s.last_seen,s.expires,(s.last_seen::timestamp >= now()-interval '2 minutes') online FROM sessions s JOIN users u ON u.id=s.user_id ORDER BY online DESC,s.last_seen DESC");}
if(std::regex_match(path,std::regex("/api/admin/sessions/[0-9a-f]{64}"))&&method=="DELETE"){allow(u,{"admin"});auto sid=path.substr(20);check(sid!=token,"Власну сесію завершіть кнопкою «Вийти»",409);auto rows=db.query("SELECT user_id FROM sessions WHERE token=?",{sid});check(!rows.empty(),"Сесію вже завершено",404);db.query("DELETE FROM sessions WHERE token=?",{sid});audit(db,u,"terminate","session",rows[0]["user_id"].get<int>());return {{"ok",true}};}
if(path=="/api/reminders"&&method=="GET"){allow(u,{"admin","psychologist"});auto settings=db.query("SELECT appointment_reminder_minutes FROM center_settings WHERE id=1");int minutes=settings.empty()?30:settings[0]["appointment_reminder_minutes"].get<int>();J args=J::array({std::to_string(minutes)});std::string sql="SELECT a.id,a.start,a.\"end\",a.kind,a.status,us.name psychologist,r.name room,string_agg(p.name,', ' ORDER BY p.name) patients FROM appointments a JOIN users us ON us.id=a.psychologist_id JOIN rooms r ON r.id=a.room_id JOIN attendees t ON t.appointment_id=a.id JOIN patients p ON p.id=t.patient_id WHERE a.status IN ('scheduled','confirmed') AND a.start::timestamp BETWEEN now() AND now() + (? || ' minutes')::interval";if(u["role"]=="psychologist"){sql+=" AND a.psychologist_id=?";args.push_back(u["id"]);}sql+=" GROUP BY a.id,us.name,r.name ORDER BY a.start";return db.query(sql,args);}
if(path=="/api/shift-day"){
    auto day=now().substr(0,10);
    if(method=="GET"){auto shifts=db.query("SELECT sd.*,u.name opened_by_name,c.name closed_by_name FROM shift_days sd JOIN users u ON u.id=sd.opened_by LEFT JOIN users c ON c.id=sd.closed_by WHERE sd.shift_date=?",{day});if(shifts.empty())return {{"shift_date",day},{"open",false}};auto shift=shifts[0];shift["open"]=shift["closed_at"].is_null();return shift;}
    allow(u,{"admin"});check(method=="POST","Метод не дозволений",405);auto action=str(b,"action",20);if(action=="open"){db.query("INSERT INTO shift_days(shift_date,opened_by,opened_at,closed_by,closed_at) VALUES(?,?,?,NULL,NULL) ON CONFLICT(shift_date) DO UPDATE SET opened_by=EXCLUDED.opened_by,opened_at=EXCLUDED.opened_at,closed_by=NULL,closed_at=NULL",{day,u["id"],now()});audit(db,u,"open","shift",0);return {{"shift_date",day},{"open",true}};}check(action=="close","Дія: open або close");auto existing=db.query("SELECT shift_date FROM shift_days WHERE shift_date=? AND closed_at IS NULL",{day});check(!existing.empty(),"Зміна сьогодні ще не відкрита або вже закрита",409);db.query("UPDATE shift_days SET closed_by=?,closed_at=? WHERE shift_date=?",{u["id"],now(),day});db.query("DELETE FROM sessions WHERE user_id<>?",{u["id"]});audit(db,u,"close","shift",0);return {{"shift_date",day},{"open",false},{"sessions_terminated",true}};
}
if(path=="/api/meta"&&method=="GET")return {{"psychologists",db.query("SELECT id,name FROM users WHERE role='psychologist' AND active=TRUE")},{"rooms",db.query("SELECT * FROM rooms WHERE active=TRUE ORDER BY name")},{"categories",categories},{"consultation_types",J::array({"primary","repeat","crisis","individual","family","child","group"})},{"risk_levels",J::array({"low","moderate","high","critical"})}};
if(path=="/api/users"){allow(u,{"admin"});if(method=="GET"){db.query("DELETE FROM sessions WHERE expires<?",{epoch()});return db.query("SELECT u.id,u.name,u.login,u.role,u.phone,u.active,coalesce(s.active_sessions,0) active_sessions,coalesce(s.platforms,'') platforms FROM users u LEFT JOIN (SELECT user_id,count(*) active_sessions,string_agg(DISTINCT NULLIF(platform,''),', ') platforms FROM sessions GROUP BY user_id) s ON s.user_id=u.id ORDER BY u.name");}check(method=="POST","Метод не дозволений",405);auto role=str(b,"role",20);check(role=="admin"||role=="reception"||role=="psychologist"||role=="director","Невідома роль");auto pw=str(b,"password",256);check(pw.size()>=12,"Пароль: мінімум 12 символів");db.query("INSERT INTO users(name,login,password,role,phone) VALUES(?,?,?,?,?)",{str(b,"name",150),str(b,"login",100),hashPassword(pw),role,str(b,"phone",40,false)});auto id=db.id();audit(db,u,"create","user",id);return {{"id",id}};}
if(std::regex_match(path,std::regex("/api/users/[0-9]+"))&&method=="PATCH"){allow(u,{"admin"});int id=std::stoi(path.substr(11));auto target=db.query("SELECT id,name,login,role,phone,active FROM users WHERE id=?",{id});check(!target.empty(),"Працівника не знайдено",404);auto current=target[0];auto role=b.contains("role")?str(b,"role",20):current["role"].get<std::string>();check(role=="admin"||role=="reception"||role=="psychologist"||role=="director","Невідома роль");bool active=b.contains("active")?(check(b["active"].is_boolean(),"Некоректний статус"),b["active"].get<bool>()):current["active"].get<bool>();auto name=b.contains("name")?str(b,"name",150):current["name"].get<std::string>();auto phone=b.contains("phone")?str(b,"phone",40,false):current["phone"].get<std::string>();if(current["role"]=="admin"&&(role!="admin"||!active)){auto count=db.query("SELECT count(*) n FROM users WHERE role='admin' AND active=TRUE")[0]["n"].get<long long>();check(count>1,"Не можна вимкнути або змінити роль останнього адміністратора",409);}check(!(id==u["id"].get<int>()&&!active),"Не можна вимкнути власний обліковий запис",409);db.query("UPDATE users SET name=?,role=?,phone=?,active=? WHERE id=?",{name,role,phone,active,id});if(b.contains("password")){auto pw=str(b,"password",256,false);if(!pw.empty()){check(pw.size()>=12,"Пароль: мінімум 12 символів");db.query("UPDATE users SET password=? WHERE id=?",{hashPassword(pw),id});}}audit(db,u,"update","user",id);return {{"ok",true}};}
if(std::regex_match(path,std::regex("/api/users/[0-9]+/sessions"))&&method=="DELETE"){allow(u,{"admin"});int id=std::stoi(path.substr(11));check(id!=u["id"].get<int>(),"Власну сесію завершіть кнопкою «Вийти»",409);auto target=db.query("SELECT id FROM users WHERE id=?",{id});check(!target.empty(),"Працівника не знайдено",404);db.query("DELETE FROM sessions WHERE user_id=?",{id});audit(db,u,"terminate_sessions","user",id);return {{"ok",true}};}
if(path=="/api/rooms"){allow(u,{"admin"});if(method=="GET")return db.query("SELECT * FROM rooms ORDER BY active DESC,name");check(method=="POST","Метод не дозволений",405);auto name=str(b,"name",100);auto code=str(b,"code",30,false),type=str(b,"type",40,false),description=str(b,"description",1000,false);int capacity=b.value("capacity",1);check(capacity>=1&&capacity<=100,"Місткість: 1–100");db.query("INSERT INTO rooms(name,code,type,capacity,description,active) VALUES(?,?,?,?,?,TRUE)",{name,code,type.empty()?"individual":type,capacity,description});auto id=db.id();audit(db,u,"create","room",id);return {{"id",id}};}
if(std::regex_match(path,std::regex("/api/rooms/[0-9]+"))){allow(u,{"admin"});int id=std::stoi(path.substr(11));auto rows=db.query("SELECT * FROM rooms WHERE id=?",{id});check(!rows.empty(),"Кабінет не знайдено",404);if(method=="PATCH"){auto cur=rows[0];auto name=b.contains("name")?str(b,"name",100):cur["name"].get<std::string>();auto code=b.contains("code")?str(b,"code",30,false):cur["code"].get<std::string>();auto type=b.contains("type")?str(b,"type",40,false):cur["type"].get<std::string>();auto description=b.contains("description")?str(b,"description",1000,false):cur["description"].get<std::string>();int capacity=b.value("capacity",cur["capacity"].get<int>());bool active=b.value("active",cur["active"].get<bool>());check(capacity>=1&&capacity<=100,"Місткість: 1–100");db.query("UPDATE rooms SET name=?,code=?,type=?,capacity=?,description=?,active=? WHERE id=?",{name,code,type,capacity,description,active,id});audit(db,u,"update","room",id);return {{"ok",true}};}if(method=="DELETE"){check(db.query("SELECT id FROM appointments WHERE room_id=? AND status NOT IN ('cancelled','completed') LIMIT 1",{id}).empty(),"Кабінет має активні записи. Спочатку перенесіть або скасуйте їх.",409);db.query("DELETE FROM rooms WHERE id=?",{id});audit(db,u,"delete","room",id);return {{"ok",true}};}throw Error(405,"Метод не дозволений");}
if(path=="/api/families"){allow(u,{"admin","reception"});if(method=="GET")return db.query("SELECT * FROM families ORDER BY name");check(method=="POST","Метод не дозволений",405);db.query("INSERT INTO families(name) VALUES(?)",{str(b,"name",150)});auto id=db.id();audit(db,u,"create","family",id);return {{"id",id}};}
if(path=="/api/patients"){allow(u,{"admin","reception","psychologist"});if(method=="GET")return db.query("SELECT p.*,u.name psychologist,f.name family FROM patients p JOIN users u ON u.id=p.psychologist_id LEFT JOIN families f ON f.id=p.family_id"+std::string(u["role"]=="psychologist"?" WHERE p.psychologist_id=?":"")+" ORDER BY p.created DESC",u["role"]=="psychologist"?J::array({u["id"]}):J::array());check(method=="POST","Метод не дозволений",405);allow(u,{"admin","reception"});auto name=str(b,"name",150),dob=str(b,"dob",10),phone=str(b,"phone",30),cat=str(b,"category",80);validDate(dob);check(dob>="1900-01-01"&&dob<=now().substr(0,10),"Перевірте дату народження");auto digits=std::count_if(phone.begin(),phone.end(),[](unsigned char c){return c>='0'&&c<='9';});check(digits>=7&&digits<=15,"Перевірте номер телефону");check(std::find(categories.begin(),categories.end(),cat)!=categories.end(),"Оберіть категорію");int psy=num(b,"psychologist_id");check(!db.query("SELECT id FROM users WHERE id=? AND role='psychologist' AND active=TRUE",{psy}).empty(),"Оберіть психолога");check(db.query("SELECT id FROM patients WHERE name=? AND dob=? AND phone=?",{name,dob,phone}).empty(),"Пацієнт із такими даними вже існує",409);J fid=b.value("family_id",J(nullptr));check(fid.is_null()||fid.is_number_integer(),"Некоректна сім’я");auto patientNo=patientNumber(db);db.query("INSERT INTO patients(patient_no,name,phone,dob,category,psychologist_id,family_id,family_role,sex,address,status,admin_note,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",{patientNo,name,phone,dob,cat,psy,fid,str(b,"family_role",80,false),str(b,"sex",30,false),str(b,"address",300,false),"active",str(b,"admin_note",2000,false),now()});auto id=db.id();audit(db,u,"create","patient",id);return {{"id",id},{"patient_no",patientNo}};}
if(std::regex_match(path,std::regex("/api/patients/[0-9]+"))&&method=="GET"){int id=std::stoi(path.substr(14));auto p=getPatient(db,u,id);if(u["role"]=="psychologist"){p["consultations"]=db.query("SELECT c.*,u.name psychologist FROM consultations c JOIN users u ON u.id=c.psychologist_id WHERE c.patient_id=? AND c.psychologist_id=? ORDER BY c.id DESC",{id,u["id"]});p["assessments"]=db.query("SELECT id,created,completed,score,answers FROM assessments WHERE patient_id=? AND psychologist_id=? ORDER BY id",{id,u["id"]});}else if(u["role"]=="admin"){p["consultations"]=db.query("SELECT c.*,u.name psychologist FROM consultations c JOIN users u ON u.id=c.psychologist_id WHERE c.patient_id=? ORDER BY c.id DESC",{id});p["admin_notes"]=db.query("SELECT n.*,us.name author FROM admin_notes n JOIN users us ON us.id=n.author_id WHERE n.patient_id=? ORDER BY n.id DESC",{id});}if(u["role"]=="admin"||u["role"]=="psychologist"){p["discharges"]=db.query("SELECT d.*,us.name author,ps.name psychologist FROM discharge_summaries d JOIN users us ON us.id=d.author_id LEFT JOIN users ps ON ps.id=d.psychologist_id WHERE d.patient_id=? ORDER BY d.id DESC",{id});}audit(db,u,"read","patient",id);return p;}
if(path=="/api/appointments"){allow(u,{"admin","reception","psychologist"});if(method=="POST")return book(db,u,b);check(method=="GET","Метод не дозволений",405);auto day=r.has_param("date")?r.get_param_value("date"):now().substr(0,10);validDate(day);J args={day};std::string sql="SELECT a.*,u.name psychologist,r.name room FROM appointments a JOIN users u ON u.id=a.psychologist_id JOIN rooms r ON r.id=a.room_id WHERE substr(start,1,10)=?";if(u["role"]=="psychologist"){sql+=" AND a.psychologist_id=?";args.push_back(u["id"]);}auto apps=db.query(sql+" ORDER BY start",args);for(auto&a:apps)a["patients"]=db.query("SELECT p.id,p.name FROM attendees t JOIN patients p ON p.id=t.patient_id WHERE t.appointment_id=?",{a["id"]});return apps;}
if(std::regex_match(path,std::regex("/api/appointments/[0-9]+"))&&method=="PATCH"){allow(u,{"admin","reception"});int id=std::stoi(path.substr(18));auto status=b.value("status","");if(status=="cancelled"||status=="no_show"){auto a=db.query("SELECT status FROM appointments WHERE id=?",{id});check(!a.empty(),"Запис не знайдено",404);check(db.query("SELECT id FROM consultations WHERE appointment_id=?",{id}).empty(),"Проведений або частково проведений запис не можна змінити",409);db.query("UPDATE appointments SET status=?,cancellation_reason=? WHERE id=?",{status,str(b,"cancellation_reason",1000,false),id});audit(db,u,status=="cancelled"?"cancel":"no_show","appointment",id);return {{"ok",true}};}return book(db,u,b,id);}
if(path=="/api/slots"&&method=="GET"){allow(u,{"admin","reception"});auto day=r.get_param_value("date");validDate(day);int psy=std::stoi(r.get_param_value("psychologist_id")),room=std::stoi(r.get_param_value("room_id"));auto busy=db.query("SELECT start,\"end\" FROM appointments WHERE status!='cancelled' AND substr(start,1,10)=? AND (psychologist_id=? OR room_id=?)",{day,psy,room});J slots=J::array();for(int h=8;h<20;++h){auto hh=[](int v){return std::string(v<10?"0":"")+std::to_string(v)+":00";};auto s=day+"T"+hh(h),e=day+"T"+hh(h+1);bool free=true;for(auto&a:busy)if(a["start"].get<std::string>()<e&&a["end"].get<std::string>()>s)free=false;if(free)slots.push_back(hh(h));}return slots;}
if(path=="/api/consultations"&&method=="POST"){allow(u,{"psychologist"});int pid=num(b,"patient_id"),aid=num(b,"appointment_id");getPatient(db,u,pid);auto apps=db.query("SELECT a.* FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE a.id=? AND a.psychologist_id=? AND t.patient_id=? AND a.status IN ('scheduled','confirmed')",{aid,u["id"],pid});check(!apps.empty(),"Немає доступного запису для консультації",403);check(apps[0]["start"].get<std::string>()<=now().substr(0,16),"Майбутню консультацію ще не можна завершити");auto ctype=str(b,"consultation_type",40,false);if(ctype.empty())ctype="repeat";int duration=b.value("duration_minutes",60);check(duration>=10&&duration<=480,"Тривалість консультації: 10–480 хв");auto risk=str(b,"risk_level",20,false);if(risk.empty())risk="low";check(risk=="low"||risk=="moderate"||risk=="high"||risk=="critical","Некоректний рівень ризику");J flags=b.value("risk_flags",J::array());check(flags.is_array(),"risk_flags має бути масивом");db.query("INSERT INTO consultations(patient_id,psychologist_id,appointment_id,note,goals,next_plan,homework,consultation_type,duration_minutes,request_text,state_text,work_done,recommendations,result_text,risk_level,risk_flags,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",{pid,u["id"],aid,str(b,"note"),str(b,"goals",10000,false),str(b,"next_plan",10000,false),str(b,"homework",10000,false),ctype,duration,str(b,"request_text",10000,false),str(b,"state_text",10000,false),str(b,"work_done",10000,false),str(b,"recommendations",10000,false),str(b,"result_text",10000,false),risk,flags.dump(),now()});int id=db.id();auto count=db.query("SELECT (SELECT count(*) FROM attendees WHERE appointment_id=?) total,(SELECT count(*) FROM consultations WHERE appointment_id=?) done",{aid,aid})[0];if(count["total"]==count["done"])db.query("UPDATE appointments SET status='completed' WHERE id=?",{aid});audit(db,u,"create","consultation",id);return {{"id",id}};}
if(path=="/api/assessments"&&method=="POST"){allow(u,{"psychologist"});int pid=num(b,"patient_id");getPatient(db,u,pid);auto tok=randomToken();db.query("INSERT INTO assessments(patient_id,psychologist_id,token,created,expires) VALUES(?,?,?,?,?)",{pid,u["id"],digest(tok),now(),epoch()+604800});int id=db.id();audit(db,u,"assign","assessment",id);return {{"id",id},{"link","/assessment#"+tok}};}
if(path=="/api/settings/center"){allow(u,{"admin","reception","psychologist","director"});if(method=="GET"){auto s=db.query("SELECT * FROM center_settings WHERE id=1");return s.empty()?J::object():s[0];}allow(u,{"admin"});check(method=="PATCH","Метод не дозволений",405);auto logo=str(b,"logo_data",1500000,false);check(logo.empty()||logo.rfind("data:image/png;base64,",0)==0||logo.rfind("data:image/jpeg;base64,",0)==0,"Емблема має бути PNG або JPEG");int reminder=b.value("appointment_reminder_minutes",30);check(reminder>=5&&reminder<=240,"Нагадування: 5–240 хвилин");auto connectionMode=str(b,"connection_mode",20,false);if(connectionMode.empty())connectionMode="local";check(connectionMode=="local"||connectionMode=="vps","Режим підключення: local або vps");auto localUrl=str(b,"local_api_url",500,false);auto vpsUrl=str(b,"vps_api_url",500,false);auto vpsName=str(b,"vps_name",120,false);auto normalizeUrl=[](std::string&value){while(!value.empty()&&value.back()=='/')value.pop_back();};if(!localUrl.empty()){check(localUrl.rfind("http://",0)==0||localUrl.rfind("https://",0)==0,"Локальна адреса API має починатися з http:// або https://");check(localUrl.find(' ')==std::string::npos,"Некоректна локальна адреса API");normalizeUrl(localUrl);}if(!vpsUrl.empty()){check(vpsUrl.rfind("https://",0)==0,"VPS API має використовувати HTTPS");check(vpsUrl.find(' ')==std::string::npos,"Некоректна адреса VPS API");normalizeUrl(vpsUrl);}if(connectionMode=="vps")check(!vpsUrl.empty(),"Для режиму VPS вкажіть HTTPS адресу API");db.query("UPDATE center_settings SET center_name=?,short_name=?,address=?,phone=?,email=?,website=?,city=?,director_name=?,admin_name=?,work_hours=?,document_footer=?,discharge_signatory=?,head_name=?,head_title=?,logo_data=?,appointment_reminder_minutes=?,connection_mode=?,local_api_url=?,vps_api_url=?,vps_name=?,updated=? WHERE id=1",{str(b,"center_name",200),str(b,"short_name",100,false),str(b,"address",300,false),str(b,"phone",100,false),str(b,"email",200,false),str(b,"website",300,false),str(b,"city",120,false),str(b,"director_name",200,false),str(b,"admin_name",200,false),str(b,"work_hours",200,false),str(b,"document_footer",2000,false),str(b,"discharge_signatory",200,false),str(b,"head_name",200,false),str(b,"head_title",120,false),logo,reminder,connectionMode,localUrl,vpsUrl,vpsName,now()});audit(db,u,"update","center_settings",1);return {{"ok",true},{"connection_mode",connectionMode},{"local_api_url",localUrl},{"vps_api_url",vpsUrl}};}
if(path=="/api/search"&&method=="GET"){auto q=r.has_param("q")?r.get_param_value("q"):"";check(q.size()>=2&&q.size()<=100,"Пошук: 2–100 символів");auto like="%"+q+"%";J result;result["patients"]=db.query("SELECT id,patient_no,name,phone,category,status FROM patients WHERE name ILIKE ? OR phone ILIKE ? OR category ILIKE ? OR patient_no ILIKE ? ORDER BY name LIMIT 12",{like,like,like,like});result["families"]=db.query("SELECT id,name FROM families WHERE name ILIKE ? ORDER BY name LIMIT 8",{like});result["rooms"]=db.query("SELECT id,name,code,type,active FROM rooms WHERE name ILIKE ? OR code ILIKE ? ORDER BY name LIMIT 8",{like,like});if(u["role"]=="admin")result["users"]=db.query("SELECT id,name,login,role,active FROM users WHERE name ILIKE ? OR login ILIKE ? ORDER BY name LIMIT 8",{like,like});return result;}
if(std::regex_match(path,std::regex("/api/patients/[0-9]+"))&&method=="PATCH"){allow(u,{"admin","reception"});int id=std::stoi(path.substr(14));auto rows=db.query("SELECT * FROM patients WHERE id=?",{id});check(!rows.empty(),"Пацієнта не знайдено",404);auto p=rows[0];auto status=b.contains("status")?str(b,"status",30):p["status"].get<std::string>();check(status=="active"||status=="archived"||status=="completed","Некоректний статус");auto name=b.contains("name")?str(b,"name",150):p["name"].get<std::string>();auto phone=b.contains("phone")?str(b,"phone",30):p["phone"].get<std::string>();auto dob=b.contains("dob")?str(b,"dob",10):p["dob"].get<std::string>();validDate(dob);auto category=b.contains("category")?str(b,"category",80):p["category"].get<std::string>();int psy=b.contains("psychologist_id")?num(b,"psychologist_id"):p["psychologist_id"].get<int>();J family=b.contains("family_id")?b["family_id"]:p["family_id"];db.query("UPDATE patients SET name=?,phone=?,dob=?,category=?,psychologist_id=?,family_id=?,family_role=?,sex=?,address=?,status=?,admin_note=? WHERE id=?",{name,phone,dob,category,psy,family,b.contains("family_role")?J(str(b,"family_role",80,false)):p["family_role"],b.contains("sex")?J(str(b,"sex",30,false)):p["sex"],b.contains("address")?J(str(b,"address",300,false)):p["address"],status,b.contains("admin_note")?J(str(b,"admin_note",2000,false)):p["admin_note"],id});audit(db,u,"update","patient",id);return {{"ok",true}};}
if(path=="/api/admin-notes"){allow(u,{"admin"});check(method=="POST","Метод не дозволений",405);int pid=num(b,"patient_id");getPatient(db,u,pid);auto priority=str(b,"priority",20,false);if(priority.empty())priority="normal";check(priority=="normal"||priority=="important"||priority=="urgent","Некоректний пріоритет");db.query("INSERT INTO admin_notes(patient_id,author_id,note,priority,created) VALUES(?,?,?,?,?)",{pid,u["id"],str(b,"note",5000),priority,now()});int id=db.id();audit(db,u,"create","admin_note",id);return {{"id",id}};}
if(path=="/api/discharges"){allow(u,{"admin","psychologist"});check(method=="POST","Метод не дозволений",405);int pid=num(b,"patient_id");auto p=getPatient(db,u,pid);auto from=str(b,"date_from",10),to=str(b,"date_to",10);validDate(from);validDate(to);check(from<=to,"Перевірте період виписки");auto rows=db.query("SELECT c.*,us.name psychologist,a.start appointment_start FROM consultations c JOIN users us ON us.id=c.psychologist_id JOIN appointments a ON a.id=c.appointment_id WHERE c.patient_id=? AND substr(a.start,1,10) BETWEEN ? AND ? ORDER BY a.start,c.id",{pid,from,to});check(!rows.empty(),"За обраний період немає завершених консультацій для виписки",409);auto count=static_cast<int>(rows.size());auto psychologistId=p["psychologist_id"];auto psy=db.query("SELECT name FROM users WHERE id=?",{psychologistId});std::string psychologist=psy.empty()?"":psy[0]["name"].get<std::string>();std::map<std::string,int> types;std::vector<std::string> work,dynamics,recommendations,followups;for(auto&x:rows){types[x["consultation_type"].get<std::string>()]++;auto addUnique=[](std::vector<std::string>&v,const J&x,const char*k){if(x.contains(k)&&x[k].is_string()){auto s=x[k].get<std::string>();if(!s.empty()&&std::find(v.begin(),v.end(),s)==v.end())v.push_back(s);}};addUnique(work,x,"work_done");addUnique(work,x,"goals");addUnique(dynamics,x,"result_text");addUnique(recommendations,x,"recommendations");addUnique(followups,x,"next_plan");}auto join=[](const std::vector<std::string>&v){std::string out;for(size_t i=0;i<v.size();++i){if(i)out+="\n";out+="- "+v[i];}return out;};std::string typeText;for(auto&[k,n]:types){if(!typeText.empty())typeText+=", ";typeText+=k+" — "+std::to_string(n);}std::string summary="У період з "+from+" по "+to+" пацієнт(ка) проходив(ла) психологічний супровід у центрі. Проведено "+std::to_string(count)+" консультацій ("+typeText+").";if(!work.empty())summary+="\n\nОсновні напрями роботи:\n"+join(work);std::string dynamicsText=dynamics.empty()?"Окрема динаміка у структурованих записах не зафіксована.":join(dynamics);std::string recommendationText=recommendations.empty()?"У структурованих записах за обраний період окремі рекомендації не зафіксовані.":join(recommendations);std::string followupText=followups.empty()?"У структурованих записах за обраний період окремий план подальшого супроводу не зафіксований.":join(followups);std::string documentNo=now().substr(0,4)+"-"+p["patient_no"].get<std::string>()+"-"+std::to_string(epoch()%100000);db.query("INSERT INTO discharge_summaries(patient_id,author_id,psychologist_id,document_no,generated,summary,dynamics,recommendations,followup,consultation_count,date_from,date_to,created) VALUES(?,?,?,?,TRUE,?,?,?,?,?,?,?,?)",{pid,u["id"],psychologistId,documentNo,summary,dynamicsText,recommendationText,followupText,count,from,to,now()});int id=db.id();audit(db,u,"create","discharge",id);auto center=db.query("SELECT * FROM center_settings WHERE id=1")[0];return {{"id",id},{"document_no",documentNo},{"consultation_count",count},{"psychologist",psychologist},{"summary",summary},{"dynamics",dynamicsText},{"recommendations",recommendationText},{"followup",followupText},{"patient",p},{"center",center}};}
if(path=="/api/psychology-records"&&method=="GET"){allow(u,{"admin"});auto from=r.has_param("from")?r.get_param_value("from"):now().substr(0,8)+"01",to=r.has_param("to")?r.get_param_value("to"):now().substr(0,10);validDate(from);validDate(to);check(from<=to,"Перевірте період");return db.query("SELECT c.id,c.patient_id,c.psychologist_id,c.appointment_id,c.note,c.goals,c.next_plan,c.homework,c.created,a.start appointment_start,p.name patient,u.name psychologist FROM consultations c JOIN appointments a ON a.id=c.appointment_id JOIN patients p ON p.id=c.patient_id JOIN users u ON u.id=c.psychologist_id WHERE substr(a.start,1,10) BETWEEN ? AND ? ORDER BY a.start DESC,c.created DESC",{from,to});}
if(path=="/api/shift-reports"){allow(u,{"admin","psychologist"});auto today=now().substr(0,10);if(method=="GET"){auto from=r.has_param("from")?r.get_param_value("from"):today.substr(0,8)+"01",to=r.has_param("to")?r.get_param_value("to"):today;validDate(from);validDate(to);check(from<=to,"Перевірте період");if(u["role"]=="psychologist")return db.query("SELECT sr.*,us.name psychologist FROM shift_reports sr JOIN users us ON us.id=sr.psychologist_id WHERE sr.psychologist_id=? AND sr.shift_date BETWEEN ? AND ? ORDER BY sr.shift_date DESC",{u["id"],from,to});return db.query("SELECT sr.*,us.name psychologist FROM shift_reports sr JOIN users us ON us.id=sr.psychologist_id WHERE sr.shift_date BETWEEN ? AND ? ORDER BY sr.shift_date DESC,us.name",{from,to});}check(method=="POST","Метод не дозволений",405);allow(u,{"psychologist"});auto day=str(b,"shift_date",10),summary=str(b,"summary",10000),incidents=str(b,"incidents",10000,false),handover=str(b,"handover",10000,false);validDate(day);check(day<=today,"Не можна подати звіт за майбутню дату");auto metrics=db.query("SELECT count(*) n,count(*) FILTER (WHERE c.consultation_type='primary') primary_count,count(*) FILTER (WHERE c.consultation_type='repeat') repeat_count,count(*) FILTER (WHERE c.consultation_type='crisis') crisis_count,count(*) FILTER (WHERE a.kind='group') group_count,count(*) FILTER (WHERE c.consultation_type='family') family_count FROM consultations c JOIN appointments a ON a.id=c.appointment_id WHERE c.psychologist_id=? AND substr(a.start,1,10)=?",{u["id"],day})[0];auto count=metrics["n"];auto cancelled=db.query("SELECT count(*) n FROM appointments WHERE psychologist_id=? AND substr(start,1,10)=? AND status='cancelled'",{u["id"],day})[0]["n"];bool critical=b.value("critical_cases",false),notifyAdmin=b.value("notify_admin",false),notifyDirector=b.value("notify_director",false);auto existing=db.query("SELECT id FROM shift_reports WHERE psychologist_id=? AND shift_date=?",{u["id"],day});int id=0;if(existing.empty()){db.query("INSERT INTO shift_reports(psychologist_id,shift_date,consultations_count,summary,incidents,handover,primary_count,repeat_count,crisis_count,cancelled_count,group_count,family_count,critical_cases,notify_admin,notify_director,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",{u["id"],day,count,summary,incidents,handover,metrics["primary_count"],metrics["repeat_count"],metrics["crisis_count"],cancelled,metrics["group_count"],metrics["family_count"],critical,notifyAdmin,notifyDirector,now(),now()});id=db.id();}else{id=existing[0]["id"].get<int>();db.query("UPDATE shift_reports SET consultations_count=?,summary=?,incidents=?,handover=?,primary_count=?,repeat_count=?,crisis_count=?,cancelled_count=?,group_count=?,family_count=?,critical_cases=?,notify_admin=?,notify_director=?,updated=? WHERE id=?",{count,summary,incidents,handover,metrics["primary_count"],metrics["repeat_count"],metrics["crisis_count"],cancelled,metrics["group_count"],metrics["family_count"],critical,notifyAdmin,notifyDirector,now(),id});}audit(db,u,"submit","shift_report",id);return {{"id",id},{"consultations_count",count}};}
if(path=="/api/stats"&&method=="GET"){allow(u,{"admin","director"});auto from=r.has_param("from")?r.get_param_value("from"):now().substr(0,8)+"01",to=r.has_param("to")?r.get_param_value("to"):now().substr(0,10);validDate(from);validDate(to);check(from<=to,"Перевірте період");J statuses=J::object();for(auto&a:db.query("SELECT status,count(*) n FROM appointments WHERE substr(start,1,10) BETWEEN ? AND ? GROUP BY status",{from,to}))statuses[a["status"].get<std::string>()]=a["n"];return {{"total_patients",db.query("SELECT count(*) n FROM patients")[0]["n"]},{"new_patients",db.query("SELECT count(*) n FROM patients WHERE substr(created,1,10) BETWEEN ? AND ?",{from,to})[0]["n"]},{"consultations",db.query("SELECT count(*) n FROM consultations WHERE substr(created,1,10) BETWEEN ? AND ?",{from,to})[0]["n"]},{"repeat_visits",db.query("SELECT count(*) n FROM consultations c WHERE substr(c.created,1,10) BETWEEN ? AND ? AND EXISTS(SELECT 1 FROM consultations old WHERE old.patient_id=c.patient_id AND old.id<c.id)",{from,to})[0]["n"]},{"appointments",statuses},{"load",db.query("SELECT u.name,count(a.id) appointments,coalesce(round((sum(extract(epoch from (a.\"end\"::timestamp-a.start::timestamp)))/3600.0)::numeric,1),0) hours FROM users u LEFT JOIN appointments a ON a.psychologist_id=u.id AND a.status!='cancelled' AND substr(a.start,1,10) BETWEEN ? AND ? WHERE u.role='psychologist' GROUP BY u.id",{from,to})}};}
if(path=="/api/audit"&&method=="GET"){allow(u,{"admin"});return db.query("SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100");}
throw Error(404,"Не знайдено");}
};

const char* assessmentHtml=R"HTML(<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SOLVIA • Самопочуття</title><link rel="stylesheet" href="/assessment.css"><main><small>SOLVIA by QureMed</small><h1>Як ви сьогодні?</h1><p>Авторська анкета самоспостереження. Це не діагностична шкала. 0 — найнижче, 10 — найвище.</p><form id="form"></form><p id="status" role="status"></p></main><script src="/assessment.js"></script></html>)HTML";
const char* assessmentJs=R"JS('use strict';const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const form=document.querySelector('#form'),status=document.querySelector('#status');async function call(method,body){const r=await fetch('/api/respond/'+token,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(j.error);return j;}call('GET').then(j=>{j.questions.forEach((q,i)=>{let label=document.createElement('label');label.textContent=q;let input=document.createElement('select');input.name='q'+i;input.required=true;let empty=new Option('Оберіть відповідь','');input.add(empty);for(let n=0;n<=10;n++)input.add(new Option(n,n));label.append(input);form.append(label)});const b=document.createElement('button');b.textContent='Зберегти відповіді';form.append(b)}).catch(e=>status.textContent=e.message);form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;try{await call('POST',{answers:[...form.querySelectorAll('select')].map(x=>Number(x.value))});form.replaceChildren();status.textContent='Дякуємо. Ваші відповіді збережено.'}catch(e){status.textContent=e.message;b.disabled=false}};)JS";
void serve(App&app,httplib::Server&server,const std::string&host,int port,const std::string&uiDir){server.set_payload_max_length(2097152);server.set_read_timeout(10,0);server.set_write_timeout(10,0);server.set_default_headers({{"Cache-Control","no-store"},{"X-Content-Type-Options","nosniff"},{"Referrer-Policy","no-referrer"},{"Content-Security-Policy","default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"},{"Access-Control-Allow-Origin","https://app.solvia.invalid"},{"Access-Control-Allow-Headers","Authorization, Content-Type"},{"Access-Control-Allow-Methods","GET, POST, PATCH, DELETE, OPTIONS"}});
auto handler=[&](const httplib::Request&r,httplib::Response&res){try{res.set_content(app.route(r).dump(),"application/json; charset=utf-8");}catch(const Error&e){res.status=e.status;res.set_content(J({{"error",e.what()}}).dump(),"application/json; charset=utf-8");}catch(const J::exception&){res.status=400;res.set_content(J({{"error","Некоректні поля запиту"}}).dump(),"application/json; charset=utf-8");}catch(const std::invalid_argument&){res.status=400;res.set_content(J({{"error","Некоректний ідентифікатор"}}).dump(),"application/json; charset=utf-8");}catch(const std::out_of_range&){res.status=400;res.set_content(J({{"error","Значення поза допустимими межами"}}).dump(),"application/json; charset=utf-8");}catch(const std::exception&){res.status=500;res.set_content(J({{"error","Внутрішня помилка сервера"}}).dump(),"application/json; charset=utf-8");}};
server.Options("/api/.*",[](const auto&,auto&res){res.status=204;});server.Get("/api/.*",handler);server.Post("/api/.*",handler);server.Patch("/api/.*",handler);server.Delete("/api/.*",handler);
server.Get("/assessment",[](const auto&,auto&res){res.set_content(assessmentHtml,"text/html; charset=utf-8");});
server.Get("/assessment.js",[](const auto&,auto&res){res.set_content(assessmentJs,"text/javascript; charset=utf-8");});
server.Get("/assessment.css",[](const auto&,auto&res){res.set_content("body{font:18px system-ui;color:#173c34;background:#f3f5f1;margin:0}main{max-width:540px;margin:7vh auto;padding:40px;background:white;border-radius:24px}small{letter-spacing:3px}h1{font-size:38px}p{line-height:1.7;color:#63756f}label{display:block;margin:24px 0}select,button{display:block;box-sizing:border-box;width:100%;padding:14px;margin-top:12px;border:1px solid #c8d4cd;border-radius:10px;font:inherit}button{background:#195844;color:white;cursor:pointer}","text/css");});
if(!uiDir.empty()&&std::filesystem::exists(std::filesystem::path(uiDir)/"index.html")){server.set_mount_point("/",uiDir);}
std::cout<<"SOLVIA server: "<<host<<":"<<port<<std::endl;if(!server.listen(host,port))throw std::runtime_error("Cannot start listener");}
int main(int argc,char**argv){try{
std::map<std::string,std::string> args;
for(int i=1;i<argc;++i){std::string k=argv[i];if(k=="--init"||k=="--demo")args[k]="1";else if(i+1<argc)args[k]=argv[++i];else throw std::runtime_error("Missing argument");}
auto envDb=environmentUtf8("SOLVIA_DATABASE_URL");
std::string database=args.count("--database")?args["--database"]:envDb;
check(!database.empty(),"SOLVIA_DATABASE_URL or --database is required");
App app(database);
if(args.count("--init")||args.count("--demo")){
    if (!app.db.query("SELECT id FROM users").empty()) {
        check(!args.count("--demo"),"Database already initialized");
        std::cout << "Database already initialized; existing accounts preserved\n";
        return 0;
    }
    Transaction tx(app.db);
    if(args.count("--demo")){
        J users=J::array({J::array({"Administrator","admin","admin"}),J::array({"Reception","reception","reception"}),J::array({"Psychologist","psychologist","psychologist"}),J::array({"Director","director","director"})});
        for(auto&u:users){auto pw=randomToken().substr(0,20);app.db.query("INSERT INTO users(name,login,password,role) VALUES(?,?,?,?)",{u[0],u[1],hashPassword(pw),u[2]});std::cout<<u[1].get<std::string>()<<": "<<pw<<std::endl;}
    }else{
        auto login=environmentUtf8("SOLVIA_ADMIN_LOGIN");
        check(std::regex_match(login,std::regex("[A-Za-z0-9._-]{3,64}")),"SOLVIA_ADMIN_LOGIN must contain 3-64 safe characters");
        auto pw=environmentUtf8("SOLVIA_ADMIN_PASSWORD");
        check(pw.size()>=12&&pw.size()<=128&&pw.find('\n')==std::string::npos&&pw.find('\r')==std::string::npos,"SOLVIA_ADMIN_PASSWORD must contain 12-128 characters");
        auto name=environmentUtf8("SOLVIA_ADMIN_NAME");if(name.empty())name="Administrator";
        app.db.query("INSERT INTO users(name,login,password,role) VALUES(?,?,?,?)",{name,login,hashPassword(pw),"admin"});
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
