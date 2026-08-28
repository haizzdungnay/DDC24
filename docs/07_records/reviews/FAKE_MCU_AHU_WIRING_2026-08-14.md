# Fake MCU — Bảng đấu nối AHU mô phỏng và hướng dẫn cấu hình ứng dụng

| Thuộc tính | Giá trị |
|---|---|
| ID | `FAKE-MCU-AHU-WIRING-2026-08-14` |
| Trạng thái | v1.2 — thêm mô phỏng "thời tiết" + DI động, đã build/verify/**deploy Foxlinx lần 2** (xem §6) |
| Ngày | 2026-08-14, cập nhật 2026-08-17 |
| Phạm vi | `tools/fake_mcu/fake_mcu.cpp` — mô phỏng 16 kênh UI + phản hồi 4 kênh AO + 4 kênh DO như một AHU thật |
| Người đọc chính | Kỹ sư cấu hình Point/IO trong ứng dụng (`/eng/inputs`), kỹ sư viết Program AHU test |
| Không phải | Hồ sơ nghiệm thu/HIL; đây là công cụ dev/test, không thay thế field device thật |

## 1. Vì sao tài liệu này tồn tại

Fake MCU trước đây sinh giá trị 16 kênh UI gần như ngẫu nhiên (sin/ramp), một
vài kênh có tên gợi ý AHU nhưng không đủ, không nhất quán, và **không phản hồi
theo lệnh AO/DO** — không đủ để test trọn vòng một Program AHU thật (tạo ST →
map Point → Check → Commission → xem Runtime phản hồi đúng vật lý). Tài liệu
này mô tả bảng đấu nối mới và cách bạn cấu hình ứng dụng (`/eng/inputs`) để
đọc đúng 16 kênh này như các cảm biến/field device thật của một AHU.

**Cập nhật 2026-08-17 (v1.2)**: review `AHU-WIRING-UI-CONFIG-REVIEW-2026-08-17`
(xem §10) đo trực tiếp trên board và xác nhận đúng như thiết kế v1.1 —
**UI-05 đứng yên tuyệt đối** khi chưa có Program nào lệnh AO-01 (đúng vật lý:
không quạt chạy thì không có static pressure), và các kênh nhiệt độ chỉ dao
động rất chậm/biên độ nhỏ. Đúng như thiết kế, nhưng **cảm giác "chết" khi kỹ
sư automation mới mở trang Monitor mà chưa viết Program nào** — không đủ sống
động để làm công cụ học/thử ứng dụng lập trình DDC. v1.2 thêm mô phỏng "thời
tiết" (ngày/đêm + đợt nóng/mát nén vào vài phút thật) cho OAT/RAT/SAT/MAT/độ
ẩm/CO2, nhiễu cảm biến nhanh luôn hiện diện trên mọi kênh liên tục, và làm ba
tiếp điểm khô còn lại (Filter DP/Smoke/High Static) tự thay đổi thay vì đứng
yên vĩnh viễn — xem §5b.

## 2. Bảng đấu nối UI1–UI16 (đọc/cấu hình tại `/eng/inputs`, cần quyền admin)

Cột "SensorType" là giá trị bạn chọn trong dropdown Signal Type ở `/eng/inputs`
cho từng kênh (khớp `sensor_type_from_string()`,
`apps/iobus/domain/io/io_scaling.cpp:23-39`). Cột "scale_lo/scale_hi" chỉ áp
dụng cho kênh liên tục (0-10V/4-20mA) — kênh NTC/dry-contact bỏ trống các ô
này (không dùng tới).

| UI | Field device | SensorType | Dải field vật lý | scale_lo | scale_hi | invert | Point gợi ý | Động theo (v1.2) |
|---|---|---|---|---:|---:|:---:|---|---|
| UI-01 | Supply Air Temp (SAT) | `NTC10K` | — (đọc trực tiếp °C) | — | — | — | `AHU.SAT` | MAT − hiệu ứng lạnh AO-03, sàn 7°C |
| UI-02 | Return Air Temp (RAT) | `NTC10K` | — | — | — | — | `AHU.RAT` | thời tiết (OAT) + tải nội theo giờ có người |
| UI-03 | Outside Air Temp (OAT) | `NTC10K` | — | — | — | — | `AHU.OAT` | thời tiết: đợt nóng/mát + ngày/đêm + nhiễu nhanh |
| UI-04 | Mixed Air Temp (MAT) | `NTC10K` | — | — | — | — | `AHU.MAT` | trộn OAT/RAT theo AO-02 |
| UI-05 | Duct Static Pressure | `4-20mA` | 0–500 Pa | 0 | 500 | — | `AHU.DuctStaticPressure` | fan_frac² (AO-01) + nhiễu cảm biến luôn có |
| UI-06 | Supply Air Humidity | `0-10V` | 0–100 %RH | 0 | 100 | — | `AHU.SupplyHumidity` | nghịch chu kỳ ngày/đêm + nhiễu nhanh |
| UI-07 | Return Air CO2 | `0-10V` | 0–2000 ppm | 0 | 2000 | — | `AHU.ReturnCO2` | giờ có người (cùng hệ số với RAT) |
| UI-08 | Economizer Damper Position Feedback | `0-10V` | 0–100 % | 0 | 100 | — | `AHU.DamperFeedback` | echo AO-02 + rung nhỏ |
| UI-09 | Filter Differential Pressure Switch | `dry-contact` | bool | — | — | false | `AHU.FilterDirtyAlarm` | bẩn dần theo giờ quạt chạy, tự "thay lọc" (xem §5b) |
| UI-10 | **Freeze Stat** (SAFETY) | `dry-contact` | bool | — | — | false | `AHU.FreezeStatTrip` | trip khi MAT tính được < 3°C |
| UI-11 | **Duct Smoke Detector** (SAFETY) | `dry-contact` | bool | — | — | false | `AHU.SmokeDetectorTrip` | xung tự-kiểm-tra ~90s/lần (không phải cháy thật) |
| UI-12 | Supply Fan Status/Proof of Flow | `dry-contact` | bool | — | — | false | `AHU.FanStatus` | theo DO-01, trễ khởi động 2s |
| UI-13 | **High Duct Static Pressure Switch** (SAFETY) | `dry-contact` | bool | — | — | false | `AHU.HighStaticTrip` | trip khi lệnh quạt AO-01 > 92% |
| UI-14 | Chilled Water Coil Leaving Temp | `NTC10K` | — | — | — | — | `AHU.ChwLeavingTemp` | theo van AO-03 + nhiễu nhanh |
| UI-15 | Heating Valve Position Feedback | `0-10V` | 0–100 % | 0 | 100 | — | `AHU.HeatValveFeedback` | echo AO-04 + rung nhỏ |
| UI-16 | VFD Fan Speed Feedback | `0-10V` | 0–100 % | 0 | 100 | — | `AHU.FanSpeedFeedback` | echo AO-01 + rung nhỏ |

**Quy ước dry-contact** (áp dụng cho UI-09/10/11/12/13, `invert=false`):
giá trị `0`/`false` = an toàn/đóng/không hoạt động; `1`/`true` = trip-hở (đối
với 3 kênh SAFETY: UI-09/10/11/13) hoặc đang chạy (đối với UI-12 Fan Status,
đây là tiếp điểm xác nhận N.O. đóng khi quạt chạy, không phải kiểu fail-safe
NC như 4 kênh safety kia). Không cần bật `invert` cho kênh nào trong bảng.

## 3. Bảng AO1–AO4 (đọc/cấu hình cùng trang `/eng/inputs` hoặc trang AO tương ứng)

| AO | Điều khiển field device | Mode cần cấu hình | Dải | Điểm mà UI nào đọc phản hồi |
|---|---|---|---|---|
| AO-01 | Supply Fan Speed (VFD reference) | `0-10V` | 0–100 % | UI-16 (VFD Speed Feedback), gián tiếp UI-05 (DSP ∝ tốc độ²) |
| AO-02 | Economizer/Mixing Damper (modulating) | `0-10V` | 0–100 % mở | UI-08 (Damper Feedback), gián tiếp UI-04 (MAT trộn theo tỉ lệ) và UI-10 (Freeze Stat trip nếu MAT<3°C) |
| AO-03 | Chilled Water Valve (modulating) | `0-10V` | 0–100 % mở | UI-14 (CHW Leaving Temp = 7+valve%×6°C) |
| AO-04 | Hot Water Valve (modulating) | `0-10V` | 0–100 % mở | UI-15 (Heating Valve Feedback) |

## 4. Bảng DO1–DO4

| DO | Điều khiển field device | Điểm mà UI nào đọc phản hồi |
|---|---|---|
| DO-01 | Supply Fan Enable/Start | UI-12 (Fan Status) — chuyển `TRUE` sau **2 giây** kể từ lúc DO-01 bật, mô phỏng thời gian quạt lên vòng tua |
| DO-02 | Common Alarm/Fault Relay | Không có UI phản hồi (relay ra ngoài panel, fake MCU chỉ ACK lệnh) |
| DO-03/DO-04 | Dự phòng — chưa gán field device trong lần mô phỏng này | — |

## 5. Vòng feedback vật lý đã cài (không còn là hằng số độc lập)

```text
AO-01 (Fan Speed) ──► UI-16 (VFD Speed FB, echo trực tiếp)
                  └──► UI-05 (Duct Static Pressure = 4 + fan_frac² × 15 mA)

AO-02 (Damper)    ──► UI-08 (Damper FB, echo trực tiếp)
                  └──► UI-04 (MAT = OAT×damper_frac + RAT×(1-damper_frac))
                        └──► UI-10 (Freeze Stat trip nếu MAT tính được < 3°C)

AO-03 (CHW Valve) ──► UI-14 (CHW Leaving Temp = 7 + valve_frac × 6°C)
AO-04 (Heat Valve)──► UI-15 (Heat Valve FB, echo trực tiếp)
DO-01 (Fan Enable)──► UI-12 (Fan Status, trễ 2s)
```

Ý nghĩa thực tế: `F-PROG-ASBUILT-013` (binding→compiler) vừa được một phiên
khác trong cùng cây làm việc sửa xong cho category `LOCAL` (Binding Manifest,
`D-07` — xem `CHANGELOG.md` mục "Binding Manifest (D-07)", chưa commit tại
thời điểm viết báo cáo này) và đã target-verify trên chính board Foxlinx này
với Program `AHU_FanControl` thật. Với một Program AHU Commission thành công,
bạn có thể quan sát các kênh UI phản hồi ĐÚNG theo lệnh AO/DO trên trang
Runtime Monitor — đây là cách xác minh trực quan rằng đường `Point Mapping →
compiled artifact → Core → resolver->set_ao/set_do` thật sự có hiệu lực,
không chỉ Check PASSED trên giấy. Bảng đấu nối AHU 16 kênh trong tài liệu này
làm phong phú thêm đúng phép thử đó (trước đây chỉ có `SupplyTemp`/`FanSpeed`/
`FanEnable`/`AlarmHigh` trong fixture tối giản).

## 5b. Mô phỏng "thời tiết" và tiếp điểm khô tự động (v1.2, 2026-08-17)

**Mục tiêu**: kỹ sư automation mở trang Runtime Monitor/Trend lần đầu, **chưa
viết Program nào**, vẫn thấy số liệu sống — không cần đợi hàng giờ hay tự tay
gửi lệnh AO/DO mới thấy điều gì đó thay đổi.

**Mô hình thời tiết** (`sim_day_phase()`, `sim_weather_phase()`,
`sim_occupancy_frac()` trong `fake_mcu.cpp`): nén 1 "ngày" mô phỏng vào
**10 phút thật** (`SIM_DAY_PERIOD_S=600`), 1 "đợt thời tiết" (nóng/mát nhiều
ngày) vào **~50 phút thật** (`SIM_WEATHER_PERIOD_S=3000`). OAT dao động quanh
30°C: ±4°C theo đợt thời tiết, ±6°C theo ngày/đêm (đỉnh gần "trưa", đáy "nửa
đêm"), cộng nhiễu loạn lưu nhanh chu kỳ vài giây luôn hiện diện — số liệu vừa
có xu hướng "thời tiết" hợp lý trong một phiên làm việc, vừa **luôn nhìn thấy
chuyển động** ở độ phân giải giây. RAT bám nhẹ theo OAT (khối nhiệt tòa nhà
lọc bớt dao động) cộng tải nhiệt nội theo "giờ có người" (`sim_occupancy_frac`,
cao giữa "ngày", 0 lúc "đêm"). CO2 dùng chung hệ số giờ-có-người với RAT (400→
~1400 ppm) — mô phỏng đúng câu chuyện Demand Control Ventilation. Độ ẩm
nghịch chu kỳ với nhiệt độ (mát/ẩm ban đêm, nóng/khô giữa ngày).

**SAT giờ phản ánh đúng "chưa được điều khiển"**: `SAT = MAT − (van AO-03 ×
14°C)`, sàn 7°C. Khi chưa có Program nào mở van lạnh (AO-03=0%), SAT trôi theo
MAT — tức khí ra khỏi AHU **không được làm lạnh dù bao nhiêu nhiệt độ ngoài
trời**, đúng thực tế một AHU chưa có logic vận hành. Đây là tín hiệu trực quan
cho kỹ sư: "bạn cần viết Program điều khiển van thì SAT mới ổn định" — không
phải một baseline ổn định giả tạo như trước.

**Filter DP Switch (UI-09) — bẩn dần rồi tự "thay lọc"**: `mcu_tick()` tích
lũy tổng số giây DO-01 (Fan Enable) đang bật; sau **90 giây quạt chạy cộng
dồn** thì báo bẩn, giữ trạng thái bẩn **20 giây** rồi tự xóa tích lũy (mô
phỏng "đã thay lọc") và lặp lại chu kỳ — đủ để kỹ sư bật quạt và thấy alarm
xuất hiện rồi biến mất trong một phiên test ngắn, không phải đợi hàng tháng
vận hành thật.

**Duct Smoke Detector (UI-11) — xung tự-kiểm-tra định kỳ**: nhiều đầu báo
khói thật có tính năng tự-kiểm-tra định kỳ báo về BMS; mô phỏng bằng một xung
ngắn 3 giây mỗi 90 giây (`fmod(t, 90) < 3`), **không phải báo cháy thật kéo
dài** — đủ để kỹ sư thấy tín hiệu này "sống" và xem cách Program/HMI phản ứng
với một xung ngắn, không tạo cảm giác sai rằng luôn có sự cố cháy.

**High Duct Static Pressure Switch (UI-13) — phản ứng thật theo lệnh quạt**:
trip khi `fan_frac² > 0.92` tức AO-01 gần lệnh tối đa — bài học trực tiếp cho
kỹ sư: đừng lệnh quạt 100% vô điều kiện, chuỗi an toàn sẽ can thiệp.

**Freeze Stat (UI-10)** giữ nguyên logic v1.1 (trip khi MAT tính được < 3°C).
Với dải OAT mặc định (~19–41°C theo mô hình thời tiết), điều kiện này **hiếm
khi tự trip** trong vận hành bình thường — đúng thực tế khí hậu Việt Nam
(freeze protection tồn tại vì yêu cầu spec, nhưng gần như không bao giờ kích
hoạt tại công trình thực). Test chủ động bằng `--stuck-ui` (xem §8) hoặc buộc
damper mở cao đúng lúc OAT ở đáy dao động.

**Không đổi**: các kênh feedback (Damper/Heat Valve/VFD Speed FB) vẫn là echo
trực tiếp lệnh AO tương ứng — đứng yên khi chưa có lệnh là **đúng vật lý**
(actuator chưa nhận lệnh thì không di chuyển), chỉ thêm rung cảm biến nhỏ
(±2%) để không đứng yên tuyệt đối bit-for-bit.

## 6. Trạng thái build/test/deploy — hoàn tất

| Bước | Kết quả |
|---|---|
| Sửa `tools/fake_mcu/fake_mcu.cpp` | Xong — 16 kênh UI theo bảng §2, feedback AO/DO theo §5 |
| Build native (`build/fw/iobus/fake_mcu`) | PASS |
| `--self-test` | PASS (kiểm biên theo đúng SensorType từng kênh, cả trạng thái AO/DO nghỉ lẫn stress tối đa) |
| `iobus_tests` (275 test) | **275/275 PASS** — không hồi quy tầng giao thức IOP |
| Smoke-test thủ công qua PTY thật (HANDSHAKE→GET_IO→SET_AO→SET_DO→GET_IO) | PASS — MAT/DSP/DamperFB/CHW/HeatValveFB/VFDSpeedFB/FanStatus đều khớp công thức kỳ vọng |
| Build cross-compile aarch64 (`build/fw-aarch64/iobus/fake_mcu`) | PASS — `file` báo đúng `ELF ... ARM aarch64` |
| **Deploy lên Foxlinx** | **XONG — xem §6.1** |

### 6.1 Xác nhận và deploy thật trên board (2026-08-14)

Xác nhận trực tiếp qua SSH (`SOM-DDC-24-foxlinx`) trước khi cài đè: board
**vẫn đang dùng fake MCU**, chưa chuyển sang MCU thật —

```
mkddc-core.service     active running
mkddc-fakemcu.service  active running   ← xác nhận còn dùng fake MCU
mkddc-iobus.service    active running
mkddc-netcfg.service   active running
mkddc-web-pi.service   active running
/dev/ttyS2  crw-rw---- root dialout     ← có node nhưng không phải service nào đang mở (iobus dùng PTY)
```

(Evidence 2026-08-13 không liệt kê `mkddc-fakemcu` trong 2 báo cáo trước có
thể do lệnh liệt kê hôm đó chỉ lọc 4 service chính, không phải bằng chứng
board đã chuyển MCU thật — đã xác minh lại bằng lệnh trực tiếp thay vì suy
đoán từ tài liệu cũ.)

**Phát hiện khi deploy**: đường dẫn binary thật trên board là
**`/usr/sbin/mkddc-fake-mcu`** (owner `mkddc:mkddc`, chạy qua
`platform/systemd/mkddc-fakemcu.service`), **không phải**
`/usr/local/bin/mkddc-fakemcu` như runbook cũ ghi — runbook
(`27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md` mục 7b) còn dùng alias SSH và
đường dẫn build/install từ trước lần đổi tên board sang Foxlinx và trước
`PLAN-ARCH-RESTRUCT-002`. Đã sửa lại runbook theo đúng thực tế board (xem
mục 10).

Đã thực hiện:

```bash
scp build/fw-aarch64/iobus/fake_mcu SOM-DDC-24-foxlinx:/tmp/fake_mcu_new
ssh SOM-DDC-24-foxlinx "install -m 0755 /tmp/fake_mcu_new /usr/sbin/mkddc-fake-mcu && \
  rm -f /tmp/fake_mcu_new && systemctl restart mkddc-fakemcu && \
  systemctl is-active mkddc-fakemcu mkddc-iobus mkddc-core"
```

Kết quả: cả 3 service `active`; MD5 binary trên board khớp đúng binary vừa
build; journal khởi động sạch (`pty: /dev/pts/0` → `pty link created` →
`fake_mcu: running` → `RESET_IO reason=0x00 -> safe` → Core tự đồng bộ lại DO
về 0 sau restart, đúng hành vi thiết kế, không phải lỗi); health endpoint
`GET /api/v1/health` báo `io_shm/iobus/mcu_connection` đều `"ok"`. Log
`mkddc-core`/`mkddc-iobus` sau restart không có lỗi liên quan IOP/fake MCU
(chỉ có `WARN ext_snap.sequence_gap` — thuộc luồng Modbus TCP/EXT không liên
quan, đã có từ trước, không phải do thay đổi này).

`shm_dump_io` trên board báo `NOT READY (magic=... chưa init)` — không dùng
được để xác nhận nhanh (có thể lệch phiên bản struct SHM với binary
`mkddc-core`/`mkddc-iobus` hiện có trên board, chưa điều tra vì không cần
thiết cho việc verify deploy — `/api/v1/health` đã đủ bằng chứng độc lập).
Nếu cần dump SHM trực tiếp sau này, nên build `shm_dump_io` cùng lúc/cùng
commit với `mkddc-core`/`mkddc-iobus` đang chạy trên board.

### 6.2 Deploy lần 2 — v1.2 mô phỏng thời tiết + DI động (2026-08-17)

Trực tiếp theo yêu cầu ("UI phải động chứ") và khớp phát hiện độc lập của
`AHU-WIRING-UI-CONFIG-REVIEW-2026-08-17` (§10) — UI-05 đứng yên tuyệt đối
khi chưa có Program lệnh AO-01, đúng thiết kế v1.1 nhưng không đủ sống động.

Kiểm chứng trước deploy (cùng quy trình §6, lặp lại đầy đủ sau khi sửa công
thức):

| Bước | Kết quả |
|---|---|
| `--self-test` | PASS |
| `iobus_tests` (275 test) | **275/275 PASS** |
| Smoke-test PTY thật: 10 lần `GET_IO` cách nhau 1s, không có lệnh AO/DO | PASS — SAT/RAT/OAT/SAH/CO2 đổi rõ mỗi giây (nhiễu nhanh), Smoke tự-kiểm-tra đúng cửa sổ 3s đầu |
| Smoke-test PTY thật: `SET_AO`(fan 70%/damper 50%/chw 80%/heat 30%) → `SET_DO` fan ON → `GET_IO` | PASS — SAT=10.22°C (MAT 21.34 − 0.8×14, đúng công thức), DSP=11.38mA (khớp fan_frac²), damperFB/heatFB/vfdFB đều đúng % lệnh, Fan Status `TRUE` sau >2s, High Static còn `false` (dsp_frac=0.49 < 0.92 ngưỡng) |
| Build cross-compile aarch64 | PASS |
| Deploy board (`scp`+`install -m 0755 /usr/sbin/mkddc-fake-mcu`+`systemctl restart mkddc-fakemcu`) | MD5 khớp, 3 service `active`, journal khởi động sạch |

**Quan sát khi verify sau deploy**: `GET /api/v1/health` dao động
`ok`↔`degraded` (`core: fault, "process hoặc core socket không sẵn sàng"`)
qua nhiều lần gọi liên tiếp, trong khi `io_shm`/`iobus`/`mcu_connection` luôn
`ok` và `mkddc-core` (uptime 1 ngày 21 giờ tại thời điểm đó, log audit/jitter
hoàn toàn bình thường) **không hề bị restart bởi thao tác này**. Vì đường
IOP/fake-MCU (io_shm/iobus/mcu_connection) không hề dao động — chỉ đúng nhánh
socket riêng của `mkddc-core` health-probe — kết luận đây **không phải do
thay đổi `fake_mcu.cpp`**, khớp mẫu hình tranh chấp `WebIpc`/core-socket dưới
tải client đồng thời đã ghi nhận trước đó (`CHANGELOG.md` mục "503 ngắt quãng
... WebIpc::drain() chỉ chấp nhận đúng MỘT lệnh point_snapshot mỗi scan
cycle"), rất có thể trùng thời điểm phiên khác đang chạy test tải nặng trên
cùng board. **Không thuộc phạm vi sửa của tài liệu này** — ghi nhận để nhóm
Core/WebIpc biết, không tự sửa `apps/core`/`apps/web-api`.

## 7. Cách cấu hình ứng dụng để đọc đúng bảng này

**Cách khuyến nghị — qua Web UI**: đăng nhập admin, vào `/eng/inputs`, với
từng kênh UI1–UI16 chọn đúng SensorType/scale theo bảng §2 rồi lưu. Backend
(`PUT /api/v1/system/config/io-bundle`,
`apps/web-api/internal/app/io_bundle.go:37-161`) ghi atomically vào
`/data/config/io_config.conf`, tự gửi `SIGHUP` cho `mkddc-iobus`/`mkddc-core`
— **có hiệu lực ngay, không cần restart service**, và tự rollback nếu reload
lỗi.

**Cách thay thế — sửa file trực tiếp** (bring-up/debug), cấu trúc thật của
`/data/config/io_config.conf`:

```json
{
  "ui": [
    { "ch": 1,  "type": "NTC10K",       "unit": "degC",   "enabled": true },
    { "ch": 5,  "type": "4-20mA",       "unit": "Pa",     "enabled": true, "scale_lo": 0,   "scale_hi": 500  },
    { "ch": 6,  "type": "0-10V",        "unit": "percent","enabled": true, "scale_lo": 0,   "scale_hi": 100  },
    { "ch": 9,  "type": "dry-contact",  "unit": "bool",   "enabled": true, "invert": false }
  ],
  "ao": [
    { "ch": 1, "mode": "0-10V" },
    { "ch": 2, "mode": "0-10V" },
    { "ch": 3, "mode": "0-10V" },
    { "ch": 4, "mode": "0-10V" }
  ]
}
```

Sau khi sửa file tay, gửi lại `systemctl reload mkddc-iobus` (tương đương
`SIGHUP`) — mảng `ui[]` áp dụng ngay; đổi `ao.mode` cần **restart thật**
(`systemctl restart mkddc-iobus`) vì nằm trong danh sách field nguy hiểm mà
`reload_config_safe()` từ chối áp dụng nóng.

## 8. Cách ép kịch bản test bằng `--stuck-ui`

`fake_mcu --stuck-ui CH RAW` đóng băng kênh `CH` (đếm từ 0, tức UI-(CH+1)) ở
giá trị ADC thô `RAW`, bất kể thời gian/lệnh AO/DO. Giá trị mẫu đã tính sẵn:

| Mục đích | Lệnh |
|---|---|
| Ép Freeze Stat trip ngay (bỏ qua MAT) | `--stuck-ui 9 7549746` |
| Ép Smoke Detector báo cháy | `--stuck-ui 10 7549746` |
| Ép Filter báo bẩn | `--stuck-ui 8 7549746` |
| Ép High Static trip | `--stuck-ui 12 7549746` |
| Trả về an toàn (đóng/false) bất kỳ kênh dry-contact nào ở trên | `--stuck-ui <CH> 419430` |
| Ép SAT đọc 80°C (test quality BAD do OVER_RANGE, > 70°C) | `--stuck-ui 0 1278766` |

Kịch bản Freeze Stat "thật" (không dùng `--stuck-ui`, để hệ tự trip theo vật
lý): Commission một Program mở damper AO-02 ở mức cao (>50%) trong lúc OAT mô
phỏng đang ở đáy dao động lạnh nhất (~28°C mặc định — cần sửa `sim_oat_c()`
tạm thời nếu muốn test lạnh sâu hơn, vì dải mặc định 28–32°C không đủ lạnh để
tự trip theo thiết kế an toàn — đây là lựa chọn có chủ đích để tránh false
trip khi test bình thường).

## 9. Quan sát phụ (không sửa trong lần này — thuộc subsystem khác)

Trong lúc suy ra công thức `raw_from_ntc10k_temp()` để khớp chính xác
`ntc_resolve_temp()`/`ntc_resistance_from_adc()`
(`apps/iobus/domain/io/io_scaling.cpp:104-115`), phát hiện: với hằng số hiện
khai báo (`IO_NTC_VEXC_V=3.3V` > `IO_ADC_VREF_V=2.44V`, pull-up = R0 danh
định), điện áp tại chân ADC **bão hòa về ≥VREF ở nhiệt độ dưới ~+3°C** — thấp
hơn hẳn dải "hợp lệ" mà code khai báo (`-30..70°C`,
`io_scaling.cpp:163,246`). Vì `v_adc` luôn `< VEXC` (do bị giới hạn bởi chính
`VREF<VEXC`), điều kiện BAD hiện tại (`v_adc>=VEXC`) **không bao giờ kích
hoạt** ở đầu lạnh — nghĩa là một cảm biến NTC10K thật đọc dưới ~+3°C sẽ báo
sai một giá trị gần +3°C thay vì báo `BAD`/`OVER_RANGE` như kỳ vọng.

Đây **không phải lỗi của `fake_mcu`** (fake_mcu chỉ mirror đúng công thức có
sẵn) và tôi **không tự sửa** vì: (1) thuộc file khác (`io_scaling.cpp`, tầng
hardware calibration), (2) cách sửa đúng phụ thuộc giá trị `VEXC`/pull-up thật
trên PCB — tài liệu hardware hiện ghi rõ `IO_UI_CIRCUIT.md` Rev 2.5 "ready for
schematic review, **not yet PCB layout**", tức các hằng số này còn tạm/chưa
verify — sửa mù trong phần mềm có thể sai theo hướng khác. Mọi baseline nhiệt
độ trong bảng đấu nối AHU (§2) được chọn ≥5°C để không rơi vào vùng này; kênh
UI-10 Freeze Stat (an toàn) không bị ảnh hưởng vì logic trip so sánh trực tiếp
giá trị °C tính toán nội bộ, không đi qua round-trip ADC. Đề nghị hardware/
firmware owner xác nhận `VEXC`/pull-up thật khi PCB layout xong.

## 10. Tài liệu liên quan

- `docs/07_records/reviews/PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md` §4 —
  bối cảnh phát hiện `F-PROG-ASBUILT-013`, lý do cần một AHU mô phỏng đầy đủ
  để test end-to-end sau khi binding→compiler được sửa.
  `apps/iobus/domain/io/io_scaling.cpp` — công thức chuyển đổi raw↔eng thật mà
  `fake_mcu` mirror.
- `docs/04_design/hardware/03_io_subsystem/IO_UI_CIRCUIT.md` — giới hạn phần
  cứng Rev A cho từng SensorType.
- `apps/iobus/application/config/iobus_config.cpp`,
  `apps/web-api/internal/app/io_bundle.go` — cơ chế cấu hình/reload `/eng/inputs`.
- `docs/03_implementation/27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md` mục 7b/9 —
  runbook deploy fake MCU, đã sửa alias SSH (`SOM-DDC-24`→`SOM-DDC-24-foxlinx`)
  và đường dẫn binary/service (`/usr/local/bin/mkddc-fakemcu`→
  `/usr/sbin/mkddc-fake-mcu`, `packaging/`→`platform/`) khớp thực tế board
  trong lần deploy này. **Mục 2-6, 8, 9 (ngoài đoạn rollback fake MCU) của
  cùng file vẫn còn alias/path cũ, chưa được rà lại** — cần một lượt audit
  riêng nếu có ai dùng lại các mục đó.
- `docs/07_records/reviews/AHU_WIRING_UI_CONFIG_REVIEW_2026-08-17.md` — review
  độc lập verify bảng đấu nối này trên board thật bằng `GET /api/v1/points`,
  bác bỏ SIG-001/002 (không phải bug `io_scaling.cpp`), xác nhận `io-bundle`
  revision 17 trên board đã cấu hình đúng SensorType/tên cho toàn bộ 16 UI +
  AO + 4 DO theo đúng bảng §2-4 — không cần cấu hình lại qua `/eng/inputs` sau
  deploy v1.2 trừ khi `io_config.conf` bị reset.

## 11. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-14 | Tạo bảng đấu nối AHU 16 kênh UI + 4 AO + 4 DO cho `tools/fake_mcu`; build/self-test/smoke-test/ctest PASS |
| 1.1 | 2026-08-14 | Xác nhận board Foxlinx còn dùng fake MCU (không phải MCU thật); deploy thành công qua `/usr/sbin/mkddc-fake-mcu`; phát hiện + sửa runbook 27 mục 7b/9 dùng alias/path cũ |
| 1.2 | 2026-08-17 | Thêm mô phỏng "thời tiết" (ngày/đêm + đợt nóng/mát + nhiễu nhanh) cho OAT/RAT/SAT/MAT/độ ẩm/CO2; SAT phản ánh đúng "chưa được điều khiển" khi chưa có Program; Filter DP bẩn dần+tự reset, Smoke xung tự-kiểm-tra định kỳ, High Static phản ứng theo lệnh quạt — thay cho 3 tiếp điểm khô đứng yên vĩnh viễn ở v1.1; build/self-test/smoke-test/ctest PASS lại đầy đủ; deploy Foxlinx lần 2 |
