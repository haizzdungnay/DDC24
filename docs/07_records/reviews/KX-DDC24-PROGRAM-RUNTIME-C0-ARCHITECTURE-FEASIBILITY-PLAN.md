# C0 — Program Runtime Architecture and Feasibility Baseline

**Document ID:** KX-DDC24-PROGRAM-RUNTIME-C0-PLAN-001
**Trạng thái:** Active — duy nhất phase được phép bắt đầu (ADR-018)
**Ngày tạo:** 2026-07-23
**Chủ quản:** Project Engineering (Phạm Đình Chương — Project Engineering Owner / CTO)
**Nguồn quyết định:** [`ADR-018-mekong-owned-iec-aligned-program-runtime.md`](../../adr/ADR-018-mekong-owned-iec-aligned-program-runtime.md),
[`KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md`](KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md) (Q8)
**Tài liệu song song:** [`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`](../../02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md) §12,
[`KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md`](KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md)

## 1. Ranh giới C0 (bắt buộc đọc trước khi làm bất kỳ workstream nào)

**Được phép:**
- Viết tài liệu kiến trúc, schema, spec, test strategy, sizing.
- Viết **prototype/spike giới hạn**, tách khỏi production code (thư mục riêng, không
  build vào target chính, không merge vào `services/`, `web/`, `src/frontend/` chính
  thức) để chứng minh khả thi kỹ thuật: ST parse→semantic→IR; FBD graph→cùng IR; IR
  execution theo cycle time; đọc input image/ghi output image; atomic artifact
  activation; basic trace/diagnostic.

**Không được phép:**
- Viết production runtime quy mô lớn.
- Merge bất kỳ thay đổi nào vào `mkddc-core`, `mkddc-iobus`, `mkddc-web` production, hoặc
  `fw/` production.
- Mở bất kỳ slice C1–C10 nào (Implementation Plan) trước khi C0 được duyệt go/no-go
  (workstream C0.15).

C0 đóng khi cả 15 workstream dưới có output được review và go/no-go (C0.15) là **Go**.

## 2. Workstream

Mỗi workstream: Owner | Input | Output | Dependency | Acceptance criteria | Effort
(t-shirt: S/M/L, không phải ngày cụ thể — sizing chính xác là output của C0.14) | Risk |
Trạng thái.

### C0.1 — Requirement baseline

- **Owner:** Project Engineering + TechLead review
- **Input:** ADR-018, `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` §11 candidate
  requirements, decision record Q0–Q9.
- **Output:** `REQUIREMENTS.md` cập nhật với SYS-REQ-IEC-001, SWR-REQ-IEC-001..009,
  IF-REQ-IEC-001, SAFE-REQ-IEC-001, NFR-REQ-IEC-001, FW-REQ-MCU-001..002 ở trạng thái
  Accepted (scope ST+FBD, không LD/SFC).
- **Dependency:** none (có thể bắt đầu ngay).
- **Acceptance:** mỗi requirement có ID, shall-statement, verification method, trace tới
  design section; TechLead review approved.
- **Effort:** S
- **Risk:** thấp — nội dung đã có sẵn ở design doc §11, chỉ cần chuyển vào
  `REQUIREMENTS.md` và điều chỉnh scope ST+FBD.
- **Trạng thái:** Chưa bắt đầu

### C0.2 — Program/Resource/Task/POU model

- **Owner:** Program Runtime Architect
- **Input:** IEC 61131-3 configuration/resource/task/POU concepts (định hướng, không
  phải conformance), `PROGRAM_SOM_FW_DRAFT_DESIGN` §3.1/§7.3.
- **Output:** spec mô tả Configuration → Resource → Task → Program instance cho một
  controller MK-DDC-24 (không multi-controller Rev A.0); POU `PROGRAM`/`FUNCTION`/
  `FUNCTION_BLOCK` scope, local/instance data.
- **Dependency:** C0.1.
- **Acceptance:** spec review bởi TechLead; đủ chi tiết để C0.6 (IR) và C1–C3 tham chiếu
  trực tiếp, không cần suy diễn thêm.
- **Effort:** M
- **Risk:** trung bình — đây là quyết định kiến trúc lõi, sai ở đây lan ra toàn bộ C1–C10.
- **Trạng thái:** Chưa bắt đầu

### C0.3 — IEC-aligned type system

