# Cổng phụ thuộc/license — editor ST của PGM-02 (`WP-04`)

| Thuộc tính | Giá trị |
|---|---|
| ID | `GATE-PROG-ST-EDITOR-DEP-001` |
| Phiên bản | 1.4 |
| Trạng thái | **CLOSED 2026-08-26 — Product Owner/CTO + System Architect chọn LỰA CHỌN A**; ghi tại `UD-PROG-013` |
| Ngày | 2026-08-26 |
| Người lập | Dev Lead (thi hành `T59-805`) |
| Authority | Quyết định đã ghi: [`UD-PROG-013`](PROGRAMMING_OPEN_DECISIONS.md) §1.2 |
| Liên quan | Proposal PGM-02 `WP-04` ("`apps/web-ui/package.json`/lockfile **sau dependency/license gate**"); `contracts/programming/pgm02_workspace_v1.json` §nfr.frontend |

## 0. Vì sao có hồ sơ này

`WP-04` đặt mục tiêu thay textarea ST hiện tại bằng **CodeMirror 6**, và chính
plan đã ràng buộc: dependency chỉ được thêm **sau** một cổng phụ thuộc/license.
Hồ sơ này là cổng đó. Nó KHÔNG tự phê duyệt: thêm một thư viện soạn thảo vào
giao diện của thiết bị điều khiển là quyết định sản phẩm + kiến trúc, và nó chạm
một ngân sách đã được pin trong hợp đồng máy đọc được.

## 1. Số đo hiện tại — ngân sách còn lại bao nhiêu

`pgm02_workspace_v1.json` §`nfr.frontend` pin cứng:

| Mốc | Giá trị |
|---|---:|
| Baseline chunk Programming | **98 KiB gzip** |
| Ngân sách R1 | **125 KiB gzip** |
| Ngân sách R2 | 145 KiB gzip |
| Ngân sách R3 | 165 KiB gzip |

Đo thật sau khi đóng `WP-03` (2026-08-26, `npm run build`):

| Mốc | Giá trị |
|---|---:|
| Chunk Programming hiện tại | **104,77 KiB gzip** |
| **Dư địa còn lại tới ngân sách R1** | **≈ 20 KiB gzip** |

R1 còn `WP-04`, `WP-05`, `WP-06`, `WP-08`, `WP-10`, `WP-11` chưa giao; tất cả
đều thêm mã vào cùng chunk này.

### 1.1 Cách đo — và một bẫy đơn vị đã đính chính (2026-08-26)

Mọi con số chunk ghi trong hồ sơ này và trong Plan 59 **trước 2026-08-26** được
chép từ log build của vite. Log đó in **kB (1000 byte)**, còn hợp đồng
`pgm02_workspace_v1.json` pin **KiB (1024 byte)**. Đọc con số này thành con số
kia **thổi phồng mức dùng ~2,4%** — may là lệch về phía an toàn, nhưng vẫn là
một con số nói sai.

Từ `T59-808`, phép đo có thẩm quyền là `scripts/verify_programming_bundle_budget.py`:
đọc chính file trong `build/web-ui/dist/assets`, gzip ở **mức mặc định của zlib
(6)** — mức một máy chủ tĩnh thật dùng, không phải mức 9 là trường hợp tốt nhất
— và in cả hai đơn vị để không ai đọc nhầm lần nữa. Script chạy **ngay trong
`npm run build`**, nên nó luôn đo đúng bản vừa tạo.

| Mốc (đo lại đúng phương pháp, 2026-08-26) | Giá trị |
|---|---:|
| Chunk Programming sau khi đóng `T59-807` | **111,31 KiB gzip** |
| Dư địa tới ngân sách R1 | **≈13,7 KiB** |

## 2. Điều làm cổng này khó

Một bộ CodeMirror 6 tối thiểu cho ST cần ít nhất `@codemirror/state`,
`@codemirror/view`, `@codemirror/language`, `@codemirror/commands`,
`@codemirror/search`, `@codemirror/autocomplete`, `@lezer/*` và một language mode
tự viết cho ST. **Ước lượng** (chưa đo trong repo này) là **90–150 KiB gzip**.

Đặt cạnh dư địa **20 KiB**: nếu ước lượng đúng ở bất kỳ đâu trong dải đó thì
CodeMirror 6 **vượt ngân sách R1 gấp 4–7 lần**, và một mình nó cũng vượt luôn
ngân sách R3 (165 KiB) khi cộng với 104,77 KiB đang có.

Đây là con số quyết định, và nó chưa từng được đối chiếu khi `WP-04` được viết.

## 3. Ba lựa chọn, kèm cái giá thật

