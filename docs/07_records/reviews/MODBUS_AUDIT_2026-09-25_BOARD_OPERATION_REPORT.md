# Hoạt động Modbus RTU trên bo Forlinx — log, số đo và kiểm chứng sau deploy

**ID:** REC-MBA-BOARD-001
**Phiên bản:** 1.0
**Trạng thái:** Record (TARGET/runtime trên bo lab — **không** phải physical HIL, **không** phải `RELEASE_READY`)
**Ngày đo:** 2026-09-25 11:27–12:30 UTC
**Bo:** `OK1126B-buildroot` (Forlinx OK1126B-S / RV1126B, 4 × Cortex-A53, Linux 6.1.141 aarch64, Buildroot), truy cập `mekong-fac.ddns.net:2223`
**Bộ hồ sơ audit:** [Hiện trạng mã nguồn](MODBUS_AUDIT_2026-09-25_SOURCE_STATUS.md) · báo cáo này · [Finding, gap và phương án](MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS.md)

> Mọi thao tác trên bo trong phiên là **chỉ đọc**, trừ: deploy 3 binary (có sao lưu),
> một lệnh ghi **cùng giá trị đang có** vào relay `CK50804-DO1` (không đổi trạng thái vật
> lý) rồi nhả quyền, và dọn file tạm trong `/tmp`. Không đổi `fieldbus.conf`.

---

## 1. Tóm tắt

- **Bus đang chạy tốt ở tầng dây.** 4/4 thiết bị (CK-508 ×2, CK-509 ×2) online trên
  `rs485-1` (9600 8N1). 96.978 lượt poll/thiết bị trong ~27 giờ, tỉ lệ lượt poll lỗi
  **0,013 %**, UART chỉ **2 lỗi framing** trên ~8,6 MB lưu lượng, latency giao dịch
  p50/p95 = **26/27 ms**, dây bận **15,9 %**.
- **Lỗi nằm ở phần mềm, không ở dây**, gồm cả phần đường ghi lẫn phần quan sát:
  1. **Bão ghi lại:** 4 lần boot trước (18–24/09) có **309.672** dòng `write_fail` và
     **128.586** lệnh bị bỏ. Đó là lệnh cũ bị tạo lại vô hạn khi thiết bị chưa trả lời.
     Lần boot 24/09 có **171** sự kiện ghi dồn trong 3 phút đầu, do setpoint cũ bị phát lại khi iobus khởi động.
  2. **Bộ đếm lỗi ghi bị giấu:** SHM ghi `write_failed=41`, `write_dropped=12`, nhưng
     API báo `0/0`.
  3. **Không ghi được Point Modbus từ trang điểm chung:** `PUT /api/v1/points/CK50804-DO1` trả **409**.
  4. **Modbus đang chạy SCHED_FIFO:** cả 5 thread iobus đều FIFO 70, cùng mức với vòng IOP 2 ms.
     Hai thread phụ của core (IPC Programming, RETAIN) ở FIFO 80, tức cao hơn vòng IOP.
- **Cổng thứ hai (`rs485-2 → ttyS1`) không tồn tại trên bo** (`/dev/ttyS1` không có).
- Sau deploy bản sửa, đã kiểm chứng trên bo (§6) phần phát lại khi khởi động
  (`MBA-FW-02`), bộ đếm lỗi ghi (`MBA-BE-01`), ghi Point Modbus từ trang điểm chung
  (`MBA-BE-02`) và lập lịch thread (`MBA-FW-01`). Vòng tạo lại lệnh sau khi bỏ
  (`MBA-FW-08`) cần chọn phương án. Phép A/B jitter IOP **chưa kết luận được** vì có
  người dùng UI vào đúng khung đo.

## 2. Môi trường

