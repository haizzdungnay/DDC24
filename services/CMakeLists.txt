# MK-DDC-24 — build toàn bộ service SOM + dev tools từ 1 lệnh:
#   cmake -S services -B build/services && cmake --build build/services -j
# Build riêng từng service (khuyến nghị khi dev):
#   cmake -S services/iobus -B build/iobus   (kèm fake_mcu + shm_dump_io)
#   cmake -S services/core  -B build/core
cmake_minimum_required(VERSION 3.16)
project(mkddc-services CXX C)

enable_testing()   # cho phép `ctest --test-dir build/services` chạy test cả 2 service
add_subdirectory(iobus)
add_subdirectory(core)
add_subdirectory(netcfg)

option(MKDDC_ENABLE_HMI "Build mkddc-hmi TFT local display service" OFF)
if(MKDDC_ENABLE_HMI)
    add_subdirectory(hmi)
endif()
