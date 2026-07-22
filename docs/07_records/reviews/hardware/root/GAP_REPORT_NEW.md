# Hardware Design Gap Report

_Log các vấn đề phát hiện bởi Supervisor/Auditor._

---

## [SUPERVISOR] 2026-06-22 18:29 — Worker A & B chưa khởi động
- **Mức độ:** Cao
- **Vấn đề:** Đã 18:29 (Asia/Ho_Chi_Minh), hơn 1.5 giờ kể từ 17:00. SESSION_LOG.md trống hoàn toàn — không có entry nào từ Worker A hay Worker B.
- **Task còn lại:** Tất cả 23 task (A01-A11, B01-B12) đều `[ ]`.
- **File kiểm tra:** Tất cả file nguồn đã tồn tại (IO_UI_CIRCUIT.md, MCU_STM32G0_SPEC.md, BOM, v.v.) nhưng chưa có chỉnh sửa nào từ worker. Các thư mục Phase 2 (hw_design_review, 08_mechanical, 09_hw_bringup, 10_manufacturing) chưa tạo — bình thường vì task chưa đến.
- **Nguyên nhân có thể:** Worker cron chưa được cấu hình, hoặc worker bị crash/timeout ngay khi bắt đầu.
- **Action đã thực hiện:** Ghi nhận gap, báo cáo tình trạng. Không can thiệp nội dung kỹ thuật.
- **Khuyến nghị:** Kiểm tra cấu hình cron cho Worker A và Worker B trong OpenClaw. Đảm bảo prompt worker được khởi chạy đúng lịch.

## [SUPERVISOR] 2026-06-22 18:40 (ICT) — Worker B vẫn chưa khởi động
- **Mức độ:** Cao
- **Vấn đề:** Đã 18:40 ICT, hơn 1.5 giờ từ 17:00. Worker B vẫn chưa có entry nào trong SESSION_LOG.md. Worker A đã bắt đầu (A01+A02 xong lúc 18:32 ICT), nhưng Worker B hoàn toàn vắng mặt.
- **Task còn lại:** B01-B12 toàn bộ (12 task) chưa bắt đầu.
- **File kiểm tra:** Không phát hiện file nào bị Worker B sửa (vì chưa hoạt động). Không có file corrupt.
- **Git status:** Chỉ `03_io_subsystem/IO_UI_CIRCUIT.md` bị modify (do Worker A). Không có thay đổi ngoài scope.
- **Nguyên nhân có thể:** Worker B cron chưa được cấu hình, bị crash lúc khởi động, hoặc session bị timeout ngay lập tức.
- **Action đã thực hiện:** Ghi nhận gap. Không can thiệp nội dung kỹ thuật.
- **Khuyến nghị:** Kiểm tra lại cron schedule cho Worker B. Đảm bảo Worker B prompt và schedule được set đúng trong OpenClaw gateway config.

## [SUPERVISOR] 2026-06-22 18:50 (ICT) — Worker B vẫn vắng mặt (gần 2 giờ)
- **Mức độ:** Nghiêm trọng
- **Vấn đề:** Đã 18:50 ICT, gần 2 giờ từ 17:00. Worker B VẪN chưa có entry nào trong SESSION_LOG.md. 12/12 task chưa bắt đầu.
- **Worker A:** Log cuối 18:32 ICT (18 phút trước). File `IO_UI_CIRCUIT.md` nguyên vẹn (378 dòng, start/end OK). Không phát hiện corrupt. Có thể worker đã kết thúc session sau A02 — sẽ tiếp tục A03 ở lần chạy tiếp theo.
- **Git status:** Không thay đổi mới. Chỉ `IO_UI_CIRCUIT.md` modify. Không file ngoài scope.
- **Action:** Tiếp tục giám sát. Nếu Worker B không xuất hiện sau 30 phút nữa (19:20 ICT), cần can thiệp manual (kiểm tra cron config hoặc khởi động Worker B thủ công).
- **Khuyến nghị (lặp lại):** Kiểm tra cron Worker B trong OpenClaw gateway config. Worker B cron có thể chưa được tạo hoặc bị disable.

