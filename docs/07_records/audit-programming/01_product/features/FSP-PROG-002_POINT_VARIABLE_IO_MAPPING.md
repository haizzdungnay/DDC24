# Feature Spec: Point, Variable và I/O Mapping

**ID:** FSP-PROG-002
**Phiên bản:** 0.2
**Trạng thái:** IN REVIEW
**Nguồn:** PC-PROG-002..005; PR-PROG-003, PR-PROG-004
**Kiểm chứng:** VR-PROG-003
**Quyết định mở:** OD-PROG-002, 003, 007, 008

## Mục lục

1. Mục tiêu
2. Hành vi bắt buộc
3. Tiêu chí chấp nhận
4. Dữ liệu chưa chốt
5. Thuật ngữ, lịch sử và phê duyệt

## Mục tiêu

Cho phép Program dùng đúng ba category Point Rev A thông qua I/O Mapping đã xác
thực, đồng thời không đánh đồng Point authority với Variable nội bộ.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-002-B01 | Chỉ lộ Local Physical I/O, Virtual Point và Modbus RTU Point trong authoring/import/API/runtime. |
| FSP-PROG-002-B02 | Mỗi mapping liên kết stable Variable identity với discriminated Point identity/category; RTU dùng `{device_id, point_id}`. |
| FSP-PROG-002-B03 | Validate direction, IEC type × Point kind, read/write access, unit/range và quality contract trước khi Revision deployable. |
| FSP-PROG-002-B04 | Point unavailable/bad/stale phải đi qua fault/quality policy; không được giả là value live. |
| FSP-PROG-002-B05 | Sai category, identity, direction, type hoặc quyền phải trả lỗi ổn định và chặn deploy/activate. |

## Tiêu chí chấp nhận feature

Có positive/negative scenario trên production path cho cả ba category; mọi
Modbus TCP/BACnet/IP Point và mapping không hợp lệ bị từ chối ở mọi cửa vào.

## Dữ liệu chưa chốt

Type system, thuộc tính Local/Virtual đầy đủ, schema I/O Mapping và chi tiết RTU
còn theo OD-PROG-002, OD-PROG-007, OD-PROG-008. ADR-024 chỉ quyết định phần Modbus được nêu rõ,
không tự đóng contract chung.

Mã lỗi mapping thuộc `IFSPEC-PROG-001` với namespace `PRG-ERR-MAP-*`; Feature
Spec không tự định nghĩa mã.

## Thuật ngữ, lịch sử và phê duyệt

Thuật ngữ theo [DICT-PROG-001](../../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-08 | Feature audit ban đầu. |
| 0.2 | 2026-08-09 | Đồng bộ discriminated identity, type matrix và error ownership. |

Sign-off: Product Owner `PENDING`; I/O Owner `PENDING`; Verification `PENDING`.
