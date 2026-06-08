# B8 — Critical Components List

> **Document ID:** CR-QCVN-B8-v1 | Rev 1.0 | 2026-06-02  
> **Mục đích:** Phục vụ chứng nhận QCVN / CR Mark — Danh sách linh kiện ảnh hưởng đến an toàn  
> **Input source:** HW-DES-06-BOM (BOM MK-DDC-24 v1.0), HW-DES-02-CB  
> **Taxonomy:** B8-list-v1

---

## 1. Danh sách linh kiện critical

Các linh kiện được phân loại **critical** nếu thuộc một trong các nhóm:
- **Nguồn:** Ảnh hưởng đến cách ly, quá áp, quá dòng
- **Relay:** Tiếp điểm cao áp (250VAC), yêu cầu clearance/creepage
- **Opto-isolator:** Cách ly giữa HV (24VDC DI) và logic 3.3V
- **TVS / Fuse:** Bảo vệ quá áp, quá dòng đầu vào

---

### 1.1 Power Supply — Linh kiện nguồn

| # | RefDes | Mô tả | Model / Part# | Nhà SX | Thông số | Safety Cert | Chức năng |
|:-:|--------|-------|---------------|--------|----------|:-----------:|-----------|
| 1 | BR1 | Bridge rectifier 4A | GBU4J-E3/45 | Vishay | 4A, 600V, GBU package | ✅ UL (E54214) | Chỉnh lưu đầu vào 24VAC/VDC, chống reverse polarity |
| 2 | F1 | Polyfuse resetable 2A | MF-R200/12 | Bourns | 2A hold, 12V max, 1812 | ✅ UL (E174432), CSA | Bảo vệ quá dòng đầu vào |
| 3 | D51 | TVS diode input surge | P6KE33A-E3/54 | Vishay | 33V standoff, 600W, DO-15 | ✅ UL (E54214) | Clamp điện áp đầu vào khi surge |
| 4 | U28 | DC/DC step-down 5V/3A | LM2596HVSX-5.0/NOPB | TI | 5V/3A, D²PAK | ✅ UL (pending — TI component) | Tạo rail 5V chính cho CM3 + MCU |
| 5 | L1 | Power inductor 100µH/3A | SRR1260-101Y | Bourns | 100µH, 3A, SMD | ✅ UL (E174432) | Output filter cho DC/DC |
| 6 | D50 | Schottky freewheeling | SS34-E3/57T | Vishay | 3A, 40V, DO-214AC | ✅ UL (E54214) | Freewheeling diode cho DC/DC |
| 7 | C50 | Bulk capacitor input | 50ZLH470M10X23 | Rubycon | 470µF/50V, Low ESR | ✅ UL recognized | Lọc đầu vào DC/DC |
| 8 | U29 | LDO 3.3V/1A | AP2114H-3.3TRG1 | Diodes Inc | 3.3V/1A, SOT-223 | ❌ (LDO — low risk) | Cấp 3.3V cho logic |
| 9 | U30 | LDO 1.8V/200mA | XC6206P182MR | Torex | 1.8V/200mA, SOT-23-3 | ❌ (LDO — low risk) | Cấp 1.8V cho ADC DVDD |
| 10 | U31 | Boost converter +15V | SX1308 | Shengxin | +15V/200mA, SOT-23-6 | ❌ (generic — low risk) | Tạo rail AO op-amp |
| 11 | L2 | Boost inductor 22µH | SRR0604-220Y | Bourns | 22µH, SMD | ✅ UL (E174432) | Output filter cho boost |

---

### 1.2 Relay — Rơ-le đầu ra

| # | RefDes | Mô tả | Model / Part# | Nhà SX | Thông số | Safety Cert | Chức năng |
|:-:|--------|-------|---------------|--------|----------|:-----------:|-----------|
| 12 | K1–K4 | Relay SPDT 5A 250VAC | HF46F-005-HS1TGF | Hongfa | 5A/250VAC, 5V coil, PCB | ✅ UL (E339127), VDE (40047069) | Đóng cắt tải AC/DC đầu ra |
| 13 | U27 | Relay driver Darlington | ULN2003ADR | TI | 7-ch, 50V/500mA, SOIC-16 | ✅ UL recognized | Driver coil relay. TVS internal clamp |

> **Relay clearance theo IEC 61010-1:** ≥3.2mm (Cat II, Pollution 2), creepage ≥4mm.  
> Khoảng cách giữa các relay: ≥5mm.

---

### 1.3 Opto-isolator — Cách ly Digital Input

| # | RefDes | Mô tả | Model / Part# | Nhà SX | Thông số | Safety Cert | Chức năng |
|:-:|--------|-------|---------------|--------|----------|:-----------:|-----------|
| 14 | U9–U16 | Optocoupler DI | PC817B | Sharp | Vce 80V, CTR 130–260%, DIP-4/SOP-4 | ✅ UL (E65226), VDE | Cách ly 24VDC DI → 3.3V logic |

> Opto-isolator PC817B đảm bảo cách ly điện giữa ngõ vào 24VDC (HV) và logic 3.3V (LV).  
> Isolation voltage: 5kVrms/min (theo datasheet Sharp PC817B).

---

### 1.4 TVS — Bảo vệ quá áp I/O

