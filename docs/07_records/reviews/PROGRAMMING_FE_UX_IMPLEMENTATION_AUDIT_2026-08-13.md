# Biên bản audit triển khai FE/UI/UX Programming Plan 53

| Thuộc tính | Giá trị |
|---|---|
| ID | `REV-PROG-FE-UX-2026-08-13` |
| Phạm vi | Plan 53 P5; bốn workspace `PGM-01..04`; `UJ-PROG-01..08`; `UC-PROG-01..17` áp dụng Rev A |
| Revision audit | 1.5 |
| Ngày | 2026-08-14 |
| Người thực hiện | Dev Lead / agent kỹ thuật theo quyền `AUTH-PROG-2026-08-11-03` |
| Phán quyết | **Solution hiện tại chỉ là bản tạm để review: UC-PROG-03 KHÔNG ĐẠT từ bước 2; vòng Check FAILED → sửa → lưu bị 409. `RELEASE_READY BLOCKED`.** |
| Quyền bằng chứng | Supporting source/host/browser evidence; **không phải** Test Result độc lập, HIL hay `RELEASE_READY` |

> **Cập nhật 1.4 có quyền ưu tiên cho trạng thái live hiện hành.** Các mục 1–10 giữ lại
> lịch sử corrective và bằng chứng đã thu trước đó. Lượt kiểm tra lại trực tiếp
> ngày 2026-08-14 xác nhận UC-PROG-03 vẫn sai dù corrective 1.3 đã deploy: ST mới
> bắt đầu bằng source rỗng; seal làm ETag/base phía FE cũ; diagnostic không có
> dòng/cột. Tái hiện và trạng thái Draft đã hoàn nguyên nằm tại mục 11; báo cáo
> PM/CTO là [`REV-PROG-ASBUILT-GAP-2026-08-14`](PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md).


> **Ghi chú authority ngày 2026-09-06:** Đây là biên bản lịch sử dùng IA bốn
> workspace tại thời điểm lập. Các nhãn Check/Commission=PGM-03 và
> Runtime/Bảo trì=PGM-04 bên dưới chỉ mô tả baseline cũ, đã **SUPERSEDED**.
> Route/contract hiện hành nằm ở UX-WEB-PROG-001 §2; composition trực quan hiện
> hành nằm trong `KX_DDC24_Programming_FE_Handoff_v2_1` theo
> `AUTH-UX-PROG-2026-09-08-01`:
> PGM-03 Mapping, PGM-04 Control Library, PGM-05 Check/Commission,
> PGM-06 Runtime. Không dùng số PGM lịch sử trong file này làm route hoặc
> acceptance authority mới hoặc phục hồi bộ SVG Programming đã loại.

## 1. Kết luận trước hành động

Tuyên bố cũ “P5 8/8, 100%” chưa chứng minh đầy đủ UI/UX/use case theo chính
`UX-WEB-PROG-001` và `DDD-FE-PROG-001`. Bản chạy Foxlinx cũ có bốn workspace,
Check/Commission và read-back, nhưng còn thiếu hoặc chưa nối thật các hành vi
quan trọng: editing context/dirty state, công cụ ST, guard rời Draft, readiness
fail-closed và Monitor/Trace. Vì các thiếu sót thuộc phạm vi user giao, audit mở
`TASK-PROG-508..510` và sửa code ngay; không chỉ ghi finding.

## 2. Finding và xử lý

