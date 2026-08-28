# Kiểm chứng cổng RS-485 trên Header P16 sau khi đấu module — 2026-08-18

**ID:** EVID-MBRTU-FOXLINX-P16-2026-08-18
**Ngày:** 2026-08-18
**Board:** Foxlinx SOM-DDC-24, alias SSH `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`)
**Bối cảnh:** phần cứng vừa đấu module RS-485 vào Header P16 (báo là "chân 6-8")
**Loại thao tác:** đọc trạng thái + gửi byte thử ra cổng RS-485-1. **Không** sửa
device tree, **không** sửa `fieldbus.conf`, **không** restart service nào.
**Liên quan:** [FOXLINX_PINOUT_MAP.md](../../../08_hardware/foxlinx-som-ddc24/FOXLINX_PINOUT_MAP.md) ·
[FOXLINX_UART_RS485_GUIDE.md](../../../08_hardware/foxlinx-som-ddc24/FOXLINX_UART_RS485_GUIDE.md) ·
[ENABLE_TTYS1_RS485_2.md](../../../08_hardware/foxlinx-som-ddc24/ENABLE_TTYS1_RS485_2.md)

---

## 1. Kết luận ngắn

| Câu hỏi | Trả lời | Mức bằng chứng |
|---|---|---|
| RS-485 #1 dùng được chưa? | **Đường phần mềm và pin mux: SẴN SÀNG.** Đấu nối đúng cặp chân (8/10). Chưa có slave nào trả lời — nguyên nhân còn để mở | đo trực tiếp + sơ đồ mạch |
| Có cần "setup link sys map" tới UART không? | **Không — đã có sẵn và đã bền qua reboot.** `/dev/rs485-1 → ttyS5` do udev rule `99-mkddc-rs485.rules` tạo | đọc rule + `ls -l` |
| Chân nào là RS-485 #1 trên P16? | **chân 8 = TX, chân 10 = RX, chân 6 = GND** | xác nhận bằng đo mức chân lúc truyền |
| RS-485 #2 (`ttyS1`) dùng được chưa? | **Chưa.** Vẫn `status="disabled"`, và **thêm một chặn nữa chưa từng ghi nhận** — xem §5 | đọc device tree |

> [!IMPORTANT]
> **Đấu nối đã xác nhận (hardware owner, kèm sơ đồ mạch P16):** module RS-485 nối
> vào **chân 8 (TXD) và chân 10 (RXD)** — đúng cặp `uart5m0-xfer`. Sơ đồ mạch cũng
> xác nhận độc lập kết quả đo ở §4:
>
> ```text
> chân 6  GND   GND
> chân 8  TXD   UART5_TX_M0   DT18
> chân 10 RXD   UART5_RX_M0   DT19
> ```
>
> Vậy **đấu nối tín hiệu là đúng**, và câu hỏi chuyển từ "nối nhầm chân à?" sang
> "vì sao nối đúng mà `rx` vẫn bằng 0?". Xem §7.

**Ba thứ cần xác nhận tiếp** (theo thứ tự tốn công tăng dần), vì tín hiệu đã đúng
chân nhưng `rx` vẫn 0:

1. **Module đã có nguồn và mass chưa?** Chân 8/10 chỉ là tín hiệu. Module cần
   **VCC** (chân 2/4 = 5V, hoặc chân 1/17 = 3V3, tùy module) và **GND** (chân 6
   hoặc 14/20/25/30/34/39). Thiếu một trong hai thì mức logic không có tham chiếu
   và cổng im lặng đúng như quan sát được.
2. **Trên bus A/B đã có slave nào chưa?** Quét ở §5 không có ai trả lời. Nếu bus
   còn trống thì `rx:0` là kết quả **đúng**, không phải lỗi.
3. **Baud/parity của slave có khớp 9600/8N1 không?** Quét chỉ thử 9600 8N1.

---

## 2. Trạng thái UART trên board

