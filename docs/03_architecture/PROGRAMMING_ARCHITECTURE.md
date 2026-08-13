# Kiến trúc hệ thống Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `ARCH-PROG-001` |
| Phiên bản | 0.9 |
| Trạng thái | **M3 — APPROVED FOR IMPLEMENTATION** — 6/6 ADR `Accepted` theo `AUTH-PROG-2026-08-11-03`; maturity M4/M5 không dùng làm blocker code |
| Ngày | 2026-08-13 |
| Chủ quản | Software/Runtime Architect |
| Reviewer | Controls/Safety, FE, BE, FW-SOM, FW MCU, HW, Security, Ops, Verification |
| Approver | Product Owner + System/Runtime Architect |
| Requirement | `SRS-PROG-001` |
| Nguồn | Product v2.2; ADR-005/020/021/023; ADR-026..031 (`Accepted`); As-Built source 2026-08-09 |
| Phạm vi | Target Rev A và khoảng trống chuyển từ graph production sang Program Runtime |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **tiến trình nào sở hữu cái gì**: ai giữ dữ liệu có thể thay đổi, ai được ghi ra output vật lý, ai được phép chết mà hệ thống vẫn điều khiển. Mọi tranh cãi “module này gọi thẳng module kia có được không” giải quyết ở đây. |
| 2. Ai phải đọc file này? | Bắt buộc với System Architect, Core/BE/FE/IO lead, Safety và Ops. Đọc trước khi đọc bất kỳ Detailed Design nào — vì các file đó giả định ranh giới trong file này là đúng. |
| 3. Hệ thống hiện tại đang có gì? | Bốn tiến trình đã chạy thật; mặc định Local logic vẫn do **graph** sở hữu. P3/P4 source/host đã dựng scheduler cố định, BE operation coordinator, UDS peer-checked và `ProgrammingRuntimeCoordinator`; cutover chỉ đổi owner tại safe boundary, first-output thành công mới nâng LKG, restart đọc checkpoint CRC. Flag vẫn `OFF`. |
| 4. Thiết kế mới thay đổi điều gì? | Thêm Programming vào `mkddc-web` (authoring, compile, orchestration) và vào `mkddc-core` (nạp artifact, chạy Program). **Không** thêm đường ghi tắt: mọi output Program đi qua priority resolver mức Local logic 5. `mkddc-iobus` và MCU **không đổi ownership** — Commission không được restart iobus. |
| 5. Team phải sửa module/contract nào? | §14 ánh xạ từng component target về repository. Tóm tắt: BE thêm package Programming trong `mkddc-web`; Core thêm loader + Program executor cạnh ScanLoop; FE thêm `apps/web-ui/src/features/programming/`; iobus/MCU chỉ nhận thêm yêu cầu **không được gián đoạn** (`max_iop_poll_gap <200 ms`). |
| 6. Điều gì còn bị chặn? | Không còn blocker source P3/P4. Production `Active` vẫn bị chặn bởi feature flag, P5/P6, 32/32 Test Result, target/HIL/electrical/power-cut/IOP timing và residual acceptance. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §17. Host fault/restart/cutover tests và full CTest 1002/1002 PASS hỗ trợ `VS-PROG-011/015/030`; `VS-PROG-012/014/015/030` phần target/HIL vẫn **chưa chạy**, nên không mở release. |

Vì sao phải có “một owner duy nhất”: nếu graph và Program cùng đề xuất giá trị
cho một output ở mức 5, thiết bị sẽ nhận lệnh không xác định — đây là
`RSK-PROG-001`, mức 15. Nên cutover chỉ có hai trạng thái hợp lệ là `GRAPH_ONLY`
và `PROGRAM_ONLY`; yêu cầu chạy song song phải bị từ chối, không phải bị hòa giải.

## 1. Mục tiêu kiến trúc

Cho phép controls engineer thiết kế ST/FBD, Check, đưa Revision vào vận hành và
bảo trì trên Web, trong khi đường control vẫn deterministic, fail closed và độc
lập với FE/BE. Kiến trúc không thêm core process mới ở Rev A; Programming được
phân bổ vào ba process đã chốt bởi ADR-005 và source layout ADR-021. Phân bổ này
thay proposal `mkddc-program-service`/`mkddc-program-core` thành module trong
`mkddc-web`/`mkddc-core`; muốn thêm daemon phải có ADR mới.

## 2. System context và trust boundary

