# Thiết kế vòng đời runtime Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDD-LIFE-PROG-001` |
| Phiên bản | 0.5 |
| Trạng thái | **M3 — APPROVED FOR IMPLEMENTATION; `TASK-PROG-400..402` có source/host evidence; BE coordinator (403), cutover live (404) và target/HIL còn mở** |
| Ngày | 2026-08-13 |
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
| 3. Hệ thống hiện tại đang có gì? | `TASK-PROG-306` (`f35234c`) đã dựng `StScheduler` thật trong bootstrap qua `--programming-mode`; graph.execute() bị khoá khi PROGRAM_ONLY. `TASK-PROG-400` (`a523a04`) thêm `StJournal` 5 phase nhưng chưa wire coordinator. `TASK-PROG-402` (`3ca5d22`) đã nối RETAIN v2 vào scheduler/bootstrap: stable identity, exact layout/version, CRC toàn record, typed variable+FB codec, mailbox ngoài RT, atomic write và explicit cold-init. Control handler vẫn standalone, **chưa** nối BE↔Core. |
| 4. Thiết kế mới thay đổi điều gì? | Biến Commission thành **giao dịch có nhật ký, sống sót qua restart**: một `operationId` bền vững, tráo chương trình tại biên an toàn, và chỉ nâng LKG **sau khi** chu kỳ đầu chạy xong không lỗi. Thất bại ở bất kỳ bước nào đều giữ nguyên Revision đang chạy. |
| 5. Team phải sửa module/contract nào? | §12. Core: nhật ký + máy trạng thái tráo an toàn; BE: coordinator có operation bền vững và đối chiếu lại trạng thái; Ops: dùng procedure §14 thay cho thao tác SSH thủ công. |
| 6. Điều gì còn bị chặn? | Chính sách RETAIN source của `OD-PROG-009` đã được hiện thực cho Rev A: chỉ restore exact-compatible, còn missing/corrupt/mismatch thì cold-init có diagnostic. Phần còn chặn release là journal/coordinator/UDS/cutover `TASK-PROG-403..405` và `VS-PROG-029/030` power-loss/restart trên Forlinx/HIL. |
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
| ST components | compiler/loader/scheduler/retain/trace/journal có unit/integration test; RETAIN đã wire scheduler/bootstrap ở `TASK-PROG-402` | journal/coordinator chưa wire vào lifecycle (403) và target power-fault chưa chạy |
| ScanLoop | `TASK-PROG-306` (`f35234c`): `CutoverMode` chọn producer, `graph.execute()` khoá khi `PROGRAM_ONLY`, bootstrap dựng `StScheduler` thật | exclusive producer đã đạt; lifecycle safe swap DURABLE (journal wired) còn ở 403 |
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

**As-Built (`TASK-PROG-400`).** `StJournal` (`st_journal.hpp/.cpp`) hiện thực
đúng 5 phase và bảng boot-recovery ở trên: append record cố định kích thước
(magic+version+phase+timestamp+4 field bounded 64 byte+CRC32 riêng từng
record) qua `open(O_APPEND)+write()+fsync(fd)+fsync(dir)`; `read_last()` quét
tuần tự, dừng ở record đầu tiên hỏng — record CUỐI bị cắt cụt (mất điện giữa
lúc ghi) không làm mất các record trước đó đã fsync. `st_journal_decide_
boot_action()` là hàm thuần (không I/O) hiện thực đúng 5 dòng bảng, test được
không cần dựng file.

**Phạm vi cố ý hẹp hơn §15:** field set ở đây (operation_id/old_active_hash/
candidate_hash/plan_hash) là SUBSET của bảng §15 (`type/candidateRevision/
expectedActive-với-generation/activeBefore/lkgBefore/retainPlan/cutoverPlan/
recordSeq`) — §15 mô tả journal ĐẦY ĐỦ cho toàn giao dịch BE+Core (khớp
`TransitionPlan` §6), còn `StJournal` chỉ là phần CORE TỰ GIỮ cho 5 phase
safe-boundary của CHÍNH nó, không biết `candidateRevision`/`retainPlan`/
`cutoverPlan` là gì — những field đó do BE coordinator (`TASK-PROG-403`)
theo dõi trong DB. Chưa nối vào `StScheduler::apply_pending_activations()`
hay bootstrap — đó là bước tích hợp cần `TASK-PROG-403` (coordinator gọi
`append()` tại đúng safe-boundary) và transport UDS (gap đã ghi ở
`TASK-PROG-306`).

