# Modbus RTU — FW-SOM Runtime Design DDC-24 Rev A

**ID:** DDD-FW-MBRTU-001
**Phiên bản:** 0.1
**Trạng thái:** In Review
**Ngày:** 2026-08-04
**Chủ quản đề xuất:** Fieldbus Lead + Core Lead
**Phạm vi:** `mkddc-iobus` và `mkddc-core` trên SOM. **Không** liên quan STM32/IOP.
**Trace:** `SYS-REQ-MBRTU-001`, `SWR-REQ-MBRTU-004..006`, `SWR-REQ-MBRTU-009`,
`IF-REQ-MBRTU-001..002`, [DDD-DM-MBRTU-001](MODBUS_RTU_DATA_MODEL.md)

> Thiết kế mục tiêu. Sai khác so với source hiện tại ở §12. Không sửa source.

## 1. Ai sở hữu cái gì

| Trách nhiệm | Owner | Lý do |
|---|---|---|
| Mở/đóng cổng serial RS485-1, RS485-2 | `mkddc-iobus` | duy nhất được chạm phần cứng serial |
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
├── thread: fieldbus_rs485_1 SCHED_OTHER  event-driven  — BusWorker 1
├── thread: fieldbus_rs485_2 SCHED_OTHER  event-driven  — BusWorker 2
├── thread: bacnet           SCHED_OTHER                — ngoài phạm vi
└── thread: control          SCHED_OTHER                — nhận config/write qua UDS

