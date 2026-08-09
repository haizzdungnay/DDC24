# Trạng thái và ràng buộc thiết kế Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `DES-PROG-STATUS-001` |
| Phiên bản | 0.2 |
| Trạng thái | `IN REVIEW — DESIGN NOT APPROVED` |
| Gate | `G0..G7 = RED / NOT STARTED` |
| Design input | Hai proposal v2.2, không phải baseline approved |

## Mục lục

1. Kết luận
2. Constraint authority
3. Constraint proposal v2.2
4. Candidate reuse
5. Package cần có trước approval
6. Điều kiện đổi gate
7. Thuật ngữ
8. Lịch sử và phê duyệt

## 1. Kết luận

Programming Design production chưa được phê duyệt. Proposal v2.2 được nhập như
design input/constraint có trace; không đóng OD, không khóa API/schema/capacity/
WCET và không đổi production evidence 0/13.

## 2. Constraint authority

| ID | Constraint Active |
|---|---|
| DES-PROG-C01 | Chỉ ST/FBD; validation/runtime semantic phải nhất quán. |
| DES-PROG-C02 | Chỉ Local Physical I/O, Virtual Point, Modbus RTU Point. |
| DES-PROG-C03 | Chỉ cycle 1000/5000/30000 ms ở boundary Product. |
| DES-PROG-C04 | Revision/artifact deployable bất biến và truy nguyên end-to-end. |
| DES-PROG-C05 | Activation ở control boundary; lỗi giữ Active Revision trước. |
| DES-PROG-C06 | Active Program chạy local độc lập Web/client. |
| DES-PROG-C07 | Monitor phản ánh authority/freshness/quality, read-only mặc định. |
| DES-PROG-C08 | Negative scope bị reject UI/API/import/runtime. |
| DES-PROG-C09 | Không claim IEC compliant/certified khi chưa có evidence. |
| DES-PROG-C10 | Giữ kiến trúc ba process; process mới cần ADR. |

## 3. Constraint proposal v2.2

| ID | Constraint candidate | Owner chi tiết | Blocker |
|---|---|---|---|
| DES-PROG-C11 | Rev A có một Task; structured FBD; multi-task/free-form canvas OUT | Product/UX | OD-PROG-003, OD-PROG-004, OD-PROG-006 |
| DES-PROG-C12 | Base step độc lập Task period; watchdog theo công thức ARCH-PROG-002 | Runtime Architecture | OD-PROG-012, OD-PROG-013, OD-PROG-014; CONF-PROG-015 |
| DES-PROG-C13 | Graph/Programming cutover ba state, dual-run fail closed | Runtime Architecture | OD-PROG-013, OD-PROG-014 |
| DES-PROG-C14 | Program là Local logic mức 5; read model và anti-windup hai chế độ | Control Semantics | OD-PROG-007, OD-PROG-011, OD-PROG-012 |
| DES-PROG-C15 | Hold-last `previous_program_value`; IOP poll `<200 ms`; không restart iobus | Control Semantics | OD-PROG-009, OD-PROG-012 |
| DES-PROG-C16 | Overrun fault mức Task; plant safe-state chỉ do SafetyManager độc lập | Architecture/Control Semantics | OD-PROG-012 |
| DES-PROG-C17 | Bundle source-only; build lại target; hash IN/signature origin OUT | Interface/Security | OD-PROG-010, OD-PROG-014 |
| DES-PROG-C18 | Check/compiler cách ly tài nguyên khỏi core/iobus | Runtime Architecture | OD-PROG-012 |

## 4. Candidate reuse

| Candidate | Có thể giữ | Không được suy diễn |
|---|---|---|
| ST subset/Typed IR | Parser/type/source-map/integrity foundation | Product type/library/capacity approved |
| Scheduler | Task/program separation, activation/fault hooks | Multi-task 8/16/32 hoặc watchdog model approved |
| Process image/resolver | Typed value/quality/priority foundation | Full Programming mapping/anti-windup/bumpless PASS |
| Modbus RTU design | Bus→Device→Point, ACK/LKG | Full I/O Mapping complete |
| Graph runtime | AS-BUILT và migration input | FBD implementation hoặc dual-run |

## 5. Package cần có trước approval

1. Architecture views/allocation và base-step/watchdog/resource profile.
2. Data model Project/Program/Variable/Point/Mapping/Revision/artifact.
3. ST/structured-FBD semantic pipeline.
4. Control semantics/resolver/hold-last/overrun/IOP.
5. Lifecycle/RETAIN/power-loss/cutover/recovery.
6. Interface/error/authority/idempotency; URL/schema sau OD.
7. Security/RBAC/audit/negative scope.
8. Migration graph/config.
9. Trace `PC→PR→REQ→proposal→VS→VR→evidence` và board/HIL evidence.

## 6. Điều kiện đổi gate

Chỉ đổi Design khi các OD chặn đóng và đủ sign-off. Chỉ đổi production RED khi
13 VR có evidence hợp lệ. Source/host test/tài liệu không đủ.

## 7. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 8. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-08 | Design status audit ban đầu. |
| 0.2 | 2026-08-09 | Nhập v2.2 như design input/constraint, giữ NOT APPROVED. |

Sign-off: Product `PENDING`; Architecture `PENDING`; Controls/Safety `PENDING`; UX `PENDING`; Verification `PENDING`.
