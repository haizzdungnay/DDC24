# Đặc tả giao diện Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `IFSPEC-PROG-001` |
| Phiên bản | 1.7 |
| Trạng thái | **M3 AS-BUILT + SUPPORTING TARGET PASS** — contract chạy end-to-end trên Foxlinx; Test Result độc lập/HIL vẫn là cổng release riêng |
| Ngày | 2026-08-13 |
| Chủ quản | Backend Lead + Runtime Architect |
| Người review | FE Lead, Security Lead, Verification Lead, Operations Lead |
| Người phê duyệt | System Architect + Product Owner |
| Nguồn thẩm quyền | `SRS-PROG-001`, `ARCH-PROG-001`, `DM-PROG-001`, `PROG-OD-001` |
| Phạm vi phiên bản | Target Rev A; 25 OpenAPI operation; feature flag `ON` trên Foxlinx; Check `PASSED`, Commission `SUCCEEDED/COMMITTED` và Core read-back Active/LKG |
| Liên quan | `DM-PROG-001`, `ARCH-PROG-001`, `SRS-PROG-001` |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Là **hợp đồng** giữa các bên: REST và WebSocket giữa trình duyệt và BE, IPC giữa BE và Core. Định nghĩa đường dẫn, payload, mã lỗi, timeout, retry, idempotency và thứ tự sự kiện. Đây cũng là **nguồn chuẩn duy nhất của mã lỗi** `PRG-ERR-*`. |
| 2. Ai phải đọc file này? | FE và BE bắt buộc đọc cùng nhau — hai bên phải review **một** hợp đồng, không phải hai bản mô tả. Core đọc §8 và §12 (hợp đồng BE↔Core). Security đọc §15. QA dựng contract test từ §14 và §18. |
| 3. Hệ thống hiện tại đang có gì? | `TASK-PROG-403..405/507` nối Commission/Restore/Get operation với durable worker và Core UDS lifecycle. Foxlinx chạy compiler ARM64, socket peer-checked, cờ FE/BE `ON`; hai Check `PASSED`, một Commission output-free `SUCCEEDED/COMMITTED`, Active/LKG đọc-ngược đúng. Catalog v1.4.0 có 20 public/99 detail. |
| 4. Thiết kế mới thay đổi điều gì? | Thêm nhóm `/api/v1/programming`, event WebSocket cho runtime/operation, và một giao thức nội bộ có phiên bản cho Commission. Nguyên tắc chi phối: `HTTP 2xx` chỉ nghĩa là **request đã được nhận**; chỉ read-back từ Core mới kết luận được Revision nào đang chạy. |
| 5. Team phải sửa module/contract nào? | §16. OpenAPI/client/IPC/error catalog, lifecycle operations, FE P5 và Core coordinator đã có source và đã deploy. P6 tiếp tục fault/power/HIL/IOP timing để cấp Test Result release; không phải phần code P5 còn thiếu. |
| 6. Điều gì còn bị chặn? | **Không còn blocker approval cho implementation.** Payload/limit/role đã được chốt bởi 17 decision `DECIDED`. TLS và giao thức BE↔Core là phần phải implement/test trong P1–P3, không phải điều kiện xin phép trước khi code. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | `EV-PROG-P5-507`: compiler/Core/Web/FE ARM64 trên Foxlinx, hai Check `PASSED`, Commission output-free `SUCCEEDED/COMMITTED`, Core read-back Active/LKG/Task `RUNNING`, Chrome desktop/mobile sạch Console/Network. Host gates đầy đủ vẫn PASS; supporting evidence này không tự thay Test Result độc lập/HIL. |

Vì sao mã lỗi phải tập trung ở đây: nếu mỗi component tự đặt mã, FE sẽ retry sai
chỗ và che mất lỗi thật — đó là `RSK-PROG-014`. Quy tắc: FE quyết định dựa trên
`code`, **không bao giờ** parse `message`; `message` chỉ để hiển thị và đi qua
i18n. §9 là authority đọc bởi con người; file machine-readable
`contracts/programming/error_catalog_v1.json` là authority cho generator. Script
buộc hai tập mã bằng nhau; §14 ánh xạ detail nội bộ ra mã công khai.

## 1. Quy tắc chung

- Prefix REST đề xuất: `/api/v1/programming`; JSON `camelCase` theo Web baseline.
- Mọi request/response có `X-Correlation-ID`; mutation có
  `X-Idempotency-Key` và `If-Match`/`baseRevisionId` khi áp dụng.
- API không nhận artifact bytes từ browser cho Commission bình thường.
- Error logic dùng `code`, không parse `message`; message visible dùng i18n key.
- Spec này phải được chuyển vào `contracts/openapi/openapi.yaml` và contract test
  trước khi route production được coi là khóa.

## 2. Error envelope

```json
{
  "error": {
    "code": "PRG-ERR-CONFLICT-001",
    "messageKey": "programming.conflict.revision",
    "args": {"expected":"r16", "actual":"r17"},
    "field": "baseRevisionId",
    "retryable": false,
    "keepsRunningRevision": true,
    "correlationId": "opaque"
  }
}
```

| HTTP | Nghĩa |
|---:|---|
| 400 | JSON/query sai cú pháp |
| 401/403 | chưa xác thực/không đủ role |
| 404 | object không tồn tại hoặc không được lộ |
| 409 | concurrency/operation/cutover conflict |
| 413 | source/bundle/artifact vượt giới hạn |
| 422 | semantic/mapping/task/target/retain validation fail |
| 429/503 | compiler/resource/runtime tạm không sẵn sàng, có retry hint |
| 504 | operation chưa xác định; client phải query, không replay mù |

## 3. REST resource

