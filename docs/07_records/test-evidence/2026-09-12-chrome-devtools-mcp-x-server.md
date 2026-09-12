# Hồ sơ gỡ chặn lane Chrome DevTools MCP — thiếu X server

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-BROWSER-DEVTOOLS-001` |
| Ngày | 2026-09-12 |
| Base commit | `24095d23` (`main`) |
| Lớp bằng chứng | **HOST** (máy phát triển Linux, Chrome 153.0.8010.36) |
| Verdict | Lane `Chrome DevTools MCP` chuyển từ `NOT_RUN` sang **PASS**, có lệnh kiểm lại được |

## 0. Hồ sơ này KHÔNG nói gì

- **Không** biến các bản ghi cũ thành PASS. `DEPLOYMENT_PROVENANCE_REPORT.md`,
  `PROGRAMMING_PROGRAM_PROPERTY_INSPECTOR_AS_BUILT_GAP_REPORT_2026-09-09.md` và
  bảng §2.2 của plan 61 ghi `NOT_RUN` **đúng với thời điểm đo**; phép đo đã ghi
  ở đó vẫn là phép đo không có DevTools. Muốn nâng chúng thì phải đo lại.
- **Không** chứng minh UI nào đúng. Nó chỉ chứng minh **công cụ đo** đã chạy.
- **Không** là bằng chứng TARGET/HIL: Chrome chạy trên host phát triển.

## 1. Triệu chứng và nguyên nhân gốc

Tái hiện bằng một phiên MCP thật, **không** có `DISPLAY`:

```text
INIT_OK          chrome_devtools@1.8.0
TOOLS_COUNT      29
LIST_PAGES       isError=true
                 Missing X server to start the headful browser.
                 Either set headless to true or use xvfb-run to run your Puppeteer script.
```

Ba chi tiết quyết định chẩn đoán:

1. **Server MCP khởi động bình thường** — `initialize` và `tools/list` đều PASS,
   29 tool được công bố. Vì vậy triệu chứng ở phía người dùng là "tool có mặt
   nhưng dùng cái nào cũng lỗi", dễ bị đọc nhầm thành "MCP chưa cấu hình".
2. **Lỗi đến trong một kết quả tool bình thường có `isError: true`**, không phải
   JSON-RPC error. Bất kỳ cổng nào chỉ kiểm "có `result` không" sẽ báo xanh.
3. **Host *có* X server nhưng phiên agent không mở được**: `/tmp/.X11-unix/X0` và
   `X1` tồn tại (phiên desktop của người dùng đang chạy), nhưng
   `~/.Xauthority` không có, nên `DISPLAY=:0 xdpyinfo` trả
   `Authorization required, but no authorization protocol specified`. Tức là
   phép kiểm "có socket X không" sẽ kết luận sai.

Nguyên nhân gốc: `chrome-devtools-mcp` khởi động Chrome **headful** — đó là lý do
tồn tại của nó so với Playwright headless — còn phiên agent không thừa hưởng một
`DISPLAY` dùng được.

## 2. Cách sửa

| Tệp | Vai trò |
|---|---|
| `scripts/ensure-xvfb.sh` | Idempotent: trả về `$DISPLAY` hiện có **nếu mở được**, ngược lại dựng Xvfb riêng (`:99`, `1920x1080x24`, `setsid` để sống qua lệnh gọi). Không mượn `~/.Xauthority`, không ghi vào `:0`. |
| `scripts/chrome-devtools-mcp.sh` | Launcher: bảo đảm `DISPLAY` rồi `exec npx chrome-devtools-mcp` với đúng bốn cờ cũ. |
| `.mcp.json` | Cấu hình MCP cho Claude Code (trước đây **không tồn tại** — Claude Code không có server nào). |
| `.codex/config.toml` | Đổi `command` của `mcp_servers.chrome-devtools` sang launcher. |
| `scripts/verify_chrome_devtools_mcp.mjs` | Cổng kiểm chứng: dựng một phiên MCP thật qua stdio, exit `1` khi lane không chạy. |
| `scripts/verify-project.sh` | Component `browser`, và nằm trong `all` (đứng cuối). |

Vì sao phải bọc bằng launcher thay vì đặt `env = { DISPLAY = ":99" }` trong file
cấu hình MCP: dòng env đó giả định đã có ai đó dựng sẵn `:99`, mà không ai dựng.
Launcher tự bảo đảm điều kiện trước khi `exec`, nên cấu hình không còn phụ thuộc
thứ tự khởi động của con người.

## 3. Số đo, đo tại máy 2026-09-12

| Phép đo | Lệnh | Kết quả |
|---|---|---|
| Tái hiện lỗi | phiên MCP `chrome-devtools-mcp@1.8.0`, `env -u DISPLAY` | `list_pages` `isError=true`, `Missing X server…` |
| Xvfb idempotent | `env -u DISPLAY scripts/ensure-xvfb.sh` × 2 | in `:99` cả hai lần; `pgrep -c -x Xvfb` = `1` |
| Lane, `about:blank` | `scripts/verify-project.sh --component browser` | **PASS 7/7**, exit `0` |
| Lane, FE thật | cùng cổng, `MKDDC_DEVTOOLS_PROBE_URL=http://127.0.0.1:4188/login` (vite dev) | **PASS 7/7**, `navigate_page` → `Successfully navigated`, `take_snapshot` 838 ký tự |
| Cổng phát hiện lỗi | cùng cổng, probe URL `http://127.0.0.1:1/…` | **FAIL**, exit `1`, `net::ERR_UNSAFE_PORT` |
| Cổng tài liệu | `scripts/verify-project.sh --component docs` | PASS |
| Cổng tách vai | `scripts/verify-project.sh --component workflow` | PASS — 48/48 |
| Cổng layout | `scripts/verify-project.sh --component layout` | PASS |

