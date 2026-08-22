# Thiết kế ngữ nghĩa điều khiển Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDD-CTRL-PROG-001` |
| Phiên bản | 1.1 |
| Trạng thái | **M3 — APPROVED FOR IMPLEMENTATION; P3/P4 source/host DONE; target timing và Safety review còn mở** |
| Ngày | 2026-08-21 |
| Chủ quản | Controls Lead + Core Lead |
| Người review | Safety Lead, FW MCU Lead, Verification Lead |
| Người phê duyệt | System Architect + Product Owner |
| Nguồn | Product Spec v2.2, `SRS-PROG-001`, ADR-020/023/026..029/051 (`Accepted`), `PROG-OD-001` |
| Phạm vi | Target Rev A: một Task, 1/5/30 s, process image, priority 5, fault semantics |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Định nghĩa **một vòng điều khiển chạy như thế nào**: đọc input lúc nào, chạy Task khi nào, ghi output ra sao, ai thắng khi nhiều nguồn cùng đòi một output, PID xử lý bão hòa thế nào, và chuyện gì xảy ra khi một vòng chạy quá giờ. Đây là hồ sơ **an toàn** quan trọng nhất của bộ. |
| 2. Ai phải đọc file này? | Controls và Core (chủ quản); Safety reviewer **bắt buộc** ký; QA dựng ca HIL từ §13 và §14; FE đọc §6 để hiển thị đúng ai đang giữ output. |
| 3. Hệ thống hiện tại đang có gì? | P3 đã có profile/process image/PID/overrun/trace/bootstrap/soak; P4 giữ hold-last và thêm `ProgrammingCutover` + `ProgrammingRuntimeCoordinator` tại `10d9ad6`: chỉ một owner GRAPH/PROGRAM, cutover ở safe boundary, candidate chỉ thành LKG sau output commit đầu tiên, lỗi cycle đầu quay về prior LKG/graph. |
| 4. Thiết kế mới thay đổi điều gì? | Thu về **đúng một Task**, chu kỳ chỉ `1000/5000/30000 ms`. Quan trọng nhất: Task 30 s là **nhịp điều độ**, không phải `sleep` của base step — base step vẫn phải chạy đủ nhanh để IOP không đứt. Và: lỗi một Task chỉ làm **Task đó** FAULT; chỉ SafetyManager mới được đưa cả trạm về safe-state. |
| 5. Team phải sửa module/contract nào? | §12. Core sửa ScanLoop để dispatch Task đến hạn, staging output rồi commit một lần; `PriorityResolver` nhận `program_value` ở mức Local logic 5; RETAIN khôi phục **trước** lần chạy đầu và ghi ngoài đường tới hạn. |
| 6. Điều gì còn bị chặn? | Không còn blocker code P3/P4. Benchmark/timing/watchdog/IOP/power-loss trên Forlinx/HIL và Safety review hậu kiểm vẫn chặn release/cutover thực. Value-sampling trace historian thuộc P5/P6. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Fresh CTest 1002/1002 PASS gồm exclusive owner, first-output commit, rollback/recovery và fault cases; đây chỉ hỗ trợ các scenario liên quan ở mức host. §13 vẫn yêu cầu target/HIL và poll gap `<200 ms`; 0/32 Test Result PASS. |

Hai cái bẫy đã thành rủi ro có tên. `RSK-PROG-002` (điểm 20): nếu gắn `sleep`
theo chu kỳ Task, Task 30 s sẽ kéo cả base step và watchdog 6 s sẽ restart vòng
lặp. `RSK-PROG-004` (điểm 15): khi output đang bị override ở mức 1–4, PID **không
được** lấy `actual_value` đó làm giá trị trước của mình — phải đóng băng bộ tích
phân, nếu không lúc nhả override output sẽ giật.

Ghi chú thẩm quyền: `PROGRAM_TASK_SCHEDULER_SPEC...` chỉ mô tả cái đang có. Các
phần multi-task, safe-state toàn trạm và watchdog theo chu kỳ Task trong file đó
**đã bị hồ sơ này supersede**.

## 1. Mục tiêu và nguyên tắc an toàn

Hồ sơ này định nghĩa thứ tự scan, clock, Task cadence, snapshot input, staging
output, arbitration priority 5, PID/anti-windup, hold-last, overrun và transition.
Mục tiêu là dev Core/Controls cài cùng một behavior, QA đo được và Ops giải thích
được output authority.

