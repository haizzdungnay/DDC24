# Hồ sơ rà soát — lưu trữ lịch sử

**ID:** REC-REVIEW-ARCHIVE-001
**Trạng thái:** Historical
**Ngày lưu trữ:** 2026-08-08
**Chỉ mục chính:** [../README.md](../README.md)

> **Không dùng thư mục này làm nguồn chuẩn.** Tài liệu ở đây được giữ để truy
> nguyên *vì sao* một quyết định đã được đưa ra, không để dẫn chiếu khi làm việc
> mới. Trạng thái hiện hành của mọi chủ đề nằm ở [Document Hub](../../../README.md)
> và ở [chỉ mục hồ sơ rà soát](../README.md).

Hai lý do khiến một tài liệu rơi vào đây:

- **Bị thay thế** — có một tài liệu mới hơn nói về cùng chủ đề với thẩm quyền cao hơn.
- **Mất nền đối chiếu** — mã nguồn hoặc quyết định mà nó dựa vào không còn tồn tại,
  nên kết luận trong đó không kiểm chứng lại được ở cây source hiện tại.

Không tài liệu nào bị xoá. Đường phục hồi: `git log --follow -- <đường dẫn>`, và
bản chụp toàn bộ Markdown trước lần tái cấu trúc lớn nằm ở
`archives/markdown-before-restructure-2026-07-22.tar.gz`.

---

## Cụm Program Runtime / IEC 61131-3 (2026-07-22 → 2026-07-23)

Sáu tài liệu dưới đây thuộc một chuỗi quyết định đã khép: gap assessment → review
thiết kế khắc phục → decision request Q0–Q9 → ADR-020 → conflict report → plan
C0 và C1–C10 → readiness review.

[Document Control](../../../00_governance/CONTROL.md) tuyên bố rõ: *"Các plan
C0/C1–C10 và detailed design Programming có trước ADR-023 không phải authority
cho Product Spec mới cho tới khi được reconcile và phê duyệt lại."* Đó là lý do
cả cụm nằm ở đây thay vì ở thư mục hồ sơ đang hiệu lực.

| Tài liệu | Trạng thái khi lưu trữ | Ghi chú |
|---|---|---|
| [Gap assessment IEC 61131-3](KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md) | Open | Khuyến nghị hoãn IEC sang Rev C; ADR-020 sau đó quyết định ngược lại |
| [Review thiết kế khắc phục](KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md) | Open | Gap governance P0 đã được Q0 trả lời |
| [Quyết định Q0–Q9](KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md) | **Decided/Closed** | Đóng gói thành [ADR-020](../../../adr/ADR-020-mekong-owned-iec-aligned-program-runtime.md) |
| [Document conflict report](KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md) | **Closed** | 31/31 conflict đã sửa; `CONFLICT_REMAINING = 0`; 0 hit trong source |
| [C0 Architecture & Feasibility Plan](KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md) | Lịch sử | Chưa reconcile với ADR-023 |
| [Implementation Plan C1–C10](KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md) | Lịch sử | Chưa từng được mở thật; là KẾ HOẠCH, không phải as-built |
| [Readiness review cho C0](PROGRAM_RUNTIME_READY_FOR_C0.md) | Snapshot | `C0_READY = NO`; blocker là owner assignment |

---

## Cụm rà soát mã nguồn 2026-07-30

| Tài liệu | Trạng thái khi lưu trữ | Vì sao lưu trữ |
|---|---|---|
| [Code review FE + BE + FW SOM](KX-DDC24-CODE-REVIEW-FE-BE-FWSOM-2026-07-30.md) | 23/23 finding đã xử lý | Bằng chứng deploy: [`2026-07-30-aarch64-deploy-review-fixes.md`](../../test-evidence/fw-som/2026-07-30-aarch64-deploy-review-fixes.md). Mọi `file:dòng` trong báo cáo trỏ vào `services/`, `web/`, `src/frontend/` — đã bị xoá |
| [Yêu cầu fix & debug cho team FW SOM](KX-DDC24-FW-SOM-FIX-REQUEST-2026-07-30.md) | Đã hoàn thành | Trích 9/23 finding thuộc FW SOM từ báo cáo trên |
| [Audit sản phẩm & thiết kế Web UI](KX-DDC24-UIUX-PRODUCT-AUDIT-2026-07-30.md) | Lịch sử | Đánh giá 22 màn của `src/frontend/` (13.710 dòng). Cây thư mục không còn; hiện trạng giao diện nay do các review FE [2026-08-05](../FE_PAGES_ERROR_REVIEW_2026-08-05.md) và [2026-08-06](../FE_BOARD_PAGE_AUDIT_2026-08-06.md) mô tả. Số đo WCAG vẫn dùng lại được vì token màu đã chuyển sang `theme/tokens.ts` với cùng giá trị |

---

## Hồ sơ đơn lẻ

| Tài liệu | Trạng thái khi lưu trữ | Vì sao lưu trữ |
|---|---|---|
| [Tình trạng triển khai trang `settings/network`](KX-DDC24-SETTINGS-NETWORK-IMPLEMENTATION-STATUS-2026-07-31.md) | Record theo mốc `87a0ff0` | Đánh giá xuyên suốt UI/UX · Use Case · FE · BE · FW SOM với cây source cũ. Cơ chế giao dịch `Validate → Stage → Apply → Confirm/Rollback` mô tả trong đó **vẫn đúng** với `apps/netcfg` hiện tại; chỉ đường dẫn là lỗi thời |
| [Build, test và deploy HMI → FW SOM](KX-DDC24-HMI-FWSOM-DEPLOY-2026-07-22.md) | Superseded | Thay bằng [Board Deploy Report 2026-08-04](../BOARD_DEPLOY_REPORT_2026-08-04.md) |

---

## Đọc tài liệu trong thư mục này

Mọi đường dẫn source trong các tài liệu ở đây đều theo cây thư mục **trước**
`PLAN-ARCH-RESTRUCT-002`. Bảng ánh xạ sang vị trí hiện tại nằm ở
[§3 của chỉ mục chính](../README.md#3-ánh-xạ-đường-dẫn-trước-và-sau-khi-tái-cấu-trúc).
Các link tới file source đã bị xoá đã được gỡ thành mã inline để không dẫn người
đọc tới đường dẫn 404, nhưng bản thân đường dẫn được giữ nguyên làm chứng cứ.
