# Plan 46: Restructure kiến trúc repository theo bounded modules

> **ID:** PLAN-ARCH-RESTRUCT-002
> **Trạng thái:** In Progress — G0..G3 PASS; G4/G5 còn hạng mục mở
> **Phiên bản:** 1.2
> **Ngày:** 2026-08-03
> **Owner đề xuất:** Tech Lead + Dev SOM/Core/Iobus + Dev Web + DevOps/QA
> **Nguồn kiến trúc:** [System Architecture](../03_architecture/SYSTEM.md),
> [Software Design](../04_design/SOFTWARE.md),
> [Document Control](../00_governance/CONTROL.md)

> **Quyết định triển khai:** ADR-025 Accepted ngày 2026-08-03 theo chỉ thị của
> owner/user. Baseline G0 và path inventory được lưu tại
> `docs/07_records/evidence/restructure/BASELINE_G0_20260803.json` và
> `tools/restructure/repository-path-map.json`.

## 1. Mục tiêu

Tái cấu trúc repository theo **process-first + bounded modules** trong khi giữ
nguyên topology và failure boundary production:

- `mkddc-core` tiếp tục sở hữu graph, scan, priority, interlock và safe-state;
- `mkddc-iobus` tiếp tục sở hữu IOP, Physical I/O, Modbus và BACnet;
- `mkddc-web` tiếp tục sở hữu API, auth, config, history và React Web UI;
- `mkddc-hmi` tiếp tục là presentation service tùy chọn;
- `mkddc-netcfg` tiếp tục là privileged helper hẹp ngoài control path;
- STM32 tiếp tục sở hữu sampling, actuation, communication watchdog và
  independent safe behavior.

Restructure phải làm rõ dependency, giảm file/package quá lớn, tập trung
contract và chuẩn hóa build/deployment. Restructure không được thay đổi hành vi
sản phẩm hoặc được dùng làm bằng chứng Programming đã implement.

## 2. Ngoài phạm vi

- Không thêm Program API, ST/FBD Editor, Program lifecycle hoặc production
  scheduler.
- Không đổi Product Spec Programming Rev A.
- Không mở Modbus TCP Point, BACnet/IP Point, LD, SFC, motion hoặc safety PLC.
- Không đổi thuật toán control, scan period, priority, safe-state hoặc AO
  engineering-to-electrical conversion.
- Không đổi public REST/WebSocket semantics, SHM layout, IOP frame hoặc config
  schema trong các task chỉ di chuyển source.
- Không tách thêm runtime process hoặc repository con.
- Không xóa archive, evidence, log hoặc build artifact cục bộ chỉ để làm sạch
  cây thư mục.
- Không restructure vật lý toàn bộ `docs/`; chỉ cập nhật link/path do source
  move tác động. Việc hợp nhất corpus tài liệu cần audit riêng theo
  `DOC-CTRL-001`.

## 3. Kiến trúc đích

```text
apps/
  core/
    domain/
    application/
    ports/
    adapters/
    bootstrap/
  iobus/
    domain/
    application/
    ports/
    adapters/
      iop/
      physical_io/
      modbus_rtu/
      bacnet/
    bootstrap/
  netcfg/
  hmi/
  web-api/
    cmd/mkddc-web/
    internal/
      auth/
      config/
      health/
      historian/
      modbusrtu/
      points/
      system/
  web-ui/
    src/
      app/
      features/
      shared/

firmware/
  stm32/

contracts/
  iop/
  shm/
  openapi/
  config/

platform/
  cmake/
  packaging/
  systemd/

tests/
  integration/
  e2e/
  hil/
  fixtures/

tools/
docs/
```

Tên binary, systemd unit, API prefix, database/config filename và artifact
release giữ nguyên trong toàn bộ migration.

## 4. Luật dependency bắt buộc

| Vùng | Được phụ thuộc | Không được phụ thuộc |
|---|---|---|
| `contracts` | thư viện chuẩn tối thiểu | bất kỳ `apps`, `platform`, UI hoặc database |
| `firmware/stm32` | `contracts/iop`, code firmware nội bộ | SHM, Web, Core hoặc Linux service |
| `apps/core` | contract SHM, domain/application/adapter nội bộ | source iobus, web, HMI hoặc firmware |
| `apps/iobus` | contract IOP/SHM, adapter protocol nội bộ | source core, web hoặc HMI |
| `apps/web-api` | public contract/API model và adapter IPC/SHM | source implementation core/iobus |
| `apps/web-ui` | HTTP/WebSocket contract công khai | SHM, IOP, C/C++ source hoặc database trực tiếp |
| `apps/hmi` | read-only telemetry contract và command IPC đã duyệt | hardware write hoặc core implementation |
| `platform` | app artifact và deployment metadata | không được trở thành runtime dependency của domain |
| `tests` | app/contract qua public test surface | production app không được import test implementation |

