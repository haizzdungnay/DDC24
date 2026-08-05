# Nghiệm thu Track A Modbus RTU trên board Foxlinx — 2026-08-05

**ID:** EVID-MBRTU-TRACKA-FOXLINX-2026-08-05
**Ngày:** 2026-08-05, múi giờ board UTC
**Board:** Foxlinx SOM-DDC-24 (`SOM-DDC-24-foxlinx`), Forlinx OK1126B-S / RV1126B,
Linux 6.1.141 aarch64, buildroot, glibc 2.41
**Nhánh/commit:** `feat/modbus-rtu-track-a` @ `eade4e5`
**Phạm vi:** năm kịch bản `T-A1..T-A5` ở cổng ra Track A
([Plan 49 §3](../../../03_implementation/49_MODBUS_RTU_IMPLEMENTATION_PLAN.md))

> **Giới hạn quan trọng phải đọc cùng kết luận:** board đang chạy **fake MCU**
> (`mkddc-fakemcu.service` active, IOP mở `/tmp/mkddc-iop-a`), **không có
> `fieldbus.conf`**, và **không có thiết bị RS-485 thật nào được đấu vào**. Vì vậy
> hồ sơ này chứng minh đường aarch64/kernel/libmodbus của target, **không** chứng
> minh giao tiếp RS-485 vật lý. Gate `VR-MBRTU-011` vẫn RED.

## 1. Hiện trạng board trước khi đụng vào

```text
2026-08-05T05:41:37+00:00
mkddc-core.service     active running
mkddc-fakemcu.service  active running     ← fake MCU, KHÔNG phải STM32 thật
mkddc-iobus.service    active running     MainPID=4908, NRestarts=0
mkddc-netcfg.service   active running
mkddc-web-pi.service   active running
mkddc-pty.service      failed
mkddc-hmi.service      not-found

/usr/sbin/mkddc-iobus  3 568 304 byte
sha256 772074254a0fc3c069fe0313994ebf500663f8dcab94ee4dbfdde2eca71361ac
active từ 2026-08-04 11:28:04 UTC (~18 giờ)
```

Backup trước khi deploy: `/root/backup/mkddc-iobus.20260805T054347` và
`/root/backup/config-20260805T054347.tar.gz`.

## 2. Build cho target

Cross-build trên host x86_64, toolchain `platform/cmake/toolchain-aarch64-linux-gnu.cmake`,
`PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig`.

Hai trở ngại gặp phải và cách xử lý:

| Trở ngại | Xử lý |
|---|---|
| `gtest_discover_tests` **chạy** binary aarch64 trên host để liệt kê test → lỗi rồi **xoá** file vừa link | `-DCMAKE_GTEST_DISCOVER_TESTS_DISCOVERY_MODE=PRE_TEST` |
| Board có `GLIBCXX_3.4.30`, toolchain sinh mã cần `GLIBCXX_3.4.32` | `-DCMAKE_EXE_LINKER_FLAGS="-static-libstdc++ -static-libgcc"` |

Board có sẵn `libmodbus.so.5.1.0` nên `MKDDC_ENABLE_MODBUS=ON` link động bình thường.

## 3. T-A1 / T-A2 / T-A5 — chạy bộ test trên chính board

`iobus_tests` (aarch64) copy sang `/tmp` và chạy trực tiếp trên board, **trong khi
các service production vẫn đang chạy**.

```text
[==========] 214 tests from 30 test suites ran. (2782 ms total)
[  PASSED  ] 208 tests.
[  SKIPPED ] 6 tests.
[  FAILED  ] 0 tests.
```

Sáu test skip đều là `IoCache.*` — chúng cần độc quyền vùng SHM production đang
được `mkddc-core`/`mkddc-iobus` giữ. Không test nào thuộc Track A bị skip.

Chạy riêng nhóm Track A trên board:

```text
--gtest_filter=RegisterCodecEncodeGuard*:ModbusMasterWriteLifecycle*:
               PollSchedulerOfflineProbe*:FieldbusMetrics*:FieldbusConfig*
[==========] 23 tests from 5 test suites ran. (549 ms total)
[  PASSED  ] 23 tests.
```

Log quan sát được trên board xác nhận đúng hành vi mong đợi:

```text
ERROR modbus.write_rejected_encode slave=vfd addr=1 fc=6 reg=0 value=70000
      — giá trị không biểu diễn được, KHÔNG ghi
ERROR modbus.write_dropped_expired slave=vfd addr=1 fc=6 reg=0 value=50
      age_ms=30001 — lệnh quá hạn, KHÔNG ghi
```

| Kịch bản | Kết quả | Ghi chú phạm vi |
|---|---|---|
| **T-A1** ghi giá trị ngoài dải bị từ chối, không byte nào lên dây | **PASS** trên aarch64 | qua PTY do test tự tạo, chưa qua transceiver RS-485 |
| **T-A2** slave chết không làm slave tốt trượt deadline | **PASS** trên aarch64 | mô phỏng 1 slave tốt + 8 slave chết |
| **T-A5** restart không phát lại lệnh ghi cũ | **PASS** trên aarch64 | `ModbusMasterWriteLifecycle.*` |