mkddc-core (một process)
└── thread: scan_loop        SCHED_FIFO   chu kỳ cấu hình — nạp ext snapshot ở đầu scan
```

Bất biến:

- **Một BusWorker cho một bus.** Không bao giờ có hai luồng cùng phát trên một dây.
- Modbus **không bao giờ** chạy ở SCHED_FIFO và không chia sẻ mutex với `iop_main`.
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
- Deadline mới tính từ `now`, không tính từ deadline cũ ⇒ device chậm không tạo
  chuỗi poll dồn nén sau khi hồi phục.
- Retry chỉ áp cho block đang lỗi. Hết retry ⇒ **nhường bus** cho device khác ngay.
- Device `OFFLINE` chuyển sang probe chậm theo `bus.offline_probe_ms` (mặc định 5 s),
  không giữ nhịp `poll_interval_ms` ⇒ một device chết không ăn hết băng thông.
- Device `DISABLED` hoặc `CONFIG_ERROR` không vào hàng đợi.
- Scheduler đo `deadline_miss` và `poll_duration` thật; **không** âm thầm kéo dài chu kỳ.

### 4.2 Gộp block đọc

Gộp các Point cùng `(device, function code)` có dải register **liền kề**:

- không đọc xuyên khoảng trống (một số slave trả exception hoặc có side effect);
- tối đa 125 register hoặc 2000 bit cho một transaction;
- Point disabled không tham gia gộp.

### 4.3 Ghi

- Hàng đợi ghi **bounded** (mặc định 64 toàn hệ). Đầy ⇒ trả `QUEUE_FULL`, không drop im lặng.
- Ghi cùng `(device, register)` chưa gửi được **coalesce** (giữ giá trị mới nhất, giữ `request_id` mới nhất, trả `SUPERSEDED` cho request cũ).
- Sau khi gửi và có kết quả, request rời hàng đợi vĩnh viễn. **Không replay**
  khi device reconnect, khi BusWorker swap generation, hay khi process restart.

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
| Bus logic | 2 | PROPOSED (xung đột HW — `OD-MBRTU-001`) |
| Device / bus | 16 | PROPOSED |
| Device tổng | 32 | PROPOSED |
| Modbus RTU Point tổng | 64 | **hiện là ràng buộc cứng** `KX_N_EXT = 64` |
| Pending write toàn hệ | 64 | PROPOSED |
| Read block | 125 register / 2000 bit | ràng buộc protocol |
| Buffer cho một BusWorker | ≤ 8 KiB tĩnh | PROPOSED |
| RAM thêm cho fieldbus | ≤ 2 MiB | PROPOSED |
| CPU cho cả hai BusWorker | ≤ 5 % một core RK3566 ở tải danh định | PROPOSED |

Sở hữu bộ nhớ:

- Bảng device/point của một generation được cấp phát **một lần** lúc swap, không
  cấp phát trong vòng poll.
- Không cấp phát động trong đường transaction (buffer tĩnh theo giới hạn protocol).
- `SampleCache` là mảng cố định theo capacity; không có con trỏ chia sẻ ra ngoài
  BusWorker; snapshot được **copy** khi publish.

Vượt capacity ⇒ **reject rõ** ở tầng validate của web. iobus gặp cấu hình vượt
capacity (do file bị sửa tay) phải `CONFIG_ERROR` fail-closed, không truncate.

## 12. Sai khác so với source hiện tại

| ID | Thiết kế | As-Built | Mức | Bằng chứng |
|---|---|---|---|---|
| F-FW-01 | 2 BusWorker độc lập | 1 `ModbusMaster`, 1 `modbus_t*`, 1 `rs485.device` | P0 | `modbus_master.cpp:53`, `fieldbus_config.hpp:35-40` |
| F-FW-02 | quality 5 mức + reason | `kx_quality_t{GOOD,UNCERTAIN,BAD}` + cờ `online` | P0 | `contracts/shm/mkddc_shm.h:73` |
| F-FW-03 | sample có timestamp producer | `kx_ext_point_t` không có trường timestamp | P0 | `mkddc_shm.h:183-189` |
| F-FW-04 | value typed (double) | `float value` | P0 | như trên |
| F-FW-05 | snapshot có sequence/generation/revision/checksum | `kx_ext_snapshot_msg_t` chỉ có magic + points | P0 | `mkddc_shm.h:255-262` |
| F-FW-06 | write qua request/result có `request_id` | `plc_shm.ext[i].dirty/setpoint`, không có kết quả trả về | P0 | `modbus_master.cpp:170-239` |
| F-FW-07 | không replay | `drain_ext_writes` so `last_written_` để chống lặp, nhưng cờ `dirty` còn thì vẫn phát lại sau restart | P0 | `modbus_master.cpp:206-208` |
| F-FW-08 | scheduler EDF + probe chậm cho OFFLINE | `sleep_ms_until_next` lấy min deadline; device lỗi vẫn giữ nhịp `poll_interval_ms` | P1 | `modbus_master.cpp:241-250` |
| F-FW-09 | admission/utilization | không tính | P1 | không có mã tương ứng |
| F-FW-10 | config reload tại ranh giới transaction | web `systemctl restart mkddc-iobus` | P0 | `reloadhelper_linux.go:43` |
| F-FW-11 | identity là `point_id` mọi trường hợp | `ext_point_name()` trả `point.name` khi 1 slot, ngược lại `<slave>.<point>[i]` | P1 | `modbus_master.cpp:23-32` |
| F-FW-12 | bit_index | không hỗ trợ | P1 | `device_profile.hpp` không có trường |
| F-FW-13 | counter uint64 + boot id | `FieldbusMetrics` uint32 theo slave, không boot id | P1 | `fieldbus_metrics.hpp` |
| F-FW-14 | `min/max` engineering ở producer | không có | P1 | |
| F-FW-15 | readback sau write | không có | P1 | |
| F-FW-16 | slot mapping ổn định theo generation | device lỗi cấu hình không cấp slot ⇒ base index của device sau dịch chuyển | P2 | `modbus_master.cpp:88-135` |

**Điểm đã đúng và cần giữ:** fail-closed cho `slave_config_error_` (device thiếu
profile / hết slot **không** được báo ONLINE, có alarm E302) là hành vi đúng và
phải được giữ nguyên trong thiết kế mới; `ext_slots_for_point()` là nguồn chân lý
duy nhất cho việc đếm slot; fieldbus chạy priority thường và không chặn IOP.

## 13. Test FW-SOM bắt buộc

| ID | Loại | Nội dung |
|---|---|---|
| TW-MBRTU-01 | unit | codec golden vector mọi `(type × byte_order × word_order)` gồm giá trị âm/biên |
| TW-MBRTU-02 | unit | ghi: làm tròn, tràn dải, NaN/Inf, `scale=0` bị từ chối |
| TW-MBRTU-03 | unit | scheduler EDF: không đói device khi 1 device timeout liên tục |
| TW-MBRTU-04 | unit | offline probe: device OFFLINE chuyển nhịp chậm, không chiếm bus |
| TW-MBRTU-05 | unit | quality state machine bằng fake clock, đủ 6 chuyển trạng thái §6.1 |
| TW-MBRTU-06 | unit | timestamp không đổi khi chỉ quality xấu đi |
| TW-MBRTU-07 | unit | gộp block: không xuyên gap, tôn trọng 125/2000 |
| TW-MBRTU-08 | unit | hàng đợi ghi đầy ⇒ `QUEUE_FULL`; coalesce trả `SUPERSEDED` |
| TW-MBRTU-09 | integration | hai BusWorker: bus 1 hỏng không chặn bus 2 và không chặn IOP |
| TW-MBRTU-10 | integration | apply generation mới tại ranh giới transaction, ACK đúng revision/checksum |
| TW-MBRTU-11 | integration | apply lỗi ⇒ giữ generation cũ đang chạy |
| TW-MBRTU-12 | integration | `PORT_DOWN` ⇒ mọi Point trên bus `OFFLINE`, không giữ GOOD |
| TW-MBRTU-13 | integration | restart iobus ⇒ không có byte ghi nào được phát lại |
| TW-MBRTU-14 | integration | snapshot drop/reorder phát hiện được bằng `sequence` |
| TW-MBRTU-15 | integration | core nạp snapshot ở đầu scan; ảnh nhất quán trong một scan |
| TW-MBRTU-16 | simulator | FC01/02/03/04/05/06/16 + exception + CRC lỗi + timeout qua PTY |
| TW-MBRTU-17 | target | 16 device/bus theo capacity, đo deadline miss và poll duration |

Host/simulator pass **không** đóng gate phần cứng thật (`VR-MBRTU-011`).

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo FW-SOM runtime design: ownership, thread model, scheduler, codec, quality, write path, reload, capacity và 16 gap As-Built |
