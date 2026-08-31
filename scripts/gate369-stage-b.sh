#!/usr/bin/env bash
# Gate #369 chặng (b) — vector compiler ST. Đếm số test thật theo từng nhóm vector.
set -u
cd /mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24 || exit 1
mkdir -p logs
ctest --test-dir build/fw -R "^St" --output-on-failure > logs/gate369-stvector.log 2>&1
echo "$?" > logs/gate369-stvector.exit
echo "ST_CTEST_EXIT=$(cat logs/gate369-stvector.exit)"
grep -E "tests passed|Total Test time" logs/gate369-stvector.log | tail -2