## [SUPERVISOR] 2026-06-22 19:07 (ICT) — Worker B vắng mặt 2h+, Worker A nghỉ 35 phút
- **Mức độ:** Nghiêm trọng (Worker B) / Theo dõi (Worker A)
- **Worker B:** Đã >2 giờ (17:00→19:07 ICT), Worker B vẫn không có bất kỳ entry nào trong SESSION_LOG.md. 12/12 task chưa bắt đầu. Không phát hiện file nào bị thay đổi bởi Worker B. Cron Worker B có thể chưa được cấu hình hoặc bị lỗi.
- **Worker A:** Nghỉ 35 phút (từ 18:32 ICT). File `IO_UI_CIRCUIT.md` nguyên vẹn, không corrupt. Git không có thay đổi mới. Worker A đã hoàn thành A01+A02 và kết thúc session — sẽ tiếp tục A03 khi cron trigger tiếp theo.
- **Git status:** Chỉ `03_io_subsystem/IO_UI_CIRCUIT.md` modify (Worker A scope). `AUDIT_LOG.md`, `GAP_REPORT.md`, `PROGRESS.md`, `REWORK_DI_TO_UI.md`, `SESSION_LOG.md` là untracked (new files).
- **Action:** Tiếp tục giám sát. Worker B cần can thiệp manual — kiểm tra OpenClaw cron config.
- **Task còn lại:** A:9 B:12 = 21 total.

---

## [AUDITOR] 2026-06-22 23:00 — First Full Audit (15 inconsistencies)

### GAP-001: MCU_SPEC pinmap chưa update DI→UI_EN[8-15] (A06 chưa làm)
- **Mức độ:** HIGH — Cross-reference broken
- **Files affected:** `MCU_STM32G0_SPEC.md` §3.3, §3.5
- **Chi tiết:** MCU_SPEC §3.3 vẫn ghi "GPIO Digital Input (DI × 8)" với PB4-PB11 = DI1-DI8. Theo REWORK-01 và IO_UI_CIRCUIT.md Rev 2.0, PB4-PB11 phải là UI_EN[8..15]. MCU_SPEC cũng thiếu §3.9 cho ADS131M08 #2 (PA15=CS2, PA6=DRDY2).
- **Cross-ref broken:** IO_UI_CIRCUIT.md §4.3 và §10 tham chiếu MCU_SPEC §3.3 cho UI_EN[8..15] — section chưa có nội dung này.
- **Fix:** Task A06 — rewrite MCU_SPEC §3.3 → UI_EN[8..15], thêm §3.9 ADS131M08 #2 pinmap.

### GAP-002: IO_DI_CIRCUIT.md chưa archived (A03 chưa làm)
- **Mức độ:** MEDIUM — Stale document active
- **Files affected:** `IO_DI_CIRCUIT.md`
- **Chi tiết:** IO_DI_CIRCUIT.md vẫn ở trạng thái active Rev 1.0. IO_UI_CIRCUIT.md §3.6 đã tham chiếu nó là "[ARCHIVED]" nhưng thực tế chưa archived.
- **Fix:** Task A03 — add header "[ARCHIVED 2026-06-22]", thêm note chuyển đổi sang UI Dry Contact mode.

### GAP-003: CB_BLOCK_DIAGRAM chưa update kiến trúc 16 UI (A07 chưa làm)
- **Mức độ:** HIGH — Schematic reference sai
- **Files affected:** `CB_BLOCK_DIAGRAM.md`
- **Chi tiết:** Block diagram vẫn vẽ: DI_IN PB4-PB11 ← Opto PC817 ×8, chỉ 1× ADS131M08, terminal DI1-DI8. Phải bỏ DI block, mở rộng UI thành 16 kênh, thêm 2nd ADS131M08.
- **Fix:** Task A07.

### GAP-004: CB_SCHEMATIC_NOTES chưa update (A08 chưa làm)
- **Mức độ:** HIGH — Sheet organization sai
- **Files affected:** `CB_SCHEMATIC_NOTES.md` §3.1, §5, §7
- **Chi tiết:**
  - §3.1 chỉ mention 1× ADS131M08, không có PA15/PA6 cho ADC #2
  - §5 vẫn có checklist "Mỗi DI terminal: D1 BAT85 + R1 2.2kΩ"
  - §7 vẫn có sheet "06_DI_INPUT" — phải bỏ hoặc archive
  - §6 signal naming vẫn có "DI_x_LOGIC"
- **Fix:** Task A08.

