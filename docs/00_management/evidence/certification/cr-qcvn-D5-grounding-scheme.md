# D5 — Grounding Scheme (Sơ đồ cấu hình nối đất)

> **Document ID:** CR-QCVN-D5-GROUNDING-SCHEME | Rev 1.0 | 2026-06-02  
> **Chứng nhận:** QCVN 9:2012 / IEC 61326-1, IEC 61010-1  
> **Thiết bị:** MK-DDC-24 — Bộ điều khiển DDC 24 điểm  
> **Tài liệu tham khảo:** EMC_THERMAL_NOTES.md (§2.1), CB_SCHEMATIC_NOTES.md (§4–5)

---

## 1. Tổng quan

Tài liệu này mô tả cấu hình nối đất (grounding scheme) của MK-DDC-24, bao gồm star ground, GND plane, chassis GND kết nối qua Y-cap, PE terminal, và RS-485 isolated GND. Sơ đồ này đảm bảo tham chiếu điện áp ổn định, giảm thiểu vòng lặp ground (ground loop), và đáp ứng yêu cầu an toàn điện IEC 61010-1.

---

## 2. Sơ đồ Grounding Tổng thể

```
                            ┌──────────────────────────────────────┐
                            │           CHASSIS (DIN-rail)          │
                            │  (Nhôm hoặc ABS V0, PE terminal)      │
                            └───────┬──────────────────────┬────────┘
                                    │                      │
                               [Y-cap 10nF/1kV]        [PE terminal]
                                    │                      │
                            ┌───────┴──────────────────────┴────────┐
                            │         Star Ground Point              │
                            │  (Gần power supply input, L2 plane)    │
                            └──────┬──────────────┬─────────┬───────┘
                                   │              │         │
                          ┌────────┴──┐    ┌──────┴──────┐  │
                          │ Analog GND │    │ Digital GND │  │
                          │ (ADC, AO,  │    │ (CM3, MCU,  │  │
                          │  signal    │    │  Ethernet,  │  │
                          │  cond.)    │    │  USB, DI)   │  │
                          └────────────┘    └──────┬──────┘  │
                                                   │         │
                                          ┌────────┴──┐      │
                                          │ RS-485     │      │
                                          │ Isolated   │      │
                                          │ GND        │      │
                                          │ (ADUM1201) │      │
                                          └────────────┘      │
                                                              │
                                                     ┌────────┴──┐
                                                     │ I/O GND   │
                                                     │ (UI, DI,  │
                                                     │  DO relay)│
                                                     └───────────┘
```

---

## 3. Grounding Topology

### 3.1 Star Ground (1 điểm nối đất trung tâm)

| Tham số | Giá trị |
|---------|---------|
| **Vị trí** | Gần power supply input (đầu vào 24V, cạnh C1 bulk cap) |
| **Kết nối** | Analog GND, Digital GND, Power GND hội tụ tại 1 điểm duy nhất |
| **Mục đích** | Loại bỏ vòng lặp ground (ground loop) giữa analog và digital section |
| **Implementation** | Kết nối hình sao, không daisy-chain, đường nối ngắn (< 5mm) |
| **Kiểm tra** | Đo continuity từ mọi GND node → star ground point, verify chỉ 1 đường dẫn |

### 3.2 L2 Continuous GND Plane

| Tham số | Giá trị |
|---------|---------|
| **Layer** | L2 (GND plane liên tục, không split) |
| **Yêu cầu** | Không cắt rãnh, không slot, không routing interference |
| **Độ dày đồng** | ≥ 35µm (1 oz) |
| **Mục đích** | Cung cấp đường hồi tiếp (return path) trở kháng thấp cho mọi tín hiệu |
| **Đặc tính** | Duy trì dưới tất cả trace high-speed (RGMII, SPI, USB, UART) |
| **Kiểm tra** | Visual inspection: không có slot hoặc air gap nào xuyên qua L2 |

> **Lưu ý:** Mặc dù dùng star ground ở cấp topology, L2 vẫn là 1 plane liên tục. Star ground được thực hiện bằng cách bố trí vật lý — các GND region riêng rẽ trên L1 và các layer khác kết nối về L2 tại 1 điểm chung duy nhất gần power input.

### 3.3 Chassis GND kết nối qua Y-Capacitor

| Tham số | Giá trị |
|---------|---------|
| **Linh kiện** | Y-cap gốm 10nF / 1kV (class Y2) |
| **Kết nối** | Một chân → DC_RAW (sau CM choke), một chân → Chassis GND (vỏ DIN-rail) |
| **Mục đích** | Dẫn dòng nhiễu common-mode từ power input xuống chassis, không tạo DC ground path |
| **Vị trí** | Gần power input connector, cạnh CM choke |
| **Chứng nhận** | Y2 safety capacitor (IEC 60384-14) |

### 3.4 PE Terminal (Protective Earth)

| Tham số | Giá trị |
|---------|---------|
| **Kết nối** | PE terminal trên vỏ DIN-rail → Chassis GND |
| **Yêu cầu** | IEC 61010-1: kết nối bảo vệ, tiết diện dây ≥ 2.5mm² |
| **Mục đích** | Chống điện giật, dẫn dòng sự cố xuống đất |
| **Ghi chú** | Nối PE từ DIN-rail đến tủ điện. Trong trường hợp vỏ nhựa ABS, PE terminal vẫn được cung cấp cho kết nối với đất tủ. |

