# 17 — Quick Start for SOM Dev
## MK-DDC-24 — Từ zero đến code chạy với fake MCU (tối đa 2 trang)

> **Document ID:** IMPL-QUICKSTART-MK-DDC-24-VI · **Phiên bản:** 1.0 | 2026-06-11
> **Trạng thái:** Active
> **Đối tượng:** dev C/C++ MỚI vào dự án, phụ trách `services/iobus` + `services/core`.
> Chưa cần board. Đọc xong file này là bắt đầu code được.

---

## 1. Hệ thống trong 60 giây

```
[MCU STM32]──UART 921600/IOP──[mkddc-iobus]──/dev/shm/mkddc_io_shm──[mkddc-core]──core.sock──[mkddc-web]
 đọc/ghi IO thật               poll 100Hz,                            priority +                REST/UI
 slave, safe-state             scale, đưa thư                         safe-state quyết output
```
- **iobus** = người đưa thư UART: poll MCU, scale raw→engineering, ghi SHM; đọc lệnh từ SHM gửi xuống MCU. KHÔNG logic.
- **core** = bộ não: đọc SHM, resolve priority 6 mức, safe-state, ghi `ao_setpoint[]/do_cmd[]` lại SHM. KHÔNG mở UART.
- Cấm vĩnh viễn: web→UART trực tiếp, iobus tự quyết relay, bypass priority resolver.

## 2. Ba file phải mở trước khi code

| File | Là gì |
|------|-------|
| [`shared/iop_protocol.h`](../../shared/iop_protocol.h) | Hợp đồng UART/IOP — **chuẩn cuối**, docs lệch nó là docs sai |
| [`shared/mkddc_shm.h`](../../shared/mkddc_shm.h) | Hợp đồng SHM — **chuẩn cuối** layout/path/ownership |
| [16_CONTRACT_FREEZE](16_CONTRACT_FREEZE.md) | Bản chốt: FAULT bit, reset reason, CRC vector, rename policy |

Đọc sâu theo việc: iobus → [05](05_IOP_UART_IMPLEMENTATION_GUIDE.md) + [06](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md);
core → [07](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md). Phase nào làm gì → [03](03_PHASE_PLAN.md).

## 3. Mười sự thật phải nhớ (đỡ phải hỏi lại)

```
1. Frame: AA | LEN | CMD | SEQ | PAYLOAD | CRC_HI CRC_LO. CRC-16/Modbus poly 0xA001 init 0xFFFF.
2. Test vector: {AA 00 01 00}→0x6C20, {AA 00 01 01}→0xACE1. GET_IO SEQ=1 = AA 00 01 01 AC E1.
   (Thấy 0x84C0/0x556B ở đâu = tài liệu cũ sai, đã thay 2026-06-11.)
3. SOM tự tăng SEQ, MCU chỉ echo. Multi-byte = big-endian. UI raw = s24 (dùng iop_s24()).
4. Timing: poll 10ms, resp timeout 10ms, retry 3, fault 100ms, reconnect 5s, MCU safe 200ms.
5. FAULT bit: 0=ADC 1=DAC 2=UI_OV 3=RELAY_STUCK 4=WDG(sticky) 5=OVERTEMP 6=VDD.
6. SHM path: /dev/shm/mkddc_io_shm. Struct giữ prefix kx_, magic 0x4B584401 — không rename.
7. iobus = creator + seqlock writer io_shm. Core CHỈ ghi ao_setpoint[]/do_cmd[] (atomic store).
8. ao_setpoint là ENGINEERING (V/mA); iobus convert eng→raw theo ao_mode. AO safe: raw 0 (0V/4mA).
9. Reader seqlock: đọc seq chẵn → copy → đọc lại seq, đổi thì retry. Không bao giờ block writer.
10. Đổi header shared/ = đổi hợp đồng → quy trình 16_CONTRACT_FREEZE §7, không sửa lén.
```

## 4. Scaffold + build trong 15 phút

```bash
# 1. Tạo cây thư mục (đúng tên file — 06 §2 và 07 §1)
mkdir -p services/iobus/{config,iop,io,bridge,diagnostics,platform,tests}
mkdir -p services/core/tests tools/fake_mcu

# 2. Chép CMakeLists.txt mẫu từ 06 §10 (iobus) và 07 §9 (core) — copy nguyên văn, build được ngay.

# 3. Viết file đầu tiên: iop_crc.cpp wrap iop_crc16() + test 12 vector (SWFW spec §10.1)
cmake -S services/iobus -B build/iobus && cmake --build build/iobus -j
ctest --test-dir build/iobus --output-on-failure     # CRC 12/12 pass = bạn đã vào guồng

# 4. Thứ tự module (mỗi cái có contract + test trong 06 §3):
#    iop_crc → iop_frame → iop_parser → iop_port → iop_client → io_scaling → io_cache
#    → core_bridge/output_command → main.cpp
```

## 5. Chạy không cần board (fake MCU)

```bash
./build/iobus/fake_mcu --pty            # in ra /dev/pts/N
./build/iobus/mkddc-iobus --uart /dev/pts/N --log-level debug
# Mong đợi: INFO iop.handshake ... status=ok, rồi im lặng (poll 100Hz không log spam)
xxd /dev/shm/mkddc_io_shm | head -4     # 4 byte đầu: 01 44 58 4b (magic LE), ts/seq đổi mỗi giây
./build/core/mkddc-core --log-level debug   # point table phản ánh UI ramp của fake MCU
```
Checklist 10 bước đầy đủ (kể cả negative test): [06 §11.1](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md).
Làm hết = Phase 0–2 phía SOM xong trước khi có board.

## 6. Lên board thật

Theo đúng thứ tự [18_WEEK1_SOM_BRINGUP_CHECKLIST](18_WEEK1_SOM_BRINGUP_CHECKLIST.md)
(8 mốc, mỗi mốc có command + log mong đợi + chỗ debug). Board-level (nguồn, flash MCU):
[14_BRINGUP_GUIDE](14_BRINGUP_GUIDE.md).

Nếu board SOM đã có nhưng MCU chưa có: dùng [27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK](27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md)
để build/deploy `--no-enable` và chạy `fake_mcu` no-board trên chính SOM.

## 7. Định nghĩa "xong"

Mỗi module: unit test pass + done-criteria trong contract (06 §3 / 07 §11) + không vi phạm
checklist review (06 §12). Mỗi phase: output đo được trong [03_PHASE_PLAN](03_PHASE_PLAN.md) +
test group tương ứng [12_INTEGRATION_TEST_PLAN](12_INTEGRATION_TEST_PLAN.md).

---
**Rev** 1.1 | 2026-06-13 (thêm link deploy SOM no-MCU doc 26) · 1.0 | 2026-06-11 · Hỏi gì cũng tra được theo thứ tự: header `shared/` → 15 → 05/06/07 → spec.