Sơ đồ dưới đây là **Target Design**. As-Built 2026-08-09 vẫn dùng HTTP cổng
8081, graph runtime mặc định và Programming flag OFF; không được đọc sơ đồ target
như bằng chứng đã triển khai.

```text
Trình duyệt
  │ HTTPS/REST/WS + session/RBAC
  ▼
mkddc-web (Go + React)
  ├─ Draft/Revision store
  ├─ Check/Compiler worker ngoài RT
  ├─ Artifact registry + audit
  └─ Commission coordinator
          │ versioned local IPC, peer credential, operation ID
          ▼
mkddc-core (C++ RT owner)
  ├─ verified artifact loader
  ├─ base control step + one Task Rev A
  ├─ ST/FBD common IR executor + RETAIN
  ├─ priority/interlock/safe-state
  └─ authoritative runtime/monitor/trace
          │ IO SHM + output command
          ▼
mkddc-iobus ── Kinexus-IOP/UART ── STM32 ── ADC/DAC/relay
  └─ Modbus RTU Bus→Device→Point
```

Trust boundaries:

- Browser input, bundle import, ST/FBD source và config là dữ liệu không tin cậy.
- Compiler output chỉ được tin sau loader verify độc lập tại core.
- Web success không phải runtime truth; core read-back là authority.
- MCU là safety/failure boundary độc lập cho mất IOP trong 200 ms.

## 3. Phân bổ trách nhiệm

| Mutable state/quyết định | Owner duy nhất | Consumer |
|---|---|---|
| Project, Draft, immutable Revision | `mkddc-web` BE | FE, compiler coordinator |
| Source ST/FBD, mapping, Task config, library manifest | Revision store | compiler, FE |
| Check result và change manifest | BE từ canonical Revision | FE, Commission |
| Artifact bytes + metadata | BE artifact registry; immutable | core loader |
| Active/LKG/candidate runtime identity | `mkddc-core` | BE/FE read model |
| Base step, due Task, WCET/overrun | `mkddc-core` | diagnostics |
| Point Table và priority winner | `mkddc-core` | Program, Web, BACnet |
| Modbus polling/write lifecycle | `mkddc-iobus` | core Point Table |
| Physical sampling/actuation/safe-timeout | STM32 | iobus diagnostics |
| User authorization và audit | `mkddc-web` | mọi mutation |
| Alarm truth | alarm authority hiện hữu | Programming chỉ link |

## 4. Lifecycle và state machine

```text
DRAFT --Check PASS--> CHECKED --build/verify--> READY
  │                       │                      │
  └─Save/Error (no RT)    └─FAIL (no RT)         └─Commission operation
                                                     │
                                 STAGED --safe boundary--> ACTIVE_PENDING_FIRST_CYCLE
                                                     │ PASS
                                                     ▼
                                                   ACTIVE/LKG
                                                     │
                                      Restore Previous (same verify path)
```

Bất biến:

1. Revision bất biến; sửa luôn tạo Draft/Revision identity mới.
2. Chỉ một Commission/Restore operation được phép trên một controller.
3. `HTTP 2xx` chỉ xác nhận request được nhận; FE chỉ kết luận khi status core
   trả đúng `activeRevision` và `operationId`.
4. Candidate lỗi không thay active/LKG.
5. LKG chỉ được nâng sau cycle đầu hoàn tất không fault.

## 5. Base control step

```text
1. Capture một ClockSnapshot + coherent IO/Point snapshot
2. Cập nhật quality/freshness và Modbus snapshot
3. Xử lý command manual/BACnet/Schedule
4. Dispatch đúng Task nếu đến hạn; Program đọc frozen process image
5. Stage program_value mức 5
6. Resolve priority → interlock → safe-state
7. Commit output đúng một lần; tiếp tục IOP poll
8. Publish snapshot/metrics ngoài phần thiết yếu
9. Kick watchdog sau khi step hoàn tất
```

Task period `1/5/30 s` là cadence dispatch, không phải sleep của base step. Base
step phải đủ ngắn để IOP không có khoảng cách poll `>=200 ms`; mục tiêu có margin
`<=100 ms`. Compiler, DB, serialization lớn và trace persistence không nằm RT path.

## 6. Cutover graph → Programming

| State | Quyền Local logic | Commission |
|---|---|---|
| `GRAPH_ONLY` | `GraphRuntime` | chỉ được tạo/check Draft; Commission Programming bị khóa |
| `PROGRAM_ONLY` | Program Runtime | graph không execute và không sở hữu scan period |
| `DUAL_INVALID` | giữ LKG hiện hành | reject `PRG-ERR-CUTOVER-001`, audit security/engineering event |

