# CHANGELOG — MK-DDC-24

> Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), version theo [SemVer](https://semver.org/lang/vi/).
> Đây là changelog **toàn dự án** (tài liệu + sản phẩm). Mỗi tài liệu còn có Revision History riêng ở cuối file.
> Loại thay đổi: `Added` (thêm), `Changed` (sửa), `Fixed` (vá), `Deprecated`, `Removed`, `Security`.

---

## [Unreleased]
### Added — Build native aarch64 và deploy FW SOM + fake MCU lên board (2026-08-04)

- Build `build-release.sh` native trên Orange Pi 5B tại commit `13fdc60`:
  **BUILD_OK**, version 0.2.0, `dirty=false`. Bốn binary C++ và Go đều
  `ELF 64-bit ARM aarch64`; `firmware.elf` ARM 32-bit; web-ui dist 1.6 MB;
  5/5 checksum ghi trong `build/release/checksums.sha256`.
- Deploy bằng `install.sh` (checksum verify PASS) rồi restart theo thứ tự
  fakemcu → iobus → core → web. Xác minh runtime: `iop.state HANDSHAKE ->
  NORMAL_POLL`, `output.set_do/set_ao ack=ok`, SHM tạo lại, web API cổng
  **8081** trả 200 cho client thật. Provenance trên target truy được về commit
  `13fdc60` với cả 4 binary báo cùng version/commit.
- Cài toolchain còn thiếu trên board: Go 1.26.5, Node 24.15.0 + npm 11.12.1,
  `gcc-arm-none-eabi` 12.2.1 kèm `libnewlib-arm-none-eabi`.
- **Ba khiếm khuyết của `install.sh` được phát hiện, mới vá tay trên board, chưa
  sửa trong repo:** (1) script không restart service đang chạy nên sau khi cài
  "thành công" các tiến trình vẫn giữ inode cũ — `readlink /proc/<pid>/exe` trả
  `(deleted)` và PID không đổi so với baseline, tức vẫn chạy code cũ; (2) script
  không cài `fake_mcu` nên board lab lệch phiên bản giữa iobus mới và fake MCU
  cũ; (3) script bật `mkddc-hmi` chỉ vì binary tồn tại, ghi đè trạng thái
  `disabled` trước đó và gây vòng lặp restart trên board không có panel
  (`HMI DRM no connected connector`).
- Ghi nhận `mkddc_io_shm` đổi kích thước 1304 → 1816 byte giữa hai bản, nên
  iobus và core bắt buộc restart đồng bộ.
- Báo cáo đầy đủ tại
  `docs/07_records/reviews/BOARD_DEPLOY_REPORT_2026-08-04.md`.
- **Đính chính:** mốc thời gian binary target trong Plan 46 §12.4, Runbook 47 và
  entry trước ghi 2026-07-28 là **sai** do đọc nhầm cột `ls -la`. Số đúng đo bằng
  `stat`: core/iobus/netcfg/hmi/web 2026-08-01 15:24:05, fake-mcu 2026-07-30
  19:38:14. Kết luận không đổi vì cả hai mốc đều trước restructure 2026-08-03.

**Kiểm chứng trong phiên:** `ctest` native aarch64 **746/751 PASS** trong 14,70 s.
5 test hỏng đều do `shm_open errno=13` (EACCES) vì `/dev/shm/mkddc_plc_shm` thuộc
`mkddc:mkddc` mode 644 còn test chạy dưới user `orangepi` — lỗi cô lập test, không
phải hồi quy aarch64; đáng lưu ý vì ADR-022 dự tính chạy CI runner ngay trên board.
`RST-202` chưa đóng: `TARGET_INSTALL` và `TARGET_PROVENANCE` PASS, còn
`TARGET_STARTUP_ORDER`, `TARGET_CRASH_RESTART`, `TARGET_ROLLBACK` là `NOT_RUN`.

### Added — Chuẩn bị nghiệm thu target `RST-202` cho Plan 46 (2026-08-04)

- Khảo sát read-only board lab `SOM-DDC-24` (`orangepi5b`, aarch64, 8 unit
  `active`); không thay đổi gì trên target. Bốn dữ kiện quyết định trạng thái
  `RST-202`: target vẫn chạy binary mốc 2026-07-22/28 tức **trước** restructure;
  `/usr/share/mkddc/` thiếu toàn bộ file provenance nên gate commit/checksum
  chưa đóng được; `/usr/sbin` có 7 bản sao rollback ad-hoc; layout cài đặt lệch
  giữa `/usr/sbin` và `/opt/mkddc-web` kèm bản chết ở `/usr/local/bin`.
- Xác định nguyên nhân thiếu provenance không phải lỗi script: logic sinh
  `provenance.json`/`runtime-build-info.txt` mới vào repo ở `9c6dc9b`
  (2026-08-03), sau lần cài target cuối ngày 2026-08-01. `build-release.sh` và
  `install.sh` hiện đã đủ để đóng gate này ở lần cài tới.
- Thêm `platform/cmake/toolchain-aarch64-linux-gnu.cmake` làm đường build phụ
  cho máy phát triển x86_64, kèm yêu cầu sysroot ghi ngay trong file. Đường
  chính cho `RST-202` vẫn là build native trên board theo ADR-022.
- Thêm `docs/03_implementation/47_RST202_TARGET_ACCEPTANCE_RUNBOOK.md`: điều
  kiện tiên quyết, hai đường build, trình tự install/startup/crash/provenance/
  rollback, evidence phải ghi và năm tiêu chí đóng `RST-202`.
- Cập nhật Plan 46 §12.4, `docs/03_implementation/README.md` (sửa trạng thái 46
  từ "G0..G3" thành "G0..G4 PASS; G5 bị chặn bởi `RST-202`") và `docs/README.md`.

**Kiểm chứng trong phiên:** toolchain aarch64 đã kiểm chứng bằng project tối
thiểu — `file` trả `ELF 64-bit LSB pie executable, ARM aarch64`. Cross-build đầy
đủ **FAIL** trên máy hiện tại: `ld: cannot find -lmodbus` do host chưa bật
multiarch arm64; đã ghi yêu cầu sysroot thay vì bật ngầm. Không sửa source sản
phẩm, không chạm board, không claim target evidence.

### Changed — Tái kiểm chứng đồng bộ docs Programming sau restructure (2026-08-04)

- Kiểm lại bộ hồ sơ Programming Rev A tại HEAD `6ba7e3c` vì PR #80
  (`PLAN-ARCH-RESTRUCT-002`) đổi cây source sau khi PR #79 lập Product Spec.
  Kết quả: 14/14 tham chiếu source đã trỏ đúng `apps/`/`contracts/`, 0 link
  markdown hỏng, 0 gap trong không gian ID và 0 mâu thuẫn scope.
- Bổ sung câu loại trừ tường minh trong mục gate architecture conformance của
  `docs/05_verification/VERIFICATION.md`: host matrix sau migration có chứa
  unit test ST/IR/cyclic component nên không được dùng để đóng `VR-PROG-*` hay
  gate real-hardware `VR-MBRTU-001/004/011/012`.
- Ghi mục tái kiểm chứng vào
  `docs/07_records/reviews/PROGRAMMING_DOCS_SYNC_REPORT.md`; ba kết luận
  `PRODUCT_SPEC_DOCUMENTED=YES`, `DOCS_SYNCHRONIZED=YES`,
  `READY_FOR_PROGRAMMING_DESIGN=NO` giữ nguyên.

**Kiểm chứng trong phiên:** docs-only, không sửa source nên không chạy lại bộ
test sản phẩm. Đo bằng script kiểm link/ID trên 13 tài liệu Programming: 0 link
hỏng; PC 12, PR 14, SYS-REQ 3, SWR-REQ 12, IF-REQ 2, NFR-REQ 2, VR 13, OD 15
đều có ánh xạ đầy đủ trong ma trận; dependency `*-MBRTU-*` (SYS 1, SWR 9, IF 4,
SEC 1, NFR 3, VR 12) không có gap. Không tạo Programming Design hoặc
Implementation Plan.

### Changed — Hoàn tất bounded context Go và host security disposition (2026-08-03)

- Hoàn tất `RST-121..126`: tách auth/audit, Point Catalog/namespace/config,
  Modbus RTU, historian store/query/lifecycle, system/network/health/HMI adapter
  và router khỏi `internal/app` sang 10 package có test trực tiếp. Handler và
  middleware public giữ nguyên REST/RBAC semantics qua façade composition.
- Nâng dependency FE để vá `brace-expansion` và `postcss`, cập nhật React
  Router lên 7.18.2 và toolchain ESLint/Vite tương thích. `npm audit` giảm từ
  4 xuống 2 record high cùng advisory RSC; Web UI là SPA client-only không dùng
  RSC nên áp dụng waiver hẹp đến 2026-10-25, unique unwaived high = 0.
- Cập nhật gate C++ trong `AGENTS.md` dùng root CMake authority; path
  `services/` đã bị xóa từ G3 và không được khôi phục bằng shim.
- Đánh dấu G4 PASS trong Plan 46; G5 chỉ còn bị chặn bởi target/board được owner
  duyệt để chạy install, startup, provenance và rollback.

**Kiểm chứng trong phiên:** repository guard 7/7 PASS; C++ Release full option
**751/751 PASS**; Go `vet`, `test -count=1` và `test -race -count=1` PASS trên
12 package; FE Vitest **35 file, 299/299 PASS**, lint 0 warning, build **2.223
module**; Playwright Network **1/1 PASS**. Chrome DevTools MCP desktop/mobile
PASS với 0 Console error/warn và 87/87 request thành công; ghi nhận 9 form field
thiếu `id`/`name` ở mức accessibility low. `npm audit` vẫn trả exit 1 cho hai
record đã waive; không claim audit sạch hoặc target acceptance PASS.

### Changed — Tái cấu trúc kiến trúc repository theo bounded modules (2026-08-03)

- Thực thi `PLAN-ARCH-RESTRUCT-002`: chuyển source production từ các cây
  `services`, `web/backend`, `src/frontend` và `fw` sang `apps/` cùng
  `firmware/stm32`; chuyển CMake/packaging/systemd sang `platform/` nhưng giữ
  nguyên tên binary, service topology, REST/WebSocket, SHM, IOP và config
  semantics.
- Thiết lập `contracts/` làm authority duy nhất cho IOP, SHM, config schema,
  build info và OpenAPI; xóa forwarding layer sau khi inventory không còn
  consumer. Artifact build mới chỉ được sinh dưới `build/`.
- Tách Core và Iobus thành `domain/application/ports/adapters/bootstrap`, thêm
  CMake target boundary và port snapshot/output/command sink; tách React thành
  `app/features/shared` với public barrel và lint/negative guard chống import
  sâu giữa feature.
- Đưa Go composition root về `apps/web-api/cmd/mkddc-web`, còn production code
  dưới `internal/app`; tại commit group di chuyển ban đầu, `RST-121..126` được
  giữ mở thay vì tạo package façade rỗng. Các task này được hoàn tất ở mục
  bounded context mới hơn phía trên.
- Thêm root CMake, `scripts/verify-project.sh`, path manifest, architecture
  conformance guard/negative tests, CI layout job, release path indirection và
  evidence G0/host regression tại `docs/07_records/evidence/restructure/`.
- Đồng bộ README, System, Software, Interfaces, Firmware, Verification,
  Operations, Traceability và Plan 46 theo cây As-Built. Plan vẫn `In Progress`:
  target install/startup/rollback chưa chạy do chưa có board/target được duyệt.
- Gỡ 7 link giả trong implementation index tới các hồ sơ 35/36/37/38/40/41/43
  không tồn tại; giữ tên mục và đánh dấu `Missing` thay vì tự tạo nội dung thay
  owner.

**Kiểm chứng trong phiên:** layout guard PASS; C++ matrix **709/709, 717/717,
710/710, 718/718 và 751/751 PASS**; ASan/UBSan **709/709 PASS**; fuzz parser
**917.841** lượt và loader **1.879.361** lượt không crash; Go `vet` +
`test -race -count=1` PASS; FE Vitest **35 file, 299/299 test**, lint 0 warning,
build **2.223 module** PASS;
Playwright network **1/1 PASS**; firmware ARM và release bundle **5/5 SHA-256
PASS**. `bash -n`/Python guard syntax PASS. Không claim target/rollback/HIL.
Bốn record high của `npm audit` tại baseline này đã được xử lý/waive có hạn ở
mục security disposition mới hơn phía trên.

### Verification — Gate trước commit và PR (2026-08-03)

- C++ Release cấu hình đồng thời `MKDDC_ENABLE_MODBUS=ON`,
  `MKDDC_ENABLE_BACNET=ON`, `MKDDC_ENABLE_HMI=ON`: build PASS và CTest
  **751/751 PASS** trong 2,98 giây CTest. GCC 13 còn phát cảnh báo tối ưu hóa
  trong fixture `test_output_command.cpp`; target test đã có waiver hẹp
  `-Wno-error=stringop-overflow` từ trước và restructure không mở rộng waiver.
- Go backend: `go vet ./...` PASS; `go test -race ./... -count=1` PASS,
  package test chính chạy trong **87,190 giây**.
- Frontend: Vitest **35 file, 299/299 PASS** trong 24,85 giây; ESLint PASS,
  **0 warning**; TypeScript/Vite production build PASS với 2.223 module.
- Playwright Chrome gate `e2e/network-qa.spec.ts`: **1/1 PASS** trong 22,8
  giây; API mutation được intercept theo fixture. Vite ghi nhận WebSocket proxy
  `ECONNREFUSED 127.0.0.1:8081` do backend thật không chạy trong test mock,
  không làm giảm assertion nghiệp vụ. Tại lần gate ban đầu, Chrome DevTools MCP
  chưa được expose; bằng chứng desktop/mobile thật đã được bổ sung trong mục
  bounded context mới hơn phía trên sau khi tool hoạt động.
- Firmware ARM Cortex-M0+: rebuild PASS bằng `arm-none-eabi-gcc 13.2.1`,
  `-Wall -Wextra -Werror`; linker chỉ phát cảnh báo syscall Newlib `nosys` chưa
  implement (`_close/_lseek/_read/_write`).
- Release builder PASS cho core, iobus, netcfg, web, frontend và firmware;
  **5/5 SHA-256 PASS**. `bash -n` PASS cho `build-release.sh` và `install.sh`.
  `systemd-analyze verify` trên máy build không thể resolve binary đích
  `/opt/mkddc-web/mkddc-web`; đây là đường dẫn chỉ tồn tại sau installer trên
  target, không được dùng để claim target deployment.
- `git diff --check` PASS. Không skip hoặc vô hiệu hóa test.

### Added — Thiết kế Modbus RTU Point trước Programming (2026-08-03)

- Thêm `DDD-SW-MBRTU-POINT-001` ở trạng thái `In Review`, đề xuất mô hình
  `ModbusRTUBus → ModbusRTUDevice → ModbusRTUPoint`, hai bus độc lập, stable
  Point ID, typed runtime value/timestamp/quality, scheduler, diagnostics,
  REST/WebSocket, atomic apply có iobus ACK và reliable write result/readback.
- Thêm `MODBUS_RTU_POINT_DESIGN_REVIEW_PROPOSAL.md`, nêu năm finding P0, chín
  quyết định cần reviewer duyệt và ba gate Design → Conforming Source → Real
  RS485 Acceptance. Hồ sơ không phải Implementation Plan và không sửa source.
- Bổ sung requirement `SYS/SWR/IF/SEC/NFR-REQ-MBRTU-*`, verification
  `VR-MBRTU-001..012` và traceability; đăng ký ADR-024 ở trạng thái `Proposed`,
  giữ OD-PROG-007/008 `OPEN` cho tới khi được phê duyệt.
- Ghi rõ xung đột P0: Product baseline yêu cầu hai Modbus RTU master, trong khi
  hardware controlled draft/source hiện mới chứng minh một UART4/RS485 path và
  một master. Không dùng device path giả định hoặc USB adapter lab để đóng gate.

**Kiểm chứng trong phiên:** kiểm tra link Markdown nội bộ của các hồ sơ đã đổi,
kiểm tra coverage ID requirement/verification/traceability, `git diff --check`.
Không chạy build/test source vì thay đổi lần này chỉ là tài liệu thiết kế/review.

**Kết luận:** `DESIGN_PROPOSAL_COMPLETE=YES`, `READY_FOR_DESIGN_REVIEW=YES`,
`MODBUS_RTU_POINT_READY=NO`, `READY_TO_ENTER_PROGRAMMING_DESIGN=NO` cho tới khi
ADR-024, source conforming, two-port hardware/HIL và target provenance đều đạt.

### Added — Nền source DDC-24 trước Programming Design (2026-08-03)

- Chuẩn hóa Point Model của Local Physical I/O, Virtual Point và Modbus RTU
  Point với `point_id`, `tag_name`, `display_name`, `data_type`, `unit`,
  `value`, `quality`, `timestamp`, `read_write`, `source`, `default_value` và
  `safe_value`; BE/Core là source of truth, tag unique toàn namespace và Point
  ID không đổi khi rename.
- Hoàn thiện Modbus RTU Point path: Device/Point CRUD, RS485 serial settings,
  bốn register type, data type/byte order/word order/scale/offset,
  poll/timeout/retry, CRC diagnostics, GOOD/STALE/OFFLINE/BAD, persistence,
  OpenAPI/BE, FE Device & Point Manager, Core EXT Point Table và point stream.
- Thêm I/O bundle atomic cho `io_config.conf` + `io_safe_state.conf`: validate
  trước, chung revision/SHA-256 checksum, rollback cả hai file nếu reload core
  hoặc iobus lỗi. FE Outputs dùng một request bundle có `base_revision` thay vì
  hai request tách rời.
- Thêm firmware IOP runtime portable với UART feed, input sampling, DAC/relay
  apply, startup safe-state, watchdog 200 ms và fault/CRC diagnostics. HAL đang
  là weak boundary; chưa claim STM32 BSP/HIL production.
- Thêm health endpoint cho web/core/iobus/SHM/MCU, kiểm process qua PID/socket;
  thêm build provenance cho C++/Go/firmware, full release builder, checksum
  manifest và installer cài core/iobus/netcfg/web/frontend cùng runtime
  provenance trên target.
- Thêm bốn record:
  `DDC24_BASELINE_SRC_FIX_REPORT.md`,
  `MODBUS_RTU_POINT_AS_BUILT_REPORT.md`, `PHYSICAL_IO_HIL_REPORT.md` và
  `DEPLOYMENT_PROVENANCE_REPORT.md` dưới `docs/07_records/reviews/`.

### Fixed — CI baseline GCC 11 và Playwright (2026-08-03)

- Sửa GCC 11 `-Werror=dangling-else` và helper chỉ dùng khi bật Modbus; không
  tắt warning, không skip test.
- Sửa login locator dùng accessible label exact. Sau khi locator được mở khóa,
  đồng bộ Playwright flow với confirmation modal thật của UI/Outputs/Virtual
  Point và label `Label`; không hạ assertion nghiệp vụ.

**Kiểm chứng đo lại trong phiên:** Ubuntu 22.04/GCC 11 **708/708 CTest PASS**;
C++ Release bật đồng thời Modbus/BACnet/HMI **751/751 PASS**; `go vet ./...` và
`go test ./... -count=1` PASS (22.105 s); FE Vitest **35 file, 299/299 PASS**,
eslint 0 warning, TypeScript/Vite production build PASS; Playwright network +
point-name + trends **21/21 PASS**; firmware host CTest PASS và ARM
`arm-none-eabi-gcc -Wall -Wextra -Werror` build PASS; release bundle build và
SHA-256 verification PASS. Simulator pseudo-TTY Modbus RTU PASS. Trên
`SOM-DDC-24`, crash/restart core, iobus và web đều phục hồi active trong khoảng
1.6–1.8 s.

**Giới hạn:** chưa có Modbus RS485 slave thật; target vẫn dùng fake MCU và chưa
có STM32/physical I/O HIL. Worktree chưa commit nên release được gắn
`5eeb7b9bf95e0c7d7933766ae3bf62e7c6fdb90f-dirty` và không deploy lên target.
Vì vậy Modbus RTU Point, Physical I/O và target provenance vẫn là gate mở;
Programming không được implement trong thay đổi này.

### Added — Tự động dùng Chrome DevTools MCP khi kiểm chứng FE (2026-08-03)

- Thêm skill toàn cục `~/.codex/skills/inspect-fe-chrome-devtools` với implicit
  invocation và dependency MCP `chrome-devtools`; workflow bao phủ xác định
  URL, snapshot/screenshot, Console, Network, tương tác, responsive,
  accessibility, performance và vòng kiểm chứng sau sửa.
- Bổ sung rule dự án vào `AGENTS.md`: tự kích hoạt skill/MCP cho thay đổi hoặc
  review FE có tác động visual/runtime, kiểm tra desktop/mobile khi liên quan,
  không thay test tự động và không áp dụng cho HMI native LVGL/DRM.
- Bật local memories trong `~/.codex/config.toml`, cho phép tạo và dùng memory;
  thêm preference bền vững cho DDC-PROJECT vào memory summary/detail. Giữ
  `disable_on_external_context = true` để nội dung từ MCP/web không tự được
  đưa vào quá trình tạo memory.

**Kiểm chứng trong phiên:** skill được tạo bằng `init_skill.py` và
`quick_validate.py` báo `Skill is valid!`; `codex features list` báo
`memories stable true`; `codex mcp get chrome-devtools` báo STDIO `enabled`;
`git diff --check -- AGENTS.md CHANGELOG.md` sạch. Không chạy build/test sản
phẩm vì thay đổi chỉ gồm cấu hình agent, skill, rule, memory và changelog.

### Added — Cài đặt Chrome DevTools MCP cho Codex (2026-08-03)

- Thêm MCP server toàn cục `chrome-devtools` vào `~/.codex/config.toml`, chạy
  qua `npx -y chrome-devtools-mcp@latest` để Codex CLI, IDE extension và ứng
  dụng Codex dùng chung khả năng điều khiển, kiểm tra Google Chrome.
- Giữ cấu hình mặc định của dự án upstream; không bật remote debugging port,
  không hạ Chrome sandbox và không thêm quyền truy cập đường dẫn không giới hạn.

**Kiểm chứng trong phiên:** `codex mcp get chrome-devtools` và
`codex mcp list` báo `enabled`; package resolve thành `chrome-devtools-mcp`
`1.6.0`; Node.js `24.18.1`, Google Chrome `151.0.7922.71`; bắt tay MCP
`initialize` PASS, `tools/list` trả về 29 tool và gọi thật `list_pages` PASS
với trang `about:blank`.

### Added — Đồng bộ Product Spec Programming DDC-24 Rev A (2026-08-03)

- Thêm `docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md`, khóa phạm vi
  Programming chỉ gồm Local Physical I/O, Virtual Point, Modbus RTU Point, ST,
  FBD và cycle time 1 s/5 s/30 s; loại Modbus TCP Point, BACnet/IP Point, LD,
  SFC, motion và safety PLC khỏi scope.
- Thêm `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` với chuỗi đầy đủ
  Product Capability → Product Requirement → System Requirement → Verification
  Requirement; 12/12 capability và 14/14 product requirement đã có ánh xạ,
  13/13 verification gate production vẫn RED.
- Thêm `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` và
  `docs/07_records/reviews/PROGRAMMING_DOCS_SYNC_REPORT.md`; ghi rõ quyết định
  còn mở, xung đột tài liệu đã xử lý và kết luận readiness.
- Đồng bộ `PRODUCT.md`, `REQUIREMENTS.md`, `SOFTWARE.md`, `INTERFACES.md`,
  `VERIFICATION.md`, `TRACEABILITY.md`, `DECISIONS.md`, Document Hub và
  `CONTROL.md`; chuẩn hóa Project, Program, Point, Variable, Modbus RTU Point,
  I/O Mapping, Revision, Deployment, Activation, Rollback, RETAIN và Online
  Monitor.
- Phân tách Product Spec/Requirement/Design/As-Built; không tạo Programming
  Design hoặc Implementation Plan, không sửa source và không claim Programming
  đã implement. ST host unit test được ghi rõ chỉ là development evidence,
  không phải bằng chứng runtime production.

**Kiểm chứng trong phiên:** kiểm tra link Markdown nội bộ cho toàn bộ tài liệu
đã đổi; kiểm tra trùng/thiếu ID Programming và coverage matrix bằng script
read-only; `git diff --check` sạch. Không chạy build/test source vì thay đổi chỉ
gồm tài liệu và user cấm sửa source.

### Added — Audit as-built FE/BE/FW-SOM trước Planning Programming (2026-08-03)

- Thêm `DDC24_FE_BE_FW_SOM_AS_BUILT_STATUS_AUDIT.md`, đối chiếu tài liệu kiểm
  soát với source, deployment, process/service, API/SQLite, system journal, test
  trực tiếp, Git history, issue và GitHub Actions tại commit
  `5eeb7b9bf95e0c7d7933766ae3bf62e7c6fdb90f`.
- Ghi rõ ranh giới hiện trạng: đường Web → Go → core → iobus → fake MCU đang
  chạy trên Orange Pi 5B; STM32/physical I/O/HIL chưa có; ST runtime có
  source/test nhưng `mkddc-core` production chưa khởi tạo `StScheduler`; FE/BE
  chưa có vòng đời Programming end-to-end.
- Đính kèm bốn ảnh audit UI chụp trong phiên ở `output/playwright/`: login live
  trên SOM, dashboard demo desktop, trạng thái Programming unavailable và
  dashboard mobile 390×844. Ảnh demo được gắn nhãn đúng, không dùng làm bằng
  chứng dữ liệu live.
- Kết luận audit: `PROGRAMMING_FOUNDATION_READY = NO`; liệt kê riêng blocker
  trước Planning, việc xử lý song song và quyết định còn thiếu từ CTO/Product,
  không chuyển thành thiết kế hoặc kế hoạch implement Programming.

**Kiểm chứng đo lại trong phiên:** C++ Release bật đồng thời Modbus/BACnet/HMI
`744/744` CTest PASS · `go vet ./...` + `go test ./... -count=1` PASS · FE
Vitest `296/296` PASS · eslint 0 warning · production build PASS · firmware
ARM cross-build PASS. Hai Playwright gate đang RED: network `0/1`, point-name
`0/18`; tất cả dừng tại cùng locator `getByLabel('Password')` match cả input và
nút `Show password`, chưa chạy assertion nghiệp vụ. GitHub Actions tại HEAD:
Security Scan PASS, Build & Test FAIL do locator trên và GCC 11
`-Werror=dangling-else` ở `fw/tests/test_iop_link.cpp:215`. Runtime SOM được đo
lúc `2026-08-03T10:39:15+07:00`; DB SQLite read-only `quick_check=ok` cho cả ba
file đã audit.

### Changed — Plan 45 Track A: Web UI/UX từ "bịa dữ liệu" sang trung thực và có gate quyền (2026-08-01)

Thực thi `WEB-UX-001…012` + `QA-E2E-001` sau khi chủ dự án phê duyệt plan 45.
Track B (`OPS-CD-001…005`, CI/CD self-hosted runner) **hoãn** theo quyết định
cùng ngày.

**Kiểm chứng (đo lại trong phiên, không dẫn số cũ):** vitest `294/294` ·
eslint `0 warning` · `npm run build` OK · `go vet` sạch ·
`go test ./... -count=1` pass · `ctest` với `MKDDC_ENABLE_MODBUS/BACNET/HMI=ON`
**`743/743`** trong 239 s.

#### Trung thực dữ liệu — không màn hình nào còn khẳng định thứ nó không biết

- `WEB-UX-001` Dashboard bỏ toàn bộ giá trị dự phòng. `?? 23` (CPU), `?? 48`
  (RAM) và một uptime 12 ngày dựng sẵn khiến một board đã mất liên lạc vẫn vẽ
  đồng hồ màu xanh trông hoàn toàn bình thường. `DeviceStatusCard()` không nhận
  tham số nên ô to nhất góc trên cùng luôn báo "ONLINE" kể cả khi `/system/status`
  trả `fault`. Nay map `overall` thật, không có dữ liệu thì `—` và màu xám.
- MAC `00:0D:18:24:AC:01` và giờ hệ thống `23/05/2025 14:32:18` từng gán cứng
  trong JSX, tức hiện y hệt nhau trên mọi thiết bị đã xuất xưởng — ai đối chiếu
  MAC để chắc mình mở đúng tủ sẽ nhận nhầm. Backend bổ sung `device_mac`,
  `device_name`, `location`, `description`, `system_time` vào `/system/status`;
  `primaryInterface()` lấy IP và MAC trong **cùng một lần duyệt** để hai giá trị
  không rơi vào hai card khác nhau.
- `WEB-UX-002` gỡ 4 badge `core/iobus/web/IOP` gán cứng `state="online"` ở trang
  đăng nhập. Trang đó render trước xác thực, mà mọi endpoint trạng thái đều đòi
  tối thiểu `viewer` — nên đó là khẳng định bịa 100%: kỹ thuật viên tới tủ vì mất
  điều khiển, mở web lên vẫn thấy "tất cả online" trước cả khi kịp đăng nhập.
- `WEB-UX-003` gỡ IP phiên `192.168.1.42` và "lần đăng nhập gần nhất"
  `2026-06-15 17:25:04` gán cứng. Hai thứ đó là chỉ dấu an ninh — bịa chúng ra là
  chủ động che dấu hiệu xâm nhập. Backend chưa lưu lịch sử phiên nên gỡ hẳn thay
  vì để `—` vĩnh viễn.

#### An toàn thao tác vật lý

- `WEB-UX-004` viết lại `CommissioningPage`. Bản cũ dài 43 dòng và mỗi nút là một
  lệnh ghi thẳng ra cơ cấu chấp hành, không xác nhận: `Test` gọi
  `runCommissioningTest(point, 50)` — một cú click mở van 50% hoặc đóng
  contactor, với con số 50 gán cứng người vận hành không chọn được. Nhãn
  `Release` gọi cùng đường ghi với giá trị 0, tức "trả quyền" thực chất **đóng
  van về 0%** chứ không trả điều khiển cho vòng lặp tự động. Nay: ô nhập giá trị
  bắt buộc, hộp thoại nêu đích danh point/giá trị/hậu quả vật lý, `Trả về tự
  động` dùng `PUT /points/{id}` với `release: true`, thêm `Trả tất cả về tự
  động`, `refreshMs` để quan sát được phản hồi, và xử lý `state.error` (trước đây
  API hỏng hiện ra y hệt "thiết bị không có output nào").
- `WEB-UX-005` thêm `RequireRole` và bọc mọi route tác động vật lý.
  `RequireAdmin` cũ có định nghĩa nhưng **không bọc route nào**, nên `viewer` vào
  thẳng được trang chạy thử, ép output và quản lý người dùng. Gate mới theo thang
  quyền (`roleAtLeast`) khớp `roleRank` của backend, và khi thiếu quyền thì hiện
  trang giải thích thay vì `Navigate` im lặng về `/`. Ma trận route↔quyền ở
  `src/frontend/src/auth/roles.ts` suy trực tiếp từ bảng route backend.
  `MonitorPage` để mở cho `viewer` (là màn hình theo dõi) nhưng khoá hai đường
  ghi bên trong.

#### Không còn nút chết, không còn toast thành công giả

- `WEB-UX-006` `SettingsPage` nối vào `GET/PUT /system/config/device` thật. Nút
  Lưu cũ chỉ gọi `toast.push('success', 'Đã lưu … (demo)')` và không gửi request
  nào — người vận hành đổi tên thiết bị, thấy thông báo xanh, rời trang, và không
  có gì được lưu. Gỡ 4 thẻ "Mục phụ" không gắn `onClick`, gỡ hai ô chu kỳ không
  có field tương ứng để lưu.
- `WEB-UX-003` nút "Đổi mật khẩu" nối vào `POST /me/change-password` và thêm ô
  mật khẩu hiện tại. Trước đó nó bắn toast thành công mà không gọi API — nếu
  người dùng đổi mật khẩu vì nghi bị lộ thì thông báo giả đó chính là thứ giữ
  cửa mở.
- `WEB-UX-007` trang Lập trình hiện trang giải thích "thuộc Rev B" thay vì
  `<Navigate to="/">` im lặng.
- `WEB-UX-011` `UsersPage` (trước đây đúng 20 dòng, dựng bảng từ `getDemoUsers()`
  **kể cả ở bản live**, nên trên board thật hiển thị 5 tài khoản không tồn tại
  trong khi `users.conf` chỉ có `admin`) nay nối đủ list/tạo/đổi vai trò/đặt lại
  mật khẩu/xoá, tôn trọng guard last-admin. Bỏ hai cột "Họ và tên" và "Trạng thái
  online" vì backend không lưu — thà thiếu cột còn hơn một cột luôn sai.

#### RBAC 3 vai trò dùng được qua Web

- `WEB-UX-009` mở khoá ô tên đăng nhập (trước là `value="admin" readOnly`).
  Backend đã có đủ ba vai trò với `auth.Require(...)` trên từng endpoint và API
  quản trị tài khoản, nhưng **không tài khoản nào trong số đó đăng nhập được qua
  Web** — toàn bộ công RBAC backend nằm chết, và mọi người dùng Web thao tác dưới
  quyền cao nhất. `NavRail` lọc mục menu theo vai trò, dùng chung
  `ROUTE_MIN_ROLE` với gate để hai bên không lệch. Biểu tượng con mắt nay bấm
  được; nút `SSO / AD` bị gỡ (nút chết, đẩy sang Rev B).
- **Đính chính:** plan 45 v1.0 ghi backend có "4 vai trò". Thực tế `Role` trong
  `web/backend/auth.go` chỉ có **3**: `viewer`, `operator`, `admin`.

#### Tương phản WCAG 2.2 AA và theme tối

- `WEB-UX-008` + `WEB-UX-012` làm gộp: cả hai cùng viết lại bộ design token, tách
  ra sẽ phải chạm cùng những file đó hai lần. Bộ cũ trượt diện rộng —
  `--c-border` 1.64:1 (cần 3:1), `--c-warn` 1.18:1 khi làm chữ, 13/14 biến thể
  `StatusBadge` dưới ngưỡng.
- Nguyên nhân gốc của phần badge: nền được tô bằng `rgba()` của **màu tối phủ lên
  nền xám**, làm nền tối đi và kéo tụt tương phản của chính dòng chữ trên nó. Nay
  dùng token nền đặc `--c-*-bg`, thay ~50 chuỗi `rgba()` rải khắp components.
- Token chuyển từ `styles.css` sang `src/theme/tokens.ts`, ghi lên `:root` bằng
  `applyTheme()`. Lý do: test tương phản phải chạy trên token thật, mà `?raw` bị
  plugin Tailwind nuốt còn `node:fs` kéo theo `@types/node`; đồng thời hai theme
  dùng chung một kiểu nên thiếu token là lỗi biên dịch.
- Thêm `--c-on-accent` / `--c-on-fault`: không thể gán cứng `text-white` vì ở
  theme tối `--c-accent` phải sáng lên để đọc được trên nền tối, và khi đó chữ
  trắng trên nó chỉ còn 3.03:1.
- `src/theme/contrast.test.ts` tính tương phản bằng công thức WCAG 2.2 trên token
  thật, cho **cả hai theme**: 4.5:1 cho token chữ, 3:1 cho token đồ hoạ, 14 biến
  thể badge, và luật "nền badge phải lệch ra xa màu chữ chứ không xích lại gần".
- `ThemeProvider` nhớ lựa chọn qua localStorage, bám `prefers-color-scheme` khi
  người dùng chưa chọn, và **không** để hệ điều hành ghi đè lựa chọn rõ ràng.

#### Navigation dùng được ngoài hiện trường

- `WEB-UX-010` thêm `NavDrawer` cho màn hình dưới 1024px. `NavRail` là
  `hidden … lg:flex` và trước đây không có gì thay thế: mở web trên điện thoại là
  mất sạch điều hướng, chỉ còn cách gõ tay URL — với thiết bị mà kỹ thuật viên
  thường xem qua điện thoại ngay tại tủ, đó là mất hẳn khả năng dùng ngoài hiện
  trường. Bẫy focus + `Escape` theo đúng mẫu `Modal.tsx`, đóng ngay khi điều
  hướng.

#### QA và governance

- `QA-E2E-001` thêm `tools/qa/network_board_e2e.sh`. Lần fail duy nhất của E2E
  board hôm 31/07 (UC-WEB-NET-006) không phải lỗi sản phẩm mà là **trạng thái sót
  giữa các kịch bản**: UC-008 để lại giao dịch netcfg chưa kết thúc nên `stage`
  của UC-006 bị từ chối bằng `TRANSACTION_IN_PROGRESS`. Script có
  `reset_transaction` chạy trước *và* sau mỗi kịch bản, cộng `trap` để một lần
  Ctrl-C giữa chừng cũng không để lại giao dịch treo. Cố ý rollback chứ không
  confirm — confirm sẽ chốt một thay đổi mà kịch bản trước bỏ dở. Có guard từ
  chối chạy nhóm mutation nếu đường quản trị đi qua chính interface sắp đổi địa chỉ.
- **ADR-021** (mới): RBAC 3 vai trò thuộc baseline Rev A.0.
  `REVA_SCOPE_ROADMAP` §2/§3/§6 cập nhật theo. Vẫn thuộc Rev B: nhóm quyền tuỳ
  biến, phân quyền theo point, SSO/AD, lịch sử phiên.
- **ADR-022** được ghi vào `DECISIONS.md` ở trạng thái `Proposed` (WP2 xong, còn
  WP1/3/4/5/6).

### Added — Plan 45: dọn blocker Web UI/UX và hoàn tất CI/CD deploy (2026-08-01)

Phạm vi: `docs/03_implementation/45_WEB_UX_REMEDIATION_AND_CICD_PLAN.md` (mới,
trạng thái **Draft — chờ phê duyệt**).

Chủ dự án quyết hoãn FW MCU và làm nốt phần còn lại. Plan gom việc còn lại thành
hai track chạy song song, không dùng chung người và không đụng cùng file: Track A
Web UI/UX (`WEB-UX-001…012`, ≈21,5 ngày công) và Track B hoàn tất ADR-022
(`OPS-CD-001…005` + `QA-E2E-001`, ≈4 ngày công).

**Phạm vi được xác định bằng cách đọc lại code, không chép lại audit.** Audit UI/UX
lập 30/07, sau đó PR #77 đã sửa một phần; rà lại ngày 01/08 cho thấy QW-4 (validate
IP client) và 2/3 nút chết trang đăng nhập đã hết, và **toàn bộ F-01…F-23 của review
code 30/07 đã đóng** — kiểm từng finding trong code chứ không dựa vào trạng thái
ghi trong tài liệu. Những mục đó bị loại khỏi plan để không tính công cho việc đã xong.

