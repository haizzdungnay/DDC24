# Sổ đăng ký rủi ro Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `RSK-PROG-001` |
| Phiên bản | 3.0 |
| Trạng thái | **Active — 22/22 Open; implementation controls ready, residual chờ evidence** |
| Ngày | 2026-08-20 |
| Chủ quản | Product + Architecture + QA |
| Người review | Risk owners, Safety, Security, Operations Leads |
| Người phê duyệt | Product Owner + System Architect + Verification Lead |
| Review kế tiếp | Sau mỗi Wave Plan 59 và trước `RELEASE_READY` |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-20-04`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Risk control/evidence vẫn được theo dõi trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Ghi **22 rủi ro** gồm 16 baseline và 6 rủi ro unified Product, kèm control/task/evidence để hạ mức. |
| 2. Ai phải đọc file này? | Product, Architect và QA (chủ quản chung); từng risk owner đọc phần của mình; Safety và Security đọc trước khi ký. |
| 3. Hệ thống hiện tại đang có gì? | 22/22 Open; source baseline có một phần treatment cho atomic/LKG/RETAIN, nhưng contract mới chưa có Test Result; không giảm residual. |
| 4. Thiết kế mới thay đổi điều gì? | Không giảm rủi ro nào. Nó gắn từng rủi ro với biện pháp cụ thể, kịch bản kiểm chứng và mức tồn dư **mục tiêu** — mục tiêu, chưa phải kết quả. |
| 5. Team phải sửa module/contract nào? | Cột “Kiểm soát thiết kế” trỏ tới hồ sơ chủ quản; việc code nằm ở Plan59. Các rủi ro 20 điểm gồm runtime/IOP/compiler/HIL baseline và sáu rủi ro mới về signal, scheduler, POU, library, output, power-loss. |
| 6. Điều gì còn bị chặn? | Mọi rủi ro ≥15 **chặn cutover production** cho tới khi biện pháp có bằng chứng PASS và mức tồn dư được owner cùng QA chấp nhận bằng văn bản. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Cột “Scenario/evidence authority” ở §3 gắn từng rủi ro với `VS-PROG-*`. Hiện 2/32 record đều `BLOCKED`, 0/32 PASS, nên **không rủi ro nào được hạ mức**. |

Quy tắc chống tự huyễn hoặc: **không giảm mức tồn dư bằng kế hoạch, bằng văn bản
review hay bằng test cũ chạy trên contract khác.** Merge code chỉ đưa rủi ro lên
`TREATMENT_IMPLEMENTED`, không hạ điểm.

Thang: Severity/Likelihood `1..5`, Risk = S×L. Residual chỉ giảm sau evidence.

| ID | Rủi ro / nguyên nhân | S×L | Kiểm soát thiết kế | Owner | Evidence/gate | Residual hiện tại |
|---|---|---:|---|---|---|---|
| `RSK-PROG-001` | Graph và Program cùng chạy, tranh output mức 5 | 5×3=15 | cutover 3 state, fail closed, backup/rollback | Architect/Core | VS-015/G3–G5 | 15 Open |
| `RSK-PROG-002` | Task 30 s chi phối base step, watchdog 6 s restart loop | 5×4=20 | base step độc lập, formula/config gate, target timing | Core/Ops | VS-009/015 | 20 Open |
| `RSK-PROG-003` | Activation làm IOP gap >=200 ms, MCU ép safe output | 5×4=20 | non-blocking swap, no iobus restart, measure <200 ms | Core/FW/HW | VS-014/030 | 20 Open |
| `RSK-PROG-004` | Hold-last dùng actual của override, output bump khi nhả | 5×3=15 | previous program_value mức 5, PID freeze/back-calc | Controls/Core | VS-010/014 | 15 Open |
| `RSK-PROG-005` | Check/compiler tranh CPU với RT gây overrun/safe-state | 5×4=20 | sandbox/resource isolation, task-level fault, load HIL | BE/Core/Ops | VS-012/013 | 20 Open |
| `RSK-PROG-006` | Corrupt/wrong artifact hoặc parser trong RT | 5×3=15 | common IR, bounded loader, hash, fuzz, no parser RT | Core/Security | VS-006/023 | 15 Open |
| `RSK-PROG-007` | FE báo success từ HTTP nhưng Core chưa active | 4×4=16 | async operation + authoritative read-back + Unknown | FE/BE/Core | VS-004/011/026 | 16 Open |
| `RSK-PROG-008` | Concurrency/timeout tạo mất Draft hoặc double activation | 4×3=12 | ETag, idempotency, operation reconciliation | BE/FE | VS-024 | 12 Open |
| `RSK-PROG-009` | RETAIN sai layout/corrupt gây lệnh điều khiển sai | 5×3=15 | stable identity/version/CRC/atomic/cold-init diagnostic | Core | VS-029 | 15 Open |
| `RSK-PROG-010` | Point missing/stale bị coi zero/good | 5×3=15 | typed quality/freshness end-to-end, no defaults | All SW | VS-017/018 | 15 Open |
| `RSK-PROG-011` | Bundle import mang executable/traversal/zip bomb | 4×3=12 | source-only allowlist, sandbox/quota/hash/no auto-active | BE/Security | VS-021/023 | 12 Open |
| `RSK-PROG-012` | Role UI bị dùng thay server authorization | 4×3=12 | server RBAC, negative matrix, audit | BE/Security | VS-022 | 12 Open |
| `RSK-PROG-013` | MCU/HW skeleton bị nhầm là HIL/release-ready | 5×4=20 | board/BSP/schematic/instrument evidence gate | HW/FW/QA | VS-030/G5 | 20 Open |
| `RSK-PROG-014` | Error namespace/spec cũ xung đột, FE xử lý sai | 3×4=12 | IFSPEC authority, mapping detail code, contract tests | BE/Core/FE | VS-019/024 | 12 Open |
| `RSK-PROG-015` | Claim IEC/ISO/certified không có evidence | 3×3=9 | claim guardrail, review/sign-off, trace | Product/QA | G0/G6 | 9 Open |
| `RSK-PROG-016` | Đơn giản hóa UI làm mất một bước an toàn: xác nhận theo rủi ro bị hiểu thành bỏ xác nhận, hoặc impact `UNAVAILABLE` bị coi là `NONE` | 5×3=15 | fail-closed ba nhánh impact, giữ re-auth + read-back + rollback bất kể số ô xác nhận, test âm bắt buộc | UX/FE/BE/QA | VS-031/011/019 | 15 Open |
| `RSK-PROG-017` | Cross-Program shared state/race hoặc signal torn-read làm logic không deterministic | 5×4=20 | cấm shared writable, signal double-buffer committed snapshot, TSan/stress | Core | U05/U06/U11; T59-404/702 | 20 Open |
| `RSK-PROG-018` | Creation order/worker lane tạo dependency ngầm hoặc starvation | 5×3=15 | absolute-deadline due queue, semantics độc lập worker count, 10-Program reorder fixture | Core/QA | U05/U11; T59-402/403/702 | 15 Open |
| `RSK-PROG-019` | Function/FB recursion, side effect hoặc state alias vượt resource/WCET | 5×3=15 | kind rules, call DAG, static layout/budget, one-over/fuzz | Compiler/Core | U01/U02/U04; T59-101..106 | 15 Open |
| `RSK-PROG-020` | Library version/supply-chain drift khiến cùng source chạy khác hoặc nạp payload độc hại | 5×3=15 | immutable lock, source-only import, signed artifact/library, hostile corpus | Compiler/BE/Security | U03; T59-201..205/602/603 | 15 Open |
| `RSK-PROG-021` | Hai Program tranh cùng output hoặc Disable giữ candidate bí mật | 5×4=20 | single owner Check guard, safe-boundary withdrawal, resolver/interlock/safe-state HIL | Core/Controls | U07/U09; T59-304/406/703 | 20 Open |
| `RSK-PROG-022` | Package multi-Program active một phần hoặc intent/RETAIN/LKG lệch sau power loss | 5×4=20 | first-cycle package barrier, journal/checkpoint/dual-reader, power matrix | Core/BE/Ops | U08; T59-501/704/705 | 20 Open |

## Quy tắc xử lý

- Risk >=15 chặn production cutover cho tới khi control có evidence PASS và
  residual được owner + QA chấp thuận.
- Không giảm residual bằng plan, review prose hoặc test cũ không cùng contract.
- Finding mới trong implementation/HIL phải thêm vào register và trace về
  requirement/test/change; không chỉ ghi trong chat/commit.

## 2. Phương pháp chấm và acceptance

| Điểm | Severity | Likelihood |
|---:|---|---|
| 1 | không ảnh hưởng control; phục hồi tức thời | rất hiếm, control đã chứng minh |
| 2 | gián đoạn nhỏ/không output unsafe | hiếm |
| 3 | mất chức năng có giới hạn/rework đáng kể | có thể xảy ra |
| 4 | mất điều khiển/availability/audit quan trọng | khả năng cao nếu không control |
| 5 | unsafe physical output, mất LKG hoặc failure diện rộng | gần chắc/chưa có barrier đáng tin |

Mức: `1..4 Low`, `5..9 Medium`, `10..14 High`, `15..25 Critical`. Risk hiện
tại giữ nguyên S×L gốc vì tất cả evidence mới `MISSING`. `Target residual` chỉ là
mục tiêu treatment; không thay cột residual cho tới khi Test Result phù hợp PASS,
risk owner đề xuất và Product/Architect/QA chấp thuận bằng record.

## 3. Treatment và trace mức từng risk

| ID | Cause → event → impact | Requirement / thiết kế kiểm soát | Control cần implement/verify | Scenario / evidence authority | Target residual đề xuất | Owner / review trigger |
|---|---|---|---|---|---:|---|
| `001` | bootstrap graph luôn chạy + Program thêm owner → dual proposal → output không xác định | SYS-105; ARCH; `DDD-CTRL`, `DDD-LIFE` | exclusive owner generation, preflight backup, atomic cutover, fail rollback | VS-015; target owner/read-back/waveform | 5×1=5 | Architect/Core; mọi cutover change |
| `002` | scheduler gắn sleep Task → 30 s làm trễ base-step/watchdog → restart/safe | CORE-102/108; `DDD-CTRL` §3 | 50 ms base-step độc lập, phase-lock Task, heartbeat independent | VS-009/015; 10k cycles + watchdog trace | 5×1=5 | Core/Ops; timing/config change |
| `003` | stage/swap/blocking/restart iobus → poll gap ≥200 ms → MCU safe/output interruption | NFR-108; `DDD-CTRL/LIFE/FWSOM/MCU/HW` | non-RT load, safe-boundary pointer swap, no iobus restart, priority isolation | VS-014/030; logic analyzer + waveform | 5×1=5 | Core/FW/HW; runtime/package change |
| `004` | PID dùng selected override làm own previous proposal → release bump | CORE-104..106; `DDD-CTRL` §6–7 | proposal/actual tách, freeze khi bị override, back-calc chỉ internal limit, release envelope/ramp guard, hold TTL | VS-010/014; PID trace + AO waveform | 5×1=5 | Controls/Core; PID/arbitration change |
| `005` | compiler/DB/file compete CPU/IO → scan overrun → control fault/safe entry | NFR-103; `DDD-LANG/SEC/BE/FWSOM` | process/cgroup/quota, non-RT priority, bounded queue/disk watermark | VS-012/013/014; load profile/IOP trace | 5×2=10 | BE/Core/Ops; compiler/storage change |
| `006` | hostile/corrupt artifact/parser RT → memory/control-flow violation → Core crash/wrong logic | CORE-101/103; `DDD-LANG`, `IFSPEC-ART`, `DDD-SEC` | deterministic compiler, hash, bounded loader/fuzz, no parser symbol RT | VS-006/012/023; fuzz/sanitizer/symbol | 5×1=5 | Core/Security; format/compiler change |
| `007` | FE tin POST/DB → hiển thị Active trước Core → operator hiểu sai | SYS-103; `IFSPEC`, `DDD-LIFE`, `DDD-FE/BE` | durable operation, UNKNOWN, Core active/hash/first-cycle read-back | VS-004/011/026; correlated UI/API/Core | 4×1=4 | FE/BE/Core; operation/UI change |
| `008` | concurrent client/worker + timeout replay → lost Draft/double activation | BE-102/106; `DM`, `IFSPEC`, `DDD-BE/LIFE` | ETag, canonical idempotency hash, DB/Core single-flight, leases/reconcile | VS-024; DB/operation/fault log | 4×1=4 | BE/FE; store/worker change |
| `009` | identity/layout/CRC/migration sai → restore state vào variable khác → wrong output | CORE-109; `DDD-LIFE/FWSOM`, `DM` | stable instance ID, layout gen/hash/CRC, atomic record, explicit migrate/cold-init | VS-029/030; decoded record + power log | 5×1=5 | Core/Controls; layout/library change |
| `010` | producer missing/stale normalized zero/good → logic dùng dữ liệu giả → unsafe command | FE-105/109, BE-109; `DDD-CTRL`, `IFSPEC/FE/BE` | typed quality/freshness/source end-to-end, required/fallback policy | VS-017/018; producer clock/API/UI/runtime | 5×1=5 | All SW; Point/schema change |
| `011` | archive hostile/oversize/path/executable → file escape/DoS/code injection | SYS-107/BE-108; `DDD-SEC`, `DDD-BE` | source-only allowlist, quarantine, path/no-link/count/ratio/hash, Draft-only | VS-021/023; malicious corpus | 4×1=4 | BE/Security; bundle schema change |
| `012` | UI-only role guard/direct handler bypass → unauthorized mutation | SYS-106/BE-107; `DDD-SEC/BE`, `IFSPEC` | server handler+service authz, re-auth/CSRF/object scope/audit | VS-022; route+service auth matrix | 4×1=4 | BE/Security; auth/role change |
| `013` | host skeleton/test được báo thành board-ready → release không đo điện → latent unsafe behavior | MCU/HW req; `DDD-MCU/HW`, VVP | controlled BSP/schematic/BOM/limits/fixture, target/HIL evidence authority | VS-014/030; instrument raw result | 5×1=5 | HW/FW/QA; board/BOM/FW change |
| `014` | spec cũ/component/public error lệch → FE retry/recover sai → duplicate/hidden fault | IFSPEC; all DDD error maps | public `PRG-ERR` authority + detail map + generated contract negative tests | VS-019/024; OpenAPI/Go/TS/IPC | 3×1=3 | BE/Core/FE; contract change |
| `015` | dùng từ compliant/certified khi chỉ aligned → sai cam kết/audit | SRS claim guardrail; Index/VVP/Trace | controlled copy, document review, evidence-bound release claim | G0/G6 + VS-025 inspection; signed release | 3×1=3 | Product/QA; marketing/release/doc change |
| `016` | gộp IA và bỏ danh sách xác nhận cố định → FE hiểu nhầm “ít ô hơn” thành “ít bước an toàn hơn”, hoặc coi impact chưa tính được là không có ảnh hưởng → Commission đi qua một ảnh hưởng chưa được đánh giá | FE-113/114; `IFSPEC` §6.1 | ba nhánh `NONE/PRESENT/UNAVAILABLE` fail-closed; re-auth, read-back và rollback không phụ thuộc số ô xác nhận; vùng thao tác nguy hiểm tách khỏi vùng chỉ đọc | VS-031 usability + VS-011/019 fault; contract test cho ba nhánh impact | 5×1=5 | UX/FE/BE/QA; mọi thay đổi màn hình Commission |

Tên rút gọn `DDD-*` trong bảng trỏ tới ID đầy đủ ở Design Index; Traceability
phải giữ link section hiện hành. Target residual đề xuất chưa được acceptance.

## 4. Risk lifecycle và change control

```text
OPEN → TREATMENT_IMPLEMENTED → EVIDENCE_REVIEW → ACCEPTED | REOPENED
```

- `TREATMENT_IMPLEMENTED` cần commit/build link nhưng residual chưa giảm.
- `EVIDENCE_REVIEW` cần Test Result đúng target/contract và no invalidation.
- `ACCEPTED` ghi residual S/L, rationale, limitation, authority/date/review date.
- Requirement/design/contract/code/board/BOM/incident thay đổi có impact thì
  `REOPENED`, invalidates evidence theo VVP và cập nhật Trace/Release.
- Critical hiện tại không được waiver miệng; waiver có expiry/scope/compensating
  control và chữ ký Product+Architect+QA/Safety khi liên quan.

## 5. Trạng thái control/evidence hiện tại

| Chỉ số | Giá trị 2026-08-20 |
|---|---:|
| Risk Open | 22/22 |
| Critical ≥15 | 17/22 |
| Treatment có thiết kế | 22/22 |
| Treatment implemented end-to-end | 0/22 cho Product Target |
| Treatment source/target partial | 11/22 ở baseline cũ; sáu risk unified mới ở trạng thái design control |
| Evidence accepted | 0/22 |
| Residual accepted | 0/22 |

Vòng nội dung chi tiết làm rõ control nhưng không giảm risk. Production gate vẫn RED.

### 5.1 Cập nhật treatment source `TASK-PROG-104`

| Risk | Control đã có tại `312f357` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-007` | Operation intent + audit được commit bền vững trước side effect; một non-terminal operation/controller | service/worker, Core stage/activate, authoritative read-back, `UNKNOWN` reconcile và UI truth | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | Draft ETag/CAS hai writer; operation idempotency hash + single-flight; transaction rollback khi disk full | idempotency cho Draft mutation ở service/API, worker lease/reconcile và target fault test chống double activation | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-009` | DB tách khỏi RETAIN và không tự xóa lịch sử | stable retain identity/layout/version/CRC, power-loss/cold-init diagnostic tại Core | `OPEN` |
| `RSK-PROG-011` | Backup/restore path không ghi đè, checksum fail-closed | bundle quarantine/import allowlist/path/ratio/executable checks | `OPEN` |

Host test của store là evidence hỗ trợ G1, không phải Test Result của scenario;
vì vậy lifecycle, S×L và residual của cả bốn risk giữ nguyên.

### 5.2 Cập nhật treatment source `TASK-PROG-105`

| Risk | Control đã có tại `30a068b` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Join ghim hash/profile/artifact; unknown major/hash drift fail-closed; loader consumer regression PASS | compiler/FBD hostile corpus đủ `10^7`, target loader/no-parser-RT và independent evidence | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-007` | Deploy chỉ cho FE read-only, flag OFF, Commission bị cấm; rollback giữ Active/LKG | worker/Core read-back/Unknown và UI authoritative truth | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | Partial deploy/order sai dừng preflight; dry-run không mutation/Commission | service/worker crash-reconcile và E2E double-activation fault | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Sáu contract cùng major/hash; catalog 19/77 và C++/Go/TS drift check; minor/major lạ bị chặn | Check/Commission API/UI runtime và `VS-PROG-019/024` PASS được review | `OPEN — PARTIAL SOURCE` |

