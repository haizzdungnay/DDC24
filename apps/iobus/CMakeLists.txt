cmake_minimum_required(VERSION 3.16)
project(mkddc-iobus CXX C)
if(NOT DEFINED MKDDC_REPOSITORY_ROOT)
  get_filename_component(MKDDC_REPOSITORY_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
endif()
if(NOT DEFINED MKDDC_CMAKE_MODULE_DIR)
  set(MKDDC_CMAKE_MODULE_DIR "${MKDDC_REPOSITORY_ROOT}/platform/cmake")
endif()
include(${MKDDC_CMAKE_MODULE_DIR}/BuildProvenance.cmake)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -Werror)

# contracts/ là authority — include trực tiếp, không qua shim shared/.
if(NOT DEFINED MKDDC_CONTRACTS_SOURCE_DIR)
  set(MKDDC_CONTRACTS_SOURCE_DIR "${MKDDC_REPOSITORY_ROOT}/contracts")
endif()
set(CONTRACT_IOP_DIR ${MKDDC_CONTRACTS_SOURCE_DIR}/iop)
set(CONTRACT_SHM_DIR ${MKDDC_CONTRACTS_SOURCE_DIR}/shm)
set(CONTRACT_CONFIG_DIR ${MKDDC_CONTRACTS_SOURCE_DIR}/config)
set(TOOLS_DIR  ${CMAKE_CURRENT_SOURCE_DIR}/../../tools)

# ---- BAC-001: BACnet/IP stack option (bacnet-stack 1.3.x) ----
option(MKDDC_ENABLE_BACNET "Enable BACnet/IP stack (bacnet-stack 1.3.8)" OFF)
if(MKDDC_ENABLE_BACNET)
  find_package(PkgConfig QUIET)
  if(PkgConfig_FOUND)
    pkg_check_modules(BACNET_STACK bacnet-stack>=1.3 QUIET)
  endif()
  if(NOT BACNET_STACK_FOUND)
    # OD-BAC-009 (ký 2026-09-16, phương án (a)): nguồn bacnet-stack nằm TRONG
    # repo, không tải lúc dựng. Trước đó đây là `FetchContent` tải tarball từ
    # kho công cộng trên GitHub, và hỏng HTTP 403 ở mọi môi trường có egress
    # policy — tức `BACNET=ON` không dựng được ở đâu cả, và `1440/1440 PASS`
    # của cấu hình
    # `BACNET=OFF` che mất điều đó (ADR-060 điều 4).
    #
    # Cây vendor do `scripts/vendor_bacnet_stack.sh` sinh, ghim theo commit
    # (không chỉ theo tag — tag dời được), kiểm toàn vẹn bằng
    # `scripts/verify_vendor_bacnet_stack.sh` chạy offline.
    set(MKDDC_BACNET_STACK_DIR "${MKDDC_REPOSITORY_ROOT}/third_party/bacnet-stack")
    if(NOT EXISTS "${MKDDC_BACNET_STACK_DIR}/CMakeLists.txt")
      message(FATAL_ERROR
        "MKDDC_ENABLE_BACNET=ON nhưng không thấy cây vendor bacnet-stack ở\n"
        "  ${MKDDC_BACNET_STACK_DIR}\n"
        "Cây này phải nằm trong repo (OD-BAC-009). Nếu thiếu thì hoặc checkout\n"
        "chưa đầy đủ, hoặc ai đó đã xoá nó. Dựng lại bằng:\n"
        "  scripts/vendor_bacnet_stack.sh      (cần mạng MỘT lần)\n"
        "Kiểm bằng:\n"
        "  scripts/verify_vendor_bacnet_stack.sh   (offline)")
    endif()
    set(BACNET_STACK_BUILD_APPS OFF CACHE BOOL "" FORCE)
    set(BACDL_BIP ON CACHE BOOL "" FORCE)
    set(BACDL_BIP6 OFF CACHE BOOL "" FORCE)
    set(BAC_ROUTING OFF CACHE BOOL "" FORCE)
    # EXCLUDE_FROM_ALL: chỉ dựng phần iobus thật sự link tới, không kéo theo
    # target install/export của upstream vào `all`.
    add_subdirectory("${MKDDC_BACNET_STACK_DIR}"
                     "${CMAKE_CURRENT_BINARY_DIR}/_bacnet_stack" EXCLUDE_FROM_ALL)
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
    adapters/bacnet/bacnet_config.cpp
    adapters/bacnet/bacnet_priority.cpp
    adapters/bacnet/bacnet_cov.cpp
    adapters/bacnet/bacnet_schedule.cpp
    adapters/bacnet/bacnet_reliability.cpp
    adapters/bacnet/bacnet_alarm.cpp
    adapters/bacnet/bacnet_objects.cpp
    adapters/bacnet/bacnet_server.cpp)

