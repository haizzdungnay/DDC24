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
# Tự tạo tài khoản tạm cho UC-003 rồi XOÁ khi thoát. Tiền lệ: evidence 2026-07-31
# §5 cũng tạo `e2e-admin`/`e2e-viewer` tạm và xoá sau khi chạy. Không đụng tài
# khoản có sẵn của board — đổi mật khẩu một tài khoản đang dùng để chạy test là
# cách nhanh nhất khoá chân người vận hành.
PROVISION_ACCOUNTS="${PROVISION_ACCOUNTS:-0}"
E2E_VIEWER="e2e-viewer"
E2E_VIEWER_PASS=""
provisioned=0

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
  local state deadline txid
  state=$(transaction_state)
  case "$state" in
    idle|confirmed|rolled_back|failed|unreadable) return 0 ;;
  esac

  # Hợp đồng body là `{transactionId?, candidate?}` và decoder ở backend bật
  # `DisallowUnknownFields`, nên mọi field thừa làm cả request thành 400
  # "invalid json". `rollback` bắt buộc có `transactionId` khớp
  # ^[A-Za-z0-9_.:-]{1,64}$ và CẤM `candidate`.
  txid=$(api GET /network/transaction | jq -r '.transactionId // ""')
  if [ -z "$txid" ]; then
    log "giao dịch ở '$state' nhưng không đọc được transactionId — không rollback mù"
    return 0
  fi
  log "dọn giao dịch netcfg đang ở '$state' (tx=$txid) → rollback"
  api POST /network/transaction/rollback "{\"transactionId\":\"$txid\"}" >/dev/null 2>&1

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

provision_accounts() {
  # Mật khẩu dùng một lần, sinh ngẫu nhiên, không ghi ra log và không lưu đâu cả.
  E2E_VIEWER_PASS=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 16)
  local code
  code=$(api_status POST /users "{\"username\":\"$E2E_VIEWER\",\"role\":\"viewer\",\"password\":\"$E2E_VIEWER_PASS\"}")
  case "$code" in
    201|200) provisioned=1; log "đã tạo tài khoản tạm $E2E_VIEWER (viewer)" ;;
    409)     log "CẢNH BÁO: $E2E_VIEWER đã tồn tại từ lần chạy trước — không ghi đè, bỏ qua UC-003" ; return 0 ;;
    *)       log "CẢNH BÁO: không tạo được $E2E_VIEWER (HTTP $code) — bỏ qua UC-003" ; return 0 ;;
  esac
  VIEWER_TOKEN=$(login "$E2E_VIEWER" "$E2E_VIEWER_PASS") || VIEWER_TOKEN=""
  [ -n "$VIEWER_TOKEN" ] || log "CẢNH BÁO: tài khoản tạm tạo được nhưng không đăng nhập được"
}

deprovision_accounts() {
  [ "$provisioned" = "1" ] || return 0
  local code
  code=$(api_status DELETE "/users/$E2E_VIEWER")
  case "$code" in
    204|200) log "đã xoá tài khoản tạm $E2E_VIEWER" ;;
    *)       log "CẢNH BÁO: KHÔNG xoá được $E2E_VIEWER (HTTP $code) — phải xoá tay" ;;
  esac
  provisioned=0
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
  deprovision_accounts || true
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
  stage_code=$(api_status POST /network/transaction/stage "{\"candidate\":{\"interface\":\"$IFACE\",\"mode\":\"dhcp\"}}" "$VIEWER_TOKEN")
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
  local i=0 candidate code body result
  for raw in "${bad_candidates[@]}"; do
    i=$((i+1))
    candidate=${raw//IFACE/$IFACE}
    body="{\"candidate\":$candidate}"
    # Candidate sai bị chặn ở MỘT TRONG HAI tầng, và cả hai đều là "bị chặn":
    #   - schema/semantic ở `mkddc-web` → HTTP 400 kèm danh sách lỗi field;
    #   - luật của authority (`mkddc-netcfg`) → HTTP 200 với `result: rejected`.
    # Chỉ chấp nhận một trong hai sẽ báo fail giả cho tầng còn lại.
    code=$(api_status POST /network/transaction/validate "$body")
    if [ "$code" = "400" ] || [ "$code" = "422" ]; then
      ok "$1 candidate #$i bị chặn ở tầng schema (HTTP $code)"
      continue
    fi
    result=$(api POST /network/transaction/validate "$body" | jq -r '.result // "unreadable"')
    [ "$result" = "rejected" ] \
      && ok "$1 candidate #$i bị authority từ chối" \
      || bad "$1 candidate #$i" "HTTP $code, result=$result — candidate không hợp lệ mà không bị chặn"
  done
}