| Method + path | Role | Mục đích / response chính |
|---|---|---|
| `GET /capabilities` | viewer | profile, limits, supported languages/types/periods, runtime producer state |
| `GET /projects` | viewer | **As-Built 204** — danh sách Project và active/draft summary |
| `POST /projects` | admin | **As-Built 204** — tạo Project + Draft đầu tiên |
| `GET /projects/{projectId}` | viewer | **As-Built 204/507** — metadata, ETag, `draftRevisionId` ổn định và `baseRevisionId` hiện hành để mutation/seal kế tiếp |
| `PATCH /projects/{projectId}/draft` | admin | **As-Built 204** — mutation batch canonical, If-Match bắt buộc |
| `POST /projects/{projectId}/draft/revisions` | admin | **As-Built 204** — đóng Draft thành immutable Revision |
| `GET /revisions/{revisionId}` | viewer | **As-Built 204** — snapshot metadata; source theo quyền/policy |
| `GET /revisions/{from}/changes/{to}` | viewer | **As-Built 206** — structured change manifest deterministic do BE tính |
| `POST /revisions/{revisionId}/checks` | admin | **As-Built 205** — tạo Check job bền vững, không tác động runtime |
| `GET /checks/{checkId}` | viewer | **As-Built 205** — state/diagnostic/artifact metadata; polling fallback |
| `GET /point-catalog` | viewer | canonical Point projection + filter/type/direction |
| `GET /runtime` | viewer | authoritative active/LKG/core/task/safe-state status |
| `GET /runtime/monitor` | viewer | bounded current samples, source/quality/freshness/arbitration |
| `POST /runtime/traces` | admin | tạo bounded trace session read-only |
| `GET /runtime/traces/{traceId}` | viewer | samples/status/stop reason |
| `DELETE /runtime/traces/{traceId}` | admin | dừng capture; không xóa audit |
| `POST /operations/commission` | admin | precondition + stage/apply/read-back transaction |
| `POST /operations/restore` | admin | restore Revision/LKG qua cùng verify path |
| `GET /operations/{operationId}` | viewer | progress/final authoritative result |
| `GET /operations` | viewer | history có phân trang/filter |
| `GET /overrides` | viewer | inventory authority: Point/source/actor/value/priority/TTL; hỗ trợ `?activeOnly=true` và phân trang vì được gọi từ ba màn hình |
| `POST /bundles/export` | admin | **As-Built 206** — trả ZIP source-only deterministic có manifest/hash/audit |
| `POST /bundles/import` | admin | **As-Built 206** — validate, tạo Project/Draft mới; không Artifact/Check/Commission |
| `POST /retain/reset` | admin | strong confirmation token + operation/audit |
| `GET /audit` | viewer | timeline đã sanitize, phân trang |

## 4. Payload mutation Draft

Mutation dùng operation list để tránh endpoint rời tạo trạng thái nửa vời:

```json
{
  "baseRevisionId": "r16",
  "operations": [
    {"op":"replaceProgramSource", "programId":"p1", "language":"ST", "source":"..."},
    {"op":"upsertBinding", "binding": {"bindingId":"b1", "variableId":"v1",
      "point":{"category":"LOCAL","pointId":"AO-01"}, "direction":"WRITE"}},
    {"op":"setTask", "task":{"periodMs":1000,"programOrder":["p1"]}}
  ]
}
```

Server validate schema/capacity/reference trước commit, tăng ETag một lần hoặc
không đổi gì. Partial apply bị cấm.

`ProgrammingProject` công khai tách hai định danh:

- `draftRevisionId`: identity ổn định của aggregate Draft;
- `baseRevisionId`: Revision nền hiện hành mà client phải gửi cho lần
  `PATCH .../draft` hoặc `POST .../revisions` kế tiếp. Trước lần seal đầu,
  field này bằng `draftRevisionId`; sau seal, nó bằng immutable Revision vừa
  đóng gần nhất.

Client không được suy `baseRevisionId` từ `draftRevisionId`. Đây là điều kiện
để reload rồi Check/save lần hai không bị conflict giả dù ETag đã hiện hành.

## 5. Check và diagnostic

`POST /revisions/{revisionId}/checks` trả `202` với `checkId/statusUrl/state`,
`Location` và `Retry-After`. Cùng actor/revision/target/idempotency key + request
hash trong 24 giờ trả cùng job/result; cùng key khác hash trả `409`. Diagnostic tối thiểu:

```json
{
  "code":"PRG-ERR-MAP-004",
  "severity":"ERROR",
  "messageKey":"programming.mapping.typeMismatch",
  "location":{"programId":"p1","line":12,"column":8,"bindingId":"b1"},
  "args":{"expected":"REAL","actual":"BOOL"}
}
```

Check timeout/resource fail không tạo Artifact/Ready. `GET /checks/{checkId}` chỉ
trả Artifact metadata sau `PASSED`; không trả bytes hoặc locator filesystem.

## 6. Commission operation

Request. Trường `acknowledgements` **không** phải danh sách cố định bốn phần tử:
nó phải chứa **đúng** tập khóa của những nhóm impact có `status = "PRESENT"`
(xem §6.1). Ví dụ dưới đây là trường hợp `retain` và `activeOverrides` là
`PRESENT`, còn `cutover` và `outputMappingChanges` là `NONE`:

```json
{
  "revisionId":"r17",
  "expectedActiveRevisionId":"r15",
  "checkId":"chk-17",
  "impactRef":"imp-17-a3f9",
  "acknowledgements":["retain","activeOverrides"],
  "cutover":{"requested":"PROGRAM_ONLY","graphBackupId":"backup-opaque"}
}
```

Khi cả bốn nhóm đều `NONE`, `acknowledgements` là mảng rỗng `[]` — và request
vẫn hợp lệ. Số ô xác nhận có thể bằng `0`; số bước an toàn thì không: `re-auth`,
read-back và đường quay lui luôn bắt buộc, không phụ thuộc `acknowledgements`.

`impactRef` là định danh bất biến của kết quả impact mà client đã đọc. Server
tính lại impact tại thời điểm nhận request và so với `impactRef`; nếu impact đã
đổi thì trả `409 PRG-ERR-IMPACT-STALE-001` để client đọc lại và xác nhận lại.
Đây là hàng rào chống việc người dùng xác nhận một bản impact đã cũ.

Response `202` chỉ nghĩa operation được nhận. `GET /operations/{id}` trả:

```json
{
  "operationId":"op-17",
  "state":"VERIFYING",
  "step":"runtimeReadback",
  "requestedRevisionId":"r17",
  "previousActiveRevisionId":"r15",
  "actualActiveRevisionId":"r15",
  "keepsRunningRevision":true,
  "startedAt":"...",
  "updatedAt":"..."
}
```

Chỉ `SUCCEEDED` khi `actualActiveRevisionId=r17`, artifact hash/profile khớp và
first-cycle status đạt. Timeout dùng `UNKNOWN_RECONCILING`, không tự retry POST.

