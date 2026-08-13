# Thiết kế FW-SOM Programming Runtime MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-FWSOM-PROG-001` |
| Phiên bản | 0.7 |
| Trạng thái | **M3 — APPROVED FOR IMPLEMENTATION; P3 `300..307` và P4 `400..402` có source/host evidence; BE coordinator/cutover và target evidence còn mở** |
| Ngày | 2026-08-13 |
| Chủ quản | Core/Runtime Lead |
| Người review | Controls Lead, Safety Lead, Backend Lead, Verification Lead |
| Người phê duyệt | Runtime Architect + System Architect |
| Nguồn | `DDD-LANG-PROG-001`, `IFSPEC-ART-PROG-001`, `DDD-CTRL-PROG-001`, `DDD-LIFE-PROG-001` |
| Requirement | `SWR-REQ-PROG-CORE-101..110` |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và target evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **`mkddc-core` chạy Program như thế nào trên SOM**: phân lớp runtime, base step và scheduler, loader/activation, process image, arbitration, RETAIN, trace, và ngân sách luồng/thời gian. |
| 2. Ai phải đọc file này? | Core/FW-SOM Lead (chủ quản); Controls đối chiếu với [Control Semantics](PROGRAMMING_CONTROL_SEMANTICS.md); BE đọc §5 để biết bàn giao artifact; QA đọc §11 và §17. |
| 3. Hệ thống hiện tại đang có gì? | P3 `TASK-PROG-300..307` đã đóng source/host: prepare/activation, profile/base-step, process image atomic, PID tracking, overrun, trace, PROGRAM_ONLY bootstrap và soak 10.000 cycle. `TASK-PROG-400..402` có journal component, hold-last withdrawal và RETAIN v2 đã wire scheduler/bootstrap. Default vẫn GRAPH, feature flag OFF; UDS/BE coordinator/cutover chưa có. |
| 4. Thiết kế mới thay đổi điều gì? | Biến các component rời rạc đó thành một runtime thật sự được nối vào: base step tách khỏi chu kỳ Task, loader chạy ngoài RT rồi bàn giao tại biên an toàn, process image đóng băng trong lúc Program chạy, output đi qua arbitration mức 5, RETAIN khôi phục trước lần chạy đầu. |
| 5. Team phải sửa module/contract nào? | `TASK-PROG-403` tiếp theo nối BE coordinator/UDS với journal/safe-boundary; `404` thực hiện cutover/rollback và `405` fault injection. RETAIN source hiện nằm ở `st_retain.*`, scheduler/process image/bootstrap và control schema. |
| 6. Điều gì còn bị chặn? | Source còn lại là `TASK-PROG-403..405`; release còn cần 32/32 Test Result, power/restart/WCET/watchdog/IOP trên Forlinx/HIL và residual acceptance. Không mục nào chặn tiếp tục implementation. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Host targeted RETAIN/control/IR/manifest/integration `111/111 PASS`; full repository gate ghi trong Plan 53/CHANGELOG. `VS-PROG-029/030`, jitter/WCET/watchdog/IOP vẫn phải chạy **trên board**, chưa được suy từ host PASS. |

Điểm dễ hiểu sai nhất: **PROGRAM_ONLY và RETAIN đã có source không đồng nghĩa
được phép chạy production**. Default vẫn GRAPH, feature flag vẫn OFF và chưa có
BE coordinator/UDS/cutover hoặc target/HIL Test Result.

## 1. Baseline thật

Source hiện có parser/semantic, typed IR/artifact/loader, scheduler, cyclic
runtime, I/O mapping, arbitration, RETAIN, trace và host tests tại
`apps/core/application/st/`. Bootstrap hỗ trợ explicit `--programming-mode` và
chỉ dựng scheduler/retain service trong PROGRAM_ONLY; không có dual producer.
Default GRAPH và thiếu UDS/coordinator nghĩa là chưa có luồng Commission user
reachable, chưa phải feature Programming production hoàn tất.

## 2. Phân lớp runtime

