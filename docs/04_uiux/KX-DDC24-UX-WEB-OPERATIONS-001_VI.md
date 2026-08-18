# Thiết kế UI/UX — An toàn vận hành trên Web (quyền điều khiển và ép tay hàng loạt)

| Thuộc tính | Giá trị |
|---|---|
| ID | `KX-DDC24-UX-WEB-OPERATIONS-001` |
| Phiên bản | 1.0 |
| Trạng thái | **Active** — đủ tư cách làm đầu vào implementation |
| Ngày | 2026-08-18 |
| Chủ quản | UX Lead (ô chữ ký: `WAIVED FOR IMPLEMENTATION`) |
| Nguồn | `AUTH-WEBUX-2026-08-18-02`, `ADR-034`, `ADR-037` trong [DECISIONS.md](../00_governance/DECISIONS.md) |
| Phạm vi | Hai màn hình mới của [Plan 57](../03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md) Wave 1: khối "Ai đang giữ quyền điều khiển" (`T57-1.2`) và hộp thoại ép tay hàng loạt (`T57-1.4`) |
| Hồ sơ chuẩn kế thừa | [Design system `KX-DDC24-UX-SYSTEM-001`](KX-DDC24-UX-SYSTEM-001_VI.md) — token, breakpoint, `StatusBadge`, `DataTable` |

> [!IMPORTANT]
> Hồ sơ này tồn tại để mở cổng Detailed Design cho hai màn hình mới theo
> [`DOC_GOVERNANCE`](../00_governance/DOC_GOVERNANCE.md) §2.2, vốn quy định
> **wireframe chữ hoặc ASCII không đủ**. Nó **không** tạo authority thứ hai chồng
> lên design system: token, breakpoint và spec component vẫn thuộc
> `KX-DDC24-UX-SYSTEM-001`; hồ sơ này chỉ sở hữu **hai màn hình** nêu trong phạm vi.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để làm gì? | Đặc tả trực quan + hợp đồng dữ liệu cho hai màn hình an toàn vận hành mới, đủ để một dev không tham gia thiết kế biết chính xác phải render gì và khi thiếu dữ liệu thì hiện gì |
| 2. Ai phải đọc? | Người implement Wave 1, người review, và bất kỳ ai sau này đổi hợp đồng `/points` hoặc `/activity` |
| 3. Vì sao hai màn hình này cần asset render được? | Cả hai chứa **quyết định an toàn**: một cái trả lời câu hỏi bàn giao ca "còn lệnh tay nào chưa nhả không", một cái phát lệnh ghi ra nhiều cơ cấu chấp hành cùng lúc |
| 4. Dữ liệu trong asset là thật hay minh hoạ? | **Minh hoạ.** Mọi tên điểm, giá trị và mốc thời gian trong SVG là dựng để đặc tả bố cục, **không** phải bằng chứng runtime |
| 5. Còn bị chặn gì? | Không. `IMPLEMENT_READY[Wave 1]` đã `PASS` theo `AUTH-WEBUX-2026-08-18-02` |

## 1. OPS-01 — Khối "Ai đang giữ quyền điều khiển"

### 1.1 Vì sao khối này tồn tại

Hôm nay `points.forced` chỉ là **một con số** trong khối TỔNG HỢP ĐIỂM của
Landing. Câu hỏi bắt buộc khi bàn giao ca là *"còn lệnh tay nào chưa nhả không,
của ai, còn hiệu lực bao lâu"* — và để trả lời nó, người trực phải vào Monitor,
lọc `state=forced`, rồi bấm từng điểm để đọc `overrideExpiresInS` trong khung chi
tiết. Ba thao tác cho một câu hỏi hỏi mỗi ngày hai lần.

### 1.2 Đặc tả trực quan

**Desktop 1440 — ba trạng thái (có lệnh, rỗng, không đọc được):**

![OPS-01 desktop](assets/operations/OPS-01_OVERRIDE_OWNERSHIP_DESKTOP.svg)

**Mobile 390 × 844 — bảng đổ thành thẻ:**

![OPS-01 mobile](assets/operations/OPS-01_OVERRIDE_OWNERSHIP_MOBILE.svg)

### 1.3 Cây component

