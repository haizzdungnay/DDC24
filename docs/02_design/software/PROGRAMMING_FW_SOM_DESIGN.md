# Thiết kế FW-SOM Programming Runtime MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-FWSOM-PROG-001` |
| Phiên bản | 1.1 |
| Trạng thái | **M3 AS-BUILT CẬP NHẬT — POU nhiều chương trình, Signal Bus và whole-set atomic đang ở cây làm việc; target MCU FAKE/soak/formal VVP chưa chạy** |
| Ngày | 2026-08-24 |
| Chủ quản | Core/Runtime Lead |
| Người review | Controls Lead, Safety Lead, Backend Lead, Verification Lead |
| Người phê duyệt | Runtime Architect + System Architect |
| Nguồn | `DDD-LANG-PROG-001`, `IFSPEC-ART-PROG-001`, `DDD-CTRL-PROG-001`, `DDD-LIFE-PROG-001` |
| Requirement | `SWR-REQ-PROG-CORE-101..116` |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và target evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **`mkddc-core` chạy Program như thế nào trên SOM**: phân lớp runtime, base step và scheduler, loader/activation, process image, arbitration, RETAIN, trace, và ngân sách luồng/thời gian. |
| 2. Ai phải đọc file này? | Core/FW-SOM Lead (chủ quản); Controls đối chiếu với [Control Semantics](PROGRAMMING_CONTROL_SEMANTICS.md); BE đọc §5 để biết bàn giao artifact; QA đọc §11 và §17. |
| 3. Hệ thống hiện tại đang có gì? | Ngoài baseline P3/P4 và Task 509, cây làm việc Plan 59 đã có `StPreparedProgramSet`, POU `PROGRAM/FUNCTION/FUNCTION_BLOCK`, `StSignalBus`, Signal Read/Publish và handoff whole-set tại safe boundary. Gate Core bị ảnh hưởng `90/90` và verifier `10/10` PASS là **engineering evidence trên host**, chưa phải Test Result chính thức hay target. |
| 4. Thiết kế mới thay đổi điều gì? | Stage dựng toàn bộ program set và signal bank ngoài live path; fsync journal `PREPARED` trước mọi mutation; safe boundary đổi scheduler set rồi signal bank trong cùng transition. Identity/candidate chỉ đổi sau khi cả hai thành công; nếu signal swap lỗi thì scheduler được khôi phục ngay tại cùng boundary. |
| 5. Team phải sửa module/contract nào? | `application/st/st_{pou_registry,scheduler,signal_bus,runtime_snapshot,loader,package_v2}.*`, `application/programming/programming_runtime_coordinator.*`, `application/runtime/scan_loop.cpp`, Programming IPC và package/compiler CLI. |
| 6. Điều gì còn bị chặn? | Cần merge đúng commit, triển khai/read-back trên Forlinx với `MCU_MODE=FAKE`, soak liên tục đủ 24 giờ và formal VVP. CI là `SKIPPED_BY_OWNER`; HIL/MCU vật lý là `DEFERRED_NO_HARDWARE`; cả hai không phải PASS. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Gate Core hiện tại: focused FBD/signal `37/37`, affected Core `90/90`, verifier self-test `10/10` PASS. Chỉ được đóng `TARGET_FAKE_MCU_DEPLOY` bằng manifest/checksum/service/API/runtime read-back trên board và đóng `TARGET_FAKE_MCU_SOAK` sau đủ 24 giờ; formal VVP vẫn `NOT_RUN`. |

Điểm dễ hiểu sai nhất: **PROGRAM_ONLY và RETAIN đã chạy happy path trên board lab
không đồng nghĩa được phép release production**. Cờ Programming đang ON trên
Foxlinx lab và BE coordinator/UDS/cutover đã có supporting evidence, nhưng chưa
có Test Result độc lập, output vật lý/HIL/power-fault hoặc residual acceptance.

## 1. Baseline thật

Source hiện có parser/semantic, typed IR/artifact/loader, scheduler, cyclic
runtime, I/O mapping, arbitration, RETAIN, trace và host tests tại
`apps/core/application/st/`. Bootstrap hỗ trợ explicit `--programming-mode` và
chỉ dựng scheduler/retain service trong PROGRAM_ONLY; không có dual producer.
Default GRAPH và feature flag OFF nghĩa là chưa có luồng Commission user
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

