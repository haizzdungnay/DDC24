# Software Design

**ID:** SW-DES-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-23 (ADR-020: thêm Mekong Program Runtime ST+FBD; component graph đổi vai trò thành legacy importer)

## Service design

| Service | Ngôn ngữ | Trách nhiệm chính |
|---|---|---|
| `mkddc-core` | C++17 | graph lifecycle, scan, priority, safe-state, PLC SHM |
| `mkddc-iobus` | C/C++ | IOP, I/O conversion, IO SHM, Modbus, BACnet/IP |
| `mkddc-web` | Go + React/TypeScript | API, auth, config, history, commissioning, Web UI và local HMI auth/audit broker |
| `mkddc-hmi` | C++/LVGL | local display/input và limited operator client qua DRM/KMS; feature-gated |
| `mkddc-netcfg` | C++17 SOM helper | active network state, staged Ethernet apply/confirm/rollback và last-known-good; privileged boundary độc lập, ngoài control path |
| `mkddc-program-service` *(ADR-020, chưa triển khai — C1+)* | Go, gọi `libmkddc_iec` | project/source/revision, build orchestration, artifact registry, RBAC/audit cho Program Runtime |
| `mkddc-program-core` *(ADR-020, chưa triển khai — C1+)* | C++17 | typed IR interpreter deterministic cho ST/FBD, task scheduler, retain state, activation/rollback |

Mỗi service phải có failure boundary rõ, validate external input, log lỗi có hành động và không dựa vào presentation layer cho safety.

## Component graph Rev A — legacy importer (ADR-020)

28 loại node được đăng ký trong `services/core/graph_runtime.cpp`:

`AI_Input`, `DI_Input`, `Setpoint`, `AND`, `OR`, `NOT`, `Compare_GT`, `Compare_LT`, `Scale`, `Limit`, `PID`, `AO_Output`, `DO_Output`, `ManualAuto`, `OnDelay`, `OffDelay`, `Interlock`, `RuntimeCounter`, `PulseCounter`, `SafeState`, `AlarmHigh`, `AlarmLow`, `AlarmDelay`, `Modbus_RTU_Read`, `Modbus_RTU_Write`, `Modbus_TCP_Read`, `BACnet_AV`, `BACnet_BV`.

Thêm/đổi node cần cập nhật schema, serializer, validation, tests, requirement/traceability và compatibility policy. Theo ADR-020, engine chính của Rev A.0 là Program Runtime do Mekong sở hữu (IEC 61131-3-aligned, ST + FBD); component graph 28-node ở trên chỉ còn vai trò legacy importer/nguồn chuyển đổi sang vendor function block `MKDDC_*`, không được gọi là FBD. LD, SFC, online change và claim certified/compliant không thuộc Rev A.0 — xem `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`.

## Control semantics

- Input snapshot phải nhất quán trước mỗi scan.
- Priority và force/release được quyết định tại một ranh giới sở hữu rõ ràng.
- Safe-state/interlock được đánh giá trước publish output.
- AO conversion từ engineering unit sang V/mA chỉ diễn ra một lần; DAC conversion thuộc iobus/MCU path.
- Config invalid hoặc SHM ABI mismatch phải fail closed/fast theo rủi ro, không silently coerce.

## Persistence và security

Config write phải atomic khi có thể, validate trước activate và giữ rollback/backup phù hợp. API mutation cần authentication, role authorization và audit context. Secret không đưa vào source, sample hoặc log. Các claim TLS/hardening production chỉ hợp lệ sau deployment verification.

Network config là transaction nhiều bước, không phải config-file write thông thường. `mkddc-netcfg` phải tách candidate/active/last-known-good, dùng bounded versioned UDS và peer credentials, persist transaction đủ để rollback sau process/host restart, và chỉ có capability/path cần thiết để quản lý Ethernet. Nó không được nhận command shell tùy ý. Static IPv4 dùng make-before-break khi target hỗ trợ; DHCP giữ recovery path/last-known-good rõ ràng.

`mkddc-iobus` phải quan sát address change hoặc nhận internal reload event để đóng/mở lại riêng BACnet socket, refresh local/broadcast address và phát `I-Am` mà không dừng UART scan. Modbus RTU không liên quan; Modbus TCP outbound phải retry bằng source address mới. `mkddc-web` tiếp tục bind wildcard nhưng phải lấy active IP từ kernel/network authority thay vì desired config.

## HMI

HMI là consumer/presenter và limited operator client, không phải core control process. Năm surface local là Home/Points/Control/Alarms/Service. Operator chỉ được setpoint, mode, override và release point có authoritative policy cho phép. Service là surface, không phải role; ngoại lệ hẹp ADR-017 cho cấu hình/phục hồi Ethernet IPv4 yêu cầu Admin, còn DNS/management hostname và engineering sâu không thuộc panel 2.4 inch.

Telemetry tiếp tục đọc SHM read-only. Mutation phải dùng versioned Unix-domain IPC qua auth/audit broker rồi core arbitration; local display metadata không cấp quyền. Broker mất hoặc response timeout làm action fail closed và HMI tiếp tục read-only. Build mặc định tắt qua `MKDDC_ENABLE_HMI`; release có HMI phải chứng minh target rendering, input, command lifecycle, RBAC/audit, backlight/GPIO error handling và failure isolation.

## Detailed design

Runtime, component library, iobus, BACnet, fieldbus, HMI, security và coding design nằm tại [Software Detailed Design Index](../02_design/software/README.md). Requirements/architecture sources nằm tại [Source Specifications](../01_specs/README.md). Agent/OTA documents được giữ nhưng đánh dấu deferred.
