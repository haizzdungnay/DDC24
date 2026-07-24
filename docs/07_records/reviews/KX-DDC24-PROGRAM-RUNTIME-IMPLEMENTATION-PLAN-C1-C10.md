# Implementation Plan C1–C10 — Mekong Program Runtime (ST + FBD)

**Document ID:** KX-DDC24-PROGRAM-RUNTIME-IMPLPLAN-001
**Trạng thái:** Partially opened — CTO approved FW SOM ST host execution slice
(2026-07-24), slice đã có evidence thật (PR #54, #55); FE/Web Backend/STM32/HIL/FBD đầy
đủ vẫn blocked cho tới approval riêng; C1–C10 slice detail dưới đây vẫn là KẾ HOẠCH, chưa
mở thật (xem §0.1)
**Ngày tạo:** 2026-07-23
**Chủ quản:** Project Engineering (Phạm Đình Chương — Project Engineering Owner / CTO)
**Nguồn quyết định:** [`ADR-020-mekong-owned-iec-aligned-program-runtime.md`](../../adr/ADR-020-mekong-owned-iec-aligned-program-runtime.md)
**Tài liệu song song:** [`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`](../../02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md),
[`KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md`](KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md)

## 0. Cách đọc tài liệu này

Mỗi slice C1–C10 là một **vertical slice chạy được** (không phải một layer kỹ thuật đơn
lẻ) — cuối mỗi slice phải demo được một hành vi thật, không chỉ "component X đã viết
xong". Named component (`mkddc-program-service`, `mkddc-program-core`, `libmkddc_iec`)
và API path là **placeholder theo `PROGRAM_SOM_FW_DRAFT_DESIGN` §4** cho tới khi `C0.9`
chốt tên chính thức — nếu `C0.9` đổi tên, thay thế nhất quán trong toàn bộ slice dưới đây
trước khi C1 mở.

Mỗi slice có: Mục tiêu chạy được | Component thay đổi | API/schema | Backend task |
Frontend task | Runtime task | Firmware/HIL dependency | Test case | Acceptance
criteria | Demo scenario | Rollback | Definition of Done (DoD).

**Effort/estimate cụ thể cho từng slice là output của `C0.14`, chưa điền ở đây** — bảng
tổng hợp cuối tài liệu chỉ ghi lại dependency giữa các slice.

### 0.1. Lát cắt được mở ngay — FW SOM ST host execution

CTO/Project Engineering Owner phê duyệt ngày 2026-07-24 cho một lát cắt dọc hẹp trong
`services/core`: ST source tối thiểu -> parse/semantic -> typed execution package/IR nội
bộ -> chạy qua SOM runtime substrate hiện có -> snapshot/input quality/output staging/
activation/fault tests. Lát cắt này phải tạo PR **FW SOM only** và không kéo FE/Web
Backend/STM32/HIL vào. Mục tiêu demo bắt buộc: một chương trình ST thật, ví dụ:

```iecst
IF SupplyTemp > Setpoint THEN
    FanEnable := TRUE;
ELSE
    FanEnable := FALSE;
END_IF;
```

Chỉ sau khi lát cắt này có build/CTest evidence mới cập nhật effort/risk cho các phần
C1-C10 còn lại.

**Cập nhật 2026-07-24 — evidence đã có:** PR #54 (`fix(core): complete FW SOM IEC
runtime foundation coverage`) và PR #55 (`feat(core): run minimal ST program on FW SOM
runtime`) đã hoàn thành đúng chương trình demo bắt buộc ở trên — parse thật (không
hard-code), typecheck, atomic activation/rollback, execute cho `SupplyTemp=28,
Setpoint=24 → FanEnable=TRUE` và `SupplyTemp=22, Setpoint=24 → FanEnable=FALSE`, cùng 16
test case (syntax/type/unbound-variable reject, activation-fail giữ package cũ,
NaN/Inf không silent-GOOD, không parse lại trong scan path). `services/` CTest 423/423
pass. Đây là dữ liệu thật đầu tiên cho `C0.14` (effort estimate) — **nhưng chưa có ai
tổng hợp thành effort estimate chính thức**, và **toàn bộ chi tiết C1–C10 bên dưới vẫn
là kế hoạch chưa mở** (`mkddc-program-service`/`mkddc-program-core`/`libmkddc_iec` chưa
tồn tại). Không suy diễn từ 2 PR này rằng C1 đã Go.

---

## C1 — Program project, version, artifact registry

- **Mục tiêu chạy được:** tạo được một Program project rỗng qua API, lưu source revision,
  build ra một artifact rỗng có hash, list được project/revision/artifact — chưa chạy
  logic gì.
- **Component:** `mkddc-program-service` (mới), storage layout theo
  `PROGRAM_SOM_FW_DRAFT_DESIGN` §6.2 (`/data/config/program/projects/...`,
  `/data/config/program/builds/...` — path chính thức theo `C0.9`).
- **API/schema:** `POST /projects`, `GET /projects`, `GET/PUT /projects/{id}/sources`,
  `POST /projects/{id}/builds` (build rỗng, không compile thật — chỉ chứng minh pipeline
  lifecycle), `GET /builds/{id}`. `project.json`, `source-manifest.json`,
  `manifest.json` theo §6.2.
- **Backend task:** project CRUD, optimistic revision, atomic write (`fsync`+rename),
  artifact hash, RBAC/audit hook (tái dùng `mkddc-web` auth theo `C0.11`).
- **Frontend task:** không bắt buộc ở C1 (có thể dùng CLI/curl để demo); nếu làm, chỉ
  cần list project — chưa cần editor.
- **Runtime task:** không (C1 không đụng `mkddc-program-core`).
- **Firmware/HIL dependency:** none.
- **Test case:** tạo/đọc/ghi project với optimistic-lock conflict; build hai lần cùng
  input cho cùng hash; power-loss-simulation giữa write (kill process giữa fsync) không
  làm hỏng revision đã commit trước đó.
- **Acceptance criteria:** SWR-REQ-IEC-009 (RBAC/audit) pass cho project/build ops; không
  request field nào đưa thẳng vào shell command.
- **Demo scenario:** tạo project → ghi source rỗng → build → nhận artifact hash → list
  builds hiện đúng 1 dòng.
- **Rollback:** xoá/deactivate project là soft, không xoá revision lịch sử.
- **DoD:** unit/integration test pass; TechLead review; audit log có actor/project/hash
  cho mọi mutation.

---

## C2 — Typed variables, tag binding và I/O image

- **Mục tiêu chạy được:** khai báo được typed variable (theo `C0.3`), bind vào
  `io_map.json` (theo `PROGRAM_SOM_FW_DRAFT_DESIGN` §8), đọc được một I/O snapshot giả
  lập (chưa cần `mkddc-iobus` thật, có thể mock).
- **Component:** `libmkddc_iec` (type system runtime), `mkddc-program-service` (io_map
  CRUD).
- **API/schema:** `io_map.json` bind located/symbolic variable → point contract (type,
  direction, unit, quality) đúng ví dụ §8; `GET/PUT /projects/{id}/io-map`.
- **Backend task:** validate io_map (type/direction/range) trước khi cho phép build tham
  chiếu; reject unbound/mismatched point.
- **Frontend task:** trang I/O Mapping tối thiểu (list/bind), có thể tối giản ở C2, hoàn
  chỉnh hơn ở C5/C7.
- **Runtime task:** input snapshot value+timestamp+quality struct (mock nguồn ở C2, nối
  `mkddc-iobus` thật ở C9).
- **Firmware/HIL dependency:** none ở C2 (mock); thật ở C9.
- **Test case:** NaN/infinity/out-of-range/unbound point bị reject trước commit (§8 quy
  tắc bắt buộc); quality propagation (bad/stale không tự thành GOOD).
- **Acceptance criteria:** IF-REQ-IEC-001 pass (mapping/round-trip/negative tests).
- **Demo scenario:** khai báo `SupplyTemp: REAL input UI-01` → build reject nếu điểm
  chưa tồn tại → build pass khi điểm hợp lệ → đọc snapshot giả lập ra đúng giá trị+quality.
- **Rollback:** thay đổi io_map là một phần của source revision, rollback theo artifact.
- **DoD:** test pass; review bởi Firmware Lead (vì đụng point contract dùng chung với
  `mkddc-iobus`).

---

## C3 — Task scheduler, deterministic runtime loop

- **Mục tiêu chạy được:** `mkddc-program-core` chạy được một task cyclic rỗng (không có
  Program logic thật) theo đúng chu kỳ cấu hình, đo được cycle time/overrun, có atomic
  activation cho package rỗng.
- **Component:** `mkddc-program-core` (mới, C++17), theo `C0.7` scheduler model.
- **API/schema:** `POST /builds/{id}/activate`, `GET /runtime/status` (active hash,
  tasks, cycle/overrun/fault/retain state) theo §6.1.
- **Backend task:** activation request routing tới `mkddc-program-core` (không tự
  activate ở backend).
- **Frontend task:** không bắt buộc.
- **Runtime task:** task scheduler (period/priority/watchdog budget từ manifest), input
  snapshot capture, no-allocation-in-scan, atomic swap tại safe boundary, retain state
  storage (rỗng ở C3), rollback về last-known-good khi activation fail.
- **Firmware/HIL dependency:** none (host-only scheduler timing ở C3; target timing ở
  C9).
- **Test case:** activation fail (giả lập crash) → package cũ tiếp tục chạy; power loss
  simulation giữa activation → phục hồi đúng 1 package đã commit; overrun injection → ghi
  WCET/alarm, không commit output chưa hoàn tất.
- **Acceptance criteria:** SWR-REQ-IEC-006, SWR-REQ-IEC-007 pass (fault injection + host
  timing test).
- **Demo scenario:** activate package rỗng → xem `runtime/status` báo active hash + cycle
  time đo được → kill process giữa lần activate kế tiếp → xác nhận package cũ vẫn active
  sau restart.
- **Rollback:** `POST /activations/{id}/rollback` về package trước.
- **DoD:** fault injection test pass; TechLead review runtime safety behavior.

---

## C4 — ST parser, semantic, IR

- **Mục tiêu chạy được:** compile được một chương trình ST thật (theo grammar `C0.4`)
  thành typed IR (`C0.6`), chạy được trên `mkddc-program-core` (nối C3), cho ra output
  đúng theo logic ST đơn giản (vd cộng hai biến, so sánh, gán output).
- **Component:** `libmkddc_iec` (ST lexer/parser/semantic/IR lowering).
- **API/schema:** IR schema theo `C0.6`; `symbols.json`, `diagnostics.json` theo §6.2.
- **Backend task:** `POST /projects/{id}/validate` (parse+semantic, không sinh artifact),
  gọi compiler CLI với executable/argument cố định, timeout, memory/CPU limit (§6.1 —
  source text không đưa vào shell command).
- **Frontend task:** không bắt buộc (dùng validate API trực tiếp để demo); editor thật ở
  C5.
- **Runtime task:** load IR thật vào `mkddc-program-core` (thay cho package rỗng ở C3).
- **Firmware/HIL dependency:** none.
- **Test case:** ít nhất 10 golden ST program từ `C0.4` (bao gồm invalid syntax/type
  case) pass đúng expected output/diagnostic; hai build cùng input cho cùng artifact hash
  (SWR-REQ-IEC-005).
- **Acceptance criteria:** SWR-REQ-IEC-002, SWR-REQ-IEC-003, SWR-REQ-IEC-004,
  SWR-REQ-IEC-005 pass cho scope ST.
- **Demo scenario:** viết `IF SupplyTemp > Setpoint THEN FanEnable := TRUE; END_IF;` →
  validate → build → activate → thấy `FanEnable` bật đúng khi input mô phỏng vượt
  ngưỡng.
- **Rollback:** artifact reject nếu compile lỗi; package active cũ không đổi.
- **DoD:** golden test suite pass; TechLead semantic review; không dùng bản IEC có
  license bắt buộc cho MVP nội bộ (theo `C0.3`).

---

## C5 — ST Web editor, build, deploy

- **Mục tiêu chạy được:** người dùng thật soạn ST trên Web IDE, bấm Validate/Build/Deploy,
  thấy trạng thái đến từ Backend/Core thật (không phải demo toast).
- **Component:** `src/frontend` (Program IDE mới, thay `ProgrammingPage.tsx` demo hiện
  tại — xem gap `IEC-PROG-001` ở
  [`KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md`](KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md)),
  `mkddc-program-service`.
- **API/schema:** toàn bộ bảng API §6.1 (trừ activation/rollback đã có từ C3).
- **Backend task:** wiring đầy đủ validate→build→activate→status→rollback cho FE.
- **Frontend task:** ST text editor (syntax highlight, diagnostic theo source range),
  UI state machine đầy đủ theo §5.2 (`dirty/syntax_error/semantic_error/build_ready/
  deploy_pending/active/rejected/runtime_fault`), loại bỏ demo/local-only route khỏi
  production (SWR-REQ-IEC-008).
- **Runtime task:** không thay đổi so với C3/C4.
- **Firmware/HIL dependency:** none.
- **Test case:** E2E cho permission denial, build timeout, Core reject, rollback, mất kết
  nối (§5.3); diagnostic map đúng POU/source range.
- **Acceptance criteria:** SWR-REQ-IEC-008 pass; không còn `validateGraphLocal`/
  `deployDemo` trên production route.
- **Demo scenario:** soạn ST có lỗi cú pháp → thấy `syntax_error` với vị trí đúng → sửa →
  `build_ready` → Deploy → `active` với hash hiển thị đúng từ Core.
- **Rollback:** nút Rollback trên UI gọi đúng API C3, không tự suy diễn "deployed".
- **DoD:** E2E suite pass; UX review (màu không là kênh duy nhất, theo §5.3); QAReviewer
  sign-off.

---

## C6 — Standard function/function block library

- **Mục tiêu chạy được:** chương trình ST/FBD gọi được thư viện chuẩn (timer, counter,
  edge detection, arithmetic, comparison) và vendor FB `MKDDC_*` (migrate một phần từ
  28-node graph cũ).
- **Component:** `libmkddc_iec` (standard library registry).
- **API/schema:** không có API mới; ảnh hưởng `symbols.json` (library resolution).
- **Backend task:** version hoá library registry trong manifest.
- **Frontend task:** hiển thị library trong Project tree (`Libraries`, §5.1).
- **Runtime task:** instance state cho Function Block (mỗi instance state riêng, Function
  không giữ state — theo §7.4); EN/ENO nếu áp dụng.
- **Firmware/HIL dependency:** none.
- **Test case:** mỗi function/FB có test normal/boundary/invalid type/overflow/time
  progression/restart/multi-instance isolation (§3.3); vendor FB migrate từ node cũ (vd
  `OnDelay`, `PID`) phải có semantic diff so với node gốc, reviewer approval trước khi
  công bố tương đương.
- **Acceptance criteria:** SWR-REQ-IEC-004 pass cho toàn bộ function/FB trong scope C6.
- **Demo scenario:** dùng `TON` (on-delay timer) chuẩn trong ST, xác nhận thời gian trễ
  đúng qua nhiều chu kỳ scan; dùng vendor `MKDDC_PID` migrate từ node `PID` cũ, so sánh
  output với node gốc trên cùng input.
- **Rollback:** library version pin trong manifest; đổi library không ảnh hưởng artifact
  đã activate.
- **DoD:** golden vector test pass; vendor FB namespace tách biệt rõ standard library
  (§3.3); TechLead review migration semantic diff.

---

## C7 — FBD editor, graph-to-IR

- **Mục tiêu chạy được:** người dùng vẽ được FBD trên canvas Web, typed pin/wire, build
  ra cùng IR schema với ST (C4/C6), chạy trên `mkddc-program-core`, có thể gọi lẫn ST↔FBD
  POU (mixed-language, SWR-REQ-IEC-001).
- **Component:** `src/frontend` (FBD canvas), `libmkddc_iec` (FBD graph → IR lowering
  theo `C0.5`).
- **API/schema:** `pou/*.fbd.json` theo §6.2 (schema chính thức từ `C0.5`/`C0.6`).
- **Backend task:** validate FBD graph schema version trước build.
- **Frontend task:** canvas FBD (typed pin/wire, explicit execution order), canonical
  serialize (vị trí/zoom là presentation metadata, không đổi semantics — §5.1), stable ID
  cho symbol/instance qua copy/paste/reorder.
- **Runtime task:** không thay đổi so với C4 (cùng IR).
- **Firmware/HIL dependency:** none.
- **Test case:** round-trip FBD không đổi semantics; wire nối khác type bị chặn nếu
  không có conversion hợp lệ (§5.3); mixed ST-calls-FBD-POU test.
- **Acceptance criteria:** SWR-REQ-IEC-001 (mixed-language) pass; FBD suite + round-trip +
  source mapping pass.
- **Demo scenario:** vẽ FBD có `AND` + `TON` (từ C6) → build cùng project có POU ST gọi
  FBD POU này → chạy đúng.
- **Rollback:** như C5 (build/activate/rollback chung pipeline).
- **DoD:** FBD round-trip test pass; UX review; không đổi tên component graph 28-node cũ
  thành FBD (§2 nhắc lại) — FBD là artifact mới, graph cũ chỉ là nguồn migration.

---

## C8 — Runtime trace, diagnostics, audit

- **Mục tiêu chạy được:** xem được trace/diagnostic thời gian thực của Program đang chạy
  (task state, POU instance value tối thiểu, fault) và audit log đầy đủ cho toàn bộ vòng
  đời build/deploy/activate/rollback.
- **Component:** `mkddc-program-core` (trace/diagnostic publish), `mkddc-program-service`
  (audit aggregation), `src/frontend` (trace/diagnostic view).
- **API/schema:** mở rộng `GET /runtime/status`; audit log JSONL (theo pattern
  `mkddc-web` hiện có, ADR-016).
- **Backend task:** audit event cho mọi mutation (actor/project/revision/hash/result,
  SWR-REQ-IEC-009).
- **Frontend task:** trace view tối thiểu (không cần debugger đầy đủ ở Rev A.0).
- **Runtime task:** publish diagnostic/retained dirty state **ngoài critical path**
  (§7.3), không impact WCET.
- **Firmware/HIL dependency:** none.
- **Test case:** trace không impact cycle time (đo trước/sau khi bật trace); audit log
  đầy đủ actor/hash cho toàn bộ chuỗi build→activate→rollback.
- **Acceptance criteria:** SWR-REQ-IEC-009 pass; §13.2 evidence record tối thiểu áp dụng
  được cho log thật.
- **Demo scenario:** activate → xem log có actor+hash+timestamp → gây runtime fault giả
  lập → xem `runtime_fault` hiển thị đúng context, không báo healthy (§5.2).
- **Rollback:** không áp dụng riêng (kế thừa C3).
- **DoD:** audit test pass; security reviewer xác nhận không log secret/credential.

---

## C9 — SOM–MCU integration, safe state, HIL

- **Mục tiêu chạy được:** Program Runtime đọc/ghi I/O thật qua `mkddc-iobus`↔STM32 (thay
  mock ở C2), safe-state hoạt động đúng khi mất kết nối MCU >200 ms.
- **Component:** `mkddc-iobus` (nối thật, không đổi ownership — §9.1), `fw/` (STM32 module
  thật theo §9.2: `board`, `iop_comm`, `io_sample`, `ao_do`, `diag_wdg`, `safe_state`).
- **API/schema:** `shared/iop_protocol.h` (không đổi bởi Program Runtime — chỉ tiêu thụ).
- **Backend task:** không đổi (Program Runtime không truy cập UART/SHM trực tiếp — §9.1).
- **Frontend task:** không đổi.
- **Runtime task:** thay input snapshot mock (C2) bằng snapshot thật từ `mkddc-iobus` SHM.
- **Firmware/HIL dependency:** **toàn bộ C9 là firmware/HIL** — đây là slice độc lập,
  không cần C1–C8 xong để bắt đầu (có thể chạy song song từ khi C0 Go), nhưng Program
  Runtime end-to-end (C4/C7) cần C9 xong để chứng minh chạy trên phần cứng thật.
- **Test case:** theo `PROGRAM_SOM_FW_DRAFT_DESIGN` §9.3 (shared CRC/frame vectors,
  `HANDSHAKE_RESP`, `IO_RESP` đúng shared header, invalid command không mutate output,
  UART/ADC/DAC/watchdog fault injection, 200 ms safe timeout đo bằng instrument trên board
  thật).
- **Acceptance criteria:** FW-REQ-MCU-001, FW-REQ-MCU-002 pass; RD-IEC-007 (không release
  chung nếu firmware chưa đạt).
- **Demo scenario:** chạy Program ST/FBD thật điều khiển AO/DO qua board thật; ngắt UART
  → đo AO/DO về safe state trong 200 ms bằng instrument.
- **Rollback:** không áp dụng (đây là target evidence, không phải software rollback).
- **DoD:** target/HIL evidence approved theo `VERIFICATION.md`; không dùng host
  cross-compile thay cho target behavior (§13.2).

---

## C10 — Conformance, soak test, release hardening

- **Mục tiêu chạy được:** hệ thống ST+FBD chạy ổn định qua soak test dài hạn, có
  conformance statement (theo §3.4) cho đúng scope đã công bố, sẵn sàng xét release.
- **Component:** toàn hệ thống (không thêm component mới).
- **API/schema:** `GET /api/v1/.../conformance` (theo §6.1).
- **Backend task:** sinh conformance statement machine-readable+human-readable (§3.4).
- **Frontend task:** hiển thị conformance profile của build active.
- **Runtime task:** soak test dài hạn (đo memory leak, retain wear, overrun tích luỹ).
- **Firmware/HIL dependency:** cần C9 evidence đã có.
- **Test case:** normative feature trace matrix cho scope ST+FBD (không LD/SFC — không có
  dòng "N/A" hiểu nhầm thành thiếu sót); regression đầy đủ C1–C9; soak test ≥ khoảng thời
  gian được QA/HIL Lead định nghĩa ở `C0.12`.
- **Acceptance criteria:** SYS-REQ-IEC-001 pass cho đúng scope; G5 (§14) — không open
  deviation trong claim scope.
- **Demo scenario:** chạy conformance statement generator trên build release candidate →
  không deviation ngoài dự kiến → soak test log đủ thời lượng không có fault.
- **Rollback:** release candidate reject nếu conformance/soak fail; production giữ
  revision trước.
- **DoD:** G5 §14 đóng; nếu theo đuổi PLCopen/certification (RD-IEC-006 — không phải gate
  Rev A.0, xem xét ở revision sau), đây là điểm bắt đầu engagement với lab độc lập.

---

## Bảng phụ thuộc tổng hợp

| Slice | Phụ thuộc | Có thể song song với |
|---|---|---|
| C1 | C0 Go | — |
| C2 | C0 Go, C1 (storage pattern) | C1 (phần lớn độc lập) |
| C3 | C1 (artifact registry) | C2 |
| C4 | C1, C2 | — |
| C5 | C3, C4 | — |
| C6 | C4 | C7 (sau khi cả hai có C4) |
| C7 | C3, C4 | C6 |
| C8 | C5 | C6, C7 |
| C9 | C0 Go only | C1–C8 (độc lập phần mềm Program) |
| C10 | C1–C9 | — |

## Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-23 | Tạo Implementation Plan C1–C10 theo quyết định CTO (ADR-020): mỗi slice có mục tiêu chạy được, component, API/schema, backend/frontend/runtime task, firmware/HIL dependency, test case, acceptance criteria, demo scenario, rollback, DoD. Blocked cho tới khi C0 (`C0.15`) là Go. |
| 1.1 | 2026-07-24 | Ghi nhận evidence từ lát cắt FW SOM ST host execution (§0.1): PR #54 + PR #55 delivered, chương trình demo bắt buộc chạy đúng qua parser/semantic/IR/runtime thật, CTest services 423/423. Dữ liệu thật đầu tiên cho `C0.14` nhưng chưa tổng hợp thành effort estimate. Chi tiết C1–C10 bên dưới KHÔNG đổi — vẫn là kế hoạch, chưa mở. |
