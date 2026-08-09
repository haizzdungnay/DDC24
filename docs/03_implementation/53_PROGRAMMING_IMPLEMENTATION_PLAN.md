# Plan 53 — Triển khai Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN-PROG-053` |
| Phiên bản | 0.6 |
| Trạng thái | **PLAN-ONLY — chưa được implement production.** Hồ sơ ở `M3 — Review Ready`; `PLAN_READY` chưa đóng, `IMPLEMENT_READY` và `RELEASE_READY` chưa mở |
| Ngày | 2026-08-09 |
| Chủ quản | Dev Lead + System Architect |
| Người review | Product, FE/BE/Core/FW/HW/Security/QA/Ops Leads |
| Người phê duyệt | Product Owner + System Architect + Verification Lead |
| Design set | [`PROG-DOCSET-001`](../02_design/PROGRAMMING_DESIGN_INDEX.md) |

> ## ⚠ PLAN-ONLY — chưa được phép viết code production
>
> Phán quyết ngày 2026-08-09: **được giao team lập kế hoạch có kiểm soát; chưa
> được giao implement production.** Team được phép phân tích, ước lượng, dựng
> dependency và điền thẻ task ngay. Team **chưa** được phép tạo nhánh feature,
> viết code production, đổi contract hay bật feature flag.
>
> Điều kiện tối thiểu để chuyển sang `IMPLEMENT_READY`, xem §3.1: đóng finding
> P0 tài liệu; 22 hồ sơ nằm trong Git baseline có commit và hash; harness chạy
> lại được từ repository; và **decision đầu vào của lát cắt sắp làm đã được ký**
> — không cần cả 17 decision, xem §3.2.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **thứ tự làm và điều kiện qua cửa**: bảy pha `P0..P6`, phụ thuộc giữa chúng, ai chịu trách nhiệm gì, và bằng chứng nào mở được mỗi gate `G0..G6`. |
| 2. Ai phải đọc file này? | Dev Lead và Architect (chủ quản); Product và QA duyệt; mọi team đọc pha của mình. Đọc **sau** khi đã đọc hồ sơ thiết kế upstream của slice mình. |
| 3. Hệ thống hiện tại đang có gì? | §7: `G0` đang `RED`. Chưa pha nào bắt đầu. Nền tảng sẵn có gồm component ST trên host, hợp đồng Modbus RTU `Active`, và bốn tiến trình đang chạy — nhưng chưa có mã Programming nào chạy production. |
| 4. Thiết kế mới thay đổi điều gì? | Xác lập nguyên tắc: **không mở gate bằng lời văn**. Mỗi pha có điều kiện vào và ra cụ thể; §11 định nghĩa Definition of Ready và Definition of Done cho từng task; §12 định nghĩa bằng chứng gate và điều kiện quay lui. |
| 5. Team phải sửa module/contract nào? | §10 ánh xạ quyền sở hữu source và sản phẩm bàn giao theo pha; §14 có mẫu thẻ task và cách bàn giao theo lát cắt dọc. |
| 6. Điều gì còn bị chặn? | `IMPLEMENT_READY` và `RELEASE_READY` đang `BLOCKED`; `PLAN_READY` đang `OPEN`. Team **được** lập kế hoạch ngay, **chưa được** viết code production. Xem §3.1 và §3.2. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §3.3 chỉ rõ **gate nào tạo ra từng Test Result** trong 32 kịch bản; §12 gắn bằng chứng bắt buộc cho từng gate. Hiện 0/32 — đó là trạng thái đúng **trước** implementation, không phải lý do chặn lập kế hoạch. |

Quan hệ với Plan 54: file này quản **việc code**; [Plan 54](54_PROGRAMMING_DOCUMENTATION_ROADMAP.md)
quản **việc tài liệu**. Hoàn tất bộ hồ sơ chỉ mở quyền *bắt đầu* implementation
có kiểm soát — nó không chứng minh sản phẩm đã chạy, đạt HIL hay sẵn sàng release.

## 1. Mục tiêu và Definition of Done

Triển khai vertical slice hoàn chỉnh ST+structured FBD → Check → Commission →
Program Runtime → Point/priority/safe output → Online Monitor/Restore trên đúng
Rev A profile, có evidence FE/BE/Core/MCU/HW và không làm suy giảm control hiện hữu.

Done chỉ khi G0–G6 đạt; mọi requirement Must có trace/evidence; graph/program
cutover, IOP 200 ms, output continuity, RETAIN, power/restart, RBAC/audit và
operations rollback được kiểm chứng trên target/HIL. Host component hoặc UI mock
không đủ để đóng plan.

## 2. Nguyên tắc triển khai

1. Contract và decision trước code phụ thuộc.
2. Mỗi slice gồm docs + contract + implementation + positive/negative/fault test
   + traceability + changelog.
3. Commission mutation giữ feature flag `off` tới khi Core/HIL gate đạt.
4. Không thêm daemon/core process mới nếu chưa có ADR.
5. Không dual-run graph và Program trên output thật.
6. Không đổi IOP/SHM/artifact/persistence contract mà thiếu producer/consumer,
   migration/deploy order/rollback/test cùng thay đổi.

## 3. Dependency chain

