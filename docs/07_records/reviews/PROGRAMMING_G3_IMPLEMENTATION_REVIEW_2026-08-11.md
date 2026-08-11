# Review triển khai G3 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-G3-IMPLEMENTATION-REVIEW-2026-08-11` |
| Ngày | 2026-08-11 |
| Phạm vi hiện tại | `TASK-PROG-300` — bounded loader, prepared runtime, no-parser RT boundary |
| Source authority | `4f7e0accca7e1531983afd3bc349acfe8918b102` |
| Source tree | `ebba3d433b631f236a64325fc30f0adad76f7d2e` |
| Trạng thái | **P3 IN PROGRESS — TASK-PROG-300 SOURCE/DOD DONE 1/8; NEXT TASK-PROG-301** |
| Release | **BLOCKED** — feature OFF; 0/32 Test Result PASS; chưa deploy/đo Forlinx |
| Evidence raw | [`EV-PROG-G3-300`](programming-g3/raw/EV-PROG-G3-300.txt) |

## 1. Phán quyết

`TASK-PROG-300` đạt DoD ở mức source/host: artifact được verify và dựng toàn bộ
runtime image/shadow buffers ngoài scan; tick chỉ chuyển ownership prepared
handle và swap vùng bytes LKG, không parse/load/copy/allocate/free ở boundary đã
instrument. `core_application` và executable `mkddc-core` có gate hậu liên kết
chặn symbol parser/compiler.

Phán quyết này **không** nâng `VS-PROG-012` PASS. Scenario còn yêu cầu 10.000
cycle mỗi period trên Forlinx và chứng minh toàn bộ filesystem/DB/HTTP/DNS/
blocking/dynamic-load path với executor/reviewer độc lập. Bootstrap production
chưa route scheduler; graph vẫn là owner và Programming flag vẫn `OFF`.

## 2. Finding và cách đóng

| Finding | Mức | Triệu chứng/nguyên nhân | Cách sửa và bằng chứng | Trạng thái |
|---|---|---|---|---|
| `F-G3-300-01` | P0 | `StCyclicRuntime::run_cycle` và `StScheduler::tick` gọi loader/cấp phát từ artifact bytes tại boundary | `StProgramRuntime::prepare()` tạo `StPreparedProgram` ngoài scan; `activate_prepared()` chuyển handle O(1); allocation tests PASS | **CLOSED** |
| `F-G3-300-02` | P0 | Source tree tách compiler/runtime nhưng không có bằng chứng artifact sau link | `verify_programming_runtime_symbols.py` đọc `nm -C`; hai CTest kiểm archive và `mkddc-core`, cùng PASS | **CLOSED** |
| `F-G3-300-03` | P1 | Ảnh active cũ và LKG vector có thể bị huỷ/copy trong tick | Giữ retired handle/bytes tới command path kế; promotion LKG dùng `swap`; allocation counter tick PASS | **CLOSED** |
| `F-G3-300-04` | P1 | `bad_alloc` có thể thoát khỏi loader/runtime và rollback trước đây activate ngay ngoài tick contract | Ánh xạ `IR-E-015`, output không đổi; rollback prepare trước và chỉ thành `ROLLED_BACK` tại tick boundary; contract test PASS | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi Task 300. Những phần base step,
process image, arbitration, SafetyManager, bounded trace, bootstrap và target
timing là deliverable `TASK-PROG-301..307`, không phải finding bị giấu.

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

## 5. Kiểm chứng

| Gate | Kết quả đo lại |
|---|---|
| Targeted runtime/scheduler/executor/control API/symbol | **84/84 PASS** |
| Release CMake Modbus+BACnet+HMI | configure/build PASS |
| Full CTest | **933/933 PASS**, 14,17 giây |
| Go | `go vet ./...` và `go test ./... -count=1` PASS |
| FE | **58/58 file, 494/494 test**, lint/typecheck/Vite build PASS |
| Contract join | `verify_programming_g1_contracts.py --self-test`: **7/7 PASS**, mutation 5/5, deploy-order 5/5 |
| Tài liệu/candidate | chạy sau khi ghim candidate v2.23; phải PASS 22/22 + trace hai chiều + ISO harness |

Chrome DevTools không chạy vì Task 300 không đổi component/layout/runtime FE được
mount. GitHub Actions có thể tiếp tục không chạy step do billing/spending-limit;
đây là giới hạn hạ tầng, không được ghi thành CI PASS.

## 6. Trace và ranh giới evidence

- Source partial được nối vào `CORE-103/106`, `NFR-103/108` và treatment
  `RSK-PROG-003/006`; không dòng nào đủ điều kiện nâng `I=Y` mới.
- Tổng trace giữ `2/60 I=Y`, mọi `T/P/R=N`; Test Result giữ `2 record BLOCKED`,
  `0/32 PASS`.
- P3 đạt `1/8`, tổng Plan 53 `22/49 = 44,9%`; task kế tiếp là
  `TASK-PROG-301` base step tách Task period/Rev A one-task profile.
- Feature `OFF`, không Commission, không production cutover, không claim board/HIL.

## 7. Kết luận

**GO tiếp `TASK-PROG-301`; NO-GO release/cutover.** Source Task 300 đã có commit,
test và boundary proof thật. G3 chỉ được kết luận khi `TASK-PROG-300..307` hoàn
tất và evidence target đúng authority được review.
