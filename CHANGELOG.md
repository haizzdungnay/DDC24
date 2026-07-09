# CHANGELOG — MK-DDC-24

> Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), version theo [SemVer](https://semver.org/lang/vi/).
> Đây là changelog **toàn dự án** (tài liệu + sản phẩm). Mỗi tài liệu còn có Revision History riêng ở cuối file.
> Loại thay đổi: `Added` (thêm), `Changed` (sửa), `Fixed` (vá), `Deprecated`, `Removed`, `Security`.

---

## [Unreleased]
### Fixed - Trivy PR scan scope (2026-07-10)
- ci(security): stopped the Trivy PR workflow from generating and scanning the GitHub runner Debian package list, kept the scan focused on repository dependency manifests, disabled stale Trivy DB cache restore, limited Trivy to vulnerability scanning, and made SARIF output honor the configured `CRITICAL,HIGH` severity gate so UNKNOWN advisories do not fail the PR gate. Verification: local `trivy fs --scanners vuln --severity CRITICAL,HIGH --format table --exit-code 1 .` reported 0 npm/go vulnerabilities on the PR #50 merge tree; local all-severity scan reproduced `GO-2026-5932` as UNKNOWN; GitHub PR #50 rerun pending.

### Fixed - Virtual Point PR CI call-site sync (2026-07-10)
- web/fe(virtual-points): completed the remaining Virtual I/O to Virtual Point call-site migration for PR #49 so backend config, alarm, point, trend, scheduler, websocket, and frontend API/page paths compile against `virtual_points.conf`, `/api/v1/virtual-points`, and canonical `VP` IDs. Verification: `go test -count=1 -run TestVirtualPoint .` pass; `go test -count=1 ./...` pass in `web/backend`; `go build ./...` pass in `web/backend`; `npm run lint` pass; `npm run typecheck` pass; `npm run build` pass; `npx vite build --emptyOutDir=false` pass; `git diff --check` pass.

### Fixed - Virtual Point EasySet wizard metadata (2026-07-09)
- web/fe/docs(virtual-points): restored the Inputs/Outputs-style `Summary / Wizard / Advanced` authoring flow on `/eng/virtual-points`, added `u0..u7` Wizard steps for VP signal type, display min/max, range multiplier, fixed Units dropdown, filter samples, sensor calibration, and math function, and persisted those fields through `virtual_points.conf` instead of dropping them on save. Units are normalized to the fixed EasySet list (`""`, `percent`, `degC`, `Pa`, `ppm`) rather than free text. Verification: `go test -count=1 -run TestVirtualPoint .` pass; `go test -count=1 ./...` pass in `web/backend`; `go build ./...` pass in `web/backend`; `npm run lint` pass; `npm run typecheck` pass; `npx vite build --emptyOutDir=false` pass. `npm run build` was blocked by the active local Vite/dev process holding `src/frontend/dist/assets` (`EPERM`), so the no-empty build was used without stopping the user's running UI.

### Changed - Orange Pi DDNS VP deployment (2026-07-09)
- deploy(board): deployed the current VP backend and frontend bundle to the Orange Pi over DDNS (`orangepi@mekong-fac.ddns.net:2222`) for off-LAN testing, replacing `/opt/mkddc-web/mkddc-web` with the linux/arm64 build and syncing `src/frontend/dist` to `/opt/mkddc-web/dist`. Backups kept at `/opt/mkddc-web/mkddc-web.bak.20260709230819` and `/opt/mkddc-web/dist.bak.20260709231113`. Verification: `mkddc-web-pi` restarted active on port `8081`; authenticated `/api/v1/system/status`, `/api/v1/virtual-points`, and `/api/v1/system/config/virtual-points` returned `200`; `/eng/virtual-points` returned `200` from the board-served SPA.

### Changed - Virtual Point VP-only pivot (2026-07-09)
- web/core/fe/docs(virtual-points): replaced the VI/VO model with backend-owned created Virtual Points (`virtual_points.conf`, `VP1..VP464`) carrying `boolean|integer|float|string|datetime` signal types, writable flags, and log tiers (256 non-logged, 128 at 1s, 64 at 100ms, 16 at 10ms diagnostic). `/points`, Monitoring, Trends, and history now depend on created VP metadata instead of raw core AV/BV/MSV slots; Trends only charts created logged numeric-compatible VP, and `/trends/config` rejects uncreated raw AV/BV/MSV virtual slots. Alarm settings now accepts created numeric-compatible VP sources, backend alarm listing evaluates high/low Virtual Point alarms, Scheduler validates created writable integer/float VP targets including controller operation mode, and the backend virtual scheduler writes VP values while core skips backend-only VP schedule/alarm rows. Legacy `AV` IDs remain accepted as aliases for VP references, but API/UI responses now use canonical `VP1` IDs; core `kind=AV` stays internal BACnet Analog Value and old VI/VO alarm sources are rejected. Multi-agent review follow-up removed stale MSV/BV scheduler targets, made Monitor/Trends cross-check `/virtual-points`, made VP alarm sources integer/float-only, moved 10ms Virtual Point samples to an in-memory history ring, fixed VP scheduler/alarm canonical output, preserved internal AV C++ schedule/alarm behavior, hardened C++ integer parsing, prevented backend-only VP schedules from masking internal AV winners, and made alarm history polling include Virtual Point alarms. Verification: `go test -count=1 ./...` pass in `web/backend`; `go build ./...` pass in `web/backend`; `npm run lint` pass; `npm run build` pass; WSL `cmake --build build/services -j2` pass; WSL `ctest --test-dir build/services --output-on-failure` 332/332 pass.

### Changed - Orange Pi live run refresh (2026-07-09)
- deploy/runbook: rebuilt `mkddc-web` for linux/arm64 from the current local backend tree, copied the backend binary and `users.conf` to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and started the local Vite frontend as a detached Windows process on port `5173` with `VITE_PROXY_TARGET=http://192.168.1.18:8081`. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `21868`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.
- deploy/build: rebuilt the current local backend and frontend code, cross-compiled `mkddc-web` for linux/arm64, redeployed it to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and restarted the detached local Vite frontend on port `5173`. Verification: `go build ./...` pass in `web/backend`; `npm run build` pass in `src/frontend`; WSL `cmake --build build/services -j2` pass (`ninja: no work to do`); board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `20752`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.
- deploy/runbook: LAN access to `192.168.1.18:22/8081` was unavailable, so the backend was rebuilt for linux/arm64 and redeployed through WAN SSH `mekongfactory.ddns.net:2222`; `mkddc-web-pi` was restarted on board port `8081`, a detached Plink tunnel was opened at local `18081`, and the local Vite frontend was restarted on port `5173` with `VITE_PROXY_TARGET=http://127.0.0.1:18081`. Verification: board `ss` showed `*:8081` listening; Plink tunnel listened on `127.0.0.1:18081` under PID `21036`; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `16888`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.

### Changed - Virtual I/O alarm and scheduler integration (2026-07-08)
- core/web/fe/docs(virtual-io): fixed FE backing-point canonicalization for dashed `AV/BV/MSV` aliases, stopped live `/points` from applying demo metadata, normalized demo virtual backing allocation, and allowed alarms/schedules to use VI/VO metadata through fixed AV/BV/MSV backing points. Scheduler now accepts VO analog backing `AV17..32` for `analog_output_value` and VO binary backing `BV9..16` for DO/fan schedules; alarm settings now accepts `VI`/`VO` sources backed by valid `AV/BV/MSV` pools, with OpenAPI channel bounds aligned to 64 virtual metadata slots. Follow-up review fixes preserve canonical `AV17/BV9` schedule IDs, bind VI/VO alarm sources to `virtual_io.conf`, default omitted `enabled` to true, clean stale demo virtual points, keep VO scheduler presets, and reject overflowed C++ virtual point IDs. Verification: targeted Go virtual/schedule/alarm tests pass; `go test -count=1 ./...` pass; `go build ./...` pass; `npm run build` pass; `npm run lint` pass; WSL `cmake --build build/services -j2` pass; WSL `ctest --test-dir build/services --output-on-failure` 327/327 pass.

### Added - Virtual I/O authoring (2026-07-08)
- web/fe/docs(virtual-io): added persisted `virtual_io.conf` CRUD APIs, OpenAPI contract, `/eng/virtual-io` page, demo data, nav wiring, and core ID alias normalization so VI/VO metadata allocate fixed AV/BV/MSV backing slots without expanding core shared-memory counts; tightened `/points` boolean value docs, command validation, point ID lookup aliases, config schema requirements, and demo fixed-pool behavior. Verification: `go test -count=1 -run "TestHandlePoint|TestForcePoint|TestVirtualIO|TestCoreCommandPointID|TestCanonicalPointID" .` pass; `go test -count=1 ./...` pass; `go build ./...` pass; `npm run build` pass; `npm run lint` pass.

### Changed - Orange Pi live run refresh (2026-07-08)
- deploy/runbook: rebuilt `mkddc-web` for linux/arm64 from the current local backend tree, copied the backend binary and `users.conf` to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and started the local Vite frontend as a detached Windows process on port `5173` with `VITE_PROXY_TARGET=http://192.168.1.18:8081`. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `452`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.
- deploy/runbook: reran the OrangePi backend refresh from the current local backend tree and restarted the detached local Vite frontend. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `33424`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.

### Changed - Scheduler intervals and holiday priority (2026-07-07)
- core/web/fe/docs(scheduler): changed schedules from single `timeOfDay` events to `startTime`/`endTime` intervals, added `holiday_period` MM-DD override suppression above weekly schedules, and labeled scheduler capabilities as `WIRED`, `VIRTUAL`, `OVERRIDE`, or `STORED` without adding unsupported UI input targets. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; WSL services CMake build pass; `ctest --test-dir build/services --output-on-failure` 322/322 pass.

### Changed - Scheduler wizard navigation (2026-07-07)
- fe(scheduler): changed the Scheduler edit tab to a real Wizard flow with progress, step buttons, and Previous/Next/Finish controls matching the Inputs wizard pattern. Added save confirmation popup. Verification: `npm run build` pass; `npm run lint` pass.

### Fixed - Scheduler live fallback and contract validation (2026-07-07)
- fe/docs(scheduler): removed live-mode demo fallback for health/points API failures, aligned frontend executable schedule validation with backend/core even when rows are disabled, and documented OpenAPI executable rows as requiring `target` and `value` while `not_active`/`holiday_period` remain stored-only. Verification: `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Added - EasySet-style scheduler config and runtime execution (2026-07-07)
- core/web/fe/docs(scheduler): replaced the demo weekly grid with EasySet-style schedules (`timeOfDay`, weekdays, `scheduleType`, target, value), connected `/eng/scheduler` to real `/api/v1/schedules`, enforced a 64-schedule limit, persisted `schedule.conf`, and added core execution at priority level 4 (`schedule`) for AO/DO plus AV/MSV virtual schedule writes. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; WSL services CMake/Ninja build pass; `ctest --test-dir build/services --output-on-failure` 320/320 pass.

### Changed - Orange Pi live run refresh (2026-07-07)
- deploy/runbook: rebuilt `mkddc-web` for linux/arm64, copied the backend binary and `users.conf` to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and started the local Vite frontend as a detached Windows process on port `5173` with `VITE_PROXY_TARGET=http://192.168.1.18:8081`. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `19368`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.

### Fixed - Alarm action body validation (2026-07-07)
- web/backend(alarms): reject unknown Ack/Off JSON fields and reject empty Off bodies so suppress cannot silently become a permanent hide. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `go vet ./...` pass; `npm run build` pass; `npm run lint` pass; WSL services CMake/Ninja build pass; `ctest --test-dir build/services` 311/311 pass.

### Changed - Alarm manual clear, timed ack/off, and flexible priority (2026-07-06)
- core/web/fe/docs(alarm): added `clearMode=auto|manual` alarm settings, flexible priority `params.severityRules`, timed/permanent Ack payloads, new Off/Suppress alarm action with duration dialog, `/api/v1/alarms/{id}/suppress`, and OpenAPI coverage. Manual-clear alarms stay visible after the signal returns normal until Off is confirmed. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; WSL services CMake/Ninja build pass; `ctest --test-dir build/services --output-on-failure` 311/311 pass.

### Fixed - Alarm history repeated END rows (2026-07-06)
- web/backend(alarms): record a new `started` event when an existing alarm id transitions from cleared/unack back to active, so recurring alarms no longer produce repeated `ended` rows without a matching `started`. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; linux/arm64 backend build pass; Orange Pi `mkddc-web-pi` restart pass; authenticated `/api/v1/alarms` smoke returned 200 JSON.

### Changed - Alarm history page filters (2026-07-06)
- fe(alarms): moved full alarm history to `/alarms/history` instead of expanding inside Alarm log, changed Alarm/Name history filters from free-text inputs to dropdown selectors populated from alarm settings and history rows, and made the history filter Clear control a full bordered button. Verification: `npm run build` pass; `npm run lint` pass.

### Changed - Orange Pi live run refresh (2026-07-06)
- deploy/runbook: rebuilt `mkddc-web` for linux/arm64, copied the backend binary and `users.conf` to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and started the local Vite frontend on port `5173` with `VITE_PROXY_TARGET=http://192.168.1.18:8081`. Verification: SSH reached `orangepi5b` aarch64; board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned board CPU/RAM/temp/uptime fields.
- deploy/runbook: reran the OrangePi backend refresh and local Vite startup. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.
- deploy/runbook: restarted the local Vite frontend as a detached Windows process instead of a Codex-owned PTY process, so closing Codex does not stop `localhost:5173`. Verification: Vite log showed ready at `http://localhost:5173/`; port `5173` listened under PID `26828`; smoke login and `/api/v1/system/status` through the Vite proxy returned `overall=ok` from `192.168.1.18`.

### Changed - Alarm ACK return and full history filters (2026-07-06)
- core/web/fe(alarms): kept ACKed active alarms visible in the `acked` view, added `alarm_return`/Return to reactivate ACKed alarms, exposed real status/history filters with full-history mode, persisted alarm lifecycle/settings records in JSONL across backend restarts, served the frontend SPA from the Go backend, and made history-only fallback rows read-only so stale alarms cannot send ACK/Return to core. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; WSL CMake/Ninja core build pass; `ctest --test-dir build/services` 300/300 pass.

### Changed - Local secret and backend artifact ignores (2026-07-06)
- repo: ignored `RUN_PROJECT.md`, frontend `.env` files, and local `web/backend/mkddc-web-*` binaries so secrets and deploy artifacts stay out of commits. Verification: `git status --short --untracked-files=all` excluded those local files from the staged set.

### Added - Alarm history log and ack count refresh (2026-07-03)
- web/fe(alarms): added persistent JSONL alarm history at `/api/v1/alarm-history` for start/ack/end and alarm-setting create/change/delete records, background-polled core alarm snapshots, changed sidebar/topbar badges to count only `active`/`unack`, and refreshed the badge immediately after ACK. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `go vet ./...` pass; `npm run build` pass; `npm run lint` pass; Chrome headless UI smoke pass (`2 -> 1` badge after ACK, history panel visible).
- deploy(orange-pi): fixed `/data/config/alarm_history.jsonl` ownership/permissions and installed `mkddc-web-pi.service` to run the web backend as `mkddc`, preventing alarm history read permission errors after restart. Verification: Orange Pi `mkddc-web-pi`/core/iobus/ssh active; `/api/v1/alarm-history?limit=5` returned 5 records; `/api/v1/alarms` returned 2 active alarms.

### Fixed - Web alarm settings config path (2026-07-03)
- web/backend(alarm-settings): made the default alarm settings file match the core runtime path `/data/config/alarm_settings.conf`, while keeping `ALARM_SETTINGS_CONF` as an explicit override, and writes alarm settings group-readable/writable for the `mkddc` service group. This keeps `/eng/alarm-settings` populated when `CONFIG_DIR` points at a web runtime directory. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; ARM64 build pass; Orange Pi `mkddc-web-pi` restarted and `/api/v1/alarm-settings` smoke returned 2 configured alarms.

### Fixed - C++ CI alarm runtime portability (2026-07-03)
- services/core(test): replaced fixed-buffer alarm point ID formatting with string composition to avoid GCC 11 `-Wformat-truncation` under CI, and yielded the concurrent iobus-reader test writer so the seqlock test reliably observes valid snapshots. Verification: WSL `cmake --build build/codex-services-sync -j2` pass; WSL `ctest --test-dir build/codex-services-sync --output-on-failure` 301/301 pass.

### Fixed - SHM v4 iobus layout guard after main merge (2026-07-03)
- services/iobus(test): aligned `test_io_cache` layout asserts with SHM v4 `ui_reliability[]` placement, so `ui_unit` offset `176` and `ui_raw_unit` offset `304` match the shared contract and web reader offsets after merging latest `main`. Verification: WSL `cmake --build build/codex-services-sync -j2` pass; WSL `ctest --test-dir build/codex-services-sync --output-on-failure` 301/301 pass.

### Changed - ALARM-3b trigger threshold visibility (2026-07-03)
- core/web/fe(alarm): carried the tripped threshold bucket (`HH`/`H`/`L`/`LL`/`RUNTIME`) from core alarm evaluation through web_ipc and the Go alarm DTO, then surfaced it as a visible alarm-row trip badge with threshold detail. Verification: full services WSL `ctest` 290/290 pass; `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; Chrome UI smoke against Orange Pi live API pass.

### Changed - ALARM-3b live alarm ack closure (2026-07-02)
- docs/web/fe(alarm): aligned public AlarmEvent schema with the backend AlarmDTO, surfaced normalized alarm values in the live alarm row, and added handler regressions for alarm list degrade, ack success/refetch, unknown ack, RBAC, and empty IDs. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `go vet ./...` pass; `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Changed - ALARM-01B frontend alarm entity settings (2026-07-02)
- fe(alarm-settings): replaced the demo per-point alarm settings page with ADR-013 alarm entities backed by `/api/v1/alarm-settings`, including add/remove alarms, multi-source source rows, active-type validation, BACnet publish caps, and demo data updated to the entity model. Verification: `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Changed - ALARM-01B backend alarm entity model (2026-07-02)
- web/backend(alarm-settings): replaced legacy per-point alarm settings with ADR-013 alarm entities, added validation caps/type/source/params checks, and added safe legacy JSON migration on load without rewriting files. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `go vet ./...` pass; `git diff --check` pass.

### Fixed - Orange Pi demo DO live toggle data (2026-07-02)
- tools/fe/deploy: added a small Orange Pi demo graph that drives DO-01..DO-04 from UI-12/UI-13 dry-contact states, and made frontend demo DO points follow the same changing logic instead of staying static. Verification: Orange Pi SHM dump shows DO command/feedback changing together; `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Fixed - Orange Pi fake MCU live UI/AO sample data (2026-07-02)
- tools/fe/deploy: corrected fake MCU raw simulation and Orange Pi IO config so UI-09..UI-15 produce plausible GOOD values instead of configuration-error `0.0`, added ppm unit mapping for CO2, and seeded AO demo setpoints through the live core socket. Verification: Orange Pi `mkddc-fakemcu --self-test` pass; SHM dump shows UI-09..UI-15 GOOD and AO setpoints nonzero; `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Fixed - Inputs UI live chart real samples (2026-07-02)
- fe(inputs): removed seeded UI live chart history from stored point trends so the Inputs page chart starts empty and only plots fresh `/points` samples. Verification: `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Changed - Outputs DO real-only controls (2026-07-01)
- fe(outputs): simplified DO output configuration to real wired controls only (safe state and manual force), removing EasySet-only demo rows without backend/core/iobus hooks. Verification: `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Fixed - ADR-011/012 BACnet alignment integration review (2026-07-01)
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
- Thêm [QA-ISOGAP-001](docs/00_management/KX-DDC24-QA-ISOGAP-001_VI.md) — gap assessment theo §7.5 + kế hoạch.
### Changed — ⚠ BREAKING (PIVOT-2026-06-08): Component-based DDC + 3-process + Go web
- **Mô hình điều khiển:** chuyển từ **IEC 61131-3 soft-PLC (FBD/ST)** sang **component-based
  graph runtime**. Artifact deploy = `graph.json`. IEC 61131-3 → Rev C. ([ADR-004](docs/adr/ADR-004-component-based-runtime.md))
- **Kiến trúc SOM:** 7 service `kinexus-*` → **3 process `mkddc-*`** (`mkddc-core` C++ real-time,
  `mkddc-iobus` C++, `mkddc-web` Go), chia theo real-time boundary. HMI/agent/OTA/cloud → deferred
  Rev B+. Watchdog = systemd + HW. ([ADR-005](docs/adr/ADR-005-three-process-architecture.md))
- **Web/UI:** backend Python/FastAPI → **Go**; frontend Svelte → **React**; Rev A UI = **form +
  import `graph.json`**, bỏ FBD drag-drop (canvas → Rev B); validator = **Go library** (bỏ Rust
  service). ([ADR-006](docs/adr/ADR-006-rev-a-ui-form-json.md), [ADR-007](docs/adr/ADR-007-web-stack-go.md))
- **Naming:** retire codename `kinexus-*` → brand `mkddc-*` (rename `kinexus_shm.h`→`mkddc_shm.h`
  là task implementation riêng; hợp đồng shm/IOP với MCU giữ nguyên).
### Added — PIVOT-2026-06-08
- **Nguồn-chuẩn mới:** [PRODUCT_DEFINITION](docs/01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md),
  [REVA_SCOPE_ROADMAP](docs/01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) (Rev A.0 + lịch 90 ngày).
- **Thiết kế lõi:** [interfaces/GRAPH_SCHEMA](docs/02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md),
  [software/SW_RUNTIME_EXECUTION_MODEL](docs/02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md),
  [software/SW_COMPONENT_LIBRARY](docs/02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md).
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
- **`kinexus-fieldbus`** service + [SW_FIELDBUS_DESIGN](docs/02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md) (Modbus RTU master, device profile engine).
- Decision record **ARCH-R010** trong OPEN_ISSUES.
- **KX-DDC24-SYS-ARCH-001 — System Handbook** ("Hiểu hệ thống từ số 0"): tài liệu giải thích toàn bộ sản phẩm cho người **không chuyên** — kể chuyện, sơ đồ Mermaid, ví von, đi theo chân 1 con số/1 mệnh lệnh xuyên hệ thống, từ điển thuật ngữ, FAQ. Đặt làm điểm bắt đầu số 1 ở mọi cổng (root README, docs/README, Overview).
- `git init` + `.gitignore` + baseline commit lịch sử dự án.

### Đang làm
- Implement code theo [Implementation Plan](docs/00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md) (Phase P1+).
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
