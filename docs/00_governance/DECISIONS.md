# Architecture Decision Log

**ID:** ADR-LOG-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-24 (`ADR-053` được cấp ở trạng thái **Proposed** cho worker Simulation PGM-02 cách ly; Owner đã duyệt scope/admin-only mutation, System Architect exact-revision decision còn PENDING; `ADR-054` là số trống kế tiếp. Trước đó: `ADR-052` là ADR Accepted mới nhất. Trước nữa: 2026-08-20 phê duyệt Product Owner/CTO — bốn quyết định phạm vi: hoãn STM32 BSP nhưng gỡ firmware provenance giả, OTA → Rev B, gỡ `expose_bacnet` khỏi Rev A, chốt vòng đời lệnh ghi Modbus RTU; không cấp ADR mới. Trước đó: 2026-08-19 `AUTH-WEBUX-2026-08-19-02` — bốn quyết định người: `T57-3.8` **hoãn sang Rev B**, chủ sở hữu ba task C++, uỷ quyền truy cập board Foxlinx, và **mốc hết hiệu lực của `WAIVED FOR IMPLEMENTATION`**; không cấp ADR mới; trước đó: `ADR-042`…`ADR-049` `Accepted` — chín quyết định theo từng task để mở Wave 3 của Plan 57, ban hành cùng `AUTH-WEBUX-2026-08-19-01`; trước đó: `ADR-034`…`ADR-039` `Accepted` — sáu câu hỏi chặn còn lại của Plan 57 §12: annunciation, chủ sở hữu ngữ nghĩa mô phỏng cảnh báo, kho chỉ số ISA-18.2, chính sách mật khẩu, chủ sở hữu "hiệu lực thực tế" của lịch, và **an toàn quét bus Modbus**; `ADR-033`/`ADR-032` `Accepted` — cách ly route và điều hướng web 4 nhóm.)

Log này hợp nhất các ADR rời. ID trùng cũ đã được chuẩn hóa; **bản 2026-08-19 sửa lại lần chuẩn hoá
2026-07-22**: EasySet parity thành **`ADR-040`** (không phải `ADR-013`) và raw SHM thành **`ADR-041`**
(không phải `ADR-014`). Lý do: `ADR-013`/`ADR-014` đã bị chiếm từ 2026-07-02 bởi hai ADR alarm ở
[`docs/02_design/adr/`](../02_design/adr/) và **đang được viện dẫn trong hợp đồng canonical**
`contracts/openapi/openapi.yaml` (7 chỗ), trong khi không dòng mã nào từng dùng `ADR-013`/`ADR-014`
theo nghĩa EasySet/raw SHM. Áp quy tắc "hợp đồng thắng tài liệu".

