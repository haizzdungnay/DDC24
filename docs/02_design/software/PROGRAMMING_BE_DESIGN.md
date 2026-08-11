# Thiết kế Backend Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-BE-PROG-001` |
| Phiên bản | 0.6 |
| Trạng thái | **M3 — Review Ready** — DD-01..13 đủ; chờ Core/Security/QA review |
| Ngày | 2026-08-09 |
| Chủ quản | Backend Lead |
| Người review | Core Lead, Security Lead, Verification Lead, Operations Lead |
| Người phê duyệt | Backend Lead + System Architect |
| Nguồn | `DM-PROG-001`, `IFSPEC-PROG-001`, `DDD-LIFE-PROG-001`, `DDD-SEC-PROG-001` |
| Requirement | `SWR-REQ-PROG-BE-101..110` |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **backend Go tổ chức ra sao**: chia package, lưu trữ, chạy compiler job, điều phối Commission, phân quyền, audit và migration. Đây là nơi biến hợp đồng API thành code chạy được. |
| 2. Ai phải đọc file này? | BE Lead và lập trình viên Go (chủ quản); Core đọc §4 (điều phối Commission) và §6 (read model); Security đọc §7; Ops đọc §9; QA đọc §10 và §17. |
| 3. Hệ thống hiện tại đang có gì? | `apps/web-api` là tiến trình Go duy nhất theo ADR-005/007. `internal/app` hiện đã wiring auth, health, historian, hmi, modbusrtu, network, points và system — **chưa có Programming**. Driver SQLite `modernc.org/sqlite` đã là dependency sẵn, nhưng chưa có schema, route hay worker nào cho Programming. |
| 4. Thiết kế mới thay đổi điều gì? | Thêm một module có giới hạn tại `apps/web-api/internal/programming/` với bảy thư mục con (`domain`, `store`, `compiler`, `runtime`, `service`, `transport`, `tests`). **Không tạo tiến trình thứ tư.** Quy tắc phân lớp: handler không chứa logic compiler/runtime; store không gọi Core; runtime adapter không biết HTTP hay session. |
| 5. Team phải sửa module/contract nào? | §11 và §12. Wiring trong `internal/app`; mount `/api/v1/programming` với middleware auth/CSRF/correlation/rate; thêm cấu hình DB/staging/quota/feature flag; mở rộng health để phản ánh hàng đợi compiler và khả năng kết nối Core. |
| 6. Điều gì còn bị chặn? | Hạn mức và retention chờ `OD-PROG-003/010`; ma trận quyền chờ `OD-PROG-001`; giao thức BE↔Core chưa tồn tại nên phần điều phối chưa chạy thật được. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §10 và §17: unit, contract, integration, hai client đồng thời, restart, và đầu vào độc hại — cộng `VS-PROG-001/019/022/024`. Dùng `go vet ./...` và `go test ./... -count=1` (bắt buộc `-count=1`, vì cache có thể che hồi quy). Chưa chạy bài nào cho Programming. |

Hai điều BE **không** được làm: tin vai trò do FE gửi trong payload, và báo
thành công khi Core chưa xác nhận. Cả hai đều là rủi ro đã có tên —
`RSK-PROG-012` và `RSK-PROG-007`.

## 0.1 Ảnh hưởng của Amendment A1 lên BE

Việc gộp sáu trang thành bốn workspace là thay đổi **phía trình bày**. BE
**không** thêm hay bớt endpoint nào, và hợp đồng ở `IFSPEC-PROG-001` giữ nguyên.
Hai điều duy nhất BE cần lưu ý:

1. **`GET /overrides` bị gọi từ ba nơi thay vì một.** Tổng quan đếm việc cần chú
   ý, trang Kiểm tra & Vận hành quyết định có hiện ô xác nhận override hay không,
   và Runtime hiển thị bên đang giữ đầu ra. Handler phải chịu được nhịp gọi này:
   bắt buộc phân trang, và cho phép lọc `?activeOnly=true` để Tổng quan chỉ lấy
   số đếm thay vì toàn bộ danh sách.
