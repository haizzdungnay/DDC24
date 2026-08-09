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

## 8. Amendment A1 — Định vị cạnh tranh và lớp user journey (đề xuất, chờ ký)

> **Trạng thái amendment:** `PROPOSED — chờ Product Owner ký`. Mục 8 và 9 là đề
> xuất của nhóm liên chức năng ngày 2026-08-09. Chúng **chưa** thay đổi baseline
> `Active` ở mục 1–7 và **không** tự mở gate nào. Quyết định phê duyệt được theo
> dõi tại [`OD-PROG-016`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md).
> Bộ thiết kế downstream đã được viết theo amendment này để review; nếu Product
> Owner từ chối, downstream phải quay lại IA sáu trang.

### 8.1 Định vị: MK-DDC-24 không cạnh tranh bằng độ rộng

MK-DDC-24 là sản phẩm của một hãng nhỏ. Cố đuổi theo độ rộng của CODESYS hay
TwinCAT là cách chắc chắn thua: họ có hàng chục sản phẩm engineering và nhiều
thập kỷ thư viện. Định vị được chọn:

> **Công cụ Programming trên Web, đủ dùng cho ứng dụng HVAC/BACS trên một
> controller, mà kỹ thuật viên BMS học được trong một buổi.**

Bốn trụ cột cạnh tranh, xếp theo thứ tự ưu tiên:

1. **An toàn khi đưa vào vận hành.** Đây là chỗ MK-DDC-24 chọn để **vượt**, chứ
   không chỉ bằng: Draft/Revision tách bạch, Check không đụng chương trình đang
   chạy, Commission atomic có đọc ngược từ authority, LKG, và timeout chuyển
   `UNKNOWN/RECONCILING` thay vì gửi lại lệnh.
2. **Ít khái niệm phải nhớ.** Bốn workspace, tám journey, một Task, ba chu kỳ,
   ba loại Point. Không bắt kỹ thuật viên BMS học IR, ABI, artifact hay WCET để
   làm việc thường ngày.
3. **Chạy trên Web.** Không có desktop tool nặng, không cài Visual Studio, không
   license engineering riêng cho từng tính năng.
4. **Ngôn ngữ ngành BMS.** “Kiểm tra”, “Đưa vào vận hành”, “Điểm”, chứ không
   phải “Build”, “Download”, “Boot application”.

### 8.2 Benchmark có nguồn chính thức

Ngày truy cập toàn bộ nguồn: **2026-08-09**.