`TR-PROG-001-20260811-001` và `TR-PROG-019-20260811-001` đều `BLOCKED`.
Chúng xác nhận phần host đã chạy và phần thiếu cụ thể, nhưng không phải evidence
được chấp nhận để chuyển lifecycle hoặc giảm residual.

### 5.3 Cập nhật treatment source `TASK-PROG-200`

| Risk | Control đã có tại `8d58efa` + `a638470` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Parser kiểm UTF-8/NUL/source 64 KiB/full consumption và reject keyword ngoài subset; sáu type/wire code/range/conversion fail-closed xuyên semantic→IR→loader→executor→RETAIN; source map strict; fuzz tất định 10.000 mutation; parser và loader ASan/UBSan mỗi bộ 10.000.000 input, 0 crash/timeout | FBD producer/corpus và ST↔FBD equivalence; BE sandbox worker; kiểm binary runtime không mang parser; target load/timing và Test Result `VS-PROG-006/023` được review độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G2-200` là evidence hỗ trợ host cho control đã implement. Nó không phải
Test Result scenario và không chứng minh production/no-parser-RT/target/HIL; do
đó likelihood, lifecycle và residual `15 Open` của `RSK-PROG-006` giữ nguyên.

### 5.4 Cập nhật treatment source `TASK-PROG-201`

| Risk | Control đã có tại `52dfb57` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Schema/golden/manifest FBD ghim profile; C++ validator/canonicalizer non-RT từ chối duplicate key, kind/typeRef, parameter, UUID/order, port shape, dangling endpoint, type/unit và multi-driver; FE model/reducer dùng cùng contract; contract mutation 10/10, Core 8/8, FE 15/15 và ASan fuzz 50.000 input không crash | FBD→common IR và ST↔FBD equivalence; BE sandbox worker; binary runtime no-parser; target load/timing; Test Result `VS-PROG-006/023` độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G2-201` chỉ là evidence hỗ trợ host. Component FBD chưa mount route,
graph chưa hạ IR/stage, feature flag vẫn `OFF`; vì vậy lifecycle và residual
`15 Open` không đổi.

