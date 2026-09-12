# BACnet/IP — Product Requirements DDC-24 Rev A

**ID:** PROD-BACNET-001
**Phiên bản:** 0.1
**Trạng thái:** In Review (chưa có chữ ký Product Owner)
**Ngày:** 2026-09-11
**Chủ quản đề xuất:** Product Owner + System Engineering / Protocol
**Decision package:** ADR-057, ADR-058, ADR-059, ADR-060 — cả bốn `Accepted 2026-09-10`
([biên bản CTO `DDC24-BACNET-APPROVAL-2026-09-10`](../07_records/reviews/BACNET_REV_A_APPROVAL_RECORD_2026-09-10.md))
**Quyết định đã ký áp dụng vào bản này:** `OD-BAC-001`…`OD-BAC-006`, `OD-BAC-010`,
`OD-BAC-011` (xem [BACNET_OPEN_DECISIONS](../00_governance/BACNET_OPEN_DECISIONS.md))
**Trace ngược:** [PRODUCT.md](PRODUCT.md) `SYS-REQ-004`,
[DECISIONS.md](../00_governance/DECISIONS.md) `ADR-011`, `ADR-057`…`ADR-060`
**Trace xuôi:** [REQUIREMENTS.md §BACnet/IP](../02_requirements/REQUIREMENTS.md),
[PLAN-BACNET-D2C-001](../03_implementation/BACNET_DOC_TO_CODE_E2E_PLAN.md) `T-BAC-004`/`006`/`007`
**Khuôn tham chiếu:** [PROD-MBRTU-001](MODBUS_RTU_PRODUCT_REQUIREMENTS.md) — lặp lại
cấu trúc đã qua một vòng phê duyệt thật, không phát minh cấu trúc mới.

> Tài liệu này quy định **sản phẩm phải làm gì** cho BACnet/IP ở Rev A. Nó không
> phải Design, không phải PICS, không phải Implementation Plan, và **không** chứng
> minh source hiện tại đã đáp ứng. Trạng thái `In Review` nghĩa là chưa có
> authority. Hiện trạng source được ghi ở
> [`REV-BACNET-ASBUILT-001`](../05_verification/BACNET_REV_A_ASBUILT_REVIEW.md);
> theo [`REQUIREMENTS.md`](../02_requirements/REQUIREMENTS.md) quy định chung,
> **As-Built không tự đóng requirement nào** trong tài liệu này.

## 1. Phạm vi

**Trong phạm vi Rev A:** DDC-24 làm BACnet/IP **server (B-ASC)** northbound trên
Ethernet; Device Object; Who-Is/I-Am; ReadProperty; ReadPropertyMultiple;
WriteProperty; Priority_Array 16 mức và Relinquish_Default cho output
commandable; Units; Reliability; Status_Flags/Out_Of_Service; COV subscription
và COV notification qua mạng; identity object bền vững; diagnostics runtime;
cấu hình có read-back trạng thái đang chạy; RBAC/audit cho mọi mutation; catalog
object **chỉ đọc** có nêu nguồn dữ liệu từng object (`ADR-059`); ghi
AV/BV/MSV từ BMS ở **priority 3** đi qua arbitration như AO/BO (`OD-BAC-003`).

**Ngoài phạm vi Rev A:**

| Hạng mục | Quyết định | Ghi chú |
|---|---|---|
| Alarm/Event Notification, Alarm Acknowledge | `ADR-057` | chuyển **V1.1**; PICS Rev A phải khai ❌ |
| Schedule, Calendar | `ADR-057` | chuyển **V1.1**; PICS Rev A phải khai ❌ |
| Trend Log, Notification Class, Event Enrollment | `ADR-057` | chuyển **V1.1**; PICS Rev A phải khai ❌ |
| TimeSync (DM-TS-A và DM-TS-B) | `OD-BAC-005` CLOSED 2026-09-10 | bỏ khỏi Rev A, PICS khai ❌; đồng hồ dùng NTP |
| BACnet MS/TP | `ARCH-R010` CLOSED | RS-485 dành cho Modbus RTU master; **không mở lại** |
| WritePropertyMultiple, Who-Has/I-Have | `REV-BACNET-ASBUILT-001` `O-08`/`O-11` | chưa hiện thực; PICS phải khai đúng hiện trạng |
| BBMD / Foreign Device registration | `REV-BACNET-ASBUILT-001` `O-07` | config struct có field nhưng không có đường chạy; không công bố ở Rev A |
| BTL certification, claim "compliant/certified" | `PRODUCT.md` | ngoài phạm vi sản phẩm |
| BACnet/IP Point trong Programming | `ADR-023` | Programming Rev A chỉ Local I/O, Virtual Point, Modbus RTU Point |

