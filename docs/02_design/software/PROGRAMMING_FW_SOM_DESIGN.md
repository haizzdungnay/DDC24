# Thiết kế FW-SOM Programming Runtime MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-FWSOM-PROG-001` |
| Phiên bản | 0.4 |
| Trạng thái | **M3 — Review Ready** — DD-01..13 đủ; chưa có bằng chứng trên target |
| Ngày | 2026-08-09 |
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
| 3. Hệ thống hiện tại đang có gì? | Tại `apps/core/application/st/` đã có parser/semantic, typed IR/artifact/loader, scheduler, cyclic runtime, I/O mapping, RETAIN, trace và host test. Nhưng `ScanLoop` chỉ nhận `StScheduler*` như một dependency **tùy chọn**, và **bootstrap production không truyền scheduler vào** — nên graph vẫn là bên nạp và chạy. FBD production chưa có. |
| 4. Thiết kế mới thay đổi điều gì? | Biến các component rời rạc đó thành một runtime thật sự được nối vào: base step tách khỏi chu kỳ Task, loader chạy ngoài RT rồi bàn giao tại biên an toàn, process image đóng băng trong lúc Program chạy, output đi qua arbitration mức 5, RETAIN khôi phục trước lần chạy đầu. |
| 5. Team phải sửa module/contract nào? | §12, §13 và §16. Sửa `ScanLoop` để dispatch Task; thêm lớp giao diện và mailbox ở §18; cập nhật build/package/config ở §16. |
| 6. Điều gì còn bị chặn? | Ngân sách WCET và ngưỡng overrun chờ `OD-PROG-012`; chính sách RETAIN chờ `OD-PROG-009`; cutover chờ `OD-PROG-013`. Không có bằng chứng trên target thật. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §11 và §17: `VS-PROG-009` (10.000 chu kỳ mỗi period trên target), `VS-PROG-012` (RT path không cấp phát bộ nhớ, không filesystem/DB/HTTP/DNS/blocking, không nạp native động), `VS-PROG-014` (poll gap `<200 ms`), `VS-PROG-027` (soak trace). Tất cả cần chạy **trên board**, không phải trên host. |

Điểm dễ hiểu sai nhất: **host test đã pass không có nghĩa là runtime đã hoạt
động**. Các component ở `application/st/` là nền tảng, không phải tính năng
Programming đã hoàn tất — chừng nào bootstrap chưa cấp scheduler thì trên thiết
bị thật vẫn là graph đang chạy.

## 1. Baseline thật

Source hiện có parser/semantic, typed IR/artifact/loader, scheduler, cyclic
runtime, I/O mapping, RETAIN, trace và host tests tại
`apps/core/application/st/`. `ScanLoop` có dependency `StScheduler*` tùy chọn,
nhưng bootstrap production hiện không truyền scheduler; graph vẫn load/execute.
FBD production chưa có. Vì vậy các component này là nền tảng, không phải feature
Programming production hoàn tất.

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
| RETAIN | <=128 variable, <=4096 byte/Program | chờ OD-PROG-009 |

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

- Record per Program instance, magic/version/layout/artifact compatibility/CRC.
- Atomic temp→fsync→rename; rate-limit write, force khi shutdown sạch.
- Warm restore chỉ khi stable variable identity/type/layout compatible.
- Missing record = cold start bình thường; corrupt/mismatch = cold init +
  diagnostic/Commission acknowledgement khi biết trước.
- Không để RETAIN lỗi chặn core boot; không âm thầm đọc bytes layout cũ.
- Reset RETAIN là operation admin có safe-boundary/audit, không xóa file trực tiếp.

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
| `ProgramTaskRuntime` | `start/stop/tick/reset_fault` | Task state, next release, counters |
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

Base step đề xuất 50 ms; Task 1/5/30 s phase-locked. WCET/memory budget lấy
capability đã đo, warning 70% và overrun threshold theo Control Semantics. Compiler
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
| RETAIN CRC/layout/fsync fail | block/cold-init per plan; active record preserved |
| IPC duplicate/drop/deadline | same op status or unknown reconcile; no double swap |
| power loss each journal phase | deterministic old/LKG/committed active |
| trace consumer slow | drop trace + counter, never scan block |

## 16. Build/package/config mapping