2. **Impact phải đủ chi tiết để FE quyết định hiện ô xác nhận nào.** Vì
   `SWR-REQ-PROG-FE-113` yêu cầu chỉ hiện ô cho ảnh hưởng **có thật**, response
   impact phải phân biệt rõ “không có ảnh hưởng” với “chưa tính được”. Trường
   thiếu hoặc `null` **không** được FE hiểu là không có ảnh hưởng — nó phải chặn
   Commission. Xem `IFSPEC-PROG-001` §6.

Không có thay đổi nào với persistence, worker, RBAC hay audit.

## 1. Ranh giới module

Target nằm trong `apps/web-api/internal/programming/`, được wiring tại
`internal/app`. Không tạo daemon mới. Module đề xuất:

```text
programming/
├── domain/       project, revision, check, operation, audit types/invariants
├── store/        SQLite transaction, migrations, artifact/bundle storage
├── compiler/     isolated worker adapter, limits, diagnostic normalization
├── runtime/      versioned Core IPC client + reconciliation
├── service/      use cases and authorization-independent business policy
├── transport/    handlers/OpenAPI mapping, RBAC middleware
└── tests/        unit, integration, contract, fault injection
```

Tên gói tầng biên là `transport`, không phải `http`: §12 khai báo
`transport.Handler` và `IFSPEC-PROG-001` §16 ghi đường dẫn
`apps/web-api/internal/programming/{transport,service,store}`. Một tên duy nhất
cho một gói — nếu đổi thì phải đổi cả ba nơi trong cùng commit.

Handler không chứa compiler/runtime logic; store không gọi Core; runtime adapter
không biết HTTP/session.

## 2. Persistence

Các bảng logic tối thiểu:

```text
programming_projects
programming_drafts + programming_draft_objects
programming_revisions + programming_revision_objects
programming_checks + programming_diagnostics
programming_artifacts
programming_operations + programming_commission_records
programming_audit_events
```

- Foreign key, unique stable ID, schema version và transaction bật.
- Draft mutation batch tăng version/ETag một lần.
- Revision/object immutable bằng permission + trigger/service invariant.
- Artifact file write temp→fsync→rename; DB commit chỉ sau checksum/locator hợp lệ.
- Operation/audit persist trước external side effect để recovery biết ý định.

## 3. Check/Compiler pipeline

```text
Revision snapshot
→ schema/capacity/reference validation
→ ST parse/semantic hoặc FBD normalize/type/topology
→ common typed IR
→ mapping/Task/library/target/RETAIN/cutover/resource validation
→ immutable artifact + source map + manifest + SHA-256
→ BE verifies build output metadata
→ Check PASSED/READY
```

Compiler chạy subprocess không đặc quyền với:

- read-only Revision input, private temporary directory;
- CPU/memory/file-size/process/time limit;
- no network, no device, no config/data write ngoài output fd;
- hard timeout 5 s proposal, kill whole process group;
- stdout/stderr bounded và sanitize;
- deterministic version/profile recorded.

Compiler failure không crash Web và không tạo Artifact Ready.

## 4. Commission coordinator

Preflight trong một transaction/consistent snapshot:

1. authorize admin và validate idempotency;
2. khóa logic per-controller operation;
3. xác nhận Revision/Check/Artifact/target cùng identity;
4. xác nhận expected active/base chưa đổi;
5. refetch core capabilities/cutover/overrides;
6. build readiness + change/RETAIN/output impact;
7. persist operation `REQUESTED/PREFLIGHT`;
8. stage/activate qua Core IPC;
9. chuyển async `VERIFYING`, query read-back;
10. persist final CommissionRecord + audit rồi release lock.

Nếu BE chết ở bước 8–9, startup worker quét operation chưa terminal và reconcile
theo operation ID/core active revision. Không tự gửi activate lần hai nếu chưa
biết kết quả.

## 5. Restore và replacement

