# C3 — Fuse / Overcurrent Protection (Polyfuse F1 MF-R200)

> **Document ID:** CR-QCVN-C3 | Rev 1.1 | 2026-06-04
> **Tiêu chuẩn áp dụng:** IEC 61010-1 §9.5 (Overcurrent protection), QCVN 4:2009/BCT
> **Sản phẩm:** MK-DDC-24 — Carrier Board v1.x
> **Mục đích:** Đặc tả kỹ thuật thiết bị bảo vệ quá dòng đầu vào (F1 polyfuse) phục vụ chứng nhận QCVN 4:2009/BCT

---

## 1. Tổng quan

F1 là polymeric PTC resettable fuse (polyfuse) đặt tại ngõ vào nguồn 24VAC/VDC, trước cầu diode và bộ DC/DC converter. Thiết bị tự động reset khi sự cố ngắn mạch được loại bỏ, không cần thay thế linh kiện.

**Vị trí sơ đồ khối:**

```
24VAC/VDC ──[F1 MF-R200]──[Bridge GBU4J]──[TVS P6KE33A]──┬── DC_RAW
                                                            │
                                                        [C1 2200µF]
```

---

## 2. Thông số kỹ thuật — F1 (Polyfuse MF-R200)

### 2.1 Thông số điện

| Tham số | Giá trị | Ghi chú |
|---------|---------|---------|
| **Model** | MF-R200 | Bourns® Multifuse® PPTC |
| **Kiểu** | Polymeric PTC resettable fuse, radial lead | Through-hole |
| **Hold Current (I~hold~)** @ 23°C | **2.0 A** | Dòng định mức — không trip ở điều kiện bình thường |
| **Trip Current (I~trip~)** @ 23°C | **4.0 A** | Dòng trip tối thiểu (gấp 2× I~hold~) |
| **Max Voltage (V~max~)** | **60 VDC** | Phù hợp với 24VAC/VDC ±20% (max 33V peak) |
| **Max Interrupt Current (I~max~)** | **40 A** | Dòng ngắn mạch tối đa có thể ngắt an toàn |
| **Power Dissipation (P~d~)** | 1.5 W typical | Ở trạng thái tripped (sau 1 giờ) |
| **Initial Resistance (R~i~min~)** | 0.040 Ω | Điện trở ban đầu ở 23°C |
| **Post-Trip Resistance (R~1~max~)** | 0.100 Ω | 1 giờ sau khi trip và hồi phục |

### 2.2 Đặc tính trip time (Trip Curve)

| Dòng trip (A) | Bội số I~hold~ | Thời gian trip (max) | Điều kiện |
|:-------------:|:--------------:|:-------------------:|:---------:|
| 5.0 | 250% | < 5.0 s | 23°C |
| 8.0 | 400% | < 1.5 s | 23°C |
| 20.0 | 1000% | < 0.5 s | 23°C |

> **Ghi chú:** Thời gian trip giảm khi nhiệt độ môi trường tăng. Ở 60°C, I~hold~ derate ~70% (≈ 1.4A).

### 2.3 Đặc tính nhiệt

| Tham số | Giá trị |
|---------|---------|
| **Operating Temperature** | −40°C → +85°C |
| **Derating I~hold~ @ 60°C** | ≈ 70% (≈ 1.4 A) |
| **Derating I~hold~ @ 85°C** | ≈ 50% (≈ 1.0 A) |

---

## 3. Ứng dụng trong mạch

| Tham số ứng dụng | Giá trị | Căn cứ |
|-----------------|---------|--------|
| **Điện áp làm việc max** | 33 VDC (peak từ 24VAC) | 24VAC ±20% |
| **Dòng tải max (steady-state)** | ≈187 mA @ 24V (≈ 4.5W) | Power Budget (PWR_DESIGN §10) — 4.5W hệ thống |
| **Biên an toàn (I~hold~ / I~load~)** | 2.0A / 0.187A ≈ **10.7×** | Không trip do overload nhẹ |
| **Bảo vệ** | Ngắn mạch downstream | Short ở DC/DC, LDO, boost, relay |
| **Trip event** | Self-reset | Không cần bảo trì |

---

## 4. Chứng nhận (Agency Approvals)

| Tổ chức | Tiêu chuẩn | Số hiệu (typical) |
|---------|-----------|:-----------------:|
| **UL** | UL 1434 (Polymeric PTC) | E174432 |
| **cUL** | CSA 22.2 No. 0.4 | — |
| **TÜV** | EN 60730-1 | R50114815 |
| **RoHS** | 2011/65/EU | Compliant |
| **REACH** | EC 1907/2006 | Compliant |

> Các chứng nhận trên áp dụng cho dòng Bourns® Multifuse® MF-R series. Kiểm tra lot-specific certification trên nhãn linh kiện khi mua hàng.

---

## 5. Tài liệu tham khảo

| Tài liệu | ID |
|---------|-----|
| Power Supply Design — MK-DDC-24 | HW-DES-04-PWR (§3.1) |
| Bill of Materials — MK-DDC-24 v1.0 | HW-DES-06-BOM (§2.8) |
| Bourns MF-R200 Datasheet | Bourns® P/N MF-R200 |
| IEC 61010-1 §9.5 — Overcurrent protection | — |
| QCVN 4:2009/BCT | — |

---

**Document ID:** CR-QCVN-C3 | Rev 1.1 | 2026-06-04
**Taxonomy:** C3-fuse-v1
