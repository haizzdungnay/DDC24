#!/usr/bin/env bash
# ISS-STED-02/03 — gate C++ TOÀN BỘ trên root build `build/gate351`.
#
# KHÔNG dùng `--fresh` ở đây, có lý do: `--fresh` xoá `_deps`, và FetchContent
# phải rename thư mục giải nén trên mount 9p — thao tác đó trả `Permission denied`
# trong môi trường này, làm configure chết ở `apps/iobus/CMakeLists.txt:39`.
# `build/gate351` đã được configure một lần với ĐỦ CẢ BA option và deps đã nằm sẵn;
# cấu hình được xác nhận lại bằng cách in CMakeCache trước khi build.
#
# Bẫy đã gặp trong chính phiên này: `ctest` trả exit 0 kèm "No tests were found!!!"
# khi configure hỏng. Vì vậy CTEST_EXIT một mình KHÔNG phải bằng chứng — script
# in cả ba exit code và số test thật.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs
BUILD=build/gate351

echo "--- cau hinh dang dung ---"
grep -E "MKDDC_ENABLE_(MODBUS|BACNET|HMI):" "$BUILD/CMakeCache.txt"
grep -E "CMAKE_HOME_DIRECTORY" "$BUILD/CMakeCache.txt"

cmake --build "$BUILD" -j"$(nproc)" > logs/gate351full-build.log 2>&1
echo "$?" > logs/gate351full-build.exit

ctest --test-dir "$BUILD" --output-on-failure > logs/gate351full-ctest.log 2>&1
echo "$?" > logs/gate351full-ctest.exit

echo "BUILD_EXIT=$(cat logs/gate351full-build.exit)"
echo "CTEST_EXIT=$(cat logs/gate351full-ctest.exit)"
tail -5 logs/gate351full-ctest.log
