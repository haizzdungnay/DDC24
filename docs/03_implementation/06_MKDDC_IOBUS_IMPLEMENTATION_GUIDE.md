# 06 — mkddc-iobus Implementation Guide
## MK-DDC-24 — Master UART/IOP + Modbus/BACnet datalink

> **Document ID:** IMPL-IOBUS-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Owner:** Dev 2 (SOM)
> **Nguồn-chuẩn:** [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) ·
> [ADR-005](../adr/ADR-005-three-process-architecture.md) · [`shared/iop_protocol.h`](../../shared/iop_protocol.h) ·
> [`shared/kinexus_shm.h`](../../shared/kinexus_shm.h) · [05_IOP_UART](05_IOP_UART_IMPLEMENTATION_GUIDE.md)

> 🎯 Vai trò: **người đưa thư UART**. iobus POLL MCU, PARSE, GỬI lệnh đã được core quyết,
> BÁO lỗi. **iobus KHÔNG quyết định logic relay/AO** — đó là việc của `mkddc-core`.

---

## 1. Cây module đề xuất

```
services/iobus/
├── main.cpp            — init, SCHED_FIFO, vòng đời service, sd_notify, signal handler
├── iop_port.cpp        — mở/cấu hình /dev/ttyS2 (termios raw 921600 8N1), read/write low-level
├── iop_frame.cpp       — build/parse frame (SOF/LEN/CMD/SEQ/PAYLOAD/CRC)
├── iop_crc.cpp         — CRC-16/Modbus (wrap iop_crc16 từ header) + unit test
├── iop_client.cpp      — state machine: handshake, poll loop, timeout/retry, SEQ
├── iop_parser.cpp      — parse IO_RESP/DIAG_RESP → struct; scale raw→engineering
├── io_cache.cpp        — ghi kx_io_shm (seqlock writer); giữ trạng thái IO
├── output_command.cpp  — đọc ao_setpoint/do_cmd từ shm → build SET_AO/SET_DO
├── core_bridge.cpp     — ranh giới với core qua shm (đọc output, ghi input)
├── modbus_master.cpp   — libmodbus RTU x2 + TCP client → ext cache (Phase 3+)
├── bacnet_datalink.cpp — bacnet-stack BACnet/IP network I/O (đọc kx_plc_shm) (Phase 3+)
└── iobus_metrics.cpp   — counters iop_rx/crc_err/timeout/seq_err + alarm bus
```
> Rev A IOP core (Phase 3) = main/iop_*/io_cache/output_command/metrics. Modbus/BACnet bật
> sau khi IOP ổn định.

---

## 2. Ba flow chính

### 2.1 Startup flow
```
1. Đọc config (/data/config/network.conf, fieldbus.conf, io_config.conf — sensor type per UI).
2. Tạo/attach POSIX shm /dev/shm/mkddc_io_shm (kx_io_shm_t), set magic.
3. iop_port: mở /dev/ttyS2, termios raw 921600 8N1, flush.
4. iop_client: SEQ=0, gửi HANDSHAKE, chờ HANDSHAKE_RESP (timeout 1000ms).
     STATUS=0x02/timeout → retry 3 → fail: alarm IOP_INIT_FAIL, iop_status=FAULT.
5. (tùy) gửi SET_AO_CFG theo io_config (mode AO per kênh).
6. set SCHED_FIFO prio ≥70 (IOP-SW-008).
7. start poll loop (timer 10ms).
8. sd_notify("READY=1") sau handshake OK.
```

### 2.2 Input flow (IO từ MCU lên shm) — mỗi 10ms
```
1. iop_client: SEQ++, gửi GET_IO.
2. chờ IO_RESP (timeout 10ms).
3. iop_frame: validate SOF/LEN; iop_crc: validate CRC; check SEQ echo.
     CRC sai → iop_crc_err++, retry (≤3).
     SEQ sai → iop_seq_err++, bỏ frame.
     timeout → retry; >3 → iop_timeout++, iop_status=FAULT, fault_flags hold.
4. iop_parser: parse 34B payload → ui_raw[8], di_mask, do_fb_mask, mcu_temp, fault_flags, sample_cnt.
5. scale: ui_raw(s24) → ui_value[8] (engineering) theo sensor_type (SW_ARCH §4.1):
     0-10V, 4-20mA, PT100/1000 (CVD), NTC10k/20k (Steinhart-Hart), dry contact.
6. io_cache: KX_WRITE_BEGIN(shm) → ghi ui_value/ui_quality/di_state/do_feedback/
     mcu_temp_x10/fault_flags/iop_status/metrics → KX_WRITE_END(shm).
7. core đọc qua seqlock (không block writer).
```

