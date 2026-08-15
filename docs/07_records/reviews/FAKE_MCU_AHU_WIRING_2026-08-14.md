# Fake MCU — Bảng đấu nối AHU mô phỏng và hướng dẫn cấu hình ứng dụng

| Thuộc tính | Giá trị |
|---|---|
| ID | `FAKE-MCU-AHU-WIRING-2026-08-14` |
| Trạng thái | Đã sửa code + build + verify + **deploy Foxlinx thành công** (xem §6) |
| Ngày | 2026-08-14 |
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

## 2. Bảng đấu nối UI1–UI16 (đọc/cấu hình tại `/eng/inputs`, cần quyền admin)

Cột "SensorType" là giá trị bạn chọn trong dropdown Signal Type ở `/eng/inputs`
cho từng kênh (khớp `sensor_type_from_string()`,
`apps/iobus/domain/io/io_scaling.cpp:23-39`). Cột "scale_lo/scale_hi" chỉ áp
dụng cho kênh liên tục (0-10V/4-20mA) — kênh NTC/dry-contact bỏ trống các ô
này (không dùng tới).

| UI | Field device | SensorType | Dải field vật lý | scale_lo | scale_hi | invert | Point gợi ý |
|---|---|---|---|---:|---:|:---:|---|
| UI-01 | Supply Air Temp (SAT) | `NTC10K` | — (đọc trực tiếp °C) | — | — | — | `AHU.SAT` |
| UI-02 | Return Air Temp (RAT) | `NTC10K` | — | — | — | — | `AHU.RAT` |
| UI-03 | Outside Air Temp (OAT) | `NTC10K` | — | — | — | — | `AHU.OAT` |
| UI-04 | Mixed Air Temp (MAT) | `NTC10K` | — | — | — | — | `AHU.MAT` |
| UI-05 | Duct Static Pressure | `4-20mA` | 0–500 Pa | 0 | 500 | — | `AHU.DuctStaticPressure` |
| UI-06 | Supply Air Humidity | `0-10V` | 0–100 %RH | 0 | 100 | — | `AHU.SupplyHumidity` |
| UI-07 | Return Air CO2 | `0-10V` | 0–2000 ppm | 0 | 2000 | — | `AHU.ReturnCO2` |
| UI-08 | Economizer Damper Position Feedback | `0-10V` | 0–100 % | 0 | 100 | — | `AHU.DamperFeedback` |
| UI-09 | Filter Differential Pressure Switch | `dry-contact` | bool | — | — | false | `AHU.FilterDirtyAlarm` |
| UI-10 | **Freeze Stat** (SAFETY) | `dry-contact` | bool | — | — | false | `AHU.FreezeStatTrip` |
| UI-11 | **Duct Smoke Detector** (SAFETY) | `dry-contact` | bool | — | — | false | `AHU.SmokeDetectorTrip` |
| UI-12 | Supply Fan Status/Proof of Flow | `dry-contact` | bool | — | — | false | `AHU.FanStatus` |
| UI-13 | **High Duct Static Pressure Switch** (SAFETY) | `dry-contact` | bool | — | — | false | `AHU.HighStaticTrip` |
| UI-14 | Chilled Water Coil Leaving Temp | `NTC10K` | — | — | — | — | `AHU.ChwLeavingTemp` |
| UI-15 | Heating Valve Position Feedback | `0-10V` | 0–100 % | 0 | 100 | — | `AHU.HeatValveFeedback` |
| UI-16 | VFD Fan Speed Feedback | `0-10V` | 0–100 % | 0 | 100 | — | `AHU.FanSpeedFeedback` |

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

## 11. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-14 | Tạo bảng đấu nối AHU 16 kênh UI + 4 AO + 4 DO cho `tools/fake_mcu`; build/self-test/smoke-test/ctest PASS |
| 1.1 | 2026-08-14 | Xác nhận board Foxlinx còn dùng fake MCU (không phải MCU thật); deploy thành công qua `/usr/sbin/mkddc-fake-mcu`; phát hiện + sửa runbook 27 mục 7b/9 dùng alias/path cũ |
