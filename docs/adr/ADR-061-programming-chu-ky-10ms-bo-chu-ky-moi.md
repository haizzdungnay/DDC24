# ADR-061 — Chu kỳ bộ điều khiển 10 ms, bộ chu kỳ Program {10…50000} ms, I/O mở rộng có spec riêng

**Trạng thái:** Accepted (mục 1–3 do chủ sở hữu chốt); mục 4 là quyết định kỹ thuật triển khai theo ủy quyền của chủ sở hữu ("triển khai với 2 subagent", 2026-09-26)  
**Ngày:** 2026-09-26  
**Người quyết định:** Phạm Đình Chương — Product Owner/CTO (phiên audit `EV-PROG-FBD-ST-MB-20260925`, 2026-09-25/26)  
**Supersede một phần:** `ADR-050` mục 3 (chu kỳ `1/5/30 s`), `ADR-051` mục "Cơ sở của con số" (chặn dưới `2×30 s`)  
**Nguồn:** `docs/07_records/test-evidence/programming/2026-09-25-fbd-st-modbus-do-audit.md` (tiêu chí C1–C4, finding F02/F03, bản đồ gap X1–X20)

## Bối cảnh

Hiện trạng đo được trên Foxlinx: Core có base step 1000 ms, profile chỉ nhận chu kỳ 1000/5000/30000 ms, kernel không phải RT, jitter đánh thức tối đa 470 µs ngay cả khi ghim lõi. Chủ sở hữu muốn spec sản phẩm ghi được "cycle 10 ms". So với đối thủ, con số này nhanh hơn các DDC BMS đã tra (Schneider 100 ms, Honeywell Spyder 500 ms, Niagara 1 s), nhưng vẫn chậm hơn PLC (S7-1200 1 ms, WAGO PFC200 2 ms).

## Quyết định

### 1. Tiêu chí chu kỳ bộ điều khiển (vi phạm = lỗi)

| Mã | Tiêu chí |
|---|---|
| C1 | Base step Core = **10 ms**. Tập chu kỳ Task/Program cho phép **đúng bằng** `{10, 50, 100, 500, 1000, 5000, 10000, 50000}` ms. API và Check từ chối mọi giá trị khác. |
| C2 | Overrun = 0: mỗi base step phải chạy xong trong ngân sách của nó. |
| C3 | Missed release = 0: mỗi Program chạy đúng một lần trong mỗi chu kỳ của nó. |
| C4 | Lệch nhịp đánh thức ≤ **100 µs** ở MỌI base step. |

Tập chu kỳ là một chuỗi bội: mỗi chu kỳ chia hết chu kỳ kế tiếp, siêu chu kỳ bằng 50 s.

### 2. I/O mở rộng không tính vào chu kỳ

Modbus RTU/TCP, BACnet và mọi thiết bị truyền thông mở rộng có spec riêng. Thời gian của chúng phụ thuộc chuẩn giao thức và tốc độ truyền:

`t_tx ≈ (N_req + N_resp) × bit/ký tự ÷ baud + 2 × t3.5 + t_slave`

Core không bao giờ chờ bus. Thiết bị mở rộng nhận **giá trị mới nhất** tại thời điểm phát lệnh; thay đổi nhanh hơn nhịp bus có thể bị gộp.

### 3. Chính sách EXT khi rút output

Như `PROGRAMMING_CONTROL_SEMANTICS` §6 (F06): instance đã publish bị rút thì thiết bị về `safe_value`.

### 4. Quyết định kỹ thuật triển khai

