# Hồ sơ rà soát — chỉ mục

**ID:** REC-REVIEW-INDEX-001
**Phiên bản:** 1.37
**Trạng thái:** Active
**Cập nhật:** 2026-09-30 (đăng ký record rà tài liệu thiết kế FW SOM ↔ FW MCU và phương án ghép nối); 2026-09-29 (mở rộng review 29 tuyến giao diện, đối chiếu 7 hãng/hệ sinh thái, refactor và concept cho tích hợp BMS; không thay release gate; bổ sung review hiệu năng source FW SOM/BE và benchmark Historian)
**Chủ quản:** Project Engineering

Thư mục này chứa **record** — biên bản của một lần rà soát, một lần phê duyệt
hoặc một lần triển khai đã diễn ra. Record **không phải** design authority: nó
ghi lại điều đã quan sát được vào một thời điểm, và không tự đóng requirement hay
release gate ([Document Control](../../00_governance/CONTROL.md)).

Ba điều cần biết trước khi dùng bất kỳ tài liệu nào ở đây:

1. **Ngày của record là ngày của sự thật trong đó.** Một finding ghi "còn mở"
   năm ngoái không chứng minh hôm nay nó còn mở, và ngược lại. Cột *Trạng thái*
   dưới đây là kết quả đối chiếu lại với mã nguồn tại ngày cập nhật ở trên.
2. **Record viết trước `PLAN-ARCH-RESTRUCT-002` (2026-08-03) dùng cây thư mục
   cũ.** Xem bảng ánh xạ ở §3 — các path `services/`, `web/`, `src/frontend/`,
   `fw/`, `shared/`, `packaging/` đều **không còn tồn tại**.
3. **Hồ sơ lịch sử không phải nguồn chuẩn.** Các bản đã mất hiệu lực được loại
   khỏi cây Markdown và phục hồi từ commit Git được ghi ở §2; không dẫn chúng
   làm hiện trạng khi làm việc mới.

---

## 1. Hồ sơ đang hiệu lực

### 1.1 Rà soát mã nguồn và giao diện

