# IO Subsystem — Digital Output Relay Circuit

> **Document:** HW-DES-03-DO | Rev 1.3 | 2026-06-30
> **Cập nhật:** Cấu trúc hệ thống từ "8 UI + 8 DI" → "16 UI toàn bộ" (xem REWORK_DI_TO_UI.md)

---

## 1. Tổng quan

4 kênh Digital Output (DO1–DO4):
- Relay SPDT (Single Pole Double Throw)
- Dòng contact: **5A @ 250VAC / 30VDC**
- Driver: **ULN2003A** (Darlington array, 7-channel, 500mA/channel)
- Chỉ thị LED đỏ mỗi kênh (relay ON)

---

## 2. Relay Spec (mỗi kênh)

| Thông số | Giá trị |
|----------|---------|
| **Model** | HF46F-5-HS1TGF (TE Connectivity) hoặc G5LE-14-5VDC (Omron) |
| **Coil voltage** | 5VDC ±10% |
| **Coil current** | 72–80mA |
| **Contact rating (relay datasheet)** | 10A @ 250VAC / 10A @ 30VDC (relay HF46F chịu được) |
| **Rating công bố sản phẩm** | **5A @ 250VAC / 5A @ 30VDC** (derate cho tuổi thọ + clearance) |
| **Min load** | 10mA @ 5VDC (tiếp điểm mạ vàng) |
| **Mechanical life** | ≥ 10 triệu lần |
| **Electrical life** | ≥ 100.000 lần @ rated load |
| **Contact arrangement** | SPDT: COM, NC, NO |
| **Operate time** | ≤ 10ms |
| **Release time** | ≤ 5ms |
| **Dimensions** | 27.3 × 14.5 × 19mm (PCB mount) |
| **Pitch terminal** | 5.08mm |

---

## 3. Sơ đồ Mạch mỗi kênh DO

```
STM32 GPIO PC0–PC3 (DO1–DO4 output, active HIGH)
       │
   [ULN2003A IN_x]  ── Darlington transistor (Vce_sat < 1.1V @ 500mA)
       │
   [ULN2003A OUT_x] ── [Relay coil K_x (80mA, 5V)]
                               │
                        [+5V_RELAY] ──── [100µF electrolytic/polymer bulk
                                          + 100nF X7R local decoupling]
                               │
                        [Freewheeling D (internal ULN2003A)]
                               │
                              GND

Relay contacts:
  COM ────────── Terminal DO_x_COM
  NO  ────────── Terminal DO_x_NO   (closed khi relay ON)
  NC  ────────── Terminal DO_x_NC   (closed khi relay OFF)
```

**LED chỉ thị:**
```
+5V ──[R 470Ω]──[LED đỏ]──[ULN2003A OUT_x]
```
LED sáng khi ULN2003A kéo xuống GND (relay ON).

---

## 4. ULN2003A Driver

| Thông số | Giá trị |
|----------|---------|
| **IC** | ULN2003A (DIP-16 hoặc SOP-16) |
| **Channels** | 7 (dùng 4 cho DO, 3 spare cho LED/buzzer) |
| **Input logic** | 3.3V / 5V compatible (V_in_thresh = 2.7V max → cần 3.3V logic OK) |
| **Output (sink)** | 500mA per channel, 50V max |
| **V_ce(sat)** | ≤ 1.1V @ 350mA |
| **Flyback diode** | **Tích hợp sẵn** (không cần thêm diode ngoài) |

> **Lưu ý:** ULN2003A input threshold ~2.7V — cần đảm bảo STM32 GPIO HIGH ≥ 2.8V. Với VDD = 3.3V, GPIO HIGH ≥ 2.4V typical → cần kiểm tra datasheet STM32G0B1 VOH @ IOH.
> Giải pháp: Dùng pull-up 10kΩ lên 3.3V tại input ULN2003A để đảm bảo mức HIGH đủ.

---

## 5. Thông số Output DO

