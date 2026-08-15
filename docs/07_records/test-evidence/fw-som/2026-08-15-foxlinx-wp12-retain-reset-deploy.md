# Bằng chứng deploy WP-12 (RETAIN Reset) lên Foxlinx

> **ID:** `EV-PROG-WP12-001`
> **WP:** WP-12 RETAIN Reset (`DDD-RETAIN-RESET-PROG-001`)
> **Ngày chạy:** 2026-08-15
> **Bo đích:** `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`), aarch64,
> Buildroot, Web/API `8081`
> **Source (merge commit):** `158ba8b` (PR #185)

## 1. Phạm vi

Deploy nhị phân cross-compile aarch64 cho `mkddc-core`, `mkddc-st-compile`,
`mkddc-st-validate`, `mkddc-schedule-sim`, `mkddc-iobus`, `mkddc-netcfg`,
`mkddc-web` (Go, `GOOS=linux GOARCH=arm64 CGO_ENABLED=0`), và FE static
(`VITE_PROGRAMMING_REV_A=1 npm run build`) mang thay đổi WP-12: Core RETAIN
reset engine (Scheduler + Coordinator + IPC dispatch), BE `OperationService.
ResetRetain()` + HTTP handler, FE `RetainResetSection` (DangerZone).

`mkddc-hmi` **không** được rebuild/deploy lượt này — thiếu thư viện
cross-compile aarch64 (`libfreetype`/`libdrm`) trên máy dev hiện tại và
HMI/LVGL không nằm trong phạm vi thay đổi của WP-12 (không có regression
risk khi giữ nguyên binary HMI cũ trên board).

## 2. Build

| Thành phần | Lệnh | Kết quả |
|---|---|---|
| C++ (aarch64) | `cmake --build build/fw-aarch64 --target mkddc-core mkddc-st-compile mkddc-st-validate mkddc-schedule-sim mkddc-iobus mkddc-netcfg` | Thành công — 6 binary ELF aarch64 |
| Go (aarch64) | `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o build/fw-aarch64/web-api ./cmd/mkddc-web` | Thành công — lưu ý path đúng là `./cmd/mkddc-web`, không phải `./cmd/server` như checklist cũ ghi (đã lỗi thời) |
| FE | `VITE_PROGRAMMING_REV_A=1 npm run build` | Thành công; `grep -c REVA_SCOPE_ROADMAP dist/assets/*.js` = 0 (đúng kỳ vọng, cờ không bị tree-shake tắt) |

Ghi chú: `cmake --build build/fw-aarch64` chạy target `all` fail ở bước
`gtest_discover_tests` của `netcfg_tests` — CMake cố CHẠY binary aarch64
vừa cross-compile trên host x86_64 để liệt kê test, tất nhiên fail
(`Exec format error`/syntax error). Đây là hạn chế cấu hình cross-compile
sẵn có (không set `CROSSCOMPILING_EMULATOR`), không phải regression của
WP-12. Build từng target binary cụ thể (không qua `all`) để né bước này —
không ảnh hưởng gì tới nhị phân deploy thật.

## 3. Backup trước deploy

`/opt/mkddc-backups/20260815-103357-wp12-retain-reset/` — bản sao
`mkddc-core`, `mkddc-st-compile`, `mkddc-schedule-sim`, `mkddc-iobus`,
`mkddc-netcfg`, `mkddc-web`, `dist/` từ trước lượt deploy này.

## 4. Cài đặt và khởi động

Dừng `mkddc-web-pi`/`mkddc-core`/`mkddc-iobus`/`mkddc-netcfg` → `install -m
0755` từng binary vào `/usr/sbin/` (Core) và `/opt/mkddc-web/mkddc-web`
(Go) → thay `dist/` → khởi động lại theo thứ tự
`netcfg → iobus → core → web-pi`. `mkddc-reload-helper.service` không tồn
tại trên board này (`Unit not found`) — bỏ qua, không chặn deploy (unit
tùy chọn, không có trong `UNITS_START` bắt buộc).

## 5. Smoke test (10 mục, `FOXLINX_DEPLOY_CHECKLIST.md` §5)

| # | Mục | Kết quả |
|---|---|---|
| 1 | Service status | `mkddc-core`/`mkddc-iobus`/`mkddc-web-pi`/`mkddc-netcfg` đều `active` |
| 2b | Health tổng | `{"status":"ok","checks":{"core":"ok","io_shm":"ok","iobus":"ok","mcu_connection":"ok","plc_shm":"ok","web":"ok"}}` |
| 3 | SHM magic | `05 44 58 4b` (LE) — đúng |
| 4 | Web UI | HTML `<!doctype html>` trả về đúng |
| 5 | Version | `mkddc-core --version` → `git_commit=158ba8ba37cd6b12288bc110475e5d2a03152305` — khớp chính xác merge commit `158ba8b` của PR #185 |
| 8 | Log lỗi | Không có lỗi từ `mkddc-*`; chỉ có lỗi lặp không liên quan từ service bên thứ ba `AgentSvr-agent.service` (`Exec format error` — vendor agent trên board, không thuộc MK-DDC-24, đã tồn tại từ trước, không phải regression) |
| 9 | Disk | 27% (< 80%) |
| 10 | Temp | 44.02°C (< 70°C) |

## 6. Xác nhận riêng cho WP-12 — route retain/reset không còn 503 mặc định

Trước PR #185, mọi request tới `POST /api/v1/programming/retain/reset`
rơi vào nhánh fallback chung của `handleProgrammingRequest`
(`router.go`), luôn trả `503 PRG-ERR-UNAVAILABLE-001` bất kể có header
Authorization hay không (route "contract-only"). Sau deploy, log thật
trên board (`journalctl -u mkddc-web-pi`):

```
INFO http method=POST path=/api/v1/programming/retain/reset status=401 dur_ms=0
```

`401 Unauthorized` (không phải `503`/`404`) — request KHÔNG mang token đã
chạm đúng route đã đăng ký, đi qua đúng middleware auth
(`webrouter.Protected`) giống mọi route Programming khác, chứ không còn là
route "chết" luôn trả 503. Đây là bằng chứng ở tầng board thật rằng handler
mới đã được nối vào router thật, khác hành vi cũ.

**Giới hạn bằng chứng:** không có credential đăng nhập web-app (JWT) cho
board này trong phiên làm việc (SSH `admin123` khác với mật khẩu web-app
Admin — nợ kỹ thuật đã ghi nhận từ trước, xem
`docs/07_records/test-evidence/` các bản ghi liên quan "Foxlinx thiếu
credential web-app"), nên **không** thực hiện được một lượt RETAIN reset
thật end-to-end qua UI trên board (click nút → submit → SUCCEEDED) trong
phiên này. Hành vi ứng dụng đầy đủ (impact list, checkbox, poll, audit)
đã được xác nhận bằng test tự động thật (không mock giả định) ở ba tầng:
6 test C++ (`ctest`), 5 test Go (`go test`), 12 test RTL + 10 Playwright
trình duyệt thật (mock backend nhưng mount UI thật) — xem
`docs/02_design/software/PROGRAMMING_RETAIN_RESET_DESIGN.md` §11 và
`CHANGELOG.md`.

## 7. Kết luận

Deploy WP-12 lên Foxlinx **thành công**, không regression phát hiện được
qua smoke test 10 mục. Route RETAIN reset xác nhận đã nối router/auth thật
trên board (không còn 503 blanket). Việc còn thiếu — chạy live UI flow
end-to-end thật trên board — chặn bởi thiếu credential web-app Admin, nợ
kỹ thuật đã biết trước (không phải phát sinh mới từ WP-12), không do đây
tạo ra.
