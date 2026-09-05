#!/usr/bin/env bash
# Gate #369 chặng (b) — vector compiler ST. Đếm số test thật theo từng nhóm vector.
# Chạy được từ mọi clone/worktree: không ghim đường dẫn máy của người đo ban đầu.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs

ctest --test-dir build/fw -R "^St" --output-on-failure > logs/gate369-stvector.log 2>&1
status=$?
echo "$status" > logs/gate369-stvector.exit

echo "ST_CTEST_EXIT=$status"
grep -E "tests passed|Total Test time" logs/gate369-stvector.log | tail -2 || true
exit "$status"
