# Architecture Decision Log

**ID:** ADR-LOG-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-22

Log này hợp nhất các ADR rời. ID trùng cũ đã được chuẩn hóa: EasySet parity thành ADR-013; raw SHM thành ADR-014.

| ID | Quyết định hiện hành | Trạng thái |
|---|---|---|
| ADR-001 | ADC và độ chính xác chỉ được chốt bằng đo kiểm trên phần cứng đại diện. | Accepted |
| ADR-002 | Clock, reset và ground-domain phải được kiểm soát tại ranh giới SOM/MCU/I/O. | Accepted |
| ADR-003 | Protection/EMC được thiết kế theo ranh giới terminal và phải có evidence trước release. | Accepted |
| ADR-004 | Rev A dùng component graph runtime, không dùng IEC 61131-3/FBD/ST runtime. | Accepted |
| ADR-005 | Kiến trúc là ba core processes; HMI là dịch vụ thứ tư feature-gated, không làm thay đổi core control path. | Amended |
| ADR-006 | Web cấu hình bằng form/JSON; wiresheet canvas hoãn sau Rev A. | Accepted |
| ADR-007 | Backend web dùng Go; control và I/O path dùng C/C++. | Accepted |
| ADR-008 | Sản phẩm là BMS Edge Automation Controller; HVAC là use case đầu, với 28 loại component Rev A. | Accepted |
| ADR-009 | HMI áp dụng phân cấp hiển thị/alarms theo ISA-101 ở mức design guidance, không tuyên bố chứng nhận. | Accepted |
| ADR-010 | Kinexus-IOP v2 chạy 921600 baud, poll 2 ms; shared header là contract thực thi. | Accepted |
| ADR-011 | BACnet reliability và raw/engineering metadata phải được bảo toàn xuyên suốt I/O → SHM → protocol/web. | Accepted |
| ADR-012 | AO command ở biên core/iobus dùng đại lượng điện vật lý V hoặc mA; conversion chỉ thực hiện một lần. | Accepted |
| ADR-013 | EasySet config phải round-trip nhất quán giữa UI, backend và iobus; chỉ field có consumer mới được công bố. | Accepted |
| ADR-014 | SHM là ABI C packed/aligned được chia sẻ trực tiếp; thay layout phải đổi magic và rebuild đồng bộ consumer. | Accepted |
| ADR-015 | HMI 2.4 inch là local status/commissioning/service panel; HMI không là control/alarm authority; action/ACK chỉ complete sau authoritative response và audit. | Amended by ADR-016 |
| ADR-016 | HMI 2.4 inch áp dụng phạm vi **limited operator HMI**: chỉ setpoint, mode, override và release cho point được authority whitelist. Mọi lệnh đi qua local authenticated broker rồi core priority/interlock/safety; mất broker làm HMI read-only. Không đưa full Web HMI, engineering, schedule hoặc alarm configuration lên panel local. | Accepted |

## Diễn giải bắt buộc

- “Ba process” nghĩa là ba service lõi bắt buộc. `mkddc-hmi` là local presentation service tùy chọn.
- HMI Rev A hiện hành là màn KD024QVFIA073-02-C021B/JD9852 qua MIPI DSI một lane, cảm ứng FT5436 qua I²C và DRM/KMS; các mô tả ILI9341/SPI là lịch sử.
- “Limited operator HMI” không cấp quyền trực tiếp cho `mkddc-hmi`: local point metadata chỉ phục vụ trình bày; authority phải xác thực session/role, kiểm policy/range/priority/TTL và ghi audit trước khi core arbitration quyết định effective output.
- Năm surface local là `Home`, `Points`, `Control`, `Alarms`, `Service`. Communication/System được giữ dưới Home/Service; không mất diagnostics khi bỏ hai tab riêng.
- Base SKU là 16 UI + 4 AO + 4 DO. True isolated DI chỉ là capability/SKU tùy chọn và phải có phê duyệt riêng.
- MQTT cloud agent, OTA A/B, IEC 61131-3, wiresheet canvas, BACnet MS/TP và BTL certification không thuộc baseline Rev A.0.
- IEC 60073, IEC 62682, IEC 62443, ISO 9241-210 và ISA-101 được dùng làm design/verification guidance theo scope; không được biến review tài liệu thành tuyên bố conformity/certification.
