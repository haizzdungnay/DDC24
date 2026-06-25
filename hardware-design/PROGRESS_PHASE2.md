# Hardware Design Progress Tracker — Phase 2: UI Architecture Rework

> **Cập nhật tự động bởi:** Worker A, Worker B, Auditor (cron jobs)
> **Thời gian hoạt động:** 08:00–22:00 (Europe/Vienna)
> **Ngày bắt đầu:** 2026-06-23
> **Nguồn yêu cầu:** YÊU CẦU SỬA LẠI THIẾT KẾ HW-DES-03-UI (10 sections 3.1–3.10)

---

## Worker A — Core Design Documents

### Tạo tài liệu mới
- [x] **A01:** Tạo `05_mcu_io/IOP_PROTOCOL.md` — Binary frame ADC spec đầy đủ (SOF, version, sequence, timestamp_us, adc_status_1, adc_status_2, 16×int32 raw_adc, channel_status_bitmap, crc16). Xem yêu cầu §3.8.
- [x] **A02:** Tạo `05_mcu_io/FW-ADC-SAMPLING.md` — Sampling sequence cho per-channel mode scan, phân biệt ADC sample rate / MCU scan rate / CM3 publish rate / UI application update rate. Xem yêu cầu §3.9.

### Verify & update tài liệu hiện tại
- [x] **A03:** Review `03_io_subsystem/IO_UI_CIRCUIT.md` Rev 2.2 — kiểm tra compliance với 10 yêu cầu (§3.1–3.10), fix gaps còn lại.
- [x] **A04:** Update `05_mcu_io/MCU_STM32G0_SPEC.md` — verify pinmap mode latch chain (PB12-15) khớp với IO_UI_CIRCUIT, verify IOP frame cross-ref.
- [x] **A05:** Update `02_carrier_board/CB_BLOCK_DIAGRAM.md` — verify signal chain diagram khớp kiến trúc mới (Terminal→Protection→Mode Front-End→Scale/Filter/Buffer→ADC→STM32→IOP→CM3).
- [x] **A06:** Update `02_carrier_board/CB_SCHEMATIC_NOTES.md` — verify schematic notes khớp kiến trúc mới, không còn quy tắc cũ.

### Final cross-check
- [x] **A07:** Cross-check tất cả Worker A files: pinmap nhất quán, cross-refs hợp lệ, không còn reference cũ (shared SEL[2:0], DI opto, 62Ω shunt, ±0.05% claim).

---

## Worker B — BOM, Test Plan, Risk & Support Docs

### Tạo tài liệu mới
- [x] **B01:** Tạo `06_bom/BOM-UI-16CH.md` — UI-specific BOM: 49.9Ω shunt, 74HC595×6 chain, RRIO op-amp buffer, TVS/PTC, NTC pull-up, alternate parts, tolerance, cost estimate.
- [x] **B02:** Tạo `09_hw_bringup/HW-TEST-UI-16CH.md` — Test plan đầy đủ theo yêu cầu §5.5: đo chuẩn 0V/2.5V/5V/10V, 4-20mA, NTC giả lập, dry contact, đấu nhầm 24V, short GND, open wire, ADC timeout, UART CRC fail, boot auto-detect.
- [x] **B03:** Tạo `hw_design_review/HW-RISK-UI-16CH.md` — Bảng rủi ro cho từng mode: rủi ro analog front-end, rủi ro mux Ron, rủi ro thermal drift, rủi ro calibration, rủi ro DI claim, phương án giảm thiểu.

### Update tài liệu hiện tại
- [x] **B04:** Update `06_bom/BOM_MK-DDC-24_v1.md` — thêm mode latch parts (74HC595), op-amp buffer, protection parts, verify UI parts khớp IO_UI_CIRCUIT.
- [x] **B05:** Update `04_power_supply/PWR_DESIGN.md` — verify power budget cho mode latch chain, op-amp buffers, NTC excitation.
- [x] **B06:** Update `kicad/PCB_PLACEMENT_GUIDE.md` — verify placement rules cho mode latch chain, buffer op-amps, test points.
- [x] **B07:** Update `README.md` — thêm references tới IOP_PROTOCOL.md, FW-ADC-SAMPLING.md, HW-TEST-UI-16CH.md, HW-RISK-UI-16CH.md, BOM-UI-16CH.md.

### Final cross-check
- [x] **B08:** Cross-check BOM vs circuit, verify tất cả new docs được index trong README, không còn orphan references.

---

## Auditor — Acceptance Criteria Verification

Chạy sau khi Worker A/B hoàn thành task, kiểm tra 10 acceptance criteria từ yêu cầu §6:

- [x] **AUD-2.1:** PASS - TMUX1208 chỉ dùng ở low-voltage conditioned node, không chịu field voltage
- [x] **AUD-2.2:** PASS - Tất cả documents đều có terminal → protection → front-end → low-voltage mux/ADC
- [x] **AUD-2.3:** PASS - 49.9Ω shunt với 24mA = 1.1976V trong ADC headroom
- [x] **AUD-2.4:** PASS - Error budget numeric tables đã bổ sung đầy đủ với số lượng cụ thể cho 0-10V mode
- [x] **AUD-2.5:** PASS - Dry contact ghi rõ "auxiliary only", không claim thay thế DI industrial
- [x] **AUD-2.6:** PASS - RTD đã loại khỏi Rev A, có đề cập dedicated Rev B module nếu cần
- [x] **AUD-2.7:** PASS - Per-channel mode latch đã thay thế shared SEL[2:0], 6x 74HC595 chain
- [x] **AUD-2.8:** PASS - Raw ADC sign-extend sang int32, CRC16 frame đầy đủ trong IOP_PROTOCOL.md
- [x] **AUD-2.9:** PASS - HW-TEST-UI-16CH.md có test plan đầy đủ cho tất cả modes và fault cases
- [x] **AUD-2.10:** PASS - Error budget numeric tables đã bổ sung đầy đủ với số lượng cụ thể cho 4-20mA và NTC modes

---

## Tổng quan Phase 2

| Metric | Giá trị |
|--------|---------|
| Tổng tasks | A: 7 + B: 8 + AUD: 10 = **25 tasks** |
| Files mới tạo | 5 (IOP_PROTOCOL, FW-ADC-SAMPLING, BOM-UI-16CH, HW-TEST-UI-16CH, HW-RISK-UI-16CH) |
| Files update | 7 (IO_UI_CIRCUIT, MCU_SPEC, CB_BLOCK, CB_SCHEMATIC, BOM, PWR, PCB, README) |

---

_Last updated: 2026-06-23 09:00 — Worker A Phase 2 completed, ready for Auditor review_
