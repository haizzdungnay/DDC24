# Review: Thiết kế khắc phục IEC 61131-3 cho Program, SOM Software và MCU Firmware

> **HỒ SƠ LỊCH SỬ — lưu trữ 2026-08-08.** Không dùng làm nguồn chuẩn. Lý do lưu
> trữ và tài liệu thay thế: [`archive/README.md`](README.md). Mọi đường dẫn source
> trong tài liệu này theo cây thư mục **trước** `PLAN-ARCH-RESTRUCT-002`; bảng ánh
> xạ sang vị trí hiện tại ở [chỉ mục hồ sơ rà soát](../README.md).

**Document ID:** KX-DDC24-REV-PROGRAM-SOM-FW-DESIGN-002
**Loại hồ sơ:** Document review record (structure + design), không phải code review
**Trạng thái:** Open — cần quyết định trước khi tài liệu mục tiêu đổi `Draft` → `Active`
**Ngày review:** 2026-07-23
**Tài liệu được review:** [`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`](../../../02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md) bản 0.2 | 2026-07-22
**Tài liệu đối chiếu:** [`KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md`](KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md)
**Baseline source đối chiếu code:** `main` tại `18ee583`

## 1. Kết luận điều hành

Nội dung kỹ thuật của bản 0.2 (kiến trúc, ownership, API, IR, execution model, failure
behavior, requirements, verification layers, release gates) **nhất quán nội bộ và đúng so
với code hiện tại đã kiểm chứng lại hôm nay** — không phần nào bị code thực tế bác bỏ.

Tuy nhiên tài liệu có một **gap governance P0** chưa được xử lý: cơ sở pháp lý của chính
quyết định "bắt buộc IEC ngay trong Rev A.0" không truy vết được, và mâu thuẫn trực tiếp
với khuyến nghị của tài liệu gap assessment cùng ngày. Ngoài ra phần "phương án triển
khai" (§12) mới dừng ở mức khối lượng công việc (slice), chưa đủ để giao việc — không có
owner, không có entry criteria tách khỏi exit criteria, không có sizing. Review này giữ
nguyên phạm vi "không đụng code"; mọi finding dưới đây chỉ dẫn tới thay đổi Markdown.

## 2. Phạm vi review

Đọc toàn văn tài liệu mục tiêu (582 dòng, mục 1–16); đối chiếu với gap assessment cùng
ngày; đối chiếu tuyên bố hiện trạng (§2) với code hiện tại: `src/frontend/src/pages/
ProgrammingPage.tsx`, `web/backend` route table, `services/core/graph_runtime.cpp`,
`services/iobus/`, `fw/Core/Src/main.c`, `fw/Makefile`; đối chiếu tham chiếu baseline:
`docs/01_product/PRODUCT.md`, `docs/00_governance/DECISIONS.md` (ADR-004),
`docs/04_design/SOFTWARE.md`, `docs/05_verification/REQUIREMENTS.md`,
`docs/07_records/TRACEABILITY.md`. Không sửa, build hay chạy bất kỳ code nào.

## 3. Finding governance (ưu tiên xử lý trước implementation)

### DOC-REV-001 — P0 — "Management corrective directive" không có nguồn truy vết, mâu thuẫn với gap assessment cùng ngày

`PROGRAM_SOM_FW_DRAFT_DESIGN` bản 0.2 tự nhận là bản làm lại thay bản 0.1 ("hoãn IEC sang
revision sau") vì có **"management corrective directive 2026-07-22"** (dẫn ở mục 11, áp
dụng cho toàn bộ 15 candidate requirement SYS/SWR/IF/SAFE/NFR/FW-REQ-IEC-*). Tài liệu
không trích dẫn decision record, ADR, biên bản họp hay approval nào cho chính directive
này — đây là quyết định thay đổi phạm vi sản phẩm lớn nhất trong toàn bộ corpus hiện
hành nhưng không có nguồn.

Cùng ngày 2026-07-22, `KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md` — một gap
assessment độc lập dựa trên cùng baseline `18ee583` — kết luận ngược lại ở §8.1:
*"Giữ claim chính thức: component-based DDC, không IEC 61131-3"* cho Rev A, và chỉ đề
xuất lộ trình IEC cho Rev C ở §8.2. Hai tài liệu cùng ngày, cùng baseline, đối tượng
review trùng nhau, nhưng đề xuất đối lập nhau về đúng câu hỏi cốt lõi (RD-IEC-001:
"IEC 61131-3 có bắt buộc trong chính Rev A.0 không?").

Theo quy tắc governance đang áp dụng cho repo này (đổi baseline phải đi qua chuỗi
Product → Requirements → Decision → Design → Verification → Traceability, không được
duyệt Design khi Decision log chưa cập nhật — chính mục 1 của tài liệu mục tiêu cũng nêu
lại nguyên tắc này), một design document không nên tự làm nguồn thẩm quyền cho quyết
định thay đổi scope. Directive cần một Decision record (ADR mới hoặc revise ADR-004) ghi
rõ ai ban hành, ngày, lý do override cả v0.1 lẫn kết luận gap assessment, trước khi bản
0.x này được dùng làm căn cứ giao việc triển khai.

