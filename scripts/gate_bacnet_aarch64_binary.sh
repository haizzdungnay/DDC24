#!/usr/bin/env bash
# T-BAC-011 (#627) — ba cổng kiểm TĨNH trên một binary aarch64 đã dựng.
#
# Vì sao ba cổng này tồn tại (`PLAN-BACNET-D2C-001` §4.3, `R-BAC-02`):
#
#   Cổng 1 — trần GLIBCXX. Binary tham chiếu symbol libstdc++ mới hơn bản có
#   trên rootfs Forlinx thì KHÔNG hỏng lúc build; nó hỏng lúc khởi động trên bo,
#   dưới dạng "version `GLIBCXX_3.4.xx' not found".
#
#   Cổng 2 — danh sách NEEDED. Một `.so` mới mà rootfs bo không có cũng chỉ lộ
#   ra lúc chạy. Riêng `libbacnet*.so` thì luôn sai: bacnet-stack phải link TĨNH,
#   vì không có gói bacnet-stack nào trên rootfs bo để thoả.
#
#   Cổng 3 — symbol `bip_init` phải CÓ trong binary. Mọi lời gọi bacnet-stack
#   trong `apps/iobus/adapters/bacnet/bacnet_server.cpp` nằm trong
#   `#ifdef MKDDC_ENABLE_BACNET`, và nhánh `#else` của `start()` chỉ in
#   `INFO bacnet_server.start (MKDDC_ENABLE_BACNET=OFF, no-op)` rồi trả `false`.
#   Nghĩa là một bản `BACNET=OFF` vẫn deploy trót lọt, log trông bình thường, và
#   không có BACnet. Cổng 3 là thứ duy nhất phân biệt được hai bản đó từ binary.
#
# ĐÂY LÀ PHÉP KIỂM TĨNH. Script không chạy binary aarch64 — nó chỉ đọc bằng
# `objdump`/`nm`, nên chạy được trên máy dev x86_64 không cần bo, không cần
# emulator. Bằng chứng chạy thật trên bo thuộc `T-BAC-060..062`; `ADR-060` cấm
# nâng bằng chứng tĩnh thành bằng chứng runtime.
#
# Dùng:
#   scripts/gate_bacnet_aarch64_binary.sh <binary> [tuỳ chọn]
#     --glibcxx-max <X.Y.Z>   trần GLIBCXX (mặc định 3.4.30)
#     --baseline <binary>     đối chiếu NEEDED với binary tham chiếu này thay vì
#                             danh sách cho phép ghim sẵn; chênh lệch phải rỗng
#
# KHÔNG có tuỳ chọn bỏ qua cổng. Một bản BACNET=OFF PHẢI làm cổng 3 đỏ — đó là
# toàn bộ lý do cổng 3 tồn tại, và một cờ `--skip` sẽ biến nó thành thứ trang
# trí ngay lần đầu có người vội.
#
# Mã thoát — mỗi lớp hỏng một mã riêng để cổng khác gọi lại còn phân biệt được:
#   0  cả ba cổng đạt
#   2  sai tham số, thiếu binary, thiếu công cụ, hoặc binary không phải aarch64
#   3  cổng 1 đỏ (vượt trần GLIBCXX)
#   4  cổng 2 đỏ (NEEDED lạ, hoặc có libbacnet*.so)
#   5  cổng 3 đỏ (không thấy symbol bip_init)
# Nhiều cổng đỏ cùng lúc thì vẫn chạy và in hết cả ba, mã thoát là cổng đỏ
# ĐẦU TIÊN. Cổng dừng ở lỗi đầu tiên chỉ cho biết một nửa sự thật.
#
# Refs: #627 (T-BAC-011), PLAN-BACNET-D2C-001 §4.3, R-BAC-02, ADR-060

set -uo pipefail

CROSS_PREFIX="${CROSS_PREFIX:-aarch64-linux-gnu-}"
OBJDUMP="${CROSS_PREFIX}objdump"
NM="${CROSS_PREFIX}nm"

GLIBCXX_MAX="3.4.30"
BASELINE=""
BINARY=""

