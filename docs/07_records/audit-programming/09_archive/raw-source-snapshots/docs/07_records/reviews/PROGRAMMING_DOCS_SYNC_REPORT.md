# Báo cáo đồng bộ Docs theo Product Spec Programming DDC-24 Rev A

**ID:** REVIEW-PROG-DOCSYNC-001
**Trạng thái:** Complete
**Ngày:** 2026-08-03; tái kiểm chứng 2026-08-04 tại HEAD `6ba7e3c`
**Loại công việc:** Documentation-only; không sửa source; không lập Implementation Plan

## 1. Kết quả điều hành

Product Spec Programming Rev A đã được lập với phạm vi duy nhất gồm Local
Physical I/O, Virtual Point, Modbus RTU Point, ST, FBD và cycle time 1 s/5 s/30
s. Product baseline, requirements, software/interface boundary, verification,
traceability, decision log, document index và document control đã được đồng bộ
theo cùng bộ ID.

Không tài liệu nào trong thay đổi này tuyên bố Programming đã được implement.
Các source/test ST host-only được phân loại là As-Built development component;
chúng không phải bằng chứng runtime production.

## 2. Tài liệu đã xử lý

| Tài liệu | Thay đổi chính | Kết quả |
|---|---|---|
| `docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` | Tạo Product Spec, thuật ngữ, scope, capability, product requirement và vòng đời. | DONE |
| `docs/01_product/PRODUCT.md` | Khóa Programming Rev A, tách giao thức toàn sản phẩm khỏi Programming Point. | DONE |
| `docs/02_requirements/REQUIREMENTS.md` | Thêm requirement theo layer; bỏ dùng requirement IEC cũ làm authority mới. | DONE |
| `docs/04_design/SOFTWARE.md` | Gắn ranh giới Design/As-Built; không coi mô tả solution cũ là Programming Design được duyệt. | DONE |
| `docs/04_design/INTERFACES.md` | Gắn status host-only, nêu interface requirement chưa phải design/implementation contract. | DONE |
| `docs/05_verification/VERIFICATION.md` | Tạo 13 Verification Requirement và gate production RED; cấm dùng ST host test đóng runtime gate. | DONE |
| `docs/07_records/TRACEABILITY.md` | Điều hướng tới ma trận Programming chuẩn và bỏ claim C0/implementation plan khỏi trace authority. | DONE |
| `docs/00_governance/DECISIONS.md` | Thêm ADR-023 khóa phạm vi; reconcile ADR-006/020. | DONE |
| `docs/README.md`, `docs/00_governance/CONTROL.md` | Đăng ký bốn output và định nghĩa thẩm quyền Product/Requirement/Design/As-Built. | DONE |
| `CHANGELOG.md` | Ghi thay đổi và phương pháp kiểm chứng docs-only. | DONE |

## 3. Xung đột đã xử lý

| Xung đột trước đồng bộ | Cách xử lý |
|---|---|
| Product/requirements cũ đưa runtime ST/FBD cùng chi tiết POU/compiler/artifact như một khối. | Product Spec chỉ giữ hành vi sản phẩm; nghĩa vụ layer chuyển sang requirement; chi tiết solution không được phê duyệt trong nhiệm vụ này. |
| Whole-product baseline có Modbus TCP và BACnet/IP nên dễ bị hiểu thành Programming Point. | Giữ chúng ở phạm vi giao tiếp toàn sản phẩm, đồng thời loại trừ rõ khỏi Programming Rev A. |
| Component graph cũ có node Modbus TCP/BACnet và từng được mô tả là legacy importer cho FBD. | Phân loại là As-Built/legacy; không tạo Product Capability và để strategy migration ở OD-PROG-013. |
| `docs/CHUONG_YEU_CAU.md` bản nháp trước chứa Modbus TCP/BACnet trong nguồn point. | Giữ nguyên file đầu vào của người dùng; áp dụng chỉ thị mới hơn trong yêu cầu hiện tại và ADR-023 làm baseline. |
| Verification cũ ghi gate G0 GREEN và mô tả “host execution” dễ bị đọc như runtime production. | Programming release gate trở lại RED theo Product Spec mới; host-only được tách thành evidence phát triển không đủ điều kiện đóng VR production. |
| Traceability cũ trỏ C0/C1–C10 implementation plan và solution names chưa triển khai. | Ma trận mới chỉ truy Product Capability → Product Requirement → System Requirement → Verification Requirement; không lập hoặc dùng Implementation Plan. |

