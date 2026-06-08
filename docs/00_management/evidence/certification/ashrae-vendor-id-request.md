# ASHRAE BACnet Vendor Identifier Request — KINEXUS Technologies JSC

> **Issue:** IOT-5622 — [BTL-PREP] Register ASHRAE BACnet Vendor Identifier
> **Prepared:** 2026-06-02 by PMO
> **Status:** Ready to send — chờ CEO điền chữ ký + gửi trên company letterhead
> **Ref:** GAP-BIBB-08 | PICS §7 line 102 | BACnet PICS TBD-01
> **ASHRAE Procedure:** [Procedures-Vendor-ID-rev3-15-2012.pdf](https://bacnet.org/wp-content/uploads/sites/4/2022/08/Procedures-Vendor-ID-rev3-15-2012.pdf)

---

## 1. Quy trình đăng ký (theo ASHRAE SSPC 135)

| Bước | Mô tả | Timeline |
|------|-------|:--------:|
| 1 | Gửi văn bản yêu cầu trên **company letterhead** đến BACnetVendorID@ashrae.org | Ngày gửi |
| 2 | ASHRAE Manager of Standards xác nhận receipt | ~1 tuần |
| 3 | ASHRAE SSPC 135 committee review & assign Vendor ID | 2–4 tuần |
| 4 | Nhận Vendor ID qua email chính thức | — |
| 5 | Cập nhật Vendor ID vào PICS §7 + firmware + BTL docs | Sprint hiện tại |

**Yêu cầu bắt buộc:**
- Văn bản trên **company letterhead** (có logo, địa chỉ công ty)
- Có **chữ ký** của authorized agent của công ty
- Ghi rõ **chức danh, địa chỉ, phone, fax, email** của người ký
- Mỗi công ty chỉ được cấp **một Vendor ID** duy nhất
- ASHRAE cấp **số liên tiếp theo thứ tự nhận được** — không chọn số
- **Không mất phí** đăng ký (khác với BACnet International membership)

**Địa chỉ gửi:**
- **Email:** BACnetVendorID@ashrae.org
- **Post:** ASHRAE Manager of Standards, 1791 Tullie Circle NE, Atlanta, GA 30329-2305, USA
- **Phone:** +1 404-636-8400
- **Fax:** +1 678-500-3939

---

## 2. Thư đăng ký (DRAFT — gửi sau khi CEO ký trên letterhead)

**To:** BACnetVendorID@ashrae.org
**Subject:** Request for BACnet Vendor Identifier Assignment — KINEXUS Technologies JSC

```
[KINEXUS Technologies JSC — Company Letterhead]
[Địa chỉ công ty]
[Phone / Fax / Email công ty]

Date: [Ngày gửi]

To: ASHRAE Manager of Standards
    ASHRAE Headquarters
    1791 Tullie Circle, NE
    Atlanta, GA 30329-2305
    United States of America

Subject: Request for BACnet Vendor Identifier Assignment

Dear ASHRAE Manager of Standards,

KINEXUS Technologies JSC ("KINEXUS") respectfully requests assignment of a
BACnet Vendor Identifier in accordance with the BACnet Vendor ID Assignment
Procedures (rev. March 15, 2012).

Company Information:
  - Legal Name: KINEXUS Technologies Joint Stock Company
  - Trading Name: KINEXUS Technologies JSC
  - Business: Industrial IoT / Building Automation — DDC controller development
  - Country: Vietnam

Product Information:
  - Product: MK-DDC-24 — 24-point DDC Controller for HVAC
  - BACnet Profile: B-ASC (BACnet Application Specific Controller)
  - BACnet Standard: ASHRAE 135-2020
  - Protocol: BACnet/IP (Annex J)
  - BACnet Stack: bacnet-stack 1.3.x (open-source)
  - Target Markets: Vietnam and Southeast Asia (Thailand, Indonesia, Malaysia)

KINEXUS is developing DDC controllers for the commercial HVAC/BMS market
in Southeast Asia. Our MK-DDC-24 product implements BACnet/IP as its
primary building automation protocol and we are preparing for BTL
(BACnet Testing Laboratories) certification.

We understand that:
  - Only one Vendor ID is assigned per company.
  - Vendor IDs are assigned consecutively in the order requests are received.
  - No special number requests are honored.

We kindly request ASHRAE to assign a Vendor Identifier at the earliest
convenience. A signed copy of this request on company letterhead is
attached to this email.

Please contact the undersigned for any additional information required.

Sincerely,

_________________________________
[CEO Name]
[CEO Title — e.g., Chief Executive Officer]
KINEXUS Technologies JSC
[Company Address]
Phone: [CEO Phone Number]
Fax: [Company Fax, if applicable]
Email: [CEO Corporate Email]
```

---

## 3. Hướng dẫn cho người gửi (CEO/Board)

1. **Chuẩn bị company letterhead** — file Word/PDF có logo KINEXUS, địa chỉ, thông tin liên hệ
2. **Điền thông tin CEO** vào vị trí `[CEO ...]`:
   - Họ tên đầy đủ
   - Chức danh (CEO / Director)
   - Số điện thoại liên hệ
   - Email corporate (@kinexus.vn hoặc domain chính thức)
3. **Ký tên** vào bản in trên letterhead
4. **Scan** thành PDF
5. **Gửi email** đến `BACnetVendorID@ashrae.org` với subject như trên, đính kèm PDF
6. **CC PMO** hoặc forward email đã gửi làm bằng chứng
7. **Cập nhật evidence** vào issue IOT-5622

---

## 4. Tracking

| Item | Status | Date |
|------|--------|------|
| Draft letter prepared | ✅ 2026-06-02 | PMO |
| CEO review & sign | ❌ Pending | CEO |
| Send to BACnetVendorID@ashrae.org | ❌ Pending | CEO |
| ASHRAE acknowledgment | ⏳ Waiting | — |
| Vendor ID assigned | ⏳ Waiting | ASHRAE |
| PICS §7 updated with Vendor ID | ⏳ Waiting | IOT-5624 (child) |
| Firmware device.c updated | ⏳ Waiting | IOT-5625 (child) |
| QA verification | ⏳ Waiting | IOT-5626 (child) |

---

## 5. Child Issues (follow-up sau khi nhận Vendor ID)

| Child Issue | Mô tả | Assignee | Dependency |
|-------------|-------|----------|------------|
| IOT-5657 | [BTL-PREP] Cập nhật PICS §7 với Vendor_Identifier | TechLead | IOT-5622 done |
| IOT-5658 | [BTL-PREP] Định nghĩa Vendor_ID trong firmware device.c | DeveloperTeam | IOT-5622 done |
| IOT-5659 | [BTL-PREP] QA verify Vendor_Identifier trong PICS + firmware build | QAReviewer | IOT-5657, IOT-5658 done |

---

**Rev** 1.0 | 2026-06-02 · PMO
