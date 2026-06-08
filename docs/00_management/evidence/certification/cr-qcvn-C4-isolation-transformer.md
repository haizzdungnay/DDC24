# C4 — Isolation Transformer (External 24VAC)

> **Document ID:** CR-QCVN-C4 | Rev 1.0 | 2026-06-02
> **Tiêu chuẩn áp dụng:** IEC 61558-1 (Safety of transformers, reactors), IEC 61558-2-4 (Isolation transformers), QCVN 4:2009/BCT
> **Sản phẩm:** MK-DDC-24 — Carrier Board v1.x
> **Mục đích:** Đặc tả kỹ thuật máy biến áp cách ly ngoài (24VAC) cấp nguồn cho bộ điều khiển MK-DDC-24, phục vụ chứng nhận QCVN 4:2009/BCT

---

## 1. Tổng quan

MK-DDC-24 sử dụng nguồn 24VAC bên ngoài làm nguồn năng lượng duy nhất. Máy biến áp cách ly (isolation transformer) không nằm trên PCB — là thiết bị ngoại vi do khách hàng/kỹ thuật viên lắp đặt. Tài liệu này quy định các yêu cầu kỹ thuật tối thiểu cho transformer này.

**Vị trí sơ đồ khối:**

```
L ──┬──
N ──┘
  [Isolation Transformer 220VAC / 24VAC >30VA]
       │
    [F1 MF-R200]──[Bridge GBU4J]──[...]── MK-DDC-24 load
```

---

## 2. Yêu cầu kỹ thuật — Isolation Transformer

### 2.1 Thông số đầu vào (Primary)

| Tham số | Giá trị | Ghi chú |
|---------|---------|---------|
| **Điện áp danh định** | 220 VAC (±10%) | Lưới điện Việt Nam |
| **Tần số** | 50 / 60 Hz | Tương thích cả hai |
| **Pha** | Single-phase | Pha dân dụng / công nghiệp nhẹ |

### 2.2 Thông số đầu ra (Secondary)

| Tham số | Giá trị | Ghi chú |
|---------|---------|---------|
| **Điện áp danh định** | **24 VAC** | ±10% (21.6V – 26.4V không tải) |
| **Công suất tối thiểu** | **≥ 30 VA** | Theo power budget MK-DDC-24 (~4.5W / 80% eff ≈ 6W; dư 5×) |
| **Dòng định mức** | ≥ 1.25 A | 30 VA / 24 VAC |
| **Dạng sóng** | Sine wave | Tiêu chuẩn AC |

### 2.3 Cách ly (Isolation)

| Tham số | Yêu cầu | Căn cứ |
|---------|---------|--------|
| **Isolation Voltage (Primary–Secondary)** | **≥ 3750 V RMS** (1 phút) | IEC 61558-1 §18, reinforced isolation |
| **Isolation Voltage (Primary–Core)** | ≥ 3750 V RMS | IEC 61558-1 |
| **Isolation Voltage (Secondary–Core)** | ≥ 1500 V RMS | IEC 61558-1 |
| **Clearance Primary–Secondary** | ≥ 6.4 mm (reinforced) | IEC 61558-1 §20 |
| **Creepage Primary–Secondary** | ≥ 8.0 mm | IEC 61558-1 §20, Material Group IIIa, PD2 |
| **Dielectric Strength** | Không đánh thủng | Hi-pot test 3750V RMS / 1 phút, ≤ 5mA leakage |
| **Loại cách ly** | **Reinforced / Double insulation** | Giữa primary (HV) và secondary (SELV) |

### 2.4 Bảo vệ tích hợp (trong transformer)

| Bảo vệ | Yêu cầu | Ghi chú |
|--------|---------|---------|
| **Thermal fuse (primary)** | Tự động ngắt ở 130°C ±5°C | Bảo vệ quá nhiệt, self-reset không yêu cầu |
| **Overcurrent protection** | Fuse hoặc breaker primary side | Phù hợp IEC 61558-1 §7 |
| **Short-circuit protection** | Có | Ngắt đầu ra khi ngắn mạch secondary |

