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
make -C "$MKDDC_FW_SOURCE" clean all MKDDC_VERSION="$version"

mkdir -p "$(dirname "$web_binary")" "$release_dir"
(
  cd "$MKDDC_GO_SOURCE"
  go build -trimpath -ldflags "-s -w -X mkddc-web/internal/app.buildVersion=$version -X mkddc-web/internal/app.buildGitCommit=$commit_label -X mkddc-web/internal/app.buildTime=$build_time -X mkddc-web/internal/app.buildToolchain=$(go version | tr ' ' '-')" \
    -o "$MKDDC_REPOSITORY_ROOT/$web_binary" ./cmd/mkddc-web
)
(
  cd "$MKDDC_WEB_UI_SOURCE"
  npm ci
  npm run build
)

toolchain="$(c++ --version | head -n1 | tr ' ' '-')"
printf '{\n  "version": "%s",\n  "git_commit": "%s",\n  "dirty": %s,\n  "build_time": "%s",\n  "toolchain": "%s"\n}\n' \
  "$version" "$commit" "$dirty" "$build_time" "$toolchain" > "$release_dir/provenance.json"
sha256sum \
  "$build_dir/core/mkddc-core" "$build_dir/iobus/mkddc-iobus" \
  "$build_dir/netcfg/mkddc-netcfg" "$web_binary" \
  "$MKDDC_FW_BINARY_REL" \
  > "$release_dir/checksums.sha256"

echo "OK: release=$version commit=$commit_label provenance=$release_dir/provenance.json"
