# Kế hoạch kiểm soát tài liệu Programming

**ID:** DOCCTRL-PROG-001  
**Phiên bản:** 1.0  
**Ngày hiệu lực nội bộ:** 2026-08-08  
**Trạng thái:** CONTROLLED BASELINE  
**Chủ quản hồ sơ:** Product + System + QA

## 1. Mục đích

Quy định cách nhận dạng, phân loại, phê duyệt, thay đổi và lưu trữ hồ sơ
Programming. Cấu trúc này áp dụng tư duy vòng đời của ISO/IEC/IEEE 15288,
ISO/IEC/IEEE 29148 và quản lý cấu hình; không phải chứng nhận ISO.

## 2. Loại tài liệu và thẩm quyền phê duyệt

| Loại | Tiền tố ID | Nội dung | Chủ quản/phê duyệt tối thiểu |
|---|---|---|---|
| Product Spec | `PROD-PROG` | Scope, capability, product requirement | Product |
| Feature Spec | `FSP-PROG` | Hành vi một feature và tiêu chí chấp nhận | Product + System/UX liên quan |
| Requirement | `*-REQ-PROG` | Nghĩa vụ System/Software/Interface/NFR | System + owner layer + QA |
| Architecture | `ARCH-PROG` | Context, allocation, boundary, ADR | Architecture/System |
| Design | `DES-PROG` | Cách hiện thực requirement | Owner kỹ thuật + reviewer |
| Interface | `IFSPEC-PROG` | Schema, state, error, authority, version | Hai phía giao tiếp + System |
| Verification | `VR-PROG` | Phương pháp, điều kiện, acceptance, evidence | QA + owner requirement |
| Traceability | `TRACE-PROG` | Liên kết hai chiều và trạng thái evidence | QA/System |
| Record | `REC-PROG` | Kết quả audit/test/review tại một thời điểm | Người lập + reviewer |

## 3. Trạng thái vòng đời

```text
Draft → In Review → Approved/Active → Superseded → Archived
```

`Candidate`, `Legacy` và `Historical` là phân loại sử dụng, không thay thế trạng
thái phê duyệt. Một file ghi `Active` cho component cũ không tự trở thành
Programming Product Design đã phê duyệt.

## 4. Quy tắc baseline và conflict

1. Mỗi yêu cầu phải có ID duy nhất, câu bắt buộc kiểm thử được và nguồn cấp trên.
2. Mỗi Feature Spec phải truy vết tới Product Capability/Product Requirement.
3. Mỗi requirement bắt buộc phải có ít nhất một Verification Requirement.
4. Giá trị chưa quyết định phải tham chiếu `OD-PROG-*`; không dùng giá trị từ
   prototype để điền vào baseline.
5. Mâu thuẫn phải có `CONF-PROG-*`, owner, cách xử lý và ảnh hưởng.
6. Chỉ `Accepted/Approved` mới đóng conflict normative; “resolved in audit” chỉ
   có nghĩa bộ hồ sơ đã chọn cách đọc nhất quán theo authority hiện có.
7. Tài liệu archive không được chỉnh nội dung; checksum bảo vệ khả năng tái hiện.

## 5. Baseline hiện tại

| Baseline | Giá trị |
|---|---|
| Product | `PROD-PROG-001`, Revision A, nguồn Active 2026-08-03 |
| Audit package | `AUD-PROG-001`, phiên bản 1.0, 2026-08-08 |
| Design readiness | `NO` — Programming Design chưa phê duyệt |
| Production verification | `RED / NO-GO`, 0/13 VR đạt |
| Open Decision | 15 mục; một số phần Modbus đã được ADR-024 quyết định |

## 6. Quy tắc cập nhật

Một change hợp lệ phải ghi lý do, phạm vi, tài liệu/ID bị ảnh hưởng, người phê
duyệt, evidence kiểm tra và phiên bản mới. Nếu thay đổi scope Product, phải sửa
Product Spec trước rồi mới lan xuống Feature/Requirement/Design/Verification.