Programming không phải SafetyManager. Task fault không tự ra lệnh plant-wide
safe-state; chỉ cô lập output của Task theo policy bên dưới. SafetyManager/
watchdog độc lập vẫn có quyền cao hơn và có thể đưa thiết bị về safe output.

## 2. As-Built và conflict cần loại bỏ

| Chủ đề | As-Built 2026-08-09 | Target |
|---|---|---|
| Runtime owner | `TASK-PROG-404` (`10d9ad6`): `ProgrammingCutover` chọn `GRAPH_ONLY`/`PROGRAM_ONLY`, apply transaction tại safe boundary và rollback first-cycle fault | đã đạt source/host; target/HIL chưa kiểm chứng |
| Scheduler | `StSchedulerProfile::SUPPORTING_AS_BUILT` giữ trần 8/16/32; `REV_A` tại `a831a0d`, dựng thật trong bootstrap khi `PROGRAM_ONLY` (Task 306) | đã đạt |
| Base step | `ScanLoop` gọi `on_base_step()` và trả sequence/missed release; bootstrap dựng `st_sched` không nullptr khi `PROGRAM_ONLY` | đã đạt |
| I/O | `st_process_image.*` load/apply với `PriorityResolver` | snapshot → execute → validate → atomic publish priority 5 |
| Fault | `StScheduler` không có tham chiếu `SafeState` — Task FAULT không plant-wide (Task 304); `any_force_safe()` là status thuần đọc | đã đạt |
| RETAIN | component có, chưa production-wired | restore trước first run, save ngoài critical path — còn mở |

`PROGRAM_TASK_SCHEDULER_SPEC...` là supporting As-Built. Các phần multi-task,
plant-wide safe và watchdog theo period Task bị hồ sơ Target này supersede.

## 3. Clock, base step và Task cadence

- Clock scheduling: monotonic (`CLOCK_MONOTONIC_RAW` hoặc authority platform),
  không dùng wall clock/NTP.
- Base step Rev A mặc định `1.000 ms`, dải cấu hình nền tảng `500..2.000 ms`
  theo ADR-027. Giới hạn IOP `<200 ms` áp cho khoảng phục vụ/poll IOP bên trong
  step, không đồng nhất với Task period hoặc tự suy thành base step 50 ms.
  ScanLoop hoàn tất mỗi base step và kick watchdog dù Task period là 30 s.
- Task period chỉ một trong `1.000/5.000/30.000 ms`; change period có hiệu lực
  qua new Revision activation, không mutate runtime lẻ.
- Deadline kế tiếp dùng phase-locked `next += period`; không `now + period` để
  tránh drift. Bị trễ không chạy catch-up nhiều lần.

```text
on_base_step(now):
  poll_iop_and_update_point_quality(now)
  service_independent_safety_and_watchdog(now)
  apply_pending_cutover_if_safe_boundary()
  if program_task_active and now >= next_release:
      lateness = now - next_release
      next_release += period
      if now >= next_release: record skipped_releases; next_release = align_future(now)
      run_one_program_cycle(snapshot_time=now)
  publish_health_and_trace_bounded()
```

Watchdog heartbeat phát theo base step/IOP service budget, không chờ Task 30 s.
Task period không được dùng làm watchdog timeout. IOP continuity acceptance tại
199/200/201 ms thuộc MCU/HIL/V&V.

## 4. Một cycle và ownership dữ liệu

```text
1. INPUT_SNAPSHOT: copy value + quality + observedAt + source + generation
2. MAP_VALIDATE: reject required binding stale/bad/type/identity
3. EXECUTE: programs theo immutable programOrder, dùng snapshot duy nhất
4. OUTPUT_VALIDATE: finite/range/rate/safety/binding/authority checks
5. ARBITRATE: đề xuất Local Program ở priority 5
6. PUBLISH_ATOMIC: commit toàn bộ proposal hợp lệ cùng generation
7. RETAIN_DIRTY + TRACE: enqueue bounded record ngoài publish critical path
```

Không program nào đọc output phần của program trước trong cùng cycle qua Point
Table; giao tiếp nội bộ phải qua variable/FB đã compiler order. Input đổi giữa
cycle chỉ có hiệu lực cycle sau. Output publish all-or-nothing ở mức Task; fault
bất kỳ Program hủy toàn bộ staging của cycle.

## 5. Point mapping, quality và freshness

| Binding | Read/write | Điều kiện |
|---|---|---|
| UI/DI/AV/BV/MSV input | read snapshot | identity/type/direction khớp; quality policy |
| AO/DO/AV/BV/MSV output | publish proposal | Point writable, range/unit/rate valid |
| physical point | qua Point Table/IOP | không direct address, không bypass arbitration |
| remote/network point | chỉ khi profile duyệt | freshness/quality/source rõ; timeout không thay zero |