```text
P0 Decisions/requirements
  → P1 Data + OpenAPI + internal IPC + IR/profile/error contracts
    → P2 Compiler/ST/FBD + BE Project/Revision/Check
      → P3 Core base-step/loader/scheduler/Point/arbitration
        → P4 Atomic Commission/Restore/RETAIN/cutover
          → P5 FE bốn workspace / tám journey `UJ-PROG-01..08`
            → P6 MCU/HW/HIL + operations/release
```

FE shell/read-only có thể đi song song sau P1; không nối mutation giả trước API.
FW MCU/HW chuẩn bị fixture/test point từ P0, nhưng HIL kết luận sau P3/P4.

## 3.1 Ba cổng: `PLAN_READY`, `IMPLEMENT_READY`, `RELEASE_READY`

Trước đây `G0` gộp “được lập kế hoạch” với “được viết code”, nên chặn quá rộng:
team không thể ước lượng gì khi chưa có chữ ký, dù việc ước lượng không đụng tới
sản phẩm. Tách làm ba cổng.

| Cổng | Cho phép làm gì | Điều kiện đóng | Trạng thái 2026-08-09 |
|---|---|---|---|
| `PLAN_READY` | Phân tích, ước lượng, dựng dependency, điền thẻ task, dựng fixture test trên máy dev, viết spike **bỏ đi** không merge | Finding tài liệu P0 đã đóng; consumer review xong; revision/hash của 22 hồ sơ được ghim; không còn authority mâu thuẫn | **OPEN** — còn thiếu consumer review của người thật và chữ ký |
| `IMPLEMENT_READY` | Tạo nhánh feature, viết code production, đổi contract, mở feature flag ở môi trường lab | `PLAN_READY` đóng **và** decision đầu vào của **đúng lát cắt đó** đã ký (§3.2) **và** contract của lát cắt đã machine-readable | **BLOCKED** |
| `RELEASE_READY` | Bật ở site thật, tuyên bố hoàn tất | Toàn bộ 32 `VS-PROG-*` có Test Result được review; residual risk được chấp nhận; `OD-PROG-008` phần HIL đã đóng; GO của Product + Release + QA | **BLOCKED** |

Ba cổng này **không** thay `G0..G6`. `G0..G6` là các mốc kỹ thuật theo §3.3;
ba cổng ở trên là **quyền hạn** được cấp cho team tại mỗi thời điểm.

## 3.2 Decision cần cho từng lát cắt

Không cần đóng cả 17 decision mới được lập kế hoạch. Nhưng **trước khi implement
một lát cắt**, decision đầu vào của chính lát cắt đó phải được ký.

| Lát cắt sắp implement | Decision phải ký trước | Ghi chú |
|---|---|---|
| Contract, kiểu dữ liệu, FBD, Point | `OD-PROG-001..007` | Nặng nhất là `OD-PROG-002` (bề rộng kiểu số) vì nó khóa encoding IR và Point mapping |
| Runtime, RETAIN, timing, cutover | `OD-PROG-009..014` | `OD-PROG-012` khóa công thức base-step/watchdog |
| UI bốn workspace | `OD-PROG-016` | Chưa ký thì FE không khóa được route và cây component |
| Phạm vi thư viện mẫu BMS | `OD-PROG-017` | Nếu hoãn sang Roadmap thì Rev A chỉ có Core Library và User FB cục bộ |
| Modbus RTU phần HIL | `OD-PROG-008` | Contract đã `Active`; **phần HIL cần đóng trước `RELEASE_READY`**, không chặn lập kế hoạch |
| Phê duyệt baseline tổng thể | `OD-PROG-015` | Dùng để đóng `PLAN_READY` cho toàn bộ bộ hồ sơ |

## 3.3 Roadmap thực thi `G0..G6`

`0/32` Test Result là trạng thái **đúng** trước implementation. Bảng dưới đây
chỉ rõ gate nào **tạo ra** từng Test Result, để không ai phải chờ evidence mới
được lập kế hoạch.

| Gate | Phạm vi | Kết quả bắt buộc | Test Result được tạo |
|---|---|---|---|
| `G0` Baseline | Đóng finding tài liệu, consumer review, ghim revision/hash, ký decision theo lát cắt | `PLAN_READY`; không còn authority mâu thuẫn | — (gate tài liệu) |
| `G1` Contract | Data model, OpenAPI, IPC BE↔Core, artifact/profile, catalog mã lỗi | Contract machine-readable, client sinh tự động, contract compatibility test | `VS-001`, `VS-019` phần contract |
| `G2` Nền tảng song song | FW-SOM loader/runtime; BE store/check; FE shell chỉ đọc | Mỗi nhánh dùng **cùng** contract version; feature flag mặc định OFF | `VS-003`, `VS-012`, `VS-023` |
| `G3` Project/Draft/Check | Project → Draft → ST/FBD → Check → diagnostic | Active **không đổi**; conflict/restart/fuzz/resource test PASS | `VS-005`, `VS-006`, `VS-007`, `VS-008`, `VS-017`, `VS-019`, `VS-024` |
| `G4` Runtime/Commission | Scheduler, Point, arbitration, `impactRef`, Commission, đọc ngược | Không optimistic success; fail-closed; restart và đối chiếu đúng | `VS-004`, `VS-009`, `VS-010`, `VS-011`, `VS-013`, `VS-014`, `VS-016`, `VS-018`, `VS-020`, `VS-022` |
| `G5` Restore/RETAIN/UI | Restore, LKG, RETAIN, bốn workspace, E2E desktop/mobile | Fault/recovery và tám journey có bằng chứng | `VS-002`, `VS-015`, `VS-021`, `VS-025`, `VS-026`, `VS-027`, `VS-028`, `VS-029`, `VS-031`, `VS-032` |
| `G6` Target/HIL/Release | MCU/HW, poll gap, watchdog, power fault, backup/rollback/security | 32/32 có Test Result; residual risk được chấp nhận; GO/NO-GO | `VS-030` và xác nhận lại toàn bộ trên target |

