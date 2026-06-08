# Hồ sơ Pháp lý Doanh nghiệp — CR Mark / QCVN

> **Issue:** IOT-5556
> **Sản phẩm:** MK-DDC-24
> **Created:** 2026-06-02 · **Owner:** PMO
> **Status:** Đang tập hợp — 0/5 documents ready

## Mục đích

Tập hợp các tài liệu pháp lý doanh nghiệp (mục A1-A5 trong `cr-qcvn-document-checklist.md`) cần thiết cho hồ sơ đăng ký CR Mark theo QCVN 4:2009/BKHCN (an toàn) và QCVN 9:2012/BKHCN (EMC).

## Phương thức chứng nhận dự kiến

**Method 1** (có ISO 9001) — yêu cầu chứng nhận ISO 9001 còn hiệu lực của nhà sản xuất.

---

## Trạng thái từng mục

| # | Tài liệu | Trạng thái | Owner chính | Blocker | Target |
|---|----------|:----------:|-------------|---------|--------|
| A1 | Giấy đăng ký kinh doanh (bản sao công chứng) | 🔴 Chưa có | KINEXUS Admin | Cần bản gốc để công chứng | 2026-06-13 |
| A2 | Mã số thuế | 🔴 Chưa có | KINEXUS Admin | — | 2026-06-13 |
| A3 | Giấy chứng nhận ISO 9001 | 🔴 Chưa xác định | KINEXUS QA | Chưa rõ KINEXUS có ISO 9001 không | 2026-06-13 |
| A4 | Đơn đăng ký chứng nhận (theo mẫu lab) | 🟡 Chờ mẫu lab | PMO | Chưa chọn lab → chưa có mẫu đơn | Sau khi chọn lab |
| A5 | Giấy ủy quyền (nếu người nộp ≠ giám đốc) | 🟡 Bản nháp | PMO | Cần xác nhận người nộp hồ sơ | 2026-06-13 |

### Chú giải trạng thái
- 🔴 Chưa có / Chưa bắt đầu
- 🟡 Đang chuẩn bị / Có bản nháp
- 🟢 Đã có / Sẵn sàng nộp
- ⚫ Không áp dụng

---

## Chi tiết từng mục

### A1 — Giấy đăng ký kinh doanh (bản sao công chứng)

**Yêu cầu:**
- Bản sao có công chứng (không quá 6 tháng)
- Tiếng Việt
- Thể hiện ngành nghề: sản xuất thiết bị điện/điện tử

**Quy trình:**
1. KINEXUS Admin cung cấp bản gốc GĐKKD
2. Mang ra VP công chứng để sao y (2-3 bản)
3. Scan màu bản đã công chứng → lưu vào thư mục này

**Child issue:** [IOT-5568](../../../../../../../../../IOT/issues/IOT-5568) — assigned to CTO triage (2026-06-02)

---

### A2 — Mã số thuế

**Yêu cầu:**
- Bản in/chụp giấy chứng nhận MST hoặc trích lục từ Cổng thông tin quốc gia
- Không cần công chứng (bản sao kèm GĐKKD là đủ)

**Quy trình:**
1. KINEXUS Admin cung cấp bản chụp giấy chứng nhận MST
2. Hoặc tra cứu tại: https://tracuunnt.gdt.gov.vn

**Child issue:** Cùng [IOT-5568](../../../../../../../../../IOT/issues/IOT-5568)

---

### A3 — Giấy chứng nhận ISO 9001

**Yêu cầu:**
- Bản sao chứng nhận ISO 9001:2015 còn hiệu lực
- Phạm vi chứng nhận bao gồm hoạt động sản xuất thiết bị điện/điện tử
- Nếu **không có** ISO 9001 → chuyển sang Method 2 (thử nghiệm mẫu điển hình + đánh giá nhà máy), hồ sơ sẽ khác

**Quy trình:**
1. KINEXUS QA xác nhận: có hay không có ISO 9001
2. Nếu có → cung cấp bản scan
3. Nếu không → PMO cập nhật lại phương thức chứng nhận sang Method 2

**Child issue:** [IOT-5569](../../../../../../../../../IOT/issues/IOT-5569) — assigned to CTO triage (2026-06-02)

---

### A4 — Đơn đăng ký chứng nhận (theo mẫu lab)

**Phụ thuộc:** Phải chọn được lab thử nghiệm trước → lab cung cấp mẫu đơn.

**Các lab đang khảo sát:**
- QUATEST 3 (HCM)
- QUATEST 1 (HN)
- Bureau Veritas (HCM)
- SGS (HCM)

**Quy trình:**
1. Hoàn tất lab selection
2. Liên hệ lab → xin mẫu đơn đăng ký
3. Điền thông tin doanh nghiệp + sản phẩm
4. Ký tên, đóng dấu

**Placeholder:** `A4-application-form-placeholder.md` — liệt kê các trường thông tin điển hình cần chuẩn bị trước.

---

### A5 — Giấy ủy quyền

**Áp dụng khi:** Người nộp hồ sơ không phải là người đại diện theo pháp luật (giám đốc).

**Template:** `A5-authorization-letter-template.md` — bản nháp tiếng Việt, cần điền:
- Tên người được ủy quyền
- Số CMND/CCCD
- Phạm vi ủy quyền
- Thời hạn ủy quyền

---

## Hành động kế tiếp

| # | Hành động | Owner | Deadline |
|---|-----------|-------|----------|
| 1 | ~~Tạo child issue cho KINEXUS Admin: cung cấp A1+A2+A5~~ → [IOT-5568](../../../../../../../../../IOT/issues/IOT-5568) | ✅ Đã tạo | 2026-06-02 |
| 2 | ~~Tạo child issue cho KINEXUS QA: xác nhận ISO 9001 (A3)~~ → [IOT-5569](../../../../../../../../../IOT/issues/IOT-5569) | ✅ Đã tạo | 2026-06-02 |
| 3 | Lab selection → xin mẫu đơn A4 | PMO | Khi có lab |
| 4 | Hoàn thiện template A5 khi xác định người nộp | PMO | 2026-06-13 |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | PMO | Phát hành đầu — tracker, A4 placeholder, A5 template draft |
