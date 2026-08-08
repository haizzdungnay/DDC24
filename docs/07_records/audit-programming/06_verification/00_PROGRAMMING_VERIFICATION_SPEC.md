# Đặc tả kiểm chứng Programming DDC-24 Rev A

**ID:** VER-PROG-001  
**Phiên bản:** 1.0  
**Trạng thái requirement:** ACTIVE  
**Trạng thái kết quả:** RED / NO-GO  
**Ngày baseline:** 2026-08-08

## 1. Quy tắc evidence

Kết quả chỉ được chuyển `PASS` khi record ghi build/Revision, production target,
cấu hình/tải, procedure, expected/actual, raw log/artifact, timestamp và reviewer.
Host unit test được ghi supporting evidence nhưng không thay target/HIL/E2E được
yêu cầu. Không dùng số đo cũ để claim lần chạy mới.

## 2. Verification Requirement

| ID | Đối tượng | Phương pháp/acceptance | Evidence bắt buộc | Baseline |
|---|---|---|---|---|
| VR-PROG-001 | Scope Product/Requirement | Inspection UI/API/import/runtime chỉ lộ allowlist và không claim certification | Review record + negative inventory | RED — docs pass, production chưa có |
| VR-PROG-002 | Project/Program/Revision | Round-trip, nhiều Program theo capacity approved, immutable identity/actor | API/UI test + persistence diff | RED |
| VR-PROG-003 | Point/Variable/I/O Mapping | Positive/negative cho ba Point category trên production path | Target integration/HIL + authority logs | RED |
| VR-PROG-004 | ST production | Revision → production runtime → I/O/monitor đúng golden scenario | Target binary/hash/log/measurement | RED |
| VR-PROG-005 | FBD production | Cùng target/semantic với ST; lỗi block/connection/type và golden scenario | FE/compiler/runtime E2E | RED |
| VR-PROG-006 | Cycle | Đo 1/5/30 s, jitter/WCET/overrun/fault; reject cycle khác | Target benchmark + raw timing | RED |
| VR-PROG-007 | Revision/Deployment | Identity, validate-before-deploy, ACK/reject/timeout, không false-success | FE–BE–runtime correlation log | RED |
| VR-PROG-008 | Activation/Rollback | Cyclic boundary; corrupt/timeout/power-loss giữ bản cũ; rollback tương thích | Fault injection + power-cycle evidence | RED |
| VR-PROG-009 | RETAIN | Warm/cold/power/revision/type/corrupt/non-RETAIN theo policy | Target persistence matrix | RED |
| VR-PROG-010 | Online Monitor | UI/API khớp runtime, timestamp/quality/stale; client loss không ảnh hưởng control | UI/API/runtime synchronized capture | RED |
| VR-PROG-011 | RBAC/audit | Positive/negative từng action; bypass/replay/idempotency/timeout | Security integration + audit records | RED |
| VR-PROG-012 | Continuity/fault | Mất FE/Web/authority phụ, Point bad, overrun; không uncontrolled output/false-success | Fault matrix + output capture | RED |
| VR-PROG-013 | Negative scope | UI/API/import/runtime từ chối LD/SFC/TCP/BACnet/motion/safety | Automated negative E2E + runtime logs | RED |

## 3. Gate

| Gate | Điều kiện | Hiện tại |
|---|---|---|
| G0 Product/Requirement | Scope và trace documented | DOCUMENTED, chưa phải production pass |
| G1 Design | OD chặn đóng, design/interface/security approved | RED |
| G2 Component | Unit/integration sạch theo component | Một phần, không đủ scope |
| G3 Production target/HIL | ST+FBD+3 Point+3 cycle+lifecycle/RETAIN/monitor | RED |
| G4 Release | 13 VR pass, evidence review, không P0 open | RED / NO-GO |

Production evidence đạt tại baseline: **0/13**.
