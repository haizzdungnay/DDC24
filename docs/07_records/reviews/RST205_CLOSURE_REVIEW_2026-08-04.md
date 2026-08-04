# `RST-205` Closure Review — Plan 46 Repository Restructure

**ID:** REVIEW-RST205-001
**Ngày:** 2026-08-04
**Commit đối chiếu:** `9d90f66`
**Plan:** [PLAN-ARCH-RESTRUCT-002](../../03_implementation/46_REPOSITORY_ARCHITECTURE_RESTRUCTURE_PLAN.md)
**Quyết định:** ADR-025 (Accepted 2026-08-03)

## 1. Mục đích

Đối chiếu toàn bộ task, ADR, traceability, changelog, target evidence và rollback
để quyết định đóng Plan 46. Review này không mở scope mới và không đóng gate nào
nằm ngoài phạm vi restructure.

## 2. Đối chiếu tiêu chí hoàn tất (§9 của Plan 46)

| Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|
| Cây đích được áp dụng, không còn implementation ở path cũ | **ĐẠT** | `services/`, `web/`, `src/frontend/`, `fw/`, `shared/`, `packaging/` đều không còn tồn tại |
| Tên binary/lifecycle giữ nguyên | **ĐẠT** | `mkddc-core`, `mkddc-iobus`, `mkddc-web`, `mkddc-netcfg`, optional `mkddc-hmi` chạy đúng tên trên target |
| Ownership/failure boundary giữ nguyên | **ĐẠT** | Thứ tự khởi động sau reboot thật: pty → fakemcu → iobus → core → web; core không khởi động trước khi iobus sẵn sàng SHM |
| `contracts` là authority duy nhất | **ĐẠT** | Chỉ một bản `contracts/shm/mkddc_shm.h` và `contracts/iop/iop_protocol.h` trong toàn repo |
| Go `package main` chỉ trong `cmd/mkddc-web` | **ĐẠT** | Quét `apps/web-api` không thấy `package main` ngoài `cmd/` |
| Feature boundary FE và target dependency C++ được enforce tự động | **ĐẠT** | Repository guard PASS 7 check, gồm 2 test negative |
| Không app phụ thuộc source implementation của app khác | **ĐẠT** | Guard `layout` kiểm dependency direction, PASS |
| Full regression, release bundle, target smoke và rollback PASS | **ĐẠT** | Xem §3 và §4 |
| Controlled docs, traceability và changelog khớp As-Built | **ĐẠT** | Xem §5 |
| Không claim Programming implemented / real RS485 / physical HIL | **ĐẠT** | Xem §6 |

## 3. Số đo regression hiện hành tại `9d90f66`

Chạy `scripts/verify-project.sh --component all`, exit **0**:

| Gate | Kết quả |
|---|---|
| C++ full (Modbus + BACnet + HMI) | **751/751 PASS** |
| Go | **12 package** — 11 package có test đều `ok`, `cmd/mkddc-web` no test files |
| FE Vitest | **35 file, 299/299 PASS** |
| FE production build | **2 223 module**, 536 ms |
| Playwright E2E network | **1/1 PASS**, 23,1 s |
| Firmware STM32 ARM | `firmware.elf` build PASS, `arm-none-eabi-gcc` 13.2.1 |
| Repository layout guard | **PASS** — 7 check, manifest `phase=g4-modularized` |

Ngoài ra `ctest` native **aarch64 trên board, với service production đang chạy**:
**751/751 PASS** (14,50 s).

## 4. Target evidence và rollback

`RST-202` DONE ngày 2026-08-04, đủ năm tiêu chí. Bằng chứng:
[`TARGET_RST202_20260804.json`](../evidence/restructure/TARGET_RST202_20260804.json),
phân tích tại [Board Deploy Report](BOARD_DEPLOY_REPORT_2026-08-04.md).

| Tiêu chí | Kết quả |
|---|---|
| `TARGET_INSTALL` | PASS — checksum 5/5, PID đổi toàn bộ, không service nào giữ inode `(deleted)` |
| `TARGET_PROVENANCE` | PASS — `0.2.1`/`3f4c536`/`dirty=false`, runtime checksum khớp 4/4 |
| `TARGET_STARTUP_ORDER` | PASS — reboot thật, lên lại sau 36 s, thứ tự đúng dependency, 0 unit `mkddc` failed |
| `TARGET_CRASH_RESTART` | PASS — SIGKILL 3 service, `NRestarts 0 → 1`, IOP `ack=ok` trở lại |
| `TARGET_ROLLBACK` | PASS — snapshot tự động + `rollback.sh`, exit 0 |

