# Product Spec Programming MK-DDC-24 — V2.2 Hybrid

| Thuộc tính | Giá trị |
|---|---|
| Document ID | `PROD-PROG-001` — candidate revision, giữ ID của Product authority hiện hành |
| Tên bản review | `V2.2 HYBRID` |
| Trạng thái | **In Review — READY FOR PM/CTO REVIEW** |
| Ngày | 2026-08-14 |
| Chủ quản | Product Owner |
| Người review bắt buộc | PM, CTO, Product Owner, System Architect, FW-SOM Lead, QA Lead |
| Authority hiện hành | [`DDC24_PROGRAMMING_PRODUCT_SPEC.md`](DDC24_PROGRAMMING_PRODUCT_SPEC.md), `PROD-PROG-001`, Revision A, `Active` |
| Quan hệ authority | Bản candidate để review; **không** là authority thứ hai, không supersede bản `Active` trước khi có phê duyệt và rebaseline có kiểm soát |
| Target release | `TBD-HYB-01` — PM/CTO/Product Owner quyết định giữ Rev A, tạo Rev B hay phiên bản kế tiếp |
| Release gate | Không thay đổi; `RELEASE_READY` vẫn bị chặn theo bằng chứng hiện hành |
| Evidence snapshot | Rà soát ngày 2026-08-14 trên base `6262c36f9b91473fb9c533f6c7f5c7f898970180`; worktree tổng thể dirty nhưng toàn bộ path `E-AB-*` bên dưới khớp base; `CONTROL.md` dùng worktree blob `7806676c6cd3ebef0c934f1bf18f5e86b4e7270e` |

> **Cảnh báo kiểm soát tài liệu:** file này thực hiện đúng deliverable review được
> yêu cầu. Chỉ các quyết định được PM/CTO/Product Owner ký mới được hợp nhất vào
> Product authority `Active`. Việc ký Product Spec không chứng minh source đã
> implement, target/HIL đã PASS hoặc sản phẩm đã sẵn sàng release.

## 0. Executive Summary

1. V2.2 Hybrid đổi mental model bình thường từ **Task-centric** sang **Program-centric**.
2. Người dùng tạo, sửa ST/FBD, Check, Commission, Enable/Disable và quan sát từng Program.
3. Task, thread, worker, CPU core và affinity trở thành chi tiết runtime nội bộ hoặc chẩn đoán nâng cao.
4. FW-SOM vẫn lập lịch theo internal RT Task; runtime tự ánh xạ Program vào Task phù hợp.
5. Enable chỉ có nghĩa Program đủ điều kiện được lập lịch, không tạo dependency ngầm.
6. Mười Program độc lập không bị tuần tự hóa chỉ vì thứ tự tạo; mức song song thật phụ thuộc tài nguyên target.
7. Program không chia sẻ writable memory tự do; trao đổi qua snapshot đọc và Published Signal có freshness rõ.
8. Program chỉ phát Output Candidate; ownership, arbitration, interlock và Safe-State quyết định Physical I/O.
9. Commission/Activation vẫn atomic; candidate lỗi không làm dừng Active Revision/LKG hiện tại.
10. ST, FBD, POU, Mapping, Library, RETAIN, Monitor, Trace, History, Rollback, Audit và Backup được giữ.
11. As-Built hiện vẫn là `1 Task / 1 Program`, scheduler tuần tự; Hybrid là thay đổi lớn, chưa được implement.
12. Bản này chỉ đủ để PM/CTO review Product Decision; chưa `APPROVED`, chưa mở implementation/release gate.

## 1. Cách đọc và phân loại bằng chứng

Mỗi phát biểu quan trọng dùng đúng một trong các nhãn sau:

| Nhãn | Ý nghĩa trong tài liệu này |
|---|---|
| **FACT/REF** | Sự kiện hoặc ranh giới có nguồn chủ quản/tiêu chuẩn/manual/datasheet. |
| **STD** | Tham chiếu tới tiêu chuẩn/tài liệu kỹ thuật ngành đã công bố (ví dụ IEC 61131-3, IEC TR 61131-8, ISO 16484, IEC 62443); dùng cho Evidence Register/Traceability §20.4. Gắn nhãn `STD` **không** tự là tuyên bố compliance/certification cho MK-DDC-24. |
| **BENCHMARK** | Cách một sản phẩm khác tổ chức khái niệm; chỉ dùng làm tham khảo, không phải tiêu chuẩn ngành. |
| **AS-BUILT** | Hành vi/code/contract MK-DDC-24 hiện có tại snapshot được dẫn; không tự trở thành Product Decision. |
| **PRODUCT DECISION** | Quyết định ứng viên riêng của Mekong trong bản V2.2 Hybrid; chỉ có hiệu lực sau phê duyệt. |
| **INFERENCE** | Suy luận kỹ thuật từ bằng chứng; phải được design/verification xác nhận trước triển khai. |
| **TBD** | Chưa đủ căn cứ hoặc cần người có thẩm quyền quyết; luôn có owner, impact, gate và điều kiện mở khóa. |

Các từ **phải**, **không được** và **chỉ được** trong tài liệu này là normative
candidate và phải truy được tới `PD-HYB-*`. Nội dung `AS-BUILT`, `BENCHMARK` hoặc
`INFERENCE` không tự tạo nghĩa vụ sản phẩm.

## 2. Product Goal

**PRODUCT DECISION — `PD-HYB-01`:** Programming phải cho kỹ thuật viên BMS làm
việc theo đối tượng **Program**, hoàn thành luồng chính
`Create → Edit → Check → Commission → Enable → RUNNING` mà không phải thiết kế
Task, thread hoặc CPU topology.

Product outcome cần đạt:

- giảm số khái niệm runtime bắt buộc trong luồng hằng ngày;
- giữ ST/FBD và công cụ điều khiển HVAC/BACS hiện có;
- hỗ trợ ít nhất fixture chấp nhận gồm **10 Program Enabled**;
- cho phép runtime tận dụng nhiều CPU core khi target, dependency và resource
  budget cho phép, nhưng không hứa `10 Program = 10 Program chạy vật lý đồng thời`;
- giữ activation, output và safe-state deterministic, fail-closed và truy nguyên;
- giữ control path local khi Web/engineering client mất kết nối.

## 3. Scope và Out of Scope

### 3.1 Trong phạm vi V2.2 Hybrid

**PRODUCT DECISION — `PD-HYB-01..10`:** bản candidate này khóa ở cấp Product:

- mental model Program-centric và progressive disclosure Normal/Advanced;
- tập tính năng Programming cần giữ;
- domain, lifecycle và properties của Program;
- ý nghĩa Commission, Enable, Disable và Runtime State;
- nguyên tắc Auto Task Mapping và multicore scheduling nội bộ;
- dependency, data sharing, RETAIN ownership và freshness;
- output ownership, arbitration, interlock và safe-state;
- fault containment, monitor/diagnostics và audit;
- Acceptance Criteria và ranh giới migration nếu được duyệt.

Phạm vi Programming tiếp tục giữ ST, FBD, Local Physical I/O, Virtual Point,
Modbus RTU Point và cycle `1 s / 5 s / 30 s` từ Product authority hiện hành.

### 3.2 Ngoài phạm vi tài liệu này

**FACT/REF:** Product Spec trả lời “sản phẩm phải làm gì”; các mục sau thuộc
Requirement/ADR/Detailed Design/Implementation/Verification, không được khóa
chi tiết trong task này:

- thuật toán bin-packing, worker pool, thread model, CPU affinity hoặc scheduler API;
- schema database, OpenAPI payload, artifact ABI, IPC layout và migration script;
- route, pixel, layout, component, modal/drawer hoặc asset UI chi tiết;
- source change cho FE, BE, FW-SOM, Core, MCU hoặc database;
- deployment, feature enablement, đóng finding, HIL/release evidence;
- LD, SFC, Modbus TCP Point, BACnet/IP Point, motion, safety PLC và online change;
- tuyên bố IEC 61131-3 compliant/certified, functional safety hoặc vendor equivalence.

### 3.3 Ranh giới legacy graph

**FACT/REF:** `ADR-020`, `ADR-023` và `OD-PROG-013` phân biệt Component Graph
legacy với FBD và khóa mode `GRAPH_ONLY/PROGRAM_ONLY`; dual-run là invalid.

**PRODUCT DECISION — `PD-HYB-09`:** “Hybrid” trong tài liệu này là kết hợp
**Program-centric product model** với **Task-centric internal runtime**. Nó
không có nghĩa GraphRuntime và Program Runtime cùng sở hữu Local logic. Graph
chỉ là nguồn migration/compatibility, không được relabel thành FBD và không
được đóng góp output song song với Program Runtime.

## 4. User Mental Model

### 4.1 Mô hình bình thường

```text
USER / PRODUCT MODEL

Program
├── Create
├── Edit ST/FBD
├── Check
├── Commission
├── Enable / Disable
├── Execution Cycle: 1 s / 5 s / 30 s
└── Runtime State
          │
          ▼
================ PRODUCT / RUNTIME BOUNDARY ================
          │
FW-SOM INTERNAL RUNTIME
          │
   Auto Task Mapping
          │
   Internal RT Tasks
          │
   Multicore Scheduler
          │
      CPU Cores
```

**PRODUCT DECISION — `PD-HYB-01`:** Normal user không phải tạo Task, gán
Program vào Task, chọn core/thread/worker hoặc quản lý CPU affinity. Project và
Controller là context truy nguyên; Program là đối tượng chính để author và vận
hành. Application/Group là metadata tùy chọn để lọc/nhóm, không tạo scheduling
semantics hoặc lifecycle riêng.

### 4.2 Hai cực bị loại bỏ

| Cực bị loại | Lý do Product | Phán quyết |
|---|---|---|
| User tự tạo Task → gán Program → chọn order → mới chạy | Bắt kỹ thuật viên BMS sở hữu topology runtime và tăng sai cấu hình. | **PRODUCT DECISION — `PD-HYB-01`: LOẠI khỏi Normal UX.** |
| `1 Program = 1 Thread = 1 CPU Core` | Lãng phí resource, không portable và nhầm Program với scheduling resource. | **PRODUCT DECISION — `PD-HYB-02`: KHÔNG phải product contract.** |

## 5. Programming Feature Set

### 5.1 Tính năng giữ nguyên

**PRODUCT DECISION — `PD-HYB-01`, `PD-HYB-09`:** Hybrid chỉ thay phần mental
model và runtime scheduling bị ảnh hưởng. Các capability sau tiếp tục là phạm
vi Product, với mức hoàn tất thực tế vẫn phải đọc từ As-Built/evidence riêng:

| Nhóm | Capability giữ |
|---|---|
| Ngôn ngữ | ST và structured FBD Rev A. |
| Cấu trúc logic | Program, POU, Function, Function Block, Core Library, User FB cục bộ Project. |
| Dữ liệu | Variable, Point Mapping, Local/VP/Modbus RTU Point, type/direction/quality/freshness. |
| Authoring | Create/Edit, Check/Validation, typed IR/artifact và diagnostic có truy nguyên nguồn. |
| Vòng đời | Immutable Revision, Commission, atomic Activation, Active vs Editing Revision, Version History, Rollback/LKG. |
| Runtime | Enable/Disable, Online Monitor, Watch, bounded live Trace, diagnostics. |
| Bền vững | RETAIN có stable identity/policy; Backup/Import/Export có checksum và compatibility. |
| Quản trị | Server-authoritative RBAC, audit, idempotency/concurrency guard. |
| An toàn | Output ownership, priority arbitration, interlock, safe-state và local-first control. |

