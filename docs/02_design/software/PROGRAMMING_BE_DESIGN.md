# Thiết kế Backend Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-BE-PROG-001` |
| Phiên bản | 1.8 |
| Trạng thái | **M3 — corrective POU/library/signal/package source đang tích hợp; chưa merge/target evidence mới** |
| Ngày | 2026-09-06 |
| Chủ quản | Backend Lead |
| Người review | Core Lead, Security Lead, Verification Lead, Operations Lead |
| Người phê duyệt | Backend Lead + System Architect |
| Nguồn | `DM-PROG-001`, `IFSPEC-PROG-001`, `DDD-LIFE-PROG-001`, `DDD-SEC-PROG-001` |
| Requirement | `SWR-REQ-PROG-BE-101..115` |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **backend Go tổ chức ra sao**: chia package, lưu trữ, chạy compiler job, điều phối Commission, phân quyền, audit và migration. Đây là nơi biến hợp đồng API thành code chạy được. |
| 2. Ai phải đọc file này? | BE Lead và lập trình viên Go (chủ quản); Core đọc §4 (điều phối Commission) và §6 (read model); Security đọc §7; Ops đọc §9; QA đọc §10 và §17. |
| 3. Hệ thống hiện tại đang có gì? | Baseline store/library/lifecycle/Monitor/Trace đã có. Current worktree bổ sung canonical POU/library/signal manifests, package Check fail-closed, runtime signal refs, Library deprecate receipt và IOP max-gap read model; focused Go gates đang tích hợp, chưa merge/target evidence mới. |
| 4. Thiết kế mới thay đổi điều gì? | Immutable Revision là nguồn POU table/library lock/signal defs+refs/topology/budget. BE sinh manifest/argv, không tin metadata FE; Core authoritative read-back quyết định lifecycle/signal validity. Library deprecate là mutation ETag/idempotency/audit cùng transaction. |
| 5. Team phải sửa module/contract nào? | `application/checks_{manifest,signal_refs}.go`, `compiler/{runner,packager}.go`, store migration `0012`, library service/handler, app Core client/SHM reader và OpenAPI/generated FE consumer. |
| 6. Điều gì còn bị chặn? | Corrective source chưa merge/full gate; target MCU FAKE deploy/24 h soak, positive read-back và formal Test Result vẫn mở. Physical MCU/HIL được defer do chưa có phần cứng, không coi PASS. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Host test khóa monitor mapping, local/external identity, lowercase quality, trace idempotency/quota/retention/stop/source-failure. `EV-PROG-P5-510` ghi full Go gate và target deploy/API/rollback; Monitor empty đúng fixture không binding, positive Trace target còn mở. |

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
`internal/app`. Không tạo daemon mới. Module hiện hành/đề xuất:

```text
programming/
├── domain/       project, revision, check, operation, audit types/invariants
├── store/        SQLite transaction, migrations, artifact/bundle storage
├── application/  Project/Draft/Revision + Check/change/bundle; operation kế tiếp
├── compiler/     subprocess adapter, limits, diagnostic/manifest normalization
├── artifact/     content-addressed publish và read-back verifier
├── runtime/      versioned Core IPC client + reconciliation
├── transport/    handlers/OpenAPI mapping, RBAC middleware
└── tests/        unit, integration, contract, fault injection
```

Tên gói tầng biên là `transport`, không phải `http`: §12 khai báo
`transport.Handler` và `IFSPEC-PROG-001` §16 ghi đường dẫn
`apps/web-api/internal/programming/{transport,application,store}`. Một tên duy nhất
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
- Artifact file write temp→fsync→hard-link publish→directory fsync; DB commit chỉ
  sau checksum/locator read-back hợp lệ.
- Operation/audit persist trước external side effect để recovery biết ý định.

## 3. Check/Compiler pipeline As-Built

