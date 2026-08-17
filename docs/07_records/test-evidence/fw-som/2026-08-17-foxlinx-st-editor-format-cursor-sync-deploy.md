# Bằng chứng deploy sửa ST Editor "Định dạng" xé VAR RETAIN/IF THEN + khay Dòng/cột lệch lên Foxlinx

> **ID:** `EV-PROG-STFIX-002`
> **Liên quan:** sửa `formatStSource` (VAR RETAIN/IF THEN chung dòng) + đồng
> bộ khay Dòng/cột sau "Định dạng"/"Thay tất cả" (báo trực tiếp kèm ảnh chụp
> 2026-08-17, hai lượt: "editor program đang lỗi gì" + "chọn dòng A thì hiện
> dòng B")
> **Ngày chạy:** 2026-08-17
> **Bo đích:** `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`), aarch64,
> Buildroot, Web/API `8081`
> **Source (merge commit):** `d5e0e66` (PR #192)

## 1. Phạm vi

Deploy **chỉ FE static** (`VITE_PROGRAMMING_REV_A=1 npm run build`, output
`build/web-ui/dist/`). PR #192 không đổi `apps/core`/`apps/web-api`
(`git diff --stat 2da124f..d5e0e66 -- apps/core apps/web-api` rỗng) nên
không rebuild/restart `mkddc-core`/`mkddc-iobus`/`mkddc-netcfg`/`mkddc-web`
(Go); các binary đó giữ nguyên.

## 2. Build

| Thành phần | Lệnh | Kết quả |
|---|---|---|
| FE | `VITE_PROGRAMMING_REV_A=1 npm run build` (kèm gate contract) | Thành công |
| Kiểm cờ | `grep -c REVA_SCOPE_ROADMAP dist/assets/*.js` | `0` |

## 3. Backup trước deploy

`/opt/mkddc-web/dist.prev` — bản `dist/` cũ (từ deploy PR #189/#190 cùng
tuần), giữ trên board để rollback một lệnh.

## 4. Cài đặt

`scp -r build/web-ui/dist SOM-DDC-24-foxlinx:/tmp/mkddc-web-dist-new` → swap
`/opt/mkddc-web/dist` (giữ bản cũ ở `dist.prev`) → `systemctl restart
mkddc-web-pi`.

## 5. Smoke test

| # | Mục | Kết quả |
|---|---|---|
| Service status | `mkddc-core`/`mkddc-iobus`/`mkddc-web-pi`/`mkddc-netcfg` | đều `active` (trước và sau deploy) |
| Health tổng | `{"status":"ok", ...}` mọi check | đúng |
| Bundle thật đang chạy | `index.html` trỏ `assets/index-CqwGz-Qs.js` — TRÙNG KHỚP tên file vừa build cục bộ | đúng |
| Log lỗi | Không có dòng `error/fail/panic` mới trong `mkddc-core`/`mkddc-iobus`/`mkddc-web-pi`/`mkddc-netcfg` (lọc `AgentSvr` — vendor agent không liên quan, tiền lệ đã ghi từ các deploy trước) | sạch |
| Disk | 31% (< 80%) | đạt |
| Temp | 43.5°C (< 70°C) | đạt |

## 6. Giới hạn bằng chứng

Giống các bản ghi deploy Foxlinx trước: không có credential đăng nhập
web-app (JWT) trong phiên nên không tự tay xác nhận trực quan trên board
thật (bấm "Định dạng" thật, xem khay Dòng/cột bằng mắt qua trình duyệt đã
đăng nhập trên board). Bằng chứng hành vi/hiển thị đầy đủ đã có ở tầng test
tự động thật TRƯỚC khi deploy — quan trọng nhất là 3 test mới trong
`e2e/st-editor-alignment.spec.ts` (Chrome thật, không phải jsdom): bấm nút
"Định dạng"/"Thay tất cả" thật trên trang thật rồi đọc lại
`textarea.selectionStart`/khay Dòng/cột — xác nhận khớp nhau tuyệt đối,
**3/3 PASS**; cộng `ProgramsTab.test.ts` 25/25 (5 test `formatStSource` giữ
VAR RETAIN/IF THEN chung dòng, 8 test hai hàm ánh xạ offset). Bằng chứng
board thật ở đây xác nhận đúng bundle đã lên board và server phục vụ đúng
file tĩnh chứa code mới, không lặp lại xác nhận hành vi (đã có ở tầng test).

## 7. Kết luận

Deploy PR #192 lên Foxlinx **thành công**, không regression phát hiện được
qua smoke test. Phạm vi chỉ FE static nên rủi ro thấp (không đổi binary
Core/Go/service đang chạy). `dist.prev` hiện giữ đúng bản NGAY TRƯỚC bản sửa
này, rollback một lệnh nếu cần.