**Ảnh hưởng nếu không xử lý:** nếu có người đọc `PROGRAM_SOM_FW_DRAFT_DESIGN` mà không
đọc gap assessment (hai file nằm ở hai thư mục khác nhau, không link chéo nhau), họ sẽ
không biết corpus hiện hành có hai khuyến nghị đối lập cùng ngày.

**Đề xuất:** thêm ghi chú tường minh trong tài liệu mục tiêu dẫn tới gap assessment và
nêu rõ mâu thuẫn đang mở, không tự chọn bên nào (đã áp dụng, xem mục "cập nhật" bên
dưới).

### DOC-REV-002 — P1 — Hai tài liệu không link chéo nhau

`KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md` không có backlink tới
`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` dù cùng chủ đề, cùng ngày, và design doc
tuyên bố supersede hướng mà gap doc khuyến nghị. `docs/README.md` và
`docs/02_design/README.md` liệt kê hai file này ở hai mục khác nhau (review records vs.
detailed design) không có ghi chú quan hệ. Người đọc theo luồng "Detailed design corpus"
sẽ không thấy gap assessment tồn tại.

**Đề xuất:** thêm dòng tham chiếu chéo ở cả hai đầu (đã áp dụng cho phía design doc).

## 4. Finding cấu trúc tài liệu

### DOC-REV-003 — P2 — Không theo `TEMPLATE_DDD.md` nhưng không khai báo lý do lệch chuẩn

`docs/02_design/_templates/TEMPLATE_DDD.md` định nghĩa cấu trúc DDD chuẩn (Mục đích &
Phạm vi → Bối cảnh & Ràng buộc → Phân rã → Thiết kế chi tiết → Concurrency & Timing → Xử
lý lỗi → Ma trận truy vết → Open points). Tài liệu mục tiêu dùng cấu trúc khác (Quyết
định bắt buộc → Hiện trạng → Phạm vi → Kiến trúc → FE/BE/Compiler/IOBus/FW → Failure →
Requirements → Implementation plan → Verification → Gates → Review points). Cấu trúc này
hợp lý cho một *corrective/directive design* (khác một DDD component thông thường), và
nội dung có phủ tương đương Ma trận truy vết (§11 + §13) và Open points (§15). Tuy nhiên
tài liệu không tự khai báo mình là biến thể có chủ đích của template — dễ bị đọc nhầm là
thiếu cấu trúc thay vì cố ý.

**Đề xuất:** thêm một dòng ghi chú ngay dưới header giải thích tài liệu dùng cấu trúc
corrective-design thay vì `TEMPLATE_DDD.md` component-design, và map nhanh 2 mục tương
đương (đã áp dụng).

### DOC-REV-004 — P2 — Bảng §15 mô tả yêu cầu approval nhưng không có bảng ghi approval thật

Câu cuối §15 yêu cầu "Approval cần ghi reviewer, role, ngày, quyết định, comment/deviation
và action owner" nhưng không có bảng nào để điền — chỉ có bảng đề xuất kỹ thuật
(RD-IEC-001..007). Khi có reviewer thật ký duyệt, họ sẽ phải tự dựng bảng, dễ lệch format
giữa các lần duyệt.

**Đề xuất:** thêm khung bảng approval log trống ngay dưới (đã áp dụng).

## 5. Finding nội dung kỹ thuật (đối chiếu code 2026-07-23)

### DOC-REV-005 — P2 — §2 gap table đúng nhưng chưa đầy đủ so với registry Core hiện tại

Đối chiếu lại `services/core/graph_runtime.cpp` hôm nay xác nhận đúng các mismatch đã
nêu trong gap assessment (`Interlock` dùng `permit`/`request` chứ không phải `cmd`/
`safe`; `AlarmDelay` dùng `on_delay_s`/`off_delay_s`; `PulseCounter` output là `out` chứ
không phải `count`; `Modbus_Read` không khớp `Modbus_RTU_Read`/`Modbus_TCP_Read`).

Phát hiện thêm chưa có trong cả hai tài liệu: sample library của `ProgrammingPage.tsx`
dùng node `UI_Input`, nhưng registry 28-node của Core **không có type này** — Core chỉ
có `AI_Input` và `DI_Input` tách riêng. Đây không phải lỗi đặt tên như 4 case kia mà là
thiếu hẳn counterpart; graph mẫu trong Program UI sẽ bị Core reject ngay từ node đầu
tiên, không chỉ ở link/param.

**Đề xuất:** bổ sung dòng này vào §2 (đã áp dụng) để §12/C8 (I/O/vendor library) không bỏ
sót khi làm registry hợp nhất FE/Core.

### DOC-REV-006 — P3 — Không có sizing/resourcing cho một scope compiler + runtime đầy đủ

