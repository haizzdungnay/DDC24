# Bảng trích thiết kế liên quan Programming

**Ngày trích/đối chiếu:** 2026-08-08

**Phân loại:** RECORD — xem cách phân loại chuẩn hiện hành tại
`../04_design/01_COMPONENT_SPEC_ASSESSMENT.md`.

**Nguyên tắc:** giữ lại ý định thiết kế có thể tái sử dụng nhưng không nâng trạng thái
Draft/legacy/component-level thành Programming Design production đã phê duyệt.

## 1. Trạng thái thẩm quyền của bộ thiết kế

| Nhóm | Tài liệu nguồn | Trạng thái đúng tại audit | Cách sử dụng |
|---|---|---|---|
| Ranh giới thiết kế hiện hành | `docs/04_design/SOFTWARE.md`, `INTERFACES.md` | Active; nói rõ Programming Design chưa thực hiện | Authority để không overclaim |
| Quyết định kiến trúc | ADR-020, ADR-023 trong `DECISIONS.md` | Accepted | Khóa ST+FBD, artifact bất biến, scope Point/cycle và negative scope |
| Draft tổng thể | `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` | Draft; đường dẫn/component name có phần lịch sử | Nguồn candidate, phải reconcile sau khi đóng OD-PROG |
| ST subset | `ST_SUBSET_SPEC_MK-DDC-24_VI.md` | Ghi Active/normative cho component cũ | Khớp khá nhiều source host; chưa phải Product type/library approval |
| Task scheduler | `PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md` | Ghi Active/normative cho component cũ | Mô hình host component; cycle/capacity lệch Product hiện hành |
| Typed IR | `TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md` | Ghi Active/normative cho component cũ | Có source implementation/test; chưa có production activation path |
| Graph schema/runtime | `GRAPH_SCHEMA_*`, `SW_RUNTIME_EXECUTION_MODEL_*`, Plan 23 | Legacy graph, không phải FBD | Chỉ dùng để migration/reuse sau OD-PROG-013 |
| Modbus RTU Point | Detailed Design + Interface/API specs | Design phụ thuộc, đã có quyết định ADR-024 nhưng As-Built còn gap | Input bắt buộc cho IF-REQ-PROG-001; không tự đóng Programming Design |
| Handoff | `FW_SOM_PROGRAM_TASK_MODEL.md` | Historical handoff | Dùng truy nguyên, không làm authority hiện hành |

## 2. Kiến trúc mục tiêu được ADR-020 chấp nhận

| Thành phần logic | Trách nhiệm mục tiêu | Ràng buộc |
|---|---|---|
| Engineering/Web Programming | Author Project/Program ST và FBD, I/O Mapping, validate, Revision, lifecycle, monitor | Không báo success từ client; RBAC/audit; không online change |
| Programming service/authority | Sở hữu project/build/artifact/deployment/runtime state | Tên/process allocation cuối cùng vẫn phải được Programming Design khóa |
| Compiler | ST source hoặc FBD model → semantic chung → typed IR artifact | Runtime không parse source ST hoặc chạy JSON graph trực tiếp |
| FW SOM runtime | Verify/load artifact, schedule cyclic, process image, execute, fault/overrun, atomic activation/rollback | Chạy local độc lập Web; output qua arbitration/safe-state |
| I/O authority | Cấp Local Physical I/O, Virtual Point, Modbus RTU Point với identity/type/direction/quality/access | Không expose TCP/BACnet Point vào Programming |
| Persistence | Immutable Revision/artifact, RETAIN và recovery | Policy compatibility/power-loss phải được phê duyệt |

Đây là mô hình logic, không phải bằng chứng các process/service đã tồn tại.

## 3. Mô hình Task/Program candidate

Nguồn: `PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md` §1–§3.

```text
Resource (một mkddc-core)
  ├─ Task: period, priority, budget
  │    └─ ProgramInstance: order, state riêng
  │         └─ immutable typed IR Artifact
  └─ ProcessImage dùng chung
```

| Khái niệm | Candidate/component limit | Product baseline hiện hành | Kết luận audit |
|---|---:|---:|---|
| Resource | 1 mỗi `mkddc-core` | Chưa chốt ở OD-PROG-004 | Không được đóng Product limit |
| Task | ≤ 8 | Chưa chốt ở OD-PROG-003/004 | Component limit, không phải capacity đã duyệt |
| Program/Task | ≤ 16 | Chưa chốt ở OD-PROG-003/004 | Component limit |
| Program tổng | ≤ 32 | Chưa chốt ở OD-PROG-003/004 | Component limit |
| Base tick | 50 ms | Cycle cho người dùng chỉ 1 s/5 s/30 s | Internal tick có thể giữ; API/config phải reject cycle khác |
| Period component | 50..60000 ms, bội 50 ms | Chỉ 1000/5000/30000 ms | **Lệch requirement** |
| Thực thi | Fixed-priority, non-preemptive tại task boundary | Deterministic rule chờ phê duyệt | Candidate cần benchmark/approval |

## 4. ST subset candidate/component As-Built

Nguồn: `ST_SUBSET_SPEC_MK-DDC-24_VI.md`.

