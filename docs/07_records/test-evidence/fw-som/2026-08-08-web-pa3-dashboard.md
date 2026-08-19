# Bằng chứng nghiệm thu — Web PA3 Dashboard & UX

> **ID:** EV-WEB-PA3-001
> **Ngày:** 2026-08-08
> **Plan:** [52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md](../../../03_implementation/archive/52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md)
> **Yêu cầu nguồn:** UX-REQ-MKDDC24-PA3-001, UX-DES-MKDDC24-PA3-001
> **Baseline commit:** `1b02d41`
> **Bo đích:** `SOM-DDC-24-foxlinx` (RV1126B, Buildroot 2024.02), HTTP nội bộ `8081`

---

## 1. Gói đã deploy

| Thành phần | Đường dẫn trên bo | sha256 |
|---|---|---|
| `mkddc-web` (Go, linux/arm64, `-trimpath`) | `/opt/mkddc-web/mkddc-web` | `a5bcc5f53837c9ce4a95a273e15ecfbea6f203bc32dd6cfcfa54953a447655e1` |
| `index.html` | `/opt/mkddc-web/dist/index.html` | `2fc9407fd19d6a6d42308fecc22e9b2ea540ae2a8f2340c016d94a27561c6d28` |
| `assets/index-DepLspUa.js` | `/opt/mkddc-web/dist/assets/` | `106f12882999f5910a69c94709808641943e0d71dabb004aaee618f5a3b23002` |
| `assets/index-Jb_Tx-HS.css` | `/opt/mkddc-web/dist/assets/` | `c33fd9e5bf924bb4598b41c7978d3bbf8a6f20c8313fcd6df20891e10bc93c3a` |
| `assets/charts-Oxq7tOJF.js` | `/opt/mkddc-web/dist/assets/` | `fa8878d5510d42668b9df2c1a558fcb781c8567b901fa74fd5e2319ff1f423c9` |
| `assets/react-DuAxsn9O.js` | `/opt/mkddc-web/dist/assets/` | `6aa0e0458e325b4ece9f3df95904e147c13ddd4a347420ab954edcae8b684eeb` |
| `assets/icons-DrcBxPTA.js` | `/opt/mkddc-web/dist/assets/` | `93ad9f63095a2867e1d1a96665c80b817576e717168a59bf5b945fd7b8d1b478` |
| `favicon.svg` | `/opt/mkddc-web/dist/favicon.svg` | `929bf5a37773f355ca5a76ee1ae4e300fb17aa74f5b27aa4d95630827945db76` |

> Bảng trên là **gói cuối** (slice hai, gồm command palette, Activity page,
> Modbus hierarchy, Trends min–max/CSV, Commissioning prerequisite, Network
> diff). Gói slice một — `mkddc-web` `6eaae228…37f3fe`, bundle
> `index-tvvLeiCx.js` — nằm tại `/data/releases/20260808T162128/` và chính là
> bản dùng cho diễn tập rollback ở §6.

Checksum trên bo **khớp từng byte** với artefact build tại máy dev. Backup bản
trước tại `/data/releases/20260808T145935/` (binary + `dist.tar.gz` + config);
con trỏ rollback ghi ở `/data/releases/LATEST_BACKUP`.

Baseline trước deploy: `mkddc-web` sha256 `0df97384…3aca3b`, bundle
`index-MeoicxEA.js` / `index-BWOAX3rW.css`.

---

## 2. Automated gates

Số đo đo lại tại thời điểm deploy, không dẫn lại số cũ.

| Gate | Lệnh | Kết quả |
|---|---|---|
| C++ | `cmake --fresh … -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` → `ctest` | **860/860 PASS** (13.58 s) |
| Go vet | `go vet ./...` | sạch |
| Go test | `go test ./... -count=1` | **11/11 gói PASS** |
| FE unit | `npx vitest --run --environment jsdom src` | **465/465 PASS** (52 file) |
| FE lint | `npm run lint` (`--max-warnings=0`) | sạch |
| FE build | `npm run build` | PASS |
| E2E | `npx playwright test` (toàn bộ) | **55/55 PASS** (55 s) — gồm `pa3-dashboard.spec.ts` và `pa3-a11y.spec.ts` |

Cả `configure` lẫn `build` của CMake đều đọc exit code (`=0`) trước khi chạy
`ctest` — bẫy "build dir cũ trỏ `services/`" ghi trong CLAUDE.md.

---

## 3. Bằng chứng runtime trên bo

### 3.1 `GET /api/v1/overview` — read model thật (PA3-101/102)

```json
{"schemaVersion":1,"generatedAt":"2026-08-08T15:00:41.757899638Z",
 "controller":{"deviceName":"DDC-24-TANG-1","ip":"192.168.1.110","mac":"FA:2F:A0:BB:47:4D","uptimeS":193883},
 "connected":true,"overallState":"fault","overallReasonCode":"local_io_bad_quality_points",
 "points":{"total":25,"good":16,"bad":9,"groups":[
   {"kind":"UI","total":16,"good":8,"bad":8},{"kind":"AO","total":4,"good":4},
   {"kind":"DO","total":4,"good":4},{"kind":"modbus_rtu","total":1,"bad":1}]},
 "capabilities":{"digitalInputs":0,"universalInputs":16,"analogOutputs":4,"digitalOutputs":4,"modbusRtuBuses":2}}
```

