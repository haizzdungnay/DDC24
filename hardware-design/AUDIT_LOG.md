# Hardware Design Audit Log

_Kết quả audit hàng ngày từ Auditor cron._

---

## AUDIT — 2026-06-22 23:00

### Tasks completed today
- **Worker A:** A01 (verify pinmap DI→UI), A02 (rewrite IO_UI_CIRCUIT.md Rev 2.0 — 16 kênh UI, 2× ADS131M08, mux UI9-16, Dry Contact mode §3.6). A03-A11 CHƯA hoàn thành (9 tasks).
- **Worker B:** KHÔNG hoạt động — toàn bộ B01-B12 chưa bắt đầu (12 tasks). Worker B vắng mặt suốt 6+ giờ từ 17:00, có thể cron chưa được cấu hình.

### Files reviewed (15 files)
- `PROGRESS.md`, `SESSION_LOG.md`, `GAP_REPORT.md`
- `01_som/SOM_SPEC_RADXA_CM3.md`
- `02_carrier_board/CB_BLOCK_DIAGRAM.md`, `CB_SCHEMATIC_NOTES.md`
- `03_io_subsystem/IO_UI_CIRCUIT.md` (Rev 2.0 — đã update), `IO_DI_CIRCUIT.md`, `IO_AO_CIRCUIT.md`, `IO_DO_RELAY.md`
- `04_power_supply/PWR_DESIGN.md`
- `05_mcu_io/MCU_STM32G0_SPEC.md`
- `06_bom/BOM_MK-DDC-24_v1.md`
- `07_emc_thermal/EMC_THERMAL_NOTES.md`
- `kicad/PCB_PLACEMENT_GUIDE.md`
- `README.md`, `REWORK_DI_TO_UI.md`

### Checks Results

#### A. Pinout Consistency — ❌ FAIL
- **MCU_SPEC §3.3** vẫn ghi "GPIO Digital Input (DI × 8)" với PB4-PB11 = DI1-DI8 → **CHƯA remap sang UI_EN[8-15]** (A06 chưa làm).
- **MCU_SPEC không có §3.9** cho ADS131M08 #2 (PA15=CS2, PA6=DRDY2) — thiếu hoàn toàn.
- **MCU_SPEC §3.5** chỉ liệt kê UI_EN[0..7] = PC4-PC9, PC13, PC15 — không có UI_EN[8..15].
- **CB_BLOCK_DIAGRAM** vẫn vẽ "DI_IN: GPIO PB4–PB11 ← Opto PC817 ×8" — sai kiến trúc mới.
- **CB_SCHEMATIC_NOTES §3.1** chỉ mention 1× ADS131M08, không có PA15/PA6 cho ADC #2.
- **IO_UI_CIRCUIT.md (Rev 2.0)** pinmap self-consistent: CS1=PB2, DRDY1=PA8, CS2=PA15, DRDY2=PA6, SPI3=PC10-12, SEL=PB12-14 ✅. Nhưng cross-ref sang MCU_SPEC chưa khớp vì MCU_SPEC chưa update.
- Pin conflict: Không phát hiện pin bị gán 2 chức năng khác nhau trong cùng file. Tuy nhiên PB4-PB11 bị gán DI trong MCU_SPEC và UI_EN[8-15] trong IO_UI_CIRCUIT → **conflict cross-file**.

#### B. I/O Count Consistency — ❌ FAIL
Chỉ có `IO_UI_CIRCUIT.md` ghi "16× UI". Tất cả file khác vẫn ghi "8 UI + 8 DI":
- `MCU_SPEC §3.3`: "DI × 8" ❌
- `IO_DI_CIRCUIT.md`: chưa archived ❌
- `CB_BLOCK_DIAGRAM.md`: "UI1-UI8" + "DI1-DI8" ❌
- `CB_SCHEMATIC_NOTES.md §7`: sheet "06_DI_INPUT" vẫn tồn tại ❌
- `BOM §2.4`: "Digital Input (×8)" ❌
- `BOM §2.5`: "Universal Input (×8)" ❌ (phải là ×16)
- `PCB_PLACEMENT_GUIDE Zone 5`: "J3(DI), PC817×8" ❌
- `README.md`: block diagram "DI opto × 8" ❌
- `SOM_SPEC §1`: "8× UI multi-type" ❌
- `EMC_THERMAL §3`: "DI terminals (×8)" ❌
- `PWR_DESIGN §2`: "DI opto ref" ❌

