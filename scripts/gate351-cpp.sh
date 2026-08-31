#!/usr/bin/env bash
# ISS-STED-02 (#351) — build + chạy test kênh WARNING của compiler ST.
#
# Script file chứ không lệnh một dòng: `$?` bị shell Windows expand trước khi
# tới WSL, ghi ra exit code giả (bẫy đã gặp ở gate #369).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs

cmake --fresh -S . -B build/gate351 -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON \
  > logs/gate351-configure.log 2>&1
echo "$?" > logs/gate351-configure.exit

cmake --build build/gate351 -j2 --target core_tests > logs/gate351-build.log 2>&1
echo "$?" > logs/gate351-build.exit

ctest --test-dir build/gate351 -R "^StWarning" --output-on-failure > logs/gate351-warn.log 2>&1
echo "$?" > logs/gate351-warn.exit

ctest --test-dir build/gate351 -R "^St" --output-on-failure > logs/gate351-st.log 2>&1
echo "$?" > logs/gate351-st.exit

echo "configure=$(cat logs/gate351-configure.exit) build=$(cat logs/gate351-build.exit) warn=$(cat logs/gate351-warn.exit) st=$(cat logs/gate351-st.exit)"