# Danh sách `.so` được phép xuất hiện trong NEEDED.
#
# Cách suy ra danh sách này — và đây là toàn bộ sức nặng của nó: nó ĐÚNG BẰNG
# tập NEEDED của bản cross-build `BACNET=OFF` hiện hành (đo 2026-09-16). Tức là
# bằng đúng những gì bản đang deploy hôm nay đã cần và bo đã thoả. Cổng 2 vì thế
# không hỏi "thư viện này có trên bo không" (không kiểm được từ máy dev) mà hỏi
# câu kiểm được: "bản BACNET=ON có đòi thêm thứ gì mà bản đang chạy không đòi?".
#
# Thêm một dòng vào đây là khẳng định thư viện đó có trên rootfs Forlinx, và
# phải kèm cách chứng minh trong PR — không phỏng đoán. Thiếu mục nào trong danh
# sách thì không sao (bản `MODBUS=OFF` không có `libmodbus.so.5`); THỪA mục nào
# là cổng đỏ. Muốn đối chiếu trực tiếp với một binary tham chiếu thay vì danh
# sách ghim này thì dùng `--baseline <binary>`.
ALLOWED_NEEDED=(
  "libmodbus.so.5"
  "libstdc++.so.6"
  "libm.so.6"
  "libgcc_s.so.1"
  "libc.so.6"
  "ld-linux-aarch64.so.1"
)

fail() { printf 'FAIL: %s\n' "$*" >&2; }
ok()   { printf 'OK  : %s\n' "$*"; }
info() { printf '      %s\n' "$*"; }

usage() {
  sed -n '/^# Dùng:/,/^# KHÔNG có tuỳ chọn/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --glibcxx-max) GLIBCXX_MAX="${2:-}"; shift 2 ;;
    --baseline)    BASELINE="${2:-}";    shift 2 ;;
    -h|--help)     usage; exit 0 ;;
    -*)            fail "tham số lạ: $1"; usage >&2; exit 2 ;;
    *)
      if [[ -n "$BINARY" ]]; then
        fail "chỉ nhận đúng một binary (đã có '$BINARY', lại thấy '$1')"
        exit 2
      fi
      BINARY="$1"; shift ;;
  esac
done

if [[ -z "$BINARY" ]]; then
  fail "thiếu đường dẫn binary"
  usage >&2
  exit 2
fi
if [[ ! -f "$BINARY" ]]; then
  fail "không có file '$BINARY'"
  exit 2
fi
for tool in "$OBJDUMP" "$NM"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "thiếu '$tool'. Cài bằng: sudo apt-get install -y g++-aarch64-linux-gnu"
    fail "hoặc đặt CROSS_PREFIX=<triple>- nếu toolchain dùng triple khác."
    exit 2
  fi
done

# Kiểm kiến trúc TRƯỚC ba cổng. Một cổng chạy nhầm trên binary x86_64 của host
# sẽ báo xanh mà không kiểm được gì về bản mang lên bo — đúng kiểu hỏng âm thầm
# mà `PLAN-BACNET-D2C-001` §4.3 dựng ba cổng này để chặn.
ARCH_LINE="$("$OBJDUMP" -f "$BINARY" 2>/dev/null | grep -i 'architecture' || true)"
if [[ "$ARCH_LINE" != *aarch64* ]]; then
  fail "'$BINARY' không phải ELF aarch64 (objdump -f: ${ARCH_LINE:-không đọc được})."
  fail "Cổng này chỉ có nghĩa trên binary cross-build cho bo."
  exit 2
fi
printf '=== Cổng kiểm binary aarch64: %s ===\n' "$BINARY"
info "$ARCH_LINE"

FIRST_FAIL=0
note_fail() { [[ $FIRST_FAIL -eq 0 ]] && FIRST_FAIL="$1"; }

# --- Cổng 1: trần GLIBCXX ----------------------------------------------------
printf '\n--- Cổng 1: trần GLIBCXX ≤ %s ---\n' "$GLIBCXX_MAX"
GLIBCXX_ALL="$("$OBJDUMP" -T "$BINARY" 2>/dev/null | grep -o 'GLIBCXX_[0-9.]*' | sort -uV)"
if [[ -z "$GLIBCXX_ALL" ]]; then
  # Không tham chiếu GLIBCXX nào là hợp lệ (binary C thuần, hoặc libstdc++ tĩnh).
  ok "không tham chiếu symbol GLIBCXX nào"