```text
$ cat /proc/tty/driver/serial
2: uart:16550A mmio:0x21170000 irq:62 tx:40864 rx:4680 RTS|CTS|DTR
5: uart:16550A mmio:0x211A0000 irq:63 tx:0 rx:0

$ (device tree, status của từng node serial)
serial@20810000 (uart0): disabled
serial@21160000 (uart1): disabled     ← RS-485 #2 dự kiến
serial@21170000 (uart2): okay         ← IOP/MCU + Bluetooth, KHÔNG ĐỤNG
serial@21180000 (uart3): disabled
serial@21190000 (uart4): disabled
serial@211a0000 (uart5): okay         ← RS-485 #1
serial@211b0000 (uart6): disabled
serial@211c0000 (uart7): disabled

$ ls -l /dev/rs485* /dev/ttyS*
lrwxrwxrwx 1 root root        5 /dev/rs485-1 -> ttyS5
crw-rw---- 1 root dialout 4, 66 /dev/ttyS2
crw-rw---- 1 root dialout 4, 69 /dev/ttyS5
```

`ttyS5` có `tx:0 rx:0` — trước phiên này **chưa có byte nào từng đi qua cổng RS-485 #1**.

---

## 3. Pin mux: xác nhận chân 8/10 thuộc về uart5

```text
$ grep uart5 /sys/kernel/debug/pinctrl/pinctrl-rockchip-pinctrl/pinmux-pins
pin 134 (gpio4-6): 211a0000.serial (GPIO UNCLAIMED) function uart5 group uart5m0-xfer-pins
pin 135 (gpio4-7): 211a0000.serial (GPIO UNCLAIMED) function uart5 group uart5m0-xfer-pins
```

`gpio4-6` = `GPIO4_A6` = **P16 chân 8**; `gpio4-7` = `GPIO4_A7` = **P16 chân 10**.
Cả hai đã được driver `211a0000.serial` chiếm với function `uart5`, nhóm `uart5m0-xfer-pins`.
Nghĩa là **không cần sửa gì ở device tree cho RS-485 #1** — pin mux đã đúng và đã áp.

Nhóm `uart5m0-ctsn/rtsn` **không** nằm trong `pinctrl-0` của node, và node `serial@211a0000`
**không có** thuộc tính `rs485-*` nào. Tức kernel không điều khiển DE/RE — khớp với
kết luận của hardware owner ngày 2026-08-06 rằng transceiver là loại auto-direction.

---

## 4. Phép đo phân biệt TX/RX (đo mức chân thật lúc đang truyền)

Chỉ đọc bộ đếm `tx:`/`rx:` là không đủ: bộ đếm `tx` tăng ngay cả khi chân không nối
đi đâu cả. Nên phép đo dưới đây đọc thẳng thanh ghi `GPIO_EXT_PORT` của bank GPIO4
(`0x21800000 + 0x70`) bằng `devmem`, **không** đổi pin mux, trong lúc đẩy chuỗi ký tự
`'U'` (`0x55`, mẫu bit xen kẽ 0101) ra cổng ở 9600 bps.

```text
--- lúc rảnh (5 mẫu) ---
raw=0x000000FB   chân8/gpio4-6 = 1   chân10/gpio4-7 = 1

--- lúc truyền liên tục (40 mẫu) ---
chân8/gpio4-6  mức cao 20/40 mẫu   → CÓ dao động
chân10/gpio4-7 mức cao 40/40 mẫu   → KHÔNG dao động

$ cat /proc/tty/driver/serial   (sau phép thử)
5: uart:16550A mmio:0x211A0000 irq:63 tx:428 rx:0
```

**Đọc kết quả:**

1. **Chân 8 dao động đúng 50% khi truyền `0x55`** ⇒ uart5 thật sự đang lái mức
   điện áp ra chân 8 của header. Đây cũng là bằng chứng thực nghiệm xác định
   **chân 8 là TX** (chứ không phải suy ra từ tài liệu).
