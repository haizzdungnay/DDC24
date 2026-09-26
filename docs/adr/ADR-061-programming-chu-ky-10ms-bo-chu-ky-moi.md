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
| 4.10 | Việc không RT | Bước 1 giữ nguyên thứ tự step, đo WCET từng bước ở 10 ms. Bước 2 (sau khi có số đo) tách IPC web / BACnet objtable / alarm / historian ra khỏi luồng quét. | X19: tối ưu phải dựa trên số đo |
| 4.11 | Nền RT | **Bị chặn** chờ BSP Forlinx OK1126B-S (kernel 6.1.141) để build PREEMPT_RT. Trong lúc chờ: `CPUAffinity=3` cho `mkddc-core`, các service khác ghim `0-2`, IRQ dời sang CPU0–2, và CPU3 có ràng buộc `pm_qos_resume_latency_us=20` (chỉ còn WFI, unit core đặt bằng root; Core log `ERROR rt.cpu_idle_exposed` khi thiếu). CPU3 **độc quyền** cho Core: `/etc/systemd/system.conf.d/mkddc-rt.conf` `CPUAffinity=0-2` (PID 1 và mọi tiến trình nó sinh), workqueue unbound `cpumask=7` (unit core); Core log `WARN rt.housekeeping_on_scan_cpu` / `rt.workqueue_on_scan_cpu` khi thiếu; đo lại C4. | F03: không có mã nguồn kernel trên máy dev. Đo 2026-09-26: không có ràng buộc QoS thì 13,07 % lần thức dậy lệch > 100 µs vì CPU3 vào `cpu-sleep` (exit latency 370 µs); có ràng buộc còn 0,15 %. Chỉ ghim service mkddc thì một lần restart dịch vụ làm trễ 2,3–3,8 ms (có lần 12 ms, lỡ một base step); CPU3 độc quyền còn 117–119 µs, cửa sổ 300 s tối đa 104–131 µs, 0,04 % lần vượt |
| 4.12 | Mã lỗi C1 | Chu kỳ ngoài tập có mã chẩn đoán riêng, không dùng lại `ST-LIM-009`. | X17 |
| 4.13 | FE | Danh sách chu kỳ lấy từ capabilities, hiển thị ms khi < 1000 ms; không ép giá trị lạ về 1000. | X12 |
| 4.14 | Tương thích nâng cấp (chu kỳ cũ 30000 ms) | Core vẫn **nạp và chạy** artifact đã commission trước đây có chu kỳ thuộc tập cũ {1000, 5000, 30000}: 30000 là "legacy period", chạy đúng 30 s trên base 10 ms, có WARN khi activate. Restore về revision cũ đã PASSED không bị chặn. Check/API cho revision **mới** vẫn từ chối 30000 (`ST-SCHED-001`). FE hiện "30 s — không còn hợp lệ" thay vì ép giá trị. | Active #52 trên Foxlinx dùng 30000 ms. Từ chối nạp khi nâng cấp đồng nghĩa bộ điều khiển đang chạy mất chương trình, tức lỗi an toàn. C1 áp cho cấu hình mới; gói cũ migrate bằng Commission lại |

## Hệ quả

- Đổi hợp đồng: product profile, schema, OpenAPI (budgetUs, metric C4, trace, freshness), IPC schema, store migration mới. Re-pin G1 join, manifest store, FBD manifest, pgm02 workspace và error catalog **trong cùng một PR** với validator.
- Khoảng 43 file test ghim giá trị cũ phải sửa theo.
- Spec sản phẩm chỉ được ghi "cycle 10 ms" sau khi C1–C4 đạt soak 24 h trên target. C4 cần nền RT (4.11).
- ADR-050 mục 3 và ADR-051 mục "Cơ sở của con số" được supersede bởi mục 1 và 4.4 của ADR này.

## Rollback quyết định

Chỉ Product Owner supersede được ADR này. Nếu triển khai hỏng trên target, giữ Active/LKG đang chạy và sửa tiếp theo cùng tiêu chí; không được âm thầm thu hẹp C1–C4.
