#!/usr/bin/env bash
# T-BAC-011 (#627) — cross-build `mkddc-iobus` cho Forlinx aarch64 với
# `MKDDC_ENABLE_BACNET=ON`, rồi chạy ba cổng kiểm binary.
#
# Vì sao là script chứ không phải mấy dòng chép trong tài liệu: ba cổng ở
# `PLAN-BACNET-D2C-001` §4.3 chỉ có giá trị khi chúng CHẠY ĐƯỢC và trả exit
# code — `T-BAC-012` (CI) và quy trình deploy phải gọi lại được đúng logic đó
# mà không chép tay.
#
# Dùng:
#   scripts/cross_build_aarch64_bacnet.sh [tuỳ chọn]
#     --bacnet on|off    dựng với BACNET bật hay tắt (mặc định on).
#                        `off` là bản ĐỐI CHỨNG: dùng để chứng minh cổng 3 biết
#                        đỏ, và để lấy danh sách NEEDED tham chiếu.
#     --build-dir <dir>  thư mục build (mặc định build/cross-arm64-bacnet-<on|off>)
#     --no-gate          chỉ dựng, không chạy cổng kiểm
#     --gate-args "..."  tham số truyền thêm cho scripts/gate_bacnet_aarch64_binary.sh
#
# Mã thoát:
#   0  configure + build + cổng đều đạt
#   2  thiếu toolchain hoặc thiếu điều kiện tiên quyết
#   3  configure hỏng
#   4  build hỏng
#   >4 cổng kiểm đỏ (giữ nguyên mã của gate_bacnet_aarch64_binary.sh)
#
# `--fresh` và ĐỌC CẢ HAI EXIT CODE là bắt buộc, không phải cẩn thận thừa: sự cố
# 2026-08-07 (ghi ở `CLAUDE.md`) là một build dir cũ còn `CMAKE_HOME_DIRECTORY`
# trỏ cây nguồn đã xoá — configure và build hỏng, nhưng bước sau vẫn chạy trên
# BINARY CŨ còn nằm đó và báo "pass". Số đo giả nguy hiểm hơn số đo đỏ.
#
# YÊU CẦU MỘT LẦN trên máy build x86_64:
#   sudo dpkg --add-architecture arm64
#   # kho arm64 của Ubuntu nằm ở ports.ubuntu.com, không phải archive.ubuntu.com
#   sudo apt-get update
#   sudo apt-get install -y g++-aarch64-linux-gnu libmodbus-dev:arm64 libsodium-dev:arm64
#   python3 -m pip install -r requirements-ci.txt   # cổng hợp đồng của apps/core
#
# Refs: #627 (T-BAC-011), PLAN-BACNET-D2C-001 §4.3, R-BAC-02, ADR-022, ADR-060

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

BACNET="on"
BUILD_DIR=""
RUN_GATE=1
GATE_ARGS=""

fail() { printf 'FAIL: %s\n' "$*" >&2; }
info() { printf '      %s\n' "$*"; }

usage() {
  sed -n '/^# Dùng:/,/^#     --gate-args/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bacnet)    BACNET="$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]')"; shift 2 ;;
    --build-dir) BUILD_DIR="${2:-}"; shift 2 ;;
    --no-gate)   RUN_GATE=0; shift ;;
    --gate-args) GATE_ARGS="${2:-}"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    *)           fail "tham số lạ: $1"; usage >&2; exit 2 ;;
  esac
done

case "$BACNET" in
  on|off) ;;
  *) fail "--bacnet chỉ nhận 'on' hoặc 'off' (nhận '$BACNET')"; exit 2 ;;
esac
BACNET_UPPER="$(printf '%s' "$BACNET" | tr '[:lower:]' '[:upper:]')"
[[ -z "$BUILD_DIR" ]] && BUILD_DIR="build/cross-arm64-bacnet-${BACNET}"