| Finding | Requirement/use case | Baseline đầu phiên | Xử lý trong 508/509 | Trạng thái |
|---|---|---|---|---|
| `F-PROG-FE-001` | FE-101/105; UX-REQ-001/003; UC-01/03/06/08 | Context bar thiếu controller/project/draft/dirty/check/active rõ ràng | `ProgrammingLayout` hợp nhất route + Project; `ProgrammingContextBar` đọc `controllerId`, Project, Draft dirty, Check, Active và Core thật | IMPLEMENTED; host test PASS |
| `F-PROG-FE-002` | FE-103/111/112; UC-03 | ST chỉ là textarea; thiếu line/column, tìm, định dạng, symbol/type/ref và nhảy diagnostic | Bổ sung gutter, vị trí con trỏ, `Ctrl+F`, `Ctrl+S`, định dạng, danh mục symbol/type/reference và chọn diagnostic tới range | IMPLEMENTED; component/E2E PASS |
| `F-PROG-FE-003` | FE-105/110; UC-02/03/07 | Không có dirty guard đầy đủ; Check có thể chạy khi buffer chưa lưu | Gom pending operation của Program+Task, cấm Check khi dirty, `beforeunload`, modal lưu toàn batch/bỏ/ở lại; đồng bộ Task sau save ngoài tab mà không ghi đè local edit | IMPLEMENTED; E2E đã bắt và khóa regression |
| `F-PROG-FE-004` | FE-105; UC-06/08 | Deep-link Commission phụ thuộc state điều hướng; reload dễ mất Revision/Check | Query canonical `revisionId`+`checkId`, fallback tương thích state; context được dựng lại từ Project/runtime | IMPLEMENTED; unit PASS |
| `F-PROG-FE-005` | FE-107; UC-08/09/10/16 | Readiness chưa fail-closed khi override/Core/safe-state không đọc được | Chỉ cho Commission khi Check PASS, impact+override đọc được, Core READY và không safe-state; lỗi từng lớp hiện rõ | IMPLEMENTED; unit âm PASS |
| `F-PROG-FE-006` | FE-109; BE-109; CORE-110; NFR-104; UC-12 | Monitor/Trace là contract-only 503; Runtime metric hiển thị `—` | Core snapshot thêm program proposal/effective priority/task metric; BE join Revision binding + Core/Point truth; Trace bounded/idempotent/audit/stop; FE Watch tách program/actual/owner/priority/TTL/quality/freshness và có Trace panel | IMPLEMENTED; target Monitor `200`, Runtime/Task read-back PASS; positive row/Trace target còn mở vì fixture active không có binding |
| `F-PROG-FE-007` | UX-REQ-020; UC-11/13/17 | Danger Zone render dưới mọi tab Runtime/Watch | Chỉ render tại tab “Phiên bản & Bảo trì”; viewer không thấy mutation | IMPLEMENTED; unit PASS |
| `F-PROG-FE-008` | FE-111; VS-025/028/031 | Trace matrix ghi `I=Y` nhưng chưa có axe/contrast/usability độc lập | Thêm axe WCAG A/AA vào E2E, chạy bốn workspace × desktop/mobile trên mock và target; giữ usability/reviewer độc lập ở assurance | Tool evidence CLOSED: 8/8 target scan, 0 violation; Test Result/usability vẫn BLOCKED đúng authority |

## 3. Thiết kế As-Built của corrective slice

### 3.1 Luồng Draft và Check

1. `ProgramsTab` và `ExecutionTab` tạo danh sách operation cục bộ, không tự
   mutation khi gõ.
2. `DesignWorkspacePage` hợp nhất operation và xuất `dirty` vào context bar.
3. `Check` bị khóa khi dirty. Điều hướng nội bộ mở ba lựa chọn: lưu **một batch**,
   bỏ thay đổi cục bộ, hoặc ở lại. Đóng tab/trình duyệt dùng `beforeunload`.
4. Save chỉ xóa dirty sau response server trả Draft/ETag mới; `409` giữ buffer.
5. Commission URL mang `revisionId/checkId`, reload không dựa vào memory state.

### 3.2 Luồng monitor/trace và ranh giới sự thật

```text
ScanLoop/PriorityResolver
  -> RuntimePointSnapshot (program slot P5, actual, owner, priority, task)
  -> Core UDS client
  -> ProgrammingMonitorService
       + Revision Variable/Binding
       + Point catalog cho point ngoài LOCAL
  -> GET /runtime/monitor
  -> WatchTab
  -> TraceService lấy mẫu bounded từ cùng monitor source
  -> POST/GET/DELETE /runtime/traces
```

- LOCAL actual/owner/priority dùng end-scan Core snapshot; không lấy optimistic
  value từ Program.
- Point ngoài LOCAL dùng Point catalog read tại thời điểm poll và không được
  ghi đè chỉ vì trùng `pointId` với LOCAL.
- Trace chấp nhận 1..32 variable, 1 giây..10 phút, sample 100 ms..30 giây, tối
  đa 4 session đồng thời và 10.000 ô giá trị/session; giữ tối đa 32 session
  terminal. Session nằm trong RAM và mất khi Web process restart.
- Source mất hoặc dữ liệu không hợp lệ làm request/session fail-closed; UI không
  dựng dữ liệu thay thế.

## 4. Bằng chứng hoàn tất trong phiên