2. **Chân 10 giữ mức cao suốt** và `rx:0`. Điều này **chưa kết luận được gì**, vì:

```text
$ grep "pin 135" .../pinconf-pins
pin 135 (gpio4-7): input bias pull up (1 ohms), ...
```

Chân 10 **có pull-up nội**. Một chân thả nổi có pull-up đọc ra mức cao **y hệt**
một transceiver đang giữ đường idle ở mức mark. Hai trạng thái này không phân
biệt được bằng bất kỳ phép đo tĩnh nào từ phía SoC.

---

## 5. Quét Modbus RTU thật — không có slave trả lời

Dùng `tools/rs485/rs485_check.sh` (đưa lên board tại `/usr/local/bin/`), gửi khung
`0x03` (read holding registers) tới slave 1..32 ở 9600 bps, mỗi khung chờ 300 ms:

```text
== Quét Modbus RTU trên /dev/rs485-1 @ 9600bps, slave 1..32 ==
Tổng bộ đếm: 5: uart:16550A mmio:0x211A0000 irq:63 tx:684 rx:0
KẾT QUẢ  : KHÔNG CÓ SLAVE TRẢ LỜI.
```

`tx` tăng 428 → 684 = đúng 256 byte = 32 khung × 8 byte ⇒ khung đã ra khỏi cổng
đầy đủ. `rx` vẫn 0.

Kết quả này **cũng không phân biệt được** "bus A/B chưa có slave nào" với "dây RX
chưa nối". Cần một trong hai phép thử ở §7 để tách.


### 5.1 Đo lại sau khi biết đấu nối là chân 8/10 (cùng ngày)

Biết chắc tín hiệu đã đúng chân, đo lại ba phép nữa để thu hẹp nguyên nhân:

| Phép đo | Kết quả |
|---|---|
| Chân 10 lúc rảnh | mức cao, ổn định (3/3 mẫu) |
| Chân 10 trong lúc truyền `0x55` liên tục | **60/60 mẫu mức cao — không dao động**, tức module **không** echo lại |
| Mở cổng nghe thụ động 3 giây | `rx: 0 → 0`, không byte nào |
| Quét Modbus 1..16 @ **9600** | không ai trả lời (`tx` lên 1412) |
| Quét Modbus 1..16 @ **19200** | không ai trả lời (`tx` lên 1540) |

**Thu hẹp còn ba khả năng**, xếp theo mức khả dĩ:

1. **Module chưa được cấp nguồn.** Chân 8 và 10 chỉ là hai đường tín hiệu. Module
   RS-485 bắt buộc phải có **VCC** và **GND** riêng. Nếu chỉ cắm đúng hai chân
   8/10 thì con transceiver không chạy, và mọi triệu chứng quan sát được — không
   echo, không nhận, bus câm — đều khớp chính xác với trường hợp này.
2. **Bus A/B chưa có slave.** Khi đó `rx:0` là kết quả **đúng**, không phải lỗi.
3. **Sai baud/parity** so với slave (đã loại trừ 9600 và 19200 ở 8N1).

Chưa loại trừ được khả năng nào bằng cách đo từ xa: cả ba đều cho cùng một quan
sát. Phép thử tách chúng ra là loopback ở §7 — nối tắt chân 8 ↔ chân 10 để **bỏ
module ra khỏi phương trình**, xác định dứt điểm phần SoC có thông hay không.

---

## 6. Tầng phần mềm đã sẵn sàng

```text
$ cat /etc/udev/rules.d/99-mkddc-rs485.rules   (phần rule)
SUBSYSTEM=="tty", KERNEL=="ttyS5", SYMLINK+="rs485-1", GROUP="dialout", MODE="0660"
SUBSYSTEM=="tty", KERNEL=="ttyS1", SYMLINK+="rs485-2", GROUP="dialout", MODE="0660"

$ cat /data/config/fieldbus.conf   (rút gọn)
buses[0]: bus_id=rs485-1  port=/dev/rs485-1  baud=9600   direction=auto  enabled=true
buses[1]: bus_id=rs485-2  port=/dev/rs485-2  baud=19200                  enabled=true
revision=35
```

