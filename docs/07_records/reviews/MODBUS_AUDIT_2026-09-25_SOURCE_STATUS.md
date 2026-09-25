# Hiện trạng mã nguồn Modbus RTU — FE, BE, FW SOM

**ID:** REC-MBA-SRC-001
**Phiên bản:** 1.0
**Trạng thái:** Record (đối chiếu mã nguồn tại một thời điểm — không phải design authority)
**Ngày:** 2026-09-25
**Baseline đối chiếu:** `main` @ `36c1a863` (sau PR #746). Bản sửa của phiên: nhánh `fix/modbus-audit-20260925`
**Bộ hồ sơ audit:** báo cáo này · [Hoạt động Modbus trên bo Forlinx](MODBUS_AUDIT_2026-09-25_BOARD_OPERATION_REPORT.md) · [Finding, gap và phương án](MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS.md)
**Authority thiết kế:** [DDD-FW-MBRTU-001](../../02_design/software/MODBUS_RTU_FW_SOM_DESIGN.md), [MODBUS_RTU_BE_DESIGN](../../02_design/software/MODBUS_RTU_BE_DESIGN.md), [MODBUS_RTU_FE_DESIGN](../../02_design/software/MODBUS_RTU_FE_DESIGN.md), [MODBUS_RTU_DATA_MODEL](../../02_design/software/MODBUS_RTU_DATA_MODEL.md)

---

## 1. Tóm tắt

- Modbus RTU trải qua **ba tiến trình** và **bốn kênh IPC**: FE (React) → `mkddc-web`
  (Go) → `mkddc-iobus` (C++, master Modbus) ⇄ `mkddc-core` (C++, Point Table và
  logic). Kiến trúc tách vai đúng thiết kế: chỉ iobus chạm cổng serial; chỉ core là
  writer của `plc_shm`; web đọc telemetry qua SHM và cấu hình qua kênh điều khiển.
- Khối lượng mã (baseline `36c1a863`): FW SOM ≈5.700 dòng / 26 file (180 test
  gtest); BE 5.375 dòng (123 test Go); FE 3.469 dòng / 17 file (95 ca vitest).
- Phần **đọc** (poll → codec → quality → snapshot → Point Table → UI) đã chín: EDF
  scheduler, probe chậm cho thiết bị chết, gộp block, quality 5 mức, snapshot v2 có
  sequence/generation/checksum, 2 BusWorker độc lập, đo latency/utilization thật.
- Phần **ghi** là điểm yếu kiến trúc: lệnh đi bằng **cờ mức `dirty` + setpoint**
  trong `plc_shm`, không có danh tính lệnh, không có kết quả trả về. Kênh ghi có
  `request_id` và readback đã được viết ở iobus nhưng **không ai dùng** (BE không gọi,
  sink kết quả không được nối).
- Audit tìm ra **10 lỗi** đã tái hiện được bằng test hoặc số đo trên bo và **đã sửa
  trong phiên**, **1 lỗi P0 còn mở** cần quyết định (`MBA-FW-08`) và **9 gap kiến
  trúc/vận hành**. Chi tiết ở báo cáo finding.

## 2. Kiến trúc tổng thể

### 2.1 Tiến trình, thread và kênh

```text
 Trình duyệt (FE React)                         mkddc-web (Go, :8082)
 ─────────────────────                           ─────────────────────
 /eng/modbus-rtu/*  ──REST /api/v1/modbus/*──►  modbus_config_api.go / modbus_rtu.go
 useModbusRuntime   ◄──WS realtime points────   points.go (điểm chung, kind=modbus_rtu)
                                                    │  đọc io_shm (telemetry)  │ UDS core.sock (lệnh ghi)
                                                    │  UDS modbus-control.sock │ ghi fieldbus.conf + profiles/*.json
                                                    ▼                          ▼
 mkddc-iobus (C++)                                          mkddc-core (C++)
 ─────────────────                                          ───────────────
 main / vòng IOP 2 ms (SCHED_FIFO 70) ── PTY/UART ─► MCU    scan_loop 1 s (SCHED_FIFO 80)
 mb-bus1  BusWorker ── /dev/rs485-1 → ttyS5 ── slave        ├─ read_ext(): vét fieldbus.sock → plc_shm.ext[]
 mb-bus2  BusWorker ── /dev/rs485-2 → ttyS1 ── slave        ├─ PointWriter: EXT ⇒ ext[i].setpoint + dirty=1
 fb-publish 100 ms: ExtCache → fieldbus.sock (DGRAM) ──────►├─ GraphRuntime / ST: ghi EXT theo slot index
            drain_ext_writes(): đọc plc_shm.ext[].dirty ◄───┘
            publish metrics → io_shm
 fb-control: UDS modbus-control.sock (status/frames/apply_config/read_test/write)
```

Tên thread `mb-bus*`, `fb-*` có từ bản sửa `MBA-FW-01`. Trước đó cả 5 thread đều
mang tên `mkddc-iobus` và đều chạy SCHED_FIFO 70 (đo ở báo cáo bo).

### 2.2 Ba đường dữ liệu

| Đường | Luồng | Hợp đồng |
|---|---|---|
| **Đọc** | BusWorker `read_slave` → `ExtCache` → `push_snapshot` (100 ms, `SOCK_DGRAM`) → core `read_ext` (vét ≤64 datagram, lấy bản mới nhất) → `plc_shm.ext[]` → web đọc SHM → REST/WS → FE | `kx_ext_snapshot_v2_t` (magic `EXT\2`, schema 2, sequence, generation, revision, boot_id, checksum 23 hex); `kx_ext_point_t` 64 byte |
| **Ghi** | nguồn (web force / schedule / graph / ST) → core `PointWriter` hoặc `GraphRuntime::apply_ext_writes` → `ext[i].setpoint`, `ext[i].dirty=1` → iobus `drain_ext_writes` (100 ms, dedup theo `last_written_`) → hàng đợi 64/bus → FC05/06/16 | cờ mức, **không có** request_id, không kết quả trả về |
| **Cấu hình** | FE → candidate/apply hoặc CRUD trực tiếp → BE validate → ghi `fieldbus.conf` + `profiles/<device>.json` (journal + last-known-good) → UDS `apply_config{revision, checksum, path}` → iobus dừng worker ở ranh giới giao dịch, dựng generation mới, ACK | JSON một dòng trên `SOCK_STREAM`, peer credential, frame ≤64 KiB |

## 3. FW SOM (`apps/iobus/adapters/modbus_rtu`, phần EXT của `apps/core`)

### 3.1 Module

| File | Vai trò | Ghi chú hiện trạng |
|---|---|---|
| `bus_worker.{hpp,cpp}` (≈1.500 dòng) | Một BusWorker/một dây: vòng đời cổng (CLOSED→OPENING→RUNNING→PORT_ERROR, backoff 1-2-5-10-30 s), EDF, gộp block, đọc/ghi, readback, probe commissioning, vòng nhớ khung | Lõi của Modbus; phần lớn bản sửa của phiên nằm ở đây |
| `modbus_master.{hpp,cpp}` | Điều phối worker, cấp dải ext slot, cầu nối cờ `dirty` → PendingWrite, `apply_config` có rollback | Thêm lượt mốc + kiểm danh tính slot (`MBA-FW-02`) |
| `poll_scheduler.*`, `poll_group.*` | Hạn poll, probe chậm thiết bị OFFLINE, nhóm fast/normal/slow + ngưỡng stale theo điểm | Ổn |
| `register_codec.*` | Codec 16/32-bit, 4 thứ tự byte/word, encode fail-closed | Có golden vector |
| `device_profile.*` | Parser profile JSON | Trước phiên **không đọc** `bit_index`, `min_value`, `max_value` (`MBA-FW-09`, đã sửa) |
| `ext_cache.*` | Mẫu + quality + mốc thời gian, publish snapshot v2 | Thêm `mark_bad_sample` |
| `fieldbus_metrics.*`, `frame_ring.hpp` | Bộ đếm theo slave/bus (uint64 + boot_id), latency p50/p95, utilization trượt 16 s, E302/E303; vòng nhớ 200 giao dịch | Trước phiên **không có khoá** giữa 3 thread (`MBA-FW-03`, đã sửa); vòng nhớ chỉ ghi giao dịch đọc (`MBA-FW-06`, đã sửa) |
| `control_channel.*` | UDS điều khiển: `status`, `frames`, `apply_config`, `read_test`/`test_connection`, `write` | Một thread, xử lý tuần tự; op `write` bỏ `bus_id` (`MBA-FW-07`, đã sửa) |
| `write_verify.*` | Luật `applied`/`unverified` cho readback | Có test, nhưng kết quả không đi tới ai (xem §3.5) |
| `modbus_tcp.*` | Modbus TCP client | Năng lực ẩn có chủ ý (ADR-055), chạy trong thread publish |
| `thread_policy.hpp` | Hạ thread phụ về SCHED_OTHER + đặt tên | Mới (`MBA-FW-01`) |

### 3.2 Mô hình thread — thiết kế và thực tế

| Thread | FW_SOM_DESIGN §2 | Trước phiên (đo trên bo) | Sau bản sửa (đo trên bo) |
|---|---|---|---|
| main / IOP 2 ms | SCHED_FIFO | FIFO 70 | FIFO 70 |
| BusWorker ×2 | SCHED_OTHER | **FIFO 70** | OTHER (`mb-bus1`, `mb-bus2`) |
| publish 100 ms | (không nêu) | **FIFO 70** | OTHER (`fb-publish`) |
| control | SCHED_OTHER | **FIFO 70** | OTHER (`fb-control`) |
| core scan | SCHED_FIFO | FIFO 80 | FIFO 80 |
| core IPC Programming, RETAIN | (chỉ scan là RT) | **FIFO 80** — trên cả vòng IOP | OTHER (`prog-ipc`, `st-retain`) |

### 3.3 Poll và quality

- EDF theo mức quá hạn, deadline tính lại từ `now`; thiết bị OFFLINE probe theo
  `offline_probe_ms` (mặc định 5 s, **bo đang đặt 1 s**, bằng chính chu kỳ poll).
- Retry thật `retry` lần trong một lượt; `offline_after_errors` tách riêng (Đ-05).
- Gộp block: cùng FC, cùng nhóm poll, liền kề tuyệt đối, ≤125 register / ≤2000 bit.
  Từ phiên này thêm: điểm nằm trọn trong dải đã có (nhiều bit cùng register) đi chung.
- Quality 5 mức (`GOOD/STALE/BAD/OFFLINE/CONFIG_ERROR`) + 11 reason + mã exception gốc.
  Chưa có: bộ đếm `deadline_miss`/`poll_duration` (F-FW-17), phân biệt `DEGRADED`.
- Exception response trước phiên kéo cả thiết bị OFFLINE (`MBA-FW-05`, đã sửa).

### 3.4 Cấu hình nóng

`apply_config` dừng mọi worker (join — chờ lượt poll đang chạy xong), dựng lại
worker, mở cổng, rollback nếu không mở được cổng nào. Tốt: không restart iobus,
không cắt IOP. Hạn chế:
- áp **toàn bộ** cấu hình cho mọi thay đổi nhỏ (kể cả sửa tên Point), mọi lệnh ghi
  đang chờ bị huỷ (`shutdown_drain`);
- thời gian dừng worker không bị chặn trên (≤ tổng `timeout × (retry+1)` các slave đến
  hạn) trong khi BE chờ ACK tối đa **5 s** ⇒ có thể BE báo lỗi và khôi phục file cũ
  trong khi iobus đã chạy bản mới (gap `MBA-GAP-05`).

### 3.5 Đường ghi

| Thành phần | Có trong mã | Được dùng thật |
|---|---|---|
| Cờ `dirty` + setpoint trong `plc_shm` | ✅ | ✅ đường duy nhất |
| Dedup `last_written_` theo slot | ✅ | ✅ |
| Hàng đợi có trần 64/bus, coalesce | ✅ | ✅ |
| TTL 30 s / 3 lần phát (OD-MBRTU-005) | ✅ | ◐ bị vô hiệu trên đường cờ mức — lệnh bỏ xong được tạo lại sau 100 ms (`MBA-FW-08`) |
| Op `write` có `request_id` trên UDS | ✅ | ❌ BE không gọi |
| `WriteResult` applied/unverified/timeout + readback | ✅ | ❌ `set_write_result_sink` không được gọi ở `main.cpp` — kết quả bị bỏ |
| Ghi bit trong register | ❌ | — (trước phiên BE vẫn cho khai, iobus ghi đè cả register; nay bị chặn) |

### 3.6 Dung lượng

`KX_N_EXT = 256` (Đ-07 đã thi hành), 2 bus, `KX_N_FB_SLAVE = 32`, datagram snapshot
≈14,4 KB (72 byte header + 256 × 56 byte). Giá trị trong SHM là `double`, nhưng đường ghi
còn `float` (`PendingWrite.value`, `last_written_`) ⇒ số nguyên 32-bit > 2²⁴ bị làm tròn
khi ghi.

## 4. BE (`apps/web-api`)

### 4.1 Package

| Package / file | Vai trò |
|---|---|
| `internal/modbusrtu` (3.111 dòng) | domain (Device/Point/Bus), validate (định dạng, trùng, chồng vùng, capability cổng, ước lượng tải bus), persistence (journal + LKG + rollback), candidate/diff, import/export, ext layout, control client UDS |
| `internal/app/modbus_*.go` (2.264 dòng) | handler REST, overview/buses/events, frames, write-test, templates, mapping |
| `internal/app/points.go` | danh sách điểm chung (gồm `kind=modbus_rtu`), ghi/force điểm |
| `internal/programming/application/modbus_slots.go` | phân giải `extIndex` của binding Programming theo cấu hình đang chạy (ISS-PIO-31) |

### 4.2 Endpoint (29)

`GET` devices · points · diagnostics · overview · buses · events · frames · mapping ·
ports · templates · export · config/state · config/candidate · config/diff;
`POST` devices · points · import · read-test · write-test · devices/{id}/test-connection ·
config/apply; `PUT` devices/{id} · devices/{id}/enabled · points/{id} · buses/{bus_id} ·
config/candidate; `DELETE` devices/{id} · points/{id} · config/candidate.

### 4.3 Nhận xét

- **Hai đường sửa cấu hình song song**: CRUD trực tiếp (`POST/PUT/DELETE devices|points`)
  áp **ngay** xuống runtime mỗi lần bấm, trong khi `config/candidate` + `config/apply`
  là luồng nháp → duyệt → áp có `base_revision` và `operation_id`. FE dùng cả hai.
- Validator chặt (định dạng ID, unique, chồng vùng có xét bit, dải timeout/poll/retry,
  capability cổng từ manifest). Ước lượng tải bus còn thô: giả định mọi điểm liền kề,
  2 byte/điểm, không cộng thời gian xử lý của slave (bo: ước 20,17 % so với đo 15,88 %).
- Telemetry đọc thẳng `io_shm` theo offset cố định (có test khoá layout).
- Trước phiên: `/modbus/diagnostics` bỏ sót 3 bộ đếm (`MBA-BE-01`), đường ghi chung
  `PUT /api/v1/points/{id}` không ghi được Point Modbus (`MBA-BE-02`). Cả hai đã sửa.
- `write-test` báo `success` ngay khi core **nhận** lệnh, trước khi thiết bị xác nhận.
- Nhật ký sự kiện Modbus (`/modbus/events`) chỉ nằm trong bộ nhớ web — mất khi web
  restart (bo: rỗng sau lần deploy 08:28 dù sáng đó có E302).

## 5. FE (`apps/web-ui/src/features/modbus-rtu`)

| Trang / thành phần | Chức năng | Nguồn dữ liệu |
|---|---|---|
| Overview | KPI thiết bị online/offline, revision/checksum | REST, tự làm mới 5 s khi tab hiển thị |
| Ports | Cấu hình 2 bus, capability cổng | REST, `PUT buses/{id}` |
| Devices | CRUD thiết bị, test-connection | REST (áp ngay) |
| Points | CRUD điểm, giá trị sống, **Ghi thử** | REST + WS (`useModbusRuntime`) |
| Mapping | Point Modbus ↔ Point Catalog | REST |
| Diagnostics | Bộ đếm theo thiết bị/bus, Frame Monitor (làm mới 2 s) | REST |
| `ConfigStateBanner`, `useModbusConfig` | trạng thái candidate/active, apply idempotent | REST |

Điểm tốt: runtime qua WS có "ảnh đầy đủ khi kết nối lại", phân biệt "chưa có số đo" với 0,
quality lạ ⇒ `UNKNOWN` (không đoán GOOD), không bịa số khi telemetry vắng. Điểm cần sửa
ở tầng sản phẩm: thông điệp "Ghi thử … thành công" dựa trên phản hồi của core, không phải
xác nhận từ thiết bị.

## 6. Hợp đồng

| Hợp đồng | Vị trí | Trạng thái |
|---|---|---|
| `kx_ext_point_t` (64 B), `kx_ext_snapshot_v2_t`, quality/reason enum | `contracts/shm/mkddc_shm.h` | v5/v6, có `static_assert` offset |
| `kx_slave_metrics_t`, `kx_modbus_diag_t`, `kx_bus_metrics_t` trong `io_shm` | như trên | BE đọc theo offset, có test layout |
| Control channel JSON | `control_channel.hpp` ↔ `modbusrtu/control_client.go` | BE chưa dùng op `write` |
| `fieldbus.conf` + profile | `fieldbus_config.cpp`, `device_profile.cpp` ↔ `persistence.go` | Có contract-sync test; trước phiên lệch 3 khoá profile (`bit_index`, `min_value`, `max_value`) |
| Schema control | `contracts/config/modbus_control_v1.schema.json` | có |

## 7. Test

| Tầng | Test | Mạnh | Lỗ hổng trước phiên |
|---|---|---|---|
| FW SOM | 180 gtest (phiên thêm 10, cộng 1 test core) | slave libmodbus thật trên PTY, codec golden vector, vòng đời ghi, readback | không test đồng thời, không test exception theo block, không test phát lại sau restart, không test bit/min/max |
| BE | 123 test Go (phiên thêm 5) | validator, persistence rollback, layout SHM, write-test đổi `EXT<n>` | handler diagnostics không bị test qua endpoint; đường ghi chung không có ca Modbus |
| FE | 95 ca vitest | quality, WS reconnect, banner candidate | — |

## 8. Đối chiếu bảng gap FW_SOM_DESIGN §12 (tại ngày audit)

| ID | Nội dung | Trạng thái 2026-09-25 |
|---|---|---|
| F-FW-01 | BusWorker tách rời | ĐÓNG |
| F-FW-02/03/05 | quality 5 mức, timestamp producer, snapshot v2 | ĐÓNG |
| F-FW-04 | value typed double | ◐ SHM là `double`; đường ghi còn `float` |
| F-FW-06 | ghi bằng request/result | **MỞ** — mã có nhưng không nối (`MBA-GAP-01`) |
| F-FW-07 | không replay | ◐ restart: ĐÓNG trong phiên (`MBA-FW-02`); vòng tạo lại lệnh sau khi bỏ: **MỞ** (`MBA-FW-08`) |
| F-FW-09 | admission/utilization | ◐ utilization đo thật; ước lượng admission thô (`MBA-GAP-04`) |
| F-FW-10 | reload tại ranh giới giao dịch | ĐÓNG (có hạn chế §3.4) |
| F-FW-11 | danh tính `point_id` | ◐ đúng cho điểm một slot; mảng dùng tên ghép ≤23 ký tự |
| F-FW-12 | `bit_index` | ĐÓNG trong phiên (đọc); ghi bit **MỞ** |
| F-FW-13 | counter uint64 + boot_id | ĐÓNG |
| F-FW-14 | `min/max` ở producer | ĐÓNG trong phiên |
| F-FW-15 | readback | ◐ có ở iobus, kết quả không tới BE/FE |
| F-FW-16 | slot ổn định theo generation | **MỞ** — ST/graph ghi theo index; iobus nay chặn khi tên slot lệch (`MBA-GAP-02`) |
| F-FW-17 | `deadline_miss`, `poll_duration` | **MỞ** |
| F-FW-18 | hàng đợi có trần | ĐÓNG (64/bus) |
| F-FW-19 | điều hướng RS-485 tường minh | ĐÓNG (enum + đọc lại `TIOCGRS485`) |
| F-FW-20 | ≥256 Point | ĐÓNG |

## 9. Kết luận

Mã Modbus của MK-DDC-24 đã có nền đọc/giám sát chắc chắn và được chú thích kỹ. Rủi ro
nằm ở ba chỗ: (1) đường **ghi** dùng cờ mức không có danh tính lệnh nên không thể vừa
"không phát lại" vừa "gửi lại được cùng giá trị"; (2) **danh tính slot** vẫn là index
ở runtime ST/graph; (3) **quan sát vận hành** chưa đi tới hệ cảnh báo và không bền qua
restart. Ba chỗ này là nội dung của hai phương án trong báo cáo finding.

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-25 | Tạo mới từ audit Modbus FE/BE/FW SOM |
