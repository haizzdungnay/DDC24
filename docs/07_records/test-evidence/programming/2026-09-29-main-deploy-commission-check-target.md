# Deploy `main` lên bo lab và điều tra Check/Commission thất bại (Issue #840, #839)

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-PROG-COMMISSION-CHECK-840-TARGET` |
| Phiên bản | 1.0 |
| Ngày | 2026-09-29 |
| Issue | [#840](https://github.com/Mekong-HCM/MK-DDC-24/issues/840) (Check chặn binding đầu ra theo chất lượng live), [#839](https://github.com/Mekong-HCM/MK-DDC-24/issues/839) (FE của `main@e1b2ac51` không dựng được) |
| Trạng thái | **Kết luận: lỗi do mã nguồn, không do người dùng.** Người dùng Check một revision giống hệt Active; Check FAILED vì validator áp cổng chất lượng live cho binding **đầu ra**, lệch `DDD-CTRL-PROG-001` §5. Yếu tố kích hoạt là Program `FAULTED` sau khi một Core không có bản sửa #827 được deploy lên bo. Sau khi deploy `main`, Program tự `RUNNING` và Check lại chính revision đó `PASSED`. Bản sửa validator đi kèm hồ sơ này, chưa lên bo |
| Đích | `OK1126B-buildroot` (Forlinx OK1126B-S, RV1126B), truy cập qua WAN `mekong-fac.ddns.net:2223` |
| Lớp bằng chứng | TARGET (Core, web, FE thật trên bo) cho chẩn đoán và deploy; HOST (test Go/Vitest) cho bản sửa. Không phải HIL |

## 1. Kết luận

| Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|
| Người dùng có sửa gì làm hỏng không? | **Không.** Revision `65b2b855…` (03:24:45Z) và `32ed8a6b…` (03:21:35Z) giống hệt Active `0c29f4f1…`: `changes: []`, mọi nhóm impact `NONE`. Người dùng chỉ bấm Kiểm tra | §3.2 |
| Vì sao Check FAILED? | Ba lỗi `PRG-ERR-MAP-003` / `PGM-MAP-QUALITY-001`, `field=binding.qualityPolicy`, rơi vào ba binding **ghi** của `PRG_DO16_MODBUS`: `MSV-02` (`DO16_STS_MODE`), `AV-06` (`DO16_STS_ON`), `AV-07` (`DO16_STS_TRIPS`). Ba VP này do chính Program sở hữu, nên về `BAD` khi Program không chạy | §3.1, §3.3 |
| Lỗi mã nguồn nằm ở đâu? | `ValidateBindingCandidate` (`binding_validation.go`) báo `ERROR` khi chất lượng live của điểm khác `GOOD` cho **mọi** chiều. `DDD-CTRL-PROG-001` §5 chỉ áp quality policy cho đầu vào; đầu ra chỉ cần Point writable và range/unit/rate hợp lệ. FE (`PortMappingPicker`, `mappingViewModel`) chép lại cùng luật | §4 |
| Vì sao Program FAULTED? | Lúc 03:17:26Z máy LAN `192.168.1.42` thay Core bằng bản không có #827 (`EV-PROG-VP-MSV-RESTART-832-TARGET` §4.2). Core restart ⇒ `FAULTED ST-RT-008`. Lỗi triển khai, không phải thao tác của người dùng Programming | §3.1 |
| Sau khi deploy `main` thì sao? | Program tự `RUNNING` (Core có #827), ba VP về `GOOD`. Check lại **chính** revision `65b2b855…`: `PASSED`, 0 diagnostic | §5 |

Cùng mẫu này đã xảy ra ngày 2026-09-28:
- 09:30:59Z và 09:31:25Z: Check FAILED với đúng ba lỗi đó, lúc Program FAULTED sau khi Core restart;
- 09:34Z: người dùng Disable → Enable;
- 09:38:14Z: Check PASSED.

Người dùng đã tự tìm ra cách né, nhưng cách đó chỉ dùng được khi Program còn Enable lại được.

## 2. Bản chạy trên bo

| Artifact | Trước (03:30Z) | Sau (03:37Z) |
|---|---|---|
| `mkddc-core` | sha `77a149e1…`, của lượt deploy song song, không có #827 | `main@e1b2ac51`, sha `64212e175e766ef2`, khoá **RELEASE** `2fb77aa42e7fe446`, `GLIBCXX` tối đa 3.4.29 |
| `mkddc-web` (3 unit) | `web-pi` `475f4a4f…` (`bb4931e7`, `modified=true`); hai helper `cc5848d7…` đã bị xoá khỏi đĩa | `main@e1b2ac51`, sha `3e1ae85b00497024`, `vcs.modified=false`, cả ba unit |
| FE | `index.html` `2f578d5b…` | commit `c6748e9d` (= `main` + bản sửa #839), `index.html` `876eb30779eb7b5b`; `VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release`, bundle budget PASS |
| `mkddc-iobus`, tool ST, sim-worker | `4c49e78b` / `4c49e78b` / `1602b2fd` | không đổi: `apps/iobus` không đổi từ `4c49e78b`, profile `a4396636…` trùng web |

FE lấy từ `c6748e9d` chứ không lấy thẳng từ `main`, vì `main@e1b2ac51` không dựng được FE (§6).

## 3. Chẩn đoán

### 3.1 Trạng thái trước deploy (03:30:19Z, chỉ đọc)

- Health 6/6, Active `0c29f4f1…`, Task `FAULT`.
- Program `a153aa91…` `FAULTED ST-RT-008`, `faultCount` 1, `lastRunAtUtc` null.
- Commission gần nhất là 2026-09-28 02:44Z (`SUCCEEDED`). Hôm nay không có Commission nào vì Check đã chặn trước.

Chi tiết: [`bo-truoc-deploy.txt`](fixtures/2026-09-29-main-deploy-commission-check-840/bo-truoc-deploy.txt).

### 3.2 Người dùng đã làm gì

Audit Programming (`actor=admin`):

| Mốc (UTC) | Thao tác | Kết quả |
|---|---|---|
| 2026-09-28 09:30:59 / 09:31:25 | Tạo revision + Check | FAILED ×2 |
| 2026-09-28 09:34:52 / 09:34:56 | Disable / Enable Program | OK |
| 2026-09-28 09:38:14 | Tạo revision + Check | **PASSED** |
| 2026-09-29 03:21:35 | Tạo revision `32ed8a6b…` + Check | FAILED |
| 2026-09-29 03:24:45 | Tạo revision `65b2b855…` + Check | FAILED |

`GET …/revisions/0c29f4f1…/changes/65b2b855…` trả `changes: []`, `stHunks: []`, `fbdChanges: []`, và mọi nhóm impact (`outputMappingChanges`, `virtualPointChanges`, `programSet`, …) đều `NONE`.

Chi tiết: [`check-that-bai-va-audit.txt`](fixtures/2026-09-29-main-deploy-commission-check-840/check-that-bai-va-audit.txt).

### 3.3 Diagnostic của các lần FAILED

Cả bốn lần FAILED đều có đúng ba lỗi sau, không lỗi nào khác:

| Binding | Điểm | VP | Chủ sở hữu | Chiều |
|---|---|---|---|---|
| `34962090…` | `MSV-02` | `DO16_STS_MODE` | `PROGRAM` | WRITE (`StsMode`) |
| `3cef0302…` | `AV-06` | `DO16_STS_ON` | `PROGRAM` | WRITE (`StsOnCount`) |
| `cb40b0fa…` | `AV-07` | `DO16_STS_TRIPS` | `PROGRAM` | WRITE (`StsTrips`) |

Năm binding đầu vào VP (`DO16_MODE`, …) cùng lúc đó vẫn `GOOD`, vì web đẩy chúng xuống Core, nên không bị báo. Lúc 03:18:09Z, `GET /api/v1/points` cho ba VP trên `quality=bad`. Sau khi Program chạy lại (03:37:30Z), cả ba về `good`.

## 4. Lỗi mã nguồn và bản sửa (Issue #840)

**Nguyên nhân gốc.** [`binding_validation.go`](../../../../apps/web-api/internal/programming/application/binding_validation.go), khối `qualityPolicy`: bản cũ kiểm `point.Quality != "GOOD"` cho mọi binding. Với binding ghi vào VP do chính Program sở hữu, chất lượng live của điểm là **hệ quả** của việc Program có đang ghi hay không. Program không chạy thì slot về BAD, và Check chặn Commission. Đó là vòng luẩn quẩn: muốn Commission để sửa một Program đang FAULT thì bị chặn chính vì nó đang FAULT.

Hành vi này lệch [`DDD-CTRL-PROG-001`](../../../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md) §5:
- đầu vào: "identity/type/direction khớp; quality policy";
- đầu ra: "Point writable, range/unit/rate valid".

FE chép cùng luật ở hai chỗ:
- `PortMappingPicker.tsx` bước 3, với chú thích "Backend yêu cầu GOOD";
- `mappingViewModel.ts` (`compatibilityFor` ⇒ `QUALITY_BLOCKED`).

Handoff FBD ngày 2026-09-16 đã gặp cùng hiện tượng với `DO-*` BAD nhưng chỉ né ở FE.

**Cách sửa.**
- BE: chỉ áp `PGM-MAP-QUALITY-001` khi chiều kỳ vọng là `READ`. Giá trị `qualityPolicy` vẫn kiểm cho mọi chiều (`PGM-MAP-QUALITY-POLICY-001`).
- FE: `PortMappingPicker` chỉ loại điểm không GOOD cho chân INPUT; `mappingViewModel` chỉ `QUALITY_BLOCKED` với biến không phải đầu ra.

**Test** (chạy trên `main@e1b2ac51` trước khi sửa, rồi sau khi sửa):

| Test | Trước sửa | Sau sửa |
|---|---|---|
| `TestCheckDoesNotFailWhenOutputTargetIsBad`: Check revision có binding ghi vào VP BAD | **FAIL** `Check FAILED chặn binding ghi vì đích BAD: … PGM-MAP-QUALITY-001 … VP-07` | PASS: qua cổng binding, gọi compiler |
| `TestBindingValidatorDoesNotGateOutputOnLiveTargetQuality`: WRITE vào BAD/UNCERTAIN/STALE/OFFLINE/UNKNOWN | **FAIL 5/5** | PASS 5/5; `qualityPolicy` lạ vẫn bị từ chối |
| `TestBindingValidatorStillGatesInputOnLiveQuality`: READ BAD/UNCERTAIN × REQUIRE_GOOD/ALLOW_UNCERTAIN | PASS 4/4 (chốt chặn) | PASS 4/4 |
| `TestBindingValidatorReturnsStableWarningBlockAndCanonicalOwner` | Sửa kỳ vọng: bản cũ khẳng định có `PGM-MAP-QUALITY-001` trên binding ghi, tức đóng băng hành vi lệch §5 | PASS: vẫn BLOCK vì trùng chủ đầu ra, có warning đơn vị, không có lỗi chất lượng |
| Vitest `checkPointEligibility — chất lượng live theo chiều` | **FAIL** 1/3 (`canMap: false` cho đầu ra BAD) | PASS 3/3 |
| Vitest `mappingViewModel` ca DO-02 BAD / DO-03 UNKNOWN đầu ra | **FAIL** (`QUALITY_BLOCKED`) | PASS: `SUPPORTED`; đầu vào BAD vẫn `QUALITY_BLOCKED` |

Bản sửa này **chưa lên bo**: bo đang chạy `main@e1b2ac51`. Nó lên bo sau khi PR được merge.

## 5. Deploy `main` và kiểm lại trên bo

1. **03:35:51Z.** Đọc Active ngay trước khi ghi (`0c29f4f1…`). Dừng 3 unit web.
2. Sao lưu bản đang chạy vào `/data/mkddc/deploy-backups/20260929T033521Z-main-e1b2ac51/`: `mkddc-web.prev`, `mkddc-core.prev`, `dist.prev.tgz`, `artifact-manifest.json.prev`, `virtual_points.conf.prev`. Lệnh sao lưu store Programming dùng đường dẫn cũ `/data/mkddc/state/programming` nên hỏng. Store thật nằm ở `/data/config/programming/programming-v1.sqlite`; deploy không ghi vào store. Đường dẫn trong `DEPLOY_FOXLINX.md` đã được sửa theo.
3. Cài web và FE, cài Core bằng `install`. Restart Core lúc 03:35:54Z, khởi động 3 unit web lúc 03:35:59Z. Journal: `core.st_public_key=RELEASE fingerprint=2fb77aa42e7fe446`, `INFO programming.toolchain ok`.
4. `deploy-record` lần đầu **từ chối** (exit 2) vì FE dựng lúc 03:34:12Z, trước commit HEAD 03:34:58Z. Dựng lại FE từ `c6748e9d` sạch: `index.html` `876eb307…`, so từng file với `dist` đã deploy thì giống hệt, nên không phải chép lại. Lần hai ghi 3 mục (`mkddc-core`, `mkddc-web`, `web-ui`, đều `dirty=false`) và giữ 5. `readback`: **11 kiểm, 0 lệch**.
5. **03:37:30Z.**
   - Health 6/6; Programming `READY`; Task `RUNNING` chu kỳ 10 ms.
   - Program `RUNNING`, `faultCount` 0, `waitingReason` null.
   - `MSV-02`/`AV-06`/`AV-07` `good`; `DO16_MODE` 0; 0/16 relay đóng.
   - Active không đổi.
6. **03:38:07Z.** Check lại **chính** revision `65b2b855…` (`POST …/revisions/65b2b855…/checks`, idempotency key mới): **`PASSED`, 0 diagnostic**. Active đọc trước và sau đều là `0c29f4f1…`. Lượt này không Commission: revision đó giống hệt Active, và việc Commission là của người dùng.

Chi tiết: [`bo-deploy.txt`](fixtures/2026-09-29-main-deploy-commission-check-840/bo-deploy.txt), [`bo-sau-deploy-va-check-lai.txt`](fixtures/2026-09-29-main-deploy-commission-check-840/bo-sau-deploy-va-check-lai.txt), [`artifact-readback-sau-deploy.json`](fixtures/2026-09-29-main-deploy-commission-check-840/artifact-readback-sau-deploy.json).

## 6. `main@e1b2ac51` không dựng được FE (Issue #839)

`npm run build:release` dừng ở `tsc`:

```
src/features/scheduler/shared.ts(37,32): error TS2304: Cannot find name 'SchedulePointKind'.
```

Commit `45e31285` (PR #838) dùng kiểu `SchedulePointKind` mà không import nó. Vitest chỉ transpile, không typecheck, nên 3591 test vẫn xanh. Commit `c6748e9d` thêm import; kiểm chứng:
- `tsc --noEmit` exit 0;
- vitest 278 file / 3591 test PASS;
- lint exit 0;
- `build:release` exit 0.

## 7. Chưa chạy (NOT RUN)

- **Bản sửa #840 trên bo:** chờ merge. Muốn kiểm trên bo, Disable Program (các VP đầu ra về BAD) rồi Check. Kỳ vọng `PASSED` với web mới, `FAILED` với web `e1b2ac51`.
- **Commission trên bo:** không làm, vì không có nội dung mới để Commission.
- **Đo điện tại tiếp điểm relay.**

## 8. Hoàn tác

Bản trước deploy nằm ở `/data/mkddc/deploy-backups/20260929T033521Z-main-e1b2ac51/`. Đó là bản của lượt deploy song song, **không có** #827/#832: khôi phục lại thì Program sẽ FAULTED sau lần restart Core kế tiếp. Nếu cần lùi, nên lùi về Core `265f1a8b` (còn ở `/usr/sbin/mkddc-core.bak`, sha `3799ff33…`). Sau đó chạy `deploy-record` và `readback`.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-29 | Bản đầu: deploy `main@e1b2ac51` (FE `c6748e9d`), readback 11/0; chẩn đoán Check FAILED là lỗi mã nguồn (#840) bị kích hoạt bởi Program FAULTED sau deploy song song; Check lại revision của người dùng `PASSED`; bản sửa validator + FE kèm test đỏ → xanh; #839 FE không dựng được |
