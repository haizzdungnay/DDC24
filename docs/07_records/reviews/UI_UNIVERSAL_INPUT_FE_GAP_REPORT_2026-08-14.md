# Báo cáo hiện trạng — Yêu cầu — Gap: Giao diện cấu hình Universal Input (UI) FE

| Thuộc tính | Giá trị |
|---|---|
| ID | `REV-UI-CFG-GAP-2026-08-14` |
| Phạm vi | Trang cấu hình ngõ vào vạn năng (Universal Input) `apps/web-ui/src/features/points/InputsPage.tsx` và các trang liên quan (Alarm, Historian/Trend, Commissioning) |
| Ngày | 2026-08-14 |
| Người thực hiện | Agent kỹ thuật, đọc trực tiếp source FE/BE/Core hiện có (không phỏng vấn, không chạy board) |
| Đối chiếu với | Đề xuất kiến trúc "Universal Input Configuration" 12 use case (`UC-UI-01..12`) + mô hình 5 lớp (Hardware Input → Electrical Mode → Sensor/Conversion → Canonical Point → Signal/Quality → Application Services) nêu trong hội thoại cùng ngày — **đây là đề xuất, chưa phải authority thiết kế đã duyệt** |
| Phán quyết | FE hiện tại là **bản mirror trực tiếp của thanh ghi firmware** (`u0..u7`, 9 `signalType` cố định), không phải mô hình phân lớp đã đề xuất. Đáp ứng **4/12 UC đầy đủ, 6/12 một phần, 2/12 chưa có**. Gap lớn nhất nằm ở tầng dữ liệu (Core/Go), không chỉ ở FE — xem §5 |
| Hành động | Chỉ báo cáo, **không sửa code** trong phiên này: đây là gap so với một đề xuất thiết kế chưa được PM/CTO duyệt, không phải bug trong phạm vi việc đang làm |

> **Cập nhật 2026-08-14 (Rev 1.1) — sau khi đọc thêm `docs/04_uiux/UX_REDESIGN_INPUT_BRIEF_2026-08-08.md`,
> `docs/02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md` §3 và `configapi.go:503-539`
> để chuẩn bị thiết kế lại UI/UX:**
>
> 1. **Backend đã giàu hơn báo cáo Rev 1.0 mô tả.** `validateConfigIO` chấp
>    nhận `type` ∈ `none|0-10V|2-10V|4-20mA|PT100|PT1000|NTC10k|NTC20k|dry|
>    potentiometer|light|pulse` (12 giá trị, không phải 9 `signalType` số) và
>    hai field `scale_lo`/`scale_hi` (số tuỳ ý, validate `hi > lo`) — nghĩa là
>    **UC-UI-03 (Sensor Profile: NTC10k vs NTC20k) và phần lõi của UC-UI-04
>    (scaling hai điểm) đã có sẵn trong contract, chỉ bị FE làm mất qua enum
>    `signalType` 9 giá trị của nó**, không phải giới hạn Core/firmware như
>    §5 kết luận trước đó. Việc này **có thể đóng chỉ bằng sửa FE**, không cần
>    đổi Go/Core.
> 2. **PT100/PT1000 không được thêm vào FE dù contract chấp nhận.** Đây là
>    quyết định phần cứng đã chốt, không phải thiếu sót: `ADR-010`, `FR-011`
>    (`SRS`), `HW-RISK-UI-16CH.md` (`UI-R008`) đều ghi rõ mạch RTD 2-wire mux
>    không đạt độ chính xác industrial nên **không lắp/không claim ở Rev A**;
>    contract giữ hai giá trị này chỉ để tương thích Rev B. Sensor Profile của
>    Rev A chỉ nên có **NTC10k / NTC20k** (cùng mạch beta-NTC, khác điện trở
>    pull-up — `SW_IODRIVER_DESIGN_MK-DDC-24_VI.md:63-64`).
> 3. **Bug thật tìm thấy và đã vá trong phiên này** (không chỉ ghi finding —
>    theo đúng quy tắc "làm hết việc"): vì FE luôn ghi lại **toàn bộ 16 kênh**
>    mỗi lần Save, hàm `aiConfigToIo()` cũ ghi cứng `type: 'NTC10k'` cho mọi
>    kênh nhóm resistance và chuỗi `unit` canonical cho mọi kênh — sửa MỘT
>    kênh bất kỳ rồi Save sẽ âm thầm hạ cấp `NTC20k`/`PT100`/`PT1000`/unit lạ
>    (`RPM`...) ở các kênh KHÁC về mặc định. Đã vá bằng round-trip không mất
>    dữ liệu (`ioType`/`ioUnit` passthrough) — xem CHANGELOG `[Unreleased]`
>    mục "Fixed" cùng ngày và `apps/web-ui/src/shared/api/client.ts`.
> 4. Thiết kế lại UI/UX theo các phát hiện này nằm ở
>    [`docs/04_uiux/UI_UNIVERSAL_INPUT_REDESIGN_2026-08-14.md`](../../04_uiux/UI_UNIVERSAL_INPUT_REDESIGN_2026-08-14.md);
>    plan implement ở
>    [`docs/03_implementation/55_UI_UNIVERSAL_INPUT_REDESIGN_PLAN.md`](../../03_implementation/55_UI_UNIVERSAL_INPUT_REDESIGN_PLAN.md).
>    Các mục §4/§5 dưới đây **giữ nguyên làm lịch sử** (đúng nội dung đã đọc
>    tại thời điểm Rev 1.0); đọc cùng bản cập nhật này để có kết luận đúng.

