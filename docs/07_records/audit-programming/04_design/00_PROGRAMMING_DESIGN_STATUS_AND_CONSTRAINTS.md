# Trạng thái và ràng buộc thiết kế Programming

**ID:** DES-PROG-STATUS-001  
**Phiên bản:** 0.1  
**Trạng thái:** IN REVIEW — DESIGN NOT APPROVED  
**Gate:** `READY_FOR_PROGRAMMING_DESIGN = NO`

## 1. Kết luận

Chưa tồn tại một Programming Design production được phê duyệt bao phủ đủ ST,
FBD, ba Point category, cycle 1/5/30 s và lifecycle. Các component ST/scheduler/
typed IR, graph và Modbus RTU là input thiết kế có mức authority khác nhau.

## 2. Constraint đã được khóa bởi Product/ADR

| ID | Constraint |
|---|---|
| DES-PROG-C01 | Chỉ ST và FBD; semantic validate/runtime phải nhất quán. |
| DES-PROG-C02 | Chỉ Local Physical I/O, Virtual Point, Modbus RTU Point. |
| DES-PROG-C03 | Chỉ cycle Product 1000/5000/30000 ms ở mọi boundary ngoài. |
| DES-PROG-C04 | Revision/artifact deployable bất biến và truy nguyên end-to-end. |
| DES-PROG-C05 | Activation ở cyclic boundary, lỗi giữ active Revision trước. |
| DES-PROG-C06 | Program active chạy local độc lập Web/client. |
| DES-PROG-C07 | Online Monitor phản ánh authority/freshness/quality và read-only mặc định. |
| DES-PROG-C08 | Negative scope bị reject ở UI/API/import/runtime. |
| DES-PROG-C09 | Không claim IEC compliant/certified khi chưa có hồ sơ đánh giá. |
| DES-PROG-C10 | Giữ kiến trúc ba process; process mới cần ADR riêng. |

## 3. Candidate có thể tái sử dụng

| Candidate | Giá trị có thể giữ | Điều phải reconcile trước approval |
|---|---|---|
| ST subset component | Parser/semantic/diagnostic/type foundation | OD-002/005, production compiler/runtime parity |
| Typed IR | Header/version/ABI, sections, integrity/signature, source map | Full I/O categories, authority transport, persistence, FBD |
| Scheduler | Task/program separation, boundary activation, fault hooks | Product cycle allowlist, capacity, WCET, multi-program rule |
| Process image | Typed slot/value/quality foundation | Stable Point contract, RTU mapping, timestamp/access |
| Modbus RTU design | Bus→Device→Point, stable Point, config ACK/LKG, write result | Đồng bộ ADR-024 một bus/≥256 và production evidence |
| Graph runtime | Stateful component/migration experience | Không dùng như FBD; chờ OD-013 |

## 4. Design package bắt buộc trước approval

1. Logical/data/deployment view và allocation rõ trong ba process.
2. Data model Project/Program/Variable/Point/Mapping/Revision/artifact.
3. ST và FBD compiler pipeline cùng semantic/versioning.
4. Scheduler/runtime/fault/overrun/process-image design.
5. Deploy/activate/rollback/RETAIN state machine và power-loss recovery.
6. Interface/API/error/authority/idempotency schema.
7. Security/RBAC/audit và negative-scope enforcement.
8. Migration/compatibility cho graph/config cũ.
9. Verification design liên kết đủ 13 VR và production target evidence.

## 5. Điều kiện đổi gate

Chỉ đổi `READY_FOR_PROGRAMMING_DESIGN` khi Product/owners đóng các OD chặn,
approve design package và cập nhật traceability. Chỉ đổi production `RED` khi
13 VR có evidence hợp lệ; source hoặc host test đơn lẻ không đủ.
