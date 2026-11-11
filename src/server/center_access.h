#pragma once
#include "module_catalog.h"

std::string installationId(DB& db) {
    return db.query("SELECT server_id FROM installation_identity WHERE id=1")[0]["server_id"].get<std::string>();
}
std::string licenseBytes(const std::string& text) {
    check(!text.empty() && text.size() <= 16384 && text.size()%4==0 &&
          std::regex_match(text,std::regex("[A-Za-z0-9+/]*={0,2}")),"Некоректний файл ліцензії");
    std::string bytes(text.size(),'\0');
    int n=EVP_DecodeBlock(reinterpret_cast<unsigned char*>(bytes.data()),reinterpret_cast<const unsigned char*>(text.data()),static_cast<int>(text.size()));
    check(n>=0,"Некоректне кодування ліцензії");
    if(text.back()=='=')--n;
    if(text.size()>1 && text[text.size()-2]=='=')--n;
    check(n>0,"Порожня ліцензія");bytes.resize(n);return bytes;
}
std::string lemvoriLicenseVerifierPath() {
    auto path=environmentUtf8("LEMVORI_LICENSE_PUBLIC_KEY");
    return path.empty()?environmentUtf8("SOLVIA_LICENSE_PUBLIC_KEY"):path;
}
bool lemvoriLicenseRequired() {
    return environmentUtf8("LEMVORI_LICENSE_REQUIRED")=="1" ||
           environmentUtf8("SOLVIA_LICENSE_REQUIRED")=="1";
}
J verifyCenterLicense(const J& envelope,const std::string& serverId) {
    check(str(envelope,"format",80)=="quremed.solvia.license","Це не ліцензія SOLVIA");
    auto keyPath=lemvoriLicenseVerifierPath();
    check(!keyPath.empty(),"Видавець ще не налаштував ключ перевірки ліцензій",409);
    std::unique_ptr<BIO,decltype(&BIO_free)> input(BIO_new_file(keyPath.c_str(),"r"),BIO_free);
    check(input!=nullptr,"Ключ перевірки ліцензії недоступний",503);
    std::unique_ptr<EVP_PKEY,decltype(&EVP_PKEY_free)> key(PEM_read_bio_PUBKEY(input.get(),nullptr,nullptr,nullptr),EVP_PKEY_free);
    check(key && EVP_PKEY_base_id(key.get())==EVP_PKEY_ED25519,"Потрібен відкритий ключ Ed25519",503);
    auto payload=licenseBytes(str(envelope,"payload",16384));auto signature=licenseBytes(str(envelope,"signature",256));
    std::unique_ptr<EVP_MD_CTX,decltype(&EVP_MD_CTX_free)> context(EVP_MD_CTX_new(),EVP_MD_CTX_free);
    check(context && EVP_DigestVerifyInit(context.get(),nullptr,nullptr,nullptr,key.get())==1 &&
        EVP_DigestVerify(context.get(),reinterpret_cast<const unsigned char*>(signature.data()),signature.size(),reinterpret_cast<const unsigned char*>(payload.data()),payload.size())==1,"Підпис ліцензії недійсний",403);
    auto grant=J::parse(payload);
    check(str(grant,"server_id",64)==serverId,"Ліцензію видано іншому серверу",403);
    str(grant,"center",200);str(grant,"license_id",100);
    check(grant.value("version",1)==1||grant.value("version",1)==2,"Непідтримувана версія ліцензії");
    const bool perpetual=grant.value("version",1)==2 && grant.value("perpetual",false);
    check(grant.contains("expires_at") && grant["expires_at"].is_number_integer() &&
        (perpetual?grant["expires_at"].get<long long>()==0:grant["expires_at"].get<long long>()>0),"Некоректний строк ліцензії");
    if(grant.value("version",1)==2){
        check(grant.contains("modules")&&grant["modules"].is_array()&&grant["modules"].size()<=careModuleCatalog().size(),"Некоректні модулі ліцензії");
        std::vector<std::string> names;
        for(const auto&name:grant["modules"]){
            check(name.is_string(),"Некоректний модуль");auto id=name.get<std::string>();bool found=false;
            for(const auto&module:careModuleCatalog())if(module["id"]==id)found=true;
            check(found&&std::find(names.begin(),names.end(),id)==names.end(),"Невідомий або повторний модуль");names.push_back(id);
        }
        for(const auto&module:careModuleCatalog()){
            const bool enabled=std::find(names.begin(),names.end(),module["id"].get<std::string>())!=names.end();
            check(!module["core"].get<bool>()||enabled,"Відсутній базовий модуль ліцензії");
            if(enabled)for(const auto&dependency:module["depends"])check(std::find(names.begin(),names.end(),dependency.get<std::string>())!=names.end(),"Відсутня залежність модуля");
        }
        check(grant.contains("module_versions")&&grant["module_versions"].is_object(),"Відсутні версії модулів");
        for(const auto&module:careModuleCatalog())if(std::find(names.begin(),names.end(),module["id"].get<std::string>())!=names.end())
            check(grant["module_versions"].contains(module["id"].get<std::string>())&&grant["module_versions"][module["id"].get<std::string>()]==module["version"],"Для цієї ліцензії потрібна сумісна версія модулів");
        if(grant.contains("workflow")&&!grant["workflow"].empty()){
            const auto&workflow=grant["workflow"];check(workflow.is_object()&&workflow.size()==6,"Некоректні правила центру");
            auto opening=str(workflow,"opening_time",5),closing=str(workflow,"closing_time",5),days=str(workflow,"working_days",7);
            std::regex clock("([01][0-9]|2[0-3]):[0-5][0-9]");check(std::regex_match(opening,clock)&&std::regex_match(closing,clock)&&opening<closing,"Некоректні години роботи");
            check(std::regex_match(days,std::regex("[1-7]{1,7}")),"Некоректні робочі дні");
            for(auto key:{"slot_step_minutes","default_duration_minutes","session_hours"})check(workflow.contains(key)&&workflow[key].is_number_integer(),"Некоректні правила запису");
            int step=workflow["slot_step_minutes"],duration=workflow["default_duration_minutes"],hours=workflow["session_hours"];
            check((step==15||step==30||step==60)&&duration>=15&&duration<=240&&hours>=1&&hours<=24,"Некоректні правила запису");
        }
        for(auto key:{"max_users","max_devices"})check(grant.contains(key)&&grant[key].is_number_integer()&&grant[key]>=1&&grant[key]<=10000,"Некоректні ліміти ліцензії");
    }
    return grant;
}
J centerAccess(DB& db) {
    auto id=installationId(db);
    // Legacy centers without any activation remain opt-in. Once activated,
    // losing the verifier configuration must never unlock an expired grant.
    auto rows=db.query("SELECT envelope FROM center_license WHERE id=1");
    auto verifierPath=lemvoriLicenseVerifierPath();
    bool configured=!verifierPath.empty() && std::filesystem::is_regular_file(verifierPath);
    if(!configured && (!rows.empty() || lemvoriLicenseRequired()))
        return {{"status","publisher_key_required"},{"write_allowed",false},{"server_id",id}};
    if(!configured)return {{"status","unmanaged"},{"write_allowed",true},{"server_id",id}};
    if(rows.empty())return {{"status","activation_required"},{"write_allowed",false},{"server_id",id}};
    try {
        auto grant=verifyCenterLicense(J::parse(rows[0]["envelope"].get<std::string>()),id);
        bool active=(grant.value("version",1)==2&&grant.value("perpetual",false))||grant["expires_at"].get<long long>()>epoch();
        grant["status"]=active?"active":"expired";grant["write_allowed"]=active;return grant;
    } catch(const std::exception&) { return {{"status","invalid"},{"write_allowed",false},{"server_id",id}}; }
}
