# Modbus RTU — FW-SOM Runtime Design DDC-24 Rev A

**ID:** DDD-FW-MBRTU-001
**Phiên bản:** 0.2
**Trạng thái:** Active (Phê duyệt 2026-08-05 theo Tờ trình `DDC24-MBRTU-REQ-APPROVE-2026-08-05`)
**Ngày:** 2026-08-05
**Chủ quản đề xuất:** Fieldbus Lead + Core Lead
**Phạm vi:** `mkddc-iobus` và `mkddc-core` trên SOM. **Không** liên quan STM32/IOP.
**Quyết định đã ký áp dụng:** Đ-05 (retry thật), Đ-07 (≥256 Point).
> **Đ-01 (1 bus) ĐÃ BỊ THAY THẾ** bởi `OD-MBRTU-001` (CLOSED 2026-08-05): sản phẩm có **2 cổng RS-485** — `rs485-1`→`ttyS5`, `rs485-2`→`ttyS1`
**Đối chiếu source tại:** `feat/modbus-rtu-track-a` / `eade4e5`
**Trace:** `SYS-REQ-MBRTU-001`, `SWR-REQ-MBRTU-004..006`, `SWR-REQ-MBRTU-009`,
`IF-REQ-MBRTU-001..002`, [DDD-DM-MBRTU-001](MODBUS_RTU_DATA_MODEL.md)

> Thiết kế mục tiêu. Sai khác so với source hiện tại ở §12. Không sửa source.
> Nhãn **As-Built ✅** đánh dấu mục thiết kế mà source tại `eade4e5` **đã** đáp ứng
> và có test — chủ yếu là kết quả Track A.

## 1. Ai sở hữu cái gì

| Trách nhiệm | Owner | Lý do |
|---|---|---|
| Mở/đóng cổng serial RS485 (**2 cổng**: `rs485-1`, `rs485-2`) | `mkddc-iobus` | duy nhất được chạm phần cứng serial |
| Poll scheduler, transaction Modbus, retry | `mkddc-iobus` | cần bám monotonic clock và trạng thái dây |
| Codec register ↔ engineering | `mkddc-iobus` | ở gần dữ liệu thô nhất, tránh truyền raw đi xa |
| `quality`, `quality_reason`, sample timestamp | `mkddc-iobus` | chỉ producer biết mẫu có thật hay không |
| Counter diagnostics bus/device/point | `mkddc-iobus` | |
| **Point Table canonical** (giá trị Point mà hệ thống dùng) | `mkddc-core` | một nơi duy nhất hợp nhất Local I/O, Virtual và Modbus RTU |
| Arbitration lệnh ghi (priority, safe-state, interlock) | `mkddc-core` | mọi lệnh output phải qua một cửa |
| Cấu hình, revision, RBAC, audit | `mkddc-web` | ngoài phạm vi tài liệu này |

**Trả lời dứt khoát câu hỏi "Core hay IOBus sở hữu Point value":**
`mkddc-iobus` sở hữu **mẫu đo** (sample) và quality của nó; `mkddc-core` sở hữu
**Point value canonical** mà phần còn lại của hệ thống đọc. iobus không ghi thẳng
vào Point Table; nó publish snapshot và core nạp vào Point Table ở ranh giới scan.

## 2. Cấu trúc process và thread

```text
mkddc-iobus (một process)
├── thread: iop_main         SCHED_FIFO   chu kỳ 2 ms   — KHÔNG bị Modbus chạm vào
├── thread: fieldbus_rs485_1 SCHED_OTHER  event-driven  — BusWorker 1 (/dev/rs485-1 -> /dev/ttyS5)
├── thread: fieldbus_rs485_2 SCHED_OTHER  event-driven  — BusWorker 2 (/dev/rs485-2 -> /dev/ttyS1)
├── thread: bacnet           SCHED_OTHER                — ngoài phạm vi
└── thread: control          SCHED_OTHER                — nhận config/write qua UDS

mkddc-core (một process)
└── thread: scan_loop        SCHED_FIFO   chu kỳ cấu hình — nạp ext snapshot ở đầu scan
```

**Cấu hình 2 Bus RS485 phần cứng trên Foxlinx SOM-DDC-24:**
- **Bus 1 (`bus_id = 1`):** Đường link cứng `/dev/rs485-1` → `/dev/ttyS5` (Main RS485 Port).
- **Bus 2 (`bus_id = 2`):** Đường link cứng `/dev/rs485-2` → `/dev/ttyS1` (Expansion RS485 Port trên Header P16 UART1 M1).

Mỗi `BusWorker` chạy trên một thread riêng biệt với ngữ cảnh `libmodbus` độc lập, sở hữu hàng đợi EDF và bộ đếm diagnostics riêng, đảm bảo nếu Bus 2 bị lỗi đường dây thì Bus 1 vẫn hoạt động bình thường ở chu kỳ polling cấu hình.

Bất biến:

- **Một BusWorker cho một bus.** Không bao giờ có hai luồng cùng phát trên một dây.
- Modbus **không bao giờ** chạy ở SCHED_FIFO và không chia sẻ mutex với `iop_main`.
  **As-Built ✅** — `modbus_master.hpp` ghi rõ "KHÔNG SCHED_FIFO — tránh chặn IOP 100Hz".
