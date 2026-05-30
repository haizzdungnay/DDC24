# HW_SPEC — MK-DDC-24 Hardware Specification

> **Phiên bản:** 1.1 | 2026-05-28  
> **Trạng thái:** Draft — Ver 1  
> **Tác giả:** KINEXUS Technologies — Hardware Team  
> **Chuẩn tham chiếu:** IEC 61010-1, IEC 60068, IEC 61326-1, RoHS 3, REACH  
> **Liên quan:** [DS](DS_MK-DDC-24_VI.md) | [PRD](PRD_MK-DDC-24_VI.md) | [SRS](SRS_MK-DDC-24_VI.md)

---

## 1. Kiến trúc Phần cứng Tổng thể

### 1.1 Block Diagram

```
                    ┌──────────────────────────────────────┐
                    │          CARRIER BOARD                │
    24VAC/VDC ─────►│ Power Supply                         │
                    │  24V → 5V (DC/DC) → 3.3V (LDO)      │
                    │                                       │
    RJ-45 ──────────►│ Eth Magnetics (GbE RGMII)           │
                    │         │ GbE PHY onboard CM3         │
    RS-485 A/B ─────►│ RS-485  │ SOM Connector              │
                    │  (MAX13487E) ┌────────────────────┐  │
    USB-C ──────────►│ USB-C OTG   │ Radxa CM3 (SOM)    │  │
    USB-A ──────────►│ USB3.0 host │ RK3566 Cortex-A55  │──┼──► ILI9341 TFT 2.4" (SPI0)
                    │             │ 2GB LPDDR4         │──┼──► Button×6        (GPIO)
                    │             │ 8GB eMMC            │  │
                    │             │ Debian 12           │  │
                    │             └────────────────────┘  │
                    │                  │ UART 921600       │
                    │           ┌──────▼──────────────┐    │
                    │           │ MCU STM32G0B1RB      │    │
                    │           │ FreeRTOS, 64MHz      │    │
                    │           └──┬──────────┬────────┘    │
                    │              │ ADC      │ GPIO/DAC    │
                    │         ┌────▼────┐  ┌──▼──────────┐  │
  UI1-UI8 ──────────►│ Input   │ADS131M08│  │ AO DAC16bit│◄──── AO1-AO4
  DI1-DI8 ──────────►│ Cond.   └────────┘  └──────────┬─┘  │
                    │                              ┌───▼──┐ │
                    │                              │Relay │◄──── DO1-DO4
                    │                              │SPDT  │    │
                    └──────────────────────────────────────┘
```

---

## 2. SOM Module Specification

### 2.1 SOM Đã Chọn — Radxa CM3

| Thông số | Giá trị | Ghi chú |
|----------|---------|---------|
| **SOM** | Radxa CM3 | Part: RS-E000260 |
| **CPU** | Quad-core ARM Cortex-A55 @ 1.8 GHz | RK3566, 64-bit |
| **RAM** | 2 GB LPDDR4 | Variant đã chọn |
| **eMMC** | 8 GB onboard | A/B partition + log |
| **GPU/VPU** | Không dùng | Headless |
| **Ethernet** | Gigabit RGMII (PHY onboard CM3) | Không cần PHY ngoài trên carrier |
| **USB** | 1× USB3.0 host + 1× USB2.0 OTG | Via carrier board |
| **UART** | 7× | UART2 MCU IOP, UART4 RS-485, UART0 debug |
| **SPI** | 4× | SPI0 → HMI TFT ILI9341 (ADS131M08 do MCU đọc qua SPI3, không nối CM3) |
| **I2C** | 8× | I2C0 → RTC DS3231 |
| **GPIO** | 50× | LED status, DIP switch, reset MCU |
| **Connector** | 3× 100-pin B2B 0.4mm (Hirose DF40C) | Chiều cao stack 3mm |
| **Nguồn SOM** | 5V, max 3A | Do carrier cấp qua DC/DC LM2596 |
| **Nhiệt độ SOM** | 0°C đến +50°C (consumer grade) | ⚠ Xem biện pháp nhiệt bên dưới |
| **Kích thước** | 55 × 40 mm | Fit trong carrier board DIN-rail |
| **Giá** | ~25–35 USD (volume 500+) | Đáp ứng BOM ≤ 40 USD |