Ba điểm được nêu ra để chủ dự án quyết trước khi code, thay vì tự quyết trong lúc làm:

- **Xung đột phạm vi RBAC.** `REVA_SCOPE_ROADMAP` §3 xếp "RBAC đầy đủ" vào Rev B,
  nhưng backend **đã** hiện thực 4 vai trò còn frontend khoá cứng `admin` — sản phẩm
  đã đi quá roadmap ở một đầu rồi dừng nửa chừng ở đầu kia. Làm nốt là hợp lý nhưng
  phải sửa roadmap cho đúng governance, không làm lặng.
- **Theme tối** được audit xếp vào điều kiện nghiệm thu không thể thương lượng nhưng
  tốn 4 ngày và chạm mọi màn hình — hỏi lại xem đã có khách yêu cầu thật chưa.
- **MP-4/MP-5 của audit** (canvas lập trình, lịch tuần kéo-thả) **không** đưa vào,
  vì roadmap đã cắt cả hai sang Rev B; đưa vào là âm thầm mở rộng phạm vi Rev A.

§7 ghi rõ điều plan **không** giải quyết: `fw/Core/Src/main.c` vẫn là 16 dòng
skeleton, mọi kiểm chứng chạy trên `mkddc-fakemcu` + PTY, và **Milestone A của Rev A
("lõi điều khiển chạy trên HW thật") vẫn không đạt được sau khi plan 45 hoàn thành**.
Ghi vào plan để không ai đọc tiến độ UI rồi tưởng sản phẩm đã sẵn sàng.

### Added — Deploy `main` (47edec7) xuống Orange Pi 5B + script deploy WP2 (2026-08-01)

Phạm vi: `tools/deploy/deploy_board.sh` (mới), deploy thật lên board lab
`orangepi5b` (aarch64, Debian Bookworm).

**Bối cảnh.** Board đang chạy bản build tay ngày 31/07 dựng từ nhánh
`fix/review-2026-07-30-fe-be-fwsom`; nhánh đó tới 01/08 mới merge vào `main` qua
PR #77. Board vì vậy lệch với `main` và cần cắt lại từ nhánh chính thức.

**Đã cắt** (commit `47edec74`): `mkddc-core`, `mkddc-iobus`, `mkddc-netcfg`,
`mkddc-hmi`, `mkddc-st-compile`, `mkddc-st-validate` build native aarch64 trên
chính board; `mkddc-web` cross-compile `CGO_ENABLED=0` và `dist/` build ở host.

**Số đo kiểm chứng**

| Bộ kiểm | Kết quả |
|---|---|
| `go vet ./...` + `go test ./... -count=1` (host) | pass |
| `npm run build` (`tsc --noEmit` + vite) | pass |
| `ctest` trên board, bật MODBUS+BACNET+HMI | 738/743 pass |
| 5 test hỏng + 6 test skip, chạy lại trong mount namespace `/dev/shm` sạch | 17/17 pass |
| Health check sau khi cắt | GET `/` = 200, `/api/v1/system/status` = 401, magic `io_shm`/`plc_shm` = `0x4B584404` |
| Service sau 1 phút | 5/5 active, `NRestarts=0`, `end1`+`wlan0` nguyên trạng |

5 test hỏng (`BacnetObjTable.*`, `StIntegration.*`) **không** phải hồi quy: chúng
`ASSERT_TRUE(t.attach())` trên `/dev/shm/mkddc_{io,plc}_shm` vốn thuộc `mkddc:mkddc`
mode `0644`, còn ctest chạy bằng user `orangepi` nên không mở được `O_RDWR` — đúng
nguyên nhân đã ghi ở evidence 31/07.

**Script `tools/deploy/deploy_board.sh`** hiện thực WP2 của
[ADR-022](docs/adr/ADR-022-ci-cd-tu-dong-deploy-xuong-board.md): kiểm journal
`netcfg-transaction.json` và huỷ deploy nếu còn giao dịch dở (§2.7) → backup →
staging → dừng service theo thứ tự an toàn → hoán đổi → khởi động → health check →
rollback tự động nếu fail; sinh `DEPLOY_MANIFEST.txt` (commit + SHA-256) và giữ 5
backup gần nhất.

**Một lỗi của chính script đã lộ ra và được vá ngay trong phiên.** Lần chạy đầu
health check bắn một phát ngay sau `systemctl start` và nhận `000`
(connection-refused) → script rollback. Nguyên nhân gốc: `mkddc-web` mất ~23 giây
migrate historian rồi mới bind cổng 8081, nên "chưa bind" bị đọc nhầm thành "hỏng".
Sửa bằng `wait_http()` chờ có hạn 90 giây trước khi kết luận.

Sự cố đó đồng thời là **diễn tập rollback không hẹn trước (WP6)**: rollback khôi
phục cả 6 binary + `mkddc-web` + `dist/` và SHA-256 sau khôi phục **khớp từng byte**
với bản trước deploy, service trở lại active. Cơ chế an toàn của ADR-022 vì vậy đã
được chứng minh trên phần cứng thật chứ không chỉ trên giấy.

### Added — Quy tắc dự án: chuẩn hoá quy trình khi user nói "commit"/"merge" (2026-08-01)

Phạm vi: `CLAUDE.md`, `AGENTS.md` (giữ hai file đồng bộ như quy ước sẵn có).

Ghi thành quy tắc một quy trình vốn phải nhắc lại bằng miệng mỗi lần: khi user chỉ
nói ngắn gọn "commit" / "merge" / "commit đi" / "merge đi" thì chạy **trọn chuỗi**
cho toàn bộ thay đổi trong cây làm việc, không hỏi lại từng bước — kiểm chứng bằng
số đo thật → cập nhật CHANGELOG → **commit tách theo nhóm logic** → push → tạo PR →
merge → xoá nhánh remote.

Hai điểm được chốt vì đã từng gây sót:

- **Commit phải tách nhóm và viết chi tiết**, thân bài tiếng Việt theo mạch *triệu
  chứng → nguyên nhân gốc → cách sửa* kèm `Refs:` mã finding. Mục tiêu: lịch sử git
  tự nó là hồ sơ truy xuất được cho audit/chứng nhận, không phải một commit to
  không đọc được.
- **Ba cái bẫy đo kiểm** được ghi thẳng vào rule: `ctest` phải bật đủ 3 option
  (mặc định `MKDDC_ENABLE_HMI=OFF` nên gate HMI dễ bị bỏ sót — đúng finding F-14 của
  review 2026-07-30); `go test` phải có `-count=1` vì kết quả cache che được hồi quy;
  và `npm test` chỉ quét `src/` **không** chạy `e2e/` — đúng lý do bộ e2e mục dần mà
  không ai biết (F-07).

Kèm quy định xử lý khi một bước bị chặn: làm hết các bước không bị chặn rồi nói rõ
bước còn lại và cần gì để mở khoá, thay vì dừng ngang khi chưa commit xong.

### Fixed — Đính chính số liệu độ phủ test `netcfg` trong báo cáo tình trạng, và chốt số đo kiểm chứng cuối của cả loạt (2026-08-01, đợt 5)

Phạm vi: `docs/07_records/reviews/KX-DDC24-SETTINGS-NETWORK-IMPLEMENTATION-STATUS-2026-07-31.md`
(lên rev 1.1 — **chỉ tài liệu, không đổi code sản phẩm**).

**Lỗi số liệu trong tài liệu có bảng phê duyệt.** Bản 1.0 ghi `netcfg_tests` chỉ có
**11 test** và từ đó kết luận `LinuxPlatform` "chưa có test trực tiếp" ở `run`,
`persist`, `read_interface_state`, `interface_has_address` (§2.3, §4.1, §5, §8, và
bảng tóm tắt §1). Kiểm lại trên chính mã nguồn của commit đang rà soát:

```
git show 87a0ff0:services/netcfg/tests/test_netcfg.cpp | grep -cE '^TEST\('
→ 37   (NetcfgEngine 17 · NetcfgLinuxPlatform 16 · NetcfgValidation 3 · NetcfgServer 1)
```

Nguyên nhân: lệnh xác minh ở §2.3 chạy `./build/services/netcfg/netcfg_tests` — một
**binary cũ còn sót trong `build/`**, không phải bản dựng từ `87a0ff0`. Tức báo cáo đã
đo một thứ khác với thứ nó đang rà soát. Đã sửa cả năm chỗ.

Nhận định §4.1/§8 được viết lại cho đúng bản chất: độ phủ `LinuxPlatform` **không
mỏng** — 16 test đã phủ persist DNS, đọc profile/kernel state, và sáu nhánh
fail-closed của rollback. Hạn chế thật nằm ở chỗ khác: mọi test đều nạp sẵn output
cho `run`, nên chúng chốt được logic dựng lệnh và xử lý kết quả, **chứ không chứng
minh được `nmcli` thật hành xử như giả định**. Đúng loại lỗi mà F-14
(`promote_secondaries = 0`) là ví dụ — chỉ lộ ra khi chạy trên phần cứng thật.

Các phát hiện F-01…F-13 và khoảng trống G-01…G-06 **không thay đổi**: không phát hiện
nào được rút ra từ con số 11.

**Số đo kiểm chứng cuối, đo lại toàn bộ tại cây làm việc hiện tại (2026-08-01):**

| Bộ | Kết quả |
|---|---|
| `ctest` (MODBUS+BACNET+HMI **ON**) | **743/743 PASS** |
| `netcfg_tests` (chạy trực tiếp) | **53/53 PASS** |
| Go `go vet ./...` + `go test ./... -count=1` | **PASS**, vet sạch |
| vitest `src` | **152/152 PASS** (26 file) |
| `npm run lint` (`--max-warnings=0`) | sạch |
| `npm run build` | OK |
| Playwright `e2e/network-qa.spec.ts` | **1/1 PASS** (gate CI mới của F-07) |

Ghi chú đối chiếu: các entry đợt 1–2 nêu `ctest` 706/706 rồi 710/710 — đó là số đúng
tại thời điểm viết từng đợt; 743 là số của cây hoàn chỉnh sau khi cộng dồn test mới
của cả loạt. Không con số nào tụt xuống.

### Fixed — Nút xác nhận quay vô hạn khi đổi IP, và giảm 5 lần tải poll của trang mạng (2026-07-31, đợt 4)

Phạm vi: `src/frontend/src/api/client.ts`, `src/frontend/src/pages/NetworkPage.tsx`,
test vitest và e2e tương ứng.

**Lỗi: nút "Giữ thay đổi" quay mãi không dừng.** `fetch` **không tự hết giờ**. Ngay
sau khi áp dụng địa chỉ mới, kết nối của trình duyệt tới địa chỉ CŨ có thể treo —
không phản hồi mà cũng không báo lỗi. Khi đó `transactionBusy` kẹt ở `'confirm'`,
spinner quay vô hạn, và nút "Hoàn tác ngay" bị khoá theo vì dùng chung
`mutationLocked`. Người vận hành mất hết đường xử lý, chỉ còn ngồi chờ auto-rollback
— đúng lúc họ cần bấm nhất.

Sửa: mọi request qua `requestJson` nay có `AbortController` với trần **15 giây**, giữ
nguyên `signal` của caller, và phân biệt rõ "thiết bị không phản hồi sau N giây" với
lỗi mạng khác. Riêng `PUT /api/v1/network` được nới lên **120 giây** vì đường này
khởi động lại dịch vụ field bus qua reload helper.

**Hiệu năng: giảm ~5 lần tải ở trạng thái nghỉ.** Trang gọi **hai** endpoint mỗi
giây, liên tục, kể cả khi không có gì xảy ra: mỗi vòng `GET /network` đọc 4 file cấu
hình + SHM, còn `GET /network/transaction` mở socket sang `mkddc-netcfg` — vốn đơn
luồng, nên chính việc poll dày cũng tự làm nó chậm thêm (xem số đo ở evidence §8c).

Nay bám nhịp theo việc thật:

| Dữ liệu | Trước | Sau |
|---|---|---|
| `GET /network` (BACnet/WiFi, slave) | 1 s | **5 s** — cấu hình đổi rất thưa |
| `GET /network/transaction` khi rảnh | 1 s | **5 s** |
| `GET /network/transaction` khi có giao dịch | 1 s | **1 s** (giữ nguyên cho đếm ngược 120 s) |

Kiểm chứng: vitest **152/152**, lint sạch, Playwright `network-qa` **pass**, FE đã
deploy lên Orange Pi. Board sau khi deploy: `state=confirmed`, **đúng một** địa chỉ
`192.168.1.102/24` trên `end1` (bằng chứng F-14 đã đóng), `wlan0` nguyên vẹn.

### Changed — Gom thanh nút trang mạng từ 5 xuống 2, giấu máy trạng thái khỏi người vận hành (2026-07-31, đợt 3)

Phạm vi: `docs/04_uiux/KX-DDC24-UC-WEB-NETWORK-001_VI.md` (UC-WEB-NET-005 rev 1.1),
`docs/04_uiux/KX-DDC24-UX-WEB-NETWORK-001_VI.md` (§4.4, §4.4b),
`src/frontend/src/pages/NetworkPage.tsx`, test vitest và e2e tương ứng.
Làm theo đúng thứ tự **doc trước, code sau**.

**Vấn đề.** Trang phơi thẳng 5 nút mang đúng tên lệnh giao thức —
`Validate / Stage / Apply / Confirm / Rollback` — ra mặt người vận hành. Đó là rò rỉ
chi tiết hiện thực: người dùng phải tự học một máy trạng thái chỉ để đổi một địa chỉ IP.

**Thay đổi.** Thanh nút còn **đúng hai**: **Kiểm tra** và **Lưu thay đổi**.
`Lưu thay đổi` chạy `stage` rồi `apply` liên tiếp. `Confirm`/`Rollback` không còn là
nút thường trực — chúng chuyển vào **hộp thoại tự bật** khi giao dịch vào cửa sổ 120
giây, hiển thị địa chỉ **cũ → mới**, đồng hồ đếm ngược MM:SS và câu quan trọng nhất:
*"Nếu mất kết nối, thiết bị tự quay lại cấu hình cũ sau MM:SS"*.

**Cơ chế an toàn được GIẤU ĐI, không bị bỏ đi.** Vẫn nguyên vòng đời
stage→apply→confirm, vẫn auto-rollback 120 giây, `Lưu thay đổi` vẫn bị khoá khi chưa
có carrier / chưa vào bằng hostname ổn định / form không hợp lệ. Đây là pattern
*commit-confirm* mà thiết bị mạng công nghiệp dùng cho đúng bài toán "đổi IP từ xa".
Cố tình KHÔNG gom tiếp thành một nút "Lưu" duy nhất: bước xác nhận là thứ duy nhất
phân biệt "đổi IP thành công" với "tự cắt đường vào thiết bị".

Hộp thoại không đóng được bằng `Esc`/bấm ra ngoài — đóng nhầm sẽ để giao dịch treo
tới lúc tự rollback mà người dùng không biết.

**Một lỗi do chính test bắt được:** bản đầu của hộp thoại quên đưa `reconcileAfter`
vào điều kiện khoá nút, nên sau một mutation có kết quả bất định thì `Giữ thay đổi`
vẫn bấm được. Đã sửa dùng chung `mutationLocked`.

Kiểm chứng: vitest **152/152** (28 cho NetworkPage), lint sạch, Playwright
`network-qa` **pass**, deploy FE lên Orange Pi và xác minh `admin/admin123` cùng
netcfg hoạt động bình thường.

### Added — Tài liệu thiết kế Web cho trang mạng, đóng G-01/G-02/G-04 và mở finding F-14 (2026-07-31, đợt 2)

Phạm vi: `docs/04_uiux/KX-DDC24-UX-WEB-NETWORK-001_VI.md` (mới),
`docs/04_uiux/KX-DDC24-UC-WEB-NETWORK-001_VI.md`, `docs/04_uiux/README.md`,
`docs/adr/ADR-017-*`, `docs/03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md`,
`docs/07_records/TRACEABILITY.md`, `.github/workflows/build-and-test.yml`,
`src/frontend/src/pages/LoginPage.tsx`, `src/frontend/e2e/network-qa.spec.ts`.

Làm theo đúng thứ tự **doc trước, code sau** và quy trình ở `docs/00_governance/CONTROL.md`.

**Tài liệu (đóng G-02):** lập UI/UX spec + wireframe đầu tiên cho Web — nguyên tắc
bắt buộc (không suy diễn, tách bạch 4 tầng sự thật, thành công chỉ từ authority),
bố cục, đặc tả từng khối, điều kiện bật/tắt nút, ràng buộc nhập liệu phản chiếu
backend, quy tắc ngôn ngữ và WCAG 2.1 AA.

**Ranh giới LAN ETH (ADR-017 §2.1):** chốt authority chỉ quản lý **đúng một**
interface Ethernet theo `NETCFG_INTERFACE` (mặc định `end1`), và ghi tường minh
rằng **`wlan0` cùng mọi interface Wi-Fi nằm ngoài phạm vi** — Wi-Fi là đường quản
trị dự phòng để truy cập DDC khi Ethernet đang được cấu hình lại; nếu authority
đụng vào thì một lần đổi IP hỏng sẽ cắt cả hai đường. Chốt mặc định nhà máy
`eth.mode = "dhcp"`. Bỏ chữ "tabs" khỏi tiêu đề ADR-017 cho khớp nội dung (G-04).

**Tài khoản gốc nhà máy:** ghi vào Web guide — `admin` / `admin123`, role admin,
lưu bcrypt như mọi tài khoản; kèm ràng buộc không dùng cho tích hợp máy-máy và
**bắt buộc đổi khi bàn giao site**.

**Code:** sửa lỗi **mất deep link sau đăng nhập** — `ProtectedShell` vẫn truyền
`state.from` nhưng `LoginPage` bỏ qua và luôn về `/`, nên mở link tới
`/settings/network` xong đăng nhập là mất đích đến; nay quay lại đúng trang, có
chặn open-redirect (chỉ nhận đường dẫn nội bộ một dấu `/`).

**F-07 đã đóng:** `network-qa.spec.ts` được sửa cho khớp contract mới (fixture có
`activeBacnetPort`/`firmware`/`serial`, gateway nhất quán subnet, `role=switch`,
hộp thoại xác nhận) và **đã gắn vào CI**. Cố ý chỉ gate spec mạng:
`point-names.spec.ts` còn 14 test hỏng **có sẵn** thuộc tính năng đặt tên điểm —
đã kiểm chứng bằng cách stash toàn bộ thay đổi FE, lỗi giữ nguyên.

**Deploy đợt 2:** build native aarch64 toàn bộ (`rc=0`, 0 lỗi) và deploy **cả
`mkddc-core`** vốn còn là bản 30/07 ở đợt 1. `ctest` trên board trong namespace
`/dev/shm` sạch: **706/706 passed**. `end1` đưa về **DHCP đúng mặc định nhà máy**
qua chính transaction của authority; `wlan0` không bị chạm (vẫn `192.168.1.18`, giữ
default route dự phòng metric 600). Xác minh `admin/admin123` đăng nhập được sau
deploy. E2E trên board: **38/39**.

**Đo bằng chứng netcfg single-thread:** status lúc rảnh ~0.34 s; trong lúc mutation
có ARP preflight, một request lên 2.68 s rồi trở lại bình thường — **đều HTTP 200,
không gây lỗi**. Không đủ cơ sở để refactor khoá của engine giao dịch an toàn; ghi
nhận là giới hạn đã biết thay vì churn code.

**F-14 (Cao) — ĐÃ SỬA, kiểm chứng trên phần cứng thật.** Đổi IPv4 tĩnh sang IPv4
tĩnh **cùng subnet** rồi Confirm khiến interface **mất SẠCH địa chỉ IPv4**: thiết bị
rớt khỏi mạng dù authority đã báo `confirmed`.

Nguyên nhân: `apply` **cố ý** giữ địa chỉ cũ và chỉ thêm địa chỉ mới, để phiên quản
trị không đứt trong cửa sổ 120 giây — thiết kế đúng. Nhưng khi hai địa chỉ cùng
subnet, kernel gắn địa chỉ mới làm **secondary**, và với
`net.ipv4.conf.<if>.promote_secondaries = 0` (mặc định trên board) thì lệnh xoá địa
chỉ **primary** trong `confirm` kéo theo xoá luôn secondary cùng subnet. Chỉ nhánh
static→static cùng subnet mới sai (DHCP→static và khác subnet đều đúng), nên lỗi ẩn
rất lâu và chỉ lộ ra khi chạy thật trên phần cứng.

Sửa: sau khi xoá địa chỉ cũ, `confirm` **khẳng định lại** địa chỉ candidate và
**fail-closed** nếu không đặt lại được — thà báo lỗi để rollback còn hơn chốt
`confirmed` trên một interface không có địa chỉ. Nhánh DHCP được loại trừ.

Bốn test mới chốt đủ bốn nhánh chuyển đổi, fake mô phỏng đúng hành vi
`promote_secondaries = 0` của kernel. `ctest` **710/710**; `netcfg_tests` trên board
aarch64 **53/53**.

Bằng chứng trên cùng board, cùng kịch bản — trước: sau confirm không còn dòng `inet`
nào, `active.ipv4=''`; sau: còn đúng `192.168.50.161/24`, `active.ipv4` khớp,
`reason=OK`. Chi tiết: `docs/07_records/test-evidence/fw-som/2026-07-31-network-page-board-e2e.md` §8b.

**netcfg đơn luồng — không sửa, có chủ đích.** Đo được status ~0,34 s lúc rảnh và
một lần 2,68 s trong lúc mutation, tất cả HTTP 200 không lỗi. Không đánh đổi rủi ro
refactor khoá của engine có rollback fail-closed khi chưa có lỗi thực tế; ghi nhận
là giới hạn đã biết (§8c).

### Fixed — Đóng finding trang `settings/network` trên FE + BE + FW SOM, bỏ hoàn toàn số liệu giả (2026-07-31)

Phạm vi: `shared/mkddc_shm.h`, `services/iobus/{main.cpp,io/io_cache.*}`,
`services/netcfg/netcfg.cpp`, `web/backend/{networkapi,core_client,reload*,main}.go`,
`web/backend/reloadhelper_linux.go` (mới), `packaging/systemd/mkddc-reload-helper.service` (mới),
`src/frontend/src/{pages/NetworkPage.tsx,types.ts,App.tsx,components/NavRail.tsx,demo/simulator.ts}`.

**Nguyên tắc xuyên suốt: trang này không còn suy diễn hay bịa số liệu.** Thiếu số
đo thì hiển thị `—`/`unknown`, không quy về `0`/`online`.

**FW SOM — nguồn số liệu thật (mới):**
- `kx_io_shm_t` NỐI THÊM vào cuối (giữ nguyên magic, mọi offset cũ bất biến):
  `bacnet_udp_port`, `bacnet_bound`, `fb_slave_count`, `fb_publish_seq` và
  `fb_slave[32]` kiểu `kx_slave_metrics_t` (24 byte/slave). Segment 528 → 1304 byte;
  reader cũ vẫn đọc đúng nhờ ngữ nghĩa min-length.
- `mkddc-iobus` publish `FieldbusMetrics` per-slave mỗi chu kỳ poll và publish cờ
  bind BACnet/IP THẬT sau `bip_init()`/`rebind()` — kể cả khi BACnet bị tắt, để
  phân biệt "đã nói rõ là không bind" với "iobus cũ chưa ghi field này".

**Ba lỗi FW SOM phát hiện khi chạy E2E trên phần cứng thật (chưa từng lộ ra ở host test):**
- **Profile trùng tên khoá cứng thiết bị.** NetworkManager cho phép nhiều profile
  cùng tên và board có 2 profile tên `end1`; netcfg truyền TÊN vào `nmcli` nên
  `-g ipv4.method` trả `"manual\n\nmanual"` → `mode=unknown` → `configured=null` →
  **mọi lần stage sau đó bị từ chối bằng `PREVIOUS_STATE_NOT_RESTORABLE`**, tức
  không còn đổi được mạng qua giao diện cho tới khi có người vào SSH dọn profile.
  Nay tra cứu bằng **UUID** (duy nhất) + đọc theo dòng đầu.
- **Candidate DHCP sai schema làm hỏng cả trang.** `to_json(Candidate)` luôn phát
  `ipv4`/`netmask`/`gateway` kể cả rỗng, trong khi schema v1 cấm ba field này khi
  `mode=dhcp`. Sau khi stage DHCP, adapter Go từ chối response ⇒ **mọi lần đọc
  status trả 502 và trang settings/network không dùng được**. Nay bỏ hẳn field rỗng.
- **Không đổi được mỗi DNS.** `arping -D` chạy trên chính interface đang giữ địa chỉ
  nên tự phát hiện mình là trùng ⇒ `DUPLICATE_ADDRESS`, chặn thao tác hợp lệ "giữ
  IP, đổi DNS". Nay bỏ qua probe khi candidate trùng địa chỉ hiện hành của interface.

**BE:**
- **F-01** `applySystem` không còn là stub. Thêm privileged helper
  `mkddc-web reload-helper-server` + unit systemd chạy root, socket 0660
  `root:mkddc`, **allowlist cứng** (client không gửi được tên unit tuỳ ý; không có
  `mkddc-core`, không đụng gì tới mạng). Chuỗi `reload system pending B7
  (systemd/polkit)` lọt ra toast người vận hành được thay bằng thông điệp hành động
  được; hạng mục "B7" vốn không tồn tại trong tài liệu nào nay đã có hiện thực.
- **F-03/F-04/F-10** `networkSlavesFromConfig` dùng số đo per-slave THẬT, ghép theo
  **địa chỉ Modbus** (ghép theo chỉ số sẽ gán nhầm sức khoẻ thiết bị này sang thiết
  bị khác); `ErrorRate`/`LastPollMS`/`TotalPolls` thành con trỏ, `nil` = chưa đo.
  `bmsLinkStatus` lấy từ cờ bind thật thay vì suy ra từ file config (vi phạm
  ADR-017 §2.9 + tiêu chí nghiệm thu UC-HMI-016). Thêm `activeBacnetPort`,
  `firmware`, `serial` (đọc device-tree; rỗng = chưa nạp, không bịa mã).
- **F-06** RBAC thống nhất theo ADR-017 §2.7: bỏ `RequireAdmin` khỏi route và bỏ
  điều kiện ẩn mục Network trong NavRail — viewer/operator đọc được, mutation vẫn
  Admin-only ở cả backend lẫn trong trang. Trước đây nhánh chỉ-đọc ở backend, ở
  component và bài unit test cho nó đều là **mã chết**.

**FE:**
- **F-02** `Poll health` từng KHÔNG BAO GIỜ hạ dưới 100% (backend chỉ phát
  `online`/`degraded`, FE chỉ trừ `offline`) nên ô cảnh báo không bao giờ sáng; nay
  tính theo tỉ lệ slave thực sự online, chưa đo thì hiện `—`.
- **F-05** hiện lý do cho MỌI kết thúc bất thường (`failed`, `rolled_back`), không
  chỉ `rejected` — đúng tình huống quan sát được trên board: badge đỏ FAILED không
  một chữ giải thích.
- **F-08** validate IPv4/netmask/gateway/DNS ngay trên client (phản chiếu đúng luật
  backend), `aria-invalid` + lỗi inline, khoá Validate/Stage khi form sai.
- **F-09** modal xác nhận hậu quả trước khi lưu BACnet/WiFi (thao tác này khởi động
  lại field bus). **F-11** song ngữ hoá nhãn + 2 tiêu đề panel vốn trộn cứng VI/EN.
  **F-12** countdown MM:SS + đối chiếu địa chỉ cũ→mới ngay trong thẻ giao dịch.
  **F-13** `role="switch"` + `aria-checked` (WCAG 2.1 AA §4.1.2).

**Kiểm chứng:** ctest **706/706**; Go **toàn bộ pass**; vitest **152/152** (28 test
cho riêng NetworkPage). Deploy thật lên Orange Pi 5B (aarch64): `io_shm` 528→1304,
`mkddc-reload-helper` active. **E2E trên phần cứng thật: 38/39 PASS** — gồm vòng đời
Stage → Apply → Confirm với kernel nhận địa chỉ thật, rollback về last-known-good,
DNS thủ công, RBAC viewer, và `activeBacnetPort` đổi 47808→47810 chứng minh F-01 đã
áp dụng thật. Lần fail còn lại là do trạng thái sót giữa các kịch bản trong chính
script E2E, không phải lỗi sản phẩm.

**Tài liệu đóng kèm:** `docs/04_uiux/KX-DDC24-UC-WEB-NETWORK-001_VI.md` (G-01 — 10 use
case Web đầu tiên của sản phẩm, kèm ma trận truy vết tới unit test và E2E phần cứng);
`docs/06_operations/RUNBOOK_NETWORK_TRANSACTION_RECOVERY_VI.md` (G-06 — thủ tục khôi
phục giao dịch kẹt/`failed`); `docs/07_records/test-evidence/fw-som/2026-07-31-network-page-board-e2e.md`
(bằng chứng deploy + E2E); ADR-017 bỏ chữ "tabs" khỏi tiêu đề cho khớp nội dung (G-04).