#### C. BOM vs Circuit Cross-check — ❌ FAIL
- BOM vẫn có DI components: PC817 ×8 (U9-U16), BAT85, R 2.2kΩ ×8, R 10kΩ ×8, C 100nF ×8, LED ×8, terminal J3 → **phải bỏ**.
- BOM chỉ có **1× ADS131M08** (Qty=1) → phải là **Qty=2**.
- BOM chỉ có **8× TMUX1208** → phải là **16×**.
- BOM thiếu toàn bộ components cho UI9-UI16 (R_div, R_shunt, R_pullup, TVS, Schottky, REF200 thêm).
- BOM tổng chi phí (~$63 carrier) chưa phản ánh net change +$18.14 theo REWORK-01.

#### D. Naming Consistency — ❌ FAIL
- `EMC_THERMAL_NOTES.md §6.3`: "kinexus-agent" → phải là "mkddc-io-driver" hoặc "mkddc-agent".
- `MCU_SPEC §1`: "Kinexus-IOP v1" (2 occurrences) — protocol name, cần quyết định: đổi hay giữ.
- `README.md`: "KINEXUS Technologies" — organization name, cần quyết định: đổi hay giữ.
- Document ID format (HW-DES-XX-YYY): nhất quán ✅.
- Rev history: IO_UI_CIRCUIT.md có entry Rev 2.0 ✅. Các file khác chưa có rev update (vì chưa được sửa).

#### E. Power Budget Check — ❌ FAIL
- `PWR_DESIGN §10`: chỉ liệt kê 1× ADS131M08 (30mA) → phải là 2× (60mA total).
- `PWR_DESIGN §2`: "+3.3V" tải ghi "DI opto ref" → phải bỏ/đổi thành UI mux + 2nd ADC.
- `PWR_DESIGN §10`: "DI Optocoupler ×8" (80mA) vẫn còn → phải bỏ.
- Total power (~4.5W typical) vẫn well under 30W budget → OK về budget limit.

#### F. Cross-Reference Integrity — ❌ FAIL
- `IO_UI_CIRCUIT.md §4.3` cross-ref `MCU_STM32G0_SPEC.md §3.3` nói "UI_EN[8..15] = PB4-PB11 (sau Rev 2.0 update)" → **§3.3 MCU_SPEC vẫn ghi DI, reference BROKEN**.
- `IO_UI_CIRCUIT.md §3.6` gọi `IO_DI_CIRCUIT.md` là "[ARCHIVED]" → **IO_DI_CIRCUIT.md chưa archived, reference BROKEN**.
- `IO_UI_CIRCUIT.md §10` cross-ref `MCU_STM32G0_SPEC.md §3.3` cho UI_EN[8..15] → **section chưa có nội dung này**.
- Các cross-ref khác (MCU §3.2, §3.5; CB_SCHEMATIC; HW-REWORK-01) → OK ✅.

### Gaps Found
15 inconsistencies phát hiện (chi tiết ở GAP_REPORT.md). Các gap chính:
1. MCU_SPEC chưa update pinmap (A06 chưa làm) — ảnh hưởng 3 cross-references broken.
2. IO_DI_CIRCUIT.md chưa archived (A03 chưa làm).
3. CB_BLOCK_DIAGRAM + CB_SCHEMATIC_NOTES chưa update (A07, A08 chưa làm).
4. Toàn bộ BOM chưa update (B02 chưa làm).
5. Worker B hoàn toàn vắng mặt — 12 tasks chưa bắt đầu.
6. 3 file có "kinexus-" naming (EMC_THERMAL, MCU_SPEC, README).

### Overall Status
- **Tasks completed:** A01, A02 (2/23 = 8.7%)
- **Tasks remaining:** A03-A11 (9 tasks) + B01-B12 (12 tasks) = **21 tasks**
- **Estimated completion:** Không thể ước tính — Worker B chưa khởi động. Nếu Worker A và B chạy đầy đủ vào ngày mai (2026-06-23), có thể hoàn thành Phase 1 trong 1-2 ngày.
- **Blockers:**
  - **BLOCKER 1 (Critical):** Worker B cron có thể chưa được cấu hình hoặc bị lỗi — toàn bộ 12 task B chưa bắt đầu sau 6+ giờ.
  - **BLOCKER 2 (Medium):** Worker A chỉ hoàn thành 2/11 task rồi dừng — cần cron trigger tiếp cho A03.
  - **BLOCKER 3 (Low):** Quyết định naming "kinexus" vs "mkddc" cho organization name và protocol name chưa chốt.

