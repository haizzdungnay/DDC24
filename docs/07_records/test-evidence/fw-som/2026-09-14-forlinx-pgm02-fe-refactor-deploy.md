# Deploy FE PGM-02 refactor lên bo Forlinx — 2026-09-14

> **Mã:** `EV-PGM02-FE-REFACTOR-DEPLOY-2026-09-14`
> **Bo:** `OK1126B-buildroot` (`root@mekong-fac.ddns.net:2223`)
> **Nguồn:** nhánh `fix/pgm02-fe-refactor-2026-09-13` @ `dcfddc1f` (PR #704, chưa merge)
> **Hồ sơ thiết kế:** [`REV-PGM02-FE-REFACTOR-2026-09-13`](../../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/reviews/PGM-02_FE_REFACTOR_GAP_PLAN_2026-09-13.md)

---

## 1. Quyết định đã lấy — CÓ đổi cờ build so với bản đang chạy

Bản đang chạy trước lát này **không** bake `VITE_PROGRAMS_WORKSPACE_V2`. Đo bằng
trình duyệt thật qua tunnel, trước khi deploy:

```
/eng/programming/programs  →  redirect  /eng/programming
[data-testid="programs-workspace"]  →  không tồn tại
```

Đó là hành vi đúng của `ProgrammingRoutes.tsx`: thiếu cờ thì route `programs`
là `<Navigate to="/eng/programming" replace />`. Nghĩa là **toàn bộ workspace
v2 — nơi chứa mọi thay đổi của PR #704 — sẽ không tồn tại** nếu deploy bằng
`npm run build:release` trần.

Nên gói deploy lần này dựng bằng:

```bash
VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release
```

**Đây là một lần bật cờ cut-over trên bo lab, và nó KHÁC bản trước.** Ghi ra ở
đây vì `DDD-SW-PGM02-WORKSPACE-001 §11` nói rõ không được cut-over trong im
lặng. Đường lùi có sẵn và rẻ — xem §5.

Bằng chứng cờ có hiệu lực: cùng một cây mã, build **không** cờ cho
`programming-opm7OGkl.js`, build **có** cờ cho `programming-CXIvZ_OD.js`.

---

## 2. Cách deploy

| Bước | Lệnh |
|---|---|
| Đóng gói | `tar czf dist.tgz dist` từ `build/web-ui/` |
| Chuyển | `sshpass … scp -P 2223 dist.tgz root@…:/tmp/dist-new.tgz` (bo không có `rsync`) |
| Hoán đổi | giải nén ra `/tmp/dist-stage`, `mv dist dist.prev`, `mv /tmp/dist-stage/dist dist` |
| Khởi động lại | `systemctl restart mkddc-web-pi` |

---

## 3. Kiểm chứng dịch vụ

```
is-active         : active
NRestarts         : 0
MainPID           : 26184
/proc/26184/exe   → /opt/mkddc-web/mkddc-web     (KHÔNG có hậu tố "(deleted)")
netstat           : tcp :::8081 LISTEN 26184/mkddc-web
journal           : GET /assets/programming-CXIvZ_OD.js → 200
```

Chunk mà dịch vụ **thực sự phục vụ qua HTTP** đúng là chunk vừa dựng — không
đọc đĩa để kết luận, theo `feedback-deploy-verify-proc-exe`.

Lần `wget` đầu ngay sau `restart` trả `Connection refused`: đó là đua với lúc
tiến trình chưa mở cổng, không phải lỗi — lần đo sau 8 s cho `LISTEN` bình thường.

---

## 4. Kiểm chứng giao diện trên bo (Chrome thật qua tunnel SSH)

`ssh -L 18081:127.0.0.1:8081`, đăng nhập `admin`, khổ 1680×941, Project thật
`AHU-MASTER-SEQUENCE` (Draft r24 / Active r24).

| Phép đo | Trước deploy | Sau deploy |
|---|---|---|
| `/eng/programming/programs` | redirect về `/eng/programming` | **giữ nguyên**, kèm `?project=…&mode=EDIT` |
| `programs-workspace` trong DOM | không | **có** |
| `grid-template-columns` của workspace | — | **`216px 6px 648px 6px 216px 6px 320px`** (4 cột) |
| `inspector-column` `position` | — | **`static`** (không còn đè header) |
| Khay đáy `grid-template-columns` | — | **`567px 375px 458px`** (3 cột, có Mini Map) |
| Cột Mini Map | — | `x=1200 w=458 h=157` |
| Thư viện nhanh | — | **49 khối / 8 nhóm** (`logic, compare, math, conversion, timer, counter, trigger, control`) |
| Tràn ngang | — | **0 px** |
| Lỗi console | — | **0** |

Ảnh: [`08-board-1680-edit.png`](../../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/reviews/assets/pgm02-refactor-2026-09-13/08-board-1680-edit.png),
[`09-board-1680-live.png`](../../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/reviews/assets/pgm02-refactor-2026-09-13/09-board-1680-live.png).

### Giá trị runtime trên sơ đồ — CHƯA kiểm được trên bo này

Vào chế độ LIVE, bo trả lời đúng và trung thực:

> *"POU này chưa có trong gói đang chạy — nhiều khả năng nó mới được tạo ở Draft
> và chưa Commission."* · *"Chưa có biến runtime cho POU này."*

`NewFbdProgram` chỉ tồn tại ở Draft; gói đang chạy là revision
`8bc583eb-9a27-4eef-8356-87c5a6588f95` không chứa nó. Lớp giá trị vì thế
fail-closed và **không vẽ số nào** — đúng `AC-FBD-010` ("không vẽ giá trị của
một Revision lên topology của Revision khác").

Nên: lớp giá trị runtime trên sơ đồ mới chỉ được nghiệm thu **trên bàn đo cục bộ**
với fixture đầy đủ (5 ô: `23.4 °C`, `24 °C`, `42.3 %`, `42.3 %`, `TRUE`).
Muốn nghiệm thu trên phần cứng cần **một POU FBD đã Commission và có biến ánh
xạ** — chưa có trên bo tại thời điểm này. Không tuyên bố PASS cho hạng mục này.

---

## 5. Đường lùi

```bash
cd /opt/mkddc-web && mv dist dist.new && mv dist.prev dist && systemctl restart mkddc-web-pi
```

`dist.prev` giữ nguyên bản trước (`programming-CBfERwAD.js`, không có cờ v2).
Lùi về là trở lại đúng trạng thái trước lát này, kể cả việc route `programs`
redirect về Overview.

---

## 6. Kết luận

Deploy **PASS** cho phần bố cục và bề mặt; hạng mục giá trị runtime trên sơ đồ
**chưa đo được trên phần cứng** vì thiếu tiền điều kiện (POU FBD đã Commission).
Một thay đổi cờ build đã được thực hiện có chủ ý và có ghi ra (§1).
