# Detailed Design Programming thống nhất: Multi-Program, POU, Library và Runtime

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDD-SW-PROG-UNIFIED-001` |
| Phiên bản | 1.2-candidate |
| Trạng thái | **Baseline 1.1 Active — IMPLEMENT_READY; PGM-02 v2.2 TARGET CANDIDATE — NO EXECUTION AUTHORITY** |
| Ngày | 2026-08-24 |
| Chủ quản | System/Runtime Architecture |
| Reviewer | Compiler, Core, BE, FE, Controls, Security, Verification |
| Approver | Product Owner/CTO + System Architect theo `AUTH-PROG-2026-08-20-04` |
| Requirement nguồn | Baseline: `PR-PROG-001..024`; Candidate PGM-02: `PR-PROG-025..030`, `SYS-REQ-PROG-116`, `SWR-REQ-PROG-FE-119`, `SWR-REQ-PROG-BE-116..117`, `SWR-REQ-PROG-CORE-117..118`, `NFR-REQ-PROG-112` |
| Supersedes khi xung đột | Các giới hạn thiết kế một Task/một Program và mọi nhãn `TARGET-PENDING` về user Function/FB |
| As-Built baseline | `49a2ad1`; source hiện hành là migration input, không phải Product Target |

## 0. Quyết định đã khóa

Với **baseline 1.1**, không còn Open Decision hoặc TBD kỹ thuật chặn
implementation theo `AUTH-PROG-2026-08-20-04`. Nhận định này không tự động áp
dụng cho PGM-02 v2.2 Candidate: Owner đã khóa phạm vi ba increment và
Simulation v1 admin-only, nhưng System Architect chưa pin exact revision/hash;
do đó `PGM02-R1|R2|R3` vẫn `NO-GO`.

| Chủ đề | Quyết định target |
|---|---|
| Capacity | 32 Program/Revision, tối đa 16 Enabled, 256 user POU, 1024 FB instance, 512 signal, 512 binding. |
| POU | PROGRAM sở hữu cycle/lifecycle/I/O; FUNCTION thuần; FUNCTION_BLOCK có state theo instance. |
| Library | SYSTEM read-only + PROJECT immutable revision; dependency acyclic; registry sinh từ một nguồn. |
| Published Signal | Runtime primitive typed, single publisher, latest-completed snapshot; không phải Point type thứ tư. |
| Output conflict | Một Program owner cho mỗi output binding; xung đột bị Check từ chối. |
| Disable | Rút candidate tại safe boundary; resolver/interlock/safe-state quyết giá trị tiếp theo. |
| Restart | Phục hồi package, enable intent và RETAIN độc lập; `RUNNING` chỉ sau first cycle/read-back. |
| Scheduler | Independent release theo deadline; không có semantic dependency do creation order; multicore là optimization giữ cùng semantics. |
| Trace | Implement ring buffer Core bounded; không giữ `TRACE_START` ma trong contract. |
| PID | Có trong registry nhưng feature label `REVIEW_REQUIRED` tới khi Controls/Safety evidence đạt. |

## 1. Mục tiêu, actor, phạm vi và success criteria

Thiết kế này là handoff đầy đủ từ Product Spec tới code cho các phần giao cắt mà
bộ thiết kế cũ chưa khóa: multi-Program, Function/FB, Control Library, Published
Signal, Enable/Disable và package activation.

In scope: contract, store, compiler/IR/artifact, runtime/scheduler, output path,
RETAIN, FE/UX, migration, security, deploy/rollback và verification. Out of scope:
LD/SFC, dynamic POU, recursion, online change, safety PLC, shared writable memory.

Success: một dev không tham gia thiết kế có thể implement từng task Plan 59 mà
không chọn thêm capacity, owner, state, API, error, algorithm hay migration.

## 2. As-Built và gap có dẫn chứng

| Lớp | As-Built tại baseline | Gap target |
|---|---|---|
| Profile | **Đã đóng bởi `T59-002`**: `contracts/programming/product_profile_v2.json`, generated C++/Go/TS, `kMaxProgramsTotal=32`, `kMaxProgramsEnabled=16`. | Token `profileId`/`profileCode`/`targetAbi` giữ giá trị v1 vì là discriminator nằm trong artifact/FBD/build manifest; rotate cùng artifact v2 ở `T59-006`/`T59-106` theo dual-reader §12.1. |
| Check | `apps/web-api/internal/programming/application/checks.go` từ chối `len(programs) != 1`. | Compile/package graph nhiều POU/Program. |
| Core bootstrap | `apps/core/bootstrap/main.cpp` tạo `program-main`, period 1000 ms. | Nạp topology/artifact v2 và enable intent từ coordinator. |
| Compiler | `apps/core/application/st/` parse PROGRAM; built-in FB có state. | User FUNCTION/FB, symbol graph, shared ST/FBD lowering. |
| FBD | Structured editor + typed compiler cho built-in palette. | Node gọi user POU/library versioned. |
| Runtime enable | `StScheduler::enable/disable` và control handler nội bộ tồn tại. | Product store/API/IPC/audit/read-back. |
| Binding | `st_io_map.cpp` chỉ hỗ trợ LOCAL/VP; cố ý reject MB_RTU. | Adapter MB_RTU qua canonical Point contract. |
| Trace | BE polling monitor; IPC `TRACE_START` chưa xử lý. | Core ring buffer bounded và contract thật. |
| Target evidence | ST Commission output-free đã có supporting evidence. | Multi-Program/FBD/physical-output/HIL chưa có verdict release. |

## 3. Kiến trúc mục tiêu và ownership

```text
Web UI
  │ REST/OpenAPI
  ▼