### 6.1 Trạng thái ba nhánh của impact

`SWR-REQ-PROG-FE-113` cho phép FE **chỉ hiện ô xác nhận cho ảnh hưởng có thật**.
Muốn an toàn, mỗi nhóm impact phải phân biệt được ba trạng thái, không phải hai:

| Giá trị | Nghĩa | FE phải làm gì |
|---|---|---|
| `{"status":"NONE"}` | Đã tính và **không** có ảnh hưởng | Không hiện ô xác nhận cho nhóm đó |
| `{"status":"PRESENT","items":[…]}` | Có ảnh hưởng, kèm chi tiết | Hiện ô xác nhận bắt buộc, liệt kê `items` |
| `{"status":"UNAVAILABLE","reason":"…"}` | **Chưa tính được** | **Chặn Commission**, nêu lý do; tuyệt đối không coi là `NONE` |

Trường thiếu, `null` hoặc mảng rỗng không có `status` đều phải được FE xử lý như
`UNAVAILABLE`. Đây là quy tắc fail-closed: thà chặn nhầm còn hơn cho Commission
đi qua một ảnh hưởng chưa được tính.

Bốn nhóm bắt buộc có `status`: `retain`, `activeOverrides`, `cutover`,
`outputMappingChanges`.

### 6.1.1 Quy tắc sinh và kiểm `acknowledgements`

Một quy tắc duy nhất, áp cho cả FE, BE và QA — **không** bên nào được diễn giải khác:

```text
acknowledgements = { khóa nhóm | nhóm.status == "PRESENT" }
```

| Điều kiện | Server phải làm |
|---|---|
| `acknowledgements` **thiếu** một khóa `PRESENT` | `422 PRG-ERR-ACK-MISSING-001`, nêu khóa thiếu |
| `acknowledgements` **thừa** một khóa `NONE` | `422 PRG-ERR-ACK-UNEXPECTED-001` — dấu hiệu client dùng danh sách cố định cũ |
| Bất kỳ nhóm nào có `status = "UNAVAILABLE"` | `422 PRG-ERR-IMPACT-UNAVAILABLE-001`, **chặn Commission**, kể cả khi client gửi đủ acknowledgement |
| Nhóm thiếu field, `null`, hoặc không có `status` | Xử lý **như** `UNAVAILABLE` và chặn — fail-closed |
| Cả bốn nhóm `NONE`, `acknowledgements = []` | Hợp lệ; vẫn kiểm `re-auth` và vẫn đọc ngược |
| `impactRef` không khớp impact hiện tại | `409 PRG-ERR-IMPACT-STALE-001` |

Kiểm ở **server** là bắt buộc. FE ẩn ô xác nhận là tiện lợi cho người dùng, không
phải cơ chế an toàn; một client tự viết vẫn phải bị chặn đúng như trên.

## 7. Realtime event

WebSocket/SSE topic versioned:

```text
programming.runtime.v1
programming.check.v1
programming.operation.v1
programming.monitor.v1
```

Envelope:

```json
{"type":"programming.runtime.v1","sequence":123,"observedAt":"...",
 "payload":{},"correlationId":"..."}
```

Client phát hiện sequence gap phải refetch REST snapshot. Reconnect không replay
mutation; monitor sample thiếu quá 3 kỳ chuyển Stale.

## 8. Internal BE ↔ Core contract

Transport đề xuất là Unix-domain socket versioned, peer credential và file
permission tối thiểu. Request phải bounded; artifact truyền qua file descriptor
hoặc staging file đã checksum, không base64 1 MiB trong RT handler.

| Action | Input | Output |
|---|---|---|
| `capabilities` | request/version | target ABI/profile/limits/cutover state |
| `status` | none | active/LKG/task/safe-state/retain/arbitration summary |
| `stage` | operation, revision, artifact locator/hash | verified/rejected + detail |
| `activate` | operation, expected active, transition plan | accepted-at-safe-boundary |
| `operation_status` | operation | state/read-back/fault |
| `restore` | operation, target LKG, transition plan | accepted/rejected |
| `trace_start/stop` | bounded selector/limits | trace identity/reason |
| `retain_reset` | operation, scope | atomic result |

Bất biến: internal error luôn có `keepsRunningRevision`, `activeRevisionId` nếu
có, và detail code; core không nhận role từ FE, chỉ nhận request đã authorize
có actor/correlation để audit đối chiếu.

## 9. Error code authority

| Code | Lớp | Hành vi |
|---|---|---|
| `PRG-ERR-REQ-001` | malformed/unsupported request | reject, không side effect |
| `PRG-ERR-NOT-FOUND-001` | Project/Revision không tồn tại hoặc không được lộ | 404, không side effect |
| `PRG-ERR-CONFLICT-001` | stale base/ETag | 409, giữ cả version |
| `PRG-ERR-SCOPE-001` | ngôn ngữ/Point/period ngoài Rev A | 422 |
| `PRG-ERR-MAP-003` | identity/direction/writable không hợp lệ | 422, field location |
| `PRG-ERR-MAP-004` | type/unit không tương thích | 422, field location |
| `PRG-ERR-CHECK-001` | Check fail/timeout | không tạo Ready |
| `PRG-ERR-ARTIFACT-001` | magic/schema/size/hash/control-flow/resource | loader reject, LKG giữ |
| `PRG-ERR-TARGET-001` | ABI/profile/controller mismatch | reject trước stage |
| `PRG-ERR-CUTOVER-001` | graph/program dual request | 409, LKG giữ |
| `PRG-ERR-RETAIN-001` | retain layout incompatible/corrupt | cold-init cần acknowledgement/diagnostic |
| `PRG-ERR-OP-001` | operation đang chạy/idempotency mismatch | 409 |
| `PRG-ERR-COM-001` | Commission rejected/failed | active cũ giữ, query operation |
| `PRG-ERR-RESTORE-001` | Restore rejected/failed | active cũ giữ |
| `PRG-ERR-IMPORT-001` | bundle corrupt/executable/wrong target | reject, không ghi/activate |
| `PRG-ERR-ACK-MISSING-001` | thiếu acknowledgement cho nhóm impact `PRESENT` | 422, nêu khóa thiếu; không side effect |
| `PRG-ERR-ACK-UNEXPECTED-001` | gửi acknowledgement cho nhóm impact `NONE` | 422; dấu hiệu client dùng danh sách cố định cũ |
| `PRG-ERR-IMPACT-UNAVAILABLE-001` | có nhóm impact `UNAVAILABLE`, thiếu field hoặc `null` | 422 fail-closed, **chặn Commission/Restore** |
| `PRG-ERR-IMPACT-STALE-001` | `impactRef` không khớp impact hiện tại | 409, client đọc lại impact và xác nhận lại |
| `PRG-ERR-UNAVAILABLE-001` | core/compiler tạm unavailable | 503, retry hint/query |