**PRODUCT DECISION — `PD-HYB-07`, `PD-HYB-09` (`E-FR-07`):** các authority
hiện hành cho Point Table/priority winner, user authorization/audit và Alarm
truth tiếp tục là canonical; Programming chỉ bind/publish/link qua contract
được duyệt, không tạo các truth song song. Ownership của tích hợp Schedule/Trend
nếu được dùng phải do downstream Architecture chỉ định, không được suy từ tài
liệu này.

**PRODUCT DECISION — `PD-HYB-10`:** `History` ở đây là lịch sử
Revision/operation/audit theo retention được duyệt;
không mặc định hứa full-text audit explorer, persistent trace historian hoặc
không giới hạn retention.

### 5.2 Tính năng thay đổi bởi Hybrid

| Nội dung | V2.2 Hybrid |
|---|---|
| Đối tượng chính | Program, không phải Task. |
| Cycle | Normal property của Program; runtime tự group/map theo cycle hợp lệ. |
| Enable/Disable | Lệnh runtime riêng, không đồng nghĩa Commission. |
| Task | Internal scheduling resource; chỉ đọc trong Advanced/Diagnostics nếu cần. |
| Order | Không tạo dependency từ thứ tự tạo; chỉ có deterministic in-task order nội bộ. |
| Concurrency | Independent internal Tasks phải eligible cho concurrent execution. |
| Fault radius | Lỗi một Program không mặc định dừng Program độc lập. |
| Data sharing | Private state + read-only snapshot + Published Signal; cấm shared writable memory tự do. |

### 5.3 Roadmap/ngoài Rev A tiếp tục giữ ranh giới

LD, SFC, free-form FBD wiresheet, BMS template library, online change, force/write
từ Online Monitor và trusted-origin artifact signing không được đưa vào V2.2
Hybrid chỉ vì runtime đổi. Graph import/migration cũng không biến Graph thành
ngôn ngữ FBD thứ hai.

## 6. Mười Product Decision quan trọng

Tất cả quyết định dưới đây là **candidate** cho đến khi có phê duyệt.

| ID | Phân loại | Quyết định Product | Căn cứ chính |
|---|---|---|---|
| `PD-HYB-01` | PRODUCT DECISION | Program là primary object; Task/core/thread/affinity không bắt buộc trong Normal UX. | Product goal; yêu cầu task; `E-BM-01`, `E-BM-04`. |
| `PD-HYB-02` | PRODUCT DECISION | Runtime vẫn Task-centric và tự map Program; không áp đặt `1 Program = 1 Task/thread/core`. | `E-BM-01..04`, `E-INF-01`. |
| `PD-HYB-03` | PRODUCT DECISION | Commission và Enable là hai hành động độc lập; Enable nghĩa là eligible for scheduling, không chứng minh đang chạy. | Lifecycle safety hiện hành; `E-AB-03`. |
| `PD-HYB-04` | PRODUCT DECISION | Không có dependency/serialization ngầm từ thứ tự tạo; independent Programs/Tasks phải eligible concurrent/parallel khi phù hợp. | Yêu cầu task; `E-BM-02`; AC-02/03/08. |
| `PD-HYB-05` | PRODUCT DECISION | Dependency chỉ tồn tại khi khai báo hoặc constraint kiến trúc được Product cho phép; ordering và data visibility phải deterministic. | `E-BM-03`, `E-INF-02`. |
| `PD-HYB-06` | PRODUCT DECISION | Mỗi Program có private state; trao đổi qua read-only snapshot/Published Signal; không có shared writable memory tự do; RETAIN có owner. | `E-AB-02`, `E-BM-03`. |
| `PD-HYB-07` | PRODUCT DECISION | Program phát Output Candidate; ownership/arbitration/interlock/safe-state quyết định physical output; cấm last-run-wins. | Architecture control path; `E-AB-05`, `E-AB-08`. |
| `PD-HYB-08` | PRODUCT DECISION | Fault/Disable của một Program không mặc định dừng Program độc lập; dependent Program có trạng thái blocked rõ. | AC-04/05; gap `E-AB-02`. |
| `PD-HYB-09` | PRODUCT DECISION | Check/Commission/Activation package-level, atomic, giữ Active/LKG khi candidate lỗi; graph/program owner vẫn độc quyền. | Product authority; Architecture; `E-FR-05`, `E-AB-04`, `E-AB-07`. |
| `PD-HYB-10` | PRODUCT DECISION | Normal UX chỉ hiện outcome; Advanced/Diagnostics mới hiện mapping/task/core, wait reason, deadline/watchdog/overrun và metrics. | Progressive disclosure; AC-08A/08B/09. |

## 7. Program Domain Model

### 7.1 Đối tượng Product

**PRODUCT DECISION — `PD-HYB-01..03`, `PD-HYB-05..09`:** bảng dưới đây khóa
nghĩa Product và ownership boundary; storage/schema chi tiết thuộc downstream
Design.

| Đối tượng | Định nghĩa Product | Ownership/lifecycle |
|---|---|---|
| Controller | Target context có tối đa một active Programming package tại một thời điểm. | Runtime authority. Số Project được lưu đồng thời là `TBD-HYB-02`. |
| Project | Aggregate truy nguyên chứa Programs, Variables, Point bindings, library profile và Revision history. | Product/BE authority cho authoring; không phải runtime status authority. |
| Program | Đơn vị logic ST hoặc FBD có identity ổn định, revisioned source, properties, private state và runtime status. | User-facing primary object. |
| POU / Function / FB | Logic tái sử dụng được Program gọi theo rule của language/library profile. | Thuộc Project/Revision; không tự là scheduling unit. |
| Variable | Dữ liệu typed thuộc Program/POU; có thể private, input từ Point/signal, output candidate hoặc RETAIN. | Một owner ghi rõ; không mặc định shared. |
| Point Binding | Liên kết typed/directed giữa Program variable và canonical Point. | Check/Commission xác thực quyền, type, quality và ownership. |
| Published Signal | Kênh dữ liệu typed, single-publisher để Program khác đọc mà không chia sẻ writable memory. **Runtime/data-exchange concept candidate**, chưa phải canonical Point type — xem ranh giới bắt buộc ngay dưới bảng. | Producer sở hữu publish; consumer chỉ đọc. |
| Revision | Snapshot bất biến của package và impact set đã Check. | Editing và Active luôn phân biệt. |
| Commissioned Package | Revision/artifact/mapping manifest đã được runtime chấp nhận. | Có thể chứa Program Enabled hoặc Disabled; Commission không tự Enable lần đầu. |
| Internal RT Task | Scheduling resource do runtime tạo/quản lý. | Không phải entity authoring bình thường. |
| Output Candidate | Đề xuất giá trị có owner/quality/generation từ Program. | Chưa phải physical output. |

**PRODUCT DECISION — `PD-HYB-06` (ranh giới Published Signal vs canonical Point):**
User-facing Programming Data Model chỉ khóa hai loại truth ghi/đọc:

1. **Program Variable** — dữ liệu nội bộ Program/POU (§7.1 hàng `Variable`).
2. **Canonical Point** — `Local Physical Point`, `Virtual Point`, `Protocol Point`
   (Rev hiện tại giới hạn `Modbus RTU Point`), theo đúng scope §3.1/§5.1.

`Published Signal` **không** tự động trở thành một canonical Point type mới ở
Product layer. Nó chỉ là runtime/data-exchange concept candidate cho tới khi
downstream Runtime/Business Core Architecture chọn dứt khoát một trong hai:

- **A.** Published Signal là internal runtime primitive, không lộ ra như Point; hoặc
- **B.** Published Signal được expose thông qua canonical Virtual Point contract
  hiện có, không tạo type mới.

Không được tồn tại hai writable/shared truth cho cùng một semantic value cùng
lúc (một Point canonical + một Published Signal canonical riêng cho cùng dữ
liệu). Consumer không được mutate producer state dù qua Published Signal hay
qua Point. **Đây là Product-level blocker phải khóa tại `TBD-HYB-06` trước
`IMPLEMENT_READY[HYBRID]`** (xem §23); Check/Commission không được chấp nhận
candidate tạo type dữ liệu song song chưa được quyết định A hay B.

### 7.2 Bất biến domain

**PRODUCT DECISION — `PD-HYB-03`, `PD-HYB-05..09`:**

1. Program identity không đổi khi được remap sang internal Task/core khác.
2. Editing Revision không ghi đè Active Revision.
3. Mỗi writable state có đúng một owner; consumer không được ghi ngược vào
   private state hoặc Published Signal của producer.
4. Internal Task identity/mapping không được dùng làm business identity của Program.
5. Mapping, dependency, data visibility, output ownership và RETAIN impact phải
   được Check trước Commission.
6. Graph và Program không đồng thời là owner Local logic.
7. Runtime State phải đến từ runtime authority; UI không suy diễn `RUNNING` từ
   việc request Enable/Commission đã được gửi.

## 8. Program Lifecycle

**PRODUCT DECISION — `PD-HYB-03`:** Engineering/Revision state và Runtime
Program state là hai state domain **độc lập**, không được trình bày như một
lifecycle tuyến tính duy nhất. Một Program/Revision có thể ở bất kỳ tổ hợp hợp
lệ nào của hai domain cùng lúc (ví dụ Editing đang `CHECK_FAILED` trong khi
Active vẫn `RUNNING` — xem §8.3).

### 8.1 Engineering / Revision State

```text
DRAFT
  → CHECKING
      ├── CHECK_FAILED ── sửa ──> DRAFT
      └── CHECKED
            → COMMISSIONING
                ├── COMMISSION_FAILED ──> giữ Editing Revision ở trạng thái lỗi;
                │                          KHÔNG đổi Active Revision (xem §8.3)
                └── COMMISSIONED
```

- `Check` không tạo runtime side effect; chỉ đánh giá Editing Revision.
- `Commission` (= **Commission Changes**, §14) xác nhận candidate
  package/mapping có thể được runtime chấp nhận; đây là engineering-plane
  transaction, không tự Enable Program nào.
- `COMMISSIONED` là trạng thái Revision, không phải trạng thái Program đang
  chạy — trạng thái chạy thuộc Runtime Program State (§8.2).

### 8.2 Runtime Program State

```text
DISABLED
  → STARTING
      → RUNNING
          ├── WAITING_CPU
          ├── WAITING_DEPENDENCY / BLOCKED_DEPENDENCY
          ├── WAITING_IN_TASK_ORDER
          ├── FAULTED
          ├── STOPPING ──> DISABLED
          └── UNKNOWN/RECONCILING
```

- `Enable` ghi desired intent “đủ điều kiện được scheduler phát hành”; chỉ
  read-back runtime mới xác nhận `STARTING/RUNNING/BLOCKED/FAULTED`.
