#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs

ctest --test-dir build/fw --output-on-failure > logs/gate369-ctest.log 2>&1
status=$?
echo "$status" > logs/gate369-ctest.exit
echo "CTEST_REAL_EXIT=$status"
exit "$status"