# ---- Modbus sources (logic compile unconditionally; libmodbus API guarded) ----
set(MODBUS_SOURCES
    adapters/modbus_rtu/fieldbus_config.cpp
    adapters/modbus_rtu/device_profile.cpp
    adapters/modbus_rtu/register_codec.cpp
    adapters/modbus_rtu/poll_scheduler.cpp
    adapters/modbus_rtu/poll_group.cpp
    adapters/modbus_rtu/write_verify.cpp
    adapters/modbus_rtu/ext_cache.cpp
    adapters/modbus_rtu/fieldbus_metrics.cpp
    adapters/modbus_rtu/bus_worker.cpp
    adapters/modbus_rtu/control_channel.cpp
    adapters/modbus_rtu/modbus_master.cpp
    adapters/modbus_rtu/modbus_tcp.cpp)

add_library(iobus_build_settings INTERFACE)
target_include_directories(iobus_build_settings INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/domain
    ${CMAKE_CURRENT_SOURCE_DIR}/application
    ${CMAKE_CURRENT_SOURCE_DIR}/adapters
    ${CMAKE_CURRENT_SOURCE_DIR}/adapters/bacnet
    ${CMAKE_CURRENT_SOURCE_DIR}/adapters/modbus_rtu
    ${CONTRACT_IOP_DIR}
    ${CONTRACT_SHM_DIR}
    ${CONTRACT_CONFIG_DIR})
target_link_libraries(iobus_build_settings INTERFACE pthread rt) # rt: shm/clock

# Boundary CMake của Iobus: domain không link adapter; composition root chỉ
# nhận aggregate interface ở cuối chuỗi dependency.
add_library(iobus_domain STATIC
    domain/io/io_scaling.cpp
    domain/io/io_conditioning.cpp
    domain/io/io_cache.cpp
    domain/diagnostics/iobus_metrics.cpp)
target_link_libraries(iobus_domain PUBLIC iobus_build_settings)

add_library(iobus_application STATIC
    application/config/iobus_config.cpp
    application/bridge/core_bridge.cpp
    application/bridge/output_command.cpp
    application/diagnostics/alarm_publisher.cpp)
target_link_libraries(iobus_application PUBLIC iobus_domain iobus_build_settings)

add_library(iobus_iop_adapter STATIC
    adapters/iop/iop_port.cpp
    adapters/iop/iop_frame.cpp
    adapters/iop/iop_crc.cpp
    adapters/iop/iop_client.cpp
    adapters/iop/iop_parser.cpp)
target_link_libraries(iobus_iop_adapter PUBLIC iobus_domain iobus_build_settings)

add_library(iobus_platform_adapter STATIC
    adapters/platform/systemd_notify.cpp
    adapters/platform/realtime.cpp
    adapters/platform/network_address.cpp)
target_link_libraries(iobus_platform_adapter PUBLIC iobus_build_settings)

add_library(iobus_bacnet_adapter STATIC ${BACNET_SOURCES})
target_link_libraries(iobus_bacnet_adapter PUBLIC
    iobus_application iobus_domain iobus_build_settings)

add_library(iobus_modbus_adapter STATIC ${MODBUS_SOURCES})
target_link_libraries(iobus_modbus_adapter PUBLIC iobus_build_settings)

add_library(iobus_lib INTERFACE)
target_link_libraries(iobus_lib INTERFACE
    iobus_application
    iobus_iop_adapter
    iobus_bacnet_adapter
    iobus_modbus_adapter
    iobus_platform_adapter
    iobus_domain
    iobus_build_settings)

if(MKDDC_ENABLE_BACNET)
  target_compile_definitions(iobus_bacnet_adapter PUBLIC MKDDC_ENABLE_BACNET)
  if(BACNET_STACK_FOUND)
    target_include_directories(iobus_bacnet_adapter PUBLIC ${BACNET_STACK_INCLUDE_DIRS})
    target_link_libraries(iobus_bacnet_adapter PUBLIC ${BACNET_STACK_LIBRARIES})
  else()
    target_link_libraries(iobus_bacnet_adapter PUBLIC ${BACNET_STACK_TARGET})
  endif()
endif()

if(MKDDC_ENABLE_MODBUS)
  target_compile_definitions(iobus_modbus_adapter PUBLIC MKDDC_ENABLE_MODBUS)
  target_include_directories(iobus_modbus_adapter PUBLIC ${LIBMODBUS_INCLUDE_DIRS})
  target_link_libraries(iobus_modbus_adapter PUBLIC ${LIBMODBUS_LIBRARIES})
endif()

add_executable(mkddc-iobus bootstrap/main.cpp)
target_link_libraries(mkddc-iobus PRIVATE iobus_lib)
mkddc_apply_provenance(mkddc-iobus)

