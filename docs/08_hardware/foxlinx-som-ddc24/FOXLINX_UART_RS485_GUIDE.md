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

> [!NOTE]
> **Đã đo xác nhận 2026-08-18** (`EVID-MBRTU-FOXLINX-P16-2026-08-18`): `uart5` được
> mux đúng ra **Header P16 chân 8 (TX) và chân 10 (RX)** — `pin 134 (gpio4-6)` và
> `pin 135 (gpio4-7)`, nhóm `uart5m0-xfer-pins`. Chân 8 đã đo thấy **dao động đúng
> 50%** khi truyền mẫu `0x55`, tức uart5 thật sự lái được chân trên header.
> Không cần sửa device tree gì thêm cho cổng RS-485 #1.
>
> Điều **chưa** chứng minh được từ phía SoC là đường **RX**: chân 10 có
> `input bias pull up` nội, nên lúc thả nổi nó đọc ra mức cao y hệt lúc có
> transceiver giữ idle. Chỉ loopback hoặc một slave thật mới tách được — xem §4.4.

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

### 4.4 Kiểm chứng cổng bằng `rs485_check.sh`

Script `tools/rs485/rs485_check.sh` (đưa lên board tại `/usr/local/bin/rs485_check.sh`)
gói lại ba phép kiểm hay dùng. Lý do có script riêng: **trạng thái "RS-485 dùng được
chưa" không đọc được từ device tree** — DT chỉ nói UART đã enable và chân đã mux, nó
không nói dây RX có nối vào transceiver hay không.

```bash
# Xem cổng trỏ đi đâu, mux ra chân nào, có tiến trình nào đang giữ không
rs485_check.sh info /dev/rs485-1

# Kiểm đường TX+RX của SoC — cần nối tắt P16 chân 8 ↔ chân 10 trước
rs485_check.sh loopback /dev/rs485-1 9600

# Kiểm end-to-end tới thiết bị thật trên bus A/B (bằng chứng mạnh nhất)
rs485_check.sh scan /dev/rs485-1 9600 1 247
```

`scan` gửi khung Modbus `0x03` cho từng slave và coi **bất kỳ** khung trả lời nào —
kể cả exception — là bằng chứng cả TX lẫn RX đều thông.

> [!CAUTION]
> `scan` mở và ghi lên cổng. Nếu `mkddc-iobus` đang chạy Modbus RTU thật trên bus đó
> thì dừng nó trước, nếu không hai bên sẽ tranh nhau đường truyền và cả hai cùng lỗi.
> Chạy `rs485_check.sh info` để biết cổng có đang bị giữ không.

### 4.5 Bảng đấu dây RS-485 #1 trên Header P16

| Chân module RS-485 | Nối vào P16 | Tín hiệu SoC |
|---|:---:|---|
| TXD (vào module) | **8** | `GPIO4_A6` — UART5_TX_M0 |
| RXD (ra module) | **10** | `GPIO4_A7` — UART5_RX_M0 |
| GND | 6 (hoặc 14/20/25/30/34/39) | — |
| VCC | 1 / 17 (3V3), hoặc 2 / 4 (5V) | theo yêu cầu module |
| DE/RE | **không nối** | transceiver auto-direction; kernel không lái DE/RE |

> [!WARNING]
> **Chân 7 không phải chân UART.** `GPIO0_C7` ở chân 7 là GPIO thường và đang
> `MUX UNCLAIMED`. Nối RXD của module vào chân 7 thì cổng sẽ gửi được nhưng không
> bao giờ nhận được byte nào — triệu chứng giống hệt "slave không trả lời".

---

## 5. Phương án Link cứng Device Node (Symlinks cho 2 Cổng RS485)

Để đảm bảo phần mềm `mkddc-iobus` và `mkddc-web-api` truy cập ổn định, độc lập với chỉ số bus phần cứng của Linux kernel, dự án áp dụng **Phương án Link Cứng (Symbolic Links Canonical)**:

- **Bus 1 (RS485 #1):** `/dev/rs485-1` → trỏ tới `/dev/ttyS5` (`serial@21150000`)
- **Bus 2 (RS485 #2):** `/dev/rs485-2` → trỏ tới `/dev/ttyS1` (`serial@21160000`, UART1 M1 Header P16)

```text
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ SYSTEM HARDWARE DEVICE NODES                  CANONICAL SOFTWARE LINKS  │
 │                                                                         │
 │  /dev/ttyS5 (serial@21150000, RS485 #1)  ◄──────  /dev/rs485-1          │
 │  /dev/ttyS1 (serial@21160000, RS485 #2)  ◄──────  /dev/rs485-2          │
 └─────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Cấu hình udev rules (`/etc/udev/rules.d/99-rs485.rules`)

Trên Buildroot / Linux hệ thống, tạo file quy tắc udev:

```ini
# /etc/udev/rules.d/99-rs485.rules
# Tự động tạo symlink cố định cho 2 cổng RS485 khi khởi động
KERNEL=="ttyS5", SYMLINK+="rs485-1", MODE="0666", GROUP="dialout"
KERNEL=="ttyS1", SYMLINK+="rs485-2", MODE="0666", GROUP="dialout"
```

### 5.2 Boot Startup Script (`/etc/init.d/S05-rs485-symlinks.sh`)

Đối với môi trường Buildroot chưa có daemon udev đầy đủ, tạo script khởi động tại `/etc/init.d/S05-rs485-symlinks.sh`:

```bash
#!/bin/sh
# S05-rs485-symlinks.sh — Tạo link cứng cố định cho 2 cổng RS485 trên Foxlinx SOM-DDC-24

case "$1" in
  start)
    echo "Creating RS485 device symlinks..."
    [ -e /dev/ttyS5 ] && ln -sf /dev/ttyS5 /dev/rs485-1
    [ -e /dev/ttyS1 ] && ln -sf /dev/ttyS1 /dev/rs485-2
    chmod 666 /dev/ttyS5 /dev/ttyS1 2>/dev/null || true
    echo "RS485 symlinks created: /dev/rs485-1 -> /dev/ttyS5, /dev/rs485-2 -> /dev/ttyS1"
    ;;
  stop)
    rm -f /dev/rs485-1 /dev/rs485-2
    ;;
  restart|reload)
    $0 stop
    $0 start
    ;;
  *)
    echo "Usage: $0 {start|stop|restart}"
    exit 1
    ;;
esac

exit 0
```

Phân quyền thực thi: `chmod +x /etc/init.d/S05-rs485-symlinks.sh`

---

## 6. Setup FW-SOM cho 2 Cổng RS485 (Multi-Bus Engine Setup)

### 6.1 Cấu hình Cấu trúc `fieldbus.conf` (/etc/ddc24/fieldbus.conf)

Phần mềm `mkddc-iobus` và `mkddc-web-api` sử dụng cấu hình canonical 2 bus RS485:

```json
{
  "version": 1,
  "config_revision": 2,
  "buses": [
    {
      "bus_id": 1,
      "name": "RS485-1 (Main Bus)",
      "enabled": true,
      "port": "/dev/rs485-1",
      "baud_rate": 9600,
      "data_bits": 8,
      "parity": "N",
      "stop_bits": 1,
      "direction_control": "auto",
      "offline_probe_ms": 5000
    },
    {
      "bus_id": 2,
      "name": "RS485-2 (Expansion Bus)",
      "enabled": true,
      "port": "/dev/rs485-2",
      "baud_rate": 9600,
      "data_bits": 8,
      "parity": "N",
      "stop_bits": 1,
      "direction_control": "rts",
      "offline_probe_ms": 5000
    }
  ],
  "devices": [
    {
      "device_id": "METER_01",
      "bus_id": 1,
      "slave_id": 1,
      "enabled": true,
      "poll_interval_ms": 1000,
      "timeout_ms": 500,
      "retry_attempts": 1,
      "offline_after_errors": 2
    },
    {
      "device_id": "VFD_01",
      "bus_id": 2,
      "slave_id": 2,
      "enabled": true,
      "poll_interval_ms": 500,
      "timeout_ms": 300,
      "retry_attempts": 1,
      "offline_after_errors": 2
    }
  ]
}
```

### 6.2 Mô hình Khởi chạy FW-SOM Multi-Worker (`mkddc-iobus`)

Trong C++ runtime của `mkddc-iobus`:

1. **Khởi tạo Thread Worker riêng biệt:**
   - Mỗi cổng RS485 được quản lý bởi một đối tượng `BusWorker(bus_id)` chạy trên 01 OS Thread độc lập.
   - `Worker #1`: Khởi tạo `libmodbus` context kết nối `/dev/rs485-1` (Bus 1).
   - `Worker #2`: Khởi tạo `libmodbus` context kết nối `/dev/rs485-2` (Bus 2).
