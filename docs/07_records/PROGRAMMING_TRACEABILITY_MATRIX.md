# Ma trận truy vết Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `TRACE-PROG-001` |
| Phiên bản | 6.7 |
| Trạng thái | **Active — baseline 82/82 requirement và 44/44 scenario; PGM-02 v2.2 pre-baseline, chỉ `T59-801` READY** |
| Cập nhật | 2026-08-24 |
| Chủ quản | Verification Lead |
| Người review | Document Control, Product, Architect và tất cả discipline lead |
| Người phê duyệt | Verification Lead + Document Control |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Nối Product v3.0 → 82 requirement → Unified DDD → Plan 59 task → scenario/evidence/release. Legacy matrix phía dưới giữ history. |
| 2. Ai phải đọc file này? | Verification Lead và Document Control (chủ quản); mọi discipline lead khi đổi requirement hoặc contract; Release authority trước khi ký. |
| 3. Hệ thống hiện tại đang có gì? | Baseline có 82/82 requirement ở §6, 44/44 scenario được nối, 22/82 `I=Y`, 0/44 formal PASS. PGM-02 v2.2 mới có Owner change request và `T59-801`; chưa có requirement/scenario canonical hay code/evidence để đổi `D/I/T/P/R`. |
| 4. Thiết kế mới thay đổi điều gì? | ADR-050 giữ baseline unified. `CR-PROG-PGM02-V22-001` mở một vòng reconciliation cho route/workspace và Simulation theo R1 EDIT → R2 LIVE → R3 SIMULATE; Architect/baseline pin còn PENDING. |
| 5. Team phải sửa module/contract nào? | Cột “Source target” ở §6 là **nơi phải tạo hoặc sửa**, không phải tuyên bố code đã có. Khi merge code, chỉ trục `I` được đổi và phải kèm commit, file và symbol cụ thể. |
| 6. Điều gì còn bị chặn? | Baseline ADR-050 vẫn triển khai theo task hiện hành. PGM-02 v2.2 code bị chặn tới khi `T59-801` hoàn tất và Owner + Architect pin baseline; `F-P59-GHOST-POU-001` chờ Owner. Target/HIL/soak/CI/provenance tiếp tục chặn Release. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | `docs_iso_harness.py --expect` phải xác nhận 82 dòng D/I/T/P/R, 0 link/ID/invariant lỗi; `trace_bidirectional_check.py` phải xác nhận 82/82 requirement và 44/44 scenario. Đây chỉ là bằng chứng tính nhất quán tài liệu, không thay Test Result, target/HIL hay release approval. |

Đọc `DOCUMENTED` cho đúng: nó chỉ nghĩa là **có link thiết kế và test**, không
nghĩa code tồn tại, cũng không nghĩa test đã PASS.

## Unified Product crosswalk — authority cho công việc tương lai

| Requirement mới | Design/contract owner | Plan 59 | Scenario | Evidence hiện tại |
|---|---|---|---|---|
| `SYS-REQ-PROG-109` | Unified DDD §4–§6; Language/registry v2 | T59-003, T59-101..106 | U01/U02 | `T59-101..106`: parser/model/registry/package host-local; compile package thật/runtime/target còn thiếu; U01/U02 NOT_RUN |
| `SYS-REQ-PROG-110` | Unified DDD §4–§6; Control Library | T59-003, T59-201..205 | U03/U12 | `T59-205`: review gate PID ép ở ba đường Check, token từ contract, G1 ghim trạng thái chưa duyệt — `U12` vẫn NOT_RUN vì evidence Controls/Safety thuộc `T59-706`. `T59-201`: SYSTEM virtual immutable + PROJECT revision/entry/usage store, canonical hash/DAG/layout/reference/migration/restart host-local. `T59-202`: REST/RBAC/idempotency/audit host-local. `T59-204`: export/import nguồn có Control Library, corpus thù địch và version compatibility host-local; bundle vẫn `HASH_ONLY`. FE/import/compiler/runtime/target còn thiếu; U03 NOT_RUN |
| `SYS-REQ-PROG-111` | Unified DDD §4.1/§7; profile v2 | T59-002, T59-301/305/402 | U04/U05 | `T59-301`: document v2 32 Program, Program thứ 33 bị từ chối và Draft giữ đúng 32. `T59-302`: Check biên dịch mọi Program và lắp container v2, hash tất định. `T59-305`: manifest mang topology/budget theo profile, không bám thứ tự tạo, Program mới Disabled (host/local). Thi hành trần 16 Enabled và runtime còn thiếu; U04/U05 NOT_RUN |
| `SYS-REQ-PROG-112` | Unified DDD §4.5/§7.3 | T59-301/304/404/504/505 | U05/U06/U10 | `T59-301/304/404`: định nghĩa, validation package và double-buffer committed snapshot đã có ở host/local. `T59-504` nối snapshot signal riêng tới UI, giữ `valid=false`/BAD/OFFLINE/UNAVAILABLE là không có giá trị thay vì 0; `T59-505` có fixture signal trong vòng đời Revision thật trên lane HOST/LOCAL đang được gate. Opcode signal trong thân Program và target/soak còn thiếu; U05/U06/U10 NOT_RUN |
| `SYS-REQ-PROG-113` | Unified DDD §4.3/§5.1–5.2/§7.2 | T59-405/501/503/505 | U07/U08/U10 | `T59-503`: PGM-05 hiển thị lifecycle từ Check/operation read-back và context tách desired intent khỏi runtime state. `T59-505`: source lane Project→Draft→Check→Commission→Enable→Runtime→Disable→Restore qua backend/compiler/Core simulator thật, không dùng Programming mock; lane HOST/LOCAL đang được gate, chưa phải Test Result/target/HIL. U07/U08/U10 NOT_RUN |
| `SYS-REQ-PROG-114` | Unified DDD §4.6/§7/§9 | T59-303/304/406 | U07/U09 | `T59-303`: binding MB_RTU resolve qua `extIndex` của Point Catalog. `T59-304`: output owner duy nhất kiểm ở Check theo điểm vật lý (host/local). Candidate/arbitration runtime còn thiếu; U07/U09 NOT_RUN |
| `SYS-REQ-PROG-115` | Unified DDD §7 | T59-402/403/702 | U05/U11 | NOT_RUN |
| `SWR-REQ-PROG-FE-116..118` | Unified DDD §8; UX unified section | T59-203/503/504/506 | U03/U06/U07/U10 | `T59-203`: Control Library search/filter/detail/create/delete và review-gate chỉ hiển thị. `T59-503`: đúng sáu route/nav desktop-mobile, context Draft/Active/intent/runtime không trộn và PGM-05 lifecycle fail-closed. `T59-504`: Watch phủ LOCAL/VP/MB_RTU, Point candidate/actual/source/priority/quality/freshness và Published Signal ở snapshot riêng. `T59-506`: lịch sử ST 50 snapshot, kiểm 20 undo/redo + cursor, runtime overlay giữ null/invalid; FBD lấy interface POU typed từ Draft v2 và không đoán pin. Source/component test ở host/local; E2E thật thuộc `T59-505` đang được gate; U03/U06/U07/U10 NOT_RUN |
| `SWR-REQ-PROG-BE-111` | Unified DDD §4–§6 | T59-005/201/202 | U03 | `T59-201`: domain/store + schema v7 có immutable/version/reference guard. `T59-202`: 3 route DDD §5.1, OpenAPI 1.23.0 28 operation ↔ route Go ↔ client TS exact, RBAC admin-only cho mutation, `If-Match`+idempotency+audit cùng transaction. FE/import/target còn thiếu; U03 NOT_RUN |
| `SWR-REQ-PROG-BE-112..115` | Unified DDD §4–§6 | T59-006/302/405/408/504/505 | U04/U07/U10 | `BE-112/115`: Check/package v2 đã có source host/local từ W3/W4. `BE-113`: Enable/Disable đã có RBAC/idempotency/audit/reconcile/read-back source. `BE-114`: `TRACE_READ` là nguồn mẫu chính; Monitor Point và `GET /runtime/signals` giữ unavailable explicit, không trộn hai nguồn trong một dãy. `T59-505` gọi đúng HTTP/worker/compiler/packager/IPC trong lane HOST/LOCAL đang được gate; chưa có Test Result/target. U04/U07/U10 NOT_RUN |
| `SWR-REQ-PROG-CORE-111..116` | Unified DDD §5.3/§7 | T59-401..408/501/504/505 | U02/U05..U09/U11 | Baseline merged có package v2/dual-reader, per-Program scheduler, signal double-buffer, Enable/Disable safe-boundary, RETAIN cô lập và trace bounded. Corrective source current-worktree bổ sung `SIGNAL_READ=0x71`, `SIGNAL_PUBLISH=0x72`, section signal-ref `0x0009`, prepared whole-program-set và handoff sau `PREPARED` fsync; thêm `F-P59-MONITOR-VARS-001` (Monitor tra biến theo `locals` Draft v2 và giữ point Core khi SHM chưa attach) và `F-P59-ROLLBACK-DB-001` (snapshot/khôi phục store Programming khi rollback), thêm `F-P59-ENABLE-BOUNDARY-001` (Enable/Disable ARM ở non-RT, áp dụng tại safe boundary, ack theo generation; trần 16 kiểm trước khi chạm trường) và `F-P59-SIGNAL-READBACK-001` (read-back signal cho reader non-RT kiểm generation trước/sau khi chép) — bằng chứng TSan `docs/07_records/test-evidence/programming/2026-08-24-tsan-enable-boundary.md`; chưa merge nên chưa nâng `I`. Target timing/soak/power/HIL vẫn thiếu; U02/U05..U09/U11 NOT_RUN |
| `NFR-REQ-PROG-111` | Unified DDD §11–§12 | T59-606/702/707 | U05/U11 | NOT_RUN |

### Evidence source W5 `T59-503..506` — chưa phải Test Result

