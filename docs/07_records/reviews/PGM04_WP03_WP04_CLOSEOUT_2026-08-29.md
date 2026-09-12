# Đóng WP-03 và WP-04 — PGM-04 Control Library (Plan 61)

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-PGM04-WP0304-CLOSEOUT-001` |
| Work package | `PLAN-FE-PGM-061` / WP-03 (`T61-301..307`) + WP-04 (`T61-401..406`) + `T61-501..504` |
| Ngày | 2026-08-29 |
| Authority | [`AUTH-PROG-2026-08-29-PGM04-003`](AUTH-PROG-2026-08-29-PGM04-003.md) |
| Base | `main@2ee3c5b` |
| Lớp bằng chứng | **HOST/LOCAL**: unit, e2e trình duyệt thật (mock route), e2e backend Go thật. Chưa HIL |

## 0. Hồ sơ này KHÔNG nói gì

- **Không** phải Test Result chính thức, **không** đổi `RELEASE_READY` (vẫn `NO-GO`).
- **Không** tuyên bố HIL hay I/O vật lý: PGM-04 không đọc/ghi điện.
- **Không** đóng `tags` và `compatibility` — hai mục đã khoá hợp đồng ở
  `LOCK-PGM04-CONTRACT-001` nhưng chưa thi hành, theo dõi ở `B-PGM04-04`.

## 1. Bốn lỗi tìm ra trong lúc làm, không phải trong lúc rà

Đây là phần đáng đọc nhất. Cả bốn nằm trong code đã phát hành, và cả bốn lộ ra
vì **dựng thứ khác lên trên chúng**.

| # | Lỗi | Lộ ra khi | Hậu quả nếu để nguyên |
|---|---|---|---|
| 1 | Cột `category`/`description` **không có đường ghi**: store nhận tham số, nhưng command và request HTTP không có trường | Thêm hai ô nhập vào drawer soạn thảo | Mọi khối PROJECT hiện `— chưa phân loại` vĩnh viễn; bộ lọc Phân loại không bao giờ khớp khối do người dùng tạo. Một cột không ai ghi được là một cột không tồn tại |
| 2 | Trần metadata đo **byte** trong khi hợp đồng và trigger SQLite đếm **ký tự** | Viết case với mô tả tiếng Việt có dấu | Mô tả tiếng Việt bị từ chối ở ~một nửa độ dài cho phép, kèm thông điệp nói "vượt 512 ký tự" khi người dùng mới gõ 512 |
| 3 | Nhãn `REVIEW_REQUIRED` đối chiếu **TÊN** khối với profile sinh ra, không đọc `featureState` của máy chủ | Dựng badge trên thẻ | Khối PROJECT tên `PID` bị gắn nhãn oan; và khối SYSTEM thật MẤT nhãn khi profile lạc hậu — đúng chiều nguy hiểm, vì nhãn biến mất thì không ai đi tìm |
| 4 | Ba trong bốn tab Inspector trỏ `aria-controls` vào một `id` **không tồn tại** | Thêm điều hướng bàn phím cho dải tab | Trình đọc màn hình không đi tới được nội dung mà tab hứa sẽ mở |

Hai lỗi nữa do **chính lát này** tạo ra và bị lane axe bắt trước khi merge:
link Used-In phân biệt chỉ bằng màu (`link-in-text-block`), và hàng Used-In cao
16 px cách nhau 12,8 px (`target-size`). Cả hai đã sửa.

## 2. Quyết định thiết kế đáng ghi lại

**Chèn = điều hướng, không phải ghi.** `AC-PGM04-06` đòi ngữ cảnh đích tường
minh; handoff §4 cấm tự tạo POU hoặc sửa Draft. `TargetPouChooser` hỏi POU đích
rồi mở PGM-02 tại đúng POU ấy kèm `returnTo`. Lý do không phải để làm cho nhanh:
một lần ghi Draft phát ra từ màn hình Thư viện là một lần ghi mà chỗ Hoàn tác
nằm ở màn hình khác — và một lần ghi như thế là lần ghi người ta sẽ không dám
thực hiện.

**Không phát minh luật giao diện mà máy chủ không ép.** Bộ chọn POU chỉ chặn hai
trường hợp CẤU TRÚC — chèn khối vào chính nó, và chèn vào POU mà khối đang phụ
thuộc (một vòng lặp). Cố ý **không** có luật nào theo ngôn ngữ hay `kind`: máy
chủ không ép chúng, nên ép ở giao diện sẽ chặn người dùng trên thao tác máy chủ
chấp nhận, và họ không có cách nào biết đó là luật của giao diện. Đó đúng là lỗi
`T61-201` vừa phải sửa ở đường RBAC. `kind`/`language` của POU được **hiện ra**
để người dùng chọn có hiểu biết.

**Tiêu điểm tách khỏi lựa chọn trên lưới thẻ.** Mũi tên DI CHUYỂN, `Enter` mới
MỞ. Gộp hai thứ lại thì lướt từ đầu tới cuối một thư viện 200 khối sẽ đổi URL
200 lần và bắn 200 request Used-In cho những khối không ai định xem.

**Nút ghi thiếu quyền vẫn thấy, khoá kèm lý do.** Ẩn nút làm người dùng tưởng
thiết bị không có khả năng đó rồi đi hỏi sai người. Câu lý do cũng phải đúng
chính sách: quyền ghi là `program.edit` (`engineer` + `admin`), nên chuỗi cũ
"chỉ tài khoản quản trị" mô tả sai một chính sách mà máy chủ không hề ép.

## 3. Bất biến được khoá bằng đột biến

Mỗi dòng đã được kiểm bằng cách **sửa code cho sai rồi xác nhận test đỏ**, không
chỉ bằng một test xanh.

| Bất biến | Đột biến đã thử | Kết quả |
|---|---|---|
| Nhãn review đọc `featureState`, không đọc TÊN | đối chiếu theo danh sách tên | 2 đỏ |
| Mũi tên di chuyển KHÔNG chọn | thêm `onSelect` vào `focusCard` | 1 đỏ |
| `aria-controls` chỉ trên tab đang mở | đặt cho cả bốn tab | 1 đỏ |
| Metadata trống ⇒ BỎ field, không gửi chuỗi rỗng | gửi chuỗi rỗng | 1 đỏ |
| `REVIEW_REQUIRED`/`DEPRECATED` khoá Chèn | bỏ hai điều kiện | 2 đỏ |
| Metadata đi hết đường ghi (Go) | bỏ `Category`/`Description` khi gọi store | 1 đỏ |
| Trần metadata đếm KÝ TỰ (Go) | đổi lại `len()` | 1 đỏ |

## 4. Số đo

| Cổng | Lệnh | Kết quả |
|---|---|---|
| FE unit | `npx vitest --run --environment jsdom src` | **2186 passed / 188 file** |
| FE lint | `npm run lint` | sạch, `--max-warnings=0` |
| FE build + ngân sách | `npm run build` | PASS — chunk `programming` **161,68 KiB** gzip / trần R3 165,00 |
| E2E trình duyệt | `npx playwright test e2e/programming.spec.ts` | **56 passed**, 13 skipped theo khổ màn, 0 failed |
| E2E PGM-04 riêng | `-g "PGM-04"` (desktop + mobile) | **17 passed**, 3 skipped, 0 failed — gồm axe serious/critical = 0 ở cả hai khổ |
| Go | `go vet ./...` + `go test ./... -count=1` | sạch |
| Hợp đồng | `verify_programming_g1_contracts.py`, `verify_programming_pgm02_contract.py` | PASS sau re-pin `1.31.0 → 1.32.0` |

## 5. Còn lại của Plan 61

| Task | Trạng thái | Điều kiện |
|---|---|---|
| `T61-505` | `ORDERED` | Chrome DevTools desktop/tablet/mobile — số đo thủ công |
| `T61-506` | `TARGET TECHNICAL PASS — REVIEW PENDING` | Chu kỳ rollback/redeploy thật đã chạy 2026-09-06; reviewer độc lập chưa ký |
| `T61-507` | chờ `#464/#465` | Trace/risk đã đồng bộ evidence kỹ thuật; closeout và sign-off vẫn thuộc `ISS-PGM04-20` |
| `B-PGM04-04` | mở | `tags` và `compatibility` đã khoá hợp đồng, chưa thi hành |