| Nhóm | Hỗ trợ trong component | Không hỗ trợ trong component |
|---|---|---|
| Kiểu cơ sở | `BOOL`, `INT` int32, `REAL` binary32 hữu hạn, `TIME` int64 ns | `DINT/LINT/UINT/LREAL`, string, date-time, array, struct, pointer, user type |
| Cấu trúc | Một `PROGRAM`; `VAR_INPUT`, `VAR_OUTPUT`, `VAR`, `VAR RETAIN` | Nhiều POU trong một source, recursion, dynamic allocation |
| Control | Assignment, biểu thức, `IF/ELSIF/ELSE`; loop bị giới hạn/loại theo subset | Online change và bề mặt IEC đầy đủ |
| Function block | Timer/edge candidate như `TON`, `TOF`, `TP`, `R_TRIG`, `F_TRIG` | Library Product chính thức vẫn chờ OD-PROG-005 |
| Claim | IEC 61131-3-aligned subset | Không compliant/conformant/certified |

Các kiểu và library trên khớp source component tại snapshot, nhưng OD-PROG-002/005
đang OPEN nên chưa được dùng làm hợp đồng Product cuối.

## 5. Typed IR artifact candidate/component As-Built

Nguồn: `TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md`.

| Trường/section | Ý nghĩa thiết kế | Trạng thái source |
|---|---|---|
| Magic `MKDDCIR1` | Fail closed khi format không tương thích | Có loader/artifact component |
| `compiler_profile`, `target_abi`, version | Chặn artifact không tương thích | Có |
| `METADATA`, `CONSTANTS`, `VARIABLES`, `CODE` | Nội dung runtime có kiểu | Có |
| `IO_BINDING` | Ánh xạ variable ↔ process image | Có nhưng category/contract chưa đạt IF-REQ-PROG-001 |
| `FB_INSTANCES` | State riêng của function block | Có component |
| `RETAIN_LAYOUT` | Layout biến RETAIN | Có component/store, chưa nối production |
| `DEBUG_SOURCEMAP` | Trace fault về source | Có candidate/component |
| SHA-256 + Ed25519 | Integrity/authenticity artifact | Có code dùng libsodium và test host |
| Atomic activation/LKG | Chuyển ở boundary, fail giữ package cũ | Có logic trong `StScheduler`, chưa có production authority/transport/persistence |

## 6. Process image và I/O Mapping cần đạt

Nguồn authority: IF-REQ-PROG-001; nguồn candidate: draft + ST/IR/Modbus design.

| Category bắt buộc | Identity/data bắt buộc | Read/write | Tình trạng design/source |
|---|---|---|---|
| Local Physical I/O | stable Point identity, hardware kind/channel, type, unit/range, quality/timestamp | Theo direction + access | Component ST dùng prefix UI/DI/AO/DO; chưa nhận contract authority đầy đủ |
| Virtual Point | stable identity, type, quality/timestamp | Theo direction + access | IR/process image có AV/BV/MSV; validate authoring chưa thống nhất |
| Modbus RTU Point | stable Point ID, bus/device/register/type/endian/scaling, quality/reason/timestamp | Read/write theo FC/access và authority result | IOBus/Point Table có nền riêng; ST IR/I/O Mapping chưa biểu diễn RTU Point |
| Loại ngoài scope | TCP/BACnet/LD/SFC/motion/safety | Phải reject | Legacy graph demo vẫn hiểu `tcp`; production Programming chưa tồn tại để chứng minh reject end-to-end |

## 7. Lifecycle state machine tối thiểu cần thiết kế

Nguồn: PR-PROG-006..010, SWR-REQ-PROG-007..009, ADR-020.

```text
Project/Program draft
  -> Validate
  -> immutable Revision + typed artifact
  -> Deployment request
  -> runtime authoritative accept/reject
  -> Activation tại cyclic boundary
  -> Active Revision
  -> Rollback về known-compatible Revision khi được phép
```

| Bất biến | Hệ quả kiểm thử |
|---|---|
| Revision deployable là bất biến | Sửa nội dung phải tạo Revision mới; hash/identity nhất quán FE–BE–runtime |
| Validate không đồng nghĩa Deployment | Mỗi trạng thái có authority ACK/reject/timeout riêng |
| Deployment không đồng nghĩa Activation | Không UI false-success trước runtime ACK |
| Activation chỉ ở cyclic boundary | Artifact cũ chạy trọn cycle; artifact mới bắt đầu ở boundary |
| Activation lỗi giữ active Revision cũ | Corrupt/incompatible/timeout/power-loss không tạo trạng thái mơ hồ |
| Rollback chỉ về Revision tương thích đã biết | Có policy, actor, audit và authority result |
| Client mất không dừng control | Runtime local không phụ thuộc session Web |

## 8. Những nội dung chưa được phép đóng bằng tài liệu cũ

Các giá trị dưới đây vẫn phải được quyết định trong OD-PROG trước khi Programming Design
được phê duyệt: role/action, type system Product, capacity, multi-program scheduling,
library ST/FBD, FBD UX/format, I/O Mapping hoàn chỉnh, RETAIN policy, lifecycle/power-loss,
Online Monitor, WCET/overrun, graph migration và config migration.

Vì vậy, nhãn `Active — normative` trong một số component spec ngày 2026-07-28 chỉ được
hiểu trong phạm vi component/source cũ. Nó không vượt qua tuyên bố mới hơn trong
`SOFTWARE.md`, `INTERFACES.md`, ADR-023 và Programming Docs Sync Report rằng
`READY_FOR_PROGRAMMING_DESIGN = NO`.