Các mã component hiện hữu `API-E-*`, `IR-E-*`, `ST-*`, `RT-RETAIN-*` là detail
code. BE map chúng sang `PRG-ERR-*` nhưng vẫn giữ `detailCode` để service; không
được đổi nghĩa hoặc làm FE phụ thuộc trực tiếp vào mã nội bộ trước migration.

As-Built `TASK-PROG-205`: catalog v1.2.0 có **20 public code / 80 detail mapping**;
ba detail Check worker/sandbox/artifact mới map vào public code hiện hữu, không
tạo nhánh xử lý công khai thứ hai. SHA-256 ghim trong
`error_catalog_v1.manifest.json`; generator sinh Go/C++/TS và fail nếu §9, source
detail, OpenAPI hoặc consumer bị drift.

As-Built `TASK-PROG-400`: catalog v1.3.0 có **20 public code / 82 detail
mapping** — bổ sung `ST-RT-009`/`ST-RT-010` (PID `dt` không hợp lệ ở
`TASK-PROG-303`, Task overrun ở `TASK-PROG-304`) map vào `PRG-ERR-COM-001` hiện
hữu; đây là khoảng hở phát hiện khi chạy `npm run build` gate cho
`TASK-PROG-400` — hai task nguồn thêm mã `ST-RT-*` mới trong `st_diagnostic.hpp`
nhưng chưa đồng bộ catalog, sửa cùng phiên theo nguyên tắc "làm hết việc".

As-Built `TASK-PROG-404/405`: catalog v1.4.0 có **20 public code / 99 detail
mapping**, bổ sung detail operation/journal/checkpoint/IPC mới từ cả server và
coordinator; generator quét cả hai source để không tái diễn drift.

## 10. Compatibility và contract gate

- Mọi schema có version; unknown major bị reject, unknown optional field theo
  policy minor không phá vỡ consumer.
- OpenAPI, Go handler/model, TS generated types và contract tests phải cùng commit.
- Internal protocol/schema và core/BE negative tests phải cùng commit.
- Đổi artifact/RETAIN/SHM/IOP contract cần compatibility, deploy order và rollback
  riêng; IFSPEC này không tự đổi các contract machine-readable hiện hành.

## 11. Ma trận hợp đồng REST mức triển khai

Các timeout bên dưới là ngân sách phía BE; reverse proxy phải lớn hơn tối thiểu
2 giây. `POST` bất đồng bộ chỉ xác nhận đã ghi operation bền vững, không xác nhận
Core đã đổi trạng thái.

| Endpoint | Thành công | Idempotency / concurrency | Timeout | Side effect và điều kiện an toàn |
|---|---|---|---:|---|
| `GET /capabilities` | `200`, cache 5 s | không | 1 s | read-only; trả `targetState=TARGET-PENDING` khi decision chưa duyệt |
| `GET /projects` | `200` + cursor | không | 2 s | read-only; tối đa 100 item/page |
| `POST /projects` | `201` | key bắt buộc, TTL 24 h | 3 s | một transaction tạo Project, Draft và audit |
| `GET /projects/{id}` | `200` + ETag | không | 2 s | read-only; kiểm UUID/checksum; trả cả Draft identity và Revision nền; archived hoặc không có trả 404 |
| `PATCH .../draft` | `200` + ETag mới | key + `If-Match` bắt buộc | 5 s | all-or-nothing; không tạo Revision/Artifact |
| `POST .../revisions` | `201` | key + Draft ETag | 5 s | đóng snapshot immutable; Draft không đổi nếu fail |
| `GET /revisions/{id}` | `200` | không | 2 s | read-only; manifest/object checksum phải khớp trước response |
| `GET /revisions/{from}/changes/{to}` | `200` | không | 2 s | hai Revision cùng Project; change/impactRef sort + hash ổn định; Core impact chưa biết là `UNAVAILABLE` |
| `POST .../checks` | `202` | key + revision + target | 3 s accept | ghi Check `QUEUED`; compiler chạy ngoài RT; không stage |
| `GET /checks/{id}` | `200` | không | 2 s | read-only; diagnostics tối đa theo capability |
| `GET /runtime[/monitor]` | `200` | không | 1 s | đọc snapshot authoritative; không suy trạng thái từ DB |
| `POST /runtime/traces` | `202` | key bắt buộc | 3 s | quota trước khi mở capture; tuyệt đối không đổi output |
| `DELETE /runtime/traces/{id}` | `204` | lặp lại vẫn `204` | 3 s | dừng capture, giữ metadata/audit |
| `POST /operations/commission` | `202` | key + expected active | 3 s accept | ghi operation trước IPC; chỉ một mutation runtime/controller |
| `POST /operations/restore` | `202` | key + expected active | 3 s accept | cùng verify path với Commission, không bypass loader |
| `GET /operations/{id}` | `200` | không | 2 s | nguồn duy nhất để reconcile timeout/unknown |
| `POST /bundles/export` | `200` + ZIP base64/hash/audit | key + revision set | 3 s | ZIP Store/path sort/timestamp 1980 cố định; path UTF-8 NFC; entry regular không executable/comment/extra metadata; chỉ Revision source/config allowlist, không artifact/IR/native/cache |
| `POST /bundles/import` | `201` + Project/Draft ETag | key + bundle hash | 5 s | request tối đa 6 MiB, ZIP raw tối đa 4 MiB, entry tối đa 256 KiB; validate count/path NFC/kind/hash/size/manifest/flags/mode/comment/timestamp/extra; chỉ tạo Project/Draft, không Check/Commission/activate |
| `POST /retain/reset` | `202` | key + one-time confirmation | 3 s accept | operation riêng; Core reset ở safe boundary; audit bắt buộc |
| `GET /audit` | `200` + cursor | không | 3 s | sanitize theo role; không trả source/secret ngoài policy |

