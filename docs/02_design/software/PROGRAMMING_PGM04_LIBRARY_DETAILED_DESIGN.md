# PGM-04 Control Library — Detailed Design Target MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-SW-PGM04-LIBRARY-001` |
| Phiên bản | 0.1 |
| Trạng thái | **`M2 — DRAFT CONTENT`; chưa `M3`, chưa trao quyền code** |
| Ngày | 2026-08-29 |
| Chủ quản đề xuất | FE Lead + Web API Lead + System Architect |
| Người phê duyệt | Product Owner/CTO + System Architect |
| Authority work package | `PLAN-FE-PGM-061` / `T61-003` (WP-00) |
| Disposition authority | [`AUTH-PROG-2026-08-29-PGM04-001`](../../07_records/reviews/AUTH-PROG-2026-08-29-PGM04-001.md) |
| Đầu vào | [`REC-PGM04-AUTHORITY-001`](../../07_records/reviews/PGM04_AUTHORITY_RECONCILIATION_2026-08-29.md), [`SPEC-PGM04-VISUAL-001`](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-04_VISUAL_SPEC_v1.md) |
| Baseline As-Built | `main@0453891` |
| Evidence class | Thiết kế M2 + source inspection. **Không** phải bằng chứng runtime/target/HIL |
| Gate | `PLAN_READY[PGM04]=NO-GO`; `IMPLEMENT_READY[PGM04]` **chưa mở** |

> Hồ sơ này là DDD của PGM-04. Plan 61 **không** thay thế nó: plan quản lý thứ
> tự thi hành, DDD quản lý nội dung thiết kế.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Thiết kế này khoá cái gì? | Ánh xạ `field → API → state → action → RBAC → test` cho PGM-04, và đường rollback |
| Cái gì CHƯA khoá? | Ba trường không có nguồn (`category`, Used-In, search mở rộng) — chờ `T61-005` |
| Vì sao chưa `M3`? | Một Target thiếu ba trường thì chưa phải Target. Nâng `M3` bây giờ là ký cho một bản thiết kế có lỗ |

## 1. As-Built — đo từ source, không chép từ tài liệu

