#!/usr/bin/env bash
set -Eeuo pipefail

# Bảo đảm có MỘT X server dùng được, rồi in giá trị `DISPLAY` ra stdout.
#
# Vì sao cần: `chrome-devtools-mcp` khởi động Chrome **headful** (đó là điểm mạnh
# của nó — DevTools Protocol đầy đủ, Console/Network/trace thật). Trên host này
# phiên agent không thừa hưởng `DISPLAY` của phiên desktop, và `~/.Xauthority`
# không tồn tại, nên `:0`/`:1` tuy có socket vẫn trả
# "Authorization required, but no authorization protocol specified".
# Puppeteer vì thế dừng ở:
#
#     Missing X server to start the headful browser.
#
# Đó chính là lý do mọi bảng kiểm chứng gần đây ghi `Chrome DevTools MCP =
# NOT_RUN`. Xvfb trên một display RIÊNG khắc phục đúng chỗ đó mà **không** đụng
# vào phiên desktop của người dùng: không mượn `~/.Xauthority`, không ghi vào
# `:0`, không đổi biến môi trường của session đăng nhập.
#
# Script idempotent: gọi bao nhiêu lần cũng chỉ có tối đa một Xvfb cho display
# đã chọn. Dùng được cả từ shell lẫn từ trường `command` của cấu hình MCP.
#
# Biến điều khiển:
#   MKDDC_XVFB_DISPLAY   display dành riêng (mặc định `:99`)
#   MKDDC_XVFB_SCREEN    kích thước màn hình ảo (mặc định `1920x1080x24`)
#   MKDDC_XVFB_REUSE_ENV `1` (mặc định) cho phép dùng lại `$DISPLAY` sẵn có NẾU
#                        nó thực sự mở được; đặt `0` để luôn dùng Xvfb riêng.

display="${MKDDC_XVFB_DISPLAY:-:99}"
screen="${MKDDC_XVFB_SCREEN:-1920x1080x24}"
reuse_env="${MKDDC_XVFB_REUSE_ENV:-1}"
state_dir="${XDG_RUNTIME_DIR:-/tmp}/mkddc-xvfb"
pid_file="${state_dir}/$(printf '%s' "${display}" | tr -d ':').pid"
log_file="${state_dir}/$(printf '%s' "${display}" | tr -d ':').log"

# display_usable: mở thử display bằng client X thật.
#
# Không kiểm bằng sự tồn tại của `/tmp/.X11-unix/X<n>`: socket của phiên desktop
# VẪN có mặt trong khi ta không có cookie để mở nó. Một phép kiểm nhìn vào socket
# sẽ báo "có X server" rồi để Chrome chết sau đó — đúng kiểu cổng nói sai lý do
# hỏng.
display_usable() {
  local candidate="$1"
  [[ -n "${candidate}" ]] || return 1
  if command -v xdpyinfo >/dev/null 2>&1; then
    DISPLAY="${candidate}" timeout 5 xdpyinfo >/dev/null 2>&1
    return $?
  fi
  if command -v xset >/dev/null 2>&1; then
    DISPLAY="${candidate}" timeout 5 xset q >/dev/null 2>&1
    return $?
  fi
  # Không có client X nào để kiểm thì thà báo không dùng được còn hơn đoán bừa.
  return 1
}

if [[ "${reuse_env}" == "1" ]] && display_usable "${DISPLAY:-}"; then
  printf '%s\n' "${DISPLAY}"
  exit 0
fi

if display_usable "${display}"; then
  printf '%s\n' "${display}"
  exit 0
fi

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "LỖI: không có X server dùng được và cũng không có Xvfb." >&2
  echo "     cài bằng: sudo apt-get install -y xvfb x11-utils" >&2
  exit 1
fi

mkdir -p "${state_dir}"

# Xvfb phải sống QUA lệnh gọi này: nó là hạ tầng dùng chung cho các phiên MCP kế
# tiếp, không phải tiến trình con của một lần chạy. `setsid` tách nó khỏi process
# group hiện tại để Ctrl-C hoặc việc shell agent kết thúc không giết nó theo.
setsid Xvfb "${display}" -screen 0 "${screen}" -nolisten tcp \
  > "${log_file}" 2>&1 < /dev/null &
xvfb_pid=$!
printf '%s\n' "${xvfb_pid}" > "${pid_file}"

for _ in $(seq 1 60); do
  display_usable "${display}" && break
  kill -0 "${xvfb_pid}" 2>/dev/null || break
  sleep 0.25
done

if ! display_usable "${display}"; then
  echo "LỖI: Xvfb ${display} không lên được; log: ${log_file}" >&2
  tail -20 "${log_file}" >&2 || true
  exit 1
fi

printf '%s\n' "${display}"
