# Kế hoạch Verification & Validation Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `VVP-PROG-001` |
| Phiên bản | 1.0 |
| Trạng thái | **APPROVED FOR IMPLEMENTATION** — 32/32 kịch bản là baseline DoD; hiện có 2/32 record `BLOCKED`, 0/32 PASS |
| Ngày | 2026-08-11 |
| Chủ quản | Verification Lead |
| Người review | Product, System Architect, FE/BE/Core/FW/HW/Ops Leads |
| Người phê duyệt | Verification Lead + Product Owner |
| Nguồn | `SRS-PROG-001`, bộ thiết kế Programming ở mức M3, Risk/Traceability |
| Requirement | `SRS-PROG-001` |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **cách chứng minh hệ thống làm đúng**: 32 kịch bản `VS-PROG-001..032`, mỗi kịch bản có đồ gá, điều kiện trước, các bước, kết quả kỳ vọng định lượng, môi trường và ai được ký. Cũng chốt cái gì **không** được tính là bằng chứng. |
| 2. Ai phải đọc file này? | Verification Lead (chủ quản) và mọi discipline lead — vì mỗi người sở hữu một phần trong cột “execute/review”. Release authority đọc §5 để biết gate nào đang mở. |
| 3. Hệ thống hiện tại đang có gì? | `VS-PROG-001` và `VS-PROG-019` có execution record G1 `BLOCKED`; 30 scenario còn lại `NOT_RUN`, tổng PASS vẫn `0/32` (§8). `EV-PROG-G2-207` là evidence kỹ thuật host hỗ trợ `VS-006/012/013/021/023`, nhưng chưa có executor/reviewer độc lập và target/E2E tương ứng nên không phải Test Result. |
| 4. Thiết kế mới thay đổi điều gì? | Chuyển từ “có test” sang **bằng chứng có thẩm quyền**: mỗi lần chạy phải ghim commit, image, config và hash; Test Result là bất biến; chạy lại sinh ID mới. Trạng thái chỉ được là một trong `NOT_RUN/RUNNING/PASS/FAIL/BLOCKED/INVALIDATED`. |
| 5. Team phải sửa module/contract nào? | Không sửa code. Cần dựng thư mục bằng chứng `docs/07_records/test-results/programming/<TR-ID>/` gồm `result.md`, tệp thô và `SHA256SUMS`, cùng các đồ gá `H/B/T/L` ở §9. |
| 6. Điều gì còn bị chặn? | **Không còn blocker approval cho implementation.** Các giới hạn đã `DECIDED`. Đồ gá HIL (`L`) là deliverable/evidence của P6 và không chặn team bắt đầu P1–P5. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Chính file này định nghĩa. Với bản thân hồ sơ: 32/32 kịch bản có đặc tả đủ năm trục ở §9. `EV-PROG-G2-207` được lưu như evidence host hỗ trợ, không nâng verdict. Hiện có **2/32 record, 0/32 PASS, 2/32 BLOCKED**. |

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
| L5 Browser E2E | bốn workspace và tám journey, RBAC, errors, a11y, responsive | FE/QA |
| L6 Target/HIL | timing, output, watchdog, power/restart, MCU/IOP | Core/FW/HW/QA |
| L7 Release/operations | install/upgrade/backup/restore/rollback/provenance | Ops/QA |

## 3. Catalog scenario duy nhất

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
| `VS-PROG-009` | Một Task, period 1/5/30 s, deterministic order; ngoài allowlist reject | L1/L6 | CORE-102; FE-106 | 10k cycle/period + UI test |
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
Open Decisions và Traceability được review/ký. Hiện `RED`.

### G1 — Contract/compiler

ST/FBD semantics, common IR, artifact/profile/error/OpenAPI/internal IPC khóa;
unit/property/fuzz đạt. Chưa đủ release.

### G2 — BE/FE engineering workflow

Project/Draft/Revision/Check/manifest/RBAC/audit/import và UI bốn workspace đạt L1–L5,
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

## 12. Blocker, revision và sign-off

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| Requirement/design: `17 DECIDED/0 OPEN/0 CLOSED`, baseline approved | Product + Architect + discipline authority | **Đã mở implementation** theo `AUTH-PROG-2026-08-11-03` |
| FE/BE/Core Programming chưa implement | Dev Leads | gates Plan 53 + build artifacts |
| BSP/HW fixture/limits/HIL chưa có | FW/HW/Safety | controlled setup + calibrated instruments |

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

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Verification + discipline leads | **WAIVED FOR IMPLEMENTATION** | review/test theo task; không chặn code |
| Product Owner | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | `AUTH-PROG-2026-08-11-03` |
| Verification Lead | **WAIVED FOR IMPLEMENTATION** | giữ độc lập khi ký Test Result; không phải entry condition |

## 13. Phụ lục — Tự kiểm cổng M3 (loại: V&V)

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Trace tới requirement và risk | PASS | §3 cột “Requirement chính” cho 32 kịch bản; đối chiếu ngược ở `TRACE-PROG-001` §6 |
| Cấp kiểm chứng | PASS | §2 định nghĩa `L0..L7`; §3 gán cấp cho từng kịch bản |
| Đồ gá | PASS | §9 quy ước `H` host CI, `B` trình duyệt thật, `T` board target, `L` HIL lab |
| Điều kiện trước | PASS | §9 cột đầu; §10 entry: build tái lập được, đồ gá đã hiệu chuẩn, giới hạn kỳ vọng **ký trước khi chạy** |
| Các bước | PASS | §9 cột “Procedure và fault” mô tả cả bước thường và bước chèn lỗi |
| Kết quả kỳ vọng | PASS | §9 định lượng, ví dụ fuzz `≥10⁷` ca, `10.000` chu kỳ mỗi period, poll gap `<200 ms`, `0` crash/OOM, usability `≤15 phút` và `≥90%` hoàn thành |
| Ca âm và ca lỗi | PASS | Có trong mọi kịch bản; riêng `VS-PROG-006/011/021/023/029/030` là ca lỗi chuyên biệt |
| Môi trường và target | PASS | §9 cột cuối ghi rõ chạy ở đâu; §5 gate theo discipline |
| Evidence | PASS | §7 mẫu Test Result; §10 đường dẫn `docs/07_records/test-results/programming/<TR-ID>/` gồm `result.md`, tệp thô và `SHA256SUMS` |
| Thẩm quyền ký PASS | PASS | §9 cột cuối tách “execute” và “review”; §11 quy trình review |
| Trạng thái trung thực | PASS | §8 ghi đúng 2 record `BLOCKED`, 30 `NOT_RUN`, 0 PASS; §10 cấm kế thừa PASS cũ và bắt chuyển `INVALIDATED` khi contract đổi |
| Quyền implementation | **PASS** | Giới hạn đã `DECIDED`; HIL chưa tồn tại là deliverable P6 và không chặn P1–P5; mọi `IMPLEMENT_READY[*] PASS` |

Số Test Result hiện tại: **2/32 record, 0/32 PASS, 2/32 BLOCKED**. Hồ sơ này và
record G1 không chứng minh workflow E2E hoặc target/HIL đã đạt.
