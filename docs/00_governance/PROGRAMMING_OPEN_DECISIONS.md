# Programming Decision Register

| Thuộc tính | Giá trị |
|---|---|
| ID | `DEC-PROG-REGISTER-001` |
| Phiên bản | 1.7 |
| Trạng thái | **Baseline Active — change request PGM-02 v2.2 APPROVED; `F-P59-GHOST-POU-001` CLOSED; increment R1 và R2 ĐÓNG (`T59-801..813` DONE), R3 mở với `T59-814` READY. **Một quyết định ĐANG MỞ: `UD-PROG-014` (tab đa POU)**; `UD-PROG-013` còn phần dư cần disposition. Status authority của từng task là Plan 59, không phải hồ sơ này** |
| Ngày | 2026-08-25 |
| Chủ quản | Product + System Architecture |
| Authority | `ADR-050`; `AUTH-PROG-2026-08-20-04`; `AUTH-PROG-2026-08-24-05`; `CR-PROG-PGM02-V22-001` |

## 0. Kết luận

Mười hai quyết định unified theo ADR-050 vẫn `CLOSED` và tiếp tục làm authority
cho baseline hiện hành. Theo chỉ thị điện tử hiện hành,
`AUTH-PROG-2026-08-24-05` ghi nhận Phạm Đình Chương trong hai vai trò **Product
Owner/CTO + System Architect** đã review và pin exact Candidate commit
`413a043748dce3b44d2c5076412de761760ba17a`. Vì vậy `PLAN_READY[PGM02-V22]=PASS`,
ba gate `IMPLEMENT_READY[PGM02-R1|R2|R3]=GO`, `T59-801=DONE` và mười sáu task
`T59-802..817` trở thành task có authority. Scheduler vẫn bắt buộc đúng chuỗi
`R1 EDIT → R2 LIVE → R3 SIMULATE`; gate GO không cho phép bỏ qua predecessor.

`F-P59-GHOST-POU-001` đã `RESOLVED` bằng policy fail-closed và `ADR-053` đã
`Accepted` dưới cùng AUTH. Hai disposition này khóa thiết kế để implementation
tiếp tục; chúng không phải bằng chứng source/test/CI/target/HIL đã PASS. Riêng
`F-P59-GHOST-POU-001` nay đã có cả **implementation**: corrective 2026-08-25 đưa
catalog/checker/packager/writer về đúng semantics fail-closed và đạt affected
gate HOST. Điều đó đóng finding, **không** mở `IMPLEMENTATION_CLOSE` cho PGM-02
v2.2 và không suy ra bất kỳ evidence target/HIL nào.

Các review Compiler/Core/BE/FE/Controls/Security/QA của baseline ADR-050 tiếp tục
được thực hiện như hậu kiểm trong từng task. Riêng phạm vi PGM-02 v2.2 phải chạy
theo dependency và scoped acceptance ở `PROG-DRM-001`; finding hậu kiểm thuộc
task phải được sửa trước merge task đó.

Việc chưa có target/HIL/physical I/O/soak không phải Open Decision và không chặn
viết code; đó là **evidence bắt buộc để mở `RELEASE_READY`**.

## 1. Decision package hiện hành