**Chưa đóng — F-07:** bộ `src/frontend/e2e/` vẫn chưa được gắn vào CI, vì khi chạy
thử thì suite đã MỤC sẵn (`network-qa.spec.ts` không vào được `/settings/network`,
`point-names.spec.ts` hỏng hàng loạt). Đã kiểm chứng bằng cách stash toàn bộ thay
đổi FE của bản này — lỗi giữ nguyên ⇒ có sẵn, không phải hồi quy. Phải sửa suite
trước rồi mới bật gate, thay vì thêm một job biết chắc đỏ.

### Added — Báo cáo tình trạng triển khai trang `settings/network` xuyên suốt UI/UX · UC · FE · BE · FW SOM (2026-07-31)

Phạm vi: `docs/07_records/reviews/KX-DDC24-SETTINGS-NETWORK-IMPLEMENTATION-STATUS-2026-07-31.md`
(tài liệu mới, chỉ đọc mã nguồn — **không thay đổi code sản phẩm**). Rà soát tại
nhánh `fix/review-2026-07-30-fe-be-fwsom` @ `87a0ff0`, trình bày theo ISO 9001:2015 /
ISO/IEC/IEEE 12207 / 29148 / ISO 9241-11.

Đối chiếu triển khai thực tế với ADR-017, `shared/netcfg_protocol_v1.schema.json`,
Web Implementation Guide Rev 1.36 và bộ tài liệu UX/UC. Kết quả: **13 phát hiện
(4 mức Cao) + 6 khoảng trống tài liệu**.

**Kết luận hai nửa trang tách biệt rõ rệt:**
- Panel ETHERNET (giao dịch an toàn) 🟢 đạt 9/10 quyết định ADR-017 §2, có bằng
  chứng test ở cả ba lớp: auto-rollback deadline kép epoch+steady clock, journal
  bền vững, idempotency theo `requestId`, khoá `Apply` theo hostname ổn định và
  theo carrier, `reconcileAfter` khoá thao tác khi kết quả request bất định.
- Panel NORTHBOUND/SOUTHBOUND 🔴 chưa đạt — đang trình bày **thông tin sai lệch**
  chứ không chỉ thiếu thông tin.

**4 phát hiện mức Cao:**
- **F-01** `applySystem` trên Linux là stub trả `false` + `"reload system pending B7
  (systemd/polkit)"` → lưu BACnet Device ID/port, tên thiết bị và WiFi **ghi được
  file nhưng không bao giờ áp dụng**; chuỗi thuật ngữ nội bộ này lọt thẳng tới toast
  người vận hành. Hạng mục "B7" **không tồn tại trong bất kỳ tài liệu nào**.
- **F-02** `Poll health` về mặt cấu trúc **không bao giờ hạ dưới 100%**: backend chỉ
  phát `online`/`degraded`, còn FE chỉ trừ `offline` → `warn` không bao giờ kích
  hoạt; hai thẻ KPI cạnh nhau mâu thuẫn (`0/3 online` bên cạnh `Poll health 100%`).
- **F-03** Telemetry per-slave Modbus là giả lập: `ErrorRate` cứng bằng 0, `PollState`
  và `LastPollMs` là một giá trị toàn cục sao chép cho mọi dòng, nhưng UI trình bày
  như số đo riêng từng thiết bị.
- **F-04** `bmsLinkStatus()` suy diễn `online` chỉ từ ba trường trong file config khác
  rỗng — vi phạm **ADR-017 §2.9** ("không báo success từ desired file") và tiêu chí
  nghiệm thu **UC-HMI-016**; FE còn dùng làm fallback cho badge Ethernet ở header khi
  authority mất kết nối.

**6 khoảng trống tài liệu:** G-01 **không tồn tại họ `UC-WEB`** (kho chỉ có `UC-HMI`
19 mục + `UC-LOCAL` 14 mục) — trang cấu hình rủi ro nhất không có use case phía Web;
G-02 **không có wireframe/mockup nào cho Web** (phía HMI thì có); G-03 hạng mục B7
không được tài liệu hoá; G-04 ADR-017 mang tiêu đề "tabs" nhưng thân ADR không định
nghĩa tab và triển khai cũng không có tab; G-05 thiếu ma trận truy vết UC→FE→BE→FW→test;
G-06 thiếu runbook khôi phục giao dịch `failed`.

**Phát hiện khác:** F-05 trạng thái `failed` không hiển thị lý do (xác nhận bằng ảnh
chụp thiết bị thật đang ở `FAILED` không kèm giải thích); F-06 mâu thuẫn RBAC —
ADR-017 §2.7 và backend cho `viewer` đọc, component có nhánh chỉ-đọc **và có unit
test**, nhưng router bọc `RequireAdmin` khiến toàn bộ nhánh này là mã chết; F-07 bộ
e2e `network-qa.spec.ts` (258 dòng) **không được nối vào CI**; F-08…F-13 validate
client, modal xác nhận, trường chết `Serial`/`Firmware`, song ngữ, countdown, a11y.

**Bằng chứng kiểm thử đã chạy — toàn bộ PASS:** Go `-run 'Network|Netcfg'` 17/17 ·
vitest `NetworkPage.test.tsx` 16/16 · `netcfg_tests` 11/11. Playwright không chạy.
Ghi nhận trọng yếu: **cả 4 phát hiện mức Cao đều nằm trong vùng không có test**.

**Khuyến nghị gate:** giữ **Network gate = RED** (thống nhất ADR-017 §3), bổ sung điều
kiện đóng F-01…F-05 và có `UC-WEB` trước khi xem xét chuyển AMBER.

### Added — Đánh giá sản phẩm & UI/UX Web UI: báo cáo audit độc lập 22 màn hình (2026-07-30)

Phạm vi: `docs/07_records/reviews/KX-DDC24-UIUX-PRODUCT-AUDIT-2026-07-30.md` (tài
liệu mới, chỉ đọc mã nguồn — **không thay đổi code sản phẩm**).

Đánh giá với vai trò Senior PM + Lead UI/UX Designer độc lập, áp dụng Nielsen 10
Usability Heuristics, ISO 9241-11, WCAG 2.2 AA và thực hành ISA-101 / ISA-18.2 cho
HMI công nghiệp. Đọc toàn bộ 13.710 dòng UI trong `src/frontend/`.

**Điểm sức khỏe sản phẩm: 3.5/10 — chưa sẵn sàng thương mại hóa.** 5 blocker:
- Dashboard/Login/UserInfo **hiển thị dữ liệu thiết bị bịa đặt**: `DeviceStatusCard`
  không nhận tham số nên luôn báo "ONLINE"; CPU/RAM/uptime có giá trị dự phòng giả
  (`?? 23`, `?? 48`); MAC và thời gian hệ thống `23/05/2025 14:32:18` hardcode; 4
  badge service ở Login gán cứng `online` và hiện **trước khi xác thực**.
- `CommissioningPage` (43 dòng): nút "Test" **ép AO 50%/DO ON ra thiết bị vật lý
  ngay, không có dialog xác nhận**; nhãn "Release" thực chất ghi 0/false chứ không
  trả quyền về tự động; thiếu "Release All"; thiếu cả nhánh xử lý `state.error`.
- RBAC đảo ngược ưu tiên: **chỉ `/settings/network` có `RequireAdmin`**, còn force
  output / commissioning / cấu hình I/O đều không gate → `viewer` tác động được
  thiết bị. Kèm `LoginPage` khóa cứng `value="admin" readOnly` nên **RBAC 4 vai trò
  ở backend không dùng được qua Web UI**; 3 nút chết (SSO/AD, quên mật khẩu, ghi nhớ).
- WCAG: **13/14 biến thể `StatusBadge` không đạt 4.5:1** (badge `ALARM` chỉ 3.74:1);
  `--c-border` chỉ 1.64–1.90:1 (SC 1.4.11 cần 3.0); badge số cảnh báo trên TopBar
  thiếu `text-white` nên còn 3.21:1 (NavRail đúng, 5.16:1); `.stale` với
  `opacity:0.62` đẩy màu lỗi xuống 2.51:1 đúng lúc dữ liệu đã cũ; **không có theme
  tối** (`color-scheme: light`, nền luminance 60–70% gây lóa trong phòng máy).
- `/eng/programming` **redirect âm thầm về Dashboard trong mọi bản `live`**; và
  `NavRail` là `hidden lg:flex` **không có hamburger/drawer** → mất toàn bộ
  navigation dưới 1024px (tablet, panel HMI).