| Hạng mục | Giá trị |
|---|---|
| Uptime lúc đo | 1 ngày 2 giờ 50 phút (boot 2026-09-24 08:36:17 UTC) |
| Service | `mkddc-iobus` (PID 780), `mkddc-core` (854), `mkddc-web-pi` (47143, deploy lại 08:28 bởi phiên khác), `mkddc-fakemcu`; `NRestarts=0` |
| Binary trước deploy | iobus/core commit `152411fb` (build 2026-09-13), sha256 `730cbb75…` / `93a47a69…`; web vcs `4a2e7ead`, sha256 `3549c42f…` |
| IOP | `--uart /tmp/mkddc-iop-a` — **Fake MCU qua PTY**, không phải MCU thật |
| `fieldbus.conf` | revision **39**, checksum `1614b997…`, sửa lần cuối 2026-09-12 18:29 |
| Journal | 1,2 GB, còn 5 lần boot (từ 2026-09-18) |

### 2.1 Cấu hình Modbus đang chạy

| Bus | Cổng | Tham số | Trạng thái |
|---|---|---|---|
| `rs485-1` "Loop-1" | `/dev/rs485-1 → ttyS5` (16550A, irq 63) | 9600 8N1, `direction=auto`, `offline_probe_ms=1000` | RUNNING; driver `TIOCGRS485` báo `driver_enabled=0` (tự đảo hướng) |
| `rs485-2` "Loop-2" | `/dev/rs485-2 → ttyS1` | 19200 8N1 | `enabled=false`; **`/dev/ttyS1` không tồn tại**, symlink `/dev/rs485-2` không có |

| Thiết bị | Addr | Điểm | Block đọc mỗi chu kỳ |
|---|---:|---|---|
| CK508-04, CK508-05 | 4, 5 | 8 relay coil DO1..8 @0..7 (read_write) | 1 × FC01 (8 bit) |
| CK509-06, CK509-07 | 6, 7 | 8 DO coil @32..39 (read_write) + 8 DI @64..71 (FC02) | 1 × FC01 + 1 × FC02 |

Tổng 48 Point (32 coil ghi được, 16 DI), `poll_ms=1000`, `timeout_ms=300`, `retry=2`,
`offline_after_errors=2`. Có một profile mồ côi `profiles/mtr-1.json` (2026-08-06, chủ
`root`) không thiết bị nào dùng.

## 3. Số đo runtime trước deploy (11:27–11:34 UTC)

### 3.1 Bus và thiết bị (API `/modbus/buses`, `/modbus/diagnostics`)

| Chỉ số | Giá trị |
|---|---|
| Trạng thái bus | RUNNING, `port_reopens=0` |
| Latency giao dịch p50 / p95 | 26 ms / 27 ms |
| Utilization đo / ước lượng BE | **15,88 %** / 20,17 % |
| Giao dịch mỗi giây | 6 (4 × FC01 + 2 × FC02), ~26 ms mỗi giao dịch ⇒ ~156 ms/s, khớp utilization |
| Bộ đếm bus | timeout 150, CRC 4, total_errors 320 (gồm cả lượt ghi lỗi) |

| Thiết bị | Online | Poll | Lỗi poll | Timeout | CRC | Retry | write_failed (API / **SHM**) | write_dropped (API / **SHM**) |
|---|---|---:|---:|---:|---:|---:|---|---|
| CK508-04 | ✅ | 96.978 | 13 | 39 | 0 | 26 | 0 / **41** | 0 / **12** |
| CK509-06 | ✅ | 96.978 | 13 | 39 | 0 | 27 | 0 / **42** | 0 / **13** |
| CK509-07 | ✅ | 96.978 | 14 | 39 | 4 | 29 | 0 / **42** | 0 / **13** |
| CK508-05 | ✅ | 96.978 | 11 | 33 | 0 | 22 | 0 / **40** | 0 / **12** |

Cột SHM đọc thẳng `/dev/shm/mkddc_io_shm` (khối `kx_modbus_diag_t`, offset 1560, bước 48 B).
Lệch giữa hai cột là lỗi `MBA-BE-01`.

### 3.2 UART `ttyS5` (`/proc/tty/driver/serial`)

