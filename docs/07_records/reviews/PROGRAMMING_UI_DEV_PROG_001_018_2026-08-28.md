# Hồ sơ thi hành `DEV-PROG-001..018` — giao diện Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `REC-PGM02-DEVPROG-001` |
| Ngày | 2026-08-28 |
| Nguồn đề bài | Review giao diện trang `/eng/programming/programs` của chủ sở hữu (18 mục `DEV-PROG-001..018`, phân mức P0/P1/P2/P3) |
| Phạm vi | `apps/web-ui` (workspace PGM-02, rail, thanh trên cùng, token theme), `apps/web-api` (operation `annotateObject`), `contracts/programming` |
| Nhánh | `feat/prog-ui-dev-prog-001-018` |
| Trạng thái | Đã thi hành 18/18; **một mục cần chủ sở hữu ký lại** (xem §4) |

## 1. Vì sao hồ sơ này tồn tại

Đề bài mô tả `DEV-PROG-001` là *"tab bottom panel bị sidebar che"* và đoán nguyên
nhân là *"z-index / width của sidebar chồng lấn"*. Phép đo bác bỏ chẩn đoán đó,
và nếu sửa theo chẩn đoán ban đầu thì triệu chứng vẫn còn nguyên. Hồ sơ ghi lại
số đo để lần sau không ai phải đo lại từ đầu.

## 2. Phép đo trước khi sửa

Chrome thật (Playwright, `channel: chrome`), đăng nhập `admin` trên bo
`mekong-fac.ddns.net:8082`, Project `AHU-MASTER-SEQUENCE`, POU
`AHU_MasterSequence` (128 dòng ST).

| Phép đo | Trước | Sau |
|---|---|---|
| Chiều cao tài liệu (viewport 1280×800) | **2861 px** | **852 px** |
| Vị trí dải tab workbench | `y = 2675` | `y = 570` |
| Hit-test 5 tab workbench | ngoài màn hình | trúng chính nó, cả 1280/1440/1920 |
| Mép phải rail / mép trái workbench | `241` / `257` | không đổi |

**Kết luận: rail KHÔNG hề chồng lấn workbench.** Rail là `position: sticky`, nên
suốt ~1900 px cuộn để tới workbench nó vẫn đứng cạnh một vùng trống — ảnh chụp
trông y như bị che. Nguyên nhân thật là ba nguồn cùng đẩy chiều cao: khung soạn
thảo chốt cứng theo `clamp` (288 px ở viewport 800), danh sách `Ký hiệu & kiểu`
không chặn trần (36 ký hiệu ≈ 900 px), và các khay phụ nối đuôi trong dòng chảy
của trang.

## 3. Bảng đối chiếu 18 mục

| Mã | Mức | Trạng thái | Ghi chú thi hành |
|---|---|---|---|
| `DEV-PROG-001` | P0 | Xong | Bố cục cao theo viewport; ba cột tự cuộn; thanh trạng thái ghim đáy. E2E `DEV-PROG-001` khoá cả vị trí lẫn hit-test |
| `DEV-PROG-002` | P1 | Xong | Panel cắm ở cột phải (không cạnh editor — xem §5), thẻ có sơ đồ chân, menu `⋯`, "Xem thêm khối…" |
| `DEV-PROG-003` | P1 | Xong | 5 cột + xu hướng + thêm/bỏ biến + nháy đúp trong editor |
| `DEV-PROG-004` | P1 | Xong | Operation `annotateObject` mới; đóng `UD-PROG-015` |
| `DEV-PROG-005` | P1 | Xong | Nút `+` nối Bảng lệnh nhanh; trần tab 8 → 10 |
| `DEV-PROG-006` | P2 | Xong (trừ kéo-thả) | Nhóm gập, chấm POU đang mở, menu chuột phải. Kéo-thả sắp xếp: **không làm**, xem §5 |
| `DEV-PROG-007` | P2 | Xong | `<select>` Project, chỉ khi >1 Project |
| `DEV-PROG-008` | P2 | Xong | `r{N}` từ `draftSequence`/`activeSequence` (`T60-015`) |
| `DEV-PROG-009` | P2 | Xong | Workspace đăng ký hành động; header gọi lại |
| `DEV-PROG-010` | P2 | Xong | Token `--c-rail-*`, kèm 3 ca WCAG mới |
| `DEV-PROG-011` | P2 | Xong | Thuộc tính POU + nhãn chức năng rời thanh bên |
| `DEV-PROG-012` | P2 | Xong một phần | Hộp "Tới dòng" + `Ctrl+G`. Ô `Bảng mã` giữ `—`, xem §5 |
| `DEV-PROG-013` | P3 | Xong | Một badge `Thiết bị: <tên> · ONLINE` |
| `DEV-PROG-014` | P3 | Xong | Trạng thái nặng nhất + `+N`; đủ ở `title` |
| `DEV-PROG-015` | P3 | Đã quyết | **GIỮ** tab Thực thi; lý do ở `ExecutionTab.tsx` |
| `DEV-PROG-016` | P3 | Xong | Kéo-thả khối vào editor, kiểu dữ liệu riêng |
| `DEV-PROG-017` | P3 | Xong | Regex + danh sách chỗ dùng |
| `DEV-PROG-018` | P3 | Xong | LCS theo dòng, tô thêm/bớt, cờ thô >400 dòng |

