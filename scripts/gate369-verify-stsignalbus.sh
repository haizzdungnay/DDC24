#!/usr/bin/env bash
# Build lại core_tests rồi chạy lặp 5 lần 2 test StSignalBus.
set -u
cd /mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24 || exit 1
cmake --build build/fw -j2 --target core_tests > logs/gate369-rebuild-coretests.log 2>&1
bec=$?
echo "REBUILD_EXIT=$bec"
[ "$bec" -ne 0 ] && { tail -20 logs/gate369-rebuild-coretests.log; exit 1; }
pass=0; fail=0
for i in $(seq 1 5); do
  ctest --test-dir build/fw -R "StSignalBus.Concurrent" --output-on-failure \
    > "logs/gate369-stsignalbus-fix-run$i.log" 2>&1
  ec=$?
  echo "run$i exit=$ec"
  if [ "$ec" -eq 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
done
echo "VERIFY_SUMMARY pass=$pass fail=$fail of 5"
