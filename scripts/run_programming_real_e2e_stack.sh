#!/usr/bin/env bash
set -Eeuo pipefail

# T59-505 — stack host thật cho Playwright: compiler/packager production,
# backend Go production và Core simulator dùng scheduler/coordinator/IPC
# production. Không có page.route Programming và không tuyên bố target/HIL.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_dir}/.." && pwd)"
build_root="${PROGRAMMING_REAL_BUILD_DIR:-${repository_root}/build/programming-real-e2e}"
backend_port="${PROGRAMMING_REAL_BACKEND_PORT:-4181}"
runtime_root="$(mktemp -d "${TMPDIR:-/tmp}/mkddc-programming-real.XXXXXX")"
core_pid=""
backend_pid=""

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -n "${backend_pid}" ]]; then
    kill -TERM "${backend_pid}" 2>/dev/null || true
  fi
  if [[ -n "${core_pid}" ]]; then
    kill -TERM "${core_pid}" 2>/dev/null || true
  fi
  if [[ -n "${backend_pid}" ]]; then
    wait "${backend_pid}" 2>/dev/null || true
  fi
  if [[ -n "${core_pid}" ]]; then
    wait "${core_pid}" 2>/dev/null || true
  fi
  rm -rf -- "${runtime_root}"
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

mkdir -p "${build_root}" "${runtime_root}/config" "${runtime_root}/core/staging" \
  "${runtime_root}/programming/artifacts" "${runtime_root}/programming/scratch" \
  "${runtime_root}/programming/backups"

# Điều kiện tiên quyết KHÔNG do lane này dựng: Point Catalog của Programming đọc
# PLC SHM (`/dev/shm/mkddc_plc_shm`) — nơi `mkddc-core` thật ghi — chứ không đọc
# simulator host-only ở dưới. Thiếu SHM thì `GET /api/v1/programming/point-catalog`
# trả 503 tất định (`PRG-ERR-UNAVAILABLE-001`), và spec sẽ đỏ ở một khẳng định
# xa tít (ngân sách 5xx, hoặc a11y của bảng ánh xạ rỗng) chứ không nói ra nguyên
# nhân. Cảnh báo ngay từ đây rẻ hơn nhiều so với việc đọc ngược trace Playwright.
if [[ ! -e /dev/shm/mkddc_plc_shm ]]; then
  echo "CẢNH BÁO: thiếu /dev/shm/mkddc_plc_shm — Point Catalog sẽ trả 503." >&2
  echo "         Dựng chuỗi no-board trước: ./tools/run_noboard_demo.sh" >&2
  echo "         (dừng bằng ./tools/run_noboard_demo.sh stop)" >&2
fi

if [[ "${PROGRAMMING_REAL_SKIP_BUILD:-0}" != "1" ]]; then
  cmake --fresh -S "${repository_root}" -B "${build_root}/cpp" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCORE_BUILD_TESTS=OFF \
    -DIOBUS_BUILD_TESTS=OFF \
    -DMKDDC_ENABLE_FW_HOSTCHECK=OFF \
    -DMKDDC_ENABLE_HMI=OFF
  cmake --build "${build_root}/cpp" --parallel --target \
    mkddc-programming-core-sim mkddc-st-compile mkddc-st-package
  (
    cd "${repository_root}/apps/web-api"
    go build -trimpath -o "${build_root}/mkddc-web" ./cmd/mkddc-web
  )
fi

# T59-607 — lane này phải đi ĐÚNG đường ký của bản thật: backend ký bằng khoá
# thiết bị, Core tin đúng khoá đó. Khoá sinh mới cho mỗi lần chạy và nằm trong
# thư mục runtime tạm — không dùng chung, không cam kết vào repo.
keys_dir="${runtime_root}/keys"
mkdir -p "${keys_dir}"
if [[ ! -f "${keys_dir}/device.key" ]]; then
  "${build_root}/cpp/core/mkddc-st-compile" --gen-device-key "${keys_dir}" >/dev/null