| Làn | Lệnh/kiểm tra | Kết quả hiện tại | Quyền kết luận |
|---|---|---|---|
| C++ full gate | Release, Modbus/BACnet/HMI ON; `ctest --output-on-failure` | build PASS; **1004/1004 PASS** | Host supporting |
| Go full gate | `go vet ./...`; `go test ./... -count=1` | PASS mọi package | Host supporting |
| FE full gate | Vitest + lint + typecheck + build | **64 file / 521 test PASS**; lint/typecheck/build PASS | Host supporting |
| Contract/tooling | OpenAPI/generator/catalog/FBD mutation | **25 operation**, **20/99 error**, **10/10 mutation** | Host supporting |
| Chrome E2E corrective | Programming + Network QA, desktop/mobile | **11/11 PASS** (Programming 10/10 + Network QA 1/1); mock Programming contract có ghi rõ; axe `VS-PROG-028` 2/2 PASS | Browser FE supporting; không thay target |
| Foxlinx deploy/rollback | Cross-build ARM64, backup, deploy, health/hash, rollback rehearsal, tái deploy | PASS; bốn service `active`; health các thành phần `ok`; đúng hash | Target supporting |
| Foxlinx runtime/API | Runtime + Monitor + Trace validation | Active/Task `RUNNING`; Monitor `200`, item `0` đúng fixture không binding; Trace selector rỗng `400` | Target supporting; positive Trace target còn mở |
| Chrome Foxlinx | Bốn workspace × desktop/mobile, Console/Network, axe | 0 error/warn/page error; 0 failed Programming request; **8/8 axe scan, 0 violation** | Target browser supporting |

Record chi tiết, hash artifact, rollback và ảnh desktop/mobile:
[`EV-PROG-P5-510`](../test-evidence/fw-som/2026-08-13-foxlinx-programming-plan53-corrective.md).

## 5. Blocker và điều kiện mở

| Mục | Owner | Ảnh hưởng | Gate | Điều kiện mở |
|---|---|---|---|---|
| Corrective source chưa commit/merge | FE/BE/Core + Dev Lead | 508/509 chưa đạt DoD và chưa được nâng thêm trục `I` | P5 / trace §8 | Commit/PR/merge thật; chạy lại gate, candidate pin và docs harness |
| Positive Monitor/Trace target có binding | QA + FE/BE/Core | Chưa chứng minh row program/actual/owner/priority/quality/freshness và start/get/stop trên board | `TASK-PROG-509/510`; `VS-PROG-018/027` | Tạo fixture read-only có Variable Binding an toàn, chạy positive/negative và lưu raw output; cấm fabricate |
| Accessibility/Test Result độc lập | Accessibility Reviewer + QA | axe tool 8/8 scan đã sạch nhưng chưa có reviewer độc lập để nâng `T` | `VS-PROG-025/028` | Review bundle/evidence mới và ký Test Result theo VVP |
| Usability `S5-F` | UX Lead + Product | Không chứng minh ngưỡng khả dụng thực tế | `VS-PROG-031` / `RELEASE_READY` | Fixture `AHU-01`, ít nhất 5 kỹ thuật viên BMS chưa dùng sản phẩm, đủ số đo `UX-A-01..06` |
| 32 Test Result | Verification Lead | Không được tuyên bố release/HIL | `RELEASE_READY` | Executor/reviewer độc lập, target/fixture đúng VVP, 32/32 PASS và residual acceptance |

## 6. Phán quyết gate

- `PLAN_READY`: PASS theo authority hiện hành.
- `IMPLEMENT_READY`: PASS; corrective source được phép triển khai.
- P5: bằng chứng lịch sử của 508/509/510 không đủ để kết luận target hiện hành
  đạt DoD. Audit live 1.2 có 12 UC lỗi/thiếu trực tiếp và ba UC chưa đủ bằng
  chứng; phải xử lý các finding mục 8 rồi chạy lại toàn bộ 17 UC.
- `RELEASE_READY`: **BLOCKED**, 0/32 Test Result PASS.

## 7. Audit live từng use case

### 7.1 Môi trường và cách kiểm tra

| Thuộc tính | Giá trị |
|---|---|
| Endpoint | `http://mekong-fac.ddns.net:8082/` |
| Phiên | Chrome cô lập, đăng nhập bằng tài khoản admin do Product Owner cung cấp; không lưu mật khẩu, token, cookie hoặc Authorization header vào hồ sơ |
| Kích thước | Desktop `1440×900`; mobile `390×844` |
| Thời gian chốt | 2026-08-13 21:42 ICT |
| Thiết kế đối chiếu | `UX-WEB-PROG-001` §16–17 và asset `PGM-01..04` |
| Bằng chứng | Ảnh chụp và accessibility snapshot trong phiên Chrome; Console; Network; đọc source đang có trong worktree để định vị nguyên nhân |
| Giới hạn an toàn | Không bấm xác nhận cuối của Commission, Restore hoặc RETAIN reset khi nút đang mở sai; không nhập bundle chưa được kiểm soát; không tạo fault thật trên controller |

