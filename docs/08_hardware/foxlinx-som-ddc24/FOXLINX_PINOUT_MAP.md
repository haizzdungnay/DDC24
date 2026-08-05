# Sơ đồ chân & Pin Mux — Foxlinx SOM-DDC-24

> **ID:** HW-FOXLINX-PINOUT-001  
> **Ngày:** 2026-08-05  
> **Nguồn dữ liệu:** Bảng Pin Mux SoM (nhà sản xuất Forlinx) + sơ đồ mạch Header GPIO P16 + Device Tree live board

---

## 1. Header GPIO P16 (20×2 pin, 2.54 mm)

Header P16 là đầu cắm chính trên carrier board Foxlinx OK1126B-S, tương thích chuẩn
Raspberry Pi 40-pin. Bảng dưới đây là ánh xạ **đã xác nhận** từ sơ đồ mạch thực tế.

### 1.1 Sơ đồ vật lý

```
                          Header P16 (nhìn từ trên)
              ┌──────────────────────────────────────────┐
              │  [1] VCC_3V3         VCC_5V       [2]    │
              │  [3] I2C4_SDA_M3     VCC_5V       [4]    │
              │  [5] GPIO0_C6        GND          [6]    │
              │  [7] GPIO0_C7        UART5_TX_M0  [8]  ◄── RS485 #1 TX
              │  [9] TXD(debug)      UART5_RX_M0  [10] ◄── RS485 #1 RX
              │ [11] GPIO0_D0_D      CLK_32K_OUT  [12]   │
              │ [13] GPIO4_A0   ◄── UART4_RTSN    GND   [14]   │
              │ [15] GPIO4_A1        GND          [16]   │
              │ [17] VCC_3V3         CAM1-RST3.3  [18]   │
              │ [19] SPI1_MOSI_M1    GND          [20]   │
              │ [21] SPI1_MISO_M1    CAN0_RXD_M1  [22]   │
              │ [23] SPI1_CLK_M1 ◄── UART1_RTSN   SPI1_CSN0_M1 [24]   │
              │ [25] GND             SPI1_CSN1_M1 [26] ◄── UART1_TX
              │ [27] SCL.0(I2C3)     SDA.0(I2C3)  [28]   │
              │ [29] CAN0_RXD_M1,3.3 GND          [30]   │
              │ [31] CAN1_RXD_M0     SPI1_CSN1_M1 [32]   │
              │ [33] GND             GND          [34]   │
              │ [35] GPIO3_B7_D  ◄── UART1_RX     GPIO3_B7_D [36] ◄── UART1_RX alt
              │ [37] BT_WAKE_HOST    HOST_WAKE_BT [38]   │
              │ [39] GND             BT_REG_ON    [40]   │
              └──────────────────────────────────────────┘
```

> **Chú thích `◄──`**: Chân có thể chuyển sang chức năng UART qua Pin Mux (sửa Device Tree).

### 1.2 Bảng chi tiết 40 chân

