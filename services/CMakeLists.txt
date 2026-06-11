# MK-DDC-24 — build toàn bộ service SOM + dev tools từ 1 lệnh:
#   cmake -S services -B build/services && cmake --build build/services -j
# Build riêng từng service (khuyến nghị khi dev):
#   cmake -S services/iobus -B build/iobus   (kèm fake_mcu + shm_dump_io)
#   cmake -S services/core  -B build/core
cmake_minimum_required(VERSION 3.16)
project(mkddc-services CXX C)

add_subdirectory(iobus)
add_subdirectory(core)