Symlink `/dev/rs485-1` là **do udev tạo**, không phải `ln -s` thủ công, nên nó bền
qua reboot. Không có việc gì phải làm thêm cho "link sys map".

Lưu ý trạng thái vận hành hiện tại: `mkddc-iobus` đang chạy với drop-in
`ExecStart=/usr/sbin/mkddc-iobus --uart /tmp/mkddc-iop-a`, tức **chế độ fake MCU**,
và không tiến trình nào đang mở `/dev/ttyS5` (kiểm bằng quét `/proc/*/fd`). Cổng
RS-485 #1 hiện đang rảnh — đó là lý do phép thử ở §4/§5 chạy được mà không tranh chấp.

---

## 7. Việc còn lại để đóng câu hỏi "RS-485 dùng được chưa"

> [!NOTE]
> **Đã có câu trả lời:** đường RX vật lý **chưa nối** (xem §1). Sau khi phần cứng
> nối chân 10 và cấp nguồn module, chạy một trong hai phép thử dưới đây để xác
> nhận lại bằng số đo chứ không bằng suy luận.

Hai cách, cách nào cũng đủ:

**Cách A — loopback tại header (không đụng bus A/B, kiểm phần SoC):**
rút module ra, nối tắt **P16 chân 8 ↔ chân 10** bằng một jumper, rồi chạy trên board:

```bash
/usr/local/bin/rs485_check.sh loopback /dev/rs485-1 9600
```

Đạt ⇒ TX và RX của SoC đều thông, lỗi (nếu có) nằm ở module hoặc dây.

**Cách B — có slave thật trên bus (mức bằng chứng cao nhất):**
đấu một thiết bị Modbus RTU vào A/B, đặt đúng baud, rồi:

```bash
/usr/local/bin/rs485_check.sh scan /dev/rs485-1 9600 1 247
```

Bất kỳ khung trả lời nào (kể cả exception) đều chứng minh cả TX lẫn RX thông tới
thiết bị thật.

**Trước khi chạy, xác nhận đấu nối theo đúng bảng này:**

| Chân module RS-485 | Phải nối vào P16 | Ghi chú |
|---|---|---|
| TXD (vào module) | **chân 8** | `GPIO4_A6`, đã xác nhận là TX |
| RXD (ra module) | **chân 10** | `GPIO4_A7` — **không phải chân 7** |
| GND | chân 6 (hoặc 14/20/25/30/34/39) | |
| VCC | chân 1/17 (3V3) hoặc chân 2/4 (5V) | theo yêu cầu của module |
| DE/RE | **không nối** | transceiver auto-direction; kernel không điều khiển DE/RE |

---

## 8. Phát hiện ngoài phạm vi: `ENABLE_TTYS1_RS485_2.md` §2 sai

Tài liệu `ENABLE_TTYS1_RS485_2.md` khẳng định để bật RS-485 #2 thì
"**không cần thêm hay sửa pin mux**", chỉ cần đổi `status` của `serial@21160000`
thành `okay`. **Điều này sai.** Đọc `pinctrl-0` thật của node uart1:

```text
$ hexdump -C /proc/device-tree/serial@21160000/pinctrl-0
00000000  00 00 00 b2 00 00 00 b3  00 00 00 b4

$ (phandle của các nhóm chân uart1)
uart1m0-xfer-pins: 0x000000b2   ← đang được trỏ tới
uart1m0-ctsn-pins: 0x000000b3   ← đang được trỏ tới
uart1m0-rtsn-pins: 0x000000b4   ← đang được trỏ tới
uart1m1-xfer-pins: 0x0000035b
uart1m1-rtsn-pins: 0x0000035d
```