```text
Non-RT build side                         RT/control side
────────────────                         ───────────────
ST/FBD source
→ parser/normalizer
→ semantic/type/topology
→ common typed IR
→ serialize/hash/source-map       →      staging reader
                                         loader verifier
                                         preallocated runtime image
                                         safe-boundary activation
                                         base-step scheduler/executor
                                         priority/safety/output commit
```

Core production binary không được parse source hoặc link editor/BE/DB. Có thể
dùng compiler binary riêng từ cùng source library, nhưng CI phải chứng minh RT
binary không có forbidden parser/filesystem/network call path sau activation.

## 3. Runtime profile Rev A

| Thuộc tính | Giá trị proposal | Ghi chú |
|---|---:|---|
| Task | 1 | override supporting ceiling 8 |
| Period | 1000/5000/30000 ms | dispatch cadence, không base step sleep |
| Artifact | <=1 MiB | loader reject one-over |
| Program source | <=64 KiB | chờ OD-PROG-003 |
| FBD | <=256 block/512 connection | chờ OD-PROG-003/006 |
| Binding | <=256/Program | Point Catalog/ABI sizing phải review |
| RETAIN | <=128 biến/FB, <=4096 byte/Program | profile/compiler/loader enforce; target endurance còn phải đo |

Runtime phải đọc profile từ artifact/capability version; không expose generic
supporting limits làm Product capability.

## 4. Base step và scheduler

- Một monotonic `ClockSnapshot` tại đầu step.
- Input/Point snapshot frozen cho toàn step.
- `baseTick`/step cadence độc lập Task period và bị ràng buộc bởi IOP 200 ms.
- Task due chạy non-preemptive theo execution order; Rev A không task priority.
- Không heap allocation sau init/activation commit; buffer/vector reserve trước.
- Output Program chỉ stage mức 5; resolver/safety commit một lần.
- Metrics publish sau physical commit và không được chặn critical path.
- Watchdog kick duy nhất sau step hoàn tất.

Supporting `StScheduler::any_force_safe()` hiện không phù hợp proposal: overrun
chỉ fault Task; plant safe-state cần `SafetyManager` reason độc lập. Phải sửa
contract/test trước production wiring.

## 5. Loader và activation

Loader verify theo thứ tự bounded: header/magic → size/offset/overflow → schema/
profile/target → section/IR opcode/control-flow/resource → hash → optional policy.
Không allocate theo count chưa kiểm. Fuzz corpus bao phủ truncation, overlap,
integer overflow, duplicate section, bad branch/slot/map và hash mismatch.

Activation:

1. Non-RT thread đọc/stage/verify và dựng runtime image preallocated.
2. Core ghi pending descriptor immutable.
3. Tại safe boundary, kiểm expected active/cutover/IO freshness/transition plan.
4. Chụp previous program contribution và state compatibility.
5. Swap pointer/generation atomic; không restart iobus.
6. Chạy first cycle; chỉ khi pass mới commit output/LKG/active identity.
7. Fail thì giữ/khôi phục LKG và trả error + keeps-running truth.

## 6. Process image và Point binding

Input slot chứa value typed, quality, producer timestamp và Point identity.
Missing/bad/stale không thành zero; execution dùng quality policy/fallback được
Check phê duyệt. Output slot chứa `program_value` và binding metadata; bridge
không ghi thẳng physical.

Local/VP/MB-RTU adapters đều quy về Point Table owner; RTU identity là
`{deviceId,pointId}`. Core không truy cập Modbus register/serial và Program không
thấy Modbus TCP/BACnet Point.

## 7. Arbitration, PID và hold-last

| Trường hợp | Integrator | Output mức 5 |
|---|---|---|
| mức 5 thắng, không limit | update bình thường | calculated |
| mức 5 thắng nhưng clamp/rate limit | back-calculate theo trước/sau limit cùng command path | limited |
| mức 1–4 thắng | freeze/hold theo block contract | vẫn tính/giữ riêng; không track actual ngoại lai |
| activation compatible | seed state cùng logic + previous program value | first commit bằng previous program value |
| binding/state mới không compatible | require transition/initial policy | Commission bị chặn nếu thiếu |