| Task | Requirement đúng phạm vi | Source/control hiện có | Phép kiểm gắn trực tiếp | Trạng thái bằng chứng |
|---|---|---|---|---|
| `T59-503` | `SYS-REQ-PROG-113`; `SWR-REQ-PROG-FE-116..118` | `ProgrammingRoutes.tsx` khai báo sáu route canonical; `ProgrammingDesktopNav.tsx`/`ProgrammingMobileNav.tsx` giữ đủ sáu workspace; `ProgrammingLayout.tsx` không fallback sang Project khác khi URL đã có `projectId`; `ProgrammingContextBar.tsx` tách Draft, Active, desired intent và runtime read-back; `CheckCommissionPage.tsx` hiển thị lifecycle DRAFT→CHECKING→READY→STAGING→ACTIVATING→VERIFYING→terminal/unknown | `ProgrammingRoutes.test.tsx`; `ProgrammingDesktopNav.test.tsx`; `ProgrammingMobileNav.test.tsx`; `ProgrammingLayout.test.tsx`; `ProgrammingContextBar.test.tsx`; `CheckCommissionPage.test.tsx`; `OverviewPage.test.tsx` | Source/component/browser HOST/LOCAL PASS trong FE 1161 test, E2E mock 61/61 và Chrome desktop/mobile. Không đổi `I/T/P/R`, không phải usability/Test Result/target |
| `T59-504` | `SYS-REQ-PROG-112`; `SWR-REQ-PROG-FE-118`; `SWR-REQ-PROG-BE-114`; hỗ trợ `SWR-REQ-PROG-CORE-113/116` | `WatchTab.tsx` phủ LOCAL/VP/MB_RTU và tách candidate/actual/source/priority/quality/freshness; signal đọc snapshot riêng qua `GET /api/v1/programming/runtime/signals`; `valid=false`, BAD/OFFLINE/UNAVAILABLE và mismatch không thành `0`; trace công bố số mẫu rơi | `WatchTab.test.tsx`; `runtime_test.go`; `router_test.go`; `test_program_ipc_server.cpp`; `test_st_signal_bus.cpp` | Source/unit/component HOST/LOCAL; chưa có binding vật lý, soak 10 phút/24 giờ hay Test Result U06/U11 |
| `T59-505` | `SYS-REQ-PROG-112/113`; `SWR-REQ-PROG-FE-116..118`; `SWR-REQ-PROG-BE-112..115`; `SWR-REQ-PROG-CORE-111/113/114/115` | `programming-real.spec.ts` không dùng Programming mock; `playwright.programming-real.config.ts` dựng backend JWT thật; `run_programming_real_e2e_stack.sh` chạy compiler/packager/BE thật và `mkddc-programming-core-sim` dùng scheduler/coordinator/cutover/process-image/IPC production; CI có job `programming-real-e2e` và chặn cả `page`/`context`/`browserContext.route*` | Vòng Project→Control Library→Draft có Signal/Binding→Seal→Check→Commission→Enable→Runtime/Signal→Disable→Revision mới→Restore; thêm ST+ PATCH exact năm field Draft v2, UI heading và GET Project read-back; `scripts/verify-project.sh --component e2e-real` 1/1 PASS | **HOST/LOCAL PASS**. Không phải target/HIL/physical I/O; monitor Point không có I/O thật phải fail-closed; chưa có Test Result/reviewer/GitHub CI run của commit cuối |
| `T59-506` | `SYS-REQ-PROG-109`; `SWR-REQ-PROG-FE-118`; legacy `SWR-REQ-PROG-FE-103/104`; hỗ trợ `SWR-REQ-PROG-BE-114` | `stEditorSupport.ts` giữ tối đa 50 snapshot; mọi edit/format qua history và khôi phục cursor; `StRuntimeValueOverlay.tsx` giữ zero thật nhưng không dựng zero cho invalid, gắn quality/freshness; `workspaceAdapters.ts` chỉ nối monitor khi Active Revision khớp và chỉ lấy interface POU typed từ Draft v2; `StructuredFbdEditor.tsx` dùng interface đó cho palette/pin và giữ shortcut native trong ô nhập | `SourceEditor.test.tsx` (20 undo/redo + cursor); `stEditorSupport.test.ts`; `StRuntimeValueOverlay.test.tsx`; `workspaceAdapters.test.ts`; `DesignWorkspacePage.test.tsx`; `StructuredFbdEditor.test.tsx`; `userPou.test.ts` | Source/component/browser HOST/LOCAL PASS trong FE 1161 test/E2E mock 61/61. Chưa phải usability người thật, target hay Test Result |

Ranh giới: bảng này ghi **evidence source** để review phạm vi W5. Chỉ khi source
được merge, gate current-pass có artifact và Test Result được reviewer ký mới
được nâng các trục tương ứng; job CI mới tồn tại trong YAML không đồng nghĩa CI
đã chạy thành công.

## 1. Quy tắc đọc

Chuỗi bắt buộc:

```text
Product/Requirement → Architecture/Design → Interface/Data/UI
→ Implementation owner → Scenario → Test Result → Release
```

`DOCUMENTED` chỉ nghĩa có link thiết kế/test; không nghĩa code tồn tại hoặc test
PASS. Không có Test Result mới cho suite v0.1, vì vậy evidence production vẫn
`MISSING/RED`.

## 2. Trace theo nhóm requirement

| Requirement | Design owner | Interface/data/UI | Implementation owner | Scenario | Evidence |
|---|---|---|---|---|---|
| `SYS-REQ-PROG-101` | ARCH §3/5; FWSOM §3 | IFSPEC §3/9; DM §3 | BE/Core/FE | VS-003/005/006/007/009/017 | MISSING |
| `SYS-REQ-PROG-102` | ARCH §4 | DM §3.1–3.2; UX §4 | BE/FE | VS-002/019/026 | MISSING |
| `SYS-REQ-PROG-103` | ARCH §4/7 | IFSPEC §6/8; DM §3.9 | BE/Core | VS-004/011 | MISSING |
| `SYS-REQ-PROG-104` | ARCH §8 | OPS §6/7 | BE/Core/Ops | VS-024/030 | MISSING |
| `SYS-REQ-PROG-105` | ARCH §6 | IFSPEC §6/9 | Core/Ops | VS-015 | MISSING |
| `SYS-REQ-PROG-106` | ARCH §9 | IFSPEC §2/3; DM §3.9 | BE/Security | VS-022/023 | MISSING |
| `SYS-REQ-PROG-107` | ARCH §10 | IFSPEC §3; DM §5; OPS §5 | BE/FE/Ops | VS-021/023 | MISSING |
| `SYS-REQ-PROG-108` | ARCH §3 | UX §9 | HMI/FE/QA | VS-028 | MISSING |
| `SWR-REQ-PROG-FE-101..102` | FE §2–3 | UX §3–4 | FE | VS-002/004/008/026/032 | MISSING |
| `SWR-REQ-PROG-FE-103..104` | FE §5 | UX §5 `PGM-02` tab Chương trình | FE/compiler | VS-005/006/028 | MISSING |
| `SWR-REQ-PROG-FE-105..106` | FE §6 | UX §5 `PGM-02` tab Điểm & Ánh xạ và Thực thi; IFSPEC §3 | FE/BE | VS-009/017/018 | MISSING |
| `SWR-REQ-PROG-FE-107..110` | FE §4/7/9 | UX §5 `PGM-03`/`PGM-04`; IFSPEC §6/7 | FE/BE/Core | VS-010/011/019/020/024/026 | MISSING |
| `SWR-REQ-PROG-FE-111..112` | FE §8 | UX §7–10 | FE/QA | VS-022/025/028 | MISSING |
| `SWR-REQ-PROG-FE-113..115` | FE §0.1; UX §5, §16.2–§16.3 | IFSPEC §6.1; UX §22–§24 | FE/BE | VS-011/017/019/022/031 | MISSING |
| `NFR-REQ-PROG-109..110` | UX §14.1; Product Spec §8 | UX §3, §5 | FE/UX/QA | VS-031 | MISSING |
| `SWR-REQ-PROG-BE-101..103` | BE §2–3 | DM §3; IFSPEC §3–5 | BE | VS-001/019/024 | MISSING |
| `SWR-REQ-PROG-BE-104..106` | BE §3–4 | IFSPEC §5–6/8 | BE/Core | VS-004/011/012/013/019 | MISSING |
| `SWR-REQ-PROG-BE-107..110` | BE §5–8 | IFSPEC §2/3/9 | BE/Security | VS-018/021/022/023/024 | MISSING |
| `SWR-REQ-PROG-CORE-101` | FWSOM §2/5 | IFSPEC §8/9 | Core/compiler | VS-005/006/023 | MISSING |
| `SWR-REQ-PROG-CORE-102..103` | FWSOM §4 | ARCH §5 | Core | VS-009/012/016 | MISSING |
| `SWR-REQ-PROG-CORE-104..106` | FWSOM §6–7 | DM §3.10 | Core/Controls | VS-010/014 | MISSING |
| `SWR-REQ-PROG-CORE-107..108` | FWSOM §4 | ARCH §5/8 | Core/Ops | VS-013/015 | MISSING |
| `SWR-REQ-PROG-CORE-109..110` | FWSOM §8–9 | DM §3.10/4 | Core/BE | VS-027/029 | MISSING |
| `FW-REQ-PROG-MCU-101..104` | FWMCU §1–7 | IOP contract; HW §2–5 | FW MCU/iobus | VS-014/030 | MISSING |
| `HW-REQ-PROG-101..103` | HW §2–5 | FWMCU §4–5 | HW/FW/QA | VS-014/030 | MISSING |
| `NFR-REQ-PROG-101..102` | BE §3; FWSOM §3/5 | IFSPEC §5 | Compiler/BE/Core | VS-006/019/023 | MISSING |
| `NFR-REQ-PROG-103` | ARCH §5; FWSOM §4 | OPS §2 | BE/Core/Ops | VS-009/012/013/015 | MISSING |
| `NFR-REQ-PROG-104` | FWSOM §9; FE §4 | IFSPEC §7 | Core/BE/FE | VS-027 | MISSING |
| `NFR-REQ-PROG-105..106` | ARCH §8/9; BE §4/7 | IFSPEC §1/6 | BE/Core/Security | VS-022/024/030 | MISSING |
| `NFR-REQ-PROG-107` | FE §8/10 | UX §8–10 | FE/QA | VS-025/028 | MISSING |
| `NFR-REQ-PROG-108` | ARCH §5/7; FWSOM §7 | FWMCU §4; HW §4–5 | Core/FW/HW/QA | VS-014/030 | MISSING |
| `SYS-REQ-PROG-109..115` | Unified DDD §4–§7; LANG/CTRL/LIFE | ART/IFSPEC/DM/UX | Compiler/BE/Core/FE | VS-U01..U11 | Current worktree; chưa merge; unified Test Result `NOT_RUN` |
| `SWR-REQ-PROG-FE-116..118` | Unified DDD §8; FE/UX | OpenAPI + runtime read model | FE/BE/Core | VS-U03/U06/U07/U10 | Current worktree; chưa merge; unified Test Result `NOT_RUN` |
| `SWR-REQ-PROG-BE-111..115` | Unified DDD §4–§6; BE/DM | OpenAPI/store/package/IPC | BE/compiler/Core | VS-U01/U03/U04/U06/U07/U10/U11 | Current worktree; chưa merge; unified Test Result `NOT_RUN` |
| `SWR-REQ-PROG-CORE-111..116` | Unified DDD §5.3/§7; FWSOM/ART | package v2/IPC/signal bus | Core/compiler | VS-U01/U02/U04..U11 | Current worktree; chưa merge; unified Test Result `NOT_RUN` |
| `NFR-REQ-PROG-111` | Unified DDD §11–§12; OPS | target soak fixture | Core/iobus/QA | VS-U05/U11 | `NOT_RUN`; cần đủ 24 h trên target MCU FAKE và raw evidence |

## 3. Product/UX proposal crosswalk