> **File này là authority cấp phát số ADR, không phải thư mục `docs/adr/`.**
> Một số ADR chỉ tồn tại dưới dạng dòng trong bảng dưới đây hoặc mục nội tuyến
> trong chính file này, **không** có file riêng — hiện là `ADR-024` (Modbus RTU
> Point, chi tiết ở `DDD-SW-MBRTU-POINT-001`), `ADR-025` (process-first +
> bounded modules, mục nội tuyến bên dưới), `ADR-032` (điều hướng web 4 nhóm),
> `ADR-033` (cách ly route khỏi điều hướng) và `ADR-034`…`ADR-039` (sáu quyết
> định Plan 57 §12, mục nội tuyến bên dưới). Vì vậy `ls docs/adr/` **không** cho
> biết số nào còn trống. Trước khi đặt số mới, lấy số lớn nhất trong bảng hoặc
> hồ sơ ADR hiện hành rồi cộng một. Số cao nhất đã cấp phát: **`ADR-053`**
> (2026-08-24, Proposed); ADR Accepted mới nhất vẫn là `ADR-052`.

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
| ADR-009 | HMI áp dụng phân cấp hiển thị/alarms theo ISA-101 ở mức design guidance, không tuyên bố chứng nhận. **Phần navigation (Decision #2 — 3 nhóm Overview/Settings/Engineering) đã `SUPERSEDED` bởi ADR-032**; phần triết lý màu Level B hybrid và các Decision #1/#3..#7 vẫn còn hiệu lực. | Accepted — navigation superseded by ADR-032 |
| ADR-010 | Kinexus-IOP v2 chạy 921600 baud, poll 2 ms; shared header là contract thực thi. | Accepted |
| ADR-011 | BACnet reliability và raw/engineering metadata phải được bảo toàn xuyên suốt I/O → SHM → protocol/web. | Accepted |
| ADR-012 | AO command ở biên core/iobus dùng đại lượng điện vật lý V hoặc mA; conversion chỉ thực hiện một lần. | Accepted |
| ADR-013 | Alarm config là **thực thể độc lập** (một alarm giám sát nhiều nguồn UI/AO/DO), không phải một dòng khoá cứng vào một point vật lý; công bố BACnet vẫn bị chặn bởi capability của object. Hồ sơ rời: [`docs/02_design/adr/ADR-013-alarm-entity-model.md`](../02_design/adr/ADR-013-alarm-entity-model.md). | Accepted 2026-07-02 — đăng ký bổ sung 2026-08-19 |
| ADR-014 | Vòng đời acknowledge của alarm: ACK ở mức thực thể trừ khi UX về sau yêu cầu ACK theo từng nguồn; trạng thái alarm **không** nằm trong SHM. Hồ sơ rời: [`docs/02_design/adr/ADR-014-alarm-ack-lifecycle.md`](../02_design/adr/ADR-014-alarm-ack-lifecycle.md). | Accepted 2026-07-02 — đăng ký bổ sung 2026-08-19 |
| ADR-015 | HMI 2.4 inch là local status/commissioning/service panel; HMI không là control/alarm authority; action/ACK chỉ complete sau authoritative response và audit. | Amended by ADR-016 |
| ADR-016 | HMI 2.4 inch áp dụng phạm vi **limited operator HMI**: chỉ setpoint, mode, override và release cho point được authority whitelist. Mọi lệnh đi qua local authenticated broker rồi core priority/interlock/safety; mất broker làm HMI read-only. Không đưa full Web HMI, engineering, schedule hoặc alarm configuration lên panel local. | Accepted |
| ADR-017 | Network commissioning dùng strict authority v1 trên SOM: Web/local HMI không sửa trực tiếp Linux network. Ethernet IPv4 + optional DNS đi qua capability-discovered transaction `validate/stage/apply/confirm/rollback`; management hostname chỉ đọc và provision bằng script. Web GET status cho session xác thực, POST mutation Admin-only; local HMI đặt flow trong surface Service nhưng mutation chỉ role Admin. Đổi IP không dừng local control; BACnet/IP hot-rebind. | Accepted |
| ADR-018 | SQLite block historian: backend-owned per-point database logging policy, hot/archive tiers, bounded migration/recovery and unified Trends authority. | Accepted |
| ADR-019 | Independent global point tag/name namespaces, static references and generation-aware rename/delete behavior. | Accepted |
| ADR-021 | **RBAC 3 vai trò (`viewer`/`operator`/`admin`) thuộc baseline Rev A.0**, không còn hoãn sang Rev B. Backend đã hiện thực đủ ba vai trò với `auth.Require(...)` trên từng endpoint và API quản trị tài khoản kèm guard last-admin; frontend nối nốt phần còn thiếu ở plan 45. Ma trận route↔quyền tối thiểu của Web suy TRỰC TIẾP từ bảng route backend (`apps/web-ui/src/features/auth/roles.ts`), frontend không được nới lỏng hơn server. Vẫn thuộc Rev B: nhóm quyền tuỳ biến, phân quyền theo từng point, SSO/AD, lịch sử phiên đăng nhập. | Accepted 2026-08-01 |
| ADR-022 | CI/CD tự động build và deploy xuống board qua self-hosted runner (trước đây trên Orange Pi 5B, board này đã ngưng sử dụng từ 2026-08-05, chuyển runner sang Foxlinx hoặc CI host); auto-deploy khi merge `main` có điều kiện board là lab/dev; atomic swap + health check + tự rollback; `mkddc-netcfg` không được restart mù khi còn giao dịch dở. | Proposed — WP2 xong, WP1/3/4/5/6 còn mở (Orange Pi 5B deprecated) |
| ADR-020 | Rev A dùng Program Runtime do Mekong sở hữu, phạm vi ngôn ngữ ST + FBD; LD/SFC và claim certified/compliant ngoài scope. Component graph 28-node là As-Built legacy, không gọi là FBD. Việc CTO từng mở ST host component chỉ cho phép thu evidence phát triển, không phải bằng chứng runtime production hoặc claim Programming implemented. Phạm vi Point/cycle và workflow tài liệu được ADR-023 sửa đổi/làm rõ. | Accepted — supersedes ADR-004; amended by ADR-023 |
| ADR-023 | **Khóa Product Spec Programming DDC-24 Rev A:** chỉ Local Physical I/O, Virtual Point, Modbus RTU Point, ST, FBD và cycle time 1 s/5 s/30 s. Modbus TCP Point, BACnet/IP Point, LD, SFC, motion, safety PLC và online change ngoài scope Programming. Product Spec quy định sản phẩm phải làm gì; Requirement quy định nghĩa vụ từng layer; Programming Design chưa thực hiện; As-Built chỉ được kết luận từ source/evidence. Không dùng ST host unit test làm bằng chứng runtime production và không claim Programming đã implement. Các vấn đề chưa quyết định đi vào `PROGRAMMING_OPEN_DECISIONS.md`. | Accepted 2026-08-03 |
| ADR-024 | **Thiết kế Modbus RTU Point trước Programming:** mô hình Bus → Device → Point; stable Point ID; typed value/timestamp/quality; atomic config apply có iobus ACK; reliable write result/readback và không blind replay. Chi tiết tại `DDD-SW-MBRTU-POINT-001`. **Sửa đổi theo phê duyệt PM/CTO 2026-08-04/05:** Rev A dùng **01 bus RS485 vật lý** (giữ `bus_id` mở rộng); capacity Point nâng **64 → ≥256**; giữ 3 role `viewer/operator/admin`; retry là thử lại giao dịch thật (0–5); `mkddc-core` sở hữu Point Table; `mkddc-iobus` sở hữu Modbus Master; atomic config với revision, checksum, LKG fallback. | **Accepted 2026-08-05** — Phê duyệt chính thức theo Tờ trình `DDC24-MBRTU-REQ-APPROVE-2026-08-05` |
| ADR-025 | **Repository áp dụng process-first + bounded modules:** source production thuộc `apps/{core,iobus,netcfg,hmi,web-api,web-ui}`, firmware thuộc `firmware/stm32`, contract canonical thuộc `contracts`, deployment/build helper thuộc `platform`; topology runtime, binary, service unit, API, ABI và config semantics giữ nguyên. | Accepted 2026-08-03 — owner yêu cầu bắt đầu triển khai Plan 46 |
| ADR-026 | **Profile runtime Programming Rev A `revA-1t-1-5-30` và một validator duy nhất:** `maxTasks=1`, chu kỳ `1000/5000/30000 ms`; profile nhúng trong artifact và kiểm lại ở loader (`IR-E-013`), không chỉ ở compiler. `kMaxTasks=8` và dải `50..60000 ms` trong source giữ vai trò trần chống input đối kháng, profile siết xuống chứ không nới lên. Đóng `ARCH-CONF-PROG-001`. | **Accepted 2026-08-11** — `AUTH-PROG-2026-08-11-03`; evidence theo implementation |
| ADR-027 | **Base step thuộc nền tảng, `graph.json` mất quyền ghi đè chu kỳ vòng scan:** `ScanLoop` nhận `base_step_ns` từ cấu hình nền tảng (Rev A `1 s`, dải `500..2000 ms`); `scan_ms` của graph chỉ còn là cadence dispatch của GraphRuntime. Bootstrap luôn khởi tạo đúng một chủ sở hữu Local logic; `nullptr` nghĩa là “không sở hữu”, không phải “chưa cấu hình”. Không thêm tiến trình. Đóng `ARCH-CONF-PROG-002`. | **Accepted 2026-08-11** — `AUTH-PROG-2026-08-11-03`; evidence theo implementation |
| ADR-028 | **Công thức watchdog bám base step, không bám chu kỳ Task:** `WatchdogSec ≥ 2 × base_step_max + WCET_base_step(p99.9, target, SCHED_FIFO) + 1 s`. Chu kỳ Task `30 s` bị loại tường minh khỏi công thức; watchdog kick sau khi base step hoàn tất. `WatchdogSec=6` giữ giá trị nhưng đổi căn cứ; số đo `SCHED_FIFO` là evidence implementation. Đóng `ARCH-CONF-PROG-003`. | **Accepted 2026-08-11** — `AUTH-PROG-2026-08-11-03`; target evidence theo implementation |
| ADR-029 | **Overrun/lỗi runtime của Program là fault của Task, không phải safe-state toàn trạm:** Task lỗi chuyển `FAULT` và hủy staging của chính chu kỳ đó; đầu ra mức 5 giữ `hold-last`, không về `0`. Cờ `any_force_safe` bị gỡ khỏi hợp đồng scheduler, thay bằng `taskFault{...}`; `anyForcingSafeState` deprecated một release rồi xóa. Chỉ SafetyManager quyết định safe-state toàn trạm. Đóng `ARCH-CONF-PROG-004`. | **Accepted 2026-08-11** — `AUTH-PROG-2026-08-11-03` |
| ADR-030 | **Hai lớp mã lỗi:** `PRG-ERR-*` là mã công khai duy nhất client được rẽ nhánh theo; `IR-E-*`, `ST-*`, `API-E-*`, `RT-RETAIN-*` là `detailCode` giữ nguyên tên và nghĩa. Ánh xạ phải toàn phần và kiểm được bằng test; thiếu ánh xạ là lỗi build. `API-E-*` không deprecate trong Rev A. Đóng `ARCH-CONF-PROG-005`. | **Accepted 2026-08-11** — `AUTH-PROG-2026-08-11-03`; mapping evidence theo implementation |
| ADR-032 | **Điều hướng web Rev A dùng 4 nhóm `Tổng quan / Vận hành / Kỹ thuật / Hệ thống`**, thay cho 3 nhóm `Overview/Settings/Engineering` của ADR-009 Decision #2. Nhóm `Settings` cũ trộn tác vụ vận hành hằng ngày với quản trị nền tảng nên bị tách; `Chẩn đoán` trở thành mục điều hướng thật. Chỉ đổi cách gom mục — **không** thêm/bớt route, không đổi `ROUTE_MIN_ROLE`, không đổi REST/WebSocket contract. Mục nội tuyến bên dưới. | **Accepted 2026-08-18** — `AUTH-WEBUX-2026-08-18-01`; supersedes phần navigation của ADR-009 |
| ADR-033 | **Hai route `/eng/user-parameters` và `/eng/aux` bị cách ly khỏi điều hướng Rev A**, không phải bị bỏ quên: `UserParametersPage` đọc/ghi qua mock demo trong `apiClient` và **không có endpoint backend**, nên trên board nó hiện tham số bịa và báo lưu thành công cho lệnh không tới thiết bị; `AuxFunctionsPage` sinh cụm component graph 28-node — runtime legacy theo ADR-020/ADR-023 — và không có đường nạp xuống thiết bị. Route giữ nguyên để không phá bookmark và không giẫm lên công việc song song; quyết định được **thi hành bằng test** `route-menu-contract.test.ts`, vốn đối chiếu bảng route với bảng menu theo cả hai chiều. Đóng finding `F-UX-17`. Mục nội tuyến bên dưới. | **Accepted 2026-08-18** — `AUTH-WEBUX-2026-08-18-01`; quyết định do agent thực hiện, **chữ ký người: `WAIVED FOR IMPLEMENTATION`**. Áp `ADR-040` (chỉ field có consumer mới được công bố) và giữ đúng ý định demo-local của ADR EasySet parity |
| ADR-031 | **`IntegrityMode = HASH_ONLY` cho Rev A:** loader bắt buộc kiểm SHA-256, không yêu cầu chữ ký; chỉ hợp lệ khi compiler và staging path nằm trong trusted local boundary. Trường chữ ký giữ nguyên trong layout schema 1; `allow_unsigned` thay bằng `integrity_mode` với ba giá trị và **cấm** `SIGNATURE_OPTIONAL`. Đóng `ARCH-CONF-PROG-006`. | **Accepted 2026-08-11** — `AUTH-PROG-2026-08-11-03`; residual evidence theo implementation |
| ADR-034 | **Annunciation cảnh báo hai lớp; lớp nghe được phải tự khai báo trạng thái thật.** Lớp NHÌN (nhấp nháy badge + dải chưa-ack) là bắt buộc và luôn chạy được vì không cần cử chỉ người dùng; lớp NGHE mặc định **TẮT**, chỉ bật bằng một nút "Bật và kiểm tra âm" — chính cú bấm đó là cử chỉ mở khoá `AudioContext`. Giao diện phải hiện đủ ba trạng thái `TẮT` / `ĐANG BẬT` / `BỊ TRÌNH DUYỆT CHẶN`; **cấm** hiển thị "đã bật" khi `AudioContext.state !== 'running'`. Tôn trọng `prefers-reduced-motion` bằng cách đổi sang chỉ báo tĩnh + `aria-live`, không tắt annunciation. Trả lời Plan 57 §12-Q2. Mục nội tuyến bên dưới. | **Accepted 2026-08-18** — `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-035 | **Ngữ nghĩa luật cảnh báo thuộc Core, mô phỏng phải gọi lại chính Core — cấm cài lại ở FE hoặc Go.** Câu hỏi "FE hay BE" có tiền đề sai: Go (`alarmsettingsapi.go`) chỉ *kiểm hợp lệ*, còn ngữ nghĩa nằm ở `apps/core/domain/alarm/alarm_primitives.hpp` + `alarm_runtime.cpp`. Áp đúng nguyên tắc PM/CTO đã ràng buộc ở Plan 50/`ADR-023` ("simulation dùng chung evaluation engine với controller"), đã hiện thực bằng `mkddc-schedule-sim`. Mô phỏng luật cảnh báo đi qua một binary `mkddc-alarm-sim` tương tự; thiếu binary ⇒ `503` kèm giải thích, **không** rơi về bản tính trong Go. Hệ quả: `T57-2.13` chuyển **Wave 2 → Wave 3**. Trả lời Plan 57 §12-Q4. Mục nội tuyến bên dưới. | **Accepted 2026-08-18** — `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-036 | **Chỉ số hệ alarm ISA-18.2 §16 được DẪN XUẤT từ `alarm_history.jsonl`, không lập kho thứ hai** — historian là chuỗi thời gian theo point (sai hình dạng dữ liệu), Activity là vòng nhớ 2000 sự kiện (alarm flood tự xoá bằng chứng của chính nó). Điều kiện tiên quyết bắt buộc: `alarm_history.jsonl` hiện **không có xoay vòng, không có retention** và bị đọc bằng quét toàn tệp — phải thêm xoay vòng theo ngày + retention **90 ngày** trước khi mở màn hình KPI. Trả lời Plan 57 §12-Q5. Mục nội tuyến bên dưới. | **Accepted 2026-08-18** — `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-037 | **Chính sách mật khẩu Rev A: giao diện công bố ĐÚNG luật thiết bị đang cưỡng chế (`≥ 6` byte), chỉ báo độ mạnh là KHUYẾN NGHỊ chứ không phải cổng chặn.** Luật thật hôm nay là `validNewPassword` = `len(password) >= 6` byte, không có lớp ký tự, **không có khoá tài khoản sau N lần sai**. Siết FE lên 8 mà để backend ở 6 sẽ làm giao diện mô tả sai thiết bị. Chính sách ĐÍCH (min 8, chặn trùng username và danh sách tầm thường, khoá 5 lần sai/15 phút có audit) là thay đổi Go + hợp đồng, giao cho `T57-3.21` mới. Hệ quả trực tiếp cho `T57-1.10`: **cấm** hiện thông điệp "tài khoản bị khoá" vì trạng thái đó không tồn tại. Trả lời Plan 57 §12-Q6. Mục nội tuyến bên dưới. | **Accepted 2026-08-18** — `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-038 | **"Hiệu lực thực tế" của lịch tính ở Core, mở rộng `mkddc-schedule-sim`, không cài lại trong Go.** `schedule_runtime.hpp` đã ghi rõ `evaluate_schedule` là hàm mà "backend gọi CHÍNH hàm này qua vỏ C; cấm cài lại thuật toán ở nơi khác", và `handleSimulateSchedule` đã thi hành đúng như vậy kèm `503` khi thiếu binary. Bản hợp nhất nhiều lịch trên một point thêm chế độ `--point` cho cùng binary, dùng lại phân xử `priority_for_writing` 1..16 của `ScheduleRuntime`. Trả lời Plan 57 §12-Q7. Mục nội tuyến bên dưới. | **Accepted 2026-08-18** — `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-039 | **AN TOÀN — Quét bus Modbus: chỉ mã hàm ĐỌC, dải tối đa 32 địa chỉ/lượt, vai trò `admin`, xem trước khô bắt buộc, và CẤM dò baud/parity khi bus còn slave đang bật.** Rev A chỉ có **một** cổng RS-485 nên mọi slave dùng chung dây; quét phải xếp hàng trên chính `BusWorker` qua nguyên thuỷ `probe_read` (MBR-B108) chứ không mở cổng thứ hai và không dừng poll. Địa chỉ không trả lời phải báo là **"không trả lời"**, không được báo là "không có thiết bị". `T57-3.8` vẫn `IMPLEMENT_READY BLOCKED`: ADR này là **đặc tả**, và trong phiên 2026-08-18 **không dòng code ghi ra bus nào được viết**. Trả lời Plan 57 §12-Q8. Mục nội tuyến bên dưới. | **Accepted 2026-08-18** (đặc tả) — `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION`. **Thi hành hoãn sang Rev B** theo `AUTH-WEBUX-2026-08-19-02` quyết định 1; mở lại khi PM chỉ định Fieldbus Lead + QA/HIL Lead |
| ADR-040 | EasySet config phải round-trip nhất quán giữa UI, backend và iobus; chỉ field có consumer mới được công bố. Các màn config kiểu EasySet là lớp form phủ lên graph/io_map, không thay bằng mô hình parameter-based. **Phát hành lần đầu nhầm số `ADR-010`; bản chuẩn hoá 2026-07-22 gán nhầm `ADR-013`.** Hồ sơ rời: [`ADR-040`](../adr/ADR-040-easyset-parity-config-surfaces.md). | Accepted 2026-06-22 — cấp số lại 2026-08-19 |
| ADR-041 | `kx_io_shm_t` mang thêm `ui_raw[]` và `ui_raw_unit[][]` để web hiện giá trị điện thô mà không phải dựng lại sau scaling; đổi layout thì phải bump `KX_SHM_MAGIC`. **Phát hành lần đầu nhầm số `ADR-011`; bản chuẩn hoá 2026-07-22 gán nhầm `ADR-014`.** Hồ sơ rời: [`ADR-041`](../adr/ADR-041-ui-raw-live-data-shm.md). | Accepted 2026-06-30 — cấp số lại 2026-08-19 |
| ADR-042 | **Thẻ thiết bị công nghệ (`equipment`) là TRƯỜNG TRÌNH BÀY trên cấu hình điểm, không phải một thực thể mới.** Một chuỗi tự do đã chuẩn hoá (`trim`, ≤ 48 byte) gắn vào điểm; **không** tạo bảng thiết bị, không khoá ngoại, không ràng buộc Core. Lý do: đường đi tối thiểu tới ISA-101 Level 2 (§4.1 review) cần *nhóm điểm theo thiết bị*, còn mô hình thiết bị đầy đủ là quyết định Rev B. Điểm không có thẻ hiện nhóm "Chưa gán", **không** đoán từ tên. Phục vụ `T57-3.1`, và là đường tối thiểu đã chốt cho `T57-4.1`. Mục nội tuyến bên dưới. | **Accepted 2026-08-19** — `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-043 | **Tuỳ chọn người dùng lưu trên thiết bị theo tài khoản, dạng túi khoá-giá trị có hạn mức, KHÔNG phải schema có kiểu.** `GET/PUT /api/v1/me/preferences` trả một object JSON ≤ 16 KB do FE tự định hình (ghim, khung nhìn, âm thanh alarm). Backend **không** hiểu nội dung, chỉ cưỡng chế hạn mức và quyền sở hữu — mỗi tuỳ chọn UI mới mà phải đổi hợp đồng backend là một vòng lặp không đáng có. Đọc/ghi chỉ tuỳ chọn của **chính mình**; `admin` cũng không đọc được của người khác qua endpoint này. Phục vụ `T57-3.2`, gỡ giới hạn "chỉ trên trình duyệt này" của `T57-2.3`. Mục nội tuyến bên dưới. | **Accepted 2026-08-19** — `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-044 | **Chỉ số hệ alarm ISA-18.2 tính TẠI THỜI ĐIỂM HỎI từ nhật ký, không có tiến trình tổng hợp nền.** Thi hành `ADR-036` ở tầng Go: `GET /api/v1/alarms/metrics?window=` đọc `alarm_history.jsonl` đã xoay vòng và trả `rate10m`/`ratePerHour`/`topRepeating`/`shelvedExpiring`. Cửa sổ tối đa **7 ngày** để một lần hỏi không quét cả kho 90 ngày. Thiếu nhật ký ⇒ `503` nói rõ, **cấm** trả 0 (0 và "không đọc được" là hai tình trạng khác nhau trên màn hình an toàn). Phục vụ `T57-3.3`. Mục nội tuyến bên dưới. | **Accepted 2026-08-19** — `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-045 | **"Hiệu lực thực tế" và cảnh báo xung đột lịch dùng chung một endpoint, và endpoint đó chỉ là VỎ gọi Core.** Thi hành `ADR-038`: `GET /api/v1/schedules/effective?pointId=&from=&to=` gọi `mkddc-schedule-sim --point`; thiếu binary ⇒ `503` kèm giải thích, **cấm** rơi về bản tính trong Go. Cảnh báo xung đột khi soạn là **cùng dữ liệu, khác cách trình bày** — không mở endpoint thứ hai để hai đường không trôi khỏi nhau. Phục vụ `T57-3.5`, `T57-3.6`. Mục nội tuyến bên dưới. | **Accepted 2026-08-19** — `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-046 | **Xem thô khung truyền Modbus là VÒNG NHỚ CHỈ-ĐỌC trong iobus, lấy theo yêu cầu; không mở luồng đẩy và không ghi ra bus.** `GET /api/v1/modbus/frames?bus=&limit=` trả tối đa 200 khung gần nhất (mốc thời gian, bus, slave, mã hàm, địa chỉ, số thanh ghi, kết quả, phân loại `timeout`/`crc`, thời lượng, số lần phát). **Sửa 2026-08-19:** điều "byte thô dạng hex" `SUPERSEDED` — libmodbus không lộ bộ đệm wire, nên Rev A ghi **bản ghi giao dịch**; xem mục nội tuyến. Vòng nhớ nằm trong tiến trình iobus, mất khi restart — đây là công cụ chẩn đoán tại chỗ, **không** phải nhật ký lưu trữ. Chỉ chụp lại khung mà chu kỳ poll BÌNH THƯỜNG đã phát; **không một byte nào được phát thêm vì mục đích quan sát**. Phục vụ `T57-3.9`. Mục nội tuyến bên dưới. | **Accepted 2026-08-19** — `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-047 | **Buộc đổi mật khẩu mặc định: cờ `mustChangePassword` trên tài khoản, cưỡng chế ở BACKEND chứ không ở giao diện.** Phiên có cờ này chỉ gọi được `GET /api/v1/me` và `POST /api/v1/me/change-password`; mọi endpoint khác trả `403` với `reasonCode: password_change_required`. Cưỡng chế bằng cách ẩn màn hình ở FE là không cưỡng chế gì cả — `curl` vẫn đi thẳng. Cờ bật khi `admin` đặt lại mật khẩu và cho tài khoản khởi tạo lần đầu; tự tắt sau lần đổi thành công. Phục vụ `T57-3.17`; **không** đụng tới độ dài mật khẩu đã chốt ở `ADR-037`. Mục nội tuyến bên dưới. | **Accepted 2026-08-19** — `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-048 | **Mô phỏng luật cảnh báo đi qua `POST /api/v1/alarm-settings/simulate`, là VỎ gọi `mkddc-alarm-sim`.** Thi hành `ADR-035`: nhận một `AlarmSetting` bản nháp + chuỗi mẫu `(t, value)`, trả các lần bật/tắt kèm mốc thời gian và mức nghiêm trọng. Thiếu binary ⇒ `503` nói rõ thiếu gì; **cấm** bản tính xấp xỉ ở Go hay FE, kể cả "gần đúng". Mô phỏng **không** chạm cấu hình đang lưu và không ghi audit thay đổi. Phục vụ `T57-2.13`. Mục nội tuyến bên dưới. | **Accepted 2026-08-19** — `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-049 | **Code-splitting theo route dùng `React.lazy` cho các nhánh NẶNG và HIẾM, không chia nhỏ toàn bộ.** Chia theo lô nghiệp vụ: Programming, Xu hướng/biểu đồ, Lịch vận hành, Modbus RTU. Bốn màn hình mở đầu ca trực (Landing, Giám sát, Cảnh báo, Chẩn đoán) **ở lại chunk chính** — chia chúng ra chỉ đổi một lần tải thành hai lần chờ. Mỗi ranh giới `lazy` phải có `Suspense` với khối trạng thái thật, không màn hình trắng. Số đo bắt buộc là **thời gian mở trang đầu trên board thật**, không phải kích thước tệp. Phục vụ `T57-4.2`. Mục nội tuyến bên dưới. | **Accepted 2026-08-19** — `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` |
| ADR-053 | **PGM-02 Simulation dùng `mkddc-programming-sim-worker` ephemeral theo session, tách production Core/SHM/device/iobus/output/RETAIN; Web chỉ supervisor/RBAC/audit/quota, mutation admin-only.** [Hồ sơ](../adr/ADR-053-programming-simulation-worker-cach-ly.md). | **Proposed 2026-08-24** — Owner duyệt scope R3/admin-only; System Architect exact pin PENDING; code R3 NO-GO |

> [!IMPORTANT]
> **Mọi dòng ghi `chữ ký người: WAIVED FOR IMPLEMENTATION` trong bảng trên đều có
> mốc hết hiệu lực.** Theo `AUTH-WEBUX-2026-08-19-02` quyết định 4, waive cho
> `ADR-033`…`ADR-049` chỉ hợp lệ **tới cổng `RELEASE_READY` Rev A**. Trong thời
> hạn đó chúng đủ tư cách làm **đầu vào implementation**, và **không** đủ tư cách
> baseline `M5 — APPROVED` (`DOC_GOVERNANCE` §6 quy tắc 4). Tới mốc mà chưa có
> chữ ký người thật thì **cổng `RELEASE_READY` không được mở** — không có đường
> waive lần hai.

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
  [`PLAN-ARCH-RESTRUCT-002`](../03_implementation/archive/46_REPOSITORY_ARCHITECTURE_RESTRUCTURE_PLAN.md);
  chỉ move source sau baseline và build indirection; chỉ xóa shim khi inventory
  xác nhận không còn consumer.
- **Rollback:** revert theo task/nhóm path gần nhất; không đổi dữ liệu runtime,
  schema hoặc package installed. Nếu path move buộc đổi public semantics hoặc
  failure boundary, dừng migration và mở decision riêng.

## ADR-032 — Điều hướng web Rev A dùng 4 nhóm

- **Trạng thái:** Accepted 2026-08-18. **Supersedes** [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md)
  **Decision #2** (và phần "three-group page tree" trong mục Consequences của ADR đó).
  Mọi phần khác của ADR-009 — đặc biệt là triết lý màu Level B hybrid — **không**
  bị đụng tới.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-18-01` (mục bên dưới), Plan 57 Wave 0 Track D,
  task `T57-0.13`. Đóng finding `F-DOC-04` của
  [`REV-FE-UIUX-UC-2026-08-18`](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md).
- **Bối cảnh.** ADR-009 (2026-06-16) chốt 3 nhóm `Overview / Settings /
  Engineering` khi web Rev A còn khoảng 12 trang. Từ đó sản phẩm mọc thêm
  Activity, Diagnostics, Outputs, Virtual Points, Modbus RTU và bốn workspace
  Programming. Mã hiện hành (`apps/web-ui/src/shared/components/NavRail.tsx`)
  dựng **4 nhóm** và đã chạy như vậy từ lâu, nhưng **không có ADR nào ghi việc
  rời khỏi quyết định của ADR-009** — nên tài liệu canonical đang sai so với sản
  phẩm, đúng loại lệch nguy hiểm vì tài liệu là thứ người mới đọc. Bản thân mã
  dẫn nguồn "UX-DES §3", tức
  [`UX_DESIGN_MK-DDC-24_PA3.md`](../CHUONG_YEU_CAU/UX_DESIGN_MK-DDC-24_PA3.md)
  §3 (`UX-DES-MKDDC24-PA3-001`), nơi khách hàng mô tả đúng bốn nhóm
  `OVERVIEW / OPERATION / ENGINEERING / SYSTEM`. Một tài liệu yêu cầu **không**
  tự nó thay thế được một ADR đã Accepted; đó là khoảng hở mà ADR này lấp.
- **Quyết định.** Điều hướng web Rev A gồm **bốn** nhóm:

  | Nhóm | Khoá i18n | Nội dung |
  |---|---|---|
  | Tổng quan | `overview` | `/` · `/monitor` · `/alarms` · `/trends` · `/activity` |
  | Vận hành | `operation` | `/eng/scheduler` · `/eng/commissioning` |
  | Kỹ thuật | `engineering` | `/eng/inputs` · `/eng/outputs` · `/eng/virtual-points` · `/eng/modbus-rtu` · `/eng/alarm-settings` · `/diagnostics` · `/eng/programming` |
  | Hệ thống | `system` | `/settings/network` · `/settings/device` · `/settings/time` · `/settings/users` · `/settings/display` |

  Hai thay đổi thực chất so với ADR-009:

  1. **Tách `Settings` cũ làm hai.** Nhóm đó trộn hai loại việc có nhịp và có
     người dùng khác hẳn nhau: lịch vận hành/chạy thử là việc **hằng ngày của
     người vận hành**, còn mạng/thiết bị/thời gian/người dùng là **quản trị nền
     tảng**, chạm tới thì phải cẩn thận. Gom chung khiến người vận hành phải đi
     qua nhóm chứa nút đổi IP để tới lịch chạy máy.
  2. **`Chẩn đoán` thành một mục thật.** Trước đây không mục nào dẫn tới trang
     chẩn đoán vì trang đó không tồn tại — nội dung chẩn đoán nằm trong Dashboard
     (PA3-F13). Nay `/diagnostics` là trang riêng nên phải có lối vào riêng.
- **Phạm vi — cố ý hẹp.** ADR này **chỉ** đổi cách gom mục điều hướng. Nó
  **không** thêm/bớt/đổi tên route, **không** đổi `ROUTE_MIN_ROLE` hay bất kỳ
  ranh giới quyền nào, **không** đổi REST/WebSocket contract, và **không** đụng
  tới điều hướng HMI local (ADR-016 giữ nguyên năm surface
  `Home/Points/Control/Alarms/Service`).
- **Hệ quả.**
  - [`KX-DDC24-UX-SYSTEM-001`](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) §6 là hồ
    sơ chủ quản của bảng nhóm; nó đã được đồng bộ ở v1.8.
  - Thêm một route mới ⇒ phải xếp nó vào đúng một trong bốn nhóm **và** cập nhật
    §6 của hồ sơ trên trong cùng phiên. Một route không thuộc nhóm nào là mã
    người dùng không tới được bằng điều hướng.
  - Lọc mục theo vai trò tiếp tục dùng **chung** `ROUTE_MIN_ROLE` với gate route;
    không được dựng bảng thứ hai.
  - `ADR-009` giữ nguyên hiệu lực ở mọi phần còn lại. Khi đọc ADR-009 Decision #2,
    đọc kèm mục này.
- **Phương án bị loại.**
  1. *Sửa mã về 3 nhóm cho khớp ADR-009.* Loại: đó là quay lui một cải thiện có
     lý do vận hành rõ, chỉ để tài liệu khỏi phải sửa.
  2. *Coi `UX-DES §3` là authority, không viết ADR.* Loại: một tài liệu yêu cầu
     không thay thế được ADR đã Accepted, và làm vậy để lại đúng khoảng hở mà
     `F-DOC-04` chỉ ra.
- **Rollback.** Gom `operation` trở lại `system` và bỏ mục `/diagnostics` khỏi
  `engineering`; không có dữ liệu, contract hay quyền nào phải hoàn tác.

## ADR-033 — Hai route bị cách ly khỏi điều hướng Rev A, và test giữ hợp đồng route ↔ menu

- **Trạng thái:** Accepted 2026-08-18. Đóng finding `F-UX-17` của
  [`REV-FE-UIUX-UC-2026-08-18`](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md) §7.2b.
  Không supersede ADR nào; nó **thi hành** hệ quả đã ghi trong `ADR-032` và áp
  `ADR-040` vào đúng hai màn hình.
- **Phê duyệt:** `WAIVED FOR IMPLEMENTATION` (agent đóng vai trò quyết định, chưa có chữ ký người), trong phạm vi `AUTH-WEBUX-2026-08-18-01` (Plan 57 Wave 0) — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).

### Bối cảnh

`/eng/aux` (`AuxFunctionsPage`) và `/eng/user-parameters` (`UserParametersPage`)
tồn tại thật, có trong `ROUTE_MIN_ROLE`, có nhãn i18n — nhưng **không mục nào
trong `NavRail` dẫn tới**. Chỉ tới được bằng cách gõ tay URL. Hai trang này được
thêm vào nhóm Engineering của bản 3 nhóm theo ADR EasySet parity
([`ADR-040-easyset-parity-config-surfaces.md`](../adr/ADR-040-easyset-parity-config-surfaces.md),
ID canonical là `ADR-040`); khi tái cấu trúc sang 4 nhóm chúng rơi ra ngoài mà
không ai phát hiện, vì **không có test nào đối chiếu bảng route với bảng menu**.

Câu hỏi hiển nhiên là "thêm chúng vào menu cho xong". Đọc mã trước khi trả lời:

| Route | Hiện trạng đo được 2026-08-18 |
|---|---|
| `/eng/user-parameters` | `apiClient.getUserParams()` trả thẳng `getDemoUserParams()` **không phụ thuộc `IS_DEMO`**; `putUserParams()` ghi vào một biến trong module. Grep `apps/web-api` cho `user-param` ra **0** kết quả — không có endpoint backend nào |
| `/eng/aux` | Sinh cụm node của **component graph 28-node**; ở chế độ live chính mã tự nói "chỉ trả bản xem trước JSON để kỹ sư tự nạp". Không có đường nạp xuống thiết bị |

### Quyết định

**Hai route này KHÔNG được đưa vào điều hướng Rev A.** Chúng ở trạng thái *cách
ly*: route giữ nguyên, không có mục menu, và tình trạng đó được một test khoá
lại chứ không nằm trong trí nhớ ai.

Ba lý do, theo thứ tự sức nặng:

1. **Đưa vào menu là bịa dữ liệu ở quy mô lớn hơn.** `UserParametersPage` chỉnh
   38 tham số vận hành của MCU (UP00…LOCK3: hành vi khi mất điện, khoá, setpoint).
   Trên board nó hiển thị **giá trị bịa** và trả về một toast "đã lưu" cho lệnh
   lưu **không bao giờ tới thiết bị**. Hiện chỉ người gõ URL gặp; đưa vào menu là
   biến nó thành thứ mọi admin nhìn thấy và tin. Đây đúng lớp lỗi mà chính sản
   phẩm này cấm ở mọi chỗ khác (`DashboardPage` `lastDataAt=null` ⇒ `—`,
   `DiagnosticsPage` bỏ `?? 23` cho CPU, `AuxFunctionsPage` đã tự gỡ dấu PASS ở
   live theo `SRC-F-03`).
2. **`ADR-040` cấm đúng việc này:** "chỉ field có consumer mới được công bố".
   38 field không có consumer.
3. **Đó chưa bao giờ là ý định thiết kế.** ADR EasySet parity Decision #2 ghi rõ
   các màn này là **"pattern demo-local Rev A … nút *Lưu* toast demo. KHÔNG đổi
   REST/WS contract"**. Chúng được thiết kế làm surface demo. Cách ly không lấy
   đi chức năng nào; nó chỉ ngăn một surface demo tự nhận là chức năng thiết bị.

Với `/eng/aux` còn một lý do riêng: nó sinh cụm cho **component graph 28-node**,
mà `ADR-020`/`ADR-023` đã xếp là As-Built legacy và khoá phạm vi Programming Rev A
vào ST + FBD. Đặt nó cạnh `/eng/programming` trong cùng nhóm Kỹ thuật là bày ra
hai lối vào lập trình, một lối trỏ tới runtime đã bị thay thế.

### Phương án bị loại

1. **Thêm cả hai vào nhóm Kỹ thuật.** Loại: nhân rộng đúng hai vấn đề trên. "Có
   lối vào" không phải là giá trị tự thân khi thứ ở cuối lối vào nói dối.
2. **Xoá hẳn route + trang + khoá i18n ngay phiên này.** Loại vì hai lý do độc
   lập: (a) xoá `/eng/user-parameters` sẽ **huỷ công việc đang chạy song song** —
   `UserParametersPage` vừa được gắn `useDirtyGuard` cho `F-UX-12`; (b) xoá một
   trang là quyết định phạm vi sản phẩm Rev A, và nó **không thể hoàn tác trong
   một lệnh** như việc cách ly. Đánh đổi được chấp nhận có ý thức: cách ly để lại
   một route mà người gõ URL vẫn tới được — rủi ro còn lại, ghi ở phần dưới —
   nhưng đổi lấy khả năng quay lui bằng một dòng và không phá việc người khác.
3. **Chỉ ghi vào tài liệu, không viết test.** Loại: đó chính là cách `F-UX-17`
   ra đời. `ADR-032` đã viết "một route không thuộc nhóm nào là mã người dùng
   không tới được bằng điều hướng" — câu đó tồn tại sẵn và vẫn không ngăn được gì,
   vì không có gì thi hành nó.

### Thi hành — bắt buộc, không phải khuyến nghị

`apps/web-ui/src/app/route-menu-contract.test.ts` đối chiếu **hai chiều**:

| Kiểm | Bắt lỗi gì |
|---|---|
| Chụp nguyên văn mọi `path="…"` của `App.tsx` | Thêm/xoá/đổi tên route mà không phân loại lại ⇒ đỏ |
| Mọi mục menu trỏ tới một route có thật | Menu trỏ vào đường chết |
| Tập route loại `nav` ≡ tập mục menu | Route mới không có lối vào — đúng `F-UX-17` |
| Hai route cách ly vẫn nằm ngoài menu | Đảo ngược ADR này bằng mã mà không sửa ADR |
| Mọi khoá `ROUTE_MIN_ROLE` là route có thật | Bảng quyền gác một route đã bị xoá |
| Bốn nhóm `NavRail` ≡ bảng của `ADR-032` | Tài liệu và mã trôi khỏi nhau |

Mỗi route phải khai báo mình thuộc loại nào và **người dùng tới bằng cách nào**;
không có loại "chưa xếp". Đó là chỗ cơ chế sinh lỗi số 1 ở §7.3 của biên bản
review bị đóng lại ở mức quy trình, không chỉ ở mức một finding.

### Hệ quả

- Thêm route mới ⇒ test đỏ cho tới khi route đó được xếp nhóm hoặc được khai báo
  lối vào. Đây là hành vi mong muốn.
- [`UX-SYSTEM-001` §6](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) vẫn là hồ sơ chủ
  quản của bảng nhóm; cần bổ sung một đoạn ghi hai route cách ly để người đọc tài
  liệu thấy đúng thứ mà test đang giữ.
- [`09_MKDDC_WEB_IMPLEMENTATION_GUIDE`](../03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md)
  §1 đã có mục “CÁCH LY” tương ứng (Rev 1.37).

### Rủi ro còn lại

Cách ly **không** bịt được đường gõ tay URL: một admin biết đường vẫn mở được
`/eng/user-parameters` và vẫn thấy tham số bịa. `ADR-033` chỉ hạ mức phơi nhiễm,
không đóng lỗi gốc. Đóng thật cần **một** trong hai, và cả hai đều ngoài phạm vi
Wave 0:

| Đường đóng | Việc phải làm | Ai mở khoá |
|---|---|---|
| Nối thật | Thêm `GET/PUT /api/v1/system/config/user-params` trong `apps/web-api`, cho `apiClient` gọi REST thay vì mock, và bỏ cách ly | Product quyết định EasySet User Parameters có thuộc Rev A không |
| Gỡ hẳn | Xoá route + trang + khoá i18n + dòng `ROUTE_MIN_ROLE`, cập nhật ADR này | Product xác nhận không thuộc Rev A |

Cho tới lúc đó, **không** được mô tả `/eng/user-parameters` là chức năng đã có
trong bất kỳ hồ sơ, demo hay biên bản nghiệm thu nào.

### Rollback

Xoá tệp test và thêm hai mục vào `NAV_GROUPS`. Không có dữ liệu, contract hay
ranh giới quyền nào phải hoàn tác.

## ADR-034 — Annunciation cảnh báo hai lớp, và luật "khả năng bị nền tảng từ chối phải tự khai báo"

- **Trạng thái:** Accepted 2026-08-18. Trả lời [Plan 57](../03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md) §12-Q2.
  Không supersede ADR nào. Ràng buộc trước một phần phạm vi của `T57-3.2` (lưu tuỳ chọn người dùng trên thiết bị).
- **Phê duyệt:** `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).

