# Modbus RTU — Docs Sync Report

**ID:** DDC24-MBRTU-DOCS-SYNC-2026-08-04
**Ngày:** 2026-08-04, múi giờ Asia/Ho_Chi_Minh
**Repository:** `Mekong-HCM/MK-DDC-24`
**Nhánh/commit tại thời điểm audit:** `agent/rst205-closure` / `554b861`
**Phạm vi:** Modbus RTU, RS485-1/RS485-2, Modbus RTU Device, Modbus RTU Point,
đọc/ghi/giám sát/diagnostics
**Ngoài phạm vi:** Modbus TCP, BACnet/IP, Programming ST/FBD, sửa source

> Đây là **record** của một lần đồng bộ tài liệu. Nó không phải Design, không phê
> duyệt thiết kế và không thay đổi bất kỳ source nào.

## 1. Việc đã làm

Đối chiếu đồng thời: Product Spec (`PRODUCT.md`), requirements, architecture,
interfaces, verification, traceability, decision log, document control; source
FE (`apps/web-ui`), BE (`apps/web-api`), FW-SOM (`apps/iobus`, `apps/core`);
contract (`contracts/shm/mkddc_shm.h`, `contracts/openapi/openapi.yaml`);
cấu hình/persistence; và báo cáo `DDC24_FE_BE_FW_SOM_AS_BUILT_STATUS_AUDIT.md`.

**Không chạy test trong phiên này** vì nhiệm vụ là tài liệu và cấm sửa source.
Số đo test được dẫn nguyên trạng từ record trước (`751/751` CTest full-option,
Go pass, FE `299/299`) và **không** được dùng làm bằng chứng mới cho bất kỳ gate
Modbus RTU nào.

## 2. Tài liệu đã tạo

| # | Tài liệu | ID | Trạng thái |
|---|---|---|---|
| 1 | `docs/01_product/MODBUS_RTU_PRODUCT_REQUIREMENTS.md` | PROD-MBRTU-001 | In Review |
| 2 | `docs/04_uiux/MODBUS_RTU_UI_UX_DESIGN.md` | UX-WEB-MBRTU-001 | In Review |
| 3 | `docs/02_design/software/MODBUS_RTU_FE_DESIGN.md` | DDD-FE-MBRTU-001 | In Review |
| 4 | `docs/02_design/software/MODBUS_RTU_BE_DESIGN.md` | DDD-BE-MBRTU-001 | In Review |
| 5 | `docs/02_design/software/MODBUS_RTU_FW_SOM_DESIGN.md` | DDD-FW-MBRTU-001 | In Review |
| 6 | `docs/02_design/software/MODBUS_RTU_DATA_MODEL.md` | DDD-DM-MBRTU-001 | In Review |
| 7 | `docs/02_design/interfaces/MODBUS_RTU_API_SPEC.md` | ICD-API-MBRTU-001 | In Review |
| 8 | `docs/02_design/interfaces/MODBUS_RTU_INTERFACE_SPEC.md` | ICD-IF-MBRTU-001 | In Review |
| 9 | `docs/05_verification/MODBUS_RTU_VERIFICATION_PLAN.md` | VVP-MBRTU-001 | In Review |
| 10 | `docs/07_records/MODBUS_RTU_TRACEABILITY_MATRIX.md` | TRACE-MBRTU-001 | Active |
| 11 | `docs/00_governance/MODBUS_RTU_OPEN_DECISIONS.md` | OD-MBRTU-SET-001 | Active |
| 12 | `docs/07_records/reviews/MODBUS_RTU_DOCS_SYNC_REPORT.md` | tài liệu này | Active |

## 3. Tài liệu đã cập nhật

