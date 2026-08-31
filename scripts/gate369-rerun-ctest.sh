#!/usr/bin/env bash
set -u
cd /mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24 || exit 1
ctest --test-dir build/fw --output-on-failure > logs/gate369-ctest.log 2>&1
echo "$?" > logs/gate369-ctest.exit
echo "CTEST_REAL_EXIT=$(cat logs/gate369-ctest.exit)"