## 8. RETAIN lifecycle

RETAIN record v2 dùng key file `SHA-256(controllerId + NUL + stableInstanceId)`;
header 160 byte lưu record/layout version, flags, compact layout CRC, payload size,
generation, capture/source metadata, instance/layout/artifact SHA-256, CRC-32 toàn
record và reserved bytes. Storage thực dưới `${PROGRAMMING_STATE_DIR}/retain/`,
fallback `${STATE_DIR}/programming/retain/`, rồi `/data/mkddc/programming/retain/`.
Directory/file là `0750/0640`; đọc dùng `O_NOFOLLOW`, regular-file/size bound và
exact read; ghi temp riêng + `fsync` + close + `rename` + `fsync` thư mục.

| Tình huống | Hành vi |
|---|---|
| same compatible layout | validate toàn record/payload rồi restore typed values + FB state trước STARTING |
| thêm biến không RETAIN | giữ compatible vì stable layout identity không chứa IR slot |
| thay identity/type/order/size/layout | cold-init `RT-RETAIN-003`, không migration ngầm |
| corrupt/version/size/missing | cold-init explicit; `RT-RETAIN-001/002/004` hoặc `COLD_INIT_MISSING`; không chặn Core boot |
| activation fail | candidate RETAIN không ghi đè active record |
| output batch commit thành công | snapshot bounded vào mailbox hai slot; worker ngoài RT ghi nếu đổi và đủ 60 s |
| shutdown sạch | force flush snapshot mới nhất, bỏ qua giới hạn 60 s |
| user reset | operation riêng, expected active + strong confirmation + audit |

Power loss giữa write giữ file cũ hoặc file mới valid; CRC/layout mismatch không
được silently zero. RETAIN save không block scan: scan không filesystem I/O, lock
hay allocation; mailbox coalesce latest nhưng không ghi đè slot worker đang đọc.
Payload biến dùng codec typed; FB dùng codec fixed-size không phụ thuộc ABI. Timer
lưu elapsed rồi rebase monotonic; PID giữ integral/previous output nhưng reseed
timing/derivative ở cycle đầu. `program_status` công khai `retainState`,
`retainDetailCode`, generation và bộ đếm ghi/lỗi.

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
| runtime integration | `apps/core/bootstrap/main.cpp` dựng `StScheduler` thật tại `f35234c` (306) và `StRetainService` tại `TASK-PROG-402`; `st_process_image.cpp` publish snapshot sau output commit | ProgrammingRuntimeCoordinator gọi `StJournal` tại đúng safe-boundary + UDS transport |
| scheduler/artifact | `apps/core/application/st/` | staged candidate, lifecycle state, read-back |
| journal/retain | `st_retain.*`, `st_scheduler.*`, `st_process_image.cpp`, `bootstrap/main.cpp` tại `3ca5d22`; `st_journal.*` tại `TASK-PROG-400` | journal wiring vào operation coordinator; migration ngoài exact layout không thuộc Rev A |
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
| `LIFE-T-006` | RETAIN same/corrupt/version/layout/identity/missing, FB timer/PID, output commit, atomic temp | Host component `StRetain.*:StControlApi.*:StIntegration.*` PASS; `VS-PROG-029/030` target/HIL vẫn `NOT RUN` |
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

**As-Built (`TASK-PROG-400`).** Bảng field ở trên là journal ĐẦY ĐỦ (BE+Core).
Phần Core tự giữ (`StJournal`, xem As-Built §7) chỉ có
`operation_id/old_active_hash/candidate_hash/plan_hash/phase/timestamp_ns` +
CRC per-record — KHÔNG có `type/candidateRevision riêng/expectedActive kèm
generation/activeBefore/lkgBefore/retainPlan/cutoverPlan/recordSeq` tường
minh, vì Core không tự biết những giá trị đó (BE coordinator theo dõi trong
DB, TASK-PROG-403). `recover()` pseudocode ở trên khớp
`st_journal_decide_boot_action()` về Ý NGHĨA cho 5/7 nhánh; nhánh `STAGED`
(BE chưa bàn giao candidate cho Core) không thuộc phạm vi `StJournal`.

## 16. Blocker, revision và phê duyệt

