# Evidence lịch sử triển khai Foxlinx `d728fa76`

| Thuộc tính | Giá trị |
|---|---|
| ID | `EVD-DEPLOY-FOXLINX-D728-20260905` |
| Trạng thái | Historical record / supporting evidence |
| Ngày đo | 2026-09-05 |
| Ngày baseline hóa | 2026-09-11 |
| Source | `d728fa76020efbbb8f7346052d7e6a4020c60193` (`dirty=false`) |
| Target | `SOM-DDC-24-foxlinx`, Buildroot/aarch64 |
| Hồ sơ chủ quản | [Deployment Provenance Report](../../reviews/DEPLOYMENT_PROVENANCE_REPORT.md) |

Gói này lưu manifest của snapshot raw tại
`build/evidence/deploy-20260905-d728fa76/` và sáu trích đoạn đã làm sạch để
review được trong Git. Nó không chứa ba log host đầy đủ, script deploy, binary,
cấu hình/dữ liệu target, credential hoặc secret.

## Tính toàn vẹn và khả năng phục hồi

- Snapshot raw được đối chiếu có **29 file / 2.556.638 byte**.
- [Manifest SHA-256](RAW_EVIDENCE_SHA256SUMS.txt) có đúng **29 entry**; SHA-256
  của chính manifest là
  `67722e6666c609c1f8c7a04579f31e856ab7ef8aaa838c50bce8db0c155e7eb2`.
- Khi raw snapshot đã được phục hồi đúng đường dẫn trên, chạy:

  ```bash
  (
    cd build/evidence/deploy-20260905-d728fa76
    sha256sum --check ../../../docs/07_records/evidence/deploy-20260905-d728fa76/RAW_EVIDENCE_SHA256SUMS.txt
  )
  ```

  Kỳ vọng: **29/29 `OK`**. Manifest chỉ xác nhận byte-for-byte; nó không ký số,
  không tự phục hồi raw log và không biến snapshot local thành release artifact.
  Nếu raw không còn, trạng thái kiểm lại là `BLOCKED` cho tới khi phục hồi được
  đúng 29 file khớp manifest từ bản lưu được kiểm soát.

## Ma trận phép đo và giới hạn thẩm quyền

| Lớp | Phép đo lịch sử | Kết quả đã đối chiếu | Raw nguồn | Evidence đã commit | Giới hạn |
|---|---|---|---|---|---|
| SOURCE | Git identity và phạm vi PR | full SHA `d728fa76…0193`; gồm PR #534/#535; cây sạch | `final-target.log`, `final-deploy.log` | [TARGET_GATES_EXCERPT.txt](TARGET_GATES_EXCERPT.txt) | Không phải signed release |
| HOST/C++ | Release, Modbus/BACnet/HMI bật; CTest cuối | 1.477 ca: 1.476 pass, 1 skip memlock, 0 fail | `final-host.log:3031-3036` | [HOST_GATES_EXCERPT.txt](HOST_GATES_EXCERPT.txt) | Skip do điều kiện memlock của host |
| HOST/Go | `go test ./... -count=1` | 21 package `ok`, 2 package không có test, trên nền `c253c053`; diff `apps/web-api` tới `d728fa76` rỗng | `go.log` | [GO_GATES_EXCERPT.txt](GO_GATES_EXCERPT.txt) | Không mô tả thành test lại trực tiếp tại commit cuối |
| HOST/FE | Vitest, lint, `build:foxlinx`, budget | 229 file; 2.836/2.836 test; lint/build pass; Programming 137,32/165,00 KiB gzip | `final-fe.log:49-140` | [FE_GATES_EXCERPT.txt](FE_GATES_EXCERPT.txt) | HOST, không phải browser/target test |
| CROSS-BUILD | CMake/build aarch64 | configure/generate và các target cuối đạt 100%; cache đặt discovery `PRE_TEST` | `final-arm64.log`; cache local `build/arm64/CMakeCache.txt:175` | [ARM64_BUILD_EXCERPT.txt](ARM64_BUILD_EXCERPT.txt) | Không chạy binary/test ARM64 trên host x86; cache không thuộc manifest 29 file |
| TARGET | Runtime identity/checksum/service/health | source sạch `d728fa76`; 13/13 checksum; 5/5 service active, `NRestarts=0`; health 6/6 check `ok` | `final-target.log`, `final-stability.log` | [TARGET_GATES_EXCERPT.txt](TARGET_GATES_EXCERPT.txt) | Target dùng FakeMCU; không phải physical I/O/HIL |
| BROWSER | Trang login desktop/mobile | 14/14 response HTTP 200; 0 Console error/warning; 0 request fail; không tràn ngang | `browser-final.log` | [BROWSER_GATES_EXCERPT.json](BROWSER_GATES_EXCERPT.json) | Chỉ login; không chứng minh luồng sau đăng nhập |

`PRE_TEST` được đọc lại từ cache build local còn giữ trong worktree lịch sử,
nhưng cache đó không thuộc snapshot 29 file. Vì vậy build ARM64 là bằng chứng
đã ghim; riêng provenance của tham số discovery chỉ là corroboration local,
không phải artifact đã được manifest bảo vệ.

## Các lớp không được nâng trạng thái

| Hạng mục | Trạng thái record |
|---|---|
| FakeMCU | Có chạy trên target; không tương đương MCU vật lý |
| HMI | `UNVERIFIED` trong 29 raw file về trạng thái active/inactive cuối; chỉ thấy deploy script bảo toàn trạng thái trước đó |
| Flash STM32 | `NOT_RUN`; gói runtime không chứa firmware MCU |
| Physical I/O / HIL | `NOT_RUN` |
| Soak 24 giờ / power-cut | `NOT_RUN` |
| Diễn tập rollback | `NOT_RUN`; chỉ có backup và đường rollback trong script |
| Chrome DevTools MCP | `NOT_RUN`; evidence browser do Playwright/Chromium headless tạo |
| Luồng sau đăng nhập | `NOT_RUN` |
| `RELEASE_READY` / commissioning | Không được suy ra từ gói này |

## Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-11 | Baseline hóa manifest 29 raw file và sáu trích đoạn đã làm sạch của lần triển khai lịch sử 2026-09-05; giữ ranh giới SOURCE/HOST/CROSS-BUILD/TARGET/FAKE-MCU/BROWSER và các lớp `NOT_RUN` |
