# Báo cáo As-Built Modbus RTU Point

**ID:** DDC24-MODBUS-RTU-POINT-AS-BUILT-2026-08-03
**Ngày:** 2026-08-03
**Kết luận:** source path hoàn thiện trên host/simulator; acceptance với RS485 device thật chưa thực hiện

**Design proposal để review:**
[DDD-SW-MBRTU-POINT-001](../../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md)
và [báo cáo phương án](MODBUS_RTU_POINT_DESIGN_REVIEW_PROPOSAL.md). Proposal
không thay đổi các kết luận As-Built bên dưới.

**Cập nhật 2026-08-04:** bộ tài liệu thiết kế đã được phân rã theo layer và audit
As-Built được mở rộng sang FE/BE/API/UI-UX. Danh sách gap đầy đủ (P0/P1/P2) và
các mâu thuẫn tài liệu đã xử lý nằm tại
[Modbus RTU Docs Sync Report](MODBUS_RTU_DOCS_SYNC_REPORT.md). Báo cáo này vẫn
đúng ở phạm vi ban đầu; nó **không** bao phủ các gap FE/BE mới phát hiện
(suy diễn quality ở FE, xoá không xác nhận, thiếu commissioning/import-export,
apply bằng restart service).

## Chuỗi As-Built

```text
FE Device/Point Manager
  → REST CRUD + persistence fieldbus.conf/profile
  → restart iobus có rollback
  → Modbus RTU master + diagnostics
  → io_shm EXT/diagnostics
  → Core Point Table EXT
  → BE canonical PointDTO
  → REST /points và WebSocket points stream
```

Không có Program API, Program Deployment/Activation hoặc liên kết `StScheduler` production trong chuỗi này.

## Coverage chức năng

| Yêu cầu | As-Built | Bằng chứng chính |
|---|---|---|
| Modbus device CRUD | Có | `/api/v1/modbus/devices`, persistence và FE Device Manager |
| Modbus point CRUD | Có | `/api/v1/modbus/points`, stable `point_id`, FE Point Manager |
| RS485 port/baud/parity/stop/slave ID | Có validate và profile hóa | `ModbusRTUDevice`, `fieldbus.conf`, parser iobus |
| Coil/Discrete/Input/Holding | Có | FC 1/2/4/3; write chỉ cho Coil/Holding khi `read_write` cho phép |
| Data type/endian/scale/offset | Có | bool, int16/uint16/int32/uint32/float32; AB/BA/ABCD/BADC/CDAB/DCBA |
| Poll/timeout/retry | Có | per-device config và scheduler retry hữu hạn |
| CRC diagnostics | Có | counter per slave qua SHM và API diagnostics |
| GOOD/STALE/OFFLINE/BAD | Có trong runtime mapping | STALE trước OFFLINE; non-finite/invalid thành BAD |
| Persistence | Có | `fieldbus.conf` + profile JSON, revision/checksum |
| BE API | Có | OpenAPI 1.11.0 và handler/test CRUD |
| FE Device/Point Manager | Có | route `/eng/modbus-rtu`, form CRUD và diagnostics/runtime quality |
| Core Point Table | Có | `PointKind::EXT`, `PointSource::MODBUS_RTU` |
| WebSocket update | Có qua point stream hiện hữu | EXT được nhập vào cùng snapshot mà WS dùng để phát PointDTO |
| Simulator | Đạt | pseudo-TTY read/write/timeout và fake-master unit tests |
| RS485 device thật | **Chưa đạt** | target không có `fieldbus.conf` và chưa gắn slave thật |

## Point Model

Mọi Modbus RTU Point xuất ra hợp đồng canonical:

| Field | Authority |
|---|---|
| `point_id` | BE cấp/giữ ổn định; Core dùng làm identity EXT |
| `tag_name`, `display_name` | BE config; tag unique toàn namespace |
| `data_type`, `unit`, `read_write` | BE fieldbus config/profile |
| `value`, `quality`, `timestamp`, `source` | iobus/Core runtime; source `modbus_rtu` |
| `default_value`, `safe_value` | BE fieldbus config |

Rename tag/display name không làm đổi `point_id`; API từ chối payload cố đổi ID. Metadata không được lưu làm authority trong `localStorage`.

## Apply và persistence

Mỗi mutation thực hiện theo thứ tự:

1. đọc revision hiện hữu;
2. chuẩn hóa và validate toàn cấu hình, kể cả tag collision với Local/Virtual Point;
3. tạo profile theo device;
4. tăng revision, tính SHA-256 checksum;
5. atomic replace profile và `fieldbus.conf`;
6. restart iobus;
7. nếu restart thất bại, restore toàn bộ snapshot file, xóa file mới phát sinh và restart lại cấu hình cũ.

Test BE xác nhận rollback giữ byte-for-byte cấu hình cũ và không để orphan profile.

## Diagnostics và quality

- `total_polls`, `total_errors`, `timeout_errors`, `crc_errors`, `retry_attempts`, `consecutive_errors`, `last_seen_ms` được publish per slave.
- Poll lỗi làm Point chuyển STALE; vượt ngưỡng lỗi liên tiếp chuyển OFFLINE.
- Lỗi decode hoặc giá trị không hữu hạn chuyển BAD.
- Lần đọc thành công phục hồi GOOD và cập nhật timestamp.

## Bằng chứng

- Full host CTest bật Modbus/BACnet/HMI: **751/751 PASS**.
- `ModbusMaster.RtuPtyReadWriteAndTimeout`: PASS.
- Codec BADC/DCBA và round-trip tất cả word/byte order: PASS.
- Retry, STALE/OFFLINE, writable Coil/Holding, profile/SHM/Core EXT: PASS.
- Go CRUD/rename/tag collision/rollback/canonical contract: PASS trong `go test ./... -count=1`.
- FE `ModbusRtuPage` và point normalizer: PASS trong bộ **299/299**.

## Finding chưa đóng

`MBRTU-HW-01`: chưa có bằng chứng giao tiếp trên transceiver RS485 và slave thật, gồm đọc đủ bốn register type, write Coil/Holding, CRC lỗi được tạo vật lý, mất dây, timeout/retry, reboot/power-cycle và persistence sau boot.

```text
MODBUS_RTU_SOURCE_PATH = YES
MODBUS_RTU_SIMULATOR_TEST = YES
MODBUS_RTU_REAL_DEVICE_TEST = NO
MODBUS_RTU_POINT_READY = NO
```
