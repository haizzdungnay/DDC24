# Phiếu xin quyết định: duyệt `PID` (REVIEW_REQUIRED) hoặc công bố lộ trình

> **Document ID:** REC-PID-DECISION-REQUEST-20260928
> **Phiên bản:** 0.1
> **Trạng thái:** Chờ quyết định — Controls/Safety Lead + Product Owner
> **Issue:** [#802](https://github.com/Mekong-HCM/MK-DDC-24/issues/802) (finding **U-13**, P1, của
> [`REC-DDC-FIELD-USE-20260927`](DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md))
> **Mốc mã nguồn đối chiếu:** `main@9910b88` (2026-09-28)

## 0. Phiếu này là gì và không là gì

Đây là **hồ sơ để người có thẩm quyền quyết định**, không phải quyết định. Người
soạn không ký token duyệt, không đổi `approved`, không ghi `DECISIONS.md`. Một
token duyệt do người không có thẩm quyền sinh ra là giả chữ ký an toàn — đúng thứ
cổng `REVIEW_REQUIRED` sinh ra để chặn.

## 1. Hiện trạng (đọc từ mã)

| Thứ | Hiện tại | Nguồn |
|---|---|---|
| Cổng review | `PID` là feature `REVIEW_REQUIRED`, `approved=false`, token rỗng; Check từ chối mọi Program dùng `PID` | `apps/core/application/st/st_profile_generated.hpp` (`kReviewGatedFeatures`) |
| Nguồn của cổng | `reviewGatedFeatures[PID]`: `policy = BLOCK_CHECK`, `approvalEvidenceRef = null`, `approvalToken = null` | `contracts/programming/product_profile_v2.json` |
| Cách mở cổng | Token = `sha256("mkddc-controls-safety-approval:v1:PID:<libraryVersion>:<evidenceRef>")`; generator từ chối token không suy ra đúng; token gắn `libraryVersion` nên duyệt cho `rev-a.4` không tự áp cho bản sau | `scripts/generate_programming_profile.py` (`approval_token`) |
| Thuật toán | Back-calculation anti-windup, freeze khi override mức 1–4, `dt` theo Task cadence đơn điệu | `docs/02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md` §7 (As-Built `TASK-PROG-303`) |
| Bằng chứng có sẵn | Harness conformance PID trong test Core (tắt `enforce_review_gate` để dựng evidence): khối `PID (TASK-PROG-303, DDD-CTRL-PROG-001 §7)` | `apps/core/application/st/tests/test_st_exec.cpp` |
| Điểm còn treo | Ngưỡng phát hiện override 1 % dải `OUT_MIN..OUT_MAX` (`kPidOverrideDetectFraction`) **chưa qua Controls/Safety review**; `iMin/iMax` dùng chung biên output; gains/filter/transition envelope là quyết định field | `PROGRAMMING_CONTROL_SEMANTICS.md` §7 |
| Chính sách sản phẩm | PID implement trong registry nhưng chỉ quảng bá end-user-ready sau Controls/Safety evidence | `docs/00_governance/DECISIONS.md` (mục 9 của quyết định Program Runtime) |
| Tài liệu người dùng hiện nay | Guide 16 DO ghi "Không dùng `PID`" | `docs/06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md` §2 dòng 10 |

**Hệ quả:** với bộ điều khiển DDC cho HVAC, vòng PID là chức năng lõi; hiện không
Program nào trên sản phẩm dùng được `PID`.

## 2. Hai phương án

### Phương án 1 — Hoàn tất review và ký token

Việc cần làm trước khi ký, theo đúng những gì §7 còn để ngỏ:

1. Controls Lead duyệt ngưỡng override-detect (1 % hay giá trị khác) và việc dùng
   chung `iMin/iMax` với biên output.
2. Safety Lead duyệt hành vi khi `dt` ngoài tolerance, NaN/Inf, quality bad
   (fault, không publish) và hành vi khi nhả override (transition envelope).
3. Chốt `approvalEvidenceRef` trỏ tới một hồ sơ bằng chứng cố định (kết quả harness
   `test_st_exec.cpp` + mô phỏng vòng kín, lý tưởng thêm một lần chạy trên bo với
   AO thật).
4. Chạy `scripts/generate_programming_profile.py` với evidence ref đó để sinh
   token; ghi quyết định vào `DECISIONS.md`.

Cái giá: công review của hai Lead; trách nhiệm an toàn gắn với chữ ký.

### Phương án 2 — Công bố lộ trình, giữ cổng

1. Ghi vào `DECISIONS.md` rằng `PID` giữ `REVIEW_REQUIRED` tới một mốc cụ thể.
2. Tài liệu người dùng nói rõ `PID` chưa dùng được và **phương án thay thế tạm
   được Product chấp thuận**. Người soạn phiếu **không** tự đề xuất người dùng
   viết PID bằng FUNCTION_BLOCK tự làm: đó chính là đường vòng qua cổng an toàn,
   và nó cần chính Product/Safety cho phép.

Cái giá: sản phẩm DDC thiếu vòng PID trong thời gian chờ.

## 3. Việc đã làm ở phía tài liệu (không cần quyết định)

- Guide 16 DO trỏ tới phiếu này ở dòng "Không dùng `PID`", để người đọc biết đây
  là trạng thái chờ quyết định, không phải giới hạn vĩnh viễn.

## 4. Ô quyết định (người có thẩm quyền điền)

| Mục | Giá trị |
|---|---|
| Phương án chọn | ☐ 1 — duyệt và ký token ☐ 2 — công bố lộ trình |
| Mốc (nếu phương án 2) | |
| `approvalEvidenceRef` (nếu phương án 1) | |
| Ngưỡng override-detect được duyệt | |
| Phương án thay thế tạm cho người dùng (nếu phương án 2) | |
| Controls/Safety Lead ký | |
| Product Owner ký | |
| Ngày | |

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-09-28 | Phiếu xin quyết định cho Issue #802 (U-13): hiện trạng cổng `REVIEW_REQUIRED` của `PID` đối chiếu `main@9910b88`, cơ chế token, điểm còn treo ở `DDD-CTRL-PROG-001` §7, hai phương án và ô quyết định |
