cmake_minimum_required(VERSION 3.22)
project(SolviaNative VERSION 3.2.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 6.4 REQUIRED COMPONENTS Quick QuickControls2 Network)
qt_add_executable(solvia-native
    main.cpp
    ApiBridge.h
    ApiBridge.cpp
)
set(brand_png "${CMAKE_CURRENT_SOURCE_DIR}/../../frontend/public/solvia-icon.png")
set_source_files_properties("${brand_png}" PROPERTIES QT_RESOURCE_ALIAS "brand.png")
qt_add_resources(solvia-native "solvia_qml" PREFIX "/"
    FILES Main.qml AdminWorkspace.qml OperationsWorkspace.qml DocumentsDialog.qml RecoveryDialog.qml RegistrationDialog.qml CenterSettingsDialog.qml LicenseOnboarding.qml "${brand_png}"
)
target_link_libraries(solvia-native PRIVATE
    Qt6::Quick Qt6::QuickControls2 Qt6::Network
)
set_target_properties(solvia-native PROPERTIES
    OUTPUT_NAME solvia-native
    WIN32_EXECUTABLE TRUE
)
install(TARGETS solvia-native RUNTIME DESTINATION bin)

include(CTest)
if(BUILD_TESTING)
    qt_add_executable(lemvori-native-workflow-check ../../tests/native-qt-workflow.cpp ApiBridge.cpp ApiBridge.h)
    target_include_directories(lemvori-native-workflow-check PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(lemvori-native-workflow-check PRIVATE Qt6::Network Qt6::Gui)
    qt_add_executable(lemvori-native-ui-check ../../tests/native-qt-ui.cpp ApiBridge.cpp ApiBridge.h)
    target_include_directories(lemvori-native-ui-check PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(lemvori-native-ui-check PRIVATE Qt6::Quick Qt6::QuickControls2 Qt6::Network)
    qt_add_resources(lemvori-native-ui-check "native_ui_test" PREFIX "/" FILES Main.qml AdminWorkspace.qml OperationsWorkspace.qml DocumentsDialog.qml RecoveryDialog.qml RegistrationDialog.qml CenterSettingsDialog.qml LicenseOnboarding.qml "${brand_png}")
endif()