> **Vì sao phạm vi thu hẹp là quyết định, không phải cắt tính năng.** Bốn nhóm
> Alarm/Schedule/Calendar/Trend Log đang được PICS khai ✅ mà không có gì đứng
> sau: Trend Log không có một dòng mã nào, Schedule/Calendar có lớp nhưng không
> object nào được tạo, Alarm là placeholder. `ADR-057` chuyển chúng sang V1.1 —
> giữ lại trong Rev A làm phạm vi phình khoảng 3× mà không đổi được sự thật là
> chúng chưa tồn tại, và làm hồ sơ PICS nói dối tích hợp viên.

## 2. Vai trò người dùng

Rev A giữ đúng ba vai trò của `ADR-021` — `viewer`, `operator`, `admin`. BACnet
**không** thêm vai trò mới. Ngoài ba vai trò người dùng, BACnet có thêm một
actor máy: **BMS/BACnet client** trên mạng, không có phiên đăng nhập Web.

| Actor | Được làm gì với BACnet |
|---|---|
| `viewer` | xem cấu hình BACnet đang chạy, catalog object chỉ đọc, trạng thái liên kết BMS và diagnostics |
| `operator` | như `viewer`; **không** được sửa cấu hình BACnet |
| `admin` | thêm: sửa Device ID/Device Name/port/cấu hình object set, apply và rollback |
| BMS/BACnet client | đọc property trong catalog đã công bố; ghi property của object commandable ở đúng priority BACnet được phép |

| Hành động | Viewer | Operator | Admin | BMS client |
|---|:--:|:--:|:--:|:--:|
| Xem cấu hình/catalog/diagnostics BACnet | ✔ | ✔ | ✔ | ✖ |
| Sửa Device ID, Device Name, UDP port | ✖ | ✖ | ✔ | ✖ |
| Sửa tập object công bố | ✖ | ✖ | ✔ | ✖ |
| Apply/Rollback cấu hình BACnet | ✖ | ✖ | ✔ | ✖ |
| ReadProperty / ReadPropertyMultiple | ✖ | ✖ | ✖ | ✔ |
| WriteProperty lên object commandable | ✖ | ✖ | ✖ | ✔ |
| Ghi qua Web lên object BACnet | ✖ | ✖ | ✖ | ✖ |

Không actor nào được cấp đường ghi trực tiếp xuống phần cứng bỏ qua arbitration
của core, và catalog object **không** mở đường ghi (`ADR-059`).

## 3. Product Capability

| ID | Capability | Ghi chú phạm vi |
|---|---|---|
| PC-BAC-01 | DDC là BACnet/IP **server** northbound trên Ethernet, UDP, port cấu hình được | không làm BACnet client/master, không MS/TP |
| PC-BAC-02 | Device Object có identity thật: Device ID, Object_Name, Vendor_Identifier, Vendor_Name | |
| PC-BAC-03 | Device discovery: Who-Is/I-Am, broadcast và unicast | |
| PC-BAC-04 | Đọc property: ReadProperty và ReadPropertyMultiple | |
| PC-BAC-05 | Ghi property: WriteProperty cho object commandable, có arbitration và priority | AV/BV/MSV ở priority 3 (`OD-BAC-003`) |
| PC-BAC-06 | Command arbitration BACnet: Priority_Array 16 mức + Relinquish_Default | |
| PC-BAC-07 | Metadata điểm đo: Units, Reliability, Status_Flags, Out_Of_Service | `ADR-011` |
| PC-BAC-08 | Change of Value: subscription và notification thật qua mạng | |
| PC-BAC-09 | Identity object bền vững qua restart, cấp từ `pointStableId` | `ADR-058` |
| PC-BAC-10 | Catalog object **chỉ đọc** cho tích hợp viên, có nêu nguồn dữ liệu từng object | `ADR-059` |
| PC-BAC-11 | Diagnostics runtime BACnet: trạng thái liên kết BMS, hoạt động giao thức | `OD-BAC-004` |
| PC-BAC-12 | Cấu hình BACnet có read-back trạng thái đang chạy thật | |
| PC-BAC-13 | RBAC và audit cho mọi mutation, kể cả mutation đến từ BMS | |
| PC-BAC-14 | Nghiệm thu trên board thật với BMS/thiết bị kiểm thử độc lập | `ADR-060` |

