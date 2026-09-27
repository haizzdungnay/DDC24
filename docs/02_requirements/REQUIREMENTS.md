# System Requirements

**ID:** SYS-REQSET-001
**Trạng thái:** Active
**Cập nhật:** 2026-09-27 (đồng bộ Programming theo ADR-061/profile v2.2). Trước đó: 2026-09-11 (BACnet/IP Rev A)

`Phải` là bắt buộc cho Rev A. Mỗi yêu cầu cần Verification Requirement trong
[Verification](../05_verification/VERIFICATION.md) và ánh xạ tại
[Traceability](../07_records/TRACEABILITY.md).

Product Spec quy định sản phẩm phải làm gì. Tài liệu này quy định từng layer
phải đáp ứng gì; không phân bổ process, API, schema, thư viện hoặc thuật toán.
Những nội dung đó thuộc Programming Design và chưa được thực hiện trong nhiệm
vụ đồng bộ này. Source/test hiện tại chỉ là As-Built và không tự đóng requirement.

## Programming Rev A — yêu cầu theo layer

Nguồn Product Requirement:
[DDC24 Programming Product Spec](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md).
Phạm vi Programming và chu kỳ mới lấy từ `PROD-PROG-001`/ADR-061/profile v2.2;
không dùng nhãn Rev A cũ để giảm phạm vi Product.

| ID | Layer | Yêu cầu / tiêu chí chấp nhận |
|---|---|---|
| SYS-REQ-PROG-001 | System | Hệ thống phải cung cấp Product Programming thống nhất: Project, nhiều PROGRAM, FUNCTION/FUNCTION_BLOCK với ST/FBD, ba loại Point LOCAL/VP/MB_RTU và chu kỳ mới theo ADR-061; phải từ chối LD, SFC, Modbus TCP Point, BACnet/IP Point, motion và safety PLC. |
| SYS-REQ-PROG-002 | System | Hệ thống phải duy trì trạng thái có thẩm quyền, phân biệt Revision, Deployment, Activation, Revision active và Rollback; một trạng thái không được suy diễn thành trạng thái kế tiếp. |
| SYS-REQ-PROG-003 | System | Program active phải tiếp tục control local khi Web/engineering client mất kết nối, trong giới hạn fault policy đã được phê duyệt. |
| SWR-REQ-PROG-001 | Software | Layer Programming phải bảo toàn identity và quan hệ Project → Program → Revision, đồng thời giữ Revision dùng cho Deployment bất biến. |
| SWR-REQ-PROG-002 | Software | Layer Programming phải xác thực và thực thi Program ST theo cùng semantic đã được phê duyệt; lỗi phải có vị trí/mã có thể truy nguyên và phải chặn Deployment. |
| SWR-REQ-PROG-003 | Software | Layer Programming phải xác thực và thực thi Program FBD theo semantic đã được phê duyệt; lỗi block/connection/type phải chặn Deployment. |
| SWR-REQ-PROG-004 | Software | Layer Programming chỉ được expose Local Physical I/O, Virtual Point và Modbus RTU Point cho I/O Mapping; mọi loại Point ngoài allowlist phải bị từ chối. |
| SWR-REQ-PROG-005 | Software | Layer Programming phải phân biệt Point/Variable và xác thực I/O Mapping về identity, direction, type, quyền đọc/ghi, quality và compatibility trước khi tạo Revision deployable. |
| SWR-REQ-PROG-006 | Software | Check mới chỉ nhận chu kỳ 10/50/100/500/1000/5000/10000/50000 ms; runtime base step 10 ms và release từng Program deterministic, quan sát C1–C4. Reader gói cũ 30 s chỉ phục vụ di trú. |
| SWR-REQ-PROG-007 | Software | Tạo/sửa Project hoặc Program phải sinh Revision mới; không được thay đổi nội dung Revision đã dùng cho Deployment. |
| SWR-REQ-PROG-008 | Software | Deployment phải validate trước khi runtime chấp nhận; Activation chỉ xảy ra tại ranh giới cyclic kiểm soát; lỗi phải giữ Revision active trước đó và Rollback phải trả kết quả có thẩm quyền. |
| SWR-REQ-PROG-009 | Software | Layer persistence phải lưu/phục hồi Variable RETAIN theo policy đã phê duyệt và ngăn dùng dữ liệu RETAIN không tương thích với Revision/type hiện tại. |
| SWR-REQ-PROG-010 | Software | Online Monitor phải dùng dữ liệu runtime có thẩm quyền, biểu diễn timestamp/quality/stale/unavailable đúng và không tự cấp quyền write/force/online change. |
| SWR-REQ-PROG-011 | Software/Security | Sửa Project, tạo Revision, Deployment, Activation và Rollback phải kiểm quyền và tạo audit record gồm actor, action, target Revision, time và result. |
| SWR-REQ-PROG-012 | Software | Lỗi validation, runtime, Point quality, cycle overrun hoặc mất client phải có trạng thái quan sát được và không được tạo output không kiểm soát hoặc false-success trên UI. |
| IF-REQ-PROG-001 | Interface | Contract I/O Mapping phải biểu diễn rõ Point identity/category, Variable identity, direction, type, unit/range khi áp dụng, quality và access; Modbus RTU Point phải không thể bị nhầm với Modbus TCP Point. |
| IF-REQ-PROG-002 | Interface | Contract lifecycle/monitor phải trả trạng thái Revision/Deployment/Activation/Rollback và dữ liệu Online Monitor từ authority sở hữu trạng thái, có correlation và error result ổn định. |
| NFR-REQ-PROG-001 | Non-functional | Presentation/client restart hoặc disconnect không được tự làm dừng Program active; reconnect không được blind replay mutation. |
| NFR-REQ-PROG-002 | Non-functional | Trên đúng production target, C1 base step 10 ms, C2 overrun=0, C3 missed release=0 và C4 mọi wake jitter ≤100 µs trong 24 giờ theo ADR-061; phải đo sensor→actuator/fieldbus riêng, không suy từ lịch scan. |

