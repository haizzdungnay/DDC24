# ADR-026: Profile runtime Programming Rev A và validator duy nhất

- Date: 2026-08-10
- Owner: System Architect (phê duyệt) · Core/Compiler Lead (đề xuất)
- Status: **Proposed** — chờ System Architect ký; chưa ký thì `ARCH-CONF-PROG-001` còn mở
- Đóng xung đột: `ARCH-CONF-PROG-001` tại [`ARCH-PROG-001`](../03_architecture/PROGRAMMING_ARCHITECTURE.md) §11
- Related: [`PROD-PROG-001`](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) §3 ·
  [`DDD-CTRL-PROG-001`](../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md) §3 ·
  [`DDD-FWSOM-PROG-001`](../02_design/software/PROGRAMMING_FW_SOM_DESIGN.md) §5 ·
  [`OD-PROG-003/004`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) ·
  [ADR-023](ADR-023-scheduler-v3-1-priority-transport-va-pham-vi.md)

## Vấn đề (1 câu)

Component scheduler đang có trong source cho phép **8 Task** và chu kỳ **50–60000 ms**,
còn Product Rev A chỉ cho **một Task** với chu kỳ `1000/5000/30000 ms` — hai con số
này không thể cùng đúng khi cùng một artifact được compiler sinh ra và loader nhận.

## Bối cảnh As-Built

Giới hạn hiện tại nằm ngay trong source, không phải suy đoán:

```text
apps/core/application/st/st_scheduler.hpp:50  kMaxTasks           = 8
apps/core/application/st/st_scheduler.hpp:51  kMaxProgramsPerTask = 16
apps/core/application/st/st_scheduler.hpp:52  kMaxProgramsTotal   = 32
apps/core/application/st/st_scheduler.hpp:53  kBaseTickMs         = 50
apps/core/application/st/st_scheduler.hpp:54  kMinPeriodMs        = 50
apps/core/application/st/st_scheduler.hpp:55  kMaxPeriodMs        = 60000
```

Product Rev A (`PROD-PROG-001` §3, khóa bởi ADR-023) chỉ cho một Task và ba chu kỳ
`1 s / 5 s / 30 s`. Component trên là **supporting As-Built** chạy trên host, chưa
nối vào production scan loop.

Hệ quả nếu để nguyên hai bộ số: compiler có thể sinh artifact 3 Task chu kỳ 250 ms
mà loader vẫn nhận, vì loader đọc giới hạn từ `st_limits`/`st_ir` chứ không đọc
Product Spec. Kịch bản `VS-PROG-003` (“không có đường vào cho tính năng ngoài
Rev A”) sẽ PASS trên giấy nhưng FAIL trên thiết bị.

## Quyết định

1. **Một profile runtime duy nhất, có tên và có version:** `revA-1t-1-5-30`.
   Profile khai báo: `maxTasks=1`, `allowedPeriodMs={1000,5000,30000}`,
   `maxProgramsPerTask` và `maxProgramsTotal` theo `OD-PROG-003`, cộng toàn bộ
   giới hạn tài nguyên đã có ở `st_ir.hpp:58-66`.
2. **Profile được nhúng vào artifact và kiểm ở loader**, không chỉ kiểm ở compiler.
   Loader reject `IR-E-013` (`kBadProfile`) khi profile trong artifact khác profile
   mà build của core hỗ trợ. Đây là điểm kiểm **cuối cùng**, không tin compiler.
3. **`kMaxTasks=8` và dải `50..60000 ms` không bị xóa khỏi source**, nhưng trở thành
   giới hạn *cấu trúc của container* — trần vật lý mà profile không bao giờ được
   vượt. Validator Rev A siết xuống theo profile; profile không được nới lên.
   Lý do giữ: xóa hằng số làm mất backstop chống input đối kháng, mà xóa cũng
   không tự làm Rev A an toàn hơn.
4. **Đúng một validator** đọc profile: `compiler` gọi nó trước khi serialize,
   `loader` gọi lại chính logic đó sau khi parse. Cấm hard-code lại con số ở
   handler, BE hoặc FE; FE chỉ đọc `GET /capabilities`.

## Phương án bị loại

| Phương án | Vì sao loại |
|---|---|
| Hạ thẳng `kMaxTasks` xuống 1 trong source | Mất trần chống input đối kháng; và khi Rev B mở multi-task lại phải sửa lõi thay vì sửa profile |
| Chỉ kiểm ở compiler | Compiler là bên **không tin cậy** đối với core (`ARCH-PROG-001` §2); artifact có thể tới từ bundle import |
| Cho phép chu kỳ tùy ý trong `50..60000 ms` | Trái `PROD-PROG-001` §3 và ADR-023; và làm WCET/watchdog không chốt được |

## Hệ quả

- `PROG-102` (Rev A profile) phải sinh ra file profile machine-readable, không phải
  đoạn văn trong tài liệu.
- `IFSPEC-PROG-001` §12 `CAPABILITIES` trả đúng tên profile này; FE khóa lựa chọn
  chu kỳ theo response, không hard-code.
- Test bắt buộc: `limit-1 / limit / limit+1` cho `maxTasks` và cho từng chu kỳ hợp lệ,
  cộng một ca artifact profile lạ phải bị `IR-E-013`.

## Điều kiện xác minh trước khi chuyển `Accepted`

| Điều kiện | Bằng chứng |
|---|---|
| `OD-PROG-003` và `OD-PROG-004` đã ký | decision record có chữ ký Product |
| Profile machine-readable tồn tại và được cả compiler lẫn loader đọc | `contracts/programming/` + test |
| Ca `limit+1` bị reject ở **loader** | `VS-PROG-003` Test Result |

## Chữ ký

| Vai trò | Trạng thái | Ngày |
|---|---|---|
| System Architect | **PENDING** | — |
| Core/Compiler Lead | Đề xuất | 2026-08-10 |
| Product Owner (`OD-PROG-003/004`) | **PENDING** | — |
