# PRODUCT SPECIFICATION — PROGRAMMING ENGINE — MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| Document ID | `DDC24-PRG-PRODUCT-SPEC-001` |
| Product | MK-DDC-24 — BMS Edge Automation Controller |
| Module | Programming / BACS Engineering Runtime |
| Release target | Rev A.0 |
| Revision | **v2.2 — đóng phản biện vòng 2 ngày 2026-08-09** |
| Status | **Proposal / In Review — không phải Product baseline** |
| Date | 2026-08-09 |
| Primary languages | Structured Text (ST) + Function Block Diagram (FBD) |
| Architecture decision | Mekong-owned IEC-aligned runtime; **không tuyên bố IEC 61131-3 full conformance** ở Rev A.0 |
| Product design principle | **BACS workflow ở phía người dùng; IEC runtime + safety/versioning ở phía hệ thống** |
**Project source baselines:** `PROD-PROG-001`; `REQBASE-PROG-001`;
`PROG-OD-001-AUD`; ADR-005/020/021/023; quyết định ADR-024 tại
`DECISIONS.md`; Programming implementation audit 2026-08-08; OpenAPI và source
`apps/` đã đối chiếu.

**Quan hệ quyền tài liệu:** Tài liệu này là **đề xuất sửa đổi** cho
`docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` (`PROD-PROG-001`, Active).
Nó không supersede, không làm yếu và không thay đổi trạng thái của
`PROD-PROG-001`, `REQBASE-PROG-001` hoặc `VR-PROG-*`. Sau khi Product/Architecture
phê duyệt và đóng các `OD-PROG-*` liên quan, nội dung được chấp thuận phải được
hợp nhất vào tài liệu chủ quản, ma trận traceability và Verification; không duy
trì tài liệu này như Product authority thứ hai.

> **Ghi chú kiểm soát 2026-08-09 — bổ sung Amendment A1.** Ngày 2026-08-09, một
> đề xuất đơn giản hóa được thêm **trực tiếp vào tài liệu chủ quản**
> `PROD-PROG-001` §8–§9 thay vì vào đây, đúng nguyên tắc “không duy trì Product
> authority thứ hai”. Nội dung gồm: định vị cạnh tranh cho hãng nhỏ, benchmark
> bốn sản phẩm bằng nguồn chính thức, bảng điểm heuristic tám tiêu chí, lớp
> **tám user journey** `UJ-PROG-01..08`, và Must/Should/Won't cho Rev A.
>
> Amendment A1 **không** mở rộng phạm vi Rev A và **không** đổi bất kỳ hành vi
> an toàn nào ở §16 và §18 của tài liệu này. Nó chỉ đổi cách tổ chức giao diện
> và cách trình bày xác nhận. Phê duyệt theo dõi tại
> [`OD-PROG-016`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md); phạm vi thư
> viện mẫu BMS theo dõi tại `OD-PROG-017`.

## Mục lục

- §0–4: cách đọc, mục tiêu, chuẩn tham chiếu, định vị và mental model.
- §5–13: phạm vi, nguồn chân lý, kiến trúc logic, model IEC, ngôn ngữ, thư viện,
  kiểu dữ liệu và Point mapping.
- §14–18: scheduler, ranh giới compiler, commissioning, integrity và RETAIN.
- §19–24: completion, runtime/service, alarm, RBAC, capability và ranh giới UX.
- §25–29: requirement, NFR, gap, release gate và catalog kiểm chứng duy nhất.
- §30–35: nguồn, quyết định mở, hướng sản phẩm, xử lý phản biện, lịch sử và phê duyệt.

## Thuật ngữ chuẩn

| Thuật ngữ | Nghĩa dùng trong tài liệu |
|---|---|
| **Check** | Kiểm tra source, kiểu, mapping, Task, target và policy; không thay đổi runtime đang active. |
| **Draft** | Bản đang sửa do backend store quản lý; chưa phải runtime truth. |
| **Candidate** | Revision đã Check đạt và được stage để runtime thẩm định; chưa phải Active. |
| **Đưa vào vận hành** | Hành động người dùng yêu cầu Commission; runtime chỉ xác nhận thành công sau read-back authoritative. |
| **Revision** | Snapshot bất biến của source, mapping, Task, library version và metadata. |
| **Đóng góp mức 5** | Giá trị `program_value` do Local logic đưa vào priority resolver; không phải `actual_value`. |
| **`actual_value`** | Giá trị hiệu lực sau interlock/priority resolver và giới hạn cuối; có thể thuộc nguồn mức 1–4. |
| **Hold-last** | Giữ liên tục đóng góp mức 5 qua activation/restore; không sao chép giá trị của nguồn ưu tiên khác. |
| **Cutover** | Chuyển quyền sở hữu Local logic giữa `GRAPH_ONLY` và `PROGRAM_ONLY`; không cho dual-run. |
| **Functional tag/view** | Metadata/view tùy chọn để nhóm Program/Point; không phải entity lifecycle thứ tư. |
| **Last-Known-Good (LKG)** | Revision active gần nhất đã được runtime xác nhận vận hành hợp lệ. |

---

## 0. Đọc trước — các điểm không được hiểu sai

1. **MK-DDC-24 là programmable generic DDC/BACS automation station**, không phải PLC IDE đổi tên và không khóa theo AHU/FCU.
2. **Programming Rev A.0 là IEC 61131-3 aligned subset**, không được quảng cáo “IEC 61131-3 compliant/certified” cho tới khi có grammar/semantic/conformance evidence tương ứng.
3. **ST + FBD là phạm vi Release 1.** LD/SFC chỉ để chừa khả năng mở rộng; không xuất hiện như tính năng production Rev A.0.
4. **Runtime không chạy trực tiếp source ST/FBD document.** Target architecture là Source → Parse/Semantic → Typed IR → Validated Artifact có integrity hash → Atomic Activation.
5. **Các chi tiết compiler/artifact là implementation detail.** User DDC bình thường không cần nhìn “IR schema/hash/ABI” trong workflow chính.
6. **User-facing lifecycle phải theo mental model BACS:** Design → Engineering → Check → Commission → Run → Service.
7. **Backend/runtime vẫn giữ lifecycle an toàn:** Validate → Compile → Verify → Atomic Activate → Last-Known-Good → Rollback.
8. **Không biến build error thành process alarm.** Syntax/type/mapping/build lỗi là Engineering Diagnostics; runtime/safe-state condition có thể trở thành operational alarm nếu policy yêu cầu.
9. **Không bịa dữ liệu.** Thiếu producer → `Unknown/—`; mất dữ liệu → `Stale/Offline`.
10. **RBAC role không đồng nghĩa persona.** Hệ thống vẫn dùng `viewer < operator < admin`, nhưng UX phải thiết kế theo Operator / Commissioning Engineer / Controls Engineer / Service Technician.
11. **Standards alignment ≠ certification.** Tài liệu này là proposal; mọi claim
    conformity chính thức phải có evidence record, requirement traceability và
    test evidence được phê duyệt.
12. **As-Built không phải Target.** Graph runtime hiện đang là đường production;
    ST/FBD runtime end-to-end vẫn `NOT IMPLEMENTED`, `0/12 capability COMPLETE`
    và `VR-PROG-001..013 = RED` tại record 2026-08-08.

---

## 1. Mục tiêu sản phẩm

Programming Engine cho phép kỹ sư **thiết kế, cấu hình, kiểm tra, đưa vào vận
hành và duy trì logic điều khiển BACS** trực tiếp trên MK-DDC-24 bằng ST/FBD,
sử dụng Point model thống nhất và thay Revision có kiểm soát mà không làm gián
đoạn Revision đang hoạt động tốt.

### 1.1 User-visible workflow

```text
DESIGN
  ↓
ENGINEERING
  ↓
CHECK
  ↓
ĐƯA VÀO VẬN HÀNH
  ↓
RUN
  ↓
SERVICE
```

### 1.2 System-internal workflow

```text
Edit Source/FBD
    ↓
Parse + Semantic Check
    ↓
Typed IR
    ↓
Build immutable artifact
    ↓
    Integrity Verify
    ↓
Stage
    ↓
Atomic Activate at safe boundary
    ↓
RUN
    ↓
Last-Known-Good / Restore Previous
```

### 1.3 Product promise

> **Lập trình DDC dễ như engineering tool BMS, nhưng runtime phía dưới phải có determinism, version integrity, safe activation và recovery tương đương một nền tảng control chuyên nghiệp.**

---

## 2. International Standards Alignment Baseline

### 2.1 Danh mục tham chiếu định hướng, chưa phải evidence chuẩn hóa

| Standard | Vai trò trong MK-DDC-24 Programming | Design consequence |
|---|---|---|
| **IEC 61131-3 / IEC TR 61131-8** | ST, FBD, POU và hành vi công cụ lập trình | ST/FBD dùng chung semantic; diagnostics có vị trí; không expose compiler internals như UX concept |
| **ISO 16484 series** | Vòng đời và chức năng BACS | Workflow theo task BACS; Point và functional context có truy nguyên |
| **ISO 9241-110/-115/-210/-171** | Tương tác, điều hướng, human-centred design và accessibility | Task flow, recovery, keyboard, focus, text+icon state |
| **IEC 62443-4-1/-4-2** | Secure development và component security | RBAC, audit, integrity, least privilege; signature reject là security event khi policy ký được bật |
| **IEC 62682** | Alarm management | Tách Engineering Diagnostics khỏi operational alarms |

Số hiệu edition/năm ở v2.0 chưa có evidence record trong repo nên đã bị bỏ khỏi
normative text. Trước khi tái ghi edition/năm hoặc claim “đã review”, hồ sơ phải
liệt kê nguồn catalogue chính thức, ngày truy xuất và người xác nhận; mục chưa
xác minh phải ghi `UNVERIFIED`.

