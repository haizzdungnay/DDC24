# PGM-04 — Visual Spec v1 (Target render được)

| Thuộc tính | Giá trị |
|---|---|
| ID | `SPEC-PGM04-VISUAL-001` |
| Task | `T61-002` (Plan 61, WP-00) |
| Ngày | 2026-08-29 |
| Authority | `AUTH-PROG-2026-08-29-PGM04-001` §`D61-06` |
| Bản render | [`assets/pgm04-visual-spec.html`](assets/pgm04-visual-spec.html) |
| Thay thế | `assets/PGM-04_library.png` **thôi làm authority**, hạ xuống đầu vào tham khảo |

## 0. Vì sao spec này tồn tại dưới dạng render được

Ảnh PNG không nói được bảy trạng thái mà chính task này phải khoá: loading,
empty, error, offline, permission, PID `REVIEW_REQUIRED`, và target chooser khi
Insert không có ngữ cảnh. Duyệt một tấm ảnh làm Target nghĩa là để người viết FE
tự nghĩ ra bảy trạng thái ấy rồi tới lúc review mới biết mình nghĩ sai.

Bản HTML kèm theo **diff được và gate được**: nó dùng đúng tên token của sản
phẩm, nên khi bảng màu đổi thì spec đổi theo, và khi spec đổi thì `git diff` chỉ
ra đúng dòng nào.

## 1. Bố cục và breakpoint

| Khổ | Bố cục | Ghi chú |
|---|---|---|
| `>= 1280 px` | Lưới card 3 cột + Inspector 22 rem cố định bên phải | Bố cục đầy đủ |
| `1024–1279 px` | Lưới 2 cột + Inspector 20 rem | Inspector vẫn cố định, không chồng |
| `768–1023 px` | Lưới 2 cột, Inspector thành **drawer** phủ từ phải | Nền mờ, `Esc` đóng, trả tiêu điểm về card |
| `< 768 px` | Danh sách một cột, Inspector toàn màn | Bộ lọc thu vào một nút "Bộ lọc" |

Ngưỡng `768` khớp `mobileReadOnly` của workspace: dưới ngưỡng này PGM-02 đã là
chỉ-đọc, nên PGM-04 cũng **không** hiện đường ghi nào. Một màn hình cho sửa
trong khi màn hình kế bên cấm sửa là hai luật cho một thiết bị.

## 2. Thẻ khối (card)

Bắt buộc, theo thứ tự đọc:

1. **Tên** — `--c-text`, đậm.
2. **Kind** — `FUNCTION` / `FUNCTION_BLOCK` / `CONVERSION`, badge viền `--c-border`.
3. **Scope** — `Hệ thống` / `Dự án`. **Không dùng chữ "Core"** (`AUTH …-PGM04-001` §Q4).
4. **Category** — khi có nguồn; chưa có thì `—` kèm lý do, KHÔNG bỏ trống.
5. **Chữ ký** — một dòng `f(IN: REAL, MODE: BOOL) → REAL`. Vắng `signature` ⇒ `Chưa đọc được chữ ký`, không tự parse.
6. **Badge `REVIEW_REQUIRED`** khi `featureState` là nó — nền `--c-warn-bg`, chữ `--c-warn-fg`.
7. **Version + state** — `v1.2 · PUBLISHED` / `DRAFT` / `DEPRECATED`.

`AC-PGM04-01` đạt bằng mục 5: chữ ký thấy được **trước khi** mở chi tiết.

## 3. Ma trận trạng thái BẮT BUỘC