---

## 1. Tóm tắt

Trang `InputsPage.tsx` cấu hình 16 kênh `UI-01..UI-16` cố định, mỗi kênh có
đúng 8 field (`u0..u7`) ánh xạ 1:1 vào file cấu hình firmware
(`io_config.conf` qua route `GET/PUT /api/v1/system/config/io`, struct Go
`ConfigIO.UI []map[string]any` — **không có type riêng, chỉ pass-through**,
`apps/web-api/internal/app/dto.go:22-28`). Không có lớp trừu tượng nào giữa
thanh ghi firmware và UI: `signalType` gộp chung "loại điện" và "loại cảm
biến" vào một enum 9 giá trị, không có sensor profile, không có scaling hai
điểm tuỳ ý, không có calibration gain/2-point, không có cấu hình fault
detection.

Điều này **khác về bản chất** so với đề xuất 12 UC / 5 lớp: đề xuất giả định
một canonical Point tách biệt khỏi cấu hình điện của chân, còn hệ thống hiện
tại chỉ có duy nhất một cấu trúc phẳng theo đúng thanh ghi.

## 2. Yêu cầu đối chiếu (tóm tắt 12 UC đã đề xuất)

Xem nguyên văn ở tin nhắn trước trong hội thoại. Tóm lại: `UC-UI-01`
Channel ID, `02` Electrical Mode, `03` Sensor Profile, `04` Scaling, `05`
Engineering Unit, `06` Digital interpretation, `07` Signal conditioning
(filter/debounce), `08` Calibration, `09` Fault detection, `10`
Alarm/Event, `11` Trend/COV, `12` Commission/Test — cộng kiến trúc phân lớp
`Physical Channel → Logical Point → Application` ở mục 9.

## 3. Hiện trạng FE đã đọc trực tiếp trong source

