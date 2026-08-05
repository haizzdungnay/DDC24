# Architecture Decision Log

**ID:** ADR-LOG-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-04 (đăng ký `MODBUS_RTU_OPEN_DECISIONS` cho ADR-024)

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
| ADR-021 | **RBAC 3 vai trò (`viewer`/`operator`/`admin`) thuộc baseline Rev A.0**, không còn hoãn sang Rev B. Backend đã hiện thực đủ ba vai trò với `auth.Require(...)` trên từng endpoint và API quản trị tài khoản kèm guard last-admin; frontend nối nốt phần còn thiếu ở plan 45. Ma trận route↔quyền tối thiểu của Web suy TRỰC TIẾP từ bảng route backend (`apps/web-ui/src/features/auth/roles.ts`), frontend không được nới lỏng hơn server. Vẫn thuộc Rev B: nhóm quyền tuỳ biến, phân quyền theo từng point, SSO/AD, lịch sử phiên đăng nhập. | Accepted 2026-08-01 |
| ADR-022 | CI/CD tự động build và deploy xuống board qua self-hosted runner (trước đây trên Orange Pi 5B, board này đã ngưng sử dụng từ 2026-08-05, chuyển runner sang Foxlinx hoặc CI host); auto-deploy khi merge `main` có điều kiện board là lab/dev; atomic swap + health check + tự rollback; `mkddc-netcfg` không được restart mù khi còn giao dịch dở. | Proposed — WP2 xong, WP1/3/4/5/6 còn mở (Orange Pi 5B deprecated) |
| ADR-020 | Rev A dùng Program Runtime do Mekong sở hữu, phạm vi ngôn ngữ ST + FBD; LD/SFC và claim certified/compliant ngoài scope. Component graph 28-node là As-Built legacy, không gọi là FBD. Việc CTO từng mở ST host component chỉ cho phép thu evidence phát triển, không phải bằng chứng runtime production hoặc claim Programming implemented. Phạm vi Point/cycle và workflow tài liệu được ADR-023 sửa đổi/làm rõ. | Accepted — supersedes ADR-004; amended by ADR-023 |
| ADR-023 | **Khóa Product Spec Programming DDC-24 Rev A:** chỉ Local Physical I/O, Virtual Point, Modbus RTU Point, ST, FBD và cycle time 1 s/5 s/30 s. Modbus TCP Point, BACnet/IP Point, LD, SFC, motion, safety PLC và online change ngoài scope Programming. Product Spec quy định sản phẩm phải làm gì; Requirement quy định nghĩa vụ từng layer; Programming Design chưa thực hiện; As-Built chỉ được kết luận từ source/evidence. Không dùng ST host unit test làm bằng chứng runtime production và không claim Programming đã implement. Các vấn đề chưa quyết định đi vào `PROGRAMMING_OPEN_DECISIONS.md`. | Accepted 2026-08-03 |
| ADR-024 | **Thiết kế Modbus RTU Point trước Programming:** mô hình Bus → Device → Point; stable Point ID; typed value/timestamp/quality; atomic config apply có iobus ACK; reliable write result/readback và không blind replay. Chi tiết tại `DDD-SW-MBRTU-POINT-001`. **Sửa đổi 2026-08-04 theo phê duyệt PM/CTO:** Rev A dùng **01 bus** (không phải hai); capacity Point nâng **64 → ≥256**; giữ 3 role `viewer/operator/admin`; retry là thử lại giao dịch thật; bắt buộc có test connection / read test / write test / import CSV / export CSV+JSON. | Proposed 2026-08-03 — **Track A approved 2026-08-04**; ADR còn `Proposed` tới khi HW đóng Q-01/Q-10 |
| ADR-025 | **Repository áp dụng process-first + bounded modules:** source production thuộc `apps/{core,iobus,netcfg,hmi,web-api,web-ui}`, firmware thuộc `firmware/stm32`, contract canonical thuộc `contracts`, deployment/build helper thuộc `platform`; topology runtime, binary, service unit, API, ABI và config semantics giữ nguyên. | Accepted 2026-08-03 — owner yêu cầu bắt đầu triển khai Plan 46 |

