# Đặc tả kiểm chứng Programming DDC-24 Rev A

| Thuộc tính | Giá trị |
|---|---|
| ID | `VER-PROG-001` |
| Phiên bản | 2.0 controlled copy |
| Trạng thái requirement | `ACTIVE` |
| Trạng thái kết quả | `RED / NO-GO` |
| Production evidence | `0/13 PASS` |

## Mục lục

1. Quy tắc evidence
2. Verification Requirement
3. Gate G0..G7
4. Scenario catalog
5. Thuật ngữ
6. Lịch sử và phê duyệt

## 1. Quy tắc evidence

PASS cần build/Revision, production target, config/load, procedure, expected/
actual, raw artifact, timestamp và reviewer. Host test chỉ supporting evidence.
Trace/docs không đổi trạng thái RED.

## 2. Verification Requirement

| ID | Acceptance authority | Evidence bắt buộc | Trạng thái |
|---|---|---|---|
| VR-PROG-001 | UI/API/import/runtime chỉ lộ allowlist, không claim certification. | Review + negative inventory | RED |
| VR-PROG-002 | Project/Program/Revision round-trip, immutable identity/actor/capacity approved. | API/UI + persistence diff | RED |
| VR-PROG-003 | Mapping positive/negative ba Point category trên production path. | Target integration/HIL + authority logs | RED |
| VR-PROG-004 | ST Revision→runtime target→I/O/monitor golden scenario. | Target binary/hash/log/measurement | RED |
| VR-PROG-005 | FBD cùng target/semantic ST; negative block/connection/type. | FE/compiler/runtime E2E | RED |
| VR-PROG-006 | Đo 1/5/30 s, jitter/WCET/overrun/fault; reject cycle khác. | Target benchmark + raw timing | RED |
| VR-PROG-007 | Revision/Deployment identity, validate-before-deploy, ACK/reject/timeout. | FE–BE–runtime correlation | RED |
| VR-PROG-008 | Activation/Rollback boundary; corrupt/timeout/power-loss giữ bản cũ. | Fault injection + power cycle | RED |
| VR-PROG-009 | RETAIN warm/cold/power/revision/type/corrupt/non-RETAIN. | Target persistence matrix | RED |
| VR-PROG-010 | Monitor khớp runtime/timestamp/quality/stale; client loss không ảnh hưởng control. | Synchronized UI/API/runtime capture | RED |
| VR-PROG-011 | RBAC/audit positive/negative/bypass/replay/idempotency/timeout. | Security integration + audit | RED |
| VR-PROG-012 | Fault/local continuity, không uncontrolled output/false-success/replay. | Fault matrix + output capture | RED |
| VR-PROG-013 | UI/API/import/runtime từ chối LD/SFC/TCP/BACnet/motion/safety. | Automated negative E2E + logs | RED |

## 3. Gate G0..G7

| Gate | Điều kiện tóm tắt | Hiện tại |
|---|---|---|
| G0 Product/Design approval | OD/sign-off/trace approved | RED / NOT STARTED |
| G1 Compiler/FBD contract | ST/FBD/IR/source-map/loader/keyboard contract | RED / NOT STARTED |
| G2 Deterministic runtime | Task/base-step/watchdog/isolation/arbitration/IOP | RED / NOT STARTED |
| G3 Point engineering | Mapping/Core Library/User FB/bundle | RED / NOT STARTED |
| G4 Secure commissioning | Immutable hash/Check/Commission/LKG/Restore/source-only import | RED / NOT STARTED |
| G5 UI/UX | IA/persona/state/a11y/no fake data/diagnostic-alarm | RED / NOT STARTED |
| G6 HIL/Board | 30 scenario theo target flag, đặc biệt control safety | RED / NOT STARTED |
| G7 Release | 13 VR PASS, P0/P1 đóng, docs/source/evidence khớp | RED / NOT STARTED |

## 4. Scenario catalog

Catalog duy nhất là [VS-PROG-001..030](01_VERIFICATION_SCENARIOS.md). Product/UX/
Feature/Trace chỉ tham chiếu ID, không duy trì danh sách E2E riêng.

## 5. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 6. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Chuẩn hóa 13 VR, kết quả RED. |
| 2.0 | 2026-08-09 | Giữ 13 VR RED; bổ sung G0..G7 và chuyển scenario sang catalog duy nhất. |

Sign-off: Verification Lead `PENDING`; Product `PENDING`; Architecture `PENDING`; Controls/Safety `PENDING`; UX `PENDING`.