```text
Revision snapshot
→ schema/capacity/reference validation
→ ST parse/semantic hoặc FBD normalize/type/topology
→ common typed IR
→ mapping/Task/library/target/RETAIN/cutover/resource validation
→ immutable artifact + source map + manifest + SHA-256
→ BE verifies build output metadata
→ atomic terminal Check PASSED + Artifact row hoặc FAILED/TIMED_OUT không Artifact
```

Compiler chạy subprocess không đặc quyền với:

- read-only Revision input, private temporary directory;
- CPU/memory/file-size/process/time limit;
- no network, no device, no config/data write ngoài output fd;
- hard timeout cấu hình `1..60 s`, mặc định 10 s, kill whole process group;
- stdout/stderr bounded và sanitize;
- deterministic version/profile recorded.

Compiler failure không crash Web và không tạo Artifact Ready. `ProcessRunner`
chỉ gọi binary cấu hình sẵn bằng argv cố định, tạo scratch `0700`, giới hạn số
file/kích thước/stdout/stderr/CPU/memory/process, giết toàn process group khi hết
deadline và verify compiler/profile/ABI/build key/source ID/manifest/hash trước
khi trả bytes. CLI mở input/output trước rồi áp `NO_NEW_PRIVS`, rlimit và seccomp;
network/socket, mở path mới, fork/clone/exec, mount và ptrace đều bị chặn.

### 3.1 Corrective Check/package contract cho POU, Library và Published Signal

Input của `CheckService` được dựng lại từ immutable Revision và phải chứa:

| Manifest | Producer BE | Consumer | Fail-closed invariant |
|---|---|---|---|
| POU manifest/table | canonical `revision_objects` kind + interface/signature | `mkddc-st-compile`/`mkddc-st-package` | kind/name/signature/arity unique; call graph acyclic; FUNCTION pure |
| Library lock | SYSTEM registry version+SHA, PROJECT library Revision+entries | compiler/package/loader | dependency DAG, version/hash/status exact; deprecated entry đang được Revision pin vẫn đọc được nhưng không cho dùng mới |
| Signal manifest | signal defs + publisher + type/unit/freshness/stale policy | compiler | single publisher; fallback chỉ với `USE_FALLBACK`; name/type/unit exact |
| Signal refs | consumer Program + read/publish opcode refs từ output compiler | Check/package | mọi read có publisher; publisher khớp owner; không shared writable state |
| Topology/budget | Program identity/period/enabled intent/resource totals | package/Core | tối đa 32 total/16 Enabled; 1/5/30 s; owner output duy nhất; one-over reject |

`ProcessRunner` gọi compiler bằng argv cố định với `--pou-manifest`,
`--library-lock`, `--signal-manifest`; `Packager` gọi package CLI với `--pou-table`
và `--library-lock`. Tất cả file tạm mode `0600`, hash vào build key và xóa khi
success/fail/cancel. Output compiler/package được parse/verify lại; metadata FE
không được chép thẳng vào artifact. Lỗi bất kỳ manifest/ref tạo Check `FAILED`,
không Artifact và không stage/Commission.

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

As-Built Task 509: `ProgrammingMonitorService` đọc Core point snapshot trước,
join Variable/Binding của Revision active và chỉ overlay Point catalog lên point
không LOCAL. LOCAL luôn giữ end-scan actual/winner/priority từ Core; point ngoài
LOCAL giữ timestamp/quality của producer. Quality được trim/uppercase rồi map
vào enum; unknown không thành GOOD.

`TraceService` lấy mẫu cùng MonitorService, không ghi output: 1..32 variable,
1 giây..10 phút, sample 100 ms..30 giây, tối đa 4 session đồng thời, 10.000 ô
giá trị/session và 32 session terminal. Create giữ idempotency key+request hash;
start/finish có audit; stop đồng bộ. Session nằm trong RAM, mất khi Web restart;
source unavailable kết thúc `FAILED/SOURCE_UNAVAILABLE`. HTTP trace này không
được quảng cáo là Core ring trace. WS/SSE chưa phải transport của P5; FE poll
REST và refetch snapshot.