| Thời điểm | tx (B) | rx (B) | fe | oe/pe/brk |
|---|---:|---:|---:|---|
| 11:27 | 4.889.528 | 3.728.178 | 2 | 0 |
| 12:09 | 5.009.592 | 3.818.302 | 2 | 0 |

Hai lỗi framing trong ~27 giờ: dây và đầu cuối ở trạng thái tốt.

### 3.3 Vùng nhớ chung `plc_shm` (`ext[]`, offset 6704, bước 64 B)

`ext_count=48`. Cả **32/32** slot coil ghi được mang `dirty=1`; setpoint `CK50804-DO1=1`,
`CK50804-DO3=1`, còn lại 0. Cờ `dirty` là cờ mức và không ai xoá. Đây là nguồn của
các lệnh bị phát lại ở §4.

## 4. Log journal

### 4.1 Theo lần boot (`journalctl -u mkddc-iobus -b N`)

| Boot | Khoảng thời gian (UTC) | Dòng | `write_fail` | Bỏ do hết lượt | Bỏ do TTL | E302 | E303 | Lần start iobus |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| −4 | 09-18 09:16 → 09-20 00:55 | 175.799 | 122.389 | 50.834 | 197 | 0 | 0 | 0* |
| −3 | 09-21 01:11 → 09-22 04:47 | 126.421 | 88.237 | 36.150 | 164 | 4 | 4 | 6 |
| −2 | 09-22 09:19 → 09-23 04:45 | 86.276 | 60.129 | 24.851 | 92 | 4 | 4 | 1 |
| −1 | 09-23 12:10 → 09-24 01:26 | 56.545 | 38.917 | 16.751 | 42 | 4 | 4 | 1 |
| 0 | 09-24 08:36 → 09-25 12:09 | 2.191 | 121 | 44 | 6 | 8 | 0 | 2** |

\* Journal của boot −4 bắt đầu giữa lúc iobus đang chạy. \*\* Gồm lần khởi động lại do deploy của phiên này.

**Đọc bảng:** ở boot −4..−1, bốn thiết bị offline suốt (mỗi boot đúng 4 E302, không hồi
phục), nhưng iobus vẫn phát lệnh ghi đều khoảng **3.000 lần/giờ**. Giới hạn "3 lần phát
hoặc 30 giây" (OD-MBRTU-005) không dừng được vòng này. Khi một lệnh bị bỏ, dấu chống
phát trùng bị xoá (bản vá `87f71676`), trong khi cờ `dirty` vẫn là 1, nên 100 ms sau lệnh
cũ lại được tạo. Lệnh cũ vì vậy sống vô hạn, và sẽ được ghi xuống khi thiết bị có điện
trở lại (`MBA-FW-08`).

### 4.2 Dòng thời gian lần boot hiện tại (trước deploy)

| Thời điểm (UTC) | Sự kiện |
|---|---|
| 09-24 08:36:19 | `iobus.start` commit `152411fb`; `rt.sched_fifo prio=70`; bus 1 mở 9600N81, ext `[0..48)`; `workers_started count=2` |
| 08:36:19–20 | `ext_cache.sendto_fail errno=2` ×2: core chưa bind `fieldbus.sock`, bình thường lúc khởi động |
| 08:36:24–31 | E302 cho cả 4 slave (thiết bị chưa trả lời) |
| 08:36–08:39 | **171 sự kiện ghi**: 121 `write_fail`, 44 bỏ do hết lượt, 6 bỏ do TTL (CK508-04 reg 0..7, `age_ms=35601`), đều là coil và đa số `value=0`. Đây là setpoint cũ bị phát lại |
| 08:37:54–57 | `slave_offline` + E302 cho cả 4 slave cùng lúc (sự cố cả dây hoặc thiết bị khởi động lại, không phải lỗi riêng lẻ) |
| 08:38 → 09-25 12:02 | Không còn sự kiện Modbus nào. **Không có dòng log khi thiết bị ONLINE trở lại**, chỉ biết qua API |
| 09-25 04:57:07 | `iop.fault MCU_TIMEOUT → SAFE_STATE → RECONNECT` trong cùng giây; `alarm.drop count=1 errno=2 (no subscriber?)`: cảnh báo này không tới ai vì `alarm.sock` chỉ có HMI nghe, mà HMI không chạy |
| 09-25 09:44:18 | `POST /api/v1/points/CK50804-DO1/override` → **404** |
| 09-25 09:45:32 | `PUT /api/v1/points/CK50804-DO1` → **409**; core `AUDIT web_cmd point=CK50804D op=write result=rejected` |

