# Plan 59 — Triển khai Product Programming thống nhất đến Release

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN-PROG-059` |
| Phiên bản | 2.0 |
| Trạng thái | **Active — PLAN_READY / IMPLEMENT_READY** |
| Ngày | 2026-08-20 |
| Chủ quản | Product Owner/CTO + System Architect + Dev Lead |
| Authority | Product v3.0; ADR-050; `AUTH-PROG-2026-08-20-04` |
| Detailed Design | [`DDD-SW-PROG-UNIFIED-001`](../02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md) |
| Supersedes | Plan 53, Plan 54, Plan 56 và `PROGRAMMING_IMPLEMENTATION_TRACKER.md` về công việc tương lai |
| Release gate | Chỉ mở bằng fresh CI/target/HIL/physical-I/O/soak/provenance/rollback evidence |

## 0. Mục tiêu và cách đọc

Plan này đưa **một** Product Programming từ As-Built hiện tại tới ứng dụng có thể
release. Không chia Rev A/Rev B và không đẩy capability cốt lõi sang roadmap khác.

Kết quả cuối:

- nhiều Program độc lập, tối đa 16 Enabled;
- `PROGRAM`, `FUNCTION`, `FUNCTION_BLOCK` bằng ST/FBD;
- Control Library chuẩn + user-defined có version;
- Published Signal typed/fresh giữa Program;
- Check/Commission/Enable/Disable/Runtime/LKG/RETAIN/audit hoàn chỉnh;
- Output Candidate đi hết safety path tới I/O vật lý;
- package, fresh install, upgrade, rollback, soak và release evidence có authority.

### 0.1 Trạng thái task

| Trạng thái | Ý nghĩa |
|---|---|
| `DONE` | Code/docs/test/evidence acceptance của task đã có và kiểm lại. |
| `READY` | Đủ design/decision để bắt đầu ngay. |
| `ORDERED` | Đã thiết kế xong; tự chuyển READY khi task dependency DONE, không cần approval mới. |
| `EVIDENCE_QUEUE` | Implementation đã/đang làm; chạy khi có lab/target window. Không chặn task code độc lập. |
| `REVIEW` | Code complete, đang review/fix finding trong cùng task. |

**Không dùng trạng thái `BLOCKED` cho task implementation trong plan.** Thiếu
hardware/credential/CI là resource/evidence queue, không phải lý do dừng các Wave
code còn làm được. `RELEASE_READY` vẫn `NO-GO` tới khi evidence thật đủ.

## 1. Baseline và nguyên tắc thực thi

### 1.1 Baseline

- Source baseline khi lập plan: `49a2ad1`.
- As-Built mạnh: ST/FBD built-in compiler/runtime host; atomic one-Program
  Commission/LKG; RETAIN; 25 route Programming; bốn workspace; host suites.
- Migration gap: profile/check/bootstrap một Program; user POU/library/signal và
  product enable path chưa có; MB_RTU binding bị compiler reject; target output
  physical chưa có verdict.

### 1.2 Luật không thương lượng

1. Contract/generator trước consumer; một nguồn sự thật, exact equality guard.
2. Mỗi task gồm code + positive/negative/fault test + docs/trace/changelog.
3. Không sửa acceptance để biến test fail thành PASS.
4. Không shared writable cross-Program; không direct I/O; không FE/BE làm authority
   runtime/safety.
5. Mỗi output binding có một Program owner; conflict fail Check.
6. Active/LKG không đổi khi Check/stage/activation/enable thất bại.
7. Host/browser mock không thay target/HIL/electrical evidence.
8. Review hậu kiểm phát hiện lỗi thuộc task phải sửa trước merge task đó; không mở
   decision blocker mới khi DDD đã khóa semantics.

## 2. Roadmap và critical path

```text
W0 Contract/Migration foundation
 ├─→ W1 POU + Artifact v2 ─→ W2 Control Library ─┐
 ├─→ W3 Multi-Program Project/Check/Mapping ─────┤
 └───────────────────────────────────────────────┴→ W4 Runtime/Scheduler/Signal
                                                     → W5 Lifecycle + FE/BE E2E
                                                     → W6 Hardening/Packaging
                                                     → W7 Target/HIL/V&V/Release
