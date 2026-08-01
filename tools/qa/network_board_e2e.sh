#!/usr/bin/env bash
# E2E trang `settings/network` trên board thật — QA-E2E-001.
#
# ## Vì sao script này tồn tại
#
# Lần chạy 2026-07-31 (docs/07_records/test-evidence/fw-som/2026-07-31-network-page-board-e2e.md)
# đạt 38/39. Ca fail duy nhất, UC-WEB-NET-006, KHÔNG phải lỗi sản phẩm: kịch bản
# DHCP ở UC-008 chạy trước đó để lại một giao dịch netcfg còn ở
# `applying`/`awaiting_confirmation`, nên `stage` của UC-006 bị authority từ chối
# bằng `TRANSACTION_IN_PROGRESS` — đúng theo thiết kế, vì cho ghi đè một giao
# dịch chưa kết thúc là cách chắc chắn nhất để bỏ interface ở trạng thái nửa vời.
#
# Nói cách khác: lần fail đó là **trạng thái sót giữa các kịch bản**, và nó xảy
# ra vì quy trình chạy tay không có bước dọn. Script này đóng đúng khoảng trống
# đó — `reset_transaction` chạy TRƯỚC và SAU mỗi kịch bản, cộng một `trap` để
# một lần Ctrl-C giữa chừng cũng không để lại giao dịch treo cho lần sau.
#
# ## An toàn
#
# Mọi thao tác mutation chỉ chạm interface do `mkddc-netcfg` quản lý
# (`NETCFG_INTERFACE`, mặc định `end1`). Đường quản trị phải đi lối KHÁC —
# thường là `wlan0`. Script tự kiểm điều kiện này và từ chối chạy nhóm mutation
# nếu phát hiện mình đang nói chuyện qua chính interface sắp bị đổi địa chỉ; nếu
# không, một lần đổi IP sai là mất luôn phiên đang chạy script.
#
# ## Dùng
#
#   ./network_board_e2e.sh                      # chạy trên board, chỉ nhóm đọc
#   MUTATE=1 ./network_board_e2e.sh             # chạy cả nhóm mutation
#   BASE=http://192.168.1.50:8081 ADMIN_USER=… ADMIN_PASS=… ./network_board_e2e.sh
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8081}"
API="$BASE/api/v1"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-}"
VIEWER_USER="${VIEWER_USER:-}"
VIEWER_PASS="${VIEWER_PASS:-}"
IFACE="${NETCFG_INTERFACE:-end1}"
MUTATE="${MUTATE:-0}"
EVIDENCE="${EVIDENCE:-}"

PASS=0
FAIL=0
RESULTS=()

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
ok()   { PASS=$((PASS+1)); RESULTS+=("PASS $1"); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); RESULTS+=("FAIL $1 — $2"); printf '  \033[31mFAIL\033[0m %s — %s\n' "$1" "$2"; }
die()  { printf 'FATAL: %s\n' "$*" >&2; exit 2; }

need() { command -v "$1" >/dev/null 2>&1 || die "thiếu lệnh '$1'"; }
need curl; need jq

TOKEN=""
VIEWER_TOKEN=""

api() { # api <method> <path> [json-body] [token]
  local method="$1" path="$2" body="${3:-}" token="${4:-$TOKEN}"
  local args=(-sS -X "$method" -H 'content-type: application/json' -m 30)
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}" "$API$path"
}

api_status() { # như api nhưng chỉ in mã HTTP
  local method="$1" path="$2" body="${3:-}" token="${4:-$TOKEN}"
  local args=(-sS -o /dev/null -w '%{http_code}' -X "$method" -H 'content-type: application/json' -m 30)
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}" "$API$path"
}

login() { # login <user> <pass> → in token
  local out
  out=$(curl -sS -m 20 -X POST -H 'content-type: application/json' \
        -d "{\"username\":\"$1\",\"password\":\"$2\"}" "$API/auth/login") || return 1
  jq -er '.token' <<<"$out" 2>/dev/null
}

transaction_state() {
  api GET /network/transaction 2>/dev/null | jq -r '.state // "unreadable"'
}

# ─────────────────────────────────────────────────────────────────────────────
# QA-E2E-001 — bước dọn trạng thái.
#
# Đây là phần chính của task. Các trạng thái `staged`, `applying`,
# `awaiting_confirmation`, `rolling_back` đều là "giao dịch chưa kết thúc", và
# authority sẽ từ chối mọi `stage` mới khi còn một trong số đó. Dọn = rollback
# về last-known-good, rồi chờ tới khi state thực sự nghỉ.
#
# Cố ý rollback chứ không confirm: confirm sẽ CHỐT một thay đổi mà kịch bản
# trước có thể đã bỏ dở giữa chừng, tức là script tự ý đổi cấu hình mạng của
# board theo một ý định không ai xác nhận.
# ─────────────────────────────────────────────────────────────────────────────
reset_transaction() {
  local state deadline
  state=$(transaction_state)
  case "$state" in
    idle|confirmed|rolled_back|failed|unreadable) return 0 ;;
  esac

  log "dọn giao dịch netcfg đang ở '$state' → rollback"
  api POST /network/transaction/rollback '{"version":1,"requestId":"qa-cleanup"}' >/dev/null 2>&1

  deadline=$(( $(date +%s) + 150 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    state=$(transaction_state)
    case "$state" in
      idle|confirmed|rolled_back|failed) log "giao dịch đã nghỉ ở '$state'"; return 0 ;;
    esac
    sleep 3
  done
  # Không tự ý chạy tiếp: một kịch bản chạy trên nền giao dịch treo sẽ fail vì lý
  # do không liên quan tới thứ nó định kiểm, đúng như UC-WEB-NET-006 hôm 31/07.
  die "giao dịch netcfg còn kẹt ở '$state' sau 150s — dừng để không sinh kết quả sai"
}

