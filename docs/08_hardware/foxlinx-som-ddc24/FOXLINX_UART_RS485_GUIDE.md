# Hướng dẫn cấu hình UART / RS485 — Foxlinx SOM-DDC-24

> **ID:** HW-FOXLINX-UART-RS485-001  
> **Ngày:** 2026-08-05  
> **Trạng thái:** Active  
> **Liên quan:** [FOXLINX_PINOUT_MAP.md](FOXLINX_PINOUT_MAP.md) · [Khảo sát UART 2026-08-04](../../07_records/test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md)

---

## 1. Tình trạng hiện tại

### 1.1 Cổng UART đang hoạt động

| Device Node | DT Status | Vai trò | Tiến trình chiếm | Ghi chú |
|---|---|---|---|---|
| `/dev/ttyS2` | `okay` | IOP giao tiếp MCU STM32 (UART 921600 bps) | `mkddc-iobus` | **KHÔNG ĐỤNG VÀO** |
| `/dev/ttyS2` | (chia sẻ) | Bluetooth HCI transport | `rtk_hciattach -n -s 115200 /dev/ttyS2 rtk_h5` | BT dùng chung ttyS2 |
| `/dev/ttyS5` | `okay` | **RS485 #1 — Modbus RTU Master** | `mkddc-modbus-rtu` (khi chạy) | Cổng RS485 duy nhất hiện tại |

### 1.2 Cổng UART disabled (6 cổng)