Quy tắc bổ sung:

1. `main`/bootstrap chỉ compose dependency, parse CLI và quản lý lifecycle.
2. Domain không gọi filesystem, socket, SHM, database hoặc systemd trực tiếp.
3. Adapter không sở hữu policy control thuộc Core.
4. UI feature không import chéo trực tiếp; dùng `shared` hoặc public feature API.
5. `shared/` cũ chỉ được giữ như compatibility forwarding layer trong thời gian
   migration, không nhận contract mới.
6. Mọi ABI mismatch phải fail fast; không ép kiểu hoặc fallback im lặng.

## 5. Chiến lược delivery

- Mỗi task bên dưới là một PR độc lập hoặc một commit group độc lập nếu được
  Tech Lead phê duyệt trước.
- PR di chuyển path chỉ dùng rename và cập nhật build/import/link; không refactor
  logic trong cùng PR.
- PR refactor module không đồng thời đổi public contract.
- Mỗi PR phải giữ branch ở trạng thái build/test được; không tạo nhánh migration
  dài ngày chỉ tích hợp được ở cuối.
- Compatibility shim chỉ tồn tại có thời hạn và phải có task xóa cụ thể.
- Rollback mặc định là revert đúng PR gần nhất. Không dùng reset hoặc khôi phục
  thủ công nhiều phase.
- Task chỉ được chuyển `DONE` bằng bằng chứng mới trên commit của task đó.

## 6. Task breakdown

### Gate G0 — Quyết định và baseline

#### `RST-001` — Formalize architecture decision

- **Phụ thuộc:** không.
- **Mục tiêu:** ghi ADR cho process-first + bounded modules, cấu trúc đích,
  dependency rule, compatibility và rollback.
- **Chạm dự kiến:** `docs/00_governance/DECISIONS.md` hoặc ADR active theo
  register hiện hành; architecture/design/traceability nếu quyết định được
  Accepted.
- **Không làm:** không di chuyển source.
- **Gate:** owner xác nhận topology ba process không đổi; HMI/netcfg/STM32
  boundary được ghi rõ; ADR có trạng thái và người phê duyệt.
- **Ước lượng:** 0,5 ngày.

#### `RST-002` — Chụp baseline và dependency inventory

- **Phụ thuộc:** `RST-001`.
- **Mục tiêu:** lập manifest source, target, binary, systemd unit, config,
  public contract và mọi reference đến path cũ.
- **Đầu ra:** machine-readable path map dùng cho kiểm tra migration; không tạo
  report Markdown trùng authority.
- **Gate:** inventory bao phủ CMake, Go, npm, GitHub Actions, packaging,
  systemd, tools, docs link và target installer.
- **Ước lượng:** 1 ngày.

#### `RST-003` — Ghi baseline verification mới

- **Phụ thuộc:** `RST-002`.
- **Mục tiêu:** đo gate trước restructure để so sánh parity.
- **Gate tối thiểu:** C++ full option matrix; Go vet/test không cache; FE
  Vitest/lint/build; Playwright gate liên quan; firmware ARM; release builder
  và checksum.
- **Bằng chứng:** commit, toolchain, command, count, duration và artifact path.
- **Giới hạn:** host/simulator không đóng HIL.
- **Ước lượng:** 0,5 ngày.

**G0 PASS khi:** ADR được duyệt, inventory đầy đủ và baseline xanh hoặc mọi gate
đỏ đã có finding/owner. Không mở task di chuyển nếu G0 chưa PASS.

### Gate G1 — Scaffold và build indirection

#### `RST-010` — Tạo skeleton thư mục đích

- **Phụ thuộc:** G0.
- **Mục tiêu:** tạo `apps`, `firmware`, `contracts`, `platform`, `tests` cùng
  ownership/dependency README ngắn; chưa chuyển implementation.
