# Review triển khai G3 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-G3-IMPLEMENTATION-REVIEW-2026-08-11` |
| Ngày | 2026-08-11 |
| Phạm vi hiện tại | `TASK-PROG-300/301` — prepared runtime + Rev A profile/base-step cadence |
| Source authority | `4f7e0accca7e1531983afd3bc349acfe8918b102`; `a831a0d42c0e945f9a59c36e461ada0e12962c89` |
| Source tree mới nhất | `9ff19be31d95e687f5358ceabb52c7c2a16fb502` |
| Trạng thái | **P3 IN PROGRESS — TASK-PROG-300/301 SOURCE/DOD DONE 2/8; NEXT TASK-PROG-302** |
| Release | **BLOCKED** — feature OFF; 0/32 Test Result PASS; chưa deploy/đo Forlinx |
| Evidence raw | [`EV-PROG-G3-300`](programming-g3/raw/EV-PROG-G3-300.txt), [`EV-PROG-G3-301`](programming-g3/raw/EV-PROG-G3-301.txt) |

## 1. Phán quyết

`TASK-PROG-300/301` đạt DoD ở mức source/host: artifact được verify và dựng toàn bộ
runtime image/shadow buffers ngoài scan; tick chỉ chuyển ownership prepared
handle và swap vùng bytes LKG, không parse/load/copy/allocate/free ở boundary đã
instrument. `core_application` và executable `mkddc-core` có gate hậu liên kết
chặn symbol parser/compiler. Scheduler Rev A chỉ nhận một Task/một Program,
period 1/5/30 s và budget `<20%`; `on_base_step()` có sequence độc lập, Task
30 s không biến thành sleep 30 s và release trễ không chạy catch-up.

Phán quyết này **không** nâng `VS-PROG-009/012/015` PASS. Scenario còn yêu cầu
10.000 cycle mỗi period trên Forlinx, jitter/WCET/watchdog/IOP và toàn bộ
filesystem/DB/HTTP/DNS/blocking/dynamic-load path với reviewer độc lập. Bootstrap production
chưa route scheduler; graph vẫn là owner và Programming flag vẫn `OFF`.

## 2. Finding và cách đóng

| Finding | Mức | Triệu chứng/nguyên nhân | Cách sửa và bằng chứng | Trạng thái |
|---|---|---|---|---|
| `F-G3-300-01` | P0 | `StCyclicRuntime::run_cycle` và `StScheduler::tick` gọi loader/cấp phát từ artifact bytes tại boundary | `StProgramRuntime::prepare()` tạo `StPreparedProgram` ngoài scan; `activate_prepared()` chuyển handle O(1); allocation tests PASS | **CLOSED** |
| `F-G3-300-02` | P0 | Source tree tách compiler/runtime nhưng không có bằng chứng artifact sau link | `verify_programming_runtime_symbols.py` đọc `nm -C`; hai CTest kiểm archive và `mkddc-core`, cùng PASS | **CLOSED** |
| `F-G3-300-03` | P1 | Ảnh active cũ và LKG vector có thể bị huỷ/copy trong tick | Giữ retired handle/bytes tới command path kế; promotion LKG dùng `swap`; allocation counter tick PASS | **CLOSED** |
| `F-G3-300-04` | P1 | `bad_alloc` có thể thoát khỏi loader/runtime và rollback trước đây activate ngay ngoài tick contract | Ánh xạ `IR-E-015`, output không đổi; rollback prepare trước và chỉ thành `ROLLED_BACK` tại tick boundary; contract test PASS | **CLOSED** |
| `F-G3-301-01` | P0 | Scheduler chỉ có trần supporting 8/16/32, 50..60000 ms nên đường production có thể nhận config ngoài Rev A | `StSchedulerProfile::REV_A` dùng generated profile chặn one-over Task/Program và period ngoài 1/5/30 s; capability trả đúng profile | **CLOSED** |
| `F-G3-301-02` | P0 | API `tick()` và biến `period_ns` không phân biệt base step với Task period, tạo rủi ro Task 30 s kéo sleep/watchdog | ScanLoop gọi `on_base_step()` có sequence; Task 30 s test qua 30 base step; bootstrap đổi tên nội bộ, systemd/runtime trích ADR-028 | **CLOSED ở source; production wiring Task 306** |
| `F-G3-301-03` | P1 | Budget supporting cho phép bằng period, trái OD-PROG-012 `<20%` | Rev A reject budget 0 hoặc `>=20%` bằng toán uint64; boundary 199/200 ms có test | **CLOSED** |
| `F-G3-301-04` | P1 | Release lỡ chỉ bị bỏ nhưng không có counter authoritative | `missed_release_count` saturating và status schema field; test nhảy 50 release chứng minh chạy một, đếm 49 | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi Task 300/301. Process image,
arbitration, SafetyManager, bounded trace, bootstrap và target timing là
deliverable `TASK-PROG-302..307`, không phải finding bị giấu.