## 7. RBAC, audit và security

| Capability | viewer | operator | engineer | admin |
|---|:---:|:---:|:---:|:---:|
| `read`: source/runtime/monitor/history | ✓ | ✓ | ✓ | ✓ |
| `program.edit`: Draft/Binding/Signal/Library/Check/Trace/export | — | — | ✓ | ✓ |
| `program.activate`: Commission/Restore/import/RETAIN reset/intent/recovery | — | — | ✓ | ✓ |
| `simulation.run`: tạo/điều khiển/dừng phiên mô phỏng | — | — | — | ✓ |

Mỗi operation `/programming/*` phải khai đồng thời `x-rbac` và `x-permission`
trong OpenAPI. Generator xuất `programming_rbac_manifest.json`; security matrix
Go so sánh đủ method/path/operation/permission/roles với `routeDefinitions` và
`auth.RolesWithPermission`. Drift ở bất kỳ lớp nào làm test hỏng.

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

`apps/web-api` là Go process duy nhất theo ADR-005/007. Bounded module vẫn là
`internal/programming/{application,artifact,compiler,domain,coreipc,store,transport}`.
Current worktree có OpenAPI `1.28.0`/33 operation, store migration tới `0012`,
Library deprecate, Check POU/library/signal manifest và Core/SHM read model; các
giá trị này chưa là baseline merge/target evidence. Target tiếp tục module này,
không tạo service thứ tư hoặc đường mutation ngoài application service.

| Integration | Target change | Không được làm |
|---|---|---|
| `internal/app` | **As-Built:** construct/close store + Project/Check/change/bundle/operation handler và hai worker bounded | import vòng ngược domain→app |
| router/auth | mount `/api/v1/programming`, middleware auth/CSRF/correlation/rate | tin role từ payload/FE |
| config | Programming DB/state/staging/quota/feature flags | hard-code `/data` trong domain |
| health | compiler queue/Core capability/reconcile/disk watermark | báo healthy chỉ vì HTTP sống |
| metrics/log | bounded state/error/latency counters | source/token/path secret |

## 12. Package/API mức function

| Package/type | Method chính | Transaction/side effect |
|---|---|---|
| `application.ProjectService` As-Built | `CreateProject`, `ListProjects`, `GetProject`, `SaveDraft`, `SealRevision`, `GetRevision`, `GetRevisionChanges`, `ExportBundle`, `ImportBundle` | store transaction/read + audit; no Core; import chỉ Project/Draft |
| `application.CheckService` As-Built | `RequestCheck`, `GetCheck`, `ProcessNext` | idempotency + lease queue; compiler/artifact ngoài DB tx; terminal commit atomic |
| `application.OperationService` As-Built | `Commission`, `Restore`, `GetOperation`, `ProcessNext`, `Recover` | durable op before IPC; controller single-flight; timeout UNKNOWN; status-only reconcile |
| `application.LibraryService` corrective | `SearchLibraries`, `UpsertEntry`, `DeleteEntry`, `DeprecateRevision` | ETag/idempotency/receipt/audit cùng transaction; SYSTEM immutable; deprecated giữ cho Active/LKG pin cũ |
| `store.Store` As-Built | Project/Draft/Revision/Check/bundle + `BeginOperation`, `ClaimOperation`, transition CAS, `RecordCoreResult`, terminal CommissionRecord/audit | một writer; immutable/receipt/lease/generation; không gọi Core trong transaction |
| `compiler.ProcessRunner` corrective | `Compile(ctx, BuildInput)` + POU/library/signal manifest | child process bounded/sandboxed; verify output/provenance; không ghi DB |
| `compiler.Packager` corrective | package POU table/library lock/topology/signal/resource | gọi production package writer; parse/read-back package trước publish |
| `artifact.Store` As-Built | `Put`, `Verify`, `Stage`, exact `CleanupStaged` | content-address publish/read-back; hard-link verified bytes; `openat/O_NOFOLLOW/unlinkat`; không ghi DB |
| `runtime.Client` As-Built | `Status`, `Stage`, `Restore`, `Activate`, `OperationStatus` | UDS deadline/version/hash/peer; mutation chỉ theo state machine |
| `transport.Handler` | decode/auth/map HTTP | no business mutation ngoài service |