- **Gate:** không đổi target CMake, Go module, npm package hoặc artifact.
- **Ước lượng:** 0,5 ngày.

#### `RST-011` — Chuẩn hóa entrypoint build

- **Phụ thuộc:** `RST-010`.
- **Mục tiêu:** root build gọi target qua biến/path trung gian, không hardcode
  path trong nhiều script.
- **Chạm dự kiến:** root CMake, CMake helper và build presets/scripts.
- **Gate:** CMake build/CTest full option vẫn parity với `RST-003`.
- **Rollback:** revert task; source vẫn ở vị trí cũ.
- **Ước lượng:** 1 ngày.

#### `RST-012` — Chuẩn hóa verification entrypoint

- **Phụ thuộc:** `RST-011`.
- **Mục tiêu:** tạo một script/profile kiểm chứng được CI và local dùng chung;
  mọi build output mặc định nằm dưới root `build/` hoặc thư mục tạm.
- **Gate:** script chạy đúng command từ manifest hiện tại, trả non-zero khi
  một gate lỗi và không xóa SHM/build/user data ngoài scope.
- **Ước lượng:** 1 ngày.

#### `RST-013` — Tách path khỏi CI

- **Phụ thuộc:** `RST-012`.
- **Mục tiêu:** workflow gọi entrypoint chuẩn thay vì lặp `cd` và path cũ.
- **Gate:** matrix C++, Go, FE, firmware, fuzz/sanitizer/security tiếp tục chạy;
  không bỏ hoặc skip job.
- **Ước lượng:** 1 ngày.

#### `RST-014` — Tách path khỏi release/installer

- **Phụ thuộc:** `RST-011`.
- **Mục tiêu:** build-release và installer lấy artifact từ mapping tập trung.
- **Gate:** binary/service/config target không đổi; checksum manifest parity.
- **Ước lượng:** 1 ngày.

**Có thể song song:** `RST-013` và `RST-014` sau `RST-012`, với owner file tách
biệt. **G1 PASS khi:** build, CI và packaging không còn phụ thuộc rải rác vào
path source sắp di chuyển.

### Gate G2 — Contract authority

#### `RST-020` — Di chuyển IOP contract

- **Phụ thuộc:** G1.
- **Mục tiêu:** chuyển canonical IOP header sang `contracts/iop`; giữ forwarding
  header tại path cũ trong transition window.
- **Gate:** static assertion, firmware hostcheck, iobus parser/CRC test và ARM
  build PASS; wire bytes không đổi.
- **Ước lượng:** 1 ngày.

#### `RST-021` — Di chuyển SHM contract

- **Phụ thuộc:** `RST-020`.
- **Mục tiêu:** chuyển canonical SHM/IO config contract sang `contracts/shm` và
  `contracts/config`; path cũ chỉ forward.
- **Gate:** magic, version, size, alignment, offset và producer/consumer tests
  không đổi; mismatch test vẫn fail fast.
- **Ước lượng:** 1,5 ngày.

#### `RST-022` — Chuyển OpenAPI về contract authority

- **Phụ thuộc:** G1.
- **Mục tiêu:** đặt OpenAPI machine-readable tại `contracts/openapi`; docs chỉ
  link/diễn giải, không giữ hai bản authority.
- **Gate:** parse/lint OpenAPI; Go/TypeScript model mapping; API behavior không
  đổi.
- **Ước lượng:** 1 ngày.

#### `RST-023` — Contract compatibility gate

- **Phụ thuộc:** `RST-021`, `RST-022`.
- **Mục tiêu:** thêm CI guard bắt duplicate authority, stale forwarding header,
  ABI drift và OpenAPI mapping drift.
- **Gate:** cố tình tạo mismatch trong test fixture phải làm gate đỏ.
- **Ước lượng:** 1 ngày.

**Có thể song song:** `RST-022` với `RST-020/021`. **G2 PASS khi:** mỗi contract
có đúng một authority và mọi consumer cũ vẫn build qua compatibility layer.

### Gate G3 — Di chuyển application theo process

Mỗi task dưới đây chỉ thực hiện path move, build/import wiring và link docs cần
thiết. Không chia module nội bộ ở Gate G3.

#### `RST-030` — Di chuyển `mkddc-core`

- `services/core` → `apps/core`.
- Cập nhật CMake, tools và test reference.
- Gate: full Core unit/integration, watchdog invariant và parser-separation
  invariant PASS.
