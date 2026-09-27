# Product Spec Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROD-PROG-001` |
| Phiên bản | 3.3 |
| Trạng thái | **Active; PGM-02 v2.2 TARGET APPROVED FOR IMPLEMENTATION, chưa phải As-Built** |
| Ngày hiệu lực | 2026-08-20 |
| Ngày phê duyệt PGM-02 | 2026-08-24 |
| Chủ quản / phê duyệt baseline | Product Owner/CTO — Phạm Đình Chương |
| Disposition PGM-02 v2.2 | `AUTH-PROG-2026-08-24-05`: Product Owner/CTO + System Architect duyệt exact Candidate `413a043748dce3b44d2c5076412de761760ba17a` cho implementation |
| Quyết định nguồn | `AUTH-PROG-2026-08-20-04` và `AUTH-PROG-2026-08-24-05` trong [Decision Log](../00_governance/DECISIONS.md); [`CR-PROG-PGM02-V22-001`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) |
| Supersedes | Nội dung Programming “Rev A/Rev B” trước đây và candidate `PROGRAMMING_PRODUCT_SPEC_V2.2_HYBRID.md` |
| As-Built tham chiếu | Source/contract tại baseline `49a2ad1`; giới hạn hiện tại không làm giảm phạm vi Product Target |
| Nguồn Target đã pin | [`DDD-SW-PGM02-WORKSPACE-001`](../02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md), [`PGM02-WORKSPACE-V1`](../../contracts/programming/pgm02_workspace_v1.json) và exact Candidate `413a043748dce3b44d2c5076412de761760ba17a` |
| Gate PGM-02 | `T59-801=DONE`; `T59-802=READY`; `T59-803..817=ORDERED` theo dependency; `PLAN_READY[PGM02-V22]=PASS`; `IMPLEMENT_READY[PGM02-R1|PGM02-R2|PGM02-R3]=GO`; thực thi bắt buộc `R1→R2→R3`; `RELEASE_READY=NO-GO` |

## 0. Đọc nhanh

MK-DDC-24 chỉ có **một** sản phẩm Programming. “Rev A/Rev B” không còn là cách
chia phạm vi sản phẩm; các Wave trong Plan 59 chỉ là thứ tự triển khai nội bộ.

Sản phẩm hoàn tất khi kỹ thuật viên có thể:

```text
Tạo Project
  → tạo PROGRAM / FUNCTION / FUNCTION_BLOCK bằng ST hoặc FBD
  → quản lý và dùng Control Library
  → ánh xạ Point cho PROGRAM
  → Check toàn package
  → Commission Revision
  → Enable từng PROGRAM
  → quan sát RUNNING / signal / output / diagnostic
  → Disable, Restore hoặc Rollback an toàn
```

Giới hạn source hiện tại `1 Task / 1 Program`, thiếu user-defined `FUNCTION` /
`FUNCTION_BLOCK`, thiếu Control Library và Published Signal là **As-Built cần
migration**, không phải phạm vi sản phẩm được phép bỏ.

PGM-02 v2.2 dưới đây là **Target đã được phê duyệt cho implementation** theo thứ
tự bắt buộc `R1 EDIT → R2 LIVE → R3 SIMULATE`. `AUTH-PROG-2026-08-24-05` đã
pin exact Candidate `413a043748dce3b44d2c5076412de761760ba17a` và mở quyền
production code cho cả ba increment; task scheduler vẫn phải giữ dependency và
không được dùng quyền đó để suy ra deploy site hoặc release.

## 1. Mục tiêu và đối tượng dùng

### 1.1 Mục tiêu

Một công cụ Programming chạy trên Web cho ứng dụng HVAC/BACS, đủ để xây dựng,
đưa vào vận hành, chẩn đoán và phục hồi nhiều ứng dụng điều khiển độc lập trên
một controller mà không cần desktop IDE riêng.

### 1.2 Actor

| Actor | Kết quả cần đạt |
|---|---|
| Kỹ sư điều khiển | Tạo logic ST/FBD, Function/FB, library, mapping, Check và Commission. |
| Kỹ thuật viên BMS | Enable/Disable, quan sát trạng thái, diagnostic và khôi phục theo quyền. |
| Quản trị viên | Quản lý quyền, import/export, library, Revision, RETAIN và audit. |
| QA/Ops | Tái lập build, kiểm target/HIL, deploy, backup, rollback và thu evidence. |