### 4.3 Core và web

- Core: 122.690 lệnh `alarm_list` từ web (~1,3 lần/giây) và 135.703 lần kết nối IPC
  trong lần boot này. Lệnh ghi duy nhất là lệnh 09:45:32 bị từ chối ở trên.
- `/modbus/events` trả `[]` dù sáng 24/09 có 8 E302: nhật ký sự kiện chỉ nằm trong bộ
  nhớ web, và web đã restart lúc 25/09 08:28.

## 5. Lập lịch thread và vòng IOP

### 5.1 Chính sách lập lịch (`/proc/<pid>/task/*/stat`, trường 40/41)

| Tiến trình | Thread | Trước deploy | Sau deploy |
|---|---|---|---|
| iobus | main (vòng IOP) | FIFO 70 | FIFO 70 |
| iobus | control / bus1 / bus2 / publish | **FIFO 70** ×4 | OTHER: `fb-control`, `mb-bus1`, `mb-bus2`, `fb-publish` |
| core | main (scan) | FIFO 80 | FIFO 80 |
| core | IPC Programming, RETAIN | **FIFO 80** ×2 | OTHER: `prog-ipc`, `st-retain` |

CPU theo thread iobus trong 26,9 giờ trước deploy: main 3.357 s (≈3,5 %), publish 351 s
(stime 257 s do `mmap/munmap plc_shm` mỗi 100 ms), bus1 98 s, control 14 s, bus2 13 s.

### 5.2 Jitter vòng IOP 2 ms (log `iobus.jitter` mỗi phút)

| Khung | Overrun/phút | `max_us` trung vị | `max_us` lớn nhất | Ghi chú tải |
|---|---:|---:|---:|---|
| 09-24 08:37 → 09-25 11:28 (1.612 phút) | ~17 trung bình | 6.728 | 21.463 | overrun cộng dồn 27.494 |
| 09-25 03:00 → 09:00 | 26–82 (theo giờ) | 10–20 ms | 20.372 | web ghi 55.754 dòng log, core 96.362 (khung 18:00–24:00 hôm trước: 44 và 44.997) |
| 09-25 10:00 → 12:02 (bản cũ, bo rảnh) | 2,6 | 3.721 | 11.320 | 13 request web trong 2 giờ |
| 09-25 12:05 → 12:09 (bản mới) | 138 | 9.059 | 10.730 | script thống kê của audit quét 1,2 GB journal |
| 09-25 12:09 → 12:15 (bản mới) | ~18 | 4–6,7 ms | 6.720 | một người dùng mở UI Programming: 733 request/5 phút, web ≈14 % CPU |

**Kết luận của mục này:** overrun IOP biến động theo **tải hệ thống** (journal, web,
Programming), không theo Modbus. IOP đang nói chuyện với **Fake MCU**, một tiến trình
SCHED_OTHER nối qua PTY, nên khi CPU bận, fake MCU trả lời chậm và vòng IOP đếm overrun.
Phép A/B trước/sau bản sửa lập lịch **chưa kết luận được** vì tải không cố định. Cần đo
có kiểm soát (§7).

## 6. Deploy và kiểm chứng trên bo (2026-09-25)

Sao lưu: `/opt/mkddc-backups/modbus-audit-20260925T120056Z/` gồm `mkddc-core`,
`mkddc-iobus`, `mkddc-web`, `SHA256SUMS.old`. Mọi binary mới có GLIBCXX tối đa `3.4.29`
(bo có `3.4.30`). Mỗi bước đều xác minh bằng `sha256sum /proc/<MainPID>/exe`.

