# Feature Spec: Phân quyền, audit và bảo vệ scope

**ID:** FSP-PROG-009  
**Phiên bản:** 0.1  
**Trạng thái:** IN REVIEW  
**Nguồn:** PC-PROG-012; PR-PROG-013, PR-PROG-014  
**Kiểm chứng:** VR-PROG-011, VR-PROG-013  
**Quyết định mở:** OD-PROG-001, 015

## Mục tiêu

Ngăn actor hoặc dữ liệu không hợp lệ thay đổi lifecycle, đồng thời bảo đảm mọi
cửa vào giữ đúng scope Product Rev A.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-009-B01 | View/edit/create Revision/deploy/activate/rollback được kiểm quyền riêng theo ma trận approved. |
| FSP-PROG-009-B02 | Mutation tạo audit gồm actor, action, target, time, correlation và authority result. |
| FSP-PROG-009-B03 | UI/API/import/runtime đều reject LD, SFC, TCP Point, BACnet Point, motion và safety PLC. |
| FSP-PROG-009-B04 | Replay/duplicate/timeout/bypass không được tạo mutation mơ hồ hoặc false-success. |
| FSP-PROG-009-B05 | Không xuất claim IEC certification/compliance khi chưa có chương trình đánh giá được duyệt. |

## Tiêu chí chấp nhận feature

Ma trận positive/negative theo role/action, kiểm audit completeness và thử bypass
ở mọi boundary; negative scope được thử trên UI/API/import/runtime.

## Ranh giới

Tên role/action cụ thể chờ OD-PROG-001. Quyết định Modbus giữ ba role
viewer/operator/admin không tự khóa toàn bộ Programming RBAC.
