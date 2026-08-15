# ST Editor — Technical Selection Record

**Document ID:** TSR-ST-EDITOR-PROG-001
**Phiên bản:** 1.1
**Trạng thái:** **APPROVED TO IMPLEMENT** — CTO/Product Owner phê duyệt
Phương án A + phạm vi P0/P1 trong "CTO / PRODUCT OWNER APPROVAL — PROGRAMMING
OVERVIEW / ST / FBD — IMPLEMENTATION CONTINUATION" §4-6 (2026-08-15). WP-10
chuyển `READY_TO_IMPLEMENT → IMPLEMENTING`.
**Tác giả:** System Engineering, theo Lệnh CTO/Owner 2026-08-15 §V (WP-10)
**Phạm vi:** Chỉ đánh giá lựa chọn kỹ thuật cho editor ST (`SourceEditor` trong
`apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx`). Không
đổi FBD editor (đã có thiết kế riêng, `FBD_EDITOR_DESIGN.md`).

## A. Quyết định CTO/Product Owner (2026-08-15) — chốt dứt điểm

**Phương án được duyệt: A — mở rộng `SourceEditor` tại chỗ, không thêm
Monaco/CodeMirror.** Lý do Product: editor hiện tại đã có line/cursor/find/
save/format/source-map; chưa cần biến Web DDC thành desktop PLC IDE nặng;
giảm migration risk; giữ bundle nhỏ; phù hợp Rev A. Nhưng Phương án A **không
phải chỉ thêm màu chữ** — phạm vi P0/P1 dưới đây là bắt buộc.

### Phạm vi P0 — bắt buộc implement

- syntax highlighting
- bracket/parenthesis matching
- auto indentation
- find + replace (nâng từ "find" hiện có)
- diagnostic underline
- click diagnostic → nhảy đúng line/column (đã có `selectRange`, mở rộng UI)
- ST keyword completion
- symbol completion từ Program hiện tại (đã có `collectStSymbols`, dùng làm nguồn)
- datatype completion (6 kiểu, dùng chung nguồn `FBD_DATA_TYPES`)
- standard function/FB completion (dùng chung registry `palette.ts`, không khai tay lần hai)
- formatter (đã có `formatStSource`, giữ nguyên)
- keyboard-first operation (bắt buộc cho mọi tính năng mới, không chỉ chuột)

### Phạm vi P1 — implement nếu có authoritative metadata đủ

type-aware completion; function signature help; hover type/symbol; reference
search; go-to-definition.

**Rule bắt buộc:** *"Không được viết một ST parser/compiler thứ hai trong
FE."* Nếu một tính năng P1 cần semantic knowledge (kiểu suy ra, phạm vi biến
chính xác...) mà FE chưa có contract dữ liệu đáng tin từ compiler, KHÔNG viết
regex đoán rồi gọi là "semantic feature" — phải đi qua chuỗi
`Compiler metadata/API contract → Design → Test → FE feature`. P0 dùng đúng
registry tĩnh đã có (`palette.ts`, 6 kiểu, `kFuncs`/`st_fb_*` đối chiếu
compiler C++ ở WP-05) nên không vi phạm rule này — không cần contract mới.

### Quyết định UX (2026-08-15)

Keyboard-first: YES. Desktop engineering là workflow chính; mobile không cần
full parity. Nguồn vẫn là text ST canonical (không có AST ẩn thay thế
`source` làm nguồn sự thật). Không auto-fix thay đổi logic mà không xác
nhận người dùng. Không autocomplete construct compiler chưa hỗ trợ (không
gợi ý `CASE`/`FOR`/`FUNCTION_BLOCK` tự định nghĩa...). Cú pháp không hỗ trợ
phải thể hiện rõ theo đúng compiler profile đang active (không gợi ý mơ hồ).
`PID` tiếp tục có cảnh báo "chưa Controls+Safety review" — không tự nâng
badge khi thêm completion cho nó.

---

## 0. Vì sao KHÔNG implement luôn trong tài liệu này