## 4. Cần chủ sở hữu ký lại — hợp đồng `PGM02-WORKSPACE-V1` lên 1.2

`DEV-PROG-004` đòi ba trường (`Access`, `Description`, tên Task) mà `UD-PROG-015`
đã chốt là **không có nguồn** trong Draft v2. Cấp nguồn cho chúng cần một
operation mới (`annotateObject`), tức **sửa hợp đồng**: `edit.draft.operations`
đi từ 15 lên 16 mục và `version.minor` 1 → 2.

Hồ sơ hợp đồng đang mang `ownerDisposition: APPROVED_FULL_PLAN` và pin
`approvedCandidateCommit`. Thay đổi đã thi hành và verifier
(`scripts/verify_programming_pgm02_contract.py`) PASS, nhưng **chữ ký của chủ sở
hữu cho bản 1.2 là thứ còn thiếu** — đây là cổng quản trị, không phải cổng kỹ
thuật.

## 5. Ba chỗ cố ý làm khác đề bài

1. **`DEV-PROG-002` — panel ở cột phải, không cạnh khung soạn thảo.** Đề bài vẽ
   panel ngay bên phải editor. Đã thi hành đúng như vậy rồi ĐO LẠI: ở 1440 px,
   ba cột `280 + 1fr + 308` cộng panel 288 px làm vùng gõ còn **188 px**. Panel
   về cột phải giữ vùng gõ **484 px**. Vẫn "bên phải editor" và vẫn gập được.
2. **`DEV-PROG-006` — không làm kéo-thả sắp xếp POU.** AC ghi *"nếu có"*. Thứ tự
   thực thi thuộc tab Thực thi; một đường sửa thứ hai cho cùng dữ liệu là hai
   luật có thể lệch nhau.
3. **`DEV-PROG-012` — ô `Bảng mã` vẫn là `—`.** Đề bài ghi `UTF-8`. Trình duyệt
   đã giải mã tệp TRƯỚC KHI FE thấy nó, nên FE không có cách nào biết bảng mã
   gốc. `UTF-8` sẽ không bao giờ trông sai, và đó chính là lý do nó nguy hiểm:
   nó vẫn hiện `UTF-8` cho đúng cái tệp đang làm hỏng ký tự tiếng Việt của người
   dùng. Quyết định này có từ `T59-821` và không đổi.

Ngoài ra, năm nhóm tab của đề bài (`All/Common/HVAC/Math/Logic`) được thay bằng
**nhóm THẬT của thiết bị** (`logic/compare/math/conversion/timer/counter/trigger/
control`, đọc từ `pou_library_registry_v1.json`). Dựng một tab `HVAC` không ứng
với nhóm nào trong catalog là một nhãn rỗng.

## 6. Lỗi phát hiện ngoài phạm vi và đã sửa cùng phiên

1. **Từ khoá ST bị coi là ký hiệu.** Con trỏ ở đầu tệp (mặc định khi vừa mở POU)
   nằm trên chữ `PROGRAM`, và Inspector chuyển sang ngữ cảnh "Ký hiệu ST" với
   bốn dòng "không xác định được" — che mất thuộc tính của chính POU đang mở.
