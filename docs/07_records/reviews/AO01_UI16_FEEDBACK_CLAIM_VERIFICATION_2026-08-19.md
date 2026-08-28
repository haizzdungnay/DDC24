# Kiểm chứng báo cáo "lỗi source code" về AO-01 / UI-16 — 2026-08-19

**Bối cảnh.** Một công cụ ngoài truy cập giao diện board tại
`http://mekong-fac.ddns.net:8082/`, quan sát kênh **AO-01 (Supply Fan Speed)** và
kết luận có hai lỗi mã nguồn. Tài liệu này đối chiếu từng cáo buộc với mã thật
trong repo và với board đang chạy.

**Kết luận ngắn:** cả hai cáo buộc **không đứng vững** — báo cáo đọc một ảnh
chụp mã đã cũ (`C:\Users\kimla\Downloads\ddc24-main`, trước `7be9bca` và
`259d160`). Nhưng đường truy vết dẫn tới **hai lỗi thật khác**, đã sửa trong
cùng phiên: `F-OUT-002` và `F-PRIO-001`.

---

## 1. Quan sát của báo cáo và ý nghĩa thật của các con số

| Ô trên màn hình | Báo cáo hiểu là | Thực tế |
|---|---|---|
| `Current Value = 6.1 V` | điện áp ngõ ra "đứng im" | `point.value` của AO-01, làm tròn 1 chữ số |
| `% open = 60.7 %` | phản hồi cảm biến/VFD, tức kênh UI-16 | **cùng một con số đó**, đổi sang %: `aoRawToPercent('0-10V', 6.07) = 60.7` |
| `Manual Output = 63 %` | đang Force ở 63 % | trường cấu hình `manualValue`, tồn tại độc lập với việc có force hay không |

**Số liệu sống lấy qua `/api/v1/points` (tài khoản `admin`, 2026-08-19):**

```
UI-16 | value=60.12 (unit percent) | raw=6.218 V
AO-01 | value=6.0665 V | raw=6.0653 V | forced=None
```

Hai điều chốt ngay từ đây: `forced=None` — AO-01 **không hề bị Force**; và UI-16
đang đọc 6,218 V trong khi AO-01 ra 6,067 V, lệch 0,15 V = 1,5 % toàn thang,
nằm gọn trong dao động ±2 % mà `fake_mcu` cộng vào. **Vòng feedback AO-01 → UI-16
đang chạy đúng**, đo trên thiết bị thật chứ không chỉ đọc mã.

Ô "% open" được tính hoàn toàn ở FE từ chính giá trị đọc về của AO
(`apps/web-ui/src/features/points/OutputsPage.tsx`, `aoRawToPercent(output.mode,
point.raw ?? point.value)`), **không** lấy từ UI-16. Vì vậy "6.1 V" và "60.7 %"
không phải hai số đo độc lập lệch nhau — chúng là một số, hai đơn vị.

**Dao động 60.6 ↔ 60.7 %** không phải nhiễu mô phỏng. Log Core trên board:

```
WARN  priority.conflict ao ch=0 level=5 old=6.071 new=6.059 (nguồn sau thắng)
```

`ch=0` là AO-01, `level=5` là `PRIO_LOCAL_LOGIC` — tức **chương trình điều khiển
đang lái AO-01**, không phải một force thủ công đang giữ. Force thủ công là
`PRIO_LOCAL_MANUAL` (mức 2), giá trị cố định và không trôi; nó cũng có TTL và
hết hạn (`scan_loop.cpp`, `AUDIT hmi_override_expired`). Con số nhích quanh
6,06–6,07 V là đầu ra vòng điều khiển, đúng như mong đợi.

## 2. Cáo buộc 1 — "fake_mcu không đọc `ao_raw`, chạy sin độc lập"

**Không đúng với mã hiện tại.** `tools/fake_mcu/fake_mcu.cpp`, `simulated_ui_raw()`:

```cpp
case 15: { /* UI-16 VFD Fan Speed Feedback — 0-10V, echo AO-01 */
    const double frac = std::clamp(ao_frac(st, 0) + 0.02 * std::sin(2.0 * t + 2.0), 0.0, 1.0);
    return raw_from_field_volts(frac * 10.0);
}
```