```text
DashboardPage
└── OverrideOwnershipPanel            (mới — khối thứ 4.5, đặt NGAY DƯỚI Attention)
    ├── Panel                         (dùng lại)
    ├── OverrideSummaryBar            (mới — nội tuyến: đếm + số sắp hết hạn)
    ├── StateBlock state="empty"      (dùng lại — nhánh không có lệnh nào)
    ├── StateBlock state="error"      (dùng lại — nhánh không đọc được)
    └── OverrideOwnerRow ×N           (mới)
        ├── ForcedBadge               (dùng lại — StateAtoms)
        ├── OverrideRemaining         (mới — đếm ngược + dấu hiệu phi-màu)
        └── Link ×2                   (→ /monitor?point= và /activity?objectId=)
```

Vị trí trên trang: **giữa `AttentionPanel` và `MyWorkspace`**. Thứ tự ưu tiên của
Landing (UX-DES §4.1) xếp *"mất liên lạc/suy giảm"* trên *"ghim của người dùng"*;
một lệnh tay đang giữ đầu ra là thông tin cùng hạng an toàn với hai mục đó, và
cao hơn hẳn không gian cá nhân.

### 1.4 Bảng ánh xạ vùng → field → API → state → action → RBAC → copy → error → test

| Vùng | Field | API (thật) | State khi thiếu | Action | RBAC | Copy khi rỗng | Test khoá |
|---|---|---|---|---|---|---|---|
| Dải tóm tắt | `points[].forced` | `GET /api/v1/points` | khối lỗi; **không** hiện `0` | — | viewer | — | tóm tắt rỗng ≠ lỗi đọc |
| Cột ĐIỂM | `point.id` / `point.tag` | `GET /api/v1/points` | không render hàng | → `/monitor?point=<id>` | viewer | — | link mang đúng tham số trang đích đọc |
| GIÁ TRỊ ĐANG ÉP | `point.value`, `point.unit` | `GET /api/v1/points` | `—` | — | viewer | — | `value === undefined` ⇒ `—`, không ra `0` |
| NGƯỜI RA LỆNH | `activity.actor`, `activity.role` | `GET /api/v1/activity?kind=user` | `—` + lý do | → `/activity?objectId=<id>` | viewer | "không có vết trong Activity" | không có vết ⇒ `—`, **không** ghi "hệ thống" |
| LÚC | `activity.time` | `GET /api/v1/activity` | `—` | — | viewer | — | không đóng dấu giờ máy trạm |
| CÒN LẠI | `point.overrideExpiresInS` | `GET /api/v1/points` (Core cấp) | `—` + "KHÔNG CÓ THỜI HẠN" | — | viewer | — | `undefined` ⇒ **không** ra `00:00` |
| NGUỒN GIỮ | `point.priority` | `GET /api/v1/points` | `—` | — | viewer | — | nhãn chữ + icon, không chỉ màu |

### 1.5 Ba ô cùng hiện `—` nhưng ba nghĩa khác nhau

Đây là chỗ dễ làm sai nhất của cả khối, nên viết thành luật:

| Ô | `—` nghĩa là | **Không** được hiểu thành |
|---|---|---|
| NGƯỜI RA LỆNH | không tìm thấy vết `point_force`/`point_override`/`point_metadata` trong Activity cho điểm này | "hệ thống tự ép" |
| LÚC | không có mốc thời gian thật từ producer | thời điểm hiện tại |
| CÒN LẠI | `overrideExpiresInS` không có giá trị ⇒ lệnh **không có thời hạn tự nhả** | "vừa hết hạn" (`00:00`) |

### 1.6 Quyền — suy từ endpoint backend thật

Khối là **đọc thuần**, hiển thị từ `viewer` trở lên. Cả `GET /api/v1/points` và
`GET /api/v1/activity` đều đăng ký `RoleViewer` trong
`apps/web-api/internal/app/http.go`. Khối **không** có nút ghi nào, nên
`ROUTE_MIN_ROLE` của Landing giữ nguyên và **không được** nâng. Việc nhả lệnh ép
vẫn nằm ở Monitor, nơi đã khoá `operator`.

Ca trực chỉ-đọc phải nhìn thấy ai đang giữ quyền: đó chính là câu hỏi bàn giao
ca, và giấu nó đi không làm hệ thống an toàn hơn.

