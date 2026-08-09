# Phản biện — Programming Product Spec v2.0 và UI/UX/UC Design v2.0

**Mã:** `AUDIT-PROGRAMMING-CRITIQUE-2026-08-09`
**Ngày review:** 2026-08-09
**Đối tượng:**
- `docs/CHUONG_YEU_CAU/PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md` (DDC24-PRG-PRODUCT-SPEC-001, v2.0, 2026-08-08)
- `docs/CHUONG_YEU_CAU/PROGRAMMING_UI_UX_UC_DESIGN_MK-DDC-24.md` (DDC24-PRG-UX-DESIGN-001, v2.0, 2026-08-08)

**Phân loại:** RECORD tại ngày chụp. Không thay Requirement/Design/Verification baseline.
**Nền đối chiếu:** `PROD-PROG-001`, `REQBASE-PROG-001`, `CONFREG-PROG-001`, `PROG-OD-001-AUD`,
`AUDIT-PROGRAMMING-IMPL-2026-08-08`, ADR-020/023/024, `PRODUCT_DEFINITION_MK-DDC-24_VI.md`,
`REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md`, `contracts/openapi/openapi.yaml`, source `apps/`.

---

## 0. Kết luận điều hành

Hai tài liệu **tốt về hướng sản phẩm**: tách BACS workflow khỏi compiler internals, cấm
overclaim chứng nhận, tách Engineering Diagnostics khỏi Alarm, cấm optimistic Active, cấm
fake data. Ba điểm này đáng giữ nguyên.

Nhưng ở dạng hiện tại **không được duyệt làm baseline**, vì ba lý do:

1. **Chúng là bộ Product Spec thứ hai cho cùng một module**, không tuyên bố supersede bộ
   đang Active (`PROD-PROG-001`, hiệu lực 2026-08-03) và bộ audit chuẩn hóa ngày
   2026-08-08 — tạo lại đúng `CONF-PROG-001` vừa được dọn xong.
2. **Chúng mâu thuẫn với các contract đã đóng băng và đã ship**: mức priority của Local
   logic, allowlist Point, định dạng canonical Point ID, allowlist cycle 1/5/30 s, danh
   sách cắt của Rev A roadmap, nguồn chân lý của scan period trên bo.
3. **Chúng bỏ trống đúng những chỗ quyết định sinh tử của một DDC**: chương trình ghi ở
   mức priority nào, thua ai; output có bumpless khi Commission không; graph runtime đang
   chạy trên bo bị xử lý ra sao.

Tổng: **33 finding** — 10 P0, 17 P1, 6 P2.

> **Đính chính 2026-08-09:** dòng tổng ở bản đầu ghi `24 finding — 8 P0, 11 P1,
> 5 P2` là lỗi cộng; inventory theo ID (`PB-A-01..05`, `PB-B-01..08`,
> `PB-C-01..07`, `PB-D-01..04`, `PB-E-01..06`, `PB-F-01..03`) có **33 mục**:
> 10 P0, 17 P1, 6 P2. Danh sách finding không đổi, chỉ số tổng sai.

---

## 1. Nhóm A — Quyền tài liệu và truy nguyên

### PB-A-01 (P0) — Product Spec thứ hai cho cùng module, không supersede bản Active

`docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` (`PROD-PROG-001`, Active, hiệu lực
2026-08-03) và bản controlled copy trong bộ audit đang là Product authority. Tài liệu mới
đặt ID riêng `DDC24-PRG-PRODUCT-SPEC-001`, tự nhận "Draft for PM/Architecture Review",
nhưng không có mục Supersedes/Amends, không nêu tài liệu nào bị thay, không sửa
`00_DOCUMENT_CONTROL.md` hay `01_DOCUMENT_REGISTER.md`.

Hệ quả: hai Product Spec cùng chủ đề, cùng Rev A, khác thuật ngữ normative
(Deployment/Activation ↔ Commission), cùng tồn tại. Đội FE/BE/FW không có cách xác định
bản nào thắng.

**Sửa:** thêm mục `Supersedes/Amends` chỉ đích danh `PROD-PROG-001` + các mục bị thay,
hoặc hạ cấp tài liệu mới thành *proposal* đầu vào cho một ADR, rồi mới sửa Product Spec
Active. Không giữ hai bản song song.

### PB-A-02 (P0) — Không gian ID mới hoàn toàn, không map sang baseline

Tài liệu mới dùng `PRG-BACS-*`, `PRG-IEC-*`, `PRG-RT-*`, `PRG-PT-*`, `PRG-COM-*`,
`PRG-SEC-*`, `PRG-UX-*`, `PGM-01..06`, `UC-01..16`, `OD-01..12`.
Baseline dùng `PC-PROG-001..012`, `PR-PROG-001..014`, `SYS/SWR/IF/NFR-REQ-PROG-*`,
`FSP-PROG-001..009`, `VR-PROG-001..013`, `OD-PROG-001..015`.

Không có một dòng ánh xạ nào. `07_traceability/00_PROGRAMMING_TRACEABILITY_MATRIX.md`
không thể nuốt bộ ID mới; toàn bộ evidence chain đứt.

**Sửa:** bảng traceability hai chiều `PRG-* ↔ PR-PROG-*/SWR-REQ-PROG-*/VR-PROG-*` là điều
kiện tiên quyết để review, không phải việc làm sau.

### PB-A-03 (P0) — Open Decision trùng lặp, đánh số lại, và mở lại thứ đã chốt

`OD-01..OD-12` (Product Spec §31) và 12 câu hỏi UX §47 lặp lại `OD-PROG-001..015` nhưng
đánh số khác và **thiếu** các mục đang mở quan trọng: `OD-PROG-013` (migration graph
28-node), `OD-PROG-015` (product approval/readiness gate).

Nặng hơn: `OD-01 "Exact ST subset/type/loop profile"` và `OD-02 "DDC Task period
ranges/presets"` mở lại thứ mà `SWR-REQ-PROG-006` đã normative hóa (chỉ 1 s, 5 s, 30 s) và
`VR-PROG-013` đã yêu cầu test phủ định. Một Open Decision không được phép làm yếu một
requirement đã baseline (quy tắc ghi ngay trong `REQBASE-PROG-001` §1).

**Sửa:** xóa OD trùng, chỉ trỏ về `PROG-OD-001-AUD`; mục nào muốn mở lại phải đi qua ADR.

### PB-A-04 (P1) — Trích dẫn ADR sai

Product Spec dòng 13 và §30.1 ghi nguồn quyết định ST+FBD Rev A.0 là **"ADR-018/ADR-020"**.
`docs/adr/ADR-018-sqlite-block-historian.md` là ADR về **SQLite block historian**, không
liên quan Programming. UX §46 lặp lại đúng lỗi này.

