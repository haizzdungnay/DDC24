# Evidence — Watchdog trên target SOM (ACTION 8 / WATCHDOG_GATE)

**Ngày:** 2026-07-28
**Target:** Orange Pi 5B, `Linux 6.1.43-rockchip-rk3588 aarch64`, 8 core, 8 GB RAM
**Binary:** `/usr/sbin/mkddc-core` (md5 `f69aab790f1be32fb8509ec18a5de92a`, deploy 2026-07-23)
**Cấu hình:** `scan_ms=1000` (theo `graph.json`), `WatchdogSec=3` tại thời điểm đo

---

## 1. Kết quả test hành vi

| # | Kịch bản | Cách tạo | Kết quả | Đạt |
|---|---|---|---|---|
| T1 | Scan **treo** | `kill -STOP` process (mô phỏng `step()` không trả về) | systemd phát hiện và restart sau **6 s** | ✅ |
| T2 | Core bị **kill** | `systemctl kill -s SIGKILL` | Khởi động lại và `active` sau **2 672 ms** | ✅ |
| T3 | Khôi phục sau restart | Đọc journal | `core.start` → `core.scan_ms=1000` → `core.ready first scan done` | ✅ |
| T4 | Chạy bình thường **không** bị restart oan | 45 s vận hành liên tục | `NRestarts` không đổi (2 → 2) | ✅ |

`kill -STOP` là cách mô phỏng "scan treo" mà không phải sửa binary: process còn
sống với systemd nhưng không thể gửi `WATCHDOG=1` — đúng tình huống mà watchdog
sinh ra để bắt.

## 2. Jitter và WCET

Chu kỳ scan 1 s, đo qua log `core.jitter` (12 mẫu liên tiếp, mỗi mẫu 60 chu kỳ):

| Chỉ số | Giá trị |
|---|---|
| jitter min | 36.57 – 77.12 µs |
| jitter max | **284.26 – 355.87 µs** |
| jitter trung bình | 135.88 – 168.48 µs |
| overrun | **0** trên toàn bộ mẫu |

`overruns=0` với budget = period = 1000 ms nghĩa là thời gian thực thi mỗi chu
kỳ nhỏ hơn 1 s — đây là chặn trên yếu; thời gian thực thi trực tiếp chưa được
log riêng.

## 2b. Đọc đúng bộ đếm overrun — đính chính

Log `iobus.jitter`/`core.jitter` có hai con số dễ đọc nhầm:

- `count=` là **số mẫu trong cửa sổ 60 s**;
- `overruns=` là bộ đếm **tích luỹ từ lúc process khởi động**, KHÔNG phải trong cửa sổ.

Lấy `overruns` chia cho `count` cho ra con số vô nghĩa (bản nháp đầu của tài
liệu này từng ghi nhầm "76% overrun" theo cách đó). Số đúng cho `mkddc-iobus`:

| Đại lượng | Giá trị |
|---|---|
| uptime | 504 746 s ≈ 5.8 ngày |
| tổng poll ước tính (500 Hz) | ~252 373 000 |
| `overruns` tích luỹ | 22 706 |
| **tỉ lệ overrun** | **0.009%** |
| tăng trong ~3 phút | 22 701 → 22 706 = **+5** / ~90 000 poll = 0.006% |

`avg_us = 70` trên chu kỳ 2 ms. `max_us` 1 979–3 792 µs là **đỉnh hiếm**, không
phải trạng thái thường xuyên.

**Kết luận:** cả `mkddc-core` lẫn `mkddc-iobus` đều KHÔNG gặp sự cố vận hành do
thiếu RT. Điều này làm nhẹ hậu quả của phát hiện §3 nhưng không làm nó biến mất.

## 3. ⚠️ Phát hiện: target đang chạy KHÔNG có real-time

`mkddc-core` trên board chạy **`SCHED_OTHER` priority 0**, không phải
`SCHED_FIFO 80` như `mkddc-core.service` quy định.

**Nguyên nhân:** drop-in `/etc/systemd/system/mkddc-core.service.d/nofifo.conf`
ghi đè `CPUSchedulingPolicy=other`, `LimitRTPRIO=0`, `AmbientCapabilities=`
(bản trong repo còn thêm `CapabilityBoundingSet=~CAP_SYS_NICE`).

**Tiền đề của drop-in đã được kiểm chứng và ĐÚNG:** userspace không thể đặt
`SCHED_FIFO` trên board này, kể cả với quyền root —

```
$ sudo -n id                                    → uid=0(root)
$ sudo -n bash -c 'ulimit -r; chrt -f 80 /bin/true'
0
chrt: failed to set pid 0's policy: Operation not permitted
$ sudo -n systemd-run --property=CPUSchedulingPolicy=fifo ... 
Main processes terminated with: code=exited/status=214   # EXIT_SETSCHEDULER
```

Nhưng kernel **có** hỗ trợ `SCHED_FIFO` — kernel thread chạy `FF 99`:

```
$ ps -eo pid,cls,rtprio,comm --sort=-rtprio | head -3
     15  FF     99 migration/0
     18  FF     99 migration/1
```

**Nguyên nhân gốc đã xác định chắc chắn** (không còn là giả thuyết):

```
CONFIG_RT_GROUP_SCHED=y
CONFIG_PREEMPT_VOLUNTARY=y          # CONFIG_PREEMPT không bật
/sys/fs/cgroup            → cgroup2fs        (cgroup v2)
cpu.rt_runtime_us         → KHÔNG TỒN TẠI
mkddc-core cgroup         → /system.slice/mkddc-core.service
Max realtime priority     → 0
systemd 252
```