## 3. Runtime profile Plan 59

| Thuộc tính | Giá trị proposal | Ghi chú |
|---|---:|---|
| Program active | tối đa 16 | một `StPreparedProgramSet` được kiểm đủ trước handoff |
| Task | tối đa 16 | ba period chuẩn 1000/5000/30000 ms; không đồng nghĩa 16 task mỗi period |
| Period | 1000/5000/30000 ms | dispatch cadence, không base step sleep |
| IR đơn | `MKDDCIR1`, schema 1 | compiler provenance `fwsom-st-1.2.0` |
| Package | `MKDDCIR2`, schema/layout 2, <=16 MiB | tối đa 32 section; offset/length/CRC/SHA được kiểm bounded |
| Program source | <=64 KiB | chờ OD-PROG-003 |
| FBD | <=256 block/512 connection | chờ OD-PROG-003/006 |
| Binding | <=256/Program | Point Catalog/ABI sizing phải review |
| RETAIN | <=128 biến/FB, <=4096 byte/Program | profile/compiler/loader enforce; target endurance còn phải đo |

Runtime phải đọc profile từ artifact/capability version; không expose generic
supporting limits làm Product capability. Mỗi Program có queue/output staging riêng;
không dùng một queue chung để một Program lỗi làm mất proposal của Program khác.

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

1. `ProgrammingRuntimeCoordinator::stage_impl()` đọc package, verify toàn bộ
   POU/library/signal manifest rồi dựng `StPreparedProgramSet` và prepared signal
   bank ngoài live path; chưa được sửa scheduler, signal bus hay active identity.
2. Ghi và `fsync` journal `PREPARED` cùng immutable candidate descriptor. Mọi lỗi
   trước mốc này phải để live topology, signal state, candidate và identity bất biến.
3. Tại safe boundary, kiểm expected active/cutover/IO freshness/transition plan.
4. Gọi `StScheduler::swap_prepared_program_set_at_boundary()` để đổi nguyên set,
   sau đó `StSignalBus::activate_prepared_replacement_at_boundary()` trong cùng
   transition; scan không được quan sát topology mới với signal bank cũ.
5. Nếu signal activation lỗi, khôi phục scheduler set cũ ngay tại cùng boundary,
   giữ active/LKG/identity cũ, journal lỗi và không publish output từng phần.
6. Chỉ sau khi cả hai swap thành công mới commit candidate/identity/generation;
   first cycle vẫn publish proposal all-or-nothing qua resolver.
7. Power/process fault phải phục hồi xác định từ journal; không suy thành PASS
   cho tới khi có power-cut evidence trên target.

## 6. Process image và Point binding

Input slot chứa value typed, quality, producer timestamp và Point identity.
Missing/bad/stale không thành zero; execution dùng quality policy/fallback được
Check phê duyệt. Output slot chứa `program_value` và binding metadata; bridge
không ghi thẳng physical.

Signal nội bộ dùng stable identity trong `SIGNAL_DEFS` và reference ở section IR
`SEC_SIGNAL_REFS=0x0009`. `SIGNAL_READ` (`0x71`) trả typed value kèm validity;
signal chưa có producer, producer fault hoặc stale phải là invalid/unavailable,
không được materialize thành `0`. `SIGNAL_PUBLISH` (`0x72`) ghi vào private
staging bank của Program và chỉ hiện cho consumer ở snapshot/boundary kế tiếp.
Mỗi base step đóng băng một signal snapshot để kết quả không phụ thuộc execution
order; duplicate producer/type mismatch/cycle bị Check hoặc loader reject.

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

