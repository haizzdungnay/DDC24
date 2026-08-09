# Product Spec Programming DDC-24 Rev A — controlled copy và amendment overlay

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROD-PROG-001` |
| Revision authority | A, Active từ 2026-08-03 |
| Phiên bản controlled copy | 2.0 |
| Trạng thái amendment | `PROPOSAL / IN REVIEW` |
| Product authority canonical | `docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` |
| Amendment input | Product v2.2 + UX v2.2, 2026-08-09 |
| Chủ quản | Product Owner |

> File này là controlled mirror của `PROD-PROG-001` và lớp delta đề xuất. Nó
> không phải Product Spec thứ hai, không supersede authority canonical và không
> biến nội dung v2.2 thành baseline khi sign-off còn `PENDING`.

## Mục lục

1. Authority và cách đọc
2. Phạm vi Active Rev A
3. Product Capability authority
4. Product Requirement authority
5. Amendment v2.2 đề xuất
6. Lifecycle và ranh giới chủ quản
7. Traceability và gate
8. Thuật ngữ
9. Lịch sử sửa đổi
10. Phê duyệt

## 1. Authority và cách đọc

`PC-PROG-001..012` và `PR-PROG-001..014` dưới đây giữ nguyên nghĩa authority
2026-08-03. Mọi nội dung mang nhãn `PROPOSED V2.2` chỉ là proposed answer cho
Open Decision hoặc làm rõ dự kiến; nếu mạnh hơn/mâu thuẫn baseline thì phải vào
Conflict Register và không được implement như quyết định đã duyệt.

## 2. Phạm vi Active Rev A

### 2.1 Trong phạm vi authority

- Local Physical I/O, Virtual Point và Modbus RTU Point;
- Structured Text (ST) và Function Block Diagram (FBD);
- cycle time chỉ `1 s`, `5 s`, `30 s`;
- Project, Program, Point, Variable, I/O Mapping, Revision, Deployment,
  Activation, Rollback, RETAIN và Online Monitor theo requirement tương ứng.

### 2.2 Ngoài phạm vi authority

Modbus TCP Point, BACnet/IP Point, LD, SFC, motion control, safety PLC, online
change và mọi claim IEC conformance/certification khi chưa có evidence đều phải
bị từ chối, không chỉ bị ẩn trên UI.

## 3. Product Capability authority

| ID | Product Capability |
|---|---|
| PC-PROG-001 | Quản lý Project và Program có truy nguyên. |
| PC-PROG-002 | Phân biệt Point, Variable và quản lý I/O Mapping. |
| PC-PROG-003 | Dùng Local Physical I/O trong Program. |
| PC-PROG-004 | Dùng Virtual Point trong Program. |
| PC-PROG-005 | Dùng Modbus RTU Point trong Program. |
| PC-PROG-006 | Tạo, xác thực và chạy Program ST. |
| PC-PROG-007 | Tạo, xác thực và chạy Program FBD. |
| PC-PROG-008 | Chạy Program cyclic với lựa chọn cycle time 1 s, 5 s hoặc 30 s. |
| PC-PROG-009 | Quản lý Revision, Deployment, Activation và Rollback. |
| PC-PROG-010 | Bảo toàn Variable RETAIN theo chính sách đã phê duyệt. |
| PC-PROG-011 | Quan sát Program, Variable và Point qua Online Monitor. |
| PC-PROG-012 | Giữ đúng ranh giới Programming Rev A và từ chối capability ngoài phạm vi. |

## 4. Product Requirement authority

| ID | Product Requirement |
|---|---|
| PR-PROG-001 | Sản phẩm phải cho phép người dùng có quyền tạo, mở, sửa và lưu Project chứa một hoặc nhiều Program mà không làm mất quan hệ truy nguyên. |
| PR-PROG-002 | Sản phẩm phải hỗ trợ Program ST và Program FBD như hai ngôn ngữ Rev A; lỗi xác thực phải được trả rõ trước Deployment. |
| PR-PROG-003 | Sản phẩm chỉ được cung cấp Local Physical I/O, Virtual Point và Modbus RTU Point cho I/O Mapping Rev A. |
| PR-PROG-004 | Sản phẩm phải phân biệt Point với Variable và xác thực direction, type, quyền đọc/ghi và quality tại I/O Mapping. |
| PR-PROG-005 | Sản phẩm chỉ được cung cấp cycle `1 s`, `5 s`, `30 s` và phải hiển thị lựa chọn đang áp dụng. |
| PR-PROG-006 | Revision lỗi syntax, semantic, I/O Mapping hoặc validation bắt buộc không được Deployment/Activation. |
| PR-PROG-007 | Revision dùng cho Deployment phải bất biến và truy nguyên tới Project, Program và actor tạo Revision. |
| PR-PROG-008 | Deployment phải có trạng thái authority và không được tự báo thành công khi runtime chưa chấp nhận đúng artifact. |
| PR-PROG-009 | Activation phải ở cyclic boundary; lỗi giữ Revision đang chạy; Rollback phải về Revision tương thích đã biết. |
| PR-PROG-010 | Variable RETAIN phải được phục hồi theo policy đã duyệt; non-RETAIN không được mặc nhiên dùng dữ liệu cũ. |
| PR-PROG-011 | Online Monitor phải hiển thị authority data, active Revision, Program, Variable, Point và freshness; stale/unavailable không được giả live. |
| PR-PROG-012 | Program active phải tiếp tục chạy local khi Web/engineering client mất kết nối. |
| PR-PROG-013 | Sửa Project, tạo Revision, Deployment, Activation và Rollback phải được phân quyền và audit. |
| PR-PROG-014 | Sản phẩm phải từ chối LD, SFC, Modbus TCP Point, BACnet/IP Point, motion và safety PLC; không gắn nhãn đã hỗ trợ. |

## 5. Amendment v2.2 đề xuất

### 5.1 Delta so với Product authority ngày 2026-08-03

| Chủ đề | Baseline 2026-08-03 | Delta `PROPOSED V2.2` | ID/decision liên quan |
|---|---|---|---|
| Functional view | Project/Program có truy nguyên | Functional tag/view chỉ là metadata tùy chọn, không entity thứ tư | `PRG-BACS-001, PRG-BACS-002`; `OD-PROG-003` |
| FBD | FBD IN, UX chưa chốt | Structured typed editor IN; free-form wiresheet/canvas OUT Rev A | `PRG-IEC-001, PRG-IEC-005`; `OD-PROG-006` |
| Task | Cycle 1/5/30, số Task chưa chốt | Đúng một Task Rev A; multi-task và 8/16/32 OUT | `PRG-IEC-003`; `OD-PROG-003, OD-PROG-004` |
| Library | Chưa nêu ceiling | Core Control Library tối thiểu IN; BACS Library nâng cao OUT | `PRG-BACS-004`; `OD-PROG-005` |
| User FB | Chưa chốt | User FUNCTION_BLOCK chỉ cục bộ Project; package/global/binary OUT | `PRG-IEC-002`; `OD-PROG-005, OD-PROG-006` |
| RETAIN | Capability IN, policy mở | Giữ IN; bắt compatibility/impact/confirmation và target evidence | `PRG-COM-002, PRG-COM-004`; `OD-PROG-009, OD-PROG-010` |
| Integrity | Chưa tách nguồn gốc/toàn vẹn | Cryptographic hash IN; trusted-origin signature OUT | `PRG-SEC-002..004` |
| Thay controller | Chưa có feature riêng | Bundle source-only IN; reject artifact/IR/native/cache, build lại target, không auto-activate | `PRG-COM-006` |
| Arbitration | Chưa định nghĩa read model | Program = Local logic mức 5; expose `program_value/actual_value/overridden_by/effective_priority` | `PRG-RT-002, PRG-RT-007`, `PRG-COM-005` |
| Bumpless | Activation giữ old Revision khi lỗi | Hold-last trên đóng góp mức 5; không seed `actual_value`; IOP poll `<200 ms` | `PRG-RT-008`; `OD-PROG-012` |
| Cutover | Graph migration còn mở | `GRAPH_ONLY/PROGRAM_ONLY/DUAL_INVALID`, fail closed, base step độc lập Task period | `PRG-RT-009`; `OD-PROG-012, OD-PROG-013, OD-PROG-014` |
| Overrun | Quan sát được, policy mở | Fault đúng Task; plant safe-state chỉ do SafetyManager condition độc lập; Check cách ly RT | `PRG-RT-006`; `OD-PROG-012` |
| Đồng thời | RBAC/audit | Optimistic concurrency `base_revision`/ETag; không last-write-wins | `PRG-SEC-005`; `OD-PROG-001, OD-PROG-010` |
| Documentation | Không khóa export | Basic Revision metadata IN; full functional/as-built panel/PDF OUT | `PRG-BACS-002` |

### 5.2 Phạm vi feature đề xuất

Feature catalog có 12 Feature Spec. Ba feature mới — bundle thay controller,
cutover và arbitration transparency — **không tạo Product Capability mới**;
chúng phân rã/làm rõ `PC-PROG-001, PC-PROG-002, PC-PROG-009, PC-PROG-011, PC-PROG-012` và giữ trạng thái `IN REVIEW`.

## 6. Lifecycle và ranh giới chủ quản

```text
Draft → Check → Candidate → Đưa vào vận hành → Active/LKG
                              ↘ reject/unknown: giữ LKG