Dependency injection dùng interface nhỏ; domain không import HTTP/SQLite/IPC. ID,
clock, idempotency và filesystem root injectable để test deterministic.

### 12.1 Contract As-Built của `TASK-PROG-204`

| HTTP operation | Handler/application | Invariant và kết quả |
|---|---|---|
| `GET /projects` | `ListProjects` | limit `1..100`, cursor HMAC hết hạn sau 15 phút, thứ tự `updatedAt desc/projectId asc` |
| `POST /projects` | `CreateProject` | tạo Project + Draft canonical + Task mặc định trong một giao dịch; replay idempotent giữ identity/audit/ETag |
| `GET /projects/{projectId}` | `GetProject` | UUID canonical, chỉ Project chưa archive, checksum Draft được đọc lại; `ProjectView` trả `draftRevisionId` và `baseRevisionId` riêng (`DraftID` trước seal, immutable Revision nền sau seal) |
| `PATCH /projects/{projectId}/draft` | `SaveDraft` | `If-Match` mạnh `\"draftId:generation\"`; batch `1..512` all-or-nothing; tăng ETag đúng một lần |
| `POST /projects/{projectId}/draft/revisions` | `SealRevision` | snapshot object + manifest SHA-256 bất biến; tiến base Draft/ETag cùng transaction; không đổi Active/LKG |
| `GET /revisions/{revisionId}` | `GetRevision` | đọc manifest/object theo thứ tự ổn định và kiểm checksum trước khi trả |

Mutation receipt khóa `(actor, action, target, keyHash)` trong 24 giờ. Cùng key
và cùng request trả response identity cũ kể cả sau restart; cùng key nhưng request
hash khác trả conflict. JSON trùng key, trailing token, field lạ, UUID/reference/
capacity sai bị reject trước transaction hoặc rollback toàn bộ.

### 12.2 Contract As-Built của `TASK-PROG-205`

| HTTP/worker | Application/store/compiler | Invariant và kết quả |
|---|---|---|
| `POST /revisions/{revisionId}/checks` | `RequestCheck` → `EnqueueCheck` | `program.edit` + idempotency key; receipt/Check `QUEUED`/audit atomic; trả `202`, `Location`, cùng request trả cùng `checkId`; không IPC/Core |
| `GET /checks/{checkId}` | `GetCheck` | viewer; kiểm checksum result/artifact metadata; chỉ `PASSED` có Artifact; không lộ locator/bytes |
| Check worker | `ProcessNext` → `ClaimCheck` → `ProcessRunner.Compile` → `artifact.Put/Verify` → `CompleteCheck` | lease owner/expiry CAS; tối đa hai attempt; một terminal transition; `FAILED/TIMED_OUT` không Artifact |
| startup/ticker | `FailExhaustedChecks` + bounded poll | expired attempt thứ hai đóng `FAILED`; shutdown cancel child/process group và để lease recoverable |

Build input lấy từ immutable Revision manifest/object sau khi verify checksum.
Build output chỉ được chấp nhận khi artifact, manifest, profile, ABI, compiler,
source IDs, build key và mọi SHA-256 khớp. Artifact bytes được publish/read-back
trước giao dịch terminal; nếu DB commit thất bại, file content-addressed chưa có
row chỉ là blob không reachable và không thể stage/activate.

### 12.3 Contract As-Built của `TASK-PROG-206`

