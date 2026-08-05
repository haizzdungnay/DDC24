# PHIẾU XÁC NHẬN — Mở Track B Modbus RTU

**ID:** DDC24-MBRTU-TRACKB-SIGNOFF-2026-08-04
**Ngày trình:** 2026-08-04
**Người trình:** Engineering
**Người duyệt:** CTO · Product Owner · PM · Hardware Lead
**Hạn mong muốn:** trong tuần

> Phiếu này **chỉ** để mở Track B (redesign theo contract v2, 45 task, 40–51
> người-ngày). Track A đã có phiếu riêng và không phụ thuộc phiếu này.
> Chi tiết đầy đủ: [Báo cáo PM/CTO](MODBUS_RTU_PM_CTO_REVIEW_BRIEF_2026-08-04.md) ·
> [Plan 49](../../03_implementation/49_MODBUS_RTU_IMPLEMENTATION_PLAN.md) ·
> [Bằng chứng board](../test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md)

---

## 1. Năm mục cần xác nhận

### ☐ X-01 · Số cổng RS485 của sản phẩm — **CỔNG CHẶN CỨNG**

Tài liệu Product ghi `2 × Modbus RTU`. Kiểm tra trực tiếp board production Foxlinx
ngày 2026-08-04: chỉ **2 UART được bật**, trong đó `ttyS2` đang chạy cho MCU STM32,
còn lại **đúng một** cổng (`ttyS5`) cho Modbus RTU.

**Việc cần làm để trả lời:** Hardware đọc bản vẽ bo Foxlinx SOM-DDC-24, xác nhận
có mấy mạch thu phát RS-485 và nối vào UART nào. **Ước tính 0,5 ngày công.**

☐ **A. Giữ 2 cổng** — Hardware xác nhận bo có 2 transceiver. Ghi rõ UART nào: `____________`
☐ **B. Hạ xuống 1 cổng ở Rev A** — khớp board thật; giảm ~5 ngày công; **phải sửa tài liệu Product và điều chỉnh cam kết bán hàng**
☐ **C. Hoãn** — Track B tiếp tục bị chặn

**Khuyến nghị kỹ thuật:** đọc bản vẽ trước rồi mới chọn. Không chọn theo mong muốn
thị trường, vì phần mềm không tạo ra được cổng vật lý không tồn tại.

Người duyệt: ☐ CTO ☐ Product ☐ Hardware Lead — Ngày: `________`

---

### ☐ X-02 · Cơ chế chuyển hướng truyền RS-485

RS-485 dùng chung một cặp dây cho cả hai chiều nên thiết bị phải biết lúc nào được
nói, lúc nào phải nghe. Kiểm tra board: **hệ điều hành chưa cấu hình gì cho việc
này**, và phần mềm cũng không thiết lập — tức đang ngầm giả định mạch tự chuyển
hướng. Nếu giả định sai, khung truyền bị cắt và **chỉ phát hiện được khi đấu dây
thật**, ở giai đoạn nghiệm thu cuối.

☐ **A. Mạch tự chuyển hướng (auto-direction)** — không cần làm gì thêm, nhưng phải đo dạng sóng để chứng minh
☐ **B. Điều khiển bằng chân RTS** — phải bật cấu hình trong hệ điều hành và sửa phần mềm
☐ **C. Điều khiển bằng chân GPIO riêng** — ghi rõ chân: `____________`
☐ **D. Chưa biết** — Hardware cần kiểm tra

Người duyệt: ☐ CTO ☐ Hardware Lead — Ngày: `________`

---

### ☐ X-03 · Đồng ý thay đổi định dạng dữ liệu nội bộ giữa 3 dịch vụ

Định dạng hiện tại **không mang dấu thời gian của phép đo**, không phân biệt đủ
trạng thái chất lượng, và **làm sai số nguyên lớn** — ví dụ chỉ số điện năng tích
luỹ vượt ~16,7 triệu sẽ hiển thị sai.

Sửa việc này buộc `mkddc-core`, `mkddc-iobus`, `mkddc-web` phải được nâng cấp
**cùng lúc**, không được lệch phiên bản.