Các ID lịch sử `SYS-REQ-IEC-001`, `SWR-REQ-IEC-001..009`,
`IF-REQ-IEC-001`, `SAFE-REQ-IEC-001` và `NFR-REQ-IEC-001` được supersede bởi
bộ `*-REQ-PROG-*` trên. Chúng không còn là authority cho Programming Rev A vì
trộn Product Requirement với giả định Design/implementation C0–C10.

## Modbus RTU Point — baseline bắt buộc trước Programming Design

Nhóm requirement này phân rã `SYS-REQ-004` và phần Modbus RTU Point của
`SWR-REQ-PROG-004..005`/`IF-REQ-PROG-001`. Requirement quy định nghĩa vụ có thể
kiểm chứng; solution cụ thể nằm trong design `DDD-SW-MBRTU-POINT-001` và chỉ có
hiệu lực sau khi được phê duyệt.

Product Requirement và use case nguồn nằm tại
[PROD-MBRTU-001](../01_product/MODBUS_RTU_PRODUCT_REQUIREMENTS.md). Bộ thiết kế
chi tiết (data model, UI/UX, FE, BE, FW-SOM, API, interface, verification) được
điều hướng tại
[MODBUS_RTU_TRACEABILITY_MATRIX](../07_records/MODBUS_RTU_TRACEABILITY_MATRIX.md).
Toàn bộ hồ sơ đó đang `In Review` và **không** tự đóng requirement nào bên dưới.