As-Built Task 509: `PriorityResolver` cho phép đọc riêng giá trị AO/DO tại một
mức priority; `ScanLoop::step()` chụp proposal mức 5 **sau Program tick và sau
arbitration**, cùng actual/winner/effective priority vào `RuntimePointSnapshot`.
Snapshot thêm task ID/period/budget/state/run/missed-release/exec/overrun từ Task
ST đầu tiên của profile Rev A. TTL/actor/freshness ngoài resolver được BE join từ
override/Point metadata. Không claim bumpless trước HIL AO/DO + PID/override/release.

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
| `ProgrammingRuntimeCoordinator` | `stage_impl`, `request_activate`, `restore`, `status`, `on_safe_boundary` | prepared whole-set candidate, operation state, journal generation |
| `StArtifactLoader` | verify/decode into candidate | non-RT temporary bounded builder |
| `StPreparedProgramSet` | immutable handoff của toàn bộ Program/Task/POU đã verify | preallocated runtimes, topology và previous set handle để rollback |
| `StSignalBus` | prepare/activate replacement, frozen snapshot, publish staging | active/prepared signal bank, type/producer table, generation |
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
  graph_or_program_owner.apply_pending_transition_at_safe_boundary()
    // whole program set then matching signal bank; rollback both-or-none
  const signal_snapshot = signal_bus.freeze_active_generation()
  if programming.due(now):
      result = programming.run(snapshot, signal_snapshot, fixed_budget)
      if result.ok: priority_resolver.publish_batch(result.proposals, generation)
      else: programming.discard_batch_and_update_fault(result)
  signal_bus.commit_published_generation_at_boundary()
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
| lỗi bất kỳ trước journal `PREPARED` | scheduler topology, signal bank, active/LKG/candidate/identity giữ nguyên byte-for-byte |
| scheduler swap thành công, signal bank swap lỗi | scheduler rollback set cũ ngay cùng boundary; không lộ topology/signal generation hỗn hợp |
| POU manifest/library lock/signal ref sai | stage reject ổn định; không sửa live registry hoặc signal state |
| executor div0/budget/non-finite | staging discarded, Task fault, safety/IOP continue |
| RETAIN CRC/layout/identity/size fail | cold-init explicit; active code vẫn start, không partial restore |
| RETAIN fsync/rename fail | giữ record cũ; tăng write failure, scan không block |
| IPC duplicate/drop/deadline | same op status or unknown reconcile; no double swap |
| power loss each journal phase | deterministic old/LKG/committed active |
| trace consumer slow | drop trace + counter, never scan block |

## 16. Build/package/config mapping

| File/build target | Change |
|---|---|
| `apps/core/CMakeLists.txt` | link executor/loader/lifecycle/signal bus; post-link assert no parser/compiler symbol in `mkddc-core` |
| `apps/core/bootstrap/main.cpp` | explicit GRAPH/PROGRAM; fixed scheduler topology, retain service, coordinator và Programming UDS tại `10d9ad6` |
| `apps/core/application/runtime/scan_loop.*` | phase hook + timing metric; no ownership policy duplication |
| `apps/core/application/st/st_pou_registry.*` | POU identity, FUNCTION purity/call frame, FUNCTION_BLOCK instance layout |
| `apps/core/application/st/st_scheduler.*` | prepare và whole-set safe-boundary swap/restore |
| `apps/core/application/st/st_signal_bus.*` | typed signal definition, snapshot, publish/activate bank |
| `apps/core/application/st/st_package_v2.*` | `MKDDCIR2` schema/layout 2 và section `0x0001..0x000C` |
| `apps/core/application/st/st_runtime_snapshot.*` | snapshot/restore state phục vụ rollback atomic |
| `contracts/ipc/programming_v1` | generated/handwritten bounded schema and compatibility tests |
| `contracts/config/` | replace/retire standalone base64 control schema by migration |
| `platform/packaging/` | state/staging/retain/journal dirs, owner/mode, service limits |

Config unknown major fails startup Programming while legacy safe owner remains;
không default PROGRAM. Partial deploy disables mutation/capability rather than
accepting unsupported artifact.

As-Built Task 300/301: `apps/core/CMakeLists.txt` đã đăng ký hai CTest hậu liên kết
cho `core_application` và `mkddc-core` bằng
`scripts/verify_programming_runtime_symbols.py`; `st_program_control_v1` đã trả
profile/capacity/period/base step; Programming IPC trả operation/active/LKG/override
authoritative. Cutover source đã wire; target evidence vẫn mở.

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
| `SOM-T-008` | host atomic fault matrix | mọi lỗi trước `PREPARED` zero-mutation; scheduler/signal rollback both-or-none |
| `SOM-T-009` | host POU/signal | multi-Program, FUNCTION purity, FB instance state, duplicate/type/stale/unavailable signal |
| `SOM-T-010` | Forlinx MCU FAKE deploy/read-back | exact artifact/config checksum, service health, runtime/API/FE producer→consumer truth |
| `SOM-T-011` | Forlinx MCU FAKE soak 24 h | đủ thời lượng, raw sample liên tục, restart/error/IOP-gap counters trong limit |

