# Feature Spec: Function Block Diagram

**ID:** FSP-PROG-004  
**Phiên bản:** 0.1  
**Trạng thái:** IN REVIEW  
**Nguồn:** PC-PROG-007; PR-PROG-002, PR-PROG-006  
**Kiểm chứng:** VR-PROG-005  
**Quyết định mở:** OD-PROG-002, 005, 006, 013

## Mục tiêu

Cho phép tạo, validate và chạy Program FBD Rev A với semantic tương thích với ST
ở các kiểu/chức năng dùng chung đã phê duyệt.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-004-B01 | Authoring thể hiện block, port, connection và diagnostic có thể truy nguyên. |
| FSP-PROG-004-B02 | Block/connection/type invalid phải chặn Revision deployable. |
| FSP-PROG-004-B03 | FBD được compile/normalize sang semantic/artifact runtime đã phê duyệt, không chạy JSON graph tùy ý. |
| FSP-PROG-004-B04 | Cùng golden logic và input phải có kết quả tương đương ST theo rule đã duyệt. |
| FSP-PROG-004-B05 | Legacy graph không được tự hiển thị hoặc import như FBD nếu chưa qua migration/validation được duyệt. |

## Tiêu chí chấp nhận feature

Có golden scenario FBD end-to-end trên cùng production target với ST; negative
test block, connection, type và legacy graph; monitor truy đúng block/Program/
Revision.

## Ranh giới

UX canvas, block library, connection rule, exchange format và migration graph
chờ OD-PROG-005/006/013. Graph 28-node hiện có không phải FBD Product Spec.