| # | Chủ đề | Quyết định | Lý do |
|---|---|---|---|
| 4.1 | profileId | Giữ `revA-1t-1-5-30` làm **định danh ổn định**. Nâng `version.minor`; sha profile đổi, nên phải re-pin mọi pin. | Đổi id sẽ làm FBD doc, manifest và Draft đã lưu bị từ chối (X16). Id là định danh, không phải mô tả |
| 4.2 | Task | `scheduler.maxTasks = 8`, bằng số lớp chu kỳ (generator bắt `maxTasks == len(allowedPeriodMs)`). Runtime vẫn là **một Task `main` chạy ở base step 10 ms**; mỗi Program release theo chu kỳ riêng (mô hình T59-402). | Không đổi mô hình lập lịch, chỉ đổi nhịp |
| 4.3 | Ngân sách | Ngân sách mỗi base step = **20% base step = 2000 µs**, tính bằng **µs** (`budgetUs`). Giữ `budgetMs` chỉ để tương thích đọc. Check ước lượng theo kịch bản xấu nhất: mọi Program release cùng một step. | X3/X4/X5: đơn vị ms không biểu diễn được 2 ms < 20% |
| 4.4 | Hold TTL | TTL của mỗi instance = **max(60 s, 2 × chu kỳ của Program)**. Program 50 000 ms có TTL 100 s, còn lại giữ 60 s như ADR-051. Bỏ `static_assert` toàn cục, thay bằng tính theo instance. | X1: giữ đúng tinh thần "≥ 2× chu kỳ" của ADR-051 |
| 4.5 | Freshness Published Signal | Dải `10…150000` ms, và Check thêm ràng buộc `freshness ≥ chu kỳ publisher`. Cần migration store mới vì migration cũ đã ghim sha. | X9 |
| 4.6 | Trace | `samplePeriodMs` từ `10…50000`; chu kỳ lấy mẫu hiệu lực = max(yêu cầu, base step) và được trả về trong view. | X10 |
| 4.7 | Stale I/O cục bộ | Ngưỡng stale và T3 tính theo **thời gian**: stale sau max(3 base step, 250 ms), T3 sau max(5 base step, 500 ms). | X18: 3 scan × 10 ms = 30 ms quá nhạy |
| 4.8 | Watchdog | Gửi `WATCHDOG=1` tối đa 1 lần/giây; `WatchdogSec` giữ 6 s. | X15 |
| 4.9 | Metric C4 | ScanLoop đếm và công bố qua `task` trong `point_snapshot` các khoá: `baseStepUs`, `jitterMaxUs` (cửa sổ 60 s gần nhất), `jitterViolationCount` (tích luỹ, lệch > 100 µs), `missedBaseStepCount` (tích luỹ, step bị trễ ≥ 1 base step), `budgetUs`. API `/programming/runtime` trả nguyên các khoá này. Vi phạm bất kỳ ⇒ task health `DEGRADED`. | X7/X8 |
| 4.10 | Việc không RT | Bước 1 giữ nguyên thứ tự step, đo WCET từng bước ở 10 ms. Bước 2 (sau khi có số đo) tách IPC web / BACnet objtable / alarm / historian ra khỏi luồng quét. **Bước 2 đã làm trong mã (2026-09-26)**: IPC web và serialize `point_snapshot` chạy trên luồng `web-ipc`; BACnet objtable, alarm và schedule ở lại luồng quét có lý do đo được. Chi tiết ở mục "4.10 bước 2 — As-Built" dưới đây. | X19: tối ưu phải dựa trên số đo |
| 4.11 | Nền RT | **Bị chặn** chờ BSP Forlinx OK1126B-S (kernel 6.1.141) để build PREEMPT_RT. Trong lúc chờ: `CPUAffinity=3` cho `mkddc-core`, các service khác ghim `0-2`, IRQ dời sang CPU0–2, và CPU3 có ràng buộc `pm_qos_resume_latency_us=20` (chỉ còn WFI, unit core đặt bằng root; Core log `ERROR rt.cpu_idle_exposed` khi thiếu). CPU3 **độc quyền** cho Core: `/etc/systemd/system.conf.d/mkddc-rt.conf` `CPUAffinity=0-2` (PID 1 và mọi tiến trình nó sinh); `/usr/libexec/mkddc/rt-housekeeping` (unit core `ExecStartPre`) đặt workqueue unbound `cpumask=7` và dời kthreadd cùng mọi kernel thread không gắn CPU (ví dụ luồng Wi-Fi) sang 0–2; Core log `WARN rt.housekeeping_on_scan_cpu` / `rt.workqueue_on_scan_cpu` / `rt.kthread_on_scan_cpu` khi thiếu. Cụm CPU chứa CPU3 giữ tần số cố định: `/usr/libexec/mkddc/rt-cpufreq hold 3` (unit core `ExecStartPre`) đặt governor `performance` cho policy cpufreq chứa CPU3, `release` (`ExecStopPost`) trả governor cũ; Core log `ERROR rt.cpufreq_scaling` khi tần số còn tự đổi (F17). Unit core **không** được có lệnh `Exec*` chạy song song với vòng quét (ví dụ `ExecStartPost`): các lệnh đó nhận `CPUAffinity=3` + SCHED_FIFO 80 của unit; pidfile do Core tự ghi. Mỗi base step bị lỡ log `WARN core.base_step_missed` có nguyên nhân. Đo lại C4. | F03: không có mã nguồn kernel trên máy dev. Đo 2026-09-26: không có ràng buộc QoS thì 13,07 % lần thức dậy lệch > 100 µs vì CPU3 vào `cpu-sleep` (exit latency 370 µs); có ràng buộc còn 0,15 %. Chỉ ghim service mkddc thì một lần restart dịch vụ làm trễ 2,3–3,8 ms (có lần 12 ms, lỡ một base step); CPU3 độc quyền còn 117–119 µs, cửa sổ 300 s tối đa 104–131 µs, 0,04 % lần vượt. Kernel thread không gắn CPU (luồng TX Wi-Fi) còn trên CPU3 thì dưới tải giao diện 0,73 % lần vượt (tối đa 215 µs); dời chúng thì 0 lần vượt trong hai cửa sổ 60 s (tối đa 61 / 85 µs). RV1126B có một policy cpufreq cho cả 4 lõi: `schedutil` đổi tần số khoảng 100 lần/giây theo tải ở CPU0–2, mỗi lần đổi làm vòng quét thức dậy trễ 109–163 µs dù CPU3 rảnh; A/B cùng tải I/O: `schedutil` +3/+7 lần vượt, `performance` +0/+0 (F17) |
| 4.12 | Mã lỗi C1 | Chu kỳ ngoài tập có mã chẩn đoán riêng, không dùng lại `ST-LIM-009`. | X17 |
| 4.13 | FE | Danh sách chu kỳ lấy từ capabilities, hiển thị ms khi < 1000 ms; không ép giá trị lạ về 1000. | X12 |
| 4.14 | Tương thích nâng cấp (chu kỳ cũ 30000 ms) | Core vẫn **nạp và chạy** artifact đã commission trước đây có chu kỳ thuộc tập cũ {1000, 5000, 30000}: 30000 là "legacy period", chạy đúng 30 s trên base 10 ms, có WARN khi activate. Restore về revision cũ đã PASSED không bị chặn. Check/API cho revision **mới** vẫn từ chối 30000 (`ST-SCHED-001`). FE hiện "30 s — không còn hợp lệ" thay vì ép giá trị. | Active #52 trên Foxlinx dùng 30000 ms. Từ chối nạp khi nâng cấp đồng nghĩa bộ điều khiển đang chạy mất chương trình, tức lỗi an toàn. C1 áp cho cấu hình mới; gói cũ migrate bằng Commission lại |