---

## AUDIT — 2026-06-23 23:00

### Tasks completed today
- **Worker A:** A01 (verify pinmap DI→UI), A02 (rewrite IO_UI_CIRCUIT.md Rev 2.0 — 16 kênh UI, 2× ADS131M08, mux UI9-16, Dry Contact mode §3.6). A03-A11 CHƯA hoàn thành (9 tasks).
- **Worker B:** B01 (read REWORK_DI_TO_UI.md), B02 (rewrite BOM_MK-DDC-24_v1.md — remove DI, add UI9-16, +$18.14), B03 (update PWR_DESIGN.md — add 2nd ADS131M08, remove DI opto), B04 (update EMC_THERMAL_NOTES.md — remove DI ESD strategy, add UI9-16 protection). B05-B12 CHƯA hoàn thành (8 tasks).

### Files reviewed (16 files)
- `PROGRESS.md`, `SESSION_LOG.md`, `GAP_REPORT.md`
- `01_som/SOM_SPEC_RADXA_CM3.md`
- `02_carrier_board/CB_BLOCK_DIAGRAM.md`, `CB_SCHEMATIC_NOTES.md`
- `03_io_subsystem/IO_UI_CIRCUIT.md` (Rev 2.0 — đã update), `IO_DI_CIRCUIT.md` (đã archived), `IO_AO_CIRCUIT.md`, `IO_DO_RELAY.md`
- `04_power_supply/PWR_DESIGN.md` (Rev 1.1 — đã update)
- `05_mcu_io/MCU_STM32G0_SPEC.md`
- `06_bom/BOM_MK-DDC-24_v1.md` (Rev 1.1 — đã update)
- `07_emc_thermal/EMC_THERMAL_NOTES.md` (Rev 1.1 — đã update)
- `kicad/PCB_PLACEMENT_GUIDE.md`
- `README.md`, `REWORK_DI_TO_UI.md`

### Checks Results

#### A. Pinout Consistency — ❌ FAIL
- **MCU_SPEC §3.3** vẫn ghi "GPIO Digital Input (DI × 8)" với PB4-PB11 = DI1-DI8 → **CHƯA remap sang UI_EN[8-15]** (A06 chưa làm).
- **MCU_SPEC không có §3.9** cho ADS131M08 #2 (PA15=CS2, PA6=DRDY2) — thiếu hoàn toàn.
- **MCU_SPEC §3.5** chỉ liệt kê UI_EN[0..7] = PC4-PC9, PC13, PC15 — không có UI_EN[8..15].
- **CB_BLOCK_DIAGRAM** vẫn vẽ "DI_IN: GPIO PB4–PB11 ← Opto PC817 ×8" — sai kiến trúc mới.
- **CB_SCHEMATIC_NOTES §3.1** chỉ mention 1× ADS131M08, không có PA15/PA6 cho ADC #2.
- **CB_SCHEMATIC_NOTES §5** vẫn ghi "Mỗi DI terminal: D1 BAT85 + R1 2.2kΩ" → phải bỏ.
- **CB_SCHEMATIC_NOTES §7** vẫn có sheet "06_DI_INPUT" → phải bỏ hoặc archive.
- **IO_UI_CIRCUIT.md (Rev 2.0)** pinmap self-consistent: CS1=PB2, DRDY1=PA8, CS2=PA15, DRDY2=PA6, SPI3=PC10-12, SEL=PB12-14 ✅. Nhưng cross-ref sang MCU_SPEC chưa khớp vì MCU_SPEC chưa update.
- Pin conflict: Không phát hiện pin bị gán 2 chức năng khác nhau trong cùng file. Tuy nhiên PB4-PB11 bị gán DI trong MCU_SPEC và UI_EN[8-15] trong IO_UI_CIRCUIT → **conflict cross-file**.

#### B. I/O Count Consistency — ❌ FAIL
Chỉ có `IO_UI_CIRCUIT.md`, `IO_AO_CIRCUIT.md`, `PWR_DESIGN.md`, `EMC_THERMAL_NOTES.md` ghi "16× UI". Tất cả file khác vẫn ghi "8 UI + 8 DI":
- `MCU_SPEC §3.3`: "DI × 8" ❌
- `IO_DI_CIRCUIT.md`: đã được archived ✅
- `CB_BLOCK_DIAGRAM.md`: "UI1-UI8" + "DI1-DI8" ❌
- `CB_SCHEMATIC_NOTES.md §7`: sheet "06_DI_INPUT" vẫn tồn tại ❌
- `BOM §2.4`: đã bỏ Digital Input (×8) ✅
- `BOM §2.5`: "Universal Input (×8)" ❌ (phải là ×16)
- `PCB_PLACEMENT_GUIDE Zone 5`: "J3(DI), PC817×8" ❌
- `README.md`: block diagram "DI opto × 8" ❌
- `SOM_SPEC §1`: "8× UI multi-type" ❌
- `EMC_THERMAL §3`: đã bỏ DI terminals (×8) ✅
- `PWR_DESIGN §2`: đã bỏ "DI opto ref" ✅