| # | Bước | Commit | sha256 (16 ký tự đầu) | Kết quả kiểm chứng |
|---|---|---|---|---|
| 1 | web | `2840392f` | `be712b5d…` | `/modbus/diagnostics` nay trả `write_failed` 41/42/42/40, `write_dropped` 12/13/13/12, khớp SHM (**MBA-BE-01 ✅**) |
| 2 | Ghi `CK50804-DO1 = 1` (đúng giá trị đang có) qua `PUT /api/v1/points/{id}` | — | — | **HTTP 200**; core `point=EXT1 op=write value=1 result=accepted`; sau đó `release` → accepted, giá trị giữ 1 (**MBA-BE-02 ✅**). Trước sửa: 409 |
| 3 | iobus, trong khi core vẫn giữ 32 slot `dirty=1` | `2840392f` | `c68a3ac2…` | `write_baseline seeded=32`, **0** sự kiện ghi sau khởi động, so với 171 lần khởi động trước (**MBA-FW-02 ✅**). Thread Modbus/publish/control là SCHED_OTHER (**MBA-FW-01 ✅**) |
| 4 | core | `2840392f` | `7b09dbaa…` | scan FIFO 80; `prog-ipc`, `st-retain` là SCHED_OTHER; `core.ready`; iobus 0 sự kiện ghi |
| 5 | iobus bản cuối (thêm `MBA-FW-09`) | `efb3e4ae` | `a4e62291…` | profile nạp đủ 8/16/16/8 điểm; `write_baseline seeded=0`; 0 sự kiện ghi |

Trạng thái sau deploy (12:10–12:30): 4/4 online, bus RUNNING, 0 lỗi kể từ khởi động
lại, utilization 16,01 %. Frame Monitor chỉ có FC01/FC02, tức không có lệnh ghi nào lên
dây. Relay `CK50804-DO1`/`DO3` vẫn = 1 (GOOD), trạng thái vật lý không đổi. Cả 4 unit đều
`active`.

**Chưa deploy:** web bản `efb3e4ae`, chỉ khác `2840392f` ở luật validator chặn
`read_write` cho Point `bit_index`. Lý do: từ 12:10 có người dùng đang sửa draft
Programming trên bo (PATCH lúc 12:22:39, đăng nhập lại lúc 12:13 và 12:22). Khởi động lại
web sẽ làm gián đoạn họ. Không có Point nào trên bo dùng `bit_index`, và iobus bản cuối
đã từ chối cấu hình đó theo kiểu fail-closed. Cần deploy web khi bo rảnh.

`MBA-FW-03/04/05/06/07/09` không có tình huống kích hoạt trên cấu hình hiện tại của bo:
không có exception, không ghi dồn, không có bus 2, không có Point bit. Bằng chứng của
chúng là test host với slave libmodbus thật trên PTY (báo cáo finding §3).

## 7. Việc đo còn thiếu trên target

| Hạng mục | Vì sao chưa có | Cần gì |
|---|---|---|
| A/B jitter IOP trước/sau hạ SCHED_OTHER | Tải web/journal thay đổi trong khung đo | 30 phút × 2 lượt khi bo rảnh, tải web cố định (một tab UI hoặc không tab nào), đọc `iobus.jitter` |
| Bus 2 | `/dev/ttyS1` không có trong device tree đang chạy | Hardware owner áp overlay UART1 (xem `docs/08_hardware/foxlinx-som-ddc24/ENABLE_TTYS1_RS485_2.md`) |
| Exception/bit/min-max trên thiết bị thật | CK-508/509 chỉ có coil/DI | Một thiết bị có holding register, ví dụ đồng hồ điện hoặc VFD |
| MCU thật | Bo chạy Fake MCU | Lane HIL |

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-25 | Tạo mới: log 5 lần boot, số đo runtime, lập lịch thread, deploy và kiểm chứng bản sửa |
