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
    graph/scan_loop.cpp graph/point_table.cpp graph/point_quality.cpp graph/graph_runtime.cpp
    alarm/alarm_runtime.cpp
    schedule/schedule_runtime.cpp ipc/priority_resolver.cpp safety/safe_state.cpp safety/safe_state_config.cpp ipc/config_reload.cpp
    ipc/iobus_reader.cpp ipc/output_writer.cpp graph/state_snapshot.cpp graph/runtime_point_snapshot.cpp
    bacnet/bacnet_objtable.cpp ipc/web_ipc.cpp diagnostics/core_metrics.cpp
    st/st_parser.cpp st/st_semantic.cpp st/st_runtime.cpp st/st_stdlib.cpp st/st_artifact.cpp
    st/st_io_map.cpp st/st_cyclic_runtime.cpp st/st_trace.cpp)
target_include_directories(core_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} ${SHARED_DIR})
target_link_libraries(core_lib PUBLIC pthread rt nlohmann_json::nlohmann_json)

add_executable(mkddc-core main.cpp)
target_link_libraries(mkddc-core PRIVATE core_lib)

# FW-SOM-IEC-002 item 2: validate gateway CLI cho BE gọi (fixed argv, source
# luôn qua file path, không shell-eval — xem st/st_validate_main.cpp).
add_executable(mkddc-st-validate st/st_validate_main.cpp)
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
      ipc/tests/test_iobus_reader.cpp graph/tests/test_point_quality.cpp
      ipc/tests/test_priority_resolver.cpp safety/tests/test_safe_state.cpp graph/tests/test_scan_loop.cpp
      ipc/tests/test_web_ipc.cpp graph/tests/test_graph_runtime.cpp safety/tests/test_safe_state_config.cpp
      ipc/tests/test_config_reload.cpp graph/tests/test_state_snapshot.cpp
      bacnet/tests/test_bacnet_objtable.cpp
      graph/tests/test_graph_protocol.cpp alarm/tests/test_alarm_runtime.cpp
      schedule/tests/test_schedule_runtime.cpp graph/tests/test_runtime_point_snapshot.cpp
      diagnostics/tests/test_core_metrics.cpp ipc/tests/test_output_writer.cpp st/tests/test_st_runtime.cpp
      st/tests/test_st_stdlib.cpp st/tests/test_st_io_map.cpp st/tests/test_st_cyclic_runtime.cpp
      st/tests/test_st_validate_cli.cpp)
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
