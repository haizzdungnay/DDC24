#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
component="all"
profile="full"
build_root="${MKDDC_BUILD_ROOT:-$repo_root/build/verify}"

usage() {
  printf '%s\n' \
    'Dùng: scripts/verify-project.sh [--component NAME] [--profile NAME]' \
    '' \
    'Component: layout | cpp | go | frontend | e2e | firmware | release | all' \
    'Profile C++: baseline | modbus | bacnet | modbus-bacnet | full (mặc định)' \
    '' \
    'Script không xóa SHM, dữ liệu người dùng hoặc build tree ngoài build_root.'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --component) component="${2:?thiếu component}"; shift 2 ;;
    --profile) profile="${2:?thiếu profile}"; shift 2 ;;
    --build-root) build_root="${2:?thiếu build root}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'LỖI: tham số không hỗ trợ: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

active_path() {
  python3 - "$repo_root/tools/restructure/repository-path-map.json" "$1" <<'PY'
import json
import sys

manifest = json.load(open(sys.argv[1], encoding="utf-8"))
owner = sys.argv[2]
entry = next((item for item in manifest["migration"] if item["owner"] == owner), None)
if entry is None:
    raise SystemExit(f"không có owner trong path manifest: {owner}")
key = "to" if manifest["phase"] in {"g3-source-moved", "g4-modularized", "closed"} else "from"
print(entry[key])
PY
}

run_layout() {
  python3 "$repo_root/tools/restructure/verify_repository.py"
  python3 -m unittest "$repo_root/tests/integration/test_repository_contract_guard.py"
  python3 -m unittest "$repo_root/tests/integration/test_repository_dependency_guard.py"
  python3 "$repo_root/scripts/generate_programming_errors.py" --check
  python3 -m unittest "$repo_root/tests/integration/test_programming_error_catalog.py"
}

run_cpp() {
  local modbus=OFF bacnet=OFF hmi=OFF
  case "$profile" in
    baseline) ;;
    modbus) modbus=ON ;;
    bacnet) bacnet=ON ;;
    modbus-bacnet) modbus=ON; bacnet=ON ;;
    full) modbus=ON; bacnet=ON; hmi=ON ;;
    *) printf 'LỖI: profile C++ không hỗ trợ: %s\n' "$profile" >&2; exit 2 ;;
  esac
  local cpp_build="$build_root/cpp-$profile"
  cmake -S "$repo_root" -B "$cpp_build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror" \
    -DMKDDC_ENABLE_MODBUS="$modbus" \
    -DMKDDC_ENABLE_BACNET="$bacnet" \
    -DMKDDC_ENABLE_HMI="$hmi"
  cmake --build "$cpp_build" --parallel "${MKDDC_BUILD_JOBS:-4}"
  ctest --test-dir "$cpp_build" --output-on-failure \
    --parallel "${MKDDC_TEST_JOBS:-4}"
}

run_go() {
  local go_dir
  go_dir="$(active_path web-api)"
  if [ "$profile" = "race" ]; then
    (cd "$repo_root/$go_dir" && go vet ./... && go test -race ./... -count=1)
  else
    (cd "$repo_root/$go_dir" && go vet ./... && go test ./... -count=1)
  fi
}

run_frontend() {
  local frontend_dir
  frontend_dir="$(active_path web-ui)"
  (cd "$repo_root/$frontend_dir" && \
    npx vitest --run --environment jsdom src && \
    npm run lint && npm run build)
}

run_e2e() {
  local frontend_dir
  frontend_dir="$(active_path web-ui)"
  (cd "$repo_root/$frontend_dir" && \
    npx playwright test e2e/network-qa.spec.ts)
}

run_firmware() {
  make -C "$repo_root/$(active_path stm32)"
}

run_release() {
  "$repo_root/$(active_path packaging)/build-release.sh"
  (cd "$repo_root" && sha256sum --check build/release/checksums.sha256)
}

case "$component" in
  layout) run_layout ;;
  cpp) run_cpp ;;
  go) run_go ;;
  frontend) run_frontend ;;
  e2e) run_e2e ;;
  firmware) run_firmware ;;
  release) run_release ;;
  all)
    run_layout
    run_cpp
    run_go
    run_frontend
    run_e2e
    run_firmware
    ;;
  *) printf 'LỖI: component không hỗ trợ: %s\n' "$component" >&2; exit 2 ;;
esac
