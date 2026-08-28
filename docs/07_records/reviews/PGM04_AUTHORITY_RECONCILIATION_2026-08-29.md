# `T61-001` — Đối chiếu authority PGM-04 Control Library

| Thuộc tính | Giá trị |
|---|---|
| ID | `REC-PGM04-AUTHORITY-001` |
| Task | `T61-001` (Plan 61, WP-00) |
| Ngày | 2026-08-29 |
| Base | `main@d368ffc` |
| Đầu vào | [PGM-04 FE Handoff](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-04_LIBRARY_FE_HANDOFF.md), `contracts/openapi/openapi.yaml`, bảng route Go, store/domain Control Library |
| Kết luận | **10 mâu thuẫn**, trong đó **6 mức CAO**. Handoff KHÔNG dùng được làm đặc tả thi hành nếu chưa xử lý sáu mục ấy |

## 0. Đọc nhanh

Handoff PGM-04 được viết trước ba thứ đã đổi kể từ đó: mô hình vai bốn cấp
(`WEB-RBAC-001`), vòng đời publish theo Seal Revision (`D61-05`), và cổng an
toàn `featureState` (`T59-205`). Hệ quả là handoff mô tả một sản phẩm hơi khác
sản phẩm đang chạy — và ba trong sáu mâu thuẫn mức CAO là **thiếu nguồn dữ
liệu**, tức không thể sửa bằng cách viết FE khéo hơn.

Điều đáng chú ý nhất: **`category` là trường BẮT BUỘC trên card theo handoff §2,
và nó không có nguồn nào trong hệ thống.**

## 1. Bảng mâu thuẫn