| ID | Layer | Yêu cầu / tiêu chí chấp nhận |
|---|---|---|
| SYS-REQ-MBRTU-001 | System | DDC phải hoạt động như Modbus RTU master trên **02 cổng RS485 vật lý của production hardware** (RS485-1: `/dev/rs485-1` → `ttyS5`; RS485-2: `/dev/rs485-2` → `ttyS1` trên Header P16); lỗi bus không được dừng IOP hoặc core control. FW-SOM sử dụng đường link cứng symlinks cố định và n luồng `BusWorker` độc lập. Không hỗ trợ Modbus slave và không đưa Modbus TCP/BACnet/IP Point vào Programming qua requirement này. |
| SWR-REQ-MBRTU-001 | Software | Hệ thống phải có mô hình Bus → Device → Point với identity ổn định. Point phải có `point_id`, `tag_name`, `display_name`, `data_type`, `unit`, `value`, `quality`, `timestamp`, `read_write`, `source`, `default_value`, `safe_value` và device reference; tag unique toàn Local/Virtual/Modbus RTU, rename không đổi Point ID. |
| SWR-REQ-MBRTU-002 | Software | Cấu hình phải hỗ trợ chọn RS485-1/2, baud/parity/stop bit, slave ID 1..247, poll/timeout/retry/stale/offline policy; serial format phải nhất quán trên một bus và slave ID unique trong bus. |
| SWR-REQ-MBRTU-003 | Software | Point phải hỗ trợ Coil, Discrete Input, Input Register, Holding Register; bool/int16/uint16/int32/uint32/float32; byte order, word order, scale, offset và optional engineering min/max; mapping overlap hoặc không biểu diễn được phải bị từ chối. |
| SWR-REQ-MBRTU-004 | Software | Poll scheduler phải độc lập theo bus, bounded, không chặn IOP/core, không làm đói device tốt khi một device lỗi và phải phát hiện cấu hình không đáp ứng tải/poll deadline đã khai báo. |
| SWR-REQ-MBRTU-005 | Software | Runtime phải phân biệt GOOD, STALE, OFFLINE và BAD bằng authority state, giữ timestamp lần sample thành công, có reason code và không trình bày last-known/default value như dữ liệu GOOD mới. |
| SWR-REQ-MBRTU-006 | Software | Ghi chỉ hợp lệ với Coil/Holding Register có `read_write`, đúng active revision/type/range/quality. Kết quả phải có correlation và accepted/applied/rejected/timeout rõ; không blind replay sau reconnect/reboot và không tự ghi `default_value`/`safe_value`. |
| SWR-REQ-MBRTU-007 | Software | Cấu hình phải được validate toàn bộ, lưu bền vững theo revision/checksum và apply atomic. Apply chỉ thành công sau ACK revision/checksum từ iobus; lỗi/crash/power loss phải giữ hoặc phục hồi last-known-good, không tạo cấu hình lai. |
| SWR-REQ-MBRTU-008 | Software | BE/Core phải là source of truth cho metadata và Point Catalog; FE/localStorage không được là authority. CRUD, import/export và commissioning read/write phải dùng cùng validator/policy. |
| SWR-REQ-MBRTU-009 | Software | Phải cung cấp diagnostics thật theo bus/device/point gồm poll success/error, timeout, retry, CRC, exception, consecutive error, last success, sample age, latency, scheduler overrun và config revision; thiếu telemetry phải báo unknown/unavailable. |
| SWR-REQ-MBRTU-010 | Software | Phải cung cấp commissioning có kiểm soát gồm test connection, test read và test write. Ba thao tác này phải trả kết quả giao tiếp **thật** từ authority runtime, không tạo revision cấu hình mới, có rate limit và audit; test write phải có xác nhận tường minh và không được lặp lại tự động. |
| SWR-REQ-MBRTU-011 | Software | Ánh xạ Modbus RTU Point vào Point Database phải được validate về tag unique toàn namespace, identity ổn định và tương thích kiểu dữ liệu. Mapping không hợp lệ phải bị chặn tại điểm lưu, không được lưu rồi báo lỗi ở runtime. |
| NFR-REQ-MBRTU-004 | Non-functional | Phải công bố và kiểm chứng ngân sách vận hành: chu kỳ refresh của client, giới hạn tốc độ write từ giao diện, ngân sách CPU/RAM cho fieldbus trên target, cách tính bus utilization và ngưỡng cảnh báo quá tải RS485. Số chưa đo trên phần cứng thật phải ghi `PROPOSED`, không ghi `VERIFIED`. |
| IF-REQ-MBRTU-001 | Interface | Runtime contract iobus → core → web phải giữ stable `point_id`, data type/giá trị không mất chính xác uint32, quality/reason, producer timestamp, sequence/generation và config revision/checksum; ABI/version mismatch phải fail rõ. |
| IF-REQ-MBRTU-002 | Interface | Config transaction và write command phải dùng bounded/versioned reliable IPC có correlation, timeout, idempotency và peer validation; snapshot telemetry fire-and-forget phải có sequence để phát hiện drop/reorder. |
| IF-REQ-MBRTU-003 | Interface | REST/WebSocket phải trả Point Model canonical và authoritative apply/write result; reconnect lấy snapshot mới trước delta, không blind replay mutation và không suy diễn success/quality ở FE. |
| IF-REQ-MBRTU-004 | Interface | Address lưu trữ/API phải dùng Modbus protocol data address zero-based; UI nếu hiển thị 0xxxx/1xxxx/3xxxx/4xxxx phải chỉ là reference notation, không đổi canonical address. |
| SEC-REQ-MBRTU-001 | Security | Viewer chỉ đọc; Operator được commissioning read; Admin mới được sửa/apply/rollback/import/export và commissioning write. Mọi mutation/write phải audit actor, target Point/revision, correlation, time và result; không có arbitrary function-code endpoint. |
| NFR-REQ-MBRTU-001 | Non-functional | Rev A phải support/verify tối thiểu 16 device trên bus và **tối thiểu 256 Modbus RTU Point tổng** (quyết định Đ-07 ngày 2026-08-04, nâng từ 64); vượt capacity phải reject rõ, không truncate hoặc báo online giả. Việc nâng capacity phải đi kèm đo lại kích thước snapshot IPC và thời gian copy mỗi vòng scan trên target. |
| NFR-REQ-MBRTU-002 | Non-functional | Production acceptance phải chạy trên hai RS485 transceiver/cổng thật, với slave thật hoặc thiết bị kiểm thử độc lập, gồm CRC/timeout/mất dây/reboot/power-cycle/crash/soak; simulator/host chỉ là supporting evidence. |
| NFR-REQ-MBRTU-003 | Non-functional | Binary/config đang chạy phải truy được version, Git commit, build time, checksum, toolchain và active config revision/checksum; deployment contract/ABI phải được nâng cấp đồng bộ và rollback được. |