## 4. Product Requirement

| ID | Yêu cầu sản phẩm | Nguồn / ràng buộc |
|---|---|---|
| PR-BAC-001 | Sản phẩm phải cho BMS giao tiếp được với DDC-24 qua BACnet/IP trên mạng Ethernet thật, không cần công cụ riêng của Mekong. | PC-BAC-01 |
| PR-BAC-002 | BMS phải nhận dạng được thiết bị bằng Device Object có thông tin định danh thật; không được công bố giá trị placeholder như thông tin nhà sản xuất. | PC-BAC-02 |
| PR-BAC-003 | Thiết bị phải tự công bố sự hiện diện để BMS dò tìm được mà không cần cấu hình tay từng địa chỉ. | PC-BAC-03 |
| PR-BAC-004 | BMS phải đọc được giá trị và metadata của mọi object mà sản phẩm công bố, theo từng property và theo lô. | PC-BAC-04 |
| PR-BAC-005 | **Mọi object sản phẩm công bố phải có nguồn dữ liệu thật.** Một object chưa nối vào dữ liệu runtime thì **không được công bố**; công bố một object luôn trả giá trị khởi tạo là bằng chứng giả đối với tích hợp viên. | PC-BAC-04, `G-01` |
| PR-BAC-006 | BMS phải ghi được xuống object commandable; lệnh ghi phải tới được control path thật hoặc **bị từ chối tường minh**. Nhận lệnh rồi bỏ qua trong im lặng là lỗi báo-thành-công-sai và bị cấm. | PC-BAC-05, `OD-BAC-003` |
| PR-BAC-007 | Lệnh ghi từ BMS phải đi qua cùng arbitration với mọi nguồn lệnh khác, ở mức ưu tiên đã công bố; BMS không được vượt quyền nguồn lệnh có ưu tiên cao hơn. | PC-BAC-06, `ADR-012` |
| PR-BAC-008 | BMS phải nhả được quyền điều khiển và sản phẩm phải trở về hành vi mặc định đã công bố khi không còn lệnh ở mức ưu tiên nào. | PC-BAC-06 |
| PR-BAC-009 | Object analog và binary phải công bố đơn vị, độ tin cậy và trạng thái của điểm đo đủ để BMS phân biệt dữ liệu tốt, dữ liệu lỗi và điểm đang bị tách khỏi vận hành. | PC-BAC-07, `ADR-011` |
| PR-BAC-010 | BMS phải đăng ký được thông báo thay đổi giá trị và **thực sự nhận được gói tin** khi giá trị đổi; ghi nhật ký cục bộ không thay cho gửi thông báo. | PC-BAC-08, `G-04`, `G-05` |
| PR-BAC-011 | Định danh object phải bền vững qua restart, power-cycle và thay đổi tên; cấu hình BMS đã nạp không được tự hỏng sau khi nâng cấp phần mềm. | PC-BAC-09, `ADR-058` |
| PR-BAC-012 | Thay đổi tập object của Rev A là **breaking change một lần**; phải kèm release note nêu rõ và công cụ xuất bảng object mới để field service nạp lại cấu hình BMS. | PC-BAC-09, `ADR-058` |
| PR-BAC-013 | Tích hợp viên phải tự tra được danh sách object đang công bố **kèm nguồn dữ liệu từng object** trước khi ra site, bằng đường chỉ đọc. Không mở đường ghi. | PC-BAC-10, `ADR-059` |
| PR-BAC-014 | Người dùng phải phân biệt được ba tình trạng của liên kết BMS: có giao tiếp, mất giao tiếp và chưa đo được. Đèn xanh chỉ vì socket mở thành công là trạng thái sai. | PC-BAC-11, `OD-BAC-004` |
| PR-BAC-015 | Người có quyền phải sửa được Device ID, Device Name và port BACnet bằng Web UI và phải đọc lại được **giá trị đang chạy thật**, không phải giá trị trong file cấu hình. | PC-BAC-12 |
| PR-BAC-016 | Đổi cấu hình mạng hoặc cấu hình BACnet không được làm dừng control local; BACnet phải tự gắn lại và tự công bố lại trên interface mới. | PC-BAC-12, `SWR-REQ-007` |
| PR-BAC-017 | Mọi mutation cấu hình BACnet và mọi lệnh ghi đến từ BMS phải truy được: ai/cái gì làm, lúc nào, trên object nào, giá trị cũ và mới, kết quả. | PC-BAC-13 |
| PR-BAC-018 | Lỗi BACnet ở mọi mức không được làm dừng core controller, IOP hoặc Modbus RTU master. | PC-BAC-01, `PR-MBRTU-011` |
| PR-BAC-019 | Sản phẩm chỉ được tuyên bố một capability BACnet là đã nghiệm thu khi có bằng chứng trên **board thật**; bộ test host không phải bằng chứng BACnet. | PC-BAC-14, `ADR-060` |
| PR-BAC-020 | Hồ sơ PICS phải phản ánh đúng hiện trạng đã kiểm: mọi BIBB khai ✅ phải có bằng chứng chỉ tới được; bốn nhóm chuyển V1.1 và TimeSync phải khai ❌. | `ADR-057`, `OD-BAC-005`, `G-09` |