| Chân | Tên nhãn trên sơ đồ | CPU Ball | GPIO | Alt Mux khả dụng cho UART | Miền điện áp | Trạng thái hiện tại |
|:---:|---|---|---|---|---|---|
| 1 | VCC_3V3 | — | — | — | 3.3V | Nguồn |
| 2 | VCC_5V | — | — | — | 5V | Nguồn |
| 3 | I2C4_SDA_M3 | 1AC16 | GPIO7_A4 | UART2_CTSN_M1 (Alt6) | 3.3V | I2C4 |
| 4 | VCC_5V | — | — | — | 5V | Nguồn |
| 5 | GPIO0_C6 / PWM_DSI | 1AB10 | GPIO0_C6 | UART1_RTSN_M0 (Alt3) | 3.3V | PWM |
| 6 | GND | — | — | — | — | Mass |
| 7 | GPIO0_C7 | 1AB8 | GPIO0_C7 | UART1_CTSN_M0 (Alt3) | 3.3V | Rảnh |
| **8** | **UART5_TX_M0** | 1T21 | GPIO4_A6 | **UART5_TX_M0 (Alt4)** | 3.3V | **RS485 #1 TX** |
| 9 | TXD (debug) | AM10 | GPIO0_B3 | UART0_TX_M2 (Alt1) | 3.3V | Debug |
| **10** | **UART5_RX_M0** | 1T22 | GPIO4_A7 | **UART5_RX_M0 (Alt4)** | 3.3V | **RS485 #1 RX** |
| 11 | GPIO0_D0_D | 1AA8 | GPIO0_D0 | — | 3.3V | SDMMC0_PWREN |
| 12 | CLK_32K_OUT | AL12 | GPIO0_A2 | — | 3.3V | RTC clock out |
| **13** | **GPIO4_A0** | AG31 | GPIO4_A0 | **UART4_RTSN_M0 (Alt4)** | 3.3V | Rảnh → DE/RE |
| 14 | GND | — | — | — | — | Mass |
| 15 | GPIO4_A1 | AG32 | GPIO4_A1 | UART4_CTSN_M0 (Alt4) | 3.3V | Rảnh |
| 16 | GND | — | — | — | — | Mass |
| 17 | VCC_3V3 | — | — | — | 3.3V | Nguồn |
| 18 | CAM1-RST3.3 | DT26 | GPIO4_A1 | — | 3.3V | Camera |
| 19 | SPI1_MOSI_M1 | 1B16 | GPIO3_B2 | — | 3.3V | SPI1 / rảnh |
| 20 | GND | — | — | — | — | Mass |
| 21 | SPI1_MISO_M1 | 1B14 | GPIO3_B3 | — | 3.3V | SPI1 / rảnh |
| 22 | CAN0_RXD_M1 | — | GPIO5_D4 | UART3_TX_M1 (Alt7) | 3.3V | CAN0 / rảnh |
| **23** | **SPI1_CLK_M1** | 1A14 | GPIO3_B4 | **UART1_RTSN_M1 (Alt3)** | 3.3V | **→ RS485 #2 DE/RE** |
| 24 | SPI1_CSN0_M1 | 1A16 | GPIO3_B5 | UART1_CTSN_M1 (Alt3) | 3.3V | SPI1 / rảnh |
| 25 | GND | — | — | — | — | Mass |
| **26** | **SPI1_CSN1_M1** | B16 | GPIO3_B6 | **UART1_TX_M1 (Alt3)** | 3.3V | **→ RS485 #2 TX** |
| 27 | SCL.0 (I2C3_SCL_M1) | — | GPIO4_A4 | — | 3.3V | I2C3 |
| 28 | SDA.0 (I2C3_SDA_M1) | — | GPIO4_A5 | — | 3.3V | I2C3 |
| 29 | CAN0_RXD_M1 | — | GPIO5_A0 | UART4_RTSN_M1 (Alt8) | 3.3V | Rảnh |
| 30 | GND | — | — | — | — | Mass |
| 31 | CAN1_RXD_M0 | 1A22 | GPIO5_D6 | UART0_TX_M1 (Alt0) | 3.3V | CAN1 / rảnh |
| 32 | SPI1_CSN1_M1 | — | — | — | 3.3V | Rảnh |
| 33 | GND | — | — | — | — | Mass |
| 34 | GND | — | — | — | — | Mass |
| 35 | GPIO3_B7_D | — | GPIO3_B7 | UART1_RX_M1 (Alt3) | 3.3V | Rảnh |
| **36** | **GPIO3_B7_D** | A16 | GPIO3_B7 | **UART1_RX_M1 (Alt3)** | 3.3V | **→ RS485 #2 RX** |
| 37 | BT_WAKE_HOST | 1V21 | GPIO4_A3 | UART4_TX_M0 (Alt4) | 3.3V | **BT chiếm** |
| 38 | HOST_WAKE_BT | 1Y23 | GPIO4_A2 | UART4_RX_M0 (Alt4) | 3.3V | **BT chiếm** |
| 39 | GND | — | — | — | — | Mass |
| 40 | BT_REG_ON | 1AB4 | GPIO0_B0 | — | 3.3V | **BT chiếm** |

---

## 2. Bảng UART Mux tổng hợp

Mỗi UART của RV1126B có thể đưa ra nhiều cụm chân khác nhau (M0, M1, M2). Bảng dưới
đây tổng hợp tất cả phương án, đánh dấu cụm nào đang dùng và cụm nào khả dụng trên Header P16.

| UART | Cụm Mux | Chân TX trên P16 | Chân RX trên P16 | Chân RTS trên P16 | DT Status | Dùng cho | Khả dụng? |
|---|---|:---:|:---:|:---:|---|---|---|
| **UART0** | M2 | 9 | 10 (\*) | — | `disabled` | Debug (earlycon) | ⚠ Chồng RS485 #1 |
| **UART1** | **M1** | **26** | **36** | **23** | `disabled` | **→ ĐỀ XUẤT RS485 #2** | ✅ **CÓ** |
| UART1 | M0 | — | — | — | — | Không ra P16 | ❌ |
| **UART2** | M0 | — | — | — | — | Dùng nội bộ (IOP MCU?) | ❌ |
| UART2 | M1 | — | — | — | — | Trong Part N VCCIO7 | ❌ Không ra P16 |
| UART3 | M1 | (22) | (LCDC) | — | `disabled` | Chân LCDC, khó dùng | ⚠ Xung đột |
| **UART4** | M0 | **37** | **38** | **13** | `disabled` | BT_WAKE/HOST_WAKE | ❌ **BT chiếm** |
| **UART5** | M0 | **8** | **10** | — | `okay` | **RS485 #1 hiện tại** | ✅ Đang dùng |
| UART6 | M0 | — | — | — | `disabled` | Trong Part L VCCIO5 (LCDC) | ❌ Không ra P16 |
| UART7 | M0 | — | — | — | `disabled` | Trong Part L VCCIO5 (LCDC) | ❌ Không ra P16 |