`PASS` chỉ dùng khi toàn bộ acceptance áp dụng đã được quan sát. `KHÔNG ĐẠT`
nghĩa là đã tái hiện lỗi/thiếu trực tiếp. `CHƯA ĐỦ` nghĩa là surface có nhưng
thiếu fixture hoặc không được phép tạo mutation/fault thật trong lượt audit.

### 7.2 Ma trận `UC-PROG-01..17`

| UC | Kết quả live | Trạng thái | Bằng chứng và phần còn thiếu |
|---|---|---|---|
| `UC-PROG-01` Xem ứng dụng đang vận hành | Tổng quan tải được Core, Active và Draft; cùng một snapshot lại hiện `Safe state = Yes` nhưng “Nothing needs attention” | **KHÔNG ĐẠT** | Không đạt acceptance “trong 5 giây thấy safe-state và việc cần chú ý”; trạng thái an toàn không được nâng thành attention/action |
| `UC-PROG-02` Functional tag/view | Mở/sửa cục bộ được metadata, dirty state và nội dung qua đổi tab | **CHƯA ĐỦ** | Chưa chứng minh `PATCH` thành công, ETag mới, audit `draft.updated` và nhánh xung đột `409` giữ buffer trên endpoint live |
| `UC-PROG-03` Lập trình ST | Editor, line/column, Find/Format và giữ nội dung qua đổi tab hoạt động; đã hoàn tác nội dung thử | **KHÔNG ĐẠT** | Luồng không thể đi hết Save → Check; Check dừng trước Network do lỗi `crypto.randomUUID`; chưa chứng minh diagnostic đúng dòng/cột và reload từ BE |
| `UC-PROG-04` Lập trình FBD/User FB | Bấm thêm FBD hoặc ST mới phát sinh `TypeError: crypto.randomUUID is not a function` | **KHÔNG ĐẠT** | Không tạo được đối tượng nên không thể kiểm palette, typed pin, nối dây, canonical save hoặc keyboard-only flow |
| `UC-PROG-05` Ánh xạ Variable→Point | Dialog, filter `LOCAL/VP/MB_RTU`, direction/writable/quality hiện; bấm Map phát sinh cùng lỗi `randomUUID` | **KHÔNG ĐẠT** | Không tạo binding canonical, không có `PATCH`, không kiểm được `422` tại đúng field |
| `UC-PROG-06` Kiểm tra thay đổi | Bấm Check trên Draft sạch hiện “Could not start the check”, Result `UNKNOWN`; Network không có `POST` | **KHÔNG ĐẠT** | Không seal Revision, không có tiến trình lớp kiểm/audit; URL Check cũ có query tải được nhưng Refresh→đăng nhập lại làm mất `revisionId/checkId` |
| `UC-PROG-07` Cấu hình Task duy nhất | UI chỉ có `Control_Main`, enum `1/5/30 s` đúng; đổi `1 s→5 s` tạo dirty | **KHÔNG ĐẠT** | Nút Save trong tab không hoàn tất batch; `Save Draft` ở guard rời trang không phát `PATCH` và không đóng dirty. Đã Discard, không làm đổi target |
| `UC-PROG-08` Đưa vào vận hành | Mở được một Check lịch sử `PASSED`, diff/impact `NONE` và khóa Commission đúng khi Core suy giảm/safe | **KHÔNG ĐẠT** | Không tạo được Check mới; deep-link mất query sau vòng đăng nhập; không có bằng chứng phiên hiện tại cho re-auth, timeline, atomic cutover và read-back. Không gửi Commission thật |
| `UC-PROG-09` Operation lỗi nhưng Active tiếp tục | Lịch sử chỉ có Commission `SUCCEEDED`; không có operation `FAILED` phù hợp | **CHƯA ĐỦ** | Không tạo fault thật; chưa quan sát `keepsRunningRevision=true`, Active liên tục và chi tiết lỗi trên live |
| `UC-PROG-10` Core suy giảm/mất kết nối | Banner và Commission khóa khi `DEGRADED`; Runtime ghi rõ Restore phải khóa nhưng nút Restore vẫn mở modal | **KHÔNG ĐẠT** | Vi phạm fail-closed: source coi mọi producer khác `UNAVAILABLE` là reachable, gồm cả `DEGRADED` |
| `UC-PROG-11` Khôi phục phiên bản trước | LKG và modal re-auth có mặt | **KHÔNG ĐẠT** | Restore được phép mở khi Core `DEGRADED`; vì nguy cơ đổi runtime, audit dừng trước xác nhận. Chưa chứng minh impact, atomicity, audit và read-back |
| `UC-PROG-12` Theo dõi/Task overrun/Trace | Khi Core READY, Task có last `6,1 µs`, max `34,1 µs`, overrun `0`, period `1000 ms`, budget `199 ms`; Monitor API `200` nhưng empty | **CHƯA ĐỦ** | Active fixture không có binding, selector `0/32`, Start trace khóa; chưa chứng minh program/actual/owner/priority/quality/freshness hoặc trace positive |
| `UC-PROG-13` RETAIN không tương thích | Dialog nói chưa tải được danh sách biến nhưng vẫn bật “Confirm reset” | **KHÔNG ĐẠT** | Không có danh sách trước/sau, strong acknowledgement hay re-auth; source gửi active Revision UUID viết cứng. Audit hủy modal, không mutation |
| `UC-PROG-14` BACS library nâng cao | Không có route/action hoặc nút teaser | **N/A REV A — ĐÚNG THIẾT KẾ** | Roadmap ngoài Rev A được ẩn đúng |
| `UC-PROG-15` As-built đầy đủ | Không có action/claim “As-built complete” | **N/A REV A — ĐÚNG THIẾT KẾ** | Roadmap ngoài Rev A được giữ đúng ranh giới |
| `UC-PROG-16` Runtime fault/safe-state | Runtime chỉ hiện boolean Safe state | **KHÔNG ĐẠT** | Không có mã, lý do, Task/Point bị ảnh hưởng hay link bảo trì; Tổng quan còn báo không có attention khi safe-state `Yes` |
| `UC-PROG-17` Thay controller/recommission | Chỉ có “Import replacement bundle” | **KHÔNG ĐẠT** | Không có action Export bundle; import dùng `crypto.subtle`/`randomUUID` trên HTTP và chưa có corpus bundle an toàn/độc hại; không chứng minh isolate→rebuild→remap→Check→Commission→read-back |

