# Thiết kế ngữ nghĩa điều khiển Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDD-CTRL-PROG-001` |
| Phiên bản | 1.6 |
| Trạng thái | **M3 — APPROVED FOR IMPLEMENTATION; P3/P4 source/host DONE; target timing và Safety review còn mở** |
| Ngày | 2026-09-28 |
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

**Output I/O mở rộng (EXT: Modbus RTU/TCP) khi bị rút — chủ sở hữu chốt
2026-09-26 (`EV-PROG-FBD-ST-MB-20260925` F06).** EXT không đi qua
`PriorityResolver`, nên trước quyết định này "withdraw" không làm gì cả: coil
Modbus giữ giá trị cuối vô thời hạn. Trên Foxlinx, DO2 kẹt ở 1 suốt 18 phút sau
Disable. Chính sách mới:

- Instance **đã từng publish** trong đời tiến trình hiện tại bị rút (DISABLED/
  STOPPED, WAITING vì signal bị chặn, hoặc lệnh cũ quá `holdTtl`): Core gọi
  `PointWriter::release_ext_command()`. Hàm này nhả source trong point table và
  đặt slot `ext` về `dirty=0` kèm một `ext_cmd_seq` MỚI.
- iobus coi `dirty=0` + seq mới là sự kiện NHẢ. Nó ghi `safe_value` của điểm
  (BE sinh `safe_value` vào device profile, bool đổi thành 0/1). Điểm không
  khai `safe_value` thì **giữ giá trị cuối** và log
  `WARN modbus_master.ext_release_hold` đúng một lần mỗi lần nhả, không bịa
  giá trị 0.
- Instance **chưa từng publish** (ví dụ mọi Program lúc Core khởi động ở
  DISABLED) KHÔNG nhả EXT. Nếu nhả ở đó, mọi DO Modbus sẽ bị giật về safe ở
  mỗi lần Core khởi động lại, trước khi intent kịp bật Program trở lại.
- iobus khởi động lại lấy mọi seq đang có làm mốc, kể cả slot đang ở trạng
  thái nhả, nên không phát lại một lần nhả cũ.

**Đổi gói: Commission, Restore và rollback chu kỳ đầu (2026-09-27,
`EV-PROG-FBD-ST-MB-20260925` F20).** Trước bản này, instance rời gói không bị rút
gì cả. Chỉ `st_withdraw_stale_outputs()` gọi `release_*`, và hàm đó chỉ duyệt
Program của gói ĐANG chạy. Vì vậy AO/DO cục bộ và EXT giữ giá trị cuối của
Active cũ vô thời hạn: không hết `holdTtl`, và T7 `no_ctrl` không bật. Quyết
định F06 áp dụng nguyên vẹn: **instance bị loại khỏi gói là instance bị rút.**

`ProgrammingRuntimeCoordinator::on_safe_boundary(resolver, writer)` gọi
`st_withdraw_replaced_outputs()` (`st_process_image.*`) cho tập instance vừa rời
scheduler. Lời gọi nằm tại đúng safe boundary đổi topology, sau khi owner mode
của boundary đó đã áp dụng. Lúc này chưa Program nào của gói mới chạy, và instance
cũ vẫn còn sống trong `previous_program_set_` (nó chỉ bị huỷ sau đó, ở luồng
non-RT). Với từng điểm AO/DO/EXT của instance cũ:

- **Gói mới cũng nắm điểm đó thì bàn giao, không nhả.** "Nắm" nghĩa là owner là
  `PROGRAM_ONLY` và có instance `RUNNING` của topology mới khai điểm đó là output.
  Program có intent Enable chạy ngay tại boundary kích hoạt (ADR-062), nên nó
  publish điểm này trong chính scan đó. Kết quả là không có scan nào điểm ở trạng
  thái đã nhả, không tạo lại khoảng `no_ctrl` của F13, và `ext_cmd_seq` chỉ tăng
  khi giá trị thật sự đổi. Nếu nhả rồi claim lại trong cùng scan, iobus (soi seq
  mỗi 5 ms) có thể thấy `dirty=0` và phát `safe_value` lên dây: đó là một glitch.
  Instance mới kế thừa mốc publish của lệnh đang treo. Nhờ vậy, nếu nó không kịp
  publish (WAITING, fault), TTL và nhánh nhả EXT vẫn tính đúng tuổi lệnh.