Active → Khôi phục bản trước → LKG tương thích
```

Product sở hữu capability, phạm vi, safety outcome và runtime truth. UX
companion sở hữu IA/layout/copy/journey. Runtime architecture sở hữu base-step,
cutover/resource isolation; Control Semantics sở hữu resolver/hold-last/
anti-windup/IOP rule; IFSPEC sở hữu data meaning và `PRG-ERR-*`; Verification
sở hữu scenario/evidence. Nội dung nơi khác chỉ trỏ tới chủ quản này.

## 7. Traceability và gate

- 41 `PRG-*` và 24 `UX-REQ-*` ở trạng thái `PROPOSED` tại
  [Proposed Requirements](../02_requirements/01_PROPOSED_REQUIREMENTS_V22.md).
- `VS-PROG-001..030` là catalog duy nhất tại
  [Verification Scenarios](../06_verification/01_VERIFICATION_SCENARIOS.md).
- Ma trận hai chiều nằm tại [TRACE-PROG-001](../07_traceability/00_PROGRAMMING_TRACEABILITY_MATRIX.md).
- `VR-PROG-001..013` vẫn `RED`, evidence production `0/13`; G0..G7 vẫn
  `RED/NOT STARTED`.

## 8. Thuật ngữ

Xem [Data Dictionary](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 9. Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Controlled copy của Product authority Active. |
| 2.0 | 2026-08-09 | Giữ 12 PC/14 PR authority; thêm overlay delta v2.2 và quan hệ chủ quản/trace, không supersede. |

## 10. Phê duyệt

| Vai trò | Quyết định | Ghi chú |
|---|---|---|
| Product Owner | `PENDING` | `OD-PROG-015` |
| Software/Runtime Architect | `PENDING` | Base step/cutover/resource isolation |
| Controls/Safety Reviewer | `PENDING` | Arbitration/hold-last/IOP/overrun |
| UX Lead | `PENDING` | UX companion v2.2 |
| Verification Lead | `PENDING` | `VR` 0/13 |