Tổng hợp: **12/17 KHÔNG ĐẠT**, **3/17 CHƯA ĐỦ**, **2/17 N/A Rev A và
được ẩn đúng**. Không có UC in-scope nào đủ bằng chứng live để nâng thành Test
Result PASS trong lượt này.

## 8. Finding live và điều kiện đóng

| Finding | Mức | UC/thiết kế | Bằng chứng live / nguyên nhân source | Điều kiện đóng |
|---|---|---|---|---|
| `F-PROG-LIVE-001` | Critical | UC-03..08, 11–13, 17 | Endpoint là HTTP nên Web Crypto không cung cấp `crypto.randomUUID`; Console tái hiện khi thêm Program/FBD và Map, Check dừng trước request. Source gọi trực tiếp API này ở editor, draft mutation, Check/Commission, Watch/Trace, Restore, Import và RETAIN | Dùng UUID helper hoạt động đúng trên target HTTP hoặc phục vụ HTTPS; test mọi mutation trên chính endpoint, Console 0 lỗi và Network có request/response đúng |
| `F-PROG-LIVE-002` | High | UC-06/08; deep-link | Protected route chỉ lưu `location.pathname`, bỏ `location.search`; sau session mất và đăng nhập lại, URL Commission mất `revisionId/checkId` | Lưu/khôi phục pathname + search + hash qua login, test reload/deep-link trên browser thật |
| `F-PROG-LIVE-003` | High | UC-02/03/07 | Save cục bộ tạo dirty nhưng `Save Draft` trong guard rời trang không phát `PATCH`/không hoàn tất | Có một batch save rõ ràng, request thành công mới xóa dirty; khóa bằng test network + reload + `409` |
| `F-PROG-LIVE-004` | **Critical** | UC-10/11 | Runtime ghi “Restore is locked” khi Core degraded nhưng `DangerZone.coreReachable` chỉ loại `UNAVAILABLE`; modal Restore vẫn mở | `READY` là trạng thái duy nhất mở mutation; test DEGRADED/UNAVAILABLE/error đều không mở/không gửi request |
| `F-PROG-LIVE-005` | **Critical** | UC-13; §16.4.1 | Dialog mở khi chưa có affected-variable list, Confirm bật, không acknowledgement/re-auth; request dùng UUID active viết cứng | Chỉ mở khi impact đầy đủ; `UNAVAILABLE/null/missing` vào artboard khóa; hiện before/after + strong confirm + re-auth + expected Active thật + operation read-back |
| `F-PROG-LIVE-006` | High | UC-01/16 | Cùng snapshot `Safe state = Yes` nhưng Attention rỗng; Runtime chỉ render boolean | Hiện severity, code, reason, scope Task/Point và action bảo trì; thêm test consistency một snapshot |
| `F-PROG-LIVE-007` | High | UC-12/17 | Monitor/Trace không có positive fixture; UC-17 thiếu Export và import chưa kiểm | Tạo fixture read-only có binding; chạy trace start/get/stop; hoàn chỉnh export/import corpus và toàn luồng recommission không auto-active |
| `F-PROG-LIVE-008` | Medium | UI/UX §16/§26; `UX-T-002` | Fresh profile mặc định English; mobile không có bottom navigation bốn workspace như asset; bảng history PGM-04 bị cắt cột phải ở `390×844` | Mặc định `vi`; đối chiếu lại asset mobile; table responsive không mất nội dung quan trọng; browser + axe desktop/mobile |

