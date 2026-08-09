# Kiểm soát bộ tài liệu thiết kế Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `DOCCTRL-PROG-001` |
| Phiên bản | 2.0 |
| Trạng thái bộ hồ sơ | `CONTROLLED DESIGN DOCUMENTATION SET / IN REVIEW` |
| Trạng thái thiết kế | `CHƯA ĐƯỢC PHÊ DUYỆT` |
| Chủ quản | Product Owner + Software/Runtime Architect |
| Ngày chuyển đổi | 2026-08-09 |
| Chu kỳ rà soát | Khi requirement/ADR/interface/verification đổi và tối thiểu trước mỗi release gate |

## Mục lục

1. Quyết định đổi bản chất
2. Quan hệ authority và Supersedes
3. Vị trí bộ tài liệu
4. Quy tắc phiên bản và thay đổi
5. Quyền, trạng thái và sign-off
6. Quy tắc kiểm chứng và lưu bằng chứng
7. Thuật ngữ
8. Lịch sử sửa đổi
9. Phê duyệt

## 1. Quyết định đổi bản chất

Từ ngày 2026-08-09, `AUD-PROG-001` đổi từ **controlled audit baseline** — bản
chụp chỉ tổng hợp/phân loại — thành **controlled design documentation set** sống
cho Programming. Bộ tài liệu phải được cập nhật có kiểm soát khi Product,
Requirement, Design, Interface hoặc Verification thay đổi; năm record lịch sử
trong `08_records/` và raw snapshot trong `09_archive/` vẫn giữ nguyên tính chất
record.

Lý do chuyển đổi: bộ hồ sơ cần trả lời xuyên suốt phạm vi, yêu cầu, thiết kế,
interface, kiểm chứng và evidence; mô hình audit snapshot không đủ quản trị
trace hai chiều hay tác động của amendment v2.2. Quyết định này **chỉ đổi cơ chế
quản trị tài liệu**, không phê duyệt thiết kế, không đóng Open Decision và không
đổi readiness.

## 2. Quan hệ authority và Supersedes

`docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` (`PROD-PROG-001`, Active)
tiếp tục là **Product authority duy nhất**. Hai proposal v2.2 là amendment input
`IN REVIEW`; controlled copy tại `01_product/00_PROGRAMMING_PRODUCT_SPEC.md`
trình bày authority Active cùng lớp delta đề xuất nhưng không thay thế bản gốc.

| Tài liệu/lớp | Authority | Quan hệ |
|---|---|---|
| `PROD-PROG-001` ngoài bộ | Active Product authority | Không bị supersede trong phiên này |
| Product/UX proposal v2.2 | Amendment input | Không supersede; chờ `OD-PROG-015` và sign-off |
| `SYS/SWR/IF/NFR-REQ-PROG-*` | Requirement baseline Active | Không bị `PRG-*`/`UX-REQ-*` thay thế |
| `PRG-*`, `UX-REQ-*` | Proposed requirement | Chỉ có hiệu lực đề xuất, evidence RED/MISSING |
| `VR-PROG-001..013` | Verification authority | Giữ `RED`, production evidence `0/13` |
| `08_records/`, `09_archive/` | Record/historical evidence | Bất biến theo record; không làm design source mới |

Không tồn tại tuyên bố `Supersedes` trong phiên này. Muốn thay Product authority
phải có biên bản/ADR nêu ngày hiệu lực, owner, phạm vi mục bị thay, requirement,
verification và liên kết ngược ở cả hai phía.

## 3. Vị trí bộ tài liệu

Bộ tài liệu tạm giữ tại `docs/07_records/audit-programming/` để bảo toàn liên kết
và chuỗi kiểm soát hiện hữu. Vị trí này không còn phản ánh đúng bản chất living
design; đường dẫn đích đề xuất là `docs/02_design/programming/`.