scenario() { # scenario <id> <hàm>
  local id="$1" fn="$2"
  reset_transaction
  log "▶ $id"
  "$fn" "$id"
  reset_transaction
}

cleanup_on_exit() {
  local code=$?
  log "dọn trạng thái trước khi thoát"
  reset_transaction || true
  exit $code
}

# ─────────────────────────────────────────────────────────────────────────────
# Kịch bản
# ─────────────────────────────────────────────────────────────────────────────

uc_001_active_state() { # trạng thái kernel đọc được và trung thực
  local body mode link
  body=$(api GET /network/transaction)
  mode=$(jq -r '.active.mode // "missing"' <<<"$body")
  link=$(jq -r '.active.link // "missing"' <<<"$body")
  [ "$mode" != "missing" ] && [ "$link" != "missing" ] \
    && ok "$1 active.mode=$mode active.link=$link" \
    || bad "$1" "response thiếu active.mode/active.link: $body"

  # F-07 của evidence 31/07: profile trùng tên từng làm `configured` thành null.
  if [ "$(jq -r '.configured // "null"' <<<"$body")" = "null" ]; then
    bad "$1 configured" "configured=null — dấu hiệu profile trùng tên hoặc đọc nmcli hỏng"
  else
    ok "$1 configured đọc được"
  fi
}

uc_002_summary_is_honest() { # không bịa số đo khi field bus chưa đo được
  local body
  body=$(api GET /network)
  if jq -e '.northbound.ip' >/dev/null <<<"$body"; then
    ok "$1 /network trả northbound thật"
  else
    bad "$1" "thiếu northbound: $body"
  fi
  # Số đo per-slave chưa đo được phải là null, KHÔNG phải 0 — 0 là một phép đo,
  # null là "chưa biết", và trộn hai thứ đó là bịa dữ liệu.
  if jq -e '[.southbound[]? | select(.lastPollMs == 0 and .totalPolls == 0)] | length == 0' >/dev/null <<<"$body"; then
    ok "$1 không có slave nào báo 0ms/0 poll giả"
  else
    bad "$1" "có slave báo lastPollMs=0 kèm totalPolls=0 — nghi ngờ số đo bịa"
  fi
}

uc_003_rbac() { # viewer đọc được, ghi thì 403
  if [ -z "$VIEWER_TOKEN" ]; then
    log "  bỏ qua $1: chưa có tài khoản viewer (đặt VIEWER_USER/VIEWER_PASS)"
    return 0
  fi
  local get_code stage_code put_code
  get_code=$(api_status GET /network/transaction '' "$VIEWER_TOKEN")
  stage_code=$(api_status POST /network/transaction/stage '{"version":1,"requestId":"qa-rbac"}' "$VIEWER_TOKEN")
  put_code=$(api_status PUT /network '{}' "$VIEWER_TOKEN")
  [ "$get_code" = "200" ] && ok "$1 viewer GET=200" || bad "$1 viewer GET" "code=$get_code"
  [ "$stage_code" = "403" ] && ok "$1 viewer stage=403" || bad "$1 viewer stage" "code=$stage_code"
  [ "$put_code" = "403" ] && ok "$1 viewer PUT=403" || bad "$1 viewer PUT" "code=$put_code"
}