> ⚠️ **Ràng buộc nhiệt độ:** CM3 consumer grade (0~50°C) vs mục tiêu sản phẩm (-20~65°C). Biện pháp: Heatsink Radxa 5540B, lỗ thông gió vỏ DIN-rail, cpufreq throttle tại 70°C. 
>
> **Dải đã xác nhận (validated):** 0°C ~ +55°C (với heatsink + throttle). **Dải mục tiêu (target):** -20°C ~ +65°C — đòi hỏi báo cáo thermal derating đầy đủ (bao gồm extended-temp CM3 option nếu cần) trước khi dùng trong tài liệu bán hàng và trước khi ship GA.
>
> Chi tiết: `hardware-design/07_emc_thermal/EMC_THERMAL_NOTES.md`.

### 2.2 Lý do Chọn Radxa CM3

| Tiêu chí | Radxa CM3 | Đánh giá |
|----------|-----------|---------|
| BOM ≤ 40 USD | ~30 USD | ✅ |
| GbE onboard | ✅ (không cần PHY ngoài) | ✅ Tiết kiệm BOM |
| UART × 7 | ✅ (đủ MCU + RS-485 + debug) | ✅ |
| SPI × 4 | ✅ (SPI0 → HMI TFT) | ✅ |
| Debian BSP | ✅ chính thức | ✅ |
| Tài liệu & schematic | ✅ đầy đủ (PDF, XLSX, STP) | ✅ |
| Form factor | 55×40mm, B2B 3×100-pin | ✅ |

---

## 3. I/O MCU Specification

### 3.1 MCU Selection

| Thông số | Giá trị | Ghi chú |
|----------|---------|---------|
| **MCU** | STM32G0B1RBT6 | LQFP-64, Cortex-M0+, 64 MHz |
| **Flash** | 128 KB | Firmware FreeRTOS + I/O driver |
| **SRAM** | 144 KB | Buffer I/O data + dư địa lớn |
| **ADC** | 12-bit on-chip (backup) | UI thô; ADS131M08 SPI là ADC chính 24-bit |
| **DAC** | Chỉ GPIO/PWM | AO thực tế dùng DAC8554 16-bit SPI riêng |
| **GPIO** | ≥ 20 | DI, DO relay control |
| **UART** | ≥ 2× | Giao tiếp SOM, debug |
| **Watchdog** | IWDG + WWDG | Dual watchdog |
| **Nhiệt độ** | -40°C đến +85°C | Industrial grade |
| **Nguồn MCU** | 3.3V | Do carrier cấp |

### 3.2 Firmware MCU (FreeRTOS Tasks)

| Task | Priority | Period | Mô tả |
|------|:--------:|:------:|-------|
| `io_sample_task` | High (7) | 1 ms | ADC sampling UI1-UI8 + DI debounce |
| `iop_comm_task` | High (6) | 10 ms | Giao tiếp SOM (IOP protocol) |
| `ao_output_task` | High (6) | 10 ms | Ghi giá trị AO qua DAC SPI |
| `do_control_task` | High (6) | 10 ms | Đóng/mở relay DO1-DO4 |
| `diagnostics_task` | Low (2) | 1.000 ms | Ghi fault counter, nhiệt độ MCU |
| `watchdog_task` | Idle (1) | 500 ms | Kick IWDG |

---

## 4. Universal Input (UI) Circuit

### 4.1 Input Conditioning

Mỗi kênh UI1-UI8 có mạch điều hòa tín hiệu hỗ trợ đa chế độ:

| Chế độ | Cấu hình | Dải đo | Độ chính xác |
|--------|---------|--------|--------------|
| **0–10V Analog** | Input divider 100kΩ/12.1kΩ + clamp TVS (xem IO_UI §3.2) | 0 – 10.5 V | ±0.1% FS |
| **4–20mA Current** | Shunt 62Ω 0.1% + protection (xem IO_UI §3.3) | 0 – 25 mA | ±0.2% FS |
| **PT100** | 2-wire, excitation 1mA, RTD amp | -50°C – 200°C | ±0.3°C |
| **PT1000** | 2-wire, excitation 0.3mA | -50°C – 200°C | ±0.2°C |
| **NTC 10kΩ** | Voltage divider 10kΩ pull-up to 3.3V | -30°C – 70°C | ±0.5°C |
| **NTC 20kΩ** | Voltage divider 20kΩ pull-up to 3.3V | -30°C – 70°C | ±0.5°C |
| **Dry Contact (DI)** | Pull-up 10kΩ, debounce 10ms | — | Reliable @ 24V |

**Auto-detect:** MCU đo điện trở đầu vào khi khởi động → xác định loại sensor và cấu hình mạch tương ứng.

### 4.2 Input Protection

| Loại bảo vệ | Linh kiện | Mức độ |
|------------|---------|--------|
| Overvoltage | TVS diode SMAJ15A | Clamp tại 16.7V |
| Reverse polarity | Schottky diode | Bảo vệ MCU ADC |
| ESD | ±8kV (contact), ±15kV (air) | Per IEC 61000-4-2 |
| Transient | LC filter 100µH + 100nF | Theo IEC 61000-4-4 |
| Short circuit | PTC fuse 100mA | Self-resetting |

---

## 5. Digital Input (DI) Circuit

### 5.1 Yêu cầu

| Thông số | Giá trị |
|----------|---------|
| **Số kênh** | 8 |
| **Logic ON** | 15 – 30 V DC |
| **Logic OFF** | 0 – 5 V DC |
| **Dòng đầu vào** | 5 – 10 mA @ 24V (wet contact) |
| **Tốc độ** | Debounce cấu hình 5 – 100 ms |
| **Isolation** | Optocoupler PC817, 1500V RMS |
| **Bảo vệ** | Reverse polarity + TVS ±30V |
| **LED chỉ thị** | 1× LED xanh lá per kênh |

---

## 6. Analog Output (AO) Circuit

### 6.1 Yêu cầu

| Thông số | Giá trị |
|----------|---------|
| **Số kênh** | 4 |
| **Chế độ** | 0–10V hoặc 4–20mA — **chọn bằng phần mềm per kênh** (relay/analog-switch + lệnh IOP `SET_AO_CFG`; chốt IOP-Q-R008). Không dùng jumper |
| **Độ phân giải** | 16-bit (DAC8554 SPI) |
| **Độ chính xác** | ±0.1% FS |
| **Tải tối thiểu (0–10V)** | ≥ 2 kΩ (≤ 5 mA @ 10V) — xem IO_AO §6. Tải thấp hơn gây sụt áp trên R_series 100Ω |
| **Tải điện trở (4–20mA)** | Max 600Ω (IEC 61131-2) |
| **Isolation** | Không cô lập (Ver 1) |
| **Short-circuit protection** | Current limit + fold-back |
| **LED chỉ thị** | 1× LED xanh per kênh (active when non-zero) |

---

## 7. Digital Output / Relay (DO) Circuit

### 7.1 Yêu cầu

| Thông số | Giá trị |
|----------|---------|
| **Số kênh** | 4 |
| **Loại relay** | SPDT (1C), PCB mount |
| **Tải AC** | 5A @ 250 VAC (resistive) |
| **Tải DC** | 5A @ 30 VDC |
| **Điện áp coil** | 5V DC (driven bởi MCU qua ULN2003) |
| **Thời gian đóng** | ≤ 10 ms |
| **Tuổi thọ cơ** | ≥ 10 triệu chu kỳ |
| **Tuổi thọ điện** | ≥ 100.000 chu kỳ @ 5A / 250VAC |
| **Bảo vệ coil** | Diode flyback tích hợp trong ULN2003A (chân COM nối +5V_RELAY) — không cần diode ngoài |
| **LED chỉ thị** | 1× LED đỏ per kênh (sáng khi relay đóng) |
| **Isolation** | Galvanic isolation — relay contact vs. MCU |