mkddc-web ── SQLite Project/Library/Revision/Audit
  │ compile worker → mkddc-st-compile → Package Artifact v2
  │ UDS CBOR v2
  ▼
mkddc-core
  ├─ Package Coordinator / LKG / journal / enable-intent store
  ├─ Program Scheduler (due queues + worker lanes)
  ├─ POU Runtime (private state + RETAIN)
  ├─ Published Signal double-buffer snapshot
  ├─ Output Candidate registry
  └─ Priority → Interlock → SafeState → OutputWriter
                                        │ SHM/IOP
                                        ▼
                           mkddc-iobus → STM32 → I/O
```

| State/policy | Owner duy nhất | Consumer |
|---|---|---|
| Project/Draft/Library/Revision/Check/Audit | `mkddc-web` | FE, compiler worker, Ops |
| Package Active/LKG, enable intent, runtime state | `mkddc-core` coordinator | BE read-back, monitor |
| Program private/FB state, signal snapshot, candidates | `mkddc-core` runtime | scheduler, resolver, trace |
| Point actual/quality, fieldbus conversion | Core/iobus theo canonical Point boundary | Program snapshot, monitor |
| Physical actuation và safe timeout 200 ms | STM32 | iobus diagnostics |

FE không quyết quyền/Active; BE không chạy control cycle; compiler không nằm RT
path; Program không direct IOP; iobus/MCU không biết Project/POU.

## 4. Mô hình dữ liệu canonical

### 4.1 Project document v2

| Field | Type / bắt buộc | Rule |
|---|---|---|
| `schemaVersion` | `2`, bắt buộc | Major lạ bị từ chối; migration v1→v2 deterministic. |
| `projectId` | UUID, bắt buộc | Stable qua Revision/import theo policy. |
| `objects` | array 1..1312 | Discriminator `PROGRAM/FUNCTION/FUNCTION_BLOCK`. Name unique case-folded trong Project. |
| `programs` | array 1..32 | Reference object kind PROGRAM; `programId` stable. |
| `library` | object | `systemProfile`, `systemVersion`, `projectLibraryRevisionId`. |
| `signals` | array 0..512 | Signal ID/name/type/unit/publisher/freshness/fallback. |
| `bindings` | array 0..512 | Chỉ variable interface của PROGRAM; output owner unique. |
| `execution` | object | Profile ID, max enabled 16; không expose Task order. |

### 4.2 POU

| Field | Type | Invariant |
|---|---|---|
| `objectId` | UUID | Stable identity và source-map owner. |
| `kind` | enum | `PROGRAM`, `FUNCTION`, `FUNCTION_BLOCK`. |
| `name` | IEC identifier 1..64 | Unique case-insensitive; reserved word bị từ chối. |
| `language` | enum | `ST`, `FBD`. |
| `source` | string hoặc FBD JSON | Đúng một representation canonical. |
| `interface` | typed ports | Direction phù hợp kind; Function có đúng một return. |
| `locals` | typed declarations | FUNCTION không RETAIN/FB instance/stateful call. |
| `dependencies` | UUID[] | Acyclic; resolved đúng library revision. |
| `contentSha256` | hex64 | Tính từ canonical source+interface+dependency. |

### 4.3 Program configuration/runtime

| Field | Type/default | Semantics |
|---|---|---|
| `programId` | UUID | Stable qua Revision nếu cùng logical Program. |
| `periodMs` | `1000/5000/30000` | Release cadence. |
| `budgetUs` | generated | `<=20% period`; user không sửa ở normal UX. |
| `desiredEnabled` | bool, default false cho Program mới | Persisted Core intent, mutation riêng. |
| `runtimeState` | enum | `DISABLED/STARTING/RUNNING/WAITING/STOPPING/FAULTED/UNKNOWN`. |
| `faultPolicy` | enum | `ISOLATE`; dependent consumer theo signal policy. |
| `retainNamespace` | UUID | `{projectId,programId}`; layout hash theo artifact. |
| `lastCycleSeq/time` | uint64/timestamp | Read-only, monotonic. |

### 4.4 Function Block instance

| Field | Type | Rule |
|---|---|---|
| `instanceId` | UUID hoặc stable source path | Không đổi khi source reorder không semantic. |
| `typeId/typeVersion` | UUID/semver | Resolve tới system/project library. |
| `ownerProgramId` | UUID | Mọi state/RETAIN thuộc Program owner. |
| `stateOffset/stateSize` | uint32 | Generated bounded layout; alignment explicit. |
| `retain` | bool | Chỉ field được declaration cho phép; Function luôn false. |

### 4.5 Published Signal

| Field | Type/default/range | Rule |
|---|---|---|
| `signalId` | UUID | Unique Revision; stable qua compatible Revision. |
| `name` | identifier 1..64 | Unique case-folded. |
| `dataType` | Product type | Không implicit conversion. |
| `unit` | string/null | Null nghĩa dimensionless/unspecified, không tự suy. |
| `producerProgramId` | UUID | Đúng một producer. |
| `freshnessMs` | 1000..90000 | Phải >= producer period và <=3×period mặc định. |
| `onInvalid` | enum | `USE_FALLBACK/HOLD_PRIVATE/BLOCK_PROGRAM`. |
| `fallback` | typed/null | Bắt buộc với `USE_FALLBACK`. |
| runtime `sequence/timestamp/quality/value` | generated | Publish vào write buffer; swap snapshot tại boundary. |

### 4.6 Binding và candidate

Binding giữ `bindingId`, `programId`, `variableId`, `pointCategory`, `pointId`,
`direction`, `dataType`, `unit`, `writable`, `ttlMs`. Output key
`{pointCategory,pointId}` phải unique trong package. Candidate runtime gồm
`programId`, value, quality, generatedAt, expiresAt, priority=5, revisionId.

### 4.7 Persistence/migration

SQLite migration mới tạo `pou_objects`, `library_revisions`, `library_entries`,
`program_runtime_intents`, `published_signal_defs`. Revision object v1 được đọc
và migrate thành một PROGRAM, empty project library/signals, desiredEnabled bằng
runtime intent hiện hữu nếu read-back thành công; migration không tự Commission.

## 5. Contract

### 5.1 REST/OpenAPI target

| Method/path | Role | Side effect / concurrency |
|---|---|---|
| `GET /programming/libraries` | viewer+ | Search system/project entries; cursor signed. |
| `POST /programming/projects/{id}/library/entries` | admin | Create/update user Function/FB in Draft; `If-Match` + idempotency. |
| `DELETE /programming/projects/{id}/library/entries/{entryId}` | admin | Reject when referenced; no cascade hidden. |
| `GET /programming/runtime/programs` | viewer+ | Authoritative per-Program state/intent/metrics/freshness. |
| `POST /programming/runtime/programs/{programId}/enable` | operator/admin | Idempotent desired intent; operation/read-back/audit. |
| `POST /programming/runtime/programs/{programId}/disable` | operator/admin | Safe-boundary candidate withdrawal; operation/read-back/audit. |
| `GET /programming/runtime/signals` | viewer+ | Typed value/quality/freshness/producer. |
| `POST /programming/runtime/traces` | viewer+ | Core-backed bounded trace; no BE sub-cycle polling. |

Các route Project/Revision/Check/Commission/Restore hiện có được nâng schema v2,
giữ header UUIDv4 idempotency, `If-Match`, body bound, duplicate-key reject,
stable error envelope và audit. FE không branch theo message tự do.

### 5.2 Core IPC v2

Actions: `STATUS`, `PACKAGE_STAGE`, `PACKAGE_ACTIVATE`, `PACKAGE_RESTORE`,
`PROGRAM_ENABLE`, `PROGRAM_DISABLE`, `RETAIN_RESET`, `TRACE_START`, `TRACE_STOP`,
`OPERATION_STATUS`. Mutation bắt buộc `operation_id`, `actor_id`, expected active
revision và idempotency key. Timeout 1500 ms; BE reconcile qua operation status,
không tự retry mutation với ID mới.

Error public tối thiểu: `PRG-ERR-POU-KIND-001`, `PRG-ERR-POU-RECURSION-001`,
`PRG-ERR-LIB-VERSION-001`, `PRG-ERR-PROGRAM-LIMIT-001`,
`PRG-ERR-SIGNAL-PUBLISHER-001`, `PRG-ERR-SIGNAL-FRESHNESS-001`,
`PRG-ERR-OUTPUT-OWNER-001`, `PRG-ERR-ENABLE-NOT-COMMISSIONED-001`,
`PRG-ERR-PROGRAM-STATE-001`, `PRG-ERR-PID-REVIEW-001`.

### 5.3 Artifact package v2

Header: magic/version/target/profile/build/hash/signature layout. Sections:
POU table, Program table, type/signature table, code/IR, constants, FB layout,
signal definitions, binding manifest, source map, library lock, RETAIN layout,
resource budget. Loader validates all offset/count/overflow, dependency DAG,
output owner uniqueness and exact profile before allocating prepared image.

## 6. Compiler và POU algorithm

```text
parse every POU (ST or FBD)
→ build canonical symbols/signatures
→ resolve SYSTEM + PROJECT library lock
→ build call graph; reject cycle/recursion
→ enforce kind rules and side-effect rules
→ type-check expressions, pins, calls and bindings
→ lower ST/FBD to shared typed IR
→ compute bounded state/RETAIN layouts
→ build Program/signal/output ownership graph
→ compute resource budget and one-over checks
→ emit artifact v2 + manifest + source map
```

FUNCTION may call only pure Function. FUNCTION_BLOCK may call pure Function and
contained FB instances; it may not map Point/publish/output directly. PROGRAM may
call both, publish signal and write mapped output. FBD palette is generated from
the same JSON registry as compiler dispatch; verifier checks exact equality.

## 7. Scheduler, signals và output algorithm

### 7.1 Base step

```text
capture coherent Point input snapshot
apply pending package/enable/disable at safe boundary
release every Program whose absolute deadline is due
execute released Programs against immutable inputs + committed signal snapshot
collect private next-state, signal publishes and output candidates per Program
commit successful Program private state
swap signal double-buffer once all publishers in the release set complete
withdraw failed/disabled/expired candidates   (expired = lệnh cuối già hơn 60 s, ADR-051)
resolve priority → interlock → safe-state → OutputWriter
publish status/metrics/trace; kick watchdog after full base step
```

Due queue key is absolute deadline then stable `programId` only để deterministic
implementation; output/signal semantics không phụ thuộc thứ tự đó. Worker lanes
chỉ chạy song song Program không share mutable state. Nếu một Program fault, chỉ
commit của Program đó bị hủy; package activation first-cycle dùng barrier toàn
package và rollback LKG nếu bất kỳ Program bắt buộc nào fault.

### 7.2 Enable/Disable transaction

Enable precondition: commissioned Program exists, artifact compatible, no
unresolved binding/library error. State `DISABLED→STARTING`; first successful
cycle `→RUNNING`; fault `→FAULTED`. Disable sets `STOPPING`, applies at boundary,
withdraws candidates/publish eligibility, persists intent, then `DISABLED`.

### 7.3 Signal invalid policy

At read, freshness uses Core monotonic clock. `USE_FALLBACK` returns typed
fallback+UNCERTAIN; `HOLD_PRIVATE` leaves destination local unchanged+STALE;
`BLOCK_PROGRAM` skips execution, withdraws candidates and sets `WAITING`, not
`FAULTED`. Producer recovery releases consumer at next due cycle.

## 8. FE/UX handoff

Routes target:

```text
/eng/programming                         PGM-01
/eng/programming/projects/:id/programs   PGM-02
/eng/programming/projects/:id/mapping    PGM-03
/eng/programming/projects/:id/library    PGM-04
/eng/programming/projects/:id/commission PGM-05
/eng/programming/runtime                 PGM-06
```

PGM-02 tree groups `Programs`, `Functions`, `Function Blocks`; create dialog asks
kind/language/name/library location. Inspector hides cycle/mapping for Function/
FB. PGM-04 shows system/user badge, semantic version, signature, use count,
deprecated/PID-review state. PGM-06 lists enable intent separately from runtime
state and requires acknowledgement for Disable when active candidates exist.

Visual target:

- [Programs + POU desktop](../../04_uiux/assets/programming/PGM-02_PROGRAMS_POU_DESKTOP.svg)
- [Programs + POU mobile](../../04_uiux/assets/programming/PGM-02_PROGRAMS_POU_MOBILE.svg)
- [Control Library desktop](../../04_uiux/assets/programming/PGM-04_CONTROL_LIBRARY_DESKTOP.svg)
- [Control Library mobile](../../04_uiux/assets/programming/PGM-04_CONTROL_LIBRARY_MOBILE.svg)
- Commission/Runtime safety states reuse existing PGM-03/PGM-04 assets until FE
  route migration; field/action mapping in this section is normative.

Keyboard: tree arrows, Enter open, Shift+F10 actions, Ctrl+S save, Ctrl+K palette,
Ctrl+Z/Y bounded history. All async state has loading/empty/error/permission/
stale/offline/unknown. Breakpoints: desktop >=1280, tablet 768..1279, mobile
<768 read/operate-light only. Visible focus >=2 px; text contrast >=4.5:1.

### 8.1 Candidate overlay PGM-02 v2.2

Thiết kế chi tiết có phạm vi hẹp hơn và là authority Candidate tại
[`DDD-SW-PGM02-WORKSPACE-001`](PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md).
Nó không thay đổi baseline Active cho tới khi Owner + System Architect pin cùng
exact revision/hash. Candidate khóa các điểm sau để review:

| Chủ đề | Candidate target | Trạng thái authority |
|---|---|---|
| Increment | `R1 EDIT → R2 LIVE → R3 SIMULATE`; mỗi increment có flag, gate và verdict riêng | Owner đồng ý; Architect pin pending |
| Route | `/eng/programming/programs?project=<uuid>&pou=<objectId>&mode=EDIT|LIVE|SIMULATE`; route project-scoped cũ chỉ là redirect tương thích | Chỉ có hiệu lực sau exact pin |
| Identity | Editor chọn POU bằng `objectId`; `programId` chỉ thuộc cấu hình PROGRAM; tuple document/value phải exact | Candidate contract |
| R1 | Typed Draft, Quick Library signature authoritative, semantic reference/refactor và diagnostic anchor chính xác | `IMPLEMENT_READY[PGM02-R1]=NO-GO` |
| R2 | Source immutable của Active Revision ghép coherent với runtime value; workspace LIVE read-only cho mọi role | `IMPLEMENT_READY[PGM02-R2]=NO-GO` |
| R3 | Worker ephemeral cách ly; Simulation mutation chỉ `admin`; không production handle/output/RETAIN | `IMPLEMENT_READY[PGM02-R3]=NO-GO`; `ADR-053` Proposed |
| Responsive | `<768 px` chỉ đọc source/status/diagnostic; không authoring hoặc session mutation | Chỉ có hiệu lực sau exact pin |

Vì route và mobile policy trên khác baseline 1.1, consumer không được chọn tùy
ý giữa hai bản. `PGM02-V22-WP-00` phải pin Candidate trước; rollback pin trả toàn
bộ consumer về route/policy baseline, không tạo trạng thái lai.

## 9. Error, safety và security

| Failure/abuse | Detection | Giữ/đổi state | Recovery |
|---|---|---|---|
| Recursion/side effect/limit | Check | Active/LKG unchanged | Fix Draft, new Revision. |
| Library missing/drift | Check/stage | Reject candidate | Pin compatible version or migrate source. |
| Duplicate signal/output owner | Check | No runtime mutation | Resolve owner/dependency. |
| Enable unknown/uncommissioned Program | Core | Intent unchanged | Refresh active package; explicit error. |
| Program WCET/exception | Core | Fault only Program; candidates withdrawn sau tối đa 60 s hold-last (`ADR-051`) | Diagnose, Disable/Restore; independent Programs continue. |
| Signal stale | Core | Apply explicit consumer policy | Producer recovery or operator action. |
| Commission timeout/restart | BE/Core journal | `UNKNOWN/RECONCILING`, old Active or deterministic recovery | Operation read-back; never replay with new ID. |
| Corrupt artifact/RETAIN/journal | Loader/recovery | Fail closed; LKG/cold-init policy | Restore LKG, alert/audit. |
| Unauthorized mutation | BE before service | No side effect | 403 + audit reject. |
| Malicious source/bundle | bounded parser/importer | Zero mutation | stable error, rate-limit/audit. |

PID registry remains callable only under feature status `REVIEW_REQUIRED`; FE
shows warning and Check blocks Commission unless profile includes Controls/Safety
approval token generated from controlled contract—not a UI checkbox.

## 10. Repository mapping

| Layer | Tạo/sửa chính |
|---|---|
| Contracts/generator | `contracts/programming/`, `contracts/openapi/openapi.yaml`, `contracts/ipc/programming_v1/`→v2, generators/errors/FBD registry. |
| Compiler | `apps/core/application/st/st_parser.*`, `st_semantic.*`, `st_ir.*`, `st_fbd_*`, artifact/loader, new `st_pou_registry.*`. |
| Runtime | `st_scheduler.*`, `st_process_image.*`, `st_retain.*`, `st_trace.*`, coordinator/IPC server, `bootstrap/main.cpp`. |
| BE/store | `apps/web-api/internal/programming/{domain,application,store,coreipc,transport/http}`, migrations, compiler runner. |
| FE | `apps/web-ui/src/features/programming/` routes/model/api/editor/FBD/library/runtime. |
| Packaging | `platform/packaging/`, systemd/env; Programming default enabled in release package. |

Cấm: FE deep-import nội bộ feature khác; Programming tái định nghĩa Modbus
endian/polling; BE direct SHM mutation; Program direct IOP; parser/compiler trên
RT thread; hidden fallback từ signal/Point missing thành zero.

## 11. Verification và acceptance

| ID | Level/fixture | Expected |
|---|---|---|
| `VS-PROG-U01` | Compiler unit: ST/FBD Function | Pure equivalence; state/I/O/recursion reject. |
| `VS-PROG-U02` | Compiler/runtime: FB instances | 100 instances giữ state riêng; reload/RETAIN đúng owner. |
| `VS-PROG-U03` | Contract/store: library | CRUD/version/dependency/import hostile; immutable Revision. |
| `VS-PROG-U04` | Package 32/16 + one-over | 32 Programs compile; Program 33 hoặc Enabled 17 reject ổn định. |
| `VS-PROG-U05` | Target 10-Program fixture | 10 Program, 3 periods, không creation-order dependency; deadline/budget đạt. |
| `VS-PROG-U06` | Signal snapshot/freshness | No torn read; stale policies đúng; publisher fault cô lập. |
| `VS-PROG-U07` | Enable/Disable API→Core | RBAC/idempotency/audit/read-back; candidate withdrawal đúng. |
| `VS-PROG-U08` | Package activation/power fault | Atomic/LKG/restart intent/RETAIN matrix, no partial active. |
| `VS-PROG-U09` | Physical I/O HIL | ST và FBD Program thay AO/DO thật qua full safety path; rollback đúng. |
| `VS-PROG-U10` | FE real-backend E2E | Sáu workspace, POU/library/mapping/check/commission/enable/runtime. |
| `VS-PROG-U11` | Trace/load/soak | Core trace bounded, 24 h, no poll gap >=200 ms, no leak/deadlock. |
| `VS-PROG-U12` | PID Controls/Safety | Saturation/anti-windup/override/release evidence; chỉ test này mở label ready. |
| `VS-PROG-U13` | PGM-02 R1 contract/host/browser | Typed Draft/signature/reference/refactor/anchor và EDIT read-back; positive/negative/fault. |
| `VS-PROG-U14` | PGM-02 R2 producer→UI/read-back | Active source/value tuple coherent; mismatch/stale/offline/revision switch fail closed. |
| `VS-PROG-U15` | PGM-02 R3 isolation/RBAC/determinism | Admin-only mutation, virtual time deterministic, quota/restart/expiry và zero physical output. |

Host test đóng implementation behavior; U05/U08/U09/U11/U12 cần target/HIL để
đóng release. Evidence ghi commit/image/config/hash/operator/reviewer; không kế
thừa verdict từ contract cũ.

## 12. Compatibility, deploy và rollback

1. Deploy đọc được artifact v1 và v2 trong một transition release; chỉ writer v2
   tạo package mới. Không mixed active package.
2. Backup DB/artifact/LKG/RETAIN trước migration. Migration v1→v2 tạo Draft, Check
   và explicit Commission; không đổi Active tự động.
3. Thứ tự: contracts/generator → BE/FE compatible → Core dual-reader → migrate →
   Commission v2 → bỏ writer v1 ở release sau khi rollback window đóng.
4. Rollback code giữ Core dual-reader và DB migration backward-safe; không xóa
   Revision/library/audit/RETAIN. Trigger: migration/check/activation/restart/HIL
   fail hoặc poll gap >=200 ms.
5. Fresh install bật Programming release flag; missing Core returns explicit
   unavailable nhưng không làm Web crash.

## 13. Traceability, risk, sign-off và DD checklist

Rủi ro chính: scheduler isolation, signal stale, output conflict, POU recursion,
library supply chain, migration/LKG và physical I/O. Controls là bounded profile,
single owner, generated registry, fail-closed loader, journal/LKG, target/HIL và
rollback. Residual risk chỉ giảm bằng evidence, không bằng tài liệu này.

| DD | Kết quả | Vị trí |
|---|---|---|
| `DD-01` | PASS | Metadata + lịch sử/sign-off. |
| `DD-02` | PASS | §1. |
| `DD-03` | PASS | §2 có source/contract và gap. |
| `DD-04` | PASS | §3 ownership/boundary. |
| `DD-05` | PASS | §4 field/type/default/range/invariant/migration. |
| `DD-06` | PASS | §5 REST/IPC/artifact/RBAC/timeout/idempotency/error. |
| `DD-07` | PASS | §6–§7 algorithm/order/atomic/timing/resource/restart. |
| `DD-08` | PASS | §8 route/state/a11y/visual. |
| `DD-09` | PASS | §9 safety/security/recovery. |
| `DD-10` | PASS | §10 source/dependency/build/package. |
| `DD-11` | PASS | §11 fixture/expected/authority. |
| `DD-12` | PASS | §12 migration/deploy/rollback. |
| `DD-13` | Baseline PASS; Candidate PENDING | §13 baseline; §8.1 và `DDD-SW-PGM02-WORKSPACE-001` giữ exact pin/ADR-053/test result mở. |

| Vai trò | Trạng thái |
|---|---|
| Product Owner/CTO + System Architect | **ACCEPT — `AUTH-PROG-2026-08-20-04`** |
| Compiler/Core/BE/FE/Controls/Security/QA | `WAIVED FOR IMPLEMENTATION`; finding hậu kiểm sửa trong task, không chặn code |
| Release authority | Chưa ký; chỉ đánh giá sau target/HIL evidence |
| PGM-02 v2.2 Candidate | **Owner: APPROVE SCOPE/WP-00; System Architect: PENDING EXACT PIN** — không trao quyền R1/R2/R3 |

## Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.2-candidate | 2026-08-24 | Thêm overlay PGM-02 v2.2 dẫn formal DDD, khóa ba increment, route/identity/mobile target và `VS-PROG-U13..U15`; giữ baseline 1.1 Active và toàn bộ increment `NO-GO` chờ exact pin. |
| 1.1 | 2026-08-21 | `ADR-051` ký TTL hold-last: "expired candidate" ở §7.1 và hàng WCET/exception ở §9 nay có con số — lệnh cuối của Program ngừng publish sống tối đa **60 s** rồi bị rút, resolver/interlock/safe-state chọn giá trị tiếp theo. Không đổi kiến trúc, contract hay capacity. |
| 1.0 | 2026-08-20 | Khóa thiết kế thống nhất multi-Program, POU, library, signal, lifecycle, scheduler, output safety, migration và verification; không còn Open Decision/TBD chặn implementation. |