Đếm để kiểm: 32 kịch bản được phân bổ hết vào `G1..G6`, không kịch bản nào mồ côi.

**Song song được phép.** BE persistence và FE shell chỉ đọc có thể chạy song song
ngay sau `G1`. Nhưng **mutation của FE chỉ được nối sau khi contract BE/Core và
hành vi lỗi đã thật sự tồn tại** — nối vào mock rồi đổi sau là cách chắc chắn
sinh ra hành vi lỗi khác nhau giữa ba team.

## 4. Pha và task

### P0 — Khóa yêu cầu và thiết kế (G0)

| Task | Owner | Kết quả/exit |
|---|---|---|
| `PROG-000` | Product | ký Product amendment/scope/claim; quyết định capacity/type/FBD/Task/library |
| `PROG-001` | Architect | đóng base-step/watchdog, graph cutover, overrun/safe-state, process allocation |
| `PROG-002` | Controls | khóa priority mức 5, PID anti-windup, hold-last/transition/initial policy |
| `PROG-003` | Product+Security | khóa RBAC, audit, bundle/integrity/signature scope |
| `PROG-004` | Runtime+Ops | khóa RETAIN, Revision/LKG retention, monitor/trace limits |
| `PROG-005` | HW+FW | xác nhận schematic/BSP/test point/HIL setup và 200 ms boundary |
| `PROG-006` | QA | review SRS/design/trace/risk/V&V, sign G0 |

Exit: `OD-PROG-*` liên quan Closed/Decided có tài liệu phụ thuộc đồng bộ; không
còn `ARCH-CONF-PROG-*`; suite ký. Nếu chưa exit, chỉ prototype không control.

### P1 — Contract foundation (G1-A)

| Task | Owner | Dependency | Deliverable/test |
|---|---|---|---|
| `PROG-100` | BE+FE | P0 | OpenAPI `/programming`, generated TS, contract tests |
| `PROG-101` | BE+Core | P0 | versioned UDS/schema operation/status/stage/activate/restore |
| `PROG-102` | Core | P0 | Rev A compiler/artifact/runtime profile và loader error map |
| `PROG-103` | BE+Core | 101–102 | `PRG-ERR-*` authority + component detail mapping |
| `PROG-104` | BE | P0 | DB schema/migration/backup/immutable invariants |
| `PROG-105` | All | 100–104 | compatibility/deploy-order/rollback review + trace update |

Exit: machine-readable contract, positive/negative round-trip và version reject
PASS; chưa mở Commission.

### P2 — Compiler, Project/Revision và Check (G1-B/G2)

| Task | Owner | Dependency | Deliverable/test |
|---|---|---|---|
| `PROG-200` | Core/compiler | P1 | reconcile ST subset/limits/source map, fuzz |
| `PROG-201` | Core+FE | P1 | structured FBD canonical model/keyboard commands |
| `PROG-202` | Compiler | 200–201 | ST/FBD → common typed IR equivalence |
| `PROG-203` | Compiler | 202 | deterministic artifact/hash/profile/manifest/source map |
| `PROG-204` | BE | P1 | Project/Draft/Revision store, ETag/idempotency |
| `PROG-205` | BE | 202–204 | sandbox compiler worker + Check aggregate/diagnostics |
| `PROG-206` | BE | 204 | change manifest, bundle source-only import/export |
| `PROG-207` | Security/QA | 205–206 | timeout/OOM/fuzz/traversal/zip bomb/audit secret tests |

Exit: `VS-001/003/005/006/007/017/019/021/023/024` applicable PASS; active
runtime chưa đổi khi Check.

### P3 — Core deterministic runtime (G3)

| Task | Owner | Dependency | Deliverable/test |
|---|---|---|---|
| `PROG-300` | Core | P1/P2 | bounded loader/preallocated runtime/no parser RT |
| `PROG-301` | Core | P0/P1 | base step tách Task period; Rev A one-task profile |
| `PROG-302` | Core | 300–301 | process image + LOCAL/VP/MB-RTU binding bridge |
| `PROG-303` | Core/Controls | 302 | priority mức 5, program/actual feedback, PID anti-windup |
| `PROG-304` | Core | 301 | overrun task fault, SafetyManager condition độc lập |
| `PROG-305` | Core | 301–304 | runtime/monitor/bounded trace/capability/status IPC |
| `PROG-306` | Core/Ops | 301 | bootstrap cutover config, graph backup/reject dual |
| `PROG-307` | QA | 300–306 | no-allocation/blocking, 10k-cycle target timing, load test |