`GOOD` dùng bình thường. `STALE/BAD/UNKNOWN/OFFLINE` không được chuyển thành 0.
Mỗi binding khai policy `REQUIRED` hoặc `OPTIONAL_WITH_FALLBACK`; fallback phải là
giá trị typed/versioned trong Revision và sinh warning/alarm. Required bad quality
gây cycle fault và hold-last; mất liên tục quá threshold gây Task FAULT.

## 6. Arbitration priority 5 và hold-last

Programming publish đúng Local logic priority `5`; không giả danh manual, safety
hoặc network priority. `PriorityResolver` là owner duy nhất của present value.
Runtime ghi proposal gồm value, source=`PROGRAM`, revision, cycle generation,
quality, observedAt. UI hiển thị winner và lý do program bị override.

Hold-last là giữ proposal Local Program **đã publish thành công gần nhất**, không
ghi lại physical output và không chiếm quyền của source ưu tiên cao hơn. Khi:

- một cycle fault: không publish proposal mới; proposal cũ giữ tối đa `holdTtl`;
- Task STOPPED/DISABLED/cutover khỏi PROGRAM: withdraw proposal ở safe boundary;
- `holdTtl` hết: withdraw; downstream resolver/safety policy quyết định output;
- manual/safety override active: program vẫn có thể tính/monitor, proposal bị
  che; anti-windup nhận actual selected output, không assumed proposal.

`holdTtl` = **60 s** kể từ lần publish thành công gần nhất (`ADR-051`, ký
2026-08-21). Không còn `TARGET-PENDING`, và **không** khoá theo Point class: đích
rơi về đã là `default` của chính điểm đó, nên TTL theo class chỉ là núm thứ hai
cho cùng một kết quả — xem `ADR-051` mục "Vì sao KHÔNG khoá TTL theo Point class".

**As-Built (`TASK-PROG-401`, cập nhật `ADR-051`).** `st_withdraw_stale_outputs()`
(`st_process_image.*`) hiện thực hai nhánh chính sách trên: STOPPED/DISABLED rút
NGAY tại safe boundary (không chờ TTL, gọi mỗi tick từ `ScanLoop::step()` sau
`st_apply_all_outputs()`); mọi instance đã từng publish rút khi
`last_tick_now_ns() >= output_commit_now_ns + hold_ttl_ns`.

Ba điểm của `ADR-051` khác bản `TASK-PROG-401` và cần đọc kỹ:

1. **Đo bằng đồng hồ, không đếm base step.** Số base step chỉ xấp xỉ thời gian
   khi vòng quét chạy đúng nhịp; mọi đường chạy nhanh hơn nhịp thật (soak, replay,
   catch-up sau khi trễ) sẽ co "60 s" thành mili giây mà không có gì báo. Mốc
   `output_commit_now_ns` được ghi cùng chỗ với `output_commit_generation`.
2. **Đo tuổi của LỆNH, không đo trạng thái.** Ràng điều kiện vào riêng `FAULTED`
   để lọt đúng những đường im lặng khó thấy nhất: Task bị disable trong khi
   Program vẫn `RUNNING`, hay instance đứng ở `ROLLED_BACK` — cả hai ngừng publish
   mà không bao giờ mang trạng thái `FAULTED`.
3. **Mặc định của `ScanDeps` là giá trị đã ký**, không phải `0`. Mặc định `0`
   nghĩa là "giữ vô hạn", nên bất kỳ đường nối dây nào quên set field đều âm thầm
   quay lại đúng hành vi `ADR-051` đóng.

`hold_ttl_ns` ở `ScanDeps` mặc định `st_hold_ttl::kSignedTtlNs` (60 s); `0` chỉ
còn là affordance test/chẩn đoán và bootstrap từ chối nó qua
`--program-hold-ttl-ms` (dải hợp lệ 1..600000 ms). Ràng buộc "TTL ≥ 2× chu kỳ Task
chậm nhất" được `static_assert` canh theo `allowedPeriodMs` của profile.
`outputs_withdrawn` trên `StProgramInstance` chặn double-release và tự mở lại khi
instance publish thành công trở lại (restart sau `reset_fault`/`start`). Instance
CHƯA từng publish (`output_commit_now_ns == 0`) không bị rút và không vào sổ
candidate.

## 7. PID và anti-windup

PID state thuộc instance, có stable ID/layout version và có thể RETAIN theo policy.
Mỗi cycle:

```text
error = setpoint - processValue
p = kp * error
i_candidate = clamp(i + ki * error * dt, iMin, iMax)
d = filtered_derivative(processValue, dt)
u_raw = p + i_candidate - d
u_limit = clamp(u_raw, outMin, outMax)
u_selected = resolver_feedback_actual_selected_output()
if manual_or_higher_priority_override:
    i = i  // freeze; không chép actual ngoại lai vào state Program
else:
    i = back_calculate(i_candidate, u_limit, u_raw)
proposal = u_limit
```

`dt` lấy Task cadence monotonic, không wall clock. NaN/Inf, invalid limits,
quality bad hoặc `dt` ngoài tolerance gây diagnostic/fault; không publish.
Khi override sắp nhả, runtime so sánh proposal hiện tại với actual selected. Nếu
độ lệch vượt transition envelope đã duyệt, nó phải giữ transition/override theo
authority và yêu cầu ramp/ack; không được chép actual ngoại lai vào integrator để
giả thành state của Program. Exact gains/filter/back-calculation coefficient,
transition envelope và ramp policy là field Revision/Target decision cần Controls
và Safety review.

**As-Built (`TASK-PROG-303`).** `StFbType::PID` (`st_program.*`/`st_exec.cpp`)
hiện thực đúng thuật toán trên: `i_candidate` clamp theo `OUT_MIN..OUT_MAX`
(đơn giản hoá — `iMin/iMax` dùng chung với biên output thay vì field riêng),
`u_limit` back-calculate về `i` theo công thức đại số chính xác (không cần
tracking gain `Tt` riêng vì `i_candidate` đã bị chặn trước). `ACTUAL` (actual
selected output) KHÔNG đọc thẳng `PriorityResolver` — chương trình wire một
`VAR_INPUT` bình thường vào chính Point Table AO/DO mà `OUT` publish tới, tái
dùng nguyên vẹn process image `REQUIRE_GOOD` từ `TASK-PROG-302`; đây là round
trip qua hardware feedback (`ao_setpoint`), trễ đúng một cycle, đúng tinh
thần "không đọc lại giữa chừng". Override được phát hiện bằng so `ACTUAL` với
đề xuất cycle trước, lệch quá `1%` dải `OUT_MIN..OUT_MAX` — **ngưỡng cụ thể
này CHƯA qua Controls/Safety review**, giữ nguyên là TARGET-PENDING đúng như
đoạn trên đã nêu; đổi được bằng một hằng số (`kPidOverrideDetectFraction`)
khi có quyết định field. Hold-last TTL-based withdraw khi Task FAULT kéo dài
(`holdTtl`) CHƯA làm ở đây — thuộc phạm vi `TASK-PROG-304` (overrun/fault Task).

## 8. State machine Task

| State | Entry | Event/guard | Next/action |
|---|---|---|---|
| `UNCONFIGURED` | chưa active artifact | valid activation | `STOPPED`, init layout |
| `STOPPED` | không execute/publish | start + prerequisites | `STARTING` |
| `STARTING` | restore/init, input check | all valid | `RUNNING`; else `FAULT` |
| `RUNNING` | cycle theo cadence | stop/disable | `STOPPING` |
| `RUNNING` | — | runtime fault/3 overrun liên tiếp | `FAULT`, hủy staging |
| `STOPPING` | finish boundary | policy applied | `STOPPED`, withdraw/hold theo decision |
| `FAULT` | no new publish | reset + fault gone + acknowledgement | `STOPPED` |
| `TRANSITIONING` | swap candidate | first-cycle pass/fail | `RUNNING` mới / rollback cũ |

Command lặp lại idempotent. `reset_fault` không tự start và không xóa audit.
Activation/Restore có lifecycle riêng, không được chuyển state bằng DB/FE alone.

## 9. Overrun và runtime fault

Budget per cycle gồm WCET target đã đo, nhỏ hơn period với margin được Architect
duyệt. Đề xuất warning tại 70%, overrun tại 90% hoặc deadline miss; con số cuối
thuộc target capacity decision.

| Fault | Detection | Cycle output | Recovery |
|---|---|---|---|
| div0/overflow/non-finite | executor | hủy staging | Task FAULT, source map |
| invalid jump/op/budget | executor invariant | hủy | Task FAULT + incident artifact |
| required input bad | mapping | hold-last bounded | auto recover threshold hoặc ack |
| one overrun | monotonic duration | hủy cycle nếu deadline miss | warning/count |
| 3 consecutive overrun | counter | no new proposal | Task FAULT; không plant-wide safe |
| IOP/watchdog fault | independent safety | theo SafetyManager | safety authority, không program override |
| higher priority override | resolver feedback | program proposal masked | normal state + anti-windup |