| Mã | Trục | Handoff nói | Authority nói | Mức | Xử lý đề xuất |
|---|---|---|---|---|---|
| `C-PGM04-01` | RBAC | §5 "Create block flow — **Admin only**"; §8 "Create Block **for admin**" | Server đòi `program.edit`, mà `engineer` CÓ ([router.go:60](../../../apps/web-api/internal/programming/transport/http/router.go#L60)); `x-rbac: [engineer, admin]` ([openapi.yaml:2118](../../../contracts/openapi/openapi.yaml#L2118)) | **CAO** | Sửa handoff theo server. Làm đúng chữ "Admin only" sẽ chặn engineer ở **giao diện** trên thứ máy chủ chấp nhận — đúng lớp lỗi vừa phải vá ở `PointLoggingControl` |
| `C-PGM04-02` | Scope | §1 ba tab: Core / Project / **User Library**; §5 "save/publish to Project/**User** library" | `scope` chỉ có `SYSTEM \| PROJECT` ([openapi.yaml:2096](../../../contracts/openapi/openapi.yaml#L2096), [entry schema:3970](../../../contracts/openapi/openapi.yaml#L3970)); không có bảng, route hay domain nào cho USER | **CAO** | Bỏ tab User khỏi Target. `D61-02` đã LOCKED điều này; handoff là bản lỗi thời |
| `C-PGM04-03` | Publish | §5 bước 5 "save/**publish** to Project library" | Không có route publish. Save chỉ ghi Library **Draft**; PUBLISHED chỉ xảy ra khi Seal Revision (`D61-05`) | **CAO** | Bỏ "publish" khỏi luồng Create. Một nút publish riêng sẽ hứa một thao tác không tồn tại — và nếu có ai làm nó thật thì nó phá tính nguyên tử của Seal |
| `C-PGM04-04` | PID/an toàn | §4 chỉ nói Insert cần "active compatible editor context". **Không nhắc `REVIEW_REQUIRED`** | `featureState: AVAILABLE \| REVIEW_REQUIRED` có sẵn trong entry ([openapi.yaml:3978](../../../contracts/openapi/openapi.yaml#L3978)); `D61-04`/`T59-205` bắt Insert **disabled** + badge, không có bypass | **CAO (do im lặng)** | Bổ sung vào Target. Im lặng ở handoff nguy hiểm hơn mâu thuẫn: người viết FE không được nhắc thì sẽ cài Insert không có cổng, và không có gì đỏ |
| `C-PGM04-05` | Used-In | §3 "Used In: list Programs/POUs, click → PGM-02"; `AC-PGM04-02` "usage count và Used In navigable" | **Không có API usage nào.** Bốn route library là read/upsert/delete/deprecate | **CAO** | Không thể giao bằng FE. Cần contract mới — thuộc `T61-005`/`T61-104`. Ngữ nghĩa chưa khoá: xem §2 Q3 |
| `C-PGM04-06` | Metadata | §2 card **bắt buộc** có `category`; §7 search phủ `description`, `tags` | Entry schema **không có** `category`, `description`, `tags` ([openapi.yaml:3968](../../../contracts/openapi/openapi.yaml#L3968)) | **CAO** | Không thể giao bằng FE. Cần nguồn: registry sinh cho SYSTEM + store cho PROJECT (`T61-102`/`T61-103`). Xem §2 Q2 |
| `C-PGM04-07` | Search | §7 phủ name, category, description, I/O names/types, tags | `q` chỉ so `name` và `entryId`, cả hai nhánh SYSTEM và PROJECT ([library.go:947](../../../apps/web-api/internal/programming/store/library.go#L947), [library.go:958](../../../apps/web-api/internal/programming/store/library.go#L958)) | TRUNG BÌNH | Giao theo từng bậc: name+entryId đã có; phần còn lại đi cùng metadata |
| `C-PGM04-08` | Route | Header: `/eng/programming/library` (không gắn Project) | FE thật: `projects/:projectId/library` ([ProgrammingRoutes.tsx:17](../../../apps/web-ui/src/features/programming/ProgrammingRoutes.tsx#L17)) | TRUNG BÌNH | Giữ project-scoped (`D61-01` LOCKED). PROJECT Library thuộc về một Project — route không gắn Project sẽ phải đoán, và đoán sai thì hiện thư viện của Project khác |
| `C-PGM04-09` | Từ vựng | Tab tên "**Core** Library" | Contract dùng `SYSTEM` | THẤP | Quyết một lần rồi dùng nhất quán — xem §2 Q4 |
| `C-PGM04-10` | Version | §6 + `AC-PGM04-05` "không âm thầm nâng version không tương thích" | Revision pin `libraryRevisionId`; `libraryVersion`/`libraryState` có trong entry; chưa có phép so **compatibility** giữa version và Project đang dùng | TRUNG BÌNH | Phần "không âm thầm nâng" đã được bảo đảm bằng pin. Phần "hiện trạng thái tương thích" cần contract — `T61-005` |

## 2. Câu hỏi phải có chủ sở hữu quyết

| Mã | Câu hỏi | Phương án và hệ quả |
|---|---|---|
| `Q1` | Bỏ hẳn tab **User Library** khỏi Target, hay mở domain USER? | (a) **Bỏ** — khớp `D61-02` đã LOCKED, không phát sinh việc. (b) Mở USER — thêm bảng, route, RBAC, migration, và một trục phân quyền mới ("của tôi" vs "của Project") mà sản phẩm hiện chưa có khái niệm. Chi phí lớn, giá trị chưa ai nêu |
| `Q2` | `category` lấy nguồn ở đâu? | (a) Registry sinh cho SYSTEM + cột store cho PROJECT — hai nguồn, một hình dạng. (b) Suy từ `kind` — **sai**, `kind` là FUNCTION/FB chứ không phải phân loại nghiệp vụ. (c) Bỏ `category` khỏi card — mâu thuẫn handoff §2 |
| `Q3` | Used-In đếm theo phạm vi nào? | Xem §3 — tôi đề nghị hai phạm vi tách bạch |
| `Q4` | Nhãn hiển thị: "Core" hay "System"? | Từ vựng người dùng đọc nên khớp từ vựng tài liệu vận hành. Chọn một, ghi vào i18n, không để hai nơi hai chữ |

## 3. Ghi chú cho `T61-005` — Used-In

Câu hỏi bảo mật "có được lộ tên Project khác không" đã **đo, không đoán**:
[`ListProjects`](../../../apps/web-api/internal/programming/store/queries.go#L24) không
có bộ lọc theo chủ sở hữu, và `read` là quyền mọi vai đã đăng nhập đều có. Sản
phẩm không có phân vùng theo Project, nên Used-In chéo Project **không lộ thêm
gì**.

Phần chưa khoá là *ngữ nghĩa*: đếm theo Draft, theo Revision đã niêm phong, hay
cả hai. Gộp thành một con số là cách một khối bị deprecate trong khi nó đang
điều khiển tủ.

## 4. Điều đã khớp — không cần đụng

- **Upsert có sẵn.** `POST .../library/entries` là `upsertProgrammingLibraryEntry`, nên "Edit" của handoff §1 giao được ngay.
- **SYSTEM bất biến.** Không có route ghi nào cho scope SYSTEM ⇒ `AC-PGM04-04` đúng theo thiết kế, không cần chốt thêm.
- **Phân trang cursor** đã có (`ProgrammingCursor`/`ProgrammingLimit`), khớp `T61-202`.
- **Chữ ký khối** đã có dạng đã phân giải (`signature`) kèm quy ước "vắng field = chưa đọc được" ⇒ `AC-PGM04-01` giao được ngay.
- **Cổng `featureState`** đã có nguồn; chỉ thiếu phần handoff nhắc tới.
- **`stateLayoutKnown`** đã mang đúng quy ước "chưa biết ≠ bằng 0".

## 5. Kết luận cho `T61-004`

Handoff PGM-04 **không dùng làm đặc tả thi hành như hiện trạng**. Ba mục
`C-PGM04-05/06/07` là thiếu **nguồn dữ liệu**, không phải thiếu công sức FE —
giao chúng cho FE mà không mở contract trước sẽ đẻ ra dữ liệu bịa trên màn hình.

Thứ tự mở khoá đề nghị: `Q1`/`Q2`/`Q4` quyết ngay (rẻ, không phụ thuộc gì) →
`T61-005` khoá ngữ nghĩa Used-In + compatibility → khi đó `T61-002` mới có đủ
trường để vẽ đúng, và `T61-004` mới ký được.