| ID | Quyết định | Trạng thái | Authority |
|---|---|---|---|
| `UD-PROG-001` | Một Product Programming, không chia Rev A/Rev B. | CLOSED | ADR-050.1 |
| `UD-PROG-002` | Multi-Program: 32/Revision, tối đa 16 Enabled, period 1/5/30 s. | CLOSED | ADR-050.3 |
| `UD-PROG-003` | PROGRAM/FUNCTION/FUNCTION_BLOCK và rule state/I/O/lifecycle. | CLOSED | ADR-050.2/4 |
| `UD-PROG-004` | SYSTEM/PROJECT Control Library versioned, DAG acyclic. | CLOSED | ADR-050.2/4 |
| `UD-PROG-005` | Published Signal là typed runtime primitive, committed snapshot, không Point type mới. | CLOSED | ADR-050.5 |
| `UD-PROG-006` | Single output owner; Disable rút candidate tại safe boundary. | CLOSED | ADR-050.6 |
| `UD-PROG-007` | Independent scheduling/fault isolation; multicore giữ cùng semantics. | CLOSED | ADR-050.7 |
| `UD-PROG-008` | Sáu workspace `PGM-01..06`. | CLOSED | ADR-050.8 |
| `UD-PROG-009` | Core trace ring buffer; không action ma. | CLOSED | ADR-050.9 |
| `UD-PROG-010` | PID chỉ quảng bá ready sau Controls/Safety evidence. | CLOSED | ADR-050.9 |
| `UD-PROG-011` | Artifact/store/API/IPC versioned; dual-reader v1/v2 trong migration. | CLOSED | ADR-050 hệ quả |
| `UD-PROG-012` | Implementation review được waive khỏi entry; release evidence không waive. | CLOSED | ADR-050.10 |
| `UD-PROG-013` | Editor ST của PGM-02 **giữ bề mặt hiện tại cho R1**; không thêm CodeMirror 6 vào `apps/web-ui`. | CLOSED | Product Owner/CTO + System Architect, 2026-08-26 — [`GATE-PROG-ST-EDITOR-DEP-001`](PROGRAMMING_ST_EDITOR_DEPENDENCY_GATE.md) §4.1/§5 |
| `UD-PROG-014` | PGM-02 mở **nhiều tab POU** song song (phương án B). | **CLOSED** | Chủ sở hữu cấp ba ảnh render PGM-02 ngày 2026-08-27 kèm chỉ thị thi hành; cả ST lẫn FBD đều thể hiện tab bar |
| `UD-PROG-015` | Ba trường Inspector trong ảnh (`Access`, `Description`, `Cycle (in Task)` dạng tên Task) **chưa có nguồn dữ liệu** trong Draft v2. | **OPEN — chờ Owner** | Đo tại `ed6fb21`: `upsertProgramConfig` chỉ có `programId`/`objectId`/`periodMs` |

### 1.2 `UD-PROG-013` — bề mặt editor ST cho R1

| Thuộc tính | Giá trị |
|---|---|
| Quyết định | **Lựa chọn A** — giữ editor hiện tại cho R1; **không** thêm CodeMirror 6 |
| Ngày | 2026-08-26 |
| Authority | Product Owner/CTO + System Architect |
| Hồ sơ cổng | [`GATE-PROG-ST-EDITOR-DEP-001`](PROGRAMMING_ST_EDITOR_DEPENDENCY_GATE.md) |

Số đo quyết định (spike §4.1, đo thật ngoài repo để không đụng lockfile trước
khi duyệt):

| Mốc | Giá trị |
|---|---:|
| Bộ CodeMirror 6 tối thiểu + mode ST | **110,07 KiB gzip** |
| Chunk Programming hiện tại | 110,78 KiB gzip |
| Tổng nếu nhúng thẳng | ≈220,85 KiB gzip |
| Ngân sách R1 / R3 | 125 / 165 KiB gzip |

Nhúng thẳng vượt ngân sách R1 khoảng 77% và vượt luôn ngân sách R3, nên lựa
chọn C sẽ phải nâng trần vượt cả R3 — bỏ hẳn cơ chế ngân sách chứ không phải nới
nó. Lựa chọn B (nạp trễ) còn nợ ba phép đo chỉ thực hiện được trên bo.

**Hệ quả trực tiếp:** các AC của `WP-04` không đòi CodeMirror — chúng đòi hành
vi, và hành vi đó đã có test đầy đủ ở `T59-805`. Cổng đóng, `T59-805` đóng theo,
`T59-807` mở.

