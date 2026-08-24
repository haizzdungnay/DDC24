# PGM-02 Workspace ST/FBD — Detailed Design Target MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-SW-PGM02-WORKSPACE-001` |
| Phiên bản | 0.3 |
| Trạng thái | **`M3 — REVIEW READY / AUTHORIZED FOR IMPLEMENTATION`; chưa phải M4/M5 hoặc As-Built** |
| Ngày | 2026-08-24 |
| Chủ quản đề xuất | System Architecture + Programming Cross-functional Team |
| Người review bắt buộc | Product, System Architect, FE, BE, Compiler, Core/Runtime, Security, QA/V&V, UX, Document Control |
| Người phê duyệt | Product Owner/CTO + System Architect |
| Authority work package | `CR-PROG-PGM02-V22-001`; `T59-801` / `PGM02-V22-WP-00` |
| Disposition authority | `AUTH-PROG-2026-08-24-05`: Product Owner/CTO + System Architect pin exact Candidate `413a043748dce3b44d2c5076412de761760ba17a` và mở implementation |
| Nguồn baseline hiện hành | `PROD-PROG-001` v3.0; `ADR-050`; `SRS-PROG-001`; `ARCH-PROG-001`; `DDD-SW-PROG-UNIFIED-001`; `UX-WEB-PROG-001`; `PLAN-PROG-059` |
| Requirement canonical liên quan | Target: `SYS-REQ-PROG-116`, `SWR-REQ-PROG-FE-119`, `SWR-REQ-PROG-BE-116..117`, `SWR-REQ-PROG-CORE-117..118`, `NFR-REQ-PROG-112`; requirement baseline hỗ trợ: `SYS-REQ-PROG-102/104/106/109/110/113`, `SWR-REQ-PROG-FE-101..104/109..111/116`, `SWR-REQ-PROG-BE-101..104/107/109..112/114/115`, `SWR-REQ-PROG-CORE-101/103/110/111` |
| Design obligation nội bộ | `DDO-PGM02-001..015` — Target trong hồ sơ này, không phải canonical SRS requirement |
| Phạm vi | Target cho PGM-02 ST/FBD theo thứ tự `R1 EDIT → R2 LIVE → R3 SIMULATE`; trao quyền code theo dependency, không trao quyền deploy site hoặc release |
| Baseline inventory | Git `1bc3d19e96989c1309f838c0acd01d14d8536d5e` dùng để đối soát source; **không** phải exact-hash pin của Architect |
| Evidence class | Thiết kế M3 và source inspection; không phải bằng chứng runtime, target/HIL, physical I/O hoặc Test Result |
| Gate hiện hành | `PLAN_READY[PGM02-V22]=PASS`; `IMPLEMENT_READY[PGM02-R1|PGM02-R2|PGM02-R3]=GO`; execution bắt buộc R1→R2→R3; `RELEASE_READY=NO-GO` |

> Hồ sơ này là đầu ra thiết kế đã được pin của `T59-801` /
> `PGM02-V22-WP-00`. Mọi từ “Target”, “phải” hoặc “sẽ” dưới đây mô tả hợp đồng
> được phép implement, không mô tả chức năng đã triển khai. `AUTHORIZED FOR
> IMPLEMENTATION` không thay consumer review, Test Authority hoặc Release
> Authority và không được dùng để nâng giả M4/M5 hay Test Result.

Tài liệu chỉ dùng work-package ID canonical `PGM02-V22-WP-00..13`; không dùng
alias ngắn `WP-00..13` làm authority.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt Target chi tiết đã được phép implement cho một PGM-02 workspace có ba increment độc lập: R1 soạn ST/FBD trên Saved Draft, R2 xem LIVE read-only theo đúng Active Revision, R3 chạy SIMULATE trong worker cách ly không có đường ra physical output. |
| 2. Ai phải đọc file này? | FE/BE/Compiler/Core/Security để implement và hậu kiểm boundary; QA/V&V để tạo/chạy test; UX để đối chiếu asset; Document Control để giữ revision/hash. |
| 3. Hệ thống hiện tại đang có gì? | Draft v2 nội bộ và PATCH Draft; SYSTEM/PROJECT Library; compiler ST/FBD; runtime/monitor/trace; FE POU tree, ST editor và FBD structured renderer. OpenAPI vẫn dùng Draft/diagnostic generic, Library chưa chiếu signature chuẩn, rename chưa semantic, chưa có references API, coherent LIVE join hoặc Simulation session/worker. Chi tiết §2. |
| 4. Thiết kế mới thay đổi điều gì? | Thêm identity typed, route resolver, typed Draft/OpenAPI, signature projection, semantic refactor/reference index, diagnostic anchors; sau đó coherent LIVE join; cuối cùng Simulation session cách ly, admin-only mutation, virtual time deterministic. |
| 5. Team phải sửa module hoặc contract nào? | `contracts/openapi/openapi.yaml`, contract/generator Programming, Go domain/application/store/HTTP, Core compiler/runtime và worker mới, React Programming workspace, systemd isolation, test/evidence. File map cụ thể ở §9. |
| 6. Điều gì còn bị chặn? | Không còn blocker authority để viết code. R1 contract/source, R2 lifecycle/Trace coherence và R3 worker/isolation chưa được implement/verify; U13–U15, target/HIL và residual risk còn chặn verdict/release. Owner/gate/evidence ở §12. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | `TC-PGM02-*` và `V-PGM02-*` ở §10, tách Host/Browser/Target/HIL/physical-I/O. Không increment nào được bật chỉ bằng docs hoặc host tests. |

### 0.1 Quy tắc đọc trạng thái

- **As-Built**: chỉ điều đã xác minh trực tiếp trong source/contract tại inventory.
- **Target approved for implementation**: thiết kế được phép dùng để code nhưng chưa phải As-Built, M4/M5 hoặc evidence.
- **TBD/BLOCKED**: chỉ hợp lệ khi có owner, ảnh hưởng, gate và điều kiện mở.
- **R1/R2/R3** có capability, feature flag, verification và verdict riêng; R1
  hoàn tất không làm R2/R3 thành available.
- `null`, `UNAVAILABLE`, stale, offline hoặc unknown không được hiển thị thành
  `0`, `false` hoặc dữ liệu minh họa như dữ liệu thật.

### 0.2 Tài liệu nguồn

- [DOC-GOV-001](../../00_governance/DOC_GOVERNANCE.md) và
  [TEMPLATE_DDD](../_templates/TEMPLATE_DDD.md).
- [PROGRAMMING_OPEN_DECISIONS](../../00_governance/PROGRAMMING_OPEN_DECISIONS.md),
  [PROGRAMMING_DOCUMENT_READINESS_MATRIX](../../00_governance/PROGRAMMING_DOCUMENT_READINESS_MATRIX.md)
  và [PLAN-PROG-059](../../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md).
- [Product Spec](../../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md),
  [SRS](../../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md),
  [Architecture](../../03_architecture/PROGRAMMING_ARCHITECTURE.md) và
  [Unified DDD](PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md).
- [UX baseline Active](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md),
  [PGM-02 handoff](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md),
  [PGM-02A ST](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02A_ST_EDITOR_FE_HANDOFF_v2_2.md),
  [PGM-02B FBD](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md)
  và [Quick Library/LIVE/SIMULATE Candidate](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md).
- Machine-readable Candidate:
  [pgm02_workspace_v1.json](../../../contracts/programming/pgm02_workspace_v1.json)
  và [schema](../../../contracts/programming/pgm02_workspace_v1.schema.json).

## 1. Mục tiêu, actor và phạm vi — `DD-02`

### 1.1 Outcome

Một kỹ sư không tham gia thiết kế phải có thể triển khai và kiểm chứng từng lát
cắt mà không tự suy identity, source authority, quyền mutation, state lỗi hoặc
đường output:

1. **R1 EDIT**: chọn một typed POU bằng `objectId`; sửa Saved Draft ST/FBD;
   insert từ Quick Library có signature authoritative; rename/delete semantic;
   Check trả anchor chính xác.
2. **R2 LIVE**: mở đúng source của immutable Active Revision và chỉ ghép value
   khi toàn bộ document/value tuple đồng nhất; mọi mismatch thành
   `RECONCILING` hoặc `UNAVAILABLE`.
3. **R3 SIMULATE**: tạo worker ephemeral từ immutable Saved-Draft snapshot; chỉ
   admin mutation; virtual time deterministic; không có handle hoặc quyền tới
   production SHM, device, socket, output writer hay RETAIN.

### 1.2 Actor và use case

| Actor | R1 EDIT | R2 LIVE | R3 SIMULATE |
|---|---|---|---|
| `viewer` | Đọc tree/source/diagnostics/library metadata | Đọc source/value/Watch/Trace | Đọc session/snapshot/trace đã được object-scope cho phép |
| `operator` | Như viewer; không mutation Draft | Như viewer; không force/override | Như viewer; không create/action/input/stop |
| `admin` | Save/check/insert/refactor Draft theo ETag | Vẫn read-only trong workspace LIVE | Create/run/pause/step/reset/speed/input/stop; server audit từng mutation |
| Product/System Architect | Review/pin requirement, route, contract, risk và hash | Review coherent-source/value boundary | Review sandbox/zero-output boundary |
| QA/V&V | Host/contract/browser evidence R1 | Producer→IPC→BE→FE→read-back, concurrency/fault | Isolation/RBAC/determinism/quota/target/HIL |

### 1.3 Trong phạm vi

- Canonical route, legacy redirect và deep-link resolver.
- `objectId`, `programId`, document tuple và value tuple.
- Typed Draft v1/v2 compatibility; POU identity; SYSTEM/PROJECT Library signature.
- Reference discovery, atomic semantic rename và delete fail-closed.
- ST/FBD diagnostic anchor có stable UUID.
- Mode state/guard, LIVE coherent join, Watch/Trace revision pin.
- Simulation capability/API/session/worker/isolation/RBAC/audit/virtual input/
  virtual time/resource/fault/restart/expiry.
- FE component/state/responsive/a11y và renderable asset dependency.
- Repo mapping, flags, deployment, rollback, requirement→test và evidence class.

### 1.4 Ngoài phạm vi

- Online patch, force value, override, Commission, Restore, Retain Reset hoặc
  thay đổi output từ PGM-02.
- Simulator chạy trong browser hoặc trong process Core/Web API production.
- Step một Program riêng; arbitrary period/speed; distributed/multi-controller
  simulation; persistence/replay session sau reboot.
- Tạo ngôn ngữ/POU kind/type mới ngoài profile đang pin.
- Claim target/HIL/physical-I/O/release PASS trong `PGM02-V22-WP-00`.
- Sửa production source, OpenAPI Active, feature flag hoặc deploy trong task
  `T59-801`.

### 1.5 Constraint và bất biến

1. Thứ tự mở gate cố định: `R1 EDIT → R2 LIVE → R3 SIMULATE`.
2. Draft/Check không thay đổi Active control; LIVE và SIMULATE không có physical
   output authority.
3. `objectId` không bao giờ được suy từ `programId` hoặc name.
4. Library SYSTEM là registry generated, read-only; FE không duy trì signature
   thay thế.
5. Semantic analysis không chắc chắn thì rename/delete **zero mutation**.
6. FBD giữ `nodeId/portId/wireId`, layout và canonical port `order`; FB layout
   dùng canonical name order.
7. Mọi mutation dùng server RBAC; FE affordance không phải authority.
8. R2/R3 mismatch hoặc deploy không đồng bộ phải fail closed bằng capability
   false/`UNAVAILABLE`.

### 1.6 Tiêu chí thành công theo increment

| Increment | Điều kiện thành công tối thiểu | Điều kiện không đủ |
|---|---|---|
| R1 | Contract typed + generated clients đồng bộ; semantic reference/refactor; exact anchors; FE read-back; positive/negative/fault tests | Chỉ render panel/canvas; chỉ unit FE; rename metadata-only |
| R2 | Active source/value tuple coherent qua producer→IPC→BE→FE; monotonic sequence; stale/offline/mismatch tests; Trace pin | Dùng Revision “gần nhất”; hiển thị last-known như current; browser mock |
| R3 | Worker cách ly; admin-only mutation/audit; deterministic step; quota/expiry/restart; zero-output target/HIL evidence | Host harness `programming_core_sim_main.cpp`; browser-only simulation; process cùng Core |

## 2. As-Built và khoảng trống — `DD-03`

Inventory sau đây là source inspection tại commit `1bc3d19...` cộng các file
Candidate đang được tạo trong cùng change-set. File Candidate không được nâng
thành As-Built runtime.