Runtime snapshot publish `programValue`, `actualValue`, winner, priority, TTL và
freshness. Không claim bumpless trước HIL AO/DO + PID/override/release.

## 8. RETAIN

- Record v2/header 160 byte/layout v1, key file SHA-256 của
  `controllerId + NUL + stableInstanceId`; đối chiếu CRC toàn record cùng
  instance/layout/artifact SHA-256, compact layout CRC, size và reserved bytes.
- Payload canonical typed + state FB, không phụ thuộc padding ABI; timer persist
  elapsed rồi rebase, PID reseed clock/derivative sau restore.
- Snapshot chỉ sau output batch commit. Scan publish vào mailbox SPSC hai slot
  không I/O/lock/allocation; worker coalesce ngoài RT, rate-limit 60 s và force
  khi shutdown sạch.
- Atomic temp→fsync→close→rename→fsync dir; read `O_NOFOLLOW`, regular-file và
  size bound; directory/file `0750/0640`.
- Warm restore chỉ khi exact-compatible. Missing record = `COLD_INIT_MISSING`;
  corrupt/version/layout/identity/size = `COLD_INIT_REJECTED` +
  `RT-RETAIN-001..004`; validate toàn payload trước apply, không chặn Core boot.
- Control status trả state/detail/generation/write count/failure. Reset RETAIN
  user-facing vẫn phải đi qua operation admin safe-boundary/audit ở `403+`.

## 9. Trace và diagnostics

Ring buffer bounded trong core; event có monotonic/UTC correlation, revision,
artifact, Task/Program, code/source location và dropped count. Trace variable
sampling tối đa theo V&V, không persist/log trên RT path. BE gom ngoài RT.

Engineering diagnostic không tự tạo process alarm. Active runtime fault hoặc
SafetyManager state chỉ link alarm khi alarm policy/authority tạo record.

## 10. Cutover/bootstrap/config

Bootstrap target phải có config versioned xác định `GRAPH_ONLY|PROGRAM_ONLY` và
reject cả hai. Trong `PROGRAM_ONLY`, không load/execute graph và không lấy period
từ graph. Trong `GRAPH_ONLY`, scheduler có thể không init và Commission bị reject.

Migration đầu tiên cần backup graph, convert/report mapping nếu được phê duyệt,
operator confirmation và rollback về graph/LKG. Không dual-run trên output thật.

## 11. Test và evidence

- Unit/fuzz: parser/semantic/FBD normalization/IR/loader/map/RETAIN/scheduler.
- Static/instrumented: no allocation/blocking/forbidden symbol RT path.
- Integration: BE IPC operation, idempotency, stage/activate/read-back/restore.
- Timing target: 10.000 cycle mỗi period, concurrent compiler load, max/p99/jitter,
  watchdog cadence, IOP poll gap.
- HIL: AO/DO hold-last, PID saturation/override/release, corrupt artifact,
  power loss, core/iobus/BE restart, MCU timeout và graph cutover.

## 12. Class/function/buffer Target

| Component | API/trách nhiệm | Mutable state/buffer |
|---|---|---|
| `ProgrammingRuntimeCoordinator` | `stage`, `request_activate`, `restore`, `status`, `on_safe_boundary` | one candidate, operation state, journal generation |
| `StArtifactLoader` | verify/decode into candidate | non-RT temporary bounded builder |
| `ProgramTaskRuntime` | `start/stop/on_base_step/reset_fault` | Task state, next release, base-step/missed-release counters |
| `ProgramExecutor` | `execute(snapshot, staging, budget)` | preallocated slots/FB state only |
| `ProgramProcessImage` | input snapshot/output staging/publish | fixed binding arrays + generation |
| `ProgramRetainManager` | restore/migrate/checkpoint/reset | bounded queue/latest dirty snapshot |
| `ProgramTraceBuffer` | select/sample/drain | fixed ring; drop counter |
| `ProgramIpcServer` | versioned non-RT command/status | queue 32, frame ≤64 KiB |