### 11.1 Header, cursor và giới hạn request

- `Authorization`, cookie session, CSRF và Origin dùng security baseline hiện
  hành; role được quyết định server-side. Không chấp nhận role trong payload.
- `X-Correlation-ID`: 16–64 ký tự `[A-Za-z0-9._-]`; BE tạo nếu thiếu và trả lại.
- `X-Idempotency-Key`: UUID v4; uniqueness theo `actor + action + target`;
  receipt giữ 24 giờ qua restart; cùng key khác canonical request hash trả
  `409 PRG-ERR-IDEMPOTENCY-CONFLICT-001`.
- `If-Match`: ETag mạnh; thiếu ở mutation optimistic trả `428`; stale trả `409`.
- Cursor là token opaque có MAC, hạn 15 phút; `limit` mặc định 50, tối đa 100.
- JSON mutation tối đa 1 MiB; riêng import bundle tối đa 6 MiB để mang base64;
  ZIP giải mã tối đa 4 MiB, 1024 file và 256 KiB/file. ST source mỗi Program tối
  đa 64 KiB. Vượt giới hạn trả `413` trước decode sâu.
- Mọi timestamp UTC RFC 3339 nano; mọi ID UUID v4; số thực JSON phải hữu hạn,
  cấm `NaN/Infinity`; unknown enum bị reject.

### 11.2 Response mutation và operation

Mọi mutation đồng bộ trả `resource`, `etag`, `auditId`, `correlationId`. Mọi
operation bất đồng bộ trả tối thiểu:

```json
{
  "operationId":"uuid",
  "statusUrl":"/api/v1/programming/operations/uuid",
  "state":"QUEUED",
  "requestHash":"sha256-hex",
  "acceptedAt":"2026-08-09T00:00:00Z",
  "correlationId":"opaque"
}
```

`Retry-After` chỉ dùng cho polling/429/503. Client không POST lại khi HTTP timeout
nếu chưa query bằng idempotency key hoặc operation ID.

## 12. Hợp đồng BE ↔ Core mức field

Socket target: `${RUNTIME_DIR}/mkddc/programming-v1.sock`; owner/group do package
manifest cấu hình, mode `0660`. BE kiểm tra peer là Core service UID; Core kiểm
tra peer thuộc UID/group cho phép bằng `SO_PEERCRED`. Frame length-prefix 32-bit
little-endian, payload canonical CBOR, tối đa 64 KiB; artifact đi qua file staging
mode `0640`, locator phải nằm dưới `${STATE_DIR}/programming/staging/` và dùng
`openat2`/equivalent để cấm traversal/symlink.

Ba gốc thư mục **không** được hoán đổi cho nhau, vì backup, quota và quyền ghi
của chúng khác nhau:

| Gốc | Đường dẫn target | Nội dung Programming | Vì sao không dùng gốc khác |
|---|---|---|---|
| `CONFIG_DIR` | `/data/config` | `programming/programming-v1.sqlite` (authority theo `DM-PROG-001` §9) | Cấu hình được backup/khôi phục theo chu kỳ khác; không chứa file rác theo từng Commission |
| `STATE_DIR` | `/data/mkddc` | `programming/staging/`, `programming/artifacts/sha256/`, RETAIN, journal | Trạng thái vận hành có churn cao và quota riêng; đây là gốc mà `platform/packaging` tạo cho `state/staging/retain/journal` |
| `RUNTIME_DIR` | `/run/mkddc` | `programming-v1.sock` | tmpfs, mất khi reboot — đúng cho socket, sai cho artifact |

BE ghi artifact và staging file dưới `STATE_DIR`; Core mở locator dưới **cùng**
gốc đó. Locator nằm ngoài `${STATE_DIR}/programming/staging/` bị reject bằng
`PRG-ERR-ARTIFACT-001` trước khi mở file, không phụ thuộc hash.

| Field chung | Kiểu / giới hạn | Bắt buộc | Quy tắc |
|---|---|---|---|
| `protocolMajor/minor` | `u16/u16` | có | major lệch reject; minor dùng capability negotiation |
| `requestId` | UUID 16 byte | có | correlation request/response, không phải idempotency |
| `operationId` | UUID 16 byte | mutation | trùng cùng hash trả trạng thái cũ; khác hash reject |
| `controllerId` | UTF-8 1..64 | có | phải khớp controller local configured |
| `actorId` | UTF-8 1..128 | mutation | chỉ audit; Core không dùng để authorize |
| `deadlineMonoNs` | `u64` | có | hết hạn trước action thì reject, không side effect |
| `payloadHash` | SHA-256 32 byte | có | hash canonical payload |

| Action | Payload riêng | Response / giới hạn |
|---|---|---|
| `CAPABILITIES` | không | ABI/profile, limits, periods, cutover, max frame |
| `STATUS` | selector bitset | active/LKG/hash/task/fault/retain/producer; ≤16 KiB |
| `STAGE` | revision, locator, size, SHA-256, target/profile | `STAGED` hoặc reject detail; ≤1 artifact/op |
| `ACTIVATE` | expected active, staged token, retain plan, cutover plan | `ACCEPTED`; transition chỉ ở safe boundary |
| `OPERATION_STATUS` | operation ID | state, step, active/read-back, error, timestamps |
| `RESTORE` | target revision/artifact, expected active, transition | chạy lại verify; không dùng blob đang lỗi |
| `TRACE_START` | selector ≤64, period, duration, max samples | trace ID/quota; read-only |
| `RETAIN_RESET` | scope, expected active, confirmation digest | reset result/layout generation |

Core phải trả response trước deadline hoặc đóng frame với
`PRG-ERR-UNAVAILABLE-001`; không block scan loop để chờ client. Buffer IPC cấp
phát ở non-RT worker, queue tối đa 32 request; đầy queue trả busy, không drop
request mutation âm thầm.

## 13. State, ordering và phục hồi

### 13.1 Draft mutation

```text
authenticate → authorize → size/schema validate → load Draft + ETag
→ compare If-Match → apply operations in-memory → semantic/reference validate
→ BEGIN IMMEDIATE → write Draft + audit + idempotency result → COMMIT
→ return ETag; any error → ROLLBACK, ETag giữ nguyên
```

### 13.2 Check