Master Plan tự đặt exit criteria khác WP-05/06/07/08/11: những WP đó "tự tạo
tài liệu thiếu rồi implement luôn" là đúng chỉ đạo chung của CTO/Owner
(§II). Nhưng WP-10 minh thị một ngoại lệ: **chọn thư viện UI lõi cho một màn
hình người dùng dùng hàng ngày** là quyết định có chi phí chuyển đổi cao
(đổi lại tốn công tương đương làm lại từ đầu, ảnh hưởng bundle size trên
board Buildroot aarch64 — xem §3), và bản thân gap report gốc (D-03) đã ghi
rõ "phạm vi editor ST Rev A" là quyết định Product+UX, không phải kỹ thuật
thuần. Tài liệu này dừng ở mức **khuyến nghị có dữ liệu**, không tự chọn.

---

## 1. Hiện trạng (`SourceEditor`, đã có)

Đọc trực tiếp `ProgramsTab.tsx` (dòng ~288-473):

| Tính năng | Có sẵn? | Cách làm |
|---|---|---|
| Line gutter | Có | `<pre>` tĩnh render số dòng, đồng bộ scroll thủ công |
| Tìm kiếm trong buffer | Có | Regex thủ công, không phải tìm-thay-thế đầy đủ |
| Ký hiệu & kiểu (symbol table) | Có | Regex `ST_VAR_DECLARATION`, đếm tham chiếu bằng regex |
| Định dạng (Format) | Có | `formatStSource()` — tách từ khoá khối bằng regex, thụt lề theo độ sâu |
| Nhảy tới lỗi (line/column từ Check) | Có | `selectRange()` qua offset tính từ line/column |
| Syntax highlighting | **Không** | Chỉ `<textarea>` monospace phẳng, không tô màu |
| Autocomplete | **Không** | |
| Signature help (gợi ý tham số hàm/FB) | **Không** | |
| Hover (xem kiểu/tài liệu khi rê chuột) | **Không** | |
| Go-to-definition | **Không** | |

Toàn bộ hiện tại là code tự viết, **0 dependency ngoài** cho phần editor —
đây là baseline so sánh.

## 2. Đặc điểm ngôn ngữ ST cần cân nhắc (khác giả định "ngôn ngữ lập trình đầy đủ")

Đọc `ST_SUBSET_SPEC_MK-DDC-24_VI.md` (Rev 1.1, đã đồng bộ compiler ở WP-04):

- 6 kiểu dữ liệu vô hướng, không kiểu phức hợp (không mảng, không struct).
- Không `FUNCTION`/`FUNCTION_BLOCK` do người dùng định nghĩa — chỉ 5 FB có
  sẵn (TON/TOF/R_TRIG/F_TRIG/PID) và ~20 hàm built-in (`kFuncs[]`).
  → **Autocomplete/signature help/go-to-definition có phạm vi rất nhỏ** —
  không cần LSP (Language Server Protocol) đầy đủ, một bảng tra tĩnh phía
  client là đủ dữ liệu nguồn.
- Không `CASE`/`FOR`/`WHILE`/`REPEAT` — cú pháp có ít production rule hơn
  nhiều so với ST đầy đủ IEC 61131-3.
- Không multi-file, không `#include`/`USING` — 1 Program = 1 buffer độc
  lập, không cần workspace-wide indexing.

Kết luận: đây là ngôn ngữ **nhỏ và đóng**, khác hẳn use case Monaco/CodeMirror
thường phục vụ (TypeScript, Python, SQL — không gian cú pháp lớn, đa file).
Lựa chọn kỹ thuật nên phản ánh đúng quy mô thật, không mặc định "editor code
thì cần engine editor code đầy đủ".

## 3. Ràng buộc vận hành phải tôn trọng

- **Bundle size:** `vite build` hiện đã cảnh báo `index-*.js` 853 KB
  (gzip ~217 KB) — vượt ngưỡng khuyến nghị 500 KB của chính tool build.
  Board Foxlinx phục vụ static qua `mkddc-web` nội bộ (không CDN), file
  càng lớn thì thời gian tải lần đầu trên trình duyệt panel/tablet công
  nghiệp càng chậm.