Thiếu các ADR thực sự chi phối: **ADR-023** (scheduler v3.1 — priority, target, capacity),
**ADR-024** (Modbus RTU Point, Accepted 2026-08-05 — quyết định allowlist Point), **ADR-004**
(bị ADR-020 supersede), **ADR-005** (three-process), **ADR-021** (restructure).

Ghi chú kèm: ADR-024 hiện **không có file** trong `docs/adr/`, chỉ tồn tại như một dòng
trong `docs/00_governance/DECISIONS.md:34`. Đây là lỗi tồn đọng của repo, nhưng tài liệu
mới lệ thuộc nó (allowlist Point) nên phải xử lý cùng.

### PB-A-05 (P1) — Claim "đã review catalogue IEC/ISO" không có evidence record

Cả hai tài liệu ghi "Official catalog/webstore baselines reviewed 2026-08-08" kèm 13 số
hiệu/năm phát hành (IEC 61131-3:2025 Ed.4, ISO 16484-2:2025, ISO 16484-4:2025,
ISO 9241-115:2024, ISO 9241-171:2025...). Trong repo không có evidence record nào: không
link catalogue, không ngày truy xuất từng mục, không ai ký.

Đây đúng loại claim mà `CONF-PROG-014` cảnh báo. Bản thân tài liệu cấm overclaim
certification nhưng lại tự tạo một claim không kiểm chứng được ở tầng dưới (edition/năm).

**Sửa:** một evidence record liệt kê từng standard + URL catalogue + ngày truy xuất +
người xác nhận; mục nào chưa xác minh phải ghi `UNVERIFIED`.

---

## 2. Nhóm B — Mâu thuẫn với contract đã đóng băng / đã ship

### PB-B-01 (P0) — Bỏ trắng mức priority của chương trình: Local logic = mức 5/6

`PRODUCT_DEFINITION_MK-DDC-24_VI.md` §13 đã đóng băng resolver 6 mức:
`1 Fire/Safety → 2 Local manual → 3 BACnet → 4 Schedule → 5 Local logic → 6 Default`.
`contracts/openapi/openapi.yaml:3120` phơi `overridden_by` với đúng enum
`FIRE_SAFETY | LOCAL_MANUAL | BACNET | LOCAL_LOGIC`.