Exit: `VS-009/010/012/013/016/017/018/027` PASS trên mức được yêu cầu; feature
vẫn không production-enable nếu P4/P6 chưa đạt.

### P4 — Atomic lifecycle, RETAIN và recovery (G4)

| Task | Owner | Dependency | Deliverable/test |
|---|---|---|---|
| `PROG-400` | Core | P3 | stage/safe-boundary swap/first-cycle/LKG |
| `PROG-401` | Controls+Core | 303/400 | hold-last program_value + transition policy |
| `PROG-402` | Core | P3 | RETAIN stable identity/version/CRC/atomic/cold-init |
| `PROG-403` | BE | P1/P2/P3 | Commission/Restore coordinator + durable operation/reconcile |
| `PROG-404` | BE+Core | 306/403 | first graph→Program cutover + rollback |
| `PROG-405` | QA | 400–404 | fault at every step, BE/Core/power restart, corrupt artifact/retain |

Exit: `VS-004/011/014/015/024/029/030` software/target portions PASS; Commission
vẫn feature-gated tới HIL electrical.

### P5 — FE/UX (G2/G4)

| Task | Owner | Dependency | Deliverable/test |
|---|---|---|---|
| `PROG-500` | FE | P1 | feature routes/shell/context/RBAC/i18n/state model |
| `PROG-501` | FE | P2 | Project tree, ST editor, Problems/Check |
| `PROG-502` | FE | P2 | structured FBD editor keyboard/a11y |
| `PROG-503` | FE | P1/P2 | Point mapping + one Task/Core Library |
| `PROG-504` | FE | P4 | readiness/change/override/Commission/Unknown reconcile |
| `PROG-505` | FE | P3/P4 | Runtime/Watch/Trace/Versions/Restore/Replacement |
| `PROG-506` | FE+QA | 500–505 | Vitest/lint/build/Playwright/Chrome desktop+mobile/Console+Network |

Exit: `VS-002/008/017..022/025..028` PASS; không fake producer hoặc optimistic Active.

### P6 — FW MCU, HW, HIL và release (G5/G6)

| Task | Owner | Dependency | Deliverable/test |
|---|---|---|---|
| `PROG-600` | FW MCU | P0 | production BSP/UART DMA/IDLE/safe-timeout/diagnostics |
| `PROG-601` | HW | P0 | schematic/BOM/test-point review + HIL fixture |
| `PROG-602` | Core+FW+HW | P3/P4/600/601 | poll gap, AO/DO hold-last, PID/priority, 199/200/201 ms |
| `PROG-603` | QA/Ops | P4/P5/P6 | restart/brownout/power loss/upgrade/backup/restore/replacement |
| `PROG-604` | Security | all | RBAC/import/integrity/audit/secret/provenance review |
| `PROG-605` | QA | all | full regression + trace/risk/residual/release report |
| `PROG-606` | Product/Release | 605 | GO/NO-GO ký; staged rollout + monitored rollback |

Exit: toàn bộ `VS-PROG-001..030` PASS, risk >=15 có residual acceptance,
release provenance và operations rehearsal đạt.

## 5. RACI

| Workstream | Product | Architect | FE | BE | Core/FWSOM | FW MCU | HW | QA/Ops |
|---|---|---|---|---|---|---|---|---|
| Scope/requirements | A | R | C | C | C | C | C | C |
| Data/OpenAPI | C | A | R | R | C | I | I | C |
| IR/artifact/runtime | C | A | I | C | R | I | I | C |
| UX/FE | C | C | R/A | C | C | I | I | C |
| Commission/recovery | C | A | C | R | R | C | C | C |
| MCU/HW/HIL | I | C | I | I | C | R | R | A |
| Release | A | C | C | C | C | C | C | R |

`R` thực hiện, `A` chịu trách nhiệm cuối, `C` tham vấn, `I` được thông báo.

## 6. Commit/PR và change control

Tách commit theo contract/data → compiler → Core → BE → FE → FW MCU/HW test →
docs/evidence. Mỗi contract change phải cập nhật producer/consumer/test/docs/
trace/changelog cùng session. PR body tiếng Việt ghi requirement/scenario,
commands/results, target/HIL gap và rollback.

## 7. Trạng thái ban đầu

| Gate | Trạng thái 2026-08-09 | Lý do |
|---|---|---|
| G0 | RED | design/sign-off/OD còn mở |
| G1 | RED | contract chưa machine-readable/approved; FBD chưa production |
| G2 | RED | FE/BE Programming chưa implement |
| G3 | RED | ST scheduler chưa bootstrap production; graph vẫn owner |
| G4 | RED | Commission/Restore/RETAIN end-to-end chưa có |
| G5 | RED | BSP/HW/HIL vật lý chưa đủ |
| G6 | RED | chưa có release/operations evidence |

Không task nào được ghi `DONE` chỉ vì component host tồn tại; trạng thái phải
trỏ tới commit + test/evidence hiện tại.

## 8. Entry criteria và baseline tài liệu