Cutover lần đầu bắt buộc backup graph, compatibility report, mapping review,
output/RETAIN impact, manual override inventory, confirmation mạnh và rollback
plan. Không chạy graph và Program song song để “so sánh” trên output thật.

## 7. Activation, output continuity và arbitration

- Runtime chụp `previous_program_value` cho từng binding trước swap.
- First cycle của Revision mới phát cùng giá trị mức 5 trong độ phân giải binding.
- Resolver vẫn quyết định `actual_value`; override mức 1–4 không bị sao chép vào
  state hoặc integrator của Program.
- PI/PID back-calculate khi mức 5 thắng nhưng bị limit; freeze khi thua priority.
- Binding mới/state không tương thích phải có initial/transition policy được
  Check xác nhận; không dùng zero/actual/safe-default ngầm.
- Activation không restart iobus và không chặn IOP poll.

## 8. Availability và failure containment

| Lỗi | Hành vi bắt buộc | Quan sát |
|---|---|---|
| FE đóng/reload | Active không đổi; Draft lấy lại từ BE | FE reconnect, no replay |
| BE restart | Core tiếp tục active; operation được reconcile | operation/audit bền vững |
| Compiler timeout/crash | Check fail; không stage | diagnostic + resource metrics |
| IPC timeout khi Commission | kết quả `UNKNOWN`, query operation/core | không optimistic retry |
| Artifact corrupt/wrong target | loader reject; LKG giữ | error code + audit |
| Task overrun | warning rồi fault Task theo policy | không tự plant safe-state |
| Core restart | MCU safe-timeout; core chỉ phục hồi artifact/LKG theo policy | boot reason, active/retain status |
| Iobus/IO freshness loss | SafetyManager quyết định safe-state | reason + affected Point |
| MCU mất frame hợp lệ 200 ms | AO/DO về safe behavior độc lập | diagnostic/safe counter |

## 9. Security architecture

- `viewer/operator/admin`; server authorize từng endpoint và action.
- CSRF/session/origin theo baseline Web; internal UDS kiểm peer credential.
- Mutation có idempotency key, base revision/ETag và correlation ID.
- Artifact dùng SHA-256/integrity ở Rev A; trusted-origin signing ngoài scope.
- Bundle import không nhận executable, path tuyệt đối, traversal, symlink hoặc
  decompression vượt quota.
- Audit không chứa password/token/private key/full artifact hoặc full source nếu
  không có policy bảo vệ riêng.

## 10. Deployment topology và dữ liệu

- Không thêm daemon `mkddc-program-*` ở Rev A trừ khi có ADR mới.
- Compiler worker thuộc Web package nhưng chạy process/sandbox/resource limit
  riêng, không chạy trong handler và không được có RT priority.
- Dữ liệu bền vững dưới config/data root hiện hành: DB/Revision, artifact, audit,
  RETAIN tách namespace; write atomic và backup/restore có manifest/checksum.
- Upgrade phải hỗ trợ code mới đọc schema cũ hoặc migration atomic có rollback;
  core cũ phải reject schema/artifact mới rõ ràng.

## 11. Xung đột phải đóng trước Active

Mỗi xung đột nay có **một ADR chủ quản**. System Architect Phạm Đình Chương đã
`ACCEPT` cả sáu theo `AUTH-PROG-2026-08-10-01`. Trạng thái chờ đồng phê duyệt đã
được supersede bởi `AUTH-PROG-2026-08-11-03`; cả sáu ADR hiện `Accepted`. Review
hậu kiểm và evidence vẫn được thực hiện trong task/verification, không chặn code.

