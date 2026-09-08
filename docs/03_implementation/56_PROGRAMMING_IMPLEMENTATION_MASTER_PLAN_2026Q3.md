# Plan 56 — Programming Implementation Master Plan 2026 Q3

**Trạng thái:** **Superseded 2026-08-20 — giữ để truy nguyên WP/commit cũ; không quản task tương lai**
**Ngày:** 2026-08-15 · **Cập nhật trạng thái:** 2026-08-20
**Tác giả:** Agent kỹ thuật, theo Lệnh triển khai CTO/Owner 2026-08-15
**Nguồn:** [`PROGRAMMING_OVERVIEW_DESIGN_FEATURE_GAP_REPORT_2026-08-15.md`](../07_records/reviews/PROGRAMMING_OVERVIEW_DESIGN_FEATURE_GAP_REPORT_2026-08-15.md)
(10 gap G-1..G-10) + [`PROGRAMMING_DOCUMENT_READINESS_MATRIX.md`](../00_governance/PROGRAMMING_DOCUMENT_READINESS_MATRIX.md)
(Document Gate)

**Authority hiện hành:** [Plan 59](59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md)
(`Active — PLAN_READY / IMPLEMENT_READY`). Product v3.0 và ADR-050 thay toàn bộ
quyết định một Program/bốn workspace/ẩn user POU của nội dung lịch sử bên dưới.

---

## 0. Đọc nhanh

> Chỉ dùng file này để tìm evidence của `WP-01..13`. Không mở, đóng hoặc tạo WP
> mới tại đây; mọi execution status nằm trong bảng task Plan59 §3.

| Câu hỏi | Trả lời |
|---|---|
| File này dùng để làm gì? | Roadmap thực thi cho toàn bộ finding G-1..G-10 của gap report Overview/ST/FBD, theo đúng cấu trúc Phase 0-5 + WP-01..13 + `WP-MULTIPROGRAM-ARCH` mà CTO/Owner đã ra lệnh 2026-08-15. |
| Trạng thái hiện tại? | Tracker hiện hành xác nhận WP-01..08 và WP-10..12 `DONE`; WP-09 `BLOCKED` bởi target credential; WP-13 ở `DESIGN`; multi-Program `BLOCKED`. Release closure chuyển sang Plan 59 để không dùng snapshot ngày 2026-08-15 làm trạng thái hiện hành. |
| Ai cần đọc? | PM, CTO, Dev Lead (FE/BE/Compiler), UX Lead, Verification Lead, Security. Mỗi WP ghi rõ owner. |
| Track tiến độ ở đâu? | [`PROGRAMMING_IMPLEMENTATION_TRACKER.md`](PROGRAMMING_IMPLEMENTATION_TRACKER.md) — bảng WP × Requirement/Design/FE/BE/FW/Test/Evidence/Status/Owner/Blocker, cập nhật sau mỗi iteration. |

---

## 1. Nguyên tắc thực hiện (từ Lệnh CTO/Owner §II)

Mọi Work Package đi đúng pipeline:

```text
Finding → Product/Architecture Decision → Requirement → Design →
Interface/Data Contract → Acceptance Test → Implementation Plan → Review →
IMPLEMENT → Test Evidence → As-built Audit → Close
```

Nếu tài liệu cần thiết chưa tồn tại hoặc đã lỗi thời: **tạo/cập nhật tài liệu
đó trước khi code** (đã áp dụng cho WP-04 — cập nhật `ST_SUBSET_SPEC`/
`PROGRAMMING_LANGUAGE_COMPILER_DESIGN` trước, review nội dung đối chiếu trực
tiếp source, rồi mới coi Document Gate cho các WP còn lại là mở). Không
implement dựa trên suy đoán — mọi khẳng định trong plan này trỏ về file:line
thật đã đọc trực tiếp (xem gap report gốc).

## 2. Quyết định CTO/Owner đã áp dụng (D-01..D-06)

Xem toàn văn ở lệnh gốc 2026-08-15. Tóm tắt trạng thái áp dụng:

| Quyết định | Tóm tắt | Trạng thái áp dụng |
|---|---|---|
| D-01 | Overview `DraftAttentionPanel` phải phản ánh 6 trạng thái (trừ `conflict`, xem WP-01 "Quyết định thiết kế") | **Áp dụng — WP-01 DONE** |
| D-02 | FBD phải hoàn thiện end-to-end (palette, INPUT/OUTPUT, mapping, Check/Commission/Runtime), không chuyển ST-only | **Ghi nhận — Phase 2 (WP-05..09), chưa bắt đầu, chặn bởi Document Gate #6** |
| D-03 | Ẩn/disable FUNCTION/FUNCTION_BLOCK khỏi UI production; lập `POU_MULTI_OBJECT_COMPILER_MIGRATION_PLAN` riêng (chưa implement) | **Phần ẩn UI — WP-02 DONE.** Migration plan riêng — **NOT STARTED**, đúng chỉ đạo "chưa implement phần này" |
| D-04 | `1 Program/controller` là AS-BUILT FACT, không phải Product Target lâu dài; cần `WP-MULTIPROGRAM-ARCH` riêng | **Ghi nhận — WP-MULTIPROGRAM-ARCH chưa bắt đầu, chặn bởi Document Gate #1 (Product Spec authority)** |
| D-05 | `HASH_ONLY` tạm chấp nhận dev/lab; production cần `PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN` | **Ghi nhận — WP-13 (Phase 4), chưa bắt đầu, chặn bởi Document Gate #12** |
| D-06 | DINT/UINT = Implemented cần Test Result; PID = Implemented nhưng chưa production-ready tới khi Controls/Safety review | **Áp dụng — WP-04 DONE (đồng bộ tài liệu); Test Result DINT/UINT và Controls/Safety review PID vẫn NOT STARTED, ngoài phạm vi sửa tài liệu** |

---

## 3. Roadmap Phase 0-5

### Phase 0 — Baseline & Document Alignment — **DONE**

- [x] Document Readiness Matrix (14 mục, 4 MISSING, 1 mâu thuẫn thẩm quyền — xem file).
- [x] Đồng bộ `ST_SUBSET_SPEC`/`PROGRAMMING_LANGUAGE_COMPILER_DESIGN` (WP-04).
- [x] Master Plan + Tracker (file này + companion).
- Exit gate: `DOC_READY=YES` cho Phase 1 — **đạt**. `DOC_READY=NO` cho Phase 2/WP-13/WP-MULTIPROGRAM-ARCH — ghi rõ điều kiện mở ở Readiness Matrix §2.

### Phase 1 — Truthful UI / Low-risk Corrective — **DONE**

WP-01, WP-02, WP-03, WP-04 — xem §4. Gate: `UI_TRUTHFUL=YES` — **đạt**: Overview
không còn im lặng về Check state (WP-01); UI không còn cho chọn loại Program
backend chưa hỗ trợ (WP-02); registry FBD FE khớp compiler thật (WP-03); tài
liệu ngôn ngữ khớp implementation (WP-04).

### Phase 2 — FBD End-to-End — **FE WP-05..08 DONE; WP-09 BLOCKED target**

`FBD_EDITOR_DESIGN` đã mở Gate #6; WP-05..08 đã triển khai và có evidence host/
browser theo Tracker. WP-09 vẫn `BLOCKED`: chưa có FBD Check/Commission/Runtime
với OUTPUT trên target và Test Result có thẩm quyền.

### Phase 3 — ST Engineering Experience — **DONE cho WP-10/11**

WP-10/11 đã triển khai theo Technical Selection Record và UX design. Evidence
chi tiết và giới hạn nằm trong Tracker; runtime-value overlay/undo history nâng
cao không được suy thành release blocker nếu chưa có requirement authority.

### Phase 4 — Runtime/Security Corrective — **WP-12 DONE; WP-13 DESIGN**

WP-12 RETAIN Reset đã triển khai Core/BE/FE và có host/target supporting evidence;
HIL power-fault vẫn mở. WP-13 đã có design nhưng chưa được Security Architecture
duyệt để đổi integrity mode; Rev A hiện giữ `HASH_ONLY` theo `ADR-031`.

### Phase 5 — Multi-Program Architecture — **BLOCKED, ngoài release Rev A đề xuất**

`WP-MULTIPROGRAM-ARCH` chờ Product authority cho Rev B. Plan 59 đề xuất không
đưa multi-Program vào critical path release Rev A.

---

## 4. Chi tiết Work Package — task card gốc ngày 2026-08-15