### Bối cảnh

ISA-18.2 coi annunciation là chức năng cốt lõi của một hệ alarm, và §5.2 của
[biên bản review](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md) chấm mục
này **Chưa có**: một cảnh báo Critical mới xuất hiện trên màn hình treo tường
hiện không tạo bất kỳ tín hiệu thu hút chú ý nào, badge đếm là dấu hiệu duy nhất.

Câu hỏi Q2 đặt đúng vào chỗ khó: trình duyệt **chặn phát âm thanh khi chưa có
tương tác người dùng**. `AudioContext` sinh ra ở trạng thái `suspended`, và
`HTMLAudioElement.play()` trả về một Promise bị từ chối với `NotAllowedError`.
Đây không phải lỗi cấu hình mà là chính sách nền tảng, không thể vòng qua.

Điều làm nó thành câu hỏi an toàn chứ không phải câu hỏi thẩm mỹ: thiết bị này
chạy trên **màn hình treo tường của phòng trực**, có thể đứng nhiều ngày không ai
chạm vào. Sau một lần mất điện chớp nhoáng hay một lần trình duyệt khởi động
lại, trang tự nạp lại mà **không** có cử chỉ nào — nghĩa là kênh âm thanh chết
im lặng đúng vào lúc không có ai ở đó để phát hiện.

### Quyết định

**1. Tách hai lớp, lớp nhìn là bắt buộc.**

| Lớp | Mặc định | Cần cử chỉ người dùng? | Vai trò |
|---|---|---|---|
| Nhìn — nhấp nháy badge cảnh báo + dải "còn N chưa xác nhận" | **BẬT**, không tắt được | Không | Đường thu hút chú ý *bảo đảm* |
| Nghe — âm báo lặp lại | **TẮT** | Có | Đường thu hút chú ý *tăng cường* |

Lớp nhìn luôn chạy được vì nó không phụ thuộc vào chính sách autoplay. Vì vậy
"không có âm" **không bao giờ** đồng nghĩa với "không có annunciation".

**2. Lớp nghe bật bằng đúng một nút, và nút đó chính là cử chỉ mở khoá.**

Trong `Hiển thị` có một nút **"Bật và kiểm tra âm báo"**. Cú bấm đó vừa lưu tuỳ
chọn, vừa `resume()` `AudioContext`, vừa phát một tông thử ngay trong cùng một
tick — nên người dùng nghe thấy kết quả thật thay vì đọc một lời hứa. Không có
đường nào bật âm mà không phát thử: một tuỳ chọn "đã bật" chưa từng kêu là một
tuỳ chọn không ai biết là hỏng.

**3. Giao diện phải hiện trạng thái THẬT của kênh âm thanh — ba trạng thái, không phải hai.**

| Hiển thị | Điều kiện |
|---|---|
| `TẮT` | Người dùng chưa bật |
| `ĐANG BẬT` | Đã bật **và** `AudioContext.state === 'running'` |
| `BỊ TRÌNH DUYỆT CHẶN` | Đã bật nhưng `AudioContext.state !== 'running'` (thường do tải lại trang) — kèm nút bấm để mở khoá lại |

**Cấm** hiển thị "đã bật" khi ngữ cảnh âm thanh đang `suspended`. Đây là luật
"không bịa dữ liệu" áp cho một **khả năng** thay vì cho một số đo: khẳng định hệ
thống sẽ kêu, trong khi nó không thể kêu, tệ hơn hẳn việc không hứa gì.

**4. Âm được tổng hợp bằng WebAudio, không nhúng tệp audio.**

`OscillatorNode` + `GainNode` là vài dòng và không tốn byte nào của gói. Gói
Foxlinx hiện đã 898,84 kB và bo không có đường ra Internet để tải tài nguyên
ngoài, nên một tệp `.mp3`/`.wav` nhúng là chi phí thật cho không thêm giá trị.

**5. `prefers-reduced-motion` đổi CÁCH annunciation, không tắt annunciation.**

Người khai báo giảm chuyển động vẫn phải biết có cảnh báo chưa xác nhận. Khi cờ
bật: bỏ nhấp nháy, giữ badge tương phản cao + đổi nhãn + một thông báo
`aria-live="assertive"`. Tắt hẳn annunciation cho nhóm người dùng này là biến
một tuỳ chọn tiếp cận thành một sự cố an toàn.

**6. Nơi lưu tuỳ chọn — và vì sao tạm thời là `localStorage`.**

Chưa có endpoint tuỳ chọn người dùng (`T57-3.2`, Wave 3). Tuỳ chọn âm lưu ở
`localStorage` với **khoá theo cặp (thiết bị, tài khoản)**, đúng khuôn
`workspaceKey()` mà `DashboardPage` đã dùng cho ghim (PA3-D04) — một kỹ thuật
viên mở nhiều bo từ cùng một laptop, và một bo có nhiều tài khoản. Khi `T57-3.2`
lên, tuỳ chọn này là một trong các trường chuyển sang backend; ADR này ràng buộc
`T57-3.2` phải nhận nó.

### Phương án bị loại