| ID | Xung đột | ADR chủ quản | Quyết định cần có | Trạng thái 2026-08-11 |
|---|---|---|---|---|
| `ARCH-CONF-PROG-001` | supporting scheduler cho 8 Task/50–60000 ms, Product chỉ một Task/1–5–30 s | [ADR-026](../adr/ADR-026-programming-runtime-profile-va-validator-duy-nhat.md) | runtime profile và validator duy nhất | **Accepted** — `AUTH-PROG-2026-08-11-03`; evidence tạo trong implementation |
| `ARCH-CONF-PROG-002` | graph bootstrap đang sở hữu period và ST dependency là `nullptr` | [ADR-027](../adr/ADR-027-programming-bootstrap-va-quyen-so-huu-chu-ky-scan.md) | cutover/config/bootstrap contract | **Accepted** — `AUTH-PROG-2026-08-11-03`; evidence tạo trong implementation/release |
| `ARCH-CONF-PROG-003` | watchdog unit 6 s so với Task 30 s | [ADR-028](../adr/ADR-028-programming-cong-thuc-watchdog-theo-base-step.md) | base-step bound + watchdog formula/target evidence | **Accepted** — `AUTH-PROG-2026-08-11-03`; số đo `SCHED_FIFO` thuộc verification |
| `ARCH-CONF-PROG-004` | component overrun có `any_force_safe` | [ADR-029](../adr/ADR-029-programming-overrun-la-task-fault.md) | đổi thành task fault; SafetyManager condition độc lập | **Accepted** — `AUTH-PROG-2026-08-11-03` |
| `ARCH-CONF-PROG-005` | error code `API-E/IR-E/ST-*` hiện hữu so với `PRG-ERR-*` proposal | [ADR-030](../adr/ADR-030-programming-ma-loi-cong-khai-va-detail-code.md) | mapping/deprecation trong IFSPEC | **Accepted** — `AUTH-PROG-2026-08-11-03`; mapping evidence tạo trong implementation |
| `ARCH-CONF-PROG-006` | signature helper có source nhưng trusted-origin ngoài Rev A | [ADR-031](../adr/ADR-031-programming-integrity-mode-hash-only-rev-a.md) | chỉ integrity hash trong release profile | **Accepted** — `AUTH-PROG-2026-08-11-03`; security evidence tạo trong implementation/release |

## 12. Tiêu chí review kiến trúc

- Mỗi mutable state có đúng một owner và đường read-back.
- Web/HMI không nằm control path, không bypass priority/safety.
- Contract producer/consumer/version/failure/migration/rollback đầy đủ.
- Allocation/resource/WCET/IOP continuity có verification owner.
- Không requirement nào được đánh PASS chỉ bằng tài liệu hoặc host unit test.

## 13. As-Built có dẫn chứng và gap

| Ranh giới | Source/contract hiện tại | Hành vi đã xác nhận | Gap so với Target |
|---|---|---|---|
| Core bootstrap | `apps/core/bootstrap/main.cpp`, `programming_cutover.hpp` tại `10d9ad6` | dựng topology scheduler `main/program-main` trước scan; mode mặc định GRAPH_ONLY; tạo coordinator + endpoint Programming UDS khi runtime được bật | feature flag Web vẫn OFF; chưa deploy/cutover trên target |
| Base step | `scan_loop.*`, `st_scheduler.*` tại `a831a0d..10d9ad6` | phase-locked dispatch, process-image atomic, exclusive GRAPH/PROGRAM owner và lifecycle hook tại cùng safe boundary | timing/WCET/IOP gap target chưa đo |
| ST/IR runtime | `apps/core/application/{st,programming}` | profile REV_A, prepare/stage/commit/abort, first-output LKG promotion, journal/checkpoint/rollback/recovery | power-cut eMMC và HIL chưa chạy |
| Build boundary | `apps/core/CMakeLists.txt` | `st_compiler_lib` tách khỏi `mkddc-core`; CLI compile/validate được build | CLI chưa được packaging/called bởi BE; compiler isolation/timeout chưa có |
| Internal contract | `contracts/ipc/programming_v1`, `program_ipc_server.*`, `program_ipc_unix.*` | STATUS/OPERATION_STATUS/STAGE/RESTORE/ACTIVATE qua bounded frame, deadline, version và peer credential | target socket ownership/group cần deploy read-back |
| Core Web IPC | `/run/mkddc/programming-v1.sock` | endpoint riêng Programming mode `0660`, `SO_PEERCRED`, reject peer/frame/version/path sai | target service identity và fault injection liên tiến trình chưa có Test Result |
| BE | `apps/web-api/internal/programming/{application,store,artifact,coreipc,transport}` | SQLite v5, durable Commission/Restore, lease/reconcile, staging an toàn và terminal record/audit | feature OFF; target migration/restart chưa diễn tập |
| API contract | `contracts/openapi/openapi.yaml` | 25 operation; Project/Check/bundle và Commission/Restore/status handler có source | FE P5 và target E2E chưa có Test Result |
| FE | `apps/web-ui/src/features/dashboard/ProgrammingPage.tsx`, `App.tsx`, `NavRail.tsx` | legacy graph demo, route bị gate `LEGACY_GRAPH_DEMO_ENABLED` | không có PGM-01..06, ST/FBD workflow hoặc runtime authority live |
| FW MCU/IOP | `contracts/iop/iop_protocol.h`, `firmware/stm32/*`, `apps/iobus/*` | sampling/actuation/IOP/safe-timeout substrate | Programming-specific HIL, poll-gap/hold-last/power-loss evidence còn RED |
| Transport security | `apps/web-api/internal/app/main.go`, `platform/systemd/mkddc-web-pi.service` | As-Built HTTP `:8081`, chưa có TLS termination | Target HTTPS/secure headers/certificate lifecycle bị chặn bởi Security Design |