## 9. Sai lệch giao diện so với thiết kế UI/UX

| Màn hình | Thiết kế bắt buộc | Hiện trạng live | Kết luận |
|---|---|---|---|
| Toàn Programming | Tiếng Việt là mặc định, English là lựa chọn | Fresh isolated profile mở English; source fallback `mkddc-lang || 'en'` | **Sai** |
| `PGM-01` desktop | Active/Core/Draft/Attention nhất quán trong cùng snapshot | Shell và hierarchy tổng thể gần asset; Draft card thiếu summary Check chi tiết, safe-state `Yes` không tạo Attention | **Sai nội dung quyết định** |
| `PGM-01` mobile `390×844` | Asset có bottom navigation `Tổng quan / Thiết kế / Kiểm tra / Runtime` | Chỉ có AppShell hamburger/header chung, không có bottom navigation Programming | **Sai điều hướng** |
| `PGM-02` | Cây Program, editor ST/FBD, Inspector/Problems, lưu/Check có trạng thái | ST editor và dirty guard phần đọc/sửa nhẹ đúng; thêm FBD/Map/Check vỡ, batch Save không hoàn tất | **Sai hành vi cốt lõi** |
| `PGM-03` | URL canonical, readiness fail-closed, diff/impact/reauth/timeline | View Check cũ và gate Core đúng; reload/login mất query và không tạo được Check mới | **Sai deep-link và luồng chính** |
| `PGM-04` desktop | Danger Zone chỉ ở Service; degraded khóa mutation; RETAIN fail-closed | Vị trí Danger Zone đúng, nhưng Restore fail-open và RETAIN reset trái artboard | **Sai an toàn nghiêm trọng** |
| `PGM-04` mobile `390×844` | Không mất nội dung quan trọng theo chiều ngang | Operation history cắt cột `UPDATED` ở mép phải | **Sai responsive** |

## 10. Tái kiểm sau corrective và deploy

### 10.1 Artifact và môi trường

| Thuộc tính | Kết quả |
|---|---|
| Endpoint | `http://mekong-fac.ddns.net:8082/`; `isSecureContext=false`, `crypto.randomUUID/subtle=undefined` được quan sát trực tiếp |
| Artifact cuối | FE production có `VITE_PROGRAMMING_REV_A=1`; `/opt/mkddc-web/dist/index.html` SHA-256 `30ee074329685a801abaf468c6aaa5d1eacfecc515128e3483ebdd9d9cab5dbd` |
| Deploy/read-back | backup + atomic swap + rollback path; `mkddc-web-pi/core/iobus/netcfg` đều `active`; health Core/SHM/IObus/MCU/Web đều `ok` |
| Trình duyệt | Chromium cô lập desktop `1440×1000`, mobile `390×844`; không lưu credential/token/cookie/header vào hồ sơ |
| Accessibility | 6/6 scan WCAG A/AA cho Overview/Design/Service × desktop/mobile, 0 violation; 0 Console error và 0 request failed trong lượt axe cuối |

Lượt deploy đầu tự rollback do probe chạy trước khi Web bind cổng. Lượt kế tiếp
được browser read-back phát hiện build thiếu cờ FE nên route bị che; bundle đó
được thay ngay bằng artifact đúng cờ. Đây là finding triển khai đã xử lý trong
cùng phiên, không được lược khỏi record.

