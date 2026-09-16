#!/usr/bin/env bash
# Sinh cây vendor bacnet-stack vào `third_party/bacnet-stack/`.
#
# Vì sao script chứ không chép tay: `OD-BAC-009` ràng buộc 1 đòi giữ nguyên từng
# byte bản đã ghim, để lần nâng version sau còn rebase được. Một cây vendor chép
# tay không chứng minh được điều đó và không lặp lại được. Ở đây cây vendor là
# ĐẦU RA của script — nâng version = đổi TAG + SHA rồi chạy lại, không có bước
# phán đoán nào của con người.
#
# Nguồn lấy bằng GIAO THỨC GIT, không phải tarball HTTP. Đo 2026-09-16 trong môi
# trường agent: tarball `codeload`/`archive` trả HTTP 403, `git clone` exit 0.
# Đây là bước DUY NHẤT cần mạng; sau khi cây vendor đã commit thì build hoàn
# toàn offline (đó là mục đích của `OD-BAC-009` phương án (a)).
#
# Refs: OD-BAC-009, #625, ADR-060

set -euo pipefail

TAG="${MKDDC_BACNET_TAG:-bacnet-stack-1.3.8}"
# Commit mà TAG trỏ tới. Ghim bằng SHA chứ không chỉ bằng tag: tag có thể bị dời.
EXPECT_SHA="${MKDDC_BACNET_SHA:-3e0370eee156ead7a7ceccd0f28dedd381ab5cae}"
UPSTREAM="${MKDDC_BACNET_URL:-https://github.com/bacnet-stack/bacnet-stack.git}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/third_party/bacnet-stack"

# ---------------------------------------------------------------------------
# Danh sách GIỮ — đây là phần duy nhất mang phán đoán, nên nó nằm ở đây, có tên,
# và đi qua PR. Mọi thứ không liệt kê ở đây bị loại.
#
# Cơ sở (đo trên tag bacnet-stack-1.3.8, xem PR của #625):
#   - `CMakeLists.txt`  : không `add_subdirectory`, không tham chiếu `test/`;
#                         chỉ `include(GNUInstallDirs)` + `CMakePackageConfigHelpers`
#                         (module hệ thống của CMake, không phải file trong cây).
#   - `cmake/`          : chỉ chứa `Config.cmake.in`, cần cho bước install/export.
#   - `src/`            : lõi giao thức.
#   - `ports/linux/`    : `CMakeLists.txt:623-638` chỉ nạp `ports/linux` khi
#                         `UNIX AND NOT APPLE`. 16 nền còn lại (atmega, pic18,
#                         stm32, esp32, zephyr, win32, bsd…) chiếm 22/35 MB và
#                         KHÔNG được tham chiếu ở cấu hình Linux.
#   - `license/`        : bắt buộc giữ — điều kiện phân phối lại.
#   - README/CHANGELOG/SECURITY : nguồn gốc và lịch sử, cần khi nâng version.
#
# THU HẸP CÓ CHỦ Ý: sau khi vendor, `MKDDC_ENABLE_BACNET=ON` chỉ dựng được trên
# Linux. macOS (`ports/bsd`) và Windows (`ports/win32`) sẽ hỏng ở configure.
# Bo đích là Forlinx aarch64 Linux; dev chạy Linux/WSL2; MinGW vốn đã hỏng từ
# trước ở `apps/iobus/CMakeLists.txt:51` (thiếu PkgConfig). Muốn giữ cả ba nền
# thì thêm `ports/bsd` + `ports/win32` vào danh sách dưới — không đổi gì khác.
#
# `apps/` KHÔNG giữ: chỉ dùng khi `BACNET_STACK_BUILD_APPS=ON`, mà
# `apps/iobus/CMakeLists.txt` đặt `OFF`. Bật lại cờ đó sẽ hỏng — có chủ ý.
KEEP=(
  CMakeLists.txt
  CHANGELOG.md
  README.md
  SECURITY.md
  cmake
  license
  ports/linux
  src
)

log() { printf '%s\n' "$*" >&2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log "==> clone ${UPSTREAM} @ ${TAG}"
git clone --quiet --depth 1 --branch "$TAG" "$UPSTREAM" "$WORK/src"

GOT_SHA="$(git -C "$WORK/src" rev-parse HEAD)"
if [[ "$GOT_SHA" != "$EXPECT_SHA" ]]; then
  log "LỖI: tag ${TAG} trỏ commit ${GOT_SHA}, khác SHA đã ghim ${EXPECT_SHA}."
  log "     Tag đã bị dời, hoặc bạn đang nâng version. Nâng version thì sửa"
  log "     MKDDC_BACNET_SHA trong script này VÀ ghi lý do trong commit."
  exit 1
fi
log "==> SHA khớp: ${GOT_SHA}"

log "==> dựng lại ${OUT_DIR}"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

for path in "${KEEP[@]}"; do
  if [[ ! -e "$WORK/src/$path" ]]; then
    log "LỖI: danh sách GIỮ nêu '${path}' nhưng upstream ${TAG} không có."
    log "     Cấu trúc upstream đã đổi — đọc lại trước khi nâng version."
    exit 1
  fi
  mkdir -p "$OUT_DIR/$(dirname "$path")"
  cp -a "$WORK/src/$path" "$OUT_DIR/$path"
done

# Manifest: đường dẫn tương đối, sắp xếp ổn định theo byte (LC_ALL=C) để cây
# sinh trên hai máy khác locale vẫn cho cùng một file.
log "==> sinh MANIFEST.sha256"
(
  cd "$OUT_DIR"
  find . -type f ! -name MANIFEST.sha256 ! -name VENDOR.txt -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum
) > "$OUT_DIR/MANIFEST.sha256"

FILE_COUNT="$(wc -l < "$OUT_DIR/MANIFEST.sha256" | tr -d ' ')"
MANIFEST_SHA="$(sha256sum "$OUT_DIR/MANIFEST.sha256" | cut -d' ' -f1)"

cat > "$OUT_DIR/VENDOR.txt" <<EOF
bacnet-stack — cây vendor sinh bằng máy, KHÔNG sửa tay

upstream      : ${UPSTREAM}
tag           : ${TAG}
commit        : ${GOT_SHA}
sinh bởi      : scripts/vendor_bacnet_stack.sh
số file       : ${FILE_COUNT}
manifest sha  : ${MANIFEST_SHA}

Cây này là TẬP CON của upstream: chỉ giữ phần mà cấu hình Linux tham chiếu.
Danh sách giữ và lý do từng mục nằm trong biến KEEP của script sinh.

Không sửa một byte nào trong đây. Cần patch upstream thì tách commit riêng có
ghi lý do (OD-BAC-009 ràng buộc 1), để lần nâng version sau còn rebase được.

Dựng lại:  scripts/vendor_bacnet_stack.sh
Kiểm tra :  scripts/verify_vendor_bacnet_stack.sh   (chạy offline)
EOF

log "==> xong: ${FILE_COUNT} file, manifest sha256 = ${MANIFEST_SHA}"
log "==> kích thước: $(du -sh "$OUT_DIR" | cut -f1)"
