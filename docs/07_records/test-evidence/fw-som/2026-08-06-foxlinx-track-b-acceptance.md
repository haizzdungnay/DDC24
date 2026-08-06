# Nghiệm thu Track B trên board Foxlinx SOM-DDC-24 — 2026-08-06

> **ID:** EV-MBRTU-TRACKB-2026-08-06
> **Board:** `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`), Linux 6.1.141 aarch64,
> Forlinx OK1126B-S / RV1126B, Buildroot 2024.02
> **Phạm vi:** Track B của [Plan 49](../../../03_implementation/49_MODBUS_RTU_IMPLEMENTATION_PLAN.md)
> — contract v2 (B0), FW-SOM BusWorker (B1), BE transaction apply (B2), FE (B3).
> **Người chạy:** phiên triển khai 2026-08-06

---

## 1. Kết quả tóm tắt

```text
TRACK_B_HOST_GATES        = PASS
TRACK_B_BOARD_ACCEPTANCE  = PASS WITH LIMITS
MODBUS_RTU_PRODUCTION_READY = NO   (còn G-C / G-D — xem §6)
```

## 2. Bốn cổng gate trên host

| Gate | Lệnh | Kết quả |
|---|---|---|
| C++ | `cmake -S . -B build/fw -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` rồi `ctest --test-dir build/fw` | **777/777 PASS**, 0 skip (trước Track B: 734) |
| Go | `go vet ./...` + `go test ./... -count=1` | **vet sạch**, **11/11 package `ok`**, 0 FAIL |
| FE unit | `npx vitest --run --environment jsdom src` | **375/375 PASS**, 45 file (trước: 306) |
| FE lint | `npm run lint` | **PASS**, 0 warning |
| FE build | `npm run build` | **PASS** (built in 557 ms) |

> Lưu ý lệnh: `cmake -S services` trong CLAUDE.md/AGENTS.md đã lỗi thời sau
> restructure plan 46 — thư mục `services/` không còn tồn tại, phải dùng `-S .`.

Test mới thêm trong Track B: **+43 C++** (bus worker, control channel, layout
contract v2, utilization), **+27 Go** (candidate, apply, idempotency, If-Match,
import all-or-nothing, rate limit, contract sync), **+69 FE**.

## 3. Deploy lên board

ABI v5 là thay đổi đồng bộ ba binary (Đ-03), nên `mkddc-iobus` và `mkddc-core`
được cài **cùng lúc** sau khi dừng cả hai service.

| Bước | Chi tiết |
|---|---|
| Backup | `/data/backup/config-20260806-041645.tgz` |
| Rollback | `/usr/sbin/mkddc-iobus.bak-v4`, `/usr/sbin/mkddc-core.bak-v4` |
| Cross-compile | `aarch64-linux-gnu-g++` + `-static-libstdc++ -static-libgcc` |
| SHM cũ | Xoá `/dev/shm/mkddc_{io,plc}_shm` trước khi start (magic v4 + kích thước cũ) |

**Bắt buộc phải xoá SHM cũ.** `ftruncate` nới rộng được file, nhưng nội dung còn
theo layout v4 và magic v4; creator dựng lại sạch là đường an toàn duy nhất.

Kích thước segment sau deploy khớp đúng contract v5:

```text
-rw-r--r-- 1 mkddc mkddc  3568 mkddc_io_shm     (sizeof(kx_io_shm_t)  = 3568)
-rw-r--r-- 1 mkddc mkddc 23104 mkddc_plc_shm    (sizeof(kx_plc_shm_t) = 23104)
```

Trước deploy `plc_shm` là **9280 byte** — tức board đang chạy bản `KX_N_EXT = 64`,
cũ hơn cả `main` (đã lên 256 từ 2026-08-05).

## 4. Bộ test aarch64 chạy TRÊN board

Chạy trong lúc `mkddc-iobus` + `mkddc-core` production đang hoạt động:

```text
[==========] 254 tests from 41 test suites ran. (3702 ms)
[  PASSED  ] 248 tests.
[  SKIPPED ] 6 tests   (toàn bộ là IoCache.* — cần độc quyền SHM production)
[  FAILED  ] 0
```

Riêng nhóm Track B (`ShmLayout*`, `BusWorker*`, `ControlChannel*`, `ExtCache*`,
`ModbusMaster*`): **61/61 PASS**.

## 5. Kịch bản nghiệm thu trên phần cứng thật

Provision tạm `/data/config/fieldbus.conf` (1 bus, `revision: 7`) trỏ vào
`/dev/rs485-1 → /dev/ttyS5` (UART **thật** của board).