## 14. Target component và ánh xạ repository

| Component target | Owner/process | File/module phải tạo hoặc sửa | Dependency được phép | Dependency bị cấm |
|---|---|---|---|---|
| Programming domain/store | `mkddc-web` | tạo `apps/web-api/internal/programming/{domain,store,revision,manifest}.go`; wiring tại `internal/app/programmingapi.go` và `http.go` | `internal/auth`, config root, stdlib/DB package đã phê duyệt | import UI, gọi Core trong transaction lưu Draft |
| Compiler coordinator | `mkddc-web` child process | tạo `internal/programming/compiler.go`; package `mkddc-st-validate/compile` qua `platform/packaging/install.sh` | argv cố định, file descriptor/temp dir riêng, timeout/quota | shell eval, chạy trong HTTP goroutine không giới hạn, RT priority |
| Operation coordinator | `mkddc-web` | tạo `internal/programming/operation.go`; durable journal/store | CoreClient, idempotency, audit | optimistic success, auto retry mutation sau timeout |
| REST/WS adapter | `mkddc-web` | `internal/app/programmingapi.go`, `ws.go`, `contracts/openapi/openapi.yaml` | domain/service methods; generated FE types sau contract freeze | business rule từ message string |
| Programming UI | React FE | tạo `apps/web-ui/src/features/programming/`; route tại `src/app/App.tsx`; nav tại `shared/components/NavRail.tsx`; API tại `shared/api/programming.ts` | shared auth/i18n/components/API client | `shared/demo/` trong live path, local active truth |
| Runtime profile/config | `mkddc-core` | profile đã nằm ở `application/st/st_scheduler.*`; tạo `adapters/config/programming_config.*` và sửa `bootstrap/main.cpp` ở Task 306 | generated profile, graph migration reader | parser/compiler/file/DB/network trong scan |
| Artifact/runtime lifecycle | `mkddc-core` | sửa `st_scheduler.*`, `st_control_api.*`, `st_retain.*`; thêm operation journal adapter nếu approved | bounded loader/executor, monotonic clock | direct IOP/SHM output bypass resolver |
| Core IPC adapter | `mkddc-core` | sửa `adapters/ipc/web_ipc.*`; schema machine-readable trong `contracts/config/` | versioned UDS + peer credential | unversioned payload, accept unknown fields silently |
| Cutover | `mkddc-core` | sửa `bootstrap/main.cpp`, `scan_loop.*`, `config_reload.*`, `graph_runtime.*` | `GRAPH_ONLY/PROGRAM_ONLY`, backup manifest | graph + Program cùng đóng góp mức 5 |
| Packaging/operations | platform | `platform/packaging/{install,rollback}.sh`, `platform/systemd/mkddc-{core,web-pi}.service` | backup/checksum/deploy order | xoá Revision/LKG/RETAIN khi rollback package |

Không tạo process thứ tư cho Programming. `mkddc-hmi` chỉ được đọc summary/health
nếu sau này có requirement; Rev A không author/check/commission/trace/reset.

## 15. Concurrency, timing và resource boundary