Restore dùng cùng loader/verify/safe-boundary/read-back, không có “cửa sau” copy
state runtime. Target phải là Revision/artifact còn compatible và đã review
impact. Bundle export chỉ source canonical + manifest/hash; import:

- stream với total/file count/ratio/size limit;
- reject absolute path, `..`, symlink/hardlink, device node và executable/build;
- extract trong temp private;
- validate manifest/hash/schema/target references;
- tạo Project/Draft mới atomic;
- không Check/Commission tự động.

## 6. Runtime read model

BE lấy status/monitor từ Core authority, thêm Project/Revision metadata bằng
identity join nhưng không ghi đè core fields. Mỗi field giữ `source/observedAt`.
Core unreachable trả last observed data với `STALE/UNAVAILABLE`, không 500 toàn
page nếu Project/Draft vẫn đọc được.

Monitor/trace có backpressure, pagination/chunk và quota. WS/SSE event gap buộc
client refetch. BE không giữ buffer vô hạn hoặc lịch sử ẩn ngoài retention policy.

## 7. RBAC, audit và security

| Capability | viewer | operator | admin |
|---|:---:|:---:|:---:|
| list/read source/runtime/monitor/history | ✓ | ✓ | ✓ |
| edit/save/check | — | — | ✓ |
| commission/restore/import/export/reset retain | — | — | ✓ |

Audit mutation và reject gồm actor ID/role, remote context đã sanitize, action,
object/revision/controller, operation/correlation/idempotency hash, result/code
và timestamp. Không lưu raw token, password, private key, bundle bytes/artifact
hoặc full source trong log.

## 8. Error mapping

Domain/compiler/Core detail code map sang `PRG-ERR-*` ở HTTP boundary. Mapping
là bảng exhaustive; unknown internal error → `PRG-ERR-UNAVAILABLE-001` hoặc
internal generic, log correlation riêng, không lộ path/stack.

`keepsRunningRevision` chỉ lấy từ core/read-back hoặc invariant trước external
side effect; BE không tự nói active cũ đang chạy khi chưa xác minh.

## 9. Migration và rollback

- Pha đầu tạo schema/table nhưng route mutation sau feature flag `off`.
- Code mới đọc được empty/old DB; migration backup và transaction.
- Deploy order: contract/tests → BE read-only → Core capability → Check →
  Commission feature flag sau G5/G6.
- Rollback code không được xóa Revision/artifact/audit mới; core cũ reject
  artifact schema mới rõ ràng và LKG vẫn dùng được.

## 10. Test bắt buộc

- Domain/store unit + transaction/crash recovery.
- Migration up/down-compatible backup restore.
- Compiler timeout/OOM/malformed/fuzz/source limit.
- OpenAPI/Go/TS contract.
- Two-client ETag, idempotency retry và one-operation-per-controller.
- Core IPC timeout/drop/duplicate/restart/reconcile.
- RBAC/CSRF/import traversal/zip bomb/audit secret scan.
- BE restart giữa từng Commission step; active LKG không đổi hoặc result reconcile.

## 11. As-Built integration points

`apps/web-api` là Go process duy nhất theo ADR-005/007; `internal/app` hiện wiring
auth/health/historian/hmi/modbusrtu/network/points/system và chưa có Programming.
SQLite driver `modernc.org/sqlite` đã là dependency, nhưng không có schema/route/
worker Programming. Target thêm bounded module, không tạo service thứ tư.

| Integration | Target change | Không được làm |
|---|---|---|
| `internal/app` | construct store/compiler/runtime/service/handler, lifecycle start/stop | import vòng ngược domain→app |
| router/auth | mount `/api/v1/programming`, middleware auth/CSRF/correlation/rate | tin role từ payload/FE |
| config | Programming DB/state/staging/quota/feature flags | hard-code `/data` trong domain |
| health | compiler queue/Core capability/reconcile/disk watermark | báo healthy chỉ vì HTTP sống |
| metrics/log | bounded state/error/latency counters | source/token/path secret |

## 12. Package/API mức function