fi

core_socket="${runtime_root}/programming.sock"
core_status_socket="${runtime_root}/core-status.sock"
"${build_root}/cpp/core/mkddc-programming-core-sim" \
  --socket "${core_socket}" \
  --web-socket "${core_status_socket}" \
  --state-dir "${runtime_root}/core" \
  --st-trusted-key "${keys_dir}/device.pub" \
  --tick-ms 20 &
core_pid=$!

for _ in $(seq 1 200); do
  if [[ -S "${core_socket}" && -S "${core_status_socket}" ]]; then
    break
  fi
  if ! kill -0 "${core_pid}" 2>/dev/null; then
    wait "${core_pid}"
  fi
  sleep 0.05
done
if [[ ! -S "${core_socket}" || ! -S "${core_status_socket}" ]]; then
  echo "Core simulator không mở đủ Programming/Web socket trong 10 giây" >&2
  exit 1
fi

env \
  PORT="${backend_port}" \
  JWT_SECRET="programming-real-e2e-secret-at-least-32-bytes" \
  USERS_CONF="${repository_root}/apps/web-api/config/users.conf" \
  CONFIG_DIR="${runtime_root}/config" \
  STATIC_DIR="${runtime_root}/static" \
  CORE_PID="${runtime_root}/missing-core.pid" \
  IOBUS_PID="${runtime_root}/missing-iobus.pid" \
  CORE_SOCK="${core_status_socket}" \
  HMI_SOCK="${runtime_root}/hmi.sock" \
  NETCFG_SOCK="${runtime_root}/netcfg.sock" \
  IOBUS_CONTROL_SOCK="${runtime_root}/modbus-control.sock" \
  TREND_DB="${runtime_root}/trend.sqlite" \
  HMI_AUDIT_FILE="${runtime_root}/hmi-audit.jsonl" \
  ALARM_HISTORY_FILE="${runtime_root}/alarm-history.jsonl" \
  PROGRAMMING_REV_A=1 \
  PROGRAMMING_DB="${runtime_root}/programming/programming.sqlite" \
  PROGRAMMING_BACKUP_DIR="${runtime_root}/programming/backups" \
  PROGRAMMING_STATE_DIR="${runtime_root}/programming" \
  PROGRAMMING_ARTIFACT_DIR="${runtime_root}/programming/artifacts" \
  PROGRAMMING_STAGING_DIR="${runtime_root}/core/staging" \
  PROGRAMMING_SCRATCH_DIR="${runtime_root}/programming/scratch" \
  PROGRAMMING_SOCKET="${core_socket}" \
  PROGRAMMING_SIGNING_KEY="${keys_dir}/device.key" \
  PROGRAMMING_COMPILER="${build_root}/cpp/core/mkddc-st-compile" \
  PROGRAMMING_PACKAGER="${build_root}/cpp/core/mkddc-st-package" \
  PROGRAMMING_TARGET_ID="host-programming-real-e2e" \
  "${build_root}/mkddc-web" &
backend_pid=$!

for _ in $(seq 1 300); do
  if curl --fail --silent --show-error "http://127.0.0.1:${backend_port}/api/v1/health" >/dev/null 2>&1; then
    echo "Programming real E2E stack sẵn sàng tại cổng ${backend_port}" >&2
    break
  fi
  if ! kill -0 "${backend_pid}" 2>/dev/null; then
    wait "${backend_pid}"
  fi
  sleep 0.1
done
if ! curl --fail --silent "http://127.0.0.1:${backend_port}/api/v1/health" >/dev/null; then
  echo "Backend không sẵn sàng trong 30 giây" >&2
  exit 1
fi

# Playwright giữ webServer này suốt suite. Bất kỳ producer nào chết
# đều là lỗi gate; không để suite tiếp tục trên nửa stack.
wait -n "${core_pid}" "${backend_pid}"
exit 1