| Boundary | Quy tắc target | Cách chứng minh |
|---|---|---|
| Draft mutation | transaction theo `(project_id, draft_revision)`; ETag/base revision; idempotency key unique theo actor/action/target | two-client + retry integration |
| Commission/Restore | một lease/controller; durable operation ghi trước side effect; Core idempotent theo operation/package hash | kill BE ở từng bước, restart/reconcile |
| Core activation | request chỉ ghi pending preallocated buffer ngoài step; verify/stage trước; pointer/state swap tại safe boundary | unit/fault injection/no allocation |
| Base step | cadence độc lập Task; absolute monotonic; không chờ compiler/BE/filesystem; kick watchdog sau step | 10.000 cycle/period trên target |
| Task | one Task profile `1/5/30 s`; due check O(1); Program order ổn định; budget `<20% period` và còn bị chặn bởi base-step/WCET nhỏ hơn | deterministic replay + WCET/load |
| IOP | activation không restart iobus; `max_iop_poll_gap <200 ms`, target margin `<=100 ms` | HIL timestamp/waveform |
| Monitor/trace | publish ngoài output-critical path; 1 Hz/3 kỳ stale, 10k/10 phút `TARGET-PENDING OD-011` | bandwidth/memory soak |
| Compiler | source 64 KiB/artifact 1 MiB; hard timeout 5 s; CPU/memory/process/file quota `TARGET-PENDING` | worst-case concurrent Check |

Core scan không được giữ mutex chung với BE/compiler/iobus fieldbus worker. Mọi
buffer cần trong step phải allocate/reserve trước activation; allocation probe
phải phủ đường Program thật, không chỉ executor riêng lẻ.

## 16. Compatibility, deployment và rollback

Thứ tự deploy target:

1. Backup `/data/config/graph.json`, Programming DB/store, artifact registry,
   operation journal, LKG/RETAIN và manifest checksum; không dừng control.
2. Cài Core mới ở chế độ mặc định `GRAPH_ONLY`; Core phải đọc config cũ và từ
   chối schema mới không hiểu bằng mã ổn định.
3. Cài compiler CLI và Web/BE mới với Programming mutation feature flag OFF;
   chạy capability/read-only probe.
4. Migrate/create store atomically; Check/build candidate; không Commission.
5. Sau approval/HIL, chuyển `PROGRAM_ONLY` bằng operation có backup/read-back;
   graph không execute từ safe boundary đó.
6. Chỉ mở FE mutation khi Core capability/profile khớp contract.

Rollback package phải làm theo chiều ngược và giữ dữ liệu. Nếu Core cũ không đọc
artifact/schema mới, rollback control trước về graph backup/LKG tương thích, xác
nhận output/IOP, rồi mới hạ BE/FE. Trigger rollback: ABI/schema mismatch, không
reconcile operation, IOP gap vượt ngưỡng, watchdog loop, first-cycle fault hoặc
read-back active hash/revision không khớp.

Partial deployment fail closed:

- FE mới + BE cũ: 404/capability unavailable, không dựng success.
- BE mới + Core cũ: chỉ Project/Draft/Check nếu compiler tương thích; Commission
  bị khóa bởi capability/profile mismatch.
- Core mới + BE cũ: chạy `GRAPH_ONLY`; không tự activate package.
- mất nguồn giữa swap: boot chọn LKG/graph theo journal committed; trạng thái
  `UNKNOWN` phải được reconcile trước mutation mới.

## 17. Verification kiến trúc và acceptance

| Scenario | Requirement/risk | Mức | Expected |
|---|---|---|---|
| `ARCH-TC-01` Process ownership inspection | SYS-102/104/105; RSK-001 | static/design | mỗi mutable state có một owner; không direct output path từ Web/Program |
| `ARCH-TC-02` Core dependency/symbol check | CORE-101/103 | build/static | `mkddc-core` không chứa parser/compiler symbols; runtime không filesystem/HTTP/DB |
| `ARCH-TC-03` Partial deployment matrix | SYS-103/104 | integration/target | bốn tổ hợp §16 fail closed và control continuity đúng |
| `ARCH-TC-04` BE/Core restart at lifecycle steps | SYS-103/104; RSK-007/008 | target fault injection | operation reconcile, không double activation, LKG giữ |
| `ARCH-TC-05` Concurrent worst-case Check | NFR-102/103/108; RSK-003/005 | target/HIL | không missed step/watchdog/iobus gap; Check timeout fail closed |
| `ARCH-TC-06` Graph/Program cutover | SYS-105; RSK-001 | target/HIL | không cycle nào có hai owner mức 5; rollback khôi phục backup |
| `ARCH-TC-07` MCU independent safety | MCU-102; HW-102/103 | HIL | mất frame ở 200 ms vào safe envelope, không phụ thuộc Web/Core recovery |

Evidence phải ghi commit, binary/package hash, config/profile, target, command,
raw log/waveform và reviewer. Host tests không đóng `ARCH-TC-04..07`.