**Mở lại khi nào:** R2 trở đi, nếu người dùng thật sự cần hover chuột /
go-to-definition mức CodeMirror. Mở lại phải chạy nốt ba phép đo trên bo
(`openPouP95Ms`, `typingResponseP95Ms`, `steadyJsHeapMiB`) và kiểm build
offline/air-gapped.

> **Phần dư chưa xử lý — ghi nhận 2026-08-27.** Điều khoản "mở lại từ R2" ở trên
> đã **hết hạn mà không ai thực hiện**: R2 (`T59-810..813`) đóng ngày 2026-08-27
> và không task nào trong đó nhận hover chuột hoặc **chỉ mục ký hiệu do compiler
> sinh** (bullet BE của `PGM02-V22-WP-04`). Handoff `PGM-02A §4` liệt
> `hover symbol/type/signature` là **Required**, nên đây là phần dư của hợp đồng,
> không phải tính năng tuỳ chọn.
>
> `T59-820` nay nhận phần dư này với hai đường ra hợp lệ và **chỉ hai**: giao ở
> R3, hoặc Owner ký hoãn tường minh **có thời hạn**. Không chấp nhận để trạng
> thái trôi thêm một increment nữa.
>
> Nguồn: [`REC-PGM02-AUD-ADJ-001`](../07_records/reviews/PROGRAMMING_PGM02_AUDIT_GAP_ADJUDICATION_2026-08-27.md) `F-PGM02-AUD-003`.

### 1.3 `UD-PROG-014` — nhiều tab POU (ĐÃ CHỐT: phương án B)

| Thuộc tính | Giá trị |
|---|---|
| Quyết định | **Phương án B** — workspace PGM-02 mở nhiều tab POU song song |
| Trạng thái | **CLOSED** |
| Ngày | 2026-08-27 |
| Authority | Chủ sở hữu cấp ba ảnh render PGM-02 (`PGM-02A_ST_editor_reference.png`, `PGM-02B_FBD_editor_reference.png`, ảnh chú giải) kèm chỉ thị "implement bám theo thiết kế và plan" |
| Hồ sơ | `handoff_manifest.json` 2.3; `DDD-SW-PGM02-WORKSPACE-001` 0.5 §7.2/§7.3/§10.2 |

Ảnh ST hiện hai tab `AHU_Main.Main [ST]` và `AHU_Main.PID_Loop [ST]` kèm nút `+`;
ảnh FBD hiện `AHU_Main.FBD (FBD)` và `AHU_Main.Main (ST)` — tức tab **bắc qua cả
hai ngôn ngữ** trong cùng một workspace. Đó là câu trả lời cho câu hỏi mở của
`REC-PGM02-AUD-ADJ-001` `F-PGM02-AUD-004b`.

**Điều gói handoff v2.2 vẫn KHÔNG nói, và team phải chốt khi implement** (ghi vào
`TC-PGM02-TAB-01`, không tự ý mỗi người một kiểu):

1. số tab tối đa và hành vi khi vượt;
2. đóng tab có Draft bẩn — phải xác nhận, cấm mất buffer im lặng;
3. đổi mode `EDIT→LIVE/SIMULATE` áp cho **toàn workspace**, không phải từng tab;
4. tab có sống qua reload không, và nếu có thì khôi phục từ đâu;
5. tab trỏ tới POU đã bị xoá/đổi tên ở phiên khác.

Bất biến không được vi phạm: `objectId` là trục định danh của tab, **không** phải
tên POU (`UD-PROG-003`, DDD §3.5). Hai tab không bao giờ được chia chung một
buffer soạn thảo.

### 1.4 `UD-PROG-015` — ba trường Inspector chưa có nguồn dữ liệu (ĐANG MỞ)

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | **OPEN — chờ Product Owner/CTO + System Architect** |
| Ngày mở | 2026-08-27 |
| Chặn | Ba trường tương ứng của `T59-818`; **không** chặn phần còn lại |