| Upstream proposal | Requirement phân bổ | Scenario |
|---|---|---|
| `PRG-BACS-001..005` | SYS-102/103/106/107; FE-101/102 | VS-001/002/004/008/019/021 |
| `PRG-IEC-001..005` | SYS-101; FE-103/104/106; CORE-101/102 | VS-003/005/006/007/009 |
| `PRG-RT-001..010` | SYS-103..105; CORE-102..109; NFR-103/108 | VS-009..016/030 |
| `PRG-PT-001..004` | SYS-101; FE-105; BE-109; CORE-104 | VS-017/018 |
| `PRG-COM-001..006` | SYS-102/103/107; FE-107/108; BE-103/105/106/108 | VS-011/019/020/021 |
| `PRG-SEC-001..005` | SYS-106; BE-102/107/108/110; CORE-101 | VS-022/023/024 |
| `PRG-UX-001..006` | FE-101/102/107/109/111/112 | VS-002/018/025/026/028 |
| `UX-REQ-001..024` | FE-101..112; SYS-108; BE/Core dependencies | VS-002..028 theo UX §6–10 |
| `NFR-PRG-PROP-001..010` | NFR-101..108 | VS-006/009/012/013/014/024/027/028/030 |

## 4. Baseline Product Capability

Các mapping `PC-PROG-001..012 → PR-PROG-001..014 → SYS/SWR/IF/NFR-REQ-PROG-*`
của phiên bản trước vẫn được bảo toàn qua SRS và bảng §2–3. Việc bổ sung design
không đổi bằng chứng production: `VR-PROG-001..013` vẫn `RED` cho tới khi
scenario tương ứng có Test Result được review.

## 5. Coverage và gate

- SRS v0.5 + unified: 15 system + 18 FE + 15 BE + 16 Core + 4 MCU + 3 HW +
  11 NFR = 82, tất cả có design owner, source target và scenario.
- Proposal: 7 nhóm `PRG-*`, 24 `UX-REQ-*`, 10 NFR proposal có crosswalk.
- Scenario: `VS-PROG-001..032` + `VS-PROG-U01..U12`, không trùng ID.
- Truy vết hai chiều: `44/44` kịch bản xuất hiện trong ít nhất một dòng §6 và
  mọi kịch bản dẫn ở §6 tồn tại trong `VVP-PROG-001`; lệnh §8.1 là gate máy.
- Test Result: `2/44` record (`VS-001/019` đều `BLOCKED`), `0/44 PASS`; 42
  scenario còn lại `NOT_RUN`.
- Release gate: **RED / NO-GO**.

## 6. Trace chi tiết từng requirement

Status dùng năm trục: `D` documented, `I` implemented, `T` tested, `P` passed,
`R` released. Hiện mọi dòng `D=YES`; 22 dòng baseline merged có `I=YES` (7 dòng
BE/Core + `FE-101..115`), 60 dòng còn lại `I=NO`; toàn bộ `T/P/R=NO` cho tới
khi có Test Result/release hợp lệ. Corrective source current-worktree không được
nâng `I` trước commit merge có file/symbol/build hash.
Source target là vị trí phải tạo/sửa, không phải claim code đã có.

Alias trong cột Requirement được chuẩn hóa như sau: `SYS-nnn` =
`SYS-REQ-PROG-nnn`; `FE/BE/CORE-nnn` = `SWR-REQ-PROG-FE/BE/CORE-nnn`;
`MCU-nnn` = `FW-REQ-PROG-MCU-nnn`; `HW-nnn` = `HW-REQ-PROG-nnn`; `NFR-nnn` =
`NFR-REQ-PROG-nnn`. Alias chỉ giúp bảng gọn; canonical ID trong SRS là authority.

