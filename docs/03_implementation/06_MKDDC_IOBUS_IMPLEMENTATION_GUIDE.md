# 06 — mkddc-iobus Implementation Guide
## MK-DDC-24 — Master UART/IOP + Modbus/BACnet datalink

> **Document ID:** IMPL-IOBUS-MK-DDC-24-VI
> **Phiên bản:** 1.4 | 2026-06-13 (liên kết S7 #5/#6: BACnet plan 24, Modbus plan 25) · 1.3 | 2026-06-12 (§10: unit file thật packaging/systemd/mkddc-iobus.service — SKEL-005; ghi chú iobus chưa handle SIGHUP) · 1.2 | 2026-06-11 (Contract Freeze: SHM path/ownership chốt, scaling table, startup table, build/systemd đầy đủ)
> **Owner:** Dev 2 (SOM)
> **Nguồn-chuẩn CUỐI CÙNG:** [`shared/iop_protocol.h`](../../shared/iop_protocol.h) (protocol) +
> [`shared/mkddc_shm.h`](../../shared/mkddc_shm.h) (SHM layout/path/ownership) — docs lệch header
> → **header thắng** ([15_CONTRACT_FREEZE](15_CONTRACT_FREEZE.md)). Diễn giải:
> [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) ·
> [ADR-005](../adr/ADR-005-three-process-architecture.md) · [05_IOP_UART](05_IOP_UART_IMPLEMENTATION_GUIDE.md)

> 🎯 Vai trò: **người đưa thư UART**. iobus POLL MCU, PARSE, GỬI lệnh đã được core quyết,
> BÁO lỗi. **iobus KHÔNG quyết định logic relay/AO** — đó là việc của `mkddc-core`.

> 📖 File này mô tả **toàn bộ service mkddc-iobus** (đủ để dựng từ zero). Phần protocol thuần
> (frame/CRC/SEQ/state machine/API IOP) ở [05_IOP_UART](05_IOP_UART_IMPLEMENTATION_GUIDE.md) —
> đọc 05 trước, 06 là lớp service bọc quanh nó.

---

## 1. Service responsibility boundary

```
mkddc-iobus CHỈ làm:
- giao tiếp MCU qua UART/IOP (master, poll 100Hz)
- scale raw IO → engineering value
- ghi IO state cho core (kx_io_shm, seqlock writer)
- đọc output command từ core (ao_setpoint/do_cmd) và gửi SET_DO/SET_AO xuống MCU
- (S7 #6) Modbus RTU master poll → ext cache; xem [25_MODBUS_IMPLEMENTATION_PLAN](25_MODBUS_IMPLEMENTATION_PLAN.md)
- (S7 #5) BACnet/IP datalink/object callbacks; xem [24_BACNET_IMPLEMENTATION_PLAN](24_BACNET_IMPLEMENTATION_PLAN.md)
- expose metrics + publish alarm

mkddc-iobus KHÔNG làm:
- KHÔNG chạy control logic (PID/interlock/schedule)
- KHÔNG tự quyết relay/AO theo nghiệp vụ
- KHÔNG nhận command trực tiếp từ web
- KHÔNG bypass priority resolver của core
- KHÔNG lưu business rule / graph
```

---

## 2. Cây thư mục chuẩn (cuối cùng)

```
services/iobus/
├── CMakeLists.txt
├── README.md
├── main.cpp                    — entry: init → load config → shm → UART → loops → signal → sd_notify
├── config/
│   ├── iobus_config.hpp        — struct config + default
│   └── iobus_config.cpp        — load/parse JSON, validate, fallback
├── iop/                        — TẦNG PROTOCOL (hợp đồng 05)
│   ├── iop_port.hpp/.cpp       — mở/cấu hình /dev/ttyS2, read/write raw
│   ├── iop_frame.hpp/.cpp      — build/parse frame
│   ├── iop_crc.hpp/.cpp        — CRC-16/Modbus (wrap iop_crc16)
│   ├── iop_client.hpp/.cpp     — state machine master + timeout/retry + SEQ
│   └── iop_parser.hpp/.cpp     — IO_RESP/DIAG_RESP → struct
├── io/
│   ├── io_types.hpp            — IopIoResp, point types nội bộ
│   ├── io_scaling.hpp/.cpp     — raw ↔ engineering (per sensor_type)
│   └── io_cache.hpp/.cpp       — writer seqlock kx_io_shm
├── bridge/
│   ├── core_bridge.hpp/.cpp    — ranh giới shm với core (đọc output, ghi input)
│   └── output_command.hpp/.cpp — phát hiện đổi → SET_DO/SET_AO
├── diagnostics/
│   ├── iobus_metrics.hpp/.cpp  — counters
│   └── alarm_publisher.hpp/.cpp— /run/mkddc/alarm.sock JSON lines
├── platform/
│   ├── systemd_notify.hpp/.cpp — sd_notify READY/WATCHDOG
│   └── realtime.hpp/.cpp       — SCHED_FIFO, mlockall, CPU affinity
├── fieldbus/                   — S7 #6: Modbus RTU master, xem doc 25
│   ├── modbus_master.hpp/.cpp
│   ├── fieldbus_config.hpp/.cpp
│   ├── device_profile.hpp/.cpp
│   ├── poll_scheduler.hpp/.cpp
│   ├── register_codec.hpp/.cpp
│   └── ext_cache.hpp/.cpp
├── bacnet/                     — S7 #5: BACnet/IP server/callbacks, xem doc 24
│   ├── bacnet_server.hpp/.cpp
│   ├── bacnet_config.hpp/.cpp
│   ├── bacnet_objects.hpp/.cpp
│   ├── bacnet_priority.hpp/.cpp
│   ├── bacnet_cov.hpp/.cpp
│   └── bacnet_reliability.hpp/.cpp
└── tests/
    ├── test_iop_crc.cpp
    ├── test_iop_frame.cpp
    ├── test_iop_parser.cpp
    ├── test_io_scaling.cpp
    ├── test_output_command.cpp
    └── test_iop_client_fake_mcu.cpp   — integration với tools/fake_mcu
```
> Rev A Phase 3 bắt buộc: config + iop/* + io/* + bridge/* + diagnostics/* + platform/* + tests/*.
> S7 #5/#6 mở rộng thêm `bacnet/*` và `fieldbus/*` theo docs 24/25; vẫn giữ rule iobus không quyết output.

---

## 3. Module contract (đầy đủ 13 module)

Format mỗi module: **File / Owner / Responsibility / Input / Output / Public API / Internal data /
Error handling / Logs / Unit test / Integration test / Done when.**

### 3.1 `iop_port`
```
File: iop/iop_port.{hpp,cpp} | Owner: Dev2
Responsibility: mở/cấu hình UART, read/write byte thô (KHÔNG biết frame).
Input: dev path, baud. | Output: fd, số byte read/write.
Public API: bool open(const std::string& dev,int baud); void close();
            ssize_t read(uint8_t* buf,size_t n); ssize_t write(const uint8_t* buf,size_t n);
            void flush();
Internal: int fd_; struct termios saved_;
Error: open fail → false + errno; EINTR → retry; EAGAIN (nonblock) → 0.
Logs: INFO iop.open dev=.. baud=.. ; ERROR iop.open_fail errno=..
Unit test: (mock fd / pty loopback) cấu hình termios đúng.
Integration: loopback ttyUSB → ghi=đọc.
Done: mở 921600 8N1 không mất byte; flush sạch buffer.
```
### 3.2 `iop_frame`
```
File: iop/iop_frame.{hpp,cpp} | Owner: Dev2
Responsibility: build frame từ (cmd,seq,payload); parse stream → frame; verify SOF/LEN/CRC.
Input: cmd/seq/payload (build); byte stream (parse). | Output: bytes; ParsedFrame{cmd,seq,payload,ok,err}.
Public API: size_t build(uint8_t cmd,uint8_t seq,const uint8_t* p,uint8_t len,uint8_t* out);
            ParseResult feed(const uint8_t* buf,size_t n,ParsedFrame* out);
Internal: ring buffer accumulate; trạng thái tìm SOF/LEN.
Error: SOF sai → skip byte; LEN>MAX → err BAD_LEN; CRC sai → err CRC_FAIL.
Logs: (không log mỗi frame) parse error rate-limited.
Unit test: test_iop_frame.cpp — round-trip build→feed; GET_IO SEQ=1 → AA 00 01 01 AC E1.
Done: parse đúng frame ghép từ nhiều chunk; mọi negative §15(05) đúng.
```
### 3.3 `iop_crc`
```
File: iop/iop_crc.{hpp,cpp} | Owner: Dev2
Responsibility: CRC-16/Modbus, wrap iop_crc16 từ shared header (KHÔNG tự viết khác).
Public API: uint16_t crc16(const uint8_t* d,size_t n);
Unit test: test_iop_crc.cpp — 12 vector chuẩn (SWFW spec §10.1 / 15_CONTRACT_FREEZE §5);
          2 vector đầu: {AA 00 01 00}→0x6C20, {AA 00 01 01}→0xACE1.
Done: khớp MCU 12/12 vector.
```
### 3.4 `iop_client`
```
File: iop/iop_client.{hpp,cpp} | Owner: Dev2
Responsibility: state machine master (§13 của 05): handshake/poll/timeout/retry/SEQ/reconnect.
Input: timer tick, response frames. | Output: lệnh ra; IopStatus; IopResult.
Public API: §11.1 của 05 (iop_open/handshake/get_io/set_do/set_ao/set_ao_cfg/get_diag/reset_io/status).
Internal: uint8_t seq_; IopStatus status_; retry counters; last_io_resp_ts.
Error: timeout→retry≤3→FAULT; SEQ mismatch→drop; NACK→theo §7(05).
Logs: state transition (INFO); fault (ERROR); poll error rate-limited (WARN).
Unit test/integration: test_iop_client_fake_mcu.cpp với tools/fake_mcu (§11).
Done: handshake pass; 1000 GET_IO 0 lỗi; recover sau rút UART.
```
### 3.5 `iop_parser`
```
File: iop/iop_parser.{hpp,cpp} | Owner: Dev2
Responsibility: IO_RESP(34B)/DIAG_RESP(20B) → struct (chưa scale).
Public API: bool parse_io(const uint8_t* p,IopIoResp* o); bool parse_diag(const uint8_t* p,IopDiagResp* o);
Error: len≠34/20 → false.
Unit test: test_iop_parser.cpp — byte layout §6(05) đúng, BE đúng.
Done: ui_raw/di/fault/sample_cnt khớp byte offset.
```
### 3.6 `io_scaling`
```
File: io/io_scaling.{hpp,cpp} | Owner: Dev2
Responsibility: raw s24 ↔ engineering theo sensor_type (bảng dưới); eng→raw AO.
Public API: float ui_to_eng(int32_t raw_s24,SensorType t,kx_quality_t* q_out);
            uint16_t ao_eng_to_raw(float v,AoMode m);
            (raw uint24 BE → s24: dùng iop_s24() trong shared/iop_protocol.h)
Error: |raw|>110%FS → quality=BAD + đánh dấu UI_OV (MCU cũng tự set bit2); clamp AO [0,65535].
Unit test: test_io_scaling.cpp — bảng test case dưới, sai số ±1%.
Done: mọi sensor_type đúng theo bảng; eng→raw clamp đúng.
```

#### Bảng scaling chuẩn Rev A (nguồn công thức: SW_ARCH_SPEC §4 — không tự chế hệ số khác)

Raw input: `raw_s24` = s24 two's complement (sign-extend từ uint24 BE bằng `iop_s24()`),
full-scale dương `FS = 8388607`.

| `sensor_type` (config) | Công thức raw → eng | Unit ghi vào `ui_unit` | Dải hợp lệ (eng) | Invalid/quality |
|------------------------|---------------------|------------------------|-------------------|-----------------|
| `0-10V` | `V = raw_s24/8388607.0 × 10.0` | `"V"` | 0..10.5 V | >110%FS hoặc <-2%FS → BAD |
| `4-20mA` | `mA = 4.0 + raw_s24/8388607.0 × 16.0` | `"mA"` | 3.5..21 mA | <3.5mA (đứt loop) → BAD |
| `PT100` | CVD ngược (IEC 60751): `R = R0(1 + A·T + B·T²)`, R0=100Ω → giải T | `"degC"` | -50..200 °C | R ngoài dải tương ứng → BAD |
| `PT1000` | CVD như trên, R0=1000Ω | `"degC"` | -50..200 °C | nt |
| `NTC10K` | Steinhart-Hart: `1/T_K = A + B·ln(R) + C·ln(R)³` | `"degC"` | -30..70 °C | R≤0 / T ngoài dải → BAD |
| `NTC20K` | S-H như trên, R0=20kΩ | `"degC"` | -30..70 °C | nt |
| `dry-contact` | `raw_s24 > threshold → 1.0, else 0.0` | `""` | 0/1 | — |

Hằng số (CHÉP ĐÚNG, không gõ lại từ trí nhớ):
```
CVD (IEC 60751):       A = 3.9083e-3, B = -5.775e-7  (C = -4.183e-12 chỉ dùng khi T<0°C)
Steinhart-Hart β=3950: A = 1.129e-3,  B = 2.341e-4,  C = 8.76e-8   (T_K → °C: trừ 273.15)
R_from_raw():          phụ thuộc mạch front-end (divider/excitation, IO_UI §3.x) —
                       implement thành hàm riêng + đo calib thật ở Phase bring-up;
                       Phase 0-2 (fake MCU) chỉ cần 0-10V/4-20mA/dry-contact.
```
AO eng→raw (theo `ao_mode` ĐÃ áp dụng):
```
0-10V : raw = clamp(V/10.0, 0, 1) × 65535
4-20mA: raw = clamp((mA-4.0)/16.0, 0, 1) × 65535     (raw 0 = 4mA — IOP_AO_SAFE_CURR_RAW=0)
```
Test case bắt buộc (test_io_scaling.cpp):
```
0-10V : raw=0→0.0V; raw=8388607→10.0V; raw=4194304→~5.0V (±1%)
4-20mA: raw=0→4.0mA; raw=8388607→20.0mA
UI_OV : raw=9300000 (>110%FS) → quality=BAD
AO    : 5.0V→32767±1; 12.0V→65535 (clamp); -1V→0 (clamp); 4mA→0; 20mA→65535
dry   : raw>thr→1.0; raw≤thr→0.0
```
### 3.7 `io_cache`
```
File: io/io_cache.{hpp,cpp} | Owner: Dev2
Responsibility: writer seqlock kx_io_shm (ghi IO input + metrics + status).
Public API: bool attach(); void write_io(const IoSnapshot& s);
Internal: kx_io_shm_t* shm_; mmap.
Error: shm attach fail → service fail (ERROR). ts_ns luôn tăng (freshness).
Logs: INFO io_cache.attached; ERROR io_cache.attach_fail.
Unit test: reader test đọc nhất quán (không nửa-ghi).
Done: reader (core/test) đọc đúng qua seqlock.
```
### 3.8 `core_bridge`
```
File: bridge/core_bridge.{hpp,cpp} | Owner: Dev2
Responsibility: ranh giới với core qua shm — đọc field core ghi (ao_setpoint/do_cmd), expose cho output_command.
Public API: void read_outputs(float ao_sp[4],uint8_t do_cmd[4]);
Done: thấy giá trị core ghi sau mỗi scan core.
```
### 3.9 `output_command`
```
File: bridge/output_command.{hpp,cpp} | Owner: Dev2
Responsibility: phát hiện output đổi → build & gửi SET_DO/SET_AO; xử lý ACK/NACK.
Input: ao_setpoint/do_cmd (qua core_bridge). | Output: SET_* qua iop_client.
Internal: last_sent_ao[4], last_sent_do[4] (chỉ gửi khi CHANGED).
Error: NACK ERR_SAFE_STATE → giữ, báo; timeout → retry≤3 → fault.
Logs: INFO output.set_do mask=.. value=.. ack=ok ; ERROR output.set_do_fail.
Unit test: test_output_command.cpp — đổi do_cmd → đúng 1 SET_DO; không đổi → không gửi.
Integration: ghi do_cmd[0]=1 → relay đóng (board/fake).
Done: gửi đúng khi đổi, idempotent khi không đổi.
```
### 3.10 `iobus_metrics`
```
File: diagnostics/iobus_metrics.{hpp,cpp} | Owner: Dev2
Responsibility: counters (§8) ghi vào shm + expose cho web.
Public API: void inc(MetricId); Snapshot snapshot();
Done: /system/status (web) đọc đúng; counters tăng theo sự kiện.
```
### 3.11 `alarm_publisher`
```
File: diagnostics/alarm_publisher.{hpp,cpp} | Owner: Dev2
Responsibility: publish alarm JSON lines lên /run/mkddc/alarm.sock.
Public API: void publish(const Alarm& a);
Error: socket chưa có subscriber → buffer/drop có log (không block poll).
Done: rút UART → IOP_TIMEOUT alarm phát ra (§9).
```
### 3.12 `systemd_notify`
```
File: platform/systemd_notify.{hpp,cpp} | Owner: Dev2
Responsibility: sd_notify READY=1 (sau handshake) + WATCHDOG=1 (mỗi <WatchdogSec/2).
Public API: void ready(); void watchdog_kick();
Done: systemd thấy service ready; watchdog không bị kill oan.
```
### 3.13 `realtime`
```
File: platform/realtime.{hpp,cpp} | Owner: Dev2
Responsibility: SCHED_FIFO prio≥70, mlockall, (tùy) CPU affinity cho poll thread.
Public API: bool set_rt(int prio); bool lock_mem();
Error: thiếu CAP_SYS_NICE → log WARN, chạy SCHED_OTHER (degraded).
Done: poll thread SCHED_FIFO 70; jitter <2ms.
```

### 3.14 `modbus_tcp` — MỚI (MOD-013)

> **Trạng thái:** PLANNED — chờ owner approve SW_FIELDBUS_DESIGN §12.
> Spec đầy đủ: [SW_FIELDBUS_DESIGN §12](../02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md).

```
File: fieldbus/modbus_tcp.{hpp,cpp} | Owner: Dev2
Responsibility: Modbus TCP client — libmodbus TCP context, persistent connection,
                reconnect state machine, poll loop integration với PollScheduler.
Public API:
  bool open(const TcpSlaveConfig& cfg)
  void close()
  bool poll_once(uint16_t addr, int fc, int count, uint16_t* regs_out)
  bool write_once(uint16_t addr, int fc, const uint16_t* data, int count)
  bool is_connected() const
  void reconnect_if_needed()
Dependency: libmodbus (cùng flag MKDDC_ENABLE_MODBUS với RTU), ExtCache, PollScheduler
Error: TCP connect fail → DISCONNECTED → ext_cache quality BAD → fallback active
       Reconnect sau reconnect_s; không block RTU poll loop
Done: FC03 read OK từ diagslave TCP; disconnect → quality BAD → reconnect → GOOD.
      12 unit test (DoD MOD-013 §12.8 tick đủ).
```

---

## 4. Config schema

iobus đọc config (JSON) theo thứ tự ưu tiên: CLI `--config` > `/data/config/iobus.conf` >
default built-in. Sensor/AO mode lấy thêm từ `/data/config/io_config.conf`; Modbus từ
`/data/config/fieldbus.conf` (Phase 3+).

```json
// /data/config/iobus.conf
{
  "iop": {
    "uart_device": "/dev/ttyS2",
    "baud": 921600,
    "poll_period_ms": 10,
    "response_timeout_ms": 10,
    "max_retry": 3,
    "reconnect_interval_ms": 5000,
    "handshake_timeout_ms": 1000
  },
  "ui": [
    { "id": "UI1", "sensor_type": "0-10V",  "unit": "V" },
    { "id": "UI2", "sensor_type": "NTC10K", "unit": "degC" }
  ],
  "ao": [
    { "id": "AO1", "mode": "0-10V" },
    { "id": "AO2", "mode": "4-20mA" }
  ],
  "log_level": "info",
  "rt_priority": 70
}
```

**Quy tắc fallback / lỗi config:**

| Tình huống | Hành vi |
|------------|---------|
| Thiếu file config | dùng default built-in (uart_device=/dev/ttyS2, baud=921600, poll=10ms, retry=3); log WARN |
| Thiếu field lẻ | dùng default field đó; log WARN field=.. |
| `sensor_type` không nhận ra | UI đó quality=BAD, không scale; log ERROR; service VẪN chạy |
| `uart_device` không mở được | log ERROR; vào FAULT/RECONNECT (không exit ngay, retry) |
| JSON sai cú pháp | **service fail-fast** (exit code 1) + log ERROR — không đoán mò config |
| `baud` ≠ 921600 | cho phép override (dev mode) nhưng log WARN (board thật chỉ 921600) |

---

## 5. Shared memory / core bridge

**Chốt Rev A (Contract Freeze):** path duy nhất `/dev/shm/mkddc_io_shm`, struct `kx_io_shm_t`
([`shared/mkddc_shm.h`](../../shared/mkddc_shm.h)), magic `KX_SHM_MAGIC=0x4B584401` (giữ nguyên
qua rename — KHÔNG đổi). **Creator = iobus** (`O_CREAT`, ftruncate đúng `sizeof(kx_io_shm_t)`,
memset 0 + init default + set magic CUỐI CÙNG); core/web chỉ attach (retry tới khi magic đúng).
Không có alias `/dev/shm/kinexus_*`.

**Bảng ownership chuẩn duy nhất** (mỗi field đúng 1 writer):

| Field (`kx_io_shm_t`) | Writer | Reader | Unit | Update rate | Stale condition (reader xử lý) | Default/reset |
|------------------------|--------|--------|------|-------------|-------------------------------|----------------|
| `magic` | iobus (1 lần) | tất cả | — | init | ≠`KX_SHM_MAGIC` → chưa sẵn sàng, retry attach | 0 → magic |
| `seq` | iobus | tất cả | — | 2×/vòng ghi | lẻ/đổi giữa chừng → đọc lại | 0 |
| `ts_ns` | iobus | core/web | ns (CLOCK_MONOTONIC) | mỗi vòng poll 10ms (kể cả giá trị không đổi) | không tăng >3 chu kỳ reader → UNCERTAIN→BAD | 0 |
| `ui_value[8]` | iobus | core/web | theo `ui_unit` (V/mA/°C) | 10ms | theo `ts_ns` + `ui_quality` | 0.0 |
| `ui_quality[8]` | iobus | core/web | `kx_quality_t` | 10ms | — | BAD (chưa có mẫu) |
| `ui_unit[8][8]` | iobus | core/web | chuỗi "V","mA","degC","" | khi load config | — | "" |
| `di_state[8]` | iobus | core/web | 0/1 | 10ms | theo `ts_ns` | 0 |
| `di_counter[8]` | iobus | core/web | đếm cạnh lên | 10ms | — | 0 |
| `ao_setpoint[4]` | **core** | iobus/web | eng (V hoặc mA theo `ao_mode`) | mỗi scan core 1s | iobus: dùng giá trị cuối, không stale-check (core chết → core tự lo safe trước khi chết; watchdog systemd restart) | safe (0V/4mA) |
| `ao_mode[4]` | **iobus** | core/web | 0=0-10V, 1=4-20mA | sau ACK SET_AO_CFG | — | 0 (0-10V — default MCU boot) |
| `do_cmd[4]` | **core** | iobus/web | 0/1 | mỗi scan core | như `ao_setpoint` | 0 (open) |
| `do_feedback[4]` | iobus | core/web | 0/1 (DO_FB_MASK) | 10ms | theo `ts_ns` | 0 |
| `fault_flags` | iobus | core/web | bitmask `IOP_FAULT_*` (mirror nguyên xi) | 10ms | — | 0 |
| `iop_status` | iobus | core/web | `kx_iop_status_t` | khi đổi state | — | FAULT (chưa handshake) |
| `mcu_temp_x10` | iobus | core/web | 0.1°C | 10ms | — | 0 |
| `iop_rx/crc_err/timeout/seq_err` | iobus | web | đếm | khi sự kiện | — | 0 (reset khi iobus restart) |

**Map `iop_status` (state machine 05 §13 → `kx_iop_status_t`):**
`NORMAL_POLL→NORMAL` · `INIT/OPEN_UART/HANDSHAKE/CONFIG_AO/FAULT/RECONNECT→FAULT` · `SAFE_STATE→SAFE`.

**Rule:**
```
- Seqlock: KX_WRITE_BEGIN(shm) → ghi field → KX_WRITE_END(shm). Reader retry khi seq lẻ/đổi.
- iobus CHỈ ghi field "Writer=iobus". ao_setpoint/do_cmd là Writer=core → iobus READ-ONLY.
  (Ngoại lệ init: BOOT SẠCH (magic chưa hợp lệ) iobus memset 0 toàn struct trước khi set
  magic. RESTART (magic đã hợp lệ = core có thể đang chạy): iobus PHẢI giữ nguyên
  ao_setpoint[]/do_cmd[] qua re-init — không được wipe field của core.)
- ts_ns cập nhật MỖI vòng poll (kể cả khi giá trị không đổi) → core phát hiện stale.
- Stale detection (core side): ts_ns không tăng > 3 chu kỳ scan core → quality UNCERTAIN→BAD.
- Quality rule: iop_status=FAULT/SAFE → toàn bộ ui_quality=BAD;
  fault_flags có IOP_FAULT_ADC → ui_quality=BAD; IOP_FAULT_UI_OV → kênh vượt dải = BAD.
- Timestamp: dùng CLOCK_MONOTONIC (không wall clock) để miễn nhiễm chỉnh giờ.
- ao_setpoint là GIÁ TRỊ ENGINEERING (V/mA); iobus convert eng→raw bằng ao_mode ĐÃ áp dụng.
```

---

## 6. Thread model

```
main thread:
  - parse CLI + load config (fail-fast nếu JSON sai)
  - attach/create shm; init metrics; open alarm socket
  - realtime.set_rt(70) + lock_mem()
  - iop_port.open(); start poll/output/diag loops
  - install signal handler (SIGTERM/SIGINT → graceful stop)
  - systemd_notify.ready() sau handshake OK
  - chờ shutdown; join loops; close UART; detach shm

poll loop (RT, prio 70, timer 10ms tuyệt-đối):
  - iop_client.get_io() → parse → io_scaling → io_cache.write_io()
  - systemd_notify.watchdog_kick() (mỗi <WatchdogSec/2)
  - KHÔNG block > ~2ms; KHÔNG I/O file/log chặn trong loop

output handling: chạy NGAY trong poll loop sau write_io (cùng thread, tránh tranh chấp UART):
  - core_bridge.read_outputs() → output_command (gửi SET_* nếu CHANGED) → chờ ACK
  - (giữ 1 owner duy nhất cho UART = poll thread → không cần lock UART)

diagnostics loop (non-RT, prio thấp, 1s):
  - iop_client.get_diag() → metrics → alarm_publisher nếu vượt ngưỡng
  - (chèn vào khe giữa các GET_IO, không cướp UART giữa chừng)
```

**Quy tắc thread:**
```
- UART có 1 OWNER duy nhất (poll thread). diagnostics gửi GET_DIAG qua hàng đợi lệnh của
  poll thread, KHÔNG mở UART song song → tránh xen frame.
- Data ownership: io_cache là writer shm duy nhất. metrics counter atomic.
- Lock: chỉ mutex cho metrics snapshot (web đọc); KHÔNG lock trong hot-path ghi shm (seqlock).
- Poll loop không block quá 2ms; mọi thao tác chậm (log file, alarm socket) async/rate-limit.
```

---

## 7. Logging standard

Dùng journald (stderr) + level. Format: `LEVEL  domain.event key=value ...`

```
INFO  iobus.start version=1.1.0 pid=1234
INFO  iop.open dev=/dev/ttyS2 baud=921600
INFO  iop.handshake mcu_iop=1.1 mcu_fw=1.0 status=ok
INFO  output.set_do mask=0x01 value=0x01 ack=ok
WARN  iop.crc_error seq=12 count=3          (rate-limited)
ERROR iop.timeout cmd=GET_IO seq=44 retry=3
ERROR iop.fault reason=MCU_TIMEOUT action=SAFE_STATE
INFO  iop.reconnect attempt=2
```

**Rule:**
```
- KHÔNG log INFO mỗi chu kỳ 10ms (sẽ spam). Poll bình thường = im lặng.
- Lỗi lặp (CRC/timeout) → rate-limit (vd tối đa 1 log/giây + count tổng).
- Command output (SET_DO/SET_AO) → log INFO/DEBUG (phục vụ audit/đối soát với core).
- Fault / state transition → ERROR/INFO (luôn log, không rate-limit transition).
- log_level config: error|warn|info|debug. Production = info.
```

---

## 8. Metrics schema

| Metric | Kiểu | Nguồn | Reset |
|--------|------|-------|-------|
| `iop_rx_count` | u32 | frame nhận hợp lệ | boot |
| `iop_tx_count` | u32 | frame gửi | boot |
| `iop_crc_error_count` | u32 | CRC fail | boot |
| `iop_seq_error_count` | u32 | SEQ mismatch | boot |
| `iop_timeout_count` | u32 | timeout (sau retry) | boot |
| `iop_retry_count` | u32 | lần retry | boot |
| `iop_nack_count` | u32 | NACK nhận | boot |
| `last_io_resp_ms` | u32 | tuổi IO_RESP cuối (ms) | rolling |
| `last_valid_sample_cnt` | u16 | SAMPLE_CNT cuối (phát hiện hang) | rolling |
| `mcu_temp_x10` | i16 | từ IO_RESP | rolling |
| `mcu_fault_flags` | u16 | FAULT_FLAGS | rolling |
| `iop_status` | enum | NORMAL/FAULT/SAFE | rolling |
| `service_uptime_s` | u32 | uptime iobus | boot |

**Nơi chứa:**
```
- shm (kx_io_shm.iop_rx/crc_err/timeout/seq_err)   → core/web đọc nhanh
- /api/v1/system/status (web đọc từ shm)           → người dùng
- journald log (khi đổi đáng kể)                    → debug
- alarm bus (chỉ khi vượt ngưỡng critical)          → cảnh báo
```

---

## 9. Alarm events

**Transport (chốt Rev A):** Unix **datagram** socket. **Subscriber (mkddc-web) là server**
(bind `/run/mkddc/alarm.sock`); iobus là client `sendto()` non-blocking từng dòng JSON.
Chưa có subscriber → iobus drop + đếm (không buffer, không block poll). Mọi alarm LUÔN
được log song song ra journald nên không mất dữ liệu khi web chưa chạy.

**Format** (JSON lines, `/run/mkddc/alarm.sock`):
```json
{
  "ts": "2026-06-10T10:00:00Z",
  "source": "mkddc-iobus",
  "code": "IOP_TIMEOUT",
  "severity": "critical",
  "message": "MCU not responding after 3 retries",
  "data": { "uart": "/dev/ttyS2", "timeout_count": 12 }
}
```

| Code | Severity | Khi nào | Clear khi |
|------|----------|---------|-----------|
| `IOP_INIT_FAIL` | critical | handshake fail sau 3 retry | handshake OK |
| `IOP_TIMEOUT` | critical | GET_IO timeout sau retry → FAULT | IO_RESP hợp lệ trở lại |
| `IOP_CRC_ERROR_RATE_HIGH` | warning | crc_err rate vượt ngưỡng (vd >5/s) | rate về bình thường |
| `IOP_SEQ_MISMATCH` | warning | seq_err tăng bất thường | ổn định |
| `MCU_FAULT_FLAGS` | warning/critical | FAULT_FLAGS ≠ 0 (theo bit) | flags=0 |
| `MCU_OVERTEMP` | critical | bit MCU_OVERTEMP | nhiệt giảm |
| `MCU_WATCHDOG_RESET` | critical | bit MCU_WATCHDOG_RESET (sticky) | SOM đọc/clear |
| `RELAY_STUCK` | critical | bit RELAY_STUCK | feedback khớp lại |

> Severity map sang hiển thị web tiếng Việt (xem [08_WEB §8](08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md)).

---

## 10. Build / install / run

**Test framework chốt Rev A: GoogleTest (gtest)** — fetch qua CMake `FetchContent`
(board không cần gtest, chỉ dev/CI). Toolchain: g++ ≥ 10, C++17.

**`services/iobus/CMakeLists.txt` mẫu (copy được, build ngay):**
```cmake
cmake_minimum_required(VERSION 3.16)
project(mkddc-iobus CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -Werror)

# shared/ là hợp đồng — include từ repo root, KHÔNG copy file vào service
set(SHARED_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../shared)

add_library(iobus_lib STATIC
    config/iobus_config.cpp
    iop/iop_port.cpp  iop/iop_frame.cpp  iop/iop_crc.cpp
    iop/iop_client.cpp iop/iop_parser.cpp
    io/io_scaling.cpp io/io_cache.cpp
    bridge/core_bridge.cpp bridge/output_command.cpp
    diagnostics/iobus_metrics.cpp diagnostics/alarm_publisher.cpp
    platform/systemd_notify.cpp platform/realtime.cpp)
target_include_directories(iobus_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} ${SHARED_DIR})
target_link_libraries(iobus_lib PUBLIC pthread rt)   # rt: shm/clock; (libsystemd nếu dùng sd_notify lib)

add_executable(mkddc-iobus main.cpp)
target_link_libraries(mkddc-iobus PRIVATE iobus_lib)

# ---- tests ----
include(FetchContent)
FetchContent_Declare(googletest
  URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip)
FetchContent_MakeAvailable(googletest)
enable_testing()
add_executable(iobus_tests
    tests/test_iop_crc.cpp tests/test_iop_frame.cpp tests/test_iop_parser.cpp
    tests/test_io_scaling.cpp tests/test_output_command.cpp
    tests/test_iop_client_fake_mcu.cpp)
target_link_libraries(iobus_tests PRIVATE iobus_lib gtest_main)
include(GoogleTest)
gtest_discover_tests(iobus_tests)
```

**Build + test local (PC dev, chưa cần board):**
```bash
cmake -S services/iobus -B build/iobus -DCMAKE_BUILD_TYPE=Release
cmake --build build/iobus -j
ctest --test-dir build/iobus --output-on-failure
```
**Install + systemd (trên SOM):**
```bash
sudo install -m 0755 build/iobus/mkddc-iobus /usr/sbin/mkddc-iobus
sudo install -m 0644 packaging/systemd/mkddc-iobus.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mkddc-iobus
journalctl -u mkddc-iobus -f
```
**systemd unit ĐẦY ĐỦ (chốt thứ tự: iobus tạo SHM → chạy TRƯỚC; core After=iobus — xem 07 §8).
File thật: `packaging/systemd/mkddc-iobus.service` (SKEL-005, 2026-06-12) — install bằng
`packaging/install.sh`. Lưu ý: iobus CHƯA handle SIGHUP (Rev A.1) → unit không có ExecReload;
đổi io_config/device.conf tạm thời restart iobus:**
```ini
# /etc/systemd/system/mkddc-iobus.service
[Unit]
Description=MK-DDC-24 IO bus service (UART/IOP master to MCU)
# iobus là creator của /dev/shm/mkddc_io_shm → KHÔNG phụ thuộc core.
After=local-fs.target

[Service]
Type=notify                     # sd_notify READY=1 sau handshake (degraded: vẫn READY khi vào RECONNECT)
ExecStart=/usr/sbin/mkddc-iobus --config /data/config/iobus.conf
User=mkddc
Group=mkddc
SupplementaryGroups=dialout     # quyền mở /dev/ttyS2
RuntimeDirectory=mkddc          # tạo /run/mkddc (alarm.sock)
RuntimeDirectoryPreserve=yes    # core/web dùng chung /run/mkddc
Restart=always
RestartSec=2
WatchdogSec=5                   # iobus kick mỗi ≤2.5s (WatchdogSec/2)
LimitRTPRIO=80                  # cho phép SCHED_FIFO 70
LimitMEMLOCK=infinity           # mlockall
AmbientCapabilities=CAP_SYS_NICE CAP_IPC_LOCK
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
```
**Dev mode (không board thật):**
```bash
./build/iobus/mkddc-iobus --config ./testdata/iobus.json --uart /dev/ttyUSB0 --log-level debug
# hoặc chạy với fake MCU (§11):
./tools/fake_mcu/fake_mcu --pty &   # in ra /dev/pts/N
./build/iobus/mkddc-iobus --uart /dev/pts/N --log-level debug
```

---

## 11. Fake MCU / test harness

Cho phép dev iobus test **không cần board thật** + CI chạy integration test.

```
tools/fake_mcu/
├── fake_mcu.cpp        — emulator MCU slave qua pty/socat
└── scenarios/          — kịch bản inject lỗi
tools/shm_dump_io/
└── shm_dump_io.c       — dump kx_io_shm ra text (bring-up + debug, thay cho cat|xxd)
```

**`shm_dump_io` (bắt buộc có từ Phase 3 — bring-up dùng, 13 §10/17 mốc 6):**
```
- Attach read-only /dev/shm/mkddc_io_shm; magic sai → in "NOT READY" + exit 2.
- Đọc qua seqlock reader (snapshot nhất quán) rồi in:
    magic/seq/ts_ns(+tuổi ms) · ui_value+quality+unit (8 dòng) · di_state/di_counter ·
    ao_setpoint/ao_mode · do_cmd/do_feedback · fault_flags (decode tên bit) ·
    iop_status · mcu_temp · metrics (rx/crc/timeout/seq_err).
- --watch 1s: in lại mỗi giây; --json: 1 dòng JSON (cho script/CI).
- Exit code: 0 = NORMAL; 1 = FAULT/SAFE; 2 = chưa attach được.
- Build chung CMakeLists iobus (thêm add_executable(shm_dump_io ...)).
```
**Hành vi fake MCU:**
```
- nhận HANDSHAKE → trả HANDSHAKE_RESP (version cấu hình được, STATUS 0/1/2).
- nhận GET_IO → trả IO_RESP fake (UI ramp/sin, DI theo script, sample_cnt tăng).
- nhận SET_DO/SET_AO/SET_AO_CFG → trả ACK; lưu để IO_RESP feedback (DO_FB_MASK).
- nhận GET_DIAG → trả DIAG_RESP fake (counters).
- nhận RESET_IO → trả ACK + IO_RESP về safe.
- INJECT: --crc-error rate, --timeout (bỏ trả lời N frame), --nack CMD ERR,
          --seq-wrong, --stuck-relay, --overtemp.
```
**Mục tiêu:**
```
- dev iobus test toàn bộ state machine + recovery khi chưa có board.
- CI: test_iop_client_fake_mcu.cpp chạy fake_mcu qua pty → assert handshake/poll/recover.
- Cross-check CRC vector với cùng iop_crc16 (1 nguồn).
```

### 11.1 Checklist "dev không có board" (Phase 0–2 hoàn thành được bằng fake MCU)

Làm tuần tự; mỗi bước có command + kết quả mong đợi. Fail bước nào → debug bước đó trước khi đi tiếp.

| # | Việc | Command | Đạt khi |
|---|------|---------|---------|
| 1 | Build + unit test | `cmake -S services/iobus -B build/iobus && cmake --build build/iobus -j && ctest --test-dir build/iobus` | ctest 100% pass (crc 12/12 vector, frame round-trip, parser offset) |
| 2 | Chạy fake MCU | `./build/iobus/fake_mcu --pty` | In ra `pty: /dev/pts/N` rồi chờ |
| 3 | Handshake qua pty | `./build/iobus/mkddc-iobus --uart /dev/pts/N --log-level debug` | Log `iop.handshake mcu_iop=1.1 ... status=ok` rồi poll im lặng |
| 4 | SHM có dữ liệu | `xxd /dev/shm/mkddc_io_shm \| head -4` | 4 byte đầu = `01 44 58 4b` (magic LE); chạy lại sau 1s thấy ts/seq đổi |
| 5 | Round-trip output | tool/test ghi `do_cmd[0]=1` vào shm (hoặc test_iop_client_fake_mcu case output) | Log `output.set_do mask=0x01 value=0x01 ack=ok`; IO_RESP kế có DO_FB bit0=1 → `do_feedback[0]=1` |
| 6 | Negative: timeout | `fake_mcu --pty --timeout 5` (bỏ trả lời 5 frame) | Log retry → `iop.fault` → `iop.safe_state` → `iop.reconnect` → recover; alarm `IOP_TIMEOUT` ra `/run/mkddc/alarm.sock` |
| 7 | Negative: CRC | `fake_mcu --pty --crc-error 0.5` | `iop_crc_err` tăng, retry hoạt động, KHÔNG crash, log rate-limited |
| 8 | Negative: NACK safe | `fake_mcu --pty --nack SET_DO ERR_SAFE_STATE` | iobus ngừng SET_*, log + alarm, không spam retry vô hạn |
| 9 | Negative: SEQ sai | `fake_mcu --pty --seq-wrong` | `iop_seq_err` tăng, frame bị drop, poll vẫn sống |
| 10 | Soak 10 phút | chạy bước 3 trong 10 phút | 0 crash, `iop_rx` ≈ 60000, crc_err=0, RAM không tăng (no leak) |

> Bước 1–10 pass = Phase 2 (phía SOM) + phần lớn Phase 3 xong mà CHƯA cần board thật.
> Frame mẫu để debug bằng mắt: GET_IO SEQ=1 = `AA 00 01 01 AC E1`.

---

## 12. Code review checklist (iobus)

```
[ ] Không bypass core (không nhận command web; chỉ đọc ao_setpoint/do_cmd từ shm).
[ ] Không hardcode /dev/ttyS2 nếu config/CLI override.
[ ] CRC dùng chung iop_crc16 + khớp 12 test vector chuẩn với MCU (SWFW §10.1).
[ ] Timeout/retry đúng (10ms, ≤3, fault 100ms, reconnect 5s).
[ ] SEQ wrap 255→0 đúng; verify SEQ echo.
[ ] Poll loop không block quá budget (~2ms); không I/O chặn trong hot-path.
[ ] shm write dùng seqlock (KX_WRITE_BEGIN/END); ts_ns tăng mỗi vòng.
[ ] iobus chỉ ghi field Writer=iobus; ao_setpoint/do_cmd read-only.
[ ] output chỉ gửi khi command CHANGED (so last_sent).
[ ] ACK/NACK xử lý đúng (ERR_SAFE_STATE/BUSY/CRC...).
[ ] metrics đầy đủ (§8) + lên /system/status.
[ ] fault có alarm (§9); alarm không block poll.
[ ] systemd WatchdogSec có kick (systemd_notify).
[ ] config sai JSON → fail-fast; thiếu field → default + WARN.
[ ] SCHED_FIFO + mlockall (degrade có log nếu thiếu cap).
[ ] unit test pass (crc/frame/parser/scaling/output_command).
[ ] fake MCU integration test pass (handshake/poll/recover/inject).
[ ] Không log spam mỗi 10ms; lỗi lặp rate-limited.
```

---

## 13. Ba flow chính (chi tiết module ở §3)

### Startup sequence (bảng chuẩn — viết main.cpp theo đúng thứ tự này)

| # | Bước | Input | Expected output | Failure behavior | Retry/fail-fast |
|---|------|-------|-----------------|------------------|------------------|
| 1 | Parse CLI + load config | argv, `/data/config/iobus.conf` | struct config hợp lệ | JSON sai cú pháp → exit(1) + ERROR; thiếu file/field → default + WARN | **fail-fast** (chỉ khi JSON hỏng) |
| 2 | Create/attach SHM | `KX_SHM_IO_PATH` | mmap OK; memset 0 → init default (§5) → set magic | shm_open/ftruncate fail → ERROR `io_cache.attach_fail` | **fail-fast** (exit 1 — không có SHM thì service vô nghĩa) |
| 3 | Init metrics + alarm socket | `/run/mkddc/alarm.sock` | socket sẵn sàng (chưa cần subscriber) | socket fail → WARN, tiếp tục (alarm degraded) | tiếp tục |
| 4 | set_rt(70) + mlockall | CAP_SYS_NICE, CAP_IPC_LOCK | SCHED_FIFO 70 + memory locked | thiếu cap → WARN, chạy SCHED_OTHER (degraded) | tiếp tục |
| 5 | Install signal handler | SIGTERM/SIGINT | flag shutdown | — | — |
| 6 | Open UART | config `uart_device`, 921600 8N1 | fd OK, termios raw, flush RX/TX, SEQ=0 | open fail → ERROR → vào FAULT/RECONNECT (bước 7 theo chu kỳ 5s) | **retry** (không exit) |
| 7 | HANDSHAKE | §9 của 05 | STATUS=0x00/0x01 | timeout×3 / STATUS=0x02 → alarm `IOP_INIT_FAIL` → RECONNECT 5s | **retry vô hạn** |
| 8 | RESET_IO reason=NORMAL (0x00) — tùy chọn, khuyến nghị | — | ACK; IO về safe đã biết | NACK/timeout → WARN, tiếp tục | tiếp tục |
| 9 | SET_AO_CFG (nếu config có AO 4-20mA) | `io_config` ao mode | ACK → ghi `ao_mode[]` vào shm | NACK UNKNOWN_CMD → giữ 0-10V, `ao_mode[]=0`, WARN | tiếp tục |
| 10 | Start poll loop (10ms) + diag loop (1s) | — | GET_IO chạy, shm cập nhật | xem state machine 05 §13 | — |
| 11 | sd_notify READY=1 | sau handshake OK | systemd Active | — | — |
| 12 | (chạy) watchdog_kick mỗi ≤2.5s | — | systemd không kill | quên kick → systemd restart (đúng thiết kế) | — |
| 13 | Shutdown (SIGTERM) | signal | dừng loops → đóng UART → KHÔNG xóa shm (core còn đọc) → exit 0 | — | — |
### Input flow (10ms)
```
GET_IO → verify CRC/SEQ → parse IO_RESP → scale raw→eng → io_cache.write_io (seqlock) → core đọc.
```
### Output flow
```
core ghi ao_setpoint/do_cmd → core_bridge.read_outputs → output_command (CHANGED→SET_DO/SET_AO)
→ chờ ACK → GET_IO kế đọc do_feedback xác nhận.
```

---

## 14. Trace

| REQ | Module | Test |
|-----|--------|------|
| IOP-SW-001 | iop_client | group 3 / test_iop_client_fake_mcu |
| IOP-SW-002/010 | iop_crc | CRC vector / test_iop_crc |
| IOP-SW-004/009 | io_cache | shm seqlock test |
| IOP-SW-005 | iop_client/output_command | safe-state test |
| IOP-SW-006 | iobus_metrics | /system/status |
| IOP-SW-008 | realtime | chrt prio check |

---
**Rev** 1.4 | 2026-06-13 (thêm link/cây S7 #5/#6 BACnet/Modbus) · 1.3 | 2026-06-12 (packaging/systemd unit thật) · 1.2 | 2026-06-11 · Protocol: [05_IOP_UART](05_IOP_UART_IMPLEMENTATION_GUIDE.md) ·
Freeze: [15_CONTRACT_FREEZE](15_CONTRACT_FREEZE.md) · DoD: [12_DEFINITION_OF_DONE §3](12_DEFINITION_OF_DONE.md)
