#!/usr/bin/env bash
# Script integration test cho đội BE (ACTION 15).
#
# Chạy end-to-end: ST source -> validate -> compile -> artifact -> kiểm shape
# JSON -> kiểm mã lỗi của các mẫu hỏng. KHÔNG cần mkddc-core đang chạy.
#
#   ./be_integration_test.sh <thư-mục-build>
#
# Ví dụ: ./be_integration_test.sh ../../../../../build/release/cpp
set -uo pipefail

BUILD="${1:-}"
if [ -z "$BUILD" ]; then
  echo "usage: $0 <build-dir>   (thư mục chứa mkddc-st-compile và mkddc-st-validate)" >&2
  exit 2
fi
VALIDATE="$BUILD/core/mkddc-st-validate"
COMPILE="$BUILD/core/mkddc-st-compile"
for b in "$VALIDATE" "$COMPILE"; do
  [ -x "$b" ] || { echo "không tìm thấy $b" >&2; exit 2; }
done

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }

jqf() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

echo "== 1. validate mẫu hợp lệ =="
out=$("$VALIDATE" --source "$HERE/ahu_fan_control.st"); rc=$?
[ $rc -eq 0 ] && ok "exit 0" || bad "exit $rc (mong 0)"
[ "$(echo "$out" | jqf "['ok']")" = "True" ] && ok "ok=true" || bad "ok != true"
[ "$(echo "$out" | wc -l)" = "1" ] && ok "đúng 1 dòng JSON" || bad "stdout không phải 1 dòng"

echo "== 2. compile mẫu hợp lệ =="
out=$("$COMPILE" --source "$HERE/ahu_fan_control.st" --out "$TMP/a.mkir"); rc=$?
[ $rc -eq 0 ] && ok "exit 0" || bad "exit $rc"
[ -s "$TMP/a.mkir" ] && ok "artifact được ghi ra file" || bad "không có artifact"
for f in "['programName']" "['artifactSha256']" "['artifact']" "['targetAbi']" "['artifactSchemaVersion']"; do
  v=$(echo "$out" | jqf "$f")
  [ -n "$v" ] && [ "$v" != "None" ] && ok "có field $f" || bad "thiếu field $f"
done

echo "== 3. build tất định: cùng source -> cùng artifact =="
"$COMPILE" --source "$HERE/ahu_fan_control.st" --out "$TMP/b.mkir" >/dev/null
cmp -s "$TMP/a.mkir" "$TMP/b.mkir" && ok "hai lần compile cho byte giống hệt" \
                                   || bad "artifact KHÔNG tất định"

echo "== 4. artifact base64 trong JSON khớp file =="
echo "$out" | jqf "['artifact']" | base64 -d > "$TMP/c.mkir" 2>/dev/null
cmp -s "$TMP/a.mkir" "$TMP/c.mkir" && ok "base64 khớp file" || bad "base64 KHÔNG khớp file"

echo "== 5. các mẫu lỗi trả đúng mã ổn định =="
check_err() {
  local file="$1" want="$2"
  local o rc code
  o=$("$COMPILE" --source "$HERE/$file" 2>/dev/null); rc=$?
  code=$(echo "$o" | jqf "['diagnostics'][0]['code']")
  if [ "$rc" = "1" ] && [ "$code" = "$want" ]; then ok "$file -> $want"
  else bad "$file -> exit=$rc code=$code (mong exit=1 code=$want)"; fi
}
check_err err_type_mismatch.st    ST-SEM-002
check_err err_assign_to_input.st  ST-SEM-003
check_err err_fb_called_twice.st  ST-SEM-010
check_err err_nesting_too_deep.st ST-SYN-002

echo "== 6. input đối kháng không làm crash =="
head -c 200000 /dev/urandom > "$TMP/junk.st"
"$COMPILE" --source "$TMP/junk.st" >"$TMP/junk.out" 2>/dev/null; rc=$?
case $rc in
  0|1|2) ok "rác nhị phân -> exit $rc (trong hợp đồng)" ;;
  *)     bad "rác nhị phân -> exit $rc (ngoài hợp đồng; 139=segfault)" ;;
esac
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$TMP/junk.out" 2>/dev/null \
  && ok "vẫn trả JSON parse được" || bad "stdout không parse được"

echo
echo "Kết quả: $pass pass, $fail fail"
[ $fail -eq 0 ]
