cmake_minimum_required(VERSION 3.16)
project(mkddc-iobus CXX C)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -Werror)

# shared/ là hợp đồng — include từ repo root, KHÔNG copy file vào service
set(SHARED_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../shared)
set(TOOLS_DIR  ${CMAKE_CURRENT_SOURCE_DIR}/../../tools)

add_library(iobus_lib STATIC
    config/iobus_config.cpp
    iop/iop_port.cpp  iop/iop_frame.cpp  iop/iop_crc.cpp
    iop/iop_client.cpp iop/iop_parser.cpp
    io/io_scaling.cpp io/io_cache.cpp
    bridge/core_bridge.cpp bridge/output_command.cpp
    diagnostics/iobus_metrics.cpp diagnostics/alarm_publisher.cpp
    platform/systemd_notify.cpp platform/realtime.cpp)
target_include_directories(iobus_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} ${SHARED_DIR})
target_link_libraries(iobus_lib PUBLIC pthread rt)   # rt: shm/clock

add_executable(mkddc-iobus main.cpp)
target_link_libraries(mkddc-iobus PRIVATE iobus_lib)

# ---- dev tools (06 §11: build chung CMakeLists iobus) ----
add_executable(fake_mcu ${TOOLS_DIR}/fake_mcu/fake_mcu.cpp)
target_include_directories(fake_mcu PRIVATE ${SHARED_DIR})
target_link_libraries(fake_mcu PRIVATE m)

add_executable(shm_dump_io ${TOOLS_DIR}/shm_dump_io/shm_dump_io.c)
target_include_directories(shm_dump_io PRIVATE ${SHARED_DIR})
target_link_libraries(shm_dump_io PRIVATE rt)

# ---- tests (GoogleTest — ưu tiên bản hệ thống, fallback FetchContent) ----
option(IOBUS_BUILD_TESTS "Build iobus unit tests" ON)
if(IOBUS_BUILD_TESTS)
  find_package(GTest QUIET)
  if(NOT GTest_FOUND)
    include(FetchContent)
    FetchContent_Declare(googletest
      URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip)
    FetchContent_MakeAvailable(googletest)
  endif()
  enable_testing()
  add_executable(iobus_tests
      tests/test_iop_crc.cpp tests/test_iop_frame.cpp tests/test_iop_parser.cpp
      tests/test_io_scaling.cpp tests/test_output_command.cpp
      tests/test_iop_client_fake_mcu.cpp)
  target_link_libraries(iobus_tests PRIVATE iobus_lib)
  # GCC13 -O3 false positive (PR109945) với vector<struct nhỏ> trong test fixture
  target_compile_options(iobus_tests PRIVATE -Wno-error=stringop-overflow)
  if(TARGET GTest::gtest_main)
    target_link_libraries(iobus_tests PRIVATE GTest::gtest_main)
  else()
    target_link_libraries(iobus_tests PRIVATE gtest_main)
  endif()
  include(GoogleTest)
  gtest_discover_tests(iobus_tests)
endif()