### 2.3 Output flow (command từ core xuống MCU) — sau khi core ghi
```
1. core ghi ao_setpoint[4]/do_cmd[4] vào kx_io_shm (đã qua priority resolver).
2. output_command: đọc ao_setpoint/do_cmd (so với giá trị đã gửi trước).
3. nếu DO đổi → build SET_DO {mask,value}; nếu AO đổi → build SET_AO (eng→raw, clamp).
4. iop_client gửi SET_DO/SET_AO, chờ ACK (timeout 10ms).
5. ACK OK → cập nhật "đã gửi"; NACK/timeout → retry (≤3) → fault + alarm.
6. lần GET_IO kế: đọc do_feedback để xác nhận relay đã đóng.
```
> AO scale eng→raw (SW_ARCH §4.2): 0-10V `raw=(V/10)*65535`; 4-20mA `raw=((mA-4)/16)*65535`, clamp[0,65535].

---

## 3. Module breakdown (format đầy đủ)

### `iop_port`
```
Mục tiêu : mở/cấu hình UART, đọc/ghi byte.
Input    : path /dev/ttyS2, baud 921600.
Output   : fd; read()/write() raw bytes.
Done khi : mở port OK, không mất byte ở 921600 (test loopback nếu có).
```
### `iop_frame` + `iop_crc`
```
Mục tiêu : build/parse frame; CRC.
Input    : CMD, SEQ, payload (build); byte stream (parse).
Output   : frame bytes; struct {cmd,seq,payload,len,crc_ok}.
Lỗi      : LEN > MAX, CRC mismatch, frame chưa đủ byte.
Test     : 10 CRC vector khớp MCU; build GET_IO SEQ=1 → AA 00 01 01 55 6B.
Done khi : round-trip build→parse đúng; CRC khớp test vector 2 phía.
```
### `iop_client`
```
Mục tiêu : state machine handshake + poll + timeout/retry + SEQ.
Input    : timer 10ms; response frames.
Output   : GET_IO/SET_*/HANDSHAKE frames; iop_status.
Lỗi      : timeout→retry≤3; >3→FAULT; STATUS=0x02→abort.
Done khi : handshake pass; 1000 GET_IO 0 lỗi; recover sau rút UART.
```
### `iop_parser`
```
Mục tiêu : IO_RESP/DIAG_RESP → struct + scale.
Input    : 34B/20B payload + sensor_type config.
Output   : ui_value[8] eng, di_state[8], do_feedback[4], fault, metrics.
Done khi : raw→eng đúng (đối chiếu điện áp biết trước); fault_flags map đúng.
```
### `io_cache`
```
Mục tiêu : writer seqlock kx_io_shm.
Input    : parsed IO struct.
Output   : kx_io_shm fields.
Lỗi      : ts_ns dừng tăng (writer treo) → core thấy stale.
Done khi : reader (core/test) đọc đúng, không thấy giá trị nửa-ghi.
```
### `output_command`
```
Mục tiêu : đọc setpoint/cmd từ shm → SET_AO/SET_DO.
Input    : kx_io_shm.ao_setpoint/do_cmd.
Output   : SET_AO/SET_DO frame.
Lỗi      : NACK ERR_SAFE_STATE → giữ, báo core.
Done khi : core đổi do_cmd[0] → relay thật đổi; ao_setpoint → AO thật đổi.
```
### `iobus_metrics`
```
Mục tiêu : counters + alarm bus.
Output   : iop_rx/crc_err/timeout/seq_err vào shm; JSON line alarm.sock.
Done khi : /system/status (web) đọc được metrics; timeout → alarm phát ra.
```

---

## 4. systemd

```
# /etc/systemd/system/mkddc-iobus.service
[Unit]
After=mkddc-core.service
Requires=mkddc-core.service
[Service]
ExecStart=/usr/sbin/mkddc-iobus
User=mkddc
Restart=always
WatchdogSec=5
LimitRTPRIO=80
[Install]
WantedBy=multi-user.target
```
> sd_notify READY=1 + WATCHDOG=1 (kick mỗi <5s trong poll loop).

---

## 5. Quy tắc bắt buộc

```
1. iobus KHÔNG tự bật relay/AO theo logic. Chỉ thực thi do_cmd/ao_setpoint do core ghi.
2. Mọi scale raw↔eng làm ở iobus (không ở core, không ở web).
3. Ghi shm phải dùng seqlock (KX_WRITE_BEGIN/END). Reader không bao giờ block.
4. Mất MCU → iop_status=FAULT, KHÔNG giả lập giá trị; để fault_flags/quality phản ánh đúng.
5. SCHED_FIFO ≥70 để giữ 100Hz (IOP-SW-008).
```

---

## 6. Trace

| REQ | Module | Test |
|-----|--------|------|
| IOP-SW-001 | iop_client | group 3 |
| IOP-SW-002/010 | iop_crc | CRC vector |
| IOP-SW-004/009 | io_cache | shm seqlock test |
| IOP-SW-005 | iop_client/output_command | safe-state test |
| IOP-SW-006 | iobus_metrics | /system/status |

---
**Rev** 1.0 | 2026-06-10 · DoD: [12_DEFINITION_OF_DONE §3](12_DEFINITION_OF_DONE.md)