1. *Chỉ nhấp nháy, bỏ hẳn âm thanh.* Đơn giản và 100 % tin cậy, nhưng bỏ mất
   chức năng mà ISA-18.2 coi là cốt lõi. Màn hình treo tường thường nằm ngoài
   tầm nhìn trực tiếp của người trực đang làm việc khác.
2. *Cứ gọi `play()` mỗi lần có cảnh báo, hỏng thì thôi.* Đây là phương án tệ
   nhất: `NotAllowedError` bị nuốt trong một Promise không ai `catch`, giao diện
   vẫn hiện "âm báo: bật", và hệ alarm **trông như** đang hoạt động. Chính vì
   loại phương án này mà điều 3 tồn tại.
3. *Ép người dùng bấm một hộp thoại "bật âm" ngay khi mở trang.* Chặn đường vào
   màn hình giám sát bằng một hộp thoại là đổi một rủi ro lấy một rủi ro lớn hơn.

### Rủi ro còn lại

Trên một màn hình treo tường tự khởi động sau mất điện, lớp nghe **sẽ** ở trạng
thái `BỊ TRÌNH DUYỆT CHẶN` cho tới khi có người chạm màn hình. ADR này không xoá
được rủi ro đó — chính sách trình duyệt không cho phép — nó chỉ làm rủi ro
**nhìn thấy được** thay vì im lặng. Cách khử thật sự là một chỉ báo vật lý
(còi/đèn) lấy tín hiệu từ một DO, thuộc phạm vi thiết kế trạm chứ không phải
phạm vi Web.

### Rollback

Gỡ nút bật âm và giữ nguyên lớp nhìn. Không có dữ liệu, hợp đồng hay quyền nào
phải hoàn tác.

## ADR-035 — Ngữ nghĩa luật cảnh báo thuộc Core; mô phỏng gọi lại chính Core

- **Trạng thái:** Accepted 2026-08-18. Trả lời [Plan 57](../03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md) §12-Q4.
  Áp lại nguyên tắc đã ràng buộc trong [ADR-023](../adr/ADR-023-scheduler-v3-1-priority-transport-va-pham-vi.md)
  cho một tính năng khác; không supersede ADR nào.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).

### Bối cảnh — câu hỏi có tiền đề sai

Q4 hỏi "mô phỏng luật cảnh báo chạy ở FE (nhanh, nhưng phải chép luật backend)
hay gọi endpoint mô phỏng ở BE?". Đọc mã cho thấy **cả hai vế đều sai**:

| Tầng | Vai trò thật với luật cảnh báo |
|---|---|
| `apps/web-ui` | Chỉ trình bày |
| `apps/web-api` (Go) — `internal/app/alarmsettingsapi.go` | Chỉ **kiểm hợp lệ** (`hysteresis >= 0`, dải ngưỡng…). Không đánh giá luật |
| `apps/core` (C++) — `domain/alarm/alarm_primitives.hpp`, `application/alarm/alarm_runtime.cpp` | **Chủ sở hữu duy nhất** của ngữ nghĩa |

Nói cách khác "gọi endpoint mô phỏng ở BE" nếu hiểu là *viết thuật toán trong
Go* thì chính là điều mà PM/CTO đã cấm khi duyệt Plan 50: *"simulation dùng
**chung** evaluation engine với controller (cấm cài lại thuật toán trong Go)"*.

Dự án đã trả tiền cho bài học này một lần và ghi lại kết quả ngay trong mã —
`schedule_sim_main.cpp` mở đầu bằng: *"cài lại là tự nói dối. Bản Go sẽ đúng cho
tới ngày nó lệch khỏi bản C++, và ngày đó không ai biết — người dùng chỉ thấy
'mô phỏng bảo ON mà thiết bị vẫn tắt'."*

### Vì sao một bản chép ở FE chắc chắn sẽ lệch

Ba chỗ trong ngữ nghĩa hiện hành mà một bản viết lại bằng TypeScript rất khó
trùng, và khi lệch thì lệch **im lặng**:

1. **`float` 32 bit so với `number` 64 bit.** `alarm_high_step` nhận `float`;
   `AlarmRuntime` ép `static_cast<float>` cả `pv` lẫn ngưỡng lẫn hysteresis.
   Một ngưỡng như `28.1` không biểu diễn được chính xác ở cả hai độ rộng, và hai
   độ rộng làm tròn khác nhau ngay tại biên — đúng chỗ quyết định bật/không bật.
2. **Bất đối xứng `>` và `>=`.** `alarm_high_step` dùng `pv > limit`, nhưng
   `high_low_trigger` chọn mức `HH` bằng `value >= params.hh`. Một bản chép rất
   dễ dùng nhất quán một toán tử và sinh ra sai mức ưu tiên đúng tại `pv == hh`.
3. **Hình dạng của `alarm_delay_step`.** Bộ đếm cộng `dt` **trước** khi so
   `acc >= on_delay`, nên cảnh báo bật ở đúng mẫu chạm ngưỡng, không phải mẫu
   kế tiếp; và `acc` bị *đặt lại về 0* khi trạng thái lật, không phải khi đầu
   vào lật. Sai một mẫu ở đây cho ra "trễ 30 s" mô phỏng so với "trễ 31 s" thật.

Không cái nào trong ba cái đó lộ ra khi test; chúng lộ ra khi có sự cố thật.

### Quyết định

1. Xem trước luật cảnh báo chạy bằng **chính nguyên thuỷ của Core**, phơi ra qua
   một binary `mkddc-alarm-sim` mỏng — đúng khuôn `mkddc-schedule-sim`: nhận
   cấu hình + chuỗi giá trị thử + `--step-sec`, trả JSON gồm mốc bật/tắt, mức
   ưu tiên hiệu lực và ngưỡng đã kích hoạt.
2. Go phơi `POST /api/v1/alarm-settings/simulate` và **chỉ làm vận chuyển**.
   Thiếu binary ⇒ `503` kèm câu giải thích, y hệt `handleSimulateSchedule`.
   **Cấm** rơi về một bản tính trong Go.
3. FE chỉ vẽ kết quả. Không có bản mô phỏng dự phòng ở FE, kể cả "gần đúng".
4. **Hệ quả lịch trình:** `T57-2.13` cần một binary mới + một endpoint mới, nên
   nó **chuyển từ Wave 2 sang Wave 3**. Đây là sửa phạm vi cho đúng, không phải
   hoãn: làm nó ở Wave 2 theo cách FE-thuần là xuất xưởng một bản sao thứ hai
   của ngữ nghĩa an toàn.

### Đánh đổi đã chấp nhận

Bản FE-thuần tốn ~2 người-ngày, chạy tức thì, không cần chuỗi công cụ C++. Bản
Core tốn ~4 người-ngày, thêm một binary phải cross-compile và đóng gói cho mỗi
lần cập nhật bo, và mỗi lần xem trước là một lần gọi tiến trình con. Ta trả giá
đó để đổi lấy tính chất "xem trước và thiết bị **không thể** lệch nhau", vì thứ
đang được xem trước là ngưỡng cảnh báo của một hệ điều khiển toà nhà.

## ADR-036 — Chỉ số hệ alarm ISA-18.2 dẫn xuất từ `alarm_history.jsonl`, kèm xoay vòng bắt buộc

- **Trạng thái:** Accepted 2026-08-18. Trả lời [Plan 57](../03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md) §12-Q5.
  Không supersede [ADR-018](../adr/ADR-018-sqlite-block-historian.md); nó vạch rõ
  ranh giới historian **không** bao gồm chỉ số hệ alarm.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).

### Ba kho đang có, và vì sao hai kho bị loại

| Kho | Hình dạng thật (đọc từ mã) | Vì sao không dùng |
|---|---|---|
| Historian (`ADR-018`) | SQLite theo point, chuỗi thời gian **số**, có hạn mức dung lượng và retention 1..180 ngày | Chỉ số alarm không phải mẫu của một point. Nhét vào phải bịa ra "point giả" cho từng chỉ số — vừa ăn hạn mức của dữ liệu vận hành thật, vừa làm bảng point có những dòng không tương ứng thiết bị nào |
| Activity (`internal/app/activity.go`) | Vòng nhớ **2000** sự kiện, nén tệp khi vượt 3000 dòng | Sai vòng đời một cách nguy hiểm: đúng lúc alarm flood — lúc cần số đo nhất — số sự kiện tăng vọt và **đẩy chính bằng chứng đó ra khỏi vòng nhớ**. Một kho tự xoá bằng chứng khi hệ thống gặp sự cố thì không dùng làm kho đo được |
| `alarm_history.jsonl` (`internal/app/alarmhistory.go`) | JSONL nối đuôi, mỗi dòng đã có `event` (`started`/`acked`/`ended`/`returned`/`setting_*`), `severity`, `alarmId`, `time`, `user` | **Đã chứa đúng dữ liệu** mà ISA-18.2 §16 cần. Đây là kho được chọn |

### Quyết định

1. **Không lập kho thứ tư.** Chỉ số (`alarm rate`/giờ, top-N cảnh báo lặp,
   chattering, stale, shelved sắp hết hạn) được **tính khi có yêu cầu** từ
   `alarm_history.jsonl`. Một nguồn sự thật cho vòng đời cảnh báo; hai nguồn sẽ
   trôi khỏi nhau, đúng khuôn lỗi đã lặp nhiều lần trong repository này.

2. **Điều kiện tiên quyết bắt buộc — sửa trước khi mở màn hình KPI.**
   `AlarmHistoryStore` hôm nay **không có xoay vòng và không có retention**:
   `Append` mở tệp ở chế độ `O_APPEND` và ghi mãi, còn `ListFiltered` **quét
   toàn bộ tệp** cho mỗi truy vấn. Mở một màn hình KPI lên trên hình dạng đó tạo
   ra đúng vòng xoáy sai: alarm flood ⇒ tệp phồng ⇒ truy vấn KPI chậm dần ⇒ chậm
   nhất đúng lúc sự cố nặng nhất, trên eMMC của một thiết bị nhúng.
   Vì vậy `T57-3.3` phải bắt đầu bằng: xoay vòng theo ngày + retention **90
   ngày** + một chỉ mục theo mốc thời gian để truy vấn không quét ngược từ đầu.

3. **Vì sao 90 ngày.** ISA-18.2 §16 báo cáo theo tháng/quý; 90 ngày phủ đủ một
   quý để so sánh xu hướng, và bị chặn trên bởi ngân sách lưu trữ của bo. Số này
   là **cấu hình được**, mặc định 90, và phải xuất hiện trên giao diện KPI cạnh
   mỗi số đo — một chỉ số không nói ra cửa sổ thời gian của nó thì không đọc được.

4. **Cửa sổ KPI cung cấp cho người dùng:** `1 giờ` / `24 giờ` / `7 ngày` /
   `30 ngày`. Cửa sổ nào vượt quá dữ liệu đang giữ phải **nói ra** là bị cắt,
   không được lặng lẽ trả về khoảng ngắn hơn.

### Phương án bị loại

*Một bảng SQLite riêng cho chỉ số alarm.* Cho truy vấn có chỉ mục và tổng hợp
rẻ. Loại vì nó dựng nguồn sự thật **thứ hai** về vòng đời cảnh báo nằm cạnh
JSONL: hai nơi phải cùng được ghi, và ngày chúng lệch nhau sẽ không ai biết. Chi
phí của phương án được chọn là quét `O(n)`, và điều 2 đặt chặn trên cho `n`.

## ADR-037 — Chính sách mật khẩu Rev A: giao diện công bố đúng luật thiết bị đang cưỡng chế

- **Trạng thái:** Accepted 2026-08-18. Trả lời [Plan 57](../03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md) §12-Q6.
  Bổ sung cho `ADR-021` (RBAC 3 vai trò — dòng trong bảng phía trên) ở phần
  *chất lượng thông tin xác thực*; không supersede ADR nào.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).

### Luật thật hôm nay — đọc từ mã, không từ tài liệu

`apps/web-api/internal/auth/service.go`:

```go
func validNewPassword(password string) bool {
	return len(password) >= 6
}
```

Đó là **toàn bộ** chính sách. Cụ thể, thiết bị hôm nay:

| Mục | Trạng thái thật |
|---|---|
| Độ dài tối thiểu | `6` — và là **6 byte**, không phải 6 ký tự (`len()` của Go đếm byte) |
| Lớp ký tự bắt buộc | Không có |
| Chặn mật khẩu tầm thường / trùng username | Không có |
| Khoá tài khoản sau N lần sai | **Không có.** `Authenticate` chỉ trả lỗi và ghi audit `failed`; không đếm, không khoá |
| Băm | `bcrypt` cost 12 — điểm mạnh duy nhất của bức tranh này |

Ghi chú về đơn vị đếm: `len()` của Go đếm **byte** còn `String.length` của
JavaScript đếm đơn vị UTF-16. Với mật khẩu có dấu tiếng Việt, số byte **lớn
hơn** số ký tự, nên một luật `>= 6` kiểm ở FE theo `.length` luôn **chặt hơn
hoặc bằng** backend. Chiều lệch này an toàn (FE không bao giờ lỏng hơn), nhưng
phải biết là nó tồn tại.

### Quyết định

**1. Chính sách được CƯỠNG CHẾ ở Rev A giữ nguyên `>= 6`, và giao diện nói ra
đúng con số đó, trước khi người dùng gõ.**

Siết FE lên 8 mà để backend ở 6 nghe có vẻ "chặt hơn thì cứ làm" — nhưng nó làm
giao diện **mô tả sai thiết bị**: màn hình bảo "tối thiểu 8", trong khi cùng cái
bo đó chấp nhận mật khẩu 6 ký tự qua bất kỳ client nào khác. Trong repository
này, giao diện nói sai về thiết bị là lỗi nặng hơn một chính sách yếu.

**2. Chỉ báo độ mạnh là KHUYẾN NGHỊ, và phải được dán nhãn là khuyến nghị.**

Có chỉ báo (độ dài, số lớp ký tự, có trùng username hay không, có nằm trong danh
sách ngắn các giá trị tầm thường hay không) nhưng nó **không chặn** nút Tạo/Đặt
lại. Biến nó thành cổng chặn là quay lại đúng lỗi ở điều 1 — dựng ra một luật
mà thiết bị không thi hành.

**3. Chính sách ĐÍCH, đã quyết, chưa thi hành.**

| Mục | Giá trị đích |
|---|---|
| Độ dài tối thiểu | **8** ký tự |
| Chặn | trùng username; danh sách các mật khẩu tầm thường phổ biến |
| Khoá tài khoản | **5 lần sai liên tiếp ⇒ khoá 15 phút**, mỗi lần khoá và mỗi lần mở ghi một vết audit |
| Áp dụng | tại `validNewPassword` và `Authenticate` trong Go — tức là cho **mọi** client, không riêng Web |

Chưa thi hành trong phiên 2026-08-18 vì nó là thay đổi Go + hợp đồng lỗi, nằm
ngoài phạm vi Wave 1 (FE thuần). Giao cho task mới **`T57-3.21`** ở Wave 3, đi
cùng `T57-3.17` (buộc đổi mật khẩu mặc định) vì hai việc chạm cùng một luồng.

Tài khoản 6 ký tự đang tồn tại **không** bị vô hiệu khi luật lên 8: kiểm tra chỉ
chạy lúc đặt mật khẩu. Đó là lựa chọn có ý thức — khoá cửa người đang trực ca
bằng một lần cập nhật gói phần mềm là cách chắc chắn để mất quyền quản trị bo.

**4. Hệ quả trực tiếp và bắt buộc cho `T57-1.10`.**

Vì **không có** cơ chế khoá tài khoản, giao diện đăng nhập **cấm** hiện thông
điệp "tài khoản bị khoá". Đó sẽ là bịa ra một trạng thái hệ thống không tồn tại
— cùng loại lỗi với bốn badge `online` giả từng nằm trên trang đăng nhập
(WEB-UX-002). Ba thông điệp được phép phân biệt là ba thứ **thật sự** phân biệt
được từ phía client:

| Tình huống | Bằng chứng phân biệt được | Thông điệp |
|---|---|---|
| Sai thông tin đăng nhập | HTTP `401` | "Tên đăng nhập hoặc mật khẩu không đúng" — **không** nói sai cái nào |
| Không tới được backend | `fetch` bị từ chối (`TypeError`), không có mã HTTP | "Không kết nối được tới thiết bị" |
| Backend tới được nhưng lỗi | HTTP `5xx` | "Thiết bị trả lỗi máy chủ" |

Giữ nguyên việc **không** phân biệt "sai tên" với "sai mật khẩu": backend cố ý
trả cùng một `401 invalid credentials` cho cả hai, và đó là hành vi đúng chống
dò tài khoản. FE không được suy diễn thêm.

### Phương án bị loại

1. *Ép 8 ký tự ở FE ngay bây giờ.* Loại theo điều 1 — làm giao diện mô tả sai
   thiết bị, và bị vòng qua bằng một lệnh `curl`.
