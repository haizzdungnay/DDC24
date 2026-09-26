# Audit FBD/ST Function Block → DO Modbus trên Foxlinx

**ID:** EV-PROG-FBD-ST-MB-20260925  
**Ngày:** 2026-09-25  
**Trạng thái:** Lượt 1, 2 và 3 đã đo trên target. Theo luật của chủ sở hữu ("tìm ra lỗi là sửa, commit, deploy ngay"): F01, F04, F05, F05c, F06, F07, F08, F10, F11, F12 đã sửa, deploy và kiểm trên Foxlinx; F09 kết luận không phải lỗi. F02 đóng bằng ADR-061 (base step 10 ms, tập chu kỳ {10…50000} ms; lượt 3 đo C1–C3 PASS trên target). C4 vẫn FAIL: kernel non-RT, PREEMPT_RT chờ BSP Forlinx (G2). Chỉ các mục có số đo hoặc phản hồi thật mới được coi là bằng chứng.  
**Workspace:** bắt đầu từ `main@e8a14ff0`; binary đang chạy trên bo build từ nhánh `fix/programming-modbus-command-seq-20260925` (chưa commit): core `222dbe9e…`, iobus `2439512b…`, web `5c5861e3…`, FE `index.html` `8e86b065…`.  
**Đích:** `OK1126B-buildroot` (Forlinx OK1126B-S, Rockchip RV1126B 4×Cortex-A53 1,296 GHz, RAM 2 GB, Linux 6.1.141 `PREEMPT_VOLUNTARY`, HZ=250), `mekong-fac.ddns.net:2223`, web `:8082`.

## Mục tiêu và cách đánh giá

- Một Program FBD và một Program ST cùng dùng một Function Block, ánh xạ ra DO Modbus trên bo; ban đầu mong muốn khoảng đổi trạng thái 10–100 ms.
- Tách số đo theo lớp: chu kỳ logic tại Core, lệnh FC05 trên RS-485, readback coil qua API và đầu ra vật lý. Không dùng một con số thay cho nhiều lớp.
- Giữ nguyên Project/Draft/Revision/DO có sẵn ngoài thử nghiệm; lưu danh tính và trạng thái trước khi đụng runtime; sau thử nghiệm đọc lại và khôi phục.
- Kiểm tra luồng tạo/sửa → Check → Commission → Enable → monitor/trace → Disable/Restore; ghi PASS/FAIL/NOT RUN cùng mã lỗi, log service và hiệu năng thực đo. Không gọi target là HIL khi chưa có phép đo điện vật lý.

## Tiêu chí chu kỳ bộ điều khiển — spec "cycle 10 ms"

Chủ sở hữu chốt ngày 2026-09-25. **Vi phạm bất kỳ tiêu chí nào là lỗi (FAIL)**, xét trên giá trị lớn nhất và số lần vi phạm của toàn cửa sổ đo, không lấy trung bình và không làm tròn.

| Mã | Tiêu chí | Cách đo |
|---|---|---|
| C1 | Chu kỳ cơ sở của Core là 10 ms. Tập chu kỳ Task/Program cho phép **đúng bằng** {10, 50, 100, 500, 1000, 5000, 10000, 50000} ms (chủ sở hữu chốt 2026-09-26). Chu kỳ nhỏ hơn 10 ms, hoặc không thuộc tập này, phải bị API và Check từ chối. | `core.base_step_ms`, `GET /programming/capabilities`, thử khai 5 ms và 30000 ms phải nhận 400 |
| C2 | Mỗi chu kỳ chạy xong trong chu kỳ của nó: overrun = 0. | `overrunCount`, `maxExecNs` so với ngân sách |
| C3 | Không lỡ release: mỗi Program chạy đúng một lần trong mỗi chu kỳ của nó; missed release = 0. | `missedReleaseCount` của từng Program, đối chiếu dấu thời gian chạy thật |
| C4 | Lệch nhịp đánh thức của mỗi chu kỳ ≤ 100 µs so với mốc tuyệt đối. | `core.jitter max_us` từng phút; `cyclictest` trên lõi chạy Core, có tải và không tải |

**Phạm vi:** logic, process image và I/O cục bộ của bộ điều khiển.

**Loại trừ:** I/O mở rộng qua truyền thông (Modbus RTU/TCP, BACnet và các thiết bị truyền thông mở rộng khác). Thời gian của chúng phụ thuộc chuẩn giao thức và tốc độ truyền, nên có spec riêng ở mục "Tách lớp". Program dùng I/O mở rộng vẫn phải đạt C1–C4 ở phần logic. Giá trị gửi ra thiết bị mở rộng là **giá trị mới nhất tại lúc phát trên bus**; mọi thay đổi nhanh hơn nhịp cập nhật của bus có thể bị gộp.

## Đánh giá hiện trạng theo tiêu chí

| Mã | Số đo thật | Kết luận |
|---|---|---|
| C1 | `core.base_step_ms=1000` (log khởi động 15:38:40); capabilities `taskPeriodsMs=[1000,5000,30000]`, `tasks=1` | **FAIL** (F02) |
| C2 | Task `maxExecNs` 16 918 ns; Program FBD tối đa 7,0 µs, ST 6,1 µs; `overrunCount=0` | PASS, dư rất lớn |
| C3 | Trong 144 chu kỳ 1000 ms: Core tự đếm `missedReleaseCount` **23** (FBD) và **30** (ST), ứng với 24 và 32 chu kỳ không có FC05, tức 16,7% và 22,2% | **FAIL** (F01) |
| C4 | `core.jitter max_us` từng phút 105–127 µs lúc rảnh, 268 µs khi có tải; `cyclictest` chu kỳ 10 ms ghim CPU3: tối đa 470 µs (rảnh) và 251 µs (tải CPU/VM ở CPU0–2), có 15/6000 và 13/6000 lần vượt 100 µs; `cyclictest -S` 1–2,5 ms: tối đa 3 200 µs | **FAIL** (F03) |

**Kết luận:** với bản đang chạy, sản phẩm **không được ghi "cycle 10 ms"**. Ba lỗi phải xử lý là F01, F02, F03. CPU không phải nút thắt: logic chỉ tốn vài µs trên ngân sách 10 ms.

## Tách lớp: bộ điều khiển và I/O mở rộng Modbus

| Lớp | Đại lượng | Số đo (cửa sổ 16:14:36–16:17:02 UTC) | Kết luận |
|---|---|---|---|
| Logic Core | Chu kỳ 1000 ms, thời gian chạy | FBD 5,8–7,0 µs; ST 2,0–6,1 µs; lỡ 16,7–22,2% release | Chạy nhanh nhưng lỡ nhịp (F01) |
| Lệnh FC05 trên RS-485 | Thời gian một giao dịch | Trung vị 29,0 ms, tối đa 34,8 ms; 234/234 ACK; 0 timeout/CRC | PASS lớp truyền |
| Bus 9600 8N1 | Mức bận | 20,7% khi 2 DO đổi mỗi giây (nền poll 15,9%) | PASS |
| Core → FC05 | Độ trễ từ lúc Program chạy tới lúc phát lệnh | Điển hình ~377 ms (luồng `fb-publish` quét lệnh mỗi 100 ms, luồng bus tỉnh tối đa mỗi 200 ms) | Ghi nhận; tối ưu ở G7 |
| Readback coil → API | Từ lúc có FC05 tới lúc API thấy giá trị mới | Trung vị 712 ms, p95 ~1,8 s, tối đa ~2 s (FC01 poll mỗi 1000 ms) | PASS chức năng |
| Đầu ra vật lý | Mức điện tại tiếp điểm relay | Không có dụng cụ đo | **NOT RUN**, không phải HIL |