## 5. Use Case

Ký hiệu vai trò: `V` Viewer, `O` Operator, `A` Admin, `B` BMS/BACnet client.

| ID | Use case | Vai trò tối thiểu | Kết quả mong đợi | Trace |
|---|---|---|---|---|
| UC-BAC-001 | BMS dò tìm thiết bị trên mạng | B | thiết bị trả lời I-Am với Device ID đúng, cả broadcast và unicast | PR-BAC-003 |
| UC-BAC-002 | BMS đọc thông tin định danh thiết bị | B | Device Object trả định danh thật, không placeholder | PR-BAC-002 |
| UC-BAC-003 | BMS đọc một property | B | giá trị đúng nguồn runtime kèm metadata | PR-BAC-004, PR-BAC-005 |
| UC-BAC-004 | BMS đọc nhiều property trong một request | B | kết quả nhất quán với đọc đơn lẻ | PR-BAC-004 |
| UC-BAC-005 | BMS ghi xuống output commandable (AO/BO) | B | lệnh tới control path, có ưu tiên, readback phản ánh kết quả thật | PR-BAC-006, PR-BAC-007 |
| UC-BAC-006 | BMS ghi xuống AV/BV/MSV | B | giá trị tới core ở priority 3 qua arbitration, **hoặc** bị từ chối tường minh | PR-BAC-006, `OD-BAC-003` |
| UC-BAC-007 | BMS nhả quyền điều khiển một output | B | output trở về mức ưu tiên còn lại hoặc hành vi mặc định đã công bố | PR-BAC-008 |
| UC-BAC-008 | BMS đọc đơn vị và độ tin cậy của điểm đo | B | Units/Reliability/Status_Flags phản ánh trạng thái thật của điểm | PR-BAC-009 |
| UC-BAC-009 | BMS đăng ký nhận thay đổi giá trị | B | subscription được chấp nhận và có vòng đời quan sát được | PR-BAC-010 |
| UC-BAC-010 | BMS nhận thông báo khi giá trị đổi | B | gói tin notification thật tới BMS trong giới hạn đã công bố | PR-BAC-010 |
| UC-BAC-011 | Object identity giữ nguyên sau power-cycle | B | mọi object instance khớp 100% trước/sau; đổi tên không đổi instance | PR-BAC-011 |
| UC-BAC-012 | Field service nạp lại cấu hình BMS sau breaking change | A | có bảng object xuất ra được và release note nêu rõ thay đổi | PR-BAC-012 |
| UC-BAC-013 | Tích hợp viên tra catalog object trước khi ra site | V | danh sách object kèm nguồn dữ liệu từng object, chỉ đọc | PR-BAC-013 |
| UC-BAC-014 | Vận hành theo dõi liên kết BMS | V | ba trạng thái phân biệt được, có thời điểm giao tiếp gần nhất | PR-BAC-014 |
| UC-BAC-015 | Admin đổi Device ID / Device Name / port | A | apply thành công và read-back là giá trị đang chạy thật | PR-BAC-015 |
| UC-BAC-016 | Đổi IP thiết bị trong khi BMS đang kết nối | A | control local không dừng; BACnet gắn lại và công bố lại | PR-BAC-016 |
| UC-BAC-017 | Truy vết một lệnh ghi từ BMS | A | audit record đủ actor/thời điểm/object/giá trị cũ-mới/kết quả | PR-BAC-017 |
| UC-BAC-018 | Xử lý lỗi BACnet khi BMS gửi request sai | B/V | thiết bị trả mã lỗi BACnet đúng, không crash, control không dừng | PR-BAC-018 |
| UC-BAC-019 | Nghiệm thu BACnet trên board thật | A | bằng chứng `TARGET` với BMS hoặc thiết bị kiểm thử độc lập | PR-BAC-019 |
| UC-BAC-020 | Tích hợp viên đọc PICS để lập kế hoạch tích hợp | B | mọi claim ✅ có bằng chứng; hạng mục V1.1 khai ❌ | PR-BAC-020 |