- `Disable` loại Program khỏi eligibility tại controlled boundary
  (`STOPPING → DISABLED`) và áp explicit output policy (§13.1); nó không mặc
  định dừng Program độc lập.
- Với Program đang Enabled, atomic activation của một Revision mới giữ enabled
  intent tách biệt khỏi engineering state của Revision đó (§8.3, AC-19).
- Timeout/transport loss cho kết quả `UNKNOWN/RECONCILING`, không optimistic
  replay mutation.
- Chi tiết ngữ nghĩa từng state quan sát: xem bảng §8.4.

### 8.3 Revision Truth — Editing vs Active đồng thời

**PRODUCT DECISION — `PD-HYB-03`, `PD-HYB-09`:** `Editing Revision` (kết quả
Engineering/Revision State §8.1) và `Active Revision` (Revision đang chạy theo
Runtime authority) **có thể tồn tại đồng thời** và độc lập với nhau. Check hoặc
Commission failure của Editing Revision **không được** làm Active Revision đổi
trạng thái.

Ví dụ bắt buộc dùng làm reference:

```text
Editing Revision = r16 / CHECK_FAILED
Active Revision  = r15 / RUNNING
```

Ở đây r16 đang bị lỗi Check (do user sửa dở), trong khi r15 vẫn là package
đang chạy thật trên runtime, độc lập hoàn toàn. UI không được gộp hai trạng
thái này thành một badge/status duy nhất theo kiểu "Program đang lỗi".

### 8.4 Runtime State tối thiểu

| State | Ý nghĩa Product |
|---|---|
| `DISABLED` | Commissioned nhưng không eligible cho scheduler. |
| `STARTING` | Enable đã được runtime chấp nhận, chưa có read-back cycle thành công. |
| `RUNNING` | Eligible và đã có cycle thành công theo active mapping/revision. |
| `WAITING_CPU` | Đến hạn nhưng chờ scheduling resource; không phải dependency wait. |
| `WAITING_DEPENDENCY` / `BLOCKED_DEPENDENCY` | Chờ hoặc bị chặn bởi dependency explicit. |
| `WAITING_IN_TASK_ORDER` | Chờ vị trí deterministic trong cùng internal Task. |
| `FAULTED` | Program fault; independent Programs không mặc định bị dừng. |
| `STOPPING` | Disable được áp tại controlled boundary. |
| `UNKNOWN/RECONCILING` | Authority chưa xác định; UI không được trình bày như success hoặc safe. |

Tên enum public cuối cùng thuộc Contract Design; bảng này khóa **ngữ nghĩa
quan sát**, không khóa wire value.

## 9. Program Properties

### 9.1 Normal properties

**PRODUCT DECISION — `PD-HYB-01`, `PD-HYB-03`, `PD-HYB-10`:** Normal
properties phải đủ để người dùng hoàn thành flow chuẩn mà không cấu hình
runtime topology.

| Property | Product semantics | Rule candidate |
|---|---|---|
| Stable ID | Identity bất biến, không dùng display name làm key. | System-managed, read-only. |
| Name | Tên người dùng nhận biết Program. | Required; unique trong Project theo rule phải được contract hóa. |
| Description | Mô tả mục đích/không gian phục vụ. | Optional; không ảnh hưởng scheduling. |
| Programming Language | `ST` hoặc `FBD`. | Required; đổi language tạo content/revision change có kiểm soát. |
| Enable / Disable | Desired runtime intent riêng với Commission. | Có authoritative state và audit. |
| Execution Cycle | `1 s`, `5 s` hoặc `30 s`. | Program property; runtime tự map/group, không expose Task config. |
| Application / Group | Tag/context để lọc và tổ chức. | Optional; không tự tạo dependency, priority hay owner. |
| Runtime State | Disabled/Starting/Running/Waiting/Faulted/Unknown. | Read-only từ runtime authority, có timestamp/freshness. |

### 9.2 Advanced Product-configurable properties (ưu tiên Rev hiện tại)

**PRODUCT DECISION — `PD-HYB-05..08`:** ba property dưới đây là Advanced
property **user-configurable** mà Rev hiện tại ưu tiên khóa; normal user
không phải cấu hình chúng để hoàn thành flow chuẩn (§9.1), nhưng người có
quyền Advanced có thể cấu hình có validation.

| Property | Product semantics | Trạng thái |
|---|---|---|
| Explicit Dependency | Data/Execution/Health-Availability dependency khai báo tường minh (§11). | `PD-HYB-05`; types và same-cycle semantics `TBD-HYB-05`. |
| Disable Policy | Cách rút/giữ Output Candidate khi Disable. | `PD-HYB-07/08`; class/TTL `TBD-HYB-07`. |
| RETAIN Policy | Variable nào giữ qua loại restart được duyệt. | `PD-HYB-06`; stable owner; matrix `TBD-HYB-08`. |

### 9.3 Runtime Policy / Advanced Diagnostics / TBD

**PRODUCT DECISION — `PD-HYB-02`, `PD-HYB-08`, `PD-HYB-10`:** các mục dưới
đây — **raw Scheduling Priority, raw Deadline, raw Watchdog** — **không được
mặc định coi là user-configurable Product property** trước khi `TBD-HYB-04`
được khóa. Cho tới lúc đó chúng ở lớp Runtime Policy/Advanced
Diagnostics/TBD: hiển thị read-only hoặc summary/impact, không mở form cấu
hình trực tiếp cho user, trừ khi PM/CTO phê duyệt riêng ngoài Rev này.

| Property | Product semantics | Trạng thái |
|---|---|---|
| Scheduling Priority | Relative scheduler intent, **khác output priority**. | `PD-HYB-02/10`; **chưa mặc định user-configurable**; range/default/khả năng mở cấu hình `TBD-HYB-04`. |
| Deadline | Latest acceptable completion relative to release. | `PD-HYB-10`; **chưa mặc định user-configurable**; rule/admission `TBD-HYB-04`. |
| Watchdog | Bound phát hiện Program/Task không hoàn tất đúng policy. | `PD-HYB-08/10`; **chưa mặc định user-configurable**; target rule `TBD-HYB-04`. |
| Execution Diagnostics | Mapping/task/core, wait reason, WCET/deadline/overrun/fault counters. | `PD-HYB-10`; read-only theo target capability, không phải cấu hình. |

Normal user không phải nhập Task ID, worker, thread, core hoặc affinity; CPU/
core/affinity **không được expose như business identity** ở bất kỳ lớp nào
(Normal hay Advanced) — chỉ xuất hiện như Advanced Diagnostics read-only
(§15.2). Không property Advanced/Diagnostics nào được bypass Check/admission,
output arbitration, interlock hoặc safe-state.

## 10. Hybrid Runtime Concept

### 10.1 Product contract của Hybrid

**PRODUCT DECISION — `PD-HYB-02`:** Program là unit quản lý sản phẩm; internal
RT Task là unit scheduling. Runtime có thể group nhiều Program vào một Task hoặc
tách thành nhiều Task theo cycle, explicit dependency, timing/safety constraint
và resource budget. Không có quan hệ bắt buộc một-một giữa Program, Task, thread
và CPU core.

**PRODUCT DECISION — `PD-HYB-04` (Product MUST requirement, giữ nguyên văn để
làm neo trace cho AC-08A):**

> “Independent Programs are independently schedulable by default and SHALL NOT
> acquire implicit execution dependency from creation order, UI order, name, or
> internal Task placement.”

Multicore **không được** trình bày như semantics bắt buộc của Program — nó là
**TARGET-DEPENDENT RUNTIME CAPABILITY** (chi tiết hóa ở §10.4).

**AS-BUILT:** profile hiện hành `revA-1t-1-5-30` khóa
`maxTasks=1`, `maxProgramsPerTask=1`, `maxProgramsTotal=1`; bootstrap/scheduler
hiện chạy tuần tự, non-preemptive trên control thread. Đây là migration gap,
không phải bằng chứng cho Hybrid.

### 10.2 Auto Task Mapping

**PRODUCT DECISION — `PD-HYB-02`, `PD-HYB-04`, `PD-HYB-05`, `PD-HYB-08`:**

> “Programs whose required fault-containment semantics cannot be preserved
> inside the same internal runtime Task SHALL NOT be mapped into that Task.”

Auto Task Mapping **không chỉ** xét cycle, CPU capacity và scheduling
properties. Mapper bắt buộc phải xét thêm, dùng làm input sản phẩm tối thiểu:

- Program ID và Enabled intent;
- cycle `1/5/30 s`;
- scheduling priority, deadline, watchdog và resource budget đã được chấp nhận;
- **fault containment** — theo quote MUST NOT ở trên, không được gộp hai
  Program cần fault domain tách biệt vào cùng một internal Task;
- **explicit dependency** graph (Data/Execution/Health-Availability, §11) và
  published-signal/data visibility;
- **output ownership** (§13) và safety/interlock constraint;
- **timing/safety constraint** (deadline, watchdog, interlock boundary);
- **target capability** — target runtime profile/capacity hiện hành.

Output quan sát được của Check/Commission phải gồm mapping manifest/identity,
version và lý do reject đủ để audit. Với cùng candidate, runtime profile và
policy version, mapping semantics phải deterministic. Exact algorithm, Task ID,
worker pool và core placement thuộc Detailed Design — nhưng optimization của
mapper (gộp Task để tiết kiệm resource, cân bằng tải, v.v.) **không được phép
phá vỡ** Product semantics nêu trên (fault containment, dependency, ownership).

Program trong cùng internal Task có deterministic order. Order đó không tự tạo
business dependency và không được dùng để hứa same-cycle visibility nếu không
có dependency explicit. Mapping được freeze theo Commissioned Revision; runtime
không được âm thầm remap làm thay đổi data/output semantics. Recovery/remapping
khi mất core/overload là `TBD-HYB-11`.

### 10.3 Khi có 10 Program Enabled

```text
P1  ─┐
P2  ─┤
P3  ─┤
...  ├──> Auto Task Mapping ──> Internal RT Tasks ──> Multicore Scheduler
P10 ─┘                                      │
                                            ├──> Core 0
                                            ├──> Core 1
                                            └──> Core N (nếu được cấp)
```

**PRODUCT DECISION — `PD-HYB-04`:** fixture chấp nhận của V2.2 gồm ít nhất 10
Program Enabled. Chúng không được serialize **chỉ vì thứ tự tạo**. Independent
Tasks phải eligible concurrent; nếu target cấp từ hai RT core phù hợp thì test
phải chứng minh có parallel overlap. Sản phẩm không hứa cả 10 Program luôn chạy
vật lý đồng thời hoặc mỗi Program có core riêng.

Số Program thương mại tối đa trên một controller, số internal Task tối đa và
admission limit trên từng target là `TBD-HYB-03`; nhưng quyết định đó không được
làm mất acceptance fixture 10 Program nếu không rebaseline bản candidate này.

#### 10.3.1 “10 Program Reference Fixture” — định nghĩa Product/V&V boundary

