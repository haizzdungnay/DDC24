# Bằng chứng triển khai Programming P5 đầy đủ lên Foxlinx

> **ID:** `EV-PROG-P5-507`
> **Task:** `TASK-PROG-507`
> **Ngày chạy:** 2026-08-13
> **Bo đích:** `SOM-DDC-24-foxlinx`, `aarch64`, Buildroot, Web/API `8081`
> **Source:** `9606906`, `6069de6`, `d9a8e3b`, `0f1526c`
> **Phạm vi:** dọn dung lượng, backup, deploy FE/BE/compiler/Core Programming,
> bật cờ vĩnh viễn, Check và Commission fixture không có output vật lý.

## 1. Phán quyết và giới hạn bằng chứng

`TASK-PROG-507` **DONE** theo DoD triển khai P5. Foxlinx đang chạy toàn bộ
đường `FE → Web API → mkddc-st-compile → Artifact → Core UDS`; cờ FE và BE đều
ON. Hai lượt Check trên target đạt `PASSED`. Một Commission fixture không có
`VAR_OUTPUT`, binding, RETAIN hoặc override đạt `SUCCEEDED`, sau đó Core
read-back đúng Revision active/LKG và Task `RUNNING`.

Đây là evidence kỹ thuật do implementation team tạo, không tự nâng thành Test
Result độc lập hoặc `RELEASE_READY`. Catalog V&V vẫn giữ verdict có reviewer
độc lập của nó; HIL power-cut, IOP timing, usability người thật và các scenario
khác chưa chạy không được suy diễn từ record này.

## 2. Dọn dung lượng trước deploy

Trước cleanup: `/dev/root` 13 GiB, dùng 2,5 GiB, còn 9,3 GiB (**22%**).
Journal systemd chiếm khoảng 1,2 GiB. Đã vacuum journal về khoảng 45 MiB và
xóa đúng các file tạm, backup trùng, binary/static cũ có thể tái tạo đã kiểm
đích trước; không xóa `/data/config`, dữ liệu vận hành hoặc bản đang chạy.

Sau cleanup và sau deploy cuối: dùng **1,2 GiB**, còn **11 GiB**, mức sử dụng
**10%**. Các mục bị xóa trên Buildroot không có thùng rác; khả năng phục hồi
được giữ bằng hai release rollback có checksum ở §3.

## 3. Backup và retention rollback

Hai mốc được giữ lại:

| Mốc | Dung lượng | Mục đích |
|---|---:|---|
| `/data/releases/20260813T111417Z-pre-programming-p5` | 18 MiB | Trước thay Web P5 |
| `/data/releases/20260813T120046Z-pre-programming-full` | 15 MiB | Trước compiler/Core/cờ ON |

`/data/releases/LATEST_BACKUP` trỏ tới
`20260813T120046Z-pre-programming-full`. Backup thứ hai chứa Core/unit, Web,
env secure mode `0600`, static, config và Programming state. Hash chính:

| Thành phần pre-full | SHA-256 |
|---|---|
| `mkddc-core` | `455c9fcc4bc882eb42be32ab6fda2284a875e26449dd267072b87b00e25fd4cd` |
| `mkddc-core.service` | `52dc753bdb51538a45f7e86f7d0d4bace6163ba17c5b95ff53fe26d28e3cfad5` |
| `mkddc-web` | `f65e053586a00c2bf4abef925e22b002fb74cf8e515d9f10b04279d1d8f8b6f1` |
| `dist.tar.gz` | `8ed6083f36c8aa33cc6d1afd477cbbf6f095238b96b59b70fce282f1f82d2dcc` |
| `config.tar.gz` | `067f000b9c524afe19d6f7a681005ad5a094100f1ed98f53e79def7106523788` |
| `programming-state.tar.gz` | `d5e68296b75952bf2d17e5c932fb3c8249409147c761fdd179f269b85e9d592f` |

Không ghi JWT secret vào hồ sơ. Khóa legacy dài 1 byte đã được xoay sang khóa
ngẫu nhiên 32 byte/base64 trước khi mở Programming; session Web cũ hết hạn theo
thiết kế.

## 4. Artifact và provenance cuối

Artifact ARM64 được build từ commit
`0f1526caca45af0aa8516a1c9d45effc674086d1`; CMake cấu hình Release với
Modbus/BACnet/HMI ON và build đúng target Core/compiler. Web build bằng
`GOOS=linux GOARCH=arm64 CGO_ENABLED=0`, `-trimpath`; FE build với
`VITE_PROGRAMMING_REV_A=1`.