| HTTP operation | Application/store | Invariant và kết quả |
|---|---|---|
| `GET /revisions/{from}/changes/{to}` | `GetRevisionChanges` | hai Revision cùng Project; change sort theo category/kind/object ID; `impactRef` SHA-256 deterministic; nhóm cần Core read-back là `UNAVAILABLE` |
| `POST /bundles/export` | `ExportBundle` → `RecordBundleExport` | ZIP `Store`, path sort, timestamp cố định; manifest/file SHA-256; audit chỉ hash/size/Revision ID; replay không ghi audit thứ hai |
| `POST /bundles/import` | `ImportBundle` → `ImportProject` | expected SHA-256 + exact file allowlist; một transaction tạo Project/Draft/audit/receipt; không Revision/Check/Artifact/Commission |

Importer giới hạn request 6 MiB, ZIP 4 MiB, 1024 file và 256 KiB/file; reject
compression, encrypted entry, directory/link, absolute/`..`/backslash/control,
duplicate path/key, target/profile/kind/file set/hash/size/Revision manifest lệch.
`mutation_receipts` v4 thêm `BUNDLE_EXPORT/BUNDLE_IMPORT`; cùng key khác semantic
request conflict, replay qua restart giữ Project/Draft/ETag/audit và safety fields.

### 12.4 Contract corrective của Control Library deprecate

`POST /projects/{projectId}/library/revisions/{libraryRevisionId}/deprecate`
yêu cầu `program.edit`, `If-Match`, `X-Idempotency-Key` và body strict
`{"schemaVersion":"1"}`. Application gọi `LibraryService.DeprecateRevision`;
store đổi duy nhất Revision `PUBLISHED→DEPRECATED`, ghi mutation receipt + audit
trong cùng transaction và trả ETag/read-back mới. Replay cùng actor/action/target/
key/request trả cùng result; key trùng payload khác trả conflict. SYSTEM library,
Draft/Revision sai Project, state khác PUBLISHED hoặc Revision đang được thao tác
không hợp lệ đều fail closed, không partial mutation. Deprecated Revision còn
được loader đọc cho Active/LKG đã pin; UI không cho chọn nó cho Revision mới.

Migration `0012_library_revision_deprecate_receipt.sql` chỉ mở enum receipt/action
cần thiết, có checksum trong manifest và backup trước apply. Rollback binary
không down-migrate/xóa audit; client cũ bỏ qua action mới nhưng không được phép
đổi state bằng route cũ.

## 13. Transaction, locking và worker algorithm