**PRODUCT DECISION — `PD-HYB-04`:** fixture chấp nhận **không được** dùng 10
Program empty/trivial để chứng minh capacity/scheduling. Fixture tối thiểu
phải có cấu trúc:

| Nhóm | Cycle | Nội dung logic tối thiểu |
|---|---|---|
| `P1`–`P4` | 1 s | PID/scaling/control logic; nhiều Point input; physical/virtual output candidate. |
| `P5`–`P7` | 5 s | Sequencing/supervisory logic. |
| `P8`–`P10` | 30 s | Supervisory/energy/monitoring logic. |

Fixture phải định nghĩa downstream measurement tối thiểu cho mỗi Program:

- IR/workload size class;
- runtime state size;
- Point count (input + output);
- output count;
- expected execution-load class.

Product Spec **không khóa WCET cụ thể** cho fixture này khi chưa có target
measurement — WCET/timing threshold thật thuộc `TBD-HYB-11` và Detailed
Design/target verification, không phải con số cố định trong tài liệu Product.
Commercial maximum Program count trên một controller vẫn giữ `TBD-HYB-03`;
fixture 10-Program này là ngưỡng V&V tối thiểu, không phải commercial limit.

### 10.4 Multicore Scheduling Model — TARGET-DEPENDENT RUNTIME CAPABILITY

**BENCHMARK — `E-BM-01`, `E-BM-02`, `E-BM-04`:** CODESYS và Rockwell dùng
Task làm scheduling mechanism chứa/call Program; CODESYS cho task group được
phân phối trên core. Đây là rationale cho separation of concerns, không phải
bằng chứng mọi vendor có cùng scheduler hoặc MK-DDC đã implement multicore.

**PRODUCT DECISION — `PD-HYB-04`, `PD-HYB-10`:** multicore là target-dependent
runtime capability, không phải semantics bắt buộc của Program:

- semantics của Program **không phụ thuộc** số CPU core của target;
- một-core target vẫn phải giữ đúng dependency/fault/output semantics như
  target nhiều core — chỉ khác mức song song vật lý đạt được;
- target có từ hai RT execution core phù hợp trở lên **có thể** chạy các
  independent Task song song vật lý (physically in parallel);
- sản phẩm **không hứa** mỗi Program có riêng một core;
- sản phẩm **không hứa** 10 Program luôn chạy vật lý đồng thời;
- **không có** multicore capability không được làm thay đổi Program dependency
  semantics — Program độc lập vẫn phải independently schedulable trên target
  một core (xem quote MUST ở §10.1 và `AC-08A`).

Định nghĩa vận hành:

- `concurrent` nghĩa nhiều Task có tiến triển chồng lấn theo thời gian; không
  khẳng định chạy vật lý cùng một instant;
- `parallel` nghĩa execution overlap thật trên các core khác nhau;
- runtime phải phân biệt tối thiểu `CPU_RESOURCE`, `EXPLICIT_DEPENDENCY` và
  `IN_TASK_ORDER` trong metrics/wait reason;
- scheduler phải giữ deterministic observable semantics dù core placement khác;
- exact scheduling policy, resource allocation, admission formula, overload,
  recovery và timing threshold do ADR/Detailed Design + target verification khóa
  (`TBD-HYB-11`).

### 10.5 Fault containment

**PRODUCT DECISION — `PD-HYB-08`:** lỗi execution, watchdog hoặc deadline của
một Program chỉ fault Program/fault domain cần thiết; Program độc lập tiếp tục
eligible. Program phụ thuộc có thể chuyển `BLOCKED_DEPENDENCY` theo policy rõ.
Disable một Program cũng không dừng Program độc lập.

**AS-BUILT:** scheduler hiện dừng phần còn lại của Task khi một Program fault và
ba overrun liên tiếp fault toàn bộ Program trong Task. Multi-Program atomic
output/fault isolation, package-level first-cycle và per-task metrics chưa đủ;
đường apply output hiện còn có thể nhận output của Program chạy trước khi
Program sau làm Task fault nếu mở profile nhiều Program. Profile `1/1/1` đang
che gap này chứ không chứng minh behavior Hybrid.
Đây là gap phải được thiết kế/test nếu Product candidate được duyệt; tài liệu
này không tự đóng gap.

## 11. Program Dependency Model

**PRODUCT DECISION — `PD-HYB-05`:**

1. Không có dependency completion `P1 → P2` chỉ vì P1 được tạo trước, có tên
   đứng trước hoặc nằm trước trong UI, hoặc nằm trước trong internal Task order.
2. Dependency chỉ được tạo bằng declaration có truy nguyên hoặc constraint kiến
   trúc được Product/Design cho phép rõ.
3. Check phải reject reference không tồn tại, cycle dependency và policy không
   thể thỏa trong target profile.
4. Program độc lập không bị kéo vào fault domain của dependency graph khác.
5. Exact same-cycle release/barrier semantics và fallback policy chi tiết vẫn
   để downstream Architecture quyết định trong `TBD-HYB-05`.

Một field “Dependency” mơ hồ dùng chung cho mọi trường hợp **không được**
dùng. Product Spec khóa tối thiểu ba loại relationship độc lập dưới đây; một
Program có thể khai báo nhiều dependency thuộc nhiều loại khác nhau tới nhiều
producer khác nhau.

### 11.1 Data Dependency

Consumer cần dữ liệu từ Producer. Khai báo phải nêu:

- **Producer** — Program/Point/Published Signal nguồn;
- **Signal/value** — định danh dữ liệu cụ thể được tiêu thụ;
- **Type** — kiểu dữ liệu typed, được Check xác thực;
- **Freshness requirement** — ngưỡng freshness chấp nhận được (xem §12.2);
- **Stale/Bad/Unknown behavior** — hành vi consumer khi dữ liệu rơi vào từng
  trạng thái chất lượng, không được ngầm coi missing/stale là live/zero.

### 11.2 Execution Dependency

Consumer phải thực thi sau một execution condition hoặc một Program khác,
theo semantics được khai báo rõ (không suy từ in-task order hay creation
order). Khai báo phải nêu Producer/condition, Consumer, và điều kiện release
(ví dụ: sau khi Producer hoàn tất cycle hiện hành). Exact same-cycle
release/barrier mechanics là `TBD-HYB-05`.

### 11.3 Health / Availability Dependency

Trạng thái `Disabled`/`Faulted`/`Stale` của Producer có thể block hoặc
degrade Consumer, nhưng chỉ theo **policy explicit** được khai báo và Check
xác nhận — không mặc định lan fault. Khai báo phải nêu Producer, health state
kích hoạt policy, và hành vi Consumer tương ứng (`BLOCKED_DEPENDENCY`,
degrade, hoặc fallback đã khai báo).

Ba loại trên là ranh giới tối thiểu bắt buộc; downstream Design có thể thêm chi
tiết kỹ thuật nhưng không được gộp lại thành một field “Dependency” duy nhất
không phân loại.

## 12. Data Sharing Model

### 12.1 Các lớp dữ liệu

| Lớp | Quyền ghi/đọc | Visibility |
|---|---|---|
| Program-private state | Chỉ Program owner ghi; monitor đọc theo quyền. | Không expose như shared writable memory. |
| Point/process-image snapshot | Runtime authority tạo; Program chỉ đọc input snapshot coherent. | Theo generation, quality, timestamp và freshness. |
| Published Signal | Đúng một producer publish; nhiều consumer chỉ đọc. | Latest completed publish; same-cycle chỉ khi dependency policy explicit. |
| Output Candidate | Program owner phát; resolver/safety đọc. | Không cho Program khác ghi đè theo timing. |
| RETAIN variable | Program + stable variable identity sở hữu. | Phục hồi theo restart/revision compatibility policy. |

**PRODUCT DECISION — `PD-HYB-06`:** mặc định không có shared writable memory
giữa Programs. Consumer không nắm pointer/reference mutable tới state của
producer. Published Signal tối thiểu phải có stable signal ID, producer ID,
type, value, quality, timestamp/generation và freshness state.

Khi không có same-cycle dependency explicit, consumer chỉ được dựa vào latest
completed publication có sẵn tại input snapshot của lần chạy. Nó không được suy
luận rằng producer vừa chạy trước trong cùng Task nên giá trị cùng cycle đã nhìn
thấy. Exact epoch/barrier semantics là `TBD-HYB-05`.

### 12.2 Freshness và fault

**PRODUCT DECISION — `PD-HYB-05`, `PD-HYB-06`:** mỗi consumer phải có policy
đối với `GOOD/STALE/BAD/UNKNOWN`; missing không được biến ngầm thành zero hoặc
giá trị live. Producer Disabled/Faulted không tiếp tục publish giá trị mới như
healthy. Hold-last, fail-blocked hoặc fallback chỉ hợp lệ khi được khai báo và
Check xác nhận.

Exact freshness formula theo producer/consumer cycle, bootstrap signal sau
restart và retention của published value là `TBD-HYB-06`.

### 12.3 RETAIN ownership

**PRODUCT DECISION — `PD-HYB-06`:** RETAIN thuộc stable Program/Variable
identity, không thuộc Task/core. Remap Program không được đổi owner hoặc làm giá
trị không tương thích được trình bày như valid. Consumer không được RETAIN bản
sao như một shared truth. Storage key, layout, integrity encoding và migration
transaction thuộc Data/Runtime Design; matrix warm/cold/power/revision là
`TBD-HYB-08`.

## 13. Output Ownership, Arbitration và Safe-State

```text
Programs
   │
   ▼
Output Candidates
   │
   ▼
Output Ownership Validation
   │
   ▼
Priority Arbitration
   │
   ▼
Interlock
   │
   ▼
Safe-State
   │
   ▼
Physical I/O
```

**PRODUCT DECISION — `PD-HYB-07`:**

1. Program không ghi physical output trực tiếp và không bypass canonical
   controlled-output/arbitration/interlock/safe-state path.
2. **Ownership rule (khóa thay cho “each writable Point SHALL have one
   owner”):** “Each writable Point SHALL have at most one direct Program owner
   within a Commissioned Programming Revision unless an explicit multi-producer
   arbitration contract exists.” Cụ thể:
   - **0 Program owner = VALID** (Point chưa được Programming claim, vẫn hợp lệ);
   - **1 Program owner = VALID**;
   - **>1 direct Program owner = REJECT**, trừ khi Product/Architecture có
     arbitration rule **explicit, deterministic, versioned** cho phép
     multi-producer trên chính Point/class đó.
   Execution order, thread timing hoặc CPU completion order **không bao giờ**
   được dùng để chọn winner giữa các owner.
3. Hai Program cùng claim một output mặc định bị Check/Commission reject theo
   rule ở mục 2. Nếu tương lai cho phép nhiều producer, arbitration rule phải
   explicit, versioned, deterministic và audit được; execution timing không
   bao giờ là rule.
4. Scheduling Priority và Output Priority là hai khái niệm khác nhau.
5. Manual/BACnet/Schedule/Program candidate tiếp tục đi qua canonical priority
   arbitration; Program không được sao chép override vào private state.
6. Interlock áp sau arbitration và trước physical commit.
7. Safe-State có quyền cao hơn mọi Program output và không thể bị Advanced
   property, Enable hoặc rollback bypass.