### 5.5 Cập nhật treatment source `TASK-PROG-202`

| Risk | Control đã có tại `4819901` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Lowerer non-RT chỉ nhận FBD canonical, dựng `StProgram` typed rồi dùng semantic checker/`compile_st_to_ir`/runtime ST hiện hữu; 20 cặp executable IR và output tương đương, trace TON, reject input chưa nối/unit/library chưa hỗ trợ/identifier hostile mà không publish partial IR; contract mutation 10/10, targeted 17/17 và ASan fuzz 100.000 input không crash | Artifact/source-map FBD production Task 203; BE sandbox worker; binary runtime no-parser; target load/timing; Test Result `VS-PROG-006/023` độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G2-202` là evidence host cho lowering/equivalence, không phải Test Result
scenario. Feature flag vẫn `OFF`, không artifact được stage/activate trên target;
vì vậy lifecycle và residual `15 Open` không đổi.

### 5.6 Cập nhật treatment source `TASK-PROG-203`

| Risk | Control đã có tại `2c2bfb4` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Producer/verifier manifest ST/FBD khóa canonical source, compiler/lowerer, profile/library/ABI, file SHA-256, integrity SHA-256, build key và source map; FBD giữ UUID network/node/port/unit ngoài executable IR; unknown version/profile/hash/source/source map bị reject mà không sửa output; CLI thật và golden/mutation guard đã chạy | BE sandbox worker + immutable DB linkage; binary runtime no-parser; target load/timing; Test Result `VS-PROG-006/023` độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G2-203` là evidence hỗ trợ host. Task không stage/activate, không đổi
Active/LKG và không có target/HIL/independent Test Result; vì vậy lifecycle và
residual `15 Open` của `RSK-PROG-006` giữ nguyên.

