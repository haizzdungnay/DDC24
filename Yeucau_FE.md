# YÊU CẦU THIẾT KẾ MỚI PROGRAMMING SOLUTION — MK-DDC-24

## 1. Mục tiêu

Tiến hành **thiết kế lại từ đầu** giải pháp **Programming cho MK-DDC-24**, bao gồm:

* Product architecture.
* Business Core.
* Use Case.
* FE functionality.
* UI/UX/UC.
* Point Mapping.
* ST/FBD Programming.
* Task & Control Library.
* Check/Validation.
* Commissioning.
* Online Runtime Monitoring.
* Version/Restore.
* FE ↔ BE ↔ Compiler ↔ FW-SOM Runtime integration.
* Security/RBAC/Audit.
* Verification & Acceptance.

Không chỉ chỉnh sửa tài liệu cũ. Phải **review, phản biện và tái thiết kế thành một bộ specification thống nhất có thể giao trực tiếp cho Product, UX, FE, BE, FW-SOM và QA triển khai.**

---

# 2. Nguyên tắc bắt buộc

Mọi yêu cầu phải được phân loại nguồn gốc:

* `STD` — có căn cứ IEC/ISO/standard.
* `BENCH` — tham khảo sản phẩm/hãng khác.
* `ARCH` — ràng buộc từ architecture/SRC hiện tại của MK-DDC-24.
* `MK` — quyết định thiết kế riêng của Mekong.
* `TBD` — chưa đủ bằng chứng/chưa quyết định.

**Không được biến design decision thành requirement của tiêu chuẩn.**

Nếu nói:

> “IEC yêu cầu”, “ISO yêu cầu”, “Siemens làm như vậy”

thì phải ghi rõ:

* Standard/document.
* Clause/section nếu xác định được.
* Vendor/product.
* Nội dung được chứng minh.
* Phần nào là suy luận của team.

Không có chứng cứ thì phải ghi:

> `MK DESIGN DECISION` hoặc `TBD`.

**Nghiêm cấm tự huyễn hoặc tạo citation giả.**

---

# 3. Nguồn benchmark tối thiểu phải nghiên cứu

## Standard

Ưu tiên review:

* IEC 61131-3.
* IEC TR 61131-8.
* ISO 16484-1.
* ISO 16484-3.
* ISO 16484-4.
* ISO 9241-110 / ISO 9241-115.
* IEC 62443 liên quan authentication, authorization, integrity và engineering access.

Không claim certification/conformance nếu chưa có compliance assessment chính thức.

## Vendor benchmark

Tối thiểu:

* Siemens Desigo / ABT Site.
* Schneider Electric EcoStruxure Building Operation.
* Johnson Controls Metasys CCT.

Có thể bổ sung:

* Beckhoff TwinCAT.
* CODESYS.
* Niagara.
* Honeywell.
* Distech.
* Automated Logic.

Nhưng phải phân biệt:

**PLC Engineering Tool** và **DDC/BACS Engineering Tool**.

MK-DDC-24 không được trở thành một PLC IDE đổi tên.

---

# 4. Product philosophy phải được kiểm chứng

Candidate workflow:

```text
DESIGN
  ↓
ENGINEERING
  ↓
CHECK
  ↓
COMMISSION
  ↓
RUN
  ↓
SERVICE
```

Runtime/internal pipeline có thể là:

```text
Source
→ Validate
→ Compile
→ Typed IR / Artifact
→ Verify
→ Stage
→ Atomic Activate
→ Runtime Confirm
→ LKG / Restore
```

Team phải đánh giá workflow này, không mặc định coi nó đúng.

Đặc biệt phải quyết định rõ:

```text
EDITING / DRAFT
        ≠
RUNNING / ACTIVE
```

và xác định đây là:

* yêu cầu standard,
* benchmark,
* architecture constraint,
* hay Mekong product policy.

---

# 5. Business Core phải được thiết kế trước UI

Phải xây dựng domain model ít nhất gồm:

```text
Controller
Programming Project
Revision
Application Function
POU
Program
Function Block
Function
Variable
Point
Point Binding
Task
Library
Diagnostic
Artifact
Commission Record
Runtime Instance
Retain State
Audit Event
```

Mỗi object phải có:

* Purpose.
* Ownership.
* Lifecycle.
* State.
* Relationship.
* Validation rule.
* Permission.
* Persistence.
* Runtime relevance.

Phải định nghĩa state machines cho ít nhất:

### Project Revision

