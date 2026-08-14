# Báo cáo As-Built và khoảng hở Programming Rev A trình PM/CTO

| Thuộc tính | Giá trị |
|---|---|
| ID | `REV-PROG-ASBUILT-GAP-2026-08-14` |
| Trạng thái | **Active review record — NO-GO cho nghiệm thu/release** |
| Ngày chốt | 2026-08-14 |
| Phạm vi | Source Programming hiện có trong Core, Web API, Web UI, contract, Plan 53 và bản đang chạy Foxlinx |
| Baseline source | `59f84c89cb5b` cộng cây làm việc trước PR `agent/programming-asbuilt-gap-report` |
| Tài liệu đối chiếu | `UX-WEB-PROG-001`, `DDD-FE-PROG-001`, `IFSPEC-PROG-001`, `PLAN-PROG-053`, `VVP-PROG-001`, `TRACE-PROG-001` |
| Người đọc chính | PM, CTO, Product Owner, System Architect, Dev Lead, Verification Lead |
| Quyền bằng chứng | Source review + host/browser/target supporting evidence; **không phải** `TR-PROG-*`, HIL hoặc release approval |

## 1. Kết luận điều hành

Programming Rev A **không phải một skeleton**: source hiện có đã bao phủ compiler
ST/FBD, runtime định kỳ, process image, lifecycle Commission/Restore, persistence,
REST API, bốn workspace Web và Monitor/Trace. P0..P4 đã được tracker ghi DONE ở
mức source/host; P5 đang `8/11`, toàn Plan 53 là `43/53 (81,1%)` tại baseline
0.55.

Tuy nhiên solution hiện tại **đang sai ở luồng cốt lõi UC-PROG-03 từ bước 2 và
chỉ được coi là bản tạm để review**. Kỹ sư có thể mở và sửa một Program ST đã có,
nhưng không thể tin cậy hoàn tất vòng:

`Tạo ST → sửa → lưu → Check FAILED → sửa lỗi → lưu → Check lại`.

Ba lỗi Critical đã được xác nhận:

1. Nút `ST+` tạo một Program có `document: ''`, trong khi compiler yêu cầu khung
   `PROGRAM ... END_PROGRAM`; đối tượng mới sai ngay từ lúc tạo.
2. Check niêm phong Draft, tăng ETag và đổi `baseRevisionId`, nhưng FE bỏ qua ETag
   trả về. Sau Check FAILED, lần lưu bản sửa dùng concurrency token cũ và bị 409.
3. Diagnostic live cho token sai chỉ hiện `PRG-ERR-SCOPE-001`, không có dòng/cột;
   acceptance “nhảy đúng khoảng nguồn” chưa đạt.

Ngoài ra còn sai ownership giữa `PGM-02` và `PGM-03`, thiếu điều hướng workspace
desktop, layout editor không đúng ba cột, conflict thiếu expected/actual, một số
error save không hiện cho người dùng, và các gate Monitor/Trace, RETAIN, HIL,
usability, Test Result vẫn mở.

**Đề nghị PM/CTO:** chấp nhận PR này như snapshot As-Built + hồ sơ gap, **không
chấp nhận như feature hoàn tất**; ưu tiên một vertical slice UC-PROG-03 trước mọi
tuyên bố P5 DONE; giữ `RELEASE_READY = BLOCKED`.

## 2. Hiện trạng source đã triển khai

