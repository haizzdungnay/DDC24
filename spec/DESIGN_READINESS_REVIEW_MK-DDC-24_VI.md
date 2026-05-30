# Design-Readiness Review — MK-DDC-24
## Đánh giá chéo toàn bộ tài liệu trước giai đoạn Thiết kế chi tiết

> **Document ID:** REVIEW-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30
> **Trạng thái:** Active — review findings, chờ team xử lý
> **Tác giả:** Document Review (cross-document audit)
> **Phạm vi:** 24 tài liệu (top-level + `spec/` + `hardware-design/`)

---

## TRẠNG THÁI XỬ LÝ (cập nhật 2026-05-30)

> ✅ **Đã xử lý toàn bộ P0 + P1 + P2** trong vòng đồng bộ 2026-05-30. Quyết định đã chốt (ghi ở OPEN_ISSUES R006–R009):
> - **MCU → STM32G0B1RBT6** (3×SPI, 2×DMA, 144KB SRAM) → hợp thức SPI3→ADS131M08.
> - **MCU là master duy nhất ADS131M08**; CM3 SPI0→TFT; gỡ mọi CM3-SPI2→ADC.
> - **Modbus map chuẩn = INT16 ×100** (DS §4.1); sửa SW-MOD.
> - **MCU_SPEC §5/§4** trỏ về IOP-SPEC/FW_ARCH (gỡ protocol cũ CRC-CCITT).
> - **AO mode = phần mềm** per kênh (lệnh SET_AO_CFG, IOP v1.1).
> - **Pinout MCU chuẩn hóa**; **MCU-OTA UART bootloader bật ở Ver1**; **FR/NFR ID thống nhất theo PRD**; **+15V rail** vào block diagram; **port 1883 chặn**; số device MS/TP, NTC β=3950, session 30′…
>
> ⏭ **Còn lại:** các quyết định/issue cần đầu vào ngoài tài liệu (CM3 extended-temp HW-Q-002, BTL lab, EMC lab, thermal derating) và **khởi tạo bộ tài liệu thiết kế D-1…D-11** (mục 5) — là bước tiếp theo.

---

## 0. Kết luận tổng quan

| Hạng mục | Đánh giá |
|----------|----------|
| Độ phủ requirements (PRD→SRS→SW/FW→Test) | **Tốt** — có traceability, có acceptance gate |
| Độ chi tiết HW (mạch I/O, power, BOM, EMC) | **Tốt** — đủ để bắt đầu schematic |
| Độ chi tiết SW/FW (IOP, kiến trúc, task model) | **Tốt** |
| **Tính nhất quán chéo giữa các tài liệu** | **⚠ CÓ VẤN ĐỀ** — nhiều mâu thuẫn P0/P1 |
| **Sẵn sàng cho thiết kế chi tiết** | **CHƯA** — phải đóng các issue P0 dưới đây trước |

**Nguyên nhân gốc của phần lớn mâu thuẫn:** `hardware-design/` (2026‑05‑27) viết theo kiến trúc *"CM3 đọc ADC trực tiếp"*; sau đó `spec/` (2026‑05‑28) chốt lại *"UART‑only, MCU đọc ADC"* (IOP‑Q‑R001) nhưng **chưa cập nhật ngược lại** vào `hardware-design/` và `HW_SPEC`.

---

## 1. Vấn đề P0 — Blocker (phải đóng trước khi thiết kế)

### P0‑1 — Mâu thuẫn "ai đọc ADS131M08" (kiến trúc cốt lõi)

Tồn tại **3 phát biểu loại trừ nhau** về luồng tín hiệu của 8 Universal Input — đường tín hiệu quan trọng nhất của sản phẩm:

| Nguồn | Phát biểu |
|-------|-----------|
| `IOP-SPEC`, `FW_REQ` (FW‑IO‑001), `FW_ARCH`, `SW_ARCH §3.1`, `MCU_SPEC §3.2` | **MCU** đọc ADS131M08 qua SPI → gửi UI_RAW **lên** SOM qua IOP ✅ |
| `SOM_SPEC §2.2/§3.3`, `HW_SPEC §2.1`, `CB_BLOCK_DIAGRAM §1`, `CB_SCHEMATIC_NOTES §2.4` | **CM3/SOM** đọc ADS131M08 trực tiếp qua **SPI2** |
| `IO_UI_CIRCUIT §2` | "CM3 đọc ADS131M08, **giao raw value xuống STM32** qua IOP" (đảo ngược luồng) |

