# Architecture Decision Log

**ID:** ADR-LOG-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-03 (ADR-023: Product Spec Programming Rev A)

Log này hợp nhất các ADR rời. ID trùng cũ đã được chuẩn hóa: EasySet parity thành ADR-013; raw SHM thành ADR-014.

| ID | Quyết định hiện hành | Trạng thái |
|---|---|---|
| ADR-001 | ADC và độ chính xác chỉ được chốt bằng đo kiểm trên phần cứng đại diện. | Accepted |
| ADR-002 | Clock, reset và ground-domain phải được kiểm soát tại ranh giới SOM/MCU/I/O. | Accepted |
| ADR-003 | Protection/EMC được thiết kế theo ranh giới terminal và phải có evidence trước release. | Accepted |
| ADR-004 | Rev A dùng component graph runtime, không dùng IEC 61131-3/FBD/ST runtime. | Superseded by ADR-020 |
| ADR-005 | Kiến trúc là ba core processes; HMI là dịch vụ thứ tư feature-gated, không làm thay đổi core control path. | Amended |
| ADR-006 | Form/JSON vẫn là baseline cho cấu hình product-wide ngoài Programming. Câu “wiresheet canvas hoãn sau Rev A” không áp dụng để loại FBD khỏi Product Spec; trải nghiệm authoring FBD chờ quyết định OD-PROG-006 và Programming Design. | Amended by ADR-023 |
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
| ADR-021 | **RBAC 3 vai trò (`viewer`/`operator`/`admin`) thuộc baseline Rev A.0**, không còn hoãn sang Rev B. Backend đã hiện thực đủ ba vai trò với `auth.Require(...)` trên từng endpoint và API quản trị tài khoản kèm guard last-admin; frontend nối nốt phần còn thiếu ở plan 45. Ma trận route↔quyền tối thiểu của Web suy TRỰC TIẾP từ bảng route backend (`src/frontend/src/auth/roles.ts`), frontend không được nới lỏng hơn server. Vẫn thuộc Rev B: nhóm quyền tuỳ biến, phân quyền theo từng point, SSO/AD, lịch sử phiên đăng nhập. | Accepted 2026-08-01 |
| ADR-022 | CI/CD tự động build và deploy xuống board qua self-hosted runner trên chính Orange Pi 5B; auto-deploy khi merge `main` có điều kiện board là lab/dev; atomic swap + health check + tự rollback; `mkddc-netcfg` không được restart mù khi còn giao dịch dở. | Proposed — WP2 xong, WP1/3/4/5/6 còn mở |
| ADR-020 | Rev A dùng Program Runtime do Mekong sở hữu, phạm vi ngôn ngữ ST + FBD; LD/SFC và claim certified/compliant ngoài scope. Component graph 28-node là As-Built legacy, không gọi là FBD. Việc CTO từng mở ST host component chỉ cho phép thu evidence phát triển, không phải bằng chứng runtime production hoặc claim Programming implemented. Phạm vi Point/cycle và workflow tài liệu được ADR-023 sửa đổi/làm rõ. | Accepted — supersedes ADR-004; amended by ADR-023 |
| ADR-023 | **Khóa Product Spec Programming DDC-24 Rev A:** chỉ Local Physical I/O, Virtual Point, Modbus RTU Point, ST, FBD và cycle time 1 s/5 s/30 s. Modbus TCP Point, BACnet/IP Point, LD, SFC, motion, safety PLC và online change ngoài scope Programming. Product Spec quy định sản phẩm phải làm gì; Requirement quy định nghĩa vụ từng layer; Programming Design chưa thực hiện; As-Built chỉ được kết luận từ source/evidence. Không dùng ST host unit test làm bằng chứng runtime production và không claim Programming đã implement. Các vấn đề chưa quyết định đi vào `PROGRAMMING_OPEN_DECISIONS.md`. | Accepted 2026-08-03 |
| ADR-024 | **Thiết kế Modbus RTU Point trước Programming:** đề xuất mô hình Bus → Device → Point; hai bus logic độc lập; stable Point ID; typed value/timestamp/quality; atomic config apply có iobus ACK; reliable write result/readback và không blind replay. Chi tiết/9 quyết định review tại `DDD-SW-MBRTU-POINT-001`. Không thay đổi source hoặc đóng real-RS485 gate. | Proposed 2026-08-03 — chờ Product/System/Fieldbus/HW/QA review |

## Diễn giải bắt buộc

- “Ba process” nghĩa là ba service lõi bắt buộc. `mkddc-hmi` là local presentation service tùy chọn.
- HMI Rev A hiện hành là màn KD024QVFIA073-02-C021B/JD9852 qua MIPI DSI một lane, cảm ứng FT5436 qua I²C và DRM/KMS; các mô tả ILI9341/SPI là lịch sử.
- “Limited operator HMI” không cấp quyền trực tiếp cho `mkddc-hmi`: local point metadata chỉ phục vụ trình bày; authority phải xác thực session/role, kiểm policy/range/priority/TTL và ghi audit trước khi core arbitration quyết định effective output.
- ADR-017 là ngoại lệ commissioning hẹp cho câu “không có engineering trên panel”: Service được xem `active/pending` network, chọn Ethernet DHCP hoặc nhập IPv4/subnet/gateway, confirm hay rollback. Wi-Fi credential, DNS nâng cao, VLAN, routing, firewall, BACnet Device ID/port và cấu hình protocol vẫn thuộc Web/engineering.
- SOM network authority là helper/daemon least-privilege, không phải core process thứ tư và không nằm trong control path. `mkddc-hmi` chỉ gọi broker; `mkddc-web` chỉ làm auth/audit/adapter; chỉ network authority được activate cấu hình Linux.
- Năm surface local là `Home`, `Points`, `Control`, `Alarms`, `Service`. Communication/System được giữ dưới Home/Service; không mất diagnostics khi bỏ hai tab riêng.
- Base SKU là 16 UI + 4 AO + 4 DO. True isolated DI chỉ là capability/SKU tùy chọn và phải có phê duyệt riêng.
- MQTT cloud agent, OTA A/B, BACnet MS/TP và BTL certification không thuộc baseline Rev A. **ST và FBD thuộc Product Spec Programming Rev A; cơ chế authoring FBD chưa được quyết định trong nhiệm vụ này.** LD, SFC, Modbus TCP Point, BACnet/IP Point, motion và safety PLC nằm ngoài scope Programming Rev A.
- Modbus TCP và BACnet/IP vẫn có thể là giao tiếp product-wide theo `SYS-REQ-004`; chúng không được expose như Programming Point nếu Product Spec chưa đổi.
- ADR-024 ở trạng thái Proposed không phải authority để claim source conform hoặc
  Modbus RTU Point ready. Product ghi hai RTU master nhưng hardware controlled
  draft hiện mới mô tả một UART4/transceiver/connector; xung đột này phải được
  đóng bằng hardware/platform evidence hoặc Product decision, không bằng path
  `/dev/ttyS*` giả định.
- IEC 60073, IEC 62682, IEC 62443, ISO 9241-210 và ISA-101 được dùng làm design/verification guidance theo scope; không được biến review tài liệu thành tuyên bố conformity/certification.