| Hồ sơ | Ngày | Trạng thái | Nội dung |
|---|---|---|---|
| [Rà soát thiết kế FW SOM ↔ FW MCU và phương án ghép nối](DDC24_FW_SOM_MCU_PAIR_INTEGRATION_REVIEW_2026-09-30.md) | 2026-09-30 | Bản 1.2. Record rà **tài liệu** (không review mã) tại `e34d0a2f`; chủ dự án đã chốt [ADR-064/PA-B](../../adr/ADR-064-iop-v3-hai-bien-the.md) cho **V3.0 duy nhất**; [ICD v3.0](../../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) và [FW-REQ v3.1](../../01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md) vẫn Draft về chi tiết; source SOM V2.0 chưa đổi (`REC-DDC-FWSOM-MCU-PAIR-20260930`) | Snapshot 17 finding PAIR-01..17 và khuyến nghị v2.1 trước quyết định; §0–§6 là lịch sử. Lộ trình P0–P3 chưa chạy; 8/8 chưa có hồ sơ HW chuẩn |
| [Hiện trạng và dư địa hiệu năng FW SOM / BE](DDC24_FW_SOM_BE_PERFORMANCE_SOURCE_REVIEW_2026-09-29.md) | 2026-09-29 | In Review, source `895444be` và HOST; không thay Design/release authority (`REC-DDC-FW-BE-PERF-20260929`) | Kiến trúc/logic Core–IOBus–Go, đối chiếu Plan 63, 10 finding; benchmark Historian 8 điểm/24 h: 1,12–1,15 s và khoảng 256 MiB tổng cấp phát/query trên HOST; phương án, metric, effort/risk và pilot |
| [Review giao diện và source frontend DDC-24](DDC24_UI_SOURCE_REVIEW_2026-09-29.md) | 2026-09-29 | In Review v1.1; Programming tại `265f1a8b`, mở rộng tại `101d1fdf`, host và Chrome demo/fixture (`REC-DDC-UI-REVIEW-20260929`) | 7 finding UI (5 lượt Programming + 2 mới), 4 khoảng thiếu; 29 tuyến desktop/mobile; nguồn/bằng chứng/giới hạn rõ; chưa sửa source FE hoặc đánh giá release. |
| [Bảng đề xuất cải thiện giao diện DDC-24](DDC24_UI_IMPROVEMENT_PROPOSALS_2026-09-29.md) | 2026-09-29 | 16 đề xuất chờ Product review, v1.1 (`REC-DDC-UI-PROPOSAL-20260929`) | 7 hãng/hệ sinh thái, 9 concept SVG, pilot tích hợp BMS và refactor theo ownership; lợi ích/công/rủi ro/nghiệm thu; kèm [ảnh/log bằng chứng](assets/ui-review-2026-09-29/EVIDENCE.md), chưa là design authority. |
| [Rà soát kiến trúc, lời giải và đối chiếu DDC-24](DDC24_ARCHITECTURE_SOLUTION_COMPARATIVE_REVIEW_2026-09-26.md) | 2026-09-26; bổ sung 27/09 | Record source + nguồn chuẩn/hãng; release `NO-GO` (`REC-DDC-ARCH-COMP-20260926`) | Sơ đồ POU/Commission/output, so sánh hãng và **§9: chín đề xuất `CP-01..09` để Product review**, có lợi ích, phần nền hiện có, phép thử pilot và quyết định cần ký. |
| [Finding và đề xuất kiến trúc DDC-24](DDC24_ARCHITECTURE_GAP_FINDINGS_PROPOSAL_2026-09-26.md) | 2026-09-26 | 7 finding có trạng thái và gate; record, chưa phải design authority (`REC-DDC-ARCH-GAP-20260926`) | Hồ sơ chu kỳ lệch profile; BACnet object thiếu nguồn; safe output khi đổi package; soak/HIL; 70 ms Commission; Modbus write result; ma trận audit trộn thời điểm. |
| [Đánh giá mã nguồn DDC-24 qua sử dụng thực tế](DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md) | 2026-09-27; cập nhật 28/09 | 21 vấn đề cần nâng cấp/cải tiến; bản 1.4: PR #795, #797, #803, #804 đã merge và bo lab chạy `main@e3072983`; các mục còn lại chờ thiết kế/quyết định (#798–#802, #384); record, chưa phải design authority (`REC-DDC-FIELD-USE-20260927`) | Rút từ việc viết, triển khai và kiểm từng chu kỳ `PRG_DO16_MODBUS` trên bo: kiểu VP lệch 3 lớp, Trace báo sai nguồn/chu kỳ, Modbus không gộp FC15, trần slot, ngôn ngữ ST thiếu ARRAY/bit/hằng, thư viện thiếu khối DDC, PID bị chặn; kèm lộ trình |
| [Audit Modbus RTU — finding, gap, logic tìm lỗi, hai phương án](MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS.md) | 2026-09-25 | Record tại mốc `36c1a863`; `MBA-FW-08` đã sửa bằng `ext_cmd_seq` theo audit Programming sau đó; các gap còn lại cần đối chiếu (`REC-MBA-GAP-001`) | Sáu phép kiểm theo đường dữ liệu; 10 finding đã sửa kèm test đỏ→xanh; 9 gap được ghi tại mốc audit (gồm kết quả ghi đầu–cuối và ST ghi theo index slot); hai phương án thiết kế chưa được record này phê duyệt |
| [Audit Modbus RTU — hoạt động trên bo Forlinx](MODBUS_AUDIT_2026-09-25_BOARD_OPERATION_REPORT.md) | 2026-09-25 | TARGET/runtime, Fake MCU — không phải HIL (`REC-MBA-BOARD-001`) | Log 5 lần boot (309.672 `write_fail` khi thiết bị offline); 4/4 thiết bị online, lỗi poll 0,013 %; SCHED_FIFO sai ở thread phụ; deploy `2840392f`/`efb3e4ae` và kiểm chứng 4 bản sửa trên bo; `ttyS1` (bus 2) không tồn tại |
| [Audit Modbus RTU — hiện trạng mã nguồn FE/BE/FW SOM](MODBUS_AUDIT_2026-09-25_SOURCE_STATUS.md) | 2026-09-25 | Record đối chiếu `36c1a863` (`REC-MBA-SRC-001`) | Kiến trúc 3 tiến trình, 3 đường dữ liệu; đường đọc chín, đường ghi dùng cờ mức không danh tính; đối chiếu 20 gap F-FW của thiết kế |
| [Hiện trạng và đề xuất đại tu Program Property / Inspector](PROGRAMMING_PROGRAM_PROPERTY_INSPECTOR_AS_BUILT_GAP_REPORT_2026-09-09.md) | 2026-09-09 | **PARTIAL / CHƯA MATCH `d.md` / READY FOR CONTROLLED PLANNING** (`REC-PGM02-PROP-INS-001`) | Rà FE→web-api→Core/FW-SOM theo G-12..G-21: 0/10 đạt đầy đủ; form Property bị lặp; Task/Enable/interface/metadata/reference còn gap; không cần đổi FW-SOM/STM32 cho Rev A |
| [Authority trực quan Programming PGM-01..06](AUTH-UX-PROG-2026-09-08-01.md) | 2026-09-08 | **APPROVED / ACTIVE** (`AUTH-UX-PROG-2026-09-08-01`) | Gói FE Handoff PNG/HTML là authority composition; loại 15 SVG Programming sai; thay riêng `D61-06`; issue #556 đóng `NOT_PLANNED`; không claim As-Built/runtime/HIL/release |
| [Hiệu năng Programming/runtime và khả năng cạnh tranh](PROGRAMMING_RUNTIME_PERFORMANCE_COMPETITIVE_REVIEW_2026-09-04.md) | 2026-09-04; audit 28/09; đối chiếu mã 28/09 | **v1.3: snapshot 04/09 giữ riêng; §13 audit TARGET/OS/API/browser; §14 đối chiếu 21 finding tại `main@cb690dfb`; provenance `PARTIAL`, chưa tối ưu/HIL/release** (`REC-PROG-RUNTIME-PERF-COMP-001`) | §13: 61 mẫu/323,62 s, 200 GET, log giữ khoảng 21h54; IOBus late-wake tới 16,345 ms, Core vi phạm jitter, 206 lỗi snapshot Point, API status chờ 100 ms, log dày và assets không nén. §14: `F-PRG-PERF-001` mức độ tăng sau ADR-061, `-002` còn một nửa, `-005/006` chờ read-back, `-007` đóng; thêm `PERF-SYS-06/07`; thi hành qua Plan 63 |
| [Báo cáo hiệu năng Forlinx trình PM](FORLINX_PERFORMANCE_PM_REVIEW_2026-09-28.md) | 2026-09-28 | **Quyết định một phần: G0 Plan 63 duyệt 2026-09-28 (D01/D02/D06/D07); D03–D05 chờ cổng** (`REC-FORLINX-PERF-PM-20260928` 1.2; Issue #809) | Hiện trạng theo audit, 9 nhóm finding, phương án/lợi ích/rủi ro, trình tự/tiêu chí đề xuất và phiếu PM giao owner/lịch/phạm vi; chưa deploy tối ưu |
| [Gap hệ Point & I/O vs đề bài 3 nguồn Point](POINT_IO_PRODUCT_SPEC_GAP_REVIEW_2026-08-31.md) | 2026-08-31 | **b2.3 — APPROVED, 36 issue đã tạo (#375–#410), 33 đã phân công** (`REV-PIO-3SRC-001`) | Chấm Physical/Virtual/Modbus → Canonical Point Catalog → Binding theo 34 mục + 16 UC. Kiến trúc được chấp thuận, không redesign nền. 29 finding (7 Cao — `F-PIO-029` slot `ext` không ổn định). Kế hoạch 36 issue / 7 đợt / 82,0 ngày-người kèm `AC-PIO-ID-01/02/03` trong `ISS-PIO-31`. Đường găng P0 khoá: #375 → #376 → #377 → #378/#379 → #381 → #382. Ba quyết định Owner: DI = A, `AO` giữ trong hợp đồng, `Program Disable` ≠ `Controller Fault`. 33 issue FE/BE gán `@haizzdungnay` |
| [Gap ST Editor vs chuẩn IEC 61131-3-aligned](ST_EDITOR_IEC61131_GAP_REVIEW_2026-08-31.md) | 2026-08-31 | **APPROVED WITH CONDITIONS** (`REV-STED-IEC-001`) | 18 gate + 12 UC. Lõi ngôn ngữ đạt, đường chẩn đoán từ compiler tới người dùng hỏng ở cả ba tầng. 15 finding, 20 issue; phạm vi ngôn ngữ đã ký bằng `ADR-054` |
| [Thi hành `DEV-PROG-001..018` giao diện Programming](PROGRAMMING_UI_DEV_PROG_001_018_2026-08-28.md) | 2026-08-28 | Đã thi hành 18/18 (`REC-PGM02-DEVPROG-001`) | 18 mục review giao diện `/eng/programming/programs` của chủ sở hữu; một mục cần ký lại |
| [Phán quyết gap analysis auditor — PGM-02](PROGRAMMING_PGM02_AUDIT_GAP_ADJUDICATION_2026-08-27.md) | 2026-08-27 | Adjudicated v1.1 (`REC-PGM02-AUD-ADJ-001`) | 4 finding hợp lệ chuyển thành task; phần bác bỏ status bar đã đảo ngược sau khi có ảnh render |
| [Gap Universal Input FE vs 12 UC đề xuất](UI_UNIVERSAL_INPUT_FE_GAP_REPORT_2026-08-14.md) | 2026-08-14 | Record (không phải bug) | `InputsPage.tsx` mirror thanh ghi firmware `u0..u7`; đáp ứng 1/12 UC đầy đủ, 8 một phần, 3 chưa có so với đề xuất phân lớp Electrical Mode/Sensor Profile/Fault Detection — gap nằm ở tầng dữ liệu Core, không chỉ FE |
| [Rà soát BE + FE theo module](CODE_REVIEW_BE_FE_2026-08-06.md) | 2026-08-06 | **Đã đóng** 2026-08-08 (14 sửa · 1 hết hiệu lực) | 15 finding `REV-BE/FE/PLT-*`; xử lý theo [Plan 51](../../03_implementation/51_BE_FE_FINDINGS_REMEDIATION_PLAN.md) |
| [Soi lỗi giao diện theo từng trang — board Foxlinx](FE_BOARD_PAGE_AUDIT_2026-08-06.md) | 2026-08-06 | Đã đóng | 23/23 trang render, 0 trang trắng sau khi vá; Chromium thật qua SSH tunnel |
| [Review giao diện trên board thật](FE_BOARD_UI_REVIEW_2026-08-06.md) | 2026-08-06 | Đã đóng (PR #95) | `FE-DIAG-01` — ControllerDiagram bịa dữ liệu simulator ở chế độ live |
| [Vì sao "lỗi hết mấy cái page"](FE_PAGES_ERROR_REVIEW_2026-08-05.md) | 2026-08-05 | Đã đóng (PR #93, #94) | 4 nhóm nguyên nhân độc lập trên 27 route |
| [Code Review Modbus RTU](MODBUS_RTU_CODE_REVIEW_2026-08-04.md) | 2026-08-04 | Một phần còn mở | 14 defect source; phân biệt DEFECT với GAP thiết kế |

### 1.2 Scheduler v3.1

| Hồ sơ | Ngày | Trạng thái | Nội dung |
|---|---|---|---|
| [Tờ trình phê duyệt Scheduler v3.1](SCHEDULER_V3_1_APPROVAL_REQUEST_2026-08-07.md) | 2026-08-07 | **Đã phê duyệt** | 6 quyết định kiến trúc → ADR-023 |
| [Review P1](SCHEDULER_V3_1_P1_REVIEW_2026-08-07.md) | 2026-08-07 | Đã đóng bởi P1_EXIT | 10 finding, 3 mức Cao |
| [P1_EXIT_REVIEW](SCHEDULER_V3_1_P1_EXIT_REVIEW_2026-08-07.md) | 2026-08-07 | Đã đóng | 9/10 finding đóng; `MIGRATION_REAL_FILE = N/A`; đã deploy Foxlinx |

### 1.3 Modbus RTU — thiết kế, phê duyệt, as-built

| Hồ sơ | Ngày | Trạng thái | Nội dung |
|---|---|---|---|
| [Biên bản phê duyệt](MODBUS_RTU_APPROVAL_RECORD_2026-08-04.md) | 2026-08-04 | **Authority** | `TRACK_A_APPROVED=YES`, `TRACK_B_APPROVED=CONDITIONAL`, `PRODUCTION_READY=NO` |
| [Tờ trình phê duyệt Track B](MODBUS_RTU_APPROVAL_REQUEST_2026-08-05.md) | 2026-08-05 | Chờ duyệt | Tổng hợp 12 tài liệu thiết kế + 5 điểm xin phê duyệt |
| [Phiếu xác nhận mở Track B](MODBUS_RTU_TRACKB_SIGNOFF_2026-08-04.md) | 2026-08-04 | Superseded một phần | Phần "Trạng thái" đã bị Biên bản phê duyệt thay thế |
| [Báo cáo PM/CTO](MODBUS_RTU_PM_CTO_REVIEW_BRIEF_2026-08-04.md) | 2026-08-04 | Record | 10 rủi ro, 11 câu hỏi quyết định |
| [Docs Sync Report](MODBUS_RTU_DOCS_SYNC_REPORT.md) | 2026-08-05 (b2.0) | Record | Mâu thuẫn đã xử lý, gap P0/P1/P2, kết luận gate |
| [As-Built Modbus RTU Point](MODBUS_RTU_POINT_AS_BUILT_REPORT.md) | 2026-08-03 | Record | Hoàn thiện trên host/simulator; **chưa** acceptance với RS485 thật |
| [Báo cáo phương án thiết kế Point](MODBUS_RTU_POINT_DESIGN_REVIEW_PROPOSAL.md) | 2026-08-03 | In Review | `MODBUS_RTU_POINT_READY = NO`; 4 nhóm P0 |

### 1.4 Nền source, triển khai và đóng plan

| Hồ sơ | Ngày | Trạng thái | Nội dung |
|---|---|---|---|
| [Baseline Source Fix Report](DDC24_BASELINE_SRC_FIX_REPORT.md) | 2026-08-03 | Record | CI, Point Model, Config Apply, health/recovery trước Programming Design |
| [Programming Docs Sync Report](PROGRAMMING_DOCS_SYNC_REPORT.md) | 2026-08-03 | Historical record | Đồng bộ baseline cũ; Product v3.0/ADR-050/Unified DDD hiện là authority |
| [Programming As-Built/gap trình PM/CTO](PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md) | 2026-08-14 | **Active — NO-GO release** (Rev 1.3) | Tổng kết source Core/BE/FE/contract; 15 finding, đóng 5 (`F-001/002/003/004/007`) + D-01/02/04; Binding Variable↔Point (F-013/D-07) đã triển khai + target-verify cho `LOCAL`; mở `F-005/006/008/009/014/015` |
| [Audit FE/UI/UX Programming Plan 53](PROGRAMMING_FE_UX_IMPLEMENTATION_AUDIT_2026-08-13.md) | 2026-08-14 | **v1.4 — UC-PROG-03 KHÔNG ĐẠT** | Live source rỗng/diagnostic thiếu location/ETag-base stale; Draft đã hoàn nguyên, Active không đổi |
| [Hiện trạng & GAP Overview + ST/FBD editor](PROGRAMMING_OVERVIEW_DESIGN_FEATURE_GAP_REPORT_2026-08-15.md) | 2026-08-15 | Historical As-Built record | Snapshot trước ADR-050; finding còn đúng đã chuyển vào Unified DDD/Plan59, các câu hỏi Product cũ không còn là Open Decision |
| [Programming Design Set Review](PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md) | 2026-08-09 | Complete | Rà 22 hồ sơ Programming: 12 finding tài liệu đã đóng, 22/22 đạt M3; M4/M5 chờ người thật |
| [Gói review cổng P0 Programming](PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md) | 2026-08-11 | **v2.0 — APPROVED FOR IMPLEMENTATION** | `AUTH-PROG-2026-08-11-03`; P0 7/7 DONE; `PLAN_READY` và mọi `IMPLEMENT_READY[*]` PASS |
| [Manifest baseline Programming thống nhất](PROGRAMMING_UNIFIED_BASELINE_MANIFEST_2026-08-20.md) | 2026-08-20 | **Active** | Ghim SHA-256 authority set Product/SRS/DDD/UX/VVP/Trace/Risk/Plan/Prompt; kiểm bằng `candidate_pin_check.py` |
| [Manifest candidate P0 Programming](PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md) | 2026-08-11 | **Superseded** | Snapshot 22 hồ sơ baseline cũ; chỉ dùng truy nguyên, không phải pin hiện hành |
| [Rà soát môi trường P0 Programming](PROGRAMMING_P0_ENVIRONMENT_READINESS_2026-08-10.md) | 2026-08-11 | **v1.2 — implementation entry approved** | CI/target/HIL chưa có evidence nhưng được loại khỏi entry condition; không chặn code |
| [Consumer review liên chức năng P0 Programming](PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md) | 2026-08-11 | **v1.6 — `8/8 WAIVED FOR IMPLEMENTATION`** | `9/9` finding đóng; không giả 8 chữ ký; maturity vẫn 0/22 M4 nhưng không chặn implementation |
| [Review triển khai G1 Programming](PROGRAMMING_G1_IMPLEMENTATION_REVIEW_2026-08-11.md) | 2026-08-11 | **P1 DONE 6/6 — G1 GO** | `TASK-PROG-100..105 DONE`; join/deploy/rollback PASS; 2 record BLOCKED, 0/32 PASS |
| [Biên bản join hợp đồng G1 Programming](PROGRAMMING_G1_CONTRACT_REVIEW_20260811.md) | 2026-08-11 | **GO cho P2/P3 implementation** | 6/6 contract cùng hash/major; self-test/order âm/rollback PASS; không bật Commission |
| [Review triển khai G2 Programming](PROGRAMMING_G2_IMPLEMENTATION_REVIEW_2026-08-11.md) | 2026-08-11 | **TASK-PROG-200..207 DONE — P2 8/8** | Compiler/Project/Check/bundle/assurance có source host; Test Result giữ 0/32 PASS; bàn giao P3 |
| [Review triển khai G3 Programming](PROGRAMMING_G3_IMPLEMENTATION_REVIEW_2026-08-11.md) | 2026-08-11 | **TASK-PROG-300 DONE — P3 1/8** | Prepared runtime ngoài scan, boundary/LKG allocation gates và post-link no-parser/compiler PASS; next Task 301; target/release còn BLOCKED |
| [Deployment Provenance Report](DEPLOYMENT_PROVENANCE_REPORT.md) | 2026-08-03; cập nhật lịch sử 2026-09-05 | Record lịch sử; `d728fa76` đã bị deployment mới hơn supersede về hiện trạng | Build identity, manifest 29 raw artifact, SOURCE/HOST/CROSS-BUILD/TARGET/FAKE-MCU/BROWSER; không mở HIL/rollback/`RELEASE_READY` |
| [Physical I/O và HIL](PHYSICAL_IO_HIL_REPORT.md) | 2026-08-03 | **Gate còn mở** | Host/fake-MCU **không** được ghi thành HIL vật lý |
| [Báo cáo build và deploy lên board](BOARD_DEPLOY_REPORT_2026-08-04.md) | 2026-08-04 | Record | 5 service chạy trên Orange Pi 5B, HMI tắt có chủ đích |
| [RST-205 Closure Review](RST205_CLOSURE_REVIEW_2026-08-04.md) | 2026-08-04 | Đã đóng Plan 46 | Đối chiếu tiêu chí §9, regression, rollback |

### 1.5 Phần cứng

Hồ sơ rà soát phần cứng có index riêng: [hardware/README.md](hardware/README.md).
Tài liệu tổng [HW/FW/SOM/HMI review 2026-07-22](KX-DDC24-HW-FW-SOM-HMI-REVIEW-2026-07-22.md)
giữ nguyên vị trí vì [Hardware detailed design](../../04_design/hardware/README.md)
dẫn chiếu nó như bản ghi quyết định `NO-GO` hiện hành.

---

## 2. Hồ sơ lịch sử đã loại khỏi cây Markdown

12 record từng nằm trong `reviews/archive/` đã bị thay thế hoàn toàn và dùng
cây source trước `PLAN-ARCH-RESTRUCT-002`; chúng được loại ngày 2026-08-14 để
không tiếp tục xuất hiện cạnh hồ sơ hiện hành. Nội dung đầy đủ phục hồi được từ
commit `b69fdf152fd1b424bb4ab2239b5cf97b0e86b554`.

| Cụm | Tài liệu | Vì sao là lịch sử |
|---|---|---|
| Program Runtime / IEC 61131-3 | 6 tài liệu C0/C1–C10, gap assessment, design doc review, decision request, readiness | Toàn bộ có trước ADR-023; [Document Control](../../00_governance/CONTROL.md) đã tuyên bố chúng **không phải authority** cho Product Spec mới cho tới khi reconcile và phê duyệt lại |
| Rà soát 2026-07-30 | Code review FE/BE/FW SOM + yêu cầu fix FW SOM | 23/23 finding đã xử lý và deploy; mọi path trong đó thuộc cây source đã bị xoá |
| Audit UI/UX 2026-07-30 | Product & design audit Web UI | Đánh giá `src/frontend/` — cây thư mục không còn tồn tại; đã bị các review FE 08-05/08-06 thay thế về hiện trạng |
| Trang `settings/network` | Báo cáo tình trạng triển khai 2026-07-31 | Record theo mốc `87a0ff0` với cây source cũ |
| Triển khai HMI 2026-07-22 | Báo cáo build/test/deploy HMI → FW SOM | Đã bị [Board Deploy Report 2026-08-04](BOARD_DEPLOY_REPORT_2026-08-04.md) thay thế |

---

## 3. Ánh xạ đường dẫn trước và sau khi tái cấu trúc

`PLAN-ARCH-RESTRUCT-002` (ADR-025, đóng 2026-08-04) đã xoá toàn bộ path cũ. Mọi
tài liệu ghi ngày **trước 2026-08-03** dùng bộ path bên trái:

| Đường dẫn trong hồ sơ cũ | Vị trí hiện tại |
|---|---|
| `services/core/` | `apps/core/` |
| `services/iobus/` | `apps/iobus/` |
| `services/hmi/` | `apps/hmi/` |
| `services/netcfg/` | `apps/netcfg/` |
| `web/backend/` | `apps/web-api/` |
| `src/frontend/` | `apps/web-ui/` |
| `fw/` | `firmware/stm32/` |
| `shared/mkddc_shm.h` | `contracts/shm/mkddc_shm.h` |
| `shared/iop_protocol.h` | `contracts/iop/iop_protocol.h` |
| `shared/*.schema.json` | `contracts/config/` |
| `packaging/` | `platform/packaging/` |
| `services/CMakeLists.txt` | `CMakeLists.txt` ở gốc repo |

Root `CMakeLists.txt` là authority build sau `PLAN-ARCH-RESTRUCT-002`. Lệnh build
và các bẫy đã biết ghi trong [`CLAUDE.md`](../../../CLAUDE.md).

---

## 4. Quy tắc thêm hồ sơ mới vào thư mục này

1. Đặt tên `<CHỦ_ĐỀ>_<LOẠI>_<YYYY-MM-DD>.md` và mở đầu bằng khối metadata:
   **ID · Ngày · Phạm vi · Mốc mã nguồn (commit) · Người rà · Kết luận**.
   Không có mốc commit thì finding không kiểm chứng lại được.
2. **Thêm một dòng vào bảng ở §1 trong cùng phiên.** Chỉ mục không tự cập nhật;
   thư mục này từng có 34 tài liệu mà không có chỉ mục nào, và đó là lý do các
   finding đã đóng vẫn nằm lẫn với finding còn mở suốt nhiều tuần.
3. Finding phải dẫn `file:dòng` và mô tả **kịch bản hỏng cụ thể**, không phải
   nhận xét chung.
4. Khi finding được đóng: cập nhật **chính tài liệu record đó** (mục trạng thái)
   và dòng tương ứng ở §1 — không mở một file mới để nói rằng file cũ đã cũ.
5. Khi tài liệu bị thay thế hoàn toàn hoặc mất hiệu lực, hợp nhất phần còn giá
   trị vào hồ sơ chủ quản, ghi commit phục hồi rồi loại file; sửa mọi link trỏ
   tới bản cũ trong cùng thay đổi.

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Tạo chỉ mục đầu tiên cho thư mục; đối chiếu trạng thái 34 tài liệu với mã nguồn tại `18bd295`; tách 12 hồ sơ lịch sử sang `archive/` và sửa link trỏ tới chúng; bổ sung bảng ánh xạ đường dẫn trước/sau tái cấu trúc |
| 1.1 | 2026-08-10 | Đăng ký gói review P0 và manifest candidate `e3e9fb2`; phân biệt pin cấu hình PASS với authority review/sign-off còn BLOCKED |
| 1.2 | 2026-08-10 | Đăng ký record readiness môi trường P0; tách host/evidence PASS phần chuẩn bị khỏi CI/target/HIL BLOCKED |
| 1.3 | 2026-08-11 | Đồng bộ `AUTH-PROG-2026-08-11-03`: gói P0 v2.0, candidate v2.8/manifest v3.2 tại commit `b068b7d`, consumer review v1.6 và environment v1.2; `PLAN_READY` và mọi `IMPLEMENT_READY[*]` PASS |
| 1.4 | 2026-08-11 | Đăng ký review triển khai G1 cho `TASK-PROG-100/101`; P1 đạt 2/6, evidence hỗ trợ tách khỏi Test Result chính thức và giữ `RELEASE_READY BLOCKED` |
| 1.5 | 2026-08-11 | Đồng bộ review G1 sau `TASK-PROG-102`; P1 đạt 3/6, candidate v2.11 ghim As-Built Artifact/Loader và vẫn giữ 0/32 Test Result, feature flag `OFF`, `RELEASE_READY BLOCKED` |
| 1.6 | 2026-08-11 | Đồng bộ review/evidence G1 sau `TASK-PROG-103`; P1 đạt 4/6, candidate v2.12 ghim catalog lỗi ba lớp và exact loader mapping; giữ 0/32 Test Result, feature flag `OFF`, `RELEASE_READY BLOCKED` |
| 1.7 | 2026-08-11 | Đồng bộ review/evidence G1 sau `TASK-PROG-104`; P1 đạt 5/6, candidate v2.13 ghim SQLite store/migration/backup As-Built; giữ 0/32 Test Result, feature flag OFF, RELEASE_READY BLOCKED |
| 1.8 | 2026-08-11 | Ghi provenance PR #135/merge `1f651b7`/tree `94326834` cho candidate v2.13; remote feature branch đã xóa, trạng thái evidence không đổi |
| 1.9 | 2026-08-11 | Đăng ký biên bản exit G1 và evidence Task 105; P1 6/6 DONE, G1 GO cho P2/P3; hai record VS-001/019 BLOCKED, 0/32 PASS |
| 1.10 | 2026-08-11 | Ghi provenance PR #137/merge `e6ab04b`/tree `9a022f96` cho candidate v2.14; remote feature branch đã xóa, trạng thái G1/evidence không đổi |
| 1.11 | 2026-08-11 | Đăng ký review/evidence G2 cho `TASK-PROG-200`; P2 1/8, candidate v2.15 ghim Language/Artifact/Risk/Trace/Plan As-Built; giữ 0/32 PASS, feature flag OFF và RELEASE_READY BLOCKED |
| 1.12 | 2026-08-11 | Ghi provenance PR #139/merge `288aa37`/tree `8d4fb50a` cho candidate v2.15; remote feature branch đã xóa, trạng thái P2/evidence không đổi |
| 1.13 | 2026-08-11 | Đồng bộ review/evidence G2 `TASK-PROG-201`: FBD canonical/validator/editor, P2 2/8, candidate v2.16; giữ 0/32 PASS và RELEASE_READY BLOCKED |
| 1.14 | 2026-08-11 | Ghi provenance PR #141/merge `207cd90`/tree `b85bdb2c` cho candidate v2.16; remote feature branch đã xóa |
| 1.15 | 2026-08-11 | Đồng bộ review/evidence G2 `TASK-PROG-202`: FBD→typed IR/equivalence, P2 3/8, candidate v2.17; giữ 0/32 PASS |
| 1.16 | 2026-08-11 | Ghi provenance PR #143/merge `7d424bc`/tree `aeb27c61` cho candidate v2.17; remote feature branch đã xóa |
| 1.17 | 2026-08-11 | Đồng bộ review/evidence G2 `TASK-PROG-203`: artifact/hash/manifest/source map ST/FBD, P2 4/8, candidate v2.18; giữ 0/32 PASS |
| 1.18 | 2026-08-11 | Ghi provenance PR #145/merge `2899d02`/tree `cdef0e77` cho candidate v2.18; remote feature branch đã xóa |
| 1.19 | 2026-08-11 | Đồng bộ review/evidence G2 `TASK-PROG-204`: sáu API Project/Draft/Revision + SQLite v2/ETag/idempotency/restart, P2 5/8, candidate v2.19; giữ 0/32 PASS, PR/merge chờ ghi provenance |
| 1.20 | 2026-08-11 | Ghi provenance PR #147/merge `27a06e1`/tree `4e4e4d24` cho candidate v2.19; remote feature branch đã xóa, trạng thái P2/evidence không đổi |
| 1.21 | 2026-08-14 | Loại 12 record lịch sử dùng cây source cũ cùng README archive; thay liên kết bằng authority hiện hành và ghim đường phục hồi tại commit `b69fdf1`; không đổi Test Result hay release gate |
| 1.22 | 2026-09-04 | Đăng ký `REC-PROG-RUNTIME-PERF-COMP-001`: review hiệu năng Programming/runtime, cycle và multi-program tại `main@67f8ca3`; số đo HOST chỉ là exploratory, TARGET/HIL chưa chạy và release giữ `NO-GO` |
| 1.23 | 2026-09-04 | Nâng `REC-PROG-RUNTIME-PERF-COMP-001` v1.1: ghi benchmark/compiler/runtime live trên Forlinx, bảy finding; TARGET environment `NOT_CONTROLLED`, provenance `PARTIAL`, FakeMCU không phải HIL và release giữ `NO-GO` |
| 1.24 | 2026-09-11 | Baseline hóa revision lịch sử 2026-09-05 của Deployment Provenance `d728fa76` và manifest 29 raw artifact; ghi quan hệ superseded bởi deployment `9b5608d7`, giữ record tách khỏi design/release authority |
| 1.25 | 2026-09-25 | Thêm `REC-MBA-SRC-001`, `REC-MBA-BOARD-001`, `REC-MBA-GAP-001` (audit Modbus RTU FE/BE/FW SOM + bo Forlinx); không đổi authority/runtime/HIL/release gate |
| 1.26 | 2026-09-26 | Đăng ký hai record kiến trúc/so sánh/finding DDC-24; sửa trạng thái chỉ mục `MBA-FW-08` theo audit target tiếp theo, không sửa record lịch sử hoặc nâng release gate |
| 1.27 | 2026-09-27 | Mở rộng record so sánh DDC-24 bằng chín đề xuất `CP-01..09` để Product review; chưa đổi authority hoặc release gate. |
| 1.28 | 2026-09-27 | Đăng ký `REC-DDC-FIELD-USE-20260927`: 21 vấn đề nâng cấp/cải tiến rút từ sử dụng thực tế trên bo lab; không đổi authority, runtime hoặc release gate |
| 1.29 | 2026-09-28 | Cập nhật trạng thái dòng `REC-DDC-FIELD-USE-20260927` theo bản 1.3 của record (#795/#797/#803 đã merge, U-07/U-18 ở PR #804); không đổi authority, runtime hoặc release gate |
| 1.30 | 2026-09-28 | Cập nhật dòng `REC-DDC-FIELD-USE-20260927` theo bản 1.4 (PR #804 đã merge, bo lab lên `main@e3072983`); không đổi authority, runtime hoặc release gate |
| 1.31 | 2026-09-28 | Nâng record hiệu năng v1.2 bằng audit OS/Core, API/Modbus và browser trên target; giữ riêng snapshot 04/09, chưa deploy phương án tối ưu hoặc nâng release gate |
| 1.32 | 2026-09-28 | Đăng ký báo cáo riêng trình PM review/quyết định cải thiện hiệu năng Forlinx; giữ trạng thái In Review và D01–D07 chưa phê duyệt |
| 1.33 | 2026-09-29 | Đăng ký review source giao diện, 5 finding với lớp bằng chứng và 8 đề xuất cải thiện để Product review; không sửa FE hay nâng release gate |
| 1.34 | 2026-09-29 | Mở rộng hai record UI lên 1.1: 29 tuyến desktop/mobile, UI-F06/07, UI-G01..04, 7 đối thủ/hệ sinh thái, UI-P09..16 và 9 concept SVG; giữ riêng source/demo/target và trạng thái đề xuất |
| 1.35 | 2026-09-29 | Đăng ký review source hiệu năng FW SOM/BE, benchmark Historian và phương án; giữ nguyên hồ sơ UI đang sửa và gate sản phẩm |
| 1.36 | 2026-09-30 | Đăng ký record rà tài liệu thiết kế FW SOM ↔ FW MCU và phương án ghép nối (`REC-DDC-FWSOM-MCU-PAIR-20260930`, bản 1.1: phương án đã thành ICD và yêu cầu FW MCU Draft); record không đổi contract hay release gate |
| 1.37 | 2026-09-30 | Trỏ record FW SOM ↔ MCU bản 1.2 tới ADR-064, ICD v3.0 và FW-REQ v3.1; giữ phương án v2.1 trong record làm snapshot lịch sử. |