- `CB_BLOCK_DIAGRAM §1` chứa **đồng thời cả hai** đấu nối (CM3 CON2‑SPI2→ADS131M08 **và** STM32 SPI3→ADS131M08). Hai SPI master trên cùng một slave = sai về điện.
- `IO_UI_CIRCUIT §2` đấu SCLK/DOUT tới **cả** CM3 SPI2 **và** STM32 SPI3.

**Quyết định đúng (đã chốt):** IOP‑Q‑R001 = *UART‑only giữa SOM↔MCU, xóa mọi reference SPI*. Vậy **MCU là master duy nhất của ADS131M08**.
**Hành động:** Xóa toàn bộ tham chiếu "CM3/SOM đọc ADS131M08 qua SPI2" trong `SOM_SPEC`, `HW_SPEC §2.1`, `CB_BLOCK_DIAGRAM`, `CB_SCHEMATIC_NOTES §2.4`, `IO_UI_CIRCUIT §2`. SOM SPI giải phóng → chỉ còn **SPI0 → TFT ILI9341**.

### P0‑2 — Modbus register map có 3 định nghĩa không tương thích

| Nguồn | AI1–AI8 | AO1–AO4 | Định dạng |
|-------|---------|---------|-----------|
| `DS §4.1`, `PRD UC‑06` | Input Reg 3x:0–7 | Holding 4x:0–3 | **INT16 ×100** |
| `SRS §6.2` (MB‑003/004) | Input Reg (scaled) | Holding 4x:0–3 (0–10000) | INT16 |
| `SW_REQ §10` (SW‑MOD‑003/005) | **Holding** Reg 0–7 | **Holding 20–27** | **FLOAT32 (2 reg/kênh)** |

Ba bản đồ này không thể cùng tồn tại → chặn implement Modbus và test SCADA (PRD Acceptance + FAT).
**Hành động:** Chốt **một** register map chuẩn, tách thành file `MODBUS_MAP_MK-DDC-24_VI.md`, mọi tài liệu khác chỉ trỏ về đó. (Khuyến nghị: INT16 scaled cho tương thích PLC/SCADA phổ thông, hoặc FLOAT32 nếu ưu tiên độ chính xác — cần chốt.)

### P0‑3 — Hai định nghĩa IOP protocol mâu thuẫn

