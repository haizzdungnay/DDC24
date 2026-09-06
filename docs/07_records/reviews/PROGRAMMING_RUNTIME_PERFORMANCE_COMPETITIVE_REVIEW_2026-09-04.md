# Báo cáo rà soát hiệu năng Programming và Program Runtime

| Thuộc tính | Giá trị |
|---|---|
| ID | `REC-PROG-RUNTIME-PERF-COMP-001` |
| Phiên bản | 1.1 |
| Trạng thái | **Record — source/HOST/TARGET exploratory đã rà; provenance TARGET `PARTIAL`; HIL/release `NO-GO`** |
| Ngày | 2026-09-04 |
| Phạm vi | Compiler/Check, package, scheduler, ST runtime, cycle time, multi-program và vị thế cạnh tranh |
| Mốc mã nguồn | `main@67f8ca3a6266207469fa029ceb4c66f02be838f6` |
| Người rà | Codex, vai trò `mkddc-techlead` |
| Kết luận | Lõi ST chạy đủ nhanh cho profile 1 s trên Forlinx; production còn tuần tự, binary live chưa truy nguyên được tới HEAD và runtime đang có missed release tích lũy dù health vẫn xanh |

> Đây là **record của một lần rà soát**, không phải Product/Design authority và
> không tự đóng requirement, risk hay release gate. Bằng chứng HOST, target dùng
> fake MCU, HIL vật lý và release được tách riêng trong toàn bộ hồ sơ.

---

## 0. Kết luận điều hành

Programming/runtime tại mốc source được rà soát **chưa đủ điều kiện release**.
Verdict hiện hành vẫn là `NO-GO`.

Các kết luận chính:

1. **Multi-program đã có thật:** một package chứa tối đa 32 Program, tối đa 16
   Program được Enable và mỗi Program có period/deadline/state/metrics riêng.
2. **Production chưa chạy Program song song trên nhiều CPU core:** scheduler có
   lane `PARALLEL`, nhưng bootstrap production giữ mặc định `SEQUENTIAL` và đưa
   package vào một Task `main`.
3. **Interpreter không phải nút thắt hiện tại:** trên Forlinx 4×Cortex-A53, 16
   Program × 4.095 instruction chạy tuần tự trung bình 2,00–2,05 ms; lớn nhất
   3,008 ms, bằng 1,511% budget Task 199 ms. Hai lượt đều 0 runtime fault.
4. **Parallel không đem lại lợi ích ổn định trên target:** mean chỉ nhanh hơn
   1,06–1,18 lần ở tải cực đại, trong khi đuôi lên tới 41,14 ms; production giữ
   `SEQUENTIAL` là phù hợp ở hiện trạng.
5. **Cycle sản phẩm mới là giới hạn chính:** profile chỉ cho `1/5/30 s`. Latency
   phản ứng tới output phụ thuộc scan boundary và IOP, không thể suy từ execution
   time vài trăm microsecond.
6. **Hai blocker source trước release:** budget WCET trong package chưa được Core
   tiêu thụ/enforce; snapshot/reload có blocking file I/O trên luồng scan nhưng
   nằm ngoài số đo `scan_overrun`.
7. **Target phát hiện thêm hai sai lệch:** Program live tăng
   `missedReleaseCount` trong khi Task miss bằng 0, Program vẫn `HEALTHY`; và
   source live mô tả task 50 ms nhưng cấu hình thực chạy 1.000 ms.
8. **Môi trường TARGET không sạch để chốt tail/jitter:** hai systemd unit ngoài
   MK-DDC tự restart mỗi 5/10 giây; các service MK-DDC vẫn 0 restart nhưng số đo
   parallel tail chỉ được dùng exploratory.
9. **Vị thế hợp lý:** MK-DDC-24 có tiềm năng ở DDC HVAC compact cho FCU/VAV/AHU
   nhỏ và retrofit; chưa nên định vị cạnh tranh trực tiếp với PLC tốc độ cao,
   motion hoặc safety PLC.

## 1. Phạm vi và phương pháp

### 1.1 Trong phạm vi

- Product profile và giới hạn Programming.
- Luồng Check → compiler → package → Core loader/runtime.
- Scheduler, release deadline, lane, fault và overrun.
- Execution time của bytecode ST trên HOST.
- Execution time/compiler load và read-back runtime trên SOM Forlinx thật.
- Chi phí compiler theo số Program trên HOST.
- Cycle time từ góc nhìn điều khiển và multi-program.
- So sánh định tính với controller HVAC/BMS và PLC hiện hành.

### 1.2 Ngoài phạm vi

- Không thay đổi source, contract hay cấu hình runtime.
- Không review UI/UX; không cần Chrome DevTools cho thay đổi chỉ gồm record này.
- Không dùng MCU thật, logic analyzer hoặc tải AO/DO vật lý.
- Không chạy soak 24 giờ, power-cut hoặc physical HIL.
- Không dùng kết quả trong hồ sơ này để nâng `RELEASE_READY`.

### 1.3 Môi trường HOST

| Thành phần | Giá trị |
|---|---|
| OS/kernel | Ubuntu, Linux `7.0.0-30-generic`, x86-64, `PREEMPT_DYNAMIC` |
| CPU | Intel Xeon E5-2680 v4 @ 2,40 GHz, 14 core/28 thread |
| Compiler | GCC/G++ 13.3.0 |
| CMake | 3.28.3 |
| Build | Release `-O3`, Modbus và BACnet bật, HMI tắt vì không thuộc phạm vi runtime Programming |