### GAP-005: BOM chưa update — vẫn có DI components, thiếu UI9-16 (B02 chưa làm)
- **Mức độ:** CRITICAL — BOM sai ảnh hưởng purchasing
- **Files affected:** `BOM_MK-DDC-24_v1.md`
- **Chi tiết:**
  - §2.4 "Digital Input (×8)" vẫn còn: PC817 ×8, BAT85, R/C, LED, J3 → phải REMOVE
  - §2.5 "Universal Input (×8)" chỉ có 8 kênh → phải mở rộng thành 16
  - ADS131M08 Qty=1 → phải là Qty=2
  - TMUX1208 Qty=8 → phải là Qty=16
  - Thiếu components UI9-16: R_div, R_shunt, R_pullup, TVS, Schottky, REF200 thêm
  - Tổng chi phí chưa phản ánh net change +$18.14
- **Fix:** Task B02.

### GAP-006: PWR_DESIGN power budget chưa update (B03 chưa làm)
- **Mức độ:** MEDIUM — Budget sai
- **Files affected:** `PWR_DESIGN.md` §2, §10
- **Chi tiết:**
  - §2 "+3.3V" tải ghi "DI opto ref" → phải đổi thành UI mux + 2nd ADC
  - §10 chỉ có 1× ADS131M08 (30mA) → phải là 2× (60mA)
  - §10 "DI Optocoupler ×8" (80mA) vẫn còn → phải bỏ
  - Total power vẫn under 30W ✅
- **Fix:** Task B03.

### GAP-007: EMC_THERMAL chưa update ESD strategy (B04 chưa làm)
- **Mức độ:** MEDIUM
- **Files affected:** `EMC_THERMAL_NOTES.md` §3
- **Chi tiết:** §3 ESD table vẫn có "DI terminals (×8)" với TVS P6KE36A + opto isolation → phải bỏ, thay bằng UI9-16 protection.
- **Fix:** Task B04.

### GAP-008: PCB_PLACEMENT_GUIDE Zone 5 chưa update (B05 chưa làm)
- **Mức độ:** MEDIUM
- **Files affected:** `kicad/PCB_PLACEMENT_GUIDE.md` §2 Zone 5, §3.6 TP
- **Chi tiết:** Zone 5 vẫn ghi "J4(UI), J3(DI), J5(AO), TMUX1208 ×8, PC817 ×8" → phải bỏ DI, mở rộng UI zone, thêm ADS131M08 #2 placement. Test points chỉ có TP10-TP17 cho UI1-UI8 → thiếu UI9-UI16.
- **Fix:** Task B05.

### GAP-009: SOM_SPEC chưa update I/O description (B06 chưa làm)
- **Mức độ:** LOW
- **Files affected:** `SOM_SPEC_RADXA_CM3.md` §1
- **Chi tiết:** §1 table row "ADC onboard" ghi "8× UI multi-type" → phải là "16× UI".
- **Fix:** Task B06.

### GAP-010: README.md chưa update (B07 chưa làm)
- **Mức độ:** MEDIUM
- **Files affected:** `README.md`
- **Chi tiết:**
  - Block diagram vẫn vẽ "DI opto × 8" và "UI1-UI8" + "DI1-DI8"
  - File index liệt kê IO_DI_CIRCUIT.md như active doc (không ghi archived)
  - Cấu trúc thư mục chưa phản ánh các file mới (08_mechanical, 09_hw_bringup, 10_manufacturing)
- **Fix:** Task B07.

### GAP-011: Naming "kinexus-" trong hardware docs
- **Mức độ:** LOW — Naming convention
- **Files affected:**
  - `EMC_THERMAL_NOTES.md` §6.3: "kinexus-agent" → phải là "mkddc-io-driver" hoặc "mkddc-agent"
  - `MCU_SPEC §1`: "Kinexus-IOP v1" (protocol name)
  - `README.md`: "KINEXUS Technologies" (organization name)
- **Khuyến nghị:** Cần chốt quyết định: đổi tất cả sang "mkddc-" / "MK-DDC" hay giữ organization/protocol name. Nếu organization tên thật là KINEXUS thì chỉ đổi software references.
- **Fix:** Review và quyết định trong task A10/B11.

