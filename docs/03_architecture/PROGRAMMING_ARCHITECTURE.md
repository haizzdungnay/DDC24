# Kiến trúc hệ thống Product Programming thống nhất

| Thuộc tính | Giá trị |
|---|---|
| ID | `ARCH-PROG-001` |
| Phiên bản | 1.1-candidate (baseline hiệu lực: 1.0) |
| Trạng thái | **Baseline Active + PGM-02 v2.2 TARGET CANDIDATE; Architect exact pin PENDING** |
| Ngày | 2026-08-24 |
| Chủ quản | Software/Runtime Architect |
| Người phê duyệt | Product Owner/CTO + System Architect theo `AUTH-PROG-2026-08-20-04` |
| Requirement | `SRS-PROG-001` v1.0 Active + v1.1 Candidate |
| Detailed Design | `DDD-SW-PROG-UNIFIED-001`; Candidate `DDD-SW-PGM02-WORKSPACE-001` |
| Authority Candidate | `CR-PROG-PGM02-V22-001`: Owner mở WP-00; `ADR-053` Proposed; code R1/R2/R3 NO-GO |
| As-Built baseline | `49a2ad1`; one-Program path chỉ dùng để migration |

## 0. Quyết định kiến trúc

Baseline Programming là module trong ba process hiện hữu, không thêm daemon:

- `mkddc-web`: Product store, compiler orchestration, REST, RBAC/audit và UI.
- `mkddc-core`: active package, scheduler, POU instance state, Published Signal,
  candidate, priority/safety integration, RETAIN, trace và authoritative state.
- `mkddc-iobus` + STM32: Point/fieldbus/physical I/O; không parse ST/FBD và không
  biết Project/Revision.

Product hỗ trợ nhiều Program độc lập; Function/Function Block là reusable POU,
không phải schedulable application. Mọi output vẫn đi qua một đường an toàn.
Không còn decision blocker implementation; release vẫn cần target/HIL evidence.

PGM-02 v2.2 là ngoại lệ Target có kiểm soát: R3 đề xuất một executable worker
**ephemeral theo session**, không phải daemon control production và không thuộc
ba-process control path. Quyết định này nằm ở `ADR-053` trạng thái Proposed;
Architect chưa pin nên không trao quyền code. R1 EDIT và R2 LIVE vẫn dùng process
hiện hữu; LIVE hoàn toàn read-only.

## 1. Context và trust boundary

```text
Controls engineer
  │ HTTPS + RBAC + ETag + idempotency
  ▼
Web UI ── generated client ──► mkddc-web
                                ├─ Product/Revision/Library/Operation store
                                ├─ compiler worker sandbox
                                └─ UDS IPC v2
                                      ▼
                                  mkddc-core
                                ├─ package coordinator/LKG/journal
                                ├─ Program scheduler + POU instances
                                ├─ Published Signal snapshot
                                ├─ output candidate registry
                                └─ resolver → interlock → safe-state
                                      ▼
                                  mkddc-iobus → IOP → STM32 → AO/DO
```

Web/HMI không nằm trong control path. Compiler không chạy RT priority. Core không
truy cập DB/HTTP trong scan. Iobus/MCU không nhận artifact hay source.

Target Candidate R3 thêm nhánh ngoài control path:

```text
mkddc-web Simulation supervisor
  └── spawn per session → mkddc-programming-sim-worker
        ├── immutable Saved-Draft artifact
        ├── virtual point/process image + virtual clock
        └── NO production Core/iobus/SHM/device/output/RETAIN handle
```

## 2. Ownership

| Mutable state | Writer duy nhất | Reader | Persistence |
|---|---|---|---|
| Project Draft/POU/library metadata | `mkddc-web` transaction | FE/compiler | SQLite + backup |
| Immutable Revision/package manifest | `mkddc-web` | compiler/Core/Ops | content-addressed |
| Operation journal | `mkddc-web`; Core phase read-back | FE/Ops | SQLite + Core checkpoint |
| Active/LKG package | Core coordinator | BE/FE/Ops | atomic journal/checkpoint |
| Enable intent | BE durable store; Core applies idempotently | FE/Ops | SQLite + Core read-back |
| Program/FB runtime state | Core Program instance | Monitor/trace | volatile + RETAIN policy |
| Published Signal snapshot | Core publisher commit | Core consumers/Monitor | double-buffer volatile |
| Output candidate/owner | Core registry | resolver/Monitor | runtime; rebuilt from Active |
| Physical Point actual/quality | iobus/driver authority | Core/BE/FE | canonical Point image |
| RETAIN record | Core mailbox/worker | Core/Ops | atomic file + CRC/identity |
| Simulation session metadata (Candidate) | `mkddc-web` supervisor | FE/Ops/audit | bounded reconciliation metadata; process image ephemeral |
| Simulation virtual state (Candidate) | isolated per-session worker | BE/FE read model | volatile; discarded on stop/expiry/reboot |