Ảnh Inspector (ngữ cảnh Program) hiện bảy trường. Đo tại `ed6fb21`, Draft v2 chỉ
có `programId`, `objectId`, `periodMs` (`application/draft_v2.go:349-377`) cộng
`name`/`kind` ở `objects[]`. Đối chiếu:

| Trường trong ảnh | Nguồn thật | Kết luận |
|---|---|---|
| `Name` | `objects[].name` | có |
| `Language` | suy từ `replaceProgramSource.language` | có |
| `Type` | `objects[].kind` | có |
| `Cycle (in Task)` phần chu kỳ `1 s` | `programs[].periodMs` | có |
| `Access: Public` | — | **không có** |
| `Description` | — | **không có** |
| `Cycle (in Task)` phần tên Task `Control_Main` | — | **không có** — `UD-PROG-002` xếp lịch theo period 1/5/30 s cho từng Program, không có thực thể Task có tên |

Ba lựa chọn cho Owner: **(A)** bỏ ba trường khỏi Inspector cho tới khi có nhu cầu
thật; **(B)** thêm `description` (và `access`) vào Draft v2 bằng thay đổi additive
có migration, giữ nguyên quyết định không tạo thực thể Task; **(C)** dựng thực thể
Task có tên — việc này chạm `UD-PROG-002` và `PROGRAM_TASK_SCHEDULER_SPEC`, tức
phải sửa cả runtime.

**Khuyến nghị kỹ thuật (không phải quyết định):** A cho R3, B nếu Owner muốn giữ
đúng ảnh. **Tuyệt đối không** hiện `Public` hoặc một tên Task cứng ở FE để cho
giống ảnh — đó là bịa dữ liệu, vi phạm nguyên tắc số 1 của gói handoff.

### 1.1 `CR-PROG-PGM02-V22-001` — exact baseline được phê duyệt

| Thuộc tính | Giá trị |
|---|---|
| Nguồn đề xuất | [`REC-PGM02-ST-FBD-REDESIGN-REVIEW-001`](../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/reviews/PGM02_ST_FBD_REDESIGN_IMPLEMENTATION_REVIEW.md) và [`PLAN-PGM02-ST-FBD-REDESIGN-PROPOSAL-001`](../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/reviews/PGM02_ST_FBD_IMPLEMENTATION_PLAN.md) |
| Owner disposition | **APPROVED — Phạm Đình Chương, Product Owner/CTO, chỉ thị điện tử 2026-08-24** |
| System Architect disposition | **APPROVED EXACT REVISION — Phạm Đình Chương, System Architect, chỉ thị điện tử 2026-08-24** |
| Candidate review input | Git commit `413a043748dce3b44d2c5076412de761760ba17a`; khóa bytes trước authorization của contract/schema/ADR/handoff/SVG và manifest Candidate v1.48 |
| Exact authority revision | Manifest v1.49 khóa 17 hồ sơ Markdown hiện hành; contract/schema/Accepted ADR/handoff/SVG ngoài manifest khóa bằng SHA-256 tại §1.2. Không dùng riêng commit Candidate để tuyên bố nó chứa bytes post-authorization. |
| Phạm vi được mở | Toàn bộ `PGM02-V22-WP-00..13` theo scheduler bắt buộc `R1 EDIT → R2 LIVE → R3 SIMULATE`; không nhảy predecessor |
| Baseline được duyệt để implement | Formal `DDD-SW-PGM02-WORKSPACE-001`; `PGM02-WORKSPACE-V1`; `ADR-053` Accepted; 89 requirement/47 scenario; 17-file Markdown pin set; `T59-802..817` được promote thành READY/ORDERED |
| Phạm vi chưa được mở | `RELEASE_READY`; mọi claim M4/M5, Test Result, CI, target, HIL, physical I/O hoặc release chưa có evidence hiện hành |

Owner đã chốt ba đầu vào sản phẩm sau:

1. **Đóng `PGM02-V22-WP-00` và mở execution tuần tự.** Candidate exact commit
   nêu trên là đầu vào được duyệt cho implementation; mọi sửa đổi sau pin phải
   đi qua change control, manifest/hash và affected gate tương ứng.
2. **Thứ tự increment:** `R1 EDIT → R2 LIVE → R3 SIMULATE`. Mỗi increment có
   gate/capability state riêng; hoàn tất R1/R2 không được hiển thị hoặc tuyên bố
   R3 đã có.
3. **Simulation v1 admin-only cho mutation.** `viewer`/`operator`/`admin` được
   đọc session và snapshot theo object scope; chỉ `admin` được create/run/pause/
   step/reset/stop/set-input. Enforcement nằm server-side, có audit và negative
   RBAC test; FE permission chỉ là affordance, không phải authority.

Scoped gate hiện hành:

| Gate | Trạng thái | Điều kiện mở tiếp |
|---|---|---|
| `CHANGE_REQUEST[PGM02-V22]` | **APPROVED — `AUTH-PROG-2026-08-24-05`** | exact Candidate pin giữ nguyên hoặc thay đổi qua change control |
| `PGM02-V22-WP-00` | **DONE qua `T59-801`** | Candidate commit `413a043748dce3b44d2c5076412de761760ba17a` đã được Owner + Architect pin |
| `PLAN_READY[PGM02-V22]` | **PASS** | exact Candidate pin + formal DDD/contract/ADR/trace/VVP/task split đã được duyệt |
| `IMPLEMENT_READY[PGM02-R1]` | **GO** | `T59-802` READY; `T59-803..809` ORDERED theo predecessor |
| `IMPLEMENT_READY[PGM02-R2]` | **GO** | task có authority nhưng `T59-810` chỉ tự chuyển READY sau `T59-809 DONE` |
| `IMPLEMENT_READY[PGM02-R3]` | **GO** | `T59-813 DONE` 2026-08-27 nên `T59-814` đã tự chuyển READY; `ADR-053` Accepted |
| `RELEASE_READY` | **NO-GO** | VVP/Test Result/risk/target/HIL/release authority hiện hành |

Canonical ID của work package là `PGM02-V22-WP-00..13`. Tên ngắn `WP-00..13`
trong hai proposal chỉ là alias nội bộ, không trùng hoặc supersede WP lịch sử của
Plan56.

### 1.2 `AUTH-PROG-2026-08-24-05` — record uỷ quyền implementation

| Thuộc tính | Giá trị |
|---|---|
| Nguồn | Chỉ thị điện tử ngày 2026-08-24: CTO tự triển khai toàn bộ plan, tự động và bám plan/yêu cầu thiết kế |
| Người quyết định | Phạm Đình Chương — Product Owner/CTO + System Architect |
| Exact pin | `413a043748dce3b44d2c5076412de761760ba17a` |
| SHA-256 ngoài manifest | `pgm02_workspace_v1.json=2c2900661d75c97b2432c2c60e4b37cd48ee1b4272a64f2eb04eb2fed128fa63`; schema=`83236187e537f37884d16773cb45b377ef088116979dd676b8eca5f4469d5beb`; Accepted `ADR-053=d6f88c64e1e8db52c08e3f54255d658021d106ffe715c7508e1ecd96b72c4930` |
| SHA-256 handoff/visual | `PGM-02_PROGRAMS=4b1271797ec3a3a6d5d745d822ab4dec86209bcba9b5b222e2b921034541819b`; `QL_SIM_LIVE=aad49ad6e5d27360e02ed9a74eef1d2c9259f68db575c8b6a056951544fbda41`; ST SVG=`2e14de417e398e2267acdb1351e0baeb958d81d61e4137e9c638ca653dacbec6`; FBD SVG=`050750ba036675636ada9f695d919db0cb189fda6a1d43a1ad442d8a5aade4df`; combined SVG=`0a2d1291c0e718e0e01fe0b70d76c9e482e4f623c378e32d1283f9d9676f18c4` |
| Quyền mở | `PLAN_READY[PGM02-V22]=PASS`; `IMPLEMENT_READY[R1|R2|R3]=GO`; task scheduler tuần tự theo Plan59 |
| Review disposition | Consumer/discipline/Verification/Document Control: **WAIVED FOR IMPLEMENTATION**; finding vẫn sửa trong task và review/evidence bắt buộc cho release không bị waive |
| Maturity/evidence | Không giả chữ ký tay/chứng thư; không nâng Candidate design thành M4/M5; không suy Test Result, CI, target, HIL, physical I/O hoặc release PASS |
| Release | `RELEASE_READY=NO-GO` tới khi VVP/risk/target/HIL/release authority thật đạt |

