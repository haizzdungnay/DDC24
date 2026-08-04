# Khảo sát UART/RS485 trên board production Foxlinx — 2026-08-04

**ID:** EVID-MBRTU-FOXLINX-UART-2026-08-04
**Ngày:** 2026-08-04
**Board:** Foxlinx SOM-DDC-24, alias SSH `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`)
**Loại thao tác:** **chỉ đọc** — không cài đặt, không sửa cấu hình, không restart service
**Mục đích:** thu bằng chứng thực nghiệm cho `OD-MBRTU-001` / Q-01 (sản phẩm có mấy cổng RS485)

## 1. Lệnh đã chạy

```bash
uname -a
ls -l /dev/ttyS* /dev/ttyUSB*
cat /proc/tty/driver/serial
cat /proc/device-tree/model
ls /proc/device-tree/ | grep -i "serial\|uart"
cat /proc/device-tree/serial@*/status
grep -ri "rs485" /proc/device-tree/
```

## 2. Kết quả thô

```text
Linux OK1126B-buildroot 6.1.141 #1 SMP Fri Nov 21 00:37:11 MST 2025 aarch64 GNU/Linux
model: Forlinx OK1126B-S Board

crw-rw---- 1 root dialout 4, 66 Aug  4 10:00 /dev/ttyS2
crw-rw---- 1 root dialout 4, 69 Aug  4 10:00 /dev/ttyS5

serinfo:1.0 driver revision:
2: uart:16550A mmio:0x21170000 irq:62 tx:40872 rx:4680 RTS|CTS|DTR
5: uart:16550A mmio:0x211A0000 irq:63 tx:0     rx:0

device-tree serial nodes và status:
  serial@20810000  disabled
  serial@21160000  disabled
  serial@21170000  okay      → /dev/ttyS2
  serial@21180000  disabled
  serial@21190000  disabled
  serial@211a0000  okay      → /dev/ttyS5
  serial@211b0000  disabled
  serial@211c0000  disabled

grep -ri "rs485" /proc/device-tree/  →  (không có kết quả)
```

## 3. Nhận định

| # | Quan sát | Kết luận | Mức chắc chắn |
|---|---|---|---|
| F-01 | Chỉ **2** UART được enable trong device tree; `ttyS2` đang có traffic (tx 40 872 / rx 4 680) — đúng là link IOP tới STM32 | Board hiện chỉ còn **một** UART rảnh (`ttyS5`) cho Modbus RTU | **Cao** — quan sát trực tiếp |
| F-02 | 6 UART còn lại của SoC ở trạng thái `disabled` trong DT | Về mặt SoC **có thể** enable thêm; nhưng có transceiver RS-485 nối vào hay không là câu hỏi phần cứng, không trả lời được từ phần mềm | **Trung bình** — cần schematic |
| F-03 | `grep -ri rs485 /proc/device-tree/` **không có kết quả** | Chưa cấu hình `rs485-*` / `linux,rs485-enabled-at-boot-time` trong DT. Điều khiển hướng truyền (DE/RE) của RS-485 half-duplex **chưa được thiết lập ở tầng kernel** | **Cao** |
| F-04 | Model là **Forlinx OK1126B-S** (SoC RV1126B), buildroot | Khác với `PRODUCT.md` đang ghi baseline compute là **Radxa CM3/RK3566** | **Cao** |
| F-05 | FE mặc định `rs485_port = /dev/ttyS3` | Device node này **không tồn tại** trên board production | **Cao** |

## 4. Hệ quả

### 4.1 Với `OD-MBRTU-001` / Q-01

Bằng chứng này **không tự đóng** quyết định, nhưng thu hẹp nó đáng kể:

- Với **provisioning hiện tại** của board production, chỉ chạy được **một** Modbus
  RTU master. Viết code hai-bus lúc này là viết cho một cổng không tồn tại.
- Để giữ Product baseline hai bus, phần cứng phải trả lời: (a) có transceiver
  RS-485 thứ hai trên bo không; (b) UART nào nối vào nó; (c) chân điều khiển
  hướng truyền là gì. Nếu không có transceiver thứ hai thì **không phần mềm nào
  tạo ra được cổng thứ hai**.

### 4.2 Với F-03 — điều khiển hướng RS-485

Đây là phát hiện **mới, chưa có trong bất kỳ tài liệu nào** và là blocker kỹ
thuật độc lập với số cổng. RS-485 half-duplex cần chuyển hướng driver đúng thời
điểm. Ba khả năng, cần phần cứng xác nhận:

1. Transceiver có mạch **auto-direction** (tự chuyển theo dòng dữ liệu) ⇒ không
   cần cấu hình gì thêm, nhưng phải đo dạng sóng để chứng minh không cắt frame.
2. Điều khiển bằng chân **RTS** ⇒ phải bật `rs485-*` trong device tree và dùng
   `modbus_rtu_set_serial_mode(ctx, MODBUS_RTU_RS485)`.
3. Điều khiển bằng **GPIO** riêng ⇒ cần driver hoặc code điều khiển GPIO thủ công,
   khó đạt đúng thời điểm ở baud cao.

Source hiện tại **không gọi** `modbus_rtu_set_serial_mode()` ở bất kỳ đâu, tức
đang ngầm giả định phương án 1. Giả định này chưa được kiểm chứng.

### 4.3 Với F-04 — sai khác SoC

`PRODUCT.md` ghi `Radxa CM3/RK3566`; board production thực tế là Forlinx OK1126B-S
(RV1126B). Đây là mâu thuẫn giữa tài liệu `Active` và phần cứng thật, **vượt phạm
vi Modbus RTU** và ảnh hưởng tới mọi tài liệu nhắc tới SoC (HW spec, ngân sách
CPU/RAM, benchmark realtime). Phải mở finding riêng cho Product/HW.

## 5. Giới hạn của bằng chứng

- Chỉ phản ánh **provisioning phần mềm tại thời điểm đo**, không phải năng lực
  phần cứng. Một UART `disabled` trong DT vẫn có thể có transceiver trên bo.
- Không đọc schematic, không đo điện, không tháo vỏ.
- Không kiểm tra `ttyS5` có thực sự nối ra chân RS-485 A/B hay chỉ là TTL header.
- Không chạy giao tiếp Modbus thật (chưa có slave đấu vào).

**Bước tiếp theo để đóng dứt điểm:** đối chiếu với schematic bo Foxlinx SOM-DDC-24
và, nếu có thể, đo bằng đồng hồ/oscilloscope trên chân A/B của connector.

## 6. Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-04 | Khảo sát read-only UART/RS485 trên board production; 5 finding |