Nghĩa là: **logic do người dùng lập trình đứng mức 5, thua Schedule, thua BACnet, thua một
lệnh Local manual chưa release.** Cả Product Spec (`PRG-RT-002` "staged, arbitrated and
committed once") lẫn UX (§12.2 hiển thị `Valve 41% GOOD`) **không hề nhắc tới điều này**.

Hệ quả cụ thể trên máy thật:
- Kỹ sư Commission xong một vòng SAT control, van không nhúc nhích vì còn override thủ
  công mức 2 từ hôm trước. Trang Runtime & Service theo thiết kế hiện tại hiển thị
  "RUNNING / GOOD" — đúng nghĩa FE-DIAG-01 mà contract Scheduler đã bị bắt lỗi và đã sửa.
- Không có yêu cầu nào bắt runtime trả về cho chương trình biết output của nó **không có
  hiệu lực** → PID mức 5 thua mức 4 sẽ windup vô hạn.

**Sửa (bắt buộc trước khi duyệt):**
1. Requirement: mỗi output binding phải phơi `written_value` / `actual_value` /
   `overridden_by` / `effective_priority`, đúng mô hình Scheduler đã có.
2. UX: Online Watch và Points & Mapping phải có cột "đang bị giữ bởi" — không phải chi
   tiết nâng cao.
3. Requirement: runtime phải feedback trạng thái arbitration về program (chống windup),
   hoặc nêu rõ chính sách anti-windup thay thế.
4. Acceptance §29 và gate G6 phải có kịch bản "program thua arbitration".

### PB-B-02 (P0) — Allowlist Point bị nới, trái `PR-PROG-003`/`PR-PROG-014`

Product Spec §13.1 liệt kê nguồn Point gồm "Modbus points" (không phân biệt RTU/TCP),
"Future BACnet/object producers khi contract có", "Approved scheduler/derived references".

Baseline: `PR-PROG-003` + `SWR-REQ-PROG-004` chỉ cho **Local Physical I/O, Virtual Point,
Modbus RTU Point**; `PR-PROG-014` + `SYS-REQ-PROG-001` bắt **từ chối Modbus TCP Point và
BACnet/IP Point**; `VR-PROG-013` là test phủ định cho đúng việc này. Rủi ro không lý
thuyết: `AP-FE-004` đã ghi nhận validator demo hiện tại vẫn duyệt nhánh `modbus.tcp`.

**Sửa:** viết đúng ba loại, ghi rõ "Modbus **RTU**", bỏ "future BACnet producers" khỏi mục
nguồn Point Rev A (để ở Roadmap), và định nghĩa "scheduler/derived references" là *tham
chiếu đọc*, không phải Point nguồn.

### PB-B-03 (P0) — Point ID trong wireframe không tồn tại trong contract

UX §9.2 và §13.2 dùng `UI-01`, `AO-01`, `VP-12`, `VP-21`, **`MB-042`**.
Contract canonical: `openapi.yaml:3463` →
`^((UI|AO|DO)-[0-9]{2}|(VP|AV)-?[0-9]{1,3})$`. Modbus RTU Point dùng **không gian ID
riêng**: `ModbusRTUPoint.point_id` = `^[A-Za-z][A-Za-z0-9_-]{0,22}$`, định danh qua
Bus→Device→Point (ADR-024).

`MB-042` không hợp lệ ở cả hai schema. Đồng thời `IF-REQ-PROG-001` yêu cầu "RTU Point
không thể nhầm TCP Point" — bảng mapping trong UX không có cột category/bus/device nào để
phân biệt.

**Sửa:** dùng ID thật trong mọi wireframe; thêm cột `category` (LOCAL/VP/MB-RTU) +
`device` cho hàng Modbus; nêu rõ Programming định danh Modbus Point bằng
`{device_id, point_id}` chứ không bằng một chuỗi phẳng.

### PB-B-04 (P0) — Bỏ sót kind AV/BV/MSV và ma trận type ↔ point kind

`openapi.yaml:3058-3070`: point kind ghi được là `AO, DO, AV, BV, MSV, EXT`; AO/DO qua
resolver, AV/BV/MSV ghi thẳng point table, EXT là Modbus RTU; ceiling `AO<=4, DO<=4,
AV<=32, BV<=16, MSV<=8, EXT<=256`; type không tương thích trả `SCH-TARGET-003`.

Product Spec §12.1 chỉ có BOOL/int/REAL/TIME, `ENUM nếu approved`. **MSV (multi-state)
không có kiểu IEC tương ứng nào được chốt**, mà `PRG-PT-002` lại bắt "validate
type/direction/writable/unit policy". Không có ma trận thì không implement được.

**Sửa:** thêm ma trận `IEC type × point kind × direction → hợp lệ/lỗi`, tái dùng mã lỗi và
ceiling đã có của ADR-023 thay vì phát minh lại.

### PB-B-05 (P1) — Cycle time: mở lại allowlist 1/5/30 s

`SWR-REQ-PROG-006` + `SYS-REQ-PROG-001`: scheduler **chỉ** nhận 1 s, 5 s, 30 s.
`CONF-PROG-003` ghi rõ 50..60000 ms của component chỉ có thể là internal tick.
Tài liệu mới: §9.2 "Allowed range/preset là backend/runtime authority", UX §10.3 "Allowed
cycle lấy từ backend/runtime policy", `OD-02` mở, và UX §10.2 ví dụ hiển thị `1 s`, `5 s`.

Ba nguồn nói ba kiểu, và không nguồn nào nhắc 30 s.

**Sửa:** ghi thẳng `1 s | 5 s | 30 s` trong cả hai tài liệu; nếu muốn đổi thì phải qua ADR
và cập nhật `VR-PROG-006`.

### PB-B-06 (P1) — Multi-task và capacity mâu thuẫn `CONF-PROG-010`

§27 Gap Matrix ghi `Multi-task | Missing | Required per approved DDC scheduler profile`;
UX §10.2 vẽ 2 Task. Nhưng `CONF-PROG-010` nói rõ con số 8 task / 16 program per task / 32
tổng của component **không được đưa vào Product baseline** khi chưa có quyết định
(`OD-PROG-003/004`). Tài liệu mới yêu cầu multi-task là "Required" mà không có số, không
có ADR — biến một OPEN-DESIGN thành cam kết sản phẩm.

### PB-B-07 (P1) — Trái danh sách cắt của `REVA_SCOPE_ROADMAP` §3, không supersede

Roadmap Rev A.0 đang cắt sang Rev B:
- dòng 76: `Wiresheet/canvas đầy đủ (React Flow) → Rev B` — trong khi UX §8.6/§15 yêu cầu
  FBD canvas đầy đủ (drag block, snap grid, zoom, inspector) ở Rev A.0.
- dòng 78: `Math nâng cao (Average/Min/Max/LowPass) → Rev B` — Product Spec §11.1 đưa
  `min/max/average` vào Core Library Rev A.
- dòng 79: `StageControl / LeadLag / SequenceStep → Rev B` — UX §7.2 lấy `Pump Lead/Lag`
  làm ví dụ application đang chạy.
- dòng 81: `Audit log đầy đủ, component versioning → Rev B` — `PRG-SEC-003` và §11.3
  (library version) đặt cả hai vào Rev A.

Roadmap dòng 85 chỉ đưa "ST+FBD Program Runtime" vào Rev A. Chưa ai supersede các dòng
76/78/79/81.

Hệ quả đã hiện trên sản phẩm: `apps/web-ui/src/app/App.tsx:141-144` vẫn nói với người dùng
"The block-diagram programming canvas is **Rev B scope per REVA_SCOPE_ROADMAP §3**" — đúng
finding `AP-FE-001`, vẫn chưa sửa.

**Sửa:** một ADR duy nhất chốt lại danh sách cắt của Rev A, rồi sửa roadmap + copy FE
trong cùng phiên. Không để tài liệu mới ngầm phủ định roadmap.

### PB-B-08 (P0) — Bỏ qua graph runtime đang chạy production và quyền sở hữu scan period

`apps/core/bootstrap/main.cpp:72,185-194`: `mkddc-core` production nạp
`/data/config/graph.json` vào `GraphRuntime`, và **chu kỳ scan của core lấy từ
graph.json** khi không có `--scan-ms`. `apps/core/application/runtime/scan_loop.hpp:52`
vẫn `StScheduler* st_sched = nullptr`.

Nghĩa là hôm nay trên bo: logic điều khiển = graph runtime, scan period = graph.json.
Hai tài liệu mới:
- §6.1 liệt kê AS-BUILT substrate **không nhắc graph runtime một chữ nào**;
- đặt Task/cycle thuộc quyền Programming, xung đột trực tiếp với chủ sở hữu scan period
  hiện tại;
- §42 (UX) chỉ nói "Legacy Graph → migration → FBD", không nói **hai runtime có cùng tồn
  tại không**, ai thắng ở mức 5, và cutover thế nào (`OD-PROG-013` vẫn OPEN).

Đây là rủi ro triển khai lớn nhất của cả bộ tài liệu: activate một application package
mới trên một bo đang chạy graph.json mà không có chính sách cutover là một sự cố điều
khiển, không phải một lỗi UX.

**Sửa:** một mục "Cutover graph → Programming" với 3 trạng thái (graph-only, program-only,
từ chối cùng lúc), quyền sở hữu scan period sau cutover, và hành vi khi `graph.json` còn
tồn tại lúc Commission.

---

## 3. Nhóm C — Thiếu sót kỹ thuật điều khiển

### PB-C-01 (P0) — Không có chính sách bumpless khi Commission / Restore

§16 và §19 mô tả "Atomic Activate at safe boundary", "không partial output", nhưng không
có một dòng nào về **giá trị output trong và sau thời điểm chuyển**. Với HVAC:
- FB PID/timer/counter instance mới khởi tạo → integrator = 0 → van từ 41% nhảy về 0%;
- UC-13 nói "affected retained values will be initialized" như một thông báo, không như
  một rủi ro vận hành.

**Sửa:** requirement "activation output continuity": hold-last / ramp / safe default, chọn
một, có cấu hình theo Application Function; và kịch bản HIL đo bump thực tế ở G6.

### PB-C-02 (P1) — Commissioning Engineer không có công cụ để commission

Persona Commissioning Engineer (§22.1, UX §2.1) cần "verify point/output behavior", nhưng
`SWR-REQ-PROG-010` và UX §14/§16 khóa Online Monitor ở read-only, cấm write/force. Sản
phẩm đã có module Commissioning riêng (`Chạy thử`) với override + `ttlS` +
`overrideExpiresInS` (openapi `PUT /points/{id}`). Hai tài liệu không hề nối vào đó.

**Sửa:** nêu rõ đường đi: verify output = module Commissioning hiện có (mức 2 Local
manual), kèm cảnh báo override còn treo sẽ che output của program (nối với PB-B-01).

### PB-C-03 (P1) — Không có capability diff/compare nhưng UX bắt buộc phải có

UX §11.3 yêu cầu Commission hiển thị "2 Programs modified / 1 Point binding changed /
0 Task cycle changed" và §11.3 highlight `AO-01 binding: Valve_1 → Cooling_Valve`. Đây là
một **revision diff engine**. Product Spec §23 "Required capability" **không có** mục
diff/compare; §24.1 còn cố ý bỏ "Compare" khỏi primary page.

**Sửa:** thêm capability `revision diff (source / mapping / task / library)` vào §23, hoặc
hạ yêu cầu UX xuống mức "danh sách đối tượng thay đổi" và nói rõ ai tính.

### PB-C-04 (P1) — Không có multi-user / locking

Thiết bị có nhiều user (module Users). Không có state `lockedBy`, không có chính sách khi
hai admin cùng sửa một Draft, không có xử lý "người khác vừa Commission trong lúc bạn
đang sửa". UX §34 state model thiếu hoàn toàn trục này.

### PB-C-05 (P1) — Mô hình signature tự ký trên chính thiết bị: threat model sai

§17.3 nói integrity/signature "tiến gần IEC 62443 system integrity/use-control
expectations". Nhưng theo ADR-005/ADR-020, compiler và Program Service chạy **trên chính
SOM**. Thiết bị tự build, tự ký, tự verify → chữ ký chứng minh **toàn vẹn lưu trữ**, không
chứng minh **nguồn gốc**; kẻ chiếm được BE ký được mọi thứ.

**Sửa:** ghi thẳng threat model ("bảo vệ chống corrupt/partial write và load artifact lạ;
KHÔNG bảo vệ chống BE bị chiếm"), và tách `OD-06` thành hai câu hỏi: khóa ký ở đâu (device
key vs khóa phát hành có HSM — nối `project_hsm_evaluation_iot5580`), và verify ở đâu.

### PB-C-06 (P2) — Signature reject là sự kiện an ninh, không chỉ diagnostic

UX §20 xếp "Candidate signature reject trước active" = Engineering Diagnostics, Alarm ❌.
Đúng về mặt IEC 62682 (không phải process alarm), nhưng thiếu vế còn lại: đây là sự kiện
**security audit** bắt buộc theo IEC 62443-4-2. Bảng nên có cột thứ ba: `Security audit
event`.

### PB-C-07 (P2) — TIME/RTC/DST không được nói tới

Kiểu `TIME`, timer FB, schedule reference đều phụ thuộc đồng hồ. Không có yêu cầu nào về
hành vi khi RTC nhảy, NTP sync, hay đổi timezone/DST — trong khi Scheduler v3.1 đã phải
giải quyết đúng bài này và có sẵn contract để tái dùng.

---

## 4. Nhóm D — Mâu thuẫn nội tại trong chính hai tài liệu

### PB-D-01 (P1) — Bảng IA và danh sách UC từng trang không khớp; UC-13 mang hai nghĩa

| Nguồn | PGM-01 | PGM-03 | PGM-04 | PGM-05 | PGM-06 |
|---|---|---|---|---|---|
| UX §4.1 (bảng IA) | 01, 09, 10 | 05, 06 | 04, 07 | 08, 09, 11 | 10, 11, 12, 13 |
| Mục từng trang | §7.4: +12 | §9.6: +11 | §10.7: +12, +14 | §11.9: +13 | §12.7: +01 |

Nặng nhất:
- UX §9.6 ghi `UC-11 Functional Documentation / As-built` — nhưng catalog §21 định nghĩa
  **UC-11 = Restore Previous Version**; cái được mô tả là **UC-15**.
- UX §12.7 ghi `UC-13 Runtime failure/safe-state` — catalog định nghĩa **UC-13 = Retained
  State Incompatible**; cái được mô tả là **UC-16**.

Không thể build test plan từ một catalog mà cùng một mã chỉ hai use case khác nhau.

### PB-D-02 (P1) — UC Priority mâu thuẫn Definition of Done

§22 xếp UC-02 (Application Function), UC-14 (BACS Library), UC-15 (as-built record) là
"Competitive", **không** Release Critical. §45 DoD lại bắt buộc "Application Function model
visible" và "functional/as-built record available" mới được Done. Vậy chúng là bắt buộc
hay không? Đồng thời UC-16 nằm trong Release Critical nhưng không có trong bảng IA §4.1.

### PB-D-03 (P1) — Signature: bốn phát biểu mâu thuẫn về cùng một thứ

- §5.1 (trong phạm vi): "Integrity verification + target signature **design**" — chỉ thiết kế.
- §16.3: "signature policy pass" là **điều kiện Commission thành công**.
- §27 Gap Matrix: `Package signature | Missing | Required **hardened release**` — không
  phải Rev A.0.
- §28 G4 + §29 kịch bản 6 + UX §44 E2E: bắt buộc reject signature invalid ở Rev A.0.

RETAIN mắc đúng bệnh này: §5.1 ghi điều kiện `"khi implementation milestone hoàn tất"`
(phạm vi có điều kiện = không phải phạm vi), §27 ghi `Required milestone`, nhưng UC-13 là
Release Critical và G6 bắt test retain.

**Sửa:** mỗi capability chỉ được có **một** trạng thái phạm vi Rev A.0: IN hoặc OUT. Nếu
IN thì phải có VR tương ứng; nếu OUT thì phải rút khỏi G4/G6/§29/UC critical.

### PB-D-04 (P2) — Tham chiếu milestone không định nghĩa

§23 "Không khóa endpoint cụ thể trước **C0.9**". Chuỗi milestone C0.x không được định
nghĩa trong tài liệu, và `IFSPEC-PROG-001` mới là nơi đang giữ interface authority.

---

## 5. Nhóm E — UX và khả dụng

### PB-E-01 (P0) — Ngữ nghĩa "Controller OFFLINE" sai với kiến trúc one-box

UX §12.6, UC-10 và §37 thiết kế trạng thái "Controller OFFLINE / Draft edit may continue /
Commission disabled" trên **mọi trang**. Nhưng theo ADR-005, `mkddc-web` (phục vụ chính
cái UI này) chạy **trên chính controller**. Nếu controller offline thật thì trình duyệt
không tải được trang Programming, không có gì để hiển thị.

