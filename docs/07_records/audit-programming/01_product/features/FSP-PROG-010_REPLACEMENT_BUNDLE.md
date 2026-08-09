# Feature Spec: Bundle source-only thay controller

| Thuộc tính | Giá trị |
|---|---|
| ID | `FSP-PROG-010` |
| Phiên bản | 0.1 |
| Trạng thái | `IN REVIEW` |
| Nguồn | PC-PROG-001, PC-PROG-009, PC-PROG-012; PR-PROG-001, PR-PROG-007, PR-PROG-009, PR-PROG-014; `PRG-COM-006` |
| Kiểm chứng | `VS-PROG-021`, `VS-PROG-023`; VR-PROG-002, VR-PROG-007, VR-PROG-008, VR-PROG-013 |
| Quyết định mở | OD-PROG-003, OD-PROG-010, OD-PROG-014, OD-PROG-015 |

## Mục lục

1. Mục tiêu
2. Hành vi bắt buộc
3. Tiêu chí chấp nhận
4. Ngoài phạm vi
5. Thuật ngữ
6. Lịch sử và phê duyệt

## 1. Mục tiêu

Cho phép chuyển Project sang controller thay thế mà không tạo đường nạp artifact
ngoại nhập hoặc tự thay đổi runtime đang Active.

## 2. Hành vi bắt buộc

| ID | Hành vi |
|---|---|
| FSP-PROG-010-B01 | Bundle chỉ được chứa source ST/FBD, mapping, một Task, Core Library version, Revision metadata, manifest và integrity hash. |
| FSP-PROG-010-B02 | Importer phải từ chối artifact, Typed IR, native binary, build cache và trust material; mã lỗi thuộc `PRG-ERR-IMPORT-*`. |
| FSP-PROG-010-B03 | Controller đích phải validate target/Point identity, tạo Draft mới, Check và build lại bằng toolchain/library được duyệt. |
| FSP-PROG-010-B04 | Artifact đích phải có identity/hash mới, qua loader verification và không được tự Activate/Commission. |
| FSP-PROG-010-B05 | Import/export phải giữ stable Project/reference identity ở mức policy được duyệt và audit actor/result/correlation. |

## 3. Tiêu chí chấp nhận

Round-trip source-only tạo Draft tương đương; bundle chứa IR/native/cache, corrupt
hoặc sai target bị reject; active Revision không đổi; mọi kết quả có authority/audit.

## 4. Ngoài phạm vi

Full functional/as-built PDF, trusted-origin signature, binary package sharing
và auto-activation nằm ngoài Rev A.

## 5. Thuật ngữ

Xem [DICT-PROG-001](../../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 6. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo từ amendment v2.2 cho UC-17/replacement. |

Sign-off: Product Owner `PENDING`; Security Owner `PENDING`; Runtime Architect `PENDING`; Verification `PENDING`.