| File/build target | Change |
|---|---|
| `apps/core/CMakeLists.txt` | link executor/loader/lifecycle only; CI assert no parser/compiler symbol in `mkddc-core` |
| `apps/core/bootstrap/main.cpp` | construct coordinator/scheduler from versioned config; explicit GRAPH/PROGRAM |
| `apps/core/application/runtime/scan_loop.*` | phase hook + timing metric; no ownership policy duplication |
| `contracts/ipc/programming_v1` | generated/handwritten bounded schema and compatibility tests |
| `contracts/config/` | replace/retire standalone base64 control schema by migration |
| `platform/packaging/` | state/staging/retain/journal dirs, owner/mode, service limits |

Config unknown major fails startup Programming while legacy safe owner remains;
không default PROGRAM. Partial deploy disables mutation/capability rather than
accepting unsupported artifact.

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
| Target semantics/ABI/RETAIN/cutover chưa Approved | Product + Architect + Controls | sign-off R2 |
| Coordinator/bootstrap/IPC chưa implement | Core Lead | Plan 53 code + integration |
| Timing/HIL/power-loss chưa có evidence | Core + MCU + QA | target results approved |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Runtime profile/scheduler/loader/process image/retain/test baseline |
| 0.2 | 2026-08-09 | Bổ sung class/function/buffer, RT phases, concurrency, fault, source/deploy/test M3 |
| 0.3 | 2026-08-09 | Bổ sung value-interface, thread/mailbox ownership, backpressure và priority handoff; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; nhấn mạnh host test không chứng minh runtime |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Core + Controls + Safety + BE + QA | Chờ review | — |
| Runtime Architect + System Architect | **BLOCKED — chưa phê duyệt** | decision và target/HIL evidence |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §19 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §2 phân lớp runtime; §3 runtime profile Rev A |
| `DD-03` As-Built | PASS | §1 dẫn `apps/core/application/st/` và nêu đúng điểm mấu chốt: `ScanLoop` nhận `StScheduler*` **tùy chọn** và **bootstrap production không truyền scheduler**, nên graph vẫn chạy; FBD production chưa có |
| `DD-04` Target ownership | PASS | §2 phân lớp; §12 class/function/buffer target; §18 lớp giao diện và bàn giao giữa luồng |
| `DD-05` Data từng field | PASS | §6 process image và Point binding; §8 RETAIN; §12 buffer |
| `DD-06` Interface | PASS | §5 loader và activation; §18 hợp đồng interface class; hợp đồng liên tiến trình ở `IFSPEC-PROG-001` §8 |
| `DD-07` State/algorithm/timing | PASS | §4 base step và scheduler; §13 thuật toán RT tích hợp ScanLoop; §14 luồng, độ ưu tiên và ngân sách thời gian |
| `DD-08` Operation flow | N/A tại file này | Không có mặt người dùng; thủ tục vận hành ở `OPS-PROG-001` |
| `DD-09` Error/safety/security | PASS | §7 arbitration/PID/hold-last; §15 chèn lỗi và khả năng quan sát; §9 trace và chẩn đoán |
| `DD-10` Repository mapping | PASS | §12 và §16 — file, build, package và config cần sửa |
| `DD-11` Verification | PASS | §11 và §17 gắn `VS-PROG-009/012/014/027`, yêu cầu chạy **trên board** |
| `DD-12` Compatibility/deploy/rollback | PASS | §17 deployment và rollback; §10 cutover/bootstrap/config |
| `DD-13` Trace/risk/decision/sign-off | **BLOCKED** | Owner: Runtime Architect, Controls/Safety, Ops, QA. Ảnh hưởng: chưa chốt ngân sách WCET (`OD-PROG-012`), RETAIN (`OD-PROG-009`) và cutover (`OD-PROG-013`) thì **không nối scheduler vào bootstrap production được**; `RSK-PROG-002` (20 điểm) và `RSK-PROG-003` (20 điểm) không giảm. Gate: `DOC-G3`. Điều kiện mở: ký ba decision, rồi chạy bốn scenario ở `DD-11` trên board thật |

Một `BLOCKED`, đủ bốn trường. **Host test đã pass không chứng minh runtime đã
hoạt động.** Wiring production và bằng chứng trên target vẫn
`NOT IMPLEMENTED/NOT TESTED`.