| Lớp | Hiện có | Vị trí |
|---|---|---|
| Route FE | `projects/:projectId/library` (project-scoped) | [`ProgrammingRoutes.tsx:17`](../../../apps/web-ui/src/features/programming/ProgrammingRoutes.tsx#L17) |
| Trang FE | `LibraryPage.tsx`, 1063 dòng — search/detail/version/mutation đã có, bố cục chưa đạt handoff | `features/programming/library/` |
| API đọc | `GET /programming/libraries` — `projectId`, `scope`, `kind`, `q`, cursor, limit | [`router.go:59`](../../../apps/web-api/internal/programming/transport/http/router.go#L59) |
| API ghi | upsert entry, delete entry, deprecate revision — **cả ba** đòi `program.edit` | `router.go:60-63` |
| Phạm vi | `SYSTEM \| PROJECT`. **Không có `USER`** | [`openapi.yaml:3970`](../../../contracts/openapi/openapi.yaml#L3970) |
| Tìm kiếm | `q` chỉ so `name` và `entryId`, cả hai nhánh | [`library.go:947`](../../../apps/web-api/internal/programming/store/library.go#L947) |

**Bốn route.** Không có route publish (publish đi cùng Seal Revision), không có
route usage, không có route metadata.

## 2. `DD-05` — Mô hình dữ liệu từng field

| Field hiển thị | Nguồn hiện tại | Trạng thái | Ghi chú |
|---|---|---|---|
| `name` | `ProgrammingLibraryEntry.name` | ✅ có | |
| `kind` | `.kind` | ✅ có | FUNCTION / FUNCTION_BLOCK / CONVERSION |
| `scope` | `.scope` | ✅ có | Nhãn hiển thị "Hệ thống"/"Dự án" — **không** dùng chữ "Core" |
| chữ ký | `.signature` (đã phân giải) | ✅ có | Vắng field = "chưa đọc được", **cấm** tự parse `.interface` |
| `featureState` | `.featureState` | ✅ có | Nguồn của cổng PID |
| version/state | `.libraryVersion` + `.libraryState` | ✅ có | |
| dependencies | `.dependencies` | ✅ có | |
| `stateSizeBytes` | `.stateSizeBytes` + `.stateLayoutKnown` | ✅ có | `stateLayoutKnown=false` ≠ `0` |
| **`category`** | — | ❌ **KHÔNG CÓ NGUỒN** | Bắt buộc theo handoff §2. `T61-102`/`T61-103` |
| **`description`** | — | ❌ **KHÔNG CÓ NGUỒN** | Search phải phủ (§7 handoff) |
| **`tags`** | — | ❌ **KHÔNG CÓ NGUỒN** | |
| **Used-In** | — | ❌ **KHÔNG CÓ API** | `AC-PGM04-02`. `T61-104` |
| compatibility | pin `libraryRevisionId` ở Revision | ⚠️ một nửa | "Không âm thầm nâng" đã đảm bảo; "hiện trạng thái tương thích" thì chưa |

Bốn ô ❌ là lý do hồ sơ này dừng ở `M2`. Vẽ giao diện cho một field không có
nguồn sẽ đẻ ra dữ liệu bịa ở đúng chỗ người vận hành tin nhất.

## 3. `DD-06` — Ánh xạ action → API → RBAC

| Action UI | API | Quyền | Vai được | Chặn khi |
|---|---|---|---|---|
| Xem danh sách/chi tiết | `GET /programming/libraries` | `read` | viewer, operator, engineer, admin | không bao giờ (đường đọc) |
| Tạo/Sửa khối PROJECT | `POST …/library/entries` | `program.edit` | **engineer**, admin | scope SYSTEM; thiếu Project; thiếu quyền |
| Xoá khối PROJECT | `DELETE …/library/entries/{id}` | `program.edit` | **engineer**, admin | còn dependent |
| Ngừng dùng revision | `POST …/revisions/{id}/deprecate` | `program.edit` | **engineer**, admin | state ≠ PUBLISHED |
| Chèn khối vào POU | không có API riêng — sửa Draft PGM-02 | `program.edit` | **engineer**, admin | `featureState=REVIEW_REQUIRED`; không có POU đích |

**Bảng này là chỗ sửa một lỗi đang có trong code phát hành.** Trước
`main@0453891`, FE so `roleAtLeast(role,'admin')` nên `engineer` bị chặn ở giao
diện trên đúng những thao tác máy chủ chấp nhận. Đã sửa; bảng trên là hợp đồng
để nó không tái diễn.

## 4. `DD-07` — State model

Sáu trạng thái tách bạch, không gộp (chi tiết trong `SPEC-PGM04-VISUAL-001` §3):

```
idle → loading → ready
              ↘ error        (giữ danh sách cũ nếu đã có)
              ↘ empty-filter (khác empty-project)
ready → detail-loading → detail-ready
                       ↘ detail-error (danh sách VẪN dùng được)
```

Bất biến: `error` không bao giờ được render thành `empty`. Một danh sách rỗng
đọc như "thư viện không có gì"; sự thật có thể là "không đọc được thư viện".

## 5. `DD-11` — Ánh xạ test

| Điều phải đúng | Phép kiểm | Vị trí |
|---|---|---|
| engineer ghi được PROJECT Library | vitest — `libraryEntryPermissions` | `model/library.test.ts` |
| viewer/operator KHÔNG ghi được | vitest — cùng bộ | ↑ |
| SYSTEM bất biến | vitest + Go (không có route ghi) | `LibraryPage.test.tsx`, `library_test.go` |
| `REVIEW_REQUIRED` khoá Insert | **CHƯA CÓ** — thêm ở WP-02 | |
| `error` ≠ `empty` | **CHƯA CÓ** — thêm ở WP-02 | |
| search cursor ổn định | Go — `TestLibrary…` | `library_test.go` |
| RBAC toàn bộ route | Go — ma trận sinh từ bảng route | [`security_matrix_test.go`](../../../apps/web-api/internal/programming/transport/http/security_matrix_test.go) |

## 6. `DD-12` — Rollback

PGM-04 **không** có cờ cut-over riêng. Đường lùi theo thứ tự rẻ → đắt:

1. **FE**: triển khai lại bundle trước đó. Không có state nào của PGM-04 nằm trong `localStorage` ⇒ lùi bundle là lùi trọn.
2. **Contract additive**: mọi field metadata/usage mở ở WP-01 phải là **thêm**, không đổi field cũ ⇒ client cũ bỏ qua field lạ và vẫn chạy.
3. **Migration store**: nếu `T61-103` thêm cột, cột phải `NULL`-able và có preflight/backup; lùi bằng cách dừng đọc cột, **không** rewrite revision đã niêm phong.

Điều **không** lùi được: một Revision đã Seal có pin `libraryRevisionId`. Đó là
lý do metadata trình bày phải tách khỏi `contentSha256` (`D61-09`) — nếu không,
một lần sửa mô tả sẽ làm mọi artifact đã ký thành lỗi thời.

## 7. Blocker

| Mã | Blocker | Mở bằng |
|---|---|---|
| `B-PGM04-01` | `category`/`description`/`tags` không có nguồn | `T61-005` chốt hợp đồng, `T61-102`/`T61-103` cấp nguồn |
| `B-PGM04-02` | Used-In không có API | `T61-005` chốt ngữ nghĩa hai phạm vi, `T61-104` giao |
| `B-PGM04-03` | Hồ sơ này ở `M2` | Cả hai trên đóng, rồi `T61-004` ký |

## 8. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-29 | Bản đầu cho `T61-003`. Ánh xạ field/action/RBAC/state/test/rollback đo từ source `main@0453891`; ghi bốn field không có nguồn và giữ `M2`. |