```

W1/W2/W3 có thể chạy song song theo contract boundary. Critical path release là
`T59-001 → T59-006 → T59-106 → T59-305 → T59-406 → T59-501 → T59-602 → T59-703 → T59-707`.

| Wave | Mục tiêu | Entry | Exit |
|---|---|---|---|
| W0 | Contract/generator/store migration v2 và local gate xanh | Plan này Active | G1/layout/compat/generator/store migration PASS |
| W1 | POU ST/FBD + artifact v2 | W0 contract | PROGRAM/FUNCTION/FB compile/load/runtime host PASS |
| W2 | Control Library end-to-end | W0 + registry W1 | SYSTEM/PROJECT library CRUD/version/use/negative E2E PASS |
| W3 | Multi-Program package/check/mapping | W0 + artifact skeleton | 32/16 boundary, MB_RTU binding, conflict check, package deterministic PASS |
| W4 | Runtime scheduler/signal/enable/output/retain/trace | W1+W3 | 10-Program host fixture + fault/restart/operation tests PASS |
| W5 | Atomic lifecycle + sáu-workspace product flow | W2+W4 | Real-backend E2E Draft→Commission→Enable→Runtime→Disable/Restore PASS |
| W6 | Security/performance/package/release candidate | W5 | RC reproducible; all host gates + install/upgrade/rollback dry-run PASS |
| W7 | Target/HIL/V&V/release | RC W6 | Required Test Result PASS, residual accepted, release GO record |

## 3. Bảng nhiệm vụ master

### W0 — Contract và migration foundation

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-001` | P0 | Re-pin `g1_contract_join_v1.json`, bỏ hardcode store schema version | — | READY | G1 thường+self-test+layout exit 0; negative self-test vẫn bắt drift. |
| `T59-002` | P0 | Tạo Product profile v2 `32/16/256/1024/512/512`, generator C++/Go/TS | — | READY | `--check` exact; one-over vectors; không còn product constant 1 Program. |
| `T59-003` | P0 | FBD/POU/library registry JSON single-source + generator | — | READY | TS/C++/schema/verifier exact equality; bỏ SCALE/DEADBAND/CTU/PI ma, đủ conversion/SQRT. |
| `T59-004` | P0 | Error catalog mới cho POU/library/signal/enable/output owner/PID review | T59-002/003 | ORDERED | C++/Go/TS generated; public/detail count/hash exact; mapping missing build fail. |
| `T59-005` | P0 | Store schema v2 + backup/migration v1→v2 | T59-002 | ORDERED | SQLite migration atomic/idempotent/restart; không tự Commission; rollback giữ DB. |
| `T59-006` | P0 | OpenAPI + IPC v2 + artifact/package schema v2, dual-reader policy | T59-002/004 | ORDERED | Schema/golden/codec/client/route contract PASS; action khai phải có handler test. |
| `T59-007` | P1 | Local CI parity wrapper và gate matrix cho từng Wave | T59-001 | ORDERED | Một command chạy layout/C++/Go/FE/contract; không gọi local PASS là GitHub CI. |