### 10.2 Đóng finding live

| Finding | Xử lý và bằng chứng sau sửa | Trạng thái hiện hành |
|---|---|---|
| `F-PROG-LIVE-001` | Helper UUID v4 dùng `getRandomValues`; SHA-256 bundle dùng `@noble/hashes`; không còn lời gọi trực tiếp trong source. Live HTTP Save Draft `200`, hoàn nguyên `200`, Export `200`, Import corpus sai đi tới server và nhận `422`. Playwright 10/10 chạy khi cố ý vô hiệu hóa `randomUUID/subtle`. | **CLOSED implementation/root cause**; mutation bị safety gate chặn vẫn cần scenario độc lập |
| `F-PROG-LIVE-002` | `ProtectedShell` lưu `pathname+search+hash`; live login giữ nguyên `/runtime?tab=service#danger-zone`; unit/E2E khóa open redirect. | **CLOSED** |
| `F-PROG-LIVE-003` | Save một batch, chỉ xóa dirty sau response; live sửa ST nhận PATCH `200`, dirty đóng, source được hoàn nguyên bằng PATCH `200`; test `409` vẫn giữ buffer. | **CLOSED** |
| `F-PROG-LIVE-004` | Restore chỉ mở khi `producerState=READY` và `safeState=false`; unit khóa `DEGRADED`, live safe-state xác nhận nút disabled/không modal. | **CLOSED safety gate** |
| `F-PROG-LIVE-005` | Xóa request dùng UUID Active viết cứng. Vì route RETAIN là `contract-only` và không có affected list, nút luôn disabled, không modal, không request; copy nêu đúng điều kiện thiếu. | **CLOSED fail-open**; chức năng RETAIN reset vẫn **BLOCKED** bởi contract/impact |
| `F-PROG-LIVE-006` | Tổng quan và Runtime hiện `PRG-SAFE-ACTIVE`, mức lỗi, lý do chi tiết chưa được Core cung cấp, scope Task/output và hành động; ảnh live xác nhận cùng snapshot. | **CLOSED UI consistency** |
| `F-PROG-LIVE-007` | Thêm Export source-only, live download thành công; Import chạy hash trên HTTP và corpus sai bị backend từ chối `422`. Positive Monitor/Trace binding và recommission toàn chuỗi chưa có fixture an toàn. | **PARTIAL** |
| `F-PROG-LIVE-008` | Fresh profile hiển thị tiếng Việt; bottom nav bốn workspace; operation card mobile; không tràn ngang; thêm label file input và focus vùng audit; axe live 6/6 sạch. | **CLOSED** |

Ảnh live sau sửa:

- [Overview desktop](../test-evidence/fw-som/programming-plan53-corrective/foxlinx-live-fix-overview-desktop.png)
- [Design đã hoàn nguyên source](../test-evidence/fw-som/programming-plan53-corrective/foxlinx-live-fix-design-restored-desktop.png)
- [Service desktop](../test-evidence/fw-som/programming-plan53-corrective/foxlinx-live-fix-service-desktop.png)
- [Service mobile 390×844](../test-evidence/fw-som/programming-plan53-corrective/foxlinx-live-fix-service-mobile-390x844.png)

### 10.3 Trạng thái 17 use case sau sửa

| UC | Trạng thái supporting hiện hành | Ranh giới chưa được phép nâng thành Test Result |
|---|---|---|
| `01` | **PASS supporting live**: safe-state tạo attention/action nhất quán | chưa có reviewer độc lập |
| `02` | **PASS supporting live**: PATCH/dirty/read-back và hoàn nguyên source | nhánh 409 chỉ có host test trong lượt này |
| `03` | **KHÔNG ĐẠT live 2026-08-14**: Check FAILED xong sửa/lưu sinh conflict 409; diagnostic không có dòng/cột | source tạo ST rỗng và bỏ ETag/base mới sau seal; xem mục 11 |
| `04` | **PARTIAL**: FBD keyboard/canonical save PASS E2E không-secure simulation | không tạo/xóa FBD trên dữ liệu live |
| `05` | **PARTIAL**: mapping PASS E2E không-secure simulation | không đổi binding live |
| `06` | **PARTIAL**: UUID và deep-link đóng; seal/Check PASS E2E | chưa tạo Check live mới |
| `07` | **PARTIAL**: batch save/dirty guard PASS; PATCH live chứng minh transport | chưa đổi Task live |
| `08` | **PARTIAL**: deep-link/readiness/re-auth/timeline PASS E2E; live safety gate đúng | không gửi Commission mới |
| `09` | **CHƯA ĐỦ** | thiếu operation fault target có Active continuity |
| `10` | **PASS supporting safety** | DEGRADED có unit/E2E; live hiện safe-state, không inject mất Core |
| `11` | **PARTIAL**: Restore fail-closed đúng | không gửi Restore do safe-state |
| `12` | **CHƯA ĐỦ** | fixture active chưa có Variable Binding cho positive Trace |
| `13` | **PASS supporting safety containment** | route vẫn contract-only, chưa có chức năng reset hợp lệ |
| `14` | **N/A Rev A — đúng thiết kế** | roadmap |
| `15` | **N/A Rev A — đúng thiết kế** | roadmap |
| `16` | **PASS supporting live**: code/reason/scope/action hiện rõ | reason chi tiết vẫn cần Core contract mở rộng |
| `17` | **PARTIAL**: Export live `200`, Import invalid `422`, không auto-active | chưa chạy replacement/rebuild/remap/Commission toàn chuỗi |

