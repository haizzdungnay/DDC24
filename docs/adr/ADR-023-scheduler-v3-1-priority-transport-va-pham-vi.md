# ADR-023: Scheduler v3.1 — phân xử priority, lớp vận chuyển và phạm vi Rev A

- Date: 2026-08-07
- Owner: PM + CTO (phê duyệt), Nhóm Phần mềm MK-DDC-24 (đề xuất)
- Status: **Accepted** — PM/CTO duyệt 6 quyết định gốc ngày 2026-08-07; **bổ sung QĐ-7/8/9 cùng ngày** sau review P1 (xem §Bổ sung)
- Related: [Tờ trình phê duyệt](../07_records/reviews/SCHEDULER_V3_1_APPROVAL_REQUEST_2026-08-07.md) ·
  [Plan 50](../03_implementation/50_SCHEDULER_V3_1_IMPLEMENTATION_PLAN.md) ·
  [Proposal UI/UX/UC](../04_uiux/KX-DDC24-UIUX-UC-WEB-SCHEDULER-PROPOSAL-001_VI.md) ·
  [Đặc tả v3.1](../CHUONG_YEU_CAU/scheduler.md) ·
  [ADR-021](ADR-021-restructure-core-and-backend-by-domain.md) (3 vai trò người dùng)

## Vấn đề (1 câu)

Đặc tả `Scheduler Engine v3.1` được viết cho một **gateway đa controller**, còn MK-DDC-24 là
một **DDC đơn** — ba yêu cầu của đặc tả không có chỗ dựa trong kiến trúc thật, và phải được
quyết trước khi viết dòng code đầu tiên vì chúng đổi hình dạng dữ liệu.

---

## Quyết định 1 — Priority ghi 1..16 phân xử **bên trong lớp scheduler**

### Bối cảnh