> Các bảng dưới đây giữ task card gốc để truy nguyên ý định thiết kế tại thời điểm
> lập Plan 56. **Không dùng các nhãn `NOT STARTED` hoặc dòng “chưa có evidence”
> bên trong task card làm trạng thái hiện hành.** Trạng thái/evidence authority là
> [`PROGRAMMING_IMPLEMENTATION_TRACKER.md`](PROGRAMMING_IMPLEMENTATION_TRACKER.md);
> việc còn lại để release nằm trong Plan 59.

Mỗi WP: objective · dependency · documents · design · implementation · test ·
evidence · owner · sequence · exit criteria — đúng cấu trúc Lệnh CTO/Owner
§XI.D.

### WP-01 — Overview State Model — **DONE**

| Trường | Nội dung |
|---|---|
| Objective | `DraftAttentionPanel` (PGM-01) phân biệt được no-draft/dirty/checking/failed/ready thay vì chỉ 2 trạng thái |
| Dependency | Không |
| Documents | Gap report §5.2; Document Gate #10 (OpenAPI, đã cập nhật) |
| Design | `ProjectView.LatestCheck` (BE, mới) đọc `Check` gần nhất cho `Draft.BaseRevisionID` qua `Store.GetLatestCheckForRevision` (mới); FE `draftAttentionState()` suy trạng thái từ `latestCheck.state` |
| Quyết định thiết kế | **`conflict` (409) không cài** — đây là phản hồi tức thời của một lần lưu tại `PGM-02`, không phải trạng thái server lưu lại; không có "conflict" nào để đọc khi mở Overview ở phiên trình duyệt mới. Đã xử lý sống ở `DesignWorkspacePage`/`useDraftWorkspace` từ trước (F-PROG-ASBUILT-002). Đây là quyết định kỹ thuật có lý do, không phải bỏ sót — ghi lại để không bị hỏi lại |
| Implementation | BE: `store/checks.go` (`GetLatestCheckForRevision`), `application/projects.go` (`ProjectView.LatestCheck`, `latestCheckView()`, wiring `GetProject`/`ListProjects`), `transport/http/projects.go` (`projectLatestCheckResponse`, `toProjectResponse`). Contract: `contracts/openapi/openapi.yaml` (`ProgrammingProjectLatestCheck`). FE: `model/types.ts` (`ProgrammingProjectLatestCheck`), `overview/OverviewPage.tsx` (`draftAttentionState`, `DraftCheckStatus`, `DraftPrimaryAction`) |
| Test | FE: 4 test mới `OverviewPage.test.tsx` (dirty/checking/failed/ready). BE: cần bổ sung `store` unit test cho `GetLatestCheckForRevision` và `application`/`http` test cho field mới (xem Tracker — **chưa viết trong phiên này, ghi nợ**) |
| Evidence | `npx vitest --run --environment jsdom src/features/programming` (xem kết quả thật ở báo cáo A-F, mục B); `go build ./...` + `go vet` (xem cùng báo cáo) |
| Owner | FE + BE |
| Sequence | Phase 1, đã chạy trước tiên (không phụ thuộc WP khác) |
| Exit criteria | 4 trạng thái mới hiển thị đúng qua test; `latestCheck` xuất hiện trong response `GET /projects`/`GET /projects/{id}`; không phá vỡ test cũ (`BUG-016`/`BUG-018`) |

### WP-02 — Unsupported POU Guard — **DONE**

| Trường | Nội dung |
|---|---|
| Objective | UI không cho chọn `FUNCTION`/`FUNCTION_BLOCK` ở dropdown "Loại" khi Check chưa hỗ trợ biên dịch loại đó |
| Dependency | Không |
| Documents | Gap report §7.4 (`compilerInput()` chỉ nhận 1 object PROGRAM) |
| Design | Dropdown chỉ liệt kê `PROGRAM`; Program hiện có với `kind` khác (từ import bundle) vẫn hiển thị đúng giá trị thật kèm cảnh báo, không ẩn/mất dữ liệu |
| Implementation | `design/editor/ProgramsTab.tsx` (`ProgramInspector`) |
| Test | Chưa có test riêng trong phiên này — component không có test file cho `ProgramInspector` từ trước; ghi nợ ở Tracker |
| Evidence | Đọc code xác nhận dropdown chỉ còn `<option value="PROGRAM">`; `npm run lint`/`tsc --noEmit` (xem báo cáo A-F) |
| Owner | FE |
| Sequence | Phase 1, song song WP-01 |
| Exit criteria | Không còn cách nào tạo Program mới với kind khác PROGRAM qua UI; Program cũ với kind khác vẫn đọc/hiển thị đúng |

