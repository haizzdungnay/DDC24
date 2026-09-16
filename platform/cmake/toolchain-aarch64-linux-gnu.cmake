# Toolchain cross-compile cho target SOM aarch64 (Radxa CM3/RK3566, Orange Pi 5B lab).
#
# Dùng:
#   cmake -S . -B build/release-arm64/cpp \
#     -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake
#
# Toolchain này chỉ đổi compiler/target; nó không đổi option sản phẩm, layout SHM,
# IOP wire bytes hay tên binary. Test C++ không chạy được trên host x86_64 sau khi
# cross-compile, nên gate unit/integration vẫn phải chạy ở build native — xem
# `docs/03_implementation/46_REPOSITORY_ARCHITECTURE_RESTRUCTURE_PLAN.md` §8.
#
# YÊU CẦU SYSROOT — chưa thỏa thì configure vẫn qua nhưng link sẽ hỏng.
# `mkddc-iobus` cần `libmodbus` (>=3.1.6) và core cần `libsodium` ở kiến trúc
# arm64. Host chỉ có bản amd64 là không đủ: `pkg_check_modules` sẽ tìm thấy
# bản amd64 và ld báo `cannot find -lmodbus`. Chuẩn bị một lần trên máy build:
#
#   sudo dpkg --add-architecture arm64
#   # `dpkg --add-architecture` KHÔNG đủ: kho arm64 của Ubuntu nằm ở
#   # ports.ubuntu.com, còn archive.ubuntu.com chỉ có amd64/i386. Thiếu bước
#   # khai báo kho ports, `apt-get install libmodbus-dev:arm64` báo "Unable to
#   # locate package" — thông điệp trông y như gói không tồn tại, nên rất dễ
#   # kết luận nhầm là phải build tay libmodbus (đã mất thời gian vì nó
#   # 2026-09-16). Thêm một file nguồn cho arm64, và giới hạn nguồn cũ về amd64
#   # để apt không đi hỏi archive.ubuntu.com những gói arm64 mà nó không có:
#   #   /etc/apt/sources.list.d/ubuntu-ports.sources
#   #     Types: deb
#   #     URIs: http://ports.ubuntu.com/ubuntu-ports/
#   #     Suites: noble noble-updates noble-backports noble-security
#   #     Components: main universe restricted multiverse
#   #     Architectures: arm64
#   #     Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
#   sudo apt-get update
#   sudo apt-get install -y g++-aarch64-linux-gnu \
#       libmodbus-dev:arm64 libsodium-dev:arm64
#   export PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig
#
# `MKDDC_ENABLE_HMI=ON` cần thêm `libdrm-dev:arm64` và `libfreetype-dev:arm64`.
#
# Cross-build `mkddc-iobus` với BACnet, kèm ba cổng kiểm binary (GLIBCXX,
# NEEDED, symbol `bip_init`): dùng `scripts/cross_build_aarch64_bacnet.sh`
# thay vì gõ tay chuỗi lệnh trên — xem `docs/06_operations/DEVELOPMENT_AND_OPERATIONS.md`
# §"Cross-build aarch64 cho Forlinx" (T-BAC-011, #627).
#
# Đường build được ADR-022 ưu tiên vẫn là build native trên self-hosted runner
# của board. Cross-build ở đây là đường phụ cho máy phát triển x86_64.

set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)

set(MKDDC_CROSS_TRIPLE aarch64-linux-gnu)

find_program(MKDDC_CROSS_CC ${MKDDC_CROSS_TRIPLE}-gcc)
find_program(MKDDC_CROSS_CXX ${MKDDC_CROSS_TRIPLE}-g++)

if(NOT MKDDC_CROSS_CC OR NOT MKDDC_CROSS_CXX)
  message(FATAL_ERROR
    "Thiếu cross toolchain ${MKDDC_CROSS_TRIPLE}. Cài bằng: "
    "sudo apt-get install -y g++-aarch64-linux-gnu")
endif()

set(CMAKE_C_COMPILER "${MKDDC_CROSS_CC}")
set(CMAKE_CXX_COMPILER "${MKDDC_CROSS_CXX}")

# Chỉ tìm program ở host, còn library/header/package phải lấy từ sysroot target để
# tránh link nhầm thư viện x86_64 của máy build.
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM BEFORE)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

if(DEFINED ENV{MKDDC_CROSS_SYSROOT})
  set(CMAKE_SYSROOT "$ENV{MKDDC_CROSS_SYSROOT}")
  set(CMAKE_FIND_ROOT_PATH "$ENV{MKDDC_CROSS_SYSROOT}")
else()
  set(CMAKE_FIND_ROOT_PATH "/usr/${MKDDC_CROSS_TRIPLE}")
endif()
