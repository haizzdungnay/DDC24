# Modbus RTU — Backend Design DDC-24 Rev A

**ID:** DDD-BE-MBRTU-001
**Phiên bản:** 0.1
**Trạng thái:** In Review
**Ngày:** 2026-08-04
**Chủ quản đề xuất:** SOM Backend Lead
**Trace ngược:** [DDD-DM-MBRTU-001](MODBUS_RTU_DATA_MODEL.md),
`SWR-REQ-MBRTU-006..009`, `SEC-REQ-MBRTU-001`
**Trace xuôi:** [ICD-API-MBRTU-001](../interfaces/MODBUS_RTU_API_SPEC.md),
[ICD-IF-MBRTU-001](../interfaces/MODBUS_RTU_INTERFACE_SPEC.md)

> Thiết kế mục tiêu cho `mkddc-web` (Go). Không mô tả As-Built; sai khác ở §9.

## 1. Trách nhiệm và ranh giới

`mkddc-web` là **authority cấu hình** Modbus RTU. Nó sở hữu:

- schema, validation, normalize và namespace tag;
- candidate / active / last-known-good / revision / checksum;
- persistence bền vững và journal transaction;
- RBAC, audit và rate limit;
- proxy có kiểm soát cho commissioning read/write và test connection;
- tổng hợp diagnostics từ iobus cho FE.

`mkddc-web` **không** sở hữu: cổng serial, lịch poll, codec, quality, timestamp
mẫu, Point Table canonical, arbitration lệnh. Nó **không được** mở UART, không ghi
`io_shm`, và không tự sinh quality.

## 2. Bố cục package

```text
apps/web-api/internal/modbusrtu/
├── domain.go          # Bus/Device/Point, enum, normalize      (đã có, cần mở rộng)
├── validate.go        # toàn bộ luật validate, thuần, test được
├── candidate.go       # candidate store + diff + operation_id
├── persistence.go     # stage/journal/commit/rollback           (đã có, cần viết lại)
├── profile.go         # sinh profile JSON cho iobus            (tách khỏi persistence)
├── csvio.go           # import/export CSV
├── apply.go           # giao thức apply với iobus (ACK/reject/timeout)
├── commission.go      # test-connection / read / write proxy
└── diagnostics.go     # đọc telemetry iobus → DTO

apps/web-api/internal/app/
└── modbus_rtu.go      # HTTP handler mỏng, không chứa luật nghiệp vụ
```

Luật nghiệp vụ **không** được nằm trong `internal/app`. Handler chỉ decode, gọi
`modbusrtu`, map lỗi sang HTTP và ghi audit.

## 3. Giao dịch cấu hình

### 3.1 Máy trạng thái

```text
ACTIVE(N)
  │ PUT /modbus/config/candidate   base_revision=N, operation_id=X
  ▼
CANDIDATE(N+1) ── validate đầy đủ ──► hợp lệ? ──no──► VALIDATION_FAILED (không ghi gì)
  │ yes
  │ POST /modbus/config/apply      operation_id=Y
  ▼
STAGING(N+1)  ghi profiles + fieldbus.conf.staged + journal(begin, N→N+1, checksum)
  │ gửi apply request tới iobus, chờ ACK có deadline
  ├─ ACK(applied_revision=N+1, checksum khớp) ──► COMMIT: rename staged→active,
  │                                               ghi LKG=N+1, journal(commit)
  ├─ REJECT(reason)  ──► ABORT: xoá staged, journal(abort), giữ ACTIVE(N)
  └─ TIMEOUT         ──► UNKNOWN: journal(unknown); reconcile ở §3.3
```

**Bốn bất biến bắt buộc:**

1. Validate **toàn bộ** cấu hình trước khi ghi bất kỳ byte nào xuống đĩa.
2. Cấu hình lỗi không được chạm vào runtime đang chạy.
3. `revision` chỉ tăng sau khi có ACK khớp checksum.
4. Không tồn tại trạng thái apply một phần: hoặc `N`, hoặc `N+1`.

### 3.2 Ghi file

Thứ tự bắt buộc cho mỗi file: `write temp` → `fsync(temp)` → `rename` → `fsync(dir)`.

Thứ tự ghi trong một transaction:

1. `profiles/<device_id>.json` cho mọi device (vào thư mục staging riêng);
2. `fieldbus.conf.staged`;
3. `fieldbus.journal` bản ghi `begin`;
4. (gửi iobus, chờ ACK);
5. `fieldbus.conf` (rename từ staged), `profiles/` (rename thư mục), `fieldbus.lkg.json`;
6. `fieldbus.journal` bản ghi `commit`.

Profile của device đã xoá được dọn ở bước 5, không dọn trước ACK.

### 3.3 Reconcile sau crash

Khi khởi động, BE đọc journal:

| Bản ghi cuối | Hành động |
|---|---|
| `commit(N+1)` | không làm gì; active = N+1 |
| `abort` | dọn staging; active = N |
| `begin(N→N+1)` không có commit/abort | **hỏi iobus** `applied_revision`. Bằng `N+1` ⇒ commit; bằng `N` ⇒ abort; không trả lời ⇒ giữ `N`, đánh dấu `apply_state=unknown` và yêu cầu người dùng apply lại |
| journal hỏng/thiếu | active = nội dung `fieldbus.conf` hiện có, `apply_state=unknown`, ghi cảnh báo |

BE **không được** kết luận `N+1` đang active chỉ vì file tồn tại.

### 3.4 Idempotency

`operation_id` là UUID do client sinh. BE giữ bảng
`{operation_id → (result, revision, checksum, at)}` trong 15 phút, persist cùng journal.

- Cùng `operation_id` + cùng payload ⇒ trả lại **kết quả cũ**, không thực hiện lại.
- Cùng `operation_id` + payload khác ⇒ `409 ID_CONFLICT`.
- `base_revision` lệch active ⇒ `409 REVISION_CONFLICT`, kèm revision hiện tại.

## 4. Validator

Một hàm thuần: `Validate(cfg Config, ns Namespace) []ValidationError`. Không I/O,
không thời gian, không random ⇒ test được đầy đủ.

### 4.1 Thứ tự kiểm tra

1. **Cấu trúc**: kiểu, enum, range số học từng field.
2. **Bus**: capability tồn tại, hai bus không cùng device node, serial hợp lệ.
3. **Device**: ID hợp lệ và unique; `bus_id` tồn tại; `slave_id` unique **trong bus**;
   quan hệ `timeout < poll ≤ stale < offline`.
4. **Point**: ID hợp lệ và unique; `device_id` tồn tại; register/type/endian tương thích;
   `scale ≠ 0`; `min < max`; `bit_index` chỉ với `bool` trên register.
5. **Chéo**: overlap register theo `(device, register_type)`; tag unique toàn namespace
   (Local I/O + Virtual + Modbus RTU); capacity.
6. **Tải bus** (admission): ước tính utilization và deadline (§5).

Mọi lỗi được **thu thập hết**, không dừng ở lỗi đầu. Mỗi lỗi có `path`, `code`,
`message` (tiếng Việt) và khi có xung đột thì kèm đối tượng xung đột.

### 4.2 Mã lỗi validation ổn định

`REQUIRED`, `OUT_OF_RANGE`, `ENUM_INVALID`, `ID_INVALID`, `ID_DUPLICATE`,
`ID_IMMUTABLE`, `REF_NOT_FOUND`, `SLAVE_ID_DUPLICATE`, `SERIAL_MISMATCH`,
`TYPE_INCOMPATIBLE`, `ADDRESS_OVERLAP`, `TAG_DUPLICATE`, `CAPACITY_EXCEEDED`,
`BUS_UNAVAILABLE`, `BUS_OVERLOADED`, `RELATION_INVALID`.

Mã lỗi là **contract**: đổi mã là breaking change của API.

## 5. Admission control (tải bus)

BE từ chối cấu hình không thể chạy đúng, thay vì để scheduler âm thầm trượt deadline.

Với mỗi bus, tính:

```text
t_char        = 11 bit / baud                     (1 start + 8 data + parity/stop ≈ 11 bit)
t_frame(n)    = n * t_char
t_silence     = 3.5 * t_char   (tối thiểu 1.75 ms khi baud > 19200)
t_txn(req,rsp)= t_frame(req) + t_frame(rsp) + t_silence + t_turnaround
utilization   = Σ_device ( Σ_block t_txn ) / poll_interval_ms
```

Quy tắc:

- `utilization > 70 %` ⇒ `BUS_OVERLOADED` (từ chối).
- `utilization > 50 %` ⇒ cảnh báo, vẫn cho apply.
- Một transaction kèm đủ `retry_count` phải hoàn tất trong `poll_interval_ms` của
  device đó, nếu không ⇒ `RELATION_INVALID`.

Các số 70 %/50 % là **PROPOSED**, chưa đo trên phần cứng thật — xem `OD-MBRTU-006`.

## 6. Commissioning proxy

| Thao tác | Quyền | Ảnh hưởng cấu hình | Giới hạn |
|---|---|---|---|
| Test connection | Operator+ | không | 1 req/5 s/device, timeout ≤ 5 s |
| Read test | Operator+ | không | 5 req/phút/người dùng |
| Write test | Admin | không | 2 req/phút/người dùng, bắt buộc `confirm=true` |

Nguyên tắc:

- Ba thao tác này **không** tạo revision, không xuất hiện trong candidate diff.
- BE chuyển tiếp tới iobus qua reliable IPC có `request_id` + deadline, rồi trả
  **kết quả có thẩm quyền** từ iobus. BE không tự suy ra kết quả.
- Write test bị từ chối tại BE trước khi xuống iobus nếu: Point `read`,
  `data_type` không khớp payload, giá trị ngoài `min/max`, `base_revision` lệch,
  hoặc quality gần nhất không phải `GOOD`.
- Write test **không** thay đổi `default_value`/`safe_value` và không tạo lệnh lặp lại.

## 7. RBAC và audit

### 7.1 RBAC

| Endpoint nhóm | Quyền tối thiểu |
|---|---|
| `GET /modbus/*` (config, devices, points, diagnostics, overview, events, export) | `viewer` |
| `POST /modbus/devices/{id}/test-connection`, `POST /modbus/commission/read` | `operator` |
| `PUT/POST/DELETE` cấu hình, `apply`, `rollback`, `import` | `admin` (vai trò Engineer chưa tồn tại — `OD-MBRTU-009`) |
| `POST /modbus/commission/write` | `admin` |

Hiện `GET /modbus/*` As-Built đã là `viewer` ở tầng API nhưng FE chặn ở
`admin`; thiết kế yêu cầu hai tầng khớp nhau.

### 7.2 Audit

Mọi mutation và mọi write/commission ghi một bản ghi audit gồm:

```text
timestamp_utc, actor_username, actor_role, remote_addr,
action        ∈ {config.candidate, config.apply, config.rollback,
                 device.create|update|delete|enable, point.create|update|delete,
                 config.import, commission.test_connection,
                 commission.read, commission.write}
target        = {device_id?, point_id?, bus_id?}
operation_id, base_revision, result_revision, checksum
old_value, new_value        (bắt buộc cho commission.write và cho mọi update)
result        ∈ {success, validation_failed, rejected, timeout, denied}
reason_code, correlation_id
```

Audit ghi **trước** khi thực hiện (`intent`) và **sau** khi có kết quả (`outcome`)
với cùng `correlation_id`. Không log credential, không log token, không log
toàn bộ payload cấu hình.

## 8. Diagnostics và overview

BE **không** tính counter. Nó đọc telemetry từ iobus và:

- ghép `slave_addr` + `bus_id` → `device_id` bằng cấu hình **active** (không dùng
  candidate) — ghép chỉ theo `slave_addr` là sai khi hai bus có cùng slave ID;
- trả `unknown` cho mọi trường iobus không cung cấp, tuyệt đối không điền `0`;
- kèm `producer_boot_id` và `counters_since` để consumer biết mốc reset;
- kèm `config_revision` mà iobus đang chạy, để FE phát hiện lệch với active.

`GET /modbus/overview` là **derived view** thuần: tổng hợp từ config active +
diagnostics, không có state riêng, không cache quá 1 s.

## 9. Sai khác so với BE hiện tại