Điểm cần chú ý — đây là **trạng thái thật của bo**, không phải fixture:

- `overallState = fault` vì 8 điểm UI thật đang BAD và 2 bus Modbus không mở
  được. Bản Dashboard cũ trên cùng bo này vẽ vòng tròn xanh "ONLINE".
- `capabilities.digitalInputs = 0` — base SKU Rev A không có DI riêng, và
  Operating Summary không có hàng DI.
- Health strip đủ 5 domain, mỗi domain có `state` + `reasonCode` + `source` +
  `observedAt`; `historian` là `unknown / no_logged_points`, **không** bị gộp
  thành `good`.
- Attention nêu đích danh thiết bị Modbus theo tên cấu hình
  (`"Đồng hồ điện tầng 1 — mất liên lạc"`, `targetId: mbdev-77e8e77c`) chứ không
  phải một ID tự chế.

### 3.2 `GET /api/v1/activity` — nhật ký vận hành (PA3-103/104)

```json
{"schemaVersion":1,"items":[{"id":1,"time":"2026-08-08T15:00:41.751017296Z","kind":"user",
 "actor":"admin","role":"admin","action":"login","objectType":"session","objectId":"admin",
 "outcome":"accepted"}],"nextCursor":null,"retained":1,"capacity":2000}
```

Kho khởi tạo rỗng rồi nhận đúng sự kiện đăng nhập đầu tiên; retention giới hạn
2000 bản ghi, lưu bền tại `/data/config/activity.jsonl`.

### 3.3 Override TTL do Core sở hữu — PA3-107 / PA3-F05

Kịch bản §10.3 "restart `mkddc-web-pi` trong thời gian override".
Bo không có `curl`/`nc`, busybox `wget` không gửi được `PUT`, nên dùng
`/dev/tcp` của bash gửi HTTP thô (`docs`-script `/tmp/ttl-test.sh`).

| Bước | Kết quả trên bo |
|---|---|
| 1. `PUT /points/AO-01 {"value":7.5,"ttlS":180}` | `forced:true`, `priority:"manual"`, `overrideExpiresInS:180` |
| 2. Đọc lại ngay (mô phỏng reload trình duyệt) | `overrideExpiresInS:179` — đồng hồ do Core đếm |
| 3. `systemctl restart mkddc-web-pi` | service `active` sau 5 s |
| 4. Đọc lại **sau restart** | `forced:true`, `priority:"manual"`, **`overrideExpiresInS:172`** |
| 5. `PUT {"release":true}` | `priority` trở về `"safety"`, không còn `overrideExpiresInS` |

Bước 4 là điều kiện nghiệm thu cốt lõi: bộ nhớ của `mkddc-web` bị xoá sạch khi
restart, nhưng trạng thái ép tay quay lại đầy đủ vì nó được **hỏi lại từ Core**
(`op:"query"`, không mutation) chứ không đọc từ một bản sao trong web-api. Bản
trước giữ hạn trong `window.setTimeout` của tab trình duyệt và trong một `map`
gắn với một kết nối WebSocket — cả hai đều biến mất trong kịch bản này.

Audit tương ứng trong journal:

```
AUDIT point_override … point=AO-01 ttl_s=180 remaining_s=180 result=accepted reason_code=core_ttl
AUDIT point_override … point=AO-01 ttl_s=0   remaining_s=0   result=accepted reason_code=released
```

### 3.4 Asset và trạng thái dịch vụ

- `index.html` phục vụ đúng bundle mới, có `<link rel="icon" href="/favicon.svg">`.
- `GET /favicon.svg` → `200` (trước đây `/favicon.ico` → `404` thường trực, PA3-F15).
- `systemctl is-active mkddc-core mkddc-iobus mkddc-web-pi mkddc-netcfg` → `active` ×4.
- `journalctl -u mkddc-web-pi -p err` trong 5 phút sau deploy → **không có mục nào**.

---

## 4. Finding còn mở