Trạng thái có thật của sản phẩm là: **web sống, core DEGRADED/không phản hồi IPC** — đúng
tình huống đã gặp trên bo. Đó mới là cái UX cần vẽ, kèm câu hỏi kế tiếp mà tài liệu không
trả lời: Draft lưu ở đâu khi core chết (UX §47.11 vẫn để mở, trong khi UC-10 lại là
Release Critical).

**Sửa:** đổi từ vựng trạng thái thành `core: RUNNING / DEGRADED / UNREACHABLE`, `web:
reachable` (hiển nhiên), và chốt nơi lưu Draft trước khi đóng UC-10.

### PB-E-02 (P1) — Toàn bộ copy UI bằng tiếng Anh, trái sản phẩm đã ship và trái quy tắc dự án

`apps/web-ui/src/shared/i18n.tsx` là bộ copy **tiếng Việt trước** (`programming: 'Lập
trình'`, `commissioning: 'Chạy thử'`). Tài liệu UX viết toàn bộ chuỗi giao diện bằng tiếng
Anh (`Commission Changes`, `Restore Previous`, `No control application has been
commissioned.`, `Changes are not ready to commission.`) và không có mục i18n key nào.

Kèm theo là một va chạm thuật ngữ thật: sản phẩm **đã** có module `Chạy thử`
(Commissioning) ở Engineering; nay Programming lại đặt một trang tên `Commission`. UX
§47.12 để câu hỏi này mở, nhưng nó đã bị i18n đang chạy trả lời một nửa rồi.