- **Owner:** Program Runtime Architect
- **Input:** `PROGRAM_SOM_FW_DRAFT_DESIGN` §3.2 (elementary/derived types, retain rules).
- **Output:** type system spec cho ST+FBD Rev A.0: danh sách type hỗ trợ, conversion
  rule, retain rule, initial value/constant rule. Không cần bản IEC có license cho MVP
  nội bộ (khác với §3.2 bản thiết kế — bản có license chỉ cần nếu sau này theo đuổi
  conformance/certification chính thức, xem C0.15 và Q6 quyết định "không phải release
  gate Rev A.0").
- **Dependency:** C0.2.
- **Acceptance:** type spec đủ để compiler (C0.6/C4) implement không mơ hồ; test vector
  boundary/overflow/conversion tối thiểu được liệt kê.
- **Effort:** M
- **Risk:** trung bình.
- **Trạng thái:** Chưa bắt đầu

### C0.4 — ST subset grammar và semantic

- **Owner:** Program Runtime Architect + DeveloperTeam
- **Input:** C0.2, C0.3.
- **Output:** ST grammar (EBNF hoặc tương đương) cho Rev A.0 subset; semantic rule cho
  scope/type/POU call.
- **Dependency:** C0.2, C0.3.
- **Acceptance:** grammar review; ít nhất 10 golden ST program mẫu (bao gồm invalid case)
  được liệt kê làm test fixture cho C4.
- **Effort:** M
- **Risk:** trung bình — dễ overscope nếu không giới hạn rõ subset.
- **Trạng thái:** Chưa bắt đầu

### C0.5 — FBD graph semantic

- **Owner:** Program Runtime Architect + DeveloperTeam
- **Input:** C0.2, C0.3, `services/core/graph_runtime.cpp` (tham khảo mô hình node/port
  hiện có làm nguồn kinh nghiệm, không phải nguồn semantics IEC).
- **Output:** FBD semantic spec: typed pin/wire, execution order rule, POU call trong
  FBD, quy tắc chuyển đổi từ 28-node graph cũ sang FBD POU (định hướng cho C1/C6 migration
  sau).
- **Dependency:** C0.2, C0.3.
- **Acceptance:** semantic spec review; ít nhất 5 golden FBD program mẫu làm fixture cho
  C7.
- **Effort:** M
- **Risk:** trung bình — rủi ro lớn nhất là vô tình tái tạo lại đúng model 28-node cũ mà
  không thêm type/POU semantics thật (xem ADR-004 "rejected alternative #1").
- **Trạng thái:** Chưa bắt đầu

### C0.6 — Typed IR

- **Owner:** Program Runtime Architect
- **Input:** C0.3, C0.4, C0.5, `PROGRAM_SOM_FW_DRAFT_DESIGN` §7.2.
- **Output:** IR schema (bytecode/register form) có version, đủ để cả ST và FBD lower về
  cùng biểu diễn; source map liên kết ngược editor; **schema phải có trường mở rộng dành
  cho LD/SFC sau này** (không implement, chỉ chừa chỗ).
- **Dependency:** C0.4, C0.5.
- **Acceptance:** IR schema review; ít nhất một golden ST program và một golden FBD
  program compile thủ công/spike ra cùng dạng IR nhất quán.
- **Effort:** L
- **Risk:** cao — đây là hợp đồng trung tâm giữa compiler và runtime; đổi sau C1 sẽ tốn
  kém.
- **Trạng thái:** Chưa bắt đầu

### C0.7 — Deterministic scheduler model

- **Owner:** Program Runtime Architect + Firmware/Runtime Lead
- **Input:** C0.6, `PROGRAM_SOM_FW_DRAFT_DESIGN` §7.3.
- **Output:** scheduler spec: cyclic task, task priority/period/watchdog budget, input
  snapshot/output staging, overrun handling, no-allocation-in-scan rule.
- **Dependency:** C0.6.
- **Acceptance:** spec đủ chi tiết để C3 implement; timing budget giả định ghi rõ (sẽ đo
  thật ở C9/HIL).
- **Effort:** M
- **Risk:** trung bình.
- **Trạng thái:** Chưa bắt đầu

### C0.8 — Artifact lifecycle

- **Owner:** Program Runtime Architect
- **Input:** C0.6, `PROGRAM_SOM_FW_DRAFT_DESIGN` §6.3.
- **Output:** artifact build→validate→activate→rollback state machine; manifest field
  list (project_id, source_hash, compiler_version, ir_schema, artifact_hash, ...).
- **Dependency:** C0.6.
- **Acceptance:** state machine review; không có online-change path (theo RD-IEC-005
  Approve).
- **Effort:** S
- **Risk:** thấp — phần lớn đã có ở design doc §6.3.
- **Trạng thái:** Chưa bắt đầu

### C0.9 — Web IDE / backend / device deployment architecture

- **Owner:** SOM Backend Lead + FE Lead
- **Input:** C0.8, `PROGRAM_SOM_FW_DRAFT_DESIGN` §4, §5, §6.1.
- **Output:** service naming chính thức (`mkddc-program-service`/`mkddc-program-core`
  hay tên khác), API path chính thức (khoá `/api/v1/program/*` hoặc giữ `/api/v1/iec/*`),
  ownership boundary Web IDE ↔ backend ↔ compiler ↔ runtime.
- **Dependency:** C0.8.
- **Acceptance:** API contract draft review; không trùng lặp trách nhiệm với `mkddc-web`
  hiện hành (auth/RBAC/audit đã có, không viết lại).
- **Effort:** M
- **Risk:** trung bình — quyết định sai boundary ở đây gây rework FE/BE lớn ở C1/C5.
- **Trạng thái:** Chưa bắt đầu

### C0.10 — SOM–MCU I/O image contract

- **Owner:** Firmware Lead + SOM Backend Lead
- **Input:** `shared/iop_protocol.h`, `services/iobus/`, `PROGRAM_SOM_FW_DRAFT_DESIGN` §8, §9.
- **Output:** I/O image contract giữa Program Runtime và `mkddc-iobus` (typed variable ↔
  physical point, quality propagation, single AO conversion boundary) — **draft only**,
  không đổi `shared/iop_protocol.h` production trong C0.
- **Dependency:** C0.6, C0.7.
- **Acceptance:** draft review bởi Firmware Lead; không xung đột ADR-011/ADR-012/ADR-014.
- **Effort:** M
- **Risk:** trung bình.
- **Trạng thái:** Chưa bắt đầu

### C0.11 — Security, permission và audit model

- **Owner:** SOM Backend Lead + Security reviewer
- **Input:** `PROGRAM_SOM_FW_DRAFT_DESIGN` §6.1 (RBAC/CSRF/audit), HMI broker RBAC pattern
  hiện có (ADR-016) làm tham khảo.
- **Output:** permission model cho project/build/deploy/activate/rollback (role nào được
  làm gì), audit event schema.
- **Dependency:** C0.9.
- **Acceptance:** review bởi Security reviewer; tái dùng session/RBAC pattern hiện có của
  `mkddc-web`, không tạo hệ auth song song.
- **Effort:** S
- **Risk:** thấp — có pattern sẵn để tái dùng.
- **Trạng thái:** Chưa bắt đầu

### C0.12 — Test và conformance strategy

- **Owner:** QA/HIL Lead
- **Input:** `PROGRAM_SOM_FW_DRAFT_DESIGN` §13.
- **Output:** test layer plan cho ST+FBD scope (bỏ layer LD/SFC): parser/semantic,
  language execution, library, runtime, system, target/HIL; evidence record format.
- **Dependency:** C0.4, C0.5, C0.6, C0.7.
- **Acceptance:** QA review; mỗi layer có ít nhất một ví dụ test case cụ thể (không chỉ mô
  tả chung chung).
- **Effort:** M
- **Risk:** thấp.
- **Trạng thái:** Chưa bắt đầu

### C0.13 — Architecture prototype (spike, giới hạn)

- **Owner:** DeveloperTeam (2 người: 1 compiler-focus, 1 runtime-focus) + TechLead review
- **Input:** C0.4, C0.5, C0.6, C0.7.
- **Output:** prototype riêng (không production) chứng minh: ST parse→semantic→IR; FBD
  graph→cùng IR; IR execution theo cycle time giả lập; đọc input image/ghi output image
  giả lập; atomic artifact activation giả lập; basic trace.
- **Dependency:** C0.4–C0.7.
- **Acceptance:** demo chạy được trên host (không cần target thật); TechLead xác nhận
  prototype không bị nhầm là production code, không merge vào nhánh chính thức các
  service hiện có.
- **Effort:** L
- **Risk:** cao — nếu prototype lộ ra IR schema (C0.6) không khả thi, phải quay lại
  C0.6 trước khi C0 đóng.
- **Trạng thái:** Chưa bắt đầu

### C0.14 — Effort estimate và resourcing cho C1–C10 (đóng DOC-REV-006)

- **Owner:** Program Runtime Architect + SOM Backend Lead + Firmware Lead + QA/HIL Lead
  (theo quyết định Q8)
- **Input:** toàn bộ C0.1–C0.13, đặc biệt kết quả prototype C0.13 (độ khó thực tế).
- **Output:** effort estimate (người-tuần hoặc người-tháng), timeline đề xuất, headcount
  cần, dependency giữa C1–C10, chi phí (nếu có: license bản IEC 61131-3:2025 để tham
  khảo normative, PLCopen accredited lab nếu theo đuổi certification sau này), risk
  register.
- **Dependency:** C0.1–C0.13.
- **Acceptance:** Project Engineering Owner/CTO review số liệu; đủ để quyết định go/no-go
  C1 với ngân sách/thời gian cụ thể, không còn là "chưa định lượng".
- **Effort:** M
- **Risk:** trung bình — nếu C0.13 prototype không đủ tín hiệu, effort estimate ở đây sẽ
  kém chính xác; chấp nhận sai số, ghi rõ khoảng tin cậy thay vì một con số đơn.
- **Trạng thái:** Chưa bắt đầu

### C0.15 — C0 review và go/no-go

- **Owner:** Project Engineering Owner / CTO
- **Input:** C0.1–C0.14.
- **Output:** quyết định Go/No-go/Go-with-changes cho việc mở C1, ghi vào Approval log ở
  `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` §15.1 và `Implementation Plan C1–C10`.
- **Dependency:** tất cả C0.1–C0.14 đã Done.
- **Acceptance:** quyết định có ngày, người ký, điều kiện kèm theo (nếu Go-with-changes).
- **Effort:** S
- **Risk:** thấp (thủ tục), nhưng là điểm chặn cứng — không ai được tự ý mở C1 nếu chưa có
  dòng quyết định này.
- **Trạng thái:** Chưa bắt đầu

## 3. Bảng tổng hợp trạng thái

> ⚠️ **BLOCKER (ACTION-06/07, 2026-07-23):** cột "Owner (role)" dưới đây là **vai trò**,
> không phải tên người thật. Tôi (trợ lý) không có và không được tự đặt tên nhân sự thật —
> đây là thông tin nhân sự nội bộ chỉ CTO/Project Engineering mới cung cấp được. Cho tới
> khi có tên thật cho cả 5 vai trò (Program Runtime Architect, SOM Backend Lead, Firmware
> Lead, QA/HIL Lead, TechLead review), **không workstream nào được đổi từ "Chưa bắt đầu"
> sang "READY"** — làm vậy sẽ là ghi sai hồ sơ governance. Xem
> `PROGRAM_RUNTIME_READY_FOR_C0.md` mục `OWNER_ASSIGNED`/`C0_READY`.

| # | Workstream | Owner (role — chờ tên thật) | Reviewer | Effort | ETA | Trạng thái |
|---|---|---|---|---|---|---|
| C0.1 | Requirement baseline | Project Engineering | TechLead review | S | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.2 | Program/Resource/Task/POU model | Program Runtime Architect | TechLead review | M | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.3 | Type system | Program Runtime Architect | TechLead review | M | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.4 | ST subset grammar/semantic | Architect + DeveloperTeam | TechLead review | M | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.5 | FBD graph semantic | Architect + DeveloperTeam | TechLead review | M | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.6 | Typed IR | Program Runtime Architect | TechLead review | L | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.7 | Deterministic scheduler model | Architect + Firmware/Runtime Lead | TechLead review | M | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.8 | Artifact lifecycle | Program Runtime Architect | TechLead review | S | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.9 | Web IDE/backend/device architecture | SOM Backend Lead + FE Lead | TechLead review | M | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.10 | SOM–MCU I/O image contract | Firmware Lead + SOM Backend Lead | TechLead review | M | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.11 | Security/permission/audit model | SOM Backend Lead + Security reviewer | Security reviewer | S | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.12 | Test/conformance strategy | QA/HIL Lead | TechLead review | M | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.13 | Architecture prototype (spike) | DeveloperTeam + TechLead | TechLead review | L | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.14 | Effort estimate C1–C10 | Architect+Backend+FW+QA Leads | CTO | M | _(chờ owner)_ | Chưa bắt đầu — chờ owner |
| C0.15 | C0 review, go/no-go | CTO | — (CTO tự quyết) | S | _(chờ C0.1–C0.14)_ | Chưa bắt đầu — chờ owner |

Không có workstream nào ở trạng thái Done. ETA không thể điền vì phụ thuộc ai thực sự
nhận việc (một Architect làm một mình cần thời gian khác một cặp Architect+Developer) —
ETA thật là một phần kết quả của việc gán owner, không phải input độc lập.

## 4. Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-23 | Tạo C0 plan theo quyết định CTO (ADR-018, Q8): 15 workstream, mỗi workstream có owner/input/output/dependency/acceptance/effort/risk/trạng thái. |
| 1.1 | 2026-07-23 | ACTION-06/07: thêm cột Reviewer/ETA vào bảng tổng hợp §3. Owner vẫn ở mức role, chưa có tên thật — đây là blocker duy nhất còn lại trước khi C0 có thể chuyển READY, ghi rõ trong `PROGRAM_RUNTIME_READY_FOR_C0.md`. |
