# Thiết kế vòng đời runtime Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDD-LIFE-PROG-001` |
| Phiên bản | 0.3 |
| Trạng thái | **M3 — Review Ready** — DD-01..13 đủ; RETAIN/LKG chờ OD-PROG-009/010 |
| Ngày | 2026-08-09 |
| Chủ quản | Core Lead + Backend Lead + Operations Lead |
| Người review | System Architect, Controls Lead, Verification Lead |
| Người phê duyệt | System Architect + Product Owner |
| Nguồn | `SRS-PROG-001`, `ARCH-PROG-001`, `DM-PROG-001`, `IFSPEC-PROG-001` |
| Phạm vi | Check, Commission, Restore, cutover, LKG, RETAIN, restart và power-loss |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Định nghĩa **vòng đời của một thay đổi**: Check → Commission → Active, cộng Restore, RETAIN, LKG và phục hồi sau khi mất điện hoặc crash. Trả lời câu hỏi khó nhất: *mất điện đúng lúc đang tráo chương trình thì máy khởi động lên chạy cái gì?* |
| 2. Ai phải đọc file này? | Core, BE và Ops (chủ quản chung); Architect và QA review. Ops đọc §10 và §14 vì runbook dựa trực tiếp vào đây. |
| 3. Hệ thống hiện tại đang có gì? | Các component ST (compiler, loader, scheduler, retain, trace) đã có unit/integration test. Nhưng: bootstrap **chưa tạo scheduler**, ScanLoop vẫn để `StScheduler*` là tùy chọn và graph vẫn chạy. `st_program_control_v1.schema.json` có handler đứng riêng, **chưa** nối BE↔Core. Triển khai hiện chủ yếu thủ công qua SSH, chưa có staged operation. |
| 4. Thiết kế mới thay đổi điều gì? | Biến Commission thành **giao dịch có nhật ký, sống sót qua restart**: một `operationId` bền vững, tráo chương trình tại biên an toàn, và chỉ nâng LKG **sau khi** chu kỳ đầu chạy xong không lỗi. Thất bại ở bất kỳ bước nào đều giữ nguyên Revision đang chạy. |
| 5. Team phải sửa module/contract nào? | §12. Core: nhật ký + máy trạng thái tráo an toàn; BE: coordinator có operation bền vững và đối chiếu lại trạng thái; Ops: dùng procedure §14 thay cho thao tác SSH thủ công. |
| 6. Điều gì còn bị chặn? | `OD-PROG-009` (chính sách RETAIN warm/cold/đổi Revision) và `OD-PROG-010` (giữ bao nhiêu Revision, xử lý mất điện giữa giao dịch). Chưa ký thì không chốt được ma trận phục hồi. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §13: `VS-PROG-011` (chèn lỗi/crash/cắt điện tại **mọi** trạng thái vòng đời — phải luôn đúng một active, không kích hoạt đôi, LKG vẫn nạp được), `VS-PROG-029` (RETAIN), `VS-PROG-030` (restart toàn hệ trên HIL). `NOT RUN`. |

Nguyên tắc chống “báo thành công giả” (`RSK-PROG-007`): `HTTP 202` chỉ nghĩa là
lệnh đã nhận. Chỉ khi Core trả về đúng `activeRevision` và `operationId` khớp thì
mới được nói là thành công. Mất phản hồi thì trạng thái là `UNKNOWN` và phải đối
chiếu lại — **không** tự động gửi lại lệnh.

## 1. Mục tiêu và authority

Hồ sơ này biến hành động người dùng thành state machine bền vững giữa FE, BE và
Core. Không màn hình, HTTP `202`, DB row hay IPC ack nào được xem là Commission
thành công nếu Core read-back chưa xác nhận active revision/hash/profile và
first-cycle.

Authority theo lớp:

1. Revision/Check/Artifact/Audit metadata: Programming DB.
2. Active/LKG/Task/cutover/RETAIN actual: Core runtime + journal bền vững.
3. Physical output actual: PriorityResolver/IOP feedback, không phải FE/DB.
4. FE là projection; khi khác authority phải hiện `UNKNOWN/STALE`, không tự đoán.

## 2. As-Built và gap