| Package/type | Method chính | Transaction/side effect |
|---|---|---|
| `domain.ProjectService` | `CreateProject`, `PatchDraft`, `SealRevision` | store transaction + audit; no Core |
| `domain.CheckService` | `RequestCheck`, `GetCheck`, `ReapLease` | idempotency + queue; artifact commit atomic |
| `domain.OperationService` | `Commission`, `Restore`, `ResetRetain`, `Reconcile` | durable op before IPC; controller single-flight |
| `store.Store` | `WithTx`, `Get*`, `ClaimCheck`, `ClaimOperation` | `BEGIN IMMEDIATE`, explicit rows affected |
| `compiler.Runner` | `Compile(ctx, BuildInput)` | child process bounded; no DB write |
| `runtime.Client` | `Capabilities`, `Status`, `Stage`, `Activate`, `OperationStatus` | UDS deadline/version/hash/peer |
| `transport.Handler` | decode/auth/map HTTP | no business mutation ngoài service |

Dependency injection dùng interface nhỏ; domain không import HTTP/SQLite/IPC. ID,
clock, idempotency và filesystem root injectable để test deterministic.

## 13. Transaction, locking và worker algorithm

```text
PatchDraft:
  authz → canonical request hash → BEGIN IMMEDIATE
  → find/create idempotency row → compare ETag
  → load/apply/validate whole batch → write Draft generation + audit + result
  → COMMIT; any failure ROLLBACK

OperationWorker:
  claim lease atomically where state eligible and lease expired
  → preflight using DB + fresh Core status
  → persist state/step before each external side effect
  → call Core with same operationId/requestHash/deadline
  → persist response/read-back
  → on ambiguous timeout mark UNKNOWN_RECONCILING
  → reconcile until terminal/backoff/deadline; never blind re-activate
```

Unique partial index bảo đảm một non-terminal operation/controller. Worker lease
có owner/expiry/generation; stale worker update dùng compare state+lease generation
và phải fail. Check queue tối đa theo config; disk low watermark chặn create/check/
export trước khi SQLite/artifact fsync fail.

## 14. Data/file lifecycle và quotas

- DB `${CONFIG_DIR}/programming/programming-v1.sqlite`, WAL/FK/FULL theo Data Model.
- Artifact content-addressed `${STATE_DIR}/programming/artifacts/sha256/...`, write
  temp+fsync+rename; row chỉ commit sau hash/read-back.
- Staging file bàn giao cho Core nằm dưới `${STATE_DIR}/programming/staging/`
  mode `0640` theo `IFSPEC-PROG-001` §12. **Không** đặt staging dưới
  `${CONFIG_DIR}`: Core chỉ mở locator dưới gốc `STATE_DIR` và sẽ reject bằng
  `PRG-ERR-ARTIFACT-001`. Ba gốc `CONFIG_DIR`/`STATE_DIR`/`RUNTIME_DIR` xem bảng
  ở `IFSPEC-PROG-001` §12.
- Bundle quarantine/scratch có per-job root, limit count/size/ratio và cleanup by
  committed job state; không follow links.
- Retention/GC chỉ xóa object không referenced bởi active/LKG/revision/audit/legal
  hold và qua two-phase tombstone. Không xóa để giải quyết disk full mù.
- Quota đề xuất lấy capability/decision: Project/Revision/artifact/check/trace;
  server enforce ở transaction và trả current/limit.

## 15. Runtime read model và consistency

`GET /runtime` gọi/cache Core snapshot ngắn có generation; DB metadata join bằng
IDs/hash nhưng không ghi đè actual. Core unreachable trả last known + `STALE` /
age/observedAt, không status `RUNNING` không nhãn. Event sequence gap invalidate
cache. Reconcile sửa projection bằng append audit correction, không rewrite event
history.

## 16. Security/error/audit matrix

