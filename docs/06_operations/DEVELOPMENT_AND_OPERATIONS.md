# Development and Operations

**ID:** OPS-DEV-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-28

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

Source hiện hành đã có `mkddc-netcfg`, local-HMI broker và Web REST/FE transaction path.
`network.conf.eth` chỉ là compatibility shadow; không dùng toast “Đã lưu” hoặc file config làm
bằng chứng kernel đã đổi địa chỉ. Active/configured/pending, capability, DNS và management
hostname phải lấy từ `GET /api/v1/network/transaction` hoặc `network_status`.

GET status cho session xác thực; mọi POST validate/stage/apply/confirm/rollback chỉ cho Admin.
Local HMI đặt flow trong surface Service nhưng network mutation chỉ cho
role Admin. Protocol v1 strict từ chối unknown field; DNS optional là preserve/auto/manual và
được journal/rollback cùng IPv4.

Orange Pi service evidence 2026-07-22 đã xác nhận transaction, process recovery,
120 s rollback và control continuity trên interface dummy tách khỏi management.
Đổi IP production trên `end1` vẫn chỉ được chạy trong commissioning có local/console
fallback và backup NetworkManager cho tới khi physical Ethernet HIL được duyệt. Không
restart `mkddc-iobus` chỉ để nhận IP mới; BACnet datalink tự rebind theo address change.

Luồng ADR-017 đã implement code-local:

1. Web Admin hoặc local-HMI Admin tạo transaction; mọi session hợp lệ đọc được status/old/new/rollback deadline theo bề mặt được cấp.
2. Static apply giữ đường cũ tới confirm khi topology cho phép; DHCP chờ lease thật.
3. Web/local HMI hiển thị active/configured/pending; production Web reconnect qua same-origin.
4. Không confirm/health fail trong tối đa 120 s thì helper tự phục hồi last-known-good.
5. BACnet hot-rebind/phát `I-Am`; core/IOP/STM32 tiếp tục hoạt động.

Management hostname trong authority là read-only. Chỉ provision/đổi stable origin bằng
`packaging/configure-web-hostname.sh`; package có thể cài tool/template nhưng không tự apply
hostname. Trước đổi IP target phải xác nhận unique mDNS/DNS resolution và có console hoặc
management path dự phòng.

Config mặc định Orange Pi dùng `/etc/mkddc/netcfg.conf` với `NETCFG_INTERFACE=end1`;
journal ở `/data/mkddc/netcfg-transaction.json`, socket đặc quyền ở
`/run/mkddc-netcfg/netcfg.sock`. Directory riêng này là `root:mkddc 0750`; socket là
`root:mkddc 0660`, nên restart core/iobus không được đổi ownership hoặc mode của nó.
Runtime chung `/run/mkddc` cho core/iobus/Web là `0770` để broker tạo `hmi-api.sock`;
các socket ứng dụng vẫn giữ `0660`.
Khi rollback fail, giữ console/rescue access, lưu journal/log và không tiếp tục mutation
cho tới khi phục hồi last-known-good bằng NetworkManager được phê duyệt.

Overall Network gate vẫn RED. Không claim physical commissioning cho tới khi có real `end1`
DHCP/static/DNS, reboot/power-loss/disk fault, stable-hostname IP handoff, browser reconnect,
BACnet packet capture, Modbus TCP reconnect, physical control continuity, connected-panel HMI
và security approval.

## Backup, rollback và tài liệu

Rollback phải khôi phục artifact và config tương thích ABI; không trộn binary dùng SHM version khác nhau. Tài liệu lịch sử được phục hồi từ archive theo [Document Control](../00_governance/CONTROL.md), vào thư mục tạm trước khi chọn lọc nội dung.

Mọi thay đổi code/config/deploy/docs phải cập nhật `CHANGELOG.md`; không tạo README/report Markdown phân tán nếu hồ sơ hiện hành có thể chứa nội dung.