| Nội dung | As-Built 2026-08-24 | Gap so với Target |
|---|---|---|
| Route PGM-02 | [`ProgrammingRoutes.tsx`](../../../apps/web-ui/src/features/programming/ProgrammingRoutes.tsx), `PROGRAMMING_WORKSPACE_PATHS.programs = projects/:projectId/programs`; Unified DDD/UX Active cùng dùng route theo project | Target đã pin dùng `/eng/programming/programs?project=...`; resolver/redirect và tests chưa được implement |
| Workspace shell | [`DesignWorkspacePage.tsx`](../../../apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx), `DesignWorkspacePage` mount POU tree/editor; diagnostics hiện truyền `EMPTY_DIAGNOSTICS` | Chưa có state machine EDIT/LIVE/SIMULATE và coherent data controller |
| Typed POU tree | [`PouTree.tsx`](../../../apps/web-ui/src/features/programming/design/PouTree.tsx), Draft v2 model và nhóm PROGRAM/FUNCTION/FUNCTION_BLOCK | Deep-link/selection target phải khóa `objectId`; duplicate/navigation/refactor chưa có cross-reference contract đầy đủ |
| Draft mutation | [`draft.go`](../../../apps/web-api/internal/programming/application/draft.go), `applyDraftOperations` migrate v1→v2 rồi validate; [`draft_v2.go`](../../../apps/web-api/internal/programming/application/draft_v2.go), `applyDraftOperationV2` hỗ trợ upsert/remove/rename/duplicate object/program/signal/binding/variable/task | OpenAPI vẫn là `ProgrammingResource` và operation generic; chưa có discriminated typed schemas/read-back v2 |
| Draft concurrency | [`projects.go`](../../../apps/web-api/internal/programming/application/projects.go), Save Draft dùng ETag/idempotency và trả read-back | Cần giữ nguyên, pin `If-Match`/baseRevisionId/content hash trong typed contract |
| POU identity | `pouObjectPayload` và `upsertProgramConfig` tách `objectId`/`programId`; `validateDraftDocumentV2` kiểm UUID/kind/name | Chưa có public typed identity; semantic source references chưa được validate đầy đủ |
| Rename | `renamePouObject` chỉ đổi metadata name | Compiler [`st_compile_main.cpp`](../../../apps/core/application/st/st_compile_main.cpp) từ chối source declaration name/kind lệch manifest; rename hiện có thể tạo Draft không compile |
| Delete | `removePouObject` kiểm Program config references | Chưa block toàn bộ resolved ST call/FBD typeRef/library/reference; không có preflight references API |
| SYSTEM Library store | [`library.go` domain](../../../apps/web-api/internal/programming/domain/library.go), `SystemLibraryEntries` kiểm registry/hash và giữ `SignatureJSON` | Application [`library.go`](../../../apps/web-api/internal/programming/application/library.go) không chiếu `SignatureJSON` ra public response |
| Library OpenAPI | [`openapi.yaml`](../../../contracts/openapi/openapi.yaml), `ProgrammingLibraryEntry` có `interface` generic, kind/name/version/hash/state layout | Thiếu normalized authoritative signature, ports/order/type constraints/state rõ ràng; FE registry generated không được là fallback |
| ST call graph | [`st_pou_registry.hpp`](../../../apps/core/application/st/st_pou_registry.hpp), `StCallEdge`; [`st_pou_registry.cpp`](../../../apps/core/application/st/st_pou_registry.cpp) resolve/sort call edges theo name | Không expose qua BE; chưa dùng stable objectId; không đủ làm reference/rename contract |
| Check/diagnostic | [`runner.go`](../../../apps/web-api/internal/programming/compiler/runner.go), `SourceID` là object/source-map còn `ProgramID` là runtime; [`checks.go`](../../../apps/web-api/internal/programming/application/checks.go) trả location generic | OpenAPI `ProgrammingDiagnostic.location` là `ProgrammingResource`; trường legacy `programId` đang mang source identity và dễ join sai |
| FBD anchor | [`st_fbd_compile.hpp`](../../../apps/core/application/st/st_fbd_compile.hpp), `FbdSourceAnchor` có network/node/port; [`st_fbd_model.hpp`](../../../apps/core/application/st/st_fbd_model.hpp), `FbdIssue` chủ yếu code/path | Compile failure có thể mất UUID anchor; chưa có wireId/typed public location |
| ST editor | [`ProgramsTab.tsx`](../../../apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx) và source editor hiện có | Quick Library insertion atomic/one-undo, reference panel và exact diagnostic navigation chưa hoàn chỉnh |
| FBD model/editor | [`model.ts`](../../../apps/web-ui/src/features/programming/fbd/model.ts), [`commands.ts`](../../../apps/web-ui/src/features/programming/fbd/commands.ts), [`StructuredFbdEditor.tsx`](../../../apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx) | Model/commands typed nhưng renderer hiện là structured card/list, chưa chứng minh node-edge canvas/ports/wires/zoom/pan theo asset Target |
| Runtime source/value | OpenAPI có `GET /programming/runtime`, `/runtime/monitor`, `/runtime/signals`, `GET /revisions/{revisionId}` | Chưa có contract join document/value tuple, contentHash, observationId và monotonic snapshot sequence end-to-end |
| Watch/Trace | Router có create/read/stop Trace; application có monitor/trace tests | Chưa chứng minh Trace pin cùng activeRevisionId/artifactHash dưới concurrent cutover; không được nối trace khác revision |
| Simulation | [`programming_core_sim_main.cpp`](../../../apps/core/application/programming/programming_core_sim_main.cpp) là host integration harness | Không phải product session; chưa có capability/API/store/worker/sandbox/RBAC/audit/quota/expiry/zero-output proof |
| Capability | `GET /programming/capabilities` trả profile/language/type/limits/taskPeriods | Chưa có workspace increment/capability version, LIVE coherence state hoặc Simulation support flag |
| API/client pin | HTTP router hiện có 33 Programming operations; FE generator và G1 join pin số này | R1 references route làm operation count thành 34; mọi pin/generator/consumer phải đổi atomic, không chỉnh tay FE |
| Visual authority | Ba SVG combined/ST/FBD và manifest v2.2 hiện có trong exact Candidate; asset baseline desktop/mobile cũng hiện có | Asset đã được pin cho implementation; consumer review được waive cho entry nhưng browser/a11y/runtime evidence chưa có |

### 2.1 Phân loại capability, không trộn FE với BE/Core

| Capability | FE hiện có | BE/Core hiện có | Kết luận `PGM02-V22-WP-00` |
|---|---|---|---|
| Typed Draft/POU | Model/tree đọc v2 | Internal v2 mutation/validation | **Partial**; public contract generic |
| Quick Library | Palette/generated registry rời rạc | SYSTEM registry/store | **Partial**; thiếu signature projection authoritative |
| References/refactor | Presentation cục bộ | Call edges theo name, rename metadata | **Missing** ở contract semantic end-to-end |
| Diagnostic anchors | ST location cơ bản | Source line/column; FBD anchor nội bộ | **Partial**; thiếu typed union/stable UUID |
| LIVE | Một số runtime overlay/Watch UI | Runtime/monitor/signals/Trace routes | **Partial**; coherence chưa chứng minh |
| SIMULATE | Chưa có product surface | Chỉ host harness | **Missing** product capability |

## 3. Thiết kế mục tiêu và quyền sở hữu — `DD-04`

### 3.1 Increment và dependency

```text
AUTH-PROG-2026-08-24-05
  └─ T59-801 / PGM02-V22-WP-00: DONE — exact Candidate pinned
       └─ R1 EDIT: T59-802 READY; T59-803..809 ORDERED
          / PGM02-V22-WP-01..06 + WP-10..13 (phần R1)
            └─ R2 LIVE: T59-810..813 ORDERED after R1
               / PGM02-V22-WP-09 + PGM02-V22-WP-06
               + PGM02-V22-WP-10 + PGM02-V22-WP-11
               + PGM02-V22-WP-12 + PGM02-V22-WP-13 (phần LIVE)
                 └─ R3 SIMULATE: T59-814..817 ORDERED after R2
                    / PGM02-V22-WP-07 + PGM02-V22-WP-08
                    + PGM02-V22-WP-06 + PGM02-V22-WP-10
                    + PGM02-V22-WP-11 + PGM02-V22-WP-12
                    + PGM02-V22-WP-13 (phần SIM)
```

`T59-801` đã `DONE`; `T59-802` là task `READY`. `T59-803..817` đã có execution
authority nhưng giữ `ORDERED` theo prerequisite; scheduler không được bắt đầu
R2 trước closeout R1 hoặc R3 trước closeout R2. Việc ba `IMPLEMENT_READY=GO`
không đồng nghĩa chạy đồng thời ba increment.

### 3.2 Ownership theo boundary

| Boundary/state có thể đổi | Owner duy nhất | Input | Output/consumer | Failure boundary |
|---|---|---|---|---|
| Saved Draft + ETag | BE Programming store/application | Admin mutation typed | FE read-back, Check | Transaction DB; lỗi trước commit zero mutation |
| POU semantic graph | Compiler/BE refactor service | Snapshot Draft v2 | References, rename/delete, diagnostics | Analysis unavailable → no mutation |
| SYSTEM registry | Compiler/registry generator | Canonical registry | BE projection, FE Quick Library | Hash/signature mismatch → UNAVAILABLE |
| Editor selection/layout | FE workspace store | Route + Draft objectId | ST/FBD editor | Không đổi BE/runtime |
| Active Revision identity | Core runtime + immutable Revision store | Commissioned artifact | R2 join controller | Web/FE không được tự chọn “latest” |
| LIVE observation stream | Core producer qua IPC/BE | Active pin + runtime samples | FE keyed overlay/Watch/Trace | Producer/IPC/tuple mismatch → UNAVAILABLE; control tiếp tục độc lập |
| Simulation session record | BE simulation service/store | Saved snapshot + admin command | FE read-back/audit | Worker crash không lan sang Core/Active |
| Virtual clock/process image | Một worker riêng mỗi session | Sealed artifact + virtual inputs | Session observation/trace | Không có production handle; process bị kill khi quota/fault |
| Physical output/RETAIN production | Core/iobus production | Chỉ approved runtime path | Hardware/control | **Không** là consumer của PGM-02 Simulation |

### 3.3 Process/thread/deployment Target

```text
Browser React
  │ HTTPS/JSON + ETag/Idempotency-Key
  ▼
mkddc-web-pi (Go)
  ├─ Draft/Library/References/Check ── SQLite + immutable artifact store
  ├─ LIVE read adapter ─────────────── Core IPC (read-only)
  └─ Simulation supervisor
       │ private bounded IPC; per-session token
       ▼
mkddc-programming-sim-worker (ephemeral, dedicated UID/cgroup/seccomp)
       ├─ production compiler/artifact loader semantics
       ├─ private scheduler + virtual monotonic clock
       ├─ private point/signal/RETAIN image
       └─ private bounded observation/trace

PROHIBITED from sim-worker:
  production SHM, /dev, fieldbus/iobus/Core-control sockets,
  OutputWriter, production RETAIN/journal, network capability.
```

- Core control thread không chờ Web API, FE hoặc simulation worker.
- BE supervisor giao tiếp worker bằng private socket/pipe được tạo sau sandbox;
  command timeout 2.000 ms, payload bounded và sequence-checked.
- Worker không được chạy như thread/library trong `mkddc-core` hoặc
  `mkddc-web-pi`. Process crash chỉ chuyển session thành `FAILED`.
- Cơ chế OS cụ thể phải được Security/Runtime pin cho target Linux
  (dedicated UID, không supplemental group, network namespace/`PrivateNetwork`,
  capability drop, seccomp/SystemCallFilter, rlimit/cgroup, read-only FS).

### 3.4 Canonical route và resolver Target

Canonical route Candidate:

```text
/eng/programming/programs?project=<uuid>&pou=<objectId>&mode=EDIT|LIVE|SIMULATE
```

Legacy entry:

- `/eng/programming/projects/:projectId/programs`
- `/eng/programming/projects/:projectId/design`

Redirect phải giữ các query `program`, `pou`, `mode`, `line`, `column`,
`length`, `node`, `port`, `edge`, `returnTo`; chuyển `:projectId` thành
`project` và dùng `replace` để không tạo
history loop.

| Trạng thái Project | Resolver | Kết quả |
|---|---|---|
| Không có Project | Không tự tạo nếu không có quyền | Empty create CTA cho admin; read-only empty cho vai trò khác |
| Có đúng một Project, thiếu query | Canonicalize | `replace` sang canonical route có `project` |
| Có nhiều Project, thiếu query | Không đoán Project gần nhất | Project chooser; chưa mount editor/runtime |
| Query Project không tồn tại/không có scope | Không fallback | Not found/permission; không mở Project khác |
| `pou` không thuộc Project | Không fallback theo name/index | Clear selection + stable not-found state |
| `mode` invalid/unsupported | Không tự giả lập | EDIT nếu query vắng; invalid thì error; unsupported thì UNAVAILABLE |

Conflict với route Active hiện hành là blocker `OD-PGM02-V22-002`, không được
cutover trước exact-hash pin và test redirect.

### 3.5 Identity contract

| Ngữ cảnh | Identity authoritative | Cấm dùng thay thế |
|---|---|---|
| POU trong Draft/Revision/editor | `objectId` UUID | name, array index, programId |
| Runtime scheduled Program | `programId` UUID | objectId, source name |
| Library entry | `scope + entryId + version + contentSha256` | display name |
| ST/FBD source document | `(projectId, revisionId, objectId, contentHash)` | latest Revision |
| Runtime value | `(controllerId, activeRevisionId, programId, observationId, snapshotSequence, observedAt, quality)` | signal name hoặc last value |
| Simulation session | `sessionId + sessionSequence + sourceContentHash` | process PID hoặc browser tab |

Mapping `objectId↔programId` chỉ tồn tại cho POU kind PROGRAM trong sealed
Revision manifest và phải unique. FUNCTION/FUNCTION_BLOCK không được cấp
`programId` chỉ để phục vụ UI. Diagnostic source anchor luôn dùng `pouObjectId`.

## 4. Mô hình dữ liệu từng field — `DD-05`

### 4.1 Draft/POU/Program

| Field | Type | Unit | Required | Default | Range/Enum | Null/Unknown | Key/Index/FK | Validation | Lifecycle | Version/Migration |
|---|---|---:|---|---|---|---|---|---|---|---|
| `schemaVersion` envelope | string | — | có | — | `"1.0"` | không null | contract discriminator | exact | mỗi request | tách khỏi content version |
| `document.schemaVersion` | integer | — | có | 2 sau first write | 1 hoặc 2 khi đọc; 2 khi response mutation | không null | content discriminator | deterministic migration | Draft lifetime | v1 đọc; first write v1→v2 atomic |
| `projectId` | UUID | — | có | — | UUID v4 | không null | PK/FK Project | scope + ownership | Project lifetime | không đổi |
| `draftRevisionId` | UUID | — | có | server | UUID | không null | Draft identity/FK | thuộc Project | đổi khi seal theo domain | existing |
| `baseRevisionId` | UUID | — | có khi mutation | — | UUID | không null | optimistic base | khớp current base | request lifetime | existing |
| `etag` | string | — | header/response | server | bounded opaque | không null | concurrency token | exact `If-Match` | mỗi commit | existing |
| `contentSha256` | hex string | — | response/reference | server | 64 lowercase hex | không null | content identity/index | canonical bytes | mỗi commit | target additive |
| `objectId` | UUID | — | có | generated server/client per contract | UUID v4 | không null | POU PK | unique trong Project | giữ qua rename/duplicate tạo ID mới | v2 |
| `kind` | enum | — | có | — | PROGRAM/FUNCTION/FUNCTION_BLOCK | không null | discriminator | source declaration phải khớp | giữ qua rename; đổi kind không hỗ trợ | v2 |
| `name` | string | — | có | — | canonical IEC name, 1..64 | không null/empty | unique normalized trong Project | parser + NFC/case policy pin | semantic rename atomic | v2 |
| `language` | enum | — | có | ST | ST/FBD | không null | — | profile supports | POU lifetime | v2 |
| `source` | string/object | byte | có theo language | valid template | ST ≤65.536 byte hoặc canonical FBD | không null; empty invalid | thuộc objectId | parser/model/limits | Draft mutable, Revision immutable | typed union target |
| `programId` | UUID | — | có cho Program config | generated | UUID v4 | null/absent cho FUNCTION/FB | runtime PK + FK objectId | unique; only PROGRAM | giữ qua rename | v2 |
| `periodMs` | integer | ms | có cho scheduled Program | policy | 1000/5000/30000 | không đoán khi unknown | scheduler config | profile enum | Draft→sealed manifest | existing profile |