| Thành phần | As-Built 2026-08-09 | Gap Target |
|---|---|---|
| ST components | compiler/loader/scheduler/retain/trace có unit/integration test | bootstrap chưa tạo scheduler, chưa route production |
| ScanLoop | optional `StScheduler*`; graph vẫn execute | exclusive producer + lifecycle safe swap |
| Config API | `st_program_control_v1.schema.json` và handler standalone | BE↔Core protocol/durable operation chưa wired |
| BE/FE | không có Programming package/route user reachable | project/check/commission/restore UI/API/storage |
| Deploy | reload chủ yếu manual/SSH theo source report | package-managed staged operation/read-back/rollback |

Do đó mọi state Target dưới đây là thiết kế review-ready, chưa phải runtime fact.

## 3. Aggregate và invariant

```text
Project 1 ─ 1 Draft ─ seals → Revision (immutable)
Revision 1 ─ * Check ─ pass → Artifact (immutable, target-specific)
Artifact ─ operation → StagedCandidate ─ safe swap → Active
Controller: exactly one LocalLogicOwner {GRAPH, PROGRAM, NONE_TRANSITION}
Controller: at most one mutable runtime Operation
LKG: last artifact that passed activation + first-cycle + checkpoint
```

- Draft mutation không ảnh hưởng runtime.
- Revision/Artifact đã tạo không sửa; correction tạo ID/hash mới.
- Check không stage; Stage không activate; HTTP timeout không đổi thành failed.
- Active và LKG có thể khác tạm trong first-cycle, nhưng journal phase rõ.
- LKG chỉ cập nhật sau checkpoint; candidate fail không ghi đè LKG.
- Một operation ID/request hash là exactly-once logical command xuyên restart.

## 4. State machine Check

| State | Durable | Entry/action | Transition |
|---|---|---|---|
| `QUEUED` | DB | reserve quota, snapshot build key | worker lease → `RUNNING` |
| `RUNNING` | DB + lease | compiler sandbox | diagnostics error → `FAILED`; pass → `PASSED` |
| `PASSED` | DB | artifact/hash/manifest committed atomically | terminal |
| `FAILED` | DB | diagnostics/failure class | terminal; no Artifact |
| `CANCELLED` | DB | only before final commit | terminal |
| `EXPIRED` | DB | deadline/lease exhausted | terminal |

Worker crash: lease timeout rồi retry tối đa một lần với cùng build key; nếu
artifact cache hash đúng có thể reuse. DB transaction ghi Artifact + Check PASSED
cùng lúc. Orphan file không có committed row bị quarantine/GC.

## 5. State machine Commission/Restore

| State | Owner | Guard/Action | Failure behavior |
|---|---|---|---|
| `QUEUED` | BE DB | authorized, idempotency persisted | no IPC = safe |
| `PREFLIGHT` | BE | revision/check/artifact/target/active/ack/backup/quota | reject giữ active |
| `STAGING` | BE/Core worker | copy locator, hash, bounded loader | reject giữ active/LKG |
| `VERIFYING` | Core | artifact/binding/RETAIN/cutover/resource | reject + detail |
| `WAIT_SAFE_BOUNDARY` | Core | journal intent, single-flight | restart reconcile |
| `ACTIVATING` | Core RT boundary | atomic owner/candidate pointer transition | journal decides old/new |
| `FIRST_CYCLE_VERIFY` | Core | execute no-partial-publish, read-back | fail → `ROLLING_BACK` |
| `ROLLING_BACK` | Core | restore previous handle/owner/retain plan | if fail → safety incident |
| `UNKNOWN_RECONCILING` | BE | IPC timeout/restart | query journal/status; never blind replay |
| `SUCCEEDED/FAILED/CANCELLED` | DB projection | terminal audit/read-back | immutable result |

Cancel chỉ hợp lệ `QUEUED/PREFLIGHT` trước staging token. Commission và Restore dùng
cùng loader/safe swap; Restore không bypass integrity/compatibility. Restore target
có thể là selected Revision hoặc LKG, nhưng expected active bắt buộc.

## 6. Preflight contract

Preflight tạo immutable `TransitionPlan` chứa:

| Field | Validation |
|---|---|
| operation/revision/artifact/check IDs | tồn tại, link/hash nhất quán, Check PASSED |
| controller/ABI/profile/library | exact capability match |
| expected active/owner | khớp Core read-back, không lấy riêng DB |
| binding inventory | identity/type/direction/writable/quality policy |
| output impact | Point affected, current winner/value, requested priority 5 |
| override inventory | source/actor/TTL; acknowledgement nếu policy yêu cầu |
| RETAIN plan | compatible restore/cold-init/reset, layout generation |
| graph cutover | backup ID/hash, producer conflict, rollback plan |
| timing/resource | WCET/memory/Task period/candidate capacity |
| acknowledgement | output/retain/override/cutover token one-time và actor-bound |