| Tài liệu | Thay đổi |
|---|---|
| `docs/01_product/PRODUCT.md` | thêm dòng đăng ký `PROD-MBRTU-001`; ghi rõ xung đột hai bus chưa đóng |
| `docs/02_requirements/REQUIREMENTS.md` | thêm `SWR-REQ-MBRTU-010`, `SWR-REQ-MBRTU-011`, `NFR-REQ-MBRTU-004` |
| `docs/04_design/SOFTWARE.md` | mở rộng mục Modbus RTU: trỏ tới bộ FE/BE/FW/data model |
| `docs/04_design/INTERFACES.md` | trỏ tới `ICD-IF-MBRTU-001` và `ICD-API-MBRTU-001`; giữ nguyên ràng buộc không sửa OpenAPI trước ADR-024 |
| `docs/05_verification/VERIFICATION.md` | thêm `VR-MBRTU-013`, `VR-MBRTU-014`; trỏ `VVP-MBRTU-001` |
| `docs/07_records/TRACEABILITY.md` | thêm dòng cho requirement mới; trỏ `TRACE-MBRTU-001` |
| `docs/00_governance/DECISIONS.md` | bổ sung diễn giải ADR-024 và trỏ `OD-MBRTU-SET-001` |
| `docs/00_governance/CONTROL.md` | đăng ký 12 tài liệu mới vào controlled register |
| `docs/README.md` | thêm mục điều hướng Modbus RTU |
| `docs/02_design/software/README.md`, `docs/02_design/interfaces/README.md`, `docs/04_uiux/README.md` | thêm entry index |
| `docs/03_implementation/26_MODBUS_IMPLEMENTATION_PLAN.md` | banner **SUPERSEDED một phần** |
| `docs/02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md` | banner **SUPERSEDED một phần** |
| `docs/02_design/interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md` | banner **SUPERSEDED một phần** |
| `CHANGELOG.md` | entry `[Unreleased]` |

## 4. Kết quả audit hiện trạng

### 4.1 Phần đã có và hoạt động (host/lab)

| Hạng mục | Bằng chứng source |
|---|---|
| Modbus RTU master một bus qua libmodbus | `apps/iobus/adapters/modbus_rtu/modbus_master.cpp` |
| Profile parser + validate per-point, đếm ext slot một nguồn chân lý | `device_profile.{hpp,cpp}` — `ext_slots_for_point()` |
| Codec bool/int16/uint16/int32/uint32/float32, AB/BA/ABCD/BADC/CDAB/DCBA | `register_codec.*` |
| Poll scheduler có retry và offline detect | `poll_scheduler.*`, `modbus_master.cpp` |
| Fail-closed khi thiếu profile/hết slot (không báo ONLINE giả) | `modbus_master.cpp:265-284` |
| Device/Point CRUD + validate + tag namespace + capacity 64 | `apps/web-api/internal/modbusrtu/domain.go` |
| Persist `fieldbus.conf` + profile + revision + checksum + rollback khi restart lỗi | `persistence.go` |
| REST 9 endpoint + RBAC route | `apps/web-api/internal/app/http.go:148-156` |
| Point Modbus vào Core Point Table và ra `/points`/WebSocket | `point_table.hpp` `PointKind::EXT`, `core_client.go:815-849` |
| FE trang quản lý Device/Point/diagnostics | `apps/web-ui/src/features/modbus-rtu/ModbusRtuPage.tsx` |

### 4.2 Có source nhưng chưa nối end-to-end

| Hạng mục | Vì sao chưa nối |
|---|---|
| Write path Modbus | `drain_ext_writes()` đọc `plc_shm.ext[].dirty/setpoint`, nhưng **không có endpoint hay UI nào** đặt được cờ này; chỉ node graph `Modbus_RTU_Write` làm được |
| `expose_bacnet` trong profile | iobus đọc được, nhưng `BuildProfile()` của BE không bao giờ sinh field này ⇒ tính năng không có đường cấu hình (`OD-MBRTU-014`) |
| Modbus TCP | có `modbus_tcp.*` và `tcp_slaves` trong config, ngoài phạm vi nhiệm vụ này, nhưng cần ghi nhận vì dùng chung dải ext slot |

### 4.3 Mock/placeholder

Không tìm thấy mock trong đường Modbus RTU của BE/FW-SOM: đường chạy dùng
libmodbus thật, chỉ khác ở chỗ transport là PTY trong test. **Không có** thiết bị
RS485 thật và không có `fieldbus.conf` trên target ⇒ toàn bộ evidence hiện tại là
host/simulator.

FE có suy diễn hiển thị (không phải mock nhưng sai nguyên tắc authority):
`ModbusRtuPage.tsx:113` tự tính quality từ `online`/`consecutive_errors`, và
`:108` mặc định `'bad'` khi thiếu runtime.

### 4.4 Thiếu tài liệu thiết kế — đã đóng trong phiên này

Trước phiên: có `DDD-SW-MBRTU-POINT-001` (design tổng), `MODBUS_REGISTER_MAP`
(ICD cũ), `SW_FIELDBUS_DESIGN` (service design cũ) và `26_MODBUS_IMPLEMENTATION_PLAN`.
**Không có**: product/use case riêng, UI/UX, FE design, BE design, FW-SOM runtime
design, data model, API spec, interface end-to-end, verification plan, traceability
riêng, open decisions riêng. Cả 12 đã được tạo.