- Một BusWorker bị chặn (timeout dài, cổng chết) **không** ảnh hưởng worker kia,
  không ảnh hưởng `iop_main`, không ảnh hưởng `scan_loop`.
- Không có blocking I/O nào của Modbus nằm trong đường thực thi của core scan.

## 3. Vòng đời BusWorker

```text
CLOSED
  │ config có bus.enabled = true
  ▼
OPENING ── open(port) lỗi ──► PORT_ERROR ──(backoff 1s,2s,5s,10s,30s)──► OPENING
  │ ok
  ▼
RUNNING ── vòng lặp: chọn device đến hạn → transaction → cập nhật cache
  │           ├─ lỗi cổng (ENODEV/EIO) ──► PORT_ERROR (mọi device → OFFLINE, reason PORT_DOWN)
  │           └─ nhận generation mới ──► DRAINING
  ▼
DRAINING ── hoàn tất transaction đang phát, huỷ hàng đợi write chưa gửi ──► SWAPPING
SWAPPING ── dựng bảng device/point của generation mới ──► RUNNING (hoặc CONFIG_ERROR)
```

`PORT_ERROR` phải publish `quality=OFFLINE`, `quality_reason=PORT_DOWN` cho toàn bộ
Point trên bus đó, không được im lặng giữ giá trị GOOD cũ.

## 4. Poll scheduler

### 4.1 Thuật toán

Mỗi bus giữ một hàng đợi ưu tiên theo **deadline tuyệt đối** trên `CLOCK_MONOTONIC`:

```text
loop:
  now = monotonic_now()
  d   = earliest_deadline_device(now)
  if d == none: sleep_until(next_deadline); continue
  if d.deadline > now: sleep_until(min(d.deadline, control_wakeup)); continue

  for block in d.read_blocks:            # gộp theo (fc, dải liền kề)
      result = transact(block, d.timeout_ms)
      if error and attempts <= d.retry_count: retry same block
      else if error: mark_device_error(d); break
  flush_writes(d)                        # ghi sau khi đọc, cùng lượt chiếm bus
  d.deadline = now + d.poll_interval_ms  # KHÔNG cộng dồn từ deadline cũ
```

Quy tắc bắt buộc:

- **Earliest-deadline-first**, round-robin khi trùng deadline ⇒ không đói device.
  **As-Built ✅** — `poll_once()` gom slave đến hạn, `stable_sort` theo mức quá hạn
  giảm dần rồi mới phục vụ (`modbus_master.cpp`, D-04, commit `c4036dd`).
- Deadline mới tính từ `now`, không tính từ deadline cũ ⇒ device chậm không tạo
  chuỗi poll dồn nén sau khi hồi phục. **As-Built ✅** — `on_poll_ok`/`on_poll_error`
  đều gán `last_poll_ms = now_ms`.
- **Đường lỗi cũng phải cập nhật `last_poll_ms`.** Đây là điều kiện sống còn, không
  phải chi tiết: trước bản sửa 2026-08-04 `on_poll_error` không đụng `last_poll_ms`
  nên slave chết luôn thoả `is_due()` và được phục vụ ở **mọi** vòng poll, mỗi lần
  chiếm dây trọn `timeout_ms`. Với 8 slave chết ở timeout 300 ms, mỗi vòng tiêu
  2,4 giây chỉ để chờ hết giờ, và slave tốt `poll_ms=1000` trượt deadline liên tục.
  Đó là một cơ chế **bỏ đói đang hoạt động**, không phải thiếu tính năng. **As-Built ✅**
- Retry chỉ áp cho block đang lỗi. Hết retry ⇒ **nhường bus** cho device khác ngay.
  **As-Built ✅** — `read_slave()` phát lại đúng block lỗi tối đa `retry` lần
  (`max_attempts = retry + 1`), đếm `record_retry()` cho mỗi lần phát lại thật (D-05/D-06).
- Device `OFFLINE` chuyển sang probe chậm theo `bus.offline_probe_ms` (mặc định 5 s),
  không giữ nhịp `poll_interval_ms` ⇒ một device chết không ăn hết băng thông.
  **As-Built ✅** — `effective_interval_ms()`. Lưu ý ngoại lệ có chủ ý: slave **chưa
  từng** poll (`last_poll_ms == 0`) vẫn dùng nhịp nhanh để thiết bị lên sớm.
- Device `DISABLED` hoặc `CONFIG_ERROR` không vào hàng đợi.
- Scheduler đo `deadline_miss` và `poll_duration` thật; **không** âm thầm kéo dài chu kỳ.
  ⚠️ **chưa có** — hai counter này chưa tồn tại trong `FieldbusMetrics` (gap F-FW-17).

### 4.1a Ngưỡng OFFLINE tách khỏi retry (Đ-05)

Hai tham số **khác nhau**, không được dùng lẫn:

| Tham số | Đơn vị đếm | Ý nghĩa | Chi phí xấu nhất |
|---|---|---|---|
| `retry_count` (0..3) | lần phát lại **trong một lượt poll** | chịu nhiễu thoáng qua | `(1+retry) × timeout_ms` chiếm dây |
| `offline_after_errors` (1..10) | **lượt poll** thất bại liên tiếp | quyết định chuyển OFFLINE | ảnh hưởng thời gian phát hiện mất thiết bị |

> Vì sao tách. Trước 2026-08-04 chỉ có một trường mang nhãn "Retry" trên UI/API
> nhưng ngữ nghĩa runtime là ngưỡng OFFLINE, và **không có một lần phát lại nào**
> được thực hiện — `read_slave()` gặp lỗi là `break`, libmodbus cũng không tự retry.
> Người vận hành đặt `retry=3` tin rằng hệ thống chịu được nhiễu thoáng qua, trong
> khi thực tế mọi lỗi đơn lẻ đều làm điểm dữ liệu rơi STALE. Đây là lỗi "nhãn nói
> một đằng, code làm một nẻo", nguy hiểm hơn thiếu tính năng vì nó tạo niềm tin sai.
> **As-Built ✅** (D-05/D-06, commit `0f0fe71`).

### 4.2 Gộp block đọc

Gộp các Point cùng `(device, function code)` có dải register **liền kề**:

- không đọc xuyên khoảng trống (một số slave trả exception hoặc có side effect);
- tối đa 125 register hoặc 2000 bit cho một transaction;
- Point disabled không tham gia gộp.

### 4.3 Ghi

- Hàng đợi ghi **bounded** (mặc định 64 toàn hệ). Đầy ⇒ trả `QUEUE_FULL`, không drop im lặng.
  ⚠️ **chưa có** — `pending_writes_` là `std::vector` không giới hạn (gap F-FW-18).
- Ghi cùng `(device, register)` chưa gửi được **coalesce** (giữ giá trị mới nhất, giữ `request_id` mới nhất, trả `SUPERSEDED` cho request cũ).
- **Một lệnh ghi phải có vòng đời hữu hạn.** Bỏ hẳn khi vượt `kMaxWriteAttempts`
  (3 lần phát) **hoặc** quá `kWriteTtlMs` (30 s kể từ lúc enqueue), kèm log ERROR
  có `slave/fc/reg/value/attempts` và tăng counter `write_dropped`. **As-Built ✅**
  (D-03, commit `a6fba4c`).

  > Vì sao có TTL bên cạnh số lần thử: trước bản sửa, write lỗi được `continue` mà
  > **không** đánh `submitted`, nên request nằm lại hàng đợi **vô thời hạn** và được
  > thử lại ở mọi vòng poll. Hệ quả thực tế: setpoint đặt lúc 09:00 cho một thiết bị
  > đang mất điện sẽ tự động được ghi lúc 14:00 khi thiết bị có điện trở lại — đúng
  > hành vi "blind replay after reconnect" mà thiết kế cấm. Chọn 3 lần: đủ vượt nhiễu
  > thoáng qua, đủ ngắn để không giữ lệnh qua một sự cố mất điện. Chọn 30 s: dài hơn
  > vài chu kỳ poll chậm nhất (10 s), ngắn hơn nhiều thời gian cắt/cấp điện lại.

- Hai counter phải **tách bạch**: `write_failed` = một lần phát thất bại (còn có thể
  thử lại); `write_dropped` = lệnh bị **bỏ hẳn**. Người vận hành cần `write_dropped`
  vì nó trả lời đúng câu hỏi "lệnh của tôi có tới thiết bị không". **As-Built ✅**
- Sau khi gửi và có kết quả, request rời hàng đợi vĩnh viễn. **Không replay**
  khi device reconnect, khi BusWorker swap generation, hay khi process restart.
  ◐ **đóng một phần** — xem F-FW-07 ở §12: trong một vòng đời process thì đúng, nhưng
  cờ `dirty` trong PLC SHM là **cờ mức** do core đặt lại mỗi scan và **không ai xoá**,
  nên sau khi `mkddc-iobus` restart, `has_last_written_` rỗng ⇒ lệnh được phát lại.

## 5. Codec

| Register type | Read FC | Write FC | Data type hợp lệ |
|---|---:|---:|---|
| Coil | 01 | 05 | bool |
| Discrete Input | 02 | — | bool |
| Input Register | 04 | — | int16/uint16/int32/uint32/float32 (+ bool có `bit_index`) |
| Holding Register | 03 | 06 (16-bit) / 16 (32-bit) | như trên |

Quy tắc:

- 16-bit = 1 register; 32-bit = 2 register; `bit_index` trích 1 bit từ 1 register.
- `byte_order` quyết định thứ tự byte trong một word; `word_order` quyết định thứ tự
  hai word của giá trị 32-bit. Bốn tổ hợp tương ứng `ABCD/BADC/CDAB/DCBA`.
- Đọc: `engineering = raw × scale + offset`, rồi kiểm `min/max` nếu có.
- Ghi: `raw = round_half_away_from_zero((engineering − offset) / scale)`;
  từ chối nếu sai số sau làm tròn > 0,5 LSB hoặc raw tràn dải của kiểu.
