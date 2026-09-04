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

## 5A. Thi hành — `T61-101` / `ISS-PGM04-01` (`2026-09-04`)

Hợp đồng §1–§4 đã lên source. Ba quyết định mà bản khoá `2026-08-29` để mở, nay
được ghi rõ ở đây vì chúng ảnh hưởng tới cả client:

**§2.1 — chuẩn hoá `tags`.** Ba luật đầu là CHUẨN HOÁ (nhận rồi sửa), luật cuối
là TỪ CHỐI:

1. Khoảng trắng: cắt hai đầu, gộp mọi chuỗi khoảng trắng bên trong thành một dấu
   cách.
2. Chữ hoa/thường: hạ hết về chữ thường — khớp `category` của registry, vốn đã
   toàn chữ thường.
3. Trùng lặp: khử sau khi áp (1) và (2), rồi **sắp tăng dần**. Sắp xếp là bắt
   buộc chứ không phải trang trí: một tập hợp không có thứ tự nội tại, nên giữ
   thứ tự người gửi sẽ làm `["b","a"]` và `["a","b"]` sinh hai
   `presentationSha256` khác nhau — và client dùng hash ấy để biết "phần trình
   bày có đổi không" sẽ thấy đổi trong khi không có gì đổi.
4. Vượt trần (quá 8 phần tử **sau** khi khử trùng lặp, một phần tử quá 24 ký tự,
   một phần tử rỗng sau khi trim, hoặc mang ký tự điều khiển): **400**, không
   cắt bớt. Cắt bớt im lặng làm read-back trả về thứ khác thứ client vừa gửi.

Mảng rỗng **không** phải trạng thái thứ ba: đường ghi quy `[]` về vắng mặt, vì
"không thẻ nào" và "chưa gắn thẻ" là cùng một câu. Khác `description`, nơi chuỗi
rỗng là một mô tả đã viết và cố ý để trống.

`presentationSha256` từ lát này băm bộ **ba** `category`/`description`/`tags`.

**§4 — nguồn của `compatibility`.** `requiredVersion` đọc từ `library_usages` của
Revision đã Commission thành công gần nhất; `availableVersion` là version của
library revision `PUBLISHED` mới nhất mang entry đó ("mới nhất" đo bằng
`created_at_utc_ms`, không bằng so chuỗi version — `"1.10.0" < "1.9.0"`).
`DEPRECATED` bị loại: một version đã khai tử không phải "bản có sẵn để nâng lên".
Thiếu bất kỳ vế nào ⇒ `UNKNOWN` kèm lý do. Entry SYSTEM luôn `UNKNOWN` cho tới
khi `T61-104` mở đường phân giải từ registry/profile lock.

**§1.4 — cursor Used-In.** Hai cursor tách bạch (`sealedCursor`, `draftCursor`),
mỗi phạm vi một cái; một cursor dùng chung sẽ buộc thêm tham số "đang phân trang
phạm vi nào", và hai danh sách độc lập không có lý do gì phải tiến cùng nhịp.
Cursor ký HMAC, mang cả `libraryRevisionId`/`entryId`, hết hạn 15 phút. Keyset là
tuple `(projectName, revisionId, objectId, usageKind)` — đúng `ORDER BY` của
truy vấn. `draftCursor` được khai báo nhưng máy chủ còn từ chối mọi giá trị khác
rỗng cho tới `T61-104`: nhận nó im lặng sẽ hứa một trang không tồn tại.

**Hai lỗi đo được và đã sửa trong cùng lát.**

| Lỗi | Triệu chứng | Nguyên nhân gốc |
|---|---|---|
| `q` bỏ sót mô tả tiếng Việt | Gõ `quạt` không ra khối có mô tả "Điều khiển quạt hồi gió" | `upper()` của SQLite chỉ gấp ASCII (`upper('quạt') = 'QUạT'`), trong khi Go đã gấp từ khoá thành `QUẠT`. Sửa bằng hàm SQL `mkddc_upper` dùng `strings.ToUpper` của Go |
| Used-In trả 400 cho mọi lỗi | Store hỏng cũng báo "request không hợp lệ" | Handler quy mọi `err` về `ErrInvalidRequest`; lớp application trả `fmt.Errorf` trần nên không có gì để phân biệt. Nay dùng sentinel |

