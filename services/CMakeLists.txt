# MK-DDC-24 — build toàn bộ service SOM + dev tools từ 1 lệnh:
#   cmake -S services -B build/services && cmake --build build/services -j
# Build riêng từng service (khuyến nghị khi dev):
#   cmake -S services/iobus -B build/iobus   (kèm fake_mcu + shm_dump_io)
#   cmake -S services/core  -B build/core
cmake_minimum_required(VERSION 3.16)
project(mkddc-services CXX C)

enable_testing()   # cho phép `ctest --test-dir build/services` chạy test cả 2 service

# ---- Sanitizer presets (Phase 7 / VG-01, VG-02) ----
#
#   cmake -S services -B build/asan  -DMKDDC_SANITIZE=address
#   cmake -S services -B build/ubsan -DMKDDC_SANITIZE=undefined
#
# Vì sao cần: -Werror bắt được lỗi compile-time, KHÔNG bắt được lỗi bộ nhớ và
# hành vi không xác định lúc chạy. Loader IR không kiểm biên sau khi load
# (TYPED_IR_ARTIFACT_SPEC §6.1) nên một lỗi ở đó là lỗi an toàn bộ nhớ — đúng
# loại mà ASan sinh ra để bắt.
set(MKDDC_SANITIZE "" CACHE STRING "Sanitizer: address | undefined | thread | rỗng")

if(MKDDC_SANITIZE)
  message(STATUS "MKDDC: bật sanitizer '${MKDDC_SANITIZE}'")
  add_compile_options(-fsanitize=${MKDDC_SANITIZE} -fno-omit-frame-pointer -g)
  add_link_options(-fsanitize=${MKDDC_SANITIZE})
  if(MKDDC_SANITIZE STREQUAL "undefined")
    # Không cho UBSan chỉ in cảnh báo rồi chạy tiếp: một UB im lặng lọt qua
    # test là tệ hơn không chạy UBSan, vì nó tạo cảm giác an toàn giả.
    add_compile_options(-fno-sanitize-recover=all)
  endif()
  # Tắt ĐÚNG MỘT cảnh báo, chỉ với GCC, chỉ trong build sanitizer: GCC 13 báo
  # maybe-uninitialized trong <regex> của libstdc++ (kéo vào qua gtest) ở mức
  # tối ưu mà sanitizer dùng. Đây là false positive trong header hệ thống,
  # không phải code dự án — xác nhận bằng việc build thường (-O2) sạch hoàn
  # toàn. Giữ nguyên -Werror cho mọi cảnh báo khác.
  # Clang không có cờ này nên phải gate theo compiler, nếu không build fuzz
  # (dùng clang) sẽ fail vì -Wunknown-warning-option.
  if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    add_compile_options(-Wno-error=maybe-uninitialized)
  endif()
endif()

add_subdirectory(iobus)
add_subdirectory(core)
add_subdirectory(netcfg)

option(MKDDC_ENABLE_HMI "Build mkddc-hmi TFT local display service" OFF)
if(MKDDC_ENABLE_HMI)
    add_subdirectory(hmi)
endif()

# Lớp giao thức của firmware MCU, kiểm trên host.
#
# `fw/src/iop/` là C thuần dùng chung `shared/iop_protocol.h` với phía SOM, và
# không chạm HAL — nên nó chạy được trong cùng bộ ctest này. Đặt ở đây thay vì
# một quy trình build riêng là có chủ đích: hợp đồng IOP có HAI phía, và cách
# chắc chắn nhất để hai phía trôi khỏi nhau là để chúng ở hai cổng kiểm khác
# nhau. Bo mạch chưa fab nên đây là phần firmware kiểm chứng được ngay.
option(MKDDC_ENABLE_FW_HOSTCHECK "Build host-side tests for MCU firmware protocol layer" ON)
if(MKDDC_ENABLE_FW_HOSTCHECK AND IOBUS_BUILD_TESTS)
    add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../fw/hostcheck fw_hostcheck)
endif()