| Boundary fault | Public | Audit/metric | Runtime |
|---|---|---|---|
| auth/RBAC/CSRF | 401/403 | security denial | no DB/IPC mutation |
| body/ETag/idempotency | 400/409/428 | request outcome | unchanged |
| compiler invalid/resource | Check FAILED | job/limit, sanitized | unchanged |
| stage/loader reject | op FAILED + detail | artifact/target code | active/LKG giữ |
| IPC timeout | 504/accepted op UNKNOWN | reconcile lag | query Core |
| DB/disk failure | 503 | health/incident | active Core tiếp tục |

Audit transaction cùng domain state nếu local; external Core result được append
sau read-back với before/after active. Secret/source không log; actor/correlation
propagate nhưng Core không authorize theo actor string.

## 17. Verification và acceptance

| Test ID | Fixture/fault | PASS |
|---|---|---|
| `BE-T-001` | concurrent Draft ETag/idempotency | one commit; stale retains both versions |
| `BE-T-002` | SQLite crash/fsync/restart/migration | integrity/FK valid; no half aggregate |
| `BE-T-003` | compiler timeout/OOM/crash/malicious source | Check failed; process reaped; Core unaffected |
| `BE-T-004` | two worker/lease expiry | exactly one state transition/side effect |
| `BE-T-005` | IPC drop before/after activate | UNKNOWN then authoritative reconcile, no replay |
| `BE-T-006` | restart every operation step | final matches Core/journal; audit complete |
| `BE-T-007` | RBAC/CSRF/rate/bundle/path | deny/reject with zero unsafe side effect |
| `BE-T-008` | OpenAPI/Go/TS/IPC examples | zero contract mismatch |
| `BE-T-009` | disk quota/low watermark | mutation blocked early; active runtime unaffected |

## 18. Handler-to-service-to-store contract

| HTTP action | Service method target | Transaction/side effect | Result authority |
|---|---|---|---|
| Save Draft | `DraftService.Save(ctx, actor, cmd)` | một DB tx: ETag/CAS + canonical doc + audit | committed Draft/ETag |
| Seal Revision | `RevisionService.Seal(...)` | tx immutable Revision/manifest; enqueue Check sau commit | store Revision |
| Start Check | `CheckService.Start(...)` | idempotent Check job; compiler child ngoài DB tx | Check + Artifact registry |
| Commission/Restore | `OperationService.Begin(...)` | tx intent/lease/audit; Core IPC chỉ sau commit | Core status + operation projection |
| Import | `BundleService.Import(...)` | quarantine/validate ngoài tx; commit Project/Draft/audit một lần | import report + Draft |
| Runtime | `RuntimeService.Snapshot(...)` | Core read + bounded cache; no domain write | Core generation/freshness |

Handler chỉ parse/limit/auth/correlation và map error; service giữ invariant;
store không gọi network/compiler/Core. Worker claim job bằng lease + compare-and-
set, heartbeat có expiry; lease mất dừng trước side effect mới và reconcile trước
reclaim. Shutdown ngừng nhận job, chờ bounded, ghi trạng thái recoverable.

## 19. Background worker và health contract

| Worker | Queue/key | Concurrency | Health metric/fail behavior |
|---|---|---:|---|
| compiler | Check/build key | bounded theo CPU, một job/controller | queued/running/timeout/OOM; không ảnh hưởng Core |
| operation | controller/operation ID | đúng một lease/controller | oldest age/reconcile lag; mutation block nếu unhealthy |
| artifact GC | content hash/tombstone | 1 low-priority | bytes/quota/error; không xóa referenced |
| audit/export | audit sequence | bounded read/export | chain gap/export denial; mutation audit fail closed |

Readiness Programming tách khỏi process liveness: Web vẫn phục vụ phần khác khi
compiler/Core unavailable, nhưng capability mutation phải OFF và endpoint health
nêu đúng dependency nào lỗi.

## 20. Deploy, rollback, blocker và ký

Deploy: migration compatible/backup → module feature OFF → read-only/capabilities
→ Check-only → Core lifecycle compatible → Commission canary. Readiness probe
không fail cả Web chỉ vì compiler disabled, nhưng feature health phải nói rõ.