## 18. Trình tự runtime và ownership dữ liệu đầu-cuối

### 18.1 Check

```text
FE --save(etag)--> BE Store --immutable revision--> Compiler worker
FE <--revision---- BE       <--diagnostic/artifact-- Compiler worker
                         BE --target/capability probe--> Core
                         BE <--readiness/profile-------- Core
```

Check không ghi active pointer, không stage vào active slot và không giữ lock
Core. Compiler nhận snapshot immutable, output vào temp directory riêng; BE chỉ
publish Artifact record sau khi hash/manifest/diagnostic được commit cùng Check.

### 18.2 Commission/Restore

```text
FE --idempotency + candidate + acknowledgements--> BE Operation Journal
BE --verify/stage(operationId, packageHash)-------> Core pending slot
Core --safe boundary: validate → swap → first cycle → commit--> Active/LKG
BE <--authoritative operation + active hash/revision----------- Core
FE <--202 operationId; poll/event; final read-back-------------- BE
```

Owner thay đổi theo pha: BE sở hữu intent/journal; Core sở hữu pending/active/LKG;
iobus sở hữu process-image transport; MCU sở hữu output vật lý. Không process nào
được ghi trực tiếp state của process khác.

### 18.3 Bảng data flow

| Dữ liệu | Producer | Consumer | Persistence/freshness | Failure behavior |
|---|---|---|---|---|
| Draft/Revision | BE domain/store | FE, compiler | durable/immutable Revision | ETag conflict; không overwrite |
| Artifact/manifest | compiler → BE registry | Core loader | content-addressed + bounded | hash/schema/target mismatch reject |
| Operation | BE journal + Core status | FE/Ops/Audit | durable, reconcile sau restart | UNKNOWN; cấm auto replay |
| Process image input | iobus | Core step | snapshot mỗi base step | quality/freshness giữ riêng; không zero |
| Program proposal | Core executor | priority resolver | trong cycle/preallocated | fault bỏ proposal theo policy |
| Effective output | resolver/safety | iobus → MCU | mỗi base step/IOP frame | hold/safe-timeout theo authority |
| Online sample/trace | Core publisher | BE/FE | bounded, có sequence/timestamp | gap refetch; stale label |

## 19. Resource và deployment unit

| Unit | CPU/priority | Memory/storage | Startup dependency | Health/readiness |
|---|---|---|---|---|
| `mkddc-core` | RT policy hiện hành; Program trong scan | preallocated active/pending/trace; không DB | config + SHM/IOP; Web không bắt buộc | active/LKG/profile/scan/overrun |
| `mkddc-iobus` | fieldbus/IO worker độc lập | IO SHM/buffer bounded | MCU/serial theo cấu hình | poll gap, quality, link status |
| `mkddc-web` | non-RT; compiler worker bị quota | DB/store/artifact/audit quota | Core optional cho Draft, bắt buộc Commission | store/compiler/Core capability |
| React UI | browser | cache chỉ read model/local edit | Web API | không là authority readiness |
| STM32 | ISR/DMA/superloop/BSP | static buffers | power/clock/peripheral | sequence/CRC/timeout/safe output |

Giá trị RAM, CPU affinity, RT priority, DB quota và trace buffer được duyệt làm
target baseline theo `AUTH-PROG-2026-08-11-03`; measurement là evidence phải thu
trong implementation. Không copy số host vào target configuration.

## 20. Blocker, lịch sử và sign-off

