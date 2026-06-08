# B9 — Product Label (Nhãn Sản phẩm)

> **Document ID:** CR-QCVN-B9-v1 | Rev 1.0 | 2026-06-02  
> **Mục đích:** Phục vụ chứng nhận QCVN / CR Mark cho MK-DDC-24  
> **Input source:** DS_MK-DDC-24_VI §3.4 (ratings), §3.5 (certification), §9 (ordering info)  
> **Taxonomy:** B9-label-v1

---

## 1. Kích thước Nhãn

| Thông số | Giá trị |
|----------|---------|
| **Kích thước nhãn** | 60 × 30 mm |
| **Vị trí dán** | Mặt bên phải vỏ DIN-rail (side panel) |
| **Chất liệu** | Polyester (PET) trắng, mờ |
| **Độ bám dính** | Vĩnh viễn (permanent acrylic adhesive) |
| **Khả năng chịu nhiệt** | -40°C đến +85°C |
| **Tiêu chuẩn** | UL 969 / CSA C22.2 No. 0.15 |
| **Màu sắc** | Nền trắng, chữ đen, logo CR Mark trắng trên nền xanh (hoặc theo yêu cầu lab) |
| **Phương pháp in** | Thermal transfer (TT) / In flexo |

---

## 2. Layout Nhãn

```
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │    ┌───┐                                                 │
  │    │ C │  MODEL:  MK-DDC-24                              │
  │    │ R │  P/N:    MK-DDC-24-001                          │
  │    │ M │  S/N:    KX2425XXXX                            │
  │    │ A │                                                  │
  │    │ R │  POWER:  24 VAC/VDC ±20% 50/60Hz               │
  │    │ K │  POWER:  <8W max · 300mA @ 24VAC              │
  │    └───┘                                                  │
  │         IP20 · Ta: 0…+55°C                               │
  │                                                          │
  │    ┌──────┐ ┌──────┐ ┌────────────┐                     │
  │    │  CE  │ │RoHS  │ │  REACH     │                     │
  │    │      │ │      │ │  Compliant │                     │
  │    └──────┘ └──────┘ └────────────┘                     │
  │                                                          │
  │    KINEXUS Technologies JSC                              │
  │    Lot I-3, Saigon Hi-Tech Park,                         │
  │    District 9, Ho Chi Minh City, VIETNAM                 │
  │                                                          │
  │    Made in Vietnam  │  www.KINEXUS-tech.vn               │
  │                                                          │
  └──────────────────────────────────────────────────────────┘
```

> ⚠ **CR Mark:** Hình chữ nhật bo góc, nền xanh (hoặc đen), chữ "CR" trắng (hoặc vàng), kích thước tối thiểu 5 × 5 mm — theo quy định của BKHCN. Cần xác nhận format cụ thể từ lab chứng nhận.

---

## 3. Chi tiết Các Trường Thông tin

### 3.1 Trường Bắt buộc (Mandatory)

| Trường | Nội dung | Căn cứ pháp lý |
|--------|----------|----------------|
| **CR Mark** | Hình chữ nhật với logo CR | Quy chuẩn kỹ thuật QCVN |
| **Model** | MK-DDC-24 | Tên sản phẩm thương mại |
| **P/N** | MK-DDC-24-001 | Part number nội bộ (hàng sản xuất) |
| **S/N** | KX2425XXXX → giải mã bên dưới §3.2 | Serial number truy xuất |
| **Power rating** | 24 VAC/VDC ±20% 50/60Hz, <8W, 300mA @ 24VAC | An toàn điện |
| **IP rating** | IP20 | Bảo vệ xâm nhập |
| **Ta** | 0…+55°C | Nhiệt độ làm việc |
| **Manufacturer** | KINEXUS Technologies JSC + địa chỉ | CR Mark / QCVN yêu cầu |
| **Country of Origin** | Made in Vietnam | QCVN / CR Mark |
| **Website** | www.KINEXUS-tech.vn | Thông tin liên hệ |

### 3.2 Serial Number Format

| Vị trí | Ý nghĩa | Ví dụ |
|:------:|----------|-------|
| **KX** | Company prefix | KX |
| **24** | Năm sản xuất (2024–2034) | 25 = 2025 |
| **25** | Tuần sản xuất (01–52) | 25 = tuần 25 |
| **XXXX** | Số thứ tự (0001–9999) | 0001 |

