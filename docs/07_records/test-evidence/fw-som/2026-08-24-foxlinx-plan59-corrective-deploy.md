# Foxlinx — deploy Plan 59 corrective closure (2026-08-24)

| Thuộc tính | Giá trị |
|---|---|
| Bo | `SOM-DDC-24-foxlinx` — `root@mekong-fac.ddns.net:2223` |
| Nền tảng | Linux OK1126B-buildroot 6.1.141 aarch64, `/` còn 7,7 GB |
| Commit nguồn | `fa1f5f4` (main, sau khi merge PR #245) — cây sạch khi build |
| Mức bằng chứng | **TARGET** cho §3–§5; HOST cho các cổng dựng |
| `MCU_MODE` | **FAKE** (`mkddc-fakemcu.service`) — không phải bằng chứng MCU/HIL vật lý |
| Khoá ký | `st_public_key_mode = TEST` (bản lab/bench). **Không** phải bản phát hành ký thật |

## 1. Thành phần đã thay

| Thành phần | Nguồn | Đích trên bo | Hậu tố backup |
|---|---|---|---|
| Core | `build/fw-aarch64/core/mkddc-core` | `/usr/sbin/mkddc-core` | `.prev-plan59c-20260824T102150` |
| Compiler ST | `build/fw-aarch64/core/mkddc-st-compile` | `/usr/sbin/mkddc-st-compile` | ⟂ |
| Packager | `build/fw-aarch64/core/mkddc-st-package` | `/usr/sbin/mkddc-st-package` | ⟂ |
| IO bus | `build/fw-aarch64/iobus/mkddc-iobus` | `/usr/sbin/mkddc-iobus` | ⟂ |
| Fake MCU | `build/fw-aarch64/iobus/fake_mcu` | `/usr/sbin/mkddc-fake-mcu` | ⟂ |
| Netcfg | `build/fw-aarch64/netcfg/mkddc-netcfg` | `/usr/sbin/mkddc-netcfg` | ⟂ |
| BE (Go) | `CGO_ENABLED=0 GOOS=linux GOARCH=arm64` | `/opt/mkddc-web/mkddc-web` | ⟂ |
| FE | `npm run build:release` | `/opt/mkddc-web/dist` | ⟂ |

Provenance mới (`/usr/share/mkddc/provenance.json`) và `checksums.sha256` được
ghi theo đúng bộ binary vừa cài; bản cũ giữ ở `checksums.sha256.prev-plan59c`.

## 2. Hai bẫy đã kiểm TRƯỚC khi copy

- **`GLIBCXX`**: bo chỉ có tới `3.4.30`. Ký hiệu cao nhất của bản mới:
  `mkddc-core`/`mkddc-st-compile`/`mkddc-st-package`/`mkddc-iobus`/`mkddc-netcfg`
  đều **3.4.29**, `fake_mcu` **3.4.21**. Go build `CGO_ENABLED=0` nên static.
- **Cờ Programming là build-time**: FE dựng bằng `npm run build:release`. Bundle
  trên bo là `assets/index-CHfcl-kH.js` — **trùng khít** hash bản dựng cục bộ
  (đọc `index.html` trên chính bo, không suy từ lệnh đã chạy).

Cả ba binary chạy được trên bo và tự khai đúng commit:
`mkddc-core --version` → `git_commit=fa1f5f4…`; `mkddc-web --version` → cùng commit;
`mkddc-st-package --version` → `packager_version=2 profile_id=revA-1t-1-5-30`.

## 3. Sự cố khi khởi động — và cách xử lý đúng quy trình

Sau khi thay binary, Core vào `RECOVERY_REQUIRED`:

```
ERROR programming.recovery_required error=artifact rejected: IR-E-007 artifact is not signed
```

Đây là **đường migration đã thiết kế của `T59-607`**, không phải hồi quy: artifact
đang nằm trên bo được đóng gói TRƯỚC khi bật `SIGNATURE_REQUIRED`, nên loader mới
từ chối nó và mọi Commission trả `IPC-RECOVERY-REQUIRED`. Xử lý đúng bài:

```
POST /api/v1/programming/runtime/recovery-reset  → {"applied":true}
```

rồi Commission lại bằng artifact mới (compiler/packager trên bo đã là bản mới nên
gói sinh ra có chữ ký hợp lệ).

## 4. Kiểm chứng mức TARGET

Năm service `active`: `mkddc-fakemcu`, `mkddc-iobus`, `mkddc-core`, `mkddc-netcfg`,
`mkddc-web-pi`. `GET /api/v1/health` → `core/io_shm/iobus/mcu_connection/plc_shm/web`
đều `ok`.

**Commission 10 Program chạy được trên bo** (lần đầu trên bo này): fixture soak
`SOAK-10P` đi hết Draft → Seal → Check `PASSED` → Commission `SUCCEEDED/COMMITTED`.
`GET /programming/runtime` → `producerState: READY`, `taskState: RUNNING`.
Bảng Programs trả `runtimeStateSource: CORE_LIVE` với `lastRunAtUtc`/`health`
thật — tức **nhánh (a) của mốc M2 mà `T60-303` còn treo nay đã có số đo**.

**`F-P59-ENABLE-BOUNDARY-001` — đo trên bo.** Sáu lượt Disable/Enable liên tiếp
qua `PUT /programs/{id}/runtime-intent`:

| Vòng | Lệnh | Trạng thái trả về | Thời gian |
|---|---|---|---|
| 1 | Disable | `DISABLED` | 918 ms |
| 1 | Enable | `RUNNING` | 944 ms |
| 2 | Disable | `DISABLED` | 959 ms |
| 2 | Enable | `RUNNING` | 955 ms |
| 3 | Disable | `DISABLED` | 935 ms |
| 3 | Enable | `RUNNING` | 956 ms |

6/6 `APPLIED`, **0 `Busy`/timeout**. Mỗi lệnh tốn đúng khoảng một base step (1 s)
— đúng như thiết kế safe boundary dự đoán, và mốc chờ 1500 ms còn dư ~55 % so với
giá trị đo được lớn nhất (959 ms). 10/10 Program bật được, `overrunCount = 0`,
`maxExecNs = 45 503` với 10 Program cùng chạy.

**`F-P59-MONITOR-VARS-001` — đo trên bo.** Thêm một Binding `LOCAL:UI-01` vào
Program `SOAK_07` của chính Project đang Active, Commission lại rồi đọc Monitor:

```json
{"variableName":"SupplyTemp","point":{"category":"LOCAL","pointId":"UI-01"},
 "direction":"READ","unit":"degC","actualValue":25.138254165649414,
 "quality":"GOOD","freshness":"LIVE"}
```

Trước bản sửa, `items` rỗng với **mọi** Revision.

**Published Signal chạy thật trên bo**: `SOAK_SOURCE` và `SOAK_CONSUMED` đều
`valid=true`, `GOOD`, `FRESH`, `definitionState=MATCHED`, generation tăng đều —
producer → bus → consumer đi trọn trên target. Khi producer chưa bật, cả hai trả
`valid=false`/`BAD`/`UNAVAILABLE`/`value=null`, **không** dựng số 0 giả.

## 5. `F-P59-ROLLBACK-DB-001` — lỗi thật tìm thấy khi diễn tập rollback

Diễn tập rollback tầng web (binary + dist) theo đúng quy trình đang ghi trong hồ
sơ. Kết quả: **mkddc-web không khởi động lại được**:

```
init: mở Programming store: schema Programming mới hơn binary: version 12
mkddc-web-pi.service: Scheduled restart job, restart counter is at 7
```

Nguyên nhân: BE tự chạy migration khi khởi động (bản này thêm `0012`) và
**từ chối chạy** khi schema mới hơn binary — đúng fail-closed. Nhưng
`install.sh` chỉ chụp binary còn `rollback.sh` chỉ khôi phục binary, nên rollback
sau bất kỳ bản nào có migration đều để web tier chết. Bản đang chạy đã được khôi
phục ngay (service `active`, health `ok`) và hai script được sửa trong cùng
change-set: `install.sh` chụp thêm `programming-v1.sqlite` (+ `-wal`/`-shm`) vào
snapshot, `rollback.sh` khôi phục nó và giữ lại DB đang chạy ở `pre-rollback-*`;
khi snapshot không có DB thì in cảnh báo chỉ thẳng tới
`/data/config/programming/programming-backups`. `tests/integration/test_release_dryrun.py`
khoá cả hai chiều (đã kiểm chứng bằng cách gỡ bản vá — đỏ đúng hai chỗ).

Điểm may mắn cần ghi rõ: BE **đã** tự chụp DB trước mỗi migration
(`programming-v11-before-v12-1787566996538.sqlite` lúc 10:23), nên đường lùi của
chính lần nâng cấp này vẫn tồn tại — chỉ là script rollback không biết tới nó.

**Chưa chạy được**: diễn tập rollback ĐẦY ĐỦ (binary + dist + DB) trên bo. Thao
tác copy/khôi phục file DB trên bo bị chặn ở phiên này, nên phần kiểm chứng "quy
trình đã sửa chạy đúng trên target" còn thiếu. Cần: quyền chạy hai lệnh
`cp`/`install` lên `/data/config/programming/` trên bo (hoặc người trực chạy
`platform/packaging/rollback.sh` với snapshot có DB) — sau đó đọc lại
`systemctl is-active mkddc-web-pi` và `/api/v1/health`.

## 6. Ranh giới của bằng chứng này

- MCU là **FAKE**. Không có AO/DO vật lý, không watchdog MCU, không HIL.
- Khoá ký là **TEST** (bản lab/bench), `provenance.json` ghi đúng như vậy.
- Soak 24 h (`T59-702`) **chưa chạy**. Đây là deploy + read-back, không phải soak.
- `mkddc-hmi` không cross-build được (máy dev thiếu `libfreetype`/`libdrm` arm64);
  bản cũ trên bo giữ nguyên, ngoài phạm vi.
- Một ghi nhận cần quyết định sản phẩm (chưa sửa ở phiên này): Commission một
  Revision thuộc **Project khác** với Project đang Active bị chặn ở tầng impact —
  `GET /revisions/{active}/changes/{new}` trả `400` khi hai Revision khác Project,
  và Commission đòi `impactRef` tính từ baseline thật. Cách đi được hiện nay là
  Commission trong cùng Project. Cần chốt: đây là ràng buộc sản phẩm (một
  controller một Project) hay là thiếu một thông điệp lỗi nói rõ lý do.

## 7. Rollback (cập nhật theo bản sửa)

```bash
systemctl stop mkddc-web-pi mkddc-core mkddc-iobus mkddc-fakemcu
for b in mkddc-core mkddc-iobus mkddc-netcfg mkddc-fake-mcu mkddc-st-compile mkddc-st-package; do
  install -m 0755 /usr/sbin/$b.prev-plan59c-20260824T102150 /usr/sbin/$b
done
install -m 0755 /opt/mkddc-web/mkddc-web.prev-plan59c-20260824T102150 /opt/mkddc-web/mkddc-web
rm -rf /opt/mkddc-web/dist && cp -a /opt/mkddc-web/dist.prev-plan59c-20260824T102150 /opt/mkddc-web/dist
# BẮT BUỘC với bản này vì nó áp migration 0012:
install -m 0600 -o mkddc -g mkddc \
  /data/config/programming/programming-backups/programming-v11-before-v12-1787566996538.sqlite \
  /data/config/programming/programming-v1.sqlite
systemctl start mkddc-fakemcu mkddc-iobus mkddc-core mkddc-web-pi
```