| Trạng thái | Điều kiện | Phải hiện | Cấm |
|---|---|---|---|
| `loading` | request đầu chưa về | skeleton **khớp hình học** card thật (3 dòng, cùng chiều cao) | spinner giữa màn hình trống |
| `empty-filter` | có bộ lọc, 0 kết quả | câu "không khớp bộ lọc" + nút **Xoá bộ lọc** | trộn lẫn với empty-thật |
| `empty-project` | PROJECT chưa có khối nào | câu giải thích + nút Tạo khối **nếu** `roleCan('program.edit')` | ẩn nút mà không nói lý do |
| `error` | request lỗi | thông điệp lỗi + nút Thử lại; **danh sách cũ vẫn đọc được nếu đã có** | biến lỗi thành danh sách rỗng |
| `offline` | mất mạng | banner dính; phần đã tải vẫn đọc | xoá nội dung đang hiện |
| `no-permission` | thiếu `program.edit` | nút ghi **vẫn thấy**, `disabled`, kèm lý do thành lời | ẩn nút |
| `review-required` | `featureState=REVIEW_REQUIRED` | badge + Insert `disabled` + lý do | checkbox bỏ qua, hoặc Insert im lặng |
| `target-chooser` | Insert khi không có POU đang mở | hỏi chọn POU đích | tự tạo POU hoặc tự sửa Draft |

Hai ô quan trọng nhất, và cả hai đều là luật "không nói dối":

- **`error` ≠ `empty`.** Một danh sách rỗng đọc như "thư viện không có gì";
  sự thật có thể là "không đọc được thư viện". Hai câu dẫn tới hai hành động.
- **`no-permission` hiện nút bị khoá, không ẩn nút.** Ẩn đi làm người dùng
  tưởng thiết bị không có khả năng đó, rồi đi hỏi sai người.

## 4. Token đã khoá

Chỉ dùng token của sản phẩm; **cấm** màu viết cứng.

| Vai trò | Token |
|---|---|
| Nền trang / thẻ / vùng chìm | `--c-bg` / `--c-surface` / `--c-surface-2` |
| Viền, đường kẻ | `--c-border`, `--c-line-strong` |
| Chữ chính / chữ mờ | `--c-text` / `--c-text-dim` |
| Nhấn, liên kết, tiêu điểm | `--c-accent`, `--c-accent-bg` |
| `REVIEW_REQUIRED`, DEPRECATED | `--c-warn-fg` trên `--c-warn-bg` |
| Lỗi | `--c-fault-fg` trên `--c-fault-bg` |
| PUBLISHED | `--c-good-fg` trên `--c-good-bg` |
| Bo góc | `--radius` |

Tương phản sáng/tối do `contrast.test.ts` canh; spec này không mở ngoại lệ nào.

## 5. Tiêu điểm và bàn phím

Thứ tự tab: `Tab scope → Bộ lọc → Ô tìm → lưới card → Inspector → nút hành động`.

- Trong lưới: `←/→/↑/↓` di chuyển giữa card, `Enter` mở Inspector, `Home`/`End` về đầu/cuối.
- Lưới là **một** điểm dừng tab (roving tabindex), không phải N điểm dừng theo số card — một thư viện 200 khối sẽ biến `Tab` thành vô dụng.
- Inspector **không bẫy tiêu điểm** ở khổ `>= 768 px` (nó là vùng cạnh bên, không phải hộp thoại). Ở khổ nhỏ nó là drawer ⇒ có bẫy tiêu điểm và `Esc` đóng, trả tiêu điểm về card đã mở nó.
- Mọi nút `disabled` **vẫn nhận tiêu điểm** và mang lý do qua `aria-describedby`. Một nút không hội tụ được là một lý do người dùng không bao giờ đọc.
- Vùng chạm `>= 24 px` kèm khoảng cách theo WCAG 2.2 target-size — cùng ngưỡng đã áp cho cây POU ở `DEV-PROG`.

## 6. Điều spec này KHÔNG khoá

- **Bố cục Inspector từng tab** (`Details/Parameters/Used In/Versions`) chờ `T61-005` chốt trường; vẽ trước sẽ phải vẽ lại.
- **Nội dung `category`** chờ nguồn (`Q2`).
- **Used-In** chờ ngữ nghĩa hai phạm vi (`D61-08`).

Ba mục này là lý do `T61-004` chưa ký được: một Target thiếu ba trường thì chưa
phải Target.