- **Gói mới không nắm thì rút như Disable.** Trường hợp này gồm điểm không có
  trong gói mới, và điểm chỉ Program Disabled của gói mới khai. AO/DO nhả mức 5 để
  tầng dưới quyết định: manual/BMS/schedule, default mức 6, hoặc T7 khi không còn
  ai điều khiển. EXT mà instance cũ đã publish thì về `safe_value`; điểm không khai
  `safe_value` giữ giá trị cuối kèm `WARN modbus_master.ext_release_hold`.
- **Rollback chu kỳ đầu** trả topology cũ và owner `GRAPH_ONLY`, nên sau đó không
  Program nào publish. Mọi claim của gói ứng viên, kể cả claim nó vừa nhận bàn
  giao, được nhả ở chính boundary rollback.
- **Không đổi:** boot fail-closed (khôi phục checkpoint lúc khởi động không đi qua
  đường này), và các nhánh Disable/TTL/F06 ở trên.
- Mỗi lần đổi gói Core ghi đúng một dòng `INFO programming.package_swap_withdraw
  reason=replace|rollback retired=… released_ao=… released_do=… released_ext=…
  handed_over=… live_publishes=…`, dùng làm mốc đo trên target.

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
đề xuất cycle trước, lệch quá `1%` dải `OUT_MIN..OUT_MAX`
(`kPidOverrideDetectFraction`). Hold-last TTL-based withdraw khi Task FAULT kéo
dài (`holdTtl`) CHƯA làm ở đây — thuộc phạm vi `TASK-PROG-304` (overrun/fault Task).

