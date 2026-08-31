#!/usr/bin/env bash
# ISS-STED-02 (#351) — đo THẬT kênh WARNING qua CLI `mkddc-st-validate`.
# Trước bản sửa, script tương đương (gate369-warning-probe.sh) trả diagnostics
# rỗng cho đúng nguồn này — đó là bằng chứng của F-STED-003.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs
BIN="build/gate351/core/mkddc-st-validate"
[ -x "$BIN" ] || BIN="$(find build/gate351 -name mkddc-st-validate -type f 2>/dev/null | head -1)"
[ -x "$BIN" ] || { echo "khong tim thay mkddc-st-validate"; exit 3; }

SRC="$(mktemp)"
cat > "$SRC" <<'ST'
PROGRAM P_warn
VAR
  unused_var : INT;
  used_var : INT;
END_VAR
VAR_OUTPUT
  cmd : BOOL;
END_VAR
  used_var := 1;
END_PROGRAM
ST

"$BIN" --source "$SRC" > logs/gate351-cli.json 2>logs/gate351-cli.err
echo "$?" > logs/gate351-cli.exit
rm -f "$SRC"

cat logs/gate351-cli.json
echo
echo "EXIT=$(cat logs/gate351-cli.exit)"
echo "COUNT_WARNING=$(grep -o '"severity":"warning"' logs/gate351-cli.json | wc -l)"
echo "COUNT_ERROR=$(grep -o '"severity":"error"' logs/gate351-cli.json | wc -l)"