- Từ chối: NaN, ±Inf, `scale = 0`, count sai, địa chỉ tràn 65535, kiểu không hợp lệ.
- **Modbus exception response là lỗi transaction**, không phải một mẫu GOOD.

Codec phải có golden vector cho mọi tổ hợp `(data_type × byte_order × word_order)`
kèm giá trị âm và biên, chạy được không cần libmodbus.

## 6. Quality và timestamp

### 6.1 Chuyển trạng thái

| Điều kiện | quality | value | timestamp |
|---|---|---|---|
| decode + range hợp lệ | `GOOD` | cập nhật | cập nhật (thời điểm sample) |
| lỗi nhưng tuổi mẫu < `stale_after_ms` | `GOOD` | giữ | **giữ** |
| tuổi mẫu ≥ `stale_after_ms` | `STALE` | giữ | giữ |
| tuổi mẫu ≥ `offline_after_ms`, hoặc `PORT_DOWN` | `OFFLINE` | giữ | giữ |
| decode lỗi / non-finite / ngoài `min-max` / exception | `BAD` | **không cập nhật** | giữ |
| device/point không chạy được theo cấu hình | `CONFIG_ERROR` | không cập nhật | giữ |
| chưa từng có mẫu | `BAD`, reason `NOT_INITIALIZED` | `default_value` | `null` |

**Timestamp là thời điểm sample thành công gần nhất.** Nó không đổi khi quality
xấu đi. Đây là điều kiện để consumer tính `sample_age` đúng.

Mỗi sample mang cả `sample_mono_ns` (đánh giá stale, miễn nhiễm chỉnh giờ) và
`sample_utc_ms` (hiển thị). Khi NTP chưa đồng bộ, quality **không** đổi nhưng
health phải báo `time_sync=false`.

### 6.2 Reason code

`NOT_INITIALIZED`, `CONFIG_ERROR`, `DECODE_ERROR`, `OUT_OF_RANGE`, `TIMEOUT`,
`CRC_ERROR`, `PORT_DOWN`, `DEVICE_EXCEPTION` (kèm exception code), `WRITE_FAILED`,
`BUS_OVERLOAD`.

## 7. Đường dữ liệu vào

```text
slave → RS-485 → BusWorker.transact() → codec → SampleCache (trong iobus)
     → snapshot v2 (UDS datagram, có sequence + generation + revision)
     → mkddc-core: nạp ở ĐẦU scan, trước khi chạy logic
     → PointTable[EXT] (canonical)
     → plc_shm / core UDS → mkddc-web → REST/WS → FE
```

Ràng buộc:

- Core nạp snapshot **một lần ở đầu scan**, giữ ảnh nhất quán suốt scan đó.
- Snapshot mới thay snapshot cũ hoàn toàn (không merge từng field).
- Datagram bị mất ⇒ core dùng snapshot trước, và `sample_age` tự tăng ⇒ đúng
  ngữ nghĩa STALE. `sequence` cho phép phát hiện drop/reorder và ghi metric.
- Core **không** tự tạo quality cho Point Modbus; nó chuyển tiếp quality của producer.

## 8. Đường lệnh ghi

```text
nguồn có thẩm quyền (Web commissioning / core logic / schedule)
  → mkddc-core: RBAC-checked? type? range? read_write? quality? revision?
  → PriorityResolver + SafeState  (arbitration một cửa)
  → WriteRequest{request_id, point_id, config_revision, typed value, deadline}
  → UDS reliable → mkddc-iobus control thread
  → BusWorker của đúng bus, đưa vào hàng đợi ghi bounded
  → FC05 / FC06 / FC16 trên dây
  → (tuỳ chọn) readback
  → WriteResult{request_id, accepted|applied|rejected|timeout, exception, readback}
  → core → web → audit + UI
```

### 8.1 Chống nhiều nguồn cùng ghi

Một Modbus RTU Point ghi được chỉ có **một** đường vào dây: qua core arbitration.

| Nguồn | Được phép ghi trực tiếp xuống iobus? |
|---|---|
| Core logic / graph / schedule | không — phải qua `PriorityResolver` |
| Web commissioning write | không — đi qua core, mang danh tính actor |
| BACnet | không — Modbus RTU Point không phải commandable BACnet object trong Rev A |
| HMI | không |
| FE | không |

Khi hai nguồn cùng nhắm một Point trong một chu kỳ, `PriorityResolver` quyết định
theo mức ưu tiên hiện hành; kết quả phải **deterministic** và ghi được vào trace.
Ưu tiên của commissioning write so với logic là `OD-MBRTU-005`.

### 8.2 Cấm

- Không tự ghi `default_value` hoặc `safe_value` khi mất liên lạc. `safe_value`
  chỉ là input policy cho core, và chỉ có hiệu lực khi core phát một request mới.
- Không replay request cũ sau reconnect/restart/generation swap.
- Không báo `applied` khi chưa có phản hồi từ slave. Timeout là `timeout`.

## 9. Config reload tại ranh giới an toàn

