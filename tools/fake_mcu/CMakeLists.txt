# Standalone build (bình thường fake_mcu build chung CMakeLists của iobus — 06 §11):
#   cmake -S tools/fake_mcu -B build/fake_mcu && cmake --build build/fake_mcu
cmake_minimum_required(VERSION 3.16)
if(NOT TARGET fake_mcu)
  project(fake_mcu CXX)
  set(CMAKE_CXX_STANDARD 17)
  set(CMAKE_CXX_STANDARD_REQUIRED ON)
  add_compile_options(-Wall -Wextra -Werror)
  add_executable(fake_mcu fake_mcu.cpp)
  target_include_directories(fake_mcu PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../../shared)
  target_link_libraries(fake_mcu PRIVATE m)
endif()