2. **Hàng "Dòng x, cột y" trùng thanh trạng thái.** Hai chỗ nói cùng một số là
   hai chỗ để lệch nhau; hàng trùng đã bỏ.

## 7. Bằng chứng kiểm chứng

| Cổng | Lệnh | Kết quả |
|---|---|---|
| Đơn vị FE | `npx vitest --run --environment jsdom src` | **173 file / 1982 test PASS** |
| Lint FE | `npm run lint` | PASS |
| Kiểu FE | `npx tsc --noEmit` | PASS |
| Dựng FE | `npm run build` | PASS; chunk `programming` **140,64 KiB** gzip / ngân sách R3 165 KiB |
| Go | `go vet ./...`, `go test ./... -count=1` | PASS |
| Hợp đồng | `python3 scripts/verify_programming_pgm02_contract.py` | PASS |
| E2E | `npx playwright test e2e/programming.spec.ts` (cả hai project) | **55 PASS / 13 skipped / 0 fail** |

## 8. Bốn hồi quy do chính lát này gây ra, phát hiện bằng E2E

E2E bắt được bốn thứ mà 1982 test đơn vị không bắt được. Ghi lại vì cả bốn đều
là cùng một loại sai: *"thêm một bề mặt thứ hai cho một thứ đã có"*.

| # | Triệu chứng E2E | Nguyên nhân | Cách sửa |
|---|---|---|---|
| 1 | `LIVE ... không lộ mutation` đỏ: có nút `Lưu` | `DEV-PROG-009` đăng ký hành động ở MỌI chế độ, chỉ vô hiệu hoá khi không sửa được | Không đăng ký gì khi `canEdit` sai. Vô hiệu hoá trả lời "chưa lưu được LÚC NÀY"; vắng mặt trả lời "chế độ này không sửa" |
| 2 | `strict mode violation` trên `Lưu`/`Kiểm tra` | Hai nút cùng hành động, cùng tên truy cập | Nút ở header mang tên đầy đủ (`Lưu bản nháp`, `Kiểm tra gói`) — vẫn CHỨA nhãn nhìn thấy, đúng WCAG 2.5.3 |
| 3 | axe `aria-valid-attr-value` | `aria-controls` của nút gập nhóm POU trỏ tới `id` chỉ tồn tại khi nhóm KHÔNG rỗng | Thân nhóm luôn có mặt và luôn mang `id` |
| 4 | Inspector nói `Ký hiệu ST` cho một POU FUNCTION | Hai bản danh sách "không phải ký hiệu" đã lệch; chỉ mục dùng bản HẸP (thiếu `FUNCTION`) | Gộp về MỘT bản ở `stReferenceIndex`; `stHover.isStKeyword` đọc lại chính nó |

## 9. Sửa vị trí sau phản hồi trực tiếp của người dùng

Người dùng chỉ ra ba card phụ *"nằm không đúng vị trí"*. Chúng đang xếp chồng
DƯỚI chỗ gõ trong cột giữa — người dùng phải cuộn qua chính thứ mình đang làm để
tới ba thứ dùng để đi và để tra.

| Card | Trước | Sau | Vì sao |
|---|---|---|---|
| `Ký hiệu & kiểu` | cột giữa, dưới editor | **bỏ hẳn** | Khay `Tham chiếu` của workbench đã liệt kê cùng tập ký hiệu kèm kiểu, số đọc/ghi và từng chỗ dùng |
| `Bản đồ mã` | cột giữa, dưới editor | **cột trái**, dưới cây POU | Điều hướng giữa các POU và trong một POU là cùng một loại việc |
| `Tham chiếu tại con trỏ` | cột giữa, dưới editor | **cột phải**, dưới Inspector | Nó mô tả ký hiệu ĐANG CHỌN — đúng thứ cột Thuộc tính sở hữu |

Sau khi cột giữa trống ra, chiều cao mặc định workbench hạ 200 → 150 px: hai
vùng chia cùng một ngân sách, và khay Vấn đề của một Draft sạch chỉ có hai dòng.
