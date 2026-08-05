# Thẻ thông số kỹ thuật — Foxlinx SOM-DDC-24

> **ID:** HW-FOXLINX-SPEC-001  
> **Trạng thái:** Active  
> **Ngày:** 2026-08-05  
> **Board:** Forlinx OK1126B-S (SoM FET1126Bx-S)  
> **Dự án:** MK-DDC-24 — BMS Edge Automation Controller  
> **Nguồn dữ liệu:** SSH live board `SOM-DDC-24-foxlinx` + datasheet nhà sản xuất Forlinx

---

## 1. Tổng quan SoM

| Thông số | Giá trị | Ghi chú |
|---|---|---|
| **Tên SoM** | Forlinx FET1126Bx-S | Module cắm trên carrier board |
| **Carrier Board** | Forlinx OK1126B-S | Bo phát triển mẫu của hãng |
| **SoC** | Rockchip RV1126B | Mã sản phẩm: `rockchip_ok1126b-s` |
| **CPU** | Quad-core ARM Cortex-A53 | **Không phải** Cortex-A55 (khác Radxa CM3) |
| **Tốc độ CPU** | 594 MHz – 1296 MHz | Governor: `schedutil`, max 1.3 GHz |
| **NPU** | 3.0 TOPS (INT8) | RKNN, freq max 800 MHz, `/dev/rknpu` |
| **RAM** | 2 GB LPDDR4 | `MemTotal: 2 021 260 kB` (~1.93 GiB usable) |
| **eMMC** | 16 GB (DG4016) | 30 777 344 sectors × 512B ≈ 14.7 GiB; rootfs 13G, userdata 1.9G |
| **Form factor** | 40 × 40 mm (SoM) | Connector B2B |
| **OS** | Buildroot 2024.02 | **Không phải Debian** — không có `apt`/`dpkg` |
| **Kernel** | Linux 6.1.141 aarch64 SMP | Build: Nov 2025 |
| **U-Boot** | `uboot-11/21/2025` | `ddr-v1.06`, `bl31-v1.11` |
| **Nhiệt độ CPU hiện tại** | ~41.5 °C (idle) | Thermal zone `cpu-thermal` |

---

## 2. Sơ đồ khối hệ thống

```
                    ┌──────────────────────────────────────────────┐
    24VAC/VDC ─────►│ CARRIER BOARD (Foxlinx OK1126B-S)            │
                    │  Power Supply: 24V → 5V → 3.3V              │
                    │                                              │
    RJ-45 ─────────►│ Ethernet 10/100/1000 (FEPHY tích hợp SoC)   │
                    │         │                                    │
    RS-485 A/B ────►│ RS-485 Transceiver ──► UART5 (ttyS5)        │
                    │                                              │
    USB-C ─────────►│ USB OTG ───┐    ┌────────────────────────┐   │
    USB-A ─────────►│ USB Host   │    │ SoM FET1126Bx-S        │   │
                    │            │    │ Rockchip RV1126B        │   │
                    │            │    │ 4×Cortex-A53 @1.3GHz    │   │
                    │            ├────┤ 2GB LPDDR4              │   │
    WiFi 5GHz ◄────┤ RTL8821CS  │    │ 16GB eMMC               │   │
    BT 4.2    ◄────┤ (SDIO)     │    │ NPU 3.0 TOPS            │   │
                    │            │    │ Buildroot 2024.02       │   │
                    │            │    │ Linux 6.1.141           │   │
                    │            │    └─────────┬──────────────┘   │
                    │                  UART2 921600                 │
                    │            ┌──────▼──────────────┐           │
                    │            │ MCU STM32G0B1RB      │           │
                    │            │ FreeRTOS, 64MHz      │           │
                    │            └──┬──────────┬────────┘           │
                    │               │ ADC ×2   │ GPIO/DAC          │
                    │         ┌─────▼─────┐ ┌──▼──────────┐        │
     UI1-UI16 ─────►│  Input  │2×ADS131M08│ │ AO DAC16bit │◄── AO1-AO4
                    │  Cond.  └───────────┘ └──────────┬──┘        │
                    │                              ┌───▼──┐        │
                    │                   1024×600   │Relay │◄── DO1-DO4
    MIPI DSI ◄─────┤ TFT Panel ◄─── DRM/card0    │SPDT  │        │
    Touch (I2C) ───►│ FT5436                       └──────┘        │
    Nút nhấn ×6 ───►│ GPIO                                         │
                    └──────────────────────────────────────────────┘
```

---

## 3. Ma trận giao tiếp (Interface Matrix)

### 3.1 UART (8 cổng phần cứng)