Target đặt coordinator tại `apps/core/application/programming/`; ST executor/
format tiếp tục dưới `application/st/`. Không nhét lifecycle/IPC/journal vào
`ScanLoop`; ScanLoop chỉ gọi interface bounded ở phase rõ.

## 13. ScanLoop integration và RT algorithm

```text
ScanLoop::step(now):
  phase_iop_read_and_quality()
  const snapshot = programming.capture_inputs(point_table, now)
  graph_or_program_owner.apply_pending_transition_at_boundary()
  if programming.due(now):
      result = programming.run(snapshot, fixed_budget)
      if result.ok: priority_resolver.publish_batch(result.proposals, generation)
      else: programming.discard_batch_and_update_fault(result)
  safety_manager.evaluate_independently()
  iop_write_selected_outputs()
  programming.emit_bounded_health_trace()
```

Exact phase với safety/output phải được Runtime+Safety review trước code. Một cycle
dùng một snapshot; proposal publish all-or-nothing. Không heap, file, DB, socket,
compiler, loader, blocking log/mutex trong RT phase. Static allocation sized từ
artifact limits trước activation; candidate không đủ memory bị reject ở stage.

## 14. Threading, priority và timing budget

| Execution context | Priority/class | Công việc | Cấm |
|---|---|---|---|
| IOP/scan | existing RT authority | base-step, input/output, safety, task execute | load/file/IPC wait/heap |
| Core Programming worker | normal/non-RT | UDS, loader, journal/retain fsync, staging | starve scan/iobus |
| BE compiler | process khác | parse/compile | link/call trong Core RT |

Base step Rev A mặc định 1 s, dải nền tảng 500..2000 ms theo ADR-027; Task
1/5/30 s phase-locked và budget `<20%` period. WCET/memory budget còn phải lấy
từ target, warning/overrun theo Control Semantics. Compiler
load concurrent phải không làm IOP gap ≥200 ms; CPU affinity/priority/cgroup là
deployment control cần đo, không giả định.

## 15. Fault injection và observability

Health snapshot tối thiểu: active/LKG revision+hash, owner, Task state/period/
next release, last/max duration, overrun/skipped releases, input quality counts,
proposal winner/masked counts, retain generation/status, trace drop, journal phase,
last fault/source map, IOP gap/watchdog. Snapshot versioned/bounded và có observedAt.

| Injection | Expected |
|---|---|
| corrupt/truncated/oversize artifact | loader reject, candidate freed, active/LKG unchanged |
| alloc fail at each candidate table | `IR-E-015`, zero RT side effect |
| executor div0/budget/non-finite | staging discarded, Task fault, safety/IOP continue |
| RETAIN CRC/layout/identity/size fail | cold-init explicit; active code vẫn start, không partial restore |
| RETAIN fsync/rename fail | giữ record cũ; tăng write failure, scan không block |
| IPC duplicate/drop/deadline | same op status or unknown reconcile; no double swap |
| power loss each journal phase | deterministic old/LKG/committed active |
| trace consumer slow | drop trace + counter, never scan block |

## 16. Build/package/config mapping

| File/build target | Change |
|---|---|
| `apps/core/CMakeLists.txt` | link executor/loader/lifecycle only; CI assert no parser/compiler symbol in `mkddc-core` |
| `apps/core/bootstrap/main.cpp` | explicit GRAPH/PROGRAM; PROGRAM_ONLY dựng scheduler + retain service; coordinator/UDS còn target |
| `apps/core/application/runtime/scan_loop.*` | phase hook + timing metric; no ownership policy duplication |
| `contracts/ipc/programming_v1` | generated/handwritten bounded schema and compatibility tests |
| `contracts/config/` | replace/retire standalone base64 control schema by migration |
| `platform/packaging/` | state/staging/retain/journal dirs, owner/mode, service limits |

Config unknown major fails startup Programming while legacy safe owner remains;
không default PROGRAM. Partial deploy disables mutation/capability rather than
accepting unsupported artifact.

As-Built Task 300/301: `apps/core/CMakeLists.txt` đã đăng ký hai CTest hậu liên kết
cho `core_application` và `mkddc-core` bằng
`scripts/verify_programming_runtime_symbols.py`; `st_program_control_v1` đã trả
profile/capacity/period/base step và systemd trích ADR-028. Bootstrap cutover vẫn Target.