```text
PatchDraft:
  authz → canonical request hash → BEGIN IMMEDIATE
  → find/create idempotency row → compare ETag
  → load/apply/validate whole batch → write Draft generation + audit + result
  → COMMIT; any failure ROLLBACK

CheckWorker:
  atomically claim QUEUED hoặc expired RUNNING khi attempt_count < 2
  → load immutable Revision and verify hashes
  → compile in private sandbox with hard deadline/process-group kill
  → normalize bounded diagnostics and verify manifest/artifact
  → if PASSED: content-address publish + read-back
  → CAS terminal Check + Artifact row + audit in one DB transaction
  → if FAILED/TIMED_OUT: CAS terminal result + audit, no Artifact
  → crash: lease expires; reclaim once; exhausted lease becomes FAILED

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
  temp+fsync+hard-link publish+directory fsync; row chỉ commit sau hash/read-back.
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

Tại `3e5281d`, `BE-T-003/004`, phần Check/bundle của `BE-T-007/008` đã PASS bằng
host test/race/contract thực, gồm timeout/OOM/output/source bounds, hostile corpus
25 lớp zero-mutation và audit-secret. `BE-T-005/006`, quota target và toàn bộ Test Result
độc lập vẫn mở; không dùng bảng này để suy chúng đã PASS.

## 18. Handler-to-service-to-store contract

| HTTP action | Service method target | Transaction/side effect | Result authority |
|---|---|---|---|
| Save Draft | `DraftService.Save(ctx, actor, cmd)` | một DB tx: ETag/CAS + canonical doc + audit | committed Draft/ETag |
| Seal Revision | `RevisionService.Seal(...)` | tx immutable Revision/manifest; enqueue Check sau commit | store Revision |
| Start Check | `CheckService.RequestCheck(...)`; worker `ProcessNext(...)` | idempotent Check job; compiler child ngoài DB tx; terminal CAS | Check + Artifact registry |
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
| compiler | Check/build key | một worker tuần tự/Web process tại Task 205 | queued/running/timeout/crash; không ảnh hưởng Core |
| operation | controller/operation ID | đúng một lease/controller | oldest age/reconcile lag; mutation block nếu unhealthy |
| artifact GC | content hash/tombstone | 1 low-priority | bytes/quota/error; không xóa referenced |
| audit/export | audit sequence | bounded read/export | chain gap/export denial; mutation audit fail closed |

Readiness Programming tách khỏi process liveness: Web vẫn phục vụ phần khác khi
compiler/Core unavailable, nhưng capability mutation phải OFF và endpoint health
nêu đúng dependency nào lỗi.

### 19.1 Acceptance corrective Plan59

| Case | Expected |
|---|---|
| POU/library/signal manifest canonical chạy hai lần | argv/input/package byte và SHA-256 giống nhau |
| recursion, FUNCTION side effect, library DAG/hash/version, duplicate/missing signal publisher | Check `FAILED` đúng stable code; không Artifact/operation/Active mutation |
| compiler/package output bỏ hoặc sửa một manifest ref | BE verifier reject trước artifact publish |
| deprecate Library replay/restart/two-client | một state transition, một receipt/audit; ETag cũ 409; read-back `DEPRECATED` |
| Core/SHM signal `valid=false`, stale/offline/unknown hoặc layout mismatch | API trả unavailable/null + quality; không dựng numeric zero |
| Web/BE restart trong active Program | runtime intent/read-back giữ; không replay Commission/Enable/Deprecate |

Focused Go `canonical CBOR + signal null/unavailable` hiện có 17/17 PASS theo
current-worktree engineering gate; Library route/UI còn trong lượt tích hợp.
Các số này không thay full Go gate, target MCU FAKE deploy/soak hoặc formal VVP.

## 20. Deploy, rollback, blocker và ký

Deploy: migration compatible/backup → module feature OFF → read-only/capabilities
→ Check-only → Core lifecycle compatible → Commission canary. Readiness probe
không fail cả Web chỉ vì compiler disabled, nhưng feature health phải nói rõ.

Rollback binary giữ DB/files/audit; không down-migrate destructive. Nếu Core/IPC
major khác, mutation disable. Restore LKG compatible trước mọi Core downgrade.

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| Target fault/power/restart chưa thành Test Result | Backend Lead + Ops + Verification | chạy fault/power matrix P6 với executor/reviewer độc lập; happy path đã có `EV-PROG-P5-507` |
| TLS/HIL assurance chưa hoàn tất | Platform + Verification | integration/security/HIL PASS và Test Result được review |
| Corrective POU/library/signal/package source chưa commit/merge | Backend Lead + Dev Lead | full Go/contract/E2E gate, commit/PR/merge thật và candidate pin trước khi đổi trục `I` |
| Positive Monitor/Trace target có Variable Binding | Backend Lead + Core + QA | fixture read-only an toàn có binding; đối chiếu row truth và start/get/stop, lưu raw output |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.7 | 2026-08-24 | Đồng bộ BE-111..115: immutable POU/library/signal manifests, compiler/package argv+read-back, Library deprecate ETag/idempotency/audit/migration 0012, OpenAPI 1.28.0/33 operation và SHM signal fail-closed. Ghi focused 17/17 là engineering evidence current-worktree; merge/full gate/target/formal VVP còn mở. |
| 0.1 | 2026-08-09 | Module/store/compiler/operation/error/test baseline |
| 0.2 | 2026-08-09 | Bổ sung As-Built wiring, function/transaction/worker/file/security/deploy/test M3 |
| 0.3 | 2026-08-09 | Bổ sung handler/service/store boundary, transaction/side-effect authority, worker lease/concurrency/health; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; ghi yêu cầu `go test -count=1` |
| 0.5 | 2026-08-09 | Amendment A1: thêm §0.1 nêu hai ảnh hưởng thực tế lên BE — nhịp gọi `GET /overrides` từ ba màn hình và yêu cầu impact phân biệt “không có ảnh hưởng” với “chưa tính được”; không đổi endpoint |
| 0.6 | 2026-08-10 | Đóng finding consumer review `F-CR-02` và `F-CR-05`: §14 ghi rõ staging bàn giao Core nằm dưới `${STATE_DIR}/programming/staging/` (không phải `${CONFIG_DIR}`); §1 đổi gói biên `http/` thành `transport/` cho khớp `transport.Handler` ở §12 và đường dẫn ở `IFSPEC-PROG-001` §16 |
| 0.7 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-104` tại `312f357`: SQLite store/migration/backup/restore, ETag, immutable Revision, durable operation và audit hash-chain có host fault/concurrency/race test; giữ wiring/service/worker/target evidence là phần tiếp theo |
| 0.8 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-204` tại `66848a1`: nối SQLite v2 và `application.ProjectService` vào lifecycle; sáu route Project/Draft/Revision chạy thật với ETag/CAS, receipt idempotency 24 giờ, cursor HMAC, immutable Revision, RBAC và restart/migration test; giữ 19 route, Check/operation worker và target evidence là phần tiếp theo |
| 0.9 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-205` tại `e8c289e`: nối SQLite v3, `application.CheckService`, worker lease/retry, compiler subprocess sandbox và Artifact content-address/read-back vào lifecycle; hai route Check chạy thật, catalog 20/80; giữ 17 route bundle/operation/runtime, flag OFF và target evidence là phần tiếp theo |
| 1.0 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-206` tại `95b9388`: nối SQLite v4, change manifest/impactRef deterministic, ZIP source-only/hash/allowlist và import Project/Draft atomic; ba route change/export/import chạy thật, G1 7/7; giữ 14 route operation/runtime/audit, flag OFF và target evidence là phần tiếp theo |
| 1.1 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-207` tại `3e5281d`: raw/entry/count/path/ZIP metadata bounded, hostile corpus 25 lớp với snapshot 8 bảng zero-mutation, 23 alias audit-secret và compiler timeout/OOM/output/source bounds + fuzz; giữ 14 route operation/runtime/audit, flag OFF và target/Test Result còn mở |
| 1.2 | 2026-08-13 | Đồng bộ `TASK-PROG-403` tại `c2f3189`: SQLite v5 operation/lease/generation, `OperationService` Commission/Restore/Get/worker/recovery, exact impact ack, verified hard-link staging + safe cleanup, timeout UNKNOWN/status-only reconcile và terminal CommissionRecord+audit atomic. Giữ flag OFF, TLS/target/HIL/Test Result còn mở. |
| 1.3 | 2026-08-13 | `TASK-PROG-507` tại `d9a8e3b`: bổ sung `ProjectView.BaseRevisionID` và JSON `ProgrammingProject.baseRevisionId`; `projectView()` trả Draft ID trước seal, Revision nền sau seal. HTTP integration test khóa read-back sau seal, sửa conflict giả của Check/save lần hai. Foxlinx xác nhận `201/202`; compiler/Core Programming target vẫn thiếu và flag cuối OFF. |
| 1.4 | 2026-08-13 | Hoàn tất target `TASK-PROG-507` tại `0f1526c`: Web normalize nil IO/safe-state slice thành `[]`, Core tương thích `null` legacy chỉ về default an toàn và vẫn reject type sai; deploy compiler/Core/Web ARM64, cờ `ON`, UDS `0660`; hai Check `PASSED`, Commission output-free `SUCCEEDED/COMMITTED`, Active/LKG/Task đọc-ngược đúng. Supporting target evidence không thay Test Result/HIL. |
| 1.5 | 2026-08-13 | `TASK-PROG-509`: nối Monitor/Trace source thật. `ProgrammingMonitorService` join Revision binding với Core/Point truth và bảo vệ namespace LOCAL; `TraceService` bounded/idempotent/audited/in-memory; runtime trả controller/task metric; HTTP routes/OpenAPI v1.20.0/FE client đồng bộ. Host Go tests PASS; target bản mới NOT_RUN do SSH. |
| 1.6 | 2026-08-13 | `EV-PROG-P5-510`: full Go gate PASS; ARM64 Web deploy/hash/health/rollback rehearsal PASS; target Runtime/Task và Monitor `200` read-back đúng, Trace invalid selector `400`. Fixture active không binding nên chưa có positive row/Trace target; source chưa merge và không nâng Test Result. |
| 1.8 | 2026-09-06 | `ISS-PGM-RBAC-01`: công bố `x-permission` cho đủ 44 Programming operation, sinh manifest và khóa drift OpenAPI/FE/Go; chuẩn hóa ma trận engineer cho `program.edit`/`program.activate`, giữ Simulation admin-only. |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| BE + Core + Security + Ops + QA | **WAIVED FOR IMPLEMENTATION** | Review/evidence hậu kiểm theo task; không thay Test Result |
| Backend Lead + System Architect | **APPROVED FOR IMPLEMENTATION** | `AUTH-PROG-2026-08-11-03`; release vẫn chờ target evidence |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §20 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §1 ranh giới module, gồm quy tắc phân lớp handler/store/runtime |
| `DD-03` As-Built | PASS | §0/§3.1/§11–12.4 tách baseline target cũ khỏi corrective current-worktree OpenAPI 1.28/store 0012/POU-library-signal chưa merge |
| `DD-04` Target ownership | PASS | §1 bảy package con; §18 hợp đồng handler → service → store |
| `DD-05` Data từng field | PASS | §2 persistence; §14 vòng đời dữ liệu/tệp và hạn ngạch; schema chi tiết ở `DM-PROG-001` |
| `DD-06` Interface | PASS | §8 ánh xạ lỗi; §18 hợp đồng ba lớp; §6 read model runtime |
| `DD-07` State/transaction/worker | PASS | §13 giao dịch, khóa và thuật toán worker; §19 worker nền và hợp đồng health |
| `DD-08` Operation flow | PASS | §4 điều phối Commission; §5 Restore và replacement |
| `DD-09` Error/safety/security | PASS | §7 RBAC/audit/security; §16 ma trận security/error/audit; RBAC ở cả handler lẫn service |
| `DD-10` Repository mapping | PASS | §11, §12 và §12.1–12.4 chỉ rõ application/store/compiler/packager/transport/migration corrective |
| `DD-11` Verification | PASS | §10 test bắt buộc; §17 acceptance; gắn `VS-PROG-001/019/022/024` |
| `DD-12` Compatibility/deploy/rollback | PASS | §9 migration và rollback, gồm thứ tự triển khai |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation; closure/release còn mở | Trace 82/82; corrective source chưa merge; MCU FAKE target/soak, physical HIL, formal VVP 0/44 PASS và residual risk vẫn mở. |

Evidence `EV-PROG-P5-510` chỉ thuộc baseline target cũ. Corrective POU/library/
signal/package/OpenAPI 1.28 phải có deploy/read-back record mới trên đúng commit
MCU FAKE; 24 h soak và formal Test Result vẫn `NOT_RUN`, physical HIL là
`DEFERRED_NO_HARDWARE`.