`ProgrammingProgramConfigV2` chỉ có `objectId`, `programId`, `periodMs` và các
field scheduling đã pin; nó **không** chứa `enabled`. Enable/Disable là runtime
intent riêng theo `SYS-REQ-PROG-113`, có RBAC/audit/Core read-back và không được
trộn vào Draft hoặc Commission. `replaceProgramSource` resolve bằng `objectId`;
field legacy tên `programId` chỉ là alias compatibility trong một major và phải
map sang POU identity, không map sang runtime Program identity.

`F-P59-GHOST-POU-001` đã được quyết định bởi `AUTH-PROG-2026-08-24-05`: Draft
được phép chứa PROGRAM POU chưa có mục trong `programs[]`; Check/Package phải
fail closed bằng `PRG-ERR-CHECK-001` với detail `ST-POU-005`, giữ Draft và
Active/LKG, không tạo package. Cấm loại im lặng POU và cấm tổng hợp period
`1000 ms`. Corrective source/test vẫn `PENDING` và là exit condition R1.

### 4.2 Normalized Library signature

| Field | Type | Required | Enum/range/null | Identity/validation | Lifecycle/version |
|---|---|---|---|---|---|
| `scope` | enum | có | SYSTEM/PROJECT | join authority | SYSTEM generated; PROJECT revisioned |
| `entryId` | string/UUID theo authority | có | 1..128 | stable trong scope | không dùng name |
| `version` | string | có | 1..64 | exact requested version | immutable published |
| `contentSha256` | hex | có | 64 lowercase | canonical source+interface+dependencies | seal/publish |
| `kind` | enum | có | FUNCTION/FUNCTION_BLOCK/CONVERSION | registry/interface | immutable version |
| `name` | IEC identifier | có | 1..64 | canonical registry name | immutable version |
| `signatureAuthority` | enum | có | SYSTEM_REGISTRY/PROJECT_INTERFACE | producer-declared, không từ FE | target additive |
| `signatureState` | enum | có | VERIFIED/DECLARED/UNAVAILABLE | SYSTEM hash exact→VERIFIED; normalized PROJECT→DECLARED | mismatch→UNAVAILABLE |
| `featureState` | enum | có | READY/REVIEW_REQUIRED/UNSUPPORTED/DEPRECATED | capability/product readiness, tách khỏi signature trust | response projection |
| `category` | string | có | bounded/i18n key | registry taxonomy | additive |
| `labelVi`/`labelEn` | string | có | 1..120 | registry/project metadata | additive |
| `ports[].name` | IEC identifier | có | unique | canonical signature | order immutable per version |
| `ports[].order` | integer | có | 0..255 unique contiguous | authoritative connection/layout order | không theo wire order |
| `ports[].direction` | enum | có | INPUT/OUTPUT/IN_OUT | parser-compatible | immutable |
| `ports[].dataType` | type expression | có | profile set/generic constraint | normalized canonical | immutable |
| `ports[].required` | boolean | có | — | exact | immutable |
| `ports[].default` | typed JSON | không | null nghĩa không default | must match dataType/range | immutable |
| `allowedTypes` | array | không | unique profile types | generic constraint | immutable |
| `defaultType` | type/null | không | member of allowedTypes | exact | immutable |
| `stateful` | boolean | có | — | FUNCTION phải false; FB theo layout | immutable |
| `stateLayout` | object/null | không | version/size/hash | required khi stateful publish | immutable |
| `warningCode` | string/null | có | stable code khi unavailable/review | không chứa nội bộ | response-only |

Alias compatibility `libraryVersion` được giữ một major và bắt buộc bằng
`version`; mismatch làm response fail closed. Chỉ entry có
`featureState=READY` và `signatureState!=UNAVAILABLE` mới được insert.

SYSTEM response phải là phép chiếu chính xác của canonical `SignatureJSON` và
registry hash. PROJECT entry cũ không normalize được trả
`signatureState=UNAVAILABLE`; không lấy generated FE registry để che gap.

### 4.3 Reference và diagnostic anchor

| Field | Type | Required | Range/enum/null | Key/validation | Lifecycle/version |
|---|---|---|---|---|---|
| `draftRevisionId` | UUID | có | — | current Draft | response snapshot |
| `etag` | string | có | bounded opaque | matches response snapshot | invalid after mutation |
| `contentSha256` | hex | có | 64 lowercase | canonical Draft | invalid after mutation |
| `state` | enum | có | READY/UNAVAILABLE | analysis complete or fail closed | response |
| `sourcePouObjectId` | UUID | mỗi item | — | FK POU | stable through rename |
| `targetObjectId` | UUID/null | conditional | target POU | exactly one target identity | response |
| `targetEntryId` + `targetVersion` | string/null | conditional | library target | exactly one target identity | response |
| `targetSignalId` | UUID/null | conditional | Published Signal target | exactly one target identity | response |
| `referenceKind` | enum | có | ST_CALL/FBD_TYPE_REF/PROGRAM_CONFIG/LIBRARY_USE/SIGNAL_BINDING | parser-resolved, không regex guess | response |
| `location.kind` | discriminator | có | SOURCE/FBD/POU/GLOBAL | typed union | v1 target |
| SOURCE.`pouObjectId` | UUID | có | — | FK POU | stable |
| SOURCE.`line/column` | integer | có | ≥1, UTF-8 policy phải pin | compiler source map | response |
| SOURCE.`length` | integer | có | ≥0 | token span | response |
| FBD.`pouObjectId/networkId` | UUID | có | — | FK graph | stable |
| FBD.`nodeId/portId/wireId` | UUID/null | conditional | ít nhất anchor hẹp nhất có thể | tồn tại trong graph snapshot | stable |
| POU.`pouObjectId` | UUID | có | — | whole POU | stable |
| GLOBAL.`field` | string/null | không | bounded | project-level issue | response |

Trong một compatibility major, diagnostic có thể phát alias deprecated
`programId=pouObjectId` cho client cũ, nhưng field này không được dùng để join
runtime và phải có deprecation test/removal plan.

### 4.4 LIVE document/value tuple

| Field | Type | Unit | Required | Null/Unknown | Validation/lifecycle |
|---|---|---:|---|---|---|
| `projectId` | UUID | — | có | không null | Revision thuộc Project |
| `revisionId` | UUID | — | có | không null | phải bằng Core `activeRevisionId` |
| `objectId` | UUID | — | có | không null | source POU trong Revision |
| `contentHash` | hex | — | có | không null | source bytes immutable |
| `controllerId` | string | — | có | unavailable nếu thiếu | exact target |
| `activeRevisionId` | UUID | — | có khi LIVE | null→UNAVAILABLE | phải bằng document revision |
| `programId` | UUID | — | conditional | null cho non-Program | sealed object↔program mapping |
| `observationId` | UUID/string stable | — | có mỗi watch point | không suy từ label | sealed manifest |
| `snapshotSequence` | uint64 JSON string | — | có | thiếu/out-of-order→drop | monotonic trong producer epoch |
| `observedAt` | RFC3339 timestamp | — | có | thiếu→UNAVAILABLE | freshness theo server clock policy |
| `quality` | enum | — | có | GOOD/UNCERTAIN/BAD/STALE/OFFLINE/UNKNOWN/UNAVAILABLE | không chuyển thành boolean |
| `value` | typed JSON/null | engineering unit | có mặt | null khi invalid/unavailable | type/unit khớp manifest |

### 4.5 Simulation session

| Field | Type | Unit | Required | Default/range/enum | Null/Unknown | Key/validation | Lifecycle/version |
|---|---|---:|---|---|---|---|---|
| `sessionId` | UUID | — | có | server generated | không null | PK; idempotency replay same ID | create→terminal→purge |
| `controllerId` | string | — | có | target controller | không null | object scope | immutable |
| `projectId` | UUID | — | có | — | không null | FK Project | immutable |
| `sourceDraftRevisionId` | UUID | — | có | — | không null | saved Draft snapshot | immutable |
| `sourceContentSha256` | hex | — | có | 64 lowercase | không null | compare client/server | immutable |
| `snapshotId` | UUID | — | có sau seal | server generated | null only PREPARING before seal | private immutable snapshot FK | session |
| `artifactSha256` | hex | — | có sau compile | 64 lowercase | null PREPARING/FAILED precompile | artifact validation | session |
| `state` | enum | — | có | PREPARING/PAUSED/RUNNING/COMPLETED/FAILED/EXPIRED/STOPPED | không null | state machine `6` | terminal immutable except cleanup marker |
| `sessionSequence` | uint64 string | — | có | 0 then +1 per committed mutation/step batch | không null | ETag/version | session |
| `etag` | string | — | response/header | server | không null | `If-Match` | changes with sequence |
| `baseTickMs` | integer | ms | có sau prepare | GCD allowed Program periods; ≥1 | null precompile | deterministic | immutable |
| `virtualTimeMs` | uint64 string | ms | có | 0 at reset | không null after prepare | increments baseTick only | reset→0 |
| `speed` | integer | ×wall | có | 1; enum 1/10/60 | không null | pacing only | mutable admin |
| `observationSequence` | uint64 string | — | có | 0 then monotonic | không null | snapshot ordering | reset→0 |
| `createdAt/lastActivityAt` | RFC3339 | — | có | server clock | không null | audit/TTL | session |
| `idleExpiresAt` | RFC3339 | — | có | last activity +900 s | không null | supervisor | refresh bounded by hard TTL |
| `hardExpiresAt` | RFC3339 | — | có | created +3600 s | không null | supervisor | never extend |
| `failureCode` | stable code/null | — | có mặt | null unless FAILED/EXPIRED | null is “no failure” | allowlisted | terminal |
| `createdBy` | subject ID | — | internal/audit | authenticated admin | không public nếu policy cấm | audit FK | retention by audit policy |

Worker PID/socket path không phải public identity và không được trả cho FE.

### 4.6 Virtual input và observation

| Field | Type | Required | Range/enum/null | Validation | Lifecycle |
|---|---|---|---|---|---|
| `observationId` | stable string/UUID | có | 1..128 | manifest allowlist | immutable identity |
| `sourceKind` | enum | có | VAR_INPUT/READ_BINDING | only allowlist | immutable |
| `dataType` | enum | có | BOOL/INT/DINT/UINT/REAL/TIME | profile exact | immutable |
| `unit` | string/null | có mặt | ≤32 | exact manifest | immutable |
| `min/max` | typed/null | có mặt | manifest-defined | min≤value≤max | immutable |
| `inputValue` | typed JSON | mutation | không null trừ type cho phép explicit null (v1: không) | type/unit/range; NaN/Inf reject | committed atomically |
| `inputSequence` | uint64 string | response | monotonic | expected session sequence | reset preserves manifest, clears values |
| `programId` | UUID/null | observation | null cho non-Program/internal aggregate | sealed mapping | immutable |
| `value` | typed JSON/null | observation | null khi quality không cho value | type/unit exact | each output commit |
| `quality` | enum | observation | GOOD/UNCERTAIN/BAD/UNAVAILABLE | worker-owned | each commit |
| `virtualTimeMs` | uint64 string | observation | ≥0 | current committed tick | each commit |
| `snapshotSequence` | uint64 string | observation | monotonic | no duplicate/regress | reset→0 |

Denied source kinds: `OUTPUT`, `IN_OUT`, `RETAIN`, `INTERNAL`, `COMMAND`,
`OVERRIDE`, `PRODUCTION_WRITER`. Rejected input leaves prior committed
value/sequence intact.

### 4.7 Migration và retention

- R1 minimal tính references exact trên current Draft snapshot theo request và
  **không** tạo persisted reference index.
- Draft v1 được đọc; first successful write migrate v1→v2 trong cùng transaction.
- R1 dùng `0013_programming_draft_mutation_readback.sql` cho dedicated bounded
  response snapshot để replay cùng Idempotency-Key/request hash trả **đúng full
  typed read-back** sau restart. Không nhét Draft tối đa 2 MiB vào
  `mutation_receipts.result_json` 4 KiB; snapshot content-addressed, có TTL và
  cleanup toàn cục, được persist cùng Draft/receipt/audit trong một transaction.
- R3 dùng `0014_programming_simulation_sessions.sql` chỉ lưu metadata/
  reconciliation state, không lưu process image/RETAIN/source plaintext.
- Migration head đã đối soát tại inventory là
  `0012_library_revision_deprecate_receipt.sql`; vì vậy `0013` là ordinal
  Candidate kế tiếp ở snapshot này. Trước khi tạo bất kỳ migration R1/R3, BE
  phải đọc lại migration head; nếu ordinal đã bị changeset khác chiếm
  thì dùng ordinal trống kế tiếp và cập nhật DDD/contract/test pin, không ghi đè.
- Session/process image/trace là ephemeral: idle 900 s, hard 3.600 s, trace tối
  đa 10.000 samples; terminal metadata/audit retention theo policy Programming
  hiện hành, cần pin cụ thể trước R3.

## 5. Interface và contract — `DD-06`

### 5.1 R1 EDIT — thay đổi additive tối thiểu

