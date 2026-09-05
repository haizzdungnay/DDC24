# Review GAP — ST Editor MK-DDC-24 so với chuẩn "IEC 61131-3-aligned ST Editor"

| Thuộc tính | Giá trị |
|---|---|
| ID | `REV-STED-IEC-001` |
| Phiên bản | 1.2 |
| Ngày | 2026-08-31 |
| Trạng thái | **APPROVED WITH CONDITIONS (2026-08-31)**, phạm vi ngôn ngữ đã ký bằng `ADR-054` cùng ngày (xem §10) — chủ sở hữu duyệt bảng §8 kèm điều kiện bổ sung `ISS-STED-18/19/20`; đã bổ sung ở bản 1.1 và **đã tạo issue trên repo** (xem §8.2) |
| Baseline | `main` @ `661a714` (Merge PR #346) |
| Người thực hiện | Claude Code (review source), theo đề bài chuẩn ST Editor do chủ sở hữu cấp 2026-08-31 |
| Phạm vi code | `apps/core/application/st/`, `apps/core/application/programming/`, `apps/web-api/internal/programming/`, `apps/web-ui/src/features/programming/design/` |
| Authority đối chiếu | `DDD-LANG-PROG-001` (`PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md`), `SW-ST-SUBSET-MK-DDC-24-VI` (`ST_SUBSET_SPEC`), `DDD-SW-PGM02-WORKSPACE-001`, đề bài chuẩn 18 gate `G1..G18` + 12 `ST-UC-xx` |
| Tài liệu liên quan | [`PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14`](PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md), [`REC-PGM02-AUD-ADJ-001`](PROGRAMMING_PGM02_AUDIT_GAP_ADJUDICATION_2026-08-27.md) |

---

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. Tài liệu này dùng để làm gì? | Chấm ST Editor hiện tại theo 18 gate + 12 use case của chuẩn đề bài, ghi finding có dẫn chứng dòng mã, và đề xuất bảng issue để chủ sở hữu duyệt trước khi tạo trên repo. |
| 2. Kết luận một câu là gì? | **Lõi ngôn ngữ (L1/L2) và các bất biến an toàn (LKG, Draft/Active, giá trị runtime) đạt mức tốt; đường CHẨN ĐOÁN từ compiler tới mắt người dùng thì hỏng ở cả ba tầng** — mỗi lần Kiểm tra chỉ trả về đúng một lỗi, không có warning, mất thông điệp cụ thể, và trang soạn thảo PGM-02 không hiển thị lỗi ST nào. |
| 3. Có được gọi "IEC 61131-3-aligned" không? | **Chưa, cho tới khi issue #357 xuất bản hồ sơ ngôn ngữ.** Mâu thuẫn `CASE` đã được gỡ ngày 2026-08-31 bằng `ADR-054` + `DDD-LANG-PROG-001` 1.2, nhưng `G1` đòi *hồ sơ ngôn ngữ khớp code*, mà hồ sơ đó chưa tồn tại. Không phải vì thiếu tính năng, mà vì **không có hồ sơ ngôn ngữ nào khớp code đang chạy**: `DDD-LANG-PROG-001` §4.1 nói `CASE` bị parser từ chối, còn `st_parser.cpp` chấp nhận đầy đủ `CASE`. Gate `G1` FAIL. |
| 4. Cái gì hỏng nặng nhất với người dùng? | Viết sai một dòng ST, người dùng nhận đúng một câu: *"Kiểm tra thất bại hoặc quá thời gian."* — cả 19 mã lỗi `ST-LEX`/`ST-SYN`/`ST-SEM` gộp về một câu, và mỗi lần Kiểm tra chỉ hiện một lỗi. |
| 5. Bao nhiêu finding? | 15 finding: 4 High, 1 High (doc/authority), 7 Medium, 3 Low. Không có Critical an toàn: **không finding nào cho ghi sai I/O vật lý hoặc mất LKG**. |
| 6. Bao nhiêu issue? | **20 issue, chia 5 đợt** (17 đề xuất ban đầu + `ISS-STED-18/19/20` do chủ sở hữu yêu cầu khi duyệt). Đợt 1 (6 issue) là điều kiện cần để trình soạn thảo dùng được thật; đợt 2 (6 issue) là điều kiện cần để tuyên bố "IEC-aligned"; đợt 5 là **cổng bằng chứng chặn ký đóng review**. |
| 7. Đã đo gì thật trong phiên này? | `npx vitest --run --environment jsdom src/features/programming/design/editor` → **19 file / 292 test PASS** (2026-08-31, 5.90 s). Không dựng lại C++ nên **không** dẫn số ctest nào trong tài liệu này. |

---

## 1. Phạm vi, phương pháp và giới hạn

### 1.1 Đã đọc gì

| Tầng | Đường dẫn | Quy mô |
|---|---|---|
| Compiler ST (C++) | `apps/core/application/st/` | 20.927 dòng nguồn / 14.841 dòng test |
| Runtime Programming (C++) | `apps/core/application/programming/` | 24 tệp |
| Backend Check (Go) | `apps/web-api/internal/programming/` | `compiler/runner.go`, `application/checks.go` |
| Trình soạn thảo ST (FE) | `apps/web-ui/src/features/programming/design/editor/` | `ProgramsTab.tsx` 2.926 dòng + 24 module hỗ trợ |
| Hợp đồng | `contracts/programming/` | registry POU, error catalog, profile, PGM-02 |

### 1.2 Phương pháp

Đọc mã trực tiếp và truy nguyên **từng đường dữ liệu end-to-end**, không suy từ tài liệu:
nguồn ST → lexer/parser → semantic → IR → CLI JSON → Go runner → `DiagnosticView` → REST → FE
`ProblemsDrawer`/`SourceEditor`. Mọi finding dưới đây đều có **dẫn chứng tệp:dòng**; chỗ nào là
suy luận thì ghi rõ là suy luận.

### 1.3 Giới hạn của review này

- **Không dựng lại C++ trong phiên này.** Vì vậy không có số ctest nào được dẫn. Mọi kết luận về
  compiler là kết luận **đọc mã**, không phải kết luận chạy thử.
- **Không chạy trên bo Foxlinx.** Các finding về UI là finding cấu trúc mã, không phải quan sát
  màn hình thật.
- Không xét FBD editor (chỉ chạm khi nó chia sẻ khay Vấn đề với ST).

---

## 2. Kết luận điều hành

### 2.1 Theo 4 lớp của đề bài

| Lớp | Nội dung | Kết luận |
|---|---|---|
| **L1 — Language** | ST syntax, datatype, POU, expression, statement | **Đạt trong phạm vi profile đã chọn.** Ba loại POU đầy đủ, kiểu chặt thật, `CASE` có, user `FUNCTION`/`FUNCTION_BLOCK` có. Thiếu so với IEC: vòng lặp, `VAR_IN_OUT`, `ARRAY`/`STRUCT`/`STRING`, phần lớn hàm chuẩn IEC. Phần lớn là **cố ý và có lý do WCET**, nhưng hồ sơ công bố lại **không khớp code** (F-STED-005). |
| **L2 — Semantic/Compiler** | type check, scope, FB instance, diagnostics | **Nửa đạt.** Type check/scope/FB-instance làm nghiêm túc (fail-closed, không ép ngầm, `SEM-010` chặn gọi FB hai lần/chu kỳ). Nhưng **diagnostics chỉ đạt về toạ độ**, hỏng về số lượng (1 lỗi/lần), mức độ (không có warning) và nội dung (mất message). |
| **L3 — Engineering/PADT** | editor, debug, online monitor, navigation | **Nửa đạt.** Có POU Explorer, Quick Library, Inspector, Cross Reference, Code Map, Compare, EDIT/SIMULATE/LIVE, overlay giá trị runtime đúng chuẩn (không bao giờ vẽ 0 giả). Nhưng **không có bất kỳ chẩn đoán nào trong trang soạn thảo** (F-STED-001) và **không có signature help** (F-STED-008). |
| **L4 — UX/Productivity** | autocomplete, Quick Library, minimap, split view | **Đạt tốt.** Autocomplete + Quick Library + Code Map + Undo/Redo riêng + Find/Replace + Format an toàn (round-trip AST) + Command Palette. Đây là chỗ mạnh nhất của sản phẩm. |

### 2.2 Nhận định thẳng

Điểm mấu chốt của đề bài — *"FE editor, parser/compiler, library và runtime phải dùng cùng một
semantic model"* — **về cơ bản đã đúng ở chỗ tốn kém nhất**: thư viện hàm/FB của FE được **sinh
tự động** từ cùng một hợp đồng với C++ (`contracts/programming/pou_library_registry_v1.json` →
`library_registry.ts` + `st_library_registry_generated.hpp`), có test đối chiếu hai chiều
(`test_st_library_conformance.cpp`) và có checker chặn trôi trong `npm run build`. Danh sách từ
khoá tô màu cũng đọc thẳng từ `kKeywords[]` của C++. Đây là kiến trúc đúng và hiếm gặp.

Cái hỏng không nằm ở mô hình ngữ nghĩa, mà nằm ở **đường trả kết quả về cho người dùng**. Compiler
biết chính xác *"REAL cannot be assigned to BOOL"* ở dòng 18 cột 20 — nó tính ra chuỗi đó, ghi vào
JSON, Go đọc được vào `Diagnostic.Message` — rồi **vứt đi**, và người dùng đọc được đúng một câu
vô nghĩa. Ba tầng cùng làm hẹp một kênh: semantic dừng ở lỗi đầu tiên, CLI chỉ phát một phần tử,
BE ghi cứng `Severity: "ERROR"` và bỏ `Message`.

---

## 3. Chấm 18 gate `G1..G18`

| Gate | Yêu cầu | Kết quả | Bằng chứng / lý do |
|---|---|---|---|
| `G1` | Grammar profile được document/version hoá | **FAIL** | `DDD-LANG-PROG-001` §4.1 nói `CASE`/`FOR`/`WHILE`/`REPEAT` "ngoài subset, parser reject rõ"; `st_parser.cpp:975` `parse_case()` chấp nhận đầy đủ. `ST_SUBSET_SPEC` §5.5/§10/§11 cũng lạc hậu. → **F-STED-005/007** |
| `G2` | Datatype profile có test | **PARTIAL** | `BOOL/INT/DINT/UINT/REAL/TIME` có test (`test_st_lang.cpp`, `test_st_exec.cpp`, `test_st_ir.cpp`). `ST_SUBSET_SPEC` §3.1 tự ghi `DINT`/`UINT` là "Implemented — cần Test Result/V&V bổ sung": thiếu **hồ sơ V&V**, không thiếu test. |
| `G3` | Strict type checking | **PASS** | `st_semantic.hpp`: không ép ngầm giữa biến; ngoại lệ duy nhất là literal nguyên đa hình (`literal_polymorphic`); 22 hàm chuyển đổi tường minh trong `kFuncs[]`. |
| `G4` | `PROGRAM`/`FUNCTION`/`FUNCTION_BLOCK` đúng ngữ nghĩa | **PASS** | `StPouKind` (`st_program.hpp`); parser ép bất biến "chỉ FUNCTION có kiểu trả về và bắt buộc có"; `test_st_function_purity.cpp` chặn FUNCTION có state. |
| `G5` | Scope/interface đúng | **PARTIAL** | `VAR`/`VAR_INPUT`/`VAR_OUTPUT`/`VAR RETAIN` đúng, `VAR_INPUT` chỉ đọc (`ST-SEM-003`). **Không có `VAR_IN_OUT`** (`st_parser.cpp:660`) và thiếu sót này không được công bố ở §9 spec. → **F-STED-009** |
| `G6` | FB instance có state bền đúng ngữ nghĩa | **PASS** | `st_fb_instance_layout.cpp`, `st_retain.cpp`, `st_fb_retain_state_size()` dùng kích thước wire canonical chứ không `sizeof` — chống ghi padding ABI ra đĩa. |
| `G7` | Library có chữ ký authoritative | **PASS** | Registry hợp đồng → sinh cả TS và C++; `test_st_library_conformance.cpp` kiểm **hai chiều** (entry thiếu vector ⇒ đỏ, vector thừa ⇒ đỏ); entry có state đi bằng trace nhiều chu kỳ. 22 hàm FE ↔ 22 `kFuncs[]`, 9 FB ↔ 9 `StFbType`. |
| `G8` | Cú pháp sai không làm sập parser | **PASS** | `apps/core/application/st/fuzz/corpus/st_parser` + `test_st_fuzz_regression.cpp`; build `programming-fuzz`, `programming-fbd-ir-fuzz`, `programming-artifact-asan`. |
| `G9` | Diagnostic trả đúng vị trí nguồn | **PARTIAL** | Toạ độ đúng và đủ (`line`/`column`/`length` xuyên suốt tới FE, `F-PROG-ASBUILT-003` đã đóng). Nhưng chỉ có **một** diagnostic và **mất message**. → **F-STED-002/004** |
| `G10` | Source → IR/runtime có một semantic authority | **PARTIAL** | Compile/typecheck: một nguồn duy nhất (C++), Go chỉ là runner/packager — đúng. Nhưng FE có **ba bộ phân tích ST riêng** (`tokenizeStSource`, `buildStReferenceIndex`, `stFormat/parser.ts`); chỉ *danh sách từ khoá* có cơ chế chống trôi. → **F-STED-011** |
| `G11` | Save Draft không đổi Active | **PASS** | `useDraftWorkspace` chỉ ghi Draft; Check chạy trên revision đã niêm phong (`checkDisabledReason` chặn Kiểm tra khi buffer bẩn); không tồn tại nút "Save & Run" nào trong toàn bộ `apps/web-ui/src`. |
| `G12` | Runtime failure không làm mất LKG | **PASS** | `programming_runtime_coordinator.cpp:323/339/571` — journal boot action `USE_LKG_CANDIDATE_NOT_AUTO_PUBLISHED`, `VERIFY_ACTIVE_THEN_FINISH_OR_LKG`, rollback toàn gói. |
| `G13` | LIVE đọc Active thật | **PASS** | `LiveProgramView` nhận `activeRevisionId` từ project; `programsMode.ts` cấm tự hạ cấp mode và cấm dựng simulator trong trình duyệt. |
| `G14` | Thiếu giá trị runtime không thành 0 | **PASS** | `presentStRuntimeValue()` (`StRuntimeValueOverlay.tsx:56`) — `valid=false`/`BAD`/`OFFLINE`/`UNKNOWN`/`UNAVAILABLE` luôn ra `—`; `STALE` giữ giá trị nhưng có nhãn; có cả cờ `producerRestarted`. Đây là mẫu mực. |
| `G15` | Quick Library không sinh mã compiler không nhận | **PASS** | `stInstanceInsertion.ts` tách khai báo vào khối `VAR` và lời gọi vào thân trong **một** lần sửa buffer (một bước Undo), vì parser đọc hết `VAR` trước rồi mới tới câu lệnh. Có che chú thích trước khi tìm vùng khai báo. |
| `G16` | Keyboard workflow | **PARTIAL** | Có `Ctrl+P/F/Z/Y/I/G`, `Ctrl+Shift+F`, tablist/dialog có focus trap. Nhưng **không có hợp đồng phím phiên bản hoá cho ST** trong khi FBD đã có `contracts/programming/fbd_keyboard_commands_v1.json`. → **F-STED-014** |
| `G17` | Accessibility/contrast/focus | **PARTIAL** | `aria-label`/`role`/`aria-describedby`/`focus-visible` dùng đúng và dày; nhưng **không có kiểm a11y tự động** (không axe) và không có record bằng chứng cho ST editor. → **F-STED-015** |
| `G18` | Test vector positive + negative | **PARTIAL** | Có corpus thù địch + fuzz + 33 tệp test C++. Thiếu **ma trận đối chiếu vector ↔ luật văn phạm** để trả lời "luật nào chưa có vector nào". |

**Tổng: 9 PASS · 8 PARTIAL · 1 FAIL.**

---

## 4. Chấm 12 Golden Use Case

| UC | Nội dung | Kết quả | Ghi chú |
|---|---|---|---|
| `ST-UC-01` | Tạo ST Program | **PASS** | `PouExplorer` + `pouCommands.ts` + `pouTemplates.ts` |
| `ST-UC-02` | Khai báo biến | **PASS** | `InsertPointVariablePanel`, hoàn tác một bước |
| `ST-UC-03` | Viết logic + validation | **FAIL** | Không có validation nào trong lúc gõ, kể cả cú pháp. → F-STED-001 |
| `ST-UC-04` | Chèn Function | **PASS** | Quick Library → `stInstanceInsertion` |
| `ST-UC-05` | Chèn Function Block | **PASS** | `FbInstancePicker` + tách khai báo/lời gọi |
| `ST-UC-06` | Lưu Draft, Active không đổi | **PASS** | — |
| `ST-UC-07` | Kiểm tra → diagnostic đúng range | **PARTIAL** | Range đúng nhưng **một lỗi mỗi lần** và message chung chung. → F-STED-002/004 |
| `ST-UC-08` | Bấm lỗi → tới đúng nguồn | **PARTIAL** | Có deep-link `?program&line&column&length` từ PGM-03 sang PGM-02 và có tự cuộn (`scrollTopForLine`). Nhưng sang tới nơi thì **không có dấu lỗi nào trên mã** — chỉ có vùng chọn. |
| `ST-UC-09` | Tìm tham chiếu | **PASS (có điều kiện)** | `StCrossReferencePanel` + `stReferenceIndex` tách READ/WRITE, tự khai "không xác định được" thay vì đoán. Nguồn là regex FE, không phải bảng ký hiệu compiler. |
| `ST-UC-10` | Mô phỏng | **PASS** | Sandbox worker riêng tiến trình; capability đọc từ server, không đoán; không bao giờ chạm output vật lý. |
| `ST-UC-11` | Giám sát LIVE | **PASS** | Chỉ đọc với mọi vai, kể cả admin. |
| `ST-UC-12` | So sánh Draft ↔ Active | **PASS** | `CompareDrawer` + `lineDiff.ts` |

---

## 5. Finding chi tiết

Quy ước mức: **High** = chặn tuyên bố "trình soạn thảo dùng được/aligned"; **Medium** = làm giảm
đáng kể chất lượng công cụ hoặc độ tin của hồ sơ; **Low** = lệch hợp đồng, chưa gây hại trực tiếp.

---

### `F-STED-001` — **High** — PGM-02 không hiển thị bất kỳ chẩn đoán ST nào

**Triệu chứng.** Trong chế độ `EDIT`, người dùng gõ ST sai cú pháp hay sai kiểu đều **không thấy
gì**: không gạch chân, không khay Vấn đề, không đếm lỗi. Phải Lưu → sang PGM-03 → chạy Kiểm tra
mới biết.

**Bằng chứng.**
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx:48` khai
  `const EMPTY_DIAGNOSTICS: ProgrammingDiagnostic[] = []`, và dòng `763` truyền
  `diagnostics={EMPTY_DIAGNOSTICS}` cho `ProgramsTab` — **đây là nơi duy nhất `ProgramsTab` được
  mount trong toàn bộ FE** (`grep '<ProgramsTab'`).
- `apps/web-ui/src/features/programming/design/workbench/DesignWorkbench.tsx:110`:
  `if (program.language !== 'FBD') continue` — khay Vấn đề của workbench **bỏ qua mọi POU ST**.
  POU FBD được validate phía FE (`validateFbdDocument`), POU ST thì không có gì.
- `ProblemsDrawer` chỉ được mount ở `CheckCommissionPage.tsx:261` (PGM-03), dù chính docstring của
  nó (`ProblemsDrawer.tsx:8`) viết *"dùng chung cho ba tab của PGM-02 và cho PGM-03
  (DDD-FE-PROG-001 §2)"*.

**Hệ quả kéo theo — mã chết.** Toàn bộ hạ tầng hiển thị lỗi đã viết trong `SourceEditor` **không
đường nào chạy tới**: `diagnosticRanges` (`ProgramsTab.tsx:1193`), `mergeDiagnosticRanges`, tooltip
`code (detailCode)` (`ProgramsTab.tsx:2042`), dòng `aria-describedby` đếm diagnostic
(`ProgramsTab.tsx:2428`). Chúng chỉ sống trong test.

**Nguyên nhân gốc.** Quyết định `D-01` chuyển quyền sở hữu Check sang PGM-03 là đúng (một luồng
seal/run/poll duy nhất), nhưng khi gỡ Check khỏi PGM-02 thì **không ai nối lại đường đọc kết quả
Check gần nhất** về trang soạn thảo. Đó là bỏ sót, không phải thiết kế.

**Tác động.** `ST-UC-03` FAIL, `ST-UC-08` chỉ đạt một nửa. Vòng lặp sửa lỗi của kỹ sư là
gõ → lưu → đổi trang → chờ Check → đọc một lỗi → đổi trang về → sửa → lặp lại.

---

### `F-STED-002` — **High** — Mỗi lần Kiểm tra chỉ trả về đúng MỘT diagnostic

**Bằng chứng.**
- `st_semantic.hpp:15`: *"Fail-fast: dừng ở lỗi đầu tiên, trả 1 StDiagnostic"*.
- `apps/core/application/st/st_compile_main.cpp:145` — hàm `fail()` là **đường duy nhất** phát
  diagnostic: `j["diagnostics"] = array({ <một phần tử> })`. Đường thành công
  (`st_compile_main.cpp:1083`) phát mảng **rỗng**.
- Nơi duy nhất trong compiler thu được **nhiều** diagnostic thì lại vứt phần còn lại:
  `st_compile_main.cpp:647-651` gọi `resolve_io_bindings(..., &binding_diagnostics)` rồi lấy
  `binding_diagnostics.front()`.
- Mã `ST-LIM-006` = "diagnostics truncated" (`st_diagnostic.hpp:79`) đã có trong error catalog và
  đã được ánh xạ ở Go/TS, nhưng chỉ được set ở `st_io_map.cpp:21` — tức là hạ tầng nhiều-diagnostic
  đã được *thiết kế* rồi bỏ dở.

**Lệch hợp đồng đã duyệt.** `DDD-LANG-PROG-001` §7 quy định rõ: *"Tối đa 64 diagnostic, sort theo
program/order/location/code; đạt trần thêm đúng một `ST-LIMIT-DIAG-001`"*. Hiện thực là 1.

**Tác động.** Một POU có 5 lỗi cần 5 vòng Kiểm tra. Với Check chạy trên revision đã niêm phong, mỗi
vòng là một lần Lưu + một lần seal + một lần chờ worker.

---

### `F-STED-003` — **High** — Kênh WARNING chết trên cả ba tầng

**Bằng chứng.**
- `st_diagnostic.hpp:15` khai `enum class StSeverity { ERROR, WARNING };`. Quét toàn bộ
  `apps/core/application/st/` (trừ test): **không có một dòng nào gán `StSeverity::WARNING`**. Tất
  cả 12 chỗ set severity đều là `ERROR`.
- `st_compile_main.cpp:146` ghi cứng `{"severity", "error"}`.
- `apps/web-api/internal/programming/compiler/runner.go:132` có parse trường `Severity` — nhưng
  `grep '\.Severity'` trên toàn bộ `apps/web-api/internal/programming` (trừ test) **không có nơi
  nào đọc nó**. `application/checks.go:805-813` `compilerDiagnostic()` ghi cứng
  `Severity: "ERROR"`.

**Hệ quả.**
- `ST-WARN-001` (PT timer nhỏ hơn chu kỳ Task), `ST-WARN-002` (biến khai báo không dùng),
  `ST-WARN-003` (`VAR_OUTPUT` không bao giờ được gán) — đặc tả ở `ST_SUBSET_SPEC` §12.6 — **không
  bao giờ tới người dùng**.
- Cảnh báo mà `DDD-LANG-PROG-001` §4.3 **bắt buộc** ("Read output FB trước call là giá trị cycle
  trước và **phải có warning**") không tồn tại.
- `ProblemsDrawer.tsx:105-106` đã viết sẵn icon/màu cho `WARNING` và `INFO` → mã chết.
- Câu trong DDD §7 *"Warning không chặn trừ policy target profile nâng thành error"* hiện vô nghĩa
  vì không có warning nào để nâng.

---

### `F-STED-004` — **High** — Thông điệp cụ thể của compiler bị vứt trước khi tới người dùng

**Triệu chứng.** Mọi lỗi ST — token lạ, thiếu `;`, gán `REAL` vào `BOOL`, gọi FB hai lần trong một
chu kỳ, nhãn `CASE` trùng — đều hiển thị đúng một câu:
> **"Kiểm tra thất bại hoặc quá thời gian."**

**Bằng chứng.**
- Compiler tính message chính xác và ghi ra JSON (`st_compile_main.cpp:146` trường `message`);
  Go parse vào `Diagnostic.Message` (`runner.go:132-140`).
- `application/checks.go:49-56` — `DiagnosticView` **không có trường `Message`**, và
  `compilerDiagnostic()` (dòng 805-813) chỉ lấy `Code`, `DetailCode`, `Location`. `Message` bị bỏ.
- `args` chỉ được điền `{line, column, length}` cho mã `ErrCheck` — **không có `expected`/`actual`**
  như DDD §7 quy định.
- FE render `programmingErrorCopy(pick, diagnostic.code)` (`ProblemsDrawer.tsx:126`) với
  `diagnostic.code` là **mã công khai** (`PRG-ERR-CHECK-001`), không phải `detailCode`
  (`ST-SEM-002`). Bảng `errorCopy.ts:26` trả đúng một câu cho `PRG-ERR-CHECK-001`.
- `detailCode` **có** trong payload nhưng chỉ được dùng ở tooltip gạch chân trong editor
  (`ProgramsTab.tsx:2042`) — mà theo `F-STED-001` thì tooltip đó không bao giờ hiện.

**Quy mô gộp.** Tra `errors_generated.go:182`: 3 mã `ST-LEX-*` + 2 mã `ST-SYN-*` + 14 mã `ST-SEM-*`
đều ánh xạ về `ErrCheck` → **19 loại lỗi khác nhau hiển thị y hệt nhau**.

---

### `F-STED-005` — **High (doc/authority)** — Không có hồ sơ ngôn ngữ nào khớp code đang phát hành

**Bằng chứng.**

| Nguồn | Nói gì | Code làm gì |
|---|---|---|
| `DDD-LANG-PROG-001` §4.1 (Target authority) | *"`CASE`, `FOR`, `WHILE`, `REPEAT` … vẫn ngoài subset vì không có bounded WCET rule; **parser reject rõ**"* | `st_parser.cpp:817` `if (at_kw("CASE")) return parse_case(...)`; `parse_case()` ở dòng 975 xử lý nhãn rời, dải `1..3`, trùng nhãn, `ELSE`, `END_CASE`, khử đường về cây `IF/ELSIF` |
| `ST_SUBSET_SPEC` §5.5 | `CASE` và user `FUNCTION`/`FUNCTION_BLOCK` "không có trong Rev A.0" | Cả ba đều có (`T59-101..104`) |
| `ST_SUBSET_SPEC` §10 EBNF | Không có luật `CASE` | Có |
| Thực tế vận hành | — | Chương trình AHU thật trên bo dùng `CASE AhuState OF` (ghi trong `stEditorSupport.ts:8-20`) |

**Vì sao đây là High.** Đề bài đặt `G1` làm gate đầu tiên: *"Grammar profile được document/version
hoá"*. Hiện tại **cả hai** tài liệu ngôn ngữ đều sai theo hai hướng ngược nhau, và tài liệu Target
đã-được-duyệt còn tuyên bố parser **từ chối** thứ mà parser **chấp nhận**. Không thể ký một tuyên
bố "IEC 61131-3-aligned" trên nền đó; và nguy hiểm hơn, một người đọc DDD sẽ tin `CASE` không tồn
tại rồi thiết kế review/test theo niềm tin đó.

**Lưu ý.** Lỗi hiển thị `CASE` không được tô màu đã sửa (`DEV-PROG-022`, có test đọc thẳng tệp C++).
Cái còn lại là **hồ sơ**, chưa ai sửa.

> **Cập nhật 2026-08-31 — đã xử lý một nửa.** Chủ sở hữu ra nguyên tắc "làm chuẩn theo IEC: có thì
> giữ, không có thì bỏ" ⇒ IEC có `CASE` ⇒ **giữ**. Đã ký `ADR-054` và sửa `DDD-LANG-PROG-001` lên
> 1.2: §4.1 tách `CASE` khỏi nhóm vòng lặp, §4.3 thêm `CASE` kèm **luật WCET** (khử đường về
> `IF/ELSIF`, không thêm opcode IR, tập nhãn chặn trên bởi `kMaxStatements`). Issue #356 đóng.
> Phần còn lại của `F-STED-005` — **hồ sơ ngôn ngữ khớp code** — vẫn mở ở #357, nên `G1` vẫn FAIL.

---

### `F-STED-006` — **Medium (doc)** — `ST_SUBSET_SPEC` §3.1 ghi sai miền `TIME`

`ST_SUBSET_SPEC` §3.1 dòng 104: `TIME` = *"0 … ~292 năm"*. Code chặn literal ở **24 giờ**:
`st_limits.hpp:57` `kMaxTimeLiteralNs = 86400000000000ll`, dùng ở `st_parser.cpp:195`.
`DDD-LANG-PROG-001` §4.2 ghi đúng ("0..24 h"). Bản As-Built sai.

---

### `F-STED-007` — **Medium (doc)** — Bảng đối chiếu §11 của `ST_SUBSET_SPEC` đã hoàn toàn lạc hậu

§11 pin ở commit `7ccf992` và kết luận *"parser hiện tại phủ được khoảng **40%** grammar"*, liệt kê
`INT`, `TIME`, `ELSIF`, `XOR`, số học, gọi FB, truy cập thành viên, chú thích là "❌ phải thêm" —
tất cả đều đã có từ lâu. Một bảng đối chiếu sai 100% nguy hiểm hơn không có bảng, vì nó trông như
bằng chứng.

---

### `F-STED-008` — **Medium** — Không có signature help / gợi ý tham số

**Bằng chứng.** `buildStCompletions()` (`stEditorSupport.ts:456`) trả về `{label, kind, detail}` với
`detail` là chuỗi cố định `'hàm chuẩn'` / `'kiểu function block'`. Không có tra cứu tham số, không
có popup khi gõ `(`, không có highlight tham số đang nhập.

**Nghịch lý.** Dữ liệu đã có sẵn và đã được sinh tự động: `PROGRAMMING_LIBRARY_ENTRIES` mang đủ
`ports: [{name, direction, dataType}]` cho cả 46 entry; `QuickLibraryPanel.tsx:292` **đã** vẽ bảng
cổng từ chính dữ liệu đó. Chỉ là trình soạn thảo không dùng.

**Tác động.** Người dùng gõ `LIMIT(` phải tự nhớ thứ tự `(MN, IN, MX)`; gõ `PID_1(` phải tự nhớ 6
tham số và **quy tắc chỉ-gọi-theo-tên** (khác biệt cố ý `D4`) — sai là một vòng Check.

---

### `F-STED-009` — **Medium** — Không có `VAR_IN_OUT`, và thiếu sót này chưa được công bố

`st_parser.cpp:660`: `at_var_block_start()` chỉ nhận `VAR`, `VAR_INPUT`, `VAR_OUTPUT`.
`VAR_IN_OUT` **không xuất hiện** trong `StStorage`, không có trong §2 (cấu trúc chương trình),
không có trong §5.5 (danh sách "không có trong Rev A.0") và **không có trong bảng §9 "Khác biệt cố
ý so với IEC 61131-3"** — tức là nó không phải "cố ý", nó chỉ đơn giản không được nhắc tới.
`DDD-LANG-PROG-001` §4.1 cũng chỉ cấp `input/output/local/private state` cho `FUNCTION_BLOCK`.

Với IEC, `VAR_IN_OUT` là một phần của interface POU (đề bài xếp vào L1/`G5`). Cần **một quyết
định**: hỗ trợ, hoặc ghi vào §9 kèm lý do.

---

### `F-STED-010` — **Medium** — Inspector cho ký hiệu ST thiếu 4/8 trường mà chuẩn yêu cầu

`InspectorStSymbolContext` (`inspectorContext.ts:88-98`) có: `identifier`, `definitionOffset`,
`dataType`, `signature`, `referenceCount`, `runtime`.

Đề bài §12 yêu cầu thêm: **Scope** (`VAR`/`VAR_INPUT`/…), **Initial**, **Mapped Point**, **Unit**,
và tách **Reads/Writes**. Dữ liệu đã có sẵn ở nơi khác: `stReferenceIndex` đã phân biệt
`role: 'READ' | 'WRITE'`, `MappingTab` đã biết điểm ánh xạ và đơn vị, trường `Ánh xạ` đã tồn tại
trong `ContextInspector.tsx:181` nhưng **cho ngữ cảnh khác**, không cho ký hiệu ST.

---

### `F-STED-011` — **Medium** — Ba bộ phân tích ST trong TypeScript, chỉ từ khoá được chống trôi

**Bằng chứng.** FE có ba bộ đọc ST độc lập với compiler:
1. `tokenizeStSource()` (`stEditorSupport.ts:111`) — tô màu, bracket match, autocomplete.
2. `buildStReferenceIndex()` (`stReferenceIndex.ts`) — regex, dựng bảng ký hiệu để điều hướng.
3. `stFormat/{lexer,parser,printer}.ts` (1.181 dòng) — một **parser ST đầy đủ** cho nút Định dạng.

Cơ chế chống trôi hiện có: `scripts/generate_st_reserved_words.py --check` (chạy trong
`npm run build`) + `stKeywordMirror.test.ts` — **chỉ phủ danh sách từ khoá**. Văn phạm, hệ kiểu,
quy tắc scope không có gì canh.

**Đã có bằng chứng trôi thật.** `stFormat/parser.ts:286-288` parse `FOR`/`WHILE`/`REPEAT` và
`ast.ts` có node `Index` (`a[i]`) — bốn thứ compiler **không có**. Formatter hiện an toàn nhờ kiểm
round-trip AST (`stFormat/index.ts`: parse → print → parse lại → so cây ngữ nghĩa, khác thì **không**
format), nên đây là rủi ro chưa thành sự cố. `DEV-PROG-022` là lần trôi đã thành sự cố người dùng
báo.

**Ghi nhận công bằng.** Cả hai module đều **tự khai đúng thẩm quyền của mình** trong docstring
("không phải parser", "không phán nguồn đúng/sai — đó là việc của Check"). Đây là cách viết đúng.
Vấn đề còn lại là thiếu cơ chế cơ học chống lệch, không phải thiếu ý thức.

---

### `F-STED-012` — **Low** — Namespace mã diagnostic lệch giữa DDD và code

`DDD-LANG-PROG-001` §7 công bố namespace `ST-LEX-*`, `ST-SYN-*`, `ST-SEM-*`, **`ST-LIMIT-*`**,
`FBD-SCHEMA-*`, `FBD-SEM-*`, `COMP-INTERNAL-*`, và lấy ví dụ mã `ST-SEM-TYPE-001`.
Code dùng **`ST-LIM-001..009`** (`st_diagnostic.hpp:72-84`) cộng thêm `ST-CLI-LIMIT`,
`ST-IOMAP-*`, `ST-LIB-*`, `ST-POU-*`, `ST-SIG-*`, `ST-OWN-*`, `ST-PID-*`, `ST-WORKER-*` — tám
namespace DDD không nhắc. Mã kiểu là `ST-SEM-002`, không phải `ST-SEM-TYPE-001`.

---

### `F-STED-013` — **Low** — Thiếu trường `related[]` và `args {expected, actual}`

`DDD-LANG-PROG-001` §7 định nghĩa payload diagnostic có `related: []` và
`args: {"expected":"REAL","actual":"BOOL"}`. `DiagnosticView` (`checks.go:49-56`) không có
`related`; `ProgrammingDiagnostic` (FE `model/types.ts:521-528`) cũng không. Đây là điều kiện kỹ
thuật để làm được "Related symbol" và "Suggested action" mà đề bài §7 yêu cầu.

---

### `F-STED-014` — **Low** — Không có hợp đồng phím phiên bản hoá cho ST editor

FBD có `contracts/programming/fbd_keyboard_commands_v1.json` (có validator
`verify_programming_fbd_contract.py`). ST không có tệp tương đương, dù ST editor mới là nơi có
nhiều phím tắt hơn (`Ctrl+P/F/Z/Y/I/G`, `Ctrl+Shift+F`, Tab/Enter auto-indent, điều hướng
completion). Không có hợp đồng ⇒ không có test nào chặn việc một phím bị đổi hoặc mất.

---

### `F-STED-015` — **Medium** — Thiếu bảng phân loại "IEC bắt buộc" vs "Mekong UX"

Đề bài §17 yêu cầu đưa phân loại này vào ma trận truy vết để về sau không ai viết "IEC bắt buộc
phải có Quick Library". Rà `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` (533 dòng): ma trận
nối Product → 89 requirement → DDD → task → scenario, **không có trục phân loại chuẩn**. Không có
tài liệu nào trong repo phân biệt "cái này do IEC 61131-3 quy định" với "cái này là lựa chọn sản
phẩm của Mekong".

Rủi ro là rủi ro tuyên bố: `ST_SUBSET_SPEC` §0 đã nói đúng nguyên tắc ("không claim
compliant/conformant/certified"), nhưng không có cơ chế nào giữ nguyên tắc đó khi tài liệu bán hàng
hay hồ sơ chứng nhận được viết bởi người khác.

---

## 6. Phân loại "IEC bắt buộc" vs "Mekong UX" (đề xuất đưa vào RTM)

Bảng dưới là **đề xuất nội dung** cho issue `ISS-STED-09`.

| Hạng mục | Phân loại | Trạng thái MK-DDC-24 |
|---|---|---|
| Cú pháp/ngữ nghĩa ST | **IEC 61131-3** | Có, theo profile hẹp |
| POU `PROGRAM`/`FUNCTION`/`FUNCTION_BLOCK` | **IEC** | Có đủ ba |
| Hệ kiểu, kiểu dẫn xuất | **IEC** | 6 kiểu cơ sở; **không** có kiểu dẫn xuất |
| Dữ liệu cục bộ + interface POU | **IEC** | Có, thiếu `VAR_IN_OUT` |
| Thư viện hàm/FB chuẩn | **IEC** | Tập con + 3 khối phi chuẩn (`PID`, `SCALE`, `DEADBAND`, `HYSTERESIS`) |
| Parser/type checker | Bắt buộc để hiện thực ngữ nghĩa IEC | Có |
| Diagnostics có mã/vị trí ổn định | IEC TR 61131-8 (khuyến nghị PADT) | Vị trí có; **số lượng/mức/nội dung hỏng** |
| Online monitoring | PADT / thực hành công nghiệp | Có (LIVE), chất lượng tốt |
| Autocomplete | **UX sản phẩm** | Có |
| Signature help | **UX sản phẩm** | **Không** |
| Quick Library | **Mekong UX** | Có |
| Code Map / minimap | **UX sản phẩm** | Có |
| Giá trị runtime nội tuyến | **UX sản phẩm** | Có, đúng chuẩn quality/freshness |
| Ba chế độ EDIT/SIMULATE/LIVE | **Thiết kế sản phẩm Mekong** | Có |
| Context Inspector | **Mekong UX** | Có, thiếu 4 trường |
| Khay Vấn đề dưới màn hình | **Mekong UX** | Có ở PGM-03; **không** cho ST ở PGM-02 |

---

## 7. Khoảng cách ngôn ngữ so với IEC 61131-3 Ed.4

### 7.1 Khác biệt **cố ý và đã ghi** (không phải finding)

`ST_SUBSET_SPEC` §9 công bố 8 khác biệt `D1..D8`: luôn đánh giá đủ `AND`/`OR`; tràn số nguyên luôn
là fault; không có `&`; tham số FB chỉ theo tên; không có `CASE`/vòng lặp/POU người dùng *(mục này
nay đã sai — xem F-STED-005)*; chỉ `INT`/`REAL` *(nay có thêm `DINT`/`UINT`/`TIME`)*; từ chối
`NaN`/`Inf`; chỉ literal thập phân. Lý do WCET/an toàn hợp lý và tôi **không đề nghị đổi**.

### 7.2 Thiếu so với IEC nhưng **chưa được công bố ở §9**

| Nhóm | Thiếu | Ghi chú |
|---|---|---|
| Interface POU | `VAR_IN_OUT`, `VAR_TEMP`, `VAR_GLOBAL`, `VAR_EXTERNAL`, `CONSTANT` | `VAR_GLOBAL`/`VAR_EXTERNAL` bị cấm có chủ đích (DDD §4.1 "không global mutable"), nhưng **`VAR_IN_OUT` thì không có tuyên bố nào** → F-STED-009 |
| Kiểu | `SINT/USINT/LINT/ULINT/UDINT`, `LREAL`, `BYTE/WORD/DWORD`, `STRING/WSTRING`, `DATE/TOD/DT`, `ARRAY`, `STRUCT`, enum, kiểu người dùng | §3.1 có liệt kê là "không có" — **đã công bố**, nhưng không có trong bảng §9 nên không có lý do đi kèm |
| Toán tử | `**` (luỹ thừa) | Không nhắc ở đâu |
| Hàm chuẩn | `MUX`, `MOVE`, `TRUNC`, `ROUND`, `EXPT`, `LN/LOG/EXP`, `SIN/COS/TAN`, `SHL/SHR/ROL/ROR`, toàn bộ hàm chuỗi | Chỉ có 8 hàm + 14 conversion |
| FB chuẩn | `RS`, `SR`, `CTUD`, `SEMA` | Có `TON/TOF/TP/R_TRIG/F_TRIG/CTU/CTD` |
| Literal | Đa cơ số (`16#FF`), gạch dưới (`1_000`), literal có kiểu (`INT#5`) | `D8` đã ghi phần đa cơ số/gạch dưới; literal có kiểu thì không |
| Địa chỉ trực tiếp | `%I`/`%Q`/`%M` | DDD §4.1 cấm có chủ đích (dùng binding qua Point Catalog) — **đã công bố** |

Đây **không phải lỗi** — đây là phạm vi sản phẩm. Nhưng để tuyên bố "IEC-aligned" một cách kiểm
chứng được thì bảng này phải nằm trong hồ sơ ngôn ngữ công bố (`ISS-STED-06`), chứ không nằm rải
rác trong ba tài liệu mâu thuẫn nhau.

---

## 8. BẢNG ISSUE ĐỀ XUẤT — chờ chủ sở hữu duyệt

> **Trạng thái duyệt:** chủ sở hữu **APPROVE AFTER ADDING `ISS-STED-18/19/20`** (2026-08-31), giữ
> nguyên 17 issue ban đầu, không thêm feature nào khác. Ba issue bổ sung đã có mặt trong bảng dưới
> và **toàn bộ 20 issue đã được tạo trên repo** — bảng §8.2 nối mã `ISS-STED-xx` với số issue thật.
> Ước lượng: **S** ≤ 1 ngày · **M** 2–4 ngày · **L** ≥ 1 tuần.

### Đợt 1 — Đường chẩn đoán (điều kiện cần để trình soạn thảo dùng được)

| # | Mã | Tiêu đề | Finding | Mức | Phạm vi sửa | Tiêu chí chấp nhận (rút gọn) | Ước lượng |
|---|---|---|---|---|---|---|---|
| 1 | `ISS-STED-01` | Compiler trả nhiều diagnostic theo hợp đồng DDD §7 | F-STED-002 | High | `st_semantic.cpp`, `st_compile.cpp`, `st_compile_main.cpp` | Semantic thu lỗi thay vì dừng ở lỗi đầu; CLI phát tối đa 64 diagnostic, sort `program/order/location/code`; vượt trần thêm đúng một `ST-LIM-006`; `resolve_io_bindings` không còn `.front()`; test: nguồn 5 lỗi ⇒ 5 diagnostic đúng thứ tự | **L** |
| 2 | `ISS-STED-02` | Bật kênh WARNING end-to-end | F-STED-003 | High | `st_semantic.cpp`, `st_compile_main.cpp`, `checks.go` | Hiện thực `ST-WARN-002`/`ST-WARN-003` + cảnh báo đọc output FB trước call (DDD §4.3); CLI phát `severity:"warning"`; `compilerDiagnostic()` **forward** `item.Severity` thay vì ghi cứng; warning không làm Check FAILED; test: chương trình có biến thừa ⇒ Check PASSED + 1 warning | **M** |
| 3 | `ISS-STED-03` | Giữ thông điệp và `detailCode` của compiler tới tận UI | F-STED-004, F-STED-013 | High | `checks.go`, `model/types.ts`, `ProblemsDrawer.tsx`, `errorCopy.ts` | `DiagnosticView` mang `message` + `args{expected,actual}` + `related[]`; FE hiển thị `detailCode` (`ST-SEM-002`) cạnh mã công khai và câu mô tả cụ thể; 19 mã ST không còn hiển thị giống nhau; giữ nguyên nguyên tắc không lộ path host/stack | **M** |
| 4 | `ISS-STED-04` | PGM-02 hiển thị diagnostic của Check gần nhất cho POU ST | F-STED-001 | High | `DesignWorkspacePage.tsx`, `ProgramsTab.tsx` | Trang soạn thảo nạp kết quả Check gần nhất của Draft; gạch chân + tooltip hoạt động thật; **bắt buộc** có nhãn nêu rõ diagnostic thuộc revision nào và buffer đã đổi hay chưa (không được để người dùng tin lỗi cũ là lỗi hiện tại); Draft chưa Check ⇒ trạng thái rỗng "chưa kiểm tra" | **M** |
| 5 | `ISS-STED-05` | Khay Vấn đề của workbench phủ cả POU ST | F-STED-001 | High | `DesignWorkbench.tsx`, `ProgrammingWorkbench.tsx` | Bỏ nhánh `language !== 'FBD'`; nguồn cho ST là diagnostic Check (không dựng bộ kiểm thứ hai ở FE); bấm một mục nhảy đúng POU + dòng/cột; đếm trên nhãn tab đúng | **S** |
| 6 | `ISS-STED-18` | **Diagnostic Provenance Contract** | F-STED-001/004 | High | `st_compile_main.cpp`, `checks.go`, `model/types.ts`, `ProgramsTab.tsx` | Mỗi diagnostic mang `revisionId` + `pouId` + **hash nguồn của chính POU đó** (`sourceSha256`) + `stLanguageProfileVersion`; PGM-02 **chỉ** gạch lỗi khi cả ba khớp buffer đang mở; lệch ⇒ hiện **`STALE DIAGNOSTIC`** với lý do (buffer đã đổi / revision khác), **không** gạch như lỗi hiện tại và **không** ẩn im lặng; test: sửa một ký tự sau Check ⇒ mọi dấu lỗi chuyển STALE | **M** |

### Đợt 2 — Hồ sơ ngôn ngữ (điều kiện cần để tuyên bố "IEC-aligned")

| # | Mã | Tiêu đề | Finding | Mức | Phạm vi sửa | Tiêu chí chấp nhận (rút gọn) | Ước lượng |
|---|---|---|---|---|---|---|---|
| 6 | `ISS-STED-06` | Xuất bản **ST Language Profile** phiên bản hoá, sinh máy được | F-STED-005/007, G1 | High | `contracts/programming/st_language_profile_v1.json` + `scripts/` + docs | Một hợp đồng máy đọc được: grammar rule, kiểu, storage class, câu lệnh, thư viện chuẩn, limits, mã diagnostic — **sinh từ chính C++** như đã làm với từ khoá; có `--check` chạy trong build làm đỏ khi code trôi; tài liệu người đọc sinh từ đúng hợp đồng đó | **L** |
| 7 | `ISS-STED-07` | Reconcile `CASE` trong `DDD-LANG-PROG-001` §4.1 | F-STED-005 | High | `PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | Chủ sở hữu chọn: **(A)** giữ `CASE` — ghi luật WCET/bounded cho `CASE` vào §4.3, sửa §4.1, giữ nguyên code; hoặc **(B)** bỏ `CASE` — nhưng phải xử lý chương trình AHU đang chạy trên bo. **Chặn mọi tuyên bố release ngôn ngữ cho tới khi ký** | **S** (quyết định) |
| 8 | `ISS-STED-08` | Sửa `ST_SUBSET_SPEC` §3.1/§5.5/§9/§10/§11 | F-STED-006/007/009 | Medium | `ST_SUBSET_SPEC_MK-DDC-24_VI.md` | §3.1 `TIME` = 0..24 h; §5.5 bỏ `CASE`/user POU khỏi danh sách "không có"; §10 EBNF thêm `case_statement`; §11 thay bằng bảng sinh từ `ISS-STED-06` hoặc xoá hẳn; §9 bổ sung `VAR_IN_OUT`, `**`, kiểu thiếu, hàm/FB IEC thiếu | **M** |
| 9 | `ISS-STED-09` | RTM phân loại IEC-required vs Mekong-UX cho ST Editor | F-STED-015 | Medium | `PROGRAMMING_TRACEABILITY_MATRIX.md` | Thêm trục phân loại cho mọi requirement ST Editor (dùng bảng §6 tài liệu này làm hạt giống); mọi tuyên bố "IEC" phải dẫn được mục cụ thể của IEC 61131-3 hoặc TR 61131-8 | **S** |
| 10 | `ISS-STED-10` | Đồng bộ namespace mã lỗi giữa DDD §7 và code | F-STED-012 | Low | `PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` hoặc `st_diagnostic.hpp` | Một trong hai đổi theo cái kia; **khuyến nghị sửa DDD** (`ST-LIM-*` + 8 namespace thật) vì mã đã đi vào error catalog, FE, Go và log hiện trường — đổi mã là đổi hợp đồng công khai | **S** |
| 11 | `ISS-STED-19` | **Language/Artifact Compatibility Version** | F-STED-005/011 | High | `st_ir.hpp`, `st_loader.cpp`, `st_artifact_manifest.cpp`, `checks.go`, `capabilities`, FE | Bộ ba `stLanguageProfileVersion` + `libraryRegistryVersion` + `compilerVersion/targetAbi` đi cùng artifact **và** cùng capabilities; runtime từ chối artifact không tương thích với lý do đọc được; **FE tự kiểm bản thân nó**: so `PROGRAMMING_LIBRARY_VERSION`/`PROGRAMMING_LIBRARY_REGISTRY_SHA256` đã build vào bundle với bản thiết bị công bố, lệch ⇒ chặn soạn thảo kèm thông báo, không im lặng | **M** |

### Đợt 3 — Chất lượng công cụ (L3/L4)

| # | Mã | Tiêu đề | Finding | Mức | Phạm vi sửa | Tiêu chí chấp nhận (rút gọn) | Ước lượng |
|---|---|---|---|---|---|---|---|
| 11 | `ISS-STED-11` | Signature help cho hàm và Function Block | F-STED-008 | Medium | `stEditorSupport.ts`, `ProgramsTab.tsx` | Gõ `(` sau tên hàm/instance ⇒ popup chữ ký lấy từ `PROGRAMMING_LIBRARY_ENTRIES.ports` (không khai tay); tham số đang nhập được làm nổi; `Esc` đóng; đọc được bằng bàn phím; **không** gợi ý chữ ký cho khối đang bị review gate mà không nói rõ | **M** |
| 12 | `ISS-STED-12` | Inspector ST bổ sung Scope/Initial/Mapped point/Unit/Reads-Writes | F-STED-010 | Medium | `inspectorContext.ts`, `ContextInspector.tsx` | 5 trường mới; trường nào không tra được hiện **"không xác định được"** chứ không đoán (giữ đúng nguyên tắc đang có); Reads/Writes lấy từ `stReferenceIndex.occurrences.role` | **M** |
| 13 | `ISS-STED-13` | Chống trôi văn phạm giữa FE và compiler | F-STED-011 | Medium | `scripts/`, `stFormat/`, test FE | Dùng `symbols` mà CLI compile đã trả để **đối chiếu** chỉ mục regex FE (lệch ⇒ FE hạ xuống "không xác định được", không im lặng sai); thêm corpus dùng chung: mọi vector trong corpus phải format được và parse lại bằng compiler | **M** |
| 14 | `ISS-STED-14` | Hợp đồng phím `st_keyboard_commands_v1.json` | F-STED-014 | Low | `contracts/programming/`, `scripts/`, test | Ngang FBD: hợp đồng liệt kê mọi phím tắt ST + validator + test đọc hợp đồng | **S** |
| 15 | `ISS-STED-15` | Bằng chứng a11y cho ST editor | F-STED-015, G17 | Medium | test FE + `docs/07_records/test-evidence/` | Kiểm tương phản token tô màu ở cả sáng/tối, thứ tự focus, thao tác đủ bằng bàn phím, màu **không** là tín hiệu duy nhất của diagnostic; lưu record | **M** |

### Đợt 4 — Phạm vi ngôn ngữ (cần quyết định sản phẩm trước khi code)

| # | Mã | Tiêu đề | Finding | Mức | Phạm vi | Tiêu chí chấp nhận (rút gọn) | Ước lượng |
|---|---|---|---|---|---|---|---|
| 16 | `ISS-STED-16` | Quyết định `VAR_IN_OUT` | F-STED-009 | Medium | Quyết định + docs (+ code nếu chọn hỗ trợ) | Hỗ trợ (parser + semantic + IR + FBD tương ứng), **hoặc** ghi vào §9 kèm lý do. Không để trạng thái "không nhắc tới" | **S** quyết định / **L** nếu hỗ trợ |
| 17 | `ISS-STED-17` | Lộ trình thu hẹp khoảng cách thư viện chuẩn IEC | F-STED (§7.2) | Low | Quyết định + docs | Chốt danh sách bổ sung theo nhu cầu HVAC thật (đề nghị xét trước: `MUX`, `TRUNC`, `RS`/`SR`, `CTUD`) và công bố phần **không làm** kèm lý do | **S** |

### Đợt 5 — Cổng bằng chứng end-to-end (chặn ký đóng review)

| # | Mã | Tiêu đề | Finding | Mức | Phạm vi | Tiêu chí chấp nhận (rút gọn) | Ước lượng |
|---|---|---|---|---|---|---|---|
| 18 | `ISS-STED-20` | **End-to-End V&V Evidence Gate** | §11 (thiếu số đo C++), G18 | High | `scripts/`, test C++/Go/FE/E2E, `docs/07_records/test-evidence/` | Một lượt chạy có ghi số thật, đủ **bốn chặng**: (a) `cmake --fresh` + build + `ctest` với cả ba option `MODBUS/BACNET/HMI`; (b) vector compiler cho syntax/type/FB/warning/multi-diagnostic; (c) CLI JSON → Go → FE: E2E chứng minh cùng một lỗi giữ nguyên mã/vị trí/mức/nội dung qua cả ba tầng; (d) chạy trên runtime/bo thật gồm cả `LIVE`. **Không** chấp nhận số cache (`-count=1`), **không** đọc exit code của tiến trình nền thay cho exit code của gate. Thiếu bất kỳ chặng nào ⇒ review `REV-STED-IEC-001` không được ký đóng | **L** |

### 8.2 Bản đồ `ISS-STED-xx` ↔ issue trên repo

Đã tạo 2026-08-31 trên `Mekong-HCM/MK-DDC-24`, nhãn `st-editor` + `priority:*` + loại.

| Đợt | Mã | Issue | Tiêu đề rút gọn | Mức |
|---|---|---|---|---|
| 1 | `ISS-STED-01` | [#350](https://github.com/Mekong-HCM/MK-DDC-24/issues/350) | Compiler trả nhiều diagnostic theo DDD §7 | High |
| 1 | `ISS-STED-02` | [#351](https://github.com/Mekong-HCM/MK-DDC-24/issues/351) | Bật kênh WARNING end-to-end | High |
| 1 | `ISS-STED-03` | [#352](https://github.com/Mekong-HCM/MK-DDC-24/issues/352) | Giữ thông điệp + `detailCode` tới UI | High |
| 1 | `ISS-STED-18` | [#353](https://github.com/Mekong-HCM/MK-DDC-24/issues/353) | **Diagnostic Provenance Contract** | High |
| 1 | `ISS-STED-04` | [#354](https://github.com/Mekong-HCM/MK-DDC-24/issues/354) | PGM-02 hiện diagnostic cho POU ST | High |
| 1 | `ISS-STED-05` | [#355](https://github.com/Mekong-HCM/MK-DDC-24/issues/355) | Khay Vấn đề phủ cả POU ST | High |
| 2 | `ISS-STED-07` | [#356](https://github.com/Mekong-HCM/MK-DDC-24/issues/356) | Reconcile `CASE` trong DDD §4.1 | High |
| 2 | `ISS-STED-06` | [#357](https://github.com/Mekong-HCM/MK-DDC-24/issues/357) | Xuất bản ST Language Profile | High |
| 2 | `ISS-STED-19` | [#358](https://github.com/Mekong-HCM/MK-DDC-24/issues/358) | **Language/Artifact Compatibility Version** | High |
| 2 | `ISS-STED-08` | [#359](https://github.com/Mekong-HCM/MK-DDC-24/issues/359) | Sửa `ST_SUBSET_SPEC` §3.1/§5.5/§9/§10/§11 | Medium |
| 2 | `ISS-STED-09` | [#360](https://github.com/Mekong-HCM/MK-DDC-24/issues/360) | RTM phân loại IEC vs Mekong UX | Medium |
| 2 | `ISS-STED-10` | [#361](https://github.com/Mekong-HCM/MK-DDC-24/issues/361) | Đồng bộ namespace mã lỗi | Low |
| 3 | `ISS-STED-11` | [#362](https://github.com/Mekong-HCM/MK-DDC-24/issues/362) | Signature help | Medium |
| 3 | `ISS-STED-12` | [#363](https://github.com/Mekong-HCM/MK-DDC-24/issues/363) | Inspector ST bổ sung 5 trường | Medium |
| 3 | `ISS-STED-13` | [#364](https://github.com/Mekong-HCM/MK-DDC-24/issues/364) | Chống trôi văn phạm FE ↔ compiler | Medium |
| 3 | `ISS-STED-14` | [#365](https://github.com/Mekong-HCM/MK-DDC-24/issues/365) | Hợp đồng phím ST | Low |
| 3 | `ISS-STED-15` | [#366](https://github.com/Mekong-HCM/MK-DDC-24/issues/366) | Bằng chứng a11y | Medium |
| 4 | `ISS-STED-16` | [#367](https://github.com/Mekong-HCM/MK-DDC-24/issues/367) | Quyết định `VAR_IN_OUT` | Medium |
| 4 | `ISS-STED-17` | [#368](https://github.com/Mekong-HCM/MK-DDC-24/issues/368) | Lộ trình thư viện chuẩn IEC | Low |
| 5 | `ISS-STED-20` | [#369](https://github.com/Mekong-HCM/MK-DDC-24/issues/369) | **End-to-End V&V Evidence Gate** | High |

---

### 8.1 Thứ tự thi hành đề nghị

```text
ISS-STED-07 (quyết định CASE)
        │
        └──> ISS-STED-06 (Language Profile) ──┬──> ISS-STED-08 ──> ISS-STED-09
                                              │
                                              └──> ISS-STED-19 (compat version)
ISS-STED-01 (nhiều diagnostic)
        ├──> ISS-STED-02 (warning)
        └──> ISS-STED-03 (message) ──> ISS-STED-18 (provenance) ──> ISS-STED-04 ──> ISS-STED-05
                                                                          │
                                                                          └──> ISS-STED-11/12/13/14/15
ISS-STED-16 / ISS-STED-17 (quyết định phạm vi) — độc lập
        │
mọi nhánh trên ──> ISS-STED-20 (cổng bằng chứng) ──> ký đóng REV-STED-IEC-001
```

`ISS-STED-04` phụ thuộc `ISS-STED-03`: nối khay lỗi vào PGM-02 **trước khi** message có nội dung
thật chỉ làm người dùng thấy cùng một câu vô nghĩa ở hai chỗ thay vì một chỗ.

`ISS-STED-04` phụ thuộc tiếp `ISS-STED-18`: hiển thị lỗi trong trình soạn thảo **mà không** có hợp
đồng provenance sẽ tạo ra một lỗi nguy hiểm hơn lỗi đang có — gạch một chỗ trên buffer đã đổi, tức
chỉ vào dòng không còn là dòng sinh ra lỗi đó. Vì vậy `ISS-STED-18` phải xong trước.

`ISS-STED-19` phụ thuộc `ISS-STED-06` vì `stLanguageProfileVersion` chưa tồn tại cho tới khi hồ sơ
ngôn ngữ được xuất bản; phần `libraryRegistryVersion`/`targetAbi` làm được ngay.

`ISS-STED-20` là **cổng cuối**, không phải một hạng mục song song: nó chỉ chạy được khi các nhánh
trên đã vào `main`.

### 8.3 Hoà giải với phạm vi phát hành V1.0 (`ADR-056`, 2026-09-05)

Câu "các nhánh trên đã vào `main`" ở trên được viết **trước** khi V1.0 chốt phạm vi. Từ
2026-09-04 chủ sở hữu phân loại `ISS-STED-16` (#367 — `VAR_IN_OUT` + `ARRAY` tĩnh + `STRUCT`) là
**`V1-DEFER`**: ba năng lực đó **không** nằm trong tập bắt buộc để mở `RELEASE_READY` V1, issue vẫn
**OPEN**, và **không được kéo critical path V1**.

Vì thế điều kiện của `ISS-STED-20` **cho lượt ký đóng V1** đọc là:

> mọi nhánh `ISS-STED-01..19` **trừ những mã đã được phạm vi phát hành chính thức hoãn** đã vào
> `main`.

Diễn giải này **không nới lỏng cổng**: nó chỉ ngăn cổng đòi một năng lực mà chính quyền phát hành đã
tuyên bố nằm ngoài V1. Ba ràng buộc đi kèm, và thiếu bất kỳ ràng buộc nào thì việc hoãn KHÔNG có
hiệu lực với cổng:

1. Việc hoãn phải là **quyết định phạm vi phát hành có ghi hồ sơ** (`ADR-056` và bình luận phân loại
   trên chính issue), không phải một issue tình cờ chưa xong.
2. Issue được hoãn vẫn **OPEN** và vẫn phải đi qua `ISS-STED-20` **trước lượt ký đóng của bản đưa nó
   trở lại phạm vi**. Hoãn là dời, không phải xoá.
3. Hồ sơ ký đóng V1 phải **liệt kê tên** từng mã được hoãn. Một cổng bỏ qua thứ gì đó mà không nói ra
   là một cổng đã ngừng làm cổng — đúng loại "loại trừ không công bố" mà review này sinh ra để chấm
   dứt.

Ràng buộc thứ ba là lý do mục này nằm ở đây thay vì chỉ nằm trong một bình luận GitHub: bình luận
không được đọc lúc ký, còn hồ sơ này thì có.

---

## 9. Những chỗ ĐẠT — không được "sửa" nhầm khi thi hành các issue trên

| Hạng mục | Vì sao phải giữ nguyên |
|---|---|
| `presentStRuntimeValue()` | Không bao giờ vẽ `0` cho giá trị không hợp lệ; `STALE` có nhãn; có cờ `producerRestarted`. Đây là bất biến an toàn, không phải chi tiết UI. |
| Tách khai báo/lời gọi khi chèn FB | Sinh `VAR ... END_VAR` giữa thân là lỗi cú pháp; cách làm hiện tại đúng và giữ một bước Undo. |
| Registry POU sinh tự động hai chiều | Đây là thứ chặn được lớp lỗi "UI chào cái compiler không có". Đừng thêm danh sách viết tay nào song song. |
| Formatter kiểm round-trip AST | Không format còn hơn format sai mã điều khiển. |
| Check chạy trên revision đã niêm phong, không chạy trên buffer | Giữ nguyên khi làm `ISS-STED-04`: hiển thị lỗi trong editor **không** được biến thành "check as you type" chạy trên bản chưa lưu. |
| Không có "Save & Run" | Đã đúng. Đừng thêm. |
| `SIMULATE` không bao giờ chạm output vật lý; capability đọc từ server | Đừng thay bằng suy đoán FE. |

---

## 10. Quyết định của chủ sở hữu

### 10.1 Đã ký — `ADR-054` (2026-08-31)

Nguyên tắc chủ sở hữu ra: **"làm chuẩn theo IEC: có thì giữ, không có thì bỏ"**. Áp nguyên văn thì
đâm vào ba chỗ, nên `ADR-054` chốt cách áp:

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| 1 | **`CASE`** | IEC có ⇒ **giữ**. Nguyên tắc áp cho **cú pháp/ngữ nghĩa ngôn ngữ**, không áp cho thư viện điều khiển | `DDD-LANG-PROG-001` lên 1.2, §4.3 có luật WCET cho `CASE`. **Đóng #356** |
| 2 | **`PID`, `HYSTERESIS`, `SCALE`, `DEADBAND`** — không thuộc thư viện chuẩn IEC | **Giữ**, nhưng **bắt buộc đánh dấu** "mở rộng nhà sản xuất, không thuộc IEC 61131-3" ở hồ sơ ngôn ngữ, registry và UI | Không gỡ khối nào; `PID` an toàn. Thêm việc gắn nhãn vào #368 |
| 3 | **`FOR`/`WHILE`/`REPEAT`** — IEC có | **Giữ loại trừ** vì `P1` (mọi scan chấm dứt trong thời gian chặn trên được) là ràng buộc an toàn | Phải công bố kèm lý do ở bảng khác biệt (#359); parser tiếp tục giữ chỗ từ khoá |
| 4 | **Hệ kiểu** — IEC có ARRAY/STRUCT/STRING/LREAL… | **Làm theo đợt**, ưu tiên nhu cầu HVAC. Đợt gần: `VAR_IN_OUT` + `ARRAY` tĩnh + `STRUCT`. Đợt sau: `LREAL`, `BYTE/WORD/DWORD`, enum. Loại trừ có công bố: `STRING` độ dài biến, `DATE/TOD/DT` (vi phạm `P2`) | **#367 đổi bản chất**: từ "quyết định `VAR_IN_OUT`" thành **thi hành**, đi cùng `ARRAY`/`STRUCT` |

Ba thứ ở đợt gần đi cùng nhau là có lý do: `VAR_IN_OUT` là truyền **tham chiếu**, công dụng thật của
nó là truyền kiểu hợp thành mà không sao chép. Làm `VAR_IN_OUT` khi chưa có `ARRAY`/`STRUCT` thì được
một construct đúng chuẩn nhưng gần như không ai dùng.

### 10.2 Còn lại

| # | Quyết định | Vì sao cần ký |
|---|---|---|
| 1 | **Sửa DDD hay sửa mã lỗi** (`ISS-STED-10`, #361) | Mã lỗi đã là hợp đồng công khai (error catalog, log hiện trường). Khuyến nghị sửa DDD, nhưng đây là quyết định về hợp đồng, không phải về code. |

---

## 11. Số đo đã chạy trong phiên này

| Bộ | Lệnh | Kết quả |
|---|---|---|
| FE — trình soạn thảo ST | `npx vitest --run --environment jsdom src/features/programming/design/editor` | **19 tệp / 292 test PASS**, 5.90 s, 2026-08-31 |

**Không** dựng lại C++ trong phiên này, nên tài liệu này không dẫn số ctest nào. Mọi kết luận về
compiler là kết luận đọc mã.

Chủ sở hữu đã ghi nhận đúng điểm này khi duyệt: 292 test FE **không đủ** làm bằng chứng ký release.
`ISS-STED-20` được mở chính vì khoảng trống đó và là cổng chặn ký đóng `REV-STED-IEC-001`.

---

## 12. Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-31 | Bản đầu. 15 finding, chấm 18 gate + 12 UC, 17 issue đề xuất chờ duyệt. |
| 1.3 | 2026-09-05 | Thêm §8.3 hoà giải điều kiện của `ISS-STED-20` với phạm vi phát hành V1.0 (`ADR-056`). Chủ sở hữu phân loại `ISS-STED-16` (#367) là `V1-DEFER` ngày 2026-09-04, trong khi câu "chỉ chạy được khi các nhánh trên đã vào `main`" ở §8.1 được viết TRƯỚC khi V1 chốt phạm vi — hai câu đó mâu thuẫn nhau và làm cổng không bao giờ đóng được cho V1. §8.3 nêu rõ ba ràng buộc để việc hoãn có hiệu lực với cổng, trong đó hồ sơ ký đóng phải LIỆT KÊ TÊN từng mã được hoãn. `ADR-054` không bị đảo. |
| 1.2 | 2026-08-31 | Chủ sở hữu ra nguyên tắc phạm vi ngôn ngữ ("IEC có thì giữ, không có thì bỏ") và ký `ADR-054`. Viết lại §10 thành 10.1 Đã ký / 10.2 Còn lại; ghi chú cập nhật vào `F-STED-005`; sửa §0 câu 3. Đã sửa `DDD-LANG-PROG-001` lên 1.2 (§4.1 + §4.3 luật WCET của `CASE`) ⇒ đóng #356; #367 đổi từ "quyết định" sang "thi hành". |
| 1.1 | 2026-08-31 | Chủ sở hữu APPROVE WITH CONDITIONS. Bổ sung `ISS-STED-18` (Diagnostic Provenance Contract), `ISS-STED-19` (Language/Artifact Compatibility Version), `ISS-STED-20` (End-to-End V&V Evidence Gate) — tổng 20 issue / 5 đợt. Cập nhật DAG phụ thuộc (`04` nay sau `18`; `19` sau `06`; `20` là cổng cuối). Đã tạo issue trên repo, xem §8.2. |