## 5. Mâu thuẫn đã xử lý

| # | Mâu thuẫn | Xử lý trong phiên này |
|---|---|---|
| C-01 | `PRODUCT.md` ghi `2 × Modbus RTU`; `HW_SPEC` §9 và bảng UART chỉ có UART4 + một connector + một SW8 termination; source có một master | **Không tự quyết**. Giữ Product baseline hai bus trong thiết kế, đánh dấu `PROPOSED`, ghi thành `OD-MBRTU-001` P0 và ghi rõ trong `PRODUCT.md` là xung đột chưa đóng |
| C-02 | Serial format ở Device (BE/FE/đề bài) vs ở Bus (`DDD-SW-MBRTU-POINT-001`) | Chốt canonical ở Bus, Device kế thừa read-only, **vẫn trả** các field trên response Device để không vỡ UI; ghi `OD-MBRTU-002` |
| C-03 | `MODBUS_REGISTER_MAP` v2.0 `Approved` mô tả một bus RS-485 và ext cache kiểu cũ | Đánh dấu SUPERSEDED một phần, trỏ sang bộ tài liệu mới |
| C-04 | `26_MODBUS_IMPLEMENTATION_PLAN` §3 mô tả ext contract `float`/3 quality/`dirty` là "gap CLOSED" | Đánh dấu SUPERSEDED một phần: contract đó là As-Built v1, không phải target |
| C-05 | `SW_FIELDBUS_DESIGN` mô tả fieldbus ghi thẳng shared memory | Đánh dấu SUPERSEDED một phần; kiến trúc hiện hành là iobus → datagram → core → SHM |
| C-06 | Đề bài yêu cầu quality tối thiểu 5 mức gồm `CONFIG_ERROR`; `SWR-REQ-MBRTU-005` Active chỉ ghi 4 mức | Thiết kế 5 mức, ghi phần mở rộng thành `OD-MBRTU-016`; **không** tự sửa requirement Active |
| C-07 | Đề bài yêu cầu 4 vai trò; ADR-021 Active chỉ có 3 | Dùng vai trò nghiệp vụ trong tài liệu, ánh xạ rõ sang 3 vai trò kỹ thuật, ghi `OD-MBRTU-009` |
| C-08 | `read_write` (Go/TS/OpenAPI) vs `access_mode` (thiết kế mới) | Chọn `access_mode` cho contract v2 + alias deprecated; ghi `OD-MBRTU-010` |
| C-09 | slave ID unique toàn cục (BE) vs unique trong bus (design) | Chốt unique trong bus; ghi thành gap `F-BE-08` |
| C-10 | Audit as-built dùng path cũ (`services/`, `web/backend`, `src/frontend`) sau khi Plan 46 đã restructure | Mọi trích dẫn source trong bộ tài liệu mới dùng path hiện hành `apps/*`, `contracts/*` |

## 6. Danh sách gap giữa thiết kế và source

Tổng hợp từ các mục "sai khác" của từng tài liệu. **P0 = chặn implementation đúng
đắn; P1 = chặn nghiệm thu; P2 = chất lượng.**

### 6.1 P0 (18)

| ID | Nội dung |
|---|---|
| G-DM-01 / F-FW-01 | Một bus/một `ModbusMaster`; thiết kế cần hai BusWorker độc lập |
| G-DM-02 / F-FW-02 | quality 3 mức, không reason |
| G-DM-03 / F-FW-03 / F-BE-15 / F-IF-08 | không có timestamp của producer; BE gán `time.Now()` |
| G-DM-04 / F-FW-04 | `value` là `float`, mất chính xác `uint32` |
| G-DM-07 / F-BE-03 | không có candidate/LKG/journal bền vững; snapshot rollback chỉ trong RAM handler |
| F-BE-01 / F-FW-10 / F-IF-03 | apply = restart iobus, không phải ACK revision/checksum |
| F-BE-02 / F-FE-02 / F-API-02 | mỗi CRUD tự apply |
| F-BE-05 / F-API-04 | không có idempotency `operation_id` |
| F-BE-06 / F-API-03 | không có optimistic concurrency `base_revision` |
| F-BE-07 | `RS485` sinh từ device enabled đầu tiên |
| F-BE-10 / F-API-07 / F-UX-05 / F-FE-08 | không có commissioning read/write/test-connection |
| F-FW-05 / F-IF-01 | snapshot không có sequence/generation/revision/checksum |
| F-FW-06 / F-IF-02 | write không có request/result; chỉ `dirty/setpoint` |
| F-FW-07 | cờ `dirty` còn lại có thể phát lại lệnh sau restart |
| F-IF-05 | contract không có khái niệm `bus_id` |
| F-IF-09 / F-FE-06 | cổng serial là chuỗi tự do, không có capability manifest |
| F-FE-03 / G-UX-09 | xoá Device/Point không có xác nhận |
| F-FE-04, F-FE-05 / G-UX-08 | FE suy diễn quality và mặc định `BAD` khi thiếu runtime |
| F-FE-11 / G-UX-01 | route FE khoá ở `admin` ⇒ Viewer không giám sát được |

