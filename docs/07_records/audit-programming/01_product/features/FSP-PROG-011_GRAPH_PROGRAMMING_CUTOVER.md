# Feature Spec: Cutover graph legacy sang Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `FSP-PROG-011` |
| Phiên bản | 0.1 |
| Trạng thái | `IN REVIEW` |
| Nguồn | PC-PROG-008, PC-PROG-009, PC-PROG-012; PR-PROG-009, PR-PROG-012, PR-PROG-014; `PRG-RT-009` |
| Kiểm chứng | `VS-PROG-015`; VR-PROG-006, VR-PROG-008, VR-PROG-012, VR-PROG-013 |
| Quyết định mở | OD-PROG-012, OD-PROG-013, OD-PROG-014, OD-PROG-015; CONF-PROG-002, CONF-PROG-015 |

## Mục lục

1. Mục tiêu
2. Trạng thái
3. Hành vi bắt buộc
4. Tiêu chí chấp nhận
5. Thuật ngữ
6. Lịch sử và phê duyệt

## 1. Mục tiêu

Chuyển duy nhất một owner của đóng góp Local logic mức 5 mà không dual-run,
không trộn output và không tạo restart loop/watchdog gap.

## 2. Trạng thái

| State | Hành vi |
|---|---|
| `GRAPH_ONLY` | Graph legacy active; từ chối Commission Programming. |
| `PROGRAM_ONLY` | Programming active; graph không thực thi/không sở hữu scan period. |
| `DUAL_INVALID` | Dual request bị reject, giữ LKG, không trộn output mức 5. |

## 3. Hành vi bắt buộc

| ID | Hành vi |
|---|---|
| FSP-PROG-011-B01 | Cutover lần đầu phải có migration/check, backup graph, confirmation và rollback plan. |
| FSP-PROG-011-B02 | Base control step phải bounded và tách Task period; Task 30 s không được kéo dài một `ScanLoop::step()`. |
| FSP-PROG-011-B03 | Watchdog chỉ kick sau step hoàn tất và config phải thỏa `WatchdogSec >= 2 × max_base_step_period + WCET_step_target + 1 s`. |
| FSP-PROG-011-B04 | Cutover không được restart `mkddc-iobus` hoặc làm IOP poll gap đạt 200 ms. |
| FSP-PROG-011-B05 | Mâu thuẫn scheduler spec với base-step model phải giữ OPEN qua `CONF-PROG-015`, không tự chọn implementation. |

## 4. Tiêu chí chấp nhận

Target/HIL chạy `1/5/30 s`, dual-run reject, không restart loop, watchdog cadence
đúng, poll gap `<200 ms`, LKG giữ nguyên khi reject. Scenario vẫn RED tới khi có evidence.

## 5. Thuật ngữ

Xem [DICT-PROG-001](../../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 6. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo từ amendment v2.2 và R3-03. |

Sign-off: Product Owner `PENDING`; Runtime Architect `PENDING`; Controls/Safety `PENDING`; Operations `PENDING`; Verification `PENDING`.