```text
web → UDS(control): ApplyConfig{revision, checksum, payload}
iobus:
  1. parse + validate payload            → lỗi ⇒ REJECT(reason), giữ nguyên generation cũ
  2. resolve capability cho từng bus     → lỗi ⇒ REJECT(BUS_UNAVAILABLE)
  3. dựng generation G+1 trong bộ nhớ    → gồm bảng device/point/slot mapping
  4. với mỗi BusWorker: DRAINING → SWAPPING tại ranh giới GIỮA hai transaction
  5. mở/đóng cổng nếu tham số serial đổi
  6. ACK{applied_revision, checksum, bus_open_state}
```

Ranh giới an toàn = **giữa hai transaction Modbus**, không phải giữa hai byte.
Nếu bất kỳ bước 1–5 thất bại, iobus **giữ generation cũ đang chạy** và trả REJECT.
iobus không tự restart để áp cấu hình.

Generation là số nguyên tăng nội bộ. Slot index chỉ có ý nghĩa **trong một
generation**; identity xuyên generation luôn là `point_id`.

## 10. Startup, shutdown, recovery

| Tình huống | Hành vi bắt buộc |
|---|---|
| Startup, có `fieldbus.conf` hợp lệ | mở bus enabled, publish generation 1, mọi Point `BAD/NOT_INITIALIZED` cho tới mẫu đầu |
| Startup, config lỗi | không mở bus, publish trạng thái `CONFIG_ERROR`, log rõ, **không** exit toàn service (IOP vẫn phải chạy) |
| Startup, cổng không tồn tại | bus `PORT_ERROR` + backoff; bus còn lại vẫn chạy |
| Shutdown | dừng nhận request mới, hoàn tất transaction đang phát, đóng cổng, **không** ghi giá trị nào xuống slave |
| iobus crash + systemd restart | bắt đầu lại từ config trên đĩa; **không** replay write; counter reset và `producer_boot_id` đổi |
| core crash + restart | đọc snapshot mới; Point Modbus `BAD/NOT_INITIALIZED` cho tới snapshot đầu tiên |
| web crash | poll và control local **tiếp tục** không gián đoạn |
| Mất RS485 (đứt dây) | device → `DEGRADED` → `OFFLINE` theo ngưỡng; bus vẫn `open`; probe tiếp |
| Rút cổng USB-RS485 (lab) | bus → `PORT_ERROR`; mọi Point `OFFLINE/PORT_DOWN`; reconnect khi cổng trở lại |

## 11. Bộ nhớ, capacity và ngân sách

| Hạng mục | Giá trị Rev A | Trạng thái |
|---|---:|---|
| Bus logic | **2** | **CHỐT** bằng `OD-MBRTU-001` (CLOSED 2026-08-05) — `rs485-1`→`ttyS5`, `rs485-2`→`ttyS1`. Thay thế Đ-01 (1 bus) |
| Device / bus | 16 | PROPOSED |
| Device tổng | 32 (16 × 2 bus) | PROPOSED |
| Modbus RTU Point tổng | **≥ 256** (mục tiêu Đ-07) | PROPOSED — **As-Built vẫn là 64** (`KX_N_EXT = 64`). Nâng phải cùng đợt đổi ABI |
| Pending write toàn hệ | 64 | PROPOSED — chưa cưỡng chế trong source (F-FW-18) |
| Read block | 125 register / 2000 bit | ràng buộc protocol |
| Buffer cho một BusWorker | ≤ 8 KiB tĩnh | PROPOSED |
| RAM thêm cho fieldbus | ≤ 2 MiB | PROPOSED |
| CPU cho BusWorker | ≤ 5 % một core ở tải danh định | PROPOSED — **chưa đo**; số cũ ghi "RK3566" là sai board, target thật là Forlinx OK1126B-S / RV1126B (Đ-10) |

**Tác động của Đ-07 phải đo, không được giả định.** Nâng `KX_N_EXT` 64 → 256:

| Hạng mục | 64 Point | 256 Point |
|---|---:|---:|
| Vùng `ext[]` trong PLC SHM | ~2,5 KB | ~10 KB |
| Datagram snapshot iobus → core | ~2,6 KB | ~10,3 KB |

Hai điều bắt buộc kiểm chứng trong Track B: (1) datagram ~10 KB qua Unix `SOCK_DGRAM`
phải kiểm giới hạn buffer nhận, vượt thì chia mảnh hoặc chuyển stream; (2) thời gian
copy snapshot mỗi vòng scan tăng ~4 lần, phải đo trên Foxlinx với MCU thật để bảo đảm
không ảnh hưởng chu kỳ IOP.

Sở hữu bộ nhớ:

- Bảng device/point của một generation được cấp phát **một lần** lúc swap, không
  cấp phát trong vòng poll.
- Không cấp phát động trong đường transaction (buffer tĩnh theo giới hạn protocol).
- `SampleCache` là mảng cố định theo capacity; không có con trỏ chia sẻ ra ngoài
  BusWorker; snapshot được **copy** khi publish.

Vượt capacity ⇒ **reject rõ** ở tầng validate của web. iobus gặp cấu hình vượt
capacity (do file bị sửa tay) phải `CONFIG_ERROR` fail-closed, không truncate.

## 12. Sai khác so với source hiện tại

