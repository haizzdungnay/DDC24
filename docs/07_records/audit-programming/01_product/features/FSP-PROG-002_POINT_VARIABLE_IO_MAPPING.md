# Feature Spec: Point, Variable và I/O Mapping

**ID:** FSP-PROG-002  
**Phiên bản:** 0.1  
**Trạng thái:** IN REVIEW  
**Nguồn:** PC-PROG-002..005; PR-PROG-003, PR-PROG-004  
**Kiểm chứng:** VR-PROG-003  
**Quyết định mở:** OD-PROG-002, 003, 007, 008

## Mục tiêu

Cho phép Program dùng đúng ba category Point Rev A thông qua I/O Mapping đã xác
thực, đồng thời không đánh đồng Point authority với Variable nội bộ.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-002-B01 | Chỉ lộ Local Physical I/O, Virtual Point và Modbus RTU Point trong authoring/import/API/runtime. |
| FSP-PROG-002-B02 | Mỗi mapping liên kết stable Variable identity với stable Point identity/category. |
| FSP-PROG-002-B03 | Validate direction, type compatibility, read/write access, unit/range khi áp dụng và quality contract trước khi Revision deployable. |
| FSP-PROG-002-B04 | Point unavailable/bad/stale phải đi qua fault/quality policy; không được giả là value live. |
| FSP-PROG-002-B05 | Sai category, identity, direction, type hoặc quyền phải trả lỗi ổn định và chặn deploy/activate. |

## Tiêu chí chấp nhận feature

Có positive/negative scenario trên production path cho cả ba category; mọi
Modbus TCP/BACnet/IP Point và mapping không hợp lệ bị từ chối ở mọi cửa vào.

## Dữ liệu chưa chốt

Type system, thuộc tính Local/Virtual đầy đủ, schema I/O Mapping và chi tiết RTU
còn theo OD-PROG-002/007/008. ADR-024 chỉ quyết định phần Modbus được nêu rõ,
không tự đóng contract chung.