## 2. Mô hình sản phẩm chuẩn

| Khái niệm | Định nghĩa quy phạm |
|---|---|
| Project | Container chứa nhiều Program, Function, Function Block, library reference, Point Binding và lịch sử Revision. |
| Program | Ứng dụng điều khiển độc lập; sở hữu cycle, lifecycle, Point Mapping, private state, RETAIN và Output Candidate. |
| Function | POU thuần, không state/instance/cycle/RETAIN/Point Mapping và không có side effect I/O. |
| Function Block | POU có private state theo từng instance; không có cycle/lifecycle/Point Mapping riêng và chỉ chạy khi Program gọi. |
| Control Library | Kho versioned gồm standard Function/FB chỉ đọc và user Function/FB do Project quản lý. |
| Point | Ranh giới dữ liệu canonical `LOCAL`, `VP` hoặc `MB_RTU`; Variable không mặc nhiên là Point. |
| Published Signal | Kênh typed, single-publisher, multi-consumer trong runtime; consumer chỉ đọc snapshot đã commit và freshness. Không phải một Point type thứ tư. |
| Revision | Snapshot bất biến của package Project dùng cho Check, Commission, audit và rollback. |
| Commission | Đưa một Revision đã Check vào runtime tại safe boundary; không tự Enable Program mới. |
| Enable intent | Ý định bền vững cho phép một Program được scheduler phát hành; khác với trạng thái `RUNNING`. |
| Disable | Rút Program khỏi scheduler tại safe boundary và rút Output Candidate của Program. |
| Output Candidate | Giá trị đề xuất có owner, priority/freshness/TTL; phải đi qua arbitration, interlock và safe-state trước I/O. |
| LKG | Revision hoạt động cuối cùng đã qua first-cycle/read-back và đủ điều kiện khôi phục. |

## 3. Phạm vi chức năng bắt buộc

### 3.1 Ngôn ngữ và POU

- ST và structured FBD dùng chung type system, symbol table, library registry,
  typed IR, artifact, runtime semantics và diagnostic model.
- POU bắt buộc: `PROGRAM`, `FUNCTION`, `FUNCTION_BLOCK`.
- Type bắt buộc: `BOOL`, `INT`, `DINT`, `UINT`, `REAL`, `TIME`; conversion phải
  tường minh theo registry chuẩn.
- Không hỗ trợ LD/SFC, loop không bounded, dynamic allocation/instance, recursion,
  online change, motion hoặc functional-safety PLC claim.

### 3.2 Product profile bounded

| Giới hạn | Giá trị Product Target |
|---|---:|
| Program trong một Project/Revision | 32 |
| Program có thể Enable trên một controller | 16 |
| Chu kỳ Program | `10`, `50`, `100`, `500`, `1000`, `5000`, `10000`, `50000` ms trên base step 10 ms (ADR-061; trước 2026-09-26 là `1 s`, `5 s`, `30 s`) |
| User Function + Function Block mỗi Project | 256 |
| Instance Function Block trong một Revision | 1024 |
| Published Signal trong một Revision | 512 |
| Point Binding trong một Revision | 512 |
| Source ST mỗi POU | 64 KiB |
| FBD node / connection mỗi POU | 256 / 512 |
| Artifact package | 4 MiB |

Backstop vật lý có thể lớn hơn nhưng không được quảng bá. One-over phải fail bằng
mã ổn định trước Commission.

### 3.3 Control Library

- `SYSTEM` library là read-only, version đi cùng firmware/compiler profile.
- `PROJECT` library chứa user Function/FB và có immutable revision riêng trong
  Project Revision.
- Search/filter theo tên, kind, category, type signature, version và trạng thái
  deprecated.
- Dependency graph phải acyclic; recursion trực tiếp/gián tiếp bị từ chối.
- PID thuộc standard library nhưng chỉ được gắn nhãn **sẵn sàng cho end-user**
  sau Controls/Safety review và evidence saturation/override/release trên target.

### 3.4 Multi-Program và scheduling

- Mỗi Program có cycle, enable intent, runtime state, private memory, RETAIN,
  diagnostic và metrics riêng.
- Program không mặc định chờ Program khác và không có dependency ngầm do thứ tự
  tạo, thứ tự hiển thị hoặc ID.
