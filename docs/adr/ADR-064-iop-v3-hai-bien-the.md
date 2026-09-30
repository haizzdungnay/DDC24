# ADR-064 — Kinexus-IOP v3.0 cho hai biến thể 16/4/4 và 16/8/8

**Trạng thái:** **Accepted cho lựa chọn V3.0 duy nhất** (chủ dự án, 2026-09-30); ICD chi tiết vẫn Draft, chưa được hai team/Safety ký và source SOM chưa chuyển V3.0

**Ngày:** 2026-09-30

**Chủ sở hữu quyết định phạm vi:** Chủ dự án MK-DDC-24

**Chủ quản giao diện:** System Architect; SOM lead, MCU team lead và Safety review/ký theo [ICD §17](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md)

**Liên quan:** [ADR-010](ADR-010-iop-v2-poll-capability-map.md), [ICD v3.0](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md), [FW-REQ v3.1](../01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md), [header nháp](../01_specs/iop_protocol_v3_DRAFT.h)

## 1. Bối cảnh

`contracts/iop/iop_protocol.h` v2.0 và phía SOM hiện dùng layout 4 AO/4 DO; `contracts/shm/mkddc_shm.h` cũng có capacity AO4/DO4. Bản ICD v2.1 đã soạn thêm hành vi phiên nhưng chưa được phát hành. Chủ dự án yêu cầu **một hợp đồng tích hợp phục vụ cả hai biến thể** 16 UI/4 AO/4 DO và 16 UI/8 AO/8 DO. Repo chưa có hồ sơ HW chuẩn cho biến thể 8/8; quyết định này chỉ nói về **giao diện** và điều kiện nghiệm thu, không xác nhận sự tồn tại hoặc tính khả thi của bo 8/8.

## 2. Quyết định đã chọn cho bản nháp

1. Dùng phương án PA-B: **IOP v3.0 là phiên bản duy nhất cho tích hợp mới**, gộp nội dung đã soạn cho v2.1. **Không triển khai hai stack V2.x/V3.0 và không nhận V2.x tại cổng tích hợp.** Giữ SOM làm master, mô hình poll, khung `SOF/LEN/CMD/SEQ/CRC`, UART 921600 và CRC-16/MODBUS truyền byte cao trước. Đổi major vì `SET_AO` dài 8 → 16 byte và `HANDSHAKE_RESP` dài 8 → 12 byte.
2. Mọi frame `SET_AO` và `SET_SAFE_CFG` mang đủ 8 vị trí AO; `SET_DO` và các mask có 8 bit. MCU khai `N_UI/N_AO/N_DO/N_DI` trong `HANDSHAKE_RESP`; chỉ các profile 16/4/4/0 và 16/8/8/0 được vận hành ở Rev A. Kênh không lắp phải bằng 0. SOM phát `MCU_VARIANT_MISMATCH` và giữ safe nếu profile khai khác cấu hình.
3. Hành vi phiên, lỗi, thời gian, cấu hình và 21 vector theo [ICD v3.0](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md). [Header nháp](../01_specs/iop_protocol_v3_DRAFT.h) giữ byte/hằng số để hai team review; chỉ khi hai team ký và migration phía SOM hoàn tất mới thay `contracts/iop/iop_protocol.h`.
4. Chọn gói bàn giao cho **team HW, FW MCU và SOM**, **chỉ có tài liệu tích hợp** gồm ICD, yêu cầu FW MCU và header nháp; README nêu phản hồi cần có từ từng team. Không đưa phần cứng 4/4, tài liệu tham khảo v2 hoặc bằng chứng kiểm thử cũ vào gói. Gói 2026-09-30 trước đó chưa gửi cho các team nhận; bản dựng lại thay bản cục bộ cũ, không cần file so sánh gửi cho team.

## 3. Phương án đã xét

| Phương án | Kết luận |
|---|---|
| Giữ v2.0 cho 4/4, tạo giao thức riêng cho 8/8 | Từ chối: hai định dạng song song làm tăng rủi ro ghép sai cặp. |
| Nâng v2.1 nhưng giữ payload 4 AO | Từ chối: không biểu diễn đủ 8 AO và không khai số kênh thực lắp. |
| **PA-B: IOP v3.0, một định dạng tối đa 8/8** | Được chủ dự án chọn; cần ký ICD và kiểm cặp trước khi dùng runtime. |

## 4. Hệ quả và cổng

- `ADR-010` bị **superseded về lựa chọn phiên bản và layout mục tiêu** ngay bởi quyết định này; chỉ giữ làm hồ sơ lịch sử và mô tả source V2.0 còn tồn tại. Nguyên tắc poll, signed int32 và CRC tiếp tục trong V3.0. Source SOM V2.0 phải được **thay thế đồng bộ**, không trở thành phương án tương thích dự phòng.
- P0: System Architect, SOM lead, MCU team lead và Safety ký ICD/FW-REQ; giải quyết các mục mở ở ICD §16.1. P1: chuyển iobus, fake MCU, SHM capacity và cấu hình/consumer SOM sang hai biến thể, rồi chạy test host. P2/P3: test cặp UART thật và HIL cho từng bo khi phần cứng có sẵn. **Không có bằng chứng P1/P2/P3 ở quyết định này.**
- HW cung cấp schematic, pinout và giới hạn điện cho từng biến thể riêng. Thiếu HW 8/8 không chặn việc gửi **bản nháp để review**, nhưng chặn xác nhận yêu cầu vật lý và cổng G-MCU-2/3 cho 8/8.

## 5. Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.1 | 2026-09-30 | Chủ dự án chốt V3.0 duy nhất cho tích hợp; supersede ADR-010 ở mục tiêu, cấm dual-stack V2.x/V3.0; giữ ICD chi tiết chờ hai team/Safety ký. |
| 1.0 | 2026-09-30 | Ghi lựa chọn PA-B/IOP v3.0 cho hai biến thể, ranh giới với runtime v2 và gói bàn giao tích hợp chỉ để review. |
