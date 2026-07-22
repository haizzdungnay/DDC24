# CHANGELOG — MK-DDC-24

> Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), version theo [SemVer](https://semver.org/lang/vi/).
> Đây là changelog **toàn dự án** (tài liệu + sản phẩm). Mỗi tài liệu còn có Revision History riêng ở cuối file.
> Loại thay đổi: `Added` (thêm), `Changed` (sửa), `Fixed` (vá), `Deprecated`, `Removed`, `Security`.

---

## [Unreleased]
### Changed — ADR-016 local limited-operator HMI specification and microtask plan (2026-07-22)
- hmi/product: selected the existing 2.4-inch local HMI, not a Web HMI, with five surfaces `Home/Points/Control/Alarms/Service`; communication/system diagnostics are consolidated rather than removed.
- hmi/control: specified authority-whitelisted setpoint/mode/override/release, bounded TTL/reason/explicit release, effective source/priority, authoritative alarm ACK and read-only degradation when broker/core is unavailable.
- hmi/security: specified short-lived fail-closed sessions, RBAC/audit/idempotency and removal of static role/PIN production privilege, direct process signals, `CAP_SYS_BOOT` and direct reboot from `mkddc-hmi`.
- docs/implementation: aligned product, requirements, architecture, interfaces, source specs, HMI design/UC/UX, integration/DoD/release documents and the existing review report; replaced the active six-screen plan with 54 microtasks `HOP-000..077` covering contract, broker, core, HMI model/UI, privilege removal and evidence.
- verification: hardware documentation closure harness 18/18 pass; 337 local Markdown links across 38 ADR-016-related files resolve; 54 unique HOP headings; active-scope conflict scan and `git diff --check` pass.
- repository: ignore generated `build_*` directories so local Core/IOBus build trees and binaries are not committed with the source/documentation baseline.
- status: documentation/plan only; source remains partial and the HMI production gate remains RED pending implementation, host/integration tests and target usability evidence.

### Changed — HW/FW/SOM/HMI design reconciliation and review (2026-07-22)
- hw/docs: reconciled the active hardware baseline to Radxa CM3 onboard-PHY boundaries, JD9852 MIPI DSI + FT5436 I2C, and explicit carrier/power/backlight/button/DT gates; removed stale ILI9341/SPI/fbdev assumptions.
- fw/docs: classified STM32 FreeRTOS/IOP/ADC/AO/DO/watchdog content as target design because `fw/Core/Src/main.c` and `fw/mkddc-fw.ioc` are placeholders; added implementation/HIL blockers.
- hw/safety: reopened relay/driver selection, removed the unsupported 10k pull-up compatibility claim, and added HMI integration, MCU implementation and relay-driver rows to the hardware closure register.
- hmi/docs: reframed the 2.4-inch display as a local status/commissioning/service panel; added authoritative alarm ACK/audit, fail-closed identity/RBAC, explicit unknown/unavailable state and operator-usability gates aligned as design guidance to IEC 60073/62682/62443, ISO 9241-210 and ISA-101.
- hmi/config: corrected the packaged example inventory from UI8+DI8 to the Rev A base UI16+AO4+DO4.
- records: added `KX-DDC24-HW-FW-SOM-HMI-REVIEW-2026-07-22.md` with source-aligned findings, Siemens/Rockwell/Honeywell benchmark, NO-GO decisions and closure plan.
- verification: hardware-doc harness 18/18 pass; HMI Debug build pass and direct HMI suite 23/23 pass; packaged point DB JSON/count assertion pass; normalized internal Markdown links 0; `git diff --check` pass. The aggregate temporary CTest invocation also listed two intentionally unbuilt core/iobus targets, so only the direct HMI result is claimed. Host/docs results do not claim HIL, EMC, IEC conformity or manufacturing readiness.

### Restored — Complete HW/FW/SW design corpus (2026-07-22)
- docs/recovery: restored all 47 archived hardware-design Markdown sources, all 10 firmware-design sources, all 12 software-design sources, all 6 interface-design sources, all 17 source specifications, and all 35 implementation guides from the verified pre-cleanup archive.
- docs/structure: placed lifecycle sources under `docs/01_specs`, `docs/02_design`, and `docs/03_implementation`; retained controlled baselines and hardware design under `docs/04_design`; separated 24 hardware findings/audit/risk records into `docs/07_records/reviews/hardware`.
- docs/control: added active firmware baseline and controlled indexes; recovered detail is `In Review`, while top-level baseline documents, shared headers, decisions, and tested code retain authority.
- harness: updated `check_hw_doc_closure.py` for the controlled baseline/detail/record locations while preserving the 41-finding closure assertions.
- verification: hardware-doc harness passed 18/18; the repository now has 177 active Markdown files (172 under `docs/`), 0 normalized broken internal links, 0 empty project directories, the recovery archive SHA-256 remains unchanged, and `git diff --check` passed.

### Removed — Empty project directories (2026-07-22)
- repository: removed empty project-authored directories left after the Markdown dossier cleanup; dependency, VCS, build, distribution, and cache trees were excluded.
- Verification: rescanned the same scope after cleanup and confirmed no empty directories remain.

### Changed — Controlled Markdown dossier restructure (2026-07-22)
- docs: consolidated the active project documentation into a 12-file controlled dossier covering governance, decisions, product, requirements, architecture, interfaces, software, hardware, verification, operations, and traceability.
- docs: reconciled Rev A to 16 UI + 4 AO + 4 DO, three mandatory core services plus feature-gated HMI, IOP v2 2 ms/500 Hz timing, SHM v4, JD9852/MIPI HMI, and the 28 implemented graph node types.
- docs: normalized duplicate ADR identifiers, removed superseded/duplicated Markdown from the active tree, and retained unresolved hardware/manufacturing items as an explicit RED release gate.
- docs: relocated the retained OpenAPI, BACnet pretest, certification helper, and signing-key artifacts from legacy folders into `docs/04_design` and `docs/07_records` without deleting their content.
- archive: captured all 303 pre-restructure Markdown files in `archives/markdown-before-restructure-2026-07-22.tar.gz`, with per-file SHA-256 manifest and archive checksum recorded in document control.
- Verification: archive contains 303/303 source Markdown files with SHA-256 `60b6631dfdc1395f4292960097872417d149f2572eb15fd2e224aa869cd98857`; active tree has 17 Markdown files total (12 under `docs/`) and 0 broken internal Markdown links; `git diff --check` passed.

### Changed — Agent communication rule cleanup (2026-07-02)
- agent workflow: removed the forced personalized form of address from `AGENTS.md` and replaced the remaining personalized changelog exception with neutral wording.
- Verification: repository-wide hidden-file search found no remaining references to the removed form of address.

### Fixed — FW SOM AO physical-unit boundary (2026-07-02)
- core/iobus: made the SHM AO contract consistently physical (`0..10V` or `4..20mA`), removed the second engineering-range conversion at the MCU command boundary, and made graph AO conversion follow the electrical mode actually acknowledged by the MCU.
- safety/config: reject non-finite or out-of-range AO commands before SHM output, fail startup when `SET_AO_CFG` is not acknowledged, and require a coordinated service restart for AO mode changes instead of hot-applying mismatched modes.
- BACnet: keep configured engineering units such as percent in the BACnet Priority Array, but convert the winning value exactly once to physical V/mA before forwarding it to core.
- Verification: clean Debug build + CTest passed 285/285; BACnet-enabled build + CTest passed 286/286; SHM v4 layout assertions synchronized to `ui_unit=176`, `ui_raw_unit=304`, size 528.

### Fixed — ADR-011/012 BACnet alignment integration review (2026-07-01)
- shm/consumers: restored the v3 `ui_raw[]`/`ui_raw_unit[][]` fields alongside `ui_reliability[]`, bumped the combined SHM contract to `0x4B584404` (v4), and synchronized web offsets/size; this prevents stale-layout web reads and restores `shm_dump_io` compilation.
- iobus/reliability: preserved ADS131M08 divider/shunt scaling and per-channel calibration on the runtime reliability path; transient poll failures now publish `UNRELIABLE_OTHER`, IOP/ADC failures publish `COMMUNICATION_FAILURE`, and raw live values remain published.
- BACnet/AO: corrected AI V/mA Units to BACnet 5/2, Pa to 53, and the documented CONFIGURATION_ERROR enum to 10; kept AO Object_Name storage alive for bacnet-stack, made directed Who-Is return unicast I-Am, refreshed engineering conversion on metadata-only reloads, and validated AO name/units/min/max in both iobus and web config paths.
- hmi/build: checked GPIO/backlight sysfs writes and proc/sysfs reads so the SHM v4 consumer build remains clean under fortified GCC `-Werror`.
- Verification: clean `MKDDC_ENABLE_BACNET=ON` build including `mkddc-iobus`/`shm_dump_io`; iobus CTest 159/159; core CTest 123/123; HMI CTest 23/23; `go test ./...` pass; frontend build/lint pass; real UDP/47808 local BTL smoke 14/14 (Who-Is/I-Am, reads, AV/AO writes, AO property readback/relinquish), with AO1 50% confirmed as DAC raw 32768 through fake MCU.

### Changed - Outputs AO real-only controls (2026-07-01)
- fe(outputs): restricted AO wizard/advanced/summary to wired signal type, physical safe value, and integer 0..100 manual command; removed AO EasySet demo rows/badges from the page. Min/Max stays out of Outputs because the only current source is graph `AO_Output.limit_lo`/`limit_hi`, not IO config. Verification: `npm run build` pass; `npm run lint` pass.

### Changed - Controller Diagram terminal layout (2026-07-01)
- fe(diagram): swapped AO/DO terminals to the top and UI terminals to the bottom, aligned the I/O Summary CPU/Memory/Temp dials on one row, and removed detailed RAM MB text from the Memory dial. Verification: `npm run build` pass; `npm run lint` pass; Chrome headless smoke at `http://127.0.0.1:5175/` confirmed AO/DO render before UI and no RAM MB detail remains in the SVG.

### Changed - Controller Diagram navigation entry (2026-07-01)
- fe(nav): hid the Engineering sidebar `Controller Diagram` entry while keeping `/eng/diagram` available from the dashboard `Open` button. Verification: `npm run build` pass; `npm run lint` pass; Chrome headless smoke at `http://127.0.0.1:5175/` confirmed the sidebar link is hidden and the dashboard `Open` button still routes to `/eng/diagram`.

### Changed - Dashboard CPU and IOP metrics cards (2026-07-01)
- web/fe(dashboard): removed CPU/RAM tiles from IOP / Scan Metrics, added exact CPU percent plus optional CPU clock detail under CPU Load, and exposed Linux cpufreq as `cpu_clock_mhz`/`cpuClockMhz` when available. Verification: `npm run build` pass; `npm run lint` pass; `go test -count=1 ./...` pass in `web/backend`; Chrome headless smoke at `http://127.0.0.1:5175/` confirmed IOP metrics only show Overall/IOP latency and CPU Load shows exact percent plus clock detail when available.

### Changed - FE dashboard controller diagram layout (2026-07-01)
- fe(dashboard): replaced the I/O overview card with the reusable Controller Diagram, tightened dashboard grids/padding, and reused the same diagram component on the engineering diagram page. Verification: `npm run build` pass; `npm run lint` pass; Chrome headless smoke at `http://127.0.0.1:5175/` confirmed dashboard renders `Controller Diagram` SVG.

### Fixed - SHM v4 raw/reliability contract reconciliation (2026-07-01)
- shared/iobus/core/web: reconciled UI raw live-data fields with `ui_reliability[]`, bumped `KX_SHM_MAGIC` to `0x4B584404`, updated Go SHM offsets from `offsetof`, and added layout/status regressions. Verification: `go test -count=1 ./...` pass in `web/backend`; C++ CMake not run locally because Windows PATH lacks `cmake` and WSL lacks `cmake`/`g++`.

### Changed — Hardware documentation closure and ADR-010 baseline reconciliation (2026-06-30)
- Reconciled canonical product, Rev A scope, HW/PRD/SRS/DS, firmware/software design, implementation, HMI, manuals and certification-prep documents to **16 UI + 4 AO + 4 DO**, no base-SKU industrial DI, and IOP v2 **2ms/500Hz**.
- Marked the IOP v1 interface/freeze documents superseded; current authority is ADR-010 plus `shared/iop_protocol.h`.
- Removed unsupported power, EMC, thermal and manufacturing release claims; evidence gates remain RED in `hardware-design/hw_design_review/HW_DOC_REVIEW_CLOSURE_PLAN.md`.
- Expanded the deterministic hardware-doc harness to catch stale 10ms timing and 8 UI + 8 DI baseline regressions.

### Fixed - UI Inputs signal type 2 current variant (2026-06-30)
- fe(inputs): added a type-2-only Volt/Current selector so `2-10V` and `4-20mA` round-trip without forcing current channels back to voltage; Summary now shows separate `Raw (V)` and `Raw (mA)` cells and hides raw cells for dry-contact booleans. Verification: `npm run build` pass; `npm run lint` pass.

### Changed - UI hardware scaling reconciliation (2026-06-30)
- docs/iobus: aligned UI current shunt documentation to 49.9Ω and documented ADS131M08-based transfer formulas plus per-channel two-point calibration hook.
- iobus: recalibrated UI raw/engineering scaling for ADS131M08 VREF=2.44V, 100k/12.1k voltage divider, and 49.9Ω current shunt; AO scaling, SHM layout, IOP contract, and FE files are unchanged in this scope. Verification: Orange Pi `cmake --build` pass, full `ctest` 148/148 with 2 IoCache skips due live SHM, `ctest -R IoScaling` 19/19 pass.

### Added - UI Inputs raw live data pipeline (2026-06-30)
- docs/contract: accepted ADR-011, extended `kx_io_shm_t` with `ui_raw[]` + `ui_raw_unit[][]`, and bumped `KX_SHM_MAGIC` `0x4B584402` → `0x4B584403`; deploy requires rebuilding iobus/core/web together.
- iobus/tools: `mkddc-iobus` now computes raw electrical V/mA from IOP ADC samples, writes `ui_raw[]`/`ui_raw_unit[][]`, and `shm_dump_io` includes raw values.
- web/fe: `/points` exposes `raw`/`rawUnit`; Inputs Summary shows Raw for analog channels and treats dry-contact channels as ON/OFF without raw/min/max/avg numeric stats.

### Fixed - UI input config save deployment (2026-06-29)
- deploy(web): rebuilt and restarted Orange Pi `mkddc-web-pi` with the 16-channel UI config validator so `/system/config/io` accepts `ui[].ch` values `1..16`; smoke verified `ch=16` no longer returns the old `1..8` range error.

### Fixed - Fake MCU trend waveform cadence (2026-06-29)
- tools(fake_mcu): slowed simulated UI wave periods so the 10s backend historian no longer aliases 0-10V/4-20mA inputs into dense sawtooth trend charts.

### Fixed - Live point demo metadata fallback (2026-06-29)
- fe(points): live REST/WS point updates now reuse original demo names, units, sensor types, and trend buffers when backend points only carry generic IDs like `UI-01`/`DO-01`.
- fe(realtime): merging live point updates now preserves existing metadata instead of replacing the whole point object. Verification: `npm run build` pass.

### Fixed - Fake MCU binary cadence regression (2026-06-29)
- tools(fake_mcu): restored UI13/UI14 dry-contact toggle cadence to the original visible cycle; DO feedback remains command-driven by core `SET_DO`. Verification: built on Orange Pi, installed `/usr/local/bin/mkddc-fakemcu`, restarted `mkddc-fakemcu` + `mkddc-iobus`, and smoke verified `/points` UI13/UI14 toggling.

### Changed - Fake MCU simulation values restored (2026-06-29)
- tools(fake_mcu): restored original fake MCU waveform constants so code fixes no longer alter the baseline simulated data. Verification: rebuilt/reinstalled on Orange Pi and smoke verified `/points` UI13/UI14 still toggles.

### Fixed - EasySet UI u0-u7 FE/BE/FW sync (2026-06-29)
- fe(inputs): removed unused `u8`/`u9` wizard and advanced registers; `u0..u7` remain visible and saved.
- fe/backend: AI input save payload now preserves `scale_lo`, `scale_hi`, `range_mult`, `unit`, `filter_samples`, `sensor_cal`, and `math_func`; backend accepts UI channels `1..16`.
- fw(iobus): `mkddc-iobus` now reads web `io_config.conf`, consumes EasySet UI `u0..u7`, applies range scaling, moving average filter, sensor calibration, dry-contact invert, and math average/min/max before writing SHM/BACnet units.
- docs/deploy: updated `io_config.conf` schema note and systemd `mkddc-iobus` config path. Verification: `go test ./...` pass; `npm run build` pass; modified C++ config/scaling sources compile with `g++ -Werror`; full CMake unavailable in local PATH/WSL.

### Fixed - Trend chart time-axis rendering (2026-06-29)
- fe(trends): fixed distorted trend rendering by preserving numeric timestamps from `/history`, sorting/deduping samples by time, appending only live samples newer than the latest historian point, and drawing linear chart segments instead of smoothed monotone curves.

### Fixed - Live historian, realtime points, and UI config sync (2026-06-29)
- web: fixed `/points` on Orange Pi by decoding SHM v2 magic `0x4B584402` and the 16-UI layout; `/points` now returns 16 UI, 4 AO, 4 DO plus virtual BACnet points.
- web: enabled persistent trend history from backend runtime via SQLite `TrendStore`; default historian cadence is 10s with 8640 records per point (about 24h).
- web: normalized point IDs to FE-facing `UI-01..UI-16`, `AO-01`, `DO-01`; `/history` still reads older `AI1`/`AI-01`/`DI1`/`AO1` rows through aliases and returns canonical keys.
- fe(trends): chart now merges backend `/history` with the live 1s display tail, so refresh/logout no longer resets visible trend history to the browser session.
- fe(points): normalized legacy point IDs from REST/WS/history and kept selected trend preferences in local storage.
- fe(monitoring): added double-click point details modal with editable point name/unit, unit dropdown, force output/release flow, and local fallback for unsupported point config endpoint.
- deploy: rebuilt and restarted `mkddc-web-pi` on Orange Pi `192.168.1.18:8081`; smoke verified `/points`, `/history`, core, and IOP.

### Changed - Agent workflow rule (2026-06-29)
- Added root `AGENTS.md` rule: every code, config, deployment, or documentation change must update `CHANGELOG.md` in the same work session unless explicitly told not to.

### Added — ADR-010 EasySet Parity Config Surfaces
- fe(outputs): thêm `/eng/outputs` cho 4 AO + 4 DO, Summary/Wizard/Advanced; wire AO mode, AO/DO safe-state, manual force; field graph-level demo-local.
- web: io config validate chấp nhận đủ AI signal type (`none`/`potentiometer`/`light`/`pulse`) + `filter_samples`/`sensor_cal`/`math_func`.
- web: io config `ui[]` chấp nhận field `note` (ghi chú per-AI).
- fe(AI inputs): full register u0-u9 + Signal Type 0-8 đúng EasySet, Range Multiplier/Math Function/Units full labels.
- fe(AI inputs): wizard dùng dropdown + nhảy bước, fix nút Hoàn tất, popup OK/Cancel khi lưu → chuyển Advanced.
- fe(AI inputs): Advanced luôn hiển thị đủ u0-u9 và Wizard đi đủ bước trước khi Hoàn tất.
- fe(AI inputs): Wizard bỏ cụm lựa chọn dạng card/trắc nghiệm; nhảy bước bằng dropdown gọn.
- fe(AI inputs): Wizard đủ tab u0-u9 để chuyển nhanh từng thanh ghi đã cấu hình.
- fe(AI inputs): thêm tab Summary (Live Data + Reset, biểu đồ live, Notes riêng từng AI).
- fe(AI inputs): Summary nhận live point `AI1`/`AI-01`, ưu tiên dữ liệu OrangePi và chỉ fallback demo khi thiếu live.
- fe: thêm trang User Parameters (mock demo-only kiểu EasySet, chưa nối backend).
- Added Alarm Wizard/Advanced parity.
- Added AI/DI Inputs configuration surface.
- Added Controller Diagram read-only commissioning view.
- Added Auxiliary Functions node-compose wizard.
- Kept backend REST/WS unchanged under Rev A demo-local scope.

### Fixed — FE i18n VI dấu + English mode thật (2026-06-17)
- Chuẩn hóa text tiếng Việt có dấu trên shell và 12 trang frontend ADR-009; bỏ các chuỗi không dấu kiểu `Binh thuong`, `Da luu`, `Mat khau`.
- Bổ sung helper i18n để các nhãn/nút/toast chính đổi theo VI/EN; không đổi REST/WebSocket contract.
### Fixed — FE Monitor binary ON/OFF colors (2026-06-17)
- Monitor I/O hiển thị ON/active bằng xanh lá (`--c-good`/`--c-good-fg`) và OFF/inactive bằng xám (`--c-off`); không tô đỏ trạng thái nhị phân chỉ vì DI-01 đang ON.
- Không đổi REST/WebSocket contract.
### Changed — FE áp bộ màu Level B hybrid (vàng-làm-nền/warn-fg, green normal, gray off, trend amber) (2026-06-16)
- Thêm token `--c-good-fg`/`--c-off`/`--c-warn-fg`/`--c-fault-fg`; tách `statusColor()` cho chữ/đường và `statusFill()` cho dot/nền/arc.
- Dashboard/StatusBadge/Gauge/TrendChart/Trends dùng green normal, gray off, amber sẫm cho trend/cảnh báo và không còn chữ vàng mảnh khó đọc; không đổi REST/WebSocket contract.
### Changed — ADR-009 amend Level A→B + UX-SYSTEM bộ màu trạng thái SCADA (2026-06-16)
- ADR-009 giữ Accepted nhưng chuyển triết lý màu từ Level A pure sang Level B hybrid: nền xám sáng + nav 3 nhóm, normal/online dùng xanh SCADA.
- UX-SYSTEM cập nhật token trạng thái `--good`/`--off`/`--warn`/`--alarm`/`--critical`/`--force` và `*-fg` cho chữ/đường trên nền sáng; không đổi code hoặc REST/WebSocket contract.

### Changed — FE sticky top status bar/NavRail (2026-06-16)
- `TopBar` cố định khi cuộn; reconnect banner bám dưới top bar để trạng thái kết nối luôn thấy.
- `NavRail` cố định bên trái với vùng nav tự cuộn; không đổi REST/WebSocket contract.

### Changed — Dashboard dynamic metrics normal xanh, warn/fault theo ngưỡng (2026-06-16)
- Online/OK/uptime/metric trong ngưỡng bình thường dùng xanh lá; CPU/RAM/nhiệt/scan vượt ngưỡng chuyển cam hoặc đỏ theo chuẩn owner adjustment ISA-101.
- Cập nhật ADR-009/UX-SYSTEM/08_WEB/10_TASK_CHECKLIST; không đổi REST/WebSocket contract.

### Changed — FE indicator dot OK/ONLINE xanh, OFF xám (2026-06-16)
- Bổ sung token --c-indicator-ok/--c-indicator-off; chấm/icon nhỏ OK/ONLINE/ON/GOOD dùng xanh lá, OFF/OFFLINE/unknown dùng xám; fault/warn/force giữ màu cảnh báo.
- Cập nhật ADR-009/UX-SYSTEM/08_WEB ghi ngoại lệ compact indicator; không đổi REST/WebSocket contract.

### Changed/Added — FE hoàn tất tái cấu trúc ISA-101 (P3/3) (2026-06-16)
- Thay stub P2 bằng trang thật `/me`, `/settings/display`, `/settings/time`, `/eng/alarm-settings`; nâng `/settings/device`, gộp `/health` vào Dashboard và bỏ route riêng.
- Đổi `/eng/programming` sang ProgrammingPage với thư viện component + `graph.json` validate/deploy demo; dọn nền tối còn sót theo token Level A, không đổi REST/WebSocket contract.

### Changed — FE điều hướng 3 nhóm + routing mới (P2/3) (2026-06-16)
- NavRail gom 3 nhóm Overview/Settings/Engineering theo ADR-009, có thu gọn và active state trung tính.
- Routing frontend chuyển sang path mới, thêm stub P3 và redirect path cũ; không đổi REST/WebSocket contract.

### Changed — FE áp design tokens ISA-101 Level A (P1/3) (2026-06-16)
- Frontend đổi `--c-*` sang Level A nền xám sáng, bỏ dark/cyan glow và chuyển `color-scheme: light`.
- `statusColor`/`StatusBadge` áp normal trung tính + warn/fault/force/critical đúng chuẩn; badge luôn có icon+chữ, không đổi REST/WebSocket contract.

### Changed — UX-SYSTEM áp ISA-101 Level A + ADR-009 Accepted (2026-06-16)
- ADR-009 chuyển `Accepted` theo owner duyệt ngày 2026-06-16.
- UX-SYSTEM cập nhật tokens Level A nền xám sáng, nguyên tắc HMI high-performance và phân cấp điều hướng 3 nhóm Overview/Settings/Engineering.

### Added — ADR-009 (2026-06-16): áp ISA-101 Level A + tái cấu trúc IA 3 nhóm web UI (Status: Accepted)
- Thêm `docs/adr/ADR-009-isa101-hmi-and-nav-restructure.md` để ghi quyết định về high-performance HMI Level A, điều hướng 3 nhóm Overview/Settings/Engineering, tách Alarm log/Alarm settings, gộp System Health vào Dashboard và đổi Validator thành Programming. Không đổi code, UX-SYSTEM hay REST/WebSocket contract.

### Changed — Docs sync theo 4 trang frontend (2026-06-16)
- **`08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md`** (Rev 1.1 → 1.2): cập nhật danh sách trang frontend Rev A thực tế (§1, 12 trang) + ghi chú trạng thái demo 4 trang Trends/Scheduler/Network/Validator khớp spec; làm rõ **KHÔNG** đổi REST/WebSocket contract §2.
- **`KX-DDC24-FE-DEVGUIDE-001_VI.md`** (Rev 1.0 → 1.1): thêm block "Trạng thái triển khai Rev A (2026-06-16)" + trỏ chéo 08_WEB/CHANGELOG; thêm dòng Revision History.

### Changed — Frontend Rev A: chỉnh 4 trang theo spec (2026-06-16, demo UI client-side)
- **Trends:** thêm filter object-list (chọn điểm AI/AO) + time-range 30m/1h/6h/24h; biểu đồ + bảng thống kê (current/avg/min/max) cập nhật động; bỏ các nút tĩnh không hoạt động. `getTrendSamples(pointIds, rangeMinutes)` sinh dữ liệu theo lựa chọn. Phản ánh mô hình BACnet Trend Log do kỹ sư cấu hình (SRS IDE-024/025).
- **Scheduler:** bỏ chế độ "Tháng" (không có trong spec); chuyển sang template **BACnet Weekly_Schedule** 7 ngày (CN–T7) tự lặp hằng tuần; sửa ô lịch qua modal (state local, demo); thêm placeholder khu Exception_Schedule/holiday. Khớp PRD FR-004 / DS "ngày/tuần/exception".
- **Network:** bỏ mô hình cây "controller quản lý DDC con" (sai kiến trúc). Dựng lại theo ARCH-R010: **Northbound** BACnet/IP server lên BMS (IP/DHCP/WiFi/Device ID/port + trạng thái BMS link) + **Southbound** Modbus RTU master với bảng slave (addr/profile/baud/poll-state/error-rate). Các DDC-24 là peer độc lập, không quản lý lẫn nhau.
- **Validator:** thay textarea JSON ad-hoc bằng kiểm tra `graph.json` có cấu trúc theo GRAPH_SCHEMA với **4 check Rev A** (input chưa nối · output nhiều nguồn ghi · AO thiếu limit · Modbus/sensor thiếu fallback); list lỗi theo severity; nút Deploy (demo) chỉ bật khi pass. Không IEC 61131-3 (theo ADR-004 → Rev C).

### Added — Frontend Rev A: types + simulator cho 4 trang (2026-06-16)
- Thêm types graph (`Graph`/`GraphNode`/`GraphLink`/`io_map`/`GraphValidationResult`) và network (`NetworkConfig`/`ModbusSlave`/`NetworkData`/`PollState`) trong `src/frontend/src/types.ts`.
- Cập nhật `src/frontend/src/demo/simulator.ts`: `validateGraphLocal()` parse graph + 4 check; `getDemoNetwork()` trả north/southbound; `getDemoSchedule()` dùng nhãn tuần chung (CN–T7); `getTrendSamples()` nhận `(pointIds, rangeMinutes)`.
- Phạm vi: chỉ UI + simulator client-side — **KHÔNG** đổi REST/WebSocket contract, không nối backend. Verification: code đã soát khớp 4 mục tiêu; cần chạy `npm run typecheck`/`npm run build` local để xác nhận xanh.

### Added — Frontend Rev A demo/live UI (2026-06-16)
- Thêm `src/frontend/` React 18 + TypeScript strict + Vite 5 + Tailwind CSS v4 cho web cấu hình local MK-DDC-24.
- Hoàn thiện app shell industrial dark theo mockup `viduUI/`: Login, Dashboard, Monitor I/O, Alarms, Trends, Scheduler, Network, Users, Settings, System Health, Commissioning, Validator.
- Tích hợp contract REST `/api/v1` và WebSocket `/ws/v1/events`; có demo mode chạy không cần board và live mode qua `VITE_DDC_MODE=live` / `VITE_PROXY_TARGET`.
- Thêm auth abstraction mock/JWT/X-API-Key, lưu token in-memory; không dùng localStorage/sessionStorage.
- Thêm simulator 24 I/O realtime, health, alarm, trend, schedule, network và user data để kiểm thử UI Rev A.
- Verification: `npm run build` pass; `npm audit --omit=dev` sạch. Dev audit còn advisory Vite 5/esbuild, không force-upgrade vì stack Rev A đang khóa Vite 5.

### Fixed — Audit code↔docs (2026-06-15): reconcile 3 frozen specs theo kinexus→mkddc rename
- **`SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md` (HIGH):**
  - §8 Startup Sequence bước 1: `kinexus-io-driver.service start` → `mkddc-iobus.service start`
  - §9.1 IOP-SW-001: `kinexus-io-driver` → `mkddc-iobus` (C++17)
  - §9.1 IOP-SW-004: `/kinexus/io_data` → `/dev/shm/mkddc_io_shm`
    (format `kx_io_shm_t` trong `shared/mkddc_shm.h`)
  - Bump rev 1.1 → 1.2 · thêm Revision History
  - Lưu ý: tên giao thức "Kinexus-IOP v1.1" được canonical chấp nhận (xref ADR-0008)
    — chỉ đổi tên service + SHM path. Header files trong `shared/` vẫn là nguồn-chuẩn.
- **`SW_REQUIREMENTS_MK-DDC-24_VI.md` (HIGH):**
  - §2.2 wrap inline struct cũ `kinexus_io_shm_t` trong `<details>` để tránh nhầm với
    struct thật `kx_io_shm_t` trong `shared/mkddc_shm.h`. Bump rev 1.0 → 1.1-DRAFT
    (note cho SW Lead review).
- **`SW_ARCH_SPEC_MK-DDC-24_VI.md` (HIGH):**
  - Wrap cả §2 (IPC Architecture 7 service `kinexus-*` + path cũ
    `/dev/shm/kinexus_*_shm`) trong `<details>`. Giờ chỉ Rev A 3-process `mkddc-*`
    visible. Kèm link trỏ tới `shared/mkddc_shm.h` + ADR-005.

Không có thay đổi về giá trị thực thi (opcode, payload, CRC, FAULT bit, RESET reason).
Spec chỉ được điều chỉnh để khớp code đã triển khai. Audit report đầy đủ: xem chat
audit 2026-06-15.

### Changed — Doc restructure ISO (2026-06-08, branch `chore/doc-restructure`)
- **Tái cấu trúc thư mục tài liệu về 1 cây** (đóng ISO 9001 §7.5 nonconformity G1/G3):
  root `PRD/SRS/DS/HW_SPEC` + `spec/*` → `docs/01_specs/`; `design/*` → `docs/02_design/`
  (software/firmware/interfaces/_templates). Root chỉ còn `README.md` + `CHANGELOG.md`.
  Di chuyển 45 file bằng `git mv` (giữ history); **tính lại toàn bộ link** (79 file) — broken-link = 0.
- **Master Register cover 100%** (đóng G2): thêm PRODUCT_DEFINITION, REVA_SCOPE, GRAPH_SCHEMA,
  ISOGAP + section ADR-001..007.
- Thêm `QA-ISOGAP-001` (nay đã archive) — gap assessment theo §7.5 + kế hoạch.
### Changed — ⚠ BREAKING (PIVOT-2026-06-08): Component-based DDC + 3-process + Go web
- **Mô hình điều khiển:** chuyển từ **IEC 61131-3 soft-PLC (FBD/ST)** sang **component-based
  graph runtime**. Artifact deploy = `graph.json`. IEC 61131-3 → Rev C. ([ADR-004](docs/00_governance/DECISIONS.md))
- **Kiến trúc SOM:** 7 service `kinexus-*` → **3 process `mkddc-*`** (`mkddc-core` C++ real-time,
  `mkddc-iobus` C++, `mkddc-web` Go), chia theo real-time boundary. HMI/agent/OTA/cloud → deferred
  Rev B+. Watchdog = systemd + HW. ([ADR-005](docs/00_governance/DECISIONS.md))
- **Web/UI:** backend Python/FastAPI → **Go**; frontend Svelte → **React**; Rev A UI = **form +
  import `graph.json`**, bỏ FBD drag-drop (canvas → Rev B); validator = **Go library** (bỏ Rust
  service). ([ADR-006/ADR-007](docs/00_governance/DECISIONS.md))
- **Naming:** retire codename `kinexus-*` → brand `mkddc-*` (rename `kinexus_shm.h`→`mkddc_shm.h`
  là task implementation riêng; hợp đồng shm/IOP với MCU giữ nguyên).
### Added — PIVOT-2026-06-08
- **Nguồn-chuẩn mới:** `PRODUCT_DEFINITION` và `REVA_SCOPE_ROADMAP` (nay đã hợp nhất vào [Product Baseline](docs/01_product/PRODUCT.md)).
- **Thiết kế lõi:** `GRAPH_SCHEMA`, `SW_RUNTIME_EXECUTION_MODEL` và `SW_COMPONENT_LIBRARY` (nay đã hợp nhất vào [Software Design](docs/04_design/SOFTWARE.md)).
- **ADR-004..007** ghi 4 quyết định pivot.
### Removed — PIVOT-2026-06-08
- **Đã xóa** `design/software/SW_PLC_ENGINE_DESIGN_MK-DDC-24_VI.md`,
  `design/software/SW_WEBIDE_DESIGN_MK-DDC-24_VI.md`,
  `docs/04_uiux/KX-DDC24-UX-WEBIDE-001_VI.md` (nội dung cũ mâu thuẫn; còn trong git history).
  Thay bằng: SW_RUNTIME_EXECUTION_MODEL + SW_COMPONENT_LIBRARY (engine); ADR-006/007 (web Rev A).
  Mọi link trỏ tới 3 file (design/README, GETTING_STARTED, BE/FE-DEVGUIDE, PM-REPO, PM-IMPLPLAN,
  QA-REGISTER, docs/README, UX-SYSTEM, SYS-ARCH, ADR-004/006/007) đã được redirect.
### Changed — RECONCILE PIVOT-2026-06-08
- PRD/SRS/DS/README/SW_ARCH/SW_REQ/SW_DDD/manuals/dev-guides/SYS-ARCH/PM-OVERVIEW/GETTING_STARTED/
  CONFIG_SCHEMA: gắn banner **RECONCILE** + sửa thẳng các câu/bảng mâu thuẫn (61131-3/kinexus-*/FBD/
  Python/Svelte) sang component-graph / `mkddc-*` / Go.

### Changed — ⚠ BREAKING (ARCH-R010, 2026-05-30): Kiến trúc kết nối
- **Northbound (lên BMS/cloud) chỉ qua IP (Ethernet/WiFi):** BACnet/IP + MQTT + REST. **Bỏ BACnet MS/TP. Bỏ Modbus TCP/RTU slave.**
- **Southbound (RS-485) = Modbus RTU MASTER:** DDC poll thiết bị phụ (module mở rộng I/O, màn hình phụ, thiết bị bên thứ 3) theo **device profile** (khung mở). Đảo ngược RTU-006 cũ.
- Tài liệu cập nhật: SRS (§5/§6.2/§6.3, BAC/MB/RTU, E302/E303), SW_REQ §10, PRD (FR-020/024/025, UC-06), DS §1/§3.3, HW_SPEC §9, SW_ARCH; D-2 viết lại (Modbus RTU Master/Expansion v2.0), D-3 (BACnet IP-only), D-5 (fieldbus.conf + WiFi, bỏ mstp/rs485_mode); SW_DDD/SW_AGENT/SW_BACNET/SW_PLC; System Handbook (sơ đồ north/south + expansion); Implementation Plan (T-BE-05/06); Traceability; Register; nftables (bỏ 502).
### Added
- **Developer Kit (`docs/05_implementation/` + `shared/`)** — lớp tài liệu để dev gõ code:
  - Repository, Build & CI (mono-repo layout, build mỗi nghề, CI, git workflow).
  - FW / BE / FE Developer Guide & Backlog: walking skeleton + backlog cỡ ticket (mục tiêu/file/acceptance/test/trace).
  - **Hợp đồng code thật:** `shared/iop_protocol.h` (FW↔BE), `shared/kinexus_shm.h` (shared memory struct).
  - FE: hợp đồng WebSocket realtime (monitor/force).
- **`kinexus-fieldbus`** service + `SW_FIELDBUS_DESIGN` (tài liệu lịch sử đã archive; thiết kế hiện hành tại [Software Design](docs/04_design/SOFTWARE.md)).
- Decision record **ARCH-R010** trong OPEN_ISSUES.
- **KX-DDC24-SYS-ARCH-001 — System Handbook** ("Hiểu hệ thống từ số 0"): tài liệu giải thích toàn bộ sản phẩm cho người **không chuyên** — kể chuyện, sơ đồ Mermaid, ví von, đi theo chân 1 con số/1 mệnh lệnh xuyên hệ thống, từ điển thuật ngữ, FAQ. Đặt làm điểm bắt đầu số 1 ở mọi cổng (root README, docs/README, Overview).
- `git init` + `.gitignore` + baseline commit lịch sử dự án.

### Đang làm
- Implement code theo `KX-DDC24-PM-IMPLPLAN-001` (đã archive; workflow hiện hành tại [Development and Operations](docs/06_operations/DEVELOPMENT_AND_OPERATIONS.md)).
- Cần chốt: DEC-001 (PLC engine), SW-Q-004 (key store), SW-Q-005 (OTA endpoint).

---

## [0.3.0] — 2026-05-30 — "ISO Documentation Baseline"
Bổ sung lớp **quản lý tài liệu theo ISO** + **thiết kế giao diện** + **kế hoạch implement chi tiết**.

### Added
- **Document Hub** `docs/` — cổng điều hướng ISO-aligned ([docs/README](docs/README.md)).
- **KX-DDC24-QA-DOCCTRL-001** — Chuẩn Kiểm soát & Đặt tên tài liệu (ISO 9001 §7.5 / 12207): Document ID scheme, status lifecycle, versioning, cấu trúc thư mục.
- **KX-DDC24-PM-IMPLPLAN-001** — Implementation Plan: phase → task → microtask → checklist input/output cho FW / BE / FE / UI-design.
- **KX-DDC24-PM-OVERVIEW-001** — Project Overview (tổng quan cho người mới).
- **KX-DDC24-QA-REGISTER-001** — Master Document Register (danh mục toàn bộ tài liệu + ID + version + owner).
- **KX-DDC24-QA-TRACE-001** — Traceability Matrix (REQ → design → code → test).
- **UI/UX (04_uiux):** Design System (tokens/components), Web IDE UI/UX (FE), HMI TFT UI.
- **CHANGELOG.md** (file này).

### Changed
- `spec/README` và `design/README` trỏ về `docs/` làm cổng ISO.

---

## [0.2.0] — 2026-05-30 — "Detailed Design Dossier (SW/FW)"
Tạo bộ hồ sơ thiết kế chi tiết để team FW/SW vào code.

### Added
- `design/` — 27 tài liệu thiết kế (~2.150 dòng), gồm:
  - **DP-0 Foundation:** FW_DDD, SW_DDD, FW/SW Coding Standard, D-1 Pinout Master, D-2 Modbus Register Map, template DDD, GETTING_STARTED_DEV.
  - **DP-1 Interfaces:** D-3 BACnet PICS/EPICS, D-4 REST OpenAPI (+`openapi.yaml`), D-5 Config JSON Schema, D-7 OTA (SOM+MCU).
  - **DP-2 Module/Service:** D-6 PLC Engine, D-11 Security/Key-store, 4 FW module designs (iop_comm, io_sample, ao_do, diag_wdg), 5 SW service designs (io-driver, bacnet, agent, webide, hmi).
- `spec/DESIGN_PLAN_SWFW` — kế hoạch thiết kế (tiêu chuẩn, deliverable, gate DR-1..DR-4).
- `spec/README` — cổng đọc cho dev: thứ tự đọc theo vai trò, bản đồ tài liệu, glossary, bảng nguồn-chuẩn.

### Changed
- Thêm banner "📘 Đọc cùng" + trạng thái đồng bộ vào 7 file spec.

### Fixed
- Đồng bộ các điểm từng mâu thuẫn (P0/P1/P2) qua Design-Readiness Review:
  - Kiến trúc ADC: chốt **MCU đọc ADS131M08 (SPI3)**, CM3 không nối ADC.
  - Modbus format: chốt **INT16 ×100, 1 register/điểm**.
  - Chọn MCU **STM32G0B1RBT6** (3×SPI, 2×DMA) thay vì G071.
  - Pinout MCU thống nhất một nguồn-chuẩn (`MCU_STM32G0_SPEC §3`).

### Security
- Sửa chính sách port: **MQTT 1883 plaintext chặn mặc định**, chỉ 8883 TLS.

---

## [0.1.0] — 2026-05-28 — "Requirements & Architecture Baseline"
### Added
- Tài liệu yêu cầu: PRD, SRS, DS (datasheet, Modbus map §4.1), HW_SPEC.
- Tài liệu kiến trúc & yêu cầu chi tiết: SW_ARCH, FW_ARCH, SW_REQUIREMENTS, FW_REQUIREMENTS, SWFW_INTERFACE_SPEC (IOP), TEST_SPEC.
- OPEN_ISSUES (decision log), DESIGN_READINESS_REVIEW.
- `hardware-design/` — SOM (Radxa CM3), carrier board, I/O subsystem (DI/DO/UI/AO), power, MCU/IO, BOM, EMC/thermal.

---

## Quy tắc cập nhật changelog
- Mỗi PR có thay đổi đáng kể → thêm dòng vào `[Unreleased]`.
- Khi phát hành → đổi `[Unreleased]` thành `[X.Y.Z] — YYYY-MM-DD — "tên"`.
- Tham chiếu Document ID / REQ ID khi liên quan.
