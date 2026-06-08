# D4 — EMI Filter Specifications (Bộ lọc nhiễu điện từ)

> **Document ID:** CR-QCVN-D4-EMI-FILTER | Rev 1.0 | 2026-06-02  
> **Chứng nhận:** QCVN 9:2012 / IEC 61326-1 (Class A)  
> **Thiết bị:** MK-DDC-24 — Bộ điều khiển DDC 24 điểm  
> **Tài liệu tham khảo:** EMC_THERMAL_NOTES.md (§2.4), PWR_DESIGN.md (§7), CB_SCHEMATIC_NOTES.md (§4–5)

---

## 1. Tổng quan

Tài liệu này liệt kê toàn bộ linh kiện EMI filter trên MK-DDC-24, gồm ferrite bead, common-mode choke, Y-capacitor, và filter schematic. Các linh kiện này đảm bảo sản phẩm đáp ứng giới hạn phát xạ dẫn (conducted emission) và phát xạ bức xạ (radiated emission) theo CISPR 11 Class A / QCVN 9:2012.

---

## 2. Bảng Spec EMI Filter Components

### 2.1 Ferrite Bead — RS-485 (A/B Line)

| Tham số | Giá trị |
|---------|---------|
| **Mục đích** | Triệt nhiễu HF common-mode trên đường truyền RS-485 |
| **Trở kháng @ 100MHz** | 600Ω ±25% |
| **Dòng DC max** | ≥ 200mA |
| **DCR** | ≤ 0.3Ω |
| **Package** | 0805 (hoặc 1206 cho dòng cao hơn) |
| **Vị trí** | Nối tiếp trên A và B line, sau TVS, trước MAX13487E |
| **Số lượng** | 2 (1/chân A, 1/chân B) |

### 2.2 Ferrite Bead — Relay Power (+5V_RELAY)

| Tham số | Giá trị |
|---------|---------|
| **Mục đích** | Cách ly nhiễu HF từ relay coil bounce khỏi +5V main rail |
| **Trở kháng @ 100MHz** | 600Ω ±25% |
| **Dòng DC max** | ≥ 500mA |
| **DCR** | ≤ 0.3Ω |
| **Package** | 0805 hoặc 1206 |
| **Vị trí** | Nối tiếp giữa +5V main rail và +5V_RELAY node |
| **Số lượng** | 1 |

### 2.3 Ferrite Bead — UI Input Channels

| Tham số | Giá trị |
|---------|---------|
| **Mục đích** | Lọc nhiễu HF common-mode trước mạch điều hòa tín hiệu analog UI |
| **Trở kháng @ 100MHz** | 600Ω ±25% |
| **Dòng DC max** | ≥ 50mA |
| **DCR** | ≤ 1.0Ω |
| **Package** | 0603 hoặc 0805 |
| **Vị trí** | Nối tiếp trên mỗi kênh UI, kết hợp 100nF ceramic song song xuống GND |
| **Số lượng** | 8 (1/kênh UI) |

### 2.4 Common-Mode Choke — 24V Power Input

| Tham số | Giá trị |
|---------|---------|
| **Mục đích** | Triệt nhiễu common-mode từ nguồn 24VAC/VDC vào board |
| **Inductance (common-mode)** | 3.5 mH ±30% (@ 1kHz, 0.25V) |
| **Dòng DC max** | ≥ 2A |
| **DCR** | ≤ 0.15Ω mỗi cuộn |
| **Điện áp cách điện** | ≥ 500VAC (1 phút) |
| **Package** | Vertical bobbin core, 4-pin |
| **Vị trí** | Sau terminal 24V input, trước cầu diode GBU4J |
| **Số lượng** | 1 |

### 2.5 Y-Capacitor — 24V Power Input to Chassis GND

| Tham số | Giá trị |
|---------|---------|
| **Mục đích** | Dẫn dòng nhiễu common-mode từ power input xuống chassis GND |
| **Điện dung** | 10 nF ±20% |
| **Điện áp định mức** | 1 kV DC / 250 VAC |
| **Loại** | Gốm Class Y2 (hoặc X1/Y2) |
| **Vị trí** | Một chân nối DC_RAW (sau choke), một chân nối chassis GND |
| **Số lượng** | 1 |

### 2.6 Bypass + Output Filter Components (EMI-relevant)