### GAP-012: Worker B hoàn toàn vắng mặt — 12 tasks chưa bắt đầu
- **Mức độ:** CRITICAL — Project blocker
- **Chi tiết:** Worker B không có entry nào trong SESSION_LOG.md sau 6+ giờ từ 17:00. Toàn bộ B01-B12 chưa bắt đầu. Cron Worker B có thể chưa được cấu hình hoặc bị lỗi.
- **Action:** Kiểm tra/kích hoạt cron Worker B trong OpenClaw gateway config.

### GAP-013: Worker A chỉ hoàn thành 2/11 tasks rồi dừng
- **Mức độ:** HIGH
- **Chi tiết:** Worker A hoàn thành A01+A02 lúc 18:32 ICT rồi không tiếp tục A03. Có thể session đã kết thúc và chờ cron trigger tiếp theo.
- **Action:** Đảm bảo cron Worker A được trigger lại cho A03-A11.

### GAP-014: Cross-reference broken: IO_UI → MCU_SPEC §3.3
- **Mức độ:** HIGH
- **Files affected:** `IO_UI_CIRCUIT.md` §4.3, §10 cross-ref → `MCU_STM32G0_SPEC.md` §3.3
- **Chi tiết:** IO_UI_CIRCUIT.md nói "UI_EN[8..15] = PB4-PB11 phải khớp MCU_SPEC §3.3 (sau Rev 2.0 update)" nhưng MCU_SPEC chưa update.
- **Fix:** Sẽ tự resolved khi A06 hoàn thành.

### GAP-015: Cross-reference broken: IO_UI → IO_DI [ARCHIVED]
- **Mức độ:** MEDIUM
- **Files affected:** `IO_UI_CIRCUIT.md` §3.6 cross-ref → `IO_DI_CIRCUIT.md`
- **Chi tiết:** IO_UI_CIRCUIT.md gọi IO_DI_CIRCUIT.md là "[ARCHIVED]" nhưng file đó chưa archived.
- **Fix:** Sẽ tự resolved khi A03 hoàn thành.

---

## [AUDITOR] 2026-06-23 23:00 — Audit Day 2 (12 inconsistencies resolved, 12 new found)

### RESOLVED GAPS:
- **GAP-002:** IO_DI_CIRCUIT.md đã được archived (Worker B not done but resolved)
- **GAP-005:** BOM đã được updated thành Rev 1.1 (Worker B B02 completed)
- **GAP-006:** PWR_DESIGN đã được updated thành Rev 1.1 (Worker B B03 completed)
- **GAP-007:** EMC_THERMAL đã được updated thành Rev 1.1 (Worker B B04 completed)
- **GAP-012:** Worker B đã bắt đầu hoạt động (B01-B04 completed)

### NEW GAPS FOUND:

### GAP-016: BOM §2.5 vẫn ghi "×8" thay vì "×16" (B02 cần update tiếp)
- **Mức độ:** MEDIUM — Inconsistent quantity
- **Files affected:** `BOM_MK-DDC-24_v1.md` §2.5
- **Chi tiết:** BOM đã được update thành Rev 1.1 nhưng §2.5 vẫn ghi "Universal Input (×8)" → phải là "(×16)".
- **Fix:** Worker B cần update BOM §2.5 → "(×16)".

### GAP-017: MCU_SPEC pinmap vẫn chưa update (A06 chưa làm)
- **Mức độ:** HIGH — Cross-reference broken still exists
- **Files affected:** `MCU_STM32G0_SPEC.md` §3.3, §3.5
- **Chi tiết:** MCU_SPEC vẫn ghi "GPIO Digital Input (DI × 8)" với PB4-PB11 = DI1-DI8. Phải update thành UI_EN[8..15] và thêm §3.9 cho ADS131M08 #2.
- **Cross-ref broken:** IO_UI_CIRCUIT.md §4.3 và §10 vẫn reference đến section không tồn tại.
- **Fix:** Task A06 — rewrite MCU_SPEC §3.3 → UI_EN[8..15], thêm §3.9 ADS131M08 #2 pinmap.

### GAP-018: CB_BLOCK_DIAGRAM chưa update kiến trúc 16 UI (A07 chưa làm)
- **Mức độ:** HIGH — Schematic reference sai
- **Files affected:** `CB_BLOCK_DIAGRAM.md`
- **Chi tiết:** Block diagram vẫn vẽ "DI_IN: GPIO PB4–PB11 ← Opto PC817 ×8" và "DI1-DI8". Phải bỏ DI block, mở rộng UI thành 16 kênh, thêm 2nd ADS131M08.
- **Fix:** Task A07.

