# PGM-04 Control Library — Detailed Design Target MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-SW-PGM04-LIBRARY-001` |
| Phiên bản | 0.3 |
| Trạng thái | **`M4 — AS-BUILT`** (từ `0.3`): WP-01…WP-04 đã thi hành, phần thiết kế dưới đây mô tả code đang có |
| Ngày | 2026-08-29 |
| Chủ quản đề xuất | FE Lead + Web API Lead + System Architect |
| Người phê duyệt | Product Owner/CTO + System Architect |
| Authority work package | `PLAN-FE-PGM-061` / `T61-003` (WP-00) |
| Disposition authority | [`AUTH-PROG-2026-08-29-PGM04-001`](../../07_records/reviews/AUTH-PROG-2026-08-29-PGM04-001.md) |
| Đầu vào | [`REC-PGM04-AUTHORITY-001`](../../07_records/reviews/PGM04_AUTHORITY_RECONCILIATION_2026-08-29.md), [`SPEC-PGM04-VISUAL-001`](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-04_VISUAL_SPEC_v1.md), [`LOCK-PGM04-CONTRACT-001`](../../07_records/reviews/PGM04_CONTRACT_LOCK_2026-08-29.md) |
| Baseline As-Built | `main@2ee3c5b` + lát WP-03/WP-04 của phiên 2026-08-29 |
| Evidence class | Thiết kế + source inspection + **HOST/LOCAL** (unit + e2e trình duyệt thật, mock route). **Không** phải bằng chứng target/HIL |
| Gate | `PLAN_READY[PGM04]=PASS`; `IMPLEMENT_READY[PGM04]=GO` (`AUTH-PROG-2026-08-29-PGM04-002`, mở rộng WP-03/WP-04 ở `-003`). `RELEASE_READY` vẫn **NO-GO** |

> Hồ sơ này là DDD của PGM-04. Plan 61 **không** thay thế nó: plan quản lý thứ
> tự thi hành, DDD quản lý nội dung thiết kế.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Thiết kế này khoá cái gì? | Ánh xạ `field → API → state → action → RBAC → test` cho PGM-04, và đường rollback |
| Cái gì CHƯA khoá? | Phạm vi **Draft** của Used-In và nguồn `tags`/`compatibility` cho entry **SYSTEM** (giao ở `T61-102`/`T61-104`); `category`/`description`/`tags`/`compatibility`/Used-In sealed đã xong cả hợp đồng lẫn đường đọc-ghi PROJECT |
| Vì sao `M4`? | WP-01…WP-04 đã chạy và có bằng chứng HOST/LOCAL. `M4` **không** nói gì về release |

## 1. As-Built — đo từ source, không chép từ tài liệu