`pinctrl-0` hiện trỏ vào nhóm **M0**, không phải M1. Và nhóm M0 nằm ở chân khác hẳn:

```text
uart1m0-xfer-pins → bank 0, pin 21 (GPIO0_C5) + bank 0, pin 20 (GPIO0_C4), func 3
uart1m1-xfer-pins → bank 3, pin 15 (GPIO3_B7) + bank 3, pin 14 (GPIO3_B6), func 4
uart1m1-rtsn-pins → bank 3, pin 12 (GPIO3_B4), func 4
```

`GPIO0_C4`/`GPIO0_C5` **không ra Header P16** (P16 chỉ có `GPIO0_C6` ở chân 5 và
`GPIO0_C7` ở chân 7). Nhóm M1 mới là nhóm ra chân 26/36/23 như thiết kế mong muốn.

**Hệ quả thực tế:** nếu chỉ đổi `status = "okay"` như tài liệu hướng dẫn, `/dev/ttyS1`
sẽ xuất hiện và mọi kiểm tra ở tầng phần mềm sẽ "xanh", nhưng UART bị route ra
`GPIO0_C4/C5` — **không có tín hiệu nào ở chân 26/36 trên header**. Đây là kiểu lỗi
tốn nhiều giờ dò vì triệu chứng giống hệt "dây đứt". Bản vá device tree **bắt buộc**
phải đổi cả `pinctrl-0`:

```dts
&uart1 {
    pinctrl-names = "default";
    pinctrl-0 = <&uart1m1_xfer>;   /* KHÔNG để nguyên uart1m0_xfer */
    status = "okay";
};
```

Đã sửa lại tài liệu `ENABLE_TTYS1_RS485_2.md` trong cùng phiên.

---

## 9. Lệnh đã chạy (đầy đủ, để tái lập)

```bash
cat /proc/tty/driver/serial
cat /proc/device-tree/serial@*/status
ls -l /dev/ttyS* /dev/rs485*
hexdump -C /proc/device-tree/serial@211a0000/pinctrl-0
hexdump -C /proc/device-tree/serial@21160000/pinctrl-0
hexdump -C /proc/device-tree/pinctrl/uart{1,5}/*/rockchip,pins
mount -t debugfs none /sys/kernel/debug
grep -i uart /sys/kernel/debug/pinctrl/pinctrl-rockchip-pinctrl/pinmux-pins
grep "pin 13[45]" /sys/kernel/debug/pinctrl/pinctrl-rockchip-pinctrl/pinconf-pins
stty -F /dev/ttyS5 9600 cs8 -parenb -cstopb raw -echo
printf 'MEKONG-RS485-TEST-1234567890' > /dev/ttyS5
devmem 0x21800070 32          # GPIO4 EXT_PORT, lấy mẫu lúc rảnh và lúc truyền
cat /etc/udev/rules.d/99-mkddc-rs485.rules
cat /data/config/fieldbus.conf
/usr/local/bin/rs485_check.sh info /dev/rs485-1
/usr/local/bin/rs485_check.sh scan /dev/rs485-1 9600 1 32
```

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.1 | 2026-08-18 | Hardware owner xác nhận kèm sơ đồ mạch P16: module nối **chân 8 (TXD) + chân 10 (RXD)** — đúng cặp `uart5m0-xfer`. Sơ đồ xác nhận độc lập kết quả đo chân 8=TX / chân 10=RX ở §4. `rx:0` vì vậy **chưa có lời giải**; chuyển ba khả năng còn lại (nguồn/mass module, bus chưa có slave, sai baud) sang §1 và §7 |
| 1.0 | 2026-08-18 | Tạo hồ sơ: xác nhận uart5/ttyS5 đã mux đúng ra P16 chân 8/10 và TX lái được chân thật; RX chưa chứng minh vì có pull-up nội; phát hiện `pinctrl-0` của uart1 trỏ nhầm nhóm M0 làm hỏng hướng dẫn bật RS-485 #2 |