Evidence máy sinh: `artifacts/ui-audit/chrome-devtools-mcp-gate.json`.

## 4. Một lỗi tự gây ra trong chính phiên này, đã sửa

Bản đầu của `verify_chrome_devtools_mcp.mjs` chỉ kiểm `isError` của kết quả tool.
Đo thử với `http://127.0.0.1:1/…` cho thấy `navigate_page` trả **không** `isError`
khi điều hướng hỏng — nội dung là `Unable to navigate in the selected page:
net::ERR_UNSAFE_PORT` — nên cổng báo **PASS trên một lần điều hướng thất bại**.
Với `about:blank` thì không bao giờ lộ ra; nhưng ngay khi trỏ
`MKDDC_DEVTOOLS_PROBE_URL` vào FE thật — đúng công dụng chính của cổng — nó sẽ
xanh trên một trang không tải được. Bản vá kiểm nội dung phải chứa
`Successfully navigated`; cổng nay đỏ đúng chỗ (§3, dòng "Cổng phát hiện lỗi").

## 5. Ràng buộc còn lại

- Lane cần **mạng tới registry npm** ở lần chạy đầu (`npx -y chrome-devtools-mcp`);
  sau đó dùng cache npx.
- `.mcp.json` và `.codex/config.toml` ghi **đường dẫn tuyệt đối** tới launcher
  (`/home/chuong/Desktop/DDC-PROJECT/scripts/chrome-devtools-mcp.sh`), nhất quán
  với `cwd` vốn có của cấu hình Codex. Clone repo sang đường dẫn khác thì phải
  sửa hai dòng đó.
- Claude Code chỉ nạp `.mcp.json` lúc khởi động phiên: phiên đang mở khi thêm
  file **không** có tool `chrome-devtools` cho tới khi restart. Cổng
  `--component browser` không phụ thuộc điều này — nó tự dựng phiên MCP riêng.
- Xvfb `:99` là tiến trình nền của host, không phải service. Máy khởi động lại thì
  lần gọi launcher kế tiếp tự dựng lại.
- Bằng chứng UI của các phiên **trước** 2026-09-12 không đổi trạng thái; muốn có
  Console/Network thật cho chúng thì phải đo lại qua lane này.

## Lịch sử sửa đổi

| Ngày | Nội dung |
|---|---|
| 2026-09-12 | Tạo hồ sơ; lane chuyển `NOT_RUN` → PASS. |