TOOLCHAIN="platform/cmake/toolchain-aarch64-linux-gnu.cmake"
if [[ ! -f "$TOOLCHAIN" ]]; then
  fail "không thấy $TOOLCHAIN"
  exit 2
fi
if ! command -v aarch64-linux-gnu-g++ >/dev/null 2>&1; then
  fail "thiếu cross toolchain. Cài: sudo apt-get install -y g++-aarch64-linux-gnu"
  exit 2
fi
if [[ "$BACNET" == "on" && ! -f "third_party/bacnet-stack/CMakeLists.txt" ]]; then
  fail "thiếu cây vendor third_party/bacnet-stack (OD-BAC-009)."
  fail "Dựng lại: scripts/vendor_bacnet_stack.sh — kiểm: scripts/verify_vendor_bacnet_stack.sh"
  exit 2
fi

# Không có sysroot riêng thì pkg-config của host sẽ trả về gói amd64 và ld báo
# `cannot find -lmodbus`. Ghim PKG_CONFIG_LIBDIR vào thư mục pkgconfig arm64.
export PKG_CONFIG_LIBDIR="${PKG_CONFIG_LIBDIR:-/usr/lib/aarch64-linux-gnu/pkgconfig}"

mkdir -p logs
CFG_LOG="logs/cross-arm64-bacnet-${BACNET}-configure.log"
BUILD_LOG="logs/cross-arm64-bacnet-${BACNET}-build.log"

printf '=== Cross-build mkddc-iobus (aarch64, BACNET=%s) ===\n' "$BACNET_UPPER"
info "build dir       : $BUILD_DIR"
info "PKG_CONFIG_LIBDIR: $PKG_CONFIG_LIBDIR"

# Test C++ tắt ở cấu hình cross vì binary aarch64 không chạy được trên máy build
# x86_64 — gate unit/integration chạy ở build native, đúng như ghi chú trong
# toolchain file và §8 của kế hoạch tái cấu trúc repo. Đây KHÔNG phải skip test
# để lấy màu xanh: bộ test đầy đủ vẫn chạy native trong cùng PR.
cmake --fresh -S . -B "$BUILD_DIR" \
  -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
  -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_BACNET="$BACNET_UPPER" \
  -DMKDDC_ENABLE_MODBUS=ON \
  -DIOBUS_BUILD_TESTS=OFF \
  -DCORE_BUILD_TESTS=OFF \
  -DNETCFG_BUILD_TESTS=OFF \
  -DMKDDC_ENABLE_FW_HOSTCHECK=OFF \
  > "$CFG_LOG" 2>&1
CFG_EXIT=$?
echo "cfg_exit=${CFG_EXIT}"
if [[ $CFG_EXIT -ne 0 ]]; then
  fail "configure hỏng — xem $CFG_LOG"
  tail -20 "$CFG_LOG" >&2
  exit 3
fi

cmake --build "$BUILD_DIR" --target mkddc-iobus --parallel > "$BUILD_LOG" 2>&1
BUILD_EXIT=$?
echo "build_exit=${BUILD_EXIT}"
if [[ $BUILD_EXIT -ne 0 ]]; then
  fail "build hỏng — xem $BUILD_LOG"
  tail -20 "$BUILD_LOG" >&2
  exit 4
fi

BINARY="${BUILD_DIR}/iobus/mkddc-iobus"
if [[ ! -f "$BINARY" ]]; then
  fail "build báo thành công nhưng không thấy $BINARY"
  exit 4
fi
info "binary: $BINARY"

if [[ $RUN_GATE -eq 0 ]]; then
  echo "gate: BỎ QUA theo --no-gate"
  exit 0
fi

printf '\n'
# shellcheck disable=SC2086 # GATE_ARGS cố ý tách từ
"${ROOT}/scripts/gate_bacnet_aarch64_binary.sh" "$BINARY" $GATE_ARGS
GATE_EXIT=$?
echo "gate_exit=${GATE_EXIT}"
exit "$GATE_EXIT"
