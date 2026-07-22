# System Requirements

**ID:** SYS-REQSET-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-22

`Must` là bắt buộc cho Rev A.0. Mỗi yêu cầu cần bằng chứng trong [Verification](../05_verification/VERIFICATION.md) và ánh xạ tại [Traceability](../07_records/TRACEABILITY.md).

| ID | Yêu cầu / tiêu chí chấp nhận | Phương pháp |
|---|---|---|
| SYS-REQ-001 | Thiết bị must tiếp tục control local khi Web UI/client không kết nối. | integration/fault injection |
| SYS-REQ-002 | Base SKU must cung cấp đúng 16 UI + 4 AO + 4 DO; optional DI không được quảng bá như baseline. | inspection + I/O test |
| SYS-REQ-003 | Runtime must tải và chạy component graph bằng 28 loại node đã phê duyệt. | unit + integration |
| SYS-REQ-004 | Rev A must hỗ trợ BACnet/IP, Modbus TCP và hai Modbus RTU master theo cấu hình. | protocol test |
| SYS-REQ-005 | HMI được bật theo build/SKU must dùng cùng dữ liệu và quyền điều khiển đã kiểm soát, không thay thế core. | build + integration |
| SWR-REQ-001 | Ba core service must phân tách core, iobus và web; lỗi presentation không được dừng control path. | process fault test |
| SWR-REQ-002 | Graph scan, priority arbitration, interlock và safe-state must deterministic trong giới hạn test được phê duyệt. | timing + unit test |
| SWR-REQ-003 | Config must được validate, ghi bền vững và round-trip không mất field có consumer. | API/config test |
| SWR-REQ-004 | Alarm, trend, schedule, user và commissioning endpoints must yêu cầu auth/role phù hợp. | API/security test |
| IF-REQ-001 | IOP must dùng 921600 baud, poll 2 ms, response timeout 3 ms, tối đa 3 retry và fault threshold 20 ms. | header assertion + HIL |
| IF-REQ-002 | SHM consumers must dùng cùng magic/layout; đổi ABI must đổi magic và rebuild đồng bộ. | compile/layout test |
| IF-REQ-003 | AO must đi qua ranh giới core/iobus bằng V hoặc mA hợp lệ và chỉ scale sang DAC một lần. | boundary test |
| SAFE-REQ-001 | MCU must đưa output về safe behavior nếu không nhận poll hợp lệ trong 200 ms. | HIL fault injection |
| SAFE-REQ-002 | Giá trị output NaN, infinity hoặc ngoài dải must bị từ chối trước khi publish/actuate. | negative test |
| SEC-REQ-001 | API must có authentication, role authorization và audit cho thay đổi cấu hình/force output. | security test |
| SEC-REQ-002 | Secret must không được hard-code; production transport/config must dùng cơ chế bảo vệ được phê duyệt. | review + deployment test |
| NFR-REQ-001 | Restart từng service must không gây output không kiểm soát; trạng thái lỗi phải quan sát được. | resilience test |
| NFR-REQ-002 | Build release must tái lập được và toàn bộ test bắt buộc phải pass trên target/toolchain được ghi nhận. | CI/release record |
| HW-REQ-001 | Mạch UI must hỗ trợ mode đã công bố, với STM32 là SPI master duy nhất của hai ADS131M08. | schematic review + bench |
| HW-REQ-002 | AO/DO/power/protection must đạt limit đã phê duyệt trước manufacturing release. | calculation + lab evidence |
| HW-REQ-003 | HMI build must nhắm JD9852 MIPI DSI, FT5436 I²C và DRM/KMS `/dev/dri/card0`. | inspection + target test |
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

Các requirement về chứng nhận chỉ được thêm khi có tiêu chuẩn áp dụng, test plan, acceptance limit và chủ sở hữu bằng chứng.