### W1 — POU, compiler và artifact v2

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-101` | P0 | Parser/AST cho `FUNCTION` và `FUNCTION_BLOCK`; interface/signature | T59-003/004 | ORDERED | Valid ST parse/source-map; kind/name/signature negative ổn định. |
| `T59-102` | P0 | Symbol/call graph, library resolver, recursion/DAG guard | T59-101 | ORDERED | Direct/indirect recursion, ambiguous/missing/version drift reject; deterministic graph. |
| `T59-103` | P0 | FUNCTION purity/type/side-effect enforcement | T59-102 | ORDERED | Function equivalence ST/FBD; state/RETAIN/I/O/FB stateful call reject. |
| `T59-104` | P0 | FUNCTION_BLOCK instance state/layout/RETAIN ownership | T59-102 | ORDERED | 100/1024 instance isolation; stable layout/source reorder; corrupt/mismatch cold-init. |
| `T59-105` | P1 | FBD nodes gọi user Function/FB + inspector/pin generation | T59-103/104 | ORDERED | ST/FBD shared typed IR; connect/order/undo/source-map/a11y tests. |
| `T59-106` | P0 | Artifact v2 writer/loader: POU/program/library/signal/binding/resource sections | T59-103/104/006 | ORDERED | Golden byte/hash stable; loader bounds/fuzz/tamper/wrong profile; v1 LKG load. |

### W2 — Control Library

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-201` | P0 | Domain/store SYSTEM+PROJECT library revision/entry/usage | T59-005/102 | ORDERED | Immutable system, project versioning, reference guard, migration/restart tests. |
| `T59-202` | P0 | Library REST/OpenAPI/RBAC/idempotency/audit | T59-201/006 | ORDERED | Route↔OpenAPI↔client exact; admin mutation, viewer/operator read, negative direct API. |
| `T59-203` | P1 | FE PGM-04 library search/filter/detail/create/edit/version/usage | T59-202 | ORDERED | Desktop/mobile visual mapping; loading/empty/error/permission; component/a11y/E2E. |
| `T59-204` | P1 | Library import/export/signature/version compatibility | T59-201/106 | ORDERED | Source-only hostile corpus; no executable/cache/path traversal; no Active mutation. |
| `T59-205` | P0 | PID registry trạng thái `REVIEW_REQUIRED` + policy token | T59-003/004 | ORDERED | Commission blocked without controlled approval token; cannot bypass from FE payload. |

### W3 — Multi-Program Project, Check và Mapping

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-301` | P0 | Project Draft/model/API cho 32 Program + POU + signal definitions | T59-005/006 | ORDERED | CRUD/rename/duplicate/search, ETag/idempotency/restart; 33rd Program reject. |
| `T59-302` | P0 | Package Check toàn POU/Program/library/signal/resource | T59-106/201/301 | ORDERED | Aggregate diagnostics, deterministic build, no Active effect, concurrent Check bounded. |
| `T59-303` | P0 | MB_RTU binding compiler adapter qua canonical Point contract | T59-302 | ORDERED | LOCAL/VP/MB_RTU input/output cases; endian/polling không tái định nghĩa; wrong direction reject. |
| `T59-304` | P0 | Output owner/conflict + Published Signal publisher/consumer validation | T59-302/303 | ORDERED | Duplicate output/publisher reject; freshness/fallback/type graph tests. |
| `T59-305` | P0 | Package manifest/topology/budget cho 32/16; Program mới Disabled | T59-302/304 | ORDERED | 32 compile, 16 enabled, one-over stable; manifest không chứa creation-order dependency. |
| `T59-306` | P1 | FE PGM-02/03: POU tree, Program properties, mapping conflicts, signals | T59-301/304 | ORDERED | Sáu route target/legacy redirect; Function/FB hides invalid fields; E2E Draft save/reload. |

### W4 — Runtime, scheduler, signal, Enable/Disable và output

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-401` | P0 | Package coordinator/loader v2 + topology image, bỏ hardcode `program-main` | T59-106/305 | ORDERED | v1/v2 prepared image; stage corrupt no mutation; package status/read-back. |
| `T59-402` | P0 | Per-Program due queue/state/period/budget/metrics, max 16 | T59-401 | ORDERED | 10-Program/3-period host fixture; deterministic deadline; creation reorder same result. |
| `T59-403` | P0 | Worker lanes/fault isolation/no-allocation RT | T59-402 | ORDERED | Single/multicore same semantics; TSan/no allocation/blocking; one Program fault isolated. |
| `T59-404` | P0 | Published Signal double-buffer/freshness/policy | T59-402/304 | ORDERED | No torn read; fallback/hold/wait; producer disable/fault/recover tests. |
| `T59-405` | P0 | Product Enable/Disable store→API→IPC→Core→read-back/audit | T59-401/006 | ORDERED | RBAC/idempotency/restart intent; STARTING/RUNNING/STOPPING/DISABLED truth. |
| `T59-406` | P0 | Candidate registry/withdrawal/output ownership/arbitration/interlock/safe-state | T59-403/405 | ORDERED | Disable/fault/TTL withdraw; next priority/default/safe path; no direct IOP. |
| `T59-407` | P0 | Per-Program/FB RETAIN namespace/layout/restart/reset | T59-104/401 | ORDERED | Warm/cold/revision/corrupt/reset matrix; no half reset; Program isolation. |
| `T59-408` | P1 | Core trace ring buffer + real `TRACE_START/STOP` | T59-402/006 | ORDERED | 10k/10 min bounded, no RT allocation; BE caller thật; action ma = 0. |