| Requirement | Design/control + risk | Source target | Scenario | D/I/T/P/R |
|---|---|---|---|---|
| `SYS-101` | ARCH; LANG; CTRL; RSK-006/010 | `95585e7`: profile; `52dfb57`: FBD canonical + FE reducer/component; `4819901`: FBD→typed IR/equivalence; `2c2bfb4`: artifact manifest/source map ST/FBD; `e8c289e`: Check route/worker/artifact registry; Point/Task/runtime E2E còn thiếu | 003/005/006/007/009/017 | Y/N/N/N/N |
| `SYS-102` | DM; UX; FE; BE; RSK-007/008 | `66848a1`: Project/Draft/Revision; `e8c289e`: Check/Artifact; `95b9388`: SQLite v4 + source-only export/import Draft-only; `TR-PROG-019-20260811-001 BLOCKED`: UI và active-output integration còn thiếu | 002/019/026 | Y/N/N/N/N |
| `SYS-103` | LIFE; ART; IFSPEC; RSK-003/007 | `c2f3189` + `10d9ad6`: durable Commission/Restore, verified staging, journal/safe-boundary activation, authoritative read-back, first-output/LKG rollback và checkpoint recovery | 004/011 | Y/Y/N/N/N |
| `SYS-104` | ARCH; LIFE; OPS; RSK-002/005 | `51fe515`: Core IPC no-mutation skeleton; `e9707b4`: reconnect/no-replay client; Core runtime + service package còn thiếu | 024/030 | Y/N/N/N/N |
| `SYS-105` | CTRL; LIFE; RSK-001 | `10d9ad6`: `ProgrammingCutover` + ScanLoop safe-boundary khóa exclusive GRAPH_ONLY/PROGRAM_ONLY, rollback về graph/LKG; dual owner bị loại theo cấu trúc | 015 | Y/Y/N/N/N |
| `SYS-106` | SEC; BE; IFSPEC; RSK-012/015 | `66848a1` + `e8c289e` + `95b9388`: 11 route enforce role; `3e5281d`: duplicate/unknown fail-closed, 23 alias audit-secret reject và bundle audit no-source; full route matrix/re-auth/TLS target còn thiếu | 022/023 | Y/N/N/N/N |
| `SYS-107` | SEC; BE; OPS; RSK-011 | `95b9388`: source-only ZIP/import Draft-only; `3e5281d`: hostile corpus 25 lớp, path NFC/metadata/bounds và snapshot 8 bảng zero-mutation; UI replacement/target/independent evidence còn thiếu | 021/023 | Y/N/N/N/N |
| `SYS-108` | UX; FE; HMI boundary | Web routes + HMI route inspection | 028 | Y/N/N/N/N |
| `FE-101` | UX; FE | baseline route/redirect đã merge; corrective 508 trong cây làm việc bổ sung context Controller/Project/Draft dirty/Check/Active/Core và Project fallback qua reload; audit `REV-PROG-FE-UX-2026-08-13` | 002/028/032 | Y/Y/N/N/N |
| `FE-102` | UX; FE; LIFE; RSK-007 | `e58c745`+`ccdc408`: `RuntimeService.GetRuntime` (Go, không fabricate `producerState`/`safeState`) + `overview/OverviewPage.tsx` đọc Active/Draft/Core thật | 002/004/008/026 | Y/Y/N/N/N |
| `FE-103` | LANG; UX; FE | baseline `ProgramsTab`+`ProblemsDrawer`; corrective 508 thêm gutter line, line/column, Ctrl+F/Ctrl+S, format, symbol/type/reference và diagnostic range | 003/006 | Y/Y/N/N/N |
| `FE-104` | LANG; UX; FE | `52dfb57`: FBD model/validator/reducer (Task 201); `5f96d43`: mount thật vào `ProgramsTab` (không còn placeholder); `14a9299`: sửa mất focus bàn phím sau `DELETE_SELECTION`, Chrome/Playwright keyboard-only (Insert/Arrow/Enter/Delete/Ctrl+Z) PASS desktop+mobile | 005/006/028 | Y/Y/N/N/N |
| `FE-105` | CTRL; FE; IFSPEC; RSK-010 | `628cebe`: BE `GET /point-catalog` join `App.ReadPoints`; `5f96d43`: `design/mapping/MappingTab.tsx` + `PointPickerDialog` | 017/018 | Y/Y/N/N/N |
| `FE-106` | CTRL; FE | baseline `ExecutionTab` period/order; corrective 508 sửa false-dirty khi save Program cập nhật Task trong tab luôn mount, đồng thời giữ local edit nếu có | 009 | Y/Y/N/N/N |
| `FE-107` | LIFE; UX; FE; RSK-007 | baseline Check/Commission target ở `EV-PROG-P5-507`; corrective 508 thêm deep-link `revisionId/checkId` và readiness fail-closed theo impact/override/Core/safe-state. `EV-PROG-P5-510` xác nhận deep-link và safe-state chặn đúng trên target | 011/019/024/026 | Y/Y/N/N/N |
| `FE-108` | CTRL; UX; FE; RSK-004 | `0347efd`+`771efd9`: BE `GET /overrides` join `OverrideRegistry.Snapshot` + `runtime/RuntimeTab.tsx` | 010/020 | Y/Y/N/N/N |
| `FE-109` | IFSPEC; FE; BE; RSK-010 | corrective 509 nối Monitor/Trace thật, tách program/actual/owner/priority/TTL/quality/freshness và start/get/stop bounded; `EV-PROG-P5-510` target Monitor `200`/empty đúng fixture không binding, Trace invalid `400`; positive row/Trace target còn mở | 018/026/027 | Y/Y/N/N/N |
| `FE-110` | IFSPEC; FE; BE; RSK-008/014 | `4a1e9f5`: generated error catalog/client; `5f96d43`: `useDraftWorkspace` với `If-Match`, 409 giữ nguyên buffer đang gõ (Draft reducer/conflict flow nay đã có) | 024 | Y/Y/N/N/N |
| `FE-111` | UX; FE | Toàn bộ P5 dùng `pick()` VI/EN; Chrome/Playwright desktop+mobile xác nhận copy và responsive; `EV-PROG-P5-510` axe WCAG A/AA bốn workspace × hai viewport 8/8 scan, 0 violation; reviewer/Test Result độc lập còn thiếu | 025/028 | Y/Y/N/N/N |
| `FE-112` | UX; FE | `5f96d43`: `ProblemsDrawer` dùng `programmingErrorCopy(pick, code)`, không hiển thị `messageKey` thô | 019/028 | Y/Y/N/N/N |
| `FE-113` | UX §5 PGM-03; FE; LIFE; RSK-007 | `ca3e198`+`1961006`: `AcknowledgementChecklist` khớp đúng ba nhóm impact `PRESENT`; nhóm `retain` PRESENT dùng đúng câu UC-PROG-13 (sửa finding thật khi soát S5-E) | 011/019/031 | Y/Y/N/N/N |
| `FE-114` | UX §5 PGM-04, §22 DangerZone; SEC; RSK-012 | baseline DangerZone + role; corrective 508 sửa render chỉ trong tab Phiên bản & Bảo trì, không nằm dưới Runtime/Watch | 022/031 | Y/Y/N/N/N |
| `FE-115` | UX §5 PGM-02, §16.2; DM; IFSPEC | `628cebe`+`5f96d43`: `PointPickerDialog` lọc category/direction/writable + BE `GET /point-catalog` | 017/031 | Y/Y/N/N/N |
| `BE-101` | DM; BE | `66848a1` + `e8c289e` + `95b9388`: lifecycle SQLite v4, Project/Draft/Revision/Check/Artifact/change/bundle và restart host; `TR-PROG-001-20260811-001 BLOCKED`: target/E2E độc lập còn thiếu | 001/019 | Y/N/N/N/N |
| `BE-102` | DM; IFSPEC; BE; RSK-008 | `66848a1`: Draft ETag/CAS; `e8c289e`: Check receipt/lease; `95b9388`: bundle export/import receipt 24 giờ/replay/conflict; Core operation reconcile còn thiếu | 024 | Y/N/N/N/N |
| `BE-103` | LANG; BE; IFSPEC | `e8c289e`: Check application/HTTP/worker, compiler thật, diagnostic và Artifact terminal; mapping/target acceptance/independent `VS-019` còn thiếu | 003/006/019 | Y/N/N/N/N |
| `BE-104` | LANG; SEC; BE; RSK-005 | `e8c289e`: subprocess sandbox; `3e5281d`: timeout/SIGKILL-OOM/scratch cleanup/stdout/source one-over fail-closed và fuzz host; cgroup/priority/target load evidence còn thiếu | 006/012/013 | Y/N/N/N/N |
| `BE-105` | DM; BE | `66848a1`: immutable Revision; `e8c289e`: immutable Check/Artifact; `95b9388`: structured diff + safety impact + impactRef deterministic; Core override/cutover impact còn `UNAVAILABLE` và independent evidence thiếu | 019 | Y/N/N/N/N |
| `BE-106` | LIFE; IFSPEC; BE; RSK-007/008 | `c2f3189`: SQLite v5 operation/lease/generation, Commission/Restore worker, verified staging, timeout UNKNOWN, status-only reconcile và terminal CommissionRecord+audit atomic; `T59-005`: schema v6 thêm POU/library/signal/enable-intent, migration atomic 3/3 điểm lỗi, idempotent qua restart và không tự Commission | 004/011/024 | Y/Y/N/N/N |
| `BE-107` | SEC; BE; RSK-012 | `66848a1..95b9388`: authz handler+service/audit; `3e5281d`: 23 alias secret reject trước append và bundle audit no-source; full role/revocation/re-auth/CSRF/TLS matrix còn thiếu | 022 | Y/N/N/N/N |
| `BE-108` | SEC; BE; RSK-011 | `95b9388`: ZIP source-only/import atomic; `3e5281d`: hostile corpus 25 lớp, raw/entry/count/path NFC/mode/flags/comment/timestamp/extra bounds, 8-table zero-mutation và fuzz; target/independent evidence còn thiếu | 021/023 | Y/N/N/N/N |
| `BE-109` | CTRL; IFSPEC; BE; RSK-010 | Task 509 trong cây làm việc: `application/monitor.go`, `trace.go`, runtime HTTP + app Core/Point adapter; full host gate PASS và `EV-PROG-P5-510` target Monitor `200`; chờ merge mới đổi `I`, positive binding target còn mở | 018/020/026 | Y/N/N/N/N |
| `BE-110` | IFSPEC; BE; RSK-014 | OpenAPI/handler/generated TS + IPC nền; `4a1e9f5`: catalog; `95b9388`: OpenAPI v1.19, 11 handler, source bundle schema và G1 7/7 đồng bộ; `T59-001`: re-pin join lên OpenAPI v1.20/catalog 20-104/store head v5, validator lấy số từ pin thay vì literal và khoá chuỗi migration, self-test 12/12 + 6/6 đúng lý do reject; `T59-002`: profile v2 sinh C++/Go/TS từ một nguồn, `runner.go` bỏ profileId/profileSha256 chép tay; `T59-003`: registry POU/library thành contract G1 thứ 8, palette FE và allowlist Core cùng sinh từ registry; `T59-004`: catalog 26/118, guard detail hai chiều, schema catalog được thi hành; `T59-006`: catalog v1.7.0 **30/120** theo đúng bộ tên DDD §5.2, artifact v2 + dual-reader policy thành contract G1 (10 contract), guard action IPC hai chiều biến `TRACE_START` ma thành trạng thái khai báo có chủ, OpenAPI v1.22 | 019/024 | Y/Y/N/N/N |
| `CORE-101` | LANG; ART; SEC; RSK-006 | profile/serializer/loader + ST/FBD/common IR/manifest; `e8c289e`: worker verify artifact/manifest/hash và content-address read-back; `T59-003`: allowlist FBD sinh từ registry, gỡ 4 entry ma và mở SQRT + 4 conversion Core từng từ chối; `T59-101`: parser nhận `FUNCTION`/`FUNCTION_BLOCK` với AST chung, quy tắc kind/chữ ký ép bằng `ST-POU-001`; `T59-102`: `st_pou_registry` dựng symbol table/call graph xác định, phân giải library và chặn đệ quy bằng mã riêng cho từng cách sửa; `T59-103`: purity FUNCTION ép ở registry (chặn cả AST không qua parser), gọi FB/PROGRAM và sai số đối số bị từ chối, bảng chữ ký công bố cho lowering. `T59-104`: layout instance FB bất biến khi sắp xếp lại nguồn, identity theo đường dẫn canonical, vòng chứa và trần package 1024 bị chặn. `T59-105`: node FBD gọi user POU lower thành đúng cùng nút `USER_CALL` mà ST sinh, có test so trực tiếp hai bên; sai kind vẫn bị chặn ở lớp model. `T59-106`: container package v2 với writer/loader, golden do writer production sinh và ghim trong G1, fuzz lật từng byte 0 false-accept, dual-reader v1 giữ LKG cũ còn hiệu lực. Lắp nội dung package (`T59-305`), nạp prepared image (`T59-401`) và target evidence còn mở | 005/006/023 | Y/Y/N/N/N |
| `CORE-102` | CTRL; FWSOM; RSK-002 | `a831a0d`: ScanLoop gọi `on_base_step()` và Task 30 s dispatch riêng; `T59-002`: profile capacity chuyển từ 1/1/1 sang 3 lớp chu kỳ / 32 Program / 16 Enabled, scheduler nhận đúng trần và từ chối một-trên-trần; coherent process image/stage/atomic commit, due queue per-Program (`T59-402`) và production bootstrap còn thiếu | 009/015/016 | Y/N/N/N/N |
| `CORE-103` | ART; FWSOM; RSK-005/006 | `4f7e0ac`: prepare/preallocate ngoài scan, allocation counter activation/execute/LKG và post-link no-parser/compiler; full no-filesystem/DB/HTTP/DNS/blocking/dynamic-load + 10.000 cycle Forlinx còn thiếu | 012 | Y/N/N/N/N |
| `CORE-104` | CTRL; FWSOM; RSK-001/004 | process image/PriorityResolver | 010/014/020 | Y/N/N/N/N |
| `CORE-105` | CTRL; FWSOM; RSK-004 | PID library/runtime | 010/014 | Y/N/N/N/N |
| `CORE-106` | CTRL; LIFE; RSK-003/004 | `10d9ad6`: two-phase stage/commit/abort, safe-boundary swap, first output mới promote LKG/checkpoint; lỗi cycle đầu rollback prior LKG + graph trước khi báo ROLLED_BACK | 011/014 | Y/Y/N/N/N |
| `CORE-107` | CTRL; FWSOM; RSK-005 | Task fault/metrics | 013 | Y/N/N/N/N |
| `CORE-108` | CTRL; FWSOM; RSK-002 | `a831a0d`: base-step sequence + capability dải 500..2000 ms, systemd/comment runtime theo ADR-028; watchdog cadence/WCET `SCHED_FIFO` target và production wiring còn thiếu | 009/015 | Y/N/N/N/N |
| `CORE-109` | LIFE §8; FWSOM §8; ART §4.6; RSK-009 | `3ca5d22`: `st_retain.{hpp,cpp}` record v2/store/mailbox/service; `st_scheduler.*` restore/checkpoint; `st_process_image.cpp` output-commit boundary; `bootstrap/main.cpp` service lifecycle; `st_control_api.cpp` + schema status health | 029/030 | Y/Y/N/N/N |
| `CORE-110` | FWSOM; FE; IFSPEC | Task 509 trong cây làm việc: `PriorityResolver` read-only slot, `RuntimePointSnapshot` program/effective priority/task và `ScanLoop` publish end-scan; full host gate PASS, target Active/Task read-back theo `EV-PROG-P5-510`; chờ merge, fixture binding target còn mở | 027 | Y/N/N/N/N |
| `MCU-101` | FWMCU; ARCH | MCU app/IOP/BSP | 030 | Y/N/N/N/N |
| `MCU-102` | FWMCU; HW; RSK-003/013 | timeout/safe HAL | 014/030 | Y/N/N/N/N |
| `MCU-103` | FWMCU | IOP sequence/cache | 030 | Y/N/N/N/N |
| `MCU-104` | FWMCU; HW | AO config/actuation/read-back | 014/030 | Y/N/N/N/N |
| `HW-101` | HW; FWMCU; RSK-013 | schematic/BOM/test fixture | 014/030 | Y/N/N/N/N |
| `HW-102` | HW; CTRL; RSK-003/004 | AO/DO safe path | 010/014/030 | Y/N/N/N/N |
| `HW-103` | HW; FWMCU; RSK-002/013 | power/reset/watchdog domain | 015/030 | Y/N/N/N/N |
| `NFR-101` | LANG; ART; DM | profile/source/artifact bounds + FBD guard/equivalence/manifest; `e8c289e`: sandbox/artifact read-back; `3e5281d`: source/output/raw ZIP/entry/count one-over fail-closed và fuzz. Target OOM/capacity acceptance còn thiếu | 006/023 | Y/N/N/N/N |
| `NFR-102` | LANG; BE; RSK-005 | `e8c289e`: compiler sandbox/timeout; `3e5281d`: SIGKILL/OOM, cleanup và output/source bounds host; target benchmark/concurrent load acceptance còn thiếu | 006/013/019 | Y/N/N/N/N |
| `NFR-103` | CTRL; FWSOM; RSK-002/005 | `4f7e0ac`: runtime image/boundary instrumentation; `a831a0d`: Rev A cadence/base-step sequence, budget `<20%` và missed release host; load metrics/watchdog/IOP cùng target benchmark còn thiếu | 009/012/013/015 | Y/N/N/N/N |
| `NFR-104` | FWSOM; FE; IFSPEC | Task 509 trong cây làm việc: HTTP trace 1..32 variable, ≤10 phút, ≤4 running, ≤10.000 value-cell/session, ≤32 terminal; host positive/fault PASS, target invalid selector `400`; chờ merge và positive target có binding | 027 | Y/N/N/N/N |
| `NFR-105` | LIFE; FE; BE | `e9707b4`: reconnect + reconcile không replay mutation; target continuity/fault injection còn thiếu | 024/026/030 | Y/N/N/N/N |
| `NFR-106` | DM; SEC; BE; RSK-008/012 | `66848a1` + `e8c289e` + `95b9388`: transaction/ETag/receipt/lease/audit chain/role guard; `3e5281d`: hostile reject giữ 8 bảng bất biến và 23 audit alias reject; latency/full RBAC/target evidence còn thiếu | 022/024 | Y/N/N/N/N |
| `NFR-107` | UX; FE | i18n/a11y/responsive | 025/028 | Y/N/N/N/N |
| `NFR-108` | CTRL; FWSOM; MCU; HW; RSK-003 | `4f7e0ac`: O(1) handle/LKG swap host; IOP gap, MCU timeout, physical output và HIL còn thiếu | 014/030 | Y/N/N/N/N |
| `NFR-109` | UX §14.1; FE; Product Spec §8.1 | tám journey FE end-to-end | 031 | Y/N/N/N/N |
| `NFR-110` | Product Spec §8.3; UX; VVP | bảng điểm heuristic (kiểm tra thiết kế) | 025/031 | Y/N/N/N/N |
| `SYS-109` | Unified DDD §4–§6; LANG; ART; RSK-006/019 | Current worktree: parser/registry/lowering/package/runtime user POU; chờ commit merge + gate đầy đủ | U01/U02 | Y/N/N/N/N |
| `SYS-110` | Unified DDD §4–§6; BE; RSK-006/019/020 | Baseline W2 + current worktree: SYSTEM/PROJECT library, lock DAG và provenance; chờ corrective merge | U03/U12 | Y/N/N/N/N |
| `SYS-111` | Unified DDD §4.1/§7; FWSOM; RSK-002/017 | Baseline W3/W4: 32 Program/16 Enabled; target boundary và Test Result chưa chạy | U04/U05 | Y/N/N/N/N |
| `SYS-112` | Unified DDD §4.5/§7.3; CTRL; RSK-010/017/020 | Current worktree: signal source→IR `0x71/0x72`→section `0x0009`→bus; chưa merge | U05/U06/U10 | Y/N/N/N/N |
| `SYS-113` | Unified DDD §4.3/§5.1–§5.2/§7.2; LIFE; RSK-003/007 | Baseline lifecycle + current atomic whole-set corrective source; chưa có target evidence mới | U07/U08/U10 | Y/N/N/N/N |
| `SYS-114` | Unified DDD §4.6/§7/§9; CTRL; RSK-001/004 | Output ownership/candidate withdrawal source; physical AO/DO HIL deferred do MCU FAKE | U07/U09 | Y/N/N/N/N |
| `SYS-115` | Unified DDD §7/§11; FWSOM; RSK-002/017/018 | Target 10-Program/24 h soak chưa chạy đủ | U05/U11 | Y/N/N/N/N |
| `FE-116` | Unified DDD §8; FE/UX; RSK-016/020 | Current worktree: Library/POU/Published Signal authoring và read-back; chưa merge/browser gate | U03/U06/U10 | Y/N/N/N/N |
| `FE-117` | Unified DDD §8; FE/LIFE; RSK-003/016 | Baseline Enable/Disable UI + read-back; corrective source chưa merge | U07/U10 | Y/N/N/N/N |
| `FE-118` | Unified DDD §8; FE/IFSPEC; RSK-010/016 | Current worktree: Published Signal value/type/unit/quality/freshness/policy fail-closed; chưa merge | U06/U10 | Y/N/N/N/N |
| `BE-111` | Unified DDD §4–§6; BE/DM; RSK-006/019 | Baseline store v6+ có POU/library/signal/intent; current migration/library receipt chưa merge | U03 | Y/N/N/N/N |
| `BE-112` | Unified DDD §4–§6; BE/ART; RSK-006/010/020 | Current worktree: Check manifest khóa POU/library/signal/output/profile; chưa merge | U01/U02/U04/U06/U08/U09/U12 | Y/N/N/N/N |
| `BE-113` | Unified DDD §5.1–§5.2; BE/LIFE; RSK-007/008 | Library và Enable/Disable route có RBAC/idempotency/audit; chờ cohesive merge/read-back gate | U03/U07/U10 | Y/N/N/N/N |
| `BE-114` | Unified DDD §5.2/§7; BE/FWSOM; RSK-010/014 | Core `TRACE_READ`/signal snapshot là authority; current producer-consumer integration chưa merge | U06/U10/U11 | Y/N/N/N/N |
| `BE-115` | Unified DDD §4–§6; LANG/ART; RSK-006/014/019 | Current compiler/package CLI nhận POU/library/signal manifest và tạo package deterministic; chưa merge | U01/U04/U10 | Y/N/N/N/N |
| `CORE-111` | Unified DDD §5.3/§7; ART/FWSOM; RSK-003/006 | Current worktree: package v2 topology/POU/library/signal và dual-reader; chưa merge | U01/U02/U04/U08 | Y/N/N/N/N |
| `CORE-112` | Unified DDD §7; FWSOM; RSK-002/017 | Baseline per-Program scheduler/cap 16; target timing/soak chưa có | U04/U05/U11 | Y/N/N/N/N |
| `CORE-113` | Unified DDD §7.3; CTRL/FWSOM; RSK-010/017 | Current worktree: private FB state + signal double-buffer source execution; chưa merge | U02/U05/U06 | Y/N/N/N/N |
| `CORE-114` | Unified DDD §7.2; LIFE/FWSOM; RSK-001/004 | Baseline safe-boundary Enable/Disable/candidate withdrawal; physical output HIL deferred | U07/U09 | Y/N/N/N/N |
| `CORE-115` | Unified DDD §7.2/§12; LIFE/ART; RSK-003/022 | Current worktree: `StPreparedProgramSet`, `PREPARED` fsync rồi một handoff whole-set; chưa merge | U08 | Y/N/N/N/N |
| `CORE-116` | Unified DDD §5.3/§7; FWSOM/IFSPEC; RSK-014/017 | Core bounded trace ring/read path có source; target load/soak chưa có | U11 | Y/N/N/N/N |
| `NFR-111` | Unified DDD §11–§12; OPS; RSK-002/017/018 | `target_soak_10program.py` là fixture; 24 h MCU FAKE target + raw hash/reviewer chưa chạy | U05/U11 | Y/N/N/N/N |