### 5.7 Cập nhật treatment source `TASK-PROG-204`

| Risk | Control đã có tại `66848a1` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-007` | Sáu API Project/Draft/Revision dùng state đã commit làm response authority; seal Revision không đổi Active/LKG; flag OFF và 19 route lifecycle còn 503, nên không thể báo Commission thành công giả | Check/operation worker, Core stage/activate/read-back, `UNKNOWN` reconcile và UI truth | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | Draft dùng ETag mạnh gắn draft ID + generation, CAS/batch all-or-nothing; receipt 24 giờ khóa actor/action/target/key + semantic request hash, replay qua restart giữ identity/audit/ETag; cùng key khác request conflict | worker lease/Core single-flight/reconcile và E2E fault chống double activation | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | OpenAPI v1.17, catalog v1.1.0 20/77 và consumer Go/C++/TS được sinh lại; sáu operation gắn status `task-prog-204`, contract/G1 drift guard PASS | Check/Commission API/UI runtime và `VS-PROG-019/024` PASS độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G2-204` là evidence hỗ trợ host cho lifecycle/store/API. Feature flag
vẫn mặc định `OFF`; chưa có Check, Core side effect, target/HIL hoặc Test Result
độc lập, nên không risk nào chuyển lifecycle hay giảm residual.

### 5.8 Cập nhật treatment source `TASK-PROG-205`

| Risk | Control đã có tại `e8c289e` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-005` | Compiler child dùng argv cố định, scratch `0700`, rlimit + `NO_NEW_PRIVS` + seccomp, không network/fork/exec/mount/ptrace; timeout `1..60 s` giết cả process group; output/file bounded | cgroup/priority trên Forlinx, đo CPU/IOP gap/overrun khi Check tải nặng và Test Result `VS-PROG-012/013/014` độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | Worker verify compiler/profile/ABI/build key/source/manifest/hash; Artifact content-address temp+fsync+atomic publish/read-back, reject traversal/symlink; chỉ `PASSED` commit row | binary runtime no-parser, target loader/timing/power fault và `VS-PROG-006/023` độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-007` | Check HTTP chỉ trả job/terminal result và không có stage/activate/Core side effect; flag mặc định OFF, 17 operation lifecycle còn fail-closed | operation worker, Core stage/activate/read-back, `UNKNOWN` reconcile và UI truth | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | Check receipt 24 giờ qua restart; lease/CAS claim, reclaim đúng một lần và terminal immutable; cùng request không tạo job/Artifact row trùng | Core operation single-flight/reconcile và E2E fault chống double activation | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | OpenAPI v1.18, catalog v1.2.0 20 public/80 detail và Go/C++/TS sinh lại; Check route/error contract drift guard PASS | Commission/API/UI runtime và `VS-PROG-019/024` PASS độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G2-205` là evidence hỗ trợ host. Flag vẫn `OFF`; chưa đo isolation trên
Forlinx/IOP, chưa stage/activate và không có Test Result độc lập, nên cả năm risk
giữ lifecycle, S×L và residual hiện tại.

### 5.9 Cập nhật treatment source `TASK-PROG-206`

| Risk | Control đã có tại `95b9388` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-007` | Import response ghi tường minh `DRAFT`, `checkCreated=false`, `artifactImported=false`, `commissionStarted=false`; change impact thiếu Core read-back là `UNAVAILABLE`, không được coi `NONE` | operation worker, Core stage/activate/read-back, UNKNOWN reconcile và UI truth | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | Receipt v4 cho export/import khóa actor/action/key + semantic request hash trong 24 giờ; replay giữ response/audit và cùng key khác request conflict | Core operation single-flight/reconcile và E2E fault chống double activation | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-011` | ZIP chỉ nhận `Store`, exact allowlist/path, UUID/kind/target/profile/file set/hash/size/manifest; giới hạn 4 MiB/1024 file/256 KiB; import một transaction chỉ tạo Project/Draft | Task 207 hostile corpus traversal/zip bomb/executable/duplicate/fuzz/OOM và Test Result `VS-PROG-021/023` độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | OpenAPI v1.19, source bundle machine schema, G1 7/7 và generated TS đồng bộ; HTTP round-trip contract PASS | Commission/API/UI runtime và `VS-PROG-019/024` PASS độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G2-206` là evidence hỗ trợ host, không phải Test Result Security/target.
Feature vẫn `OFF`, không stage/activate; assurance hostile corpus được theo dõi tiếp
ở §5.10 nhưng không tự nâng lifecycle hay residual.

### 5.10 Cập nhật treatment source `TASK-PROG-207`

| Risk | Control đã có tại `3e5281d` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-005` | Compiler timeout, SIGKILL mô phỏng OOM, process-group reap/scratch cleanup, stdout one-over và source one-over đều fail-closed; child không sinh Artifact khi lỗi | cgroup/priority trên Forlinx, đo CPU/IOP gap/overrun và Test Result VS-012/013/014 | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | Fuzz Go 2.156 lượt không crash, source size chặn trước spawn và artifact/native bundle smuggling bị reject | Core runtime no-parser/bounded loader, target timing/power fault và Test Result VS-006/023 | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-011` | Hostile corpus 25 lớp khóa raw/entry/count/path NFC/mode/flags/comment/timestamp/extra/hash/target/kind; snapshot 8 bảng chứng minh reject zero-mutation | Independent VS-021/023, target resource/availability và replacement E2E | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-012` | Chuẩn hóa tên khóa nhạy cảm và reject 23 alias trước audit append; audit bundle chỉ giữ provenance, không source/secret | full viewer/operator/admin/revoked role matrix ở handler+service, re-auth/CSRF/TLS và VS-022 | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Source bundle contract/G1 verifier khóa NFC, per-entry limit và ZIP metadata; G1 7/7/deploy-order 5/5 PASS | Commission/API/UI runtime và VS-019/024 độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G2-207` là evidence kỹ thuật host hỗ trợ, không phải Test Result có
reviewer độc lập. Feature vẫn `OFF`, không stage/activate, chưa có target/operation/
Core evidence; do đó 16/16 risk, S×L và residual giữ nguyên.

### 5.11 Cập nhật treatment source `TASK-PROG-300`

| Risk | Control đã có tại `4f7e0ac` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-003` | Loader verify và cấp phát program/shadow state ở command path; safe boundary chỉ chuyển prepared handle O(1); active/LKG bytes dùng retired slot và vector swap, không free/copy trong tick; corrupt artifact bị reject trước enqueue | production ScanLoop/coordinator/UDS, đo IOP gap `<200 ms` và power/MCU 199/200/201 ms trên Forlinx/HIL | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | `StPreparedProgram` chỉ chứa IR đã verify; `mkddc-core`/`core_application` có hậu kiểm `nm -C` chặn parser/compiler; allocation counter PASS ở activation/execute/LKG; OOM đổi `IR-E-015`, active giữ nguyên | full forbidden-call/no-blocking instrumentation, 10.000 cycle target, power fault và Test Result `VS-PROG-006/012/023` độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G3-300` là evidence host hỗ trợ, không phải Test Result target. Feature
vẫn `OFF`, source đã route Programming nhưng chưa deploy/đo IOP/power; vì vậy 16/16
risk, S×L và residual giữ nguyên.