- **Không CDN, không cài thêm ở board:** đúng ràng buộc Buildroot đã ghi ở
  `FOXLINX_DEPLOY_CHECKLIST.md` §1 — mọi thư viện phải bundle tĩnh vào
  `dist/`, không tải runtime từ mạng ngoài.
- **Bàn phím là kênh chính** (`DDD-FE-PROG-001` §0.1, đã áp dụng nhất quán
  cho FBD): editor ST mới không được thoái lui accessibility so với
  `<textarea>` thuần hiện tại (vốn có hỗ trợ bàn phím/trình đọc màn hình
  miễn phí từ trình duyệt).

## 4. Ba phương án

### A — Mở rộng tại chỗ (0 dependency mới)

Giữ `<textarea>` + `<pre>` gutter, thêm:
- Tô cú pháp bằng lớp phủ `<pre>` thứ hai render token đã tô màu (kỹ thuật
  "textarea overlay", dùng chính tokenizer nhỏ dựa trên `ST_BLOCK_KEYWORDS`/
  `ST_VAR_DECLARATION` đã có — không cần parser đầy đủ để tô màu từ khoá,
  kiểu, chuỗi, số).
  hover: `title` attribute tĩnh trên token overlay (không cần popup engine).
- Autocomplete: dropdown tự viết, nguồn dữ liệu = bảng tĩnh liệt kê đúng
  20 hàm (`kFuncs[]`)/5 FB/6 kiểu — cùng nguồn với `palette.ts` (WP-05) nên
  không lệch registry lần nữa (bài học từ Document Gate #7).
- Signature help: cùng bảng tĩnh, hiện khi con trỏ trong `(...)` sau tên hàm.
- Go-to-definition: chỉ có ý nghĩa cho VAR — nhảy tới dòng khai báo, đã có
  hạ tầng `selectRange()`/`collectStSymbols()`.

| Tiêu chí | Đánh giá |
|---|---|
| Bundle size thêm | ~0 KB (không thêm dependency) |
| Rủi ro tương thích SSR/CSP/theme | Không — cùng stack hiện tại |
| Công sức implement | Trung bình — viết tay tokenizer/overlay/dropdown |
| Công sức bảo trì dài hạn | Cao hơn thư viện chuyên dụng nếu ngôn ngữ phình to sau này, nhưng ngôn ngữ ST Rev A cố tình nhỏ (xem §2) |
| Độ khớp UI/theme hiện có (`--c-*` token) | Hoàn hảo — tự viết theo đúng token |

### B — CodeMirror 6

Kiến trúc modular (`@codemirror/state`, `@codemirror/view`, `@codemirror/language`
+ gói ngôn ngữ tuỳ biến qua Lezer grammar tự viết cho ST — không có gói
ST/IEC 61131-3 sẵn trên npm, phải tự viết grammar).

| Tiêu chí | Đánh giá |
|---|---|
| Bundle size thêm | ~150-250 KB gzip tuỳ số module (state+view+language core), có thể tree-shake phần không dùng |
| Autocomplete/hover/signature help | Có API chuẩn (`autocompletion()`, `hoverTooltip()`), vẫn phải tự cấp dữ liệu (bảng hàm/FB như phương án A) |
| Syntax highlighting | Cần viết Lezer grammar riêng cho ST (không có sẵn) — công sức tương đương viết tokenizer ở phương án A, cộng thêm học Lezer |
| Go-to-definition | Tự viết logic, CodeMirror chỉ cấp hạ tầng vị trí con trỏ/selection |
| Theme integration | Tốt, CodeMirror hỗ trợ theme CSS custom, khớp được token `--c-*` |
| Accessibility | Tốt (CodeMirror 6 chú trọng a11y hơn v5/Monaco), nhưng vẫn cần kiểm chứng riêng cho luồng bàn phím đặc thù của dự án |

### C — Monaco Editor (VS Code engine)

| Tiêu chí | Đánh giá |
|---|---|
| Bundle size thêm | **~2-5 MB** (kể cả khi chỉ dùng core, do kiến trúc worker + nhiều ngôn ngữ mặc định phải cấu hình loại bỏ) — vượt xa ràng buộc §3 |
| Web Worker | Cần cấu hình `MonacoEnvironment`/worker riêng — phức tạp hơn với Vite + static hosting không CDN |
| Ngôn ngữ tuỳ biến (ST) | Hỗ trợ qua Monarch tokenizer (đơn giản hơn Lezer) + `registerCompletionItemProvider` — công sức tương tự phương án B |
| Phù hợp use case | Được thiết kế cho IDE đa ngôn ngữ, đa file, workspace lớn — **quá cỡ** so với 1 buffer/1 ngôn ngữ nhỏ đóng của dự án này |
| Accessibility | Từng có vấn đề tương thích screen reader trong `<textarea>` ẩn của Monaco — cần kiểm chứng kỹ trước khi dùng cho một UI đã cam kết "bàn phím là kênh chính" |

## 5. Khuyến nghị (chưa phải quyết định)

**Khuyến nghị: Phương án A (mở rộng tại chỗ)**, vì:

1. Ngôn ngữ ST Rev A nhỏ và đóng (§2) — giá trị marginal của một engine
   editor tổng quát (B/C) so với việc tự viết tokenizer/autocomplete cho
   đúng 20 hàm + 5 FB + 6 kiểu là thấp, trong khi chi phí (bundle size,
   công sức tích hợp, rủi ro a11y mới) là có thật và đo được (§3).
2. Bundle đã cảnh báo vượt 500 KB (§3) — thêm 150 KB (B) hay 2-5 MB (C) đi
   ngược xu hướng cần có, chưa kể board phục vụ static nội bộ không CDN.
3. Không có gói ST/IEC 61131-3 sẵn cho cả B lẫn C — phần việc "viết
   grammar/tokenizer cho ngôn ngữ" là **bắt buộc ở cả 3 phương án**, không
   phải lợi thế riêng của B/C.
4. Phương án A giữ đúng token theme (`--c-*`) và hành vi bàn phím đã kiểm
   chứng qua Playwright/board thật — không phải làm lại a11y audit cho một
   thư viện ngoài.

**Không khuyến nghị B/C** trừ khi Product xác nhận roadmap ST sẽ mở rộng
đáng kể (ví dụ: cho phép `FUNCTION_BLOCK` người dùng định nghĩa, đa file,
`CASE`/`FOR`/`WHILE`) — khi đó chi phí đầu tư engine tổng quát mới có ROI.

## 6. Câu hỏi cần Product + UX trả lời trước khi mở khoá implementation

1. Có chấp nhận khuyến nghị Phương án A, hay muốn đầu tư trước cho roadmap
   ST mở rộng (khi đó cân nhắc lại B)?
2. Phạm vi tối thiểu cần có ngay (D-03 gap report gốc chưa chốt): tô cú
   pháp + autocomplete là đủ cho Rev A, hay bắt buộc phải có hover/go-to-
   definition ngay từ P3?
3. Ngưỡng chấp nhận bundle size mới cho trang `/eng/programming` là bao
   nhiêu — có cần code-split riêng chunk cho `SourceEditor` (chỉ tải khi
   mở tab Chương trình ngôn ngữ ST) bất kể chọn phương án nào?

## 7. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-15 | Tạo mới cho WP-10 (Master Plan 56). So sánh 3 phương án, khuyến nghị Phương án A (mở rộng tại chỗ, 0 dependency mới). Chưa implement — chờ Product+UX phê duyệt đúng exit criteria WP-10. |
| 1.1 | 2026-08-15 | CTO/Product Owner duyệt Phương án A + phạm vi P0/P1 (§A mới). `APPROVED TO IMPLEMENT`, WP-10 chuyển `IMPLEMENTING`. |
