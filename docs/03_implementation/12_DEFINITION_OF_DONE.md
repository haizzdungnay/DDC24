# 12 — Definition of Done
## MK-DDC-24 — Khi nào từng phần được tính là XONG

> **Document ID:** IMPL-DOD-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Cách dùng:** tick từng ô. Chỉ "Done" khi tick đủ + test group tương ứng pass.

---

## 1. FW_MCU xong khi

```
[ ] HANDSHAKE pass (version negotiate, STATUS đúng).
[ ] GET_IO/IO_RESP pass (34B, CRC đúng, SEQ echo, latency ≤5ms).
[ ] SET_DO pass với relay THẬT (đo đèn/đồng hồ).
[ ] SET_AO pass với đồng hồ đo THẬT (0V/5V/10V hoặc 4/12/20mA).
[ ] SET_AO_CFG pass (đổi mode 0-10V/4-20mA per kênh).
[ ] GET_DIAG pass (DIAG_RESP 20B, counters đúng).
[ ] RESET_IO pass (safe-state + ACK).
[ ] CRC error xử lý đúng (NACK ERR_CRC_FAIL).
[ ] SEQ mismatch xử lý đúng (MCU echo SEQ, SOM phát hiện).
[ ] LEN/CMD sai → NACK đúng code.
[ ] Watchdog pass (IWDG reset khi treo; 200ms IOP safe-state).
[ ] Safe-state pass (AO 0V/4mA, DO open).
[ ] Không malloc sau RTOS start; mọi HAL call check lỗi.
[ ] Chạy 24h không treo (group 8).
[ ] CRC unit test ≥10 vector (IOP-FW-010).
```
Test: group 1 + group 2 + group 8.

---

## 2. IOP UART xong khi

```
[ ] CRC khớp 2 phía 10 vector (TC-2-01).
[ ] HANDSHAKE/version pass cả OK lẫn incompat-abort.
[ ] GET_IO/IO_RESP 1000 lần 0 lỗi, latency ≤5ms.
[ ] SET_DO/SET_AO/SET_AO_CFG + ACK đúng.
[ ] GET_DIAG/RESET_IO pass.
[ ] NACK CRC/SEQ/LEN/UNKNOWN đúng code.
[ ] Timeout/retry (≤3) + fault escalation đúng.
[ ] Startup sequence theo đúng thứ tự §9 (05_IOP_UART).
[ ] iop_protocol.h dùng chung, không fork.
```
Test: group 2.

---

## 3. mkddc-iobus xong khi

```
[ ] systemd service chạy (Restart=always, WatchdogSec, SCHED_FIFO≥70).
[ ] Poll MCU 100Hz ổn định, jitter <2ms.
[ ] Cập nhật kx_io_shm (seqlock), reader đọc nhất quán.
[ ] Scale raw→engineering đúng mọi sensor_type (±1%).
[ ] Gửi output (do_cmd/ao_setpoint → SET_DO/SET_AO) đúng.
[ ] Báo lỗi UART/MCU: iop_status=FAULT + alarm bus, KHÔNG giả lập IO.
[ ] Metrics iop_rx/crc_err/timeout/seq_err lên /system/status.
[ ] Có log journalctl rõ ràng.
[ ] Chạy 1h không crash (TC-3-01).
```
Test: group 3.

---

## 4. mkddc-core xong khi

```
[ ] Point table đủ 24 IO (8UI+8DI+4AO+4DO) + virtual.
[ ] Scan loop 1s tuyệt-đối-thời-gian, scan_overrun=0.
[ ] sd_notify READY=1 sau scan đầu.
[ ] Priority resolver 6 mức chạy (safety > BMS > schedule > logic > default).
[ ] Mọi DO/AO đi qua priority resolver — KHÔNG có đường ghi tắt.
[ ] Safe-state resolver: IO fault → safe output ≤1 scan.
[ ] Quality propagation: IO fault → point quality bad.
[ ] output_writer ghi shm; web_ipc nhận command; bacnet objtable ghi plc_shm.
[ ] Core KHÔNG mở UART / KHÔNG gọi MCU.
[ ] mlockall + SCHED_FIFO 80.
```
Test: group 4 + group 6.

---

## 5. mkddc-web xong khi

```
[ ] Login JWT + bcrypt + RBAC.
[ ] Point list (24 IO) + point detail.
[ ] Commissioning test DO/AO bật IO THẬT qua core.
[ ] System status có IOP metrics.
[ ] Config IO (sensor type) lưu + core/iobus reload.
[ ] Alarm list + ack.
[ ] Validator 4 check Rev A; deploy chỉ khi pass.
[ ] Audit log mọi command/deploy.
[ ] Web KHÔNG mở UART (lsof 0 fd serial) — TC-5-05.
[ ] Web KHÔNG gọi thẳng MCU.
[ ] Lỗi hiển thị tiếng Việt dễ hiểu.
[ ] TLS 1.3, validate input, không hardcode secret.
```
Test: group 5.

---

## 6. Integration xong khi

```
[ ] Web bật/tắt DO1 → relay THẬT (TC-E2E-01/02).
[ ] DI đổi ngoài → web ≤2s (TC-E2E-03).
[ ] Web AO set → analog THẬT đúng (TC-E2E-04).
[ ] Rút UART → web báo lỗi + safe-state (TC-E2E-05).
[ ] Reset MCU → recover tự động (TC-E2E-06).
[ ] Fault injection group 7 pass (sensor/relay/CRC/overtemp/priority).
[ ] Long-run 24h pass (group 8): 0 crash, 0 leak, 0 overrun.
[ ] Mọi command đi đúng đường Web→core→iobus→IOP→MCU.
[ ] KHÔNG còn đường bypass Web→UART.
```
Test: group 6 + 7 + 8.

---

## 7. Release handover xong khi

```
[ ] Build clean từ repo clone mới (4 phần).
[ ] Firmware version + SOM service version rõ ràng.
[ ] Config mặc định có sẵn.
[ ] systemd 3 service enable + boot lên tự động.
[ ] Web login + point list + DO/AO/DI/UI test pass.
[ ] Fault test pass.
[ ] KHÔNG còn mock/demo path, KHÔNG còn bypass Web→UART.
[ ] Release note + known issues.
[ ] Toàn bộ checklist [14_RELEASE_HANDOVER](14_RELEASE_HANDOVER_CHECKLIST.md) tick đủ.
```
Test: toàn bộ + [14_HANDOVER](14_RELEASE_HANDOVER_CHECKLIST.md).

---

## Quy tắc "Done" chung (áp cho mọi task)

```
1. Code build sạch, không warning nghiêm trọng.
2. Có test (unit/integration) tương ứng pass.
3. Output/behavior khớp đúng tài liệu module (04..08).
4. Đi đúng đường dữ liệu chuẩn (không shortcut, không bypass core).
5. Lỗi được xử lý + log, không silent fail.
6. Trace REQ ID ghi trong commit/PR.
7. Reviewer (Lead) duyệt.
```

---
**Rev** 1.0 | 2026-06-10