### 5.12 Cập nhật treatment source `TASK-PROG-301`

| Risk | Control đã có tại `a831a0d` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-002` | `StSchedulerProfile::REV_A` chỉ nhận một Task/một Program/1-5-30 s và budget `<20%`; ScanLoop gọi `on_base_step()` có sequence riêng; Task 30 s không chạy trước release 30, missed release không catch-up; systemd/comment runtime dùng công thức ADR-028 theo base step | Task 306 bỏ quyền graph ghi đè base step và dựng scheduler Rev A production; Task 307 chạy 10.000 cycle/period với `SCHED_FIFO`, đo jitter/WCET/watchdog/IOP; Test Result VS-009/015 độc lập | `OPEN — PARTIAL SOURCE` |

`EV-PROG-G3-301` là evidence host hỗ trợ. `WatchdogSec=6` vẫn
`TARGET-PENDING`, target Programming chưa được enable/đo; vì vậy likelihood,
điểm `20 Open` và residual của `RSK-PROG-002` giữ nguyên.

### 5.13 Cập nhật treatment source `TASK-PROG-402`

| Risk | Control đã có tại `3ca5d22` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-009` | Stable key SHA-256 controller+instance; record v2/layout v1; CRC toàn record; exact identity/layout/artifact/size/reserved validation; typed variable và FB codec không phụ thuộc ABI; timer rebase/PID reseed; snapshot chỉ sau output commit; mailbox/worker không I/O scan; temp+fsync+rename+dir-fsync; missing/corrupt/mismatch cold-init có diagnostic/status | Power-cut tại từng điểm ghi và restart process/board thật; kiểm endurance/permission/ownership sau packaging; `VS-PROG-029/030` Test Result được review độc lập; residual acceptance Core/Controls/QA | `OPEN — TREATMENT SOURCE IMPLEMENTED; TARGET EVIDENCE MISSING` |

Host gates tới CTest 1002/1002 cùng Go/FE chứng minh component và integration
boundary hiện tại, không phải Test Result target. Vì chưa cắt điện eMMC/khởi
động lại Forlinx/HIL và chưa có review độc lập, mọi điểm gốc giữ nguyên.

### 5.14 Cập nhật treatment source `TASK-PROG-500..506` (P5 FE bốn workspace)

| Risk | Control đã có tại `e58c745`..`14a9299` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-007` | FE workspace thật (không mock production) chỉ đọc `producerState`/`safeState` từ BE, không tự suy `RUNNING`/`true`; Commission/Restore đi qua `useCommissionWorkflow`/`useRestoreWorkflow` — timeout đi `UNKNOWN_RECONCILING` rồi tự GET lại, không optimistic active và không auto-replay POST; xác nhận bằng Chrome/Playwright thật (`EV-PROG-P5-500-506`) | Test Result `VS-PROG-004/011/026` cần target/HIL fault-injection thật và review độc lập | `OPEN — TREATMENT SOURCE IMPLEMENTED; TARGET/REVIEW EVIDENCE MISSING` |
| `RSK-PROG-008` | `useDraftWorkspace` gửi `If-Match`; 409 giữ nguyên buffer đang gõ (không mất Draft); idempotency key theo revisionId trong `sessionStorage`, tạo một lần lúc user confirm | Fault test double-activation trên target thật và review độc lập; `VS-PROG-024` | `OPEN — TREATMENT SOURCE IMPLEMENTED; TARGET/REVIEW EVIDENCE MISSING` |
| `RSK-PROG-014` | `programmingErrorCopy(pick, code)` map đủ 19 `PRG-ERR-*` sang copy VI/EN cụ thể, không hiển thị `messageKey` thô; `ProblemsDrawer` dùng đúng hàm này | `VS-PROG-019/024` Test Result được review độc lập | `OPEN — TREATMENT SOURCE IMPLEMENTED; REVIEW EVIDENCE MISSING` |
| `RSK-PROG-016` | `AcknowledgementChecklist` (`CheckCommissionPage.tsx`) khớp đúng ba nhóm impact `PRESENT` — không rút gọn hay gộp; nhóm `retain` PRESENT dùng đúng câu bắt buộc UC-PROG-13 (sửa một finding thật khi soát S5-E, không phải chỉ ghi nhận); `UNAVAILABLE` luôn chặn Commission vì impact BE trả `UNAVAILABLE` mặc định khi `RuntimeImpactProvider` lỗi — FE không cần cờ riêng để chặn | Usability test người dùng thật (`VS-PROG-031`, `S5-F`) xác nhận kỹ thuật viên không bỏ sót bước xác nhận trong điều kiện thực tế; review độc lập | `OPEN — TREATMENT SOURCE IMPLEMENTED; USABILITY EVIDENCE MISSING` |

Chrome/Playwright thật (`EV-PROG-P5-500-506`, VVP §11.5) là evidence hỗ trợ
host+browser boundary hiện tại, không phải Test Result scenario — E2E chạy
mock `page.route()` cho BE, không phải target/HIL, và không có
executor/reviewer độc lập. Vì vậy likelihood, lifecycle và residual của cả bốn
risk trên **giữ nguyên**; không risk nào hạ điểm ở bản cập nhật này.

### 5.15 Cập nhật treatment target web `TASK-PROG-507`

| Risk | Control đã kiểm trên Foxlinx tại `9606906`+`6069de6`+`d9a8e3b` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-007` | Deploy đầy đủ FE/Web/compiler/Core; hai Check `PASSED`; Commission fixture output-free `SUCCEEDED/COMMITTED`; Core đọc-ngược Active/LKG/Task `RUNNING`; cờ production `ON` | Commission có mapping/output thật, fault injection và Test Result độc lập | `OPEN — TARGET HAPPY PATH PASS; OUTPUT/FAULT EVIDENCE MISSING` |
| `RSK-PROG-008` | Cleanup allowlist; hai backup có checksum; switch binary/static/Core/compiler có rollback; phát hiện config `null`, rollback đúng rồi normalize revision 2; no-output Commission không tạo side effect vật lý | power-loss giữa từng bước, double-activation/lease fault với Core thật và `VS-PROG-024/029/030` | `OPEN — TARGET HAPPY PATH PASS; POWER/HIL EVIDENCE MISSING` |
| `RSK-PROG-012` | Phát hiện JWT secret legacy dài 1 byte qua fail-closed startup; xoay 32 byte ngẫu nhiên (base64 44), file `root:root 0600`, không log secret; session cũ hết hạn đúng thiết kế | TLS/CSRF, revoked-role và viewer/operator/admin matrix, secret rotation runbook/review độc lập `VS-PROG-022` | `OPEN — TARGET SECURITY PARTIAL; REVIEW EVIDENCE MISSING` |
| `RSK-PROG-014` | Chrome/API target bắt ba drift thật: WS Origin 403, Check profile 400, Revision nền 409; sửa source+contract test; sau deploy đầy đủ target xác nhận WS, Check PASS, Commission và Core read-back end-to-end | mixed-version rollback, negative contract/fault target và `VS-PROG-019/024` Test Result độc lập | `OPEN — TARGET HAPPY PATH PASS; NEGATIVE/REVIEW EVIDENCE MISSING` |