| ID | Mức | Nội dung | Vì sao chưa đóng trong đợt này |
|---|---|---|---|
| PA3-N01 | P1 | `PointDTO.UpdatedAt` do `decodePoint()` đóng dấu bằng `time.Now()` lúc ĐỌC, vì PLC SHM không mang timestamp cho từng point. Hệ quả: `lastDataAt` của `/overview` luôn "vừa xong", kể cả khi một kênh đã đứng yên. | Sửa triệt để phải đổi hợp đồng `contracts/shm/mkddc_shm.h` để Core publish thời điểm lấy mẫu, rồi deploy lại Core — ngoài phạm vi một đợt web. Phía FE đã ngừng bịa timestamp (PA3-F04 đóng): khi backend trả rỗng/không hợp lệ thì UI hiện `—`. |
| PA3-N02 | P2 | Ngay sau `release`, `GET /points/{id}` có thể trả `value` của lần quét trước trong khi `raw` đã về 0 (quan sát ở bước 5 §3.3). | Lệch một chu kỳ quét giữa PLC SHM và phản hồi `query`; là độ trễ hiển thị, không phải giá trị bịa. Cần chốt xem có nên phục vụ giá trị từ `query` cho point vừa ghi hay không. |
| ~~PA3-N03~~ | — | **ĐÃ ĐÓNG 2026-08-08.** Cây Bus→Device→Point đã dựng (`HierarchyTree.tsx`), có trên tab Tổng quan của workspace Modbus; tham số serial ở cấp bus, device không có telemetry hiện `unknown`. | — |
| PA3-N04 | P2 | Ma trận quyền không nghiệm thu được ở tầng E2E: `VITE_AUTH_MODE=mock` cấp `role:'admin'` cho mọi lần đăng nhập. | Đã phủ ở tầng khác: `RequireRole.test.tsx` (bảng route khớp backend), unit test nút disable, và `TestViewerCannotOverride` phía Go — nơi role là thật. Muốn E2E thật thì phải chạy Playwright với backend thật + tài khoản thật. |

---

## 5. Accessibility (PA3-603)

Kiểm bằng hai tầng, mỗi tầng đúng việc của nó:

| Hạng mục | Cách kiểm | Kết quả |
|---|---|---|
| Tương phản màu | `src/shared/theme/contrast.test.ts` — tính tỉ số WCAG trên từng cặp token, cả hai theme | PASS (trong 465 test) |
| Landmark (`main`/`banner`/`navigation` có nhãn) | `e2e/pa3-a11y.spec.ts` trên 6 trang | PASS |
| Đúng một `<h1>` mỗi trang | `e2e/pa3-a11y.spec.ts` | PASS **sau khi sửa** — xem dưới |
| Nhãn của select/input | `e2e/pa3-a11y.spec.ts` quét DOM Monitor | PASS |
| Bẫy tiêu điểm + trả tiêu điểm của ngăn kéo | `e2e/pa3-a11y.spec.ts` | PASS |
| Skip link là điểm dừng Tab đầu tiên | `e2e/pa3-a11y.spec.ts` | PASS |
| Tiêu điểm nhìn thấy được | `e2e/pa3-a11y.spec.ts` đọc computed style | PASS |

**Hai lỗi bộ kiểm này tìm ra và đã sửa cùng phiên:** `/monitor` và `/alarms`
trả về một `StateBlock` trần ở trạng thái loading/lỗi, làm trang **mất `<h1>`**.
Người dùng trình đọc màn hình nghe thấy một thông báo lỗi mà không biết mình
đang ở trang nào. Cả hai nay giữ tiêu đề trang trong mọi trạng thái.

Đo màu bằng ảnh chụp trình duyệt CỐ Ý không dùng: nó chậm, dễ vỡ vì
antialiasing, và token mới là nguồn thật của bảng màu.

## 6. Diễn tập rollback (PA3-606)

Chạy thật trên bo, không phải mô tả quy trình.

| Bước | Kết quả đo được |
|---|---|
| Bản đang chạy trước rollback | `mkddc-web` `a5bcc5f5…7655e1`, `index.html` `2fc9407f…1c6d28` |
| `systemctl stop` → khôi phục backup → `systemctl start` | **4 302 ms** |
| Trạng thái dịch vụ sau rollback | `mkddc-core`/`mkddc-iobus`/`mkddc-web-pi`/`mkddc-netcfg` đều `active` |
| Binary sau rollback | `6eaae228…37f3fe` — đúng bản backup |
| Bundle đang phục vụ | `assets/index-tvvLeiCx.js` — đúng bản cũ, không phải bản mới còn kẹt cache |
| `GET /api/v1/health` | `{"status":"ok", …}` |
| `GET /api/v1/overview` | trả `schemaVersion:1` bình thường |
| Kho Activity | `retained: 25` — **dữ liệu vận hành không mất khi đổi binary** |

Sau đó tiến lại bản mới và xác nhận `a5bcc5f5…7655e1` +
`assets/index-DepLspUa.js`, bốn dịch vụ `active`, `journalctl -p err` trống.

Điểm đáng ghi: kho Activity nằm ở `/data/config/activity.jsonl`, tách khỏi
`/opt/mkddc-web`, nên cả deploy lẫn rollback đều không đụng tới nó. Đây là điều
kiện để nhật ký vận hành dùng được làm bằng chứng — một kho bị xoá mỗi lần
nâng cấp thì không.

Lệnh rollback:

```bash
BACKUP=/data/releases/$(cat /data/releases/LATEST_BACKUP)
systemctl stop mkddc-web-pi
install -m 0755 $BACKUP/mkddc-web /opt/mkddc-web/mkddc-web
rm -rf /opt/mkddc-web/dist && mkdir -p /opt/mkddc-web/dist
tar -xzf $BACKUP/dist.tar.gz -C /tmp && cp -a /tmp/dist/. /opt/mkddc-web/dist/
systemctl start mkddc-web-pi
wget -qO- http://127.0.0.1:8081/api/v1/health
```
