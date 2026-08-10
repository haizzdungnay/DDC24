# ADR-027: Bootstrap Programming và quyền sở hữu chu kỳ scan

- Date: 2026-08-10
- Owner: System Architect (phê duyệt) · Core Lead (đề xuất)
- Status: **Proposed** — chờ System Architect ký; chưa ký thì `ARCH-CONF-PROG-002` còn mở
- Đóng xung đột: `ARCH-CONF-PROG-002` tại [`ARCH-PROG-001`](../03_architecture/PROGRAMMING_ARCHITECTURE.md) §11
- Related: [`DDD-CTRL-PROG-001`](../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md) §3 ·
  [`DDD-FWSOM-PROG-001`](../02_design/software/PROGRAMMING_FW_SOM_DESIGN.md) §4 ·
  [`OD-PROG-013`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) · [ADR-026](ADR-026-programming-runtime-profile-va-validator-duy-nhat.md)

## Vấn đề (1 câu)

Hiện `graph.json` quyết định chu kỳ của cả vòng scan và `StScheduler` chưa hề được
nối vào vòng đó, nên không có chỗ nào trong hệ thống định nghĩa “base step” tách
khỏi chu kỳ của bên đang sở hữu logic.

## Bối cảnh As-Built

```text
apps/core/bootstrap/main.cpp:80      period_ns = 1000000000ull;   /* scan 1s Rev A */
apps/core/bootstrap/main.cpp:198     period_ns = graph_ns;        /* graph.json ghi đè */
apps/core/bootstrap/main.cpp:348     loop.run(g_shutdown, period_ns, after_scan, &nctx);
apps/core/application/runtime/scan_loop.hpp:52   StScheduler* st_sched = nullptr;
apps/core/application/runtime/scan_loop.hpp:89   budget_ns_ = 1000000000ull;  /* = period */
```

Hai hệ quả trực tiếp:

1. **Chu kỳ scan là thuộc tính của graph**, không phải của nền tảng. Đổi
   `graph.json` là đổi nhịp của toàn bộ IOP, quality và safety service.
2. **`st_sched` mặc định `nullptr`.** Đường Programming chưa tồn tại lúc chạy, nên
   không thể nói “graph và Program dùng chung base step” — hiện chưa có base step
   nào độc lập để dùng chung.

Nếu Programming được nối vào mà giữ nguyên mô hình này, chu kỳ Task `30 s` sẽ trở
thành chu kỳ vòng scan và IOP đứt xa quá `200 ms` — đúng rủi ro `RSK-PROG-003`.

## Quyết định

1. **Base step thuộc nền tảng, không thuộc bên sở hữu logic.** `ScanLoop` nhận
   `base_step_ns` từ cấu hình nền tảng; giá trị Rev A là `1 s`, dải hợp lệ
   `500..2000 ms`, ràng buộc cứng `base_step ≤ 200 ms − biên IOP` không áp cho chu
   kỳ mà áp cho **thời gian giữa hai lần phục vụ IOP** trong step.
2. **`graph.json` mất quyền ghi đè chu kỳ vòng scan.** Trường `scan_ms` của graph
   trở thành *cadence dispatch của GraphRuntime*, đọc bởi graph, không truyền vào
   `loop.run(...)`. Migration: nếu `scan_ms` hiện có khác base step, bootstrap ghi
   cảnh báo và dùng base step; không im lặng đổi hành vi.
3. **Bootstrap luôn khởi tạo đúng một chủ sở hữu Local logic** theo state cutover
   (`GRAPH_ONLY` hoặc `PROGRAM_ONLY`, `ARCH-PROG-001` §6). Con trỏ của bên không
   được chọn giữ `nullptr` **có chủ ý** và `ScanLoop` phải coi `nullptr` là “bên
   này không sở hữu”, không phải “chưa cấu hình”.
4. **Không thêm tiến trình mới.** Programming coordinator, loader và staging chạy
   trong `mkddc-core` ở luồng non-RT (`DDD-FWSOM-PROG-001` §14), giữ nguyên ba
   tiến trình theo ADR-005/007.

## Phương án bị loại

| Phương án | Vì sao loại |
|---|---|
| Giữ graph sở hữu chu kỳ, Program tự chạy luồng riêng | Hai chủ sở hữu output trên cùng Point — vi phạm `SYS-REQ-PROG-105` |
| Đặt base step bằng chu kỳ Task nhỏ nhất (1 s) | Trói base step vào cấu hình người dùng; đổi Task thành 30 s là đứt IOP |
| Thêm daemon `mkddc-program-core` | Cần ADR mới về tiến trình; `ARCH-PROG-001` §10 cấm ở Rev A |

## Hệ quả

- `PROG-300` (Core base step) phải đổi chữ ký `ScanLoop::run` và điểm đọc cấu hình;
  đây là thay đổi **có ảnh hưởng tới graph đang chạy**, nên phải có bước migration
  và ca kiểm “graph cũ, base step mới” trước khi bật Programming.
- Deploy order bắt buộc: Core hỗ trợ base step mới nhưng vẫn `GRAPH_ONLY` → chạy
  soak → mới bật đường Programming.
- Rollback: giữ khả năng đọc `scan_ms` cũ trong một release chuyển tiếp.

## Điều kiện xác minh trước khi chuyển `Accepted`

| Điều kiện | Bằng chứng |
|---|---|
| `OD-PROG-013` (quan hệ graph ↔ Program) đã ký | decision record |
| Soak `GRAPH_ONLY` với base step mới không đổi hành vi | `VS-PROG-015` + số đo jitter trên target |
| `max_iop_poll_gap < 200 ms` khi Task 30 s đến hạn | `VS-PROG-014` trên HIL |

## Chữ ký

| Vai trò | Trạng thái | Ngày |
|---|---|---|
| System Architect | **PENDING** | — |
| Core Lead | Đề xuất | 2026-08-10 |
| Safety Reviewer | **PENDING** | — |
