# Bằng chứng deploy sửa tận gốc ST Editor lệch grid/caret (FE-ST-001..010) lên Foxlinx

> **ID:** `EV-PROG-STFIX-001`
> **Liên quan:** sửa gốc lỗi grid/caret/nhoè chữ ST Editor (báo cáo trực tiếp
> kèm ảnh chụp 2026-08-17, blocker FE-ST-001..006)
> **Ngày chạy:** 2026-08-17
> **Bo đích:** `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`), aarch64,
> Buildroot, Web/API `8081`
> **Source (merge commit):** `951c7d0` (PR #189)

## 1. Phạm vi

Deploy **chỉ FE static** (`VITE_PROGRAMMING_REV_A=1 npm run build`, output
`build/web-ui/dist/`). PR #189 không đổi `apps/core`/`apps/web-api`
(`git diff --stat 97297ec..951c7d0 -- apps/core apps/web-api` rỗng) nên
không rebuild/restart `mkddc-core`/`mkddc-iobus`/`mkddc-netcfg`/`mkddc-web`
(Go); các binary đó giữ nguyên.

## 2. Build

| Thành phần | Lệnh | Kết quả |
|---|---|---|
| FE | `VITE_PROGRAMMING_REV_A=1 npm run build` (kèm gate contract) | Thành công |
| Kiểm cờ | `grep -c REVA_SCOPE_ROADMAP dist/assets/*.js` | `0` |
| Kiểm bundle mang code mới | `grep -c 'Đã lưu\|Lưu thất bại\|Không có thay đổi để lưu' dist/assets/*.js` | `3` — xác nhận bundle build thật có FE-ST-008 (trạng thái Lưu) |

## 3. Backup trước deploy

`/opt/mkddc-web/dist.prev` — bản `dist/` cũ (từ deploy PR #187 cùng ngày),
giữ trên board để rollback một lệnh.

## 4. Cài đặt

`scp -r build/web-ui/dist SOM-DDC-24-foxlinx:/tmp/mkddc-web-dist-new` → swap
`/opt/mkddc-web/dist` (giữ bản cũ ở `dist.prev`) → `systemctl restart
mkddc-web-pi`.

## 5. Smoke test

| # | Mục | Kết quả |
|---|---|---|
| Service status | `mkddc-core`/`mkddc-iobus`/`mkddc-web-pi`/`mkddc-netcfg` | đều `active` |
| Health tổng | `{"status":"ok", ...}` mọi check | đúng |
| Bundle thật đang chạy | `index.html` trỏ `assets/index-BBstMrjO.js` — TRÙNG KHỚP tên file vừa build cục bộ | đúng |
| Log lỗi | Không có lỗi `mkddc-*` mới (lọc `AgentSvr` — vendor agent không liên quan, tiền lệ đã ghi từ các deploy trước) | sạch |
| Disk | 31% (< 80%) | đạt |
| Temp | 43.2°C (< 70°C) | đạt |

## 6. Giới hạn bằng chứng

Giống các bản ghi deploy Foxlinx trước: không có credential đăng nhập
web-app (JWT) trong phiên nên không tự tay xác nhận trực quan trên board
thật (gõ ST, xem lưới/caret bằng mắt qua trình duyệt đã đăng nhập trên
board). Bằng chứng hành vi/hiển thị đầy đủ đã có ở tầng test tự động thật
TRƯỚC khi deploy — quan trọng nhất là `e2e/st-editor-alignment.spec.ts`
(Chrome thật, không phải jsdom): đọc `getComputedStyle`/
`getBoundingClientRect` xác nhận font-size/line-height/vị trí pixel đúng
tuyệt đối — **10/10 PASS**; cộng `SourceEditor.test.tsx` 17/17 và
`programming.spec.ts` 5/5 (WCAG A/AA). Bằng chứng board thật ở đây xác nhận
đúng bundle đã lên board và server phục vụ đúng file tĩnh chứa code mới,
không lặp lại xác nhận hành vi (đã có ở tầng test).

## 7. Kết luận

Deploy PR #189 lên Foxlinx **thành công**, không regression phát hiện được
qua smoke test. Phạm vi chỉ FE static nên rủi ro thấp (không đổi binary
Core/Go/service đang chạy). Cùng board, cùng ngày với deploy PR #187 —
`dist.prev` hiện giữ đúng bản NGAY TRƯỚC bản sửa lỗi gốc này (không phải
bản trước ST Editor Quick Control), rollback một lệnh nếu cần.
