# B6 — Mechanical Drawing (Bản vẽ Cơ khí / Kích thước)

> **Document ID:** CR-QCVN-B6-v1 | Rev 1.0 | 2026-06-02  
> **Mục đích:** Phục vụ chứng nhận QCVN / CR Mark cho MK-DDC-24  
> **Input source:** CB_BLOCK_DIAGRAM §3 (PCB dimensions), DS §3.4 (weight, environment)  
> **Taxonomy:** B6-mech-v1

---

## 1. Tổng quan Sản phẩm

| Thông số | Giá trị | Ghi chú |
|----------|---------|---------|
| **Kiểu thiết bị** | Bộ điều khiển DDC 24 điểm — HVAC controller | DIN-rail mount |
| **Kích thước tổng thể (W × H × D)** | 150 × 90 × 55 mm | Vỏ nhựa DIN-rail |
| **Kích thước PCB (W × H)** | 148 × 88 mm | 4-layer FR4 |
| **Độ dày PCB** | 1.6 mm ±10% | Tiêu chuẩn IEC 60249 |
| **Trọng lượng tịnh** | ~300 g | Toàn bộ assembly (PCB + CM3 + linh kiện) |
| **Vật liệu vỏ** | ABS / PC (polycarbonate) | UL94 V-0 flame rating |
| **Vật liệu PCB** | FR4 (Glass Epoxy) | Tg 130–140°C, UL 94 V-0 |
| **Kiểu lắp** | DIN-rail 35 mm (EN 60715) / Mounting flange | |

---

## 2. Sơ đồ Kích thước PCB (Top View)

```
                       148 mm
  ◄──────────────────────────────►
  ┌────────────────────────────────┐  ▲
  │   ▲                             │  │
  │   │ 5mm                         │  │
  │   └──────┐  ┌──────────┐        │  │
  │          │  │  POWER   │        │  │
  │  ┌───────┘  │  SECTION │        │  │
  │  │   ┌──────┤  DC/DC   │        │  │
  │  │   │      │  CONV    │        │  │
  │  │   │      └──────────┘        │  │
  │  │   │                          │  │
  │  │   │     ┌────────────────┐   │  │
  │  │   │     │                │   │  │    88 mm
  │  │   │     │   Radxa CM3    │   │  │
  │  │   │     │   SOM MODULE   │   │  │
  │  │   │     │   60 × 45mm    │   │  │
  │  │   │     │   (clear-out)  │   │  │
  │  │   │     │                │   │  │
  │  │   │     └────────────────┘   │  │
  │  │   │                          │  │
  │  │   │  ┌─────────────────┐     │  │
  │  │   │  │  I/O TERMINALS  │     │  │
  │  │   │  │  UI + DI + AO   │     │  │
  │  │   │  └─────────────────┘     │  │
  │  │   │            ┌──────────┐  │  │
  │  │   │            │  RELAY   │  │  │
  │  │   │            │  ×4      │  │  │
  │  │   │            └──────────┘  │  │
  │  │   │            ┌──────────┐  │  │
  │  │   │            │  RS-485  │  │  │
  │  │   │            │  ETHERNET│  │  │
  │  │   │            │  USB     │  │  │
  │  │   │            └──────────┘  │  │
  │  │  ┌┴┐            ┌──────────┐ │  │
  │  │  │M│            │  DIP SW  │ │  │
  │  │  │3│            │  ×8      │ │  │
  │  │  └─┘            │  LED×4   │ │  │
  │  └──┘              └──────────┘ │  │
  │   ▲ 5mm                          │  │
  │   └───────────────────────────────┘  │
  └────────────────────────────────┘  ▼
     ▲                            ▲
     │ 5mm                        │ 5mm
     └────────────────────────────┘

  ◀─── Mounting hole M3 ×4 (corners, ≥5mm from edge)
  [M] — Vị trí mounting hole
```

---

## 3. Kích thước Vỏ và Lắp đặt

### 3.1 Enclosure Dimensions

```
                    150 mm
  ◄──────────────────────────────►
  ┌────────────────────────────────┐  ▲
  │                                │  │
  │       DIN-RAIL ENCLOSURE       │  │
  │       ABS / PC — UL94 V-0      │  │ 90 mm
  │                                │  │
  │    (PCB 148×88mm bên trong)    │  │
  │                                │  │
  │  ┌─ DIN-rail clip (EN 60715) ─┐│  │
  │  └────────────────────────────┘│  │
  └────────────────────────────────┘  ▼
       │                        │
       └─────── 55 mm ──────────┘
            (Độ sâu / Depth)
```

### 3.2 DIN-rail Clip

| Thông số | Giá trị |
|----------|---------|
| **Tiêu chuẩn** | EN 60715 (35 mm DIN-rail) |
| **Vị trí clip** | Mặt sau enclosure, trung tâm |
| **Vật liệu clip** | Thép lò xo, mạ kẽm (spring steel, zinc-plated) |

