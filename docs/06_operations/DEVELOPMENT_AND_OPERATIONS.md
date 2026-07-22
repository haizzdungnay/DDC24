# Development and Operations

**ID:** OPS-DEV-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-22

## Repository map

- `services/core`: graph/control runtime.
- `services/iobus`: IOP, I/O and field protocols.
- `services/hmi`: optional LVGL HMI.
- `web/backend`, `web/frontend`: API and Web UI.
- `shared`: cross-process ABI/protocol headers.
- `packaging`: install/service artifacts; verify actual contents before release.
- `tests` and service-local test folders: automated evidence sources.

## Build và test

Luôn đọc build files hiện hành thay vì sao chép command cũ. Baseline workflow:

```bash
cmake -S services -B build/services -DCMAKE_BUILD_TYPE=Debug
cmake --build build/services -j
ctest --test-dir build/services --output-on-failure

(cd web/backend && go test ./...)
(cd web/frontend && npm ci && npm run build && npm run lint)
```

HMI: thêm `-DMKDDC_ENABLE_HMI=ON` và xác minh dependency/target. BACnet: dùng option hiện có trong CMake và chạy protocol smoke phù hợp. Không coi build trên host là thay thế HIL/target test.

## Configuration và deployment

1. Backup config/data và ghi commit/artifact hash.
2. Build cùng shared headers; ABI change yêu cầu deploy đồng bộ consumer.
3. Validate config trước restart; AO mode change cần restart phối hợp.
4. Kiểm tra unit/package thực tế, dependency order và permissions.
5. Smoke status, points, IOP heartbeat, output safe behavior và logs.

Không mặc định rằng HMI đã nằm trong package chính; xác minh service unit và artifact của build được phát hành.

## Chẩn đoán

- I/O stale: kiểm tra UART/IOP heartbeat, response timing, retry/fault và MCU state.
- Consumer không chạy: so SHM magic/size/layout và owner/permissions.
- AO sai: kiểm tra electrical mode đã acknowledge, engineering conversion và V/mA boundary.
- Web lỗi points/config: kiểm tra auth, route/backend log, SHM consumer và config validator.
- HMI blank/input lỗi: kiểm tra DRM `/dev/dri/card0`, DSI panel, FT5436 I²C, GPIO/backlight và build flag.

## Network commissioning status and recovery

Source baseline 2026-07-22 đã có `mkddc-netcfg` và local-HMI broker transaction. Web
`PUT /api/v1/network` cũ vẫn chỉ lưu desired files và trả warning `pending B7`; không
dùng toast “Đã lưu” hoặc `network.conf` làm bằng chứng kernel đã đổi địa chỉ. Active
IPv4 phải lấy từ action `network_status`/kernel trên target.

Cho tới khi NWC-017 target evidence được duyệt, đổi IP production qua HMI chỉ được chạy
trong commissioning có local/console fallback, Ethernet interface allowlist và backup
NetworkManager. Không restart `mkddc-iobus` chỉ để nhận IP mới vì service còn sở hữu
IOP/UART; BACnet datalink tự rebind theo address change.

Luồng ADR-017 đã implement:

1. Service/Admin tạo transaction và xem old/new/rollback deadline.
2. Static apply giữ đường cũ tới confirm khi topology cho phép; DHCP chờ lease thật.
3. Local HMI hiển thị active IP để reconnect Web.
4. Không confirm/health fail trong tối đa 120 s thì helper tự phục hồi last-known-good.
5. BACnet hot-rebind/phát `I-Am`; core/IOP/STM32 tiếp tục hoạt động.

Config mặc định Orange Pi dùng `/etc/mkddc/netcfg.conf` với `NETCFG_INTERFACE=end1`;
journal ở `/data/mkddc/netcfg-transaction.json`, socket ở `/run/mkddc/netcfg.sock`.
Khi rollback fail, giữ console/rescue access, lưu journal/log và không tiếp tục mutation
cho tới khi phục hồi last-known-good bằng NetworkManager được phê duyệt.

## Backup, rollback và tài liệu

Rollback phải khôi phục artifact và config tương thích ABI; không trộn binary dùng SHM version khác nhau. Tài liệu lịch sử được phục hồi từ archive theo [Document Control](../00_governance/CONTROL.md), vào thư mục tạm trước khi chọn lọc nội dung.

Mọi thay đổi code/config/deploy/docs phải cập nhật `CHANGELOG.md`; không tạo README/report Markdown phân tán nếu hồ sơ hiện hành có thể chứa nội dung.