Mọi lệnh ra đầu ra vật lý đi qua `PriorityResolver` **6 mức**
([`priority_resolver.hpp:15-21`](../../apps/core/domain/priority/priority_resolver.hpp#L15-L21)):

```
1 = PRIO_FIRE_SAFETY   ← có ràng buộc an toàn T7, đã qua kiểm chứng
2 = PRIO_LOCAL_MANUAL
3 = PRIO_BACNET
4 = PRIO_SCHEDULE      ← toàn bộ hệ thống lịch dùng đúng một mức này
5 = PRIO_LOCAL_LOGIC
6 = PRIO_DEFAULT
```

Đặc tả yêu cầu mỗi Schedule Object có `priority_for_writing` ∈ [1, 16].

### Quyết định

`ScheduleRuntime` **tự phân xử 1..16 giữa các lịch cùng ghi một điểm**; chỉ lịch thắng được
đưa xuống `PRIO_SCHEDULE` của `PriorityResolver`. **Không mở rộng `PriorityResolver` lên 16
mức. Không chạm đường Fire/Safety.**

```
SCH-001 prio 4  ──┐
SCH-007 prio 16 ──┼──► phân xử trong ScheduleRuntime ──► SCH-001 thắng ──► PRIO_SCHEDULE (4)
SCH-012 prio 9  ──┘                                                            │
                                                                    PriorityResolver 6 mức
```

Quy tắc phân xử, theo thứ tự:

1. `priority_for_writing` nhỏ hơn thắng.
2. Bằng nhau ⇒ event bắt đầu muộn hơn thắng (giữ hành vi "khoảng vừa bắt đầu thì thắng" hiện có).
3. Vẫn bằng ⇒ lịch đứng sau trong danh sách thắng, và **ghi cảnh báo `SCH-CONFIG-003`** để
   người dùng thấy được xung đột thay vì để hệ thống âm thầm chọn hộ.

### Hệ quả phải chấp nhận

Một lịch đặt `priority_for_writing = 1` **vẫn không thắng được lệnh tay tại chỗ** (mức 2 của
resolver). Đây là hành vi **có chủ ý**: một lịch tự động không nên đè được lệnh của kỹ thuật
viên đang đứng trước tủ điện. Giao diện phải nói rõ điều này bằng chữ, không để người dùng đoán.

### Phương án bị loại

Nâng `PriorityResolver` lên 16 mức: 8–12 người-ngày, phải chứng minh lại toàn bộ logic trạng
thái an toàn và chạy lại 743 test, để đổi lấy một ngữ nghĩa mà trên một DDC 4 AO + 4 DO không
ai quan sát được sự khác biệt.

---

## Quyết định 2 — MQTT ngoài phạm vi Rev A

### Bối cảnh

Rà soát toàn bộ mã nguồn: **không có một dòng MQTT nào**. Backend (Go) và Controller (C++)
chạy **cùng một bo**, trao đổi qua SHM và Unix socket. Đặc tả §14 mô tả 5 topic MQTT với QoS 1,
chống replay, xác thực thiết bị — thiết kế cho kịch bản một máy chủ trung tâm quản lý nhiều
controller qua mạng.

### Quyết định

**Không triển khai MQTT ở Rev A.** Giữ transport nội bộ hiện tại, nhưng **bắt buộc dựng đủ
ngữ nghĩa** đặc tả đòi:

| Ngữ nghĩa | Nơi hiện thực |
|---|---|
| `revision` | Backend, tăng sau mỗi cập nhật |
| `correlation_id` | Backend sinh, core trả lại trong ACK |
| ACK/NACK | Kênh core→BE, kèm mã lỗi spec §11 |
| Timeout chờ ACK | Backend, 5 s |
| Retry có trần | Backend |
| Chống áp dụng lặp cùng revision | Core, idempotent theo `(schedule_id, revision)` |

MQTT vào roadmap **Rev B**, gắn với kiến trúc gateway/multi-controller. Vì ngữ nghĩa đã đủ,
việc thay lớp vận chuyển về sau **không đụng tới giao diện**.

---

## Quyết định 3 — Giữ trần 32 target/lịch, hiển thị dung lượng thật

Bo có **64 điểm ghi nội bộ** (`KX_N_AO`4 + `KX_N_DO`4 + `KX_N_AV`32 + `KX_N_BV`16 + `KX_N_MSV`8,
[`mkddc_shm.h:69-74`](../../contracts/shm/mkddc_shm.h#L69-L74)) cộng `KX_N_EXT` 256 điểm Modbus.

**Quyết định:** giữ đúng con số 32 target/lịch của đặc tả. Giao diện **bắt buộc** hiển thị
dung lượng thật của controller và cảnh báo khi gần/vượt giới hạn — không cắt con số đặc tả,
nhưng cũng không để người dùng tin vào một con số không có phần cứng đỡ.

---

## Quyết định 4 — BACnet Schedule (17) và Calendar (6) ở pha P4

Bảng đối tượng hiện có AI/BI/AO/BO/AV/BV/MSV + Device
([`bacnet_objects.hpp:4`](../../apps/iobus/adapters/bacnet/bacnet_objects.hpp#L4)); **không có**
type 17 và type 6.

**Quyết định:** hiện thực ở **P4**, sau khi mô hình dữ liệu và runtime ổn định. **Không để
BACnet chặn P1–P3.** Hợp đồng v3.1 vẫn sinh trường `bacnet_object` từ P1 để không phải di trú
dữ liệu lần hai.

**Không dùng mốc BTL để chặn P1–P3** (trả lời C-2 của tờ trình). Nếu sau này có deadline BTL
cụ thể, PM/CTO điều chỉnh thứ tự P4 riêng.

---

## Quyết định 5 — Giữ 3 vai trò, thêm 4 quyền thao tác

Hệ thống có 3 vai trò `viewer`/`operator`/`admin`
([`auth/service.go:22-24`](../../apps/web-api/internal/auth/service.go#L22-L24)); đặc tả §19
liệt kê 6 vai trò nhưng câu cuối của chính §19 đòi "quyền riêng" cho publish/rollback/xoá/priority.

**Quyết định:** giữ 3 vai trò, bổ sung 4 quyền thao tác:

```
schedule.publish    schedule.rollback    schedule.delete    schedule.priority
```

Ánh xạ 6 vai trò của đặc tả:

| Vai trò đặc tả | Vai trò thật | Quyền thêm |
|---|---|---|
| Viewer | `viewer` | — |
| Operator | `operator` | — (bật/tắt lịch đã publish) |
| Engineer | `admin` | — |
| Commissioning Engineer | `admin` | `schedule.publish`, `schedule.priority` |
| Administrator | `admin` | `schedule.rollback`, `schedule.delete` |
| Auditor | `viewer` | đọc revision + audit |

Không phá [ADR-021](ADR-021-restructure-core-and-backend-by-domain.md) và không tăng bề mặt
quản trị mà khách hàng phải hiểu.

---

## Quyết định 6 — Di trú tự động cấu hình lịch đang chạy

**Quyết định:** backend nhận diện định dạng khi nạp, chuyển đổi một chiều v1 → v3.1, ghi bản
mới, **giữ bản cũ thành `schedule.conf.v1.bak` và không xoá**. Giao diện hiện băng thông báo
bắt buộc cho tới khi người dùng review và xác nhận. Kiểm chứng bằng test round-trip trên
**tập tin thật lấy từ bo lab**, không phải tập tin bịa.

Quy tắc chuyển đổi mỗi `ScheduleRow` v1 → 1 Schedule Object v3.1:

```
v1: startTime=08:00, endTime=17:00, value=1, weekdays=[MON..FRI], target=DO-01
                              ↓
v3.1: value_type suy từ scheduleType; schedule_default = giá trị nghỉ của kiểu;
      weekly_schedule.MON..FRI = [ {08:00:00, 1}, {17:00:00, default} ];
      target_objects = [ DO-01 ]; status = DRAFT; migrated_from_v1 = true
```

`holiday_period` v1 (vốn tắt toàn cục) chuyển thành **exception có `event_priority = 1` thêm
vào mọi lịch đang bật** — giữ nguyên hành vi người dùng đang thấy, đồng thời đưa nó vào đúng
mô hình mới.

---

---

## Bổ sung 2026-08-07 — QĐ-7, QĐ-8, QĐ-9 (sau review P1)

Review P1 phát hiện 10 finding; ba trong số đó cần quyết định kiến trúc. PM/CTO duyệt cùng ngày.
Chi tiết: [Review P1](../07_records/reviews/SCHEDULER_V3_1_P1_REVIEW_2026-08-07.md) ·
[P1_EXIT_REVIEW](../07_records/reviews/SCHEDULER_V3_1_P1_EXIT_REVIEW_2026-08-07.md).

### QĐ-7 — Giữ target `EXT`, hoàn thiện đường ghi qua **đường ghi dùng chung**

Nhóm kỹ thuật đề xuất gỡ `EXT` khỏi hợp đồng Rev A. **CTO bác đề xuất đó**: Modbus RTU Point là
capability đã xác định cho DDC-24, không được rút.

Yêu cầu kiến trúc kèm theo — và đây mới là phần quan trọng:

```
Nguồn điều khiển (Lịch · Web/lệnh tay · Logic)
        │
        ▼
   PointWriter          ← đường ghi DÙNG CHUNG, một chỗ duy nhất
        │
        ├──► PointTable                    (mọi point ảo)
        └──► plc_shm.ext[idx].setpoint
             plc_shm.ext[idx].dirty = 1    (chỉ EXT)
                    │
                    ▼
                 IOBus ──► Modbus RTU Device
```

**Cấm `ScheduleRuntime` tự ghi thẳng SHM bằng một đường riêng.** Phải dùng chung đường ghi với
mọi nguồn điều khiển khác để giữ arbitration, validation và diagnostics nhất quán.

Hiện thực: `apps/core/domain/graph/point_writer.{hpp,cpp}`. `ScheduleRuntime::evaluate()` đổi
tham số từ `PointTable&` sang `PointWriter&`, nên một nguồn mới quên đi qua đường chung sẽ
**không biên dịch được** — bắt lỗi lúc build thay vì lúc thiết bị không chạy.

Trạng thái chỉ được ghi:

```text
EXT_IMPLEMENTED       = YES
EXT_PHYSICAL_VERIFIED = NO
```

cho tới khi plan 49 hoàn thành HIL RS-485 thật (`G-C`, `G-D`). Không tài liệu nào được viết như
thể lập lịch cho điểm Modbus đã chạy trên thiết bị thật.

### QĐ-8 — Kiểm chứng di trú trên `schedule.conf` **thật** của bo lab

Lấy **bản sao** từ bo, chạy di trú trong môi trường dev, **đối chiếu 100% lịch trước/sau**.
Không thay đổi trực tiếp cấu hình trên bo đang chạy.

Công cụ: `TestMigrationAgainstRealBoardConfig` (chỉ đọc tệp được trỏ tới; mọi thao tác ghi diễn
ra trong thư mục tạm).

```bash
MKDDC_REAL_SCHEDULE_CONF=/đường/dẫn/schedule.conf \
  go test ./internal/app/ -run TestMigrationAgainstRealBoardConfig -v
```

Không đặt biến môi trường thì test **SKIP** — và **SKIP không phải PASS**. Rủi ro R-01 chỉ được
coi là đóng khi lệnh trên chạy thật với tệp của bo.

### QĐ-9 — Audit của Schedule đã xoá: lưu trữ lâu dài

Chuyển sang vùng lưu trữ riêng, **không xoá**:

```text
schedule.d/_deleted/<schedule-id>-<timestamp>/
```

Không được xoá `audit.jsonl`, lịch sử revision, hay bản ghi `DELETE` cuối cùng. Hiện thực:
`archiveScheduleState()` — dùng `os.Rename`, và trong toàn module **không còn hàm nào xoá được
audit**.

---

## Trạng thái các cổng sau ADR này

```text
PLAN_50_APPROVED        = YES
QĐ_1..6                 = APPROVED_PA_1
DATA_CONTRACT_FREEZE    = APPROVED
P0_START                = IMMEDIATE
MQTT_REV_A              = OUT_OF_SCOPE
BACNET_SCHEDULE         = P4
PHYSICAL_IO_VERIFIED    = NO   ← không được tuyên bố production-ready khi cờ này còn NO
EXT_IMPLEMENTED         = YES  (QĐ-7)
EXT_PHYSICAL_VERIFIED   = NO   (QĐ-7 — chờ plan 49 G-C/G-D)
MIGRATION_REAL_FILE     = BLOCKED  (QĐ-8 — chờ bản sao schedule.conf từ bo lab)
```

## Ba nguyên tắc PM/CTO yêu cầu giữ đúng

1. **Đóng băng data contract trước khi code P1.**
2. **Simulation phải dùng chung evaluation engine với controller** — cấm cài lại thuật toán
   đánh giá trong Go.
3. **Không tuyên bố production-ready khi chưa có kiểm chứng I/O vật lý.**
