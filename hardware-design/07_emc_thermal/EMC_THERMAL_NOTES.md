# EMC & Thermal Design Notes — MK-DDC-24

> **Document:** HW-DES-07-EMC | Rev 1.0 | 2026-05-27  
> **Tiêu chuẩn:** IEC 61326-1 (EMC for measurement/control), IEC 61010-1 (Safety)

---

## 1. Tiêu chuẩn EMC Áp dụng

| Tiêu chuẩn | Phạm vi | Mức yêu cầu |
|-----------|---------|------------|
| **IEC 61326-1** | EMC cho thiết bị đo lường và điều khiển | Class A (công nghiệp) |
| **IEC 61000-4-2** | ESD immunity | Level 4: ±8kV contact, ±15kV air |
| **IEC 61000-4-3** | Radiated RF immunity | Level 3: 10 V/m |
| **IEC 61000-4-4** | EFT/Burst immunity | Level 3: 2kV |
| **IEC 61000-4-5** | Surge immunity | Level 3: 2kV (line-line), 4kV (line-earth) |
| **IEC 61000-4-6** | Conducted RF immunity | Level 3: 10 Vrms |
| **IEC 61000-4-8** | Power frequency magnetic field | Level 4: 30 A/m |
| **CISPR 11** | Radiated/Conducted emissions | Class A |
| **IEC 61010-1** | Electrical safety | Installation Category II, Pollution Degree 2 |

---

## 2. EMC Design Rules — PCB

### 2.1 Ground Plane

| Rule | Yêu cầu |
|------|---------|
| Ground plane | L2 liên tục (không cắt, không slot) |
| Star ground point | 1 điểm nối GND analog và GND digital (gần power supply input) |
| Chassis ground | Gắn vỏ DIN-rail → chassis GND qua capacitor 10nF/1kV (Y-cap) |
| RS-485 isolated GND | Cách ly qua ADUM1201, không trực tiếp với logic GND |

### 2.2 Signal Routing

| Rule | Yêu cầu |
|------|---------|
| Clock signals | Không route gần analog input (≥ 5mm) |
| Differential pairs | Kéo đồng đều, chiều dài match |
| High-speed traces | Không route bên dưới power inductor, relay |
| Return path | Mỗi signal trace có GND return path gần nhất (không lỗ hổng ở L2) |
| Via stitching | Via GND stitching xung quanh RF sensitive area (SPI, Ethernet) |

### 2.3 Decoupling Capacitor

| Loại | Giá trị | Vị trí |
|------|---------|-------|
| IC power pin bypass | 100nF X7R 0402 | Sát mỗi VCC pin IC (<2mm) |
| Bulk bypass | 10µF tantalum hoặc ceramic | Mỗi IC supply rail |
| Relay common mode | 100nF + ferrite bead | Tách +5V_RELAY từ +5V main |
| DC/DC output | 470µF low-ESR | Gần output DC/DC |

### 2.4 Common Mode Filters

| Vị trí | Giải pháp |
|-------|---------|
| Ethernet (RJ-45) | Common mode choke tích hợp trong RJ-45 magnetics |
| RS-485 | Ferrite bead 600Ω@100MHz trên A và B line |
| 24V power input | CM choke 3.5mH + Y-cap 10nF/1kV |
| UI input | Ferrite bead 600Ω + 100nF ceramic mỗi kênh |

---

## 3. ESD Protection Strategy

| Điểm | Linh kiện | Mức bảo vệ |
|------|---------|-----------|
| UI terminals (×8) | TVS SMAJ15A + BAT54 clamp | ±8kV (IEC 61000-4-2 L4) |
| DI terminals (×8) | TVS P6KE36A + opto isolation | ±8kV |
| RS-485 A/B | SMAJ6.5A per line | ±15kV (differential pair) |
| USB-C | PRTR5V0U2X (dual-line TVS) | ±8kV contact |
| USB-A | PRTR5V0U2X | ±8kV |
| Ethernet (RJ-45) | Tích hợp trong magnetics HR911105A | ±6kV |
| Power 24V input | P6KE33A + GBU4J | Surge 600W |

---

## 4. Surge Protection (IEC 61000-4-5)

| Port | Mức yêu cầu | Giải pháp |
|------|:-----------:|---------|
| 24VAC/VDC power input | 2kV (L-L) / 4kV (L-PE) | MOV 275V + P6KE33A TVS |
| RS-485 | 2kV (L-L) | GDT (Gas Discharge Tube) + TVS |
| I/O terminals | 1kV | TVS per channel |