| Lớp | Thiết kế yêu cầu | As-Built source hiện tại | Kết luận |
|---|---|---|---|
| Contract | OpenAPI, error catalog, profile/artifact, IPC có phiên bản | OpenAPI Programming v1.20, client TypeScript sinh mã, IPC/Core contract, catalog lỗi và manifest join đã có | **Có implementation**; chưa phải release evidence |
| Compiler | ST Rev A + FBD về typed IR chung, source map, bounded sandbox | Parser/compiler ST, FBD canonical/lowerer, artifact/hash/source map, hostile corpus và fuzz đã có | **Có implementation host**; diagnostic live còn mất location ở UC-03 |
| Core runtime | một Task Rev A, process image, priority, cutover atomic, RETAIN/recovery | Scheduler, input/output preflight, PID/override, task metric, journal, RETAIN, Commission coordinator và runtime snapshot đã có | **Có implementation source/host**; target timing, power-cut, I/O thật còn mở |
| Web API | Project/Draft/Revision/Check, ETag, idempotency, RBAC/audit, Commission/Restore, Monitor/Trace | SQLite lifecycle, Check worker, operation coordinator, runtime/monitor/trace và route auth đã có | **Có implementation**; một số error envelope chưa đủ dữ liệu recovery cho FE |
| Web UI | bốn workspace, ST/FBD/mapping/task, Check/Commission, Runtime/Watch/Service | `PGM-01..04`, context, dirty guard, ST tooling, FBD, mapping, Commission, runtime, mobile nav, export/import đã có | **Có surface rộng nhưng UC-03 và IA/layout chưa đúng thiết kế** |
| Deploy | feature flag, backup, atomic deploy, rollback/read-back | Corrective dirty-source đã chạy trên Foxlinx; artifact/hash/rollback nằm trong `EV-PROG-P5-510` | **Supporting target**; source chưa merge, PR này không tự deploy lại |
| Verification | 32 scenario có Test Result độc lập, HIL, residual acceptance | Host/browser supporting gate đã chạy trước đó; tracker giữ `2/32 record`, `0/32 PASS` | **RELEASE_READY BLOCKED** |

### 2.1 Source owner chính

- Core/runtime: `apps/core/application/runtime/`, `apps/core/domain/graph/`,
  `apps/core/domain/priority/` và bounded Programming components.
- Web API: `apps/web-api/internal/programming/` cùng facade trong
  `apps/web-api/internal/app/`.
- Contract: `contracts/openapi/openapi.yaml`, contract Programming/IPC/profile.
- FE: `apps/web-ui/src/features/programming/`, route trong `apps/web-ui/src/app/`.
- Authority thiết kế: `docs/02_design/`, `docs/04_uiux/`, verification/trace và
  Plan 53; record này không thay các authority đó.

## 3. Tái hiện UC-PROG-03 ngày 2026-08-14

### 3.1 Luồng đã chạy trên Foxlinx

Môi trường: `http://mekong-fac.ddns.net:8082/`, Chromium cô lập `1440×1000`,
đăng nhập admin; không lưu token/cookie/header. Chỉ thay Draft; không Commission,
Restore hay output vật lý.

1. Mở `PGM-02`, ban đầu chưa Program nào được chọn; desktop không có điều hướng
   nội bộ bốn workspace: [ảnh bước 2](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-current-step2-desktop.png).
2. Chọn Program ST hợp lệ, thêm token sai và lưu Draft.
3. Bấm Check: kết quả `FAILED`, Active Revision vẫn
   `1ab7cb9b-b3dc-4744-ab9c-7ac778bb9af7`; Problems chỉ có lỗi scope, không có
   dòng/cột: [ảnh Check FAILED](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-check-failed-before-fix-desktop.png).
4. Xóa token sai và bấm lưu. UI báo Draft đã đổi ở phiên khác; expected/current
   đều `—`: [ảnh conflict](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-etag-conflict-before-fix-desktop.png).
5. Tải lại concurrency state và lưu lại source hợp lệ. Draft đã phục hồi, Active
   vẫn không đổi: [ảnh hoàn nguyên](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-draft-restored-after-repro.png).

### 3.2 Chuỗi nguyên nhân source