`QUEUED → RUNNING → {PASSED | FAILED | TIMED_OUT}`. Chỉ `PASSED` tạo Artifact row
immutable. Worker crash được lease/retry tối đa một lần trên cùng input hash
(`attempt_count ≤ 2`); hết attempt chuyển `FAILED`. Deadline/compiler timeout
chuyển `TIMED_OUT`; resource/sandbox/verify violation chuyển `FAILED`. Mọi nhánh
lỗi không có Artifact một phần và không stage/activate.

### 13.3 Commission/Restore

```text
QUEUED → PREFLIGHT → STAGING → VERIFYING → WAIT_SAFE_BOUNDARY
→ ACTIVATING → FIRST_CYCLE_VERIFY → SUCCEEDED
                              ↘ ROLLING_BACK → FAILED
mọi mất liên lạc sau STAGING → UNKNOWN_RECONCILING → query Core/read-back
```

BE chỉ ghi `SUCCEEDED` sau read-back active ID, artifact hash, target/profile và
first-cycle. Restart BE quét `non_terminal operation`; restart Core đọc journal
transition và chọn active cũ hoặc candidate đã commit đầy đủ, không suy đoán từ
DB Web. Hai operation mutable cùng controller bị serialize bằng DB lock + Core
single-flight guard.

## 14. Ánh xạ lỗi component → public

| Detail exact / điều kiện | Public code | HTTP | Retry | Runtime giữ |
|---|---|---:|---|---|
| JSON/schema; `API-E-001/002` | `PRG-ERR-REQ-001` | 400/413/422 | không | có |
| ETag/idempotency/single-flight | `PRG-ERR-CONFLICT-001` hoặc `PRG-ERR-OP-001` | 409 | query/sửa | có |
| `ST-LEX-*`, `ST-SYN-001`, semantic không phải scope | `PRG-ERR-CHECK-001` | 422/job failed | sửa source | có |
| `ST-LIM-*`, `ST-SYN-002`, type/function ngoài profile | `PRG-ERR-SCOPE-001` | 422 | sửa source/profile | có |
| `IR-E-001..003/005..012/014..015` | `PRG-ERR-ARTIFACT-001` | 422/op failed | không | có |
| `IR-E-004` ABI, `IR-E-013` profile, `API-E-003` target | `PRG-ERR-TARGET-001` | 422 | không | có |
| `ST-IOMAP-*` trừ `003` | `PRG-ERR-MAP-003` | 422 | không | có |
| `ST-IOMAP-003` | `PRG-ERR-MAP-004` | 422 | không | có |
| graph owner/transition conflict | `PRG-ERR-CUTOVER-001` | 409 | sau reconcile | có |
| `RT-RETAIN-*` | `PRG-ERR-RETAIN-001` | 422/op failed | acknowledgement | có/cold-init theo plan |
| `IPC-REQUEST-ID-CONFLICT` | `PRG-ERR-OP-001` | 409 | query/sửa | có |
| `IPC-CONTRACT-ONLY/DEADLINE/QUEUE-FULL`, detail/component lạ | `PRG-ERR-UNAVAILABLE-001` | 503/504/429 | query trước | mặc định false = **chưa xác nhận** |

Error log nội bộ có `detailCode`, nhưng public `args` không chứa path, source
đầy đủ, stack, UID hay secret. Lỗi authorization dùng thông báo đồng nhất để
không dò existence. `messageKey`, `retryable` và HTTP class phải lấy từ catalog;
HTTP/code mismatch bị chuẩn hóa fail-safe. Producer chỉ đặt
`keepsRunningRevision=true` khi có invariant/read-back chứng minh; detail lạ
không được báo optimistic success.

## 15. Security, tương thích và triển khai

- REST bắt buộc TLS theo security design; khi As-Built còn HTTP/8081 thì route
  Programming mutation phải giữ feature flag OFF.
- CSRF token + same-origin bắt buộc cho cookie mutation; WebSocket xác thực lúc
  handshake và đóng khi session hết hạn/role bị thu hồi.
- Rate limit theo actor/controller: read 120/phút, mutation Draft 30/phút,
  Check 6/phút, Commission/Restore 2/phút; authority có thể giảm, không tự tăng.
- Deploy order: DB migration tương thích ngược → Core hỗ trợ protocol mới nhưng
  chưa active → BE/contract → FE → bật read-only → bật mutation sau approval.
- Rollback FE/BE được phép khi schema/IPC minor tương thích; không rollback Core
  qua artifact/RETAIN major đang active. Phải Restore artifact tương thích trước.
- `contracts/openapi/openapi.yaml`, generated Go/TS và internal schema chỉ được
  cập nhật sau Product/System Architect duyệt các target decision. Cho tới đó,
  file này là review package, không phải machine-readable authority active.

## 16. Ánh xạ repository và kiểm chứng

| Thành phần target | Đường dẫn cần tạo/sửa | Kiểm chứng bắt buộc |
|---|---|---|
| OpenAPI | `contracts/openapi/openapi.yaml` | schema lint + breaking-change + examples |
| BE route/model | `apps/web-api/internal/programming/{transport,application,store}` | Go unit/integration/race/contract |
| DB/migration | `apps/web-api/internal/programming/store`, migration package | migration up/down, crash/restart, concurrent writer |
| FE client/type | `apps/web-ui/src/features/programming/api`, generated types | MSW/contract + stale/timeout/reconcile UI |
| Core IPC | `apps/core/application/programming`, `contracts/ipc/` | peer credential, fuzz frame, queue/deadline |
| Check compiler/artifact | `apps/web-api/internal/programming/{compiler,artifact,application,store}`, `apps/core/application/st/st_compile_main.cpp`, packaging | timeout/process group, rlimit/seccomp, manifest/hash/size, traversal/symlink/read-back/power-loss |