8. Physical output chỉ commit từ một coherent accepted generation; output của
   một Program đã fault trong generation không được “lọt” theo execution order.

**AS-BUILT:** Program candidate cho Analog/Digital physical output (AO/DO) hiện
đi vào priority level 5 và SafeState có đường override; source chưa chứng minh
một interlock phase chung cho mọi Programming Point, arbitration tương đương
cho các đường output không phải AO/DO hoặc package atomicity nhiều Program.
Các điểm này giữ trạng thái gap/TBD, không được hợp thức hóa thành PASS.

### 13.1 Disable output policy

**PRODUCT DECISION — `PD-HYB-07`, `PD-HYB-08`:** default cho Program mới là
`WITHDRAW_AT_CONTROLLED_BOUNDARY`: rút candidate của Program và để canonical
arbitration/interlock/safe-state quyết định output tiếp theo. `HOLD_LAST` chỉ
hợp lệ khi có TTL hữu hạn, Point class cho phép và Check hiển thị impact. Không
có indefinite implicit hold và không tự ghi zero. Allowed TTL/default theo loại
Point là `TBD-HYB-07`.

## 14. Commission, Activation và Rollback

### 14.1 Khóa thuật ngữ — “Commission Changes”

**PRODUCT DECISION — `PD-HYB-09`:** thuật ngữ chuẩn cho runtime transaction ở
Rev này là **“Commission Changes”**, không phải “Commission riêng một
Program”. User có thể edit một Program duy nhất, nhưng runtime activation vẫn
luôn là package-level transaction trên toàn Project Revision.

Ví dụ bắt buộc dùng làm reference:

```text
Project Active r20:
- P1
- P2
- P3
- P4

User chỉ sửa P1.

Check tạo candidate Project Revision r21 với:
- P1 changed
- P2 unchanged
- P3 unchanged
- P4 unchanged

Commission Changes:
  → stage package r21
  → verify
  → activate toàn candidate package atomically
  → runtime read-back
  → Active Revision = r21

Nếu thất bại:
  → Active Revision vẫn r20 hoặc restore LKG theo policy (§8.3, TBD-HYB-09).
```

Không được claim per-Program hot activation trong Rev này — kể cả khi chỉ một
Program thay đổi, activation vẫn commit/rollback theo toàn bộ package r21.

### 14.2 Nguyên tắc Check / Commission Changes / Activation

**PRODUCT DECISION — `PD-HYB-03`, `PD-HYB-09`:**

1. Check phải đánh giá toàn impact set: source ST/FBD, type, mapping, dependency,
   output ownership, RETAIN compatibility, target capacity và Auto Task Mapping.
2. Check thành công tạo immutable candidate/typed artifact/mapping manifest;
   không thay Active Revision.
3. Commission Changes phải stage/verify rồi activation atomic tại controlled
   cyclic boundary; HTTP/request accepted không đồng nghĩa activation thành công.
4. Với nhiều Program/Task, transaction safety là package-level đối với toàn
   impact set; không để một phần candidate trở thành Active ngoài policy được duyệt.
5. Candidate lỗi, first-cycle lỗi hoặc read-back không khớp phải giữ hoặc phục
   hồi Active/LKG trước đó; không dừng active package chỉ vì Check/Commission lỗi.
6. LKG chỉ promote sau điều kiện first-success được design hóa cho các Task có
   cycle khác nhau; exact barrier/timeout là `TBD-HYB-09`.
7. Rollback đi qua compatibility, loader, output/RETAIN impact và read-back như
   Activation; không bypass Safe-State hoặc tự Enable Program đã Disabled.
8. Graph cutover vẫn cần backup, compatibility report, output/RETAIN inventory
   và rollback plan; không dual-run trên output thật.

## 15. Runtime Monitoring và Diagnostics

### 15.1 Normal monitoring

**PRODUCT DECISION — `PD-HYB-10`:** người dùng bình thường phải thấy cho mỗi
Program: name, language, active/editing revision, enabled intent, authoritative
runtime state, configured cycle, last successful run/fault, input/output
quality-freshness, safe-state impact và timestamp của dữ liệu.

### 15.2 Advanced execution diagnostics

Khi target hỗ trợ, Advanced/Diagnostics phải cung cấp read-only:

- mapping revision/hash và Program → internal Task;
- Task state, period, priority, deadline/budget/watchdog;
- core/worker hiện tại như diagnostic, không phải identity/normal property;
- run/skip/missed release, queue/wait, last/max/WCET, jitter/lateness/overrun;
- wait reason phân biệt CPU, explicit dependency và in-task order;
- Program/Task fault domain, dependent blocked count và recovery reason;
- output ownership/conflict/reject, staging/commit generation và safe-state reason;
- bounded Trace có source, quality, timestamp, retention và dropped-sample metric.

**PRODUCT DECISION — `PD-HYB-10`:** AC-08A/08B/09 chỉ PASS bằng authoritative runtime
metrics/read-back và target evidence. Diagram, source, host unit test hoặc UI
render không chứng minh multicore/RT behavior.

## 16. Security và Audit

**FACT/REF — `E-FR-03`:** baseline hiện dùng `viewer/operator/admin`; server là authority.
Viewer/operator read-only, admin sở hữu mutation Programming hiện hành.

**PRODUCT DECISION — `PD-HYB-03`, `PD-HYB-09`, `PD-HYB-10`:**

- server authorize từng Create/Edit/Check/Commission/Enable/Disable/Rollback,
  Advanced property, import/export và RETAIN action;
- UI visibility không thay server permission;
- mutation phải có actor, target, base revision/concurrency guard,
  idempotency/correlation identity và authoritative read-back;
- audit tối thiểu: before/after revision, Program, action, actor, time, result,
  mapping decision, dependency/output/RETAIN impact, error và rollback link;
- secrets, token và unprotected full source/artifact không được ghi vào audit;
- strong acknowledgement/re-auth phải được server chứng minh cho destructive
  hoặc runtime-impact action theo `TBD-HYB-10`;
- role được phép Enable/Disable và sửa Advanced property là `TBD-HYB-10`.

## 17. Normal vs Advanced UX Exposure

### 17.1 Candidate Product Workspace / Candidate Information Architecture

```text
Programming
├── Overview
├── Programs
├── Points & Mapping
├── Control Library
├── Commission
└── Runtime & Service
```

**PRODUCT DECISION — `PD-HYB-01`, `PD-HYB-10`:** cây trên là **candidate IA**,
không phải normative page/route lock. Cụ thể:

- đây là candidate IA, không phải khóa cứng số lượng/tên page;
- UI/UX Requirement/Design Spec có quyền gộp hoặc tách page so với cây trên,
  miễn giữ đủ capability/workspace bắt buộc;
- Product Spec **chỉ khóa required capabilities/workspaces** (ví dụ: phải có
  nơi Create/Edit Program, nơi Commission Changes, nơi xem Runtime State) —
  không khóa route, layout, component hoặc pixel;
- **Task Manager không trở lại Normal UX** dù IA được gộp/tách thế nào — đây
  là ranh giới đã chốt (§R, không reopen). Task/core/scheduler chỉ được xuất
  hiện trong `Advanced Execution` hoặc `Runtime Diagnostics`.

UI/UX Design sẽ quyết chi tiết route/layout/component sau Product approval.

### 17.2 Bảng progressive disclosure

| Nội dung | Normal | Advanced/Diagnostics |
|---|---:|---:|
| Create/Edit ST/FBD, Check, Commission | Có | Có thêm technical diagnostics nếu được phép |
| Enable/Disable, cycle, runtime state | Có | Có read-back chi tiết |
| Program name/description/language/group | Có | Có |
| Priority/deadline/watchdog/dependency/disable/RETAIN policy | Summary/impact | Cấu hình có quyền + validation |
| Internal Task, deterministic order | Không phải cấu hình bắt buộc | Read-only/config theo quyền nếu Product cho phép |
| Thread/worker/core/affinity | Không | Diagnostic; affinity không phải normal product property |
| IR/ABI/artifact/mapping hash | Không | Read-only technical evidence |
| WCET/jitter/overrun/wait reason | Health summary | Metrics/trace chi tiết |

## 18. Acceptance Criteria

Mỗi AC dưới đây là Product acceptance candidate. “PASS” cần Test Result mới,
không được dẫn lại code tồn tại hoặc kết quả host cũ như target evidence.

| ID | Acceptance criterion | Trace quyết định | Evidence authority tối thiểu |
|---|---|---|---|
| `AC-01` | User hoàn tất `Create → Check → Commission → Enable → RUNNING`; từng bước có authoritative state/read-back. | `PD-HYB-01`, `03`, `09` | FE-BE-Core E2E + target runtime record. |
| `AC-02` | Enable P1 và P2 không tự tạo completion dependency `P1 → P2`. | `PD-HYB-04`, `05` | Mapping manifest + scheduler trace. |
| `AC-03` | Fixture 10 Program không bị serialize chỉ vì thứ tự tạo; đổi thứ tự tạo không đổi dependency semantics. | `PD-HYB-02`, `04` | Deterministic replay + target trace. |
| `AC-04` | Fault một Program độc lập không mặc định dừng Program độc lập khác; dependent state được báo rõ. | `PD-HYB-08` | Fault injection trên target. |
| `AC-05` | Disable một Program không mặc định dừng Program độc lập khác và output policy được áp đúng. | `PD-HYB-07`, `08` | Runtime + output read-back/HIL. |
| `AC-06` | Hai Program claim cùng output bị reject hoặc được resolve bằng ownership/arbitration explicit; không có last-run-wins. | `PD-HYB-07` | Negative Check + arbitration/HIL. |
| `AC-07` | Candidate Commission lỗi không dừng hoặc thay Active Revision hiện tại; LKG/read-back giữ đúng. | `PD-HYB-09` | Fault-at-each-stage + power/restart test. |
| `AC-08A` | **Scheduling Independence** — “Independent Programs SHALL remain independently schedulable regardless of physical core count.” Áp dụng trên mọi target, kể cả một core. | `PD-HYB-04` | Deterministic replay/scheduler trace trên target một core tối thiểu. |
| `AC-08B` | **Multicore Capability** — “On an approved target profile with ≥2 suitable RT execution cores, at least two admissible independent Tasks SHALL demonstrate real parallel execution overlap using authoritative target timing evidence.” Profile không có capability này phải báo `unavailable` và không được claim multicore. | `PD-HYB-04`, `10` | Approved target real-time configuration + authoritative per-core timing trace. |
| `AC-09` | Watchdog, deadline miss và overrun có counter/event/source/timestamp/fault radius quan sát được. | `PD-HYB-08`, `10` | Target timing/fault injection. |
| `AC-10` | Safe-State override mọi Program output và read-back physical output đúng safe policy. | `PD-HYB-07` | MCU/I/O HIL + authority read-back. |
| `AC-11` | Không có cross-Program shared writable memory; race attempt hoặc multi-writer signal bị Check reject. | `PD-HYB-05`, `06` | Contract/compiler negative + concurrency stress. |
| `AC-12` | Cùng candidate/profile/policy tạo mapping semantics và manifest hash ổn định; creation order không đổi kết quả semantic. | `PD-HYB-02`, `04`, `05` | Golden/replay + package comparison. |
| `AC-13` | Normal flow không yêu cầu nhập Task/core/thread/affinity; Program properties vẫn đủ hoàn thành AC-01. | `PD-HYB-01`, `10` | UX acceptance + API authorization tests. |
| `AC-14` | Runtime phân biệt chờ CPU, chờ dependency và chờ in-task order. | `PD-HYB-04`, `05`, `10` | Controlled-load target trace. |
| `AC-15` | Remap Program không đổi RETAIN owner; corrupt/mismatch không dùng dữ liệu cũ như valid. | `PD-HYB-06` | Warm/cold/power/revision matrix. |
| `AC-16` | Create/Edit/Check/Commission/Enable/Disable/Rollback/Advanced change có RBAC server-side và audit tương quan. | `PD-HYB-03`, `09`, `10` | Direct API negative + audit read-back. |
| `AC-17` | `GRAPH_ONLY/PROGRAM_ONLY` độc quyền; dual mode bị reject và không có output graph lọt vào Program mode. | `PD-HYB-09` | Cutover integration + physical output read-back. |
| `AC-18` | **Engineering Plane Isolation.** GIVEN một Active Programming Package đang `RUNNING`. WHEN FE/Web disconnect, engineering session hết hạn, hoặc engineering BE/service mất kết nối/restart. THEN: (a) Active runtime SHALL tiếp tục local control; (b) running Program SHALL NOT dừng chỉ vì engineering plane unavailable; (c) reconnect SHALL reconcile state từ runtime authority; (d) FE/BE SHALL NOT tự bịa (invent) runtime state trong lúc disconnect. | `PD-HYB-01`, `03`, `09` | Local-control continuity test khi cắt FE/BE + reconnect reconciliation read-back trên target. |
| `AC-19` | **Restart and Enable Intent.** Phải phân biệt rõ bốn khái niệm: Commissioned Revision, Enable/Disable Desired Intent, Runtime State, RETAIN State. Restart policy phải explicit. Sau reboot/power cycle: runtime phục hồi Enable/Disable intent theo policy được duyệt; RETAIN phục hồi độc lập theo RETAIN compatibility policy (§12.3); Program chỉ được báo `RUNNING` sau authoritative startup/read-back; không được suy `RUNNING` chỉ vì trước reboot Program từng Enabled. Exact warm/cold/power restart matrix thuộc `TBD-HYB-08`/downstream design. | `PD-HYB-03`, `06`, `09` | Power/restart matrix test (warm/cold/power-loss) + authoritative read-back trên target. |