## 17. Verification, deployment và rollback

| Test ID | Layer | PASS |
|---|---|---|
| `SOM-T-001` | unit/fuzz/sanitizer | parser/loader/executor/retain fault corpus clean |
| `SOM-T-002` | symbol/static/RT instrumentation | zero forbidden parser/compiler/blocking/allocation in RT |
| `SOM-T-003` | host integration | lifecycle state/idempotency/swap/rollback/read-back exact |
| `SOM-T-004` | target timing 10.000 cycles/period | max/p99/jitter/IOP gap within approved limit |
| `SOM-T-005` | power/restart matrix | one active + valid LKG/journal/RETAIN |
| `SOM-T-006` | graph/program cutover | no dual owner/partial proposal |
| `SOM-T-007` | HIL MCU 199/200/201 ms | expected quality/safe entry/continuity |

`SOM-T-002` hiện **PARTIAL HOST PASS** cho allocation/symbol boundary tại
`4f7e0ac`. `SOM-T-004` có host precheck profile/cadence tại `a831a0d`: Task 30 s
không chặn base-step sequence, nhưng vẫn **NOT TESTED trên target** vì chưa đo
mọi blocking call, jitter/WCET/watchdog/IOP gap và 10.000 chu kỳ mỗi period.
`SOM-T-005` có host component PASS cho RETAIN v2/cold-init/atomic/checkpoint tại
`3ca5d22`, nhưng power-cut/boot trên Forlinx và `VS-PROG-029/030`
vẫn `NOT RUN`.

Deploy dark coordinator → read-only capability/status → stage-only → shadow
execute/no publish → one-controller canary → expand. Rollback via Restore/cutover,
không kill/replace file. Downgrade chỉ sau compatible LKG active; preserve journal/
RETAIN/artifact/audit.

## 18. Interface class và thread handoff

```cpp
struct StageRequest { OperationId op; ArtifactLocator file; Sha256 hash; TargetProfile profile; };
struct StageResult  { StageToken token; ArtifactSummary summary; ProgramError error; };
struct ActivateRequest { OperationId op; StageToken token; ActiveExpectation expected; TransitionPlan plan; };
struct RuntimeSnapshot { Generation gen; ActiveIdentity active; TaskHealth task; IopHealth iop; };
```

Tên C++ cuối cùng có thể đổi theo convention, nhưng ownership và value semantics
không đổi: IPC thread decode vào bounded value; staging worker verify/build
`CandidateHandle`; coordinator giữ token/journal; ScanLoop chỉ nhận prevalidated
pending handle và phát `ActivationResult` qua bounded mailbox.

| Producer → consumer | Cơ chế | Backpressure/overflow |
|---|---|---|
| IPC → coordinator | bounded command queue, one operation/controller | reject busy; không block IPC vô hạn |
| coordinator → staging | worker queue | return resource unavailable + audit |
| staging → ScanLoop | single pending slot/token | conflict nếu pending khác; không overwrite |
| ScanLoop → publisher | immutable runtime snapshot ring | drop intermediate + counter; latest retrievable |
| ScanLoop → retain worker | dirty generation queue | coalesce theo generation; fault nếu safety retention policy không đạt |

Thread priority theo thứ tự Safety/IOP > ScanLoop > IPC/coordinator > staging/
retain/trace. Exact policy/CPU affinity đo trên target rồi phê duyệt; không dùng
`sleep`/mutex chung làm synchronization cho safe swap.