| Artifact đang chạy | SHA-256 |
|---|---|
| `/usr/sbin/mkddc-core` | `112e9f4673ade20cd84c3fafa759d84ef1a48c96a355a323650325dca2fdc7e1` |
| `/usr/sbin/mkddc-st-compile` | `edf65c08a85f3a5d5fb2e6c367e48c27edb1412a6058e54cd2f54864ab473cd4` |
| `/opt/mkddc-web/mkddc-web` | `760f587696cf9e4ab272a9f2d3e6608a5701c47284cea84299215558e6cc126f` |
| `/opt/mkddc-web/dist/index.html` | `c43e151461389d0a6a5fcd92218b362b8ae1eb18dc7963c9b48761647707d92f` |

Read-back target:

- Core: version `0.1.0`, commit `0f1526c`, GNU `13.3.0`;
- compiler: `fwsom-st-1.2.0`, profile `revA-1t-1-5-30`, schema `1`, ABI
  `3841`;
- Web: version `0.1.0`, commit `0f1526c`, runtime `go1.26.4`.

Compiler preflight trên board biên dịch sandbox mẫu AHU chuẩn thành artifact
1.760 byte trước khi cài service.

## 5. Finding runtime và cách đóng

| ID | Triệu chứng | Nguyên nhân gốc | Cách đóng / bằng chứng |
|---|---|---|---|
| `P5-507-F01` | Programming làm Web fail startup | `JWT_SECRET` legacy dài 1 byte, không đủ cho cursor/store | Xoay khóa 32 byte, env `root:root 0600`; service/health phục hồi trước bước tiếp |
| `P5-507-F02` | Vite WS monitor trả 403 | proxy đổi Host nhưng giữ Origin của Vite | `9606906`: route WS cụ thể + `rewriteWsOrigin`; handshake target `101` |
| `P5-507-F03` | Check trả `400 PRG-ERR-REQ-001` | FE gửi profile nội bộ thay vì tên public | `6069de6`: gửi `MK-DDC-24-REV-A` + test body |
| `P5-507-F04` | Check lần hai trả 409 dù ETag mới | FE không có Revision nền sau seal | `d9a8e3b`: `ProgrammingProject.baseRevisionId` + test HTTP/Vitest; target tạo Revision/Check lần hai |
| `P5-507-F05` | Check cũ terminal `ST-WORKER-CRASH` | target chưa có compiler | Cross-build/cài `/usr/sbin/mkddc-st-compile`; hai Check target sau cài đều `PASSED` |
| `P5-507-F06` | Core mới abort; rollback Core cũ cũng fail boot | Web từng marshal nil slice thành `ao/do: null`, trái schema array của Core | Chuẩn hóa data target `null → []`, ghi lại bundle qua API thành revision 2/checksum đồng bộ; `0f1526c` buộc Web persist `[]` và Core compatibility-shim `null` cũ về default an toàn; 14/14 C++ + Go HTTP regression PASS |

Lần probe Web đầu dùng `curl` nhưng Buildroot không cài công cụ này; rollback tự
động hoạt động. Probe được đổi sang BusyBox `wget` và API qua SSH tunnel. Đây
không phải lỗi binary.

## 6. Kiểm chứng tự động trước deploy

| Gate | Kết quả đo trong phiên |
|---|---|
| C++ Release, Modbus/BACnet/HMI ON | **1003/1003 CTest PASS** |
| Core safe-state regression | **14/14 PASS** |
| Go | `go vet ./...` sạch; `go test ./... -count=1` PASS mọi package; regression IO bundle PASS |
| FE | **506/506 Vitest PASS**, lint sạch, build PASS; 25 OpenAPI operation đồng bộ |
| Programming Playwright | **4/4 PASS** desktop + mobile |
| Network QA Playwright | **1/1 PASS** |

Stack trace cố ý của `RouteErrorBoundary.test.tsx` và cảnh báo chunk Vite không
phải test fail; exit code của toàn bộ suite đạt.

## 7. Check và Commission thật trên Foxlinx

Fixture production `FOX-P5-FULL-CHECK` cố ý không có output vật lý:

```iecst
PROGRAM FOX_P5_FULL_CHECK
VAR
    Counter : INT;
END_VAR
    Counter := Counter + 1;
END_PROGRAM
```

### 7.1 Check qua API