**Localization:** 60 chuỗi tiếng Việt thiếu dấu (Alarms 21, Scheduler 17, Alarm
Settings 14, Virtual Points 10, i18n 4); 13 chỗ hardcode `'vi-VN'` bỏ qua locale;
`StatusBadge.labelMap` 25 nhãn tiếng Anh cố định; 35 khóa i18n bản `vi` còn nguyên
tiếng Anh; thuật ngữ nội bộ lộ ra UI (`ADR-009`, `ADR-013`, `Phase 4`, "backend
hook", "field wired", `TSx 3`).

**Hiệu chỉnh 3 điểm trong brief** (ghi ở Phụ lục B để tránh sửa sai chỗ): lỗi
`&amp;` **không tồn tại** trong mã hiện tại; `"Nguoi dung"` thực tế **viết đủ dấu**;
và 44×44px là WCAG **SC 2.5.5 mức AAA**, không phải AA (AA là SC 2.5.8 = 24×24px).

**Ghi nhận điểm mạnh:** `NetworkPage` (giao dịch Stage→Apply→Confirm→Rollback + khóa
đường quản trị), `Modal.tsx` (focus trap + Escape + trả focus), `TimeSettingsPage`
(validate RFC3339 + xác nhận nêu hậu quả), `InputsPage` (i18n nghiệp vụ đầy đủ dấu),
`HelpPage` (song ngữ chuẩn).

**Kế hoạch cải tiến:** ma trận Impact/Effort với 8 Quick Wins, 8 Major Projects, 12
Fill-ins; lộ trình 4 sprint (3.5 → 9.0+). Mọi token màu đề xuất (theme tối 12 token,
6 màu badge, viền) **đã kiểm chứng bằng công thức relative luminance của WCAG** —
giá trị viền tối đầu tiên thử (`#3A4351`, 1.82:1) không đạt nên đã thay bằng
`#606C7E` (3.41:1) và kiểm lại.

Verification: `npx vitest --run --environment jsdom src` → **140 pass / 26 file**,
0 fail (không có thay đổi code nên không có hồi quy).

### Fixed — FE + BE + CI + packaging: đóng 14/14 finding còn lại của review 2026-07-30 (2026-07-30)

Phạm vi: `web/backend/` (Go), `src/frontend/` (TS/React), `.github/workflows/`,
`packaging/`, `tools/`. Cùng với entry FW SOM bên dưới, **toàn bộ 23 finding của
review đã được xử lý**.

**Mức Cao — chức năng**
- `F-01` `web/backend/auth.go` — `SetRole` nay có guard "last admin": hạ quyền
  admin cuối cùng trả `ErrLastAdmin` (HTTP 409). Trước đây chỉ `DeleteUser` có
  guard; một lần `PUT /api/v1/users/admin {"role":"viewer"}` làm hệ thống còn **0
  admin**, từ đó mọi endpoint `RoleAdmin` — kể cả chính endpoint dùng để phục hồi —
  trả 403 cho tất cả mọi người, chỉ sửa được bằng cách chỉnh tay `users.json` trên
  thiết bị. `ErrLastAdmin` đổi câu chữ từ "cannot delete last admin" thành
  **"cannot remove last admin"** vì giờ dùng cho cả hai đường.
- `F-02` **file mới `web/backend/shm_reader.go`** — reader seqlock cho SHM. Backend
  nay `mmap(PROT_READ, MAP_SHARED)` rồi áp đúng pattern mà `shared/mkddc_shm.h`
  bắt buộc: đọc `seq` (atomic) → bỏ nếu LẺ → copy → đọc lại `seq` → so sánh →
  kiểm `magic` → retry giới hạn 5 lần. Ba call site `os.ReadFile` trong
  `core_client.go` (`ReadPoints`, `readIOStatus`, `readPLCStatus`) đi qua
  `readIOShm()`/`readPLCShm()`; `os` không còn được import.
  `validSHM` giữ lại nhưng có comment rõ nó **không đủ** và không được dùng thay.
  Bổ sung thêm một lớp bảo vệ mà review không nêu: **so inode/device mỗi lần đọc**
  — khi `mkddc-core` restart nó `shm_unlink` + tạo lại segment, mmap cũ vẫn trỏ
  vào inode đã xoá và nội dung cũ VẪN có `magic` hợp lệ, nên không so inode thì
  backend sẽ đọc mãi dữ liệu đóng băng của một segment đã chết.
  `readIOStatus` thất bại nay trả `Status: "fault"` (fail-safe, khớp
  `KX_IOP_FAULT` phía HMI).

**Mức Cao — gate CI rỗng**
- `F-12` `.github/workflows/build-and-test.yml` — job `web-backend` thêm
  `go vet ./...` và `go test -race ./...`. Trước đó job chỉ có `go build`, nên
  toàn bộ test BE (auth, RBAC, historian, đường SHM) chưa bao giờ chạy trên CI.
- `F-13` job `web-frontend` thêm `npm run lint` và `npm test` **trước** bước
  build. Trước đó chỉ `npm run build`, nên 133 vitest test và
  `eslint --max-warnings=0` không chặn được regression hành vi nào.
- `F-15` `.github/workflows/security.yml` — CodeQL đổi từ `languages: python`
  (repo chỉ có 4 file `.py`) sang **matrix `c-cpp` × `go` × `javascript-typescript`**,
  `fail-fast: false` để một ngôn ngữ đỏ không che ngôn ngữ khác. `c-cpp` build
  tường minh bằng CMake (autobuild không biết cấu hình của dự án) với
  `*_BUILD_TESTS=OFF` — chỉ soi target production; `go` và
  `javascript-typescript` dùng autobuild.

**Mức Trung bình**
- `F-04` `src/frontend/src/auth/AuthProvider.tsx` — `logout()` gọi
  `POST /api/v1/auth/logout` với `Authorization: Bearer <token>` (capture token
  TRƯỚC khi xoá state), `keepalive: true` để request vẫn đi khi trang đóng ngay
  sau đó. Fire-and-forget có chủ đích: state local bị xoá ngay và một lần thu hồi
  thất bại không đảo ngược việc đã đăng xuất. Trước đây FE chỉ xoá state local nên
  JWT vừa dùng còn hợp lệ tới hết TTL 1 giờ và toàn bộ cơ chế `revoked` phía BE là
  code chết.
- `F-06` `web/backend/auth.go` — thêm `pruneRevokedLocked()` gọi trong `Revoke()`:
  quét và xoá mọi entry đã quá hạn. Map giờ bị chặn trên bởi số lần logout trong
  một TTL (1 giờ) thay vì tích luỹ vô hạn. Chọn quét tại chỗ thay vì goroutine
  prune riêng: map luôn nhỏ nên phép quét là O(kích thước thực tế) và không thêm
  một vòng đời goroutine phải quản lý.
- `F-07` `AuthProvider.tsx` — `role: body.role ?? 'admin'` → **`?? 'viewer'`** kèm
  `console.warn`. Response login thiếu field `role` (BE cũ, đổi hợp đồng, hoặc
  reverse proxy lọc field) trước đây cấp giao diện admin đầy đủ.
- `F-19` `packaging/rotate-web-jwt-secret.sh` — secret **không còn đi qua `/tmp`**:
  `openssl rand -hex 32 | sed 's/^/JWT_SECRET=/' | sudo install -m 0600 /dev/stdin`.
  Không có file trung gian nào tồn tại, nên vừa hết cửa sổ đọc lén theo umask
  (0644) vừa hết đường symlink attack qua đường dẫn cố định đoán được. Thêm
  `umask 077` cho mọi bước ghi file về sau. Secret cũng không còn đặt vào biến
  shell.

**Mức Thấp**
- `F-09` `src/frontend/src/hooks/useWebSocket.ts` — bọc `JSON.parse` trong
  `onmessage` bằng try/catch. Một frame không phải JSON trước đây throw ra ngoài
  event handler, không ai bắt, và mất cập nhật cho tới lần reconnect.
- `F-10` `useWebSocket.ts` + `web/backend/ws.go` — JWT **ra khỏi query string**,
  đi qua `Sec-WebSocket-Protocol`. Client gửi
  `["mkddc.v1", "mkddc.token.<jwt>"]`; server offer **đúng một** subprotocol
  `mkddc.v1` nên response chỉ echo phần tử đó và token không bao giờ xuất hiện
  trong header trả về. `requireWSAuth` lấy token theo thứ tự: subprotocol →
  `Authorization` header → query string. Query string được **giữ làm đường lỗi
  thời** (kèm log `WARN ws_token_in_query`) để một SPA còn trong cache browser sau
  khi nâng cấp thiết bị không mất kết nối; việc FE ngừng dùng nó đã đóng phần lộ
  thông tin của finding (lịch sử browser + access log của proxy).
- `F-11` `web/backend/ws.go` — `wsOriginPatterns` chỉ nối 6 pattern loopback khi
  `CORS_ORIGIN` **rỗng**. Trước đây luôn nối, nên một trang tại
  `http://localhost:<port>` vẫn qua được check Origin của WS dù đã cấu hình
  allowlist production — phá vỡ đúng ý định mà `isAllowedOrigin` thực thi cho HTTP.
  Semantics giờ khớp `isAllowedOrigin`: rỗng = dev, đã đặt = allowlist đóng.
- `F-20` `packaging/rotate-web-jwt-secret.sh` — `rollback()` chuyển lên **trước
  thay đổi đầu tiên** và gắn `trap 'rollback' EXIT INT TERM` (nhả trap khi đã xác
  nhận thành công). Rollback nay phục hồi **cả env file**, và nếu trước khi chạy
  không có env file thì xoá nó thay vì để lại secret mới trên đĩa. Trước đây
  `rollback()` được định nghĩa SAU khi unit đã bị `sed` sửa và `daemon-reload` đã
  chạy, không có trap, nên một thất bại trong khoảng đó thoát script mà không hoàn
  tác gì; và nó chưa bao giờ phục hồi env file, nên hệ thống "đã rollback" vẫn
  mang secret mới và mọi session đang hoạt động vẫn bị vô hiệu.
- `F-23` `src/frontend/vite.config.ts` — khai báo
  `test: { environment: 'jsdom', include: [...] }`. Trước đây `jsdom` chỉ tồn tại
  dưới dạng cờ dòng lệnh trong script `test`, nên `npx vitest run` (hay test runner
  của IDE, hay một bước CI viết tay) chạy trong môi trường `node` và fail 93/133
  với `ReferenceError: localStorage is not defined` — trông y như một suite đang đỏ.

**Test mới**
- Go **+13 test** (350 → 363 case kể cả subtest): `users_test.go` 3 test cho F-01;
  `auth_test.go` 1 test cho F-06; **file mới `shm_reader_test.go`** 6 test cho
  F-02; **file mới `ws_test.go`** 3 test cho F-10 + F-11.
- FE **+7 test** (133 → 140, 25 → 26 file): **file mới
  `src/auth/AuthProvider.test.tsx`** 5 test cho F-04 + F-07; `useWebSocket.test.tsx`
  2 test cho F-09 + F-10.
- Shell **file mới `tools/test_rotate_jwt_secret.sh`** — harness hermetic 17 assert
  cho F-19 + F-20, stub `sudo`/`systemctl`/`systemd-analyze`/`curl` vào PATH và
  chạy chính script production (chỉ đổi 2 đường dẫn sang thư mục tạm). 4 case:
  happy path, `systemd-analyze verify` fail *trước* restart, service không bao giờ
  ready, và không có env file ban đầu rồi thất bại.

**Verification — đo lại từ đầu trong phiên này, không dẫn số cũ**

| Gate | Baseline `7ea3ac5` | Sau khi sửa |
|------|--------------------|-------------|
| `go build ./...` | rc=0 | rc=0 |
| `go vet ./...` | rc=0, 0 finding | rc=0, 0 finding |
| `go test ./...` | PASS, 350 case | **PASS, 363 case** |
| `go test -race ./...` (như CI mới) | — | **PASS** (89,6 s) |
| `tsc --noEmit` | 0 lỗi | 0 lỗi |
| `npm test` | 133/133, 25 file | **140/140, 26 file** |
| `npx vitest run` (không qua npm script) | **fail 93/133** (`localStorage is not defined`) | **140/140 PASS** |
| `npm run lint` (`--max-warnings=0`) | 0 cảnh báo | 0 cảnh báo |
| `npm run build` | PASS | PASS |
| `tools/test_rotate_jwt_secret.sh` | *(chưa tồn tại)* — chạy trên script cũ: **11 PASS / 6 FAIL** | **17 PASS / 0 FAIL** |
| ctest C++ (HMI ON) — kiểm không hồi quy | 702/702 | **729/729 PASS** |
| YAML 2 workflow parse được | PASS | PASS |

- **Chứng minh test bắt được lỗi cũ** (hoàn nguyên tạm từng hành vi rồi chạy lại):
  Go — 4 test fail (`TestAuthRevokePrunesExpiredEntries`,
  `TestUsersDemoteLastAdminReturnsConflictAndKeepsAdminAccess`,
  `TestUsersDemoteAdminAllowedWhenAnotherAdminRemains`, 2 test `TestWSOriginPatterns*`);
  FE — 5 test fail (F-04, F-07, F-09, F-10 và test URL cũ); shell — 6 assert fail.
  Toàn bộ PASS trên code đã sửa.
- **Bằng chứng định lượng cho F-02** (`TestReadFileSnapshotCanTearProvingSeqlockIsRequired`
  so với `TestShmReadNeverObservesTornSnapshotUnderConcurrentWriter`, writer ghi 2
  field phải luôn bằng nhau, cửa sổ ghi nới rộng, chạy 2 s mỗi bên):
  đường cũ `os.ReadFile + validSHM` thấy **55.132/78.009 (71%) snapshot BỊ XÉ vẫn
  qua được check magic**; reader seqlock mới **0/4.316 bị xé**. Đây là lỗi thật, đo
  được, không phải suy đoán lý thuyết.
- **Kiểm chứng F-19 độc lập**: `install -m 0600 /dev/stdin` dưới `umask 022` cho ra
  file quyền **600** — đúng điều bản cũ không bảo đảm được trong cửa sổ giữa
  redirect và `install`.

**Ghi chú kỹ thuật**
- `go test -race` **không** chứng minh được tính đúng đắn của seqlock: writer
  trong test ghi qua một mmap riêng, nên race detector không thấy được aliasing
  (và trong production writer là một *tiến trình* khác, hoàn toàn ngoài tầm của
  nó). Bằng chứng là test bất biến "hai field luôn bằng nhau" ở trên.
- `CoreClient` nay chứa `sync.Mutex` (trong `shmSegment`) nên không copy được theo
  giá trị; `go vet` (copylocks) sạch, mọi call site đều dùng con trỏ. Thêm
  `(*CoreClient).Close()` để nhả mmap.

**Chưa làm — cần quyết định của bạn**
- `continue-on-error: true` trên bước `analyze` của CodeQL **vẫn được giữ**. Review
  đúng khi nói nó làm gate không chặn được PR, nhưng bước upload Code Scanning đòi
  **GitHub Advanced Security**; trên repo chưa bật GHAS, bỏ cờ này làm job đỏ vì lý
  do hạ tầng chứ không phải vì code có finding. Bỏ cờ là quyết định org/billing —
  cần bạn xác nhận GHAS đã bật.
- Bước "Generate Python pip SBOM" trong `security.yml` giữ nguyên (review nêu nó
  như *bằng chứng* workflow kế thừa khuôn mẫu Python, không phải finding riêng).
  Nếu muốn SBOM đúng cho dự án thì cần thêm nhánh Go module + npm lockfile — đề
  xuất làm trong một thay đổi riêng.
- Chỉ chạy trên x86-64 Linux / GCC 13 / Go 1.26.4 / Node 22; **chưa** chạy lại trên
  aarch64 (Orange Pi 5B).

### Fixed — FW SOM: đóng 8/9 finding của review 2026-07-30 (WP1→WP4) (2026-07-30)

Phạm vi: `services/hmi`, `services/iobus`, `services/netcfg`, `shared/mkddc_shm.h`,
`.github/workflows/build-and-test.yml`. Không đổi hành vi ngoài phạm vi 9 finding.
Không đổi hợp đồng binary: `kx_ext_point_t`, `kx_io_shm_t`, `kx_plc_shm_t`,
`KX_SHM_MAGIC`, `KX_N_EXT` giữ nguyên.

**WP1 (P0) — `F-03` annunciation an toàn của HMI + `F-14` đưa HMI vào gate CI**
- `F-03` `services/hmi/data/shm_reader.{hpp,cpp}` + `main.cpp`: `read_all()` đổi
  từ `bool` sang `ReadStatus{io_ok, plc_ok}` — trả trạng thái cho **cả hai** vùng
  (trước đây bỏ hẳn giá trị trả về của `seqlock_read_plc`), và `main.cpp` **dùng**
  giá trị đó. `read_all()` reset fail-safe `io_valid`/`plc_valid`/`iop_status`/
  `fault_flags` **trước** khi đọc, nên một lần đọc trượt không thể để
  `iop_status=NORMAL` của chu kỳ trước tiếp tục lái banner sự cố và alarm E001.
  Các field *giá trị* (`ui_value`/`ai`/`ext`/`ts_ns`) **không** bị reset — chúng đã
  được `age_ns` bảo vệ ở `screen_io.cpp`, xoá chúng chỉ làm màn hình nháy khi
  trượt đúng một chu kỳ đọc.
- Quyết định annunciation tách thành hai hàm thuần `hmi::io_fault_active()` /
  `hmi::mcu_fault_active()` (`shm_reader.hpp`) làm **nguồn chân lý duy nhất** cho
  banner + E001 + E002, nên test chốt được đúng biểu thức `main.cpp` dùng thay vì
  copy lại nó. `fault_banner.update()` giờ dùng cùng quyết định với E001 → banner
  và alarm không thể lệch nhau. E002 chỉ có nghĩa khi `io_ok` — không kích alarm
  MCU bằng `fault_flags` của chu kỳ trước, cũng không bịa cờ lỗi.
- `F-14` `.github/workflows/build-and-test.yml`: thêm leg matrix
  **`modbus+bacnet+hmi`** với `-DMKDDC_ENABLE_HMI=ON` (thêm `hmi:` vào cả 4 leg
  cũ ở giá trị `OFF`) + phụ thuộc `libdrm-dev libfreetype-dev pkg-config`. Trước
  đó `mkddc-hmi` và 28 test của nó **chưa bao giờ** được CI biên dịch — đó là lý
  do `F-03` tồn tại mà không gate nào bắt được.

**WP2 (P1) — cụm ext index + device profile Modbus, sửa một lần**
- `F-17` `services/iobus/fieldbus/device_profile.{hpp,cpp}`: thêm **hàm thuần**
  `point_type_is_32bit()`, `ext_slots_for_point()`, `ext_slots_for_profile()` làm
  nguồn chân lý duy nhất cho luật cấp phát slot ext. `modbus_master.cpp` (3 chỗ)
  và `modbus_tcp.cpp` (2 chỗ) đều gọi chúng; luật "32-bit tiêu 2 register" giờ chỉ
  còn tồn tại ở **một** chỗ trong codebase. Slot đếm theo **điểm luận lý**: FC
  1/2 → `count`; FC 3/4 16-bit → `count`; FC 3/4 32-bit → `count/2`; **FC ghi
  (5/6/15/16) → 0** (vòng đọc bỏ qua FC ghi nên đặt trước slot cho chúng chỉ sinh
  slot rỗng). Trước đây `open()` đếm `pts += pp.count` (số register) → profile
  32-bit đặt trước gấp đôi số slot cần, mất nửa dung lượng 64 slot và đẩy điểm
  rỗng (`name=""`, `quality=BAD`) vào `push_snapshot`.
- `F-16` `modbus_master.cpp`: bỏ `break` im lặng khi tràn `KX_N_EXT`. Mỗi slave
  được xử lý **dứt điểm** bằng `continue` (slave sau vẫn được xét, một slave nhỏ
  vẫn có thể vừa chỗ còn lại). Slave thiếu profile / không có điểm đọc / hết ext
  slot bị đánh cờ `slave_config_error_` → log `ERROR` nêu rõ tên slave, addr, số
  slot cần vs còn lại; `read_slave()` đi đường `on_poll_error` + `metrics.update
  (ok=false)` + `mark_slave_offline` + alarm **E302**, nên **không bao giờ báo
  online**. Trước đây các slave này có `slave_states_` nhưng `profiles_[i].points`
  rỗng → `slave_ok` giữ `true` → ONLINE, error rate 0%, không alarm, không log.
  Đường lỗi tự set `last_poll_ms` để tôn trọng `poll_interval` (không có I/O nào
  để chặn nên nếu thiếu, vòng fieldbus sẽ spin ở mức 1 ms).
- `F-08` `modbus_tcp.cpp`: bỏ clamp im lặng `if (idx > KX_N_EXT) idx = KX_N_EXT;`.
  Conn hết slot / thiếu profile được đánh `config_error` → log `ERROR`,
  `ext_count = 0`, **không mở kết nối** và bị `poll_once()` bỏ qua, nên không bao
  giờ đi qua `on_poll_ok`. Trước đây mọi TCP slave nhận `ext_base = 64`,
  `read_conn` thoát ở point đầu với `slave_ok` vẫn `true` → báo online và khỏe
  mạnh mà không publish nổi một điểm nào.
- `F-18` `device_profile.cpp`: **hiện thực** validation mà `device_profile.hpp`
  đã hứa từ trước nhưng chưa có — type 32-bit trên FC 3/4 mà `count` không phải
  **bội số của 2** → skip point + log `ERROR profile.odd_count_for_32bit`. Chốt
  "bội số của 2" (không phải đúng bằng 2) để giữ khả năng đọc block nhiều điểm
  32-bit liên tiếp mà cả hai vòng đọc đã hỗ trợ; tài liệu đã cập nhật cho khớp.
  `modbus_master.cpp` xử lý register 32-bit ở biên lẻ **giống `modbus_tcp.cpp`**
  (log + bỏ điểm) thay vì truyền `count=1` cho `decode_register` → trước đây
  publish `0*scale + offset` với **`KX_Q_GOOD`**, tức một giá trị bịa mang nhãn
  dữ liệu tốt. Cả hai transport giờ **không** tiêu ext slot cho register lẻ đó
  (khớp phép làm tròn xuống của `ext_slots_for_point`) nên không sinh slot rỗng.
- `F-21` `device_profile.cpp`: viết thẳng `pt->count > 2000` thay cho
  `count * static_cast<int>(count > 0) > 2000` — nhân tử thứ hai là bool luôn
  bằng 1 nên biểu thức cũ đúng do tình cờ. Ý định giữ nguyên (2000 =
  `MODBUS_MAX_READ_BITS`, khớp buffer `bits[2000]`), có test chốt cả biên 2000/2001.

**WP3 (P2) — `F-05` UART hangup**
- `services/iobus/iop/iop_client.cpp`: `wait_response()` xử lý
  `POLLHUP`/`POLLERR`/`POLLNVAL` (kernel báo bất kể `events` yêu cầu gì) và thoát
  ngay với `NOT_OPEN` → đường reconnect; thêm xử lý `poll()` trả `< 0`
  (`EINTR` → retry, còn lại → `NOT_OPEN`). Kiểm `POLLIN` **trước** để dữ liệu còn
  tồn đọng được xả hết mới kết luận hangup.
- `services/iobus/iop/iop_port.{hpp,cpp}`: thêm `IopPort::READ_EOF = -2` phân biệt
  EOF với "chưa có dữ liệu". **Đính chính so với mô tả trong review**: trên tty
  raw `VMIN=0/VTIME=0`, `::read()` trả `0` **cả** khi buffer rỗng **lẫn** khi peer
  đóng — nó không trả `-1/EAGAIN` khi rỗng, nên không thể phân biệt chỉ bằng giá
  trị trả về. Tín hiệu duy nhất là `poll()`: khi `::read()` trả 0 (buffer đã cạn),
  `read()` probe bằng `poll(timeout=0)` và chỉ trả `READ_EOF` khi có
  `POLLHUP|POLLERR|POLLNVAL`.
- Semantics có chủ đích ở `transact()` **giữ nguyên**: EAGAIN kéo dài khi *ghi*
  vẫn đi qua TIMEOUT → retry → FAULT → RECONNECT, không đổi thành `NOT_OPEN`.

**WP4 (P3) — `F-22` `netcfg::LinuxPlatform::run`**
- `services/netcfg/netcfg.cpp`: **đọc cạn pipe** rồi mới bỏ phần vượt 4096 byte.
  Vòng cũ `break` ngay khi đạt giới hạn rồi `close(pipes[0])` → child đang ghi
  nhận `SIGPIPE` → `WIFEXITED` false → `run()` trả `false` cho một lệnh thực chất
  exit 0, tạo tín hiệu "apply thất bại" giả trong service có rollback fail-closed.

**WP5 — `F-02`: phần việc của FW (lỗi thuộc BE)**
- `shared/mkddc_shm.h`: bổ sung khối **HỢP ĐỒNG READER — BẮT BUỘC** nói rõ
  `read()`/`pread()`/`os.ReadFile()` là **KHÔNG HỢP LỆ** dù có kiểm `magic` và độ
  dài (writer không chạm `magic` trong lúc ghi nên check đó luôn pass), kèm trình
  tự seqlock bắt buộc, hai hiện thực C++ làm hình mẫu, yêu cầu retry có giới hạn,
  yêu cầu caller xử lý fail-safe khi retry hết lượt (dẫn `F-03`), và đường an toàn
  sẵn có `ReadPointSnapshot` qua core. Đây chính là cái bẫy BE đã bước vào. Việc
  sửa `web/backend/core_client.go` **thuộc team BE**, chưa làm ở đây.

**Tài liệu cập nhật cho khớp hiện thực**
- `services/iobus/fieldbus/device_profile.hpp` — hợp đồng validate nêu chính xác
  "32-bit trên FC 3/4 cần `count` là bội số của 2" + đặc tả 3 hàm đếm slot.
- `docs/02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md` — thêm §10.3.1
  "Cấp phát ext slot — một slot = một ĐIỂM LUẬN LÝ": bảng slot theo FC/type, nguồn
  chân lý duy nhất, và quy tắc fail-closed khi tràn dải.
- `docs/03_implementation/26_MODBUS_IMPLEMENTATION_PLAN.md` — thay bullet
  "`type` không khớp `count`" bằng luật chính xác đã hiện thực.

**Verification — đo lại từ đầu trong phiên này, không dẫn số cũ**

| Gate | Baseline `7ea3ac5` | Sau khi sửa |
|------|--------------------|-------------|
| ctest Release, MODBUS+BACNET+**HMI=ON** | 702/702 PASS | **729/729 PASS** (+27 test mới) |
| ctest Release, MODBUS+BACNET, HMI=OFF | 674/674 PASS | **696/696 PASS** (+22) |
| ASan Debug (MODBUS+HMI=ON), `detect_leaks=1` | — | **728/728 PASS**, rc=0, sạch |
| UBSan Debug (MODBUS+HMI=ON), `-fno-sanitize-recover` | — | **728/728 PASS**, rc=0, sạch |
| Cấu hình đúng như leg CI mới (`RelWithDebInfo`, `-Wall -Wextra -Werror`, BACNET+MODBUS+HMI=ON) | — | build rc=0, **729/729 PASS** |
| Cảnh báo build | 2 (test-only) | **2**, đúng cùng nguồn `test_output_command.cpp:34`; **0 cảnh báo mới** |

- **Chứng minh test bắt được lỗi cũ** (hoàn nguyên tạm từng hành vi rồi chạy lại):
  3 test fail cho `F-03`; 7 test fail cho `F-17`/`F-16`/`F-08`/`F-18`; 2 test fail
  cho `F-05`; 1 test fail cho `F-22`. Toàn bộ PASS trên code đã sửa.
- **Tái hiện thủ công `F-03`** trên SHM **thật** (`/dev/shm/mkddc_io_shm` do
  `mkddc-iobus` tạo, qua đúng đường `ShmReader::attach()` + `io_fault_active()`,
  một tiến trình duy nhất tái dùng `DataCache` xuyên qua thời điểm sự cố): giết
  `mkddc-iobus` rồi xoá `magic` (mô phỏng cửa sổ restart) — **code cũ**:
  `io_ok=0` nhưng `io_valid=1`, `iop_status=0` → `io_fault=false`, banner **xanh**,
  E001 **im lặng** ở cả 4 chu kỳ sau sự cố; **code đã sửa**: `io_valid=0`,
  `iop_status=1` → `io_fault=TRUE`, banner **đỏ**, E001 **kích** ngay chu kỳ đầu.
- **Tái hiện thủ công `F-05`** (peer PTY đóng sau khi request đã được ghi, đo
  CPU-time so với wall-time của một lần `get_io`, `response_timeout_ms=500`):
  **code cũ** `wall=500 ms, cpu=500 ms → 100% busy-spin` rồi trả `TIMEOUT`;
  **code đã sửa** `wall=0,1 ms, cpu≈0 ms` và trả `NOT_OPEN` + log
  `iop.port_eof`. Lặp 3 lần, kết quả nhất quán.

**Đính chính đối với báo cáo review (nêu rõ theo yêu cầu mục 5 của fix request)**
- `F-05` — **mức độ bị đánh giá cao hơn thực tế**. Báo cáo nói spin "lặp lại ở
  **mỗi** chu kỳ poll 10 ms → chiếm một core suốt trạng thái RECONNECT". Đo ở mức
  tiến trình (`mkddc-iobus` thật + PTY + `fake_mcu`, giết peer, lấy delta
  `utime+stime` từ `/proc/<pid>/stat`) cho thấy **không có** CPU tăng cao kéo dài:
  ~8–10 tick/4 s sau hangup, tương đương lúc link còn sống. Nguyên nhân: sau
  hangup, `::write()` trên tty trả `EIO`, nên `transact()` trả `NOT_OPEN` **ngay
  tại đường ghi** trước khi vào `wait_response`, và đường reconnect có backoff.
  Busy-spin 100% một core **là thật** nhưng **bị chặn trên bởi đúng một deadline
  của một transaction**, và chỉ xảy ra trong cửa sổ hẹp khi peer chết *sau* một
  lần ghi thành công *trước* khi có response. Bản sửa vẫn đúng và cần thiết (phát
  hiện hangup tức thì thay vì `TIMEOUT` sai + một deadline spin), nhưng xếp hạng
  "cạnh tranh CPU liên tục với scan loop `SCHED_FIFO`" không tái hiện được.
- `F-05` — **cách sửa như mô tả không đủ**. Đề xuất "`IopPort::read` trả một mã
  riêng cho EOF" ngầm giả định `::read()` trả `-1/EAGAIN` khi rỗng. Đo thực tế
  trên PTY Linux với tty raw `VMIN=0/VTIME=0`: rỗng → `read()==0, errno=0`; peer
  đóng → cũng `read()==0`; và `poll()` báo `revents=0x19`
  (`POLLIN|POLLHUP|POLLERR`). Nên phải dùng `poll()` để phân biệt, không thể dựa
  vào giá trị trả về của `read()`. Đây cũng là lý do lỗi cũ *có* vào nhánh
  `POLLIN` (POLLIN được set kèm POLLHUP) rồi spin, chứ không phải "không gọi
  `read` nên không bao giờ thấy lỗi" như báo cáo viết.
- `F-16` — **phạm vi rộng hơn mô tả**. Ngoài tràn `KX_N_EXT`, hai đường khác dẫn
  tới **cùng** tình trạng "profile rỗng nhưng vẫn báo ONLINE": slave không tìm
  thấy profile (`profile_not_found`), và profile load được nhưng không còn điểm
  đọc nào sau validate. Cả ba đều được xử lý bằng cùng cờ `slave_config_error_`.
- `F-17` — **`open()` còn đặt trước slot cho FC ghi**. Ngoài lỗi đếm theo
  register, `pts += pp.count` cộng cả point FC 5/6/15/16 mà vòng đọc bỏ qua hoàn
  toàn. `ext_slots_for_point()` trả 0 cho chúng.

**Ngoài phạm vi — phát hiện thêm, ghi lại và KHÔNG sửa (theo yêu cầu mục 1)**
- Đường suy ra write-FC trong `ModbusMaster::drain_ext_writes` (`pt.fc == 1` →
  FC05, `pt.fc == 3` → FC06/16) là **code chết** với validator hiện tại:
  `parse_point()` loại bỏ mọi point có `writable=true` mà `fc` không thuộc
  {5,6,15,16}, nên `pt.writable` không bao giờ `true` cho một read FC. Nghĩa là
  ext point hiện **không thể** ghi xuống slave qua đường `dirty`. Đây là mâu thuẫn
  giữa validator và write bridge COR-011, không thuộc 9 finding nên không sửa —
  cần một quyết định thiết kế (cho phép `writable` trên read FC, hay khai báo
  point ghi riêng và ánh xạ) và áp gate DOC TRƯỚC CODE SAU.

**Chưa làm**
- `F-02` phần sửa `web/backend/core_client.go` — thuộc team BE.
- Các finding FE/BE/CI/packaging khác (`F-01`, `F-04`, `F-06`, `F-07`, `F-09`…
  `F-13`, `F-15`, `F-19`, `F-20`, `F-23`) không thuộc phạm vi văn bản này.
- Chỉ chạy trên x86-64 Linux/GCC 13; **chưa** chạy lại trên aarch64 (Orange Pi 5B).

### Added — Yêu cầu fix & debug cho team FW SOM (2026-07-30)
- `docs/07_records/reviews/KX-DDC24-FW-SOM-FIX-REQUEST-2026-07-30.md` — trích **9/23 finding thuộc FW SOM** từ báo cáo review cùng ngày, kèm prompt bàn giao tự chứa cho team FW: cơ chế lỗi, cách tái hiện/debug, tiêu chí hoàn thành và test cần thêm cho từng finding.
- Phân loại: `F-03` + `F-14` (hmi + gate build) — **WP1/P0**; `F-17` + `F-16` + `F-08` + `F-18` + `F-21` (cụm ext index + device profile Modbus, một nguyên nhân gốc) — **WP2/P1**; `F-05` (POLLHUP + EOF/EAGAIN của IOP) — **WP3/P2**; `F-22` (`netcfg::run` cắt output) — **WP4/P3**; `F-02` — **WP5**, lỗi thuộc BE nhưng hợp đồng `shared/mkddc_shm.h` thuộc FW nên FW review + làm rõ tài liệu.
- Ghi nhận: **`services/core` không có finding nào**; 6/9 finding tập trung ở `services/iobus/fieldbus`. Nguyên nhân gốc của WP2 là luật "32-bit tiêu 2 register" đang được viết lại **4 lần** ở 4 chỗ (`modbus_master.cpp:87-89,187-188,272-273`; `modbus_tcp.cpp:57-58,203`) nên chúng lệch nhau → yêu cầu tách thành một hàm thuần duy nhất, test được mà không cần libmodbus.
- Baseline verification bàn giao kèm (đo tại `7ea3ac5`, team FW không được để tụt): ctest **702/702** với `MKDDC_ENABLE_MODBUS=ON MKDDC_ENABLE_BACNET=ON MKDDC_ENABLE_HMI=ON` (674/674 khi HMI OFF); bắt buộc chạy ASan + UBSan cho WP2/WP3; 2 cảnh báo `-Wstringop-overflow` từ `test_output_command.cpp:34` là false positive GCC 13 đã hạ mức có chủ ý — không sửa.

### Added — Báo cáo review code FE + BE + FW SOM (2026-07-30, Rev 2 — hoàn chỉnh)
- `docs/07_records/reviews/KX-DDC24-CODE-REVIEW-FE-BE-FWSOM-2026-07-30.md` — review tình trạng + **23 finding** trên `src/frontend`, `web/backend`, `services/{core,iobus,hmi,netcfg}`, `packaging/`, `tools/`, `.github/workflows/` tại mốc `7ea3ac5` (cây source giống hệt `7a5b72a`, chỉ khác `CHANGELOG.md`).
- Rev 2 đóng toàn bộ giới hạn của Rev 1: đã build lại C++ và chạy lại mọi gate, đã review `services/netcfg` + `packaging/` + `tools/` + workflow CI, đã soi đường ext index của Modbus **RTU**.
- Finding mức Cao — chức năng: `F-01` `SetRole` thiếu guard "last admin" → mất quyền admin vĩnh viễn (`web/backend/auth.go:174`); `F-02` BE đọc SHM bằng `os.ReadFile` không theo pattern seqlock mà `shared/mkddc_shm.h` bắt buộc → snapshot xé lọt vào WS monitor và historian (`web/backend/core_client.go:137`); `F-03` HMI tái dùng `DataCache` và bỏ giá trị trả về của `read_all` → banner sự cố + alarm E001/E002 chạy trên dữ liệu cũ khi iobus restart (`services/hmi/main.cpp:186`).
- Finding mức Cao — **gate CI rỗng** (mới ở Rev 2): `F-12` job Go chỉ `go build`, **không chạy `go test`** (`build-and-test.yml:134`); `F-13` job FE chỉ `npm run build`, **không chạy `npm test` cũng không lint** → 133 vitest test không chặn được gì (`build-and-test.yml:158`); `F-14` **không leg matrix nào bật `MKDDC_ENABLE_HMI`** → `mkddc-hmi` và 28 test của nó chưa bao giờ được CI biên dịch (`services/CMakeLists.txt:47`), và F-03 nằm đúng trong service đó.
- Finding mức Trung bình: `F-04` FE không gọi `POST /api/v1/auth/logout` nên đường thu hồi token của BE là code chết; `F-05` `wait_response` không xử lý `POLLHUP`/`POLLERR` + `IopPort::read` không phân biệt EOF với EAGAIN → spin chiếm CPU và không phát hiện được UART hangup; `F-16` Modbus RTU `break` khi tràn `KX_N_EXT` khiến slave còn lại bị loại khỏi poll nhưng vẫn báo ONLINE 0% lỗi (`modbus_master.cpp:91`); `F-17` cả RTU và TCP đếm slot ext theo **register** thay vì **điểm luận lý** → điểm 32-bit đặt trước gấp đôi, giảm nửa dung lượng `KX_N_EXT` và đẩy điểm rác chất lượng BAD vào snapshot; `F-18` validation "32-bit ⇒ count=2" mà `device_profile.hpp:50` hứa **chưa được hiện thực** → RTU publish giá trị bịa `0*scale+offset` với `KX_Q_GOOD`; `F-19` `rotate-web-jwt-secret.sh:14` ghi secret JWT ra `/tmp` đường dẫn cố định theo umask mặc định trước khi `install -m 0600` (đọc lén + symlink attack); `F-06` map `revoked` phình vô hạn; `F-07` role FE mặc định fail-open thành `admin`; `F-08` Modbus TCP báo slave online khi ext index tràn dải; `F-15` CodeQL phân tích `languages: python` trên repo C++/Go/TS (chỉ 4 file `.py`) + `continue-on-error` → gate rỗng, cùng bản chất với A-03.
- Finding mức Thấp: `F-09` `JSON.parse` trong `onmessage` không bọc try/catch; `F-10` JWT nằm trong query string của URL WebSocket; `F-11` `wsOriginPatterns` luôn nối pattern localhost; `F-20` `rollback()` của script rotate JWT định nghĩa sau thay đổi đầu tiên, không có `trap`, và không phục hồi env file đã sao lưu; `F-21` biểu thức giới hạn block coil `count * (count > 0) > 2000` đúng do tình cờ (`device_profile.cpp:168`); `F-22` `netcfg::run` biến output bị cắt ở 4096 byte thành "lệnh thất bại" qua `SIGPIPE`; `F-23` môi trường jsdom của FE chỉ do flag npm script cấp, không có trong `vite.config.ts` → gọi `vitest` trực tiếp fail 93/133 giả.
- Đã đối chiếu và **xác nhận đúng** (không phải finding): toàn bộ offset SHM trong `core_client.go` khớp từng byte với `shared/mkddc_shm.h` kể cả padding; `FrameParser::feed` chống overflow; `PointTable::valid` + `parse_point_name` chặn OOB trên đường web IPC; tham số `channel` của PULSE_COUNTER được validate ở loader; `io_scaling` và PID chặn chia 0; `ExtCache` clamp theo `KX_N_EXT`; `writeConfigFileAtomic` có fsync file + directory; `decode_register`/`encode_register` chặn mọi nhánh 32-bit bằng `count < 2` nên profile sai không gây OOB; `regs[125]`/`bits[2000]` khớp đúng giới hạn libmodbus và có loader chặn trước; **`netcfg` không có command injection** (`execv` + argv vector + đường dẫn tuyệt đối qua `access(X_OK)`, không qua shell); `drain_ext_writes` của Modbus RTU tuân thủ seqlock đúng; `packaging/install.sh` đặt quyền có chủ đích và hợp lý.
- **Đính chính số liệu**: câu "build 0 lỗi 0 cảnh báo" ở entry 2026-07-29 chưa chính xác — còn 2 cảnh báo `-Wstringop-overflow` từ `services/iobus/tests/test_output_command.cpp:34`, là false positive đã biết của GCC 13 và đã được hạ mức có chủ ý **chỉ** cho target test (`core/CMakeLists.txt:80`, `iobus/CMakeLists.txt:143`); target production giữ nguyên `-Werror`. Câu chữ đúng phải là "0 error, 2 cảnh báo test-only đã biết".
- **Đính chính ghi nhận nội bộ**: ghi nhận "CodeQL đã sửa `python` → `cpp` tại commit `2869a19`" là **sai** — commit đó không tồn tại trong repo và `security.yml:124` vẫn đang là `python` (xem `F-15`).
- verification (đo lại độc lập từ đầu tại `7ea3ac5`, **không** lấy lại số cũ): C++ Release với `MKDDC_ENABLE_BACNET=ON MKDDC_ENABLE_MODBUS=ON` build rc=0 và **ctest 674/674 PASS** (9,90 s) — xác nhận độc lập con số kế thừa; thêm `-DMKDDC_ENABLE_HMI=ON` cho **702/702 PASS**; `go build ./...` PASS + `go vet ./...` PASS 0 finding + **`go test ./...` PASS** (`ok mkddc-web 16.672s`); FE `tsc --noEmit` PASS 0 lỗi + **`npm test` 133/133 PASS** (25 file) + `npm run lint` (`eslint --max-warnings=0`) PASS 0 cảnh báo. Chỉ chạy trên x86-64 Linux/GCC 13, chưa chạy lại trên aarch64.

### Removed — Hoàn tác PR #74 khỏi repo công ty (2026-07-29)
- phạm vi/repository: hoàn tác toàn bộ baseline tái cấu trúc đã được merge nhầm vào `Mekong-HCM/MK-DDC-24:main`; không bổ sung tính năng hay thay đổi hành vi ngoài phạm vi PR #74.
- luồng phát triển: giữ công việc tái cấu trúc trên fork cá nhân `haizzdungnay/DDC24` và dùng PR riêng khi cần đề xuất thay đổi cho repo công ty.
- verification: `git diff --check` đạt; nội dung ngoài mục changelog này được đối chiếu với parent chính của merge PR #74 (`7a5b72a`).

### Added — Bộ hồ sơ bàn giao auditor + báo cáo hiện trạng toàn dự án (2026-07-29)
- Tạo `audit-handover-2026-07-29/` — **chỉ giữ cục bộ, đã thêm `/audit-handover-*/` vào `.gitignore`** vì toàn bộ nội dung là bản sao của `docs/` đã có trong repo; đẩy lên GitHub sẽ trùng lặp. Bản sao chụp 261 file tài liệu chốt tại commit `7a5b72a` trên `main`, chia 13 nhóm: spec sản phẩm, kiến trúc + 21 ADR, phần cứng (50 file), FW MCU, FW SOM, phần mềm SOM, Web BE/FE, interface/protocol, verification + evidence gốc, vận hành/deploy, governance/traceability, kế hoạch triển khai.
- `00_BAO_CAO/BAO_CAO_HIEN_TRANG_VA_NEXT_ACTION.md` — báo cáo hiện trạng viết theo **source code thực tế**, không copy checklist tài liệu. Kèm 4 finding mới: `A-01` FW MCU chưa hiện thực (16 dòng skeleton ↔ 11 tài liệu thiết kế), `A-02` không có file thiết kế phần cứng máy đọc được (0 KiCad/gerber; `PWR_DESIGN` và `MFG_DATA_PACKAGE` tự đánh dấu BLOCKED), `A-03` job CI "MCU Firmware" tạo tín hiệu xanh sai lệch vì chỉ biên dịch skeleton, `A-04` ba workstream C0.2/C0.10/C0.11 có mã mà chưa có SPEC.
- Cập nhật `B-07` từ CHẶN thành **đóng một phần**: Phase 7 (commit `5110492`, sau mốc review Rev 2.0 tại `5c39c61`) đã có ASan/UBSan + 2 fuzz harness > 8,2 triệu lần chạy; còn soak 24 h, TSan cho `mkddc-iobus`, fuzz nightly dài.
- `00_BAO_CAO/SOURCE_INVENTORY.md` — inventory mã nguồn theo module/file/trách nhiệm; `00_BAO_CAO/MANIFEST.sha256` — checksum 260 file để auditor kiểm toàn vẹn.
- Next action xếp theo đường găng thật: P0 gồm kernel `RT_GROUP_SCHED=n` (`F-13`), đo lại WCET/jitter, **khởi động hiện thực FW MCU** và **sinh schematic/PCB/BOM** — hai hạng mục cuối là đường găng dài nhất còn lại của dự án.
- **Verification đo lại từ đầu tại `7a5b72a`** (không lấy lại số cũ): C++ `-Wall -Wextra -Werror` với `MKDDC_ENABLE_BACNET=ON MKDDC_ENABLE_MODBUS=ON` build 0 lỗi 0 cảnh báo và **ctest 674/674 PASS** (core 467 + iobus 165 + netcfg 42); cấu hình mặc định 671/671; `go build ./...` + `go test ./...` **0 FAIL**; FE `tsc --noEmit` sạch + vitest **133/133**; `nm -C mkddc-core` **0 symbol** compiler ST.

### Fixed — CI dependency and scoped Grype exception (2026-07-28)
- build-and-test: cài `libsodium-dev` trong toàn bộ C++ matrix để các cấu hình dùng ST package integrity configure được nhất quán với sanitizer job.
- security: thêm `.grype.yaml` chỉ bỏ qua `GHSA-qwww-vcr4-c8h2` cho `react-router@7.18.1` vì advisory chỉ ảnh hưởng unstable RSC APIs không được FE SPA sử dụng; mọi finding High khác vẫn fail CI.
- verification: local FE test/lint/build pass; Grype v0.110.0 tái hiện và suppress đúng một advisory trên package/version nêu trên.

### Fixed — Network no-carrier Apply and offline rollback verification (2026-07-28)
- frontend/network: hiển thị `NO_CARRIER`, khóa riêng `Apply` khi interface chưa `adminUp+carrier`, giữ Validate/Stage và tách ACTIVE/CONFIGURED/PENDING/EDITABLE DRAFT theo authority.
- netcfg/rollback: luôn xác minh interface + configured profile kể cả DNS; snapshot runtime vốn offline/no-IP không bị ép khớp kernel state giả, còn snapshot healthy vẫn verify nghiêm ngặt và luôn gỡ candidate address.

### Changed — Network authority v1 hardening and stable-host recovery (2026-07-28)
- network/protocol: hoàn tất contract v1 strict cho DNS `auto|manual`, static/DHCP, active/configured/pending, exact capabilities `dns` + `management-hostname`, management hostname read-only, journal/restart/rollback và carrier/admin health riêng.
- web/backend: GET transaction cho mọi session xác thực, POST mutation Admin-only; adapter strict/bounded, preflight DNS capability, reject response sai contract và audit mỗi POST mà không log candidate/DNS/token.
- frontend: production `.env.production` chạy live/JWT; REST/WebSocket cùng-origin, tự retry/reconnect qua hostname hiện tại, reconcile outcome không xác định và không hardcode IP. Network UI hỗ trợ DNS preserve/auto/manual và fail-closed khi authority stale.
- deployment/docs: thêm Avahi `_http._tcp`, `configure-web-hostname.sh --check|--apply`, package wiring, ADR-017, OpenAPI/schema, HMI/Web guides, checklist/traceability và runbook Network-only Rev 1.10 có backup/rollback/evidence Windows + Orange Pi.
- verification trước PR: C++ Network CTest **42/42**, FE NetworkPage **16/16** cùng typecheck/lint/production build, Go network/full suite, schema/OpenAPI và shell syntax đều pass; clean-branch gates được chạy lại trước commit.
- target: deploy helper ARM64 SHA-256 `8667127633e3a274347d98ca66e2a9a1e7cda5c78e85428e0d2fc718e5e3d7aa` và FE bundle `8cffbf024347621aa02e9be54f61161d363fb5ce3f2d30c643622c3380465aab`; `orangepi5b.local:8081`, `mkddc-netcfg`, `mkddc-web-pi` và Avahi hoạt động. Chưa claim physical Ethernet/IP-handoff HIL.

### Changed — Temporary dummy0 Network transaction test completed (2026-07-28)
- target/test: static transaction trên `dummy0` và truy cập Web bằng hostname từ Windows pass; teardown xác nhận authority về `end1`, state `idle`, `dummy0` đã xóa và management vẫn qua `wlan0=192.168.1.18/24`.
- workstation cleanup: hai route `/32` tạm `10.77.0.10`/`10.77.0.20` qua `192.168.1.18` cần PowerShell Administrator để xóa nếu còn tồn tại; runbook ghi exact command, không coi route Windows là cấu hình Orange Pi.
### Added — Phase 7: ASan, UBSan, fuzzing và mở rộng fake MCU (2026-07-28)
- **ASan tìm ra một lỗi thật: heap-use-after-free** trong `test_alarm_runtime.cpp`. `AlarmRuntime::active_states()` trả vector **theo giá trị**; 12 chỗ gọi `find_state(alarms.active_states(), ...)` giữ con trỏ trỏ vào temporary đã bị huỷ. Lỗi này "chạy đúng" suốt vì bộ nhớ vừa giải phóng còn nguyên nội dung.
- Sửa bằng cách **biến lỗi runtime thành lỗi biên dịch**: thêm overload `find_state(std::vector<AlarmState>&&, ...) = delete`. Compiler chỉ ra đúng 12 chỗ, sửa hết. Không ai mắc lại được.
- Sửa `-Wformat-truncation` thật trong `runtime_point_snapshot.cpp`: `set_id` ghi `"%s-%02d"` vào buffer 6 byte — `snprintf` không tràn nhưng số kênh > 99 sẽ **cắt âm thầm thành ID sai**. Kẹp tường minh thay vì tin caller.
- Thêm preset sanitizer vào `services/CMakeLists.txt`: `-DMKDDC_SANITIZE=address|undefined|thread`. UBSan bật `-fno-sanitize-recover=all` — UB phải làm test **fail**, không được chỉ in cảnh báo rồi chạy tiếp.
- Thêm 2 fuzz harness libFuzzer: `fuzz_st_parser` (đường source ST) và `fuzz_st_loader` (artifact — harness quan trọng nhất, vì executor không kiểm biên sau load).
- **Harness loader ban đầu gần như vô dụng, đã đo và sửa:** đo phân bố lỗi trên 1000 đột biến cho thấy **947/1000 chết ở `IR-E-005` (sai hash)** — fuzzer không bao giờ chạm tới bảng section/biến/lệnh. Vá hash trong harness thì nghẽn **chuyển sang `IR-E-006`** (947/1000, vì cờ `kSigned` vẫn bật). Xoá cờ **trước** khi tính hash mới mở được: **277/1000 load thành công**, phần còn lại phân bố đều khắp `IR-E-008/010/011/014`.
- Kết quả fuzzing: parser **698 815 lần chạy**, loader **7 563 082 lần chạy** — **0 crash, 0 phát hiện ASan**.
- **Fake MCU** thêm 4 loại fault injection phủ nốt SPEC §9.3: `--adc-fault {1|2|3}` (mất DRDY + LOCK), `--dac-fault`, `--wdg-reset N` (trước đây `WDG_RESET_CNT` hằng 0 nên không test được), `--stuck-ui CH RAW` (cảm biến đơ — hỏng mà CRC/quality **không** bắt được).
- Verify end-to-end fake MCU ↔ iobus: inject `--adc-fault 1 --dac-fault` → iobus nhận `fault_flags: 5` (bit0 ADC1 + bit2 DAC) và raise alarm `MCU_FAULT_FLAGS`.
- Thêm 2 CI job: `sanitizers` (ASan + UBSan) và `fuzz-smoke` (60 s mỗi harness trên PR).
- Verification: build `-Werror` **649/649**, ASan **646/646 + 0 phát hiện**, UBSan **646/646 + 0 runtime error**, symbol check 0.

### Added — Build native aarch64 và deploy lên Orange Pi 5B (2026-07-28)
- Build native trên board: configure + build `-Wall -Wextra -Werror` **0 lỗi**, sinh 4 binary aarch64 (`mkddc-core`, `mkddc-iobus`, `mkddc-st-compile`, `mkddc-st-validate`). Board chỉ thiếu `libsodium-dev`, cài qua apt.
- **`ctest` trên aarch64: 646/646 pass.** Lần chạy đầu 641/646 — 5 fail do test bám vào SHM production đang bị service ghi đè; loại trừ bằng hai bước (chạy `sudo` vẫn fail ⇒ không phải vấn đề quyền), xác nhận bằng cách dừng service rồi chạy lại. **Không phải khác biệt kiến trúc.**
- Deploy có backup: binary cũ lưu tại `/usr/sbin/mkddc-backup-<stamp>/`, unit file backup kèm timestamp, `WatchdogSec` 3 → 6. Lệnh rollback ghi trong evidence.
- **Sự cố khi start lần đầu:** `plc_shm.attach_fail errno=13` — lần chạy `ctest` để lại `/dev/shm/mkddc_plc_shm` thuộc user `orangepi`, service chạy dưới `mkddc` không mở ghi được. Đã đưa `rm -f /dev/shm/mkddc_*` vào quy trình deploy chuẩn.
- Vận hành sau deploy: 3 phút **0 restart**, `scan_count` tăng đúng chu kỳ, jitter max **250–294 µs** với **0 overrun** (tương đương bản cũ 284–356 µs — thêm Program Runtime **không làm xấu** đặc tính thời gian), output tới MCU vẫn `ack=ok`, script integration BE **18/18 pass trên aarch64**.
- **RT health metric hoạt động đúng thiết kế**: đọc từ SHM cho `rt_degraded=1`, `rt_policy=0`, log mức `ERROR`. Lần đầu tình trạng `F-13` quan sát được từ **metric** thay vì nằm im trong một dòng log khởi động.
- **Phát hiện về ABI:** `sizeof(kx_plc_shm_t)` vẫn **9280 byte** — 4 field RT health lọt vừa vào padding đuôi sẵn có (offset 9276–9279). ABI **không đổi chút nào**, binary Go cũ đọc SHM mới vẫn đúng tuyệt đối.
- **Build tất định cross-architecture — kiểm lần đầu:** compile cùng source trên x86_64 và aarch64 cho artifact **giống hệt từng byte** (`79438ca91be784444b158104a8fd3f42`). BE có thể compile trên server x86_64 mà không cần build farm ARM.
- Evidence đầy đủ: `docs/07_records/test-evidence/fw-som/2026-07-28-aarch64-build-deploy.md`.

### Changed — Review FW SOM Rev 2.0: cập nhật theo source code hiện tại (2026-07-28)
- `docs/review/FW_SOM_SOURCE_SPEC_STATUS_REVIEW.md` lên **Rev 2.0**, viết lại theo commit `5c39c61` sau khi ACTION 1–15 hoàn tất. Kết luận đổi từ `FW_SOM_IMPLEMENTATION_BLOCKED` → **`FW_SOM_HANDOFF_CONDITIONAL`**.
- **7/12 finding của Rev 1.1 đóng hoàn toàn** (F-01 parser segfault, F-02 runtime chạy AST, F-03 allocation trong scan, F-04 overrun không ép safe, F-05 thiếu scheduler, F-06 thiếu RETAIN, F-07 thiếu chữ ký) + 3 finding tài liệu; **2 đóng một phần** (F-11 còn 12/15 workstream C0, B-07 có test đối kháng nhưng chưa có ASan/fuzz/soak).
- **Finding mới `F-13`** — target chạy `SCHED_OTHER` thay vì `SCHED_FIFO 80` do `CONFIG_RT_GROUP_SCHED` + cgroup v2. Đây là finding **chặn duy nhất còn lại** và thuộc Platform/BSP, không thuộc FW SOM. Kèm đính chính con số overrun iobus (0,009% chứ không phải 76%).
- Thêm 6 cờ trạng thái tách bạch thay cho một nhãn chung: `EXISTING_FW_SOM_BASELINE` STABLE, `FW_SOM_ST_HOST_SLICE` COMPLETED, `PRODUCTION_ST_INTEGRATION` **IMPLEMENTED**, `C1_PLUS_OPENING` UNBLOCKED một phần, `BE_HANDOFF_CONTRACT` **COMPLETE**, `TARGET_VERIFICATION` BLOCKED.
- Thêm §0 bảng đối chiếu Rev 1.1 → Rev 2.0; traceability mở rộng lên 33 dòng (T-10b giới hạn parser, T-18b compile CLI, T-29 ST trong ScanLoop, T-30 control interface, T-31 RT health, T-32/33 ngoài scope).
- Số đo thật, build sạch từ đầu với BACNET=ON MODBUS=ON: **ctest 649/649 pass**, 220 test lớp ST, cppcheck 0 lỗi, `nm mkddc-core` 0 symbol compiler, script integration BE 18/18, mọi link markdown hợp lệ.
- Đề xuất **bàn giao có điều kiện**: BE tích hợp ngay, song song với Platform/BSP xử lý `F-13` và FW SOM chạy ASan/UBSan/fuzzing/soak; ký nghiệm thu khi B-05/B-07/B-08 đóng.

### Added — ACTION 14 + 15: tài liệu, tool và mẫu bàn giao BE (2026-07-28)
- **Tool** `mkddc-st-compile` — công cụ **chính thức** để BE sinh artifact đã ký. Cùng contract với `mkddc-st-validate`: argv cố định, source luôn qua file path, đúng một dòng JSON ổn định. Trả `artifact` dạng base64 để BE dùng thẳng cho `program_stage` mà không phải đọc lại file. `--key` cho release; mặc định dùng khoá test.
- **Mẫu** `services/core/st/samples/`: 1 chương trình hợp lệ (chính là chương trình tham chiếu normative của SPEC §13), 4 chương trình lỗi phủ 4 mã khác nhau, artifact mẫu, `program_tasks.example.conf`, `io_map.example.json`. **Cả 5 sample đã verify bằng tool thật**, không phải viết tay rồi tin.
- **Script** `be_integration_test.sh` — 18 kiểm tra end-to-end cho BE: validate, compile, build tất định (`cmp` hai lần compile), base64 khớp file, 4 mã lỗi, input đối kháng không crash. **18/18 pass**.
- **Schema** `shared/st_program_control_v1.schema.json` — hợp đồng JSON đầy đủ cho protocol điều khiển.
- **7 tài liệu bàn giao** tại `docs/handoff/`: Integration Guide (điểm vào, có mục "bảy điều dễ làm sai"), Runtime API Contract, Artifact Format, Error Codes (4 họ mã, kèm cột "BE retry được không"), Program/Task Model, Test Evidence (số đo thật + mục **Hạn chế** nói rõ điều gì chưa tin được), Handoff Checklist.
- Checklist kết luận **chưa** `FW_SOM_READY_FOR_BE_HANDOFF`: phần hợp đồng và chức năng (A/B/C) đã xong và BE tích hợp được ngay, nhưng verification trên phần cứng đúng cấu hình (E1–E8) chưa đóng. Đề xuất **bàn giao có điều kiện**.
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 646/646**; script BE 18/18; `nm mkddc-core` = 0 symbol compiler; mọi link markdown nội bộ hợp lệ.

### Added — ACTION 13: interface điều khiển Program Runtime cho BE (2026-07-28)
- Thêm `services/core/st/st_control_api.{hpp,cpp}` — hợp đồng JSON cho BE: `program_capabilities`, `program_status`, `program_stage`, `program_start`, `program_stop`, `program_enable`, `program_disable`, `program_reset`, `program_rollback`.
- **Tách khỏi `web_ipc` có chủ ý**: file này là logic hợp đồng thuần tuý (chuỗi JSON vào → chuỗi JSON ra), không sở hữu socket. Nhờ vậy toàn bộ hợp đồng test được mà không cần dựng socket, và đổi transport không phải viết lại hợp đồng.
- **Bất biến**: mọi request — kể cả JSON rác, mảng thay vì object, thiếu field — đều nhận lại JSON đúng shape có `errorCode` ổn định và cờ **`keepsRunningPackage`**. BE không bao giờ phải đoán chương trình đang chạy có bị ảnh hưởng không.
- Ba họ mã lỗi tách biệt để BE biết lỗi đến từ đâu mà không phân tích message: `API-E-*` (interface), `IR-E-*` (loader), `ST-*` (compiler).
- `program_capabilities` công bố `artifactSchemaVersion`/`compilerProfile`/`targetAbi`/`maxArtifactBytes` để BE biết **trước** nên compile với profile nào, thay vì thử rồi nhận `IR-E-003`/`IR-E-004`.
- `program_stage` trả `appliedAt: "next_tick_boundary"` — BE không được kết luận "đã chạy" khi mới stage xong.
- `program_status` trả `artifactSha256` để BE **xác minh được cái đang chạy đúng là cái mình gửi**, kèm `lastFault` có mã và dòng ST gốc.
- Artifact truyền base64; chuỗi quá lớn bị từ chối bằng **ước lượng kích thước trước khi giải mã**, không phải sau.
- Test: 17 test gồm nhóm request rác, vòng đời đầy đủ, artifact hỏng vẫn giữ package đang chạy.
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 646/646 pass** (629 → +17).

### Added — ACTION 11 + 12: RETAIN và package integrity (PACKAGE_SECURITY_GATE) (2026-07-28)
- Thêm `services/core/st/st_retain.{hpp,cpp}` — bản ghi RETAIN có magic `MKRT`, version, `layout_hash`, `record_size`, CRC-32. Ghi **atomic**: tmp → `fsync` → `rename` → `fsync` thư mục.
- Ba bất biến: (1) bản ghi sai **không bao giờ** là lý do không khởi động chương trình — từ chối thì cold start kèm chẩn đoán; (2) mất điện giữa lúc ghi không để lại file nửa vời mà lần sau tưởng hợp lệ; (3) đổi layout biến RETAIN làm **hiện ra** mã `RT-RETAIN-003` chứ không âm thầm đọc bytes của layout cũ.
- Wear control: chỉ ghi khi **giá trị đã đổi** *và* đã qua 60 s. Điều kiện "có thay đổi" đặt trước điều kiện thời gian — chương trình có RETAIN nhưng giá trị đứng yên không tốn chu kỳ ghi nào. `force` cho shutdown sạch.
- CRC kiểm **trước** `layout_hash`: file bị cắt do mất điện là nguyên nhân thường gặp nhất, báo đúng nguyên nhân giúp phân biệt "mất điện" với "đã đổi chương trình".
- Test RETAIN: 12 test phủ đủ 6 kịch bản bắt buộc (cold start, warm restart, mất điện khi ghi, CRC sai, đổi tên biến, đổi kiểu biến) + 4 test chính sách ghi.
- **ACTION 12** — 5 trường hợp reject bắt buộc (bị sửa / sai chữ ký / thiếu chữ ký / sai target / sai version) đã có từ ACTION 6. Bổ sung 5 test cho phần các test đó **không** bắt được: gói ký bằng **khoá khác** (kịch bản tấn công thật — cấu trúc hợp lệ, hash đúng, chữ ký đúng, chỉ sai khoá), cơ chế thay khoá release qua `StLoaderOptions::public_key`, binary tự khai báo đang dùng khoá test hay không, `allow_unsigned` **không** bỏ qua kiểm hash, và xoá cờ `kSigned` **không** vượt được chữ ký (cờ nằm trong vùng hash).
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 629/629 pass** (612 → +17).
- **PACKAGE_SECURITY_GATE = PASS.**

### Added — ACTION 10: wire ST vào production ScanLoop (2026-07-28)
- Thêm `services/core/st/st_process_image.{hpp,cpp}` — cầu nối giữa process image của SOM và không gian slot ST. Mọi luật biên tập trung ở một chỗ thay vì rải rác.
- `ScanDeps.st_sched` (mặc định `nullptr`): không cấu hình chương trình ST thì scan loop chạy y như trước, không thêm chi phí nào.
- Vị trí trong chuỗi scan có chủ ý: **sau** cập nhật point table (bước 2), **trước** trọng tài ưu tiên (bước 6). Đầu ra ST đi vào `PriorityResolver` ở mức `PRIO_LOCAL_LOGIC` — **không có đường tắt ra thẳng phần cứng**. Nhờ vậy "chương trình ST không thể vượt mặt manual/BACnet/safety" là bất biến **cấu trúc**, không phải kỷ luật lập trình.
- Đồng hồ `clock.monotonic_ns` chụp **một lần** đầu scan, dùng chung cho mọi Task và mọi FB — hai timer khởi động cùng scan hết hạn cùng scan.
- Instance vừa FAULTED **không** đẩy đầu ra: trạng thái của nó đã được khôi phục, đẩy ra trọng tài là đẩy dữ liệu chu kỳ trước như thể vừa tính xong.
- Giá trị không hữu hạn chặn tại biên cả hai chiều.
- Test: 9 test tích hợp gồm manual thắng ST, safe-state thắng tất cả, overrun→safe qua `SafeState`, chương trình lỗi không crash và không phát output, `st_sched=nullptr` không đổi hành vi, và **zero-allocation vẫn giữ sau tích hợp**.
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 612/612 pass** (603 → +9).

### Added — ACTION 9: multi-task scheduler (SCHEDULER_GATE) (2026-07-28)
- Thêm `services/core/st/st_scheduler.{hpp,cpp}` — **fixed-priority, non-preemptive tại task boundary** theo `PROGRAM_TASK_SCHEDULER_SPEC`. Không preempt làm "process image không đổi trong một lần thực thi Program" thành bất biến **cấu trúc** thay vì quy ước, và loại hẳn khoá khỏi đường điều khiển nên không có priority inversion.
- Mô hình đối tượng: Resource → Task (≤8, ưu tiên duy nhất) → ProgramInstance (≤16/task, ≤32 toàn hệ) → Artifact. Hai instance cùng artifact có **trạng thái hoàn toàn tách biệt**.
- Tick cơ sở 50 ms; chu kỳ phải là bội số của tick (nếu không task trôi so với chính chu kỳ khai báo). Bù trôi theo mốc **lý thuyết**; lỡ nhiều chu kỳ thì **bỏ, không chạy bù** — chạy bù làm timer nhảy và làm quá tải nặng thêm.
- Máy trạng thái 11 trạng thái + 6 lệnh vòng đời. `stop` **không** ép safe-state (hành động vận hành có chủ ý ≠ yêu cầu an toàn); "không ai điều khiển" xử lý ở tầng Resource qua trigger `no_controller`.
- Fault của **một** Program huỷ toàn bộ phần còn lại của Task: các Program trong một Task thường phối hợp, chạy tiếp sẽ đẩy đầu ra vào tổ hợp chưa từng được thiết kế.
- Rollback đi **lại** đúng đường verify thay vì nạp thẳng — rollback không được là cửa sau bỏ qua kiểm tra. Last-known-good chỉ được ghi nhận **sau khi** package chạy ≥1 tick không fault.
- **Hai lỗi thiết kế do test phát hiện, đã sửa:** (1) `ACTIVE` từng tự động lên `RUNNING` khiến lệnh `start` vô nghĩa — nay chỉ `RUNNING` mới được thực thi; (2) activation từng chỉ áp cho task **đến hạn**, khiến task chu kỳ dài phải đợi trọn một chu kỳ dù BE đã báo "đã activate" — nay áp cho **mọi** task ở đầu tick.
- Test: 30 test mới phủ đủ 12 nhóm bắt buộc ở SPEC §11 (thứ tự ưu tiên, chu kỳ không trôi, bỏ tick, nhiều task cùng hạn, fault dừng task, không commit nửa chừng, overrun→safe, enable/disable, vòng đời, instance độc lập).
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 603/603 pass** (573 → +30); `nm mkddc-core` = 0 symbol compiler.
- **SCHEDULER_GATE = PASS.**

### Added — RT health metric quan sát được từ Web/BE (chống tái diễn VG-05) (2026-07-28)
- `shared/mkddc_shm.h`: nối 4 field vào **cuối** `kx_plc_shm_t` — `rt_sched_policy`, `rt_sched_priority`, `rt_mlock_ok`, `rt_degraded`. Lý do: cảnh báo RT trước đây chỉ log một dòng lúc khởi động rồi cuộn khỏi journal, nên core đã chạy nhiều ngày ở `SCHED_OTHER` mà không ai biết.
- **Không đổi magic** — có chủ ý: consumer đọc PLC SHM bằng offset cứng + kiểm độ dài theo ngữ nghĩa min-length (`web/backend/core_client.go`), nên nối vào cuối là tương thích ngược và binary cũ vẫn đọc đúng. Đổi thứ tự/kiểu/kích thước field cũ vẫn là ABI change đầy đủ.
- `main.cpp` đo trạng thái RT **thật** bằng `sched_getscheduler()`/`sched_getparam()` thay vì tin vào mã trả về của `pthread_setschedparam` — trên hệ `CONFIG_RT_GROUP_SCHED` + cgroup v2, systemd đã ép policy trước khi process chạy nên lời gọi thành/bại đều không phản ánh trạng thái cuối.
- Log degraded nâng từ `WARN` lên **`ERROR`** và nêu rõ hệ quả ("jitter KHÔNG được bảo đảm") — chạy không RT là sai lệch so với thiết kế đã duyệt, không phải ghi chú thông tin.
- Test: 5 test mới gồm nhóm `BacnetObjTableAbi` đối chiếu trực tiếp các hằng offset copy từ `core_client.go` — ai đổi layout làm lệch offset thì test fail và buộc phải đồng bộ cả hai phía.
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 573/573 pass** (568 → +5).

### Changed — ACTION 8: watchdog đúng hành vi + evidence trên target SOM (2026-07-28)
- `main.cpp`: ghi rõ luật kick — **chỉ kick sau khi `ScanLoop::step()` trả về trọn vẹn, tuyệt đối không kick giữa scan**. Kick giữa chu kỳ biến watchdog thành liveness check vô nghĩa: một `step()` treo vĩnh viễn vẫn kick đều và systemd không bao giờ restart, đúng loại lỗi watchdog sinh ra để bắt.
- Thêm CI guard: fail build nếu `WATCHDOG=1` xuất hiện trong `scan_loop.cpp`, hoặc nếu số điểm kick trong `main.cpp` khác 1.
- `WatchdogSec` 3 → **6** theo công thức `PROGRAM_TASK_SCHEDULER_SPEC` §9 (`2 × chu kỳ scan lớn nhất + WCET + biên 1 s`). `graph.json` cho phép `scan_ms` ∈ [500, 2000] nên giá trị cũ chỉ còn 1 s biên ở `scan_ms=2000`. Kéo dài không làm chậm bảo vệ đầu ra vì MCU tự ép AO/DO an toàn sau 200 ms, độc lập với SOM.
- Evidence target tại `docs/07_records/test-evidence/fw-som/2026-07-28-watchdog-target.md`: T1 scan treo (`kill -STOP`) → systemd restart sau **6 s**; T2 `SIGKILL` → khởi động lại sau **2 672 ms**; T3 khôi phục `core.ready` đúng; T4 45 s vận hành không bị restart oan. Jitter chu kỳ 1 s: max **284–356 µs**, **0 overrun**.
- **⚠️ Phát hiện:** `mkddc-core` trên board chạy `SCHED_OTHER` prio 0 chứ không phải `SCHED_FIFO 80`, do drop-in `nofifo.conf`. Đã kiểm chứng tiền đề của drop-in là **đúng** (root cũng không đặt được `SCHED_FIFO`: `ulimit -r`=0, `systemd-run` fail `status=214`), nhưng lý do ghi trong drop-in ("kernel không hỗ trợ RT") **sai** — kernel thread vẫn chạy `FF 99`; nguyên nhân gốc đã xác định: `CONFIG_RT_GROUP_SCHED=y` **cộng** cgroup v2 — cgroup v2 không có interface `cpu.rt_runtime_us` nên **không service systemd nào** dùng được RT. Quyết định 2026-07-28: rebuild kernel với `RT_GROUP_SCHED=n`. Đính chính: tỉ lệ overrun thật của iobus là **0,009%** (`overruns=` là bộ đếm tích luỹ từ lúc khởi động, không phải trong cửa sổ 60 s) — không thành phần nào đang gặp sự cố vận hành vì thiếu RT. Cảnh báo `rt.sched_fifo_fail (degraded)` có hoạt động nhưng cuộn khỏi journal. Đây đúng là rủi ro `VG-05` trong review, nay xác nhận là suy giảm **đang xảy ra thật**.
- Do đó `WatchdogSec=6` là **giá trị tạm**: số đo lấy trên hệ không có RT nên không đại diện cho cấu hình production. `WATCHDOG_GATE` đạt phần hành vi, còn chờ đo lại trên target có RT.
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 568/568 pass**.

### Added — ACTION 7: OverrunMonitor tách khỏi CoreMetrics (TASK_SAFETY_GATE) (2026-07-28)
- Thêm `services/core/safety/overrun_monitor.{hpp,cpp}` — đánh giá sức khoẻ thời gian của Task và trả `should_force_safe()`. **Đặt trong `safety/`, không phải `diagnostics/`**: `CoreMetrics` là observability thuần tuý (có thể tắt/lấy mẫu thưa/hỏng mà hệ vẫn phải điều khiển đúng), nên nhét ngưỡng an toàn vào đó sẽ khiến một thành phần không thiết yếu nắm quyền thiết yếu và làm chính sách an toàn không test được độc lập với bộ đếm.
- `SafeState` nhận `OverrunMonitor` như **trigger T8 ngang hàng** với IOP fault / SHM stale / input BAD / no-controller — không phải đường riêng, để mọi nguồn nguy hiểm hội tụ về cùng một hành động an toàn. Thêm `SafeState::triggers()` để alarm và chẩn đoán biết lý do vào safe.
- Chính sách **bất đối xứng có chủ ý**: vào safe sau N lần overrun liên tiếp, nhưng ra cũng cần N lần chạy trong budget liên tiếp. Ra ngay sau một lần tốt sẽ gây dao động vào/ra safe-state khi tải dao động quanh ngưỡng — trạng thái tệ hơn cả ở yên trong safe.
- `reset()` xoá trạng thái quyết định nhưng **giữ** `total`/`max_exec_ns` — xoá chúng sẽ xoá dấu vết một Task từng có vấn đề. Ngưỡng 0 bị kẹp về 1 (ngưỡng 0 = "safe ngay cả khi không overrun", vô nghĩa).
- Test: 16 test mới, gồm nhóm `OverrunMonitorSeparation` khoá lại việc `CoreMetrics` không có API nào ảnh hưởng đầu ra, và 3 test T8 trong `test_safe_state.cpp`.
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 568/568 pass** (552 → +16).
- **TASK_SAFETY_GATE = PASS.**

### Changed — ACTION 6: Typed IR + runtime zero-allocation (TYPED_IR_GATE, ZERO_ALLOCATION_GATE) (2026-07-28)
- **Đóng finding F-02.** `mkddc-core` không còn thực thi source ST. `StProgramRuntime::activate()` nay nhận **byte artifact** đã verify thay vì chuỗi source — đúng `PROGRAM_SOM_FW_DRAFT_DESIGN` §4.
- **Đóng finding F-03.** Executor không cấp phát trong scan path: mọi slot, mọi state FB, mọi bộ đệm ảnh chụp đều cấp phát một lần lúc load. Kiểm bằng test đếm `operator new` qua 1000 chu kỳ → **0 lần**.
- Ngôn ngữ ST mở rộng theo `ST_SUBSET_SPEC`: kiểu `INT`/`TIME` (ngoài `BOOL`/`REAL`), số học `+ - * / MOD` và đảo dấu, `XOR`, `ELSIF`, chú thích `(* *)` và `//`, từ khoá không phân biệt hoa thường, literal `T#1m30s`, khối `VAR`/`VAR RETAIN`, Function Block `TON`/`TOF`/`R_TRIG`/`F_TRIG` với tham số đặt tên và truy cập thành viên, 10 hàm chuẩn.
- Typed IR: máy thanh ghi 16 byte/lệnh, 33 opcode, không gian slot tách biến/hằng nên "hằng không ghi đè được" là bất biến kiểm được tại load; **chỉ cho nhảy tiến** nên mọi chương trình chấm dứt trong ≤ số lệnh.
- Artifact `MKDDCIR1`: SHA-256 toàn file + chữ ký Ed25519 (libsodium), loader 22 bước, 15 mã lỗi `IR-E-*`. Khoá test sinh từ seed cố định, cam kết vào repo cho CI; build release truyền `-DMKDDC_ST_PUBLIC_KEY_HEX`.
- **Bất biến "không parser trong mkddc-core" nay là ràng buộc LINK-TIME**: tách `st_compiler_lib` (parser/semantic/compile/serialize) khỏi `core_lib` (loader/exec/runtime); `mkddc-core` không liên kết `st_compiler_lib`. Thêm symbol check vào CI để vi phạm bị bắt tại CI thay vì lộ ra ở production.
- Không commit nửa chừng: mỗi chu kỳ chụp trạng thái trước khi chạy; chu kỳ fault khôi phục nguyên vẹn cả slot lẫn state FB.
- Tràn `INT` là **fault** (`ST-RT-001`) chứ không wrap im lặng; `NaN`/`Inf` luôn bị từ chối; `AND`/`OR` không short-circuit để WCET ổn định.
- Tách `allocation_probe` từ `test_runtime_point_snapshot.cpp` thành `tests/allocation_probe.{hpp,cpp}` dùng chung — toán tử `new`/`delete` toàn cục chỉ được ghi đè ở một translation unit.
- Gỡ `st_stdlib.{hpp,cpp}` (thay bằng bảng hàm trong `st_program.cpp` + executor).
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 552/552 pass** (504 → +48); cppcheck trên toàn bộ `services/core/st/*.cpp` **0 lỗi**; symbol check `mkddc-core` = 0 symbol compiler.
- **TYPED_IR_GATE = PASS. ZERO_ALLOCATION_GATE = PASS.**

### Added — Phase 2: chốt 3 SPEC kiến trúc FW SOM (ARCHITECTURE_SPEC_GATE) (2026-07-28)
- `docs/02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md` (MS-02 / C0.4): chốt tập con ST chính thức — `BOOL`/`INT`/`REAL`/`TIME`, số học đầy đủ + `MOD`, `XOR`, `ELSIF`, chú thích `(* *)` và `//`, Function Block chuẩn `TON`/`TOF`/`R_TRIG`/`F_TRIG`, `VAR`/`VAR RETAIN`, 11 hàm chuẩn. Grammar EBNF đầy đủ; bảng đối chiếu với parser hiện tại (phủ ~40%, liệt kê từng mục thiếu); 8 khác biệt cố ý so với IEC kèm lý do (không short-circuit để WCET ổn định, tràn INT là fault chứ không wrap, NaN/Inf luôn từ chối); danh mục diagnostic đầy đủ gồm `ST-LEX-*`/`ST-SYN-*`/`ST-SEM-*`/`ST-RT-*`/`ST-LIM-*`/`ST-WARN-*`; chương trình tham chiếu normative kèm bảng hành vi mong đợi theo chu kỳ.
- `docs/02_design/software/TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md` (MS-01 / C0.6): định dạng artifact nhị phân `MKDDCIR1` — header 128 byte, 6 section bắt buộc + 2 tuỳ chọn, máy thanh ghi 16 byte/lệnh với 33 opcode, không gian slot tách biến/hằng để "hằng không ghi đè được" thành bất biến kiểm được, **chỉ cho nhảy tiến** nên mọi chương trình chấm dứt trong ≤ số lệnh. Toàn vẹn SHA-256 + chữ ký Ed25519 (public key nhúng trong build); ghi rõ lý do dùng Ed25519 thay vì GPG như OTA: artifact phải verify in-process trong vòng `SCHED_FIFO 80`. Quy trình load 22 bước; 15 mã lỗi `IR-E-*` trả BE kèm cột "giữ package đang chạy" và "retry được không"; quy tắc tương thích phiên bản; bắt buộc fuzzing loader và kiểm symbol CI để chặn parser lọt vào `mkddc-core`.
- `docs/02_design/software/PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md` (MS-03 / C0.7): mô hình **fixed-priority, non-preemptive tại task boundary** kèm 3 lý do; mô hình Resource/Task/ProgramInstance/Artifact; tick cơ sở 50 ms, bù trôi theo mốc lý thuyết, lỡ chu kỳ thì bỏ chứ không chạy bù; đồng hồ đơn điệu chụp **một lần mỗi tick** để hai timer cùng tick hết hạn cùng tick. **Phân tách bắt buộc** `CoreMetrics` (chỉ đo) / `OverrunMonitor` / `SafetyManager` / `AlarmRuntime`. Chính sách overrun bất đối xứng (vào safe sau N lần hỏng, ra sau N lần tốt) để tránh dao động. Máy trạng thái 11 trạng thái + 9 lệnh; RETAIN với CRC-32 + atomic write + giãn cách 60 s; watchdog **chỉ kick sau tick hoàn tất** kèm công thức chọn `WatchdogSec` từ đo trên target.
- Cập nhật C0 plan: workstream **C0.4, C0.6, C0.7 chuyển Done**.
- **ARCHITECTURE_SPEC_GATE = PASS.**

### Changed — ACTION 2: đồng bộ tài liệu baseline sau M-01 (BASELINE_DOC_SYNC) (2026-07-28)
- `docs/03_implementation/32_DEV_TEAM_NEXT_ACTION.md` → **SUPERSEDED** (Rev 2.0). Cả 3 task blocking (IOB-006/MOD-012/BAC-012) đã xong; số liệu trong đó sai so với đo thật. Thêm bảng đối chiếu "tài liệu ghi gì vs thực tế đo" và trỏ sang tài liệu còn hiệu lực. Nội dung gốc giữ nguyên để truy vết lịch sử, không viết lại.
- C1–C10 plan: ghi rõ 468/468 là số của 2026-07-24, bổ sung số đo lại 504/504 ngày 2026-07-28.
- `docs/review/FW_SOM_SOURCE_SPEC_STATUS_REVIEW.md`: cập nhật traceability sau M-01 — T-10 và T-18 đóng finding F-01, T-18 chuyển DONE, thêm dòng T-10b cho giới hạn tài nguyên, blocker **B-01 đánh dấu ĐÃ GỠ**.
- Path `services/core/st/st_*` đã sửa ở `INTERFACES.md` trong commit M-01.
- **BASELINE_DOC_SYNC = PASS.**

### Fixed — M-01: ST parser không còn crash với input đối kháng (PARSER_SAFETY_GATE) (2026-07-28)
- `services/core/st/st_parser.cpp` là recursive-descent không giới hạn độ sâu; một biểu thức lồng ~12000 dấu ngoặc (~24 KB, dưới hạn mức 64 KiB) làm tràn stack và `mkddc-st-validate` chết bằng SIGSEGV (exit 139, stdout rỗng) — phá vỡ chính hợp đồng "luôn đúng 1 dòng JSON". Cùng hàm `parse_st_program()` này được `StProgramRuntime::activate()` gọi in-process, nên khi wire vào scan loop sẽ crash `mkddc-core`.
- Thêm `services/core/st/st_limits.hpp` — MỘT nguồn sự thật cho toàn bộ giới hạn tài nguyên: source 64 KiB, 32768 token, độ sâu biểu thức 32, độ sâu statement 16, 512 biến, 4096 statement, identifier 64 ký tự, 64 diagnostic. `st_validate_main.cpp` bỏ hằng số hard-code riêng, dùng chung header này.
- Chặn đệ quy tại 2 điểm: `parse_expr()` (ngoặc + argument lời gọi hàm) và `parse_not()` (`NOT NOT NOT ...` tự đệ quy không đi qua `parse_expr`). Dùng RAII `DepthGuard` để depth luôn giảm đúng kể cả khi thoát bằng `return false` giữa hàm.
- Diagnostic code mới: `ST-SYN-002` (lồng quá sâu — tách khỏi `ST-SYN-001` vì là vượt tài nguyên, không phải sai cú pháp), `ST-LIM-001..005` (source/token/biến/statement/identifier), `ST-LIM-006` (danh sách diagnostic bị cắt, luôn là phần tử cuối để BE biết còn lỗi chưa hiển thị).
- Ngưỡng token cố ý đặt (32768) CAO hơn mức giới hạn cấu trúc chặn, để input lồng sâu nhận đúng `ST-SYN-002` ("đơn giản hoá chương trình") thay vì `ST-LIM-002` ("quá nhiều token" — không hữu ích cho user).
- Test: thêm `st/tests/test_st_limits.cpp` (19 test đối kháng) và 8 test đối kháng vào `st/tests/test_st_validate_cli.cpp` chạy fork+execv binary thật, khẳng định exit code luôn ∈ {0,1,2} và stdout luôn đúng 1 dòng JSON đủ 6 field.
- `docs/04_design/INTERFACES.md`: thêm bảng giới hạn + code mới vào contract validate gateway; sửa path `services/core/st_*` → `services/core/st/st_*` (lỗi thời sau ADR-021).
- Verification: build `-Wall -Wextra -Werror` 0 lỗi; **ctest 504/504 pass** (477 → +27); repro gốc xác nhận đã đóng — 12000 ngoặc → exit 1 `ST-SYN-002`, 20000 ngoặc → exit 1 `ST-LIM-002`, 50000 ngoặc → exit 2 `ST-CLI-TOOLARGE`, `NOT`×5000 → exit 1 `ST-SYN-002`.
- **PARSER_SAFETY_GATE = PASS.**

### Changed — Review FW SOM Rev 1.1: kết luận chuyển BLOCKED, sắp lại plan theo dependency (2026-07-28)
- `docs/review/FW_SOM_SOURCE_SPEC_STATUS_REVIEW.md` lên Rev 1.1. Kết luận tổng thể đổi từ `FW_SOM_READY_WITH_FIXES` sang **`FW_SOM_IMPLEMENTATION_BLOCKED`**.
- Tách 4 cờ trạng thái theo phạm vi thay cho một nhãn chung: `EXISTING_FW_SOM_BASELINE = STABLE`, `FW_SOM_ST_HOST_SLICE = COMPLETED`, `PRODUCTION_ST_INTEGRATION = BLOCKED`, `C1_PLUS_OPENING = BLOCKED` (§1.1, §16, §18.1).
- §17 sắp lại theo dependency thành 9 chặng: M-01 → cập nhật docs → MS-02/MS-01/MS-03 → M-02 + M-03 → M-04/M-05 → verification gates → C0.15 → M-09 → BE integration. M-03 lùi sau M-02 vì exec context phải cấp phát theo layout IR; MS-02 đứng trước MS-01 vì grammar quyết định IR mã hoá cái gì.
- F-04/M-04: **không đặt safety policy trong `CoreMetrics`** — tách thành `OverrunMonitor` + `TaskHealthMonitor` đặt trong `safety/`, `CoreMetrics` giữ nguyên vai trò observability thuần tuý.
- F-12/M-05: **cấm kick watchdog giữa scan** — chỉ kick sau cycle hoàn tất thành công; `WatchdogSec` phải chốt từ WCET đo trên target SOM, không từ suy đoán trên host.
- Thêm §8.5 khoảng trống verification, blocker B-07, microtask V-01..V-07 và MI-13..MI-18: ASan, UBSan, fuzzing parser/CLI, đo WCET/jitter trên SOM target, xác minh systemd RT capability trên target, HIL với MCU thật, fault-injection suite.
- Thêm §14.1 quy tắc gating: chưa được wire ST vào `ScanLoop` hoặc mở C1+ cho tới khi toàn bộ B-01 → B-05 đóng **và** C0.15 PASS. Ghi rõ đóng B-01 một mình là không đủ.
- Không thay đổi source code.

### Added — Review trạng thái source/SPEC module FW SOM (2026-07-28)
- Thêm `docs/review/FW_SOM_SOURCE_SPEC_STATUS_REVIEW.md` — review độc lập toàn bộ `services/core` + `services/iobus` đối chiếu SPEC/design/ADR/plan FW SOM. Gồm 30 dòng traceability matrix, bảng interface status, functional status matrix, 12 finding và 15 microtask kế tiếp.
- Verification thật tại thời điểm review (không lấy số từ tài liệu): configure + build `services/` với `-Wall -Wextra -Werror -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_MODBUS=ON` → exit 0, 0 lỗi (`libmodbus 3.1.10`, `bacnet-stack` BACDL_BIP=ON); `ctest` → **477/477 pass, 0 fail, 0 skip**; `cppcheck` trên `core/{st,graph,safety,ipc}` → 0 error.
- Finding chính: F-01 CRITICAL — ST parser đệ quy không giới hạn độ sâu, repro segfault (`mkddc-st-validate` exit 139 với source 24 KB / 12000 ngoặc lồng, dưới hạn mức 64 KiB); F-02 HIGH — runtime thực thi AST parse trực tiếp từ source text, trái Design §4/§7.2 vốn bắt buộc typed IR + loader validation; F-03 HIGH — cấp phát heap trong scan execution path, trái Design §7.2.
- Kết luận: `FW_SOM_READY_WITH_FIXES` — lát cắt host-only `FW-SOM-ST-001` đã hoàn thành có bằng chứng; không được wire ST vào production scan loop hoặc mở C1+ cho tới khi đóng F-01/F-02/F-03 và C0.6/C0.7.
- Review này không sửa source code (theo yêu cầu phạm vi review).

### Changed — CTO mở scope FW SOM ST host execution + quy tắc tài liệu tiếng Việt (2026-07-28)
- governance(ADR-020): ghi nhận quyết định `FW-SOM-ST-001` của CTO ngày 2026-07-24 — go-with-scope, cho phép code production trong `services/core` để chạy/test một chương trình ST tối thiểu trên SOM host runtime. FE/Web Backend/STM32/HIL/FBD đầy đủ vẫn ngoài scope, không claim `IEC 61131-3 compliant`/`certified`. ADR-020 chuyển sang trạng thái `Accepted — supersedes ADR-004; amended 2026-07-24`.
- docs(design): `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` lên v0.6 — cập nhật header trạng thái/release gate, thêm dòng approval log `FW-SOM-ST-001` ở §15.1 và entry Revision History 0.6.
- docs(verification): `VERIFICATION.md` ghi rõ Program Runtime release gate **vẫn RED** dù scope đã mở; G2/G3 nêu điều kiện evidence đầu tiên (ST subset/typed execution, chạy ST program thật trên SOM host runtime); Release decision giữ `NO-GO`.
- docs(rules): bổ sung quy tắc tiếng Việt vào `AGENTS.md` (đồng bộ với `CLAUDE.md`) và chuyển toàn bộ tiêu đề output của skill `mekong-ddc-review` sang tiếng Việt.
- Chỉ thay đổi tài liệu/quy tắc, không đổi code. Verification trên `services/core` tại thời điểm commit: cấu hình + build sạch với `-Wall -Wextra -Werror` (0 lỗi) và `ctest` **295/295 pass**.

### Fixed — Network authority consistency và FE RBAC (2026-07-25)
- backend(network): giữ `network.conf.eth` ở trạng thái compatibility read-only, chặn mutation Ethernet qua `/system/config/network` và không cho luồng lưu BACnet/WiFi ghi lại IP/mode/gateway cũ hoặc đổi WiFi mode; Ethernet chỉ thay đổi qua `mkddc-netcfg` transaction.
- backend(validation): đồng bộ pre-validation Go với C++ authority cho loopback `lo`, DHCP có static fields, prefix `/0`/`/31`/`/32`, địa chỉ network/broadcast/unusable và gateway khác subnet.
- frontend(rbac): guard route và ẩn navigation Network với viewer/operator; ngừng request/poll authority transaction khi session không phải admin, đồng thời cho polling interval phản ứng đúng khi quyền thay đổi.
- docs(api/web): cập nhật OpenAPI 1.9.1 và Web guide Rev 1.35 để ghi rõ ownership `mkddc-netcfg`, Ethernet read-only trên legacy config và rule candidate.
- verification: FE full suite 24 files/117 tests, production build (`typecheck`) và `lint` pass; OpenAPI 1.9.1 parse/assertions pass (44 paths); Go Linux test binary compile, `go vet` và focused Network suite pass (10 top-level tests, 16 authority-policy cases); full Linux binary suite chỉ còn 2 failure phụ thuộc môi trường đã biết (`go` không có trong WSL runtime của rollback-package test và HMI restart socket không ổn định trên WSL mount).

### Changed — `services/core` restructured into domain subfolders (Phase A, ADR-021) (2026-07-24)
- Purely organizational — no runtime behavior/API change. `services/core` (~30 `.cpp`/`.hpp` files + 24 test files) was flat with no subfolders, unlike its sibling `services/iobus` which already groups files by domain (`bacnet/`, `bridge/`, `config/`, etc.). Moved every file into 8 domain subfolders mirroring that convention: `st/` (ST language: parser/semantic/runtime/stdlib/artifact/io_map/cyclic_runtime/trace + `mkddc-st-validate` entry point), `graph/` (component graph + point data model + scan loop), `alarm/`, `bacnet/`, `schedule/`, `safety/` (safe-state), `ipc/` (web_ipc/iobus_reader/output_writer/priority_resolver/config_reload — core↔iobus and core↔web communication), `diagnostics/` (core_metrics). `main.cpp`, `CMakeLists.txt`, and `json_min.hpp` (cross-cutting utility) stay at `services/core/` root. Each domain has its own `tests/` subfolder, matching `services/iobus/bacnet/tests/`. All local `#include` paths now use the full path from `services/core/` root (e.g. `#include "st/st_parser.hpp"`), including same-domain includes — matches the existing `services/iobus` convention (e.g. `bridge/core_bridge.cpp` includes its own header as `"bridge/core_bridge.hpp"`, not bare). `services/core/CMakeLists.txt` source/test lists updated to the new paths; no change to targets, flags, or dependencies.
- Full ADR at `docs/adr/ADR-021-restructure-core-and-backend-by-domain.md` (Phase A: `services/core`, Accepted and executed; Phase B: `web/backend` → Go `internal/` packages, still Proposed/not started — separate follow-up after Phase A is confirmed stable).
- Verification (before AND after the move, same commands, results identical): `cmake -S services -B build/services -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror" -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_MODBUS=ON` + `cmake --build build/services --parallel` (clean rebuild from scratch after the move, 0 errors) + `ctest --test-dir build/services --output-on-failure --parallel 4` — **471/471 passed, both before and after**. Also re-ran the 3 full-runtime integration scripts before/after with identical results: `tools/test_safety_e2e.sh` (3 safety layers PASS), `tools/test_reload_e2e.sh` (SIGHUP reload A-F all PASS), `tools/integration_test/advanced_stack_test.sh` (Group A-E, **PASS=18 FAIL=0 SKIP=4, identical pass/skip set before and after**). Moved domain-by-domain with a build+test checkpoint after each of the 8 domains, not one bulk move.

### Added — Web Ethernet transaction authority (2026-07-24)
- backend(network): thêm adapter admin-only `GET /api/v1/network/transaction` và `POST /api/v1/network/transaction/{action}` tới `mkddc-netcfg`; body 4 KiB, JSON strict, validate shape theo action, giữ nguyên authoritative response và fail closed 502/503 khi authority lỗi/mất kết nối.
- backend(audit/rbac): inject `netcfgAuthority` qua `App`, audit user/action/transaction/result không ghi candidate hoặc credential; viewer/operator không được gọi endpoint transaction.
- frontend(network): tách ACTIVE/KERNEL khỏi PENDING CANDIDATE, poll status mỗi giây, triển khai Validate → Stage → Apply → Confirm/Rollback, countdown tự rollback, trạng thái stale/unavailable/rejected và khóa transition sai; Ethernet không còn sửa qua form desired config BACnet/WiFi.
- frontend(network): xử lý `ConfigPutResult.applied=false`/warnings thay vì luôn báo lưu thành công; thêm type/client contract v1 và simulator transaction cho demo.
- docs(api/web): nâng OpenAPI lên v1.9.0 với 2 route và schema netcfg; cập nhật Web implementation guide Rev 1.34 để phân biệt `network.conf` desired với kernel active.
- tests/verification: FE `typecheck`, `lint`, `test` (23 files, 112 tests) và production `build` pass; Linux cross-compile Go pass, network/netcfg + historian 48h boundary targeted tests pass, backend suite pass khi bỏ qua 2 test phụ thuộc môi trường (`go` không có trong WSL và HMI restart Unix socket trên WSL mount); OpenAPI parse thành công (44 paths, 69 schemas), `git diff --check` pass.

### Fixed — Network transaction rollback và khóa candidate authoritative (2026-07-25)
- services/netcfg(network-safety): chỉ Stage khi kernel state trước đó đủ khả năng khôi phục; rollback bắt buộc persist/reapply NetworkManager profile cũ, xóa địa chỉ tạm/DHCP lease phát sinh và xác minh lại interface/link/mode/IPv4/prefix/gateway trước khi báo `rolled_back`; lỗi ở bất kỳ bước nào chuyển transaction sang `failed` với reason code fail-closed.
- frontend(network-safety): đồng bộ form theo `pending` mỗi khi transaction authoritative thay đổi, khóa chỉnh sửa/Validate/Stage trong transaction active và chỉ cho Apply khi candidate hiển thị khớp transaction đang chờ, tránh áp nhầm giao dịch từ browser/HMI khác.
- frontend(dependency-security): nâng `react-router-dom`/`react-router` lên 7.18.1 để vá `CVE-2026-55685`; thêm ignore có hạn đến 2026-10-25 cho `GHSA-qwww-vcr4-c8h2` vì advisory chỉ ảnh hưởng unstable RSC APIs trong khi frontend là client-side SPA và không dùng RSC, chờ migration React/Router 8 tương thích.
- verification: WSL Linux build `mkddc-netcfg` với `-Wall -Wextra -Werror` và CTest 17/17 pass; FE 23 test files/113 tests, `typecheck`, `lint` và production build pass; Go backend Linux cross-compile pass; Trivy v0.70.0 không còn HIGH/CRITICAL chưa xử lý.

### Changed — Đồng bộ kế hoạch FE/BE Program Runtime sau PR #57 (2026-07-24)
- docs(program-runtime): cập nhật C0 plan, C1–C10 implementation plan và readiness review với evidence PR #57/CTest 468/468; phân biệt rõ validate gateway, io-map, cyclic metrics, `LIMIT` và trace ring host-only với production API/storage/runtime/audit còn thiếu.
- docs(governance): khẳng định dependency C1–C10 và điều kiện toàn bộ C0.1–C0.14 Done trước C0.15 full Go; ngoại lệ FW SOM host-only không mở production FE/Web Backend/STM32/HIL/FBD.
- frontend(programming): ẩn legacy Programming demo khỏi live/production route và navigation; chỉ mở khi đồng thời chạy demo mode và opt-in `VITE_ENABLE_LEGACY_GRAPH_DEMO=1`, kèm banner local-only và đổi action thành Simulate.
- tests(frontend): thêm unit test cho feature gate và navigation regression để production không expose legacy Programming demo.
- verification: đối chiếu nội dung với `CHANGELOG.md`, `docs/04_design/INTERFACES.md` và source `services/core/st_*`; FE `typecheck`, `lint`, 112 tests và production build pass; markdown/OpenAPI parse và `git diff --check` pass.

### Added — `CLAUDE.md` project instructions (2026-07-24)
- Added `CLAUDE.md` at repo root — Claude Code (the harness this session runs in) auto-loads this file every session, unlike `AGENTS.md`, which this harness does not read automatically. Mirrors `AGENTS.md`'s existing rules (changelog discipline, FE local changes as source of truth) so they actually take effect for Claude Code sessions, plus the always-respond-in-Vietnamese / minimize-English-in-rules-and-skills rule that was previously only sitting uncommitted in `AGENTS.md`. Root cause: a prior session answered in English despite that rule existing in the working tree, because `AGENTS.md` was never being auto-loaded in the first place. Docs-only change; no code/behavior affected.

### Added — FW SOM IEC programming foundation: validate gateway, diagnostics, io_map, cyclic runtime, stdlib, trace (2026-07-24)
- **FW SOM only** (`services/core`). Completes the runtime substrate needed for BE/FE to start integrating real IEC ST programming, on top of the FW-SOM-ST-001 slice (below). No FE, no Go BE storage/API, no STM32 firmware, no HIL — all explicitly out of scope, not touched.
- **1. ST compiler/runtime, hardened.** `st_program.hpp`/`st_parser.cpp`/`st_semantic.cpp`/`st_runtime.cpp` reworked around a structured `StDiagnostic` (severity/code/line/column/length) instead of a plain string, and the grammar extended: full comparators (`>`,`>=`,`<`,`<=`,`=`,`<>`), boolean `AND`/`OR`/`NOT`, parenthesized expressions, function-call syntax. Source position is tracked through the lexer and carried on every `StExpr`/`StVarDecl`/assignment target, so every syntax/semantic error now reports an accurate line/column (verified by exact-value tests, not just "some diagnostic came back"). No source is parsed in the scan/execute path (`StProgramRuntime::execute()` unchanged in that respect from FW-SOM-ST-001) and no test hard-codes expected output — the golden `HVAC_CTRL` program and all error-path programs are real source text.
- **2. Validate gateway CLI** — new `mkddc-st-validate` executable (`st_validate_main.cpp`), fixed argv (`--source <path>`), source always read from a file path (never embedded in argv/shell), bounded to 64 KiB. Deterministic single-line JSON to stdout (`ok`, `diagnostics[]`, `symbols[]`, `artifactHash`, `compilerVersion`, `irSchemaVersion`) with stable exit codes (0=valid, 1=ST error, 2=CLI usage/IO error) — see `docs/04_design/INTERFACES.md` "FW SOM IEC programming — validate gateway" for the full contract. `artifactHash` is FNV-1a 64-bit (content identification, explicitly documented as not a cryptographic hash). Tested end-to-end via real `fork()+execv()` of the built binary (`tests/test_st_validate_cli.cpp`), not just unit-level parser calls.
- **3. Line/column diagnostics** — `st_diagnostic.hpp` defines `StDiagnostic` and a stable error-code namespace (`ST-LEX-*`, `ST-SYN-*`, `ST-SEM-*`, `ST-IOMAP-*`); every parser/semantic failure path now returns one, with exact line/column verified by tests that hand-compute the expected position rather than asserting "position is set."
- **4. io_map validator** — new `st_io_map.hpp/.cpp`: validates a proposed binding list (`StIoMapEntry`) against a compiled `StProgram`'s declared `VAR_INPUT`/`VAR_OUTPUT` — unknown variable, direction mismatch, type mismatch, invalid `point_id` (must be `PREFIX-NN`, `PREFIX ∈ {UI,DI,AO,DO}`, matching the existing point-ID convention in `runtime_point_snapshot.cpp`/`alarm_runtime.cpp`), invalid range, and (unlike parser/semantic) every declared variable without a binding, or with more than one, is reported — all diagnostics returned in one call, not fail-fast, since a config list benefits from seeing every problem at once. No `io_map.json` file/CRUD — that remains BE/C2 scope; this is validation logic only.
- **5. Cyclic runtime + activation boundary** — new `st_cyclic_runtime.hpp/.cpp` (`StCyclicRuntime`): wraps `StProgramRuntime` with the same request/apply-at-boundary pattern as `scan_loop.hpp`'s `reload_flag_` — an activation request is stored, not applied, until the start of the next `run_cycle()`, never mid-execute. Overrun/exec-fault metrics (`cycle_count`, `overrun_count`, `exec_fault_count`, `last_exec_ns`, `max_exec_ns`) follow the same `CoreMetrics::end_scan` pattern already covered by tests in the prior FW SOM PR — `run_cycle()` takes caller-supplied timestamps, no real sleep, no flaky timing in tests.
- **6. Standard function/operator library, minimal** — new `st_stdlib.hpp/.cpp`: `AND`/`OR`/`NOT` and `GT`/`GE`/`LT`/`LE`/`EQ`/`NE` implemented as language operators (correct per IEC 61131-3 — these are "common elements," not callable functions); `LIMIT(MN, IN, MX): REAL` implemented as a callable standard function with a versioned registry (`kStStdLibraryVersion`). **`SEL` and `TON` are explicitly NOT implemented** — `TON` needs `FUNCTION_BLOCK` instance declaration, dot-member access (`Timer1.Q`) and a `TIME` type, none of which exist in the current minimal grammar; rather than bolt on a state-incorrect timer, it's left undone and documented as such in `st_stdlib.hpp`, consistent with "don't list what isn't implemented."
- **7. Runtime trace/audit event source** — new `st_trace.hpp/.cpp` (`StTraceEvent`, `StTraceLog`): schema for `VALIDATE_RESULT`/`ACTIVATION_RESULT`/`RUNTIME_FAULT`/`OVERRUN`/`ROLLBACK` events, bounded in-process ring buffer (oldest dropped when full, `dropped_count()` observable). Wired directly into `StCyclicRuntime` (activation attempts, rollback-on-fail, runtime faults and overruns all push real events, not just a standalone unused struct) — tested end-to-end, not just schema-shape. No durable audit log/BE aggregation yet — that remains C8/BE scope.
- **8. Contract docs** — `docs/04_design/INTERFACES.md` updated with the new "FW SOM IEC programming — validate gateway" section (diagnostics JSON shape, CLI exit codes, symbol output, artifact metadata, io_map validation rules, cyclic runtime/trace fields) rather than creating a new document.
- New test files: `tests/test_st_io_map.cpp` (12 cases), `tests/test_st_cyclic_runtime.cpp` (11 cases), `tests/test_st_stdlib.cpp` (10 cases), `tests/test_st_validate_cli.cpp` (6 cases, real subprocess). `tests/test_st_runtime.cpp` extended (+9 cases: exact line/column, extended grammar, unknown function/arg-count rejection).
- Verification: `cmake -S services -B <tmp> -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror"` then `cmake --build <tmp> --parallel` — 0 warnings across core/iobus/netcfg. `ctest --test-dir <tmp> --output-on-failure --parallel 4` — **468/468 tests passed** (core_tests grew from 296 to 344; iobus_tests/netcfg_tests unaffected). Host build/test only — no HIL/target evidence claimed.

### Changed — CTO approval for FW SOM ST host execution next action (2026-07-24)
- docs/program-runtime: CTO/Project Engineering Owner approved `FW-SOM-ST-001` as a Go-with-scope next action: `services/core` may implement and test a real minimal ST program on the SOM host runtime substrate. This removes the owner-assignment blocker for the FW SOM-only PR while keeping FE/Web Backend/STM32/HIL/FBD-full work out of scope and keeping Program Runtime release/conformance gates G1-G6 RED until evidence exists.
- docs/planning: updated `DECISIONS.md`, `PROGRAM_RUNTIME_READY_FOR_C0.md`, the C0 plan, the C1-C10 implementation plan, the Program/SOM/FW design approval log and `VERIFICATION.md` so the next developer prompt is no longer blocked by "C0 chưa duyệt" for the FW SOM ST slice. Verification: documentation diff only; `git diff --check` passed.

### Added — FW-SOM-ST-001: minimal ST program execution on FW SOM host runtime (2026-07-24)
- services/core: FW SOM only — `services/core` can now parse, typecheck, atomically activate and execute a real minimal IEC 61131-3-aligned Structured Text program on the existing SOM host runtime substrate. New files: `st_program.hpp` (typed AST/IR: `StType` REAL/BOOL, `StValue`, `StIoImage`, `StVarDecl`, `StExpr`, `StStmt`, `StProgram`), `st_parser.hpp/.cpp` (hand-written lexer + recursive-descent parser reading real source text — `PROGRAM`/`VAR_INPUT`/`VAR_OUTPUT`/`END_VAR`/assignment `:=`/comparison `>`/`IF..THEN..ELSE..END_IF`/`END_PROGRAM`; no arithmetic, loops, CASE, LD or SFC — intentionally minimal per FW-SOM-ST-001 scope, not a parser limitation), `st_semantic.hpp/.cpp` (type/binding check: rejects unbound variables, type mismatches on assignment/comparison, and assignment to a `VAR_INPUT` target since IEC inputs are read-only in the body), `st_runtime.hpp/.cpp` (`StProgramRuntime`: `activate()` parses+typechecks into a candidate and only atomically swaps it in on full success — mirroring the existing `GraphRuntime::reload()` pattern — otherwise the previous package keeps running unchanged; `execute()` never parses source, only walks the pre-resolved IR, pre-validates all declared inputs are present/correctly-typed/finite before touching any output, stages output writes locally and only commits them to the caller's output image on a fully successful run so a mid-execution fault never produces a partial output write).
- Demo program (`HVAC_CTRL`, exactly as specified): `SupplyTemp`/`Setpoint : REAL` inputs, `FanEnable : BOOL` output, `IF SupplyTemp > Setpoint THEN FanEnable := TRUE ELSE FanEnable := FALSE END_IF`. Verified `SupplyTemp=28, Setpoint=24 → FanEnable=TRUE` and `SupplyTemp=22, Setpoint=24 → FanEnable=FALSE` by actually parsing and executing the source text (not hard-coded test output).
- New `tests/test_st_runtime.cpp` (16 cases): both required HVAC_CTRL acceptance values parsed from real source; invalid syntax rejected; type mismatch rejected on both comparison and assignment; unbound variable rejected; assignment-to-input rejected; activation failure keeps the old package running (verified by executing it afterward, not just checking a flag); valid reactivation replaces the old package; NaN and Inf inputs rejected without silently producing a GOOD output (output image left untouched, verified via a pre-set sentinel); missing/mistyped declared input rejected without touching outputs; `execute()` before any `activate()` rejected cleanly; `fault_count()` observable and accurate across failed/succeeded executions; `execute()` called 100 times does not increment `activation_count()` (no reparse/reactivation in the scan/execute path); duplicate variable declaration rejected.
- Not wired into `ScanLoop`/`main.cpp`'s live production scan loop — this PR adds and fully tests the ST parse/typecheck/execute capability as a host-runtime module linked into `core_lib`, without changing `mkddc-core`'s live control-path behavior/contract, consistent with a bounded "next action" scope rather than a full product integration decision.

### Added — FW SOM IEC runtime foundation coverage (2026-07-24)
- services/core: FW SOM only — completed coverage verification for the 8 required runtime-substrate groups ahead of a future IEC Program Runtime (`mkddc-program-core`, ADR-020, not yet implemented/C1+). No ST/FBD/IR/artifact execution was added; `services/core` (`mkddc-core`) remains the existing 28-node legacy-importer control runtime — see `docs/adr/ADR-020-mekong-owned-iec-aligned-program-runtime.md` §3/§4/§8 and `docs/05_verification/VERIFICATION.md` G3 (RED, unimplemented, C0 not yet approved). Coverage matrix (all 8 groups PASS):
  1. Scheduler runtime — `scan_loop.cpp` (absolute `clock_nanosleep`/`TIMER_ABSTIME`, jitter stats), `core_metrics.cpp` (`scan_count`/`last_exec_ns`/`max_exec_ns`/`scan_overrun`, overrun logged not silently dropped). New: `tests/test_core_metrics.cpp` (8 cases: under/equal/over budget, repeated overrun accumulation).
  2. Input snapshot — `iobus_reader.hpp/.cpp` (seqlock `IoSnapshot`), `point_quality.cpp` (GOOD/UNCERTAIN/BAD + stale scan-count propagation). Existing `tests/test_iobus_reader.cpp`, `tests/test_point_quality.cpp` (GOOD/BAD/STALE progression, per-channel fault).
  3. I/O image abstraction — `iobus_reader.hpp` (core never creates SHM, only `mkddc-iobus` does), `output_writer.hpp` (AO eng→electrical conversion happens once, in iobus/MCU path — core only ever writes engineering values), Web/HMI enter only via `web_ipc`'s command queue arbitrated by `priority_resolver` (never a control-path bypass).
  4. Output staging — `priority_resolver.cpp::resolve()` builds a complete `OutputCmd` value, `safe_state.cpp::apply()` may override it wholesale, `output_writer.cpp::write()` commits atomically per-field; no code path emits a partial/inconsistent `OutputCmd`. New: `tests/test_output_writer.cpp` (8 cases: not-attached/bad-magic no-op, valid-channel-only writes, value-changed idempotency, non-1/0 DO coercion).
  5. Activation boundary — `graph_runtime.cpp::reload()` (load→validate→atomic swap, keep-old-on-fail) and `config_reload.cpp::reload_configs()` (per-section apply, failed section keeps old, active manual/priority holds survive), applied only at the scan boundary via `scan_loop.cpp`'s `reload_flag_` (never mid-`step()`). Existing `tests/test_config_reload.cpp` (`GraphReload.FailKeepsOldGraph`, `ChangedContentSwapsAtomically`, `ConfigReload.BadConfigKeepsOldDefaults`, `ManualHoldSurvivesReload`). Added a clarifying comment on `GraphRuntime::reload()` documenting this as the activation-boundary contract a future `mkddc-program-core` would need to reuse (no new runtime code).
  6. Fault handling — `safe_state.cpp` (T1/T2/T3/T6/T7 triggers → fixed AO/DO safe values), NaN/Inf rejected at every write boundary (`priority_resolver.cpp::set_ao`, `schedule_runtime.cpp`, `alarm_runtime.cpp`, `runtime_point_snapshot.cpp`), observable via `core_metrics`/`safe_state.active()`/stderr logs. Existing `tests/test_safe_state.cpp` (7 trigger cases), `tests/test_scan_loop.cpp` (`FaultTriggersSafeOutputs`, `StaleShmTriggersSafeWithin6Scans`, `DetachesOnBadMagicAndRestoresOnReattach`), `tests/test_priority_resolver.cpp::RejectsAoOutsideAppliedPhysicalRange` (incl. NaN).
  7. No-allocation/deterministic scan path — `pending_`/`pending_alarm_` in `scan_loop.hpp` are pre-allocated members reused via `.clear()` (never freed) across scans; `WebIpc::drain()`'s empty-vector fast path (the common case, no pending command) performs no heap allocation, and its bounded-growth case is capped at 64 lines/scan (pre-existing, documented here rather than changed, since widening `WebIpc`'s public contract is out of this change's minimal-diff scope). New: `pending_capacity_for_test()`/`pending_alarm_capacity_for_test()` test-only accessors (`CORE_BUILD_TESTS`) and `tests/test_web_ipc.cpp::ScanLoop.PendingCommandBuffersDoNotReallocateAcrossSteadyLoad`, a real-socket structural test proving capacity does not grow again once warmed up under steady per-scan command load.
  8. IEC programming readiness — confirmed `services/core` never executes source ST/FBD/JSON graph directly (`GraphRuntime` only runs pre-loaded/validated typed node structs); the legacy 28-node graph is not relabeled as FBD (`docs/04_design/SOFTWARE.md` §"Component graph Rev A"). The activation-boundary contract (group 5) is the reusable pattern for a future artifact runtime; building that runtime itself (`libmkddc_iec`/`mkddc-program-service`/`mkddc-program-core`) is explicitly out of scope until ADR-020's C0 is reviewed and approved (currently not approved — see `PROGRAM_RUNTIME_READY_FOR_C0.md`).
- Verification: `cmake -S services -B <tmp> -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror"` then `cmake --build <tmp> --parallel` — 0 warnings across core/iobus/netcfg. `ctest --test-dir <tmp> --output-on-failure --parallel 4` — **407/407 passed** (core_tests 296 incl. 24 new, iobus_tests 96, netcfg_tests 15 — unaffected by this change, run as part of the shared `services/` build tree).
- No controlled contract docs changed because behavior/ABI/SHM layout/output semantics are unchanged — this change is test coverage plus one clarifying code comment; `docs/04_design/SOFTWARE.md`, `docs/04_design/INTERFACES.md`, `docs/05_verification/VERIFICATION.md`, `docs/07_records/TRACEABILITY.md` were read for consistency but not edited.
- Not in this change (explicitly out of scope): FE/Web IDE, Go backend/API, STM32 firmware (`fw/`), HIL/target bring-up, ST parser/FBD canvas/compiler/IR (`mkddc-program-service`/`mkddc-program-core`, ADR-020 C1-C10, gated on C0 approval).
### Changed - Restart local project runtime via WAN (2026-07-24)
- deployment(runtime): restore the WAN SSH tunnel on local port 18081 and restart the local Vite frontend on port 5173 in live JWT mode without changing frontend source files.
- verification: login and `/api/v1/me` return `admin`; `/api/v1/system/status` returns `overall=ok` with live CPU, RAM, temperature, and uptime values from the Orange Pi backend.

### Fixed - Netcfg socket startup safety (2026-07-23)
- services(netcfg): fail closed when the Unix socket path, bind/listen, permissions, owner lookup, or ownership assignment is invalid; every failed startup now closes the listener and removes the partial socket.
- CI: consume the previously ignored `chown` result so all `-Werror` C++ build matrices can compile the integrated main/frontend branch.
- verification: Linux baseline builds with `-Wall -Wextra -Werror`; CTest passes (`390/390`), including overlong socket-path rejection.

### Changed — ADR-020 repository-wide synchronization, ACTION-01..08 (2026-07-23)
- docs/governance: closed all 31 document conflicts found by a two-pass repo-wide scan (26 initial + 5 found on a confirmation pass) — see `KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md` v2.0. Every flagged line got a substantive correction (not a blanket banner): `docs/01_specs/*` (PRODUCT_DEFINITION, SW_ARCH_SPEC, REVA_SCOPE_ROADMAP, PRD, SRS, SW_REQUIREMENTS, DS, OPEN_ISSUES, TEST_SPEC, DESIGN_PLAN_SWFW), `docs/00_management/*` (PM-GOAL, PM-MARKET, PM-OVERVIEW, PM-IMPLPLAN), three historical ADRs (006/008/009, annotated without altering their original Decision/Context text), an implementation guide, `GETTING_STARTED_DEV.md`, `SW_DDD_MK-DDC-24_VI.md`, `BACNET_PICS_EPICS_MK-DDC-24_VI.md`, and `docs/adr/README.md`.
- docs/governance: during merge with `origin/main`, Program Runtime was registered as `ADR-020` so existing remote `ADR-018` (SQLite block historian) and `ADR-019` (point namespace) remain stable.
- docs/baseline: `REQUIREMENTS.md`, `VERIFICATION.md`, `TRACEABILITY.md` updated with the ADR-020 requirement set (SYS-REQ-IEC-001, SWR-REQ-IEC-001..009, IF-REQ-IEC-001, SAFE-REQ-IEC-001, NFR-REQ-IEC-001, FW-REQ-MCU-001..002) and a Program Runtime release-gate section (G1-G6 RED, no code yet). G0 now GREEN across `VERIFICATION.md` and the design doc — Product/ADR/Requirements/Verification/Traceability are all synchronized with ADR-020.
- docs/datasheet: `DS_MK-DDC-24_VI.md` no longer claims "IEC 61131-3: Compliant" (a prohibited claim per ADR-020/RD-IEC-006); replaced with an explicit not-certified/roadmap statement, and the surrounding tagline, feature bullets, commissioning section and competitor table were corrected so the datasheet no longer reads as if the Program Runtime already ships.
- docs/pm-plan: `KX-DDC24-PM-IMPLPLAN-001_VI.md` updated per direct CTO clarification — Rev A.0's Program Editor is **ST Text Editor + FBD Graphical Editor**, not a generic "canvas" (ST is text, only FBD is graphical); the legacy `graph.json` importer task is now explicitly distinguished from the new Program Runtime editor tasks.
- docs/design: `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` bumped to v0.5; G0 moved GREEN in both the header and §14 gate table, reflecting the completed baseline sync.
- docs/planning: `KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md` §3 summary table gained Reviewer/ETA columns. Owner assignment remains role-only (Program Runtime Architect, SOM Backend Lead, Firmware Lead, QA/HIL Lead, TechLead review) — real personnel names were not fabricated, since that is information only the CTO/Project Engineering can supply; no workstream was marked READY as a result.
- docs/review: added `PROGRAM_RUNTIME_READY_FOR_C0.md`, the final ACTION-01..08 readiness report. Conclusion: `CONFLICT_REMAINING = 0` and `BASELINE_STATUS = SYNCED`, but `OWNER_ASSIGNED = NO` and therefore `C0_READY = NO` — the single remaining blocker is real owner names for C0, not documentation or architecture. No production code was written; C0 authorization for prototypes remains bounded per the C0 plan's scope section.

### Changed — ADR-020: Mekong-owned IEC 61131-3-aligned Program Runtime, CTO decision (2026-07-23)
- governance: CTO Phạm Đình Chương answered decision request Q0–Q9 in `KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md` (now Decided/Closed), resolving the DOC-REV-001 conflict between the corrective design draft and the same-day gap assessment. Recorded as `docs/adr/ADR-020-mekong-owned-iec-aligned-program-runtime.md`: Mekong will build and own its Program Runtime (no third-party/commercial/open-source IEC runtime); Rev A.0 scope is narrowed to a bounded MVP — **ST + FBD only**, with LD and SFC explicitly deferred out of the Rev A.0 release gate; no online change; no PLCopen/IEC "certified"/"compliant" claim (only "IEC 61131-3-aligned" self-description permitted); the legacy 28-node component graph is retained solely as a legacy importer/vendor-FB migration source, never relabeled FBD; firmware/HIL remains an independent release blocker. Only phase C0 (architecture/feasibility, bounded prototypes only) is authorized; C1–C10 production implementation may not start until C0 is reviewed and approved.
- docs/governance: `docs/00_governance/DECISIONS.md` updated — ADR-004 marked `Superseded by ADR-020`, new ADR-020 row added, ADR-006 row annotated to decouple wiresheet-canvas deferral from the language/runtime question, and the blanket "IEC 61131-3... not in Rev A.0 baseline" exclusion line corrected (ST+FBD Program Runtime is now in baseline; LD/SFC/online-change/certification claims/wiresheet canvas remain out).
- docs/product: `docs/01_product/PRODUCT.md` Runtime row and "Ngoài phạm vi Rev A.0" list updated to reflect the Mekong-owned Program Runtime and the narrowed exclusion list; positioning paragraph updated.
- docs/design: `docs/04_design/SOFTWARE.md` adds placeholder `mkddc-program-service`/`mkddc-program-core` service rows (not yet implemented, C1+) and reframes the 28-node component graph section as a legacy importer under ADR-020.
- docs/design: `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` revised to v0.4 applying the CTO decision throughout — language scope narrowed to ST+FBD (§3.1, §5.1, §5.3, §7.1, §7.3), architecture renamed to `libmkddc_iec`/`mkddc-program-service`/`mkddc-program-core` (§4, §4.1), requirements narrowed (§11), release gate G0 moved to YELLOW (§14), RD-IEC-001..007 filled with final decisions and a real approval-log entry (§15), and the vertical-slice plan (§12) condensed to a navigation summary pointing at two new dedicated planning documents.
- docs/planning: added `KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md` (15 bounded workstreams C0.1–C0.15 with owner/input/output/dependency/acceptance/effort/risk/status, including the C1–C10 sizing/resourcing deliverable that closes finding DOC-REV-006) and `KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md` (10 vertical slices — project/artifact registry, typed variables/I/O image, task scheduler, ST parser/IR, ST web editor/build/deploy, standard function library, FBD editor/graph-to-IR, runtime trace/audit, SOM-MCU/HIL, conformance/soak/release — each with goal, component, API/schema, backend/frontend/runtime/firmware tasks, test cases, acceptance criteria, demo scenario, rollback and DoD). Both are blocked/gated: Implementation Plan cannot open until C0's go/no-go (`C0.15`) is Go.
- docs/review: added `KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md` from a repo-wide scan (zero source-code hits; conflict is documentation-only). Catalogs 26 conflicting claims: 9 already fixed in the Active governance corpus (`DECISIONS.md`, `PRODUCT.md`, `SOFTWARE.md`, `ADR-004`) this same pass, and 17 still open in the legacy/In-Review corpus (`docs/01_specs/*`, `docs/00_management/*`, `docs/adr/ADR-006/008/009`, an implementation guide) — flagged as follow-up work that does not block C0. Highest-priority open item: `docs/01_specs/DS_MK-DDC-24_VI.md` has an "IEC 61131-3: Compliant" table cell, a claim ADR-020/RD-IEC-006 explicitly prohibits.
- Documentation-only change across this entire entry; no source code was modified, consistent with the CTO's explicit instruction that C1–C10 production code may not start before C0 is approved.

### Added — IEC 61131-3 corrective design doc review (2026-07-23)
- docs/review: added `KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md`, a structure-and-design review of `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` v0.2. Top finding (DOC-REV-001, P0): the draft's "management corrective directive 2026-07-22" mandating IEC 61131-3 in Rev A.0 has no traceable decision record in `DECISIONS.md` and directly contradicts the same-day, same-baseline `KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md` gap assessment, which recommends keeping Rev A component-based and deferring IEC to Rev C. The review does not resolve which direction wins — that remains RD-IEC-001, a management decision — it only requires the conflict be traceable before either document is treated as authoritative.
- docs/review: re-verified the design doc's §2 gap table against current code (`ProgrammingPage.tsx`, `graph_runtime.cpp`, backend routes, `fw/Core/Src/main.c`); confirmed the head commit is unchanged since the gap assessment (`18ee583`) so no source-level facts moved. Found one additional mismatch not in either prior document: the frontend sample library's `UI_Input` node type has no counterpart at all in the Core 28-node registry (Core only has separate `AI_Input`/`DI_Input`), so the Program page's own sample graph cannot load into `GraphRuntime`.
- docs/design: applied all 7 review findings to `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`, bumping it to v0.3: added an explicit conflict notice and backlink to the gap assessment, declared the document's intentional structural deviation from `TEMPLATE_DDD.md`, added the missing `UI_Input` gap to §2, added a blank approval-log table to §15, and reworked the §12 vertical-slice plan with a Status/Entry-criteria/Owner/Dependency table (everything currently "Chưa bắt đầu", nothing may start before C0 closes) plus a new §12.1 open point flagging that no effort/resourcing/budget estimate exists for the compiler+runtime scope. Also added a reciprocal backlink from the gap assessment to the new review record. Documentation-only change; no code was modified and no `Draft` status was changed to `Active`.
- docs/review: added `KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md`, a fill-in decision-request form consolidating every open question that needs the document owner's answer: Q0 (blocking) asks for the traceable source of the "management corrective directive," Q1-Q7 map to RD-IEC-001..007, Q8 covers the missing sizing/budget estimate, and Q9 captures reviewer identity for the design doc's approval log. Linked from both the review record and the design doc's §15.1.

### Changed — Rev A IEC 61131-3 corrective design (2026-07-22)
- docs/design: rewrote `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` version 0.2 so IEC 61131-3:2025 conformance is a mandatory corrective target in the current Rev A.0 rather than deferred work; the draft explicitly requires Product/requirements/ADR/verification/traceability reconciliation before approval because the active baseline still conflicts.
- program/design: replaced the proprietary-graph closure direction with a detailed ST/LD/FBD/SFC PSE, common IEC type/POU semantic engine, deterministic typed IR, versioned compiler, Core task runtime, Backend project/build/deploy/audit/rollback APIs and authoritative FE state model. The existing 28-node graph is limited to legacy migration or reviewed vendor-function-block implementation and must not be relabeled as FBD.
- fw/design: retained the IOBus/MCU safety boundary and made STM32 IOP, ADC/DAC/relay, watchdog and measured 200 ms safe-timeout HIL evidence a system release blocker for the IEC control path.
- verification: added candidate requirements, normative feature traceability, conformance/target/HIL evidence rules and RED release gates; documentation-only change, with no conformity or certification claim created by this draft.

### Added — IEC 61131-3 Program/SOM FW gap assessment (2026-07-22)
- docs/review: added `KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md`, concluding that Rev A intentionally excludes IEC 61131-3 and must not claim conformity or certification. The report separates PLC-like graph behavior from IEC language/PSE requirements and records the Rev C closure path.
- program/review: recorded P0 gaps that the current Programming page validates only in the frontend, its deploy action is demo-only, no reviewed backend graph validation route exists, and its sample node/port contract diverges from `GraphRuntime`.
- fw/review: confirmed the STM32 source is still a one-file skeleton with placeholder CubeMX configuration and no target/HIL evidence; an ARM ELF build is compilation evidence only.
- verification: isolated GCC 13.3 services build passed with warnings-as-errors and CTest passed 344/344; frontend typecheck and lint passed; the STM32 skeleton compiled in `/tmp` with expected `nosys` syscall-stub linker warnings. These checks do not claim IEC conformity, MCU behavior or release readiness.

### Added — ADR-017 HMI-to-SOM transactional network implementation (2026-07-22)
- fw-som/network: added the privileged `mkddc-netcfg` service and JSON v1 schema with bounded Unix IPC, peer UID checks, Ethernet interface allowlisting, active kernel state, static/DHCP validation, duplicate-address preflight, atomic transaction journal, make-before-break static apply, explicit confirm/rollback and automatic rollback after at most 120 seconds. Fixed-argument `execv` calls are used for `ip`, `arping` and NetworkManager; no request field is evaluated by a shell.
- hmi/broker: added the Go broker adapter and C++ HMI client/model/UI for `status → stage → apply → confirm/rollback`. Network mutations require Admin, are audited/idempotent at the broker boundary, display active versus pending address and countdown, and fail closed when the helper is absent. The HMI unit is explicitly denied direct access to `netcfg.sock`.
- fw-som/bacnet: added IPv4 address change detection and BACnet/IP datalink-only rebind with a new `I-Am`; the iobus process, IOP/UART owner, shared memory and Core control path remain running.
- packaging: added the hardened `mkddc-netcfg.service`, Orange Pi Ethernet allowlist config (`end1`), install wiring and HMI service dependency/hardening.
- verification: HMI-enabled host build and CTest pass 366/366; BACnet-enabled build and netcfg CTest pass 10/10; Go vet/backend tests pass; JSON schemas, installer shell syntax and diff checks pass. Target evidence is in `KX-DDC24-HMI-FWSOM-DEPLOY-2026-07-22.md`; lack of a connected DSI/touch panel cannot be treated as HMI usability acceptance.
- hmi/portability: replaced fixed-buffer point-ID formatting after the Orange Pi GCC 12 Release build correctly raised a `-Wformat-truncation` error under `-Werror`; point IDs remain canonical `AO-01`/`DO-01` without a truncation path.
- deploy/orangepi: added a reproducible `mkddc-web-pi` systemd drop-in so the deployed broker orders after `mkddc-netcfg` and receives the explicit helper socket; HMI ordering recognizes both generic and board Web unit names.
- deploy/orangepi: aligned application owners of shared `/run/mkddc` to mode `0770`, then moved the privileged helper to dedicated `/run/mkddc-netcfg` (`root:mkddc 0750`, socket `0660`). This prevents Core/IOBus RuntimeDirectory restarts from recursively changing helper-socket ownership while preserving broker access and HMI direct-path denial.
- deploy/orangepi: deployed native aarch64 HMI/Core/IOBus/netcfg plus the arm64 Web broker, kept HMI disabled because the identified board has no compatible DRM/touch hardware, and recorded artifact hashes plus rollback backup in `KX-DDC24-HMI-FWSOM-DEPLOY-2026-07-22.md`.
- verification/target: Orange Pi CTest passed 367/367 (3 production-SHM skips) and final netcfg retest passed 10/10; real isolated NetworkManager transactions passed static confirm, helper restart recovery, explicit rollback and 120 s automatic rollback. UID/interface/HMI-direct-path denial passed; Web/Core/IOBus PIDs stayed stable, IOP/SHM remained normal/reliable and BACnet performed datalink-only hot-rebind. Physical panel, STM32, `end1`/BMS packet and Web FE evidence remain RED.
- deploy/config: migrated two legacy empty `schedule.conf` skeleton rows (`cells:null`) to disabled `not_active` rows after the Core restart test exposed `schedule_cfg.bad_required`; preserved the original in the deployment backup and verified Core loads both rows without disabling the scheduler.

### Changed — ADR-017 safe network commissioning documentation and implementation plan (2026-07-22)
- docs/architecture: separated desired `network.conf` from active Linux state, recorded the current `applySystem()`/frontend truthfulness gap, and approved a narrow SOM `mkddc-netcfg` authority with versioned local IPC, least privilege, staged apply/confirm, last-known-good and automatic rollback within 120 seconds. IP change must not stop Core/IOP/STM32 control; BACnet must hot-rebind without restarting the whole iobus process.
- docs/hmi: allowed Service-only Ethernet IPv4 static/DHCP commissioning as a narrow ADR-017 exception inside the existing five-surface local HMI; added active/pending/countdown/confirm/rollback UX and UC-HMI-016..019 while keeping Wi-Fi/protocol/full engineering out of the panel.
- docs/plan: the `04e2e4d` docs-only checkpoint added FW SOM microtasks NWC-000..017 with dependency waves/effort estimates and BE/FE contract handoff, plus local-HMI microtasks HNW-000..013. Source was still planned at that checkpoint; the implementation/deployment entries above supersede its execution status while physical release gates remain RED.
- verification: updated requirements, interfaces, verification findings, operations and traceability; verification for this docs-only change is the ISO/docs harness when available, Markdown link scan and `git diff --check`.

### Added — ADR-016 limited-operator HMI host implementation (2026-07-22)
- hmi: replaced the legacy six-screen/service-PIN prototype with five `Home/Points/Control/Alarms/Service` surfaces, a bounded Unix-socket client, broker-authoritative login/policy/alarm ACK and AO/DO Control with explicit confirmation, reason, TTL, release and effective-source display. Monitoring remains read-only SHM; broker loss marks command authority OFFLINE, periodic query reconnects without replay, and mutations remain fail closed.
- web/security: added the local HMI v1 broker on `/run/mkddc/hmi-api.sock` with `0660` permissions, `SO_PEERCRED`, optional UID allowlist, Viewer/Operator/Admin RBAC, opaque idle-expiring sessions, login rate limiting, bounded frames/connections/idempotency and durable append-only JSONL mutation audit without credential/token logging.
- core/control: extended the existing Core IPC with authoritative point query, finite/range/TTL validation, bounded request-ID cache, effective winner/source response and Core-owned monotonic override expiry/release; safety/interlock priority remains authoritative.
- hmi/privilege: removed static config role/PIN/service-switch authority, direct core/iobus signaling, direct reboot and `CAP_SYS_BOOT`; unsupported maintenance actions remain hidden pending a separately approved authority.
- docs: aligned HMI design, interfaces, microtask guide, verification, traceability and the HW/FW/SOM/HMI review report with the implemented protocol and retained the production gate as RED pending process-loss, target/HIL and operator-usability evidence.
- verification: HMI-enabled Debug build and HMI CTest 20/20 pass; Core CTest 172/172 pass; `go vet ./...` and `go test -count=1 ./...` pass; HMI race subset pass; real broker UDS + real `CoreClient`/Core-socket-stub lifecycle, Core-loss/no-replay, explicit retry and broker-restart session invalidation pass; protocol schema parses; unsafe-privilege source scan has no finding; hardware-doc/link harness 18/18 and `git diff --check` pass. These host results do not claim IEC conformity or target/HIL acceptance.

### Changed — Latest-main reconciliation merge (2026-07-22)
- repository: fast-forwarded local `main` to `origin/main` at `9ca78bf`, then merged controller/document reconciliation commit `bf8c2d0`; preserved the current alarm, scheduler, Virtual Point and frontend work from main.
- merge: resolved `CHANGELOG.md` by retaining both histories and kept the SHM v4 IOBus layout assertions at `ui_unit=176`, `ui_raw_unit=304`, size `528`.
- verification: merged-tree builds passed for Core baseline/BACnet and IOBus baseline/Modbus; CTest passed Core 169/169 in both configurations and IOBus 160/160 plus 162/162; `go test -count=1 ./...`, frontend lint/typecheck/production build, hardware-doc harness 18/18 and `git diff --check` passed.
### Changed - Frontend point configuration and navigation bundle (2026-07-23)
- frontend(points): align UI/AO/DO/VP tag and label semantics, add conflict recovery and normalization, and cover the shared namespace behavior with unit and browser regressions.
- frontend(configuration): add overview and advanced editing flows, persist dashboard trend selections for up to four arbitrary points, and require confirmation before saving Outputs or Virtual Points.
- frontend(navigation): add the Help FAQ and header routes, streamline/collapse the sidebar, remove duplicate User info navigation, and compact the device summary.
- frontend(trends): clarify cache/database history routing, UTC custom ranges, canonical point identities, live-tail presentation, and missing-series feedback.
- verification: frontend Vitest passes (`21` files, `109` tests); ESLint (`--max-warnings=0`), typecheck, and production build pass.

### Changed - Historian Trends source routing (2026-07-22)
- web/backend(historian): added a durable-seeded, in-memory 15-second presentation cache retained for 24 hours. `source=cache` reads only this cache (no SQLite read-through); `source=database` reads hot SQLite/archive only; source-less callers keep the existing unified compatibility merge. Startup warmup uses the last 24 hours of durable hot rows, while live cache sampling now also consumes coherent runtime snapshots independently of database logging policy.
- frontend(Trends): `Auto`, `30 min`, `1 hour`, `6 hours`, and `24 hours` send `source=cache`; `Custom` sends `source=database`. Live builds use v2 by default after activation while demo remains legacy-generated and `VITE_HISTORIAN_V2_TRENDS=0` remains an explicit rollback switch. OpenAPI, ADR-018, Plan 42 v1.20, web guide and task checklist now document the split and rollout state.
- resource budget: reserved 16 MiB for raw RAM tail plus 48 MiB for the presentation cache, preserving the 64 MiB historian RAM ceiling.
- Verification (code-local so far): focused backend query/cache tests pass, including warmup/no-read-through, durable-sink ordering, source routing and 64 MiB budget; focused frontend Vitest `15/15` passes. Full backend/FE gates and board rollout/24-hour soak remain pending.
- Verification (2026-07-22 continuation): backend `go test -count=1 ./...` (`55.447s`), `go vet ./...`, `go build ./...`, frontend Vitest `56/56`, lint, typecheck and production build pass; OpenAPI parses as 3.1.0/version 1.8.0 with 42 paths and `source` parameters. Windows race-focused run remains blocked by the installed 32-bit MinGW C compiler; WSL has no Go toolchain.
- deploy(board): created coherent schema-v5 checkpoint window `historian-trendscache-20260722T034500Z` (checkpoint SHA `91404dbe...`), ARM64 native package parity (8 unchanged artifacts, manifest SHA `520f02ea...`), and isolated cache/database canary. Atomic web+dist rollout succeeded on retry after correcting the unit's actual `PORT=8081`; first wrong-port probe rolled back cleanly. Candidate SHA `319236d0...`, `login=200`, unauthenticated status `401`, all services active with `NRestarts=0`, 30-second `hotDelta=+4/gapDelta=0/legacyDelta=0`, RSS `31,524 KiB`, and no storage conflict/overflow/SQLITE_BUSY warnings.
- soak(board): the initial read-only `mkddc-historian-soak-trendscache.service` ran from `2026-07-22T04:01:50Z` to `06:49:50Z` and was stopped cleanly for the owner-approved all-point cache rollout. Its immutable summary records `complete=false`, 169 samples, zero service/restart/hash/integrity/authority/storage violations, `legacyDelta=0`, and 310 known Core warnings; it is incomplete evidence, not a passed 24-hour gate.
- test(frontend/browser): added a Chrome Playwright live-mode fixture that selects `UI-01`, `AO-01`, `DO-01`, and `VP1`; proves `30 min`/`1 hour`/`6 hours`/`24 hours`/`Auto` use `source=cache`, `Custom` uses `source=database`, and checks cache gap/partial plus database-complete rendering. This closes the automated browser slice only; it does not claim the non-UI-01 physical channels ran on the board.
- frontend(a11y/responsive): modal dialogs now trap Tab/Shift+Tab, close on Escape, and restore focus through an explicit opener ref; the mobile TopBar hides secondary controls and prevents horizontal overflow at 390 px. Added `test:e2e` while keeping Vitest scoped to `src/` so the runners do not collect each other's suites.
- Verification (browser continuation): Playwright Chrome `1.61.1` `2/2` passes (`56.2s`), including UI/AO/DO/VP, source routing, gap/partial, keyboard/focus and mobile viewport checks. Vitest remains `56/56`; lint, typecheck and production build pass; full frontend `npm audit --audit-level=high` reports zero vulnerabilities after updating transitive `brace-expansion` to `5.0.7`; `git diff --check` passes with only the pre-existing `PointCard.tsx` CRLF warning. No board service, historian authority or soak process was changed.

### Fixed - Trends preset cache all-point visibility (2026-07-22)
- web/backend(historian-cache): decoupled the live 24-hour presentation cache from database logging policy. The existing scheduler snapshot now samples every valid numeric/boolean UI/AO/DO/VP into 15-second cache buckets, so selected points such as UI-02/UI-06 no longer disappear merely because only UI-01 has a database policy. The same coherent snapshot is reused, avoiding another Core IPC client; `source=database` remains cache-free.
- web/backend(query): cache-source identity discovery now includes runtime-only cache identities for the requested range while database/source-less identity discovery remains durable/RAM-owned. Cache rows preserve generation, quality, source, aggregation and the existing 48 MiB eviction ceiling.
- test(backend): added RED/GREEN coverage with a database policy for UI-01 only and runtime snapshots for UI-01/UI-02/UI-06, plus a scheduler case proving the cache samples all three when the database policy is not due and database source excludes the runtime-only identities. Focused tests pass; final full `go test -count=1 ./...` passes (`53.653s`), with `go vet ./...` and `go build ./...` also passing.
- Verification (frontend continuation): Vitest `56/56`, lint, typecheck and production build pass; Playwright Chrome `1.61.1` `2/2` passes (`1.6m`) with the UI/AO/DO/VP cache/database routing contract still green. The Vite `ECONNABORTED` messages occur only while the test web server closes proxy sockets after passing cases.
- deploy(board): window `historian-trendscache-allpoints-20260722T065257Z` captured an online schema-v5 checkpoint (`quick_check=ok`, SHA `222234b4...`) and forward-compatible rollback binary (`319236d0...`). Candidate `f666b3cb...` passed native Linux/ARM64 legacy+active schema-v5 parity with five immutable artifact families and an isolated `:18081` canary (`login=200`, unauthenticated status `401`) before the backend-only rollout.
- verification(board): the approximately nine-second `mkddc-web-pi` rollout completed without invoking automatic rollback; web/core/iobus are active with zero restarts, authority remains `active/v2`, prune remains disabled, legacy rows remain `596,284`, and the bounded postdeploy journal has zero snapshot/Core/SQLite conflict warnings. Authenticated `source=cache` returned `UI-01/UI-02/UI-06` with `19/13/13` recent samples and cache-only tiers; the same recent `source=database` query returned only persisted `UI-01` with a hot tier, preserving Custom database ownership.
- soak(board): started replacement unit `mkddc-historian-soak-allpoints-20260722t065257z.service` at `2026-07-22T07:07:02Z` for 24 hours at 60-second cadence. Its first sample has candidate SHA `f666b3cb...`, all services active with zero restarts, `quick_check=ok`, `legacyCount=596284`, and zero storage/Core warnings. The soak remains running, so the 24-hour, physical I/O, power-cut, eMMC/endurance and full E2E gates remain open.
- docs/evidence: added the incomplete prior-soak summary, ARM64 package manifest, postdeploy source-routing JSON and replacement-soak start record under `docs/00_management/evidence/historian/`; no prune, migration rerun, legacy deletion or schema downgrade occurred.
- frontend(Trends): realtime preset tables now use the live runtime point value for `Current`, refreshed by the existing 1-second point poll/WebSocket merge, while `Average`, `Minimum`, `Maximum`, and sample counts remain historian-cache aggregates. Custom tables continue to use database samples only.
- Verification (2026-07-22): added a regression proving realtime `Current` advances to the live point value while Custom retains the latest database sample; Vitest `57/57`, lint, typecheck, and production build pass.
- deploy(board/frontend): window `frontend-trends-table-1s-20260722T072257Z` checkpointed the previous eight-file dist tree (`87fc2980...`), atomically published candidate tree `3163d407...`, and retained a matching rollback tree. `/login` and `assets/index-Xej4g6MM.js` returned `200` with asset SHA `4e344029...`; backend/Core/I/O and the historian soak kept their existing PIDs with zero restarts.
- docs/evidence: Plan 42 v1.25 records the 1-second live `Current` cadence separately from the 15-second cache aggregation contract; board postdeploy evidence is persisted in `docs/00_management/evidence/historian/frontend-trends-table-1s-postdeploy-2026-07-22.json`.
- frontend(Trends live-tail): preset/Auto chart data now appends a transient runtime sample on every 1-second point refresh, so the visible trend table/chart advances between 15-second cache buckets without persisting browser-owned history. Custom remains database-only; cache Average/Minimum/Maximum/sample counts remain 15-second aggregates.
- frontend(HTTP): `/api/v1/points` polling now requests `cache: no-store` so browser/proxy freshness cannot mask the one-second runtime cadence.
- Verification (2026-07-22): Vitest `58/58`, lint, typecheck, production build, and Chrome Playwright `2/2` pass, including the live-tail/cache-vs-database regression. Fresh Chrome against the board loaded `assets/index-WSSWDfxC.js`; live history timestamps advanced at approximately 1-second intervals (`702, 1806, 2791, 3787, 4789 ms`) and the Custom table contained no live tier.
- deploy(board/frontend): atomic window `frontend-trends-live-tail-20260722T074700Z` published the eight-file dist tree (`e57347d1...`) with asset SHA `8003863505693bf8dd336a69f112a99d9ce40bcd28ac105e3ad78bcd5881dea4`; `/login=200`, asset `200`, served SHA matched, rollback tree matched checkpoint (`5f9e234b...`), and web/Core/I/O plus the all-point soak kept their existing PIDs with `NRestarts=0`.
- docs/evidence: postdeploy behavior, runtime API trace, browser tick capture, service invariants, checkpoint and rollback paths are recorded in `docs/00_management/evidence/historian/frontend-trends-live-tail-postdeploy-2026-07-22.json`.

### Fixed - Frontend CI lockfile synchronization (2026-07-22)
- frontend(ci): regenerated npm 10 lock metadata so `npm ci` resolves the required `@emnapi/core` and `@emnapi/runtime` peer/optional packages; transitive `brace-expansion` remains patched at `5.0.7`. Verification: `npx --yes npm@10.9.8 ci --ignore-scripts --dry-run` passes.

### Fixed - Core IPC status-probe pressure (2026-07-22)
- web/backend(core-status): `ReadStatus` now treats valid PLC shared-memory scan state as primary Core liveness evidence and only opens `core.sock` as a fallback when that evidence is unavailable. This removes a dial-only client from each health poll while retaining the existing socket fallback and IOP/scan error semantics.
- test(backend): added a regression with valid PLC/IO shared memory and a listening Unix socket. It failed before the fix because status probed the socket, and now proves `CoreAvailable=true`, the scan counter is read, and the socket receives no connection. Focused RED/GREEN passes; full `go test -count=1 ./...` passes (`54.471s`), with `go vet ./...` and `go build ./...` also passing.
- evidence(board): a pre-rollout bounded sample found `27` `alarms_read degraded` warnings in 30 minutes and, over five minutes, `360` accepted IPC connections including `300` `alarm_list` calls. The shared-memory-first status fix shipped in candidate `f666b3cb...`; the bounded postdeploy journal through the all-point cache verification has zero `alarms_read degraded`/`core unavailable` warnings. This short window is encouraging but does not close runtime-source stability until the replacement 24-hour soak completes.

### Fixed - Historian durable-frontier conflict recovery (2026-07-22)
- web/backend(historian-scheduler): prevent a late RAM aggregate at or behind an identity's durable frontier from poisoning every subsequent immutable hot-store batch. Durable SQLite rows remain unchanged, no historical backfill is attempted, and newer buckets can continue after clock-discontinuity/retry state leaves a divergent stale aggregate in `pendingHot`.
- test(backend/core): added a production-shaped scheduler regression with an existing durable bucket, a divergent in-memory copy and a newer due cycle. It failed before the fix with `hot sample conflict` and now preserves the durable row, commits the new frontier and removes the poison row. Backend `go test -count=1 ./...` passes (`63.630s`), `go vet ./...` and `go build ./...` pass; WSL Core build and `212/212` tests pass, including WebIpc slot-reclamation, half-close and budget coverage.
- board(baseline/package): read-only evidence found schema v5 `quick_check=ok`, evidence-bound `active/v2`, prune disabled and legacy count `596,284`; the stuck writer emitted conflict every five seconds and overflow gaps while hot frontiers lagged by about 16 hours. Window `historian-conflictfix-20260722T023931Z` captured an online checkpoint and binary/config hashes before mutation. ARM64 current/rollback SHA-256 `8d756f593eda7978072673b911c37a984956537c245078cc73348192b2b9136e` passed native legacy+active schema-v5 parity with eight immutable artifact families; package manifest SHA-256 is `3c85ae4f9de7a54d7f75d6d0c9f3f2f6108e6745498047f9dec335d76a49b030`.
- board(rollout/verification): isolated canary advanced AO-01/UI-01 without conflict, then an approximately eight-second atomic web rollout deployed the candidate while retaining forward-compatible SHA `dcd171d3...` in the checkpoint. Post-rollout services are active with zero restarts; rollback verification remains evidence-bound; a 30-second sample produced `hotDelta=+4`, `gapDelta=0`, `legacyDelta=0`; authenticated history returned `200`, `complete=true`, three samples and zero gaps. The bounded journal contained no historian conflict/overflow, `alarms_read degraded`, `core unavailable`, `SQLITE_BUSY`, but long soak and remaining physical/E2E gates stay open.
- docs/evidence: added predeploy checkpoint, ARM64 package and postdeploy JSON evidence with matching board/repo hashes `1c5974dd...`, `3c85ae4f...`, and `a3609d04...`; reconciled the board cutover record and Plan 42 v1.18 without marking the release Done.

### Changed - Historian board activation and restart-gap hardening (2026-07-21)
- board/historian: completed the bounded production cutover on Orange Pi window `historian-cutover-20260721T082943Z`: coherent emergency/final backups, schema `1 -> 5`, frozen 77-ID mapping, `596,284/596,284` accepted rows, zero rejections, consumed quiesce proof, evidence-bound `active/v2` writer/query authority, and legacy writer quiescence. Prune remains disabled and no legacy file/code was removed.
- web/backend(config): atomic config replacement now preserves an existing Unix owner/group when invoked as root. This prevents offline activation from replacing `mkddc:mkddc` `historian.conf` with an unreadable root-owned mode-0600 file. Added a Linux root regression; Windows full test/vet/build and Linux root-specific execution pass.
- web/backend(runtime): active startup now prepares `scheduler_restart_no_backfill` evidence before the first historian cycle and retries fail-closed if the gap write is unavailable. Added runtime-wiring coverage beyond the existing scheduler-unit test.
- board/gap: reconciled the maintenance outage only after a coherent pre-change checkpoint and zero-overlap hot-row proof, recording explicit UI-01/AO-01 generation-1 `[from,to)` restart gaps. A later controlled 20-second restart produced two automatic scheduler restart gaps on the final binary.
- board/package: final ARM64 current/rollback binaries are byte-identical at SHA-256 `dcd171d35bfb3ccfedf4087726b0d1fe11b18b0ece90f1a7b7ce405cc8ffa52a`; native legacy/active schema-v5 package gate and six immutable artifact families pass, manifest SHA-256 `47cbfcb0b6fea44aff4ede381f9608ea95157311260a0df483a8180189b81f88`.
- verification: final board services are active with web `NRestarts=0`; legacy rows remain fixed while v2 hot rows advance; live schema-v5 rollback verification is evidence-bound; `/login=200`, unauthenticated status `401`, authenticated Trends config `200`, and an aligned unified history window is `complete=true`. A later five-minute sample still showed recurring core IPC degradation and explicit `snapshot/read_failed` gaps, so physical power-cut, runtime-source stability, browser/manual E2E, 48-hour boundary, eMMC endurance/write-amplification and long soak remain open; Plan 42 is not release-Done.

### Added - ARM64 rollback preflight and activation fault coverage (2026-07-21)
- test(board/historian): cross-built separately named Linux/ARM64 current and rollback binaries (`CGO_ENABLED=0`), executed both on Orange Pi `/tmp` against a coherent frozen copy of the live historian DB, and captured [arm64-rollback-preflight-2026-07-21.md](docs/00_management/evidence/historian/arm64-rollback-preflight-2026-07-21.md). Both binaries rejected the board's schema-v1 fixture with exit code `1` because schema v5 is required; fixture SHA stayed unchanged. This is fail-closed preflight evidence, not a GREEN parity/cutover result; no service or persistent board data was changed.
- test(backend/activation): added restart-forward coverage for injected faults after prepare and after SQLite active; prepared state remains pending until explicit forward commit, while post-active recovery keeps v2 writer/query authority and forbids legacy writer. Verification: focused activation/fault/archive/migration/recovery/scheduler matrix `count=10` passes (`41.847s`); frontend Vitest `52/52`, lint, typecheck and production build pass.
- docs(historian): reconciled Plan 42 v1.16, phase plan v1.22, web guide v1.31, checklist v1.46 and ADR-018 v1.11 with ARM64 schema-v1 fail-closed evidence, frozen schema-v5 package parity GREEN, native manifest, and remaining live-board blockers. Physical power-cut, target eMMC/endurance, browser/manual E2E and production cutover remain open.
- test(board/storage): captured a read-only Orange Pi baseline (`29.3 GB` filesystem, `15.27 GB` free, historian DB/WAL/SHM `77,824/40,960/32,768` bytes, web RSS `30,872 KiB`, core RSS `5,336 KiB`). `mmc extcsd` exposed no life/pre-EOL telemetry and no live `fio` workload was run; this is not an eMMC capacity/write-amplification/endurance GREEN result.
- test(board/smoke): read-only board smoke returned `/login=200`, unauthenticated `/api/v1/system/status=401`, and active core/iobus/web services, but the journal showed repeated legacy `SQLITE_BUSY` writes from `virtual_points.sample` and `trend.sample`; storage health remains non-GREEN and cutover is blocked.
- test(board/soak-audit): confirmed the existing 24-hour time/service soak completed at `2026-07-21T02:40:45Z` with all services active, NTP normal and disk at `48%`; final windows still reported roughly `167..199 SQLITE_BUSY/2m`. This is supporting service/time evidence only and fails historian storage-health acceptance.
- web/backend(legacy-storage): serialized all legacy TrendStore mutations behind the existing authority fence so physical/VP samplers, prune and config writes cannot open competing SQLite write transactions. Added a 64-writer regression alongside quiesce/resume coverage; focused TrendStore suite `count=10` passes (`8.360s`). The fix is code/local only and has not been deployed to the board, so observed board `SQLITE_BUSY` remains an open rollout gate.
- test(board/arm64): rebuilt the intermediate post-serialization pair for ARM64; both binaries rejected the board schema-v1 frozen fixture with exit code `1`, and its SHA stayed unchanged. This pair is superseded by the final prebuilt-package pair recorded next.
- web/backend(packaging): added `--current-binary` + `--rollback-binary` prebuilt-native mode so a board without Go can verify packaged artifacts and emit its own manifest. Final ARM64 board run over isolated schema-v5 legacy/active fixtures is GREEN: both binaries SHA-256 `440aae2b3377e3fa65373663d59aecc5abfaf1fd28aa3cc4eb51bfee0835a39c`, 4 artifact families unchanged, manifest SHA-256 `047470cd6c67efb855a09e37b2e8f103b436d35d2e500cf0023804b3c84e0578`. Final focused package suite passes (`29.144s`); final backend `go test -count=1 ./...` passes (`62.241s`), `go vet ./...` and `go build ./...` pass. Live board schema-v1 fail-closed and `SQLITE_BUSY` blockers remain.
- test(board/canary): started the final ARM64 binary in an isolated `/tmp` runtime on port `18081` with separate config/TrendStore and a frozen schema-v5 active fixture. It listened successfully, returned `/login=200` and unauthenticated status `401`, preserved fixture SHA, exited cleanly on `SIGTERM`, and removed all temporary files. The expected `policy mirror pending` warning from the deliberately mismatched minimal policy keeps authority fail closed; production service and data were untouched.

### Added - Native historian rollback package parity gate (2026-07-21)
- web/backend(packaging): added `historian-rollback-package` to independently build native current and rollback-candidate binaries with deterministic flags, require byte/build-target parity, record SHA-256/size/Go toolchain and build settings, and atomically publish `historian-rollback-package-evidence.json` without overwriting existing release evidence.
- web/backend(rollback-safety): the package gate executes both binaries against repeatable schema-v5 fixtures, snapshots the complete SQLite sidecar family plus supplied archive/evidence files before and after, rejects symlinks/file-set changes/mutations, bounds verifier output and refuses non-native target claims. Frozen rollback fixtures now open with SQLite `immutable=1` in addition to read-only/query-only controls so verification creates no WAL/SHM evidence side effects.
- test/docs(historian): added a real subprocess gate covering separately built binaries, legacy and active schema-v5 authority, frozen WAL-sidecar and archive/evidence immutability, plus required-input rejection; reconciled ADR-018 v1.9, Plan 42 v1.14, phase plan v1.20, web guide v1.29 and checklist v1.44. Verification: focused package gate passes (`28.161s`); full backend `go test -count=1 ./...` passes (`56.295s`), `go vet ./...` and `go build ./...` pass. ARM64/board package execution, power-cut rehearsal, production cutover, automatic prune scheduling, target eMMC and E2E remain open.

### Added - Schema-v5 rollback compatibility verifier (2026-07-21)
- web/backend(rollback): added a strictly read-only `VerifyHistorianRollbackCompatibility` gate and `historian-rollback-verify --db <fixture>` subcommand. It requires schema v5, `quick_check=ok`, the activation/evidence/quiesce tables and exact active marker → migration/policy/backup/quiesce evidence joins; it never calls migrations or activation reconciliation.
- test(backend): added legacy, safely active, future-schema and bounded-JSON command fixtures. Active fixtures keep legacy writer forbidden, legacy fixtures remain resumable, unsupported schema fails closed, and before/after SHA-256 proves verifier access does not mutate the DB. Verification: focused rollback/maintenance CLI suite `count=10` passes (`8.749s`); full `go test -count=1 ./...` passes (`24.209s`), `go vet ./...` and `go build ./...` pass. Packaged rollback-binary hash/parity and board rehearsal remain open.

### Added - Offline historian maintenance operator CLI (2026-07-21)
- web/backend(cli): added `historian-maintenance` as a manual-only binary subcommand with required immutable manifest template, separate final-manifest output, final backup, stable UTC, matching window ID and exact `ACTIVATE-HISTORIAN-V2` confirmation. It emits a bounded JSON result and never exposes an HTTP route or enables prune scheduling.
- web/backend(cli-safety): normal server mode now publishes an owner-only `mkddc-web.running` presence file. Offline cutover refuses while that file exists, restricts backup/final-manifest writes to `historian-v2-migration`, requires a fresh legacy authority state and rejects manifest/window mismatch, invalid UTC, unknown args and unsafe timeouts.
- test(backend): added RED/GREEN parser and offline preflight coverage for confirmation, UTC, timeout, service-presence cleanup, path containment and operation identity. Verification: focused CLI/maintenance/write-fence suite `count=10` passes (`9.577s`); full `go test -count=1 ./...` passes (`33.658s`), `go vet ./...` and `go build ./...` pass. CLI has not been invoked on the board; rollback-binary compatibility, power-cut rehearsal, target eMMC and E2E remain open.

### Added - Maintenance-only historian cutover orchestration (2026-07-21)
- web/backend(historian-maintenance): added an explicit operator-only sequence that write-fences the legacy TrendStore, stops and waits both physical and Virtual Point legacy samplers, creates/reuses a verified final native backup, freezes the migration manifest from that backup, migrates the complete source snapshot, records quiesce-bound durable evidence, writes generation-aware maintenance gaps, then runs activation prepare/commit. No startup or public HTTP path invokes it.
- web/backend(lifecycle): added durable schema-v5 quiesce epoch/token state, tracked sampler cancellation/wait, WAL checkpoint fencing and a separate `LegacyWriterAllowed` authority gate so degraded post-activation state cannot restart legacy writers. Backup failure resumes legacy and abandons the proof; after prepare/commit begins, recovery remains forward-only.
- test(backend): added maintenance happy-path ordering/authority/gap assertions, invalid-backup rollback/resume coverage, stale-proof invalidation and TrendStore write-fence tests. Verification: focused maintenance/lifecycle/migration suite `count=10` passes (`24.770s`); full `go test -count=1 ./...` passes (`25.981s`), `go vet ./...` and `go build ./...` pass. Production invocation, board maintenance cutover, legacy removal, automatic prune scheduling, target eMMC/power-cut and `E2E-HIST-001` remain open.

### Changed - Evidence-bound historian activation (2026-07-21)
- web/backend(historian-activation): added schema-v4 `historian_cutover_evidence` with immutable migration/manifest/policy bindings, native-backup SHA/schema/quick-check/size evidence, deterministic full-keyspace source digest, migration outcome digest and accepted/rejected coverage counts.
- web/backend(historian-activation): activation preparation and reconciliation now revalidate the durable evidence row, migration phase, manifest checksum and verified policy mirror; caller-supplied `MigrationVerified` no longer grants authority. Backup publication fsyncs the completed file before hard-link commit, and active config checksum/revision is rechecked before runtime writer/query authority.
- test(backend): added RED/GREEN coverage for missing evidence, caller-boolean bypass, migration-phase mutation, idempotent evidence recording, active-config corruption and authority fail-closed behavior. Verification: focused evidence/activation suite `count=10` passes (`10.638s`); full `go test -count=1 ./...` passes (`25.056s`), `go vet ./...` and `go build ./...` pass. Production final backup/quiesce invocation, prune scheduling, legacy removal, target eMMC/power-cut and E2E gates remain open.

### Added - Historian activation transaction and boot reconciliation (2026-07-21)
- web/backend(historian-activation): added a TDD `Prepare -> filesystem commit -> SQLite active -> boot reconcile` coordinator. Preparation validates the verified policy revision/digest, persists SQLite `prepared`, checkpoints WAL, writes owner-only prepared policy plus metadata, and keeps legacy authority while uncommitted.
- web/backend(historian-activation): the exact policy bytes are published through a strict fsync-temp/atomic-rename/parent-sync commit point. A crash after filesystem commit leaves durable metadata; restart verifies revision/checksum and idempotently promotes SQLite to `active`. Mismatch or an uncommitted prepared policy remains fail-closed with `ErrHistorianActivationPending`.
- web/backend(authority): startup now reconciles activation before recording immutable runtime authority. Legacy sampling is suppressed only when an active v2 writer marker is present, and unified v2 query construction now requires active query authority instead of readiness alone. No activation marker is created by default, so existing deployments remain legacy/shadow.
- test(backend): added activation commit, post-rename fault recovery and uncommitted-prepared fail-closed tests. Verification: full `go test -count=1 ./...` passes (`27.675s`), `go vet ./...`, `go build ./...`, and `gofmt` pass; `git diff --check` remains clean apart from the existing unrelated `PointCard.tsx` line-ending warning. Production activation invocation, durable final-backup/full-migration evidence binding, target eMMC/power-cut testing, prune scheduling and legacy removal remain open.

### Changed - Physical historian rolling-prune engine (2026-07-21)
- web/backend(historian-retention): implemented a bounded physical rolling-prune engine behind a durable activation proof. It uses a SQLite prune queue, transactionally hides only committed archive prefixes, rebases/removes exhausted watermarks, validates archive checksum/codec before deletion, fsyncs the archive directory, and retries idempotently after an interrupted unlink or metadata phase.
- web/backend(historian-retention): expires hot samples and fully expired history gaps with the same identity/cutoff lease, preserves exact `[cutoff,...)` boundaries and generation isolation, and uses the latest persisted retention lease for deleted/recreated generations. A persisted stable UTC horizon rejects backward movement; readiness/shadow without reconciled `v2` authority returns `ErrHistorianRetentionDeferred` and deletes nothing.
- test(backend): added TDD coverage for activation guard, prefix/frontier rebase, all-tier expiry, bounded retry after metadata fault, backward stable UTC, corrupt archive fail-closed behavior, cancellation and v2→v3 migration. Verification: focused retention/migration suite `count=10` and full `go test -count=1 ./...` (`25.592s`), `go vet ./...` and `go build ./...` pass; `git diff --check` exits clean apart from an existing unrelated `PointCard.tsx` line-ending warning.
- docs(historian): physical prune engine is now DONE code/local, while execution remains inactive until filesystem activation/cutover reconciliation, final migration/legacy quiesce, target eMMC capacity/write-amplification/endurance benchmark and E2E gates are GREEN.

### Changed - Historian interval-bounded rolling retention amendment (2026-07-20)
- web/backend(historian-policy): added optional per-point `retentionDays`, deterministic Rev A maximums (`1s=30d`, `3s=60d`, `5s=90d`, `15s=180d`, `30s=365d`, `1m=730d`, `3m=1095d`, `5m=1460d`, `15m=1825d`, `30m=2555d`, `60m=3650d`), selected/maximum fields in policy snapshots, top-level `retentionMaxDaysByInterval`, atomic `historian_retention_invalid` rejection and retention-scaled capacity reserve projection.
- web/backend(historian-store): migrated the readiness store from schema v1 to v2 so mirrored policies accept any positive selected retention, preserve existing 180-day rows and retain a `1s/30d` policy across restart. Physical archive retention prune remains an explicit activation hook: readiness/shadow mode returns `ErrHistorianRetentionDeferred` and deletes nothing.
- fe(logging-control): added retention presets plus custom-day input, interval-aware maximum/fallback validation, read-only/control summaries, structured field focus/ARIA alerts and explicit copy that old data is only eligible for safe prune after v2 activation. Fine `1s|3s|5s` raw detail remains bounded to the RAM tail; current long-term archive data is folded to 15-second aggregates.
- docs(historian): reconciled OpenAPI 1.7.0, config schema Rev 2.1, ADR-018 v1.2, Plan 42 v1.7 and phase/guide/checklist status. The fixed maximum table is a product cap, not measured storage proof; target eMMC capacity, write amplification/endurance, physical prune, activation/cutover and full E2E remain open.
- Verification: frontend Vitest `52/52`, lint, typecheck, default build and `VITE_HISTORIAN_V2_TRENDS=1` build pass; backend `go test -count=1 ./...` passes (`28.408s`), `go vet ./...` and `go build ./...` pass; OpenAPI parses as 1.7.0 with 42 paths and retention/error contracts present; repository `git diff --check` exits clean.

### Added - WEB-HIST-005 shared Logging Control and feature-gated unified Trends (2026-07-20)
- fe(logging-control): added one reusable UI/AO/DO/VP database logging control with textual `off|scheduled|recording|error` status, 11 intervals, admin-only two-step immediate/future UTC activation, viewer/operator read-only behavior, revisioned policy updates, capacity/storage/conflict/field alerts, VP diagnostic-log separation, focus trap/Escape/focus restore and screen-reader alerts.
- fe(history): added explicit UTC `[from,to)` history client, generation-aware response normalization, structured 400/413/503 errors, CSV query parity, partial/gap/unavailable/no-history state banner, BAD/missing gap line breaks, boolean stepped lines and stale-response suppression. Trends can use v2 unified response without browser tier merge when `VITE_HISTORIAN_V2_TRENDS=1`; default `0` preserves legacy range/query authority until activation/cutover.
- Verification: frontend Vitest `50/50`, `npm run lint`, `npm run typecheck`, default and `VITE_HISTORIAN_V2_TRENDS=1` production builds pass; backend regression `go test -count=1 ./...` passes (`20.790s`), with `go vet ./...` and `go build ./...` GREEN. Browser/manual accessibility, activation/cutover, target eMMC and `E2E-HIST-001` remain open; legacy code/query removal is deferred.
### Added - WEB-HIST-004 unified UTC history query (2026-07-20)
- web/backend(historian-v2): added a generation-aware unified query engine for 1..8 canonical UI/AO/DO/VP IDs over explicit half-open UTC `[from,to)` ranges. The engine supports all 11 fixed resolutions plus `auto`, enforces `maxPoints<=5000` per series without silent truncation, merges RAM > hot > committed archive at 15-second base buckets, re-aggregates deterministically, preserves value/min/max/sum/count/worst-quality/source/tier semantics, returns empty generation series only after all tiers finish, and emits explicit partial gaps when a tier is unavailable or corrupt.
- web/backend(historian-query-store): added bounded, cancellable RAM/hot/archive readers with common per-request RAM coverage, hot/gap half-open reads, enabled-policy identity discovery, contiguous archive-watermark enforcement, committed-block checksum/codec/identity verification, safe local regular-file reads, generation isolation, typed partial archive errors and hard row/block/identity limits.
- web/backend(history-api): explicit `from`/`to` requests now use the v2 query engine; `/history/export.csv` streams the same iterator as JSON with RFC 4180 rows, metadata/gap comments and exact field parity. Legacy `range=30m|1h|6h|24h` requests still use the legacy adapter for rollback and frontend compatibility; query authority cutover and legacy removal remain deferred. Verification: final Windows full `go test -count=1 ./...` (`24.745s`), focused query/integration `count=10`, `go vet ./...` and `go build ./...` pass; supported Linux/amd64 ext4 `go test -race -count=1 -timeout 10m ./...` passes (`103.031s`; wall `122.69s`). Final formatting, stale-status search and scoped diff checks pass.

### Added - WEB-HIST-003 monotonic scheduler (2026-07-20)
- web/backend(historian-v2): completed the WEB-HIST-003 shadow code/local slice with deterministic per-point due schedules for all 11 fixed intervals, one coherent physical snapshot fan-out, generation-aware VP runtime union, 10-minute/64-MiB-accounted raw RAM tail, scheduled-UTC bucket identity, deterministic 15-second fold, due-identity queue overflow gaps, explicit snapshot/clock/queue/restart/storage evidence, durable per-identity backward-clock suspension, bounded retry-safe pending hot rows, policy-mirror retry before revision activation, and shutdown worker wait. Storage/snapshot failures no longer silently consume data: captured rows remain retryable and unrecoverable boundaries become explicit gaps. Legacy `TrendStore`, `Sampler`, VP diagnostic sampler and `/history` remain authoritative; WEB-HIST-004/005, activation/cutover, target eMMC and full E2E remain open. Verification: focused RED/GREEN slices, Windows `go test -count=1 ./...`, `go vet ./...`, `go build ./...`, focused Linux/amd64 race and full Linux/amd64 ext4 `go test -race -count=1 -timeout 10m ./...` pass with Go 1.26.4; scoped `git diff --check` pass. Windows race remains locally blocked by MinGW `cc1.exe: sorry, unimplemented: 64-bit mode not compiled in`.
- test(backend): changed the remaining alarm-settings multi-user fixture from bcrypt cost 12 to `bcrypt.MinCost`, matching the existing auth test fixture policy while leaving production hashing unchanged; this removes an unrelated full-race timeout.

### Added - Production Time/Date vertical slice (2026-07-18)
- core(time): captures one monotonic/UTC/civil `ClockSnapshot` per scan for schedule, alarm and runtime snapshot publication; alarm elapsed delay uses monotonic delta while alarm timestamps use injected UTC. Verification: focused Schedule/Alarm/ScanLoop `15/15`, Schedule+Alarm `41/41`, full WSL core `211/211` pass.
- web(time): adds revisioned strict Time config API, viewer-readable controller time status, apply-before-commit behavior, one-shot manual time persistence, audit-correlated operation IDs, fixed-argv bounded Linux Chrony/timezone/RTC adapter, and fail-safe backend tests. Durable operation-ID dedupe and recovery-required journal blocking are implemented; board RTC write and authenticated mutation gates remain open.
- fe(time): replaces `/settings/time` simulator-only toast behavior with config/status API integration, controller-time rendering, independent status refresh/degrade, dirty/save state, RFC3339-offset manual input and confirmation, plus demo parity. Verification: Vitest `3/3`, typecheck, lint and production build pass.
- docs(time): updates OpenAPI, config ownership/schema and Plan 44 implementation status. Rev A remains component-based; no IEC 61131-3 compliance claim.
- web/time follow-up: replaced target-mismatched timesyncd apply with Chrony status/config support and a root-only fail-closed helper invoked through a narrow sudoers command. Added durable owner-only operation journal states, restart-safe operation-ID dedupe, payload-conflict rejection and recovery-required blocking. Full backend `go test -count=1 ./...`, `go vet ./...`, Windows build and Linux ARM64 test-binary/build gates pass.
- deploy(orange-pi/time): deployed current FE dist and final backend SHA-256 `838f15ae4f9caeb6e736ce97e0e8dfe4cda38029d98efa1860d4a39429fd2964` with binary/dist backups. Replaced sudo, which is incompatible with web `NoNewPrivileges=true`, by `mkddc-time-helper.service`: root helper, bounded capabilities, fail-closed parser and `/run/mkddc/time-helper.sock` mode `0660 root:mkddc`; obsolete sudoers removed. Authenticated NTP PUT succeeded and idempotent retry did not reapply: revision `1→2`, config/OS timezone `Asia/Shanghai`, Chrony synchronized/healthy. RTC is HYM8563 `/dev/rtc0` but remains unreadable through `hwclock`; no manual clock mutation was run. Pre-existing `SQLITE_BUSY` VP sampler warnings remain.
- deploy(orange-pi/core-time): overlaid only Time clock-source files onto the last deployed COR-HIST source, built natively on ARM64, passed core `211/211`, backed up `/usr/sbin/mkddc-core`, and deployed SHA-256 `2fbb08881c0b5c312ee36bfe40fc83103abab61e101a7d4f3cffb422fcbff627` at stamp `20260718_124545`. Readiness required active service plus `/run/mkddc/core.sock`; no wall-clock mutation was performed.
- security(board/docs): removed stale plaintext SSH password guidance, kept key-only operator instructions, and rotated the Orange Pi web JWT secret at stamp `20260718_124940` out of the systemd unit into root-owned `/etc/mkddc-web.env` mode `0600`, with unit/environment backups and readiness rollback. Existing sessions are intentionally invalidated; user password hashes were not read or changed.
- fixed(board/time): authenticated manual `+120s` test exposed UTC text being parsed as `Asia/Shanghai` local time, producing an unintended `-8h` jump. NTP recovery restored system time; RTC was immediately resynced. Fixed helper conversion to format the requested instant in configured civil timezone before `timedatectl set-time`, then reran manual/NTP restore successfully: observed target delta matched the 5-second hold, final config revision `6`, Chrony synchronized, and RTC/system delta `0s`.
- deploy(board/time-helper): replaced the failed sudo path under `NoNewPrivileges=true` with enabled `mkddc-time-helper.service`, bounded capabilities and Unix socket `/run/mkddc/time-helper.sock` mode `0660 root:mkddc`. Final backend SHA-256 is `42deec2bdcfbc13d76bea819bd0c3b23a6b9d82bd2a9f89f6dfb9d1dffbd991d`. Authenticated NTP PUT plus idempotent retry passed with revision `1→2`; manual/NTP maintenance flow later reached revision `6`.
- test(board/time-soak): started a non-root 24-hour monitor at `2026-07-20T02:40:36Z`, PID `273443`, log `/home/orangepi/time-soak-20260720_104036.log`, sampling every 60 seconds. First sample: all five services active, NTP synchronized, Chrony leap normal, RTC aligned, disk 48%. Gate remains RUNNING until 24-hour completion; first sample also records pre-existing VP sampler `SQLITE_BUSY=123/2m`, so storage health is not GREEN.

### Added - Time/Date production and IEC 61131-3 readiness plan (2026-07-18)
- docs(time): added Plan 44 for production `/settings/time`, strict NTP/timezone/manual-time contracts, Linux/RTC ownership, UTC-versus-monotonic clock separation, DST/clock-jump safety, crash-recoverable apply journaling, revision/idempotency controls, backend/frontend/board gates, and a deferred Rev C adapter for IEC 61131-3 date/time semantics and timers. Manual clock mutation stays disabled until runtime clock-jump hardening passes. Rev A remains component-based and makes no IEC 61131-3 compliance claim. Verification: plan reconciled against canonical scope, ADR-004/009, current OpenAPI/config handlers, core scan/schedule/alarm clocks and existing frontend demo behavior; independent adversarial review findings on mutation ordering, partial apply, DST identity, audit ordering and reboot semantics were incorporated; implementation remains open.

### Added - WEB-HIST-001 backend policy slice (2026-07-17)
- web/backend(historian): completed WEB-HIST-001 code/local slice with persisted Virtual Point generation/namespace revision authority, coherent core `point_snapshot` reader, and independent file-backed `historian.conf` per-point policy/capacity API. Contract includes optimistic policy and namespace revisions, generation reconciliation after VP recreate, 11 fixed intervals, backend UTC start, required-field checks, machine-readable `400`/`409`/`507` reasons, reservation/free-space validation and viewer-read/admin-write RBAC. Policy responses remain degraded while writer is inactive. Legacy `TrendStore`, `Sampler`, SQLite samples and `/history` adapter remain running and untouched by policy commits. TDD covers all four point kinds x intervals, immediate/future/past, mixed-batch atomicity, restart, revision/generation/namespace conflicts, concurrent same-revision commits, capacity/storage, cross-file namespace-write recovery, disable-preserves-history, no auto-all, RBAC and core response identity. Verification: focused suite, `go test -count=1 ./...` (`22.705s`), `go vet ./...`, `go build ./...`, Linux/amd64 CGO-disabled cross-build, `git diff --check`, and supported Linux/amd64 `go test -race -count=1 -timeout 10m ./...` (`266.998s`) pass. Capacity Rev A deliberately uses a conservative fixed per-enabled-point ceiling; measured codec/tier projection remains WEB-HIST-002 scope.
- docs(historian): reconciled Plan 42 core status and uppercase quality example, recorded current WEB-HIST/WEB-NAME partial status, and added focused implementation plan. No WEB-HIST-002..005, frontend or full historian Done claim.
- test(backend): reduced test-fixture bcrypt hashing to `bcrypt.MinCost`; production password hashing remains unchanged. This removes repeated cost-12 hashing from race-instrumented backend tests so supported Linux race verification can complete within bounded time.
- docs(historian): added the WEB-HIST-002 TDD implementation plan for a separate FULL-sync WAL v2 store, immutable policy mirror/hot aggregates/gaps, deterministic stdlib archive codec, contiguous watermark-gated prune, native SQLite backups, frozen-manifest resumable migration, damaged-copy recovery, and readiness-only wiring. Plan explicitly keeps legacy writer/query authority and defers scheduler, activation, cutover, frontend, and legacy removal.
- web/backend(historian-v2): continued WEB-HIST-002 with a separate, unwired `HistorianStore`: one-connection modernc SQLite, replacement-connection `_pragma` enforcement, FULL-sync WAL, foreign keys, bounded busy timeout, trusted schema off, owner-only file mode created before SQLite open, escaped SQLite URI paths, and schema v1 evidence tables. Task 2 adds copied exact-byte committed policy snapshots including canonical revision zero, post-filesystem-commit best-effort mirror callbacks outside the policy lock, immutable revision/checksum conflict detection with atomic child rollback, bounded generation-aware hot batches with exact-retry verification and conflicting-duplicate rejection, plus idempotent half-open gaps preserving reason/detail identity. Task 3 adds deterministic stdlib `mkhab-v1` archive encoding with a frozen golden SHA-256, fixed bounded header/body/trailer, sorted rows and UTF-8 source dictionary, negative-zero normalization, finite aggregate validation, 24-hour/5,760-row/64-byte point/255-source/320-KiB limits, and checksum-first bounded decoding that rejects noncanonical UTF-8/floats, corruption, truncation, trailing bytes, unsupported flags/version, duplicate slots, and metadata mismatch. Task 4 adds canonical explicit-gap payload evidence, exact per-slot day coverage validation, stable-cutoff requirement, durable `building -> verified -> committed` transitions, no-overwrite hard-link publication with regular-file checks and deterministic crash hooks, independent post-publication decode/metadata verification, per-identity contiguous origin/watermarks, generation isolation, idempotent lost-ack retry, and fail-closed 48-hour prune requiring a matching committed frontier block. Task 5 adds bounded native modernc SQLite online backups kept inside `Conn.Raw`, unconditional `Finish`, bounded BUSY/LOCKED retries, cancellation checks, unique retained partial evidence, fail-if-exists hard-link publication, independent read-only quick-check/schema/file-checksum verification before and after publication, and one-connection-pool safety. Frozen manifests checksum canonical content, sort copied mappings, validate source identity/SHA-256/rule versions/generations, publish without overwrite, allow exact idempotent retry, and reject changed source/schema resume. Task 6 adds checked seconds/milliseconds normalization, frozen `legacy-trend-v1` source and rule versions, finite/negative-zero-safe aggregation, quality validation, collision resolution before aggregation, exact-duplicate dedupe, deterministic tie/rejection ordering, migration gap evidence, 15-second epoch buckets, and transactional staging where raw rows/cursor commit atomically and final hot rows/rejections/gaps/staging cleanup/verified phase share one transaction. Frozen source row count prevents premature finalization; manifest checksum and exact hot-row checks make changed/replayed chunks fail closed or idempotent. Task 7 derives independent v2 DB/archive/migration paths from `ConfigDir`, runs read-only integrity preflight before writable v2 open, preserves DB/WAL/SHM into unique owner-only fsynced evidence directories without changing originals, and disables only v2 on corruption. A separately verified recovery candidate can be published via no-overwrite hard link only after original-family evidence and quarantine directory sync; second startup verifies clean. `NewApp` opens v2 readiness independently, mirrors current exact policy best-effort, starts no v2 scheduler/writer, keeps legacy `TrendStore`, sampler and `/history` authoritative on v2 failure, and closes legacy/v2 handles independently with joined errors. Verification (2026-07-18): focused recovery/readiness/history tests pass; full backend test/vet/build and scoped `git diff --check` rerun after Task 7. Focused Windows race remains blocked by local GCC; supported Linux race gate remains required.
- web/backend(historian-v2 recovery verification): preflight now opens only a scratch copy of the coherent DB/WAL/SHM family, so SQLite cannot mutate original evidence before preservation or recovery selection. Verification (2026-07-18): focused recovery/readiness/history tests pass; `go test -count=1 ./...` passes (`37.543s`), `go vet ./...`, `go build ./...`, and scoped `git diff --check` pass. Supported Linux race gate remains Task 8.
- docs/test(historian-v2): recorded WEB-HIST-002 readiness-only boundary, `mkhab-v1` limits, exclusive watermark semantics, backup restart behavior, damaged-family rules and deferred cutover. Verification (2026-07-18): fresh `go test -count=1 ./...` pass (`23.918s`), `go vet ./...` pass, `go build ./...` pass, focused archive/migration/recovery/readiness suite `count=10` pass (`5.498s`), and `codegraph sync .` synced 39 changed files. Linux race remains blocked because WSL ext4 has no Go and no Docker daemon/cached Linux toolchain is available; WEB-HIST-002 remains IN PROGRESS, not Done.
- test(time): isolated the Linux RTC status fixture from a host `/sys/class/rtc/rtc0` device by using a non-system fake RTC basename, so the test consistently exercises its mocked `hwclock` response on WSL/board-like hosts. Production time code is unchanged. Verification: focused Linux race rerun and full backend Linux race gate recorded with WEB-HIST-002 evidence.
- test/docs(historian-v2): completed WEB-HIST-002 code/local gate. Bootstrap verified Go 1.26.4 Linux/amd64 in WSL user-local via Ubuntu package extraction plus checksum-verified Go toolchain download; copied backend to ext4-compatible WSL path with historian source SHA-256 parity; Linux `go test -race -count=1 -timeout 10m ./...` passed in `287.407s`. Windows full test/vet/build, fault suite `count=10`, docs/checklist reconciliation, `git diff --check`, and `codegraph sync .` also pass. WEB-HIST-002 code/local is Done; target eMMC, full E2E and WEB-HIST-003..005 remain open.

### Added - Core historian snapshot model and scan publication (2026-07-17)
- core(COR-HIST-001): completed and locally verified the fixed 24-row UI/AO/DO coherent runtime snapshot after priority resolve and safe-state. Physical output is written before snapshot publication; a bounded fixed-buffer serializer/cache removes heap allocation from zero-client per-scan publication while preserving uppercase quality, actual source semantics, generation `1`, UTF-8 replacement/JSON escaping and non-finite `null`/`BAD` wire values. IPC remains strictly parsed, read-only, cached and budgeted. Allocation probe passes zero allocations across 1,000 warmed model builds plus publications, and ordering observer proves output write precedes serialization. Clean WSL/Ninja Release `CORE_BUILD_TESTS=ON` passes 209/209; focused RuntimePointSnapshot/WebIpc/ScanLoop passes 64/64; clean production `CORE_BUILD_TESTS=OFF` build passes; synthetic worst-width stress fixture measures 6,427 bytes including newline under the 65,536-byte cap; `git diff --check` passes. No SQLite, SHM ABI, backend or frontend change. DI remains deferred pending capability authority; `WEB-HIST-001..005` remain planned and `E2E-HIST-001` retains target board jitter/eMMC/recovery/release gates.
- deploy(orange-pi): native ARM64 core build and `209/209` tests passed on Orange Pi 5B; backed up and deployed `/usr/sbin/mkddc-core` plus the current Go backend with backup timestamp `20260717_144250`, then restarted `mkddc-core` and `mkddc-web-pi`. Deployed SHA-256: core `44fc88a866438cc1a376ab2d470a4aa0d6938be9bffea67def3a1bd9672fc863`, backend `d23e2ad250040a7c57455074060010a8876ac7f618643af18d44a6eab640f8e6`. Verification: both services active; authenticated system status reports core/iobus/web/IOP `ok`, IOP `normal`, scan overrun `0`; direct Unix-socket `point_snapshot` returned `accepted` with 24 rows (`UI=16`, `AO=4`, `DO=4`); observed runtime jitter windows remained below `307 us` maximum with zero overruns. Existing warnings remain: invalid `schedule.conf`, no-FIFO degraded scheduling and legacy historian `SQLITE_BUSY`; database writer work is still open.

### Changed - Inputs Live Data raw cell merge (2026-07-17)
- web/fe(inputs,outputs,virtual-points,demo): merged separate Raw (V) and Raw (mA) cells into single Raw cell showing value with unit inline. Added Raw data read-only field to ChannelBasics and OutputBasics config tables. Added Raw column to historical data table in TrendChart (Inputs, Outputs). Added Live Trend chart with stats (min/max/avg) to Virtual Points Summary view. Added raw/rawUnit to demo AO points with jitter-based values. Output rawUnit falls back to config mode (0-10V/4-20mA) when point.rawUnit unavailable. Verification: `npm run typecheck`, `npm run lint`, `npm run build` pass.

### Added - Output engineering units (2026-07-16)
- web/fe(outputs): added AO engineering unit and minimum/maximum present-value controls to Wizard and Advanced views. Values round-trip through `io_config.conf` (`units`, `min_pv`, `max_pv`), already validated by backend and consumed by core BACnet AO mapping. `/points` now exposes SOM `ao_setpoint[]` as AO `raw` with `V`/`mA` unit from `ao_mode[]`; Output Summary displays it. Verification: `go test ./...`, `go vet ./...`, `go build ./...`, frontend `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` pass.

### Changed - Virtual Point tag-only display (2026-07-16)
- web/fe(virtual-points): removed Virtual Point Label from active validation, normalization, API output and authoring UI; VP Tag is now the sole user-facing name across Virtual Points, Monitoring, Trends, Dashboard cards, Scheduler targets and Alarm source selectors. Canonical `VPn` IDs remain internal keys for runtime/history/API stability and are no longer rendered on those VP-facing surfaces when a custom Tag exists. Verification: backend regression asserts `VP1` + `doraemon` projects as `name=doraemon`; full Go tests/vet/build and frontend lint/typecheck/build pass; `git diff --check` pass.
- deploy(orange-pi): deployed Linux ARM64 backend SHA-256 `b340652a07f11aac3772dd8e5a135545fe13abc1e9be3137655607e409771fed` and frontend asset `assets/index-TGVsaHyw.js`, with backups `/opt/mkddc-web/mkddc-web.bak.20260716_153743` and `/opt/mkddc-web/dist.bak.20260716_153743`. Verification: `mkddc-web-pi` active; VP API emits zero `label` fields; channel 25 lookup returns internal `VP1` with equal `tag` and `name`; `/monitor` and `/trends` return 200.

### Added - COR-HIST-001 implementation plan (2026-07-16)
- docs(core/historian): added a TDD implementation plan for coherent read-only UI/AO/DO runtime snapshots, including stateful source-age tracking, post-safe-state scan publication with a test-only observation seam, strict `point_snapshot` parsing, cached serialization, bounded client/read/write budgets, partial-write recovery, source/unit/generation semantics, edge-case tests, regression gates and evidence reconciliation. Verification: plan mapped against current `PointTable`, `ScanLoop`, `WebIpc`, CMake tests, Runtime Model and Plan 42; three review rounds resolved implementation blockers; implementation not started.

### Changed - Global point channels and fixed physical tags (2026-07-16)
- web/fe(point identity): added unique global programming channels (`UI=1..16`, `AO=17..20`, `DO=21..24`, `VPn=24+n`), numeric-channel point lookup, deterministic VP channel reuse through the lowest free `VPn`, immutable canonical physical tags, and editable globally unique VP tags. Inputs Config, Outputs Config, and Virtual Points now show `Tag | Channel | Label`; fixed physical fields and all channels are read-only. Verification: targeted and full Go tests pass; `go vet ./...`, `go build ./...`, frontend lint/typecheck/build and `git diff --check` pass. Frontend `npm run test` reports no test files and exits 1.
- deploy(orange-pi): built and tested the backend natively as Linux ARM64 on Orange Pi, deployed backend SHA-256 `68a50db3198f4ba0ed3257d2ebde46721e7d7dd885c8adef3534438509a46dc6` plus frontend asset `assets/index-B8D5zl-t.js`, and restarted `mkddc-web-pi`. Backups: `/opt/mkddc-web/mkddc-web.bak.20260716_144741` and `/opt/mkddc-web/dist.bak.20260716_144741`. Verification: service active on port 8081; authenticated status `overall=ok`; 24 physical tags canonical with zero duplicate physical channels; VP API returned channels 25..28; numeric lookup channel 25 returned `VP1`; `/eng/virtual-points` and `/login` returned 200. Runtime journal still reports intermittent pre-existing `SQLITE_BUSY` sampler warnings.

### Changed - Historian implementation plan completion (2026-07-16)
- docs(historian): restored accepted `ADR-018` and completed Plan 42 with coherent core snapshot ownership, required per-point policy/health diagnostics, bounded RAM/48-hour hot/>=180-day archive tiers, frozen-manifest final-snapshot legacy migration, filesystem-authoritative crash-safe activation, corruption recovery, monotonic/clock-jump scheduling, deterministic aggregation/watermarks/gaps, unified query/CSV contract, frontend controls, vertical-slice dependencies, measurable test gates and tested forward-compatible rollback. Rev A requires the 48-hour hot tier rather than accepting an undefined direct-to-archive mode. Verification: document links and implementation status reviewed against current `TrendStore`, `Sampler`, Runtime Model, OpenAPI, config schema and master task checklist; three independent spec review rounds resolved data-safety and contract findings; product implementation remains open.

### Fixed - Frontend Tailwind dependency install (2026-07-16)
- fe(tooling): restored the npm-managed frontend dependency tree after mixed package-manager state left `tailwindcss/index.css` missing and blocked Vite. No frontend source or configuration changed. Verification: `npm ci` and `npm run build` pass in `src/frontend`.

### Changed - Orange Pi FE/BE rebuild (2026-07-16)
- deploy(build): rebuilt the local frontend and built the current backend tree natively for ARM64 on Orange Pi in `~/work/mkddc-web-build-20260716`. Verification: `npm run build` pass; backend ARM64 static binary SHA-256 `1bdf765042fb3d03f80154f07db38f454ce37f07ccd44f0898653974db8d7cf8`; backend test gate failed at `TestValidateConfigIORejectsInvalidAoBacnetProperties/long_name`, so `mkddc-web-pi` was not replaced or restarted and remains active with the previous binary.

### Fixed - Frontend point-name control validation (2026-07-15)
- fe(point metadata): reject control characters before whitespace normalization so names containing newline/tab cannot pass client validation. Verification: `npm --prefix src/frontend test -- src/api/pointTags.test.ts` pass; `npm --prefix src/frontend test` pass.

### Changed - Point historian scheduling and unique display-name contracts (2026-07-15)
- docs(ADR-018/Plan 42): owner-approved one backend-owned per-point database logging policy for UI-01..16, AO-01..04, DO-01..04 and numeric/boolean VP, with 11 intervals, immediate server-time or future UTC start, persistent off/scheduled/recording states, restart gaps/no backfill, 48-hour hot cache, >=180-day archive and unified backend Trends merge.
- docs(ADR-019/Plan 43): owner-approved independent global display-name namespace alongside existing technical tags; blank legacy names migrate to canonical IDs, content-duplicate legacy names stay readable but block unrelated mutations until conflict-reducing rename, and rename/delete preserve historian identity by canonical ID + generation.
- docs(contracts/plans): bumped CONFIG_SCHEMA Rev 1.9, Runtime Model Rev 1.3, REST MD Rev 1.3/OpenAPI 1.6.0, guides 07/09, phase/checklist/SOM plans and indexes. Added PLANNED `COR-HIST-001`, `WEB-HIST-001..005`, `WEB-NAME-001`, `E2E-HIST-001`; no product completion claim.

### Changed - Trends filters restored (2026-07-15)
- fe(trends): restore Add Trend modal with ID/name search and point-kind filters, plus custom From/To filtering over the deployed legacy 24-hour historian window. Keep quick ranges, 1-second live display buffer, latest-five timestamp table, and no Historian policy panel.

### Fixed - Live Trends legacy historian compatibility (2026-07-15)
- fe(trends): removed the stale ADR-018 frontend prototype from the active source tree, restoring the deployed `GET /history?point=...&range=30m|1h|6h|24h` flow and the existing 1-second live display buffer. Trends no longer renders the unsupported Historian policy panel. Verification handed to owner; local frontend lint/typecheck/build pass.

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