- Ước lượng: 1 ngày.

#### `RST-031` — Di chuyển `mkddc-iobus`

- **Phụ thuộc:** `RST-030` chỉ nếu root CMake yêu cầu; không phụ thuộc logic.
- `services/iobus` → `apps/iobus`.
- Gate: IOP, scaling, fieldbus, SHM, fake MCU và Modbus/BACnet matrix PASS.
- Ước lượng: 1,5 ngày.

#### `RST-032` — Di chuyển `mkddc-netcfg`

- `services/netcfg` → `apps/netcfg`.
- Gate: netcfg unit/integration, Unix credential boundary và transaction
  rollback tests PASS.
- Ước lượng: 1 ngày.

#### `RST-033` — Di chuyển optional HMI

- `services/hmi` → `apps/hmi`.
- Gate: build OFF không kéo HMI dependency; build ON và HMI tests PASS.
- Không claim DRM/touch target từ host build.
- Ước lượng: 1 ngày.

#### `RST-034` — Di chuyển STM32 firmware

- `fw` → `firmware/stm32`.
- Gate: ARM build, hostcheck, firmware provenance và packaging checksum PASS.
- Không đổi HAL, UART pin/device hoặc safe timeout.
- Ước lượng: 1 ngày.

#### `RST-035` — Di chuyển Go Web API

- `web/backend` → `apps/web-api`.
- Giữ Go module path và binary name trong task này.
- Gate: `go vet ./...`, `go test ./... -count=1`, race test cho vùng concurrency
  bị path wiring tác động nếu platform cho phép.
- Ước lượng: 1 ngày.

#### `RST-036` — Di chuyển React Web UI

- `src/frontend` → `apps/web-ui`.
- Giữ npm package name, route và build output contract.
- Gate: Vitest, lint, type/build và Playwright E2E PASS; browser runtime được
  kiểm tra bằng Chrome DevTools MCP khi tool khả dụng.
- Ước lượng: 1 ngày.

#### `RST-037` — Phân loại tools và test xuyên hệ thống

- Giữ executable/tool phát triển trong `tools`.
- Chuyển test integration/E2E/HIL fixture đúng nghĩa sang `tests`.
- Không di chuyển evidence đã kiểm soát khỏi `docs/07_records`.
- Gate: không tool/test production nào tham chiếu path cũ; không đổi test
  semantics.
- Ước lượng: 1 ngày.

**Song song có điều kiện:** `RST-032`, `RST-033`, `RST-034`, `RST-035` và
`RST-036` có thể song song sau khi root wiring ổn định, nhưng một owner duy nhất
phải giữ root CMake/CI/packaging integration. `RST-030` và `RST-031` nên tuần tự
vì cùng chạm CMake và SHM test setup.

**G3 PASS khi:** source production đã ở cây đích, binary/service/API/ABI không
đổi, full verification parity và release bundle tạo được.

### Gate G4 — Modular hóa nội bộ theo bounded context

#### Core

| Task | Nội dung | Phụ thuộc | Gate chính | Ước lượng |
|---|---|---|---|---|
| `RST-100` | Thu gọn `core/main` thành composition root và lifecycle | G3 | Core full tests; startup/CLI parity | 1 ngày |
| `RST-101` | Tách domain graph/point/priority/safety khỏi adapter SHM/IPC/config | `RST-100` | không domain include platform adapter; negative/fault tests | 2 ngày |
| `RST-102` | Định nghĩa port cho snapshot, command, clock và persistence | `RST-101` | fake port + production adapter cùng contract tests | 2 ngày |
| `RST-103` | Enforce dependency direction bằng CMake target boundaries | `RST-102` | forbidden include/link làm CI đỏ | 1 ngày |

#### Iobus

| Task | Nội dung | Phụ thuộc | Gate chính | Ước lượng |
|---|---|---|---|---|
| `RST-110` | Thu gọn `iobus/main` thành composition root | G3 | startup/config/worker parity | 1 ngày |
| `RST-111` | Tách IOP + Physical I/O adapter khỏi cache/domain | `RST-110` | UART loss, CRC, safe timeout, scaling tests | 2 ngày |
| `RST-112` | Đóng gói Modbus RTU adapter và scheduler | `RST-110` | register/endian/quality/retry tests; simulator | 2 ngày |
| `RST-113` | Đóng gói BACnet adapter, giữ feature gate | `RST-110` | BACnet OFF/ON build; hot-rebind tests | 1,5 ngày |
| `RST-114` | Enforce port/domain/adapter dependency | `RST-111..113` | forbidden include/link làm CI đỏ | 1 ngày |