```text
DRAFT
→ CHECKING
→ READY
→ COMMISSIONING
→ COMMISSIONED
```

### Runtime

```text
STOPPED
RUNNING
DEGRADED
FAULT
SAFE-STATE
```

### Controller Connectivity

```text
ONLINE
OFFLINE
RECONNECTING
UNKNOWN
```

Không gom tất cả thành một biến `status`.

---

# 6. Business Rules

Business rules phải đánh số rõ ràng.

Ví dụ:

```text
BR-PGM-001
Saving a Draft SHALL NOT modify the Active Runtime.

BR-PGM-002
Blocking diagnostics SHALL prevent Commission.

BR-PGM-003
Missing runtime data SHALL NOT be converted to numeric zero.

BR-PGM-004
Active Revision SHALL change only after authoritative Runtime confirmation.

BR-PGM-005
Commission failure SHALL preserve the previously valid Running Revision.

BR-PGM-006
Changes affecting physical output mapping SHALL require elevated impact review.
```

Team phải tự review và bổ sung đầy đủ.

---

# 7. Use Case Specification

Không viết UC kiểu:

> User mở page và click nút.

UC phải mô tả nghiệp vụ.

Tối thiểu cần cover:

1. Create Programming Project.
2. Create Application Function.
3. Create/Edit ST.
4. Create/Edit FBD.
5. Configure variables.
6. Map variable ↔ canonical point.
7. Configure Task.
8. Use/version Control Library.
9. Check selected POU.
10. Check entire Project.
11. Resolve diagnostics.
12. Compare Editing vs Running.
13. Commission changes.
14. Handle Commission failure.
15. Online Runtime monitoring.
16. Runtime fault investigation.
17. Trace variables.
18. View stale/offline data.
19. Restore previous known-good revision.
20. RETAIN incompatibility.
21. Permission denied.
22. Controller disconnected during Commission.
23. Audit engineering changes.

Mỗi UC phải có:

* Actor.
* Preconditions.
* Trigger.
* Main flow.
* Alternative flow.
* Failure flow.
* Business rules.
* FE state.
* BE/runtime dependency.
* Permission.
* Acceptance criteria.

---

# 8. Information Architecture

Không mặc định 6 page hiện tại là đúng.

Team phải đánh giá candidate:

```text
Programming
├── Overview
├── Programs
├── Points & Mapping
├── Tasks & Library
├── Commission
└── Runtime & Service
```

Có thể:

* giữ,
* tách,
* gộp,
* hoặc thay đổi.

Nhưng mỗi page phải chứng minh:

> Page này phục vụ UC nào và tại sao cần tồn tại?

Không tạo page chỉ vì bố cục đẹp.

---

# 9. FE Functional Scope phải được thiết kế chi tiết

## Programming Workspace

Phân tích:

* Application Function Tree.
* POU Tree.
* ST editor.
* FBD editor.
* Variable inspector.
* Point references.
* Go-to-definition.
* Find references.
* Problems.
* Search.
* Read-only online overlay.

## Point Mapping

Phải xử lý:

* Type.
* Direction.
* Unit.
* Writable/read-only.
* Source.
* Quality.
* Availability.
* Compatibility.
* Cross-reference.

Không tạo một Point universe riêng cho Programming nếu hệ thống đã có canonical Point model.

## Tasks

Phải xác định:

* Cycle.
* Priority.
* Execution budget.
* Watchdog.
* Program assignment.
* Overrun.
* Jitter/WCET exposure.

Normal UI và Advanced UI phải phân biệt.

## Control Library

Phải phân loại ít nhất:

```text
CORE
BACS
PROJECT
```

Library phải có versioning và compatibility policy.

---

# 10. Check / Validation Engine

Team phải thiết kế taxonomy lỗi rõ ràng:

```text
SYNTAX
SEMANTIC
TYPE
REFERENCE
MAPPING
TASK
LIBRARY
RETAIN
ARTIFACT
TARGET
SECURITY
```

Severity tối thiểu:

```text
INFO
WARNING
ERROR
BLOCKING
```

Phải định nghĩa:

> severity nào chặn Commission?

Không dùng một con số kiểu:

> Health = 87%

để thay thế deterministic readiness.

---

# 11. Commissioning

Đây phải được nghiên cứu như một subsystem riêng.

Phải thiết kế:

```text
Check
→ Readiness
→ Change Review
→ Impact Analysis
→ Target Verification
→ Confirmation
→ Prepare
→ Transfer
→ Verify
→ Activate
→ Runtime Confirmation
→ Commission Record
```

