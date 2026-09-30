# Foxlinx: deploy PR #844 (Core, schedule-sim, sim-worker, web, FE) và kiểm lịch BINARY ghi AO (2026-09-29)

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-FWSOM-DEPLOY-844-TARGET` |
| Phiên bản | 1.0 |
| Ngày | 2026-09-29 |
| PR | [#844](https://github.com/Mekong-HCM/MK-DDC-24/pull/844). Đầu nhánh lúc deploy: `a4c31b53` = `main@895444be` + bản sửa lịch AO + `compile_commands.json` |
| Bo | `OK1126B-buildroot` (Forlinx OK1126B-S, RV1126B), qua WAN `mekong-fac.ddns.net:2223`. LAN `192.168.1.16` báo `No route to host` từ máy dựng |
| Phạm vi | `mkddc-core`, `mkddc-schedule-sim`, `mkddc-programming-sim-worker`, `mkddc-web` (3 unit), FE `dist` |
| Mức bằng chứng | **TARGET** cho §2–§5, **HOST** cho §1. Không phải HIL, không đo điện tại đầu ra AO |
| Kết luận | Deploy xong, read-back **12 kiểm, 0 lệch**. Health 6/6, Programming `READY`, Active không đổi, Program `RUNNING`. Lịch `SCH-001` (BINARY → DO1 + AO1) ghi `OK` cả hai target, và mô phỏng 7 ngày chạy bằng `mkddc-schedule-sim` mới |

## 1. Dựng trên host

Dựng trong một bản clone thường, sạch (`git clone --no-checkout` rồi `checkout a4c31b53`, `git status` rỗng). Không dựng trong cây làm việc chính vì cây đó còn tài liệu chưa commit của phiên khác, sẽ làm binary mang cờ dirty.

| Thành phần | Lệnh | Kết quả |
|---|---|---|
| C++ aarch64 | `cmake --fresh … toolchain-aarch64-linux-gnu.cmake -DMKDDC_ST_PUBLIC_KEY_HEX=<release.pub> -DIOBUS_BUILD_TESTS=OFF -DCORE_BUILD_TESTS=OFF`; build 3 target `mkddc-core`, `mkddc-schedule-sim`, `mkddc-programming-sim-worker` | exit 0; `GLIBCXX` tối đa 3.4.29 (bo có tới 3.4.30); `--st-key-info` qua qemu: `RELEASE` `2fb77aa42e7fe446` |
| Go | `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build ./cmd/mkddc-web` | exit 0; `vcs.revision=a4c31b53…`, `vcs.modified=false` |
| FE | `npm ci` rồi `VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release` | exit 0; chunk `programming` 76,86 KiB gzip (ngân sách R3 165 KiB), 26 file `.gz`, 64 file trong `dist` |
| Tool ST | không dựng lại | profile trên bo `a4396636…` trùng `ProfileSHA256` của web |
| `mkddc-iobus` | không dựng lại | `apps/iobus`, `contracts/shm`, `contracts/iop` không đổi so với bản đang chạy |

Sim worker được dựng lại vì `st_scheduler` (bản sửa #827) đã đổi kể từ bản trên bo (`1602b2fd`). Schedule-sim được dựng lại vì dùng chung `schedule_runtime.cpp` với Core.

## 2. Trạng thái trước deploy

Log gốc: [`bo-truoc-deploy.txt`](deploy-pr844-20260929/bo-truoc-deploy.txt), [`lich-sch001-truoc.txt`](deploy-pr844-20260929/lich-sch001-truoc.txt).

| Mục | Giá trị lúc 13:27Z |
|---|---|
| Core | sha `ef35ff8a…`, `git_commit=e1b2ac51…-dirty`, **khoá TEST** `99354613db15918a`. Được thay lúc 09:45Z bởi một lượt deploy tay, không chạy `deploy-record` |
| web-pi | sha `3806d22e…`, cũng thay lúc 09:45Z. Trả `write_result: "RELINQUISHED"` cho AO của `SCH-001`, là giá trị mà mã trên `main` không sinh ra, tức đây là bản dựng từ mã chưa merge |
| Hai helper | `(deleted)` `3e1ae85b…`, còn chạy binary của lượt 03:35Z |
| Health / Runtime | 6/6 ok; Active `20507c0e…`, `READY`, task `RUNNING` |
| Program | `a153aa91…` `RUNNING`, `faultCount` 0 |
| `SCH-001` | BINARY, prio 16, target DO1 + AO1, INACTIVE (sự kiện thứ Hai 11:00). DO1 `OK` = 0; AO1 `RELINQUISHED`, AO-01 = 0 V ở mức `default` |

## 3. Deploy

Log gốc: [`bo-deploy.txt`](deploy-pr844-20260929/bo-deploy.txt).

1. Chép artifact lên `/tmp/deploy-844` của bo. sha256 trên bo khớp bản dựng cả 5 file, `dist` 64/64 file.
2. Sao lưu vào `/data/mkddc/deploy-backups/20260929T132908Z-pr844-a4c31b53/`:
   - binary cũ: `mkddc-core.prev`, `mkddc-web.prev`, `mkddc-schedule-sim.prev`, `mkddc-programming-sim-worker.prev`;
   - `dist.prev.tgz`, `artifact-manifest.json.prev`, `virtual_points.conf.prev`;
   - `programming-v1.sqlite`, chép sau khi web đã dừng. Không có `-wal`/`-shm` vì web đóng sạch đã checkpoint.
3. Dừng `mkddc-web-pi` và hai helper (`WEB_STOPPED`). Cài 4 binary bằng `install -m 0755 -o root -g root`, thay `dist` (`mkddc:mkddc`).
4. `systemctl restart mkddc-core` lúc 13:29:12Z, rồi start helper và web lúc 13:29:16Z.

Sau khi khởi động:
- Core log `git_commit=a4c31b53…` (không dirty), `core.st_public_key=RELEASE fingerprint=2fb77aa42e7fe446`;
- web log `INFO programming.toolchain ok … profile_sha256=a4396636…`;
- cả 3 unit web chạy `/opt/mkddc-web/mkddc-web` sha `cdcc6df8…`, không còn `(deleted)`.

## 4. Manifest và read-back

Log gốc: [`deploy-record.txt`](deploy-pr844-20260929/deploy-record.txt), [`readback.txt`](deploy-pr844-20260929/readback.txt), [`readback.json`](deploy-pr844-20260929/readback.json).

`deploy-record` chạy trong bản clone sạch, exit 0. Nó ghi 5 mục, lấy commit từ chính file build: C++ `embedded`, Go `go-buildinfo`, FE `git-worktree`. Các mục được giữ nguyên: `mkddc-iobus` và ba tool ST.

| Artifact | sha256 (16 ký tự) | Commit |
|---|---|---|
| `mkddc-core` | `f5ccb3158ff9b8c9` | `a4c31b53`, dirty=false |
| `mkddc-schedule-sim` | `d0d8dc979a5cd117` | `a4c31b53`, dirty=false |
| `mkddc-programming-sim-worker` | `2fe3b4adf8615ea0` | `a4c31b53`, dirty=false |
| `mkddc-web` (3 unit) | `cdcc6df87b18a931` | `a4c31b53`, dirty=false |
| `web-ui` (`index.html`) | `f9d49d42ce2ea036` | `a4c31b53`, dirty=false |

`readback`: **12 kiểm, 0 lệch**, exit 0. Lần kiểm này có thêm mục `file:/opt/mkddc-web/mkddc-schedule-sim`, trước đây chưa có trong manifest.

## 5. Smoke test và kiểm chức năng

Log gốc: [`smoke.txt`](deploy-pr844-20260929/smoke.txt), [`bo-sau-deploy.txt`](deploy-pr844-20260929/bo-sau-deploy.txt), [`lich-sch001-sau.txt`](deploy-pr844-20260929/lich-sch001-sau.txt), [`sim-sau.txt`](deploy-pr844-20260929/sim-sau.txt).

| Kiểm | Kết quả |
|---|---|
| Login | role `admin` |
| Programming capabilities | `targetState: READY`, languages `ST`, `FBD` |
| FE | `<html lang="vi">` |
| Health | 6/6 ok |
| Runtime | Active `20507c0e…` (không đổi), `READY`, task `RUNNING`, `safeState=False` |
| Program sau restart Core | `RUNNING` ở lần chụp 13:30:11Z (59 s sau restart; không đo thời điểm chuyển trạng thái), `faultCount` 0. Không có dòng `WAITING` |
| `SCH-001` runtime (13:30:15Z) | `effective_value` INACTIVE, `applied_revision` 18. **Cả hai** target `write_result: OK`, `written_value: INACTIVE` |
| AO-01 / DO-01 | AO-01 = 0 V ở mức `schedule`, quality `good`; DO-01 = false ở mức `schedule` |
| Mô phỏng 7 ngày (`POST …/SCH-001/simulate`, quyền đọc) | chạy bằng `mkddc-schedule-sim` mới: 3 chuyển trạng thái, 0 gap, 0 xung đột. ACTIVE lúc `2026-09-30T03:30` và INACTIVE lúc `2026-10-05T11:00`, cả hai áp cho `TGT-001` và `TGT-002` |

## 6. Chưa chạy (NOT RUN)

- **Nhánh ACTIVE → AO 100 % trên bo:** chưa tới giờ. Lịch sẽ ACTIVE lúc 03:30 giờ VN ngày 2026-09-30. Không sửa lịch của người dùng để ép nhánh này. Ở host, `BinaryScheduleDrivesAoFullScale` đã kiểm nhánh đó (0-10 V: ACTIVE 10 V, INACTIVE 0 V).
- **Lịch REAL 1 % ghi AO trên bo:** bo không có lịch REAL. Ở host, `RealScheduleOnePercentIsNotFullScale` đã kiểm và bắt đúng lỗi cũ bằng phép đột biến.
- **Đo điện tại chân AO/DO**, HIL.
- **Merge PR #844:** bị chặn ở bước merge tự động vì PR cần review. PR đang mở, chờ người review merge.

## 7. Hoàn tác

Bản trước deploy nằm ở `/data/mkddc/deploy-backups/20260929T132908Z-pr844-a4c31b53/`. Đó là bản dựng tay lúc 09:45Z: Core **khoá TEST** và web từ mã chưa merge. Khôi phục bản này thì bo quay lại trạng thái không dùng được cho phát hành. Nếu cần lùi về một bản sạch, dùng lượt `20260929T033521Z-main-e1b2ac51` (Core `e1b2ac51` khoá RELEASE). Lùi xong phải chạy `deploy-record` và `readback`; lùi web thì lùi kèm `programming-v1.sqlite` nếu schema đã đổi.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-29 | Bản đầu: deploy `a4c31b53` (PR #844) gồm Core RELEASE, schedule-sim, sim-worker, web, FE; readback 12/0; `SCH-001` ghi OK cả DO1 lẫn AO1; mô phỏng 7 ngày chạy bằng schedule-sim mới |