# Chọn một địa chỉ thử CÙNG subnet với địa chỉ hiện hành (hoặc với cấu hình đã
# lưu, khi interface đang không có địa chỉ nào). Cùng subnet để gateway cũ vẫn
# hợp lệ — đổi sang subnet khác sẽ khiến gateway thành ngoài subnet và bị chính
# validate của client chặn (F-08).
probe_address() { # probe_address <base-ip>
  python3 - "$1" <<'PY_INNER'
import sys, ipaddress
ip = ipaddress.IPv4Address(sys.argv[1])
last = int(ip) & 0xFF
nxt = (last + 11) % 254 or 1
if nxt == last:
    nxt = (nxt + 1) % 254 or 1
print(str(ipaddress.IPv4Address((int(ip) & ~0xFF) | nxt)))
PY_INNER
}

# Địa chỉ tham chiếu: ưu tiên `active` (kernel đang giữ), lùi về `configured`
# (profile đã lưu) khi interface chưa có địa chỉ nào. Trường hợp thứ hai là thật
# trên board hôm nay và bản trước của script bỏ cuộc ở đó.
reference_address() {
  local body ip
  body=$(api GET /network/transaction)
  ip=$(jq -r '.active.ipv4 // ""' <<<"$body")
  [ -n "$ip" ] || ip=$(jq -r '.configured.ipv4 // ""' <<<"$body")
  printf '%s' "$ip"
}

# Đọc TẤT CẢ địa chỉ IPv4 mà interface đang mang, mỗi cái một dòng.
# Cần thiết vì `active.ipv4` của authority chỉ trả MỘT giá trị (địa chỉ primary),
# trong khi trong cửa sổ chờ xác nhận interface cố ý mang HAI địa chỉ.
iface_addresses() {
  ip -o -4 addr show "$IFACE" 2>/dev/null | awk '{print $4}' | cut -d/ -f1
}

iface_has_address() { # iface_has_address <ipv4>
  iface_addresses | grep -qx "$1"
}