| Sản phẩm | Nguồn chính thức | Sự kiện được ghi nhận |
|---|---|---|
| CODESYS Development System | [codesys.com/products/engineering/development-system](https://www.codesys.com/products/engineering/development-system/), [us.codesys.com/products/engineering](https://us.codesys.com/products/engineering/), [Professional Developer Edition](https://us.codesys.com/products/engineering/professional-developer-edition/) | Hỗ trợ toàn bộ editor IEC 61131-3 (FBD, LD, IL, ST, SFC); OOP theo 61131-3 ấn bản 3; bảo vệ mã nguồn bằng certificate/dongle/password; Professional Developer Edition thêm Git/SVN, Static Analysis, Profiler, Test Manager, UML |
| CODESYS 4 / CODESYS go! | [codesys-4](https://us.codesys.com/products/engineering/codesys-4/), [codesys-go](https://us.codesys.com/products/engineering/codesys-go/) | Hãng đang đưa engineering lên nền web ở thế hệ kế tiếp — hướng đi này trùng với lựa chọn Web của MK-DDC-24, nên lợi thế “chạy trên Web” **có thời hạn** |
| Siemens Desigo ABT Site / ABT Go | [Desigo Automation Building Tool](https://sid.siemens.com/r/A6V11602351/22505934987__V6.3_en-US_13225203467), [Desigo for high-performing buildings](https://www.siemens.com/en-us/products/desigo/high-performing-buildings/) | ABT Site là công cụ engineering cho Desigo, làm cả cập nhật firmware và sao lưu/khôi phục cấu hình thiết bị; ABT Go là công cụ **di động** cho commissioning và bảo trì, hỗ trợ thiết bị BACnet/IP, có chẩn đoán và mô phỏng; luồng điển hình là engineering bằng ABT Site, cân chỉnh bằng ABT Go |
| Schneider EcoStruxure Building Operation WorkStation | [EcoStruxure Building Operation Software](https://www.se.com/us/en/product-range/62111-ecostruxure-building-operation-software/), [WorkStation — Building Management WebHelp](https://ecostruxure-building-help.se.com/bms/topics/show.castle?id=8064&locale=en-US&productversion=2.0) | Môi trường đầy đủ để vận hành **và** quản trị: graphics, alarm, schedule, trend log, report; đóng gói kèm Graphic Editor, Script Editor, Menta Editor, Function Block Editor và WorkPlace Tech Editor; Device Discovery tự tạo thiết bị tương ứng trong BMS |
| Beckhoff TwinCAT 3 Engineering | [TExxxx TwinCAT 3 Engineering](https://www.beckhoff.com/en-us/products/automation/twincat/texxxx-twincat-3-engineering/), [eXtended Automation Engineering XAE](https://infosys.beckhoff.com/content/1033/tc3_overview/4275768971.html) | XAE lập trình và cấu hình phần cứng trong một công cụ; ngoài IEC 61131-3 còn có C/C++, MATLAB và Simulink; môi trường phát triển là Microsoft Visual Studio; khu vực Engineering chứa khoảng **25 sản phẩm** riêng |

### 8.3 Bảng điểm heuristic

**Đây là chấm điểm heuristic của nhóm liên chức năng dựa trên tài liệu chính
thức, không phải kết quả usability test.** Không có người dùng thật nào được
quan sát để tạo ra các con số dưới đây. Đối thủ được chấm trong **phạm vi hẹp**:
“một kỹ thuật viên BMS làm một ứng dụng điều khiển HVAC trên một controller”, chứ
không phải toàn bộ năng lực sản phẩm của họ.

Cách tính: mỗi tiêu chí chấm `0..5`, điểm có trọng số `= (điểm/5) × trọng số`.

| Tiêu chí | Trọng số | MK-DDC hiện tại | MK-DDC mục tiêu | CODESYS | Desigo ABT | EBO WorkStation | TwinCAT 3 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Luồng chính dễ hiểu | 20 | 3,5 → 14,0 | **4,5 → 18,0** | 2,5 → 10,0 | 4,0 → 16,0 | 3,0 → 12,0 | 2,0 → 8,0 |
| Edit → Check → Commission liền mạch | 15 | 3,5 → 10,5 | **4,5 → 13,5** | 3,5 → 10,5 | 4,0 → 12,0 | 3,5 → 10,5 | 3,5 → 10,5 |
| Editor, library và tái sử dụng | 15 | 3,0 → 9,0 | **3,5 → 10,5** | 5,0 → 15,0 | 4,0 → 12,0 | 4,5 → 13,5 | 5,0 → 15,0 |
| Point/I/O mapping | 10 | 4,0 → 8,0 | **4,5 → 9,0** | 3,0 → 6,0 | 4,5 → 9,0 | 4,5 → 9,0 | 3,0 → 6,0 |
| Diagnostic và sửa lỗi | 10 | 4,0 → 8,0 | **4,5 → 9,0** | 4,5 → 9,0 | 4,0 → 8,0 | 3,5 → 7,0 | 5,0 → 10,0 |
| Commission, read-back và rollback an toàn | 15 | 5,0 → 15,0 | **5,0 → 15,0** | 3,0 → 9,0 | 4,0 → 12,0 | 3,5 → 10,5 | 3,0 → 9,0 |
| Runtime monitor/trace | 10 | 4,0 → 8,0 | **4,0 → 8,0** | 4,5 → 9,0 | 4,0 → 8,0 | 4,5 → 9,0 | 4,5 → 9,0 |
| Role, mobile và accessibility | 5 | 3,5 → 3,5 | **4,0 → 4,0** | 2,0 → 2,0 | 4,0 → 4,0 | 3,5 → 3,5 | 1,5 → 1,5 |
| **Tổng** | **100** | **76,0** | **87,0** | **70,5** | **81,0** | **75,0** | **69,0** |

Kiểm điều kiện mục tiêu: tổng `87,0 ≥ 85` ✔; mental model và luồng chính
`4,5 ≥ 4` ✔; Commission/rollback safety `5,0` ✔; tiêu chí thấp nhất là “Editor,
library và tái sử dụng” `3,5`, không có tiêu chí nào dưới `3,5` ✔; không tiêu
chí safety nào bị giảm để đổi lấy ít click hơn ✔.

### 8.4 Lý do của từng điểm

| Tiêu chí | Vì sao MK-DDC hiện tại ở mức đó | Vì sao mục tiêu cao hơn | Vì sao đối thủ cao/thấp |
|---|---|---|---|
| Luồng chính | Mental model Draft/Active rất rõ, nhưng thiết kế một AHU phải nhảy qua ba trang PGM-02, PGM-03, PGM-04 và nhớ 17 use case | Gộp về bốn workspace và tám journey; “thiết kế” là **một** nơi | CODESYS và TwinCAT là IDE PLC tổng quát, độ dốc học rất cao với kỹ thuật viên BMS; Desigo nói đúng ngôn ngữ ngành nên cao nhất trong nhóm đối thủ |
| Edit → Check → Commission | Có đủ ba bước nhưng Check rải ở ba trang, người dùng không biết bấm ở đâu | Check và Commission về cùng một workspace `PGM-03`, một primary action mỗi trạng thái | Desigo mạch lạc nhưng phải dùng **hai công cụ** ABT Site và ABT Go; CODESYS/TwinCAT dùng khái niệm PLC (download, boot application) xa lạ với BMS |
| Editor và thư viện | ST + FBD structured + Core Library, User FB chỉ trong Project; **chưa có** template AHU/pump/valve | Chỉ tăng nhẹ: FBD thành lối vào ưu tiên. Template BMS **chưa được duyệt** nên không tính điểm — xem [`OD-PROG-017`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) | Đây là chỗ MK-DDC **chấp nhận thua**: CODESYS và TwinCAT có toàn bộ 5 ngôn ngữ IEC, OOP, C/C++, MATLAB/Simulink; EBO có năm editor đóng gói sẵn |
| Point mapping | Đã mạnh: identity canonical, ba category, quality xuyên suốt, binding sai chặn Commission | Mapping nằm ngay trong workspace Thiết kế, lọc theo loại/hướng/khả năng ghi | Desigo và EBO mạnh nhờ BACnet-native và Device Discovery; CODESYS/TwinCAT hướng fieldbus, không point-centric kiểu BMS |
| Diagnostic | Problems drawer, lỗi trỏ đúng dòng/node/binding, tách khỏi Alarm | Problems truy cập được từ cả tab Chương trình và tab Điểm | TwinCAT cao nhất nhờ debug tích hợp; CODESYS có Static Analysis, Profiler, Test Manager |
| Commission an toàn | **Điểm mạnh nhất.** Atomic, đọc ngược từ authority, LKG, `UNKNOWN/RECONCILING`, xác nhận có re-auth, giữ giá trị cũ khi tráo | Giữ nguyên `5/5`, chỉ đổi cách trình bày xác nhận theo rủi ro thực tế | Không đối thủ nào trong nhóm tài liệu hóa một giao dịch activation atomic có đọc ngược và LKG ở mức chi tiết tương đương; Desigo có sao lưu/khôi phục cấu hình thiết bị nên cao nhất trong nhóm |
| Runtime monitor | Tách `program_value`/`actual_value`, owner, priority, TTL, trace có giới hạn | Không tăng — đã đủ cho Rev A | EBO mạnh nhờ trend log và report; CODESYS/TwinCAT mạnh nhờ trace và profiler |
| Role, mobile, a11y | RBAC ở server, FBD hoàn tất được bằng bàn phím, VI/EN, mobile chỉ đọc | Viewer không còn thấy hàng loạt nút bị vô hiệu hóa | ABT Go là công cụ di động thật nên Desigo cao; TwinCAT chạy trong Visual Studio trên Windows nên thấp nhất |

### 8.5 Học gì và không làm gì

| Học từ đối thủ | Vì sao phù hợp MK-DDC-24 |
|---|---|
| Device Discovery của EBO | Không bắt người dùng gõ lại thứ hệ thống đã biết. Áp dụng ở mức Point catalog: lọc sẵn theo loại, hướng và khả năng ghi thay vì để người dùng tự tìm |
| ABT Go làm việc trên di động | Xác nhận lựa chọn “mobile để xem và thao tác nhẹ”, không ép authoring FBD đầy đủ trên điện thoại |
| Backup/restore cấu hình thiết bị của ABT Site | Củng cố yêu cầu sao lưu **có kiểm chứng** trước Commission trong Runbook |
| Thư viện ứng dụng HVAC của Desigo | Là hướng tăng trưởng đúng cho một hãng nhỏ — nhưng phải qua quyết định, xem `OD-PROG-017` |

| **Không** làm ở Rev A | Vì sao |
|---|---|
| Đủ 5 ngôn ngữ IEC (thêm LD, IL, SFC) | Ba ngôn ngữ nữa nhân ba chi phí compiler, test và tài liệu, trong khi ứng dụng HVAC một controller không cần |
| OOP theo 61131-3 ấn bản 3 | Vượt xa nhu cầu BACS Rev A; kéo theo hệ kiểu và IR phức tạp hơn nhiều |
| C/C++, MATLAB, Simulink | Ngoài định vị; tạo bề mặt an toàn và chuỗi cung ứng mà hãng nhỏ không kham nổi |
| Motion, safety PLC, redundancy | Đã nằm ngoài phạm vi Rev A ở mục 3.3; amendment này không mở rộng |
| Công cụ desktop riêng hoặc phụ thuộc IDE bên thứ ba | Mâu thuẫn trực tiếp với trụ cột “chạy trên Web”; TwinCAT phải kéo theo Visual Studio là ví dụ cần tránh |
| Công cụ di động thứ hai kiểu ABT Go | Hai công cụ là hai bộ mã, hai chu kỳ phát hành. Web responsive đáp ứng đủ nhu cầu xem và thao tác nhẹ |
| Trình soạn graphics/scheduling/report trong Programming | Đã có module khác trong MK-DDC-24; Programming chỉ liên kết tới entity canonical |

### 8.6 Must / Should / Won't cho Rev A

| Mức | Nội dung |
|---|---|
| **Must** | Bốn workspace `PGM-01..04`; tám journey `UJ-PROG-01..08`; giữ nguyên toàn bộ hành vi an toàn ở mục 6 và `PR-PROG-006..013`; FBD là lối vào ưu tiên; Point catalog có lọc theo loại/hướng/khả năng ghi; lỗi trỏ đúng node/dòng/pin/binding; tiếng Việt mặc định; trạng thái luôn có chữ và biểu tượng |
| **Should** | Xác nhận theo rủi ro thực tế thay vì danh sách bốn ô cố định; viewer chỉ thấy hành động phù hợp thay vì hàng loạt nút bị vô hiệu hóa; mobile phục vụ tổng quan, runtime và thao tác nhẹ |
| **Won't (Rev A)** | Thư viện mẫu AHU/pump/fan/valve/PID (chờ `OD-PROG-017`); công cụ di động riêng; ngôn ngữ IEC thứ ba trở đi; OOP; C/C++/MATLAB; graphics/report editor trong Programming |

## 9. Amendment A1 — Lớp user journey `UJ-PROG-01..08`

Lớp này thay 17 use case rời rạc bằng tám journey theo đúng thứ tự công việc
thực tế. **Không** tái sử dụng ID cũ với nghĩa mới: `UC-PROG-*` vẫn tồn tại và
được gắn trạng thái `MERGED`, `SCENARIO` hoặc `ROADMAP`, xem
[UI/UX Design](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) §6.1.

Mental model bắt buộc:

```text
Thiết kế → Ánh xạ → Kiểm tra → Đưa vào vận hành → Theo dõi → Khôi phục
```

| ID | User journey | Kết quả người dùng | Workspace | Product Requirement |
|---|---|---|---|---|
| `UJ-PROG-01` | Xem trạng thái ứng dụng | Biết cái gì đang chạy, bản nào đang sửa và vấn đề cần chú ý | `PGM-01` | PR-PROG-011, PR-PROG-012 |
| `UJ-PROG-02` | Tạo hoặc sửa chương trình | Sửa metadata, ST hoặc FBD trong một workspace | `PGM-02` | PR-PROG-001, PR-PROG-002 |
| `UJ-PROG-03` | Ánh xạ Variable–Point | Hoàn tất binding hợp lệ với Point thật | `PGM-02` | PR-PROG-003, PR-PROG-004 |
| `UJ-PROG-04` | Cấu hình thực thi | Chọn chu kỳ Task và thứ tự Program | `PGM-02` | PR-PROG-005 |
| `UJ-PROG-05` | Kiểm tra và sửa lỗi | Có kết quả Check, focus đúng lỗi và sửa lại | `PGM-03` | PR-PROG-006 |
| `UJ-PROG-06` | Đưa vào vận hành | Review impact, xác nhận, Commission và đọc ngược | `PGM-03` | PR-PROG-007, PR-PROG-008, PR-PROG-009 |
| `UJ-PROG-07` | Theo dõi và chẩn đoán | Xem runtime, actual/program value, owner, overrun và trace | `PGM-04` | PR-PROG-010, PR-PROG-011 |
| `UJ-PROG-08` | Bảo trì và phục hồi | Restore, replacement/import và xác nhận runtime sau phục hồi | `PGM-04` | PR-PROG-009, PR-PROG-013 |

Ba tình huống xuyên suốt **không** phải journey riêng, nhưng bắt buộc phải có
requirement và scenario ở mọi journey liên quan: Core suy giảm hoặc không kết
nối được; Check hoặc Commission thất bại trong khi bản đang chạy vẫn chạy; và
RETAIN không tương thích khi Commission.

### 9.1 Điều kiện phê duyệt amendment

Amendment A1 chỉ chuyển từ `PROPOSED` sang `Active` khi Product Owner ký
`OD-PROG-016`, và khi bộ thiết kế downstream đã đồng bộ xong bốn workspace, tám
journey, ma trận migration 17 use case, và traceability không còn link mồ côi.