| Entry | Authority | Trạng thái 2026-08-09 |
|---|---|---|
| 21 hồ sơ upstream + Plan 53 đạt M5 | `PLAN-PROG-DOC-054` | BLOCKED: 0/22 M5 |
| 15 Open Decision được ký và downstream sync | `PROG-OD-001` | BLOCKED: 15 OPEN |
| Product/SRS/Architecture/contract baseline pin version/hash | Document Control | BLOCKED |
| TLS/RBAC/security enablement plan approved | `DDD-SEC-PROG-001` | BLOCKED |
| HW/BSP/schematic/test limits/fixture approved | MCU/HW design | BLOCKED |
| Branch/build/toolchain/target lab/evidence repository ready | Dev/QA/Ops | BLOCKED |

Không tạo OpenAPI/schema/artifact/RETAIN production từ `TARGET-PENDING`. Prototype
nếu được Dev Lead chấp thuận phải isolated, feature flag OFF, không migrate data
active và không được tính tiến độ task production.

## 9. Work breakdown, estimate và trạng thái

Estimate là dải `person-day` để bố trí nguồn lực sau approval, không phải cam kết
lịch; QA/HIL có thể kéo dài theo fixture. Mỗi phase chỉ `NOT_STARTED`, vì chưa có
commit/Test Result Target đủ điều kiện.

| Phase | Task | Estimate | Dependency cứng | Status / exit evidence |
|---|---:|---:|---|---|
| P0 | 000–006 | 8–15 | DOC-G4 | BLOCKED; decision/design/sign-off package |
| P1 | 100–105 | 15–25 | P0 | NOT_STARTED; OpenAPI/IPC/schema migration contract tests |
| P2 | 200–207 | 35–55 | P1 | NOT_STARTED; compiler/store/Check/bundle unit/fuzz/integration |
| P3 | 300–307 | 35–55 | P0–P2 | NOT_STARTED; Core target timing/no-forbidden-call evidence |
| P4 | 400–405 | 30–45 | P3 + BE P2 | NOT_STARTED; lifecycle/power/fault/read-back Test Results |
| P5 | 500–506 | 30–45 | P1/P2/P4 per task | NOT_STARTED; Vitest/build/E2E/browser/a11y evidence |
| P6 | 600–606 | 25–45 + lab | all | NOT_STARTED; target/HIL/ops/security/release record |
| **Tổng** | 42 task | **178–285 person-day + lab/review** | sequential gates, parallel lanes có kiểm soát | G0..G6 đều RED |

Estimate phải re-estimate khi decisions thay đổi capacity/FBD/library/TLS/HW.
Không dùng tổng này làm deadline trước resource/calendar/board availability review.

## 10. Source ownership và deliverable map

| Slice | File/module chính | Owner | Contract/test cùng commit |
|---|---|---|---|
| Data/API | `apps/web-api/internal/programming`, `contracts/openapi/openapi.yaml` | BE | migration + OpenAPI/Go/TS contract |
| Compiler | `apps/core/application/st`, BE compiler adapter, `contracts/programming` | Compiler+BE | golden/property/fuzz/resource |
| Artifact/loader | `application/st`, `application/programming`, `contracts/ipc` | Core | loader negative/mixed-version/symbol |
| Control/lifecycle | bootstrap, ScanLoop, PriorityResolver, programming coordinator | Core+Controls | timing/fault/power/owner/read-back |
| FE | `apps/web-ui/src/features/programming`, App routes/nav/i18n | FE+UX | Vitest/Playwright/browser/OpenAPI |
| MCU | `firmware/stm32` app/IOP/BSP/`.ioc` | FW MCU | host/cross-build/target/HIL |
| HW | controlled schematic/PCB/BOM/fixture/results | HW | pre-approved limits/raw instrument evidence |
| Package/Ops | `platform/packaging`, systemd, runbook/release manifest | Ops | upgrade/backup/restore/rollback/rehearsal |

Không sửa monolith/legacy path nếu bounded module đã được design. Mọi shared file
(`App.tsx`, bootstrap, ScanLoop, resolver, OpenAPI, packaging) có một integrator
được Dev Lead chỉ định để tránh parallel overwrite.

## 11. Definition of Ready/Done cho từng task

Task `READY` khi upstream gate PASS, requirement/design section/contract version
pin, owner/reviewer/estimate/target fixture rõ, negative/fault cases và rollback
defined. Task `DONE` chỉ khi:

1. deliverable source/contract/docs/changelog đã review và merge;
2. unit/static/contract/integration phù hợp PASS bằng command mới;
3. Trace cập nhật `I/T/P` đúng evidence, Risk impact xử lý;
4. no P0/P1 finding mở; compatibility/migration/partial deploy/rollback tested;
5. feature flag/capability default an toàn và không overclaim target/HIL.

Không lấy “code compile”, file tồn tại, test cache hoặc screenshot mock làm Done.

## 12. Gate evidence và rollback trigger

