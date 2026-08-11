# Mô hình dữ liệu Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DM-PROG-001` |
| Phiên bản | 0.6 |
| Trạng thái | **M3 — Review Ready** — DD-01..13 đủ; chờ BE/Runtime/Security/QA review |
| Ngày | 2026-08-11 |
| Chủ quản | Backend Lead + Runtime Architect |
| Reviewer | FE Lead, Controls, Security, Operations, Verification |
| Approver | Software/Runtime Architect |
| Nguồn | `SRS-PROG-001`, `ARCH-PROG-001` |
| Phạm vi | Project/Draft/Revision/Check/Artifact/Operation/Audit và Runtime read model Rev A |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Định nghĩa **dữ liệu Programming được lưu ra sao**: bảng, cột, kiểu, khóa, ràng buộc, giao dịch, thời gian giữ và cách nâng cấp schema. Ai viết migration hay viết struct Go/TypeScript đều lấy từ đây. |
| 2. Ai phải đọc file này? | BE (viết store và migration) là bắt buộc; Core đọc phần định danh runtime và RETAIN; FE đọc để biết trường nào server là chủ; QA đọc §5 và §10 để dựng ca âm; Ops đọc §9 về backup/retention. |
| 3. Hệ thống hiện tại đang có gì? | Source `66848a1` nâng store lên SQLite v2 gồm 11 bảng và nối nó vào lifecycle `mkddc-web`. Sáu API Project/Draft/Revision đọc-ghi dữ liệu thật; Draft batch dùng ETag/CAS, Revision/object bất biến, receipt idempotency 24 giờ và v1→v2 backup đã có test restart/race. Compiler job, artifact registry, terminal operation/Commission và RETAIN runtime chưa có. |
| 4. Thiết kế mới thay đổi điều gì? | Chuỗi `Project → Draft → Revision` đã thành As-Built ở cả persistence và application/HTTP: **Draft sửa được bằng ETag, Revision/object bất biến**, replay mutation không tạo audit/identity mới. Check/Artifact/Commission Record còn là schema/invariant chờ worker ở task sau. |
| 5. Team phải sửa module/contract nào? | §11 ánh xạ cả source đã có và phần còn lại. BE tiếp tục tạo compiler/Check worker/registry; Core dùng định danh biến ổn định cho RETAIN (§3.10); FE chỉ giữ phép chiếu, không coi cache trình duyệt là nguồn. Bundle change manifest/import/export thuộc `TASK-PROG-206`. |
| 6. Điều gì còn bị chặn? | Không còn decision chặn implementation. Feature giữ `OFF` theo mặc định và chưa chạy migration target; phần còn lại bị chặn release bởi Check/operation worker, Core lifecycle, target/HIL và Test Result, không phải bởi quyền viết code. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Host test TASK-PROG-204 PASS cho fresh/restart, Project/list cursor, Draft ETag/batch, Revision seal/immutable/checksum, receipt replay qua restart, v1→v2 backup, duplicate JSON và RBAC. Race detector và toàn bộ Go PASS. Đây là evidence hỗ trợ `EV-PROG-G2-204`, chưa phải `VS-PROG-*` Test Result; RETAIN/target power test vẫn chưa chạy. |

Ba quy tắc dễ làm sai nhất, nêu trước để khỏi phải đọc hết: (a) ID máy không đổi
khi người dùng đổi tên — tên chỉ là metadata; (b) mọi timestamp lưu UTC có dấu
timezone, còn bộ đếm thời gian runtime dùng đồng hồ monotonic; (c) `null`,
`unknown`, `stale`, `offline` **không được** quy về `0` hay chuỗi rỗng — đây là
`RSK-PROG-010`, mức 15.

## 1. Nguyên tắc

- ID máy không đổi khi đổi tên; tên/tag là metadata.
- Draft mutable có concurrency token; Revision, Check Result, Artifact và
  Commission Record là immutable.
- FE chỉ giữ phép chiếu; BE/Core là authority.
- Mọi timestamp lưu UTC có timezone marker; timer/runtime dùng monotonic clock.
- `null/unknown/stale/offline` không được chuẩn hóa thành zero/empty string.

## 2. Quan hệ entity

```text
Controller 1──* Project 1──* Draft 1──* Revision
                                  Revision 1──* ProgramDocument
                                  Revision 1──1 TaskConfig
                                  Revision 1──* Variable
                                  Revision 1──* PointBinding
                                  Revision 1──1 LibraryManifest
                                  Revision 1──1 ChangeManifest
                                  Revision 1──* CheckResult
                                  Revision 1──0..1 Artifact

Controller 1──1 RuntimeState ── activeRevision/artifact/LKG
Controller 1──* Operation ── Commission | Restore | Import | ResetRetain
Controller 1──* AuditRecord
```