else
  GLIBCXX_TOP="$(printf '%s\n' "$GLIBCXX_ALL" | tail -1)"
  info "tham chiếu: $(printf '%s' "$GLIBCXX_ALL" | tr '\n' ' ')"
  # `sort -V` trên hai phần tử: bản cao nhất phải là trần, nếu không thì vượt.
  HIGHEST="$(printf '%s\nGLIBCXX_%s\n' "$GLIBCXX_TOP" "$GLIBCXX_MAX" | sort -uV | tail -1)"
  if [[ "$HIGHEST" == "GLIBCXX_${GLIBCXX_MAX}" ]]; then
    ok "cao nhất = ${GLIBCXX_TOP} (trần GLIBCXX_${GLIBCXX_MAX})"
  else
    fail "cao nhất = ${GLIBCXX_TOP}, VƯỢT trần GLIBCXX_${GLIBCXX_MAX}"
    fail "Binary này sẽ không khởi động được trên rootfs có libstdc++ cũ hơn."
    note_fail 3
  fi
fi

# --- Cổng 2: NEEDED ----------------------------------------------------------
printf '\n--- Cổng 2: NEEDED ---\n'
NEEDED="$("$OBJDUMP" -p "$BINARY" 2>/dev/null | awk '/NEEDED/ {print $2}' | sort -u)"
if [[ -z "$NEEDED" ]]; then
  info "(binary không có mục NEEDED nào — link tĩnh hoàn toàn)"
else
  info "NEEDED: $(printf '%s' "$NEEDED" | tr '\n' ' ')"
fi

GATE2_BAD=0
# 2a — bacnet-stack phải tĩnh, không có ngoại lệ nào và không phụ thuộc baseline.
while IFS= read -r so; do
  [[ -z "$so" ]] && continue
  if [[ "$so" == libbacnet* ]]; then
    fail "NEEDED có '$so' — bacnet-stack PHẢI link tĩnh, rootfs bo không có gói này"
    GATE2_BAD=1
  fi
done <<< "$NEEDED"

# 2b — so với đối chứng: hoặc binary tham chiếu (--baseline), hoặc danh sách ghim.
if [[ -n "$BASELINE" ]]; then
  if [[ ! -f "$BASELINE" ]]; then
    fail "không có binary đối chứng '$BASELINE'"
    exit 2
  fi
  BASE_NEEDED="$("$OBJDUMP" -p "$BASELINE" 2>/dev/null | awk '/NEEDED/ {print $2}' | sort -u)"
  info "đối chứng ($BASELINE): $(printf '%s' "$BASE_NEEDED" | tr '\n' ' ')"
  EXTRA="$(comm -23 <(printf '%s\n' "$NEEDED") <(printf '%s\n' "$BASE_NEEDED"))"
  if [[ -n "$EXTRA" ]]; then
    fail "NEEDED thừa so với đối chứng: $(printf '%s' "$EXTRA" | tr '\n' ' ')"
    fail "Mỗi mục thêm phải chứng minh được là có sẵn trên rootfs Forlinx."
    GATE2_BAD=1
  else
    ok "chênh lệch NEEDED so với đối chứng là RỖNG"
  fi
else
  ALLOWED_SORTED="$(printf '%s\n' "${ALLOWED_NEEDED[@]}" | sort -u)"
  EXTRA="$(comm -23 <(printf '%s\n' "$NEEDED") <(printf '%s\n' "$ALLOWED_SORTED"))"
  if [[ -n "$EXTRA" ]]; then
    fail "NEEDED ngoài danh sách cho phép: $(printf '%s' "$EXTRA" | tr '\n' ' ')"
    fail "Thêm vào ALLOWED_NEEDED chỉ khi chứng minh được thư viện có trên rootfs bo."
    GATE2_BAD=1
  else
    ok "mọi mục NEEDED đều nằm trong danh sách thư viện nền của rootfs bo"
  fi
fi
[[ $GATE2_BAD -eq 1 ]] && note_fail 4

# --- Cổng 3: symbol bip_init -------------------------------------------------
printf '\n--- Cổng 3: symbol bip_init ---\n'
BIP_COUNT="$("$NM" -C "$BINARY" 2>/dev/null | grep -c bip_init)"
info "số symbol khớp 'bip_init': ${BIP_COUNT}"
if [[ "$BIP_COUNT" -gt 0 ]]; then
  ok "binary có mã BACnet/IP thật (bip_init hiện diện)"
else
  fail "KHÔNG thấy symbol bip_init — đây là bản dựng BACNET=OFF"
  fail "Bản này vẫn chạy được trên bo và log trông bình thường, nhưng KHÔNG có BACnet."
  note_fail 5
fi

printf '\n=== Kết quả ===\n'
if [[ $FIRST_FAIL -eq 0 ]]; then
  ok "cả ba cổng đạt"
  exit 0
fi
fail "có cổng đỏ; mã thoát = ${FIRST_FAIL}"
exit "$FIRST_FAIL"
