# Product Spec Programming DDC-24 Rev A

**ID:** PROD-PROG-001
**Revision:** A
**Trạng thái:** Active
**Chủ quản:** Product
**Ngày hiệu lực:** 2026-08-03
**Quyết định phạm vi:** [ADR-023](../00_governance/DECISIONS.md)
**Quyết định còn mở:** [PROGRAMMING_OPEN_DECISIONS.md](../00_governance/PROGRAMMING_OPEN_DECISIONS.md)

## 1. Mục đích và ranh giới tài liệu

Tài liệu này là Product Spec: quy định sản phẩm Programming DDC-24 Rev A phải
làm được gì và giới hạn cam kết sản phẩm. Tài liệu không quy định kiến trúc,
API, schema lưu trữ, thuật toán, thư viện, process, package hoặc kế hoạch triển
khai.

Các lớp hồ sơ được phân biệt như sau:

| Lớp | Câu hỏi được trả lời | Nguồn chủ quản |
|---|---|---|
| Product Spec | Sản phẩm phải làm được gì? | Tài liệu này và `PRODUCT.md` |
| Requirement | Từng layer phải đáp ứng gì để hiện thực Product Spec? | `REQUIREMENTS.md` |
| Design | Hệ thống sẽ hiện thực requirement bằng cách nào? | Chưa thực hiện trong nhiệm vụ đồng bộ này |
| As-Built | Source/deployment hiện tại thực sự có gì và đã có bằng chứng gì? | Source đã kiểm chứng và hồ sơ audit/evidence riêng |

Việc một source file, prototype hoặc host unit test tồn tại không chứng minh
capability Programming đã được implement. Product Spec này không đưa ra tuyên
bố implementation hoặc release readiness.

## 2. Thuật ngữ chuẩn hóa

Các thuật ngữ dưới đây là normative trong hồ sơ Programming Rev A:

| Thuật ngữ | Định nghĩa sản phẩm |
|---|---|
| **Project** | Container kỹ thuật chứa một hoặc nhiều Program, khai báo Point, Variable, I/O Mapping và lịch sử Revision liên quan. |
| **Program** | Đơn vị logic điều khiển có thể được xác thực và chạy cyclic; Rev A hỗ trợ Program viết bằng ST hoặc FBD. |
| **Point** | Đối tượng dữ liệu đại diện cho giá trị ở ranh giới Programming với I/O hoặc không gian point của bộ điều khiển; có định danh và trạng thái chất lượng. |
| **Variable** | Dữ liệu có tên được Program dùng nội bộ; Variable không mặc nhiên là Point. |
| **Modbus RTU Point** | Point ánh xạ tới đối tượng dữ liệu của thiết bị Modbus RTU qua một cấu hình hợp lệ; không bao gồm Modbus TCP. |
| **I/O Mapping** | Quan hệ được xác thực giữa Variable của Program và Point được phép đọc hoặc ghi. |
| **Revision** | Phiên bản bất biến của Project/Program và cấu hình liên quan dùng cho truy nguyên, Deployment và Rollback. |
| **Deployment** | Thao tác chuyển một Revision đã xác thực tới môi trường runtime; Deployment chưa đồng nghĩa Revision đang chạy. |
| **Activation** | Thao tác chuyển có kiểm soát để một Revision đã Deployment trở thành Revision đang chạy. |
| **Rollback** | Thao tác quay về một Revision đã biết và còn tương thích khi Activation mới thất bại hoặc bị hủy. |
| **RETAIN** | Thuộc tính của Variable yêu cầu bảo toàn giá trị qua các điều kiện restart được phê duyệt; ranh giới warm/cold restart và power cycle còn là quyết định mở. |
| **Online Monitor** | Khả năng quan sát có thẩm quyền trạng thái runtime, Revision active, Program, Variable và Point mà không tự tạo quyền ghi/force hoặc online change. |

Các từ `build`, `deploy`, `activate` không được dùng thay thế lẫn nhau. “Online
Monitor” không đồng nghĩa “online change”.

## 3. Phạm vi Product Spec Rev A

### 3.1 Phạm vi chức năng đóng

Programming Rev A chỉ gồm:

- Local Physical I/O;
- Virtual Point;
- Modbus RTU Point;
- Structured Text (ST);
- Function Block Diagram (FBD);
- Cycle time 1 giây, 5 giây và 30 giây.

Không có loại Point, ngôn ngữ hoặc cycle time nào khác trong scope.

### 3.2 Hành vi hỗ trợ xuyên suốt

Project, Program, Point, Variable, I/O Mapping, Revision, Deployment,
Activation, Rollback, RETAIN và Online Monitor là các khái niệm vòng đời/runtime
cần thiết để sử dụng và kiểm chứng đúng sáu hạng mục chức năng đóng ở mục 3.1.
Chúng không mở rộng thêm protocol, ngôn ngữ, loại Point, motion hoặc safety PLC.

### 3.3 Ngoài phạm vi

Programming Rev A không bao gồm:

- Modbus TCP Point hoặc dùng Modbus TCP làm nguồn Point cho Program;
- BACnet/IP Point hoặc dùng BACnet/IP làm nguồn Point cho Program;
- Ladder Diagram (LD);
- Sequential Function Chart (SFC);
- motion control;
- safety PLC, safety runtime hoặc tuyên bố functional-safety PLC;
- online change;
- tuyên bố `IEC 61131-3 compliant`, `certified` hoặc tương đương khi chưa có
  chương trình đánh giá và bằng chứng được phê duyệt.

Modbus TCP và BACnet/IP có thể tồn tại ở baseline giao tiếp toàn sản phẩm, nhưng
không vì vậy trở thành Programming Point trong Rev A.

## 4. Product Capability

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
| PC-PROG-010 | Bảo toàn Variable được đánh dấu RETAIN theo chính sách đã phê duyệt. |
| PC-PROG-011 | Quan sát Program, Variable và Point qua Online Monitor. |
| PC-PROG-012 | Giữ đúng ranh giới Programming Rev A và từ chối capability ngoài phạm vi. |

## 5. Product Requirement

| ID | Product Requirement |
|---|---|
| PR-PROG-001 | Sản phẩm phải cho phép người dùng có quyền tạo, mở, sửa và lưu Project chứa một hoặc nhiều Program mà không làm mất quan hệ truy nguyên. |
| PR-PROG-002 | Sản phẩm phải hỗ trợ Program ST và Program FBD như hai ngôn ngữ Programming Rev A; lỗi xác thực phải được trả về rõ ràng trước Deployment. |
| PR-PROG-003 | Sản phẩm chỉ được cung cấp ba loại Point cho I/O Mapping Programming Rev A: Local Physical I/O, Virtual Point và Modbus RTU Point. |
| PR-PROG-004 | Sản phẩm phải phân biệt Point với Variable và phải xác thực direction, type, quyền đọc/ghi và trạng thái chất lượng tại I/O Mapping. |
| PR-PROG-005 | Với Program chạy cyclic, sản phẩm chỉ được cung cấp lựa chọn cycle time 1 s, 5 s hoặc 30 s và phải hiển thị lựa chọn đang áp dụng. |
| PR-PROG-006 | Revision có lỗi cú pháp, semantic, I/O Mapping hoặc điều kiện xác thực bắt buộc không được Deployment hoặc Activation. |
| PR-PROG-007 | Mỗi Revision dùng cho Deployment phải bất biến và có định danh truy nguyên tới Project, Program và actor tạo Revision. |
| PR-PROG-008 | Deployment phải có trạng thái có thẩm quyền và không được tự báo thành công khi runtime chưa chấp nhận artifact tương ứng. |
| PR-PROG-009 | Activation phải diễn ra tại ranh giới cyclic được kiểm soát; lỗi Activation phải giữ Revision đang chạy trước đó. Rollback phải quay về Revision tương thích đã biết. |
| PR-PROG-010 | Variable được đánh dấu RETAIN phải được phục hồi đúng theo chính sách restart đã phê duyệt; Variable không RETAIN không được mặc nhiên dùng dữ liệu cũ. |
| PR-PROG-011 | Online Monitor phải hiển thị dữ liệu runtime có nguồn và độ mới rõ ràng, gồm Revision active, trạng thái Program, Variable và Point; dữ liệu stale/unavailable không được trình bày như dữ liệu live. |
| PR-PROG-012 | Program active phải tiếp tục chạy local khi Web/engineering client mất kết nối; lỗi ở presentation không được tự làm dừng control path. |
| PR-PROG-013 | Thao tác sửa Project, tạo Revision, Deployment, Activation và Rollback phải được phân quyền và audit; tên role cụ thể tuân theo quyết định RBAC được phê duyệt. |
| PR-PROG-014 | Sản phẩm phải từ chối LD, SFC, Modbus TCP Point, BACnet/IP Point và capability motion/safety PLC trong Programming Rev A; không được gắn nhãn các capability này là đã hỗ trợ. |

## 6. Hành vi vòng đời sản phẩm

Vòng đời tối thiểu được quan sát bởi người dùng là:

```text
Project/Program đang chỉnh sửa
  → Revision đã xác thực
  → Deployment được runtime chấp nhận
  → Activation tại ranh giới cyclic
  → Revision active
  → Rollback về Revision đã biết khi cần
```

- Tạo Revision không đồng nghĩa Deployment.
- Deployment không đồng nghĩa Activation.
- Activation thất bại không được xóa hoặc thay thế Revision active trước đó.
- Mọi trạng thái hiển thị phải đến từ authority sở hữu trạng thái đó; UI không
  được suy diễn thành công từ việc request đã được gửi.
- Online Monitor là đường quan sát. Quyền force/write, nếu có trong sản phẩm
  khác, không được suy ra từ capability này.

## 7. Tiêu chí hoàn tất Product Spec

Product Spec Rev A được xem là documented khi:

1. toàn bộ capability trong mục 4 có Product Requirement tương ứng;
2. từng Product Requirement có System Requirement và Verification Requirement
   trong [Programming Traceability Matrix](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md);
3. mọi vấn đề chưa quyết định được ghi tại
   [Programming Open Decisions](../00_governance/PROGRAMMING_OPEN_DECISIONS.md);
4. không có claim Programming đã implement hoặc đã đạt runtime production.

Việc thỏa tiêu chí tài liệu không tự đóng release gate, không thay thế Product
approval và không phải bằng chứng As-Built.