| Method/path | Producer→consumer | Auth/RBAC | Request/response Target | Concurrency/idempotency/timeout | Side effect/audit/lỗi |
|---|---|---|---|---|---|
| `GET /api/v1/programming/projects/{projectId}` existing | BE→FE | viewer+ object scope | `draft` oneOf `ProgrammingDraftDocumentV1/V2`; typed POU/Program | Read; bounded; standard GET retry | none |
| `PATCH /api/v1/programming/projects/{projectId}/draft` existing | FE→BE | admin | `ProgrammingDraftMutationRequest` với `operations.oneOf` discriminator `op`; response typed v2 + ETag/content hash | `If-Match` + baseRevisionId; Idempotency-Key; atomic; conflict 409 | Draft mutation + audit; no Active side effect |
| `GET /api/v1/programming/libraries` existing | BE registry/store→FE | viewer+ | Extend `ProgrammingLibraryEntry` với normalized `signature`/authority/state | Pagination/cursor; cache by hash/version | none; mismatch→UNAVAILABLE |
| `GET /api/v1/programming/projects/{projectId}/draft/references` new; đúng một filter `targetObjectId` hoặc `targetEntryId+targetVersion` hoặc `targetSignalId` | BE analyzer→FE/refactor | viewer+ | `ProgrammingDraftReferencesPage`: revision/etag/hash/state/items/nextCursor | Cursor bind draftRevisionId+ETag+hash+filter; limit default 100, max 500; safe GET retry | no mutation; unknown/multiple target 400; analysis failure state UNAVAILABLE |
| Rename/remove op qua PATCH | FE→BE refactor | admin | Same Draft operation; response full typed read-back | Same ETag/idempotency; semantic plan+rewrite+validate+commit một transaction | Audit before/after identity/hash; errors below |
| Check existing | BE/compiler→FE | admin start; viewer+ read | Diagnostic location typed union | Existing idempotency/timeout policy; compiler isolated | No Active mutation; exact anchors |

Typed operation union phải bao phủ các op hiện có: `setFunctionalTags`,
`replaceProgramSource`, `upsertObject`, `removeObject`, `renameObject`,
`duplicateObject`, `upsertProgram`, `removeProgram`, `upsertSignal`,
`removeSignal`, `upsertBinding`, `upsertVariable`, `removeVariable`,
`setTask` và `removeBinding`. Payload legacy `upsertProgram` được giữ bằng
`oneOf` trong một
compatibility major; không bắt client đổi envelope `schemaVersion="1.0"`.

Schemas bắt buộc thêm vào OpenAPI:

- `ProgrammingDraftDocumentV1`, `ProgrammingDraftDocumentV2`.
- `ProgrammingPouObjectV2`, `ProgrammingProgramConfigV2`.
- `ProgrammingDraftOperation` với discriminator `op` và per-op schema.
- `ProgrammingLibrarySignature`, `ProgrammingLibraryPort`.
- `ProgrammingDraftReferencesPage`, `ProgrammingReferenceItem`.
- `ProgrammingDiagnosticLocation` union SOURCE/FBD/POU/GLOBAL.

R1 thêm một route public nên baseline 33 operations thành 34. Router, OpenAPI,
`g1_contract_join_v1.json`, impact manifest, typed Go DTO + OpenAPI contract-sync
tests và generated TS client
phải đổi trong cùng changeset; không chấp nhận chỉnh magic count đơn lẻ.

### 5.2 R1 semantic rename/delete

Stable errors:

| Code | HTTP | Khi nào | State/output | Recovery |
|---|---:|---|---|---|
| `PRG-ERR-CONFLICT-001` | 409 | ETag/baseRevision đổi | zero mutation | GET read-back, rebase, user retry |
| `PRG-ERR-POU-REFERENCED-001` | 409 | Delete target còn semantic reference | zero mutation; trả bounded reference summary/link | mở References, remove refs, retry |
| `PRG-ERR-POU-REFACTOR-UNAVAILABLE-001` | 422 | Parser/source-map/graph không chứng minh rewrite an toàn | zero mutation | sửa Draft/Check hoặc refresh; không regex fallback |
| Request malformed/type/envelope | 400 | JSON sai, thiếu field/discriminator, sai primitive type | zero mutation | sửa request |
| Existing semantic validation code | 422 | New name/kind/source invalid/duplicate sau khi request parse được | zero mutation | sửa input |

Rename phải rewrite cùng transaction: declaration name, resolved ST call,
FBD root/typeRef và metadata; giữ `objectId`, `programId`, `nodeId`, `portId`,
`wireId`, `layout` và port `order`. Delete không cascade.

### 5.3 R2 LIVE — dùng route hiện có, siết coherence

Không bắt buộc thêm “Active source endpoint” nếu chuỗi hiện có được pin:

1. `GET /programming/runtime` lấy authoritative `controllerId`,
   `activeRevisionId`, `observedAt`, `producerState`.
2. `GET /programming/revisions/{activeRevisionId}` lấy immutable source,
   object↔program map và content/artifact hash.
3. `GET /programming/runtime/monitor` hoặc `/runtime/signals` mở stream/poll có
   active pin + monotonic snapshot sequence + observation identity.
4. Trace create/read phải mang `activeRevisionId + artifactSha256`.

| Interface | Vai trò | Target bổ sung | Timeout/retry | Failure |
|---|---|---|---|---|
| `GET /runtime` | viewer+ | authoritative runtime tuple | retry backoff+jitter; request bounded | Core/IPC im→UNAVAILABLE |
| `GET /revisions/{id}` | viewer+ | immutable document tuple + sealed mapping | cache only by revision/hash | missing/hash mismatch→UNAVAILABLE |
| `GET /runtime/monitor` | viewer+ | activeRevisionId, artifact hash, snapshot sequence, observedAt, quality per observation | reconnect tạo subscription mới; không replay mutation | gap/out-of-order→STALE/RECONCILING |
| `GET /runtime/signals` | viewer+ | same tuple semantics | bounded page | definition mismatch→UNAVAILABLE |
| `POST /runtime/traces` | admin existing mutation | request pins activeRevisionId/artifact hash; Idempotency-Key | existing bound; read-back | revision changes→terminate/unavailable |
| `GET /runtime/traces/{id}` | viewer+ | response repeats pin | safe retry | không splice samples khác pin |

LIVE luôn read-only trong PGM-02, kể cả admin; không expose force/override/
commission action trong mode này.

### 5.4 R3 Simulation API Target

Các path dưới đây chưa tồn tại và chỉ được thêm ở R3 sau khi dependency R1/R2 đóng:

| Method/path | RBAC | Payload/response | Concurrency/idempotency | Timeout/retry | Side effect/audit |
|---|---|---|---|---|---|
| `POST /api/v1/programming/simulation/sessions` | admin | Request: schemaVersion, controllerId, projectId, sourceDraftRevisionId, sourceContentSha256, observationIds≤256; Response session + ETag | Idempotency-Key bắt buộc; một session/controller; replay cùng hash trả cùng session | HTTP accept ≤2 s; prepare async/read-back | Seal snapshot, compile, spawn sandbox worker; audit create/result |
| `GET /api/v1/programming/simulation/sessions/{sessionId}` | viewer/operator/admin có object scope | Bounded session state/read-back | no mutation | retry safe | none |
| `POST /api/v1/programming/simulation/sessions/{sessionId}/actions` | admin | discriminated `RUN/PAUSE/STEP_CYCLE/RESET/SET_SPEED`; response session + ETag | Idempotency-Key + `If-Match`; ≤10 action/s | worker command 2.000 ms; timeout→UNKNOWN_RECONCILING rồi GET | one committed state transition; audit |
| `PUT /api/v1/programming/simulation/sessions/{sessionId}/inputs/{observationId}` | admin | typed value + expected dataType/unit; response committed input + session sequence | Idempotency-Key + `If-Match` | 2.000 ms; no blind retry with new key | atomic set; audit identity/type/result, không log secret/full source |
| `GET /api/v1/programming/simulation/sessions/{sessionId}/observations?ids=...` | viewer/operator/admin | ≤256 typed observations + snapshotSequence/virtualTime | no mutation | retry safe; client drops regressions | none |
| `GET /api/v1/programming/simulation/sessions/{sessionId}/trace?cursor=&limit=` | viewer/operator/admin | bounded samples, max 10.000/session | cursor bound to session/reset epoch | retry safe | none |
| `DELETE /api/v1/programming/simulation/sessions/{sessionId}` | admin | STOP read-back; repeated STOP same terminal result | Idempotency-Key + `If-Match`; idempotent terminal | cleanup bounded; GET if uncertain | stop/kill/reap worker; audit |

`SET_INPUT` là tên action sản phẩm nhưng v1 được materialize bằng PUT input để
có resource identity/idempotency rõ; action endpoint không nhận duplicate
`SET_INPUT` payload. `STOP` được materialize bằng DELETE; client generator vẫn
expose tên hành động sản phẩm. Cách ánh xạ này phải được Architect pin.

Create chỉ chấp nhận Saved Draft. FE gửi hash của buffer đang hiển thị; server
so với Saved Draft canonical hash. Khác hash trả
`PRG-SIM-SAVE-REQUIRED` và không tạo DB record/worker/snapshot.

### 5.5 Capability discovery

Mở rộng additive `ProgrammingCapabilities` bằng object optional
`workspaceModes`:

| Field | Type | Default khi absent | Ý nghĩa |
|---|---|---|---|
| `contractVersion` | string | unsupported | Exact `PGM02-WORKSPACE-V1` major/minor |
| `edit.supported` | boolean | false cho surface mới | R1 contract fully deployed |
| `live.supported` | boolean | false | producer/IPC/BE coherence compatible |
| `simulation.supported` | boolean | false | API + supervisor + worker + policy compatible |
| `simulation.workerVersion` | string/null | null | exact compatible worker |
| `simulation.mutationRoles` | enum array | empty | server-declared; v1 phải [admin] |
| `simulation.limits` | object | none | exact server limits, không FE hardcode làm authority |

Thiếu field, version mismatch, partial deploy hoặc discovery error: mode tương
ứng `UNAVAILABLE`; không fallback sang browser simulation.

### 5.6 Simulation errors và audit

| Stable code | HTTP | Detect tại | Zero-side-effect / recovery |
|---|---:|---|---|
| `PRG-SIM-UNSUPPORTED` | 409/503 theo availability | capability/supervisor | không spawn; deploy compatible version |
| `PRG-SIM-SAVE-REQUIRED` | 409 | create preflight | không record/worker; Save rồi retry new/correct hash |
| `PRG-SIM-FORBIDDEN` | 403 | HTTP RBAC | không gọi application/worker; security reject audit |
| `PRG-SIM-INPUT-NOT-ALLOWED` | 422 | manifest/type/unit/range | giữ value/sequence trước |
| `PRG-SIM-STALE-SESSION` | 409/412 | ETag/sequence | không command; GET read-back |
| `PRG-SIM-QUOTA` | 429 | supervisor/cgroup/rate | no new session/action; Retry-After bounded |
| `PRG-SIM-WORKER-FAILED` | 503 | IPC/process monitor | state FAILED, kill/reap; Active unchanged |
| `PRG-SIM-EXPIRED` | 410 | TTL supervisor | terminal; create session mới |

Mọi create/action/input/stop và forbidden reject audit tối thiểu:
`auditId`, `correlationId`, `actorSubject`, `actorRole`, `action`, `sessionId`,
`projectId`, `sourceDraftRevisionId`, `sourceContentSha256`, `requestHash`,
`beforeSequence`, `afterSequence`, `resultCode`, `occurredAt`. Không log source
đầy đủ, token, private socket, PID hoặc input được phân loại secret.

### 5.7 Compatibility contract

- Tất cả bổ sung R1 là OpenAPI minor/additive trong major hiện tại; field mới
  optional cho client cũ nhưng server/FE R1 capability chỉ true khi đủ.
- Draft envelope `schemaVersion="1.0"` không bị nhầm với content schemaVersion 2.
- Alias diagnostic legacy tồn tại đúng một major, có deprecation telemetry/test.
- Server mới phải chấp nhận client cũ trong compatibility window; client mới gặp
  server cũ hiển thị UNAVAILABLE, không tự dựng signature/reference/simulation.
- Mỗi API mutation trả resource read-back + ETag + auditId + correlationId.

## 6. State, thuật toán và timing — `DD-07`

### 6.1 State machine của workspace

URL `mode` là yêu cầu của client; capability, role và state server quyết định
mode hiệu lực.

| Từ | Sang | Guard bắt buộc | Action | Postcondition/failure |
|---|---|---|---|---|
| BOOT | RESOLVING | route parse hợp lệ | Resolve Project/POU/capability/role | Chưa mount editor/value |
| RESOLVING | EDIT | R1 supported; Saved Draft đọc được | Load typed Draft + ETag; select objectId | Editor mutable chỉ khi admin |
| RESOLVING | LIVE | R2 supported | Thực hiện full LIVE join `6.4` | LIVE hoặc RECONCILING/UNAVAILABLE |
| RESOLVING | SIMULATE | R3 supported + admin + Saved Draft hash exact | Create/read session | PREPARING/PAUSED hoặc stable error |
| EDIT | LIVE | runtime available; Active tuple resolve được | Giữ local Draft buffer riêng; đóng mutation surface; fetch Runtime→Revision→observations | Không dùng Draft source làm LIVE |
| EDIT | SIMULATE | admin; capability true; local buffer hash = Saved Draft hash | Create immutable session snapshot | Dirty→SAVE_REQUIRED, zero worker |
| LIVE | EDIT | Saved Draft đọc được | Close subscription; load/reveal Draft + ETag | Không copy runtime value vào Draft |
| LIVE | SIMULATE | Đi qua guard EDIT; Saved Draft exact | Close LIVE; create session từ Draft | Không tái dùng Active snapshot |
| SIMULATE | EDIT | STOP/EXPIRED/FAILED cleanup read-back xác nhận | Close session stream; load Saved Draft | Không copy virtual output/input |
| SIMULATE | LIVE | STOP/cleanup xác nhận; R2 guard pass | LIVE join mới từ Runtime | Không dùng sim sequence/value |
| mọi mode | UNAVAILABLE | capability/version/identity/data không đủ | Hủy overlay/mutation controls | Giữ navigation/read-only error |

Route rời workspace khi FE có unsaved buffer vẫn dùng dirty guard hiện hành.
Mode switch không tự Save, Commission, Restore hoặc copy data giữa các authority.

### 6.2 Transaction Save/refactor R1