### 2.2 Quy tắc claim

Rev A.0 chỉ được mô tả:

> **IEC 61131-3 aligned ST/FBD programming model**
> **BACS engineering workflow informed by ISO 16484 series**

Không được ghi:

- IEC 61131-3 certified.
- ISO 16484 certified.
- IEC 62443 certified.

cho tới khi có chương trình đánh giá/chứng nhận và evidence chính thức.

### 2.3 Quy tắc dùng reference

Không dùng nội dung draft, preview hoặc mô tả catalogue làm requirement bắt
buộc. Requirement của dự án chỉ có authority khi mang ID dự án và có trace tới
Verification.

---

## 3. Định vị Programming trong MK-DDC-24

```text
MK-DDC-24
├── OPERATION
│   ├── Dashboard
│   ├── Monitor / Points
│   ├── Alarms
│   ├── Trends
│   └── Scheduler
│
├── ENGINEERING
│   ├── Commissioning
│   ├── Programming            ← tài liệu này
│   ├── Inputs / Outputs
│   ├── Virtual Points
│   ├── Modbus
│   └── Alarm Configuration
│
└── SYSTEM
    ├── Network
    ├── Device
    ├── Users
    └── Diagnostics
```

Programming không tạo một hệ I/O riêng. Mọi logic phải sử dụng canonical Point model dùng chung với Monitor, Alarm, Trend, Scheduler và Commissioning.

---

## 4. Product Mental Model — BACS trước, IEC ở dưới

### 4.1 User mental model

Controls engineer nghĩ theo:

```text
Plant / Room / Equipment
    ↓
Nhóm chức năng (view/tag tùy chọn)
    ↓
Points + Setpoints + Parameters
    ↓
Control Logic
    ↓
Check
    ↓
Commission
```

### 4.2 Runtime model

Runtime vẫn tổ chức theo:

```text
Configuration
└── Resource
    ├── Task
    │   ├── Program Instance
    │   └── Program Instance
    └── Task
        └── Program Instance

POU Library
├── PROGRAM
├── FUNCTION_BLOCK
└── FUNCTION
```

### 4.3 Quyết định sản phẩm

**Không bắt user phải bắt đầu từ Configuration/Resource.**
Rev A.0 UI chỉ expose những đối tượng mà controls engineer cần thao tác:

- Program.
- Function Block.
- Function.
- Task.
- Variable.
- Point Binding.
- Nhóm chức năng dạng view/tag tùy chọn.
- Control Library.

Configuration/Resource là Advanced/Runtime metadata.

---

## 5. Phạm vi Rev A.0

### 5.1 Trong phạm vi Rev A.0

- Một Programming environment cho một MK-DDC-24 controller.
- Draft/Revision bất biến; một active application package tại runtime.
- ST.
- FBD.
- `PROGRAM`, `FUNCTION` và **User Function Block cục bộ trong cùng Project**.
- Nhóm chức năng dạng view/tag trên Program/Point; không tạo entity lưu trữ thứ tư.
- Point/Variable mapping.
- Cyclic Task.
- Core Control Library tối thiểu theo subset đã phê duyệt.
- Check/validation workflow.
- Commission changes workflow.
- Immutable build artifact.
- Cryptographic hash và integrity verification chống corrupt/partial write.
- Atomic activation.
- Last-known-good restore/rollback.
- Online monitor.
- Watch/trace bounded.
- Runtime/task diagnostics.
- RETAIN với warm/cold/revision compatibility được chốt trước release.
- Audit tối thiểu cho mutation vòng đời.
- Role-aware read/edit/commission actions.
- Revision change manifest mức đối tượng (source/mapping/task/library) để review
  trước khi đưa vào vận hành.
- Export/import Project bundle **chỉ chứa source** có integrity để thay
  controller; target luôn Check/build lại và import không tự activate.

### 5.2 Ngoài phạm vi

- LD/SFC production.
- Online code patch/hot change.
- Motion control.
- CNC.
- EtherCAT motion.
- Safety PLC/SIL claim.
- User-supplied arbitrary native binary.
- Artifact/IR/native binary đã build được mang qua Project bundle.
- User Function Block dạng package dùng chung, binary plug-in, global catalogue
  hoặc phân phối/version độc lập ngoài Project.
- Shell execution.
- Cloud dependency cho control.
- AI tự activate logic.
- Multi-controller distributed programming.
- Full PC-PLC engineering workflow.
- Full free-form wiresheet/React Flow canvas, animation dây và layout phức tạp.
- BACS Control Library nâng cao, `Average/Min/Max/LowPass`, `StageControl`,
  `LeadLag`, `SequenceStep`.
- Full audit explorer, component versioning/catalogue nâng cao và export PDF
  functional/as-built.
- Trusted-origin package signature enforcement. Rev A chỉ bắt buộc hash/integrity;
  ký tin cậy cần threat model, vị trí khóa và quyết định riêng.
- Multi-task capacity lớn hơn một Task cho tới khi `OD-PROG-003/004` được đóng.

### 5.3 Trạng thái scope không được mơ hồ

`RETAIN` và integrity hash là **IN Rev A** và phải có Verification tương ứng.
Trusted-origin signature, full FBD wiresheet, BACS library nâng cao và full
functional-document export là **OUT Rev A**. Không dùng cụm “khi milestone hoàn
tất” hoặc “hardened release” để đặt một capability ở cả IN và OUT.

---

## 6. Nguồn chân lý / AS-BUILT / TARGET

### 6.1 AS-BUILT runtime substrate cần giữ

Theo FW SOM source review:

- `mkddc-core` production đang nạp `/data/config/graph.json` vào
  `GraphRuntime`; khi không có `--scan-ms`, graph đang ảnh hưởng scan period;
- production bootstrap hiện truyền `st_sched = nullptr`, nên ST chưa nằm trên
  control path và graph legacy vẫn là logic local đang chạy;
- deterministic single main scan loop;
- absolute-time scheduling;
- coherent input snapshot bằng seqlock;
- point table + quality;
- output staging;
- priority arbitration;
- safe-state;
- atomic activation/last-known-good chỉ tồn tại ở supporting component trong RAM,
  chưa phải lifecycle production end-to-end;
- watchdog/service recovery;
- scan/overrun metrics;
- IPC giữa runtime và Web/Backend.

### 6.2 Programming AS-BUILT hiện tại — PARTIAL

- ST parser/semantic/runtime host-side.
- ST validator CLI.
- ST artifact helper.
- ST I/O map validator.
- ST cyclic helper.
- bounded trace helper.
- ST chưa wire production scan loop.
- typed IR/artifact/ST scheduler có supporting host component nhưng chưa được
  bootstrap production.
- FBD chưa production.
- multi-task scheduler chưa production.
- ST RETAIN chưa production.
- signature chưa production; integrity/artifact loader mới có host evidence.

### 6.3 Hard blockers trước production wiring

- parser depth/robustness;
- typed IR;
- no-allocation RT path;
- task/cycle ownership sau cutover;
- overrun→approved action;
- retain;
- artifact integrity;
- graph→Programming cutover và rejection của dual-runtime;
- HIL evidence.

---

## 7. Logical Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ BACS ENGINEERING UI                                          │
│ Overview │ Programs │ Points │ Tasks/Library │ Commission     │
│ Runtime & Service                                            │
└──────────────────────────────┬───────────────────────────────┘
                               │ authenticated API
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ PROGRAM SERVICE / BE SOM                                     │
│ Project/Revision │ Check │ Compiler │ Artifact Registry      │
│ Functional Docs │ RBAC │ Audit │ Commission/Restore         │
└──────────────────────────────┬───────────────────────────────┘
                               │ validated artifact + integrity hash
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ FW SOM PROGRAM CORE                                          │
│ Loader │ Scheduler │ ST/FBD IR Executor │ RETAIN │ Trace     │
│ Diagnostics │ Output Staging                                 │
└──────────────────────────────┬───────────────────────────────┘
                               │ typed process image
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ EXISTING DDC CONTROL SUBSTRATE                               │
│ Snapshot │ Point Table │ Priority Resolver │ Interlocks      │
│ Safe-State │ Single Output Commit │ Watchdog                 │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
             Local I/O / Virtual / Modbus RTU
```

### 7.1 Runtime separation

Web/API/database không được chạy trong RT execution path.

### 7.2 Failure containment

FE/BE mất kết nối không được làm active program dừng nếu runtime và I/O layer vẫn healthy.

---

## 8. BACS Functional View

### 8.1 Cấu trúc

```text
Site / Plant (optional project metadata)
└── Equipment / Room / Application
    ├── Function
    │   ├── Controlled Points
    │   ├── Setpoints
    │   ├── Parameters
    │   ├── Schedule references
    │   ├── Alarm references
    │   └── Control Logic
    │
    └── Functional Description
