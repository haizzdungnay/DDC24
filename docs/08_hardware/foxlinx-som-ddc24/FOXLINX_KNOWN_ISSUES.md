# Vấn đề đã biết & Findings — Foxlinx SOM-DDC-24

> **ID:** HW-FOXLINX-ISSUES-001  
> **Ngày:** 2026-08-05  
> **Trạng thái:** Active  
> **Mục đích:** Tập trung tất cả finding, defect và giới hạn đã phát hiện trên board
> production Foxlinx SOM-DDC-24 vào một nơi duy nhất.

---

## Bảng tổng hợp

| ID | Mức độ | Finding | Trạng thái | Ảnh hưởng | Bước tiếp theo | Tham chiếu |
|---|---|---|---|---|---|---|
| **FX-F01** | 🔴 Cao | `HW_SPEC` ghi SoM là **Radxa CM3 / RK3566**; board production thực tế là **Forlinx OK1126B-S / RV1126B**. Hai SoM không tương thích cơ khí và phần mềm. | **MỞ** | Mọi tài liệu nhắc SoC/SoM (HW spec, benchmark, thermal, BSP) đều sai | PM/HW quyết định sửa `HW_SPEC_MK-DDC-24_VI.md` §2 sang Foxlinx | Survey `F-04`, Review `Q-11` |
| **FX-F02** | 🟡 Trung bình | RS485 direction control **chưa cấu hình** trong Device Tree (`rs485-*` missing, `grep -ri rs485 /proc/device-tree/` trống). Source không gọi `modbus_rtu_set_serial_mode()`. | **MỞ** | Nếu transceiver không phải auto-direction → RS485 không hoạt động đúng ở half-duplex | HW xác nhận loại transceiver; nếu cần RTS → sửa DT + libmodbus | Survey `F-03`, Defect `D-13` |
| **FX-F03** | ✅ Đã sửa | FE default `rs485_port = /dev/ttyS3` — device node **không tồn tại** trên board production | **ĐÓNG** | Config sai → Modbus RTU không kết nối | Đã đổi sang `/dev/ttyS5` | Survey `F-05`, Defect `D-14` |
| **FX-F04** | 🟡 Trung bình | Board chỉ có **1 UART rảnh** (`ttyS5`) cho RS485. Cổng thứ 2 cần enable DT + xác nhận có transceiver phần cứng + chân đấu nối. | **MỞ** (PM đã đóng scope Rev A = 1 bus) | Rev A chỉ hỗ trợ 1 bus Modbus RTU. Mở rộng cần phần cứng. | Nếu cần RS485 #2: bật `ttyS1` M1 (chân P16: 26/36/23) + lắp transceiver | `OD-MBRTU-001`, Quyết định `Đ-01` |
| **FX-F05** | 🔵 Thông tin | Buildroot **không có** `apt`/`dpkg`/`pip`. Deploy bằng copy binary trực tiếp. | **Đã biết** | Team dev quen Debian cần lưu ý. Cross-compile bắt buộc. | Không hành động — thiết kế có chủ đích | — |
| **FX-F06** | 🔵 Thông tin | Bluetooth chiếm `/dev/ttyS2` (cùng UART với IOP MCU) qua `rtk_hciattach`. BT dùng riêng `hci0` UART transport, IOP dùng riêng data path. | **Ghi nhận** | Nếu tắt BT → giải phóng bandwidth trên ttyS2 cho IOP. Nhưng WiFi/BT RTL8821CS dùng SDIO cho WiFi, chỉ BT dùng UART. | Không hành động trừ khi có nhu cầu tắt BT | — |
| **FX-F07** | 🟡 Trung bình | Touch screen FT5436 **không phát hiện** trong Device Tree (`input` chỉ thấy `rk805 pwrkey` và `bt-powerkey`). HMI touch có thể không hoạt động trên board này. | **MỞ** | HMI touch input có thể không hoạt động | Kiểm tra DT node cho I2C touch driver; có thể cần enable + driver FT5436 | Mới phát hiện 2026-08-05 |
| **FX-F08** | 🔵 Thông tin | Board có **NPU 3.0 TOPS** (`/dev/rknpu`, RKNN, 800 MHz) — không có trong baseline `HW_SPEC` (Radxa CM3 không có NPU mạnh). | **Ghi nhận** | Mở ra khả năng AI edge (anomaly detection, predictive maintenance) trong tương lai | Đưa vào roadmap nếu cần | Mới phát hiện 2026-08-05 |
| **FX-F09** | 🔵 Thông tin | Board có **2× CAN FD** (disabled trong DT). Có pinctrl M0/M1 sẵn. | **Ghi nhận** | Mở ra khả năng tích hợp CAN FD cho BMS/EV trong tương lai | Đưa vào roadmap nếu cần | Mới phát hiện 2026-08-05 |