- Project `ce9e8d8d-c06d-461b-8429-4056ac10e860`;
- Revision `1ab7cb9b-b3dc-4744-ab9c-7ac778bb9af7`;
- Check `c6ebfd9d-b729-4c70-910a-dd0e79f1728e`;
- terminal `PASSED`, attempt `1`, diagnostics `[]`;
- artifact `331c4126-93c6-4347-9fbc-e6be6b38031d`, 528 byte, SHA-256
  `33de72c3bfe9626f50f2ddf3763991bf0fd31df1bb5d1609d45f91b6c6965984`,
  ABI `3841`, compiler `fwsom-st-1.2.0`.

### 7.2 Commission có read-back

Impact trước lệnh: `retain=NONE`, `activeOverrides=NONE`,
`outputMappingChanges=NONE`; chỉ `cutover=PRESENT` với
`GRAPH_ONLY→PROGRAM_ONLY`. Operation
`0df9f061-6235-43d0-91d8-cfd592482e48` chuyển
`QUEUED → VERIFYING/READ_BACK → SUCCEEDED/COMMITTED`.

Read-back Core:

- `activeRevisionId` và `lkgRevisionId` cùng bằng Revision trên;
- `producerState=READY`, `taskState=RUNNING`;
- `previousActiveRevisionId=null`, `keepsRunningRevision=true`.

Không có `VAR_OUTPUT`, binding, RETAIN hoặc override nên fixture không ghi AO/DO.

### 7.3 Check qua UI thật

Từ workspace Thiết kế, nút **Check** tạo Revision thứ hai
`75f9c520-a219-4f2c-8c06-b466831dbb97` (`201`), nhận Check
`a595fe28-41e5-4997-9114-620c1364d1d8` (`202`) và hiển thị
**“Check passed. The running version is unchanged.”** Trang Commission đọc
được kết quả `PASSED`, không có change/output impact và không có override.

## 8. Chrome DevTools trên Foxlinx

Đã kiểm trình duyệt thật qua SSH tunnel, không mock:

- desktop **1440×1000** và mobile viewport **390×844**;
- menu Programming hiện hữu; overview hiển thị Revision active, Core running,
  Task RUNNING và activity `CHECK_COMPLETE`/`OPERATION_COMPLETE`;
- Console desktop/mobile: **0 error, 0 warn, 0 issue**;
- Network Programming: create Revision `201`, create Check `202`, các GET
  project/capabilities/runtime/check/changes/overrides `200`; không có request
  Programming failed;
- ảnh: [desktop](foxlinx-p5-desktop-20260813.png),
  [mobile 390x844](foxlinx-p5-mobile-390x844-20260813.png).

## 9. Trạng thái cuối và rollback

| Read-back cuối | Kết quả |
|---|---|
| service | `mkddc-iobus`, `mkddc-core`, `mkddc-netcfg`, `mkddc-web-pi`: `active` |
| system API | `overall=ok`; IOP/core/iobus/web đều `ok`; scan overrun `0` |
| cờ BE | `/etc/mkddc-web.env`: `PROGRAMMING_REV_A=1`, file `root:root 0600` |
| cờ FE | bundle production build với `VITE_PROGRAMMING_REV_A=1`; menu/route hiện |
| API auth | unauthenticated capabilities `401`, authenticated `200` |
| capabilities | target `READY`, ST/FBD, period 1/5/30 s, đúng limits Rev A |
| Core UDS | `/run/mkddc/programming-v1.sock`, socket `mkddc:mkddc 0660` |
| filesystem | 13 GiB; dùng 1,2 GiB; còn 11 GiB; **10%** |

Rollback về pre-full, giữ nguyên config revision 2 đã chuẩn hóa:

```bash
BACKUP=/data/releases/20260813T120046Z-pre-programming-full
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
systemctl stop mkddc-web-pi mkddc-core
install -m 0755 "$BACKUP/mkddc-core" /usr/sbin/mkddc-core
install -m 0644 "$BACKUP/mkddc-core.service" /etc/systemd/system/mkddc-core.service
unlink /usr/sbin/mkddc-st-compile
install -m 0755 "$BACKUP/mkddc-web" /opt/mkddc-web/mkddc-web
install -m 0600 "$BACKUP/mkddc-web.env" /etc/mkddc-web.env
mv /opt/mkddc-web/dist "/opt/mkddc-web/dist.failed.$STAMP"
tar -C /opt/mkddc-web -xzf "$BACKUP/dist.tar.gz"
systemctl daemon-reload
systemctl start mkddc-core mkddc-web-pi
systemctl is-active mkddc-core mkddc-web-pi
```

Rollback trên làm tính năng Programming user-facing OFF và không khôi phục
`config.tar.gz` chứa `null` cũ. Chỉ restore config/state khi có kế hoạch migration
và read-back riêng; không được phục hồi env legacy có khóa yếu.
