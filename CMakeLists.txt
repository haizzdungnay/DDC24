# Entrypoint CMake duy nhất cho source SOM và firmware hostcheck.
# Path vật lý được tập trung trong platform/cmake/RepositoryPaths.cmake để
# migration không buộc CI, tool và developer script biết layout nội bộ.
cmake_minimum_required(VERSION 3.16)
project(mkddc-services CXX C)

enable_testing()
include(${CMAKE_CURRENT_SOURCE_DIR}/platform/cmake/RepositoryPaths.cmake)

set(MKDDC_SANITIZE "" CACHE STRING "Sanitizer: address | undefined | thread | rỗng")
if(MKDDC_SANITIZE)
  message(STATUS "MKDDC: bật sanitizer '${MKDDC_SANITIZE}'")
  add_compile_options(-fsanitize=${MKDDC_SANITIZE} -fno-omit-frame-pointer -g)
  add_link_options(-fsanitize=${MKDDC_SANITIZE})
  if(MKDDC_SANITIZE STREQUAL "undefined")
    add_compile_options(-fno-sanitize-recover=all)
  endif()
  if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    add_compile_options(-Wno-error=maybe-uninitialized)
  endif()
endif()

add_subdirectory(${MKDDC_IOBUS_SOURCE_DIR} iobus)
add_subdirectory(${MKDDC_CORE_SOURCE_DIR} core)
add_subdirectory(${MKDDC_NETCFG_SOURCE_DIR} netcfg)

option(MKDDC_ENABLE_HMI "Build mkddc-hmi TFT local display service" OFF)
if(MKDDC_ENABLE_HMI)
  add_subdirectory(${MKDDC_HMI_SOURCE_DIR} hmi)
endif()

option(MKDDC_ENABLE_FW_HOSTCHECK "Build host-side tests for MCU firmware protocol layer" ON)
if(MKDDC_ENABLE_FW_HOSTCHECK AND IOBUS_BUILD_TESTS)
  add_subdirectory(${MKDDC_FW_HOSTCHECK_SOURCE_DIR} fw_hostcheck)
endif()