```

### 8.2 Nhóm chức năng không phải entity thứ tư

Rev A biểu diễn Application Function bằng metadata/tag tùy chọn trên Program,
Point và reference hiện hữu. Không có vòng đời, khóa, capacity hoặc persistence
riêng cho một entity `ApplicationFunction`. UI có thể dựng view gồm `name`,
`description`, `category`, `program_refs`, `point_refs`, `schedule_refs` và
`alarm_refs` từ Revision. Nếu Product muốn nâng thành entity độc lập, phải đóng
`OD-PROG-003`, thêm schema/migration/capacity và cập nhật traceability trước.

### 8.3 Không hard-code equipment taxonomy

MK-DDC-24 vẫn là generic DDC. Product cung cấp template/library, nhưng user được:

- tự đặt group/tag;
- tự đặt function name;
- dùng custom application;
- không bắt buộc AHU/FCU taxonomy.

---

## 9. IEC-aligned Program Model

### 9.1 Configuration / Resource

Runtime metadata bắt buộc, nhưng UI normal mode ẩn.

### 9.2 Task

Mỗi Task target cần:

- có name duy nhất và trạng thái enabled rõ;
- có period thuộc allowlist Rev A;
- có execution budget/watchdog contract;
- giữ thứ tự Program Instance deterministic;
- có overrun policy và runtime state/metrics authoritative.

Biên Product/API chỉ nhận đúng `1 s | 5 s | 30 s`. Backend/runtime là authority
thực thi allowlist này; `50..60000 ms` của supporting component không được expose
ra Product. Rev A chỉ cam kết một Task cho tới khi `OD-PROG-003/004` đóng; UI
không được suy diễn capacity 8 Task / 16 Program mỗi Task / 32 Program tổng từ
component host.

### 9.3 Program Instance

Mỗi Program Instance **phải** có tên duy nhất trong Project, tham chiếu đúng POU
và Task Rev A duy nhất. Runtime **phải** giữ local state và RETAIN reference theo
Revision; Check **phải** từ chối reference mồ côi hoặc trùng identity.

### 9.4 FUNCTION

Mỗi `FUNCTION` **phải** có I/O typed, thực thi deterministic và hoàn tất trong
budget đã phê duyệt. `FUNCTION` **không được** giữ state ẩn hoặc sở hữu actuator
trực tiếp; construct không bounded phải bị Check từ chối.

### 9.5 FUNCTION_BLOCK

Rev A **phải** hỗ trợ User Function Block do người dùng định nghĩa, nhưng chỉ
trong Project chứa định nghĩa đó. Mỗi instance **phải** có input/output typed,
state tách biệt và lifecycle cold/warm/RETAIN rõ; cùng một định nghĩa phải dùng
được từ ST và FBD. Rev A **không** hỗ trợ global catalogue, package chia sẻ,
dynamic/native plug-in hoặc nâng cấp component độc lập với Revision.

---

## 10. Programming Languages

### 10.1 Release languages

| Language | Rev A.0 |
|---|---|
| ST | Required |
| FBD | Required |
| LD | Future |
| SFC | Future |

### 10.2 ST

ST cần grammar/profile chính thức với:

- assignment;
- Boolean;
- comparison;
- arithmetic;
- IF/ELSIF/ELSE;
- CASE khi approved;
- bounded loops khi approved;
- POU call;
- conversions theo type rules;
- standard/BACS FB call.

Giới hạn acceptance Rev A cho một Program ST:

- source `<= 64 KiB`;
- token `<= 32768`;
- expression depth `<= 32`, statement depth `<= 16`;
- statement `<= 4096`, variable `<= 512`;
- identifier `<= 64` ký tự;
- Function Block instance `<= 64`, RETAIN variable `<= 128`;
- call recursion bị cấm; loop chỉ được hỗ trợ khi có static bound được duyệt.

Các giá trị trên khớp supporting component hiện tại nhưng vẫn phải được chấp
thuận qua `OD-PROG-002/003` trước khi hợp nhất vào baseline.

### 10.3 FBD Rev A

FBD là ngôn ngữ bắt buộc theo `PROD-PROG-001`, nhưng Rev A dùng editor cấu trúc
có tree/list/inspector và thứ tự thực thi rõ; full free-form wiresheet canvas là
Rev B. FBD Rev A phải có:

- typed block pins;
- typed wires;
- deterministic execution order;
- explicit conversion;
- no ambiguous fan-in;
- cycle detection rules;
- source-map từ block/wire tới diagnostics.
- tối đa `256` block và `512` connection trên một Program;
- đường thao tác bàn phím đầy đủ; không có thao tác authoring bắt buộc chỉ dùng chuột.

---

## 11. Control Function Library

### 11.1 Core Control Library Rev A

- logic;
- compare;
- math;
- selector;
- clamp/limit;
- timer;
- edge;
- counter;
- scaling;
- deadband/hysteresis;
- PI/PID.

### 11.2 BACS Control Library — roadmap sau Rev A

Taxonomy định hướng có thể bám các nhóm control application BACS, ví dụ:

```text
HVAC
├── Temperature / Setpoint Control
├── Heating / Cooling Sequence
├── Fan / Pump Control
├── Valve / Damper Control
├── Freeze / Limit / Interlock patterns
└── Occupancy-related control

ROOM / INTEGRATED CONTROL
├── Occupancy
├── Comfort / Setpoint coordination
├── Indoor air quality
└── Room operating modes

LIGHTING
SOLAR PROTECTION
ENERGY / OPTIMIZATION
```

**Lưu ý:** taxonomy trên là product design direction dựa trên scope công khai của ISO 16484-4. Exact standardized block names/semantics phải được review từ licensed standard trước khi claim conformance.

### 11.3 Library version

Rev A artifact phải ghi phiên bản Core Library để kiểm compatibility. Catalogue,
upgrade UX và component versioning đầy đủ là roadmap, không phải Release Gate Rev A.

---

## 12. Type & Variable Model

### 12.1 Types

IEC-aligned subset:

- BOOL.
- signed/unsigned integer subset.
- REAL.
- TIME/duration dùng monotonic elapsed time.
- ENUM/uINT cho multi-state theo bảng mapping được phê duyệt.
- ARRAY/STRUCT nếu approved và bounded.
- String chỉ khi có use case rõ + fixed maximum.

### 12.2 Variable classes

- Local.
- Input.
- Output.
- InOut.
- Global.
- Mapped.
- Retain.
- Constant.
- Parameter.

### 12.3 Safety of conversion

Không implicit narrowing nguy hiểm. Type mismatch phải bị chặn trước Commission.

### 12.4 Ma trận type × Point kind Rev A

| Point category/kind | Identity | Direction hợp lệ | IEC type hợp lệ | Ceiling hiện hành | Kết quả không hợp lệ |
|---|---|---|---|---:|---|
| `LOCAL/UI` | `UI-NN` | read | `REAL` hoặc type của Point Catalog | Theo SKU | `PRG-ERR-MAP-003/004` |
| `LOCAL/AO` | `AO-NN` | read/write | `REAL` | 4 | `PRG-ERR-MAP-003/004` |
| `LOCAL/DO` | `DO-NN` | read/write | `BOOL` | 4 | `PRG-ERR-MAP-003/004` |
| `VP/AV` | canonical Virtual Point ID | read/write nếu `writable=true` | `REAL` | 32 | `PRG-ERR-MAP-003/004` |
| `VP/BV` | canonical Virtual Point ID | read/write nếu `writable=true` | `BOOL` | 16 | `PRG-ERR-MAP-003/004` |
| `VP/MSV` | canonical Virtual Point ID | read/write nếu `writable=true` | bounded `ENUM/uINT` | 8 | `PRG-ERR-MAP-003/004` |
| `MB-RTU/EXT` | `{device_id, point_id}` | theo Point config | `BOOL`, integer hoặc `REAL` đúng typed contract | `<=256` binding/Program | `PRG-ERR-MAP-003/004` |

`DI` không được hard-code vì base SKU hiện không có DI; Local Point phải lấy từ
Point Catalog có authority. `EXT` chỉ là runtime kind của Modbus RTU Point,
không phải giấy phép cho Modbus TCP/BACnet. Đường Scheduler dùng lại
`SCH-TARGET-003` làm nguyên nhân cấp dưới khi target type không tương thích.
Capacity catalogue Modbus RTU là `>=256` Point theo ADR-024; nó khác ceiling
`<=256` I/O binding của một Program artifact.

---

## 13. Point Mapping & Functional Documentation

### 13.1 Canonical Point Sources

- **Local Physical I/O** từ Point Catalog của SKU.
- **Virtual Point**.
- **Modbus RTU Point**.

Chỉ ba category trên thuộc allowlist Rev A. Modbus TCP Point và BACnet/IP Point
phải bị từ chối. Schedule/derived reference chỉ là tham chiếu đọc qua contract
được phê duyệt, không trở thành Point source thứ tư.

### 13.2 Binding

```text
Program Variable
   ↕