```text
applyDraftMutation(projectId, ifMatch, baseRevisionId, operations, idempotencyKey):
  authenticate admin; authorize project scope
  lookup idempotency receipt; same requestHash => return same full typed read-back snapshot
  begin database transaction
  load Draft bytes + current ETag; mismatch => rollback CONFLICT
  migrate v1 -> v2 in memory if required
  parse all POU declarations/FBD graphs and build exact symbol/reference graph
  if analysis incomplete => rollback REFACTOR_UNAVAILABLE
  for operation in request order:
      validate typed payload
      if rename:
          resolve target by objectId
          plan declaration + resolved ST calls + FBD root/typeRef rewrites
          apply plan in memory; preserve stable IDs/layout/port order
      else if remove:
          collect every semantic reference
          if any => rollback POU_REFERENCED
          remove POU and exact config owned by objectId
      else:
          apply typed operation
  validate complete Draft v2 + references + limits
  canonicalize; compute contentSha256 and new ETag
  persist Draft + bounded read-back snapshot + idempotency receipt + audit in one transaction
  commit
  return typed document v2 + ETag + auditId + correlationId
```

Không được thực hiện regex rename mù hoặc ghi từng file/POU trước khi toàn bộ
plan validate. Failure trước commit giữ nguyên bytes, ETag và audit mutation
state; security reject vẫn có security audit riêng.

### 6.3 Quick Library insertion

```text
insertLibraryEntry(entryIdentity, selectedPouObjectId, editorSelection):
  require mode=EDIT and effectivePermission.canMutateDraft
  load exact signature(scope, entryId, version, contentSha256)
  require featureState == READY
  require signatureState != UNAVAILABLE and language/kind supported
  resolve polymorphic type; cancellation => zero mutation
  build one editor transaction:
      FUNCTION: insert canonical call with arguments in port.order
      FUNCTION_BLOCK:
          allocate collision-free IEC instance name
          insert declaration
          insert call/block with the same resolved instance
      FBD: create node/ports/wires using stable UUID; preserve layout policy
  apply transaction once; add Recent only after success
  one Undo reverses declaration + call/node/wire together
```

Favorites/Recent chỉ là preference FE của user (Recent max 12, Favorites max
64), không phải project/program authority. Search/rank phải deterministic; cùng
fixture cho cùng thứ tự sau 20 lần.

### 6.4 LIVE coherent join

```text
openLive(projectId, selectedObjectId):
  clear every prior overlay
  runtime = GET /runtime
  require runtime.producerState usable and activeRevisionId != null
  revision = GET /revisions/{runtime.activeRevisionId}
  verify revision.projectId == projectId
  verify revision/artifact hashes against runtime pin
  resolve selectedObjectId in immutable revision
  resolve programId only from sealed objectId<->programId mapping
  subscribe observations pinned to controllerId+activeRevisionId+artifactHash
  for each sample:
      require all tuple fields present and exact
      require snapshotSequence > lastAccepted within producer epoch
      evaluate quality/freshness
      if mismatch/gap/revision change:
          clear overlay within one render cycle
          set RECONCILING or UNAVAILABLE
          terminate old Trace/subscription; restart full join
      else:
          update keyed observation store
          schedule render no faster than 10 Hz
```

- Missing value là `null`/em dash; stale last value chỉ được giữ nếu UI gắn rõ
  `STALE` và `observedAt`. `OFFLINE/UNKNOWN/UNAVAILABLE` không hiển thị zero.
- Runtime switch Active Revision invalidates source, object↔program mapping,
  overlay và Trace cùng lúc.
- FE/BE mất kết nối không ảnh hưởng Core; reconnect mở read subscription mới,
  không replay command.
- Topology/editor tree không rerender theo từng sample; observation store keyed
  và render cap 10 Hz.

### 6.5 Simulation create/prepare

```text
createSession(request, actor, idempotencyKey):
  authenticate admin; authorize controller/project
  require R3 capability/protocol/profile exact
  rate/quota preflight: <=1 non-terminal session/controller
  load Saved Draft and canonical hash
  require request.sourceContentSha256 == savedHash else SAVE_REQUIRED
  reserve idempotency receipt and session PREPARING transactionally
  seal immutable private snapshot; never change Draft/Revision/Active/LKG
  Check/compile through production compiler semantics
  derive simulationInputs manifest and allowed Program periods
  require periods nonempty and allowed; baseTick = gcd(periods)
  spawn worker under sandbox policy with private handles only
  load artifact/private images; read-back protocol/version
  transition PREPARING -> PAUSED, sequence++
  commit audit/read-back
on any failure:
  kill/reap worker if created
  mark FAILED or remove reservation according to failure boundary
  Active/physical output/production RETAIN remain byte-for-byte unchanged
```

“Compile production semantics” nghĩa là tái dùng parser/type/check/artifact
loader đã pin, không có nghĩa worker được link/mở production driver.

### 6.6 Virtual time, scheduling và `STEP_CYCLE`

Allowed Program periods hiện hành là 1.000/5.000/30.000 ms; GCD bằng 1.000 ms.
Nếu profile sau này đổi, server tính GCD từ periods thực sự có trong sealed
manifest sau khi validate profile, không từ giá trị FE.

Reset:

1. Đưa state về `PAUSED` tại safe boundary.
2. Đặt `virtualTimeMs=0` và `nextReleaseMs=0` cho mọi Program.
3. Tái khởi tạo private process image, timer và sandbox RETAIN từ initializer
   của snapshot; tuyệt đối không đọc production RETAIN.
4. Clear private output/Watch/Trace theo manifest; sequence/resetEpoch tăng theo
   contract để client không nối epoch cũ.

Một `STEP_CYCLE`:

```text
require state == PAUSED and expected sessionSequence exact
inputs = snapshotAllEligibleVirtualInputsOnce()
due = programs where nextReleaseMs <= virtualTimeMs
stableSort(due, sealedManifestOrder then programId)
for program in due:
    execute against the same input snapshot and private pre-commit image
    nextReleaseMs += periodMs
atomically commit one private output batch
append one bounded Watch/Trace snapshot
virtualTimeMs += baseTickMs
snapshotSequence += 1
sessionSequence += 1
state = PAUSED
return read-back
```

- Không có step-program v1.
- Nếu nhiều Program đến hạn ở `t=0`, tất cả chạy theo stable order và output
  commit đúng một batch.
- `RUN` lặp cùng tick algorithm; `PAUSE` có hiệu lực tại safe boundary giữa hai
  tick.
- Speed 1×/10×/60× chỉ thay wall pacing, không bỏ tick, đổi timer semantics,
  change ordering hoặc thay output hash.
- Worker command WCET contract là timeout 2.000 ms; đó là timeout supervisor,
  không phải claim measured WCET của chương trình user. Vi phạm → FAILED/kill.

### 6.7 Atomicity, lock và concurrency

| Luồng | Atomic boundary | Lock/version | Timeout/uncertain | Điều cấm |
|---|---|---|---|---|
| Save/refactor Draft | DB transaction Draft+receipt+audit | ETag/baseRevision | rollback before commit | partial POU rewrite |
| Quick insert | một editor transaction | document revision + objectId | cancel zero mutation | two separate undo records cho FB |
| LIVE read | một accepted observation snapshot | active pin + monotonic sequence | clear/rejoin | merge different revisions |
| Session create | reservation + immutable source identity; worker handoff read-back | Idempotency-Key/requestHash | reconcile by GET/cleanup | duplicate worker/session |
| Session action/input | one worker safe-boundary commit + session store read-back | If-Match/sessionSequence + idempotency | UNKNOWN_RECONCILING then GET | blind retry new key |
| STOP/expiry | terminal transition + worker kill/reap | terminal idempotent | supervisor retry cleanup | resurrect same sessionId |

Database transaction không bao trùm worker execution. BE dùng intent/receipt +
read-back reconciliation: chỉ publish new session sequence sau worker ACK; nếu
ACK mất, query worker bằng command ID. Không xác định được thì mark
`UNKNOWN_RECONCILING` nội bộ, khóa mutation và đi tới `FAILED`/cleanup; không
đoán success.

### 6.8 Resource, watchdog, fault, restart và power loss

| Fault/event | Detect tại | Session/workspace state | Active/output effect | Recovery |
|---|---|---|---|---|
| Draft ETag conflict | BE before transaction | EDIT conflict | none | GET/rebase/user retry |
| Compiler timeout/crash | isolated compiler runner | Check/session FAILED | none; Core giữ Active | bounded retry theo Check policy, không auto create sim |
| Core/IPC mất | LIVE adapter | STALE→OFFLINE/UNAVAILABLE | Core có thể tiếp tục control; FE không suy | reconnect + full join |
| Active đổi giữa stream | pin comparator | RECONCILING | old overlay cleared | fetch new runtime/revision/subscription |
| Worker command >2 s | supervisor | UNKNOWN_RECONCILING→FAILED nếu không read-back | none | query once/bounded, kill/reap |
| Worker crash/OOM/CPU limit | pidfd/process monitor/cgroup | FAILED | none | reap; new session required |
| Idle 900 s | supervisor monotonic clock | EXPIRED | none | stop/reap; new session |
| Hard 3.600 s | supervisor monotonic clock | EXPIRED | none | stop/reap; cannot extend |
| BE restart | startup reconciler | non-terminal record→reconcile; orphan must be killed/FAILED/EXPIRED | none | không attach worker không chứng minh token/protocol |
| Worker restart riêng | system must not auto-restart ephemeral worker | FAILED | none | admin create new session |
| Controller reboot/power loss | boot cleanup | all sessions EXPIRED; process image lost | production boot follows Core policy | no restore/reuse session ID |
| Disk full/audit failure | BE precommit | mutation fails closed | prior state held | operator incident; no unaudited mutation |
| Browser crash/network loss | expiry/supervisor | session continues bounded tới TTL hoặc admin stop | none | GET read-back; no command replay |

Limits Target v1: một session/controller; RSS 64 MiB; CPU 25% một core; 10
actions/s; trace 10.000; virtual inputs 256; worker command 2.000 ms. Cgroup/
rlimit violation phải terminate fail closed, không hạ precision hoặc bỏ sample
âm thầm.

## 7. Luồng người dùng — `DD-08`

### 7.1 Visual authority và dependency

Các asset sau là tài liệu trực quan, không phải screenshot runtime:

- [Combined desktop/mobile Target Candidate](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02_ST_FBD_combined_reference.svg).
- [ST editor Target Candidate](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02A_ST_editor_reference.svg).
- [FBD editor Target Candidate](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.svg).
- [Desktop POU baseline hiện hành](../../04_uiux/assets/programming/PGM-02_PROGRAMS_POU_DESKTOP.svg),
  [Mobile POU baseline hiện hành](../../04_uiux/assets/programming/PGM-02_PROGRAMS_POU_MOBILE.svg)
  và [Design workspace baseline](../../04_uiux/assets/programming/PGM-02_DESIGN_WORKSPACE_DESKTOP.svg)
  chỉ là tham chiếu baseline; không đủ thay asset R2/R3 Candidate.

`handoff_manifest.json` trong worktree đã liệt kê bộ v2.2/asset mới, nhưng
revision/hash và consumer review còn nằm trong change-set Candidate. Dữ liệu
trong SVG là minh họa; `OD-PGM02-V22-004` giữ gate pin/review, không claim asset
đã Active.

### 7.2 Cây component Target

```text
ProgrammingLayout
└─ ProgramsWorkspaceRouteResolver
   ├─ ProjectChooser / EmptyProjectState / RouteError
   └─ ProgramsWorkspaceProvider
      ├─ ProgrammingContextStrip
      │  ├─ ProjectIdentity
      │  ├─ DraftActiveIdentity
      │  ├─ ModeSwitch (EDIT | LIVE | SIMULATE)
      │  └─ CapabilityRoleFreshness
      ├─ PouExplorer
      │  ├─ SearchFilter
      │  ├─ ProgramsGroup
      │  ├─ FunctionsGroup
      │  └─ FunctionBlocksGroup
      ├─ WorkspaceMain
      │  ├─ StWorkspace
      │  │  ├─ SourceEditor
      │  │  ├─ DiagnosticGutter
      │  │  └─ StRuntimeValueOverlay (LIVE/SIM read-only projection)
      │  └─ FbdWorkspace
      │     ├─ FbdCanvas
      │     ├─ FbdNode/FbdPort/FbdWire
      │     └─ FbdDiagnosticOverlay
      ├─ RightDock
      │  ├─ QuickLibraryPanel (EDIT only)
      │  ├─ ReferencesPanel (EDIT)
      │  ├─ WatchPanel (LIVE/SIM)
      │  └─ SimulationControls (SIM, admin mutation)
      └─ BottomPanel
         ├─ DiagnosticsPanel
         ├─ TracePanel
         └─ ConnectionSessionStatus
```

### 7.3 Ánh xạ vùng UI

| Vùng | Field/API authority | State | Action/RBAC | Copy/error chính | Test |
|---|---|---|---|---|---|
| Context strip | projectId, document tuple, runtime/session tuple | loading/ready/stale/unavailable | read all | “Nguồn chưa đồng bộ”, không rút gọn UUID gây nhầm | ID-01, LIVE-02 |
| Mode switch | capabilities + role + current state | enabled/disabled/loading/permission/unavailable | EDIT admin mutation; LIVE read; SIM admin mutation | Lý do cụ thể: “Chưa triển khai”, “Cần lưu Draft”, “Không đủ quyền” | MODE-01, SIM-01/02 |
| POU explorer | Draft/Revision objectId/kind/name | loading/empty/error/selected | select viewer+; create/rename/delete admin EDIT | delete referenced dẫn References | ID-01, REF-01/02 |
| ST editor | typed source + ETag | editable/read-only/conflict/error | edit admin EDIT only | conflict giữ buffer; LIVE/SIM badge read-only | DRAFT-01/02 |
| FBD canvas | canonical graph UUID/layout/order | editable/read-only/invalid | edit admin EDIT only | anchor exact node/port/wire | FBD-01, DIAG-02 |
| Quick Library | public normalized signature | loading/empty/review/unavailable | search viewer+; insert admin EDIT | không fallback signature; unsupported giải thích | QL-01..04 |
| References | references snapshot/ETag/hash | ready/empty/unavailable/stale | navigate viewer+; remove ref admin EDIT | stale yêu cầu refresh | REF-01/02 |
| Diagnostics | Check typed locations | queued/running/pass/fail/timed-out | run Check admin; navigate viewer+ | stable messageKey, không render raw internal detail | DIAG-01/02 |
| LIVE overlay | value tuple | connecting/live/stale/offline/reconciling/unavailable | read only mọi role | “—” cho unavailable; stale kèm observedAt | LIVE-01..03 |
| Watch/Trace | pinned observation/trace | empty/live/stale/terminated | existing Trace mutation theo API role; PGM-02 LIVE không thêm force | revision change terminate rõ | LIVE-01/02 |
| Sim controls | session state/ETag/role | preparing/paused/running/failed/expired/stopped/permission | mutation admin; read viewer+ | timeout→“Đang đối soát”, không báo thành công sớm | SIM-02..08 |
| Virtual input | manifest observationId/type/unit/range | unset/set/error/permission | set admin | rejected giữ giá trị trước | SIM-07 |