| Gate | Evidence tối thiểu | Rollback/stop trigger |
|---|---|---|
| G0 | 22 docs Approved, decisions closed, risk/trace/VVP signed | contract/semantics/HW authority còn OPEN |
| G1 | schema hashes, generated clients, migration/compat negative tests | breaking mismatch/unknown major accepted |
| G2 | Project→Check/bundle/RBAC/audit + FE editing flow | lost Draft, privilege bypass, compiler affects RT |
| G3 | target 10k cycles, WCET/jitter/IOP, no allocation/blocking | overrun/safe entry/graph dual owner |
| G4 | fault each lifecycle/power state, one active/LKG/read-back | double activation/partial output/ambiguous recovery |
| G5 | calibrated HIL 199/200/201, AO/DO/UI/power/reset | output outside envelope or evidence uncorrelated |
| G6 | upgrade/backup/restore/replacement/rollback/security/provenance | restore rehearsal fail, critical residual unaccepted |

Rollback design: disable mutation/capability first; Restore compatible LKG/graph;
verify physical output; rollback package only with controlled snapshot; preserve
DB/Revision/artifact/RETAIN/audit. Không downgrade Core qua active artifact/RETAIN
major mới.

## 13. Execution tracker và change control

| Gate | Owner | Status | Start/finish | Current blocker/evidence |
|---|---|---|---|---|
| `PLAN_READY` | Product+Architect+QA+Document Control | **OPEN** | 2026-08-09 / — | Consumer review của người thật; chữ ký `OD-PROG-015` |
| `IMPLEMENT_READY` | Product + Architect | **BLOCKED** | — | `PLAN_READY` + decision theo lát cắt (§3.2) |
| `RELEASE_READY` | Product + Release + QA | **BLOCKED** | — | 32/32 Test Result + residual acceptance + `OD-PROG-008` HIL |
| G0/P0 | Product+Architect+QA | BLOCKED | — | DOC-G4 approval, 17 decisions, HW/TLS authority |
| G1/P1 | Architect+BE+Core | NOT_STARTED | — | G0 |
| G2/P2+P5 partial | BE+FE+Compiler | NOT_STARTED | — | G1 |
| G3/P3 | Core+Controls | NOT_STARTED | — | P1/P2 |
| G4/P4+P5 | BE+Core+FE | NOT_STARTED | — | G3 |
| G5/P6 HIL | FW+HW+QA | NOT_STARTED | — | BSP/fixture + G3/G4 |
| G6/release | Product+Release+QA | NOT_STARTED | — | VS 32/32 + residual acceptance |

Mỗi session thực thi cập nhật task/gate, actual estimate, commit/PR, commands/
results, evidence ID, Risk/Trace/CHANGELOG. Contract/requirement/safety change tạo
impact analysis; hạ status downstream, invalidate test khi cần và xin approval
trước tiếp tục. Roadmap 54 theo dõi hồ sơ; Plan 53 theo dõi code/test/release,
không dùng hai bảng thay nhau.

## 14. Task card và vertical-slice handoff

Mỗi `TASK-PROG-nnn` trong §4 phải có card triển khai **đã điền thật**, không
để trống trường nào. Đây là việc của team trong giai đoạn `PLAN_READY`.

```text
1.  Task ID / pha / owner / reviewer / integrator của file dùng chung:
2.  Requirement, mục thiết kế, risk và decision liên quan:
3.  Contract / schema / version / hash đầu vào, và gate upstream:
4.  File, package, class, function cụ thể phải tạo hoặc sửa:
5.  Dependency cứng, và việc được phép chạy song song:
6.  Estimate, nguồn lực, milestone, trạng thái:
7.  Thuật toán, state, lỗi, restart, compatibility phải hiện thực:
8.  Unit / contract / integration / target / HIL test:
9.  Evidence ID và vị trí lưu:
10. Feature flag, thứ tự deploy, rollback:
11. DoR; DoD; người có quyền chấp nhận:
```

### 14.1 Thẻ mẫu đã điền — `TASK-PROG-101`

Một thẻ điền thật để team không phải đoán mức chi tiết. Thẻ này thuộc `G1`
(Contract), là lát cắt được phép làm sớm nhất sau khi `IMPLEMENT_READY` mở.