Không có shared writable state giữa Program. Published Signal là snapshot typed,
không là pointer hay Point mới.

## 3. Product package

Một Revision đóng thành package bất biến:

```text
Package
├── profile/capacity/resource budget
├── POU definitions: PROGRAM / FUNCTION / FUNCTION_BLOCK
├── library dependency/version/signature
├── Program topology: period/budget/priority/dependency policy
├── Published Signal publisher/consumer/freshness/fallback
├── Point bindings + output owner
├── RETAIN layout/identity
└── artifact/source-map/provenance/signature
```

Capacity Product: tối đa 32 Program/Revision, 16 Enabled, 256 user POU, 1024 FB
instance, 512 Published Signal và 512 binding. One-over bị từ chối bằng stable
error trước stage; không tự cắt bớt.

## 4. Compiler và POU graph

Compiler giải namespace theo thứ tự deterministic, dựng call/dependency DAG và
từ chối missing/ambiguous/version drift/direct hoặc indirect recursion.

- Function thuần: không mutable static/RETAIN/I/O/FB stateful call.
- Function Block definition có layout state; mỗi instance bên trong Program có
  identity/state/RETAIN namespace riêng.
- Program sở hữu lifecycle, period, mapping, signals và candidate.
- ST/FBD lower xuống typed IR chung; source map giữ POU/node/pin/location.

Artifact v2 không chứa parser/compiler. Core loader bounded, validate signature,
profile, ABI, section length, graph/resource và identity trước mutation.

## 5. Scheduler và execution isolation

Core dùng base control step monotonic. Mỗi Enabled Program có due state riêng;
creation order không tạo dependency. Scheduler lựa Program due theo deadline/
stable ID, đưa vào worker lane có budget. Single-core và multicore phải cho cùng
semantics vì Program không share mutable state.

```text
base step
  → capture Point input snapshot
  → commit previous Published Signal snapshot
  → build due queue
  → execute due Program against immutable inputs/signals
  → validate/commit next signal snapshot
  → publish/withdraw output candidates
  → priority/interlock/safe-state
  → hand off effective output
```

Fault/overrun một Program chuyển Program đó `FAULTED`, rút candidate theo policy
và không dừng Program độc lập khác. Dependency chỉ tồn tại qua declared signal
policy `USE_LAST`, `FALLBACK` hoặc `WAIT`; không serialize ngầm.

## 6. Lifecycle và atomicity

```text
Draft → Check → Revision/package → Commission package
      → STAGING → ACTIVATING at safe boundary → VERIFYING first outputs
      → Active/LKG commit | rollback exact prior package

Per Program: DISABLED ↔ STARTING → RUNNING/WAITING → STOPPING → DISABLED
                                      └→ FAULTED/UNKNOWN
```

Commission là atomic ở cấp package. Không active một phần. Enable intent là bền
vững nhưng không đồng nghĩa runtime `RUNNING`. Mutation có operation ID,
idempotency, expected active/package hash và authoritative read-back. Timeout là
`UNKNOWN_RECONCILING`, không optimistic success hay auto replay.

## 7. Output và safety boundary

Mỗi physical output có tối đa một Program owner trong package. Hai binding cùng
output fail Check. Runtime chỉ xuất candidate:

```text
Program candidate
→ owner registry / TTL withdrawal
→ PriorityResolver
→ Interlock
→ SafeState
→ OutputWriter
→ iobus/IOP/STM32
```

Disable/fault/TTL expiry rút candidate tại safe boundary; resolver chọn priority
tiếp theo/default/safe policy. Không có đường Program→SHM/IOP/MCU trực tiếp.
Graph và Programming chỉ có `GRAPH_ONLY` hoặc `PROGRAM_ONLY` cho Local logic;
không dual-write mức 5.

