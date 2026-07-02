cmake_minimum_required(VERSION 3.16)
project(mkddc-iobus CXX C)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -Werror)

# shared/ là hợp đồng — include từ repo root, KHÔNG copy file vào service
set(SHARED_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../shared)
set(TOOLS_DIR  ${CMAKE_CURRENT_SOURCE_DIR}/../../tools)

# ---- BAC-001: BACnet/IP stack option (bacnet-stack 1.3.x) ----
option(MKDDC_ENABLE_BACNET "Enable BACnet/IP stack (bacnet-stack 1.3.8)" OFF)
if(MKDDC_ENABLE_BACNET)
  find_package(PkgConfig QUIET)
  if(PkgConfig_FOUND)
    pkg_check_modules(BACNET_STACK bacnet-stack>=1.3 QUIET)
  endif()
  if(NOT BACNET_STACK_FOUND)
    include(FetchContent)
    set(BACNET_STACK_BUILD_APPS OFF CACHE BOOL "" FORCE)
    set(BACDL_BIP ON CACHE BOOL "" FORCE)
    set(BACDL_BIP6 OFF CACHE BOOL "" FORCE)
    set(BAC_ROUTING OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(bacnet_stack_src
      URL https://github.com/bacnet-stack/bacnet-stack/archive/refs/tags/bacnet-stack-1.3.8.tar.gz
      DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    FetchContent_MakeAvailable(bacnet_stack_src)
    # GCC 12 (Debian Bookworm) false-positive array-bounds in bacnet-stack 1.3.8 h_cov.c
    if(TARGET bacnet-stack)
      target_compile_options(bacnet-stack PRIVATE -Wno-error=array-bounds)
    endif()
    set(BACNET_STACK_TARGET bacnet-stack::bacnet-stack)
  endif()
endif()

# ---- MOD-001: Modbus RTU master (libmodbus >= 3.1.6) ----
option(MKDDC_ENABLE_MODBUS "Enable Modbus RTU master (libmodbus >= 3.1.6 required)" OFF)
if(MKDDC_ENABLE_MODBUS)
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(LIBMODBUS libmodbus>=3.1.6 REQUIRED)
  if(NOT LIBMODBUS_FOUND)
    message(FATAL_ERROR "MKDDC_ENABLE_MODBUS=ON but libmodbus >= 3.1.6 not found."
            " Install libmodbus-dev or set PKG_CONFIG_PATH.")
  endif()
endif()

# ---- BACnet sources (logic compile unconditionally; bacnet-stack API guarded) ----
set(BACNET_SOURCES
    bacnet/bacnet_config.cpp
    bacnet/bacnet_priority.cpp
    bacnet/bacnet_cov.cpp
    bacnet/bacnet_reliability.cpp
    bacnet/bacnet_alarm.cpp
    bacnet/bacnet_objects.cpp
    bacnet/bacnet_server.cpp)

# ---- Modbus sources (logic compile unconditionally; libmodbus API guarded) ----
set(MODBUS_SOURCES
    fieldbus/fieldbus_config.cpp
    fieldbus/device_profile.cpp
    fieldbus/register_codec.cpp
    fieldbus/poll_scheduler.cpp
    fieldbus/ext_cache.cpp
    fieldbus/fieldbus_metrics.cpp
    fieldbus/modbus_master.cpp
    fieldbus/modbus_tcp.cpp)

add_library(iobus_lib STATIC
    config/iobus_config.cpp
    iop/iop_port.cpp  iop/iop_frame.cpp  iop/iop_crc.cpp
    iop/iop_client.cpp iop/iop_parser.cpp
    io/io_scaling.cpp io/io_cache.cpp
    bridge/core_bridge.cpp bridge/output_command.cpp
    diagnostics/iobus_metrics.cpp diagnostics/alarm_publisher.cpp
    platform/systemd_notify.cpp platform/realtime.cpp
    ${BACNET_SOURCES}
    ${MODBUS_SOURCES})
target_include_directories(iobus_lib PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/bacnet
    ${CMAKE_CURRENT_SOURCE_DIR}/fieldbus
    ${SHARED_DIR})
target_link_libraries(iobus_lib PUBLIC pthread rt)   # rt: shm/clock

if(MKDDC_ENABLE_BACNET)
  target_compile_definitions(iobus_lib PUBLIC MKDDC_ENABLE_BACNET)
  if(BACNET_STACK_FOUND)
    target_include_directories(iobus_lib PUBLIC ${BACNET_STACK_INCLUDE_DIRS})
    target_link_libraries(iobus_lib PUBLIC ${BACNET_STACK_LIBRARIES})
  else()
    target_link_libraries(iobus_lib PUBLIC ${BACNET_STACK_TARGET})
  endif()
endif()

if(MKDDC_ENABLE_MODBUS)
  target_compile_definitions(iobus_lib PUBLIC MKDDC_ENABLE_MODBUS)
  target_include_directories(iobus_lib PUBLIC ${LIBMODBUS_INCLUDE_DIRS})
  target_link_libraries(iobus_lib PUBLIC ${LIBMODBUS_LIBRARIES})
endif()

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
      tests/test_iop_client_fake_mcu.cpp
      tests/test_iobus_config.cpp tests/test_io_cache.cpp tests/test_shm_layout.cpp
      bacnet/tests/test_bacnet_priority.cpp
      bacnet/tests/test_bacnet_reliability.cpp
      bacnet/tests/test_bacnet_object_map.cpp
      bacnet/tests/test_bacnet_cov.cpp
      fieldbus/tests/test_device_profile.cpp
      fieldbus/tests/test_register_codec.cpp
      fieldbus/tests/test_poll_scheduler.cpp
      fieldbus/tests/test_ext_cache.cpp
      fieldbus/tests/test_modbus_master_fake.cpp
      fieldbus/tests/test_modbus_tcp.cpp)
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