| Vùng | File | Ghi nhận |
|---|---|---|
| Trang chính | [InputsPage.tsx](../../../apps/web-ui/src/features/points/InputsPage.tsx) | 3 chế độ xem: Summary (live value/raw/min/max/avg/chart/note), Wizard (8 bước tuần tự), Advanced (bảng `u0..u7` phẳng) |
| Kiểu dữ liệu | [types.ts:1127-1142](../../../apps/web-ui/src/shared/types.ts#L1127-L1142) | `AiInputConfig`: `signalType`(0-8), `analogCurrent`, `displayMin/Max`, `rangeMultiplier`(0-5), `unit`(0-4), `filterSamples`, `sensorCal`, `mathFunction`(0-3), `enabled`, `note` |
| Nhãn signalType | [i18n.tsx:132-140](../../../apps/web-ui/src/shared/i18n.tsx#L132-L140) | `0`=Không hoạt động, `1`=0-10V, `2`=2-10V hoặc 4-20mA (qua toggle `analogCurrent`), `3`=**NTC** (một loại duy nhất, không phân Type II/III/Beta3950/Pt1000/Ni1000), `4`/`5`=Tiếp điểm hở trực tiếp/đảo, `6`=Biến trở, `7`=Ánh sáng/chuyển động, `8`=Đếm xung |
| Đơn vị | [i18n.tsx:148-153](../../../apps/web-ui/src/shared/i18n.tsx#L148-L153) | Chỉ 5 lựa chọn: không đơn vị, `%`, `°C/°F`, `Pa`, `ppm` — không có `kPa`, `lx`, `L`, `RPM`, custom |
| Scaling | `rangeMultiplier` [i18n.tsx:142-147](../../../apps/web-ui/src/shared/i18n.tsx#L142-L147) | `x1/x10/x100` hoặc căn bậc hai `x1/x10/x100` — **không phải** scaling hai điểm kiểu "0V=0Pa, 10V=500Pa" như đề xuất, và không có Custom Curve |
| Calibration | `sensorCal`, field đơn `-12.7..12.8` | Chỉ offset đơn, không gain, không 2-point, không ngày/người hiệu chuẩn, không nút "Reset factory" |
| Filter/Debounce | `filterSamples` (0-100 mẫu) | Dùng chung cho cả analog và digital; không có debounce/min-ON/min-OFF riêng cho tiếp điểm |
| Nguồn dữ liệu backend | [client.ts:996-1000](../../../apps/web-ui/src/shared/api/client.ts#L996-L1000), [dto.go:22-28](../../../apps/web-api/internal/app/dto.go#L22-L28) | `GET/PUT /api/v1/system/config/io`; Go struct chỉ `map[string]any`, không có schema riêng — FE tự diễn giải field `u0..u7` |
| Alarm | [AlarmSettingsPage.tsx](../../../apps/web-ui/src/features/operations/AlarmSettingsPage.tsx) | Trang **riêng biệt hoàn toàn** (Operations → Alarms), 8 alarm type nhưng chỉ type `1` (High/Low + hysteresis + delay) hoạt động; type `2,4,5,6,7` (setpoint deviation, fan/DO/AO supervision, PI-sequence) bị khoá `deferred` (dòng 17-18, 327-329) |
| Trend/Log | [PointLoggingSection.tsx](../../../apps/web-ui/src/shared/components/PointLoggingSection.tsx) | Chỉ logging theo chu kỳ (`dbInterval`) + retention; **không có COV threshold** |
| Commissioning | [CommissioningPage.tsx](../../../apps/web-ui/src/features/points/CommissioningPage.tsx) | Chỉ áp dụng cho **AO/DO** (ghi thử ra output); **không có** trang chẩn đoán dây/wiring cho ngõ vào — phần "Live Data" trong `InputsPage` chỉ cho raw/value/min/max/avg, không có badge quality/fault rõ ràng như đề xuất mục 6 |
| Quality model | [types.ts:2](../../../apps/web-ui/src/shared/types.ts#L2) | `PointQuality = 'good' \| 'uncertain' \| 'bad' \| 'stale' \| 'offline'` — 5 trạng thái, không có `OPEN_CIRCUIT/SHORT_CIRCUIT/SENSOR_FAULT/CONFIG_ERROR` như đề xuất mục 6 |
| Fault ở tầng Core | [bacnet_objtable.cpp:88-97](../../../apps/core/adapters/bacnet/bacnet_objtable.cpp#L88-L97) | Core **có** khái niệm `reliability` (NO_FAULT/OVER_RANGE/COMM_FAILURE) publish qua BACnet, nhưng `IOP_FAULT_UI_OV` là cờ **gộp toàn bộ 16 kênh**, không phải per-channel; không có phát hiện đứt dây/chập dây thật — chỉ có ADC comm fault (`IOP_FAULT_ADC1/2`) và ngưỡng over-range. **Thông tin này không được đưa vào web UI cục bộ**, chỉ lộ ra qua giao thức BACnet |
| Digital qua binding chương trình | `docs/07_records/reviews/PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md` §4.6, `F-PROG-ASBUILT-015` | Kênh `UI` cấu hình `signalType 4/5` ("dry"/digital) trên `InputsPage` **không bind được vào Programming** vì compiler/Core hardcode mọi kênh `UI` là `REAL`/analog — gãy ở đúng lớp "Application Services" mà đề xuất mục 9 giả định là thông suốt |

## 4. Bảng đối chiếu 12 UC

| UC | Yêu cầu | Hiện trạng FE | Verdict | Finding |
|---|---|---|---|---|
| UC-UI-01 | Nhận diện channel | `UI-01..UI-16` cố định, terminal/HW state hiển thị trong panel trái + badge `wired` | **Đạt** | — |
| UC-UI-02 | Chọn Electrical Mode riêng | Gộp chung với sensor trong 1 enum `signalType` (0-8), không tách được "0-10V thuần" khỏi "cảm biến nào đọc trên 0-10V" | **Chưa có** (gộp lớp) | `F-UI-CFG-001` |
| UC-UI-03 | Chọn Sensor Profile (NTC10k Type II/III/Beta3950, Pt1000, Ni1000, Custom) | Chỉ 1 giá trị `NTC` chung, không phân loại; không có Pt1000/Ni1000/Custom resistance | **Chưa có** | `F-UI-CFG-002` |
| UC-UI-04 | Scaling (Linear tuỳ ý + Custom curve) | Chỉ hệ số cố định `x1/x10/x100`/căn bậc hai + `displayMin/Max`; không nhập được cặp điểm kỹ thuật tuỳ ý, không Custom Curve | **Một phần** | `F-UI-CFG-003` |
| UC-UI-05 | Engineering Unit đầy đủ | 5 lựa chọn cố định (không đơn vị/%/°C-°F/Pa/ppm); thiếu kPa, lx, L, RPM, custom | **Một phần** | `F-UI-CFG-004` |
| UC-UI-06 | Digital interpretation (NO/NC, Active High/Low) | Có `signalType 4/5` (Open contact direct/reversed) — đúng tinh thần NO/NC nhưng nhãn dùng thuật ngữ thanh ghi, không dùng "NO/NC" quen thuộc với thợ điện | **Một phần** | `F-UI-CFG-005a` |
| UC-UI-07 | Signal conditioning (filter, debounce, sample period) | Có `filterSamples` dùng chung cho cả analog/digital; không có debounce/min-ON/min-OFF riêng cho tiếp điểm | **Một phần** | `F-UI-CFG-005b` |
| UC-UI-08 | Calibration (offset/gain/2-point, ngày/người, reset factory) | Chỉ 1 offset đơn (`sensorCal`, -12.7..12.8); không gain, không 2-point, không audit trail, không reset factory | **Một phần** | `F-UI-CFG-006` |
| UC-UI-09 | Fault detection (open wire, short circuit, over/underrange) | Không cấu hình được trong FE; Core có cờ over-range **gộp cả board**, không per-channel, không đưa vào Web UI cục bộ (chỉ lộ qua BACnet reliability) | **Chưa có** | `F-UI-CFG-007` |
| UC-UI-10 | Alarm/Event (HH/H/L/LL, delay, deadband) gắn với point | Có, nhưng ở trang **riêng biệt** (Operations→Alarms), không có lối vào trực tiếp từ `InputsPage`; chỉ loại High/Low hoạt động, 5 loại còn lại `deferred` | **Một phần** | `F-UI-CFG-008` |
| UC-UI-11 | Trend/COV (sampling, COV threshold, historian) | Có logging theo chu kỳ + retention; không có COV threshold | **Một phần** | `F-UI-CFG-009` |
| UC-UI-12 | Commission/Test (raw, converted, quality, wiring diagnostics) | `InputsPage` Summary có raw/value/min/max/avg/chart; không có wiring diagnostics; `CommissioningPage` chỉ phục vụ AO/DO, không phục vụ ngõ vào | **Một phần** | `F-UI-CFG-010` |

**Tổng:** 1 Đạt hoàn toàn (UC-01) + 8 Một phần + 3 Chưa có (UC-02, UC-03,
UC-09) trên 12 UC. (UC-06/UC-07 tách hai finding con vì gộp chung 1 field
`filterSamples` cho hai mục đích khác nhau.)

## 5. Nhận xét kiến trúc — vì sao gap không chỉ ở FE

Chuỗi dữ liệu thật: `io_config.conf` (Core/firmware, thanh ghi `u0..u7`) →
Go `ConfigIO.UI []map[string]any` (pass-through, không schema —
[dto.go:22-28](../../../apps/web-api/internal/app/dto.go#L22-L28)) → FE
`AiInputConfig` (diễn giải `u0..u7` thành field có tên, nhãn tiếng Việt/Anh
qua `i18n.tsx`). **Không có tầng nào trong ba tầng này định nghĩa một
"Canonical Point" tách khỏi cấu hình điện của chân** như mục 9 của đề xuất
mô tả. FE đã làm tốt việc tách Alarm, Trend/Historian, BACnet publish,
Programming binding ra thành các trang/luồng riêng (đúng tinh thần "sensor
configuration và alarm policy là hai domain khác nhau") — nhưng đó là tách
ở tầng **route/UI**, không phải tách ở tầng **data model**. Muốn đạt mô
hình 5 lớp đầy đủ (`Hardware Input → Electrical Mode → Sensor/Conversion →
Canonical Point → Signal/Quality → Application`), cần định nghĩa lại schema
từ Core (thêm sensor profile, scaling hai điểm, fault detection per-channel
trong firmware/`io_config`) chứ không thể chỉ đổi FE — đây là quyết định
phạm vi lớn, ảnh hưởng cả HW/FW, không nằm trong khả năng tự quyết của một
phiên sửa FE.

Bằng chứng cùng lớp: `F-PROG-ASBUILT-015` (đã ghi nhận trước, cùng ngày)
cho thấy chính hardcode "mọi kênh UI = REAL/analog" ở compiler/Core là lý do
`signalType 4/5` (digital) cấu hình được trên FE nhưng không chạy được
trong Programming — xác nhận gap nằm ở tầng dữ liệu dùng chung, không phải
lỗi cục bộ của `InputsPage.tsx`.

## 6. Kết luận

FE **không đáp ứng đầy đủ** mô hình 12 UC / 5 lớp đã đề xuất. FE hiện là
một bản mirror trung thực, có UX tốt (wizard, live data, validation tên
điểm) của một **register map cố định 8 field**, không phải một mô hình cấu
hình cảm biến phân lớp. Các gap về Sensor Profile (`UC-03`), tách Electrical
Mode (`UC-02`), và Fault Detection (`UC-09`) không thể đóng chỉ bằng sửa FE
vì dữ liệu nguồn (Core/firmware) chưa có các khái niệm đó.

**Không có mục nào trong báo cáo này được coi là bug cần vá ngay**: đây là
gap so với một đề xuất kiến trúc mới, không phải sai lệch so với spec đã
duyệt hiện hành. Nếu muốn theo hướng 12 UC, đề nghị mở một plan riêng có
phê duyệt PM/CTO trước khi code (đúng quy tắc "DOC TRƯỚC CODE SAU" đang áp
dụng cho dự án), vì phạm vi đụng tới Core/firmware, không chỉ FE.
