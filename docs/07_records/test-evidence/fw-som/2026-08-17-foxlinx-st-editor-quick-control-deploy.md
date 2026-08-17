# Bằng chứng deploy ST Editor Quick Control + sửa cursor lệch dòng lên Foxlinx

> **ID:** `EV-PROG-STQC-001`
> **Liên quan:** ST Editor Quick Control (spec đã duyệt, 4 quyết định); sửa
> con nháy/vùng chọn lệch dòng khi soft-wrap
> **Ngày chạy:** 2026-08-17
> **Bo đích:** `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`), aarch64,
> Buildroot, Web/API `8081`
> **Source (merge commit):** `80e0e3c` (PR #187)

## 1. Phạm vi

Deploy **chỉ FE static** (`VITE_PROGRAMMING_REV_A=1 npm run build`, output
`build/web-ui/dist/`). PR #187 không đổi bất kỳ file nào dưới `apps/core`
hay `apps/web-api` — xác nhận bằng `git diff --stat 039901b..80e0e3c --
apps/core apps/web-api` rỗng trước khi deploy — nên **không** rebuild/deploy
`mkddc-core`/`mkddc-iobus`/`mkddc-netcfg`/`mkddc-web` (Go) lượt này; các
binary đó giữ nguyên, không restart.

## 2. Build

| Thành phần | Lệnh | Kết quả |
|---|---|---|
| FE | `VITE_PROGRAMMING_REV_A=1 npm run build` (kèm gate `check:programming-contracts`: error-catalog/API-client/FBD) | Thành công |
| Kiểm cờ | `grep -c REVA_SCOPE_ROADMAP dist/assets/*.js` | `0` (đúng kỳ vọng — cờ không bị tree-shake tắt) |
| Kiểm bundle mang code mới | `grep -c 'Bảng lệnh nhanh\|Chèn Point' dist/assets/*.js` | `2` (xác nhận bundle build thật có ST Editor Quick Control) |

## 3. Backup trước deploy

- `/tmp/backup-20260817T045618.tar.gz` (110M) — `/data/config /data/mkddc /userdata`.
- `/opt/mkddc-web/dist.prev` — bản `dist/` cũ (trước deploy này), giữ lại
  trên board để rollback một lệnh (`rm -rf dist && mv dist.prev dist`).

## 4. Cài đặt

`scp -r build/web-ui/dist SOM-DDC-24-foxlinx:/tmp/mkddc-web-dist-new` (không
dùng `rsync` — board Buildroot không có rsync) → swap
`/opt/mkddc-web/dist` với bản mới, giữ bản cũ ở `dist.prev` → `systemctl
restart mkddc-web-pi` (không bắt buộc về mặt kỹ thuật vì `handleStatic`
đọc thẳng từ đĩa qua `os.Stat`/`http.ServeFile` mỗi request — không
embed/cache trong binary Go — nhưng vẫn restart theo đúng checklist chuẩn).

## 5. Smoke test (`FOXLINX_DEPLOY_CHECKLIST.md` §5)

| # | Mục | Kết quả |
|---|---|---|
| 1 | Service status | `mkddc-core`/`mkddc-iobus`/`mkddc-web-pi`/`mkddc-netcfg` đều `active` |
| 2b | Health tổng | `{"status":"ok","checks":{"core":"ok","io_shm":"ok","iobus":"ok","mcu_connection":"ok","plc_shm":"ok","web":"ok"}}` |
| 3 | SHM magic | `05 44 58 4b` (LE) — đúng, khớp giá trị hiện hành (WP-12 deploy 2026-08-15 cũng ghi nhận `05 44 58 4b`) |
| 4 | Web UI | `<!doctype html><html lang="vi">` trả về đúng |
| 5 | Bundle thật đang chạy | `index.html` trỏ `assets/index-BBe1fIlL.js` — TRÙNG KHỚP tên file vừa build cục bộ (không phải bundle cũ do cache); nội dung bundle được board serve chứa "Bảng lệnh nhanh"/"Chèn Point" |
| 8 | Log lỗi | Không có lỗi từ `mkddc-*`; chỉ có lỗi lặp không liên quan từ `AgentSvr-agent.service` (`Exec format error` — vendor agent bên thứ ba trên board, không thuộc MK-DDC-24, đã tồn tại từ trước — xem tiền lệ WP-12 2026-08-15, không phải regression) |
| 9 | Disk | 30% (< 80%) |
| 10 | Temp | 42.55°C (< 70°C) |

`mkddc-core --version` giữ nguyên `git_commit=158ba8b...` (commit của WP-12,
2026-08-15) — đúng như kỳ vọng vì deploy này không đổi Core.

## 6. Giới hạn bằng chứng

Giống các bản ghi deploy Foxlinx trước (xem WP-12 2026-08-15): **không có
credential đăng nhập web-app (JWT)** cho board này trong phiên làm việc
(SSH `admin123` khác mật khẩu web-app Admin — nợ kỹ thuật đã ghi nhận từ
trước). Vì vậy **không** thực hiện được thao tác `Ctrl+P`/Ghi chú/Bọc
IF/panel chèn Point thật qua UI đăng nhập trên board trong phiên này. Bằng
chứng hành vi ứng dụng đầy đủ (đúng logic, đúng keyboard, đúng cache) đã có
ở tầng test tự động thật trước khi deploy: `quickControl.test.ts` 13/13,
`SourceEditor.test.tsx` 12/12, 6 test tích hợp mới ở
`DesignWorkspacePage.test.tsx`, `npx playwright test e2e/programming.spec.ts`
5/5 (Chrome thật, mock backend) — xem `CHANGELOG.md` mục PR #187. Bằng
chứng board thật ở đây xác nhận đúng bundle đã lên board và server phục vụ
đúng file tĩnh, không xác nhận lại hành vi UI (đã có ở tầng test).

## 7. Kết luận

Deploy PR #187 (sửa cursor lệch dòng + ST Editor Quick Control) lên Foxlinx
**thành công**, không regression phát hiện được qua smoke test. Vì phạm vi
chỉ FE static, rủi ro thấp (không đổi binary Core/Go/service đang chạy).
Việc còn thiếu — xác nhận thao tác UI thật qua đăng nhập web-app trên board
— chặn bởi thiếu credential Admin, nợ kỹ thuật đã biết trước, không do đợt
deploy này tạo ra.