## 3. Entity canonical

### 3.1 Project và Draft

| Trường | Kiểu/ràng buộc | Ghi chú |
|---|---|---|
| `projectId` | UUID/ULID opaque, immutable | không dùng name làm key |
| `name` | UTF-8 1..128 | unique theo policy chờ OD |
| `description` | UTF-8 <=2048 | optional |
| `functionalTags` | danh sách metadata bounded | không là entity lifecycle riêng |
| `draftId` | opaque | một hoặc nhiều Draft chờ OD; API phải không giả định nếu chưa khóa |
| `baseRevisionId` | opaque/null | concurrency và diff base |
| `version`/`etag` | monotonic token | bắt buộc khi mutation |
| `updatedAt/by` | UTC + actor ID | audit relation |

### 3.2 Revision

Revision là snapshot bất biến của:

- Program ST/FBD và source-map;
- Variable/type/initial/RETAIN declaration;
- PointBinding;
- một Task Rev A và execution order;
- Core Library version + User FB cục bộ Project;
- functional tag/view metadata;
- target profile và parent revision;
- checksum manifest của từng object.

Không lưu runtime value, password/token, artifact bytes hoặc browser layout cache
trong Revision domain object.

### 3.3 Program document

```json
{
  "programId": "opaque",
  "name": "HVAC_Main",
  "kind": "PROGRAM|FUNCTION|FUNCTION_BLOCK",
  "language": "ST|FBD",
  "source": "... hoặc structured document",
  "sourceMapVersion": 1,
  "executionOrder": 10,
  "functionalTags": ["sat-control"]
}
```

User Function Block chỉ được tham chiếu trong Project chứa định nghĩa. Không có
global package/catalogue/native plug-in ở Rev A.

### 3.4 Variable và kiểu

| Trường | Ràng buộc |
|---|---|
| `variableId` | opaque stable ID |
| `programId` | tham chiếu tồn tại trong cùng Revision |
| `name` | unique trong scope, identifier <=64 ký tự theo proposal |
| `type` | profile type được G0 phê duyệt; không cho implicit narrowing |
| `class` | `LOCAL/INPUT/OUTPUT/INOUT/GLOBAL/MAPPED/RETAIN/CONSTANT/PARAMETER` theo allowlist |
| `initialValue` | typed, finite, bounded |
| `retain` | boolean + stable retain identity khi true |

### 3.5 PointBinding

Point identity là discriminated union:

```json
{
  "bindingId": "opaque",
  "variableId": "opaque",
  "point": {"category":"LOCAL", "pointId":"AO-01"},
  "direction": "READ|WRITE|READ_WRITE",
  "dataType": "REAL",
  "unit": "V",
  "writable": true,
  "qualityPolicy": "REQUIRE_GOOD|ALLOW_UNCERTAIN|FAIL_POLICY",
  "initialTransitionPolicy": null
}
```

Modbus RTU bắt buộc dùng:

```json
{"category":"MB_RTU", "deviceId":"pump-vfd-01", "pointId":"speed_ref"}
```

Không chấp nhận ID phẳng `MB-042`, Modbus TCP hoặc BACnet Point. Point Catalog
authority cung cấp type/unit/direction/writable; Revision chỉ lưu reference và
snapshot metadata phục vụ review, không tự tạo Point truth thứ hai.

### 3.6 TaskConfig

Rev A có đúng một record:

```json
{
  "taskId": "control-main",
  "name": "Control_Main",
  "enabled": true,
  "periodMs": 1000,
  "programOrder": ["program-a", "program-b"],
  "budgetPolicyVersion": "pending-g0"
}
```

`periodMs` chỉ `1000|5000|30000`. Không expose task priority, add task hoặc
supporting component ceiling 8/16/32 trong Rev A profile.

### 3.7 CheckResult và Diagnostic

| Trường | Ràng buộc |
|---|---|
| `checkId` | opaque immutable |
| `revisionId`, `targetId` | bắt buộc |
| `status` | `RUNNING/PASSED/FAILED/TIMED_OUT` |
| `layers` | logic/type/fbd/task/point/library/target/retain/cutover/resource |
| `diagnostics[]` | stable `code`, severity, messageKey, source/object/field location, args |
| `compilerVersion/profile` | producer truth |
| `startedAt/completedAt` | UTC |

