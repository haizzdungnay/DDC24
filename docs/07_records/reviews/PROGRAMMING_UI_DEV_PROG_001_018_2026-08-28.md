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

## 4. Hợp đồng `PGM02-WORKSPACE-V1` lên 1.2 — ĐÃ ĐƯỢC CHỦ SỞ HỮU DUYỆT

`DEV-PROG-004` đòi ba trường (`Access`, `Description`, tên Task) mà `UD-PROG-015`
đã chốt là **không có nguồn** trong Draft v2. Cấp nguồn cho chúng cần một
operation mới (`annotateObject`), tức **sửa hợp đồng**: `edit.draft.operations`
đi từ 15 lên 16 mục và `version.minor` 1 → 2.

**Chủ sở hữu duyệt 2026-08-28.** Chữ ký được ghi vào chính hợp đồng dưới khối
`amendments`, không phải chỉ trong một tài liệu bên cạnh:

| Trường | Giá trị |
|---|---|
| `version` | `1.2` |
| `authorization` | `AUTH-PROG-2026-08-28-DEVPROG-004` |
| `ownerDisposition` | `APPROVED_MINOR_AMENDMENT` |
| `compatibility` | `BACKWARD_COMPATIBLE_ADDITIVE` (chỉ THÊM operation, không đổi operation nào đang có) |

Pin gốc (`authorization: AUTH-PROG-2026-08-24-05`, `approvedCandidateCommit`)
giữ NGUYÊN: bản 1.2 là một phụ lục của hồ sơ đó, không phải một hồ sơ mới.

Kèm một **cổng mới** trong `scripts/verify_programming_pgm02_contract.py`: nâng
`version.minor` mà không có mục `amendments` ký cho đúng bản đó ⇒ verifier ĐỎ.
Không có ràng buộc này thì lần sau một con số bị sửa lặng lẽ vẫn qua cổng, và hồ
sơ mất dấu vết ai đã duyệt. Đã kiểm bằng cách đổi bản ký thành `1.9`: verifier
trả exit 1, khôi phục thì PASS.

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

## 10. Deploy lên bo Foxlinx và đo lại trên thiết bị thật

| Bước | Kết quả |
|---|---|
| Build phát hành | `VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release`. Cờ **được kiểm bằng hash chunk**, không tin lệnh đã gõ: có cờ ⇒ `programming-CC3_YJe_.js`, không cờ ⇒ `programming-CPBNd7gv.js` |
| Sao lưu | `dist.bak-devprog-20260828T055630Z`, `mkddc-web.bak-devprog-20260828T055630Z` |
| Đẩy FE | `tar` + `scp` (bo Buildroot **không có `rsync`**), đổi thư mục nguyên tử |
| Cross-build BE | `CGO_ENABLED=0 GOOS=linux GOARCH=arm64` ⇒ ELF aarch64 **statically linked** (không dính glibc/GLIBCXX của bo) |
| Đẩy BE + restart | `install -o mkddc -g mkddc -m 0755` + `systemctl restart mkddc-web-pi` ⇒ `active` |
| Sức khoẻ | `GET /api/v1/health` = `status:ok`; core/io_shm/iobus/mcu_connection/plc_shm/web đều `ok` |
| Bundle đang phục vụ | `index-D3Fba_4s.js` — khớp bản vừa build |

Đo lại bằng Chrome thật trên bo, ba viewport, POU `AHU_MasterSequence`:

| Viewport | Tài liệu / khung nhìn | Tràn ngang | 5 tab workbench | Bề rộng vùng gõ |
|---|---|---|---|---|
| 1280×800 | 828 / 800 px | 0 | `y=596`, hit-test **trúng chính nó** cả 5 | 324 px |
| 1440×800 | 828 / 800 px | 0 | `y=596`, **ok** cả 5 | 484 px |
| 1920×800 | 828 / 800 px | 0 | `y=596`, **ok** cả 5 | 964 px |

Không có lỗi runtime nào (`pageerror` rỗng ở cả ba). Card `Ký hiệu & kiểu` đã
biến mất khỏi cột giữa; `Bản đồ mã` ở `x=266` (cột trái).

Còn 28 px cuộn trang ở viewport cao 800 (lề đáy của trang) — dải tab vẫn nằm
trọn trong màn hình đầu nên AC đạt; ghi lại để không ai tưởng đó là hồi quy.

### Đường lùi

```sh
ssh -p 2223 root@mekong-fac.ddns.net
rm -rf /opt/mkddc-web/dist && mv /opt/mkddc-web/dist.bak-devprog-20260828T055630Z /opt/mkddc-web/dist
install -o mkddc -g mkddc -m 0755 /opt/mkddc-web/mkddc-web.bak-devprog-20260828T055630Z /opt/mkddc-web/mkddc-web
systemctl restart mkddc-web-pi
```