Tên rút gọn map: `LANG=DDD-LANG-PROG-001`, `ART=IFSPEC-ART-PROG-001`,
`CTRL=DDD-CTRL-PROG-001`, `LIFE=DDD-LIFE-PROG-001`, `SEC=DDD-SEC-PROG-001`,
`FE/BE/FWSOM/FWMCU/HW/UX/DM/IFSPEC/ARCH/OPS` là ID trong Design Index. Scenario
`001` nghĩa `VS-PROG-001`.

## 7. Coverage, link integrity và evidence update rule

| Coverage | Current |
|---|---:|
| Requirement có design/control | 82/82 = 100% documented |
| Requirement có source target | 82/82 = 100% planned |
| Requirement có scenario | 82/82 = 100% specified |
| Requirement implemented end-to-end | 22/82 confirmed (`SYS-103`, `SYS-105`, `BE-106`, `BE-110`, `CORE-101`, `CORE-106`, `CORE-109`, `FE-101..115`); corrective worktree chưa nâng `I` |
| Scenario có Test Result record | 2/44 (`BLOCKED`); PASS 0/44 |
| Requirement passed/released | 0/82 |

Khi code merge, chỉ cột `I` được đổi và phải có commit/file/class/function. Khi
test chạy, thêm Test Result ID/hash rồi đổi `T`; chỉ reviewer ký PASS mới đổi `P`.
Release manifest/provenance và GO mới đổi `R`. Requirement/design/contract/source/
board change invalidates downstream Test Result theo VVP; không giữ `P` cũ.

Link checker phải xác nhận mọi path/anchor/ID; duplicate ID hoặc missing section
là finding P1. Bảng nhóm §2 vẫn dùng để đọc nhanh, bảng §6 là authority granularity.

## 8. Quy tắc cập nhật một dòng trace

| Trục | Bằng chứng cho phép đổi `N→Y` | Ai xác nhận | Điều kiện hạ lại `Y→N` |
|---|---|---|---|
| D | requirement + design section + risk/scenario link hợp lệ | Document Control + design owner | baseline/design đổi hoặc link đứt |
| I | commit merged, exact file/symbol, build/package hash | code owner + reviewer | revert/feature disabled/incompatible change |
| T | Test Result current đúng requirement/commit/target | executor + QA | result invalidated hoặc coverage thiếu |
| P | mọi acceptance PASS, no open blocking defect/waiver | independent reviewer | regression/finding/risk reopened |
| R | release manifest, rollout scope, GO authority | Release + Product + QA | rollback/withdraw/release revoked |

Update phải trong cùng change set với SRS/design/risk/VVP liên quan. Script/check
phải phát hiện canonical ID thiếu/trùng, scenario ngoài `001..032/U01..U12`, `P=Y` khi
`T=N`, `R=Y` khi `P=N`, evidence path thiếu và alias không giải được. Không sửa
chỉ số tổng bằng tay trước khi **cả 82 dòng** ở §6 được kiểm lại.

### 8.1 Lệnh kiểm truy vết hai chiều

Lệnh dưới đây giải alias của §6 về ID canonical trong SRS và đối chiếu toàn bộ
32 scenario legacy + 12 scenario unified với `VVP-PROG-001`:

```bash
python3 scripts/trace_bidirectional_check.py
```

Acceptance: `dòng §6=82`, `requirement SRS=82`, `alias giải được=82`, `kịch bản
VVP=44`, `kịch bản được §6 phủ=44`, exit `0`. `docs_iso_harness.py --expect`
phải đồng thời báo `trace_rows=82`, `trace_violations=0`. Hai lệnh chỉ chứng minh
tính nhất quán hồ sơ, không đổi trạng thái formal `T/P/R`.