Tất cả đều có thể bật bằng cách sửa Device Tree. Xem chi tiết tại [FOXLINX_PINOUT_MAP.md §2](FOXLINX_PINOUT_MAP.md#2-bảng-uart-mux-tổng-hợp).

### 1.3 Cấu hình RS485 trong Device Tree

```bash
# Kiểm tra trên board thực tế:
$ grep -ri "rs485" /proc/device-tree/
# → (không có kết quả)
```

**Phát hiện:** Kernel hiện chưa cấu hình `rs485-*` / `linux,rs485-enabled-at-boot-time`
cho bất kỳ UART nào. Điều khiển hướng truyền (DE/RE) **chưa được thiết lập ở tầng kernel**.

---

## 2. Đề xuất cổng RS485 #2: `/dev/ttyS1` (UART1 M1)

### 2.1 Lý do chọn

| Tiêu chí | UART1 M1 (ttyS1) | UART4 M0 (ttyS4) | UART3 M1 (ttyS3) |
|---|---|---|---|
| Chân trên P16 | 26 (TX), 36 (RX), 23 (RTS) | 37 (TX), 38 (RX), 13 (RTS) | 22 (TX), LCDC (RX) |
| Xung đột | SPI1 (có thể hy sinh) | **BT chiếm chân 37/38** | LCDC panel |
| Điện áp | 3.3V | 3.3V | 3.3V |
| Có chân RTS? | ✅ (`UART1_RTSN_M1`) | ✅ | ❌ |
| **Khả dụng?** | **✅ CÓ** | **❌ BT chặn** | **❌ Panel chặn** |

**Kết luận:** UART1 M1 là lựa chọn duy nhất khả thi trên Header P16 cho RS485 #2.

### 2.2 Sơ đồ đấu nối trên Header P16

```
   Module RS485               Header P16 (Foxlinx)
   ┌──────────┐               ┌──────────────────┐
   │   TXD  ──┼───────────────┤ Chân 26 (SPI1_CSN1_M1 → UART1_TX_M1)
   │   RXD  ──┼───────────────┤ Chân 36 (GPIO3_B7_D → UART1_RX_M1)
   │  DE/RE ──┼───────────────┤ Chân 23 (SPI1_CLK_M1 → UART1_RTSN_M1)
   │   GND  ──┼───────────────┤ Chân 25 (GND)
   │   VCC  ──┼───────────────┤ Chân 17 (VCC_3V3) hoặc Chân 2 (VCC_5V)
   │          │               │
   │   A   ──┼─── Bus RS485 ──┼── tới Slave devices
   │   B   ──┼─── Bus RS485 ──┼── tới Slave devices
   └──────────┘               └──────────────────┘
```

### 2.3 Lưu ý xung đột SPI1

Khi bật UART1 M1, các chân sau **mất chức năng SPI1**:

| Chân P16 | Chức năng SPI1 bị mất | Chức năng UART1 mới |
|:---:|---|---|
| 23 | SPI1_CLK | UART1_RTSN (DE/RE) |
| 24 | SPI1_CSN0 | UART1_CTSN |
| 26 | SPI1_CSN1 | UART1_TX |

Nếu dự án MK-DDC-24 **không dùng SPI1 trên Header P16** (ADS131M08 nối qua MCU SPI3,
không qua SoM), thì xung đột này **không ảnh hưởng**.

---

## 3. Quy trình bật UART mới trong Device Tree

### Bước 1: Tìm file DTS source

```bash
# Trên máy build (không phải trên board):
# File DTS nằm trong BSP SDK của Forlinx, thường ở:
# <SDK>/kernel/arch/arm64/boot/dts/rockchip/rk3588s-ok1126b-s.dts
# hoặc:
# <SDK>/kernel/arch/arm64/boot/dts/rockchip/rv1126b-ok1126b-s.dts
```

### Bước 2: Sửa node UART1 trong DTS

Thêm hoặc sửa node `&uart1` trong file `.dts` (hoặc file overlay `.dtso`):

```dts
/* Bật UART1 M1 cho RS485 #2 */
&uart1 {
    pinctrl-names = "default";
    pinctrl-0 = <&uart1m1_xfer &uart1m1_rtsn>;
    status = "okay";

    /* Cấu hình RS485 (nếu transceiver cần RTS điều khiển hướng) */
    linux,rs485-enabled-at-boot-time;
    rs485-rts-active-low;    /* Điều chỉnh theo mạch transceiver */
    rs485-rts-delay = <0 0>; /* [delay-before-send, delay-after-send] µs */
};
```

> [!WARNING]
> Nếu transceiver RS485 là loại **auto-direction** (tự chuyển hướng), **KHÔNG** cần
> các dòng `linux,rs485-*`. Chỉ cần `status = "okay";` và pinctrl xfer.

### Bước 3: Biên dịch DTB

```bash
# Trong SDK Forlinx:
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- dtbs

# Hoặc biên dịch trực tiếp:
dtc -I dts -O dtb -o rv1126b-ok1126b-s.dtb rv1126b-ok1126b-s.dts
```

### Bước 4: Nạp DTB vào boot partition

```bash
# Copy DTB mới lên board:
scp rv1126b-ok1126b-s.dtb SOM-DDC-24-foxlinx:/boot/

# Trên board, kiểm tra U-Boot biến trỏ đúng file:
fw_printenv fdt_file
# Nếu cần, sửa:
fw_setenv fdt_file rv1126b-ok1126b-s.dtb
```

### Bước 5: Reboot và kiểm tra

```bash
reboot

# Sau reboot:
ls -l /dev/ttyS1
# Phải thấy: crw-rw---- 1 root dialout 4, 65 ... /dev/ttyS1

cat /proc/tty/driver/serial | grep "^1:"
# Phải thấy: 1: uart:16550A mmio:0x21160000 irq:XX tx:0 rx:0

cat /proc/device-tree/serial@21160000/status
# Phải thấy: okay
```

---

## 4. Cấu hình RS485 Direction Control

### 4.1 Phương án 1: Auto-direction transceiver (đề xuất)

Nếu chip transceiver RS485 (ví dụ: MAX13487E, ISL32452E) có mạch tự động chuyển hướng:

- **Không cần cấu hình gì thêm** trong Device Tree hoặc phần mềm.
- Chỉ cần nối TXD, RXD, GND. Chân DE/RE không cần nối.
- **Cần kiểm chứng bằng oscilloscope:** đo dạng sóng trên bus A/B để xác nhận
  không cắt frame đầu/cuối ở baudrate cao (≥ 19200 bps).

### 4.2 Phương án 2: RTS kernel-managed

Nếu transceiver cần chân RTS điều khiển DE/RE:

```dts
&uart1 {
    /* ... pinctrl như trên ... */
    linux,rs485-enabled-at-boot-time;
    rs485-rts-active-low;         /* hoặc rs485-rts-active-high */
    rs485-rts-delay = <0 0>;
};
```

Trong phần mềm (libmodbus):

```c
modbus_rtu_set_serial_mode(ctx, MODBUS_RTU_RS485);
modbus_rtu_set_rts(ctx, MODBUS_RTU_RTS_UP);  /* hoặc DOWN, tùy mạch */
```

### 4.3 Phương án 3: GPIO userspace (không khuyến nghị)

Nếu chân điều khiển DE/RE không nối vào RTS mà vào GPIO riêng:

```c
// Trước khi gửi:
int gpio_fd = open("/sys/class/gpio/gpioXXX/value", O_WRONLY);
write(gpio_fd, "1", 1);  // DE high = transmit
// ... gửi data qua ttyS1 ...
tcdrain(serial_fd);       // chờ gửi xong
write(gpio_fd, "0", 1);  // DE low = receive
```

> [!CAUTION]
> Phương án GPIO userspace **không đảm bảo timing chính xác** ở baudrate cao.
> Có thể mất byte đầu/cuối frame. Chỉ dùng khi không có lựa chọn khác và baudrate ≤ 9600.

---

## 5. Cấu hình phần mềm MK-DDC-24

### 5.1 File `io_config.conf`

```conf
# RS485 cổng 1 (hiện tại):
[fieldbus.modbus_rtu.0]
uart_device = /dev/ttyS5
baud = 9600
parity = none
data_bits = 8
stop_bits = 1

# RS485 cổng 2 (khi bật ttyS1):
[fieldbus.modbus_rtu.1]
uart_device = /dev/ttyS1
baud = 9600
parity = none
data_bits = 8
stop_bits = 1
```

### 5.2 Kiểm tra giao tiếp cơ bản (không cần slave)

```bash
# Gửi dữ liệu test (trên board):
stty -F /dev/ttyS1 9600 cs8 -parenb -cstopb raw
echo "HELLO RS485" > /dev/ttyS1

# Đọc dữ liệu (trên board, terminal khác):
cat /dev/ttyS1

# Nếu nối loopback (TX → RX), sẽ thấy "HELLO RS485" in ra.
```

---

## 6. Checklist kiểm chứng RS485

- [ ] Device Tree đã sửa, DTB đã nạp, reboot xong
- [ ] `/dev/ttyS1` xuất hiện trong `/dev/`
- [ ] `cat /proc/device-tree/serial@21160000/status` trả về `okay`
- [ ] `stty -F /dev/ttyS1` chạy không lỗi
- [ ] Loopback test (nối TXD → RXD trên module) gửi/nhận OK
- [ ] Đấu nối slave Modbus RTU thật, poll register thành công
- [ ] Đo oscilloscope dạng sóng trên bus A/B (nếu dùng auto-direction)
- [ ] Chạy `mkddc-modbus-rtu` với config mới, service khởi động OK
- [ ] Stress test: gửi liên tục 1000 request, đo tỷ lệ lỗi CRC/timeout

---

## 7. Lịch sử phiên bản

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-05 | Phiên bản đầu tiên — đề xuất ttyS1 M1 cho RS485 #2, quy trình bật DT, direction control |