```text
ProgramsTab.ST+
  -> upsertProgram(document = "")                         [sai đầu vào]
  -> người dùng sửa/lưu
  -> DesignWorkspacePage.runCheck(project)
  -> POST revision: server tăng Draft ETag + đổi baseRevisionId
  -> useCheckWorkflow chỉ lấy revisionId, bỏ sealed.etag   [stale FE state]
  -> Check FAILED
  -> người dùng sửa/lưu bằng ETag/base cũ
  -> backend fail-closed 409
  -> UI không có expected/actual nên recovery copy là "—"
```

Dẫn chứng:

- [`ProgramsTab.addProgram`](../../../apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx#L105-L126)
  gán source ST rỗng và lưu ngay.
- [`DesignWorkspacePage`](../../../apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx#L161-L188)
  chạy Check trực tiếp trên `PGM-02`.
- [`useCheckWorkflow`](../../../apps/web-ui/src/features/programming/design/useDraftWorkspace.ts#L159-L183)
  nhận `sealed.etag` nhưng không đồng bộ lại Project/Draft state.
- [`ProjectService.SealRevision`](../../../apps/web-api/internal/programming/application/projects.go#L231-L280)
  trả ETag mới đúng contract; store tăng ETag và đặt Revision mới làm base.
- [`CheckCommissionPage`](../../../apps/web-ui/src/features/programming/commission/CheckCommissionPage.tsx#L77-L95)
  không thể bắt đầu Check khi mở trực tiếp, trái ownership ghi ở UI/UX.

## 4. Bảng gap ưu tiên giao PM/CTO

| ID | Mức | Thiết kế/acceptance | As-Built/gap | Ảnh hưởng người dùng/rủi ro | Owner đề nghị | Điều kiện đóng |
|---|---|---|---|---|---|---|
| `F-PROG-ASBUILT-001` | **Critical** | UC-03 bước 1–3; ST Program phải sửa/lưu/check được | `ST+` tạo `document: ''`, không sinh template `PROGRAM/END_PROGRAM`; tên mặc định lặp | Program mới sai từ khi tạo; kỹ sư gặp lỗi không có hướng dẫn | FE + Compiler + UX | Template ST hợp lệ/unique; test create→reload→Check; source map đúng |
| `F-PROG-ASBUILT-002` | **Critical** | UC-03 bước 6; UX-REQ-020 không mất Draft/overwrite sau Check | Seal tăng ETag/base nhưng hook chỉ giữ `revisionId`; sửa sau Check FAILED bị 409 | Vòng sửa–kiểm tra bị gãy; người dùng phải reload thủ công | FE + BE | Đồng bộ canonical Project sau seal hoặc chuyển Check sang route reload state; test FAILED→edit→save→recheck |
| `F-PROG-ASBUILT-003` | **Critical** | VS-PROG-005/006: diagnostic đúng source range | Live chỉ hiện `PRG-ERR-SCOPE-001`, không dòng/cột cho token sai dòng 8 | Không biết sửa ở đâu; UC-03 không đạt | Compiler + BE + FE | Stable diagnostic có `programId/line/column/length`; Problems focus editor; target test |
| `F-PROG-ASBUILT-004` | **High** | UC-06: Check bắt đầu ở `PGM-03`; `PGM-02` có shortcut | Source chạy Check ở `PGM-02`; `PGM-03` không có ID chỉ hiện empty và yêu cầu Check đã PASS | Mental model/route ownership vòng tròn, deep-link không tự đủ | Product + UX + FE | CTO/Product chốt một owner; docs và code thống nhất; reload/poll/UNKNOWN test |
| `F-PROG-ASBUILT-005` | **High** | FE design §13: 409 hiện base/current/local diff | Server trả public conflict không có expected/actual; UI render `—` | Recovery mù, dễ tải lại nhầm và mất ngữ cảnh | BE + FE | Error envelope có field ổn định hoặc UI bỏ claim; two-client test + browser evidence |
| `F-PROG-ASBUILT-006` | **High** | UC-03 network loss giữ buffer và cho retry có thông báo | `useDraftWorkspace.error` được set khi save lỗi nhưng ready page không render lỗi save riêng | Người dùng bấm lưu nhưng không biết thất bại | FE | Alert/toast persistent có retry; offline/5xx test; buffer giữ nguyên |
| `F-PROG-ASBUILT-007` | **High** | UX-REQ-002; bốn workspace phải discoverable | Chỉ mobile có bottom nav; desktop chỉ thấy global “Lập trình”, không có Overview/Design/Check/Runtime nav/breadcrumb | Người dùng desktop phụ thuộc nút ngữ cảnh; khó quay lại Check/Runtime | UX + FE | Desktop workspace nav + active state + keyboard; asset/source cùng revision |
| `F-PROG-ASBUILT-008` | **Medium** | `PGM-02` desktop có Tree 280 + Editor + Inspector 308; Problems luôn truy cập được | Source grid hai cột; Inspector nằm dưới editor; Problems chỉ render khi có diagnostic | Sai hierarchy, tăng cuộn, trạng thái Problems biến mất | UX + FE | Grid ba cột ≥1440; collapse 1024–1439; empty Problems region; desktop/mobile visual test |
| `F-PROG-ASBUILT-009` | **Medium** | ST editor có autocomplete bounded/syntax feedback | Hiện có line/column/find/format/symbol, chưa có autocomplete/highlight rõ ràng | Trải nghiệm chưa đạt editor design; tăng lỗi nhập | UX + FE | Chốt phạm vi Rev A, implement hoặc sửa design/acceptance có phê duyệt |
| `F-PROG-ASBUILT-010` | **High** | UC-12 Monitor/Trace có program/actual/owner/priority/quality/freshness | Target active fixture không có binding; Monitor `items=0`, Trace positive chưa chạy | Không chứng minh dữ liệu thật xuyên Core→FE | QA + Core + BE + FE | Fixture binding read-only; start/get/stop và negative trace; raw evidence/reviewer |
| `F-PROG-ASBUILT-011` | **High** | UC-13 RETAIN reset có affected list, strong confirm, re-auth, operation read-back | FE đúng fail-closed nhưng route vẫn contract-only, action bị khóa | Capability chưa hoàn tất; không được quảng bá là đã có | Core + BE + FE + Safety | Contract impact thật + negative/fault/target evidence; không dùng Active ID giả |
| `F-PROG-ASBUILT-012` | **Critical gate** | Plan close: merge source, 32/32 Test Result, HIL/residual acceptance | Corrective chưa merge tại thời điểm audit; `0/32 PASS`; P6 chưa bắt đầu | Không có authority release/production acceptance | Dev Lead + Verification + QA + Release | PR review/merge; full gates tại commit; 32/32 reviewed PASS; HIL/power/fault/usability |

## 5. Sai khác và mâu thuẫn ngay trong tài liệu thiết kế

| Chủ đề | Nội dung đang mâu thuẫn | Phán quyết tạm cho PR này |
|---|---|---|
| Owner của Check | `UX-WEB-PROG-001` UC-06 ghi bấm Check trên `PGM-03`, `PGM-02` chỉ có shortcut; source và một dòng FE page-to-code lại cho `PGM-02` tạo Check | **Chưa tự chọn thay PM/Product.** Mở `F-PROG-ASBUILT-004`; không sửa code theo một nửa tài liệu |
| Project selector | Cây component UI/UX còn ghi `ProjectSelector`; capability Rev A giới hạn một Project/controller và Header source chủ đích không có selector | Đề nghị sửa docs thành static Project context; không tạo selector giả |
| Header/navigation | UI/UX ghi breadcrumb/project/help/refetch nhưng Header source chỉ có title/refresh; asset chưa thể hiện đầy đủ desktop workspace nav | UX Lead phải chốt asset + component map trước corrective UI |
| Problems | Thiết kế nói dùng chung/luôn truy cập; source chỉ mount khi diagnostics > 0 | Code phải có empty/loading/history state hoặc thiết kế phải sửa rõ; ưu tiên code vì acceptance cần recovery |
| Trạng thái triển khai | Một số đoạn FE Design còn mô tả 508/509 chưa deploy dù evidence sau đó đã deploy; cùng lúc audit mới chứng minh UC-03 vẫn sai | Khi sửa UC-03 phải đồng bộ As-Built, Plan, VVP, Trace, candidate trong một change |

## 6. Trạng thái 17 use case tại mốc báo cáo

Đây là đánh giá quản trị, không phải Test Result:

| Nhóm | UC | Trạng thái hiện tại |
|---|---|---|
| Có supporting live tương đối đầy đủ | `01`, `02`, `10`, `13` containment, `16` | Có hành vi/bằng chứng hỗ trợ; vẫn thiếu reviewer/Test Result độc lập |
| **Không đạt do defect hiện hành** | `03`, `06` | UC-03 gãy vòng sửa/check; UC-06 sai route ownership và phụ thuộc UC-03 |
| Có surface nhưng chưa đủ target/fixture | `04`, `05`, `07`, `08`, `09`, `11`, `12`, `17` | Host/E2E hoặc read-only có; thiếu mutation/fault/binding/HIL/recommission phù hợp |
| Ngoài Rev A và ẩn đúng | `14`, `15` | Không phải gap Rev A |

Không dùng bảng này để cộng “% UC PASS”. Chỉ `TR-PROG-*` được Verification Lead
review mới được nâng cột Test Result.

## 7. Quyết định cần PM/CTO xác nhận

| Quyết định | Khuyến nghị kỹ thuật | Người quyết | Nếu chưa quyết |
|---|---|---|---|
| D-01 · Route nào sở hữu Check? | `PGM-03` sở hữu seal/run/poll/result; `PGM-02` chỉ lưu rồi điều hướng với dirty guard | Product + CTO + UX | Code/docs tiếp tục drift; deep-link khó đúng |
| D-02 · Cho phép tạo Program ST rỗng? | **Không.** Sinh template hợp lệ tối thiểu và tên identifier unique; empty state phải có action rõ | Product + Compiler + UX | Mọi Program mới khởi đầu ở trạng thái lỗi |
| D-03 · Phạm vi editor ST Rev A | Chốt bắt buộc: template, line/column, source range, find/format; autocomplete/highlight chỉ giữ nếu có acceptance/test rõ | Product + UX | FE làm dở nhiều công cụ nhưng không có gate đo được |
| D-04 · Desktop IA | Bổ sung nav bốn workspace + active state; giữ bottom nav mobile | UX + Product | Bốn workspace tồn tại về route nhưng không discoverable |
| D-05 · Ưu tiên delivery | Mở một task corrective vertical slice UC-03 trước Monitor/Trace polish hoặc tuyên bố P5 DONE | PM + Dev Lead | Lỗi cốt lõi tồn tại trong khi % tiến độ vẫn tăng |
| D-06 · Release | Giữ `NO-GO`, không phát hành thương mại cho tới 32/32 Test Result + HIL/residual acceptance | PM + CTO + Verification | Supporting evidence bị dùng sai thành release approval |

## 8. Kế hoạch corrective đề xuất sau khi PM duyệt

| Thứ tự | Lát cắt | Exit đo được |
|---:|---|---|
| 1 | Reconcile UI/UX + FE Design cho owner `PGM-02/03`, template ST, Problems và desktop nav | Không còn câu mâu thuẫn; asset/component/API mapping cùng revision |
| 2 | Tạo ST template + auto-select + unique identifier | Create→save→reload cho source hợp lệ; không Program rỗng |
| 3 | Sửa seal/check concurrency state | FAILED→edit→save→Check lại không 409; ETag/base read-back đúng |
| 4 | Nối diagnostic location end-to-end | Invalid token/type focus đúng program, line, column, length |
| 5 | Sửa recovery/error + layout/IA | 409 có dữ liệu hữu ích; offline save nhìn thấy; desktop ba cột/nav đúng asset |
| 6 | Vitest/Go/C++/Playwright + browser target | Positive/negative/fault; desktop/mobile; Console/Network; Active hash không đổi qua Check |
| 7 | Candidate/trace/plan/evidence + PR merge | Pin/harness PASS; source merge; vẫn không nâng Test Result nếu chưa có reviewer |

Ước lượng chỉ được lập sau D-01..D-05; record này không tự thêm task hay đổi ngân
sách của Plan 53 khi chưa có quyết định PM.

## 9. Gate và giới hạn bàn giao

- `PLAN_READY`: PASS; quyền implement vẫn mở.
- `IMPLEMENT_READY`: PASS; defect không cần approval bổ sung để code sau khi PM
  chốt owner UX ở D-01.
- P5: giữ `IN_PROGRESS 8/11`; không nâng 508/509/510 thành DONE chỉ vì PR được mở.
- `RELEASE_READY`: **BLOCKED / NO-GO**.
- Target/HIL: không có phép đo điện, IOP timing, power-cut hay HIL mới trong record này.
- Browser: ảnh 2026-08-14 là supporting evidence; Chrome DevTools MCP không có
  trong phiên, nên không tuyên bố DevTools PASS. Luồng dùng Chromium cô lập.
- PR: chứa snapshot source/docs hiện có và report; không tự triển khai artifact mới.

### 9.1 Gate chạy lại trước commit ngày 2026-08-14

| Gate | Lệnh/phạm vi | Kết quả |
|---|---|---|
| C++ | CMake Release; Modbus/BACnet/HMI `ON`; build + CTest | **1004/1004 PASS** |
| Go | `go vet ./...`; `go test ./... -count=1` | **PASS mọi package** |
| FE unit | Vitest `src`, jsdom | **64 file / 521 test PASS** |
| FE static/build | ESLint, TypeScript `--noEmit`, Vite production build | **PASS**; chỉ có cảnh báo kích thước chunk không chặn build |
| Contract | generated API/error/FBD checks | **25 operation**; **20 public/99 detail**; FBD mutation **10/10** |
| Browser E2E | Programming desktop/mobile + Network QA | **11/11 PASS**; request ngoài mock tới backend dev không chạy tạo log proxy dự kiến, không phải target evidence |
| Tài liệu | candidate pin + docs ISO harness `--expect` | **22/22 PASS**; link/anchor/whitespace/fence/ID/trace PASS |

Các gate trên chứng minh branch build/test được và khóa regression hiện có; chúng
**không phủ lỗi live UC-PROG-03 vừa tái hiện**, vì E2E hiện chưa mô phỏng đúng
chuỗi seal làm đổi ETag/base rồi Check FAILED → sửa → lưu lại. Do đó test xanh
không thay phán quyết NO-GO.

## 10. Tài liệu/bằng chứng liên quan

- [Audit FE/UI/UX Programming](PROGRAMMING_FE_UX_IMPLEMENTATION_AUDIT_2026-08-13.md)
- [Evidence corrective Foxlinx](../test-evidence/fw-som/2026-08-13-foxlinx-programming-plan53-corrective.md)
- [Programming Implementation Plan](../../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md)
- [Programming UI/UX Design](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md)
- [Programming FE Design](../../02_design/software/PROGRAMMING_FE_DESIGN.md)
- [Programming Verification Plan](../../05_verification/PROGRAMMING_VERIFICATION_PLAN.md)
- [Programming Traceability Matrix](../PROGRAMMING_TRACEABILITY_MATRIX.md)

## 11. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-14 | Chốt As-Built đa lớp, tái hiện UC-PROG-03, mở 12 finding, bảng quyết định PM/CTO và giữ NO-GO release |
