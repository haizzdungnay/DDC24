#!/usr/bin/env bash
# ISS-STED-20 / #369 chặng (c): chụp diagnostic trực tiếp từ CLI authority.
# Dùng đúng source mà REAL-BACKEND E2E sẽ nạp, để có thể so CLI -> Go -> FE.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs

if [ -n "${GATE369_ST_VALIDATE_BIN:-}" ]; then
  BIN="$GATE369_ST_VALIDATE_BIN"
else
  BIN="build/fw/apps/core/mkddc-st-validate"
  [ -x "$BIN" ] || BIN="$(find build/fw -name mkddc-st-validate -type f 2>/dev/null | head -1)"
fi
[ -x "$BIN" ] || { echo "khong tim thay mkddc-st-validate trong build/fw" >&2; exit 3; }

# Cố ý dùng một chương trình HỢP LỆ chỉ phát WARNING. Đây là ca quyết định cho
# F-STED-004: lịch sử Go từng đè mọi severity thành ERROR; nếu fixture là một
# syntax ERROR thì hồi quy đó vẫn làm gate xanh.
SRC="scripts/fixtures/gate369-warning.st"
[ -f "$SRC" ] || { echo "thieu fixture $SRC" >&2; exit 4; }

"$BIN" --source "$SRC" > logs/gate369-cli-diagnostic.json 2> logs/gate369-cli-diagnostic.err
status=$?
echo "$status" > logs/gate369-cli-diagnostic.exit

validation_status=0
python3 - <<'PY' || validation_status=$?
import json
from pathlib import Path
p = Path('logs/gate369-cli-diagnostic.json')
obj = json.loads(p.read_text(encoding='utf-8'))
diags = obj.get('diagnostics')
if not isinstance(diags, list) or not diags:
    raise SystemExit('CLI khong phat diagnostic cho gate369-warning.st')
d = diags[0]
for key in ('code', 'message', 'severity', 'line', 'column'):
    if key not in d:
        raise SystemExit(f'CLI diagnostic thieu field {key}')
if str(d['severity']).upper() != 'WARNING':
    raise SystemExit(f"Gate369 can WARNING authority, nhan {d['severity']!r}")
print(f"CLI_DIAGNOSTIC={d['code']} severity={d['severity']} line={d['line']} column={d['column']}")
PY

# JSON hợp lệ không được phép che lỗi thực thi của compiler CLI. Ví dụ CLI có
# thể flush được WARNING JSON rồi chết bất thường; khi đó gate phải trả đúng mã
# lỗi CLI thay vì mã 0 của bước validate JSON chạy sau nó.
if (( status != 0 )); then
  echo "mkddc-st-validate failed with exit $status" >&2
  exit "$status"
fi

if (( validation_status != 0 )); then
  echo "gate369 CLI diagnostic validation failed with exit $validation_status" >&2
  exit "$validation_status"
fi
