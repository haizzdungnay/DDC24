# Đóng WP-02 — PGM-04 Control Library (Plan 61)

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-PGM04-WP02-CLOSEOUT-001` |
| Work package | `PLAN-FE-PGM-061` / WP-02 (`T61-201..206`) |
| Ngày | 2026-08-29 |
| Authority | [`AUTH-PROG-2026-08-29-PGM04-002`](AUTH-PROG-2026-08-29-PGM04-002.md) |
| Base | `main@6e1c7cb` cộng lát URL state |
| Lớp bằng chứng | **HOST/LOCAL** (unit + e2e mock). Chưa target, chưa HIL |

## 0. Hồ sơ này KHÔNG nói gì

- **Không** phải Test Result chính thức, **không** đổi `RELEASE_READY` (vẫn `NO-GO`).
- **Không** tuyên bố đã chạy trên bo: lane e2e ở đây là mock trong trình duyệt thật, không phải target.
- **Không** đóng WP-03/WP-04: đường Insert, drawer tạo/sửa và Preview vẫn chưa dựng.

## 1. Sáu task

| Task | Giao ở | Ghi chú |
|---|---|---|
| `T61-201` RBAC theo năng lực | PR #321 | Sửa lỗi trong code ĐANG PHÁT HÀNH — xem §2 |
| `T61-202` phân trang cursor | PR #328 | |
| `T61-203` mô hình trình bày thuần | PR #325 | |
| `T61-204` phân loại/mô tả + URL state | PR #326 + lát này | |
| `T61-205` khay Used-In | PR #327, #331 | |
| `T61-206` state model + nối | PR #329, #330 | |

## 2. Bốn lỗi tìm ra trong lúc làm, không phải trong lúc rà

Đây là phần đáng đọc nhất của hồ sơ. Cả bốn đều nằm trong code đã phát hành
hoặc vừa viết, và cả bốn đều lộ ra vì **dựng thứ khác lên trên chúng**.

| # | Lỗi | Lộ ra khi | Hậu quả nếu để nguyên |
|---|---|---|---|
| 1 | Ba chỗ FE còn so `role === 'admin'` | Đối chiếu RBAC của `T61-001` | `engineer` bị **giao diện** chặn trên thao tác máy chủ chấp nhận, và không có cách nào biết đó là lỗi giao diện chứ không phải chính sách |
| 2 | Thư viện trống báo "không khớp bộ lọc" | Nối `libraryViewState` | Người dùng đi tìm chỗ xoá một bộ lọc **không tồn tại** thay vì đi tạo khối |
| 3 | Phân trang xoá trắng danh sách mỗi lần tải lại | Một case cũ đỏ với `isConnected=false` | `<ul>` bị tháo rồi dựng lại ⇒ **tiêu điểm bàn phím rơi về đầu trang** giữa lúc người dùng đang dùng phím mũi tên |
| 4 | "Đang tải" dùng lại câu lý do của "chưa đo được" | Lane e2e soi `/library-usages` lần đầu | Khay Used-In của khối **PROJECT** hiện lý do của **SYSTEM** — người đọc kết luận sai hai lần |

Lỗi #3 và #4 là của chính các lát trong WP này, tìm ra và sửa trước khi merge.

## 3. Bất biến được khoá bằng đột biến

Mỗi dòng dưới đây đã được kiểm bằng cách **sửa code cho sai rồi xác nhận test
đỏ**, không phải chỉ bằng một test xanh.

| Bất biến | Đột biến đã thử | Kết quả |
|---|---|---|
| `UNAVAILABLE` không bao giờ thành `0` (mô hình thuần) | bỏ nhánh `UNAVAILABLE` trong `usageDisplay` | 2 đỏ |
| `UNAVAILABLE` không bao giờ thành `0` (giao diện) | bỏ nhánh `unavailable` trong khay | 1 đỏ |
| `error` không suy thành `empty` | đưa "0 hàng ⇒ rỗng" lên trước phân loại lỗi | đỏ |
| `empty-filter` khác `empty-project` | gộp hai trạng thái | 5 đỏ |
| Trang lỗi vẫn thử lại được | bỏ `consumed.delete(cursor)` | đỏ |
| Cursor lặp thì dừng | `looping = false` | đỏ |
| Bộ lọc đọc từ URL | bỏ qua `searchParams` | đỏ |

`UNAVAILABLE` được kiểm **hai lần ở hai tầng** vì nó là bất biến đắt nhất:
`count: 0` nghĩa là "không chương trình nào dùng khối này" — một câu mời người
ta xoá nó.

## 4. Số đo

| Cổng | Kết quả |
|---|---|
| `vitest src` | **184 file / 2132 test PASS** |
| `npm run lint` | PASS |
| build + ngân sách | PASS — chunk `programming` **156,55/165 KiB (R3)**, dư **8,45 KiB** |
| `playwright e2e/programming.spec.ts` | **69 PASS / 13 skip** (trước WP-02: 64/13) |
| `go vet` + `go test ./... -count=1` | PASS (WP-01) |
| `verify-project.sh --component layout` | `rc=0` (WP-01) |

## 5. Điều CHƯA phủ được, ghi rõ

- **Insert**: PGM-04 chưa dựng đường Insert nào (thuộc WP-04). Case e2e viết theo dạng *"mọi lối Insert đều phải `disabled`"* nên nó tự thành phép kiểm thật khi `T61-405` đáp xuống, không phải sửa test. Hôm nay nó chỉ khẳng định được ba nửa: có badge, không ô bỏ qua, không nút tự duyệt.
- **`returnTo` và tab của Inspector** chưa vào URL — mới có `scope`/`kind`/`category`/`q`/`entry`.
- **Ngân sách chunk còn 8,45 KiB.** WP-03/WP-04 sẽ chạm trần nếu thêm bề mặt lớn; đo lại trước khi thiết kế, đừng đợi cổng đỏ.
- **Chưa deploy lên bo.** Bo đang chạy bản `main@8835cd0` của R3; toàn bộ PGM-04 của WP-01/WP-02 chưa có trên thiết bị.