### 7.4 Luồng chính và lỗi

**R1 EDIT**

1. Resolver chọn Project rõ ràng, tải Saved Draft typed và ETag.
2. User chọn POU bằng `objectId`; editor khớp language.
3. Admin sửa hoặc insert Quick Library trong một transaction.
4. Save gửi typed operations + `If-Match`; chỉ clear dirty sau response read-back.
5. Check trả anchor; click diagnostic chọn đúng POU/location.
6. Conflict giữ buffer, hiển thị compare/reload/reapply; không overwrite âm thầm.

**R2 LIVE**

1. User chọn LIVE; UI tắt mọi mutation control trước khi fetch.
2. Hiện CONNECTING trong khi resolve Runtime→Active Revision→source→value.
3. Chỉ chuyển LIVE khi tuple exact; stale/offline/revision switch hiện state rõ.
4. Quay EDIT đóng subscription và tải lại Saved Draft, không giữ source Active
   trong editor mutable.

**R3 SIMULATE**

1. Mode disabled nếu capability false; viewer/operator thấy read-only reason.
2. Admin với dirty buffer chọn SIMULATE nhận SAVE_REQUIRED, không session.
3. Saved Draft exact tạo PREPARING→PAUSED; Step chạy đúng một base tick.
4. Input chooser chỉ hiện allowlist; rejected value không đổi sequence/value cũ.
5. Timeout hiện RECONCILING và GET read-back.
6. STOP/expiry xác nhận trước khi thoát; virtual outputs không copy sang Draft
   hoặc runtime.

### 7.5 Responsive

| Width | Layout Target | Mutation |
|---:|---|---|
| ≥1280 px | Full shell: tree + editor/canvas + dock + bottom panel | Theo role/mode |
| 1024–1279 px | Compact dock, tree collapsible | Theo role/mode |
| 768–1023 px | Single main pane + modal/drawer cho tree/dock/bottom | Theo role/mode, vẫn đủ keyboard |
| <768 px | Read-only source/status/diagnostics; không authoring/session mutation | Không |

Baseline Active hiện cho phép một số short edit trên mobile, trong khi Target
Target đã pin khóa read-only dưới 768 px. Implementation phải bám đúng quyết
định này; không được mở mutation control bằng lựa chọn cục bộ ở FE.

### 7.6 Accessibility, token và i18n

- Focus ring tối thiểu 2 px; contrast text tối thiểu 4,5:1.
- Mọi action có keyboard parity; Escape đóng drawer không làm mất dirty state;
  focus quay lại trigger; tab order theo visual order.
- FBD node/port/wire có accessible name và keyboard selection/connection parity;
  không chỉ dùng màu phân biệt quality/state.
- Tôn trọng reduced motion; overlay update không giật focus/announce mỗi sample.
- Touch target theo UX baseline; mobile không giấu mutation sau gesture.
- Copy dùng i18n key + bounded args từ stable error; tiếng Việt/Anh không hardcode
  trong compiler/worker.
- Semantic colors phải map GOOD/UNCERTAIN/BAD/STALE/OFFLINE/UNKNOWN/UNAVAILABLE
  riêng; token hex cụ thể thuộc asset/theme review, không tự tạo trong DDD.

## 8. Error, safety và security — `DD-09`

### 8.1 Error handling end-to-end

| Nơi phát hiện | Code/state | Giữ/đổi state-output | Recovery/FE | Audit/alarm |
|---|---|---|---|---|
| Route resolver | NOT_FOUND/PERMISSION | không mount Project khác | chooser/error + safe back | access log; security audit nếu forbidden |
| Draft store | `PRG-ERR-CONFLICT-001` | giữ server Draft và local buffer | read-back/rebase | mutation failure audit |
| Refactor analyzer | `...POU-REFERENCED-001` | zero mutation | open exact refs | audit rejected mutation |
| Refactor parser/map | `...REFACTOR-UNAVAILABLE-001` | zero mutation | Check/fix/refresh | diagnostic + audit |
| Library projection | signature UNAVAILABLE | không insert | panel error, no fallback | integrity event; alarm theo registry policy |
| Check/compiler | typed diagnostic/TIMED_OUT | Active giữ nguyên | exact source/FBD navigation | existing Check/audit |
| LIVE join | RECONCILING/UNAVAILABLE | clear overlay ≤1 render cycle; Core unchanged | full rejoin | telemetry, không control alarm giả |
| LIVE stale/offline | STALE/OFFLINE | last value marked hoặc null | timestamp/reconnect | connection event |
| Sim RBAC | `PRG-SIM-FORBIDDEN` | zero application/worker side effect | permission copy | security reject bắt buộc |
| Sim input | `...INPUT-NOT-ALLOWED` | giữ input/value/sequence trước | field error | audit rejected mutation |
| Worker/quota/TTL | FAILED/EXPIRED + stable code | private outputs invalid; Active unchanged | create new session/incident | audit + ops event |
| Audit/db failure | stable internal unavailable | mutation fail closed | retry only after health/read-back | alarm bắt buộc |

### 8.2 Safety invariants

1. PGM-02 không gọi Commission/Restore/Override/Output API từ mode switch,
   editor, LIVE hoặc SIMULATE.
2. Simulation artifact không đăng ký vào production candidate registry,
   scheduler, signal bus, point graph, RETAIN journal hoặc OutputWriter.
3. Worker bị từ chối production IPC/SHM/device cả ở code dependency, OS
   permission và runtime probe.
4. Failure trước live safe-boundary handoff trong lifecycle khác phải zero
   mutation; Simulation hoàn toàn không tham gia handoff.
5. Active/LKG/physical outputs được đo before/after trong isolation test; docs
   hoặc absence of UI button không phải proof.
6. Unknown quality/state fail closed; không tạo output/value mặc định.

### 8.3 Security boundary và malicious input

| Threat/input | Control Target | Negative test |
|---|---|---|
| Viewer/operator gọi mutation trực tiếp | Server middleware + application role check + object scope | 7 mutation classes trả 403, zero DB/worker side effect |
| Forged `objectId/programId` | Typed UUID + ownership + sealed mapping | cross-project/cross-role IDs reject |
| Replayed mutation | Idempotency receipt keyed actor+route+key+requestHash | same hash same read-back; different hash conflict |
| Stale ETag/session sequence | `If-Match`/expected sequence | 409/412, no command |
| Source/graph bomb | byte/node/edge/operation limits, isolated compiler timeout | max+1 reject; timeout no Active effect |
| NaN/Inf/overflow/unit spoof | strict JSON/type/unit/range parser | 422, old value held |
| Worker protocol spoof | private per-session token, peer credential, version handshake | wrong token/version kill/reject |
| Path/socket/device escape | no user path in worker; allowlisted inherited FD; dedicated UID/seccomp/cgroup | open production path/socket denied |
| Resource DoS | one session/controller, 64 MiB, 25% core, rate/TTL bounds | quota error + reap |
| Log/source disclosure | bounded stable errors; redaction; no full source/input secret | log scan fixture |
| Partial deploy/downgrade | capability protocol/profile version exact | mode UNAVAILABLE; no fallback |

### 8.4 Zero-physical-output evidence plan

R3 chỉ có thể qua target gate khi cùng một Test Result chứa:

1. static dependency/link scan chứng minh worker không link production
   OutputWriter/fieldbus/iobus/client symbols;
2. sandbox negative probes cho production SHM, Core/iobus sockets, `/dev`,
   production RETAIN/journal đều `EACCES/EPERM`;
3. Core/SHM/device/output counters và Active/LKG hash đo trước/sau create, run,
   step, input, reset, worker crash, expiry;
4. target/HIL observation xác nhận physical AO/DO/relay không thay đổi do session;
5. audit/RBAC proof và cleanup process/FD proof.

Hiện chưa có Test Result này; `V-PGM02-SIM-ISO-01` là kế hoạch, không phải PASS.

## 9. Ánh xạ repository — `DD-10`

### 9.1 R1 EDIT

| Cần tạo hoặc sửa | Đường dẫn | Symbol/schema Target | Dependency được phép | Dependency bị cấm |
|---|---|---|---|---|
| Sửa | `contracts/openapi/openapi.yaml` | typed Draft/op/signature/reference/location | OpenAPI generator | generic resource làm authority |
| Sửa | `contracts/programming/g1_contract_join_v1.json` + impact manifest | operation/schema/hash pin | generated evidence | magic count không contract |
| Duyệt/pin Candidate | `contracts/programming/pgm02_workspace_v1.json` và schema | `PGM02-WORKSPACE-V1` | DOC/contract verifier | claim Active trước pin |
| Sửa | `apps/web-api/internal/programming/application/draft_v2.go` | semantic refactor entrypoint | parser/analyzer exact | regex rename |
| Tạo | `apps/web-api/internal/programming/application/references.go` | snapshot reference service | compiler source graph | FE-computed refs |
| Tạo | `apps/web-api/internal/programming/application/refactor.go` | plan/validate/apply atomic | Draft transaction | partial writes |
| Tạo | `apps/web-api/internal/programming/store/migrations/0013_programming_draft_mutation_readback.sql` | bounded full typed replay snapshot + TTL index | SQLite transaction/content hash | nhét Draft 2 MiB vào receipt 4 KiB |
| Sửa | `apps/web-api/internal/programming/application/library.go` | signature projection | domain SignatureJSON | FE registry fallback |
| Tạo | `apps/web-api/internal/programming/transport/http/references.go` | GET references | auth/router patterns | mutation qua GET |
| Sửa | `apps/web-api/internal/programming/transport/http/{router,library,checks}.go` | new route/typed response | existing middleware | bypass RBAC/audit |
| Sửa | `apps/web-api/internal/programming/compiler/runner.go` | carry typed symbols/anchors | compiler CLI | programId as source ID |
| Sửa | `apps/core/application/st/st_pou_registry.{hpp,cpp}` | objectId-backed resolved refs | canonical manifest/source map | name-only public identity |
| Sửa | `apps/core/application/st/st_fbd_compile.{hpp,cpp}` và model | full UUID anchor | canonical FBD schema | path-only diagnostic |
| Sửa | `apps/web-ui/scripts/generate-programming-client.mjs` | generated contract count/types | OpenAPI | handwritten drift |
| Sửa/tạo | `apps/web-ui/src/features/programming/design/*` | route resolver, workspace mode/selection/reference | generated client | duplicate local authority |
| Sửa/tạo | `apps/web-ui/src/features/programming/fbd/*` | canvas/anchor/transaction | typed model/commands | wire-order port layout |
| Tạo | `apps/web-ui/src/features/programming/library/QuickLibraryPanel.tsx` | normalized entry/search/insert | public signature | hidden hardcoded catalog |

### 9.2 R2 LIVE

| Cần tạo hoặc sửa | Đường dẫn | Symbol Target | Dependency được phép | Dependency bị cấm |
|---|---|---|---|---|
| Sửa | `apps/core/application/programming/program_ipc_server.{hpp,cpp}` | active/artifact/observation pin | Core-owned read snapshot | Web mutation dependency |
| Sửa | `apps/core/application/programming/programming_runtime_coordinator.{hpp,cpp}` | safe-boundary coherent publish | staged immutable state | pre-PREPARED live mutation |
| Sửa | `apps/web-api/internal/programming/coreipc/*` | versioned tuple decode | IPC schema | default zero on missing |
| Sửa | `apps/web-api/internal/programming/application/{runtime,monitor_trace}.go` | join/read-back/trace pin | immutable Revision store | “last commissioned” fallback |
| Sửa | `apps/web-api/internal/programming/transport/http/runtime.go` | typed public tuple | application state | raw Core detail |
| Tạo/sửa | `apps/web-ui/src/features/programming/design/editor/StRuntimeValueOverlay.tsx` và LIVE hooks/store | keyed ≤10 Hz overlay | generated API | rerender topology/sample |
| Sửa | `apps/web-ui/src/features/programming/runtime/WatchTab.tsx` | coherent pin/quality | same tuple | splice trace revisions |

### 9.3 R3 SIMULATE

| Cần tạo hoặc sửa | Đường dẫn | Symbol Target | Dependency được phép | Dependency bị cấm |
|---|---|---|---|---|
| Tạo | `apps/web-api/internal/programming/domain/simulation.go` | session/action/input/errors | domain primitives | HTTP/process handles |
| Tạo | `apps/web-api/internal/programming/application/simulation.go` | supervisor use cases/state | compiler + private worker client | Core mutation client |
| Tạo | `apps/web-api/internal/programming/transport/http/simulation.go` | Candidate endpoints/RBAC | existing auth/audit | FE role authority |
| Tạo | `apps/web-api/internal/programming/store/migrations/0014_programming_simulation_sessions.sql` | reconciliation metadata sau migration R1 read-back `0013` | SQLite transaction | process image/secret/source blob |
| Tạo | `apps/web-api/internal/programming/simworker/*` | private protocol/supervisor | Unix socket/pipe, peer creds | production Core/iobus socket |
| Tạo | `apps/core/application/programming/programming_sim_worker_main.cpp` | `mkddc-programming-sim-worker` | compiler/artifact executor interfaces | OutputWriter/device/production SHM |
| Tạo | `apps/core/application/programming/simulation/*` | private scheduler/clock/images | deterministic runtime primitives | singleton production state |
| Sửa | root `CMakeLists.txt` hoặc owned CMake target | worker executable/tests | isolated target link list | link production drivers |
| Tạo | `platform/systemd/mkddc-programming-sim-worker@.service` hoặc supervisor-equivalent policy | per-session sandbox | dedicated UID/cgroup/seccomp | auto-restart persistent service |
| Tạo | `apps/web-ui/src/features/programming/simulation/*` | controls/read model | generated API/capability | local browser executor |

Đường dẫn Target có thể được Architect điều chỉnh khi pin, nhưng ownership,
forbidden dependency và contract behavior không được làm yếu đi.

### 9.4 Test/evidence file map