2. *Đợi làm cả gói ở Wave 3, Wave 1 không đụng gì.* Loại: công bố luật hiện hành
   và chỉ báo độ mạnh đã có giá trị thật ngay hôm nay và không tốn hợp đồng nào.

## ADR-038 — "Hiệu lực thực tế" của lịch tính ở Core, mở rộng `mkddc-schedule-sim`

- **Trạng thái:** Accepted 2026-08-18. Trả lời [Plan 57](../03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md) §12-Q7.
  Thi hành nguyên tắc của [ADR-023](../adr/ADR-023-scheduler-v3-1-priority-transport-va-pham-vi.md);
  không supersede ADR nào.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).

### Bối cảnh

Grid 64 lịch mà không màn hình nào trả lời được *"lúc 14:00 thứ Ba, DO-02 sẽ ở
trạng thái nào và do lịch nào quyết định"* là chỗ dễ sinh sự cố nhất của cả tính
năng (§6.7-P1 của biên bản review).

Câu hỏi Q7 — Go hay Core — **đã có tiền lệ ràng buộc**, và tiền lệ đó được viết
thẳng vào header của Core:

> `schedule_runtime.hpp`: *"Đánh giá thuần không ghi ra target — dùng cho mô
> phỏng (SCHD-133). Backend gọi CHÍNH hàm này qua vỏ C; **cấm cài lại thuật toán
> ở nơi khác**."*

Và đã được thi hành: `handleSimulateSchedule` gọi tiến trình `mkddc-schedule-sim`
và trả `503` kèm giải thích khi thiếu binary, thay vì tự tính.

### Quyết định

1. Bản xem trước hợp nhất chạy ở **Core**, bằng cách thêm chế độ `--point <id>`
   cho **chính** binary `mkddc-schedule-sim` đang có. Không tạo binary thứ hai:
   hai binary cùng đọc một cấu hình lịch là hai chỗ để trôi.
2. Chế độ đó chạy **mọi** lịch có target là point đã cho qua cùng
   `evaluate_schedule`, rồi áp **cùng** phân xử `priority_for_writing` 1..16 của
   `ScheduleRuntime`, và phát ra một dòng thời gian hợp nhất trong đó mỗi khoảng
   ghi rõ **lịch nào đang thắng**.
3. Kết quả phải mang theo `override_source` — trường mà `TargetResult` đã có sẵn
   và, theo chính chú thích của nó, *"trả lời câu hỏi tốn nhiều thời gian hiện
   trường nhất: lịch bật rồi mà sao thiết bị không chạy"*. Một bản xem trước nói
   "14:00 BẬT" mà không nói "nhưng mức 2 Local Manual đang giữ" là bản xem trước
   sai về mặt vận hành dù đúng về mặt lịch.
4. Go giữ vai trò vận chuyển. Thiếu binary ⇒ `503` kèm giải thích. **Cấm** rơi
   về bản tính trong Go, kể cả "tạm thời".

### Đánh đổi đã chấp nhận

Đường Core tốn một thay đổi C++, một lần cross-compile và đóng gói cho mỗi bản
cập nhật bo, cộng một tiến trình con cho mỗi yêu cầu (ngân sách thời gian chờ
hiện là 10 s, đủ rộng). Đường Go nhanh hơn khoảng 2 người-ngày và không cần
chuỗi công cụ — nhưng phải chép lại **năm** mảng ngữ nghĩa: tuần, ngoại lệ, nhóm
ngày lễ, múi giờ theo từng lịch (SCHD-301, mỗi lịch dùng TZ do chính nó khai),
`effective_period`, và phân xử ưu tiên 1..16. Năm chỗ để trôi, mỗi chỗ trôi im
lặng, trên tính năng điều khiển thiết bị theo giờ.

## ADR-039 — AN TOÀN: đặc tả quét bus Modbus RTU (chỉ đặc tả, chưa thi hành)