---

## 8. Power Supply Design

### 8.1 Input Power

| Thông số | Giá trị |
|----------|---------|
| **Nguồn vào** | 24 VAC/VDC ±20% (19.2V – 28.8V) |
| **Tần số (AC)** | 50/60 Hz |
| **Connector** | Terminal block 2-pin 5.08mm |
| **Bảo vệ cực tính** | Diode bridge (cho cả AC và DC) |
| **Bảo vệ transient** | MOV + fuse polyfuse 2A |
| **Cách ly** | 3kV input → logic |

### 8.2 Internal Power Rails

| Rail | Điện áp | Dòng max | Dùng cho |
|------|:-------:|:--------:|---------|
| **+5V** | 5.0V ±2% | 3A | SOM (max 2.5A), relay coil, RS-485, logic |
| **+3.3V** | 3.3V ±1% | 1A | MCU, UI cond., RS-485 ref |
| **+15V** | 15V ±2% | 200mA | AO output op-amp rail |

### 8.3 Tiêu thụ Điện

| Trạng thái | Tiêu thụ |
|-----------|---------|
| Idle (không relay) | < 3W |
| Điển hình (2 relay) | ~5W |
| Max (4 relay, AO full) | < 8W |

---

## 9. RS-485 Interface

> ⚠ **Protocol sharing:** RS-485 port được dùng cho **BACnet MS/TP** (mặc định) hoặc **Modbus RTU** (cấu hình qua web UI). Không hỗ trợ cả hai cùng lúc. Modbus TCP trên Ethernet chạy độc lập, luôn sẵn sàng bất kể chế độ RS-485.

| Thông số | Giá trị |
|----------|--------|
| **IC** | MAX13487E (auto-direction control) |
| **Baud rate** | 1.2k – 115.2k bps |
| **Tải bus** | MAX13487E = 1/4 unit-load → hỗ trợ đến ~128 node về tải. Khuyến nghị ≤ 32 device/segment (đúng DS §5.2); tối đa 127 địa chỉ master MS/TP |
| **Cáp tối đa** | 1.200m @ 9.600 baud |
| **ESD bảo vệ** | ±15kV (IEC 61000-4-2, contact) |
| **Isolation** | 1kV (ADUM1201 digital isolator) |
| **Termination** | 120Ω jumper-selectable (disable khi không phải endpoint) |
| **Bias resistor** | 560Ω pull-up/down (fail-safe idle state) |
| **Connector** | Terminal block 3-pin (A, B, GND) 5.08mm |
| **Protocol mode** | Cấu hình qua web UI: BACnet MS/TP (mặc định) hoặc Modbus RTU |

---

## 10. Ethernet Interface

| Thông số | Giá trị |
|----------|---------|
| **Speed** | Gigabit (10/100/1000 Mbps) auto-negotiation |
| **PHY** | Onboard CM3 (Rockchip RK3566 integrated) |
| **Interface** | RGMII (đến CM3 via B2B CON3) |
| **Connector** | RJ-45 với integrated magnetics + LED (Link/Activity) |
| **ESD** | ±2kV (IEC 61000-4-2) |
| **EMC** | Common mode choke integrated trong magnetics |
| **Protocol sử dụng cùng lúc** | BACnet/IP (UDP/47808) + Modbus TCP (TCP/502) + MQTT over TLS (TCP/8883) + REST API (TCP/8443) + SSH (TCP/2222) |
| **DHCP** | Có, mặc định; static IP cấu hình qua web UI |

---

## 11. HMI & Display Subsystem

> Dựa trên thiết kế 3D mặt trước thiết bị: 1× TFT 2.4" màu (dashboard chính) + 6× nút nhấn điều hướng + 5× LED trạng thái. Hàng trên là 3× lỗ dắt dây terminal (không phải display).

