# ADR-031: Chế độ toàn vẹn artifact Rev A là `HASH_ONLY`, chữ ký để dành

- Date: 2026-08-10
- Owner: System Architect + Security Lead (phê duyệt) · Core Lead (đề xuất)
- Status: **Proposed — System Architect ACCEPT**; chờ Security chấp nhận residual risk/trusted boundary trước khi chuyển `Accepted`; code/test/target permission là gate triển khai/release sau quyết định
- Đóng xung đột: `ARCH-CONF-PROG-006` tại [`ARCH-PROG-001`](../03_architecture/PROGRAMMING_ARCHITECTURE.md) §11
- Related: [`IFSPEC-ART-PROG-001`](../02_design/interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md) §4 ·
  [`DDD-SEC-PROG-001`](../02_design/software/PROGRAMMING_SECURITY_DESIGN.md) §7 ·
  [`OD-PROG-001`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md)

## Vấn đề (1 câu)

Loader đã có đường xác minh chữ ký Ed25519 với `allow_unsigned=false` mặc định,
nhưng Rev A **không có** hạ tầng khóa và trusted origin để phát hành chữ ký — nên
mặc định hiện tại hoặc chặn mọi artifact, hoặc bị tắt bằng cấu hình một cách âm thầm.

## Bối cảnh As-Built

```text
apps/core/application/st/st_loader.hpp:96   bool allow_unsigned = false;
apps/core/application/st/st_loader.hpp:33   IR-E-005 kBadHash
apps/core/application/st/st_loader.hpp:34   IR-E-006 kBadSignature
apps/core/application/st/st_loader.hpp:35   IR-E-007 kMissingSignature
apps/core/application/st/st_artifact.hpp:22 kStIrSchemaVersion = 1
```

SHA-256 được tính trên toàn file với vùng `[32,128)` coi như zero
(`st_loader.cpp:561-573`), nên hash phủ cả header lẫn nội dung — cơ chế này đã
đúng và đã có test.

Điều còn thiếu **không phải mã**, mà là: ai giữ khóa riêng, khóa nằm ở đâu, ai
được ký, thu hồi thế nào. Đó là câu hỏi vận hành, chưa có câu trả lời được ký ở
Rev A.

## Quyết định

1. **Rev A dùng `IntegrityMode = HASH_ONLY`.** Loader bắt buộc kiểm SHA-256
   (`IR-E-005` khi lệch) và **không** yêu cầu chữ ký.
2. **`HASH_ONLY` chỉ hợp lệ khi cả compiler lẫn staging path nằm trong trusted
   local boundary**, cụ thể: compiler là subprocess do package pin phiên bản, và
   locator artifact nằm dưới `${STATE_DIR}/programming/staging/` với owner/mode
   do package đặt (`DDD-SEC-PROG-001` §7). Ra khỏi biên này thì `HASH_ONLY` **mất
   giá trị bảo vệ** và phải chuyển sang chế độ có chữ ký.
3. **Trường chữ ký giữ nguyên trong layout artifact schema 1.** Không xóa, không
   tái sử dụng byte. Đổi layout là breaking change của một contract đã có test.
4. **`allow_unsigned` bị thay bằng `integrity_mode` tường minh.** Ba giá trị:
   `HASH_ONLY` (Rev A), `SIGNATURE_REQUIRED` (Rev B trở đi), `SIGNATURE_OPTIONAL`
   (**cấm** — chế độ này chỉ tạo cảm giác an toàn). Chế độ nằm trong **release
   profile của build core**, không nhận từ request và không đọc từ artifact.
5. **Bundle import không được nới lỏng gì.** Bundle Rev A chỉ chứa source/config;
   nó **không** mang artifact executable, nên đường tin cậy của artifact vẫn chỉ
   có một: compiler nội bộ → staging → loader.
6. **Điều kiện để lên `SIGNATURE_REQUIRED`** phải nêu trước, không để mở: có chủ
   sở hữu khóa được chỉ định, khóa nằm trong HSM hoặc tương đương, có quy trình
   thu hồi, và có ca kiểm “artifact ký bằng khóa đã thu hồi bị `IR-E-006`”.

## Phương án bị loại

| Phương án | Vì sao loại |
|---|---|
| Giữ `allow_unsigned=false` rồi tắt bằng config ở lab | Mặc định an toàn nhưng thực tế luôn bị tắt — tệ hơn là khai báo thẳng `HASH_ONLY` |
| Đặt `allow_unsigned=true` | Mất luôn ngữ nghĩa; không phân biệt “chưa dùng chữ ký” với “chấp nhận artifact không ký từ nguồn bất kỳ” |
| Xóa trường chữ ký khỏi layout | Breaking change không cần thiết; Rev B sẽ phải thêm lại |
| `SIGNATURE_OPTIONAL` | Kẻ tấn công chỉ cần bỏ chữ ký là qua — chế độ này không bảo vệ gì |

## Hệ quả

- `IFSPEC-ART-PROG-001` và `DDD-SEC-PROG-001` phải dùng cùng một tên trường
  `integrity_mode` và cùng ba giá trị.
- Test bắt buộc ở Rev A: artifact sửa 1 byte → `IR-E-005`; artifact có chữ ký hợp
  lệ ở chế độ `HASH_ONLY` → vẫn nạp được nhưng ghi log chế độ; artifact ở
  `SIGNATURE_REQUIRED` mà thiếu chữ ký → `IR-E-007`.
- Residual risk về nguồn gốc artifact **không** giảm về `LOW` ở Rev A; nó được
  chấp nhận có điều kiện dựa trên trusted local boundary, và phải ghi vào
  `RSK-PROG-*` kèm người chấp nhận.

## Điều kiện sau quyết định trước khi đóng lát cắt triển khai/release

| Điều kiện | Bằng chứng |
|---|---|
| Security Lead chấp nhận biên tin cậy cục bộ của Rev A | decision record có chữ ký |
| `integrity_mode` thay `allow_unsigned` trong loader + profile | code + unit test |
| Ba ca hash/chữ ký ở trên PASS | `VS-PROG-023` Test Result |
| Quyền/owner/mode của `${STATE_DIR}/programming/staging/` đúng package manifest | kiểm trên target |

## Chữ ký

| Vai trò | Trạng thái | Ngày |
|---|---|---|
| System Architect | **ACCEPT — Phạm Đình Chương; ủy quyền điện tử `AUTH-PROG-2026-08-10-01`, Codex ghi biên bản** | 2026-08-10 |
| Security Lead | **PENDING** | — |
| Core Lead | Đề xuất | 2026-08-10 |
