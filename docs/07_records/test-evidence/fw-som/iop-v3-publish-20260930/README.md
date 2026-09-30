# Kiểm chứng trước khi push/merge hồ sơ IOP V3

**ID:** EV-IOP-V3-PUBLISH-20260930
**Phiên bản:** 1.0
**Ngày:** 2026-09-30
**Trạng thái:** Record HOST; không phải kết quả P1/P2/P3
**Chủ quản:** Project Engineering

## Phạm vi và quyền

Nhánh `docs/iop-v3-hw-fw-handover-20260930`, đã đồng bộ main `729b3a35` bằng merge `2d07e96b`. Gói R3 vẫn ghim nguồn `70e9f19980d2`; không đổi source runtime so với main. Chủ dự án yêu cầu commit tất cả WIP, push, PR, kiểm và merge; sau đó cho phép bỏ quy trình và nhắc push thư mục bàn giao. Ngoại lệ áp dụng việc phát hành này, không sửa quy tắc toàn repo và không ghi nhận review độc lập giả.

## Kết quả đo mới

| Cổng / lệnh | Kết quả |
|---|---|
| `cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` | PASS |
| `cmake --build build/fw --parallel` | PASS |
| `ctest --test-dir build/fw --output-on-failure` | Exit 0: 1752 PASS, 2 SKIP; 1754 mục; 39,11 s |
| `go vet ./...` tại apps/web-api | PASS, [log](go-vet.log) |
| `go test ./... -count=1` tại apps/web-api | 21 package PASS, [log](go-test.log) |
| `npx vitest --run --environment jsdom src` tại apps/web-ui | 278 file, 3597 test PASS; 45,39 s |
| `npm run lint` | FAIL 9 lỗi ESLint có trên main, [log](lint.log) |
| `npm run build` | FAIL 5 lỗi TypeScript có trên main, [log](fe-build.log) |
| `python3 scripts/docs_iso_harness.py --expect` | PASS, [log](docs.log) |
| `python3 scripts/verify_iop_v3_command_reference.py` | PASS 41 frame, 16 CMD, 4 đầu vào lỗi, 2 digest, 4 chế độ C/C++, [log](vectors.log) |
| `python3 scripts/build_iop_v3_handover.py --source-commit 70e9f199` | 18 file, 69 link, ma trận74/74; [log](package.log) |
| GitHub Actions | API `actions/permissions`: enabled=false; CI NOT_RUN |
| Browser/E2E/target/HIL | NOT_RUN: chỉ thay docs/tooling, không thay FE runtime hay trang mạng |

Hai test C++ SKIP: `RealtimeMemlock.MclFutureUnderFiniteLimitIsTheTrapWeGuardAgainst`, `MbaThreadPolicy.ThreadConThuaHuongFifoVaDuocHaVeOther`. Không chuyển SKIP thành PASS.

Đối chiếu sáu file gây lint/build lỗi bằng `git show origin/main:path` với bytes trên đĩa: giống hoàn toàn. `git diff origin/main -- apps contracts platform CMakeLists.txt` rỗng. Lỗi nền theo [finding #848](https://github.com/Mekong-HCM/MK-DDC-24/issues/848), không đóng trong PR tài liệu.

## Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-30 | Đo lại cổng HOST, ghi lỗi nền và ngoại lệ phát hành theo chủ dự án. |