Phải xử lý failure tại từng bước.

Team phải trả lời:

* Active cũ có còn chạy không?
* Candidate nằm ở đâu?
* Khi nào Active version chính thức đổi?
* Nếu mất mạng thì sao?
* Nếu runtime reject artifact?
* Nếu reboot?
* Nếu RETAIN incompatible?
* Nếu physical output mapping thay đổi?
* Nếu signature/hash fail?

**Không optimistic update Active Version trên FE.**

---

# 12. Runtime & Service

Phải thiết kế UC chẩn đoán theo quan hệ:

```text
Fault
→ Task
→ Program/FB
→ Variable
→ Point
→ Physical I/O / Field device
```

Không chỉ show log.

Các capability cần đánh giá:

* Online Watch.
* Online ST values.
* Online FBD values.
* Point quality.
* Task execution.
* Overrun.
* Trace.
* Runtime diagnostics.
* Safe-State.
* Previous versions.
* Restore.
* Audit.

Rev A.0 phải quyết định rõ:

> Online monitoring có cho edit trực tiếp runtime hay read-only?

Không tự mặc định.

---

# 13. FE State Model

FE phải thiết kế state độc lập:

```text
ProjectState
DraftState
CheckState
CommissionState
ControllerState
RuntimeState
MonitorState
PermissionState
```

Không tạo những boolean mơ hồ như:

```text
isRunning
isLoading
hasError
```

để đại diện cho toàn hệ thống.

---

# 14. API & Data Contract

FE không được tự suy diễn contract.

Phải thiết kế object/schema cho:

* Controller.
* Project.
* Revision.
* POU.
* FBD graph.
* Variable.
* Point.
* Binding.
* Task.
* Library.
* Diagnostic.
* Readiness.
* Commission.
* Runtime.
* Trace.
* Audit.

Mỗi API phải ghi:

* Request.
* Response.
* Validation.
* Error code.
* Permission.
* Idempotency nếu cần.
* State transition.
* Source of truth.

---

# 15. Runtime Interface

Phải định nghĩa rõ boundary:

```text
FE
│
BE / Engineering Service
│
Compiler
│
Artifact Manager
│
Runtime Manager
│
DDC Runtime / FW-SOM
```

Không để FE phụ thuộc trực tiếp implementation nội bộ của runtime.

Phải xác định:

* artifact format/version.
* ABI/runtime compatibility.
* hash/signature.
* staging.
* activation.
* LKG.
* rollback/restore.
* RETAIN.
* diagnostics.
* authoritative runtime state.

---

# 16. Security / RBAC / Audit

Thiết kế permission matrix tối thiểu:

```text
VIEWER
OPERATOR
ADMIN / ENGINEER
```

Review cụ thể:

* View source.
* Edit Draft.
* Modify mapping.
* Configure task.
* Check.
* Commission.
* Online monitor.
* Force/override.
* Restore.
* Change library.
* View audit.

Audit phải ghi tối thiểu:

```text
WHO
WHEN
CONTROLLER
PROJECT
REVISION
ACTION
BEFORE
AFTER
RESULT
```

---

# 17. Bộ tài liệu phải tạo mới

Tạo đầy đủ cấu trúc:

```text
PROGRAMMING/
│
├── 01_PRODUCT/
│   ├── PROGRAMMING_PRODUCT_SPEC.md
│   ├── PROGRAMMING_BUSINESS_CORE_SPEC.md
│   └── PROGRAMMING_USE_CASE_SPEC.md
│
├── 02_UX_UI/
│   ├── INFORMATION_ARCHITECTURE_SPEC.md
│   ├── UX_REQUIREMENTS_SPEC.md
│   ├── UI_UX_DESIGN_SPEC.md
│   ├── UI_STATE_INTERACTION_SPEC.md
│   └── DESIGN_SYSTEM_SPEC.md
│
├── 03_SOFTWARE/
│   ├── FE_FUNCTIONAL_SPEC.md
│   ├── API_DATA_CONTRACT_SPEC.md
│   ├── PROGRAMMING_RUNTIME_INTERFACE_SPEC.md
│   └── SECURITY_RBAC_AUDIT_SPEC.md
│
└── 04_VERIFICATION/
    ├── REQUIREMENT_TRACEABILITY_MATRIX.md
    └── V_AND_V_ACCEPTANCE_TEST_SPEC.md
```

---