Benchmark runtime dùng harness tạm trong `/tmp`, liên kết trực tiếp các thư viện
compiler/runtime của đúng source được rà. SHA-256 của source harness là
`43403a40c3d28333754cc5d938a6eec656340acadc64d0dfc4bef38e80508c21` và binary
là `eb4f970ec89b135b3e454b5c69581a516dee1593c4e6aeb2403fa19f0ac4e168`.
Harness chưa được version-control nên số đo chỉ là **exploratory HOST evidence**,
không phải Test Result được kiểm soát.

### 1.4 Môi trường TARGET

| Thành phần | Giá trị |
|---|---|
| Board/OS | Forlinx RV1126B, Buildroot 2024.02, Linux 6.1.141 aarch64 |
| CPU/RAM | 4× Cortex-A53, 1.973 MiB RAM, không swap |
| CPU policy | `schedutil`, 1.008–1.296 MHz trong preflight |
| Nhiệt độ | 48,1 °C trước benchmark; lớn nhất quan sát 53,68 °C |
| Runtime I/O | `mkddc-fakemcu` + PTY; **không phải MCU/physical HIL** |
| Dịch vụ | Core/IOBus/Web-PI/Netcfg/FakeMCU active; Core/IOBus/Web-PI/FakeMCU 0 restart |
| Health API | 6/6 check `ok`; phiên bản `0.1.0-be-b6c` |
| Nhiễu ngoài MK-DDC | `masscan-agent` và `AgentSvr-agent` auto-restart 5/10 s; môi trường benchmark không sạch |

Binary live không trùng binary ARM64 build mới từ HEAD:
`mkddc-core` live `5508b4…` so với HEAD `ed1595…`; compiler live
`9da21b…` so với HEAD `c357db…`. Không có manifest triển khai đủ để nối hai
binary live về commit, nên provenance của quan sát production là **PARTIAL**.

Benchmark standalone dùng binary ARM64 build mới từ đúng HEAD, source harness
SHA-256 `43403a40…`, binary `e6432b79…`; chỉ cần libsodium/libc/loader.
Harness và mọi fixture/artifact tạm đã được xóa khỏi board sau phép đo.

## 2. Hiện trạng kiến trúc Programming/runtime

### 2.1 Product profile