---

## Chi tiết từng finding

### FX-F01 — Mâu thuẫn SoM giữa tài liệu và thực tế

**Bằng chứng:**
```
# Trên board thực tế:
$ cat /proc/device-tree/model
Forlinx OK1126B-S Board

# Trong HW_SPEC_MK-DDC-24_VI.md §2.1:
# "SOM Đã Chọn — Radxa CM3"
# "CPU: Quad-core ARM Cortex-A55 @ 1.8 GHz, RK3566"
```

**So sánh chi tiết:** Xem [FOXLINX_SOM_DDC24_SPEC.md §4](FOXLINX_SOM_DDC24_SPEC.md#4-so-sánh-baseline-radxa-cm3-hw_spec-vs-foxlinx-ok1126b-s-thực-tế).

---

### FX-F02 — RS485 direction control chưa cấu hình

**Bằng chứng:**
```bash
$ grep -ri "rs485" /proc/device-tree/
# (không có kết quả)

$ grep -r "modbus_rtu_set_serial_mode" apps/
# (không có kết quả)
```

**Hướng xử lý:** Xem [FOXLINX_UART_RS485_GUIDE.md §4](FOXLINX_UART_RS485_GUIDE.md#4-cấu-hình-rs485-direction-control).

---

### FX-F07 — Touch screen FT5436 không phát hiện

**Bằng chứng:**
```bash
$ find /sys/devices -name 'name' -path '*input*' -exec sh -c 'echo "$1: $(cat $1)"' _ {} \;
/sys/devices/platform/wireless-bluetooth/input/input1/name: bt-powerkey
/sys/devices/platform/21100000.i2c/i2c-0/0-0027/rk805-pwrkey/input/input0/name: rk805 pwrkey
# → Không có FT5436 / touch input
```

**Lưu ý:** DSI panel (`card0-DSI-1`, 1024×600) **đang hoạt động** (`connected`). Chỉ touch input
chưa được phát hiện. Có thể cần:
1. Enable node I2C touch trong Device Tree.
2. Nạp driver `ft5x06_ts` hoặc tương đương.
3. Kiểm tra kết nối vật lý cáp FPC touch panel.

---

### FX-F08 — NPU 3.0 TOPS khả dụng

**Bằng chứng:**
```bash
$ ls /dev/rknpu
/dev/rknpu

$ cat /sys/class/devfreq/22000000.npu/max_freq
800000000

$ cat /sys/class/devfreq/22000000.npu/cur_freq
800000000
```

NPU RKNN 3.0 TOPS đang active và sẵn sàng sử dụng. Hỗ trợ TensorFlow Lite, ONNX, Caffe, PyTorch
qua toolchain RKNN-Toolkit2 của Rockchip.

---

### FX-F09 — CAN FD khả dụng

**Bằng chứng:**
```bash
$ cat /proc/device-tree/can@21d40000/status
disabled

$ cat /proc/device-tree/can@21d50000/status
disabled
```

Cả 2 bus CAN FD đều có pinctrl M0/M1 sẵn trong DT. Chỉ cần `status = "okay";` và có
transceiver CAN trên carrier board.

---

## Lịch sử phiên bản

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-05 | Phiên bản đầu tiên — 9 finding từ khảo sát SSH live + review tài liệu. 3 finding mới (F07-F09) |