## 11. `DEV-PROG-019` — nút Định dạng viết lại theo AST

Yêu cầu bổ sung của chủ sở hữu (2026-08-28): nút **Định dạng** phải hoạt động
như một formatter chuyên nghiệp — *chỉ đổi cách trình bày, tuyệt đối không đổi
logic*.

### Bản cũ phá dữ liệu người dùng — đo được

`formatStSource` làm bằng regex: `.replace(/;/g, ';\n')` cộng một regex tách từ
khoá. Cả hai **không biết mình đang ở trong chú thích**:

```text
vào : (* chú thích có dấu ; và chữ IF bên trong *)
ra  : (* chú thích có dấu ;\n và chữ \nIF\n bên trong *)
```

Một chú thích tiếng Việt có chữ "IF" hoặc một dấu `;` là đủ để nó xé chú thích
thành ba dòng rác. Với ST thật — `IF` lồng, `CASE`, chuỗi, chú thích khối — nó
phá được cả mã, và người dùng chỉ phát hiện ở lần Kiểm tra sau đó.

### Bản mới: `src/features/programming/design/editor/stFormat/`

```text
Nguồn ST → lexer.ts → parser.ts → AST (ast.ts) → printer.ts → Nguồn đã format
                                                       ↓
                                                 parse lần hai
                                                       ↓
                                        AST trước == AST sau ? + dãy chú thích trùng ?
                                          ├─ ĐÚNG → thay buffer
                                          └─ SAI  → KHÔNG format, báo lý do
```

Ngoài phép so cây, còn một phép so thứ hai: **dãy chú thích theo đúng thứ tự**.
Cây có thể trùng khớp trong khi một dòng chú thích bị đánh rơi — và chú thích là
thứ duy nhất trong tệp mà không phép kiểm ngữ nghĩa nào bảo vệ.

Fail-closed ở mọi tầng: chú thích chưa đóng, cú pháp ngoài subset, thiếu
`END_PROGRAM`, hoặc bản in ra không đọc lại được ⇒ **không đổi một byte nào** và
nói ra lý do kèm số dòng.

### Style đã chốt

| Hạng mục | Giá trị |
|---|---|
| Thụt lề | 4 dấu cách, không Tab |
| Dòng tối đa | 120 |
| Từ khoá | UPPERCASE |
| Định danh | GIỮ NGUYÊN hoa/thường |
| `END_IF;` / `END_CASE;` | luôn cùng một dòng |
| Tham số FB dài | mỗi tham số một dòng, `:=` căn cột |
| Luận lý dài | mỗi điều kiện một dòng |
| Gán dài | xuống dòng sau `:=` |
| Dòng trống | chuẩn hoá còn tối đa 1 |
| Ngữ nghĩa | KHÔNG BAO GIỜ đổi |

Bốn điều formatter **không được làm** đều có test riêng: không thêm/bớt ngoặc,
không đảo câu lệnh, không đảo khai báo, không đổi literal/tên/chú thích. `IF A OR
B AND C THEN` giữ nguyên — cảnh báo nhập nhằng là việc của Kiểm tra.

Hai chỗ cố ý làm khác đề bài, cả hai đều theo đúng cảnh báo của chính đề bài:

1. **Không tự thêm chú thích `(* OFF *)`/`(* STARTING *)`** cho nhánh CASE —
   formatter không sáng tác nội dung.
2. **Không dời chú thích từ dòng dưới lên cùng dòng khai báo** — việc đó thuộc
   "Organize Declarations" sau này, không phải pure formatting.

Nút có hai mức (`Định dạng tài liệu` — `Ctrl+Shift+F` — và `Định dạng vùng
chọn`), và **không tự Lưu / không tự Kiểm tra / không tự Commission**.

Kiểm chứng: 26 ca cho chính formatter + 6 ca cho nút trong trình soạn thảo;
chạy được trên **nguồn AHU thật lấy từ bo** (127 dòng, có `CASE`, `LIMIT`, chú
thích khối) và **idempotent** — format hai lần cho cùng một kết quả.

### Đo trên bo thật sau khi deploy formatter

Bundle `index-DAfKdxEx.js` (build có `VITE_PROGRAMS_WORKSPACE_V2=1`), sao lưu
`dist.bak-fmt-<TS>`. Bấm **Định dạng** trên chính nguồn `AHU_MasterSequence`
đang nằm trong Draft của bo:

| Phép đo | Kết quả |
|---|---|
| Buffer có đổi | có (128 → 127 dòng) |
| Mọi ký tự không-trắng giữ nguyên | **đúng** (`strip(before) === strip(after)`) |
| Còn ký tự Tab | không |
| Còn `END_IF` tách khỏi `;` | không |
| Lỗi runtime trình duyệt | không có |
| Menu hai mức | `Định dạng tài liệu  Ctrl+Shift+F` / `Định dạng vùng chọn` |
| Tự Lưu? | **KHÔNG** — dải ngữ cảnh chuyển sang `r5 · Chưa lưu`, `Kiểm tra` bị khoá kèm lý do |

Điểm cuối là phép kiểm quan trọng nhất của lát này: Định dạng chỉ đổi buffer,
và người dùng vẫn chủ động `Kiểm tra → Lưu → Đưa vào vận hành`.

## 12. Hợp nhất PR #311 và deploy bản gộp lên bo

### Xung đột và bốn lỗi lộ ra

Xung đột DUY NHẤT là `ProgrammingHeader.tsx`; giải bằng ROUTE (chỉ Tổng quan mang
eyebrow + tiêu đề lớn + phụ đề — nó không có trình soạn thảo tranh chỗ). Bốn lỗi
lộ ra sau hợp nhất, đã sửa hết:

| # | Triệu chứng | Nguyên nhân gốc |
|---|---|---|
| 1 | 2 ca `StIntegration` ĐỎ: `stop` một Program hoặc instance `FAULTED` mà read-back vẫn `RUNNING` | `task.state` suy từ hai dữ kiện mức TASK, bỏ qua trạng thái từng Program |
| 2 | axe `target-size`/`target-offset` trên cây POU | PR #311 chuyển reset form vào `@layer base` ⇒ `text-xs` mới thật sự áp lên nút ⇒ tụt dưới 24 px |
| 3 | 20 ca vitest ĐỎ `found multiple elements` | Tab Ánh xạ luôn mounted có `<select>` liệt kê Program ⇒ tên POU xuất hiện hai lần |
| 4 | 1 ca e2e ĐỎ | Câu trạng thái rỗng của Ánh xạ đổi thành "…trong Draft." |

Lỗi #1 là lỗi **sản phẩm**, không phải lỗi test.

### Deploy

| Thành phần | Bản | Sao lưu |
|---|---|---|
| FE `dist` | `index-B0gZUi2P.js` | `dist.bak-merge-20260828T082640Z` |
| BE `mkddc-web` | Go aarch64 tĩnh, health `0.1.0-be-b6c` | `mkddc-web.bak-merge-20260828T082640Z` |
| Core `mkddc-core` | cross-build aarch64, `-static-libstdc++` | `mkddc-core.bak-merge-20260828T082640Z` |

Cross-build Core: glibc bo là **2.41**, binary cần ≤ **2.38** ⇒ đạt;
`-static-libstdc++` nên không phụ thuộc `GLIBCXX` của bo (bẫy đã cắn ở các lát
trước). Chạy thử `--help` TRÊN BO trước khi cài: exit 0, `ldd` không thiếu thư
viện nào.

### Một phát hiện phải ghi lại: `producerState=DEGRADED` KHÔNG do lát này

Sau khi cài Core mới, `/programming/runtime` trả `producerState: DEGRADED`,
`task: null`. Để không đổ lỗi nhầm, đã **rollback về đúng binary cũ và đo lại**:
vẫn `DEGRADED`, vẫn `task: null`, và vẫn có dòng
`CRITICAL core.st_public_key=TEST … build này KHÔNG dùng được cho phát hành`.

Kết luận: cả hai đều **có sẵn trên bo từ trước**, không phải hồi quy của lát này.
Binary có bản vá được cài lại sau phép đo đó.

Hai việc còn mở, thuộc phạm vi khác:
1. `ReadProgrammingMonitorSnapshot` lỗi ⇒ `producerState=DEGRADED` và
   `taskState` rơi về suy-từ-mode thay vì đọc-lại-thật.
2. Bo đang chạy Core ký bằng **khoá TEST**; đúng theo `T59-602` thì bản này
   không dùng được cho phát hành.

### Đo lại trên bo sau deploy

| Phép đo (1280 / 1440 × 800) | Kết quả |
|---|---|
| Tài liệu / khung nhìn | 812 / 800 px, tràn ngang 0 |
| 5 tab workbench | hit-test **trúng chính nó** cả 5 |
| Nút Định dạng tài liệu | có |
| Vùng chạm nhỏ nhất trong cây POU | **28 px** (≥ 24 px của WCAG 2.2) |
| Bề rộng vùng gõ | 340 / 500 px |
| Lỗi runtime trình duyệt | không có |