| Blocker | Owner | Ảnh hưởng | Điều kiện mở |
|---|---|---|---|
| `ARCH-BLK-01` `OD-PROG-004/012` | Product + Runtime + Safety | **RESOLVED FOR IMPLEMENTATION** | decision `DECIDED`; benchmark trong task |
| `ARCH-BLK-02` `OD-PROG-013/014` | Product + Architect + Ops | **RESOLVED FOR IMPLEMENTATION** | ADR `Accepted`; inventory/rollback trong task |
| `ARCH-BLK-03` error/signature scope | Security + Interface owner | **RESOLVED FOR IMPLEMENTATION** | `ADR-030/031 Accepted`; contract/test trong task |
| `ARCH-BLK-04` TLS deployment | Security + Ops | **RESOLVED FOR IMPLEMENTATION** | TLS/cert lifecycle là deliverable security, không chặn code |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo target architecture/ownership/lifecycle/cutover ban đầu |
| 0.2 | 2026-08-09 | Bổ sung As-Built evidence, repository mapping, concurrency/timing, partial deploy/rollback và architecture tests |
| 0.3 | 2026-08-09 | Bổ sung sequence Check/Commission, data-flow ownership, deployment unit/resource/health contract; chuyển Detailed Draft chờ architecture review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại Architecture; ghi rõ xung đột §11 kèm owner/gate/điều kiện mở |
| 0.5 | 2026-08-10 | Đóng phần kỹ thuật của `ARCH-CONF-PROG-001..006` bằng sáu ADR chủ quản `ADR-026..031` (`Proposed`): profile runtime + validator duy nhất, quyền sở hữu chu kỳ scan, công thức watchdog theo base step, overrun là Task fault, hai lớp mã lỗi, `IntegrityMode=HASH_ONLY`. §11 thành bảng có ADR và trạng thái; **không** tự chuyển xung đột sang đóng vì chữ ký authority còn thiếu |
| 0.6 | 2026-08-10 | Ghi System Architect Phạm Đình Chương `ACCEPT` theo ủy quyền điện tử `AUTH-PROG-2026-08-10-01`; đồng bộ §11 và sign-off. Giữ M3 và 6 ADR `Proposed` vì còn đồng phê duyệt Safety/Security/Verification/Runtime cùng target evidence |
| 0.7 | 2026-08-11 | `AUTH-PROG-2026-08-11-03` phê duyệt toàn bộ kiến trúc để implement; chuyển ADR-026..031 sang `Accepted`; review discipline còn thiếu thành hậu kiểm và không chặn `IMPLEMENT_READY[*]` |
| 0.8 | 2026-08-11 | Đồng bộ As-Built `TASK-PROG-301` tại `a831a0d`: profile Rev A, `on_base_step()`/missed release, capability/schema và watchdog ADR-028; giữ bootstrap/cutover/target evidence còn mở |
| 0.9 | 2026-08-13 | Đồng bộ P3/P4 As-Built tới `c2f3189` + `10d9ad6`: fixed scheduler topology, SQLite v5 operation coordinator, Programming UDS `SO_PEERCRED`, exclusive safe-boundary cutover, first-output/LKG, rollback và CRC checkpoint recovery. Giữ flag OFF, 0/32 PASS và target/HIL/power-cut/IOP timing chưa chạy. |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| Product Owner | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | `AUTH-PROG-2026-08-11-03` |
| System/Runtime Architect | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | 6/6 ADR `Accepted` |
| Controls/Safety Reviewer | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm trong task |
| Security/Ops Reviewer | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm trong task |
| Verification Lead | **WAIVED FOR IMPLEMENTATION** | evidence trong task, không chặn code |

## 21. Phụ lục — Tự kiểm cổng M3 (loại: Architecture)

Cổng lấy theo [Plan 54 §7](../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md).

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Context, component, deployment | PASS | §2 system context; §14 component target; §10 và §19 deployment unit/tài nguyên |
| Ownership | PASS | §3 phân bổ trách nhiệm; §18.3 bảng data flow ghi chủ sở hữu từng dữ liệu |
| Trust boundary | PASS | §2 và §9: biên tin cậy Web ↔ Core ↔ iobus ↔ MCU và hướng gọi được phép |
| Failure boundary | PASS | §8 failure containment; §7 output continuity khi Commission |
| Hướng interface | PASS | §14 và §18: Core không gọi ngược lên Web; mọi output qua resolver mức 5 |
| State | PASS | §4 state machine lifecycle; §5 base control step |
| Capacity và timing | PASS | §15 concurrency/timing/resource boundary; §19 deployment unit; ngưỡng `<200 ms` poll gap |
| Compatibility và rollback | PASS | §16 compatibility/deployment/rollback gồm thứ tự deploy và dữ liệu phải giữ |
| Xung đột ADR/kiến trúc | **PASS FOR IMPLEMENTATION** | §11: 6/6 ADR `Accepted`; 17/17 decision `DECIDED`; review discipline được miễn khỏi entry implementation |
| Verification kiến trúc | PASS | §17 acceptance gắn `VS-PROG-012/014/015`; đều `NOT RUN` và được ghi đúng như vậy |
| Link nội bộ sạch | PASS | harness: local link missing `0`, anchor missing `0` |

Maturity chưa nâng M4/M5 vì không giả chữ ký/evidence, nhưng đã được
`WAIVED FOR IMPLEMENTATION`. Không mục nào ở đây tự chứng minh code đã tồn tại.