## ADR-025 — Process-first + bounded modules cho repository

- **Trạng thái:** Accepted 2026-08-03.
- **Phê duyệt:** owner/user chỉ thị triển khai
  `PLAN-ARCH-RESTRUCT-002` ngày 2026-08-03; Tech Lead chịu trách nhiệm giữ gate.
- **Bối cảnh:** source đang phân tán giữa `services`, `web`, `src/frontend`,
  `fw`, `shared` và `packaging`; path cũ bị lặp trong CMake, CI, installer,
  công cụ và tài liệu. Cấu trúc này che dependency direction và làm một path
  move có blast radius lớn dù topology runtime đã rõ.
- **Quyết định:** tổ chức source theo process owner trước, sau đó chia
  `domain/application/ports/adapters/bootstrap` hoặc bounded package/feature
  bên trong từng process. `contracts` là authority duy nhất cho IOP, SHM,
  config schema và OpenAPI. `platform` chỉ giữ build/deployment metadata;
  domain không phụ thuộc platform. Test xuyên process nằm dưới `tests`, còn
  test đơn vị được phép ở gần module sở hữu.
- **Compatibility:** giữ nguyên tên `mkddc-core`, `mkddc-iobus`, `mkddc-web`,
  `mkddc-netcfg`, optional `mkddc-hmi`; giữ systemd unit, REST/WebSocket,
  database/config filename, SHM layout/magic/version và IOP wire bytes. Header
  forwarding ở `shared` chỉ là shim có thời hạn và không nhận contract mới.
- **Hệ quả:** mọi build/CI/release consumer phải lấy path từ entrypoint hoặc
  manifest tập trung; forbidden dependency và duplicate contract authority
  phải làm verification thất bại. Restructure không chứng minh Programming,
  real RS485, target HMI hoặc physical I/O HIL.
- **Migration:** thực hiện tuần tự theo G0..G5 của
  [`PLAN-ARCH-RESTRUCT-002`](../03_implementation/46_REPOSITORY_ARCHITECTURE_RESTRUCTURE_PLAN.md);
  chỉ move source sau baseline và build indirection; chỉ xóa shim khi inventory
  xác nhận không còn consumer.
- **Rollback:** revert theo task/nhóm path gần nhất; không đổi dữ liệu runtime,
  schema hoặc package installed. Nếu path move buộc đổi public semantics hoặc
  failure boundary, dừng migration và mở decision riêng.

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
- **Phê duyệt PM/CTO ngày 2026-08-04** đóng 8 quyết định Modbus RTU và cho phép
  triển khai Track A (vá an toàn). Track B ở trạng thái `CONDITIONAL`, chỉ bắt
  đầu sau khi Hardware xác nhận số transceiver RS-485 và cơ chế điều khiển hướng
  truyền, tài liệu được đồng bộ, và PM chỉ định Fieldbus Lead + QA/HIL Lead.
  Chi tiết 11 quyết định tại
  [Biên bản phê duyệt](../07_records/reviews/MODBUS_RTU_APPROVAL_RECORD_2026-08-04.md).
  Quyết định có ảnh hưởng rộng nhất: **Rev A dùng một cổng Modbus RTU**, và
  **capacity Point nâng từ 64 lên tối thiểu 256** cùng đợt đổi ABI.
- Từ 2026-08-04, mọi vấn đề Modbus RTU còn thiếu authority được theo dõi tập
  trung tại [Modbus RTU Open Decisions](MODBUS_RTU_OPEN_DECISIONS.md)
  (`OD-MBRTU-001..016` cùng ba blocker ngoài phạm vi). Tập `DR-MBRTU-001..009`
  trong review proposal ngày 2026-08-03 được ánh xạ vào tập đó; ba mục đã được
  hợp nhất vào requirement Active và không còn là open decision. Đóng một
  `OD-MBRTU-*` yêu cầu một mục trong log này hoặc một ADR mới, có ngày và người
  ký — trao đổi miệng không đóng được quyết định.
- IEC 60073, IEC 62682, IEC 62443, ISO 9241-210 và ISA-101 được dùng làm design/verification guidance theo scope; không được biến review tài liệu thành tuyên bố conformity/certification.