Không use case nào ở bảng này được đổi thành `TR-PROG-* PASS`. Các blocker còn
lại có owner và điều kiện mở ở mục 5; `F-PROG-LIVE-007`, usability người thật,
HIL/fault/power và reviewer độc lập tiếp tục chặn `RELEASE_READY`.

## 11. Tái kiểm tập trung UC-PROG-03 ngày 2026-08-14

| Bước | Kết quả live | Phán quyết |
|---|---|---|
| Mở workspace/bước 2 | Chưa auto-select Program; desktop không có nav nội bộ bốn workspace | Gap IA/discoverability |
| Thêm token sai, lưu, Check | Check `FAILED`, Active không đổi; Problems chỉ có `PRG-ERR-SCOPE-001`, không dòng/cột | **Không đạt VS-PROG-005/006** |
| Sửa token, lưu lại | Banner conflict 409; expected/current đều `—` | **Không đạt vòng sửa và lặp lại UC-03** |
| Recovery | Tải lại concurrency state rồi lưu source hợp lệ thành công; Active giữ nguyên | Draft đã hoàn nguyên; không có runtime mutation |

Root cause source và bảng 12 finding được chốt tại
[`REV-PROG-ASBUILT-GAP-2026-08-14`](PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md).
Ảnh theo thứ tự:
[bước 2](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-current-step2-desktop.png),
[Check FAILED](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-check-failed-before-fix-desktop.png),
[conflict](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-etag-conflict-before-fix-desktop.png),
[Draft đã phục hồi](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-draft-restored-after-repro.png).

## 12. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.5 | 2026-09-06 | Thêm banner authority phân biệt PGM-03/04 của baseline bốn workspace với PGM-03/04/05/06 hiện hành; không đổi phán quyết hoặc evidence lịch sử. |
| 1.0 | 2026-08-13 | Audit baseline, mở 508..510 và ghi corrective source/host ban đầu; target còn bị chặn SSH. |
| 1.1 | 2026-08-13 | Ghi full gate host, deploy/read-back/rollback Foxlinx, Chrome desktop/mobile và axe 8/8 scan sạch; đóng blocker SSH/tool accessibility, giữ đúng blocker merge, positive binding target, usability và Test Result độc lập. |
| 1.2 | 2026-08-13 | Kiểm tra lại live trên endpoint Product Owner chỉ định, đủ 17 UC ở desktop/mobile; ghi 12 UC không đạt, ba UC chưa đủ, hai UC roadmap đúng ranh giới và tám finding live; hạ phán quyết target về `RELEASE_READY BLOCKED`. |
| 1.3 | 2026-08-13 | Sửa và deploy finding 1.2: HTTP-safe UUID/SHA, deep-link, save, fail-closed Restore/RETAIN, safe-state detail, Export/Import, i18n/mobile/a11y; live Save+revert/Export/invalid Import và axe 6/6 PASS supporting. Giữ `F-PROG-LIVE-007` partial và 0/32 Test Result PASS. |
| 1.4 | 2026-08-14 | Tái hiện UC-PROG-03 trên Foxlinx: ST mới source rỗng; diagnostic thiếu dòng/cột; Check FAILED làm lần lưu sửa tiếp theo xung đột do FE giữ ETag/base cũ. Hoàn nguyên Draft hợp lệ, Active không đổi; hạ UC-03 thành KHÔNG ĐẠT và dẫn báo cáo PM/CTO. |
