cmake_minimum_required(VERSION 3.22)
project(SolviaNative VERSION 3.2.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 6.4 REQUIRED COMPONENTS Quick QuickControls2 Network Svg)
qt_add_executable(solvia-native
    main.cpp
    ApiBridge.h
    ApiBridge.cpp
)
qt_add_resources(solvia-native "solvia_qml" PREFIX "/"
    FILES Main.qml brand.svg
)
target_link_libraries(solvia-native PRIVATE
    Qt6::Quick Qt6::QuickControls2 Qt6::Network Qt6::Svg
)
set_target_properties(solvia-native PROPERTIES
    OUTPUT_NAME solvia-native
)
install(TARGETS solvia-native RUNTIME DESTINATION bin)