wait_iface_has_address() { # wait_iface_has_address <ipv4> [timeout_s]
  local want="$1" deadline=$(( $(date +%s) + ${2:-30} ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    iface_has_address "$want" && return 0
    sleep 1
  done
  return 1
}

# Chờ kernel thực sự mang địa chỉ, thay vì `sleep` một con số đoán mò.
# `apply` trả về ngay khi authority đã ra lệnh; kernel + NetworkManager cần thêm
# một khoảng không cố định. Một `sleep 4` cứng làm test lúc xanh lúc đỏ mà chẳng
# nói lên điều gì về sản phẩm.
wait_for_active_address() { # wait_for_active_address <ipv4> [timeout_s]
  local want="$1" deadline=$(( $(date +%s) + ${2:-20} )) got
  while [ "$(date +%s)" -lt "$deadline" ]; do
    got=$(api GET /network/transaction | jq -r '.active.ipv4 // ""')
    [ "$got" = "$want" ] && return 0
    sleep 1
  done
  printf '%s' "$got"
  return 1
}

stage_apply() { # stage_apply <id> <ipv4> → in transactionId, rỗng nếu hỏng
  local id="$1" want="$2" body gw netmask staged txid
  body=$(api GET /network/transaction)
  gw=$(jq -r '.configured.gateway // ""' <<<"$body")
  netmask=$(jq -r '.configured.netmask // "255.255.255.0"' <<<"$body")
  staged=$(api POST /network/transaction/stage \
    "{\"candidate\":{\"interface\":\"$IFACE\",\"mode\":\"static\",\"ipv4\":\"$want\",\"netmask\":\"$netmask\",\"gateway\":\"$gw\"}}")
  if [ "$(jq -r '.result // ""' <<<"$staged")" != "accepted" ]; then
    bad "$id stage" "$(jq -r '.reasonCode // "?"' <<<"$staged")"
    return 1
  fi
  txid=$(jq -r '.transactionId // ""' <<<"$staged")
  [ -n "$txid" ] || { bad "$id stage" "không trả transactionId"; return 1; }
  local applied
  applied=$(api POST /network/transaction/apply "{\"transactionId\":\"$txid\"}")
  if [ "$(jq -r '.result // ""' <<<"$applied")" != "accepted" ]; then
    bad "$id apply" "result=$(jq -r '.result // "?"' <<<"$applied") reason=$(jq -r '.reasonCode // "?"' <<<"$applied")"
    return 1
  fi
  printf '%s' "$txid"
}

uc_005_apply_confirm_takes_effect() {
  local before want txid after state
  before=$(reference_address)
  [ -n "$before" ] || { bad "$1" "không đọc được địa chỉ tham chiếu (active lẫn configured đều rỗng)"; return; }
  want=$(probe_address "$before")

  txid=$(stage_apply "$1" "$want") || return
  ok "$1 stage+apply được chấp nhận (tx=$txid)"

  # ── Hợp đồng của `apply`, đọc từ chính apps/netcfg/netcfg.cpp ──
  # `apply` KHÔNG thay địa chỉ: nó GIỮ địa chỉ cũ và chỉ THÊM địa chỉ mới, để
  # phiên quản trị không đứt trong cửa sổ 120 giây chờ confirm. Vì vậy ngay sau
  # apply interface mang HAI địa chỉ, và `active.ipv4` — vốn chỉ trả một giá trị
  # — vẫn báo địa chỉ CŨ.
  #
  # Bản trước của test này khẳng định `active.ipv4 == want` ngay sau apply và
  # báo FAIL. Đó là test sai chứ không phải sản phẩm sai: đo trên board cho thấy
  # apply trả về sau 0,5 s và interface mang đồng thời cả hai địa chỉ.
  if wait_iface_has_address "$want" 30; then
    ok "$1 interface đã THÊM địa chỉ mới $want"
  else
    bad "$1 apply" "sau 30s interface vẫn không mang $want (đang có: $(iface_addresses | tr '\n' ' '))"
  fi
  if iface_has_address "$before"; then
    ok "$1 vẫn GIỮ địa chỉ cũ $before trong cửa sổ chờ xác nhận (đường quản trị không đứt)"
  else
    bad "$1 apply" "địa chỉ cũ $before đã bị gỡ ngay khi apply — phiên quản trị có thể đứt trước khi kịp confirm"
  fi

  state=$(transaction_state)
  [ "$state" = "awaiting_confirmation" ] \
    && ok "$1 vào cửa sổ chờ xác nhận" \
    || bad "$1 state" "sau apply state='$state', mong đợi awaiting_confirmation"

  # KHÔNG vứt phản hồi của một lệnh mutation. Bản trước dùng `>/dev/null` ở đây,
  # nên khi confirm không có tác dụng thì script chỉ thấy state đứng yên mà
  # không biết vì sao — chẩn đoán sai thành "mất địa chỉ" trong khi địa chỉ vẫn
  # đúng. Một lệnh đổi trạng thái thiết bị phải luôn được đọc kết quả.
  local confirmed
  confirmed=$(api POST /network/transaction/confirm "{\"transactionId\":\"$txid\"}")
  if [ "$(jq -r '.result // ""' <<<"$confirmed")" != "accepted" ]; then
    bad "$1 confirm" "result=$(jq -r '.result // "?"' <<<"$confirmed") reason=$(jq -r '.reasonCode // "?"' <<<"$confirmed")"
    return
  fi
  sleep 2
  state=$(transaction_state)
  after=$(api GET /network/transaction | jq -r '.active.ipv4 // ""')
  [ "$state" = "confirmed" ] \
    && ok "$1 confirm chốt giao dịch" \
    || bad "$1 confirm" "confirm được chấp nhận nhưng state='$state'"
  # F-14: confirm mới là lúc gỡ địa chỉ cũ. Hai điều phải đúng cùng lúc —
  # địa chỉ MỚI còn nguyên, và địa chỉ CŨ đã sạch. Chốt `confirmed` trên một
  # interface không còn địa chỉ nào là mất đường quản trị ngoài site; còn để sót
  # địa chỉ cũ thì thiết bị mang hai IP không ai biết.
  if iface_has_address "$want"; then
    ok "$1 địa chỉ $want còn nguyên sau confirm (F-14)"
  else
    bad "$1 confirm" "sau confirm interface KHÔNG còn $want — đang có: $(iface_addresses | tr '\n' ' ') (F-14)"
  fi
  if iface_has_address "$before"; then
    bad "$1 confirm" "địa chỉ cũ $before vẫn còn sau confirm — interface mang 2 IP"
  else
    ok "$1 địa chỉ cũ $before đã được gỡ sau confirm"
  fi
  [ "$after" = "$want" ] \
    && ok "$1 authority báo active.ipv4=$want" \
    || bad "$1 confirm" "authority báo active.ipv4='$after', mong đợi '$want'"
}

# ─────────────────────────────────────────────────────────────────────────────
# UC-PERSIST-001 — địa chỉ đã CONFIRM có sống sót qua reboot không?
#
# Đây không phải use case trong đặc tả gốc; tao thêm sau khi quan sát trạng thái
# thật của board ngày 2026-08-01: journal netcfg ghi `state=confirmed` với
# `192.168.1.102`, profile NetworkManager lưu ĐÚNG địa chỉ đó, mà interface
# `end1` KHÔNG có địa chỉ IPv4 nào.
#
# Cơ chế: `apply()` đặt địa chỉ bằng `ip address add` — chỉ tồn tại trong
# runtime. `persist()` ghi vào profile bằng `nmcli connection modify` nhưng
# KHÔNG đặt `connection.autoconnect yes`. Nếu profile ở `autoconnect: no` thì
# sau reboot NetworkManager không bật nó, `ip address add` đã bay theo lần reboot,
# và `mkddc-netcfg` lúc khởi động chỉ mở socket chứ không đối chiếu lại kernel.
#
# Hậu quả trên site: mất điện bật lại → DDC lên mà không có IP ở cổng trường.
# Một chuyến xe ra hiện trường.
# ─────────────────────────────────────────────────────────────────────────────
uc_persist_001_survives_reboot() {
  command -v nmcli >/dev/null 2>&1 || { log "  bỏ qua $1: cần nmcli trên chính board"; return 0; }

  # Tra bằng UUID của profile ĐANG ACTIVE, không bằng tên. Đây đúng bài học
  # §7.1 của evidence 2026-07-31: NetworkManager cho phép nhiều profile trùng
  # tên, và `nmcli connection show <TÊN>` khớp cả hai rồi in hai khối — bản
  # trước của chính hàm này mắc lại đúng cái bẫy đó và đọc ra "no\n\nno".
  local dup uuid autoconnect
  dup=$(nmcli -t -f NAME connection show 2>/dev/null | grep -c "^${IFACE}$")
  if [ "${dup:-0}" -gt 1 ]; then
    bad "$1 profile trùng tên" "có $dup profile NetworkManager cùng tên '$IFACE' — đúng điều kiện gây lỗi §7.1 (configured=null, mọi stage sau đó bị từ chối)"
  else
    ok "$1 chỉ có 1 profile tên '$IFACE'"
  fi

  uuid=$(nmcli -t -f GENERAL.CON-UUID device show "$IFACE" 2>/dev/null | cut -d: -f2)
  if [ -z "$uuid" ]; then
    bad "$1" "không có profile nào ACTIVE trên '$IFACE' — cấu hình đã confirm không đang có hiệu lực"
    return 0
  fi
  autoconnect=$(nmcli -t -f connection.autoconnect connection show "$uuid" 2>/dev/null | cut -d: -f2)
  if [ -z "$autoconnect" ]; then
    log "  bỏ qua $1: không đọc được connection.autoconnect của $uuid"
    return 0
  fi
  [ "$autoconnect" = "yes" ] \
    && ok "$1 profile $IFACE có autoconnect=yes — cấu hình sống sót qua reboot" \
    || bad "$1" "profile $IFACE có autoconnect=$autoconnect: địa chỉ đã confirm KHÔNG sống sót qua reboot (apply chỉ dùng 'ip address add', persist không đặt autoconnect)"
}

uc_006_rollback_restores_last_known_good() {
  local before want txid after
  before=$(api GET /network/transaction | jq -r '.active.ipv4 // ""')
  [ -n "$before" ] || { bad "$1" "không đọc được địa chỉ hiện hành — chạy UC-005 trước"; return; }
  want=$(probe_address "$before")

  txid=$(stage_apply "$1" "$want") || return
  ok "$1 stage+apply được chấp nhận"

  local rolled result
  rolled=$(api POST /network/transaction/rollback "{\"transactionId\":\"$txid\"}")
  result=$(jq -r '.result // ""' <<<"$rolled" 2>/dev/null)
  if [ "$result" = "accepted" ]; then
    ok "$1 authority chấp nhận rollback"
  else
    # In cả body thô. "result=?" không nói được gì; body nói ngay đó là 4xx,
    # HTML, hay JSON thiếu field — ba nguyên nhân cần ba cách xử lý khác nhau.
    bad "$1 rollback" "phản hồi không phải {result:accepted}: $(printf '%s' "$rolled" | tr -d '\n' | cut -c1-200)"
  fi

  if after=$(wait_for_active_address "$before" 45); then
    ok "$1 rollback trả kernel về địa chỉ cũ $before"
  else
    bad "$1 rollback" "sau 45s kernel giữ '$after', mong đợi '$before'"
  fi
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

[ "$PROVISION_ACCOUNTS" = "1" ] && [ -z "$VIEWER_TOKEN" ] && provision_accounts

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
  scenario UC-WEB-NET-005 uc_005_apply_confirm_takes_effect
  scenario UC-WEB-NET-006 uc_006_rollback_restores_last_known_good
  scenario UC-PERSIST-001 uc_persist_001_survives_reboot
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