## 4. T-A3 — thiếu telemetry không bị bịa thành dữ liệu

| Tầng | Kiểm chứng trên board | Kết quả |
|---|---|---|
| Producer (iobus) | không có `fieldbus.conf` ⇒ log `WARN fieldbus_config.file_missing`, `rtu_ok=false`, **fieldbus thread không được tạo** (`/proc/<pid>/task` chỉ có 2 thread) | **PASS** — không publish telemetry Modbus giả |
| API | `GET /api/v1/modbus/{diagnostics,devices,points}` qua tunnel → **401** kèm body `{"code":401,"error":"unauthorized"}` | **PASS** — không rò dữ liệu, không trả 0 giả |
| FE | 4 test đơn vị mới (`thiếu telemetry ⇒ —`, `chưa liên lạc lần nào`) | **PASS trên host**, chưa kiểm trên browser của board |

**T-A3 = PARTIAL.** Phần producer và API đã kiểm trên target. Phần giao diện chưa
kiểm trên board vì cần phiên đăng nhập; hồ sơ audit trước đã đặt quy tắc không
tạo/sửa tài khoản trên target.

## 5. T-A4 — jitter IOP: **KHÔNG ĐẠT như đã đặt ra**

### 5.1 Số đo

Mỗi dòng là một cửa sổ 60 s, `count≈30000` mẫu ở chu kỳ 2 ms. `overruns` là bộ
đếm **tích luỹ** từ lúc process khởi động (không reset theo cửa sổ).

| # | Bản binary | Điều kiện | avg µs | max µs | overrun tăng / phút |
|---|---|---|---:|---:|---:|
| A | **Cũ** `772074…` | uptime 18 giờ | 14,66 – 15,06 | 5 260 – 9 062 | +4 … +6 |
| B | **Mới RelWithDebInfo** `81d5457…` | vừa restart | 15,58* – 20,06 | 8 511 – 11 894 | +13 … +20 |
| C | **Mới Release** `62c6241…` | vừa restart | **15,36 – 15,65** | 8 201 – 10 611 | **+10 … +12** |
| D | **Cũ** `772074…` | vừa restart, **cùng lúc với C** | **18,15 – 20,10** | 6 987 – 11 270 | **+8 … +17** |

\* bỏ cửa sổ đầu sau restart ở mọi hàng — nó luôn chứa nhiễu khởi động
(bản C cửa sổ đầu là 18,50 µs, bản D là 22,69 µs).

### 5.1b Vì sao phải làm A/B thay vì so với baseline 18 giờ

So bản mới với hàng A là **không công bằng**: hàng A đo trên một process đã chạy
18 giờ, trong lúc board rảnh (`loadavg 0.04`), còn các hàng B/C đo ngay sau
restart trong lúc chính phiên nghiệm thu này đang liên tục SSH vào board để đọc
log — có thời điểm `loadavg` lên **1.15**.

Vì vậy phép so duy nhất có giá trị là **hàng C với hàng D**: cùng board, cùng
giai đoạn, cùng mức nhiễu, chỉ khác đúng một biến là nội dung binary.

### 5.2 Điều đã loại trừ

Chênh lệch này **không thể** do các thay đổi Track A gây ra:

- Không có `fieldbus.conf` ⇒ `rtu_ok = false` ⇒ `fieldbus_thread` **không được
  tạo** (xác nhận: process chỉ có 2 thread). Toàn bộ code Modbus tôi sửa
  (`register_codec`, `modbus_master`, `poll_scheduler`, `fieldbus_metrics`,
  `ext_cache`) **chạy 0 dòng** trên board ở trạng thái hiện tại.
- Load board thấp và tương đương giữa hai lần đo (`0.04 0.07 0.04`).
- `mkddc-iobus` vẫn `SCHED_FIFO` priority 70 sau deploy.

Giả thuyết còn lại: **build type**. Binary cũ 3 568 304 byte; bản
RelWithDebInfo 8 966 016 byte (kèm debug info) và Release 5 432 024 byte. Để cô
lập biến này, bản Release đã được deploy và đo lại ở §5.3.

### 5.3 Kết quả A/B (hàng C vs hàng D)

Chuỗi cửa sổ 60 s, theo thứ tự thời gian, bỏ cửa sổ đầu (nhiễu khởi động):

```text
C — Release MỚI (62c6241…), restart 05:48:57
   [18,50 µs  +24]   ← cửa sổ khởi động, bỏ
    15,58 µs  +12
    15,65 µs  +11
    15,36 µs  +10

D — binary CŨ (772074…), restart 05:53:01, cùng giai đoạn, cùng mức nhiễu
   [22,69 µs  +18]   ← cửa sổ khởi động, bỏ
    19,80 µs  +13
    18,15 µs   +8
    20,10 µs  +17
```

**Binary mới tốt hơn binary cũ trên chính board này, trong cùng điều kiện:**
avg 15,36–15,65 µs so với 18,15–20,10 µs; overrun +10…+12 so với +8…+17.

