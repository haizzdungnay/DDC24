# Software Design

**ID:** SW-DES-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-22

## Service design

| Service | Ngôn ngữ | Trách nhiệm chính |
|---|---|---|
| `mkddc-core` | C++17 | graph lifecycle, scan, priority, safe-state, PLC SHM |
| `mkddc-iobus` | C/C++ | IOP, I/O conversion, IO SHM, Modbus, BACnet/IP |
| `mkddc-web` | Go + React/TypeScript | API, auth, config, history, commissioning, Web UI và local HMI auth/audit broker |
| `mkddc-hmi` | C++/LVGL | local display/input và limited operator client qua DRM/KMS; feature-gated |

Mỗi service phải có failure boundary rõ, validate external input, log lỗi có hành động và không dựa vào presentation layer cho safety.

## Component graph Rev A

28 loại node được đăng ký trong `services/core/graph_runtime.cpp`:

`AI_Input`, `DI_Input`, `Setpoint`, `AND`, `OR`, `NOT`, `Compare_GT`, `Compare_LT`, `Scale`, `Limit`, `PID`, `AO_Output`, `DO_Output`, `ManualAuto`, `OnDelay`, `OffDelay`, `Interlock`, `RuntimeCounter`, `PulseCounter`, `SafeState`, `AlarmHigh`, `AlarmLow`, `AlarmDelay`, `Modbus_RTU_Read`, `Modbus_RTU_Write`, `Modbus_TCP_Read`, `BACnet_AV`, `BACnet_BV`.

Thêm/đổi node cần cập nhật schema, serializer, validation, tests, requirement/traceability và compatibility policy. Rev A không có IEC 61131-3 runtime hoặc wiresheet editor.

## Control semantics

- Input snapshot phải nhất quán trước mỗi scan.
- Priority và force/release được quyết định tại một ranh giới sở hữu rõ ràng.
- Safe-state/interlock được đánh giá trước publish output.
- AO conversion từ engineering unit sang V/mA chỉ diễn ra một lần; DAC conversion thuộc iobus/MCU path.
- Config invalid hoặc SHM ABI mismatch phải fail closed/fast theo rủi ro, không silently coerce.

## Persistence và security

Config write phải atomic khi có thể, validate trước activate và giữ rollback/backup phù hợp. API mutation cần authentication, role authorization và audit context. Secret không đưa vào source, sample hoặc log. Các claim TLS/hardening production chỉ hợp lệ sau deployment verification.

## HMI

HMI là consumer/presenter và limited operator client, không phải core control process. Năm surface local là Home/Points/Control/Alarms/Service. Operator chỉ được setpoint, mode, override và release point có authoritative policy cho phép; engineering/configuration sâu không thuộc panel 2.4 inch.

Telemetry tiếp tục đọc SHM read-only. Mutation phải dùng versioned Unix-domain IPC qua auth/audit broker rồi core arbitration; local display metadata không cấp quyền. Broker mất hoặc response timeout làm action fail closed và HMI tiếp tục read-only. Build mặc định tắt qua `MKDDC_ENABLE_HMI`; release có HMI phải chứng minh target rendering, input, command lifecycle, RBAC/audit, backlight/GPIO error handling và failure isolation.

## Detailed design

Runtime, component library, iobus, BACnet, fieldbus, HMI, security và coding design nằm tại [Software Detailed Design Index](../02_design/software/README.md). Requirements/architecture sources nằm tại [Source Specifications](../01_specs/README.md). Agent/OTA documents được giữ nhưng đánh dấu deferred.