```text
1.  TASK-PROG-101 / pha P1 / owner BE Lead / reviewer Core Lead + FE Lead
    / integrator file dùng chung: Architect (sở hữu contracts/openapi/openapi.yaml)
2.  Requirement: SWR-REQ-PROG-BE-110, SWR-REQ-PROG-FE-110, NFR-REQ-PROG-106.
    Thiết kế: IFSPEC-PROG-001 §2 envelope, §3 resource, §6 Commission,
    §6.1 impact ba nhánh, §6.1.1 quy tắc acknowledgement, §9 error authority.
    Risk: RSK-PROG-014 (error namespace lệch), RSK-PROG-016 (mất bước an toàn).
    Decision: OD-PROG-001 (role), OD-PROG-003 (giới hạn) phải ký trước.
3.  Đầu vào: IFSPEC-PROG-001 v0.5 ghim theo commit hash của baseline docs;
    DM-PROG-001 v0.4. Gate upstream: PLAN_READY đóng + hai decision trên đã ký.
4.  Tạo: contracts/openapi/openapi.yaml nhóm /api/v1/programming;
    apps/web-api/internal/programming/http/{router,errors}.go;
    apps/web-api/internal/programming/domain/errors.go.
    Sinh: TS client cho apps/web-ui/src/features/programming/api/.
    Sửa: apps/web-api/internal/app/http.go (mount router, chưa bật flag).
5.  Dependency cứng: không có — đây là lát cắt đầu tiên sau G0.
    Song song được: FE dựng shell chỉ đọc và BE dựng store, cả hai chờ client
    sinh từ task này. Mutation FE **không** được nối ở lát này.
6.  Estimate 8 ngày-người: OpenAPI 3, handler skeleton 2, error catalog 1,
    sinh mã và contract test 2. Nguồn lực: 1 BE full-time + 0,5 Architect.
    Milestone: G1. Trạng thái: NOT_STARTED (chờ IMPLEMENT_READY).
7.  Hiện thực: envelope lỗi có code/messageKey/correlationId; 19 mã PRG-ERR-*
    trong §9 gồm 4 mã acknowledgement/impact mới; ba nhánh impact
    NONE/PRESENT/UNAVAILABLE với UNAVAILABLE fail-closed; validate
    acknowledgements == tập khóa PRESENT; kiểm impactRef và trả
    409 PRG-ERR-IMPACT-STALE-001 khi lệch. Restart: handler không giữ state.
    Compatibility: schema có version; unknown major bị reject.
8.  Unit: bảng ánh xạ mã lỗi, validator acknowledgement (thiếu/thừa/rỗng).
    Contract: OpenAPI ↔ handler ↔ TS type sinh ra khớp nhau.
    Integration: bốn tổ hợp status của impact.
    Target/HIL: không áp dụng ở lát này.
9.  Evidence: TR-PROG-G1-101 tại docs/07_records/test-results/programming/
    TR-PROG-G1-101/ gồm result.md, output contract test, SHA256SUMS.
    Đóng góp Test Result cho VS-PROG-001 (phần contract) và VS-PROG-019.
10. Feature flag PROGRAMMING_REV_A mặc định OFF; route mount nhưng trả 404 khi
    flag OFF. Thứ tự deploy: BE trước, TS client theo sau trong cùng release.
    Rollback: gỡ mount router; không có dữ liệu bền vững nên không cần migration.
11. DoR: hai decision đã ký, IFSPEC v0.5 đã ghim hash, môi trường sinh mã chạy được.
    DoD: contract test PASS, TS type sinh ra biên dịch được, 19 mã lỗi khớp §9,
    CHANGELOG cập nhật, Trace đổi trục I cho BE-110.
    Người chấp nhận: Architect (contract) + Verification Lead (evidence).
```

**Chưa được thực thi.** Thẻ trên là mẫu lập kế hoạch; `TASK-PROG-101` đang
`NOT_STARTED` và bị chặn bởi `IMPLEMENT_READY`.

Vertical slice **không** bàn giao bằng “FW-SOM xong”, “BE xong” hay “FE xong”.
Mỗi mốc phải tạo một outcome đầu-cuối **quan sát được** — Project/Draft, Check,
Commission, Runtime hoặc Restore — và outcome đó phải ánh xạ về journey người
dùng ở [Product Spec §9](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md):

| Slice | Journey phủ | Outcome đầu-cuối | Bằng chứng tối thiểu |
|---|---|---|---|
| S1 Project/Draft | `UJ-PROG-01`, `UJ-PROG-02` | hai client save/conflict/restart không mất dữ liệu | DB/API/TS contract + FE state |
| S2 ST/FBD Check | `UJ-PROG-02`, `UJ-PROG-03`, `UJ-PROG-04`, `UJ-PROG-05` | canonical Revision → deterministic diagnostic/artifact; Active không đổi | golden/fuzz/resource + UI Problems |
| S3 Stage/Commission | `UJ-PROG-06` | operation durable → Core safe swap/read-back; timeout reconcile; acknowledgement khớp impact `PRESENT` | restart/fault/target trace + contract âm |
| S4 Control runtime | `UJ-PROG-07` | one Task/process image/priority/PID/quality bounded | 10k-cycle/WCET/arbitration/IOP |
| S5 Restore/RETAIN | `UJ-PROG-08` | power/restart/corrupt/migrate giữ đúng active/LKG | journal/record/power fault evidence |
| S6 Replacement/Ops | `UJ-PROG-08` | source-only import → rebuild/remap/Commission/rollback | security + rehearsal + HIL record |

## 15. Lịch sử và phê duyệt

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | P0–P6, task 000–606, RACI và gate baseline |
| 0.2 | 2026-08-09 | Thêm entry/DoR/DoD, estimate, source ownership, gate evidence/rollback/tracker M3 |
| 0.3 | 2026-08-09 | Bổ sung task-card schema và sáu vertical-slice outcome/evidence handoff; chuyển Detailed Draft chờ planning review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại Implementation Plan; G0 giữ RED |
| 0.5 | 2026-08-09 | Amendment A1: thêm §15.1 chia pha P5 thành sáu lát cắt dọc `S5-A..F` theo bốn workspace và tám journey, kèm điều kiện vào/xong và hai điểm bị chặn ngoài G0 |
| 0.6 | 2026-08-09 | Đóng review chặn phê duyệt: banner `PLAN-ONLY`; §3.1 tách ba cổng `PLAN_READY`/`IMPLEMENT_READY`/`RELEASE_READY`; §3.2 decision theo từng lát cắt; §3.3 roadmap `G0..G6` phân bổ đủ 32 Test Result; sửa dependency chain `P5` sang bốn workspace/tám journey; cập nhật 17 decision |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Dev Lead + tất cả discipline leads | Chờ review | — |
| Product + System Architect + Verification | **BLOCKED — chưa phê duyệt** | G0 RED, 0/22 M5, 17 decisions OPEN |