## BACnet/IP Rev A — yêu cầu theo layer

Nhóm requirement này phân rã `SYS-REQ-004` (dòng duy nhất từng nói về BACnet/IP
trong hồ sơ này) và phủ đủ 19 capability MUST của Rev A.

Product Requirement và use case nguồn nằm tại
[PROD-BACNET-001](../01_product/BACNET_PRODUCT_REQUIREMENTS.md); ma trận
`M-01`…`M-19` → `SYS-REQ-BAC-*` nằm ở §8 của tài liệu đó. Hiện trạng source nằm
tại [BACnet Rev A As-Built Review](../05_verification/BACNET_REV_A_ASBUILT_REVIEW.md)
và **không** tự đóng requirement nào bên dưới. Phạm vi bám `ADR-057`…`ADR-060`
cùng `OD-BAC-003`/`OD-BAC-005`
([BACNET_OPEN_DECISIONS](../00_governance/BACNET_OPEN_DECISIONS.md)).

Theo `ADR-060`, bộ test host **không** là bằng chứng BACnet: không requirement
nào dưới đây được kết luận đạt bằng kết quả chạy trên host.

| ID | Layer | Yêu cầu / tiêu chí chấp nhận |
|---|---|---|
| SYS-REQ-BAC-001 | System | DDC phải hoạt động như BACnet/IP server northbound trên Ethernet với UDP transport thật và port cấu hình được; lỗi BACnet ở mọi mức không được làm dừng core control, IOP hoặc Modbus RTU master. Không được cung cấp BACnet MS/TP và vai trò client/master. |
| SYS-REQ-BAC-002 | System | Thiết bị phải công bố Device Object mang định danh thật gồm Device ID, tên thiết bị và thông tin nhà sản xuất; không được công bố giá trị placeholder như định danh sản phẩm. |
| SYS-REQ-BAC-003 | System | Thiết bị phải trả lời dò tìm của BMS bằng thông báo hiện diện, với cả yêu cầu broadcast và unicast, để BMS nhận dạng được thiết bị mà không cần khai địa chỉ tay. |
| SYS-REQ-BAC-004 | Software | Thiết bị phải phục vụ đọc từng property cho mọi object đang công bố, trả giá trị và metadata lấy từ authority runtime. |
| SYS-REQ-BAC-005 | Software | Thiết bị phải phục vụ đọc nhiều property trong một yêu cầu, cho kết quả nhất quán với đọc từng property; lỗi một phần phải được báo theo từng property, không làm hỏng cả yêu cầu. |
| SYS-REQ-BAC-006 | Software | Thiết bị phải xử lý ghi property lên object commandable sao cho giá trị tới được control path thật, hoặc phải từ chối tường minh bằng mã lỗi BACnet. Nhận lệnh ghi, trả thành công rồi không tác động tới control path phải bị coi là lỗi. Ghi từ BACnet lên biến AV/BV/MSV phải vào arbitration ở priority 3, cùng đường với output AO/BO. |
| SYS-REQ-BAC-007 | Software | Object output commandable phải công bố và cưỡng chế 16 mức ưu tiên lệnh; mức ưu tiên mà thiết bị dùng để phân xử phải là mức mà object công bố ra ngoài, không phải một tập ưu tiên song song không có hiệu lực. |
| SYS-REQ-BAC-008 | Software | Object output commandable phải cho nhả quyền điều khiển ở từng mức ưu tiên và phải trở về hành vi mặc định đã công bố khi không còn lệnh ở mức nào; giá trị mặc định phải quan sát được từ BMS. |
| SYS-REQ-BAC-009 | Software | Object analog và multi-state phải công bố đơn vị đo đúng với đại lượng vật lý của điểm; không được công bố đơn vị suy diễn cho object không mang đơn vị hợp lệ. |
| SYS-REQ-BAC-010 | Software | Mọi object đang công bố phải công bố độ tin cậy của điểm đo được bảo toàn xuyên suốt I/O → SHM → BACnet theo `ADR-011`; thiếu số đo phải báo không xác định, không báo tin cậy. |
| SYS-REQ-BAC-011 | Software | Mọi object đang công bố phải công bố trạng thái điểm và cờ tách khỏi vận hành đủ để BMS phân biệt dữ liệu tốt, dữ liệu lỗi và điểm đang bị tách; trạng thái phải lấy từ authority runtime. |
| SYS-REQ-BAC-012 | Software | Mọi object thiết bị công bố phải có nguồn dữ liệu runtime thật. Object chưa nối nguồn dữ liệu không được công bố; công bố một object luôn trả giá trị khởi tạo là lỗi, không phải giá trị mặc định hợp lệ. |
| SYS-REQ-BAC-013 | Software | Thiết bị phải nhận và quản lý vòng đời đăng ký nhận thông báo thay đổi giá trị từ BMS, gồm chấp nhận, gia hạn, hết hạn và huỷ; đăng ký không được phục vụ phải bị từ chối tường minh. |
| SYS-REQ-BAC-014 | Software | Khi giá trị hoặc trạng thái của object đã có đăng ký thay đổi, thiết bị phải phát thông báo **thành gói tin trên mạng** tới đúng bên đã đăng ký; ghi nhật ký cục bộ không được tính là đã thông báo. |
| SYS-REQ-BAC-015 | Software | Định danh object phải bền vững qua restart tiến trình, power-cycle và đổi tên object; định danh phải được cấp từ identity ổn định của điểm, và thêm/bớt một điểm không được làm dịch định danh của điểm khác. |
| SYS-REQ-BAC-016 | Software | Thiết bị phải cung cấp diagnostics runtime BACnet đủ để phân biệt ba tình trạng liên kết BMS: có giao tiếp, mất giao tiếp và chưa đo được, kèm thời điểm giao tiếp gần nhất. Ngưỡng thời gian xác định mất giao tiếp phải nằm trong cấu hình. Thiếu telemetry phải báo chưa đo được; không được quy về mất giao tiếp và không được suy ra có giao tiếp từ việc mở socket thành công. |
| SYS-REQ-BAC-017 | Software | Cấu hình BACnet gồm Device ID, tên thiết bị và port phải sửa được qua giao diện có phân quyền và phải đọc lại được giá trị **đang chạy thật**; không được trình bày giá trị trong file cấu hình như trạng thái đang chạy. |
| SYS-REQ-BAC-018 | Security | Mọi mutation cấu hình BACnet và mọi lệnh ghi đến từ BMS phải sinh audit record gồm nguồn lệnh, thời điểm, object, giá trị cũ, giá trị mới và kết quả. Sửa cấu hình BACnet phải yêu cầu quyền Admin; đường đọc phải theo đúng phân quyền đọc của sản phẩm. |
| SYS-REQ-BAC-019 | Non-functional | Nghiệm thu BACnet phải chạy trên board thật với BMS hoặc thiết bị kiểm thử BACnet độc lập, gồm đọc/ghi, nhả quyền, thông báo thay đổi giá trị, restart, power-cycle và mất mạng. Bằng chứng chạy trên host hoặc trên interface ảo của máy build không được dùng để kết luận nghiệm thu. |
| SYS-REQ-BAC-020 | System | Phạm vi BACnet Rev A phải loại trừ Alarm/Event Notification, Alarm Acknowledge, Schedule, Calendar, Trend Log, Notification Class và Event Enrollment (`ADR-057`, chuyển V1.1); TimeSync ở cả hai vai trò (`OD-BAC-005`); BACnet MS/TP (`ARCH-R010`); WritePropertyMultiple, Who-Has/I-Have và BBMD/Foreign Device. Hồ sơ năng lực công bố ra ngoài phải khai đúng các mục này là không hỗ trợ ở Rev A. |
| SYS-REQ-BAC-021 | Software | Thiết bị phải cung cấp một đường **chỉ đọc** liệt kê các object đang công bố, trong đó mỗi object nêu rõ **nguồn dữ liệu** của nó — đã nối authority runtime hay chưa. Danh sách liệt kê object như thể mọi object đều có dữ liệu là lỗi. Đường này không được mở thao tác ghi (`ADR-059`). |
| SYS-REQ-BAC-022 | Non-functional | Thang bằng chứng BACnet phải phân biệt ba tầng: chạy trên host (**không tính** là bằng chứng BACnet), chạy `LOOPBACK` với UDP thật trên cùng máy, và chạy `TARGET` trên board thật. Kết quả `LOOPBACK` phải được ghi là `VERIFIED-LOOPBACK` và không được ghi là `VERIFIED`; chỉ bằng chứng `TARGET` mới cho phép ghi `VERIFIED`. Cấu hình build tắt BACnet không được là đường build duy nhất được kiểm (`ADR-060`). |
| SYS-REQ-BAC-023 | Non-functional | Thay đổi tập object BACnet của Rev A phải được thực hiện **một lần** và phải kèm release note nêu rõ đây là breaking change, cùng một bảng object mới xuất ra được để nạp lại cấu hình BMS tại site. Thiếu bảng object xuất được thì không được thi hành thay đổi tập object (`ADR-058`). |