| Thông số | Giá trị |
|----------|---------|
| Contact type | SPDT (COM + NC + NO) |
| Max AC load | 5A @ 250VAC |
| Max DC load | 5A @ 30VDC |
| Voltage max contact | 250VAC / 30VDC |
| Min load | 10mA @ 5VDC (gold plating) |
| Isolation coil–contact | 4000V RMS (1 phút) |
| Operate/Release time | ≤ 10ms / ≤ 5ms |

---

## 6. Terminal Labeling

| Terminal | Ký hiệu | Mô tả |
|----------|---------|-------|
| DO1_COM | COM1 | Common relay 1 |
| DO1_NO | NO1 | Normally Open relay 1 |
| DO1_NC | NC1 | Normally Closed relay 1 |
| ... | ... | |
| DO4_COM | COM4 | |
| DO4_NO | NO4 | |
| DO4_NC | NC4 | |

**Ghi chú wiring label trên vỏ máy:**
- "NC" = Normally Closed (tiếp điểm đóng khi relay nghỉ)
- "NO" = Normally Open (tiếp điểm mở khi relay nghỉ)
- "COM" = Common

---

## 7. Clearance & Creepage (IEC 61010-1)

| Tham số | Giá trị yêu cầu | Thực tế PCB |
|---------|:---------------:|:-----------:|
| Clearance (250VAC, Cat II, Poll 2) | ≥ 3.2mm | 4mm |
| Creepage | ≥ 4.0mm | 5mm |
| Relay to relay | — | ≥ 5mm |
| Via trong vùng HV | Không | Không dùng via trong HV trace |

> **Thiết kế PCB:** Routing trace HV relay contact qua L4 (bottom layer), không cross sang L1 (top). Copper pour clearance từ relay contact ≥ 4mm.

---

## 8. Bảo vệ DO

The relay contacts are dry contacts and can switch different AC/DC systems. A single fixed TVS value cannot safely protect every allowed field voltage. Protection must therefore be defined per product/SKU and wiring class rather than implied by the coil flyback diode.

| Event/load | Rev A requirement |
|------|---------|
| Relay coil flyback | ULN2003A internal clamp, COM pin connected to +5V_RELAY, with short return path. |
| DC inductive load | Installation-preferred flyback diode at the load. Provide optional per-channel TVS footprint only after its standoff/clamp/energy rating is selected for the declared DC load. |
| AC inductive load | Provide optional RC-snubber footprint across COM-NO/COM-NC as selected. Capacitor must be safety-rated for across-line use and resistor pulse/flameproof rating must be checked; `100R + 100nF` is a starting value, not an unconditional released value. |
| Mains surge/ESD at contact terminals | Preserve reinforced separation from SELV logic. Select MOV/TVS/snubber only against the declared installation category and IEC test level; do not place a low-voltage TVS on a 250VAC contact. |
| Overcurrent contact | External branch fuse/breaker sized for wire, load, relay utilization category, and published 5A product limit. |

### 8.1 Release evidence

- [ ] Schematic shows optional suppression footprints or explicitly assigns suppression to field wiring for each declared load class.
- [ ] BOM identifies populated/DNI protection by SKU and prevents an AC part from being fitted on a DC-only option or vice versa.
- [ ] Relay terminal ESD/EFT/surge and inductive switching tests are recorded with load, voltage, current, switching count, contact temperature, and observed arcing.
- [ ] AO/UI low-voltage nodes remain within their transient limits while all four relays switch the worst declared loads.

---

**Document ID:** HW-DES-03-DO | Rev 1.3 | 2026-06-30

## Revision History

| Rev | Ngày | Thay đổi |
|-----|------|----------|
| 1.0 | 2026-05-27 | Initial release — 4 kênh DO với ULN2003A, HF46F relay, 5A@250VAC output |
| 1.1 | 2026-06-23 | Update consistency — Cấu trúc hệ thống từ "8 UI + 8 DI" → "16 UI toàn bộ" (xem REWORK_DI_TO_UI.md) |
| 1.2 | 2026-06-23 | Final rev bump Phase 1 — I/O count update verified (16 UI only, no DI) |
| 1.3 | 2026-06-30 | Corrected relay-rail decoupling and defined load-specific contact suppression/evidence requirements |
