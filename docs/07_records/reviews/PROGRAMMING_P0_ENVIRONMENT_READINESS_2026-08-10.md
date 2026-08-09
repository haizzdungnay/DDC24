# Rà soát môi trường P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-ENV-2026-08-10` |
| Loại | Readiness record; không phải Test Result Programming |
| Phiên bản | 1.0 |
| Ngày | 2026-08-10 |
| Source snapshot | `395b9a5e905549b23d282c125a9b8a337a22f265`, tree `83c7a43ffb08692ad0045fff5169a4596b3777c2` |
| Phạm vi | Branch/PR, host build/toolchain, CI runner, target SOM lab, HIL fixture và evidence repository |
| Chủ quản | Dev Lead + QA + Ops |
| Người phê duyệt | System Architect + Verification Lead |
| Trạng thái | **PARTIAL — HOST/EVIDENCE READY; CI/TARGET/HIL BLOCKED** |

## 0. Đọc nhanh

| Câu hỏi | Kết luận |
|---|---|
| Team có thể chuẩn bị branch/build trên host chưa? | **Có.** Toolchain tồn tại, full host gate PASS và PR #114 chứng minh luồng branch→commit→push→PR→merge hoạt động. |
| Kho Test Result đã sẵn chưa? | **Có về cấu trúc.** README/template/integrity workflow đã tạo; vẫn 0/32 Test Result. |
| Board Foxlinx có sẵn để lấy target evidence chưa? | **Chưa.** Endpoint SSH trả lời nhưng từ chối cả hai khóa dev hiện có; không đọc được runtime/provenance/health. |
| GitHub CI có tạo server evidence chưa? | **Chưa.** Hai workflow kết thúc với mọi job `steps=[]` do billing/spending limit. |
| HIL vật lý có sẵn chưa? | **Chưa.** Chưa có HW authority, fixture/calibration và giới hạn điện được duyệt. |
| Có mở `PLAN_READY/IMPLEMENT_READY` không? | **Không.** Record này chỉ tách trạng thái kỹ thuật; consumer review/decision/sign-off vẫn thiếu. |

## 1. Ma trận readiness

