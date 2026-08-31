#!/usr/bin/env bash
# Chạy lặp 2 test StSignalBus để phân biệt lỗi thật vs flaky môi trường.
set -u
cd /mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24 || exit 1
pass=0; fail=0
for i in $(seq 1 5); do
  ctest --test-dir build/fw -R "StSignalBus.Concurrent" --output-on-failure \
    > "logs/gate369-stsignalbus-run$i.log" 2>&1
  ec=$?
  echo "run$i exit=$ec"
  if [ "$ec" -eq 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
done
echo "REPEAT_SUMMARY pass=$pass fail=$fail of 5"