- Scheduler được phép chạy tuần tự trên target một nhân hoặc song song trên target
  nhiều nhân, nhưng semantics và deadline phải độc lập với creation order.
- Lỗi/Disable một Program không mặc định dừng Program độc lập khác.
- Xung đột hai Program ghi cùng physical output bị Check từ chối, trừ khi một
  arbitration contract tường minh được phê duyệt; profile hiện tại chọn
  **single Program owner cho mỗi output binding**.

### 3.5 Published Signal

- Một signal có đúng một publisher, type, unit, producer Program, sequence,
  timestamp, freshness limit và quality.
- Consumer mặc định đọc **latest completed publish snapshot**; không có read
  writable memory của producer và không có same-cycle dependency ngầm.
- Khi missing/stale/bad, consumer policy phải là `USE_FALLBACK`, `HOLD_PRIVATE`
  hoặc `BLOCK_PROGRAM`; policy bắt buộc explicit trong source/model.
- Signal không đi thẳng ra I/O; chỉ Program output mới tạo Output Candidate.

### 3.6 Point Mapping và output safety

- PROGRAM được bind Variable interface tới `LOCAL`, `VP`, `MB_RTU` sau khi kiểm
  type/direction/writable/unit/quality/freshness.
- FUNCTION và FUNCTION_BLOCK không có Point Mapping trực tiếp.
- Mọi output đi theo chuỗi duy nhất:

```text
Program → Output Candidate → Ownership → Priority Arbitration
        → Interlock → Safe-State → OutputWriter → iobus/IOP → MCU/I/O
```

- Disable rút toàn bộ Output Candidate của Program tại safe boundary; resolver
  chọn owner/priority/default/safe-state còn hợp lệ. Không giữ output ngầm.
- Web/BE mất không được dừng Program đang chạy; Web/HMI không được bypass Core.

## 4. Vòng đời và trạng thái

### 4.1 Engineering state

```text
DRAFT → CHECKING → CHECK_FAILED | READY → COMMISSIONING
      → ACTIVE | FAILED | UNKNOWN→RECONCILING
```

Save/Check không đổi Active. Commission chỉ nhận immutable Revision `READY`, có
idempotency, preflight, stage, safe-boundary activation, first-cycle, read-back,
journal và LKG. Timeout không được optimistic success.

### 4.2 Runtime Program state

```text
DISABLED → STARTING → RUNNING ↔ WAITING
    ↑          │          │       │
    └─STOPPING←┴──────────┴───────┘
               └────────→ FAULTED
```

- Enable ghi desired intent; chỉ báo `RUNNING` sau authoritative cycle/read-back.
- Disable áp tại controlled boundary, audit và rút candidate.
- Restart phục hồi Commissioned Revision, enable intent và RETAIN theo ba policy
  độc lập; không suy `RUNNING` chỉ vì intent trước reboot là Enabled.
- Atomic package activation giữ enable intent của Program đã tồn tại; Program mới
  mặc định `DISABLED`, trừ khi người vận hành đã lưu intent Enable cho nó trước
  khi kích hoạt (ADR-062: intent đã lưu đi cùng ACTIVATE, trong trần 16 Enabled).

## 5. Information Architecture

Sáu workspace sản phẩm:

| ID | Workspace | Trách nhiệm |
|---|---|---|
| `PGM-01` | Tổng quan | Project, Draft/Check/Active, sức khỏe Core và việc cần xử lý. |
| `PGM-02` | Chương trình | Cây PROGRAM/FUNCTION/FUNCTION_BLOCK, editor ST/FBD, properties và dependency. |
| `PGM-03` | Điểm & Ánh xạ | Point Catalog, binding, quality, conflict và output ownership. |
| `PGM-04` | Thư viện điều khiển | Standard/user library, search, signature, version và usage. |
| `PGM-05` | Kiểm tra & Đưa vào vận hành | Check, impact, Commission, progress, reconciliation và rollback. |
| `PGM-06` | Runtime & Bảo trì | Enable/Disable, monitor, signal, trace, Revision/LKG, RETAIN và audit. |

Mobile hỗ trợ đọc trạng thái, Enable/Disable và incident action có xác nhận;
authoring ST/FBD đầy đủ ưu tiên desktop/tablet. Mọi state loading/empty/error/
permission/stale/offline/unknown phải có copy và không chỉ dùng màu.

