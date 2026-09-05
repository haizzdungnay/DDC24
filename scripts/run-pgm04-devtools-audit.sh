#!/usr/bin/env bash
set -Eeuo pipefail

# `T61-505` / `ISS-PGM04-18` — lane BROWSER/HOST: Chrome thật + CDP, trên backend
# thật.
#
# Phiên audit `2026-09-03` không chạy được Chrome DevTools vì máy đo thiếu X
# server, và toàn bộ bằng chứng UI của PGM-04 vì thế dừng ở ảnh Playwright.
# `--headless=new` khắc phục đúng chỗ đó: đây là Chrome thật, có DevTools
# Protocol đầy đủ, và không cần X server. Profile nằm trong thư mục tạm —
# KHÔNG dùng profile cá nhân, đúng ràng buộc của `AGENTS.md`.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_dir}/.." && pwd)"
backend_port="${PGM04_AUDIT_BACKEND_PORT:-4183}"
frontend_port="${PGM04_AUDIT_FRONTEND_PORT:-4177}"
cdp_port="${PGM04_AUDIT_CDP_PORT:-9333}"
chrome_bin="${PGM04_AUDIT_CHROME:-/opt/google/chrome/chrome}"
runtime_root="$(mktemp -d "${TMPDIR:-/tmp}/mkddc-pgm04-audit.XXXXXX")"
stack_pid=""
vite_pid=""
chrome_pid=""

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  for pid in "${chrome_pid}" "${vite_pid}" "${stack_pid}"; do
    [[ -n "${pid}" ]] && kill -TERM "${pid}" 2>/dev/null || true
  done
  sleep 1
  for pid in "${chrome_pid}" "${vite_pid}" "${stack_pid}"; do
    [[ -n "${pid}" ]] && kill -KILL "${pid}" 2>/dev/null || true
  done
  rm -rf -- "${runtime_root}"
  exit "${code}"
}
trap cleanup EXIT INT TERM

# Cổng phải TRỐNG trước khi bắt đầu.
#
# Một lần chạy trước bị giết giữa chừng có thể để lại backend/vite còn sống.
# Nếu chỉ `curl /health` rồi đi tiếp, phép đo sẽ gắn vào STACK CŨ — và bằng
# chứng thu được là bằng chứng của dữ liệu lần trước, không phải lần này. Đó là
# cách một audit "xanh" mà không nói gì về bản mã đang xét.
for port in "${backend_port}" "${frontend_port}" "${cdp_port}"; do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:${port}/" >/dev/null 2>&1 \
     || curl --fail --silent --max-time 2 "http://127.0.0.1:${port}/api/v1/health" >/dev/null 2>&1 \
     || curl --fail --silent --max-time 2 "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1; then
    echo "LỖI: cổng ${port} đang có tiến trình khác phục vụ — dừng nó trước." >&2
    echo "     (một lần chạy trước bị giết giữa chừng thường là nguyên nhân)" >&2
    exit 1
  fi
done

if [[ ! -x "${chrome_bin}" ]]; then
  echo "LỖI: không tìm thấy Chrome ở ${chrome_bin}. Đặt PGM04_AUDIT_CHROME." >&2
  exit 1
fi

echo "== dựng stack backend thật ==" >&2
PROGRAMMING_REAL_BACKEND_PORT="${backend_port}" \
  "${repository_root}/scripts/run_programming_real_e2e_stack.sh" > "${runtime_root}/stack.log" 2>&1 &
stack_pid=$!
for _ in $(seq 1 600); do
  curl --fail --silent "http://127.0.0.1:${backend_port}/api/v1/health" >/dev/null 2>&1 && break
  kill -0 "${stack_pid}" 2>/dev/null || { echo "stack chết:" >&2; tail -30 "${runtime_root}/stack.log" >&2; exit 1; }
  sleep 1
done
curl --fail --silent "http://127.0.0.1:${backend_port}/api/v1/health" >/dev/null

echo "== gieo dữ liệu qua API thật ==" >&2
seed_json="$(PGM04_SEED_PORT="${backend_port}" node "${script_dir}/pgm04_devtools_seed.mjs")"
export PGM04_AUDIT_PROJECT="$(printf '%s' "${seed_json}" | sed -n 's/.*"projectId":"\([^"]*\)".*/\1/p')"
export PGM04_AUDIT_VIEWER="$(printf '%s' "${seed_json}" | sed -n 's/.*"viewer":"\([^"]*\)".*/\1/p')"
export PGM04_AUDIT_VIEWER_PASSWORD="$(printf '%s' "${seed_json}" | sed -n 's/.*"viewerPassword":"\([^"]*\)".*/\1/p')"
[[ -n "${PGM04_AUDIT_PROJECT}" ]] || { echo "gieo dữ liệu hỏng: ${seed_json}" >&2; exit 1; }

echo "== vite dev trỏ vào backend thật ==" >&2
(
  cd "${repository_root}/apps/web-ui"
  VITE_DDC_MODE=live VITE_AUTH_MODE=jwt VITE_PROGRAMMING_REV_A=1 \
    VITE_PROGRAMS_WORKSPACE_V2=1 VITE_E2E_NO_WATCH=1 \
    VITE_PROXY_TARGET="http://127.0.0.1:${backend_port}" \
    npm run dev -- --port "${frontend_port}" --strictPort
) > "${runtime_root}/vite.log" 2>&1 &
vite_pid=$!
for _ in $(seq 1 240); do
  curl --fail --silent "http://127.0.0.1:${frontend_port}/login" >/dev/null 2>&1 && break
  sleep 0.5
done
curl --fail --silent "http://127.0.0.1:${frontend_port}/login" >/dev/null

echo "== Chrome thật, headless=new, profile cô lập ==" >&2
"${chrome_bin}" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --lang=vi-VN \
  --remote-debugging-port="${cdp_port}" \
  --user-data-dir="${runtime_root}/chrome-profile" \
  about:blank > "${runtime_root}/chrome.log" 2>&1 &
chrome_pid=$!
for _ in $(seq 1 120); do
  curl --fail --silent "http://127.0.0.1:${cdp_port}/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl --fail --silent "http://127.0.0.1:${cdp_port}/json/version" >/dev/null

echo "== thu bằng chứng ==" >&2
cd "${repository_root}"
PGM04_AUDIT_BASE_URL="http://127.0.0.1:${frontend_port}" \
  PGM04_AUDIT_API="http://127.0.0.1:${backend_port}" \
  PGM04_AUDIT_CDP="http://127.0.0.1:${cdp_port}" \
  node "${script_dir}/pgm04_devtools_audit.mjs"
