# Feature Spec: RETAIN và phục hồi

**ID:** FSP-PROG-007  
**Phiên bản:** 0.1  
**Trạng thái:** IN REVIEW  
**Nguồn:** PC-PROG-010; PR-PROG-010  
**Kiểm chứng:** VR-PROG-009  
**Quyết định mở:** OD-PROG-002, 009, 010

## Mục tiêu

Bảo toàn Variable được đánh dấu RETAIN đúng theo policy restart/compatibility đã
phê duyệt; Variable không RETAIN không được nhận giá trị cũ mặc nhiên.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-007-B01 | RETAIN flag và layout/value truy nguyên tới Revision/type tương ứng. |
| FSP-PROG-007-B02 | Restore chỉ khi state integrity và compatibility đạt policy. |
| FSP-PROG-007-B03 | Corrupt/incompatible/missing state phải fail rõ và áp dụng initialization/fault policy được duyệt. |
| FSP-PROG-007-B04 | Non-RETAIN luôn theo initialization semantics, không dùng residue bền vững. |
| FSP-PROG-007-B05 | Ghi bền vững tuân thủ wear/power-loss policy và có evidence trên target. |

## Tiêu chí chấp nhận feature

Ma trận warm restart, cold restart, power cycle, Revision/type change, corrupt
state và non-RETAIN đạt kết quả đã phê duyệt trên production target.

## Ranh giới

Feature Spec không tự định nghĩa biến cố nào được giữ, tần suất checkpoint hay
wear limit; toàn bộ thuộc OD-PROG-009/010.