### 2.5 Tiêu chuẩn áp dụng

| Tiêu chuẩn | Mô tả | Mức yêu cầu |
|-----------|-------|:----------:|
| **IEC 61558-1** | Safety of transformers — General requirements | **Bắt buộc** |
| **IEC 61558-2-4** | Particular requirements for isolation transformers | **Bắt buộc** |
| **EN 61558-2-4** | European harmonized version | Tương đương |
| **IEC 61010-1** | Safety for electrical equipment (tham chiếu) | Tham khảo |
| **QCVN 4:2009/BCT** | Quy chuẩn kỹ thuật quốc gia về an toàn điện | **Bắt buộc** |

---

## 3. Hướng dẫn lựa chọn transformer

| Tham số lựa chọn | Khuyến nghị |
|-----------------|-------------|
| **Công suất** | **50 VA** (khuyến nghị) — đủ cho MK-DDC-24 + dư cho thiết bị trường (sensor 24VAC) |
| **Tối thiểu** | 30 VA — chỉ đủ cho một MK-DDC-24 đơn lẻ |
| **Điện áp đầu ra** | 24 VAC không tải, điều chỉnh ≤ 10% |
| **Loại** | Isolation transformer (cách ly reinforced, không phải autotransformer) |
| **Chứng nhận** | CE / UL / EAC — có chứng nhận IEC 61558-2-4 |

### 3.1 Cấu hình đấu nối

```
Primary:  L ──[Fuse]──[Primary coil]── N
              [Thermal fuse 130°C]

Secondary: 24VAC──┬── F1 MK-DDC-24
             24VAC ──┴── COM / GND
```

> **Cảnh báo:** Không sử dụng autotransformer (biến áp tự ngẫu) vì không có cách ly điện. Bắt buộc dùng isolation transformer đúng tiêu chuẩn IEC 61558-2-4.

---

## 4. Yêu cầu lắp đặt

| Yêu cầu | Mô tả |
|---------|-------|
| **Vị trí** | Trong tủ điện, gần MK-DDC-24, cố định trên DIN-rail hoặc đế |
| **Khoảng cách** | ≤ 10 mét từ transformer đến MK-DDC-24 |
| **Tiết diện dây** | ≥ 1.5 mm² (cho 24VAC) |
| **Bảo vệ primary** | MCB 2A — 6A, đặc tính C (theo IEC 60898) |
| **Nối đất** | Vỏ transformer nối đất bảo vệ (PE) |
| **Môi trường** | Pollution Degree 2, −10°C → +50°C |

---

## 5. Kiểm định (Verification)

| Hạng mục | Phương pháp | Tiêu chí |
|---------|------------|---------|
| **Dielectric test** | Hi-pot 3750V RMS / 1 phút primary–secondary | < 5 mA leakage current |
| **Insulation resistance** | Megger 500V DC | ≥ 100 MΩ |
| **Load regulation** | Đo V~out~ từ no-load đến full-load | Biến thiên ≤ 10% |
| **Temperature rise** | Full-load 8 giờ | ∆T ≤ 60°C (Class B insulation) |
| **Protection** | Short-circuit secondary | Transformer tự ngắt hoặc fuse primary ngắt |

---

## 6. Tài liệu tham khảo

| Tài liệu | ID |
|---------|-----|
| Power Supply Design — MK-DDC-24 | HW-DES-04-PWR (§1, §10) |
| Bill of Materials — MK-DDC-24 v1.0 | HW-DES-06-BOM (§2.8) |
| IEC 61558-1 — Safety of transformers | — |
| IEC 61558-2-4 — Isolation transformers | — |
| QCVN 4:2009/BCT | — |

---

**Document ID:** CR-QCVN-C4 | Rev 1.0 | 2026-06-02
**Taxonomy:** C4-xformer-v1