| Layer | File hiện có/sẽ mở rộng | Test Target |
|---|---|---|
| Contract | `scripts/verify_programming_pgm02_contract.py`, OpenAPI sync tests | schema/authority/generator/hash |
| BE application | `draft_v2_test.go`, `library_test.go`; target `references_test.go/refactor_test.go/simulation_test.go` | typed ops, atomicity, state/fault |
| HTTP/security | `router_test.go`, `security_matrix_test.go`, `contract_sync_test.go` | routes/RBAC/idempotency/errors |
| Compiler/Core | `test_st_pou_registry.cpp`, `test_st_fbd_compile.cpp`; target sim worker tests | anchors/order/determinism/isolation |
| FE unit | `ProgrammingRoutes.test.tsx`, `DesignWorkspacePage.test.tsx`, FBD/editor tests | resolver/modes/state/undo |
| Browser | `apps/web-ui/e2e/programming-real.spec.ts` | real BE save/read-back/LIVE/role |
| Target/HIL | controlled Test Result path do QA/V&V pin | producer chain, zero physical output |

## 10. Verification — `DD-11`

### 10.1 Design obligation Target Candidate

`DDO-PGM02-001..015` là **design obligation nội bộ của hồ sơ**, dùng để nối một
quyết định thiết kế với source/test. Chúng không mang prefix `REQ` và không phải
canonical requirement. Candidate SRS đã thêm bảy requirement PGM-02, đưa tổng
từ 82 lên 89; bảng dưới ánh xạ DDO vào các requirement mới và baseline hỗ trợ.
Exact pin vẫn phải được Product/System Architect disposition trước gate của
increment liên quan.

| Design obligation | Nghĩa vụ Candidate | Nguồn canonical/priority |
|---|---|---|
| `DDO-PGM02-001` | Route canonical/legacy resolver không đoán Project/POU và giữ deep-link fields | `SYS-REQ-PROG-116`, `SWR-REQ-PROG-FE-119`; P0 R1 |
| `DDO-PGM02-002` | Public contract phân biệt objectId/programId và hai identity tuple | `SWR-REQ-PROG-BE-116`, `SWR-REQ-PROG-CORE-117`; P0 all |
| `DDO-PGM02-003` | Draft public schemas/operations typed, v1 compatible, ETag/idempotent read-back | `SWR-REQ-PROG-BE-116`; baseline `SYS-102`, `FE-110`, `BE-101/102`; P0 R1 |
| `DDO-PGM02-004` | SYSTEM/PROJECT Library chiếu signature authoritative; no FE fallback | `SWR-REQ-PROG-BE-116`, `SWR-REQ-PROG-FE-119`; baseline `SYS-110`; P0 R1 |
| `DDO-PGM02-005` | Rename semantic atomic; delete block all refs; references snapshot query | `SWR-REQ-PROG-BE-116`; baseline `SYS-109`, `BE-115`; P0 R1 |
| `DDO-PGM02-006` | Check trả SOURCE/FBD/POU/GLOBAL anchor stable | `SWR-REQ-PROG-BE-116`, `SWR-REQ-PROG-FE-119`; baseline `FE-103/104`, `BE-103/104`; P0 R1 |
| `DDO-PGM02-007` | Quick insertion là một editor transaction/undo và giữ FBD port order/layout | `SWR-REQ-PROG-FE-119`; P1 R1 |
| `DDO-PGM02-008` | LIVE source/value chỉ render khi Active/document/value tuple coherent | `SWR-REQ-PROG-BE-116`, `SWR-REQ-PROG-CORE-117`, `SWR-REQ-PROG-FE-119`; P0 R2 |
| `DDO-PGM02-009` | LIVE stale/offline/mismatch fail closed, read-only, ≤10 Hz | `SYS-REQ-PROG-116`, `SWR-REQ-PROG-FE-119`, `SWR-REQ-PROG-CORE-117`; P0 R2 |
| `DDO-PGM02-010` | Simulation dùng ephemeral isolated worker, zero production output path | `SYS-REQ-PROG-116`, `SWR-REQ-PROG-CORE-118`; P0 R3 |
| `DDO-PGM02-011` | Mọi Simulation mutation admin-only server-side và audit; reads scoped viewer+ | `SWR-REQ-PROG-BE-117`, `SWR-REQ-PROG-FE-119`; P0 R3 |
| `DDO-PGM02-012` | Virtual time dùng GCD; Step snapshot/run-all-due/one-commit/increment/pause deterministic | `SWR-REQ-PROG-CORE-118`; P0 R3 |
| `DDO-PGM02-013` | Virtual input chỉ từ manifest allowlist, typed/unit/range, denied kinds fail closed | `SWR-REQ-PROG-BE-117`, `SWR-REQ-PROG-CORE-118`; P0 R3 |
| `DDO-PGM02-014` | Quota/timeout/TTL/restart/power fault cleanup không ảnh hưởng Active/LKG | `SWR-REQ-PROG-BE-117`, `SWR-REQ-PROG-CORE-118`, `NFR-REQ-PROG-112`; P0 R3 |
| `DDO-PGM02-015` | Responsive/a11y/performance/capability/rollback tách theo increment | `SWR-REQ-PROG-FE-119`, `NFR-REQ-PROG-112`; P1 all |

### 10.2 Requirement → test matrix

| Scenario / req | Fixture/precondition | Bước và ca lỗi | Kỳ vọng định lượng | Target và evidence | Thẩm quyền ký |
|---|---|---|---|---|---|
| `TC-PGM02-ID-01` / `DDO-PGM02-002` | objectId khác programId/name | select/rename/delete/deep-link | đúng POU 100%; runtime join chỉ programId sealed; no inference | Host unit+contract | BE+FE+Compiler |
| `V-PGM02-ROUTE-01` / `DDO-PGM02-001` | 0/1/2 Projects; invalid IDs; legacy queries | open 2 legacy + canonical | resolver đúng 4 cases; giữ mọi allowlisted query; 0 redirect loop | FE unit + browser | FE+UX+QA |
| `V-PGM02-DRAFT-01` / `DDO-PGM02-003` | Draft v1/v2, 15 op fixtures | GET/PATCH/save/replay/conflict | typed round-trip; first write v2 deterministic; same key same response; stale ETag 409 zero mutation | Contract+Go integration+real BE | BE+QA |
| `TC-PGM02-QL-01` / `DDO-PGM02-004` | SYSTEM registry generated | compare C++/Go/OpenAPI/TS | 100% entryId/version/signature/hash equal | Generator/contract | Compiler+BE+FE |
| `TC-PGM02-QL-02` / `DDO-PGM02-004` | 100 entries/search fixture | rank 20 runs | byte-identical order 20/20 | FE unit | FE+QA |
| `TC-PGM02-QL-03` / `DDO-PGM02-007` | FB generic resolved | insert declaration+call; Undo | one transaction; one Undo removes all; port order canonical | Editor unit | FE+Compiler |
| `TC-PGM02-QL-04` / `DDO-PGM02-004` + `DDO-PGM02-007` | chooser cancel/type mismatch/unavailable signature | attempt insert | zero document mutation; Recent unchanged | FE negative | FE+QA |
| `V-PGM02-REF-01` / `DDO-PGM02-005` | ST/FBD/reference graph | query pagination by target | exact source/target/kind/anchor; deterministic cursor; max 500 | Go/Core integration | BE+Compiler |
| `V-PGM02-REF-02` / `DDO-PGM02-005` | rename with declarations/calls/typeRef/layout | success + parser unavailable + concurrent ETag + delete referenced | success rewrites all and preserves IDs/layout/order; each failure zero mutation | Go/Core fault | BE+Compiler+QA |
| `V-PGM02-DIAG-01` / `DDO-PGM02-006` | ST syntax/type error each POU kind | Check/navigate | exact objectId,line,column,length; legacy alias never joins runtime | Compiler→BE→FE integration | Compiler+BE+FE |
| `V-PGM02-DIAG-02` / `DDO-PGM02-006` | FBD node/port/wire errors | Check/click | exact network plus narrowest node/port/wire UUID; malformed anchor fail closed | Core/BE/FE | Compiler+FE+QA |
| `TC-PGM02-MODE-01` / `DDO-PGM02-015` | viewer/operator/admin; flags combinations | switch modes/direct API | matrix exact; server 403 authoritative; disabled reason visible | Browser+HTTP security | Security+UX+QA |
| `TC-PGM02-LIVE-01` / `DDO-PGM02-008` | coherent Active/artifact/observations | open source/overlay/Trace | exact tuple; monotonic sequence; render ≤10 Hz | producer→IPC→BE→FE target integration | Core+BE+FE+QA |
| `TC-PGM02-LIVE-02` / `DDO-PGM02-008` + `DDO-PGM02-009` | cutover Active during stream + sequence gap | observe switch | old overlay cleared ≤1 render cycle; Trace terminated; full rejoin | concurrency/fault + TSAN where applicable | Runtime+QA |
| `TC-PGM02-LIVE-03` / `DDO-PGM02-009` | missing/stale/offline samples | render each state | no fake 0; stale has timestamp/badge; offline/unavailable null/em dash | unit+browser+target fault | FE+Core+QA |
| `TC-PGM02-SIM-01` / `DDO-PGM02-010` + `DDO-PGM02-015` | capability absent/version mismatch/partial deploy | request SIM | mode UNAVAILABLE; 0 create calls/worker | contract+browser | BE+FE+QA |
| `TC-PGM02-SIM-02` / `DDO-PGM02-010` | dirty buffer hash differs Saved Draft | create session | SAVE_REQUIRED; 0 session/snapshot/process | BE integration | BE+QA |
| `TC-PGM02-SIM-03` / `DDO-PGM02-012` | periods 1/5/30 s; multiple due t=0 | one Step | baseTick 1000 ms; one input snapshot; stable due order; one output commit; time +1000; PAUSED | worker unit+integration | Runtime+QA |
| `TC-PGM02-SIM-04` / `DDO-PGM02-012` | same sealed snapshot/inputs | reset+run 100 times at 1×/10×/60× | output/trace hash identical 100/100 and across speeds | worker determinism target | Runtime+QA |
| `TC-PGM02-SIM-05` / `DDO-PGM02-010` | sandbox probes + instrumented target/HIL | create/run/step/input/reset/crash/expiry | all production opens denied; Active/LKG/output counters/hash unchanged; physical AO/DO/relay unchanged | Target+HIL+physical-I/O formal Test Result | Security+Runtime+Controls+Test Authority |
| `TC-PGM02-SIM-06` / `DDO-PGM02-011` | viewer/operator tokens | call create, run, pause, step, reset, input, stop | 14/14 role-action attempts 403; 0 DB/worker mutation; security audit each | HTTP negative+audit | Security+BE+QA |
| `TC-PGM02-SIM-07` / `DDO-PGM02-013` | denied kinds + wrong type/unit/range/NaN/overflow | PUT input | 422 stable code; prior value and both sequences unchanged | BE/worker negative | BE+Runtime+QA |
| `TC-PGM02-SIM-08` / `DDO-PGM02-014` | RSS/CPU/rate/idle/hard TTL/timeout/crash/restart | exceed each limit/fault | correct QUOTA/FAILED/EXPIRED; worker/FD reaped; no Active delta | Target fault/resource | Runtime+Security+QA |
| `TC-PGM02-RESP-01` / `DDO-PGM02-015` | 1280×750, 1024, 768, 390 px | all main/permission/error states | correct layout; <768 has zero mutation controls | Browser screenshots+DOM | UX+FE+QA |
| `TC-PGM02-A11Y-01` / `DDO-PGM02-015` | keyboard, reduced motion, screen reader/axe | full flow ST/FBD/modes/drawers | no critical violation; visible focus ≥2 px; contrast ≥4,5:1 | Browser/a11y report | UX+QA |
| `TC-PGM02-RB-01` / `DDO-PGM02-015` | each flag on/off + mixed versions | rollback each increment | capability false as required; Draft/Revision/Active/LKG preserved; sessions stopped/reaped R3 | Integration+deploy rehearsal | Ops+QA+Release |

### 10.3 Evidence class và pass authority

| Evidence | Chứng minh được | Không chứng minh |
|---|---|---|
| Unit/contract/static | logic/schema/dependency trong host | target scheduling, isolation, physical output |
| Go/C++ integration | producer-consumer trong test process | deployment/version mismatch thật |
| Browser real BE | UI, network, read-back, role affordance | server security nếu không có negative API; Core/HIL |
| Target | binary/service/policy trên controller | physical output nếu không instrument/HIL |
| HIL/physical I/O | đường phần cứng và zero-output | release nếu chưa Test Authority/risk disposition |
| Formal Test Result | evidence reviewed, signed, traceable | Product/Architect/release approval khác |

Host/browser result chỉ cập nhật evidence class tương ứng; không tự nâng
`IMPLEMENT_READY` hoặc `RELEASE_READY`.

## 11. Compatibility, deploy và rollback — `DD-12`

### 11.1 Feature flag/capability

| Increment | Flag Target | Default | Enable guard | Rollback |
|---|---|---|---|---|
| R1 | `programsWorkspaceV2` | false | OpenAPI/generator/BE/FE R1 compatible + tests/pin | Route/workspace cũ; giữ Draft server |
| R2 | `programsLiveV2` | false | R1 true + Core IPC/BE/FE coherent protocol + target evidence | Tắt overlay/Trace mới; source read-only; Core control giữ |
| R3 | `programsSimulation` | false | R2 true + worker/policy/API/RBAC/isolation evidence | Ngăn create; stop/expire/reap session; capability false |

Server capability là authority cuối; FE flag không thể làm server mutation
available. Rollback R2/R3 không tắt Core control hoặc đổi Active/LKG.

### 11.2 Thứ tự deploy

**R1**

1. Pin Product/SRS/Architecture/DDD/UX/contract/risk/trace/VVP/Plan task.
2. Merge OpenAPI schemas + generators + compatibility tests.
3. Deploy BE typed response/reference/refactor/signature với capability false.
4. Deploy FE consumer/route resolver/assets với flag false.
5. Chạy migration/restart/expiry R1 tests và real-BE browser/read-back; replay
   cùng key/hash phải trả cùng full typed resource content.
6. Bật canary capability/flag; quan sát; sau approval mới mở rộng.

**R2**

1. Deploy/version Core IPC producer tại safe-boundary lifecycle đã được chứng minh.
2. Deploy BE decoder/join/Trace pin, giữ capability false nếu Core mismatch.
3. Deploy FE LIVE state; target integration/fault/concurrency tests.
4. Bật `programsLiveV2` độc lập; không liên quan Commission enablement.