Counter consecutive reset sau một cycle trong budget. Một Task fault không dừng
IOP, Web health, audit hay SafetyManager. Alarm/event bounded và rate-limited.

**As-Built (`TASK-PROG-304`).** `StScheduler::run_task()` (`st_scheduler.cpp`)
đo `exec_ns` bằng đồng hồ monotonic RIÊNG (`task_start`/`task_end`, khác
`now_ns` của tick — SPEC scheduler §5), rồi báo `OverrunMonitor::record()`.
Khi `should_force_safe()` đúng (3 overrun liên tiếp), MỌI Program RUNNING
của Task đó chuyển `FAULTED` với mã `ST-RT-010`, giữ hold-last (không publish
mới) — không có đường nào trong `StScheduler` chạm tới `SafetyManager`/
`SafeState`, nên "không plant-wide safe" là bất biến cấu trúc. `PROGRAM_TASK_
SCHEDULER_SPEC` §6.1 (bản Supporting As-Built cũ) từng gắn overrun vào
`SafetyManager` — đoạn đó đã bị supersede bởi chính mục này, xem thông báo
đầu tài liệu đó. Phục hồi cần `reset_fault` tường minh (§8), không tự động
dù đồng hồ "nhanh lại".

## 10. Cutover GRAPH ↔ PROGRAM

Một Point Local logic không có hai producer. Preflight lập inventory graph output,
program binding, overrides, RETAIN/PID impact. Safe-boundary transaction:

```text
freeze intended transition plan
→ validate backup + expected current owner
→ snapshot input/actual selected output
→ withdraw old producer and install new producer in one resolver generation
→ run first cycle without publishing until valid
→ publish new proposal; read-back owner/generation
→ failure: restore old producer/backup, never leave dual owner
```

`PROGRAM_ONLY` là target cutover Rev A; graph backup immutable được giữ để Restore.
Không cho graph và program cùng run “tạm” trên cùng Local output.

**As-Built (`TASK-PROG-404/405`).** `ProgrammingCutover` khóa HẲN một owner trong
`ScanLoop`; coordinator chỉ apply staged handle tại safe boundary, chờ output
commit đầu tiên mới promote LKG/checkpoint. First-cycle lỗi chuyển ROLLING_BACK,
khôi phục prior LKG + graph ở boundary kế rồi mới báo ROLLED_BACK. Programming
UDS bounded gọi coordinator với version/deadline/peer credential; không còn gap
transport phát hiện ở Task 306. Target/HIL vẫn phải chứng minh output vật lý.

## 11. Concurrency, memory và RT constraints

- Scan/cycle thread không lock DB/socket, không parse/compile/load file, không log
  synchronous, không heap allocate sau activation.
- Candidate swap dùng single-writer safe-boundary handle; monitor đọc snapshot
  immutable hoặc lock-free generation, không giữ mutex qua cycle.
- Input/output/trace/diagnostic buffer có fixed capacity theo capability. Overflow
  trace drop sample + counter; overflow control data là fault, không truncate.
- Non-RT worker stage/RETAIN/audit không được priority cao hơn IOP/scan thread.

**As-Built (`TASK-PROG-305`).** `StBoundedRuntimeTrace<Capacity>`
(`st_trace.hpp`) là ring buffer `std::array` cấp phát TĨNH — KHÁC
`StTraceLog`/`std::deque` cũ (cấp/giải phóng chunk mỗi lần push/pop dù kích
thước logic không đổi, chỉ dùng cho `StCyclicRuntime` không chạy trong
đường RT chặt). Event chỉ giữ con trỏ `const char*` tới string TĨNH, không
sở hữu — không có field nào cần cấp phát động. `program_status` đọc lại
`StProcessInputSlot` đã chụp ở process image (TASK-PROG-302) để trả
quality/source/freshness, không capture gì mới ngoài đường RT.

## 12. Repository mapping

