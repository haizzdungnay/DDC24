#!/usr/bin/env bash
# Gate #369 / ISS-STED-20 — chặng (a): build + test C++.
#
# Vì sao là script chứ không phải lệnh một dòng: exit code phải được ghi bởi
# CHÍNH shell chạy lệnh. Khi gọi qua `wsl -- bash -lc '...'`, `$?` và biến
# trung gian bị lớp shell ngoài expand trước khi tới WSL, ghi ra file rỗng —
# đúng cái bẫy "đọc exit code sai nguồn" mà issue #369 cảnh báo.
#
# Ghi exit code của CẢ configure lẫn build lẫn ctest, riêng từng chặng: build
# dir cũ hỏng vẫn để ctest chạy binary cũ và báo "pass" — số đo giả.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs

cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON \
  > logs/gate369-configure.log 2>&1
echo "$?" > logs/gate369-configure.exit

cmake --build build/fw -j2 > logs/gate369-build.log 2>&1
echo "$?" > logs/gate369-build.exit

ctest --test-dir build/fw --output-on-failure > logs/gate369-ctest.log 2>&1
echo "$?" > logs/gate369-ctest.exit

echo "configure=$(cat logs/gate369-configure.exit) build=$(cat logs/gate369-build.exit) ctest=$(cat logs/gate369-ctest.exit)"