### 1.3 `F-P59-GHOST-POU-001` — đã chốt semantics và đã sửa source/test

| Thuộc tính | Giá trị |
|---|---|
| Câu hỏi | POU kind `PROGRAM` không có entry trong `programs[]` phải có semantics Draft→Check→package nào? |
| Trạng thái | **CLOSED — quyết định `AUTH-PROG-2026-08-24-05`; implementation 2026-08-25** |
| Quyết định | Draft được phép giữ PROGRAM POU chưa schedule; Check và Package phải fail-closed bằng public `PRG-ERR-CHECK-001`, detail `ST-POU-005` |
| Bất biến | Tuyệt đối không âm thầm loại khỏi package/runtime và không synthesize chu kỳ 1000 ms |
| Ảnh hưởng | Đồng bộ SRS/DDD/contract/compiler-packager/test của `T59-301/302/305` và corrective task liên quan |
| Gate | Finding đã đóng; `IMPLEMENTATION_CLOSE` của PGM-02 v2.2 vẫn **PENDING** vì R1 mới đóng `T59-802` |
| Điều kiện đóng implementation | ĐÃ ĐẠT: catalog `1.7.2` map `ST-POU-005 → PRG-ERR-CHECK-001`; `packageTopology` phân nhánh theo `documentSchemaVersion` (v1 đọc chu kỳ TASK lịch sử, v2 giữ 0 để chặn); `packageArtifact` chặn ở biên và chỉ passthrough artifact v1 cho schema v1; writer Go/C++ từ chối `periodMs == 0` còn reader v2 vẫn đọc được package legacy; `TestCheckNeverTouchesActiveState` giữ zero Active/LKG mutation |
| Số đo (HOST, 2026-08-25) | `ctest` **1297/1297**; `go vet` + `go test ./... -count=1` PASS; pytest catalog **9/9**; `verify_programming_g1_contracts.py` **10/10** |

Resolution đóng câu hỏi thiết kế; corrective 2026-08-25 đóng nốt phần
implementation. Cả hai không phải bằng chứng target/HIL và không mở release.

## 2. Quyết định lịch sử bị supersede

`OD-PROG-001..017` và `AUTH-PROG-2026-08-11-03` vẫn có giá trị truy nguyên trong
Git, nhưng mọi phần sau đây không còn authority: một Task/một Program, bốn
workspace, thư viện/Enable/Published Signal để Roadmap sau, `HASH_ONLY` như đích
release hoặc chia scope theo Rev. Các phần không xung đột—RBAC server-side,
atomic Commission/LKG, RETAIN integrity, graph/program exclusivity, bounded
resource, audit và target/HIL truthfulness—được giữ trong Product v3.0/DDD mới.

## 3. Trách nhiệm hậu kiểm

