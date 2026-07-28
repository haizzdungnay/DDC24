# Architecture Decision Log

**ID:** ADR-LOG-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-24

Log này hợp nhất các ADR rời. ID trùng cũ đã được chuẩn hóa: EasySet parity thành ADR-013; raw SHM thành ADR-014.

| ID | Quyết định hiện hành | Trạng thái |
|---|---|---|
| ADR-001 | ADC và độ chính xác chỉ được chốt bằng đo kiểm trên phần cứng đại diện. | Accepted |
| ADR-002 | Clock, reset và ground-domain phải được kiểm soát tại ranh giới SOM/MCU/I/O. | Accepted |
| ADR-003 | Protection/EMC được thiết kế theo ranh giới terminal và phải có evidence trước release. | Accepted |
| ADR-004 | Rev A dùng component graph runtime, không dùng IEC 61131-3/FBD/ST runtime. | Superseded by ADR-020 |
| ADR-005 | Kiến trúc là ba core processes; HMI là dịch vụ thứ tư feature-gated, không làm thay đổi core control path. | Amended |
| ADR-006 | Web cấu hình bằng form/JSON; wiresheet canvas (drag-drop) hoãn sau Rev A. Không còn hàm ý loại ngôn ngữ IEC-aligned ST/FBD khỏi Rev A — xem ADR-020. | Accepted, ghi chú theo ADR-020 |
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
| ADR-017 | Network commissioning dùng strict authority v1 trên SOM: Web/local HMI không sửa trực tiếp Linux network. Ethernet IPv4 + optional DNS đi qua capability-discovered transaction `validate/stage/apply/confirm/rollback`; management hostname chỉ đọc và provision bằng script. Web GET status cho session xác thực, POST mutation Admin-only; local HMI đặt flow trong surface Service nhưng mutation chỉ role Admin. Đổi IP không dừng local control; BACnet/IP hot-rebind. | Accepted |
| ADR-018 | SQLite block historian: backend-owned per-point database logging policy, hot/archive tiers, bounded migration/recovery and unified Trends authority. | Accepted |
| ADR-019 | Independent global point tag/name namespaces, static references and generation-aware rename/delete behavior. | Accepted |
| ADR-020 | Rev A.0 dùng Program Runtime do Mekong sở hữu (không runtime IEC bên ngoài), IEC 61131-3-aligned, phạm vi ngôn ngữ **ST + FBD** (LD/SFC hoãn, chưa vào release gate Rev A.0). Component graph 28-node cũ chỉ còn là legacy importer/nguồn vendor FB, không gọi là FBD. Không online change, không claim certified/compliant trong Rev A.0. C0 là phase kiểm soát; CTO phê duyệt `FW-SOM-ST-001` ngày 2026-07-24 để mở next action FW SOM trong `services/core`: chạy/test một chương trình ST tối thiểu trên SOM host runtime. FE/Web Backend/STM32/HIL/FBD đầy đủ vẫn chờ approval riêng. | Accepted — supersedes ADR-004; amended 2026-07-24 |

## Diễn giải bắt buộc

- “Ba process” nghĩa là ba service lõi bắt buộc. `mkddc-hmi` là local presentation service tùy chọn.
- HMI Rev A hiện hành là màn KD024QVFIA073-02-C021B/JD9852 qua MIPI DSI một lane, cảm ứng FT5436 qua I²C và DRM/KMS; các mô tả ILI9341/SPI là lịch sử.
- “Limited operator HMI” không cấp quyền trực tiếp cho `mkddc-hmi`: local point metadata chỉ phục vụ trình bày; authority phải xác thực session/role, kiểm policy/range/priority/TTL và ghi audit trước khi core arbitration quyết định effective output.
- ADR-017 là ngoại lệ commissioning hẹp cho câu “không có engineering trên panel”: Service được xem `active/pending` network, chọn Ethernet DHCP hoặc nhập IPv4/subnet/gateway, confirm hay rollback. Wi-Fi credential, DNS nâng cao, VLAN, routing, firewall, BACnet Device ID/port và cấu hình protocol vẫn thuộc Web/engineering.
- SOM network authority là helper/daemon least-privilege, không phải core process thứ tư và không nằm trong control path. `mkddc-hmi` chỉ gọi broker; `mkddc-web` chỉ làm auth/audit/adapter; chỉ network authority được activate cấu hình Linux.
- Năm surface local là `Home`, `Points`, `Control`, `Alarms`, `Service`. Communication/System được giữ dưới Home/Service; không mất diagnostics khi bỏ hai tab riêng.
- Base SKU là 16 UI + 4 AO + 4 DO. True isolated DI chỉ là capability/SKU tùy chọn và phải có phê duyệt riêng.
- MQTT cloud agent, OTA A/B, wiresheet canvas (drag-drop FBD/LD editor), BACnet MS/TP và BTL certification không thuộc baseline Rev A.0. **IEC 61131-3-aligned Program Runtime (ST + FBD, Mekong-owned, không claim certified) thuộc baseline Rev A.0 theo ADR-020 — không còn bị loại trừ.** LD và SFC vẫn hoãn (schema mở rộng được, nhưng không build trong Rev A.0).
- IEC 60073, IEC 62682, IEC 62443, ISO 9241-210 và ISA-101 được dùng làm design/verification guidance theo scope; không được biến review tài liệu thành tuyên bố conformity/certification.