### 4.10 bước 2 — As-Built (X19, 2026-09-26)

**Số đo đầu vào** (Foxlinx, `core.step_wcet` mỗi phút, base step 10 ms): io 120–236 µs, ipc 427–686 µs, sched 213–394 µs, logic ~75 µs, alarm 3–19 µs, ext 2–17 µs, out 8–28 µs, publish 289–531 µs; tổng 959–1307 µs. Hai bước `ipc` và `publish` chiếm 55–60 % tổng, và phần lớn của chúng là việc không quyết định đầu ra: `accept`/`recv`/`send`, parse JSON (nlohmann), dựng chuỗi JSON trả lời, in AUDIT, serialize snapshot (khoảng 7 KB với 8 Program).

**Ranh giới.** Một việc ở lại luồng quét khi nó quyết định đầu ra, hoặc khi nó là writer của một vùng nhớ có đúng một writer. Mọi việc khác chuyển sang luồng `web-ipc`.

| Việc | Ở đâu | Lý do |
|---|---|---|
| Đọc `io_shm`, quality, đọc ext fieldbus | Luồng quét | Đầu vào của chu kỳ |
| Hết hạn override TTL + **áp lệnh web/BACnet đã validate** (resolver mức 2/3, `PointWriter` cho AV/BV/MSV/EXT) | Luồng quét, đầu bước IPC_DRAIN | Ngữ nghĩa ranh giới scan (COR-008): lệnh vào trọng tài trước mọi nguồn ghi khác của cùng scan, không bao giờ áp nửa chừng |
| ScheduleRuntime, graph, Program Runtime (ST), ext writes, resolve priority, safe-state, ghi output | Luồng quét | Quyết định đầu ra |
| AlarmRuntime `evaluate` + ack/suppress/return | Luồng quét | 3–19 µs (< 2 % ngân sách); trạng thái alarm do luồng quét sở hữu và được SIGHUP reload tại ranh giới scan. Dời đi phải chép bảng điểm mỗi scan và tạo writer thứ hai cho trạng thái alarm, tốn hơn chính việc được dời |
| Dựng `RuntimePointSnapshot` (struct cố định ~6 KB) | Luồng quét | Snapshot phải nhất quán với output của CÙNG scan (COR-HIST-001); chỉ luồng quét đọc được table/resolver/output của scan đó mà không cần chép thêm |
| Ghi BACnet objtable vào `plc_shm` | Luồng quét | `plc_shm` có seqlock MỘT writer (15 §6). Luồng quét đã ghi `ext[]` (`read_ext`, `PointWriter`, `apply_ext_writes`) trong cùng segment; thêm writer thứ hai thì hai `KX_WRITE_BEGIN` đan nhau làm reader (iobus BACnet/fieldbus) thấy `seq` chẵn giữa lúc đang ghi. Phần này chỉ là ~100 phép chép float, không phải nguồn của `publish` 289–531 µs |
| `accept`/`recv`/parse/validate JSON, cache chống lặp, trả `busy`/`id_conflict`/`bad_request` | Luồng `web-ipc` | Không quyết định đầu ra |
| Dựng JSON trả lời lệnh, in AUDIT (nội dung giữ nguyên), `send` | Luồng `web-ipc` | Không quyết định đầu ra; luồng quét chỉ điền kết quả dạng POD (loại kết quả, giá trị áp, tên nguồn thắng là chuỗi tĩnh, TTL còn lại) |
| Serialize `point_snapshot` ra JSON | Luồng `web-ipc`, khi có yêu cầu | Chỉ serialize lúc có người hỏi, không serialize mỗi scan cho không ai |
| Log mỗi kết nối `web_ipc.client_connected` | Bỏ; thay bằng một dòng tổng hợp mỗi 60 s (F19) | ~3 dòng/s lúc rảnh, ~50 dòng/s khi có Trace 10 ms, từng in từ luồng quét |
| Log hiếm của luồng quét (`hmi_override_expired`, `core.jitter`/`core.step_wcet` mỗi phút, `base_step_missed` tối đa 1/s) | Luồng quét | Tần suất đã bị chặn; không nằm trong WCET mỗi scan |