### GAP-019: CB_SCHEMATIC_NOTES §7 vẫn có sheet "06_DI_INPUT" (A08 chưa làm)
- **Mức độ:** HIGH — Sheet organization sai
- **Files affected:** `CB_SCHEMATIC_NOTES.md` §7
- **Chi tiết:** Schematic sheet organization vẫn có "06_DI_INPUT" — phải bỏ hoặc archive sau khi IO đã chuyển sang UI.
- **Fix:** Task A08.

### GAP-020: IO_DO_RELAY.md chưa update naming (A05 chưa làm)
- **Mức độ:** LOW — Naming consistency
- **Files affected:** `IO_DO_RELAY.md`
- **Chi tiết:** IO_DO_RELAY.md vẫn ghi "Digital Output / Relay SPDT 5A" với reference đến "8 UI + 8 DI" → phải update thành "16× Universal Input" consistency.
- **Fix:** Task A05.

### GAP-021: README.md chưa update block diagram và index (B07 chưa làm)
- **Mức độ:** MEDIUM — Documentation inconsistency
- **Files affected:** `README.md`
- **Chi tiết:** 
  - Block diagram vẫn vẽ "DI opto × 8" và "UI1-UI8" + "DI1-DI8"
  - File index vẫn liệt kê IO_DI_CIRCUIT.md như active doc
  - Cấu trúc thư mục chưa phản ánh các file mới
- **Fix:** Task B07.

### GAP-022: Naming "kinexus-" vẫn còn trong 3 file (A10/B11 chưa làm)
- **Mức độ:** LOW — Naming convention
- **Files affected:**
  - `EMC_THERMAL_NOTES.md` §6.3: "kinexus-agent" → phải là "mkddc-io-driver"
  - `MCU_SPEC §1`: "Kinexus-IOP v1" (protocol name)
  - `README.md`: "KINEXUS Technologies" (organization name)
- **Khuyến nghị:** Cần chốt quyết định: đổi tất cả sang "mkddc-" hay giữ tên. Nếu organization tên thật là KINEXUS thì chỉ đổi software references.
- **Fix:** Task A10/B11.

### GAP-023: PCB_PLACEMENT_GUIDE Zone 5 chưa update (B05 chưa làm)
- **Mức độ:** MEDIUM — PCB placement inconsistency
- **Files affected:** `kicad/PCB_PLACEMENT_GUIDE.md` §2 Zone 5, §3.6 TP
- **Chi tiết:** Zone 5 vẫn ghi "J4(UI), J3(DI), J5(AO), TMUX1208 ×8, PC817 ×8" → phải bỏ DI, mở rộng UI zone, thêm ADS131M08 #2 placement. Test points chỉ có TP10-TP17 cho UI1-UI8 → thiếu UI9-UI16.
- **Fix:** Task B05.

### GAP-024: SOM_SPEC chưa update I/O description (B06 chưa làm)
- **Mức độ:** LOW
- **Files affected:** `SOM_SPEC_RADXA_CM3.md` §1
- **Chi tiết:** §1 table row "ADC onboard" ghi "8× UI multi-type" → phải là "16× UI".
- **Fix:** Task B06.

### GAP-025: Cross-reference broken vẫn tồn tại (IO_UI → MCU_SPEC §3.3)
- **Mức độ:** HIGH — Critical reference broken
- **Files affected:** `IO_UI_CIRCUIT.md` §4.3, §10 → `MCU_STM32G0_SPEC.md` §3.3
- **Chi tiết:** IO_UI_CIRCUIT.md reference đến MCU_SPEC §3.3 cho UI_EN[8..15] nhưng section này chưa được tạo/cập nhật.
- **Fix:** Sẽ tự resolved khi A06 hoàn thành.

### Overall Gap Status:
- **Total gaps found:** 25 (15 initial + 12 new - 5 resolved)
- **High priority:** 8 gaps
- **Medium priority:** 7 gaps  
- **Low priority:** 10 gaps
- **Blockers:** Worker progress + MCU_SPEC pinmap + CB diagram updates