| # | Lựa chọn | Được | Mất |
|---|---|---|---|
| A | **Giữ editor hiện tại**, đóng nốt các AC còn thiếu của `WP-04` bằng chính nó | Không đổi ngân sách, không thêm bề mặt supply chain, giữ toàn bộ hành vi đã đo (font metric inline, IME, history, neo chẩn đoán) | Không có go-to-definition/hover/multi-cursor mức CodeMirror; mọi tính năng editor sau này phải tự viết |
| B | **CodeMirror 6 nạp trễ thành chunk riêng** | Có editor đầy đủ; chunk Programming giữ nguyên ngân sách | `openPouP95Ms = 250 ms` phải đo lại TRÊN BO (asset phục vụ cục bộ nên khả thi, nhưng chưa đo); thêm một trạng thái "đang tải editor"; vẫn thêm supply chain |
| C | **Nâng ngân sách chunk** rồi nhúng thẳng | Đơn giản nhất về kỹ thuật | Đổi một số đã pin trong hợp đồng; cần đo lại `openPouP95Ms`/`steadyJsHeapMiB` trên bo; và ngân sách là thứ bảo vệ thiết bị nhúng khỏi phình dần |

## 4. Điều PHẢI đo trước khi quyết định

Không quyết bằng ước lượng. Một spike có thời hạn phải trả về:

1. Delta gzip thật của bộ CodeMirror tối thiểu + language mode ST, đo bằng chính
   `npm run build` của repo.
2. `openPouP95Ms` và `typingResponseP95Ms` **trên bo Forlinx**, cả hai phương án
   nhúng thẳng và nạp trễ.
3. `steadyJsHeapMiB` sau 30 phút mở editor (ngân sách 96 MiB).
4. License của từng package (kỳ vọng MIT) + số dependency bắc cầu, đối chiếu
   `infra/ci/security.yml` (trivy/grype/gitleaks/SBOM).
5. Khả năng build **offline/air-gapped**: bo được cài từ artifact, không kéo
   package lúc cài.

### 4.1 Kết quả spike — mục 1 và mục 4 đã ĐO THẬT (2026-08-26)

Spike chạy **ngoài repo** (dự án tạm trong scratchpad) đúng để không đụng
`package.json`/lockfile trước khi cổng được duyệt. Bộ package đúng danh sách §2,
cộng một language mode ST tối giản, bundle bằng `esbuild --bundle --minify
--format=esm`:

| Phép đo | Kết quả |
|---|---:|
| Bundle CodeMirror tối thiểu + mode ST, **thô** | 341,34 KiB |
| Bundle đó, **gzip** | **110,07 KiB** |
| Chunk Programming hiện tại (2026-08-26) | 110,78 KiB gzip |
| **Tổng nếu nhúng thẳng** | **≈ 220,85 KiB gzip** |
| Ngân sách R1 / R2 / R3 | 125 / 145 / **165** KiB gzip |

Nghĩa là nhúng thẳng **vượt ngân sách R1 khoảng 77%**, và vượt luôn ngân sách
R3 — đúng như §2 dự đoán, nay bằng số đo chứ không phải ước lượng. Con số 110,07
KiB rơi vào giữa dải ước lượng 90–150 KiB.

**Mục 4 — license và dependency bắc cầu:** 12 package trong đồ thị
(`@codemirror/*` ×6, `@lezer/*` ×3, `crelt`, `style-mod`, `w3c-keyname`),
**toàn bộ MIT**, **0 package non-MIT**. Đây là mục **không** chặn: license sạch
và đồ thị nhỏ.

**Còn phải đo (cần phần cứng):** mục 2 và 3 phải chạy **trên bo Forlinx**; mục 5
(build offline/air-gapped) phải kiểm trên quy trình đóng gói thật. Ba mục này
không đo được từ máy phát triển.

## 5. Khuyến nghị của người lập

**Lựa chọn A cho R1**, và mở lại cổng này ở R2 nếu người dùng thật sự cần
go-to-definition/hover. Ba lý do:

1. Dư địa còn **≈14 KiB** (cập nhật 2026-08-26) so với **110,07 KiB đo thật**
   của bộ CodeMirror tối thiểu — thiếu gần **8 lần**. Và R1 vẫn còn work package
   khác cùng chia chunk đó. Lựa chọn C (nâng ngân sách) sẽ phải nâng quá cả
   ngân sách R3, tức bỏ hẳn cơ chế ngân sách chứ không phải nới nó.
2. Editor hiện tại đã trả giá cho những thứ khó nhất và đã có test khoá: metric
   font inline (nguyên nhân gốc của lỗi lệch dòng 2026-08-17), history bounded 50
   snapshot, neo chẩn đoán theo `line/column/length`, và guard read-only runtime
   vừa bổ sung ở `T59-805`.
3. Các AC của `WP-04` **không** đòi CodeMirror. Chúng đòi hành vi: save/conflict/
   find/format/indent/completion/history giữ nguyên, undo một bước, chẩn đoán
   nhảy đúng, LIVE/mobile không sửa được, và nguồn lớn vẫn mượt trong ngân sách.
   Phần lớn đã có; phần còn thiếu (hover/go-to-def dựa trên reference index của
   BE) làm được mà không cần đổi surface.