Mọi field ký bằng canonical plan hash. Core reject nếu plan hash/expected active
thay đổi. Preflight hết hạn sau 10 phút hoặc khi runtime generation đổi.

## 7. Safe-boundary transaction và power-loss

Core journal là append/checksummed, fsync ở non-RT trước khi enqueue boundary:

```text
PREPARED(op, oldActive, candidate, planHash)
→ boundary: COMMIT_INTENT
→ atomic pointer/producer-generation swap
→ ACTIVE_CANDIDATE
→ first-cycle without partial publish
→ FIRST_CYCLE_OK
→ checkpoint active metadata + LKG
→ COMMITTED
```

Boot recovery:

| Last valid record | Chọn runtime | Hành động |
|---|---|---|
| trước `COMMIT_INTENT` | old active | discard candidate |
| `COMMIT_INTENT` nhưng chưa `ACTIVE_CANDIDATE` | old active | mark operation failed/reconcile |
| `ACTIVE_CANDIDATE` chưa `FIRST_CYCLE_OK` | old LKG | candidate không được publish lại tự động |
| `FIRST_CYCLE_OK` chưa `COMMITTED` | verify active hash/checkpoint rồi finish hoặc LKG | không double execute transition |
| `COMMITTED` | committed active | read-back and project DB |

Journal corrupt/ambiguous: không chọn candidate mới; boot LKG đã checksum nếu có,
raise incident. SafetyManager độc lập vẫn chạy. DB BE sau restart query Core và
chuyển operation về đúng terminal/unknown state.

## 8. RETAIN lifecycle

RETAIN record key gồm controller, program instance stable ID, layout hash/version,
artifact lineage và CRC. Storage target dưới `${STATE_DIR}/programming/retain/`,
temp+fsync+rename+dir fsync, permission service-only. Không dùng program name đơn
lẻ làm identity.

| Tình huống | Hành vi |
|---|---|
| same compatible layout | restore typed values trước STARTING |
| thêm field có default và migration approved | migrate non-RT, record generation mới |
| incompatible/corrupt/missing | block hoặc cold-init theo TransitionPlan + acknowledgement |
| activation fail | candidate RETAIN không ghi đè active record |
| first-cycle pass | dirty checkpoint async; force checkpoint ở stop/upgrade có deadline |
| user reset | operation riêng, expected active + strong confirmation + audit |

Power loss giữa write giữ file cũ hoặc file mới valid; CRC/layout mismatch không
được silently zero. RETAIN save không block scan; queue coalesces latest snapshot,
overflow/failure báo health/alarm và giữ dirty state.

## 9. Graph cutover và replacement

Graph backup gồm canonical config/hash/version, không phải screenshot. Cutover chỉ
thay owner Local logic ở one resolver generation theo `DDD-CTRL-PROG-001`. Khi
Commission replacement controller, source-only bundle được import thành Draft,
re-check/compile cho target mới; artifact/credential/secret không được reuse.

Replacement flow: verify hardware/controller identity → restore base config →
import source bundle → map/review target Point → Check → Commission → first-cycle
read-back. Không auto-activate khi import.

## 10. Failure/recovery matrix

| Fault | Detection/State | Output | Recovery |
|---|---|---|---|
| BE crash trước IPC | QUEUED | active giữ | restart resumes/rejects expired |
| IPC timeout | UNKNOWN | không claim | operation/status read-back |
| loader reject | FAILED | LKG giữ | sửa/recompile |
| Core crash trước boundary | reconcile journal | active cũ | discard candidate |
| power loss trong swap | boot table §7 | old/LKG | deterministic recovery |
| first-cycle runtime fault | ROLLING_BACK | candidate staging hủy | LKG restore |
| rollback fail | safety incident | SafetyManager policy | service recovery, no retry storm |
| RETAIN corrupt | PREFLIGHT/STARTING blocked | active cũ | ack cold-init/reset/migrate |
| DB/Core disagreement | UNKNOWN + alarm | Core authority | reconcile, audit correction not overwrite |
| active artifact missing | boot incident | LKG if valid | Restore package; no empty success |

