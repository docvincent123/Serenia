#pragma once
#include <windows.h>
#include <nlohmann/json.hpp>
#include <string>
using J=nlohmann::json;
std::wstring wide(const std::string&);
std::string utf8(const std::wstring&);
class Api{public:std::wstring base=L"http://127.0.0.1:8765";std::string token;J call(const std::string& method,const std::string&path,const J&body=J::object());};
