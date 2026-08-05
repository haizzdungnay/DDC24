# Development and Operations

**ID:** OPS-DEV-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-03

## Repository map

- `apps/core`, `apps/iobus`, `apps/netcfg`, `apps/hmi`: runtime SOM theo process.
- `apps/web-api`, `apps/web-ui`: API và Web UI.
- `firmware/stm32`: firmware MCU.
- `contracts`: authority IOP, SHM, config schema và OpenAPI.
- `platform/cmake`, `platform/packaging`, `platform/systemd`: build và deploy.
- `tests` and service-local test folders: automated evidence sources.

## Build và test

Luôn đọc build files hiện hành thay vì sao chép command cũ. Baseline workflow:

```bash
scripts/verify-project.sh --component layout
scripts/verify-project.sh --component cpp --profile full
scripts/verify-project.sh --component go
scripts/verify-project.sh --component frontend
scripts/verify-project.sh --component e2e
scripts/verify-project.sh --component firmware
platform/packaging/build-release.sh
sha256sum --check build/release/checksums.sha256
```

HMI: thêm `-DMKDDC_ENABLE_HMI=ON` và xác minh dependency/target. BACnet: dùng option hiện có trong CMake và chạy protocol smoke phù hợp. Không coi build trên host là thay thế HIL/target test.

## Configuration và deployment

1. Backup config/data và ghi commit/artifact hash.
2. Build cùng contract trong `contracts/`; ABI change yêu cầu deploy đồng bộ consumer.
3. Validate config trước restart; AO mode change cần restart phối hợp.
4. Kiểm tra unit/package thực tế, dependency order và permissions.
5. Smoke status, points, IOP heartbeat, output safe behavior và logs.

Không mặc định rằng HMI đã nằm trong package chính; xác minh service unit và artifact của build được phát hành.

### Target board

| Board | Vai trò | SSH alias | Host / Port | User | Auth |
|---|---|---|---|---|---|
| Foxlinx SOM-DDC-24 | **Production** (MCU STM32 thật) | `SOM-DDC-24-foxlinx` | `mekong-fac.ddns.net:2223` | `root` | Password (`admin123`) |

> ⚠️ **Orange Pi 5B không còn sử dụng** (từ 2026-08-05). Mọi tham chiếu tới SSH alias
> `SOM-DDC-24` (port 2222), user `orangepi`, hoặc lệnh `apt`/`dpkg` trong các tài liệu cũ
> đều là di sản của board lab đã ngưng. Chỉ deploy lên `SOM-DDC-24-foxlinx`.

Deploy lên board dùng `ssh SOM-DDC-24-foxlinx`. Quy trình chi tiết:
- [Foxlinx Deploy Checklist](../08_hardware/foxlinx-som-ddc24/FOXLINX_DEPLOY_CHECKLIST.md) (mới, ưu tiên)
- [27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK §2a](03_implementation/27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md) (legacy, có phần Orange Pi đã deprecated)


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

~~Orange Pi service evidence 2026-07-22 đã xác nhận transaction, process recovery,
120 s rollback và control continuity trên interface dummy tách khỏi management.~~
*(Board Orange Pi 5B đã ngưng sử dụng từ 2026-08-05; evidence trên cần được tái kiểm chứng
trên board Foxlinx production.)*
Đổi IP production trên interface Ethernet (`eth0` trên Foxlinx) vẫn chỉ được chạy trong
commissioning có local/console fallback. Không restart `mkddc-iobus` chỉ để nhận IP mới;
BACnet datalink tự rebind theo address change.

Luồng ADR-017 đã implement code-local:

1. Web Admin hoặc local-HMI Admin tạo transaction; mọi session hợp lệ đọc được status/old/new/rollback deadline theo bề mặt được cấp.
2. Static apply giữ đường cũ tới confirm khi topology cho phép; DHCP chờ lease thật.
3. Web/local HMI hiển thị active/configured/pending; production Web reconnect qua same-origin.
4. Không confirm/health fail trong tối đa 120 s thì helper tự phục hồi last-known-good.
5. BACnet hot-rebind/phát `I-Am`; core/IOP/STM32 tiếp tục hoạt động.

Management hostname trong authority là read-only. Chỉ provision/đổi stable origin bằng
`platform/packaging/configure-web-hostname.sh`; package có thể cài tool/template nhưng không tự apply
hostname. Trước đổi IP target phải xác nhận unique mDNS/DNS resolution và có console hoặc
management path dự phòng.

Config mặc định trên Foxlinx dùng `/etc/mkddc/netcfg.conf` với `NETCFG_INTERFACE=eth0`
(trước đây Orange Pi dùng `end1`, đã deprecated);
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