| Nguồn | Frame | CRC | SEQ | Command set | Timeout |
|-------|-------|-----|-----|-------------|---------|
| `IOP-SPEC v1.0` (owner) | SOF/LEN/CMD/SEQ/PL/CRC16 | CRC‑16/**Modbus** | Có | GET_IO/IO_RESP gộp | 10/100ms |
| `MCU_SPEC §5` | STX/LEN/CMD/PL/CRC16 | CRC16‑**CCITT** | Không | READ_AI/READ_DI/WRITE_AO riêng | 50ms |

`IOP-SPEC` tự khai báo là "nguồn spec DUY NHẤT". `MCU_SPEC §5` là bản cũ (27/05) đã lỗi thời.
**Hành động:** Xóa bảng protocol trong `MCU_SPEC §5`, thay bằng con trỏ tới `IOP-SPEC`. Đồng bộ luôn `MCU_SPEC §4` (task model) với `FW_ARCH §2`.

---

## 2. Vấn đề P1 — Critical (đóng trước FAT)

### P1‑1 — Giả định phần cứng STM32G071 không đúng (SPI3 + 2 DMA controller)
`STM32G071RB` chỉ có **SPI1 + SPI2** (không có **SPI3**) và **1 DMA controller** (DMA1, 7 kênh) + DMAMUX.
- "SPI3 → ADS131M08" xuất hiện ở `FW_ARCH §1/§3/§6`, `FW_REQ FW‑IO‑001`, `MCU_SPEC §2/§3.2`, `CB_BLOCK §1`.
- `OPEN_ISSUES FW‑Q‑001` còn viết "STM32G071 có **2 DMA controllers**" — sai.
- `MCU_SPEC §3.2` chỉ liệt kê SPI3_MISO cho ADS131M08, **thiếu MOSI/DIN** (ADS131M08 cần SDI để ghi cấu hình register).

**Quyết định cần chốt:** (a) **giữ STM32G071**, gán ADC sang **SPI2**, sửa khẳng định DMA; hoặc (b) **nâng lên STM32G0B1RB** (3×SPI, 2×DMA) để có dư địa. → ảnh hưởng pinout + BOM.

### P1‑2 — Cơ chế chọn dải AO: jumper hay phần mềm?

| Nguồn | Cơ chế |
|-------|--------|
| `HW_SPEC §6.1`, `IOP-SPEC §4.4` | **Jumper phần cứng**; SOM không gửi mode |
| `IO_AO §5`, `FW_REQ FW‑AO‑007` | **Relay/analog‑switch per kênh**, lệnh `SET_AO_CFG` từ SOM |

Mâu thuẫn này ảnh hưởng FW, cấu hình BACnet, quy trình commissioning và BOM.
**Khuyến nghị:** chọn **phần mềm‑per‑kênh** (UX tốt hơn, khớp FW‑AO‑007 và IDE‑021) — rồi cập nhật `HW_SPEC` + `IOP-SPEC §4.4` cho thống nhất, bổ sung `SET_AO_CFG` vào IOP v1.1.

### P1‑3 — Bản đồ chân MCU mâu thuẫn 3 chiều (DI/DO/FAULT/DRDY)

| Tín hiệu | `MCU_SPEC` | `CB_BLOCK` | `IO_*` |
|----------|-----------|-----------|--------|
| DI1–DI8 | PB4–PB11 | PA0–PA7 | "PA_x" |
| DO1–DO4 | PC0–PC3 | PB0–PB3 | "PB_x" |
| FAULT | PD5 | PB4 | — |
| DRDY ADC | PB1 | — | PA8 |

Ngoài ra `MCU_SPEC §3.2` dùng **PB0 = SPI1_LDAC** nhưng `CB_BLOCK`/`IO_DO` dùng **PB0–PB3 = DO** → đụng chân.
**Hành động:** Lập **một bảng pinout MCU chuẩn** trong `MCU_SPEC`, `CB_BLOCK` + `IO_*` chỉ trỏ về.

### P1‑4 — Khả năng OTA của MCU mâu thuẫn yêu cầu
`MCU_SPEC §7`: "Ver 1 chỉ nạp MCU qua **SWD**, CM3 KHÔNG flash MCU qua UART".
`SRS OTA‑004` + `FW_REQ FW‑OTA‑001..005` + `SW_OTA‑004`: **bắt buộc** SOM nạp firmware MCU trong cùng gói OTA, **Ver 1**.
**Quyết định cần chốt:** bật đường UART bootloader (CM3 điều khiển BOOT0 + nRESET) cho Ver 1, **hoặc** loại MCU‑OTA khỏi phạm vi Ver 1.

### P1‑5 — Hai ma trận traceability dùng bộ FR ID khác nhau
`PRD §8` đánh số **FR‑001…FR‑036** (theo nhóm). `TEST_SPEC §5.1` lại tự đánh **FR‑001…FR‑025** với nghĩa khác (vd: PRD FR‑020 = BACnet MS/TP+IP; TEST_SPEC FR‑020 = Failsafe). Cùng ID, khác nghĩa → phá vỡ truy vết.
**Hành động:** Thống nhất dùng **bộ FR ID của PRD** trong mọi ma trận.

### P1‑6 — Thiếu rail +15V trong block diagram carrier
`CB_BLOCK §1` (khối nguồn) chỉ liệt kê 5V/3.3V/1.8V và **dán nhãn nhầm** "1.8V = AO ref". Nhưng AO op‑amp cần **+15V** (`PWR_DESIGN §6`, `HW_SPEC §8.2` có). Đồng thời biên áp tuân thủ 4–20mA chỉ ~13V cho tải 12V (600Ω) → **margin mỏng**, cần xác nhận.
**Hành động:** Bổ sung +15V vào block diagram + lớp L3; xem lại headroom 4–20mA.

---

## 3. Vấn đề P2 — Major (có workaround, đóng trong sprint)

| ID | Mô tả | Nguồn mâu thuẫn |
|----|-------|-----------------|
| P2‑1 | Số device MS/TP: **127 / 32 / 64** | `DS §3.3` vs `DS §5.2` vs `HW_SPEC §9` |
| P2‑2 | Session timeout: **30 phút / 8 giờ / JWT 1 giờ** | `SRS IDE‑031` vs `SW_REQ SW‑IDE‑023` vs `API‑002` |
| P2‑3 | Mở port **1883 plaintext** trong khi TLS bắt buộc | `SEC‑020` vs `MQ‑002` |
| P2‑4 | Giá trị mạch UI khác nhau (divider 10k/2k vs 100k/12.1k; shunt 250Ω vs 62Ω) | `HW_SPEC §4.1` vs `IO_UI §3` + BOM |
| P2‑5 | Hệ số NTC khác nhau (Murata NCP18XH103 B≈3380 vs part B=3950) | `SW_ARCH §4` vs `IO_UI §3.5` |
| P2‑6 | Tải tối thiểu AO 0–10V: **500Ω vs 2kΩ** | `HW_SPEC §6.1` vs `IO_AO §6` |
| P2‑7 | Tên IC mux: **MUX506 vs TMUX1208** | `IO_UI §3.1` vs `IO_UI §4`/BOM |
| P2‑8 | Flyback relay: **1N4007 ngoài vs ULN2003 nội** | `HW_SPEC §7.1` vs `IO_DO §8` |
| P2‑9 | Ai đọc DIP switch Device ID: **CM3 GPIO vs MCU qua IOP DIAG** | `SOM_SPEC §3.5` vs `SW_BAC‑006` |
| P2‑10 | DAC8554 LDAC: **nối GND (immediate) vs điều khiển PB0** | `IO_AO §2` vs `MCU_SPEC §3.2` |
| P2‑11 | Rating relay ghi mập mờ "10A… Min switched 5A" (spec là 5A) | `IO_DO §2` |

---

## 4. Vấn đề P3 — Minor

- `hardware-design/README.md` liệt kê file `01_som/SOM_PINMAP_CM3.md` **không tồn tại** (index lỗi thời).
- `IO_DI §2`: R2 = 330Ω (sơ đồ) vs 470Ω (bảng).
- Mốc thời gian dùng placeholder "Q4/Y7", "Month 2/3" — cần quy về ngày tuyệt đối khi lập kế hoạch.
- Nhãn rời rạc, vài lỗi chính tả nhỏ.

---

## 5. Khoảng trống cần bổ sung để bắt đầu Thiết kế chi tiết

Các tài liệu hiện là **requirements + architecture**. Để mở giai đoạn **Detailed Design (DDD)** cần thêm:

| # | Tài liệu thiết kế còn thiếu | Owner đề xuất |
|---|------------------------------|----------------|
| D‑1 | **MCU Pinout Master Table** (nguồn duy nhất chân STM32) | FW/HW |
| D‑2 | **Modbus Register Map** (file chuẩn riêng) | SW |
| D‑3 | **BACnet PICS/EPICS** đầy đủ (không chỉ summary) | SW |
| D‑4 | **REST API OpenAPI spec** (machine‑readable) | SW |
| D‑5 | **Config JSON schema** cho `/data/config/*.conf` | SW |
| D‑6 | **PLC engine internal design** (FBD/ST runtime, scan, retain) | SW |
| D‑7 | **OTA combined sequence** (SOM + MCU) — sequence diagram | SW/DevOps |
| D‑8 | **Mechanical/Enclosure design** (mới có kích thước) | HW |
| D‑9 | **Schematic + PCB layout** (KiCad) — đầu ra giai đoạn thiết kế | HW |
| D‑10 | **Thermal derating report** (mở khóa dải −20…+65°C) | HW |
| D‑11 | **Key management / secure storage design** (HSM vs OP‑TEE vs TPM — SW‑Q‑004) | SW/Security |

---

## 6. Thứ tự xử lý đề xuất

1. **Đóng P0** (kiến trúc ADC, Modbus map, IOP protocol) → đồng bộ toàn bộ tài liệu.
2. **Chốt 3 quyết định P1** (MCU G071↔G0B1, AO mode jumper↔software, MCU‑OTA Ver1) → cập nhật `OPEN_ISSUES` DEC‑log.
3. **Hợp nhất pinout + FR ID + +15V rail**.
4. **Dọn P2/P3** đồng loạt.
5. **Khởi tạo bộ tài liệu D‑1…D‑11** cho giai đoạn thiết kế.

---

**Document ID:** REVIEW-MK-DDC-24-VI
**Revision:** 1.0 | 2026-05-30