Target Candidate PGM-02 v2.2 hợp nhất ST/FBD thành một workspace theo mode:
`EDIT` chỉ sửa Saved Draft, `LIVE` chỉ đọc immutable Active Revision và
`SIMULATE` chạy immutable Saved-Draft snapshot trong worker cách ly. Route,
identity, capability và failure state phải theo contract Candidate; khi chưa
được pin hoặc chưa hỗ trợ, UI phải fail closed thay vì suy diễn fallback.

## 6. Product Capability và Requirement

| ID | Capability / requirement bắt buộc |
|---|---|
| `PC-PROG-001` | Quản lý Project nhiều Program và immutable Revision có truy nguyên. |
| `PC-PROG-002` | Authoring ST/FBD cho PROGRAM, FUNCTION và FUNCTION_BLOCK. |
| `PC-PROG-003` | Quản lý Control Library chuẩn và user-defined có version. |
| `PC-PROG-004` | Point Mapping `LOCAL/VP/MB_RTU` với validation đầy đủ. |
| `PC-PROG-005` | Check toàn package, diagnostic chính xác và resource bound. |
| `PC-PROG-006` | Commission atomic, read-back, LKG, Restore và rollback. |
| `PC-PROG-007` | Enable/Disable và runtime state độc lập từng Program. |
| `PC-PROG-008` | Multi-Program scheduling không phụ thuộc creation order. |
| `PC-PROG-009` | Published Signal typed/fresh giữa Program. |
| `PC-PROG-010` | Output Candidate/ownership/arbitration/interlock/safe-state tới I/O. |
| `PC-PROG-011` | RETAIN theo Program/FB instance, restart và integrity rõ. |
| `PC-PROG-012` | Monitor/trace/diagnostic/revision/audit có authority và freshness. |
| `PC-PROG-013` | PGM-02 ST/FBD workspace theo ba increment độc lập `R1 EDIT → R2 LIVE → R3 SIMULATE`, có route/identity/capability rõ và không có đường tắt tới physical output. |