### 11.1 TFT LCD 2.4" — Dashboard Chính

**IC Controller: ILI9341** (hoặc tương thích ST7789V2)

| Thông số | Giá trị |
|----------|---------|
| **Kích thước** | 2.4 inch diagonal |
| **Độ phân giải** | 240 × 320 pixels (QVGA) |
| **Màu sắc** | 65K màu (16-bit RGB565) |
| **Interface** | SPI 4-wire, tốc độ max 40 MHz |
| **Nguồn** | 3.3V VCC, 3.3V I/O logic |
| **Backlight** | LED backlight, điều chỉnh PWM |
| **Góc nhìn** | IPS 160°/160° (nếu dùng bản IPS) |
| **Nội dung hiển thị** | Dashboard: 3× gauge vòng tròn (temp/pressure/power), alarm status, network status |
| **Thư viện phần mềm** | LVGL v9 + lv_drivers SPI (Debian userspace) |
| **Frame rate** | ~20 FPS với SPI 20MHz |

**Kết nối CM3 ↔ ILI9341:**

```
Radxa CM3 (CON1 B2B)          ILI9341 2.4" TFT
────────────────────           ────────────────────
SPI0_CLK  (CON1-37) ─────────► SCK
SPI0_MOSI (CON1-39) ─────────► MOSI / SDA
SPI0_CS0n (CON1-41) ─────────► CS#
GPIO0_C0  (CON1-51) ─────────► DC (Data/Command, HIGH=data)
GPIO0_C1  (CON1-53) ─────────► RST# (active LOW)
PWM11_M1  (CON1-55) ─[33Ω]──► BL (LED anode, max 20mA)
3V3       (CON1-17) ─────────► VCC
GND       (CON1-18) ─────────► GND
```

> **SPI0_MISO không cần nối** nếu module không có touch.  
> Nếu dùng module có **touch (XPT2046)**: thêm `SPI0_MISO←TP_DOUT`, `GPIO→TP_CS`, `GPIO←TP_IRQ`.

**Khởi tạo trên Debian CM3:**
```bash
# Enable SPI0 via device tree overlay
echo "spi0-ili9341" >> /boot/armbianEnv.txt

# Hoặc cấu hình thủ công via fbtft module
modprobe fbtft_device name=adafruit22a rotate=270 speed=24000000 fps=20

# Verify framebuffer
ls /dev/fb0   # → ILI9341 framebuffer
```

**LVGL render pipeline:**
```
Soft PLC data → shared memory → lvgl_dashboard_app → SPI0 → ILI9341
```

---

### 11.2 Nút Nhấn (×6)

6 nút nhấn theo dạng 2×3 cho phép điều hướng menu local (không cần web browser).

| Vị trí | Chức năng | CM3 GPIO |
|--------|----------|----------|
| TOP-LEFT | UP / Scroll Up | GPIO1_A0 |
| TOP-RIGHT | DOWN / Scroll Down | GPIO1_A1 |
| MID-LEFT | LEFT / Back | GPIO1_A2 |
| MID-RIGHT | RIGHT / Forward | GPIO1_A3 |
| BOT-LEFT | ENTER / Confirm | GPIO1_A4 |
| BOT-RIGHT | ESC / Cancel | GPIO1_A5 |

Mạch nút: Pull-up 10kΩ lên 3.3V, debounce 20ms software. Nhấn → GPIO = LOW.

---

### 11.3 CM3 SPI/I2C Resource Allocation (Display)

| Bus | Dùng cho | Tốc độ |
|-----|---------|--------|
| SPI0 | ILI9341 TFT 2.4" | 20–40 MHz |
| I2C0 | RTC DS3231 | 400 kHz |
| I2C1–I2C7 | Dự phòng Ver 2 | — |

---

## 12. Cơ khí & Lắp đặt

### 12.1 Kích thước