### W5 — Lifecycle atomic và sản phẩm FE↔BE↔Core

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-501` | P0 | Package Commission/Restore first-cycle barrier, LKG/journal/recovery | T59-401..407 | ORDERED | Fault mọi phase/restart/power simulation; no partial active; old LKG exact. |
| `T59-502` | P0 | Impact/ack cho multi-Program/library/signal/output/RETAIN/enable intent | T59-501 | ORDERED | BE authority diff; FE chỉ hiện impact thật; stale ack reject. |
| `T59-503` | P1 | FE sáu workspace/navigation/context, PGM-05/06 lifecycle | T59-203/306/405/502 | ORDERED | Desktop/mobile, Draft vs Active vs intent/runtime, stale/offline/unknown/a11y. |
| `T59-504` | P1 | Monitor đủ LOCAL/VP/MB_RTU, Program/signal/candidate/actual/priority | T59-303/404/406 | ORDERED | 3 category, programValue vs actual, source/freshness/quality đúng. |
| `T59-505` | P0 | Real-backend E2E Draft→Check→Commission→Enable→Runtime→Disable→Restore | T59-501..504 | ORDERED | Không `page.route` mock Programming; compiler thật + Core simulator authority; CI lane. |
| `T59-506` | P1 | ST editor durable history/runtime overlay + FBD POU UX polish | T59-503/504 | ORDERED | 20 edit undo/redo, cursor; live value quality/stale; browser Console/Network sạch. |

### W6 — Hardening, packaging và Release Candidate

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-601` | P1 | ST↔FBD corpus mọi registry entry + state traces; 3 fuzz harness CI | T59-105/106 | ORDERED | Registry presence 100%; stateful/conversion vectors; parser/loader/FBD fuzz. |
| `T59-602` | P0 | Artifact/library trust SIGNED + key custody/rotation/rollback | T59-106/204 | ORDERED | Valid/tampered/wrong key/rotation/rollback tests; no `HASH_ONLY` release. |
| `T59-603` | P1 | Security/RBAC/audit/malicious input/concurrency full matrix | T59-202/405/501 | ORDERED | Direct API negative, zero mutation, audit completeness/no secret, rate/resource bounds. |
| `T59-604` | P1 | E2E stability, remove stale quarantine, deterministic workers/retry policy | T59-505 | ORDERED | 5 consecutive full runs; all spec included; retry không che deterministic defect. |
| `T59-605` | P0 | Release packaging: Programming default ON, artifact/compiler/library/systemd/env | T59-501/602 | ORDERED | Fresh install + upgrade package manifest/checksum; services/routes visible; rollback package. |
| `T59-606` | P0 | RC reproducible build/provenance/SBOM/backup/restore/upgrade dry-run | T59-601..605 | ORDERED | Same source reproducible hashes or explained variance; dry-run fresh/upgrade/rollback PASS. |

