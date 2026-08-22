#!/usr/bin/env bash
set -euo pipefail
MKDDC_REPOSITORY_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd))"
export MKDDC_REPOSITORY_ROOT
# shellcheck source=repository-paths.sh
source "$MKDDC_REPOSITORY_ROOT/platform/packaging/repository-paths.sh"
cd "$MKDDC_REPOSITORY_ROOT"

version="${MKDDC_RELEASE_VERSION:-0.1.0}"
commit="$(git rev-parse HEAD)"
dirty=false
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  dirty=true
fi
commit_label="$commit"
[ "$dirty" = false ] || commit_label="${commit}-dirty"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
build_dir="$MKDDC_CPP_BUILD_REL"
release_dir="build/release"
web_binary="$MKDDC_GO_BINARY_REL"

cmake -S "$MKDDC_CPP_SOURCE" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_VERSION="$version" -DMKDDC_ENABLE_MODBUS=ON \
  -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build "$build_dir" -j"$(nproc)"

# 2026-08-20 — Firmware STM32 KHÔNG còn là release artifact.
#
# `firmware/stm32` hiện chỉ có lớp giao thức/state machine: mọi điểm vào phần
# cứng trong `Core/Src/main.c` là `__attribute__((weak))` trả `false`, `.ioc` là
# một file text placeholder 205 byte, và không có linker script, startup code
# hay CMSIS/HAL nào. ELF sinh ra có entry `0x811d` và `.text` ở `0x800c` — layout
# mặc định của newlib nosys, KHÔNG phải flash base `0x08000000` của STM32G0 — và
# không chứa `Reset_Handler` hay bảng vector. Nó không thể boot trên
# STM32G0B1RBT6.
#
# Trước đây script vẫn build rồi băm nó vào `checksums.sha256`, tức là phát hành
# provenance cho một artifact không tồn tại thật. Checksum đúng của một file
# không nạp được vẫn là bằng chứng SAI: nó nói "đây là firmware phiên bản X".
#
# Compile check cho lớp C này vẫn chạy ở CI job `mcu-firmware`
# (`scripts/verify-project.sh --component firmware`), nên gỡ ở đây không mất
# vùng phủ nào. Khi có phần cứng STM32 và BSP thật thì thêm lại cả `make` lẫn
# dòng checksum trong cùng một commit.

mkdir -p "$(dirname "$web_binary")" "$release_dir"
(
  cd "$MKDDC_GO_SOURCE"
  go build -trimpath -ldflags "-s -w -X mkddc-web/internal/app.buildVersion=$version -X mkddc-web/internal/app.buildGitCommit=$commit_label -X mkddc-web/internal/app.buildTime=$build_time -X mkddc-web/internal/app.buildToolchain=$(go version | tr ' ' '-')" \
    -o "$MKDDC_REPOSITORY_ROOT/$web_binary" ./cmd/mkddc-web
)
(
  cd "$MKDDC_WEB_UI_SOURCE"
  npm ci
  # PHẢI là `build:release`, KHÔNG phải `npm run build` trần.
  #
  # `npm run build` để `VITE_PROGRAMMING_REV_A` rỗng ⇒ `PROGRAMMING_REV_A_ENABLED`
  # bằng `false` ⇒ toàn bộ bốn workspace Programming bị ẩn khỏi NavRail và route
  # (`App.tsx`, `NavRail.tsx`). Gói phát hành khi đó thiếu hẳn một tính năng lớn
  # mà không có lỗi build nào, và triệu chứng chỉ lộ ra khi mở giao diện trên
  # board. Lỗi này đã tái diễn hai lần (2026-08-14, 2026-08-17) vì công thức
  # đúng chỉ tồn tại dưới cái tên board-specific `build:foxlinx`, còn script
  # phát hành lại gọi công thức trần.
  #
  # `tests/integration/test_release_packaging_guard.py` khoá bất biến này.
  npm run build:release
)

# T59-602 — chặn khoá TEST đi ra bản phát hành.
#
# `st_public_key.hpp` ghi nguyên tắc "build release PHẢI truyền
# -DMKDDC_ST_PUBLIC_KEY_HEX" từ lâu, và `st_public_key_is_test_key()` cũng có
# sẵn từ lâu — nhưng KHÔNG nơi nào gọi nó. Một nguyên tắc không có cổng nào đọc
# là một câu trong tài liệu, không phải một bất biến: khoá TEST cam kết vào repo
# (ai cũng có khoá riêng tương ứng) có thể lặng lẽ theo binary ra hiện trường, và
# khi đó "artifact có chữ ký" không chứng minh được gì.
#
# Lab/bench vẫn cần đóng gói bằng khoá test khi chưa có hạ tầng khoá phát hành:
# đặt MKDDC_ALLOW_TEST_KEY=1 để đi tiếp. Cờ đó cố ý ồn ào và được ghi vào
# provenance.json, nên không có bản nào "vô tình" mang khoá test mà hồ sơ không nói.
key_info="$("$build_dir/core/mkddc-core" --st-key-info)"
key_mode="$(printf '%s' "$key_info" | sed -n 's/.*mode=\([A-Z]*\).*/\1/p')"
key_fingerprint="$(printf '%s' "$key_info" | sed -n 's/.*fingerprint=\([0-9a-f]*\).*/\1/p')"
if [ "$key_mode" != "RELEASE" ]; then
  if [ "${MKDDC_ALLOW_TEST_KEY:-0}" != "1" ]; then
    printf 'LỖI: binary nhúng KHOÁ TEST (fingerprint=%s).\n' "$key_fingerprint" >&2
    printf '     Build lại với -DMKDDC_ST_PUBLIC_KEY_HEX=<64 hex> của khoá phát hành,\n' >&2
    printf '     hoặc đặt MKDDC_ALLOW_TEST_KEY=1 cho bản lab/bench (T59-602).\n' >&2
    exit 1
  fi
  printf 'CẢNH BÁO: đóng gói bằng KHOÁ TEST theo MKDDC_ALLOW_TEST_KEY=1 (fingerprint=%s)\n' \
    "$key_fingerprint" >&2
fi

toolchain="$(c++ --version | head -n1 | tr ' ' '-')"
printf '{\n  "version": "%s",\n  "git_commit": "%s",\n  "dirty": %s,\n  "build_time": "%s",\n  "toolchain": "%s",\n  "mcu_firmware": "not-included",\n  "st_public_key_mode": "%s",\n  "st_public_key_fingerprint": "%s"\n}\n' \
  "$version" "$commit" "$dirty" "$build_time" "$toolchain" "$key_mode" "$key_fingerprint" \
  > "$release_dir/provenance.json"
# T59-606 — SBOM đi cùng gói. `provenance.json` nói bản này build TỪ ĐÂU; SBOM nói
# bản này CHỨA GÌ. Khi có CVE trong một thư viện, thiếu SBOM nghĩa là câu "bo của
# tôi có dính không" phải trả lời bằng cách đọc lại mã nguồn của đúng commit đó.
python3 "$MKDDC_REPOSITORY_ROOT/scripts/generate_release_sbom.py" \
  --version "$version" --commit "$commit" --output "$release_dir/sbom.json"

sha256sum \
  "$build_dir/core/mkddc-core" "$build_dir/core/mkddc-schedule-sim" \
  "$build_dir/core/mkddc-st-compile" "$build_dir/core/mkddc-st-package" \
  "$build_dir/iobus/mkddc-iobus" \
  "$build_dir/netcfg/mkddc-netcfg" "$web_binary" \
  > "$release_dir/checksums.sha256"

echo "OK: release=$version commit=$commit_label provenance=$release_dir/provenance.json"