**Công thức thời gian một giao dịch Modbus RTU** (dùng cho spec I/O mở rộng):

`t_tx ≈ (N_req + N_resp) × bit/ký tự ÷ baud + 2 × t3.5 + t_slave`

Trong đó t3.5 bằng 3,5 ký tự khi baud ≤ 19 200 và cố định 1,75 ms khi baud lớn hơn. Sức chứa của cả bus xấp xỉ `1000 / t_tx` giao dịch mỗi giây, chia chung cho mọi thiết bị trên dây.

| Baud (8N1) | FC05, 16 byte | Sức chứa bus | Nguồn số liệu |
|---|---|---|---|
| 9 600 | ~29 ms | ~34 giao dịch/s | **Đo** (t_slave + trễ OS ≈ 5 ms) |
| 19 200 | ~17 ms | ~58 giao dịch/s | Ước lượng, giữ t_slave 5 ms |
| 38 400 | ~13 ms | ~78 giao dịch/s | Ước lượng; cần datasheet CK-508 |
| 115 200 | ~10 ms | ~100 giao dịch/s | Ước lượng; cần datasheet CK-508 |

Hệ quả: dù ở 115 200 baud, một DO Modbus cũng **không thể theo kịp chu kỳ 10 ms**. Đây là giới hạn vật lý của chuẩn truyền, không phải lỗi của bộ điều khiển, và vì vậy spec phải tách hai lớp. Ví dụ ở 9 600 baud: một DO đổi mỗi 100 ms tốn khoảng 29% bus; một module 8 DO ghi gộp bằng FC15 mỗi 100 ms tốn khoảng 30%.

## Nhật ký theo thời gian (UTC)