| ID | Product Requirement |
|---|---|
| `PR-PROG-001` | Project phải chứa nhiều Program/POU và giữ truy nguyên qua Revision. |
| `PR-PROG-002` | ST và FBD phải dùng chung semantics cho PROGRAM/FUNCTION/FUNCTION_BLOCK. |
| `PR-PROG-003` | FUNCTION phải thuần; FUNCTION_BLOCK phải có state riêng từng instance; cả hai không tự sở hữu cycle/Point Mapping. |
| `PR-PROG-004` | Control Library phải versioned, tìm kiếm được và khóa dependency/compatibility. |
| `PR-PROG-005` | Chỉ PROGRAM sở hữu cycle, lifecycle, mapping, RETAIN và Output Candidate. |
| `PR-PROG-006` | Hỗ trợ tối đa 16 Program Enabled và không tạo dependency ngầm theo thứ tự. |
| `PR-PROG-007` | Published Signal phải single-publisher, typed, snapshot/freshness rõ và không shared writable memory. |
| `PR-PROG-008` | Binding `LOCAL/VP/MB_RTU` phải kiểm type/direction/writable/unit/quality và conflict output. |
| `PR-PROG-009` | Check lỗi không được Commission; Check không đổi runtime đang chạy. |
| `PR-PROG-010` | Commission/Restore phải atomic, authoritative, idempotent và giữ LKG khi lỗi. |
| `PR-PROG-011` | Enable/Disable phải là mutation riêng có RBAC/audit/read-back; Commission không tự Enable Program mới. |
| `PR-PROG-012` | Disable phải rút candidate tại safe boundary và không mặc định dừng Program độc lập. |
| `PR-PROG-013` | Mọi output phải qua Core ownership/arbitration/interlock/safe-state; không direct I/O. |
| `PR-PROG-014` | RETAIN phải có stable owner/layout/version/integrity và cold-init có diagnostic khi không tương thích. |
| `PR-PROG-015` | Monitor phải tách desired intent/runtime state/program value/actual value/owner/priority/quality/freshness. |
| `PR-PROG-016` | Web/BE/HMI mất không được dừng local control khi Core/iobus/MCU healthy. |
| `PR-PROG-017` | Mọi mutation phải server-side RBAC, idempotency/concurrency phù hợp và audit. |
| `PR-PROG-018` | Package/import/export phải source-only, versioned, chống input độc hại và không tự Commission. |
| `PR-PROG-019` | Scheduler/watchdog/WCET/resource phải bounded và đo được trên target. |
| `PR-PROG-020` | Sản phẩm phải có sáu workspace PGM-01..06 và progressive disclosure. |
| `PR-PROG-021` | PID chỉ được quảng bá end-user-ready sau Controls/Safety evidence. |
| `PR-PROG-022` | Graph và Programming phải có ownership loại trừ; dual output owner fail closed. |
| `PR-PROG-023` | Release phải có target/HIL physical-output, power/restart, rollback và provenance evidence. |
| `PR-PROG-024` | Không được claim IEC 61131-3 certification, safety PLC hoặc release readiness khi chưa có authority/evidence. |
| `PR-PROG-025` | PGM-02 phải có route canonical `/eng/programming/programs`, resolver Project/deep-link fail-closed, ba mode `EDIT/LIVE/SIMULATE` và identity tách `objectId`, `programId`, document tuple, value tuple. |
| `PR-PROG-026` | R1 EDIT phải sửa Saved Draft bằng contract typed/ETag/read-back; Quick Library phải dùng signature SYSTEM/PROJECT authoritative; insert/refactor/reference/diagnostic phải atomic, chính xác và zero mutation khi phân tích lỗi. Draft được chứa PROGRAM POU chưa xếp lịch, nhưng Check/Package phải fail closed bằng `PRG-ERR-CHECK-001` + `ST-POU-005`; cấm tự loại POU hoặc tự sinh chu kỳ `1000 ms`. |
| `PR-PROG-027` | R2 LIVE phải luôn read-only, lấy source từ immutable Active Revision rồi chỉ ghép value khi revision/artifact/observation tuple coherent; mismatch, stale, offline hoặc thiếu dữ liệu phải fail closed và không thành zero. |
| `PR-PROG-028` | R3 SIMULATE phải chạy immutable Saved-Draft snapshot trong worker ephemeral tách khỏi Core/Web production, không có production SHM/device/socket/output writer/RETAIN handle và không có physical output authority. |
| `PR-PROG-029` | Simulation v1 phải cho viewer/operator/admin đọc theo object scope nhưng chỉ admin được mutation có audit; virtual time/`STEP_CYCLE` phải deterministic và virtual input chỉ nhận allowlist typed/unit/range từ artifact manifest. |
| `PR-PROG-030` | Mỗi increment PGM-02 phải có capability/feature flag/rollback và budget định lượng riêng cho responsive, accessibility, latency, memory, quota, timeout, expiry; hoàn tất increment trước không được làm increment sau hiện available. |

## 7. Tiêu chí nghiệm thu sản phẩm

1. Fixture chuẩn có 10 Program Enabled, tối thiểu 3 chu kỳ khác nhau, 4 Published
   Signal, 2 Program có RETAIN và 1 Program fault injection; Program độc lập giữ
   deadline và không bị dừng ngoài dependency policy.
2. Cùng một Function/FB chạy bằng ST và FBD cho kết quả/type/state trace tương
   đương; recursion và side effect trái phép bị từ chối.
3. Commission Revision nhiều Program là atomic; Program mới Disabled (trừ Program
   có intent Enable đã lưu, ADR-062), Program cũ giữ enable intent; rollback khôi phục LKG.
4. Disable rút output candidate; đo physical AO/DO/DO và read-back chứng minh
   resolver/interlock/safe-state đúng.
5. Mất Web/BE, reboot Core, corrupt RETAIN, timeout Commission và power-cut đều có
   state/recovery rõ, không optimistic success hoặc silent stale.
6. Direct API negative chứng minh RBAC/audit/idempotency; UI desktop/mobile chứng
   minh state, permission, stale/offline và accessibility.
7. Không mở `RELEASE_READY` nếu chưa có Test Result target/HIL, physical I/O,
   rollback, soak và provenance theo Verification Plan.

### 7.1 Tiêu chí Target Candidate PGM-02 v2.2