| # | Device Node | DT Node | Trạng thái DT | Sử dụng hiện tại | MMIO | IRQ |
|---|---|---|---|---|---|---|
| 0 | `/dev/ttyS0` | `serial@20810000` | `disabled` | Debug console (earlycon) — đã disabled sau boot | `0x20810000` | — |
| 1 | `/dev/ttyS1` | `serial@21160000` | `disabled` | **Rảnh** — ứng viên RS485 #2 | `0x21160000` | — |
| 2 | `/dev/ttyS2` | `serial@21170000` | **`okay`** | IOP giao tiếp MCU STM32 + BT `rtk_hciattach` | `0x21170000` | 62 |
| 3 | `/dev/ttyS3` | `serial@21180000` | `disabled` | Rảnh | `0x21180000` | — |
| 4 | `/dev/ttyS4` | `serial@21190000` | `disabled` | Rảnh (chân 37/38 P16 bị BT chiếm) | `0x21190000` | — |
| 5 | `/dev/ttyS5` | `serial@211a0000` | **`okay`** | **RS485 #1 — Modbus RTU Master** | `0x211A0000` | 63 |
| 6 | `/dev/ttyS6` | `serial@211b0000` | `disabled` | Rảnh | `0x211b0000` | — |
| 7 | `/dev/ttyS7` | `serial@211c0000` | `disabled` | Rảnh | `0x211c0000` | — |

### 3.2 Ethernet

| Thuộc tính | Giá trị |
|---|---|
| Interface | `eth0` |
| Loại | FEPHY tích hợp SoC (Fast Ethernet PHY) + RGMII |
| Tốc độ | 10/100/1000 Mbps (Gigabit) |
| MAC | `fa:2f:a0:bb:47:4d` |
| IP hiện tại | `192.168.1.110/24` |
| Driver | `stmmac` (Synopsys DWC Ethernet QoS) |

### 3.3 WiFi / Bluetooth

| Thuộc tính | Giá trị |
|---|---|
| Chip | Realtek RTL8821CS |
| Bus | SDIO (`mmc2:0001:1`, ID `024c:c821`) |
| WiFi | 802.11ac 5 GHz, 80 MHz channel width |
| WiFi SSID hiện tại | `Mekong Factory` (channel 149, 5745 MHz) |
| WiFi IP | `192.168.1.26/24` |
| Bluetooth | 4.2, HCI UART via `rtk_hciattach` trên `/dev/ttyS2` |
| BT MAC | `58:E4:EB:88:83:4D` |
| Kernel module | `RTL8821CS` (2.8 MB), `hci_uart` |

### 3.4 Display

| Thuộc tính | Giá trị |
|---|---|
| Giao tiếp | MIPI DSI (`card0-DSI-1`) |
| Panel | `simple-panel` |
| Độ phân giải | 1024 × 600 @ 56 Hz |
| DRM node | `/dev/dri/card0` |
| VOP | `22150000.vop`, format RGB888 |
| Touch | Chưa phát hiện touch controller FT5436 trong device tree (thiếu driver?) |

### 3.5 I2C

| Bus | Device | Ghi chú |
|---|---|---|
| `/dev/i2c-0` | PMIC RK805 (addr `0x27`) | Quản lý nguồn |
| `/dev/i2c-3` | (rảnh) | Khả dụng |
| `/dev/i2c-4` | RTC RX8010 (addr `0x32`) | Đồng hồ thời gian thực |

### 3.6 SPI

| Device | Ghi chú |
|---|---|
| `/dev/spidev1.0` | SPI bus 1, chip select 0 — rảnh |
| `/dev/spidev1.1` | SPI bus 1, chip select 1 — rảnh |

### 3.7 CAN FD

| Node | Trạng thái DT | Ghi chú |
|---|---|---|
| `can@21d40000` (CAN0) | `disabled` | Có pinctrl M0/M1, có thể bật |
| `can@21d50000` (CAN1) | `disabled` | Có pinctrl M0/M1, có thể bật |

### 3.8 GPIO

| GPIO Bank | Base | Số chân | Label |
|---|---|---|---|
| `gpiochip0` | 0 | 32 | `gpio0` (PMUIO0, 3.3V) |
| `gpiochip32` | 32 | 32 | `gpio1` (VCCIO1, 1.8V) |
| `gpiochip64` | 64 | 32 | `gpio2` (VCCIO2, 3.3V/1.8V) |
| `gpiochip96` | 96 | 32 | `gpio3` (VCCIO3, 3.3V) |
| `gpiochip128` | 128 | 32 | `gpio4` (VCCIO4, 3.3V) |
| `gpiochip160` | 160 | 32 | `gpio5` (VCCIO5, 3.3V) |
| `gpiochip192` | 192 | 32 | `gpio6` (VCCIO6, 1.8V) |
| `gpiochip224` | 224 | 32 | `gpio7` (VCCIO7, 3.3V) |