OpenAPI `1.33.0 → 1.34.0`, vẫn additive. Cả hai chốt SHA re-pin trong cùng
change-set.

## 5B. Thi hành SYSTEM — `T61-102` / `ISS-PGM04-02` (`2026-09-04`)

§2.1 nói `tags` và `description` có nguồn "SYSTEM: registry sinh". Lát này giao
nguồn đó, và trong lúc giao thì phát hiện một khẳng định của §2.2 chưa đúng ở
lớp SYSTEM.

**Chuẩn hoá ở registry là KIỂM, không phải SỬA.** Registry là tệp người viết tay
và được review. Nếu generator tự hạ chữ thường và sắp lại thẻ lúc sinh, thì bản
đã review khác bản đã sinh, và không ai nhìn thấy khác biệt đó. Nên registry
phải mang thẻ ở dạng canonical sẵn (NFC, chữ thường, một dấu cách giữa từ, không
trùng, **sắp tăng dần**) và generator từ chối tệp lệch chuẩn kèm lý do đọc được.
Khác hẳn đường ghi PROJECT (§2.1), nơi payload đến từ client nên máy chủ chuẩn
hoá rồi mới lưu.

**§2.2 chưa đúng ở lớp SYSTEM cho tới lát này.** Bản khoá viết
"`presentationSha256` chỉ băm phần trình bày" và "sửa một dòng mô tả **không
được** đổi `contentSha256`". Với PROJECT thì đúng từ `T61-103`. Với SYSTEM thì
`render_go` băm **toàn bộ** entry vào `ContentSHA256Hex`, nên `labelVi`,
`labelEn` và `category` nằm trong danh tính thực thi. Hai tập field nay tách
bạch và được khoá ở **ba** nơi độc lập:

| Nơi | Vai trò |
|---|---|
| `EXECUTABLE_FIELDS` / `PRESENTATION_FIELDS` (generator Python) | Sinh hai hash |
| `splitLibrarySignature` (domain Go) | Tính LẠI hai hash lúc nạp, không tin hằng sinh |
| `ValidateLibraryEntry` (domain Go) | Chặn entry có hash không khớp tập thực thi |

Ba bản sao là CÓ CHỦ Ý — chúng khoá lẫn nhau. Lệch một field thì hash không khớp
và binary từ chối nạp registry, thay vì âm thầm công bố một danh tính đã đổi
nghĩa.

Tập thực thi: `id`, `kind`, `dispatch`, `polymorphic`, `allowedTypes`,
`defaultType`, `typedPortNames`, `ports`, `featureState`.
Tập trình bày: `category`, `labelVi`, `labelEn`, `description`, `tags`,
`warningVi`, `warningEn`.

`SignatureJSON` vẫn giữ **toàn bộ** entry — FE đọc `category`/nhãn/`ports` từ đó,
nên nó không được rút gọn; hai hash chỉ là hai tập con của chính nó.

**Bump `rev-a.3 → rev-a.4` kéo theo bốn thứ pin.** Ghi ra đây vì lần sau ai bump
cũng sẽ gặp đúng bốn thứ này: product profile (kèm `const` trong schema của nó),
golden build manifest ST/FBD (`buildKeySha256` phụ thuộc `profile.sha256` nên
phải tính lại chứ không sed), golden package `package_v2_ahu.mkpkg` (sinh bằng
chính `mkddc-st-package-golden`, không sửa tay), và ba chốt SHA.

## 6. Hệ quả cho gate

| Blocker DDD | Trạng thái |
|---|---|
| `B-PGM04-01` metadata không có nguồn | **MỞ** — hợp đồng §2 khoá xong |
| `B-PGM04-02` Used-In không có API | **MỞ** — hợp đồng §1 khoá xong; dữ liệu sealed đã có sẵn |
| `B-PGM04-03` DDD ở `M2` | Mở được sau khi DDD lên `0.2`/`M3` |
| `B-PGM04-04` `tags`/compatibility chưa thi hành | **ĐÃ MỞ** phần hợp đồng ở `T61-101` (`2026-09-04`); nguồn SYSTEM còn ở `T61-102`/`T61-104` |
