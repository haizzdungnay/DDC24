# Audit FBD/ST Function Block → DO Modbus trên Foxlinx

**ID:** EV-PROG-FBD-ST-MB-20260925  
**Ngày:** 2026-09-25  
**Trạng thái:** Lượt 1, 2 và 3 đã đo trên target. Theo luật của chủ sở hữu ("tìm ra lỗi là sửa, commit, deploy ngay"): F01, F04, F05, F05c, F06, F07, F08, F10, F11, F12, F13, F14, F15, F16 đã sửa, deploy và kiểm trên Foxlinx; F09 kết luận không phải lỗi. F02 đóng bằng ADR-061 (base step 10 ms, tập chu kỳ {10…50000} ms; lượt 3 đo C1–C3 PASS trên target). C4 đạt trong cửa sổ 600 s trên kernel non-RT nhờ CPU3 độc quyền (F11, F14, F15, F16); soak 24 h đang chạy tới 2026-09-27 06:47Z. PREEMPT_RT (BSP Forlinx) và `isolcpus=3 rcu_nocbs=3` (kernel hỗ trợ, cần sửa bootloader và reboot bo từ xa) là dự phòng nếu soak có vi phạm. Chỉ các mục có số đo hoặc phản hồi thật mới được coi là bằng chứng. Soak 24 h lần 3 (revision thử 8 chu kỳ thay Active) có runbook ở mục "Soak lần 3"; F20 và F21 mở khi dựng công cụ. F20 đã sửa (PR #779), deploy cùng Core `main@01fd8708` lúc 2026-09-27 04:02Z và **PASS trên target**: bàn giao 10 điểm chung lúc 04:03:28, nhả 2 DO + 8 EXT ngay tại boundary lúc 04:04:39. Soak lần 3 (8 chu kỳ) **PASS** theo ngưỡng chủ sở hữu chốt lại ngày 2026-09-27 (≥ 10 chu kỳ mỗi lớp, C1–C4 PASS, missed release 0): chạy 04:04:39Z → 04:15:47Z, lớp 50 s đạt 12 chu kỳ, lệch nhịp tối đa theo phút 52,34 µs. Bo đã trả về Active #69. F23 (trang Program của một Project hiện Program của Project đang chạy) mở ra lúc dọn soak, đã sửa (PR #781), deploy web `main@d7022923` lúc 04:27Z và PASS trên target.  
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
| Core → FC05 | Độ trễ từ lúc Program chạy tới lúc phát lệnh | Điển hình ~377 ms (luồng `fb-publish` quét lệnh mỗi 100 ms, luồng bus tỉnh tối đa mỗi 200 ms) | Ghi nhận trên mã cũ. G7 đã sửa trong mã (mục "G7 — đánh thức theo sự kiện" ngay dưới): lý thuyết ≤ 5 ms phát hiện + t_tx + thời gian bus bận. **Chờ deploy + đo target** |
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

### G7 — đánh thức theo sự kiện (2026-09-26, đã deploy + đo target)

Nhánh `feat/iobus-ext-event-wake-20260926`, tạo từ `main@baf6a86c`. Chỉ đổi `mkddc-iobus`: không đổi Core, không đổi ABI `plc_shm` v7.

**Đường trễ đọc từ mã cũ (`baf6a86c`):**

| Chặng | Mã cũ | Chỗ trong mã |
|---|---|---|
| Core đổi `ext_cmd_seq` → iobus phát hiện | Vòng `fb-publish` chạy `drain_ext_writes`, `modbus_tcp.poll_once`, publish rồi `sleep_for(100 ms)`; mỗi vòng `shm_open` + `mmap` + `munmap`. Trễ 0…100 ms cộng thời gian vòng; TCP poll không có trần nếu slave TCP treo kết nối | `apps/iobus/bootstrap/main.cpp`, luồng `fb-publish` |
| Hàng đợi → worker thức | `run_loop` ngủ `sleep_for(min(hạn đọc kế, 200 ms))`; lệnh mới không đánh thức ai: 0…200 ms | `bus_worker.cpp`, `run_loop` |
| Worker thức → FC05 | Lệnh ghi đi SAU mọi lượt đọc tới hạn của lượt đó (`ISS-MBW-02` chỉ phát nốt sau vòng đọc): cộng Σ t_đọc của các slave tới hạn | `bus_worker.cpp`, `poll_once` |
| Tổng, bus rảnh, 9 600 baud | Xấu nhất ≈ 100 + 200 + 29 ≈ 330 ms; đo trên bo điển hình ~377 ms | Bảng "Tách lớp" |

**Đã sửa:**

1. **(a) Phát hiện ≤ 10 ms.** Luồng mới `mb-extcmd` (SCHED_OTHER, không busy-spin) soi `ext_cmd_seq` mỗi `kExtCommandPollMs = 5 ms` với mốc tỉnh tuyệt đối. `PlcShmView` giữ ánh xạ `plc_shm` lâu dài, chỉ kiểm lại dev/inode mỗi 1 s và từ chối object nhỏ hơn `sizeof(kx_plc_shm_t)` (tránh SIGBUS). `drain_ext_writes` có đường nhanh: khi không có mốc chờ lấy, không có lệnh chờ thử lại, `ext_count` và mọi `ext_cmd_seq` của dải RTU trùng lần chụp trước thì trả về ngay, không chụp snapshot 24 KB. Magic sai thì bỏ trước khi chụp. Lệnh bị hàng đợi đầy từ chối được thử lại mỗi 100 ms, không mỗi 5 ms, để journal không ngập dòng ERROR. Chưa có bus nào thì luồng soi thưa 100 ms. Cầu nối ghi rời khỏi `fb-publish`, nên slave TCP treo không còn giữ lệnh RTU.
   - *Vì sao vẫn phải poll:* `plc_shm` v7 không có kênh báo thức. Core ghi bằng seqlock; `seq` tăng mỗi scan 10 ms vì object table được ghi mỗi scan, nên nó không báo được "có lệnh EXT mới". Core cũng không gọi FUTEX_WAKE và không có eventfd. Thêm một kênh như vậy là đổi hợp đồng Core ↔ iobus và chèn syscall vào đường quét SCHED_FIFO của Core, tức đụng ngân sách C4.
   - *Vì sao 5 ms:* trễ phát hiện xấu nhất bằng chu kỳ soi P cộng trễ đánh thức. P = 10 ms vượt spec ngay khi luồng lỡ nhịp dù chỉ 1 µs; P = 5 ms chừa 5 ms cho trễ đánh thức trên kernel non-RT.
2. **(b) Worker thức theo sự kiện.** `BusWorker::run_loop` ngủ trên `condition_variable`. `enqueue_write`, `probe_read` và `stop_workers` (qua `wake()`) đánh thức worker ngay. Trần 200 ms (`kWorkerMaxSleepMs`) giữ lại làm lưới an toàn cho lịch đọc.
3. **(c) Ghi trước đọc, có trần.** Trước mỗi lượt đọc một slave, worker phát tối đa `kMaxWritesBeforeRead = 4` lệnh ghi đang chờ, lệnh cũ nhất trước. Nhờ trần này, lượt đọc tới hạn chỉ bị lùi tối đa 4 × t_tx (~116 ms ở 9 600 baud). Lệnh ghi tới thiết bị đã chết tốn t_tx = `timeout_ms` cho mỗi lần phát, nên độ lùi xấu nhất là 4 × `timeout_ms`.
4. **(d) Giá trị mới nhất.** Giữ nguyên coalesce theo (slave, fc, register) của `enqueue_write`. Lệnh đang bay không bị ghi đè (`MBA-FW-04`).
5. **Không đổi:** nhánh nhả F06 (`ext_release_safe`, `ext_release_hold`), mốc khởi động `MBA-FW-02`, kiểm danh tính slot, `MBA-FW-08`. Các test `MbaExtRelease.*`, `MbaWriteBaseline.*`, `MbaWriteQueue.*` và hai test `ISS-MBW-02` vẫn xanh.

**Độ trễ lý thuyết trước/sau:**

| Chặng | Trước | Sau |
|---|---|---|
| Phát hiện `ext_cmd_seq` | 0…100 ms + thời gian vòng `fb-publish` (gồm TCP poll) | 0…5 ms + trễ đánh thức SCHED_OTHER; spec ≤ 10 ms |
| Hàng đợi → worker thức | 0…200 ms | Tức thời nếu worker rảnh; nếu đang giao dịch thì chờ hết lượt đọc của MỘT slave |
| Chờ lượt đọc trong cùng lượt phục vụ | Σ t_đọc của mọi slave tới hạn | 0: ghi đi trước; có thể có tối đa 4 lệnh ghi cũ hơn xếp trước |
| Tổng xấu nhất, bus rảnh, 9 600 baud | ≈ 330 ms | ≈ 5 + 29 ≈ 34 ms |
| Tổng khi bus bận | + Σ t_đọc | + phần còn lại của một lượt đọc slave (số block × t_tx; slave lỗi thì × (1 + retry) × `timeout_ms`) |

**Số đo trên host** (bản Release `build/fw`, 4 lượt chạy; slave libmodbus thật trên PTY 19 200; PTY không có thời gian truyền nên t_tx ≈ 0):

| Phép đo | Mã cũ `baf6a86c` | Mã mới |
|---|---|---|
| Lệnh vào hàng đợi → slave nhận FC05, worker vừa ngủ 30 ms | 170,1–170,2 ms, 5/5 mẫu FAIL | 0,12–0,33 ms |
| `stop_workers` | 170,4 ms, FAIL | 0,09–0,16 ms |
| `probe_read` | 170,3 ms, FAIL | 0,18–0,34 ms |
| Lệnh ghi chờ và lượt đọc tới hạn cùng lượt | Đọc trước, FAIL | Ghi trước |
| `ext_cmd_seq` đổi → slave nhận FC05, đường đầy đủ, 12 mẫu lệch pha | Không đo được trên mã cũ: drain nằm trong `main` | Trung vị 2,84–2,95 ms, tối đa 4,83–5,08 ms |
| CPU luồng `mb-extcmd` trong 500 ms | — | 100–101 lần tỉnh, 1 lần chụp snapshot, 29–40 µs mỗi lần tỉnh (0,59–0,82 % một lõi x86). Riêng chi phí nền của vòng `cv.wait_until` 5 ms không làm gì trên cùng máy là 32–36 µs mỗi lần |
| Dòng lệnh ghi liên tục 600 ms, poll 40 ms | — | 9 984–14 416 lệnh ghi, 16 lượt đọc, khoảng cách đọc lớn nhất 40,1 ms |

**Chờ deploy + đo target.** Phiên này không deploy vì soak 24 h của ADR-061 chạy tới 2026-09-27 06:47Z. Cách đo đề xuất:

1. Chạy lại Program FBD/ST DO của audit ở 1000 ms và 100 ms. Lấy mốc Core đổi lệnh (mốc release của Program trong trace, hoặc `setpoint` của slot `ext`) và mốc FC05 từ Frame Monitor. `at_ms` của Frame Monitor là đồng hồ tường lúc giao dịch XONG, nên trừ `elapsed_us` để ra lúc bắt đầu. Cổng: p99 của Core → bắt đầu FC05 ≤ 10 ms + thời gian bus bận, và không lệnh nào vượt 10 ms + t_tx + một lượt đọc slave.
2. CPU `mb-extcmd` trên A53: tìm tid theo `/proc/<pid>/task/*/comm`, lấy chênh lệch trường đầu của `schedstat` trong 60 s. Kỳ vọng ≤ 1 % một lõi.
3. Không hồi quy đọc: `utilization`, p95 giao dịch và độ trễ readback coil → API giữ như trước, theo nhịp FC01.
4. Hồi quy F06: Disable Program thì DO về `safe_value` như lần đo 17:47.

**Đo trên target Foxlinx (2026-09-26 11:03–11:06 UTC).** Deploy `mkddc-iobus` `cafe5385…` (commit `b96c4469`, GLIBCXX ≤ 3.4.29, GLIBC ≤ 2.38; bo có glibc 2.41), sao lưu `/data/mkddc/deploy-backups/2026-09-26T1110Z-g7/`. `/proc/MainPID/exe` khớp, `NRestarts=0`; log `modbus_master.ext_watch_started period_ms=5` và `write_baseline generation=1 seeded=8`; `mb-extcmd` SCHED_OTHER trên CPU0–2. Core không restart. Lúc iobus restart, Core vào safe-state T3 (`stale=1`) rồi thoát trong cùng giây; `jitterViolationCount`, `missedBaseStepCount`, `missedReleaseCount`, `overrunCount` đều giữ 0.

Đo thụ động trên Active `4206243c…` (#68 của actor khác, ghi FC05 vào coil 0–7 của CK-508 slave 4). Đọc Frame Monitor 30 lần, mỗi lần cách nhau 2 s, gộp theo (`at`, fc, addr); `start = at − elapsedUs`:

| Chỉ số (≈ 65 s mỗi phía) | Trước G7 (`410b2f55…`) | Sau G7 (`cafe5385…`) |
|---|---|---|
| Khoảng lặng của bus ngay trước một FC05: trung vị / p99 / tối đa | 0,0 / 200,2 / 201,1 ms | 0,0 / **1,0** / **1,0** ms |
| Bus bận | 61,9 % | 100 % |
| FC05 mỗi giây | 16,00 | 29,84 |
| Chu kỳ một loạt 8 coil (FC05 addr 0 → addr 0): trung vị | 500 ms | 268 ms |
| Đọc FC01 / FC02 mỗi giây | 4,02 / 2,01 | 3,74 / 1,87 |
| CPU `mb-extcmd` (`schedstat`, 64 s) | — | 370 ms, tức 0,58 % một lõi A53 |

Diễn giải:
- Trước G7, bus có những khoảng lặng tới 200 ms dù còn lệnh chờ. Đó đúng là trần ngủ của worker cũ, và FC05 bị khoá ở 8 coil × 2 Hz.
- Sau G7, bus không còn lặng khi có lệnh chờ (tối đa 1,0 ms).
- Program đổi coil nhanh hơn băng thông 9 600 baud chở được: 8 × 29 ms + đọc ≈ 268 ms mỗi loạt. Bus vì vậy bận 100 %, và nguyên tắc "giá trị mới nhất" gộp các giá trị trung gian, đúng spec I/O mở rộng.
- Đọc không bị bỏ đói, chỉ giảm 7 % so với trước do trần `kMaxWritesBeforeRead = 4`.

Phép đo trực tiếp Core → FC05 (mục 1) và hồi quy F06 (mục 4) đã chạy ngày 2026-09-26, 11:43–11:59 UTC, với sự cho phép của chủ sở hữu (xem lượt 4). Release → `ext_cmd_seq` trung vị 1,5–1,7 ms; `ext_cmd_seq` → FC05 trung vị 1,1–1,2 ms, tối đa 4,5 ms: **PASS**. Disable ⇒ `safe_value` sau 12–261 ms: **PASS**. Không dùng Trace làm mốc Core, vì F18 làm mốc Trace sai.

**Chưa làm trong G7, và lý do:** gộp FC15 theo module thay đổi khung trên dây và cần xác nhận CK-508 hỗ trợ FC15. Nhóm poll readback nhanh cho actuator là thay đổi cấu hình/profile do BE sinh. Nâng baud cần datasheet CK-508 và cấu hình cả hai phía dây.

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
| F02 | **P1** so với spec | Profile Rev A: base step 1000 ms, `taskPeriodsMs=[1000,5000,30000]`, 1 Task | Log `core.base_step_ms=1000`; capabilities | Quyết định hợp đồng Rev A | **ĐÃ SỬA (PR #756, ADR-061)**: profile v2.2, base step 10 ms, `taskPeriodsMs=[10,50,100,500,1000,5000,10000,50000]`, 8 lớp chu kỳ; lượt 3 kiểm C1 trên target (Core, capabilities, từ chối 5/7/30000 ms) |
| F03 | **P1** so với spec | Kernel non-RT không giữ được jitter ≤ 100 µs | `core.jitter` 105–268 µs; `cyclictest` tối đa 470 µs (10 ms ghim lõi), 3 200 µs (`-S`) | `PREEMPT_VOLUNTARY`, IRQ và tiến trình khác dùng chung lõi, governor `schedutil` | **Giảm thiểu, chưa đóng**: nền RT tạm (F11 cpuidle, F14 CPU3 độc quyền, F15 kernel thread, F16 pidfile, F17 cpufreq). Soak lần 2 (từ 2026-09-26 10:46:27Z) sau 937 phút: 0 lần vượt 100 µs, tối đa 72,9 µs/phút. PREEMPT_RT (G2) vẫn chặn vì thiếu BSP; chỉ được ghi spec sau soak 24 h đạt trên bản cuối |
| F04 | P2 | Sau Restore, Program của Revision được khôi phục không chạy dù `desiredEnabled=true`; phải PUT intent lại | 16:17:38 task STOPPED; 16:35 PUT intent → RUNNING | Restore không áp lại intent Enable đã lưu (cần đọc mã để chốt) | **ĐÃ SỬA `a1a976dd`**: vòng reconcile 2 s đối chiếu MỨC với snapshot sống; Program đang nghỉ ngược intent được replay, FAULTED/ROLLED_BACK không tự bật lại. 5 test mới. Deploy web + Restore trên target: xem lượt 2 |
| F05 | P2 | Trace không lên Core: yêu cầu 100 ms nhưng mẫu ~2 s, `programValue` luôn null; monitor mất ~2 s | Trace `1c5cc23f…`; log web `runtime/monitor dur_ms=1972` | `TRACE_START` bị từ chối hoặc lỗi IPC nên rơi về poll; lý do không được log. IPC web chỉ được phục vụ mỗi lần quét (1 s) | **ĐÃ SỬA `aa3f6a57`**: envelope TRACE_* mang actor + correlation của phiên (bản giả trong test chạy `ValidateRequest`; đỏ trên mã cũ, xanh trên mã mới); monitor lấy `programValue` của DO Modbus từ `setpoint` slot `ext`. Còn mở: IPC web chỉ được phục vụ mỗi scan (hết khi base step 10 ms, G3), khoá cho `StValueTrace` (G3). **2026-09-26 — phần còn mở đã làm trong mã (X19, ADR-061 4.10 bước 2), chờ deploy + đo target**: IPC web chạy trên luồng `web-ipc` riêng nên `point_snapshot` được trả ngay, không chờ scan; `StValueTrace` có khoá quay mà luồng quét chỉ `try_lock` (bỏ lượt và đếm `contended_boundary_count`, không bao giờ chờ), tên → slot phân giải trên luồng quét. Test đồng thời chạy dưới ThreadSanitizer |
| F06 | P2, cần quyết định | Disable Program có output EXT Modbus để DO giữ giá trị cuối vô thời hạn | DO2 giữ 1 từ 16:17:01 tới khi write-test 16:35 | `PROGRAMMING_CONTROL_SEMANTICS` §6: withdraw rồi "tầng dưới quyết định", nhưng EXT không có resolver/relinquish nên không có tầng dưới | **ĐÃ SỬA `f73ee6a1` (PR #752), đo trên target 17:47**: chủ sở hữu chọn "về safe_value". Core nhả slot (`dirty=0` + seq mới) cho instance đã publish; iobus ghi `safe_value` từ profile (BE sinh khoá này), điểm không khai thì giữ giá trị cuối kèm WARN. Disable lúc 17:47:35,9 thì DO2/DO4 về 0 trong ≤ 1,2 s. Phần Program bị bỏ khỏi gói do Commission/Restore: xem F20 (đã sửa, PASS target 2026-09-27) |
| F07 | P3 | Danh sách intent hiện RUNNING/FAULTED (`LAST_KNOWN`) cho Program không thuộc Active Revision | `136d8ab2…` hiện "RUNNING" khi đã bị thay; `5619efde…`/`9f1887fe…` FAULTED | Ghép intent lưu trữ với trạng thái cuối, không lọc theo Active | **ĐÃ SỬA `a1a976dd`**: Program vắng trong gói đang chạy không nhận replay; `IPC-UNKNOWN-INSTANCE` giữ UNKNOWN, không ghi FAULTED. Hiển thị `LAST_KNOWN` giữ đúng hợp đồng OpenAPI |
| F08 | P3 | `journalctl -p warning` không bắt được dòng WARN/ERROR của ứng dụng; baseline "0 dòng" trước đây bị mù | 16:13:46 web in `WARN health degraded err=shm /dev/shm/mkddc_io_shm: không đọc được snapshot nhất quán` nhưng `-p warning` trả "No entries" | Ứng dụng in ra stderr, journald gán mức info | **ĐÃ SỬA (PR kế tiếp)**: Core/iobus bọc stderr, web bọc stdout/stderr. Dòng được gắn `<3>`/`<4>`/`<6>`/`<7>` theo token mức, chỉ khi fd THẬT SỰ là stream journald (so `dev:inode` của `JOURNAL_STREAM`); buffer tĩnh, không cấp phát ở đường RT |
| F09 | P3 | `Draft.latestCheck` trỏ tới Check PASSED của Revision thử nghiệm trong khi nội dung Draft là WIP chưa Check (`dirty=true`) | `GET /projects` sau khôi phục | Check gắn với base revision | **KHÔNG PHẢI LỖI**: FE xét `dirty` trước `latestCheck` (`draftStateLabel` hiện "Có thay đổi chưa phát hành", CTA ra `CONTINUE_EDITING`), nên Check PASSED của base revision không bị hiển thị như kết quả của Draft đang sửa |
| F10 | P3 | Chẩn đoán FBD gây hiểu nhầm: biến đã khai trong bảng locals (OUTPUT) nhưng không có khối OUTPUT thì báo "not declared in VAR_INPUT/VAR_OUTPUT" | Check `f90e1433…` của Draft WIP | Bộ biên dịch FBD chỉ khai VAR_OUTPUT từ khối OUTPUT (`st_fbd_compile.cpp:275`) | **ĐÃ SỬA (PR kế tiếp)**: thông điệp `ST-IOMAP-001` nói rõ "in FBD a variable is declared only by an INPUT/OUTPUT block that uses it on the diagram"; test khoá nội dung |
| F11 | **P1** so với C4 | Ở base step 10 ms, 13,07 % lần thức dậy của vòng quét lệch > 100 µs (785/6008 trong 60 s), gấp khoảng 50 lần `cyclictest` cùng CPU; không log nào nói lý do | Lượt 3, 04:46–04:48 | CPU3 vào trạng thái cpuidle `cpu-sleep` (exit latency 370 µs) trong mỗi khoảng ngủ 10 ms. Unit ghim Core vào CPU3 nhưng không ràng buộc độ trễ thức dậy; `cyclictest` né được vì giữ `/dev/cpu_dma_latency=0`. Core không kiểm nên thiếu ràng buộc là thiếu âm thầm | **ĐÃ SỬA `44425dc6` + `7193ef4a`**: unit core đặt `pm_qos_resume_latency_us=20` cho CPU3 bằng root (`ExecStartPre=-+`), trả về 0 khi stop; Core đọc cpuidle/QoS lúc khởi động, log `ERROR rt.cpu_idle_exposed` khi còn trạng thái > 100 µs. Trên target: 0,15 % lần lệch > 100 µs, trung bình 55 → 22 µs. C4 vẫn cần PREEMPT_RT (G2) |
| F12 | **P1** vận hành | Bấm Check thì treo khoảng 30 s rồi báo `ST-WORKER-CRASH`; mọi Check trên bo hỏng | Lượt 3, 04:49 và 05:00 | (1) Lượt deploy ADR-061 lúc 04:38 cập nhật web/core/iobus nhưng bỏ sót tool ST trong `/usr/sbin`, nên compiler còn profile v2.1. (2) Runner gộp "profile khác" vào "metadata sai"; Check thử lại sau lease 30 s rồi mới đóng bằng mã crash chung. (3) Quy trình deploy từng phần (`DEPLOY_FOXLINX.md`, skill `foxlinx-deploy`) không có bước đồng bộ tool ST. Cùng họ với `P5-507-F05` | **ĐÃ SỬA (Issue #758)**: cài lại tool trên bo; `ToolchainProbe` kiểm `--version` lúc khởi động và mỗi lần nhận Check; lệch bản ⇒ FAILED ngay với mã mới `ST-WORKER-TOOLCHAIN` (catalog 1.13.0), không thử lại; tài liệu và skill deploy thêm bước 2b |
| F13 | P2 | Commission/Restore sang revision có Program chưa chạy trong gói cũ thì Core vào safe-state `no_ctrl` tới 2 s (đo 1,38 s): mọi AO/DO bị ép về giá trị an toàn | Lượt 3, 05:03:15 | Core dựng Program mới ở Disabled (fail-closed, T59-305/405); intent Enable chỉ được web replay ở tick reconcile 2 s kế tiếp (F04) | **ĐÃ SỬA `1de5373c`**: `OperationService` đánh thức reconcile ngay khi Commission/Restore SUCCEEDED (`RuntimeIntentService.Nudge`). Trên target còn 70 ms, là thời gian một vòng IPC. **Về 0 ms theo `ADR-062`** (chủ sở hữu chốt 2026-09-26 "Sửa về 0 ms"): ACTIVATE mang intent đã lưu (`programIntents`), Core áp lên shadow sau `COMMIT_INTENT` và trước arm, nên Program có intent Enable là `RUNNING` ngay tại boundary kích hoạt gói. Đàm phán qua capability `ACTIVATE_PROGRAM_INTENTS`, không nâng `protocolMinor`. Host (nhánh `fix/programming-activate-intent-f13-20260926`): test qua `ScanLoop` thật khoá 0 scan `no_ctrl` và DO-01 giữ 1 từ ACTIVATE tới COMMITTED; ca đối chứng không có intent vẫn thấy `safe_state.enter … no_ctrl=1`. **Chờ deploy Core + web và đo target** theo `ADR-062` mục 8: log `programming.activate_intents … enabled=1` và không có `safe_state.enter … no_ctrl=1` quanh Restore |
| F14 | **P1** so với C3/C4 | Ghim riêng service mkddc chưa đủ: restart một dịch vụ làm vòng quét thức dậy trễ 2,3–3,8 ms; lần khởi động core có web kèm từng trễ 12,2 ms và lỡ một base step và một release (C3) | Lượt 3, 05:29–05:50 | PID 1, journald, sshd và kworker unbound vẫn được chạy trên CPU3; trên kernel `PREEMPT_VOLUNTARY` syscall dài của chúng giữ CPU3 | **ĐÃ SỬA `8ab78341` + `ae1e54e0`**: `system.conf.d/mkddc-rt.conf` `CPUAffinity=0-2`; unit core ghi `workqueue/cpumask=7`; Core log `WARN rt.housekeeping_on_scan_cpu` / `rt.workqueue_on_scan_cpu`. Đỉnh khi restart dịch vụ còn 117–119 µs; cửa sổ 300 s tối đa 131 µs. C4 vẫn cần PREEMPT_RT |
| F15 | **P1** so với C4 | Dưới tải giao diện qua Wi-Fi, 0,73 % lần thức dậy của vòng quét vượt 100 µs (tối đa 215 µs), dù service, IRQ, PID 1 và workqueue unbound đã rời CPU3 | Lượt 3, 06:00–06:18 | kthreadd và kernel thread không gắn CPU (luồng TX/HAL của driver Wi-Fi Realtek) có affinity 0-3; chúng bị đánh thức khoảng 460 lần/s trên CPU3 mỗi khi web gửi gói mạng | **ĐÃ SỬA `fb053a6f` + `c1e63f18` + `193cf0a1`**: `/usr/libexec/mkddc/rt-housekeeping` (unit core `ExecStartPre`) dời chúng sang 0–2; Core log `WARN rt.kthread_on_scan_cpu` khi còn thread dời được mà chưa dời (bỏ qua `PF_NO_SETAFFINITY`); guard pytest khoá unit, install.sh và drop-in |
| F16 | **P1** so với C3 | 3/5 lần khởi động core có một lần thức dậy trễ 11,6–12,2 ms, lỡ một base step và một release | Lượt 3, 06:24–06:43 | Drop-in riêng của bo `pidfile.conf` chạy `ExecStartPost` (shell ghi pidfile) song song với vòng quét. Mọi lệnh `Exec*` nhận `CPUAffinity=3` + SCHED_FIFO 80 của unit, nên FIFO cùng mức không preempt nhau | **ĐÃ SỬA `20f4f0af`**: Core tự ghi `/run/mkddc/core.pid` (tmp + rename, xoá khi tắt nếu vẫn là chủ); unit ghi rõ cấm `Exec*` chạy song song; guard pytest chặn `ExecStartPost`. Kèm `b99d637d`: mỗi base step lỡ log `WARN core.base_step_missed cause=wake_late/step_overrun` (tối đa 1 dòng/giây), và đo mốc thức dậy trước reload |
| F17 | **P1** so với C4 | Soak 24 h hỏng sau 3,5 h: 2 lần thức dậy lệch > 100 µs (tối đa 129,6 µs) trong phút 07:41–07:42Z, thêm 1 lần 153 µs lúc 10:25–10:26Z; ghi 64 MB fsync hoặc `systemctl daemon-reload` ở CPU0–2 tái hiện được (109–163 µs) | Lượt 4, 10:18–10:48 | RV1126B có MỘT policy cpufreq cho cả 4 lõi (`related_cpus=0 1 2 3`), governor `schedutil` đổi tần số khoảng 100 lần/giây (17 086 185 lần từ lúc boot) theo tải ở CPU0–2. Mỗi lần đổi cả cụm khựng: trace CPU3 cho thấy đoạn `sched_waking` → `sched_wakeup` của mkddc-core dài 57–81 µs (bình thường ~18 µs) trong khi CPU3 rảnh, không tác vụ nào chen vào. Unit core đã ràng buộc cpuidle (F11) và dồn việc nền (F14/F15) nhưng chưa ràng buộc tần số | **ĐÃ SỬA `a345b585` + `ff2f92fe`**: `/usr/libexec/mkddc/rt-cpufreq hold 3` (unit core `ExecStartPre`) đặt `performance` cho policy chứa CPU3 và lưu governor cũ, `release 3` (`ExecStopPost`) trả lại; Core log `ERROR rt.cpufreq_scaling` / `INFO rt.cpufreq_ok`; guard pytest. A/B cùng tải: `schedutil` +3/+7 lần vượt, `performance` +0/+0. Sau deploy: 5 lần ghi 64 MB + 5 lần `daemon-reload` cho +0 lần vượt, 0 lần đổi tần số; CPU 48,4 °C ở 1 296 MHz |
| F18 | **P2** | Trace ở chu kỳ lấy mẫu ngắn hỏng âm thầm sau đúng 256 mẫu (2,56 s ở 10 ms, 4,3 phút ở 1000 ms). Sau đó web trộn mẫu poll monitor vào phiên Core: mốc `observedAt` trùng nhau 33–45 lần mỗi giây và có lúc chạy lùi 920 ms, trong khi `droppedSamples` vẫn báo 0. Mọi phép đo thời gian dựa trên Trace đều sai | Lượt 4, 11:43–12:05: 65 s Trace 10 ms chỉ còn 1 319 mẫu thay vì ~6 500; phần mẫu Core luôn dừng ở 253–256 mẫu với 1, 2 hay 4 biến và với 10 hay 20 ms | `TRACE_READ` trả TRỌN ring mỗi lần. Bộ giải mã CBOR của web đặt `MaxArrayElements: 256` (`coreipc/codec.go`), nên từ mẫu 257 mọi lần đọc giải mã hỏng. `runTrace` coi đọc hỏng như Core không có phiên và rơi về poll monitor. Ring đầy (5 000 mẫu) cũng vượt trần payload IPC 32 KiB. Lượt 2 chỉ kiểm F05 với 12 mẫu 1000 ms nên không chạm ngưỡng | **ĐÃ SỬA (PR #772), PASS target 2026-09-27 02:42 (5 000 mẫu, 10 ms đều, 0 mốc lùi)**:
- `TRACE_READ` đọc tăng dần theo số thứ tự tuyệt đối `[sessionId, fromSequence]`, mỗi lô ≤ 200 mẫu và dưới 28 KiB, trả `firstSequence`/`nextSequence`.
- Web nối mẫu, cộng khoảng hụt vào `droppedSamples`, và không bao giờ trộn mẫu monitor vào phiên Core (đọc hỏng liên tục 3 s ⇒ FAILED `SOURCE_UNAVAILABLE`).
- Mốc wall neo một lần mỗi phiên.
- Web poll Core ≥ 100 ms.
- Đường dự phòng bỏ mẫu trùng mốc.
- Test C++ (10 050 mẫu, ghi đè 50) và Go (600 mẫu qua 3 lô, `-race`) |
| F19 | P3 vận hành | Core in một dòng `INFO web_ipc.client_connected fd=N` cho MỖI kết nối web, từ luồng quét. Đo trên bo lượt 4 (2026-09-26 11:54Z): ~3 dòng/s lúc bình thường, ~50 dòng/s khi có Trace 10 ms, tức hàng triệu dòng/ngày vào journald, mỗi dòng một lần ghi stderr trên luồng SCHED_FIFO | Lượt 4, 11:54Z | web-api mở kết nối Unix MỚI cho mỗi yêu cầu (`sendWebIPC`, `GetMonitor` mỗi mẫu trace), còn `WebIpc::drain()` log mọi lần `accept4`. Kết nối bị từ chối vì đủ `max_clients` thì ngược lại bị đóng im lặng | **ĐÃ SỬA (PR #775), PASS target 2026-09-27 03:04**: 0 dòng `client_connected`, 1 dòng `web_ipc.connections accepted=154 refused=0` mỗi phút. bỏ dòng mỗi kết nối; một dòng `INFO web_ipc.connections accepted=N refused=M window_s=60 clients=K` mỗi 60 s, chỉ khi cửa sổ có kết nối, in từ luồng `web-ipc` (không còn từ luồng quét); kết nối bị từ chối được đếm. Test `WebIpc.ConnectionsAreLoggedAsWindowedSummaryNotPerConnection` |

Finding mở ra khi dựng soak lần 3 (2026-09-27). F20 đã sửa theo quyết định sẵn có của chủ sở hữu (ADR-061 §3, F06), deploy và PASS trên target ngày 2026-09-27. F21 và F22 (mở khi sửa F21) đã sửa ở PR #778. F23 mở ra lúc dọn soak lần 3 và đã sửa ở web-api.

| ID | Mức | Mô tả | Bằng chứng | Nguyên nhân gốc | Hướng sửa |
|---|---|---|---|---|---|
| F20 | **P2** | Commission/Restore sang gói không còn Program nào lái một AO/DO cục bộ thì đầu ra đó **giữ giá trị cuối của gói cũ vô thời hạn**: không bị rút tại safe boundary, không hết `holdTtl` 60 s, và T7 `no_ctrl` không bật. Trái ADR-051 ("trần tuyệt đối") và `PROGRAMMING_CONTROL_SEMANTICS` §6 | Host, test tạm qua `ScanLoop` thật (`ScanRig` của `test_programming_activate_intent.cpp`, không commit), chạy trên `main@8353fdc1` và lại trên cây đã gộp `main@3198d493` (sau X19), cùng kết quả: P_old lái DO-01, Commission gói chỉ có P_soak không output. Sau đó P_old rời scheduler, nhưng DO-01 vẫn = 1 ở mức 5 và `safe=0 no_ctrl=0`, kể cả sau 65 s. Target, lượt 4 02:41:54: kích hoạt revision thử có hai Program Disabled, không có dòng `safe_state.enter` nào | Chỉ `st_withdraw_instance_outputs` gọi `PriorityResolver::release_ao/release_do` ở mức 5, và nó chỉ chạy từ `st_withdraw_stale_outputs` trên Program của gói **đang chạy**. `swap_prepared_program_set_at_boundary` chuyển gói cũ sang slot rollback, còn coordinator chỉ xoá sổ candidate (`PACKAGE_REPLACED`), không rút mức 5 | **ĐÃ SỬA (PR #779, `main@01fd8708`), DEPLOY và PASS target 2026-09-27 04:03–04:04Z**, xem mục "F20 — kết quả trên target". Quyết định đã có (ADR-061 §3, F06): instance bị loại khỏi gói là instance bị rút. Tại đúng boundary đổi gói, `on_safe_boundary(resolver, writer)` gọi `st_withdraw_replaced_outputs()` cho topology vừa rời scheduler. Lời gọi chạy sau khi owner mode đã áp dụng và trước khi Program của gói mới chạy. Điểm gói mới cũng nắm (instance `RUNNING`, owner `PROGRAM_ONLY`) được bàn giao, không nhả: không glitch EXT, không tạo lại `no_ctrl` (F13). Điểm còn lại: AO/DO nhả mức 5, EXT đã publish về `safe_value`. Rollback chu kỳ đầu (owner về `GRAPH_ONLY`) nhả mọi claim của gói ứng viên. Host: 8 test `ProgrammingPackageSwapWithdraw.*`, 7 ca qua `ScanLoop` thật. Trên `main@fa18bfe7` và lại trên `main@0c23c143` (sau F21/F22) có 6/7 ca `ScanLoop` đỏ; sau sửa cả 8 xanh, `ctest` 1623/1623. Mutation "nhả hết điểm của gói cũ" làm đỏ 4 ca điểm chung/rollback. Cách đo target ở mục "F20 — cách đo trên target". Soak lần 3 chạy `start --outputs hold` trên Core có F20, nên chính lần đổi gói của soak là phép đo target |
| F21 | P3 | `ScanLoop::step` gọi `SafeState::apply(last_io_, table, &out)` mà không truyền `graph_is_active_producer`. Tham số này mặc định `true` kể cả ở `PROGRAM_ONLY`. Nếu có `graph.json` được nạp thì dưới Programming T7 không bao giờ bật, còn T6 vẫn xét input của một graph không chạy | Đọc mã và lịch sử git: `d594c023` truyền `active_mode != CutoverMode::PROGRAM_ONLY` (kèm `runtime_task_state`). Merge `0a98a907` (2026-08-28) làm mất cả hai. `safe_state.hpp` vẫn mô tả tham số. **Chưa đo.** Lúc đo F13 trên bo T7 có bật, nên khi đó graph không được nạp | Mất khi gộp nhánh | **ĐÃ SỬA (nhánh `fix/core-producer-gating-f21-f22-20260927`)**: truyền lại `active_mode != CutoverMode::PROGRAM_ONLY`, đúng dạng ở `d594c023`. Test `ScanLoop.ProgramOnlyWithLoadedGraphAndNoControllerEntersSafeState` đỏ trên mã cũ (dòng 181), xanh trên mã sửa. Trên Foxlinx không có `graph.json` (`graph.none`) nên hành vi bo hiện tại không đổi |
| F22 | P2 | Dưới PROGRAM_ONLY, `ScanLoop` vẫn gọi `graph->apply_ext_writes()`. Graph đã chạy ở GRAPH_ONLY giữ `_setpoint` cuối của node `Modbus_RTU_Write`, nên sau Commission mỗi scan nó ghi đè lại giá trị cũ lên slot EXT mà Program đang giữ: `ext_cmd_seq` tăng hai lần mỗi scan và giá trị của graph thắng Program | Đọc mã khi sửa F21 (2026-09-27); test host đỏ trên mã cũ: `setpoint` 10 → 50, seq 5 → tăng | Bước 5 đã khoá `graph->execute()` theo PROGRAM_ONLY (TASK-PROG-306), nhưng bước 5a ghi EXT của graph thì không | **ĐÃ SỬA (cùng nhánh F21)**: chỉ gọi `apply_ext_writes` khi graph là producer. Test `ScanLoop.ProgramOnlyGraphDoesNotOverwriteExtCommands` đỏ trên mã cũ, xanh trên mã sửa. Trên Foxlinx không có `graph.json` nên hành vi bo hiện tại không đổi |
| F23 | P3 | `GET /programming/projects/{id}/programs` gộp mọi Program trong bảng sống của Core mà Project chưa ghi intent ("chỉ Core biết") vào trang của **bất kỳ** Project nào. Khi có hơn một Project, trang của Project không chạy hiện Program của Active là `RUNNING CORE_LIVE` với `desiredEnabled=null`, như thể Program đó thuộc Project này | Target 2026-09-27: lúc 04:16Z trang của `SOAK-ADR061` liệt kê `5619efde…` (Program của AHU, Active #69). Trong 11 phút soak, trang của AHU (đang mở trên giao diện) liệt kê 8 Program `SOAK_*` | `ListPrograms` coi mọi instance Core báo mà thiếu intent là Program mồ côi của Project đang hỏi. Nhưng bảng Program của Core không gắn Project: nó là tập instance của Revision đang chạy, nên chỉ Project sở hữu Revision đó được nhận các dòng này | **ĐÃ SỬA (PR #781), DEPLOY và PASS target 2026-09-27 04:28Z.** Dòng "chỉ Core biết" chỉ được gộp khi Project hỏi là chủ của Active, tra cùng cách `ProjectService.resolveActiveRevision`: STATUS của Core, rồi header Revision trong DB Web. Không phân giải được chủ (Core im, chưa có Active, Revision lạ với DB) thì không Project nào nhận. STATUS chỉ được gọi khi thật sự có dòng như vậy, nên trang của Project đang chạy không tốn thêm IPC mỗi lần poll. Test: 3 test mới (`programs_owner_f23_test.go`); 2 test đỏ trên mã cũ. Test cũ cho Program mồ côi nay có Active thuộc chính Project đó. `go vet ./...` và `go test ./... -count=1` PASS |

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
| 05:29 | Deploy core + tool ST + web + FE + sim worker từ `main@5ed30545` (PR #760) | Sao lưu `…T0529Z-pr760/`; core `d37f0652…` (`git_commit=5ed30545…`, trước đó bản build `-dirty` lúc 04:56), web `b59627ad…`, cả ba `NRestarts=0`, health 6/6 `ok`. Log `rt.cpu_idle_ok cpu=3` và `INFO programming.toolchain ok … profile_sha256=1cb61fec…` | PASS deploy |
| 05:30:27 | Kiểm F12 trên target bằng compiler cũ (v2.1, lấy từ bản sao lưu) | Check `7adb079d…` **FAILED sau 0,1 s**, `PRG-ERR-UNAVAILABLE-001 · ST-WORKER-TOOLCHAIN`, `attemptCount=1`; log `ERROR programming_check toolchain_mismatch … profile_sha256=d2866c41… (web cần 1cb61fec…)`. Trả compiler mới (`902893a0…`): probe tự dò lại theo inode, Check **PASSED 0,6 s** không cần restart web | **PASS F12** |
| 05:36 | Deploy web F13 (`1de5373c`) | Sao lưu `…T0536Z-f13/`; web `d9d27c54…`, `NRestarts=0`, toolchain ok | PASS deploy |
| 05:37:15–05:37:34 | Kiểm F13: Restore #52 rồi #63 | Khoảng safe-state `no_ctrl` khi kích hoạt #63 còn **70 ms** (05:37:34,488 → 05:37:34,558), trước là 1,38 s | **PASS F13** (còn 70 ms, xem F13) |
| 05:37:34–05:38:13 | Sự cố do phiên này | Active trước lượt thử là `4206243c…` (#68, actor khác Commission lúc 05:21:49), nhưng script ghim cứng việc trả về #63, nên #63 thay #68 trong 39 s. Đã Restore về `4206243c…` lúc 05:38:13 (SUCCEEDED 0,6 s, RUNNING, `safeState=false`). Bài học: mọi script thử phải đọc Active ngay trước khi đổi, và trả về đúng giá trị đó | Đã khôi phục |
| 05:39–05:50 | Tìm nguyên nhân đỉnh trễ ms (F14) | Chỉ restart web: đỉnh 2,6 ms. Dời `prog-ipc`/`st-retain` khỏi CPU3: vẫn 2,3–3,8 ms, loại trừ. Ghim PID 1, mọi tiến trình user-space (trừ core) và workqueue unbound sang CPU0–2: restart web 2 lần chỉ còn 117 / 119 µs | Nguyên nhân xác nhận |
| 05:50–05:55 | Cửa sổ 300 s với CPU3 độc quyền | 30 006 lần chạy; 13 lần > 100 µs (0,04 %); tối đa theo phút 104–131 µs; trung bình 18,4–22,1 µs; missed step/release 0; overrun 0 | C2, C3 PASS; C4 **FAIL** (sát ngưỡng) |
| 05:59 | Deploy core F14 (`ae1e54e0`) + unit + `system.conf.d/mkddc-rt.conf` | Sao lưu `…T0559Z-f14/`; core `375d2c66…` (`git_commit=ae1e54e0…`), CPU3, `workqueue/cpumask=7`, QoS 20. Drop-in: `daemon-reload` đưa PID 1 từ 0-3 về 0-2, gỡ drop-in rồi reload thì về 0-3; `daemon-reexec` không áp | PASS deploy F14 |
| 06:00–06:14 | Lệch nhịp tăng lại dưới tải giao diện | Actor khác deploy lại web lúc 06:00:57 và dùng giao diện; cửa sổ 60 s: 0,48–0,75 % lần vượt 100 µs, tối đa 215–321 µs. Dời `prog-ipc`/`st-retain` khỏi CPU3 không đổi gì (0,62 / 0,70 % so với 0,48 / 0,75 %) | FAIL C4 |
| 06:14 | Tìm nguồn (F15) | CPU3 nhận khoảng 464 IPI1/s ("function call"). `perf record -e ipi:ipi_raise`: 2 135 IPI đích CPU3 trong 5 s, đều là `ttwu_queue_wakelist` (đánh thức tác vụ nằm trên CPU3) từ web (`complete`/`up`), `RTW_RECV_THREAD`, `ksdioirqd/mmc2` và ngắt SDIO. Kernel thread của driver Wi-Fi (`RTW_XMIT_THREAD`, `RTWHALXT`) và kthreadd có affinity 0-3 | Nguyên nhân xác nhận |
| 06:16–06:18 | Dời 26 kernel thread không gắn CPU sang 0–2 (35 thread `PF_NO_SETAFFINITY` không dời được) | Cùng tải: trước 44/6006 (0,73 %, tối đa 215 µs); sau **0/6006 và 0/6006, tối đa 61 / 85 µs** | Lần đầu đạt C4 trong cửa sổ đo |
| 06:21 | Deploy core `c1e63f18` + `rt-housekeeping` + unit | Sao lưu `…T0621Z-f15/`. Trả 26 thread về 0-3 trước khi restart; `ExecStartPre` log `rt-housekeeping: cpus=0-2 workqueue=7 kthread_moved=26 kthread_pinned_by_kernel=35`. Core báo nhầm `WARN rt.kthread_on_scan_cpu count=35`, vì phép đếm tính cả thread kernel tự quản | Deploy PASS; phát hiện báo động giả |
| 06:24 | Deploy core `193cf0a1` (bỏ qua `PF_NO_SETAFFINITY` khi đếm) | Core `f6f2e81c…`, không còn WARN; `rt-housekeeping … kthread_moved=0 kthread_pinned_by_kernel=35`. Đồng thời restart `mkddc-time-helper` / `mkddc-reload-helper`, trước đó chạy binary `(deleted)` từ 2026-09-24 | PASS |
| 06:26:57–06:36:57 | Cửa sổ 600 s sau F15, tải giao diện, 2 lần restart web (06:27:02, 06:30:02) | 60 007 lần chạy; **1 lần vượt 100 µs**; missed step/release 0; overrun 0; lệch tối đa theo phút 55–114 µs, trung bình khoảng 17,5 µs; hai lần restart web không tạo đỉnh | C2, C3 PASS; C4 gần đạt |
| 06:24:40 | Phút đầu sau khởi động core (ngoài cửa sổ trên) | Lại một lần trễ 11,84 ms, lỡ 1 step. Đây là lần thứ ba ở cỡ khoảng 12 ms (12,21 / 12,18 / 11,84 ms), 3/5 lần khởi động | FAIL C3 lúc khởi động |
| 06:38 | Deploy core `b99d637d`: mỗi base step lỡ log `WARN core.base_step_missed` có nguyên nhân | `cause=wake_late late_us=11592 skipped=1` lúc 06:38:54,1627, khoảng 21 ms sau `core.ready` (06:38:54,1418) | Thời điểm bắt được |
| 06:42–06:43 | Tìm nguyên nhân (F16) | Drop-in riêng của bo `mkddc-core.service.d/pidfile.conf` chạy `ExecStartPost=/bin/sh -c "echo $MAINPID > /run/mkddc/core.pid …"` ngay sau READY=1. Cho chính shell đó tự ghi lại lập lịch: `SCHED_FIFO` 80, affinity 3, tức cùng CPU và cùng mức ưu tiên với vòng quét | Nguyên nhân xác nhận |
| 06:45–06:47 | Deploy core `42577f91` (core tự ghi pidfile) + unit; gỡ `pidfile.conf` (sao lưu `…T0645Z-f16/`) | Restart core 5 lần: **0/5 lỡ step lúc khởi động**; pidfile trùng MainPID, chủ `mkddc`; `ExecStartPost` rỗng. `kill -HUP $(cat /run/mkddc/core.pid)` bằng user mkddc → `core.reload SIGHUP`, không lỡ step | **PASS F16** |
| 06:47:16–06:58 | Cửa sổ 600 s sau F16, tính từ phút đầu sau khởi động core, tải giao diện, 2 lần restart web (06:49:45, 06:52:46) | 60 006 lần chạy; **0 lần vượt 100 µs**; lệch tối đa theo phút 60–85 µs; trung bình 17,4–20,6 µs; missed step 0; missed release 0; overrun 0; không có dòng `base_step_missed` | **C1–C4 PASS** trong cửa sổ đo |
| 06:47:16 → 2026-09-27 06:47Z | Soak 24 h (cổng ghi spec, ADR-061 "Hệ quả") | Core `42577f91` PID 106118 bắt đầu 06:47:16Z. Journal bo giữ log từ 2026-09-21 (1,2 GB), nên đủ 24 h. Cách đọc: `journalctl -u mkddc-core --since "2026-09-26 06:47:16" --until "2026-09-27 06:47:16" \| grep -E "core.jitter\|base_step_missed"` (mọi phút phải `violations` không tăng, `missed_steps` không tăng, `overruns=0`) cùng `GET /programming/runtime` (`jitterViolationCount`, `missedBaseStepCount`, `missedReleaseCount`, `overrunCount` = 0). Core restart giữa chừng thì soak phải bắt đầu lại | Đang chạy |

## Audit lượt 4 (2026-09-26 10:15 UTC trở đi) — soak 24 h hỏng, F17, sự cố bảo mật trên bo

Bo lab bị xâm nhập qua SSH (mật khẩu root yếu) từ 2026-09-22; phát hiện trong lượt này khi tìm nguyên nhân C4. Chi tiết và việc ngăn chặn ở `docs/07_records/security/2026-09-26-foxlinx-ssh-intrusion.md` (`SEC-INC-20260926-FOXLINX`). Thành phần độc chạy được trên ARM chỉ là timer chép lại khoảng 8,7 MB mỗi phút, nên nó chỉ làm số đo xấu hơn: các kết luận FAIL giữ nguyên, PASS 600 s ở lượt 3 là bảo thủ. Từ 10:45Z SSH vào bo chỉ nhận khoá.

| Thời điểm (UTC) | Bước | Kết quả / bằng chứng | Trạng thái |
|---|---|---|---|
| 10:18 | Đọc soak (core `42577f91`, PID 106118, từ 06:47:16) | 210 phút `core.jitter`: `violations=2`, cả hai trong phút 07:41:16–07:42:16 (tối đa 129,63 µs); `missed_steps=0`, `overruns=0`, không có `base_step_missed` | **FAIL C4** (soak) |
| 10:20–10:45 | Phát hiện và ngăn chặn xâm nhập | Xem hồ sơ sự cố. Core, iobus, web không restart | Ghi nhận |
| 10:25–10:26 | Vi phạm thứ 3 (153 µs) | Trùng lúc cách ly mã độc: tar 22 MB, xoá file, `daemon-reload` | Gợi ý nguyên nhân |
| 10:34–10:36 | Bẫy ftrace chỉ ghi CPU3 (`tracing_cpumask=8`, buffer 16 MB, 14 sự kiện sched/irq/ipi/workqueue/hrtimer/rcu) và script dừng trace khi `jitterViolationCount` tăng | Ghi 64 MB fsync ×2 ở CPU0–2: bộ đếm 3 → 7; `daemon-reload` ×3: 7 → 10. 6 trace lưu tại `/data/mkddc/f17-trap/` trên bo | Tái hiện được |
| 10:36 | Phân tích trace | Lần thức dậy trễ 109–163 µs: hrtimer hết hạn đúng giờ (trễ 10–18 µs), nhưng đoạn `sched_waking` → `sched_wakeup` của mkddc-core dài 57–81 µs (bình thường ~18 µs), CPU3 đang ở `swapper/3`, không có IRQ, softirq hay kworker chen vào. Cả 4 lõi chung policy `schedutil`, 17 086 185 lần đổi tần số từ lúc boot | Nguyên nhân: đổi tần số (F17) |
| 10:37–10:40 | A/B governor, cùng tải (ghi 64 MB fsync ×3 + `daemon-reload` ×3) | `schedutil`: +3 lần vượt, 3 455 lần đổi tần số. `performance`: +0 lần vượt, 0 lần đổi. Lượt đầu cũng vậy: `schedutil` +7, `performance` +0 | **Xác nhận** |
| 10:46 | Deploy core `ff2f92fe` + `rt-cpufreq` + unit | Sao lưu `…T1050Z-f17/`. Core `3ebd78c3…` khớp `/proc/MainPID/exe`, CPU3, `NRestarts=0`; log `rt-cpufreq: … governor=schedutil->performance`, `INFO rt.cpufreq_ok cpu=3 governor=performance cur_khz=1296000`. Active `4206243c…` giữ nguyên, RUNNING; safe-state khởi động 1,14 s như bình thường | PASS deploy |
| 10:47–10:48 | Tải lại sau deploy: ghi 64 MB fsync ×5 + `daemon-reload` ×5 | `jitterViolationCount` 0 → 0, 0 lần đổi tần số; CPU 48,4 °C | **PASS F17** |
| 10:46:27 → 2026-09-27 02:39:46Z | Soak 24 h lần 2 (core `ff2f92fe`) | Kết thúc sớm vì deploy F13/F18. 953 phút `core.jitter`: **0** lần vượt 100 µs, tối đa theo phút 72,94 µs, trung bình 10,93 µs; missed step 0, overrun 0, không dòng `base_step_missed`. Journal lưu tại `/data/mkddc/deploy-backups/20260927T023946Z-main-6471a34d/core-journal-soak2.txt` | C1–C4 PASS trong 15 h 53 phút, chưa đủ 24 h |
| 11:32–11:34 | Deploy web + FE từ `main@d2556be6` (PR #767/#768/#769), theo yêu cầu của chủ sở hữu | Bản trên bo trước đó do actor khác đặt lúc 06:50–06:59Z (web `98c2564b…`, commit `0b6257bc` không có trong repo). Chủ sở hữu xác nhận được ghi đè. Sao lưu `/opt/mkddc-web/{mkddc-web,dist,deploy-provenance.env}.bak-20260926T113255Z`. Web `85079a85…` (`git_commit=d2556be6…`) chạy ở `mkddc-web-pi`, `mkddc-reload-helper` và `mkddc-time-helper`, `NRestarts=0`. Tool ST cùng profile `1cb61fec…`; sim worker build từ main trùng sha bản trên bo (`51848d72…`), không thay. Health 6/6 `ok`, `role=admin`, `targetState=READY`, `taskPeriodsMs` đủ 8 chu kỳ, `programming.toolchain ok`. `index.html` và chunk `programming-1zpEMfV5.js` phục vụ qua HTTP trùng sha bản build `VITE_PROGRAMS_WORKSPACE_V2=1`. Active `4206243c…` giữ nguyên; C4 của Core giữ 0 qua lần restart web | PASS deploy |
| 11:43–11:59 | Đo trực tiếp Core → FC05 (G7) và hồi quy F06, được chủ sở hữu cho phép dùng bo | Chụp Active `4206243c…` và intent, Restore sang revision thử `cfe17ec5…` (FBD đảo DO2, ST đảo DO4, 1000 ms), đo, rồi Restore về đúng Active đã chụp. Làm 4 lượt, mỗi lượt Restore SUCCEEDED 0,6 s. Active cuối là `4206243c…`; intent hai Program thử trả về `false` như trước; bộ đếm C4 giữ 0 | PASS thủ tục |
| 11:52–11:59 | Chuỗi thời gian lệnh EXT, đo bằng ba mốc độc lập: `lastRunAtUtc` do Core báo (release), bộ lấy mẫu `ext_cmd_seq` đọc `plc_shm` mỗi 1 ms trên bo (`/root/f17/seqwatch`), và Frame Monitor (`start = at − elapsedUs`) | Release → Core tăng `ext_cmd_seq`: trung vị 1,5–1,7 ms. `ext_cmd_seq` → FC05 lên dây: trung vị 1,1–1,2 ms, tối đa 4,5 ms. Tổng Core → FC05 khoảng 3 ms khi bus rảnh, đạt cổng G7 (≤ 10 ms + thời gian bus bận). Trace báo trễ 200–820 ms, nhưng đó là do lỗi F18 | **PASS G7** trên target |
| 11:47–11:59 | Hồi quy F06: Disable hai Program thử | FC05 ghi `safe_value` = 0 lên coil 1/3 sau 69/169, 145/261 và 12/112 ms (3 lượt); log `modbus_master.ext_release_safe` cho DO2/DO4 | **PASS F06** |
| 12:00–12:05 | Tìm nguyên nhân F18 (Trace) | Trace 10 s trên các biến của Active #68, theo 4 cấu hình (1/2/4 biến, 10/20 ms): phần mẫu Core dừng ở 253–256 mẫu trong mọi trường hợp, tức trần theo SỐ phần tử, không theo kích thước hay thời gian. Khớp `MaxArrayElements: 256` của `coreipc` | Nguyên nhân xác nhận |
| 2026-09-27 02:39:46 | Deploy `main@6471a34d` (PR #771 F13, #772 F18, #773) | Sao lưu `/data/mkddc/deploy-backups/20260927T023946Z-main-6471a34d/`. Core `9befe395…`, iobus `e4953080…` (cùng mã G7, để provenance khớp main), web `c2344476…` (`git_commit=6471a34d…`), khớp `/proc/MainPID/exe`, `NRestarts=0`. FE và tool ST build từ main trùng sha bản đang chạy nên không thay. Log `rt.cpufreq_ok`, `rt.cpu_idle_ok`, base step 10 ms. Health 6/6, Active `4206243c…` RUNNING | PASS deploy |
| 2026-09-27 02:41:54–02:41:58 | F13 trên target (ADR-062 §8): Restore sang revision thử, rồi về Active `4206243c…` | Kích hoạt revision thử: `activate_intents received=2 enabled=0`. Trả về #68: `activate_intents received=1 enabled=1`. **Không có dòng `safe_state.enter` nào** trong cửa sổ, tức khoảng `no_ctrl` từ 70 ms xuống **0** | **PASS F13** |
| 2026-09-27 02:42–02:43 | F18 trên target: Trace 10 ms, 2 biến của #68, 60 s | **5 000 mẫu** trong 49,99 s, dừng `QUOTA_REACHED` đúng trần 10 000 ô; 4 999/4 999 khoảng cách = 10 ms (tối đa 10,1 ms); 0 mốc không tăng; `droppedSamples` 0. Trước bản vá: 1 319 mẫu, lẫn nguồn, mốc chạy lùi | **PASS F18** |
| 2026-09-27 03:03:07 | Deploy Core `main@38978b68` (PR #775, X19 + F05 khoá + F19) | Sao lưu `/data/mkddc/deploy-backups/20260927T030307Z-x19-38978b68/`. Core `c507f6dd…` khớp `/proc/MainPID/exe`, `NRestarts=0`; web, FE và iobus không đổi từ `6471a34d`. Luồng quét `mkddc-core` FIFO trên CPU3; `st-retain`, `prog-ipc`, `web-ipc` là SCHED_OTHER trên 0–2 (`rt.thread_off_scan_cpu` ×3, không WARN); `web_ipc.offloaded thread=web-ipc slots=64`. Active `4206243c…` giữ nguyên | PASS deploy |
| 2026-09-27 03:04–03:05 | X19 trên target: hai phút `core.step_wcet` / `core.jitter` | `ipc_us` 3 (trước 427–686), `publish_us` 54–65 (trước 289–531), `sched_us` 149–151, tổng 338–540 µs (trước 959–1 307; phút đầu gồm `io_us` 287 lúc khởi động). Lệch nhịp tối đa 40,91 / 45,54 µs, trung bình 10,13 µs, 0 vi phạm, 0 lỡ step, 0 overrun. F19: 0 dòng `client_connected`, `web_ipc.connections accepted=154 refused=0` mỗi phút | **PASS X19, PASS F19** |
| 2026-09-27 04:02:19 | Deploy Core `main@01fd8708` (PR #778 F21/F22, PR #779 F20) | Sao lưu `/usr/sbin/mkddc-core.prev-20260927T040219Z`. Core `296e077e…` (`git_commit=01fd8708…`, GLIBCXX_3.4.29) khớp `/proc/MainPID/exe`; web, FE và iobus không đổi. Log `rt.ok policy=SCHED_FIFO prio=80 mlock=1`, `rt.cpufreq_ok cpu=3 governor=performance`, `rt.cpu_idle_ok`, `rt.thread_off_scan_cpu` ×3. Safe-state khởi động 04:02:22 → 04:02:23 như bình thường; Active `4206243c…` RUNNING | PASS deploy |
| 2026-09-27 04:03:18–04:03:28 | Đổi gói #68 → #69 (`a9885879…`: cùng Program `5619efde…`, cùng 10 binding WRITE), do một phiên giao diện web trên máy dev niêm phong và Commission, không phải công cụ audit | Core: `programming.package_swap_withdraw reason=replace retired=1 released_ao=0 released_do=0 released_ext=0 handed_over=10`. Không có `safe_state.enter`, không có `ext_release_safe`; iobus tiếp tục `set_do` theo nhịp của Program. Lần `set_do` đầu sau boundary (+2 ms) là lần publish đầu của instance mới, mang giá trị khởi tạo của Program chứ không phải lần nhả | **PASS F20, ca điểm chung** |
| 2026-09-27 04:04:02–04:04:39 | Soak lần 3: `prepare`, rồi `start --outputs hold` | Xem mục "Soak lần 3 — lượt chạy trên bo" | Đang chạy |
| 2026-09-27 04:04:39.364 | F20: đổi gói #69 → revision thử 8 chu kỳ (không output), không tắt intent trước | Core: `released_do=2 released_ext=8 handed_over=0`, cùng scan có `ERROR safe_state.enter … no_ctrl=1`. iobus: `ext_release_safe` cho `CK50804-DO1…8` ở +1 ms, `set_do value=0x00` ở +2 ms. Frame Monitor: FC05 đầu tiên sau khi nhả bắt đầu ở +2,4 ms, đủ 8 coil ở +364 ms. API đọc lại 8 coil = 0 ở +879 ms (đích F06 ≤ 1,2 s) | **PASS F20** |
| 2026-09-27 04:14:45 | Chủ sở hữu chốt ngưỡng soak lần 3: mỗi lớp chu kỳ chạy ≥ 10 chu kỳ là đạt; `report` kèm journal | Cửa sổ 10 ph 08 s, base step 60 811/60 811 theo đồng hồ. C1–C4 PASS: overrun +0, `maxExecNs` 36 169 (ngân sách 1 999 µs), missed release Task/Program/base step +0, jitter violation +0, tối đa theo phút 52,34 µs, 0 khoảng hụt log. Số chu kỳ mỗi lớp: 60 811 / 12 162 / 6 081 / 1 216 / 608 / 121 / 60 / 12 (10 ms … 50 000 ms) | **PASS soak lần 3** |
| 2026-09-27 04:15:47 | `stop`: Restore về Active trước soak | Operation `3fca24f4…` SUCCEEDED; Active = #69 `a9885879…`, `safeState=false`, Program `5619efde…` RUNNING `CORE_LIVE`. Core: `activate_intents received=1 enabled=1`, `package_swap_withdraw reason=replace retired=0 …` cùng µs với `safe_state.exit`, không có `safe_state.enter`; iobus trả DO3/AO-03 ở +2 ms, Program lái lại DO1/DO2 và `CK50804-DO1…4` | **PASS F20 bước 7**, PASS trả trạng thái |
| 2026-09-27 04:16–04:40 | F23: trang Program của `SOAK-ADR061` hiện `5619efde…` (Program của AHU) là `RUNNING CORE_LIVE`; trong 11 phút soak, trang của AHU hiện 8 Program `SOAK_*` | Sửa web-api, test đỏ trên mã cũ, deploy web — xem hàng F23 | Đã sửa |
| 2026-09-27 04:27:27 | Deploy web `main@d7022923` (PR #781: F23) | Sao lưu `/opt/mkddc-web/mkddc-web.bak-20260927T042727Z`. `mkddc-web-pi`, `mkddc-reload-helper`, `mkddc-time-helper` cùng chạy `77145e8e…` (khớp `/proc/MainPID/exe`), `NRestarts=0`. Tool ST cùng profile `1cb61fec…` (`programming.toolchain ok`); Core, iobus, FE không đổi (`deploy-provenance.env` vẫn mô tả bản FE `6471a34d`). Health 6/6 `ok`, `targetState=READY`, Active #69 `HEALTHY` | PASS deploy |
| 2026-09-27 04:28 | F23 trên target | Trang Program của `SOAK-ADR061`: đúng 8 dòng intent của chính nó, không còn `5619efde…`. Trang của AHU: `5619efde…` `RUNNING CORE_LIVE`. Hai Program thử cũ của audit (`05041ab2…`, `5c8d53a7…`) chuyển từ `DISABLED LAST_KNOWN` sang `UNKNOWN UNAVAILABLE`: đây là thiết kế sẵn có (`MarkAllProgramRuntimeStatesUnknown` khi web khởi động), không phải F23 | **PASS F23** |

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
| X19 | BACnet, ext writes, web IPC, alarm, schedule đều chạy trong cùng step, trái yêu cầu "I/O mở rộng không tính vào chu kỳ". **2026-09-26 — đã làm trong mã, chờ deploy + đo target** (ADR-061 mục "4.10 bước 2 — As-Built"): IPC web (socket, parse/validate JSON, dựng JSON trả lời, AUDIT) và serialize `point_snapshot` chuyển sang luồng `web-ipc` SCHED_OTHER ngoài CPU3; luồng quét chỉ lấy lệnh đã validate qua hàng đợi SPSC 64 slot, áp tại ranh giới scan, điền kết quả POD và chép snapshot vào triple buffer. Ở lại luồng quét có lý do đo được: BACnet objtable (`plc_shm` một writer), alarm 3–19 µs, schedule/ext writes (quyết định đầu ra). Máy dev (`mkddc-core-scan-bench`, 4 × 3000 step, tải giống web-api): p99 `ipc` 142–183 → 1,0–1,2 µs, `publish` 83–86 → 26–28 µs, tổng 231–283 → 63–68 µs. Cổng target: `core.step_wcet` `ipc_us`/`publish_us` còn vài chục µs, `core.jitter` không xấu đi, `INFO rt.thread_off_scan_cpu name=web-ipc` và `ps -L -o psr` cho thấy `web-ipc` ở CPU0–2 | `scan_loop.cpp`, `web_ipc.cpp` |
| X20 | VS-PROG-009 đòi 10 000 cycle cho mỗi chu kỳ: riêng 50 000 ms ≈ 5,8 ngày | kế hoạch kiểm chứng |

**Trạng thái gap (cập nhật 2026-09-27):**

| Mã | Trạng thái | Cách đóng / lý do |
|---|---|---|
| X1 | Đóng | TTL theo instance = max(60 s, 2 × chu kỳ Program), ADR-061 4.4 (PR #756) |
| X2 | Đóng | Base step 10 ms là của nền tảng khi Programming bật; `graph.json scan_ms` không kéo base step (PR #756) |
| X3, X4, X5 | Đóng | Task `main` 10 ms, ngân sách µs (`budgetUs` 1999, luật `< 20%` loại trừ ở cả Go và Core); Check ước lượng kịch bản mọi Program cùng release (PR #756) |
| X6 | Đóng, không đổi hành vi | C2 là tiêu chí ĐO (overrun = 0 trong cửa sổ), còn FAULT ở overrun thứ ba là PHẢN ỨNG an toàn theo ADR-029. Hai điều không mâu thuẫn: mọi overrun đều tăng `overrunCount` và làm task health `DEGRADED` ngay (`task_health.go`, ADR-061 4.9), nên vi phạm C2 luôn hiện ra; FAULT sớm hơn ở overrun thứ nhất sẽ biến một lần trễ đơn lẻ thành mất điều khiển |
| X7, X8 | Đóng | `missedBaseStepCount`, `jitterMaxUs`, `jitterViolationCount` trong `point_snapshot`/API; `WARN core.base_step_missed` có nguyên nhân (PR #756, #764) |
| X9, X10, X11, X12 | Đóng | Freshness 10…150000 ms (store v16), Trace 10…50000 ms kèm chu kỳ hiệu lực, capabilities đọc từ profile, FE hiện ms (PR #756). Trace còn lỗi ở chu kỳ ngắn, đã sửa ở F18 (PR #772) |
| X13 | Đã giảm | Vòng mô phỏng có nhịp tối thiểu 20 ms, gộp bước, ghi SQLite tối đa 1 lần/giây (`c4b48809`). Khoảng 100 lời gọi Step/s tới worker cách ly trên CPU0–2, không chạm Core |
| X14, X15 | Đóng | RETAIN notify và `WATCHDOG=1` tối đa 1 lần/giây (PR #756) |
| X16, X17 | Đóng | Giữ `profileId`, re-pin; mã `ST-SCHED-001` (PR #756) |
| X18 | Đóng | Stale theo thời gian (PR #756) |
| X19 | **Đóng, PASS target** (PR #775, deploy 2026-09-27 03:03): `ipc_us` 427–686 → 3, `publish_us` 289–531 → 54–65, WCET tổng 959–1 307 → 338–540 µs; lệch nhịp tối đa theo phút 40,9–45,5 µs | Chủ sở hữu chốt "làm ngay". IPC web (socket, parse/validate, JSON trả lời, AUDIT) và serialize `point_snapshot` chuyển sang luồng `web-ipc` ngoài CPU3 (ADR-061 mục "4.10 bước 2 — As-Built"). BACnet publish và alarm ở lại luồng quét có lý do đo được: `plc_shm` một writer; alarm 3–19 µs. Cổng target ghi ở hàng X19 bản đồ gap phía trên |
| X20 | Đóng | `VS-PROG-009`: 10 000 chu kỳ cho chu kỳ ≤ 5 s, soak 24 h cho 10 s và 50 s (chủ sở hữu chốt 2026-09-27; **chốt lại cùng ngày sau soak lần 3: ≥ 10 chu kỳ mỗi lớp, `VVP-PROG-001` v2.4**; `VVP-PROG-001` v2.3, `DDD-CTRL-PROG-001` v1.2) |

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

## Soak lần 3 — revision thử 8 chu kỳ (ADR-061 C1–C4, `VS-PROG-009`)

Chủ sở hữu chốt ngày 2026-09-27: soak 24 h lần 3 chạy một revision thử có đúng 8 Program, mỗi Program một chu kỳ trong tập ADR-061. Revision này **thay Active hiện tại trong 24 h**, rồi trả về. Lý do: Active đang chạy chỉ phủ một chu kỳ, còn `VS-PROG-009` đòi đủ 8 lớp chu kỳ.

- Công cụ: `scripts/programming_soak_adr061.py` (Python 3, chỉ thư viện chuẩn).
- Test: `tests/integration/test_programming_soak_adr061.py`.
- Công cụ này không thay harness `scripts/target_soak_10program.py` (T59-702). Harness đó dựng cho tập chu kỳ cũ 1/5/30 s và kịch bản lỗi riêng.

### Revision thử

- **Project riêng `SOAK-ADR061`.** API cho phép tạo thêm Project. FE phân giải Project đang chạy theo `activeRevisionId`, không theo `items[0]`. Nhờ vậy Draft của Project đang dùng không bị đụng.
- **8 Program ST** `SOAK_P00010` … `SOAK_P50000`, chu kỳ 10, 50, 100, 500, 1000, 5000, 10000 và 50000 ms.
  - Thân mỗi Program chỉ có `cnt := cnt + 1;`, trong đó `cnt : DINT` là biến `VAR` cục bộ.
  - Không có `VAR_OUTPUT`, binding hay Published Signal. `prepare` dừng nếu Draft của Project thử có nội dung khác, và không tự xoá gì.
- **Trần profile:**
  - 8 lớp chu kỳ bằng `maxTasks` 8.
  - 8 Program nằm trong trần 16 bật đồng thời và 32 tổng.
  - Ngân sách theo ADR-061 4.3, kịch bản mọi Program cùng release (t = 50 s): (2000 − 1) / 8 = **249 µs** mỗi Program, tổng 1992 µs < 2000 µs.

### Hành vi đầu ra của bo trong 24 h

Giả định ban đầu là: revision không có output thì Core vào T7 `no_ctrl`, và mọi đầu ra về safe. Đọc mã và thử trên host cho thấy điều này **chỉ đúng khi Program của Active cũ được tắt trước**:

1. T7 (`SafeState::apply`) chỉ bật khi không nguồn nào ở mức 1–5 còn active trên AO/DO **cục bộ** và graph không được nạp. Revision thử không giữ mức 5 nào.
2. Core trước F20: đổi gói **không rút** mức 5 mà Program của gói cũ đã giữ. Đầu ra cục bộ vì vậy giữ giá trị cuối của Active cũ, không có TTL.
3. Core trước F20: EXT Modbus của Program bị bỏ khỏi gói cũng giữ giá trị cuối (phần "chưa thuộc phạm vi" cũ của F06).

Vì vậy `start` mặc định chạy `--outputs safe`. Trước khi Commission, lệnh này tắt intent của mọi Program đang chạy thuộc Active và chờ chúng về `DISABLED`, rồi mới đổi gói. Đường Disable đã đo trên target: mức 5 cục bộ được rút ngay tại safe boundary (TASK-PROG-401), còn EXT về `safe_value` (F06 PASS).

| Đầu ra | `--outputs safe` (mặc định) | `--outputs hold` |
|---|---|---|
| AO cục bộ | T7: 0 V, hoặc 4 mA ở mode 4–20 mA | Giữ giá trị cuối của Active cũ |
| DO cục bộ | T7: mở | Giữ giá trị cuối |
| AO/DO Modbus mà Program đã ghi | `safe_value` của điểm. Điểm không khai `safe_value` giữ giá trị cuối, kèm `WARN modbus_master.ext_release_hold` | Giữ giá trị cuối |
| Override thủ công/BMS (mức 1–4) | Vẫn thắng. Khi còn override thì T7 không bật, các kênh khác về default mức 6 | Như cũ |

Cột `hold` mô tả Core trước F20. Khi Core có F20 đã deploy, Core tự rút đầu ra của Active cũ tại boundary đổi gói (`PROGRAMMING_CONTROL_SEMANTICS` §6 v1.3), nên `hold` cho cùng kết quả đầu ra như cột `safe`. Khác biệt duy nhất: `hold` không tắt intent của Program thuộc Active cũ.

Hàng T7 của cột `safe` còn phụ thuộc F21: nếu `graph.json` được nạp, AO/DO cục bộ về default mức 6 thay vì giá trị safe. Với bo lab, trạng thái của cột `safe` là chấp nhận được theo quyết định của chủ sở hữu.

`start` chụp `GET /api/v1/points` (mọi AO, DO và điểm Modbus ghi được) ở ba lúc: trước khi đổi, sau khi tắt Program, và sau Commission. `report` in các điểm đổi giá trị, kèm `safeState`/`safeStateNoControllerOnly`. Nhờ vậy xác nhận được hành vi thật trên bo mà không cần SSH.

#### F20 — cách đo trên target

Chạy sau khi deploy Core có F20 (web và iobus không đổi). Mốc Core lấy từ journal, không lấy từ Trace.

1. **Chuẩn bị.** Active A có một Program bật intent, lái một DO cục bộ và một DO Modbus có `safe_value = 0`, ví dụ `CK50804-DO2`. Cả hai đang = 1. Chụp `GET /api/v1/points` và readback coil.
2. **Đổi gói không tắt intent trước.** Commission revision thử không có output: `programming_soak_adr061.py start --outputs hold`, hoặc Restore sang revision thử của lượt 4. Đây đúng là đường F20.
3. **Mức Core, ≤ 1 base step.** Journal phải có đúng một dòng `INFO programming.package_swap_withdraw reason=replace … released_do≥1 released_ext≥1 handed_over=0` tại scan kích hoạt. Ngay sau đó (cùng mốc ms, ≤ 10 ms) phải có `ERROR safe_state.enter … no_ctrl=1` nếu không còn nguồn mức 1–5 nào.
4. **Mức API.** DO cục bộ = 0 với `safeState=true`, `safeStateNoControllerOnly=true`; nếu còn override/lịch thì DO theo tầng đó.
5. **Mức dây.** iobus log `modbus_master.ext_release_safe` cho DO Modbus; FC05 ghi `safe_value` = 0. Đích đo theo lần hồi quy F06: ≤ 1,2 s tới coil, trung vị 1–2 ms từ release tới `ext_cmd_seq`. Readback coil = 0.
6. **Điểm chung.** Commission một revision thử mà Program (tên khác) lái đúng DO Modbus đó với cùng giá trị. Journal phải có `handed_over≥1`, không có `ext_release_safe` cho điểm đó, và không có lần ghi FC05 nào về 0 giữa hai gói.
7. **Trả về.** Restore về Active A: DO claim lại = 1 ngay scan kích hoạt, journal có `INFO safe_state.exit` cùng mốc ms với dòng `package_swap_withdraw`, và không có `safe_state.enter` mới (F13).

#### F20 — kết quả trên target (2026-09-27)

Chạy trên Core `main@01fd8708`. Mốc 0 là dòng `package_swap_withdraw` của Core. Chính lần `start --outputs hold` của soak lần 3 là bước 2. Ca điểm chung (bước 6) có sẵn nhờ lần Commission #69 của phiên giao diện 70 s trước đó: #69 lái đúng 10 điểm như #68.

| Bước | Kết quả trên target | Trạng thái |
|---|---|---|
| 1. Chuẩn bị | Active #69 (`a9885879…`), Program `5619efde…` RUNNING, binding WRITE tới `DO-01`, `DO-02`, `CK50804-DO1…8`. Ngay trước khi đổi gói, API đọc `CK50804-DO1…8` = 1 và `DO-01`/`DO-02` đang nhấp nháy | Đạt điều kiện |
| 3. Mức Core | 04:04:39.363673: đúng một dòng `reason=replace retired=1 released_ao=0 released_do=2 released_ext=8 handed_over=0 live_publishes=1`, cùng mốc µs với `safe_state.enter … no_ctrl=1` | **PASS** |
| 4. Mức API | `DO-01`, `DO-02`, `DO-03` = false; `AO-03` 4 → 0 (T7); `safeState=true`, `safeStateNoControllerOnly=true` | **PASS** |
| 5. Mức dây | `modbus_master.ext_release_safe … safe_value=0` cho 8 điểm ở +1 ms. Lần FC05 đầu sau khi nhả bắt đầu ở +2,4 ms, lần thứ 8 ở +364 ms (mỗi FC05 khoảng 29 ms). API đọc lại cả 8 coil = 0 ở +879 ms | **PASS** (≤ 1,2 s) |
| 6. Điểm chung | 04:03:28.743553, #68 → #69: `handed_over=10`, `released_*=0`. Không có `ext_release_safe` hay `safe_state.enter` | **PASS** |
| 7. Trả về | 04:15:47.593589, #69 trở lại: dòng `package_swap_withdraw` (gói thử không giữ claim nào nên `retired=0`) cùng µs với `safe_state.exit`; không có `safe_state.enter` mới. iobus `set_do`/`set_ao` ở +2 ms; Program lái lại DO và coil ngay sau đó | **PASS** |

Journal Core/iobus quanh hai mốc: `fixtures/2026-09-27-f20-target-journal.txt`. Mẫu `GET /points` (khoảng 100 ms, chỉ các lần đổi giá trị) và khung ghi của Frame Monitor trong ±2–3 s quanh mốc 0: `fixtures/2026-09-27-f20-target-observe.json`. Bước 7: `fixtures/2026-09-27-soak3-core-journal.txt`.

### Cách chạy

Chạy từ một máy có đường HTTP tới web-api của bo, sau khi bản cuối (sau X19) đã deploy. Chỉ bước lấy journal cần vào bo.

```bash
export MKDDC_WEB_URL=http://<bo>:8082 MKDDC_WEB_USER=<tài khoản engineer/admin>
read -rs MKDDC_WEB_PASSWORD && export MKDDC_WEB_PASSWORD
T="python3 scripts/programming_soak_adr061.py --state soak3-state.json --http-log soak3-http.jsonl"
$T prepare            # in REVISION_ID; không đổi runtime
$T start              # mặc định --outputs safe; in mốc startedAt
$T report             # bất kỳ lúc nào; không ghi gì lên bo
# sau ít nhất 500 s (lớp 50 000 ms cần 10 chu kỳ, VVP-PROG-001 v2.4), trên bo:
#   journalctl -u mkddc-core --utc -o short-iso-precise --since '<startedAt>' > core-journal-soak3.txt
$T report --journal-file core-journal-soak3.txt --json-out soak3-report.json
$T stop
```

- **`prepare`**: tạo hoặc dùng lại Project `SOAK-ADR061`, niêm phong và Check. Nếu Draft trùng một revision đã PASSED thì dùng lại revision đó, không niêm phong mới.
- **`start`**, theo thứ tự:
  1. Đọc trạng thái ngay trước khi đổi: Active, LKG, intent của Project sở hữu Active, bộ đếm Task và đầu ra. Ghi tất cả vào file state (ghi nguyên tử). Không ghim cứng ID nào (bài học lượt 3, 05:37).
  2. Ở chế độ `safe`: tắt intent các Program của Active.
  3. Ghi intent Enable cho 8 Program thử **trước** Commission, để ACTIVATE mang theo (ADR-062).
  4. Commission với `expectedActiveRevisionId` bằng Active vừa đọc. Khi Active thuộc Project khác, impact đọc từ `none`: đường HTTP cố ý trả 400 cho cặp khác Project (`ISS-PGUI-01`), còn đường Commission hạ về "thay mới toàn bộ" với cùng `impactRef`.
  5. Nếu Commission không SUCCEEDED: trả mọi intent đã sửa về như cũ.
- **`report`**: lấy hiệu bộ đếm tích luỹ của Core so với mốc `start`.
- **`stop`**:
  1. Đọc Active ngay trước khi trả. Nếu Active **không còn** là revision thử (có người khác đã đổi): dừng với mã thoát 3, không Restore và không đổi intent nào. Khi đã rõ ai giữ Active mới, `stop --intents-only` chỉ bật lại các intent mà `start` đã tắt.
  2. Nếu Active vẫn là revision thử: bật lại intent đã tắt. Intent nào có `generation` khác lần tắt (tức người khác đã ghi lại) thì bỏ qua.
  3. Restore về Active đã lưu, với `expectedActiveRevisionId` bằng revision thử. Chờ Program gốc về `RUNNING`.
  4. Trả intent 8 Program thử về như trước `start`.
  5. Nếu Restore bị từ chối vì bố cục slot Modbus đã đổi: đọc cảnh báo, rồi mới chạy lại với `--ack-modbus-slot-mismatch`. Xác nhận này được ghi audit.
- **Credential:** mật khẩu và token không vào file state, log HTTP hay output. Mỗi request mutation dùng một idempotency key UUIDv4 mới.
- **Lần `start` bị đứt giữa chừng:** lần chạy sau đọc lại operation Commission trước khi quyết định gì.

### Tiêu chí và cách đọc

| Mã | PASS khi (trên cả cửa sổ từ `start`) | Nguồn |
|---|---|---|
| C1 | `baseStepUs` = 10 000; `taskPeriodsMs` đúng 8 giá trị; mỗi Program báo đúng chu kỳ đã khai | `GET /programming/runtime`, `/capabilities`, `/projects/{id}/programs` |
| C2 | `overrunCount` +0 | Task `main` |
| C3 | Không tăng: `missedReleaseCount` của Task, `missedReleaseCount` của từng Program, `missedBaseStepCount`. Cả 8 Program `RUNNING` | Như trên |
| C4 | `jitterViolationCount` +0. Với journal: mọi phút `core.jitter max_us` ≤ 100, `violations` không tăng so với mốc `start`, 0 dòng `core.base_step_missed` | Runtime và journal |
| `VS-PROG-009` | Mỗi chu kỳ đạt ngưỡng và missed release +0 | Số base step Core đã chạy |

Ngưỡng `VS-PROG-009` (`VVP-PROG-001` v2.4, chủ sở hữu chốt lại 2026-09-27 sau lần chạy đầu trên bo): mỗi lớp **≥ 10 chu kỳ**, tức lớp 50 000 ms cần 500 s. Ngưỡng cũ của v2.3 (10 000 chu kỳ cho chu kỳ ≤ 5 s, 8 640 / 1 728 chu kỳ cho 10 s / 50 s trong soak 24 h) đã bỏ. Công cụ vẫn chạy được lâu hơn, và `report` vẫn bắt vi phạm C1–C4 trên cả cửa sổ.

API không công bố bộ đếm lần chạy riêng của từng Program. Số chu kỳ vì vậy tính bằng: `runCount` của Task (một lần mỗi base step) × 10 ms ÷ chu kỳ Program. Con số này chỉ có nghĩa khi missed release của chính Program đó bằng 0, nên `report` luôn xét hai điều kiện cùng nhau.

Kết luận của `report`:

- **`HỎNG`**: bộ đếm Core giảm (Core đã khởi động lại), hoặc Active bị đổi giữa chừng. Soak phải chạy lại từ `start`.
- **`ĐANG CHẠY`**: chưa có vi phạm nhưng chưa đủ điều kiện `ĐẠT`.
- **`ĐẠT`**: cửa sổ ≥ 500 s, C1–C4 PASS và cả 8 chu kỳ đạt ngưỡng (trước v2.4: cửa sổ ≥ 86 400 s).

### Soak lần 3 — lượt chạy trên bo (2026-09-27)

- **Bản chạy:** Core `main@01fd8708` (`296e077e…`, có F20, F21/F22 và X19), web `6471a34d` (`c2344476…`), iobus `e4953080…`.
- **`prepare`, 04:04:02:** Project `SOAK-ADR061` (`b8b12a50…`), revision `097e8a26…`, Check `fe81fea3…` PASSED sau 0,56 s. Ngân sách 249 µs/Program, tổng 1992 µs.
- **`start --outputs hold`, 04:04:39:** Commission `db0ffa79…` SUCCEEDED. Mốc Core `2026-09-27T04:04:39.923Z`; bộ đếm ban đầu `runCount=13756`, overrun, missed release, missed base step và jitter violation đều 0. Chọn `hold` vì Core đã có F20: đầu ra về cùng trạng thái như `safe`, còn lần đổi gói trở thành phép đo F20 (mục trên).
- **Active trước soak là #69 (`a9885879…`), không phải #68.** Lúc 04:03:18–04:03:28, một phiên giao diện web trên chính máy dev (cùng IP công cộng `1.53.70.62`) niêm phong và Commission #69. Lúc đó Core mới vừa lên. `start` đọc Active ngay trước khi đổi, nên `stop` sẽ trả về #69, không trả về #68.
- **Đầu ra trong lúc soak:** `DO-01`/`DO-02`/`DO-03` hở, `AO-03` = 0 (T7), `CK50804-DO1…8` = 0 (`safe_value`), `safeState=true` và chỉ do T7.
- **Report sau 2 ph 51 s:** C1–C4 PASS; base step 17 106/17 106 theo đồng hồ; tối đa theo phút 48,72 µs; 0 phút > 100 µs; lớp 10 ms đã đạt ngưỡng `VS-PROG-009`.
- **Ngưỡng đạt, chủ sở hữu chốt lại lúc 04:14Z:** mỗi lớp chu kỳ chạy ≥ 10 chu kỳ với C1–C4 PASS và missed release 0 là đủ. Ngưỡng này thay ngưỡng X20 (10 000 chu kỳ, soak 24 h cho 10 s/50 s) trong `VVP-PROG-001` v2.4 và `DDD-CTRL-PROG-001` v1.4. Job 24 h tách rời bị dừng tay.
- **Kết quả, `report --journal-file` lúc 04:14:45Z (cửa sổ 10 ph 08 s):** C1–C4 PASS. Base step 60 811/60 811 theo đồng hồ; overrun +0; `maxExecNs` 36 169; missed release Task, Program và base step đều +0; jitter violation +0; tối đa theo phút 52,34 µs; 0 dòng `base_step_missed`; 0 khoảng hụt log. Số chu kỳ: 10 ms 60 811; 50 ms 12 162; 100 ms 6 081; 500 ms 1 216; 1 000 ms 608; 5 000 ms 121; 10 000 ms 60; 50 000 ms 12. **Cả 8 lớp ≥ 10 chu kỳ: PASS.**
- **Giới hạn của bằng chứng:** số chu kỳ mỗi Program suy từ `runCount` của Task và chỉ hợp lệ vì missed release của từng Program bằng 0. Biến `cnt` là biến cục bộ không có binding, nên Trace và Monitor không đọc trực tiếp được. Độ bền dài hạn của C1–C4 lấy từ soak lần 2 (15 h 53 ph, một lớp chu kỳ, 0 vi phạm), không phải từ lượt này.
- **Trả về, 04:15:47Z:** `stop` Restore về #69 (`3fca24f4…` SUCCEEDED), `safeState=false`, Program `5619efde…` RUNNING. Đây cũng là bước 7 của F20.
- **Tệp:** `fixtures/2026-09-27-soak3-state.json`, `…-soak3-http.jsonl`, `…-soak3-report.{json,txt}`, `…-soak3-core-journal.txt`. Không file nào chứa mật khẩu hay token.

### Đã kiểm trên host (trước lượt chạy trên bo)

Stack host thật, không chạm bo: `mkddc-programming-core-sim`, `mkddc-web` và compiler/packager production, build từ `main@8353fdc1`.

- `prepare`: tạo Project, niêm phong, Check PASSED trong 0,51 s. Chạy lại thì dùng lại đúng revision đó.
- `start` (cả `safe` lẫn `hold`), rồi `report`, rồi `stop`: trả đúng Active gốc, Program gốc về `RUNNING`, 8 intent thử về `false`.
- `stop` khi một actor khác đã đổi Active: mã thoát 3, không Restore.
- `stop --intents-only` gỡ được một lần `start` dở dang.
- File state và log HTTP không chứa mật khẩu hay token.

Simulator chạy Task 1000 ms và không công bố `baseStepUs`, nên trên host C1/C3 báo FAIL. Đó là đúng thiết kế của phép kiểm, và **không** phải bằng chứng target.

## Giải pháp tối ưu để spec sản phẩm ghi "cycle 10 ms"

Nguyên tắc: làm như Siemens, **tách chu kỳ CPU khỏi thời gian cập nhật I/O truyền thông**. S7-1200 chạy cyclic interrupt 1–60 000 ms, còn PROFINET và các module Modbus có thời gian cập nhật riêng. Core không bao giờ chờ bus: đầu chu kỳ đọc process image, cuối chu kỳ ghi process image. iobus trao đổi với thiết bị mở rộng theo nhịp của bus và luôn phát giá trị mới nhất.

| Bước | Nội dung | Phụ thuộc | Cổng nghiệm thu |
|---|---|---|---|
| G1 | Sửa F01: neo release theo mốc lý thuyết; missed > 0 thì health DEGRADED | Không; cần làm ngay cả khi giữ 1 s | Test tiêm jitter; soak 1 h ở 1000 ms và 10 ms cho 0 missed |
| G2 | Nền thời gian thực: kernel PREEMPT_RT cho BSP RV1126B 6.1; `isolcpus=3 nohz_full=3 rcu_nocbs=3`; đẩy IRQ sang CPU0–2; ghim luồng quét Core vào CPU3 SCHED_FIFO 80; `mlockall`; governor `performance` cố định 1,296 GHz; giữ `/dev/cpu_dma_latency=0` | BSP Forlinx có bản RT hoặc vá được; driver RS-485/Ethernet chạy trên RT | `cyclictest` CPU3 10 ms, 24 h dưới `stress-ng`: tối đa ≤ 100 µs (mục tiêu thiết kế ≤ 50 µs) |
| G3 | Core base step 10 ms; đưa việc không cần RT ra khỏi luồng quét (IPC web, đọc socket ext của BACnet objtable, alarm/historian) và đặt ngân sách mỗi lần quét. **2026-09-26: phần tách việc không-RT đã làm trong mã** (X19 ở bản đồ gap); chờ deploy + đo target | G1, G2 | WCET từng bước quét; C2 = 0 overrun trong 24 h |
| G4 | Profile Rev B (ADR mới): `taskPeriodsMs=[10,50,100,500,1000,5000,10000,50000]`. Tập này tạo một chuỗi bội (mỗi chu kỳ chia hết chu kỳ kế, siêu chu kỳ 50 s). Ngân sách mỗi Task riêng (ví dụ Task 10 ms ≤ 2 ms); API/Check từ chối chu kỳ ngoài tập; profile id compiler mới; FE; đường chuyển Rev A → Rev B (30000 ms không còn trong tập) | G3 | C1: capabilities đúng; khai 5 ms và 30000 ms nhận 400 |
| G5 | Đo và cảnh báo: bộ đếm jitter > 100 µs, overrun, missed release lộ ra API/health/alarm; cổng audit đọc thẳng các bộ đếm này | G1 | Số đếm khớp với phép đo `cyclictest`/dấu thời gian |
| G6 | I/O cục bộ qua IOP/MCU trao đổi ở 10 ms. Hiện bo dùng Fake MCU nên **NOT RUN** | FW MCU thật | Đo điện (HIL) DO cục bộ đảo mỗi 10 ms: chu kỳ 10 ms ± 0,1 ms |
| G7 | Spec I/O mở rộng riêng: công thức và bảng ở mục "Tách lớp"; đánh thức luồng bus theo sự kiện khi `ext_cmd_seq` đổi (thay cho quét 100 ms + trần ngủ 200 ms); gộp FC15 theo module; ưu tiên ghi hơn đọc; nhóm poll readback nhanh cho actuator; nâng baud nếu thiết bị hỗ trợ; ghi rõ nguyên tắc "giá trị mới nhất". **2026-09-26: đã làm trong mã** phần đánh thức theo sự kiện, ưu tiên ghi có trần và giữ "giá trị mới nhất" (mục "G7 — đánh thức theo sự kiện"); chờ deploy + đo target. Chưa làm: gộp FC15, nhóm poll readback nhanh, nâng baud | Độc lập với G2–G4 | Core → FC05 ≤ t_tx + thời gian bus bận; readback theo nhịp nhóm poll |

Phương án dự phòng (không khuyến nghị): nếu không có kernel RT, chỉ ghi được "10 ms, jitter điển hình ≤ 25 µs, 99,7% ≤ 100 µs, tối đa đo được 470 µs". Cách ghi này **không đạt** C4 mà chủ sở hữu đã chốt.

Bản nháp câu chữ cho spec sản phẩm, chỉ dùng sau khi G1–G5 đạt cổng:

> Chu kỳ quét bộ điều khiển: 10 ms; chu kỳ của mỗi Program chọn trong {10, 50, 100, 500, 1000, 5000, 10000, 50000} ms (ADR-061); không overrun, không lỡ chu kỳ, lệch nhịp ≤ 100 µs. Thời gian cập nhật I/O mở rộng (Modbus RTU/TCP, BACnet) phụ thuộc giao thức và tốc độ truyền, xem bảng; không tính vào chu kỳ quét.

## Rủi ro và giới hạn đã xác nhận

1. Profile đang chạy chỉ cho Task/Program từ 1000 ms. Mốc "100 ms" trong tên FB `FB_DO_BLINK_100MS_V1` chỉ là chú thích nguồn; Program đó chạy mỗi 30 s.
2. Bốn slave chung một dây 9600 bps, sức chứa khoảng 34 giao dịch/s. Mọi cạnh logic nhanh hơn nhịp bus có thể bị gộp theo nguyên tắc "giá trị mới nhất" (`bus_worker.cpp` coalesce). Trong phép đo này, các cạnh bị mất là do F01 (logic không chạy), không do bus.
3. `MBA-FW-08` đã triển khai; fault injection mất/kết nối lại thiết bị thật chưa chạy.
4. Không có phép đo điện ở tiếp điểm relay, nên lớp vật lý NOT RUN và target không phải HIL.
5. `cyclictest` và `stress-ng` chạy trên bo lab đang vận hành, mỗi lượt 60 s; bus không phát sinh lỗi (0 timeout/CRC sau đo).

## Ma trận kiểm chứng

> Các dòng chức năng dưới đây là **snapshot lượt 1 (25/09)**, giữ nguyên để truy vết lỗi ban đầu; không phải trạng thái cuối sau F04/F05/F06/F08 và các lượt deploy sau đó. Đọc phần Finding và lượt 2–3 ở trên để biết diễn biến sửa/đo lại. Riêng dòng C1–C4 đã cập nhật tới soak lần 3 (ngưỡng `VS-PROG-009` của `VVP-PROG-001` v2.4); soak độ bền 24 h trên image tin cậy là phép thử riêng. Không được dùng bảng này để suy diễn HIL vật lý hoặc release PASS.

| Lớp / tính năng | Kết quả | Bằng chứng |
|---|---|---|
| FBD dùng Function Block: parse/compile/Check | **PASS target** | Revision `cfe17ec5…` Check PASSED 0,64 s, 0 diagnostic |
| ST dùng Function Block người dùng: parse/compile/Check | **PASS target** | Như trên; instance `Toggle : FB_AUDIT_TOGGLE` |
| Chẩn đoán Check | PASS | `ST-SEM-013` đúng dòng 9 cột 15 |
| Commission / Enable | PASS | Operation `1a8eeaf9…` 1,64 s; RUNNING `CORE_LIVE` |
| Monitor | PARTIAL | `actualValue` đúng; `programValue` null; trễ ~2 s |
| Trace | **PASS target** (2026-09-27, sau F18): 5 000 mẫu 10 ms đều, `droppedSamples` 0. Lịch sử: lượt 1 FAIL (F05), lượt 4 FAIL ở chu kỳ ngắn (F18) | F05 (envelope, lượt 2 PASS với 12 mẫu 1000 ms); F18 (hỏng sau 256 mẫu, trộn nguồn) |
| Disable | **PASS target** (sau F06) | Lượt 1: EXT giữ giá trị cuối (F06). Sau sửa: EXT về `safe_value` trong ≤ 1,2 s (lượt 2 và lượt 4) |
| Restore | **PASS target** (sau F04, F13) | Lượt 1 FAIL (F04). Sau sửa: Program về RUNNING theo intent (lượt 2); 2026-09-27 02:41 không còn khoảng `no_ctrl` (F13) |
| Đổi gói rút đầu ra của gói cũ | **PASS target** (F20, 2026-09-27) | 04:04:39: nhả 2 DO + 8 EXT tại boundary, coil về 0 trong 879 ms; 04:03:28: bàn giao 10 điểm chung, không nhả |
| Lệnh FC05 trên RS-485 | PASS lớp truyền | 234/234 ACK, 29,0 ms |
| Readback coil qua API | PASS | Trễ trung vị 712 ms |
| Cạnh vật lý | NOT RUN | Không có dụng cụ đo |
| Chu kỳ theo spec 10 ms (C1–C4) | **Soak lần 1 FAIL C4 (F17)**; soak lần 2 PASS 15 h 53 ph (dừng sớm để deploy); **soak lần 3 PASS** (8 lớp, ≥ 10 chu kỳ mỗi lớp) | Lượt 1: C1, C3, C4 FAIL. Lượt 3 (ADR-061 trên target): C1 PASS (Core, capabilities, từ chối 5/7/30000 ms), C2 PASS, C3 PASS trong 300 s; C4: sau F11 + F14 + F15 + F16, cửa sổ 600 s tính từ lúc khởi động, có tải và 2 lần restart web: **0/60 006 lần vượt**, tối đa theo phút 60–85 µs. Lượt 4: soak lần 1 có 2 lần vượt sau 3,5 h (129,6 µs) do đổi tần số CPU (F17); sau sửa, tải I/O + `daemon-reload` từng gây vượt cho +0. Soak lần 2 từ 2026-09-26 10:46:27Z tới 2026-09-27 02:39:46Z: 953 phút, 0 lần vượt, tối đa theo phút 72,94 µs. Soak lần 3 (8 chu kỳ, `VS-PROG-009` theo ngưỡng v2.4) 04:04:39Z → 04:15:47Z: C1–C4 PASS, lớp 50 s đạt 12 chu kỳ, tối đa theo phút 52,34 µs. Đây là bằng chứng hỗ trợ; Test Result độc lập vẫn chưa có |
| Service logs | PASS có ghi chú | 0 restart; 1 dòng WARN io_shm lúc 16:13:46 mà `-p warning` không bắt được (F08) |
| Hồi quy mã nguồn (phiên 15:19–15:54) | PASS host | C++ 1513/1513 (2 skipped); Go vet + toàn bộ Go test; FE Vitest 3439/3439, lint, build Foxlinx; ARM 3 binary |
| UI Programming qua trình duyệt | PASS target | Sau 2 lượt deploy FE (15:51, 15:54): Console 0, request 200 |
| Khôi phục sau thử nghiệm | PASS | Draft trùng canonical; DO, override, Active, service trùng trạng thái trước |

## Tệp bằng chứng

- `fixtures/2026-09-25-fbd-st-modbus-do-run-summary.json` — ID, kết quả Check/Commission/Restore, bộ đếm Core, dấu thời gian FC05 từng DO và các chu kỳ thiếu, tóm tắt `cyclictest`.
- `fixtures/audit-fb-toggle.st`, `fixtures/audit-st-do.st`, `fixtures/audit-fbd-do.fbd.json` — mã nguồn thử nghiệm đã Commission.
- Trace ftrace CPU3 của F17 (6 tệp, 1,5 MB) nằm trên bo tại `/data/mkddc/f17-trap/`; bẫy và script phân tích ở `/root/f17/` (`arm.sh`, `watch.sh`, `disarm.sh`). Bẫy đã tắt, ftrace đã trả về mặc định.
- `fixtures/foxlinx-active-do-blink-fbd.json`, `fixtures/foxlinx-active-fb-do-blink.st`, `fixtures/modbus-do-probe-st.st` — FBD/FB của Active #52 và mẫu ST host.
- `fixtures/2026-09-27-f20-target-journal.txt` — journal Core/iobus của hai lần đổi gói trên target (F20: bàn giao điểm chung 04:03:28, nhả tại boundary 04:04:39).
- `fixtures/2026-09-27-f20-target-observe.json` — mẫu `GET /points` và khung ghi Frame Monitor quanh boundary F20.
- `fixtures/2026-09-27-soak3-{state.json,http.jsonl,report.json,report.txt,core-journal.txt}` — file state, log HTTP, report và journal của soak lần 3 trên bo.
- `scripts/programming_soak_adr061.py`, `tests/integration/test_programming_soak_adr061.py` — công cụ và test của soak lần 3 (mục "Soak lần 3"). File state và log HTTP của lượt chạy trên bo lưu cùng hồ sơ khi có.

## Tài liệu liên quan

- `docs/07_records/reviews/MODBUS_AUDIT_2026-09-25_BOARD_OPERATION_REPORT.md`
- `docs/07_records/reviews/MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS.md`
- `docs/02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md`
- `docs/02_design/software/PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md` §4
- `docs/02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md` §6