Rollback nay là quy trình lặp lại được: `install.sh` chụp bản đang chạy vào
`/var/backups/mkddc/<version>-<ts>/` kèm symlink `previous`, và
[`rollback.sh`](../../../platform/packaging/rollback.sh) khôi phục, restart đúng
thứ tự, sinh lại `runtime-build-info` rồi fail nếu còn service giữ inode cũ.

## 5. Khiếm khuyết phát hiện trong nghiệm thu và trạng thái xử lý

Nghiệm thu target làm lộ năm khiếm khuyết mà toàn bộ host regression trước đó
không bắt được. Tất cả đã sửa trong repo, không để lại việc treo:

| ID | Nội dung | Commit |
|---|---|---|
| INSTALL-001 | `install.sh` dùng `enable --now` nên không restart service đang chạy; sau khi cài "thành công", tiến trình vẫn giữ inode đã bị thay và chạy code cũ — false-success | `cb1303c` |
| INSTALL-002 | `install.sh` không cài `fake_mcu`, gây lệch phiên bản trên board lab | `cb1303c` |
| INSTALL-003 | `install.sh` bật `mkddc-hmi` chỉ vì binary tồn tại, ghi đè trạng thái `disabled` và gây vòng lặp restart | `cb1303c` |
| TEST-ISO-001 | Test dùng đúng tên SHM contract; `attach()` mở `O_CREAT\|O_RDWR` rồi `memset` toàn bộ segment nên có thể **xoá sạch SHM production đang sống**. Trên board thì 5 test đỏ vì `EACCES` | `43b4cdb` |
| ROLLBACK-001 | Rollback là thao tác tay, không snapshot tự động, không script — nguyên nhân `/usr/sbin` tích tụ 7 bản sao ad-hoc | PR #85 |

`TEST-ISO-001` là điều kiện tiên quyết để chạy CI runner trên board theo ADR-022;
trước khi sửa, 5 test sẽ đỏ mỗi khi service đang chạy.

## 6. Gap còn tồn tại — restructure không làm các gate này xanh

Ghi lại tường minh theo yêu cầu `RST-205`:

- **Physical I/O HIL** chưa chạy. Board lab dùng fake MCU qua PTY, không có MCU
  STM32 thật, không có tín hiệu analog/digital thật.
- **Real RS485 / Modbus RTU** chưa có slave thật; `VR-MBRTU-001/004/011/012` vẫn
  RED. Hardware controlled draft mới chứng minh một RS485 path trong khi baseline
  yêu cầu hai.
- **HMI panel** chưa có phần cứng. Board chỉ có connector DP/HDMI/Writeback, không
  có MIPI DSI; panel JD9852 + touch FT5436 I²C mới ở mức SW skeleton + target
  design. `mkddc-hmi` giữ `disabled` là đúng chủ đích.
- **Programming Rev A** không được đụng tới. Không tài liệu nào trong Plan 46
  tuyên bố Programming đã implement; 13/13 `VR-PROG-*` vẫn chưa có evidence
  production.
- **Rollback qua hai commit khác nhau** chưa diễn tập. Bài rollback dùng hai bộ
  artifact cùng commit `3f4c536`, chỉ khác nhãn version, nên chứng minh cơ chế chứ
  không phải tương thích cross-commit.
- Toàn bộ target evidence là **lab evidence** trên board dev Orange Pi 5B, không
  phải carrier board MK-DDC-24 production.

## 7. Waiver

Không có waiver. Không còn source hoặc path shim nào tồn tại.

## 8. Kết luận

```text
RST_001_THROUGH_205   = DONE
G0..G4                = PASS
G5                    = PASS
FULL_REGRESSION       = PASS (751/751 C++, 12 Go package, 299/299 FE, 1/1 E2E)
TARGET_ACCEPTANCE     = PASS (5/5 tiêu chí RST-202)
ROLLBACK_REHEARSED    = PASS (cơ chế; chưa cross-commit)
OPEN_DEFECTS          = 0
PLAN_CLOSED           = YES
```

Plan 46 đóng. Việc đóng plan này **không** đóng gate physical I/O HIL, real
RS485, HMI panel hay bất kỳ gate Programming nào; các gate đó giữ nguyên trạng
thái hiện hữu và được theo dõi ở hồ sơ riêng.