**Đối chiếu lại tại `eade4e5` (2026-08-05), sau Track A.**

### 12.1 Gap còn lại

| ID | Thiết kế | As-Built tại `eade4e5` | Mức | Bằng chứng |
|---|---|---|---|---|
| F-FW-01 | `BusWorker` tách khỏi `ModbusMaster` | **ĐÃ ĐÓNG** — mỗi bus một `BusWorker` trên thread riêng, `modbus_t*` riêng | — | `MBR-B101` triển khai; hai bus là yêu cầu sản phẩm, không còn là nợ cấu trúc |
| F-FW-02 | quality 5 mức + reason | `kx_quality_t{GOOD,UNCERTAIN,BAD}` + cờ `online` | P0 | `contracts/shm/mkddc_shm.h` |
| F-FW-03 | sample có timestamp producer | `kx_ext_point_t` không có trường timestamp | P0 | `mkddc_shm.h` |
| F-FW-04 | value typed (double) | `float value` | P0 | như trên |
| F-FW-05 | snapshot có sequence/generation/revision/checksum | `kx_ext_snapshot_msg_t` chỉ có magic + points | P0 | `mkddc_shm.h` |
| F-FW-06 | write qua request/result có `request_id` | `plc_shm.ext[i].dirty/setpoint`, không có kết quả trả về | P0 | `modbus_master.cpp` `drain_ext_writes()` |
| F-FW-07 | không replay ở **mọi** tình huống | ◐ **đóng một phần**: trong một vòng đời process, lệnh lỗi bị bỏ sau 3 lần phát hoặc 30 s (D-03 ✅). **Còn hở ở restart**: `dirty` là cờ mức do `GraphRuntime::apply_ext_writes()` đặt lại mỗi scan và không ai xoá; sau restart `has_last_written_` rỗng ⇒ phát lại | **P1** (hạ từ P0) | `modbus_master.cpp` `drain_ext_writes()`; `apps/core/domain/graph/graph_runtime.cpp` `apply_ext_writes()` |
| F-FW-09 | admission/utilization bus | không tính | P1 | không có mã tương ứng |
| F-FW-10 | config reload tại ranh giới transaction | web `systemctl restart mkddc-iobus` (D-09) | P0 | `reloadhelper_linux.go` |
| F-FW-11 | identity là `point_id` mọi trường hợp | `ext_point_name()` trả `point.name` khi 1 slot, ngược lại `<slave>.<point>[i]` | P1 | `modbus_master.cpp` |
| F-FW-12 | `bit_index` | không hỗ trợ | P1 | `device_profile.hpp` |
| F-FW-13 | counter uint64 + `producer_boot_id` | `FieldbusMetrics` uint32 theo slave, không boot id | P1 | `fieldbus_metrics.hpp` |
| F-FW-14 | `min/max` engineering ở producer | không có | P1 | |
| F-FW-15 | readback sau write | không có | P1 | |
| F-FW-16 | slot mapping ổn định theo generation | device lỗi cấu hình không cấp slot ⇒ base index của device sau dịch chuyển | P2 | `modbus_master.cpp` |
| **F-FW-17** | scheduler đo `deadline_miss` và `poll_duration` | hai counter **không tồn tại** trong `FieldbusMetrics` | **P1 mới** | `fieldbus_metrics.hpp` — cần cho acceptance T-A2 và `NFR-REQ-MBRTU-004` |
| **F-FW-18** | hàng đợi ghi bounded, đầy ⇒ `QUEUE_FULL` | `pending_writes_` là `std::vector` **không giới hạn** | **P1 mới** | `modbus_master.hpp` |
| **F-FW-19** | `direction_control` RS-485 phải được đặt tường minh | source **không gọi** `modbus_rtu_set_serial_mode()`; device tree Foxlinx không có `rs485-*` | **P0 mới** | chặn bởi Đ-02/`G-D` (Hardware Lead), tương ứng D-13 |
| **F-FW-20** | capacity ≥ 256 Point (Đ-07) | `KX_N_EXT = 64` | **P0 mới** | `contracts/shm/mkddc_shm.h` |

### 12.2 Đã đóng bằng Track A — không còn là gap

| ID cũ | Thiết kế | Bằng chứng As-Built | Defect |
|---|---|---|---|
| — | encode fail-closed: `scale=0`, NaN/±Inf, ngoài dải kiểu ⇒ `false`, không ghi byte nào | `register_codec.cpp`, `device_profile.cpp`; 8 test âm tính | D-01, D-02 (`1e3e2bc`) |
| — | vòng đời write hữu hạn: 3 lần phát hoặc TTL 30 s ⇒ bỏ + log + `write_dropped` | `modbus_master.{hpp,cpp}`, `fieldbus_metrics.*`; 3 test | D-03 (`a6fba4c`) |
| **F-FW-08** | scheduler EDF + probe chậm cho OFFLINE; đường lỗi cập nhật `last_poll_ms` | `poll_scheduler.cpp`, `modbus_master.cpp` (`stable_sort` theo overdue); 4 test | D-04 (`c4036dd`) |
| — | retry **thật**: phát lại đúng block lỗi `retry` lần; `retry_attempts ≠ total_errors`; ngưỡng OFFLINE là field riêng | `modbus_master.cpp` `read_slave()`, `fieldbus_config.hpp`, `domain.go`; 3 test | D-05, D-06 (`0f0fe71`) |
| — | `push_snapshot` dùng `offsetof` + `static_assert` | `ext_cache.cpp` | D-11 (`9168cba`) |
| — | E303 dùng cửa sổ trượt, hết latch vĩnh viễn | `fieldbus_metrics.*` (`window_polls`/`window_errors`); 1 test | D-12 (`9168cba`) |
| — | Point chưa có mẫu publish `online=0` thay vì STALE-giá-trị-0 | `modbus_master.cpp`, `ext_cache.cpp` | D-10 (`9168cba`) |