## 3. Source map thực tế

| Trách nhiệm | File/symbol |
|---|---|
| Verify/preallocate non-RT | `apps/core/application/st/st_runtime.{hpp,cpp}` — `StPreparedProgram`, `prepare()` |
| Loader OOM fail-closed | `apps/core/application/st/st_loader.cpp` — `LoadArtifact()` |
| Safe boundary cyclic | `st_cyclic_runtime.{hpp,cpp}` — `request_activation()`, `run_cycle()` |
| Safe boundary scheduler/LKG | `st_scheduler.{hpp,cpp}` — `request_activation()`, `apply_pending_activations()`, `run_task()` |
| Control API rollback/stage truth | `st_control_api.cpp` và `test_st_control_api.cpp` |
| Allocation proof | `test_st_cyclic_runtime.cpp`, `test_st_scheduler.cpp`, `test_st_exec.cpp` |
| Link boundary | `apps/core/CMakeLists.txt`, `scripts/verify_programming_runtime_symbols.py` |
| Rev A profile/cadence | `st_scheduler.{hpp,cpp}` — `StSchedulerProfile`, `add_task()`, `add_program()`, `on_base_step()` |
| Scan/base-step handoff | `scan_loop.{hpp,cpp}` — `run(base_step_ns)`, `on_base_step(monotonic_ns)`; `bootstrap/main.cpp` tên biến chuyển tiếp |
| Capability contract | `st_control_api.cpp`, `contracts/config/st_program_control_v1.schema.json` |
| Watchdog authority | `platform/systemd/mkddc-core.service`, ADR-028 |

## 4. Bất biến đã chứng minh trên host

1. Artifact hỏng bị reject ở command path; active package không đổi và request
   lỗi không bị retry âm thầm trong tick.
2. Runtime image chứa program, mutable slots/FB state và shadow buffers đã cấp
   phát đủ trước khi enqueue.
3. Activation và LKG promotion tại tick chỉ move/swap fixed handles/buffers;
   ảnh cũ được giữ tới lần command path kế tiếp mới thu hồi.
4. OOM loader/runtime trả `IR-E-015`, không publish candidate hoặc sửa output.
5. Runtime archive/binary không định nghĩa symbol parser/compiler bị cấm.
6. Rollback được prepare ngoài RT, response ghi `STAGED` và `appliedAt` trung
   thực; trạng thái `ROLLED_BACK` chỉ xuất hiện sau boundary.
7. Rev A không có đường add Task/Program thứ hai, period khác 1/5/30 s hoặc
   budget bằng/vượt 20%; supporting container không bị xóa.
8. Base-step sequence tiến mỗi lời gọi ScanLoop dù Task chưa due; Task 30 s chỉ
   dispatch một lần ở release 30, release lỡ chỉ chạy một và có counter.

## 5. Kiểm chứng

| Gate | Kết quả đo lại |
|---|---|
| Targeted Task 300 runtime/executor/symbol | **84/84 PASS** |
| Targeted Task 301 scheduler/control/ScanLoop/integration | **74/74 PASS** |
| Release CMake Modbus+BACnet+HMI | configure/build PASS |
| Full CTest mới nhất | **936/936 PASS**, 14,57 giây |
| Go | `go vet ./...` và `go test ./... -count=1` PASS |
| FE | **58/58 file, 494/494 test**, lint/typecheck/Vite build PASS |
| Contract join | `verify_programming_g1_contracts.py --self-test`: **7/7 PASS**, mutation 5/5, deploy-order 5/5 |
| Tài liệu/candidate | chạy sau khi ghim candidate v2.24; phải PASS 22/22 + trace hai chiều + ISO harness |

Chrome DevTools không chạy vì Task 300 không đổi component/layout/runtime FE được
mount. GitHub Actions có thể tiếp tục không chạy step do billing/spending-limit;
đây là giới hạn hạ tầng, không được ghi thành CI PASS.

## 6. Trace và ranh giới evidence

- Source partial Task 300/301 được nối vào `CORE-102/103/106/108`,
  `NFR-103/108` và treatment `RSK-PROG-002/003/006`; không dòng nào đủ điều kiện
  nâng `I=Y` mới.
- Tổng trace giữ `2/60 I=Y`, mọi `T/P/R=N`; Test Result giữ `2 record BLOCKED`,
  `0/32 PASS`.
- P3 đạt `2/8`, tổng Plan 53 `23/49 = 46,9%`; task kế tiếp là
  `TASK-PROG-302` process image/binding bridge.
- Feature `OFF`, không Commission, không production cutover, không claim board/HIL.

## 7. Kết luận

**GO tiếp `TASK-PROG-302`; NO-GO release/cutover.** Source Task 300/301 đã có
commit, test và boundary/profile proof thật. G3 chỉ được kết luận khi `TASK-PROG-300..307` hoàn
tất và evidence target đúng authority được review.