**Sửa:** bảng copy VI/EN có i18n key cho mọi chuỗi trong tài liệu; chọn từ tiếng Việt cho
PGM-05 **khác** "Chạy thử" (ví dụ "Đưa vào vận hành" / "Nạp xuống bộ điều khiển").

### PB-E-03 (P1) — Accessibility tự mâu thuẫn ở FBD

§30 viết `no mouse-only required action ngoài FBD canvas; FBD có alternate inspector/tree
access` — tức là miễn trừ đúng chức năng authoring chính khỏi yêu cầu bàn phím, trong khi
§1.3/§30 vẫn treo alignment ISO 9241-171.

**Sửa:** hoặc đặc tả đường bàn phím đầy đủ cho FBD (thêm block, chọn pin, nối dây, xóa
dây, điều hướng theo thứ tự thực thi), hoặc ghi thành **limitation có chủ ý** kèm lý do và
rút claim 9241-171 cho trang đó.

### PB-E-04 (P2) — Không nói gì về HMI cục bộ

Sản phẩm có `apps/hmi` (LVGL, có i18n riêng, ADR-009 ISA-101). Programming có xuất hiện
trên panel không? Nếu không thì phải ghi là loại trừ phạm vi có chủ ý; §31 chỉ nói
breakpoint desktop.

### PB-E-05 (P2) — Chưa có catalog mã lỗi

UX §11.6 dùng ví dụ `PRG-MAP-004` nhưng không có catalog; Product Spec §26.4 lại yêu cầu
"stable error codes". Sản phẩm đã có tiền lệ (`SCH-TARGET-003`, `SEC-*`, `ModbusQuality
CONFIG_ERROR`). Không có catalog thì `IF-REQ-PROG-002` "stable error result" không kiểm
được.

### PB-E-06 (P2) — Thiếu use case thay thế thiết bị

Persona Service Technician được giao "replacement/recommission" (§22.1) nhưng không có UC,
không có requirement export/import project sang controller thay thế, và G6 không test. Với
BACS đây là kịch bản dịch vụ cơ bản.

---

## 6. Nhóm F — Khả năng kiểm chứng

### PB-F-01 (P1) — Không có một con số nào trong toàn bộ NFR

§26 liệt kê tính chất định tính ("bounded compiler input", "bounded runtime") nhưng không
có: giới hạn kích thước source, số biến, số block FBD, độ sâu biểu thức, thời gian Check,
tần suất refresh monitor, dung lượng trace, WCET budget theo cycle. §10.2 nói "Limits phải
explicit" rồi không cho giá trị nào.

Hệ quả: **G5 và G6 không thể pass/fail được**, và `VR-PROG-006` (đo jitter/WCET) không có
ngưỡng để so.

### PB-F-02 (P1) — Requirement viết ở dạng không kiểm chứng, không gắn phương pháp

`PRG-UX-001 "shall use BACS terminology rather than compiler terminology"`,
`PRG-BACS-001 "shall support traceability"` — không có tiêu chí đạt, không cột verification
method, không map `VR-PROG-*`. `REQBASE-PROG-001` §1 đã đặt chuẩn ngược lại: "phải" là
nghĩa vụ **kiểm chứng được**.

### PB-F-03 (P1) — Gate G0 tự tuyên bố "Locked" trong khi thực trạng là 0/12 và VR toàn RED

G0 ghi "Standards & Product Model **Locked**", §32 ghi "Chốt hướng Rev A.0". Nhưng
`AUDIT-PROGRAMMING-IMPL-2026-08-08` kết luận `0/12 capability COMPLETE`, `VR-PROG-001..013
= RED`, `OD-PROG-015` (product approval) vẫn OPEN, và `CONFREG-PROG-001` §3 cấm phê duyệt
Programming Design / khóa API / chuyển gate sang GREEN khi OD chưa đóng.

Một tài liệu Draft không tự nâng được gate của mình.

---

## 7. Phản biện hướng sản phẩm (không phải lỗi, là rủi ro cần quyết)

1. **"DDC-first" đúng, nhưng Application Function là khái niệm thứ 4 chồng lên
   Project/Program/POU.** Người dùng nay phải hiểu Application Function → Program →
   Task → Point, trong khi mục tiêu tuyên bố là *giảm* khái niệm. Nên cân nhắc:
   Application Function là **view/tag nhóm** trên các đối tượng đã có, không phải một
   entity lưu trữ thứ tư. Nếu là entity thật thì phải có schema, capacity và migration —
   `OD-03` hiện để trống.
2. **Gộp Runtime + Service + History + Trace + Previous Versions vào một trang (PGM-06)**
   là gộp bốn nhiệm vụ khác nhau để giữ con số "6 trang". Con số trang không phải mục
   tiêu; ISO 9241-115 nói về điều hướng phù hợp nhiệm vụ, không nói ít trang là tốt.
3. **Phạm vi Rev A.0 vẫn quá rộng so với thực trạng.** ST chưa nối scan loop, FBD chưa có
   compiler, BE chưa có bất kỳ authority nào. Bộ tài liệu thêm vào: Application Function
   model, BACS Control Library, functional documentation/as-built, diff engine, signature,
   RETAIN, multi-task. Nếu phải cắt, thứ tự cắt hợp lý là: BACS Library (giữ Core), export
   as-built, multi-task — giữ lại ST → mapping → Check → Commission → LKG → monitor, vì đó
   mới là đường sống của sản phẩm.
4. **Điểm cạnh tranh số 1 đang bị bỏ trống.** §32 liệt kê 7 điểm mạnh nhưng không có điểm
   nào nói về thứ mà đối thủ (Distech, Delta, Niagara) làm dở nhất và bo này làm được:
   commissioning + arbitration transparency trên cùng một thiết bị. Đó chính là PB-B-01 —
   biến điểm yếu đang bị bỏ sót thành tính năng bán hàng.

