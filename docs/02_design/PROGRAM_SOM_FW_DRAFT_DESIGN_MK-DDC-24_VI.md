# Thiết kế khắc phục IEC 61131-3 cho Program, SOM Software và MCU Firmware
## MK-DDC-24 Rev A.0 — bản để review

> **Document ID:** DDD-PROGRAM-SOM-FW-MK-DDC-24-VI
>
> **Version:** 0.5 | 2026-07-23 (repository sync + 31 document conflict đóng — xem mục 16)
>
> **Trạng thái:** Draft — hướng kiến trúc đã **Decided** (ADR-018), chi tiết C0/C1–C10 đang
> lập thành tài liệu riêng; tài liệu này chưa chuyển `Active` cho tới khi C0 hoàn thành
>
> **Chủ quản:** Project Engineering (Phạm Đình Chương — Project Engineering Owner / CTO)
>
> **Áp dụng:** MK-DDC-24 Rev A.0 hiện tại
>
> **Chuẩn mục tiêu:** IEC 61131-3-aligned (không phải full IEC 61131-3:2025); phạm vi
> ngôn ngữ Rev A.0 = **ST + FBD**. LD, SFC hoãn, không thuộc release gate Rev A.0.
>
> **Supersedes:** hướng thiết kế version 0.1 (hoãn IEC sang revision sau) và version 0.2/0.3
> (bắt buộc đủ 4 ngôn ngữ ST/LD/FBD/SFC ngay Rev A.0) — phạm vi đã thu hẹp còn ST+FBD theo
> quyết định CTO 2026-07-23.
>
> **Release gate hiện tại:** G0 chuyển **GREEN** (ADR-018 + PRODUCT.md/SOFTWARE.md/
> DECISIONS.md/REQUIREMENTS.md/VERIFICATION.md/TRACEABILITY.md đã cập nhật 2026-07-23;
> 31/31 document conflict đóng, xem `KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md`).
> G1–G6 vẫn **RED** — chưa có implementation/conformance evidence; C0 chưa hoàn thành.
>
> **Cấu trúc tài liệu:** đây là *corrective/directive design*, cố ý không theo
> `docs/02_design/_templates/TEMPLATE_DDD.md` (DDD component chuẩn). Mục 1–3 gộp vai trò
> "Mục đích & Phạm vi" + "Bối cảnh & Ràng buộc"; mục 11+13 đóng vai trò "Ma trận truy
> vết"; mục 15 đóng vai trò "Open points". Xem review cấu trúc/thiết kế đầy đủ tại
> [`KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md`](../07_records/reviews/KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md).
>
> **✅ Quyết định đã chốt 2026-07-23 (DOC-REV-001 đã đóng):** mâu thuẫn với
> [`KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md`](../07_records/reviews/KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md)
> (gap assessment cùng ngày, từng khuyến nghị ngược lại — giữ Rev A component-based,
> không IEC) đã được CTO Phạm Đình Chương giải quyết trực tiếp, ghi thành
> [`ADR-018-mekong-owned-iec-aligned-program-runtime.md`](../adr/ADR-018-mekong-owned-iec-aligned-program-runtime.md)
> và [`KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md`](../07_records/reviews/KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md)
> (Q0–Q9). Directive: Mekong tự sở hữu Program Runtime (không dùng runtime IEC bên
> ngoài), Rev A.0 chỉ ST+FBD, không online change, không claim certified/compliant.
> Chi tiết triển khai đã tách sang
> [`KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md`](../07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md)
> và [`KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md`](../07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md).

---

## 1. Quyết định bắt buộc

**Cập nhật 2026-07-23 — quyết định đã chốt (ADR-018):** Rev A.0 phải hình thành nền tảng
Program Runtime **do Mekong sở hữu** (không dùng runtime IEC 61131-3 thương mại hay mã
nguồn mở bên ngoài), tương thích định hướng IEC 61131-3, nhưng phạm vi Rev A.0 là một
**MVP thu hẹp**: chỉ **ST + FBD**, không phải toàn bộ 4 ngôn ngữ. **LD và SFC hoãn**,
chưa thuộc release gate Rev A.0 (IR/Program Schema phải mở rộng được cho hai ngôn ngữ
này sau, nhưng không build ngay). Rev A.0 không được release với claim
`certified`/`compliant` khi các gate trong mục 14 chưa đóng; mô tả được phép duy nhất là
"Mekong-owned deterministic DDC programming runtime designed with an IEC 61131-3-aligned
program, type, task and function-block model."

Quyết định này thay đổi phạm vi sản phẩm và đã được đối soát với baseline hiện hành ngày
2026-07-23:

- `PRODUCT.md` đã cập nhật: Runtime = Mekong Program Runtime (ST+FBD), LD/SFC/online
  change/certification claim/wiresheet canvas ngoài phạm vi Rev A.0;
- ADR-004 đã chuyển `Superseded by ADR-018`; component graph 28-node giữ vai trò legacy
  importer/nguồn vendor FB;
- ADR-006 (wiresheet canvas kéo-thả) không đổi — vẫn hoãn, tách biệt khỏi quyết định
  ngôn ngữ ST+FBD;
- `SOFTWARE.md` đã cập nhật: thêm `mkddc-program-service`/`mkddc-program-core` (chưa
  triển khai, thuộc C1+), component graph đổi vai trò;
- `REQUIREMENTS.md`, `VERIFICATION.md` và `TRACEABILITY.md` **chưa cập nhật** — đây là
  phần còn lại của chuỗi change control, tracked ở `KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md`.

Do đó tài liệu này vẫn là **corrective design đầu vào cho change control**, nhưng hướng
kiến trúc không còn là điểm mở — chỉ còn phần cập nhật Requirements/Verification/
Traceability và chi tiết triển khai (xem C0/C1–C10 ở mục 12) là chưa xong. Không đổi
tài liệu này sang `Active` cho tới khi C0 hoàn thành và các tài liệu chuỗi trên được
cập nhật.

### 1.1 Phân biệt conformity và certification

- **IEC conformance target:** sản phẩm triển khai đúng syntax, semantics và feature
  profile đã công bố; có test trace tới từng feature áp dụng.
