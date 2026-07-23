# Use Cases — HMI local MK-DDC-24

**Document ID:** KX-DDC24-UC-HMI-001
**Revision:** 3.2 — 2026-07-22
**Status:** Implemented and target service-verified; connected-panel acceptance open
**Owner:** Product/UX Lead
**Decision:** ADR-016, ADR-017
**Trace:** `HMI-REQ-001..017`, `IF-REQ-004`, `SWR-REQ-005..007`

## 1. Product role

HMI local 2.4 inch là **limited operator HMI**, không phải full Web HMI/SCADA và
không phải control/alarm authority. Nó hỗ trợ kiểm tra nhanh, vận hành giới hạn point
được whitelist, alarm triage/ACK và service diagnostics tại tủ.

Năm surface bắt buộc:

```text
Home ↔ Points ↔ Control ↔ Alarms ↔ Service
```

Communication/System của thiết kế cũ được gộp vào Home/Service; không bị mất.

## 2. Actors và quyền

| Actor | Mục tiêu | Mutation |
|---|---|---|
| Viewer | Quan sát trạng thái, point, alarm và diagnostics | Không |
| Operator | Điều chỉnh vận hành point được whitelist; ACK alarm | Setpoint/mode/override/release/ACK theo policy |
| Commissioner | Kiểm tra hệ thống; cấu hình sâu vẫn ngoài panel local | Không thêm quyền engineering trên HMI |
| Service | Chẩn đoán và cấu hình/phục hồi Ethernet IPv4 được ADR-017 phê duyệt | Network transaction có authority/audit |

Identity phải authoritative và session có thời hạn. `role=` hoặc static PIN trong file
HMI không phải production identity.

## 3. Preconditions chung

- HMI SKU/build được enable và panel/input đã init.
- SHM hợp lệ cho monitoring; nếu không, HMI hiển thị unavailable.
- Local broker/core/alarm authority chỉ cần cho mutation; mất chúng không được dừng
  local control và không được làm monitoring giả thành normal.
- Clock/audit time đã đồng bộ hoặc audit đánh dấu time quality không xác định.

## 4. Use cases

### UC-HMI-001 — Glance trạng thái controller

| Field | Nội dung |
|---|---|
| Actor | Viewer/Operator |
| Trigger | Mở tủ, đầu ca hoặc sau reboot |
| Main flow | Home hiển thị controller/data state, highest alarm, alarm counts, I/O health, broker/core/iobus, override count và communication summary |
| Alternate | Telemetry thiếu → `UNAVAILABLE/STALE`, không hiện `OK` |
| Acceptance | Trong 30 giây người dùng xác định được normal/abnormal, point/communication cần xử lý và có override hay không |

### UC-HMI-002 — Điều hướng bằng touch và sáu nút

| Field | Nội dung |
|---|---|
| Actor | Mọi actor |
| Main flow | Swipe/tap hoặc LEFT/RIGHT đổi surface; UP/DOWN đổi focus; ENTER chọn; ESC huỷ/quay lại |
| Alternate | Screen saver active → input đầu chỉ wake |
| Acceptance | Cả năm surface và mọi action reachable bằng hard key; focus luôn nhìn thấy |

### UC-HMI-003 — Xem point và data quality

| Field | Nội dung |
|---|---|
| Actor | Viewer/Operator |
| Main flow | Points → filter All/Bad/Stale/Overridden → chọn row → xem ID/name/value/unit/quality/age/source |
| Alternate | Point optional absent → không hiển thị; point unsupported → `UNAVAILABLE` |
| Acceptance | Base inventory đúng UI16/AO4/DO4; input/raw/feedback không có control action |

### UC-HMI-004 — Đăng nhập Operator

| Field | Nội dung |
|---|---|
| Actor | Operator |
| Main flow | Chọn Login → nhập credential qua touch/keys → broker xác thực → HMI nhận opaque session + role + expiry |
| Alternate | Sai/unknown/locked/broker unavailable → không tạo session, ghi audit denial khi authority sẵn sàng |
| Acceptance | Không lưu plaintext credential; idle session hết hạn không quá 15 phút; logout/expiry khoá mutation |

### UC-HMI-005 — Chỉnh setpoint được whitelist