## 19. Candidate Product Requirements và Traceability

Các ID `CPR-HYB-*` chỉ dùng trong review để tránh sửa/chiếm ID authority trước
approval. Product Control phải merge vào `PC-PROG-*`/`PR-PROG-*` ổn định và cập
nhật Traceability khi duyệt.

| Candidate Requirement | Nội dung normative | Product Decision | AC | Baseline liên quan |
|---|---|---|---|---|
| `CPR-HYB-001` | Program là primary object; Normal UX không yêu cầu Task/core/thread/affinity. | `PD-HYB-01`, `10` | 01, 13 | `PC-PROG-001`, `PR-PROG-001`. |
| `CPR-HYB-002` | Program có ST/FBD, cycle 1/5/30, Enable/Disable và authoritative Runtime State. | `PD-HYB-01`, `03` | 01 | `PC-PROG-006..008`, `PR-PROG-002`, `005`. |
| `CPR-HYB-003` | Runtime tự map Program vào internal RT Task; không có 1:1 Program/thread/core contract. | `PD-HYB-02` | 03, 08A, 08B, 12 | Thay đổi profile/ADR-026/OD-PROG-004 nếu duyệt. |
| `CPR-HYB-004` | Không tạo dependency/serialization từ creation order; independent Tasks eligible concurrent. | `PD-HYB-04`, `05` | 02, 03, 08A, 08B, 14 | Requirement mới. |
| `CPR-HYB-005` | Dependency explicit, deterministic, cycle-checked và có freshness/fault policy. | `PD-HYB-05` | 02, 11, 14 | Requirement mới. |
| `CPR-HYB-006` | Private state + read-only snapshot + Published Signal; RETAIN có stable Program owner. | `PD-HYB-06` | 11, 15 | `PC-PROG-010`, `PR-PROG-010` mở rộng có kiểm soát. |
| `CPR-HYB-007` | Output Candidate đi qua ownership/arbitration/interlock/safe-state; conflict không dựa timing. | `PD-HYB-07` | 05, 06, 10 | `PR-PROG-004`, Architecture control path. |
| `CPR-HYB-008` | Independent Program fault/disable không dừng independent Program khác. | `PD-HYB-08` | 04, 05, 09 | Thay đổi fault radius ADR-029 nếu duyệt. |
| `CPR-HYB-009` | Check/Commission/Activation package-level atomic; candidate lỗi giữ Active/LKG. | `PD-HYB-09` | 01, 07, 17 | `PC-PROG-009`, `PR-PROG-006..009`. |
| `CPR-HYB-010` | Runtime metrics chứng minh scheduling/multicore/wait/deadline/watchdog/overrun. | `PD-HYB-10` | 08A, 08B, 09, 14 | `PC-PROG-011`, `PR-PROG-011`. |
| `CPR-HYB-011` | RBAC/audit server-side bao phủ runtime và Advanced mutations. | `PD-HYB-03`, `09`, `10` | 16 | `PR-PROG-013`. |
| `CPR-HYB-012` | Graph chỉ migration source; Local logic owner luôn exclusive. | `PD-HYB-09` | 17 | `OD-PROG-013/014`, ADR-020/023. |
| `CPR-HYB-013` | Engineering plane (FE/Web/engineering BE) mất kết nối không được dừng Active runtime hoặc bị FE/BE bịa runtime state; reconnect phải reconcile từ authority. | `PD-HYB-01`, `03`, `09` | 18 | Product goal §2 (control path local); requirement mới. |
| `CPR-HYB-014` | Restart/reboot phải phân biệt Commissioned Revision, Enable/Disable intent, Runtime State và RETAIN State; không suy `RUNNING` chỉ vì Enabled trước reboot. | `PD-HYB-03`, `06`, `09` | 19 | `TBD-HYB-08`; requirement mới. |

## 20. Evidence Register

### 20.1 FACT/REF và AS-BUILT MK-DDC-24

Các source reference `E-AB-*` được đọc ngày 2026-08-14 trên base ghi ở
metadata. `git diff --quiet 6262c36 -- <toàn bộ path E-AB>` trả `0`, nên các
path này khớp pinned base và tái lập được; worktree dirty nằm ngoài tập nguồn
được dẫn. Chúng vẫn chỉ là review evidence bổ sung: dated As-Built boundary chủ
quản là `E-AB-06`, và phải revalidate trên candidate implementation commit trước
khi dùng cho gate/release evidence.

| Evidence ID | Phân loại | Nguồn | Kết luận được phép dùng |
|---|---|---|---|
| `E-FR-01` | FACT/REF | [`CONTROL.md`](../00_governance/CONTROL.md) | Chỉ Product authority `Active` quy định phạm vi; candidate không tự thành baseline. |
| `E-FR-02` | FACT/REF | [`DDC24_PROGRAMMING_PRODUCT_SPEC.md`](DDC24_PROGRAMMING_PRODUCT_SPEC.md) | Giữ scope ST/FBD, Local/VP/MB-RTU, cycle 1/5/30, Revision/LKG/RETAIN/Monitor/RBAC. |
| `E-FR-03` | FACT/REF | [`PROGRAMMING_OPEN_DECISIONS.md`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) | `OD-PROG-001..017` đã `DECIDED` cho baseline trước Hybrid, gồm RBAC, một Task/order ổn định và graph/program exclusivity; Hybrid chỉ thay các mục này sau approval mới. |
| `E-FR-04` | FACT/REF | Product authority §§8–9 và `PROGRAMMING_OPEN_DECISIONS.md` `OD-PROG-016` | Authority vẫn ghi Amendment A1 `PROPOSED/chờ ký` trong khi register ghi `DECIDED`; đây là document drift phải reconcile, không phải lý do tự nâng candidate thành Active. |
| `E-FR-05` | FACT/REF | [`PROGRAMMING_ARCHITECTURE.md`](../03_architecture/PROGRAMMING_ARCHITECTURE.md) §§4–8 | Target hiện hành yêu cầu candidate lỗi giữ Active/LKG, control path có arbitration/safe-state và graph/program exclusive; không phải As-Built proof. |
| `E-FR-06` | FACT/REF | Git commit `41eba08cc2cbdd9dfe76e4f9a8664c7851c51cfc`; `git cat-file -e 41eba08^:docs/CHUONG_YEU_CAU/PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md` trả absent, còn [`§34`](../CHUONG_YEU_CAU/PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md) ghi v2.1/v2.2 | File xuất hiện lần đầu đã ở v2.2; repository không lưu snapshot Product Spec Programming v2.1 độc lập để diff đầy đủ. |
| `E-FR-07` | FACT/REF | [`PROGRAMMING_ARCHITECTURE.md`](../03_architecture/PROGRAMMING_ARCHITECTURE.md) §3, bảng owner/input/consumer; [`PRODUCT.md`](PRODUCT.md) §§2–3 | Architecture chỉ định Core Point Table/priority winner, Web authorization/audit và Alarm authority; Product baseline ghi Alarm/Trend/Schedule là capability toàn sản phẩm, không tự giao ownership cho Programming. |
| `E-AB-01` | AS-BUILT | `contracts/programming/rev_a_profile_v1.json:3-10` | Profile hiện khóa `1 Task / 1 Program / 1 Program total`; không chứng minh Hybrid. |
| `E-AB-02` | AS-BUILT | `apps/core/application/st/st_scheduler.cpp:474-597` | Program/Task hiện chạy tuần tự; Program fault dừng phần còn lại của Task; không có multicore mapping. |
| `E-AB-03` | AS-BUILT | `contracts/openapi/openapi.yaml:2452-2462, 2739, 2918-2934`; `apps/web-ui/src/features/programming/model/types.ts` | Public model hiện dùng singular Task/runtime state và chưa có Program Enable/Disable contract hoàn chỉnh. |
| `E-AB-04` | AS-BUILT | `apps/core/application/st/st_scheduler.cpp:416-446`; `apps/core/application/st/st_process_image.cpp:374-394` | Một Program có safe-boundary activation primitive; candidate activation lỗi giữ runtime trước và LKG chỉ promote sau output commit. Chưa chứng minh package nhiều Program/Task atomic. |
| `E-AB-05` | AS-BUILT | `apps/core/domain/priority/priority_resolver.hpp`, `apps/core/domain/priority/priority_resolver.cpp`; `apps/core/domain/safety/safe_state.cpp`; `apps/core/application/runtime/scan_loop.cpp` | Có priority/safe-state substrate cho AO/DO; chưa đủ chứng minh common interlock/arbitration cho mọi Point hoặc multi-Program atomicity. |
| `E-AB-06` | AS-BUILT | [`PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md`](../07_records/reviews/PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md) | Programming hiện `NO-GO`; gap/0 Test Result không được Product Spec tự đóng. |
| `E-AB-07` | AS-BUILT | `apps/core/application/runtime/scan_loop.cpp:164-213`; `apps/core/domain/graph/graph_runtime.cpp:463` | Graph execute được gate theo mode nhưng đường apply setpoint ngoài AO/DO còn được gọi ngoài gate; source chưa chứng minh Local/output owner độc quyền trong `PROGRAM_ONLY`. Phát biểu này không mở rộng loại Programming Point trong scope. |
| `E-AB-08` | AS-BUILT | `apps/core/application/st/st_scheduler.cpp:522-539`; `apps/core/application/st/st_process_image.cpp:339-388` | Nếu mở nhiều Program, Program trước có thể có successful generation trước khi Program sau fault Task; output commit barrier toàn Task/package chưa được chứng minh. |

