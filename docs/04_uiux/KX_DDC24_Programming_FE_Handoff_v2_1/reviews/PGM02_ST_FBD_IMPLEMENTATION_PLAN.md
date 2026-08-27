# Kế hoạch triển khai PGM-02 ST/FBD Workspace Redesign

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN-PGM02-ST-FBD-REDESIGN-PROPOSAL-001` |
| Phiên bản | 1.20 |
| Trạng thái | **Supporting plan — exact-pinned by `AUTH-PROG-2026-08-24-05`; R1 ĐÓNG; R2 ĐÓNG (`T59-810..813` DONE). **16/16 WP nay DONE**: bốn finding của phán quyết audit 2026-08-27 đã đóng hết — `WP-09` (Compare, `T59-819`), `WP-04` R3 (hover, `T59-820`), `WP-14` (Inspector, `T59-818`), `WP-15` (editor chrome, `T59-821`), cộng truy nguyên 33/33 AC (`T59-822`). Đã deploy bo Foxlinx 2026-08-27 (FE + BE). **Plan này KHÔNG tự đóng increment R3**: `T59-816`/`T59-817` (hardening Simulation + closeout `VS-PROG-U15`, target/HIL) thuộc Plan 59 và vẫn mở; `RELEASE_READY` giữ NO-GO — xem §0 và [`REC-PGM02-AUD-ADJ-001`](../../../07_records/reviews/PROGRAMMING_PGM02_AUDIT_GAP_ADJUDICATION_2026-08-27.md)** |
| Ngày | 2026-08-25 |
| Mốc mã nguồn lập kế hoạch | `3d2db5d88912bf927475e8f1ef8ca70a9df4afc4` |
| Review nguồn | [REC-PGM02-ST-FBD-REDESIGN-REVIEW-001](PGM02_ST_FBD_REDESIGN_IMPLEMENTATION_REVIEW.md) |
| Chủ quản đề xuất | Programming Product + Software/Runtime Architecture |
| Người phê duyệt | Phạm Đình Chương — Product Owner/CTO + System Architect, electronic authorization `AUTH-PROG-2026-08-24-05` |
| Change request chủ quản | [`CR-PROG-PGM02-V22-001`](../../../00_governance/PROGRAMMING_OPEN_DECISIONS.md) |
| Execution authority | [Plan59](../../../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md) là tracker/scheduler duy nhất; `T59-813` READY, task sau tự mở theo predecessor |
| Release gate | `RELEASE_READY = NO-GO` cho tới khi WP-12/13 và evidence target áp dụng hoàn tất |

Kế hoạch không ước lượng thời gian khi chưa có velocity/resource evidence. Độ
phức tạp dùng `S/M/L/XL`, phản ánh số boundary và rủi ro, không phải số ngày.

Tên `WP-00..WP-13` trong proposal này là alias đọc ngắn. Mọi record kiểm soát,
trace, risk, task và evidence phải dùng namespace canonical
`PGM02-V22-WP-00..PGM02-V22-WP-13`; `WP-00`..`WP-03` đã DONE. Các task
R1/R2/R3 đều có entry authority; hiện `T59-813` READY, task R3 giữ ORDERED tới
khi predecessor hoàn tất. Trạng thái từng WP nằm ở §0.

## 0. Roadmap triển khai — cập nhật theo từng lát

Bảng này là **trạng thái thi hành** của proposal, cập nhật ngay khi một lát đóng.
Nó KHÔNG thay Plan59 (tracker/scheduler duy nhất) và không tự mở gate nào: một
dòng `DONE` ở đây chỉ nói "work package đã có source + test + evidence HOST",
không nói CI, target, HIL hay release.

| WP | Task canonical | Trạng thái | Lát đã giao | Bằng chứng |
|---|---|---|---|---|
| `WP-00` | `T59-801` | **DONE** 2026-08-24 | Reconcile authority, formal DDD/contract/ADR-053, exact pin `413a043` | `AUTH-PROG-2026-08-24-05`; manifest 17/17 |
| `WP-01` | `T59-802` | **DONE (một phần scope)** 2026-08-25 | Route canonical + resolver + legacy redirect + mobile `<768` read-only, sau cờ `programsWorkspaceV2` | [evidence 2026-08-25](../../../07_records/test-evidence/programming/2026-08-25-pgm02-t59-802-shell-route.md) |
| `WP-02` | `T59-803` | **DONE** 2026-08-25 | Một POU Explorer, identity `objectId`↔`programId`, vòng đời POU typed cho ba kind | [evidence 2026-08-25](../../../07_records/test-evidence/programming/2026-08-25-pgm02-t59-803-pou-explorer.md) |
| `WP-03` | `T59-804` | **DONE** 2026-08-26 | Catalog dùng chung (BE authority) + Quick Library ST + Recent/Favorites + parity BE↔registry trên backend thật + lọc palette FBD theo cổng đang chọn + khoá luật không tự nối + sáu block `TP`/`CTU`/`CTD`/`SCALE`/`DEADBAND`/`HYSTERESIS` (compiler+runtime+conformance) + typed metadata public trong OpenAPI + dock dùng chung ST↔FBD | [evidence 2026-08-26](../../../07_records/test-evidence/programming/2026-08-26-pgm02-t59-804-quick-library.md) |
| `WP-04` | `T59-805` (R1) / `T59-820` (R3) | **DONE (R1)** 2026-08-26 · **DONE (R3 — hover)** 2026-08-27 | Guard read-only runtime + chèn FB có trạng thái đúng vùng khai báo (`AC-ST-002/003`) + chỉ mục tham chiếu, F12 tới khai báo, khay "không xác định được" (`AC-ST-005`) + khoá `AC-ST-004/010` bằng 8 nguồn ngoài subset | AC áp dụng cho R1 (`AC-ST-001..005`, `010`, `011`) đều có test; FE 146 file/1626 test. **R3 (`T59-820`):** hover symbol/type/signature giao, dùng CHUNG `stSymbolContextFor` với Inspector nên hai nơi không thể nói khác nhau; chi phí thật **1,30 KiB** gzip so với 110,07 KiB của CodeMirror từng dùng để hoãn. Nửa **chỉ mục do compiler sinh** chuyển `UD-PROG-016` OPEN, **hạn ký 2026-09-10**.  [Cổng phụ thuộc](../../../00_governance/PROGRAMMING_ST_EDITOR_DEPENDENCY_GATE.md) CLOSED bằng lựa chọn A (`UD-PROG-013`): giữ bề mặt hiện tại cho R1. Hover chuột và chỉ mục ký hiệu do compiler sinh hẹn "mở lại từ R2" — **R2 đã đóng 2026-08-27 mà không giao và không có bản ghi hoãn tiếp**; nay do `T59-820` nhận (`F-PGM02-AUD-003`) |
| `WP-05` | `T59-806` | **DONE (R1)** 2026-08-26 | Hợp đồng `layout` (compiler bỏ qua khi canonical hoá) + canvas SVG node–edge thật + khay Vấn đề nhảy tới đúng block/dây + minimap trên ngưỡng + fixture 256 block | AC áp dụng cho R1 (`AC-FBD-001..007`, `012`) đều có test; accessibility có axe quét thẳng canvas (0 vi phạm); ctest 1299/1299, FE 149 file/1684 test, E2E 31 PASS/5 skip. `AC-FBD-008` thuộc R3, `AC-FBD-009..011` thuộc R2 |
| `WP-06` | `T59-807` (R1) / `T59-811` (R2) / `T59-816` (R3) | **DONE (R1+R2)** 2026-08-27 | R1: workbench/mode/grid/bốn lớp lỗi; R2: nguồn Active fail-closed, FBD canvas thuần, Watch snapshot chung | R1 real-backend 2/2; R2 real-backend 5/5; FE 156 file/1762 test |
| `WP-07` | `T59-814` | **DONE (HOST/LOCAL)** 2026-08-27 | Simulation API/store/supervisor/worker ephemeral + sandbox + virtual time + input allowlist | Cổng nhị phân: `programming_sim_worker_symbol_boundary` (không link `core_domain`) và `programming_sim_worker_behaviour` (hàng rào + bắt tay + tất định). `G-PGM02-04 SIM_SAFE` mới đạt phần HOST; phần target/HIL zero-physical-output thuộc `T59-817` |
| `WP-08` | `T59-815` | **DONE (HOST/LOCAL)** 2026-08-27 | Bề mặt SIMULATE: điều khiển phiên, ngõ vào ảo, lớp quan sát, save-required và RBAC đọc từ capability | Mô hình phiên thuần có test riêng (bỏ phản hồi phiên khác/sequence cũ/epoch cũ); component test phủ capability tắt, Draft bẩn, viewer chỉ đọc, `UNAVAILABLE` không hoá 0. E2E backend+worker THẬT: RUN tiến đồng hồ ảo, PAUSE dừng thật, STEP đúng một base tick, RESET về 0. Sửa `F-P59-RUN-NOOP-001` và `F-P59-SIM-TRUSTED-KEY-001` của `WP-07` |
| `WP-09` | `T59-810` (R2) / `T59-819` (R3) | **DONE** 2026-08-27 | Đã giao đủ hai nhánh: dấu producer (generation/freshness) + Trace pin neo tuple Active (R2); typed diff Compare Draft↔Active `stHunks[]`/`fbdChanges[]`, seal-before-compare, Compare drawer có anchor jump (R3) | Nhánh R2: real-backend 3/3; Go 10 case bảng + 1 tích hợp. Nhánh R3 (`T59-819`): Go 24 case golden `changes_diff_test.go` + cổng đồng bộ hợp đồng `TestRevisionChangesDiffOpenAPIMatchesGoResponse`; FE **163 file/1859 test**; chunk **127,67/165 KiB (R3)**; E2E **53 PASS/11 skip** |
| `WP-10` | `T59-808` / `T59-812` / `T59-816` | **DONE (R1+R2)** 2026-08-27 | R1 cổng ngân sách; R2 monitor chỉ ở LIVE, một request đang bay, coalesce ≤10 Hz, cleanup và topology FBD không render lại theo sample | R2 chunk 114,32/145 KiB, dư 30,68 KiB; focused 47/47; FE 157 file/1768 test |
| `WP-11` | `T59-808` / `T59-812` / `T59-816` | **DONE (R1+R2)** 2026-08-27 | R1 responsive/keyboard/RBAC/hostile source; R2 khóa mutation toàn workspace LIVE, bốn viewport và sửa finding axe rail icon-only | Playwright T59-812 9 PASS/1 skip; 1280/1024/768/390 không tràn; axe serious/critical 0 |
| `WP-12` | `T59-809` / `T59-813` / `T59-817` | **DONE (R1)** 2026-08-26 · **DONE (R2)** 2026-08-27 | Chạy/record `VS-PROG-U13`/`U14`, rollback, closeout increment | R1: [`EV-PGM02-R1-CLOSEOUT-001`](../../../07_records/test-evidence/programming/2026-08-26-pgm02-t59-809-r1-closeout.md) tại `d32e560`. R2: [`EV-PGM02-R2-CLOSEOUT-001`](../../../07_records/test-evidence/programming/2026-08-27-pgm02-t59-813-r2-closeout.md), có lane target trên Foxlinx (read-back 14/14 hash, fault + rollback drill) |
| `WP-13` | `T59-809` / `T59-813` / `T59-817` | **DONE (R1)** 2026-08-26 · **DONE (R2)** 2026-08-27 | Docs closeout R1/R2 trong cùng record; R2 kèm re-pin lattice hợp đồng và manifest baseline 1.53 | như trên |
| `WP-14` | `T59-818` | **DONE (HOST/LOCAL)** 2026-08-27 | Inspector context-sensitive năm ngữ cảnh (Program/Variable/ST symbol/FBD block/Connection) theo handoff cha §9 | `ContextInspector` dùng chung ST↔FBD; mô hình ngữ cảnh tách thành lớp thuần nên "không xác định được" kiểm được mà không dựng cây component. 15 test mô hình + 8 test component; FE 161 file/1823 test; chunk 122,28/165 KiB (R3). `UD-PROG-015` vẫn chặn đúng ba trường `Access`/`Description`/tên Task |
| `WP-15` | `T59-821` | **DONE (HOST/LOCAL)** 2026-08-27 | **Editor chrome**: toolbar ba mode (`PGM-02A §3`) + tab đa POU (`UD-PROG-014` = B, CLOSED) + status bar + Code Map cho ST | Năm điều `UD-PROG-014` để ngỏ chốt bằng test (`pouTabs.test.ts`, 16 ca): trần 8 tab, đuổi tab SẠCH ít dùng nhất, mọi tab bẩn ⇒ từ chối mở, đóng tab bẩn phải xác nhận, không sống qua reload, POU bị xoá thì tab ở lại và tự khai. Status bar cấm mặc định `UTF-8`/`LF`; EOL đọc từ buffer kể cả `MIXED`. Code Map dùng `CODE_MAP_MIN_LINES=80` — ngưỡng của `AC-FBD-012` chưa từng tồn tại trong repo. FE 170 file/1930 test; chunk 132,88/165 KiB (R3); E2E 53 PASS/11 skip |

> ### Đính chính 2026-08-27 — `WP-09` KHÔNG đóng trọn
>
> **Cập nhật cuối 2026-08-27: nhánh còn nợ đã giao ở `T59-819`, `WP-09` nay DONE.** Khối cảnh báo dưới đây
> giữ nguyên làm hồ sơ vì sao nó từng hở — không phải để mô tả hiện trạng.
>
> `T59-810` đóng đúng phần scope của **chính nó** (producer stamp + Trace pin).
> Nhưng thân `WP-09` bên dưới còn sở hữu một nhánh thứ hai chưa hề được giao:
> **Compare Draft↔Active có typed source/topology diff** — gồm `stHunks[]` và
> `fbdChanges[]` trong `GetRevisionChanges`, Compare drawer hiện đúng cặp
> Revision ID, luật "dirty Draft phải Save/seal trước khi compare", hai điều kiện
> acceptance và bộ golden test.
>
> Đo trên `ed6fb21`: `grep -rn "stHunks\|fbdChanges" contracts/ apps/web-api/ apps/web-ui/src`
> trả về **0 kết quả**. `DraftActiveCompareCard.tsx` là thẻ tóm tắt của PGM-01
> Overview, không phải typed diff có anchor.
>
> Vì vậy dòng `WP-09` hạ về `DONE (R2, MỘT PHẦN)` theo đúng nghĩa trạng thái
> `PARTIAL` của Plan 59 §0.1, và phần Compare được tách sang `T59-819`. Việc này
> **không** mở lại increment R2: R2 đóng đúng phạm vi các task R2 đã tuyên. Nó
> chặn việc tuyên `WP-09` đóng, và chặn closeout R3 cho tới khi `T59-819` xong.
>
> Nguồn: [`REC-PGM02-AUD-ADJ-001`](../../../07_records/reviews/PROGRAMMING_PGM02_AUDIT_GAP_ADJUDICATION_2026-08-27.md) `F-PGM02-AUD-002`.

> ### Hai work package mở thêm 2026-08-27
>
> Phán quyết audit tìm ra hai vùng UI mà **handoff v2.2 bắt buộc** nhưng
> `DDD-SW-PGM02-WORKSPACE-001` bản 0.1–0.3 không chuyển tiếp, nên không WP nào
> nhận và không code nào bị đòi:
>
> - `WP-14` **Inspector** — handoff cha §1 xếp Inspector vào shell dùng chung và
>   §9 định nghĩa năm ngữ cảnh. Hiện code chỉ có panel hai trường `Tên`+`Loại`
>   (`ProgramsTab.tsx:1516-1558`), đúng thứ §9 cấm.
> - `WP-15` **Toolbar editor ba mode** — `PGM-02A §3` liệt tập nút theo mode.
>   Thanh EDIT đã có bảy nút; còn thiếu `Check`, `Compare`, `More`, và chưa có
>   thanh riêng cho SIMULATE/LIVE. `SIMULATE`/`LIVE` nằm ở `ProgramsModeSwitcher`
>   — chuyển chỗ hợp lý, nay được ghi nhận chính thức thay vì lệch âm thầm.
>
> DDD 0.4 đã khôi phục cả hai vào cây component §7.2 và bảng ánh xạ §7.3, kèm
> bốn ca kiểm `TC-PGM02-TB-01`/`TC-PGM02-INS-01..03` ở §10.2.
>
> Phần **tab đa POU** (`PGM-02A §2`: `tabs + editor toolbar`) KHÔNG tự chốt: nó
> đổi state model FE và luật dirty-guard giữa các POU, nên mở `UD-PROG-014` cho
> Owner quyết trước.

**Danh sách block của plan đã ĐÓNG** 2026-08-26: cả sáu
(`TP`/`CTU`/`CTD`/`SCALE`/`DEADBAND`/`HYSTERESIS`) có ngữ nghĩa pin ở
`DDD-CTRL-PROG-001` §7A trước khi code, compiler+runtime+RETAIN thật và vector
conformance chạy ở cả ST lẫn FBD. `PI` vẫn là entry ma bị verify script chặn và
`PID` vẫn `REVIEW_REQUIRED` — đó là trạng thái đúng, không phải thiếu sót.

**Typed metadata public trong OpenAPI cũng đã giao** 2026-08-26: backend công bố
`signature` đã phân giải, `interface` thô giữ nguyên cho consumer cũ.

**`WP-03` đã ĐÓNG** 2026-08-26. Dock Quick Library nay phục vụ cả ST và FBD:
panel không biết cách chèn, mỗi bề mặt tự dựng (ST sinh đoạn mã tại con trỏ, FBD
dispatch `ADD_NODE` nên vẫn là MỘT bước hoàn tác và không tự nối dây). Mục mà
một bề mặt chưa nhận được thì hiện ngay lý do CỦA BỀ MẶT ĐÓ thay vì biến mất
khỏi danh sách.

Còn lại của `WP-03` nằm ở lớp bằng chứng, không phải code: chưa đo trên bo cho
sáu block mới, `PID` vẫn `REVIEW_REQUIRED` và `PI` vẫn là entry ma bị verify
script chặn.

**Phần của `WP-01` **đã giao ở `T59-807`** (giữ đoạn dưới để truy nguyên)** (đi cùng `WP-06`/`T59-807` vì cùng chạm một cây
component): CSS grid slot resizable/collapsible, context strip đầy đủ theo mode,
state machine `EDIT/SIMULATE/LIVE` tách buffer theo mode và dirty guard khi đổi
mode. `T59-802` chỉ đóng phần route/resolver/responsive; ghi rõ ở đây để không
ai đọc `DONE` thành "toàn bộ WP-01 đã xong".

**`WP-04` gặp một cổng thật.** Plan đặt CodeMirror 6 làm surface mới và ràng
buộc "sau dependency/license gate". Đo ngày 2026-08-26: chunk Programming đang
**104,77 KiB gzip**, ngân sách R1 pin trong `pgm02_workspace_v1.json` là **125
KiB**, tức dư địa còn **≈20 KiB** cho cả năm work package R1 còn lại — trong khi
một bộ CodeMirror tối thiểu ước lượng 90–150 KiB gzip. Hồ sơ cổng
[`GATE-PROG-ST-EDITOR-DEP-001`](../../../00_governance/PROGRAMMING_ST_EDITOR_DEPENDENCY_GATE.md)
nêu ba lựa chọn, năm phép đo bắt buộc và khuyến nghị; quyết định thuộc
Owner/Architect. `T59-805` tiếp tục phần KHÔNG phụ thuộc cổng đó.

Gate: `G-PGM02-01 EDIT_FOUNDATION` đã đủ **một route** (`WP-01`), **một POU
tree** (`WP-02`) và **một catalog authority** (`WP-03` — parity BE↔registry đo
được trên backend thật) ở lớp HOST/LOCAL. `WP-04` (`T59-805`, ST redesign) là
task READY tiếp theo. `VS-PROG-U13` và evidence target vẫn chưa chạy, nên gate
chưa được tuyên PASS ở lớp release.

## 1. Mục tiêu, phạm vi và invariant

### 1.1 Outcome

PGM-02 trở thành một Engineering Workspace chung cho ST/FBD tại
`/eng/programming/programs`, gồm một POU Explorer, một editor/canvas theo POU,
Quick Library, Inspector, Bottom Workbench và ba mode rõ ràng:

- `EDIT = Draft = write`.
- `SIMULATE = immutable saved Draft snapshot = sandbox = no physical output`.
- `LIVE = sealed Active Revision = controller read-back = read-only`.

### 1.2 Trong phạm vi

- FE shell, POU, ST/FBD, Quick Library, workbench, responsive/a11y/performance.
- BE/OpenAPI/library/diagnostics/reference/runtime coherence/trace/simulation.
- Core/runtime trace safety, observation identity và sandbox simulation executor.
- Contract, tests, target evidence, change control và Plan59 mapping.

### 1.3 Ngoài phạm vi

- Online patch/force/write trong LIVE.
- PLC IDE desktop clone hoặc expose CPU/thread/task trong normal UX.
- Thay store Draft/Revision hay viết lại FBD compiler/domain khi semantics đúng.
- Dùng host E2E simulator, global Virtual Point hoặc fake values làm Simulation.
- Tuyên bố release/target/HIL từ host/browser/unit test.

### 1.4 Invariant không được nới

```text
Draft != Active != Runtime
EDIT != Save != Check != Commission != Running
Save Draft không đổi Active
Check failure không phá Active/LKG
LIVE values chỉ đi với đúng sealed Active topology/source
SIMULATE không có physical output authority
Unknown/timeout/reconciling không là success
Missing/invalid/stale/offline không là 0
FBD port order và typed connection là canonical
```

## 2. Phasing, dependency và parallel lanes

| Phase | Work package | Outcome |
|---|---|---|
| Phase 0 | WP-00 | Authority, baseline, P0 register, budgets, Plan59 mapping draft |
| Phase 1 | WP-01, WP-02, WP-06 shell | Shared shell, một POU Explorer, workbench frame |
| Phase 2 | WP-03 | Shared catalog + Quick Library foundation |
| Phase 3A | WP-04 | ST target surface |
| Phase 3B | WP-05 | FBD node–edge canvas |
| Phase 4 | WP-09 | Coherent LIVE Active read-only |
| Phase 5 | WP-07 | Simulation contract/session/executor/virtual image |
| Phase 6 | WP-08 | Simulation UI và overlays |
| Phase 7 | WP-10, WP-11 | Performance + responsive + accessibility |
| Phase 8 | WP-12, WP-13 | Full E2E/V&V/target evidence/docs closeout |

### 2.1 Dependency DAG

```text
START       WP-00 -> { WP-01, WP-03, WP-07, WP-09-P0 }
SHELL       WP-01 -> { WP-02, WP-06-frame }
EDITORS     { WP-01, WP-02, WP-03 } -> { WP-04, WP-05 }
LIVE        { WP-00, WP-01, WP-02 } -> WP-09-full
SIM UI      { WP-01, WP-04, WP-05, WP-06, WP-07 } -> WP-08
PERF        { WP-05, WP-08, WP-09 } -> WP-10
RESP/A11Y   { WP-01, WP-04, WP-05, WP-06, WP-08, WP-09 } -> WP-11
VERIFY      { WP-03..WP-11 } -> WP-12 -> WP-13
```

`WP-09 P0 lane` có thể khởi động sau WP-00 để sửa Core/BE truth; integration
LIVE/Compare vào shell vẫn phải chờ WP-01/02. Tương tự WP-07 foundation chạy
song song, nhưng WP-08 không được bắt đầu integration trước đủ 01/04/05/06/07.

### 2.2 Lane có thể chạy song song

- Sau WP-00: `WP-01/02`, `WP-03`, P0 của `WP-09` và contract/runtime `WP-07`
  có thể chia team song song vì ownership file khác nhau.
- Sau WP-01/02/03: WP-04 ST và WP-05 FBD chạy song song, dùng chung catalog/mode
  contracts đã khóa.
- WP-06 frame chạy cùng WP-03; data panels hoàn thiện theo WP-04/05/09.
- WP-10 và WP-11 làm song song khi editor/canvas structure ổn định.
- WP-08 chỉ bắt đầu integration khi WP-07 cung cấp capability và real session;
  không mock session để unblock UI acceptance.

### 2.3 Merge/release increments

| Increment | WP bắt buộc | Điều được phép claim |
|---|---|---|
| R1 — EDIT | 00–06 + phần EDIT của 10/11/12/13 | Draft ST/FBD workspace; không LIVE overlay, không Simulation |
| R2 — LIVE | R1 + WP-09 + LIVE 10/11/12/13 | Active read-only coherent; chỉ capability thật |
| R3 — SIMULATE | R2 + WP-07/08 + Simulation 10/11/12/13 | Sandbox Simulation sau zero-output evidence |

Mỗi increment dùng feature flag/capability riêng. Không để nút disabled mơ hồ:
unsupported phải có copy “không được runtime/controller này hỗ trợ”.

## 3. Gate model

| Gate | Entry | Exit bắt buộc |
|---|---|---|
| `G-PGM02-00 AUTHORITY_READY` | Owner chấp thuận target/change request | Product/SRS/DDD/UX/handoff/Plan59 không mâu thuẫn; Owner+Architect pin hashes reconciled |
| `G-PGM02-01 EDIT_FOUNDATION` | WP-00 | Một route/một tree/một catalog authority; Draft regression xanh |
| `G-PGM02-02 EDITOR_READY` | WP-01..03 | ST/FBD AC, diagnostics/undo/keyboard, compile parity |
| `G-PGM02-03 LIVE_SAFE` | P0 contracts/Core fixes | Active source/value identities match; transition fail-closed; TSAN sạch |
| `G-PGM02-04 SIM_SAFE` | Simulation design/contracts reviewed | Worker isolated, deterministic, zero production state/output mutation |
| `G-PGM02-05 NFR_READY` | Editors/modes integrated | Performance/responsive/a11y budgets PASS |
| `G-PGM02-06 RELEASE_EVIDENCE` | Full candidate | Host + target/HIL evidence đúng lớp; QA/Product/Release sign-off |

Nếu một gate đỏ, các lane độc lập vẫn tiếp tục. Chỉ status/capability liên quan
bị chặn; không đổi failure thành success và không hạ acceptance.

## 4. Work Packages

## WP-00 — Current-state baseline và authority reconciliation

**Objective**

Tạo một baseline hợp lệ trước dòng code đầu tiên: khóa authority, defect P0,
contract version, route migration, mode semantics, performance budgets và task
mapping vào Plan59.

**Scope**

- Reconcile target v2.2 với Product v3.0, SRS, Architecture, Unified DDD, UX v2.0,
  FE/BE design, VVP/Trace/Risk và Plan59.
- Khôi phục/tạo đúng `PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md`, ba visual
  asset ổn định; sửa handoff manifest/tên package/link.
- Chốt primary route không project ID, legacy deep-link redirect, <768 read-only,
  true canvas, mode capability semantics.
- Đăng ký P0 Live/Trace/Commission và quyết định simulation worker architecture.
- Ghim project-context contract, Simulation RBAC/approved-input policy và
  multi-task `STEP_CYCLE` semantics trước khi sinh OpenAPI/runtime code.
- Ghim baseline test/performance/bundle/memory và evidence classes.

**Files affected**

- `docs/01_product/`, `docs/01_requirements/`, `docs/02_design/`,
  `docs/03_architecture/`, `docs/04_uiux/`, `docs/03_implementation/59_*`.
- `contracts/openapi/openapi.yaml`, `contracts/programming/product_profile_v2.json`,
  `contracts/ipc/programming_v2/` ở mức design/contract proposal.
- Handoff package, manifest/assets, VVP/trace/risk docs, `CHANGELOG.md`.

**FE work**

- Inventory route/component/test/bundle/browser baseline.
- Chốt `ProgramWorkspaceState`, POU identity, breakpoint và editor/canvas adapter
  interfaces; không implement UI production trong WP này.

**BE work**

- Inventory 33 routes và schema parity; capability/library/watch/trace/simulation
  contract delta; xác nhận migration/idempotency/retention.
- Đưa truth defects vào P0 work items với owner/acceptance.

**FW-SOM work**

- Inventory loader/executor/process image/trace/output boundaries.
- Detailed design simulation isolation, IPC/session commands, resource quotas,
  trace concurrency/revision identity.

**Dependencies / entry**

- Review `REC-PGM02-ST-FBD-REDESIGN-REVIEW-001` và Owner chấp thuận target/change
  request để mở WP-00; đây chưa phải phê duyệt baseline đã reconcile.
- Không code PGM-02 redesign trước `G-PGM02-00`.

**Acceptance criteria**

- Một authority route/mode/mobile/FBD/capability; không còn tài liệu Active xung đột.
- Mọi `TBD/BLOCKED` có owner, impact, gate và unlock condition.
- Plan59 có task IDs/owners/dependencies tương ứng WP; file này vẫn là proposal.
- Handoff visual/link/manifest scan sạch; candidate hash pin PASS.
- Product Owner + System Architect review và ký đúng baseline **sau** khi các
  authority/contract/asset đã được reconcile; hash ký là hash đi vào Plan59.

**Tests/verification**

- `docs_iso_harness.py --expect`, candidate pin, Markdown link/duplicate scan,
  generated-contract drift check, `git diff --check`.
- Ghi số đo mới cho test counts, bundle, browser viewports; không kế thừa số cũ.

**Risk**

- Scope lấn sang toàn Programming; kiểm soát bằng boundary PGM-02 và Plan59.
- Owner approval chậm chỉ chặn code authority, không chặn investigation/contract draft.

**Estimated complexity:** `M`

**Exit:** baseline reconciled được Owner + Architect phê duyệt/pin và
`G-PGM02-00 AUTHORITY_READY = PASS`.

## WP-01 — Shared Programs Shell

**Objective**

Tạo shell mode-neutral tại primary route, giữ Draft buffer an toàn và cung cấp
slot cho POU Explorer, ST/FBD surface, right dock, workbench.

**Scope**

- Primary path `/eng/programming/programs`; project authority là URL query
  `?project=<uuid>` khi cần, không phải hidden local-storage selection.
- Resolve bằng `GET /programming/projects?limit=2`: 0 project → empty/create;
  đúng 1 → chọn deterministic và cho phép URL không query; >1 legacy project →
  bắt buộc chooser/query, không âm thầm chọn item đầu.
- Legacy `/projects/:projectId/programs` redirect sang primary path kèm
  `?project=<id>` và preserve `program/line/column/tab/hash`; API vẫn dùng ID.
- Reload giữ context qua query; switch project chỉ đổi query sau dirty guard.
  Query invalid/forbidden/deleted trả explicit error/chooser, không fallback stale.
- Context strip luôn thể hiện Project, Draft dirty/check, Active/lifecycle,
  controller connection và mode.
- State machine frame `EDIT/SIMULATE/LIVE`, capability tri-state; trong increment
  đầu chỉ EDIT enabled, mode chưa supported có copy trung thực.
- Dirty navigation guard và separate buffers theo mode/document identity.

**Files affected**

- `apps/web-ui/src/features/programming/ProgrammingRoutes.tsx`.
- `layout/{ProgrammingLayout,ProgrammingContextStrip}.tsx`.
- `design/DesignWorkspacePage.tsx`.
- New `programs/{ProgramsPage,ProgramsWorkspaceShell}.tsx`,
  `programs/context/ProgrammingProjectContext.tsx`,
  `programs/mode/programModeMachine.ts` và tests.

**FE work**

- Dựng CSS grid/areas, resizable/collapsible slots nhưng chưa implement chi tiết.
- Mode transition giữ nguyên unsaved Draft buffer; LIVE dùng document slot riêng.
- Route-level loading/empty/error/offline/permission/reconciling.
- Context provider validate query/project ownership, abort request cũ khi switch và
  không dùng cached selected ID làm authority sau reload.

**BE work**

- Không đổi API chỉ để phục vụ route; `GET projects?limit=2` và `GET project` là
  authority. BE phải cưỡng `projectsPerController` theo profile hoặc trả drift
  nhiều project minh bạch để chooser xử lý; không trả “current project” mơ hồ.

**FW-SOM work**

- Không có code; xác nhận lifecycle states/capabilities mà UI được phép trình bày.

**Dependencies:** WP-00.

**Acceptance criteria**

- Một primary route và một `<h1>`; legacy link chuyển đúng context.
- Zero/one/multi/invalid/forbidden project cases deterministic qua reload/deep-link;
  profile max-one không bị FE dùng để che dữ liệu legacy >1.
- Không mất Draft buffer khi đổi dock/tab/mode unavailable/route rồi cancel.
- Context strip không suy luận Active/Running từ Draft/desired state.
- SIMULATE không hiện như available khi capability absent.

**Tests**

- Router/deep-link/redirect/query/hash; zero/one/multi/invalid/deleted/403 project
  context tests và reload/switch/abort-race E2E.
- Dirty buffer/unload/navigation/mode reducer unit tests.
- Browser desktop 1440 và empty/error/offline/permission snapshots.

**Risk:** route regression, duplicate fetch, hidden component giữ stale state.

**Estimated complexity:** `L`

**Exit:** shell có thể mount legacy editor adapter mà không đổi Save semantics.

## WP-02 — POU Explorer cleanup và identity model

**Objective**

Chỉ còn một POU Explorer đọc authority Draft/Revision, hỗ trợ ba POU kind và
tách `objectId` document identity khỏi `programId` runtime identity.

**Scope**

- Tree group/search/filter/create/rename/duplicate/delete/select cho PROGRAM,
  FUNCTION, FUNCTION_BLOCK theo capability thật.
- Selection/deep-link dùng `objectId`; adapter resolve runtime identity riêng.
- Transaction delete đúng dependency order; destructive confirmation/read-back.
- LIVE tree dùng sealed Active objects; EDIT tree dùng Draft objects; không reuse
  cùng mutable object graph.

**Files affected**

- `design/PouTree.tsx`, `design/editor/ProgramsTab.tsx`.
- `model/{draftV2,types}.ts`, `editor/workspaceAdapters.ts`.
- New `programs/pou/{PouExplorer,pouViewModel,pouCommands}.ts(x)`.
- BE Draft/POU validation tests nếu typed contract thiếu.

**FE work**

- Một view model raw `objects[]`; expanded/selection state keyed object ID.
- Editor resolver `{objectId, kind, language, runtimeProgramId?}`.
- Remove inner Application tree chỉ sau parity tests.

**BE work**

- Verify generic Draft ops hỗ trợ đủ POU lifecycle; bổ sung discriminated typed
  operations/schema, stable errors và references/preflight cho destructive ops.
- Không tạo endpoint đặc biệt nếu batch contract hiện có đáp ứng đúng.

**FW-SOM work**

- Verify compiler/check support FUNCTION/FB ST/FBD + typed interfaces/dependencies;
  capability-gate POU kind/language chưa support.

**Dependencies:** WP-01; compiler/API verification từ WP-00.

**Acceptance criteria**

- DOM có đúng một navigation POU; mọi POU chọn mở đúng source/inspector.
- Distinct object/program IDs không làm selection/runtime mapping sai.
- Create/delete/rename atomic, read-back authority; Function/FB không bị xếp lịch.
- Undo editor không bị reset khi tree expand/filter.

**Tests**

- Adapter identity/property tests với objectId≠programId.
- CRUD negative conflicts/references/permission tests.
- E2E one-tree + deep-link + reload + three POU kinds.

**Risk:** migration từ compatibility `document.programs`; delete cascade regression.

**Estimated complexity:** `L`

**Exit:** `G-PGM02-01` phần one-tree PASS.

## WP-03 — Quick Library foundation

**Objective**

Một catalog service duy nhất phục vụ PGM-02 Quick Library và PGM-04 Control
Library; insertion ST/FBD typed, atomic và undoable.

**Scope**

- Categories: Recent/Favorites/Common/HVAC/Logic/Math/Timer/Counter/Signal/Project.
- Search alias/name/description; compatible filters theo language, selected port,
  POU kind, data type/unit, product profile/library version.
- SYSTEM/PROJECT signatures/version/warnings/dispatch từ canonical authority.
- Recent/Favorites trong `/me/preferences`, namespaced và bounded.
- Bổ sung/qualify block target: PID/PI/TON/TOF/TP/R_TRIG/F_TRIG/CTU/CTD/LIMIT/
  SCALE/MIN/MAX/Deadband/Hysteresis/Compare/Logic.

**Files affected**

- `contracts/programming/pou_library_registry_v1.json`, generators/generated outputs.
- BE `domain/application/transport/http/store/library*`, OpenAPI.
- FE `library/LibraryPage.tsx`, `fbd/palette.ts`, new
  `programs/library/*`, preference hooks, generated client.

**FE work**

- `LibraryCatalogService` normalizes SYSTEM + PROJECT without copying signatures.
- `QuickLibrary` dock/search/category/favorite/recent/capability states.
- ST/FBD insertion adapters dispatch one transaction/domain command.

**BE work**

- Public typed metadata/signatures/ports/category/type constraints/warnings.
- Preferences validation/size/ownership; catalog paging/version/cache semantics.
- Stable `unsupported/review-required/version-drift` errors.

**FW-SOM work**

- Compiler dispatch/signature/IR/tests cho missing target blocks.
- Không publish block capability trước compiler/runtime equivalence tests.

**Dependencies:** WP-00; dock integration WP-01; editor integration WP-04/05.

**Acceptance criteria**

- PGM-02 và PGM-04 cùng catalog ID/version/signature/count/hash.
- Không có ST/FBD hard-coded block list thứ hai.
- Function call, FB create+call, FBD add+connect mỗi hành động là một Undo.
- Ambiguous FBD port không auto-connect; incompatible items bị loại/giải thích.
- Recent chỉ update sau successful insertion; Favorites không giữ signature copy.

**Tests**

- Generator exact-parity C++/Go/TS + registry hash/count.
- OpenAPI/client/store/preferences restart tests.
- ST insertion golden/source selection/undo; FBD typed insertion/undo.
- PGM-04/PGM-02 catalog cross-surface E2E.

**Risk:** catalog divergence, missing compiler support, signature/version drift.

**Estimated complexity:** `XL`

**Exit:** shared catalog ready; unsupported blocks returned honestly.

## WP-04 — ST redesign

**Objective**

Thay custom textarea surface bằng editor transaction phù hợp engineering UX,
trong khi giữ Draft pipeline và compiler semantic authority.

**Scope**

- CodeMirror 6 presentation adapter: gutter, syntax, bracket, indent, find/replace,
  format, multi-cursor policy, diagnostics, completion/signature/hover, go-to-def.
- Preserve current pure ST utilities until behavior parity; remove duplicate
  history after CodeMirror transaction history is authoritative.
- Quick Library Function/FB insertion, instance creation, typed templates.
- Problems/Search/Cross Reference/Watch decorations theo mode.
- Unsupported syntax produces stable diagnostic, editor không crash.

**Files affected**

- `design/editor/ProgramsTab.tsx`, `stEditorSupport.ts`, related tests.
- New `programs/st/{StEditor,stExtensions,stDecorations,stCommands}.ts(x)`.
- BE compiler/check/reference schemas; generated client.
- `apps/web-ui/package.json`/lockfile sau dependency/license gate.

**FE work**

- Controlled document bridge keyed `{mode,documentId,pouObjectId}`.
- One transaction per formatting/insertion/refactor; selection/focus preserved.
- Read-only extension in LIVE; <768 no edit/paste/drop/keyboard mutation.
- Runtime decorations consume keyed snapshot store, never rewrite source.

**BE work**

- Persist/expose compiler symbols and reference index; exact diagnostics.
- Do not make FE tokenizer/parser authoritative; no direct Draft Check shortcut
  unless contract approved.

**FW-SOM work**

- Source map exact line/column/length/POU; supported language constructs metadata.
- Arbitrary symbol observation targets coordinated with WP-09.

**Dependencies:** WP-01/02/03; semantic data can land incrementally.

**Acceptance criteria**

- Current save/conflict/find/format/indent/completion/history behaviors preserved.
- FB create instance + invocation Undo once; Save once; Check compile exact source.
- Diagnostic jump exact; hover/ref absence shows unavailable, not guessed content.
- LIVE and mobile cannot mutate via typing/paste/drop/IME/commands.
- Large allowed source remains responsive within WP-10 budget.

**Tests**

- Existing ST unit/E2E behavioral suite, CodeMirror transaction/IME/undo tests.
- Compiler diagnostic/source map golden + unsupported syntax/fuzz smoke.
- Browser keyboard/focus/scroll/alignment at desktop/mobile.

**Risk:** editor dependency bundle, IME/controlled state, dual history, a11y.

**Estimated complexity:** `XL`

**Exit:** AC-ST-001..011 mapped and passed for applicable increment.

## WP-05 — FBD canvas redesign

**Objective**

Biến card renderer thành true node–edge canvas mà không thay canonical execution
model, typed validation hay port `order`.

**Scope**

- Versioned presentation `layout` keyed network/node; viewport derived/persisted
  theo approved contract; compiler ignores geometry semantically.
- Controlled canvas adapter (`@xyflow/react` proposed): node/ports/wires,
  pan/zoom/grid/snap/fit/minimap, drag, box/multiselect, copy/paste, align.
- Inspector node/port/wire/network; exact diagnostics markers/jump.
- Quick Library drag/click/selected-port insert; keyboard parity.
- Separate runtime overlay layer, no decorative wire animation.

**Files affected**

- `fbd/{model,commands,StructuredFbdEditor,palette}.ts(x)` + tests.
- New `programs/fbd/{FbdCanvas,FbdViewport,FbdNode,FbdWire,FbdRuntimeLayer}.tsx`.
- FBD schema/compiler canonicalization/source map contracts.
- Package/lockfile after license/bundle/perf gate.

**FE work**

- Adapter maps canonical domain ↔ canvas view; library nodes/edges never own truth.
- New domain commands `SET_NODE_POSITION`, `MOVE_SELECTION`, `PASTE_SUBGRAPH`,
  `ALIGN_SELECTION`, `ADD_NODE_AND_CONNECT` with one history transaction.
- Execution order edit remains explicit, không derive từ x/y.

**BE work**

- Store/seal/read geometry with FBD document; validate bounded coordinates/size.
- Diagnostics/reference contract includes network/node/port/wire IDs.

**FW-SOM work**

- Compiler ignores layout for executable semantics; canonical/golden confirms
  same topology gives same IR independent of geometry.
- Observation/source map target IDs for WP-09.

**Dependencies:** WP-01/02/03; WP-09 for live overlay data.

**Acceptance criteria**

- True visible node-edge graph; wires not hidden; typed invalid connect blocked.
- Save/reload/Revision LIVE reproduces layout; port `order` unchanged.
- Multi-action gesture Undo once; keyboard can place/select/connect/delete/undo.
- 256 block/512 wire fixture usable and meets WP-10 budgets.
- Topology serialization không đổi khi chỉ runtime values đổi.

**Tests**

- Domain property/golden/equivalent-IR/port-order tests.
- Canvas interaction/keyboard/a11y/snapshot/E2E at max-size fixture.
- Diagnostic jump and Quick Library selected-port tests.
- Spike gate: dependency license, bundle, SSR/build, memory/perf; SVG fallback nếu đỏ.

**Risk:** canvas library thành shadow model, geometry hash churn, full rerender,
keyboard/a11y regression.

**Estimated complexity:** `XL`

**Exit:** AC-FBD-001..011 mapped; renderer legacy removable.

## WP-06 — Bottom Workbench

**Objective**

Một workbench dùng chung cho Problems, Watch, Trace, Search, Cross Reference,
đúng document/value source của mode hiện hành.

**Scope**

- Collapsible/resizable bottom panel, tab state, keyboard focus/shortcut.
- Extract/reuse PGM-05 Problems và PGM-06 Watch/Trace queries/presenters.
- Search local current document; Cross Reference compiler-derived.
- Jump ST location hoặc FBD network/node/port/wire; mode/source badge mỗi panel.

**Files affected**

- `shared/ProblemsDrawer.tsx`, `commission/CheckCommissionPage.tsx`.
- `runtime/{RuntimeServicePage,WatchTab,TraceTab}.tsx` và query hooks.
- New `programs/workbench/*`.

**FE work**

- Reusable panels không duplicate poll/websocket; cancel on mode/document switch.
- Preserve null/quality/freshness/source; no CPU/thread/task noise in normal UX.

**BE work**

- Watch/Trace/reference/diagnostic APIs từ WP-09/03/04/05.
- Persisted Watch selection nếu approved; otherwise preferences with typed IDs.

**FW-SOM work**

- Trace/diagnostic observation identities và bounded capture từ WP-09.

**Dependencies:** frame WP-01; full data WP-03/04/05/09; simulation source WP-07.

**Acceptance criteria**

- Mỗi tab ghi rõ EDIT/SIMULATE/LIVE và revision/session source.
- Switching mode không giữ samples/diagnostics từ source cũ.
- Jump exact và keyboard reachable; unavailable tab giải thích capability.
- Không duplicate concurrent trace/poll sessions khi panel remount.

**Tests**

- Panel state/source cancellation/query dedupe unit tests.
- Problems ST/FBD jump, Watch null/stale, Trace source/stop reason E2E.
- Keyboard/tab/focus/screen-reader tests.

**Risk:** duplicated polling, stale data leak, focus trap, PGM-05/06 regression.

**Estimated complexity:** `L`

**Exit:** workbench frame vào R1; mode data gates độc lập.

## WP-07 — Simulation infrastructure

**Objective**

Tạo product Simulation thật từ saved Draft snapshot với isolated runtime,
virtual inputs/time và bằng chứng không có physical output authority.

**Scope**

- Additive capability contract và session lifecycle:
  `PREPARING/RUNNING/PAUSED/COMPLETED/FAILED/EXPIRED/STOPPED`.
- Atomic snapshot/compile artifact; snapshot ID, Draft ETag/base, artifact hash,
  profile/library versions, owner, quota/expiry/audit.
- REST create/get/action/set-input/read/trace/stop; idempotency/restart/reconcile.
- RBAC pin từ WP-00: GET session/snapshot `viewer+`; baseline đề xuất chỉ `admin`
  create/control/set input. Nếu Owner mở cho operator, contract policy phải ghi
  tường minh và test cùng gate, không chỉ enable nút FE.
- Compiler-generated `simulationInputs[]` allowlist theo đúng artifact: stable ID,
  POU/interface, type/unit/range, `simulationWritable`; cấm arbitrary Point ID.
- Ephemeral sandbox worker dùng production loader/executor, private runtime images
  và virtual clock; zero production I/O components/permissions.
- Multi-task Step là một GCD base tick, release mọi task due theo production stable
  order và commit một sandbox output batch; không có `STEP_PROGRAM` v1.

**Files affected**

- `contracts/openapi/openapi.yaml`, generated clients/types.
- BE new `application/simulation*.go`, transport/routes/store/migration/audit,
  compiler runner integration.
- Core ST runtime libraries; new bounded simulation worker main/adapters; IPC
  schema only if worker protocol uses Programming IPC.
- Packaging/systemd permissions/seccomp/cgroup docs/tests; worker không là daemon.

**FE work**

- Chỉ consume capability/types và test unsupported/unavailable copy ở WP này.

**BE work**

- Session manager, process lifecycle, immutable snapshot/artifact, quotas,
  expiry/restart cleanup, RBAC/audit/idempotency.
- Validate every set-input against session artifact manifest; chỉ `VAR_INPUT` hoặc
  binding `READ` được policy đánh `simulationWritable=true`; exclude OUTPUT,
  IN_OUT, RETAIN/internal, command/override và production writer.
- Stable errors: `403 PRG-SIM-FORBIDDEN`, `422 PRG-SIM-INPUT-NOT-ALLOWED`,
  `409 PRG-SIM-STALE-SESSION`; denial/accepted action đều audit actor/session/input.
- Never call production Commission/Cutover; worker stdout/protocol bounded.

**FW-SOM work**

- Private scheduler/process-image/signal/RETAIN and virtual clock.
- `RUN/PAUSE/STEP/RESET/SET_SPEED/SET_INPUT/READ/TRACE/STOP` deterministic.
- PREPARE/RESET đặt `t=0`, all task `nextRelease=0`; Step snapshot input một lần,
  chạy mọi task due, timer mỗi task chỉ tiến configured-period delta khi task đó
  release, commit batch rồi tăng đúng base tick và về PAUSED.
- Worker has no SHM/device socket/output writer/candidate registry privileges.

**Dependencies:** WP-00 detailed design/contract; independent of WP-04/05 UI.

**Acceptance criteria**

- Start requires saved current Draft ETag; dirty/stale snapshot rejected clearly.
- Same snapshot + inputs + step sequence yields identical result at 1×/10×/60×.
- Pause advances no timer; Step đúng một GCD base tick theo release/order đã ghim;
  Reset follows declared sandbox RETAIN init policy.
- Profile `[1s,5s,30s]`: first boundary và các boundary 5s/30s có exact golden
  release order; 5s/30s timer không tiến ở tick không due; speed không đổi bytes.
- User/role/input deny không gọi worker và không đổi virtual image; retry cùng
  idempotency key apply đúng một lần rồi read-back cùng sequence.
- Worker crash/timeout/quota only fails session; Active/LKG/Core scan unchanged.
- Byte/state checks prove no change to production journal/checkpoint/PointTable/
  signal/candidate/resolver/output writer.
- Capability is false/unavailable until all contract/runtime gates pass.

**Tests**

- Contract/store/idempotency/restart/quota/expiry/audit/fault-injection tests.
- RBAC matrix viewer/operator/admin; allowlist/output/IN_OUT/RETAIN/type/range/
  stale-artifact negative cases; audit accepted/denied assertions.
- ST/FBD golden/equivalence/deterministic virtual-time suite.
- Multi-task 1/5/30s initial/coincident-release/timer/order/speed-factor corpus.
- OS permission negative tests for SHM/device/UDS; worker crash/kill/power-loss.
- Target/HIL observation lane for zero physical output before release claim.

**Risk:** safety boundary, resource exhaustion, executor divergence, orphan workers,
incorrect virtual time/RETAIN semantics.

**Estimated complexity:** `XL`

**Exit:** `G-PGM02-04 SIM_SAFE = PASS`; real capability supported.

## WP-08 — Simulation UI

**Objective**

Nối ST/FBD workspace với real Simulation session, virtual inputs, Watch/Trace và
controls mà không fake values hay lẫn controller LIVE.

**Scope**

- SIMULATE transition: dirty prompt `Save Draft before simulation`, create session,
  show snapshot/revision/artifact/session identities.
- Banner `NO REAL OUTPUT`; run/pause/step/reset/stop/speed controls.
- Right dock virtual inputs; typed validation/unit/quality.
- ST/FBD runtime overlays và Workbench from simulation session only.
- Session failed/expired/offline/reconnect/reconcile/stop states.

**Files affected**

- `programs/mode`, `programs/st`, `programs/fbd`, `programs/workbench`.
- New `programs/simulation/{SimulationControls,VirtualInputs,useSimulation}.ts(x)`.
- Generated simulation client/types.

**FE work**

- Session reducer keyed session/snapshot/artifact; cancel stale requests.
- Controls reflect read-back state; no optimistic running/paused success.
- Values keyed observation ID and source `SIMULATION`, never reuse LIVE store.
- Render source/session cho viewer+; mutation controls theo capability+server RBAC,
  xử lý `403/409/422` fail-closed và không suy quyền từ role label đơn thuần.

**BE work**

- Stable session/action/read endpoints from WP-07; websocket/poll strategy with
  sequence/snapshot IDs/backpressure.

**FW-SOM work**

- Coherent session snapshots/diagnostics/trace with virtual timestamp domain.

**Dependencies:** WP-01/04/05/06/07.

**Acceptance criteria**

- Unsupported runtime cannot start session and never shows sample values.
- Dirty/stale Draft cannot silently simulate old content.
- Every value shows simulation source/freshness/quality; missing stays `—`.
- Stop/return to Draft removes overlays and restores exact Draft buffer.
- No control mutates controller Active/physical Point/override.
- Non-authorized role cannot start/control/set input by click, keyboard or direct
  client call; denial keeps last authoritative session state and shows reason.

**Tests**

- Mode/session reducer, stale response, reconnect, action read-back tests.
- ST/FBD overlay + virtual input + run/pause/step/reset deterministic E2E.
- Negative Network/timeout/unknown and cross-source contamination tests.

**Risk:** fake optimistic UI, stale session overlay, accidental reuse LIVE endpoints.

**Estimated complexity:** `XL`

**Exit:** AC-ST-006/AC-FBD-008/AC-PGM02-008 PASS with real worker.

## WP-09 — LIVE Active monitor và runtime truth correction

**Objective**

LIVE luôn render đúng sealed Active source/topology và coherent controller values;
đóng P0 Trace/Commission/revision join trước khi expose, đồng thời sở hữu Compare
Draft↔Active có typed source/topology diff.

**Scope**

- Runtime snapshot identity tuple: active/runtime revision, lifecycle, artifact,
  snapshot/sequence/timestamp domain.
- FE loads Active Revision separately, read-only; overlay only on exact tuple match.
- Core trace mailbox/single-writer/published ring/revision pin; source locations.
- BE Commission UNKNOWN/impact fail-open fixes; Trace truth/persistence/idempotency.
- Bound Monitor giữ; arbitrary Watch/internal FBD port observation capability-gated.
- Compare authority: dirty Draft phải Save; seal current saved Draft bằng route
  Revision hiện có, rồi compare immutable Draft Revision với immutable Active.
  Unsaved local preview nếu có phải ghi rõ client-only, không dùng cho impact/Check.
- Extend Revision changes additively với ST line hunks và FBD network/node/port/
  wire change IDs; không dùng object hash-only làm UI “no change”.

**Files affected**

- FE `workspaceAdapters.ts`, runtime queries/overlays/mode/workbench/ST/FBD layers.
- BE `application/{runtime,monitor,trace,operations,changes,runtime_intent}.go`,
  transport/store/OpenAPI/generated client.
- Core `st_value_trace.*`, scheduler/runtime snapshot, `program_ipc_server.cpp`,
  scan/safe-boundary/coordinator; IPC schema.

**FE work**

- Remove Active overlay from EDIT.
- LIVE entry sequence runtime→revision→snapshot; mismatch/reconciling suspends overlay.
- Read-only at component and command layers; Quick Library hidden/disabled.
- Compare drawer luôn hiện Draft Revision/Active Revision IDs; click hunk/node jump
  vào đúng read-only side, không chuyển selected source ngầm.

**BE work**

- Preserve unknown truth; fail-closed runtime impact lookup and identity mapping.
- Trace preserves Core timestamp/source/actual/program values/stop reason; no silent
  approximate fallback. Persist idempotency/session metadata across restart.
- Active Revision API reused; add snapshot coherence fields additively.
- `GetRevisionChanges` không nuốt runtime-intent store error; extend schema với
  deterministic `stHunks[]` và `fbdChanges[]`, bounded payload/truncation/cursor.

**FW-SOM work**

- Apply trace Start/Stop at safe boundary; ring publication concurrency safe.
- Pin revision/artifact and terminate/segment on activation.
- Export runtime candidate revision identity before Active commit; no mixed join.

**Dependencies:** WP-00/01/02; ST/FBD decorations integrate WP-04/05.

**Acceptance criteria**

- During every Commission phase/fault/rollback, UI shows either coherent old/new
  tuple or `RECONCILING/UNAVAILABLE`; never mixed source/value.
- Trace TSAN concurrency clean; activation gives exact revision marker/stop reason.
- Actual physical value never copied from Program candidate; source declared.
- `valid=false/stale/offline/missing` remain null/quality, never zero.
- LIVE cannot mutate by mouse/keyboard/API from PGM-02.
- Compare sau Save/seal nêu đúng IDs và deterministic diff; không Active trả empty
  state có lý do; dirty Draft không được silent compare snapshot cũ.

**Tests**

- Core TSAN scan + Start/Read/Stop + activation/rollback.
- BE fault injection UNKNOWN/read-back/store error/objectId≠programId/restart.
- Trace timestamp/source/actual/stop/idempotency/quota tests.
- Compare golden tests: ST add/delete/replace hunks; FBD node/port/wire add/remove/
  update; order-only/geometry-only; no Active; dirty guard; store-error fail-closed;
  payload limit/cursor và exact UI jump.
- Real-backend E2E Commission concurrent LIVE/Watch/Trace; no mixed tuple.

**Risk:** runtime undefined behavior, control truth misreporting, schema churn,
over-observability resource cost.

**Estimated complexity:** `XL`

**Exit:** `G-PGM02-03 LIVE_SAFE = PASS`.

## WP-10 — Performance

**Objective**

Giữ editor/canvas usable ở giới hạn product và ngăn runtime sample làm re-render
toàn FBD topology.

**Scope**

- Separate immutable topology/document store và keyed runtime value store.
- Memoized nodes/wires/decorations; viewport virtualization/culling nếu cần.
- Batched snapshots, sequence coalescing, render throttle; no data falsification.
- Measure FBD 256 blocks/512 wires, max ST source, Workbench Watch/Trace limits.
- Bundle/startup/memory/CPU budgets được chốt ở WP-00.

**Files affected**

- FBD runtime layer/store/selectors, ST decorations, query/websocket layer.
- BE snapshot batching/backpressure contract; Core bounded publish/read.
- Performance fixtures/scripts/evidence docs.

**FE work**

- Runtime update touches only affected keyed subscribers.
- Profiler marks render count/commit duration; pause refresh preserves last sample
  as paused/stale, không thành current.

**BE work**

- Bounded page/sample size, sequence IDs, backpressure/drop count semantics.

**FW-SOM work**

- Bounded snapshot/trace publication; RT path no heap/lock regression.

**Dependencies:** WP-05; runtime overlays WP-08/09.

**Acceptance criteria**

- Topology object/hash unchanged across value-only updates.
- Một sample không commit toàn bộ 256 nodes; render count/budget theo WP-00.
- Pan/zoom/drag/typing remain within approved p95 budget on target browser profile.
- Dropped/throttled samples declared; latest quality/freshness not fabricated.

**Tests**

- React Profiler/render-count unit fixtures; browser trace at 256/512/max ST.
- BE/Core load/backpressure/overflow and resource-bound tests.
- Target browser/board performance lane before release.

**Risk:** premature optimization, stale value display, target GPU/CPU variance.

**Estimated complexity:** `L`

**Exit:** measured NFR budgets PASS; evidence class stated.

## WP-11 — Responsive và accessibility

**Objective**

Thực thi layout contract theo breakpoint và bảo toàn keyboard/screen reader/
contrast khi thay ST/FBD surfaces.

**Scope**

- `>=1280`: full shell; `1024–1279`: compact dock; `<1024`: drawer/collapsible;
  `<768`: read-only, không edit ST/FBD.
- Context strip Draft/Active/mode always discernible; raw IDs in Details.
- Keyboard routes for Explorer/editor/canvas/docks/workbench; focus restoration.
- High contrast/light/dark/reduced motion/touch target/i18n overflow.

**Files affected**

- Programs shell/layout/context, ST/FBD/Explorer/docks/workbench styles/components.
- Shared theme/tokens only additively; responsive/a11y tests.

**FE work**

- Drawer state/aria/focus trap/escape; command mutation guard independent of CSS.
- Mobile read-only banner and mutation controls removed/disabled.

**BE work**

- RBAC remains server authority; no viewport-based server policy.

**FW-SOM work**

- Không có thay đổi runtime; chỉ xác nhận UI không suy diễn capability/authority
  từ viewport.

**Dependencies:** WP-01/04/05/06; mode states 08/09.

**Acceptance criteria**

- Verified 1920, 1440, 1280, 1024, 390; no hidden critical Draft/Active state.
- At 390, typing/paste/drop/Add/Delete/Save/drag/connect/session mutation unavailable.
- Full keyboard flow without trap; diagnostic jump/focus restoration exact.
- Color not sole state; contrast/reduced-motion/labels pass approved checks.

**Tests**

- Responsive browser screenshots/snapshots; mutation-negative mobile E2E.
- axe automated + manual keyboard/screen reader smoke.
- Light/dark/i18n long-copy/focus-order tests.

**Risk:** CSS-only read-only bypass, drawer focus trap, canvas keyboard regression.

**Estimated complexity:** `L`

**Exit:** breakpoint/a11y matrix PASS.

## WP-12 — E2E / V&V

**Objective**

Chứng minh end-to-end producer→contract→UI→read-back cho từng increment và tách
rõ HOST/CI/TARGET/HIL/RELEASE evidence.

**Scope**

- Unit/component/property/contract/integration/real-backend/browser/TSAN/fault.
- UC matrix EDIT/LIVE/SIMULATE, RBAC, states, responsive/a11y/performance.
- Commission transition/rollback/power loss; simulation zero output; trace safety.
- Negative/fault cases không được phép waiver bằng fake fixture.

**Files affected**

- FE tests/e2e/fixtures, BE Go tests, Core C++/TSAN/integration tests,
  scripts/CI/target evidence records, VVP/trace/risk.

**FE work**

- Target AC e2e: one tree, Quick Library, ST/FBD, mode transitions, null/stale,
  read-only/mobile, workbench, exact diagnostics.

**BE work**

- OpenAPI/generated schema parity; restart/idempotency/fault injection; coherent
  snapshots; library/reference/watch/trace/sim contracts.

**FW-SOM work**

- Full affected C++ gate, sanitizer, lifecycle, deterministic sim, resource/WCET,
  target/HIL physical output observation.

**Dependencies:** all implementation WPs for the increment.

**Acceptance criteria**

- Requirement→test map has result/evidence/authority; no empty “PASS”.
- Real-backend browser: failed requests/server 5xx/console errors within approved
  budget (default 0 for tested path), with exact source stated.
- No mixed Draft/Active/Runtime sample under concurrency/fault.
- Simulation evidence includes negative physical-output path and target observation;
  host pass alone không đủ `RELEASE_READY`.
- Rollback restores FE route/surface, BE schema/binary compatibility và runtime
  Active/LKG; user Draft không mất.

**Tests**

- C++ configure/build/ctest with required options; TSAN affected suites.
- Go vet/test `-count=1`; OpenAPI/generator/golden/DB restart.
- FE Vitest/lint/build + Playwright mock and real-backend; Chrome DevTools when
  environment supports it.
- Target/HIL procedure per VVP, physical outputs observed and recorded.

**Risk:** false-green fake, flaky timing, unavailable target, evidence-class mixing.

**Estimated complexity:** `XL`

**Exit:** `G-PGM02-05` and applicable `G-PGM02-06` PASS.

## WP-13 — Docs closeout

**Objective**

Đồng bộ As-Built, contracts, verification, risk và tracker; đóng record mà không
biến plan thành bằng chứng thực thi.

**Scope**

- Product/SRS/Architecture/DDD/UX/FE handoff/API/IPC/data/state/fault/deploy/rollback.
- Requirement→test trace, Risk Register residual/sign-off, VVP/Test Results.
- Plan59 task status/provenance, candidate hashes/manifests, CHANGELOG.
- Update chính review này bằng closure status/finding evidence; không tạo review
  mới chỉ để nói review cũ đã cũ.

**Files affected**

- Controlled docs indexes/manifests/authority docs, Plan59, test-evidence,
  `CHANGELOG.md`.

**FE work**

- Cung cấp As-Built component/source map, responsive/a11y/performance result,
  browser evidence và rollback route/feature flag.

**BE work**

- Cung cấp OpenAPI/store/migration/idempotency/audit As-Built, contract version,
  restart/fault results và deploy/rollback evidence.

**FW-SOM work**

- Cung cấp compiler/runtime/trace/simulation/output-boundary As-Built, sanitizer,
  resource/timing, target/HIL và rollback evidence của boundary runtime.

**Dependencies:** WP-12 đã tạo đủ raw result/evidence cho các gate áp dụng; sign-off
là exit authority của WP-13, không phải dependency đầu vào.

**Acceptance criteria**

- As-Built khác Target/TBD rõ ràng; không claim capability chưa chạy.
- Plan59 là status authority duy nhất; task/commit/PR/evidence links truy xuất được.
- Docs harness/link/duplicate/candidate pin/manifest/hash/`git diff --check` PASS.
- `RELEASE_READY` chỉ đổi khi target/HIL/result/residual-risk authority đủ.
- Owner/Architect/QA/Release authority ký đúng phạm vi sau khi review controlled
  baseline và evidence; lane chưa có target/HIL vẫn giữ NO-GO tương ứng.

**Tests/verification**

- Full docs harness, candidate pin, Markdown links, generated contract drift,
  changelog/index checks và manual truth review.

**Risk:** docs stale, duplicate tracker, residual risk bị hạ bằng văn bản.

**Estimated complexity:** `M`

**Exit:** controlled baseline cập nhật, review closure và sign-off áp dụng được
phê duyệt; `RELEASE_READY` chỉ đổi nếu toàn bộ release gate thật sự đủ.

## WP-14 — Inspector context-sensitive

**Objective**

Đưa Inspector từ panel metadata hai trường lên đúng hợp đồng shell dùng chung:
một panel duy nhất, đổi nội dung theo ngữ cảnh con trỏ/lựa chọn, dùng chung cho
cả ST lẫn FBD và cả ba mode.

**Nguồn:** handoff cha §1/§9; `PGM-02A §9`; `PGM-02B §9`;
`REC-PGM02-AUD-ADJ-001` `F-PGM02-AUD-001`. DDD 0.4 §7.2/§7.3/§10.2.

**Scope**

- Năm ngữ cảnh: `Program`, `Variable`, `ST symbol/call`, `FBD block`,
  `Connection`. Mỗi ngữ cảnh đúng tập trường mà handoff §9 liệt.
- Program gom `Name · Language · Cycle · Enable · Description · Advanced Execution`
  — `Cycle`/`Enable` hiện sống ở `ExecutionTab.tsx`, phải chiếu về Inspector chứ
  không nhân bản nguồn chân lý.
- ST symbol/call lấy `Definition/Type/Signature/Documentation/References` từ chỉ
  mục tham chiếu thật (`stReferenceIndex.ts`) và normalized signature của Library.
  Analyzer không chắc thì ghi "không xác định được", **cấm đoán**.
- FBD block/connection đọc canonical graph; giữ nguyên `nodeId/portId/wireId` và
  port `order`.
- Live/Sim value trong Inspector dùng đúng value tuple của mode đang mở, tái dùng
  `StRuntimeValueOverlay` — không mở đường đọc thứ hai.
- Thu gọn khi không có ngữ cảnh hữu ích (handoff §9 cấm chiếm 300 px cho hai
  trường). Chia dock với Quick Library ở 1280–1439 px theo `PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md` §479.

**Files affected**

- FE `design/editor/ProgramsTab.tsx` (tách `ProgramInspector` ra component riêng),
  `design/editor/stReferenceIndex.ts`, `fbd/StructuredFbdEditor.tsx`,
  `design/task/ExecutionTab.tsx`, `model/library.ts`.

**Dependencies:** WP-02 (identity), WP-03 (signature), WP-04 (chỉ mục tham
chiếu), WP-05 (canonical graph). Không phụ thuộc WP-07/08 nên chạy song song R3.

**Acceptance criteria**

- Đúng tập trường theo từng ngữ cảnh; không ngữ cảnh nào render trường của ngữ
  cảnh khác.
- Sửa metadata chỉ ở EDIT + admin; các mode/vai trò khác read-only ở **cả** lớp
  component lẫn lớp lệnh.
- Signature/type không tra được ⇒ nói rõ, không fallback đoán.
- Không ngữ cảnh nào làm Inspector chiếm chỗ khi rỗng.
- Giá trị LIVE/SIM stale có nhãn; unavailable là `—`, không phải `0`.

**Tests/verification**

- `TC-PGM02-INS-01/02/03` (DDD §10.2), axe quét dock ở cả ST và FBD, RBAC
  negative viewer/operator.

**Risk:** nhân bản nguồn chân lý `Cycle`/`Enable`; đoán signature khi analyzer im
lặng; Inspector phình chiếm chỗ của editor ở 1280 px.

**Estimated complexity:** `M`

**Exit:** `TC-PGM02-INS-01..03` PASS; không tăng chunk quá ngân sách R3.

## WP-15 — Editor chrome: toolbar ba mode, tab POU, status bar, navigator map

**Objective**

Dựng đủ phần "khung" của editor mà hợp đồng và ba ảnh render đòi nhưng bản DDD
0.1–0.3 không chuyển tiếp: thanh công cụ theo mode, tab đa POU, status bar và
navigator map. Đây là bốn thứ khác nhau nhưng cùng một cây component và cùng một
lớp trạng thái, nên tách WP sẽ tạo ba lần sửa chồng lên `ProgramsTab.tsx`.

**Nguồn:** `PGM-02A §2/§3/§11`; `PGM-02B §2`; `REC-PGM02-AUD-ADJ-001`
`F-PGM02-AUD-004`. DDD 0.4 §7.2/§7.3/§10.2.

**Scope**

- EDIT: bổ sung `Check`, `Compare`, `More` vào thanh hiện có (`Save · Undo ·
  Redo · Find · Format` đã có từ `FE-ST-009`). `Check` gọi đúng workflow đang
  có, không dựng luồng thứ hai; `Compare` phụ thuộc `T59-819`.
- SIMULATE: `Pause/Run · Step · Reset · Speed · Stop Simulation · Watch · Trace`
  — phụ thuộc `T59-815`.
- LIVE: `LIVE Active r<n> · Pause Refresh · Watch · Trace · Return to Draft`.
- Ghi nhận chính thức: `SIMULATE`/`LIVE` là **mode switch** ở
  `ProgramsModeSwitcher`, không nhân bản thành nút toolbar.
- Nút không dùng được phải nêu lý do đọc được, cấm ẩn im lặng (luật `MODE-01`).
- **Tab đa POU — `UD-PROG-014` CLOSED 2026-08-27, phương án B.** Tab bắc qua cả
  ST lẫn FBD trong cùng workspace (ảnh FBD hiện `AHU_Main.FBD (FBD)` cạnh
  `AHU_Main.Main (ST)`). `objectId` là trục định danh của tab, **không** phải tên
  POU; hai tab không bao giờ chia chung buffer soạn thảo. Năm câu hỏi hành vi mà
  handoff v2.2 chưa trả lời (số tab tối đa; đóng tab bẩn; đổi mode áp cho toàn
  workspace; sống qua reload; tab trỏ POU đã xoá) phải được chốt **trong**
  `TC-PGM02-TAB-01`, không để mỗi người một kiểu.
- **Status bar** — trong phạm vi từ DDD 0.5 (đảo ngược bản 0.4). ST:
  `Ln, Col · INS · LF · UTF-8 · dirty`. FBD: `Ready · Ln, Col · zoom% · FBD ·
  trạng thái kết nối`. Giá trị chưa đọc được hiện `—`; **cấm** mặc định
  `UTF-8`/`LF` cho có.
- **Code Map cho ST** — tái dùng ngưỡng và luật của minimap FBD (`AC-FBD-012`).
  Điều hướng chỉ đổi khung nhìn, không đổi một byte nào của tài liệu.

**Files affected**

- FE `design/editor/ProgramsTab.tsx`, `design/ProgramsModeSwitcher.tsx`,
  `design/workbench/ProgrammingWorkbench.tsx`, `design/ProgramsWorkspaceRoute.tsx`.

**Dependencies:** `T59-819` (Compare) cho nút Compare; `T59-815` cho thanh
SIMULATE. `UD-PROG-014` đã CLOSED nên phần tab không còn bị chặn.
**Xung đột file:** WP-14 (`T59-818`) và WP-15 cùng chạm `ProgramsTab.tsx` — hai
làn phải nối tiếp, hoặc tách `ProgramInspector` ra file riêng trước khi cả hai
bắt đầu.

**Acceptance criteria**

- Mỗi mode hiện đúng tập nút của mode đó; không rò nút của mode khác.
- Viewer/operator không kích hoạt được bất kỳ nút mutation nào, kiểm ở cả UI lẫn
  API.
- Mọi nút disabled có lý do hiển thị.
- Không tăng số lần render của editor khi đổi mode.

**Tests/verification**

- `TC-PGM02-TB-01` toolbar, `TC-PGM02-TAB-01` tab, `TC-PGM02-SB-01` status bar,
  `TC-PGM02-NAV-01` navigator map (DDD 0.5 §10.2) + RBAC negative + axe cho
  thanh icon-only.

**Risk:** nút `Check` dựng luồng thứ hai lệch với `useCheckWorkflow`; thanh
toolbar đẩy editor xuống dưới màn hình đầu ở 1280×750.

**Estimated complexity:** `M`

**Exit:** `TC-PGM02-TB-01` PASS; `AC-PGM02-002` được đo trên chính workspace
PGM-02 (thuộc `T59-822`).

## 5. Cross-WP acceptance matrix

| Invariant/AC | WP tạo | WP chứng minh cuối |
|---|---|---|
| Một route, một POU tree | 01/02 | 12 |
| Save Draft không đổi Active | KEEP + 01/04/05 | 12 |
| FBD domain/port order không hồi quy | 05 | 10/12 |
| Quick Library one source/one Undo | 03 | 04/05/12 |
| LIVE Active source/read-only/coherent values | 09 | 12 |
| Compare saved Draft Revision↔Active typed ST/FBD diff | 09 | 12 |
| Inspector đúng năm ngữ cảnh, không đoán signature | 14 | 12 |
| Toolbar đúng tập nút theo mode, không rò mutation | 15 | 12 |
| Tab theo `objectId`, không chia chung buffer | 15 | 12 |
| Status bar không bịa encoding/EOL, dirty khớp buffer | 15 | 12 |
| Trace concurrency/revision truth | 09 | 12 |
| SIMULATE saved snapshot/no physical output | 07 | 08/12 |
| Missing/invalid/stale không thành 0 | 06/08/09 | 12 |
| Runtime update không rerender toàn canvas | 10 | 12 |
| <768 read-only + keyboard/a11y | 11 | 12 |
| Authority/trace/risk/release truth | 00/13 | 13 |

## 6. Rollback strategy

- FE shell/editor/canvas đi dưới feature flags riêng `programsWorkspaceV2`,
  `programsLiveV2`, `programsSimulation`; rollback route giữ legacy deep links.
- Draft/Revision schema changes phải additive/forward-readable; geometry có
  schema version và legacy default deterministic.
- BE migrations có backup/restore và older-binary compatibility decision; không
  rollback binary mà bỏ DB schema mới không đọc được.
- Simulation worker/session không có quyền đổi Active nên rollback chỉ stop/
  expire sessions và gỡ capability.
- Core LIVE/Trace corrections phải giữ old IPC compatibility hoặc roll coordinated;
  mismatch trả unavailable, không ghép best-effort.
- Không xóa legacy tree/editor/card renderer trước khi candidate mới qua parity;
  sau xóa vẫn có Git/PR rollback và data format tương thích.

## 7. Definition of Done tổng

Plan chỉ được coi triển khai xong khi:

1. Source hiện hành và authority docs cùng mô tả một route/một POU/mode semantics.
2. ST/FBD EDIT hoạt động qua Draft/ETag/read-back; FBD là true canvas nhưng domain
   canonical/port order/compiler equivalence được giữ.
3. Quick Library/PGM-04 cùng catalog; missing block không bị quảng cáo supported.
4. LIVE tải sealed Active source, read-only, coherent value tuple; trace P0/BE truth
   defects đóng bằng concurrency/fault/restart evidence.
5. SIMULATE dùng real isolated worker, saved snapshot, virtual input/time; zero
   physical output được chứng minh đúng lớp evidence.
6. Workbench/search/reference/diagnostics jump đúng ST/FBD identity; stale source
   bị hủy khi đổi mode.
7. Performance/responsive/a11y/RBAC/negative cases đạt số đo đã khóa.
8. Full affected gates, target/HIL applicable, rollback và controlled docs PASS.
9. Plan59, changelog, trace/risk/VVP/evidence cập nhật; không còn công việc chưa
   làm mà không có blocker thật.
10. Chỉ Product/QA/Release authority mới được đổi `RELEASE_READY`.

## 8. Owner + Architect authorization record

Ngày 2026-08-24, Owner + System Architect đã duyệt cả ba điều ở review §15 và
ban hành `AUTH-PROG-2026-08-24-05`:

- exact-pin Candidate `413a043748dce3b44d2c5076412de761760ba17a` sau WP-00;
- packaging `R1 EDIT -> R2 LIVE -> R3 SIMULATE` với gate độc lập.
- Simulation v1 dùng **admin-only controls** đúng khuyến nghị; viewer/operator chỉ
  đọc session/snapshot, không được create/run/pause/step/reset/stop/set input.

WP-00/T59-801 đã DONE; `PLAN_READY=PASS`, ba `IMPLEMENT_READY=GO`. Plan59 vẫn
bắt buộc dependency; `T59-810..812` đã DONE và `T59-813` READY. Waiver review
discipline chỉ mở implementation, không chứng minh M4/M5, target/HIL hoặc release.

**OWNER + ARCHITECT APPROVED — EXACT CANDIDATE `413a043`; T59-813 READY**

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.20 | 2026-08-27 | `WP-14` DONE ở lớp HOST/LOCAL: Inspector năm ngữ cảnh dùng chung ST↔FBD, thu gọn khi rỗng đúng luật handoff §9. Ba trường của `UD-PROG-015` không tồn tại trong kiểu dữ liệu, không chỉ là không render. |
| 1.19 | 2026-08-27 | `WP-08` DONE ở lớp HOST/LOCAL. Dựng UI lên hạ tầng `WP-07` làm lộ hai lỗi của chính nó: `RUN` không chạy tick nào, và worker không tin khoá thiết bị nên mọi phiên hỏng trên bo thật. Cả hai đã sửa trong cùng lát. |
| 1.16 | 2026-08-27 | Đóng `WP-10`/`WP-11` ở phạm vi R2 qua `T59-812`: subscription/10 Hz/no-overlap/cleanup, topology FBD tách sample, khóa mutation toàn LIVE, responsive/axe bốn viewport và budget gate R2. Sửa luôn dòng WP-06 thừa cột; `T59-813` chuyển READY. |
| 1.15 | 2026-08-27 | Đóng `WP-06` ở phạm vi R2 (LIVE read-only đủ ST + FBD + Watch); `T59-812` chuyển READY. |
| 1.14 | 2026-08-26 | Đóng `WP-09`/`T59-810` (dấu producer + Trace pin); `T59-811` (LIVE FE) chuyển READY. |
| 1.17 | 2026-08-27 | `WP-07` DONE ở lớp HOST/LOCAL: worker mô phỏng cách ly, supervisor, API R3 và tám mã `PRG-SIM-*`. `G-PGM02-04 SIM_SAFE` đạt phần host; phần zero-physical-output trên target vẫn là kế hoạch, không phải PASS. `WP-08`/`T59-815` mở. |
| 1.14 | 2026-08-27 | Đóng `WP-12`/`WP-13` ở phạm vi R2 kèm record closeout R2; increment R2 đóng và `WP-07`/`T59-814` mở R3. Lát này bổ sung lane browser target và sửa bốn finding do chính lane đó lộ ra. |
| 1.13 | 2026-08-26 | Đóng `WP-12`/`WP-13` ở phạm vi R1 kèm record closeout; increment R1 đóng và `WP-09`/`T59-810` mở R2. |
| 1.12 | 2026-08-26 | Đóng `WP-10`/`WP-11` ở phạm vi R1 (cổng ngân sách, bốn khổ màn, focus/bàn phím, RBAC negative, hostile source); `WP-12`/`WP-13` (`T59-809`) chuyển READY. |
| 1.11 | 2026-08-26 | Đóng `WP-06` ở phạm vi R1 cùng phần `WP-01` còn nợ (grid slot, context strip theo mode, state machine + dirty guard); `WP-10`/`WP-11` (`T59-808`) chuyển READY. |
| 1.10 | 2026-08-26 | Cổng editor ST CLOSED bằng lựa chọn A (`UD-PROG-013`); `WP-04`/`T59-805` đóng ở phạm vi R1 và `WP-06`/`T59-807` chuyển READY. |
| 1.9 | 2026-08-26 | Đóng `WP-05` ở phạm vi R1 sau khi bổ sung quét axe thẳng vào canvas FBD (bộ quét cũ chỉ chạy trên workspace ST). |
| 1.8 | 2026-08-26 | Ghi ba lát của `WP-05`: hợp đồng hình học, canvas SVG node–edge (không thêm thư viện — spike gate đỏ theo ngân sách), khay Vấn đề + minimap. Mọi AC áp dụng cho R1 đã có test. |
| 1.7 | 2026-08-26 | Ghi ba lát tiếp theo của `WP-04`: chèn FB có trạng thái đặt khai báo đúng vùng (`AC-ST-002/003`), chỉ mục tham chiếu + F12 tới khai báo (`AC-ST-005`), và khoá `AC-ST-004/010` bằng nguồn ngoài subset. Mọi AC áp dụng cho R1 đã có test; còn hai mục chưa giao là surface editor (chờ cổng) và chỉ mục ký hiệu do compiler sinh. |
| 1.6 | 2026-08-26 | Đồng bộ header với §0: `WP-03` đã đóng nên `WP-04`/`T59-805` là `IN PROGRESS`, không còn `READY`; sửa dòng Execution authority và đoạn alias vẫn trỏ `T59-804`. |
| 1.5 | 2026-08-26 | Thêm §0 roadmap cập nhật theo từng lát; đóng `WP-01` (một phần scope), `WP-02` và `WP-03`; ghi cổng phụ thuộc/license của `WP-04`. |
| 1.4 | 2026-08-24 | Ghi `AUTH-PROG-2026-08-24-05`: exact pin Candidate `413a043`, hoàn tất WP-00/T59-801, mở ba increment theo thứ tự bắt buộc và chuyển T59-802 READY; release vẫn NO-GO. |
| 1.3 | 2026-08-24 | Đồng bộ output WP-00: gói Candidate đã được tạo và `T59-801` chuyển `REVIEW`; Architect exact pin cùng toàn bộ quyền code downstream vẫn `PENDING/NO-GO` |
| 1.2 | 2026-08-24 | Nối proposal vào `CR-PROG-PGM02-V22-001` và Plan59 `T59-801`, chuẩn hóa namespace `PGM02-V22-WP-*`, ghi rõ Architect `PENDING` và không mở downstream/code production |
| 1.1 | 2026-08-24 | Ghi nhận Owner mở WP-00, khóa thứ tự `R1 EDIT → R2 LIVE → R3 SIMULATE` và Simulation v1 admin-only; giữ code gate đóng tới khi baseline reconciled được Owner + Architect pin |
| 1.0 | 2026-08-24 | Lập 14 WP, dependency/parallel lanes, gates, acceptance/tests/risks/complexity, migration/rollback, project context, Compare, Simulation RBAC/allowlist/multi-task Step và release increments từ review source/host; không triển khai code |