**Điểm đã đúng và cần giữ:** fail-closed cho `slave_config_error_` (device thiếu
profile / hết slot **không** được báo ONLINE, có alarm E302) là hành vi đúng và
phải được giữ nguyên trong thiết kế mới; `ext_slots_for_point()` là nguồn chân lý
duy nhất cho việc đếm slot; fieldbus chạy priority thường và không chặn IOP.

### 12.3 Đối chiếu As-Built — audit Modbus 2026-09-25

> Ghi nhận hiện trạng, **không** đổi nội dung thiết kế ở trên. Chi tiết và bằng chứng:
> [REC-MBA-GAP-001](../../07_records/reviews/MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS.md),
> [REC-MBA-SRC-001](../../07_records/reviews/MODBUS_AUDIT_2026-09-25_SOURCE_STATUS.md),
> [REC-MBA-BOARD-001](../../07_records/reviews/MODBUS_AUDIT_2026-09-25_BOARD_OPERATION_REPORT.md).

| Mục thiết kế | As-Built trước audit (`36c1a863`) | Sau bản sửa (`efb3e4ae`) |
|---|---|---|
| §2 "Modbus không bao giờ chạy SCHED_FIFO" | **Vi phạm trên target**: mọi thread iobus thừa hưởng FIFO 70 của `main` | ĐÓNG (`MBA-FW-01`): thread phụ hạ về SCHED_OTHER, có tên |
| §4.3 / §10 không replay sau restart (F-FW-07) | ◐ phát lại mọi slot `dirty=1` khi iobus khởi động | ĐÓNG phần restart (`MBA-FW-02`); **MỞ** phần lệnh bị bỏ được tạo lại vô hạn (`MBA-FW-08`, cần hợp đồng lệnh mới) |
| §4.3 coalesce không mất lệnh | lệnh mới chen giữa giao dịch bị nuốt | ĐÓNG (`MBA-FW-04`) |
| §6.1 exception ⇒ BAD ở cấp Point | exception kéo cả thiết bị OFFLINE | ĐÓNG (`MBA-FW-05`) |
| §6.1 BAD không cập nhật value, giữ timestamp | decode lỗi ghi NaN kèm mốc mới | ĐÓNG (`MBA-FW-09`) |
| F-FW-12 `bit_index`, F-FW-14 `min/max` | BE sinh khoá, iobus không đọc; Point bit ghi FC06 đè cả register | ĐÓNG phần đọc; ghi bit bị chặn fail-closed (FC22/RMW là quyết định mở) |
| F-FW-16 slot ổn định | ST/graph ghi theo index | ◐ iobus từ chối phát khi tên slot lệch; binding theo danh tính vẫn **MỞ** (`MBA-GAP-02`) |
| F-FW-06 / F-FW-15 request/result, readback | có mã, không nối | **MỞ** (`MBA-GAP-01`) |
| F-FW-17 `deadline_miss`/`poll_duration` | chưa có | **MỞ** (`MBA-GAP-04`) |
| Đồng thời `FieldbusMetrics` | không khoá — test abort 3/3 | ĐÓNG (`MBA-FW-03`) |

## 13. Test FW-SOM bắt buộc

Cột **Hiện trạng** đối chiếu với test thật trong repo tại `eade4e5`.