## 8. Failure boundary

| Failure | State/output | Recovery/read-back |
|---|---|---|
| FE/Web mất | Active Core tiếp tục | reconnect; không replay mutation |
| Compiler timeout/crash | Check fail; Active/LKG giữ | diagnostic/resource audit |
| IPC timeout | Operation unknown | query operation + Core state |
| Artifact/package hỏng | reject trước scheduler mutation | giữ Active/LKG |
| Program fault/overrun | isolate Program, withdraw candidate | metrics/fault/audit; explicit recover |
| Signal stale/missing | declared fallback/wait; no torn read | freshness/producer state |
| Core restart | MCU safe-timeout; restore exact checkpoint policy | boot/active/LKG/intent/RETAIN read-back |
| RETAIN corrupt/layout drift | cold-init rejected with reason | reset/recommission policy |
| Iobus/Point stale | safety policy | quality/reason/affected output |
| MCU mất frame 200 ms | physical safe behavior | safe counter/diagnostic |

## 9. Security và resource

- HTTPS/session/origin/CSRF theo Web baseline; server RBAC từng route/action.
- UDS directory/mode/peer credential, frame/version/field bounds fail closed.
- Mutation dùng ETag/idempotency/correlation/re-auth/reason/audit.
- Artifact/library release bắt buộc `SIGNED`; key custody/rotation/rollback ở
  `T59-602`. `HASH_ONLY` chỉ migration/development, không release.
- Import source-only; từ chối traversal/symlink/executable/zip bomb/unknown field.
- Scan/worker memory preallocated; không filesystem/network/DB/blocking shared
  lock trong output-critical path.
- Trace 10k mẫu/10 phút bounded; no allocation trong producer path.

## 10. Deployment và compatibility

Migration dùng dual-reader v1/v2 trong một compatibility window:

1. backup DB/artifact/Active/LKG/RETAIN/journal + checksum;
2. deploy Core reader mới ở `GRAPH_ONLY`, đọc v1 và v2;
3. deploy compiler/Web/FE và route mới; migration DB atomic/idempotent;
4. tạo v2 package nhưng không tự Commission/Enable;
5. verify/rehearse rollback; chỉ sau đó mở target cutover;
6. bỏ v1 writer trước, bỏ v1 reader ở release sau có evidence migration.

Rollback package không xóa Draft/Revision/audit/LKG/RETAIN. Core cũ phải reject
artifact mới bằng stable error, không parse một phần.

### 10.1 PGM-02 Target Candidate theo increment

| Increment | Process/ownership | Data/contract boundary | Failure boundary |
|---|---|---|---|
| R1 EDIT | FE + `mkddc-web` Draft/compiler | typed Draft v1/v2, Library signature, atomic reference/refactor, typed diagnostic; `objectId` selection tách `programId` | parse/analysis/ETag lỗi = zero mutation; Save/Check không đổi Active |
| R2 LIVE | Core producer → IPC → BE read model → FE | sealed Active document tuple + runtime observation tuple; monotonic sequence; ≤10 Hz UI | mismatch/cutover/gap = clear/rejoin/UNAVAILABLE; LIVE không có mutation route/action |
| R3 SIMULATE | Web supervisor + isolated ephemeral worker | immutable Saved-Draft snapshot, virtual image/time, server RBAC/audit; viewer/operator/admin read, admin-only mutation | sandbox/quota/timeout/crash/expiry fail closed; không production handle hoặc physical output authority |

Worker R3 được phép link pure compiler/artifact validation/executor primitives,
nhưng bị cấm link `OutputWriter`, device driver, production SHM/UDS clients,
singleton coordinator, RETAIN writer hoặc iobus. Cùng snapshot/input phải cho
kết quả deterministic ở mọi tốc độ; `STEP_CYCLE` snapshot input, chạy toàn bộ
Program due theo stable order, commit một lần, tăng virtual time theo GCD rồi
quay lại PAUSED. Process reboot không phục hồi session cũ.

Capability của từng increment mặc định false và versioned. Partial deploy hoặc
version mismatch trả `UNAVAILABLE/UNSUPPORTED`; không để FE fake producer. R3
chỉ được bật sau Test Result target/HIL chứng minh Active/LKG/runtime counters và
AO/DO/relay vật lý không đổi qua create/run/step/input/reset/stop/fault/expiry.