#### Go Web API

| Task | Nội dung | Phụ thuộc | Gate chính | Ước lượng |
|---|---|---|---|---|
| `RST-120` | Tạo `cmd/mkddc-web` và `internal` composition, chưa tách domain | G3 | binary/CLI/config parity | 1 ngày |
| `RST-121` | Tách `auth` và audit package | `RST-120` | RBAC, token, audit, last-admin tests | 1,5 ngày |
| `RST-122` | Tách Point Catalog/namespace/config package | `RST-120` | stable ID, unique tag, rename, persistence tests | 2 ngày |
| `RST-123` | Tách Modbus RTU package | `RST-122` | CRUD, validation, persistence, reload/error tests | 1,5 ngày |
| `RST-124` | Tách historian package theo store/query/lifecycle | `RST-120` | migration, retention, recovery, concurrency tests | 2 ngày |
| `RST-125` | Tách system/network/health/HMI broker adapters | `RST-121` | timeout, credential, restart, partial failure tests | 2 ngày |
| `RST-126` | Router/composition chỉ ghép public handler từ package | `RST-121..125` | route/OpenAPI/RBAC parity | 1 ngày |

#### React Web UI

| Task | Nội dung | Phụ thuộc | Gate chính | Ước lượng |
|---|---|---|---|---|
| `RST-130` | Tách app shell/router/provider khỏi feature | G3 | route/auth/navigation parity | 1 ngày |
| `RST-131` | Tách transport/API client, normalizer và generated/public types | `RST-130` | contract/normalizer/reconnect tests | 2 ngày |
| `RST-132` | Feature `points` + Local/Virtual I/O | `RST-131` | Point metadata, permission, write/release UI tests | 2 ngày |
| `RST-133` | Feature `modbus-rtu` | `RST-131` | Device/Point CRUD, validation, error-state tests | 1 ngày |
| `RST-134` | Feature `network` + system settings | `RST-131` | transaction/recovery E2E | 2 ngày |
| `RST-135` | Feature historian/alarm/schedule | `RST-131` | trend/alarm/schedule test suites | 2 ngày |
| `RST-136` | Feature auth/users và shared UI primitives | `RST-131` | role/navigation/accessibility tests | 1,5 ngày |
| `RST-137` | Enforce FE import boundary | `RST-132..136` | feature cross-import trái phép làm lint đỏ | 1 ngày |

**Song song có điều kiện:** Core, Iobus, Go API và FE có thể chạy song song sau
G3 vì ownership file tách biệt. Trong một process, các task phải theo dependency
trong bảng. Contract semantics không được đổi trong G4; nếu phát hiện cần đổi,
dừng task và mở decision/change riêng.

**G4 PASS khi:** bootstrap chỉ compose, domain không phụ thuộc adapter, Go chỉ
còn `package main` trong `cmd`, FE có feature boundary được lint và full tests
parity.

### Gate G5 — Đóng migration và nghiệm thu

#### `RST-200` — Xóa compatibility forwarding layer

- **Phụ thuộc:** G4 và inventory xác nhận không consumer nào dùng path cũ.
- Xóa forwarding headers/path shim theo từng contract, không xóa đồng loạt.
- Gate: path guard CI, ABI tests, full build matrix PASS.
- Ước lượng: 1 ngày.

#### `RST-201` — Cô lập build artifact

- Mọi hướng dẫn/build mặc định dùng root `build/<profile>` hoặc temp directory.
- Bổ sung guard không tạo build tree trong `apps`, `firmware`, `contracts`.
- Không tự xóa build/user artifact hiện hữu; việc cleanup là thao tác riêng có
  target rõ và được người dùng cho phép.
- Gate: clean clone và dirty local workspace đều build được.
- Ước lượng: 0,5 ngày.

#### `RST-202` — Release/installer/rollback rehearsal

- Build coordinated bundle, verify checksum/provenance và cài thử trên target.
- Test service startup order, crash/restart và rollback artifact.
- Gate: target truy được binary về commit/checksum; core/iobus/web/netcfg/HMI
  optional đúng unit và path mới.
