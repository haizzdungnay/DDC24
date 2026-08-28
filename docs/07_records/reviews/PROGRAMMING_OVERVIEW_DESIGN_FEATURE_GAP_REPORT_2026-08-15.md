# Báo cáo hiện trạng & GAP — Programming: Tổng quan (Overview) và Thiết kế (ST editor, FBD editor)

| Thuộc tính | Giá trị |
|---|---|
| ID | `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15` |
| Ngày | 2026-08-15 |
| Phạm vi | **Chỉ** `PGM-01` Tổng quan và `PGM-02` Thiết kế — hai tab **ST editor** và **FBD editor**. Không phải phạm vi: Mapping/Task (tab thứ 3 của PGM-02), `PGM-03` Kiểm tra & Đưa vào vận hành, `PGM-04` Runtime & Bảo trì |
| Người đọc chính | CTO, PM, End user (kỹ sư cấu hình) — dùng để quyết định plan và phê duyệt bước tiếp theo |
| Phương pháp | Đọc trực tiếp source FE/BE/FW-SOM tại thời điểm viết (nhánh `main`, sau merge PR #173/#174), đối chiếu với tài liệu thiết kế (`UX-WEB-PROG-001`, `DDD-FE-PROG-001`) và hai báo cáo audit trước (dẫn nguồn, không lặp lại nội dung) |
| Quyền bằng chứng | **Source-code inventory + đối chiếu tài liệu.** Không phải Test Result, không phải HIL, không phải browser evidence mới (trừ vài điểm dẫn lại từ báo cáo cũ có ghi rõ nguồn). Không tự thay đổi phán quyết `RELEASE_READY BLOCKED` đã có |

---

## 1. Tóm tắt điều hành

**Cái đã có thật, chạy được, không phải khung sườn:**

- Toàn bộ vòng đời Draft → niêm phong thành Revision bất biến → Check (biên dịch thật qua CLI `mkddc-st-compile`) → Commission lên Core thật đều có code thật, đã chứng minh trên board Foxlinx (xem báo cáo As-Built 2026-08-14).
- **ST và FBD dùng chung một bộ biên dịch/ngữ nghĩa** ở tầng C++ (FBD hạ thành cùng `StProgram` rồi qua đúng `typecheck_st_program()`/`compile_st_to_ir()` như ST) — FBD không phải một đường lối tắt/rút gọn, nó có đúng năng lực ngữ nghĩa như ST.
- Ngôn ngữ ST đã cài đặt **nhiều hơn** những gì tài liệu `ST_SUBSET_SPEC_MK-DDC-24_VI.md` mô tả (đã lỗi thời): có sẵn `DINT/UINT` và khối `PID`, dù hai tài liệu spec/design vẫn ghi "chưa có"/"chưa khóa semantics".
- Toàn vẹn artifact có hash + source-map đối chiếu ngược, audit là **chuỗi hash tamper-evident** (không phải log phẳng), idempotency key + ETag hai lớp chống ghi đè đồng thời.

**Sự thật cấu trúc quan trọng nhất cho quyết định sản phẩm:** Rev A hiện bị khoá **đúng một Program cho toàn bộ controller** ở cả ba tầng độc lập — FE (`capabilities.limits.projectsPerController=1`), BE (không có cách tạo Project thứ hai), và **Core runtime** (`kMaxProgramsTotal=1`, `kMaxTasks=1`, khoá cứng trong `ValidateRevAProfile()` dù scheduler bên dưới đã có khung cho tới 8 task). Đây không phải một giới hạn UI tạm thời — nó là một quyết định kiến trúc đã khoá ở runtime. Bất kỳ khách hàng nào cần chạy hơn một chương trình điều khiển độc lập trên một controller sẽ không làm được với Rev A ở dạng hiện tại.

**5 khoảng hở đáng chú ý nhất tìm thấy trong phiên này (Overview + ST + FBD, chưa nằm trong hai báo cáo trước):**

1. **`DraftAttentionPanel` (Overview) chỉ cài 2/6 trạng thái thiết kế yêu cầu** — không có "Check lỗi → Xem lỗi" và "Check đạt → Mở Kiểm tra". §5.
2. **FBD editor chỉ tạo được đúng MỘT loại block qua giao diện (AND)** — không có palette/thư viện, không có cách tạo node INPUT/OUTPUT (biến giao diện chương trình) qua UI. Một Program FBD dựng hoàn toàn bằng UI hiện tại **không thể có biến để map sang Point** ở tab Ánh xạ. §8.
3. **Check chỉ biên dịch đúng 1 Program/Revision** — nếu Revision có bất kỳ đối tượng `FUNCTION`/`FUNCTION_BLOCK` nào (loại mà chính `ProgramInspector` cho phép chọn), Check fail cứng `ST-CLI-LIMIT`. Tính năng "tái sử dụng logic" mà data model gợi ý là chưa hoạt động. §7.4.
4. **FE và BE lệch danh sách hàm FBD**: `model.ts` phía FE khai `SCALE`, `DEADBAND`, `CTU`, `PI` — cả bốn **không tồn tại** trong registry hàm/FB phía C++; ngược lại FE thiếu `SQRT` mà backend có. Chưa xác nhận được các hàm thừa này có lộ ra cho người dùng chọn qua UI hay chỉ là hằng số dự phòng nội bộ — cần FE team xác nhận trước khi coi là gap người dùng thấy được. §8.4.
5. **`POST /retain/reset` có trong contract/route nhưng không có handler xử lý** — mọi request rơi vào nhánh mặc định trả 503. Khớp với finding cũ (RETAIN reset "contract-only") nhưng nay xác định đúng nguyên nhân kỹ thuật thay vì suy đoán. (Ngoài phạm vi ST/FBD trực tiếp, ghi lại vì phát hiện cùng đợt đọc BE Design workspace.)

**Khuyến nghị:** tài liệu này **không đề xuất một phán quyết đóng/mở** — mục 10 liệt kê đúng những câu hỏi cần CTO/PM/end-user quyết định trước khi lên kế hoạch bước tiếp theo, vì một số gap (ví dụ FBD "canvas tự do") là **quyết định phạm vi Rev A đã chốt sẵn** (không phải thiếu sót), còn số khác (DraftAttentionPanel, FBD thiếu palette/INPUT-OUTPUT) là **khoảng hở thật giữa thiết kế đã duyệt và code** cần quyết có sửa trong Rev A hay để Rev B.

---

## 2. Phạm vi và phương pháp

Đọc trực tiếp, không suy đoán, các lớp sau tại thời điểm viết:

- **FE**: `apps/web-ui/src/features/programming/overview/OverviewPage.tsx`, `design/DesignWorkspacePage.tsx`, `design/useDraftWorkspace.ts`, `design/editor/ProgramsTab.tsx`, `fbd/StructuredFbdEditor.tsx`, `fbd/model.ts`, `fbd/commands.ts`, `model/types.ts`, `api/queries.ts`, `layout/ProgrammingContextStrip.tsx`, `ProgrammingRoutes.tsx`.
- **BE (Go)**: `apps/web-api/internal/programming/application/{projects,checks,operations,runtime,monitor,trace}.go`, `apps/web-api/internal/programming/compiler/runner.go`, `apps/web-api/internal/programming/transport/http/router.go`, `apps/web-api/internal/programming/store/audit.go`.
- **FW-SOM/Core (C++)**: `apps/core/application/st/{st_parser,st_semantic,st_compile,st_fbd_compile,st_io_map,st_artifact_manifest,st_exec,st_process_image,st_retain}.cpp`, `apps/core/application/runtime/scan_loop.cpp`, sinh mã `st_profile_generated.hpp`.
- **Tài liệu đối chiếu**: `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` (`UX-WEB-PROG-001`), `docs/02_design/software/PROGRAMMING_FE_DESIGN.md` (`DDD-FE-PROG-001`), `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md`, `docs/02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md`.

**Quan hệ với hai báo cáo trước** (không lặp lại nội dung, chỉ dẫn nguồn khi trùng):

- [`PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md`](PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md) (`REV-PROG-ASBUILT-GAP-2026-08-14`) — audit toàn Programming (cả 4 workspace), tập trung defect UC-PROG-03 và Binding Manifest (D-07). Tài liệu này **không** lặp lại 15 finding đã có ở đó; phần liên quan tới ST/FBD được dẫn thẳng khi cần (ví dụ `F-PROG-ASBUILT-013/014/015`).
- [`PROGRAMMING_FE_UX_IMPLEMENTATION_AUDIT_2026-08-13.md`](PROGRAMMING_FE_UX_IMPLEMENTATION_AUDIT_2026-08-13.md) (`REV-PROG-FE-UX-2026-08-13`) — audit UC-by-UC qua browser thật, có ảnh chụp target. Tài liệu này bổ sung góc nhìn **feature inventory từ source** (cái gì tồn tại và làm được gì) thay vì góc nhìn **pass/fail theo kịch bản test**.

Tài liệu này **không** thay đổi `RELEASE_READY = BLOCKED` đã ghi ở hai báo cáo trên.

---

## 3. Một sự thật cấu trúc cần biết trước khi đọc phần còn lại: Rev A = một Program cho toàn bộ controller

Xác nhận độc lập ở ba tầng, không tầng nào mâu thuẫn tầng nào:

| Tầng | Bằng chứng | Giá trị |
|---|---|---|
| FE | `ProgrammingCapabilities.limits.projectsPerController` (`model/types.ts:21`), đọc từ `GET /capabilities` | `1` |
| BE (Go) | Không có route/logic tạo Project thứ hai khi đã có một Project trên controller | `1` |
| FW-SOM (C++) | `st_profile_generated.hpp` sinh từ profile `revA-1t-1-5-30`: `kMaxTasks=1, kMaxProgramsPerTask=1, kMaxProgramsTotal=1`, khoá bởi `ValidateRevAProfile()` (`st_limits.cpp`) | `1/1/1` |

Bên dưới lớp khoá đó, `st_scheduler.hpp` **đã có sẵn** cấu trúc chứa tới 8 task — nghĩa là runtime không phải "chỉ biết chạy một task", mà là "cố ý chỉ được PHÉP chạy một task" cho Rev A. Đây là điểm quan trọng để CTO/PM hiểu: mở rộng lên nhiều Program/Task trong tương lai là **thay đổi giá trị một profile + review lại giới hạn an toàn**, không phải viết lại kiến trúc scheduler từ đầu.

**Ý nghĩa cho end user:** một controller MK-DDC-24 chạy Rev A hiện tại chỉ điều khiển được đúng MỘT logic ứng dụng (một AHU, một hệ thống) dù ứng dụng đó có thể có nhiều biến/nhiều FBD network bên trong cùng một Program.

---

## 4. Luồng dữ liệu Draft → Revision → Check → Commission (tóm tắt phục vụ đọc §5-§8)

```text
FE (Overview/Design)
  ⇄ PATCH /projects/{id}/draft          — sửa Draft (ETag + baseRevisionId, 2 lớp optimistic lock)
  ⇄ POST /projects/{id}/draft/revisions — niêm phong Draft → Revision BẤT BIẾN (content-addressed, SHA-256/object)
  ⇄ POST /revisions/{id}/checks         — hàng đợi biên dịch async (worker riêng, lease 30s)
       BE: compilerInput() gói ĐÚNG 1 Program + ioMapFromRevision() (Variable/Binding đã seal)
       BE: gọi tiến trình mkddc-st-compile (sandbox riêng pgid, PATH cố định, timeout, Pdeathsig)
       C++: BuildStArtifact/BuildFbdArtifact → typecheck → resolve_io_bindings() → encode artifact
       → artifact hash + source map, KHÔNG ký số (integrityMode=HASH_ONLY)
  ⇄ POST /operations/commission         — chỉ khi Check PASSED đúng revision, impact khớp mới nhất
       BE: state machine VALIDATING→STAGING→ACTIVATING→VERIFYING qua IPC, không đoán "chắc thành công"
       C++ runtime: nạp artifact đã verify, KHÔNG parse ST/FBD trong scan (st_compiler_lib không link vào mkddc-core)
```

Mọi mutation (Save Draft, Seal, Check, Commission, Restore) đều: bắt buộc `If-Match` (ETag) + `X-Idempotency-Key` (UUIDv4) + ghi vào audit dạng chuỗi hash (`prevHash‖...`, phát hiện được đứt/gãy chuỗi). RBAC chỉ có 2 mức thực chất cho các route này: `Viewer` (chỉ đọc) và `Admin` (toàn quyền mutate) — vai trò `Operator` tồn tại trong hệ thống auth nhưng **không route Programming nào dùng tới**.

---

## 5. PGM-01 — Tổng quan (Overview)

### 5.1 Tính năng hiện có

`OverviewPage.tsx` dựng 5 panel trong lưới 3 cột:

| Panel | Nguồn dữ liệu | Hành vi thật |
|---|---|---|
| `RunningApplicationPanel` | `runtime.activeRevisionId`, `runtime.taskState` | Hiện Revision đang chạy + badge trạng thái Task (RUNNING/FAULT/khác); nút "Mở runtime". Không có Active → copy rõ ràng, không hiện `r0`/số giả |
| `CoreSafeStatePanel` | `runtime.producerState`, `runtime.safeState`, `runtime.observedAt` | 3 trạng thái Core (running/degraded/unreachable) đúng badge màu; Safe-state Có/Không; giờ quan sát cuối |
| `DraftAttentionPanel` | `GET /projects` (item đầu — Rev A chỉ có 1 Project) | Xem §5.2 — đây là nơi có gap |
| `ProgrammingAttentionList` | Suy ra từ `runtime.producerState`/`taskState`/`safeState` | Danh sách "việc cần chú ý" (Core mất kết nối, Core suy giảm, Task fault, Safe-state). Mỗi mục bấm được, điều hướng sang `/eng/programming/runtime` — đã sửa từ bug thật (`BUG-016`: trước đây là `<li>` phẳng không điều hướng được) |
| `RecentEngineeringTimeline` | `GET /audit` (5 bản ghi gần nhất) | Actor + action + thời gian |

Toàn bộ panel có `loading`/`error` state riêng, không hiện dữ liệu bịa khi API lỗi (`StateBlock` + `onRetry`).

### 5.2 So khớp với thiết kế `UX-WEB-PROG-001`

Thiết kế (§5 "PGM-01 Tổng quan") quy định **primary action đổi theo trạng thái**, và bảng ánh xạ vùng giao diện §16.1.4 liệt kê `DraftAttentionPanel` phải có 6 trạng thái: `no-draft, dirty, checking, failed, ready, conflict`, với action tương ứng `Tiếp tục chỉnh sửa | Xem lỗi | Kiểm tra`.

As-built `DraftAttentionPanel` (đọc trực tiếp `overview/OverviewPage.tsx:110-175`) chỉ có đúng **2 nhánh**:

| Trạng thái thiết kế yêu cầu | Có trong as-built? |
|---|---|
| `no-draft` (chưa có Project) → `Tạo bản nháp` | **Có** |
| `dirty`/đang sửa → `Tiếp tục chỉnh sửa` | **Có** (nhánh mặc định khi có Project) |
| `checking` (Check đang chạy) | **Không có** — không phân biệt được với trạng thái "đang sửa" thường |
| `failed` (Check lỗi) → `Xem lỗi` | **Không có** |
| `ready` (Check đạt) → hàm ý mở Kiểm tra & Đưa vào vận hành | **Không có** |
| `conflict` (409 khi lưu) | **Không có** ở panel này (conflict có xử lý riêng trong `DesignWorkspacePage`, nhưng Overview không phản ánh) |

Hệ quả thực tế: một kỹ sư mở trang Tổng quan sau khi Check thất bại ở phiên trước sẽ chỉ thấy nút "Tiếp tục chỉnh sửa" giống hệt như khi chưa từng Check — không có tín hiệu nào ở Overview cho biết lần Check gần nhất đã lỗi hay đạt. Đây là gap giữa thiết kế và as-built, không phải suy đoán: bảng §16.1.4 của `UX-WEB-PROG-001` liệt kê rõ các trạng thái này là bắt buộc.

---

## 6. PGM-02 — Thiết kế (Design workspace): kiến trúc dùng chung

- Một workspace, ba tab (`Chương trình` [ST/FBD], `Điểm & Ánh xạ`, `Thực thi`) chia sẻ **một** Draft/ETag context qua `useDraftWorkspace` — đổi tab không tạo request mới, không mất nội dung đang gõ (cả ba tab luôn `MOUNTED`, chỉ ẩn bằng CSS `hidden`, tránh bug thật đã tìm thấy qua Playwright: unmount xoá buffer chưa lưu).
- **D-01 (đã triển khai 2026-08-14)**: Check/Problems không còn ở PGM-02 — trang này chỉ lưu Draft rồi điều hướng sang `PGM-03`; nút "Kiểm tra" bị khoá (`disabled={draftDirty}`) cho tới khi Draft đã lưu sạch.
- Guard rời trang: khi có thay đổi chưa lưu, mọi click vào link nội bộ bị chặn (`interceptInternalLink`) và mở modal "Lưu toàn bộ (một batch) / Bỏ thay đổi cục bộ / Ở lại"; đóng tab/trình duyệt dùng `beforeunload`.
- Conflict (409 khi lưu): giữ nguyên buffer đang gõ, hiện banner "Bản mong đợi/Bản hiện tại" với nút Tải lại / Giữ bản đang gõ.

**Gap layout đã biết, xác nhận lại qua đọc trực tiếp** (trùng `F-PROG-ASBUILT-008` của báo cáo trước, không phải phát hiện mới): thiết kế §16.2 yêu cầu bố cục ba cột "Cây 280px ┬ Editor co giãn ┬ Inspector 308px". As-built (`ProgramsTab.tsx:162`) dùng `grid md:grid-cols-[280px_1fr]` — **hai cột**; `ProgramInspector` render **bên dưới** editor trong cùng cột phải, không phải cột riêng.

---

## 7. ST Editor — hiện trạng chi tiết

### 7.1 Tính năng hiện có (đọc `design/editor/ProgramsTab.tsx`, hàm `SourceEditor`)

Đây là một **`<textarea>` thuần** kèm các lớp phủ tự viết bằng JS/regex — không dùng Monaco/CodeMirror hay bất kỳ thư viện code-editor nào:

| Tính năng | Cơ chế |
|---|---|
| Số dòng (gutter) | `<pre>` tĩnh song song, đồng bộ scroll thủ công |
| Vị trí con trỏ (dòng/cột) | Tính từ `selectionStart` mỗi lần click/gõ/chọn |
| Tìm trong buffer (`Ctrl+F`) | So khớp chuỗi con thô (`indexOf`, không phân biệt hoa/thường), giới hạn 1000 kết quả |
| Lưu nhanh (`Ctrl+S`) | Gọi thẳng `onSave` nếu buffer hợp lệ |
| "Định dạng" | Bộ tách dòng/thụt lề bằng regex theo từ khoá khối ST (`formatStSource`) — không phải AST-based formatter |
| Danh mục "Ký hiệu & kiểu" | Regex quét khai báo `VAR ... : TYPE` ở bất kỳ đâu trong buffer, đếm số lần xuất hiện tên biến làm "tham chiếu" |
| Nhảy tới diagnostic đúng dòng/cột | Nhận `line/column/length` qua query string từ `PGM-03`, tự `setSelectionRange` |
| Chặn lưu ST rỗng | `source.trim().length === 0` → khoá nút Lưu, có thông báo |
| Đồng bộ ETag sau Check FAILED | `syncAfterSeal()` — vá bug thật đã đóng (`F-PROG-ASBUILT-002`) |

### 7.2 Tính năng KHÔNG có

- **Không có syntax highlighting.** Toàn bộ là văn bản một màu.
- **Không có autocomplete.** Đã ghi nhận ở báo cáo trước (`F-PROG-ASBUILT-009`, quyết định `D-03` còn mở) — xác nhận lại: không tìm thấy cơ chế gợi ý nào trong `SourceEditor`.
- **Không có validate cú pháp phía client.** "Ký hiệu & kiểu" chỉ là regex tìm mẫu `TÊN : KIỂU`, không phải parser thật — có thể báo sai/sót với ST hợp lệ nhưng viết khác định dạng thường gặp (ví dụ khai báo nhiều biến trên một dòng bằng dấu phẩy — cú pháp ST chuẩn không hỗ trợ điều này nên không phải vấn đề thực tế, nhưng cũng có nghĩa symbol list không phải nguồn sự thật, chỉ là gợi ý).
- **Không có go-to-definition/tham chiếu chéo giữa Program.** Mỗi ST editor chỉ biết về đúng Program đang mở.

### 7.3 Ngôn ngữ ST thực sự biên dịch được (từ FW-SOM, không phải từ UI)

Đọc trực tiếp `st_parser.cpp`/`st_semantic.cpp`/`st_compile.cpp`, đối chiếu `ST_SUBSET_SPEC_MK-DDC-24_VI.md`:

| Nhóm | Có | Không có |
|---|---|---|
| Khối | `PROGRAM`, `VAR/VAR_INPUT/VAR_OUTPUT/VAR RETAIN` | `FUNCTION`/`FUNCTION_BLOCK` người dùng tự định nghĩa (`TARGET-PENDING`) |
| Kiểu | `BOOL, INT, DINT, UINT, REAL, TIME` (**DINT/UINT có thật**, dù spec ghi "chưa có") | `ARRAY, STRUCT, STRING`, con trỏ |
| Điều khiển | `IF/ELSIF/ELSE/END_IF` | `CASE, FOR, WHILE, REPEAT, EXIT, RETURN, GOTO` — cố ý, để đảm bảo mọi nhánh chỉ nhảy tiến (xác định thời gian thực thi) |
| Toán tử | Đầy đủ số học/so sánh/logic theo đúng bảng ưu tiên spec | `&` bit-wise |
| Function Block chuẩn | `TON, TOF, R_TRIG, F_TRIG` **và `PID`** (PID có thật trong code, spec chỉ ghi 4 khối) | Khối tự định nghĩa |
| Hàm chuẩn | `ABS, MIN, MAX, LIMIT, SEL, SQRT`, 4 hàm chuyển đổi REAL/INT/TIME, **8 hàm chuyển đổi INT/DINT/UINT** (vượt spec) | — |
| RETAIN | Ghi atomic (tmp+rename), CRC-32, throttle 60s, force-flush khi shutdown — đúng spec §7 | — |

**Lưu ý quan trọng cho tài liệu, không phải cho code:** `ST_SUBSET_SPEC_MK-DDC-24_VI.md` và `PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` hiện **không khớp** implementation ở khoản DINT/UINT/PID — implementation đi trước tài liệu. `PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` tự ghi rõ "Unit/conversion/PID semantic chưa khóa" (cần Controls+Safety review chính thức) dù code đã chạy PID đầy đủ (anti-windup, derivative-on-measurement) — nghĩa là tính năng tồn tại về mặt kỹ thuật nhưng **chưa có phê duyệt chính thức để công bố là sẵn sàng dùng**.

### 7.4 Giới hạn Check chưa từng được nói ở UI: đúng 1 Program mỗi lần biên dịch

`compilerInput()` (BE) chỉ đóng gói **đúng một object PROGRAM** cho mỗi lần Check. Nếu Revision có bất kỳ object `FUNCTION`/`FUNCTION_BLOCK` nào (loại mà `ProgramInspector` trong `ProgramsTab.tsx` cho phép người dùng chọn ở dropdown "Loại"), Check **fail cứng** với diagnostic `ST-CLI-LIMIT` — không biên dịch được, không có thông báo nào ở UI giải thích lý do gốc là "loại Program này chưa được hỗ trợ ở Check". Đây là khoảng cách giữa những gì UI *cho phép chọn* và những gì backend *thực sự làm được*.

---

## 8. FBD Editor — hiện trạng chi tiết

### 8.1 Mô hình dữ liệu

`fbd/model.ts` định nghĩa graph có cấu trúc chặt: `Document → Network[] → Node[] → Port[]`, cộng `Wire[]` nối Port. Validator (`validateFbdDocument`) kiểm đầy đủ: UUID canonical không trùng, thứ tự thực thi (`executionOrder`/`order`) không trùng trong cùng phạm vi, kiểu dữ liệu + đơn vị (`unit`) phải khớp hai đầu wire, input không được có quá một driver, và **thứ tự dây phải đi thuận theo executionOrder** (trừ khi một đầu là `FUNCTION_BLOCK`, vốn có trạng thái nội tại nên không bị ràng buộc thứ tự tổ hợp). Giới hạn cứng: 256 network, 256 block, 512 wire, 16 port/node, 65.536 byte JSON canonical.

### 8.2 Giao diện: không phải canvas — đây là quyết định thiết kế đã chốt, không phải thiếu sót

`StructuredFbdEditor.tsx` render network/block/port dưới dạng **thẻ (card) và nút bấm**, không vẽ đường dây bằng SVG/canvas — danh sách wire hiện dạng text "port→port". Toàn bộ thao tác (thêm network/block, chọn port, nối, xoá, đổi thứ tự, undo/redo tới 50 bước) làm được **hoàn toàn bằng bàn phím** (`Insert/↑↓/Enter/Alt+↑↓/Delete/Ctrl+Z/Y`), có `aria-live` thông báo cho screen reader.

Tài liệu thiết kế (`PROGRAMMING_FE_DESIGN.md` §5 "Structured FBD Rev A") ghi rõ: *"Không có free-form wiresheet, animated wire, native plug-in hoặc mouse-only flow"* và *"Canvas tự do là Rev B"*. **As-built khớp đúng chủ đích này** — đây không phải một gap, mà là thực hiện đúng quyết định phạm vi Rev A đã duyệt (ưu tiên bàn phím/accessibility hơn trải nghiệm kéo-thả trực quan).

### 8.3 Gap thật: thiếu palette và thiếu khả năng tạo biến giao diện chương trình

Cùng tài liệu thiết kế đó (§5 và bảng §16.2) cũng yêu cầu **"Tree/palette + inspector"** và cột dữ liệu bắt buộc `"fbdGraph, thư viện, diagnostics"` cho `StructuredFbdEditor`. Đọc `commands.ts`, hành động "Thêm block" (phím `Insert`, nút "Block AND") **chỉ có một đường duy nhất**: `newAndNode()` — luôn tạo đúng một khối `AND` (BOOL, 2 input/1 output). Không có:

- **Palette/danh sách chọn loại khối** — dù `model.ts` đã khai đủ registry ~29 loại (`pureFunctions`, `statefulFunctions`, `conversions`), UI không có cách nào để người dùng chọn tạo `TON`, `ADD`, `PID`, v.v. qua thao tác thông thường.
- **Không có cách tạo node `INPUT`/`OUTPUT`/`CONSTANT` qua UI.** Ba loại node này chỉ xuất hiện trong dữ liệu golden fixture dùng để test compiler (`contracts/programming/fbd/golden/ahu_fan_enable.json`), không có action nào trong `StructuredFbdEditor`/`commands.ts` tạo ra chúng khi thao tác trên trình duyệt.
- **Không có Inspector chỉnh tham số/`typeRef` của node sau khi tạo.**

**Hệ quả trực tiếp, kiểm chứng được từ chính code:** `collectFbdInterfaceVariables()` (dùng để mời tab "Điểm & Ánh xạ" chọn biến map sang Point) chỉ đọc từ node `kind: 'INPUT'|'OUTPUT'`. Vì UI không có cách tạo hai loại node này, **một Program FBD dựng hoàn toàn bằng giao diện web hiện tại sẽ không có biến giao diện nào để ánh xạ tới Point** — nghĩa là FBD, dù có compiler thật phía sau, hiện chưa thể tạo ra một chương trình *hữu dụng đầu-cuối* (đọc cảm biến → tính toán → ghi output) chỉ bằng thao tác trên web, cho tới khi có palette + khả năng tạo INPUT/OUTPUT.

### 8.4 Compiler FBD thật sự làm gì, và một mismatch dữ liệu FE/BE mới phát hiện

Tin tốt: `st_fbd_compile.cpp` **không phải một đường thực thi rút gọn riêng** — nó hạ FBD JSON canonical thành đúng `StProgram` rồi gọi thẳng cùng `typecheck_st_program()`/`compile_st_to_ir()` như ST. FBD có đúng năng lực ngữ nghĩa, cùng giới hạn, cùng safe-state như ST; khác biệt chỉ ở lớp cú pháp đầu vào.

Đối chiếu registry hàm hai phía phát hiện lệch:

| Nguồn | Có nhưng phía kia không có |
|---|---|
| FE `fbd/model.ts` (`pureFunctions`/`statefulFunctions`) | `SCALE`, `DEADBAND` (pure); `CTU`, `PI` (stateful) — **không tồn tại** trong registry `StFunc`/`StFbType` phía C++ |
| C++ (`st_func_from_name`, `StFbType`) | `SQRT` — **thiếu** trong `pureFunctions` phía FE |

Nếu một node dùng `typeRef` phía FE không tồn tại ở backend được gửi lên Check, C++ trả lỗi rõ ràng `FBD-SEM-LIBRARY-UNSUPPORTED-001` (fail-closed, không crash, không âm thầm bỏ qua) — nên đây không phải rủi ro an toàn, nhưng là rủi ro trải nghiệm (người dùng tưởng đã cấu hình đúng, Check báo lỗi khó hiểu). **Chưa xác nhận được** liệu bốn hàm thừa phía FE (`SCALE/DEADBAND/CTU/PI`) có thực sự lộ ra cho người dùng chọn qua palette tương lai hay chỉ là hằng số dự phòng nội bộ chưa dùng tới — vì hiện tại không có palette UI nào cả (§8.3) nên gap này **hiện chưa ai chạm được qua trình duyệt**, nhưng cần dọn trước khi xây palette để tránh mang gap này lên UI thật.

---

## 9. Bảng tổng hợp GAP — phạm vi Overview + ST + FBD

| # | Gap | Mức | Mới ở báo cáo này? | Ghi chú |
|---|---|---|---|---|
| G-1 | `DraftAttentionPanel` (Overview) thiếu 4/6 trạng thái thiết kế (checking/failed/ready/conflict) | **Cao** — người dùng không biết Check gần nhất thành hay bại từ trang Tổng quan | **Mới** | §5.2 |
| G-2 | FBD editor không có palette chọn loại block, chỉ tạo được `AND` | **Cao** — chặn khả năng dùng FBD cho hầu hết logic thực tế | **Mới** (khoảng hở giữa thiết kế §5 "Tree/palette" và as-built đã có từ trước, nhưng chưa được ghi thành finding riêng ở hai báo cáo trước) | §8.3 |
| G-3 | FBD editor không có cách tạo node `INPUT`/`OUTPUT` qua UI | **Cao** — chặn khả năng map biến FBD sang Point, coi như chặn đường FBD end-to-end qua UI | **Mới** | §8.3 |
| G-4 | Check chỉ biên dịch 1 Program/Revision; `FUNCTION`/`FUNCTION_BLOCK` (loại UI cho chọn) luôn fail `ST-CLI-LIMIT` | **Trung bình** — UI hứa hẹn nhiều hơn backend làm được | **Mới** (đọc trực tiếp `checks.go`) | §7.4 |
| G-5 | FE/BE lệch registry hàm FBD (`SCALE/DEADBAND/CTU/PI` chỉ ở FE; `SQRT` chỉ ở BE) | **Thấp** (chưa lộ ra UI vì chưa có palette) nhưng **phải dọn trước khi xây G-2** | **Mới** | §8.4 |
| G-6 | ST editor không autocomplete/syntax highlight; "Ký hiệu & kiểu" chỉ regex, không phải parser thật | **Trung bình** | Đã biết (`F-PROG-ASBUILT-009`, `D-03` mở) — xác nhận lại, không lặp chi tiết | §7.2 |
| G-7 | `PGM-02` layout 2 cột thay vì 3 cột thiết kế (Inspector nằm dưới, không phải cột riêng) | **Thấp/Trung bình** (thẩm mỹ + luồng đọc, không chặn chức năng) | Đã biết (`F-PROG-ASBUILT-008`) | §6 |
| G-8 | `ST_SUBSET_SPEC_MK-DDC-24_VI.md`/`PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` không khớp implementation (DINT/UINT/PID đã chạy nhưng tài liệu ghi "chưa có"/"chưa khoá") | **Trung bình** — rủi ro tài liệu, không phải rủi ro runtime | **Mới** | §7.3 |
| G-9 | `POST /retain/reset` không có handler, luôn 503 | **Thấp cho scope này** (ngoài ST/FBD, đã biết ở mức hiện tượng từ báo cáo trước, nay xác định đúng nguyên nhân: thiếu handler, không phải logic sai) | Bổ sung nguyên nhân | §1, phát hiện phụ khi đọc BE |
| G-10 | Artifact Check/Commission không được ký số (`integrityMode=HASH_ONLY`, không truyền `--key`) | **Cần CTO/Security xác nhận có chấp nhận được cho Rev A hay không** | **Mới** | §4 |

---

## 10. Câu hỏi cần CTO/PM/end-user quyết định

1. **G-1 (Overview thiếu trạng thái Check)**: có cần thiết phải sửa trước khi cho end-user thật dùng, hay chấp nhận vì PGM-03 đã có đủ thông tin này (chỉ là không thấy ngay ở Tổng quan)?
2. **G-2/G-3 (FBD thiếu palette + INPUT/OUTPUT)**: đây là **gap chặn dùng FBD thật qua UI**, không phải vấn đề nhỏ. Có cần ưu tiên xây palette + node INPUT/OUTPUT trước khi công bố FBD là "sẵn sàng dùng", hay Rev A chỉ chính thức hỗ trợ ST và để FBD ở trạng thái "đang xây" cho end-user?
3. **G-4 (Check giới hạn 1 Program, không hỗ trợ FUNCTION_BLOCK tái sử dụng)**: có nên ẩn lựa chọn "FUNCTION_BLOCK"/"FUNCTION" khỏi dropdown "Loại" ở `ProgramInspector` cho tới khi Check thật sự hỗ trợ, để UI không hứa hẹn thứ chưa làm được?
4. **§3 (một Program cho toàn controller)**: end-user/PM có cần biết rõ giới hạn này trước khi bán/triển khai Rev A cho khách hàng có nhu cầu nhiều ứng dụng độc lập trên một controller không?
5. **G-10 (artifact không ký số)**: có chấp nhận `HASH_ONLY` cho Rev A production, hay đây là điều kiện chặn trước khi thương mại hoá (liên quan an toàn/toàn vẹn phần mềm điều khiển)?
6. **G-8 (tài liệu ngôn ngữ lỗi thời)**: giao ai cập nhật `ST_SUBSET_SPEC_MK-DDC-24_VI.md` để khớp implementation thật (DINT/UINT/PID), và ai (Controls+Safety) cần review chính thức PID trước khi công bố tính năng này cho end-user?

Không câu hỏi nào ở trên tự chặn việc lập kế hoạch — chúng chặn đúng phạm vi quyết định liệt kê, các phần khác của báo cáo có thể dùng ngay để lên kế hoạch corrective.

---

## 11. Phụ lục

### A. Bảng REST API Programming (đọc từ `router.go`)

| Method | Path | Mục đích |
|---|---|---|
| GET | `/capabilities` | Giới hạn/profile Rev A |
| GET | `/projects` | Liệt kê Project |
| POST | `/projects` | Tạo Project + Draft rỗng |
| GET | `/projects/{id}` | Đọc Project + Draft content |
| PATCH | `/projects/{id}/draft` | Áp operations vào Draft |
| POST | `/projects/{id}/draft/revisions` | Niêm phong Draft → Revision bất biến |
| GET | `/revisions/{id}` | Đọc Revision (manifest+objects) |
| GET | `/revisions/{from}/changes/{to}` | Diff + impact (cho Commission) |
| POST | `/revisions/{id}/checks` | Enqueue Check (biên dịch) |
| GET | `/checks/{id}` | Trạng thái/diagnostics/artifact Check |
| GET | `/point-catalog` | Danh sách Point khả dụng để bind |
| GET | `/runtime` | Trạng thái Producer/Task/SafeState |
| GET | `/runtime/monitor` | Bảng giá trị Variable đang active |
| POST | `/runtime/traces` | Tạo trace session |
| GET/DELETE | `/runtime/traces/{id}` | Đọc/dừng trace |
| POST | `/operations/commission` | Commission Revision lên Core |
| POST | `/operations/restore` | Restore về Revision khác |
| GET | `/operations/{id}`, `/operations` | Trạng thái/lịch sử operation |
| GET | `/overrides` | Override đang active |
| POST | `/bundles/export`, `/bundles/import` | Xuất/nhập bundle Revision |
| POST | `/retain/reset` | **Khai báo route, không có handler — luôn 503** (G-9) |
| GET | `/audit` | Nhật ký audit |

### B. Nguồn tham chiếu chính

- FE: `apps/web-ui/src/features/programming/{overview,design,fbd}/*`, `model/types.ts`
- BE: `apps/web-api/internal/programming/application/*.go`, `compiler/runner.go`, `transport/http/router.go`
- FW-SOM: `apps/core/application/st/*.cpp`, `apps/core/application/runtime/scan_loop.cpp`
- Contract: `contracts/programming/fbd_v1.schema.json`, `contracts/programming/fbd_keyboard_commands_v1.json`, `contracts/programming/fbd/golden/ahu_fan_enable.json`

### C. Tài liệu liên quan

- [Báo cáo As-Built toàn Programming](PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md) (`REV-PROG-ASBUILT-GAP-2026-08-14`)
- [Audit FE/UI/UX Programming](PROGRAMMING_FE_UX_IMPLEMENTATION_AUDIT_2026-08-13.md) (`REV-PROG-FE-UX-2026-08-13`)
- [Thiết kế UI/UX Programming](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) (`UX-WEB-PROG-001`)
- [Programming FE Design](../../02_design/software/PROGRAMMING_FE_DESIGN.md) (`DDD-FE-PROG-001`)
- [Programming Language/Compiler Design](../../02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md)
- [ST Subset Specification](../../02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md) — cần đồng bộ lại theo G-8

---

## 12. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-15 | Tạo báo cáo: đọc trực tiếp source FE (Overview, ST editor, FBD editor) + BE (Programming API) + FW-SOM (ST/FBD compiler, runtime), đối chiếu `UX-WEB-PROG-001`/`DDD-FE-PROG-001`, 10 gap tổng hợp (6 mới, 4 đã biết/bổ sung nguyên nhân), 6 câu hỏi cần PM/CTO/end-user quyết định |
