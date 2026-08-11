# ADR-028: Công thức watchdog Programming bám base step, không bám chu kỳ Task

- Date: 2026-08-10
- Owner: System Architect + Safety Reviewer (phê duyệt) · Core Lead + Ops (đề xuất)
- Status: **Accepted** — Product Owner/CTO + System Architect phê duyệt theo `AUTH-PROG-2026-08-11-03`; Safety review chuyển hậu kiểm, target evidence thuộc verification/release
- Đóng xung đột: `ARCH-CONF-PROG-003` tại [`ARCH-PROG-001`](../03_architecture/PROGRAMMING_ARCHITECTURE.md) §11
- Related: [`DDD-CTRL-PROG-001`](../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md) §3 ·
  [`OPS-PROG-001`](../06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md) ·
  [`OD-PROG-012`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) · [ADR-027](ADR-027-programming-bootstrap-va-quyen-so-huu-chu-ky-scan.md)

## Vấn đề (1 câu)

`WatchdogSec=6` đang được suy ra từ công thức “2 × chu kỳ scan lớn nhất + WCET +
biên 1 s” của một hồ sơ đã bị supersede, và nếu ai đó thay “chu kỳ scan” bằng
“chu kỳ Task 30 s” thì watchdog phải đặt `61 s` — tức là mất tác dụng bảo vệ.

## Bối cảnh As-Built

```text
platform/systemd/mkddc-core.service:20-33
  # WatchdogSec theo công thức PROGRAM_TASK_SCHEDULER_SPEC §9:
  #   >= 2 x (chu kỳ scan lớn nhất) + WCET đo trên target + biên hồi phục 1 s
  # ... chọn 6 s phủ trọn dải scan_ms hợp lệ.
  WatchdogSec=6
```

Ba vấn đề của trạng thái này:

1. Công thức trích từ `PROGRAM_TASK_SCHEDULER_SPEC` — hồ sơ đã có **thông báo
   supersede Target 2026-08-09** cho đúng phần multi-task và watchdog theo chu kỳ Task.
2. Số `6 s` được chọn cho dải `scan_ms` `500..2000` của graph. Khi Programming
   dispatch Task `30 s`, người đọc dễ hiểu nhầm “chu kỳ scan lớn nhất” là `30 s`.
3. Chính comment trong file đã ghi số đo là **tạm**: WCET đo trên board chạy
   `SCHED_OTHER` do drop-in `nofifo.conf`, không đại diện cấu hình production
   `SCHED_FIFO`.

## Quyết định

1. **Biến đầu vào của công thức là base step, không phải chu kỳ Task.** Công thức
   Rev A:

   ```text
   WatchdogSec >= 2 x base_step_max + WCET_base_step(p99.9, target, SCHED_FIFO)
                  + 1 s biên hồi phục
   ```

   `base_step_max` là trần dải base step ở [ADR-027](ADR-027-programming-bootstrap-va-quyen-so-huu-chu-ky-scan.md)
   (`2000 ms`), **không** phải `30 s`.
2. **Chu kỳ Task bị loại tường minh khỏi công thức.** Task `30 s` là cadence
   dispatch; base step vẫn kick watchdog mỗi step kể cả khi không Task nào đến hạn.
   Một Task đến hạn mà chạy quá `budget` là **fault của Task đó**
   ([ADR-029](ADR-029-programming-overrun-la-task-fault.md)), không được biểu
   hiện thành watchdog reset cả tiến trình.
3. **Watchdog kick sau khi base step hoàn tất**, đúng bước 9 của `ARCH-PROG-001` §5.
   Cấm kick từ timer độc lập hoặc từ luồng non-RT — làm vậy watchdog chỉ chứng minh
   tiến trình còn sống, không chứng minh vòng điều khiển còn chạy.
4. **`WatchdogSec=6` giữ nguyên giá trị nhưng đổi căn cứ**, và mang nhãn
   `TARGET-PENDING` cho tới khi có số đo `SCHED_FIFO` trên target. Comment trong
   `mkddc-core.service` phải trích ADR này thay vì hồ sơ đã supersede.
5. **Watchdog SOM không phải hàng rào an toàn đầu ra.** MCU tự ép AO/DO về safe
   sau `200 ms` mất poll, độc lập hoàn toàn với SOM — kéo dài `WatchdogSec` không
   làm chậm bảo vệ đầu ra. Điều này đã đúng trong As-Built và được giữ.

## Phương án bị loại

| Phương án | Vì sao loại |
|---|---|
| `WatchdogSec >= 2 × 30 s + …` | Watchdog `61 s` không còn phát hiện treo kịp; mọi giá trị thực tế của bảo vệ biến mất |
| Bỏ watchdog SOM vì đã có MCU safe-timeout | MCU bảo vệ **đầu ra**, không phát hiện core treo giữ nguyên giá trị cũ; hai lớp phục vụ hai mục đích |
| Kick watchdog từ luồng heartbeat riêng | Chứng minh sai thứ: tiến trình sống nhưng vòng điều khiển có thể đã đứng |

## Hệ quả

- `platform/systemd/mkddc-core.service` phải sửa comment và trích ADR-028 trong
  cùng commit mở `IMPLEMENT_READY[runtime]`.
- `OPS-PROG-001` thêm bước preflight: đọc `WatchdogSec` thực tế và đối chiếu công
  thức trước khi mở cửa sổ Commission.
- `NFR-REQ-PROG-103` chỉ đóng được bằng số đo `SCHED_FIFO` trên target, không dùng
  lại số đo `SCHED_OTHER` cũ.

## Điều kiện sau quyết định trước khi đóng lát cắt triển khai/release

| Điều kiện | Bằng chứng |
|---|---|
| `OD-PROG-012` (WCET/overrun budget) đã ký | decision record |
| WCET base step p99.9 đo trên target `SCHED_FIFO` | `VS-PROG-009` + `VS-PROG-012` Test Result |
| `10.000` chu kỳ mỗi period không watchdog reset | `VS-PROG-009` trên board |
| Drop-in `nofifo.conf` đã gỡ ở cấu hình đo | ảnh chụp cấu hình + `systemctl show` |

## Chữ ký

| Vai trò | Trạng thái | Ngày |
|---|---|---|
| System Architect | **ACCEPT — Phạm Đình Chương; ủy quyền điện tử `AUTH-PROG-2026-08-10-01`, Codex ghi biên bản** | 2026-08-10 |
| Safety Reviewer | **WAIVED FOR IMPLEMENTATION — review hậu kiểm** | 2026-08-11 |
| Core Lead + Ops | Đề xuất | 2026-08-10 |
