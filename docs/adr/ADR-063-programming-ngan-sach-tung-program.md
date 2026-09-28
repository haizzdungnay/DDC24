# ADR-063 — Ngân sách thời gian từng Program: đưa `budget_us` tới instance, so với thời gian thực thi đã đo, quy lỗi vượt ngân sách về đúng Program

**Trạng thái:** **Proposed** — Change Request của task T63-302 (Plan 63), chờ cổng **G-D2** (Product + Architect) trên Issue [#809](https://github.com/Mekong-HCM/MK-DDC-24/issues/809). Chưa có hiệu lực. T63-303 giữ `BLOCKED(G-D2)` tới khi có comment `GATE G-D2: APPROVED` hoặc `REJECTED`.
**Ngày:** 2026-09-28
**Người đề xuất:** `implementer-20260928T0536Z` (leader Plan 63, vai Architect + Programming Runtime theo Plan 63 §4.4).
**Người quyết định:** Product + Architect tại G-D2. Ghi vào [Decision Log](../00_governance/DECISIONS.md) chỉ khi được duyệt.
**Liên quan:** [ADR-061](ADR-061-programming-chu-ky-10ms-bo-chu-ky-moi.md) §4.3 (ngân sách base step), [ADR-029](ADR-029-programming-overrun-la-task-fault.md) (overrun là fault của Task), ADR-054 (ST Rev A không có vòng lặp), `OD-PROG-012` ([SRS](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md) dòng 209), finding `F-PRG-PERF-001`, finding [#815](https://github.com/Mekong-HCM/MK-DDC-24/issues/815).
**Không supersede:** nếu duyệt phương án khuyến nghị, ADR này **giữ nguyên điều kiện kích hoạt** của `OD-PROG-012` (3 overrun liên tiếp của Task) và chỉ **thu hẹp tập Program bị FAULT** khi xác định được Program gây ra.

## 1. Bối cảnh As-Built (`main@2e53d4a0`)

| Tầng | Hiện trạng | Nguồn |
|---|---|---|
| Check | `budgetUs` từng Program = `(2.000 − 1) / số Program`, cùng một trần cho mọi lớp chu kỳ; `budget.source = PROFILE_CEILING`. Không ước lượng WCET | `apps/web-api/internal/programming/application/checks_topology.go:92-100` |
| Package v2 | Ghi và đọc `program_budget_us` theo từng Program | `apps/core/application/st/st_package_v2.cpp:800-816`, `st_package_v2.hpp:155` |
| Coordinator | `PackageProgramSlice {instance_id, ir_blob, period_ms}`. `budget_us` bị bỏ ở đây | `apps/core/application/programming/programming_runtime_coordinator.hpp:156-160` |
| Scheduler | `StProgramSetEntry {instance_id, artifact, order, period_ms, enabled}`: không có ngân sách | `apps/core/application/st/st_scheduler.hpp:386-392` |
| Đo từng Program | **Đã có.** `run_program` đo `last_exec_ns`/`max_exec_ns` trên đường thành công; API `programs` trả `lastExecNs`/`maxExecNs` | `st_scheduler.cpp:1038-1039` |
| Xử lý vượt ngân sách | Chỉ ở cấp Task: `monitor_.record(exec_ns, budget_us)`; 3 lần liên tiếp thì **mọi** Program RUNNING/WAITING của Task chuyển `FAULTED` với `ST-RT-010` | `st_scheduler.cpp:1141-1167`, `st_diagnostic.hpp:67` |
| Task `main` production | chu kỳ 10 ms, `budget_us = 1.999`, `overrun_threshold = 3` | `apps/core/bootstrap/main.cpp:700-711` |
| Ngôn ngữ | ST Rev A từ chối FOR/WHILE/REPEAT (ADR-054), nên số instruction thực thi ≤ cận tĩnh của compiler (tính cả POU inline, trần 4.096/Program, `ST-POU-004`) | `contracts/programming/st_grammar_corpus_v1.json` |

## 2. Số đo làm đầu vào

| Nguồn | Mức | Số đo |
|---|---|---|
| T63-301, [evidence §6](../07_records/test-evidence/fw-som/forlinx-perf-remediation-20260928/README.md) | HOST x86 | 1 × 4.095 instruction: 42,0 µs (≈ 10,3 ns/instruction). 16 × 301: p50 50,8 / p95 63,4 / max 81,2 µs; `budgetUs` 124/Program. 16 × 4.095: Check từ chối vì #815 |
| Record 04/09 §3.1 (bo khi đó bị xâm nhập) | TARGET exploratory | 16 × 4.095 tuần tự: mean 2.002 / 2.050 µs, p99 2.248 / 2.286 µs, max 3.008 / 2.494 µs ⇒ ≈ 30,6–31,3 ns/instruction mean, ≈ 34,3–34,9 p99 |
| T63-301 trên bo sạch | TARGET | **NOT_RUN** — cần đường tới bo và cần #815 được sửa |

Hệ quả: ở 16 × 4.095 instruction, Task `main` vượt 1.999 µs ở mọi base step và
chuyển `FAULTED` sau khoảng 30 ms, kéo theo cả 16 Program. Kịch bản này hôm nay
chỉ **bị che** bởi #815 (Check hỏng khi package vượt ≈ 5.200 instruction), không
bị chặn có chủ ý.

## 3. Khoảng trống

| Mã | Khoảng trống |
|---|---|
| G1 | `budget_us` không đi tới instance (dừng ở loader) |
| G2 | Đã đo thời gian từng Program nhưng không so với ngân sách của chính Program đó |
| G3 | Vượt ngân sách luôn làm FAULT **cả Task**: một Program nặng kéo mọi Program nhẹ dừng, và người vận hành không biết Program nào gây ra |
| G4 | Check chỉ chia trần, không ước lượng WCET, nên package chắc chắn vượt ngân sách vẫn qua Check |
| G5 | #815 che G1–G4. Sửa #815 trước ADR này sẽ mở lại đúng kịch bản `F-PRG-PERF-001` |

## 4. Quyết định cần duyệt

### Q1 — Đường đi `budget_us` (bắt buộc, không có phương án thay thế)

`StPackageV2::program_budget_us[i]` → `PackageProgramSlice.budget_us` →
`StProgramSetEntry.budget_us` → `StProgramInstance.budget_us`. Gói legacy có
`budget_us = 0` nghĩa là "không có ngân sách riêng": Program đó không bao giờ bị
quy lỗi riêng, hành vi giữ như hôm nay. Không đổi định dạng package (trường đã có).

### Q2 — Program vượt ngân sách riêng thì xử lý thế nào

| Phương án | Mô tả | Được | Mất |
|---|---|---|---|
| B1 — Chỉ quan sát | Đếm `budgetOverrunCount`/`consecutiveBudgetOverruns`, health `DEGRADED` (`BUDGET_OVERRUN`); luật FAULT cả Task giữ nguyên | Không đổi ngữ nghĩa runtime; rủi ro thấp nhất | G3 còn nguyên: 1 Program nặng vẫn dừng 15 Program khác |
| **B2 — Quy lỗi (khuyến nghị)** | Như B1, cộng thêm: khi Task kích hoạt `OD-PROG-012` (3 overrun liên tiếp), chỉ FAULT các Program **đang vượt ngân sách riêng** ở lần release gần nhất, mã mới `ST-RT-014`; không xác định được Program nào thì FAULT cả Task như hôm nay (`ST-RT-010`) | Giữ nguyên điều kiện kích hoạt và dấu thời gian; Program nhẹ tiếp tục điều khiển; người vận hành thấy đúng Program gây lỗi | Đổi **tập** Program bị FAULT so với ADR-029 §1 — phải duyệt ở G-D2 |
| B3 — Cô lập độc lập | Program vượt ngân sách riêng 3 lần liên tiếp thì tự FAULT, dù Task còn dư | Cô lập mạnh nhất | FAULT cả khi không có tác hại nhịp (Task còn dư thời gian), tức dừng logic điều khiển vô cớ; đổi luôn điều kiện kích hoạt `OD-PROG-012` |
| B4 — Ngắt giữa chừng | Executor đếm instruction và dừng Program khi hết ngân sách | Chặn trước khi Task trễ | Thêm phép đếm vào vòng thực thi nóng; trạng thái Program dở dang; phức tạp hoá ngữ nghĩa staging của ADR-029. Loại |

Chi tiết B2:

1. Program chạy thành công và `budget_us > 0`: nếu `last_exec_ns > budget_us × 1000`
   thì `budget_overrun_count++` và `consecutive_budget_overruns++`; nếu không thì
   `consecutive_budget_overruns = 0`. Đường WAIT/fault không đo nên không đổi hai bộ
   đếm này.
2. Task **không** overrun: Program vượt ngân sách riêng chỉ được đếm và kéo health
   xuống `DEGRADED`, **không** FAULT, vì base step còn dư nên không có tác hại nhịp.
3. Task kích hoạt `OD-PROG-012`: `F = {Program RUNNING/WAITING của Task có
   consecutive_budget_overruns ≥ 1}`.
   - `F ≠ ∅`: chỉ Program trong `F` chuyển `FAULTED` với `ST-RT-014`, đầu ra
     hold-last theo ADR-029 §2 và ADR-051. Reset monitor Task. Program ngoài `F`
     chạy tiếp ngay base step kế tiếp.
   - `F = ∅` (mọi Program trong phần của mình nhưng Task vẫn trễ, ví dụ chi phí
     scheduler, hoặc gói legacy `budget_us = 0`): FAULT cả Task như hôm nay (`ST-RT-010`).
4. Program trong `F` nhận lại quyền chạy bằng đúng đường phục hồi fault hiện hành
   (không thêm đường tự phục hồi).

### Q3 — Admission ở Check

| Phương án | Mô tả | Khuyến nghị |
|---|---|---|
| C1 | Giữ chia trần như hôm nay | Không: G4 còn nguyên |
| **C2** | Check ước lượng `estimatedStepUs = Σ instrBound_i × targetExecNsPerInstructionP99 / 1000` trên mọi Program có thể Enable (mọi chu kỳ trùng nhau ở siêu chu kỳ 50 s). Nếu `> stepBudgetUs` thì chẩn đoán **WARNING** `ST-SCHED-002` kèm con số, và thêm cảnh báo từng Program khi `estimate_i > budgetUs_i`. Check vẫn `PASSED` | **Có**, giai đoạn 1. `instrBound` lấy từ `usage.instructions` mà compiler đã tính. Hệ số ban đầu **35 ns** lấy từ p99 04/09 (≈ 34,9), ghi nguồn trong profile |
| C3 | Như C2 nhưng là **ERROR** chặn Check | Chưa: số 04/09 đo trên bo bị xâm nhập. Nâng lên ERROR khi T63-301 TARGET trên bo sạch cho hệ số mới, và phải duyệt riêng |

C2 thêm trường profile `targetExecNsPerInstructionP99`. Theo luật ADR-061, trường
này đi **cùng commit** với schema, validator và pin hợp đồng.

### Q4 — Thứ tự với #815

Khuyến nghị: bản sửa #815 (cho Check nhận package > 1 MiB) **không merge trước**
T63-303 (B2 + C2), hoặc phải cùng một release. Nếu không, cấu hình 16 × 4.095 qua
được Check trong khi runtime vẫn chỉ có FAULT cả Task và không có cảnh báo nào.

## 5. Hợp đồng bị ảnh hưởng (nếu duyệt Q1 + B2 + C2)

| Hợp đồng | Thay đổi | Tương thích |
|---|---|---|
| Package v2 | Không đổi | — |
| IPC `programming_v1` STATUS / `point_snapshot` | Mỗi Program thêm `budget_us`, `budget_overrun_count`, `consecutive_budget_overruns` | Additive; web cũ bỏ qua khoá lạ |
| OpenAPI `ProgrammingProgramListItem` | Thêm `budgetUs`, `budgetOverrunCount`, `consecutiveBudgetOverruns` (nullable, luôn có mặt theo quy ước của schema); `healthReasons` thêm `BUDGET_OVERRUN` | Additive; `null` = Core đời cũ không cấp |
| Mã chẩn đoán | `ST-RT-014` (Program bị quy lỗi vượt ngân sách riêng khi Task overrun), `ST-SCHED-002` (WARNING ước lượng WCET vượt ngân sách) | Thêm vào catalog lỗi và re-pin G1 join |
| Product profile | `targetExecNsPerInstructionP99` (C2) | Additive; profile sha đổi nên tool ST phải deploy cùng web (DEPLOY_FOXLINX bước 2b) |
| Tài liệu | SRS dòng `OD-PROG-012`, `DDD-CTRL-PROG-001` §9, `PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN` | Cập nhật trong commit T63-303 |

## 6. Thuật toán cho T63-303

```text
run_program(p):                       # đã đo last_exec_ns trên đường thành công
    ...
    if ok:
        p.last_exec_ns = clock() - start
        if p.budget_us > 0 and p.last_exec_ns > p.budget_us * 1000:
            p.budget_overrun_count += 1
            p.consecutive_budget_overruns += 1
        else:
            p.consecutive_budget_overruns = 0

run_task(t):
    ...                               # đo exec_ns cả Task như hiện tại
    t.monitor.record(exec_ns, t.budget_us * 1000)
    if t.monitor.should_force_safe():
        attributed = 0
        for p in t.programs:          # duyệt tại chỗ, không cấp phát
            if p.state in (RUNNING, WAITING) and p.consecutive_budget_overruns >= 1:
                fault(p, "ST-RT-014"); attributed += 1
        if attributed == 0:
            for p in t.programs if p.state in (RUNNING, WAITING):
                fault(p, "ST-RT-010")  # hành vi hiện tại
        t.monitor.reset_consecutive()
```

Ràng buộc RT: không cấp phát, không khoá, không đọc đồng hồ thêm (dùng lại số đo
đã có), vài phép so nguyên mỗi Program. Lane song song: mỗi Program thuộc đúng một
lane trong một tick; bộ đếm ghi trên lane đó và được đọc sau khi `run_task` trộn
kết quả theo số hiệu lane như hiện nay.

## 7. Kiểm chứng cho T63-303

| ID | Kiểm | Kỳ vọng |
|---|---|---|
| V1 | Round-trip package có `budget_us` [a, b] → coordinator → instance | instance mang đúng a, b |
| V2 | Gói legacy `budget_us = 0`, Task overrun 3 lần | FAULT cả Task `ST-RT-010`; mọi test overrun hiện có giữ nguyên |
| V3 | Đồng hồ giả, P1 vượt ngân sách riêng, P2 trong ngân sách, Task overrun 3 lần | Chỉ P1 `FAULTED` `ST-RT-014`; P2 vẫn chạy ở base step kế tiếp |
| V4 | Cả hai trong ngân sách riêng, Task vẫn overrun (tiêm chi phí ngoài Program) | FAULT cả Task `ST-RT-010` |
| V5 | P1 vượt ngân sách riêng, Task không overrun | P1 đếm tăng, health `DEGRADED` (`BUDGET_OVERRUN`), không FAULT |
| V6 | Probe cấp phát trên đường `run_task` | 0 cấp phát |
| V7 | Check 16 × 4.095 (sau #815) và 16 × 301 | Lần lượt có và không có WARNING `ST-SCHED-002`, kèm con số |
| V8 | T63-301 chạy lại trên bo | Hành vi đúng quyết định G-D2; ghi thời điểm FAULT và Program bị FAULT |

Mỗi test phải đỏ khi bỏ bản sửa.

## 8. Rollback

Rollback mã đưa hệ về FAULT cả Task. Package không đổi định dạng nên gói Active
nạp được theo cả hai chiều. Trường API mới nullable nên FE cũ và mới đều đọc được.
Nếu C2 đã đổi profile thì rollback web phải kèm tool ST cùng profile (DEPLOY_FOXLINX
bước 2b).

## 9. Câu hỏi cần ký tại G-D2

1. **Q2:** chọn B2 (khuyến nghị), B1 hay B3?
2. **Q3:** chọn C2 (WARNING, hệ số ban đầu 35 ns/instruction), C1 hay C3?
3. **Q4:** đồng ý thứ tự: sửa #815 không merge trước T63-303?
4. Hai mã chẩn đoán mới `ST-RT-014`, `ST-SCHED-002` và trường profile `targetExecNsPerInstructionP99`.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-28 | Tạo CR (T63-302) từ đối chiếu mã tại `main@2e53d4a0` và số đo T63-301 HOST; Proposed, chờ G-D2 |