**R3**

1. Cài worker binary, dedicated user/policy/cgroup/seccomp và migration metadata;
   capability vẫn false.
2. Deploy BE supervisor/API với worker protocol handshake.
3. Deploy FE controls disabled until capability.
4. Chạy RBAC/audit/isolation/quota/restart và target/HIL zero-output Test Result.
5. Chỉ sau approvals mới bật canary một controller; v1 vẫn một session/controller.

### 11.3 Partial deploy matrix

| Tình huống | Hành vi bắt buộc |
|---|---|
| FE mới, BE cũ | R1/R2/R3 surface tương ứng UNAVAILABLE; legacy read còn hoạt động |
| BE mới, FE cũ | Additive fields ignored; legacy Draft route vẫn tương thích |
| BE R2 mới, Core IPC cũ | `live.supported=false`; không suy source/value |
| BE R3 mới, worker thiếu/sai version | `simulation.supported=false`; create UNSUPPORTED, 0 spawn |
| Worker/policy có nhưng FE chưa | Không user surface; direct API vẫn RBAC/flag fail closed |
| Asset/handoff revision lệch | Không mở review/enable gate UI |

### 11.4 Backup, restart, rollback và dữ liệu giữ nguyên

- Trước schema migration R3: backup SQLite theo runbook hiện hành và verify
  restore; migration additive, down rollback bỏ bảng session chỉ sau khi mọi
  worker reaped và metadata exported theo policy.
- Rollback không xóa Project, Saved Draft, sealed Revision, artifact, Active,
  LKG, audit hoặc Check result.
- R1 route rollback giữ legacy redirects không loop; deep-link chưa support hiện
  error rõ, không chọn POU khác.
- R2 rollback hủy subscription/overlay store và trace mới; không gửi lifecycle
  command.
- R3 rollback: set capability false → reject create → STOP/expire existing →
  kill/reap verified → remove service/policy/binary; session process image mất
  là expected vì ephemeral.
- BE/controller reboot không restore virtual time/input/output; session cũ
  EXPIRED và ID không reuse.

### 11.5 Rollback trigger

- schema/generator drift; R1 semantic mutation không zero-failure;
- LIVE tuple mismatch render sai hoặc Trace splice revision;
- any server RBAC bypass/audit gap;
- worker mở được production handle, Active/output delta, nondeterministic hash;
- quota/expiry cleanup leak; protocol/capability mismatch không fail closed;
- critical a11y/safety-state visual defect.

## 12. Blocker, risk, lịch sử và phê duyệt — `DD-13`

### 12.1 Disposition thiết kế và evidence còn mở

| ID / trạng thái | Owner | Ảnh hưởng | Gate | Điều kiện đóng implementation/evidence |
|---|---|---|---|---|
| `OD-PGM02-V22-001 — RESOLVED` | Product Owner/CTO + System Architect | Exact authority revision | `T59-801=DONE`; `PLAN_READY=PASS` | Candidate review input ở `413a043`; revision post-authorization được khóa bởi manifest v1.49 + SHA-256 ngoài manifest trong `DEC-PROG-REGISTER-001` §1.2; thay đổi tiếp theo đi qua change control |
| `OD-PGM02-V22-002 — RESOLVED` | System Architect + FE Lead | R1 resolver/deep links | R1 | Implement canonical route `/eng/programming/programs?project=...`, redirect/query behavior và tests; không mở lại lựa chọn Product |
| `OD-PGM02-V22-003 — RESOLVED` | System Architect + UX Lead | DD-08/R1 responsive/safety | R1 | Implement asset desktop/mobile cùng a11y tests; dưới 768 px có 0 mutation control |
| `OD-PGM02-V22-004 — AUTHORIZED` | UX Lead + Document Control | FBD/ST visual authority | M3/R1 | Consumer review được `WAIVED FOR IMPLEMENTATION`; vẫn phải test states/ports/wires/responsive/focus trước verdict R1 |
| `OD-PGM02-V22-005 — IMPLEMENTATION PENDING` | BE Lead + Compiler Lead | R1 contract/source | R1 closeout | Contract/generated clients/stable errors/operation pin + positive/negative/fault tests |
| `OD-PGM02-V22-006 — IMPLEMENTATION/EVIDENCE PENDING` | Core/Runtime + BE Lead | R2 source/value truth | R2 closeout | Safe-boundary atomic lifecycle, active/artifact pin, monotonic observation, Trace termination, TSan/fault và target read-back evidence |
| `OD-PGM02-V22-007 — DESIGN RESOLVED / IMPLEMENTATION PENDING` | Product + System Architect + Security + Runtime | Toàn R3 | R3 closeout | `ADR-053` Accepted; implement API/worker/isolation/RBAC/audit/limits và hậu kiểm security |
| `OD-PGM02-V22-008 — EVIDENCE PENDING` | QA/V&V + Test Authority + Controls/Safety + Release Authority | Không được claim R2/R3/release PASS | R2/R3 acceptance; `RELEASE_READY` | Chạy signed Test Results trên exact binaries/config/hash; risk residual disposition; release approval |
| `F-P59-GHOST-POU-001 — DECISION RESOLVED / IMPLEMENTATION PENDING` | Product Owner/CTO + Architect/Compiler/BE/Core | Draft→Check→package semantics R1 | `IMPLEMENTATION_CLOSE` và R1 closeout | Draft cho phép POU chưa schedule; Check/Package fail closed `PRG-ERR-CHECK-001` + `ST-POU-005`; implement packager/tests, cấm exclude/synthesize 1000 ms |

`candidate_pin_check.py` xác minh bytes của 17 hồ sơ Markdown trong manifest;
exact Candidate Git `413a043748dce3b44d2c5076412de761760ba17a` là pin bao
trùm contract/schema, `ADR-053`, handoff manifest và ba SVG theo
`AUTH-PROG-2026-08-24-05`. Hai lớp pin đã mở `PLAN_READY`; mọi revision tiếp theo
phải cập nhật manifest/change record nhưng không được tự suy Test Result hay
release PASS.

### 12.2 Risk register Candidate

| Risk | Xác suất / mức độ | Control thiết kế | Residual hiện tại | Owner / gate / evidence |
|---|---|---|---|---|
| Authority drift route/mobile/simulation | Cao / P0 | exact-hash baseline, scoped flags | Cao, open | Architect + Product / AUTH-05 + từng increment / implementation và regression evidence |
| objectId/programId join nhầm | Trung bình / P0 | typed identity + sealed mapping + tuple | Cao tới khi R2 test | BE+Core / R1/R2 / ID+LIVE tests |
| Rename làm source không compile hoặc sai reference | Cao / P0 | exact graph, atomic plan, fail closed | Cao tới R1 | Compiler+BE / R1 / REF tests |
| SYSTEM signature lệch FE/BE/compiler | Trung bình / P0 | registry projection/hash, no fallback | Trung bình | Compiler+BE / R1 / QL-01 |
| LIVE hiển thị source/value khác Active | Cao / P0 | runtime-first join, pin, clear/rejoin | Cao | Runtime+BE+FE / R2 / LIVE-01/02 |
| Trace splice qua cutover | Trung bình / P0 | revision/artifact pin, terminate | Cao | Runtime / R2 / LIVE-02 |
| Sim worker chạm physical output | Thấp nếu controls đúng / Catastrophic P0 | separate process, forbidden deps, sandbox, HIL | **Không chấp nhận** trước evidence | Security+Runtime+Controls / R3+release / SIM-05 |
| Sim semantics lệch production | Trung bình / P0 | production compiler/executor semantics + determinism hashes | Cao | Compiler+Runtime / R3 / SIM-03/04 |
| DoS/leak worker/session | Trung bình / P1 | one session, cgroup, TTL, rate, reap | Cao | Runtime+Security / R3 / SIM-08 |
| Server RBAC bypass qua direct API | Trung bình / P0 | middleware + application checks + audit | Cao | Security+BE / R3 / SIM-06 |
| Partial deploy tạo control giả | Trung bình / P0 | capability version fail closed | Trung bình | BE+FE+Ops / each increment / SIM-01+RB |
| Visual asset thiếu state an toàn | Cao / P1 | DD-08 blocker + renderable asset review | Cao | UX / M3+R1 / RESP+A11Y |
| Host evidence bị dùng claim target/release | Trung bình / P0 governance | evidence class + Test Authority | Trung bình | QA+Release / RELEASE_READY / formal records |

Không residual nào được hạ chỉ vì hồ sơ Candidate được tạo.

### 12.3 Trace end-to-end

```text
CR-PROG-PGM02-V22-001
  → AUTH-PROG-2026-08-24-05 / exact Candidate 413a043... / T59-801 DONE
  → 7 canonical SRS requirement PGM-02 + DDO-PGM02-001..015 nội bộ
  → PGM02-WORKSPACE-V1 Target + OpenAPI Target
  → T59-802 READY; T59-803..809 R1 ORDERED
  → T59-810..813 R2 ORDERED → T59-814..817 R3 ORDERED
  → TC-PGM02-* / V-PGM02-* 10
  → Host | Browser | Target | HIL | Physical-I/O Test Results
  → Risk residual disposition
  → IMPLEMENT_READY theo increment
  → RELEASE_READY riêng
```

### 12.4 Revision history

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.3 | 2026-08-24 | Ghi `AUTH-PROG-2026-08-24-05` pin exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`; nâng đúng `M3 REVIEW READY / AUTHORIZED FOR IMPLEMENTATION`, mở R1/R2/R3 theo dependency; chốt `F-P59-GHOST-POU-001` fail closed `ST-POU-005`; giữ consumer review waived, U13–U15 NOT_RUN và release NO-GO. |
| 0.2-candidate | 2026-08-24 | Khóa quy tắc exact pin hai lớp: manifest cho 17 hồ sơ Markdown và candidate Git commit SHA cho contract/schema/ADR/handoff/SVG; cấm dùng pin check 17/17 một mình để mở `PLAN_READY` hoặc code |
| 0.1 | 2026-08-24 | Tạo Detailed Design Target Candidate cho `PGM02-V22-WP-00`; source-map As-Built; contract/state/test/rollback R1 EDIT → R2 LIVE → R3 SIMULATE; giữ exact-hash pin và downstream gates PENDING/NO-GO |

### 12.5 Sign-off

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| Người soạn `PGM02-V22-WP-00` | SELF-REVIEWED M3 | DD-01..13 tự kiểm; link/source/harness report đính kèm change-set |
| Product Owner/CTO + System Architect | **AUTHORIZED FOR IMPLEMENTATION — Phạm Đình Chương, 2026-08-24** | `AUTH-PROG-2026-08-24-05`; exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`; không phải chữ ký M4/M5/Test Result |
| FE/UX Lead | **WAIVED FOR IMPLEMENTATION** | Hậu kiểm component/route/responsive/a11y/asset trong R1; không chặn code |
| BE/Compiler/Core/Security | **WAIVED FOR IMPLEMENTATION** | Hậu kiểm contract/ownership/isolation/error/forbidden dependency theo increment |
| QA/V&V/Test Authority | **WAIVED FOR IMPLEMENTATION; EVIDENCE PENDING** | U13–U15 giữ NOT_RUN; chỉ Test Authority được ký kết quả |
| Release Authority | NO-GO | Các increment qua gate, signed Test Results, risk residual và release package |

## 13. Tự kiểm `DD-01..DD-13`

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Metadata, exact Candidate, authority/disposition, evidence class, gate, revision history và sign-off đều có; trạng thái đúng M3, không nâng M4/M5 |
| `DD-02` Mục tiêu/phạm vi | PASS | `1` có outcome, actor/use case, in/out scope, constraints và success theo increment |
| `DD-03` As-Built | PASS | `2` dẫn file/symbol/route/schema có thật và tách Candidate/runtime gap |
| `DD-04` Target ownership | PASS | `3` khóa owner/input/output/consumer/process/thread/deployment/failure boundary |
| `DD-05` Data từng field | PASS | `4` định nghĩa Draft, Library, reference/anchor, LIVE tuple, session/input/observation, null/lifecycle/migration |
| `DD-06` Interface | PASS | `5` có path/payload/RBAC/timeout/retry/idempotency/concurrency/error/side effect/audit/compatibility |
| `DD-07` State/algorithm/timing | PASS | `6` có mode/session, transaction, LIVE join, GCD/Step, atomicity, resource, crash/restart/power path |
| `DD-08` UX hoặc operation flow | PASS | `7` có route, cây component, field/API/state/action/RBAC/copy, ba SVG Target renderable, responsive/a11y và luồng lỗi; asset đã được pin cho implementation, consumer review/test còn theo R1 và không bị nhầm thành As-Built |
| `DD-09` Error/safety/security | PASS | `8` có detect/code/held state/recovery/audit, malicious inputs, zero-output evidence plan |
| `DD-10` Repository mapping | PASS | `9` nêu file/symbol cần tạo/sửa, dependency được phép/bị cấm và test map |
| `DD-11` Verification | PASS | `10` có derived requirement→fixture/negative/fault/định lượng/evidence/pass authority; đây là kế hoạch, chưa claim result |
| `DD-12` Compatibility/deploy/rollback | PASS | `11` có flags/default, order, partial deploy, backup/restart/rollback trigger và dữ liệu giữ |
| `DD-13` Trace/risk/decision/sign-off | PASS ở lớp M3/authority | `12` ghi exact pin, risk, decision, waiver và sign-off; consumer review/Test Result/residual vẫn pending đúng lớp và không chặn implementation theo `AUTH-PROG-2026-08-24-05` |

### 13.1 Verdict của hồ sơ

- Maturity tự đánh giá: **`M3 — REVIEW READY / AUTHORIZED FOR IMPLEMENTATION`**.
- Không claim `M4 REVIEW CLOSED` hoặc `M5 APPROVED`; consumer/discipline review
  còn `WAIVED FOR IMPLEMENTATION`, không được điền giả chữ ký.
- Không claim As-Built, Test Result, CI, target/HIL, physical I/O hoặc release
  PASS cho R1/R2/R3; `RELEASE_READY=NO-GO`.
- `T59-801=DONE`, `T59-802=READY`; các task sau `ORDERED` và chỉ được thực thi
  khi dependency R1→R2→R3 thỏa.
