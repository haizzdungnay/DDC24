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

## 3. ⚠️ Phát hiện chặn: target đang chạy KHÔNG có real-time

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

Kết hợp `ulimit -r`=0 kể cả với root và `sched_rt_runtime_us`=950000 ở mức
toàn cục, nguyên nhân nhiều khả năng là **`CONFIG_RT_GROUP_SCHED` bật và cgroup
của service chưa được cấp `rt_runtime`** — không phải "kernel không hỗ trợ RT"
như comment trong drop-in ghi.

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

| # | Việc | Ai |
|---|---|---|
| 1 | Xác định vì sao userspace không đặt được `SCHED_FIFO` (kiểm `CONFIG_RT_GROUP_SCHED`, cấp `rt_runtime` cho cgroup service, hoặc dùng kernel không bật RT group sched) | Platform/BSP |
| 2 | Gỡ drop-in `nofifo.conf` sau khi (1) xong | Platform |
| 3 | Đo lại jitter/WCET với `SCHED_FIFO 80` thật, dưới tải | QA |
| 4 | Chốt lại `WatchdogSec` từ số đo mới | SOM Backend Lead |
| 5 | Chạy lại T1–T4 trên cấu hình có RT | QA |
