cmake_minimum_required(VERSION 3.16)
project(mkddc-core CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -Werror)

set(SHARED_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../shared)

include(FetchContent)
FetchContent_Declare(nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz)
FetchContent_MakeAvailable(nlohmann_json)

# BAC-004: full Priority_Array + Reliability + ext socket (MOD-009) always compiled;
# MKDDC_ENABLE_BACNET flag chỉ dùng cho iobus bacnet-stack link, core không cần flag này.
add_library(core_lib STATIC
    scan_loop.cpp point_table.cpp point_quality.cpp graph_runtime.cpp alarm_runtime.cpp
    schedule_runtime.cpp priority_resolver.cpp safe_state.cpp safe_state_config.cpp config_reload.cpp
    iobus_reader.cpp output_writer.cpp state_snapshot.cpp runtime_point_snapshot.cpp
    bacnet_objtable.cpp web_ipc.cpp core_metrics.cpp
    st_parser.cpp st_semantic.cpp st_runtime.cpp st_stdlib.cpp st_artifact.cpp
    st_io_map.cpp st_cyclic_runtime.cpp st_trace.cpp)
target_include_directories(core_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} ${SHARED_DIR})
target_link_libraries(core_lib PUBLIC pthread rt nlohmann_json::nlohmann_json)

add_executable(mkddc-core main.cpp)
target_link_libraries(mkddc-core PRIVATE core_lib)

# FW-SOM-IEC-002 item 2: validate gateway CLI cho BE gọi (fixed argv, source
# luôn qua file path, không shell-eval — xem st_validate_main.cpp).
add_executable(mkddc-st-validate st_validate_main.cpp)
target_link_libraries(mkddc-st-validate PRIVATE core_lib)

option(CORE_BUILD_TESTS "Build core unit tests" ON)
if(CORE_BUILD_TESTS)
  target_compile_definitions(core_lib PUBLIC CORE_BUILD_TESTS=1)
  find_package(GTest QUIET)
  if(NOT GTest_FOUND)
    include(FetchContent)
    FetchContent_Declare(googletest
      URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip)
    FetchContent_MakeAvailable(googletest)
  endif()
  enable_testing()
  add_executable(core_tests
      tests/test_iobus_reader.cpp tests/test_point_quality.cpp
      tests/test_priority_resolver.cpp tests/test_safe_state.cpp tests/test_scan_loop.cpp
      tests/test_web_ipc.cpp tests/test_graph_runtime.cpp tests/test_safe_state_config.cpp
      tests/test_config_reload.cpp tests/test_state_snapshot.cpp
      tests/test_bacnet_objtable.cpp
      tests/test_graph_protocol.cpp tests/test_alarm_runtime.cpp
      tests/test_schedule_runtime.cpp tests/test_runtime_point_snapshot.cpp
      tests/test_core_metrics.cpp tests/test_output_writer.cpp tests/test_st_runtime.cpp
      tests/test_st_stdlib.cpp tests/test_st_io_map.cpp tests/test_st_cyclic_runtime.cpp
      tests/test_st_validate_cli.cpp)
  target_link_libraries(core_tests PRIVATE core_lib)
  target_compile_options(core_tests PRIVATE -Wno-error=stringop-overflow)
  # test_st_validate_cli.cpp fork+execv nhị phân thật — cần path tuyệt đối,
  # không đoán build layout (generator expression cho đúng dù đổi cấu trúc).
  target_compile_definitions(core_tests PRIVATE
      ST_VALIDATE_CLI_PATH="$<TARGET_FILE:mkddc-st-validate>")
  add_dependencies(core_tests mkddc-st-validate)
  if(TARGET GTest::gtest_main)
    target_link_libraries(core_tests PRIVATE GTest::gtest_main)
  else()
    target_link_libraries(core_tests PRIVATE gtest_main)
  endif()
  include(GoogleTest)
  gtest_discover_tests(core_tests)
endif()
