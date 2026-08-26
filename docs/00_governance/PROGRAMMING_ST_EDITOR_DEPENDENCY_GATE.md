# Cổng phụ thuộc/license — editor ST của PGM-02 (`WP-04`)

| Thuộc tính | Giá trị |
|---|---|
| ID | `GATE-PROG-ST-EDITOR-DEP-001` |
| Phiên bản | 1.1 |
| Trạng thái | **OPEN — chờ quyết định Product Owner/CTO + System Architect** |
| Ngày | 2026-08-26 |
| Người lập | Dev Lead (thi hành `T59-805`) |
| Authority cần | `AUTH-*` mới hoặc quyết định ghi vào `PROGRAMMING_OPEN_DECISIONS.md` |
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

## 5. Khuyến nghị của người lập

**Lựa chọn A cho R1**, và mở lại cổng này ở R2 nếu người dùng thật sự cần
go-to-definition/hover. Ba lý do:

1. Dư địa 20 KiB không đủ cho bất kỳ ước lượng nào của CodeMirror, mà R1 còn năm
   work package nữa cùng chia chunk đó.
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

## 6. Trạng thái

`T59-805` đã đi hết phần **không** phụ thuộc cổng này:

| Lát | Trạng thái |
|---|---|
| Guard read-only runtime (mọi đường mutation) | đã giao |
| `AC-ST-002/003` chèn FB có trạng thái đặt khai báo đúng vùng, chọn/tạo instance, một bước hoàn tác | đã giao |
| `AC-ST-005` chỉ mục tham chiếu, F12/Ctrl+Click tới khai báo, "không xác định được" khi không tra được | đã giao |
| `AC-ST-004/010` khoá bằng 8 nguồn ngoài subset và kiểm phạm vi thao tác Lưu | đã giao |

Mọi AC áp dụng cho R1 (`AC-ST-001..005`, `010`, `011`) đều có test. Số đo cập
nhật 2026-08-26 sau bốn lát: chunk Programming **107,90 KiB gzip**, dư địa tới
ngân sách R1 còn **≈17 KiB** — nhỏ hơn lúc lập cổng, nên §2 và §5 càng đúng chứ
không nhẹ đi.

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
| 1.1 | 2026-08-26 | Cập nhật §6 sau bốn lát của `T59-805`: mọi AC áp dụng cho R1 đã có test; đo lại chunk Programming 107,90 KiB gzip (dư địa còn ≈17 KiB); nêu đúng hai mục còn lại và vì sao cả hai đều cần quyết định hoặc cắt qua bốn boundary. |
| 1.0 | 2026-08-26 | Lập cổng: đo dư địa ngân sách còn 20 KiB gzip, nêu ba lựa chọn kèm cái giá, liệt kê năm phép đo bắt buộc trước khi quyết, khuyến nghị A cho R1. |