## 19. Blocker, lịch sử và phê duyệt

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| Target semantics/ABI/RETAIN/cutover | Product + Architect + Controls | **Đã mở implementation** theo `AUTH-PROG-2026-08-11-03`; acceptance target vẫn độc lập |
| Coordinator/IPC/cutover chưa implement | Core + BE Lead | `TASK-PROG-403..404` + integration |
| Timing/HIL/power-loss chưa có evidence | Core + MCU + QA | target results approved |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Runtime profile/scheduler/loader/process image/retain/test baseline |
| 0.2 | 2026-08-09 | Bổ sung class/function/buffer, RT phases, concurrency, fault, source/deploy/test M3 |
| 0.3 | 2026-08-09 | Bổ sung value-interface, thread/mailbox ownership, backpressure và priority handoff; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; nhấn mạnh host test không chứng minh runtime |
| 0.5 | 2026-08-11 | Đồng bộ `TASK-PROG-300` tại `4f7e0ac`: prepared runtime image ngoài RT, safe-boundary handle/LKG swap không cấp phát, retired cleanup ngoài scan và post-link no-parser/compiler gate; giữ production bootstrap/target NOT TESTED |
| 0.6 | 2026-08-11 | Đồng bộ `TASK-PROG-301` tại `a831a0d`: scheduler profile Rev A 1/1/1, period 1/5/30 s, budget `<20%`, `on_base_step()`/sequence/missed release, capability/schema và watchdog ADR-028; targeted 74/74, CTest 936/936; giữ production/target NOT TESTED |
| 0.7 | 2026-08-13 | Đồng bộ P3 `300..307`, P4 `400..402`; mô tả As-Built PROGRAM_ONLY bootstrap và RETAIN v2 stable identity/layout/CRC/atomic/cold-init/async checkpoint; giữ default GRAPH, flag OFF, coordinator/cutover và target/HIL NOT TESTED. |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Core Lead | **P3 SOURCE/HOST DONE; TASK-PROG-400..402 SOURCE/HOST DONE** | commits Plan 53; `3ca5d22` |
| Controls + Safety + BE + QA | **WAIVED FOR IMPLEMENTATION; review/test độc lập còn mở** | `AUTH-PROG-2026-08-11-03` |
| Runtime Architect + System Architect | **APPROVED FOR IMPLEMENTATION** | `AUTH-PROG-2026-08-11-03`; target/HIL không được suy thành PASS |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §19 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §2 phân lớp runtime; §3 runtime profile Rev A |
| `DD-03` As-Built | PASS | §1 dẫn `apps/core/application/st/`, explicit GRAPH/PROGRAM bootstrap, RETAIN wiring và nêu đúng khoảng hở UDS/coordinator/target |
| `DD-04` Target ownership | PASS | §2 phân lớp; §12 class/function/buffer target; §18 lớp giao diện và bàn giao giữa luồng |
| `DD-05` Data từng field | PASS | §6 process image và Point binding; §8 RETAIN; §12 buffer |
| `DD-06` Interface | PASS | §5 loader và activation; §18 hợp đồng interface class; hợp đồng liên tiến trình ở `IFSPEC-PROG-001` §8 |
| `DD-07` State/algorithm/timing | PASS | §4 base step và scheduler; §13 thuật toán RT tích hợp ScanLoop; §14 luồng, độ ưu tiên và ngân sách thời gian |
| `DD-08` Operation flow | N/A tại file này | Không có mặt người dùng; thủ tục vận hành ở `OPS-PROG-001` |
| `DD-09` Error/safety/security | PASS | §7 arbitration/PID/hold-last; §15 chèn lỗi và khả năng quan sát; §9 trace và chẩn đoán |
| `DD-10` Repository mapping | PASS | §12 và §16 — file, build, package và config cần sửa |
| `DD-11` Verification | PASS | §11 và §17 gắn `VS-PROG-009/012/014/027`, yêu cầu chạy **trên board** |
| `DD-12` Compatibility/deploy/rollback | PASS | §17 deployment và rollback; §10 cutover/bootstrap/config |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation; release BLOCKED | `AUTH-PROG-2026-08-11-03` đã mở source. Owner target: Runtime/Controls/Safety/Ops/QA; không giảm `RSK-PROG-002/003/009`; gate G4/G6 mở khi `403..405` và Test Result board/HIL độc lập hoàn tất |

**Host test đã pass không chứng minh runtime đã hoạt động trên board.** Luồng
Commission coordinator/cutover và bằng chứng target vẫn `NOT IMPLEMENTED/NOT TESTED`.