### 3.3 Mounting Flange Option

| Thông số | Giá trị |
|----------|---------|
| **Loại** | Flange 2× (trái và phải), tích hợp vỏ |
| **Khoan lỗ** | Ø4.5 mm cho vít M4 |
| **Vị trí** | Ngang với DIN-rail clip, đối xứng 2 bên |

---

## 4. Bố trí Mounting Hole (PCB)

| Tham số | Giá trị |
|---------|---------|
| **Số lượng** | 4 lỗ M3 |
| **Vị trí** | 4 góc PCB (top-left, top-right, bottom-left, bottom-right) |
| **Khoảng cách từ cạnh PCB** | ≥ 5 mm |
| **Đường kính lỗ** | Ø3.2 mm (cho vít M3) |
| **Pad xung quanh** | Ø6 mm annular ring, không nối GND (keep-out zone) |
| **Mục đích** | Gắn PCB vào vỏ; không dùng làm điểm nối đất |

---

## 5. Vùng Component Cao (Tall Component Map)

| Vùng | Component | Chiều cao max | Ghi chú |
|------|-----------|:-------------:|---------|
| **Top-left (power)** | Tụ hóa DC/DC, cuộn cảm SX1308 | 12 mm | Heatsink pad khuyến nghị |
| **Top-center (CM3)** | Radxa CM3 SOM (shield) | 6.5 mm | B2B connector + shield; clearance dưới CM3 không có component |
| **Bottom-right (relay)** | HF46F-005 relay ×4 | 15.5 mm | Cao nhất trên board |
| **Right (I/O)** | Terminal block 5.08mm pitch | 14 mm | UI/DI/AO terminals |
| **Right (RJ-45)** | HR911105A magjack | 13.5 mm | Có integrated magnetics |
| **Bottom (RS-485)** | MAX13487E + ADUM1201 | 5 mm | SOIC package |

> **Tổng chiều cao component lớn nhất:** 15.5 mm (relay)  
> **Khe hở vỏ — PCB:** ≥ 5 mm (trên và dưới)  

---

## 6. Trọng lượng Chi tiết

| Hạng mục | Trọng lượng (g) | Ghi chú |
|----------|:--------------:|---------|
| PCB (FR4 148×88mm, 1.6mm) | ~45 | 4-layer |
| Radxa CM3 (shield + B2B) | ~18 | SOM module |
| Relay HF46F-005 ×4 | ~28 | ~7 g/cái |
| Terminal block (tổng) | ~30 | UI/DI/AO/DO/RS-485 |
| Power supply components | ~20 | DC/DC, LDO, tụ, cuộn |
| Connectors (USB, RJ-45, DIP) | ~15 | |
| Passive + IC khác | ~20 | |
| Vỏ nhựa ABS/PC + clip DIN | ~80 | UL94 V-0 |
| Hardware (vít, đệm) | ~10 | |
| Packing (hộp + foam) | ~45 | |
| **Tổng (thiết bị)** | **~300 g** | |
| **Tổng (bao gồm packing)** | **~400 g** | |

---

## 7. Vật liệu Chính

| Bộ phận | Vật liệu | Tiêu chuẩn / Ghi chú |
|---------|----------|---------------------|
| **Vỏ (enclosure)** | ABS / Polycarbonate blend | UL94 V-0, RoHS, REACH |
| **PCB** | FR4 (Glass Epoxy) | Tg 130–140°C, UL 94 V-0 |
| **DIN-rail clip** | Thép mạ kẽm (SPCC + Zn) | EN 60715 |
| **SOM shield** | Nhôm / thép phủ | EMI shield, 0.3mm |
| **Terminal block** | PA66 (Nylon 66) + PBT | UL94 V-0, 5.08mm pitch |
| **Relay** | HF46F-005 (phenolic case) | UL / TUV recognized |
| **Dây kết nối nội bộ** | UL1007 AWG24 | 80°C, 300V |

---

## 8. Điều kiện Môi trường

Xem DS §3.4:

| Thông số | Giá trị |
|----------|---------|
| Nhiệt độ làm việc | 0°C đến +55°C (đã xác nhận) |
| Nhiệt độ bảo quản | -40°C đến +85°C |
| Độ ẩm | 10–90% RH, không ngưng tụ |
| Cấp bảo vệ | IP20 (indoor use) |
| Rung động | IEC 60068-2-6 (10–150 Hz, 2g) — cần xác nhận |

---

## 9. Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | DeveloperTeam | Phát hành đầu — dựa trên CB_BLOCK_DIAGRAM và DS §3.4 |

---

**Document ID:** CR-QCVN-B6-v1 | Rev 1.0 | 2026-06-02  
**Next action:** Xác nhận kích thước mounting hole và chiều cao component từ PCB layout (B4) sau khi có file Gerber / layout hoàn chỉnh.
