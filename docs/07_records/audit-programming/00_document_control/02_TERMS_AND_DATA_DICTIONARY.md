# Thuật ngữ và từ điển dữ liệu Programming

**ID:** TERM-PROG-001  
**Phiên bản:** 1.0  
**Trạng thái:** CONTROLLED BASELINE

## 1. Thuật ngữ Product

| Thuật ngữ | Nghĩa chuẩn | Không được hiểu là |
|---|---|---|
| Project | Container chứa Program, khai báo Point/Variable, I/O Mapping và lịch sử Revision | Một file graph legacy |
| Program | Đơn vị logic ST hoặc FBD có thể validate và chạy cyclic | Process Linux hoặc Task scheduler |
| Point | Dữ liệu ở ranh giới Programming với I/O/point space, có identity và quality | Variable nội bộ |
| Variable | Dữ liệu có tên được Program dùng nội bộ | Mặc nhiên là Point |
| I/O Mapping | Quan hệ đã validate giữa Variable và Point được phép đọc/ghi | Prefix tên biến không có contract |
| Revision | Bản bất biến, truy nguyên được của Project/Program/config liên quan | Trạng thái Deployment hoặc Active |
| Deployment | Chuyển Revision đã validate tới runtime và chờ authority chấp nhận | Activation |
| Activation | Chuyển có kiểm soát để Revision đã deploy trở thành active tại cyclic boundary | Request client đã gửi |
| Rollback | Quay về Revision tương thích đã biết, có authority result | Sửa trực tiếp Revision cũ |
| RETAIN | Variable được giữ qua điều kiện restart đã phê duyệt | Luôn giữ qua mọi power/revision change |
| Online Monitor | Quan sát authority runtime, freshness và quality | Online change, write hoặc force |

## 2. Giá trị phạm vi chuẩn Rev A

| Miền | Allowlist chuẩn | Bị từ chối |
|---|---|---|
| Ngôn ngữ | `ST`, `FBD` | `LD`, `SFC`, ngôn ngữ khác |
| Point category | Local Physical I/O, Virtual Point, Modbus RTU Point | Modbus TCP Point, BACnet/IP Point, loại khác |
| Cycle time Product | `1000`, `5000`, `30000` ms | Mọi giá trị khác ở UI/API/import/runtime |
| Claim | IEC 61131-3-aligned subset nếu có bằng chứng | compliant/conformant/certified khi chưa đánh giá |

## 3. Trường dữ liệu tối thiểu cần thống nhất

| Đối tượng | Trường/ý nghĩa bắt buộc | Trạng thái schema |
|---|---|---|
| Project | stable ID, name, Revision relation, owner/actor metadata | Chưa phê duyệt chi tiết |
| Program | stable ID, language ST/FBD, cycle, Revision relation, runtime state | Chưa phê duyệt chi tiết |
| Variable | stable ID/name, type, initial value, RETAIN flag, runtime value | Type system chờ OD-PROG-002 |
| Point | stable ID, category, type, direction/access, unit/range khi áp dụng, value, quality, timestamp/source | Contract chờ OD-PROG-007 |
| I/O Mapping | Variable ID, Point ID/category, direction, type compatibility, access, validation result | Contract chờ OD-PROG-007/008 |
| Revision | immutable ID, Project/Program relation, actor/time, artifact identity/hash, validation state | Policy chờ OD-PROG-010 |
| Lifecycle result | correlation ID, target Revision, state, authority, error code/message, timestamp | Contract chờ design |
| Monitor sample | active Revision, Program/Variable/Point identity, value, quality, source timestamp, freshness/stale state | Refresh/retention chờ OD-PROG-011 |

## 4. Quy ước unknown và stale

Thiếu timestamp/quality/source không được thay bằng giá trị giả. `unknown`,
`unavailable`, `stale`, `rejected` và `timeout` là trạng thái riêng; UI/API không
được quy chúng thành `success`, `live` hoặc giá trị mặc định có vẻ hợp lệ.
