# Software Design

**ID:** SW-DES-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-03 (layout bounded modules As-Built)

## Ranh giới Programming Rev A

[Product Spec Programming Rev A](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md)
chỉ quy định Local Physical I/O, Virtual Point, Modbus RTU Point, ST, FBD và
cycle time 1 s/5 s/30 s. Tài liệu Software này không phải Programming Design đã
được phê duyệt cho scope mới. Trong nhiệm vụ đồng bộ ngày 2026-08-03:

- Product Spec trả lời sản phẩm phải làm gì;
- `REQUIREMENTS.md` trả lời từng layer phải đáp ứng gì;
- Programming Design chưa được thực hiện;
- tên service, class, artifact và component hiện có bên dưới chỉ mô tả As-Built
  hoặc đề xuất lịch sử, không chứng minh Programming đã implement.

Modbus TCP, BACnet/IP, LD, SFC, motion và safety PLC không được đưa vào
Programming Design Rev A. Chi tiết chưa quyết định nằm tại
[Programming Open Decisions](../00_governance/PROGRAMMING_OPEN_DECISIONS.md).

## Service design

| Service | Ngôn ngữ | Trách nhiệm chính |
|---|---|---|
| `mkddc-core` | C++17 | graph lifecycle, scan, priority, safe-state, PLC SHM |
| `mkddc-iobus` | C/C++ | IOP, I/O conversion, IO SHM, Modbus, BACnet/IP |
| `mkddc-web` | Go + React/TypeScript | API, auth, config, history, commissioning, Web UI và local HMI auth/audit broker |
| `mkddc-hmi` | C++/LVGL | local display/input và limited operator client qua DRM/KMS; feature-gated |
| `mkddc-netcfg` | C++17 SOM helper | active network state, staged Ethernet apply/confirm/rollback và last-known-good; privileged boundary độc lập, ngoài control path |
| `mkddc-program-service` *(tên đề xuất lịch sử; không phải As-Built)* | Chưa quyết định | Phân bổ trách nhiệm chờ Programming Design; không được dùng tên này để suy ra implementation. |
| `mkddc-program-core` *(tên đề xuất lịch sử; không phải As-Built)* | Chưa quyết định | Phân bổ runtime chờ Programming Design; không được dùng tên này để suy ra implementation. |

Mỗi service phải có failure boundary rõ, validate external input, log lỗi có hành động và không dựa vào presentation layer cho safety.

## Component graph As-Built — legacy, không phải Programming Product Spec

28 loại node được đăng ký trong `apps/core/domain/graph/graph_runtime.cpp`:

`AI_Input`, `DI_Input`, `Setpoint`, `AND`, `OR`, `NOT`, `Compare_GT`, `Compare_LT`, `Scale`, `Limit`, `PID`, `AO_Output`, `DO_Output`, `ManualAuto`, `OnDelay`, `OffDelay`, `Interlock`, `RuntimeCounter`, `PulseCounter`, `SafeState`, `AlarmHigh`, `AlarmLow`, `AlarmDelay`, `Modbus_RTU_Read`, `Modbus_RTU_Write`, `Modbus_TCP_Read`, `BACnet_AV`, `BACnet_BV`.

Danh sách trên là sự thật As-Built của source hiện tại. Các node
`Modbus_TCP_Read`, `BACnet_AV`, `BACnet_BV` không vì tồn tại mà trở thành
Programming Point Rev A. Vai trò migration/importer, nếu cần, chưa được quyết
định tại OD-PROG-013; không được gọi component graph là FBD hoặc dùng nó làm
bằng chứng Program ST/FBD production. Thêm/đổi node vẫn cần cập nhật schema,
serializer, validation, tests, requirement/traceability và compatibility policy.

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

## Modbus RTU Point — design package In Review

[DDD-SW-MBRTU-POINT-001](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md)
đề xuất contract production trước Programming Design: Bus → Device → Point,
hai BusWorker độc lập trong `mkddc-iobus`, typed sample/timestamp/quality,
atomic apply có iobus ACK và write request/result có thẩm quyền.

Hồ sơ đang `In Review`, chưa thay đổi As-Built và chưa cho phép claim
`MODBUS_RTU_POINT_READY`. Nó cũng không phải Programming Design: phần I/O
Mapping sau này chỉ được dùng stable `point_id` từ Point Catalog, không được
tự truy cập register/slot hoặc mở thêm Modbus TCP/BACnet Point.

P0 review blocker: Product baseline yêu cầu hai Modbus RTU master nhưng hardware
controlled draft/source hiện chỉ chứng minh một RS485 path/master. Phải chốt
ADR-024 và hai production capability trước khi thiết kế được Active.

## HMI

HMI là consumer/presenter và limited operator client, không phải core control process. Năm surface local là Home/Points/Control/Alarms/Service. Operator chỉ được setpoint, mode, override và release point có authoritative policy cho phép. Service là surface, không phải role; ngoại lệ hẹp ADR-017 cho cấu hình/phục hồi Ethernet IPv4 yêu cầu Admin, còn DNS/management hostname và engineering sâu không thuộc panel 2.4 inch.

Telemetry tiếp tục đọc SHM read-only. Mutation phải dùng versioned Unix-domain IPC qua auth/audit broker rồi core arbitration; local display metadata không cấp quyền. Broker mất hoặc response timeout làm action fail closed và HMI tiếp tục read-only. Build mặc định tắt qua `MKDDC_ENABLE_HMI`; release có HMI phải chứng minh target rendering, input, command lifecycle, RBAC/audit, backlight/GPIO error handling và failure isolation.

## Detailed design

Runtime, component library, iobus, BACnet, fieldbus, HMI, security và coding design nằm tại [Software Detailed Design Index](../02_design/software/README.md). Requirements/architecture sources nằm tại [Source Specifications](../01_specs/README.md). Agent/OTA documents được giữ nhưng đánh dấu deferred.

Các tài liệu Program Runtime C0/C1–C10 và ST/IR chi tiết hiện hữu là đề xuất
lịch sử hoặc As-Built component-level. Chúng phải được reconcile với
`PROD-PROG-001` và các quyết định mở trước khi có thể trở thành Programming
Design authority; nhiệm vụ hiện tại không phê duyệt hoặc mở Implementation
Plan nào.