| Thời điểm | Bước | Kết quả / bằng chứng | Trạng thái |
|---|---|---|---|
| 15:16–15:18 | Preflight board và API | `mkddc-core`, `mkddc-iobus`, `mkddc-web-pi` active, mỗi unit `NRestarts=0`; SHA256 executable lần lượt `7b09dbaa…`, `a4e62291…`, `8707e9ed…`; health 6/6 `ok`. Bus `rs485-1` 9600 8N1 RUNNING, 4/4 slave online, p50/p95 giao dịch 26/27 ms, utilization 16,15%, bộ đếm timeout/CRC/total error đều 0. | PASS cho preflight, chưa chứng minh ghi DO |
| 15:17–15:18 | Đọc authority Programming | Chỉ có Project `AHU-MASTER-SEQUENCE` (`e96357dc…`), Active Revision `69b6ba15…`; task Core period 1000 ms, state RUNNING, overrun 0. Program FBD đang RUNNING có period 30000 ms, dùng FB `FB_DO_BLINK_100MS_V1` nhưng ánh xạ `CK50804-DO1`; Draft hiện có thay đổi khác và Check cuối FAILED lúc 12:50:58 UTC. | PASS cho đọc trạng thái; giữ nguyên WIP |
| 15:17 | Kiểm giới hạn profile | `GET /programming/capabilities`: `taskPeriodsMs=[1000,5000,30000]`, một Project/một Task. Chu kỳ 10–100 ms hiện không được contract Rev A chấp nhận. | BLOCKED đối với tiêu chí 10–100 ms trên runtime hiện tại |
| 15:18 | Đọc intent và Point | FBD hiện `desiredEnabled=true`, Core RUNNING; hai intent cũ có `runtimeState=FAULTED`, nguồn LAST_KNOWN, không nằm trong Revision active. `CK50804/05-DO1/DO2`, `CK50906/07-DO1/DO2` đều GOOD và đọc 0 ở thời điểm lấy mẫu. | PASS cho quan sát; chưa tác động output |
| 15:19–15:37 | Sửa `MBA-FW-08` trên nhánh `fix/programming-modbus-command-seq-20260925` | Thêm `ext_cmd_seq` vào `plc_shm` v7; Core cấp số thứ tự khi có intent mới, iobus chỉ enqueue số mới và không xoá dedup sau drop. Kiểm tra test drop → không tái phát dù `dirty=1` → lệnh mới cùng giá trị được gửi. Build host Release MODBUS/BACNET/HMI và `ctest` **1513/1513 PASS** (2 skipped); cross build ARM core/iobus/web PASS. | PASS ở source/host; chưa deploy |
| 15:20–15:37 | Kiểm tra Go độc lập | `go vet ./...` PASS; `go test ./... -count=1` FAIL bốn test Programming về thư viện Project trong bundle và chặn publish Function Block thiếu layout. Các package `internal/app` và `internal/modbusrtu` PASS; đây là finding cần sửa trong phạm vi audit Programming. | FAIL, đang điều tra |
| 15:37 | Cổng tương thích target | Board glibc 2.41, libstdc++ tới GLIBCXX_3.4.30; hai binary C++ ARM dùng tối đa GLIBC_2.38, GLIBCXX_3.4.29. Đường service thực: `/usr/sbin/mkddc-core`, `/usr/sbin/mkddc-iobus`, `/opt/mkddc-web/mkddc-web`. | PASS kiểm tĩnh; chưa xác nhận khi chạy |
| 15:38–15:39 | Deploy `MBA-FW-08` lên board lab | Sao lưu 3 binary cũ vào `/data/mkddc/deploy-backups/2026-09-25T1537Z-mbafw08/`; đối chiếu SHA256 staging rồi dừng web/core/iobus, cài 3 binary và chạy iobus→core→web có rollback tự động khi lỗi. SHA256 `/proc/MainPID/exe`: core `222dbe9e…`, iobus `2439512b…`, web `5c5861e3…`; cả 3 `ActiveState=active`, `NRestarts=0`, không có executable `(deleted)`. `/dev/shm/mkddc_plc_shm` 24128 byte (v7), health 6/6 `ok`. | PASS triển khai/provenance ban đầu; đang theo dõi runtime |
| 15:39–15:43 | Đóng lỗi Go test Programming | Bốn test đỏ là fixture/assertion cũ sau thay đổi hợp đồng seal/publish: fixture bundle nay có POU tham chiếu Project Library thật; test publish xác nhận layout 0 byte authoritative do store sinh. `go vet ./...` và `go test ./... -count=1` đều PASS toàn bộ package. | PASS host; không đổi logic Go sản phẩm |
| 15:42–15:44 | UI Programming trên Chrome thật | Đăng nhập vào `:8082/eng/programming`, Overview hiển thị Active #52 RUNNING, Draft #57 Check failed; Console 0 message, 30 request đầu 29 HTTP 200 và 1 đang pending. Phát hiện `safeStateNoControllerOnly` bị UI mô tả là “chưa có output vật lý” dù Core chỉ giữ AO/DO cục bộ ở safe-state và FBD có thể ghi DO Modbus. Ảnh trước sửa `/tmp/ddc-goal-overview-before-20260925.png`. | FAIL nội dung vận hành; đang sửa/triển khai FE |
| 15:44–15:47 | Sửa diễn giải safe-state và cổng build FE | Overview/Runtime/Commission nói rõ phạm vi AO/DO cục bộ, DO Modbus phải đọc riêng; test tập trung 77/77 PASS. Cổng lint/typecheck toàn FE ban đầu đỏ bởi 17 lỗi import/`any` và thiếu kiểu Node/ES2022 ở các tệp Programming đã có; đang sửa để tạo build deploy được. | PARTIAL, chờ full gate |
| 15:47–15:50 | Full gate FE và mẫu ST | Sửa các lỗi type/lint đã nêu, đồng bộ test Workbench theo cột Watch hiện hành. Full FE Vitest **3439/3439 PASS**, lint PASS, build Foxlinx PASS (chunk Programming gzip 74,33 KiB < 165 KiB). Mẫu ST dùng FB `TON` biên dịch bằng `mkddc-st-compile` ký với khoá thử nghiệm host: 664 byte, 6 instruction, 0 diagnostic; chưa có mapping/Commission target. | PASS host; ST target NOT RUN |
| 15:47–15:53 | Runtime target sau deploy P0 | Task period 1000 ms, 514→870 lượt, maxExec 14,876 µs, overrun/missed 0; 4 slave online ~514–515 polls mỗi slave, total/error/timeout/CRC/write_failed/write_dropped đều 0. Frame Monitor có FC05 slave 4 addr 0 ACK `elapsedUs=28690` lúc 15:47:12 UTC. `safeStateNoControllerOnly=true` cùng lúc, minh chứng UI cũ diễn giải quá phạm vi. `GET /points/CK50804-DO1` GOOD, value 0 lúc 15:53:09. Không có phép đo điện tại chân DO. | PASS quan sát Core/FC05/readback API; vật lý NOT RUN |
| 15:51 | Triển khai FE lần 1 | Sao lưu `index.html` cũ tại `/data/mkddc/deploy-backups/2026-09-25T1550Z-programming-fe/`; `index.html` mới SHA256 `fb6a11db…`, asset nạp 200. Chrome Overview và Runtime hiển thị đúng phạm vi AO/DO cục bộ, Console 0 lỗi. | PASS FE bước 1 |
| 15:52–15:54 | Sửa lỗi giả `NETWORK_ERROR` ở Check & Commission | Khi URL chưa có `checkId`, `useProgrammingCheck` trước đây reject tại client dù không gửi request; Chrome hiển thị Error log `NETWORK_ERROR` trong khi Network đều 200. Hook nay không fetch và trả trạng thái chờ sạch tới khi có ID; test tập trung 31/31 PASS, lint/build PASS. Deploy FE lần 2, `index.html` SHA256 `8e86b065…`, rollback tại `/data/mkddc/deploy-backups/2026-09-25T1553Z-programming-fe-check-idle/`. Chrome trang Check & Commission sau sửa hiện “No errors recorded”, Console 0, request tải 200. | PASS source/host/target/browser |
| 16:04–16:08 | Tiếp quản phiên, preflight lại, chụp trạng thái | 3 service giữ nguyên SHA256 như 15:39, `NRestarts=0`, `ActiveEnterTimestamp` 15:38:40. Chụp Project: Active #52 `69b6ba15…`, Draft #57 `abca3a13…` (base `e39fe50a…`, `dirty=false`); Check cuối `f90e1433…` FAILED do `PRG-ERR-MAP-003`/`ST-IOMAP-001` (binding `DO_01` trỏ tới biến không có khối OUTPUT trên FBD) kèm 8 cảnh báo `PGM-MAP-UNIT-001`. DO nền: `CK50804-DO3=1`, mọi DO khác 0; override rỗng. | PASS chụp trạng thái trước khi tác động |
| 16:12 | Draft thử nghiệm lượt 1 (lỗi cố ý) | Tạm gỡ Program WIP `5619efde…` khỏi Draft; thêm FB `FB_AUDIT_TOGGLE` (ST), Program FBD `AUDIT_FBD_DO` → `CK50804-DO2`, Program ST `AUDIT_ST_DO` → `CK50804-DO4`, cả hai chu kỳ 1000 ms. ST cố ý đọc `Toggle.QX`. Revision `bbef83ba…`, Check FAILED sau 1,16 s: `PRG-ERR-CHECK-001`/`ST-SEM-013` “'QX' is not an output of FB_AUDIT_TOGGLE”, dòng 9 cột 15, đúng vị trí. | PASS chẩn đoán |
| 16:13 | Draft thử nghiệm lượt 2 | Sửa ST thành `Toggle.Q`; Revision `cfe17ec5…`, Check `9e2848b1…` PASSED sau 0,64 s, 0 diagnostic; artifact 2240 byte, SHA256 `fc43b0a4…`, `fwsom-st-1.2.0`, library `rev-a.4`. | PASS FBD + ST dùng chung FB |
| 16:14:20 | Commission | Impact có `outputMappingChanges`, `programSet`, `enableIntent` (đủ 3 ack). Operation `1a8eeaf9…` SUCCEEDED sau 1,64 s (server 1,42 s). Hai Program mới ở DISABLED vì chưa có intent. | PASS |
| 16:14:36 | Enable | PUT intent cho hai Program → RUNNING, `CORE_LIVE`; FBD `lastExecNs` 5 834, ST 2 042; task `maxExecNs` 16 626, overrun 0. | PASS |
| 16:14:56 | Trace 60 s, yêu cầu mẫu 100 ms | Trace `1c5cc23f…` chạy theo đường dự phòng (poll monitor): mẫu cách nhau ~2 s, `programValue=null`; `GET /runtime/monitor` mất 1,97 s. | FAIL (F05) |
| 16:14–16:17 | Đo 3 lớp trong 144 chu kỳ | Xem mục "Tách lớp". FC05 cho DO2/DO4: 121 và 113 lệnh, khoảng cách 666–2334 ms thay vì 1000 ms; thiếu 24 và 32 chu kỳ. Core tự đếm `missedReleaseCount` 23/30 nhưng `health=HEALTHY`, `consecutiveMissedRelease=0`, task `missedReleaseCount=0`. | FAIL C3 (F01) |
| 16:17:01 | Disable | Hai Program → DISABLED (`CORE_LIVE`); `CK50804-DO2` **giữ 1**, DO4 = 0. | Runtime PASS; hành vi output ghi F06 |
| 16:17:34 | Restore về #52 | Operation `18467864…` SUCCEEDED 2,18 s, Active = LKG = `69b6ba15…`. Nhưng task `STOPPED` và Program `136d8ab2…` DISABLED ở Core dù `desiredEnabled=true`; trước thử nghiệm nó đang RUNNING. | FAIL (F04) |
| 16:20–16:21 | Đo độ trễ đánh thức của OS | `cyclictest -m -S -p75 -i1000 -D30`: trung bình 14–16 µs, tối đa 445/3 200/282/676 µs trên 4 lõi; `-t1 -a2 -i10000 -D20`: tối đa 131 µs. Nhân Core là SCHED_FIFO 80, iobus SCHED_FIFO 70, luồng `mb-bus1` SCHED_OTHER. | Số liệu cho C4 |
| 16:35 | Khôi phục runtime và DO | PUT intent `136d8ab2…` = true → generation 2, RUNNING, task RUNNING. `POST /modbus/write-test` DO2=0 → readback 0 GOOD lúc 16:35:54. | PASS khôi phục |
| 16:35 | Khôi phục Draft | Gỡ 3 POU và 2 binding thử nghiệm, nạp lại nguyên dạng Program WIP, 10 binding và `taskId`. Nội dung Draft **trùng khớp canonical** với bản chụp 16:05. `draftRevisionId` giữ `abca3a13…`; base đổi sang `cfe17ec5…`, `draftSequence` 57→59, `dirty=true`. | PASS nội dung; lineage đổi theo thiết kế |
| 16:36–16:38 | `cyclictest` 10 ms ghim CPU3 | Rảnh: trung bình 21 µs, tối đa 470 µs, 15/6000 lần > 100 µs. Có `stress-ng` CPU 80% + VM 64 MB trên CPU0–2: trung bình 25 µs, tối đa 251 µs, 13/6000 lần > 100 µs. Phút đo có tải: `core.jitter max_us=268,07`. | FAIL C4 (F03) |
| 16:38:57 | Đọc lại trạng thái cuối | 3 service giữ SHA256, `NRestarts=0`; health 6/6 `ok`; bus 4/4 online, timeout/CRC/total error 0; mọi DO trùng giá trị trước thử nghiệm; override rỗng; Active #52 RUNNING, task 1000 ms, overrun 0. | PASS khôi phục |