| Thiết kế | As-Built | Target sửa/tạo |
|---|---|---|
| base step/scan | `apps/core/application/runtime/scan_loop.*`; `ProgrammingCutover`, coordinator và bootstrap tại `10d9ad6` | target timing/HIL còn mở |
| scheduler | `st_scheduler.*`: `StSchedulerProfile::REV_A`, `add_task()`, `add_program()`, `on_base_step()` tại `a831a0d`; overrun→Task FAULT (đồng hồ WCET riêng) tại `4d744ac` (TASK-PROG-304) | Task 306 chỉ bootstrap Rev A |
| executor | `st_exec.*`, `st_cyclic_runtime.*` | instruction budget/non-finite/source fault |
| process image | `st_process_image.*`, `st_io_map.*` tại `f080056` (TASK-PROG-302) | đã đạt quality/freshness/generation/all-or-nothing |
| arbitration | `PriorityResolver::can_set_ao/can_set_do` tại `f080056`; `st_withdraw_stale_outputs()` (STOPPED/DISABLED ngay, mọi instance đã publish theo `holdTtl` đồng hồ) tại `9227d27` + `ADR-051` (T59-406) | `hold_ttl_ns` mặc định `st_hold_ttl::kSignedTtlNs` = 60 s; TTL theo Point class đã ĐÓNG (không làm), không còn `TARGET-PENDING` |
| PID/library | `StFbType::PID` trong `st_program.*`/`st_exec.cpp`/`st_loader.cpp` tại `TASK-PROG-303` | back-calculation anti-windup + freeze-on-override đã có; tuning gain/tolerance field là Revision/Target decision |
| monitor/trace | `StBoundedRuntimeTrace`, `program_status.monitorInputs`, `program_trace` tại `c6ab2bd` (TASK-PROG-305) | value-sampling historian session (`POST/GET/DELETE /runtime/traces`) còn mở |
| integration | `apps/core/bootstrap/main.cpp` | instantiate scheduler/lifecycle; exclusive graph cutover |

## 13. Verification, deploy và rollback

| Test ID | Scenario | PASS/evidence |
|---|---|---|
| `CTRL-T-001` | 1/5/30 s trong 24 h monotonic | release drift/jitter trong target limit, không burst catch-up |
| `CTRL-T-002` | input đổi giữa cycle | current cycle dùng snapshot cũ, next cycle dùng mới |
| `CTRL-T-003` | fault từng Program sau proposal | zero partial publish; generation giữ |
| `CTRL-T-004` | priority higher/manual override | winner đúng; PID tracking không windup/bump |
| `CTRL-T-005` | one/three overrun | warning rồi Task FAULT; IOP/Safety tiếp tục |
| `CTRL-T-006` | quality stale/bad/unknown | không thay zero; required/fallback behavior đúng |
| `CTRL-T-007` | graph↔program fault từng transition step | không dual owner/gap ngoài limit; rollback backup |
| `CTRL-T-008` | IOP 199/200/201 ms + Task 30 s | deadline/quality/watchdog đúng trên HIL |
| `CTRL-T-009` | power/restart với PID/RETAIN | state theo policy, bumpless hoặc chặn có diagnostic |

Host evidence `EV-PROG-G3-301` đã chạy phần cấu hình/cadence của
`CTRL-T-001`: ba period được nhận, one-over/period khác/budget 20%/Task hoặc
Program thứ hai bị reject; Task 30 s chỉ chạy ở release thứ 30 trong khi 30 base
step vẫn tăng sequence. Không nâng `CTRL-T-001` hoặc `VS-PROG-009` thành PASS vì
chưa chạy 10.000 cycle/period trên Forlinx với jitter/WCET/watchdog thật.

Deploy feature flag theo controller, mặc định GRAPH; chạy shadow read-only không
publish để đo WCET trước cutover. Rollback dùng Restore/cutover transaction, không
tắt process/chép file thủ công. Data/RETAIN không xóa khi rollback binary.

## 14. Phase budget và output decision table

| Phase | Input immutable | Output | Cấm trong phase | Fault action |
|---|---|---|---|---|
| Snapshot/map | Point generation | typed process image | wait I/O, convert unknown to zero | abort cycle/quality policy |
| Execute | snapshot + active code/state | slot/FB state candidate | heap, DB/file/socket, wall clock | discard candidate state/output |
| Validate | output staging | valid proposal set | partial publish | reject toàn set |
| Arbitrate/publish | proposal + resolver snapshot | new resolver generation | direct IOP write | retain prior generation |
| Trace/retain enqueue | committed generation | bounded queue record | block scan khi queue full | drop trace + count; retain fault policy |