# 18. Requirement Traceability Matrix — bắt buộc

Đây là tài liệu governance quan trọng.

Format:

| ID | Requirement | STD | BENCH | ARCH | MK | Source | Status |
| -- | ----------- | --: | ----: | ---: | -: | ------ | ------ |

Ví dụ:

| Requirement                    | Classification |
| ------------------------------ | -------------- |
| ST support                     | STD            |
| FBD support                    | STD            |
| Programming/debug environment  | STD            |
| BACS point-centric engineering | STD/BENCH      |
| Online function chart values   | BENCH          |
| Editing/Running persistent bar | MK             |
| Chính xác 6 Programming pages  | MK/TBD         |
| Atomic activation              | ARCH           |
| LKG restore                    | ARCH           |

Không được để requirement không có classification.

---

# 19. V&V

Mỗi Business Rule quan trọng phải có test.

Ví dụ:

```text
TC-PGM-001

GIVEN:
Running Revision = r15
Editing Revision = r17

WHEN:
Check r17 fails

THEN:
Running SHALL remain r15
Runtime SHALL remain unaffected
FE SHALL clearly display:
- Editing r17 — Check Failed
- Running r15 — Running
```

Traceability phải theo chuỗi:

```text
STANDARD / BENCHMARK / DECISION
          ↓
PRODUCT REQUIREMENT
          ↓
BUSINESS RULE
          ↓
USE CASE
          ↓
FE/BE/RUNTIME REQUIREMENT
          ↓
TEST CASE
```

---

# 20. Quy trình thực hiện

Không làm UI trước.

Thứ tự:

```text
STEP 1 — Audit existing architecture/docs/source
STEP 2 — Standard & vendor benchmark
STEP 3 — Findings / contradictions / gaps
STEP 4 — Product decisions
STEP 5 — Business Core
STEP 6 — Use Cases
STEP 7 — Traceability Matrix
STEP 8 — Information Architecture
STEP 9 — UX Requirements
STEP 10 — UI/UX Design
STEP 11 — FE Functional Specification
STEP 12 — API/Data Contract
STEP 13 — Runtime Interface
STEP 14 — Security/RBAC/Audit
STEP 15 — V&V
STEP 16 — Cross-team final review
```

---

# 21. Review bắt buộc

Mỗi major design decision phải được review từ ít nhất các góc:

### Product review

Có đúng DDC/BACS use case không?

### Controls Engineering review

Controls Engineer có thực sự commissioning/service được không?

### UX review

Có giảm nhầm lẫn và thao tác nguy hiểm không?

### FE/BE review

State/API có triển khai được không?

### FW-SOM/Runtime review

Có phù hợp execution model thực tế không?

### QA/Safety review

Failure case và recovery có deterministic không?

Nếu các team bất đồng, ghi vào:

```text
OPEN DECISION
OPTIONS
PROS
CONS
RISK
RECOMMENDATION
OWNER
DEADLINE
```

Không tự động chọn phương án rồi coi như đã được thống nhất.

---

# 22. Output cuối cùng

Team phải bàn giao:

1. Bộ **14 specification documents** hoàn chỉnh.
2. Requirement Traceability Matrix.
3. Business/domain model.
4. State-machine diagrams.
5. UC matrix.
6. Screen/feature inventory.
7. FE state model.
8. API/domain contracts.
9. Runtime integration architecture.
10. Security/RBAC matrix.
11. Validation/readiness model.
12. Commission failure/recovery matrix.
13. V&V acceptance test suite.
14. Danh sách Open Decisions còn lại.
15. Executive Design Review Summary.

---

# 23. Definition of Done

Không được kết luận **READY FOR IMPLEMENTATION** nếu còn một trong các vấn đề:

* Business Core chưa khóa.
* Draft/Running semantics chưa khóa.
* Point model chưa thống nhất.
* Check/Commission state machine chưa khóa.
* FE/BE/runtime source-of-truth chưa rõ.
* Requirement không có traceability.
* Standard claim không có chứng cứ.
* API contract chưa thống nhất.
* Permission chưa xác định.
* Failure/recovery chưa có test.
* FE mockup sử dụng capability backend/runtime chưa tồn tại mà không đánh dấu future/TBD.

Mục tiêu cuối cùng không phải tạo nhiều tài liệu.

Mục tiêu là tạo ra một **Programming Product Architecture thống nhất, có chứng cứ, triển khai được, kiểm thử được và phù hợp bản chất DDC/BACS của MK-DDC-24.**
