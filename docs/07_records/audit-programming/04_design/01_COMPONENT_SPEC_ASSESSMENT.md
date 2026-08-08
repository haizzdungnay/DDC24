# Đánh giá tài liệu thiết kế component và legacy

**ID:** DES-PROG-ASSESS-001  
**Phiên bản:** 1.0  
**Ngày:** 2026-08-08  
**Loại:** Audit record

| Nhóm nguồn archive | Phân loại chuẩn | Có thể dùng | Không được dùng để claim |
|---|---|---|---|
| ADR-020/023 | Accepted architecture/product decision | Constraint ST+FBD, artifact, scope | Implementation complete |
| Draft `PROGRAM_SOM_FW...` | Draft/historical candidate | Ý tưởng pipeline/runtime/lifecycle | Tên process/path hoặc design approved |
| `ST_SUBSET_SPEC...` | Component baseline/candidate | Parser/type/library foundation | Product type/library đã khóa |
| `PROGRAM_TASK_SCHEDULER_SPEC...` | Component baseline/candidate | Internal tick/task/boundary ideas | Product cycle/capacity approved |
| `TYPED_IR_ARTIFACT_SPEC...` | Component baseline/candidate | Artifact structure/integrity | Production activation path hoàn tất |
| `SW_RUNTIME_EXECUTION_MODEL...` | Legacy graph runtime | Migration/reuse analysis | FBD implementation |
| `GRAPH_SCHEMA...` + Plan 23 | Legacy graph | Input OD-PROG-013 | Programming schema/FBD |
| Modbus RTU design/interface/API | Dependent design, một phần superseded | RTU Point contract input | Hai bus/64 Point hoặc full I/O Mapping complete |
| `SOFTWARE.md`, `INTERFACES.md` | Boundary authority mới hơn | Ngăn overclaim, giữ design status | Design detail đã tồn tại |
| Handoff/review/archive plans | Historical record | Timeline/finding/source evidence | Current baseline/readiness |

## Quyết định dọn dữ liệu

- Không xóa 33 nguồn; chuyển toàn bộ vào archive và bảo vệ checksum.
- Không copy bảng capacity/cycle/type/library từ component spec sang Product Spec.
- Không dùng graph endpoint/schema làm Programming interface baseline.
- Không sửa conflict bằng cách biên tập raw snapshot; cách đọc chuẩn nằm trong
  Conflict Register và tài liệu baseline có ID mới.
- Khi Design được phê duyệt, candidate được chọn phải có trace tới requirement,
  ADR quyết định và verification tương ứng.