| Mã | Kịch bản | Kết quả | Bằng chứng |
|---|---|---|---|
| T-B1 | Loader đọc `buses[]` v2 | **PASS** | `fieldbus_config.loaded buses=1 slaves=1 revision=7` |
| T-B2 | BusWorker mở cổng và cấp dải ext slot | **PASS** | `bus_worker.open bus=1 device=/dev/rs485-1 19200N81 slaves=1 ext=[0..2)` |
| T-B3 | Một thread cho mỗi bus | **PASS** | `modbus_master.workers_started count=1` |
| T-B4 | Kênh điều khiển UDS mở đúng quyền | **PASS** | `srw-rw---- mkddc mkddc /run/mkddc/modbus-control.sock` |
| T-B5 | `status` trả provenance thật | **PASS** | `generation=1, config_revision=7, producer_boot_id=47182001736922, sequence=724` |
| T-B6 | Commissioning `test_connection` chạm dây thật | **PASS** | `{"result":"fail","reason":"Connection timed out","elapsed_us":300072}` — đúng 300 ms timeout, tức lệnh ĐÃ ra dây |
| T-B7 | `op` lạ bị từ chối | **PASS** | `{"result":"error","code":"unknown_op",...}` |
| T-B8 | `write` thiếu `request_id` bị từ chối | **PASS** | `{"result":"error","code":"bad_request",...}` |
| T-B9 | Số đo bus là THẬT, không phải hằng số | **PASS** | `latency_p50_us=300072`, `latency_p95_us=300144` — bằng đúng timeout cấu hình |
| T-B10 | Fieldbus KHÔNG chặn IOP | **PASS** | `iop.state HANDSHAKE -> NORMAL_POLL`, handshake `mcu_iop=2.0 status=ok` |
| T-B11 | Không hồi quy jitter | **PASS** | xem §5.1 |
| T-B12 | Restart sạch | **PASS** | `NRestarts=0` cả hai service, `0` dòng ERROR |

### 5.1 Jitter IOP — trước và sau

| | avg (µs) | overruns / 30000 |
|---|---:|---:|
| Trước deploy (binary v4) | 15,28 – 17,83 | 5003 – 5027 |
| Sau deploy (binary v5, có BusWorker) | 16,64 – 17,91 | 1 – 11 |

Không hồi quy. Số overrun **giảm mạnh** — nhất quán với việc vòng lặp fieldbus
không còn nằm chung thread với publisher.

### 5.2 Lỗi phát hiện VÀ ĐÃ SỬA ngay trên board

`utilization_pct_x100` báo **0 %** trong khi `latency_p50_us = 300066` — tức dây
bận rõ rệt mà số liệu nói là rỗi.

- **Nguyên nhân gốc:** publisher chốt cửa sổ đo ở nhịp 100 ms, trong khi một
  transaction timeout tốn 300 ms và slave OFFLINE chỉ được probe mỗi 5 s. Cửa sổ
  ngắn hơn chu kỳ probe nên phần lớn cửa sổ có `busy = 0`; con số nhảy giữa 0 %
  và ~30 % tuỳ đúng thời điểm người dùng bấm F5.
- **Cách sửa:** đổi sang **trung bình trượt 8 ô × 2 s** (cửa sổ hiệu dụng 16 s),
  dài hơn chu kỳ probe chậm nhất thường dùng vài lần.
- **Kết quả đo lại trên board:** 10,44 % → 11,27 % → 11,90 % → 12,85 % — ổn định
  và khớp duty cycle lý thuyết (600 ms bận mỗi 5 s ≈ 12 %).
- **Test hồi quy:** `BusMetricsUtilization.SurvivesProbeIntervalLongerThanOneSlot`
  và ba test cùng nhóm.

## 6. Giới hạn phải đọc cùng kết quả

1. **Không có slave RS-485 thật.** Mọi giao dịch đều timeout. Hồ sơ này chứng
   minh đường phần mềm chạy đúng trên kiến trúc/kernel/libmodbus/UART của
   target — **không** chứng minh giao tiếp với thiết bị hiện trường.
   `G-C` vẫn OPEN, `VR-MBRTU-011` vẫn RED.
2. **`G-D` (điều khiển hướng RS-485) vẫn OPEN.** Device tree không có cấu hình
   `rs485-*` và source không gọi `modbus_rtu_set_serial_mode()`. Đang chạy trên
   giả định transceiver auto-direction — **chưa kiểm chứng**.
3. **Bus 2 chưa tồn tại trên board.** CHANGELOG 2026-08-05 ghi đã thiết lập
   `/dev/rs485-1 → ttyS5` và `/dev/rs485-2 → ttyS1`, nhưng khảo sát 2026-08-06
   cho thấy **không symlink nào tồn tại** và `/dev/ttyS1` **không được enable**
   trong device tree (chỉ có `ttyS2` cho MCU IOP và `ttyS5`). Phiên này đã tạo
   `/dev/rs485-1 → /dev/ttyS5` (thật, đã dùng để nghiệm thu). `/dev/rs485-2`
   **bị chặn**: cần sửa device tree bật UART1 M1 trên Header P16 — việc của
   Hardware/Platform, không sửa được từ tầng phần mềm.
4. **Fixture nghiệm thu đã được dọn.** `/data/config/fieldbus.conf` và profile
   `mtr-1.json` mô tả một thiết bị không có trên dây; giữ lại sẽ làm board báo
   lỗi offline vô hạn cho một thiết bị không tồn tại. Symlink `/dev/rs485-1`
   được **giữ lại** vì nó khớp tài liệu và là cấu hình đúng của board.

## 7. Trạng thái board khi kết thúc phiên

```text
mkddc-iobus  active   NRestarts=0
mkddc-core   active   NRestarts=0
/dev/shm/mkddc_io_shm    3568 byte   (ABI v5)
/dev/shm/mkddc_plc_shm  23104 byte   (ABI v5)
/dev/rs485-1 -> /dev/ttyS5
IOP: INIT → OPEN_UART → HANDSHAKE → NORMAL_POLL, mcu_iop=2.0 status=ok
ERROR trong 1 phút: 0
jitter: avg 17,91 µs, overruns 1/30001
```

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-06 | Tạo hồ sơ nghiệm thu Track B: 4 gate host, deploy ABI v5, 12 kịch bản trên board, 1 lỗi phát hiện và sửa tại chỗ |
