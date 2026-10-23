// Exercise production signature and policy code with an in-memory storage adapter.
#include <nlohmann/json.hpp>
#include <openssl/pem.h>
#include <openssl/evp.h>
#include <regex>
#include <memory>
#include <fstream>
#include <chrono>
#include <stdexcept>
#include <cstdlib>
#include <iostream>
using J=nlohmann::json;
void check(bool ok,const std::string& message,int=400){if(!ok)throw std::runtime_error(message);}
std::string str(const J& j,const char* key,size_t max){check(j.contains(key)&&j[key].is_string(),"missing field");auto s=j[key].get<std::string>();check(!s.empty()&&s.size()<=max,"invalid field");return s;}
std::string environmentUtf8(const char* key){auto p=std::getenv(key);return p?p:"";}
long long epoch(){return std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
struct DB {
 std::string id=std::string(64,'a'),envelope;
 J query(const std::string& sql){if(sql.find("installation_identity")!=std::string::npos)return J::array({{{"server_id",id}}});return envelope.empty()?J::array():J::array({{{"envelope",envelope}}});}
};
#include "../src/server/center_access.h"
int main(int argc,char**argv){try{
 DB db;
 if(argc>1){std::ifstream input(argv[1]);J envelope;input>>envelope;db.envelope=envelope.dump();}
 if(argc>2)db.id=argv[2];
 std::cout<<centerAccess(db).dump();return 0;
}catch(const std::exception&e){std::cerr<<e.what();return 1;}}