## 11. Concurrency, timeout và resource

- DB lock unique non-terminal runtime operation/controller; Core independently
  enforces single-flight, chống hai BE instance.
- Draft/Check operations có thể song song theo quota nhưng không tranh RT CPU.
- IPC accept timeout 3 s; stage verify bounded 10 s proposal; activation waits
  tối đa hai base-step boundary rồi UNKNOWN/reconcile, không synchronous web wait.
- Staged candidate tối đa một active + một LKG + một candidate/controller; candidate
  mới bị reject khi slot đầy, không evict LKG.
- Trace/monitor read-only không giữ lifecycle lock và bị quota ưu tiên thấp.

## 12. Repository mapping

| Trách nhiệm | As-Built | Target sửa/tạo |
|---|---|---|
| runtime integration | `apps/core/bootstrap/main.cpp`, `application/runtime/scan_loop.*` | ProgrammingRuntimeCoordinator + safe-boundary hook |
| scheduler/artifact | `apps/core/application/st/` | staged candidate, lifecycle state, read-back |
| journal/retain | `st_retain.*`; journal chưa có | `application/programming/{journal,retain_migration}` |
| BE operation | chưa có | `apps/web-api/internal/programming/{service,store,worker,transport}` |
| DB | chưa có | schema trong `DM-PROG-001` |
| IPC | standalone control schema | `contracts/ipc/programming_v1` |
| packaging | manual paths | service dirs/permissions/backup/rollback scripts |

## 13. Verification và acceptance

| Test ID | Fixture/fault injection | PASS/evidence |
|---|---|---|
| `LIFE-T-001` | normal Check→Commission | terminal chỉ sau active/hash/first-cycle read-back |
| `LIFE-T-002` | crash/restart tại mỗi state | exactly one logical operation; không double activation |
| `LIFE-T-003` | power cut tại mỗi journal record | một active deterministically, LKG usable |
| `LIFE-T-004` | stale expected active / two BE instance | một thắng, một `409`; zero partial side effect |
| `LIFE-T-005` | first-cycle fault từng instruction/output | zero candidate output publish; LKG restored |
| `LIFE-T-006` | RETAIN same/migrate/corrupt/missing/reset | đúng plan/ack/audit/CRC; không silent zero |
| `LIFE-T-007` | graph cutover conflict/fault | không dual owner; backup restore |
| `LIFE-T-008` | BE/Core/board restart + network timeout | FE shows unknown then authoritative terminal |
| `LIFE-T-009` | stage 1 MiB + trace/load | Scan/IOP deadline trong limit target |
| `LIFE-T-010` | package rollback/mixed version | capability blocks unsafe downgrade; data preserved |

## 14. Deployment, rollback và Operations

Deploy theo thứ tự storage migration tương thích → Core protocol/lifecycle OFF →
BE worker/API OFF → FE → read-only → Check-only → shadow runtime → one-controller
Commission canary. Mỗi bước có health/read-back và rollback trigger.

Rollback app không xóa DB/artifact/RETAIN/journal. Nếu Core downgrade không đọc
active artifact/retain major, phải Restore LKG compatible bằng bản Core hiện tại
trước khi downgrade. Emergency rollback dùng runbook, không edit DB/file thủ công.

## 15. Journal record và thuật toán recovery

| Field journal | Kiểu | Quy tắc |
|---|---|---|
| `operationId/type` | opaque ID / enum | unique; `COMMISSION/RESTORE/CUTOVER/RESET_RETAIN` |
| `candidateRevision/artifactHash` | ID / SHA-256 | immutable; exact staged bytes |
| `expectedActive` | revision + hash + generation | CAS guard trước swap |
| `phase` | enum | `PREPARED/STAGED/SWAP_INTENT/SWAPPED/FIRST_CYCLE_OK/COMMITTED/ABORTED` |
| `activeBefore/lkgBefore` | refs | đủ để phục hồi, không chỉ display name |
| `retainPlan/cutoverPlan` | versioned hash | exact plan đã user acknowledgement |
| `recordSeq/checksum` | monotonic + checksum | phát hiện torn/duplicate/out-of-order |

