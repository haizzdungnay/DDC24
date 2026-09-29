# Sửa và kiểm trên bo lab: `restartPolicy: initial` cho Virtual Point `multistate` (Issue #832)

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-PROG-VP-MSV-RESTART-832-TARGET` |
| Phiên bản | 1.0 |
| Ngày | 2026-09-29 |
| Issue | [#832](https://github.com/Mekong-HCM/MK-DDC-24/issues/832), phát hiện trong [`EV-PROG-STARTUP-WAIT-827-TARGET`](2026-09-28-startup-input-wait-target.md) §4.2 |
| Bản sửa | commit `e32c1ec6` (`apps/web-api/internal/app/virtualpoint_restart.go`, hàm `sameVirtualPointValue`) |
| Trạng thái | **PASS.** Test host đỏ trên mã cũ, xanh sau bản sửa. Trên bo: web khởi động thì `DO16_MODE` 10 → 0, journal có dòng `restart policy`, `virtual_points.conf` được ghi lại. Restart web lần hai thì 0 điểm bị đặt lại và tệp không đổi. Program `RUNNING` ở chế độ OFF. **Sau lượt kiểm** (03:16–03:17Z), máy LAN `192.168.1.42` đã thay web, Core và FE bằng bản **không có** bản sửa #827 và #832. Lúc 03:18Z, bo không còn chạy bản sửa này và Program `FAULTED ST-RT-008` (§4.2) |
| Đích | `OK1126B-buildroot` (Forlinx OK1126B-S, RV1126B), truy cập qua WAN `mekong-fac.ddns.net:2223` (LAN `192.168.1.16` không tới được: `No route to host`) |
| Lớp bằng chứng | HOST (test Go) và TARGET (web, Core, bus Modbus thật). Không phải HIL, chưa đo điện tại tiếp điểm relay |

## 1. Bản sửa và test trên host

**Nguyên nhân gốc.** `sameVirtualPointValue` chỉ so theo số với các kiểu mà `virtualPointNumericSignalType` nhận (`integer`, `float`). Kiểu `multistate` rơi xuống nhánh so chuỗi. Ở đó `virtualPointText` trả `""` cho mọi giá trị số, nên 10 và 0 bị coi là bằng nhau và `applyRestartPolicyOnBoot` bỏ qua điểm.

**Cách sửa.** Nhánh so số áp dụng cho `virtualPointNumericSignalType(t) || virtualPointMultistate(t)`.
- **Không** sửa `virtualPointNumericSignalType`. Bốn nơi gọi còn lại (§5) cố ý loại `multistate`.
- Giữ luật "kiểu số mà một vế không đọc được thành số ⇒ khác nhau".
- Không bump `generation`, không đụng vòng đối chiếu.

| Test (`virtualpoint_limits_test.go`) | Mã cũ `101d1fdf` | Sau sửa `e32c1ec6` |
|---|---|---|
| `TestRestartPolicyInitialWorksOnMultistateSignalType`: VP multistate `value` 10, `initialValue` 0, `states` 0 OFF / 1 MANUAL / 10 AUTO | **FAIL**: `số điểm đặt lại = 0; muốn 1` | PASS: trả 1, `value` 0, `initialValue` giữ 0 |
| `TestRestartPolicyMultistateIsIdempotent`: đã bằng giá trị khởi tạo; chạy 2 lần, so nội dung và mtime tệp | PASS (chặn chiều ngược của bản sửa) | PASS: trả 0, tệp không đổi byte nào, mtime không đổi |
| `TestSameVirtualPointValueComparesMultistateAsNumber`, 8 ca | **FAIL 5/8**: `(10, 0)`, `(int64 10, json.Number "0")`, vế `struct{}`, `("AUTO","AUTO")`, `nil` đều bị coi là bằng nhau | PASS 8/8: `(10, 0)` false; `(3, 3.0)` true; vế không phải số, chuỗi và `nil` đều false |

Output thật: [`test-do-truoc-sua.txt`](fixtures/2026-09-29-vp-multistate-restart-832/test-do-truoc-sua.txt), và [`test-xanh-sau-sua.txt`](fixtures/2026-09-29-vp-multistate-restart-832/test-xanh-sau-sua.txt). Bản xanh có 13/13 test `TestRestartPolicy*`/`TestSameVirtualPointValue*`/`TestVirtualPointNumberReaders*` PASS, gồm các ca `integer`, `float`, `boolean`, `retain` và audit có sẵn.

**Cổng Go** (`apps/web-api`, go1.26.4):
- `go vet ./...`: exit 0.
- `go test ./... -count=1`: exit 0, **21 package `ok`**, 3 package không có test, 0 `FAIL`. Output: [`go-test-web-api.txt`](fixtures/2026-09-29-vp-multistate-restart-832/go-test-web-api.txt).

## 2. Deploy lên bo

Chỉ thay `mkddc-web`, tức cả ba unit dùng chung binary: `mkddc-web-pi`, `mkddc-reload-helper`, `mkddc-time-helper`. FE, Core, iobus và tool ST giữ nguyên. Tool ST trên bo có `profile_sha256=a4396636…`, trùng `ProfileSHA256` của web mới, nên không phải thay.

| Artifact | Trước | Sau |
|---|---|---|
| `mkddc-web` | `main@265f1a8b`, sha `1e0a8be8651989bd` | `e32c1ec6`, sha `cc5848d7e2632090`. Dựng từ bản clone thường: `vcs.revision=e32c1ec6…`, `vcs.modified=false` |
| `mkddc-core` / `mkddc-iobus` | `265f1a8b` `3799ff33…` / `4c49e78b` `d017f38a…` | không đổi |

Trình tự (UTC, 2026-09-29):
1. **03:08–03:09Z, chỉ đọc.** Health 6/6, Active `0c29f4f1…`, Program `RUNNING` 10 ms. VP2 `DO16_MODE` = 10 cả trong cấu hình lẫn live. `StsMode` 5 (AUTO đang ở bước STAGING), 1/16 relay đóng (`CK50804-DO1`). `virtual_points.conf` có mtime 2026-09-27 14:01:26Z. Chi tiết: [`bo-truoc-deploy.txt`](fixtures/2026-09-29-vp-multistate-restart-832/bo-truoc-deploy.txt).
2. **03:10:23Z.** Đọc Active và sha web ngay trước khi ghi, khớp mốc. Sao lưu ba file với hậu tố `.bak-20260929T030958Z`:
   - `/opt/mkddc-web/mkddc-web`;
   - `/usr/share/mkddc/artifact-manifest.json`;
   - `/data/config/virtual_points.conf`.

   Dừng 3 unit rồi thay binary.
3. **03:10:25Z.** Khởi động 3 unit. Cả ba `/proc/<MainPID>/exe` đều là `/opt/mkddc-web/mkddc-web` sha `cc5848d7e2632090`. Chi tiết: [`bo-deploy.txt`](fixtures/2026-09-29-vp-multistate-restart-832/bo-deploy.txt).
4. **`deploy-record`** ghi 1 mục (`mkddc-web`, commit `e32c1ec6`, `dirty=false`) và giữ 7 mục. `readback`: **11 kiểm, 2 lệch**. Cả hai lệch là `web-ui` và đã có sẵn trước lượt này (§4). Năm mục `mkddc-core`, `mkddc-iobus` và 3 unit web đều `OK`. Output: [`artifact-readback-truoc-deploy.json`](fixtures/2026-09-29-vp-multistate-restart-832/artifact-readback-truoc-deploy.json), [`artifact-readback-sau-deploy.json`](fixtures/2026-09-29-vp-multistate-restart-832/artifact-readback-sau-deploy.json).

## 3. Kết quả trên bo

| Kiểm | Kỳ vọng | Đo được | Kết quả |
|---|---|---|---|
| Journal lần khởi động 03:10:25Z | `INFO virtual-point restart policy: 1 điểm quay về giá trị khởi tạo` | Có đúng dòng đó. Kèm vết audit `user=system action=virtual-points.restart-policy result=applied remote=boot detail=items[VP2].value: 10 -> 0` | PASS |
| `GET /api/v1/virtual-points`, VP2 | `value` = 0 | `value` 0, `initialValue` 0, `restartPolicy` `initial`, `generation` **3** (không bump) | PASS |
| `virtual_points.conf` | mtime đổi | 2026-09-27 14:01:26Z → **2026-09-29 03:10:25Z**; 6 718 → 6 717 byte | PASS |
| Giá trị live (`GET /api/v1/points`, 03:11:17Z) | chế độ OFF | VP2 0, `DO16_STS_MODE` 0, `DO16_STS_ON` 0; 16 điểm DO của CK508-04/05: 0 đóng (trước: 1) | PASS |
| Restart `mkddc-web-pi` lần hai (03:11:52Z) | 0 điểm bị đặt lại | 0 dòng `restart policy`; tệp giữ mtime 03:10:25Z và sha `66e6c6b14b9a65a5` | PASS |
| Health, Programming, Program (03:11:17Z và 03:12:28Z) | 6/6, `READY`, `RUNNING` | health `ok` 6/6; `targetState` `READY`; Active `0c29f4f1…` không đổi; Program `a153aa91…` `RUNNING`, `faultCount` 0, `missedReleaseCount` 0, `waitingReason` null | PASS |

Chi tiết: [`bo-sau-deploy.txt`](fixtures/2026-09-29-vp-multistate-restart-832/bo-sau-deploy.txt), [`bo-restart-lan-2.txt`](fixtures/2026-09-29-vp-multistate-restart-832/bo-restart-lan-2.txt), [`journal-web.txt`](fixtures/2026-09-29-vp-multistate-restart-832/journal-web.txt).

Journal còn cho thấy lỗi xảy ra thêm **hai lần** trong sáng 2026-09-29, trước bản sửa. Web khởi động lúc 02:09:28Z và 02:40:13Z (không do lượt này) mà không có dòng `restart policy`, và `DO16_MODE` vẫn là 10. Tính cả bốn lần ngày 2026-09-28 trong Issue, lỗi đã bỏ qua `initial` sáu lần.

## 4. Lệch không thuộc lượt này (không ghi đè)

### 4.1 FE đã bị thay trước lượt này

`readback` trước và sau deploy đều báo `web-ui` lệch:
- `index.html` đang phục vụ có sha `08808e44bf99b1f2`;
- manifest ghi `3f77bcefc66e753c` (FE `main@265f1a8b`).

Tệp `/opt/mkddc-web/dist/index.html` bị thay lúc **2026-09-29 02:39:55Z**, 18 s trước lần restart web 02:40:13Z, và không đi kèm `deploy-record`. Đây là một lượt deploy FE song song, nhiều khả năng từ máy LAN `192.168.1.42`. Lượt này không đụng `dist` và không ghi manifest cho `web-ui`. Chủ lượt deploy FE đó cần tự chạy `deploy-record --artifact web-ui=…` để manifest khớp lại.

### 4.2 Lượt deploy song song sau khi kiểm xong (03:16–03:17Z)

Readback cuối lúc 03:18:05Z, chạy ngay trước khi mở PR, báo **11 kiểm, 6 lệch**. Journal và mtime cho thấy máy LAN `192.168.1.42` đã deploy ba thứ ngay sau lượt kiểm:

| Mốc (UTC) | Việc | Hệ quả |
|---|---|---|
| 03:16:18Z | Thay FE (`index.html` sha `2f578d5b…`) | `web-ui` lệch manifest |
| 03:16:50Z | Thay `/opt/mkddc-web/mkddc-web` (15,5 MB, sha `475f4a4f…`) và chỉ restart `mkddc-web-pi` | Web dựng từ `bb4931e7`, `vcs.modified=true`, nhánh `origin/feat/scheduler-calendar-interactions`. Nhánh này **không** chứa `265f1a8b` (#827) lẫn `e32c1ec6` (#832). `mkddc-reload-helper` và `mkddc-time-helper` vẫn chạy binary của lượt này, đã bị xoá khỏi đĩa (`STALE_EXE`) |
| 03:17:26Z | Thay `/usr/sbin/mkddc-core` (1,05 MB, sha `77a149e1…`) và restart Core | Core vào `safe_state` `no_ctrl=1`. Program `a153aa91…` `FAULTED ST-RT-008`, `faultCount` 1, Task `FAULT`: đúng triệu chứng #827 mà Core `265f1a8b` đã sửa |

Không ai chạy `deploy-record`, nên manifest vẫn ghi web `e32c1ec6` và Core `265f1a8b`. Lúc 03:18:09Z:
- `DO16_MODE` vẫn là 0, vì web cũ không đặt lại multistate;
- 0/16 relay đóng;
- health 6/6.

Lượt này **không** khôi phục gì: bản của họ là việc đang làm của người khác. Chi tiết: [`bo-deploy-song-song-0316Z.txt`](fixtures/2026-09-29-vp-multistate-restart-832/bo-deploy-song-song-0316Z.txt), [`artifact-readback-cuoi.json`](fixtures/2026-09-29-vp-multistate-restart-832/artifact-readback-cuoi.json).

Muốn bo lab quay lại bản đã kiểm, chủ bo có các nguồn sau:
- **Core `265f1a8b`:** bản sao lưu do chính lượt deploy song song tạo, `/usr/sbin/mkddc-core.bak`, sha `3799ff33…`, khớp mục `mkddc-core` trong manifest. Thư mục `/data/mkddc/deploy-backups/20260928T120830Z-main-265f1a8b/` giữ Core **cũ hơn** (`5868aabd…`), không dùng.
- **Web `e32c1ec6`:** trên bo không còn tệp nào, và `mkddc-web.bak-20260929T030958Z` là web `265f1a8b` cũ. Cách lấy lại:
  - dựng lại từ nhánh của PR bằng bản clone thường;
  - hoặc chép từ `/proc/<MainPID>/exe` của `mkddc-reload-helper` / `mkddc-time-helper`, chừng nào hai tiến trình này chưa restart.

Sau đó chạy `deploy-record` rồi `readback`, và Disable → Enable Program nếu vẫn `FAULTED`.

## 5. Rà chỗ tương tự

- `virtualPointText(` và `sameVirtualPointValue(`: chỉ được gọi trong `virtualpoint_restart.go`, và đã sửa.
- Vòng đối chiếu `virtualPointMatchesSlot` so số cho mọi kiểu không phải boolean, nên không dính lỗi này. Việc đẩy VP xuống Core lúc khởi động (`syncBoundVirtualPointsToCore`) đi qua chính hàm đó.
- Bốn nơi gọi `virtualPointNumericSignalType` còn lại đều **cố ý** loại `multistate`, nên không sửa:
  - `virtualpoint.go:661`: VP bind vào slot `AV` phải là `integer`/`float`. Multistate đi slot `MSV`.
  - `alarmsettingsapi.go:195` và `virtualpoint_alarms.go:39`: alarm ngưỡng cao/thấp chỉ dành cho đại lượng đo.
  - `virtualpoint_limits.go:80`: biên kỹ thuật min/max không có nghĩa với chỉ số state; lệnh ghi multistate đã có `checkVirtualPointState` kiểm.
- Các `switch` theo `signalType` khác đều đã có nhánh `multistate` riêng: `normalizeVirtualPointValue`, `defaultVirtualPointValue`, `dataType`, `vpPoolFor`, `virtualSignalTypeToIEC`, `virtualPointLoggableSignalType`.
- `reflect.DeepEqual` trong di trú tag (`pointtags.go:750`) so cả cấu hình, không so theo kiểu tín hiệu, nên nằm ngoài phạm vi.

## 6. Thay đổi hành vi vận hành và trạng thái để chủ bo chọn

- Từ bản này, **mỗi lần web hoặc bo khởi động**, `DO16_MODE` về 0 (OFF). `PRG_DO16_MODBUS` dừng vòng AUTO và 16 relay nhả. Đây đúng là cấu hình người dùng đã chọn (`restartPolicy: initial`, `GUIDE-PROG-ST-DO16-001` §5.3).
- Trạng thái lúc lượt này kết thúc kiểm (03:12:28Z; sau đó bo đã bị thay bản, xem §4.2):
  - `DO16_MODE` = 0 (OFF), 0/16 relay đóng;
  - Program `RUNNING` ở chế độ OFF, Active `0c29f4f1…` không đổi.

  Lượt này **không** đặt lại `DO16_MODE` = 10 và không sửa cấu hình VP nào. Chủ bo tự chọn chế độ.
- Muốn giữ AUTO qua mất điện thì đổi `DO16_MODE` sang "Giữ giá trị cuối" (`retain`). Khuyến nghị vẫn là OFF.

## 7. Chưa chạy (NOT RUN)

- **Reboot cả bo.** Không cần cho bản sửa này: `applyRestartPolicyOnBoot` chạy trong tiến trình web lúc khởi động, và reboot cũng đi qua đúng đường đó (T3 của `EV-PROG-STARTUP-WAIT-827-TARGET` cho thấy web khởi động lại cùng bo). Kiểm ở đây là hai lần khởi động web thật.
- **Đo điện tại tiếp điểm relay.** Kết quả relay ở đây là giá trị 16 điểm Modbus trong `GET /api/v1/points`.

## 8. Hoàn tác

```sh
systemctl stop mkddc-web-pi mkddc-reload-helper mkddc-time-helper
cp -p /opt/mkddc-web/mkddc-web.bak-20260929T030958Z /opt/mkddc-web/mkddc-web
cp -p /usr/share/mkddc/artifact-manifest.json.bak-20260929T030958Z /usr/share/mkddc/artifact-manifest.json
systemctl start mkddc-reload-helper mkddc-time-helper mkddc-web-pi
```

Bản cấu hình VP trước lượt này (`DO16_MODE` = 10) nằm ở `/data/config/virtual_points.conf.bak-20260929T030958Z`. Chỉ chép lại nếu chủ bo muốn. Web cũ vẫn giữ nguyên giá trị hiện có, kể cả 0.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-29 | Bản đầu: sửa `sameVirtualPointValue` (commit `e32c1ec6`), 3 test mới đỏ → xanh, `go test` 21 package `ok`; deploy `mkddc-web` lên bo lab. `DO16_MODE` 10 → 0 khi web khởi động, restart lần hai 0 điểm; Program `RUNNING` ở OFF; ghi lệch `web-ui` có sẵn (§4.1) và lượt deploy song song 03:16–03:17Z đưa web/Core/FE không có bản sửa #827/#832 lên bo, làm Program `FAULTED` (§4.2) |