### 5.1 Luồng chính UC-BAC-006 (BMS ghi AV/BV/MSV)

1. BMS gửi WriteProperty lên `Present_Value` của một AV/BV/MSV đang công bố.
2. Sản phẩm kiểm object có commandable và BMS có được phép ghi object đó.
3. Nếu **được phép**: giá trị vào arbitration ở **priority 3**, cùng đường với
   lệnh AO/BO; kết quả điều khiển do arbitration quyết định.
4. Nếu **không được phép**: sản phẩm trả lỗi BACnet từ chối ghi. **Cấm** nhận
   lệnh, trả thành công rồi không làm gì (`OD-BAC-003`).
5. Readback `Present_Value` phải phản ánh trạng thái thật sau arbitration, không
   phản ánh giá trị BMS vừa gửi nếu giá trị đó không thắng.
6. Audit ghi nguồn lệnh là BMS, địa chỉ peer, object, giá trị cũ/mới, kết quả.

Trường hợp ngoại lệ bắt buộc xử lý: object không commandable, object chưa nối
nguồn dữ liệu, giá trị ngoài dải, priority không được phép, core không phản hồi,
và mất liên kết BMS giữa bước 1 và 5.

## 6. Ràng buộc sản phẩm

| Ràng buộc | Giá trị | Trạng thái bằng chứng |
|---|---|---|
| Vai trò BACnet | server/B-ASC northbound duy nhất | Active theo `ARCH-R010` |
| Transport | BACnet/IP trên Ethernet, UDP; **không** MS/TP | Active theo `ARCH-R010`, không mở lại |
| Ưu tiên ghi từ BACnet | priority **3** cho AV/BV/MSV, qua arbitration như AO/BO | `OD-BAC-003` CLOSED 2026-09-10; chưa có bằng chứng `TARGET` |
| Ngưỡng liên kết BMS | `N = 90 s` không có giao tiếp ⇒ mất liên kết; ngưỡng nằm trong cấu hình, **không** hardcode | `OD-BAC-004` CLOSED 2026-09-10; **phải đo lại** sau HIL nếu chu kỳ poll BMS thật > 30 s |
| Nguồn cấp object instance | `pointStableId`, bền qua restart | `ADR-058`; kèm điều kiện release note + công cụ xuất bảng object |
| BI ở base SKU | **bỏ** 8 BI không có phần cứng | `ADR-058`; `G-06`. Mở lại quyết định nếu đã có site nhận bàn giao chính thức |
| Object không có nguồn dữ liệu | **không được công bố** | `G-01`; hiện trạng As-Built là 64/88 object chưa bao giờ được nạp dữ liệu |
| Thang bằng chứng | bộ test host **không tính**; thêm tầng `LOOPBACK`; chỉ bằng chứng `TARGET` mới cho phép kết luận nghiệm thu | `ADR-060` CLOSED `OD-BAC-010`; thi hành phụ thuộc `OD-BAC-009` (`PENDING-HUMAN`) |
| Catalog object | chỉ đọc, RBAC như mọi đường đọc khác, phải nêu nguồn dữ liệu từng object | `ADR-059`, đảo quyết định 2026-08-20 |
| Alarm/Schedule/Calendar/Trend Log | **V1.1**, PICS Rev A khai ❌ | `ADR-057` |
| TimeSync | **ngoài** Rev A, PICS khai ❌, xoá mã chết | `OD-BAC-005` CLOSED 2026-09-10 |
| BTL certification | ngoài phạm vi; không dùng từ "compliant/certified" | `PRODUCT.md` |

