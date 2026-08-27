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
    application/programming/programming_runtime_coordinator.cpp
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
    application/st/st_runtime_snapshot.cpp
    application/programming/program_candidate_registry.cpp
    application/st/st_signal_bus.cpp
    application/st/st_value_trace.cpp
    application/st/st_process_image.cpp
    application/st/st_retain.cpp
    application/st/st_journal.cpp
    # T59-401: runtime cần LOADER package v2 để nạp gói nhiều Program.
    # Chỉ thêm TU này, không kéo cả `st_compiler_lib` vào nhị phân điều
    # khiển — compiler không có việc gì trên board đang chạy.
    application/st/st_package_v2.cpp
    application/st/st_pou_registry.cpp
    application/st/st_fb_instance_layout.cpp
    application/st/st_control_api.cpp)
target_link_libraries(core_application PUBLIC
    core_domain core_build_settings PkgConfig::SODIUM)

# T59-607 — KHOÁ PHÁT HÀNH PHẢI THỰC SỰ ĐI ĐƯỢC VÀO BINARY.
#
# `st_public_key.hpp` ghi từ lâu: "build release phải truyền
# -DMKDDC_ST_PUBLIC_KEY_HEX=<64 hex> để thay khoá test". Nhưng KHÔNG file CMake
# nào biến biến đó thành compile definition, nên `#ifdef MKDDC_ST_PUBLIC_KEY_HEX`
# trong `st_public_key.cpp` chưa bao giờ đúng: mọi binary từng dựng — kể cả bản
# đem deploy — đều nhúng KHOÁ TEST cam kết trong repo. CMake chỉ lặng lẽ cảnh
# báo "Manually-specified variables were not used by the project", một dòng dễ
# trôi giữa hàng trăm dòng cấu hình.
#
# Kiểm độ dài ngay tại configure: một khoá hex thiếu ký tự sẽ làm `decode_key()`
# thất bại lúc chạy và **âm thầm rơi về khoá test** — đúng thứ cần chặn.
if(DEFINED MKDDC_ST_PUBLIC_KEY_HEX AND NOT MKDDC_ST_PUBLIC_KEY_HEX STREQUAL "")
    string(LENGTH "${MKDDC_ST_PUBLIC_KEY_HEX}" _mkddc_st_key_len)
    if(NOT _mkddc_st_key_len EQUAL 64)
        message(FATAL_ERROR
            "MKDDC_ST_PUBLIC_KEY_HEX phải là đúng 64 ký tự hex (hiện ${_mkddc_st_key_len})")
    endif()
    if(NOT "${MKDDC_ST_PUBLIC_KEY_HEX}" MATCHES "^[0-9a-fA-F]+$")
        message(FATAL_ERROR "MKDDC_ST_PUBLIC_KEY_HEX chứa ký tự không phải hex")
    endif()
    target_compile_definitions(core_application PRIVATE
        MKDDC_ST_PUBLIC_KEY_HEX="${MKDDC_ST_PUBLIC_KEY_HEX}")
    message(STATUS "ST public key: RELEASE (từ -DMKDDC_ST_PUBLIC_KEY_HEX)")
else()
    message(STATUS "ST public key: TEST (khoá cam kết trong repo — không dùng cho phát hành)")
endif()