☐ **A. Đồng ý**, kèm điều kiện: đóng gói 3 dịch vụ trong một gói cài đặt duy nhất, và có kiểm thử "cài lệch phiên bản phải báo lỗi rõ"
☐ **B. Không đồng ý** — chấp nhận giữ lỗi mất chính xác và không có dấu thời gian đo. **Hệ quả: không đạt điều kiện nghiệm thu**
☐ **C. Hoãn sang Rev B**

Người duyệt: ☐ CTO — Ngày: `________`

---

### ☐ X-04 · Chuyển ADR-024 từ `Proposed` sang `Accepted`

Theo quy định quản lý tài liệu của dự án, chỉ tài liệu trạng thái `Active` mới là
cơ sở để triển khai. Bộ 12 tài liệu thiết kế Modbus RTU đang ở `In Review`, và
ADR-024 vẫn `Proposed`.

Bắt đầu viết code theo một thiết kế chưa duyệt là làm sai thứ tự quy trình.

☐ **A. Chấp thuận** — chuyển ADR-024 sang `Accepted`, 12 tài liệu sang `Active`
☐ **B. Chấp thuận có điều kiện** — nêu điều kiện: `_________________________________`
☐ **C. Chưa chấp thuận** — nêu lý do: `_________________________________`

Lưu ý: X-04 phụ thuộc X-01. Nếu chọn "1 cổng" ở X-01 thì bộ tài liệu phải sửa
phần hai-bus trước khi chuyển `Active`.

Người duyệt: ☐ CTO — Ngày: `________`

---

### ☐ X-05 · Chỉ định người chịu trách nhiệm

Hiện **chưa có tên người** cho hai vai trò bắt buộc. Không có người ký thì không
đóng được quyết định kỹ thuật và không ai phê duyệt kết quả nghiệm thu; ước lượng
công sức trong Plan 49 cũng chưa chốt được.

| Vai trò | Tên người | Tỷ lệ thời gian |
|---|---|---|
| Fieldbus / FW-SOM Lead | `________________` | `____%` |
| QA / Verification Lead | `________________` | `____%` |

Người duyệt: ☐ CTO — Ngày: `________`

---

## 2. Mục KHÔNG chặn Track B nhưng chặn nghiệm thu

### ☐ X-06 · Cấp thiết bị RS485 thật

Cần: 2–3 thiết bị Modbus RTU thật (khuyến nghị 1 đồng hồ điện + 1 biến tần), cáp,
điện trở đầu cuối, 1 máy phân tích bus.

☐ **A. Đồng ý cấp** — dự kiến có hàng: `____________`
☐ **B. Chưa cấp** — Track B vẫn làm được, nhưng **không được tuyên bố sản phẩm hỗ trợ Modbus RTU** cho tới khi có thiết bị

Người duyệt: ☐ CTO — Ngày: `________`

---

## 3. Kết luận

☐ **MỞ TRACK B** — khi X-01, X-02, X-03, X-04, X-05 đều đã có lựa chọn
☐ **CHƯA MỞ** — còn thiếu mục: `_________________________________`

**Ghi chú của người duyệt:**

```
______________________________________________________________________
______________________________________________________________________
______________________________________________________________________
```

| Vai trò | Họ tên | Chữ ký | Ngày |
|---|---|---|---|
| CTO | | | |
| Product Owner | | | |
| PM | | | |
| Hardware Lead | | | |

---

## 4. Sau khi ký

Kỹ thuật sẽ: cập nhật `DECISIONS.md` với các quyết định đã ký, đóng các mục
`OD-MBRTU-*` tương ứng, chuyển 12 tài liệu thiết kế sang `Active` (hoặc sửa trước
nếu X-01 chọn phương án B), rồi khởi động Track B theo Plan 49 §4.

**Không** bắt đầu Track B trước khi phiếu này được ký đủ 5 mục X-01..X-05.

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-04 | Tạo phiếu xác nhận mở Track B, 6 mục quyết định |