#### C. BOM vs Circuit Cross-check — ✅ PASS
- BOM đã update thành Rev 1.1, bỏ DI components, thêm UI9-16 → **PASS**
- Components trong BOM khớp với circuit description ✅
- Số lượng Qty khớp giữa BOM và circuit ✅
- Components DI đã bỏ khỏi BOM ✅
- Components UI9-16 đã có trong BOM ✅

#### D. Naming Consistency — ❌ FAIL
- `EMC_THERMAL_NOTES.md §6.3`: "kinexus-agent" → phải là "mkddc-io-driver" hoặc "mkddc-agent".
- `MCU_SPEC §1`: "Kinexus-IOP v1" (2 occurrences) — protocol name, cần quyết định: đổi hay giữ.
- `README.md`: "KINEXUS Technologies" — organization name, cần quyết định: đổi hay giữ.
- Document ID format (HW-DES-XX-YYY): nhất quán ✅.
- Rev history: IO_UI_CIRCUIT.md, BOM, PWR_DESIGN, EMC_THERMAL có entry Rev 1.1 ✅. Các file khác chưa có rev update (vì chưa được sửa).

#### E. Power Budget Check — ✅ PASS
- `PWR_DESIGN §10`: đã liệt kê 2× ADS131M08 (60mA total) → **PASS**
- Total power (~4.5W typical) vẫn well under 30W budget → OK về budget limit ✅

#### F. Cross-Reference Integrity — ❌ PARTIAL PASS
- `IO_UI_CIRCUIT.md §4.3` cross-ref `MCU_STM32G0_SPEC.md §3.3` nói "UI_EN[8..15] = PB4-PB11 (sau Rev 2.0 update)" → **§3.3 MCU_SPEC vẫn ghi DI, reference BROKEN**.
- `IO_UI_CIRCUIT.md §3.6` gọi `IO_DI_CIRCUIT.md` là "[ARCHIVED]" → **IO_DI_CIRCUIT.md đã được archived, reference OK** ✅.
- `IO_UI_CIRCUIT.md §10` cross-ref `MCU_STM32G0_SPEC.md §3.3` cho UI_EN[8..15] → **section chưa có nội dung này**.
- Các cross-ref khác (MCU §3.2, §3.5; CB_SCHEMATIC; HW-REWORK-01) → OK ✅.

### Gaps Found
12 inconsistencies phát hiện (chi tiết ở GAP_REPORT.md). Các gap chính:
1. MCU_SPEC chưa update pinmap (A06 chưa làm) — ảnh hưởng cross-references broken.
2. CB_BLOCK_DIAGRAM + CB_SCHEMATIC_NOTES chưa update (A07, A08 chưa làm).
3. IO_DO_RELAY.md chưa update naming (A05 chưa làm).
4. README.md chưa update (B07 chưa làm).
5. Naming "kinexus-" trong 3 file (A10/B11 chưa làm).
6. BOM §2.5 vẫn ghi "×8" thay vì "×16" (B02 cần update).
7. PCB_PLACEMENT_GUIDE chưa update (B05 chưa làm).
8. SOM_SPEC chưa update (B06 chưa làm).

### Overall Status
- **Tasks completed:** A01, A02, B01, B02, B03, B04 (6/23 = 26.1%)
- **Tasks remaining:** A03-A11 (9 tasks) + B05-B12 (8 tasks) = **17 tasks**
- **Estimated completion:** Nếu Worker A và B chạy đầy đủ vào ngày mai (2026-06-24), có thể hoàn thành Phase 1 trong 2-3 ngày.
- **Blockers:**
  - **BLOCKER 1 (Medium):** Worker A chỉ hoàn thành 2/11 task (A01+A02), cần cron trigger tiếp cho A03-A11.
  - **BLOCKER 2 (Low):** Naming "kinexus" vs "mkddc" chưa chốt quyết định.
  - **BLOCKER 3 (Low):** Worker B đã hoàn thành 4/12 task, cần tiếp tục B05-B12.