### 3.5 RS-485 Isolated GND

| Tham số | Giá trị |
|---------|---------|
| **Giải pháp** | ADUM1201 digital isolator (SPI isolation) |
| **Phân ly** | RS-485 GND riêng, không kết nối trực tiếp với logic GND board |
| **Điện áp cách ly** | 2.5 kVrms (ADUM1201) |
| **Mục đích** | Loại bỏ ground loop qua cáp RS-485 giữa các thiết bị |
| **Nguồn cách ly** | DC/DC isolated converter (hoặc ISO power module) cấp riêng cho RS-485 side |

---

## 4. Grounding Matrix — Kết nối giữa các GND region

| Region | Kết nối đến | Phương thức | Ghi chú |
|--------|------------|-------------|---------|
| **Power GND** (input) | Star ground point | Trực tiếp | GND sau bridge rectifier, C1, LM2596 |
| **Digital GND** (CM3, MCU, Ethernet, USB) | Star ground point | Trực tiếp | Plane L2, region digital |
| **Analog GND** (ADC, AO op-amp, signal conditioning) | Star ground point | Trực tiếp | Tách riêng trên L1, kết nối về L2 tại star point |
| **I/O GND** (UI, DI, DO relay) | Star ground point | Trực tiếp | GND cho terminal I/O |
| **RS-485 GND** (isolated) | — | Cách ly (ADUM1201) | Không kết nối DC với star ground |
| **Chassis GND** (vỏ DIN-rail) | Star ground point | Qua Y-cap 10nF/1kV | Chỉ AC coupling, không DC path |
| **PE terminal** | Chassis GND | Trực tiếp | Dây ≥ 2.5mm² ra tủ điện |

---

## 5. PCB Layout Guidelines cho Grounding

### 5.1 Star Ground Implementation trên PCB

```
                        C1 (+)              C1 (-)
                         │                    │
                    ┌────┴────┐         ┌────┴────┐
                    │ Power   │         │ Power   │
                    │ Circuit │         │ GND     │
                    └─────────┘         └──┬──┬───┘
                                           │  │
                    ┌─────────┐     ┌──────┘  └──────────┐
                    │ Analog  │     │                     │
                    │ GND     │─────┴─────────────────┐   │
                    └─────────┘                       │   │
                                              ┌───────┴───┴──────┐
                    ┌─────────┐               │ Star Ground Point │
                    │ Digital │──────────────►│ (L2 plane, gần    │
                    │ GND     │               │  power input)     │
                    └─────────┘               └───────────────────┘
```

### 5.2 Quy tắc Layout

| Rule | Yêu cầu |
|------|---------|
| **Star point vật lý** | Tất cả GND vias từ analog & digital region hội tụ về 1 điểm trên L2 gần C1(-) |
| **Không split L2** | L2 là 1 plane liên tục, không cắt rãnh |
| **Analog region** | Đặt ở 1 góc PCB, xa DC/DC và relay |
| **Keep-out zone** | Không route high-speed trace (RGMII, SPI) qua analog region |
| **Via stitching** | Via GND stitching quanh RF-sensitive area (Ethernet, SPI) |
| **Khoảng cách** | Analog circuit cách digital circuit ≥ 5mm nếu có thể |
| **Relay GND** | Dedicated via từ ULN2003A GND xuống L2 (dòng coil ~320mA) |

---

## 6. QCVN 9:2012 Mapping

| Yêu cầu QCVN 9:2012 | Giải pháp Grounding | Mục tài liệu |
|---------------------|--------------------|:----------:|
| Chống điện giật (bảo vệ) | PE terminal + chassis GND | §3.4 |
| Giảm nhiễu common-mode | Y-cap 10nF/1kV power → chassis | §3.3 |
| Tham chiếu tín hiệu ổn định | L2 continuous GND plane | §3.2 |
| Chống ground loop analog/digital | Star ground topology | §3.1 |
| Cách ly RS-485 | ADUM1201 + isolated GND | §3.5 |
| An toàn cách ly (IEC 61010-1) | Creepage/clearance ≥ 3.2mm cho relay, isolation barrier | §5.2 |

---

## 7. Checklist Verification

- [ ] Star ground point: chỉ 1 điểm kết nối giữa analog, digital, power GND
- [ ] L2 GND plane: không cắt rãnh, không slot
- [ ] Y-cap 10nF/1kV: gắn đúng chiều (power → chassis)
- [ ] PE terminal: kết nối solid đến vỏ DIN-rail
- [ ] RS-485 isolated GND: không có đường DC kết nối với logic GND
- [ ] Analog circuit: cách xa DC/DC và relay (≥ 5mm)
- [ ] Via GND stitching: đầy đủ quanh RF-sensitive area
- [ ] Kiểm tra continuity: mọi GND node có đường dẫn đến star ground point

---

**Document ID:** CR-QCVN-D5-GROUNDING-SCHEME | Rev 1.0 | 2026-06-02  
**Previous document:** [D4 — EMI Filter Specs](cr-qcvn-D4-emi-filter.md)