### 20.2 BENCHMARK primary-source

| Evidence ID | Nguồn chính thức | Fact benchmark được phép dùng | Không được suy diễn |
|---|---|---|---|
| `E-BM-01` | [CODESYS — Task Configuration](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_f_task_configuration.html) | Task kiểm soát processing; Programs được gọi trong Task theo configured order. | Không chứng minh MK-DDC phải dùng cùng algorithm. |
| `E-BM-02` | [CODESYS — Task Groups](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_obj_task_config_task_groups.html) | Task groups có thể được phân phối lên processor cores. | Không chứng minh mỗi Program có một core hoặc mọi Program parallel. |
| `E-BM-03` | [Beckhoff — Data access from several tasks](https://infosys.beckhoff.com/content/1033/tc3_plc_intro/45844579955484184843.html) | Shared writable data giữa task cần synchronization/process-image/buffer semantics rõ. | Không biến Published Signal model thành “industry standard”. |
| `E-BM-04` | [Rockwell — Tasks, Programs, and Routines](https://www.rockwellautomation.com/en-us/docs/studio-5000-logix-designer/38-01/contents-ditamap/studio-5000-logix-designer/controller-organizer/use-the-controller-organizer/use-tasks--programs--and-routines.html) | Task là scheduling mechanism và có thể schedule nhiều Program. | Không chứng minh UX hoặc scheduler Mekong phải giống Rockwell. |

### 20.3 INFERENCE

| Evidence ID | Suy luận | Cách phải xác nhận |
|---|---|---|
| `E-INF-01` | Tách Program identity khỏi internal Task cho phép runtime đổi mapping mà không phá authoring/RETAIN identity. | Data/Runtime Detailed Design + migration/rollback test. |
| `E-INF-02` | Explicit dependency + immutable snapshots/Published Signal giảm race và làm replay deterministic hơn shared writable memory. | Formal contract, concurrency model, stress/fault test. |
| `E-INF-03` | Fault containment theo Program/independent Task cần output commit barrier và dependency-aware invalidation. | Architecture/Control Design + target fault injection. |
| `E-INF-04` | Impact layer/tài liệu được dự báo từ semantic delta và As-Built hiện hành; mức effort thực tế có thể đổi sau khi TBD được khóa. | Re-estimate có owner sau Product approval và trước `IMPLEMENT_READY[HYBRID]`. |

### 20.4 STD Traceability

**STD:** phân loại tối thiểu dưới đây gắn capability Programming đã có sẵn
trong scope (§3.1, §5.1) với tiêu chuẩn ngành liên quan, **chỉ để tham chiếu
traceability** — không phải tuyên bố compliance/certified/functional-safety
cho MK-DDC-24 (đúng ranh giới Out of Scope §3.2).

| Capability | Nhãn | Tiêu chuẩn tham chiếu | Ghi chú |
|---|---|---|---|
| ST / FBD / POU | `STD` | IEC 61131-3 | Ngôn ngữ lập trình PLC; MK-DDC-24 chỉ giữ ST + structured FBD Rev A (§3.1), không claim full compliance. |
| Programming/debugging implementation guidance | `STD reference` | IEC TR 61131-8 | Technical report hướng dẫn implementation, không phải normative certification target. |
| BACS engineering/commissioning context | `STD reference` | ISO 16484 series | Ngữ cảnh BACS mà Programming vận hành trong đó; không tự suy ra MK-DDC-24 certified theo bộ tiêu chuẩn này. |
| Security concepts (nếu được claim alignment) | `STD reference` | IEC 62443 (phần áp dụng) | Chỉ áp dụng nếu Security/Architecture chọn align concept cụ thể; không tự động áp toàn bộ series. |

**Ranh giới bắt buộc:** các khái niệm sau là **MK PRODUCT DECISION /
BENCHMARK-INFORMED**, **không phải** IEC/ISO requirement, dù có capability
`STD` ở trên trong cùng tài liệu:

- Program-centric UX;
- Auto Task Mapping;
- Published Signal;
- Independent-by-default scheduling semantics;
- Multicore policy (target-dependent runtime capability, §10.4).

Không được thêm standard claim mới ngoài bảng trên nếu không có nguồn xác
minh; bảng này không mở rộng phạm vi compliance claim vượt quá Out of Scope §3.2.

## 21. Migration Impact nếu V2.2 được duyệt

**INFERENCE — `E-INF-04`:** đánh giá dưới đây là impact forecast, không phải
implementation status hoặc estimate đã được phê duyệt.

| Layer | Mức | Lý do chính | Verification bắt buộc sau implementation |
|---|---|---|---|
| **FE** | **High** | Mental model/IA đổi Task→Program; Program properties, Enable/Disable, per-Program state, dependency/Published Signal và diagnostics mới; DTO hiện singular `task`; FE không được tự bịa runtime state khi engineering plane disconnect (`AC-18`). | Unit/lint/build + desktop/mobile browser + E2E role/state/error/read-back + disconnect/reconnect reconciliation. |
| **BE** | **High** | Domain/store/OpenAPI hiện chứa một Task và lifecycle operation chưa có Program Enable/Disable; cần versioning, concurrency, audit, mapping manifest và backward compatibility; phải chốt ranh giới Published Signal vs canonical Point (`TBD-HYB-06`, §7.1) trước khi thiết kế schema. | Contract/generator, migration, two-client/idempotency, direct API RBAC, restart/reconcile, engineering-plane-down continuity test. |
| **FW-SOM/Core** | **High** | Profile `1/1/1`, topology cố định, scheduler tuần tự; cần multi-Program package, auto mapping (có xét fault containment), multicore, isolation, commit barrier, metrics và package activation/LKG; local control phải sống sót khi mất engineering plane. | Host precheck + target RT timing, power/restart, watchdog, IOP continuity, engineering-plane-down local-control test và HIL. |
| **QA** | **High** | Cần matrix mới cho 10-Program Reference Fixture (§10.3.1), dependency/race theo 3 loại (§11), mapping determinism, per-core timing (`AC-08A/08B`), fault containment, output conflict (0/1/reject owner), rollback, RETAIN, restart-intent (`AC-19`) và security. | Test Results có provenance; phân biệt host/target/HIL/release. |

Tác động phụ dự kiến: DB/schema/backup, artifact/source bundle, Operations runbook,
observability và target resource sizing đều High hoặc chưa thể chốt trước
`TBD-HYB-03..11`.

## 22. Tài liệu bị ảnh hưởng nếu được duyệt

**INFERENCE — `E-INF-04`:** không tài liệu nào trong bảng này được tự động sửa
hoặc nâng trạng thái bởi bản review hiện tại; danh sách là blast-radius dự kiến.

| Nhóm | Tài liệu/authority cần rebaseline | Nội dung ảnh hưởng |
|---|---|---|
| Product/Governance | `DDC24_PROGRAMMING_PRODUCT_SPEC.md`, `PRODUCT.md`, `CONTROL.md`, `docs/README.md`, `PROGRAMMING_OPEN_DECISIONS.md`, `DECISIONS.md`/ADR mới | Một authority Active, version/supersession, decision và gate mới. |
| Requirements/Trace | `PROGRAMMING_REQUIREMENTS_SPEC.md`, `PROGRAMMING_TRACEABILITY_MATRIX.md`, risk register | Candidate requirements, acceptance, owner/evidence/risk. |
| Architecture | `PROGRAMMING_ARCHITECTURE.md` | Multi-Program package, multicore/fault/output/activation boundary. |
| Detailed Design | Data Model, Control Semantics, Runtime Lifecycle, FW-SOM, BE, FE, Security, Compiler/Artifact | Singular Task→hybrid model, contracts, state, migration, failure/rollback. |
| Interfaces/Contracts | `PROGRAMMING_INTERFACE_SPEC.md`, OpenAPI, runtime profile/schema, artifact/source bundle/error catalog | Versioned multi-Program mapping, Program commands/state/metrics. |
| UI/UX | `PROGRAMMING_UI_UX_DESIGN.md` và visual assets sau Product approval | Program-centric IA, Normal/Advanced; thiết kế chi tiết ở task riêng. |
| Verification | `PROGRAMMING_VERIFICATION_PLAN.md`, Test Result matrix/fixtures | AC-01..17, target multicore/HIL/security evidence. |
| Operations/Release | Operations runbook, implementation plan/roadmap, candidate manifest, changelog | Migration, backup/cutover/rollback, feature/release gates. |

## 23. Open Decisions / TBD cần PM/CTO quyết

**PRODUCT DECISION — phân nhóm gate cho toàn bộ `TBD-HYB-*`:**

- **P0 — phải khóa trước `IMPLEMENT_READY[HYBRID]`:** `TBD-HYB-03`, `05`, `06`,
  `07`, `08`, `09`, `11`.
- **P1 — được khóa trong downstream design nhưng phải hoàn thành trước gate
  tương ứng của chính nó:** `TBD-HYB-02`, `04`, `10`, `12`.
- **Governance:** `TBD-HYB-01` (version/rebaseline/authority naming).

| TBD | Nhóm gate | Owner quyết định | Nội dung cần khóa | Impact nếu chưa khóa | Gate bị chặn | Điều kiện mở khóa |
|---|---|---|---|---|---|---|
| `TBD-HYB-01` | Governance | Product Owner + CTO + PM + Document Control | Tên version cuối: V2.2 Hybrid, V2.3 hay Rev B; cách merge/supersede source proposal v2.2 hiện có. | Hai authority/version trùng, trace sai. | `PLAN_READY` cho Hybrid / Active baseline. | Biên bản version + một canonical file Active + redirect/reference cho candidate cũ. |
| `TBD-HYB-02` | P1 | Product Owner + BE Lead | Một active Project hay một Project được lưu; import/replacement khi đã có Project. | Domain/backup/UX không nhất quán. | `PLAN_READY` cho Hybrid. | Cardinality và lifecycle import được ký. |
| `TBD-HYB-03` | P0 | Product Owner + System Architect + FW-SOM Lead | Max Programs (tối thiểu giữ fixture 10), internal Tasks, target/core capacity và admission limits. | Không sizing được resource/API/QA. | `IMPLEMENT_READY[HYBRID]`. | Target inventory + WCET/RAM sizing + Product capacity decision. |
| `TBD-HYB-04` | P1 | System Architect + Safety Lead + Runtime Lead | Range/default cho scheduling priority, deadline, watchdog và budget. | Overload/starvation/watchdog semantics mơ hồ; §9.3 vẫn ở Runtime Policy/TBD cho tới khi khóa. | `IMPLEMENT_READY[HYBRID]`. | Timing model + safety review + target benchmark plan. |
| `TBD-HYB-05` | P0 | Product Owner + System Architect | Dependency types (Data/Execution/Health-Availability, §11), same-cycle barrier/visibility, cycle mismatch, disabled/faulted producer policy. | Race, hidden serialization hoặc stale use. | `IMPLEMENT_READY[HYBRID]`. | State/data-flow decision table + deterministic replay model. |
| `TBD-HYB-06` | P0 | Data Lead + Runtime Lead | Published Signal schema, freshness formula, bootstrap/restart, retention, và ranh giới canonical Point vs runtime primitive (§7.1 blocker). | Consumer có thể coi stale/missing là live; hai canonical truth song song. | `IMPLEMENT_READY[HYBRID]`. | Typed contract + freshness/fault matrix + negative tests + quyết định A/B ở §7.1. |
| `TBD-HYB-07` | P0 | Product Owner + Safety Lead | Disable policy/TTL theo Local Physical I/O, Virtual Point và Modbus RTU Point; compatibility với override/interlock. | Output có thể hold/rút không an toàn. | `IMPLEMENT_READY[HYBRID]`. | Per-Point-class decision + hazard review + HIL plan. |
| `TBD-HYB-08` | P0 | Product Owner + Data Lead + Runtime Lead | RETAIN atomicity package, remap/revision migration, published-value bootstrap, và warm/cold/power restart matrix (AC-19). | Mất hoặc dùng sai retained state; suy diễn `RUNNING` sai sau reboot. | `IMPLEMENT_READY[HYBRID]`. | Warm/cold/power/revision matrix + endurance/rollback design. |
| `TBD-HYB-09` | P0 | System Architect + Runtime Lead | Package-level first-success barrier/LKG khi Tasks có cycle khác nhau; subset rollback có bị cấm hay không. | Partial activation hoặc promote LKG sớm. | `IMPLEMENT_READY[HYBRID]`. | State machine + fault-at-each-step + power-loss design review. |
| `TBD-HYB-10` | P1 | Product Owner + Security Lead | Role cho Enable/Disable/Advanced; server-side recent re-auth/strong acknowledgement; source export right. | UI có thể là authority hoặc quyền quá rộng. | `IMPLEMENT_READY[HYBRID]`. | Signed permission/action matrix + direct-API negative plan. |
| `TBD-HYB-11` | **P0** | System Architect + FW-SOM Lead + QA Lead | Multicore scheduling/resource-allocation policy, overload/core-loss recovery và target timing/parallel thresholds. | Không chứng minh AC-08A/08B/09 hoặc deterministic recovery. | `IMPLEMENT_READY[HYBRID]` **(nâng từ `RELEASE_READY` theo review này — xem BEFORE→AFTER)**. | Approved runtime ADR + target real-time measurement protocol + pass thresholds. |
| `TBD-HYB-12` | P1 | Product Owner + QA Lead | Phạm vi History: Revision/Check/Operation/Audit/Trace discovery và retention. | Product copy hứa quá khả năng contract. | `PLAN_READY` cho Hybrid. | History matrix nêu source, retention, paging, export và restart behavior. |

Không tạo thêm TBD mới ngoài `TBD-HYB-01..12` hiện có; các bổ sung ở review
này (D/G/J/K/L) chỉ làm rõ nội dung cần khóa của TBD đã tồn tại, không mở TBD
mới.

Các defect As-Built như UC-03 Check FAILED loop, FE desktop navigation, state enum
drift, RETAIN reset contract-only và thiếu target/HIL evidence **không** được đổi
tên thành Product Decision/TBD để hợp thức hóa. Chúng tiếp tục thuộc gap record
và phải được xử lý ở workstream riêng nếu/when được ủy quyền.

## 24. OLD vs V2.1 vs V2.2 HYBRID

**FACT/REF — `E-FR-03`, `E-FR-06`, `E-AB-01..03`:** repository không có snapshot Product Spec
Programming v2.1 độc lập; revision history của source proposal chỉ ghi v2.1 đã
xử lý finding trước khi file được thêm ở v2.2. Vì vậy:

- **OLD** dưới đây là cực Task-first/manual được task yêu cầu loại bỏ, không phải
  authority và không phải Component Graph/FBD;
- **V2.1** là mô hình một Task/user-visible period/order được lưu trong
  requirement/design/As-Built hiện hành, không phải một file authority v2.1;
- **V2.2 HYBRID** là candidate trong tài liệu này.

| Chủ đề | OLD — Task-first/manual | V2.1 — một Task hiện hành | V2.2 HYBRID | Hành động / migration |
|---|---|---|---|---|
| Mental model | User bắt đầu từ Task. | Program có trong Project nhưng Execution vẫn lộ `Control_Main`/period/order. | User bắt đầu từ Program. | **THAY** IA/domain contract. |
| Task creation | User tự tạo/gán Task. | Một Task cố định. | Runtime auto maps internal Tasks. | **LOẠI** manual normal flow; **MIGRATE** profile. |
| Cycle | Thuộc Task do user cấu hình. | Một Task chọn 1/5/30 s. | Normal property từng Program; mapper group theo cycle. | **THAY** schema/API/artifact/runtime. |
| Program capacity | Phụ thuộc Task user tạo; không có authority capacity. | Profile As-Built `1 Program total`. | Acceptance tối thiểu 10; max target TBD. | **MIGRATE** toàn stack; sizing bắt buộc. |
| Execution order | User sở hữu list order. | Stable order trong một Task. | In-task order nội bộ deterministic; không tạo dependency. | **LOẠI** order khỏi Normal UX; giữ diagnostic. |
| Dependency | Dễ bị đồng nhất với list order. | Không có explicit cross-Program contract. | Ba loại tách bạch — Data/Execution/Health-Availability (§11) — chỉ explicit/architecturally required, có freshness/fault policy. | **THÊM** model/validation. |
| Concurrency | Tùy manual topology. | Scheduler tuần tự, non-preemptive. | Independent Tasks eligible concurrent luôn (`AC-08A`); parallel là target-dependent runtime capability khi ≥2 RT core (`AC-08B`); không 1:1 core. | **THAY** FW-SOM/runtime/QA. |
| Fault radius | Theo Task do user cấu hình. | Một Program fault dừng phần còn lại Task. | Independent Program tiếp tục; dependent bị blocked rõ. | **THAY** fault/commit contract. |
| Data sharing | Không có rule an toàn thống nhất. | Private slots/process snapshot, chưa có cross-Program contract. | Private + read-only snapshot + Published Signal, cấm shared writable tự do. | **GIỮ** private/snapshot; **THÊM** signal semantics. |
| Output | Có nguy cơ order quyết winner nếu không khóa. | Có priority/safe-state substrate; multi-Program chưa chứng minh. | Candidate→ownership→arbitration→interlock→safe-state→I/O; 0/1 direct owner = VALID, >1 = REJECT trừ arbitration contract explicit (§13). | **GIỮ** safety path; **BỔ SUNG** ownership/atomicity. |
| Commission/Activation | Topology là phần cấu hình user. | Atomic primitive một Program/Task. | Package/mapping atomic, Enable tách Commission. | **GIỮ** LKG semantics; **MỞ RỘNG** package barrier. |
| Task/core visibility | Primary workspace. | Task/period/order visible trong Execution. | Chỉ Advanced/Diagnostics. | **THAY** UX; không thiết kế pixel ở đây. |
| ST/FBD/POU/Library | Có thể dùng nhưng không quyết trong archetype. | Đã nằm Product baseline. | Giữ nguyên. | **GIỮ**. |
| Point/Mapping/RETAIN | Không phải điểm khác biệt của archetype. | Đã nằm baseline. | Giữ, thêm stable Program ownership khi remap. | **GIỮ + MIGRATE** identity/transaction. |
| Monitor/Trace/History | Không khóa. | Bounded monitor/trace và operation/audit hiện có. | Giữ; thêm Program/task/core/wait/fault metrics. | **GIỮ + MỞ RỘNG** contract/QA. |
| Graph compatibility | Không liên quan Task-first. | `GRAPH_ONLY/PROGRAM_ONLY`, dual invalid. | Giữ nguyên; graph chỉ migration source. | **GIỮ**, kiểm lại leak/output cutover. |
| Release claim | Không có. | `RELEASE_READY` đang blocked. | Vẫn blocked; Product review không phải release evidence. | **GIỮ ranh giới**. |

## 25. Approval và Revision History

### 25.1 Approval

| Vai trò | Quyết định | Trạng thái |
|---|---|---|
| Product Owner | Product scope, properties, capacity, IA, TBD Product | **PENDING** |
| CTO | Hybrid architecture direction, migration/risk/resource boundary | **PENDING** |
| PM | Release/version/roadmap/affected workstreams | **PENDING** |
| System Architect | Feasibility và downstream ADR/Design plan | **PENDING REVIEW — không phải approval Product** |
| FW-SOM Lead | Runtime feasibility, resource/fault/metrics boundary | **PENDING REVIEW — không phải implementation authorization** |
| QA Lead | Acceptance/evidence feasibility | **PENDING REVIEW — không phải release PASS** |

### 25.2 Revision History

| Revision | Ngày | Nội dung | Trạng thái |
|---|---|---|---|
| `V2.2-HYBRID-candidate.1` | 2026-08-14 | Program-centric Product model + Task-centric internal runtime; 10 quyết định, AC-01..17, migration/TBD/comparison. | In Review |
| `V2.2-HYBRID-candidate.2` | 2026-08-14 | Sửa theo quyết định review: tách Engineering/Runtime lifecycle (§8) + Revision Truth example; khóa thuật ngữ Commission Changes + ví dụ r20/r21 (§14.1); multicore chuyển thành target-dependent capability + tách `AC-08A`/`AC-08B`; khóa ranh giới Published Signal vs canonical Point (§7.1, blocker `TBD-HYB-06`); sửa lại output ownership rule cho phép 0/1 owner (§13); tách Dependency thành Data/Execution/Health-Availability (§11); thêm fault-containment requirement cho Auto Task Mapping (§10.2); tách Advanced properties thành configurable ưu tiên vs Runtime Policy/TBD (§9.2–9.3); thêm nhãn `STD` + Evidence Register §20.4; định nghĩa 10-Program Reference Fixture (§10.3.1); thêm `AC-18` Engineering Plane Isolation, `AC-19` Restart/Enable Intent + `CPR-HYB-013/014`; đổi tên IA thành Candidate Product Workspace (§17.1); phân nhóm gate P0/P1/Governance cho `TBD-HYB-*`, nâng `TBD-HYB-11` sang `IMPLEMENT_READY[HYBRID]` (§23). | In Review |

---

**PRODUCT SPEC V2.2 HYBRID — READY FOR PM/CTO REVIEW**