## 7. Gate sản phẩm

```text
BACNET_PRODUCT_SCOPE_DEFINED    = YES  (tài liệu này)
BACNET_USE_CASES_DEFINED        = YES  (§5, 20 use case)
BACNET_PRODUCT_APPROVED         = NO   (chờ Product Owner ký tài liệu này)
BACNET_PRODUCT_IMPLEMENTED      = NO   (REV-BACNET-ASBUILT-001: M-12/M-13/M-19 NOT IMPLEMENTED, M-14 PLACEHOLDER)
BACNET_REV_A_READY              = NO   (giữ nguyên kết luận biên bản 2026-09-10)
```

Biên bản `DDC24-BACNET-APPROVAL-2026-09-10` mở `BACNET_REV_A_DOC_TRACK_APPROVED
= YES`, nhưng `BUILD_TRACK` còn bị chặn bởi `OD-BAC-009` (egress/mirror) và
`VERIFY_TRACK` bị chặn bởi `OD-BAC-007` (thiết bị + người). Cả hai là **mã
nguồn lực chưa có chữ ký người**, không phải quyết định kỹ thuật — tài liệu này
không mở được chúng.

Yêu cầu sản phẩm **chưa** được đáp ứng ở Rev A, theo dõi tường minh:

| Mã | Yêu cầu chưa đáp ứng | Vì sao | Theo dõi tại |
|---|---|---|---|
| `G-01` | `PR-BAC-005` (mọi object công bố phải có nguồn dữ liệu) | 64/88 object đăng ký nhưng không bao giờ được nạp dữ liệu | `REV-BACNET-ASBUILT-001` `G-01`; `T-BAC-004` |
| `G-03` | `PR-BAC-006` phần AV/BV/MSV | WriteProperty nhận nhưng không tới core | `OD-BAC-003` CLOSED; thi hành ở Wave sau |
| `G-02` | `PR-BAC-007`, `PR-BAC-008` | Priority_Array/Relinquish của dự án nằm trên đường chết | `REV-BACNET-ASBUILT-001` `G-02` |
| `G-04` | `PR-BAC-010` phần subscription | không đăng ký handler SubscribeCOV | `REV-BACNET-ASBUILT-001` `G-04` |
| `G-05` | `PR-BAC-010` phần notification | notification là nhật ký cục bộ, không phải gói tin | `REV-BACNET-ASBUILT-001` `G-05` |
| `G-08` | `PR-BAC-014` | chưa có telemetry runtime; trạng thái liên kết suy diễn từ bind | `OD-BAC-004` CLOSED; thi hành ở Wave sau |
| `G-11` | `PR-BAC-019` | bằng chứng "target" hiện chạy trên host | `ADR-060`; chặn bởi `OD-BAC-007` (`PENDING-HUMAN`) |
| `G-09` | `PR-BAC-020` | PICS đang là wishlist: 9/14 BIBB khai ✅ sai | `T-BAC-001`, `T-BAC-002` |

## 8. Ma trận phủ 19 capability MUST của Rev A

