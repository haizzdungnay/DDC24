# Standalone build (bình thường shm_dump_io build chung CMakeLists của iobus — 06 §11):
#   cmake -S tools/shm_dump_io -B build/shm_dump_io && cmake --build build/shm_dump_io
cmake_minimum_required(VERSION 3.16)
if(NOT TARGET shm_dump_io)
  project(shm_dump_io C)
  add_compile_options(-Wall -Wextra -Werror)
  add_executable(shm_dump_io shm_dump_io.c)
  target_include_directories(shm_dump_io PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../../shared)
  target_link_libraries(shm_dump_io PRIVATE rt)
endif()