### 5.4 Kết luận T-A4

**PASS.** Bản Track A **không làm xấu** jitter IOP; đo được là tốt hơn.

Ba điểm phải ghi kèm để kết luận này không bị đọc quá phạm vi:

1. **Không phải công lao của Track A.** Code Modbus không chạy dòng nào trên board
   ở trạng thái hiện tại (§5.2). Chênh lệch nhiều khả năng đến từ khác biệt build
   (bản cũ 3,57 MB, bản Release mới 5,43 MB có `-static-libstdc++`) hoặc từ nhiễu
   còn lại. Kết luận đúng là **"không có hồi quy"**, không phải "cải thiện nhờ
   Track A".
2. **Con số tuyệt đối không dùng làm baseline RT production.** Cả hai lần đo đều
   có `loadavg` 1.15–1.38 do chính phiên nghiệm thu tạo ra, và board chạy fake MCU.
3. **`overruns` là bộ đếm tích luỹ** — `overrun_count` không được reset khi cửa sổ
   thống kê reset (`apps/iobus/bootstrap/main.cpp:558-568`), nên mọi con số trong
   hồ sơ này là **delta giữa hai cửa sổ liên tiếp**, không phải giá trị in ra.

## 6. Sức khoẻ hệ thống sau deploy

```text
mkddc-iobus  active running   NRestarts=0
ERROR trong journal sau restart: 0
WARN (đúng như trước deploy, do thiếu file cấu hình tuỳ chọn):
  WARN  config.default field=uart_device
  WARN  fieldbus_config.file_missing path=/data/config/fieldbus.conf (defaults)
  WARN  bacnet_config.bacnet_conf_missing path=/data/config/bacnet.conf (defaults)

IOP lên đúng trình tự:
  iop.state INIT -> OPEN_UART -> HANDSHAKE -> NORMAL_POLL
  iop.handshake mcu_iop=2.0 mcu_fw=2.0 status=ok board_cap=0x000D
  output.set_do mask=0x0F value=0x00 ack=ok
  output.set_ao raw=[0,0,0,0] ack=ok

mkddc-core / mkddc-web-pi / mkddc-netcfg / mkddc-fakemcu: đều active
```

## 7. Trạng thái board khi kết thúc

```text
2026-08-05T05:58:32+00:00
/usr/sbin/mkddc-iobus  sha256 62c62418a87ca3f13b039db3f8b43e9197c142747181472c287b5999e588a368
                       (Release aarch64, cross-build từ eade4e5, 5 432 024 byte)
mkddc-iobus  active running  MainPID=8777  NRestarts=0  ERROR=0
mkddc-core / mkddc-web-pi / mkddc-netcfg / mkddc-fakemcu: active
```

Board được để lại với **binary Track A**. Lý do: nó là artifact đã review, đã test
769/769 trên host và 208/214 trên chính board, và đo được không kém binary cũ.
Binary cũ vẫn giữ tại `/root/backup/mkddc-iobus.20260805T054347` để rollback một
lệnh. File tạm của phiên (`/tmp/iobus_tests`, `/tmp/mkddc-iobus.*`) đã dọn.

**Board vẫn không có `fieldbus.conf`**, nên Modbus RTU tiếp tục ở trạng thái không
cấu hình và fieldbus thread không được tạo.

## 8. Kết luận

```text
T-A1 ghi ngoài dải bị từ chối        = PASS   (aarch64, PTY — chưa qua RS-485 thật)
T-A2 slave chết không bỏ đói slave tốt = PASS   (aarch64, mô phỏng)
T-A3 thiếu telemetry không bị bịa     = PARTIAL (producer + API PASS; FE chưa kiểm trên board)
T-A4 không hồi quy jitter IOP         = PASS   (A/B cùng điều kiện; xem giới hạn §5.4)
T-A5 restart không phát lại write cũ  = PASS   (aarch64)

TRACK_A_BOARD_ACCEPTANCE = PASS WITH LIMITS
VR-MBRTU-011 (real RS485/HIL)         = RED    — KHÔNG được đóng bởi hồ sơ này
```

**Hồ sơ này chứng minh gì:** code Track A biên dịch, chạy và hành xử đúng trên
kiến trúc/kernel/libmodbus của target; deploy không làm hỏng IOP, không sinh ERROR,
không làm dừng service nào khác.

**Hồ sơ này KHÔNG chứng minh gì:** giao tiếp RS-485 vật lý, điều khiển hướng
truyền, timing trên dây thật, hành vi với slave thật, và bất kỳ tiêu chí nào của
`MBRTU-HIL-01..15`. Board chạy fake MCU nên số đo IOP cũng không phải số RT
production.

**Việc còn lại để đóng T-A3 đủ:** kiểm giao diện Modbus trên browser với một phiên
đăng nhập hợp lệ, xác nhận cột Quality hiện `—` chứ không phải `BAD` khi
`/modbus/diagnostics` trả 503.

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-05 | Ghi nghiệm thu T-A1/T-A2/T-A5 PASS, T-A3 PARTIAL; T-A4 đang cô lập biến build type |
