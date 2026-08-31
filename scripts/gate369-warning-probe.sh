#!/usr/bin/env bash
# Chặng (b) vector WARNING: chứng minh bằng đo, không bằng đọc code.
# Chạy CLI thật trên nguồn ST hợp lệ nhưng đáng cảnh báo, xem JSON có severity
# WARNING nào không.
set -u
cd /mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24 || exit 1
BIN=$(find build/fw -name 'mkddc-st-validate' -type f | head -1)
echo "CLI=$BIN"
[ -z "$BIN" ] && exit 1
tmp=$(mktemp -d)
cat > "$tmp/warn.st" <<'ST'
PROGRAM P_warn
VAR
  unused_var : INT;
  used_var : INT;
END_VAR
  used_var := 1;
END_PROGRAM
ST
"$BIN" --source "$tmp/warn.st" > logs/gate369-warning-probe.json 2>&1
echo "PROBE_EXIT=$?"
cat logs/gate369-warning-probe.json
echo
echo "COUNT_WARNING=$(grep -o '"WARNING"' logs/gate369-warning-probe.json | wc -l)"
rm -rf "$tmp"
