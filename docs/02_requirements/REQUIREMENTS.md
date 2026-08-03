# System Requirements

**ID:** SYS-REQSET-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-03 (thêm requirement Modbus RTU Point trước Programming Design)

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
Phạm vi Programming chỉ gồm Local Physical I/O, Virtual Point, Modbus RTU
Point, ST, FBD và cycle time 1 s/5 s/30 s.

| ID | Layer | Yêu cầu / tiêu chí chấp nhận |
|---|---|---|
| SYS-REQ-PROG-001 | System | Hệ thống phải cung cấp đúng phạm vi Programming Rev A: Project/Program với ST và FBD, ba loại Point được phép và ba cycle time được phép; phải từ chối LD, SFC, Modbus TCP Point, BACnet/IP Point, motion và safety PLC. |
| SYS-REQ-PROG-002 | System | Hệ thống phải duy trì trạng thái có thẩm quyền, phân biệt Revision, Deployment, Activation, Revision active và Rollback; một trạng thái không được suy diễn thành trạng thái kế tiếp. |
| SYS-REQ-PROG-003 | System | Program active phải tiếp tục control local khi Web/engineering client mất kết nối, trong giới hạn fault policy đã được phê duyệt. |
| SWR-REQ-PROG-001 | Software | Layer Programming phải bảo toàn identity và quan hệ Project → Program → Revision, đồng thời giữ Revision dùng cho Deployment bất biến. |
| SWR-REQ-PROG-002 | Software | Layer Programming phải xác thực và thực thi Program ST theo cùng semantic đã được phê duyệt; lỗi phải có vị trí/mã có thể truy nguyên và phải chặn Deployment. |
| SWR-REQ-PROG-003 | Software | Layer Programming phải xác thực và thực thi Program FBD theo semantic đã được phê duyệt; lỗi block/connection/type phải chặn Deployment. |
| SWR-REQ-PROG-004 | Software | Layer Programming chỉ được expose Local Physical I/O, Virtual Point và Modbus RTU Point cho I/O Mapping; mọi loại Point ngoài allowlist phải bị từ chối. |
| SWR-REQ-PROG-005 | Software | Layer Programming phải phân biệt Point/Variable và xác thực I/O Mapping về identity, direction, type, quyền đọc/ghi, quality và compatibility trước khi tạo Revision deployable. |
| SWR-REQ-PROG-006 | Software | Scheduler Programming chỉ được nhận cycle time 1 s, 5 s hoặc 30 s; phải chạy deterministic theo rule đã phê duyệt và quan sát được cycle/overrun/fault. |
| SWR-REQ-PROG-007 | Software | Tạo/sửa Project hoặc Program phải sinh Revision mới; không được thay đổi nội dung Revision đã dùng cho Deployment. |
| SWR-REQ-PROG-008 | Software | Deployment phải validate trước khi runtime chấp nhận; Activation chỉ xảy ra tại ranh giới cyclic kiểm soát; lỗi phải giữ Revision active trước đó và Rollback phải trả kết quả có thẩm quyền. |
| SWR-REQ-PROG-009 | Software | Layer persistence phải lưu/phục hồi Variable RETAIN theo policy đã phê duyệt và ngăn dùng dữ liệu RETAIN không tương thích với Revision/type hiện tại. |
| SWR-REQ-PROG-010 | Software | Online Monitor phải dùng dữ liệu runtime có thẩm quyền, biểu diễn timestamp/quality/stale/unavailable đúng và không tự cấp quyền write/force/online change. |
| SWR-REQ-PROG-011 | Software/Security | Sửa Project, tạo Revision, Deployment, Activation và Rollback phải kiểm quyền và tạo audit record gồm actor, action, target Revision, time và result. |
| SWR-REQ-PROG-012 | Software | Lỗi validation, runtime, Point quality, cycle overrun hoặc mất client phải có trạng thái quan sát được và không được tạo output không kiểm soát hoặc false-success trên UI. |
| IF-REQ-PROG-001 | Interface | Contract I/O Mapping phải biểu diễn rõ Point identity/category, Variable identity, direction, type, unit/range khi áp dụng, quality và access; Modbus RTU Point phải không thể bị nhầm với Modbus TCP Point. |
| IF-REQ-PROG-002 | Interface | Contract lifecycle/monitor phải trả trạng thái Revision/Deployment/Activation/Rollback và dữ liệu Online Monitor từ authority sở hữu trạng thái, có correlation và error result ổn định. |
| NFR-REQ-PROG-001 | Non-functional | Presentation/client restart hoặc disconnect không được tự làm dừng Program active; reconnect không được blind replay mutation. |
| NFR-REQ-PROG-002 | Non-functional | Runtime phải đáp ứng budget được phê duyệt cho cycle 1 s/5 s/30 s trên production target và phải phát hiện/báo overrun; budget cụ thể thuộc OD-PROG-012. |

Các ID lịch sử `SYS-REQ-IEC-001`, `SWR-REQ-IEC-001..009`,
`IF-REQ-IEC-001`, `SAFE-REQ-IEC-001` và `NFR-REQ-IEC-001` được supersede bởi
bộ `*-REQ-PROG-*` trên. Chúng không còn là authority cho Programming Rev A vì
trộn Product Requirement với giả định Design/implementation C0–C10.

## Modbus RTU Point — baseline bắt buộc trước Programming Design

Nhóm requirement này phân rã `SYS-REQ-004` và phần Modbus RTU Point của
`SWR-REQ-PROG-004..005`/`IF-REQ-PROG-001`. Requirement quy định nghĩa vụ có thể
kiểm chứng; solution cụ thể nằm trong design `DDD-SW-MBRTU-POINT-001` và chỉ có
hiệu lực sau khi được phê duyệt.