**Tổng cộng:** 8 banks × 32 = **256 GPIO** (phần lớn disabled hoặc dùng cho mux khác).

### 3.9 Các thành phần khác

| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| NPU (RKNN) | **Active** (`/dev/rknpu`) | 3.0 TOPS, freq 800 MHz |
| PWM | 3 controller (`pwmchip0-2`) | Dùng cho backlight LCD, buzzer |
| SARADC | 3 bộ (SARADC0/1/2) | 8 kênh SARADC0, 8 kênh SARADC1, 8 kênh SARADC2 |
| RTC | RX8010 (I2C-4, addr 0x32) | Đồng hồ pin backup |
| USB OTG | Bus 003 | USB 2.0 OTG |
| USB Host | Bus 002 | USB 3.0 Host |

---

## 4. So sánh Baseline: Radxa CM3 (HW_SPEC) vs Foxlinx OK1126B-S (Thực tế)

> **Ngữ cảnh:** File `HW_SPEC_MK-DDC-24_VI.md` §2 ghi SoM là Radxa CM3/RK3566. Board production
> thực tế chạy Foxlinx OK1126B-S/RV1126B. Đây là finding `F-04` chưa đóng.

| Tiêu chí | Radxa CM3 (HW_SPEC) | Foxlinx OK1126B-S (Thực tế) | Ảnh hưởng |
|---|---|---|---|
| **SoC** | Rockchip RK3566 | Rockchip RV1126B | Kiến trúc khác hoàn toàn |
| **CPU** | 4× Cortex-**A55** @1.8 GHz | 4× Cortex-**A53** @1.3 GHz | Hiệu năng thấp hơn ~20-30% |
| **NPU** | Không có (hoặc 0.8 TOPS) | **3.0 TOPS** (RKNN) | Foxlinx vượt trội về AI |
| **RAM** | 2 GB LPDDR4 | 2 GB LPDDR4 | **Tương đương** |
| **eMMC** | 8 GB | 16 GB | Foxlinx dư dả hơn |
| **Ethernet** | GbE RGMII (PHY onboard CM3) | GbE FEPHY tích hợp SoC | Tương đương |
| **UART** | 7 cổng | **8 cổng** | Foxlinx nhiều hơn 1 |
| **WiFi/BT** | Không tích hợp (tùy SKU) | RTL8821CS 5GHz + BT 4.2 | Foxlinx tích hợp sẵn |
| **ISP/Camera** | Có (RK3566) | 12 MP ISP + 8 MP AI-ISP | Foxlinx mạnh hơn (AI vision) |
| **Form factor** | 55 × 40 mm, 3×100-pin B2B | 40 × 40 mm, connector riêng | Khác cơ khí |
| **Connector** | Hirose DF40C 3×100-pin | Connector riêng Foxlinx | **Không tương thích** |
| **BSP/OS** | Debian 12 chính thức | Buildroot 2024.02 | Khác hoàn toàn cách quản lý package |
| **Giá (volume)** | ~25-35 USD | TBD | Cần xác nhận |

> [!WARNING]
> Hai SoM **không tương thích cơ khí và phần mềm**. Mọi tài liệu tham chiếu Radxa CM3
> (connector, pinout, BSP, package manager) cần được rà soát lại khi áp dụng cho board
> production Foxlinx.

---

## 5. Thông số nhiệt và điện

| Thông số | Giá trị | Ghi chú |
|---|---|---|
| Nguồn cấp SoM | 5V | Từ carrier board |
| Nhiệt độ CPU idle | ~41.5 °C | Đo tại `cpu-thermal`, phòng ~28 °C |
| Nhiệt độ hoạt động (SoC) | 0 °C đến +70 °C (commercial) | Industrial grade (RV1126BJ): -40 ~ +85 °C |
| CPU freq governor | `schedutil` | Tự động điều chỉnh 594 – 1296 MHz |

---

## 6. Tài liệu nhà sản xuất

| Tài liệu | Nguồn |
|---|---|
| Forlinx Developer Center | [https://www.forlinx.net/](https://www.forlinx.net/) |
| OK1126Bx-S Hardware User Manual | Tải từ Developer Center → Rockchip Series → OK1126Bx-S |
| Linux 6.1 User Manual | Tải từ Developer Center |
| Rockchip RV1126B TRM | Liên hệ Forlinx support (`support@forlinx.com`) |
| Bảng Pin Mux SoM | Xem [FOXLINX_PINOUT_MAP.md](FOXLINX_PINOUT_MAP.md) (dữ liệu từ bảng hãng cung cấp) |

---

## 7. Lịch sử phiên bản

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-05 | Phiên bản đầu tiên — tổng hợp từ SSH live board + datasheet nhà sản xuất + bảng Pin Mux |