Message dịch không lưu làm logic. Diagnostic code thuộc `IFSPEC-PROG-001`.

### 3.8 Artifact

Artifact immutable gồm identity, Revision, compiler/library/profile/target ABI,
byte size, SHA-256, created time và storage locator. Artifact bytes không được
trả trong REST list/detail thông thường, không được export replacement bundle
và không được log.

### 3.9 Operation và CommissionRecord

```text
Operation: operationId, kind, target, requestedRevision, expectedActiveRevision,
           idempotencyKeyHash, state, step, correlationId, requestedBy/time,
           finalRuntimeRevision, resultCode, keepsRunningRevision

State: REQUESTED → PREFLIGHT → STAGED → APPLYING → VERIFYING
       → SUCCEEDED | REJECTED | FAILED | UNKNOWN_RECONCILING
```

CommissionRecord được tạo một lần khi operation kết thúc, gồm previous/new
Revision, artifact hash, mapping/library/retain/cutover summary, override
inventory reference, target/runtime read-back, actor/time/result.

### 3.10 RuntimeState và OnlineSample

| Trường | Ý nghĩa |
|---|---|
| `coreConnection` | `RUNNING/DEGRADED/UNREACHABLE` |
| `runtimeState` | `EMPTY/STARTING/RUNNING/DEGRADED/FAULTED/SAFE_STATE` |
| `activeRevisionId`, `artifactSha256`, `lkgRevisionId` | authoritative hoặc null có reason |
| `task` | một Task: period, state, run/last/max/overrun/budget |
| `safeState` | active + reason/source/time |
| `observedAt`, `freshness` | producer timestamp và `LIVE/STALE/UNAVAILABLE` |

Output sample tách:

```json
{
  "programValue": 41.0,
  "actualValue": 62.0,
  "overriddenBy": "LOCAL_MANUAL",
  "effectivePriority": 2,
  "overrideActor": "operator-id",
  "overrideRemainingS": 272,
  "quality": "GOOD",
  "observedAt": "2026-08-09T14:22:00Z"
}
```

## 4. Persistence và migration

- SQLite transaction hoặc cơ chế atomic tương đương; foreign key/checksum bật.
- Revision/object content-addressable dedup là tối ưu tùy chọn, không đổi identity.
- Migration có `schema_version`, preflight, backup, transaction và rollback.
- Không xóa Revision/LKG đang được runtime/audit tham chiếu.
- Retention số Revision là `OD-PROG-010`; trước quyết định chỉ được dùng quota
  cấu hình fail-closed, không tự purge lịch sử an toàn.
- RETAIN runtime tách khỏi Project DB; key bằng stable Program/variable identity,
  layout version và artifact compatibility.

## 5. Invariant và negative case

1. Không Revision mutable.
2. Không binding mồ côi/sai category/type/direction.
3. Không Candidate Ready nếu Check không `PASSED` cho cùng Revision/target.
4. Không Commission nếu expected active/base revision đổi.
5. Không `SUCCEEDED` nếu core read-back không khớp.
6. Không source-only bundle chứa Artifact/IR/native/cache/trust material.
7. Không giá trị quan sát thiếu timestamp/quality bị gọi là Live.

## 6. Storage model As-Built — SQLite v2

Authority bền vững đặt tại `${CONFIG_DIR}/programming/programming-v1.sqlite`
(`CONFIG_DIR=/data/config` trên target). Dùng driver `modernc.org/sqlite` đã có,
`PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`.
File mode `0600`, directory `0750`, owner service `mkddc`; không phục vụ trực tiếp
qua static file hoặc endpoint download.

Mọi ID dùng UUID v4 lowercase canonical do BE sinh; `created_at_utc_ms` và
`updated_at_utc_ms` là Unix epoch millisecond UTC, `INTEGER >=0`. `etag` là số
nguyên 64-bit tăng đúng một lần mỗi transaction mutation Draft.

Schema v2 áp dụng tuần tự `0001_programming_store.sql` rồi
`0002_mutation_receipts.sql`; checksum migration đã áp dụng là bất biến. Nâng
v1→v2 phải tạo và kiểm `quick_check` online backup trước transaction migration.
Binary cũ không down-migrate v2; rollback giữ DB/backup và tắt feature.

### 6.1 `projects` và `drafts`