```text
recover(journal, runtime_slots):
  verify journal checksum/sequence and artifact references
  if COMMITTED: load recorded active; verify hash; publish status
  else if FIRST_CYCLE_OK and active slot/hash match: finish commit idempotently
  else if SWAPPED/SWAP_INTENT: restore recorded LKG/activeBefore at safe boundary
  else: discard staged candidate; activeBefore remains
  reconcile BE operation by operationId; never synthesize a second operation
```

Journal corrupt hoặc cả active/LKG không verify được phải vào explicit
`NO_ACTIVE/SAFE_STATE` theo Safety authority và phát incident; cấm chọn file mới
nhất theo timestamp. Recovery hoàn tất trước khi nhận mutation lifecycle mới.

## 16. Blocker, revision và phê duyệt

| Blocker | Owner | Gate | Điều kiện mở |
|---|---|---|---|
| RETAIN/cutover/hold policy decision OPEN | Product + Architect + Controls | DOC-G2 approval | ký decision package và đồng bộ SRS |
| Core journal/IPC/BE operation chưa implement | Core + BE | Plan 53 | code + integration/fault tests |
| Power-loss/first-cycle/IOP chưa có target evidence | QA + Ops | release | target/HIL test result approved |

| Phiên bản | Ngày | Thay đổi | Tác giả |
|---|---|---|---|
| 0.1 | 2026-08-09 | Thiết kế state, atomicity, journal, LKG, RETAIN, cutover và recovery | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung journal field schema và recovery algorithm cho từng pha crash/power-loss; chuyển Detailed Draft chờ review | System Engineering |
| 0.3 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; đóng finding `F-PROG-001/002` | System Engineering |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Core + Backend + Operations Lead | Chờ review | — |
| Architect + Controls + QA | Chờ review | — |
| System Architect + Product Owner | **BLOCKED — chưa phê duyệt** | `PROG-OD-001` |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; revision history và bảng ký §16 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 mục tiêu và authority; §3 aggregate và bất biến |
| `DD-03` As-Built | PASS | §2 bảng gap: component ST có test nhưng bootstrap **chưa tạo scheduler**, ScanLoop để `StScheduler*` tùy chọn, `st_program_control_v1.schema.json` có handler đứng riêng, triển khai còn thủ công qua SSH |
| `DD-04` Target ownership | PASS | §3 aggregate và chủ sở hữu; §9 cutover và replacement |
| `DD-05` Data từng field | PASS | §15 schema bản ghi nhật ký từng trường; §8 vòng đời RETAIN |
| `DD-06` Interface | N/A tại file này | Hợp đồng BE↔Core thuộc `IFSPEC-PROG-001` §8/§12; ở đây là máy trạng thái phía sau hợp đồng đó |
| `DD-07` State/algorithm/timing | PASS | §4 state machine Check; §5 Commission/Restore; §7 giao dịch tại biên an toàn và mất điện; §15 thuật toán phục hồi |
| `DD-08` Operation flow | PASS | §6 hợp đồng preflight; §14 bàn giao cho Operations — runbook §12–§14 dựa trực tiếp vào đây |
| `DD-09` Error/safety/security | PASS | §10 ma trận failure/recovery; nguyên tắc “`HTTP 202` không phải thành công”, timeout thành `UNKNOWN` và **không tự gửi lại** — chống `RSK-PROG-007` |
| `DD-10` Repository mapping | PASS | §12 nhật ký Core, coordinator BE và điểm nối bootstrap |
| `DD-11` Verification | PASS | §13 gắn `VS-PROG-011/029/030`; yêu cầu chèn lỗi tại **mọi** trạng thái vòng đời |
| `DD-12` Compatibility/deploy/rollback | PASS | §14 triển khai, rollback và Operations; §8 tương thích RETAIN qua đổi Revision |
| `DD-13` Trace/risk/decision/sign-off | **BLOCKED** | Owner: Product + Runtime Architect (`OD-PROG-009`), Product + System (`OD-PROG-010`). Ảnh hưởng: chưa chốt chính sách RETAIN và số Revision giữ lại thì **không chốt được ma trận phục hồi**, và `RSK-PROG-009` (15 điểm) không giảm. Gate: `DOC-G2`. Điều kiện mở: ký ma trận warm/cold/đổi Revision/mất điện + ngân sách độ bền ghi, và ký thiết kế giao dịch persistence có chèn lỗi tại từng bước |

Một `BLOCKED`, đủ bốn trường. Tài liệu **không** thay thế bằng chứng target/mất
điện/HIL và **không** mở gate implementation hay release.