Ví dụ: **KX25250001** = Sản xuất tuần 25 năm 2025, số thứ tự 0001.

### 3.3 Trường Tùy chọn (Optional / Recommended)

| Trường | Nội dung | Ghi chú |
|--------|----------|---------|
| **CE** | CE marking | Tương lai Q3/Y7 |
| **BACnet** | BACnet logo | BTL certified (Q4/Y7) — thêm sau khi đạt chứng nhận |
| **WEEE** | WEEE symbol (wheelie bin) | Tái chế WEEE Directive |
| **QR Code** | Link đến product page / datasheet | Tiện cho commissioning |
| **Firmware ver.** | FW: vX.Y.Z | Nếu label hỗ trợ thay đổi |

---

## 4. Yêu cầu Kỹ thuật Nhãn

### 4.1 Độ bền Nhãn

| Yêu cầu | Tiêu chuẩn / Mức |
|----------|-----------------|
| Chịu nhiệt độ | -40°C đến +85°C (storage + operation) |
| Chịu ẩm | 10–90% RH, không ngưng tụ |
| Chịu dầu, hóa chất | MIL-STD-810 (nhiên liệu, dầu nhẹ) |
| Độ bám dính | ≥ 24 N/25mm (ASTM D3330) |
| Khả năng đọc | Mắt thường, không mờ sau thời gian |
| Độ phân giải in | ≥ 300 dpi (thermal transfer) |

### 4.2 Kích thước Tối thiểu CR Mark

| Yêu cầu | Giá trị |
|----------|---------|
| Chiều rộng tối thiểu | 5 mm |
| Chiều cao tối thiểu | 5 mm |
| Tỉ lệ chiều rộng/cao | 1:1 |
| Khoảng cách tối thiểu đến các phần tử khác | 2 mm |
| Màu sắc | Nền xanh (hoặc đen) / chữ CR trắng (hoặc vàng) |

> **Xác nhận:** Kích thước và màu sắc CR Mark sẽ được điều chỉnh theo hướng dẫn cụ thể của lab chứng nhận khi nộp hồ sơ.

---

## 5. Các Variant Label

### 5.1 Label In trên Vỏ (Permanently affixed)

- Kích thước: 60 × 30 mm
- Gắn trên bề mặt vỏ DIN-rail (side panel)
- Không thể tháo gỡ mà không bị phá hủy

### 5.2 Label Bao bì (Shipping Box)

- Kích thước: 100 × 75 mm
- Gắn ngoài hộp carton
- Bổ sung: trọng lượng cả bao bì (~400g), kích thước hộp, QR tracking

---

## 6. Mã QR / Data Matrix (Khuyến nghị)

Nên bổ sung mã QR hoặc Data Matrix trên nhãn bên cạnh S/N để hỗ trợ traceability:

| Trường | Link đến |
|--------|----------|
| **Product page** | www.KINEXUS-tech.vn/products/MK-DDC-24 |
| **Datasheet** | www.KINEXUS-tech.vn/ds/MK-DDC-24 |
| **Warranty registration** | www.KINEXUS-tech.vn/warranty |

---

## 7. Tài liệu tham khảo

| Tài liệu | Link |
|----------|------|
| Data Sheet MK-DDC-24 | DS_MK-DDC-24_VI.md |
| Document Checklist (CR Mark) | cr-qcvn-document-checklist.md |
| B2 — System Block Diagram | cr-qcvn-B2-system-block-diagram.md |
| B6 — Mechanical Drawing | cr-qcvn-B6-mechanical-drawing.md |

---

## 8. Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | DeveloperTeam | Phát hành đầu — layout nhãn với CR Mark placeholder |

---

**Document ID:** CR-QCVN-B9-v1 | Rev 1.0 | 2026-06-02  
**Next action:** 
1. Xác nhận format CR Mark cụ thể từ lab chứng nhận (màu sắc, kích thước, font).
2. Sản xuất label mẫu (prototype) để chụp ảnh đính kèm hồ sơ.
3. Cập nhật CE và BACnet logo sau khi đạt chứng nhận tương ứng.
