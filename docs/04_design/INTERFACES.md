# Interface Contracts

**ID:** IF-SPEC-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-22

## Kinexus-IOP v2

Nguồn thực thi: `shared/iop_protocol.h`.

| Contract | Giá trị hiện hành |
|---|---|
| UART | 921600 baud |
| `GET_IO` cadence | 2 ms / 500 Hz |
| response timeout | 3 ms |
| retry tối đa | 3 |
| link fault | 20 ms |
| reconnect | 5 s |
| handshake timeout | 1000 ms |
| MCU no-poll safe timeout | 200 ms |
| `IO_RESP` payload/frame | 74 / 80 bytes |
| Rev A capability | `0x000D`: UI16 + AO4 + DO4 |

Frame, enum, CRC và packed layout không được sao chép sang implementation khác bằng magic numbers; consumer phải include/generate từ contract chung và có static assertions.

## Shared memory ABI

Nguồn thực thi: `shared/mkddc_shm.h`.

- IO: `/dev/shm/mkddc_io_shm`; PLC: `/dev/shm/mkddc_plc_shm`.
- Magic hiện hành: `0x4B584404`.
- Capacity: UI16, reserved optional DI8, AO4, DO4, AV32, BV16, MSV8, extension64.
- Iobus ghi I/O state/reliability; core ghi AO setpoint/DO command và sở hữu PLC SHM.
- Writer dùng sequencing contract; reader phải phát hiện inconsistent snapshot.

Mọi thay đổi field, alignment hoặc semantic unit là ABI change: đổi magic, cập nhật tất cả consumer và layout tests, rebuild/deploy đồng bộ.

## AO boundary

AO ở core/iobus boundary là giá trị vật lý V hoặc mA theo electrical mode đã được MCU acknowledge. BACnet/config engineering range được convert đúng một lần trước boundary. Non-finite/out-of-range bị reject.

## Web/API

Nguồn thực thi: `web/backend/http.go` và validator/schema liên quan. Route groups hiện hành gồm auth/me/users; system status/network/config; points và WebSocket; alarms; commissioning; history/trends; schedules; alarm settings. Hồ sơ này không freeze danh sách route chi tiết; OpenAPI hoặc route tests, nếu phát hành, phải sinh/verify từ code.

## HMI

Target hiện hành: KD024QVFIA073-02-C021B, controller JD9852, MIPI DSI một lane, touch FT5436 qua I²C, DRM/KMS `/dev/dri/card0` và sáu GPIO buttons. ILI9341/SPI không thuộc baseline.

### Local command contract — host implemented, target acceptance pending

HMI đọc telemetry từ SHM nhưng mọi mutation dùng Unix-domain IPC versioned qua local auth/audit broker; đây không phải HTTP, browser hay Web HMI. Contract v1 dùng line-delimited JSON tại `/run/mkddc/hmi-api.sock`, frame tối đa 8192 byte, socket mode `0660`, kiểm tra `SO_PEERCRED` và optional UID allowlist.

Request gồm `version=1`, `requestId`, `action`, optional opaque `token`, `pointId`, `alarmId`, `mode`, finite `value`, `reason`, `ttlS`; login dùng `username/password`. Action allowlist: `ping`, `login`, `logout`, `policy`, `points`, `status`, `alarms`, `query`, `setpoint`, `mode`, `override`, `release`, `alarm_ack`. Unknown field/version/action bị reject.

Response gồm cùng `requestId`, `result`, stable `reasonCode` và optional `point`; point chứa authoritative value/source priority và `overrideExpiresInS`. Duplicate `requestId` có cùng payload trả cached response; cùng ID khác payload bị reject `ID_CONFLICT`.

Broker sở hữu authentication, role/policy validation và durable audit. Core sở hữu arbitration/interlock/safe-state/effective output và monotonic override TTL. HMI chỉ render response; local point DB không được dùng làm authorization source. Nếu broker/core không sẵn sàng trong deadline, mutation bị kết thúc bằng lỗi rõ và Control chuyển read-only, không blind replay. Không thay SHM layout cho contract này. Schema authority: `shared/hmi_protocol_v1.schema.json`.

## Detailed design

BACnet PICS/EPICS, configuration schema, graph schema, Modbus map, REST/OpenAPI và SOM/MCU interface được điều hướng tại [Interface Detailed Design Index](../02_design/interfaces/README.md).