### 1.7 Trạng thái rỗng phải khác trạng thái không đọc được

| Tình huống | Trình bày | Vì sao phải khác |
|---|---|---|
| Đọc được bảng điểm, không điểm nào `forced` | Khối **xanh** + "Không có lệnh tay nào đang giữ quyền" + nói rõ đã đọc bao nhiêu điểm và lúc nào | Đây là một kết luận có căn cứ |
| Không đọc được bảng điểm | Khối **đỏ** + "Không đọc được bảng điểm" + "Không kết luận được là có hay không có lệnh ép tay" + nút Thử lại | Trình bày "không đọc được" thành "mọi thứ bình thường" trên màn hình bàn giao ca là lỗi an toàn — cùng họ với `FE-DATA-01` |

## 2. OPS-02 — Hộp thoại ép tay hàng loạt

### 2.1 Vì sao hộp thoại này tồn tại

Chạy thử một AHU cần ép 3–5 điểm liên tiếp. Hôm nay phải mở 5 hộp thoại, mỗi cái
nhập lại thời hạn — vừa chậm, vừa dễ để sót một điểm chưa nhả, và năm thời hạn
lệch nhau nghĩa là năm thời điểm tự nhả khác nhau giữa lúc đang chạy thử.

### 2.2 Đặc tả trực quan

**Desktop 1440 — xác nhận, đang gửi, kết quả hỗn hợp:**

![OPS-02 desktop](assets/operations/OPS-02_BULK_OVERRIDE_DIALOG_DESKTOP.svg)

**Mobile 390 × 844 — toàn màn hình, hàng nút ghim đáy:**

![OPS-02 mobile](assets/operations/OPS-02_BULK_OVERRIDE_DIALOG_MOBILE.svg)

### 2.3 Cây component

```text
MonitorPage
├── BulkSelectionBar                  (mới — chỉ hiện khi đã chọn ≥ 1 điểm)
├── DigitalRow / AnalogRow            (sửa — thêm ô chọn ở đầu hàng)
└── BulkOverrideDialog                (mới)
    ├── Modal                         (dùng lại — đã có bẫy tiêu điểm + trả tiêu điểm)
    ├── BulkConsequenceTable          (mới — hiện tại → sẽ thành, cho TỪNG điểm)
    ├── ô nhập nhóm nhị phân / nhóm analog / thời hạn dùng chung
    ├── ô xác nhận bắt buộc           (mới — gate bật nút Áp dụng)
    └── BulkOverrideProgress          (mới — đang gửi + kết quả từng điểm)
```

### 2.4 Bảng ánh xạ

| Vùng | Field | API (thật) | Lỗi | RBAC | Test khoá |
|---|---|---|---|---|---|
| Ô chọn từng hàng | `kind ∈ {DO, AO}`, `writable` | `GET /api/v1/points` | — | operator | điểm không ép được ⇒ ô chọn **vô hiệu** |
| Bảng hậu quả | `value` hiện tại → `value` mới | `GET /api/v1/points` | `value === undefined` ⇒ `—` | operator | **không** điền sẵn giá trị đoán |
| Thời hạn dùng chung | `ttlS` (giây) | `PUT /api/v1/points/{id}` body `{value, ttlS}` | `≤ 0` ⇒ chặn tại client | operator | Core cưỡng chế TTL, không phải tab trình duyệt |
| Gửi tuần tự | một request **mỗi** điểm | `PUT /api/v1/points/{id}` × n | lỗi từng điểm hiện riêng | operator | 1 điểm hỏng ⇒ n−1 điểm còn lại **vẫn** được ép |
| Vết kiểm toán | `audit.PointForce` mỗi lệnh | backend tự ghi | — | operator | n lệnh ⇒ **n** vết, không phải 1 |

### 2.5 Bốn luật an toàn của hộp thoại

1. **Không có API ghi hàng loạt ở backend.** `PUT /api/v1/points/{id}` là một
   điểm một request. Hộp thoại gửi **tuần tự** và báo kết quả **từng điểm**.
   Giả vờ đây là một giao dịch nguyên tử là nói dối về thứ không thể nguyên tử.