Nguồn cột trái: [`REV-BACNET-ASBUILT-001`](../05_verification/BACNET_REV_A_ASBUILT_REVIEW.md)
§2.1. **Mỗi mục `M-01`…`M-19` ánh xạ tới ít nhất một `SYS-REQ-BAC-xxx`** ở
[REQUIREMENTS.md](../02_requirements/REQUIREMENTS.md). Cột trạng thái là hiện
trạng As-Built, **không** phải kết luận nghiệm thu: theo `ADR-060`, bằng chứng
chạy trên host không tính là bằng chứng BACnet.

| MUST | Capability | Product Requirement | System Requirement | Hiện trạng As-Built |
|---|---|---|---|---|
| M-01 | BACnet/IP server, UDP transport thật | PR-BAC-001 | SYS-REQ-BAC-001 | IMPLEMENTED, chỉ có bằng chứng host ⇒ không tính |
| M-02 | Device Object | PR-BAC-002 | SYS-REQ-BAC-002 | PARTIAL — Vendor_Identifier còn placeholder |
| M-03 | Who-Is / I-Am | PR-BAC-003 | SYS-REQ-BAC-003 | IMPLEMENTED, chỉ có bằng chứng host ⇒ không tính |
| M-04 | ReadProperty | PR-BAC-004 | SYS-REQ-BAC-004 | PARTIAL — chỉ AI/BI có dữ liệu thật |
| M-05 | ReadPropertyMultiple | PR-BAC-004 | SYS-REQ-BAC-005 | PARTIAL — cùng lý do M-04 |
| M-06 | WriteProperty | PR-BAC-006 | SYS-REQ-BAC-006 | PARTIAL — AV/BV/MSV không tới core (`G-03`) |
| M-07 | AO/BO Priority_Array[16] | PR-BAC-007 | SYS-REQ-BAC-007 | PARTIAL — priority của dự án bị bỏ qua (`G-02`) |
| M-08 | Relinquish_Default | PR-BAC-008 | SYS-REQ-BAC-008 | PARTIAL — logic nằm trên đường chết (`G-02`) |
| M-09 | Units | PR-BAC-009 | SYS-REQ-BAC-009 | IMPLEMENTED cho AI/AO; BI/AV/BV/MSV chưa đẩy |
| M-10 | Reliability | PR-BAC-009 | SYS-REQ-BAC-010 | IMPLEMENTED cho AI/BI; object khác chưa sync (`G-01`) |
| M-11 | Status_Flags / Out_Of_Service | PR-BAC-009 | SYS-REQ-BAC-011 | PARTIAL — chỉ AI/BI được đẩy sang stack |
| M-12 | Present_Value thật cho mọi object | PR-BAC-005 | SYS-REQ-BAC-012 | **NOT IMPLEMENTED** (AV/BV/MSV), PARTIAL (AO/BO) — `G-01` |
| M-13 | COV subscription qua mạng | PR-BAC-010 | SYS-REQ-BAC-013 | **NOT IMPLEMENTED** — `G-04` |
| M-14 | COV notification thật qua mạng | PR-BAC-010 | SYS-REQ-BAC-014 | **PLACEHOLDER** — `G-05` |
| M-15 | Stable BACnet Object Identity | PR-BAC-011, PR-BAC-012 | SYS-REQ-BAC-015 | PARTIAL — instance ổn định nhưng không capability-gate (`G-06`) |
| M-16 | Runtime diagnostics | PR-BAC-014 | SYS-REQ-BAC-016 | PARTIAL — chỉ 2 trường telemetry (`G-08`) |
| M-17 | Configuration + runtime read-back | PR-BAC-015, PR-BAC-016 | SYS-REQ-BAC-017 | PARTIAL — chỉ port có read-back |
| M-18 | RBAC / audit với mutation | PR-BAC-017 | SYS-REQ-BAC-018 | IMPLEMENTED ở Web, PARTIAL ở BACnet |
| M-19 | Target/HIL verification | PR-BAC-019 | SYS-REQ-BAC-019 | **NOT IMPLEMENTED** — `G-11`, bằng chứng hiện chạy trên host |