- Không dùng host package test thay target evidence.
- Ước lượng: 1,5 ngày.

#### `RST-203` — Đồng bộ controlled docs

- Cập nhật System, Software, Interfaces, Development & Operations,
  Verification, Traceability, implementation index và root README theo path
  As-Built mới.
- Đánh dấu tài liệu lịch sử/path cũ đúng trạng thái; không rewrite evidence.
- Gate: internal link, duplicate authority, ID và `git diff --check` PASS.
- Ước lượng: 1 ngày.

#### `RST-204` — Full regression và architecture conformance

- Chạy full C++ Modbus/BACnet/HMI matrix, sanitizer/fuzz theo CI, Go vet/test
  không cache, FE Vitest/lint/build/E2E, firmware ARM và release checksum.
- Test startup order, stale/corrupt SHM, process restart, Web loss, UART loss,
  config invalid và ABI mismatch ở mức integration phù hợp.
- Gate: không regression so với `RST-003`; mọi difference có finding/approval.
- Ước lượng: 1 ngày cộng thời gian CI.

#### `RST-205` — Closure review

- Đối chiếu toàn bộ task, ADR, traceability, changelog, target evidence và
  rollback.
- Đóng plan chỉ khi không còn source/path shim ngoài danh sách waiver được
  phê duyệt.
- Ghi rõ physical I/O HIL/real RS485 gap còn tồn tại; restructure không tự làm
  các gate đó xanh.
- Ước lượng: 0,5 ngày.

**G5 PASS khi:** source tree đích là authority duy nhất, target package chạy
được, rollback đã diễn tập, full regression xanh và controlled docs khớp
As-Built.

## 7. Ma trận thứ tự và song song

```text
RST-001 -> 002 -> 003
                  |
                  v
RST-010 -> 011 -> 012 -> 013
              \-> 014
                  |
                  v
RST-020 -> 021 -> 023
RST-022 ---------> 023
                  |
                  v
RST-030 -> RST-031
RST-032 | RST-033 | RST-034 | RST-035 | RST-036
                  |
                  v
        Core | Iobus | Go API | React UI
                  |
                  v
RST-200 -> 201 -> 202 -> 203 -> 204 -> 205
```

Không chạy song song hai task cùng sửa root CMake, CI workflow hoặc packaging.
Tech Lead giữ ownership ba vùng integration này và cấp cửa sổ merge lần lượt.

## 8. Gate kiểm chứng chuẩn cho từng loại task

| Loại thay đổi | Gate bắt buộc |
|---|---|
| Docs/ADR/plan | link nội bộ, ID/status/authority, `git diff --check` |
| CMake/path C++ | configure/build/CTest affected target, sau đó full option matrix |
| SHM/IOP contract | ABI/static assertion, producer/consumer, malformed/mismatch, firmware host/ARM |
| Go package move | `gofmt`, `go vet ./...`, `go test ./... -count=1`; race nếu concurrency bị chạm |
| React feature move | Vitest affected/full, lint, type/build; Playwright cho flow runtime |
| UI runtime | Chrome DevTools MCP: screenshot/snapshot, Console, Network; không thay test tự động |
| Packaging/deploy | release builder, checksum, installer/target startup, provenance, rollback |
| Boundary/failure | IPC/SHM/config fault injection và process restart; HIL nếu physical behavior bị đổi |

Số test và duration phải đo lại tại commit của task. Không đưa số historical
vào evidence hiện hành.

## 9. Tiêu chí hoàn tất toàn plan

- Cây thư mục đích được áp dụng và không còn implementation production ở path
  cũ.
- Binary `mkddc-core`, `mkddc-iobus`, `mkddc-web`, `mkddc-netcfg` và optional
  `mkddc-hmi` giữ nguyên tên/lifecycle.
- Core, Iobus, Web, HMI, netcfg và STM32 giữ đúng ownership/failure boundary.
- `contracts` là authority duy nhất cho IOP, SHM, OpenAPI và config contract đã
  đưa vào scope.
- Go `package main` chỉ còn trong `cmd/mkddc-web`.
- React feature boundary và C++ target dependency được enforce tự động.
- Không có app phụ thuộc source implementation của app khác.
- Full regression, release bundle, target smoke và rollback PASS trên commit
  cuối.