| Bảng.trường | SQLite | Null/default/range | Key/index và invariant |
|---|---|---|---|
| `projects.project_id` | TEXT | required, UUID | PK |
| `projects.name` | TEXT | 1..128 UTF-8 | unique index `lower(name)`; `TARGET-PENDING OD-003` |
| `projects.description` | TEXT | required default `''`, <=2048 | không dùng làm identity |
| `projects.archived` | INTEGER | `0|1`, default 0 | archived không xóa Revision |
| `projects.created_by/updated_by` | TEXT | required actor ID <=128 | FK logic tới auth actor snapshot, không FK DB |
| `projects.created_at_utc_ms/updated_at_utc_ms` | INTEGER | required >=0 | index updated desc |
| `drafts.draft_id` | TEXT | required UUID | PK |
| `drafts.project_id` | TEXT | required | FK projects `ON DELETE RESTRICT`; unique active draft/project Rev A |
| `drafts.base_revision_id` | TEXT | nullable | FK revisions deferred; null cho project mới |
| `drafts.etag` | INTEGER | required >=1 | optimistic concurrency token |
| `drafts.content_json` | BLOB | required canonical UTF-8 JSON, <=2 MiB `TARGET-PENDING` | SHA-256 và schema validate trước commit |
| `drafts.content_sha256` | BLOB | required exactly 32 byte | detect corrupt/round-trip |
| `drafts.updated_by/updated_at_utc_ms` | TEXT/INTEGER | required | audit trong cùng transaction |

### 6.2 `revisions`, `revision_objects` và `checks`

| Bảng.trường | SQLite | Null/default/range | Key/index và invariant |
|---|---|---|---|
| `revisions.revision_id` | TEXT | required UUID | PK; immutable bằng trigger chặn UPDATE/DELETE |
| `revisions.project_id` | TEXT | required | FK projects, index `(project_id,created_at)` |
| `revisions.parent_revision_id` | TEXT | nullable | FK self; không cycle |
| `revisions.sequence` | INTEGER | required >=1 | unique `(project_id,sequence)` |
| `revisions.schema_version` | INTEGER | required =1 | unknown major reject |
| `revisions.target_profile` | TEXT | required =`MKDDC24_REVA` | không suy từ browser |
| `revisions.manifest_json` | BLOB | required canonical JSON <=256 KiB | checksum từng object, library/profile |
| `revisions.manifest_sha256` | BLOB | exactly 32 byte | content identity |
| `revisions.created_by/created_at_utc_ms` | TEXT/INTEGER | required | audit source |
| `revision_objects.revision_id` | TEXT | required | FK revisions `ON DELETE RESTRICT` |
| `revision_objects.object_id` | TEXT | required UUID stable qua Revision | PK `(revision_id,object_id)` |
| `revision_objects.kind` | TEXT | enum `PROGRAM/FUNCTION/FUNCTION_BLOCK/VARIABLE/BINDING/TASK/METADATA` | index `(revision_id,kind)` |
| `revision_objects.payload_json` | BLOB | canonical JSON, per-object limit | immutable; hash before insert |
| `revision_objects.payload_sha256` | BLOB | exactly 32 byte | manifest phải khớp |
| `checks.check_id` | TEXT | required UUID | PK |
| `checks.revision_id/target_id` | TEXT | required | FK revision; target controller identity |
| `checks.state` | TEXT | `QUEUED/RUNNING/PASSED/FAILED/TIMED_OUT` | terminal immutable |
| `checks.input_sha256/profile/compiler_version` | BLOB/TEXT/TEXT | required | same input+profile+compiler được cache có kiểm soát |
| `checks.started/completed_at_utc_ms` | INTEGER | completed nullable khi running | `completed>=started` |
| `checks.result_json/result_sha256` | BLOB/BLOB | nullable tới terminal; <=1 MiB | diagnostic stable code/location |

### 6.3 `artifacts`, `operations` và `commission_records`