| ID | Thiết kế | As-Built | Mức | Bằng chứng |
|---|---|---|---|---|
| F-BE-01 | apply = ACK revision/checksum từ iobus | apply = `systemctl restart mkddc-iobus` trả `applied=true` | P0 | `modbus_rtu.go:267-284`, `reloadhelper_linux.go:43` |
| F-BE-02 | candidate riêng, apply một lần | mỗi CRUD tự ghi file + restart iobus | P0 | `mutateModbusConfig()` gọi `applyModbusConfig()` mỗi lần |
| F-BE-03 | journal + LKG + reconcile sau crash | snapshot trong RAM của handler, restore best-effort | P0 | `persistence.go:66-99` — `snapshots` là biến local, mất khi process chết |
| F-BE-04 | temp→fsync→rename→fsync(dir) | `writeConfigFileAtomic` (chưa xác nhận fsync thư mục) | P1 | cần kiểm tra riêng |
| F-BE-05 | idempotency `operation_id` | không có | P0 | không có tham số nào trong handler |
| F-BE-06 | optimistic concurrency `base_revision` | không có; `pointConfigMu` chỉ chặn trong một process | P0 | `mutateModbusConfig()` |
| F-BE-07 | Bus là entity; hai bus | `RS485` map sinh từ **device enabled đầu tiên**, một bus | P0 | `persistence.go:49-51` |
| F-BE-08 | slave ID unique **trong bus** | unique **toàn cục** (`slaves map[int]string`) | P1 | `domain.go:165-169` |
| F-BE-09 | checksum trên canonical JSON | `json.Marshal(cfg)` với `map[string]any` → thứ tự key phụ thuộc runtime | P1 | `persistence.go:57-59` |
| F-BE-10 | commissioning read/write/test-connection | không có endpoint | P0 | `http.go:148-156` chỉ 9 route |
| F-BE-11 | import/export | không có endpoint | P1 | như trên |
| F-BE-12 | enable/disable là thao tác riêng có audit | chỉ là field trong PUT device | P2 | |
| F-BE-13 | admission control tải bus | không có | P1 | `Validate()` không tính tải |
| F-BE-14 | diagnostics ghép theo `(bus, slave)` | ghép theo `slave_id` toàn cục | P1 | `modbus_rtu.go:115-118` |
| F-BE-15 | `timestamp` từ producer | `time.Now()` khi BE đọc SHM | P0 | `core_client.go:846-848` |
| F-BE-16 | validation `retry 0..3` | `retry 1..10` và normalize `0 → 2` | P2 | `domain.go:89-91`, `176-178` |
| F-BE-17 | `poll_interval_ms` 100..60000 | `10..60000` | P2 | `domain.go:170-172` |
| F-BE-18 | audit có old/new value và correlation | `a.audit.Change(user, "config.modbus-rtu", file, "success", addr)` — không có target/giá trị | P1 | `modbus_rtu.go:282` |

## 10. Test BE bắt buộc

| ID | Loại | Nội dung |
|---|---|---|
| TB-MBRTU-01 | unit | validator: mọi mã lỗi §4.2 có ít nhất một case dương và một case âm |
| TB-MBRTU-02 | unit | slave ID trùng trong bus ⇒ lỗi; trùng khác bus ⇒ hợp lệ |
| TB-MBRTU-03 | unit | overlap register 5 trường hợp data model §5.5 |
| TB-MBRTU-04 | unit | tag trùng với Local I/O và Virtual Point |
| TB-MBRTU-05 | unit | admission: cấu hình vượt 70 % bị từ chối, 60 % được cảnh báo |
| TB-MBRTU-06 | unit | canonical JSON: hai lần marshal cùng input cho cùng checksum |
| TB-MBRTU-07 | unit | CSV import/export round-trip; 1 dòng lỗi ⇒ 0 dòng được nạp |
| TB-MBRTU-08 | integration | apply: ACK ⇒ commit; REJECT ⇒ giữ active; TIMEOUT ⇒ unknown |
| TB-MBRTU-09 | integration | crash giữa `begin` và `commit` ⇒ reconcile đúng theo bảng §3.3 |
| TB-MBRTU-10 | integration | idempotency: cùng `operation_id` không apply hai lần |
| TB-MBRTU-11 | integration | `base_revision` lệch ⇒ 409 và không ghi file |
| TB-MBRTU-12 | integration | RBAC ma trận §7.1 đầy đủ positive/negative |
| TB-MBRTU-13 | integration | audit chứa actor/target/old/new/correlation cho `commission.write` |
| TB-MBRTU-14 | integration | diagnostics thiếu telemetry ⇒ `unknown`, không `0` |
| TB-MBRTU-15 | integration | write test bị từ chối đúng cho từng lý do ở §6 |

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo BE design: transaction, validator, admission, commissioning, RBAC/audit và 18 gap As-Built |
