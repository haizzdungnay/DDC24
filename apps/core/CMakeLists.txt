cmake_minimum_required(VERSION 3.16)
project(mkddc-core CXX)
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

if(NOT DEFINED MKDDC_CONTRACTS_SOURCE_DIR)
  set(MKDDC_CONTRACTS_SOURCE_DIR "${MKDDC_REPOSITORY_ROOT}/contracts")
endif()
set(CONTRACT_SHM_DIR ${MKDDC_CONTRACTS_SOURCE_DIR}/shm)
set(CONTRACT_IOP_DIR ${MKDDC_CONTRACTS_SOURCE_DIR}/iop)
set(CONTRACT_CONFIG_DIR ${MKDDC_CONTRACTS_SOURCE_DIR}/config)
set(CONTRACT_PROGRAMMING_DIR ${MKDDC_CONTRACTS_SOURCE_DIR}/programming)

include(FetchContent)
FetchContent_Declare(nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(nlohmann_json)

find_package(PkgConfig REQUIRED)
pkg_check_modules(SODIUM REQUIRED IMPORTED_TARGET libsodium)

# Boundary build-time của Core. Mỗi lớp là một target riêng để CMake từ chối
# dependency ngược thay vì chỉ dựa vào quy ước thư mục.
add_library(core_build_settings INTERFACE)
target_include_directories(core_build_settings INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/domain
    ${CMAKE_CURRENT_SOURCE_DIR}/application
    ${CMAKE_CURRENT_SOURCE_DIR}/adapters
    ${CONTRACT_IOP_DIR}
    ${CONTRACT_SHM_DIR}
    ${CONTRACT_CONFIG_DIR}
    ${CONTRACT_PROGRAMMING_DIR})
target_link_libraries(core_build_settings INTERFACE
    pthread rt nlohmann_json::nlohmann_json)

add_library(core_domain STATIC
    domain/graph/point_table.cpp
    domain/graph/point_writer.cpp
    domain/graph/point_quality.cpp
    domain/graph/graph_runtime.cpp
    domain/graph/runtime_point_snapshot.cpp
    domain/priority/priority_resolver.cpp
    domain/safety/safe_state.cpp
    domain/safety/overrun_monitor.cpp)
target_link_libraries(core_domain PUBLIC core_build_settings)

add_library(core_application STATIC
    application/alarm/alarm_runtime.cpp
    application/programming/program_ipc_server.cpp
    application/schedule/schedule_runtime.cpp
    application/schedule/schedule_clock.cpp
    application/st/st_program.cpp
    application/st/st_limits.cpp
    application/st/st_runtime.cpp
    application/st/st_artifact.cpp
    application/st/st_io_map.cpp
    application/st/st_cyclic_runtime.cpp
    application/st/st_trace.cpp
    application/st/st_loader.cpp
    application/st/st_exec.cpp
    application/st/st_public_key.cpp
    application/st/st_scheduler.cpp
    application/st/st_process_image.cpp
    application/st/st_retain.cpp
    application/st/st_control_api.cpp)
target_link_libraries(core_application PUBLIC
    core_domain core_build_settings PkgConfig::SODIUM)

# Adapter được phép phụ thuộc application/domain; hai target phía trong không
# link ngược target này.
add_library(core_adapters STATIC
    adapters/config/safe_state_config.cpp
    adapters/ipc/config_reload.cpp
    adapters/ipc/iobus_reader.cpp
    adapters/ipc/output_writer.cpp
    adapters/persistence/state_snapshot.cpp
    adapters/bacnet/bacnet_objtable.cpp
    adapters/ipc/web_ipc.cpp
    adapters/diagnostics/core_metrics.cpp)
target_link_libraries(core_adapters PUBLIC core_application core_domain core_build_settings)

add_library(core_runtime STATIC application/runtime/scan_loop.cpp)
target_link_libraries(core_runtime PUBLIC
    core_adapters core_application core_domain core_build_settings)

# Tên aggregate giữ tương thích cho executable/test hiện hữu, nhưng không còn
# che giấu chiều dependency giữa domain, application và adapter.
add_library(core_lib INTERFACE)
target_link_libraries(core_lib INTERFACE
    core_runtime core_adapters core_application core_domain core_build_settings)

# libsodium: SHA-256 + Ed25519 cho artifact integrity (TYPED_IR_ARTIFACT_SPEC §3).
# Chọn libsodium thay vì GPG vì verify phải chạy IN-PROCESS trong vòng SCHED_FIFO:
# crypto_sign_verify_detached không cấp phát, không I/O, thời gian ổn định.

# st_compiler_lib TÁCH RIÊNG khỏi core_lib có chủ ý kiến trúc:
# PROGRAM_SOM_FW_DRAFT_DESIGN §4 cấm runtime thực thi source ST. Tách thư viện
# làm cho điều đó thành ràng buộc LINK-TIME chứ không phải kỷ luật lập trình —
# mkddc-core không liên kết st_compiler_lib nên không thể vô tình gọi parser.
# Chiều phụ thuộc: st_compiler_lib -> core_lib (không bao giờ ngược lại).
add_library(st_compiler_lib STATIC
    application/st/st_parser.cpp application/st/st_semantic.cpp
    application/st/st_compile.cpp application/st/st_ir.cpp
    application/st/st_fbd_model.cpp application/st/st_fbd_compile.cpp)
target_link_libraries(st_compiler_lib PUBLIC core_lib)

add_executable(mkddc-core bootstrap/main.cpp)
target_link_libraries(mkddc-core PRIVATE core_lib)
mkddc_apply_provenance(mkddc-core)

# FW-SOM-IEC-002 item 2: validate gateway CLI cho BE gọi (fixed argv, source
# luôn qua file path, không shell-eval — xem st/st_validate_main.cpp).
add_executable(mkddc-st-validate application/st/st_validate_main.cpp)
target_link_libraries(mkddc-st-validate PRIVATE st_compiler_lib)

# ACTION 15: công cụ CHÍNH THỨC để BE sinh artifact đã ký.
add_executable(mkddc-st-compile application/st/st_compile_main.cpp)
target_link_libraries(mkddc-st-compile PRIVATE st_compiler_lib)

# SCHD-133: mô phỏng lịch bằng ĐÚNG engine của controller. Backend gọi binary
# này thay vì cài lại thuật toán đánh giá trong Go — bản cài lại sẽ đúng cho tới
# ngày nó lệch khỏi bản C++, và ngày đó không ai biết.
add_executable(mkddc-schedule-sim application/schedule/schedule_sim_main.cpp)
target_link_libraries(mkddc-schedule-sim PRIVATE core_lib)
mkddc_apply_provenance(mkddc-schedule-sim)

option(CORE_BUILD_TESTS "Build core unit tests" ON)
if(CORE_BUILD_TESTS)
  target_compile_definitions(core_adapters PUBLIC CORE_BUILD_TESTS=1)
  target_compile_definitions(core_runtime PUBLIC CORE_BUILD_TESTS=1)
  target_compile_definitions(core_lib INTERFACE CORE_BUILD_TESTS=1)
  find_package(GTest QUIET)
  if(NOT GTest_FOUND)
    include(FetchContent)
    FetchContent_Declare(googletest
      URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip)
    FetchContent_MakeAvailable(googletest)
  endif()
  enable_testing()
  add_executable(core_tests
      adapters/ipc/tests/test_iobus_reader.cpp domain/graph/tests/test_point_quality.cpp
      domain/priority/test_priority_resolver.cpp
      domain/safety/tests/test_safe_state.cpp domain/safety/tests/test_overrun_monitor.cpp
      application/runtime/test_scan_loop.cpp
      application/programming/tests/test_program_ipc_server.cpp
      application/programming/tests/test_program_error_catalog.cpp
      adapters/ipc/tests/test_web_ipc.cpp domain/graph/tests/test_graph_runtime.cpp
      adapters/config/test_safe_state_config.cpp
      adapters/ipc/tests/test_config_reload.cpp adapters/persistence/test_state_snapshot.cpp
      adapters/bacnet/tests/test_bacnet_objtable.cpp
      application/schedule/tests/test_schedule_runtime.cpp domain/graph/tests/test_runtime_point_snapshot.cpp
      domain/graph/tests/test_ext_256_datagram.cpp
      adapters/diagnostics/tests/test_core_metrics.cpp adapters/ipc/tests/test_output_writer.cpp
      application/st/tests/test_st_io_map.cpp application/st/tests/test_st_cyclic_runtime.cpp
      application/st/tests/test_st_validate_cli.cpp application/st/tests/test_st_limits.cpp
      application/st/tests/test_st_lang.cpp application/st/tests/test_st_ir.cpp
      application/st/tests/test_st_fbd_model.cpp
      application/st/tests/test_st_fbd_compile.cpp
      application/st/tests/test_st_fuzz_regression.cpp application/st/tests/test_st_exec.cpp
      application/st/tests/test_st_scheduler.cpp application/st/tests/test_st_integration.cpp
      application/st/tests/test_st_retain.cpp application/st/tests/test_st_control_api.cpp
      tests/allocation_probe.cpp)
  target_link_libraries(core_tests PRIVATE st_compiler_lib)
  target_compile_options(core_tests PRIVATE -Wno-error=stringop-overflow)
  # test_st_validate_cli.cpp fork+execv nhị phân thật — cần path tuyệt đối,
  # không đoán build layout (generator expression cho đúng dù đổi cấu trúc).
  target_compile_definitions(core_tests PRIVATE
      ST_VALIDATE_CLI_PATH="$<TARGET_FILE:mkddc-st-validate>"
      ST_SAMPLE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/application/st/samples"
      PROGRAMMING_IPC_CONTRACT_DIR="${MKDDC_CONTRACTS_SOURCE_DIR}/ipc/programming_v1"
      PROGRAMMING_PROFILE_CONTRACT_DIR="${CONTRACT_PROGRAMMING_DIR}")
  add_dependencies(core_tests mkddc-st-validate)
  if(TARGET GTest::gtest_main)
    target_link_libraries(core_tests PRIVATE GTest::gtest_main)
  else()
    target_link_libraries(core_tests PRIVATE gtest_main)
  endif()
  include(GoogleTest)
  # Cô lập PLC SHM của test khỏi segment production.
  #
  # `BacnetObjTable::attach()` mở bằng O_CREAT|O_RDWR rồi memset toàn bộ segment.
  # Nếu test dùng đúng tên contract thì chạy test trên máy đang có service sẽ xoá
  # sạch SHM đang sống — và trên board lab thì test đỏ hàng loạt vì EACCES do
  # segment thuộc user `mkddc`. Đặt tên riêng cho test để hai bên không đụng nhau;
  # điều kiện tiên quyết để chạy CI runner ngay trên board theo ADR-022.
  gtest_discover_tests(core_tests
      PROPERTIES ENVIRONMENT "MKDDC_SHM_PLC_NAME=/mkddc_plc_shm_coretest")
endif()

# ---- Fuzz harness (Phase 7 / VG-03) ----
#   CXX=clang++ cmake -S . -B build/fuzz -DMKDDC_BUILD_FUZZ=ON \
#       -DMKDDC_SANITIZE=address -DCORE_BUILD_TESTS=OFF
#
# Cần clang (libFuzzer). Chạy kèm ASan để lỗi bộ nhớ lộ ra ngay tại input gây
# lỗi, thay vì hỏng âm thầm rồi crash ở chỗ khác.
option(MKDDC_BUILD_FUZZ "Build libFuzzer harnesses (cần clang)" OFF)
if(MKDDC_BUILD_FUZZ)
  if(NOT CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    message(FATAL_ERROR "MKDDC_BUILD_FUZZ cần clang++ (libFuzzer). Đặt CXX=clang++.")
  endif()
  foreach(fz st_parser st_loader st_fbd_model)
    add_executable(fuzz_${fz} application/st/fuzz/fuzz_${fz}.cpp)
    target_link_libraries(fuzz_${fz} PRIVATE st_compiler_lib)
    target_compile_options(fuzz_${fz} PRIVATE -fsanitize=fuzzer)
    target_link_options(fuzz_${fz} PRIVATE -fsanitize=fuzzer)
  endforeach()
endif()