| Reviewer | Phạm vi | Thời điểm | Tác động |
|---|---|---|---|
| Compiler/Controls | Function/FB/library/PID semantics | Trong task Wave 1–2 | Finding sửa trong task; PID label không ready khi evidence thiếu. |
| Runtime/Safety | scheduler/signal/output/disable/LKG | Trong task Wave 3–5 | Finding safety P0 chặn merge task liên quan, không chặn task độc lập. |
| Security | RBAC/artifact/library supply chain/audit | Trong mỗi contract task | Negative test bắt buộc. |
| Verification/Ops | fixture/evidence/deploy/rollback | Wave 6–7 | Chặn release nếu evidence thiếu; không giả verdict. |

## 4. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.5 | 2026-08-25 | Đóng `F-P59-GHOST-POU-001` ở lớp implementation: catalog `1.7.2`, checker/packager/writer fail-closed theo `documentSchemaVersion`, reader giữ tương thích package legacy; affected gate HOST PASS. Ghi `T59-802 DONE (HOST/LOCAL)` và `T59-803 READY`. Không đổi 12 quyết định unified; `RELEASE_READY` giữ NO-GO. |
| 1.6 | 2026-08-27 | Đồng bộ trạng thái sau khi increment R2 đóng (`T59-813 DONE`): header không còn dừng ở `T59-802`, và `IMPLEMENT_READY[PGM02-R3]` ghi đúng việc `T59-814` đã READY. Không mở hay đóng quyết định nào. |
| 1.5 | 2026-08-26 | Ghi `UD-PROG-013`: Owner/Architect chọn **lựa chọn A** ở `GATE-PROG-ST-EDITOR-DEP-001` — giữ bề mặt editor ST hiện tại cho R1, không thêm CodeMirror 6. Quyết bằng số đo thật (bộ tối thiểu 110,07 KiB gzip ⇒ nhúng thẳng ≈220,85 KiB, vượt cả ngân sách R3). Cổng CLOSED; `T59-805` đủ điều kiện đóng và `T59-807` mở. |
| 1.4 | 2026-08-24 | Ghi `AUTH-PROG-2026-08-24-05`: Product Owner/CTO + System Architect pin exact Candidate commit `413a043748dce3b44d2c5076412de761760ba17a`, mở PLAN_READY và ba IMPLEMENT_READY nhưng giữ scheduler R1→R2→R3, review ngoài owner/architect `WAIVED FOR IMPLEMENTATION` và RELEASE_READY NO-GO. Chuyển T59-801 DONE, T59-802 READY, T59-803..817 ORDERED. Chốt ghost PROGRAM fail-closed bằng `PRG-ERR-CHECK-001`/`ST-POU-005`; implementation closure vẫn PENDING tới khi source/test đạt. |
| 1.3-candidate | 2026-08-24 | Làm rõ exact pin hai lớp: manifest ghim 17 hồ sơ Markdown authority; record Owner + Architect phải ghi candidate Git commit SHA để khóa contract/schema/ADR/handoff/SVG. Pin check 17/17 một mình không mở `PLAN_READY` hoặc code. |
| 1.2-candidate | 2026-08-24 | Ghi output `T59-801`: formal DDD/contract/ADR-053/89 requirement/47 scenario/17-file Candidate pin và 16 card `T59-802..817`; chuyển WP-00 sang REVIEW, giữ Architect exact pin và mọi execution R1/R2/R3 NO-GO. |
| 1.1 | 2026-08-24 | Ghi `CR-PROG-PGM02-V22-001`: Owner mở duy nhất `T59-801`, khóa thứ tự R1 EDIT → R2 LIVE → R3 SIMULATE và Simulation v1 admin-only; System Architect/baseline pin giữ PENDING, code downstream NO-GO. Đăng ký riêng `F-P59-GHOST-POU-001` OPEN thay cho tuyên bố sai 0 Open Decision. |
| 0.1..0.9 | 2026-08-03..11 | Decision package `OD-PROG-001..017` cho baseline cũ; phục hồi qua Git. |
| 1.0 | 2026-08-20 | `ADR-050` supersede phạm vi xung đột; đóng 12 quyết định unified; 0 Open Decision/implementation blocker. |