---

## 8. Việc phải làm trước khi tài liệu được đưa ra review

| # | Việc | Chặn bởi |
|---|---|---|
| 1 | Tuyên bố quan hệ với `PROD-PROG-001`: supersede hay proposal | PB-A-01 |
| 2 | Bảng traceability `PRG-* ↔ PR/SWR/VR-PROG-*` | PB-A-02 |
| 3 | Xóa `OD-01..12`, trỏ về `PROG-OD-001-AUD` | PB-A-03 |
| 4 | Sửa trích dẫn ADR (bỏ ADR-018; thêm 023/024/005) | PB-A-04 |
| 5 | Bổ sung mục Priority & Arbitration (mức 5, `overridden_by`, anti-windup) | PB-B-01 |
| 6 | Sửa allowlist Point về đúng 3 loại; sửa ID trong wireframe | PB-B-02, PB-B-03 |
| 7 | Ma trận type × point kind (gồm AV/BV/MSV/EXT) | PB-B-04 |
| 8 | Ghi cứng cycle 1/5/30 s | PB-B-05 |
| 9 | Mục cutover graph.json → Programming + quyền sở hữu scan period | PB-B-08 |
| 10 | Chính sách bumpless khi Commission/Restore | PB-C-01 |
| 11 | Giải mâu thuẫn phạm vi signature và RETAIN (IN hoặc OUT) | PB-D-03 |
| 12 | Sửa đánh số UC (UC-11/13/15/16) và bảng IA | PB-D-01 |
| 13 | Đổi mô hình trạng thái offline sang core DEGRADED/UNREACHABLE | PB-E-01 |
| 14 | Bảng copy VI/EN + đặt lại tên tiếng Việt cho PGM-05 | PB-E-02 |
| 15 | Điền số cho NFR/limits | PB-F-01 |
| 16 | Hạ G0 khỏi "Locked" cho tới khi OD-PROG-015 đóng | PB-F-03 |

Ngoài phạm vi tài liệu nhưng phát hiện cùng lúc, cần xử lý riêng:

- `docs/adr/` thiếu file ADR-024 dù đã Accepted 2026-08-05 (chỉ có dòng trong `DECISIONS.md:34`).
- `apps/web-ui/src/app/App.tsx:141-144` vẫn nói FBD là Rev B — finding `AP-FE-001` chưa đóng.

---

## 9. Rà soát vòng 2 — proposal v2.1 (2026-08-09)

**Đối tượng:** `PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md` v2.1 và
`PROGRAMMING_UI_UX_UC_DESIGN_MK-DDC-24.md` v2.1.

### 9.1 Trạng thái 33 finding vòng 1

Đã xử lý ở mức tài liệu: **33/33**. Các sửa đổi nặng ký nhất được kiểm chứng
thật, không phải chỉ đổi chữ:

- `PB-B-01`: §14.4 nêu đúng bậc `1 Fire/Safety → … → 5 Local logic → 6 Default`,
  bắt buộc `written_value/actual_value/overridden_by/effective_priority`, và UX
  §12.2 đã sửa ngay trong wireframe (`Valve yêu cầu 41% / Thực tế 62% • bị
  LOCAL_MANUAL giữ • còn 04:32`). Đây là finding nặng nhất vòng 1 và đã vào tận
  wireframe, không chỉ prose.
- `PB-B-03`: `MB-042` bị thay bằng `MB-RTU pump-vfd-01 / run_status`; §13.2
  Product cấm ID phẳng.
- `PB-B-08`: §14.6 định nghĩa `GRAPH_ONLY | PROGRAM_ONLY | DUAL_INVALID` fail
  closed với `PRG-CUTOVER-001`.
- `PB-D-01`: bảng IA §4.1 và sáu danh sách UC từng trang nay khớp tuyệt đối;
  UC-11/13/15/16 hết dùng lẫn mã.
- `PB-F-01/03`: §26 có chín NFR định lượng kèm phương pháp; §28 hạ toàn bộ
  G0–G7 về `RED/NOT STARTED`.

### 9.2 Sửa chưa hết — artefact liên đới còn theo bản cũ

| ID | Mức | Finding | Dẫn chứng |
|---|---|---|---|
| R2-01 | P1 | UX §12.2 wireframe Runtime vẫn liệt kê hai Task (`Control_Main 1 s`, `Monitor_Slow 5 s`) trong khi §10.2/§17 chốt Rev A chỉ một Task và không có `Thêm Task`. Cùng chỗ, `Priority` vẫn nằm trong Advanced dù một Task thì priority vô nghĩa. | UX §12.2 vs §10.2, §17; Product §9.2 |
| R2-02 | P1 | UX §33 Component Inventory chưa theo descope: còn `FbdCanvas` (Rev A là structured editor, canvas là Rev B), `ApplicationFunctionSummary` và `FunctionalDocumentationPanel` (nay là tag/view tùy chọn, ngoài DoD Rev A). | UX §33 vs §8.6, §15, §29, §45 |
| R2-03 | P1 | UX §43 Implementation Sequence chưa đồng bộ: `UX-P0` còn “6 routes/pages” (§24.1 đã bỏ page count làm gate và bắt PGM-06 tách 3 subroute ⇒ 8 route), `UX-P2` còn giao `functional documentation`, `UX-P7` còn giao `as-built record` — cả hai đã ra ngoài DoD Rev A. | UX §43 vs §24.1, §29, §45 |
| R2-04 | P2 | Nhãn UC lệch tên sau khi đổi tên: §8.8 “UC-02 Create/Edit Application Function”, §12.7 “UC-10 Offline”, và §21 còn ghi `Page: Runtime & Service` / `Page: Commission` cho UC-11/12/13/16. ID đúng, tên hiển thị cũ. | UX §8.8, §12.7, §21 |
| R2-05 | P2 | `Offline` vẫn là Programming state ở §32 (danh sách `Programming state`) và §38 (`Persistent attention — Offline`), trong khi §25/§12.6 đã chuyển sang `core DEGRADED/UNREACHABLE`. Chỉ §25 có câu giới hạn; §32/§38 thì không. | UX §32, §38 vs §12.6, §25 |

### 9.3 Finding mới — do chính nội dung v2.1 sinh ra