1. `R1 EDIT`: route resolver đúng 0/1/nhiều/invalid Project; typed Draft v1/v2,
   Quick Library signature, semantic rename/delete/reference và diagnostic
   SOURCE/FBD/POU/GLOBAL có read-back; mọi lỗi concurrency/analysis zero mutation.
   PROGRAM POU chưa xếp lịch vẫn lưu được trong Draft, nhưng Check/Package phải
   trả `PRG-ERR-CHECK-001` với detail `ST-POU-005`, không loại im lặng và không
   tự tạo chu kỳ `1000 ms`.
2. `R2 LIVE`: source/value tuple khớp đúng Active Revision và artifact; cutover,
   sequence gap, stale/offline/missing làm clear/rejoin hoặc `UNAVAILABLE`; workspace
   không có mutation action ở mọi role.
3. `R3 SIMULATE`: viewer/operator mutation bị server từ chối, admin action được
   audit; cùng snapshot/input cho output hash deterministic; quota/expiry/crash
   cleanup; Test Result target/HIL chứng minh Active/LKG và physical AO/DO/relay
   không đổi trong toàn bộ create/run/step/input/reset/stop/fault path.

Ba tiêu chí này hiện **chưa chạy** và không phải evidence. Quyền implementation
đã được mở bằng `AUTH-PROG-2026-08-24-05`; chỉ được đổi trạng thái nghiệm thu
sau khi có Test Result đúng increment và đúng lớp bằng chứng.

## 8. Ranh giới release

Document/contract/host test cho phép implement và merge nhưng không phải release
evidence. Product chỉ được gọi là release khi [Plan 59](../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md)
đóng toàn bộ task bắt buộc và [Verification Plan](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md)
có verdict có thẩm quyền. CI billing, credential hoặc hardware thiếu không được
biến thành lý do chặn code; chúng vẫn là điều kiện thật của `RELEASE_READY`.

Với PGM-02 v2.2, `PLAN_READY` và ba `IMPLEMENT_READY` đã mở theo
`AUTH-PROG-2026-08-24-05`, nhưng execution order vẫn là `R1→R2→R3`. Chỉ thị này
không biến document/contract/host test thành target/HIL/Test Result hoặc quyền
release.

## 9. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| A | 2026-08-03 | Product Spec hẹp theo profile một Program; nay superseded. |
| 2.2 candidate | 2026-08-14 | Candidate Program-centric; nội dung phù hợp đã hợp nhất, file candidate được loại. |
| 3.0 | 2026-08-20 | Owner chốt một Product Programming thống nhất; thêm multi-Program, FUNCTION/FUNCTION_BLOCK, Control Library, Published Signal, Enable/Disable và sáu workspace; bỏ phân chia Rev A/Rev B. |
| 3.1-candidate | 2026-08-24 | Thêm `PC-PROG-013`, `PR-PROG-025..030` cho Target Candidate PGM-02 v2.2 theo R1 EDIT → R2 LIVE → R3 SIMULATE; ghi Owner approved WP-00 only, Architect exact revision/hash pin PENDING và code/release NO-GO; baseline 3.0 giữ nguyên hiệu lực. |
| 3.2 | 2026-08-24 | Ghi `AUTH-PROG-2026-08-24-05` pin exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`, mở `PLAN_READY` và ba `IMPLEMENT_READY` nhưng giữ thứ tự R1→R2→R3 cùng `RELEASE_READY=NO-GO`; chốt PROGRAM POU chưa xếp lịch chỉ hợp lệ trong Draft, Check/Package fail closed `PRG-ERR-CHECK-001` + `ST-POU-005`. |
| 3.3 | 2026-09-27 | Đồng bộ hai quyết định đã Accepted mà bản 3.2 chưa phản ánh (lộ ra ở cổng `candidate-pin` khi tổng hợp release `DDC24-RELEASE-RECORD-2026-09-27`): **ADR-061** — chu kỳ Program thành tập {10, 50, 100, 500, 1000, 5000, 10000, 50000} ms trên base step 10 ms, Product Owner/CTO chốt 2026-09-26, thay `1/5/30 s`; **ADR-062** — Program mới có intent Enable đã lưu được bật ngay tại boundary kích hoạt, Program mới không có intent vẫn Disabled (T59-305 không bị supersede). Không đổi trần 32/16, scope, maturity hay trạng thái nghiệm thu nào. |