`SOM-T-002` hiện **PARTIAL HOST PASS** cho allocation/symbol boundary tại
`4f7e0ac`. `SOM-T-004` có host precheck profile/cadence tại `a831a0d`: Task 30 s
không chặn base-step sequence, nhưng vẫn **NOT TESTED trên target** vì chưa đo
mọi blocking call, jitter/WCET/watchdog/IOP gap và 10.000 chu kỳ mỗi period.
`SOM-T-005` có host component PASS cho RETAIN v2/cold-init/atomic/checkpoint tại
`3ca5d22`, nhưng power-cut/boot trên Forlinx và `VS-PROG-029/030`
vẫn `NOT RUN`.

Tại cây làm việc 2026-08-24, focused FBD/signal `37/37`, affected Core `90/90`
và verifier self-test `10/10` PASS. Đây là bằng chứng kỹ thuật cho
`IMPLEMENTATION_CLOSE`, không thay `SOM-T-010/011`, formal VVP hay target Test
Result. `SOM-T-010` và `SOM-T-011` đang `NOT_RUN`; HIL/MCU vật lý
`DEFERRED_NO_HARDWARE`; CI `SKIPPED_BY_OWNER`.

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
| Whole-set POU/signal atomic chỉ có host engineering evidence | Core + BE Lead + QA | merge exact commit; Forlinx MCU FAKE deploy/read-back có checksum và raw output |
| Soak 24 giờ chưa chạy | Runtime + QA + Ops | liên tục đủ 24 giờ; lưu raw samples/hash, restart/error/IOP-gap và kết luận độc lập |
| Timing/HIL/power-loss chưa có evidence | Core + MCU + QA | `DEFERRED_NO_HARDWARE`; chạy lại khi có MCU/HIL vật lý, không suy từ MCU FAKE |
| Formal VVP chưa chạy; CI không có ngân sách | Verification Lead + Owner | VVP `NOT_RUN`; CI `SKIPPED_BY_OWNER` và không được ghi PASS |
| Positive snapshot target có Variable Binding | Core + BE + QA | fixture read-only an toàn có binding; đối chiếu program/actual/owner/priority/task qua Web API, lưu raw output |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Runtime profile/scheduler/loader/process image/retain/test baseline |
| 0.2 | 2026-08-09 | Bổ sung class/function/buffer, RT phases, concurrency, fault, source/deploy/test M3 |
| 0.3 | 2026-08-09 | Bổ sung value-interface, thread/mailbox ownership, backpressure và priority handoff; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; nhấn mạnh host test không chứng minh runtime |
| 0.5 | 2026-08-11 | Đồng bộ `TASK-PROG-300` tại `4f7e0ac`: prepared runtime image ngoài RT, safe-boundary handle/LKG swap không cấp phát, retired cleanup ngoài scan và post-link no-parser/compiler gate; giữ production bootstrap/target NOT TESTED |
| 0.6 | 2026-08-11 | Đồng bộ `TASK-PROG-301` tại `a831a0d`: scheduler profile Rev A 1/1/1, period 1/5/30 s, budget `<20%`, `on_base_step()`/sequence/missed release, capability/schema và watchdog ADR-028; targeted 74/74, CTest 936/936; giữ production/target NOT TESTED |
| 0.7 | 2026-08-13 | Đồng bộ P3 `300..307`, P4 `400..402`; mô tả As-Built PROGRAM_ONLY bootstrap và RETAIN v2 stable identity/layout/CRC/atomic/cold-init/async checkpoint; giữ default GRAPH, flag OFF, coordinator/cutover và target/HIL NOT TESTED. |
| 0.8 | 2026-08-13 | Đồng bộ `TASK-PROG-403..405` tại `c2f3189` + `10d9ad6`: coordinator/SQLite v5, bounded UDS `SO_PEERCRED`, safe-boundary exclusive cutover, first-output/LKG, rollback và CRC checkpoint recovery. Host fault/restart gates PASS; giữ default GRAPH, flag OFF và target/HIL/power-cut NOT TESTED. |
| 0.9 | 2026-08-13 | `TASK-PROG-509`: mở rộng `RuntimePointSnapshot`/serializer với program proposal mức 5, effective priority và task metric; `PriorityResolver` thêm accessor read-only; `ScanLoop` publish end-scan truth. Targeted host 41/41 PASS; source mới chưa deploy/read-back Foxlinx và không nâng HIL/Test Result. |
| 1.0 | 2026-08-13 | `EV-PROG-P5-510`: full CTest 1004/1004; cross-build/deploy Core ARM64 đúng hash, Runtime/Active/Task và Monitor target read-back, rollback rehearsal/tái deploy PASS. Fixture active không binding nên positive program/actual row chưa chạy; source chưa merge, HIL/Test Result không đổi. |
| 1.1 | 2026-08-24 | Đồng bộ Plan 59 với `StPreparedProgramSet`, POU nhiều chương trình, `StSignalBus`, IR signal opcode `0x71/0x72`, package v2 và invariant zero-mutation/both-or-none; ghi rõ host gates không thay target MCU FAKE, soak 24 giờ, formal VVP hoặc HIL vật lý. |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Core Lead | **PLAN 59 IMPLEMENTATION_CLOSE PENDING** | current-worktree Core `90/90`, verifier `10/10`; còn merge/exact commit và affected full gate |
| Controls + Safety + BE + QA | **WAIVED FOR IMPLEMENTATION; review/test độc lập còn mở** | `AUTH-PROG-2026-08-11-03` |
| Runtime Architect + System Architect | **APPROVED FOR IMPLEMENTATION; RELEASE NO-GO** | target MCU FAKE/soak/VVP chưa chạy; HIL vật lý deferred |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §19 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §2 phân lớp runtime; §3 runtime profile Rev A |
| `DD-03` As-Built | PASS | §1, §3, §5 và §12 dẫn `apps/core/application/{st,programming}`, whole-set/Signal Bus, Programming UDS, RETAIN/cutover/recovery và nêu đúng khoảng hở target |
| `DD-04` Target ownership | PASS | §2 phân lớp; §12 class/function/buffer target; §18 lớp giao diện và bàn giao giữa luồng |
| `DD-05` Data từng field | PASS | §6 process image và Point binding; §8 RETAIN; §12 buffer |
| `DD-06` Interface | PASS | §5 loader và activation; §18 hợp đồng interface class; hợp đồng liên tiến trình ở `IFSPEC-PROG-001` §8 |
| `DD-07` State/algorithm/timing | PASS | §4 base step và scheduler; §13 thuật toán RT tích hợp ScanLoop; §14 luồng, độ ưu tiên và ngân sách thời gian |
| `DD-08` Operation flow | N/A tại file này | Không có mặt người dùng; thủ tục vận hành ở `OPS-PROG-001` |
| `DD-09` Error/safety/security | PASS | §7 arbitration/PID/hold-last; §15 chèn lỗi và khả năng quan sát; §9 trace và chẩn đoán |
| `DD-10` Repository mapping | PASS | §12 và §16 — file, build, package và config cần sửa |
| `DD-11` Verification | PASS | §11 và §17 tách host engineering, Forlinx MCU FAKE deploy, soak 24 giờ, formal VVP và HIL vật lý |
| `DD-12` Compatibility/deploy/rollback | PASS | §17 deployment và rollback; §10 cutover/bootstrap/config |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation; release BLOCKED | `AUTH-PROG-2026-08-11-03` đã mở source và P4 source/host đã đóng. Owner target: Runtime/Controls/Safety/Ops/QA; không giảm residual; G6 chỉ mở khi Test Result board/HIL độc lập hoàn tất |

**Host test không tự chứng minh runtime trên board.** Gate Plan 59 hiện tại chỉ
đủ làm input cho `IMPLEMENTATION_CLOSE`; không được nâng thành
`TARGET_FAKE_MCU_DEPLOY`, `TARGET_FAKE_MCU_SOAK`, formal VVP, HIL hoặc
`RELEASE_READY` nếu chưa có đúng loại bằng chứng.
