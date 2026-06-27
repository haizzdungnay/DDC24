# 18 — SOM Week-1 Bring-up Checklist
## MK-DDC-24 — 8 mốc tuần đầu trên SOM, làm tuần tự, fail thì dừng

> **Document ID:** IMPL-WEEK1-MK-DDC-24-VI · **Phiên bản:** 1.0 | 2026-06-11
> **Trạng thái:** Active
> **Đối tượng:** Dev 2 (SOM). Tiền đề: MCU đã qua Phase 1 ([13_BRINGUP §1–7](14_BRINGUP_GUIDE.md))
> hoặc dùng fake MCU cho mốc 1–2. Nếu chưa có MCU nhưng đã có SOM board, làm theo
> [27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK](27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md) trước.
> Mỗi mốc: command → log mong đợi → quan sát gì → fail debug ở đâu.
> Quy tắc: **mốc nào fail thì DỪNG**, không nhảy mốc sau.

---

## Mốc 1 — Build được iobus (+ core)

```bash
cmake -S services/iobus -B build/iobus -DCMAKE_BUILD_TYPE=Release && cmake --build build/iobus -j
cmake -S services/core  -B build/core  -DCMAKE_BUILD_TYPE=Release && cmake --build build/core  -j
```
- **Đạt khi:** 2 binary `mkddc-iobus`, `mkddc-core` tồn tại; 0 warning (`-Werror`).
- **Fail →** thiếu include `shared/`? Kiểm `SHARED_DIR` trong CMakeLists (06 §10 / 07 §9).

## Mốc 2 — CRC/frame test pass

```bash
ctest --test-dir build/iobus --output-on-failure
```
- **Đạt khi:** `test_iop_crc` 12/12 vector (SWFW §10.1); `test_iop_frame` round-trip + negative pass.
- **Quan sát:** vector 1–2 phải ra `0x6C20`/`0xACE1`.
- **Fail →** nếu code ra `0x84C0` nghĩa là CRC tự viết sai thuật toán — chỉ dùng `iop_crc16()`
  từ header. Nếu lệch byte-order: CRC truyền **HI trước**.

## Mốc 3 — Mở được /dev/ttyS2

```bash
ls -l /dev/ttyS2 && groups            # user mkddc phải có nhóm dialout
stty -F /dev/ttyS2 921600 raw -echo
./build/iobus/mkddc-iobus --uart /dev/ttyS2 --log-level debug   # chạy tay, chưa systemd
```
- **Đạt khi:** log `INFO iop.open dev=/dev/ttyS2 baud=921600` (handshake có thể chưa pass).
- **Fail →** `EACCES`: thiếu nhóm dialout. `ENOENT`: sai device tree/UART overlay của CM3.
  Port bị console chiếm? Kiểm `cat /proc/cmdline` không có `console=ttyS2`.

## Mốc 4 — Handshake pass

```bash
journalctl -u mkddc-iobus -f   # hoặc stderr khi chạy tay
```
- **Đạt khi:** `INFO iop.handshake mcu_iop=1.1 mcu_fw=1.0 status=ok`, sau đó KHÔNG log spam.
- **Quan sát:** MCU console (USART2 115200) thấy nhận HANDSHAKE.
- **Fail →** timeout: kiểm baud 2 phía =921600, đấu TX/RX chéo qua ADUM1201, GND2 chung.
  CRC fail liên tục: chạy lại mốc 2 trên CẢ firmware (cross-test). STATUS=0x02: lệch IOP version.

## Mốc 5 — GET_IO / IO_RESP pass

- **Command:** để iobus chạy 60s rồi xem metrics (log DEBUG in chu kỳ, hoặc đọc shm mốc 6).
- **Đạt khi:** poll 100Hz đều: `iop_rx` ≈ 6000/phút, `crc_err=0`, `timeout=0`, `sample_cnt` tăng.
- **Quan sát:** rút cáp UART 1s → log `iop.fault` → cắm lại → `iop.reconnect` → recover.
- **Fail →** timeout lẻ tẻ: MCU latency >10ms (FW phải trả ≤5ms) hoặc SOM poll thread không RT
  (`chrt -p $(pidof mkddc-iobus)` phải thấy SCHED_FIFO 70).

