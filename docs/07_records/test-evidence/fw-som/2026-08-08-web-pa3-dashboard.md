# Bằng chứng nghiệm thu — Web PA3 Dashboard & UX

> **ID:** EV-WEB-PA3-001
> **Ngày:** 2026-08-08
> **Plan:** [52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md](../../../03_implementation/52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md)
> **Yêu cầu nguồn:** UX-REQ-MKDDC24-PA3-001, UX-DES-MKDDC24-PA3-001
> **Baseline commit:** `1b02d41`
> **Bo đích:** `SOM-DDC-24-foxlinx` (RV1126B, Buildroot 2024.02), HTTP nội bộ `8081`

---

## 1. Gói đã deploy

| Thành phần | Đường dẫn trên bo | sha256 |
|---|---|---|
| `mkddc-web` (Go, linux/arm64, `-trimpath`) | `/opt/mkddc-web/mkddc-web` | `6eaae22846d59c7d806a1caf2990665665c20ef9bac9303600bfa1bbdc37f3fe` |
| `index.html` | `/opt/mkddc-web/dist/index.html` | `f3046977bc5704e977e44fe5751a60e04f4cdbe015d1170248b9216afaceb342` |
| `assets/index-tvvLeiCx.js` | `/opt/mkddc-web/dist/assets/` | `22d2705aaefc97f094bdf80cc66a1e688be7b2e77b3faa2b9b67e4ff8f477f89` |
| `assets/index-BxLfE0y6.css` | `/opt/mkddc-web/dist/assets/` | `89f135558ae62582dbb93a3590ab7e5c42d9cc49fc0fe073aa6dfe7da39f21bd` |
| `assets/charts-CPCXRkdl.js` | `/opt/mkddc-web/dist/assets/` | `73f55e64475950466df7711806e941ad18aaed2c54de31eab5b0865d0eaf3e53` |
| `assets/react-BXR3e1DW.js` | `/opt/mkddc-web/dist/assets/` | `f8d633b1df975451fbd31510f5a874ef5118d1fd334c65b92541a98195527ffa` |
| `assets/icons-WzM2jeCc.js` | `/opt/mkddc-web/dist/assets/` | `a9857b5bf5e3dbc592bb22db5655100f74bc93695cfa2ff536863fcadac50940` |
| `favicon.svg` | `/opt/mkddc-web/dist/favicon.svg` | `929bf5a37773f355ca5a76ee1ae4e300fb17aa74f5b27aa4d95630827945db76` |

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
| E2E | `npx playwright test` (toàn bộ) | **43/43 PASS** (55 s) |

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
| PA3-N03 | P2 | Hierarchy Modbus Bus→Device→Point mới ở mức deep-link (Attention → tab Thiết bị đã lọc). Cây phân cấp đầy đủ theo UX-DES §14 chưa dựng. | PA3-505; workspace Modbus hiện có 6 tab đang hoạt động, việc tái cấu trúc thành cây là thay đổi lớn nên tách khỏi đợt này. |
| PA3-N04 | P2 | Ma trận quyền không nghiệm thu được ở tầng E2E: `VITE_AUTH_MODE=mock` cấp `role:'admin'` cho mọi lần đăng nhập. | Đã phủ ở tầng khác: `RequireRole.test.tsx` (bảng route khớp backend), unit test nút disable, và `TestViewerCannotOverride` phía Go — nơi role là thật. Muốn E2E thật thì phải chạy Playwright với backend thật + tài khoản thật. |

---

## 5. Rollback

Chưa cần dùng. Quy trình đã sẵn sàng và đã kiểm chứng đường dẫn:

```bash
BACKUP=/data/releases/$(cat /data/releases/LATEST_BACKUP)
systemctl stop mkddc-web-pi
install -m 0755 $BACKUP/mkddc-web /opt/mkddc-web/mkddc-web
rm -rf /opt/mkddc-web/dist && tar -xzf $BACKUP/dist.tar.gz -C /opt/mkddc-web
systemctl start mkddc-web-pi
wget -qO- http://127.0.0.1:8081/api/v1/health
```

Bản `dist` cũ cũng còn nguyên tại `/opt/mkddc-web/dist.old` để so sánh nhanh.