| Bảng.trường | SQLite | Null/default/range | Key/index và invariant |
|---|---|---|---|
| `artifacts.artifact_id` | TEXT | UUID | PK; immutable |
| `artifacts.revision_id/check_id` | TEXT | required | FK; Check phải PASSED cùng input hash |
| `artifacts.schema_version/profile/target_abi` | INTEGER | required | khớp loader capability read-back |
| `artifacts.compiler_version/library_version` | TEXT | required <=64 | nằm trong change manifest |
| `artifacts.byte_size` | INTEGER | `1..1048576` | one-over reject |
| `artifacts.sha256` | BLOB | exactly 32 byte | unique theo target/profile |
| `artifacts.relative_path` | TEXT | basename/relative path allowlist | cấm absolute/`..`/symlink; root không từ request |
| `artifacts.integrity_mode` | TEXT | `HASH_ONLY|SIGNED` | Rev A target `HASH_ONLY`; signed không được claim trusted-origin |
| `artifacts.created_at_utc_ms` | INTEGER | required | retention theo Revision reference |
| `operations.operation_id` | TEXT | UUID | PK |
| `operations.kind` | TEXT | `COMMISSION/RESTORE/IMPORT/RESET_RETAIN` | immutable sau create |
| `operations.state` | TEXT | enum lifecycle §3.9 | index nonterminal; một mutation lease/controller |
| `operations.step` | TEXT | stable enum, không message | resume/reconcile cursor |
| `operations.controller_id/requested_revision_id/expected_active_revision_id` | TEXT | required theo kind | precondition |
| `operations.idempotency_key_sha256` | BLOB | 32 byte | unique `(actor,kind,target,key)` |
| `operations.correlation_id/actor_id` | TEXT | required <=128 | audit join |
| `operations.result_code/detail_code` | TEXT | nullable tới terminal | stable IFSPEC code |
| `operations.keeps_running_revision` | INTEGER | `0|1|null` | null khi chưa biết, không mặc định false |
| `operations.created/updated_at_utc_ms` | INTEGER | required | durable trước Core side effect |
| `commission_records.operation_id` | TEXT | required | PK + FK terminal operation |
| `commission_records.previous/new_revision_id` | TEXT | required | cả hai immutable |
| `commission_records.artifact_sha256/runtime_readback_json` | BLOB | required | actual active/profile/first-cycle truth |
| `commission_records.impact_json/override_inventory_sha256` | BLOB | required | source/mapping/task/library/RETAIN/cutover/output |
| `commission_records.result/closed_at_utc_ms` | TEXT/INTEGER | required | append-only |

### 6.4 `audit_records`

| Trường | SQLite | Ràng buộc |
|---|---|---|
| `audit_id` | TEXT PK | UUID |
| `sequence` | INTEGER UNIQUE | monotonic, dùng phát hiện gap |
| `actor_id`, `role` | TEXT | required snapshot tại thời điểm action |
| `action`, `target_type`, `target_id` | TEXT | stable enum/ID |
| `revision_id`, `operation_id` | TEXT | nullable khi không áp dụng; indexed |
| `occurred_at_utc_ms` | INTEGER | required >=0 |
| `result_code`, `correlation_id` | TEXT | required |
| `details_json` | BLOB | allowlist field; <=16 KiB; không token/password/private key/full source/artifact |
| `prev_hash`, `record_hash` | BLOB | 32 byte; hash chain phát hiện sửa/xóa ngoài ý muốn |

Audit append và mutation domain nằm cùng DB transaction khi cùng process. Event
Core nhận sau timeout được bổ sung bằng record reconcile, không sửa record cũ.

### 6.5 `mutation_receipts`

| Trường | SQLite | Ràng buộc/nghĩa |
|---|---|---|
| `actor_id` | TEXT | required 1..128; namespace actor đã xác thực |
| `action` | TEXT | `PROJECT_CREATE/DRAFT_SAVE/REVISION_CREATE` |
| `target_id` | TEXT | `''` cho create Project; Project/Draft ID canonical cho action còn lại |
| `idempotency_key_sha256` | BLOB | đúng 32 byte; không lưu khóa thô |
| `request_sha256` | BLOB | đúng 32 byte của semantic request canonical, gồm precondition liên quan |
| `result_json` | BLOB | canonical JSON 2..4096 byte; giữ Project/Draft/Revision ID, ETag và audit ID |
| `created_at_utc_ms` | INTEGER | required `>=0` |
| `expires_at_utc_ms` | INTEGER | đúng `created + 24 giờ`; hết hạn được dọn trong transaction mutation |

Khóa chính là `(actor_id, action, target_id, idempotency_key_sha256)`; trigger
chặn `UPDATE`. Lookup cùng request hash trả nguyên response identity cũ mà không
thêm domain/audit mutation. Cùng khóa nhưng request hash khác trả
`PRG-ERR-IDEMPOTENCY-CONFLICT-001`. Receipt và domain state commit/rollback cùng
một transaction, nên restart không mở cửa tạo trùng.

## 7. Canonical document schema

`drafts.content_json` và `revision_objects.payload_json` dùng JSON canonical
(UTF-8 NFC, key sort lexical, không NaN/Infinity, không duplicate key). Top-level:

```json
{
  "schemaVersion": 1,
  "project": {"projectId":"uuid","name":"...","functionalTags":[]},
  "programs": [],
  "variables": [],
  "bindings": [],
  "task": {"taskId":"uuid","periodMs":1000,"programOrder":[]},
  "library": {"profile":"CORE_REVA","version":"pending-od-005"}
}
```

| Object | Required | Null/unknown semantics | Validation |
|---|---|---|---|
| Program | `programId,name,kind,language,document` | source/document không null | ID unique; ST string <=64 KiB; FBD structured schema; kind/reference hợp lệ |
| Variable | `variableId,programId,name,type,class,initialValue,retain` | initial không null; type-tagged value | name/type/scope unique; finite; retain type allowlist |
| Binding | `bindingId,variableId,point,direction,dataType,qualityPolicy` | `unit` nullable nếu Point Catalog không có; quality không null | canonical point exists; type/direction/writable; một output owner |
| Task | `taskId,periodMs,programOrder` | không null; đúng một record | period allowlist; order chứa mỗi active Program đúng một lần |
| Metadata | `functionalTags` | empty array nghĩa không gắn; null bị reject | tag trim/NFC/unique/bounded |

Mọi object có `extensions` chỉ khi schema minor cho phép; namespace phải có
owner. Unknown required field/enum/major version bị reject, không silently drop.

## 8. State, transaction và locking

```text
PATCH Draft:
  BEGIN IMMEDIATE
  read draft WHERE etag = If-Match
  apply batch in memory → validate full aggregate → canonicalize/hash
  UPDATE draft SET content,hash,etag=etag+1
  INSERT audit
  COMMIT
```

- Một connection writer queue; read connection pool bounded. Busy >5 s trả
  `PRG-ERR-UNAVAILABLE-001`, không spin vô hạn.
- Tạo Revision copy aggregate và manifest trong một transaction; trigger chặn
  UPDATE/DELETE Revision/object/artifact/commission/audit.
- Compiler chạy sau commit Revision, không giữ DB transaction. Kết quả gắn chính
  xác `revision_id + input_sha256 + profile + compiler_version`.
- Operation row và idempotency key commit trước gửi Core. Reconcile dùng compare-
  and-set state/step; response trễ không được lùi terminal state.
- Import parse/extract trong temp dir riêng, validate hoàn tất rồi transaction tạo
  Project/Draft; lỗi xóa temp, không tạo half-project.

## 9. Retention, backup và migration

- Không auto-purge active/LKG, parent chain, operation/audit reference hoặc
  Revision nằm trong backup chưa hết hạn. Số Revision/quota theo `OD-PROG-010`;
  khi đầy trả mã quota thay vì xóa ngầm.
- Artifact có thể garbage-collect chỉ khi không Revision/operation/LKG tham
  chiếu và backup được xác nhận; xóa bytes sau commit tombstone/audit.
- Backup dùng SQLite Online Backup API ra file tạm, `quick_check`, SHA-256,
  `fsync`, rename và manifest; sao chép `.sqlite` sống bằng `cp` bị cấm.
- Migration `vN→vN+1` có preflight disk space, backup verified, transaction,
  post-check row/hash count và rollback binary+DB. Downgrade không hiểu schema
  phải fail fast trước service start, không ghi file.
- RETAIN nằm ngoài DB tại namespace Core; DB chỉ lưu compatibility/operation
  metadata. Reset RETAIN là operation audited, không phải `DELETE` trực tiếp.

## 10. Error, security và negative case chi tiết

| Negative case | Detection | State giữ | Kết quả |
|---|---|---|---|
| JSON duplicate key/non-finite/unknown major | decoder/schema | Draft/active giữ | `PRG-ERR-REQ-001` |
| ETag/base stale | SQL compare-and-set | cả hai version giữ | 409 `PRG-ERR-CONFLICT-001` |
| FK/reference/type/direction sai | aggregate validator | transaction rollback | `PRG-ERR-MAP-*`/scope detail |
| DB busy/disk full/corrupt | SQLite/result/quick_check | active Core không đổi; mutation fail | unavailable + alarm/incident, không auto recreate DB |
| path traversal/symlink/import bomb | lexical path + `openat`/quota | không ghi store | `PRG-ERR-IMPORT-001` |
| artifact metadata/bytes hash lệch | store read + loader | LKG giữ | artifact reject + audit |
| operation response sau timeout | operation CAS/reconcile | UNKNOWN tới read-back | không replay mutation |
| audit write fail trong domain transaction | transaction | mutation rollback | fail closed |

## 11. Ánh xạ repository và verification