## Finding

Lượt 1 ghi nhận finding khi chưa được sửa mã. Từ lượt 2, mỗi finding sửa xong được ghi mã commit và kết quả deploy ở cột "Hướng sửa".

| ID | Mức | Mô tả | Bằng chứng | Nguyên nhân gốc | Hướng sửa |
|---|---|---|---|---|---|
| F01 | **P1** | Program bỏ release ngẫu nhiên khi chu kỳ Program bằng base step; health vẫn báo HEALTHY, task không đếm missed. Vi phạm C3 và `PROGRAM_TASK_SCHEDULER_SPEC` §4 ("Task 100 ms chạy đúng 10 lần mỗi giây kể cả khi có tick bị trễ"). | 23/30 missed trong 144 chu kỳ; 24/32 chu kỳ thiếu FC05; readback DO đứng yên 2 s | `st_program_mark_released` neo release đầu vào thời điểm chạy thật đã có jitter (`st_scheduler.cpp:100`: `now_ns + period_ns`), còn `st_program_due` so sánh chặt (`:91`). Tick sau có jitter nhỏ hơn tick neo thì bị coi là chưa đến hạn. Program có chu kỳ dài hơn base step cũng có thể chạy trễ thêm một base step. **ĐÃ SỬA `aa016695`**: so hạn với dung sai nửa tick; Program dùng nửa chu kỳ Task, Task dùng nửa min(chu kỳ Task, base step thật). Thêm 6 test (jitter 19–127 µs, bộ chu kỳ mới trên base 10 ms, lỡ thật vẫn đếm). ctest 1519/1519 PASS. Deploy + đo lại trên target: xem lượt 2 |
| F02 | **P1** so với spec | Profile Rev A: base step 1000 ms, `taskPeriodsMs=[1000,5000,30000]`, 1 Task | Log `core.base_step_ms=1000`; capabilities | Quyết định hợp đồng Rev A | Profile Rev B (G3, G4) |
| F03 | **P1** so với spec | Kernel non-RT không giữ được jitter ≤ 100 µs | `core.jitter` 105–268 µs; `cyclictest` tối đa 470 µs (10 ms ghim lõi), 3 200 µs (`-S`) | `PREEMPT_VOLUNTARY`, IRQ và tiến trình khác dùng chung lõi, governor `schedutil` | Nền RT (G2) |
| F04 | P2 | Sau Restore, Program của Revision được khôi phục không chạy dù `desiredEnabled=true`; phải PUT intent lại | 16:17:38 task STOPPED; 16:35 PUT intent → RUNNING | Restore không áp lại intent Enable đã lưu (cần đọc mã để chốt) | **ĐÃ SỬA `a1a976dd`**: vòng reconcile 2 s đối chiếu MỨC với snapshot sống; Program đang nghỉ ngược intent được replay, FAULTED/ROLLED_BACK không tự bật lại. 5 test mới. Deploy web + Restore trên target: xem lượt 2 |
| F05 | P2 | Trace không lên Core: yêu cầu 100 ms nhưng mẫu ~2 s, `programValue` luôn null; monitor mất ~2 s | Trace `1c5cc23f…`; log web `runtime/monitor dur_ms=1972` | `TRACE_START` bị từ chối hoặc lỗi IPC nên rơi về poll; lý do không được log. IPC web chỉ được phục vụ mỗi lần quét (1 s) | **ĐÃ SỬA `aa3f6a57`**: envelope TRACE_* mang actor + correlation của phiên (bản giả trong test chạy `ValidateRequest`; đỏ trên mã cũ, xanh trên mã mới); monitor lấy `programValue` của DO Modbus từ `setpoint` slot `ext`. Còn mở: IPC web chỉ được phục vụ mỗi scan (hết khi base step 10 ms, G3), khoá cho `StValueTrace` (G3) |
| F06 | P2, cần quyết định | Disable Program có output EXT Modbus để DO giữ giá trị cuối vô thời hạn | DO2 giữ 1 từ 16:17:01 tới khi write-test 16:35 | `PROGRAMMING_CONTROL_SEMANTICS` §6: withdraw rồi "tầng dưới quyết định", nhưng EXT không có resolver/relinquish nên không có tầng dưới | **ĐÃ SỬA `f73ee6a1` (PR #752), đo trên target 17:47**: chủ sở hữu chọn "về safe_value". Core nhả slot (`dirty=0` + seq mới) cho instance đã publish; iobus ghi `safe_value` từ profile (BE sinh khoá này), điểm không khai thì giữ giá trị cuối kèm WARN. Disable lúc 17:47:35,9 thì DO2/DO4 về 0 trong ≤ 1,2 s. Chưa thuộc phạm vi: Program bị bỏ khỏi gói do Commission/Restore |
| F07 | P3 | Danh sách intent hiện RUNNING/FAULTED (`LAST_KNOWN`) cho Program không thuộc Active Revision | `136d8ab2…` hiện "RUNNING" khi đã bị thay; `5619efde…`/`9f1887fe…` FAULTED | Ghép intent lưu trữ với trạng thái cuối, không lọc theo Active | **ĐÃ SỬA `a1a976dd`**: Program vắng trong gói đang chạy không nhận replay; `IPC-UNKNOWN-INSTANCE` giữ UNKNOWN, không ghi FAULTED. Hiển thị `LAST_KNOWN` giữ đúng hợp đồng OpenAPI |
| F08 | P3 | `journalctl -p warning` không bắt được dòng WARN/ERROR của ứng dụng; baseline "0 dòng" trước đây bị mù | 16:13:46 web in `WARN health degraded err=shm /dev/shm/mkddc_io_shm: không đọc được snapshot nhất quán` nhưng `-p warning` trả "No entries" | Ứng dụng in ra stderr, journald gán mức info | **ĐÃ SỬA (PR kế tiếp)**: Core/iobus bọc stderr, web bọc stdout/stderr. Dòng được gắn `<3>`/`<4>`/`<6>`/`<7>` theo token mức, chỉ khi fd THẬT SỰ là stream journald (so `dev:inode` của `JOURNAL_STREAM`); buffer tĩnh, không cấp phát ở đường RT |
| F09 | P3 | `Draft.latestCheck` trỏ tới Check PASSED của Revision thử nghiệm trong khi nội dung Draft là WIP chưa Check (`dirty=true`) | `GET /projects` sau khôi phục | Check gắn với base revision | **KHÔNG PHẢI LỖI**: FE xét `dirty` trước `latestCheck` (`draftStateLabel` hiện "Có thay đổi chưa phát hành", CTA ra `CONTINUE_EDITING`), nên Check PASSED của base revision không bị hiển thị như kết quả của Draft đang sửa |
| F10 | P3 | Chẩn đoán FBD gây hiểu nhầm: biến đã khai trong bảng locals (OUTPUT) nhưng không có khối OUTPUT thì báo "not declared in VAR_INPUT/VAR_OUTPUT" | Check `f90e1433…` của Draft WIP | Bộ biên dịch FBD chỉ khai VAR_OUTPUT từ khối OUTPUT (`st_fbd_compile.cpp:275`) | **ĐÃ SỬA (PR kế tiếp)**: thông điệp `ST-IOMAP-001` nói rõ "in FBD a variable is declared only by an INPUT/OUTPUT block that uses it on the diagram"; test khoá nội dung |
| F11 | **P1** so với C4 | Ở base step 10 ms, 13,07 % lần thức dậy của vòng quét lệch > 100 µs (785/6008 trong 60 s), gấp khoảng 50 lần `cyclictest` cùng CPU; không log nào nói lý do | Lượt 3, 04:46–04:48 | CPU3 vào trạng thái cpuidle `cpu-sleep` (exit latency 370 µs) trong mỗi khoảng ngủ 10 ms. Unit ghim Core vào CPU3 nhưng không ràng buộc độ trễ thức dậy; `cyclictest` né được vì giữ `/dev/cpu_dma_latency=0`. Core không kiểm nên thiếu ràng buộc là thiếu âm thầm | **ĐÃ SỬA `44425dc6` + `7193ef4a`**: unit core đặt `pm_qos_resume_latency_us=20` cho CPU3 bằng root (`ExecStartPre=-+`), trả về 0 khi stop; Core đọc cpuidle/QoS lúc khởi động, log `ERROR rt.cpu_idle_exposed` khi còn trạng thái > 100 µs. Trên target: 0,15 % lần lệch > 100 µs, trung bình 55 → 22 µs. C4 vẫn cần PREEMPT_RT (G2) |
| F12 | **P1** vận hành | Bấm Check thì treo khoảng 30 s rồi báo `ST-WORKER-CRASH`; mọi Check trên bo hỏng | Lượt 3, 04:49 và 05:00 | (1) Lượt deploy ADR-061 lúc 04:38 cập nhật web/core/iobus nhưng bỏ sót tool ST trong `/usr/sbin`, nên compiler còn profile v2.1. (2) Runner gộp "profile khác" vào "metadata sai"; Check thử lại sau lease 30 s rồi mới đóng bằng mã crash chung. (3) Quy trình deploy từng phần (`DEPLOY_FOXLINX.md`, skill `foxlinx-deploy`) không có bước đồng bộ tool ST. Cùng họ với `P5-507-F05` | **ĐÃ SỬA (Issue #758)**: cài lại tool trên bo; `ToolchainProbe` kiểm `--version` lúc khởi động và mỗi lần nhận Check; lệch bản ⇒ FAILED ngay với mã mới `ST-WORKER-TOOLCHAIN` (catalog 1.13.0), không thử lại; tài liệu và skill deploy thêm bước 2b |

## Audit lượt 2 (2026-09-25 17:08 UTC trở đi) — sau khi sửa F01

| Thời điểm (UTC) | Bước | Kết quả / bằng chứng | Trạng thái |
|---|---|---|---|
| 17:08 | Deploy Core từ `main@d217f6b7` (PR #749) | Cross-build ARM từ cây sạch (`git_commit=d217f6b7…`, cần tối đa GLIBCXX_3.4.29 và GLIBC_2.38). Sao lưu `/data/mkddc/deploy-backups/2026-09-25T1708Z-f01/`. `/proc/MainPID/exe` = `ee42f0a4…` khớp bản build, `NRestarts=0`, không có `(deleted)`; health 6/6 `ok`; Active #52 RUNNING, task `missedReleaseCount=0` | PASS deploy |
| 17:09:34 | Commission lại Revision `cfe17ec5…` (Check `9e2848b1…` PASSED sẵn, Draft WIP không bị đụng) | Operation `208cc3e5…` SUCCEEDED | PASS |
| 17:09:38–17:10:46 | Cửa sổ 1 (68 s) | FC05 DO2 68/68, DO4 68/68, khoảng cách 994–1006 ms (lượt 1: 666–2334 ms); `missedReleaseCount` 0/0 | **PASS C3 ở 1 s** |
| 17:10:46–17:11:32 | Disable 46 s rồi Enable lại (kiểm F01b) | Enable lại không cộng thời gian tắt vào missed | PASS |
| 17:11:33–17:14:43 | Cửa sổ 2 (190 s) | FC05 DO2 190/190, DO4 189/190, khoảng cách 997–1003 ms; `missedReleaseCount` 0/0, `consecutive` 0; task `missedReleaseCount` 0, overrun 0, `maxExecNs` 18 085 | **PASS C3 ở 1 s** |

| 17:24 | Deploy web `1030c545` (PR #750: F04/F05/F07) | Sao lưu `/data/mkddc/deploy-backups/2026-09-25T1724Z-f04f05f07/`; exe `f9982f56…`, `NRestarts=0` | PASS deploy |
| 17:25 | Kiểm F05 trên target | Trace 100 ms: 12 mẫu trong 12 s từ ring Core (`freshness=FRESH`, `programValue` đảo True/False), 0 mẫu rơi; monitor có `programValue` cạnh `actualValue` cho DO Modbus; monitor mất 972 ms (trước: 1972 ms). Phát hiện F05c: mọi mẫu mang cùng một `observedAt` | PASS F05; mở F05c |
| 17:25:53–17:26:00 | Kiểm F04 trên target | Restore `da8483d4…` SUCCEEDED lúc 17:25:56,6; Program #52 RUNNING (`CORE_LIVE`) ngay lần đọc đầu (≤ 2 s), không cần PUT intent. Hai Program thử nghiệm hiện DISABLED/`LAST_KNOWN`, không còn FAULTED (F07) | PASS F04, F07 |
| 17:30 | Deploy web `0d244219` (PR #751: F05c) | Sao lưu `…T1730Z-f05c/`; exe `6dad43af…`. Web cần ~16 s mới listen sau khi start | PASS deploy |
| 17:30:48 | Kiểm F05c | 7 mẫu cách nhau đúng 1 s, thẳng hàng tick quét Core (…48,7345 / 49,7345…) | PASS |
| 17:45 | Deploy core + iobus + web `ec2b6f17` (PR #752: F06) | Sao lưu `…T1745Z-f06/`; exe core `82799a74…`, iobus `6c1a5b18…`, web `1e5009a5…`, cả 3 `NRestarts=0`. iobus lượt mốc seed 3 slot, không có dòng `ext_release` nào lúc khởi động; DO trước/sau deploy giống hệt nhau | PASS; khởi động lại không giật DO |
| 17:46 | Sinh lại device profile | Sao lưu `fieldbus.conf` + profiles (`…T1746Z-f06-profiles/`); đặt candidate trùng cấu hình đang chạy (`diff` rỗng) rồi apply: revision 39 → 40, checksum **không đổi**, iobus nạp lại chế độ `control`; 4 profile CK có `safe_value` cho 8 DO | PASS |
| 17:47:35–17:47:46 | Kiểm F06 trên target | Enable → DO2/DO4 = 1; Disable 17:47:35,9 → iobus `ext_release_safe` DO2 (17:47:36) và DO4 (17:47:37), FC05 addr 1 ở +1195 ms, addr 3 ở +2196 ms; readback DO2 = DO4 = 0 từ 17:47:43 | **PASS F06** |
| 17:48:05 | Restore về #52 | SUCCEEDED; Program #52 RUNNING ngay lần đọc đầu | PASS |

| 17:58 | Deploy core + iobus + web `910b571c` (PR #753: F08, F10) | Sao lưu `…T1758Z-f08f10/`; exe core `9fedbc30…`, iobus `448716a5…`, web `05d09b81…`, `NRestarts=0`. `journalctl -p warning` nay trả đúng các dòng WARN/ERROR (trước: "No entries"). Sau khởi động 40 s không còn cảnh báo nào; các cảnh báo lúc khởi động là cấu hình sẵn có của bo (`alarm_cfg.missing` = alarm đang tắt trên bo lab, `bind_interface_empty`, `uart_device`) và 22 dòng `sendto_fail` khi iobus chờ Core lên | **PASS F08** |
| 17:51:47 | Quan sát (không thuộc phiên audit) | Actor `admin` từ một phiên khác (không có trong log HTTP của harness) seal Draft WIP thành revision `0b511c3f…` rồi Check `b08fb8ab…` FAILED. Phiên audit không đụng Draft kể từ 16:35 | Ghi nhận |
| 18:0x | G2 tạm (ADR-061 4.11): dời 64 IRQ khỏi CPU3 (20 IRQ per-CPU không dời được), dừng `irqbalance` | `cyclictest` 10 ms CPU3: rảnh tối đa 173 µs (trước 470 µs), 9/6000 > 100 µs; có tải tối đa 212 µs (trước 251 µs), 16/6000 > 100 µs. IRQ eMMC `dw-mci` (69 triệu ngắt trên CPU3) không còn chạm CPU3. Đã trả affinity và bật lại `irqbalance` | C4 vẫn **FAIL**: kernel non-RT là giới hạn, cần PREEMPT_RT (chờ BSP Forlinx) |

Bo sau lượt 2: Active #52 RUNNING; DO2 = DO4 = 0, DO3 = 1 như baseline đầu phiên (DO1 do #52 điều khiển); Draft WIP không bị đụng kể từ lần khôi phục 16:35; override rỗng. DO2/DO4 từng kẹt ở 1 từ 17:14 tới 17:47 do lượt 2 Disable trên mã cũ, và chính F06 đã đưa chúng về 0.

Kết luận lượt 2 đến thời điểm này: F01 đã khỏi trên target. Logic 1 s nay ra đúng một lệnh FC05 mỗi giây, lệch tối đa 6 ms. C1 và C4 vẫn FAIL vì đó là bài toán nền tảng: G2–G4.

## Audit lượt 3 (2026-09-26 04:38 UTC trở đi) — ADR-061 base step 10 ms trên target

Mã chạy: `main@3b03208f` (PR #756, ADR-061 Track A + Track B). Cross-build ARM: core `0e9535a1…`, iobus `410b2f55…`, web `0c95fb9f…`, sim worker `51848d72…`, FE `index.html` `16357380…`; cả 4 binary cần tối đa GLIBCXX_3.4.29. Unit systemd mới: core `CPUAffinity=3`, các service khác `0-2`, drop-in `irqbalance.service.d/mkddc-rt.conf` (`IRQBALANCE_BANNED_CPULIST=3`). Unit trên bo trùng bản repo cũ, trừ `mkddc-web-pi` giữ `PORT=8082` của bo.

Trước deploy, bo đã khác baseline đêm qua: một actor khác (không thuộc phiên này) đã Commission revision `891fc521…` (#63, chu kỳ 1000 ms) lúc 03:17:49 thay cho #52. Phiên này **giữ nguyên** #63.

| Thời điểm (UTC) | Bước | Kết quả / bằng chứng | Trạng thái |
|---|---|---|---|
| 04:38 | Deploy core + iobus + web + sim worker + FE + unit | Sao lưu `/data/mkddc/deploy-backups/2026-09-26T0438Z-adr061/` (binary, unit, dist, `programming-v1.sqlite` sau khi web dừng sạch). `/proc/MainPID/exe` khớp sha bản build, `NRestarts=0`, 6 service active, health 6/6 `ok`. Core SCHED_FIFO 80 trên CPU3; iobus/web/netcfg/fakemcu trên `0-2`; mọi IRQ không per-CPU rời CPU3 | PASS deploy |
| 04:38:35 | Log khởi động Core | `core.base_step_ms=10`, `programming.task_main period_ms=10 budget_us=1999`, TTL sàn 60 s | **PASS C1 (Core)** |
| 04:39 | `GET /programming/runtime` | `periodMs=10`, `budgetUs=1999`, `baseStepUs=10000` cùng `jitterMaxUs`, `jitterViolationCount`, `missedBaseStepCount`, `health=DEGRADED` kèm `healthReasons` | PASS hợp đồng 4.9 |
| 04:40 | `GET /programming/capabilities` | `taskPeriodsMs=[10,50,100,500,1000,5000,10000,50000]` | **PASS C1 (API)** |
| 04:41 | `setTask` 5 / 30000 / 7 ms trên Draft thật | Cả ba nhận 400 `PRG-ERR-REQ-001`, `detailCode=ST-SCHED-001`, `field=operations[0].setTask`; etag Draft không đổi | **PASS C1 (từ chối)** |
| 04:39:55–04:45:26 | Lấy mẫu 30 s × 12 | `runCount` tăng đúng 100/s; overrun 0; `maxExecNs` 36,8–163,9 µs; `jitterMaxUs` (cửa sổ 60 s) 183–319 µs; khoảng 11–13 % lần thức dậy lệch > 100 µs; `missedBaseStepCount = missedReleaseCount = 1`, cả hai xảy ra trong phút khởi động (lần thức dậy trễ 12,2 ms) | C2 PASS; C3, C4 **FAIL** |
| 04:46–04:48 | Tìm nguyên nhân C4 (F11) | CPU3 có `cpu-sleep` exit latency 370 µs, residency 900 µs, QoS mặc định không ràng buộc. Cửa sổ 60 s: không ràng buộc 785/6008 (13,07 %) lần lệch > 100 µs; `pm_qos_resume_latency_us=20` 9/6006 (0,15 %), bộ đếm `cpu-sleep` của CPU3 đứng yên. Dời `prog-ipc`/`st-retain` khỏi CPU3: 5 so với 4 vi phạm, không khác biệt | Nguyên nhân gốc xác nhận |
| 04:48–04:49 | Quan sát (không thuộc phiên này) | Actor khác thay `/opt/mkddc-web/mkddc-web` (`a6d4fa26…`) và `dist/` rồi restart web lúc 04:49:01; web mới vẫn trả khoá C4 nên đã có ADR-061. Các đỉnh 1,8 / 4,4 / 3,3 ms của `core.jitter` trùng lúc chép file và restart web | Ghi nhận |
| 04:56 | Deploy core + unit sửa F11 (commit `44425dc6`, `7193ef4a`) | Sao lưu `…T0456Z-c4-cpuidle/`. QoS về 0 trước khi stop; `ExecStartPre` đặt 20 khi start. Log `rt.cpu_idle_ok cpu=3 worst_state=WFI exit_latency_us=1 qos_resume_latency_us=20`. Phút đầu không lỡ step | PASS deploy F11 |
| 04:57–04:59 | `core.jitter` từng phút sau F11 | Phút 2: tối đa 136 µs, 10/6000 > 100 µs, trung bình 21,7 µs (trước F11: 55 µs). `core.step_wcet`: tổng tối đa 1171–1307 µs mỗi step, lớn nhất là IPC web 528–686 µs, publish 318–531 µs, schedule 316–394 µs | C4 vẫn **FAIL** (> 100 µs) |
| 04:57:30–05:02:30 | Cửa sổ 300 s sau F11 (`GET /runtime` đầu và cuối) | 30 006 lần chạy; 21 lần lệch > 100 µs (0,07 %); `missedBaseStepCount` +0, `missedReleaseCount` +0, overrun +0; `maxExecNs` 184 µs; lệch tối đa theo phút 136 / 142 / 276 / 203 µs, trung bình 21,5–21,9 µs | C2 **PASS**, C3 **PASS**; C4 **FAIL** |
| 05:02:06 | Restore về #52 (`69b6ba15…`, Program 30000 ms, ADR-061 4.14) | Operation `887179d4…` SUCCEEDED 0,6 s; Core log `WARN programming.legacy_period instance=136d8ab2… period_ms=30000`; Program RUNNING với `periodMs=30000`; trong 65 s: missed step 0, missed release 0 | **PASS 4.14** trên target |
| 05:03:15 | Restore trả về #63 (`891fc521…`) | Operation `8618601e…` SUCCEEDED 0,6 s; missed step/release 0 qua cả hai lần kích hoạt. Core vào safe-state `no_ctrl` 1,38 s (05:03:15,13 → 05:03:16,51) cho tới khi vòng reconcile intent bật Program của #63 | PASS; bo trả về đúng Active của actor khác |
| 05:00:30 | Báo lỗi của chủ sở hữu (F12) | Check revision `7adb079d…` treo khoảng 30 s rồi `PRG-ERR-UNAVAILABLE-001 · ST-WORKER-CRASH`. Log web `compiler output không hợp lệ: metadata success thiếu/sai` (04:49:32, 05:00:30; mỗi lần thử lại sau khoảng 31 s). `/usr/sbin/mkddc-st-compile` build 2026-09-13 mang `profile_sha256=d2866c41…` (v2.1); web đòi `1cb61fec…` (v2.2) | Nguyên nhân xác nhận |
| 05:06 | Gỡ F12 trên bo | Sao lưu `…T0506Z-st-tools/`; cài `mkddc-st-compile`, `mkddc-st-package`, `mkddc-st-validate` build từ `main@3b03208f` (GLIBCXX ≤ 3.4.29). `--version` cả hai tool: `profile_sha256=1cb61fec…`. Check lại `7adb079d…` (check `61835d13…`) **PASSED trong 0,6 s**, 0 diagnostic | PASS |

### Bản đồ gap Rev B cho bộ chu kỳ {10, 50, 100, 500, 1000, 5000, 10000, 50000} ms

Rà toàn repo (chỉ đọc) cho ra các xung đột phải giải quyết trong ADR mới, trước khi code:

| Mã | Xung đột | Nơi |
|---|---|---|
| X1 | Hold TTL 60 s < 2 × 50 000 ms; `static_assert(TTL ≥ 2×max period)` sẽ làm build gãy | `st_scheduler.hpp`, ADR-051 |
| X2 | 10 ms nằm ngoài dải base step 500–2000 ms (cả `st_base_step` lẫn `graph.scan_ms`); profile supporting có sàn 50 ms | `st_scheduler.hpp`, `graph_runtime.cpp` |
| X3 | Task `main` cứng 1000 ms nên Program 10–500 ms chỉ được xét mỗi 1 s. Đổi Task sang 10 ms thì luật budget tính bằng ms (`budget·100 < period·20`) chỉ còn cho 1 ms | `main.cpp`, `st_scheduler.cpp` |
| X4 | Mô hình ngân sách: Go cấp 20% chu kỳ cho TỪNG Program, Core chỉ đo cả Task. Khi mọi chu kỳ trùng nhịp (t = 50 s) tổng budget ≈ 13,3 s, gấp rất nhiều lần base 10 ms | `checks_topology.go`, `st_scheduler.cpp` |
| X5 | Go chấp nhận ≤ 20%, Core đòi < 20% | như trên |
| X6 | Overrun thứ 1–2 chỉ là cảnh báo, lần 3 mới FAULT, trong khi C2 đòi 0 | ADR-029, `main.cpp` |
| X7 | Missed release chỉ đếm khi trễ ≥ trọn chu kỳ; ScanLoop không đếm base step bị lỡ | `st_scheduler.cpp`, `scan_loop.cpp` |
| X8 | C4 không có metric: jitter chỉ log stderr mỗi 60 s | `scan_loop.cpp` |
| X9 | Freshness Published Signal 1000–90 000 ms (lặp ở 9 chỗ) không hợp với chu kỳ 10–500 ms và 50 000 ms | Core, Go, store SQL, OpenAPI, FE |
| X10 | Trace tối thiểu 100 ms; trần 10 000 ô | `st_value_trace.hpp`, `trace.go` |
| X11 | Capabilities chép cứng `[1000,5000,30000]`, `Tasks: 1` (profile đã là 3) | `runtime.go`, `program_ipc_server.cpp` |
| X12 | FE ép mọi chu kỳ lạ về 1000 ms, nên có thể âm thầm đổi Program 10 ms thành 1000 ms | `draftV2.ts`, `ExecutionTab.tsx` |
| X13 | Simulation ở tick 10 ms: 100 IPC + 100 lần ghi SQLite mỗi giây cho mỗi phiên | `simulation.go` |
| X14–X15 | RETAIN notify 100 lần/s; watchdog 100 lần/s, `WatchdogSec=6` tính theo base 2000 ms | `st_retain.cpp`, `main.cpp` |
| X16 | profileId `revA-1t-1-5-30` mang nghĩa "1-5-30"; đổi id thì FBD doc/manifest/draft cũ bị từ chối, giữ id thì sha vẫn đổi và phải re-pin | contracts, `st_fbd_model.cpp`, `draft_v2.go` |
| X17 | Chu kỳ sai dùng lại `ST-LIM-009` (quá nhiều Program); C1 chưa có mã lỗi riêng | `st_diagnostic.hpp` |
| X18 | Stale sau 3 scan co còn 30 ms | `point_quality.hpp` |
| X19 | BACnet, ext writes, web IPC, alarm, schedule đều chạy trong cùng step, trái yêu cầu "I/O mở rộng không tính vào chu kỳ" | `scan_loop.cpp` |
| X20 | VS-PROG-009 đòi 10 000 cycle cho mỗi chu kỳ: riêng 50 000 ms ≈ 5,8 ngày | kế hoạch kiểm chứng |

Quy mô: 43 file test ghim giá trị cũ (Core 18, Go 9, FE 13, E2E 3). Phải re-pin `g1_contract_join_v1.json`, `programming_store_v1.manifest.json`, `fbd/manifest.json`, `pgm02_workspace_v1.json` và `error_catalog_v1.manifest.json`, cùng migration store mới cho dải freshness.

Thứ tự bắt buộc:
1. ADR mới supersede ADR-026/027/028/029/050.3/051 (base step 10 ms, mô hình budget bằng µs theo tổng WCET mỗi base step, TTL ≥ 100 s, overrun = lỗi, dải freshness/trace, định nghĩa missed release và jitter).
2. Hợp đồng và re-pin.
3. Sinh mã.
4. Core.
5. Go.
6. FE.
7. Test.
8. Tài liệu.

Việc này đổi hợp đồng sản phẩm nên đi theo quy tắc "doc trước, code sau": ADR phải được duyệt trước khi code.

## Giải pháp tối ưu để spec sản phẩm ghi "cycle 10 ms"

Nguyên tắc: làm như Siemens, **tách chu kỳ CPU khỏi thời gian cập nhật I/O truyền thông**. S7-1200 chạy cyclic interrupt 1–60 000 ms, còn PROFINET và các module Modbus có thời gian cập nhật riêng. Core không bao giờ chờ bus: đầu chu kỳ đọc process image, cuối chu kỳ ghi process image. iobus trao đổi với thiết bị mở rộng theo nhịp của bus và luôn phát giá trị mới nhất.

| Bước | Nội dung | Phụ thuộc | Cổng nghiệm thu |
|---|---|---|---|
| G1 | Sửa F01: neo release theo mốc lý thuyết; missed > 0 thì health DEGRADED | Không; cần làm ngay cả khi giữ 1 s | Test tiêm jitter; soak 1 h ở 1000 ms và 10 ms cho 0 missed |
| G2 | Nền thời gian thực: kernel PREEMPT_RT cho BSP RV1126B 6.1; `isolcpus=3 nohz_full=3 rcu_nocbs=3`; đẩy IRQ sang CPU0–2; ghim luồng quét Core vào CPU3 SCHED_FIFO 80; `mlockall`; governor `performance` cố định 1,296 GHz; giữ `/dev/cpu_dma_latency=0` | BSP Forlinx có bản RT hoặc vá được; driver RS-485/Ethernet chạy trên RT | `cyclictest` CPU3 10 ms, 24 h dưới `stress-ng`: tối đa ≤ 100 µs (mục tiêu thiết kế ≤ 50 µs) |
| G3 | Core base step 10 ms; đưa việc không cần RT ra khỏi luồng quét (IPC web, đọc socket ext của BACnet objtable, alarm/historian) và đặt ngân sách mỗi lần quét | G1, G2 | WCET từng bước quét; C2 = 0 overrun trong 24 h |
| G4 | Profile Rev B (ADR mới): `taskPeriodsMs=[10,50,100,500,1000,5000,10000,50000]`. Tập này tạo một chuỗi bội (mỗi chu kỳ chia hết chu kỳ kế, siêu chu kỳ 50 s). Ngân sách mỗi Task riêng (ví dụ Task 10 ms ≤ 2 ms); API/Check từ chối chu kỳ ngoài tập; profile id compiler mới; FE; đường chuyển Rev A → Rev B (30000 ms không còn trong tập) | G3 | C1: capabilities đúng; khai 5 ms và 30000 ms nhận 400 |
| G5 | Đo và cảnh báo: bộ đếm jitter > 100 µs, overrun, missed release lộ ra API/health/alarm; cổng audit đọc thẳng các bộ đếm này | G1 | Số đếm khớp với phép đo `cyclictest`/dấu thời gian |
| G6 | I/O cục bộ qua IOP/MCU trao đổi ở 10 ms. Hiện bo dùng Fake MCU nên **NOT RUN** | FW MCU thật | Đo điện (HIL) DO cục bộ đảo mỗi 10 ms: chu kỳ 10 ms ± 0,1 ms |
| G7 | Spec I/O mở rộng riêng: công thức và bảng ở mục "Tách lớp"; đánh thức luồng bus theo sự kiện khi `ext_cmd_seq` đổi (thay cho quét 100 ms + trần ngủ 200 ms); gộp FC15 theo module; ưu tiên ghi hơn đọc; nhóm poll readback nhanh cho actuator; nâng baud nếu thiết bị hỗ trợ; ghi rõ nguyên tắc "giá trị mới nhất" | Độc lập với G2–G4 | Core → FC05 ≤ t_tx + thời gian bus bận; readback theo nhịp nhóm poll |

Phương án dự phòng (không khuyến nghị): nếu không có kernel RT, chỉ ghi được "10 ms, jitter điển hình ≤ 25 µs, 99,7% ≤ 100 µs, tối đa đo được 470 µs". Cách ghi này **không đạt** C4 mà chủ sở hữu đã chốt.

Bản nháp câu chữ cho spec sản phẩm, chỉ dùng sau khi G1–G5 đạt cổng:

> Chu kỳ quét bộ điều khiển: 10 ms (Task nhanh nhất), tối đa 3 Task từ 10 ms tới 30 s, lệch nhịp ≤ 100 µs. Thời gian cập nhật I/O mở rộng (Modbus RTU/TCP, BACnet) phụ thuộc giao thức và tốc độ truyền, xem bảng; không tính vào chu kỳ quét.

## Rủi ro và giới hạn đã xác nhận

1. Profile đang chạy chỉ cho Task/Program từ 1000 ms. Mốc "100 ms" trong tên FB `FB_DO_BLINK_100MS_V1` chỉ là chú thích nguồn; Program đó chạy mỗi 30 s.
2. Bốn slave chung một dây 9600 bps, sức chứa khoảng 34 giao dịch/s. Mọi cạnh logic nhanh hơn nhịp bus có thể bị gộp theo nguyên tắc "giá trị mới nhất" (`bus_worker.cpp` coalesce). Trong phép đo này, các cạnh bị mất là do F01 (logic không chạy), không do bus.
3. `MBA-FW-08` đã triển khai; fault injection mất/kết nối lại thiết bị thật chưa chạy.
4. Không có phép đo điện ở tiếp điểm relay, nên lớp vật lý NOT RUN và target không phải HIL.
5. `cyclictest` và `stress-ng` chạy trên bo lab đang vận hành, mỗi lượt 60 s; bus không phát sinh lỗi (0 timeout/CRC sau đo).

## Ma trận kiểm chứng

| Lớp / tính năng | Kết quả | Bằng chứng |
|---|---|---|
| FBD dùng Function Block: parse/compile/Check | **PASS target** | Revision `cfe17ec5…` Check PASSED 0,64 s, 0 diagnostic |
| ST dùng Function Block người dùng: parse/compile/Check | **PASS target** | Như trên; instance `Toggle : FB_AUDIT_TOGGLE` |
| Chẩn đoán Check | PASS | `ST-SEM-013` đúng dòng 9 cột 15 |
| Commission / Enable | PASS | Operation `1a8eeaf9…` 1,64 s; RUNNING `CORE_LIVE` |
| Monitor | PARTIAL | `actualValue` đúng; `programValue` null; trễ ~2 s |
| Trace | FAIL | F05 |
| Disable | PASS runtime | Output EXT giữ giá trị cuối (F06) |
| Restore | FAIL | F04 |
| Lệnh FC05 trên RS-485 | PASS lớp truyền | 234/234 ACK, 29,0 ms |
| Readback coil qua API | PASS | Trễ trung vị 712 ms |
| Cạnh vật lý | NOT RUN | Không có dụng cụ đo |
| Chu kỳ theo spec 10 ms (C1–C4) | **FAIL** (chỉ còn C4) | Lượt 1: C1, C3, C4 FAIL. Lượt 3 (ADR-061 trên target): C1 PASS (Core, capabilities, từ chối 5/7/30000 ms), C2 PASS, C3 PASS trong 300 s; C4 FAIL, lệch tối đa 276 µs, 0,07 % lần > 100 µs sau F11, cần PREEMPT_RT (G2) |
| Service logs | PASS có ghi chú | 0 restart; 1 dòng WARN io_shm lúc 16:13:46 mà `-p warning` không bắt được (F08) |
| Hồi quy mã nguồn (phiên 15:19–15:54) | PASS host | C++ 1513/1513 (2 skipped); Go vet + toàn bộ Go test; FE Vitest 3439/3439, lint, build Foxlinx; ARM 3 binary |
| UI Programming qua trình duyệt | PASS target | Sau 2 lượt deploy FE (15:51, 15:54): Console 0, request 200 |
| Khôi phục sau thử nghiệm | PASS | Draft trùng canonical; DO, override, Active, service trùng trạng thái trước |

## Tệp bằng chứng

- `fixtures/2026-09-25-fbd-st-modbus-do-run-summary.json` — ID, kết quả Check/Commission/Restore, bộ đếm Core, dấu thời gian FC05 từng DO và các chu kỳ thiếu, tóm tắt `cyclictest`.
- `fixtures/audit-fb-toggle.st`, `fixtures/audit-st-do.st`, `fixtures/audit-fbd-do.fbd.json` — mã nguồn thử nghiệm đã Commission.
- `fixtures/foxlinx-active-do-blink-fbd.json`, `fixtures/foxlinx-active-fb-do-blink.st`, `fixtures/modbus-do-probe-st.st` — FBD/FB của Active #52 và mẫu ST host.

## Tài liệu liên quan

- `docs/07_records/reviews/MODBUS_AUDIT_2026-09-25_BOARD_OPERATION_REPORT.md`
- `docs/07_records/reviews/MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS.md`
- `docs/02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md`
- `docs/02_design/software/PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md` §4
- `docs/02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md` §6