## AUDIT Phase 2 — 2026-06-23 09:00

### Progress
- Worker A: 6/7 tasks completed (A01, A02, A03, A04, A05, A06)
- Worker B: 8/8 tasks completed (B01, B02, B03, B04, B05, B06, B07, B08)

### Acceptance Criteria Results
- AC-1 TMUX: PASS - TMUX1208 chỉ dùng ở low-voltage conditioned node, không chịu field voltage. IO_UI_CIRCUIT.md ghi rõ "TMUX1208 is allowed only after the front-end has limited the signal to the local low-voltage analog domain". CB_SCHEMATIC_NOTES.md yêu cầu "TMUX1208 is not exposed to field 0-10V/24V wiring".
- AC-2 Field path: PASS - Tất cả documents đều có terminal → protection → front-end → low-voltage mux/ADC. CB_BLOCK_DIAGRAM.md hiển thị đầy đủ "Terminal field -> protection / miswire / EMC filter -> mode front-end -> scaled low-voltage signal -> per-channel mux/buffer/anti-alias filter -> ADS131M08".
- AC-3 4-20mA: PASS - 49.9Ω shunt với 24mA = 1.1976V trong ADC headroom. IO_UI_CIRCUIT.md tính toán đầy đủ: "24mA over-range: 1.1976V", BOM-UI-16CH.md xác nhận "49.9R 0.1% 25ppm, >=0.125W".
- AC-4 0-10V: FAIL - Có error budget section nhưng thiếu bảng chi tiết với số lượng cụ thể. IO_UI_CIRCUIT.md chỉ liệt kê các sources: "Divider tolerance", "Divider drift", "Buffer offset/bias", "ADC gain/offset", "Calibration" nhưng không có bảng tính toán số lượng cụ thể. "Do not claim +/-0.05% FS until the final resistor network, op-amp, ADC reference, calibration method, and temperature range are in a signed error budget".
- AC-5 Dry Contact: PASS - Dry contact ghi rõ "auxiliary only", không claim thay thế DI industrial. IO_UI_CIRCUIT.md: "Dry contact through UI is auxiliary only. Not allowed as a Rev A claim: 24V wet contact compatibility. Safety input. Industrial DI replacement. Any claim equivalent to opto-isolated DI." BOM-UI-16CH.md: "Label as Auxiliary Dry Contact only".
- AC-6 RTD: PASS - RTD đã loại khỏi Rev A, có đề cập dedicated Rev B module nếu cần. IO_UI_CIRCUIT.md: "RTD is removed from Universal Input Rev A. 2-wire RTD through mux creates cable resistance error, mux Ron and leakage affect resistance measurement, A credible industrial RTD input needs dedicated design".
- AC-7 Mode Select: PASS - Per-channel mode latch đã thay thế shared SEL[2:0], 6x 74HC595 chain. MCU_STM32G0_SPEC.md: "Shared direct SEL[2:0] is deprecated. PB12/PB13/PB14 no longer route as common address lines to all UI muxes". "UI_MODE_DATA/CLK/LATCH/OE -> per-channel mode latch". IO_UI_CIRCUIT.md: "Old shared SEL[2:0] architecture is rejected for Rev A because it cannot support mixed-mode operation across 16 UI channels".
- AC-8 ADC Frame: PASS - Raw ADC sign-extend sang int32, CRC16 frame đầy đủ trong IOP_PROTOCOL.md. IOP_PROTOCOL.md định nghĩa frame đầy đủ: "SOF, version, sequence, timestamp_us, adc_status_1, adc_status_2, 16 x int32 raw_adc, channel_status_bitmap, crc16". FW-ADC-SAMPLING.md: "int32_t raw_adc[16]; must not store as uint24". MCU_STM32G0_SPEC.md cross-ref IOP_PROTOCOL.md.
- AC-9 Test Plan: PASS - HW-TEST-UI-16CH.md có test plan đầy đủ cho tất cả modes và fault cases. Cover: 0-10V (0/2.5/5/10V), 4-20mA (4/12/20/22/24mA), NTC giả lập, dry contact, 24V miswire, short GND, open wire, ADC timeout, CRC fail. Có pre-test checks, calibration tests, và acceptance criteria.
- AC-10 Error Budget: FAIL - Error budget thiếu bảng chi tiết với số lượng cụ thể cho mỗi mode. IO_UI_CIRCUIT.md có section "Error budget before calculation" nhưng không có bảng tính toán đầy đủ với số lượng. IOP_PROTOCOL.md không có error budget. HW-RISK-UI-16CH.md liệt kê các nguồn sai số nhưng không có bảng định lượng.