| Test ID | Tình huống | Kết quả định lượng/evidence |
|---|---|---|
| `IF-T-001` | cùng idempotency key và cùng body 10 lần | một side effect, cùng resource/operation ID |
| `IF-T-002` | cùng key, body khác | `409`, không đổi DB/Core |
| `IF-T-003` | ETag stale khi sửa Draft | `409`, trả expected/actual, Draft giữ nguyên |
| `IF-T-004` | timeout sau ACTIVATE | UI/BE vào `UNKNOWN`; query ra một active revision duy nhất |
| `IF-T-005` | frame 64 KiB+1 / traversal / symlink | reject trước open/load; LKG giữ |
| `IF-T-006` | BE/Core restart ở từng state operation | reconcile đúng; không double activation |
| `IF-T-007` | sequence gap event | FE refetch REST; không hiển thị stale như current |
| `IF-T-008` | viewer gọi mutation / role bị thu hồi | `403`; không IPC, có audit security |
| `IF-T-009` | OpenAPI ↔ Go ↔ TS examples | zero schema mismatch |
| `IF-T-010` | mixed-version deploy/rollback | minor tương thích; major bị chặn có chỉ dẫn restore |
| `IF-T-011` | seal → reload Project → seal/check lần hai | response có `baseRevisionId` bằng Revision vừa seal; request kế tiếp `201/202`, không conflict giả |

## 17. Envelope và ordering mẫu mức triển khai

Mutation thành công không trả domain object không versioned. Mẫu tối thiểu:

```json
{
  "data": {"operationId":"op_opaque","state":"PENDING"},
  "meta": {"requestId":"req_opaque","resourceVersion":"etag_opaque"}
}
```

Event realtime dùng:

```json
{
  "stream":"programming.runtime",
  "sequence":1842,
  "observedAt":"2026-08-09T08:00:00Z",
  "resourceVersion":"runtime_generation_77",
  "type":"operation.updated",
  "data":{"operationId":"op_opaque","state":"SUCCEEDED"}
}
```

`sequence` chỉ ordering trong một stream/session, không là DB version. FE thấy
gap, reconnect hoặc `resourceVersion` lùi phải refetch REST snapshot. Event không
được tự tạo terminal state nếu REST/Core read-back chưa khớp.

| Boundary | Timeout/cancel | Retry rule | Idempotency/read-back |
|---|---|---|---|
| FE → REST read | 10 s | exponential bounded, chỉ GET | ETag/resource version |
| FE → mutation | 15 s hoặc 202 | không auto retry body | key bắt buộc; query resource/operation |
| BE → compiler | hard 5 s `TARGET-PENDING` | job mới chỉ khi build key khác/failed safe | immutable build key + diagnostic |
| BE → Core status | 2 s | read retry bounded | operation ID + active hash |
| BE → Core stage/activate | deadline theo operation | không replay sau timeout | Core idempotent; reconcile status |
| Event stream | heartbeat/freshness capability | reconnect + REST refetch | last sequence chỉ làm gap hint |

## 18. Contract freeze và consumer checklist

Trước khi OpenAPI/IPC thành Active, owner phải chạy: schema lint; example
request/response; generated Go/TS compile; unknown field/version test; 403/409/
422/503/504 mapping; idempotency same/different body; event gap; mixed-version;
restart/reconcile. FE, BE và Core ký cùng exact schema hash. Thay field required,
enum meaning, error class hoặc ABI là breaking change dù endpoint path giữ nguyên.

## 19. Trạng thái thực thi, revision history và phê duyệt

| Hạng mục | Owner | Trạng thái implementation | Việc phải tạo/kiểm chứng |
|---|---|---|---|
| `PROG-OD-001`: `17 DECIDED`, `0 OPEN`, `0 CLOSED` | Product + discipline authority | **APPROVED** | cập nhật OpenAPI/code theo baseline v2.8 |
| TLS production chưa có | Security + Platform | **READY TO IMPLEMENT** | TLS/session/CSRF test theo Security DoD |
| Operation worker/lifecycle target | BE + Core + QA | **SUPPORTING TARGET PASS** | `EV-PROG-P5-507` chứng minh happy path; fault/power/restart Test Result độc lập theo Plan 53 P6 |

