# Bằng chứng HOST — PGM-02 R1 catalog dùng chung và Quick Library (`T59-804`, phần 1)

| Thuộc tính | Giá trị |
|---|---|
| Ngày | 2026-08-26 |
| Nhánh | `feat/t59-804-quick-library` |
| Phạm vi | `T59-804` / `PGM02-V22-WP-03` — **một phần**, xem §4 |
| Authority | `AUTH-PROG-2026-08-24-05`; proposal PGM-02 `WP-03` |
| Lớp bằng chứng | **HOST/LOCAL** — không phải Test Result, không phải target/HIL |

## 1. Điều được chứng minh

| Acceptance của `WP-03` | Trạng thái | Nơi chứng minh |
|---|---|---|
| PGM-02 và PGM-04 cùng catalog ID/version/signature/hash | **ĐẠT** | Lane real-backend so `GET /libraries?scope=SYSTEM` với registry sinh sẵn: `onlyInBackend=[]`, `onlyInGenerated=[]`, `matched=40` |
| Không có block list thứ hai cho ST/FBD | **ĐẠT** | Quick Library đọc `GET /libraries`; palette FBD đọc registry sinh từ cùng contract; parity ở trên là phép kiểm liên tục |
| Function call là MỘT bước Undo | **ĐẠT** | E2E mock: chèn `LIMIT` rồi `Ctrl+Z` trả về đúng nội dung trước đó |
| FB create+call trong một thao tác | **ĐẠT (ST)** | `stInsertionSnippet` sinh cả khai `VAR instance : FB;` lẫn lời gọi — grammar IEC đòi instance trước |
| Mục không dùng được nói thật | **ĐẠT** | `REVIEW_REQUIRED` (PID) và `SIGNATURE_UNAVAILABLE` hiện ra kèm lý do, nút chèn bị vô hiệu |
| Recent chỉ cập nhật sau khi chèn thành công | **ĐẠT** | Unit test: `onInsert` trả `false` ⇒ không `PUT` preferences |
| Favorites không giữ bản sao chữ ký | **ĐẠT** | Chỉ lưu `entryId`; trần 24 favorites / 12 recent |
| Ambiguous FBD port không auto-connect | **CHƯA** | Thuộc phần FBD chưa giao (§4) |

## 2. Cổng đã đo

| Cổng | Kết quả |
|---|---|
| FE `npx vitest --run --environment jsdom src` | **143 file / 1563 test PASS** |
| FE `npm run lint` + `npm run build` | PASS; chunk Programming **103,54 KiB gzip** |
| E2E mock (cut-over BẬT) | **31 PASS / 5 skip / 0 fail** |
| E2E real-backend | **1/1 PASS**; `HTTP>=500=0`, `requestfailed=0`, `console.error=0` |

## 3. Một lỗi thật sửa kèm

Túi `/me/preferences` là **dùng chung**: `pushSavedViews` của Monitor/Trends
`PUT` cả túi. Nếu Quick Library cũng `PUT` cả túi thì một cú bấm ngôi sao sẽ xoá
khung nhìn đã lưu của người dùng. `pushLibraryPreferences` vì vậy đọc túi hiện
có rồi **merge** đúng namespace `programmingLibrary`; unit test khẳng định
`views` còn nguyên sau khi đánh dấu yêu thích.

Catalog cũng được giữ **LAZY**: mở tab Chương trình không tạo request
`GET /libraries` nào; chỉ khi mở panel mới fetch (E2E khẳng định điều này).

## 4. Phần của `WP-03` CHƯA giao

Mỗi phần thiếu một hợp đồng hoặc một năng lực, không phải chỉ thiếu thời gian:

1. **Chèn vào canvas FBD từ dock dùng chung** và **compatible filter theo port
   đang chọn**. Palette FBD hiện đã đọc cùng registry (không có danh sách thứ
   hai), nhưng dock Quick Library mới chỉ phục vụ ST.
2. **Typed metadata public trong OpenAPI**: `interface` vẫn là generic object,
   nên FE phải tự parse chữ ký. Nâng nó là một contract change (`T59-804` phần
   BE) cần promote Active trong task.
3. **Bổ sung block** `TP`/`CTU`/`CTD`/`SCALE`/`Deadband`/`Hysteresis`. Compiler
   hiện chỉ có `TON`/`TOF`/`R_TRIG`/`F_TRIG`/`PID` (`st_fb_type_from_name`), và
   plan cấm publish capability trước khi có compiler/runtime equivalence tests.
   Catalog vì vậy khai đúng thứ chạy được — thêm chúng vào registry trước sẽ tái
   lập đúng lỗi cũ (palette từng chào SCALE/DEADBAND/CTU/PI mà compiler không
   có).

`VS-PROG-U13` chưa chạy; `IMPLEMENTATION_CLOSE` PENDING; `RELEASE_READY` NO-GO.
