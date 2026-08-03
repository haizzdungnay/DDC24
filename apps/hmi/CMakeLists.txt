cmake_minimum_required(VERSION 3.16)
project(mkddc-hmi CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(MKDDC_ENABLE_HMI "Build mkddc-hmi TFT local display service" OFF)
if(NOT MKDDC_ENABLE_HMI)
    message(STATUS "HMI: disabled (set -DMKDDC_ENABLE_HMI=ON to build)")
    return()
endif()

if(NOT DEFINED MKDDC_REPOSITORY_ROOT)
    get_filename_component(MKDDC_REPOSITORY_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
endif()
if(NOT DEFINED MKDDC_CONTRACTS_SOURCE_DIR)
    set(MKDDC_CONTRACTS_SOURCE_DIR "${MKDDC_REPOSITORY_ROOT}/contracts")
endif()
set(CONTRACT_SHM_DIR ${MKDDC_CONTRACTS_SOURCE_DIR}/shm)

# ---- libdrm (DRM/KMS display backend) ----
find_package(PkgConfig REQUIRED)
pkg_check_modules(LIBDRM libdrm>=2.4.100 REQUIRED)
pkg_check_modules(FREETYPE2 freetype2 REQUIRED)

# ---- LVGL v9 ----
include(FetchContent)

# lv_conf.h: use LV_CONF_PATH so LVGL's CMake picks it up
set(LV_CONF_PATH "${CMAKE_CURRENT_SOURCE_DIR}/lv_conf.h" CACHE FILEPATH "" FORCE)
set(LV_CONF_BUILD_DISABLE_THORVG_INTERNAL ON CACHE BOOL "" FORCE)
set(LV_CONF_BUILD_DISABLE_EXAMPLES ON CACHE BOOL "" FORCE)
set(LV_CONF_BUILD_DISABLE_DEMOS ON CACHE BOOL "" FORCE)

FetchContent_Declare(lvgl
    GIT_REPOSITORY https://github.com/lvgl/lvgl.git
    GIT_TAG        v9.1.0
    GIT_SHALLOW    TRUE)
FetchContent_GetProperties(lvgl)
if(NOT lvgl_POPULATED)
    FetchContent_Populate(lvgl)
    # LVGL v9.1 emits absolute /usr/local install rules. Keep the vendored
    # static dependency out of the product install tree.
    add_subdirectory(${lvgl_SOURCE_DIR} ${lvgl_BINARY_DIR} EXCLUDE_FROM_ALL)
endif()
target_include_directories(lvgl PRIVATE ${FREETYPE2_INCLUDE_DIRS})
target_link_libraries(lvgl PUBLIC ${FREETYPE2_LIBRARIES})

# ---- nlohmann_json (point_db + alarm JSON parsing) ----
FetchContent_Declare(nlohmann_json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
set(JSON_Install OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(nlohmann_json)

# ---- hmi_lib: tất cả logic trừ main.cpp (để unit tests link được) ----
add_library(hmi_lib STATIC
    platform/systemd_notify.cpp
    api/hmi_api_client.cpp
    drm/drm_init.cpp
    drm/lv_drm_display.cpp
    input/evdev_touch.cpp
    input/gpio_buttons.cpp
    ui/nav_controller.cpp
    ui/fault_banner.cpp
    ui/screen_saver.cpp
    data/shm_reader.cpp
    data/point_db.cpp
    screens/alarm_model.cpp
    screens/network_model.cpp
    screens/screen_home.cpp
    screens/screen_io.cpp
    screens/screen_alarm.cpp
    screens/screen_control.cpp
    screens/screen_service.cpp
    i18n/locale.cpp)

target_include_directories(hmi_lib PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CONTRACT_SHM_DIR}
    ${LIBDRM_INCLUDE_DIRS})
target_include_directories(hmi_lib PUBLIC ${FREETYPE2_INCLUDE_DIRS})

target_link_libraries(hmi_lib PUBLIC
    lvgl::lvgl
    ${LIBDRM_LIBRARIES}
    pthread rt
    nlohmann_json::nlohmann_json)

target_compile_definitions(hmi_lib PUBLIC LV_CONF_INCLUDE_SIMPLE=1)
# Suppress GCC false-positive on LVGL internals
target_compile_options(hmi_lib PRIVATE -Wall -Wextra -Werror -Wno-error=unused-parameter)

# ---- main executable ----
add_executable(mkddc-hmi main.cpp)
target_link_libraries(mkddc-hmi PRIVATE hmi_lib)
target_compile_options(mkddc-hmi PRIVATE -Wall -Wextra -Werror)
install(TARGETS mkddc-hmi DESTINATION sbin)
install(FILES ${MKDDC_REPOSITORY_ROOT}/platform/systemd/mkddc-hmi.service
        DESTINATION lib/systemd/system)
install(FILES packaging/hmi.conf DESTINATION etc/mkddc)
install(FILES packaging/point_db.example.json DESTINATION share/mkddc)

# ---- unit tests ----
option(HMI_BUILD_TESTS "Build hmi unit tests" ON)
if(HMI_BUILD_TESTS)
    find_package(GTest QUIET)
    if(NOT GTest_FOUND)
        set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
        FetchContent_Declare(googletest
            URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
        FetchContent_MakeAvailable(googletest)
    endif()
    enable_testing()
    add_executable(hmi_tests
        tests/test_key_queue.cpp
        tests/test_shm_reader.cpp
        tests/test_point_db.cpp
        tests/test_alarm_model.cpp
        tests/test_network_model.cpp
        tests/test_hmi_api_client.cpp
        tests/test_locale.cpp
        tests/test_nav.cpp
        )
    target_link_libraries(hmi_tests PRIVATE hmi_lib)
    target_compile_options(hmi_tests PRIVATE -Wno-error=unused-parameter)
    if(TARGET GTest::gtest_main)
        target_link_libraries(hmi_tests PRIVATE GTest::gtest_main)
    else()
        target_link_libraries(hmi_tests PRIVATE gtest_main)
    endif()
    include(GoogleTest)
    gtest_discover_tests(hmi_tests)
endif()