```
          150mm
  ┌───────────────────┐
  │  ┌─┐  MK-DDC-24  │ 90mm
  │  │ │  ──────────  │
  │  └─┘  KINEXUS     │
  └───────────────────┘
          55mm (depth)
```

| Thông số | Giá trị |
|----------|---------|
| **Kích thước (W×H×D)** | 150 × 90 × 55 mm |
| **Trọng lượng** | ~320g (bao gồm vỏ nhựa) |
| **Vỏ** | ABS V0 (flame retardant) hoặc PA66 |
| **Màu** | RAL 7035 Light Gray |
| **DIN-rail** | 35mm TS35 (EN 50022) |
| **Mounting flange** | 4× M4 screw (optional) |
| **Khoảng hở thông gió** | ≥ 25mm trên/dưới khi lắp DIN |
| **DIN-rail clip** | 2× snap clip (mặt sau), hướng có thể xoay 180° |

**Chi tiết khíp DIN-rail:**

```
Mặt sau thiết bị:

  ┌─────────────────────────┐
  │  [DIN CLIP A]  [DIN CLIP B]  │  ← 2× snap-on clip
  │                              │
  │  <───── 130mm ─────>          │  ← khoảng cách 2 clip
  └─────────────────────────┘
  ││││ Ventilation slots (top & bottom)
```

**Vị trí terminal block trên mặt trước:**

| Vùng | Ký hiệu | Số pin | Bước răng (pitch) | Vị trí |
|------|--------|:-------:|:-----------------:|-------|
| Nguồn vào | PWR (24V+, GND) | 2 | 5.08mm | Góc trái trên |
| Universal Input | UI1–UI8 | 16 (2/kênh) | 3.81mm | Hàng 1–2 |
| Digital Input | DI1–DI8 | 16 (2/kênh: IN, COM) | 3.81mm | Hàng 3–4 |
| Analog Output | AO1–AO4 | 8 (2/kênh: OUT+, GND) | 3.81mm | Hàng 5 |
| Relay Output | DO1–DO4 | 12 (3/kênh: NO, COM, NC) | 5.08mm | Hàng 6 |
| RS-485 | A, B, GND | 3 | 5.08mm | Góc trái dưới |

### 12.2 Mặt trước (Front Panel)

```
[POWER LED] [ETH LED] [BACnet LED] [FAULT LED]

[UI1][UI2][UI3][UI4]  ← Universal Input terminals
[UI5][UI6][UI7][UI8]

[DI1][DI2][DI3][DI4]  ← Digital Input terminals
[DI5][DI6][DI7][DI8]

[AO1][AO2][AO3][AO4]  ← Analog Output terminals
[DO1][DO2][DO3][DO4]  ← Relay Output terminals

[RS485 A/B/GND] [ETH RJ45] [USB-C] [USB-A]

[24VAC/VDC PWR]  [DIP SWITCH x8]
```

### 12.3 LED Status

| LED | Màu | Trạng thái | Ý nghĩa |
|-----|-----|----------|---------|
| POWER | Xanh lá | Sáng | 24V OK, hệ thống đang chạy |
| ETH | Xanh lá | Nhấp nháy | Ethernet activity |
| BACnet | Xanh dương | Nhấp nháy | BACnet traffic |
| BACnet | Xanh dương | Sáng cố định | BACnet connected, no traffic |
| FAULT | Đỏ | Sáng | System fault (I/O error, MCU comm fail) |
| FAULT | Đỏ | Nhấp nháy 1s | Firmware update in progress |

---

## 13. EMC & Safety Requirements

### 13.1 EMC (IEC 61326-1)

| Test | Tiêu chuẩn | Level | Yêu cầu |
|------|-----------|-------|---------|
| ESD Immunity | IEC 61000-4-2 | Level 3 (6kV contact, 8kV air) | PASS |
| Radiated Immunity | IEC 61000-4-3 | Level 3, 10 V/m | PASS |
| Fast Transient | IEC 61000-4-4 | Level 3, 2kV | PASS |
| Surge | IEC 61000-4-5 | Level 3, 2kV DM / 4kV CM | PASS |
| Conducted Immunity | IEC 61000-4-6 | Level 3, 10 Vrms | PASS |
| Radiated Emission | CISPR 11 / EN 55011 | Class A | PASS |
| Conducted Emission | CISPR 11 | Class A | PASS |

