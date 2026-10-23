#pragma once

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
J verifyCenterLicense(const J& envelope,const std::string& serverId) {
    check(str(envelope,"format",80)=="quremed.solvia.license","Це не ліцензія SOLVIA");
    auto keyPath=environmentUtf8("SOLVIA_LICENSE_PUBLIC_KEY");
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
    check(grant.contains("expires_at") && grant["expires_at"].is_number_integer() && grant["expires_at"].get<long long>()>0,"Некоректний строк ліцензії");
    return grant;
}
J centerAccess(DB& db) {
    auto id=installationId(db);
    // Opt-in deployment: upgrading an existing centre never silently locks it out.
    if(environmentUtf8("SOLVIA_LICENSE_PUBLIC_KEY").empty())return {{"status","unmanaged"},{"write_allowed",true},{"server_id",id}};
    auto rows=db.query("SELECT envelope FROM center_license WHERE id=1");
    if(rows.empty())return {{"status","activation_required"},{"write_allowed",false},{"server_id",id}};
    try {
        auto grant=verifyCenterLicense(J::parse(rows[0]["envelope"].get<std::string>()),id);
        bool active=grant["expires_at"].get<long long>()>epoch();
        grant["status"]=active?"active":"expired";grant["write_allowed"]=active;return grant;
    } catch(const std::exception&) { return {{"status","invalid"},{"write_allowed",false},{"server_id",id}}; }
}