Chỉ di chuyển sau khi PM/CTO phê duyệt trong `OD-PROG-015`. Kế hoạch di chuyển
bắt buộc gồm: kiểm kê inbound links bằng `rg`, di chuyển nguyên cây `00..09`,
cập nhật Document Register/manifest/liên kết repo, chạy link checker và giữ
redirect/index record tại đường dẫn cũ. Phiên này không có phê duyệt đó nên
không di chuyển.

## 4. Quy tắc phiên bản và thay đổi

1. Major tăng khi đổi authority, cấu trúc hoặc semantic điều khiển.
2. Minor tăng khi thêm requirement/design/interface/scenario có kiểm soát.
3. Patch chỉ dành cho lỗi trình bày/trace không đổi nghĩa.
4. Mọi thay đổi phải có impact tới ID, conflict, open decision, verification và
   evidence; một chuỗi ID không được tái sử dụng cho nghĩa khác.
5. Tài liệu mới/sửa phải có mục lục, trỏ thuật ngữ, lịch sử và sign-off; record
   lịch sử được giữ nguyên thay vì viết lại hồi tố.
6. `DOCUMENT_MANIFEST.sha256` được tạo lại sau mỗi controlled change;
   `SOURCE_MANIFEST.sha256` và `09_archive/` chỉ được kiểm, không được sửa.
7. Mọi sửa docs phải cập nhật `CHANGELOG.md` dưới `[Unreleased]` trong cùng phiên.

## 5. Quyền, trạng thái và sign-off

| Hành động | Quyền tối thiểu |
|---|---|
| Đề xuất nội dung | Owner của domain tương ứng |
| Sửa controlled document | Document owner + change record |
| Phê duyệt Product | Product Owner; đóng `OD-PROG-015` |
| Phê duyệt runtime/control semantics | Software/Runtime Architect + Controls/Safety Reviewer |
| Phê duyệt UX | UX Lead |
| Phê duyệt verification/evidence | Verification Lead |

`CONTROLLED` chỉ nghĩa là tài liệu chịu change control; không đồng nghĩa
`APPROVED` hoặc `BASELINE`. Khi bất kỳ sign-off bắt buộc còn `PENDING`, tài liệu
phải giữ `IN REVIEW`; G0..G7 không được đổi khỏi `RED/NOT STARTED` bằng sửa docs.

## 6. Quy tắc kiểm chứng và lưu bằng chứng

- `VS-PROG-001..030` là catalog scenario duy nhất; không tạo danh sách E2E song song.
- Kết quả chỉ được tính khi có target/build/config/procedure/expected/actual/raw
  artifact/timestamp/reviewer và trỏ tới `VR-PROG-*`.
- Host test hoặc trace tài liệu chỉ là supporting evidence, không đổi `VR` khỏi RED.
- Edition/năm IEC/ISO giữ `UNVERIFIED` tới khi có evidence catalogue, ngày truy
  xuất và người xác nhận; chỉ dùng “aligned with” hoặc “informed by”.

## 7. Thuật ngữ

Toàn bộ thuật ngữ normative nằm tại
[Data Dictionary](02_TERMS_AND_DATA_DICTIONARY.md). Khi có khác biệt, dictionary
thắng trong bộ này; proposal chỉ là nguồn amendment và không tự đổi authority.

## 8. Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Tạo kiểm soát cho controlled audit baseline. |
| 2.0 | 2026-08-09 | Chuyển thành controlled design documentation set, chốt authority, review/change/evidence rule và kế hoạch di chuyển có điều kiện. |

## 9. Phê duyệt

| Vai trò | Quyết định | Ngày | Ghi chú |
|---|---|---|---|
| Product Owner | `PENDING` | — | `OD-PROG-015` còn OPEN |
| Software/Runtime Architect | `PENDING` | — | `OD-PROG-012, OD-PROG-013, OD-PROG-014` còn OPEN |
| Controls/Safety Reviewer | `PENDING` | — | Chưa có HIL cho semantics điều khiển |
| UX Lead | `PENDING` | — | UX v2.2 chưa sign-off |
| Verification Lead | `PENDING` | — | `VR-PROG-001..013` đều RED |
