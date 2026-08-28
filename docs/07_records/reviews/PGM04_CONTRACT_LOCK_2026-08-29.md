# `T61-005` — Khoá hợp đồng PGM-04: metadata, search, Used-In, compatibility

| Thuộc tính | Giá trị |
|---|---|
| ID | `LOCK-PGM04-CONTRACT-001` |
| Task | `T61-005` (Plan 61, WP-00) |
| Ngày | 2026-08-29 |
| Authority | [`AUTH-PROG-2026-08-29-PGM04-001`](AUTH-PROG-2026-08-29-PGM04-001.md) |
| Baseline | `main@782b3e4`; OpenAPI `1.30.0` |
| Kết luận | Toàn bộ delta **ADDITIVE**. `1.30.0 → 1.31.0` |

## 0. Một đính chính cho `DDD-SW-PGM04-LIBRARY-001`

Bản `0.1` của DDD ghi Used-In là "không có nguồn". **Sai một nửa, và nửa sai làm
đội chi phí lên nhiều lần.**

Đọc kỹ store thì:

- Bảng **`library_usages` đã tồn tại** từ migration `0007`
  ([`0007_control_library_domain.sql:57`](../../../apps/web-api/internal/programming/store/migrations/0007_control_library_domain.sql#L57)),
  cột `revision_id, object_id, library_revision_id, entry_id, required_version, usage_kind`.
- Nó **đã được ghi** trong chính đường Seal Revision, lúc phân giải dependency
  của từng POU ([`library.go:1145`](../../../apps/web-api/internal/programming/store/library.go#L1145)).
- Accessor `ListLibraryUsages` **đã có**
  ([`library.go:1163`](../../../apps/web-api/internal/programming/store/library.go#L1163)).

Thứ thiếu là **route HTTP và read model**, không phải dữ liệu. DDD được sửa
tương ứng ở phiên bản `0.2`.

Nhưng bảng đó chỉ phủ **một phần**, và phần thiếu quyết định thiết kế bên dưới:

| Phạm vi | Có trong `library_usages`? | Vì sao |
|---|---|---|
| PROJECT entry, Revision đã niêm phong | ✅ có | FK tới `pou_objects(revision_id, object_id)` |
| PROJECT entry, **Draft đang sửa** | ❌ không | Draft chưa Seal ⇒ chưa có `pou_objects` |
| **SYSTEM entry**, mọi phạm vi | ❌ không | Cố ý — chú thích migration ghi rõ SYSTEM usage phân giải từ registry/profile lock, "không tạo FK giả tới một row DB không có" |

## 1. Used-In — hợp đồng đã khoá

### 1.1 Hai phạm vi, không gộp

Theo `D61-08`. Read model trả **hai** con số và **hai** danh sách:

```
usage: {
  sealed:  { count, truncated, items[] },   // Revision đã niêm phong
  draft:   { count, truncated, items[] },   // Draft đang sửa
  availability: "COMPLETE" | "SEALED_ONLY" | "UNAVAILABLE"
}
```

`availability` là trường **bắt buộc**, và đây là chỗ hợp đồng này khác một API
usage thông thường: với entry **SYSTEM**, `sealed` không đến từ `library_usages`
mà phải phân giải từ registry/profile lock. Cho tới khi `T61-104` giao đường
phân giải ấy, SYSTEM entry trả `availability: "UNAVAILABLE"` — **không** trả
`count: 0`.

`count: 0` nghĩa là "không chương trình nào dùng khối này" — một câu mời người ta
xoá hoặc deprecate nó. `UNAVAILABLE` nghĩa là "chưa đo được". Cho ra `0` khi
đang không đo được là cách một khối bị gỡ trong khi nó đang điều khiển tủ.

### 1.2 Đếm cái gì

Một mục `items[]` là **một cặp (Revision, POU)**, không phải một lần gọi. Một
POU gọi `SCALE_LIN` mười lần vẫn là **một** mục: câu người dùng hỏi là "chương
trình nào đang dùng khối này", không phải "khối này bị gọi bao nhiêu lần".

`usage_kind` (`CALL`/`INSTANCE`) đi kèm từng mục vì hai loại ấy có hệ quả khác
nhau khi đổi version: `INSTANCE` mang trạng thái, `CALL` thì không.

### 1.3 Chéo Project

Cho phép, kèm tên Project. Cơ sở là phép đo:
[`ListProjects`](../../../apps/web-api/internal/programming/store/queries.go#L24)
không lọc theo chủ sở hữu và `read` là quyền mọi vai đã đăng nhập đều có — sản
phẩm không có phân vùng theo Project.

### 1.4 Trần và cursor

`items[]` tối đa **200** mục mỗi trang, `truncated: true` khi còn nữa, cursor
theo tuple `(revisionId, objectId)`. Không trả danh sách không giới hạn: một
khối SYSTEM phổ biến có thể xuất hiện trong mọi POU của mọi Project.

## 2. Metadata — hợp đồng đã khoá

### 2.1 Trường thêm vào `ProgrammingLibraryEntry`

| Field | Kiểu | Bắt buộc | Nguồn |
|---|---|---|---|
| `category` | `string`, ≤ 32 | không | SYSTEM: registry sinh · PROJECT: cột store |
| `description` | `string`, ≤ 512 | không | như trên |
| `tags` | `string[]`, ≤ 8 phần tử, mỗi phần tử ≤ 24 | không | như trên |
| `presentationSha256` | `string` hex 64 | không | hash của bộ ba trên |

Cả bốn **optional**. Client cũ bỏ qua field lạ ⇒ additive thật, không phải
additive trên danh nghĩa.

### 2.2 `presentationSha256` tách khỏi `contentSha256` — `D61-09`

`contentSha256` là danh tính **thực thi**: nó đi vào artifact, vào chữ ký, vào
pin của Revision. `presentationSha256` chỉ băm phần trình bày.

Sửa một dòng mô tả **không được** đổi `contentSha256`. Nếu đổi, mọi artifact và
pin đã ký thành lỗi thời chỉ vì một lần sửa chính tả — và hậu quả thật không
phải "phải build lại", mà là **người ta sẽ thôi không sửa tài liệu nữa**.

### 2.3 Migration

Cột thêm vào `library_entries` phải `NULL`-able và **không** nằm trong phép tính
`content_sha256`. `library_revisions_published_immutable` (trigger sẵn có) chỉ
chặn đổi `manifest_sha256`/`version`/`scope`, nên thêm cột trình bày **không**
đụng bất biến "PUBLISHED là bất biến" — nhưng ghi metadata lên một revision
PUBLISHED vẫn phải bị từ chối ở tầng application, vì nội dung một revision đã
phát hành là thứ người khác đã đọc và đã pin.

Migration lấy ordinal **`0014`** (head hiện tại là `0013`).

## 3. Search — hợp đồng đã khoá

Hôm nay `q` chỉ so `name` và `entryId`
([`library.go:947`](../../../apps/web-api/internal/programming/store/library.go#L947)).

Mở rộng: `q` phủ thêm `description` và `tags`; thêm tham số lọc `category`
(chính xác, không mờ). **Không** phủ "I/O names/types" như handoff §7 đòi:
chữ ký nằm trong `signature_json` dạng BLOB, và quét chuỗi trong JSON sẽ khớp cả
tên kiểu lẫn tên tham số lẫn giá trị mặc định — một phép tìm trả về kết quả
không giải thích được là tệ hơn một phép tìm hẹp mà đúng. Nếu cần tìm theo chữ
ký thì đó là một chỉ mục riêng, không phải một `LIKE` rộng hơn.

Cursor **phải đổi khi `q`/`category` đổi** — hợp đồng cursor hiện có đã ràng
buộc điều này
([`library.go:163`](../../../apps/web-api/internal/programming/application/library.go#L163))
và delta không được nới nó.

## 4. Compatibility — hợp đồng đã khoá

Thêm vào read model của entry:

```
compatibility: {
  state: "COMPATIBLE" | "REQUIRES_MIGRATION" | "UNKNOWN",
  requiredVersion,        // version mà Revision đang pin
  availableVersion,       // version mới nhất PUBLISHED
  reason                  // chỉ có khi state ≠ COMPATIBLE
}
```

`UNKNOWN` là giá trị **mặc định**, không phải trường hợp lỗi: khi Project chưa
Seal Revision nào thì không có gì để so, và nói "tương thích" lúc ấy là một
khẳng định không có cơ sở.

Phần "không âm thầm nâng version" (`AC-PGM04-05`) **đã** được bảo đảm bởi cơ chế
pin `libraryRevisionId` ở Revision — hợp đồng này chỉ làm cho trạng thái ấy
*nhìn thấy được*, không thêm cơ chế mới.

## 5. Rủi ro của delta này

| Rủi ro | Vì sao | Giảm thiểu |
|---|---|---|
| `x-rbac` lệch bảng route | Từng xảy ra thật trong phiên trước | Cổng `rbac_contract_test.go` đã có, chạy sẵn |
| `openapiSha256` lỗi thời | Ba nơi pin: `pgm02_workspace_v1.json`, `g1_contract_join_v1.json`, manifest | Re-pin **cùng change-set**, không để sang PR sau |
| Registry generator lệch hằng C++/Go/TS | Metadata SYSTEM sinh từ registry | `verify-project.sh --component layout` đã canh 3/3 tệp sinh |
| Migration `0014` chạy trên bo có dữ liệu | Cột mới trên bảng đang dùng | `NULL`-able + backup preflight; không rewrite revision |

## 6. Hệ quả cho gate

| Blocker DDD | Trạng thái |
|---|---|
| `B-PGM04-01` metadata không có nguồn | **MỞ** — hợp đồng §2 khoá xong |
| `B-PGM04-02` Used-In không có API | **MỞ** — hợp đồng §1 khoá xong; dữ liệu sealed đã có sẵn |
| `B-PGM04-03` DDD ở `M2` | Mở được sau khi DDD lên `0.2`/`M3` |