| Nội dung | Target source | Test bắt buộc |
|---|---|---|
| Domain/canonical JSON | `apps/web-api/internal/programming/store/{types,canonical}.go` | TASK-104: round-trip, duplicate/top-level/NFC/one-over PASS; schema unknown field thuộc service validator sau |
| SQLite schema/store | `apps/web-api/internal/programming/store/{store,schema,migrate}.go`, `migrations/*.sql` | TASK-104: FK/trigger/concurrency/restart/corrupt/disk-full/migration PASS |
| Revision/manifest | `apps/web-api/internal/programming/{application,store}/{projects.go,draft.go,commands.go,queries.go}` | TASK-204: seal/read immutable object + manifest/checksum PASS; structured change classification thuộc `TASK-PROG-206` |
| Receipt idempotency | `apps/web-api/internal/programming/store/{migrations/0002_mutation_receipts.sql,idempotency.go}` | TASK-204: replay 24 giờ qua restart và conflict cùng key/khác request PASS |
| Lifecycle DB | `apps/web-api/internal/app/{app.go,programming.go}` | TASK-204: derive path theo `CONFIG_DIR`, open/inject/close khi flag ON; flag OFF không tạo DB |
| Check/artifact registry | `check.go`, `artifact_store.go` | input identity/idempotency/path/hash/quota |
| Operation/commission | `apps/web-api/internal/programming/store/commands.go`; service/worker còn phải tạo | TASK-104: durable begin/idempotency/single-flight PASS; terminal reconcile/late response thuộc P4 |
| Audit | `apps/web-api/internal/programming/store/audit.go` | TASK-104: atomic append, sanitize, hash-chain gap/tamper PASS; đủ mọi route reject thuộc P2/P5 |
| Backup/migration | `apps/web-api/internal/programming/store/{backup,migrate}.go`, `migrations/` + operations runbook | TASK-104: online backup/quick_check/checksum/fault rollback PASS trên host; power-fault target chưa chạy |

Acceptance: `VS-PROG-001/002/004/019/021/024/029`, database contract tests và
fault injection phải PASS. Test Result phải ghi schema hash, DB fixture, command,
commit, environment và artifact; tài liệu này không phải evidence.

## 12. Transaction contract và quyền ghi từng aggregate

| Command | Read set/lock | Write set trong một transaction | Invariant sau commit |
|---|---|---|---|
| `SaveDraft` | Project, current Draft, `baseRevision/etag` | Draft document + new ETag + audit | Active/Revision/Artifact không đổi |
| `SealRevision` | Draft + referenced Point/library/target profile | immutable Revision + canonical objects + manifest | source hash reproducible; Draft vẫn edit bằng clone |
| `CompleteCheck` | Revision + compiler build key | Check + diagnostics + Artifact metadata/file link | Artifact chỉ tồn tại nếu zero ERROR và hash/file verified |
| `BeginOperation` | candidate/active/capability + idempotency key | Operation `PENDING` + intent/audit | unique actor/action/target/key; chưa đổi active DB truth |
| `RecordCoreResult` | Operation + Core read-back | terminal result + observed active/LKG + commission record + audit | terminal CAS một lần; late result không tạo side effect mới |
| `ImportBundle` | quarantine manifest + target profile | Project/Draft/source/mapping import report | không Artifact/IR/native; không Active |

Quyền ghi: BE store là single writer cho Project/Draft/Revision/Check/Operation;
compiler chỉ trả value object; Core là authority active/LKG/runtime; FE không
ghi persistence ngoài API. Snapshot runtime trong DB là quan sát có timestamp,
không được dùng thay Core read-back cho Commission.

## 13. Serialization, migration và code-generation handoff

- Canonical JSON dùng UTF-8, key sort bytewise, number theo type schema, không
  timestamp ngẫu nhiên; hash tính trên bytes canonical.
- DB migration có `schema_migrations(version, checksum, applied_at)`; mismatch
  checksum dừng service, không auto sửa. Mỗi migration có preflight, backup,
  forward SQL, compatibility window và rollback/recovery note.
- OpenAPI/TS/Go type chỉ được generate sau khi field name/nullability/enum trong
  Data Model và Interface Spec khớp. Generated type không được trở thành authority
  ngược lại cho domain invariant.
- Mọi xóa Project/Revision là soft-delete/tombstone theo retention decision;
  Artifact/LKG/operation/audit có reference thì không cascade mất evidence.

