# Baseline interface Programming DDC-24 Rev A

**ID:** IFSPEC-PROG-001  
**Phiên bản:** 0.1  
**Trạng thái:** IN REVIEW — REQUIREMENT BASELINE ONLY  
**Nguồn:** IF-REQ-PROG-001, IF-REQ-PROG-002

## 1. Ranh giới tài liệu

Tài liệu khóa nghĩa dữ liệu và authority tối thiểu. Nó **không** phê duyệt URL,
transport, JSON schema, protobuf/SHM layout hoặc database schema. Graph/Modbus API
snapshot cũ không phải Programming API.

## 2. Contract I/O Mapping tối thiểu

| Nhóm trường | Nghĩa bắt buộc | Rule |
|---|---|---|
| Point identity | Stable ID và category | Chỉ Local Physical I/O, Virtual Point, Modbus RTU Point |
| Variable identity | Stable ID/name trong Program/Revision | Không suy từ Point name |
| Data contract | Type, direction, access, unit/range khi áp dụng | Validate compatibility trước deployable |
| Runtime state | Value, quality, source timestamp/freshness | Unknown/stale/bad không giả thành live |
| Mapping result | Valid/rejected cùng stable error | Sai identity/type/direction/access/category phải fail closed |
| Revision relation | Mapping thuộc đúng immutable Revision | Không sửa in-place sau Deployment |

Với Modbus RTU, ADR-024 mới hơn khóa mô hình Bus→Device→Point, một bus vật lý
(giữ `bus_id` mở rộng), Point capacity ≥256, `mkddc-core` sở hữu Point Table và
`mkddc-iobus` sở hữu Modbus Master. Các chi tiết schema còn phải qua Design.

## 3. Contract lifecycle tối thiểu

| Trường/khái niệm | Yêu cầu |
|---|---|
| `correlation` | Phân biệt request/retry/response, hỗ trợ idempotency được duyệt |
| `project/program/revision identity` | Nhất quán từ request tới runtime authority |
| `requested_action` | Validate, Deploy, Activate, Rollback là action riêng |
| `authority_state` | Accepted/rejected/timeout/active/failed không suy diễn ở client |
| `actor/time` | Đủ cho kiểm quyền và audit |
| `error` | Stable code, message/context an toàn, không chỉ HTTP/process success |
| `active_revision` | Chỉ runtime/lifecycle authority được xác nhận |

## 4. Contract Online Monitor tối thiểu

Mỗi sample/stream phải cho biết active Revision, Program/Variable/Point identity,
value/state, quality, source timestamp/freshness và authority. Reconnect không
được blind replay mutation. Monitor là read-only mặc định và không tự mở write,
force hoặc online change.

## 5. Enforcement tại mọi boundary

| Boundary | Phải reject |
|---|---|
| UI/authoring | Capability/Point/cycle ngoài allowlist |
| API/import | Payload unknown, graph legacy giả FBD, sai enum/category/cycle |
| Compiler/validator | Syntax/semantic/type/mapping invalid |
| Runtime loader | Artifact sai version/ABI/integrity/Revision/scope |
| I/O authority | Point sai category/access/quality contract |

## 6. Nội dung chưa phê duyệt

Endpoint/version/transport, schema cụ thể, size/rate limit, compatibility,
idempotency window, error catalog, monitor refresh/retention và write/force policy
chờ OD-PROG-001..014 cùng Interface Design review.