UI-16 echo đúng `st.ao_raw[0]`, cộng dao động ±2 % giả lập nhiễu cảm biến. Đoạn
`0.5 + 0.45 * std::sin(0.06 * t + i * 0.4)` mà báo cáo trích **đã bị thay** ở
commit `7be9bca` (2026-08-15, "fake_mcu mô phỏng AHU 16 kênh UI + 4 AO + 4 DO,
đóng vòng feedback theo lệnh"); truy vết bằng `git log -S "0.06 * t"`.

Board cũng **không** chạy bản cũ: `/usr/sbin/mkddc-fake-mcu` mốc **2026-08-17
08:15**, sau bản vá.

## 3. Cáo buộc 2 — "backend bỏ qua trường `units` của AO nên UI hiện V"

**Không đúng, và đường dẫn file trong báo cáo đã bị xoá từ lâu.**
`web/backend/points.go` biến mất ở `259d160` ("chuyển source sang bounded
modules"); file hiện tại là `apps/web-api/internal/app/points.go`.

`overlayPointMetadata()` gọi `addRows()` **giống hệt nhau cho UI, AO và DO** —
không có nhánh nào bỏ qua AO:

```go
addRows(ioCfg.UI, "UI")
addRows(ioCfg.AO, "AO")
addRows(ioCfg.DO, "DO")
```

Trường được đọc là `display_unit` — đây là **nhãn ghi đè ở mức điểm**, do API
`PATCH` point config ghi (`pointconfig.go`), không phải trường `units` của trang
Outputs. Hai trường này cố ý khác nhau.

Còn vì sao AO-01 hiện `V`: `io_config.conf` trên board đặt
`{"ch": 1, ..., "units": "volt"}` cho AO-01. Đó là **cấu hình của người dùng**,
không phải mã bỏ sót. AO-03 cùng file đặt `"units": "percent"`.

## 4. Lỗi thật tìm được trong lúc kiểm chứng

### `F-OUT-002` — số volt bị dán nhãn đơn vị kỹ thuật

Chính chỗ AO-03 nói trên mới là lỗi. Core chỉ lưu/đọc AO theo **tín hiệu thô
volt/mA**, còn `units` là **đơn vị kỹ thuật**. Trang Outputs ghép thẳng số của
Core với nhãn của cấu hình: AO-03 "Chilled Water Valve" (`0-10V`,
`units: percent`, dải 0-100) ra 4,5 V = 45 % nhưng màn hình hiện **"4,5 %"** —
sai 10 lần trên một lệnh mở van. Min/Max/Trung bình và đồ thị xu hướng cùng lỗi.
Trang Monitor thì dán cứng nhãn `V` cho mọi AO nên kênh `4-20mA` bị gọi là volt.

Đã sửa: `aoSignalToEngineering()` (nghịch đảo `previewAoSignal()`, cùng đường
cong với bảng "Xem trước tín hiệu ra") + `outputLiveDisplay()` dùng chung; ô
"Raw output" giữ nguyên volt/mA để đối chiếu đồng hồ đo; dải suy biến
(`minPv = maxPv`) hiện lại số thô thay vì bịa số. Nhãn AO ở Monitor lấy
`rawUnit` thật.

**Một cái bẫy trong chính bản vá, phát hiện nhờ cấu hình thật của board.**
Quy đổi máy móc theo `minPv`/`maxPv` là chưa đủ. Cấu hình thật:

| Kênh | `units` | `min_pv` | `max_pv` | `mode` |
|---|---|---|---|---|
| AO-01 Supply Fan Speed | `volt` | 0 | **100** | 0-10V |
| AO-02 Economizer Damper | `volt` | 0 | **100** | 0-10V |
| AO-03 Chilled Water Valve | `percent` | 0 | 100 | 0-10V |
| AO-04 Hot Water Valve | `volt` | 0 | **100** | 0-10V |

`units: volt` cộng `max_pv: 100` nghĩa là "0..100 volt" trên một ngõ ra 0-10V —
cấu hình **tự mâu thuẫn**. Quy đổi máy móc sẽ hiện "60,7 V" cho một ngõ ra
6,06 V: đúng theo đường cong đã khai, nhưng vô nghĩa về vật lý, và tệ hơn hiện
trạng cũ. Vì vậy bản vá thêm luật: **đơn vị kỹ thuật trùng đơn vị tín hiệu thì
không quy đổi** — giá trị kỹ thuật chính là điện áp/dòng trên đầu cực.

Kết quả trên số liệu sống của board:

| Kênh | `units` | Giá trị Core | Trước | Sau |
|---|---|---|---|---|
| AO-01 | `volt` | 6,059 V | `6.1 V` | `6.1 V` (giữ nguyên) |
| AO-02 | `volt` | 1,500 V | `1.5 V` | `1.5 V` (giữ nguyên) |
| AO-03 | `percent` | 2,517 V | `2.5 %` | **`25.2 %`** |
| AO-04 | `volt` | 0,000 V | `0.0 V` | `0.0 V` (giữ nguyên) |

**Còn một việc thuộc về dữ liệu, không thuộc về mã:** `units: volt` trên AO-01/
02/04 gần như chắc chắn là đặt nhầm — đây là lệnh tốc độ quạt và vị trí damper/
van, quy ước tự động hoá là `percent`. `min_pv`/`max_pv` là
`Min_Pres_Value`/`Max_Pres_Value` của đối tượng BACnet Analog Output
(`apps/iobus/application/config/iobus_config.hpp`), mặc định `max_pv = 10` cho
`volt`; cặp `volt` + `100` không khớp bất kỳ mặc định nào. Sửa cấu hình là quyết
định của chủ sở hữu thiết bị, không phải của agent.

### `F-PRIO-001` — cảnh báo `priority.conflict` nổ mỗi scan

Chính dòng log dùng làm bằng chứng ở §1 lại là một lỗi khác.
`PriorityResolver::set_ao()` cảnh báo khi `s.active && s.value != v`. Nhưng slot
giữ `active` qua nhiều scan (đúng thiết kế: nguồn phải `release` mới nhả), nên
**một** chương trình ghi giá trị biến thiên mỗi scan cũng bị báo "xung đột" mỗi
scan.

Số đo trên board trước khi vá (`journalctl -u mkddc-core --since today`):

| Kênh | Số dòng WARN trong ~11,5 giờ |
|---|---|
| `ao ch=0 level=5` | 42 235 |
| `ao ch=2 level=5` | 42 235 |
| `ao ch=1 level=5` | 12 235 |
| `do ch=1 level=5` | 768 |
| **Tổng** | **97 410** (~2,3 dòng/giây) |

Số đếm bằng nhau y hệt giữa các kênh là dấu hiệu "mỗi scan một dòng", không phải
tranh chấp thật. Hậu quả: nhiễu log lấp mất xung đột thật — đúng thứ mà log này
sinh ra để phát hiện — cộng một lần ghi `stderr` đồng bộ ngay trong vòng quét
realtime.

Đã sửa: thêm `PriorityResolver::begin_cycle()`, `scan_loop` gọi một lần mỗi scan
trước mọi nguồn ghi; chỉ cảnh báo khi hai lần ghi rơi vào **cùng một chu kỳ**
trọng tài. Caller không gọi `begin_cycle()` giữ nguyên hành vi cũ.

## 4b. Một khác biệt KHÔNG phải lỗi, để lần sau khỏi báo nhầm

Ba ô cạnh nhau lấy từ hai vùng nhớ chia sẻ khác nhau, chụp ở hai thời điểm khác
nhau:

- **"Giá trị hiện tại"** ← `point.value` (PLC SHM) = giá trị Core **đã phân xử
  xong và ra lệnh**;
- **"% mở"** và **"Raw output"** ← `point.raw` (IO SHM) = giá trị tầng IO **đọc
  ngược về**.

Trên một kênh đang chuyển động nhanh, hai nguồn này lệch nhau vài phần mười phần
trăm (đo được: AO-03 hiện `25.2 %` ở "Giá trị hiện tại" và `26.1 %` ở "% mở").
Đó là độ lệch lấy mẫu, không phải mâu thuẫn dữ liệu, và không có cách bố trí
hiển thị nào xoá được nó — chỉ có thể chọn ô nào thuộc nhóm nào. Cách bố trí
hiện tại là có chủ ý: một ô cho **lệnh**, hai ô cho **phản hồi**.

## 5. Kiểm chứng

| Hạng mục | Số đo |
|---|---|
| `ctest --test-dir build/fw --output-on-failure` (MODBUS+BACNET+HMI=ON, `--fresh`) | **1039/1039 pass** |
| `npx vitest --run --environment jsdom src` | **109 file / 1050 test pass** |
| `npm run lint`, `npm run build` | sạch |
| Board sau khi deploy core vá | `priority.conflict` = **0 dòng / 5 phút** (trước: ~140 dòng/phút), log thường vẫn chạy 643 dòng/5 phút |
| Board sau khi deploy `dist` (`npm run build:foxlinx`) | phục vụ `assets/index-Ccy01LAI.js`, sha256 khớp **từng byte** với bản build local (`5578d873…3d0926c`) |

Bản cũ được giữ lại để lùi: `/usr/sbin/mkddc-core.bak-20260819-preF-PRIO-001` và
`/opt/mkddc-web/dist.prev-fprio-20260819`.

## 6. Bài học cho lần sau

1. **Kiểm mã theo repo, không theo bản tải về.** Cả hai cáo buộc đều đến từ một
   snapshot cũ hơn hai lần tái cấu trúc. `git log -S` xác định chuyện đó trong
   vài giây.
2. **Không suy nhãn UI ra nguồn dữ liệu.** "% open" nghe như phản hồi cảm biến
   nhưng là số tính lại từ chính lệnh ra; đọc mã render trước khi kết luận.
3. **Hai con số trùng khớp sau khi đổi đơn vị thì không phải hai số đo.**
   6,1 V và 60,7 % là một.
4. **Bản vá phải thử trên cấu hình THẬT, không chỉ trên fixture.** Bản vá
   `F-OUT-002` đợt đầu đúng với AO-03 nhưng làm hỏng AO-01/02/04, và chỉ lộ ra
   khi đọc `io-bundle` thật của board. Fixture trong test thường là cấu hình
   sạch; thiết bị thật thì không.
