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
noboard_started=0

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
  if [[ "${noboard_started}" == "1" ]]; then
    MKDDC_CPP_BUILD_ROOT="${build_root}/cpp" "${repository_root}/tools/run_noboard_demo.sh" stop \
      >/dev/null 2>&1 || true
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
# Trước đây chỗ này chỉ IN CẢNH BÁO rồi chạy tiếp. Hệ quả: trên mọi máy không có
# ai dựng sẵn chuỗi no-board — CI là ví dụ đúng nhất — `point-catalog` trả 503
# tất định và spec đỏ ở khẳng định ngân sách 5xx cách đó 50 dòng, tức lane này
# CHƯA TỪNG xanh được ở CI. Một tiền điều kiện mà không ai dựng thì không phải
# tiền điều kiện, nó là một lỗ hổng. Lane tự dựng lấy, và tự dọn ở `cleanup`.
#
# "File còn đó" KHÔNG đồng nghĩa "có ai đang ghi": Playwright dừng webServer bằng
# tín hiệu có thể không cho trap chạy xong, nên lần chạy trước có thể để lại một
# SHM mồ côi. Giữ nó lại là tự lừa mình rằng tiền điều kiện đã có, rồi đọc số
# liệu chết của lần chạy trước. Không có tiến trình `mkddc-core` nào bám vào thì
# xoá và dựng lại.
if [[ -e /dev/shm/mkddc_plc_shm ]] && ! pgrep -f 'mkddc-core --sock' >/dev/null 2>&1; then
  echo "PLC SHM mồ côi (không tiến trình mkddc-core nào ghi) — dựng lại chuỗi no-board." >&2
  rm -f /dev/shm/mkddc_plc_shm
fi

NOBOARD_NEEDED=0
if [[ ! -e /dev/shm/mkddc_plc_shm ]]; then
  NOBOARD_NEEDED=1
fi

# `T61-504` — NGUỒN PHỤ THUỘC ĐỌC TỪ ĐĨA khi có sẵn, thay vì tải về.
#
# `cmake --fresh` xoá cache, nên mỗi lần chạy lane này là một lần `FetchContent`
# đi tải `googletest`/`nlohmann_json` qua HTTP. Trên máy đo không có lối ra
# Internet — container CI là ca điển hình — bước configure chết ngay ở
# `googletest-populate-download`, TRƯỚC khi chạm được assertion nào. Đó đúng chế
# độ hỏng mà `playwright.programming-real.config.ts` đã ghi lại một lần:
# "một cổng không chạy được là một cổng sẽ bị bỏ qua".
#
# `build/deps-cache/<tên>` là quy ước sẵn có của repo (clone bằng git, đã nằm
# trong `.gitignore`). Có thư mục nào thì trỏ `FETCHCONTENT_SOURCE_DIR_*` vào
# đó; không có thì KHÔNG truyền gì và hành vi giữ nguyên như trước. Đây là một
# đường thoát cho môi trường, không phải một thay đổi cách đo: mã nguồn phụ
# thuộc vẫn đúng tag mà `CMakeLists.txt` khai.
deps_cache="${PROGRAMMING_REAL_DEPS_CACHE:-${repository_root}/build/deps-cache}"
deps_args=()
for dep in nlohmann_json:NLOHMANN_JSON googletest:GOOGLETEST \
           bacnet_stack_src:BACNET_STACK_SRC lvgl:LVGL; do
  dep_dir="${deps_cache}/${dep%%:*}"
  if [[ -d "${dep_dir}" ]]; then
    deps_args+=("-DFETCHCONTENT_SOURCE_DIR_${dep##*:}=${dep_dir}")
  fi
done
if (( ${#deps_args[@]} > 0 )); then
  echo "Dùng nguồn phụ thuộc có sẵn ở ${deps_cache}: ${deps_args[*]}" >&2
fi

if [[ "${PROGRAMMING_REAL_SKIP_BUILD:-0}" != "1" ]]; then
  cmake --fresh -S "${repository_root}" -B "${build_root}/cpp" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCORE_BUILD_TESTS=OFF \
    -DIOBUS_BUILD_TESTS=OFF \
    -DMKDDC_ENABLE_FW_HOSTCHECK=OFF \
    -DMKDDC_ENABLE_HMI=OFF \
    ${deps_args[@]+"${deps_args[@]}"}
  noboard_targets=()
  if [[ "${NOBOARD_NEEDED}" == "1" ]]; then
    # Chuỗi no-board là thứ ghi PLC SHM thật; chỉ build khi thật sự cần.
    noboard_targets=(mkddc-core mkddc-iobus fake_mcu shm_dump_io)
  fi
  cmake --build "${build_root}/cpp" --parallel --target \
    mkddc-programming-core-sim mkddc-st-compile mkddc-st-package \
    mkddc-programming-sim-worker "${noboard_targets[@]}"
  (
    cd "${repository_root}/apps/web-api"
    go build -trimpath -o "${build_root}/mkddc-web" ./cmd/mkddc-web
  )
fi

if [[ "${NOBOARD_NEEDED}" == "1" ]]; then
  if ! command -v socat >/dev/null 2>&1; then
    # Fail-closed và nói thẳng: thiếu socat thì không có PLC SHM, không có PLC
    # SHM thì `point-catalog` trả 503 và spec đỏ ở một khẳng định không liên
    # quan. Hỏng ở đây với đúng lý do rẻ hơn nhiều so với đọc ngược trace.
    echo "LỖI: lane E2E real-backend cần socat để dựng chuỗi no-board (PLC SHM)." >&2
    echo "     cài bằng: sudo apt-get install -y socat" >&2
    exit 1
  fi
  MKDDC_CPP_BUILD_ROOT="${build_root}/cpp" \
    "${repository_root}/tools/run_noboard_demo.sh" start
  noboard_started=1
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

# `T59-811` — user store là bản SAO trong runtime tạm, không phải file trong
# repo.
#
# Trước đây `USERS_CONF` trỏ thẳng vào `apps/web-api/config/users.conf` trong
# khi mọi thứ khác dùng `runtime_root`. Backend ghi user mới ra đúng đường dẫn
# đó, nên mỗi lần một test tạo tài khoản (vd viewer cho case RBAC) là một tài
# khoản thật rơi vào file được commit — kèm bcrypt hash của một mật khẩu ai cũng
# biết. Chín tài khoản như vậy đã lọt vào repo trước khi phát hiện.
cp "${repository_root}/apps/web-api/config/users.conf" "${runtime_root}/config/users.conf"

# Check không chỉ đọc Point Catalog sống; nó đối chiếu binding LOCAL với
# `io_config.conf` đang chạy. Lane dựng PLC SHM từ cấu hình đóng gói nhưng trước
# đây để CONFIG_DIR của web-api rỗng, nên cùng UI-01 vừa có trong catalog lại bị
# Check kết luận "không có trong cấu hình". Sao chép đúng baseline đóng gói vào
# runtime tạm để hai bề mặt nói về cùng một cấu hình; không ghi vào `/data`.
cp "${repository_root}/platform/packaging/io_config.conf" "${runtime_root}/config/io_config.conf"

env \
  PORT="${backend_port}" \
  JWT_SECRET="programming-real-e2e-secret-at-least-32-bytes" \
  USERS_CONF="${runtime_root}/config/users.conf" \
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
  PROGRAMMING_SIM_WORKER="${build_root}/cpp/core/mkddc-programming-sim-worker" \
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