## Yêu cầu product-wide và subsystem khác

| ID | Yêu cầu / tiêu chí chấp nhận | Phương pháp |
|---|---|---|
| SYS-REQ-001 | Thiết bị must tiếp tục control local khi Web UI/client không kết nối. | integration/fault injection |
| SYS-REQ-002 | Base SKU must cung cấp đúng 16 UI + 4 AO + 4 DO; optional DI không được quảng bá như baseline. | inspection + I/O test |
| SYS-REQ-003 | Nếu duy trì component graph 28-node As-Built để tương thích/migration, hệ thống phải phân loại nó là legacy và không quảng bá như FBD hoặc Programming implementation. | inspection + compatibility test |
| SYS-REQ-004 | Baseline giao tiếp toàn sản phẩm phải hỗ trợ BACnet/IP, Modbus TCP và hai Modbus RTU master theo cấu hình; BACnet/IP/Modbus TCP không phải Programming Point Rev A. | protocol test + scope inspection |
| SYS-REQ-005 | HMI được bật theo build/SKU must dùng cùng dữ liệu và quyền điều khiển đã kiểm soát, không thay thế core. | build + integration |
| SWR-REQ-001 | Ba core service must phân tách core, iobus và web; lỗi presentation không được dừng control path. | process fault test |
| SWR-REQ-002 | Graph scan, priority arbitration, interlock và safe-state must deterministic trong giới hạn test được phê duyệt. | timing + unit test |
| SWR-REQ-003 | Config must được validate, ghi bền vững và round-trip không mất field có consumer. | API/config test |
| SWR-REQ-004 | Alarm, trend, schedule, user và commissioning endpoints must yêu cầu auth/role phù hợp. | API/security test |
| SWR-REQ-005 | Network configuration must phân biệt desired/pending với active kernel state; không được báo applied/online chỉ từ file cấu hình hoặc field không rỗng. | unit + integration |
| SWR-REQ-006 | Đổi Ethernet IPv4 must dùng transaction `stage/apply/confirm/rollback`, giữ last-known-good và tự rollback trong tối đa 120 s nếu không confirm hoặc health check thất bại. | fault + target network test |
| SWR-REQ-007 | Đổi IP must không restart `mkddc-core`, không làm dừng IOP/UART scan và phải hot-rebind BACnet/IP rồi phát `I-Am`; Web và Modbus TCP phải phục hồi/reconnect theo interface mới. | multi-process + protocol test |
| IF-REQ-001 | IOP must dùng 921600 baud, poll 2 ms, response timeout 3 ms, tối đa 3 retry và fault threshold 20 ms. | header assertion + HIL |
| IF-REQ-002 | SHM consumers must dùng cùng magic/layout; đổi ABI must đổi magic và rebuild đồng bộ. | compile/layout test |
| IF-REQ-003 | AO must đi qua ranh giới core/iobus bằng V hoặc mA hợp lệ và chỉ scale sang DAC một lần. | boundary test |
| IF-REQ-004 | SOM network authority must cung cấp local versioned/bounded IPC cho `status/validate/stage/apply/confirm/rollback`, kiểm peer credential và trả transaction state/reason code ổn định. | contract + negative test |
| SAFE-REQ-001 | MCU must đưa output về safe behavior nếu không nhận poll hợp lệ trong 200 ms. | HIL fault injection |
| SAFE-REQ-002 | Giá trị output NaN, infinity hoặc ngoài dải must bị từ chối trước khi publish/actuate. | negative test |
| SEC-REQ-001 | API must có authentication, role authorization và audit cho thay đổi cấu hình/force output. | security test |
| SEC-REQ-002 | Secret must không được hard-code; production transport/config must dùng cơ chế bảo vệ được phê duyệt. | review + deployment test |
| SEC-REQ-003 | Network mutation must audit old/new/actor/result và đi qua helper least-privilege; local HMI đặt flow trong surface Service nhưng mutation yêu cầu Admin, Web cho mọi session xác thực đọc authority state nhưng chỉ Admin được validate/stage/apply/confirm/rollback. HMI/Web must không có quyền chạy shell hoặc sửa trực tiếp OS network state. | security + deployment negative test |
| NFR-REQ-001 | Restart từng service must không gây output không kiểm soát; trạng thái lỗi phải quan sát được. | resilience test |
| NFR-REQ-002 | Build release must tái lập được và toàn bộ test bắt buộc phải pass trên target/toolchain được ghi nhận. | CI/release record |
| HW-REQ-001 | Mạch UI must hỗ trợ mode đã công bố, với STM32 là SPI master duy nhất của hai ADS131M08. | schematic review + bench |
| HW-REQ-002 | AO/DO/power/protection must đạt limit đã phê duyệt trước manufacturing release. | calculation + lab evidence |
| HW-REQ-003 | HMI build must nhắm JD9852 MIPI DSI, FT5436 I²C và DRM/KMS `/dev/dri/card0`. | inspection + target test |
| FW-REQ-MCU-001 | MCU must implement IOP v2 parser/serializer và I/O drivers theo `shared/iop_protocol.h`. | host vectors + target protocol/HIL |
| FW-REQ-MCU-002 | MCU must force approved safe outputs nếu không có master traffic hợp lệ trong 200 ms. | target/HIL đo timeout và output |
| HMI-REQ-001 | Local HMI must là presentation/limited-operator/service panel, không phải control hoặc alarm authority; lỗi HMI không được ảnh hưởng core control. | architecture + process fault test |
| HMI-REQ-002 | Base inventory must hiển thị UI16 + AO4 + DO4; DI chỉ xuất hiện khi capability xác nhận. | config + integration |
| HMI-REQ-003 | Alarm must có priority/state/time/source/response; ACK phải authoritative, audited và không clear active condition. | alarm integration + audit |
| HMI-REQ-004 | Service actions must fail-closed theo identity/role, có timeout/audit; reboot chỉ sau core chấp nhận safe states. | security + fault injection |
| HMI-REQ-005 | Unsupported telemetry/action must hiện `unknown/unavailable` hoặc bị disable; không được hiển thị placeholder như trạng thái thật. | negative test |
| HMI-REQ-006 | Visual coding must dùng text/symbol cùng màu, giữ normal trung tính và qua IEC 60073/IEC 62682 design review mà không tuyên bố certification. | inspection + usability test |
| HMI-REQ-007 | Target acceptance must test touch/buttons, glove/light, alarm flood, stale/lost data, localization và recovery trên panel thật. | target usability/FAT |
| HMI-REQ-008 | HMI must có đúng năm surface `Home/Points/Control/Alarms/Service`; communication/system diagnostics phải được giữ trong Home/Service, không tạo full Web/SCADA workflow trên panel. | inspection + usability test |
| HMI-REQ-009 | Control surface must chỉ hiện point được authority đánh dấu commandable; UI/feedback/raw input, PID, mapping, calibration, alarm configuration và safety policy must không sửa được bởi Operator. | policy + negative test |
| HMI-REQ-010 | Setpoint/mode/override/release must đi qua authenticated local broker và core arbitration/interlock/safety; HMI must không ghi command trực tiếp vào SHM hoặc phần cứng. | IPC integration + bypass review |
| HMI-REQ-011 | Override must có value hợp lệ, priority policy, reason, bounded TTL, actor và explicit release; HMI must hiển thị effective source/priority/expiry và authoritative accepted/rejected/expired state. | boundary + lifecycle test |
| HMI-REQ-012 | Operator/Service session must fail closed, có idle expiry tối đa 15 phút và audit login/logout/denial/action; role/PIN plaintext trong `hmi.conf` must không là production identity. | security + audit test |
| HMI-REQ-013 | Khi broker/core/alarm authority unavailable hoặc timeout, mọi mutation must bị disable, pending phải kết thúc bằng lỗi rõ và HMI tiếp tục read-only từ SHM. | fault injection |
| HMI-REQ-014 | Body text must đạt tối thiểu 14 px; touch target hành động must tối thiểu 40×40 px hoặc có thao tác nút cứng tương đương; focus, confirmation và first-input wake suppression phải quan sát được. | inspection + target usability |
| HMI-REQ-015 | Telemetry refresh must ≤1 s; command phải có accepted/rejected/timeout feedback ≤2 s trong điều kiện nominal và duplicate request must không tạo double action. | timing + idempotency test |
| HMI-REQ-016 | Trong surface `Service`, local HMI must cho session hợp lệ xem active/pending Ethernet IPv4; chỉ role Admin được chọn DHCP hoặc nhập static IP/subnet/gateway, xem impact và thực hiện apply/confirm/rollback qua broker. Service là surface, không phải role; không mở rộng thành DNS/Wi-Fi/protocol/full engineering. | policy + target usability test |
| HMI-REQ-017 | Khi đổi IP, local HMI must hiển thị transaction state và rollback countdown; mất broker/network authority phải giữ monitoring read-only, không báo thành công và không blind retry. | fault injection + target test |

Các requirement về chứng nhận chỉ được thêm khi có tiêu chuẩn áp dụng, test plan, acceptance limit và chủ sở hữu bằng chứng.