| ID | Mức | Finding |
|---|---|---|
| R2-06 | **P0** | **Hold-last định nghĩa sai trục.** §16.7 bắt “giữ `actual_value` hiệu lực của AO/DO qua ranh giới activation” và “giá trị commit đầu phải bằng giá trị trước chuyển”. `actual_value` là **đầu ra sau resolver**. Khi output đang bị mức 1..4 giữ (đúng kịch bản §14.4 vừa thêm), yêu cầu này buộc Revision mới kế thừa giá trị của một nguồn khác: van bị `LOCAL_MANUAL` giữ ở 62% thì program mức 5 phải commit 62%, và khi override nhả ra output nhảy về giá trị program thật — đúng cái bump mà hold-last sinh ra để tránh. Hold-last phải phát biểu trên **đóng góp mức 5** (giá trị program đưa vào resolver), không phải trên giá trị đã resolve. |
| R2-07 | **P0** | **Anti-windup mắc cùng lỗi trục.** §14.4 ghi PID “phải track `actual_value`”. Tracking/back-calculation chỉ đúng khi giới hạn nằm **cùng đường lệnh** (bão hòa, rate limit). Khi một nguồn ưu tiên cao hơn đang giữ output, track theo `actual_value` làm integrator nạp sẵn theo giá trị ngoại lai, và bump ngay lúc override nhả. Phải tách hai chế độ: (a) mức 5 thắng nhưng bị saturate ⇒ back-calculation theo giá trị đã commit của mức 5; (b) mức 5 thua arbitration ⇒ freeze/hold integrator, không track. |
| R2-08 | **P0** | **Bỏ qua `IOP_SAFE_TIMEOUT_MS = 200 ms` của MCU.** `apps/core/bootstrap/main.cpp:317-321` ghi rõ: khi core không poll, MCU **tự ép AO/DO về an toàn sau 200 ms**, độc lập hoàn toàn với SOM. Mọi gián đoạn poll khi activate/restore vượt 200 ms sẽ đưa output về safe value trước khi Revision mới commit ⇒ hold-last của §16.7 **không thể đạt** nếu activation làm đứt poll. Proposal không nhắc con số này ở bất kỳ đâu. Cần: yêu cầu activation không làm đứt IOP poll, ngân sách activation `< 200 ms` có đo, và kịch bản G6 đo bump kèm trạng thái MCU. |
| R2-09 | **P0** | **Cutover đổi chủ scan period nhưng không đụng tới `WatchdogSec`.** `platform/systemd/mkddc-core.service:20-35` chốt `WatchdogSec=6`, dẫn xuất từ công thức `>= 2 × scan lớn nhất + WCET + 1 s` với dải `scan_ms` của `graph.json` là `500..2000 ms`. `main.cpp:308-337` kick `WATCHDOG=1` **chỉ sau khi `ScanLoop::step()` trả về trọn vẹn** (cố ý, để watchdog chứng minh một chu kỳ điều khiển hoàn tất). Nếu sau `PROGRAM_ONLY` chu kỳ Task `30 s` chi phối ranh giới step, công thức cho ra `>= 61 s` chứ không phải `6 s` ⇒ systemd giết và restart core mỗi 6 s, và mỗi lần restart lại kích 200 ms safe của MCU (R2-08). §14.6 chỉ nói “base scan do runtime config được phê duyệt sở hữu” mà không định nghĩa quan hệ base scan ↔ Task cycle ↔ `WatchdogSec`. |
| R2-10 | P1 | **Ngưỡng overrun mới có thể gây nuisance safe-state.** §14.3 đặt “ba lần overrun liên tiếp ⇒ Runtime phải yêu cầu safe-state”. Trong khi đó `platform/systemd/mkddc-web-pi.service` **không có** `CPUQuota/CPUWeight/Slice/Nice`, và bo lab đang chạy core ở `SCHED_OTHER` do drop-in `mkddc-core-nofifo.conf`. Một lần `Check` (ngân sách `p95 <= 2 s` theo `NFR-PRG-PROP-002`) chạy trong `mkddc-web` đủ sức tranh CPU với scan `1 s` ⇒ ba overrun liên tiếp ⇒ safe-state toàn hệ vì một thao tác engineering. Thiếu: yêu cầu cách ly CPU giữa compile và RT path, và phân biệt **task-level degrade** với **plant safe-state**. |
| R2-11 | P1 | **Trùng ID `PRG-COM-001`.** Vừa là requirement (§25.5 “Check phải tổng hợp source/task/mapping/library/target/cutover readiness”) vừa là error code (§26.1 “Candidate bị runtime từ chối; active cũ giữ nguyên”). Mọi grep traceability sẽ dính cả hai. Đổi namespace mã lỗi (ví dụ `PRG-ERR-COM-001`). |
| R2-12 | P1 | **Import bundle chưa chốt “luôn biên dịch lại trên target”.** §13.5 liệt kê bundle gồm source/mapping/Task/library version/metadata + integrity hash, nhưng không cấm mang theo **artifact đã build**. Nếu loader chấp nhận artifact ngoại nhập mà chỉ kiểm hash, đó chính là đường chạy IR tùy ý — đúng lỗ hổng mà trusted-origin signature (đã đẩy OUT Rev A theo §17.3) lẽ ra che. UC-17 lại là Release Critical. Cần một câu normative: import chỉ nhận source; artifact luôn được build lại trên target rồi mới verify. |
| R2-13 | P2 | **Phạm vi User Function Block chưa nhất quán.** UX §10.4 giữ nhóm `PROJECT / User Function Blocks` và UC-04 (tạo/dùng FB tái sử dụng) là Release Critical, trong khi Product §11.3 nói “catalogue, upgrade UX và component versioning đầy đủ là roadmap”. FB do user định nghĩa tự nó là artifact có version và có bài toán tương thích khi Revision đổi. Phải chốt: Rev A cho FB cục bộ trong Project (không catalogue chia sẻ), hay bỏ hẳn. |
| R2-14 | P2 | **Thiếu capability liệt kê override đang hiệu lực.** §19.1 bắt checklist liệt kê “mọi Local manual override còn hiệu lực cùng TTL và actor”, nhưng §23 Required capability không có mục nào cấp danh sách đó; `Point.overrideExpiresInS` hiện là trường theo từng point. Thêm capability “liệt kê override đang hoạt động theo Revision/binding” hoặc nói rõ dùng lại endpoint nào. |

### 9.4 Kết luận vòng 2

v2.1 là bước tiến thật: hết tài liệu song quyền, hết ID mồ côi, hết claim edition
chưa kiểm chứng, và ba quyết định điều khiển quan trọng nhất (arbitration mức 5,
cutover fail-closed, bumpless) đã có mặt. Nhưng **`R2-06..R2-09` phải đóng trước
khi proposal đi tiếp**: cả bốn đều nằm ở chỗ tài liệu vừa thêm mới và đều va vào
ràng buộc phần cứng/hệ thống đã tồn tại trên bo (`200 ms` MCU, `WatchdogSec=6`,
core `SCHED_OTHER`, resolver 6 mức). Đây không phải lỗi trình bày — đó là bốn
đường dẫn tới mất điều khiển hoặc restart loop trên thiết bị thật.