| ID | Layer | Yêu cầu / tiêu chí chấp nhận |
|---|---|---|
| SYS-REQ-MBRTU-001 | System | DDC phải hoạt động như Modbus RTU master trên đúng hai cổng logic RS485-1/RS485-2 của production hardware; lỗi một bus không được dừng bus còn lại, IOP hoặc core control. Không hỗ trợ Modbus slave và không đưa Modbus TCP/BACnet/IP Point vào Programming qua requirement này. |
| SWR-REQ-MBRTU-001 | Software | Hệ thống phải có mô hình Bus → Device → Point với identity ổn định. Point phải có `point_id`, `tag_name`, `display_name`, `data_type`, `unit`, `value`, `quality`, `timestamp`, `read_write`, `source`, `default_value`, `safe_value` và device reference; tag unique toàn Local/Virtual/Modbus RTU, rename không đổi Point ID. |
| SWR-REQ-MBRTU-002 | Software | Cấu hình phải hỗ trợ chọn RS485-1/2, baud/parity/stop bit, slave ID 1..247, poll/timeout/retry/stale/offline policy; serial format phải nhất quán trên một bus và slave ID unique trong bus. |
| SWR-REQ-MBRTU-003 | Software | Point phải hỗ trợ Coil, Discrete Input, Input Register, Holding Register; bool/int16/uint16/int32/uint32/float32; byte order, word order, scale, offset và optional engineering min/max; mapping overlap hoặc không biểu diễn được phải bị từ chối. |
| SWR-REQ-MBRTU-004 | Software | Poll scheduler phải độc lập theo bus, bounded, không chặn IOP/core, không làm đói device tốt khi một device lỗi và phải phát hiện cấu hình không đáp ứng tải/poll deadline đã khai báo. |
| SWR-REQ-MBRTU-005 | Software | Runtime phải phân biệt GOOD, STALE, OFFLINE và BAD bằng authority state, giữ timestamp lần sample thành công, có reason code và không trình bày last-known/default value như dữ liệu GOOD mới. |
| SWR-REQ-MBRTU-006 | Software | Ghi chỉ hợp lệ với Coil/Holding Register có `read_write`, đúng active revision/type/range/quality. Kết quả phải có correlation và accepted/applied/rejected/timeout rõ; không blind replay sau reconnect/reboot và không tự ghi `default_value`/`safe_value`. |
| SWR-REQ-MBRTU-007 | Software | Cấu hình phải được validate toàn bộ, lưu bền vững theo revision/checksum và apply atomic. Apply chỉ thành công sau ACK revision/checksum từ iobus; lỗi/crash/power loss phải giữ hoặc phục hồi last-known-good, không tạo cấu hình lai. |
| SWR-REQ-MBRTU-008 | Software | BE/Core phải là source of truth cho metadata và Point Catalog; FE/localStorage không được là authority. CRUD, import/export và commissioning read/write phải dùng cùng validator/policy. |
| SWR-REQ-MBRTU-009 | Software | Phải cung cấp diagnostics thật theo bus/device/point gồm poll success/error, timeout, retry, CRC, exception, consecutive error, last success, sample age, latency, scheduler overrun và config revision; thiếu telemetry phải báo unknown/unavailable. |
| IF-REQ-MBRTU-001 | Interface | Runtime contract iobus → core → web phải giữ stable `point_id`, data type/giá trị không mất chính xác uint32, quality/reason, producer timestamp, sequence/generation và config revision/checksum; ABI/version mismatch phải fail rõ. |
| IF-REQ-MBRTU-002 | Interface | Config transaction và write command phải dùng bounded/versioned reliable IPC có correlation, timeout, idempotency và peer validation; snapshot telemetry fire-and-forget phải có sequence để phát hiện drop/reorder. |
| IF-REQ-MBRTU-003 | Interface | REST/WebSocket phải trả Point Model canonical và authoritative apply/write result; reconnect lấy snapshot mới trước delta, không blind replay mutation và không suy diễn success/quality ở FE. |
| IF-REQ-MBRTU-004 | Interface | Address lưu trữ/API phải dùng Modbus protocol data address zero-based; UI nếu hiển thị 0xxxx/1xxxx/3xxxx/4xxxx phải chỉ là reference notation, không đổi canonical address. |
| SEC-REQ-MBRTU-001 | Security | Viewer chỉ đọc; Operator được commissioning read; Admin mới được sửa/apply/rollback/import/export và commissioning write. Mọi mutation/write phải audit actor, target Point/revision, correlation, time và result; không có arbitrary function-code endpoint. |
| NFR-REQ-MBRTU-001 | Non-functional | Rev A phải support/verify 16 device mỗi bus, tối đa 32 tổng và 64 Modbus RTU Point tổng; vượt capacity phải reject rõ, không truncate hoặc báo online giả. |
| NFR-REQ-MBRTU-002 | Non-functional | Production acceptance phải chạy trên hai RS485 transceiver/cổng thật, với slave thật hoặc thiết bị kiểm thử độc lập, gồm CRC/timeout/mất dây/reboot/power-cycle/crash/soak; simulator/host chỉ là supporting evidence. |
| NFR-REQ-MBRTU-003 | Non-functional | Binary/config đang chạy phải truy được version, Git commit, build time, checksum, toolchain và active config revision/checksum; deployment contract/ABI phải được nâng cấp đồng bộ và rollback được. |

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