## 14. Blocker, lịch sử và sign-off

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| Compiler/Check/operation worker chưa có | Backend Lead | P2/P4 triển khai compiler/check, artifact registry, lease/reconcile và terminal operation |
| Target migration chưa chạy | Operations + Verification | duyệt fixture, backup path và chạy rehearsal đúng target; tạo Test Result |
| RETAIN compatibility chưa triển khai | Core/Runtime | P3/P4 hiện thực lifecycle matrix và chạy VS-PROG-029/030 |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo entity model Programming ban đầu |
| 0.2 | 2026-08-09 | Khóa target SQLite/document schema, field/invariant/index, transaction/locking, retention/migration, source/test mapping |
| 0.3 | 2026-08-09 | Bổ sung command transaction/write authority, canonical serialization, migration/code-generation và deletion/retention handoff; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13` thay dòng self-check gộp; đóng finding `F-PROG-001/002` |
| 0.5 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-104` tại source `312f357`: SQLite v1, migration checksum/fail-closed, ETag/immutable/idempotency/audit và online backup/restore có host test; giữ target/RETAIN/Test Result ở trạng thái chưa hoàn tất |
| 0.6 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-204` tại `66848a1`: SQLite v2/11 bảng, receipt idempotency 24 giờ, wiring lifecycle và sáu API Project/Draft/Revision với ETag/CAS, immutable seal/read, cursor/checksum/restart/RBAC test; chuyển change manifest/import/export sang Task 206 và giữ target/RETAIN/Test Result chưa hoàn tất |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| BE Lead | **WAIVED FOR IMPLEMENTATION** | source review tiếp tục theo task; không thay target Test Result |
| Runtime Architect | **WAIVED FOR IMPLEMENTATION** | RETAIN/artifact compatibility review ở P3/P4 |
| Security/Ops | **WAIVED FOR IMPLEMENTATION** | target backup/restore/quota rehearsal trước release |
| Verification Lead | **WAIVED FOR IMPLEMENTATION** | negative/fault/migration host test đã có; target evidence còn thiếu |

### 14.1 Tự kiểm `DD-01..DD-13`

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file: ID, version, status, ngày, chủ quản, reviewer, approver, nguồn, phạm vi; revision history §14 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §1 nguyên tắc; §2 quan hệ entity xác định ranh giới trong/ngoài |
| `DD-03` As-Built | PASS | §0 câu 3, §6 và §11 phân biệt rõ SQLite store/schema đã có tại `312f357` với service/worker/RETAIN/target còn thiếu; Modbus Point authority chỉ được tham chiếu |
| `DD-04` Target ownership | PASS | §1 “BE/Core là authority, FE chỉ giữ phép chiếu”; §12 quyền ghi từng aggregate |
| `DD-05` Data từng field | PASS | §3.1–§3.10 và §6.1–§6.4: type/unit/required/default/range/enum/null, khóa/index/FK, validation, lifecycle, retention; §13 serialization/migration |
| `DD-06` Interface | N/A tại file này | Hợp đồng API thuộc [`IFSPEC-PROG-001`](../interfaces/PROGRAMMING_INTERFACE_SPEC.md); ở đây chỉ định nghĩa hình dạng dữ liệu bền vững. §13 mô tả handoff sinh mã cho hai bên |
| `DD-07` State/transaction | PASS | §8 state/transaction/locking; §12 ranh giới atomic theo aggregate |
| `DD-08` Operation flow | N/A tại file này | Luồng người dùng ở [`UX-WEB-PROG-001`](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md); luồng vận hành ở [`OPS-PROG-001`](../../06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md). §9 chỉ giữ phần backup/retention thuộc dữ liệu |
| `DD-09` Error/safety/security | PASS | §5 invariant và ca âm; §10 error/security/negative chi tiết; quy tắc “không quy null/stale về 0” chống `RSK-PROG-010` |
| `DD-10` Repository mapping | PASS | §11 file/package/migration cần tạo trong `mkddc-web` |
| `DD-11` Verification | PASS | §11 gắn `VS-PROG-001/024/029` kèm fixture và kết quả kỳ vọng định lượng |
| `DD-12` Compatibility/deploy/rollback | PASS | §4 persistence/migration; §9 retention/backup/migration gồm dữ liệu phải giữ khi rollback |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation | 17 decision `DECIDED`, trace/risk cập nhật theo `312f357`, chữ ký còn thiếu được `WAIVED FOR IMPLEMENTATION`. Target migration/release vẫn cần Ops/Verification evidence và residual acceptance |

Không còn blocker quyền implementation. Tài liệu ghi đúng schema/store host đã
có, nhưng **không** suy host test thành Test Result target, RETAIN hoặc runtime.