`EV-PROG-P5-507` là supporting target evidence end-to-end, không phải HIL/Test
Result độc lập. Compiler/Core/Web/FE và happy path đã PASS, nhưng fixture cố ý
không có output vật lý; power/fault/IOP timing/usability/reviewer vẫn thiếu. Vì
vậy không hạ likelihood, không chấp nhận residual và không đổi 16/16 `OPEN`.

### 5.16 Cập nhật treatment source `T59-001` (Plan59 W0)

| Risk | Control đã có trên nhánh `feat/t59-001-g1-contract-repin` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-014` | Join G1 ghim lại đủ 7 contract; validator không còn literal `schemaVersion == 4` / `20` / `80` / `25` mà lấy từ pin, nên contract đổi hợp lệ không còn buộc sửa code kiểm — nguồn chính khiến gate bị bỏ qua hoặc bị nới. Error count đối chiếu ba chiều catalog ↔ manifest ↔ pin; chuỗi migration store bị khoá liên tục `1..N` + hash từng file + head trùng pin; self-test khoá **lý do** reject, 12/12 mutation join và 6/6 manifest chain | Check/Commission API/UI runtime và `VS-PROG-019/024` PASS được review độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | `TestProgrammingStoreContractManifest` nay so `manifest.schemaVersion == CurrentSchemaVersion` và đối chiếu từng entry manifest với checksum embed; trước đó contract manifest và code Go trôi khỏi nhau vẫn xanh, tức migration path dùng cho activation/rollback không còn được chứng minh | worker lease/Core single-flight/reconcile và E2E fault chống double activation | `OPEN — PARTIAL SOURCE` |

Đây là evidence host/local (`verify-project.sh --component layout` exit 0, `ctest`
1052/1052, `go test` 18/18 package), **không** phải GitHub CI, target hay HIL.
Gate G1 chuyển từ đỏ sang xanh chỉ chứng minh join contract nhất quán; nó không
nâng lifecycle, không đổi S×L, không thêm residual accepted. 16/16 risk giữ
nguyên `Open`, 11 Critical giữ nguyên.

### 5.17 Cập nhật treatment source `T59-002` (Plan59 W0)

| Risk | Control đã có trên nhánh `feat/t59-002-product-profile-v2` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-014` | Profile machine-readable sinh **cả ba** consumer C++/Go/TS từ một nguồn; `runner.go` không còn chép tay `profileId`/`profileSha256`/`libraryVersion`/`integrityMode`/ABI; G1 ghim thêm schema hash, `documentMajor/Minor`, capacity và `targetAbi`; test đối chiếu hằng sinh với contract ở cả Go và TS | Check/Commission API/UI runtime và `VS-PROG-019/024` PASS được review độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-002` | Capacity scheduler chuyển từ `1/1/1` sang 3 lớp chu kỳ / 32 Program / 16 Enabled lấy từ profile; constraint text lỗi suy từ profile nên không còn nói `range=1..1` khi trần đã là 32; one-over vector khoá đúng trần ở C++/Go/TS | Due queue per-Program, `SCHED_FIFO`/jitter/WCET/watchdog trên Forlinx và Test Result `VS-PROG-009/015` | `OPEN — PARTIAL SOURCE` |

Evidence host/local (`ctest` 1055/1055, `go test` 18/18 package, FE 1066 test,
layout exit 0), **không** phải GitHub CI, target hay HIL. Nâng capacity trong
contract và validator **không** chứng minh runtime chạy được 32 Program: điều đó
thuộc `T59-402`/`T59-702`. Do đó 16/16 risk giữ `Open`, 11 Critical, S×L và
residual không đổi.

### 5.18 Cập nhật treatment source `T59-003` (Plan59 W0)

| Risk | Control đã có trên nhánh `feat/t59-003-pou-library-registry` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Allowlist FBD của Core, palette FE và danh sách Control Library cùng sinh từ một registry machine-readable; 4 entry ma `SCALE/DEADBAND/CTU/PI` bị gỡ, `SQRT` + 4 conversion Core từng từ chối được mở; 7 test khoá **hai chiều** registry↔compiler kể cả vector một-trên-trần | Lowering/equivalence cho user POU (`T59-101..105`), fuzz registry-driven (`T59-601`) và Test Result `VS-PROG-006` độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | G1 ghim contract thứ 8 `library-registry` gồm số đếm theo `dispatch`, `libraryVersion` và danh sách `REVIEW_REQUIRED`; entry ma quay lại bị verifier chặn; profile không còn giữ bản sao danh sách hàm | `VS-PROG-019/024` Test Result được review độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-004` | `PID` giữ `featureState = REVIEW_REQUIRED` trong chính contract, không phải nhãn UI; G1 từ chối nếu trạng thái đó bị xoá | Policy token chặn Commission (`T59-205`) và evidence Controls/Safety target (`T59-706`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local (`ctest` 1063/1063, Go 18/18 package, FE 1071 test, layout
exit 0), **không** phải GitHub CI, target hay HIL. Gỡ entry ma **không** chứng
minh runtime an toàn; nó chỉ đóng khoảng cách "hợp lệ ở FE, chết ở Core". 16/16
risk giữ `Open`, 11 Critical, S×L và residual không đổi.

### 5.19 Cập nhật treatment source `T59-004` (Plan59 W0)

| Risk | Control đã có trên nhánh `feat/t59-004-error-catalog-v2` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-014` | Catalog v1.6.0 26 public/118 detail phủ đủ POU/library/signal/output owner/enable/PID review; schema catalog **được thi hành** (trước đây chỉ băm nên `NOT_FOUND` drift im lặng); guard detail **hai chiều** kể cả source Go; `errorCopy.test.ts` bắt buộc mọi mã có copy VI/EN riêng nên FE không thể hiện mã thô | Emitter thật ở W1..W4 và `VS-PROG-019/024` Test Result được review độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-004` | `PRG-ERR-PID-REVIEW-001` + `ST-PID-001` cho phép Check từ chối PID thiếu approval token bằng một mã ổn định, thay vì gộp vào lỗi scope chung | Policy token và nhánh chặn Commission (`T59-205`); evidence Controls/Safety target (`T59-706`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local. Sáu mã mới **chưa có emitter** — đây là contract đi trước
consumer, không phải hành vi runtime mới; do đó không risk nào được hạ. 16/16 giữ
`Open`, 11 Critical, S×L và residual không đổi.

### 5.20 Cập nhật treatment source `T59-005` (Plan59 W0)

| Risk | Control đã có trên nhánh `feat/t59-005-store-schema-v2` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-007` | Migration v5→v6 nguyên tử ở cả ba điểm lỗi, idempotent qua restart, backup verified bắt buộc trước khi đổi schema; **không** tự Commission và **không** bật Program nào (`desired_enabled` mặc định 0) | Chạy migration trên board thật kèm cắt điện (`T59-705`) và Test Result độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | `program_runtime_intents.generation` chỉ tăng theo trigger, nên intent cũ tới muộn không ghi đè intent mới — chống đúng lớp double-activation ở tầng lưu trữ | Reconcile Core single-flight và E2E fault chống double activation | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-010` | `published_signal_defs` buộc `USE_FALLBACK` có giá trị dự phòng và cấm ba chính sách còn lại mang fallback, chặn lối "im lặng thay bằng 0" ngay ở schema | Runtime signal double-buffer/freshness (`T59-404`) và Test Result target | `OPEN — PARTIAL SOURCE` |

Evidence host/local. Schema chỉ là **chỗ chứa**: chưa có API, chưa có runtime đọc
các bảng này, và migration chưa chạy trên board. 16/16 risk giữ `Open`, 11
Critical, S×L và residual không đổi.

### 5.21 Cập nhật treatment source `T59-006` (Plan59 W0)

| Risk | Control đã có trên nhánh `feat/t59-006-contract-v2` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-014` | Catalog v1.7.0 dùng **đúng** bộ mã `DDD` §5.2 (30/120) thay cho sáu mã gộp mà `T59-004` tự đặt; OpenAPI v1.22, copy FE và ba consumer sinh lại cùng commit; guard IFSPEC chỉ đọc dòng authority nên văn xuôi không thể thỏa hoặc phá gate | Emitter thật ở W1..W4 và `VS-PROG-019/024` review độc lập | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | `artifact_v2.schema.json` khóa magic/section/`libraryLock`/`capacity` theo trần profile; chính sách dual-reader là contract máy đọc được, G1 ép mọi version từng ghi được vẫn phải đọc được nên nâng cấp không thể vô hiệu hóa LKG cũ | Writer/loader v2 (`T59-106`), golden byte-exact và fuzz loader | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-015` | `TRACE_START` không còn là action ma im lặng: contract khai `NOT_IMPLEMENTED` kèm task chủ, guard hai chiều chặn cả khai cao lẫn khai thấp hơn sự thật, và test chứng minh nó fail-closed chứ không trả `Ok` giả | Hiện thực ring buffer trace (`T59-408`) rồi lật trạng thái sang `IMPLEMENTED` | `OPEN — PARTIAL SOURCE` |

Evidence host/local. Contract v2 mới chỉ là **hình dạng**: chưa có writer, chưa
có loader, chưa có route. 16/16 risk giữ `Open`, 11 Critical, S×L và residual
không đổi.

## 6. Treatment/acceptance record bắt buộc

Mỗi risk chuyển trạng thái phải có record với: risk ID/version; cause/event/
impact; control ID và commit/package; Test Result current; actual S/L và rationale;
residual S×L; limitation/compensating control; owner; accepter đúng authority;
expiry/review trigger; change/incident links. Thiếu một field thì giữ `OPEN`.

| Trigger | Hành động bắt buộc |
|---|---|
| Requirement/design/contract đổi | impact 22 risk; reopen risk liên quan; invalidate evidence |
| Source/control merge | chuyển tối đa `TREATMENT_IMPLEMENTED`, chưa giảm residual |
| Test FAIL/INVALIDATED | `REOPENED`, liên kết defect/change và giữ raw evidence |
| Test PASS đúng baseline | risk owner đề xuất residual; độc lập review trước acceptance |
| Board/BOM/toolchain/profile đổi | đánh giá lại target/HIL evidence và risk safety/timing |
| Incident/near-miss | tạo finding, tăng S/L nếu evidence cho thấy; không chờ review định kỳ |

## 7. Lịch sử và phê duyệt

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Đăng ký 15 risk Programming |
| 0.2 | 2026-08-09 | Thêm scoring, cause-event-impact, trace control/test/evidence, target residual và lifecycle M3 |
| 0.3 | 2026-08-09 | Bổ sung treatment/acceptance record schema và trigger reopen/invalidate; đổi trạng thái content sang Detailed Draft, giữ residual/evidence RED |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại Risk; residual giữ nguyên |
| 0.5 | 2026-08-09 | Thêm `RSK-PROG-016` (đơn giản hóa UI làm mất bước an toàn, 5×3=15) kèm biện pháp fail-closed và scenario `VS-031`; tổng 16 risk, residual không đổi |
| 0.6 | 2026-08-11 | Ghi treatment source partial của `TASK-PROG-104` cho RSK-007/008 và ranh giới chưa hoàn tất của RSK-009/011; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted |
| 0.7 | 2026-08-11 | Ghi join contract/deploy/rollback `TASK-PROG-105` cho treatment partial RSK-006/007/008/014; hai Test Result G1 đều BLOCKED, giữ 16/16 Open, 11 Critical và 0 evidence/residual accepted |
| 0.8 | 2026-08-11 | Ghi `TASK-PROG-200` cho treatment partial RSK-006: hostile-source guard, sáu type/range/conversion, source map strict và hai campaign fuzz 10 triệu input; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì FBD/worker/runtime target và Test Result còn thiếu |
| 0.9 | 2026-08-11 | Ghi `TASK-PROG-201` tại `52dfb57` cho treatment partial RSK-006: FBD canonical contract/validator hai consumer, keyboard reducer và ASan fuzz 50.000 input; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì lowering/equivalence/worker/runtime target/Test Result còn thiếu |
| 1.0 | 2026-08-11 | Ghi `TASK-PROG-202` tại `4819901` cho treatment partial RSK-006: FBD→typed IR/runtime chung, 20 cặp equivalence, fail-closed và ASan fuzz 100.000 input; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì artifact/worker/runtime target/Test Result còn thiếu |
| 1.1 | 2026-08-11 | Ghi `TASK-PROG-203` tại `2c2bfb4` cho treatment partial RSK-006: manifest/hash/build-key/source-map ST/FBD deterministic và mutation fail-closed; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì worker/runtime target/Test Result còn thiếu |
| 1.2 | 2026-08-11 | Ghi `TASK-PROG-204` tại `66848a1` cho treatment partial RSK-007/008/014: sáu API Project/Draft/Revision, ETag/CAS, receipt idempotency 24 giờ qua restart, OpenAPI v1.17 và catalog 20/77; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì Check/operation worker, Core target và Test Result còn thiếu |
| 1.3 | 2026-08-11 | Ghi `TASK-PROG-205` tại `e8c289e` cho treatment partial RSK-005/006/007/008/014: Check lease/retry, compiler sandbox/timeout/process-group kill, Artifact content-address/read-back, OpenAPI v1.18 và catalog 20/80; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì target isolation, operation/Core và Test Result còn thiếu |
| 1.4 | 2026-08-11 | Ghi `TASK-PROG-206` tại `95b9388` cho treatment partial RSK-007/008/011/014: impact fail-closed, ZIP source-only/hash/allowlist, import Project/Draft atomic, receipt/audit và OpenAPI v1.19/G1 7/7; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì hostile corpus Task 207, operation/Core/target và Test Result còn thiếu |
| 1.5 | 2026-08-11 | Ghi `TASK-PROG-207` tại `3e5281d` cho treatment partial RSK-005/006/011/012/014: compiler resource faults, hostile corpus 25 lớp/zero-mutation 8 bảng, 23 audit alias, fuzz và contract G1; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì full RBAC, operation/Core/target và Test Result còn thiếu |
| 1.6 | 2026-08-11 | Ghi `TASK-PROG-300` tại `4f7e0ac` cho treatment partial RSK-003/006: prepared runtime ngoài scan, boundary/LKG swap không cấp phát và post-link no-parser/compiler gate; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì production wiring, Forlinx/HIL và Test Result còn thiếu |
| 1.7 | 2026-08-11 | Ghi `TASK-PROG-301` tại `a831a0d` cho treatment partial RSK-002: profile Rev A 1/1/1, period 1/5/30 s, budget `<20%`, base-step sequence/missed release và watchdog ADR-028; giữ 16/16 Open, 11 Critical, 0 evidence/residual accepted vì bootstrap/timing `SCHED_FIFO`/Forlinx/HIL và Test Result còn thiếu |
| 1.8 | 2026-08-13 | Ghi `TASK-PROG-402` tại `3ca5d22` cho treatment source RSK-009: stable identity/layout/version, CRC toàn record, typed/FB codec, checkpoint sau output commit, async atomic write và explicit cold-init/status; giữ 16/16 Open, 11 Critical và residual 15 vì `VS-PROG-029/030` Forlinx/HIL chưa chạy/chưa được chấp nhận. |
| 1.9 | 2026-08-13 | Ghi `TASK-PROG-403..405` tại `c2f3189` + `10d9ad6` cho treatment source RSK-001/003/007/009: durable idempotent operation, verified staging, UDS peer check, exclusive safe-boundary owner, first-output rollback và checkpoint recovery. Giữ 16/16 Open, 11 Critical và mọi residual vì target/HIL/power-cut/Test Result chưa chạy/chưa được chấp nhận. |
| 2.0 | 2026-08-20 | Ghi `T59-001` (Plan59 W0) cho treatment partial RSK-008/014: re-pin join G1, bỏ hardcode schema/count trong validator, khoá chuỗi migration store và siết self-test theo đúng lý do reject. Giữ 16/16 Open, 11 Critical và mọi residual vì runtime/target/HIL/Test Result chưa chạy. |
| 2.1 | 2026-08-20 | Ghi `T59-002` (Plan59 W0) cho treatment partial RSK-002/014: profile v2 sinh C++/Go/TS từ một nguồn, capacity 32/16 thay 1/1/1, constraint text suy từ profile và one-over vector ba ngôn ngữ. Giữ 16/16 Open, 11 Critical và mọi residual vì runtime multi-Program, target/HIL và Test Result chưa chạy. |
| 2.2 | 2026-08-20 | Ghi `T59-003` (Plan59 W0) cho treatment partial RSK-004/006/014: registry POU/library làm nguồn duy nhất, gỡ 4 entry ma, mở SQRT + 4 conversion, khoá hai chiều registry↔compiler và ghim `REVIEW_REQUIRED` của PID vào contract. Giữ 16/16 Open, 11 Critical và mọi residual vì lowering user POU, target/HIL và Test Result chưa chạy. |
| 2.3 | 2026-08-20 | Ghi `T59-004` (Plan59 W0) cho treatment partial RSK-004/014: catalog v1.6.0 26/118, schema catalog được thi hành, guard detail hai chiều gồm source Go, copy FE phủ đủ mã. Giữ 16/16 Open, 11 Critical và mọi residual vì emitter W1..W4, target/HIL và Test Result chưa chạy. |
| 2.4 | 2026-08-20 | Ghi `T59-005` (Plan59 W0) cho treatment partial RSK-007/008/010: store schema v6, migration atomic/idempotent/không tự Commission, generation intent chỉ tăng và chính sách fallback signal bị ràng buộc ở schema. Giữ 16/16 Open, 11 Critical và mọi residual vì API/runtime/board chưa có. |
| 2.5 | 2026-08-20 | Ghi `T59-006` (Plan59 W0) cho treatment partial RSK-006/014/015: catalog v1.7.0 theo đúng bộ tên DDD §5.2 (đính chính T59-004), artifact v2 + dual-reader thành contract G1, và guard action IPC hai chiều. Giữ 16/16 Open, 11 Critical và mọi residual vì writer/loader/route chưa có. |
| 2.0 | 2026-08-13 | Ghi `TASK-PROG-500..506` tại `e58c745`..`14a9299` cho treatment source RSK-007/008/014/016: FE bốn workspace đọc runtime/operation thật (không optimistic active, `UNKNOWN_RECONCILING` không auto-replay), `If-Match`+idempotency giữ Draft qua conflict, `programmingErrorCopy` map đủ 19 mã lỗi, `AcknowledgementChecklist` khớp đúng ba nhóm impact với câu RETAIN đúng UC-PROG-13. Bằng chứng Chrome/Playwright thật desktop+mobile (`EV-PROG-P5-500-506`). Giữ 16/16 Open, 11 Critical và mọi residual — E2E dùng mock BE, chưa có target/HIL/usability người thật/review độc lập cho `VS-PROG-004/011/019/024/026/031`. |
| 2.1 | 2026-08-13 | Ghi `TASK-PROG-507` cho treatment target web RSK-007/008/012/014: Foxlinx cleanup 22%→10%, backup/checksum/rollback, JWT secret rotation, ARM64 deploy/read-back, Chrome desktop/mobile và Project/Draft/Revision/Check `201/200/201/202`; ba drift runtime được sửa. Giữ 16/16 Open, 11 Critical và mọi residual vì Check target fail-closed do thiếu compiler, Core Programming/HIL/power-cut/usability/reviewer độc lập còn thiếu; flag cuối OFF, không Commission. |
| 2.2 | 2026-08-13 | Mở rộng `TASK-PROG-507` tại `0f1526c`: cài FE/Web/compiler/Core ARM64, sửa safe-state legacy `null`, bật cờ production; hai Check PASS, Commission output-free thành công và Core read-back đúng. Treatment target happy path RSK-007/008/014 đã có supporting evidence; giữ 16/16 Open, 11 Critical và mọi residual vì output vật lý/fault/power/HIL/usability/reviewer độc lập chưa có Test Result. |
| 3.0 | 2026-08-20 | ADR-050 hợp nhất một Product; thêm RSK-017..022 cho signal race, scheduler dependency, POU recursion, library supply chain, output ownership và package/power loss; 22/22 Open, Plan59 sở hữu treatment/evidence. |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Risk owners + Safety/Security/Ops | Chờ review | — |
| Product + Architect + Verification | **WAIVED FOR IMPLEMENTATION; RESIDUAL NOT ACCEPTED** | 0/22 evidence/residual accepted; vẫn chặn release/cutover |

## 8. Phụ lục — Tự kiểm cổng M3 (loại: Risk)

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Cause → event → impact | PASS | §3 cột đầu tách đủ ba khâu cho cả 22 rủi ro |
| Severity và Likelihood | PASS | Bảng chính có `S×L`; §2 định nghĩa thang 1..5 cho từng trục |
| Biện pháp kiểm soát | PASS | §3 cột “Control cần implement/verify” và “Requirement / thiết kế kiểm soát” |
| Owner | PASS | §3 cột cuối, kèm điều kiện kích hoạt review lại |
| Verification và evidence | PASS | §3 cột “Scenario / evidence authority” gắn `VS-PROG-*` và loại bằng chứng cần thiết |
| Residual | PASS | Bảng chính giữ nguyên `S×L` gốc; §2 nêu rõ residual **chỉ giảm sau khi có bằng chứng** |
| Thẩm quyền chấp nhận | PASS | §6 schema bản ghi treatment/acceptance đủ trường; thiếu một trường thì giữ `OPEN` |
| Ngày review lại | PASS | Metadata đầu file và §6 bảng trigger |
| Evidence queue có owner/gate | **OPEN FOR RELEASE** | 0/22 evidence và 0/22 residual được chấp nhận. Owner: Product Owner + System Architect + Verification Lead, cùng từng risk owner. Ảnh hưởng: 17 rủi ro `Critical` chặn cutover production, không chặn implementation. Gate: Plan59 W7. Điều kiện mở: chạy các `VS-PROG-*`/`VS-PROG-U*` tương ứng, risk owner đề xuất residual, reviewer độc lập xác nhận, rồi ba vai trò trên ký |

Vòng chi tiết này làm rõ biện pháp kiểm soát nhưng **không giảm rủi ro nào**.
Gate production vẫn `RED`.