### WP-03 — FBD Registry Alignment — **DONE (bản vá tạm, xem Document Gate #7)**

| Trường | Nội dung |
|---|---|
| Objective | Registry hàm/FB FBD ở FE khớp đúng những gì compiler C++ chấp nhận |
| Dependency | Không |
| Documents | Gap report §8.4; xác nhận trực tiếp `st_program.cpp` (`kFuncTable`, `fb_spec`) |
| Design | Bỏ `SCALE`/`DEADBAND` (pure), `CTU`/`PI` (stateful) khỏi FE — không tồn tại backend; thêm `SQRT` (pure) — có ở backend nhưng thiếu ở FE |
| Implementation | `fbd/model.ts` (`pureFunctions`, `statefulFunctions`) |
| Test | Không có test cũ nào tham chiếu 4 identifier đã xoá (xác nhận bằng grep trước khi sửa) — không có regression để chạy lại riêng, phủ bởi `model.test.ts`/`commands.test.ts` hiện có |
| Evidence | `npx vitest --run src/features/programming/fbd` (xem báo cáo A-F) |
| Owner | FE + Compiler |
| Sequence | Phase 1, song song WP-01/02 |
| Exit criteria | `pureFunctions`/`statefulFunctions` khớp 1-1 với `st_func_from_name`/`StFbType` phía C++ (đã xác nhận thủ công; **chưa có generator tự động** — đó là scope của Document Gate #7 `FBD_LIBRARY_REGISTRY_SPEC`/single source of truth, không phải WP-03) |

### WP-04 — Language Documentation Alignment — **DONE**

| Trường | Nội dung |
|---|---|
| Objective | `ST_SUBSET_SPEC`/`PROGRAMMING_LANGUAGE_COMPILER_DESIGN` khớp implementation thật |
| Dependency | Không |
| Documents | Chính là deliverable của WP này |
| Design | Đọc trực tiếp `st_program.cpp` (`st_integer_min/max`, `kFuncTable`, `fb_spec`) làm nguồn sự thật, không suy đoán từ tài liệu khác |
| Implementation | `ST_SUBSET_SPEC_MK-DDC-24_VI.md` (1.0→1.1: sửa `INT`=int16 thay vì int32 sai, thêm `DINT`/`UINT`/10 hàm chuyển đổi/PID); `PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` (0.8→0.9: PID "target"→"Implemented") |
| Test | Không áp dụng (thay đổi tài liệu, không phải code) |
| Evidence | Diff hai file, đối chiếu trực tiếp dòng lệnh `grep`/`sed` vào `st_program.cpp` đã dẫn trong nội dung sửa |
| Owner | Compiler Lead + System Engineering |
| Sequence | Phase 1, làm trước để Document Gate mở cho các WP còn lại tham chiếu ngôn ngữ ST đúng |
| Exit criteria | Không còn khẳng định "DINT/UINT không có" hay "PID target" trong hai tài liệu; đã hoàn tất |

### WP-05 — FBD Palette — **NOT STARTED, chặn Document Gate #6**

| Trường | Nội dung |
|---|---|
| Objective | Cho phép tạo mọi loại block đã có trong registry (WP-03) qua UI, không chỉ AND |
| Dependency | Document Gate #6 (đặc tả UX cho palette); nên xong song song/sau #7 (registry chung) nếu có thể |
| Documents | `FBD_EDITOR_DESIGN` (cần tạo) |
| Design | Chưa viết — thuộc Document Gate #6 |
| Implementation | Dự kiến `fbd/StructuredFbdEditor.tsx` + `fbd/commands.ts` (thêm command `ADD_NODE` với `typeRef` chọn được, không hard-code `newAndNode()`) |
| Test | Component test cho từng nhóm palette (Interface/Logic/Math/Compare/Conversion/Timer/Trigger/Control/Constants) |
| Evidence | Chưa có |
| Owner | UX + FE |
| Sequence | Phase 2, đầu tiên trong nhóm FBD |
| Exit criteria | Tạo được node bất kỳ typeRef nào trong registry qua UI, có nhóm phân loại rõ trong palette |

### WP-06 — INPUT / OUTPUT / CONSTANT — **NOT STARTED, chặn Document Gate #6**

| Trường | Nội dung |
|---|---|
| Objective | Tạo/sửa node `INPUT`/`OUTPUT`/`CONSTANT` (tên biến, type, unit, direction, default) qua UI |
| Dependency | Document Gate #6; nên làm cùng lúc/ngay sau WP-05 (cùng cơ chế thêm node) |
| Documents | `FBD_EDITOR_DESIGN` (cần tạo) |
| Design | Chưa viết |
| Implementation | Dự kiến `fbd/commands.ts`, `fbd/StructuredFbdEditor.tsx`; đảm bảo `collectFbdInterfaceVariables()` (đã có, đọc node `kind IN (INPUT,OUTPUT)`) thu được dữ liệu thật sau khi UI tạo được các node này |
| Test | Unit test `collectFbdInterfaceVariables()` với node tạo qua UI thật (không phải fixture viết tay) |
| Evidence | Chưa có |
| Owner | UX + FE |
| Sequence | Phase 2, cùng nhóm WP-05 |
| Exit criteria | Một Program FBD dựng hoàn toàn qua UI có ít nhất 1 INPUT + 1 OUTPUT, `collectFbdInterfaceVariables()` trả đúng |

### WP-07 — FBD Inspector — **NOT STARTED, chặn Document Gate #6**

| Trường | Nội dung |
|---|---|
| Objective | Sửa `typeRef`/`parameters`/`variable`/`datatype`/`unit`/`executionOrder` của node đã chọn |
| Dependency | Document Gate #6 (field nào sửa được cho mỗi node kind) |
| Documents | `FBD_EDITOR_DESIGN` |
| Design | Chưa viết |
| Implementation | Dự kiến component mới `FbdInspector` trong `fbd/` |
| Test | Chưa có |
| Evidence | Chưa có |
| Owner | UX + FE |
| Sequence | Phase 2, sau WP-05/06 |
| Exit criteria | Chọn một node, sửa được toàn bộ field hợp lệ theo kind, validate tại chỗ (không round-trip Check để biết lỗi cơ bản) |

### WP-08 — FBD → Mapping Integration — **NOT STARTED**

| Trường | Nội dung |
|---|---|
| Objective | Biến giao diện FBD (từ WP-06) map được sang Point thật ở tab Điểm & Ánh xạ, cả chiều INPUT (đọc Point) và OUTPUT (ghi Point) |
| Dependency | WP-06 |
| Documents | `PROGRAMMING_INTERFACE_SPEC` (đã có, không cần sửa — mapping API đã tồn tại cho ST, chỉ cần FBD dùng chung) |
| Design | Tái dùng `MappingTab.tsx` hiện có (đã hoạt động cho ST) — không viết luồng mapping thứ hai riêng cho FBD |
| Implementation | Dự kiến không cần sửa `MappingTab.tsx` nếu `collectFbdInterfaceVariables()` (WP-06) trả đúng shape `StInterfaceVariable`-tương-đương đã dùng cho ST |
| Test | E2E: FBD INPUT → Point Mapping → binding trong artifact (đọc qua `GET /revisions/{id}` sau Check) |
| Evidence | Chưa có |
| Owner | FE + BE |
| Sequence | Phase 2, sau WP-06 |
| Exit criteria | Binding FBD xuất hiện đúng trong `SEC_IO_BINDING` sau Check, giống hệt luồng ST đã verify (D-07) |

### WP-09 — FBD Check/Commission/Runtime E2E — **NOT STARTED**

| Trường | Nội dung |
|---|---|
| Objective | Kịch bản AI→FBD→AO/DO chạy trọn Check PASSED→Commission→Runtime value thật |
| Dependency | WP-05, WP-06, WP-07, WP-08 |
| Documents | Không cần tài liệu mới — tái dùng `PROGRAMMING_VERIFICATION_PLAN` (#14), thêm kịch bản |
| Design | Không cần — dùng lại pipeline Check/Commission đã verify cho ST (D-07, `F-PROG-ASBUILT-013`) |
| Implementation | Không cần code mới nếu WP-05..08 đúng — đây là WP verify, không phải build |
| Test | Kịch bản: AI temperature → FBD INPUT → compare/control → OUTPUT → AO/DO → Check PASSED → Commission → runtime value verification (đúng mẫu đã chạy cho ST ở D-07 §4.5) |
| Evidence | Target Foxlinx thật, giống cách D-07 đã làm cho ST |
| Owner | QA + FE + BE + Core |
| Sequence | Phase 2, cuối cùng trong nhóm FBD |
| Exit criteria | **Chỉ khi kịch bản này PASS trên target thật, FBD mới được công bố "END-USER READY"** — đúng DoD §XII mục 8/9 của Lệnh CTO/Owner |

### WP-10 — ST Editor Upgrade — **NOT STARTED**

| Trường | Nội dung |
|---|---|
| Objective | Đánh giá syntax highlighting/autocomplete/signature help/hover/go-to-definition/formatter |
| Dependency | Không (Document Gate mở, nhưng D-03 của gap report gốc — "phạm vi editor ST Rev A" — vẫn cần Product+UX chốt trước khi code, không chỉ trước khi chọn thư viện) |
| Documents | Cần Technical Selection Record nếu chọn Monaco/CodeMirror |
| Design | Chưa viết |
| Implementation | Chưa bắt đầu |
| Test | Chưa có |
| Evidence | Chưa có |
| Owner | UX + FE |
| Sequence | Phase 3 |
| Exit criteria | Technical Selection Record được duyệt trước khi viết code editor thật; không tự chọn thư viện rồi báo cáo sau |

### WP-11 — PGM-02 3-column Layout — **NOT STARTED**

| Trường | Nội dung |
|---|---|
| Objective | Sửa G-7 (`F-PROG-ASBUILT-008`): Cây 280px / Editor / Inspector 308px, đúng `PROGRAMMING_UI_UX_DESIGN.md` §16.2 |
| Dependency | Không |
| Documents | `PROGRAMMING_UI_UX_DESIGN.md` §16.2 (đã có, đủ chi tiết) |
| Design | Grid CSS 3 cột ≥1440px; collapse ở 1024–1439px; kiểm responsive trước khi implement (theo đúng chỉ đạo §XI.D) |
| Implementation | `design/editor/ProgramsTab.tsx` (đổi `grid md:grid-cols-[280px_1fr]` hiện tại) |
| Test | Visual/responsive test desktop ≥1440, tablet 1024–1439 |
| Evidence | Chưa có |
| Owner | UX + FE |
| Sequence | Phase 3, độc lập WP-10 |
| Exit criteria | Layout khớp asset `KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02_ST_FBD_annotated_reference.png`; không phục hồi bố cục từ bộ SVG Programming đã loại |

### WP-12 — RETAIN Reset — **NOT STARTED**

| Trường | Nội dung |
|---|---|
| Objective | `POST /retain/reset` có handler thật thay vì luôn 503 (G-9) |
| Dependency | Không kỹ thuật, nhưng cần xác nhận business semantics trước (theo chỉ đạo §VI) |
| Documents | `PROGRAMMING_SECURITY_DESIGN.md` (RETAIN reset là mutation nhạy cảm — cần permission/audit rõ, xem D-05/§12 Readiness Matrix) |
| Design | Chưa viết — cần xác nhận: business semantics, permission, audit, runtime behavior, safety confirmation, error behavior (đúng thứ tự chỉ đạo §VI) trước khi code handler |
| Implementation | Chưa bắt đầu |
| Test | Chưa có |
| Evidence | Chưa có |
| Owner | Core + BE + FE + Safety |
| Sequence | Phase 4 |
| Exit criteria | Handler thật tồn tại VÀ đã qua review Safety — không code trước khi có xác nhận semantics |

### WP-13 — Artifact Trust — **NOT STARTED, chặn Document Gate #12**

| Trường | Nội dung |
|---|---|
| Objective | Quyết định cơ chế integrity cho artifact production (G-10, D-05) |
| Dependency | Document Gate #12 — `PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN` (mới) phải viết trước |
| Documents | Cần tạo `PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN` — threat model, signing, verification, key provisioning, key rotation, rollback protection, secure commissioning, audit, failure policy |
| Design | Chưa viết. Ghi chú kỹ thuật đã có: loader C++ đã hỗ trợ Ed25519 optional (`kFlagSigned`, `st_loader.cpp`, dùng `libsodium`) — hạ tầng verify đã sẵn, thiếu là quy trình ký + phân phối khoá |
| Implementation | Không code trước khi security design xong (đúng chỉ đạo D-05 "Security design là prerequisite trước production implementation") |
| Test | Chưa có |
| Evidence | Chưa có |
| Owner | Security + Compiler + BE |
| Sequence | Phase 4, sau WP-12 hoặc song song |
| Exit criteria | `PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN` được Security Architecture review và duyệt trước khi bật `integrityMode=SIGNED` cho bất kỳ target nào |

### WP-MULTIPROGRAM-ARCH — Multi-Program Architecture Study — **NOT STARTED, chặn Document Gate #1**

| Trường | Nội dung |
|---|---|
| Objective | Đánh giá migration từ `1 Program/1 Task` (as-built hiện tại, khoá ở 3 tầng FE/BE/FW-SOM) sang kiến trúc nhiều Program độc lập, NẾU Product Spec yêu cầu |
| Dependency | Document Gate #1 — PM/CTO phải chọn Product Spec authority (Rev A giữ nguyên, hay duyệt candidate V2.2 Hybrid) trước; #2 nếu cần tách `PROGRAMMING_BUSINESS_CORE_SPEC` riêng |
| Documents | 16 deliverable bắt buộc theo chỉ đạo §VII: current/target architecture diagram, domain model, execution model, scheduling model, process image model, program isolation, inter-program data sharing, output ownership, check/build model, commission/rollback model, RETAIN model, compatibility/migration, resource/WCET model, test/HIL strategy, phased implementation roadmap |
| Design | Chưa viết — đây chính là deliverable, không phải input |
| Implementation | **Không implement bất cứ gì tới khi Architecture Review duyệt** — đúng chỉ đạo "không được chỉ sửa `kMaxProgramsTotal` hoặc profile value rồi gọi là hoàn thành" |
| Test | Không áp dụng ở giai đoạn study |
| Evidence | Không áp dụng ở giai đoạn study |
| Owner | System Architect + Product + Runtime + Compiler + Core + Security |
| Sequence | Phase 5, tách biệt hoàn toàn khỏi Phase 1-4 |
| Exit criteria | 16 deliverable hoàn thành + Architecture Review duyệt; chỉ khi đó mới được mở Phase 5 implementation (ngoài phạm vi Master Plan này) |

---

## 5. Review model (đúng chỉ đạo §IX)

Mỗi WP qua tối thiểu 3 góc review độc lập trước khi đóng `DONE`:

1. **Product/UX review** — đúng UC/product intent?
2. **Architecture/Implementation review** — FE/BE/FW contract thống nhất?
3. **QA/Safety/Security review** — failure behavior, regression, evidence đủ?

WP-01..04 trong phiên này mới có review kỹ thuật của agent thực hiện (tự
kiểm bằng test + đọc lại source) — **chưa có review độc lập của người thứ
ba theo đúng mô hình 3 góc**. Ghi rõ ở Tracker để không tự nhận WP-01..04 là
"đã review đầy đủ" chỉ vì có test PASS.

## 6. Definition of Done — tham chiếu

DoD đầy đủ 15 mục nằm ở Lệnh CTO/Owner §XII, không lặp lại ở đây. Trạng thái
áp dụng cho từng mục được cập nhật trong
[`PROGRAMMING_IMPLEMENTATION_TRACKER.md`](PROGRAMMING_IMPLEMENTATION_TRACKER.md)
§2.

---

## 7. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.2 | 2026-09-08 | Sửa tham chiếu visual PGM-02 lịch sử sang PNG trong gói FE Handoff theo `AUTH-UX-PROG-2026-09-08-01`; plan vẫn Superseded và không quản task mới. |
| 1.0 | 2026-08-15 | Tạo mới theo Lệnh CTO/Owner. Phase 0 + Phase 1 (WP-01..04) DONE trong cùng phiên; Phase 2-5 lập kế hoạch đầy đủ, NOT STARTED, có điều kiện mở rõ ràng theo Document Readiness Matrix. |
| 1.1 | 2026-08-20 | Đồng bộ header/phase với Tracker: WP-01..08, WP-10..12 DONE; WP-09 BLOCKED; WP-13 DESIGN; multi-Program BLOCKED. Gắn Plan 59 làm candidate doc→code/release và đánh dấu §4 là task card lịch sử, không phải status authority. |