## 4. Ranh giới As-Built

- Source hiện có được phép dùng để mô tả As-Built, không được dùng để sửa ngược
  Product Spec nếu chưa có quyết định Product.
- ST host unit test/CLI/artifact/cyclic component là bằng chứng phát triển ở
  môi trường host. Không có test nào trong nhóm này chứng minh production
  service đã nạp Revision, chạy Program trong control path thật, I/O Mapping tới
  Local Physical I/O/Virtual Point/Modbus RTU Point, Activation/Rollback,
  RETAIN, FBD hoặc Online Monitor end-to-end.
- Nhiệm vụ này không sửa source và không tạo Programming Design hay
  Implementation Plan.

## 5. Các gate còn mở

1. 15 quyết định Product/System trong `PROGRAMMING_OPEN_DECISIONS.md` chưa được
   đóng.
2. Source foundation/readiness đã được audit trước đó là chưa sẵn sàng; nhiệm
   vụ tài liệu này không được phép sửa source.
3. 13/13 Verification Requirement Programming chưa có evidence production
   hợp lệ.
4. Chưa có Programming Design được phê duyệt; đây là chủ ý của nhiệm vụ.

## 6. Tái kiểm chứng sau repository restructure

Bộ đồng bộ này được viết tại PR #79 (2026-08-03 14:56). Sau đó PR #80
(`PLAN-ARCH-RESTRUCT-002`, 17:38–18:39) đã đổi cây source sang `apps/`,
`contracts/`, `firmware/` và `platform/`. Vì kết luận ở mục 7 phụ thuộc vào
tham chiếu As-Built, hồ sơ được kiểm lại tại HEAD `6ba7e3c`:

| Kiểm tra | Cách đo | Kết quả |
|---|---|---|
| Tham chiếu source trong hồ sơ Programming | Liệt kê path `apps/*`, `contracts/*` rồi kiểm tồn tại | 14/14 path tồn tại; không còn path `services/`, `web/`, `src/frontend`, `fw/` |
| Link markdown nội bộ | Resolve toàn bộ link tương đối của 13 tài liệu Programming | 0 link hỏng |
| Không gian ID Programming | Đối chiếu ID định nghĩa với ID xuất hiện trong ma trận | PC 12, PR 14, SYS-REQ 3, SWR-REQ 12, IF-REQ 2, NFR-REQ 2, VR 13, OD 15; 0 gap, 0 ID thiếu ánh xạ |
| Dependency Modbus RTU Point | Đối chiếu ID `*-MBRTU-*` do ma trận trích dẫn với REQUIREMENTS/VERIFICATION | SYS 1, SWR 9, IF 4, SEC 1, NFR 3, VR 12; 0 gap |
| Mâu thuẫn scope | Quét toàn bộ `docs/` tìm câu coi Modbus TCP/BACnet là Programming Point hoặc coi LD/SFC là đã hỗ trợ | 0 kết quả |
| Claim implementation | Quét câu khẳng định Programming đã implement/hoàn thành | 0 kết quả khẳng định; các lần khớp đều là câu cấm |

Một chỗ được siết thêm trong lần kiểm này: mục gate architecture conformance
của `VERIFICATION.md` ghi host matrix PASS sau migration. Số ctest đó có chứa
host unit test ST/IR/cyclic component, nên đã bổ sung câu loại trừ tường minh
rằng bộ số này không đóng được `VR-PROG-*` hay các gate real-hardware của
`VR-MBRTU-*`.

Kết luận: restructure không làm mất đồng bộ. Ba kết luận ở mục 7 giữ nguyên.

## 7. Kết luận

```text
PRODUCT_SPEC_DOCUMENTED = YES
DOCS_SYNCHRONIZED = YES
READY_FOR_PROGRAMMING_DESIGN = NO
```

`READY_FOR_PROGRAMMING_DESIGN = NO` vì workflow đã xác định phải sửa và đánh
giá lại source foundation trước khi mở Design, đồng thời các quyết định blocking
và production verification gate vẫn mở. Kết luận `NO` không phủ định việc bộ
Product Spec và traceability đã được đồng bộ đầy đủ ở lớp tài liệu.
