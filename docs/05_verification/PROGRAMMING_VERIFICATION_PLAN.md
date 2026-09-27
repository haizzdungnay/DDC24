# Kế hoạch Verification & Validation Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `VVP-PROG-001` |
| Phiên bản | 2.3 |
| Trạng thái | **Kế hoạch Active: 32 legacy + 12 unified + 3 PGM-02; 47 total, U13–U15 `NOT_RUN`, 0/47 PASS** |
| Ngày | 2026-08-24 |
| Chủ quản | Verification Lead |
| Người review | Product, System Architect, FE/BE/Core/FW/HW/Ops Leads |
| Người phê duyệt | Verification Lead + Product Owner |
| Nguồn | Product v3.2; `SRS-PROG-001` v1.2; ADR-050/053; `AUTH-PROG-2026-08-24-05`; exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`; Unified/PGM-02 DDD; Risk/Traceability |
| Requirement | `SRS-PROG-001` |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Giữ 32 scenario legacy + 12 unified baseline và kích hoạt kế hoạch ba scenario PGM-02 `VS-PROG-U13..U15` cho R1 EDIT, R2 LIVE, R3 SIMULATE. |
| 2. Ai phải đọc file này? | Verification Lead (chủ quản) và mọi discipline lead — vì mỗi người sở hữu một phần trong cột “execute/review”. Release authority đọc §5 để biết gate nào đang mở. |
| 3. Hệ thống hiện tại đang có gì? | Catalog legacy có 2 record `BLOCKED`, 30 `NOT_RUN`, 0/32 PASS; 12 unified và 3 PGM-02 Candidate đều `NOT_RUN`. Supporting host/target evidence cũ không tự kế thừa. |
| 4. Thiết kế mới thay đổi điều gì? | Target đã pin bổ sung acceptance typed EDIT/Quick Library, coherent LIVE và isolated Simulation admin-only/zero-output theo ba increment độc lập. |
| 5. Team phải sửa module/contract nào? | Không sửa code. Cần dựng thư mục bằng chứng `docs/07_records/test-results/programming/<TR-ID>/` gồm `result.md`, tệp thô và `SHA256SUMS`, cùng các đồ gá `H/B/T/L` ở §9. |
| 6. Điều gì còn bị chặn? | Không còn blocker authority để viết code; `T59-802=READY`, task sau `ORDERED` theo dependency. U13 cần R1 source/browser evidence, U14 cần producer-chain/target fault, U15 cần target/HIL/physical-output evidence. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | File định nghĩa 47/47 scenario. Hiện **2/47 record, 0/47 PASS**; 45 scenario `NOT_RUN` hoặc chưa có record PASS. Không cộng supporting evidence thành verdict. |

Ba loại bằng chứng **không** đủ để đóng một requirement: file tài liệu tồn tại;
unit test trên máy host thay cho đo trên target/HIL; và ảnh chụp màn hình mock
không có backend thật đứng sau.

## 1. Nguyên tắc bằng chứng

Tài liệu/test plan không phải kết quả. Mỗi test result phải ghi commit, artifact
hash, toolchain, môi trường/target/board revision, fixture/config, lệnh/procedure,
expected/actual, log/raw artifact, người chạy/review và PASS/FAIL/BLOCKED.

Host test không thay HIL, browser mock không thay FE–BE–Core E2E, simulator không
thay ADC/DAC/relay/UART/RS485 thật. Không dùng từ `PASS` cho check chưa chạy.

## 2. Cấp kiểm chứng

| Cấp | Mục tiêu | Owner |
|---|---|---|
| L0 Inspection/analysis | requirement/design/contract/static allocation | Architect/QA |
| L1 Unit/property/fuzz | parser/FBD/IR/loader/model/store/reducer/MCU protocol | từng team |
| L2 Component | compiler worker, Core runtime, BE store/API, FE component | từng team |
| L3 Contract/integration | OpenAPI Go↔TS, BE↔Core IPC, Point/IOP/SHM | BE/Core/QA |
| L4 Host E2E/simulator | ST/FBD→Check→Commission flow không phần cứng | QA |
| L5 Browser E2E | sáu workspace và tám journey, RBAC, errors, a11y, responsive | FE/QA |
| L6 Target/HIL | timing, output, watchdog, power/restart, MCU/IOP | Core/FW/HW/QA |
| L7 Release/operations | install/upgrade/backup/restore/rollback/provenance | Ops/QA |

## 3. Catalog scenario

### 3.0 Regression migration v1

`VS-PROG-001..032` giữ acceptance của baseline cũ để kiểm dual-reader/redirect/
rollback. Chúng không giới hạn Product Target. Khi câu “một Task/bốn workspace”
xuất hiện, expected chỉ áp dụng cho compatibility fixture v1; fixture v2 phải
theo `VS-PROG-U01..U15`.

| ID | Scenario/acceptance chính | Cấp | Requirement chính | Evidence bắt buộc |
|---|---|---|---|---|
| `VS-PROG-001` | Tạo Project/Draft/functional tag, restart BE và round-trip không đổi identity | L2/L3 | SYS-101; BE-101 | DB dump sanitized + integration log |
| `VS-PROG-002` | Bốn workspace, tám journey và workflow Check→Commission→Run, Draft/Active tách | L5 | FE-101/102 | Playwright + screenshot |
| `VS-PROG-003` | Core Library profile/User FB chỉ cục bộ; global/native/BACS advanced bị từ chối | L1/L3 | SYS-101 | validator negative |
| `VS-PROG-004` | Runtime read-back active revision/actor/time/target/safe-state | L3/L6 | SYS-103 | Core/BE correlated log |
| `VS-PROG-005` | ST và FBD cùng typed semantics/IR, valid equivalence | L1/L4 | CORE-101; FE-103/104 | artifact/IR compare |
| `VS-PROG-006` | Parser/FBD limits, invalid topology/type/source location, no crash/OOM | L1 fuzz | CORE-101 | fuzz corpus/result |
| `VS-PROG-007` | PROGRAM/FUNCTION/User FB lifecycle/state độc lập, no recursion/native | L1/L4 | SYS-101 | unit/integration |
| `VS-PROG-008` | Functional tag/view chỉ metadata, không tạo lifecycle/authority mới | L2/L5 | FE-102 | API/UI inspection |
| `VS-PROG-009` | Một Task base step 10 ms; chu kỳ Program thuộc {10, 50, 100, 500, 1000, 5000, 10000, 50000} ms (ADR-061), deterministic order; ngoài tập reject (`ST-SCHED-001`) | L1/L6 | CORE-102; FE-106 | Chu kỳ ≤ 5 000 ms: 10 000 chu kỳ mỗi chu kỳ; 10 000 và 50 000 ms: chạy trọn soak 24 h (8 640 và 1 728 chu kỳ); missed release = 0 (chủ sở hữu chốt 2026-09-27, ADR-061 X20) + UI test |
| `VS-PROG-010` | Priority mức 5, program/actual/winner, PID saturation và override/release | L1/L6 HIL | CORE-104/105 | waveform + runtime snapshot |
| `VS-PROG-011` | Atomic Commission/Restore; invalid/corrupt/crash giữ LKG; hợp đồng acknowledgement theo `status` impact | L3/L6 | SYS-103; BE-106; FE-113 | fault at each step + contract negative |
| `VS-PROG-012` | RT path no allocation/filesystem/DB/HTTP/DNS/blocking/dynamic load | L0/L2/L6 | CORE-103 | symbol/static + instrumentation |
| `VS-PROG-013` | Overrun warning→Task fault; concurrent Check không nuisance safe-state | L2/L6 | CORE-107; NFR-103 | load profile + metrics |
| `VS-PROG-014` | Hold-last mức 5, output under override, `max_iop_poll_gap<200 ms` | L6 HIL | CORE-106; NFR-108 | logic analyzer + AO/DO waveform |
| `VS-PROG-015` | Graph/Program cutover 3 state, Task 30 s không kéo step/watchdog restart | L3/L6 | SYS-105; CORE-108 | boot/config/fault logs |
| `VS-PROG-016` | TIME/timer monotonic qua RTC/NTP/DST jump | L1/L6 | CORE-102 | controlled clocks |
| `VS-PROG-017` | Mapping identity/type/direction/writable/unit và đúng 3 category | L1/L3/L5 | FE-105 | catalog contract + UI |
| `VS-PROG-018` | GOOD/UNCERTAIN/BAD/STALE/OFFLINE/UNKNOWN không thành zero | L2/L5 | BE-109; FE-109 | clock/producer fixtures |
| `VS-PROG-019` | Check aggregate + manifest + impact; số ô xác nhận khớp số nhóm `PRESENT`; Check không đổi active | L3/L5 | BE-103/105; FE-107/113 | API/UI + active hash |
| `VS-PROG-020` | Inventory mọi active override actor/value/priority/TTL và link Chạy thử | L3/L5/L6 | FE-108 | Core truth vs UI |
| `VS-PROG-021` | Export/import source-only; reject artifact/IR/native/corrupt/wrong target; no auto-active | L2/L5 | SYS-107; BE-108 | security corpus + UI |
| `VS-PROG-022` | RBAC viewer/operator/admin và audit mutation/reject | L3/L5 | SYS-106; BE-107 | auth matrix + audit |
| `VS-PROG-023` | Loader/integrity/import security negative, no arbitrary execution | L1/L2 | CORE-101; BE-108 | fuzz/security tests |
| `VS-PROG-024` | Two-client ETag, idempotency, BE crash/reconnect không duplicate/mất Draft | L3/L5 | BE-102/106; FE-110 | concurrency/fault log |
| `VS-PROG-025` | Copy VI/EN và DDC-first; không primary Compile/Deploy/Activate | L0/L5 | FE-111 | i18n scan + screenshots |
| `VS-PROG-026` | Core running/degraded/unreachable, active vs draft và Unknown recovery | L3/L5 | FE-102/109 | network/Core fault E2E |
| `VS-PROG-027` | Monitor 1 Hz/freshness và trace bounded 10k/10 phút/backpressure | L2/L5/L6 | CORE-110; NFR-104 | soak/memory profile |
| `VS-PROG-028` | Keyboard FBD, focus/semantics/contrast, desktop/mobile; HMI routes absent | L0/L5 | FE-104/111; SYS-108 | a11y/Chrome screenshots |
| `VS-PROG-029` | RETAIN warm/cold/mismatch/corrupt/power-loss/reset operation | L1/L6 | CORE-109 | power fault + record decode |
| `VS-PROG-030` | FE/BE/Core/iobus/MCU restart, loss, brownout; local control/safe boundary | L6/L7 | SYS-104; MCU-102; HW-101..103 | HIL + service logs/waveform |
| `VS-PROG-031` | Usability test có người dùng thật trên tám journey `UJ-PROG-01..08`; sáu ngưỡng `UX-A-01..06` | L5 usability | NFR-109; FE-101/113/114/115 | hồ sơ người tham gia, bản ghi thời gian, kết quả từng tiêu chí |
| `VS-PROG-032` | Chuyển hướng route cũ sang bốn workspace giữ đúng `projectId` và tab; đổi tab không mất nội dung đang gõ | L5 | FE-101 | E2E redirect + trạng thái editor |

### 3.1 Scenario Product thống nhất

| ID | Scenario/fixture | Cấp | Kết quả định lượng / evidence |
|---|---|---|---|
| `VS-PROG-U01` | ST/FBD user FUNCTION | L1/L4 | Pure equivalence; state/I/O/RETAIN/recursion reject; artifact/source-map. |
| `VS-PROG-U02` | 100/1024 FB instance | L1/L4 | Private state/RETAIN owner độc lập, layout stable, corrupt cold-init. |
| `VS-PROG-U03` | SYSTEM/PROJECT Control Library | L2/L3/L5 | CRUD/version/usage/DAG/import hostile/RBAC/audit; system immutable. |
| `VS-PROG-U04` | Boundary 32 Program/16 Enabled | L1/L3 | 32/16 pass; Program 33/Enabled 17 reject, Active/LKG unchanged. |
| `VS-PROG-U05` | 10 Program/3 period target | L6 | 24 h; no 3 consecutive deadline miss; no creation-order dependency; fault isolation. |
| `VS-PROG-U06` | Published Signal snapshot/freshness | L1/L3/L6 | No torn read; fallback/hold/wait; producer fault/disable/recovery đúng. |
| `VS-PROG-U07` | Enable/Disable FE→BE→Core | L3/L5/L6 | RBAC/idempotency/audit/read-back/restart intent; candidate withdrawal. |
| `VS-PROG-U08` | Package Commission/LKG/power matrix | L3/L6 | No partial active; Program mới Disabled; restart/rollback exact ở mọi journal phase. |
| `VS-PROG-U09` | ST và FBD physical output HIL | L6 | AO/DO instrument đo full safety path; Disable/rollback physical đúng. |
| `VS-PROG-U10` | Six-workspace real-backend E2E | L5 | Không Programming API mock; POU/library/mapping/check/commission/enable/runtime. |
| `VS-PROG-U11` | Trace/load/soak | L2/L6/L7 | Core ring 10k/10 phút, 24 h, no leak/deadlock, `max_iop_poll_gap <200 ms`. |
| `VS-PROG-U12` | PID Controls/Safety | L1/L6 | Saturation/anti-windup/override/release; approval token; label READY. |
| `VS-PROG-U13` | PGM-02 R1 EDIT — route/identity/typed Draft/Quick Library/refactor/reference/diagnostic | L0/L2/L3/L5 | `SYS-116`, `FE-119`, `BE-112/116`, `NFR-112`: 0/1/nhiều/invalid Project; 15 op v1/v2 typed round-trip; exact objectId/anchors; insert một Undo; conflict/ambiguity/parser failure zero mutation; PROGRAM POU thiếu `programs[]` lưu Draft được nhưng Check/Package trả `PRG-ERR-CHECK-001` + `ST-POU-005`, zero package mutation và không synthesize 1000 ms; real-BE desktop/mobile `<768` read-only; budget PASS. |
| `VS-PROG-U14` | PGM-02 R2 LIVE — immutable Active source/value coherence | L2/L3/L5/L6 | `SYS-116`, `FE-119`, `BE-116`, `CORE-117`, `NFR-112`: producer→IPC→BE→FE/read-back tuple exact; cutover/gap/mismatch clear overlay trong ≤1 render cycle; Trace không splice revision; LIVE 0 mutation; stale/offline/missing không thành zero. |
| `VS-PROG-U15` | PGM-02 R3 SIMULATE — isolated deterministic worker/admin-only/zero output | L0/L2/L3/L5/L6 | `SYS-116`, `FE-119`, `BE-117`, `CORE-118`, `NFR-112`: 14/14 viewer/operator mutations 403; replay 100/100 hash equal ở 1×/10×/60×; allowlist/quota/TTL/fault cleanup; production handle denied; Active/LKG/counters và physical AO/DO/relay không đổi. |

### Trạng thái `VS-PROG-U13..U15` (cập nhật 2026-08-27)

| Scenario | Trạng thái | Ghi chú |
|---|---|---|
| `VS-PROG-U13` | **PASS (R1 / HOST-LOCAL)** | Record: [`EV-PGM02-R1-CLOSEOUT-001`](../07_records/test-evidence/programming/2026-08-26-pgm02-t59-809-r1-closeout.md) tại commit `d32e560`. PASS này **chỉ** ở lớp HOST/LOCAL: không tuyên bố target, HIL hay release, và không nâng `I/T/P/R` của requirement nào. |
| `VS-PROG-U14` | **PASS (R2 / HOST + TARGET-BROWSER)** | Record: [`EV-PGM02-R2-CLOSEOUT-001`](../07_records/test-evidence/programming/2026-08-27-pgm02-t59-813-r2-closeout.md), base `c52c91a`. Bằng chứng target là browser + read-back đúng hash trên Foxlinx SOM-DDC-24 (`T59-810`/`T59-811` online, Core offline, diễn tập rollback). PASS này **không** phải Test Result chính thức: chưa có chữ ký operator/reviewer, chưa đo *Active cutover* ở lớp target, và không tuyên bố HIL hay I/O vật lý. |
| `VS-PROG-U15` | **PASS MỘT PHẦN (R3 / HOST + TARGET)** | Record: [`EV-PGM02-R3-CLOSEOUT-001`](../07_records/test-evidence/programming/2026-08-28-pgm02-t59-817-r3-closeout.md), base `eecc2f8`. ĐẠT: mutation của viewer/operator/engineer đều 403 (**20/20** route ở host, **12/12** phép thử trên bo); replay **100/100 hash bằng nhau**; tất định ở 1×/10×/60× (ba tốc độ cho cùng chuỗi lệnh gửi worker); allowlist/quota/TTL/fault cleanup kiểm bằng tiến trình thật; production handle denied **9/9 `EACCES` trên chính bo**; Active/LKG/bộ đếm và 8/8 ngõ ra của bảng điểm Core không đổi. **CHƯA ĐẠT**: vế *"physical AO/DO/relay không đổi"* đòi phép đo bằng thiết bị trên đầu cực — lát này đọc bảng điểm của chính Core, tức thứ Core *tin rằng* nó đang xuất. Cần người và đồng hồ đo; cùng nhóm chặn với `T59-706`. Cũng chưa có chữ ký operator/reviewer. |

Mọi scenario unified bắt đầu `NOT_RUN`; task implementation có thể tạo unit/
integration evidence, nhưng `U05/U08/U09/U11/U12/U14/U15` chỉ PASS bằng target/HIL record
có commit/image/config/hash/instrument/operator/reviewer.

## 4. Test data và coverage

- Golden Projects: minimal ST, minimal FBD, PID+AO, RTU mapping, RETAIN,
  max-bound Project, replacement Project.
- Negative corpus: malformed UTF-8/JSON/FBD, depth/size one-over, bad type/unit/
  direction/category, corrupt/truncated/overlap artifact, wrong ABI/profile/hash,
  traversal/symlink/zip bomb/executable bundle.
- Fault matrix: compiler kill/OOM/timeout, BE/Core/iobus restart, IPC drop/
  duplicate/delay, power loss từng transaction step, IOP gap 199/200/201 ms,
  Point stale/offline, priority override và Task overrun.

Mỗi requirement Must có ít nhất positive + negative/fault path tương ứng.

## 5. Gate theo discipline

### G0 — Requirements/Design approval

SRS/Architecture/Data/Interface/FE/BE/FW-SOM/FW-MCU/HW/UX/V&V/Operations/Risk,
Decision Register và Traceability đã khóa theo ADR-050. `PASS` cho implementation;
không dùng G0 để claim release.

### G1 — Contract/compiler

ST/FBD semantics, common IR, artifact/profile/error/OpenAPI/internal IPC khóa;
unit/property/fuzz đạt. Chưa đủ release.

### G2 — BE/FE engineering workflow

Project/Draft/Revision/Check/manifest/RBAC/audit/import và UI sáu workspace đạt L1–L5,
nhưng Commission mutation vẫn feature-gated nếu Core/HIL chưa đạt.

### G3 — Core deterministic runtime

Base step, cutover, loader, scheduler, Point bridge, arbitration, RETAIN, trace,
activation/restore đạt host/target timing; no-allocation/blocking chứng minh.

### G4 — Integrated Commission

BE↔Core operation, idempotency/reconciliation/LKG/read-back đạt fault matrix.

### G5 — Hardware/HIL

IOP 200 ms, output continuity, PID/priority, watchdog, power/restart, ADC/DAC/
relay và concurrent Check load đạt trên board đại diện.

### G6 — Operations/release

Upgrade/backup/restore/replacement/rollback/provenance/security/audit runbook đạt;
P0/P1 đóng hoặc waiver ký. Chỉ lúc này mới xem xét GO.

## 6. Lệnh regression dự án

Theo `AGENTS.md`, trước commit/PR release chạy mới:

```text
cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/fw --parallel
ctest --test-dir build/fw --output-on-failure

