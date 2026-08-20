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

toolchain="$(c++ --version | head -n1 | tr ' ' '-')"
printf '{\n  "version": "%s",\n  "git_commit": "%s",\n  "dirty": %s,\n  "build_time": "%s",\n  "toolchain": "%s",\n  "mcu_firmware": "not-included"\n}\n' \
  "$version" "$commit" "$dirty" "$build_time" "$toolchain" > "$release_dir/provenance.json"
sha256sum \
  "$build_dir/core/mkddc-core" "$build_dir/core/mkddc-schedule-sim" \
  "$build_dir/core/mkddc-st-compile" \
  "$build_dir/iobus/mkddc-iobus" \
  "$build_dir/netcfg/mkddc-netcfg" "$web_binary" \
  > "$release_dir/checksums.sha256"

echo "OK: release=$version commit=$commit_label provenance=$release_dir/provenance.json"
