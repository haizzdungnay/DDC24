# Hardware Design Progress Tracker

> **Cập nhật tự động bởi:** Worker A, Worker B, Auditor (cron jobs)
> **Thời gian hoạt động:** 17:00–00:00 hàng ngày (Europe/Vienna)
> **Ngày bắt đầu:** 2026-06-22

---

## WORKER A — Core Electronics & Circuit Design
_Phụ trách: IO subsystem, MCU, Carrier Board schematic_

### Phase 1: DI→UI Migration Design
- [x] **A01:** Đọc `REWORK_DI_TO_UI.md`, verify pinmap changes (PB4-11→UI_EN[8-15], PA15+PA6)
- [x] **A02:** Rewrite `03_io_subsystem/IO_UI_CIRCUIT.md` → 16 kênh UI (thêm 2nd ADS131M08, mux UI9-16, shared SEL)
- [x] **A03:** Archive `03_io_subsystem/IO_DI_CIRCUIT.md` → đánh dấu `[ARCHIVED 2026-06-22 — thay bởi UI Dry Contact mode]`, thêm note chuyển đổi
- [x] **A04:** Update `03_io_subsystem/IO_AO_CIRCUIT.md` — sửa references "8 UI + 8 DI" → "16 UI"
- [x] **A05:** Update `03_io_subsystem/IO_DO_RELAY.md` — sửa references I/O count
- [x] **A06:** Rewrite `05_mcu_io/MCU_STM32G0_SPEC.md` §3.3 — PB4-11 = UI_EN[8-15], thêm §3.9 ADS131M08 #2 pinmap (PA15=CS2, PA6=DRDY2)
- [x] **A07:** Update `02_carrier_board/CB_BLOCK_DIAGRAM.md` — block diagram bỏ DI, 16 UI, 2× ADS131M08
- [x] **A08:** Update `02_carrier_board/CB_SCHEMATIC_NOTES.md` — bỏ sheet 06_DI_INPUT, mở rộng 05_UI_INPUT thành 16ch

### Phase 2: New Docs
- [x] **A09:** Tạo `hw_design_review/SCHEMATIC_REVIEW_CHECKLIST.md` — checklist review schematic trước fabricate (đặc biệt 16ch UI + 2 ADC)

### Phase 3: Cross-check & Polish
- [x] **A10:** Verify consistency: MCU pinmap ↔ IO_UI_CIRCUIT ↔ CB_SCHEMATIC ↔ CB_BLOCK
- [x] **A11:** Final rev bump tất cả file Phase 1 (bump minor rev + Revision History entry)

---

## WORKER B — Support Docs, BOM, PCB & Manufacturing
_Phụ trách: SOM, Power, BOM, EMC, PCB, Mechanical, Manufacturing_

### Phase 1: DI→UI Migration Updates
- [x] **B01:** Đọc `REWORK_DI_TO_UI.md`, nắm BOM impact và power budget changes
- [x] **B02:** Rewrite `06_bom/BOM_MK-DDC-24_v1.md` — bỏ DI components, thêm UI9-16 + ADS131M08 #2, update total cost
- [x] **B03:** Update `04_power_supply/PWR_DESIGN.md` — power budget thêm ADS131M08 #2 (+30mA 3.3V), bỏ DI opto current
- [x] **B04:** Update `07_emc_thermal/EMC_THERMAL_NOTES.md` — bỏ ESD strategy cho DI opto, thêm UI9-16 protection
- [x] **B05:** Update `kicad/PCB_PLACEMENT_GUIDE.md` — Zone 5 mở rộng (16ch UI), bỏ DI sub-zone, thêm ADS131M08 #2 placement
- [x] **B06:** Update `01_som/SOM_SPEC_RADXA_CM3.md` — sửa I/O description: "16× UI (no separate DI)"
- [x] **B07:** Update `README.md` — index, cấu trúc, block diagram (16 UI, bỏ DI, thêm docs mới)
- [x] **B08:** Tạo `08_mechanical/MECHANICAL_ENCLOSURE.md` — vỏ DIN-rail, kích thước, thông gió, mounting
- [x] **B09:** Tạo `09_hw_bringup/HW_BRINGUP_TEST_PROCEDURE.md` — step-by-step bring-up board mới

### Phase 2: New Docs
- [x] **B08:** Tạo `08_mechanical/MECHANICAL_ENCLOSURE.md` — vỏ DIN-rail, kích thước, thông gió, mounting *(done in Phase 1 run)*
- [x] **B09:** Tạo `09_hw_bringup/HW_BRINGUP_TEST_PROCEDURE.md` — step-by-step bring-up board mới *(done in Phase 1 run)*
- [x] **B10:** Tạo `10_manufacturing/MFG_DATA_PACKAGE.md` — spec Gerber, Pick&Place, stencil, assembly drawing

### Phase 3: Cross-check & Polish
- [x] **B11:** Verify BOM ↔ schematic parts list consistent
- [x] **B12:** Final rev bump tất cả file Phase 1-2

---

## AUDITOR — Cross-check & Progress Management
_Chạy 23:00 hàng ngày, sau khi 2 workers xong_

### Daily Tasks
- [x] **AUD-2026-06-23:** Đọc tất cả file đã update trong ngày, check consistency
- [x] **AUD-2026-06-23:** Pinout cross-validation: MCU_SPEC §3 ↔ IO_UI ↔ CB_SCHEMATIC ↔ PCB_PLACEMENT
- [x] **AUD-2026-06-23:** BOM vs circuit cross-check: mỗi linh kiện trong BOM có trong circuit doc không?
- [x] **AUD-2026-06-23:** Check naming consistency: kinexus→mkddc, I/O count, pin references
- [x] **AUD-2026-06-23:** Update progress checkboxes ở trên
- [x] **AUD-2026-06-23:** Tạo gap report (nếu có) — ghi vào `GAP_REPORT.md`
- [x] **AUD-2026-06-23:** Cập nhật `AUDIT_LOG.md` với tóm tắt ngày

### Completion Criteria
- Tất cả A01-A11, B01-B12 completed
- 3 daily audit pass không tìm thấy inconsistency mới
- README index phản ánh đúng tất cả file

---

## Audit Log Format

```
## YYYY-MM-DD Audit
- Files reviewed: [list]
- Inconsistencies found: [count] — [details]
- Tasks completed today: Axx, Bxx
- Tasks remaining: [count]
- Blockers: [none / description]
```

---

_Last updated: 2026-06-23 (B01-B04 completed, AUD-2026-06-23 completed)_