| Tình huống | Program state | Proposal mức 5 | Effective output | UI truth |
|---|---|---|---|---|
| normal | RUNNING | publish mới | resolver chọn theo priority | program/actual/owner |
| manual priority 1–4 | RUNNING | vẫn tính/publish theo policy | manual thắng | overridden-by + TTL |
| một cycle fault | RUNNING/DEGRADED | không publish mới | proposal trước tới hold TTL (60 s) | fault + age |
| ba overrun liên tiếp | FAULT | withdraw/hold theo decision | resolver/safety quyết định | Task fault, không tự plant safe |
| stop/cutover | STOPPING→STOPPED | withdraw boundary | nguồn còn lại/safe policy | owner generation mới |

Budget tuyệt đối cho từng phase vẫn `TARGET-PENDING`; implement phải đọc
capability/profile đã duyệt, không hard-code số đề xuất trong tài liệu. `holdTtl`
KHÔNG còn nằm trong diện đó: nó đã ký ở `ADR-051` (60 s) và authority là chính ADR
đó — xem ở đấy lý do con số không đặt trong `product_profile_v2.json` (SHA-256 của
profile bị ghim trong mọi build manifest artifact, biến mỗi lần chỉnh hẹn giờ
thành sự kiện tương thích artifact).

## 15. Blocker, revision và sign-off

| Blocker | Owner | Gate | Điều kiện mở |
|---|---|---|---|
| ~~Hold TTL~~ (ĐÓNG 2026-08-21 bởi `ADR-051`: 60 s đồng hồ), PID set và capacity chưa ký | Product + Controls | DOC-G2 approval | decision package approved cho phần PID/capacity còn lại |
| Safety interaction chưa có HIL evidence | Safety + QA | implementation/release | fault injection + 199/200/201 ms PASS |
| Graph cutover target chưa kiểm chứng | Core + Controls + QA | P6/G6 | Forlinx/HIL timing, power/restart và exclusive-output Test Result |