**Trao đổi giữa hai luồng** — không khoá, không cấp phát, không syscall ở phía luồng quét:

- Lệnh: 64 slot `WebCommandSlot` cấp phát sẵn trong `WebIpc` (bằng trần 64 lệnh/scan của 07 §8). Chỉ số slot đi qua hai hàng đợi SPSC `SpscRing<uint8_t, 64>`: `web-ipc` → quét (lệnh đã validate), quét → `web-ipc` (lệnh đã có kết quả). Ở mỗi thời điểm một slot thuộc đúng một luồng, nên chuỗi `user`/`alarmId` không bao giờ bị chép hay giải phóng trên luồng quét. Hết slot ⇒ `web-ipc` trả `rejected busy` NGAY, có AUDIT, và KHÔNG ghi vào cache chống lặp (gửi lại cùng id sau đó được xử lý).
- Luồng quét lấy MỌI lệnh đang chờ ở đầu bước IPC_DRAIN; lệnh tới sau điểm đó thuộc scan kế. Kết quả điền SAU resolve + safe-state của cùng scan, nên `applied_value`/`active_source` vẫn là giá trị thật (07 §8). Chuỗi `user` của override có TTL được gán vào `std::string` đã `reserve(48)` sẵn nên không cấp phát.
- Snapshot: `LatestValueBuffer<RuntimePointSnapshot>` (triple buffer). Luồng quét chép struct vào vùng ghi rồi công bố bằng MỘT `exchange`; `web-ipc` lấy bản mới nhất lúc có yêu cầu. Không rách, và luồng quét không bao giờ chờ.
- Luồng `web-ipc`: `pthread` stack 1 MiB (unit bật `mlockall(MCL_FUTURE)`, stack mặc định 8 MiB sẽ bị khoá trọn), `SCHED_OTHER`, tự `pthread_setaffinity_np` sang mọi CPU trừ CPU của vòng quét, log `INFO rt.thread_off_scan_cpu` hoặc `WARN rt.thread_on_scan_cpu` khi không rời được. `main` gọi `remember_scan_cpus()` trước khi tạo thread phụ; cùng chính sách áp cho `prog-ipc` và `st-retain` (trước đây chỉ hạ `SCHED_OTHER` nhưng vẫn chạy trên CPU3 mỗi lúc vòng quét ngủ). Đây là thread nội bộ, không phải lệnh `Exec*` của unit (F16 không áp).
- `web-ipc` ngủ trong `poll()` trên socket; khi còn lệnh chờ luồng quét hoặc còn byte chưa gửi thì thức mỗi 1 ms để trả lời ngay sau scan. Độ trễ trả lời lệnh ≤ 1 base step + 1 ms (07 §8 cho phép ≤ 2 chu kỳ); `point_snapshot` được trả ngay, không còn chờ tới scan kế.
- Không tạo được thread thì `WebIpc` log `ERROR web_ipc.service_thread_fail` và `ScanLoop` phục vụ IPC ngay trong step như trước, qua CÙNG đường mã (`service_intake`/`service_output`). Test cũ chạy đường inline này; test mới chạy đường có thread.

