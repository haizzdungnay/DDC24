# <Tên hồ sơ> — Detailed Design MK-DDC-24

> Template hồ sơ Detailed Design có kiểm soát. Luật áp dụng nằm ở
> [`DOC-GOV-001`](../../00_governance/DOC_GOVERNANCE.md). Xóa mọi dòng chú thích
> `>` trước khi phát hành. Trước khi mở PR, chạy
> `python3 scripts/docs_iso_harness.py --expect`.

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-<COMP>-<SCOPE>-001` |
| Phiên bản | 0.1 |
| Trạng thái | `M1 — OUTLINE` \| `M2 — DRAFT CONTENT` \| `M3 — REVIEW READY` |
| Ngày | YYYY-MM-DD |
| Chủ quản | <team hoặc người> |
| Người review | <các consumer của contract này> |
| Người phê duyệt | <thẩm quyền ký> |
| Nguồn | <requirement, ADR, decision> |
| Requirement | `<REQ-IDs>` |
| Phạm vi | <trong và ngoài phạm vi, một dòng> |

## 0. Đọc nhanh

> Bảy câu hỏi cố định. Người **không** tham gia thiết kế phải trả lời được cả
> bảy chỉ bằng phần này. Viết bằng tiếng Việt, tránh từ mơ hồ như “hỗ trợ”,
> “tối ưu”, “xử lý phù hợp”.

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | |
| 2. Ai phải đọc file này? | |
| 3. Hệ thống hiện tại đang có gì? | <As-Built thật, dẫn đúng path và symbol> |
| 4. Thiết kế mới thay đổi điều gì? | |
| 5. Team phải sửa module hoặc contract nào? | |
| 6. Điều gì còn bị chặn? | <mỗi mục phải có owner, ảnh hưởng, gate, điều kiện mở> |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | <ID scenario và trạng thái thật> |

## 1. Mục tiêu, actor và phạm vi — `DD-02`

Outcome, use case, in-scope, out-of-scope, constraint, tiêu chí thành công.

## 2. As-Built và khoảng trống — `DD-03`

| Nội dung | As-Built <ngày> | Gap so với Target |
|---|---|---|
| | <dẫn đúng file, class, function, route, schema **có thật**> | |

> Không viết Target vào cột As-Built. Nếu chưa tồn tại thì ghi rõ “chưa tồn tại”.

## 3. Thiết kế mục tiêu và quyền sở hữu — `DD-04`

Chủ sở hữu của từng state thay đổi được; input, output, consumer; process,
thread, deployment; failure boundary. Kèm sơ đồ hoặc sequence khi luồng phức tạp.

## 4. Mô hình dữ liệu từng field — `DD-05`

| Field | Type | Unit | Required | Default | Range/Enum | Null/Unknown | Key/Index/FK | Validation | Lifecycle | Version/Migration |
|---|---|---|---|---|---|---|---|---|---|---|

> `null`, `unknown`, `stale`, `offline` **không** được chuẩn hóa thành `0` hay
> chuỗi rỗng.

## 5. Interface và contract — `DD-06`

Method/path hoặc byte layout; producer/consumer; RBAC; request/response;
timeout; retry; idempotency; concurrency; **mã lỗi ổn định**; side effect;
audit; compatibility; thứ tự deploy; rollback.

## 6. State, thuật toán và timing — `DD-07`

State machine với guard, action, postcondition; pseudocode; ordering;
transaction và ranh giới atomic; clock; WCET; watchdog; giới hạn bộ nhớ và tài
nguyên; đường xử lý crash và mất điện.

## 7. Luồng người dùng hoặc luồng vận hành — `DD-08`

FE: route, wireframe, cây component, field, action, luồng chính, luồng thay thế
và luồng lỗi, trạng thái loading/empty/error/unknown/stale/offline/permission,
copy, i18n, responsive, keyboard, accessibility.
Ops: preflight, execute, read-back, rollback, incident.

> Với UI/UX: wireframe chữ **không đủ**. Phải có asset render được cho mỗi màn
> hình chính và mọi surface có quyết định an toàn — xem `DOC-GOV-001` §2.2.

## 8. Error, safety và security — `DD-09`

Nơi phát hiện; mã ổn định; state và output được giữ hay thay đổi; retry và
recovery; cách trình bày cho FE/Ops; audit và alarm; safe-state; đầu vào độc
hại; cạn tài nguyên.

## 9. Ánh xạ repository — `DD-10`

| Cần tạo hoặc sửa | Đường dẫn | Dependency được phép | Dependency bị cấm |
|---|---|---|---|

> Đường dẫn chưa tồn tại là hợp lệ ở cột này — đó là **Source Target sẽ tạo**.

## 10. Verification — `DD-11`

| Scenario | Fixture/precondition | Bước và ca lỗi | Kỳ vọng **định lượng** | Target và evidence | Thẩm quyền ký |
|---|---|---|---|---|---|

## 11. Compatibility, deploy và rollback — `DD-12`

Version, schema/ABI, migration, backup, thứ tự deploy, triển khai một phần,
restart, điều kiện kích hoạt rollback, và **dữ liệu phải được giữ**.

## 12. Blocker, lịch sử và phê duyệt — `DD-13`

| Blocker | Owner | Ảnh hưởng | Gate | Điều kiện mở khóa |
|---|---|---|---|---|

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | YYYY-MM-DD | Tạo hồ sơ |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|

## 13. Tự kiểm `DD-01..DD-13`

> Mỗi mã: `PASS`, `N/A` kèm lý do, hoặc `BLOCKED` kèm đủ **bốn** trường owner,
> ảnh hưởng, gate, điều kiện mở khóa. Có heading rỗng **không phải** `PASS`.

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | | |
| `DD-02` Mục tiêu/phạm vi | | |
| `DD-03` As-Built | | |
| `DD-04` Target ownership | | |
| `DD-05` Data từng field | | |
| `DD-06` Interface | | |
| `DD-07` State/algorithm/timing | | |
| `DD-08` UX hoặc operation flow | | |
| `DD-09` Error/safety/security | | |
| `DD-10` Repository mapping | | |
| `DD-11` Verification | | |
| `DD-12` Compatibility/deploy/rollback | | |
| `DD-13` Trace/risk/decision/sign-off | | |