- Controlled docs, traceability và changelog khớp source As-Built.
- Không có claim Programming implemented, real RS485 ready hoặc physical HIL
  ready nếu chưa có bằng chứng tương ứng.

## 10. Điều kiện dừng

Dừng task hiện tại và mở finding/decision riêng nếu phát hiện một trong các
trường hợp:

- path move bắt buộc đổi ABI/API/config semantics;
- process ownership hiện tại xung đột Product/Requirement Active;
- cần thêm runtime process hoặc dynamic plugin trong control path;
- không thể rollback độc lập task;
- CI/test bị bỏ qua để hoàn tất migration;
- target artifact không truy được về commit/checksum;
- restructure làm Web/HMI trở thành dependency của control continuity.

## 11. Kết luận planning

```text
RESTRUCTURE_OPTION = PROCESS_FIRST_BOUNDED_MODULES
PLAN_DECOMPOSED = YES
IMPLEMENTATION_STARTED = YES
SOURCE_PATHS_CHANGED = YES
HOST_SOURCE_MIGRATION = PASS
HOST_FULL_REGRESSION = PASS
TARGET_INSTALL_ROLLBACK = NOT_RUN
PLAN_CLOSED = NO
```

## 12. Trạng thái thực thi ngày 2026-08-03

### 12.1. Kết quả theo gate

| Gate | Trạng thái | Kết quả hiện hành |
|---|---|---|
| G0 | PASS | ADR-025 `Accepted`, baseline và path inventory đã lưu trước khi di chuyển. |
| G1 | PASS | Root CMake, path module, verifier thống nhất và CI layout job đã dùng cây đích. |
| G2 | PASS | `contracts/` là authority duy nhất; contract/dependency negative tests làm gate đỏ khi tạo bản sao hoặc import sai chiều. |
| G3 | PASS trên host | Core, Iobus, netcfg, HMI, Web API, Web UI, STM32 và packaging đã chuyển vật lý; path cũ không còn tồn tại; binary/service/API/contract semantics giữ nguyên. |
| G4 | PARTIAL | Core/Iobus có domain/application/ports/adapters/bootstrap và CMake boundary; React có app/features/shared cùng public barrel/lint guard; Go mới hoàn tất `cmd/mkddc-web` + `internal/app`, chưa tách xong `RST-121..126`. |
| G5 | PARTIAL/BLOCKED | Compatibility shim đã bỏ, artifact đã cô lập, host regression và release checksum PASS. `RST-202` target install/startup/rollback chưa chạy vì không có target được duyệt; `RST-205` chưa được phép đóng. |

### 12.2. Kiểm chứng host hiện hành

- Repository layout/contract/dependency guards: PASS, gồm 7 negative/positive
  test và manifest phase `g4-modularized`.
- C++ matrix: baseline **709/709**, Modbus **717/717**, BACnet **710/710**,
  Modbus+BACnet **718/718**, full Modbus+BACnet+HMI **751/751** PASS.
- ASan và UBSan **709/709** PASS; fuzz smoke parser **917.841** lượt và loader
  **1.879.361** lượt trong 61 giây mỗi harness, không crash/sanitizer finding.
- Go `vet` + `test -race -count=1`: PASS cho composition root và
  `internal/app`.
- React: Vitest **35 file, 299/299 test**, lint 0 warning, production build
  **2.223 module** PASS; Playwright network **1/1 PASS**.
- Firmware ARM build PASS; coordinated release builder và **5/5 SHA-256**
  PASS.
- Bằng chứng chi tiết:
  `docs/07_records/evidence/restructure/HOST_RESTRUCTURE_GATES_20260803.json`.

### 12.3. Hạng mục bắt buộc trước khi đóng plan

1. Hoàn tất bounded context Go `RST-121..126`; không tạo package rỗng hoặc
   façade giả chỉ để thỏa cây thư mục.
2. Owner cung cấp target/board, định danh target, quyền cài service và cửa sổ
   rollback để chạy `RST-202`.
3. Ghi log startup order, crash/restart, commit/checksum provenance và rollback
   từ target; host package test không thay bằng chứng này.
4. Chạy closure review `RST-205`, xử lý/waive riêng 4 lỗ hổng npm mức high và
   giữ các gate physical I/O HIL/real RS485/Programming ở trạng thái hiện hữu.
