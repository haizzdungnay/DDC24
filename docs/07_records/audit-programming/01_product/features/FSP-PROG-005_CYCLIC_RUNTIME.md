# Feature Spec: Cyclic runtime 1/5/30 giây

**ID:** FSP-PROG-005  
**Phiên bản:** 0.1  
**Trạng thái:** IN REVIEW  
**Nguồn:** PC-PROG-008; PR-PROG-005, PR-PROG-012  
**Kiểm chứng:** VR-PROG-006, VR-PROG-012  
**Quyết định mở:** OD-PROG-004, 012

## Mục tiêu

Chạy Program theo lựa chọn cycle time Product 1 s, 5 s hoặc 30 s, có quan sát
cycle/overrun/fault và tiếp tục local khi Web/engineering client mất kết nối.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-005-B01 | UI/API/import/runtime chỉ chấp nhận 1000, 5000 hoặc 30000 ms. |
| FSP-PROG-005-B02 | Cycle áp dụng được lưu trong Revision và hiển thị từ authority, không suy diễn ở client. |
| FSP-PROG-005-B03 | Runtime thực thi deterministic theo rule được duyệt và quan sát được start/end/overrun/fault. |
| FSP-PROG-005-B04 | Mất/restart client không dừng Program active hoặc replay mutation mù khi reconnect. |
| FSP-PROG-005-B05 | Overrun/fault không được gây output không kiểm soát hoặc UI false-success. |

## Tiêu chí chấp nhận feature

Đo production target cho cả ba cycle với tải, jitter, WCET và fault injection;
reject mọi cycle khác ở tất cả cửa vào; xác nhận local continuity khi mất Web.

## Ranh giới

Base tick 50 ms của component cũ chỉ là candidate nội bộ. Budget, scheduling
nhiều Program và fault policy chờ OD-PROG-004/012.