Bốn `SYS-REQ-BAC-*` còn lại không ánh xạ một mục MUST nào mà ràng buộc cách làm
việc với cả 19 mục: `SYS-REQ-BAC-020` (loại trừ phạm vi theo `ADR-057`,
`OD-BAC-005`, `ARCH-R010`), `SYS-REQ-BAC-021` (catalog chỉ đọc, `ADR-059`),
`SYS-REQ-BAC-022` (thang bằng chứng, `ADR-060`) và `SYS-REQ-BAC-023` (breaking
change object set một lần, `ADR-058`).

## 9. Trace, rủi ro và sign-off

**Chuỗi trace end-to-end:**

```text
PRODUCT.md SYS-REQ-004
  → PROD-BACNET-001 (PC-BAC-* → PR-BAC-* → UC-BAC-*)   ← tài liệu này
    → REQUIREMENTS.md SYS-REQ-BAC-001..023
      → BACNET_ARCHITECTURE_DESIGN        (T-BAC-004, chưa tạo)
        → BACNET_VV_ACCEPTANCE_SPEC       (T-BAC-006, chưa tạo)
          → BACNET_TRACEABILITY_MATRIX    (T-BAC-007, chưa tạo)
```

Ba tài liệu cuối chuỗi **chưa tồn tại**; chúng khai `Dep: 003` trong
[`PLAN-BACNET-D2C-001`](../03_implementation/BACNET_DOC_TO_CODE_E2E_PLAN.md)
§3 (bảng Wave W0) và đứng sau tài liệu này. Hồ sơ PICS
[`BACNET_PICS_EPICS_MK-DDC-24_VI`](../02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md)
được `T-BAC-001`/`T-BAC-002` sửa theo `PR-BAC-020`; tài liệu này **không** sửa PICS.

**Rủi ro và residual:**

| Mã | Rủi ro | Ảnh hưởng | Gate / điều kiện mở khoá | Owner |
|---|---|---|---|---|
| `RSK-BAC-P-01` | Phạm vi Rev A thu hẹp theo `ADR-057` nhưng tài liệu bán hàng/PICS chưa đồng bộ ⇒ tích hợp viên vẫn kỳ vọng Schedule/Trend Log | cam kết sai với khách | `T-BAC-001`, `T-BAC-002` xong; PICS khai ❌ bốn nhóm | Product Owner |
| `RSK-BAC-P-02` | `ADR-058` là breaking change tập object; thiếu công cụ xuất bảng object thì chi phí chuyển sang field service | rework tại site | `PR-BAC-012`: release note + công cụ xuất bảng object trước khi thi hành `ADR-058` | Product + Field Service |
| `RSK-BAC-P-03` | Không có bằng chứng `TARGET` nào ⇒ không capability BACnet nào được kết luận nghiệm thu | release NO-GO kéo dài | `OD-BAC-007` (thiết bị + người) có chữ ký; sau đó HIL theo `T-BAC-006` | CTO + QA |
| `RSK-BAC-P-04` | Ngưỡng liên kết BMS `N = 90 s` là số chốt để implement được, chưa đo trên site thật | báo mất/còn liên kết sai | đo lại sau `T-BAC-064` (HIL); nếu chu kỳ poll BMS > 30 s thì `N = 3×` chu kỳ đo được, ghi vào release record | Product + Ops |

**TBD còn mở trong tài liệu này:** không có mục `TBD` mới. Bốn rủi ro trên đều
có owner, ảnh hưởng, gate và điều kiện mở khoá.

**Bảng ký:**

| Vai | Người | Trạng thái | Ngày |
|---|---|---|---|
| Soạn | System Engineering / Protocol | Đã soạn | 2026-09-11 |
| Review nội dung | CTO | Quyết định kỹ thuật đã ký ở `DDC24-BACNET-APPROVAL-2026-09-10` | 2026-09-10 |
| Phê duyệt | Product Owner | **Chưa ký** — `BACNET_PRODUCT_APPROVED = NO` | — |

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-09-11 | In Review | Tạo Product Requirement BACnet/IP Rev A: 14 capability, 20 product requirement, 20 use case, ma trận phủ đủ 19 mục MUST của `REV-BACNET-ASBUILT-001` §2.1, phạm vi bám `ADR-057`…`ADR-060` + `OD-BAC-003`/`OD-BAC-005`. Đóng `G-10` (không có requirement spec cho BACnet) ở phần tài liệu sản phẩm |