Nguồn machine-readable là
[`contracts/programming/product_profile_v2.json`](../../../contracts/programming/product_profile_v2.json#L10):

| Giới hạn | Giá trị |
|---|---:|
| Program tổng | 32 |
| Program được Enable | 16 |
| Task | 3 |
| Program/Task | 32 |
| Period hợp lệ | 1.000 / 5.000 / 30.000 ms |
| Budget tối đa | 20% Task period |
| Instruction/Program | 4.096 |
| Slot/Program | 1.024 |
| Published Signal | 512 |
| Binding cấp sản phẩm | 512 |
| Ngôn ngữ | ST, FBD |

### 2.2 Đường thực thi

1. Backend dựng input của từng Program và compile tuần tự.
2. Compiler tạo typed IR/artifact có chữ ký.
3. Packager ghi Program identity, IR, period và `budget_us` vào package v2.
4. Coordinator tách package và chuẩn bị toàn bộ Program ngoài topology đang chạy.
5. Safe boundary kích hoạt prepared set.
6. Scheduler capture input, release Program đến hạn, execute bytecode và publish
   output qua Priority Resolver/Safe State; Program không ghi thẳng phần cứng.

Runtime chuẩn bị slot/Function Block shadow ngoài lần execute, sau đó dùng bộ nhớ
cố định và rollback bằng `memcpy` khi fault:
[`st_runtime.cpp`](../../../apps/core/application/st/st_runtime.cpp#L23).
Interpreter là vòng lặp opcode trực tiếp, không parse source hoặc đọc filesystem
trong thân Program:
[`st_exec.cpp`](../../../apps/core/application/st/st_exec.cpp#L43).

### 2.3 Semantics multi-program

Mỗi `PROGRAM` có:

- runtime instance, state và RETAIN riêng;
- period, deadline và bộ đếm missed release riêng;
- `last_exec_ns`, `max_exec_ns` và fault riêng;
- thứ tự `order` xác định;
- output ownership riêng;
- lane để có thể thực thi song song nếu production bật chế độ đó.

`FUNCTION` và `FUNCTION_BLOCK` không phải Program được scheduler release độc lập;
chúng được Program gọi. Program trao đổi dữ liệu qua Published Signal; consumer
đọc snapshot đã commit ở boundary kế tiếp, nên đổi lấy tính tất định bằng độ trễ
một cycle:
[`st_scheduler.cpp`](../../../apps/core/application/st/st_scheduler.cpp#L1195).

## 3. Kết quả benchmark runtime HOST

| Tải | Mode | Mean | p99 | Max |
|---|---|---:|---:|---:|
| 1 Program × 3 instruction | tuần tự | 0,458 µs | 0,486 µs | 52,2 µs |
| 10 Program × 3 instruction | tuần tự | 1,444 µs | 1,460 µs | 287,5 µs |
| 16 Program × 3 instruction | tuần tự | 2,131 µs | 4,588 µs | 269,6 µs |
| 16 Program × 2.001 instruction | tuần tự | 176,2 µs | 226,3 µs | 468,0 µs |
| 16 Program × 2.001 instruction | song song | 22,3 µs | 28,7 µs | 193,7 µs |
| 16 Program × 4.095 instruction | tuần tự | **357,5 µs** | **449,5 µs** | **706,3 µs** |
| 16 Program × 4.095 instruction | song song | **40,0 µs** | **49,5 µs** | **208,2 µs** |

Diễn giải đúng phạm vi:

- 16 Program gần trần instruction dùng tối đa 0,355% budget Task 199 ms trên
  HOST của lần chạy này.
- Lane song song tăng tốc khoảng 7,9–9,0 lần ở tải instruction nặng trên máy 14
  core.
- Fixture tập trung vào throughput instruction; nó không phải max-slot,
  max-Function-Block, max-binding hoặc full physical-I/O benchmark.
- Không được suy tốc độ này sang SOM 4×Cortex-A53 hoặc physical response time.

### 3.1 Benchmark standalone trên TARGET

| Tải | Mode | Mean lượt 1 / 2 | p99 lượt 1 / 2 | Max lượt 1 / 2 |
|---|---|---:|---:|---:|
| 16 Program × 3 instruction | tuần tự | 10,850 / 11,114 µs | 11,667 / 11,959 µs | 154,008 / 152,549 µs |
| 16 Program × 2.001 instruction | tuần tự | 984,672 / 991,377 µs | 1.286,314 / 1.145,140 µs | 1.671,916 / 1.427,779 µs |
| 16 Program × 2.001 instruction | song song | 985,022 / 908,173 µs | 3.997,199 / 2.475,206 µs | 40.595,896 / 21.999,761 µs |
| 16 Program × 4.095 instruction | tuần tự | **2.002,109 / 2.050,309 µs** | **2.248,278 / 2.286,488 µs** | **3.007,816 / 2.494,166 µs** |
| 16 Program × 4.095 instruction | song song | 1.887,064 / 1.738,028 µs | 9.702,483 / 2.261,404 µs | 41.140,173 / 19.852,405 µs |

Trong suốt phép đo, hai service ngoài MK-DDC tạo vòng restart định kỳ; do đó các
giá trị p99/max, đặc biệt tail parallel, có thể bị nhiễu bởi process spawn và
journal I/O. Mean tuần tự vẫn hữu ích để định hướng nhưng không đủ authority
cho WCET/jitter.

Mọi scenario của cả hai lượt đều 0 runtime fault. Tải cực đại tuần tự dùng lớn
nhất 1,511% budget 199 ms và chậm khoảng 5,7 lần so với mean HOST. Target chỉ
có lợi ích mean 1,06–1,18 lần khi chạy song song, nhưng tail xấu hơn nhiều; kết
quả này bác bỏ ước lượng tăng tốc 2–3 lần nếu chưa có worker/affinity policy.

### 3.2 Read-back runtime production trên TARGET

Project live `AHU-MASTER-SEQUENCE` đang dirty, Active và Draft cùng sequence 22.
Revision Active chứa một Program `RelayPattern32`, 32 output Modbus RTU qua bốn
device; đây là FakeMCU, không phải xác nhận output vật lý. Task `main` chạy
period 1.000 ms, budget 199 ms, 0 task overrun và 0 task missed release. Program
`RUNNING/HEALTHY`, execution quan sát 14,876–15,459 µs, max 46,086 µs, 0 fault.

Tuy nhiên, `missedReleaseCount` cấp Program tăng 413 → 465 trong khoảng mười
phút, rồi 465 → 470 chỉ trong 48 giây, trong khi Task miss vẫn 0 và trạng thái
Program vẫn `HEALTHY`. Source scheduler kiểm due của Task trước due của Program
và health chỉ dùng consecutive miss; bằng chứng hiện tại cho thấy metric hoặc
release thực tế bị lệch pha, chưa đủ để kết luận chắc là bỏ chu kỳ hay đếm sai.

### 3.3 Test tập trung đã chạy

| Cổng | Kết quả | Phạm vi bằng chứng |
|---|---|---|
| C++ scheduler/runtime multi-program | **59/59 PASS**, 396 ms | HOST, unit/integration tập trung |
| `go test ./internal/programming/... -count=1` | **PASS** | HOST, backend Programming |
| Runtime benchmark | Hoàn tất, 0 fault trong các scenario đo | HOST exploratory |
| Runtime benchmark ARM64 | Hai lượt, mọi scenario 0 fault | TARGET exploratory, binary build từ HEAD |
| Read-back dịch vụ/API | 6/6 health; Core/IOBus/Web-PI/FakeMCU 0 restart | TARGET live, provenance binary PARTIAL |

59 test C++ phủ scheduler profile, deadline riêng, lane, 32/16 boundary,
multi-program package/stage và các probe không cấp phát đã chọn. Đây không phải
full repository regression và không thay target/HIL.

## 4. Hiệu năng Check/compiler

Backend compile từng Program trong một vòng tuần tự để trả đủ diagnostic cho cả
package:
[`checks.go`](../../../apps/web-api/internal/programming/application/checks.go#L300).
Mỗi lần compile tạo thư mục tạm, ghi input, chạy process compiler, đọc manifest
và dọn scratch:
[`runner.go`](../../../apps/web-api/internal/programming/compiler/runner.go#L258).

| Fixture/môi trường | IR | Artifact | Lượt / tổng | Trung bình |
|---|---:|---:|---:|---:|
| `ahu_fan_control.st` — HOST | 20 instruction | 1.760 byte | 200 / 0,77 s | 3,85 ms/Program |
| `relay_pattern_32do.st` — HOST | 313 instruction | 10.800 byte | 200 / 2,06 s | 10,30 ms/Program |
| `relay_pattern_32do.st` — TARGET | 313 instruction | 10.800 byte | 100 / 7,214 s | 72,138 ms/Program |
| Active source `RelayPattern32` — TARGET | 647 instruction | 18.832 byte | 100 / 13,363 s | 133,627 ms/Program |
| Active source `RelayPattern32` — TARGET | 647 instruction | 18.832 byte | 200 / 26,775 s | 133,873 ms/Program |

Các lần đo có ký artifact. Với 32 Program có kích thước tương tự relay, phần
compile tuần tự có lower-bound khoảng 0,33 s trên HOST; chưa gồm DB, queue, đóng
package và tốc độ storage của SOM.

Active source dài 17.344 byte; 200 lần compile có chữ ký, sandbox và 0 failure.
Nếu 32 Program có cùng kích thước, riêng compile tuần tự đã có lower-bound khoảng
4,28 s trên target. Trong phép tải 200 lần: scan tăng 28, `scan_overrun` và IOP
timeout không tăng, `seq_errors` tăng 4, `max_iop_poll_gap_ms` giữ 25,184 ms,
nhiệt độ 47,75 → 48,93 °C. Khoảng idle gần đó cũng tăng 1 sequence error, nên
chưa đủ bằng chứng quy lỗi sequence cho compiler.

Nhận định: compiler hiện đủ nhanh cho package nhỏ/trung bình, nhưng latency tăng
tuyến tính theo số Program. Điểm tối ưu sau khi bảo vệ RT là cache theo content
hash và process pool giới hạn, không phải JIT trong Core.

## 5. Phân tích cycle time

### 5.1 Ba đại lượng không được đánh đồng

| Đại lượng | Ý nghĩa | Hiện trạng |
|---|---|---|
| Execution time | CPU chạy bytecode bao lâu | HOST sub-ms; TARGET max-IR tuần tự mean 2,00–2,05 ms |
| Program period | Bao lâu Program được release một lần | 1/5/30 s |
| Physical response latency | Input vật lý đổi tới output vật lý đổi | Chưa có HIL hiện hành |

Task production được dựng với period 1.000 ms và budget 199 ms:
[`main.cpp`](../../../apps/core/bootstrap/main.cpp#L440). Program period 5 s và
30 s vẫn được release theo deadline riêng bên trong Task này.

Read-back live xác nhận Task period 1.000 ms/budget 199 ms; Task max execution
111,714 µs, Program max 46,086 µs và không overrun. Ngược lại, source Active mô
tả `Task = 50ms` và các bước 100/250/500 ms nhưng `programConfig.periodMs`
thực tế là 1.000 ms do profile. Hành vi relay vì vậy chậm hơn ý nghĩa comment
khoảng 10–20 lần và phải được coi là sai lệch cấu hình/identity, không phải
bằng chứng cycle 50 ms.

Với Program 1 s:

- input đổi ngay trước capture có thể được xử lý trong scan kế cận;
- input đổi ngay sau capture phải chờ gần một base step;
- scheduling latency trung bình xấp xỉ 0,5 s;
- worst case phần mềm xấp xỉ 1 s cộng IOP polling, priority/safety và thời gian
  thiết bị chấp hành.

Enable/Disable cũng chờ safe boundary. Bằng chứng target lịch sử ngày 2026-08-24
đo sáu lượt là 918–959 ms và 10 Program có `maxExecNs=45.503`, nhưng service dùng
`mkddc-fakemcu`; không được gọi đây là physical HIL:
[`2026-08-24-foxlinx-plan59-corrective-deploy.md`](../test-evidence/fw-som/2026-08-24-foxlinx-plan59-corrective-deploy.md#L60).

### 5.2 Tác động Published Signal

Signal bus commit trước khi Program chạy. Consumer trong cycle N đọc giá trị
producer đã hoàn tất ở cycle N−1. Hai Program 1 s nối chuỗi có thể vì vậy cộng
thêm khoảng một cycle; với consumer 5 s hoặc 30 s, latency phụ thuộc deadline của
consumer. Đây là semantics tất định có chủ ý, không phải runtime chậm ngẫu nhiên.

## 6. Findings source và TARGET

### `F-PRG-PERF-001` — P0 trước release: budget WCET không được Core enforce

**Kịch bản hỏng:** Check chấp nhận 16 Program 1 s, mỗi Program có budget 200 ms;
tổng budget khai báo là 3,2 s trong khi Task production chỉ có 199 ms. Khi cùng
đến hạn, topology đã Check PASS vẫn có thể overrun và sau ba lần liên tiếp làm
mọi Program trong Task chuyển `FAULTED`.

**Dẫn chứng:**

- Backend nói rõ `BudgetUs` là trần suy từ profile, không phải WCET đo thật, và
  tính `periodMs × 20%` cho từng Program:
  [`checks_topology.go`](../../../apps/web-api/internal/programming/application/checks_topology.go#L29).
- Package ghi và đọc `program_budget_us`:
  [`st_package_v2.cpp`](../../../apps/core/application/st/st_package_v2.cpp#L350).
- Coordinator chỉ chuyển identity, IR và period; `PackageProgramSlice` không có
  budget:
  [`programming_runtime_coordinator.hpp`](../../../apps/core/application/programming/programming_runtime_coordinator.hpp#L120).
- `StProgramSetEntry` cũng không có budget:
  [`st_scheduler.hpp`](../../../apps/core/application/st/st_scheduler.hpp#L337).

**Ảnh hưởng:** admission control không bảo vệ task deadline; UI/manifest có thể
trình bày budget nhưng runtime không dùng nó.

**Owner/gate mở khóa:** Core + Compiler/BE; khóa `VS-PROG-009/012/013`, target
soak và release. Mở khi budget đi xuyên package→instance, có cumulative admission
tại mọi điểm giao deadline 1/5/30 s, runtime enforce per-Program/per-Task và có
Test Result target được review.

### `F-PRG-PERF-002` — P0 trước release: blocking persistence/reload trong scan và ngoài metrics

**Kịch bản hỏng:** tới lượt autosave hoặc SIGHUP, scan thread dựng JSON, ghi file,
`fsync`, `rename`, `fsync` thư mục hoặc reload nhiều file. Nếu eMMC chậm hơn margin
deadline, IOP poll có thể giãn tới safe-timeout, nhưng `scan_overrun` không phản
ánh phần việc sau `step()`.

**Dẫn chứng:**

- `after_scan` gọi snapshot mỗi 60 scan:
  [`main.cpp`](../../../apps/core/bootstrap/main.cpp#L643).
- Snapshot thực hiện blocking file I/O và hai `fsync`:
  [`state_snapshot.cpp`](../../../apps/core/adapters/persistence/state_snapshot.cpp#L108).
- `CoreMetrics::end_scan()` nằm trong `step()`, còn `after_scan` chạy sau đó:
  [`scan_loop.cpp`](../../../apps/core/application/runtime/scan_loop.cpp#L393).
- `clock_nanosleep()` không kiểm kết quả/retry `EINTR`:
  [`scan_loop.cpp`](../../../apps/core/application/runtime/scan_loop.cpp#L396).

**Ảnh hưởng:** hidden jitter, số đo overrun thiếu phạm vi và không an toàn để giảm
base step xuống 100/10 ms.

**Owner/gate mở khóa:** Core + Operations; khóa `VS-PROG-012/013/014/030` và
release. Mở khi non-RT worker chuẩn bị/persist, boundary chỉ swap O(1), metrics
phủ end-to-end, xử lý `EINTR`/missed deadline rõ và target instrumentation PASS.

### `F-PRG-PERF-003` — P1: multi-core engine chưa được nối vào production

**Kịch bản hỏng:** quảng bá 16 Program “chạy song song” dựa trên unit test hoặc
HOST benchmark, trong khi production không gọi `set_lane_mode(PARALLEL)` và mọi
Program vẫn ở lane mặc định 0.

Scheduler chỉ chạy đồng thời khi mode `PARALLEL`, có nhiều lane và worker đã tạo:
[`st_scheduler.cpp`](../../../apps/core/application/st/st_scheduler.cpp#L1040).
Worker hiện spin bằng `yield()`:
[`st_scheduler.cpp`](../../../apps/core/application/st/st_scheduler.cpp#L1114).

**Ảnh hưởng:** năng lực source supporting bị hiểu nhầm thành product capability;
bật thẳng có thể tạo tranh CPU/jitter vì chưa có affinity/priority/thermal/load
policy trên SOM.

**Owner/gate mở khóa:** Core + Operations + QA; khóa claim parallel/multi-core và
`VS-PROG-U05/U11`. Mở khi production topology gán lane có chủ ý, worker policy
được phê duyệt và 24 giờ target soak PASS.

### `F-PRG-PERF-004` — P2: Check/compile tăng tuyến tính theo số Program

**Kịch bản hỏng:** package 32 Program lớn tạo 32 process compiler nối tiếp, làm
Check latency tăng và tạo burst file I/O trên SOM; khi chạy đồng thời với Core có
thể kích hoạt risk tranh CPU/storage dù từng compile riêng vẫn nhanh.

**Owner/gate mở khóa:** BE + Operations; theo dõi qua `RSK-PROG-005` và
`VS-PROG-012/013/014`. Mở khi có content-address cache, bounded process pool,
cgroup/priority thấp hơn Core/IOBus và target load test chứng minh IOP gap.

### `F-PRG-PERF-005` — P1: Program miss tăng khi Task không miss và health vẫn xanh

**Kịch bản hỏng:** dashboard/alarm chỉ nhìn Task miss hoặc health có thể kết luận
runtime bình thường, trong khi Program đã tích lũy release miss. Trên board,
`missedReleaseCount` tăng 413 → 465, rồi 465 → 470 trong 48 giây; Task
`missedReleaseCount=0`, Program `consecutiveMissedRelease=0` và `HEALTHY`.

**Dẫn chứng source:** Task due bám `last_run_ns + period`, còn Program due bám
`next_release_ns` độc lập; Task kiểm trước rồi mới xét Program và tăng cumulative
miss khi trễ từ một period:
[`st_scheduler.cpp`](../../../apps/core/application/st/st_scheduler.cpp#L76),
[`st_scheduler.cpp`](../../../apps/core/application/st/st_scheduler.cpp#L86),
[`st_scheduler.cpp`](../../../apps/core/application/st/st_scheduler.cpp#L94),
[`st_scheduler.cpp`](../../../apps/core/application/st/st_scheduler.cpp#L1000).
Backend cố ý chỉ dùng consecutive miss để tính health:
[`programs.go`](../../../apps/web-api/internal/programming/application/programs.go#L383).

**Ảnh hưởng:** có thể là bỏ chu kỳ thật hoặc metric false-positive do lệch pha;
cả hai đều làm evidence timing không đáng tin và health không biểu lộ xu hướng.

**Owner/gate mở khóa:** Core + BE + QA; khóa `VS-PROG-009/015`,
`VS-PROG-U05` và target soak. Mở khi có test clock tất định cho Task=Program
period, đối chiếu số lần execute với release lý thuyết và alarm/health policy
được phê duyệt; 24 giờ target không tăng miss ngoài fault injection.

### `F-PRG-PERF-006` — P1: identity/cycle của Active Program không khớp ý nghĩa source

**Kịch bản hỏng:** kỹ sư đọc source `RelayPattern32` thấy `Task = 50ms`, các
step 100/250/500 ms và kỳ vọng output đổi ở tốc độ đó; Active Revision lại
cấu hình `periodMs=1000`, nên logic đếm step thực chạy chậm hơn comment khoảng
10–20 lần. Tên project `AHU-MASTER-SEQUENCE` nhưng Active chỉ chứa fixture relay
32 output, làm tăng nguy cơ vận hành nhầm chương trình dù runtime vẫn xanh.

**Dẫn chứng:** profile chỉ cho đúng 1/5/30 s:
[`product_profile_v2.json`](../../../contracts/programming/product_profile_v2.json#L10);
read-back TARGET ghi nhận Active/Draft sequence 22, Program `RelayPattern32` và
`periodMs=1000` trong phiên rà soát này.

**Ảnh hưởng:** comment/tên project không còn là chỉ báo tin cậy cho chu kỳ và
mục đích Active; người vận hành có thể nghiệm thu sai response time hoặc output.

**Owner/gate mở khóa:** Programming/Operations + QA; khóa target read-back
`VS-PROG-009/015` và HIL. Mở khi Commission preflight hiển thị source identity,
period effective và chặn/yêu cầu xác nhận khi timing declaration không khớp
profile; fixture relay được chuyển sang project lab có định danh rõ.

### `F-PRG-PERF-007` — P1: TARGET có hai vòng auto-restart ngoài MK-DDC

**Kịch bản hỏng:** benchmark ghi tail 19,85–41,14 ms và có thể quy cho scheduler,
trong khi board đồng thời spawn process lỗi và ghi journal mỗi 5/10 giây.
`masscan-agent.service` đã restart 234.683 lần, trỏ executable không tồn tại;
`AgentSvr-agent.service` đã restart 1.526 lần, chạy binary x86-64 trên aarch64.
Cả hai unit enabled; file `AgentSvr` còn đổi mtime giữa hai lần kiểm tra.

**Ảnh hưởng:** provenance môi trường và tail/jitter không được kiểm soát; chưa có
bằng chứng để quy đuôi xấu hoàn toàn cho lane parallel hoặc dùng số max làm WCET.
Không có dữ liệu trong phiên này để kết luận nguồn gốc hay gán nhãn mã độc.

**Owner/gate mở khóa:** Operations + Security; ánh xạ `RSK-PROG-005`,
`VS-PROG-012/013/014`. Mở khi owner xác nhận inventory service, dùng image
sạch/đã ký, dừng vòng restart có kiểm soát và chạy lại benchmark cùng governor,
nhiệt độ, load và journal capture. Không dừng/xóa unit trong phiên review này.

## 7. Cô lập fault và giới hạn multi-program

Runtime fault của một Program không dừng Program còn lại trong lane/Task:
[`st_scheduler.cpp`](../../../apps/core/application/st/st_scheduler.cpp#L984).
Tuy nhiên, ba task overrun liên tiếp làm tất cả Program đang `RUNNING/WAITING`
trong Task `main` chuyển `FAULTED`:
[`st_scheduler.cpp`](../../../apps/core/application/st/st_scheduler.cpp#L1085).

Do production chỉ có một Task `main`, một Program ăn quá nhiều CPU có blast
radius tới toàn package. Vì vậy kết luận chính xác là:

- **cô lập runtime fault từng Program:** có;
- **cô lập WCET/task overrun từng Program:** chưa đầy đủ;
- **nhiều Program được schedule:** có;
- **thực thi multi-core production:** chưa có.

## 8. Phân tích cạnh tranh

Không có chuẩn chung để so “số Program” giữa các hãng: một hãng đếm application,
control block, point hoặc object khác nhau. Vì vậy báo cáo chỉ so những thuộc
tính có cùng nghĩa: phân khúc, I/O, protocol, cycle và khả năng standalone.

| Phân khúc | Khả năng MK-DDC-24 hiện tại | Nhận định |
|---|---|---|
| FCU/VAV/AHU nhỏ, DDC compact 24 điểm | Kiến trúc phù hợp; 1 s chấp nhận được cho nhiều loop HVAC chậm | **Tiềm năng trung bình-cao sau HIL/release** |
| Plant controller nhỏ/trung bình | ST/FBD và multi-program tốt; protocol/library/certification còn yếu | **Trung bình** |
| Controller tích hợp tòa nhà lớn | Capacity/ecosystem/supervisory chưa cùng cấp incumbent | **Thấp-trung bình** |
| PLC tốc độ cao/motion/safety | Min period 1 s, không thuộc scope Product | **Không cạnh tranh và không nên định vị** |

Đối chiếu nguồn chính hãng tại ngày lập record:

- [Schneider Electric SpaceLogic MP-C](https://www.se.com/us/en/product-range/106275370-spacelogic-mpc-controller/)
  là controller BACnet/IP lập trình tự do cho HVAC/plant room; dòng sản phẩm có
  các cấu hình 15–36 I/O.
- [Siemens Desigo PXC4/PXC5/PXC7](https://sid.siemens.com/r/A6V13495554/21610799243___en-US_21610927115)
  định vị PXC4 cho plant nhỏ/trung bình và PXC5/PXC7 cho ứng dụng hiệu năng,
  mở rộng và tích hợp lớn hơn.
- [Johnson Controls PCA](https://docs.johnsoncontrols.com/bas/r/Facility-Explorer/en-US/FX-PCA-Advanced-Application-Programmable-Controller-Catalog-Page/PCA-Programmable-Controllers)
  hỗ trợ tùy model BACnet/SC, BACnet/IP, MS/TP hoặc N2 và standalone schedule,
  alarm, trend.
- [Beckhoff CX7000](https://download.beckhoff.com/download/Document/ipc/embedded-pc/embedded-pc-cx/cx7000_en.pdf)
  công bố 250 µs trong điều kiện tối ưu và khoảng 1 ms với I/O bus thực tế. Đây
  là PLC benchmark, không phải cùng phân khúc DDC HVAC.

### 8.1 Điểm có thể tạo khác biệt

- Artifact có chữ ký và identity Revision rõ.
- Commission tại safe boundary, prepared set và rollback/LKG.
- Runtime fail-closed, typed IR, bounded resource.
- Một output chỉ có một owner và vẫn qua Priority Resolver/Safe State.
- ST/FBD dùng cùng semantic/runtime.
- Programming web tích hợp trực tiếp vào DDC compact.

### 8.2 Khoảng cách thị trường

- Cycle tối thiểu 1 s chưa phục vụ fast pressure/flow loop.
- Programming point scope và protocol integration hẹp hơn incumbent.
- Control Library, commissioning tooling, analytics/trend và hệ sinh thái
  integrator chưa trưởng thành tương đương.
- TARGET đã có benchmark exploratory nhưng binary production provenance còn PARTIAL; physical HIL, power-cut và 24 giờ soak vẫn chưa có.
- Không được claim `IEC 61131-3 compliant/certified`; dự án chỉ có subset
  IEC 61131-3-aligned theo Product authority.

## 9. Lộ trình cải thiện tối đa

### 9.1 P0 — làm trước mọi claim cycle nhanh hơn

1. Chuyển snapshot/reload/JSON/`fsync` khỏi scan thread; boundary chỉ nhận handle
   đã chuẩn bị và swap bounded O(1).
2. Đo toàn vòng input capture → Program → priority/safety → output publish → IOP
   acknowledgement; `after_scan` không được nằm ngoài budget.
3. Xử lý `EINTR`, scan trễ và missed base step bằng policy explicit; không chạy
   một scan sớm rồi tạo khoảng trống dài.
4. Đưa `budget_us` vào runtime instance và enforce per Program.
5. Admission control tính cumulative WCET của mọi Program cùng đến hạn tại bội
   chung 1/5/30 s; không chỉ kiểm 20% từng Program độc lập.
6. Program vượt WCET phải bị cô lập trước; task-level fault chỉ dùng cho lỗi
   scheduler/hạ tầng thực sự.

### 9.2 Mục tiêu sản phẩm khả thi

Giữ `1/5/30 s` cho HVAC loop thông thường và thêm fast tier **100 ms** sau khi P0
đóng. Gate định lượng đề xuất:

- p99,9 toàn scan `<70%` period;
- max scan `<90%` period trong workload được duyệt;
- `max_iop_poll_gap <=100 ms`;
- 0 heap/filesystem/DB/HTTP/DNS/blocking trong RT path;
- 16 Program/3 period chạy 24 giờ, không có ba deadline miss liên tiếp;
- concurrent Check không làm MCU safe-timeout hoặc Core restart;
- AO/DO vật lý có waveform và read-back đúng.

### 9.3 Multi-core production

Không bật nguyên trạng chỉ vì HOST nhanh. Cần:

- gán lane từ topology/package hoặc policy có version;
- persistent worker pin core, priority và watchdog rõ;
- cô lập compiler/Web/DB khỏi CPU dành cho Core/IOBus;
- deterministic merge và Published Signal semantics giữ nguyên;
- benchmark trên SOM với governor, nhiệt độ và tải production.

TARGET hiện chỉ nhanh hơn 1,06–1,18 lần theo mean và có tail tới 41,14 ms. Không
đặt claim tăng tốc trước khi worker policy, affinity và soak chứng minh lợi ích.

### 9.4 Stretch 10 ms

Cycle 10 ms chỉ hợp lý cho một fast Task giới hạn 1–2 Program và cần PREEMPT_RT
hoặc latency tương đương đã đo, CPU isolation, fast I/O path, không persistence
hay network trên core đó và HIL bằng logic analyzer. Dù đạt 10 ms, MK-DDC-24 vẫn
không nên quảng bá như motion/safety PLC.

### 9.5 Compiler/Check

- Cache theo source hash + library lock + profile + target ABI.
- Process pool cố định, tối đa hai compiler worker trên SOM.
- Cgroup/nice thấp hơn Core/IOBus, bounded queue và disk watermark.
- Compile Program độc lập song song nhưng merge diagnostic/package theo order
  tất định.
- Không dùng JIT trong Core: execution CPU hiện không phải nút thắt, còn JIT làm
  tăng bề mặt an toàn, memory và tính tái lập.

## 10. Ánh xạ risk và verification hiện hành

Record không tạo authority song song. Findings được ánh xạ vào các risk đang
Open thay vì tự giảm residual:

| Finding | Risk liên quan | Verification cần |
|---|---|---|
| `F-PRG-PERF-001` | `RSK-PROG-001/002/019` | `VS-PROG-009/012/013`, `VS-PROG-U05` |
| `F-PRG-PERF-002` | `RSK-PROG-003/005/009` | `VS-PROG-012/013/014/030` |
| `F-PRG-PERF-003` | `RSK-PROG-017/018/021` | `VS-PROG-U05/U06/U11` |
| `F-PRG-PERF-004` | `RSK-PROG-005` | `VS-PROG-012/013/014` |
| `F-PRG-PERF-005` | `RSK-PROG-002/018` | `VS-PROG-009/015`, `VS-PROG-U05` |
| `F-PRG-PERF-006` | `RSK-PROG-002/006` | `VS-PROG-009/015`, HIL read-back |
| `F-PRG-PERF-007` | `RSK-PROG-005` | `VS-PROG-012/013/014`, clean-target rerun |

Nguồn trạng thái:

- [Programming Risk Register](../PROGRAMMING_RISK_REGISTER.md)
- [Programming Verification Plan](../../05_verification/PROGRAMMING_VERIFICATION_PLAN.md)
- [Verification authority](../../05_verification/VERIFICATION.md#L61)
- [Release Record 2026-08-23](../PROGRAMMING_RELEASE_RECORD_2026-08-23.md)

## 11. Trạng thái bằng chứng

| Lớp | Trạng thái | Kết luận được phép |
|---|---|---|
| Source review | **DONE tại commit đã ghim** | Có multi-program, period riêng, lane supporting và bốn finding source/contract |
| HOST test | **DONE tập trung** | 59/59 C++ PASS; Go Programming PASS |
| HOST benchmark | **DONE exploratory** | Interpreter có dư địa CPU trên Xeon; không phải controlled Test Result |
| Browser | **NOT_RUN — N/A** | Record không đổi/review UI runtime |
| TARGET harness từ HEAD | **DONE exploratory** | Hai lượt ARM64, 0 fault; không phải controlled Test Result |
| TARGET production live | **PARTIAL** | Runtime/compiler/service đã đo; binary live chưa truy nguyên tới HEAD |
| TARGET environment | **NOT_CONTROLLED** | Hai unit ngoài MK-DDC auto-restart 5/10 s; tail/jitter có nhiễu |
| TARGET I/O | **FakeMCU only** | Không nâng thành physical HIL |
| HIL vật lý | **NOT_RUN** | Không có AO/DO/MCU thật/waveform |
| 24 giờ/power-cut | **NOT_RUN** | Không chứng minh stability/RETAIN/LKG |
| Release | **NO-GO** | Không phát hành/không claim production-ready |

## 12. Kết luận cuối

Lõi Program Runtime có thiết kế tốt cho DDC: typed IR, bounded execution,
prepared activation, rollback, output arbitration và multi-program identity rõ.
Benchmark HOST và TARGET cho thấy interpreter còn dư địa lớn ở profile 1 s; tối
ưu opcode/JIT không phải ưu tiên đúng lúc này. Quan sát live đồng thời phát hiện
release miss tích lũy không hiện trên health và mismatch identity/cycle.

Ưu tiên cạnh tranh phải là:

1. sửa budget/admission end-to-end;
2. loại blocking I/O và metric blind spot khỏi scan;
3. làm rõ và sửa Program release miss/health visibility;
4. khóa identity và period effective ở Commission/read-back;
5. chứng minh 16 Program/3 period trên target 24 giờ;
6. chỉ đưa lane multi-core vào production khi target chứng minh có lợi;
7. thêm fast tier 100 ms với physical HIL;
8. hoàn tất ecosystem/protocol/library/certification evidence.

Verdict chính xác tại `main@67f8ca3`: **GO cho tiếp tục engineering/pilot lab;
NO-GO cho release hoặc claim cạnh tranh production**.

## 13. Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-04 | Tạo record từ review source, benchmark HOST, phân tích cycle/multi-program, finding hiệu năng và đối chiếu cạnh tranh; giữ TARGET/HIL/release đúng `NO-GO` |
| 1.1 | 2026-09-04 | Đo trực tiếp Forlinx: hai lượt runtime ARM64, compiler load, service/API read-back; thêm `F-PRG-PERF-005/006/007`, hạ provenance live xuống PARTIAL và giữ HIL/release `NO-GO` |