| Phiên bản | Ngày | Thay đổi | Tác giả |
|---|---|---|---|
| 0.1 | 2026-08-09 | Khóa cycle, Task, priority, PID, fault, cutover và acceptance | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung phase input/output/fault và decision table Program proposal/actual owner; chuyển Detailed Draft chờ review | System Engineering |
| 0.3 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; nêu bật hai bẫy `RSK-PROG-002` và `RSK-PROG-004` | System Engineering |
| 0.4 | 2026-08-11 | Đồng bộ `TASK-PROG-301` tại `a831a0d`: profile Rev A 1 Task/1 Program/1-5-30 s, budget `<20%`, base-step sequence/missed release và capability/schema; sửa base step theo ADR-027 thành mặc định 1 s, dải 500..2000 ms; giữ target/HIL NOT TESTED | Core + Controls |
| 0.5 | 2026-08-13 | Đồng bộ `TASK-PROG-302` (`f080056`, process image preflight-batch/binding bridge) và `TASK-PROG-303` (PID back-calculation anti-windup + read-back actual selected qua Point Table AO/DO, không kênh riêng); ghi rõ ngưỡng override-detect 1% là TARGET-PENDING; giữ target/HIL NOT TESTED | Core + Controls |
| 0.6 | 2026-08-13 | Đồng bộ `TASK-PROG-304` (`4d744ac`): sửa `exec_ns` đo luôn-bằng-0 (đồng hồ WCET riêng, không dùng `now_ns` chung tick), fault ĐÚNG Task khi 3 overrun liên tiếp không plant-wide safe — supersede rõ `PROGRAM_TASK_SCHEDULER_SPEC` §6.1 cũ; giữ target/HIL NOT TESTED | Core + Controls |
| 0.7 | 2026-08-13 | Đồng bộ `TASK-PROG-305` (`c6ab2bd`): `StBoundedRuntimeTrace` ring buffer cấp phát tĩnh (khác `StTraceLog`/`std::deque` cũ) log fault/overrun/rollback/activation; `program_status.monitorInputs` trả quality/source/freshness; sửa chính xác row arbitration (`holdTtl` withdraw còn mở, không phải Task 304); giữ target/HIL NOT TESTED | Core + Controls |
| 0.8 | 2026-08-13 | Đồng bộ `TASK-PROG-306` (`f35234c`): `bootstrap/main.cpp` dựng `StScheduler` REV_A thật lần đầu qua `--programming-mode`, `CutoverMode` khoá hẳn `graph->execute()` khi `PROGRAM_ONLY`; cập nhật §2 As-Built (không còn "bootstrap chưa cấp scheduler"); ghi gap UDS transport control API phát hiện khi wiring; giữ target/HIL NOT TESTED, transaction LIVE/rollback vẫn Task 404 | Core + Controls |
| 0.9 | 2026-08-13 | Đồng bộ `TASK-PROG-401` (`9227d27`): `st_withdraw_stale_outputs()` đóng khoảng hở "hold-last không giới hạn" ở §6/§12 — STOPPED/DISABLED rút proposal mức 5 NGAY tại safe boundary, FAULTED rút theo `hold_ttl_base_steps` cấu hình được (mặc định 0 = vô hạn, TTL field decision theo Point class vẫn TARGET-PENDING); giữ target/HIL NOT TESTED | Core + Controls |
| 1.1 | 2026-08-21 | `ADR-051` ký TTL hold-last = **60 s đồng hồ** và đóng hàng blocker tương ứng ở §15. Ba đổi thay hành vi kèm theo: TTL đo bằng đồng hồ của tick (`output_commit_now_ns`) thay vì đếm base step; TTL đo tuổi của LỆNH nên phủ cả `ROLLED_BACK` và `RUNNING`-trong-Task-bị-disable chứ không riêng `FAULTED`; mặc định `ScanDeps` là giá trị đã ký thay vì `0`. "Khoá theo Point class" đóng là KHÔNG làm, có lý do ở ADR. Evidence host/local `ctest` 1205/1205; target/HIL vẫn NOT TESTED | Core + Controls |
| 1.0 | 2026-08-13 | Đồng bộ `TASK-PROG-404/405` tại `10d9ad6`: Programming UDS/coordinator, exclusive owner tại safe boundary, first-output commit mới nâng LKG, first-cycle fault rollback và restart checkpoint recovery. Host gates PASS; target/HIL/power/IOP vẫn NOT TESTED. | Core + Controls + QA |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Controls + Core Lead | **TASK-PROG-301 SOURCE/DOD DONE** | `a831a0d`, `EV-PROG-G3-301` |
| Safety + MCU + QA | **WAIVED FOR IMPLEMENTATION; review/test độc lập còn mở** | `AUTH-PROG-2026-08-11-03` |
| System Architect + Product Owner | **ACCEPT FOR IMPLEMENTATION** | `AUTH-PROG-2026-08-11-03`; ADR-026..029 `Accepted` |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; revision history và bảng ký §15 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 mục tiêu và nguyên tắc an toàn; §3 giới hạn đúng một Task và ba chu kỳ |
| `DD-03` As-Built | PASS | §2 phân biệt container supporting 8/16/32 với profile Rev A 1/1/1; ScanLoop/bootstrap/coordinator và process image/cutover source đã wire tới `10d9ad6`, target evidence còn mở |
| `DD-04` Target ownership | PASS | §4 một cycle và quyền sở hữu dữ liệu; §10 cutover xác định owner Local logic duy nhất |
| `DD-05` Data từng field | PASS | §5 Point mapping/quality/freshness; §14 bảng quyết định output với `program_value`/`actual_value`/winner/priority/TTL |
| `DD-06` Interface | N/A tại file này | Hợp đồng liên tiến trình thuộc `IFSPEC-PROG-001`; ở đây là ngữ nghĩa nội bộ Core. §4 định nghĩa đủ giao diện process image cho Program |
| `DD-07` State/algorithm/timing | PASS | §3 clock/base step/cadence; §7 PID và chống bão hòa; §8 state machine Task; §9 overrun; §14 ngân sách theo pha |
| `DD-08` Operation flow | N/A tại file này | Không có mặt người dùng; hệ quả vận hành ở `OPS-PROG-001` §14 (cây quyết định timeout) |
| `DD-09` Error/safety/security | PASS | §9 overrun và runtime fault — **lỗi Task chỉ làm Task đó FAULT**, safe-state toàn trạm chỉ do SafetyManager; §6 hold-last chống giật khi nhả override |
| `DD-10` Repository mapping | PASS | §12 ScanLoop, process image, resolver và RETAIN cần sửa |
| `DD-11` Verification | PASS | §13 gắn `VS-PROG-009/010/013/014` với ngưỡng số (10.000 chu kỳ/period; poll gap `<200 ms`, mục tiêu `≤100 ms`) |
| `DD-12` Compatibility/deploy/rollback | PASS | §13 deploy và rollback; §10 chuyển đổi GRAPH ↔ PROGRAM |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation; release BLOCKED | `OD-PROG-004/012/013` và ADR-026..029 đã `Accepted`; source 301 nối trace/risk nhưng residual không giảm. Owner target: Core/Controls/Safety/QA; gate G3/G6; mở release khi 10.000 cycle Forlinx, overrun/process-image/HIL và Test Result độc lập PASS |

Residual an toàn và timing trên target **không được giảm** trước khi có Test
Result/HIL thật.
