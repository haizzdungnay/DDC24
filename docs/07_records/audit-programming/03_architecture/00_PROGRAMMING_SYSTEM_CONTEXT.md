# Bối cảnh hệ thống và ranh giới kiến trúc Programming

**ID:** ARCH-PROG-001  
**Phiên bản:** 0.1  
**Trạng thái:** IN REVIEW  
**Nguồn:** ADR-020, ADR-023; baseline kiến trúc ba process của MK-DDC-24

## 1. Kết luận kiến trúc

Programming phải nằm trong kiến trúc ba process hiện hữu; bộ audit **không tạo
thêm process/service**. Allocation chi tiết chỉ được khóa bằng Programming Design
hoặc ADR được phê duyệt.

```text
Engineering client
       |
       v
mkddc-web  -- lifecycle/monitor contract -->  mkddc-core
                                                  |
                                      Point/process-image contract
                                                  |
                                                  v
                                             mkddc-iobus
                                                  |
                         Local I/O / Virtual Point / Modbus RTU field device
```

## 2. Boundary constraint

| Boundary | Authority phải có | Ràng buộc |
|---|---|---|
| Client ↔ `mkddc-web` | Session/RBAC, request/correlation | Client không tự claim lifecycle success |
| `mkddc-web` ↔ `mkddc-core` | Project/Revision/lifecycle/monitor authority được Design phân bổ | Validate ≠ Deploy ≠ Activate; stable error |
| `mkddc-core` ↔ `mkddc-iobus` | Point identity/value/quality/timestamp, config revision/ACK | Core sở hữu Point Table; iobus sở hữu Modbus Master theo ADR-024 |
| Runtime ↔ persistence | Artifact/Revision/RETAIN integrity và compatibility | Atomic activation/LKG, fail closed |
| Runtime ↔ output | Process image/arbitration/fault policy | Không uncontrolled output khi Program/Point lỗi |

## 3. Trách nhiệm logic bắt buộc

| Khối logic | Trách nhiệm | Trạng thái allocation |
|---|---|---|
| Authoring | Project/Program ST/FBD, mapping, diagnostics | Chưa khóa FE/API/schema |
| Compiler/validator | ST/FBD semantic chung → typed artifact | Candidate component có ST/IR; FBD còn thiếu |
| Lifecycle authority | Immutable Revision, deploy/activate/rollback state | Chưa có production contract/evidence |
| Cyclic runtime | Verify/load/schedule/execute/fault/overrun | Component host có foundation, chưa production path |
| I/O authority | Cấp ba Point category với quality/access | RTU có quyết định phụ thuộc; full mapping chưa khóa |
| Monitor | Authority state/value/freshness | Chưa có Programming production contract |
| Audit/security | RBAC, mutation audit, replay/idempotency | Role matrix Programming còn mở |

## 4. Bất biến kiến trúc

1. Runtime không chạy source ST hoặc graph JSON chưa validate trực tiếp.
2. Artifact/Revision identity phải nhất quán từ authoring tới active runtime.
3. Program active chạy local, không phụ thuộc kết nối Web.
4. I/O Mapping chỉ dùng ba Point category Rev A; TCP/BACnet không được lọt qua.
5. Activation lỗi giữ active Revision cũ; power/process fault không tạo state mơ hồ.
6. Online Monitor là read-only capability, không ngầm cấp force/write/online change.

## 5. Kiến trúc còn mở

Allocation cụ thể trong ba process, IPC/API/schema, task/multi-program model,
capacity, persistence, FBD pipeline, RETAIN, monitor và migration phải chờ
OD-PROG-001..015 cùng Design review. Tên `mkddc-program-service` trong draft cũ
chỉ là proposal lịch sử.