> [!IMPORTANT]
> **Kết luận:** Trên Header P16, chỉ có **UART1 M1** (chân 26/36/23) là cụm duy nhất
> khả dụng để mở rộng RS485 #2 mà không xung đột với bất kỳ chức năng đang dùng nào.

---

## 3. Bảng I2C / SPI / CAN

### 3.1 I2C

| Bus | Trạng thái | Thiết bị trên bus | Chân P16 |
|---|---|---|---|
| I2C-0 | `okay` | PMIC RK805 (0x27) | Không ra P16 |
| I2C-3 | `okay` | Rảnh | Chân 27 (SCL), 28 (SDA) |
| I2C-4 | `okay` | RTC RX8010 (0x32) | Chân 3 (SDA), 5? (SCL) |

### 3.2 SPI

| Bus | Trạng thái | Chân P16 | Ghi chú |
|---|---|---|---|
| SPI1 (CS0) | `okay` (`/dev/spidev1.0`) | 19 (MOSI), 21 (MISO), 23 (CLK), 24 (CS0) | ⚠ **Xung đột nếu dùng UART1 M1** |
| SPI1 (CS1) | `okay` (`/dev/spidev1.1`) | 26 (CS1) | ⚠ Xung đột UART1 TX |

> [!WARNING]
> Nếu bật UART1 M1 cho RS485 #2, **SPI1 trên P16 sẽ mất** (chân 23/24/26 chuyển sang
> UART). Nếu dự án cần SPI1 trên P16, phải chọn phương án UART khác hoặc dùng USB-to-RS485.

### 3.3 CAN FD

| Bus | DT Node | Trạng thái | Chân P16 (nếu bật) |
|---|---|---|---|
| CAN0 | `can@21d40000` | `disabled` | M1: chân 22 (RX), ? (TX) |
| CAN1 | `can@21d50000` | `disabled` | M0: chân 31 (RX), ? (TX) |

---

## 4. Tổng hợp GPIO trống / đã dùng trên P16

| Chân P16 | Tên | Chức năng hiện tại | Trống? |
|:---:|---|---|:---:|
| 7 | GPIO0_C7 | Rảnh (GPIO input) | ✅ |
| 11 | GPIO0_D0_D | SDMMC0_PWREN | ❌ |
| 13 | GPIO4_A0 | Rảnh (→ đề xuất UART4_RTSN hoặc GPIO) | ✅ |
| 15 | GPIO4_A1 | Rảnh | ✅ |
| 19 | SPI1_MOSI_M1 | SPI1 / rảnh | ⚠ |
| 21 | SPI1_MISO_M1 | SPI1 / rảnh | ⚠ |
| 22 | CAN0_RXD_M1 | Rảnh / CAN0 | ✅ |
| 23 | SPI1_CLK_M1 | SPI1 / → UART1_RTS | ⚠ |
| 24 | SPI1_CSN0_M1 | SPI1 / → UART1_CTS | ⚠ |
| 26 | SPI1_CSN1_M1 | SPI1 / → UART1_TX | ⚠ |
| 29 | CAN0_RXD | Rảnh | ✅ |
| 31 | CAN1_RXD_M0 | Rảnh / CAN1 | ✅ |
| 35/36 | GPIO3_B7_D | Rảnh / → UART1_RX | ✅ |
| 37 | BT_WAKE_HOST | **BT chiếm** | ❌ |
| 38 | HOST_WAKE_BT | **BT chiếm** | ❌ |
| 40 | BT_REG_ON | **BT chiếm** | ❌ |

**Tổng GPIO trống trên P16 (không tính nguồn/GND):** ~8-10 chân tùy cấu hình SPI1/CAN.

---

## 5. Lịch sử phiên bản

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-05 | Phiên bản đầu tiên — ánh xạ từ bảng Pin Mux SoM + sơ đồ mạch P16 + Device Tree live |