- **PLCopen certification:** đánh giá độc lập theo cấp/ngôn ngữ được chọn. Chỉ được
  dùng từ `certified` hoặc logo liên quan sau khi có certificate hợp lệ.
- Tài liệu thiết kế, build pass hoặc host unit test không tự tạo thành bằng chứng
  conformity/certification.

IEC 61131-3:2025 định nghĩa ST, LD, FBD và các phần tử SFC, cùng configuration elements.
PLCopen cũng yêu cầu data types, derived types, POU, local data, interface POU, syntax/
semantics và standard functions/function blocks rõ ràng khi nhận diện một programming
system IEC. Nguồn công khai dùng để định hướng scope:

- [IEC 61131-3:2025 — IEC Webstore](https://webstore.iec.ch/en/publication/68533)
- [PLCopen — How to recognize an IEC 61131-3 programming system](https://www.plcopen.org/standards/logic/iec-61131-3/how-to-recognize-iec-61131-3-programming-system/)
- [PLCopen Logic certification](https://www.plcopen.org/certification/logic/)

Bản IEC có license phải là nguồn normative cho feature matrix và test specification;
không dùng phần tóm tắt công khai thay cho nội dung chuẩn.

## 2. Hiện trạng và kết luận gap

| Khu vực | Hiện trạng 2026-07-22 | Kết luận cho Rev A.0 mới |
|---|---|---|
| FE Program | `ProgrammingPage` dùng local demo validator, deploy chỉ toast demo; model node/port lệch Core. | Thay bằng IEC project editor và build/deploy thật. |
| Backend | Chưa có owner đầy đủ cho IEC source, compile, revision, activate, rollback và audit. | Bổ sung project/build/deploy API authoritative. |
| SOM Core | Chạy proprietary `graph.json` với 28 node, topo-sort và cyclic scan. | Giữ lại logic hữu ích làm vendor FB/legacy importer; thêm compiler + IEC runtime thật. |
| SOM IOBus | Có ranh giới IOP/SHM/protocol, nhưng chưa nối với typed IEC variable/I/O map. | Giữ owner I/O; thêm binding, quality và output commit contract. |
| MCU firmware | `main.c` là skeleton, `.ioc` placeholder; chưa IOP/I/O/watchdog/HIL. | MCU implementation và HIL là blocker hệ thống dù IEC Part 3 chủ yếu áp dụng PSE/runtime. |
| Conformance | Không có normative feature matrix, conformance suite hoặc chứng thư độc lập. | Gate RED; cấm claim cho tới khi có evidence được duyệt. |

Không được đổi tên component graph hiện tại thành FBD. FBD/LD phải có syntax, semantics,
typed connections, POU interface và execution behavior theo feature profile IEC đã công
bố.

**Cập nhật đối chiếu code 2026-07-23 (review DOC-REV-005):** ngoài 5 mismatch FE/Core đã
liệt kê trong gap assessment, đối chiếu lại `services/core/graph_runtime.cpp` cho thấy
sample library của `ProgrammingPage.tsx` còn dùng node `UI_Input`, trong khi registry
28-node của Core **không có type này** — Core chỉ có `AI_Input` và `DI_Input` tách riêng.
Đây không phải lệch tên port/param như 5 case kia mà là thiếu hẳn counterpart; graph mẫu
của Program UI sẽ bị Core reject ngay ở node đầu tiên. Registry hợp nhất FE/Core ở §12/C8
phải xử lý case này, không chỉ đổi tên port.

## 3. Phạm vi IEC bắt buộc trong Rev A.0

### 3.1 Ngôn ngữ và cấu trúc chương trình

**Quyết định 2026-07-23 (ADR-018, RD-IEC-002 Modify):** Rev A.0 chỉ hỗ trợ **ST** và
**FBD** trong cùng một project và cùng một semantic engine:

- **Structured Text (ST)** — ngôn ngữ chính, bắt buộc;
- **Function Block Diagram (FBD)** — ngôn ngữ đồ họa chính trên Web IDE, bắt buộc;
- POU `PROGRAM`, `FUNCTION`, `FUNCTION_BLOCK`;
- configuration, resource và task binding tối thiểu cho một controller MK-DDC-24.

**Ladder Diagram (LD) và Sequential Function Chart (SFC) không triển khai trong Rev
A.0.** Typed IR và Program Schema phải thiết kế mở rộng được cho LD/SFC ở revision sau,
nhưng LD/SFC không nằm trong release gate Rev A.0 và không được claim hỗ trợ cho tới khi
có requirement/decision/test riêng.

Instruction List không thuộc target trong thiết kế này. Online change, safety-PLC
certification, IEC 61131-10 interchange và motion profile không được claim nếu chưa có
requirement/decision/test riêng. Mọi tham chiếu "IEC 61131-3:2025 Edition 4.0" trong tài
liệu này là **định hướng thiết kế** (IEC-aligned), không phải cam kết conformance đầy đủ
với bản chuẩn — xem lại phân biệt ở mục 1.1.

### 3.2 Type system

Compiler phải có type system IEC, không dùng một kiểu `double` chung như graph hiện tại.
Feature profile tối thiểu gồm:

- elementary types: `BOOL`, signed/unsigned integer widths, `REAL`, `LREAL`, bit-string
  widths, time/date types, `CHAR`/`WCHAR`, `STRING`/`WSTRING`;
- UTF-8 string behavior theo Edition 4 trong phạm vi feature matrix được phê duyệt;
- derived types: alias, enumeration, subrange, array và structure;
- strong type checking, literal range checking và explicit conversion;
- initial value, constant, local/global/input/output/in-out variables;
- retained/non-retained state với quy tắc power-cycle và warm/cold start được test.

Danh sách type/function chính thức, giới hạn độ dài string, range và feature optional
phải nằm trong `IEC_CONFORMANCE_PROFILE.md` được trích xuất từ bản chuẩn có license.

### 3.3 Standard functions và function blocks

Phải triển khai và test các nhóm được chọn trong conformity profile:

- numeric, arithmetic, comparison, selection và type conversion;
- boolean/bit-string;
- string, time/date;
- edge detection, bistable, timer và counter;
- POU call/interface, instance state và EN/ENO nếu áp dụng cho ngôn ngữ/profile.

Mỗi function/FB phải có semantic tests cho normal, boundary, invalid type, overflow,
time progression, restart và multi-instance isolation. Vendor FB cho BMS/IO/protocol
phải dùng namespace `MKDDC_*`, được phân biệt rõ với standard library.

### 3.4 Conformance statement

Mỗi release candidate phải sinh một machine-readable và human-readable statement gồm:

- standard edition và compiler/runtime version;
- ngôn ngữ được hỗ trợ;
- data types và optional features được hỗ trợ/không hỗ trợ;
- standard functions/FB được hỗ trợ;
- implementation-defined limits;
- known deviations bằng `0` đối với scope được claim;
- test run ID, artifact hash và approval/certificate reference.

## 4. Kiến trúc tổng thể đề xuất

**Quyết định 2026-07-23 (ADR-018, RD-IEC-004 Modify):** kiến trúc dưới đây thay thế bản
0.2/0.3 — đổi tên/role thành phần theo directive CTO, và bỏ LD/SFC editor khỏi Web IDE
(giữ IR/schema mở rộng được, không build editor). Tên service chính thức và API path
chi tiết là một đầu ra của C0 (`C0.9`, xem C0 plan); diagram dưới là kiến trúc mức
component, chưa phải API contract khoá cứng.

```text
Web IDE (React, trong mkddc-web frontend)
  ├─ ST text editor
  └─ FBD canvas (typed pin/wire)
          │ Program source + revision
          ▼
mkddc-program-service (backend, Go — gọi qua mkddc-web API)
  ├─ auth/RBAC/audit
  ├─ project repository
  ├─ build/deploy/artifact registry orchestration
  └─ calls fixed-version compiler tool (libmkddc_iec)
          │
          ▼
libmkddc_iec (compiler/semantic core, C++, versioned)
  ├─ parse ST + FBD
  ├─ IEC-aligned type/POU semantic analysis
  ├─ standard/vendor library resolution
  └─ deterministic typed IR + manifest (schema mở rộng cho LD/SFC sau)
          │ immutable package, hash, ABI
          ▼
mkddc-program-core (deterministic runtime interpreter, C++17)
  ├─ verify package and resource limits
  ├─ task scheduler + POU instances
  ├─ input snapshot / output staging
  ├─ safe atomic activation/rollback (không online change)
  └─ diagnostics + retain state
          │ typed point values + quality
          ▼
mkddc-iobus ── IOP v2 ── STM32 firmware ── physical UI/AO/DO
```

`libmkddc_iec` là library C++ dùng chung bởi compiler CLI và `mkddc-program-core` loader;
CLI chỉ phục vụ test/CI/recovery, không phải giao diện sử dụng chính (Web IDE mới là) và
không tạo core service thứ tư. `mkddc-program-service` không tự diễn giải semantics IEC.
`mkddc-program-core` luôn re-validate package header, hash, ABI, resource limit và I/O
binding trước activation. Runtime **không** thực thi trực tiếp source ST hay JSON graph —
chỉ thực thi artifact đã validate và compile thành typed IR. Mekong sở hữu toàn bộ source
code, schema, compiler pipeline, IR và runtime này (không phụ thuộc license/API/roadmap
bên thứ ba).

### 4.1 Nguyên tắc sở hữu

| State/decision | Owner duy nhất |
|---|---|
| Source project, revision, actor, audit | `mkddc-program-service` (module trong `mkddc-web`) |
| Syntax/type/POU/library semantics | `libmkddc_iec` |
| Build artifact và conformance profile binding | `libmkddc_iec` compiler CLI (versioned) |
| Active package, task execution, retain state, output arbitration | `mkddc-program-core` |
| Physical/protocol point value, unit, reliability/quality | `mkddc-iobus` |
| ADC/DAC/relay, IOP framing, watchdog, independent safe timeout | STM32 firmware |

Web/HMI mất kết nối không được dừng chương trình active. FE không được tự kết luận
`build successful` hoặc `deployed`; mọi trạng thái phải đến từ Backend/Core.

## 5. Thiết kế FE Program IDE

### 5.1 Project model và màn hình

Project tree phải có:

- `Configuration` → `Resource` → `Tasks` → Program instances;
- `Data Types`, `Global Variables`, `POUs`, `Libraries`, `I/O Mapping`;
- editor ST có syntax highlight, completion và diagnostic theo source range;
- canvas FBD có typed pin/wire, explicit execution order khi semantics yêu cầu;
- build result, active revision/hash, online task status và deployment history.

**Quyết định 2026-07-23 (RD-IEC-002 Modify):** canvas LD (rail/contact/coil) và editor SFC
(step/transition/action/qualifier) **không nằm trong Rev A.0** — không thiết kế/triển khai
UI cho hai ngôn ngữ này ngay bây giờ. Project tree và Program Schema phải chừa chỗ mở
rộng (ví dụ POU có thể khai báo ngôn ngữ nhưng chỉ `ST`/`FBD` được compiler chấp nhận ở
Rev A.0).

Canvas phải serialize thành canonical source model có version; vị trí/zoom là presentation
metadata và không được làm thay đổi semantics. Copy/paste hoặc reorder phải giữ stable ID
của symbol/instance khi không đổi đối tượng logic.

### 5.2 UI state machine

| State | Hành vi bắt buộc |
|---|---|
| `dirty` | Save/validate được phép; deploy bị khóa. |
| `syntax_error` | Hiện file/POU/range/code/message; không build artifact. |
| `semantic_error` | Hiện type, symbol, POU, task hoặc library lỗi; deploy bị khóa. |
| `build_ready` | Hiện source hash, compiler/profile version và resource estimate. |
| `deploy_pending` | Khóa mutation; hiển thị revision đang được Core validate/activate. |
| `active` | Hiển thị package hash, task state và rollback target từ Core. |
| `rejected` | Giữ active package cũ; hiển thị authoritative reason. |
| `runtime_fault` | Hiện task/POU/instruction context được phép, quality và safe-state; không báo healthy. |

Các nút demo/local-only và sample proprietary hiện tại phải bị loại khỏi production
route. Demo mode phải có banner cố định và không dùng chung nhãn `Deploy` với target.

### 5.3 FE acceptance

- Project mẫu ST và FBD phải round-trip không đổi semantics (LD/SFC ngoài phạm vi Rev A.0).
- Mỗi diagnostic từ compiler phải map về đúng POU/node/wire/source range.
- FE không cho nối wire khác type nếu không có conversion hợp lệ.
- Permission denial, build timeout, Core reject, rollback và mất kết nối phải có E2E test.
- Keyboard navigation, zoom, focus, color + symbol và màn hình nhỏ/lớn phải được review;
  màu không là kênh duy nhất biểu đạt state.

## 6. Thiết kế Backend, API và lưu trữ

**Lưu ý 2026-07-23:** path `/api/v1/iec/*` và tên file dưới đây là **placeholder mức
thiết kế**, chưa phải API contract khoá cứng — naming chính thức (có thể đổi `iec` thành
`program` để khớp thương hiệu "Mekong Program Runtime") là một đầu ra bắt buộc của C0
(`C0.9`, xem C0 plan). `pou/*.ld.json` và `pou/*.sfc.json` ở §6.2 chỉ là ví dụ minh hoạ
khả năng mở rộng schema, không triển khai trong Rev A.0.

### 6.1 API contract

| Method | Path | Trách nhiệm |
|---|---|---|
| `GET` | `/api/v1/iec/projects` | Danh sách project và active revision. |
| `POST` | `/api/v1/iec/projects` | Tạo project với configuration/resource/profile. |
| `GET/PUT` | `/api/v1/iec/projects/{id}/sources` | Đọc/ghi source theo optimistic revision. |
| `POST` | `/api/v1/iec/projects/{id}/validate` | Parse + semantic analysis, không sinh deployable package. |
| `POST` | `/api/v1/iec/projects/{id}/builds` | Build immutable package bằng compiler version được pin. |
| `GET` | `/api/v1/iec/builds/{build}` | Build result, diagnostics, manifest, resource estimate. |
| `POST` | `/api/v1/iec/builds/{build}/activate` | Yêu cầu Core verify và activate tại safe boundary. |
| `POST` | `/api/v1/iec/activations/{id}/rollback` | Quay về package đã active trước đó. |
| `GET` | `/api/v1/iec/runtime/status` | Active hash, tasks, cycle/overrun/fault/retain state. |
| `GET` | `/api/v1/iec/conformance` | Conformance profile và evidence reference của build active. |

Tất cả mutation cần authentication, RBAC, CSRF/session protection phù hợp, body/size
limit, request ID, idempotency key và audit actor/project/revision/hash/result. Compiler
được gọi bằng executable/argument cố định, working directory riêng, timeout, memory/CPU
limit; source text không được đưa vào shell command.

### 6.2 Source và artifact layout

```text
/data/config/iec/projects/<project-id>/revisions/<revision>/
  project.json
  types/*.st
  globals/*.st
  pou/*.st
  pou/*.fbd.json
  pou/*.ld.json
  pou/*.sfc.json
  io_map.json
  source-manifest.json

/data/config/iec/builds/<build-id>/
  manifest.json
  program.ir
  symbols.json
  diagnostics.json
  conformance-profile.json
```

Manifest deployable tối thiểu chứa `project_id`, `source_revision`, `source_hash`,
`compiler_version`, `standard_edition`, `profile_id`, `ir_schema`, `target_abi`,
`task_set`, `io_map_hash`, `resource_limits`, `artifact_hash` và `created_at`.

Write phải dùng temp file trong cùng filesystem, `fsync`, atomic rename và directory
sync. Artifact là immutable; activation chỉ tham chiếu build đã hash. Không build trực
tiếp từ file source active tại thời điểm reload.

### 6.3 Build và activation transaction

```text
save revision
  -> validate syntax/schema
  -> resolve symbols/types/POU/library
  -> validate task/I/O/resource limits
  -> lower to typed IR
  -> deterministic build repeated-hash check
  -> persist immutable artifact
  -> Core dry-run package verification
  -> request activation
  -> swap only at task/scan safe boundary
  -> report authoritative active hash
```

Nếu bất kỳ bước nào fail, package active cũ tiếp tục chạy. Power loss trong activation
phải phục hồi về đúng một package đã commit; không được có trạng thái source mới nhưng
runtime cũ bị báo nhầm là deployed.

## 7. Thiết kế compiler và IEC runtime trên SOM

### 7.1 Compiler pipeline

1. Lexer/parser riêng cho ST và canonical graphical model cho FBD (LD/SFC parser hoãn,
   không viết trong Rev A.0).
2. Xây symbol table theo project/configuration/resource/POU scope.
3. Resolve name, overload, type, constant expression và POU interface.
4. Kiểm recursion/unsupported feature, multi-writer, unbound I/O và resource limit.
5. Lower cả ST và FBD về cùng typed IR; source map giữ liên kết về editor. Schema IR phải
   chừa chỗ mở rộng cho LD/SFC ở revision sau.
6. Link standard library và versioned `MKDDC_*` vendor library.
7. Sinh deterministic artifact; cùng source/profile/compiler phải cho cùng hash.

Parser recovery chỉ phục vụ diagnostic; artifact không được sinh nếu có error. Warning
policy phải versioned và có khả năng nâng warning safety-relevant thành error.

### 7.2 Typed IR

IR là bytecode/register form có schema/version rõ, không phải `graph.json` v1.0. Mỗi
instruction chứa opcode typed, operand/index đã bounds-check, POU instance, source map
và execution metadata cần thiết. Loader phải reject:

- magic/schema/target ABI/compiler profile không khớp;
- hash/signature metadata hỏng;
- instruction, constant, string hoặc instance vượt limit;
- invalid jump/SFC transition/reference;
- I/O binding không tồn tại hoặc type/access không khớp;
- nhiều writer tới cùng physical output nếu không có arbitration owner được duyệt.

Runtime pre-allocate code, constant, instance và task memory khi load; không allocation,
file I/O hoặc network I/O trong scan execution.

### 7.3 Execution model

Mỗi resource có một tập task versioned. Rev A.0 phải hỗ trợ tối thiểu cyclic task;
event task chỉ được bật khi feature matrix, scheduling rule và test đã duyệt. Không có
bước SFC transition/action (SFC hoãn theo §3.1, RD-IEC-002).

Một cyclic scan:

```text
read monotonic time
  -> capture coherent typed input/quality snapshot
  -> execute Program instances in declared task order
  -> apply priority/interlock/safety arbitration
  -> commit staged outputs once through Core -> IOBus
  -> publish diagnostics and retained dirty state outside critical path
```

Task priority, period, watchdog budget và Program order nằm trong project manifest.
Compiler reject dependency không xác định. Runtime đo execution time/overrun; scan lỗi
không được commit output chưa hoàn tất. Overrun policy và safe output phải cấu hình có
giới hạn, có alarm, fault injection test và không phụ thuộc Web/HMI.

### 7.4 State, retain và restart

- Function không giữ instance state; Function Block có state riêng cho từng instance.
- `RETAIN` chỉ dùng cho type/size được profile cho phép và lưu bằng schema + project hash.
- Artifact đổi incompatible layout phải yêu cầu migration hoặc cold-start rõ ràng.
- Retain record dùng CRC/hash, atomic write và bounded wear policy.
- Corrupt/mismatched retain data phải bị reject, tạo diagnostic và khởi tạo theo policy;
  không silently đọc bytes của layout cũ.
- Cold start, warm start, process restart và power loss phải có test riêng.

### 7.5 Component graph hiện tại

28 node hiện tại không bị xóa ngay. Cách dùng được duyệt:

- logic toán học/timer/PID phù hợp được tái sử dụng bên dưới standard hoặc `MKDDC_*` FB
  sau khi semantics/type/state được kiểm chứng;
- protocol node trở thành vendor FB có interface, quality và error semantics rõ;
- tool migration có thể chuyển graph cũ sang draft FBD/vendor-FB project;
- kết quả migration luôn cần compile + semantic diff + reviewer approval;
- không có conversion tự động thì graph legacy chỉ chạy trong compatibility mode,
  không được gắn claim IEC.

## 8. I/O mapping, quality và output safety

IEC project dùng symbolic variables. `io_map.json` bind located/symbolic variable tới
point contract có type, direction, unit, scale ownership, writable policy và quality.
Ví dụ conceptual:

```json
{
  "SupplyTemp": { "point": "UI-01", "type": "REAL", "direction": "input", "unit": "degC" },
  "FanEnable":  { "point": "DO-01", "type": "BOOL", "direction": "output" }
}
```

Quy tắc bắt buộc:

- Core nhận input snapshot có value + timestamp + quality/reliability.
- IEC standard variable không tự mất type khi qua SHM/API.
- Quality được dùng qua namespaced vendor type/FB; bad/stale/unreliable không silently
  biến thành giá trị GOOD.
- Một physical output chỉ có một owner sau arbitration; force/manual/safety priority vẫn
  thuộc Core, không bị IEC program bypass.
- AO engineering-to-electrical conversion chỉ thực hiện một lần tại boundary đã duyệt;
  MCU nhận raw/electrical command theo IOP contract.
- NaN, infinity, out-of-range, unbound point hoặc mode mismatch bị reject trước commit.

## 9. Thiết kế SOM IOBus và STM32 firmware

IEC 61131-3 Part 3 không phải coding standard cho driver STM32. Tuy vậy hệ thống không
thể chứng minh chương trình IEC điều khiển controller đúng nếu I/O path và firmware vẫn
là skeleton.

### 9.1 SOM IOBus

`mkddc-iobus` tiếp tục sở hữu:

- IOP v2 session, 921600 baud, poll 2 ms và fault/retry policy theo shared header;
- conversion raw → engineering value và reliability/quality;
- typed point snapshot cho Core;
- AO/DO command validation và single conversion boundary;
- Modbus/BACnet cache cho `MKDDC_*` vendor FB;
- diagnostics cho stale SHM, IOP fault, sequence/CRC, mode ACK và MCU fault flags.

Thay đổi IEC không được làm Web hoặc compiler truy cập trực tiếp UART/SHM output.

### 9.2 STM32 module bắt buộc

| Module | Trách nhiệm |
|---|---|
| `board` | Clock, GPIO, SPI, UART, DMA, timer, watchdog theo schematic/CubeMX đã duyệt. |
| `iop_comm` | UART DMA/IDLE, bounded frame parser, CRC-16/Modbus, LEN/SEQ, handshake, ACK/NACK. |
| `io_sample` | 2 × ADS131M08 init/DRDY/SPI DMA, int32 sample, channel/fault state. |
| `ao_do` | DAC8554, mode latch/ACK, AO range check, relay command và feedback. |
| `diag_wdg` | Watchdog, reset reason, VDD/temp/fault flags và `GET_DIAG`. |
| `safe_state` | Không có master frame hợp lệ 200 ms → AO safe + DO open theo approved config. |

Firmware loop phải feed communication-safe timer chỉ từ frame master hợp lệ; frame sai
CRC/LEN/SEQ không được giữ output khỏi safe timeout. Watchdog feed phải phản ánh health
của scheduler/I/O, không chỉ việc CPU còn chạy vòng lặp.

### 9.3 Firmware/HIL acceptance

- Shared CRC/frame vectors chạy giống nhau trên SOM host và MCU target.
- `HANDSHAKE_RESP` capability Rev A.0 = `0x000D` nếu shared header và hardware approved
  vẫn quy định như vậy.
- `IO_RESP` payload/endianness/length đúng `shared/iop_protocol.h`.
- Invalid/unknown command không mutate output và trả lỗi xác định.
- UART disconnect, corrupted frame, ADC loss, DAC/relay fault và watchdog reset được
  fault-inject trên target.
- 200 ms safe timeout được đo bằng instrument/log có timestamp trên board thật.

## 10. Failure behavior bắt buộc

| Failure | Hành vi thiết kế |
|---|---|
| FE/Backend down | Core tiếp tục package active; local control không dừng. |
| Source/compile lỗi | Không tạo deployable artifact; package active không đổi. |
| Artifact/hash/ABI lỗi | Core reject trước activation và audit reason. |
| Activation timeout/crash | Boot/continue package last-known-good đã commit. |
| Task runtime fault | Không commit partial output; raise diagnostic và áp dụng approved safe policy. |
| Task overrun | Ghi WCET/overrun, alarm; repeated threshold chuyển safe theo config đã test. |
| Missing/bad I/O | Propagate quality; program/vendor FB xử lý theo contract; safety vẫn authoritative. |
| IOBus/SHM stale | Core không coi dữ liệu là GOOD; output về policy an toàn. |
| MCU mất poll >200 ms | MCU độc lập ép AO/DO về safe behavior. |
| Retain corrupt/incompatible | Reject record, diagnostic và explicit cold-start/migration policy. |

## 11. Candidate requirements phải đưa vào baseline

Tất cả requirement dưới đây có **Source: ADR-018 / CTO decision 2026-07-23** (trước đây
ghi "management corrective directive 2026-07-22" — nay đã có decision record truy vết
được, xem mục 1 và header), **Priority: Must**, **Owner: Project Engineering**, và chỉ
được đánh dấu Accepted sau khi cập nhật `REQUIREMENTS.md` cùng traceability.

| ID | Shall statement | Verification và acceptance |
|---|---|---|
| SYS-REQ-IEC-001 | Rev A.0 shall cung cấp Program Runtime do Mekong sở hữu, IEC 61131-3-aligned, trong scope ST+FBD công bố (không phải conformance đầy đủ IEC 61131-3:2025). | Inspection + conformance test cho đúng scope ST+FBD; profile có revision, không deviation trong scope claim. |
| SWR-REQ-IEC-001 | PSE shall parse, edit, build và execute **ST và FBD** bằng cùng semantic/type engine. LD/SFC không thuộc Rev A.0 (schema mở rộng được, không triển khai). | Positive/negative suite ST + FBD + mixed-language (ST gọi FBD POU) project pass. |
| SWR-REQ-IEC-002 | Compiler shall hỗ trợ POU Program, Function, Function Block, scope và typed interface. | POU conformance matrix pass; local/instance isolation được chứng minh. |
| SWR-REQ-IEC-003 | Compiler shall triển khai data types/derived types và conversion đúng approved profile. | Boundary/overflow/invalid conversion tests pass cho từng feature. |
| SWR-REQ-IEC-004 | Standard functions/FB shall khớp semantics/time/state trong approved profile. | Golden vectors + time/restart/multi-instance tests pass. |
| SWR-REQ-IEC-005 | Compiler shall tạo deterministic typed artifact có source/profile/compiler/ABI hash. | Hai clean build cùng input cho cùng artifact hash. |
| SWR-REQ-IEC-006 | Core shall verify package và atomically activate chỉ tại safe task boundary. | Fault injection chứng minh old package tiếp tục khi reject/timeout/power loss. |
| SWR-REQ-IEC-007 | Runtime shall thực thi task/POU deterministically, đo cycle/WCET/overrun và không allocation trong scan. | Static inspection + target timing test đạt budget đã duyệt. |
| SWR-REQ-IEC-008 | FE shall không báo validate/build/deploy thành công nếu chưa có authoritative Backend/Core result. | API/E2E denial, timeout, reject và rollback tests pass. |
| SWR-REQ-IEC-009 | Project revision, build, activation và rollback shall được RBAC-control và audit. | Security/API tests xác nhận actor/hash/result và denial. |
| IF-REQ-IEC-001 | IEC variables shall bind typed I/O points có direction, unit, range và quality rõ. | Mapping/round-trip/negative tests; wrong type/direction/range bị reject. |
| SAFE-REQ-IEC-001 | IEC program shall không bypass Core priority, interlock, safety hoặc MCU independent safe timeout. | Bypass review + process/UART fault injection + HIL pass. |
| NFR-REQ-IEC-001 | Runtime shall tiếp tục active control khi FE/Web mất kết nối và recover không replay mutation. | Multi-process fault test pass. |
| FW-REQ-MCU-001 | MCU shall implement IOP v2 parser/serializer và I/O drivers theo shared contract. | Host vectors + target protocol/HIL pass. |
| FW-REQ-MCU-002 | MCU shall force approved safe outputs nếu không có master traffic hợp lệ trong 200 ms. | Target/HIL đo timeout và output pass. |

## 12. Kế hoạch triển khai theo vertical slice

**Cập nhật 2026-07-23 (quyết định CTO, Q8):** chi tiết đầy đủ theo slice đã tách sang hai
tài liệu riêng theo đúng yêu cầu "các tài liệu tiếp theo phải phục vụ trực tiếp việc
triển khai":

- [`KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md`](../07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md)
  — C0, chia microtask C0.1–C0.15 (owner/input/output/dependency/acceptance/effort/risk/
  trạng thái), bao gồm sizing cho C1–C10 (đóng open point DOC-REV-006).
- [`KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md`](../07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md)
  — C1–C10, mỗi slice có mục tiêu chạy được, component, API/schema, backend/frontend/
  runtime/firmware task, test case, acceptance criteria, demo scenario, rollback, DoD.

Bảng dưới đây chỉ là **tóm tắt điều hướng**, không phải nguồn kế hoạch — khi có khác biệt,
hai tài liệu trên thắng.

| Slice | Nội dung tóm tắt | Trạng thái |
|---|---|---|
| C0 Architecture & Feasibility Baseline | Chốt scope matrix, type system, Program/Resource/Task/POU model, typed IR spec, compiler/runtime boundary, Web IDE/backend/device architecture, scheduler model, standard FB baseline, security/audit model, test strategy, build-vs-reuse assessment, sizing C1–C10, backlog. Prototype/spike giới hạn được phép, tách khỏi production code. | **Duy nhất được mở** — Trạng thái chi tiết ở C0 plan |
| C1 Program project, version, artifact registry | Project/source/revision model, artifact registry, versioning. | Chưa bắt đầu — blocked by C0 |
| C2 Typed variables, tag binding, I/O image | Type system thực thi, tag/virtual variable binding, I/O image contract. | Chưa bắt đầu — blocked by C0, C1 |
| C3 Task scheduler, deterministic runtime loop | `mkddc-program-core` scheduler, cyclic scan, retain, atomic activation. | Chưa bắt đầu — blocked by C1, C2 |
| C4 ST parser, semantic, IR | `libmkddc_iec` ST subset → typed IR. | Chưa bắt đầu — blocked by C1, C2 |
| C5 ST Web editor, build, deploy | Web IDE ST editor, build/deploy pipeline end-to-end. | Chưa bắt đầu — blocked by C3, C4 |
| C6 Standard function/function block library | Numeric/boolean/timer/counter/edge, `MKDDC_*` namespace. | Chưa bắt đầu — blocked by C4 |
| C7 FBD editor, graph-to-IR | FBD canvas, typed pin/wire, cùng IR với ST. | Chưa bắt đầu — blocked by C3, C4 |
| C8 Runtime trace, diagnostics, audit | Trace/diagnostic, audit log đầy đủ cho build/deploy/activate/rollback. | Chưa bắt đầu — blocked by C5 |
| C9 SOM–MCU integration, safe state, HIL | IOP, ADC, DAC, relay, watchdog, safe timeout; độc lập C1–C8. | Chưa bắt đầu — blocked by C0 only (song song được với C1–C8) |
| C10 Conformance, soak test, release hardening | Normative trace matrix, regression, soak test, PLCopen/certification nếu áp dụng. | Chưa bắt đầu — blocked by C1–C9 |

Thứ tự và nội dung C1–C10 ở trên **thay thế** thứ tự cũ trong bản 0.2/0.3 (vốn theo
C1=kernel chung, C2=ST, C3=FBD, C4=LD, C5=SFC...) theo chỉ đạo CTO 2026-07-23; LD (C4 cũ)
và SFC (C5 cũ) không còn slice riêng vì đã hoãn khỏi Rev A.0. Legacy graph migration
(C8 cũ, gồm gap `UI_Input` ở §2) và MCU/HIL giữ nguyên tinh thần, nay là C9 và một phần
C2/C6.

### 12.1 Sizing/resourcing — đã đóng open point (Q8, 2026-07-23)

Trước đây (DOC-REV-006) không có effort/timeline/budget estimate. CTO quyết định: mở
**C0 có giới hạn phạm vi/thời gian/đầu ra cố định** để chính C0 tạo ra sizing cho
C1–C10 (workstream `C0.14`, xem C0 plan) — không cấp sizing trước, không mở C1 trước khi
C0 duyệt. Đây không phải "chưa có sizing" nữa mà là "sizing là một deliverable của C0",
tình trạng đã đóng.

## 13. Verification và evidence plan

### 13.1 Conformance test layers

1. **Normative feature matrix:** mỗi clause/table/feature áp dụng → requirement → design
   component → test case → result.
2. **Parser/semantic:** valid/invalid syntax, scope, type, overload, POU interface,
   literals, conversion và diagnostics.
3. **Language execution:** ST/LD/FBD/SFC golden programs, mixed-language calls và
   equivalent-semantics programs.
4. **Library:** mỗi standard function/FB với boundary, timing, restart và instances.
5. **Runtime:** task order, input snapshot, output staging, retain, activation, rollback,
   overrun và resource exhaustion.
6. **System:** Backend/FE/Core/IOBus process loss, SHM/IOP faults và recovery.
7. **Target/HIL:** WCET, UART timing, physical I/O, watchdog và 200 ms safe timeout.
8. **Independent assessment:** PLCopen accredited lab/certification scope nếu release
   claim yêu cầu `certified` hoặc governance yêu cầu external conformity evidence.

### 13.2 Evidence record tối thiểu

Mỗi result phải ghi requirement/test ID, commit, source/build/artifact hash, compiler và
toolchain version, standard/profile revision, target HW/FW revision, command/setup,
raw log, pass/fail, operator, reviewer, timestamp và artifact location.

Host tests hiện có của component graph không được relabel thành IEC evidence. Firmware
cross-compile không thay cho target behavior/HIL. Không có docs harness trong repo hiện
tại; Markdown/link checks chỉ chứng minh chất lượng tài liệu.

## 14. Release gates và claim policy

| Gate | Điều kiện đóng | Hiện tại |
|---|---|---|
| G0 Scope/ADR | Product + ADR + requirements phê duyệt IEC-aligned ST+FBD trong Rev A.0. | **GREEN** — ADR-018 Accepted, `PRODUCT.md`/`SOFTWARE.md`/`DECISIONS.md`/`REQUIREMENTS.md`/`VERIFICATION.md`/`TRACEABILITY.md` cập nhật 2026-07-23; 31/31 document conflict đóng |
| G1 PSE | FE/Backend hỗ trợ project, **ST + FBD** (LD/SFC ngoài scope), build/deploy thật. | **RED** |
| G2 Compiler | Type/POU/library/IR feature matrix pass. | **RED** |
| G3 Runtime | Deterministic task execution, activation, retain và fault behavior pass. | **RED** |
| G4 I/O/MCU | Typed I/O integration + STM32 target/HIL pass. | **RED** |
| G5 Conformance | Normative trace matrix không còn open deviation trong claim scope. | **RED** |
| G6 Approval | Engineering/QA/Product sign-off; external report/certificate nếu áp dụng. | **RED** |

Cho đến khi G0–G6 đóng:

- được nói: `IEC 61131-3 implementation in development for Rev A.0`;
- không được nói: `IEC 61131-3 compliant`, `conformant` hoặc `certified`;
- Rev A.0 Program và production control release là **NO-GO**.

Không dùng waiver để đổi một open conformance deviation thành `compliant`. Nếu bỏ một
feature optional, phải ghi rõ trong approved conformity profile và không tạo claim rộng
hơn scope đã test.

## 15. Điểm cần review/phê duyệt — **Decided 2026-07-23**

| ID | Quyết định | Đề xuất bản 0.2 (lịch sử) | **Quyết định cuối cùng (CTO, 2026-07-23)** |
|---|---|---|---|
| RD-IEC-001 | IEC 61131-3 có bắt buộc trong chính Rev A.0 không? | Có — management directive; không defer. | **Modify — Có, nhưng chỉ MVP ST+FBD**, không toàn bộ 4 ngôn ngữ/feature PLC thương mại. |
| RD-IEC-002 | Language scope nào? | ST + LD + FBD + SFC trong cùng semantic/runtime. | **Modify — chỉ ST + FBD.** LD/SFC hoãn, không thuộc Rev A.0. |
| RD-IEC-003 | Component graph xử lý thế nào? | Legacy/importer và nguồn implementation vendor FB; không gọi là FBD. | **Approve.** |
| RD-IEC-004 | Runtime architecture nào? | Typed deterministic IR interpreter trong Core, compiler library/CLI versioned. | **Modify** — `libmkddc_iec` (compiler) + `mkddc-program-service` (backend) + `mkddc-program-core` (runtime); Web IDE là giao diện chính, CLI chỉ test/CI/recovery. |
| RD-IEC-005 | Có online change trong Rev A.0 không? | Không claim; dùng build + atomic activation tại safe boundary. | **Approve.** |
| RD-IEC-006 | External certification có là release gate không? | Đề xuất có nếu datasheet/tender dùng `certified`; ít nhất independent conformity review cho `compliant`. | **Modify — không phải release gate Rev A.0.** Cấm "certified"/"compliant"; chỉ cho phép mô tả "IEC 61131-3-aligned". Xem xét certification ở revision sau. |
| RD-IEC-007 | Firmware skeleton có được release cùng IEC runtime không? | Không; MCU target/HIL là system release blocker. | **Approve.** |

Quyết định đầy đủ (câu trả lời nguyên văn, lý do) nằm tại
[`KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md`](../07_records/reviews/KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md)
và [`ADR-018-mekong-owned-iec-aligned-program-runtime.md`](../adr/ADR-018-mekong-owned-iec-aligned-program-runtime.md).
Tài liệu này vẫn ở `Draft` cho tới khi C0 hoàn thành và `REQUIREMENTS.md`/
`VERIFICATION.md`/`TRACEABILITY.md` được cập nhật theo ADR-018 (G0 §14 đóng hẳn).

### 15.1 Approval log

| Reviewer | Role | Ngày | RD-ID | Quyết định | Comment/deviation | Action owner |
|---|---|---|---|---|---|---|
| Phạm Đình Chương | Project Engineering Owner / CTO | 2026-07-23 | Q0 (DOC-REV-001) | Directive có thật, xác nhận ngày 2026-07-23 | Override gap assessment §8.1; lý do: Mekong sở hữu Program Runtime, không phụ thuộc runtime bên ngoài | Project Engineering — ghi ADR-018 |
| Phạm Đình Chương | Project Engineering Owner / CTO | 2026-07-23 | RD-IEC-001..007 | Xem bảng trên (Modify ×4, Approve ×3) | — | Project Engineering — cập nhật Requirements/Verification/Traceability |
| Phạm Đình Chương | Project Engineering Owner / CTO | 2026-07-23 | Q8 (sizing) | Mở C0 giới hạn, sizing C1–C10 là deliverable của C0 | Owner ước lượng: Program Runtime Architect + SOM Backend Lead + Firmware Lead + QA/HIL Lead | C0 plan `C0.14` |

Nguồn đầy đủ (Q0–Q9) tại
[`KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md`](../07_records/reviews/KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md).

## 16. Revision history

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-22 | Đề xuất đóng Rev A bằng proprietary component graph và hoãn IEC; hướng này bị supersede. |
| 0.2 | 2026-07-22 | Làm lại thành corrective design bắt buộc IEC 61131-3:2025 ngay trong Rev A.0, gồm FE/BE/compiler/Core/IOBus/MCU, requirements, verification và release gates. |
| 0.3 | 2026-07-23 | Document review (structure + design), findings tại [`KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md`](../07_records/reviews/KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md): ghi chú tường minh mâu thuẫn với gap assessment cùng ngày và directive chưa truy vết được (DOC-REV-001); backlink hai tài liệu (DOC-REV-002); khai báo tài liệu là biến thể corrective-design của `TEMPLATE_DDD.md` (DOC-REV-003); thêm khung approval log ở §15.1 (DOC-REV-004); bổ sung gap `UI_Input` không có counterpart trong Core registry vào §2 (DOC-REV-005); thêm open point sizing/resourcing ở §12.1 (DOC-REV-006); bổ sung Trạng thái/Entry criteria/Owner/Phụ thuộc vào bảng §12 (DOC-REV-007). Không có thay đổi code; không đổi trạng thái Draft; không tự quyết RD-IEC-001. |
| 0.5 | 2026-07-23 | **Repository sync (ACTION-01..05).** `REQUIREMENTS.md`, `VERIFICATION.md`, `TRACEABILITY.md` cập nhật đầy đủ cho scope ST+FBD; 31 document conflict trong toàn repo (legacy `01_specs/*`, `00_management/*`, 3 ADR lịch sử, 1 implementation guide, +5 phát hiện thêm) đã đóng — xem `KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md` v2.0. Datasheet `DS_MK-DDC-24_VI.md` bỏ claim "IEC 61131-3: Compliant" (vi phạm cấm claim). `PM-IMPLPLAN-001` làm rõ Program Editor Rev A.0 = ST Text Editor + FBD Graphical Editor (không gọi chung "canvas"), theo xác nhận trực tiếp của CTO. G0 (§14, header) chuyển GREEN. |
| 0.4 | 2026-07-23 | **CTO decision applied (ADR-018).** DOC-REV-001 đóng: directive xác nhận có thật, ghi thành `ADR-018-mekong-owned-iec-aligned-program-runtime.md`, ADR-004 → Superseded. Phạm vi ngôn ngữ thu hẹp còn **ST + FBD** (LD/SFC hoãn, bỏ khỏi §3.1/§5.1/§5.3/§7.1/§7.3/§11/§14/§15). Kiến trúc đổi tên: `mkddc-web`→`mkddc-program-service` (backend, Go) và `mkddc-core`→`mkddc-program-core` (runtime, C++17) cho phần Program; `libmkddc_iec` giữ nguyên vai trò compiler (§4/§4.1). Xác nhận không online change, không claim certified/compliant (chỉ "IEC 61131-3-aligned"). §12 rút gọn thành tóm tắt điều hướng, chi tiết chuyển sang hai tài liệu mới `KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md` và `KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md`; sizing (DOC-REV-006) đóng thành deliverable `C0.14`. §15 điền quyết định thật + approval log. G0 (§14) chuyển YELLOW: ADR-018/`PRODUCT.md`/`SOFTWARE.md`/`DECISIONS.md` đã cập nhật; `REQUIREMENTS.md`/`VERIFICATION.md`/`TRACEABILITY.md` còn lại, tracked ở `KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md`. Chỉ C0 được phép bắt đầu; không có thay đổi code. |
