# Hồ sơ rà soát — chỉ mục

**ID:** REC-REVIEW-INDEX-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-10 (đăng ký gói review, manifest candidate và readiness môi trường P0 Programming)
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
3. **`archive/` là hồ sơ lịch sử, không phải nguồn chuẩn.** Nó được giữ để truy
   nguyên quyết định, không để dẫn chiếu khi làm việc mới.

---

## 1. Hồ sơ đang hiệu lực

### 1.1 Rà soát mã nguồn và giao diện

| Hồ sơ | Ngày | Trạng thái | Nội dung |
|---|---|---|---|
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
| [Programming Docs Sync Report](PROGRAMMING_DOCS_SYNC_REPORT.md) | 2026-08-03 | Complete | Đồng bộ docs theo Product Spec Programming Rev A |
| [Programming Design Set Review](PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md) | 2026-08-09 | Complete | Rà 22 hồ sơ Programming: 12 finding tài liệu đã đóng, 22/22 đạt M3; M4/M5 chờ người thật |
| [Gói review cổng P0 Programming](PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md) | 2026-08-10 | **v1.8 — chờ chữ ký authority** | Gói `PROG-000..006`; candidate v2.7 đã ghim và vòng review kỹ thuật xong; §6.1 liệt kê bốn hành động authority còn lại; `0/7` DoD |
| [Manifest candidate P0 Programming](PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md) | 2026-08-10 | **Active v2.9 — pin PASS** | Candidate v2.7 định danh bằng **22 SHA-256**/commit `a236200`; kiểm bằng `scripts/candidate_pin_check.py`. Không tự mở gate |
| [Rà soát môi trường P0 Programming](PROGRAMMING_P0_ENVIRONMENT_READINESS_2026-08-10.md) | 2026-08-11 | **v1.1 — Partial** | Rerun CI trên `2ad6931` vẫn 17/17 job `steps=[]`; target SSH auth và HIL authority/fixture còn BLOCKED |
| [Consumer review liên chức năng P0 Programming](PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md) | 2026-08-11 | **v1.4 — vòng kỹ thuật xong, `0/8` chữ ký** | 22 hồ sơ theo cặp producer→consumer; `9/9` finding đóng; revision ký là candidate v2.7/commit `a236200`; `0/22 M4` vì M4 đòi reviewer là người thật |
| [Deployment Provenance Report](DEPLOYMENT_PROVENANCE_REPORT.md) | 2026-08-03 | Record | Build identity, release manifest, sai khác target |
| [Physical I/O và HIL](PHYSICAL_IO_HIL_REPORT.md) | 2026-08-03 | **Gate còn mở** | Host/fake-MCU **không** được ghi thành HIL vật lý |
| [Báo cáo build và deploy lên board](BOARD_DEPLOY_REPORT_2026-08-04.md) | 2026-08-04 | Record | 5 service chạy trên Orange Pi 5B, HMI tắt có chủ đích |
| [RST-205 Closure Review](RST205_CLOSURE_REVIEW_2026-08-04.md) | 2026-08-04 | Đã đóng Plan 46 | Đối chiếu tiêu chí §9, regression, rollback |

### 1.5 Phần cứng

Hồ sơ rà soát phần cứng có index riêng: [hardware/README.md](hardware/README.md).
Tài liệu tổng [HW/FW/SOM/HMI review 2026-07-22](KX-DDC24-HW-FW-SOM-HMI-REVIEW-2026-07-22.md)
giữ nguyên vị trí vì [Hardware detailed design](../../04_design/hardware/README.md)
dẫn chiếu nó như bản ghi quyết định `NO-GO` hiện hành.

---

## 2. Hồ sơ lịch sử — `archive/`

12 tài liệu đã chuyển sang [`archive/`](archive/README.md) ngày 2026-08-08. Lý do
và đường phục hồi của từng tài liệu ghi trong README của thư mục đó. Tóm tắt:

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
5. Chuyển sang `archive/` khi tài liệu đã bị thay thế hoàn toàn hoặc mất hiệu
   lực; ghi lý do vào [`archive/README.md`](archive/README.md) và sửa mọi link
   trỏ tới nó.

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Tạo chỉ mục đầu tiên cho thư mục; đối chiếu trạng thái 34 tài liệu với mã nguồn tại `18bd295`; tách 12 hồ sơ lịch sử sang `archive/` và sửa link trỏ tới chúng; bổ sung bảng ánh xạ đường dẫn trước/sau tái cấu trúc |
| 1.1 | 2026-08-10 | Đăng ký gói review P0 và manifest candidate `e3e9fb2`; phân biệt pin cấu hình PASS với authority review/sign-off còn BLOCKED |
| 1.2 | 2026-08-10 | Đăng ký record readiness môi trường P0; tách host/evidence PASS phần chuẩn bị khỏi CI/target/HIL BLOCKED |