# Adapter được phép phụ thuộc application/domain; hai target phía trong không
# link ngược target này.
add_library(core_adapters STATIC
    adapters/config/safe_state_config.cpp
    adapters/ipc/config_reload.cpp
    adapters/ipc/iobus_reader.cpp
    adapters/ipc/output_writer.cpp
    adapters/ipc/program_ipc_unix.cpp
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
# `st_pou_registry`/`st_fb_instance_layout`/`st_package_v2` nay thuộc
# `core_application` (T59-401: runtime cần loader package v2). `st_compiler_lib`
# link `core_lib` nên vẫn dùng được — biên dịch lại ở đây sẽ tạo ký hiệu trùng.
add_library(st_compiler_lib STATIC
    application/st/st_parser.cpp
    application/st/st_semantic.cpp application/st/st_review_gate.cpp
    application/st/st_compile.cpp application/st/st_ir.cpp
    application/st/st_artifact_manifest.cpp
    application/st/st_fbd_model.cpp application/st/st_fbd_compile.cpp)
target_link_libraries(st_compiler_lib PUBLIC core_lib)

add_executable(mkddc-core bootstrap/main.cpp)
target_link_libraries(mkddc-core PRIVATE core_lib)
mkddc_apply_provenance(mkddc-core)

# T59-505: E2E host dùng cùng scheduler/coordinator/IPC/loader production
# nhưng không giả vờ có I/O vật lý. Target riêng giữ ranh giới
# bằng chứng rõ: PASS simulator không phải PASS target/HIL.
add_executable(mkddc-programming-core-sim
    application/programming/programming_core_sim_main.cpp)
target_link_libraries(mkddc-programming-core-sim PRIVATE core_lib)
mkddc_apply_provenance(mkddc-programming-core-sim)

# T59-814 / ADR-053 — thư viện THUẦN cho sandbox mô phỏng.
#
# Danh sách TU ở đây là một phần của biên an toàn, không phải tiện lợi build:
# nó cố ý KHÔNG link `core_domain` (PointTable/PointWriter/PriorityResolver)
# hay bất kỳ adapter thiết bị nào. Worker mô phỏng phải dùng ĐÚNG loader và
# executor production — hai bộ ngữ nghĩa sẽ trôi khỏi nhau — nhưng tuyệt đối
# không được có sẵn trong binary một cạnh nào dẫn tới đường ghi thiết bị.
#
# Thêm một TU vào danh sách này là một thay đổi biên an toàn và phải đi kèm
# `scripts/verify_programming_sim_worker_boundary.py` còn xanh.
# Máy chạy mô phỏng tách riêng khỏi danh sách TU của ST: `core_tests` cần nó
# nhưng đã có sẵn ST qua `core_lib`, và nạp hai lần cùng một TU vào một binary
# là lỗi link chứ không phải chuyện thẩm mỹ.
add_library(core_sim_engine STATIC
    application/programming/simulation/sim_session.cpp
    application/programming/simulation/sim_sandbox.cpp)
target_link_libraries(core_sim_engine PUBLIC core_build_settings)

add_library(core_st_sandbox STATIC
    application/st/st_program.cpp
    application/st/st_limits.cpp
    application/st/st_loader.cpp
    application/st/st_exec.cpp
    application/st/st_runtime.cpp
    application/st/st_retain.cpp
    application/st/st_signal_bus.cpp
    application/st/st_public_key.cpp
    application/st/st_pou_registry.cpp
    application/st/st_fb_instance_layout.cpp
    application/st/st_package_v2.cpp)
target_link_libraries(core_st_sandbox PUBLIC core_build_settings PkgConfig::SODIUM)

add_executable(mkddc-programming-sim-worker
    application/programming/programming_sim_worker_main.cpp)
target_link_libraries(mkddc-programming-sim-worker PRIVATE core_sim_engine core_st_sandbox)
mkddc_apply_provenance(mkddc-programming-sim-worker)

# FW-SOM-IEC-002 item 2: validate gateway CLI cho BE gọi (fixed argv, source
# luôn qua file path, không shell-eval — xem st/st_validate_main.cpp).
add_executable(mkddc-st-validate application/st/st_validate_main.cpp)
target_link_libraries(mkddc-st-validate PRIVATE st_compiler_lib)

# ACTION 15: công cụ CHÍNH THỨC để BE sinh artifact đã ký.
add_executable(mkddc-st-package-golden application/st/st_package_golden_main.cpp)
target_link_libraries(mkddc-st-package-golden PRIVATE st_compiler_lib)

add_executable(mkddc-st-compile application/st/st_compile_main.cpp)
target_link_libraries(mkddc-st-compile PRIVATE st_compiler_lib)

# T59-302/T59-305: lắp package v2 bằng ĐÚNG writer production, không cài lại
# định dạng ở lớp BE.
add_executable(mkddc-st-package application/st/st_package_main.cpp)
target_link_libraries(mkddc-st-package PRIVATE st_compiler_lib)

# SCHD-133: mô phỏng lịch bằng ĐÚNG engine của controller. Backend gọi binary
# này thay vì cài lại thuật toán đánh giá trong Go — bản cài lại sẽ đúng cho tới
# ngày nó lệch khỏi bản C++, và ngày đó không ai biết.
add_executable(mkddc-schedule-sim application/schedule/schedule_sim_main.cpp)
target_link_libraries(mkddc-schedule-sim PRIVATE core_lib)
mkddc_apply_provenance(mkddc-schedule-sim)

# `T57-2.13`/`T57-3.13` (`ADR-048`): bản song sinh của mkddc-schedule-sim cho
# phía cảnh báo. Backend KHÔNG được tính xấp xỉ thay khi thiếu binary này — một
# bản gần đúng sẽ được tin như bản thật đúng lúc người dùng đang đặt ngưỡng an
# toàn, nên thiếu binary phải là 503 chứ không phải một con số đoán.
add_executable(mkddc-alarm-sim application/alarm/alarm_sim_main.cpp)
target_link_libraries(mkddc-alarm-sim PRIVATE core_lib)
# Gắn tĩnh libstdc++/libgcc. Board Buildroot chỉ có tới `GLIBCXX_3.4.30`, còn
# toolchain cross ở máy build sinh tham chiếu `GLIBCXX_3.4.32` cho các symbol mà
# binary này dùng (iostream/sstream + nlohmann). Bản gắn động nạp được ở máy dev
# nhưng **chết ngay trên board** — và triệu chứng là một endpoint 503 khó lần,
# không phải một lỗi build. Đã đo trên board thật ngày 2026-08-19.
target_link_options(mkddc-alarm-sim PRIVATE -static-libstdc++ -static-libgcc)
mkddc_apply_provenance(mkddc-alarm-sim)

option(CORE_BUILD_TESTS "Build core unit tests" ON)
if(CORE_BUILD_TESTS)
  find_package(Python3 REQUIRED COMPONENTS Interpreter)
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
      application/programming/tests/test_programming_runtime_coordinator.cpp
      application/programming/tests/test_programming_package_v2_stage.cpp
      application/programming/tests/test_programming_stage_atomicity.cpp
      adapters/ipc/tests/test_program_ipc_unix.cpp
      application/programming/tests/test_program_error_catalog.cpp
      application/programming/tests/test_programming_sim_session.cpp
      adapters/ipc/tests/test_web_ipc.cpp domain/graph/tests/test_graph_runtime.cpp
      adapters/config/test_safe_state_config.cpp
      adapters/ipc/tests/test_config_reload.cpp adapters/persistence/test_state_snapshot.cpp
      adapters/bacnet/tests/test_bacnet_objtable.cpp
      application/schedule/tests/test_schedule_runtime.cpp domain/graph/tests/test_runtime_point_snapshot.cpp
      domain/graph/tests/test_ext_256_datagram.cpp
      adapters/diagnostics/tests/test_core_metrics.cpp adapters/ipc/tests/test_output_writer.cpp
      application/st/tests/test_st_io_map.cpp application/st/tests/test_st_resolve_io_bindings.cpp
      application/st/tests/test_st_cyclic_runtime.cpp
      application/st/tests/test_st_validate_cli.cpp application/st/tests/test_st_compile_cli.cpp
      application/st/tests/test_st_limits.cpp
      application/st/tests/test_st_lang.cpp application/st/tests/test_st_ir.cpp
      application/st/tests/test_st_artifact_manifest.cpp
      application/st/tests/test_st_fbd_model.cpp
      application/st/tests/test_st_library_registry.cpp
      application/st/tests/test_st_review_gate.cpp
      application/st/tests/test_st_mb_rtu_binding.cpp
      application/st/tests/test_st_pou_parser.cpp
      application/st/tests/test_st_pou_registry.cpp
      application/st/tests/test_st_function_purity.cpp
      application/st/tests/test_st_fb_instance_layout.cpp
      application/st/tests/test_st_fbd_user_pou.cpp
      application/st/tests/test_st_package_v2.cpp
      application/st/tests/test_st_fbd_compile.cpp
      application/st/tests/test_st_library_conformance.cpp
      application/st/tests/test_st_artifact_trust.cpp
      application/st/tests/test_st_fuzz_regression.cpp application/st/tests/test_st_exec.cpp
      application/programming/tests/test_program_candidate_registry.cpp
      application/programming/tests/test_programming_package_lifecycle.cpp
      application/st/tests/test_st_program_lanes.cpp
      application/st/tests/test_st_value_trace.cpp
      application/st/tests/test_st_signal_bus.cpp
      application/st/tests/test_st_program_release.cpp
      application/st/tests/test_st_scheduler.cpp application/st/tests/test_st_integration.cpp
      application/st/tests/test_st_retain.cpp application/st/tests/test_st_control_api.cpp
      application/st/tests/test_st_journal.cpp
      tests/allocation_probe.cpp)
  target_link_libraries(core_tests PRIVATE st_compiler_lib core_sim_engine)
  target_compile_options(core_tests PRIVATE -Wno-error=stringop-overflow)
  # test_st_validate_cli.cpp fork+execv nhị phân thật — cần path tuyệt đối,
  # không đoán build layout (generator expression cho đúng dù đổi cấu trúc).
  target_compile_definitions(core_tests PRIVATE
      ST_VALIDATE_CLI_PATH="$<TARGET_FILE:mkddc-st-validate>"
      ST_COMPILE_CLI_PATH="$<TARGET_FILE:mkddc-st-compile>"
      ST_PACKAGE_CLI_PATH="$<TARGET_FILE:mkddc-st-package>"
      ST_SAMPLE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/application/st/samples"
      PROGRAMMING_IPC_CONTRACT_DIR="${MKDDC_CONTRACTS_SOURCE_DIR}/ipc/programming_v1"
      PROGRAMMING_PROFILE_CONTRACT_DIR="${CONTRACT_PROGRAMMING_DIR}"
      CORE_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
  add_dependencies(core_tests mkddc-st-validate mkddc-st-compile mkddc-st-package)
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

  # TASK-PROG-300: kiểm artifact sau link, không chỉ grep source. Runtime
  # application phải có loader/executor nhưng tuyệt đối không có parser/compiler;
  # executable production cũng không được kéo các symbol đó qua dependency ẩn.
  add_test(NAME programming_runtime_archive_symbol_boundary
      COMMAND ${Python3_EXECUTABLE}
              ${MKDDC_REPOSITORY_ROOT}/scripts/verify_programming_runtime_symbols.py
              --binary $<TARGET_FILE:core_application>
              --nm ${CMAKE_NM}
              --require-runtime)
  add_test(NAME programming_core_executable_symbol_boundary
      COMMAND ${Python3_EXECUTABLE}
              ${MKDDC_REPOSITORY_ROOT}/scripts/verify_programming_runtime_symbols.py
              --binary $<TARGET_FILE:mkddc-core>
              --nm ${CMAKE_NM})

  # T59-814 / ADR-053 — biên an toàn của worker mô phỏng, đọc BINARY sau link.
  #
  # Hai cổng riêng vì chúng trả lời hai câu khác nhau: cổng symbol nói "worker
  # không có sẵn cạnh nào tới đường điều khiển", còn cổng hành vi nói "hàng rào
  # tiến trình thật sự chặn, bắt tay thật sự fail-closed và phiên thật sự tất
  # định". Cái nào thiếu thì `SIM_SAFE` chưa được coi là đã chứng minh.
  add_test(NAME programming_sim_worker_symbol_boundary
      COMMAND ${Python3_EXECUTABLE}
              ${MKDDC_REPOSITORY_ROOT}/scripts/verify_programming_sim_worker_boundary.py
              --binary $<TARGET_FILE:mkddc-programming-sim-worker>
              --nm ${CMAKE_NM})
  if(NOT CMAKE_CROSSCOMPILING)
    add_test(NAME programming_sim_worker_behaviour
        COMMAND ${Python3_EXECUTABLE}
                ${MKDDC_REPOSITORY_ROOT}/scripts/verify_programming_sim_worker.py
                --binary $<TARGET_FILE:mkddc-programming-sim-worker>
                --compile-cli $<TARGET_FILE:mkddc-st-compile>
                --package-cli $<TARGET_FILE:mkddc-st-package>)
  endif()

  # `T57-2.13`/`T57-3.13`: kiểm ở mức BINARY, vì giá trị của engine nằm ở chỗ nó
  # là đúng cái binary backend gọi — một unit test gọi thẳng AlarmRuntime sẽ bỏ
  # lọt việc hợp đồng stdin/stdout lệch khỏi thứ Go gửi và đọc.
  if(NOT CMAKE_CROSSCOMPILING)
    add_test(NAME alarm_sim_behaviour
        COMMAND ${Python3_EXECUTABLE}
                ${MKDDC_REPOSITORY_ROOT}/scripts/verify_alarm_sim.py
                --binary $<TARGET_FILE:mkddc-alarm-sim>)
  endif()
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
