# Kiến trúc runtime Programming — đề xuất normative v2.2

| Thuộc tính | Giá trị |
|---|---|
| ID | `ARCH-PROG-002` |
| Phiên bản | 0.1 |
| Trạng thái | `PROPOSED NORMATIVE / IN REVIEW — NOT APPROVED` |
| Nguồn thiết kế | Product v2.2 §14.3/14.6/16.7/26 |
| Blocker | OD-PROG-012, OD-PROG-013, OD-PROG-014, OD-PROG-015; CONF-PROG-015, CONF-PROG-016 |

## Mục lục

1. Cách đọc normative
2. Quyết định A: base control step tách Task period
3. Quyết định B: cutover fail closed
4. Quyết định C: resource isolation
5. Failure containment
6. Acceptance và evidence
7. Thuật ngữ
8. Lịch sử và phê duyệt

## 1. Cách đọc normative

Trong candidate design này, từ “phải” là ràng buộc đối với thiết kế được đề
xuất. Nó chưa cho phép sửa code/config/systemd hoặc phê duyệt production trước
khi blocker đóng.

## 2. Quyết định A — base control step tách Task period

Runtime phải có base control step bounded, độc lập Task period `1/5/30 s`:

```text
base step bắt đầu
  → poll/capture coherent input
  → dispatch Task nếu đến hạn
  → stage/arbitrate/safety/commit
  → publish bounded state
base step hoàn tất
  → WATCHDOG=1
```

Task period không được dùng làm sleep/chờ của `ScanLoop::step()`. Task 30 s chỉ
quyết định kỳ dispatch, không kéo dài một step thành 30 s. Runtime/config phải
thỏa:

```text
WatchdogSec >= 2 × max_base_step_period + WCET_step_target + 1 s
```

Với `WatchdogSec=6` hiện hành, chỉ được accept config khi measured base-step
period/WCET còn thỏa unit. Nếu implementation để Task 30 s chi phối step thì
bound tối thiểu vượt `61 s`; unit 6 s phải reject config, không được Commission.
Mâu thuẫn với công thức “Task lớn nhất” của scheduler spec là
`CONF-PROG-015`, chưa resolved.

## 3. Quyết định B — cutover fail closed

| State | Owner Local logic mức 5 | Hành vi |
|---|---|---|
| `GRAPH_ONLY` | Graph legacy | Không Commission Programming |
| `PROGRAM_ONLY` | Programming package | Graph không execute/không sở hữu scan period |
| `DUAL_INVALID` | Không đổi owner | Reject `PRG-ERR-CUTOVER-001`, giữ LKG, không mix output |

Cutover lần đầu phải có migration/check, backup graph, confirmation, rollback
plan và compatibility check. Không được chuyển owner nếu base-step/watchdog,
IOP poll continuity, mapping hoặc LKG recovery chưa đạt.

## 4. Quyết định C — resource isolation

Compiler/Check phải chạy ngoài RT path và có profile được phê duyệt để không
tranh CPU/memory/I/O với `mkddc-core`/`mkddc-iobus`. Evidence phải ghi:

- scheduling policy/priority/cpuset hoặc cgroup profile thực;
- CPU/memory/I/O limit và worst-case Check workload;
- base-step jitter/WCET, watchdog cadence và `max_iop_poll_gap`;
- không task overrun do engineering load, không nuisance plant safe-state.

Cấu hình lab core `SCHED_OTHER` cùng web chưa giới hạn CPU chỉ là AS-BUILT lab,
không phải evidence production và không được dùng làm acceptance profile.

## 5. Failure containment

1. Ba overrun liên tiếp chỉ fault/degrade đúng Task và giữ last valid mức 5 hoặc
   fail policy của binding.
2. Plant safe-state chỉ do SafetyManager condition độc lập đã phê duyệt như mất
   I/O freshness/interlock/không hoàn tất base step.
3. Activation/Restore không restart iobus; `max_iop_poll_gap <200 ms`, mục tiêu
   acceptance `<=100 ms`.
4. Compiler/Check failure không thay Active/LKG và không chặn base-step.
5. Watchdog restart/power loss phải phục hồi theo LKG/RETAIN policy đã duyệt.

## 6. Acceptance và evidence

`VS-PROG-012..015` và `VS-PROG-030` phải chạy trên board/HIL, gồm concurrent
worst-case Check, Task 1/5/30 s, dual-run request, IOP gap, watchdog cadence và
restart detection. Trạng thái hiện tại: `MISSING / VR RED`.

## 7. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 8. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo ba quyết định candidate normative từ proposal v2.2. |

Sign-off: Product `PENDING`; Runtime Architecture `PENDING`; Controls/Safety `PENDING`; Operations `PENDING`; Verification `PENDING`.