### W7 — Target/HIL/V&V và quyết định phát hành

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-701` | P0 | Khôi phục GitHub Actions account và chạy full RC workflow | RC T59-606 | EVIDENCE_QUEUE | 11 job khởi chạy thật; required checks PASS trên RC commit. |
| `T59-702` | P0 | Deploy target 10-Program fixture, timing/fault/Web-BE loss | T59-606 | EVIDENCE_QUEUE | 24 h; 3 period; no poll gap >=200 ms; fault isolation/signal freshness đúng. |
| `T59-703` | P0 | Physical I/O HIL cho ST và FBD output | T59-606 | EVIDENCE_QUEUE | AO/DO đo bằng instrument; full candidate/safety path; Disable/rollback physical đúng. |
| `T59-704` | P0 | RETAIN/power-cut/reboot/enable-intent/LKG matrix | T59-606 | EVIDENCE_QUEUE | >=10 power cuts; cold-init/recovery exact; no corrupt accepted/partial active. |
| `T59-705` | P0 | Fresh install/upgrade/controller replacement/rollback rehearsal | T59-606 | EVIDENCE_QUEUE | Image/config/hash/backup/restore/read-back; rollback không mất data/audit. |
| `T59-706` | P0 | PID Controls/Safety target review và evidence | T59-602/703 | EVIDENCE_QUEUE | Saturation/anti-windup/override/release pass; approval token; label READY. |
| `T59-707` | P0 | Chạy full V&V unified + trace/risk/release record | T59-701..706 | ORDERED | Mọi Must disposition PASS hoặc waiver có authority; 0 silent NOT_RUN; GO/NO-GO ký. |

## 4. Bảng ownership

| Boundary | R | A | Consumer/reviewer |
|---|---|---|---|
| Product/SRS/DDD/Plan | System Architect | Product Owner/CTO | mọi discipline |
| Registry/compiler/artifact | Compiler Lead | Runtime Architect | FE/Core/Security/QA |
| Store/API/library/operations | BE Lead | System Architect | FE/Core/Ops/Security |
| Scheduler/signal/output/retain/trace | Core Lead | Runtime Architect | Controls/Safety/iobus/QA |
| Six-workspace UI | FE Lead | Product/UX | BE/QA/a11y |
| Packaging/CI/deploy/rollback | Ops | Release Owner | all leads |
| Target/HIL/V&V | Verification Lead | Release Owner | Controls/Safety/HW/FW |

Một người có thể giữ nhiều vai trong team nhỏ; quyền mutable state/process boundary
không đổi theo nhân sự.

## 5. Definition of Ready và Done

### 5.1 DoR task

- Task ID/owner/source target/acceptance/dependency rõ trong §3.
- Product/SRS/DDD/ADR đã Active; không cần approval mới.
- Contract change có producer/consumer/migration/rollback/test list.
- Fixture và lệnh test nhỏ nhất đã xác định.

Tất cả task Plan 59 đạt DoR về tài liệu. `ORDERED` chỉ chờ output code của task
trước, không chờ quyết định.

### 5.2 DoD task

1. Source/contract/generator hoàn chỉnh, không stub/action ma.
2. Positive/boundary/negative/fault/regression test PASS.
3. Consumer cùng boundary compile/test; generated output `--check` sạch.
4. Security/safety/RT rule applicable được kiểm.
5. Docs/SRS/DDD/Trace/Risk/CHANGELOG cập nhật đúng evidence.
6. `git diff --check` và affected/full gate PASS.
7. Commit logic, PR review; finding thuộc scope sửa trước merge.
8. Không nâng target/HIL/release state nếu task chỉ có host evidence.

## 6. Gate release và NO-GO tự động

`RELEASE_READY = GO` chỉ khi:

- W0..W6 DONE trên RC commit;
- T59-701..707 có evidence immutable và verdict có authority;
- physical AO/DO cho cả ST/FBD PASS;
- 10-Program 24 h + power/restart/RETAIN/LKG + signal/fault isolation PASS;
- fresh install/upgrade/rollback/provenance/SIGNED artifact PASS;
- CI required checks PASS; không quarantine im lặng;
- Trace/Risk không còn Must thiếu disposition, P0/P1 release risk chưa accept.

Thiếu một dòng trên → `NO-GO`, nhưng không được dùng để dừng sửa code hoặc làm
các evidence task còn khả thi.

## 7. Tracker cập nhật

Sau mỗi task, sửa **chính bảng §3**: status, commit/PR, lệnh/số đo, evidence path,
finding/rollback. Không tạo tracker thứ hai. Plan 53/54/56/Tracker cũ chỉ dùng
truy nguyên As-Built đến 2026-08-20.

## 8. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0/1.1 | 2026-08-20 | Bản nháp 37 task chia Rev A/Rev B; superseded. |
| 2.0 | 2026-08-20 | Owner chốt một Product; 51 task/8 Wave từ contract đến release, đủ POU/library/multi-Program/signal/enable/output/HIL; mọi implementation task READY/ORDERED, không còn decision blocker. |