| Field | Nội dung |
|---|---|
| Actor | Operator có session |
| Preconditions | Point `commandable`, action `setpoint`, role và range được authority cấp |
| Main flow | Control → faceplate → nhập value → xem old/new/unit → Confirm → Pending → authoritative Accepted → hiển thị effective state |
| Alternate | Ngoài range, quality/policy lỗi, interlock hoặc role deny → Rejected với stable reason; state cũ giữ nguyên |
| Acceptance | HMI không optimistic-commit; feedback ≤2 s nominal; audit có actor/request/old/new/result |

### UC-HMI-006 — Chọn Auto/Manual mode

| Field | Nội dung |
|---|---|
| Actor | Operator có session |
| Main flow | Chọn mode được policy cho phép → Confirm → broker/core validate → hiển thị effective mode/source |
| Alternate | Safety/priority cao hơn thắng → command có thể accepted nhưng effective source khác; HMI phải hiện rõ |
| Acceptance | Không đồng nhất `command accepted` với `effective output`; source/priority luôn visible |

### UC-HMI-007 — Tạo override có thời hạn

| Field | Nội dung |
|---|---|
| Actor | Operator có session |
| Main flow | Chọn Override → nhập value, reason, TTL trong policy → Confirm → core arbitration → hiển thị `OVERRIDE`, actor/source/priority/expiry |
| Alternate | TTL vượt max, reason trống, non-finite/out-of-range hoặc interlock deny → Rejected |
| Acceptance | Override có bounded TTL; không cho indefinite default; mọi field audit được |

### UC-HMI-008 — Release override

| Field | Nội dung |
|---|---|
| Actor | Operator có session và policy phù hợp |
| Main flow | Chọn point đang override → Release → Confirm → authoritative Released → effective source trở về automatic/priority winner |
| Alternate | Override đã hết hạn hoặc nguồn khác sở hữu → response idempotent/explained, không tạo lệnh thứ hai |
| Acceptance | `Release` không ép một output value mới; UI hiển thị source/value authoritative sau release |

### UC-HMI-009 — Xem và lọc alarm

| Field | Nội dung |
|---|---|
| Actor | Viewer/Operator |
| Main flow | Alarms → xem priority/state/time/source/message/response → filter Active/Unacked/All |
| Alternate | Stream gap/restart → hydrate snapshot; trước hydrate ACK disable |
| Acceptance | Active count không giảm chỉ vì ACK; priority cao nhất không bị che trong alarm flood |

### UC-HMI-010 — ACK alarm authoritative

| Field | Nội dung |
|---|---|
| Actor | Operator có session |
| Main flow | Chọn alarm cần ACK → đọc response → ACK → Pending → authority Accepted → state đổi Acked |
| Alternate | Role deny, alarm stale, authority unavailable/timeout → state không đổi và có lỗi rõ |
| Acceptance | ACK idempotent theo request ID, có audit, không clear active condition |

### UC-HMI-011 — Xem communication/system diagnostics

| Field | Nội dung |
|---|---|
| Actor | Viewer/Service |
| Main flow | Home xem summary; Service xem Ethernet/IP, BACnet traffic age, Modbus status, version, uptime, resource, process, watchdog, last fault |
| Alternate | Contract chưa có → `UNAVAILABLE`, không dùng default giả |
| Acceptance | Giữ toàn bộ diagnostics cần thiết dù bỏ hai tab Communication/System cũ |

### UC-HMI-012 — Yêu cầu maintenance an toàn

| Field | Nội dung |
|---|---|
| Actor | Service có session |
| Main flow | Service → chọn action đã enable → xem impact → hold/confirm → broker/core/maintenance authority thực hiện → audit/result |
| Alternate | Action chưa triển khai, safe-state không được core xác nhận hoặc privilege không hợp lệ → disable/reject |
| Acceptance | HMI không giữ `CAP_SYS_BOOT`, không gửi raw signal và không tự reboot/restart service |

### UC-HMI-013 — Broker/core mất khi đang thao tác

| Field | Nội dung |
|---|---|
| Actor | Operator |
| Main flow | Request đang Pending → timeout → state `UNKNOWN` → query authority khi reconnect |
| Alternate | Không reconnect → Control/ACK/Service giữ read-only |
| Acceptance | Không replay mù; duplicate request không double action; local control tiếp tục |

### UC-HMI-014 — Session hết hạn khi override còn active