## 9. Blocker, revision và phê duyệt

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| 12 quyết định unified CLOSED; baseline ADR-050 approved | Product + discipline authority + Document Control | Không còn blocker quyền implementation trong baseline đã pin; không áp dụng tự động cho PGM-02 v2.2 |
| `CR-PROG-PGM02-V22-001` Owner approved, Architect pending | Product Owner + System Architect + Document Control | Hoàn tất `T59-801`; pin Product/SRS/Architecture/DDD/UX/contracts/Risk/Trace/VVP/Plan59 rồi mới thêm task code R1/R2/R3 |
| `F-P59-GHOST-POU-001` OPEN | Product Owner + Architect + Compiler/BE/Core | Chọn fail Check hay loại POU chưa xếp lịch khỏi package; đồng bộ semantics và chạy affected gate |
| Source Target chưa implement end-to-end | Dev Leads | commit/build mapping per requirement |
| Test Result PASS 0/44; 2 record `BLOCKED`, 42 `NOT_RUN` | QA + discipline leads | hoàn tất workflow E2E, rerun và independent review theo VVP |
| Corrective source 508/509 chưa merge | Dev Leads | commit/PR/merge thật để nâng `I`; target supporting evidence đã có nhưng không nâng `T/P/R` |
| W5 `T59-503..506` đang ở cây làm việc, chưa merge | FE/BE/Core Dev Leads + QA | các cổng HOST thành phần current-worktree đã PASS; cần commit/push/CI rồi mới review Test Result `VS-PROG-U06/U07/U08/U10/U11`. Job CI mới khai báo không được dùng như kết quả CI |
| CI không có ngân sách | Product Owner | `WAIVED/DEFERRED BY OWNER` cho đóng implementation; không phải CI PASS và không mở `RELEASE_READY` |
| MCU/FW/HIL vật lý chưa có; lab dùng MCU FAKE | Product Owner + HW/FW + QA | defer physical I/O/power HIL; không đổi scenario U09/U12 sang PASS |
| Soak 24 h MCU FAKE chưa PASS | QA + Core/iobus | chạy đủ 24 h, giữ raw JSONL/hash/commit/config và reviewer; thuộc U05/U11 |
| Positive Monitor/Trace target có binding và review độc lập | QA + FE/BE/Core + Accessibility Reviewer | fixture read-only an toàn, raw output start/get/stop + row truth; review axe/bundle và ký Test Result theo VVP |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 6.7 | 2026-08-24 | Thêm §13 pre-baseline crosswalk namespaced `PGM02-V22-WP-00..13`; chỉ `T59-801` READY, không tạo requirement/scenario hay đổi `D/I/T/P/R`. Ghi Owner approved change request, Architect pin/code R1/R2/R3 PENDING/NO-GO và tách `F-P59-GHOST-POU-001` OPEN. |
| 6.6 | 2026-08-24 | Đồng bộ metadata/crosswalk corrective sau self-review và target deploy: thêm rollback DB vào evidence CORE; giữ 82/82 requirement, 44/44 scenario và mọi formal `T/P/R` không đổi. |
| 6.5 | 2026-08-24 | Thêm 22 dòng unified vào §6 để đủ 82/82 requirement; mở checker cho `VS-PROG-U01..U12`; cập nhật coverage 44/44 scenario. Giữ corrective source current-worktree ở `I=N`, formal `T/P/R=N`, 0/44 PASS; ghi CI `WAIVED/DEFERRED BY OWNER`, MCU vật lý/HIL deferred và soak MCU FAKE 24 h chưa PASS |
| 6.4 | 2026-08-21 | Ghi evidence source W5 `T59-503..506`: sáu workspace/lifecycle; Monitor Point + Published Signal fail-closed; ST history/runtime overlay và FBD POU typed; lane real-backend Project→Restore không dùng Programming mock; ST+ gửi đúng payload Draft v2 strict và có API read-back. Ghi số đo HOST/LOCAL current-worktree đã PASS nhưng giữ nguyên 22/60 `I=Y`, 0/32 PASS và mọi `T/P/R`; không claim GitHub CI/target/HIL/release. Ghi đúng finding join hai chiều: script hiện chỉ hiểu 60/32 legacy và FAIL trước 22/12 unified; owner/gate/điều kiện mở ở §8.1 |
| 2.0 | 2026-08-09 | Trace nhóm SRS/proposal tới 30 scenario, evidence RED |
| 2.1 | 2026-08-09 | Thêm 55 dòng requirement-level, 5 design lõi, source target, D/I/T/P/R và evidence rule M3 |
| 2.2 | 2026-08-09 | Bổ sung canonical requirement alias, bằng chứng/authority cho từng trục D/I/T/P/R và rule inconsistency/invalidation; chuyển Detailed Draft chờ review |
| 2.3 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại Traceability; ghi kết quả kiểm máy 0 vi phạm |
| 2.4 | 2026-08-09 | Amendment A1: thêm 5 dòng requirement (`FE-113/114/115`, `NFR-109/110`) nâng tổng lên 60; thêm §10 trace tám journey `UJ-PROG-*` và bảng trạng thái migration 17 `UC-PROG-*`; cập nhật scenario lên 32 |
| 2.5 | 2026-08-10 | Đóng finding consumer review `F-CR-03/07/08`: bổ sung `VS-PROG-032` vào dòng `FE-101` và `VS-PROG-008` vào dòng `FE-102` để chiều xuôi requirement→scenario đủ `32/32`; thêm §8.1 lệnh kiểm hai chiều `scripts/trace_bidirectional_check.py`; sửa số đếm cũ `55 dòng` thành `60 dòng`; đổi phụ lục tự kiểm từ `§10` trùng số sang `§11` |
| 2.6 | 2026-08-10 | Ghi trạng thái authority sau `AUTH-PROG-2026-08-10-01`: `OD-PROG-003/010/013` DECIDED, 14 mục còn OPEN, 0 CLOSED; Product/Architect `ACCEPT` không đổi các trục `I/T/P/R` và không thay Verification/Document Control approval |
| 2.7 | 2026-08-11 | Ghi `AUTH-PROG-2026-08-11-03`: 17/17 decision `DECIDED`, baseline phê duyệt cho implementation, Verification/Document Control/discipline signature `WAIVED FOR IMPLEMENTATION`; giữ trung thực `I/T/P/R=N` và 0/32 Test Result cho tới khi có code/evidence |
| 2.8 | 2026-08-11 | `TASK-PROG-100` hoàn tất source contract: nâng riêng `BE-110` thành `I=Y` với commit/file/symbol và golden payload Go/TS; `FE-110` và `NFR-106` vẫn `I=N` vì Draft reducer, concurrency transaction và audit chưa thuộc lát cắt này. Không tạo Test Result; `T/P/R` giữ `N`, release giữ RED |
| 2.9 | 2026-08-11 | `TASK-PROG-101` hoàn tất IPC v1: bổ sung source commit cho `BE-110`; ghi phần đã có của `SYS-104`, `BE-106`, `NFR-105` nhưng giữ `I=N` vì chưa có operation worker/durable transaction/Core runtime package/target fault injection. Không tạo Test Result; tổng `I=Y` giữ 1/60 và mọi `T/P/R=N` |
| 3.0 | 2026-08-11 | `TASK-PROG-102` hoàn tất profile/artifact/loader foundation: nâng `CORE-101 I=Y` theo commit `95585e7`; ghi partial cho `SYS-101/NFR-101` nhưng giữ `I=N` vì FBD/type target/BE/FE/Check/target acceptance còn thiếu. Không tạo Test Result; tổng `I=Y` thành 2/60 và mọi `T/P/R=N` |
| 3.1 | 2026-08-11 | `TASK-PROG-103` hoàn tất catalog lỗi ba lớp tại `4a1e9f5`: bổ sung source cho `BE-110`, ghi partial `SYS-103/105` và `FE-110` nhưng giữ `I=N` vì lifecycle/ScanLoop/Draft reducer chưa có. Tổng `I=Y` giữ 2/60; không tạo Test Result và mọi `T/P/R=N` |
| 3.2 | 2026-08-11 | `TASK-PROG-104` hoàn tất source store tại `312f357`: ghi partial cho SYS-102/106, BE-101/102/106 và NFR-106 nhưng giữ `I=N` vì chưa wiring/service/compiler/terminal operation/target. Tổng `I=Y` giữ 2/60; 0/32 Test Result và mọi `T/P/R=N` |
| 3.3 | 2026-08-11 | `TASK-PROG-105` khóa join sáu contract/deploy/rollback tại `30a068b`; tạo hai record `VS-001/019` verdict `BLOCKED` để ghi đúng phần E2E còn thiếu. Tổng `I=Y` giữ 2/60, 0/32 PASS và mọi `T/P/R=N` |
| 3.4 | 2026-08-11 | `TASK-PROG-200` hoàn tất ST subset/type/source map host tại `8d58efa` + `a638470`; bổ sung source cho `CORE-101` và partial `NFR-101`. Tổng `I=Y` giữ 2/60 vì FBD/worker/target E2E còn thiếu; không tạo Test Result, 0/32 PASS và mọi `T/P/R=N` |
| 3.5 | 2026-08-11 | `TASK-PROG-201` hoàn tất FBD canonical producer/validator + FE keyboard component tại `52dfb57`; bổ sung source partial cho SYS-101/FE-104/NFR-101 và source FBD cho CORE-101. Tổng `I=Y` giữ 2/60 vì lowering/route/API/target E2E còn thiếu; không tạo Test Result, 0/32 PASS và mọi `T/P/R=N` |
| 3.6 | 2026-08-11 | `TASK-PROG-202` hoàn tất FBD→common typed IR/equivalence tại `4819901`; bổ sung source cho CORE-101 và partial SYS-101/NFR-101. Tổng `I=Y` giữ 2/60 vì artifact source-map/worker/route/target E2E còn thiếu; không tạo Test Result, 0/32 PASS và mọi `T/P/R=N` |
| 3.7 | 2026-08-11 | `TASK-PROG-203` hoàn tất artifact/manifest/hash/profile/source map ST/FBD tại `2c2bfb4`; bổ sung source cho CORE-101 và partial SYS-101/NFR-101. Tổng `I=Y` giữ 2/60 vì worker/route/target E2E còn thiếu; không tạo Test Result, 0/32 PASS và mọi `T/P/R=N` |
| 3.8 | 2026-08-11 | `TASK-PROG-204` hoàn tất sáu API Project/Draft/Revision + SQLite v2 tại `66848a1`; bổ sung source partial cho SYS-102/106, BE-101/102/105 và NFR-106 nhưng giữ `I=N` vì Check/import-export/operation/target E2E còn thiếu. Tổng `I=Y` giữ 2/60; hai record BLOCKED, 0/32 PASS và mọi `T/P/R=N` |
| 3.9 | 2026-08-11 | `TASK-PROG-205` hoàn tất hai API Check + SQLite v3/lease/retry/compiler sandbox/Artifact registry tại `e8c289e`; bổ sung source partial cho SYS-101/102/106, BE-101..105, NFR-101/102/106 và treatment RSK-005/006/007/008/014 nhưng giữ `I=N` vì bundle/operation/Core/target E2E còn thiếu. Tổng `I=Y` giữ 2/60; hai record BLOCKED, 0/32 PASS và mọi `T/P/R=N` |
| 3.10 | 2026-08-11 | `TASK-PROG-206` hoàn tất change manifest + hai API bundle source-only + SQLite v4 tại `95b9388`; bổ sung source partial cho SYS-102/106/107, BE-101/102/105/108/110, NFR-106 và treatment RSK-007/008/011/014 nhưng giữ `I=N` vì hostile corpus Task 207, UI/operation/Core/target E2E còn thiếu. Tổng `I=Y` giữ 2/60; hai record BLOCKED, 0/32 PASS và mọi `T/P/R=N` |
| 3.11 | 2026-08-11 | `TASK-PROG-207` hoàn tất compiler/bundle/audit assurance tại `3e5281d`: hostile corpus 25 lớp/zero-mutation 8 bảng, 23 audit alias, timeout/OOM/output/source bounds và fuzz; bổ sung source partial cho SYS-106/107, BE-104/107/108, NFR-101/102/106 và treatment RSK-005/006/011/012/014. P2 8/8 source/DoD nhưng tổng `I=Y` giữ 2/60 vì full RBAC, operation/Core/target E2E còn thiếu; hai record BLOCKED, 0/32 PASS, mọi `T/P/R=N` |
| 3.12 | 2026-08-11 | `TASK-PROG-300` hoàn tất prepared runtime boundary tại `4f7e0ac`: bổ sung source partial cho CORE-103/106 và NFR-103/108, treatment RSK-003/006; targeted 84/84 và CTest 933/933 host PASS. Tổng `I=Y` giữ 2/60 vì CORE-103 còn full no-blocking/10.000 cycle Forlinx, operation/production/target E2E còn thiếu; hai record BLOCKED, 0/32 PASS, mọi `T/P/R=N` |
| 3.13 | 2026-08-11 | `TASK-PROG-301` hoàn tất profile/base-step scheduler tại `a831a0d`: bổ sung source partial CORE-102/108, NFR-103 và treatment RSK-002; targeted 74/74, CTest 936/936 host PASS. Tổng `I=Y` giữ 2/60 vì process image/bootstrap/production và 10.000 cycle `SCHED_FIFO` Forlinx còn thiếu; hai record BLOCKED, 0/32 PASS, mọi `T/P/R=N` |
| 3.14 | 2026-08-13 | `TASK-PROG-402` hoàn tất `CORE-109 I=Y` tại `3ca5d22`: RETAIN stable identity/layout/version/full CRC, typed+FB codec, async atomic write, output-commit checkpoint, cold-init/status và scheduler/bootstrap wiring. Tổng `I=Y` thành 3/60; không tạo Test Result, `VS-PROG-029/030` Forlinx/HIL vẫn NOT RUN, 0/32 PASS và mọi `T/P/R=N`. |
| 3.15 | 2026-08-13 | `TASK-PROG-403..405` tại `c2f3189` + `10d9ad6` hoàn tất source `SYS-103`, `SYS-105`, `BE-106`, `CORE-106`: durable Commission/Restore/reconcile, exclusive safe-boundary owner, first-output/LKG rollback và checkpoint recovery. Tổng `I=Y` thành 7/60; không tạo Test Result, target/HIL/power-cut vẫn NOT RUN, 0/32 PASS và mọi `T/P/R=N`. |
| 3.16 | 2026-08-13 | `TASK-PROG-500..506` tại `e58c745`..`14a9299` hoàn tất source **toàn bộ `FE-101..115`** (15/15): bốn workspace nối BE thật, Draft ETag/conflict, Check/Commission/Restore reconcile, error catalog, acknowledgement/impact, DangerZone, point-catalog filter; Chrome/Playwright thật desktop+mobile PASS `UJ-PROG-01..08` (`EV-PROG-P5-500-506`, VVP §11.5). §10.1 Evidence đổi từ `MISSING` sang trích dẫn evidence host+browser cho cả 8 journey, giữ rõ phần vẫn `MISSING` (`VS-PROG-031` usability người thật và các trục cần target/HIL). Tổng `I=Y` thành **22/60**; không tạo Test Result nào, 0/32 PASS và mọi `T/P/R=N` — bằng chứng browser không tự nâng `T`. |
| 3.17 | 2026-08-13 | `TASK-PROG-507` tại `9606906`+`6069de6`+`d9a8e3b`: thêm `EV-PROG-P5-507` cho cleanup/backup/deploy web ARM64 và Chrome/API thật trên Foxlinx. Cập nhật FE-107 và journey 01/02/04/05 theo Project/Draft persistence, Revision `201`, Check `202`, WS `101`; ba lỗi target đã sửa. Không Commission; Check terminal fail-closed vì thiếu compiler, Core Programming/HIL/reviewer độc lập còn thiếu. Tổng `I=Y` giữ 22/60, mọi `T/P/R=N`, 0/32 PASS; supporting target evidence không tự nâng `T`. |
| 3.18 | 2026-08-13 | Hoàn tất target `TASK-PROG-507` tại `0f1526c`: deploy FE/Web/compiler/Core ARM64, bật cờ production, hai Check `PASSED`, Commission output-free `SUCCEEDED/COMMITTED`, Core read-back Active/LKG/Task `RUNNING`. Cập nhật FE-107 và journey 01/02/04/05/06/07; tổng `I=Y` giữ 22/60, mọi `T/P/R=N`, 0/32 PASS vì supporting target evidence không tự thay Test Result độc lập/HIL. |
| 3.19 | 2026-08-13 | Audit `REV-PROG-FE-UX-2026-08-13` sửa overclaim P5 và mở 508..510. Cập nhật FE-101/103/106/107/109/114 theo context/editor/dirty/deep-link/readiness/Watch/Trace/Danger Zone; ghi source cụ thể cho BE-109/CORE-110/NFR-104. Vì corrective source chưa merge, tổng `I=Y` **giữ 22/60** đúng §8; target mới NOT_RUN, mọi `T/P/R=N`, 0/32 PASS. |
| 3.20 | 2026-08-13 | Ghi `EV-PROG-P5-510`: full gate host và deploy/read-back/rollback Foxlinx PASS; Runtime/Monitor/safe-state target đúng, Chrome desktop/mobile sạch, axe 8/8 scan không violation. Cập nhật FE-107/109/111, BE-109, CORE-110, NFR-104 và tám journey. Vì source chưa merge và evidence chưa có reviewer/Test Result độc lập, tổng `I=Y` giữ 22/60, mọi `T/P/R=N`, 0/32 PASS. |
| 3.21 | 2026-08-13 | Nối `EV-PROG-P5-510` rev 1.1 và audit rev 1.3 vào FE-101/103/107/111/114/115 cùng journey 01/02/04/07/08: HTTP không có Web Crypto vẫn hoạt động, auth giữ query/hash, ST save/restore, export `200`, import fault `422`, Restore/RETAIN fail-closed, mobile không tràn và axe 6/6 scan sạch. Đây vẫn là supporting evidence do implementer chạy; source chưa merge nên `I=Y` giữ 22/60, mọi `T/P/R=N`, 0/32 PASS. |
| 3.22 | 2026-08-15 | CTO/Owner approval §1: thêm §12 cross-reference Master Plan 56 (`56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md`, `WP-01..13` + `WP-MULTIPROGRAM-ARCH`) — bảng Requirement→Design→Source/PR→Test→Evidence→Status riêng, tách khỏi 60 dòng canonical §6 (WP-XX không dùng ID `SYS/SWR-REQ-PROG-*` hay `VS-PROG-0xx`, không đổi đếm/invariant §5/§8.1 của matrix gốc). Không đổi `I/T/P/R` của 60 dòng §6. |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Verification + Document Control + discipline leads | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm và evidence theo task |
| Verification Lead + Document Control | **WAIVED FOR IMPLEMENTATION** | không chặn cập nhật trục `I`; Test Result vẫn cần evidence thật |