`CONFIG_RT_GROUP_SCHED=y` **cộng** cgroup v2 là bất tương thích đã biết: cgroup
v2 không implement RT group scheduling nên không có interface `cpu.rt_runtime_us`,
và **mọi process trong cgroup không phải root đều không thể dùng `SCHED_FIFO`**.
systemd đặt mỗi service vào cgroup riêng, nên **không service nào trên board này
dùng được RT** — không riêng `mkddc-core`. Debian/Ubuntu ship `RT_GROUP_SCHED=n`
chính vì lý do này.

Do đó comment trong drop-in ("Orange Pi kernel không hỗ trợ RT priority cao")
**sai về nguyên nhân**: kernel có hỗ trợ (kernel thread chạy `FF 99`), vấn đề
nằm ở cấu hình group scheduling.

`nofifo.conf` chỉ là **hệ quả**, không phải nguyên nhân — gỡ nó cũng không có
tác dụng cho tới khi sửa cgroup. Bằng chứng: `mkddc-iobus` **không có** drop-in
nào (`Max realtime priority = 80`) nhưng vẫn chạy `SCHED_OTHER`, vì nó *thử* và
*thất bại* vì cùng lý do.

**Cơ chế cảnh báo hoạt động đúng** — `mkddc-core` có log degraded khi khởi động:

```
WARN  rt.sched_fifo_fail prio=80 (degraded)
```

Vấn đề là cảnh báo này cuộn khỏi journal và không ai để ý. Đây đúng là rủi ro
`VG-05` đã nêu trong `FW_SOM_SOURCE_SPEC_STATUS_REVIEW.md` §8.5, nay xác nhận
là suy giảm **đang xảy ra thật**, không phải giả định.

## 4. Hệ quả với `WatchdogSec`

Công thức `PROGRAM_TASK_SCHEDULER_SPEC` §9:

```
WatchdogSec >= 2 × (chu kỳ scan lớn nhất) + WCET đo trên target + biên hồi phục 1 s
```

`graph.json` cho phép `scan_ms` ∈ [500, 2000] ms, nên trường hợp xấu nhất là
`2 × 2000 + WCET + 1000`. Chọn **`WatchdogSec=6`** (trước là 3) để phủ trọn dải
`scan_ms` hợp lệ — với `scan_ms=2000` thì giá trị cũ chỉ còn 1 s biên.

**Giá trị 6 s là TẠM.** Số đo ở §2 lấy trên hệ **không có RT**, nên không đại
diện cho cấu hình production. Phải đo lại sau khi RT hoạt động trên target.

Kéo dài `WatchdogSec` **không** làm chậm bảo vệ đầu ra: MCU tự ép AO/DO về an
toàn sau `IOP_SAFE_TIMEOUT_MS` = 200 ms khi mất poll, độc lập hoàn toàn với SOM.
T2 đo downtime 2 672 ms — trong khoảng đó đầu ra do MCU giữ an toàn.

## 5. Việc phải làm để đóng hẳn `WATCHDOG_GATE`

**Quyết định 2026-07-28:** rebuild kernel với `CONFIG_RT_GROUP_SCHED=n`.

Lý do chọn phương án này thay vì hai phương án còn lại:

| Phương án | Vì sao không chọn |
|---|---|
| Boot `systemd.unified_cgroup_hierarchy=0` (cgroup v1) | Rẻ hơn nhưng cgroup v1 đã deprecated, và vẫn phải cấp `rt_runtime` cho từng slice — nợ kỹ thuật dài hạn |
| Bỏ RT, đổi claim trong SPEC | Số liệu ủng hộ cho `mkddc-core` ở `scan_ms` ≥ 500 ms, nhưng bỏ biên an toàn dưới tải và mâu thuẫn với thiết kế đã duyệt |

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| 1 | Rebuild kernel rk3588 với `CONFIG_RT_GROUP_SCHED=n`, dựng lại ảnh production | Platform/BSP | Cân nhắc bật luôn `CONFIG_PREEMPT` — kernel hiện là `PREEMPT_VOLUNTARY`, worst-case latency kém kể cả khi có RT |
| 2 | Gỡ drop-in `nofifo.conf` sau khi (1) xong | Platform | Gỡ trước (1) không có tác dụng |
| 3 | Xác nhận `chrt -p $(pidof mkddc-core)` cho `SCHED_FIFO 80` và journal không có `rt.sched_fifo_fail` | QA | Đây là nội dung của `V-05` |
| 4 | Đo lại jitter/WCET với RT thật, **dưới tải** | QA | `V-04` |
| 5 | Chốt lại `WatchdogSec` từ số đo mới | SOM Backend Lead | Thay giá trị tạm 6 s |
| 6 | Chạy lại T1–T4 trên cấu hình có RT | QA | |

**Mức ưu tiên:** theo lịch BSP bình thường, **không phải việc gấp**. Ở §2b đã
xác nhận không thành phần nào đang gặp sự cố vận hành vì thiếu RT.

**Đề nghị bổ sung (chống tái diễn):** cảnh báo `rt.sched_fifo_fail` hiện chỉ log
một lần lúc khởi động rồi cuộn khỏi journal. Nên đưa trạng thái RT vào metric mà
Web/BE đọc được, để suy giảm này hiện ra trên dashboard thay vì nằm im trong log.