2. **Lập lịch EDF Độc lập (Independent Earliest Deadline First):**
   - Hai BusWorker hoạt động song song không gây block nghẽn lẫn nhau. Nếu Bus 2 bị đứt dây/chết slave, Bus 1 vẫn polling bình thường ở tốc độ 1000ms.
3. **Tổng hợp Snapshot Datagram:**
   - Kết quả đọc dữ liệu từ cả 2 bus được nạp vào bộ nhớ Shared Memory `plc_shm.ext[]` và đóng gói thành 1 Datagram Snapshot chung gửi sang `mkddc-core` qua Unix Domain Socket.

### 6.3 Kiểm tra Giao tiếp Cơ bản 2 Cổng (Loopback Test)

```bash
# Kiểm tra sự tồn tại của 2 link cứng:
ls -la /dev/rs485-1 /dev/rs485-2
# Output:
# lrwxrwxrwx 1 root root 10 Aug  5 15:00 /dev/rs485-1 -> /dev/ttyS5
# lrwxrwxrwx 1 root root 10 Aug  5 15:00 /dev/rs485-2 -> /dev/ttyS1

# Test Cổng 1 (/dev/rs485-1):
stty -F /dev/rs485-1 9600 cs8 -parenb -cstopb raw
echo "TEST RS485 BUS 1" > /dev/rs485-1

# Test Cổng 2 (/dev/rs485-2):
stty -F /dev/rs485-2 9600 cs8 -parenb -cstopb raw
echo "TEST RS485 BUS 2" > /dev/rs485-2
```

---

## 7. Checklist kiểm chứng RS485 (2 Cổng S1 & S5)

- [ ] Device Tree đã sửa (bật `uart1` M1 & `uart5`), DTB đã nạp, reboot xong
- [ ] `/dev/ttyS5` và `/dev/ttyS1` đều xuất hiện trong `/dev/`
- [ ] Link cứng `/dev/rs485-1` và `/dev/rs485-2` tự động tạo đúng sau khi boot
- [ ] `stty -F /dev/rs485-1` và `stty -F /dev/rs485-2` chạy không lỗi
- [ ] Loopback test (nối TXD → RXD trên từng module) gửi/nhận OK cho cả 2 cổng
- [ ] Đấu nối slave Modbus RTU thật trên từng cổng, poll register độc lập thành công
- [ ] `mkddc-iobus` khởi chạy 2 `BusWorker` đồng thời mà không bị tranh chấp tài nguyên
- [ ] Stress test: gửi liên tục trên cả 2 bus cùng lúc, đo tỷ lệ lỗi CRC/timeout độc lập
- [ ] Đo oscilloscope dạng sóng trên bus A/B (nếu dùng auto-direction)
- [ ] Chạy `mkddc-modbus-rtu` với config mới, service khởi động OK
- [ ] Stress test: gửi liên tục 1000 request, đo tỷ lệ lỗi CRC/timeout

---

## 7. Lịch sử phiên bản

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-05 | Phiên bản đầu tiên — đề xuất ttyS1 M1 cho RS485 #2, quy trình bật DT, direction control |
| 1.1 | 2026-08-18 | Ghi nhận kết quả đo trên board: uart5 mux đúng ra P16 chân 8/10 và TX lái được chân thật; thêm §4.4 công cụ `rs485_check.sh` và §4.5 bảng đấu dây; cảnh báo chân 7 không phải chân UART |
