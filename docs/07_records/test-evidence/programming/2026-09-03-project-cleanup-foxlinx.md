# Dọn Project rác trên bo Foxlinx — 2026-09-03

| Thuộc tính | Giá trị |
|---|---|
| Bo | `mekong-fac.ddns.net` (`DDC-24-TANG-1`) |
| DB | `/data/config/programming/programming-v1.sqlite` |
| Sao lưu | `programming-backups/programming-v1-before-archive-20260903T060356Z.sqlite` (6 455 296 bytes) |
| Finding liên quan | `F-SHELL-01` (mở), `F-SHELL-02` (mở) — xem [`PLAN-FE-SHELL-062`](../../../03_implementation/62_PROGRAMMING_SHELL_PROJECT_SETTINGS_REMOVAL_PLAN.md) §9 |

## Triệu chứng

Ô `PROJECT` ở thanh trên của workspace Programming là một **dropdown 18 mục**, trong đó 17 là rác của
các đợt test (`SOAK-10P-*`, `MONITOR-BIND-*` ×8, `GHOST-CHECK-*`, `DEL-CHECK-*`, `FAULTPROBE-*`,
`FOX-P5-FULL-CHECK`). Trên một DDC — một thiết bị chạy đúng **một** bộ chương trình — bề mặt ấy đọc như
một IDE quản nhiều tủ.

## Vì sao rác tích lại được

`F-SHELL-01`: cột `projects.archived` **chỉ được đọc** (`WHERE p.archived=0` ở `queries.go:20,36`),
**không một dòng code nào ghi**; trigger `projects_no_delete` chặn xoá cứng; và không có route
`DELETE`/archive nào trong `router.go`. Soft-delete được thiết kế nhưng chưa bao giờ nối dây, nên mọi
project tạo ra — kể cả bởi một lần chạy test — nằm lại vĩnh viễn.

## Đã làm

Sao lưu DB, rồi đặt `archived=1` cho mọi project trừ `AHU-MASTER-SEQUENCE`:

| | trước | sau |
|---|---:|---:|
| `archived=0` (hiện ra) | 18 | **1** |
| `archived=1` (ẩn) | 0 | **17** |

Giữ lại `AHU-MASTER-SEQUENCE` vì đó là việc thật đang chạy — chương trình `AHU_MasterSequence` xuất hiện
ở bảng *Programs in operation* với `Running / Healthy`, chu kỳ 1000 ms.

Hai project bị archive từng có commission thành công (`FOX-P5-FULL-CHECK` 16 lần,
`SOAK-10P-20260824-172521` 12 lần) — là các đợt test cũ, không phải cấu hình đang vận hành. Revision và
lịch sử của chúng **không bị xoá**, chỉ ẩn khỏi danh sách.

## Kết quả đo

- API `GET /api/v1/programming/projects` trả **1 mục**.
- UI: ô `PROJECT` chuyển từ dropdown thành **chữ tĩnh** `AHU-MASTER-SEQUENCE` — FE **đã có sẵn** luật
  *"có đúng một Project thì canonicalize, không bắt chọn"* (`PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md`
  §286). Cảm giác "giống IDE" hoàn toàn đến từ đống rác, không phải từ thiết kế bề mặt.
- Ba service `mkddc-web-pi` / `mkddc-core` / `mkddc-iobus` vẫn `active`; 0 panic/fatal/ERROR.
- Ảnh: [`2026-09-03-single-project-no-chooser.png`](2026-09-03-single-project-no-chooser.png)

## Hoàn tác

```sql
UPDATE projects SET archived = 0 WHERE archived = 1;
```

hoặc chép lại file sao lưu ở trên.

## CHƯA KHÉP LẠI

Đây là **chữa triệu chứng**. `F-SHELL-01` vẫn mở: sản phẩm không có đường archive/xoá, nên đợt test kế
tiếp lại tích rác đúng như cũ. Thao tác lần này đi thẳng vào SQLite nên **không sinh audit record** —
một lý do nữa để đường archive phải nằm trong sản phẩm chứ không phải trong tay người vận hành cầm
`sqlite3`.