# ---- dev tools (06 §11: build chung CMakeLists iobus) ----
add_executable(fake_mcu ${TOOLS_DIR}/fake_mcu/fake_mcu.cpp)
target_include_directories(fake_mcu PRIVATE ${CONTRACT_IOP_DIR})
target_link_libraries(fake_mcu PRIVATE m)

add_executable(shm_dump_io ${TOOLS_DIR}/shm_dump_io/shm_dump_io.c)
target_include_directories(shm_dump_io PRIVATE
    ${CONTRACT_IOP_DIR}
    ${CONTRACT_SHM_DIR})
target_link_libraries(shm_dump_io PRIVATE rt)

# ---- tests (GoogleTest — ưu tiên bản hệ thống, fallback FetchContent) ----
option(IOBUS_BUILD_TESTS "Build iobus unit tests" ON)
if(IOBUS_BUILD_TESTS)
  # OD-BAC-009: bỏ đường tải googletest từ kho công cộng. Nhánh `FetchContent` cũ
  # KHÔNG phải một fallback đang chạy được — nó tải tarball qua HTTP và nhận 403
  # ở mọi môi trường có egress policy. Nó chỉ trông như còn sống vì
  # `find_package` phía trên thành công trên máy có `libgtest-dev`; máy sạch thì
  # nó đứt, và thông điệp lỗi của `FetchContent` không nói được nguyên nhân.
  #
  # Nay thiếu GTest là FATAL_ERROR nói thẳng cách sửa. Vendor googletest nằm
  # ngoài phạm vi Issue này (4/9 khai báo `FetchContent` googletest nằm ở
  # apps/core, apps/hmi, apps/netcfg) — xem #714.
  find_package(GTest QUIET)
  if(NOT GTest_FOUND)
    message(FATAL_ERROR
      "IOBUS_BUILD_TESTS=ON nhưng không tìm thấy GoogleTest.\n"
      "Cài gói hệ thống:\n"
      "  apt-get update && apt-get install -y libgtest-dev\n"
      "Hoặc tắt test của iobus: -DIOBUS_BUILD_TESTS=OFF\n"
      "Không có đường tải tự động: OD-BAC-009 cấm phụ thuộc egress lúc dựng.")
  endif()
  enable_testing()
  add_executable(iobus_tests
      tests/test_iop_crc.cpp tests/test_iop_frame.cpp tests/test_iop_parser.cpp
      tests/test_io_scaling.cpp tests/test_io_conditioning.cpp tests/test_output_command.cpp
      tests/test_iop_client_fake_mcu.cpp
      tests/test_iobus_config.cpp tests/test_io_cache.cpp tests/test_shm_layout.cpp
      tests/test_network_address.cpp
      tests/test_realtime_memlock.cpp
      adapters/bacnet/tests/test_bacnet_priority.cpp
      adapters/bacnet/tests/test_bacnet_reliability.cpp
      adapters/bacnet/tests/test_bacnet_object_map.cpp
      adapters/bacnet/tests/test_bacnet_cov.cpp
      adapters/bacnet/tests/test_bacnet_schedule.cpp
      adapters/bacnet/tests/test_bacnet_loopback.cpp
      adapters/modbus_rtu/tests/test_device_profile.cpp
      adapters/modbus_rtu/tests/test_register_codec.cpp
      adapters/modbus_rtu/tests/test_poll_scheduler.cpp
      adapters/modbus_rtu/tests/test_poll_group.cpp
      adapters/modbus_rtu/tests/test_write_verify.cpp
      adapters/modbus_rtu/tests/test_ext_cache.cpp
      adapters/modbus_rtu/tests/test_bus_worker.cpp
      adapters/modbus_rtu/tests/test_control_channel.cpp
      adapters/modbus_rtu/tests/test_modbus_master_fake.cpp
      adapters/modbus_rtu/tests/test_modbus_tcp.cpp
      adapters/modbus_rtu/tests/test_frame_ring.cpp)
  target_link_libraries(iobus_tests PRIVATE iobus_lib)
  # GCC13 -O3 false positive (PR109945) với vector<struct nhỏ> trong test fixture
  target_compile_options(iobus_tests PRIVATE -Wno-error=stringop-overflow)
  if(TARGET GTest::gtest_main)
    target_link_libraries(iobus_tests PRIVATE GTest::gtest_main)
  else()
    target_link_libraries(iobus_tests PRIVATE gtest_main)
  endif()
  include(GoogleTest)
  # `gtest_discover_tests` CHẠY binary ngay sau khi link để liệt kê test. Khi
  # cross-compile cho aarch64 trên máy build x86_64, binary đó không chạy được
  # và build đứt ở bước post-link — dù chính binary lại là thứ ta cần mang lên
  # board. Ở chế độ cross, đăng ký một test gộp và để board tự chạy.
  if(CMAKE_CROSSCOMPILING)
    add_test(NAME iobus_tests COMMAND iobus_tests)
  else()
    gtest_discover_tests(iobus_tests)
  endif()
endif()