Khuyến nghị này KHÔNG phải quyết định. Owner/Architect chọn A, B hay C.

**2026-08-26 — Owner/Architect chọn LỰA CHỌN A.** Ghi tại `UD-PROG-013`. Cổng
CLOSED. Mở lại từ R2 trở đi nếu người dùng thật sự cần hover chuột /
go-to-definition mức CodeMirror, và khi mở lại phải chạy nốt ba phép đo trên bo
(§4 mục 2, 3, 5).

## 6. Trạng thái

`T59-805` đã đi hết phần **không** phụ thuộc cổng này:

| Lát | Trạng thái |
|---|---|
| Guard read-only runtime (mọi đường mutation) | đã giao |
| `AC-ST-002/003` chèn FB có trạng thái đặt khai báo đúng vùng, chọn/tạo instance, một bước hoàn tác | đã giao |
| `AC-ST-005` chỉ mục tham chiếu, F12/Ctrl+Click tới khai báo, "không xác định được" khi không tra được | đã giao |
| `AC-ST-004/010` khoá bằng 8 nguồn ngoài subset và kiểm phạm vi thao tác Lưu | đã giao |

Mọi AC áp dụng cho R1 (`AC-ST-001..005`, `010`, `011`) đều có test. Số đo cập
nhật 2026-08-26 sau khi `T59-807` đóng và đo lại đúng phương pháp (§1.1): chunk
Programming **111,31 KiB gzip**, dư địa tới ngân sách R1 còn **≈13,7 KiB** — nhỏ hơn lúc lập cổng, nên §2 và §5
càng đúng chứ không nhẹ đi. Spike §4.1 đã thay ước lượng bằng số đo: bộ
CodeMirror tối thiểu **110,07 KiB gzip**.

**Cổng đã đóng 2026-08-26** với lựa chọn A (`UD-PROG-013`). Hệ quả: bề mặt
editor ST giữ nguyên cho R1, `T59-805` đủ điều kiện đóng `DONE (HOST/LOCAL)`, và
`T59-807` mở. Hover chuột mức CodeMirror nằm ngoài phạm vi R1 theo đúng quyết
định này — khay "Tham chiếu tại con trỏ" là thứ phục vụ nhu cầu đó trên bề mặt
hiện tại.

Hai mục còn lại và cả hai đều **không phải việc tự quyết được**:

1. **Đổi surface editor** — chờ Owner/Architect chọn A, B hay C ở hồ sơ này.
   Hover thật bằng chuột nằm trong mục này (cần hit-test theo ký tự). Khay
   "Tham chiếu tại con trỏ" là thứ làm được ngay trên bề mặt hiện tại và đã
   giao.
2. **Chỉ mục ký hiệu do compiler sinh** — bullet BE của `WP-04`. Cần compiler
   worker xuất symbol table, `runner.Compile` đọc, OpenAPI công bố, FE tiêu
   thụ: một lát cắt qua bốn boundary. Chỉ mục FE hiện tại tự khai giới hạn ngay
   trong docstring và sẽ lùi về vai trò dự phòng khi chỉ mục compiler có mặt.

## 7. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.4 | 2026-08-26 | Thêm §1.1: đính chính bẫy đơn vị (log vite in kB(1000), hợp đồng pin KiB(1024) — đọc nhầm thổi phồng ~2,4%) và chốt phép đo có thẩm quyền là `verify_programming_bundle_budget.py` chạy trong chính `npm run build`. Kết luận §2/§5 không đổi. |
| 1.3 | 2026-08-26 | **Đóng cổng**: Owner/Architect chọn lựa chọn A (`UD-PROG-013`) — giữ bề mặt editor hiện tại cho R1, không thêm CodeMirror 6. |
| 1.2 | 2026-08-26 | Chạy spike §4 mục 1 và 4 NGOÀI repo: bộ CodeMirror tối thiểu + mode ST đo thật **110,07 KiB gzip** (341,34 KiB thô), tức nhúng thẳng vượt ngân sách R1 ~77% và vượt luôn R3; license 12/12 MIT, 0 non-MIT. Ghi rõ `T59-805` `PARTIAL` chỉ vì cổng này và nó đang giữ chuỗi R1. |
| 1.1 | 2026-08-26 | Cập nhật §6 sau bốn lát của `T59-805`: mọi AC áp dụng cho R1 đã có test; đo lại chunk Programming 107,90 KiB gzip (dư địa còn ≈17 KiB); nêu đúng hai mục còn lại và vì sao cả hai đều cần quyết định hoặc cắt qua bốn boundary. |
| 1.0 | 2026-08-26 | Lập cổng: đo dư địa ngân sách còn 20 KiB gzip, nêu ba lựa chọn kèm cái giá, liệt kê năm phép đo bắt buộc trước khi quyết, khuyến nghị A cho R1. |
