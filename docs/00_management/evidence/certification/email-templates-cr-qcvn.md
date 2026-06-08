# Email Templates — Yêu cầu Báo giá CR Mark / QCVN

> **Issue:** IOT-5459
> **Created:** 2026-06-02 · **Owner:** PMO
> **Lưu ý:** Đây là template để KINEXUS staff gửi đi. Thay [placeholder] bằng thông tin thực tế.

---

## Template A: Email đầu tiên (gửi đồng loạt cả 3 lab)

**Subject:** [KINEXUS] Yêu cầu báo giá chứng nhận CR Mark / QCVN cho thiết bị điều khiển DDC

**To:** [Địa chỉ email lab]
**Cc:** [Người phụ trách KINEXUS]

---

Kính gửi [Tên lab / Tên người phụ trách],

Công ty chúng tôi — **KINEXUS** — là doanh nghiệp Việt Nam đang phát triển bộ điều khiển DDC (Direct Digital Controller) cho hệ thống HVAC tòa nhà thương mại. Chúng tôi đang có nhu cầu đăng ký chứng nhận **CR Mark** theo các QCVN sau cho sản phẩm:

- **QCVN 4:2009/BKHCN** — Quy chuẩn kỹ thuật quốc gia về an toàn đối với thiết bị điện và điện tử
- **QCVN 9:2012/BKHCN** — Quy chuẩn kỹ thuật quốc gia về tương thích điện từ (EMC)

**Thông tin sản phẩm (tóm tắt):**

| Thông số | Chi tiết |
|----------|----------|
| Tên sản phẩm | MK-DDC-24 |
| Loại thiết bị | Bộ điều khiển DDC 24 điểm cho HVAC (FCU/VAV/AHU nhỏ) |
| Nguồn điện | 24 VAC ±10%, 50/60 Hz |
| Công suất | ~15 W (dự kiến) |
| Dải nhiệt độ | -20°C … +65°C |
| Cấp bảo vệ | IP20 (lắp trong tủ điện, DIN-rail) |
| Cổng kết nối | Ethernet RJ-45, RS-485 (Modbus RTU master), WiFi (tùy chọn) |
| I/O | 8 UI (universal) + 8 DI + 4 AO + 4 DO (relay 5A @ 250VAC) |
| Tiêu chuẩn tham chiếu | IEC 61326-1 (EMC), IEC 60730-1 (automatic electrical controls) |

**Kính đề nghị Quý lab cung cấp:**

1. **Báo giá chi tiết** cho thử nghiệm và chứng nhận CR Mark theo QCVN 4:2009 + QCVN 9:2012
2. **Thời gian dự kiến** (lead time) từ khi nhận mẫu đến khi cấp chứng nhận
3. **Số lượng mẫu thử** cần gửi
4. **Danh sách hồ sơ/tài liệu kỹ thuật** cần nộp kèm application
5. **Phí giám sát hàng năm** (annual surveillance) và điều kiện duy trì chứng nhận
6. **Hiệu lực chứng nhận** và điều kiện gia hạn
7. **Quy trình nộp hồ sơ** và các bước cụ thể

Chúng tôi dự kiến nộp application trong tháng 6-7/2026. Rất mong nhận được phản hồi từ Quý lab trong thời gian sớm nhất.

Trân trọng,

[Người liên hệ — KINEXUS]
[Số điện thoại]
[Email]
[Địa chỉ công ty]

---

## Template B: Email follow-up (sau 5-7 ngày chưa phản hồi)

**Subject:** Re: [KINEXUS] Yêu cầu báo giá chứng nhận CR Mark / QCVN cho thiết bị điều khiển DDC

---

Kính gửi [Tên lab],

Tôi đã gửi email yêu cầu báo giá chứng nhận CR Mark / QCVN vào ngày [ngày gửi]. Nay xin phép follow-up để đảm bảo email đã đến đúng bộ phận phụ trách.

Nếu Quý lab cần thêm thông tin kỹ thuật để lập báo giá, vui lòng cho chúng tôi biết — chúng tôi sẵn sàng cung cấp ngay.

Rất mong nhận được phản hồi.

Trân trọng,

[Người liên hệ — KINEXUS]

---

## Template C: Câu hỏi riêng cho QUACERT (cơ quan chứng nhận)

Ngoài nội dung báo giá chung, bổ sung câu hỏi:

- QUACERT có thể thực hiện cả thử nghiệm và chứng nhận, hay cần phối hợp với QUATEST để thử nghiệm?
- QUACERT có chấp nhận báo cáo thử nghiệm EMC/safety từ lab nước ngoài (IECEE-CB scheme) để rút ngắn thời gian không?
- Đối với thiết bị điều khiển tự động (không phải thiết bị điện gia dụng), QCVN 25:2025/BKHCN có áp dụng không? Hay chỉ cần QCVN 4 + QCVN 9?

---

## Template D: Câu hỏi riêng cho TÜV Rheinland Vietnam

Ngoài nội dung báo giá chung, bổ sung câu hỏi:

- TÜV Rheinland Vietnam có thể cấp CR Mark trực tiếp hay cần phối hợp với cơ quan chứng nhận Việt Nam?
- TÜV có thể tận dụng báo cáo thử nghiệm quốc tế (CE marking, IECEE-CB) để giảm thử nghiệm tại Việt Nam không?
- Chi phí cho lộ trình IECEE-CB + CR Mark song song là bao nhiêu?

---

## Template E: Trao đổi về QCVN 25:2025

**Sử dụng khi trao đổi với bất kỳ lab nào:**

Ngoài ra, chúng tôi có câu hỏi về phạm vi áp dụng của **QCVN 25:2025/BKHCN** (Thông tư 01/2025/TT-BKHCN ngày 14/02/2025). Sản phẩm MK-DDC-24 của chúng tôi:

- Sử dụng nguồn 24VAC (≤ 440V)
- Là thiết bị điều khiển tự động cho hệ thống HVAC tòa nhà
- **Không phải** là: MCB, RCBO, RCCB, ổ cắm, phích cắm, adapter, dây nối dài, hay công tắc điện dân dụng

Dựa trên phạm vi sản phẩm của QCVN 25:2025 (8 nhóm phụ kiện điện gia dụng), chúng tôi hiểu MK-DDC-24 không thuộc diện điều chỉnh. **Kính nhờ Quý lab xác nhận chính thức** để chúng tôi có cơ sở pháp lý cho hồ sơ.

---

## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | PMO | 5 templates: email đầu, follow-up, QUACERT riêng, TÜV riêng, QCVN 25 |
