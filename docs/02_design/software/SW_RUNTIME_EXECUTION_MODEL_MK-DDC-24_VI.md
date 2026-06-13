# Runtime Execution Model — MK-DDC-24 (`mkddc-core`)

> **Document ID:** DDD-RUNTIME-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-13 (reconcile S7 #4: chỉ node persist lưu state, cycle delay-1 lùi Rev B) · 1.0 | 2026-06-08
> **Trạng thái:** Approved (Owner 2026-06-08)
> 📘 **Đọc cùng:** [GRAPH_SCHEMA](../interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) ·
> [SW_COMPONENT_LIBRARY](SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md) · [ADR-004](../../adr/ADR-004-component-based-runtime.md), [ADR-005](../../adr/ADR-005-three-process-architecture.md)
> **Ngôn ngữ:** C++17 · **Trace:** `RUN-001..` (thay `PLC-001..023` cũ)

> ⚠️ Tài liệu này thay mô hình thực thi IEC 61131-3 trong `SW_PLC_ENGINE_DESIGN` (đã xóa 2026-06-08, xem git history).

---

## 1. Mục tiêu

`mkddc-core` nhận `graph.json`, biên dịch thành **execution plan** (mảng phẳng đã sắp
thứ tự), rồi chạy plan mỗi chu kỳ scan với độ trễ ổn định, an toàn khi mất điện / mất
kết nối field.

## 2. Vòng đời

```
LOAD graph.json ─► VALIDATE (web đã làm; core kiểm lại tối thiểu) ─►
BUILD PLAN (topo-sort) ─► INIT STATE (snapshot/power_on) ─► RUN (scan loop) ◄─┐
                                                              └──── deploy mới ─┘ (atomic swap)
```

## 3. Build plan — topological sort (1 lần lúc deploy)

- Dựng đồ thị có hướng từ `links`. Sắp thứ tự topo → mảng node thực thi.
- **Rev A.1:** execution graph phải **acyclic**; mọi cycle đều build fail. Stateful node
  (PID/timer/counter/interlock) giữ state nội bộ, nhưng không tạo cạnh delayed trong graph.
- **Rev B:** cycle đi qua stateful node có thể được mở lại bằng cạnh `delayed` (đọc giá trị
  scan trước). Cycle thuần combinational luôn build fail.
- Plan bất biến trong khi chạy; runtime **không** sort lại mỗi scan.

## 4. Chu kỳ scan (mô hình ảnh I/O)

```
mỗi scan (device.scan_ms, mặc định 1000ms):
  1. SNAPSHOT INPUTS  : copy IO image (từ IOP/MCU shm) + Modbus cache + BACnet cmd
                        → vùng "current". Đọc 1 lần, không đọc giữa chừng.
  2. EXECUTE PLAN     : chạy node theo thứ tự topo; Rev A.1 không có cạnh delayed
  3. RESOLVE PRIORITY : mọi output AO/DO qua priority resolver (§7)
  4. WRITE OUTPUTS    : ghi AO/DO → IOP shm; ghi Modbus write-queue; update BACnet object
  5. HOUSEKEEPING     : cập nhật stateful node, COV, trend; đo scan time; swap prev=current
```

- `mkddc-core` chạy **SCHED_FIFO**; scan định thời bằng `clock_nanosleep(TIMER_ABSTIME)`.
- Mục tiêu Rev A: jitter chấp nhận được ở 1 s; **không** cam kết sub-100ms (Rev B).

## 5. Stateful node & giới hạn cycle Rev A.1

- Node có nội trạng (PID integrator, OnDelay/OffDelay accumulator, RuntimeCounter,
  Latch) giữ state trong struct riêng của instance.
- Rev A.1 không cho phép wire vòng kín trong graph; mọi feedback cần được biểu diễn bằng
  state nội bộ của component (ví dụ Interlock latch, PID integral, OnDelay accumulator).
- Delay-1-cycle edge là tính năng Rev B; validator/build hiện reject mọi cycle.
- Đơn vị thời gian cho timer = bội số `scan_ms`; node lưu thời điểm bằng monotonic clock.

## 6. Quản lý state & power-loss recovery

| Cơ chế | Quy tắc |
|--------|---------|
| Lưu state | Chỉ snapshot node có cờ persist ra `/data/mkddc/state.snap`: Rev A.1 chỉ `RuntimeCounter` và `PulseCounter`. Ghi **mỗi 60 s khi dirty** + shutdown sạch + trước graph swap. **KHÔNG ghi mỗi scan**. |
| Khôi phục | Boot/deploy: nếu snapshot hợp lệ và node `id + type` khớp → restore counter. Node thiếu/lệch type hoặc snapshot hỏng → init mặc định + WARN. Không restore PID/timer/interlock. |
| Output an toàn | Trước khi plan chạy lần đầu sau boot/deploy, mọi output AO/DO = `power_on` (graph.json) — không bao giờ giữ giá trị rác. |
| Atomic | Snapshot ghi ra file tạm rồi `rename()` (atomic), tránh file nửa vời. |

Format snapshot Rev A.1:

```json
{
  "version": 1,
  "saved_at_ms": 1780000000000,
  "nodes": {
    "fan1_rt":  { "type": "RuntimeCounter", "run_seconds": 123456.7 },
    "kwh_main": { "type": "PulseCounter",   "count_raw": 884213 }
  }
}
```

## 7. Priority resolver & safe-state

- Mỗi AO/DO có một bảng priority (1..6, §13 product definition). Nguồn ghi (safety,
  local manual, BACnet command, schedule, local logic, default) đặt giá trị ở mức
  priority của mình; resolver lấy mức **cao nhất đang active**.
- **BMS không ghi thẳng IO**: lệnh BACnet vào ở priority 3, không phải ghi trực tiếp.
- **Safe-state**: nếu input nuôi một output bị `quality=BAD` (sensor lỗi / Modbus stale)
  và không có fallback hợp lệ → output về safe-state đã khai báo. Validator ép mỗi
  nhánh như vậy phải có fallback/safe-state (check #4).

## 8. Chất lượng giá trị (quality propagation)

Mọi giá trị mang `{value, quality, ts}`:
- `quality ∈ {GOOD, STALE, BAD}`. Modbus quá `poll timeout` → STALE→BAD.
- Node hạ nguồn nhận BAD → dùng `fallback` (nếu khai) hoặc lan truyền BAD tới output,
  kích hoạt safe-state ở bước resolve.

## 9. Scan budget & overrun

- Engine đo thời gian chạy plan mỗi scan; lưu p50/p99.
- Nếu vượt `scan_ms`: log overrun, tăng `overrun_count` (đọc qua `/runtime/status`),
  **không block** (giữ nhịp kế tiếp). Rev B: validator ước lượng budget tĩnh từ graph.

## 10. Atomic deploy

- Nhận graph mới qua `/graph/deploy`. Core build plan **song song** plan đang chạy.
- Build OK → tại ranh giới scan, ghi snapshot persist node trước khi swap, swap con trỏ
  plan, restore persist node theo `id + type`; node không-persist reset state. Build fail
  → giữ plan cũ, trả lỗi. Không có khoảng "không có plan".

## 11. Quan hệ shared-memory (IOP)

Core đọc/ghi IO qua shm với MCU theo `spec/SWFW_INTERFACE_SPEC` (seqlock reader). Mô
hình biến cũ `PlcVarSpace`/retain trong `SW_PLC_ENGINE_DESIGN` được thay bằng node-state
+ snapshot ở §6; phần **hợp đồng shm với MCU giữ nguyên** (chỉ đổi tên `kinexus_shm.h`
→ `mkddc_shm.h`, task implementation riêng — xem ADR-005).

## 12. Trace tối thiểu (đặt lại từ PLC-*)

| ID | Yêu cầu |
|----|---------|
| RUN-001 | Build execution plan bằng topo-sort lúc deploy |
| RUN-002 | Rev A.1 graph acyclic; delay-1 cycle qua stateful node deferred Rev B |
| RUN-003 | Mô hình ảnh I/O: snapshot→execute→write |
| RUN-004 | Snapshot persist node 60s dirty + shutdown + graph swap; recovery theo id+type |
| RUN-005 | Output = power_on trước scan đầu sau boot/deploy |
| RUN-006 | Priority resolver cho mọi AO/DO; BMS vào priority 3 |
| RUN-007 | Quality propagation + fallback + safe-state |
| RUN-008 | Atomic deploy, không có khoảng mất plan |
| RUN-009 | Đo scan budget, đếm overrun, expose qua REST |

---
**Rev** 1.1 | 2026-06-13 — reconcile S7 #4 persist/cycle · 1.0 | 2026-06-08