| # | RefDes | Mô tả | Model / Part# | Nhà SX | Thông số | Safety Cert | Vị trí |
|:-:|--------|-------|---------------|--------|----------|:-----------:|--------|
| 15 | D1 (×2) | TVS RS-485 bus | SMAJ6.5A | Vishay | 6.5V standoff, DO-214AC | ✅ UL (E54214) | RS-485 terminal |
| 16 | D20–D27 (×8) | TVS UI protection | SMAJ15A | Vishay | 15V standoff, DO-214AC | ✅ UL (E54214) | UI terminal (trước signal conditioning) |
| 17 | D36–D39 (×4) | TVS AO output | SMAJ12A | Vishay | 12V standoff, DO-214AC | ✅ UL (E54214) | AO terminal (0-10V/4-20mA) |

---

### 1.5 Connectors — Đầu nối I/O (HV)

| # | RefDes | Mô tả | Model / Part# | Nhà SX | Thông số | Safety Cert | Chức năng |
|:-:|--------|-------|---------------|--------|----------|:-----------:|-----------|
| 18 | J7 | Power input terminal 2-pin | PT 1,5/2-ST-3.5 | Phoenix Contact | 250V/13.5A, pitch 3.5mm | ✅ UL (E60425) | Đầu nối nguồn 24VAC/VDC |
| 19 | J3 | Terminal block DI 10-pin | MC 1,5/10-ST-5.08 | Phoenix Contact | 250V/12A, pitch 5.08mm | ✅ UL (E60425) | Đầu nối DI 8-ch + COM |
| 20 | J4 | Terminal block UI 10-pin | — (Phoenix equivalent) | Phoenix Contact | 250V/12A, pitch 5.08mm | ✅ UL (E60425) | Đầu nối UI 8-ch + COM |
| 21 | J5 | Terminal block AO 8-pin | — (Phoenix equivalent) | Phoenix Contact | 250V/12A, pitch 5.08mm | ✅ UL (E60425) | Đầu nối AO 4-ch |
| 22 | J6 | Terminal block DO 12-pin | — (Phoenix equivalent) | Phoenix Contact | 250V/12A, pitch 5.08mm | ✅ UL (E60425) | Đầu nối DO relay 4× COM/NO/NC |

---

## 2. Ma trận Critical vs Non-Critical

| Nhóm | Critical? | Lý do |
|------|:---------:|-------|
| Power supply (BR1, F1, D51, U28, L1, D50, C50) | ✅ | Quyết định an toàn nguồn, chống cháy nổ |
| Relay (K1–K4, U27) | ✅ | Tiếp xúc cao áp 250VAC, nguy cơ hồ quang |
| Opto-isolator (U9–U16) | ✅ | Cách ly HV-LV, hỏng → mất cách ly |
| TVS (D1, D20–D27, D36–D39, D51) | ✅ | Bảo vệ quá áp, nếu không clamp → hỏng thiết bị sau |
| Fuse (F1) | ✅ | Bảo vệ ngắn mạch, chống cháy |
| Passive R, C, L (không nguồn/không HV) | ❌ | Không ảnh hưởng an toàn trực tiếp |
| ADC, DAC, MCU, CM3 (logic) | ❌ | SELV — không tiếp xúc HV (trừ relay điều khiển) |
| LED, DIP switch, button | ❌ | SELV, không ảnh hưởng cách ly |
| microSD, USB connector | ❌ | SELV, extra-low voltage |

---

## 3. Tổng hợp Safety Cert theo linh kiện

| Linh kiện | UL | VDE | CSA | Ghi chú |
|-----------|:--:|:---:|:---:|---------|
| GBU4J (Vishay) | E54214 | — | — | Bridge rectifier |
| MF-R200/12 (Bourns) | E174432 | — | ✅ | Polyfuse |
| P6KE33A (Vishay) | E54214 | — | — | TVS |
| SMAJ6.5A/12A/15A (Vishay) | E54214 | — | — | TVS |
| SRR1260 / SRR0604 (Bourns) | E174432 | — | — | Inductor |
| HF46F-005 (Hongfa) | E339127 | 40047069 | — | Relay, có VDE |
| PC817B (Sharp) | E65226 | ✅ | — | Optocoupler |
| ULN2003ADR (TI) | ✅ (UL recognized) | — | — | Driver |
| PT terminal (Phoenix) | E60425 | ✅ | ✅ | Connector |
| LM2596HVS (TI) | ✅ (pending) | — | — | DC/DC |

> **Lưu ý:** IC logic (STM32G0B1, ADS131M08, DAC8554, MAX13487E, ADUM1201) là SELV, không yêu cầu safety cert cho riêng từng IC nhưng toàn bộ board phải đạt IEC 61010-1 ở cấp hệ thống.

---

## 4. Tài liệu tham khảo

| Tài liệu | Link |
|----------|------|
| BOM Chi tiết MK-DDC-24 v1.0 | hardware-design/06_bom/BOM_MK-DDC-24_v1.md |
| Carrier Board Block Diagram | hardware-design/02_carrier_board/CB_BLOCK_DIAGRAM.md |
| SOM Spec (Radxa CM3) | hardware-design/01_som/SOM_SPEC_RADXA_CM3.md |
| IEC 61010-1 clearance/creepage | — |

---

**Document ID:** CR-QCVN-B8-v1 | Rev 1.0 | 2026-06-02
