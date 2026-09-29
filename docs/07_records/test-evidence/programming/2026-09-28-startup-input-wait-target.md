# Kiểm hành vi chờ đầu vào khi Core khởi động trên bo lab (Issue #827)

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-PROG-STARTUP-WAIT-827-TARGET` |
| Phiên bản | 1.1 |
| Ngày | 2026-09-28 (cập nhật 2026-09-29) |
| Issue | [#827](https://github.com/Mekong-HCM/MK-DDC-24/issues/827) (U-22 của [`REC-DDC-FIELD-USE-20260927`](../../reviews/DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md)), bản sửa PR [#831](https://github.com/Mekong-HCM/MK-DDC-24/pull/831); thiết kế `DDD-CTRL-PROG-001` v1.7 §5 ([`PROGRAMMING_CONTROL_SEMANTICS.md`](../../../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md)) |
| Trạng thái | **PASS phần trạng thái Program.** T1 3/3, T2 và T3: Program về `RUNNING` không cần thao tác tay, không lần nào FAULT, `faultCount` không tăng; nhãn "Chờ đầu vào" hiện trên UI thật. **Lệch kỳ vọng phần đầu ra:** DO Modbus giữ nguyên trạng thái cuối trong khoảng chờ, không về giá trị an toàn → Issue [#833](https://github.com/Mekong-HCM/MK-DDC-24/issues/833). **Lỗi phát hiện thêm:** `restartPolicy: initial` bị bỏ qua với VP `multistate` → Issue [#832](https://github.com/Mekong-HCM/MK-DDC-24/issues/832). T2b **NOT_RUN** (§3.3) |
| Đích | `OK1126B-buildroot` (Forlinx OK1126B-S, RV1126B), bus `rs485-1` 9600 8N1, CK508-04/05 |
| Lớp bằng chứng | TARGET: Core, web và bus Modbus thật; coil đọc về bằng FC01. Không phải HIL, chưa đo điện tại tiếp điểm relay |

## 1. Bản chạy trên bo

| Artifact | Commit | sha256 (16 ký tự đầu) | Ghi chú |
|---|---|---|---|
| `mkddc-core` | `main@265f1a8b` | `3799ff33b0fce94d` | khoá **RELEASE** `2fb77aa42e7fe446` (`--st-key-info`, và dòng `core.st_public_key=RELEASE` khi khởi động); `GLIBCXX` tối đa 3.4.29 |
| `mkddc-web` (+ `reload-helper`, `time-helper`) | `main@265f1a8b` | `1e0a8be8651989bd` | dựng từ bản clone thường: `vcs.revision=265f1a8b…`, `vcs.modified=false`, go1.26.4 |
| FE (`web-ui`) | `main@265f1a8b` | `3f77bcefc66e753c` | `VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release`, bundle budget PASS; chunk `programming` có chuỗi "Chờ đầu vào" |
| `mkddc-iobus` | `main@4c49e78b` | `d017f38a31fe9604` | không đổi (PR #831 không chạm iobus, `KX_SHM_MAGIC` không đổi) |
| `mkddc-programming-sim-worker` | `1602b2fd` | `60a300e4392c3898` | không đổi |
| `mkddc-st-compile` / `-package` / `-validate` | `main@4c49e78b` | `389c99ff…` / `939d5137…` / `f1c7501e…` | không đổi: profile `a4396636…` trùng với web mới, `INFO programming.toolchain ok` |

Trình tự deploy (12:08–12:18Z), theo `DEPLOY_FOXLINX.md`:

1. Sao lưu vào `/data/mkddc/deploy-backups/20260928T120830Z-main-265f1a8b/`: `mkddc-core`, `mkddc-web` cũ, `artifact-manifest.json`, `dist-thirdparty-0940Z.tgz` và `programming-store.tgz`. Store Programming được chụp khi web đã dừng; SQLite đã checkpoint nên không còn `-wal`.
2. Dừng web lúc 12:09:09Z, thay web và `dist`, rồi khởi động lại lúc 12:09:11Z. Cả ba unit chạy `/opt/mkddc-web/mkddc-web` sha `1e0a8be8…`.
3. Thay `mkddc-core` bằng `install`, rồi restart Core lúc 12:10:47Z trong khi web vẫn chạy. Lần restart này được ghi như một quan sát T1 bổ sung (§3.1).
4. `deploy-record` lúc 12:18:25Z ([`artifact-readback-sau-deploy.json`](fixtures/2026-09-28-startup-input-wait-827/artifact-readback-sau-deploy.json)): **ghi 3 mục** (`mkddc-core`, `mkddc-web`, `web-ui`; cả ba `dirty=false`), **giữ 5 mục**. `readback` ngay sau đó: **11 kiểm, 0 lệch**.

Trước lượt này, read-back báo 11 kiểm, 2 lệch, cả hai là `web-ui`. Lý do: một máy LAN `192.168.1.42` đã thay FE lúc 09:40:33Z (`index.html` `6b1c1d52…`), như `EV-PROG-TRACE-798-TARGET` §5.3 đã ghi. Lượt này **thay** FE đó bằng FE của `main@265f1a8b`, vì đề bài yêu cầu deploy FE có nhãn "Chờ đầu vào". Bản của họ được sao lưu nguyên vẹn trong `dist-thirdparty-0940Z.tgz` ở thư mục trên. Máy đó không đăng nhập SSH lần nào trong suốt lượt kiểm (lần cuối 09:40:34Z).

Sau deploy: health 6/6 `ok`, Programming `READY`, toolchain `ok`. Revision Active giữ `0c29f4f1…` (của người dùng), Draft r11 không bẩn, `PRG_DO16_MODBUS` `RUNNING` với chu kỳ 10 ms.

## 2. Cách đo

- **Program đang chạy:** `PRG_DO16_MODBUS`, AUTO, chu kỳ 10 ms, 8 đầu vào VP REQUIRED. AUTO không giữ bước qua lần khởi động, nên lệnh đầu tiên sau mỗi lần Core khởi động là bước OFF (FC15 "tất cả 0" cho cả hai module). Lượt đo **không** đổi Revision Active, không sửa VP, không Commission và không gửi `runtime-intent` nào.
- **Khi web đang chạy** — bộ lấy mẫu [`k827_sample.pl`](fixtures/2026-09-28-startup-input-wait-827/k827_sample.pl) chạy trên bo, chỉ gọi GET:
  - nhịp 200 ms (lần deploy: 500 ms): `GET …/projects/{id}/programs` (`runtimeState`, `coreState`, `waitingReason`, `faultCount`, `lastFaultCode`, `lastRunAtUtc`), `GET …/programming/runtime` (Active, `producerState`) và `GET /health`;
  - mỗi ~1 s: `GET /points`, lấy 16 coil (giá trị FC01 đọc về, kèm mốc mẫu của iobus);
  - mỗi 5 s: `GET /modbus/frames`, lấy mọi khung kèm giá trị ghi trên dây.
- **Khi web dừng hoặc bo vừa khởi động** — bộ lấy mẫu [`k827_direct.pl`](fixtures/2026-09-28-startup-input-wait-827/k827_direct.pl), nhịp 250 ms:
  - `point_snapshot` trên `/run/mkddc/core.sock` cho trạng thái Program **ở Core**;
  - vùng `ext[]` của `/dev/shm/mkddc_plc_shm` cho coil đọc về (ô `value`, tách khỏi ô `setpoint` là lệnh);
  - op `frames` trên `/run/mkddc/modbus-control.sock` cho khung Modbus.
- **Bộ phân tích:** [`k827_analyze.py`](fixtures/2026-09-28-startup-input-wait-827/k827_analyze.py) và [`k827_analyze_direct.py`](fixtures/2026-09-28-startup-input-wait-827/k827_analyze_direct.py), chạy trên dữ liệu thật. Kết quả từng lần là các file `ket-qua-*.txt` trong thư mục fixture. Script điều phối (đăng nhập, restart) không đưa vào repo vì chứa thông tin đăng nhập.
- **Định nghĩa mốc:**
  - "lệnh đầu của Program" là khung FC15 đầu tiên sau khoảng chờ, ghi sau lần chạy đầu ≤ ~100 ms;
  - "Core sẵn sàng" là lúc `systemctl restart` trả về, tức sau `READY=1`;
  - T3 dùng đồng hồ `CLOCK_MONOTONIC` từ lúc kernel khởi động, đối chiếu với `journalctl -o short-monotonic`.

## 3. Kết quả

### 3.1 T1 — chỉ restart Core, web vẫn chạy (PASS)

| Lần | t0 = lệnh restart (UTC) | Core sẵn sàng | `DISABLED` | `WAITING` + `INPUT_NOT_READY` | Web đẩy 9 VP | Lệnh đầu của Program | Mẫu `RUNNING` đầu | `faultCount` |
|---|---|---|---|---|---|---|---|---|
| T1-1 | 12:13:56.461 | +1,84 s | +1,97…+2,77 s (5 mẫu) | +3,08…+3,48 s (3 mẫu) | +3,43…+3,51 s | +3,58 s | +3,68 s | 0 → 0 |
| T1-2 | 12:15:15.034 | +1,80 s | +1,91…+2,31 s (3 mẫu) | +2,51…+4,77 s (11 mẫu) | +4,86…+4,94 s | +5,01 s | +4,97 s | 0 → 0 |
| T1-3 | 12:16:19.405 | +1,85 s | +2,00 s (1 mẫu) | +2,20…+10,51 s (38 mẫu) | +10,49…+10,57 s | +10,64 s | +10,83 s | 0 → 0 |

Nguồn: [`ket-qua-t1-1.txt`](fixtures/2026-09-28-startup-input-wait-827/ket-qua-t1-1.txt), [`ket-qua-t1-2.txt`](fixtures/2026-09-28-startup-input-wait-827/ket-qua-t1-2.txt), [`ket-qua-t1-3.txt`](fixtures/2026-09-28-startup-input-wait-827/ket-qua-t1-3.txt) (trạng thái, coil, khung); cột "Web đẩy 9 VP" lấy từ journal Core, [`trich-so-do-phu.txt`](fixtures/2026-09-28-startup-input-wait-827/trich-so-do-phu.txt) §1.

Tổng hợp ba lần (min / trung vị / max):

- **Lệnh restart → Program chạy lại:** 3,58 / 5,01 / 10,64 s.
- **Core sẵn sàng → Program chạy lại:** 1,74 / 3,22 / 8,79 s. Cả ba đều ≤ 10 s, đúng nhịp vòng đối chiếu VP.
- **Không thao tác tay, không FAULT.** `lastFaultCode` rỗng, `faultCount` giữ 0 ở cả ba lần.

Chuỗi trạng thái mỗi lần:

1. `UNKNOWN`: Core đang dừng/khởi động, check `core` của health không `ok` trong khoảng 1,6 s.
2. `DISABLED`: Core nạp Program ở trạng thái tắt; web phát lại intent Enable trước mẫu `WAITING` đầu tiên, tức trong vòng 0,34–1,25 s sau khi Core sẵn sàng (theo nhịp lấy mẫu 200 ms).
3. `WAITING` với `waitingReason = INPUT_NOT_READY`.
4. `RUNNING`.

Pha `WAITING` kết thúc đúng lúc vòng đối chiếu của web (mỗi 10 s, các mốc `…9,89 s` trong journal Core) đẩy 9 VP xuống (`user=virtual-point-sync`). Vì vậy độ dài pha chờ ngẫu nhiên trong khoảng 0–10 s.

**Quan sát bổ sung:**

- **Lần deploy** (12:10:47Z, Core `1602b2fd` → `265f1a8b`, lấy mẫu 500 ms): `UNKNOWN` → `DISABLED` → `RUNNING` ở +4,16 s. Không bắt được mẫu `WAITING` nào: journal Core ghi web đẩy VP trong cùng giây 12:10:49Z với lúc Core sẵn sàng (12:10:49,54Z), tức ≤ 0,46 s sau đó ([`ket-qua-deploy.txt`](fixtures/2026-09-28-startup-input-wait-827/ket-qua-deploy.txt), [`trich-so-do-phu.txt`](fixtures/2026-09-28-startup-input-wait-827/trich-so-do-phu.txt) §2). `faultCount` về 0 vì đây là đời Core mới.
- **Kiểm nhãn trên UI** (12:45:17Z, Chrome DevTools MCP, [`ui-cho-dau-vao.txt`](fixtures/2026-09-28-startup-input-wait-827/ui-cho-dau-vao.txt)):
  - trong lúc chờ, bảng "Chương trình đang vận hành" hiện **"Chờ đầu vào"** kèm dòng phụ "tự chạy khi đầu vào GOOD; lỗi sau 60 s";
  - lần làm mới kế (bảng poll mỗi 5 s) đã về "Đang chạy", VP được đẩy lúc 12:45:22,1Z; `faultCount` 0.
  - Trong lúc chờ, hai cột phụ hiện "Chưa đọc được từ Core" (chạy gần nhất) và "Máy chủ không gán nhãn cho trạng thái này" (sức khoẻ), vì REST trả `null` cho hai trường đó khi Program `WAITING`.

### 3.2 T2 — dừng web, restart Core, chờ 75 s, bật lại web (PASS phần trạng thái; DO lệch kỳ vọng)

Mốc t0 = 12:22:45.209Z (lệnh restart Core). Số liệu lấy thẳng từ Core ([`ket-qua-t2-core.txt`](fixtures/2026-09-28-startup-input-wait-827/ket-qua-t2-core.txt)):

| Khoảng | Trạng thái Program ở Core | Ghi chú |
|---|---|---|
| t0−5,0 s | web dừng (`systemctl stop mkddc-web-pi`) | Core cũ vẫn chạy Program — đúng, Core không cần web |
| t0 … +1,57 s | Core không trả lời (7 mẫu) | Core đang khởi động; sẵn sàng ở +1,67 s |
| +1,82 … +76,96 s | **`DISABLED`, `enabled=false`**, `waitingReason` rỗng, `faultCount` 0 (301 mẫu) | fail-closed có chủ ý (`load_active_checkpoint`): **không** `WAITING`, **không** FAULT dù đã quá 60 s |
| +76,68 s | `systemctl start mkddc-web-pi` | |
| **+77,21 s** | **`RUNNING`**, `faultCount` 0 | **0,53 s sau khi bật web**; lệnh đầu (FC15 toàn 0) ở +77,14 s |
| +87,4 s | web nhận đăng nhập (HTTP listen lúc 12:24:10Z, [`trich-so-do-phu.txt`](fixtures/2026-09-28-startup-input-wait-827/trich-so-do-phu.txt) §3) | REST 60 s sau đó: 257/257 mẫu `RUNNING`, `waitingReason` null, `faultCount` 0, health 6/6, Active không đổi ([`ket-qua-t2-rest.txt`](fixtures/2026-09-28-startup-input-wait-827/ket-qua-t2-rest.txt)) |

Web phát lại intent và đẩy VP ngay khi tiến trình khởi động, trước cả khi HTTP listen (~8 s sau: web khởi động 12:24:01,9Z, listen 12:24:10Z). Vì vậy ở mức Core không thấy `WAITING` nào ở nhịp 250 ms: Program đi thẳng `DISABLED` → `RUNNING`.

**Đầu ra lệch kỳ vọng "đầu ra ở safe state":**

- 4 relay `CK50804-DO1…DO4` do Core cũ đóng ngay trước restart (FC05 lúc t0−3,5 … t0−0,46 s, bước STAGGER của AUTO) **vẫn đóng suốt 75 s** Program `DISABLED`: 1 200 mẫu coil, **0 khung ghi**.
- Trong lúc đó Core báo `safeState=true`, `safeStateNoControllerOnly=true`.
- Relay chỉ nhả khi web lên và Program chạy lại, ở lệnh FC15 toàn 0.
- Không kênh nào bị đóng **mới** (0 chuyển 0→1).

Chi tiết và phương án xử lý ở §4.1.

### 3.3 T2b — ngưỡng 60 s trên bo (NOT_RUN)

Không có cách **không xâm lấn** để giữ một VP đã bind ở BAD ≥ 60 s trong lúc web vẫn chạy:

- vòng đối chiếu của web ghi lại VP mỗi 10 s ngay khi thấy slot không `GOOD`;
- muốn chặn nó thì phải dừng web, mà dừng web thì Core nạp Program ở `DISABLED` (§3.2), không phải `WAITING`;
- các cách còn lại (ghi đè chất lượng slot VP qua `core.sock`, tắt/bỏ bind VP, sửa cấu hình VP, Commission một gói thử) đều đổi dữ liệu vào hoặc cấu hình của Program người dùng, trái ràng buộc của lượt kiểm.

Ngưỡng 60 s được khoá bằng test host, **chạy lại trong lượt này** trên bản clone `265f1a8b`. Cấu hình `cmake --fresh … -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` (CFG_EXIT=0, BUILD_EXIT=0), `core_tests --gtest_filter='ProgrammingStartupInputWait.*'`: **8/8 PASS** (731 ms, lần chạy lưu ở [`trich-so-do-phu.txt`](fixtures/2026-09-28-startup-input-wait-827/trich-so-do-phu.txt) §6). Trong đó có:

- `MissingVirtualPointsFaultExactlyOnceAtSixtySeconds`;
- `RunningProgramHoldsLastUntilTtlThenFaultsAtThreshold`;
- `CommissionWhoseInputsNeverArriveRollsBackAtThreshold`.

### 3.4 T3 — khởi động lại cả bo (PASS phần trạng thái; chủ bo cho phép lúc 12:34Z)

Mốc 0 là lúc kernel khởi động (12:35:02.162Z). Lệnh `systemctl reboot` phát lúc 12:34:56.586Z. Nguồn: [`ket-qua-t3.txt`](fixtures/2026-09-28-startup-input-wait-827/ket-qua-t3.txt) và [`t3-moc-khoi-dong.txt`](fixtures/2026-09-28-startup-input-wait-827/t3-moc-khoi-dong.txt).

| Mốc (monotonic) | Sự kiện |
|---|---|
| 7,944 s | `Reached target Network is Online` |
| 7,993 s | `iobus.start`; khung FC01 đầu tiên ở 8,065 s |
| 8,131 s | sshd chạy |
| 9,395 s | `eth0: Link is Up - 1Gbps/Full` |
| 10,657 s | `core.ready` (Core `265f1a8b`) |
| 10,685 s | web khởi động; 11,086 s web đẩy VP xuống Core |
| **11,226 s** | **lệnh đầu của Program**: FC15 toàn 0, slave 4 (slave 5 ở 11,257 s) |
| 17,522 s | máy đo SSH vào được |
| 17,775 … 117,725 s | 400 mẫu trực tiếp: `RUNNING`, `enabled`, `faultCount` 0 |
| 19,953 s | web HTTP listen; 21,6 s đăng nhập được; REST 301/301 mẫu `RUNNING`, `waitingReason` null, health 6/6, Active không đổi ([`trich-so-do-phu.txt`](fixtures/2026-09-28-startup-input-wait-827/trich-so-do-phu.txt) §4) |

- **Từ lúc có mạng tới lúc Program chạy:** 3,28 s tính từ `Network is Online`, 1,83 s tính từ `eth0 Link is Up`. Tính từ `core.ready` là 0,57 s; từ lệnh reboot là 16,80 s. **Không thao tác tay.**
- **Trạng thái trung gian** (`DISABLED`/`WAITING` trước 11,2 s) **không lấy mẫu trực tiếp được**:
  - SSH chỉ vào được ở 17,5 s;
  - đặt bộ lấy mẫu chạy từ lúc khởi động (một unit systemd tạm) bị từ chối vì là cơ chế tồn tại qua reboot, nên unit đã gỡ **trước** khi reboot.

  Bằng chứng gián tiếp: `faultCount = 0` ở mẫu đầu 17,8 s (bộ đếm tính từ lúc Core khởi động) nên không có FAULT; lệnh đầu cách `core.ready` 0,57 s nên pha chờ ≤ 0,57 s.
- **DO:** lúc reboot có 8 relay `CK50804-DO1…DO8` đang đóng (mẫu coil 12:34:54Z).
  - Từ lúc iobus lên (8,07 s) tới lệnh đầu (11,23 s): **0 khung ghi**, nên không kênh nào bị đóng mới.
  - Relay giữ trạng thái qua cả lần reboot (module CK508 được cấp nguồn riêng), tới khi lệnh đầu FC15 toàn 0 nhả chúng.
  - Mẫu coil đầu tiên đọc được sau khởi động (17,06 s): 0 kênh đóng.
  - Trong khoảng 8,1–11,2 s không có giá trị coil: khung FC01 trong Frame Monitor không mang giá trị, còn SHM chỉ giữ mẫu mới nhất.
- `DO16_MODE` vẫn là 10 (AUTO) sau reboot, dù VP khai `restartPolicy: initial` với giá trị khởi tạo 0. Đây là lỗi #832 (§4.2): vì lỗi này Program tiếp tục AUTO như trước reboot, thay vì OFF như người dùng cấu hình.

### 3.5 DO trong khoảng chờ — tổng hợp

| Phép đo | Kênh đóng lúc Core dừng | Kênh đóng mới (0→1) trong khoảng chờ | Khung ghi trong khoảng chờ | Kênh giữ nguyên trạng thái cuối |
|---|---|---|---|---|
| T1-1 / T1-2 / T1-3 | 8 / 1¹ / 8 | 0 / 0 / 0 | 0 / 0 / 0 | có, 1,7 / — / 8,8 s tính từ lúc Core sẵn sàng |
| Lần deploy | 2 | 0 | không phủ được: vòng 200 khung ~27 s đã trôi | có, tới +4,16 s |
| T2 | 4 | 0 | 0 (75 s) | **có, 77 s** |
| T3 | 8 | 0 | 0 | có, 16,8 s tính từ lệnh reboot |

¹ T1-2: mẫu coil cuối trước t0 có `CK50805-DO8` đóng. Core cũ còn phát một khung ghi lúc t0−0,86 s; bộ lấy mẫu lúc đó chưa lưu giá trị ghi, nên không biết khung đó có nhả kênh này không. Mọi mẫu coil trong khoảng chờ đều 0 kênh đóng ([`ket-qua-t1-2.txt`](fixtures/2026-09-28-startup-input-wait-827/ket-qua-t1-2.txt)).

Tiêu chí "DO không đóng khi Program đang chờ lúc khởi động" **đạt**: không lần nào đóng mới một relay. Nhưng relay đang đóng thì **giữ nguyên**, không về "Giá trị an toàn" = 0 dù cả 16 điểm đã khai giá trị này → Issue #833.

### 3.6 Health, Programming READY và Active

- **Health 6/6:** trong T1, check `core` không `ok` ~1,6 s mỗi lần (Core đang khởi động; `producerState` `UNAVAILABLE` cùng khoảng), mọi mẫu khác 6/6. REST T2 257/257 và T3 301/301 mẫu đều 6/6.
- **Programming `READY`** (`capabilities.targetState`) ở cả ba lần kiểm: sau deploy, sau T2, sau reboot.
- **Revision Active** `0c29f4f1…` không đổi ở mọi mẫu và mọi lần đọc; Draft r11 không bẩn. **Không** phải Disable → Enable lần nào.
- **Cấu hình VP** (12 điểm) sau T2 trùng từng trường với ảnh chụp trước lượt đo.
- **Sau toàn bộ lượt** (12:46Z): `PRG_DO16_MODBUS` `RUNNING`/`HEALTHY`, `faultCount` 0; health 6/6; toolchain `ok`; `readback` sau reboot 11 kiểm, 0 lệch ([`artifact-readback-sau-reboot.json`](fixtures/2026-09-28-startup-input-wait-827/artifact-readback-sau-reboot.json)).
- **Task tính từ lần Core khởi động cuối** (12:45:19Z; [`trich-so-do-phu.txt`](fixtures/2026-09-28-startup-input-wait-827/trich-so-do-phu.txt) §5): 5 571 lần chạy, 0 lỡ release, 0 overrun, 0 lỡ base step, jitter tối đa 28 µs, 0 vi phạm.

## 4. Lỗi phát hiện trong lượt kiểm (mở Issue, chưa sửa — đề bài không sửa mã)

### 4.1 DO Modbus giữ trạng thái cuối khi Core khởi động lại — Issue [#833](https://github.com/Mekong-HCM/MK-DDC-24/issues/833)

- **Triệu chứng:** §3.2, §3.5.
- **Nguyên nhân (đọc mã):** lệnh Modbus chỉ đi qua cờ `plc_shm.ext[].dirty`, do graph hoặc Program publish đặt. `SafeState::apply` chỉ sửa đầu ra IO cục bộ; Core vừa khởi động chưa có proposal nào cho điểm EXT nên iobus không ghi gì và thiết bị giữ coil.
- **Lệch thiết kế:**
  - `DDD-CTRL-PROG-001` §5 ghi "Program chưa từng publish … AO/DO đứng ở safe state `no_ctrl` (T7)" — thực tế chỉ đúng với AO/DO cục bộ;
  - #384 (ma trận chính sách đầu ra) xếp dòng `Controller/Core Fault → hard Safe-State` vào nhóm "đã đúng", chưa đúng với EXT.

  UI thì đã nói thật: thẻ "Trạng thái an toàn" ghi "không xác nhận DO Modbus mở rộng đang tắt".
- **Cần quyết định của chủ sở hữu:** ghi `safe_value` khi Core khởi động, giữ có trần thời gian, hay giữ nguyên và sửa DDD/#384. Đã bình luận liên kết vào #384 và #830 (thân #830 viết "trong lúc đó đầu ra ở safe state").

### 4.2 `restartPolicy: initial` bị bỏ qua với VP `multistate` — Issue [#832](https://github.com/Mekong-HCM/MK-DDC-24/issues/832)

> **Cập nhật 2026-09-29 (sau hồ sơ này):** đã sửa ở commit `e32c1ec6` (`sameVirtualPointValue` so theo số cho `multistate`) và kiểm trên bo lab: `DO16_MODE` 10 → 0 khi web khởi động, restart lần hai không đặt lại gì — [`EV-PROG-VP-MSV-RESTART-832-TARGET`](2026-09-29-vp-multistate-restart-policy-target.md). Số đo dưới đây là của web `265f1a8b` (trước bản sửa) và giữ nguyên.

- **Triệu chứng:** `DO16_MODE` (multistate, `initial` = 0) vẫn là 10 sau **bốn** lần web khởi động trong ngày: 09:27Z, lúc deploy, trong T2, và lúc reboot bo. `virtual_points.conf` không bị ghi lại từ 2026-09-27; journal không có dòng `restart policy`. Hệ quả: sau mất điện, relay chạy AUTO thay vì đứng OFF như người dùng cấu hình.
- **Nguyên nhân:** `sameVirtualPointValue` chỉ so số cho `integer`/`float`. Với `multistate` nó rơi vào nhánh so chuỗi, nơi mọi giá trị số đều thành `""`, nên hàm coi 10 và 0 là "bằng nhau".
- **Tái hiện host:** test tạm (không commit) FAIL với `reset=0 value=10`; hai test sẵn có cho `integer`/`float` PASS trong cùng lượt.
- **Liên quan đo đạc:** vòng đối chiếu VP (`virtualPointMatchesSlot`) so bằng số nên không dính; T1/T2/T3 không bị ảnh hưởng.

## 5. Quan sát vận hành

- **Web khởi động là đường nhanh, restart Core riêng là đường chậm.**
  - Web phát lại intent và đẩy VP ngay lúc tiến trình khởi động, nên sau reboot hay sau khi bật web, Program chạy lại trong ~0,5 s kể từ khi Core và web cùng sẵn sàng.
  - Khi chỉ restart Core, web chờ tới vòng đối chiếu kế (≤ 10 s). Issue [#830](https://github.com/Mekong-HCM/MK-DDC-24/issues/830) (Q6) rút ngắn khoảng này; số đo T1 ở §3.1 là mốc "trước" cho #830, đã ghi vào Issue.
- **Tải phép đo:** bộ lấy mẫu gọi `point_snapshot` mỗi 250 ms. Khi web cũng đang gọi, Core chỉ nhận một lệnh mỗi chu kỳ quét, nên T2 có **1 lần** probe của phép đo bị `rejected`, ở +109,8 s khi web đã chạy. Không ảnh hưởng số đo trạng thái.
- **Lần restart Core:** mỗi lần làm Program ngừng 3,6–10,6 s (T2 ~77 s vì web dừng có chủ ý). Lượt kiểm có 6 lần: deploy, T1 ×3, T2 và kiểm UI; cộng một lần reboot. Chủ bo biết trước phạm vi này qua đề bài và câu hỏi T3.

## 6. Chưa chạy (NOT RUN)

- **T2b** (ngưỡng 60 s trên bo): không có cách không xâm lấn (§3.3); thay bằng test host 8/8 PASS chạy lại trong lượt.
- **Trạng thái trung gian của T3 trước 17,5 s** (§3.4): chỉ có bằng chứng gián tiếp.
- **Khung Modbus trong khoảng chờ của lần deploy:** bộ lấy mẫu khi ấy chưa kéo khung định kỳ.
- **Đo điện tại tiếp điểm relay:** kết quả là lệnh FC05/FC15 được ACK và coil đọc về bằng FC01.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.1 | 2026-09-29 | §4.2: ghi #832 đã sửa (commit `e32c1ec6`) và kiểm trên bo, trỏ tới `EV-PROG-VP-MSV-RESTART-832-TARGET`; số đo của lượt này không đổi |
| 1.0 | 2026-09-28 | Bản đầu: deploy `main@265f1a8b` (Core RELEASE, web, FE) lên bo lab; T1 ×3, T2, T3 PASS phần trạng thái Program, UI hiện "Chờ đầu vào"; T2b NOT_RUN; mở #833 (DO Modbus giữ trạng thái cuối) và #832 (`restartPolicy` multistate) |