Rollback binary giữ DB/files/audit; không down-migrate destructive. Nếu Core/IPC
major khác, mutation disable. Restore LKG compatible trước mọi Core downgrade.

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| Data/REST/IPC/role decisions chưa Approved | Product + Architect + Security | sign-off R2/OpenAPI |
| package/source chưa implement | Backend Lead | Plan 53 code + tests |
| Core lifecycle/TLS chưa available | Core + Platform | target integration/security PASS |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Module/store/compiler/operation/error/test baseline |
| 0.2 | 2026-08-09 | Bổ sung As-Built wiring, function/transaction/worker/file/security/deploy/test M3 |
| 0.3 | 2026-08-09 | Bổ sung handler/service/store boundary, transaction/side-effect authority, worker lease/concurrency/health; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; ghi yêu cầu `go test -count=1` |
| 0.5 | 2026-08-09 | Amendment A1: thêm §0.1 nêu hai ảnh hưởng thực tế lên BE — nhịp gọi `GET /overrides` từ ba màn hình và yêu cầu impact phân biệt “không có ảnh hưởng” với “chưa tính được”; không đổi endpoint |
| 0.6 | 2026-08-10 | Đóng finding consumer review `F-CR-02` và `F-CR-05`: §14 ghi rõ staging bàn giao Core nằm dưới `${STATE_DIR}/programming/staging/` (không phải `${CONFIG_DIR}`); §1 đổi gói biên `http/` thành `transport/` cho khớp `transport.Handler` ở §12 và đường dẫn ở `IFSPEC-PROG-001` §16 |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| BE + Core + Security + Ops + QA | Chờ review | — |
| Backend Lead + System Architect | **BLOCKED — chưa phê duyệt** | R2 decision/contract và target evidence |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §20 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §1 ranh giới module, gồm quy tắc phân lớp handler/store/runtime |
| `DD-03` As-Built | PASS | §11 dẫn `apps/web-api`, `internal/app` (đã wiring auth/health/historian/hmi/modbusrtu/network/points/system) và `modernc.org/sqlite`; ghi rõ **chưa có** schema/route/worker Programming |
| `DD-04` Target ownership | PASS | §1 bảy package con; §18 hợp đồng handler → service → store |
| `DD-05` Data từng field | PASS | §2 persistence; §14 vòng đời dữ liệu/tệp và hạn ngạch; schema chi tiết ở `DM-PROG-001` |
| `DD-06` Interface | PASS | §8 ánh xạ lỗi; §18 hợp đồng ba lớp; §6 read model runtime |
| `DD-07` State/transaction/worker | PASS | §13 giao dịch, khóa và thuật toán worker; §19 worker nền và hợp đồng health |
| `DD-08` Operation flow | PASS | §4 điều phối Commission; §5 Restore và replacement |
| `DD-09` Error/safety/security | PASS | §7 RBAC/audit/security; §16 ma trận security/error/audit; RBAC ở cả handler lẫn service |
| `DD-10` Repository mapping | PASS | §11 và §12 — package và function cụ thể trong `apps/web-api/internal/programming/` |
| `DD-11` Verification | PASS | §10 test bắt buộc; §17 acceptance; gắn `VS-PROG-001/019/022/024` |
| `DD-12` Compatibility/deploy/rollback | PASS | §9 migration và rollback, gồm thứ tự triển khai |
| `DD-13` Trace/risk/decision/sign-off | **BLOCKED** | Owner: BE Lead, Core, Security, QA. Ảnh hưởng: hạn mức/retention (`OD-PROG-003/010`) và ma trận quyền (`OD-PROG-001`) chưa chốt nên **không được tạo migration production**; giao thức BE↔Core chưa tồn tại nên phần điều phối chưa chạy thật. Gate: `DOC-G2`. Điều kiện mở: đóng ba decision trên, khóa hợp đồng BE↔Core, rồi chạy `go vet ./...` và `go test ./... -count=1` cộng contract test |

Một `BLOCKED`, đủ bốn trường. Bằng chứng code/API/runtime vẫn
`NOT IMPLEMENTED/NOT TESTED`.