- **Trạng thái:** Accepted 2026-08-18 **ở mức đặc tả**. Trả lời
  [Plan 57](../03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md) §12-Q8.
  Bổ sung cho `ADR-024` (Modbus RTU Point — dòng trong bảng phía trên) ở phần
  *thao tác ad-hoc trên bus*.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-18-02`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).
- **Thi hành:** **BLOCKED — hoãn sang Rev B** theo `AUTH-WEBUX-2026-08-19-02`
  quyết định 1 (chủ sở hữu sản phẩm, 2026-08-19). `T57-3.8` ra khỏi phạm vi
  Rev A; `T57-3.8` không được viết dòng code ghi ra bus nào cho tới khi PM chỉ
  định **Fieldbus Lead + QA/HIL Lead** theo điều kiện Track B đã ghi trong chính
  file này (phê duyệt PM/CTO 2026-08-04). Trong phiên 2026-08-18, **không có
  đường ghi ra bus nào được hiện thực**; phiên 2026-08-19 cũng vậy.
- **Không `SUPERSEDED`.** Chủ sở hữu chọn *hoãn*, không chọn *loại khỏi phạm vi*.
  11 ràng buộc dưới đây là đầu vào nguyên vẹn cho Rev B.

### Vì sao đây là câu hỏi an toàn chứ không phải câu hỏi tính năng

1. **Rev A chỉ có MỘT cổng RS-485** (`ADR-024`, phê duyệt PM/CTO 2026-08-04).
   Mọi thiết bị hiện trường dùng chung đúng một sợi dây. Không có "bus rảnh để
   quét" song song với "bus đang chạy".
2. **Mọi khung Modbus — kể cả khung đọc — đều lái transceiver RS-485.** Về mặt
   điện, quét *là* ghi ra môi trường truyền. Phân biệt có ý nghĩa không phải
   "đọc hay ghi" mà là **"có làm đổi trạng thái THIẾT BỊ hay không"**.
3. Địa chỉ quét trùng địa chỉ một thiết bị đang vận hành sẽ chèn thêm giao dịch
   vào chu kỳ của nó và làm trễ vòng poll của các slave đã cấu hình.

### Nguyên thuỷ đúng đã có sẵn

`BusWorker::probe_read` (MBR-B108) — và chú thích của nó nói chính xác vì sao nó
là điểm tựa duy nhất hợp lệ:

> *"Gọi từ THREAD KHÁC (control): lệnh được xếp hàng và do chính thread worker
> phát, nên **không bao giờ có hai luồng cùng nói trên một dây**."*

Mọi thiết kế quét **phải** dựng trên nguyên thuỷ này. Mở một handle thứ hai tới
`/dev/ttyS*` hay chạy quét trên thread riêng là hỏng ngay ở tầng vật lý.

### Đặc tả — 11 ràng buộc bắt buộc

| # | Ràng buộc | Lý do |
|---|---|---|
| 1 | **Chỉ mã hàm ĐỌC:** `FC03` hoặc `FC04`, `quantity = 1`, tại một địa chỉ thanh ghi duy nhất (mặc định `0`). `FC05/06/15/16/22/23` và các sub-function `FC08` làm đổi trạng thái **bị cấm vĩnh viễn trong đường quét** | Quét không bao giờ được đổi trạng thái một thiết bị đang chạy |
| 2 | Cấm phải cưỡng chế **ở tầng Core**, không chỉ ẩn nút ở UI | Một cấm chỉ có ở FE là một cấm không tồn tại |
| 3 | **Dải địa chỉ do người dùng nhập tường minh** trong `1..247`, **tối đa 32 địa chỉ mỗi lượt**. UI **không** được có "quét tất cả" | Quét 1..247 ở 9600 baud với timeout 300 ms cho địa chỉ trống là ~74 s độc chiếm dây. 32 địa chỉ chặn trường hợp xấu nhất ở ~10 s |
| 4 | Chạy như một job **xếp hàng trên chính `BusWorker`**, đan xen với poll bình thường. **Không** tạm dừng poll | Bỏ đói slave đã cấu hình để đi tìm slave chưa cấu hình là đánh đổi sai trên một trạm đang vận hành |
| 5 | **Dò baud/parity bị CẤM khi bus còn bất kỳ slave nào đang bật.** Chỉ cho phép khi bus có **không** slave nào enabled | Đổi thông số đường truyền làm **mọi** thiết bị trên dây mất liên lạc suốt thời gian dò. Đây là thao tác nguy hiểm nhất trong cả tính năng |
| 6 | Vai trò **`admin`**, không phải `operator` | Chặt hơn `read-test` (operator) vì quét độc chiếm môi trường dùng chung; lấy `write-test` (admin) làm tiền lệ đúng |
| 7 | **Điều kiện tiên quyết kiểm ở SERVER:** bus `RUNNING` hoặc không có slave enabled · hàng đợi ghi của bus rỗng · không có cảnh báo Critical đang hoạt động · không có job quét nào đang chạy (**một job mỗi thiết bị**, không phải mỗi bus) | Kiểm ở UI thì bỏ qua được bằng một request thẳng |
| 8 | **Xem trước khô bắt buộc.** Hành động chính của UI là *"Xem trước lần quét"*, không chạm dây, trả về: danh sách request chính xác sẽ phát · thời gian độc chiếm dây trường hợp xấu nhất tính bằng giây · danh sách slave đã cấu hình sẽ bị trễ poll và trễ bao nhiêu. Hành động chạm dây là một xác nhận **thứ hai**, riêng biệt, có nhắc lại con số độc chiếm đó | Người bấm phải biết cái giá trước khi trả |
| 9 | **Huỷ được, và dừng ở biên khung.** Huỷ không để lại lệnh dở vì không có lệnh ghi nào | Huỷ giữa một khung là sinh rác trên dây cho mọi slave |
| 10 | **Audit: hai vết cho mỗi job** — một khi bắt đầu (dải, FC, người thực hiện, thời gian độc chiếm dự kiến), một khi kết thúc (địa chỉ có trả lời, hoàn tất hay bị huỷ). **Không** ghi một vết cho mỗi địa chỉ | 32 vết cho một thao tác sẽ đẩy lịch sử vận hành ra khỏi vòng nhớ 2000 của Activity — đúng cơ chế hỏng mà `ADR-036` đã chỉ ra |
| 11 | **Trung thực về kết quả:** địa chỉ không đáp phải báo là **"không trả lời"**, tuyệt đối không báo là "không có thiết bị" | Thiết bị có thể đang ở baud khác, địa chỉ khác, hoặc đang bận. Biến "không nghe thấy" thành "không tồn tại" là bịa ra một kết luận từ một phép đo âm tính |

### Phương án bị loại

1. *Cho quét toàn dải 1..247 kèm cảnh báo bằng chữ.* Loại: một cảnh báo bằng chữ
   không đổi được vật lý của sợi dây. Chặn trên bằng con số (điều 3) mới đổi.
2. *Tạm dừng poll trong lúc quét cho nhanh.* Loại theo điều 4 — trong khoảng đó
   thiết bị mất giám sát các điểm đang vận hành.
3. *Cho `operator` quét vì "quét chỉ là đọc".* Loại theo điều 6: mức nguy hiểm
   nằm ở độc chiếm môi trường dùng chung, không nằm ở hướng của khung tin.
4. *Suy ra baud bằng cách phân tích khung rác.* Loại: không tin cậy, và vẫn phải
   đổi thông số cổng để thử — tức là vẫn vướng điều 5.

### Rủi ro còn lại sau khi áp đủ 11 ràng buộc

Ngay cả một lượt quét 32 địa chỉ hợp lệ vẫn **làm trễ** vòng poll của các slave
đã cấu hình khoảng vài giây. Với một điều khiển có vòng phản hồi chặt trên một
điểm Modbus, vài giây trễ đọc là có thật. Đây là rủi ro **được chấp nhận có ý
thức**, và điều 8 tồn tại để người quyết định nhìn thấy nó bằng số trước khi bấm.

## ADR-042 — Thẻ thiết bị công nghệ là trường trình bày, không phải thực thể mới

- **Trạng thái:** Accepted 2026-08-19.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).
- **Phục vụ:** `T57-3.1`, và là đường đi tối thiểu đã chốt cho `T57-4.1`.

### Bối cảnh

§4.1 của [biên bản review](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md)
chỉ ra khoảng hở lớn nhất về sản phẩm: giao diện trình bày **kênh I/O**, còn người
vận hành nghĩ bằng **thiết bị công nghệ** ("AHU-1 đang chạy thế nào?"). Bắc cầu
đầy đủ là process graphic ISA-101 Level 2 — Rev B. Đường tối thiểu là cho phép
nhóm điểm theo thiết bị.

### Quyết định

Thêm trường `equipment` (chuỗi, đã `trim`, ≤ 48 byte) vào cấu hình điểm. **Không**
tạo bảng thiết bị, không khoá ngoại, không ràng buộc phía Core.

1. Rỗng là hợp lệ và là mặc định. Điểm không có thẻ vào nhóm **"Chưa gán"** —
   **không** đoán thiết bị từ tên điểm, vì đoán sai sẽ gom nhầm hai hệ thống vào
   một khối và người đọc không có cách nào biết.
2. So khớp nhóm **phân biệt hoa thường theo hiển thị nhưng gom theo dạng đã
   chuẩn hoá**, để `AHU-1` và `ahu-1` không thành hai nhóm.
3. Core **không** đọc trường này. Nó là dữ liệu trình bày; đưa vào vòng điều khiển
   là biến một nhãn thành một phụ thuộc thời gian thực.

### Hệ quả

- `CONFIG_SCHEMA` và `contracts/openapi/openapi.yaml` thêm một trường tuỳ chọn;
  cấu hình cũ đọc lên vẫn hợp lệ (trường thiếu = rỗng).
- Khi Rev B làm mô hình thiết bị thật, trường này là **đường di trú** sẵn có,
  không phải thứ phải gỡ bỏ.

## ADR-043 — Tuỳ chọn người dùng là túi khoá-giá trị có hạn mức, backend không hiểu nội dung

- **Trạng thái:** Accepted 2026-08-19.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).
- **Phục vụ:** `T57-3.2`; gỡ giới hạn "chỉ trên trình duyệt này" của `T57-2.3`.

### Bối cảnh

`T57-2.3` đã làm khung nhìn đặt tên, nhưng lưu trong `localStorage`: đổi máy trạm
là mất. Ghim trên Landing (§6.1-P2a) và lựa chọn âm thanh alarm (`ADR-034`) cùng
một hình dạng bài toán.

### Quyết định

`GET /api/v1/me/preferences` và `PUT /api/v1/me/preferences`, cả hai ở `viewer`.

1. Thân là **một object JSON do FE tự định hình**, tối đa **16 KB** sau khi mã
   hoá. Backend cưỡng chế hạn mức và quyền sở hữu, **không** hiểu nội dung: mỗi
   tuỳ chọn giao diện mới mà phải đổi hợp đồng backend là một vòng lặp không đáng.
2. Chỉ đọc/ghi tuỳ chọn của **chính phiên đang gọi**. Không có đường cho `admin`
   đọc tuỳ chọn người khác qua endpoint này — tiện ích cá nhân không đáng để mở
   thêm một bề mặt đọc dữ liệu người dùng.
3. Vượt hạn mức ⇒ `413` với `reasonCode: preferences_too_large`. **Không** cắt bớt
   âm thầm: mất một khung nhìn mà không báo là kiểu hỏng người dùng không truy được.

### Hệ quả

FE giữ `localStorage` làm **bộ đệm ngoại tuyến**, nhưng nguồn chân lý là thiết bị.
Backend không đọc được tệp tuỳ chọn ⇒ giao diện quay về bộ đệm và **nói rõ** đang
dùng bản cục bộ.

## ADR-044 — Chỉ số hệ alarm tính tại thời điểm hỏi, cửa sổ tối đa 7 ngày

- **Trạng thái:** Accepted 2026-08-19.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).
- **Phục vụ:** `T57-3.3`. Thi hành `ADR-036` ở tầng Go.

### Quyết định

`GET /api/v1/alarms/metrics?window=<10m|1h|24h|7d>` trả:

| Trường | Nghĩa |
|---|---|
| `rate10m`, `ratePerHour` | Nhịp cảnh báo mới — hai con số ISA-18.2 §16 dùng để nói "hệ đang ngập hay không" |
| `topRepeating` | Cảnh báo lặp nhiều nhất trong cửa sổ, kèm số lần |
| `shelvedExpiring` | Cảnh báo đang bị treo sắp hết hạn treo |
| `flooding` | Đúng ngưỡng ISA-18.2: > 10 cảnh báo trong 10 phút |

1. **Không có tiến trình tổng hợp nền.** Một daemon tổng hợp là thêm một nguồn có
   thể lệch với nhật ký gốc; đọc thẳng nhật ký thì không có gì để lệch.
2. **Cửa sổ tối đa 7 ngày.** Kho giữ 90 ngày (`ADR-036`), nhưng một lần hỏi quét
   cả 90 ngày trên bo nhúng là tự tạo ra một điểm treo.
3. **Thiếu nhật ký ⇒ `503` nói rõ.** Cấm trả `0`: trên màn hình an toàn, "không có
   cảnh báo nào" và "không đọc được nhật ký" là hai tình trạng đối lập.

## ADR-045 — Hiệu lực thực tế và cảnh báo xung đột dùng chung một endpoint, chỉ là vỏ gọi Core

- **Trạng thái:** Accepted 2026-08-19.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).
- **Phục vụ:** `T57-3.5`, `T57-3.6`. Thi hành `ADR-038`.

### Quyết định

`GET /api/v1/schedules/effective?pointId=&from=&to=` gọi `mkddc-schedule-sim`
chế độ `--point`, trả chuỗi khoảng hiệu lực kèm **lịch nào thắng** và **vì sao**
(priority 1..16 của `ScheduleRuntime`).

1. **Thiếu binary ⇒ `503`** kèm giải thích, đúng như `handleSimulateSchedule` đang
   làm. Cấm bản tính trong Go: hai bản ngữ nghĩa lịch là nguồn sai lệch tệ nhất
   vì nó chỉ lộ ra ở đúng ca trực mà lịch chồng nhau.
2. **Cảnh báo xung đột khi soạn dùng chính dữ liệu này**, chỉ khác cách trình bày.
   Mở endpoint thứ hai cho cùng câu hỏi là tự tạo ra hai đường sẽ trôi khỏi nhau.
3. Khoảng hỏi tối đa **7 ngày**; dài hơn thì `400`, không cắt im lặng.

## ADR-046 — Xem thô khung truyền Modbus là vòng nhớ chỉ-đọc, không phát thêm byte nào

- **Trạng thái:** Accepted 2026-08-19.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).
- **Phục vụ:** `T57-3.9`.

### Bối cảnh

Chẩn đoán Modbus RTU tại hiện trường luôn quy về ba câu: khung có ra dây không,
slave có trả lời không, và CRC đúng không. Hiện giao diện chỉ có số đếm tổng hợp,
nên câu trả lời phải lấy bằng máy phân tích bus cắm song song.

### Quyết định

`GET /api/v1/modbus/frames?bus=&limit=` trả tối đa **200** khung gần nhất.

1. **Chỉ chụp khung mà chu kỳ poll bình thường đã phát.** Không một byte nào được
   phát thêm vì mục đích quan sát — đó là ranh giới tách task này khỏi `T57-3.8`
   (`ADR-039`), và task này **không** bị chặn bởi ranh giới đó.
2. Vòng nhớ nằm trong tiến trình iobus và **mất khi restart**. Đây là công cụ
   chẩn đoán tại chỗ, không phải nhật ký lưu trữ; nói rõ điều này trên giao diện.
3. ~~Byte thô hiện dạng hex, cắt ở 64 byte mỗi khung kèm dấu hiệu đã cắt.~~
   **`SUPERSEDED` 2026-08-19 — xem "Sửa đổi 2026-08-19" ở cuối mục này.** Rev A
   ghi **bản ghi giao dịch**, không có byte thô.
4. Vai trò `viewer` — đây là **đọc**, và người giám sát phải xem được (PR-MBRTU-001).

### Sửa đổi 2026-08-19 — Rev A ghi bản ghi giao dịch, không có byte thô

**Vì sao phải sửa chính ADR này.** Khi khảo sát để thi hành `T57-3.9`, điểm chèn
vòng nhớ trong `apps/iobus/adapters/modbus_rtu/bus_worker.cpp` đã rõ, nhưng điều
3 ở trên **không thực hiện được như đã hứa**: libmodbus không lộ bộ đệm wire ra
ngoài. Muốn có byte thô phải thay lớp transport của chính thư viện đang điều
khiển bus RS-485 thật.

**Quyết định.** Rev A ghi **bản ghi giao dịch**, không phải byte thô:

| Trường | Nội dung |
|---|---|
| `at` | Mốc thời gian |
| `bus`, `slave` | Bus nào, slave nào |
| `fc`, `addr`, `count` | Mã hàm, địa chỉ đầu, số thanh ghi/bit |
| `ok` | Giao dịch thành công hay không |
| `reason` | `timeout` · `crc` · `exception` · `ok` |
| `elapsed_us` | Thời lượng lượt phát |
| `attempt` | Lần phát thứ mấy (retry là dữ liệu chẩn đoán, không phải nhiễu) |

**Ba câu hỏi hiện trường mà mục "Bối cảnh" của ADR này nêu vẫn trả lời được đủ:**
khung có ra dây không (`at` + `attempt` tăng), slave có trả lời không (`ok`), CRC
đúng không (`reason=crc`). Thứ mất đi là khả năng đọc từng byte để soi lỗi đóng
khung ở tầng thấp — việc mà máy phân tích bus làm tốt hơn, và không phải việc mà
một giao diện web nên gánh bằng cách thay transport của thư viện.

**Không đổi gì khác.** Bốn ràng buộc còn lại của `ADR-046` giữ nguyên hiệu lực:
vòng nhớ CHỈ-ĐỌC, không byte nào phát thêm vì mục đích quan sát, không mở handle
thứ hai tới cổng, mất khi restart, tối đa 200 khung, vai trò `viewer`.

**Nếu Rev B cần byte thô** thì đó là một quyết định riêng, phải cân với rủi ro
thay lớp truyền — không được suy ra từ mục này.

## ADR-047 — Buộc đổi mật khẩu mặc định cưỡng chế ở backend, không ở giao diện

- **Trạng thái:** Accepted 2026-08-19.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).
- **Phục vụ:** `T57-3.17`.

### Quyết định

Tài khoản mang cờ `mustChangePassword`. Phiên đăng nhập của tài khoản có cờ này
**chỉ gọi được** `GET /api/v1/me` và `POST /api/v1/me/change-password`; mọi
endpoint khác trả `403` với `reasonCode: password_change_required`.

1. **Cưỡng chế ở backend.** Ẩn màn hình ở FE là không cưỡng chế gì cả: `curl` với
   cùng token vẫn đi thẳng vào mọi endpoint.
2. Cờ bật khi `admin` đặt lại mật khẩu cho người khác, và cho tài khoản khởi tạo
   lần đầu. Tự tắt ngay sau một lần đổi thành công.
3. **Không** đụng tới độ dài tối thiểu đã chốt ở `ADR-037`. Hai quyết định độc lập.
4. Thông điệp ở FE nói đúng nguyên nhân — không dùng lại câu lỗi 403 chung chung,
   vì người dùng sẽ tưởng mình thiếu quyền chứ không phải cần đổi mật khẩu.

## ADR-048 — Mô phỏng luật cảnh báo qua một endpoint vỏ, cấm bản tính xấp xỉ

- **Trạng thái:** Accepted 2026-08-19.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).
- **Phục vụ:** `T57-2.13`. Thi hành `ADR-035`.

### Quyết định

`POST /api/v1/alarm-settings/simulate` nhận `{ setting, samples: [{t, value}] }`
và trả các lần bật/tắt kèm mốc thời gian, mức nghiêm trọng, lý do.

1. Là **vỏ gọi `mkddc-alarm-sim`**. Thiếu binary ⇒ `503` nói rõ thiếu gì, **cấm**
   rơi về bản tính trong Go hay FE, kể cả "gần đúng" — một bản gần đúng sẽ được
   người dùng tin như bản thật đúng lúc họ đang đặt ngưỡng an toàn.
2. **Không chạm cấu hình đang lưu**, không ghi audit thay đổi (chỉ là phép thử),
   và không phát bất kỳ lệnh nào xuống thiết bị.
3. Giới hạn **1000 mẫu** mỗi lần gọi; vượt thì `400`.

### Trạng thái thi hành (2026-08-19)

`mkddc-alarm-sim` **đã tồn tại**: `apps/core/application/alarm/alarm_sim_main.cpp`
với target build trong `apps/core/CMakeLists.txt`. Trước ngày này, ADR đặc tả một
binary **chưa từng được viết** — endpoint đã đúng hợp đồng `503` nhưng tính năng
không dùng được ngoài hiện trường. Khoảng hở đó đóng lại cùng `T57-3.9`.

Binary là một vỏ mỏng quanh `AlarmRuntime`, nạp luật bằng chính
`parse_alarm_config_json` của controller, nên bộ mô phỏng từ chối **đúng** những
cấu hình mà thiết bị sẽ từ chối. Kiểm ở mức binary bằng ctest
`alarm_sim_behaviour` (13 trường hợp, `scripts/verify_alarm_sim.py`) — hợp đồng
stdin/stdout cũng là thứ phải khoá, không chỉ ngữ nghĩa.

Đã cài trên board ở `/usr/sbin` **và** `/opt/mkddc-web/`: `exec.LookPath` phụ
thuộc PATH của unit systemd, đường "cạnh chính mình" thì không.

## ADR-049 — Code-splitting theo lô nghiệp vụ nặng, giữ bốn màn hình mở ca ở chunk chính

- **Trạng thái:** Accepted 2026-08-19.
- **Phê duyệt:** `AUTH-WEBUX-2026-08-19-01`; chữ ký người: `WAIVED FOR IMPLEMENTATION` — **hết hiệu lực tại cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4).
- **Phục vụ:** `T57-4.2` (`F-UX-16`).

### Quyết định

Tách `React.lazy` theo **lô nghiệp vụ nặng và ít mở**: Programming, Xu hướng
(kèm thư viện biểu đồ), Lịch vận hành, Modbus RTU.

1. **Landing, Giám sát, Cảnh báo, Chẩn đoán ở lại chunk chính.** Đó là bốn màn
   hình mở đầu mỗi ca; chia chúng ra chỉ biến một lần tải thành hai lần chờ.
2. Mỗi ranh giới `lazy` phải có `Suspense` với khối trạng thái thật. Màn hình
   trắng trong lúc tải là một kiểu hỏng, không phải một trạng thái tải.
3. **Số đo nghiệm thu là thời gian mở trang đầu trên board thật**, không phải
   kích thước tệp — `F-DOC-10` đã cho thấy so kích thước giữa hai lệnh build
   khác nhau dẫn tới kết luận sai.

### Nghiệm thu đã thực hiện (2026-08-19)

Đo trên board `SOM-DDC-24-foxlinx` sau khi được uỷ quyền truy cập
(`AUTH-WEBUX-2026-08-19-02` quyết định 3). Trình duyệt thật (Chromium/Playwright)
mở trang đầu, context mới mỗi lượt nên **cache rỗng**; **12 cặp mẫu xen kẽ**
bản mới ↔ bản cũ trên cùng board, cùng phiên, để loại trôi đường truyền.

| Chỉ số | Bản cũ (`63f841d`) | Bản mới (`T57-4.2`) | Chênh |
|---|---:|---:|---:|
| Byte đường tới hạn | 1591,5 kB | **1255,7 kB** | **−335,8 kB (−21,1%)** |
| Số request lần mở đầu | 7 | 7 | 0 |
| First Contentful Paint (trung vị) | 1216 ms | **1092 ms** | −124 ms |
| FCP — trung vị chênh **theo cặp** | — | — | **−236 ms**, 8/12 cặp nghiêng về bản mới |
| `domContentLoaded` (trung vị) | 1063,5 ms | **959,5 ms** | −104 ms |

**Kết luận trung thực về độ mạnh của số đo.** Phần byte là **tất định** và đo lại
cho cùng kết quả mọi lượt. Phần thời gian **nghiêng đúng hướng** và cùng độ lớn
với mức giảm byte, nhưng 8/12 cặp là **chưa đủ mạnh về thống kê** (kiểm định dấu
cho `p ≈ 0,19`): đường đo phải đi qua tunnel SSH ra WAN, và nhiễu từng lượt của
tunnel cùng cỡ với hiệu ứng. Kết luận được phép rút ra: **không có hồi quy**, và
hướng cải thiện nhất quán. Kết luận **không** được phép rút ra: một con số cải
thiện chính xác.

**Khoảng hở của chính ADR này:** điều 3 đặt *loại* số đo nhưng **không đặt
ngưỡng đạt**. Nghiệm thu vì vậy chỉ khẳng định được "đã đo trên board thật và
không hồi quy". Muốn có ngưỡng thì phải bổ sung bằng một quyết định riêng.

**Điều kiện để có số dứt khoát:** đo lại trên **LAN cùng mạng với board**, bỏ
tunnel; và đo trên đúng máy khách mà người vận hành dùng — CPU máy khách là nơi
chênh lệch 968 kB ↔ 558 kB tác động mạnh nhất qua thời gian parse/execute, phần
mà phép đo qua tunnel này chưa tách ra được.

## `AUTH-WEBUX-2026-08-18-01` — Chỉ thị triển khai Wave 0 của Plan 57

**Ban hành:** 2026-08-18 bởi chủ sở hữu sản phẩm (chỉ thị trực tiếp: "hãy tự
triển khai plan này", chế độ multi-agent 1 implement / 2 kiểm tra / 1 docs).
**Cơ sở:** `DOC_GOVERNANCE.md` §4.1.

| Cổng | Trạng thái sau chỉ thị |
|---|---|
| `PLAN_READY` | **PASS** cho [Plan 57](../03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md) |
| `IMPLEMENT_READY[Plan 57 Wave 0 — Track A/B/C/D]` | **PASS** |
| `IMPLEMENT_READY[Plan 57 Wave 1..4]` | **BLOCKED** — giữ nguyên; chưa có asset trực quan theo §2.2, chưa trả lời Q2/Q4/Q5/Q6/Q7/Q8 |
| `RELEASE_READY` | **N/A** — cổng độc lập, không được suy ra từ chỉ thị này |

Hai câu hỏi mở của Plan 57 §12 được đóng bằng mặc định kỹ thuật trong phạm vi
Wave 0, ghi rõ để không bị hiểu là đã có quyết định của người có thẩm quyền:

- **Q1** (`F-DOC-03`): chọn phương án **chỉ sửa tài liệu** — chuyển câu luật
  "bốn trạng thái" về đúng mục `health.state`. Không thêm `unknown` vào
  `PointQuality`, vì phương án kia đổi contract và vượt phạm vi Wave 0.
- **Q3** (`F-UX-14`): điểm ngừng cập nhật ⇒ **đứt đường**, không giữ giá trị
  cuối. Theo tiền lệ đã có `REQ-PA3-06-2` ("gap KHÔNG nối đường").

Sáu câu hỏi còn lại (Q2, Q4, Q5, Q6, Q7, Q8) **không** được đóng bằng chỉ thị
này. Q8 là câu hỏi an toàn (quét bus Modbus là ghi ra bus thật) và phải có
quyết định của người trước khi bất kỳ dòng code nào của `T57-3.8` được viết.

Số ADR tiếp theo còn trống tại thời điểm ban hành: **`ADR-032`**.

## `AUTH-WEBUX-2026-08-18-02` — Đóng sáu câu hỏi §12 và mở Wave 1 của Plan 57

**Ban hành:** 2026-08-18, vai trò CTO dự án, trong phiên làm việc được chủ sở
hữu sản phẩm giao ("mở khoá và triển khai tiếp Plan 57").
**Cơ sở:** `DOC_GOVERNANCE.md` §4.1. Nối tiếp `AUTH-WEBUX-2026-08-18-01`.

**Attribution — bắt buộc theo `DOC_GOVERNANCE` §6 quy tắc 4.** Mọi quyết định
trong record này và trong `ADR-034`…`ADR-039` do **agent** thực hiện dưới vai
trò được giao. **Không có chữ ký người** cho vai trò CTO/UX Lead/Tech Lead/PM ở
ngày 2026-08-18. Ô chữ ký ghi `WAIVED FOR IMPLEMENTATION`, đúng tiền lệ
`ADR-033` và §9b của [biên bản review](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md).
Các ADR này **đủ tư cách làm đầu vào implementation**, **chưa đủ tư cách baseline
`M5 — APPROVED`**.

### Sáu câu hỏi §12 — đã đóng

| Câu | Quyết định | Ghi ở |
|---|---|---|
| Q2 | Annunciation hai lớp; lớp nhìn bắt buộc, lớp nghe opt-in và phải tự khai báo ba trạng thái thật | `ADR-034` |
| Q4 | Ngữ nghĩa luật cảnh báo thuộc Core; mô phỏng gọi lại Core qua `mkddc-alarm-sim`. `T57-2.13` chuyển Wave 2 → Wave 3 | `ADR-035` |
| Q5 | Chỉ số ISA-18.2 dẫn xuất từ `alarm_history.jsonl`; bắt buộc thêm xoay vòng + retention 90 ngày trước | `ADR-036` |
| Q6 | Công bố đúng luật đang cưỡng chế (`≥ 6` byte); chỉ báo độ mạnh là khuyến nghị. Chính sách đích (8 ký tự + khoá 5/15 phút) giao `T57-3.21` | `ADR-037` |
| Q7 | "Hiệu lực thực tế" tính ở Core, mở rộng `mkddc-schedule-sim` chế độ `--point` | `ADR-038` |
| Q8 | **An toàn** — 11 ràng buộc bắt buộc cho quét bus; **đặc tả, chưa thi hành** | `ADR-039` |

Cùng với Q1/Q3 đã đóng ở `AUTH-WEBUX-2026-08-18-01`, **cả tám câu hỏi §12 của
Plan 57 đã có quyết định có ghi chép**.

### Trạng thái ba cổng sau chỉ thị

| Cổng | Trạng thái |
|---|---|
| `PLAN_READY` | **PASS** — giữ nguyên từ `AUTH-WEBUX-2026-08-18-01` |
| `IMPLEMENT_READY[Plan 57 Wave 0]` | **PASS** — giữ nguyên |
| `IMPLEMENT_READY[Plan 57 Wave 1]` | **PASS** — hai điều kiện chặn đã gỡ: asset trực quan cho hai màn hình mới phát hành tại `docs/04_uiux/assets/operations/` và nhúng trong `KX-DDC24-UX-WEB-OPERATIONS-001`; Q2 và Q6 đã trả lời |
| `IMPLEMENT_READY[Plan 57 Wave 2]` | **PASS** cho phần FE thuần — Wave 0 Track C đã xong và Q4 đã trả lời. **Trừ `T57-2.13`**, đã chuyển sang Wave 3 theo `ADR-035` |
| `IMPLEMENT_READY[Plan 57 Wave 3]` | **BLOCKED** — giữ nguyên. Q5/Q7/Q8 đã trả lời nhưng còn thiếu **9 ADR theo từng task** và chữ ký Tech Lead. Riêng `T57-3.8` chặn thêm bởi điều kiện Track B Modbus RTU (chưa chỉ định Fieldbus Lead + QA/HIL Lead) |
| `IMPLEMENT_READY[Plan 57 Wave 4]` | **BLOCKED** — chưa có quyết định sản phẩm Rev A/Rev B |
| `RELEASE_READY` | **N/A** — cổng độc lập, **không** được suy ra từ record này |

### Cấm cụ thể áp cho phiên triển khai

1. **Không dòng code nào ghi ra bus RS-485 được viết trong phiên 2026-08-18.**
   `ADR-039` là đặc tả. Vi phạm điều này là finding `P0`.
2. Không hiện thông điệp "tài khoản bị khoá" ở trang đăng nhập — trạng thái đó
   không tồn tại trong backend (`ADR-037` điều 4).
3. Không viết bản mô phỏng luật cảnh báo nào ở FE, kể cả "gần đúng"
   (`ADR-035` điều 3).
4. Không nới `ROUTE_MIN_ROLE` cho bất kỳ màn hình mới nào; mọi mức quyền phải
   suy từ endpoint backend thật.

Số ADR tiếp theo còn trống tại thời điểm ban hành: **`ADR-040`**.

## `AUTH-WEBUX-2026-08-19-01` — Mở Wave 3 (trừ `T57-3.8`) và chốt Wave 4 của Plan 57

**Ban hành:** 2026-08-19, theo chỉ thị trực tiếp của **chủ sở hữu sản phẩm** trong
phiên làm việc: "kiểm tra tiến độ Plan 57, nếu chưa close thì tiến hành implement
đến khi close", cùng hai lựa chọn được chốt tường minh khi được hỏi lại.
**Cơ sở:** `DOC_GOVERNANCE.md` §4.1. Nối tiếp `AUTH-WEBUX-2026-08-18-02`.

**Attribution — bắt buộc theo `DOC_GOVERNANCE` §6 quy tắc 4.** Nội dung kỹ thuật
của record này và của `ADR-042`…`ADR-049` do **agent** soạn dưới vai trò được
giao; **phần cho phép triển khai là quyết định của người** (chủ sở hữu sản phẩm),
ghi lại nguyên văn hai lựa chọn ở dưới. Ô chữ ký của Tech Lead/UX Lead/PM vẫn ghi
`WAIVED FOR IMPLEMENTATION` — các ADR này **đủ tư cách làm đầu vào
implementation**, **chưa đủ tư cách baseline `M5 — APPROVED`**.

### Hai quyết định của chủ sở hữu

| # | Câu hỏi | Lựa chọn đã chốt |
|---|---|---|
| 1 | Cổng Wave 3 | **"Mở Wave 3, trừ `T57-3.8`"** — viết ADR theo từng task rồi implement 20/21 task. `T57-3.8` (quét bus Modbus) **giữ `BLOCKED`** vì quét là GHI ra bus RS-485 thật, có thể làm nhiễu thiết bị đang chạy |
| 2 | Wave 4 | **"Đường tối thiểu + code-splitting"** — `T57-4.1`: chấp nhận đường tối thiểu qua `T57-3.1` (nhóm điểm theo thiết bị công nghệ) cho Rev A, hoãn trình soạn đồ hoạ ISA-101 Level 2 sang **Rev B**. `T57-4.2`: làm code-splitting theo route ngay, đo thời gian mở trang trên board thật |

### Chín task cần ADR — ánh xạ

| Task | ADR | Ghi chú |
|---|---|---|
| `T57-3.1` | `ADR-042` | Thẻ thiết bị — đổi `CONFIG_SCHEMA` |
| `T57-3.2` | `ADR-043` | Endpoint tuỳ chọn người dùng |
| `T57-3.3` | `ADR-044` | Thi hành `ADR-036` |
| `T57-3.5`, `T57-3.6` | `ADR-045` | Dùng chung, thi hành `ADR-038` |
| `T57-3.8` | `ADR-039` | **Đặc tả sẵn có; task vẫn `BLOCKED`** theo quyết định 1 |
| `T57-3.9` | `ADR-046` | Vòng nhớ khung truyền, chỉ đọc |
| `T57-3.17` | `ADR-047` | Đổi luồng xác thực |
| `T57-2.13` | `ADR-048` | Thi hành `ADR-035` |
| `T57-4.2` | `ADR-049` | Chiến lược chia chunk |

### Trạng thái ba cổng sau chỉ thị

| Cổng | Trạng thái |
|---|---|
| `PLAN_READY` | **PASS** — giữ nguyên |
| `IMPLEMENT_READY[Plan 57 Wave 0/1/2]` | **PASS** — Wave 0–2 đã triển khai xong (Wave 2 đóng 2026-08-19) |
| `IMPLEMENT_READY[Plan 57 Wave 3]` | **PASS trừ `T57-3.8`** — mở bằng record này; `ADR-042`…`ADR-049` là đầu vào implementation |
| `IMPLEMENT_READY[Plan 57 `T57-3.8`]` | **BLOCKED** — quét bus ghi ra RS-485 thật. Điều kiện mở: quyết định người riêng cho việc phát khung ra bus đang vận hành, và điều kiện Track B Modbus RTU (Fieldbus Lead + QA/HIL Lead) |
| `IMPLEMENT_READY[Plan 57 Wave 4]` | **PASS** — `T57-4.1` theo đường tối thiểu (`ADR-042`), `T57-4.2` theo `ADR-049` |
| `RELEASE_READY` | **N/A** — cổng độc lập, **không** được suy ra từ record này |

### Cấm cụ thể áp cho phiên triển khai Wave 3

1. **Không dòng code nào phát khung ra bus RS-485 vì mục đích quét/dò.** `T57-3.9`
   chỉ được chụp lại khung mà chu kỳ poll bình thường đã phát (`ADR-046` điều 1).
   Vi phạm là finding `P0`.
2. Không viết bản tính xấp xỉ cho ngữ nghĩa lịch (`ADR-045`) hay luật cảnh báo
   (`ADR-048`) ở Go/FE. Thiếu binary Core ⇒ `503` nói rõ.
3. Không nới `ROUTE_MIN_ROLE`; mọi màn hình mới suy quyền từ endpoint thật.
4. Không dùng `T57-4.1` đường tối thiểu để tuyên bố đã đóng khoảng hở ISA-101
   Level 2 — nó vẫn mở, và thuộc Rev B.

Số ADR tiếp theo còn trống tại thời điểm ban hành: **`ADR-050`**.

## `AUTH-WEBUX-2026-08-19-02` — Bốn quyết định người: quét bus, chủ sở hữu C++, truy cập board, hiệu lực chữ ký

**Ban hành:** 2026-08-19, theo bốn lựa chọn trực tiếp của **chủ sở hữu sản phẩm**
khi được hỏi tường minh trong phiên làm việc.
**Cơ sở:** `DOC_GOVERNANCE.md` §4.1 và §6 quy tắc 4/5. Nối tiếp
`AUTH-WEBUX-2026-08-19-01`.

**Vì sao cần record riêng.** Bốn mục dưới đây **không phải quyết định kỹ thuật**
mà agent được tự quyết theo `CLAUDE.md`: một là cấp phép an toàn cho việc phát
khung lên bus RS-485 đang vận hành, một là chỉ định người thật, một là cấp quyền
truy cập thiết bị, một là chữ ký baseline mà §6 quy tắc 4 **cấm agent tự ký**.
Agent đã dừng và hỏi; bốn ô "Lựa chọn đã chốt" dưới đây là câu trả lời của người.

**Không cấp ADR mới.** Bốn mục này là quyết định *thẩm quyền và lịch trình*, không
đổi kiến trúc, nên chúng ghi thẳng vào record này và ký ngược vào `ADR-039`/
`ADR-049`. Số ADR trống kế tiếp **giữ nguyên `ADR-050`**.

### Bốn quyết định của chủ sở hữu

| # | Câu hỏi | Lựa chọn đã chốt |
|---|---|---|
| 1 | `T57-3.8` quét bus Modbus | **"Hoãn sang bản sau"** — `T57-3.8` **ra khỏi phạm vi Rev A**, chuyển sang **Rev B**. `ADR-039` giữ nguyên tư cách đặc tả, **không** được cấp phép thi hành |
| 2 | Chủ sở hữu ba task C++ | **"Giao cho agent cả ba, bắt đầu ngay"** — `T57-3.9` (`apps/iobus`), `T57-3.19` + `T57-3.20` (`apps/hmi`). Tổng **7,0 người-ngày**, mốc bắt đầu **2026-08-19** |
| 3 | Board Foxlinx | **"Uỷ quyền cho agent truy cập board"** — agent tự khôi phục kết nối, deploy Wave 0–3, và đo số nghiệm thu `T57-4.2` |
| 4 | Chữ ký `ADR-034`…`ADR-049` | **"Giữ `WAIVED FOR IMPLEMENTATION`, có mốc hết hiệu lực"** — waive hợp lệ **tới cổng `RELEASE_READY` Rev A**; phải ký thật trước khi mở cổng đó |

### Quyết định 1 — `T57-3.8` hoãn sang Rev B

**Điều kiện xem lại (bắt buộc ghi theo §6 quy tắc 5):**

| Mục | Nội dung |
|---|---|
| Owner của việc mở lại | Chủ sở hữu sản phẩm (người ban hành record này) |
| Điều kiện mở khoá | PM chỉ định **Fieldbus Lead** và **QA/HIL Lead** — hai vai trò còn trống, vốn đã là điều kiện `CONDITIONAL` của Track B Modbus RTU từ phê duyệt PM/CTO **2026-08-04** |
| Mốc xem lại | Khi mở phạm vi **Rev B**, hoặc sớm hơn nếu hai vai trò trên được chỉ định |
| Ảnh hưởng | Web UI Rev A **không có** chức năng quét/dò thiết bị trên bus. Người vận hành thêm slave Modbus bằng cách nhập địa chỉ đã biết, không bằng dò tìm |
| Gate | `IMPLEMENT_READY[Plan 57 T57-3.8]` = **BLOCKED (hoãn Rev B)** |

**Lý do giữ chặn thay vì cấp phép.** Cấp phép thi hành khi Fieldbus Lead và QA/HIL
Lead còn trống sẽ **tự mâu thuẫn với một quyết định đang có hiệu lực** — phê duyệt
PM/CTO 2026-08-04 đặt hai vai trò đó làm tiền đề của Track B. Ngoài ra `ADR-039`
mục "Rủi ro còn lại" đã ghi: kể cả một lượt quét hợp lệ 32 địa chỉ vẫn làm **trễ
vòng poll của các slave đã cấu hình vài giây** — trên Rev A một cổng RS-485, đó là
rủi ro cần người nhận, và hiện chưa có ai ở vai trò để nhận.

**Không loại khỏi Rev A.** Chủ sở hữu chọn *hoãn*, không chọn *loại*. `ADR-039`
**không** bị `SUPERSEDED`; 11 ràng buộc của nó là đầu vào nguyên vẹn cho Rev B.
Mẫu số Plan 57 giữ **71 task**; `T57-3.8` được đánh dấu **chuyển phạm vi**, nên
mẫu số *đóng plan cho Rev A* là **70**.

### Quyết định 2 — Chủ sở hữu ba task C++

| Task | Nơi sửa | Ước lượng | Owner | Mốc bắt đầu |
|---|---|---:|---|---|
| `T57-3.9` xem thô khung truyền Modbus | `apps/iobus` (C++) | 4,0 người-ngày | **Agent** | 2026-08-19 |
| `T57-3.19` đếm ngược TTL ép tay trên màn Control | `apps/hmi` (C++/LVGL) | 1,5 người-ngày | **Agent** | 2026-08-19 |
| `T57-3.20` chỉ báo "Web đang có người đăng nhập" | `apps/hmi` (C++/LVGL) | 1,5 người-ngày | **Agent** | 2026-08-19 |

**Ràng buộc bắt buộc khi thi hành `T57-3.9` — kế thừa nguyên văn từ quyết định 1.**
Việc `T57-3.8` bị hoãn **không** nới lỏng gì cho `T57-3.9`, và cũng **không** biến
`T57-3.9` thành đường vòng để có chức năng quét:

1. Vòng nhớ khung là **CHỈ-ĐỌC** (`ADR-046` điều 1). Chỉ chụp lại khung mà **chu kỳ
   poll bình thường đã phát**. **Không một byte nào được phát thêm vì mục đích quan
   sát.** Vi phạm là finding `P0`.
2. Không mở handle thứ hai tới `/dev/ttyS*`, không chạy trên thread riêng — mọi
   truy cập đi qua chính `BusWorker` (`ADR-039` mục "Nguyên thuỷ đúng đã có sẵn").
3. Vòng nhớ nằm trong tiến trình `iobus` và **mất khi restart**. Đây là công cụ
   chẩn đoán tại chỗ, **không** phải nhật ký lưu trữ — cấm mô tả nó như bằng chứng
   vận hành lâu dài.

### Quyết định 3 — Truy cập board Foxlinx

**Uỷ quyền cấp cho agent**: khôi phục kết nối, deploy Wave 0–3, đo số nghiệm thu
`T57-4.2`. Phạm vi là **board lab** `SOM-DDC-24-foxlinx`
(`root@mekong-fac.ddns.net:2223`), không phải trạm vận hành thật.

**Hiện trạng đo lại ngay sau khi được uỷ quyền (2026-08-19 08:54Z):**

| Mục | Kết quả thật |
|---|---|
| TCP 2223 / 2222 | **Thông cả hai** — board đã trở lại mạng |
| SSH | **Đăng nhập được**; `uptime` 22:48 ⇒ board khởi động lại khoảng **2026-08-18 10:06Z** |
| Service | `mkddc-core`, `mkddc-iobus`, `mkddc-netcfg`, `mkddc-fakemcu` **active**; Web/API chạy dưới tên unit **`mkddc-web-pi`** (`:8081`), không phải `mkddc-web` |
| Bản web đang chạy | `index-CTLcA5C6.js` = **967,67 kB**, mốc **2026-08-18 12:43Z** ⇒ đúng bản `63f841d` |

**Hai đính chính với mô tả trong tờ trình:** bản trên board là **12:43Z** ngày
2026-08-18 chứ không phải 03:15Z; và board **không còn mất kết nối** tại thời điểm
ban hành record này. Việc "deploy bị chặn" trong Plan 57 §13b **hết hiệu lực** kể
từ record này.

**Đã thi hành ngay trong phiên (2026-08-19):**

1. Sao lưu bản đang chạy sang `dist.bak-20260819` trước khi ghi đè.
2. Deploy **Wave 0–3** bằng `scp` (board Buildroot không có `rsync`), build bằng
   `npm run build:foxlinx` — không phải `npm run build` trần, vì cờ Programming
   của Foxlinx là cờ **build-time**.
3. Đo nghiệm thu `T57-4.2` theo `ADR-049` điều 3 bằng trình duyệt thật, 12 cặp
   mẫu xen kẽ bản mới ↔ bản cũ trên cùng board. Chi tiết số đo ghi trong mục
   `ADR-049` phía trên và Plan 57 §13b.

**Kết luận nghiệm thu `T57-4.2`: ĐẠT ở mức mà `ADR-049` yêu cầu được** — đã có số
đo trên board thật, byte đường tới hạn giảm **21,1%** (tất định), thời gian mở
trang nghiêng đúng hướng (**−236 ms** trung vị theo cặp, 8/12 cặp), **không có hồi
quy**. Hai giới hạn phải nêu kèm mỗi khi trích số này: (a) `ADR-049` **không đặt
ngưỡng đạt**, nên nghiệm thu chỉ khẳng định được "đã đo và không hồi quy";
(b) phép đo đi qua tunnel SSH ra WAN nên nhiễu từng lượt cùng cỡ hiệu ứng —
kiểm định dấu `p ≈ 0,19`, **chưa đủ mạnh để tuyên bố một con số cải thiện chính
xác**. Kích thước chunk (989,94 → 558,49 kB) vẫn **không** được dùng thay cho
thời gian mở trang.

**CI GitHub Actions — CHƯA CÓ QUYẾT ĐỊNH.** Chủ sở hữu không chọn phương án nào
cho mục này khi được hỏi. Ghi lại đúng như vậy, không suy diễn:

| Mục | Trạng thái |
|---|---|
| Nguyên nhân | Lỗi thanh toán của tổ chức từ 2026-08-17; mọi check fail sau 2–3 giây, **không phải lỗi mã** |
| Owner | **Chủ sở hữu sản phẩm** — cần quyền billing GitHub của tổ chức, ngoài tầm agent |
| Mốc | **Chưa đặt** |
| Thực hành hiện hành | PR tiếp tục merge bằng bằng chứng test local. Đây là **ngoại lệ chưa có ngày đáo hạn**, không phải trạng thái bình thường |

### Quyết định 4 — Hiệu lực của `WAIVED FOR IMPLEMENTATION`

`ADR-034`…`ADR-049` (và `ADR-033`, cùng lớp waive, cùng Plan 57) giữ nguyên ô chữ
ký `WAIVED FOR IMPLEMENTATION`, **kèm mốc hết hiệu lực**:

| Mục | Nội dung |
|---|---|
| Waive cho phép | Dùng làm **đầu vào implementation** — đúng như `DOC_GOVERNANCE` §6 quy tắc 4 |
| Waive **không** cho phép | Dùng làm **baseline `M5 — APPROVED`**; suy ra `RELEASE_READY`; suy ra đã có review của Tech Lead/UX Lead/PM |
| Mốc hết hiệu lực | **Cổng `RELEASE_READY` Rev A.** Phải có chữ ký người thật trước khi mở cổng đó |
| Nếu tới mốc mà chưa ký | Cổng `RELEASE_READY` **không được mở**. Không có đường waive lần hai |
| Owner của việc ký | Tech Lead / UX Lead / PM theo từng ADR; điều phối bởi chủ sở hữu sản phẩm |

Agent **không** được điền tên vào các ô chữ ký này trong bất kỳ tình huống nào
(`DOC_GOVERNANCE` §6 quy tắc 4, và §5 "không điền giả chữ ký, nâng giả `M4/M5`").

### Trạng thái các cổng sau record này

| Cổng | Trạng thái |
|---|---|
| `PLAN_READY` | **PASS** — giữ nguyên |
| `IMPLEMENT_READY[Plan 57 Wave 0/1/2]` | **PASS** — giữ nguyên |
| `IMPLEMENT_READY[Plan 57 Wave 3]` | **PASS trừ `T57-3.8`** — giữ nguyên; ba task C++ đã có owner theo quyết định 2 |
| `IMPLEMENT_READY[Plan 57 `T57-3.8`]` | **BLOCKED — hoãn sang Rev B** theo quyết định 1. Mở lại khi có Fieldbus Lead + QA/HIL Lead |
| `IMPLEMENT_READY[Plan 57 Wave 4]` | **PASS** — giữ nguyên; đường nghiệm thu `T57-4.2` đã mở theo quyết định 3 |
| `RELEASE_READY` | **N/A**, và nay có thêm một tiền đề tường minh: **chữ ký thật cho `ADR-033`…`ADR-049`** theo quyết định 4 |

### Cấm cụ thể phát sinh từ record này

1. **Không viết bất kỳ đường phát khung quét/dò nào ra bus RS-485** cho tới khi có
   record cấp phép riêng. `T57-3.9` chỉ được đọc thụ động (`ADR-046` điều 1).
   Vi phạm là finding `P0`.
2. **Không dùng `T57-3.9` để tuyên bố đã có khả năng quét bus.** Xem khung đã phát
   và chủ động dò thiết bị là hai việc khác nhau; gộp chúng trong tài liệu hay
   giao diện là mô tả sai thiết bị.
3. **Không dùng kích thước chunk thay cho thời gian mở trang** khi nghiệm thu
   `T57-4.2` (`ADR-049` điều 3).
4. **Không nâng `M4 → M5`** cho bất kỳ ADR nào trong `ADR-033`…`ADR-049` khi ô chữ
   ký còn ghi `WAIVED FOR IMPLEMENTATION`.
5. **Không ghi CI là "đã quyết"** dưới bất kỳ hình thức nào — mục đó còn mở, không
   có mốc, và ngoại lệ merge-bằng-test-local phải được nêu đúng là ngoại lệ.

Số ADR tiếp theo còn trống: **`ADR-050`** (record này không cấp ADR mới).

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
- **Phê duyệt PM/CTO ngày 2026-08-07** đóng 6 quyết định kiến trúc Scheduler
  Engine v3.1 theo phương án PA-1 và cho phép triển khai
  [Plan 50](../03_implementation/archive/50_SCHEDULER_V3_1_IMPLEMENTATION_PLAN.md)
  (5 pha / 78 task / 64 người-ngày). Chi tiết tại
  [ADR-023](../adr/ADR-023-scheduler-v3-1-priority-transport-va-pham-vi.md) và
  [Tờ trình](../07_records/reviews/SCHEDULER_V3_1_APPROVAL_REQUEST_2026-08-07.md).
  Ba quyết định có ảnh hưởng rộng nhất: **priority ghi 1..16 được phân xử bên
  trong `ScheduleRuntime`**, chỉ lịch thắng đi xuống `PRIO_SCHEDULE` — không mở
  rộng `PriorityResolver` 6 mức và **không chạm đường Fire/Safety**; **MQTT ngoài
  phạm vi Rev A** nhưng ngữ nghĩa revision/correlation/ACK-NACK/timeout/retry/
  chống-lặp là bắt buộc trên transport nội bộ; và **BACnet Schedule Object (17) +
  Calendar (6) làm ở P4**, không được chặn P1–P3, không dùng mốc BTL làm gate.
- Ba nguyên tắc PM/CTO yêu cầu giữ đúng khi thực thi Plan 50: đóng băng data
  contract trước khi code P1; simulation dùng **chung** evaluation engine với
  controller (cấm cài lại thuật toán trong Go); và không tuyên bố
  production-ready khi chưa có kiểm chứng I/O vật lý.
- **Phê duyệt Product Owner/CTO ngày 2026-08-20** — bốn quyết định phạm vi sau
  đợt rà toàn ứng dụng. Nguyên tắc chung xuyên suốt cả bốn: **hợp đồng Rev A chỉ
  được mô tả thứ runtime Rev A thực thi**; một bề mặt được khai mà không có
  handler còn tệ hơn là không khai, vì nó sinh client gọi vào hư không và làm mọi
  phép đếm độ phủ API sai.
  1. **STM32 BSP: hoãn** cho tới khi có phần cứng — không CubeMX/startup/linker/
     ADC/DAC/GPIO thật. **Nhưng `firmware.elf` phải bị gỡ khỏi
     `checksums.sha256` và release artifact NGAY**: ELF hiện tại có entry
     `0x811d` và không có bảng vector nên không boot được trên STM32G0B1RBT6,
     và phát hành checksum cho nó là phát hành provenance sai. Compile check vẫn
     giữ ở CI job `mcu-firmware`. Khoá bằng
     `tests/integration/test_release_packaging_guard.py`.
  2. **OTA → Rev B.** Gỡ toàn bộ `/ota/*` khỏi OpenAPI Rev A, route table,
     generated client và FE capability. Requirement/design/backlog giữ dưới
     Rev B. Cùng nguyên tắc, ba path không có handler khác cũng bị gỡ:
     `/graph/validate`, `/graph/deploy`, `/logs/download` (phải implement trước
     rồi mới khai lại) và `/bacnet/objects` (đi cùng quyết định 3).
  3. **`expose_bacnet` gỡ khỏi đường Rev A** (`OD-MBRTU-014`). Không nối
     `BuildProfile`. Cấu hình cũ vẫn nạp được nhưng phải báo deprecated/ignored,
     không được giả là functional. Đưa Point Modbus RTU ra BACnet là Rev B và
     phải implement **end-to-end** trước khi mở lại field.
  4. **Vòng đời lệnh ghi Modbus RTU** (`OD-MBRTU-005`): **TTL 30 s hoặc tối đa
     3 retry**, điều kiện nào tới trước thì kết thúc. TTL là tuổi thọ của lệnh
     đang chờ/retry, **không** phải hẹn giờ hoàn tác giá trị register — slave đã
     ACK là lệnh hoàn tất. Force/override tạm thời là cơ chế khác, có lease/
     expiry riêng. Chi tiết ở
     [VERIFICATION.md §Vòng đời lệnh ghi](../05_verification/VERIFICATION.md).

  Không cấp ADR mới cho đợt này: cả bốn đều thu hẹp phạm vi về đúng ADR đang có
  hiệu lực (`REVA_SCOPE_ROADMAP` §3 vốn đã xếp OTA vào Rev B), không mở kiến trúc
  mới. Bất biến chống tái phát nằm ở
  `TestRouteTableMatchesOpenAPI`, `TestRevBSurfacesStayOutOfRevAContract` và
  `test_release_packaging_guard.py`.

## ADR-050 — Một Product Programming thống nhất, không chia Rev A/Rev B

**Trạng thái:** Accepted
**Ngày:** 2026-08-20
**Authority record:** `AUTH-PROG-2026-08-20-04`
**Người quyết định:** Phạm Đình Chương — Product Owner/CTO + System Architect

### Bối cảnh

Programming tồn tại đồng thời Product Spec hẹp theo profile một Program và một
candidate Program-centric. Plan 59 bản nháp tiếp tục chia việc thành Rev A/Rev B,
trong khi Owner xác nhận sản phẩm cần giao không có cách chia đó. Kết quả là
multi-Program, user `FUNCTION`/`FUNCTION_BLOCK`, Control Library, Published
Signal và Enable/Disable bị đẩy khỏi implementation dù là capability cốt lõi.

### Quyết định

1. MK-DDC-24 có **một** Product Programming authority tại
   `docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` v3.0. Mọi phân loại
   Programming “Rev A/Rev B” trước đây là lịch sử/migration, không còn quyết định
   phạm vi.
2. Product bắt buộc multi-Program, `PROGRAM/FUNCTION/FUNCTION_BLOCK` bằng ST/FBD,
   SYSTEM/PROJECT Control Library, Published Signal typed, Enable/Disable từng
   Program, per-Program RETAIN/diagnostics và full Output Candidate→physical I/O
   safety path.
3. Capacity Product Target: 32 Program/Revision, tối đa 16 Enabled, period
   `1/5/30 s`, 256 user POU, 1024 FB instance, 512 signal và 512 binding.
4. `FUNCTION` là pure/stateless/no I/O; `FUNCTION_BLOCK` có private state theo
   instance nhưng không có cycle/Point Mapping; chỉ `PROGRAM` sở hữu lifecycle,
   cycle, mapping, RETAIN, publish và output candidate.
5. Published Signal là runtime primitive single-publisher trên committed
   snapshot, không phải Point type thứ tư. Không shared writable memory.
6. Output binding dùng single Program owner; conflict bị Check reject. Disable
   rút candidate tại safe boundary; resolver/interlock/safe-state chọn giá trị
   tiếp theo.
7. Scheduler không tạo dependency theo creation/display order; fault/Disable một
   Program không mặc định dừng Program độc lập. Multicore là optimization giữ
   cùng semantics, không phải điều kiện để code single-core path.
8. Sáu workspace Product là Tổng quan, Chương trình, Điểm & Ánh xạ, Thư viện
   điều khiển, Kiểm tra & Đưa vào vận hành, Runtime & Bảo trì.
9. `TRACE_START` được implement bằng Core ring buffer bounded thay vì xóa khỏi
   Product contract. PID được implement trong registry nhưng chỉ quảng bá
   end-user-ready sau Controls/Safety evidence.
10. `PLAN_READY` và toàn bộ `IMPLEMENT_READY` được mở ngay. Review discipline là
    hậu kiểm và finding phải sửa trong task; không được dùng làm blocker code.
    `RELEASE_READY` không được waive: target/HIL/physical I/O/power/soak/
    provenance/rollback vẫn phải có evidence thật.

### Hệ quả và migration

- Product Spec candidate Hybrid được hợp nhất rồi loại khỏi cây; Git giữ đường
  phục hồi.
- `DDD-SW-PROG-UNIFIED-001` là design authority khi hồ sơ cũ xung đột.
- Profile/artifact/store/OpenAPI/IPC nâng version theo Plan 59; Core giữ dual
  reader artifact v1/v2 trong migration window.
- Package cũ một Program migrate thành Draft v2; không tự Commission. Active/LKG
  v1 tiếp tục rollback được tới khi v2 qua target gate.
- Plan 53/54/56 và Tracker trở thành hồ sơ lịch sử/superseded; Plan 59 là execution
  authority duy nhất.

### Rollback quyết định

Chỉ Product Owner có thể supersede ADR này bằng decision record mới. Rollback
code không được âm thầm thu hẹp Product Spec; nếu v2 fail, giữ active v1/LKG và
tiếp tục implementation/fix theo cùng Product Target.

## ADR-051 — TTL hold-last của Program là 60 giây đồng hồ

**Trạng thái:** Accepted
**Ngày:** 2026-08-21
**Hồ sơ đầy đủ:** [`docs/adr/ADR-051-programming-ttl-hold-last-60s.md`](../adr/ADR-051-programming-ttl-hold-last-60s.md)
**Người quyết định:** Phạm Đình Chương — Product Owner/CTO (chốt số theo đề xuất
kỹ thuật của lane implementation, phiên 2026-08-21)

### Bối cảnh

Cơ chế TTL hold-last có từ `TASK-PROG-401`, nhưng giá trị vẫn là `0` — giữ lệnh
cuối của một Program đã chết **vô thời hạn**. `0` trông như "chưa quyết định"
nhưng thực chất là quyết định "giữ mãi": van đứng ở vị trí cũ không vì ai ra lệnh
mà vì chương trình đã chết, và `FAULTED` là trạng thái chốt nên không có đường tự
hồi phục. `T59-406` đóng mọi mắt xích khác của chuỗi candidate; đây là mục duy
nhất còn treo, treo vì chữ ký chứ không vì mã.

### Quyết định

1. **TTL hold-last = 60 s**, đồng nhất mọi Program và mọi Point class.
2. TTL đo bằng **đồng hồ của tick** (`output_commit_now_ns`), không đếm vòng quét —
   đếm vòng quét chỉ xấp xỉ thời gian khi vòng lặp chạy đúng nhịp.
3. TTL đo **tuổi của lệnh**, không đo trạng thái: `FAULTED`, `ROLLED_BACK` và
   `RUNNING` trong Task bị disable đều nằm dưới cùng một trần.
4. `STOPPED`/`DISABLED` vẫn rút NGAY tại safe boundary.
5. `0` = tắt TTL chỉ còn dùng cho test/chẩn đoán; bootstrap luôn mang số đã ký,
   cờ `--program-hold-ttl-ms` từ chối `0` và giá trị vượt trần 600 s.
6. Hỏi "khoá theo Point class" được **đóng**, không hoãn: đích rơi về đã theo từng
   điểm (`default` của chính điểm đó), thêm TTL theo class là thêm núm thứ hai cho
   cùng một kết quả.

### Cơ sở của con số

Chặn dưới là `2x` chu kỳ Task chậm nhất của profile (2×30 s) — lệnh cuối lúc
Program chết đã có thể già trọn một chu kỳ, TTL nhỏ hơn thì thời gian giữ thực tế
trôi xuống tận 0. Chặn trên là dải fail-safe quen thuộc của thiết bị BAS
(10..60 s) và hằng số thời gian nhiệt của tải (phút trở lên). 60 s là điểm thoả cả
hai chặn; ràng buộc `2x` được `static_assert` canh theo `allowedPeriodMs` của
profile nên profile đổi sẽ gãy build, không gãy ngoài hiện trường.

### Hệ quả

- Đóng hàng "Hold TTL … chưa ký" ở `DDD-CTRL-PROG-001` §15 (phần Hold TTL; PID set
  và capacity vẫn mở). Hàng "Safety interaction chưa có HIL evidence" KHÔNG đổi.
- `RSK-PROG-002` gỡ được mục treo TTL; evidence hiện là host/local, target/HIL vẫn
  nợ.
- Số nằm ở `core::st_hold_ttl` chứ không ở `product_profile_v2.json`: SHA-256 của
  profile bị ghim trong mọi build manifest artifact và `g1_contract_join_v1.json`,
  đặt hẹn giờ an toàn ở đó sẽ biến mỗi lần chỉnh thành sự kiện tương thích
  artifact trong khi không artifact nào phụ thuộc nó.

ADR Accepted mới nhất: [`ADR-052`](../adr/ADR-052-programming-ky-artifact-bang-khoa-thiet-bi.md).
ADR được cấp mới nhất: [`ADR-053`](../adr/ADR-053-programming-simulation-worker-cach-ly.md)
ở trạng thái **Proposed**. Số ADR tiếp theo còn trống: **`ADR-054`**.