§12 liệt kê 11 slice (C0–C10) — lexer/parser ST, canonical model FBD/LD, SFC, typed IR,
task scheduler, retain, Backend API đầy đủ, migration 28 node, MCU/HIL, conformance lab —
nhưng không có effort estimate, không có ngày/sprint mục tiêu, không có ước lượng số
người hoặc chi phí license bản IEC có bản quyền / lab PLCopen. Đây là quyết định resourcing
lớn (xây một compiler + runtime IEC từ đầu) nhưng tài liệu corrective design không định
lượng, nên G0 (§14) không có cơ sở đánh giá tính khả thi thời gian/ngân sách khi phê
duyệt.

**Đề xuất:** không tự đoán số liệu (không có căn cứ), chỉ nêu thành open point tường minh
yêu cầu Project Engineering/PM cung cấp trước khi RD-IEC-001 được quyết theo hướng
"có" (đã áp dụng ở bảng open points mới).

### DOC-REV-007 — P3 — §12 chỉ có exit criteria, không tách entry criteria/owner/dependency ở dạng cột

Văn xuôi cuối §12 nêu đúng một phụ thuộc quan trọng ("Không triển khai FE canvas trước
khi C1 chốt...") nhưng phụ thuộc giữa các slice khác (C2–C5 dùng chung kernel C1; C9 độc
lập phần cứng với C1–C8; C10 cần C1–C9 đóng trước khi có normative trace đầy đủ) chỉ nằm
rải rác trong văn xuôi các mục 7–10, không tổng hợp lại ở bảng kế hoạch — khó dùng bảng
này để giao việc trực tiếp cho một sprint board.

**Đề xuất:** thêm cột "Trạng thái", "Điều kiện bắt đầu (entry)" và "Phụ thuộc" vào bảng
§12, cộng theo mỗi slice một danh sách sub-task ngắn tổng hợp lại từ nội dung kỹ thuật đã
có ở §4–§10 (đã áp dụng — xem cập nhật §12 trong tài liệu mục tiêu).

## 6. Việc không thuộc phạm vi review này

- Không đánh giá lại liệu IEC 61131-3 có nên bắt buộc trong Rev A.0 hay không (đó là
  RD-IEC-001, một quyết định quản lý/thương mại, không phải finding tài liệu).
  Câu trả lời tùy governance chọn; review này chỉ yêu cầu quyết định đó phải truy vết
  được.
- Không chạy lại 344 CTest hay build lại toolchain; số liệu build/test dùng lại từ gap
  assessment 2026-07-22 vì code trong `services/`, `fw/`, và `ProgrammingPage.tsx` không
  đổi từ baseline `18ee583` tới nay (xác nhận qua `git log`).
- Không sửa `ADR-004`, `PRODUCT.md`, `SOFTWARE.md`, `REQUIREMENTS.md` hay
  `TRACEABILITY.md` — các sửa đổi đó chỉ được làm sau khi RD-IEC-001..007 có quyết định,
  đúng như chính tài liệu mục tiêu yêu cầu ở mục 1.

## 7. Tổng hợp finding

| ID | Mức | Tóm tắt | Xử lý trong lần cập nhật này |
|---|---|---|---|
| DOC-REV-001 | P0 | Directive không truy vết được, mâu thuẫn gap assessment cùng ngày | Ghi chú tường minh + không tự chọn hướng |
| DOC-REV-002 | P1 | Hai tài liệu không link chéo | Thêm backlink hai chiều |
| DOC-REV-003 | P2 | Lệch `TEMPLATE_DDD.md` không khai báo | Thêm ghi chú biến thể cấu trúc |
| DOC-REV-004 | P2 | Thiếu bảng approval log thật | Thêm khung bảng trống |
| DOC-REV-005 | P2 | Thiếu gap `UI_Input` trong §2 | Bổ sung dòng vào §2 |
| DOC-REV-006 | P3 | Thiếu sizing/resourcing cho §12 | Thêm open point yêu cầu PM cung cấp |
| DOC-REV-007 | P3 | §12 thiếu status/entry/owner/dependency | Thêm cột + sub-task theo slice |

Tất cả 7 finding đã được phản ánh trực tiếp vào
`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` bản 0.3 trong cùng đợt cập nhật này (xem
Revision history của tài liệu đó). Tài liệu vẫn giữ trạng thái `Draft`; review record này
không tự phê duyệt tài liệu mục tiêu — cần chủ quản (Project Engineering) và người có
thẩm quyền ban hành "management corrective directive" xác nhận DOC-REV-001 trước khi đổi
`Draft` → `Active`.

Danh sách câu hỏi cần chủ quản trả lời trực tiếp cho các finding trên (Q0 = DOC-REV-001,
Q1–Q7 = RD-IEC-001..007, Q8 = sizing DOC-REV-006, Q9 = reviewer identity) đã tổng hợp
thành form điền sẵn tại
[`KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md`](KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md).

## 8. Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-23 | Review đầu tiên: cấu trúc + thiết kế cho `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` bản 0.2, đối chiếu lại code hôm nay, 7 finding. |
| 1.1 | 2026-07-23 | Thêm link tới form câu hỏi chờ duyệt `KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md`. |