uc_004_validate_rejects_bad_candidates() {
  local bad_candidates=(
    '{"interface":"IFACE","mode":"static","ipv4":"999.1.1.1","netmask":"255.255.255.0","gateway":"192.168.1.1"}'
    '{"interface":"IFACE","mode":"static","ipv4":"192.168.77.10","netmask":"255.255.255.0","gateway":"10.0.0.1"}'
    '{"interface":"IFACE","mode":"static","netmask":"255.255.255.0"}'
    '{"interface":"IFACE","mode":"dhcp","ipv4":"192.168.77.10"}'
  )
  local i=0 candidate result
  for raw in "${bad_candidates[@]}"; do
    i=$((i+1))
    candidate=${raw//IFACE/$IFACE}
    result=$(api POST /network/transaction/validate "{\"version\":1,\"requestId\":\"qa-val-$i\",\"candidate\":$candidate}" \
             | jq -r '.result // "unreadable"')
    [ "$result" = "rejected" ] \
      && ok "$1 candidate #$i bị chặn" \
      || bad "$1 candidate #$i" "authority trả result=$result cho candidate không hợp lệ"
  done
}

uc_006_rollback_restores_last_known_good() {
  local before after candidate staged
  before=$(api GET /network/transaction | jq -r '.active.ipv4 // ""')
  [ -n "$before" ] || { bad "$1" "không đọc được địa chỉ hiện hành"; return; }

  # Địa chỉ thử nằm CÙNG subnet với địa chỉ hiện hành để không đổi gateway.
  candidate=$(python3 - "$before" <<'PY'
import sys, ipaddress
ip = ipaddress.IPv4Address(sys.argv[1])
# +11 rồi gói trong octet cuối, tránh .0 và .255
last = (int(ip) & 0xFF)
nxt = (last + 11) % 254 or 1
print(str(ipaddress.IPv4Address((int(ip) & ~0xFF) | nxt)))
PY
)
  local gw netmask
  gw=$(api GET /network/transaction | jq -r '.configured.gateway // ""')
  netmask=$(api GET /network/transaction | jq -r '.configured.netmask // "255.255.255.0"')

  staged=$(api POST /network/transaction/stage \
    "{\"version\":1,\"requestId\":\"qa-006-stage\",\"candidate\":{\"interface\":\"$IFACE\",\"mode\":\"static\",\"ipv4\":\"$candidate\",\"netmask\":\"$netmask\",\"gateway\":\"$gw\"}}")
  if [ "$(jq -r '.result' <<<"$staged")" != "accepted" ]; then
    bad "$1 stage" "$(jq -r '.reasonCode // "?"' <<<"$staged") — $staged"
    return
  fi
  ok "$1 stage được chấp nhận"

  api POST /network/transaction/apply '{"version":1,"requestId":"qa-006-apply"}' >/dev/null
  api POST /network/transaction/rollback '{"version":1,"requestId":"qa-006-rollback"}' >/dev/null
  sleep 5
  after=$(api GET /network/transaction | jq -r '.active.ipv4 // ""')

  [ "$after" = "$before" ] \
    && ok "$1 rollback trả về địa chỉ cũ $before" \
    || bad "$1 rollback" "địa chỉ sau rollback là '$after', mong đợi '$before'"
}

# ─────────────────────────────────────────────────────────────────────────────
# Chạy
# ─────────────────────────────────────────────────────────────────────────────

log "base=$BASE interface=$IFACE mutate=$MUTATE"

[ -n "$ADMIN_PASS" ] || die "cần ADMIN_PASS (không nhúng mật khẩu vào script)"
TOKEN=$(login "$ADMIN_USER" "$ADMIN_PASS") || die "đăng nhập admin thất bại"
[ -n "$TOKEN" ] || die "đăng nhập admin không trả token"
log "đăng nhập admin OK"

if [ -n "$VIEWER_USER" ] && [ -n "$VIEWER_PASS" ]; then
  VIEWER_TOKEN=$(login "$VIEWER_USER" "$VIEWER_PASS") || VIEWER_TOKEN=""
  [ -n "$VIEWER_TOKEN" ] && log "đăng nhập viewer OK" || log "CẢNH BÁO: đăng nhập viewer thất bại"
fi

trap cleanup_on_exit EXIT INT TERM

scenario UC-WEB-NET-001 uc_001_active_state
scenario UC-WEB-NET-002 uc_002_summary_is_honest
scenario UC-WEB-NET-003 uc_003_rbac
scenario UC-WEB-NET-004 uc_004_validate_rejects_bad_candidates

if [ "$MUTATE" = "1" ]; then
  # Chặn tự bắn vào chân: nếu đường quản trị đi qua chính interface sắp đổi địa
  # chỉ thì một bước apply là mất phiên, và script không còn ai để rollback.
  ADMIN_IFACE=$(ip -o route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}')
  if [ "$ADMIN_IFACE" = "$IFACE" ]; then
    die "đường quản trị đang đi qua '$IFACE' — từ chối chạy nhóm mutation (xem §1 evidence 31/07)"
  fi
  log "đường quản trị qua '${ADMIN_IFACE:-?}', khác '$IFACE' — cho phép mutation"
  scenario UC-WEB-NET-006 uc_006_rollback_restores_last_known_good
else
  log "MUTATE=0 → bỏ qua nhóm mutation (UC-006/005/007/008)"
fi

printf '\n== %d PASS, %d FAIL ==\n' "$PASS" "$FAIL"
if [ -n "$EVIDENCE" ]; then
  {
    printf '{\n  "base": "%s",\n  "interface": "%s",\n  "mutate": %s,\n  "pass": %d,\n  "fail": %d,\n  "results": [\n' \
      "$BASE" "$IFACE" "$MUTATE" "$PASS" "$FAIL"
    for i in "${!RESULTS[@]}"; do
      printf '    %s%s\n' "$(jq -Rn --arg r "${RESULTS[$i]}" '$r')" "$([ $i -lt $((${#RESULTS[@]}-1)) ] && echo ,)"
    done
    printf '  ]\n}\n'
  } > "$EVIDENCE"
  log "evidence → $EVIDENCE"
fi

[ "$FAIL" -eq 0 ]
