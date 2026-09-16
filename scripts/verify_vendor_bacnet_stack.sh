#!/usr/bin/env bash
# Kiểm cây vendor `third_party/bacnet-stack/` còn khớp manifest đã ghim.
#
# CHẠY OFFLINE — không mạng, không clone. Đây là điều kiện để nó dùng được làm
# cổng: một phép kiểm toàn vẹn phải chạy được ở đúng nơi build chạy, kể cả khi
# egress đóng (chính hoàn cảnh sinh ra `OD-BAC-009`).
#
# Bắt ba lớp hỏng, mỗi lớp một mã thoát riêng để gọi từ cổng khác còn phân biệt:
#   2 — thiếu cây vendor hoặc thiếu manifest
#   3 — nội dung file đã đổi (sửa tay, hỏng khi merge, checkout lỗi)
#   4 — thừa hoặc thiếu file so với manifest
#
# Refs: OD-BAC-009, #625

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="${REPO_ROOT}/third_party/bacnet-stack"
MANIFEST="${VENDOR_DIR}/MANIFEST.sha256"

fail() { printf 'FAIL: %s\n' "$*" >&2; }
ok()   { printf 'OK  : %s\n' "$*"; }

if [[ ! -d "$VENDOR_DIR" ]]; then
  fail "không có ${VENDOR_DIR}. Chạy scripts/vendor_bacnet_stack.sh."
  exit 2
fi
if [[ ! -f "$MANIFEST" ]]; then
  fail "không có ${MANIFEST}. Cây vendor không kiểm được — coi như không hợp lệ."
  exit 2
fi

cd "$VENDOR_DIR"

# --- Lớp 1: nội dung từng file khớp băm -------------------------------------
# `sha256sum -c` báo cả file thiếu lẫn file sai băm, nhưng KHÔNG báo file thừa.
if CHECK_OUT="$(sha256sum -c --quiet "$MANIFEST" 2>&1)"; then
  ok "nội dung khớp manifest"
else
  fail "nội dung lệch manifest:"
  printf '%s\n' "$CHECK_OUT" | head -20 >&2
  BAD="$(printf '%s\n' "$CHECK_OUT" | wc -l | tr -d ' ')"
  fail "tổng ${BAD} dòng lệch (in tối đa 20)"
  exit 3
fi

# --- Lớp 2: không có file THỪA ---------------------------------------------
# Thừa file là lớp hỏng mà `sha256sum -c` mù hoàn toàn: ai đó thêm một file vào
# cây vendor thì băm của mọi file cũ vẫn đúng và cổng vẫn xanh. Với một cây được
# khai là "bản sao nguyên trạng của upstream", một file lạ nằm trong đó là điều
# đúng ra phải chặn.
ACTUAL="$(mktemp)"; EXPECTED="$(mktemp)"
trap 'rm -f "$ACTUAL" "$EXPECTED"' EXIT

find . -type f ! -name MANIFEST.sha256 ! -name VENDOR.txt -print \
  | LC_ALL=C sort > "$ACTUAL"
sed 's/^[0-9a-f]\{64\}  //' "$MANIFEST" | LC_ALL=C sort > "$EXPECTED"

if DIFF_OUT="$(diff "$EXPECTED" "$ACTUAL")"; then
  ok "danh sách file khớp manifest ($(wc -l < "$EXPECTED" | tr -d ' ') file)"
else
  fail "danh sách file lệch manifest ('<' = thiếu, '>' = thừa):"
  printf '%s\n' "$DIFF_OUT" | head -20 >&2
  exit 4
fi

# --- Lớp 3: nguồn gốc còn ghi được -----------------------------------------
if [[ -f VENDOR.txt ]] && grep -q '^commit *:' VENDOR.txt; then
  ok "nguồn gốc: $(grep '^tag *:' VENDOR.txt | sed 's/.*: *//') @ $(grep '^commit *:' VENDOR.txt | sed 's/.*: *//')"
else
  fail "VENDOR.txt thiếu hoặc không ghi commit — không truy được nguồn gốc."
  exit 2
fi

printf 'KẾT LUẬN: PASS — cây vendor bacnet-stack nguyên vẹn\n'
exit 0
