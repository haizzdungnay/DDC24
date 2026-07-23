# System Requirements

**ID:** SYS-REQSET-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-23 (ADR-020: thêm SYS/SWR/IF/SAFE/NFR/FW-REQ-IEC/MCU cho Mekong Program Runtime ST+FBD)

`Must` là bắt buộc cho Rev A.0. Mỗi yêu cầu cần bằng chứng trong [Verification](../05_verification/VERIFICATION.md) và ánh xạ tại [Traceability](../07_records/TRACEABILITY.md).

| ID | Yêu cầu / tiêu chí chấp nhận | Phương pháp |
|---|---|---|
| SYS-REQ-001 | Thiết bị must tiếp tục control local khi Web UI/client không kết nối. | integration/fault injection |
| SYS-REQ-002 | Base SKU must cung cấp đúng 16 UI + 4 AO + 4 DO; optional DI không được quảng bá như baseline. | inspection + I/O test |
| SYS-REQ-003 | Runtime must tải và chạy component graph bằng 28 loại node đã phê duyệt. | unit + integration |
| SYS-REQ-004 | Rev A must hỗ trợ BACnet/IP, Modbus TCP và hai Modbus RTU master theo cấu hình. | protocol test |
| SYS-REQ-005 | HMI được bật theo build/SKU must dùng cùng dữ liệu và quyền điều khiển đã kiểm soát, không thay thế core. | build + integration |
| SYS-REQ-IEC-001 | Rev A.0 must cung cấp Program Runtime do Mekong sở hữu (không runtime IEC bên ngoài), IEC 61131-3-aligned, scope **ST + FBD** (LD/SFC ngoài Rev A.0); không claim `certified`/`compliant`. | inspection + conformance test theo scope ST+FBD |
| SWR-REQ-001 | Ba core service must phân tách core, iobus và web; lỗi presentation không được dừng control path. | process fault test |
| SWR-REQ-002 | Graph scan, priority arbitration, interlock và safe-state must deterministic trong giới hạn test được phê duyệt. | timing + unit test |
| SWR-REQ-003 | Config must được validate, ghi bền vững và round-trip không mất field có consumer. | API/config test |
| SWR-REQ-004 | Alarm, trend, schedule, user và commissioning endpoints must yêu cầu auth/role phù hợp. | API/security test |
| SWR-REQ-005 | Network configuration must phân biệt desired/pending với active kernel state; không được báo applied/online chỉ từ file cấu hình hoặc field không rỗng. | unit + integration |
| SWR-REQ-006 | Đổi Ethernet IPv4 must dùng transaction `stage/apply/confirm/rollback`, giữ last-known-good và tự rollback trong tối đa 120 s nếu không confirm hoặc health check thất bại. | fault + target network test |
| SWR-REQ-007 | Đổi IP must không restart `mkddc-core`, không làm dừng IOP/UART scan và phải hot-rebind BACnet/IP rồi phát `I-Am`; Web và Modbus TCP phải phục hồi/reconnect theo interface mới. | multi-process + protocol test |
| SWR-REQ-IEC-001 | `libmkddc_iec` must parse, edit, build và execute **ST và FBD** bằng cùng semantic/type engine; LD/SFC không triển khai. | positive/negative suite ST + FBD + mixed-language project |
| SWR-REQ-IEC-002 | Compiler must hỗ trợ POU `PROGRAM`/`FUNCTION`/`FUNCTION_BLOCK`, scope và typed interface. | POU conformance matrix; local/instance isolation |
| SWR-REQ-IEC-003 | Compiler must triển khai data types/derived types và conversion đúng type system §C0.3. | boundary/overflow/invalid conversion tests |
| SWR-REQ-IEC-004 | Standard functions/FB (`MKDDC_*` namespace tách biệt) must khớp semantics/time/state đã duyệt. | golden vectors + time/restart/multi-instance tests |
| SWR-REQ-IEC-005 | Compiler must tạo deterministic typed artifact có source/profile/compiler/ABI hash. | hai clean build cùng input cho cùng artifact hash |
| SWR-REQ-IEC-006 | `mkddc-program-core` must verify package và atomically activate chỉ tại safe task boundary. | fault injection: reject/timeout/power loss giữ package cũ |
| SWR-REQ-IEC-007 | Runtime must thực thi task/POU deterministically, đo cycle/WCET/overrun, không allocation trong scan. | static inspection + target timing test |
| SWR-REQ-IEC-008 | FE must không báo validate/build/deploy thành công nếu chưa có authoritative Backend/Core result. | API/E2E denial, timeout, reject, rollback tests |
| SWR-REQ-IEC-009 | Project revision, build, activation, rollback must RBAC-control và audit. | security/API test actor/hash/result/denial |
| IF-REQ-001 | IOP must dùng 921600 baud, poll 2 ms, response timeout 3 ms, tối đa 3 retry và fault threshold 20 ms. | header assertion + HIL |
| IF-REQ-002 | SHM consumers must dùng cùng magic/layout; đổi ABI must đổi magic và rebuild đồng bộ. | compile/layout test |
| IF-REQ-003 | AO must đi qua ranh giới core/iobus bằng V hoặc mA hợp lệ và chỉ scale sang DAC một lần. | boundary test |
| IF-REQ-004 | SOM network authority must cung cấp local versioned/bounded IPC cho `status/validate/stage/apply/confirm/rollback`, kiểm peer credential và trả transaction state/reason code ổn định. | contract + negative test |
| IF-REQ-IEC-001 | Program Runtime variables must bind typed I/O points có direction, unit, range và quality rõ (`io_map.json`). | mapping/round-trip/negative tests; wrong type/direction/range bị reject |
| SAFE-REQ-001 | MCU must đưa output về safe behavior nếu không nhận poll hợp lệ trong 200 ms. | HIL fault injection |
| SAFE-REQ-002 | Giá trị output NaN, infinity hoặc ngoài dải must bị từ chối trước khi publish/actuate. | negative test |
| SAFE-REQ-IEC-001 | Program must không bypass Core priority, interlock, safety hoặc MCU independent safe timeout. | bypass review + process/UART fault injection + HIL |
| SEC-REQ-001 | API must có authentication, role authorization và audit cho thay đổi cấu hình/force output. | security test |
| SEC-REQ-002 | Secret must không được hard-code; production transport/config must dùng cơ chế bảo vệ được phê duyệt. | review + deployment test |
| SEC-REQ-003 | Network mutation must yêu cầu Service/Admin session, audit old/new/actor/result và đi qua helper least-privilege; HMI/Web must không có quyền chạy shell hoặc sửa trực tiếp OS network state. | security + deployment negative test |
| NFR-REQ-001 | Restart từng service must không gây output không kiểm soát; trạng thái lỗi phải quan sát được. | resilience test |
| NFR-REQ-002 | Build release must tái lập được và toàn bộ test bắt buộc phải pass trên target/toolchain được ghi nhận. | CI/release record |
| NFR-REQ-IEC-001 | Program Runtime must tiếp tục active control khi FE/Web mất kết nối và recover không replay mutation. | multi-process fault test |
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
| HMI-REQ-016 | Trong `Service`, local HMI must cho Service role xem active/pending Ethernet IPv4, chọn DHCP hoặc nhập static IP/subnet/gateway, xem impact và thực hiện apply/confirm/rollback qua broker; không được mở rộng thành Wi-Fi/protocol/full engineering. | policy + target usability test |
| HMI-REQ-017 | Khi đổi IP, local HMI must hiển thị transaction state và rollback countdown; mất broker/network authority phải giữ monitoring read-only, không báo thành công và không blind retry. | fault injection + target test |

Các requirement về chứng nhận chỉ được thêm khi có tiêu chuẩn áp dụng, test plan, acceptance limit và chủ sở hữu bằng chứng.