---

## 10. Vòng 3 — kết quả review v2.2 và quyết định review

### 10.1 Số liệu kiểm lại (tự đo, không lấy khai báo)

| Kiểm tra | Kết quả |
|---|---:|
| `PRG-*` requirement duy nhất | 41 |
| Crosswalk §25.8 phủ hết 41 ID (comm hai chiều) | 41/41, không thiếu |
| `UX-REQ-*` duy nhất | 24 |
| `UX-REQ-*` có trace trong UX §44 | 24/24 |
| `VS-PROG-*` duy nhất | 30 |
| UC có dòng trace trong UX §46 | 17/17 |
| Va chạm ID requirement ↔ error code | 0 |
| Artefact R2-01..R2-05 còn sót (`Monitor_Slow`, `FbdCanvas`, `FunctionalDocumentationPanel`, “6 routes/pages”, nhãn UC cũ) | 0 |
| Năm edition standards còn trong normative text | 0 |
| `git diff --check` | sạch |

### 10.2 Bốn P0 vòng 2 — sửa đúng bản chất, không phải sửa chữ

- `R2-06`: §16.7 chuyển hold-last sang **đóng góp mức 5**
  (`previous_program_value`), và mục 5 nêu thẳng ca 62%/41%: activation giữ đóng
  góp Program ở 41%, `actual_value` vẫn 62%, việc nhả override tách thành
  transition policy riêng.
- `R2-07`: §14.4 tách hai chế độ — thắng-nhưng-saturate thì back-calculation trên
  cùng đường lệnh; thua arbitration thì freeze integrator và **cấm** seed từ
  `actual_value` ngoại lai. Bỏ `written_value` mơ hồ, thay bằng `program_value`.
- `R2-08`: §16.7 cấm activation/restore dừng-restart `mkddc-iobus`, đặt
  `max_iop_poll_gap < 200 ms` (mục tiêu `<=100 ms`) và bắt G6 đo thật.
- `R2-09`: §14.6 tách base control step khỏi Task period, cấm dùng Task period
  làm thời gian chờ của một `ScanLoop::step()`, ghi công thức
  `WatchdogSec >= 2 × max_base_step_period + WCET_step_target + 1 s`, và tự khai
  mâu thuẫn với `PROGRAM_TASK_SCHEDULER_SPEC` là design blocker của
  `OD-PROG-012/013/014`.
- `R2-10`: §14.3 hạ overrun về **fault mức Task**; plant safe-state chỉ do
  `SafetyManager` với điều kiện độc lập đã phê duyệt. Thêm yêu cầu
  resource-isolation và ghi rõ cấu hình lab hiện tại **không phải** bằng chứng
  production.

### 10.3 Tồn đọng — sửa trong lúc merge, không chặn

| ID | Mức | Finding |
|---|---|---|
| R3-01 | P2 | Mã lỗi cũ `PRG-MAP-003/004` còn ở Product §12.4 (7 dòng ma trận) và UX §11.6, trái chính §26.1 vừa trao quyền namespace cho `IFSPEC-PROG-001` với tiền tố `PRG-ERR-*` và chỉ giữ ba mã minh họa. Đổi thành `PRG-ERR-MAP-*` hoặc bỏ mã khỏi ma trận, chỉ ghi lớp lỗi. |
| R3-02 | P2 | Bảng xử lý §33 chỉ liệt kê 9/14 mã `R2-*` (thiếu `R2-02/03/04/05/07`) dù nội dung đã sửa đủ. Bổ sung dòng cho khớp inventory. |
| R3-03 | P1 (việc merge) | Mâu thuẫn công thức watchdog “Task lớn nhất” vs base-step model do chính §14.6 khai báo phải được ghi thành dòng mới trong `CONFREG-PROG-001` (đề xuất `CONF-PROG-015`) khi merge; không để nó chỉ nằm trong proposal. |

### 10.4 Quyết định review

**APPROVED — ở tầng review tài liệu**, đủ điều kiện dùng làm **đầu vào amendment**
để bắt đầu cập nhật bộ `docs/07_records/audit-programming`.

Approval này **không** phải và không được diễn giải thành:

- phê duyệt Product baseline — khối sign-off Product §35 và UX §50 còn 5 ô
  `PENDING`, trong đó Controls/Safety Reviewer là bắt buộc vì hold-last,
  anti-windup và watchdog là quyết định an toàn;
- đóng bất kỳ `OD-PROG-001..015`, đặc biệt `OD-PROG-015`;
- đổi `VR-PROG-001..013` khỏi `RED` hoặc đổi `G0..G7` khỏi `RED/NOT STARTED`;
- khóa API/schema, chốt capacity/WCET, hay chuyển gate production sang GREEN —
  `CONFREG-PROG-001` §3 cấm việc này khi OD chưa đóng.

### 10.5 Phạm vi được phép ghi vào bộ audit khi merge

| Đích | Được ghi gì | Trạng thái bắt buộc |
|---|---|---|
| `00_document_control/01_DOCUMENT_REGISTER.md` | Đăng ký hai proposal v2.2 là amendment input | `IN REVIEW` |
| `00_document_control/03_CONFLICT_REGISTER.md` | Cập nhật `CONF-PROG-002/003/010` theo cutover model, allowlist cycle, capacity OUT; thêm `CONF-PROG-015` theo `R3-03` | Theo quy ước sẵn có |
| `00_document_control/04_OPEN_DECISION_REGISTER.md` | Ghi **proposed answer** kèm trỏ mục cho `OD-PROG-002/003/004/006/009/012/013/014` | Vẫn `OPEN` |
| `02_requirements/` | 41 `PRG-*` + 24 `UX-REQ-*` qua crosswalk | `PROPOSED`, không đổi cột evidence |
| `03_architecture/` | Ba quyết định mới: base step ≠ Task period; cutover ba trạng thái fail-closed; resource isolation compile vs RT | `PROPOSED` |
| `04_design/` | Chỉ được ghi ở mức **design input/constraint** | Không được đánh dấu Design approved |
| `05_interfaces/IFSPEC-PROG-001` | Nhận quyền sở hữu namespace `PRG-ERR-*` | `IN REVIEW` |
| `06_verification/` | `VS-PROG-001..030` làm scenario, map tới `VR-PROG-001..013` | `VR` giữ `RED` |
| `07_traceability/TRACE-PROG-001` | Thêm cột proposal | Cột evidence giữ `MISSING/RED` |

---

**HẾT — AUDIT-PROGRAMMING-CRITIQUE-2026-08-09 (vòng 1 + vòng 2 + vòng 3)**
