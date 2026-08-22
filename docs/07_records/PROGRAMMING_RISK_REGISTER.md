# Sổ đăng ký rủi ro Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `RSK-PROG-001` |
| Phiên bản | 4.19 |
| Trạng thái | **Active — 22/22 Open; implementation controls ready, residual chờ evidence** |
| Ngày | 2026-08-21 |
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
| 3. Hệ thống hiện tại đang có gì? | 22/22 Open. Source W5 trên nhánh đã bổ sung sáu workspace/lifecycle, Monitor Point + Published Signal fail-closed, ST/FBD editor và lane E2E backend/compiler/Core simulator thật trên HOST/LOCAL. Các cổng HOST thành phần hiện hành đã PASS; chưa có GitHub CI verdict, Test Result được review, target/HIL hay residual được chấp nhận. |
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

### 5.22 Cập nhật treatment source `T59-007` (Plan59 W0)

| Risk | Control đã có trên nhánh `feat/t59-007-local-ci-parity` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-015` | Runner cổng **không có đường nào** báo PASS cho cổng mức CI/TARGET/HIL — chúng luôn `NOT_RUN` kèm `requiresResource`/`runbook`/`owner`, và mỗi lần chạy in cảnh báo "đây không phải GitHub CI, không phải target, không phải HIL". Schema ma trận chặn hai chiều nên không thể khai một cổng target như thể chạy được cục bộ | GitHub CI thật (`T59-701`) và evidence target/HIL (`T59-702..704`) | `OPEN — PARTIAL SOURCE` |

Đây là control chống **claim sai mức bằng chứng**, không phải bằng chứng về sản
phẩm. Nó không hạ risk nào: 16/16 giữ `Open`, 11 Critical, S×L và residual không đổi.

### 5.23 Cập nhật treatment source `T59-101` (Plan59 W1)

| Risk | Control đã có trên nhánh `feat/t59-101-pou-parser` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Quy tắc kind/chữ ký POU được ép ngay ở parser với mã riêng `ST-POU-001` và vị trí chính xác của khai báo vi phạm; `FUNCTION` không thể khai `VAR_OUTPUT`/`VAR RETAIN`/FB instance. `parse_st_program()` giữ hợp đồng cũ nên `FUNCTION`/`FUNCTION_BLOCK` **chưa** compile được — không có cửa nửa vời | Symbol/call graph + recursion guard (`T59-102`), purity enforcement (`T59-103`), instance state/RETAIN (`T59-104`), fuzz parser POU (`T59-601`) và Test Result `VS-PROG-006` | `OPEN — PARTIAL SOURCE` |

Evidence host/local. Parser mới chỉ **đọc** được POU; chưa có lowering, chưa có
runtime. 16/16 risk giữ `Open`, 11 Critical, S×L và residual không đổi.

### 5.24 Cập nhật treatment source `T59-102` (Plan59 W1)

| Risk | Control đã có trên nhánh `feat/t59-102-pou-registry` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Đệ quy trực tiếp **và** gián tiếp bị chặn trước mọi lowering (Kahn trên call graph), chu trình dài 2..4 đều fail-closed; sơ đồ kim cương vẫn được chấp nhận nên guard không chặn nhầm thư viện dùng chung. Đồ thị **độc lập thứ tự nạp**, nên hai lần Check cùng nguồn cho cùng diagnostic | Purity enforcement (`T59-103`), instance state (`T59-104`), fuzz registry (`T59-601`) và Test Result `VS-PROG-006` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Ba tình huống "gọi một tên không dùng được" có ba mã riêng — thiếu entry `ST-LIB-001`, lệch version `ST-LIB-002`, đệ quy `ST-POU-003` — nên FE và người vận hành biết chính xác phải làm gì | Emitter nối vào Check thật và `VS-PROG-019/024` review độc lập | `OPEN — PARTIAL SOURCE` |

Evidence host/local. Registry mới chỉ **phân giải và kiểm**; chưa có lowering,
chưa nối vào đường Check production. 16/16 risk giữ `Open`, 11 Critical, S×L và
residual không đổi.

### 5.25 Cập nhật treatment source `T59-103` (Plan59 W1)

| Risk | Control đã có trên nhánh `feat/t59-103-function-purity` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Purity `FUNCTION` ép ở registry — điểm hội tụ của MỌI producer, không chỉ parser ST — nên AST đến từ lowering FBD cũng không lách được; test dựng AST không qua parser chứng minh điều đó. State/`VAR_OUTPUT`/FB instance/gọi POU có state đều fail-closed | Lowering FBD gọi user POU (`T59-105`), instance state/RETAIN (`T59-104`), fuzz (`T59-601`) và Test Result `VS-PROG-006` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Cùng một lời gọi sai nhưng người gọi khác nhau cho **mã khác nhau** (`ST-POU-002` "bỏ FB đi" vs `ST-POU-001` "khai instance"), nên thông điệp nói đúng việc cần làm thay vì gộp thành một lỗi chung | Emitter nối vào Check thật và `VS-PROG-019/024` review độc lập | `OPEN — PARTIAL SOURCE` |

Evidence host/local. Registry kiểm **số đối số** và sự tồn tại kiểu trả về; suy
kiểu từng biểu thức đối số thuộc `T59-105` và sẽ dùng lại bảng `signatures` chứ
không dựng bộ thứ hai. 16/16 risk giữ `Open`, 11 Critical, S×L và residual không đổi.

### 5.26 Cập nhật treatment source `T59-104` (Plan59 W1)

| Risk | Control đã có trên nhánh `feat/t59-104-fb-instance-state` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-009` | Layout instance FB đi theo **thứ tự tên canonical**, nên sắp xếp lại khai báo trong nguồn KHÔNG đổi offset hay identity — chặn đúng lớp lỗi "chỉnh sửa vô hại làm cold-init toàn bộ state". Đổi tên/đổi kiểu thì `layout_identity` đổi theo, để runtime cold-init đúng phần đã đổi thay vì đọc nhầm state cũ | Nối vào prepared image và cold-init thật (`T59-401`/`T59-407`), power-cut trên board (`T59-704`) và Test Result `VS-PROG-029/030` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | Vòng **chứa** instance (trực tiếp và gián tiếp) cùng độ sâu lồng nhau bị chặn trước mọi cấp phát; trần package 1024 kiểm tách khỏi trần Program 64 nên từng Program hợp lệ mà tổng vượt vẫn fail-closed | Lowering FBD (`T59-105`), fuzz layout (`T59-601`) và Test Result độc lập | `OPEN — PARTIAL SOURCE` |

Evidence host/local. Đây là **bộ hoạch định layout**, chưa phải runtime cấp phát;
state của instance đến từ Control Library cố ý ghi `0` chờ artifact library
(`T59-204`) thay vì đoán một con số làm lệch mọi offset phía sau. 16/16 risk giữ
`Open`, 11 Critical, S×L và residual không đổi.

### 5.27 Cập nhật treatment source `T59-105` (Plan59 W1)