## Mốc 6 — Ghi SHM pass

```bash
xxd /dev/shm/mkddc_io_shm | head -8
```
- **Đạt khi:** 4 byte đầu `01 44 58 4b` (magic `0x4B584401` little-endian); chạy lệnh 2 lần
  cách 1s thấy vùng `seq`/`ts_ns` (offset 4..15) đổi; cấp 5V vào UI1 → `ui_value[0]` (float,
  offset 16) ≈ 5.0.
- **Fail →** file không tồn tại: iobus chưa tới bước create (xem startup table 06 §13, bước 2).
  Magic đúng nhưng ts đứng yên: poll loop chết — xem log fault.

## Mốc 7 — core đọc SHM pass

```bash
./build/core/mkddc-core --log-level debug
```
- **Đạt khi:** log scan đầu tiên OK + `READY=1`; point table in/expose AI1 ≈ giá trị UI1 thật;
  rút UART → trong ≤2 scan toàn bộ quality=BAD (log safe-state), cắm lại → GOOD.
- **Fail →** attach fail: core chạy trước iobus? (systemd `After=mkddc-iobus`); magic chưa set.
  Quality không BAD khi rút UART: kiểm map `iop_status` + stale rule (06 §5, 07 §6).

## Mốc 8 — do_cmd[0] round-trip pass (relay thật)

```bash
# Cách chuẩn (qua core): gửi command vào core.sock
printf '{"point":"DO1","value":1,"priority_source":"operator","user":"dev"}\n' | \
  socat - UNIX-CONNECT:/run/mkddc/core.sock
```
- **Đạt khi:** ≤1 scan core (1s) + ≤1 poll iobus (10ms): log iobus
  `INFO output.set_do mask=0x01 value=0x01 ack=ok` → **relay DO1 đóng thật** (nghe tách,
  đèn sáng) → IO_RESP kế có DO_FB bit0=1 → `do_feedback[0]=1` → core/web thấy ON.
- **Quan sát:** gửi value=0 → relay mở. Lặp 10 lần không miss.
- **Fail →** core nhận nhưng iobus không gửi: kiểm core có ghi `do_cmd[]` (xxd offset tương ứng);
  iobus gửi nhưng NACK ERR_SAFE_STATE: MCU đang safe (mất GET_IO 200ms trước đó?);
  ACK ok nhưng relay không đóng: phần cứng — quay lại [13 §5](14_BRINGUP_GUIDE.md).

---

## Tổng kết tuần 1

| Mốc | Nội dung | Pass = Phase |
|-----|----------|--------------|
| 1 | build iobus/core | P0 |
| 2 | CRC/frame test | P0/P2 |
| 3 | mở /dev/ttyS2 | P2 |
| 4 | handshake | P2 |
| 5 | GET_IO/IO_RESP | P2 |
| 6 | ghi SHM | P3 |
| 7 | core đọc SHM | P4 (một phần) |
| 8 | do_cmd round-trip | P3+P4 round-trip |

8/8 = đường trục `core → iobus → MCU → relay → feedback` sống. Phần còn lại của Phase 3/4
(metrics, alarm, priority đầy đủ, soak test) theo [03_PHASE_PLAN](03_PHASE_PLAN.md) +
[12_INTEGRATION_TEST_PLAN](12_INTEGRATION_TEST_PLAN.md).

---
**Rev** 1.1 | 2026-06-13 (link no-MCU SOM deploy doc 26) · 1.0 | 2026-06-11 · Board-level: [14_BRINGUP_GUIDE](14_BRINGUP_GUIDE.md) ·
Không board: [06 §11.1](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) · Freeze: [15](16_CONTRACT_FREEZE.md)
