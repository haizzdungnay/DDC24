# Đăng ký mâu thuẫn tài liệu và dữ liệu Programming

**ID:** CONFREG-PROG-001  
**Phiên bản:** 1.0  
**Ngày đối chiếu:** 2026-08-08  
**Trạng thái:** CONTROLLED BASELINE

## 1. Quy ước xử lý

- `RESOLVED-AUDIT`: bộ audit đã có cách đọc duy nhất dựa trên authority; nguồn
  lịch sử vẫn giữ nguyên.
- `OPEN-DESIGN`: requirement đã rõ nhưng thiết kế/giá trị chi tiết chưa được duyệt.
- `OPEN-UPSTREAM`: tài liệu nguồn ngoài bộ audit còn phải đồng bộ; bộ audit chỉ
  ghi cách đọc hiện tại.
- `SUPERSEDED`: giá trị cũ bị quyết định mới hơn thay thế.

## 2. Conflict register

| ID | Mâu thuẫn | Nguồn/biểu hiện | Cách xử lý chuẩn trong bộ audit | Trạng thái |
|---|---|---|---|---|
| CONF-PROG-001 | Product, design nháp, component spec, plan và review nằm cùng cấp | Cây `source-snapshots` cũ | Phân tầng 00..09; raw source chỉ ở archive | RESOLVED-AUDIT |
| CONF-PROG-002 | FBD Rev A bị lẫn với graph 28-node legacy | Product/ADR-023 yêu cầu FBD; Graph Schema mô tả graph JSON | FBD là Product feature; graph chỉ là đầu vào migration của OD-PROG-013, không phải FBD | RESOLVED-AUDIT / OPEN-DESIGN |
| CONF-PROG-003 | Product chỉ cho 1/5/30 s nhưng scheduler component nhận 50..60000 ms bội 50 ms | `PROGRAM_TASK_SCHEDULER_SPEC...` so với PR/SWR-PROG-005/006 | Biên ngoài chỉ nhận 1000/5000/30000 ms; 50 ms chỉ có thể là internal tick candidate | OPEN-DESIGN |
| CONF-PROG-004 | Tài liệu cũ gán component/path `services/core` và service Programming riêng | Draft/ST/IR spec cũ; design boundary mới nói allocation chưa khóa | Đường dẫn/tên service cũ là historical; không tạo process mới từ tài liệu audit | RESOLVED-AUDIT / OPEN-DESIGN |
| CONF-PROG-005 | ADR-024 vừa ghi `Accepted 2026-08-05`, vừa còn câu “Proposed” | `DECISIONS.md` table và phần ghi chú cũ | Dùng entry có status/date cụ thể: Accepted 2026-08-05; ghi chú “Proposed” là stale | RESOLVED-AUDIT / OPEN-UPSTREAM |
| CONF-PROG-006 | Modbus RTU Rev A là 1 hay 2 bus vật lý | ADR-024: 1 bus; `SYS-REQ-MBRTU-001` và design cũ: 2 port | Programming audit dùng 1 bus vật lý, giữ `bus_id` mở rộng; yêu cầu 2 port là superseded | SUPERSEDED / OPEN-UPSTREAM |
| CONF-PROG-007 | Capacity Modbus Point là 64 hay ≥256 | Detailed Design cũ: 64; ADR-024: ≥256 | ≥256 là quyết định mới hơn; 64 chỉ là historical component value | SUPERSEDED |
| CONF-PROG-008 | OD-PROG-007/008 ghi “chờ ADR-024” dù ADR đã Accepted | Open Decision ngày 2026-08-03 so với quyết định 2026-08-05 | Phần Modbus theo ADR-024 được coi đã quyết định; Local/Virtual/full mapping và evidence vẫn OPEN | RESOLVED-AUDIT / OPEN-DESIGN |
| CONF-PROG-009 | ST/Scheduler/IR ghi Active normative nhưng Programming Design nói chưa thực hiện | Component specs 2026-07-28 so với `SOFTWARE.md`, sync report mới hơn | “Active” chỉ trong component cũ; dùng làm candidate input, không phải Product Design | RESOLVED-AUDIT |
| CONF-PROG-010 | Component limit 8 task, 16 program/task, 32 tổng bị hiểu thành Product capacity | Scheduler spec so với OD-PROG-003/004 | Không đưa các số này vào Product/Feature baseline; giữ candidate đến khi có quyết định | OPEN-DESIGN |
| CONF-PROG-011 | RETAIN code/spec tồn tại nhưng policy restart/power/revision chưa chốt | IR/ST component so với OD-PROG-009 | Chỉ giữ nghĩa Product; policy và acceptance còn OPEN | OPEN-DESIGN |
| CONF-PROG-012 | API graph/Modbus cũ bị hiểu là Programming API đã có | Interface snapshots và source review | Programming interface chỉ có requirement baseline; endpoint/schema chi tiết chưa approved | RESOLVED-AUDIT / OPEN-DESIGN |
| CONF-PROG-013 | Host unit test bị dùng để claim production capability | Component reports so với VR-PROG-004..012 | Host test là supporting evidence; production result vẫn 0/13 | RESOLVED-AUDIT |
| CONF-PROG-014 | Cụm từ “theo chuẩn ISO” dễ bị hiểu thành chứng nhận | Yêu cầu tổ chức hồ sơ | Ghi rõ ISO-like lifecycle/traceability; không claim certification/compliance | RESOLVED-AUDIT |

## 3. Việc bị chặn bởi conflict mở

Không được phê duyệt Programming Design, khóa API/schema, chốt capacity/WCET hoặc
đổi gate production sang GREEN cho tới khi các OD tương ứng có quyết định và
Verification có evidence hợp lệ.