## 10. Trace lớp user journey và migration 17 use case

Chuỗi đầy đủ sau Amendment A1:

```text
Product Requirement → UJ-PROG-* → Requirement (SRS) → Design/UI → Source target
→ Scenario (VS-PROG-*) → Test Result → Release
```

### 10.1 Tám journey

| Journey | Workspace | Requirement chính | Design | Scenario | Evidence |
|---|---|---|---|---|---|
| `UJ-PROG-01` | `PGM-01` | SYS-108; FE-101/102/109 | UX §3, §5, §16.1; FE §2 | VS-001/002/026/031 | `EV-PROG-P5-500-506/507/510`: target route/context/Active/Task, responsive và axe; reviewer/usability vẫn MISSING |
| `UJ-PROG-02` | `PGM-02` tab Chương trình | FE-101/103/104; CORE-101 | UX §5, §16.2; LANG §4–§5 | VS-003/005/006/007/031 | `EV-PROG-P5-500-506/507/510`: Draft/ST/editor context desktop/mobile; `VS-PROG-031` MISSING |
| `UJ-PROG-03` | `PGM-02` tab Điểm & Ánh xạ | FE-105/115; BE-109 | UX §16.2; DM §3.5 | VS-017/018/031 | `EV-PROG-P5-500-506/510`; positive target có Variable Binding và `VS-PROG-031` MISSING |
| `UJ-PROG-04` | `PGM-02` tab Thực thi | FE-106; CORE-102/108 | UX §5; CTRL §3 | VS-009/016/031 | `EV-PROG-P5-500-506/507/510`: false-dirty regression và Task target `RUNNING`; timing/HIL/usability MISSING |
| `UJ-PROG-05` | `PGM-03` giai đoạn Kiểm tra | FE-107/112; BE-103/104/105 | UX §5, §16.3; BE §3 | VS-006/019/031 | `EV-PROG-P5-500-506/507/510`: Check baseline, corrective deep-link/readiness target; reviewer/usability MISSING |
| `UJ-PROG-06` | `PGM-03` giai đoạn Vận hành | SYS-103; FE-107/113; BE-106; CORE-106 | UX §16.3; LIFE §5–§7 | VS-004/011/014/015/020/029/031 | `EV-PROG-P5-500-506/507/510`: Commission output-free baseline và corrective safe-state fail-closed; output vật lý/HIL/người thật MISSING |
| `UJ-PROG-07` | `PGM-04` Runtime, Theo dõi | FE-108/109; BE-109; CORE-110 | UX §16.4; FWSOM §9 | VS-010/013/018/027/031 | `EV-PROG-P5-500-506/507/510`: Active/Task/Monitor `200` target; positive binding/Trace, soak/timing/người thật MISSING |
| `UJ-PROG-08` | `PGM-04` Phiên bản & Bảo trì | SYS-107; FE-114; BE-108; CORE-109 | UX §16.4; LIFE §8–§9; SEC §8 | VS-011/021/023/029/031 | `EV-PROG-P5-500-506/510`: Restore E2E và Danger Zone đúng tab; security corpus review/power/usability MISSING |

Bốn requirement mới của Amendment A1 gắn journey như sau: `FE-113` → `UJ-PROG-06`;
`FE-114` → `UJ-PROG-08`; `FE-115` → `UJ-PROG-03`; `NFR-109` và `NFR-110` phủ cả
tám journey qua `VS-PROG-031`. `VS-PROG-032` phủ chuyển hướng route của `FE-101`.

### 10.2 Trạng thái 17 use case sau migration

Không ID nào bị xóa. Đặc tả chi tiết vẫn ở
[UX §17](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md); bảng dưới đây là trace.

| UC | Trạng thái | Thuộc về | Scenario giữ nguyên |
|---|---|---|---|
| `UC-PROG-01` | MERGED | `UJ-PROG-01` | VS-001/026 |
| `UC-PROG-02` | MERGED | `UJ-PROG-02` | VS-008 |
| `UC-PROG-03` | MERGED | `UJ-PROG-02` | VS-005/006 |
| `UC-PROG-04` | MERGED | `UJ-PROG-02` | VS-005/006/028 |
| `UC-PROG-05` | MERGED | `UJ-PROG-03` | VS-017/018 |
| `UC-PROG-06` | MERGED | `UJ-PROG-05` | VS-006/019 |
| `UC-PROG-07` | MERGED | `UJ-PROG-04` | VS-009 |
| `UC-PROG-08` | MERGED | `UJ-PROG-06` | VS-011/015/019/029 |
| `UC-PROG-09` | SCENARIO `SC-OP-FAILED` | `UJ-PROG-05`, `UJ-PROG-06` | VS-011/019 |
| `UC-PROG-10` | SCENARIO `SC-CORE-DEGRADED` | mọi journey | VS-026/030 |
| `UC-PROG-11` | MERGED | `UJ-PROG-08` | VS-011 |
| `UC-PROG-12` | MERGED | `UJ-PROG-07` | VS-013/014/027 |
| `UC-PROG-13` | SCENARIO `SC-RETAIN-RESET` | `UJ-PROG-06`, `UJ-PROG-08` | VS-015/029 |
| `UC-PROG-14` | ROADMAP | ngoài Rev A, gắn `OD-PROG-017` | VS-003 (kiểm không có đường vào) |
| `UC-PROG-15` | ROADMAP | ngoài Rev A | VS-025 (kiểm không hứa hẹn) |
| `UC-PROG-16` | MERGED | `UJ-PROG-07` | VS-013/027 |
| `UC-PROG-17` | MERGED | `UJ-PROG-08` | VS-021/023 |

