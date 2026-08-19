# 17 — Quick Start for SOM Dev
## MK-DDC-24 — Từ zero đến code chạy với fake MCU (tối đa 2 trang)

> **Document ID:** IMPL-QUICKSTART-MK-DDC-24-VI · **Phiên bản:** 1.1 | 2026-08-19 (đồng bộ cây nguồn `apps/` và lệnh build gốc sau `PLAN-ARCH-RESTRUCT-002`) · 1.0 | 2026-06-11
> **Trạng thái:** Active
> **Đối tượng:** dev C/C++ MỚI vào dự án, phụ trách `apps/iobus` + `apps/core`.
> Chưa cần board. Đọc xong file này là bắt đầu code được.

---

## 1. Hệ thống trong 60 giây

```
[MCU STM32]──UART 921600/IOP──[mkddc-iobus]──/dev/shm/mkddc_io_shm──[mkddc-core]──core.sock──[mkddc-web]
 đọc/ghi IO thật               poll 2ms/500Hz,                        priority +                REST/UI
 slave, safe-state             scale, đưa thư                         safe-state quyết output
```
- **iobus** = người đưa thư UART: poll MCU, scale raw→engineering, ghi SHM; đọc lệnh từ SHM gửi xuống MCU. KHÔNG logic.
- **core** = bộ não: đọc SHM, resolve priority 6 mức, safe-state, ghi `ao_setpoint[]/do_cmd[]` lại SHM. KHÔNG mở UART.
- Cấm vĩnh viễn: web→UART trực tiếp, iobus tự quyết relay, bypass priority resolver.

## 2. Ba file phải mở trước khi code

| File | Là gì |
|------|-------|
| [`contracts/iop/iop_protocol.h`](../../contracts/iop/iop_protocol.h) | Hợp đồng UART/IOP — **chuẩn cuối**, docs lệch nó là docs sai |
| [`contracts/shm/mkddc_shm.h`](../../contracts/shm/mkddc_shm.h) | Hợp đồng SHM — **chuẩn cuối** layout/path/ownership |
| [16_CONTRACT_FREEZE](archive/16_CONTRACT_FREEZE.md) | Bản chốt: FAULT bit, reset reason, CRC vector, rename policy |

Đọc sâu theo việc: iobus → [05](05_IOP_UART_IMPLEMENTATION_GUIDE.md) + [06](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md);
core → [07](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md). Phase nào làm gì → [03](03_PHASE_PLAN.md).

## 3. Mười sự thật phải nhớ (đỡ phải hỏi lại)

```
1. Frame: AA | LEN | CMD | SEQ | PAYLOAD | CRC_HI CRC_LO. CRC-16/Modbus poly 0xA001 init 0xFFFF.
2. Test vector: {AA 00 01 00}→0x6C20, {AA 00 01 01}→0xACE1. GET_IO SEQ=1 = AA 00 01 01 AC E1.
   (Thấy 0x84C0/0x556B ở đâu = tài liệu cũ sai, đã thay 2026-06-11.)
3. SOM tự tăng SEQ, MCU chỉ echo. Multi-byte = big-endian. UI raw = s24 (dùng iop_s24()).
4. Timing: poll 2ms, response timeout 3ms, retry 3, fault 20ms, reconnect 5s, MCU safe 200ms.
5. FAULT bit: 0=ADC 1=DAC 2=UI_OV 3=RELAY_STUCK 4=WDG(sticky) 5=OVERTEMP 6=VDD.
6. SHM path: /dev/shm/mkddc_io_shm. Struct giữ prefix kx_, magic 0x4B584401 — không rename.
7. iobus = creator + seqlock writer io_shm. Core CHỈ ghi ao_setpoint[]/do_cmd[] (atomic store).
8. ao_setpoint là ENGINEERING (V/mA); iobus convert eng→raw theo ao_mode. AO safe: raw 0 (0V/4mA).
9. Reader seqlock: đọc seq chẵn → copy → đọc lại seq, đổi thì retry. Không bao giờ block writer.
10. Đổi header trong contracts/ = đổi hợp đồng → ADR-010 + quy trình review, không sửa lén.
```

## 4. Build trong 15 phút

> Cây nguồn **đã tồn tại**, không còn bước scaffold. Sau `PLAN-ARCH-RESTRUCT-002` (ADR-025),
> `CMakeLists.txt` **ở gốc repo** là authority duy nhất; không cấu hình riêng từng service nữa.

```bash
# 1. Configure một lần, bật cả ba option (mặc định HMI là OFF nên rất dễ bỏ sót gate)
cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON

# 2. Build + test. LUÔN đọc exit code của cả configure lẫn build: build dir cũ còn
#    CMAKE_HOME_DIRECTORY trỏ services/ sẽ hỏng cấu hình nhưng ctest vẫn chạy binary cũ
#    và báo "pass" — số đo giả.
cmake --build build/fw --parallel
ctest --test-dir build/fw --output-on-failure     # đo ngày 2026-08-19: 1031/1031 PASS, 16,45 s

# 3. Cây nguồn theo tầng (hexagonal): domain/ ← application/ ← adapters/ ← bootstrap/
#    apps/iobus/adapters/iop/       — frame, crc, client, parser, port
#    apps/iobus/adapters/modbus_rtu/— Modbus RTU master (trước đây là fieldbus/)
#    apps/iobus/adapters/bacnet/    — BACnet/IP server
#    apps/core/domain/ · apps/core/application/{st,graph,alarm,schedule,...}
```

## 5. Chạy không cần board (fake MCU)

```bash
./build/fw/iobus/fake_mcu --pty            # in ra /dev/pts/N
./build/fw/iobus/mkddc-iobus --uart /dev/pts/N --log-level debug
# Mong đợi: INFO iop.handshake ... status=ok, cap=0x000D, rồi im lặng (poll 500Hz không log spam)
xxd /dev/shm/mkddc_io_shm | head -4         # 4 byte đầu: 01 44 58 4b (magic LE), ts/seq đổi mỗi giây
./build/fw/core/mkddc-core --log-level debug   # point table phản ánh UI ramp của fake MCU
```
Checklist 10 bước đầy đủ (kể cả negative test): [06 §11.1](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md).
Làm hết = Phase 0–2 phía SOM xong trước khi có board.

## 6. Lên board thật

Board-level (nguồn, flash MCU): [14_BRINGUP_GUIDE](14_BRINGUP_GUIDE.md). Checklist 8 mốc tuần đầu
[18](archive/18_WEEK1_SOM_BRINGUP_CHECKLIST.md) **đã lưu trữ** — lệnh trong đó trỏ `services/` không
còn tồn tại; dùng runbook 27 bên dưới.

Nếu board SOM đã có nhưng MCU chưa có: dùng [27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK](27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md)
để build/deploy `--no-enable` và chạy `fake_mcu` no-board trên chính SOM.

## 7. Định nghĩa "xong"

Mỗi module: unit test pass + done-criteria trong contract (06 §3 / 07 §11) + không vi phạm
checklist review (06 §12). Mỗi phase: output đo được trong [03_PHASE_PLAN](03_PHASE_PLAN.md) +
test group tương ứng [12_INTEGRATION_TEST_PLAN](12_INTEGRATION_TEST_PLAN.md).

---
**Rev** 1.1 | 2026-06-13 (thêm link deploy SOM no-MCU doc 26) · 1.0 | 2026-06-11 · Hỏi gì cũng tra được theo thứ tự: header `shared/` → 15 → 05/06/07 → spec.