Discriminated Point identity
+ direction
+ data type
+ engineering unit
+ writable
+ quality policy
+ category (`LOCAL | VP | MB-RTU`)
+ `device_id` đối với Modbus RTU
```

Local/Virtual dùng canonical ID theo Point Catalog. Modbus RTU không dùng ID
phẳng kiểu `MB-042`; identity bắt buộc là cặp `{device_id, point_id}` trong mô
hình Bus → Device → Point.

### 13.3 Point quality

Runtime/program phải phân biệt:

- good;
- uncertain;
- bad;
- stale;
- offline;
- unknown.

Missing không được đổi thành zero.

### 13.4 Functional context

Nhóm chức năng tùy chọn có thể liên kết:

- points list;
- control intent;
- sequence/description;
- setpoints/parameters;
- alarm references;
- schedule references;
- commissioning notes;
- revision/as-built state.

### 13.5 Export/import thay controller

Rev A **chỉ** được export/import Project bundle gồm source ST/FBD, mapping, Task,
Core Library version, Revision metadata, manifest và integrity hash. Bundle
**không được** mang artifact, Typed IR, native binary, cache build hoặc trust
material dùng để bỏ qua build cục bộ. Importer **phải** từ chối bundle có thành
phần executable/build (`PRG-ERR-IMPORT-001`), validate target/Point identity,
tạo Draft mới rồi **Check và build lại trên controller đích** bằng toolchain/
library được phê duyệt. Artifact đích phải có identity/hash mới, phải qua loader
verification như build tại chỗ và không được tự Commission/Activate. Full
functional/as-built PDF là roadmap sau Rev A.

---

## 14. Task Scheduler

### 14.1 Determinism

Sau activation/init, RT path **không được** cấp phát heap, truy cập filesystem,
HTTP, DB, DNS, gọi network blocking hoặc load native code động. Mọi operation
trong step phải có execution bound được validator/target test chứng minh; vi
phạm phải fail Check/activation trước khi thay LKG.

### 14.2 Cycle

```text
1. Capture coherent input snapshot
2. Freeze cycle input image
3. Execute eligible tasks/programs deterministically
4. Stage outputs
5. Interlock / priority arbitration
6. Safe-state evaluation
7. Commit physical outputs once
8. Publish metrics outside critical path
```

### 14.3 Overrun

- budget validator mặc định không vượt `20%` Task period (`200 ms | 1 s | 6 s`
  tương ứng 1/5/30 s) **và** không vượt phần budget còn lại của base step theo
  watchdog contract §14.6; lấy ngưỡng nhỏ hơn. Vì vậy Task 30 s không mặc nhiên
  được phép chạy 6 s khi `WatchdogSec=6`;
- lần đầu vượt budget: runtime phải tăng count và tạo engineering warning cho
  đúng Task;
- ba lần liên tiếp: runtime phải đưa **Task bị lỗi** vào `DEGRADED/FAULTED`, giữ
  đóng góp mức 5 hợp lệ cuối hoặc áp dụng fail policy đã phê duyệt cho đúng
  binding; không được tự suy diễn thành plant-wide safe-state;
- toàn hệ chỉ được vào safe-state khi `SafetyManager` xác nhận một điều kiện an
  toàn độc lập đã được phê duyệt, như mất I/O freshness, interlock hoặc không
  hoàn tất base control step; một thao tác Check hoặc task-level overrun đơn lẻ
  không phải điều kiện đủ;
- thống kê phải expose `last/max/total/consecutive/budget` từ authority.

Compiler/Check phải chạy ngoài RT path và phải có resource-isolation profile đã
được phê duyệt so với `mkddc-core`/`mkddc-iobus` (RT scheduling hoặc CPU/cgroup/
priority tương đương có evidence). Cấu hình lab hiện chạy core `SCHED_OTHER` do
`mkddc-core-nofifo.conf`, trong khi `mkddc-web-pi.service` chưa giới hạn CPU,
**không phải** bằng chứng production. G6 phải chạy Check tải xấu nhất đồng thời
với control loop và chứng minh không gây missed step, IOP poll gap hay nuisance
safe-state.

Các số trên là target acceptance của proposal và phải đóng `OD-PROG-012` trước
khi trở thành baseline.

### 14.4 Priority, arbitration và anti-windup

Program output là `Local logic`, mức **5/6**:

```text
1 Fire/Safety → 2 Local manual → 3 BACnet → 4 Schedule
→ 5 Local logic → 6 Default
```

Mỗi output binding phải expose tối thiểu `program_value` (đóng góp mức 5),
`actual_value` (sau resolver), `overridden_by` và `effective_priority`; không dùng
`written_value` nếu không chỉ rõ nó thuộc nguồn nào. Runtime phải trả feedback
arbitration hiệu lực về Program và tách hai chế độ anti-windup:

1. Khi mức 5 **đang thắng** nhưng output của chính mức 5 bị clamp/saturation/rate
   limit, PI/PID phải back-calculate theo chênh lệch giữa giá trị mức 5 trước và
   sau giới hạn cùng đường lệnh.
2. Khi mức 5 **thua arbitration** bởi nguồn mức 1–4, PI/PID phải freeze/hold
   integrator theo contract block; **không được** track hoặc nạp integrator từ
   `actual_value` của nguồn đang thắng.

Việc nguồn ưu tiên cao hơn nhả quyền là một transition policy riêng của resolver;
không được quảng cáo bumpless nếu policy/ramp tái nhập chưa có HIL evidence.
Commission/Runtime không được hiển thị `GOOD/RUNNING` như thể actuator đã nhận
lệnh mức 5 khi đang bị nguồn khác giữ.

### 14.5 TIME, RTC, NTP và DST

- `TIME`, timer và counter dùng monotonic elapsed time; RTC/NTP nhảy không làm
  timer chạy lùi hoặc nhảy hạn.
- Lịch theo giờ dân dụng do Scheduler authority xử lý timezone/DST; Program chỉ
  đọc reference/value/quality đã chuẩn hóa.
- Clock/reference unavailable phải thành `unknown/stale`, không thành giá trị mặc định.

### 14.6 Cutover graph legacy → Programming

Runtime có đúng ba trạng thái cấu hình:

| Trạng thái | Hành vi |
|---|---|
| `GRAPH_ONLY` | Chạy `graph.json`; không cho Commission package Programming. |
| `PROGRAM_ONLY` | Chạy package Programming; `graph.json` không được thực thi và không sở hữu scan period. |
| `DUAL_INVALID` | Nếu cả hai được yêu cầu active, fail closed với `PRG-ERR-CUTOVER-001`; giữ runtime/LKG đang có, không trộn output mức 5. |

Commission lần đầu sang `PROGRAM_ONLY` phải yêu cầu migration/check rõ ràng,
backup graph, operator confirmation và rollback plan. Sau cutover,
Programming scheduler sở hữu Task period `1/5/30 s`; `graph.json` không còn sở
hữu scan period. **Task period không được dùng làm thời gian sleep/chờ của một
`ScanLoop::step()`**. Runtime design phải định nghĩa một base control step/tick
độc lập, bounded, dispatch Task khi đến hạn rồi trả về sau khi hoàn tất step.

`mkddc-core` chỉ được kick `WATCHDOG=1` sau khi toàn bộ base control step hoàn
tất. Trước khi Commission, runtime phải kiểm:

```text
WatchdogSec >= 2 × max_base_step_period + WCET_step_target + 1 s
```

Với `WatchdogSec=6` hiện hành, config mới chỉ được chấp nhận nếu base step vẫn
đáp ứng bound tương thích hiện hành `<=2 s` và số đo WCET/jitter trên target cho
thấy công thức đạt. Nếu implementation để Task `30 s` chi phối ranh giới step,
thì phải coi bound tối thiểu là `>=61 s + WCET dư` và **không được** Commission
với unit 6 s; systemd unit/runtime config phải được thay đổi nhất quán trước đó.
Mâu thuẫn giữa công thức “Task lớn nhất” trong
`PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md` và base-step model này là design
blocker phải đóng trong `OD-PROG-012/013/014`, không được tự chọn một cách hiểu
khi implement.

G6 phải chạy đủ Task period `1/5/30 s`, chứng minh watchdog kick sau từng step,
không restart loop và không làm gián đoạn IOP poll. `OD-PROG-013/014` phải đóng
trước production cutover.

---

## 15. Ranh giới năng lực biên dịch — không phải compiler design

Product chỉ yêu cầu ST và structured FBD tạo cùng semantics typed, mọi lỗi có
source location ổn định, output build là artifact bất biến đúng target và loader
fail closed. Pipeline, IR schema, ABI, magic, entry point, serialization và
resource layout **không thuộc Product Spec**; authority của chúng là
`TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md` cùng `IFSPEC-PROG-001` sau khi được phê
duyệt.

Normal UI không được bắt user hiểu IR schema/hash/ABI. Advanced Diagnostics chỉ
được hiển thị compiler version, artifact identity, integrity state và target
compatibility khi producer authoritative cung cấp.

---

## 16. Safe Commissioning / Artifact Lifecycle

### 16.1 User-facing terminology

User thấy:

```text
Draft
→ Check
→ Sẵn sàng đưa vào vận hành
→ Đang vận hành
→ Khôi phục bản trước
```

### 16.2 Internal state

```text
DRAFT
→ VALIDATED
→ BUILT
→ VERIFIED
→ STAGED
→ ACTIVE
→ PREVIOUS/LKG
```

### 16.3 Đưa thay đổi vào vận hành

Commission chỉ thành công nếu:

- compiler/semantic pass;
- mapping pass;
- Task/resource budget pass;
- base-step/watchdog và IOP poll continuity contract pass;
- controller compatible;
- artifact integrity pass;
- retain policy resolved;
- graph/Programming cutover state hợp lệ;
- không có conflict do Revision active hoặc Draft base đã đổi;
- runtime accepts.

### 16.4 Failed commission

Nếu fail:

- active LKG giữ nguyên;
- không partial output;
- UI phải nói rõ:
  `Bản thay đổi bị từ chối; chương trình đang vận hành vẫn tiếp tục chạy.`

### 16.5 Khôi phục bản trước

User-facing “Restore Previous Version”; internal là rollback atomic.

### 16.6 No online change

Rev A.0 không patch active logic trực tiếp.

### 16.7 Output continuity / bumpless

Commission và Restore dùng **hold-last trên đóng góp Local logic mức 5**, không
dùng output sau resolver:

1. Runtime phải chụp `previous_program_value` của Revision active cho từng output
   binding ngay trước activation; `actual_value` chỉ là dữ liệu quan sát.
2. Revision mới chỉ được phát `program_value` sau cycle đầu hoàn tất không fault;
   giá trị mức 5 đầu tiên phải bằng `previous_program_value` trong độ phân giải
   số của binding.
3. Stateful block chỉ được khởi tạo từ state/input tương thích của **cùng logic
   mức 5**. Khi mức 1–4 đang thắng, integrator phải freeze theo §14.4 và không
   được seed/track từ `actual_value` ngoại lai.
4. Nếu binding mới không có đóng góp mức 5 trước đó hoặc state không tương thích,
   Check/Commission phải yêu cầu một initial-value/transition policy được phê
   duyệt; không được âm thầm sao chép `actual_value`, zero hoặc safe default.
5. Resolver tiếp tục quyết định `actual_value`: nếu Local manual đang giữ 62%
   còn Program là 41%, activation phải giữ đóng góp Program ở 41% và actual vẫn
   62%; việc nhả override thuộc transition policy riêng, không thuộc hold-last
   activation.

Activation/Restore không được dừng hoặc restart `mkddc-iobus`, và critical pause
không được làm khoảng cách IOP poll chạm `IOP_SAFE_TIMEOUT_MS = 200 ms`. G6 phải
đo trên board: `max_iop_poll_gap < 200 ms`, mục tiêu acceptance có margin
`<=100 ms`, không có MCU safe-timeout transition, và sai lệch đóng góp mức 5 ở
first commit không vượt độ phân giải binding. Nếu không chứng minh được các điều
kiện này thì Commission phải bị chặn; không được claim bumpless.

Fire/Safety, interlock và safe-state luôn có quyền preempt đóng góp mức 5. G6
phải đo AO/DO khi Commission/Restore, gồm PID có integrator và output đang bị
nguồn ưu tiên cao hơn giữ, đồng thời báo riêng `program_value` và `actual_value`.

---

## 17. Artifact Integrity và threat model

### 17.1 Target

Artifact Rev A phải có:

- cryptographic hash;
- target profile;
- compiler/library versions;
- source revision reference.

### 17.2 Device verification

Loader reject:

- invalid magic/schema;
- wrong target;
- corrupt hash;
- invalid map;
- resource exceed;
- invalid control flow.

### 17.3 Security goal và giới hạn

Hash/integrity bảo vệ chống corrupt, partial write và load nhầm artifact. Cơ chế
tự build/tự ký/tự verify trên cùng SOM **không chứng minh nguồn gốc** và không
bảo vệ khi `mkddc-web`/BE đã bị chiếm. Trusted-origin signature enforcement là
OUT Rev A cho tới khi quyết định được vị trí khóa (device key hay release key/HSM),
signer và verify boundary. Mọi integrity/signature reject phải được audit như
security event; nó không mặc nhiên là process alarm.

---

## 18. RETAIN / Restart Semantics

### 18.1 Retain record

- layout version;
- artifact compatibility;
- CRC/integrity;
- atomic persistence.
- tối đa `128` biến, record `<= 4096 byte` trên mỗi Program artifact.

### 18.2 Warm start

Restore chỉ khi compatible + valid.

### 18.3 Cold start

Initial values khi incompatible/corrupt/explicit reset.

RTC/NTP/DST không được dùng làm tiêu chí phân biệt warm/cold. Compatibility phải
dựa trên artifact/variable identity, type và layout version.

### 18.4 UX

User bình thường không cần thấy retain schema. Chỉ khi candidate làm thay đổi retained layout:

> `Stored control state cannot be reused safely; commissioning will cold-initialize affected retained values.`

Copy tiếng Việt mặc định:

> `Trạng thái điều khiển đã lưu không còn tương thích; các giá trị RETAIN bị ảnh hưởng sẽ được khởi tạo lại.`

---

## 19. Commissioning & Completion

### 19.1 Commissioning checklist target

- controller online;
- target match;
- point mapping valid;
- point quality acceptable;
- Task config valid;
- check passed;
- output changes summary;
- retained-state impact;
- operational warnings acknowledged;
- commission result confirmed.
- mọi Local manual override còn hiệu lực đã được liệt kê cùng TTL và actor;
- kiểm tra behavior vật lý đi qua module **Chạy thử** hiện hữu, không qua Online Monitor.

### 19.2 As-built state

Sau Commission thành công:

- active revision;
- commissioned timestamp;
- user;
- target controller;
- mapping revision;
- library version;
- functional-document revision.

### 19.3 Handover / completion direction

Programming data model phải đủ để hỗ trợ project completion/handover theo BACS lifecycle, dù export package đầy đủ có thể nằm phase sau.

### 19.4 Quan hệ với module Chạy thử

Online Monitor của Programming luôn read-only. Kỹ sư cần kích output phải mở
module **Chạy thử**, nơi lệnh Local manual mức 2 đi qua `PUT /points/{id}` với
`ttlS/overrideExpiresInS`. Programming phải hiển thị cảnh báo nguồn giữ và link
`Mở Chạy thử`; Commission checklist không được coi output đã verified khi
override mức 2 còn hiệu lực mà chưa được acknowledge/release.

---

## 20. Runtime Monitoring & Service

### 20.1 Runtime truth

Runtime service **phải** trả authoritative active project/application, active
version, runtime state, safe-state, Task Rev A duy nhất, execution/max/overrun,
last fault, Point quality summary và last commission/restore. Mỗi trường thiếu
producer phải có trạng thái `UNKNOWN/UNAVAILABLE`, không được thay bằng số giả.

### 20.2 Online Monitor

Online Monitor **phải** read-only mặc định và phải trả variable/Point value,
quality, source, timestamp và mapping từ producer. Với output, read model phải
tách `program_value`, `actual_value`, `overridden_by`, `effective_priority` và
TTL override khi có; không được gộp hai trục thành một trường “output”.

### 20.3 Trace

Trace **phải** giới hạn thời lượng/sample theo NFR và phải dừng với reason rõ khi
chạm giới hạn; implementation không được dùng memory tăng không giới hạn.

### 20.4 Service workflow

```text
Observe
→ Diagnose
→ Identify Program/Point/Task
→ Edit Draft
→ Check
→ Commission
→ Verify
```

---

## 21. Engineering Diagnostics vs Operational Alarm

### 21.1 Engineering Diagnostics — không vào Alarm page mặc định

- syntax error;
- type mismatch;
- invalid FBD wire;
- mapping error;
- build failure;
- incompatible artifact before activation.
- integrity/signature reject trước activation; đồng thời ghi security audit event.

### 21.2 Operational condition có thể tạo Alarm

Theo policy:

- active runtime fault;
- task-level fault do repeated overrun; chỉ vào plant safe-state nếu có thêm
  điều kiện SafetyManager đã phê duyệt theo §14.3;
- program stopped;
- safe-state entered;
- critical input quality loss affecting control.

### 21.3 Rule

Compiler problem ≠ process alarm.

---

## 22. Persona & RBAC

### 22.1 Personas

Persona, nhu cầu và journey do companion UX §2 làm chủ. Product chỉ yêu cầu
persona không được dùng thay quyền; authorization vẫn theo role ở §22.2–22.3.

### 22.2 Existing roles

```text
viewer < operator < admin
```

### 22.3 Target permission proposal

| Action | viewer | operator | admin |
|---|:---:|:---:|:---:|
| Xem active program/runtime | ✅ | ✅ | ✅ |
| Xem source read-only | ✅ | ✅ | ✅ |
| Online monitor | ✅ | ✅ | ✅ |
| Edit ST/FBD | ❌ | ❌ | ✅ |
| Edit mapping/tasks | ❌ | ❌ | ✅ |
| Check | ❌ | ❌ | ✅ |
| Commission changes | ❌ | ❌ | ✅ |
| Restore previous | ❌ | ❌ | ✅ |
| Reset retained state | ❌ | ❌ | ✅ |

Server là authority.

### 22.4 Multi-user / concurrency

Backend store trên controller là authority của Draft; browser cache không phải
authority. Draft dùng optimistic concurrency theo `base_revision`/ETag, không dùng
last-write-wins. Mutation trên base cũ trả `409 PRG-ERR-CONFLICT-001`, giữ nguyên cả
hai version và yêu cầu reload/merge. Nếu người khác Commission trong lúc user
đang sửa, Draft vẫn tồn tại nhưng phải Check lại trên `runtime.activeRevision`
mới trước khi được đưa vào vận hành.

---

## 23. API / Service Capability Boundary

Endpoint/schema chỉ được khóa trong `IFSPEC-PROG-001` sau khi các OD liên quan
đóng; tài liệu Product/UX này không tạo API authority.

Required capability:

- project/draft/revision;
- functional tag/view metadata;
- ST/FBD document;
- variable;
- task;
- point catalogue/binding;
- check/validation;
- build/artifact;
- commission;
- restore previous;
- runtime;
- monitor/trace;
- functional tag/view metadata trong Revision; full documentation panel/export
  ngoài Rev A;
- audit;
- structured Revision change manifest;
- optimistic concurrency (`base_revision`/ETag);
- project bundle export/import cho replacement;
- cutover state và arbitration feedback;
- danh sách override đang hoạt động theo Revision/binding, gồm Point identity,
  source, actor, requested/actual value, priority, start time, TTL còn lại;
  capability này phải đọc từ core/Point runtime authority, không tổng hợp từ
  cache từng màn hình.

FE không gọi endpoint “được mô tả trong docs nhưng chưa implement” như production capability.

---

## 24. Ranh giới với UI/UX

Product sở hữu capability, safety semantics, role authorization và runtime
truth. Companion `PROGRAMMING_UI_UX_UC_DESIGN_MK-DDC-24.md` sở hữu IA, số
route/subroute, layout, copy, component, data presentation, persona journey và
UX acceptance. Product Spec **không** khóa sáu entry hay cách tách PGM-06.

UX phải hiện thực workflow `Engineering → Check → Đưa vào vận hành → Run` và
không được expose compiler/IR/ABI/manifest/retain-schema như mental model chính;
đó là hai outcome Product duy nhất, được kiểm qua `PRG-BACS-003` và companion
`UX-REQ-*`.

---

## 25. Functional Requirements Catalog

Các ID `PRG-*` dưới đây là ID đề xuất cục bộ, không thay `PR/SWR/IF/VR-PROG-*`.
Nghĩa normative chỉ được xét cùng tiêu chí/method và crosswalk tại mục 25.8.

### 25.1 Product / BACS

| ID | Requirement |
|---|---|
| PRG-BACS-001 | Programming phải hỗ trợ view/tag Nhóm chức năng → Point → Logic có truy nguyên, không tạo entity bắt buộc. |
| PRG-BACS-002 | Programming phải giữ mô tả chức năng và Point reference trong Revision; PDF đầy đủ ngoài Rev A. |
| PRG-BACS-003 | UI phải expose Engineering → Check → Đưa vào vận hành → Run. |
| PRG-BACS-004 | Rev A chỉ phải cung cấp Core Control Library có version; BACS Library nâng cao ngoài scope. |
| PRG-BACS-005 | Trạng thái đang vận hành phải ghi active version, target, mapping, actor và timestamp. |

### 25.2 IEC programming model

| ID | Requirement |
|---|---|
| PRG-IEC-001 | ST và FBD phải dùng chung typed semantic/IR model. |
| PRG-IEC-002 | POU phải hỗ trợ PROGRAM/FUNCTION/User FUNCTION_BLOCK cục bộ trong Project; không có package/catalogue/shared binary FB ở Rev A. |
| PRG-IEC-003 | Runtime phải giữ Configuration/Resource/Task/Program semantics nội bộ. |
| PRG-IEC-004 | Input vượt limit hoặc construct không hỗ trợ phải trả diagnostic ổn định, không crash. |
| PRG-IEC-005 | Pin/connection FBD phải typed, deterministic và thao tác được bằng bàn phím. |

### 25.3 Runtime safety

| ID | Requirement |
|---|---|
| PRG-RT-001 | Input snapshot phải coherent cho mỗi control cycle. |
| PRG-RT-002 | Program output phải stage, arbitrate và commit một lần ở mức Local logic 5/6. |
| PRG-RT-003 | Candidate không hợp lệ không được thay active package hợp lệ. |
| PRG-RT-004 | Commission/Restore lỗi phải giữ last-known-good. |
| PRG-RT-005 | RT execution không được cấp phát không giới hạn hoặc blocking external I/O. |
| PRG-RT-006 | Runtime phải expose overrun/fault theo §14.3; ba overrun chỉ degrade đúng Task, không tự kích plant safe-state, và Check load không được tranh RT path. |
| PRG-RT-007 | Output binding phải expose `program_value/actual_value/arbitration`; PI/PID back-calculate khi mức 5 thắng nhưng saturate, freeze integrator khi thua arbitration và không track `actual_value`. |
| PRG-RT-008 | Commission/Restore phải hold-last trên đóng góp mức 5, không làm IOP poll gap chạm `200 ms`, và không sao chép `actual_value` của nguồn khác. |
| PRG-RT-009 | Graph và Programming không được active đồng thời; cutover phải fail closed và base-step/Task-period/`WatchdogSec` phải thỏa §14.6. |
| PRG-RT-010 | Timer phải dùng monotonic time; wall-clock/DST do Scheduler authority xử lý. |

### 25.4 Point/quality

| ID | Requirement |
|---|---|
| PRG-PT-001 | Binding phải dùng discriminated identity đúng category; RTU dùng `{device_id, point_id}`. |
| PRG-PT-002 | Binding phải validate type/direction/writable/unit theo ma trận mục 12.4. |
| PRG-PT-003 | Missing/offline/stale quality không được âm thầm thành valid zero. |
| PRG-PT-004 | Chỉ Local Physical I/O, Virtual Point, Modbus RTU Point được phép; TCP/BACnet phải bị từ chối. |

### 25.5 Commissioning

| ID | Requirement |
|---|---|
| PRG-COM-001 | Check phải tổng hợp source/task/mapping/library/target/cutover readiness. |
| PRG-COM-002 | UI phải hiển thị structured change manifest và output/RETAIN impact trước execution. |
| PRG-COM-003 | Kết quả phải được read-back từ authoritative runtime state. |
| PRG-COM-004 | Restore Previous phải atomic, hold-last mức 5 theo §16.7 và được audit. |
| PRG-COM-005 | Capability/UX phải liệt kê mọi Local manual override còn hiệu lực theo Revision/binding, gồm source/actor/TTL/value/priority, và link tới module Chạy thử. |
| PRG-COM-006 | Replacement bundle chỉ được chứa source; import phải reject build artifact, build lại trên target, kiểm integrity/compatibility và không tự activate. |

### 25.6 Security

| ID | Requirement |
|---|---|
| PRG-SEC-001 | Edit/check/commission/restore phải được server authorize theo role. |
| PRG-SEC-002 | Artifact Rev A phải có cryptographic hash/integrity verification; trusted-origin signature ngoài scope. |
| PRG-SEC-003 | Critical engineering action và integrity/signature reject phải được audit. |
| PRG-SEC-004 | Không hỗ trợ arbitrary native code execution. |
| PRG-SEC-005 | Draft mutation phải dùng optimistic concurrency; không được last-write-wins. |

### 25.7 UX

| ID | Requirement |
|---|---|
| PRG-UX-001 | Normal workflow phải dùng copy tiếng Việt BACS và i18n key; không dùng compiler/deployment làm primary term. |
| PRG-UX-002 | UI phải phân biệt Draft/Candidate với Active runtime truth. |
| PRG-UX-003 | Thiếu producer data phải hiển thị `Không xác định/—`. |
| PRG-UX-004 | UI phải hỗ trợ persona/task độc lập với RBAC role. |
| PRG-UX-005 | State không được truyền đạt chỉ bằng màu. |
| PRG-UX-006 | Core state phải là `RUNNING/DEGRADED/UNREACHABLE`; khi cả controller offline thì UI không tải được. |

### 25.8 Crosswalk và phương pháp kiểm chứng

Không gộp dải ID. Mỗi requirement có đúng một dòng và trỏ tới scenario trong
catalog duy nhất §29; companion UX dùng lại catalog này, không có test list thứ hai.

| Requirement | Baseline upstream gần nhất | Verification bắt buộc |
|---|---|---|
| `PRG-BACS-001` | `PR-PROG-001,007` | `VS-PROG-001` |
| `PRG-BACS-002` | `PR-PROG-001,007` | `VS-PROG-001` |
| `PRG-BACS-003` | `PR-PROG-006..009` | `VS-PROG-002` |
| `PRG-BACS-004` | Chưa có Product requirement trực tiếp | `VS-PROG-003`; bổ sung PR/REQ/VR nếu approve |
| `PRG-BACS-005` | `PR-PROG-011,013` | `VS-PROG-004` |
| `PRG-IEC-001` | `PR-PROG-002,006`; `SWR-REQ-PROG-002,003` | `VS-PROG-005` |
| `PRG-IEC-002` | `PR-PROG-002,006` | `VS-PROG-007` |
| `PRG-IEC-003` | `PR-PROG-005,006` | `VS-PROG-009` |
| `PRG-IEC-004` | `SWR-REQ-PROG-002,003` | `VS-PROG-006` |
| `PRG-IEC-005` | `SWR-REQ-PROG-003` | `VS-PROG-006` |
| `PRG-RT-001` | `PR-PROG-005`; `SWR-REQ-PROG-006` | `VS-PROG-009` |
| `PRG-RT-002` | `PR-PROG-004,005` | `VS-PROG-010` |
| `PRG-RT-003` | `PR-PROG-009`; `SWR-REQ-PROG-008` | `VS-PROG-011` |
| `PRG-RT-004` | `PR-PROG-009`; `SWR-REQ-PROG-008` | `VS-PROG-011` |
| `PRG-RT-005` | `SWR-REQ-PROG-006`; `NFR-REQ-PROG-002` | `VS-PROG-012` |
| `PRG-RT-006` | `PR-PROG-005,012`; `SWR-REQ-PROG-006,012` | `VS-PROG-013` |
| `PRG-RT-007` | `PR-PROG-004,011`; `IF-REQ-PROG-001,002` | `VS-PROG-010` |
| `PRG-RT-008` | `PR-PROG-009`; `SWR-REQ-PROG-008` | `VS-PROG-014` |
| `PRG-RT-009` | `PR-PROG-012,014`; `SYS-REQ-PROG-001,003` | `VS-PROG-015` |
| `PRG-RT-010` | `SWR-REQ-PROG-006,012` | `VS-PROG-016` |
| `PRG-PT-001` | `PR-PROG-003,004,014`; `IF-REQ-PROG-001` | `VS-PROG-017` |
| `PRG-PT-002` | `SWR-REQ-PROG-004,005` | `VS-PROG-017` |
| `PRG-PT-003` | `PR-PROG-004,012` | `VS-PROG-018` |
| `PRG-PT-004` | `PR-PROG-014` | `VS-PROG-017` |
| `PRG-COM-001` | `PR-PROG-006`; `SWR-REQ-PROG-007` | `VS-PROG-019` |
| `PRG-COM-002` | `PR-PROG-007,013` | `VS-PROG-019` |
| `PRG-COM-003` | `PR-PROG-008,011` | `VS-PROG-019` |
| `PRG-COM-004` | `PR-PROG-009`; `SWR-REQ-PROG-008` | `VS-PROG-011` |
| `PRG-COM-005` | `PR-PROG-004,011`; `IF-REQ-PROG-001` | `VS-PROG-020` |
| `PRG-COM-006` | `PR-PROG-001,007,009` | `VS-PROG-021`; bổ sung VR nếu approve |
| `PRG-SEC-001` | `PR-PROG-008`; `IF-REQ-PROG-002` | `VS-PROG-022` |
| `PRG-SEC-002` | `PR-PROG-007,009`; `SWR-REQ-PROG-008` | `VS-PROG-023` |
| `PRG-SEC-003` | `PR-PROG-013`; `SWR-REQ-PROG-011` | `VS-PROG-022` |
| `PRG-SEC-004` | `SWR-REQ-PROG-008` | `VS-PROG-023` |
| `PRG-SEC-005` | `SWR-REQ-PROG-007`; `IF-REQ-PROG-002` | `VS-PROG-024` |
| `PRG-UX-001` | `PR-PROG-011`; `SWR-REQ-PROG-010` | `VS-PROG-025` |
| `PRG-UX-002` | `PR-PROG-011` | `VS-PROG-026` |
| `PRG-UX-003` | `PR-PROG-012`; `NFR-REQ-PROG-001` | `VS-PROG-026` |
| `PRG-UX-004` | `PR-PROG-008,011` | `VS-PROG-022` |
| `PRG-UX-005` | `NFR-REQ-PROG-001` | `VS-PROG-028` |
| `PRG-UX-006` | `PR-PROG-012`; `SWR-REQ-PROG-012` | `VS-PROG-026` |

Crosswalk ngược: mọi `PR-PROG-001..014` và `SWR/IF/NFR-REQ-PROG-*` vẫn lấy
ma trận Active `TRACE-PROG-001` làm authority; bảng này chỉ chỉ ra đề xuất nào
đang bổ sung/làm rõ chúng, không thay đổi cột evidence `MISSING/RED`.

---

## 26. Non-Functional Requirements

| ID | Requirement định lượng | Verification / tiêu chí đạt |
|---|---|---|
| NFR-PRG-PROP-001 | Giới hạn ST theo mục 10.2; FBD `<=256` block/`<=512` connection; I/O binding `<=256`; artifact `<=1 MiB`. | Boundary + one-over negative test trên validator/loader; mã lỗi ổn định, không crash/OOM. |
| NFR-PRG-PROP-002 | `Check` hoàn tất `p95 <=2 s`, hard timeout `5 s` trên production target với project ở mọi limit đã phê duyệt. | Target benchmark có artifact/commit/toolchain; timeout fail closed, không tạo candidate Ready. |
| NFR-PRG-PROP-003 | Task chỉ `1/5/30 s`; cumulative WCET budget là ngưỡng nhỏ hơn giữa `20%` Task period và budget base-step/watchdog §14.6; thứ tự deterministic; không heap/filesystem/DB/HTTP/DNS trên RT path; ba overrun liên tiếp chỉ fault đúng Task. | `VR-PROG-006` + instrumented target/HIL; 10000 cycle mỗi preset, log max/p99/overrun/watchdog cadence và chứng minh không nuisance plant safe-state. |
| NFR-PRG-PROP-004 | Online Monitor refresh mặc định `1 Hz`; sau `3` kỳ không có sample phải `STALE`, mất authority phải `UNAVAILABLE`. | Integration/E2E với clock điều khiển; không hiển thị sample cũ là Live. |
| NFR-PRG-PROP-005 | Một trace capture tối đa `10000` sample và `10 phút`; dừng ở giới hạn, không ring buffer vô hạn. | Resource/soak test chứng minh memory bounded và có reason khi dừng. |
| NFR-PRG-PROP-006 | FE/BE disconnect/restart không dừng active Program; reconnect không replay mutation. | Target fault injection; active revision/run count liên tục và mutation count không tăng. |
| NFR-PRG-PROP-007 | Draft save/check/commission dùng `base_revision`; conflict trả `409` trong `<=1 s`, không mất version. | Two-client integration/E2E. |
| NFR-PRG-PROP-008 | Tất cả action/status có i18n key VI/EN, focus nhìn thấy, state có text/icon; FBD Rev A thao tác đủ bằng bàn phím. | Static i18n scan + browser accessibility/E2E desktop; không claim ISO/WCAG certification. |
| NFR-PRG-PROP-009 | Audit giữ actor/action/target/revision/time/result/correlation cho mọi mutation và security reject. | Inspection + integration negative test; không chứa secret/source payload nhạy cảm. |
| NFR-PRG-PROP-010 | Activation/Restore phải giữ IOP poll gap `<200 ms` (mục tiêu có margin `<=100 ms`); compiler/Check phải được cách ly tài nguyên khỏi core/iobus; watchdog config phải đạt công thức §14.6. | Board/HIL dưới concurrent Check tải xấu nhất: không MCU safe-timeout, không restart loop, không missed base step; ghi scheduler policy, cgroup/CPU profile, poll gap và watchdog cadence thật. |

Các số chưa có authority trong baseline (`OD-PROG-002/003/011/012`) là **giá
trị acceptance đề xuất**, không phải As-Built hoặc release PASS. Chúng phải được
phê duyệt rồi cập nhật Requirements/Verification trước implement.

### 26.1 Quyền sở hữu mã lỗi

Product Spec chỉ quy định outcome fail-closed và lớp lỗi; **không sở hữu danh
mục mã lỗi**. Namespace/mã ổn định phải được định nghĩa duy nhất trong
`IFSPEC-PROG-001` (đề xuất tiền tố `PRG-ERR-*`) và trace từng mã tới requirement/
test. Ví dụ lỗi Commission reject phải là `PRG-ERR-COM-001`, không dùng
`PRG-COM-001` vì namespace đó thuộc requirement §25.5. Các mã minh họa còn xuất
hiện trong proposal (`PRG-ERR-CUTOVER-001`, `PRG-ERR-CONFLICT-001`,
`PRG-ERR-IMPORT-001`) chỉ là lớp kết quả chờ IFSPEC phê duyệt; UI phải dùng mã
authority, không tự phát minh hoặc đổi nghĩa.

---

## 27. Current Gap Matrix

| Capability | Current | Rev A.0 target |
|---|---|---|
| Deterministic scan/snapshot/staging | Strong substrate | Reuse |
| ST host subset | Partial | Production bounded |
| FBD | Spec only | Required |
| Typed IR | Missing | Required |
| RT allocation | Gap | Remove |
| Multi-task | Supporting component 8/16/32, chưa Product-approved | OUT Rev A ngoài một Task; chờ `OD-PROG-003/004` |
| Overrun action | Partial metric | Task-level degrade/fault; plant safe-state chỉ theo SafetyManager condition độc lập |
| RETAIN | Supporting component, chưa production-wired | IN Rev A; policy + target evidence bắt buộc |
| Artifact integrity hash | Supporting component, chưa production-wired | IN Rev A |
| Trusted-origin signature | Missing production trust model | OUT Rev A |
| Point map | Partial validator | Productized |
| Functional group/tag view | Missing | Optional UX metadata; không entity mới |
| Functional documentation | Missing | Basic Revision metadata; full export OUT Rev A |
| BACS control library | Generic only | OUT Rev A; Core Library tối thiểu IN |
| Commission workflow | Technical activation concept | DDC-first Commission UX |
| Online monitoring | Partial | Productized |
| HIL | Missing programming evidence | Release gate |

---

## 28. Release Gates

Tại revision tài liệu này, **G0–G7 đều RED/NOT STARTED**; các bullet dưới đây là
điều kiện phải đạt, không phải kết quả đã đạt.

### G0 — Product/Design approval — `RED / NOT LOCKED`
- `OD-PROG-015` đóng bằng biên bản Product approval.
- các `OD-PROG-002/003/004/006/009/011/012/013/014` liên quan được đóng;
- traceability/Requirements/Verification Active được cập nhật;
- IA và số trang chỉ là design decision, không phải tiêu chí tự khóa Product.

### G1 — Compiler / FBD Contract
- ST grammar/limits.
- FBD semantics.
- Typed IR.
- source maps.
- loader reject rules.
- FBD Rev A keyboard path; không phụ thuộc full wiresheet Rev B.

### G2 — Deterministic Runtime
- no allocation RT path;
- Task scheduler;
- overrun policy chỉ fault Task trừ khi SafetyManager có điều kiện độc lập;
- compiler/Check resource isolation so với core/iobus;
- output staging/arbitration/safe-state.
- graph/Programming cutover và base-step/Task-period/watchdog contract;
- hold-last mức 5 + IOP poll `<200 ms` + arbitration feedback/anti-windup hai chế độ.

### G3 — Point Engineering
- point mapping;
- Core Control Library;
- User Function Block chỉ cục bộ Project;
- replacement bundle và Revision/lifecycle metadata.

### G4 — Secure Commissioning
- immutable artifact;
- integrity hash (không yêu cầu trusted-origin signature);
- Check;
- Commission;
- failure preserves LKG;
- Restore Previous;
- source-only replacement import, luôn build lại trên target.

### G5 — UI/UX
- task flows/IA được usability review; page count không khóa cứng;
- persona + RBAC behavior;
- data states;
- accessibility;
- no fake metrics;
- engineering diagnostics separated from alarms.

### G6 — HIL / Board
- ST/FBD → Check → Commission → execute;
- physical point mapping;
- power cycle;
- core unreachable và FE/BE outage;
- overrun;
- concurrent Check tải xấu nhất với scheduler/resource profile thật;
- corrupt/invalid artifact;
- corrupt/integrity reject;
- restore previous;
- retain behavior;
- program thua arbitration;
- AO/DO hold-last mức 5 khi Commission/Restore, `max_iop_poll_gap <200 ms` và
  không MCU safe-timeout;
- graph dual-runtime reject; Task 30 s không kéo dài step; watchdog không restart loop;
- RTC/NTP/DST timer behavior;
- replacement import không auto-activate.

### G7 — Release
- P0/P1 closed;
- docs match implementation;
- authoritative Revision/commission audit record available;
- security and recovery evidence complete.

---

## 29. Catalog kiểm chứng Product + UX duy nhất

Catalog authority đã được nhập vào
[`VVP-PROG-001` §3](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md).
File proposal này chỉ tham chiếu `VS-PROG-001..030`; không duy trì bản sao E2E
song song. Mỗi kết quả phải ghi commit/artifact, môi trường, producer evidence,
`VR-PROG-*`, expected/actual và PASS/FAIL thật tại catalog controlled.

---

## 30. Source Traceability

### 30.1 Project sources

| Decision | Project basis |
|---|---|
| Generic programmable DDC | MK-DDC product definition / UX baseline |
| Three-process/one-box | ADR-005 |
| ST+FBD Rev A.0 | ADR-020 + ADR-023 |
| Point/cycle allowlist | ADR-023; quyết định ADR-024 trong `DECISIONS.md` |
| Source layout hiện hành | ADR-021 |
| Deterministic scan/snapshot/staging | FW SOM Source/SPEC Status Review |
| Safe-state / priority arbitration | FW SOM Source/SPEC Status Review |
| ST partial/not production-wired | FW SOM Source/SPEC Status Review |
| Typed IR/no-allocation/RETAIN/integrity gaps | FW SOM Source/SPEC Status Review |
| DDC ≠ PC-PLC | DDC/PLC boundary review |
| 3-role RBAC | MK-DDC current UX/backend baseline |
| no fake data | MK-DDC UX D-07 rule |

### 30.2 International standards references

Reference families: IEC 61131-3/TR 61131-8, ISO 16484, ISO 9241, IEC 62443 và
IEC 62682. Edition/năm và trạng thái current **UNVERIFIED trong repo**; không
được dùng làm claim cho tới khi có evidence record theo mục 2.1.

---

## 31. Open Decisions có authority

Không tạo namespace `OD-01..12`. Nguồn duy nhất là
[`PROG-OD-001`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) với
`OD-PROG-001..017`.

> **Đính chính 2026-08-09.** Bản trước trỏ tới
> `04_OPEN_DECISION_REGISTER.md` trong cây `audit-programming` và ghi
> `OD-PROG-001..015`. Cả hai đều sai ở thời điểm hiện tại: file đó **không còn
> tồn tại** trong cây làm việc, và số quyết định đã là **17** sau khi thêm
> `OD-PROG-016` (IA bốn workspace) và `OD-PROG-017` (thư viện mẫu BMS).
> Authority đúng là `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md`.

Các mục chặn trực tiếp proposal này: `OD-PROG-001` RBAC; `002` type; `003/004`
capacity/task; `005/006` library/FBD; `007` mapping; `009` RETAIN; `010`
Revision/lifecycle; `011` monitor/trace; `012` WCET; `013/014` graph migration;
`015` Product approval. Muốn đổi allowlist cycle `1/5/30 s` hoặc Point scope
phải qua ADR mới, không mở lại bằng Open Decision.

---

## 32. Product direction đề xuất — chưa khóa

### Hướng Rev A.0 chờ `OD-PROG-015`

> **MK-DDC-24 Programming là một BACS Engineering Environment cho generic DDC,
> dùng ST + FBD theo IEC 61131-3 aligned subset, với workflow phía người dùng:
> functional tag/view → Point → Logic → Check → Đưa vào vận hành → Run → Service.**

Bên dưới, platform giữ:

```text
Typed IR
→ deterministic execution
→ immutable artifact có integrity hash
→ atomic activation
→ priority/interlock/safe-state
→ last-known-good recovery
```

Điểm cạnh tranh không phải “nhiều bước hơn PLC IDE”, mà là:

1. **Web engineering không cần cài workstation nặng.**
2. **ST + FBD + Core Control Library trong một tool.**
3. **Point-centric, có functional tag/view cho BMS/DDC.**
4. **Commission nhanh nhưng deploy an toàn.**
5. **Online monitor + service diagnostics.**
6. **Arbitration transparency: thấy lệnh yêu cầu, giá trị thực và nguồn đang giữ.**
7. **Version/integrity mạnh nhưng ẩn khỏi workflow bình thường.**

---

## 33. Ma trận xử lý phản biện 2026-08-09

Record phản biện ghi nhầm tổng `24`; inventory theo ID có **33 finding duy
nhất: 10 P0, 17 P1, 6 P2**. Trạng thái dưới đây chỉ nghĩa là finding đã được xử
lý trong proposal, không nghĩa baseline/implementation/release gate đã đóng.

| Nhóm finding | Cách xử lý trong v2.1 |
|---|---|
| `PB-A-01..05` | Tuyên bố Proposal/amendment; thêm crosswalk; dùng `PROG-OD-001-AUD`; sửa ADR; hạ edition/năm standards về `UNVERIFIED` (header, §2, §25.8, §30–31). |
| `PB-B-01..08` | Priority 5/6 + anti-windup; đúng ba Point category/identity/type matrix; cycle 1/5/30; một Task; align roadmap; graph cutover fail closed (§5–6, §9–14). |
| `PB-C-01..07` | Hold-last bumpless; link module Chạy thử; structured change manifest; optimistic concurrency; signature threat model/scope; security event; monotonic TIME/Scheduler wall-clock (§14–23). |
| `PB-D-01..04` | UC/page mapping thống nhất trong companion UX; scope IN/OUT duy nhất; bỏ milestone C0.9; G0 RED/not locked (§5.3, §23–24, §28 và UX §4/21/45). |
| `PB-E-01..06` | Core state one-box, i18n VI/EN, FBD keyboard path, HMI out, error catalogue, replacement UC-17 (UX §12/15/20/31/37/21; Product §26.1). |
| `PB-F-01..03` | NFR có số; requirement có method/acceptance/crosswalk; G0 chờ `OD-PROG-015` (§25.8, §26, §28). |

Vòng 2 được đóng trong v2.2 như sau:

| Finding | Cách xử lý trong v2.2 |
|---|---|
| `R2-01` | Đồng bộ wireframe Runtime về đúng một Task Rev A và bỏ Priority giữa nhiều Task. |
| `R2-02` | Loại `FbdCanvas`, `ApplicationFunctionSummary` và `FunctionalDocumentationPanel` khỏi component inventory Rev A. |
| `R2-03` | Bỏ gate “6 routes/pages”, functional documentation và as-built export khỏi trình tự triển khai Rev A. |
| `R2-04` | Đồng bộ nhãn UC và tên trang Runtime/Bảo trì với catalog use case v2.2. |
| `R2-05` | Thay Programming state `Offline` bằng core `DEGRADED/UNREACHABLE`; giữ `OFFLINE` riêng cho Point quality. |
| `R2-06` | Hold-last chuyển sang đóng góp mức 5, không chụp `actual_value` sau resolver (§16.7). |
| `R2-07` | Anti-windup tách back-calculation khi mức 5 thắng nhưng saturate với freeze khi thua arbitration (§14.4). |
| `R2-08` | Bổ sung hard bound `IOP_SAFE_TIMEOUT_MS=200 ms`, cấm activation làm đứt poll và G6/HIL đo gap (§16.7, §26, §28–29). |
| `R2-09` | Định nghĩa base step độc lập Task period, công thức watchdog và reject đường Task 30 s + unit 6 s (§14.6, §28–29). |
| `R2-10` | Overrun chỉ degrade Task; plant safe-state cần SafetyManager condition; thêm resource-isolation/Check-load evidence (§14.3, §26, §28–29). |
| `R2-11` | Requirement giữ `PRG-COM-001`; error class đổi sang `PRG-ERR-COM-001` và catalog được trả về IFSPEC (§26.1). |
| `R2-12` | Bundle source-only, reject artifact/IR/native và luôn build lại trên target (§5, §13.5, §25.5, §29). |
| `R2-13` | User FB chỉ cục bộ Project; global catalogue/package/binary FB ngoài Rev A (§5, §9.5, §25.2). |
| `R2-14` | Required capability liệt kê override active với actor/TTL/value/priority (§23, §25.5). |
| `R3-01` | Chuyển toàn bộ mã mapping còn sót sang namespace `PRG-ERR-MAP-*` do `IFSPEC-PROG-001` sở hữu (§12.4, §26.1). |
| `R3-02` | Tách đủ từng dòng `R2-01..14` trong inventory xử lý để không bỏ sót finding. |
| Traceability/ownership | Crosswalk từng ID, catalog verification duy nhất, Product bỏ IA/compiler pipeline/error catalog; UX bỏ storage authority và các semantics trùng (§15, §24–29 và companion). |

## 34. Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung | Trạng thái |
|---|---|---|---|
| v2.0 | 2026-08-08 | Bản DDC-first ban đầu. | Draft; bị phản biện, không baseline. |
| v2.1 | 2026-08-09 | Xử lý đủ 33 finding, thu hẹp scope, thêm safety/traceability/verification. | Proposal / In Review. |
| v2.2 | 2026-08-09 | Đóng R2-01..14; sửa semantics mức 5/IOP/watchdog/overrun; trace từng ID; hợp nhất verification; cắt trùng Product–UX; sửa hậu kiểm R3-01/R3-02 trước khi nhập amendment. | Proposal / In Review; chưa phê duyệt. |

---

## 35. Phê duyệt / sign-off

| Vai trò | Người phê duyệt | Ngày | Quyết định | Bằng chứng/biên bản |
|---|---|---|---|---|
| Product Owner | _Chưa ký_ | — | `PENDING` | `OD-PROG-015` |
| Software/Runtime Architect | _Chưa ký_ | — | `PENDING` | R2-06..10 + design authority liên quan |
| Controls/Safety Reviewer | _Chưa ký_ | — | `PENDING` | `VS-PROG-010`, `VS-PROG-013`, `VS-PROG-014`, `VS-PROG-015` |
| UX Lead | _Chưa ký_ | — | `PENDING` | Companion UX v2.2 + usability record |
| Verification Lead | _Chưa ký_ | — | `PENDING` | `TRACE-PROG-001` + catalog §29 |

Không được đổi Status sang Approved/Baseline khi còn bất kỳ ô `PENDING`, gate
G0 còn RED hoặc requirement/scenario chưa được nhập vào authority tương ứng.

---

**END OF PRODUCT SPECIFICATION PROPOSAL — v2.2**
