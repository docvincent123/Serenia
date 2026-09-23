cmake_minimum_required(VERSION 3.24)
project(Solvia VERSION 1.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(nlohmann_json CONFIG REQUIRED)
find_package(httplib CONFIG REQUIRED)
find_package(PostgreSQL REQUIRED)
find_package(OpenSSL REQUIRED)

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/src/server/schema.sql" SOLVIA_SCHEMA)
configure_file(src/server/schema.h.in generated/schema.h @ONLY)

add_executable(SolviaServer src/server/main.cpp)
target_include_directories(SolviaServer PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(SolviaServer PRIVATE
  nlohmann_json::nlohmann_json
  httplib::httplib
  PostgreSQL::PostgreSQL
  OpenSSL::Crypto
  OpenSSL::SSL
)
target_compile_definitions(SolviaServer PRIVATE CPPHTTPLIB_OPENSSL_SUPPORT)

if(WIN32)
  find_package(unofficial-webview2 CONFIG REQUIRED)

  add_executable(Solvia WIN32 src/desktop/main.cpp)
  target_compile_definitions(Solvia PRIVATE
    UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00
  )
  target_link_libraries(Solvia PRIVATE
    unofficial::webview2::webview2
    ole32
    user32
    shell32
  )

  if(MSVC)
    target_link_options(Solvia PRIVATE
      "/MANIFEST:EMBED"
      "/MANIFESTINPUT:${CMAKE_CURRENT_SOURCE_DIR}/src/desktop/app.manifest"
    )
  endif()
endif()

if(MSVC)
  target_compile_options(SolviaServer PRIVATE /utf-8 /W4)
  if(TARGET Solvia)
    target_compile_options(Solvia PRIVATE /utf-8 /W4)
  endif()
else()
  target_compile_options(SolviaServer PRIVATE -Wall -Wextra -Wpedantic)
endif()

include(CTest)
if(BUILD_TESTING)
  find_package(Python3 COMPONENTS Interpreter REQUIRED)
  add_test(
    NAME integration
    COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/integration.py $<TARGET_FILE:SolviaServer>
  )
endif()

