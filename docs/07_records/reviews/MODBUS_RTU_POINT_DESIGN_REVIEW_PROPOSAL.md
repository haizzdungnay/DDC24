# Báo cáo phương án thiết kế Modbus RTU Point để review

**ID:** DDC24-MBRTU-DESIGN-REVIEW-2026-08-03
**Ngày:** 2026-08-03
**Trạng thái:** In Review
**Design authority đề xuất:**
[DDD-SW-MBRTU-POINT-001](../../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md)
**Ranh giới:** chỉ Modbus RTU Point; không phải Programming Design hoặc
Implementation Plan

## Kết luận trả lời trực tiếp

`MODBUS_RTU_POINT_READY = NO` là kết luận đúng ở hiện trạng. Source CRUD,
simulator và host test đã có, nhưng chưa đủ để gọi production-ready.

Phương án đề xuất đã đủ nội dung để review. Trước khi vào Programming Design,
phải phê duyệt thiết kế và đóng bốn nhóm P0:

1. chốt hai RS485 master trên hardware thật;
2. nâng contract runtime thành typed + stable ID + timestamp + quality authority;
3. thay restart/dirty-flag bằng config ACK và write result có thẩm quyền;
4. chạy acceptance hai bus trên RS485 thật, recovery/power-cycle và provenance.

## Vì sao chưa thể đổi thành YES

| Finding | Bằng chứng hiện trạng | Rủi ro nếu bỏ qua |
|---|---|---|
| MBRTU-DR-01 | Product ghi hai RTU master; HW draft chỉ có UART4/một transceiver/connector; source có một master | Programming map vào Point không tồn tại trên SKU thật |
| MBRTU-DR-02 | `kx_ext_point_t` chỉ có float, ba quality, không sample timestamp/revision | uint32 mất chính xác; STALE/OFFLINE và Online Monitor có thể sai |
| MBRTU-DR-03 | apply dựa trên restart iobus; chưa có applied revision/checksum ACK | UI có thể báo success khi runtime chưa chạy config mới |
| MBRTU-DR-04 | write dùng ext slot + dirty/setpoint, không authoritative result/readback | false-success, replay hoặc ghi sai Point sau config reorder |
| MBRTU-DR-05 | pseudo-TTY/simulator pass; chưa có RS485 slave thật | không chứng minh transceiver, timing, CRC vật lý, wiring và recovery |

## Phương án kiến trúc khuyến nghị

```text
ModbusRTUBus (RS485-1 / RS485-2)
  └─ ModbusRTUDevice (bus_id + slave_id + poll/timeout/retry)
       └─ ModbusRTUPoint (stable point_id + register mapping + typed metadata)

FE → Web candidate/revision → iobus authoritative apply ACK
iobus two-bus poll → typed sample/revision/timestamp → core Point Table → REST/WS
core command → reliable write request/result → iobus → slave
```

Thiết kế giữ nguyên kiến trúc ba process; không tạo fieldbus service thứ tư.
Web là authority cấu hình, iobus là authority bus/runtime telemetry, core là
authority Point Table và command arbitration. FE không sở hữu metadata và không
mở UART.

## Chín quyết định đề nghị reviewer duyệt

| ID | Quyết định | Đề nghị |
|---|---|---|
| DR-MBRTU-001 | Hai bus production và mapping hardware/device node | Giữ Product baseline hai bus; HW freeze hai path |
| DR-MBRTU-002 | Tách Bus khỏi Device | Approve |
| DR-MBRTU-003 | Address persistence zero-based | Approve |
| DR-MBRTU-004 | GOOD/STALE/OFFLINE/BAD + timestamp producer | Approve |
| DR-MBRTU-005 | Typed IPC v2, value double, stable point_id/generation | Approve |
| DR-MBRTU-006 | Config apply chỉ thành công sau iobus ACK revision/checksum | Approve |
| DR-MBRTU-007 | Write request/result/readback; không blind replay/safe auto-write | Approve |
| DR-MBRTU-008 | 2 bus, 16 device/bus, 64 Point tổng | Approve có load test |
| DR-MBRTU-009 | Commission read operator; write/config admin | Approve |

Chi tiết rationale, schema, state machine, API, IPC, acceptance và gap As-Built
nằm trong design authority, tránh sao chép hai nguồn khác nhau.

## Gate review đề xuất

### Gate A — duyệt design

- ADR-024 chuyển `Proposed → Accepted`;
- DR-MBRTU-001..009 có owner và quyết định;
- không còn xung đột hai-port giữa Product/HW/Platform;
- requirement/verification/traceability giữ ID ổn định.

### Gate B — xác nhận conforming implementation

- source khớp ownership và contract v2;
- hai bus độc lập, typed Point, quality/timestamp, atomic apply ACK, write ACK;
- full automated suite pass trên commit sạch;
- không skip/disable test.

### Gate C — production acceptance

- MBRTU-HIL-01..12 pass trên target/hardware release candidate;
- RS485 slave thật, CRC/timeout/wiring fault, two-bus isolation;
- reboot/power-cycle/crash/config rollback/no-replay pass;
- binary/service/config truy được version, commit, checksum và toolchain.

Chỉ Gate A+B+C đều đạt mới được ghi `MODBUS_RTU_POINT_READY = YES` và dùng
Modbus RTU Point làm dependency đã sẵn sàng cho Programming Design.

## Trạng thái đề nghị tại thời điểm review

```text
DESIGN_PROPOSAL_COMPLETE = YES
READY_FOR_DESIGN_REVIEW = YES
DESIGN_APPROVED = NO
SOURCE_CONFORMS_TO_PROPOSED_DESIGN = NO
REAL_RS485_ACCEPTANCE = NO
MODBUS_RTU_POINT_READY = NO
READY_TO_ENTER_PROGRAMMING_DESIGN = NO
```

`NO` ở đây là gate có chủ đích, không phủ nhận kết quả host/simulator đã đạt.
Nó ngăn Programming phụ thuộc vào identity, quality, timestamp hoặc hardware
contract chưa được production chứng minh.

## Biên bản review

| Vai trò reviewer | Kết quả | Ngày | Ghi chú/decision link |
|---|---|---|---|
| Product owner | PENDING | — | DR-MBRTU-001/008/009 |
| System/Software architect | PENDING | — | DR-MBRTU-002/005/006 |
| Fieldbus lead | PENDING | — | DR-MBRTU-002..008 |
| Hardware/Platform lead | PENDING | — | DR-MBRTU-001 |
| Security/Safety reviewer | PENDING | — | DR-MBRTU-007/009 |
| QA/Verification lead | PENDING | — | VR-MBRTU-001..012 |

Reviewer phải ghi `APPROVE`, `APPROVE WITH CONDITIONS` hoặc `REJECT` kèm
finding/decision link. Không đổi ADR-024 thành Accepted chỉ từ trao đổi miệng.