cd apps/web-api && go vet ./... && go test ./... -count=1
cd apps/web-ui && npx vitest --run --environment jsdom src
npm run lint && npm run build
```

Thêm Playwright/Chrome DevTools cho FE runtime và test target/HIL theo scenario.
Lệnh trên là plan; chỉ record kết quả vừa chạy mới là evidence.

## 7. Mẫu Test Result

```text
Test Result ID:
Scenario / Requirements:
Commit / build / artifact:
Environment / board / instrument:
Fixture / config / precondition:
Procedure / command:
Expected:
Actual:
Raw evidence path + checksum:
Result: PASS | FAIL | BLOCKED
Executed / reviewed / date:
Known limitation / follow-up:
```

## 8. Trạng thái hiện tại

Trạng thái hiện hành: `VS-PROG-001` và `VS-PROG-019` có record `BLOCKED` tại
`PROG-TR-REPO-001`; 30 scenario còn lại `NOT_RUN`. Tổng số là `2/32` record,
`0/32 PASS`, `0/32 FAIL`, `2/32 BLOCKED`. Record G1 ghim đúng commit/contract và
raw checksum, nhưng chưa có service/Check/API/UI E2E và independent QA review;
do đó không được dùng mở release gate hoặc nâng trace `P/R`.

`VS-PROG-U01..U12` và ba scenario PGM-02 Candidate `U13..U15` đều `NOT_RUN`,
chưa có Test Result. Tổng toàn catalog là **2/47 record, 0/47 PASS**. Việc tạo
contract/DDD/asset Candidate chỉ là L0 inspection input, không đổi verdict.

## 9. Test specification cho từng scenario

Quy ước fixture: `H` host CI, `B` browser thật, `T` board target, `L` HIL lab.
Mỗi execution phải pin commit/image/config/hash. “Review” trong cột cuối là thẩm
quyền ký Test Result, không phải người tự chạy.

| ID | Fixture / precondition | Procedure và fault | Expected định lượng / terminal | Target, evidence, execute/review |
|---|---|---|---|---|
| `VS-001` | H; DB mới + DB có 10 Revision | tạo Project/Draft/tag, seal; restart BE; export/import round-trip | UUID/ETag/hash giữ đúng; 0 orphan/FK error; import chỉ Draft | H; DB quick_check/dump/log; BE / QA |
| `VS-002` | B; API test target + admin/viewer | đi bốn workspace `PGM-01..04` và ba tab của mỗi workspace có tab, theo đủ tám journey `UJ-PROG-01..08`: edit→Check→Commission→Run; reload từng bước và từng tab | Draft/Active luôn tách; 0 optimistic Active; route/tab/state/copy đúng; đổi tab không mất nội dung đang gõ | B desktop/mobile; Playwright+screenshot+Console+Network; FE / UX+QA |
| `VS-003` | H; compiler profile pinned | valid local library/user POU; thử global/native/advanced/recursion | valid compile; mọi forbidden reject stable code/location; 0 artifact khi error | H; golden diagnostic/artifact; Compiler / Controls+QA |
| `VS-004` | H+T; active r15 candidate r17 | Commission, query DB/API/Core; restart BE sau activate | `SUCCEEDED` chỉ khi ID/hash/actor/time/target/first-cycle khớp; mismatch UNKNOWN/FAIL | T; correlated logs/status/journal; BE+Core / QA |
| `VS-005` | H; 20 cặp ST/FBD tương đương | compile/run cùng vectors và state cycles | common IR semantic/output/state trace 100% equivalent; artifact deterministic | H; IR diff/golden traces; Compiler / Controls+QA |
| `VS-006` | H sanitizer/fuzzer | limit−1/limit/+1; malformed UTF-8/topology/type; fuzz ≥10^7 cases | đúng boundary/code/location; 0 crash/OOM/hang/OOB | H; corpus/fuzz/sanitizer report; Compiler / Security+QA |
| `VS-007` | H; PROGRAM/FUNCTION/FB corpus | init/start/stop/state, forbidden recursion/native/cross-project | instance state isolation; pure function; forbidden reject; deterministic restart | H; unit/integration trace; Compiler+Core / Controls+QA |
| `VS-008` | H+B; Project có tag/view | add/rename/remove metadata; inspect DB/API/runtime | không thêm lifecycle/output authority; artifact semantic hash chỉ đổi theo policy | H+B; API/UI/DB inspection; FE+BE / Product+QA |
| `VS-009` | T; one Task each 1/5/30 s | 10.000 release/period; reorder programs; request period ngoài enum | drift/jitter/WCET trong approved target; deterministic order; invalid 422 | T; monotonic trace/metrics/UI; Core+FE / Architect+QA |
| `VS-010` | L; PID→AO + manual/safety override | saturate, apply/release higher priority, manual↔auto | winner/actual correct; priority 5; no bump vượt approved envelope; no windup | L; waveform/runtime snapshot; Controls+Core / Safety+QA |
| `VS-011` | H+T; active/LKG + candidate; bốn nhóm impact dựng được cả `NONE`/`PRESENT`/`UNAVAILABLE` | inject corrupt/crash/power at every lifecycle state, Commission/Restore; gửi request thiếu ack, thừa ack, `impactRef` cũ, và có nhóm `UNAVAILABLE` | exactly one active; no partial output/double activation; LKG remains loadable; thiếu ack → `PRG-ERR-ACK-MISSING-001`, thừa ack → `PRG-ERR-ACK-UNEXPECTED-001`, `UNAVAILABLE` → `PRG-ERR-IMPACT-UNAVAILABLE-001` chặn, `impactRef` cũ → `PRG-ERR-IMPACT-STALE-001`; `0` trường hợp bỏ re-auth hoặc bỏ read-back | T; journal/operation/hash/waveform + contract log; BE+Core / Architect+QA |
| `VS-012` | H+T instrumented RT | scan symbols; trap malloc/file/socket/blocking; execute max artifact | 0 forbidden symbol/call/allocation/block; bounded memory; scan continues | H+T; nm/static/instrument log; Core / Architect+QA |
| `VS-013` | T; max Task + concurrent compiler | create 1 then 3 consecutive overrun; compiler load | warning then Task FAULT; no plant nuisance safe; IOP within limit | T; timing/health/safe counters; Core+BE / Safety+QA |
| `VS-014` | L; Program AO/DO + override | Commission/Restore/fault under IOP; measure poll and hold | `max_iop_poll_gap<200 ms`, target ≤100 ms; hold Local prior proposal; no unsafe pulse | L; logic analyzer/waveform/status; Core+FW+HW / Safety+QA |
| `VS-015` | T+L; graph backup/program candidate | fault each GRAPH↔PROGRAM step; Task 30 s; restart | no dual owner; rollback backup; base-step/watchdog independent and live | T+L; owner generation/boot/config/IOP; Core+Ops / Architect+QA |
| `VS-016` | H+T controlled clocks | jump RTC/NTP/DST ±24 h while timer/task runs | monotonic Task/timer unaffected; wall timestamp only presentation/audit | T; clock+runtime trace; Core / QA |
| `VS-017` | H+B; 3 category catalog | valid and wrong ID/type/unit/direction/writable/category mapping | valid exact; invalid 422 with field/node; UI blocks; no artifact/active change | H+B; contract/UI/diagnostic; FE+BE+Core / Controls+QA |
| `VS-018` | H+B; producer clock/quality fixtures | inject GOOD/UNCERTAIN/BAD/STALE/OFFLINE/UNKNOWN/missing | value never fabricated zero; freshness/source/quality end-to-end exact | H+B; API/event/UI snapshots; All SW / QA |
| `VS-019` | H+B; Revision with layer failures; fixture cho từng tổ hợp `status` của bốn nhóm impact | run Check, view manifest/impact; compare active hash before/after; đếm ô xác nhận hiển thị ứng với từng tổ hợp | aggregate exact; no artifact on ERROR; Check causes 0 runtime mutation; số ô xác nhận **bằng đúng** số nhóm `PRESENT` (gồm cả trường hợp `0` ô); nhóm `UNAVAILABLE` khóa nút Đưa vào vận hành | H+B; API/UI/DB/Core hash + ảnh chụp từng tổ hợp; BE+FE / QA |
| `VS-020` | T+B; overrides each source/TTL | enumerate, expire, navigate trial link, mask program | UI equals resolver authority for Point/source/actor/value/priority/TTL | T+B; Core vs API/UI diff; Core+FE / Controls+QA |
| `VS-021` | H+B; valid bundle + hostile corpus | export/import; inject artifact/native/path/symlink/zip bomb/wrong target | source-only round-trip; hostile reject; import creates Draft only | H+B; bundle hashes/security/UI; BE+FE / Security+QA |
| `VS-022` | H+B; viewer/operator/admin + revoked role | run every read/mutation/direct service/route; inspect audit | exact allow/deny matrix; deny has 0 IPC/unsafe DB; audit attribution complete | H+B; auth matrix/audit; BE+FE / Security+QA |
| `VS-023` | H sanitizer/fuzz | mutate loader/header/table/hash/profile; hostile import/compiler | all reject stable code; 0 arbitrary execution/crash; active/LKG unchanged | H; fuzz/security/active hash; Core+BE / Security+QA |
| `VS-024` | H+B; two clients/two workers | stale ETag, same/different key, kill BE, drop IPC before/after activation | one Draft commit/operation/activation; unknown reconciles; local edits preserved | H+B; DB/operation/UI/fault log; BE+FE / Architect+QA |
| `VS-025` | B; VI/EN locale | scan keys/screens/actions at normal/error states | zero missing/raw key; primary DDC terms; forbidden primary labels absent | B; i18n scan/screenshots; FE / Product+UX+QA |
| `VS-026` | H+B; Core running/degraded/unreachable | drop IPC/events, restart Core, recover | active/draft explicit; stale age/unknown shown; no fake offline/zero; recover refetch | H+B; Network/Console/UI/API; FE+BE / QA |
| `VS-027` | T+B; 64 signals/trace maximum | monitor 1 Hz; capture 10.000 sample/10 min; slow client/reconnect/gap | bounded memory/CPU; drop counter/gap/stale explicit; RT timing unaffected | T+B; soak/memory/trace/UI; Core+FE / QA |
| `VS-028` | B; keyboard/screen reader/390/1024/1440 | complete FBD/Commission; zoom 200%; inspect HMI routes | focus/semantics/contrast/layout acceptance; HMI authoring endpoints absent | B+native inspection; a11y/screenshot/route; FE / UX+QA |
| `VS-029` | H+T; RETAIN records/layouts | warm/cold, compatible migration, corrupt/truncate, power cut, reset op | CRC/layout behavior exact; no silent zero; active record/LKG preserved | T; record decode/journal/power log; Core / Controls+QA |
| `VS-030` | L; complete controller/loads/instruments | restart FE/BE/Core/iobus/MCU; packet loss; brownout/power cut each phase | local control or safe boundary per authority; deterministic recovery; no untracked output | L; service logs/frame/waveform/power/result; All / Safety+QA+Product |
| `VS-031` | B; `≥5` kỹ thuật viên BMS chưa dùng MK-DDC-24; fixture Project `AHU-01` + Point catalog lab; người điều phối không phải người thiết kế; chạy **hai** lần Commission — một lần có 2 nhóm `PRESENT`, một lần cả bốn `NONE` | đi tám journey; hỏi bất ngờ “bản nào đang sửa / đang chạy”; ép Check lỗi; ép Commission timeout; quan sát người dùng ở cả hai lần Commission | `UX-A-01` nhận biết `≤5 s` ở `≥4/5`; `UX-A-02` `≤15 phút`; `UX-A-03` hoàn thành `≥90%`; `UX-A-04` `0` lỗi nghiêm trọng; `UX-A-05` `100%` trả lời đúng; `UX-A-06` `0` hiểu nhầm và `0` lần gửi lại; `UX-A-07` ở lần không có ô xác nhận nào, `0` người dùng bỏ qua bước xác thực lại hoặc hiểu nhầm là đã xong trước khi có đọc ngược | B; hồ sơ ẩn danh + thời gian từng nhiệm vụ + ghi chú điều phối; UX+FE / Product+QA |
| `VS-032` | B; build có cờ `PROGRAMMING_REV_A` | mở từng route cũ ở [UX §11.1](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md); đổi tab khi đang gõ dở; tải lại trang ở từng tab | mỗi route cũ chuyển đúng đích và giữ `projectId`; đổi tab giữ nguyên nội dung và ETag; tải lại vào đúng tab | B; Playwright trace + ảnh chụp; FE / QA |

## 10. Entry/exit, evidence repository và status control

Entry mỗi scenario: requirement/design/contract revision Approved hoặc deviation
signed; build reproducible; fixture calibrated; expected limit được ký **trước**
test; rollback/plant observer sẵn sàng cho L6/L7. Không chạy HIL output thật bằng
giới hạn `TARGET-PENDING`.

Evidence path target: `docs/07_records/test-results/programming/<TR-ID>/` hoặc hệ
thống controlled tương đương, gồm `result.md`, raw files và `SHA256SUMS`. Test
Result bất biến; rerun tạo ID mới và Trace trỏ current result. Status chỉ một trong
`NOT_RUN/RUNNING/PASS/FAIL/BLOCKED/INVALIDATED`; design/source/contract change có
impact phải chuyển PASS cũ thành `INVALIDATED`, không xóa.

## 11. Execution record và review workflow

Mỗi lần chạy tạo một `TR-PROG-<VS>-<YYYYMMDD>-<SEQ>`; không sửa record PASS/FAIL
cũ. `result.md` phải có:

| Nhóm | Field bắt buộc |
|---|---|
| Baseline | requirement/design/contract version, commit, build/package/artifact/config/schema hash |
| Fixture | host/browser/board serial/BOM/firmware, service versions, test-data seed |
| Procedure | VS ID, command/tool version, precondition, fault points, start/end/timezone |
| Expected | limit/state/error đã phê duyệt trước execution; uncertainty nếu đo điện |
| Actual | raw metric/min/max/p95/count/state sequence; link log/waveform/screenshot |
| Verdict | PASS/FAIL/BLOCKED/INVALIDATED + rationale từng acceptance |
| Review | executor, independent reviewer, deviation, known limitation, risk/trace update |

Workflow:

```text
PLANNED → READY (baseline/fixture/limit pinned)
→ RUNNING → PASS | FAIL | BLOCKED
PASS --impact change--> INVALIDATED
FAIL → defect/change → rerun bằng Test Result ID mới
```

Reviewer không được ký cùng vai trò executor cho scenario safety/security nếu
RACI yêu cầu độc lập. `BLOCKED` phải ghi thiếu fixture/authority/dependency nào;
không dùng để che FAIL. Scenario chỉ đóng khi tất cả acceptance trong cùng
baseline PASS hoặc có waiver đúng authority và trace rõ.

### 11.1 Evidence kỹ thuật host `EV-PROG-G2-207`

Record raw `docs/07_records/reviews/programming-g2/raw/EV-PROG-G2-207.txt`
ghim source `3e5281d` và các kết quả: hostile bundle **25/25**, snapshot **8 bảng**
zero-mutation, audit-secret alias **23/23**, compiler timeout/SIGKILL/output/source
bounds, fuzz Go **2.156 lượt**, Go/race, CTest **929/929**, FE **494/494** và G1
**7/7** PASS. Evidence này hỗ trợ chuẩn bị `VS-PROG-006/012/013/021/023`.

Không tạo `TR-PROG-*` từ record này vì chưa đủ baseline target/E2E, executor và
reviewer độc lập theo §11. Vì vậy catalog vẫn có đúng 2 record `BLOCKED`, 30
scenario `NOT_RUN` và **0/32 PASS**; residual risk/release gate không đổi.

### 11.2 Evidence kỹ thuật host `EV-PROG-G3-300`

Record raw `docs/07_records/reviews/programming-g3/raw/EV-PROG-G3-300.txt`
ghim source `4f7e0ac` và kết quả: targeted runtime/scheduler/executor/control API
cùng symbol gate **84/84**, full CTest Release Modbus/BACnet/HMI **933/933**,
allocation counter tại activation/execute/LKG promotion, `nm -C` archive/binary,
Go, FE **494/494** và G1 **7/7** PASS. Evidence hỗ trợ phần host của
`VS-PROG-012`.

Không tạo Test Result vì `VS-PROG-012` còn yêu cầu 10.000 cycle/period trên
Forlinx và chứng minh cả filesystem/DB/HTTP/DNS/blocking/dynamic load, cùng
executor/reviewer độc lập. Catalog do đó vẫn 2 record `BLOCKED`, 30 `NOT_RUN`,
0/32 PASS; không giảm residual hay mở release.

### 11.3 Evidence kỹ thuật host `EV-PROG-G3-301`

Record raw `docs/07_records/reviews/programming-g3/raw/EV-PROG-G3-301.txt`
ghim source `a831a0d` và kết quả: profile Rev A chỉ nhận một Task/một Program,
period `1000/5000/30000 ms`, budget `<20%`; Task 30 s chờ đúng release trong khi
base-step sequence vẫn tăng, release lỡ bị đếm và không catch-up. Targeted
Scheduler/Control API/ScanLoop/integration **74/74**, full CTest Release
Modbus/BACnet/HMI **936/936**, Go, FE **494/494**, profile generator và G1
**7/7** PASS. Evidence hỗ trợ phần host của `VS-PROG-009/015`.

### 11.4 Evidence kỹ thuật host P4 `EV-PROG-P4-403-405`

Source `c2f3189` + `10d9ad6` và gate cùng phiên chứng minh ở mức host: durable
Commission/Restore và idempotency/lease/reconcile; bounded UDS peer credential;
safe-boundary exclusive cutover; first-output/LKG; rollback; committed checkpoint
restart; active-candidate recovery; corrupt journal/artifact/symlink fail-closed.
Fresh Release build bật Modbus/BACnet/HMI, CTest 1002/1002, Go vet/test và FE
494/494+lint/build PASS.

Không tạo Test Result: chưa chạy 10.000 cycle mỗi period trên Forlinx, chưa đo
jitter/WCET/watchdog/IOP poll gap với `SCHED_FIFO`, chưa cắt điện eMMC/HIL và
chưa có executor/reviewer độc lập. Catalog giữ 2 record `BLOCKED`, 30 `NOT_RUN`,
0/32 PASS.

### 11.5 Evidence kỹ thuật host + trình duyệt thật P5 `EV-PROG-P5-500-506`

Source `e58c745..14a9299` (chín commit `S5-A..E` + `TASK-PROG-506`) dựng bốn
workspace FE thật (`PGM-01..04`) nối BE thật (không mock production): route
`/eng/programming/*` sau cờ `PROGRAMMING_REV_A`; `GET /capabilities|/runtime`,
Draft `PATCH` với `If-Match`/409-giữ-buffer, `StructuredFbdEditor` thật (không
placeholder), `GET /point-catalog|/overrides|/audit|/operations`; Check→
Commission với ack khớp đúng ba nhóm impact `PRESENT` (bao gồm câu RETAIN đúng
UC-PROG-13) và re-auth; Restore/RetainReset qua `DangerZone`; timeout
Commission/Restore đi `UNKNOWN_RECONCILING` rồi tự GET lại (không auto-replay
POST). Go `internal/programming/{application,transport/http}` **17 test file
mới/sửa** PASS; fresh CTest Release Modbus/BACnet/HMI **1002/1002** PASS; FE
`vitest` **502/502**, `tsc --noEmit`/`eslint --max-warnings=0`/`vite build`
(kèm gate drift error-catalog/API-client/FBD-contract) PASS.

Riêng `TASK-PROG-506` (`14a9299`) thêm bằng chứng **trình duyệt Chrome thật**
(Playwright, không jsdom) trên cả `desktop-chrome` và `mobile-chrome` (Pixel
7): toàn bộ `UJ-PROG-01..08` và route cũ redirect (`VS-PROG-032`) chạy
**2/2 PASS** mỗi project; `network-qa.spec.ts` **1/1 PASS**; full e2e suite
**60/60 PASS** (không hồi quy từ đổi `playwright.config.ts`). Chuỗi FBD dùng
đúng phím thật (`Insert`/`ArrowDown`/`Enter`/`Delete`/`Control+z`, không click
chuột) để thêm 2 block, nối wire, xóa, hoàn tác — hỗ trợ trực tiếp nhánh
"hoàn tất bằng bàn phím" của `VS-PROG-028` trên cả desktop và mobile viewport
(chưa có contrast/axe scan và chưa xác nhận route HMI vắng mặt nên vẫn là hỗ
trợ một phần, không phải toàn bộ scenario). `VS-PROG-032` khớp gần như trọn
vẹn kịch bản đặc tả (redirect giữ `projectId`/tab + đổi tab không mất nội
dung đang gõ) nhưng vẫn thiếu executor/reviewer độc lập theo §11 nên không đủ
điều kiện tạo `TR-PROG-*`.

Qua đúng phiên dựng `TASK-PROG-506` này, E2E tự phát hiện và buộc sửa hai lỗi
ứng dụng thật (không phải lỗi test) — chi tiết ở `CHANGELOG.md` mục
`TASK-PROG-506`: (1) đổi tab Thiết kế unmount mất nội dung ST chưa lưu, vi
phạm thẳng đặc tả `DDD-FE-PROG-001` §0.1; (2) `DELETE_SELECTION` trong FBD gỡ
phần tử đang focus khỏi DOM khiến trình duyệt rơi focus về `document.body`,
cắt chuỗi bàn phím ngay sau đó (`Ctrl+Z` không tới được `onKeyDown`). Cả hai
đã sửa và tái xác nhận PASS trong cùng commit.

Evidence trên hỗ trợ một phần `VS-PROG-020` (bảng override — BE thật đã join
`OverrideRegistry`/`App.ReadPoints`, nhưng E2E chạy với danh sách override
rỗng nên chưa có bằng chứng trình duyệt cho actor/priority/TTL hiển thị),
`VS-PROG-022` (RBAC — chỉ luồng `admin` được chạy qua E2E, chưa có ma trận
viewer/operator), `VS-PROG-025` (copy VI/DDC-first — đúng trên mọi màn hình
đã chụp, chưa quét i18n toàn bộ), `VS-PROG-026` (`SC-CORE-DEGRADED` — soát ở
mức đọc code S5-E, chưa có E2E fault-injection thật). Không tạo Test Result
nào vì thiếu executor/reviewer độc lập, chưa có target/HIL, và `VS-PROG-027`
(soak 10 phút)/`VS-PROG-029` (power-loss RETAIN)/`VS-PROG-030` (HIL)/
`VS-PROG-031` (usability `≥5` kỹ thuật viên BMS thật) vẫn hoàn toàn `NOT_RUN`
— không có đường tắt nào cho các mục này. Catalog giữ nguyên **2/32 record
BLOCKED, 0/32 PASS**; residual risk và release gate không đổi.

### 11.6 Evidence deploy đầy đủ P5 trên target `EV-PROG-P5-507`

Source `9606906` + `6069de6` + `d9a8e3b` + `0f1526c` và hồ sơ
`docs/07_records/test-evidence/fw-som/2026-08-13-foxlinx-programming-p5-deploy.md`
chứng minh đường đầy đủ FE → Web API → compiler → Artifact → Core UDS trên
Foxlinx:

- dọn filesystem từ 22% xuống 10% có kiểm target, giữ `/data/config`, tạo
  pre-deploy backup và xác minh 3/3 SHA-256; retention còn hai release;
- cross-build ARM64 có provenance, switch FE/Web/compiler/Core có auto-rollback,
  read-back hash/version/socket, 4/4 service active và system API `overall=ok`;
- Chrome target desktop/mobile: Project `201`, Draft `200` + persistence qua
  tab/reload, Revision lần hai `201`, Check `202`, Console sạch; WebSocket
  monitor `101` trong journal;
- phát hiện và sửa ba lỗi thật: Origin WS 403, target profile 400 và
  `baseRevisionId` sau seal gây 409; test host khóa cả ba;
- phát hiện thêm config legacy `ao/do:null` làm Core fail boot; normalize qua API
  về array rỗng revision 2, vá Web luôn persist `[]` và Core chỉ tương thích
  `null` thành default an toàn, type sai khác vẫn reject;
- hai Check target terminal `PASSED`; Commission fixture không `VAR_OUTPUT`,
  binding, RETAIN hoặc override đạt `SUCCEEDED/COMMITTED`; Core đọc-ngược
  Active/LKG đúng Revision, producer `READY`, Task `RUNNING`;
- trạng thái cuối xóa fixture/drop-in tạm; cờ FE/BE production `ON`, compiler và
  socket Core Programming hiện hữu, capabilities authenticated `200/READY`.

Evidence này tăng độ tin cậy target cho route/Draft/Check/Commission/read-back
của `VS-PROG-004/011/019/025/026/028/032`, nhưng **không đổi verdict**:
chưa chạy viewer/operator RBAC matrix, 10 phút soak, power-cut/HIL/usability;
executor cũng là người implement và chưa có reviewer độc lập. Vì vậy không tạo
`TR-PROG-*`, catalog vẫn **2/32 record BLOCKED, 0/32 PASS**. Đây là ranh giới
authority bằng chứng, không phải chức năng P5 chưa hoàn tất.

### 11.7 Evidence corrective FE/Monitor/Trace `EV-PROG-P5-510`

Record kiểm soát: [`REV-PROG-FE-UX-2026-08-13`](../07_records/reviews/PROGRAMMING_FE_UX_IMPLEMENTATION_AUDIT_2026-08-13.md).
Record thực thi: [`EV-PROG-P5-510`](../07_records/test-evidence/fw-som/2026-08-13-foxlinx-programming-plan53-corrective.md).
Source 508/509 được kiểm theo bốn nhóm:

| Nhóm | Positive | Negative/fault | Expected định lượng |
|---|---|---|---|
| Draft/editor/context | save ST bằng nút/Ctrl+S; metadata/tag; diagnostic jump; context đủ sáu trục | dirty rời trang; Check khi dirty; Task server update trong tab ẩn | không mất buffer; save một batch; false-dirty về 0 sau read-back |
| Commission readiness | deep-link/reload với `revisionId/checkId`; Check PASS/Core READY | override/impact 503, Core DEGRADED/safe-state | mọi unknown chặn Commission; không optimistic Active |
| Monitor/Trace | local/external mapping; program≠actual; owner/priority/TTL/quality/freshness; start/get/stop | trùng point ID khác namespace; quality chữ thường; source mất; idempotency hash khác; quota/retention | 1..32 variable; 1 s..10 phút; 100 ms..30 s; ≤4 running; ≤10.000 value-cell/session; ≤32 terminal |
| Browser | Chrome desktop + mobile đi `UJ-PROG-01..08`, Watch và Trace | console error/request failed thuộc Programming; Danger Zone sai tab | 0 console error và 0 failed request Programming ngoài fault case được chủ động inject |

Kết quả thực thi trong phiên:

- C++ Release Modbus/BACnet/HMI ON: build PASS, CTest **1004/1004**; Go vet/test
  mọi package PASS; FE **62 file/510 test**, lint/build PASS;
- local Playwright desktop/mobile và axe `VS-PROG-028` PASS;
- Foxlinx: backup, cross-build/deploy ARM64, service/hash/API read-back, rollback
  rehearsal và tái deploy PASS; bốn service `active`, health thành phần `ok`;
- Runtime đọc Active/Task `RUNNING`; Monitor authenticated trả `200`, item `0`
  đúng fixture output-free không binding; Trace selector rỗng trả `400`;
- Chrome target bốn workspace × desktop/mobile: 0 Console error/warn/page error,
  0 failed Programming request; axe WCAG A/AA **8/8 scan, 0 violation**.

Host/target/browser evidence chỉ hỗ trợ `VS-PROG-018/020/025/026/027/028/032`.
Positive row và start/get/stop Trace trên target chưa chạy vì Revision active
không có Variable Binding; không fabricate dữ liệu. Source chưa merge, executor
chưa độc lập và chưa có reviewer ký. Vì vậy không tạo `TR-PROG-*`, không nâng
`T/P/R`; catalog giữ **2/32 BLOCKED, 0/32 PASS**.

### 11.8 Bổ sung audit live HTTP và fail-closed `EV-PROG-P5-510` rev 1.1

Vòng này kiểm lại đúng endpoint HTTP công khai, nơi `isSecureContext=false`,
`crypto.randomUUID` và `crypto.subtle` không tồn tại. Bằng chứng được nối vào
record thực thi §11.7, không tạo Test Result mới:

| Hạng mục | Thao tác thật | Kết quả quan sát |
|---|---|---|
| Khởi tạo và ngôn ngữ | mở profile trình duyệt cô lập, không có ngôn ngữ lưu trước | giao diện mặc định tiếng Việt; không crash do Web Crypto |
| Auth/deep-link | mở thẳng `/eng/programming/runtime?tab=service#danger-zone`, qua đăng nhập | quay lại đúng `pathname + search + hash` |
| Draft ST | thêm một newline, lưu; sau đó phục hồi byte gốc và lưu lại | hai PATCH `200`; dirty trở về false; source đọc-ngược đúng byte ban đầu |
| Export/import | tải bundle; import fixture không hợp lệ | export HTTP `200`; tải `mkddc-programming-1ab7cb9b.zip`; import đi tới backend và fail-closed HTTP `422`, không lỗi JavaScript |
| Safe-state/RETAIN | target đang `safeState=true`; mở tab Bảo trì | Restore bị khóa; vùng cảnh báo có `PRG-SAFE-ACTIVE`, mức độ/lý do/phạm vi/hành động; RETAIN luôn bị khóa vì contract chưa có impact/read-back đầy đủ và không phát request |
| Responsive/a11y | Overview, Design và Service ở desktop + mobile | 6/6 lượt axe WCAG A/AA có 0 violation; 0 console error; 0 failed request; mobile có bốn điều hướng và không tràn ngang |

Artifact cuối được triển khai có SHA-256 tar
`5e0d5cb8d57e38e22a6caaf7a7750db1b01803901e2e4899eba23e013c79f672`,
SHA-256 `index.html`
`30ee074329685a801abaf468c6aaa5d1eacfecc515128e3483ebdd9d9cab5dbd`;
rollback nằm tại `/opt/mkddc-web/dist.rollback.20260813T1531Z`. Một lần deploy
trung gian thiếu `VITE_PROGRAMMING_REV_A=1` đã bị live browser phát hiện và
được thay ngay bằng artifact đúng profile; không dùng lần trung gian làm bằng
chứng PASS.

Ranh giới authority không đổi: đây là kiểm tra hỗ trợ do người implement thực
hiện. Positive Monitor/Trace với Variable Binding, accessibility review độc lập,
usability `≥5` kỹ thuật viên và target/HIL/power-cut vẫn chưa có Test Result;
catalog giữ **2/32 BLOCKED, 0/32 PASS**, mọi `T/P/R=N`.

Gate cuối sau khi bổ sung test hồi quy đạt: C++ Release Modbus/BACnet/HMI ON
**1004/1004**, Go vet/test không cache PASS, FE **64 file/521 test** +
lint/typecheck/build PASS, Playwright Programming 10/10 và Network QA 1/1
(tổng **11/11 PASS**). Network QA khai báo locale tiếng Anh rõ ràng để không phụ
thuộc mặc định profile mới là tiếng Việt.

## 12. Blocker, revision và sign-off

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| Exact Candidate PGM-02 | Product + System Architect + Document Control | **Đã đóng authority:** `AUTH-PROG-2026-08-24-05`, exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`; không dùng pin làm Test Result |
| ~~`VS-PROG-U13` chưa có implementation/evidence R1~~ **ĐÓNG 2026-08-26** | FE + BE + Compiler + QA | `T59-802..809` DONE ở lớp HOST/LOCAL; record `EV-PGM02-R1-CLOSEOUT-001`. Còn mở ở lớp target/HIL, không phải ở lớp R1 |
| `VS-PROG-U14` chưa có coherent producer chain | Core + BE + FE + QA | **Đóng phần producer→UI→read-back** 2026-08-27 (`T59-810..813 DONE`; target fault + read-back đúng Active tuple, `EV-PGM02-R2-CLOSEOUT-001`). Còn mở: *Active cutover* ở lớp target và chữ ký operator/reviewer cho Test Result chính thức |
| `VS-PROG-U15` chưa có worker/isolation/HIL fixture | Runtime + Security + BE + FE + HW/QA | `ADR-053` Accepted; `T59-814..817=ORDERED` sau R2; isolated worker + calibrated zero-output target/HIL Test Result |
| Requirement/design: `17 DECIDED/0 OPEN/0 CLOSED`, baseline approved | Product + Architect + discipline authority | **Đã mở implementation** theo `AUTH-PROG-2026-08-11-03` |
| P5 đã deploy đầy đủ và happy path target PASS | Core + HW + Ops + QA | chạy fault/power/restart/HIL P6 với executor/reviewer độc lập để cấp Test Result |
| BSP/HW fixture/limits/HIL chưa có | FW/HW/Safety | controlled setup + calibrated instruments |
| Corrective source chưa commit/merge | FE/BE/Core + Dev Lead | commit/PR/merge thật; chạy lại gate, candidate pin và docs harness trước khi đổi trục `I` |
| Positive Monitor/Trace target có Variable Binding | QA + FE/BE/Core | fixture read-only an toàn có binding; kiểm row program/actual/owner/priority/quality/freshness và start/get/stop, lưu raw output |
| Accessibility/Test Result độc lập | Accessibility Reviewer + QA | review tool evidence 8/8 scan và bundle mới; ký Test Result theo workflow §11 |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Catalog/gate/evidence template 30 scenario |
| 0.2 | 2026-08-09 | Thêm test specification từng VS, fixture/step/expected/target/authority/status M3 |
| 0.3 | 2026-08-09 | Bổ sung Test Result ID/schema, execution/review workflow, invalidation và independence rule; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại V&V; giữ 0/30 Test Result |
| 0.5 | 2026-08-09 | Thêm `VS-PROG-031` (usability test có người dùng thật, sáu ngưỡng `UX-A-01..06`) và `VS-PROG-032` (chuyển hướng route và giữ trạng thái tab); tổng 32 kịch bản, vẫn 0 Test Result |
| 0.6 | 2026-08-10 | Sửa self-check trạng thái trung thực từ dải cũ `001..030` sang catalog hiện hành `001..032`; không thay đổi 0/32 Test Result hoặc gate |
| 0.7 | 2026-08-10 | Ghi Product Owner/CTO Phạm Đình Chương `ACCEPT` theo `AUTH-PROG-2026-08-10-01`; đồng bộ register `3 DECIDED/14 OPEN`. Giữ Verification Lead PENDING và 0/32 Test Result; không nâng gate hay maturity |
| 0.8 | 2026-08-11 | Phê duyệt V&V baseline theo `AUTH-PROG-2026-08-11-03`; 17/17 decision `DECIDED`; Verification/discipline signature `WAIVED FOR IMPLEMENTATION`; HIL là deliverable P6, không chặn P1–P5; giữ trung thực 0/32 Test Result |
| 0.9 | 2026-08-11 | Ghi execution G1 cho `VS-PROG-001/019`: hai record `BLOCKED`, phần store/contract host đạt nhưng workflow E2E và independent review còn thiếu; tổng 0/32 PASS, không nâng residual risk hay release gate |
| 1.0 | 2026-08-11 | Đăng ký `EV-PROG-G2-207` làm evidence kỹ thuật host hỗ trợ VS-006/012/013/021/023: hostile corpus 25 lớp, zero-mutation 8 bảng, 23 audit alias, compiler fault bounds, fuzz và full regression PASS; không tạo Test Result, giữ 2 record BLOCKED và 0/32 PASS |
| 1.1 | 2026-08-11 | Đăng ký `EV-PROG-G3-300` cho phần host VS-012: prepared runtime/handle swap/LKG không cấp phát trong test, post-link không parser/compiler, targeted 84/84 và CTest 933/933; giữ scenario NOT_RUN vì chưa có 10.000 cycle/no-blocking trên Forlinx và reviewer độc lập |
| 1.2 | 2026-08-11 | Đăng ký `EV-PROG-G3-301` cho phần host VS-009/015: profile Rev A 1/1/1, period 1/5/30 s, budget `<20%`, base-step sequence và no-catch-up; targeted 74/74, CTest 936/936; giữ scenario NOT_RUN vì chưa có 10.000 cycle/timing/watchdog/IOP trên Forlinx và reviewer độc lập |
| 1.3 | 2026-08-13 | Đăng ký `EV-PROG-P4-403-405` cho phần host VS-004/011/015/024/029/030: operation/replay/restart, UDS/cutover/rollback/checkpoint recovery và negative fault PASS; fresh CTest 1002/1002 + Go/FE gates PASS. Giữ 2 record BLOCKED, 0/32 PASS vì target/HIL/power-cut/reviewer độc lập chưa có. |
| 1.4 | 2026-08-13 | Đăng ký `EV-PROG-P5-500-506` cho P5 FE bốn workspace: source/host đầy đủ (Go 17 file test, CTest 1002/1002, FE vitest 502/502) + bằng chứng trình duyệt Chrome thật `TASK-PROG-506` (Playwright desktop+mobile, `UJ-PROG-01..08` 2/2 PASS mỗi project, FBD hoàn tất bằng phím thật, hai lỗi ứng dụng tự phát hiện+sửa ngay). Hỗ trợ một phần `VS-PROG-020/022/025/026/028/032`. Giữ nguyên 2 record BLOCKED, 0/32 PASS — chưa có executor/reviewer độc lập, target/HIL; `VS-PROG-027/029/030/031` vẫn NOT_RUN. |
| 1.5 | 2026-08-13 | Đăng ký `EV-PROG-P5-507`: cleanup/backup/checksum, ARM64 deploy/read-back và Chrome desktop/mobile trên Foxlinx; Project/Draft/Revision/Check đạt HTTP `201/200/201/202`, Console sạch, WS `101`; ba lỗi target được sửa. Check terminal fail-closed vì thiếu compiler, Core Programming chưa deploy; flag cuối OFF/API 404, không Commission. Đây là supporting target evidence cho một phần `VS-019/025/026/028/032`, không Test Result; giữ 2/32 BLOCKED, 0/32 PASS. |
| 1.6 | 2026-08-13 | Mở rộng `EV-PROG-P5-507` sau `0f1526c`: deploy compiler/Core/Web/FE ARM64, sửa safe-state legacy `null`, bật cờ production; hai Check `PASSED`, Commission output-free `SUCCEEDED/COMMITTED`, Core read-back Active/LKG/Task `RUNNING`, Chrome sạch. P5 target happy path hoàn tất; giữ 2/32 BLOCKED, 0/32 PASS vì fault/power/HIL/usability và review độc lập chưa chạy. |
| 1.7 | 2026-08-13 | Đăng ký `EV-PROG-P5-508-510` cho audit/corrective slice: định nghĩa test context/dirty/ST/deep-link/readiness, Monitor/Trace bounded và Chrome desktop/mobile; ghi rõ host evidence không kế thừa target 507. Source 508/509 đang VERIFYING; Task 510 target BLOCKED do SSH Foxlinx. Giữ 2/32 BLOCKED, 0/32 PASS. |
| 1.8 | 2026-08-13 | Ghi `EV-PROG-P5-510`: full host gate, deploy/read-back/rollback rehearsal/tái deploy Foxlinx, Chrome desktop/mobile và axe 8/8 scan PASS. Đóng blocker SSH/tool scan; giữ source chưa merge, positive Monitor/Trace có binding, reviewer/usability/HIL/Test Result độc lập. Giữ 2/32 BLOCKED, 0/32 PASS và mọi `T/P/R=N`. |
| 1.9 | 2026-08-13 | Bổ sung audit live HTTP cho `EV-PROG-P5-510` rev 1.1: UUID/SHA fallback không cần secure context, deep-link qua auth, ST save rồi phục hồi byte gốc, export `200`, import fault `422`, Restore/RETAIN fail-closed, mobile nav/no-overflow và axe 6/6 scan sạch. Ghim hash artifact/index/rollback; ghi rõ một deploy trung gian thiếu build flag đã bị thay. Giữ 2/32 BLOCKED, 0/32 PASS và mọi `T/P/R=N`. |
| 2.0 | 2026-08-20 | ADR-050: giữ 32 scenario migration và thêm `VS-PROG-U01..U12` cho POU/library/multi-Program/signal/enable/package/output/soak/PID; 44 scenario total, 12 unified đều NOT_RUN. |
| 2.3 | 2026-09-27 | `VS-PROG-009` theo ADR-061: tập chu kỳ {10…50000} ms thay cho 1/5/30 s, mã từ chối `ST-SCHED-001`; ngưỡng 10 000 chu kỳ giữ cho chu kỳ ≤ 5 s, còn 10 s và 50 s đo trong soak 24 h (8 640 / 1 728 chu kỳ) vì 10 000 chu kỳ 50 s mất 5,8 ngày — chủ sở hữu chốt 2026-09-27 (X20, `EV-PROG-FBD-ST-MB-20260925`). Không đổi trạng thái PASS nào. |
| 2.2 | 2026-08-26 | `VS-PROG-U13` chuyển **PASS ở phạm vi R1/HOST-LOCAL** kèm record `EV-PGM02-R1-CLOSEOUT-001` tại commit `d32e560`; ghi rõ PASS này không tuyên bố target/HIL/release và không nâng `I/T/P/R`. `U14`/`U15` giữ `NOT_RUN`. |
| 2.1-candidate | 2026-08-24 | Thêm `VS-PROG-U13..U15` cho PGM-02 R1 EDIT/R2 LIVE/R3 SIMULATE và ánh xạ closeout `T59-809/813/817`; tổng 47 scenario, ba scenario mới NOT_RUN; Architect exact pin và mọi card code/release giữ PENDING/NO-GO. |
| 2.2 | 2026-08-24 | Ghi `AUTH-PROG-2026-08-24-05` pin exact Candidate `413a043748dce3b44d2c5076412de761760ba17a` và mở implementation theo R1→R2→R3; bổ sung ca âm `ST-POU-005` vào U13; giữ U13–U15 NOT_RUN, 0/47 PASS và release NO-GO. |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Verification + discipline leads | **WAIVED FOR IMPLEMENTATION** | review/test theo task; không chặn code |
| Product Owner | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | `AUTH-PROG-2026-08-11-03` |
| Verification Lead | **WAIVED FOR IMPLEMENTATION** | giữ độc lập khi ký Test Result; không phải entry condition |
| Product Owner/CTO + System Architect | **ACCEPT — 2026-08-20** | `AUTH-PROG-2026-08-20-04`; scope unified và evidence boundary |
| Product Owner/CTO + System Architect — PGM-02 v2.2 | **AUTHORIZED FOR IMPLEMENTATION — 2026-08-24** | `AUTH-PROG-2026-08-24-05`; exact Candidate pin; không phải Test Result approval |
| Verification Lead + discipline reviewers — PGM-02 | **WAIVED FOR IMPLEMENTATION; EVIDENCE PENDING** | U13–U15 giữ NOT_RUN; review/authority ký PASS vẫn độc lập |

## 13. Phụ lục — Tự kiểm cổng M3 (loại: V&V)

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Trace tới requirement và risk | PASS ở lớp Candidate | §3 phủ 32 migration + 12 unified + 3 PGM-02; đối chiếu ngược ở `TRACE-PROG-001` |
| Cấp kiểm chứng | PASS | §2 định nghĩa `L0..L7`; §3 gán cấp cho từng kịch bản |
| Đồ gá | PASS | §9 quy ước `H` host CI, `B` trình duyệt thật, `T` board target, `L` HIL lab |
| Điều kiện trước | PASS | §9 cột đầu; §10 entry: build tái lập được, đồ gá đã hiệu chuẩn, giới hạn kỳ vọng **ký trước khi chạy** |
| Các bước | PASS | §9 cột “Procedure và fault” mô tả cả bước thường và bước chèn lỗi |
| Kết quả kỳ vọng | PASS | §9 định lượng, ví dụ fuzz `≥10⁷` ca, `10.000` chu kỳ mỗi period, poll gap `<200 ms`, `0` crash/OOM, usability `≤15 phút` và `≥90%` hoàn thành |
| Ca âm và ca lỗi | PASS | Có trong mọi kịch bản; riêng `VS-PROG-006/011/021/023/029/030` là ca lỗi chuyên biệt |
| Môi trường và target | PASS | §9 cột cuối ghi rõ chạy ở đâu; §5 gate theo discipline |
| Evidence | PASS | §7 mẫu Test Result; §10 đường dẫn `docs/07_records/test-results/programming/<TR-ID>/` gồm `result.md`, tệp thô và `SHA256SUMS` |
| Thẩm quyền ký PASS | PASS | §9 cột cuối tách “execute” và “review”; §11 quy trình review |
| Trạng thái trung thực | PASS | Legacy: 2 `BLOCKED`, 30 `NOT_RUN`, 0 PASS; unified baseline: 12 `NOT_RUN`; PGM-02 Candidate: 3 `NOT_RUN`; §10 cấm kế thừa PASS cũ |
| Quyền implementation | PASS toàn PGM-02 | `AUTH-PROG-2026-08-24-05` mở ba `IMPLEMENT_READY`; U13–U15 vẫn NOT_RUN và không mở release |

Số Test Result hiện tại: **2/47 record, 0/47 PASS**; hai record legacy `BLOCKED`,
45 scenario chưa có record PASS. Hồ sơ này không chứng minh target/HIL đã đạt.
