# Báo cáo tổ chức lại và dọn conflict hồ sơ Programming

**ID:** REC-PROG-REORG-001  
**Ngày:** 2026-08-08  
**Phạm vi thay đổi:** Chỉ `docs/07_records/audit-programming/`  
**Kết quả:** HOÀN TẤT BỘ HỒ SƠ AUDIT; PRODUCT RELEASE VẪN NO-GO

## 1. Triệu chứng ban đầu

33 snapshot nguồn, Product Spec, requirement extract, design extract và status
review nằm trong một cây không phân biệt authority. Các tài liệu Product mới,
draft design, component “Active”, graph legacy và archive review có thể bị đọc
như cùng một baseline.

## 2. Thay đổi đã thực hiện

| Nhóm | Kết quả |
|---|---|
| Cấu trúc | Dựng cây 00 Document Control → 01 Product → 02 Requirement → 03 Architecture → 04 Design → 05 Interface → 06 Verification → 07 Traceability → 08 Record → 09 Archive |
| Product/Feature | Giữ `PROD-PROG-001`; tạo Catalog và 9 Feature Spec, phủ 12 PC/14 PR |
| Requirement | Chuẩn hóa 19 requirement layer, không trộn graph/RTU dependency thành authority Programming |
| Design | Tách constraint đã khóa khỏi candidate/component/legacy; giữ gate Design `NO` |
| Conflict | Đăng ký 14 conflict; chọn cách đọc theo authority và giữ OPEN khi thiếu quyết định |
| Verification | Chuẩn hóa 13 VR; giữ đúng 0/13 production pass |
| Traceability | Nối Product → Feature → Requirement → VR → evidence |
| Archive | Di chuyển nguyên 33 snapshot, giữ manifest cũ và tạo checksum theo path mới |

## 3. Conflict được làm rõ quan trọng

- FBD là feature Rev A; graph 28-node là legacy migration input, không phải FBD.
- Product boundary chỉ chấp nhận cycle 1/5/30 s; 50 ms là internal candidate.
- ADR-024 `Accepted 2026-08-05` có ưu tiên hơn câu “Proposed” và design cũ:
  một bus RS485 vật lý, `bus_id` mở rộng, capacity Modbus Point ≥256.
- ST/Scheduler/IR “Active” chỉ có nghĩa trong component cũ; Programming Design
  production vẫn chưa approved.
- Host test/source foundation không đổi 13 VR sang PASS.

## 4. Dữ liệu không bị xóa

Không xóa hoặc sửa raw source. Mọi claim cũ, path cũ và giá trị bị superseded
vẫn còn trong `09_archive/raw-source-snapshots/` để điều tra lịch sử. Bộ baseline
mới tránh gây rối bằng classification/register thay vì viết lại lịch sử.

## 5. Kết luận gate

- Chất lượng tổ chức hồ sơ audit: đủ thứ tự, ID, status, conflict và traceability.
- `READY_FOR_PROGRAMMING_DESIGN`: **NO** cho tới khi đóng Open Decision/chấp thuận
  design package.
- Production verification: **RED / NO-GO**, evidence đạt **0/13**.
- Không có tuyên bố ISO certification/compliance từ lần sắp xếp này.