| Risk | Control đã có trên nhánh `feat/t59-105-fbd-user-pou` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | ST và FBD lower lời gọi POU thành **cùng một nút AST**, có test so trực tiếp — không tồn tại hai bộ ngữ nghĩa để trôi khỏi nhau. Thứ tự đối số bám `order` của cổng chứ không bám thứ tự dây, nên vẽ lại cùng sơ đồ không đổi nghĩa. Codegen vẫn fail-closed với lời gọi chưa liên kết, không sinh artifact thiếu thân hàm | Liên kết lời gọi POU vào IR chạy được (`T59-106`), fuzz FBD với POU người dùng (`T59-601`) và Test Result `VS-PROG-006` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-016` | FE sinh pin từ interface POU và **từ chối** interface mâu thuẫn thay vì sinh pin sai; test đi qua reducer thật nên kết nối/undo/chặn chỉ-đọc/announcement là hành vi thật | UI duyệt POU trong cây Project (`T59-306`), usability test người dùng thật (`VS-PROG-031`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local. Lowering đúng nhưng **codegen chưa liên kết** lời gọi POU;
đó là ranh giới được nêu rõ và có test khoá. 16/16 risk giữ `Open`, 11 Critical,
S×L và residual không đổi.

### 5.28 Cập nhật treatment source `T59-106` (Plan59 W1, đóng Wave)

| Risk | Control đã có trên nhánh `feat/t59-106-artifact-v2` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-006` | Loader package v2 kiểm toàn bộ offset/count/overflow trên **64 bit**, bảng section phải đơn điệu, section lạ bị từ chối chứ không bỏ qua, vùng chữ ký reserved phải bằng 0, hash toàn artifact phải khớp. **Fuzz lật từng byte 1314 biến thể, 0 lần chấp nhận nhầm, không crash** | Fuzz dài hạn trong CI (`T59-601`), loader chạy trên target (`T59-702`) và Test Result `VS-PROG-006/023` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-004` | Hai bất biến an toàn cấp package được kiểm **ở loader**, không chỉ ở writer: một output binding có đúng một Program owner, một signal có đúng một publisher. Artifact tới từ nguồn khác cũng không lách được | Resolver/interlock/safe-state runtime (`T59-406`) và evidence I/O vật lý (`T59-703`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-003` | Dual-reader nhận cả v1 lẫn v2 nên **LKG v1 hiện hữu không mất hiệu lực khi nâng cấp** (DDD §12.1); golden do chính writer production sinh, byte-stable, ghim hash/kích thước/số Program trong G1 | Nạp prepared image và kích hoạt (`T59-401`), rollback rehearsal trên board (`T59-705`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local. Đây là **container**: nó mang và kiểm khung. Lắp nội dung
package thuộc `T59-305`, nạp và kích hoạt thuộc `T59-401`. Blob IR trong golden là
dữ liệu tất định do công cụ sinh, **không phải** mã biên dịch từ nguồn thật —
điều này được ghi rõ trong công cụ lẫn test và **không** được dùng như bằng chứng
rằng compiler đã sinh được package thật. 16/16 risk giữ `Open`, 11 Critical, S×L
và residual không đổi.

### 5.29 Cập nhật treatment source `T59-201` (Plan59 W2)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-020` | SYSTEM Library là snapshot **virtual read-only** sinh từ đúng registry, revision ID content-addressed và G1 giữ lịch sử `version→hash`, nên sửa semantics mà tái dùng version bị generator/gate từ chối. PROJECT Library có Draft mutable, Publish dựng manifest canonical trong transaction, Published/Deprecated bất biến ở cả store lẫn trigger; version mới clone từ parent đã publish. Hash entry phủ canonical source+interface+dependency, không dùng hash signature rút gọn | REST/RBAC/audit (`T59-202`), hostile source-only import/export (`T59-204`), signed library/artifact (`T59-602`), full API/security matrix (`T59-603`) và Test Result `U03` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-009` | FUNCTION có `state_size=0` authoritative; PROJECT FUNCTION_BLOCK chỉ được Publish khi version/size/hash layout đủ. Trạng thái unknown bắt buộc mọi field bằng zero/null, nên không thể mang số đoán hoặc stale rồi làm lệch offset phía sau | Compiler sinh layout authoritative và bundle compatibility (`T59-204`), runtime cold-init/RETAIN (`T59-407`) cùng power-cut target (`T59-704`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Resolver domain giữ riêng missing entry `ST-LIB-001`, version drift `ST-LIB-002` và dependency/POU cycle `ST-POU-003`; store gọi cùng validator thay vì gộp thành lỗi “unknown function” | Nối emitter vào Check/API thật (`T59-202/302`) và Test Result `U03`/`VS-PROG-019/024` | `OPEN — PARTIAL SOURCE` |

Evidence mới chỉ ở host/local cho domain, migration/store, restart và fault
injection. Chưa có REST/FE/compiler package/runtime/target/HIL/Test Result; vì vậy
**22/22 risk vẫn Open**, S×L và residual không đổi.

### 5.30 Cập nhật treatment source `T59-202` (Plan59 W2)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-020` | Ba route Control Library theo đúng DDD §5.1; mutation là **admin-only** kiểm bằng authorizer thật (viewer/operator đọc được nhưng 403 khi ghi); `If-Match` + idempotency bắt buộc và bị từ chối TRƯỚC khi chạm store; biên nhận idempotency và audit nằm cùng transaction với thay đổi; `featureState=REVIEW_REQUIRED` không nhận từ payload | UI (`T59-203`), import/export nguồn thù địch (`T59-204`), signed library (`T59-602`), ma trận security/RBAC đầy đủ (`T59-603`) và Test Result `U03` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | `LibraryPublicError` giữ `ST-LIB-001`/`ST-LIB-002`/`ST-POU-003` thành ba mã public khác nhau tới tận lớp HTTP; cursor tìm kiếm ký HMAC và ràng buộc luôn bộ lọc nên trang sau không đổi phạm vi âm thầm | Nối emitter vào Check thật (`T59-302`), copy FE (`T59-203`) và Test Result `VS-PROG-019/024` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | Mutation library tăng ETag Draft của Project nên hai lane (tài liệu và library) không sửa xen kẽ nhau mà không bên nào thấy; ETag cũ bị 409 | E2E real-backend (`T59-505`) và ma trận concurrency (`T59-603`) | `OPEN — PARTIAL SOURCE` |

Hai finding thật được sửa trong task: handler library nuốt route Project khác
(làm seal Revision hỏng), và actor rỗng cho `503 retryable` thay vì lỗi REQUEST.
Khoảng hở actor rỗng còn tồn tại ở Project/Check/Operation service và được ghi
sang `T59-603`. Evidence vẫn chỉ ở host/local, chưa có FE/target/HIL/Test Result;
**22/22 risk giữ Open**, S×L và residual không đổi.

### 5.31 Cập nhật treatment source `T59-205` (Plan59 W2)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-005` | PID giữ nhãn `REVIEW_REQUIRED` và Check **chặn** ở cả ba đường (`compile_st_source` mặc định BẬT, validate CLI, `compile_fbd_source`), gate độc lập producer nên lowering FBD không thành đường vòng. Token phê duyệt suy ra từ chính profile contract kèm `libraryVersion`, generator từ chối token bịa, và G1 ghim riêng `approvedReviewGatedFeatures` nên mở PID làm gate đỏ cho tới khi pin đổi | Evidence Controls/Safety thật (`VS-PROG-U12` qua `T59-706`): saturation/anti-windup/override/release trên target; UI cảnh báo (`T59-203`/`T59-506`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-020` | Chính sách feature-gate là contract máy đọc được, hai chiều với registry: entry `REVIEW_REQUIRED` phải được khai và feature đã khai phải thật sự `REVIEW_REQUIRED` | Ma trận security/RBAC đầy đủ (`T59-603`) và Test Result `U03` | `OPEN — PARTIAL SOURCE` |

Bài học ghi lại vì nó suýt thành lỗi thiết kế: đặt gate trong `typecheck` làm
**bộ conformance của chính PID** không compile được — tức khoá luôn thứ duy nhất
mở khoá được gate. Gate vì vậy là chính sách ở biên Check, không phải luật ngôn
ngữ. Evidence vẫn host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.32 Cập nhật treatment source `T59-204` (Plan59 W2)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-017` | Bundle nguồn mang Control Library nhưng **không** mang artifact/IR/cache; corpus thù địch 10 biến thể (path traversal, đường dẫn tuyệt đối, file thực thi, entry ngoài manifest, sửa nội dung giữ hash, tự dán `REVIEW_REQUIRED`, `stateLayout` sai kind, `entryCount` lệch, manifest giấu library, dependency lệch version) đều bị từ chối và để lại **0 mutation** | Ký bundle/artifact (`T59-602`), ma trận security đầy đủ (`T59-603`), Test Result `U03` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-020` | `systemLibraryVersion` phải khớp chính xác và có **mã lỗi riêng**; library nhập về nhận identity mới ở `DRAFT`; Seal publish+pin library trong cùng transaction nên Revision không còn pin một library vẫn sửa được | Compiler dùng library đã pin (`T59-302`), runtime (`T59-401`), target | `OPEN — PARTIAL SOURCE` |

Hai finding thuộc phạm vi đã sửa: Seal Revision trước đây **không** đóng băng
library, và phép đếm descriptor của bundle lệch ngay khi có file library. Trust
vẫn là `HASH_ONLY` — bundle chưa ký; **22/22 risk giữ Open**, residual không đổi.

### 5.33 Cập nhật treatment source `T59-203` (Plan59 W2 — đóng Wave)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-005` | PGM-04 hiển thị nhãn review-gate ở danh sách và chi tiết, nói thẳng rằng Check sẽ từ chối; **không có** checkbox hay nút duyệt nào ở UI (có test khẳng định không tồn tại `role="checkbox"`) | Evidence Controls/Safety thật (`T59-706`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | `stateLayoutKnown=false` hiển thị "chưa biết" chứ không phải `0 B`; lỗi tải dùng copy theo mã public; permission tách khỏi lỗi | E2E real-backend (`T59-505`), usability người thật | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | ETag Draft mới được dùng lại ngay cho thao tác kế tiếp, có test khoá chuỗi hai mutation liên tiếp | E2E real-backend (`T59-505`) | `OPEN — PARTIAL SOURCE` |

Wave W2 đóng với 5/5 task DONE. Evidence vẫn là host/local (vitest + jsdom) —
**không** phải E2E trình duyệt thật, không phải target/HIL. `22/22` risk giữ
Open, S×L và residual không đổi.

### 5.34 Cập nhật treatment source `T59-301` (Plan59 W3 — mở Wave)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-001` | Document v2 tách POU khỏi cấu hình Program và mang trần 32 Program là **trần cứng ở Draft**: Program thứ 33 bị từ chối và Draft giữ đúng 32, POU đi kèm cũng không được ghi | Check/compile 32 Program (`T59-302`), manifest/topology/budget (`T59-305`), runtime (`T59-402`), target 10-Program (`T59-702`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | Migration v1→v2 **tất định + idempotent + giữ nguyên identity**, nên Revision đã seal không trỏ hư không; `compilerInput` đọc cả hai đời tên nên Revision cũ vẫn Check lại được | Migration trên board thật (`T59-705`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-012` | `signals` là công dân hạng nhất ở Draft với publisher/freshness/policy/fallback; `USE_FALLBACK` và giá trị dự phòng đi liền nhau; dải freshness khớp chính xác `CHECK` của store | Validation cấp package (`T59-304`), runtime double-buffer (`T59-404`) | `OPEN — PARTIAL SOURCE` |

Ba consumer được sửa theo mà **không nhân bản dữ liệu**: io_map đọc `locals` của
POU, phân loại RETAIN đọc tập biến RETAIN của POU, và `compilerInput` đọc cả hai
đời tên. Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.35 Cập nhật treatment source `T59-302` (Plan59 W3)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-001` | Check biên dịch **mọi** Program của package (trần pipeline 1 đã gỡ) và lắp container v2 bằng chính writer production; thứ tự biên dịch ổn định theo `objectId` | Topology/budget/`desiredEnabled` (`T59-305`), runtime scheduler (`T59-402`), target (`T59-702`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-003` | Container do `WritePackageV2()` ghi và được **đọc lại bằng chính loader** trước khi lưu; hash package tính lại từ byte đọc về, không nhận con số CLI báo; package byte-stable qua hai lần chạy | Ký artifact (`T59-602`), nạp trên target (`T59-702`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Diagnostic của mọi Program hỏng được **gộp** trong một lần Check và mỗi cái mang `programId` của chính nó | Nối signal/output-owner vào Check (`T59-304`), FE hiển thị (`T59-306`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | Check không đụng Draft và không sinh hành động triển khai (kiểm cả chiều đạt lẫn hỏng); hai worker chia nhau Check qua lease | E2E real-backend (`T59-505`) | `OPEN — PARTIAL SOURCE` |

Một finding trong task: bản đầu của migration `0009` đưa lại UNIQUE trên content
hash và làm rơi index/trigger, tái tạo đúng lỗi mà migration v3 đã sửa — bộ test
đầy đủ bắt được ngay. Evidence host/local; **22/22 risk giữ Open**, S×L và
residual không đổi.

### 5.36 Cập nhật treatment source `T59-303` (Plan59 W3)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-011` | Binding MB_RTU đi qua Point contract canonical: compiler nhận `extIndex` do Point Catalog phân giải và **không** tự suy slot, nên không tái định nghĩa register/function code/endian/chu kỳ poll ở lớp không sở hữu chúng | Point Catalog phát `extIndex` cho Mapping tab (`T59-306`), nghiệm thu I/O Modbus trên board (`T59-703`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Thiếu `extIndex`, thiếu `deviceId`, vượt trần 256, sai chiều và kiểu `TIME` đều fail-closed với diagnostic riêng; guard BE kiểm hai chiều | Test Result `VS-PROG-019/024` | `OPEN — PARTIAL SOURCE` |

Hai test cũ khoá hành vi "MB_RTU không hỗ trợ" được **thay** chứ không xoá, để
không mất phép kiểm allowlist category. Evidence host/local; **22/22 risk giữ
Open**, S×L và residual không đổi.

### 5.37 Cập nhật treatment source `T59-304` (Plan59 W3)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-002` | Một output binding có đúng một Program owner, kiểm ở **Check** trước khi biên dịch và nhận diện theo **điểm vật lý** (`deviceId`+`extIndex` với MB_RTU) chứ không theo tên điểm | Trọng tài output/candidate withdrawal runtime (`T59-406`), HIL I/O vật lý (`T59-703`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-012` | Bốn luật Published Signal kiểm ở Check: đúng một publisher (case-folded), publisher phải tồn tại, freshness 1000..90000, `USE_FALLBACK` ghép cứng với giá trị dự phòng | Double-buffer/freshness/fallback lúc chạy (`T59-404`), Test Result `U05/U06` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Mọi vi phạm cấp package được **gộp** trong một lần Check, mỗi diagnostic mang `signalId`/`programId`/`pointId` của chính nó | FE hiển thị (`T59-306`), Test Result `VS-PROG-019/024` | `OPEN — PARTIAL SOURCE` |

Kiểm ở Check **bổ sung** cho loader chứ không thay: loader vẫn phải kiểm vì
artifact có thể tới từ nơi khác. Evidence host/local; **22/22 risk giữ Open**,
S×L và residual không đổi.

### 5.38 Cập nhật treatment source `T59-305` (Plan59 W3)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-001` | Manifest package mang topology và budget theo profile (32/16/20% + số Program từng lớp chu kỳ); trần 32 được ép **lại** ở Check vì Revision có thể tới từ bundle import; chu kỳ ngoài ba lớp profile bị từ chối | Thi hành trần 16 Enabled qua intent thật (`T59-405`), ngân sách thời gian thực (`T59-402`), target (`T59-702`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-007` | Program mới luôn `desiredEnabled=false` trong topology: package không tự bật thứ vừa được nạp; phép kiểm giữ cả khi không có đường đặt cờ true | Enable/Disable end-to-end với audit và read-back (`T59-405`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-003` | Topology **không phụ thuộc thứ tự tạo**: hai Project cùng nội dung dựng khác thứ tự cho đúng cùng manifest, nên provenance so sánh được giữa hai controller | Reproducible build cấp RC (`T59-606`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.39 Cập nhật treatment source `T59-306` (Plan59 W3 — đóng Wave)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-014` | Inspector **ẩn** chu kỳ/trạng thái bật với Function/FB thay vì hiện rồi xám, và nói thẳng vì sao; Program hiện `Tắt (mặc định cho Program mới)` khớp `desiredEnabled=false` của topology | E2E real-backend (`T59-505`), usability người thật | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-016` | IA sáu trang đúng DDD §8: `programs`/`mapping` là route đích, `/design` là lối vào cũ giữ nguyên query định vị lỗi; route thắng query nên trang luôn khớp địa chỉ của chính nó | Ba workspace còn lại của IA (`T59-503`), E2E (`T59-505`) | `OPEN — PARTIAL SOURCE` |

Wave W3 đóng với 6/6 task DONE. Evidence host/local (vitest + jsdom) — **không**
phải E2E trình duyệt thật, không phải target/HIL. `22/22` risk giữ Open, S×L và
residual không đổi.

### 5.40 Cập nhật treatment source `T59-401` (Plan59 W4 — mở Wave)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-003` | Coordinator nạp package v2 qua **đúng một parser** dùng chung với loader; mỗi Program phải có đúng một blob IR; gói hỏng để lại **0 mutation** vì mọi stage trước đó bị huỷ | Ký artifact (`T59-602`), nạp trên target (`T59-702`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-001` | Topology dựng theo **chính package**: bootstrap không còn khai trước tên Program, `instance_id` bỏ hardcode `program-main` nhưng vẫn bị ép định dạng; stage/arm/rollback/start chạy trên toàn bộ tập instance | Scheduler đa chu kỳ (`T59-402`), fault isolation (`T59-403`), target 10-Program (`T59-702`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | Dual-reader còn sống: artifact v1 một Program vẫn nạp được, có test khoá — mất đường này là mất bản LKG cuối cùng sau một lần nâng cấp | Rollback trên target (`T59-705`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.41 Cập nhật treatment source `T59-402` (Plan59 W4)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-018` | Mỗi Program release theo **deadline riêng**, bù trôi theo mốc **lý thuyết** nên một tick trễ không đẩy mọi deadline sau đó; lỡ chu kỳ thì **đếm và bỏ** chứ không chạy bù, để một lần quá tải không thành chuỗi quá tải; thứ tự chạy theo `order` duy nhất, độc lập thứ tự tạo | Worker lane và ràng buộc không cấp phát trong RT (`T59-403`), đo tải thật trên target 10-Program (`T59-702`), Test Result `VS-PROG-U05` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-001` | Chu kỳ + ngân sách đi **trong `PROGRAM_TABLE` của package**, coordinator áp lên instance mỗi lần dựng topology kể cả instance đã tồn tại; writer **và** loader cùng từ chối chu kỳ ngoài ba lớp profile — loader không được tin writer vì gói có thể do writer khác phiên bản sinh | Publish số đo tải ra API (`T59-408`), nghiệm thu target (`T59-702`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-005` | Trần **16 Program chạy đồng thời** ép ở `start()` — nơi Program thực sự bắt đầu tác động lên đầu ra, không phải ở lớp cấu hình vốn chỉ chặn được *ý định*; trần là trần **động**, dừng một Program giải phóng đúng một suất | Đường intent Enable/Disable đầu-cuối (`T59-405`), Test Result `VS-PROG-U07` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-022` | Đường khôi phục sau reboot nay đi qua **đúng** `split_package` + `ensure_topology` như đường stage. Trước bản vá, `load_active_checkpoint` nạp nguyên khối container v2 vào một instance như thể artifact v1: loader IR v1 từ chối và thiết bị tỉnh dậy **không có Program nào** | Ma trận fault/power-cut đầy đủ (`T59-501`, `T59-704`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.42 Cập nhật treatment source `T59-403` (Plan59 W4)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-018` | Hai chế độ lane cho **đúng cùng** kết quả trên fixture 10 Program/3 chu kỳ/4 lane, ổn định qua 20 lần lặp; kết quả lane trộn theo **số hiệu lane** chứ không theo thứ tự hoàn thành nên trace và số đếm không phụ thuộc lane nào chạy nhanh hơn; TSan 54 test **0 cảnh báo**, tái lập bằng `scripts/run_core_tsan.sh` | Chạy 24 h trên target (`T59-702`), Test Result `VS-PROG-U05` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | **Đảo chiều** chính sách fault theo kiến trúc §8 `isolate Program`: fault của một Program không còn dừng cả Task, kể cả Program cùng lane; `last_dispatch_succeeded()` vẫn `false` nên cô lập không biến thành im lặng | Rút candidate và safe-state khi Program fault (`T59-406`), fault trên target (`T59-702`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-021` | Đường quét **0 cấp phát** ở cả hai chế độ (đo bằng `allocation_probe`); worker tạo sẵn ngoài chu kỳ, spin+yield không vào kernel; lane vượt số worker chạy nốt trên luồng gọi nên thiếu worker làm chậm chứ không làm bỏ sót | Đo WCET thật trên target ít nhân (`T59-702`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.43 Cập nhật treatment source `T59-404` (Plan59 W4)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-017` | Double-buffer + commit ở boundary: consumer **không bao giờ** thấy giá trị chưa từng được publish, và mọi consumer trong một chu kỳ thấy **cùng một** ảnh signal nên kết quả không phụ thuộc lane nào chạy trước; 20.000 vòng publisher/consumer song song cho **0 lần đọc rách** | Nối opcode đọc/ghi signal vào thân chương trình, chạy 24 h trên target (`T59-702`), Test Result `VS-PROG-U08` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-012` | Ba chính sách stale cho ba hành vi **khác nhau**; "chưa ai publish" khác "quá hạn" — chỉ `USE_FALLBACK` có câu trả lời khai báo, hai chính sách kia nói thẳng `UNAVAILABLE` thay vì bịa 0; producer dừng làm giá trị **quá hạn theo freshness** chứ không biến mất tức thì | Trọng tài output khi consumer nhận `UNAVAILABLE` (`T59-406`), HIL | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-020` | Signal nay **thực sự đi trong container**: trước bản vá `mkddc-st-package` không có đường nhận signal nên mọi khai báo đã validate vẫn không tới thiết bị; `stalePolicy` đóng thành enum ở **ba** lớp độc lập (Check Go, writer + loader C++, `StSignalBus::declare`) | Ký artifact (`T59-602`), nạp trên target (`T59-702`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.44 Cập nhật treatment source `T59-405` (Plan59 W4)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-008` | Intent Enable/Disable đi trọn store → API → IPC → Core → read-back; biên nhận idempotency, audit và bản ghi intent trong **cùng một transaction**; Enable/Disable là **hai action riêng** ở lớp biên nhận nên cùng idempotency key cho hai chiều không bị replay nhầm; replay **không** gửi lại lệnh xuống Core | Đối chiếu định kỳ intent ↔ trạng thái Core (`T59-501`), Test Result `VS-PROG-U07` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | RBAC khai báo theo route (`admin` cho mutation, `viewer` cho đọc); actor rỗng bị từ chối bằng `ErrInvalidRequest` chứ không rơi vào 503 "hãy thử lại"; payload thiếu `desiredEnabled` bị từ chối chứ **không** mặc định `false` — mặc định sẽ biến payload hỏng thành lệnh TẮT chương trình | FE cho đường Enable/Disable, usability người thật | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-005` | Trần **16 Enabled** ép ở **hai lớp**: application chặn trước khi ghi (intent bền vững, nên intent vượt trần sẽ sống lại mỗi lần khởi động và bị từ chối mãi mãi), Core ép lại ở `start()` nơi Program thực sự tác động lên đầu ra | Nghiệm thu target với 16 Program chạy thật (`T59-702`) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-007` | Ý định và trạng thái là **hai trường riêng**; Core từ chối → `FAULTED`, Core không liên lạc được → `UNKNOWN`, và **không** trường hợp nào xoá intent; Core nhận lệnh → ghi trạng thái **chuyển tiếp** `STARTING`/`STOPPING` chứ không ghi thẳng đích | Đường đọc trạng thái theo từng Program từ Core (`STATUS` chưa mang), HIL | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.45 Cập nhật treatment source `T59-406` (Plan59 W4)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-021` | Sổ candidate trả lời **ai đang giữ output nào**; bất biến một-output-một-owner ép **lại** ở runtime vì gói có thể tới từ bundle import chứ không chỉ từ Check; đăng ký chạy **trước** khi publish nên xung đột lộ ra trước khi ghi ra van | Nghiệm thu I/O vật lý (`T59-702`/`T59-704`), Test Result `VS-PROG-U09` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-002` | Rút candidate mang **lý do** (enum đóng ba giá trị) và **không xoá** bản ghi; trọng tài rơi đúng mức tiếp theo → default, có test đầu-cuối chạy Program thật rồi `stop()` và kiểm AO về `0.0`. **Cập nhật 2026-08-21 (`ADR-051`):** TTL hold-last = 60 s đồng hồ, không còn `0`/vô hạn | HIL và I/O vật lý (đo thời gian rút thật trên board) | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | Luật "không có đường Program→SHM/IOP/MCU trực tiếp" (kiến trúc §7) kiểm bằng **đọc chính mã nguồn** lớp process image, kèm phép kiểm ngược rằng đường hợp lệ thực sự có mặt — một test hành vi chỉ chứng minh đường hợp lệ chạy đúng, không chứng minh **không có** đường thứ hai | Kiểm cùng lớp cho các adapter I/O khác, target | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.46 Cập nhật treatment source `T59-407` (Plan59 W4)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-022` | **Lỗi thật đã sửa:** reset trên Program đang `STOPPED`/`FAULTED` chỉ sạch trong RAM còn file bền vững giữ giá trị cũ, nên khởi động lại là giá trị cũ quay về. Nay reset công bố ảnh đã reset **ngay tại boundary**, không phụ thuộc trạng thái chạy. Test chống hồi quy đã kiểm chứng bằng cách gỡ bản vá | Ma trận power-cut thật trên board (`T59-704`), Test Result `VS-PROG-029/030` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-009` | Namespace RETAIN theo instance (đường dẫn dẫn xuất từ `SHA-256(controller_identity ‖ instance_id)`): reset của một Program không chạm Program khác, và file hỏng của một Program chỉ làm **một** Program cold-init — Program còn lại warm-restart bình thường | Cold-init trên target sau đổi Revision (`T59-702`), `VS-PROG-029/030` | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.47 Cập nhật treatment source `T59-408` (Plan59 W4 — đóng Wave 8/8)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-021` | Trace giá trị lấy tại **ranh giới quét**, bounded 10.000 Ô / 10 phút, **0 cấp phát** trong vòng lấy mẫu; kho theo Ô nên ngân sách RAM tĩnh **cố định ~170 KB** không phụ thuộc số biến; số mẫu **rơi** được đếm thay vì giấu | Chạy 10 phút thật trên target (`T59-702`), Test Result `VS-PROG-U11` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | **Action ma = 0**: bảng handler IPC không còn `NOT_IMPLEMENTED` nào, khoá bằng hai phép kiểm độc lập (test Go đối chiếu hai chiều schema↔codec, và verifier đối chiếu schema↔enum C++↔nhánh dispatch↔codec Go). **Sửa kèm:** self-test của chính verifier bám vào `TRACE_START` nên thành no-op ngay khi nó được hiện thực — nay mutation tự tiêm action giả và tiêm cả nguồn Core đã bỏ nhánh | Đường đọc mẫu chuyển hẳn sang `TRACE_READ` (lane sản phẩm) | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.48 Ký TTL hold-last — `ADR-051` (đóng mục treo của `T59-406`)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-002` | TTL hold-last **60 s đồng hồ** (`ADR-051`), thay cho `0` = giữ vô hạn. TTL đo **tuổi của lệnh** nên phủ cả `ROLLED_BACK` và `RUNNING`-trong-Task-bị-disable — hai đường ngừng publish mà không bao giờ mang trạng thái `FAULTED`, tức là trước đó giữ lệnh cũ vĩnh viễn kể cả khi TTL đã có số. Mặc định `ScanDeps` là giá trị đã ký nên đường nối dây quên set field không âm thầm quay lại "giữ vô hạn" | Đo thời gian rút thật trên board (`T59-702`/`T59-704`); Safety review cho ma trận rơi-về theo từng loại tải | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-006` | Ràng buộc "TTL ≥ 2× chu kỳ Task chậm nhất" không nằm ở ghi chú mà ở `static_assert` đọc `allowedPeriodMs` của profile: profile mọc thêm lớp chu kỳ chậm hơn thì gãy build chứ không gãy ngoài hiện trường | Kiểm cùng lớp cho các hằng số an toàn khác đang chỉ sống trong tài liệu | `OPEN — PARTIAL SOURCE` |

Evidence host/local (`ctest` 1205/1205, có mutation check: gỡ nhánh tuổi-lệnh thì
test Task-bị-disable đỏ đúng chỗ). **22/22 risk giữ Open**, S×L và residual không
đổi — ký một con số không hạ residual khi chưa đo trên phần cứng thật.

### 5.48 Cập nhật treatment source `T59-501` (Plan59 W5 — mở Wave)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-022` | Barrier chu kỳ đầu và rollback nâng lên mức **GÓI**: một Program hỏng làm **cả gói** quay về, không còn "một nửa thành công"; rollback kiểm TRƯỚC áp SAU nên không kẹt giữa chừng; LKG thăng cấp **all-or-nothing** nên không tồn tại tập LKG ghép từ hai gói; restart ở cả bốn pha không để lại active một nửa | Mô phỏng mất điện thật giữa fsync và số đo phục hồi trên board (`T59-704`), Test Result `VS-PROG-029/030` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Ba hồi quy FE/E2E của W3 được phát hiện và sửa ngay khi cổng `e2e` chạy lần đầu: thanh tab Thiết kế **bấm không ăn**, tab `execution` **mất chỗ hiển thị**, E2E còn ghi IA cũ. Đây là bằng chứng cho chính luận điểm ma trận cổng: thứ không được cổng nào gọi thì không ai biết nó hỏng | E2E real-backend (`T59-505`), usability người thật | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.49 Bổ sung treatment source `T59-408` (nối đường đọc trace, phát hiện ở W5)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-021` | Đường đọc trace nối trọn: BE rút mẫu từ **ring của Core** qua `TRACE_READ` thay vì poll monitor. Trước bản vá, Core lấy mẫu tại ranh giới quét rồi ghi vào một ring **không ai đọc** — lý do tồn tại của `T59-408` không tới được người dùng. Không trộn hai nguồn trong một dãy; `valid=false` không vẽ thành 0; số mẫu rơi của Core hiện ra | Đo 10 phút thật trên target (`T59-702`), Test Result `VS-PROG-U11` | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.50 Cập nhật treatment source `T59-502` (Plan59 W5)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-012` | **Lỗi thật đã sửa:** `SIGNAL` không nằm trong whitelist kind của `revision_objects`, nên `SealRevision` từ chối MỌI Revision có Published Signal — toàn bộ lane signal (`T59-304` validate, `T59-404` bus) chưa từng chạm một Revision thật. Migration **v11** mở whitelist và khôi phục đúng hai trigger bất biến | Nghiệm thu signal đầu-cuối trên target (`T59-702`), Test Result `VS-PROG-U08` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | Impact/ack phủ **tám** nhóm: bốn nhóm Rev A cộng `publishedSignals`/`controlLibrary`/`programSet`/`enableIntent`. Đổi chính sách stale, đổi library, thêm/bớt Program, hay chạm Program **đang Enabled** nay đều phải được xác nhận; trước bản vá cả bốn đi qua Commission mà không hỏi gì | Usability người thật trên FE (`T59-503`), Test Result `VS-PROG-019` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Nhóm impact **vắng mặt** = `UNAVAILABLE`, không phải `NONE`: coi "không thấy" là "không có" đúng là cách để một tác động thật đi qua mà không ai xác nhận. Khoá ack là enum đóng một chỗ; kiểu TS sinh **từ enum contract** thay vì viết cứng | E2E real-backend (`T59-505`) | `OPEN — PARTIAL SOURCE` |

Evidence host/local; **22/22 risk giữ Open**, S×L và residual không đổi.

### 5.51 Cập nhật treatment source `T59-503` (Plan59 W5 — sáu workspace/lifecycle)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-007` | Sáu workspace dùng chung read-model ở `ProgrammingLayout`; `ProgrammingContextBar` tách bốn sự thật Draft, Active Revision, desired intent và runtime read-back, tuyệt đối không suy `desiredEnabled=true` thành `RUNNING`. PGM-05 dựng lifecycle từ trạng thái Check/operation authoritative, giữ riêng `UNKNOWN_RECONCILING` và không xem timeout là success | Test Result `VS-PROG-U07/U10`, target read-back và review độc lập; E2E real-backend HOST/LOCAL đã PASS | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-008` | Khi URL đã có `projectId`, API Project chưa trả hoặc lỗi không làm layout fallback sang Project đầu tiên; intent query giữ đúng định danh route. Test race đổi Project khóa việc rò intent/state của Project cũ | Ma trận concurrency/reload thật (`T59-505/603`) và Test Result `VS-PROG-024/U10` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-016` | Desktop/mobile đều có đúng sáu route canonical; workspace phụ thuộc Project bị vô hiệu khi thiếu Project thay vì dựng deep-link giả. PGM-05 hiển thị impact/read-back ở chế độ chỉ đọc, nhóm `UNAVAILABLE` vẫn chặn Commission; lifecycle và trạng thái permission/offline/unknown có nhãn chữ + `aria-live`/`aria-current` | Usability người thật và accessibility reviewer trên desktop/mobile; fault E2E thật `VS-PROG-011/019/031/U10` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | Route canonical nằm trong một map; redirect cũ giữ query/hash định vị diagnostic; link lỗi Check về đúng `/programs`. Test route/nav/context khóa IA để copy cũ hoặc route cũ không âm thầm quay lại | Browser/Network current-pass và Test Result `VS-PROG-019/U10` | `OPEN — PARTIAL SOURCE` |

Evidence hiện là source/component/browser HOST/LOCAL: FE **124 file / 1161
test**, E2E mock **61/61**, Chrome desktop/mobile sạch. **22/22 risk giữ Open**,
S×L và residual không đổi; chưa claim usability, CI, target/HIL hay Test Result.

### 5.52 Cập nhật treatment source `T59-504` (Plan59 W5 — Monitor Point + Signal)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-010` | Watch phủ đúng ba category `LOCAL/VP/MB_RTU`, tách output candidate (`programValue`) khỏi `actualValue`, source/priority/quality/freshness. `valid=false`, BAD/OFFLINE/UNAVAILABLE và mismatch không vẽ thành `0`; số 0 chỉ giữ khi payload thật sự valid. Published Signal dùng snapshot/API riêng, không trộn với bảng Point | Positive binding trên target, producer clock/freshness fault, AO/DO read-back và Test Result `VS-PROG-017/018/U06` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-017` | Core `STATUS` minor 3 công bố Published Signal snapshot typed lấy từ bus committed; BE join theo Active Revision và phân biệt MATCHED/MISMATCH/CORE_ONLY/REVISION_ONLY; FE fail-closed khi producer offline hoặc snapshot mismatch | Opcode signal trong thân Program; TSan/soak 24 giờ trên target và Test Result `VS-PROG-U06` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-021` | Bảng Monitor hiện candidate, actual, owner/source và priority thành các cột riêng; trace đọc ring Core qua `TRACE_READ`, công bố `droppedSamples` và không trộn mẫu polling vào cùng dãy | Trace 10 phút + candidate withdrawal với I/O vật lý trên target; `VS-PROG-U09/U11` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-014` | State loading/permission/offline/error/no-active/empty được phân loại bằng status/transport thay vì parse chuỗi lỗi. Viewer được xem monitor nhưng không thể chọn biến hay khởi tạo trace | Contract/browser current-pass, fault matrix và reviewer độc lập | `OPEN — PARTIAL SOURCE` |

Evidence hiện là source/unit/component HOST/LOCAL: CTest Release/Debug
**1211/1211**, Go và FE gate thành phần sạch. Simulator cố ý không có I/O vật lý,
nên Monitor Point unavailable phải hiện fail-closed chứ không được dựng dữ liệu.
**22/22 risk giữ Open**, S×L và residual không đổi.

### 5.53 Cập nhật treatment source `T59-505` (Plan59 W5 — lane real-backend HOST/LOCAL)

| Risk | Control đã có trong source lane | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-007` | Spec đi Project→Draft→Seal→Check→Commission→Enable→Runtime→Disable→Revision mới→Restore qua HTTP/operation read-back thật; compiler/packager và Programming IPC production được gọi, không có optimistic Active | Target read-back, fault injection và Test Result `VS-PROG-U07/U08/U10`; HOST/LOCAL 1/1 đã PASS | `OPEN — SOURCE HOST PASS` |
| `RSK-PROG-008` | Lane dùng ETag mới qua chuỗi mutation, idempotency/correlation riêng cho từng request và kiểm actual Active Revision sau operation; Control Library, Signal và Binding cùng đi qua một Revision thật. ST+ khóa PATCH đúng năm field Draft v2 strict và GET Project read-back, không còn gửi metadata Program ngoài contract | Retry/concurrency/worker-restart matrix (`T59-603/604`) và reviewer độc lập | `OPEN — SOURCE HOST PASS` |
| `RSK-PROG-012` | Backend chạy JWT/authz thật với admin; mutation không bypass handler/service. CI có guard tĩnh làm đỏ nếu spec đưa `page`/`context`/`browserContext.route*`/HAR/WebSocket mock vào lane | Role matrix viewer/operator/admin, revocation/re-auth/CSRF/TLS và Test Result `VS-PROG-022/U10` | `OPEN — SOURCE HOST PASS` |
| `RSK-PROG-022` | `mkddc-programming-core-sim` tái dùng scheduler/coordinator/cutover/process-image/IPC production để buộc Commission và Restore đi qua barrier/read-back thay vì stub HTTP. Stack tạo DB/staging/state tạm và dọn sau suite | Power-cut/fsync/journal/RETAIN/LKG trên board thật (`T59-704/705`) và Test Result `VS-PROG-U08` | `OPEN — SOURCE HOST PASS` |
| `RSK-PROG-013` | Tên job, script, config và spec đều ghi rõ **HOST/LOCAL**; simulator không có physical I/O nên Monitor Point `UNAVAILABLE` là kết quả fail-closed dự kiến. Bằng chứng này chặn việc biến PASS simulator thành claim HIL bằng văn xuôi | Board/BSP/instrument/physical I/O evidence `VS-PROG-014/030/U09`; release authority ký | `OPEN — NO TARGET EVIDENCE` |
| `RSK-PROG-014` | Lane real-backend có cấu hình Playwright riêng, bị loại khỏi suite mock mặc định và có component `e2e-real`; workflow khai báo job riêng để failure boundary không bị che bởi mock. Guard phủ cả ba receiver route và C++ gate dùng `cmake --fresh` | **Kết quả chạy CI của commit cuối** và Test Result review; sự tồn tại của YAML/job chưa phải CI PASS | `OPEN — SOURCE HOST PASS` |

Ranh giới bắt buộc: lane HOST/LOCAL **1/1 PASS**, `requestfailed=0`; chỉ ngoại lệ
HTTP `503`/Console resource error đã khai là Monitor Point do simulator cố ý
không giả process-I/O. Kết quả này không nâng GitHub CI, target, HIL, physical
I/O, Test Result hoặc `RELEASE_READY`. **22/22 risk giữ Open**.

### 5.54 Cập nhật treatment source `T59-506` (Plan59 W5 — ST/FBD editor)

| Risk | Control đã có trên nhánh `feat/t59-201-control-library-domain` | Phần còn thiếu để hoàn tất treatment | Trạng thái |
|---|---|---|---|
| `RSK-PROG-014` | ST editor dùng history duy nhất cho gõ, format và command; giữ tối đa 50 snapshot, undo/redo phục hồi cả source lẫn selection/cursor, edit mới cắt nhánh redo. Test bắt buộc đủ 20 edit hai chiều nên undo không còn phụ thuộc textarea native hoặc mutation path riêng lẻ | Conflict/reload real-backend và Test Result `VS-PROG-U10`; save/Console/Network HOST đã PASS | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-010` | Runtime overlay chỉ nối monitor khi `activeRevisionId` khớp; mismatch/loading/error/no-active đều unavailable và không giữ mẫu cũ. Zero thật giữ nguyên khi valid; invalid/null/BAD/OFFLINE/UNKNOWN không thành 0; STALE được giữ last-known nhưng luôn kèm quality/freshness | Binding/producer fault trên target và Test Result `VS-PROG-017/018/U06` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-019` | FBD chỉ lấy interface POU typed từ Draft v2, giữ thứ tự pin và lọc type ngoài profile; interface thiếu/mâu thuẫn làm palette rỗng/cảnh báo thay vì đoán pin. POU đang mở bị lọc để không tạo direct recursion từ palette | Compiler/runtime round-trip POU, one-over/fuzz và Test Result `VS-PROG-U01/U02/U04` | `OPEN — PARTIAL SOURCE` |
| `RSK-PROG-016` | Palette/Inspector có nhãn nguồn POU và lỗi interface; Insert/Arrow/Enter/Delete/Ctrl+Z hỗ trợ bàn phím, nhưng shortcut trong ô nhập giữ hành vi native để không xóa graph ngoài ý muốn | Browser/a11y/usability người thật desktop/mobile và reviewer độc lập | `OPEN — PARTIAL SOURCE` |

Evidence hiện là source/component/browser HOST/LOCAL: FE **1161 test**, E2E mock
**61/61**, real-backend **1/1** và Chrome desktop/mobile sạch. **22/22 risk giữ
Open**, S×L và residual không đổi; chưa claim target/HIL, Test Result hay release.

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
| 4.19 | 2026-08-21 | Ghi `T59-506` và chốt evidence HOST/LOCAL của W5: ST history 50 snapshot/20 undo-redo + cursor, runtime overlay không biến invalid thành 0, FBD lấy POU interface typed; ST+ gửi đúng payload Draft v2 strict; FE 1161 test, E2E mock 61/61, real-backend 1/1 và Chrome desktop/mobile sạch. Giữ 22/22 Open; chưa có GitHub CI/Test Result/target/HIL |
| 4.18 | 2026-08-21 | Ghi `T59-505`: lane Project→Restore dùng backend/compiler/Core simulator thật, cấu hình tách khỏi mock và CI job có guard cấm `page.route`. Giữ 22/22 Open; lane đang được gate, không claim CI PASS và không đổi HOST thành target/HIL/physical I/O/release |
| 4.17 | 2026-08-21 | Ghi `T59-504`: Monitor LOCAL/VP/MB_RTU tách candidate/actual/source/priority, Published Signal snapshot riêng và trace công bố mẫu rơi; mọi invalid/mismatch/unavailable fail-closed. Giữ 22/22 Open vì binding/soak/I/O vật lý/Test Result chưa có |
| 4.16 | 2026-08-21 | Ghi `T59-503`: sáu workspace desktop/mobile, Project race guard, context tách Draft/Active/intent/runtime và PGM-05 lifecycle authoritative. Giữ 22/22 Open vì real-backend current-pass/usability/Test Result/target chưa có |
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
| 2.6 | 2026-08-20 | Ghi `T59-007` (Plan59 W0) cho treatment partial RSK-015: ma trận cổng theo Wave thành contract có schema/self-test, và runner không thể báo PASS cho cổng cần CI/board/instrument. Giữ 16/16 Open, 11 Critical và mọi residual. |
| 2.7 | 2026-08-20 | Ghi `T59-101` (Plan59 W1) cho treatment partial RSK-006: parser nhận ba loại POU với AST chung và ép quy tắc kind/chữ ký bằng mã riêng. Giữ 16/16 Open, 11 Critical và mọi residual vì lowering, runtime và target chưa có. |
| 2.8 | 2026-08-20 | Ghi `T59-102` (Plan59 W1) cho treatment partial RSK-006/014: call graph xác định, guard DAG chặn đệ quy trực tiếp/gián tiếp, và ba mã riêng cho ba cách sửa khác nhau. Giữ 16/16 Open, 11 Critical và mọi residual vì lowering/Check production/target chưa có. |
| 2.9 | 2026-08-20 | Ghi `T59-103` (Plan59 W1) cho treatment partial RSK-006/014: purity FUNCTION ép ở registry nên producer không qua parser cũng bị chặn, và mã lỗi phân biệt theo cách sửa. Giữ 16/16 Open, 11 Critical và mọi residual vì lowering FBD, instance state và target chưa có. |
| 3.0 | 2026-08-20 | Ghi `T59-104` (Plan59 W1) cho treatment partial RSK-006/009: layout instance FB bất biến khi sắp xếp lại nguồn, identity theo đường dẫn canonical, vòng chứa và trần package bị chặn. Giữ 16/16 Open, 11 Critical và mọi residual vì runtime cấp phát, power-cut và Test Result chưa có. |
| 3.1 | 2026-08-20 | Ghi `T59-105` (Plan59 W1) cho treatment partial RSK-006/016: ST và FBD dùng chung một nút AST cho lời gọi POU (có test so trực tiếp), thứ tự đối số bám cổng, FE sinh pin từ interface và từ chối interface mâu thuẫn. Giữ 16/16 Open, 11 Critical và mọi residual vì codegen liên kết, UI cây POU và target chưa có. |
| 3.2 | 2026-08-20 | Ghi `T59-106` (Plan59 W1, đóng Wave) cho treatment partial RSK-003/004/006: container package v2 với loader fail-closed trên mọi trường do bên ngoài kiểm soát, fuzz lật từng byte 0 false-accept, hai bất biến an toàn kiểm ở loader, và dual-reader giữ LKG v1 còn hiệu lực. Giữ 16/16 Open, 11 Critical và mọi residual vì lắp nội dung package, nạp prepared image và target chưa có. |
| 4.15 | 2026-08-21 | Ghi `T59-502` (Plan59 W5) cho treatment partial RSK-008/012/014: impact/ack phủ tám nhóm cho mô hình đa Program; sửa lỗi `SIGNAL` chưa từng seal được vào Revision (migration v11); nhóm vắng mặt fail-closed. Giữ 22/22 Open vì nghiệm thu signal trên target và usability chưa có. |
| 4.14 | 2026-08-21 | Bổ sung `T59-408` sau khi cổng W5 lộ ra đường đọc trace chưa nối: BE nay rút mẫu từ ring của Core qua `TRACE_READ`, không trộn nguồn, không vẽ ô không đo được thành 0, số mẫu rơi hiện ra. Giữ 22/22 Open. |
| 4.13 | 2026-08-21 | Ghi `T59-501` (Plan59 W5, **mở Wave**) cho treatment partial RSK-014/022: barrier chu kỳ đầu và rollback lên mức gói, LKG all-or-nothing, restart bốn pha không để lại active một nửa; ba hồi quy FE/E2E của W3 lộ ra ở lần đầu chạy cổng `e2e` và đã sửa. Giữ 22/22 Open vì mô phỏng mất điện thật trên board chưa có. |
| 4.12 | 2026-08-21 | Ghi `ADR-051` (ký TTL hold-last 60 s) cho treatment partial RSK-002/006: đóng mục treo cuối của `T59-406`. TTL đo bằng đồng hồ chứ không đếm base step, đo tuổi của LỆNH nên phủ cả `ROLLED_BACK`/Task-bị-disable, mặc định `ScanDeps` là giá trị đã ký thay vì `0`. Giữ 22/22 Open: ký số không hạ residual khi chưa đo trên phần cứng thật. |
| 4.11 | 2026-08-21 | Ghi `T59-408` (Plan59 W4, **đóng Wave 8/8**) cho treatment partial RSK-014/021: trace giá trị bounded lấy tại ranh giới quét với 0 cấp phát, ba action IPC thật, action ma = 0 khoá bằng hai phép kiểm độc lập; sửa self-test verifier vốn đã mục ruỗng vì bám vào một action cụ thể. Giữ 22/22 Open vì đo 10 phút thật trên target chưa có. |
| 4.10 | 2026-08-21 | Ghi `T59-407` (Plan59 W4) cho treatment partial RSK-009/022: bịt lỗ reset nửa vời (reset trên Program đang dừng nay bền vững qua khởi động lại), cô lập RETAIN giữa Program cho cả đường reset lẫn đường file hỏng. Giữ 22/22 Open vì power-cut thật trên board chưa có. |
| 4.9 | 2026-08-21 | Ghi `T59-406` (Plan59 W4) cho treatment partial RSK-002/006/021: sổ candidate trả lời quyền sở hữu output và lý do rút, bất biến một-output-một-owner ép lại ở runtime, đường rơi về mức tiếp theo/default có test đầu-cuối, luật không-đường-tắt kiểm bằng đọc mã nguồn. Giữ 22/22 Open; **TTL hold-last vẫn 0** vì con số chưa được Product+Controls ký. |
| 4.8 | 2026-08-21 | Ghi `T59-405` (Plan59 W4) cho treatment partial RSK-005/007/008/014: intent Enable/Disable đi trọn store→API→IPC→Core→read-back/audit trong một transaction, ý định và trạng thái là hai trường riêng, trần 16 ép ở hai lớp, IPC thêm action mới với `protocolMinor` 0→1 tương thích ngược. Giữ 22/22 Open vì đối chiếu định kỳ, đọc trạng thái theo Program từ Core và FE chưa có. |
| 4.7 | 2026-08-21 | Ghi `T59-404` (Plan59 W4) cho treatment partial RSK-012/017/020: bus Published Signal double-buffer commit ở boundary với 0 đọc rách qua 20.000 vòng, ba chính sách stale phân biệt "chưa publish" với "quá hạn", signal lần đầu thực sự đi vào container, `stalePolicy` đóng ở ba lớp. Giữ 22/22 Open vì opcode signal trong thân chương trình, trọng tài output và target chưa có. |
| 4.6 | 2026-08-21 | Ghi `T59-403` (Plan59 W4) cho treatment partial RSK-006/018/021: lane là đơn vị song song với hai chế độ cho cùng kết quả, đảo chiều chính sách fault sang cô lập theo kiến trúc §8, đường quét 0 cấp phát, TSan 54 test 0 cảnh báo tái lập bằng script. Giữ 22/22 Open vì đo trên target và rút candidate chưa có. |
| 4.5 | 2026-08-21 | Ghi `T59-402` (Plan59 W4) cho treatment partial RSK-001/005/018/022: chu kỳ release theo từng Program với bù trôi theo mốc lý thuyết, lỡ chu kỳ đếm-và-bỏ, chu kỳ đi trong package và bị chặn ở cả writer lẫn loader, trần 16 chạy đồng thời ép ở `start()`, đường khôi phục package v2 sau reboot được bịt. Giữ 22/22 Open vì worker lane/đo tải target/intent Enable chưa có. |
| 4.4 | 2026-08-21 | Ghi `T59-401` (Plan59 W4, **mở Wave**) cho treatment partial RSK-001/003/006: coordinator nạp package v2 bằng parser dùng chung, dựng topology theo chính package, bỏ hardcode `program-main`, gói hỏng 0 mutation, dual-reader v1 còn sống. Giữ 22/22 Open vì scheduler/fault-isolation/target chưa có. |
| 4.3 | 2026-08-21 | Ghi `T59-306` (Plan59 W3, **đóng Wave 6/6**) cho treatment partial RSK-014/016: IA sáu trang đảo chiều đúng DDD §8, cây POU kind-aware và inspector ẩn trường không có nghĩa. Giữ 22/22 Open vì E2E real-backend và usability chưa có. |
| 4.2 | 2026-08-21 | Ghi `T59-305` (Plan59 W3) cho treatment partial RSK-001/003/007: manifest package mang topology/budget theo profile, không bám thứ tự tạo, Program mới luôn Disabled, trần 32 ép lại ở Check. Giữ 22/22 Open vì thi hành trần 16 Enabled, ngân sách RT và target chưa có. |
| 4.1 | 2026-08-21 | Ghi `T59-304` (Plan59 W3) cho treatment partial RSK-002/012/014: output owner nhận diện theo điểm vật lý và Published Signal đủ bốn luật, kiểm ở Check trước khi biên dịch và gộp mọi vi phạm. Giữ 22/22 Open vì runtime signal/output arbitration và HIL chưa có. |
| 4.0 | 2026-08-21 | Ghi `T59-303` (Plan59 W3) cho treatment partial RSK-011/014: binding MB_RTU qua Point contract canonical với `extIndex` do Point Catalog phân giải; compiler không tự suy slot nên không tái định nghĩa giao thức. Giữ 22/22 Open vì Point Catalog/UI và nghiệm thu I/O thật chưa có. |
| 3.9 | 2026-08-21 | Ghi `T59-302` (Plan59 W3) cho treatment partial RSK-001/003/008/014: Check biên dịch mọi Program và gộp diagnostic, container v2 do chính writer production ghi và được loader đọc lại trước khi lưu, Check không đụng Draft/Active. Giữ 22/22 Open vì topology/budget, ký artifact và target chưa có. |
| 3.8 | 2026-08-21 | Ghi `T59-301` (Plan59 W3, **mở Wave**) cho treatment partial RSK-001/006/012: document v2 tách POU khỏi cấu hình Program, trần 32 là trần cứng ở Draft, migration v1→v2 tất định giữ identity, signal hạng nhất với fallback ghép cứng vào policy. Giữ 22/22 Open vì Check/runtime/target chưa có. |
| 3.7 | 2026-08-20 | Ghi `T59-203` (Plan59 W2, **đóng Wave 5/5**) cho treatment partial RSK-005/008/014: PGM-04 chỉ hiển thị review-gate mà không có ô tick duyệt, phân biệt state chưa biết với 0, và dùng lại ETag mới. Giữ 22/22 Open vì E2E real-backend và evidence Controls/Safety chưa có. |
| 3.6 | 2026-08-20 | Ghi `T59-204` (Plan59 W2) cho treatment partial RSK-017/020: Control Library đi trong bundle nguồn có sẵn, export tất định không mang artifact, corpus thù địch 10 biến thể 0 mutation, lệch version registry SYSTEM có mã riêng, Seal publish+pin library cùng transaction. Giữ 22/22 Open vì bundle chưa ký (`T59-602`) và chưa có Test Result. |
| 3.5 | 2026-08-20 | Ghi `T59-205` (Plan59 W2) cho treatment partial RSK-005/020: review gate PID ép ở ba đường Check và độc lập producer; token phê duyệt suy ra từ contract profile, generator từ chối token bịa, G1 ghim riêng danh sách đã duyệt. Giữ 22/22 Open và mọi residual vì evidence Controls/Safety thật (`VS-PROG-U12`/`T59-706`) chưa có. |
| 3.4 | 2026-08-20 | Ghi `T59-202` (Plan59 W2) cho treatment partial RSK-008/014/020: ba route Control Library admin-only theo DDD §5.1, `If-Match`+idempotency+audit cùng transaction, cursor ký HMAC ràng buộc filter, ba mã lỗi phân giải giữ riêng. Hai finding thật (handler nuốt route Project, actor rỗng cho 503 retryable) đã sửa. Giữ 22/22 Open và mọi residual vì FE/import/signature/target/Test Result còn thiếu. |
| 3.3 | 2026-08-20 | Ghi `T59-201` (Plan59 W2) cho treatment partial RSK-009/014/020: SYSTEM registry virtual/content-addressed có lịch sử version→hash; PROJECT Library versioned, Published bất biến, canonical source/interface/dependency hash, DAG/reference/layout guard và migration/restart fail-closed. Giữ 22/22 Open và mọi residual vì REST/import/signature/compiler/runtime/target/Test Result còn thiếu. |
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
