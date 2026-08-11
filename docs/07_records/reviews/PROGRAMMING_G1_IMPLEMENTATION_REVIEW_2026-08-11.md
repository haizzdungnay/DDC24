# Review triển khai G1 Programming — TASK-PROG-100

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-G1-IMPLEMENTATION-REVIEW-2026-08-11` |
| Task | `TASK-PROG-100` |
| Ngày | 2026-08-11 |
| Trạng thái task | **DONE — contract foundation** |
| Trạng thái pha | **P1 IN_PROGRESS — 1/6** |
| Source commit | `9917e3b` (OpenAPI + Go), `81080f8` (TypeScript), `efbed2d` (golden parity) |
| PR / merge | [PR #127](https://github.com/Mekong-HCM/MK-DDC-24/pull/127) / `7109bae6b391163ad893bb29f3bc570d783a3334` |
| Test Result chính thức | **0/32 — không đổi** |
| Evidence hỗ trợ | [`EV-PROG-G1-100`](programming-g1/raw/EV-PROG-G1-100.txt) |

## 1. Kết quả triển khai

- OpenAPI `1.15.0` khai báo 23 path, 25 operation `/api/v1/programming`, RBAC,
  idempotency, `If-Match`, giới hạn mutation 1 MiB và error envelope ổn định.
- Go mount cùng 25 route qua `RegisterProgrammingRoutes`; flag
  `PROGRAMMING_REV_A` mặc định `OFF`, nên binary bình thường vẫn trả `404`.
- Khi flag bật, skeleton chỉ kiểm auth/header/body/schema major và trả
  `503 PRG-ERR-UNAVAILABLE-001`; không giữ state, không gọi Core, không có side
  effect Commission.
- `ValidateImpactAcknowledgements` fail-closed cho `NONE/PRESENT/UNAVAILABLE`,
  acknowledgement thiếu/thừa/trùng và `impactRef` stale.
- Client TypeScript được sinh từ OpenAPI; golden impact payload được Go và FE
  cùng đọc; build FE chạy phép kiểm drift trước
  `tsc`/Vite. FE không tự khai báo danh sách route hoặc error enum thứ hai.

## 2. Kiểm chứng trong phiên

| Làn | Lệnh/kết quả |
|---|---|
| OpenAPI | YAML parse PASS; 605 local `$ref`, thiếu 0; 25 operation; operationId trùng 0 |
| Go targeted | `go test ./internal/programming/... ./internal/app -count=1` PASS |
| Go toàn repo | `go vet ./...` PASS; `go test ./... -count=1` PASS, 12 package có test + 2 package không có test |
| FE contract | generator/check PASS 25 operation; test client/golden 4/4 PASS |
| FE toàn repo | Vitest 54/54 file, 473/473 test PASS; lint PASS; TypeScript/Vite build PASS |
| C++ regression | Release với Modbus + BACnet + HMI build PASS; CTest 860/860 PASS |
| Tài liệu | candidate pin, trace hai chiều, docs ISO harness và `git diff --check` chạy lại trước commit tài liệu |

Không chạy Chrome DevTools: task chỉ thêm contract, router bị flag `OFF` và
client sinh tự động; không thêm route/component/layout hiển thị. Không deploy
target/HIL vì thẻ task ghi rõ không áp dụng ở lát cắt contract-only này.

## 3. Truy vết và ranh giới kết luận

- `BE-110` được nâng riêng `I=Y` sau khi source merge, dẫn đúng commit/file/symbol.
- `FE-110` giữ `I=N`: client đã có nhưng Draft reducer và flow conflict chưa làm.
- `NFR-106` giữ `I=N`: transaction/audit và đo conflict `<=1 s` thuộc task sau.
- Không tạo `TR-PROG-*`; `T/P/R` của toàn bộ 60 requirement vẫn `N`.
- `RELEASE_READY` tiếp tục `BLOCKED`; feature flag không được bật production.

## 4. Next action theo dependency

`TASK-PROG-101`, `TASK-PROG-102` và `TASK-PROG-104` được chạy song song. Sau
khi `100..102` đều `DONE`, bắt đầu `TASK-PROG-103`; `TASK-PROG-105` là review
join cuối P1.

Remote branch `feat/programming-contract-foundation-20260811` đã xóa sau merge.