## 15.1 Vertical slice theo bốn workspace và tám journey

Sau Amendment A1, pha `P5 — FE/UX` được chia theo **workspace**, không theo
trang. Mỗi lát cắt dọc phải chạy được end-to-end trước khi mở lát tiếp theo.

| Lát cắt | Workspace | Journey | Điều kiện vào | Xong khi |
|---|---|---|---|---|
| `S5-A` | `PGM-01` Tổng quan | `UJ-PROG-01` | `GET /capabilities`, `GET /projects`, `GET /runtime` đã có trên target | Nhận biết Active/Draft/Core `≤5 s`; 0 giá trị bịa; `VS-032` phần route gốc đạt |
| `S5-B` | `PGM-02` Thiết kế | `UJ-PROG-02/03/04` | `PATCH /draft` và `GET /point-catalog` đã có | Ba tab dùng chung một Draft; đổi tab không mất nội dung đang gõ; FBD hoàn tất bằng bàn phím; lọc Point theo loại/hướng/khả năng ghi |
| `S5-C` | `PGM-03` Kiểm tra & Vận hành | `UJ-PROG-05/06` | Check API và `POST /operations/commission` đã có; impact trả đủ ba nhánh `NONE/PRESENT/UNAVAILABLE` | Ô xác nhận khớp ảnh hưởng thật; `UNAVAILABLE` chặn được Commission; re-auth + đọc ngược + quay lui còn nguyên |
| `S5-D` | `PGM-04` Runtime & Bảo trì | `UJ-PROG-07/08` | `GET /runtime/monitor`, `GET /overrides`, `POST /operations/restore` đã có | Tách program/actual/owner/priority/TTL; vùng thao tác nguy hiểm tách riêng; người xem không thấy dãy nút vô hiệu hóa |
| `S5-E` | Xuyên suốt | ba kịch bản `SC-*` | `S5-A..D` xong | `SC-CORE-DEGRADED`, `SC-OP-FAILED`, `SC-RETAIN-RESET` đúng ở mọi workspace |
| `S5-F` | Nghiệm thu khả dụng | tất cả | `S5-A..E` xong, có fixture `AHU-01` trên controller lab | `VS-PROG-031` đạt sáu ngưỡng `UX-A-01..06` với `≥5` kỹ thuật viên BMS |

Thứ tự bắt buộc là `A → B → C → D → E → F`. Lý do: `PGM-03` phụ thuộc Draft hợp
lệ do `PGM-02` tạo ra, và bài khả dụng chỉ có nghĩa khi cả tám journey đã chạy
được. Riêng `S5-F` **không được** rút gọn thành demo nội bộ — nó cần người dùng
thật chưa từng dùng sản phẩm.

Hai lát cắt này bị chặn ngoài `G0`: `S5-C` cần `IFSPEC-PROG-001` §6.1 được ký,
và toàn bộ `P5` cần `OD-PROG-016` được phê duyệt. Nếu `OD-PROG-016` bị từ chối,
`P5` quay lại năm lát cắt theo IA sáu trang và `S5-B` tách làm ba.

## 16. Phụ lục — Tự kiểm cổng M3 (loại: Implementation Plan)

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Điều kiện vào và ra | PASS | §8 entry criteria; §4 từng pha `P0..P6` có exit; §12 bằng chứng gate |
| Phụ thuộc | PASS | §3 chuỗi phụ thuộc; §14 bàn giao theo lát cắt dọc |
| Owner và RACI | PASS | §5 RACI; §10 quyền sở hữu source theo pha |
| Sản phẩm bàn giao | PASS | §9 work breakdown; §10 deliverable map; §14 mẫu thẻ task; §15.1 sáu lát cắt dọc của P5 |
| Test và bằng chứng | PASS | §12 gắn từng gate với `VS-PROG-*` và bằng chứng bắt buộc |
| Change control | PASS | §6 quy tắc commit/PR; §13 tracker thực thi và kiểm soát thay đổi |
| Deploy và rollback | PASS | §12 điều kiện kích hoạt quay lui theo từng gate |
| Không mở gate bằng lời văn | PASS | §11 Definition of Ready và Definition of Done cụ thể cho từng task; §2 nguyên tắc triển khai |
| `BLOCKED` có owner/gate | **BLOCKED** | §7: `G0` đang `RED`. Owner: Product Owner + System Architect + Verification Lead. Ảnh hưởng: **không pha nào được bắt đầu**, kể cả P1. Gate: `G0`. Điều kiện mở: 22 hồ sơ đạt M5 và 15 `OD-PROG-*` đóng — cụ thể là `OD-PROG-015` |

Kế hoạch đã sẵn sàng để thực thi, nhưng **chưa được phép thực thi**.