| Field | Nội dung |
|---|---|
| Actor | Operator |
| Main flow | Session expire → mutation lock; override status/expiry vẫn hiển thị read-only |
| Alternate | Override tự hết TTL → HMI cập nhật `EXPIRED/AUTO` từ authority |
| Acceptance | Session expiry không kéo dài, huỷ hoặc che override đã accepted |

### UC-HMI-015 — Stale/corrupt telemetry

| Field | Nội dung |
|---|---|
| Actor | Mọi actor |
| Main flow | SHM timestamp quá ngưỡng hoặc seqlock/magic lỗi → banner/quality `STALE/UNAVAILABLE` và block mutation phụ thuộc dữ liệu đó |
| Acceptance | Không hiển thị giá trị cũ như current; recovery chỉ sau snapshot hợp lệ |

### UC-HMI-016 — Xem active và pending network

| Field | Nội dung |
|---|---|
| Actor | Viewer/Service |
| Main flow | Service → Network hiển thị link/interface, active kernel IPv4/prefix/gateway/mode, pending transaction và rollback countdown |
| Alternate | Authority thiếu → `UNAVAILABLE`; file desired không được trình bày như active |
| Acceptance | Người dùng phân biệt Active, Pending và Last-known-good; không có `online` suy diễn từ field không rỗng |

### UC-HMI-017 — Đổi Ethernet static IPv4

| Field | Nội dung |
|---|---|
| Actor | Service có session |
| Main flow | Chọn Static → nhập IPv4/subnet/gateway → xem old/new và impact → hold Confirm → broker/network authority stage+apply → HMI hiện countdown → Service confirm new IP |
| Alternate | Format/range/route/duplicate IP invalid → reject trước activate; authority timeout → Unknown/rollback, không retry mù |
| Acceptance | Có audit và transaction ID; success chỉ sau authoritative confirm; local control/IOP scan tiếp tục |

### UC-HMI-018 — Chuyển Ethernet sang DHCP

| Field | Nội dung |
|---|---|
| Actor | Service có session |
| Main flow | Chọn DHCP → xem cảnh báo địa chỉ có thể thay đổi → apply → HMI hiển thị lease active mới và cho confirm |
| Alternate | Không nhận lease/health fail trước deadline → tự rollback last-known-good |
| Acceptance | IP mới lấy từ authority/kernel, không lấy từ candidate; panel hiển thị địa chỉ để kỹ thuật viên reconnect Web |

### UC-HMI-019 — Rollback network

| Field | Nội dung |
|---|---|
| Actor | Service có session hoặc authority tự động |
| Main flow | Trong `awaiting_confirmation`, chọn Roll back hoặc hết deadline → authority phục hồi last-known-good → HMI rehydrate state `rolled_back` |
| Alternate | Helper/host restart giữa transaction → journal boot recovery tiếp tục rollback |
| Acceptance | IP cũ phục hồi trong giới hạn test; không restart core/iobus; BACnet rebind theo active address cuối cùng |

## 5. Global acceptance matrix

| Topic | Acceptance |
|---|---|
| Scope | Chỉ five-surface local HMI; Ethernet IPv4 Service workflow là ngoại lệ hẹp, không có full Web/SCADA/engineering workflow |
| Authority | HMI không ghi SHM/hardware; mutation chỉ complete sau authoritative response |
| Control | Chỉ whitelist; finite/range/role/priority/reason/TTL revalidated |
| Alarm | Four-state semantics; ACK authoritative/audited, ACK ≠ clear |
| Security | Short-lived session, fail closed, no static config privilege |
| Failure | Broker/core loss → read-only; no blind replay |
| Usability | Font ≥14 px; action target ≥40×40 px hoặc hard-key equivalent; visible focus |
| Timing | Telemetry ≤1 s; nominal action feedback ≤2 s |
| Target | Touch/buttons/glove/light/alarm flood/stale/loss/recovery/localization tested on panel |

## Revision history

| Revision | Date | Change |
|---|---|---|
| 2.3 | 2026-07-22 | Service-panel use cases, authority/audit and target usability gates. |
| 3.0 | 2026-07-22 | ADR-016 five-surface limited-operator use cases including setpoint, mode, override/release, session expiry and broker failure. |
| 3.1 | 2026-07-22 | Added ADR-017 network status, static/DHCP apply and rollback use cases UC-HMI-016..019. |