**`StValueTrace` (F05 còn mở).** Luồng IPC Programming (`start`/`stop`/`status`/`sample`) và luồng quét (`on_boundary`) trước đây chạm cùng dữ liệu không đồng bộ. Nay mọi trường có khoá quay ngắn; luồng quét chỉ `try_lock` và bỏ lượt khi khoá đang bị giữ (mẫu tới hạn lấy ở boundary kế với mốc thời gian thật, đếm `contended_boundary_count`), không bao giờ chờ. Tên → slot phân giải trên luồng quét ở boundary đầu tiên sau `start()`, vì chỉ luồng quét được đọc cấu trúc Program đang chạy. API đọc và layout ring giữ nguyên; `variable(i)` trả bản sao thay cho tham chiếu; `first_sequence()`/`next_sequence()` của F18 cũng lấy khoá. `TRACE_READ` (`program_ipc_server.cpp`) đọc trạng thái, số thứ tự và các mẫu trong MỘT lần giữ khoá (`StValueTrace::ConsistentRead`), chỉ chép mẫu ra rồi dựng JSON sau khi nhả khoá. Nếu đọc rời từng hàm, ring có thể dịch một mẫu giữa hai lời gọi và `firstSequence` sẽ lệch khỏi `samples[0]`.

**Đo.** `record_phase`/`core.step_wcet` giữ nguyên để so trước/sau trên target. Trên máy dev (x86, kernel không RT) dùng `mkddc-core-scan-bench`: 3000 step 10 ms mỗi lượt, bốn lượt (hai phiên đo, trước và sau khi gộp F13/F18) xen kẽ với binary gốc `origin/main`. Tải mô phỏng web-api: `point_snapshot` 20 lần/s, `write DO1` 5 lần/s, `alarm_list` 1 lần/s, 8 Program đang chạy.

| Bước | `origin/main` p50 / p99 (µs) | X19 có `web-ipc` p50 / p99 (µs) |
|---|---|---|
| ipc | 27,2–28,3 / 142,0–183,1 | 0,4–0,5 / 1,0–1,2 |
| publish | 38,2–40,7 / 82,9–85,8 | 16,7–17,0 / 26,3–27,6 |
| tổng | 95,7–103,5 / 231,1–283,4 | 37,5–38,3 / 63,0–67,8 |

Đường dự phòng inline (mã mới, không có thread) cho ipc p99 131,7–161,8 µs và publish p99 91,5–107,5 µs, ngang bản gốc: hai đường cùng một mã, chỉ khác luồng chạy. Giá trị max trên máy dev (vài ms) là do máy dev bị giành CPU, không dùng để kết luận. Đo riêng từng việc còn lại ở PUBLISH (`--micro`, cache nóng, 20 000 lần): dựng snapshot 2,84 µs, điền bảng Program 0,48 µs, công bố triple buffer 0,16 µs, BACnet objtable 0,38 µs. Serialize JSON (7230 byte, nay ở `web-ipc`) tốn 4,10 µs. Số trên target chưa đo, chờ deploy; cổng nghiệm thu ghi ở hồ sơ audit, hàng X19.

## Hệ quả

- Đổi hợp đồng: product profile, schema, OpenAPI (budgetUs, metric C4, trace, freshness), IPC schema, store migration mới. Re-pin G1 join, manifest store, FBD manifest, pgm02 workspace và error catalog **trong cùng một PR** với validator.
- Khoảng 43 file test ghim giá trị cũ phải sửa theo.
- Spec sản phẩm chỉ được ghi "cycle 10 ms" sau khi C1–C4 đạt soak 24 h trên target. C4 cần nền RT (4.11).
- ADR-050 mục 3 và ADR-051 mục "Cơ sở của con số" được supersede bởi mục 1 và 4.4 của ADR này.

## Rollback quyết định

Chỉ Product Owner supersede được ADR này. Nếu triển khai hỏng trên target, giữ Active/LKG đang chạy và sửa tiếp theo cùng tiêu chí; không được âm thầm thu hẹp C1–C4.