| Blocker | Owner | Gate | Điều kiện mở |
|---|---|---|---|
| Journal/IPC/BE operation chưa tích hợp | Core + BE | Plan 53 | hoàn tất `TASK-PROG-403/404` + integration/fault tests |
| Power-loss/first-cycle/IOP chưa có target evidence | QA + Ops | release | target/HIL test result approved |

| Phiên bản | Ngày | Thay đổi | Tác giả |
|---|---|---|---|
| 0.1 | 2026-08-09 | Thiết kế state, atomicity, journal, LKG, RETAIN, cutover và recovery | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung journal field schema và recovery algorithm cho từng pha crash/power-loss; chuyển Detailed Draft chờ review | System Engineering |
| 0.3 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; đóng finding `F-PROG-001/002` | System Engineering |
| 0.4 | 2026-08-13 | Đồng bộ `TASK-PROG-306` (bootstrap dựng StScheduler thật) và `TASK-PROG-400` (`StJournal` 5 phase Core-side, append/checksum, boot-recovery); ghi rõ phạm vi hẹp hơn bảng field §15 (thiếu type/candidateRevision/expectedActive-generation/activeBefore/lkgBefore/retainPlan/cutoverPlan/recordSeq — cần TASK-PROG-403 BE coordinator); giữ target/HIL NOT TESTED | Core + BE |
| 0.5 | 2026-08-13 | Đồng bộ `TASK-PROG-402`: RETAIN record v2/layout v1, stable controller+instance identity, full-record CRC, exact typed/FB restore, async mailbox/worker, output-commit checkpoint, atomic write/cold-init diagnostics và status health; giữ `VS-PROG-029/030` Forlinx/HIL NOT RUN | Core |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Core + Backend + Operations Lead | **WAIVED FOR IMPLEMENTATION; hậu kiểm còn mở** | `AUTH-PROG-2026-08-11-03` |
| Architect + Controls + QA | **WAIVED FOR IMPLEMENTATION; target review còn mở** | `AUTH-PROG-2026-08-11-03` |
| System Architect + Product Owner | **APPROVED FOR IMPLEMENTATION** | `AUTH-PROG-2026-08-11-03` |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; revision history và bảng ký §16 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 mục tiêu và authority; §3 aggregate và bất biến |
| `DD-03` As-Built | PASS | §2 bảng gap: bootstrap PROGRAM_ONLY đã tạo scheduler + RETAIN service; journal/coordinator/UDS vẫn chưa nối; control handler còn standalone |
| `DD-04` Target ownership | PASS | §3 aggregate và chủ sở hữu; §9 cutover và replacement |
| `DD-05` Data từng field | PASS | §15 schema bản ghi nhật ký từng trường; §8 vòng đời RETAIN |
| `DD-06` Interface | N/A tại file này | Hợp đồng BE↔Core thuộc `IFSPEC-PROG-001` §8/§12; ở đây là máy trạng thái phía sau hợp đồng đó |
| `DD-07` State/algorithm/timing | PASS | §4 state machine Check; §5 Commission/Restore; §7 giao dịch tại biên an toàn và mất điện; §15 thuật toán phục hồi |
| `DD-08` Operation flow | PASS | §6 hợp đồng preflight; §14 bàn giao cho Operations — runbook §12–§14 dựa trực tiếp vào đây |
| `DD-09` Error/safety/security | PASS | §10 ma trận failure/recovery; nguyên tắc “`HTTP 202` không phải thành công”, timeout thành `UNKNOWN` và **không tự gửi lại** — chống `RSK-PROG-007` |
| `DD-10` Repository mapping | PASS | §12 nhật ký Core, coordinator BE và điểm nối bootstrap |
| `DD-11` Verification | PASS | §13 gắn `VS-PROG-011/029/030`; yêu cầu chèn lỗi tại **mọi** trạng thái vòng đời |
| `DD-12` Compatibility/deploy/rollback | PASS | §14 triển khai, rollback và Operations; §8 tương thích RETAIN qua đổi Revision |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation; release BLOCKED | `AUTH-PROG-2026-08-11-03` mở implementation; `RSK-PROG-009` vẫn Open 15 vì `VS-PROG-029/030` target/HIL chưa PASS và residual chưa được owner+QA chấp nhận |

Một `BLOCKED`, đủ bốn trường. Tài liệu **không** thay thế bằng chứng target/mất
điện/HIL và **không** mở gate implementation hay release.