| Hạng mục | Kết quả | Bằng chứng | Ý nghĩa gate |
|---|---|---|---|
| Git branch/change control | `PASS` | PR [#114](https://github.com/Mekong-HCM/MK-DDC-24/pull/114) merge `395b9a5`; branch remote đã xóa; `main == origin/main` | Có thể quản lý thay đổi theo task sau khi authority mở implementation |
| Host C++ build/test | `PASS` | Release, Modbus/BACnet/HMI ON; CTest **860/860** | Development baseline; không thay target/HIL |
| Host Go | `PASS` | `go vet ./...`; 11 package test với `-count=1` | Development baseline |
| Host FE | `PASS` | 53 file/469 test; lint; build | Development baseline; không thay browser evidence |
| Toolchain host | `PASS` | Phiên bản ở §2, mọi executable cần cho gate gốc tồn tại | Có thể build trên host |
| Evidence repository | `PASS — EMPTY` | [`PROG-TR-REPO-001`](../test-results/programming/README.md) + [`RESULT_TEMPLATE.md`](../test-results/programming/RESULT_TEMPLATE.md) | Được ghi Test Result khi scenario READY; hiện **0/32** |
| GitHub Actions | `BLOCKED` | run `31329431703`, `31329431709`; toàn bộ job 2 s, `steps=[]`, annotation billing | Không có server CI/security evidence cho commit hiện hành |
| Target SSH reachability | `PARTIAL` | `mekong-fac.ddns.net:2223` trả lời SSH; không timeout | Đường mạng tới endpoint tồn tại |
| Target authentication/runtime | `BLOCKED` | `Permission denied (publickey,password,keyboard-interactive)` với cả hai public-key identity; không lệnh remote nào chạy | Không claim board health, provenance hoặc target test |
| HIL fixture/instrument | `BLOCKED` | `HW-AUTH-*`, fixture/calibration và giới hạn 199/200/201 ms chưa được duyệt | Chặn G5/G6 và residual acceptance |

## 2. Toolchain host đã đo

| Công cụ | Phiên bản |
|---|---|
| CMake | 3.28.3 |
| GCC host | 13.3.0 |
| Go | 1.22.2 linux/amd64 |
| Node.js | 24.18.1 |
| npm | 11.16.0 |
| GNU Arm Embedded | `arm-none-eabi-gcc` 13.2.1 20231009 |
| GitHub CLI | 2.97.0 |

Kết quả C++/Go/FE được chạy trên tree `83c7a43f`; tree của commit task trước
`ed89693` và merge commit `395b9a5` giống nhau. Không dùng cache Go
(`-count=1`), CMake dùng `--fresh` và bật cả ba option bắt buộc.

## 3. Target lab — kiểm tra chỉ đọc

Alias `SOM-DDC-24-foxlinx` phân giải tới endpoint cấu hình cổng 2223. Ba lần thử
BatchMode gồm alias mặc định, identity `mkddc24_som` và identity dev mặc định đều
đến được SSH server nhưng bị từ chối trước khi chạy command. Hai fingerprint đã
thử:

| Identity | Fingerprint public key |
|---|---|
| SOM deploy | `SHA256:VEcAB4W2gzHJFxUqYyVFQ2olOZwrqgb40kPiJUkYI0k` |
| Dev host | `SHA256:/vbzj6jh9cXGZ2hXnyFAwxolhf7U9w4nreSgJPzGOQs` |

Không sao chép private key vào tài liệu. Không deploy, restart, sửa config hay
đọc được service trên target trong lần rà này. Các số liệu board lịch sử không
được dẫn lại thành trạng thái hiện hành.

## 4. CI server — blocker hạ tầng

PR #114 tạo hai workflow cho đúng head `ed89693`. Build & Test và Security Scan
đều kết thúc `failure` sau khoảng 2 giây; từng job có danh sách step rỗng. GitHub
annotation nêu job không được khởi động do thanh toán gần đây thất bại hoặc
spending limit cần tăng.

Đây không phải test failure của source, nhưng cũng **không được ghi là CI PASS**.
Sau khi sửa billing, phải rerun cả hai workflow trên đúng commit cần nghiệm thu;
local PASS không thay CodeQL/Trivy/Grype/Gitleaks/MCU/ASan server evidence.

## 5. Kho evidence được chuẩn bị

[`PROG-TR-REPO-001`](../test-results/programming/README.md) quy định:

- `TR-PROG-<VS>-<YYYYMMDD>-<SEQ>` bất biến;
- `result.md`, `raw/` và `SHA256SUMS` bắt buộc;
- baseline/fixture/procedure/expected/actual/verdict/review field-level;
- rerun tạo ID mới; baseline đổi thì invalidation có record;
- cấm secret/PII và cấm dùng mock/host regression để giả Test Result.

Kho đạt readiness về cấu trúc nhưng không có thư mục `TR-PROG-*` nào. Vì vậy
VVP/Trace tiếp tục báo `0/32`, đúng với trạng thái trước implementation.

## 6. Blocker và điều kiện mở khóa

| ID | Owner | Ảnh hưởng | Gate | Điều kiện mở |
|---|---|---|---|---|
| `ENV-PROG-001` | Ops/Lab admin | Không đọc được target health/provenance, không chạy target portion | `IMPLEMENT_READY[target]`, G3–G6 | Cài một public key đã liệt kê vào account lab đúng hoặc cập nhật alias/user/key đúng; xác nhận BatchMode chạy được. Không gửi private key qua ticket/chat |
| `ENV-PROG-002` | GitHub Organization Admin | Không có CI/security server evidence | Merge/release assurance | Khắc phục billing/spending limit; rerun Build & Test + Security Scan trên exact commit; mọi job phải có step thật |
| `ENV-PROG-003` | HW + Safety + QA | Không thể đo điện/IOP 199/200/201 ms | G5/G6 | Phát hành `HW-AUTH-*`, BSP/schematic, fixture, instrument và calibration/limit đã duyệt |
| `ENV-PROG-004` | Product + Architect + Verification | Không được dùng plan để mở code production | `PLAN_READY` | Consumer review, conflict closure, `OD-PROG-015` và sign-off đúng candidate |

## 7. Phán quyết

```text
HOST_BRANCH_BUILD_TOOLCHAIN_READY = YES
EVIDENCE_REPOSITORY_READY         = YES_EMPTY_0_OF_32
GITHUB_CI_READY                   = NO_BILLING
TARGET_SOM_LAB_READY              = NO_AUTH
HIL_LAB_READY                     = NO_AUTHORITY_FIXTURE
P0_ENVIRONMENT_READY              = NO
PLAN_READY                        = BLOCKED
IMPLEMENT_READY                   = BLOCKED
```

Team có thể tiếp tục planning, review, chuẩn bị task card và cấu trúc evidence.
Không được tạo feature branch/code production hoặc ghi target/HIL PASS cho tới
khi các gate authority liên quan được mở.

## 8. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-10 | Đo host/toolchain/Git/CI/target endpoint; tạo evidence repository; tách bốn blocker có owner/impact/gate/unlock; giữ gate quyền hạn BLOCKED |