**Đã duyệt Controls/Safety (2026-09-28, Issue #802).** Chủ dự án — vai
Controls/Safety Lead + Product Owner — duyệt theo
[`REC-PID-DECISION-REQUEST-20260928`](../../07_records/reviews/PID_REVIEW_DECISION_REQUEST_2026-09-28.md)
phương án 1, bằng chứng
[`EV-PROG-PID-APPROVAL-20260928`](../../07_records/test-evidence/programming/2026-09-28-pid-approval-evidence.md):

| Điểm | Trạng thái |
|---|---|
| Ngưỡng override-detect 1 % dải `OUT_MIN..OUT_MAX` | **Đã duyệt** (không còn TARGET-PENDING). Đổi số là đổi semantics PID: bump `libraryVersion`, token cũ tự mất hiệu lực |
| `iMin/iMax` dùng chung biên output | **Đã duyệt** |
| Fault khi `dt` ngoài tolerance/không tăng, NaN/Inf, dải output vô nghĩa, quality bad: diagnostic/fault, không publish | **Đã duyệt** |
| Freeze tích phân khi override, không chép `ACTUAL` ngoại lai, nhả override nối tiếp từ tích phân đã freeze | **Đã duyệt** (vòng kín HOST: OUT lúc nhả 70,90 so với 100 ở phản chứng) |
| Gains, bộ lọc derivative, transition envelope/ramp khi nhả override của từng vòng | Vẫn là **quyết định hiện trường** theo Revision/Target |
| Vòng kín với AO thật trên bo, HIL | **NOT RUN** |

Token `approval_token("PID", "rev-a.6", "EV-PROG-PID-APPROVAL-20260928")` nằm
trong `product_profile_v2.json`; Check nhận `PID` trên đường ST và FBD.

## 7A. Timer xung và counter — `TP`, `CTU`, `CTD`

`T59-804` (`PGM02-V22-WP-03`) mở ba Function Block chuẩn IEC 61131-3 mà thư
viện đã cần nhưng compiler chưa có. Ngữ nghĩa chốt ở đây TRƯỚC khi code, vì mỗi
block thêm một giá trị wire mới vào `PROGRAM_TABLE`/IR và một layout RETAIN mới
— hai thứ không sửa lại được sau khi có artifact chạy trên bo.

### 7A.1 Chữ ký và giá trị wire

| Block | Wire `StFbType` | Vào | Ra | State RETAIN |
|---|---:|---|---|---|
| `TP` | 6 | `IN:BOOL`, `PT:TIME` | `Q:BOOL`, `ET:TIME` | `pulsing:u8`, `elapsed:u64`, `q:u8`, `prev_in:u8` = 11 B |
| `CTU` | 7 | `CU:BOOL`, `RESET:BOOL`, `PV:INT` | `Q:BOOL`, `CV:INT` | `prev_clk:u8`, `cv:i16` = 3 B |
| `CTD` | 8 | `CD:BOOL`, `LOAD:BOOL`, `PV:INT` | `Q:BOOL`, `CV:INT` | `prev_clk:u8`, `cv:i16` = 3 B |

Giá trị 1..5 (`TON`/`TOF`/`R_TRIG`/`F_TRIG`/`PID`) giữ nguyên, nên artifact cũ
vẫn byte-compatible — cùng luật đã áp khi thêm `PID = 5`.

### 7A.2 `TP` — xung có độ dài cố định

```text
if not pulsing and rising_edge(IN):   pulsing = true; start = now
if pulsing:
    elapsed = clamp(now - start, 0, PT)
    ET = elapsed
    Q  = elapsed < PT
    if elapsed >= PT: pulsing = false
else:
    Q = false
    ET = (IN ? PT : 0)
```

Ba quyết định phải đọc đúng:

1. **Không retrigger giữa xung.** Sườn lên trong lúc `pulsing` bị bỏ qua — đó là
   toàn bộ lý do tồn tại của `TP` so với `TON`: người dùng cần một xung có độ
   dài BIẾT TRƯỚC để đá một thiết bị, không phải một xung dài ra theo tín hiệu.
2. **`ET` bão hoà tại `PT`**, không vượt — cùng luật với `TON`/`TOF` §6.2 của
   `ST_SUBSET_SPEC`.
3. **Sau xung, `ET` giữ `PT` chừng nào `IN` còn TRUE** rồi mới về 0. Cho `ET`
   nhảy về 0 ngay khi hết xung sẽ khiến logic đọc `ET` không phân biệt được
   "chưa chạy" với "vừa chạy xong".

### 7A.3 `CTU` / `CTD` — đếm sườn, bão hoà, không quấn vòng

```text
CTU:  if RESET: CV = 0
      elif rising_edge(CU) and CV < INT_MAX: CV = CV + 1
      Q = (CV >= PV)

CTD:  if LOAD: CV = PV
      elif rising_edge(CD) and CV > INT_MIN: CV = CV - 1
      Q = (CV <= 0)
```

1. **`RESET`/`LOAD` thắng sườn đếm trong cùng một cycle.** Một lệnh reset bị một
   xung đếm ghi đè là kiểu hỏng người vận hành không truy được.
2. **Bão hoà, KHÔNG quấn vòng.** `CV` chạm `INT_MAX`/`INT_MIN` thì dừng. Quấn
   vòng biến một bộ đếm giờ chạy thành số âm sau 32767 lần và không ai thấy.
3. **`CV` kiểu `INT`** theo profile Rev A; muốn đếm lớn hơn thì dùng `DINT` ở
   tầng chương trình, không nới ngầm kiểu của block chuẩn.
4. `Q` tính SAU khi cập nhật `CV` trong cùng cycle, nên `Q` luôn nhất quán với
   `CV` mà chương trình đọc được ở cycle đó.

### 7A.4 RETAIN và khôi phục

Layout nối tiếp sau vùng biến RETAIN, theo đúng thứ tự `fb_instances` như các
block hiện có. `TP` khôi phục `elapsed` rồi rebase `start` theo đồng hồ
monotonic hiện tại (giống `TON`/`TOF`) vì timestamp monotonic không có nghĩa qua
lần khởi động khác; `CTU`/`CTD` khôi phục thẳng `CV` — giá trị đếm là dữ liệu
của quy trình, không phải của tiến trình.

Validator từ chối payload có `pulsing`/`q`/`prev_*` khác 0/1 và `elapsed` vượt
`INT64_MAX`; `CV` ngoài dải `INT` là payload hỏng, không phải giá trị cần kẹp.

### 7A.5 Tương thích nguồn — điều SẼ hỏng

`TP`, `CTU`, `CTD` trở thành **từ khoá** như `TON`/`TOF`/`PID`, nên một Draft
đang dùng chính ba tên đó làm TÊN BIẾN sẽ báo lỗi Check sau khi nâng cấp. Đây là
lựa chọn có chủ ý: cho một biến trùng tên với type FB chuẩn nghĩa là chấp nhận
hai nghĩa cho một token, và đó là nguồn lỗi tệ hơn nhiều so với một lần đổi tên
biến. Rev A chưa release nên phạm vi ảnh hưởng là Draft trong phòng lab.

### 7A.6 `SCALE` và `DEADBAND` — hàm thuần, biên dịch bằng KHAI TRIỂN

Hai hàm này KHÔNG có opcode IR riêng. Lý do là ràng buộc thật của định dạng chứ
không phải sở thích: một lệnh IR mang tối đa ba toán hạng nguồn, còn `SCALE` cần
năm. Chọn nới định dạng IR để nhét vừa một hàm là đổi thứ đắt nhất (artifact
format) để mua thứ rẻ nhất (một phép tính tuyến tính).

Vì vậy compiler **khai triển** chúng thành chuỗi lệnh đã có, và `dispatch` trong
registry mang giá trị `EXPANSION` để nói đúng điều đó — không giả vờ là
`FUNC_TABLE` rồi để người đọc IR đi tìm một opcode không tồn tại.

```text
SCALE(IN, IN_MIN, IN_MAX, OUT_MIN, OUT_MAX) : REAL
  = OUT_MIN + (IN - IN_MIN) * (OUT_MAX - OUT_MIN) / (IN_MAX - IN_MIN)

DEADBAND(IN, DB, REF) : REAL
  = SEL(ABS(IN - REF) > DB, REF, IN)
```

Ba quyết định:

1. **`SCALE` KHÔNG tự kẹp dải ra.** Người dùng muốn kẹp thì gọi `LIMIT` — một
   phép kẹp ngầm sẽ biến cảm biến ngoài dải thành giá trị biên trông hợp lệ, và
   đó chính là thứ che mất lỗi hiện trường. `SCALE` là ánh xạ tuyến tính, không
   phải bộ bảo vệ.
2. **`IN_MAX == IN_MIN` là FAULT, không phải giá trị mặc định.** Khai triển đi
   qua `DIV`, nên nó dùng lại đúng `ST-RT-002` (div-by-zero) đã có thay vì đẻ thêm một mã lỗi
   thứ hai cho cùng một tình huống.
3. **`DEADBAND` trả `REF` khi trong dải**, không phải trả giá trị cũ. Trả giá trị
   cũ là hành vi CÓ TRẠNG THÁI và sẽ biến một hàm thuần thành một FB — nếu cần
   hành vi đó, dùng `HYSTERESIS`.

### 7A.7 `HYSTERESIS` — so sánh có nhớ

| Block | Wire `StFbType` | Vào | Ra | State RETAIN |
|---|---:|---|---|---|
| `HYSTERESIS` | 9 | `IN:REAL`, `HIGH:REAL`, `LOW:REAL` | `Q:BOOL` | `q:u8` = 1 B |

```text
if IN >= HIGH:      Q = true
elif IN <= LOW:     Q = false
else:               Q = giữ nguyên chu kỳ trước
```

1. **`HIGH <= LOW` là FAULT** (`ST-RT-006`, dùng lại mã dải min/max của PID): một
   dải trễ đảo ngược không có nghĩa vật lý, và đoán ý người khai sẽ tạo ra một
   bộ điều khiển bật/tắt liên tục ở đúng ngưỡng.
2. **Trạng thái ban đầu là `false`.** Khởi động ở giữa dải phải là "chưa kích
   hoạt", không phải một giá trị phụ thuộc thứ tự nạp.
3. `Q` là RETAIN được: sau mất điện, một quạt đang chạy trong vùng trễ phải trở
   lại đúng trạng thái nó đang có, không phải nhảy theo ngưỡng gần nhất.

## 7B. Khối DDC SYSTEM — `RELAY_GUARD`, `STAGER`, `PULSE_GEN`, `WORD_TO_BITS`, `BITS_TO_WORD`, `UPTIME`

Issue #801, registry `rev-a.6`. Đặc tả đầy đủ, bằng chứng hiện trường và câu trả
lời duyệt Q1–Q5 ở
[`SW-SYSTEM-DDC-BLOCKS-MK-DDC-24-VI`](SYSTEM_DDC_BLOCKS_SPEC_MK-DDC-24_VI.md);
mục này chỉ chốt phần ràng buộc wire/RETAIN như §7A.

| Block | Wire `StFbType` | Vào | Ra | State RETAIN |
|---|---:|---|---|---|
| `RELAY_GUARD` | 10 | `CMD:BOOL`, `ENABLE:BOOL`, `MIN_ON:TIME`, `MIN_OFF:TIME` | `Q:BOOL`, `WAITING:BOOL`, `STARTS:DINT` | `STARTS:u32` = 4 B |
| `STAGER` | 11 | `RUN:BOOL`, `DEMAND:REAL`, `MAX_STAGES:INT`, `STAGE_DELAY:TIME`, `HOLD:BOOL` | `STAGES:INT`, `TARGET:INT`, `MASK:UINT` | số bậc `u8` ≤ 16 = 1 B |
| `PULSE_GEN` | 12 | `RUN:BOOL`, `T_ON:TIME`, `T_OFF:TIME` | `Q:BOOL`, `TICK:BOOL`, `COUNT:DINT` | `COUNT:u32` = 4 B |
| `WORD_TO_BITS` | 13 | `IN:UINT` | `B00`…`B15:BOOL` | 1 B dự trữ (codec không nhận kích thước 0) |

1. **Thời gian theo đồng hồ release của Core**, không đếm lần gọi: đổi chu kỳ
   Program không đổi hành vi. `PULSE_GEN` giữ mốc đảo pha tuyệt đối và cộng dồn;
   `STAGER` khởi động lại đồng hồ `STAGE_DELAY` ngay tại lần đổi bậc.
2. **Tham số vô nghĩa là FAULT `ST-RT-006`**: `MAX_STAGES` ngoài 1…16,
   `T_ON + T_OFF = 0`. `DEMAND` NaN/Inf là `ST-RT-004`.
3. **Trạng thái ban đầu an toàn**: mọi đầu ra `FALSE`/0; `RELAY_GUARD` phải nghỉ
   đủ `MIN_OFF` sau cold start trước lần đóng đầu. `ENABLE = FALSE` tắt ngay, bỏ
   qua `MIN_ON`.
4. **RETAIN chỉ giữ số đếm quy trình**; `Q` và mốc thời gian không qua restart,
   nên sau mất điện relay đi lại đường nghỉ tối thiểu.
5. `BITS_TO_WORD(B00, …, B15) : UINT` là FUNCTION khai triển (như §7A.6) với
   đúng 16 đối số `BOOL`. `UPTIME() : TIME` là thời gian từ lần thực thi đầu của
   Program; chỉ gọi được trong PROGRAM/FUNCTION_BLOCK (trong FUNCTION →
   `ST-POU-002`).
6. Không bump `targetAbi`: giá trị wire và opcode `UPTIME = 0x56` là bổ sung;
   loader cũ từ chối artifact dùng chúng (fail-closed).

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
| `CTRL-T-001` | tập chu kỳ ADR-061 {10…50000} ms trên base step 10 ms, trong 24 h monotonic | C1–C4 của ADR-061: overrun 0, missed release 0, lệch đánh thức ≤ 100 µs; không burst catch-up |
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
chưa chạy đủ ngưỡng trên Forlinx với jitter/WCET/watchdog thật. Ngưỡng từ 2026-09-27 (ADR-061, chủ sở hữu chốt lại sau soak lần 3): cả 8 chu kỳ chạy đồng thời trên target, mỗi chu kỳ ≥ 10 chu kỳ, C1–C4 PASS và missed release = 0. Ngưỡng X20 cũ (10 000 chu kỳ, soak 24 h cho 10 s/50 s) đã bỏ; độ bền C1–C4 dài hạn đo bằng soak riêng.

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
| ~~Hold TTL~~ (ĐÓNG 2026-08-21 bởi `ADR-051`: 60 s đồng hồ), ~~PID set~~ (ĐÓNG 2026-09-28 bởi Issue #802, `EV-PROG-PID-APPROVAL-20260928`) và capacity chưa ký | Product + Controls | DOC-G2 approval | decision package approved cho phần capacity còn lại |
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
| 1.6 | 2026-09-28 | §7: Controls/Safety duyệt `PID` (Issue #802) — ngưỡng override 1 %, `iMin/iMax` dùng chung biên output, hành vi fault và freeze khi override; bỏ TARGET-PENDING cho phần đã duyệt; §15 đóng phần "PID set". Bằng chứng HOST `EV-PROG-PID-APPROVAL-20260928`; AO thật trên bo NOT RUN | Core + Controls |
| 1.5 | 2026-09-28 | §7B: khối DDC SYSTEM `RELAY_GUARD`/`STAGER`/`PULSE_GEN`/`WORD_TO_BITS` (wire 10–13), `BITS_TO_WORD`, `UPTIME` — ràng buộc wire/RETAIN/FAULT (Issue #801, registry `rev-a.6`). Host PASS | Core + Controls |
| 1.4 | 2026-09-27 | §13 và `DD-11`/`DD-13`: ngưỡng `VS-PROG-009` theo `VVP-PROG-001` v2.4 — ≥ 10 chu kỳ mỗi lớp, C1–C4 PASS, missed release = 0 (chủ sở hữu chốt lại sau soak lần 3). Không đổi trạng thái kiểm chứng | Core + Controls |
| 1.3 | 2026-09-27 | §6 thêm trường hợp đổi gói (F20): instance rời gói khi Commission/Restore/rollback chu kỳ đầu là instance bị rút. Điểm gói mới cũng nắm được bàn giao liên tục (không nhả, không glitch EXT, không tạo lại `no_ctrl`), điểm còn lại rút như Disable (AO/DO về tầng dưới, EXT về `safe_value`). Bỏ dòng "chưa thuộc phạm vi" của F06. Host PASS; target chưa đo | Core + Controls |
| 1.2 | 2026-09-27 | §13 theo ADR-061: `CTRL-T-001` dùng tập chu kỳ {10…50000} ms trên base step 10 ms với C1–C4; ngưỡng `VS-PROG-009` là 10 000 chu kỳ cho chu kỳ ≤ 5 s, soak 24 h cho 10 s/50 s (X20, chủ sở hữu chốt 2026-09-27). Không đổi trạng thái kiểm chứng | Core + Controls |
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
| `DD-11` Verification | PASS | §13 gắn `VS-PROG-009/010/013/014` với ngưỡng số (≥ 10 chu kỳ mỗi lớp trong tập ADR-061, C1–C4 PASS — chủ sở hữu chốt lại 2026-09-27; poll gap `<200 ms`, mục tiêu `≤100 ms`) |
| `DD-12` Compatibility/deploy/rollback | PASS | §13 deploy và rollback; §10 chuyển đổi GRAPH ↔ PROGRAM |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation; release BLOCKED | `OD-PROG-004/012/013` và ADR-026..029 đã `Accepted`; source 301 nối trace/risk nhưng residual không giảm. Owner target: Core/Controls/Safety/QA; gate G3/G6; mở release khi `VS-PROG-009` đạt ngưỡng v2.4 trên Forlinx, overrun/process-image/HIL và Test Result độc lập PASS |

Residual an toàn và timing trên target **không được giảm** trước khi có Test
Result/HIL thật.
