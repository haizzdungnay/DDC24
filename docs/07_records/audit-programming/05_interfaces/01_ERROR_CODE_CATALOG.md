# Danh mục mã lỗi Programming

| Thuộc tính | Giá trị |
|---|---|
| Chủ quản | `IFSPEC-PROG-001` |
| Namespace | `PRG-ERR-*` |
| Phiên bản | 0.1 |
| Trạng thái | `IN REVIEW` |
| Quy tắc | Một mã một nghĩa; Product/UX không tự phát minh mã |

## Mục lục

1. Quy ước
2. Catalog
3. Mã deprecated
4. Enforcement/telemetry
5. Thuật ngữ
6. Lịch sử và phê duyệt

## 1. Quy ước

Mã lỗi ổn định theo outcome/domain, không theo HTTP/process. Message tiếng Việt
có thể bổ sung context không nhạy cảm; code không đổi nghĩa khi transport/schema đổi.

## 2. Catalog

| Mã | Lớp | Nghĩa ổn định | Context tối thiểu | Requirement | Scenario |
|---|---|---|---|---|---|
| PRG-ERR-MAP-003 | Validation/Mapping | IEC type hoặc direction của Variable không tương thích Point kind/direction. | variable, point identity/category, expected/actual type/direction | PRG-PT-001, PRG-PT-002; UX-REQ-006 | VS-PROG-017 |
| PRG-ERR-MAP-004 | Validation/Mapping | Point identity/category/access/unit policy không hợp lệ hoặc không được phép cho binding. | binding, point identity/category, failed rule | PRG-PT-001, PRG-PT-002, PRG-PT-004; UX-REQ-006 | VS-PROG-017 |
| PRG-ERR-CUTOVER-001 | Lifecycle/Cutover | Graph và Programming cùng được yêu cầu Active; request bị từ chối, LKG/owner hiện tại giữ nguyên. | current/requested state, active revision/graph identity, correlation | PRG-RT-009; UX-REQ-009 | VS-PROG-015 |
| PRG-ERR-CONFLICT-001 | Concurrency | `base_revision`/ETag cũ; mutation không được áp dụng và cả hai version được giữ. | expected/current base, draft/revision identity, correlation | PRG-SEC-005; UX-REQ-020 | VS-PROG-024 |
| PRG-ERR-IMPORT-001 | Import/Security | Bundle chứa artifact/IR/native/cache/trust material hoặc thành phần executable bị cấm. | manifest item/class, target, correlation; không echo binary/source secret | PRG-COM-006; UX-REQ-021 | VS-PROG-021, VS-PROG-023 |
| PRG-ERR-COM-001 | Lifecycle/Commission | Candidate bị runtime từ chối; Active/LKG cũ giữ nguyên, kết quả có authority. | candidate/active revision, reject class, correlation | PRG-RT-003, PRG-RT-004; PRG-COM-003, PRG-COM-004; UX-REQ-009 | VS-PROG-011, VS-PROG-019 |

## 3. Mã deprecated

| Mã cũ | Trạng thái | Thay bằng | Lý do |
|---|---|---|---|
| `PRG-MAP-003` | `DEPRECATED / DO NOT REUSE` | `PRG-ERR-MAP-003` | Namespace cũ va với requirement family, R3-01. |
| `PRG-MAP-004` | `DEPRECATED / DO NOT REUSE` | `PRG-ERR-MAP-004` | Namespace cũ không thuộc IFSPEC, R3-01. |

## 4. Enforcement và telemetry

- UI phải render code authority + copy i18n, không parse message để quyết action.
- Error phải có correlation và audit khi là mutation/security event.
- Code không chứa secret, binary payload hoặc source nhạy cảm.
- Catalog chưa khóa HTTP status/schema; mapping transport sẽ được phê duyệt sau OD.

## 5. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 6. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo catalog authority, chuyển R3-01 sang PRG-ERR và đánh dấu mã cũ deprecated. |

Sign-off: Interface Owner `PENDING`; Product `PENDING`; Security `PENDING`; UX `PENDING`; Verification `PENDING`.