| ID | Loại | Nội dung | Hiện trạng |
|---|---|---|---|
| TW-MBRTU-01 | unit | codec golden vector mọi `(type × byte_order × word_order)` gồm giá trị âm/biên | ✅ `test_register_codec.cpp`: `Float32ABCD`, `Float32CDAB`, `Float32BADCAndDCBA`, `EncodeDecodeRoundTripAllOrders`, `Int16Negative` |
| TW-MBRTU-02 | unit | ghi: làm tròn, tràn dải, NaN/Inf, `scale=0` bị từ chối | ✅ `RegisterCodecEncodeGuard.*` — 8 test (`ScaleZeroRejected`, `NonFiniteValueRejected`, `OutOfRangeRejectedPerType`, `InRangeBoundariesAccepted`, `Uint32MaxNotRepresentableInFloatIsRejected`, `ScaleDrivenOverflowRejected`, `RoundingIsNearestTiesAwayFromZero`, `NonFiniteScaleOrOffsetRejected`) |
| TW-MBRTU-03 | unit | scheduler EDF: không đói device khi 1 device timeout liên tục | ✅ `PollSchedulerOfflineProbe.DeadSlavesDoNotStarveHealthyOne`, `ErrorUpdatesLastPollSoDeadSlaveDoesNotSpin` |
| TW-MBRTU-04 | unit | offline probe: device OFFLINE chuyển nhịp chậm, không chiếm bus | ✅ `OfflineSlaveUsesSlowProbeInterval`, `RecoveryRestoresFastInterval` |
| TW-MBRTU-05 | unit | quality state machine bằng fake clock, đủ chuyển trạng thái §6.1 | ❌ chưa có — cần quality 5 mức trước (`MBR-B103`) |
| TW-MBRTU-06 | unit | timestamp không đổi khi chỉ quality xấu đi | ❌ chưa có — cần F-FW-03 |
| TW-MBRTU-07 | unit | gộp block: không xuyên gap, tôn trọng 125/2000 | ❌ chưa có — `MBR-B109` |
| TW-MBRTU-08 | unit | hàng đợi ghi đầy ⇒ `QUEUE_FULL`; coalesce trả `SUPERSEDED` | ❌ chưa có — F-FW-18 |
| TW-MBRTU-09 | integration | bus 1 hỏng không chặn bus 2 và không chặn IOP | ✅ `test_bus_worker.cpp` — một cổng mở được, một cổng chết, worker còn lại vẫn poll. Phần "không chặn IOP" kiểm trên board (T-A4) |
| TW-MBRTU-10 | integration | apply generation mới tại ranh giới transaction, ACK đúng revision/checksum | ❌ chưa có — `MBR-B106` |
| TW-MBRTU-11 | integration | apply lỗi ⇒ giữ generation cũ đang chạy | ❌ chưa có — `MBR-B106` |
| TW-MBRTU-12 | integration | `PORT_DOWN` ⇒ mọi Point trên bus `OFFLINE`, không giữ GOOD | ◐ một phần: `SlaveWithMissingProfileIsNotReportedOnline`, `SlaveWithoutExtCapacityIsNotReportedOnline` phủ nhánh CONFIG_ERROR fail-closed |
| TW-MBRTU-13 | integration | restart iobus ⇒ không có byte ghi nào được phát lại | ◐ một phần: `ModbusMasterWriteLifecycle.*` (3 test) phủ vòng đời trong process; **nhánh restart chưa phủ** (F-FW-07) |
| TW-MBRTU-14 | integration | snapshot drop/reorder phát hiện được bằng `sequence` | ❌ chưa có — F-FW-05 |
| TW-MBRTU-15 | integration | core nạp snapshot ở đầu scan; ảnh nhất quán trong một scan | ❌ chưa có |
| TW-MBRTU-16 | simulator | FC01/02/03/04/05/06/16 + exception + CRC lỗi + timeout qua PTY | ◐ `ModbusMaster.RtuPtyReadWriteAndTimeout` có PTY thật; chưa phủ đủ exception code và CRC lỗi |
| TW-MBRTU-17 | target | 16 device/bus theo capacity, đo deadline miss và poll duration | ❌ chưa có — chặn bởi F-FW-17 (thiếu counter) và cửa sổ bảo trì board |
| **TW-MBRTU-18** | unit | retry thật: `retry_attempts` khác `total_errors`; `offline_after_errors` độc lập | ✅ **mới** — `FieldbusConfig.RetryAndOfflineThresholdAreSeparateFields`, `PerDeviceRetryThreshold` |
| **TW-MBRTU-19** | unit | E303 dùng cửa sổ trượt và re-arm được, không latch vĩnh viễn | ✅ **mới** — `FieldbusMetrics.E303ReArmsAfterCleanWindowWithoutOfflineReset` |

Host/simulator pass **không** đóng gate phần cứng thật (`VR-MBRTU-011`).

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo FW-SOM runtime design: ownership, thread model, scheduler, codec, quality, write path, reload, capacity và 16 gap As-Built |
| 0.2 | 2026-08-05 | In Review | Đối chiếu lại với `eade4e5` sau Track A. **Thay thế:** (a) §2 hai BusWorker → Rev A một worker, giữ kiến trúc *n* worker (Đ-01); (b) §4.1 thêm nhãn As-Built cho EDF/probe/retry và §4.1a tách `retry_count` khỏi `offline_after_errors` (Đ-05); (c) §4.3 thêm luật vòng đời write hữu hạn 3 lần/30 s và hai counter `write_failed`/`write_dropped`; (d) §11 capacity: 1 bus, mục tiêu ≥256 Point kèm bảng tác động ABI (Đ-07), bỏ tham chiếu sai board RK3566; (e) §12 tách thành 12.1 gap còn lại và 12.2 bảy nhóm đã đóng — hạ F-FW-01 xuống P2, hạ F-FW-07 xuống P1 (đóng một phần), thêm F-FW-17..F-FW-20; (f) §13 gắn từng TW-MBRTU với test thật trong repo, thêm TW-MBRTU-18/19 |
| 0.2 (+§12.3) | 2026-09-25 | Active | Thêm §12.3 đối chiếu As-Built theo audit Modbus 2026-09-25; không đổi nội dung thiết kế đã duyệt |