Kiểm đếm: 12 `MERGED` + 3 `SCENARIO` + 2 `ROADMAP` = 17. **Không** scenario nào
bị mất trong quá trình gộp: mọi `VS-PROG-*` từng gắn với một UC vẫn còn được gắn
qua journey hoặc qua kịch bản xuyên suốt tương ứng.

## 11. Phụ lục — Tự kiểm cổng M3 (loại: Traceability)

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Mọi link trỏ tới ID hoặc mục có thật | PASS | harness: local link missing `0`, anchor missing `0`; §6 alias giải được về ID canonical trong SRS |
| Không trùng ID | PASS | 82 dòng requirement duy nhất; 8 `UJ-PROG-*`; 17 `UC-PROG-*`; harness `duplicate doc ID = 0` |
| Phân biệt planned/documented/implemented/tested/passed/released | PASS | §6 năm trục `D/I/T/P/R`; §1 nêu rõ `DOCUMENTED` **không** nghĩa code tồn tại |
| Coverage requirement | PASS | §6/§7 có 82/82 requirement và 44/44 scenario; §10 phủ 8 journey và 17 UC |
| Bằng chứng cho phép đổi trạng thái | PASS | §8 quy định cho từng trục: ai xác nhận và điều kiện hạ ngược `Y→N` |
| Quy tắc vô hiệu hóa | PASS | §7 và §8: đổi requirement/design/contract/source/board làm mất hiệu lực Test Result phía dưới; không giữ `P` cũ |
| Kiểm tính nhất quán tự động | PASS khi rerun cùng change set | §8.1 khóa acceptance 82/82 requirement, 44/44 scenario và harness 82 trace rows; không thay Test Result |
| Trạng thái bằng chứng trung thực | PASS | §5 và §7: 2/44 record `BLOCKED`, 42 `NOT_RUN`, 0/44 PASS, 0/82 released; release gate `RED / NO-GO` |
| Quyền implementation | **PASS có phạm vi** | §9: baseline ADR-050 approved; riêng PGM-02 v2.2 chỉ `T59-801` READY và code R1/R2/R3 NO-GO tới khi Architect pin baseline |

Ma trận này theo dõi trạng thái; nó **không** tạo ra bằng chứng.

## 12. Cross-reference lịch sử — Master Plan 56 Work Package

Master Plan 56 và các WP dưới đây đã `Superseded`; giữ bảng để truy nguyên commit
cũ. Product Target và mọi công việc tương lai dùng crosswalk Plan59 ở §13.

Master Plan 56 ([`56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md`](../03_implementation/56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md))
là một effort triển khai tiếp nối, phát sinh sau khi matrix này đã
`APPROVED FOR IMPLEMENTATION` ở rev 3.21. Các Work Package `WP-XX` của nó
**không** dùng ID `SYS-REQ-PROG-*`/`SWR-REQ-PROG-*` hay kịch bản
`VS-PROG-0xx` — bảng dưới đây là cross-reference độc lập, không đổi 60 dòng
canonical §6, không đổi đếm `22/60 I=Y`/`0/32 PASS`, không kích hoạt lại
`scripts/trace_bidirectional_check.py` (script đó chỉ kiểm §6/VVP, không
biết về `WP-XX`). Theo dõi chi tiết/số đo thật nằm ở
[`PROGRAMMING_IMPLEMENTATION_TRACKER.md`](../03_implementation/PROGRAMMING_IMPLEMENTATION_TRACKER.md)
— bảng này chỉ là điểm nối để không mồ côi.

| WP | Requirement gốc | Design | Source/PR | Test | Evidence | Status |
|---|---|---|---|---|---|---|
| WP-01 Overview State Model | Gap report `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15` §5.2; gần nhất với `SWR-REQ-PROG-FE-113..115` (UX §16.2–16.3) | Master Plan 56 §4 | PR #175 (`733e1cb`) + PR mới Sprint A (Go test) | `TestGetLatestCheckForRevision` (store), `TestGetProjectReflectsTerminalPassedCheckAndPropagatesRealErrors` (application), 4 test FE `OverviewPage.test.tsx` | `go test ./... -count=1` PASS toàn module; Vitest PASS | `DONE` |
| WP-02 Unsupported POU Guard | Gap report §7.4 | Master Plan 56 §4 | PR #175 (`75a9127`) + PR mới Sprint A (test) | 2 test hồi quy `DesignWorkspacePage.test.tsx` | Vitest 611/611 PASS | `DONE` |
| WP-03 FBD Registry Alignment | Gap report §8.4 | Master Plan 56 §4 | PR #175 (`75a9127`) | Vitest FBD suite | PASS | `DONE` |
| WP-04 Language Documentation Alignment | D-06 | Master Plan 56 §4 (chính tài liệu) | PR #175 (`f943a94`) | N/A (đổi tài liệu) | Diff đối chiếu source trực tiếp | `DONE` |
| WP-05/06/07 FBD Palette/IO/Inspector | Gap report G-2/G-3 | `FBD_EDITOR_DESIGN.md` Rev 1.1 | PR #176 | `palette.test.ts`, `commands.test.ts` (+5), `StructuredFbdEditor.test.tsx` (+6) | Vitest 43/43 FBD; Playwright 10/10 (mocked); deploy Foxlinx `wget health` | `DONE` |
| WP-08 FBD→Mapping Integration | Gap report §1 mục liên quan D-07 | N/A (verify, không build) | PR #177 | `MappingTab.test.tsx` (+1, round-trip JSON thật) | Vitest PASS | `DONE` |
| WP-09 FBD Check/Commission/Runtime E2E | G-2/G-3 (đóng thật cần board) | N/A (verify) | Đang thực hiện Sprint B (CTO/Owner approval §2/§3) | Đang thực hiện | Đang thực hiện | `IN_PROGRESS` — xem Tracker cho trạng thái mới nhất |
| WP-10 ST Editor Upgrade | D-03 gap report gốc | `ST_EDITOR_TECHNICAL_SELECTION_RECORD.md` Rev 1.0 (PR #178); CTO/Owner approval §4-6 duyệt Phương án A + scope P0/P1 | Đang thực hiện Sprint C | Đang thực hiện | Đang thực hiện | `IN_PROGRESS` — xem Tracker |
| WP-11 PGM-02 3-column Layout | `PROGRAMMING_UI_UX_DESIGN.md` §16.2 | Master Plan 56 §4 | PR #178 (grid `lg:grid-cols-[280px_1fr_308px]`) | `DesignWorkspacePage.test.tsx` test bố cục 3 cột | Vitest PASS; deploy Foxlinx | `DONE` |
| WP-12 RETAIN Reset | G-9, D-05/§VI | `PROGRAMMING_RETAIN_RESET_DESIGN.md` Rev 1.0 (PR #179); CTO/Owner approval §7-10 chọn Phương án B (runtime-coordinated) | Đang thực hiện Sprint D | TC-RETAIN-01..05 (chưa chạy) | Đang thực hiện | `IN_PROGRESS` — xem Tracker |
| WP-13 Artifact Trust | D-05, G-10 | `PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN.md` Rev 1.0 (PR #180); CTO/Owner approval §11-14 chốt SIGNED production target + key policy + lab profile | Đang thực hiện Sprint E | Đang thực hiện | Đang thực hiện | `IN_PROGRESS` — xem Tracker |
| `WP-MULTIPROGRAM-ARCH` | **Superseded bởi Product v3.0 + ADR-050** | `DDD-SW-PROG-UNIFIED-001` | Chuyển thành `T59-002/301/305/401..407` | `VS-PROG-U01/U04/U05/U06/U07` | Plan59 + manifest unified | `MIGRATED` — không còn study/blocker riêng |

Bảng trên là **snapshot tại thời điểm ghi** — với các dòng `IN_PROGRESS`,
tra `PROGRAMMING_IMPLEMENTATION_TRACKER.md` §1 để biết trạng thái mới nhất;
không suy luận trạng thái final từ bảng này một khi Sprint B-E đã kết
thúc.

## 13. Pre-baseline crosswalk — PGM-02 v2.2

Change request [`CR-PROG-PGM02-V22-001`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md)
đã được Owner duyệt để mở duy nhất `T59-801`. System Architect chưa pin baseline
reconciled, nên bảng này chỉ nối proposal tới predecessor evidence và risk; nó
không thêm requirement/scenario canonical, không đổi đếm 82/44 và không đổi bất
kỳ trục `D/I/T/P/R` nào.

Tên `WP-01..13` đã được Plan56 dùng ở §12. Vì vậy mọi record hiện hành phải dùng
canonical namespace `PGM02-V22-WP-00..13`; tên ngắn trong proposal chỉ là alias.

| Work package canonical | Phạm vi proposal | Predecessor evidence Plan59 | Risk/change gate | Trạng thái trace |
|---|---|---|---|---|
| `PGM02-V22-WP-00` | Authority/baseline reconciliation | — | `CR-PROG-PGM02-V22-001`; `F-P59-GHOST-POU-001`; `RSK-PROG-023` | `T59-801 READY`; không đổi D/I/T/P/R |
| `PGM02-V22-WP-01` | Shared Programs shell/route | `T59-306/503` | route Active phải reconcile | task mới sau T59-801 |
| `PGM02-V22-WP-02` | Một POU Explorer/identity | `T59-301/306/506` | Draft/Revision/runtime identity | task mới sau T59-801 |
| `PGM02-V22-WP-03` | Quick Library chung | `T59-003/201..205` | catalog/version/source authority | task mới sau T59-801 |
| `PGM02-V22-WP-04` | ST surface | `T59-302/408/506` | diagnostic/source-map parity | task R1 mới |
| `PGM02-V22-WP-05` | FBD canvas | `T59-105/306/506/601` | canonical model/port order | task R1 mới |
| `PGM02-V22-WP-06` | Workbench | `T59-302/408/504/506` | nguồn dữ liệu theo mode | tách R1/R2/R3 |
| `PGM02-V22-WP-07` | Simulation infrastructure | `T59-106/302/402..407/602/603` | `RSK-PROG-023`; architecture/contract mới | task R3 mới, code NO-GO |
| `PGM02-V22-WP-08` | Simulation UI | `T59-503/506/603` + WP-07 | admin-only mutation/read viewer+ | task R3 mới, code NO-GO |
| `PGM02-V22-WP-09` | LIVE/Compare coherent | `T59-408/501/502/504/505` | revision/artifact/snapshot join | task P0 + R2 mới |
| `PGM02-V22-WP-10` | Performance | `T59-504/506/601/604` | budget per increment | tách R1/R2/R3 |
| `PGM02-V22-WP-11` | Responsive/a11y | `T59-503/506/603/604` | viewport/keyboard/permission | tách R1/R2/R3 |
| `PGM02-V22-WP-12` | E2E/V&V | `T59-601/603/604/701..706` | scenario/Test Result mới phải được pin | tách R1/R2/R3 |
| `PGM02-V22-WP-13` | Docs/release closeout | `T59-707` là verdict lịch sử | release authority độc lập | closeout mới theo increment |

Predecessor `DONE` chỉ chứng minh capability cũ; không được dùng để gắn
`IMPLEMENTED/PASS` cho redesign. Khi `T59-801` đóng, Trace chỉ được thêm dòng
canonical sau khi SRS/VVP cấp ID và baseline tương ứng được pin.