| Lớp | Hiện có | Vị trí |
|---|---|---|
| Route FE | `projects/:projectId/library` (project-scoped) | [`ProgrammingRoutes.tsx:17`](../../../apps/web-ui/src/features/programming/ProgrammingRoutes.tsx#L17) |
| Trang FE | `LibraryPage.tsx` = controller (URL state + query/mutation). Lưới thẻ, Inspector, drawer soạn thảo, bộ chọn POU đích tách thành `LibraryCardGrid`/`LibraryBlockCard`/`LibraryInspector`/`LibraryAuthoringDrawer`/`TargetPouChooser` | `features/programming/library/` |
| API đọc | `GET /programming/libraries` — `projectId`, `scope`, `kind`, `q`, cursor, limit | [`router.go:59`](../../../apps/web-api/internal/programming/transport/http/router.go#L59) |
| API ghi | upsert entry (kèm `category`/`description` từ `T61-401`), delete entry, deprecate revision — **cả ba** đòi `program.edit` | `router.go:60-63` |
| Phạm vi | `SYSTEM \| PROJECT`. **Không có `USER`** | [`openapi.yaml:3970`](../../../contracts/openapi/openapi.yaml#L3970) |
| Tìm kiếm | `q` phủ `name`/`entryId`/`description`; lọc `category` chính xác | `apps/web-api/internal/programming/store/library.go` |

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
| **`category`** | `.category` — SYSTEM sinh từ registry, PROJECT là cột store | ✅ **đọc + GHI** | Ghi mở ở `T61-401`. Vắng ⇒ render `—` kèm lý do, **cấm** quy về chuỗi rỗng |
| **`description`** | `.description` — như trên | ✅ **đọc + GHI** | `q` phủ field này |
| **`presentationSha256`** | băm riêng tập trình bày (`category`, nhãn, `description`, `tags`, cảnh báo) | ✅ có, **cả SYSTEM lẫn PROJECT** | **Không** nằm trong `contentSha256` (`D61-09`). `T61-102` tách hai hash ở registry SYSTEM: trước đó `contentSha256` băm TOÀN BỘ entry nên `labelVi`/`labelEn`/`category` nằm trong danh tính thực thi |
| **`tags`** | `.tags` — SYSTEM sinh từ registry (`T61-102`), PROJECT là cột store (migration `0015`) | ✅ **đọc + GHI, cả hai scope** | PROJECT: máy chủ chuẩn hoá (trim, gộp khoảng trắng, hạ chữ thường, khử trùng lặp, **sắp tăng dần**); vượt trần là **400**, không cắt bớt. SYSTEM: registry phải đã canonical sẵn, generator **kiểm** chứ không tự sửa — tự sửa làm bản đã review khác bản đã sinh. `q` phủ field này |
| **Used-In** | `GET /programming/library-usages` | ✅ có, **cả hai phạm vi đo ở server** | sealed từ `library_usages`; draft từ `objects[].dependencies` của tài liệu Draft — cùng mảng mà Seal chuyển thành `library_usages`, nên là dữ liệu authoritative chứ không phải cache FE (`T61-104`). Cả hai có `nextCursor`. Entry SYSTEM vẫn `UNAVAILABLE` kèm lý do: nó được dùng qua SOURCE chứ không qua khai báo, nên đo được đòi phân tích ST/FBD. `UNAVAILABLE` **không bao giờ** render thành `0` |
| **`compatibility`** | `.compatibility {state, requiredVersion, availableVersion, reason}` | ✅ có | Fail-closed: thiếu một trong hai vế ⇒ `UNKNOWN`, **không bao giờ** `COMPATIBLE`. `requiredVersion` từ Revision đã Commission gần nhất; `availableVersion` là version PUBLISHED mới nhất. Entry SYSTEM luôn `UNKNOWN` cho tới `T61-104` |

**Đường ghi metadata là lỗi mà lát này đóng lại.** Migration `0014` đã thêm cột
`category`/`description` và store đã nhận `UpsertProjectLibraryEntryParams`
tương ứng, nhưng `UpsertLibraryEntryCommand` và request HTTP không có trường —
nên không caller nào tới được cột. Hệ quả đọc được trên màn hình: mọi khối
PROJECT hiện `— chưa phân loại` vĩnh viễn, và bộ lọc Phân loại không bao giờ
khớp một khối do người dùng tạo. Một cột không ai ghi được là một cột không tồn
tại.

Cùng chỗ đó còn một trần đo sai đơn vị: store kiểm `len()` (BYTE) trong khi hợp
đồng và trigger SQLite đếm KÝ TỰ, nên một mô tả tiếng Việt bị từ chối ở khoảng
một nửa độ dài hợp đồng cho phép — kèm thông điệp nói "vượt 512 ký tự" trong khi
người dùng mới gõ 512. Nay đo bằng `utf8.RuneCountInString`.

## 3. `DD-06` — Ánh xạ action → API → RBAC

| Action UI | API | Quyền | Vai được | Chặn khi |
|---|---|---|---|---|
| Xem danh sách/chi tiết | `GET /programming/libraries` | `read` | viewer, operator, engineer, admin | không bao giờ (đường đọc) |
| Tạo/Sửa khối PROJECT | `POST …/library/entries` | `program.edit` | **engineer**, admin | scope SYSTEM; thiếu Project; thiếu quyền |
| Xoá khối PROJECT | `DELETE …/library/entries/{id}` | `program.edit` | **engineer**, admin | còn dependent |
| Ngừng dùng revision | `POST …/revisions/{id}/deprecate` | `program.edit` | **engineer**, admin | state ≠ PUBLISHED |
| Chèn khối vào POU | **không có API nào** — PGM-04 chỉ điều hướng | `program.edit` | **engineer**, admin | `featureState=REVIEW_REQUIRED`; `libraryState=DEPRECATED`; không có POU đích; khổ < 768 px |

**Dòng Chèn nói đúng một điều quan trọng: PGM-04 không ghi.** `TargetPouChooser`
hỏi POU đích rồi điều hướng sang PGM-02 ở đúng POU ấy, mang theo `returnTo`.
Phép chèn thật xảy ra trong bộ soạn thảo. Đó không phải cách làm tắt: một lần
ghi Draft phát ra từ màn hình Thư viện là một lần ghi mà chỗ Hoàn tác nằm ở màn
hình khác — và một lần ghi như thế là lần ghi người ta sẽ không dám thực hiện.

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
| `REVIEW_REQUIRED` khoá Insert | vitest + Playwright (desktop + mobile) | `LibraryWorkspace.test.tsx`, `e2e/programming.spec.ts` |
| `error` ≠ `empty` | vitest + Playwright | `libraryViewState.test.ts`, `e2e/programming.spec.ts` |
| Chèn = 0 lệnh ghi | Playwright chặn mọi request không phải GET | `e2e/programming.spec.ts` |
| chữ ký đọc được TRƯỚC khi mở chi tiết | vitest + Playwright | `libraryPresentation.test.ts`, `e2e` |
| nhãn review đọc `featureState`, không đọc TÊN | vitest | `LibraryWorkspace.test.tsx` |
| metadata đi hết đường ghi, `contentSha256` không đổi | Go | `application/library_test.go` |
| trần metadata đo theo KÝ TỰ | Go | ↑ |
| lưới thẻ là MỘT điểm dừng tab | vitest + Playwright | `LibraryWorkspace.test.tsx`, `e2e` |
| khổ < 768 px không có đường ghi bật được | Playwright `mobile-chrome` | `e2e/programming.spec.ts` |
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
| `B-PGM04-01` | `category`/`description`/`tags` không có nguồn | **ĐÃ MỞ** — `LOCK-PGM04-CONTRACT-001` §2 khoá hợp đồng; giao ở `T61-102`/`T61-103` |
| `B-PGM04-02` | Used-In không có API | **ĐÃ MỞ** — `LOCK-PGM04-CONTRACT-001` §1 khoá hợp đồng; dữ liệu sealed đã có sẵn |
| `B-PGM04-03` | Hồ sơ này ở `M2` | **ĐÃ MỞ** ở `0.2` |
| `B-PGM04-04` | `tags` và `compatibility` đã khoá hợp đồng nhưng chưa thi hành | **ĐÃ MỞ** ở `T61-101` — migration `0015` thêm cột `tags`, read model `compatibility` fail-closed đã lên OpenAPI/Go/TS. Phần còn lại (nguồn SYSTEM cho `tags`, pin SYSTEM cho `compatibility`) thuộc `T61-102`/`T61-104` |

## 8. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.7 | 2026-09-04 | Thi hành `T61-104`: phạm vi Draft của Used-In nay ĐO Ở SERVER từ `objects[].dependencies`, nên `availability` lên `COMPLETE` cho entry PROJECT thay vì luôn `SEALED_ONLY`. Dedupe theo cặp (Revision, POU) có hai lớp và mỗi lớp có phép đo riêng. **Đính chính:** as-built `0.6` ghi phạm vi draft là "(FE, Project đang mở)" — đó là mô tả một nguồn KHÔNG authoritative; nay server tự đo. Entry SYSTEM giữ `UNAVAILABLE` và ghi rõ vì sao `T61-104` không mở được nó: cả `library_usages` lẫn `dependencies` đều không mang entry SYSTEM, vì một POU gọi `TON` dùng khối ấy qua SOURCE chứ không qua khai báo. |
| 0.6 | 2026-09-04 | Thi hành `T61-103`: khoá round-trip metadata PROJECT qua restart và qua migrate từ DB `v14` CÓ DỮ LIỆU. Ghi hai lỗi đã sửa: (1) `presentationSha256` đọc thẳng từ cột, trong khi công thức đã đổi một lần ở `T61-101` — nên mọi hàng ghi trước đó trả một hash không phép tính nào hiện tại tái tạo được, và client dùng hash ấy để biết "phần trình bày có đổi không" sẽ thấy mọi entry cũ "đã đổi" ngay lần đọc đầu sau nâng cấp; nay đường đọc TÍNH LẠI. (2) `updateLibraryEntryTx` bỏ sót bốn cột trình bày còn đường publish dựng entry canonical không mang metadata — hai nửa của cùng một cái bẫy, sửa cả hai cùng lúc. |
| 0.5 | 2026-09-04 | Thi hành `T61-102`: registry SYSTEM mở `description`/`tags` cho cả 46 entry, tách `contentSha256` (tập THỰC THI) khỏi `presentationSha256` (tập TRÌNH BÀY), bump `rev-a.3 → rev-a.4`. **Đính chính `0.4` và cả thân issue `#447`:** as-built ghi registry "đã có `category`, `description` và `presentationSha256`" — đo lại thì registry chỉ có `category`; `description` và `presentationSha256` chưa hề tồn tại ở lớp SYSTEM. Ghi lỗi đã sửa: `contentSha256` của entry SYSTEM băm cả nhãn tiếng Việt, nên một lần sửa chính tả đổi danh tính thực thi mà artifact và pin Revision đang dựa vào. |
| 0.4 | 2026-09-04 | Thi hành `T61-101`: `tags` (migration `0015` + chuẩn hoá máy chủ), read model `compatibility` fail-closed, `q` phủ thêm `tags`, Used-In có `nextCursor` và lỗi ổn định. **Đính chính `0.3`:** bảng as-built ghi `presentationSha256` "băm riêng bộ đôi" — nay là bộ **ba** kể cả `tags`. Đóng `B-PGM04-04` phần hợp đồng; phần nguồn SYSTEM chuyển sang `T61-102`/`T61-104`. Ghi hai lỗi đo được và đã sửa trong cùng lát: `upper()` của SQLite chỉ gấp ASCII nên `q` không bao giờ khớp mô tả tiếng Việt; route Used-In quy MỌI lỗi về 400 nên store hỏng cũng báo "request không hợp lệ". |
| 0.3 | 2026-08-29 | Nâng `M3 → M4` sau khi WP-03/WP-04 thi hành. Ghi as-built cây component đã tách, đường ghi metadata (`T61-401`) và ngữ nghĩa Chèn = điều hướng. **Đính chính `0.2`:** bảng `DD-05` ghi `category`/`description` "không có nguồn", nhưng nguồn ĐÃ có từ `T61-101/103` — thứ thiếu là đường GHI, và chính chỗ mô tả sai ấy che mất một cột không ai ghi được suốt một work package. Mở `B-PGM04-04` cho `tags`/compatibility. |
| 0.2 | 2026-08-29 | Nâng `M2 → M3` sau `LOCK-PGM04-CONTRACT-001`. **Đính chính một khẳng định của `0.1`:** Used-In được ghi là "không có nguồn", trong khi bảng `library_usages` đã tồn tại từ migration `0007` và đã được ghi trong chính đường Seal — thứ thiếu là route HTTP, không phải dữ liệu. Nửa sai ấy làm ước lượng chi phí đội lên nhiều lần. |
| 0.1 | 2026-08-29 | Bản đầu cho `T61-003`. Ánh xạ field/action/RBAC/state/test/rollback đo từ source `main@0453891`; ghi bốn field không có nguồn và giữ `M2`. |
