#!/usr/bin/env bash
# ISS-STED-18 (#353) — gate C++ trên root build `build/fw`.
#
# KHÔNG dùng `--fresh`: nó xoá `_deps`, và FetchContent phải rename thư mục giải
# nén bacnet-stack trên mount 9p — thao tác đó trả `Permission denied` và làm
# configure chết ở `apps/iobus/CMakeLists.txt:39`. Bù lại rủi ro mà `--fresh`
# sinh ra để chặn: script IN CMakeCache trước khi build, nên cấu hình được
# CHỨNG MINH (root + đủ ba option) chứ không được giả định.
#
# Ba exit code đều được ghi ra tệp bởi chính shell chạy lệnh: `$?` bị shell
# Windows expand trước khi chuỗi lệnh tới WSL nếu gõ inline.
#
# `CTEST_EXIT=0` một mình KHÔNG phải bằng chứng: ctest trả 0 kèm
# "No tests were found!!!" khi configure hỏng. Vì vậy script in cả tổng số test.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs
BUILD=build/fw

echo "--- cau hinh dang dung ---"
grep -E "MKDDC_ENABLE_(MODBUS|BACNET|HMI):" "$BUILD/CMakeCache.txt"
grep -E "CMAKE_HOME_DIRECTORY" "$BUILD/CMakeCache.txt"

cmake --build "$BUILD" -j"$(nproc)" > logs/gate353-build.log 2>&1
echo "$?" > logs/gate353-build.exit

ctest --test-dir "$BUILD" --output-on-failure > logs/gate353-ctest.log 2>&1
echo "$?" > logs/gate353-ctest.exit

echo "BUILD_EXIT=$(cat logs/gate353-build.exit)"
echo "CTEST_EXIT=$(cat logs/gate353-ctest.exit)"
tail -5 logs/gate353-ctest.log