2. **Huỷ giữa chừng không để lại lệnh nửa vời — theo nghĩa đúng của nó.** Huỷ
   dừng các điểm **chưa** gửi. Điểm **đã** gửi vẫn đang bị ép, và hộp thoại kết
   quả phải nói thẳng điều đó kèm danh sách cần nhả. "Không để lại lệnh nửa vời"
   không thể có nghĩa "tự động rollback", vì rollback cũng là một lệnh ghi ra
   cơ cấu chấp hành và có thể hỏng y như lệnh gốc.
3. **Một điểm hỏng không được làm chìm các điểm đã ép.** Kết quả hỗn hợp hiện
   đủ ba phần: đã ép (kèm đếm ngược), thất bại (kèm **nguyên văn** lỗi backend),
   và nhắc rằng các điểm đã ép vẫn đang giữ quyền.
4. **Ô xác nhận bắt buộc.** Nút Áp dụng bị vô hiệu tới khi người dùng tick ô
   "Tôi đã đọc bảng hậu quả". Đây là ma sát **cố ý**: hộp thoại này gộp 3–5 lệnh
   nguy hiểm thành một cú bấm, nên phải trả lại một nhịp dừng.

### 2.6 Tiếp cận

| Tiêu chí WCAG 2.2 | Cách đạt |
|---|---|
| §2.1.1 Keyboard | Mọi ô chọn, ô nhập và nút là phần tử tương tác chuẩn (`<input>`, `<button>`); không có `<span onClick>` |
| §4.1.2 Name, Role, Value | Ô chọn mỗi hàng có `aria-label` mang tag + tên điểm; nút mở hộp thoại nói rõ số điểm |
| §1.4.1 Use of Color | `ĐÃ ÉP` ↔ `THẤT BẠI` phân biệt bằng **nhãn chữ + icon khác hình** (tick tròn ↔ tam giác), không chỉ xanh/đỏ. Nút vô hiệu dùng viền đứt + chữ mờ |
| §2.4.3 Focus Order | `Modal` đã bẫy tiêu điểm và trả tiêu điểm về nút đã mở nó |
| §4.1.3 Status Messages | Mỗi dòng kết quả là `role="status"`; dòng thất bại là `role="alert"` |
| §2.5.8 Target Size | Trên mobile mọi nút cao ≥ 24 px CSS, cách nhau ≥ 8 px |

## 3. Token và breakpoint — kế thừa, không định nghĩa lại

Hai màn hình dùng **nguyên** bảng token của
[`KX-DDC24-UX-SYSTEM-001`](KX-DDC24-UX-SYSTEM-001_VI.md) §2 và ngưỡng bố cục
`lg = 1024 px` của §4.1. Màu dùng trong asset:

| Vai trò | Token | Giá trị LIGHT |
|---|---|---|
| Nền trang | `--c-bg` | `#C8CCD0` |
| Nền panel | `--c-surface` | `#D8DBDE` |
| Nền phụ / hàng | `--c-surface-2` | `#C2C6CA` |
| Chữ chính | `--c-text` | `#1C1F23` |
| Chữ phụ | `--c-text-dim` | `#4A4F55` |
| Nhấn / liên kết | `--c-accent` | `#26527C` |
| Ép tay | `--c-force` / `--c-force-bg` | `#693797` / `#E9E3F1` |
| Cảnh báo (sắp hết hạn) | `--c-warn-fg` / `--c-warn-bg` | `#634D00` / `#EEE9DB` |
| Lỗi | `--c-fault-fg` / `--c-fault-bg` | `#A01017` / `#F7E0E1` |
| Bình thường | `--c-good-fg` / `--c-good-bg` | `#165B2E` / `#E0ECE5` |

Không token mới nào được thêm. Nếu một trong hai màn hình cần màu chưa có, phải
bổ sung vào design system trước — không đặt màu tại chỗ.

## 4. Revision History

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-18 | Phát hành đầu — đặc tả trực quan (4 asset SVG: desktop + mobile cho cả hai màn hình) và hợp đồng dữ liệu cho `T57-1.2` và `T57-1.4`, mở cổng Detailed Design theo `DOC_GOVERNANCE` §2.2. Chữ ký UX Lead: `WAIVED FOR IMPLEMENTATION` theo `AUTH-WEBUX-2026-08-18-02` |