**MOV:** SIOV-S14K275 (275V, 14mm, 175J) song song với input 24VAC — bảo vệ đầu tiên.  
**TVS:** Bảo vệ thứ hai sau MOV.

---

## 5. Enclosure & Shielding

| Yêu cầu | Giải pháp |
|---------|---------|
| Vỏ DIN-rail | Nhựa ABS V0 (flame retardant) hoặc nhôm |
| Vỏ nhôm | Tăng shielding 10–20dB radiated |
| PCB ke góc vỏ | Tất cả PCB mount point cần GND via stitching |
| Cable glands | Không yêu cầu (terminal block, kẹp cáp ngoài) |

---

## 6. Thermal Management — Radxa CM3

### 6.1 Thermal Model

| Thành phần | TDP (W) | Nhiệt độ nối tối đa |
|-----------|:-------:|:-----------------:|
| RK3566 (full load) | ~4W | 85°C (Tj max) |
| CM3 PMIC | ~0.5W | — |
| LM2596 DC/DC | ~2.5W @ 3A | Tcase max 125°C |
| ULN2003A | ~0.5W | — |
| **Tổng board** | **~8W** | — |

### 6.2 Heatsink CM3

**Giải pháp Ver 1:** Radxa Heatsink 5540B (55×40mm, nhôm anodized)
- Gắn trực tiếp lên CM3 qua thermal pad Fujipoly XR-m (1.5mm, 6 W/mK)
- Thermal resistance heatsink: Rth ≤ 8°C/W
- ΔT @ 4W TDP: 4 × 8 = 32°C
- Nếu môi trường 45°C → Tcase CM3 ≤ 45 + 32 = 77°C < 85°C ✅

**Lỗ thông gió:** Mở 4 lỗ φ5mm trên nắp vỏ DIN-rail ngay phía trên CM3 (convection tự nhiên).

### 6.3 Software Thermal Monitoring

| Ngưỡng | Hành động | Lệnh/Path |
|--------|---------|---------|
| T > 60°C | Log cảnh báo | `cat /sys/class/thermal/thermal_zone0/temp` |
| T > 70°C | cpufreq throttle → 1.2GHz | cpufreq governor: schedutil |
| T > 80°C | Alarm BACnet (event) | kinexus-agent → BACnet Notification |
| T > 85°C | Emergency shutdown Debian | `systemctl poweroff` |

**Script giám sát** (chạy mỗi 30s qua systemd timer):
```bash
#!/bin/bash
TEMP=$(cat /sys/class/thermal/thermal_zone0/temp)
TEMP_C=$((TEMP / 1000))
if [ $TEMP_C -gt 80 ]; then
    logger "MK-DDC-24 CRITICAL: CPU temp ${TEMP_C}C"
fi
```

### 6.4 LM2596 Thermal

- LM2596HVS SOT-223: thermal pad dưới tab
- PCB: 8× via φ0.5mm bên dưới tab → GND plane L2
- Copper pour 20×20mm quanh LM2596 trên L1 (heat spreader)
- Không cần heatsink ngoài nếu Tamb ≤ 50°C

---

## 7. EMC Test Pre-checklist (trước khi gửi lab)

### Emissons

- [ ] Kiểm tra xem có clock harmonics mạnh ở 8MHz, 64MHz, 100MHz, 4.096MHz không bằng oscilloscope + near-field probe
- [ ] Đảm bảo tất cả return paths đầy đủ (không khe hở GND plane)
- [ ] Ferrite bead đã gắn trên RS-485 A/B, power input
- [ ] Ethernet magnetics: dùng component có integral common-mode choke

### Immunity

- [ ] Tất cả TVS/MOV đã hàn và kiểm tra mức bảo vệ
- [ ] Opto-isolator DI và ADUM1201 RS-485 đảm bảo galvanic isolation
- [ ] Test ESD bằng súng ESD 4kV contact tại tất cả terminals (trước khi gửi lab)
- [ ] Bypass Y-cap 10nF trên power input đến chassis GND

---

## 8. Certification Roadmap

| Chứng nhận | Tổ chức test | Dự kiến |
|-----------|------------|-------|
| CE (EMC + LVD) | TUV / Intertek | Q2/Y8 |
| IEC 61326-1 | — | Q2/Y8 |
| IEC 61010-1 | — | Q2/Y8 |
| BACnet BTL | BACnet Intl | Q4/Y7 |
| UKCA | — | Q3/Y8 (if UK market) |

---

**Document ID:** HW-DES-07-EMC | Rev 1.0 | 2026-05-27
