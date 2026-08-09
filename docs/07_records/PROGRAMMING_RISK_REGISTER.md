# Sổ đăng ký rủi ro Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `RSK-PROG-001` |
| Phiên bản | 0.5 |
| Trạng thái | **M3 — Review Ready** — treatment/evidence/acceptance đủ; 16/16 Open |
| Ngày | 2026-08-09 |
| Chủ quản | Product + Architecture + QA |
| Người review | Risk owners, Safety, Security, Operations Leads |
| Người phê duyệt | Product Owner + System Architect + Verification Lead |
| Review kế tiếp | Khi R2/R3 được phê duyệt hoặc có Test Result/incident/change mới |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Ghi **16 rủi ro có thể gây hỏng thiết bị, mất điều khiển hoặc sai cam kết**, kèm biện pháp kiểm soát, chủ sở hữu và bằng chứng cần có để hạ mức. Đây là căn cứ để nói “chưa được phép cutover”. |
| 2. Ai phải đọc file này? | Product, Architect và QA (chủ quản chung); từng risk owner đọc phần của mình; Safety và Security đọc trước khi ký. |
| 3. Hệ thống hiện tại đang có gì? | 16/16 rủi ro `Open`; 11/16 ở mức `Critical` (điểm ≥15). Đã có thiết kế biện pháp cho cả 16, nhưng **0/16 đã triển khai** end-to-end và **0/16 có bằng chứng được chấp nhận**. |
| 4. Thiết kế mới thay đổi điều gì? | Không giảm rủi ro nào. Nó gắn từng rủi ro với biện pháp cụ thể, kịch bản kiểm chứng và mức tồn dư **mục tiêu** — mục tiêu, chưa phải kết quả. |
| 5. Team phải sửa module/contract nào? | Cột “Kiểm soát thiết kế” trỏ tới hồ sơ chủ quản; việc code nằm ở Plan 53. Bốn rủi ro nặng nhất (20 điểm): `RSK-PROG-002` watchdog restart, `RSK-PROG-003` IOP gap, `RSK-PROG-005` compiler tranh CPU, `RSK-PROG-013` nhầm skeleton là HIL-ready. |
| 6. Điều gì còn bị chặn? | Mọi rủi ro ≥15 **chặn cutover production** cho tới khi biện pháp có bằng chứng PASS và mức tồn dư được owner cùng QA chấp nhận bằng văn bản. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Cột “Scenario/evidence authority” ở §3 gắn từng rủi ro với `VS-PROG-*`. Hiện 0/32 kịch bản có Test Result, nên **không rủi ro nào được hạ mức**. |

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

| Chỉ số | Giá trị 2026-08-09 |
|---|---:|
| Risk Open | 16/16 |
| Critical ≥15 | 11/16 |
| Treatment có thiết kế ở mức M3 | 16/16 |
| Treatment implemented | 0/16 cho feature end-to-end Target |
| Evidence accepted | 0/16 |
| Residual accepted | 0/16 |

Vòng nội dung chi tiết làm rõ control nhưng không giảm risk. Production gate vẫn RED.

## 6. Treatment/acceptance record bắt buộc

Mỗi risk chuyển trạng thái phải có record với: risk ID/version; cause/event/
impact; control ID và commit/package; Test Result current; actual S/L và rationale;
residual S×L; limitation/compensating control; owner; accepter đúng authority;
expiry/review trigger; change/incident links. Thiếu một field thì giữ `OPEN`.

| Trigger | Hành động bắt buộc |
|---|---|
| Requirement/design/contract đổi | impact 16 risk; reopen risk liên quan; invalidate evidence |
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

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Risk owners + Safety/Security/Ops | Chờ review | — |
| Product + Architect + Verification | **BLOCKED — chưa phê duyệt** | 0/15 evidence/residual accepted |

## 8. Phụ lục — Tự kiểm cổng M3 (loại: Risk)

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Cause → event → impact | PASS | §3 cột đầu tách đủ ba khâu cho cả 16 rủi ro |
| Severity và Likelihood | PASS | Bảng chính có `S×L`; §2 định nghĩa thang 1..5 cho từng trục |
| Biện pháp kiểm soát | PASS | §3 cột “Control cần implement/verify” và “Requirement / thiết kế kiểm soát” |
| Owner | PASS | §3 cột cuối, kèm điều kiện kích hoạt review lại |
| Verification và evidence | PASS | §3 cột “Scenario / evidence authority” gắn `VS-PROG-*` và loại bằng chứng cần thiết |
| Residual | PASS | Bảng chính giữ nguyên `S×L` gốc; §2 nêu rõ residual **chỉ giảm sau khi có bằng chứng** |
| Thẩm quyền chấp nhận | PASS | §6 schema bản ghi treatment/acceptance đủ trường; thiếu một trường thì giữ `OPEN` |
| Ngày review lại | PASS | Metadata đầu file và §6 bảng trigger |
| `BLOCKED` có owner/gate | **BLOCKED** | 0/16 evidence và 0/16 residual được chấp nhận. Owner: Product Owner + System Architect + Verification Lead, cùng từng risk owner. Ảnh hưởng: 11 rủi ro `Critical` chặn cutover production. Gate: `G5`/`G6`. Điều kiện mở: chạy các `VS-PROG-*` tương ứng, risk owner đề xuất residual, reviewer độc lập xác nhận, rồi ba vai trò trên ký |

Vòng chi tiết này làm rõ biện pháp kiểm soát nhưng **không giảm rủi ro nào**.
Gate production vẫn `RED`.
