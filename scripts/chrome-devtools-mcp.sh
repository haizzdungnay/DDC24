#!/usr/bin/env bash
set -Eeuo pipefail

# Launcher cho `chrome-devtools-mcp` — dùng làm `command` trong cấu hình MCP của
# Claude Code (`.mcp.json`) và Codex (`.codex/config.toml`).
#
# Vì sao phải bọc thay vì gọi thẳng `npx`: MCP client khởi động server bằng môi
# trường của CHÍNH nó. Phiên agent trên host này không có `DISPLAY` dùng được,
# nên Chrome headful chết ngay ở bước spawn và mọi tool devtools trả
# "Missing X server to start the headful browser" — bảng kiểm chứng ghi
# `NOT_RUN`. Một dòng `env = { DISPLAY = ":99" }` trong file cấu hình KHÔNG đủ:
# nó giả định đã có ai đó dựng sẵn `:99`, mà chẳng ai dựng. Wrapper này tự bảo
# đảm điều kiện đó trước khi `exec`, nên cấu hình MCP không còn phụ thuộc vào
# thứ tự khởi động của con người.
#
# Mọi tham số truyền cho script được chuyển nguyên vẹn sang `chrome-devtools-mcp`.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_dir}/.." && pwd)"
mcp_version="${MKDDC_CHROME_DEVTOOLS_MCP_VERSION:-1.8.0}"

DISPLAY="$("${script_dir}/ensure-xvfb.sh")"
export DISPLAY

cd "${repository_root}"

default_args=(
  --isolated
  --redact-network-headers
  --no-usage-statistics
  --no-performance-crux
)

if [[ "$#" -gt 0 ]]; then
  exec npx -y "chrome-devtools-mcp@${mcp_version}" "$@"
fi
exec npx -y "chrome-devtools-mcp@${mcp_version}" "${default_args[@]}"