## 11. Source mapping

| Boundary | Source/contract phải sửa | Plan59 |
|---|---|---|
| Profile/registry/error | `contracts/programming/`, generators, TS/Go/C++ output | T59-002..004 |
| Store/OpenAPI/IPC/artifact | `apps/web-api/internal/programming/`, `contracts/openapi/`, `contracts/ipc/programming_v2/` | T59-005/006 |
| Compiler/POU/artifact | `apps/core/application/st/`, compiler runner | T59-101..106 |
| Library | BE domain/store/routes + FE `features/programming/library/` | T59-201..205 |
| Project/check/mapping | BE application/compiler + FE editor/mapping | T59-301..306 |
| Runtime/lifecycle | Core programming/scheduler/scan + IPC | T59-401..408/501/502 |
| UI six workspace | FE routes/pages/generated client | T59-503..506 |
| Trust/package/release | compiler/loader/platform/CI | T59-601..707 |
| PGM-02 R1 EDIT | FE programs shell/editor/FBD/library + BE Draft/library/reference/check contract | Candidate task sau `T59-801` |
| PGM-02 R2 LIVE | Core active/observation pin + IPC/BE join + FE keyed overlay | Candidate task sau R1 + exact pin |
| PGM-02 R3 SIMULATE | BE supervisor/session + isolated worker + FE simulation surface + sandbox policy | Candidate task sau R2 + `ADR-053` Accepted |

Dependency cấm: FE làm runtime authority; BE transaction chờ Core; compiler trong
HTTP handler không giới hạn; Core scan gọi DB/network; Program direct IOP; shared
mutable cross-Program; manual registry duplicate; action IPC không handler.

## 12. Verification và gate

| Gate | Bằng chứng |
|---|---|
| Contract | exact generator/golden/route/codec/negative drift |
| Compiler | POU purity/state/DAG/equivalence/fuzz/loader bounds |
| Runtime host | 10 Program/3 period, TSan, fault isolation, signal/output/retain/restart |
| FE↔BE↔Core | real-backend E2E, no Programming `page.route` mock |
| Target | 10 Program soak 24 h, Web/BE loss, deadline/IOP continuity |
| HIL | ST+FBD AO/DO, Disable/fault/safe-state/rollback, power-cut RETAIN/LKG |
| Release | signed provenance, fresh install/upgrade/replacement/rollback, CI and Test Result |

Host/browser evidence không thay target/HIL. Baseline ADR-050 giữ gate hiện hành;
riêng PGM-02 `PLAN_READY=PENDING`, `IMPLEMENT_READY[R1|R2|R3]=NO-GO` tới exact
pin. `RELEASE_READY` chỉ GO theo Plan59/VVP có authority.

## 13. Risk và sign-off

Rủi ro chủ đạo: output ownership, signal race, scheduler dependency, POU
recursion, library supply chain, partial package/power loss, IOP gap và fake HIL.
Control/owner/scenario nằm ở `RSK-PROG-001` v3.0 và `TRACE-PROG-001` v4.0.

| Vai trò | Disposition |
|---|---|
| Product Owner/CTO + System Architect | **ACCEPT — `AUTH-PROG-2026-08-20-04`** |
| Discipline leads | Review/fix trong task Plan59; không chặn entry implementation |
| Verification/Release | Chờ evidence W7; residual chưa accept nên production NO-GO |
| Product Owner — PGM-02 Candidate | **APPROVED CHANGE REQUEST / WP-00 ONLY** |
| System Architect — PGM-02 Candidate và `ADR-053` | **PENDING exact revision/hash pin; production code NO-GO** |

## 14. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1..0.9 | 2026-08-09..13 | Kiến trúc baseline một Program và source/host operation; superseded về Product Target. |
| 1.0 | 2026-08-20 | Viết lại kiến trúc thống nhất cho POU/package/multi-Program/signal/enable/scheduler/output/migration/release; loại contradiction phạm vi cũ khỏi nội dung Active. |
| 1.1-candidate | 2026-08-24 | Thêm boundary PGM-02 R1/R2/R3, coherent LIVE và ephemeral Simulation worker không production handle; đăng `ADR-053` Proposed, giữ Architect exact pin/code/release PENDING/NO-GO. |