| Vị trí | Linh kiện | Chức năng EMI |
|--------|----------|--------------|
| LM2596 input | C3: 100nF X7R | HF bypass đầu vào DC/DC (giảm conducted noise ngược về nguồn) |
| LM2596 output | C4: 470µF low-ESR; C5: 100nF X7R | Lọc ripple output DC/DC, giảm phát xạ dẫn |
| Mỗi VDD pin IC | 100nF X7R 0402 | Bypass địa phương, giảm power plane noise |
| RS-485 | SMAJ6.5A TVS + FB 600Ω | TVS clamp surge, FB lọc noise còn lại |

> **Ghi chú:** Ethernet common-mode choke được tích hợp trong module magnetics RJ-45 HR911105A, không cần linh kiện rời.

---

## 3. Filter Schematic

### 3.1 24V Power Input EMI Filter Chain

```
Terminal Block 24V           CM Choke 3.5mH            Y-Cap 10nF/1kV
     │                              │                        │
24V+ ──────┬───[Polyfuse F1]───[L_N 3.5mH]──┬──────────────┬─┴──────────► GBU4J AC Input
           │                                │              │
24V- ──────┴──────────────────[L_N 3.5mH]──┴──────────────┴────────────► GBU4J AC Input
                                                             │
                                                        [Y-cap 10nF]
                                                             │
                                                          Chassis GND
```

**Thứ tự lọc:** Terminal → Polyfuse → CM Choke → Y-cap → Bridge Rectifier  
**Mục đích:** CM choke triệt common-mode noise từ nguồn, Y-cap dẫn dòng residual xuống chassis.

### 3.2 RS-485 EMI Filter (per line)

```
RS-485 A ──[TVS SMAJ6.5A→GND]──[FB 600Ω@100MHz]── MAX13487E A
RS-485 B ──[TVS SMAJ6.5A→GND]──[FB 600Ω@100MHz]── MAX13487E B
```

### 3.3 Relay Power Filter

```
+5V main ──[FB 600Ω@100MHz]── +5V_RELAY ──► Relay coil ULN2003A
                                              │
                                          [100nF X7R→GND]
```

### 3.4 UI Input EMI Filter (mỗi kênh)

```
UI_n terminal ──[FB 600Ω@100MHz]──┬── R_fuse 100Ω ──► TVS SMAJ15A ──► Mạch điều hòa
                                   │
                               [100nF X7R→GND]
```

---

## 4. BOM Summary — EMI Filter Components

| # | Linh kiện | Giá trị | Package | Số lượng | Vendor gợi ý |
|---|-----------|---------|---------|:--------:|-------------|
| 1 | Ferrite bead (RS-485) | 600Ω@100MHz, 200mA | 0805 | 2 | Murata BLM18PG601SN1 |
| 2 | Ferrite bead (Relay) | 600Ω@100MHz, 500mA | 0805/1206 | 1 | Murata BLM21PG601SN1 |
| 3 | Ferrite bead (UI) | 600Ω@100MHz, 50mA | 0603 | 8 | Murata BLM15PX601SN1 |
| 4 | CM Choke (24V input) | 3.5mH, 2A | Bobbin 4-pin | 1 | Würth 744827110 / TDK B82787C |
| 5 | Y-cap (power-chassis) | 10nF, 1kV | Y2 ceramic | 1 | Murata DE1E3RA103MN4A |
| 6 | Bypass 100nF X7R | 100nF, ≥25V | 0402 | — | Tiêu chuẩn (nhiều) |
| 7 | Output cap 470µF | 470µF, 16V, low-ESR | THT/Radial | 1 | Panasonic FR series |

---

## 5. QCVN 9:2012 Mapping

| Yêu cầu QCVN 9:2012 | Giải pháp EMI filter | Mục tài liệu |
|---------------------|---------------------|:----------:|
| Giới hạn phát xạ dẫn (0.15–30MHz) | CM choke 3.5mH + Y-cap 10nF tầng input | §2.4, §2.5, §3.1 |
| Giới hạn phát xạ bức xạ (30–1000MHz) | FB 600Ω RS-485 + UI + relay; bypass gần IC | §2.1–2.3, §2.6 |
| Miễn nhiễm surge (IEC 61000-4-5) | TVS + FB kết hợp (RS-485, UI) | §3.2, §3.4 |
| Giảm nhiễu relay bounce | FB relay + 100nF bypass | §3.3 |

---

**Document ID:** CR-QCVN-D4-EMI-FILTER | Rev 1.0 | 2026-06-02  
**Next document:** [D5 — Grounding Scheme](cr-qcvn-D5-grounding-scheme.md)