### 6.2 P1 (16)

`G-DM-05` checksum không canonical · `G-DM-06` thiếu `bit_index`/`min-max`/poll theo point ·
`G-DM-08` serial ở Device · `G-DM-09` identity đổi với profile `count>1` ·
`G-DM-10` không import/export · `G-DM-11` connection_status thiếu trạng thái ·
`F-BE-08` slave ID unique toàn cục · `F-BE-09` checksum phụ thuộc thứ tự map ·
`F-BE-13` không admission control · `F-BE-14` diagnostics ghép sai khi hai bus trùng slave ·
`F-BE-18` audit thiếu target/old/new · `F-FW-08` scheduler không probe chậm ·
`F-FW-11` `ext_point_name` đổi identity · `F-FW-13` counter uint32 không boot id ·
`F-FW-15` không readback · `F-IF-06`/`F-IF-07` tên field lệch và không có test cross-language ·
`F-API-09`/`F-API-10`/`F-API-12` thiếu overview/events/bus/mapping và metadata stream

### 6.3 P2 (6)

`F-BE-12` enable/disable không tách audit · `F-BE-16` retry range lệch (`1..10` vs `0..3`) ·
`F-BE-17` poll min 10 ms (quá nhỏ cho RTU) · `F-FE-13` ép `Number()` cho `bool` ·
`F-FW-16` slot base dịch khi device lỗi · `G-UX-10` address không có nhãn convention

## 7. Open decision cần CTO/Product phê duyệt

P0: `OD-MBRTU-001` (hai bus hay một), `OD-MBRTU-002` (serial thuộc Bus),
`OD-MBRTU-005` (ưu tiên commissioning write), `OD-MBRTU-009` (4 vai trò / mở
Viewer đọc), `OD-MBRTU-015` (chiến lược đổi ABI v1→v2).

P1: `OD-MBRTU-003`, `OD-MBRTU-006`, `OD-MBRTU-007`, `OD-MBRTU-010`,
`OD-MBRTU-011`, `OD-MBRTU-014`, `OD-MBRTU-016`.

P2: `OD-MBRTU-004`, `OD-MBRTU-008`, `OD-MBRTU-012`, `OD-MBRTU-013`.

Chặn từ bên ngoài: `OD-MBRTU-EXT-01` (chưa có owner tên thật cho Fieldbus/QA-HIL/HW),
`OD-MBRTU-EXT-02` (chưa có slave RS485 thật và thiết bị đo),
`OD-MBRTU-EXT-03` (ADR-022 provenance còn Proposed).

Chi tiết tại [OD-MBRTU-SET-001](../../00_governance/MODBUS_RTU_OPEN_DECISIONS.md).

## 8. Điều đã **không** làm (và vì sao)

| Việc | Lý do |
|---|---|
| Sửa source FE/BE/FW-SOM | quy tắc nhiệm vụ: không sửa source |
| Sửa `contracts/openapi/openapi.yaml` | `INTERFACES.md` cấm sửa contract machine-readable trước khi ADR-024 Accepted |
| Đổi ADR-024 sang Accepted | không tự tuyên bố thiết kế đã được phê duyệt |
| Sửa `SWR-REQ-MBRTU-005` để thêm `CONFIG_ERROR` | requirement Active chỉ được đổi qua decision; đã ghi `OD-MBRTU-016` |
| Đóng `OD-MBRTU-001` bằng cách chọn một bus | quyết định Product/HW, không phải quyết định tài liệu |
| Chạy test | không sửa source nên không có gì mới để kiểm chứng; số cũ không được tái sử dụng làm evidence mới |
| Xoá các tài liệu Modbus cũ | quy tắc: không xoá lịch sử quyết định; đã đánh SUPERSEDED một phần |

