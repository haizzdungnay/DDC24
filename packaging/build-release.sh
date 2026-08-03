#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

version="${MKDDC_RELEASE_VERSION:-0.1.0}"
commit="$(git rev-parse HEAD)"
dirty=false
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  dirty=true
fi
commit_label="$commit"
[ "$dirty" = false ] || commit_label="${commit}-dirty"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
build_dir="build/services"
release_dir="build/release"

cmake -S services -B "$build_dir" -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_VERSION="$version" -DMKDDC_ENABLE_MODBUS=ON \
  -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build "$build_dir" -j"$(nproc)"
make -C fw clean all MKDDC_VERSION="$version"

mkdir -p build/web "$release_dir"
(
  cd web/backend
  go build -trimpath -ldflags "-s -w -X main.buildVersion=$version -X main.buildGitCommit=$commit_label -X main.buildTime=$build_time -X main.buildToolchain=$(go version | tr ' ' '-')" \
    -o ../../build/web/mkddc-web .
)
(
  cd src/frontend
  npm ci
  npm run build
)

toolchain="$(c++ --version | head -n1 | tr ' ' '-')"
printf '{\n  "version": "%s",\n  "git_commit": "%s",\n  "dirty": %s,\n  "build_time": "%s",\n  "toolchain": "%s"\n}\n' \
  "$version" "$commit" "$dirty" "$build_time" "$toolchain" > "$release_dir/provenance.json"
sha256sum \
  "$build_dir/core/mkddc-core" "$build_dir/iobus/mkddc-iobus" \
  "$build_dir/netcfg/mkddc-netcfg" build/web/mkddc-web \
  fw/build/firmware.elf \
  > "$release_dir/checksums.sha256"

echo "OK: release=$version commit=$commit_label provenance=$release_dir/provenance.json"