| Phiên bản | Ngày | Nội dung | Tác giả |
|---|---|---|---|
| 0.1 | 2026-08-09 | Draft REST/event/internal contract | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung field, timeout, idempotency, state, error map, deploy/rollback và test để đạt M3 | System Engineering |
| 0.3 | 2026-08-09 | Bổ sung response/event envelope, ordering/freshness, timeout/retry/idempotency table và contract-freeze checklist; chuyển Detailed Draft chờ review | System Engineering |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; đóng finding `F-PROG-001/002` | System Engineering |
| 0.5 | 2026-08-09 | Amendment A1: thêm §6.1 trạng thái ba nhánh `NONE/PRESENT/UNAVAILABLE` cho từng nhóm impact (fail-closed), và `?activeOnly=true` + phân trang cho `GET /overrides`; không thêm endpoint mới | System Engineering |
| 0.6 | 2026-08-10 | Đóng finding consumer review `F-CR-02`: staging artifact chuyển từ `${CONFIG_DIR}` sang `${STATE_DIR}/programming/staging/` để khớp `DDD-BE-PROG-001` §14, `DDD-FWSOM-PROG-001` §16 và `platform/packaging`; thêm bảng ba gốc `CONFIG_DIR`/`STATE_DIR`/`RUNTIME_DIR` và quy tắc reject locator ngoài gốc | System Engineering |
| 0.7 | 2026-08-10 | Ghi Product Owner/CTO + System Architect Phạm Đình Chương `ACCEPT` theo `AUTH-PROG-2026-08-10-01`, xác nhận `${STATE_DIR}/programming/staging/`; đồng bộ decision thành `3 DECIDED/14 OPEN`. Contract vẫn chưa Active vì discipline/TLS/BE-Core implementation/evidence còn thiếu | Product + Architect + Document Control |
| 0.8 | 2026-08-11 | Phê duyệt toàn bộ contract baseline theo `AUTH-PROG-2026-08-11-03`; 17/17 decision `DECIDED`; chữ ký discipline được miễn khỏi entry implementation; OpenAPI/IPC/TLS chuyển thành deliverable cần implement/test, không còn là approval blocker | Product + Architect |
| 0.9 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-100..103`: OpenAPI v1.16/25 route, IPC v1 skeleton và catalog lỗi v1.0.0 gồm 19 public/77 detail sinh Go/C++/TS; khóa unknown/detail/HTTP mismatch/public args fail-safe và giữ production lifecycle/target evidence còn mở | BE + Core + FE Lead |
| 1.0 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-204` tại `66848a1`: OpenAPI v1.17 và sáu operation Project/Draft/Revision nối SQLite v2, ETag mạnh, cursor HMAC, receipt idempotency 24 giờ/restart, immutable Revision và catalog v1.1.0 20 public/77 detail; giữ 19 operation còn 503, flag OFF và target evidence còn mở | BE + Core + FE Lead |
| 1.1 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-205` tại `e8c289e`: OpenAPI v1.18 và hai operation Check nối SQLite v3/application worker; receipt 24 giờ, lease/retry, `QUEUED/RUNNING/PASSED/FAILED/TIMED_OUT`, sandbox/artifact verify và catalog v1.2.0 20 public/80 detail; giữ 17 operation còn 503, flag OFF và target evidence còn mở | BE + Core + FE Lead |
| 1.2 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-206` tại `95b9388`: OpenAPI v1.19 và ba operation change/export/import nối SQLite v4; change/impactRef deterministic, ZIP Store source-only 4 MiB có manifest/hash/audit và import atomic chỉ tạo Project/Draft; giữ 14 operation còn 503, flag OFF và target evidence còn mở | BE + Core + Security Lead |
| 1.3 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-207` tại `3e5281d`: khóa bundle path UTF-8 NFC, regular/non-exec, flags/comment/timestamp/extra metadata, raw 4 MiB và entry 256 KiB; hostile corpus 25 lớp zero-mutation và HTTP 6 MiB+1→413; giữ 14 operation còn 503, flag OFF và Test Result/target evidence còn mở | BE + Security + Verification Lead |
| 1.4 | 2026-08-13 | Đồng bộ As-Built `TASK-PROG-400` tại `a523a04`: catalog lỗi v1.2.0→v1.3.0 (20 public/82 detail), bổ sung `ST-RT-009`/`ST-RT-010` map vào `PRG-ERR-COM-001` — khoảng hở phát hiện khi chạy `npm run build` gate, sửa cùng phiên; không đổi endpoint/state machine/decision | BE + Core Lead |
| 1.5 | 2026-08-13 | Đồng bộ `TASK-PROG-403..405` tại `c2f3189` + `10d9ad6`: Commission/Restore/Get operation handler, durable idempotent state machine, STATUS/OPERATION_STATUS/STAGE/RESTORE/ACTIVATE UDS và catalog v1.4.0 20 public/99 detail. Giữ flag OFF và target/HIL Test Result chưa chạy. | BE + Core + QA |
| 1.6 | 2026-08-13 | `TASK-PROG-507` tại `d9a8e3b`: Foxlinx phát hiện Check lần hai conflict giả vì `ProgrammingProject` chỉ trả Draft ID trong khi backend yêu cầu Revision nền sau seal. Bổ sung required response field `baseRevisionId`, khóa semantics first-seal/post-seal và test HTTP read-back; FE dùng field này cho save/seal. Target xác nhận Revision `201` + Check `202`; không Commission, flag cuối OFF. | BE + FE + QA |
| 1.7 | 2026-08-13 | Hoàn tất `TASK-PROG-507` tại `0f1526c`: deploy compiler/Core/Web/FE ARM64 và bật cờ FE/BE trên Foxlinx. Sửa tương thích `ao/do:null` cũ theo fail-safe (`null` chỉ về default rỗng; type sai vẫn reject). Hai Check `PASSED`; Commission fixture không output `SUCCEEDED/COMMITTED`; Core đọc-ngược Active/LKG/Task `RUNNING`. `EV-PROG-P5-507` là supporting target evidence, không tự nâng Test Result/HIL. | BE + Core + FE + Ops + QA |

| Vai trò | Trạng thái | Ngày / bằng chứng |
|---|---|---|
| Backend Lead | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm trong task P1 |
| Runtime Architect | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm trong task P1–P3 |
| Security + FE + QA | **WAIVED FOR IMPLEMENTATION** | contract/security test theo DoD; không chặn code |
| System Architect + Product Owner | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | `AUTH-PROG-2026-08-11-03` |

### 19.1 Kết quả checklist vòng chi tiết

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; revision history và bảng ký §19 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §1 quy tắc chung; §10 ranh giới contract gate |
| `DD-03` As-Built | PASS | §0 câu 3 và §3/§11/§13.2/§16 dẫn Commission/Restore/status + Core lifecycle tại `c2f3189`/`10d9ad6`; `EV-PROG-P5-507` ghim target cờ `ON`, Check/Commission/read-back |
| `DD-04` Target ownership | PASS | §8 và §12: BE là producer REST/WS, Core là authority của runtime truth; §13 ai giữ trạng thái nào |
| `DD-05` Data từng field | PASS | §4 payload mutation, §11.1 header/cursor/giới hạn, §11.2 response, §12 hợp đồng BE↔Core mức field |
| `DD-06` Interface | PASS | §3 resource, §5 Check, §6 Commission, §7 event, §11 ma trận REST, §15 security/tương thích/triển khai, §17 envelope mẫu |
| `DD-07` State/ordering/timing | PASS | §13.1–§13.3 state và phục hồi cho Draft/Check/Commission; §11.1 timeout/retry/idempotency |
| `DD-08` Operation flow | N/A tại file này | Luồng người dùng thuộc UI/UX Design; file này chỉ định nghĩa hợp đồng. §13 mô tả đủ thứ tự gọi để FE dựng flow |
| `DD-09` Error/safety/security | PASS | §2 envelope, §9 **authority mã lỗi** `PRG-ERR-*`, §14 ánh xạ lỗi component → công khai, §15 security |
| `DD-10` Repository mapping | PASS | §16: handler BE, sinh type FE, và yêu cầu đưa spec vào `contracts/openapi/openapi.yaml` |
| `DD-11` Verification | PASS | §16 gắn `VS-PROG-019/022/024/026`; §18 checklist đóng băng contract cho consumer |
| `DD-12` Compatibility/deploy/rollback | PASS | §10 contract gate; §15 thứ tự triển khai và tương thích |
| `DD-13` Trace/risk/decision/sign-off | **PASS FOR IMPLEMENTATION** | 17/17 decision `DECIDED`; Product + Architect `ACCEPT ALL`; BE-Core source đã có. TLS/target/HIL evidence vẫn là blocker release, không phải blocker code |

Không còn blocker implementation hoặc deploy P5. Commission/Core đã chạy
end-to-end trên Foxlinx với supporting target evidence. Fault/power/HIL và
review độc lập vẫn `NOT TESTED`; đó là cổng assurance/release P6, không phải
chức năng Programming còn tắt hoặc chưa implement.