### 13.2 Safety (IEC 61010-1)

| Yêu cầu | Nội dung |
|---------|---------|
| **Isolation voltage** | Minimum 3kVAC (power input ↔ logic) |
| **Clearance & creepage** | Theo IEC 61010-1 Annex G, Cat II, Pollution 2 |
| **Flammability** | Vỏ ABS/PA66 UL94 V-0 |
| **Working voltage** | Max 300V CAT II trên relay contacts |
| **Protective ground** | Terminal GND kết nối chassis |

---

## 14. Môi trường & Độ bền

| Thông số | Yêu cầu | Test method |
|----------|---------|------------|
| **Nhiệt độ làm việc (validated)** | 0°C đến +55°C (với heatsink Radxa 5540B) | IEC 60068-2-1 / 2-2 |
| **Nhiệt độ làm việc (target)** | -20°C đến +65°C (cần thermal derating report trước GA) | IEC 60068-2-1 / 2-2 |
| **Nhiệt độ bảo quản** | -40°C đến +85°C | IEC 60068-2-1 / 2-2 |
| **Độ ẩm** | 10–90% RH non-condensing | IEC 60068-2-78 |
| **Rung động** | 5–150Hz, 1g, 3 trục, 60 phút/trục | IEC 60068-2-6 |
| **Sốc cơ học** | 15g, 11ms, 3 trục × 3 lần | IEC 60068-2-27 |
| **Cấp bảo vệ** | IP20 | IEC 60529 |
| **MTBF** | ≥ 60.000h @ 40°C | IEC 61709 |

---

## 15. PCB & Manufacturing Requirements

| Thông số | Yêu cầu |
|----------|---------|
| **PCB layers** | 4-layer (tối thiểu): Signal / GND / Power / Signal |
| **PCB material** | FR4, Tg ≥ 150°C |
| **Solder** | Lead-free (SAC305), RoHS 3 compliant |
| **IPC standard** | IPC-A-610 Class 2 (assembly quality) |
| **Conformal coating** | 1–3C acrylic spray (tùy option outdoor) |
| **Burn-in test** | 8 giờ @ 60°C, 100% I/O cycling |
| **AOI** | Automated Optical Inspection 100% |
| **ICT** | In-Circuit Test cho critical nets |

---

## 16. DIP Switch Configuration

| Switch | Chức năng | ON | OFF |
|--------|----------|-----|-----|
| SW1–SW7 | Bootstrap BACnet Device ID (bit 0–6, giá trị 1–127) | bit=1 | bit=0 |
| SW8 | BACnet MS/TP termination 120Ω | Enable | Disable |

**Quy tắc ưu tiên Device ID (rõ ràng):**

| Điều kiện | Device ID áp dụng |
|------------|-------------------|
| Web UI đã lưu Device ID (tồn tại `/data/config/device.conf`) | **Web UI config** (1–4.194.302), DIP bị bỏ qua |
| Chưa có web UI config (lần đầu boot, factory reset) | **DIP SW1–SW7** (bootstrap, range 1–127) |
| DIP = 0 (tất cả OFF) và chưa có web config | Device ID = **1** (fallback mặc định) |

> DIP switch là **bootstrap factory ID** — được đặt trước khi commissioning, không thay đổi trong lúc runtime. Để đặt Device ID ngoài range 1–127, phải dùng Web UI. DIP chỉ được đọc lại khi factory reset hoặc xóa `/data/config/device.conf`.

---

**Document ID:** HW-SPEC-MK-DDC-24-VI  
**Revision:** 1.1 | 2026-05-28  
**Approved by:** Hardware Lead, CTO KINEXUS Technologies
