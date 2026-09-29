# Entrypoint CMake duy nhất cho source SOM và firmware hostcheck.
# Path vật lý được tập trung trong platform/cmake/RepositoryPaths.cmake để
# migration không buộc CI, tool và developer script biết layout nội bộ.
cmake_minimum_required(VERSION 3.16)
project(mkddc-services CXX C)

enable_testing()
include(${CMAKE_CURRENT_SOURCE_DIR}/platform/cmake/RepositoryPaths.cmake)

# IntelliSense (cpptools/clangd) lấy include path từ `compile_commands.json`.
# Header trong `apps/core` include theo gốc module (`graph/...`, `ports/...`),
# nên không có file này IDE báo "cannot open source file" dù build vẫn qua.
# Chỉ sinh thêm file trong thư mục build, không đổi cờ biên dịch hay binary.
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# T59-606 — build tái lập được: xoá đường dẫn tuyệt đối khỏi binary.
#
# Lỗi thật tìm ra khi build hai lần vào hai thư mục khác nhau: `mkddc-iobus` cho
# ra hai file KHÁC nhau, và `strings` chỉ ra nguyên nhân — đường dẫn tuyệt đối
# của mã bacnet-stack kéo về qua FetchContent (`__FILE__` trong assert/log) bị
# nhúng thẳng vào binary. Hệ quả không chỉ là "hash không khớp": bản phát hành
# mang theo đường dẫn máy build của người đóng gói, và bên thứ ba KHÔNG thể dựng
# lại để đối chiếu — provenance mất luôn tính kiểm chứng độc lập.
#
# `-ffile-prefix-map` gộp cả `-fdebug-prefix-map` lẫn `-fmacro-prefix-map`, nên
# nó xử lý cả debug info lẫn `__FILE__`. Đặt ở đây (trước mọi `add_subdirectory`)
# để áp cho cả dependency kéo về, vì chính chúng là nơi rò rỉ đường dẫn.
include(CheckCXXCompilerFlag)
check_cxx_compiler_flag("-ffile-prefix-map=/a=/b" MKDDC_HAS_FILE_PREFIX_MAP)
if(MKDDC_HAS_FILE_PREFIX_MAP)
  # THỨ TỰ QUAN TRỌNG: thư mục build thường nằm LỒNG trong thư mục nguồn
  # (`build/...`), và gcc áp map sau đè map trước. Đặt map nguồn trước, map build
  # sau, nếu không đường dẫn build (phần thay đổi giữa hai lần build) vẫn còn
  # nguyên dưới tiền tố nguồn đã đổi tên — đúng lỗi đã đo được ở lần vá đầu.
  add_compile_options(
    "-ffile-prefix-map=${CMAKE_SOURCE_DIR}=/mkddc-src"
    "-ffile-prefix-map=${CMAKE_BINARY_DIR}=/mkddc-build")
endif()

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