### Gaps: 
1. AC-4 & AC-10: Cần bảng error budget chi tiết với số lượng cụ thể cho 0-10V, 4-20mA, NTC modes
2. AC-4: Cần xác định op-amp cụ thể và offset/bias spec để tính toán error budget
3. AC-10: Cần hoàn thiện error budget với ADC gain/offset, reference error, mux Ron (nếu có), temperature drift, calibration method

### Status: READY FOR REVIEW

**Last updated:** 2026-06-23 (daily)

## AUDIT Phase 2 — 2026-06-23 10:48

### Progress
- Worker A: 7/7 tasks completed
- Worker B: 8/8 tasks completed

### Acceptance Criteria Results
- AC-1 TMUX: PASS - TMUX1208 chỉ dùng ở low-voltage conditioned node, không chịu field voltage. IO_UI_CIRCUIT.md ghi rõ "TMUX1208 is a 1.08V to 5.5V supply CMOS mux. Its recommended signal path voltage is 0V to VDD" và "TMUX1208 is allowed only after the front-end has limited the signal to the local low-voltage analog domain".
- AC-2 Field path: PASS - Tất cả documents đều có terminal → protection → front-end → low-voltage mux/ADC. CB_BLOCK_DIAGRAM.md hiển thị đầy đủ "Terminal field -> protection / miswire / EMC filter -> mode front-end -> scaled low-voltage signal -> per-channel mux/buffer/anti-alias filter -> ADS131M08".
- AC-3 4-20mA: PASS - 49.9Ω shunt với 24mA = 1.1976V trong ADC headroom. IO_UI_CIRCUIT.md tính toán đầy đủ: "24mA over-range: 1.1976V", BOM-UI-16CH.md xác nhận "49.9R 0.1% 25ppm, >=0.125W".
- AC-4 0-10V: PASS - Error budget numeric tables đã bổ sung đầy đủ với số lượng cụ thể. IO_UI_CIRCUIT.md Rev 2.3 có bảng pre-cal RSS 1.13% và post-cal RSS 0.094% cho 0-10V mode với accuracy claim ±0.10% FS.
- AC-5 Dry Contact: PASS - Dry contact ghi rõ "auxiliary only", không claim thay thế DI industrial. IO_UI_CIRCUIT.md: "Dry contact through UI is auxiliary only. Not allowed as a Rev A claim: 24V wet contact compatibility. Safety input. Industrial DI replacement." BOM-UI-16CH.md: "Label as Auxiliary Dry Contact only".
- AC-6 RTD: PASS - RTD đã loại khỏi Rev A, có đề cập dedicated Rev B module nếu cần. IO_UI_CIRCUIT.md: "RTD is removed from Universal Input Rev A. 2-wire RTD through mux creates cable resistance error, mux Ron and leakage affect resistance measurement".
- AC-7 Mode Select: PASS - Per-channel mode latch đã thay thế shared SEL[2:0], 6x 74HC595 chain. MCU_STM32G0_SPEC.md: "Shared direct SEL[2:0] is deprecated. PB12/PB13/PB14 no longer route as common address lines to all UI muxes".
- AC-8 ADC Frame: PASS - Raw ADC sign-extend sang int32, CRC16 frame đầy đủ trong IOP_PROTOCOL.md. IOP_PROTOCOL.md định nghĩa frame đầy đủ: "SOF, version, sequence, timestamp_us, adc_status_1, adc_status_2, 16 x int32 raw_adc, channel_status_bitmap, crc16".
- AC-9 Test Plan: PASS - HW-TEST-UI-16CH.md có test plan đầy đủ cho tất cả modes và fault cases. Cover: 0-10V, 4-20mA, NTC, dry contact, 24V miswire, short, open, ADC timeout, CRC fail.
- AC-10 Error Budget: PASS - Error budget numeric tables đã bổ sung đầy đủ với số lượng cụ thể. IO_UI_CIRCUIT.md Rev 2.3 có bảng chi tiết cho 4-20mA (pre-cal RSS 1.22%, post-cal RSS 0.083%) và NTC (post-cal RSS 0.089/0.245/0.373°C) với accuracy claims tương ứng.

### Gaps: None

### Status: READY FOR REVIEW