## 9. Kết luận bắt buộc

```text
MODBUS_RTU_REQUIREMENTS_COMPLETE   = YES
MODBUS_RTU_UI_UX_DESIGN_COMPLETE   = YES
MODBUS_RTU_BE_DESIGN_COMPLETE      = YES
MODBUS_RTU_FW_SOM_DESIGN_COMPLETE  = YES
MODBUS_RTU_INTERFACES_SYNCHRONIZED = YES
MODBUS_RTU_VERIFICATION_DEFINED    = YES

READY_FOR_MODBUS_RTU_IMPLEMENTATION = CONDITIONAL
```

### 9.1 Vì sao bốn `*_COMPLETE` là `YES`

Bộ requirement (`SYS/SWR/IF/SEC/NFR-REQ-MBRTU-*` cộng ba requirement mới) phủ đủ
mọi use case đề bài; UI/UX có đủ năm page với mục tiêu, role, workflow, wireframe,
component, field/validation, bốn state, confirmation, API và acceptance criteria;
BE có transaction, validator, admission, commissioning, RBAC/audit; FW-SOM có
ownership, thread model, scheduler, codec, quality, write path, reload, capacity,
startup/shutdown/recovery.

### 9.2 Vì sao `MODBUS_RTU_INTERFACES_SYNCHRONIZED = YES`

`ICD-IF-MBRTU-001` định nghĩa một mô hình Point duy nhất và bốn phép chiếu tường
minh, kèm bảng ánh xạ tên field và interface matrix 16 dòng. Sau phiên này **không
còn tài liệu Active nào mô tả một mô hình Modbus Point khác**: ba tài liệu cũ mâu
thuẫn đã được đánh SUPERSEDED một phần với danh sách cụ thể phát biểu nào không
còn hiệu lực.

Lưu ý phạm vi: `YES` ở đây nói về **tài liệu đã đồng bộ**, không nói source đã
conform. Source hiện chưa conform — xem §6.

### 9.3 Vì sao `READY_FOR_MODBUS_RTU_IMPLEMENTATION = CONDITIONAL`, không phải `YES`

Điều kiện `YES` đòi hỏi **không còn tài liệu Active mâu thuẫn** *và* **mọi
interface FE–BE–FW-SOM đã được định nghĩa đầy đủ**. Điều kiện thứ hai đã đạt.
Điều kiện thứ nhất **chưa** đạt trọn vẹn vì hai lý do thực chất:

1. **`PRODUCT.md` (Active) yêu cầu hai Modbus RTU master; `HW_SPEC` (Active) chỉ
   mô tả một đường RS-485.** Đây là hai tài liệu Active mâu thuẫn nhau về một sự
   thật vật lý. Không tài liệu nào có thẩm quyền đóng nó — cần Product/HW decision
   (`OD-MBRTU-001`). Nếu implement theo hai bus mà phần cứng chỉ có một, người
   dùng sẽ cấu hình được Point trên bus không tồn tại.
2. **Toàn bộ bộ thiết kế mới đang `In Review`, và ADR-024 vẫn `Proposed`.** Theo
   `CONTROL.md`, chỉ tài liệu `Active` mới là baseline. Bắt đầu implement theo một
   design chưa được duyệt là đúng thứ tự sai.

### 9.4 Điều kiện chính xác để chuyển sang `YES`

1. `OD-MBRTU-001` được quyết định và `PRODUCT.md` + `HW_SPEC` khớp nhau.
2. ADR-024 chuyển `Proposed → Accepted`.
3. Năm open decision P0 (`OD-MBRTU-001/002/005/009/015`) được ký.
4. Bộ 12 tài liệu chuyển `In Review → Active` sau review của Product, System/SW
   Architect, Fieldbus, HW/Platform, Security/Safety và QA.
5. `OD-MBRTU-EXT-01` có owner tên thật cho Fieldbus Lead và QA/HIL Lead.

Bốn mục 1–4 nằm hoàn toàn trong tầm quyết định nội bộ và không cần phần cứng mới.
Mục 5 cần quyết định nhân sự.

**Có thể bắt đầu ngay mà không cần chờ:** không. Việc gần nhất được phép làm là
**review và phê duyệt bộ tài liệu này**, không phải viết code.

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-04 | Tạo record đồng bộ tài liệu Modbus RTU: 12 tài liệu mới, 14 tài liệu cập nhật, 10 mâu thuẫn, 40 gap, 19 open decision |
