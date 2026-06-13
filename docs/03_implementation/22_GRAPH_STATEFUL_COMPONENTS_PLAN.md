# 22 — Graph Stateful Components Plan (S7 #4)
## MK-DDC-24 — Component có-state + persist qua reboot: quyết định triển khai Rev A.1

> **Document ID:** IMPL-GRAPH-STATEFUL-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-13 — Active; đủ để code COR-009/COR-010 (code pending)
> **Đối tượng đọc:** Owner, Dev 2, Tester
> **Đọc cùng:** [SW_COMPONENT_LIBRARY](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md) ·
> [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) ·
> [21 §S7](21_SOM_SRC_IMPLEMENTATION_PLAN.md) · [ADR-008](../adr/ADR-008-bms-edge-positioning-and-revA-component-set.md)

---

## 1. Kết luận audit: tài liệu đã có gì, thiếu gì

**Đã có (không cần viết lại):**

| Tài liệu | Trạng thái | Cover được gì cho S7 #4 |
|----------|-----------|--------------------------|
| SW_COMPONENT_LIBRARY 1.1 | Approved | Contract port/param/state đủ cho CẢ 10 type còn thiếu: `ManualAuto`, `OnDelay`, `OffDelay`, `RuntimeCounter`, `PulseCounter`, `Interlock`, `SafeState`, `AlarmHigh`, `AlarmLow`, `AlarmDelay` |
| SW_RUNTIME_EXECUTION_MODEL 1.0 §5/§6 | Approved | Nguyên tắc stateful node, snapshot `/data/mkddc/state.snap` 60s + shutdown, atomic rename, recovery khi boot (RUN-004) |
| GRAPH_SCHEMA 1.x | Frozen | Node/links/power_on component-agnostic — KHÔNG cần đổi schema |
| ADR-008 | Accepted | Lý do promote Interlock/AlarmDelay/RuntimeCounter/PulseCounter vào Rev A.0 |
| `shared/mkddc_shm.h` | Frozen | `di_counter[8]` iobus đếm cạnh lên ở 10ms — **đã có sẵn**, PulseCounter không cần đổi contract |

**Thiếu / mâu thuẫn đã chốt ở §2.** Spec triển khai chi tiết → §3. Microtask chính thức → §5.

> Lưu ý scope: thư viện Rev A = 28 type; engine hiện có 13. 10 type ở trên là toàn bộ
> phần graph-executable còn lại (5 type Protocol `Modbus_*`/`BACnet_*` thuộc S7 #5/#6,
> không nằm trong file này).

---

## 2. Gap / mâu thuẫn đã chốt

| ID | Vấn đề | Mâu thuẫn / lỗ hổng | Quyết định Rev A.1 |
|----|--------|---------------------|-------------------------------|
| GAP-01 | **Persist scope** | COMPLIB §7: chỉ RuntimeCounter/PulseCounter persist. RUNTIME_MODEL §6 cũ nói snapshot toàn bộ stateful node. | Theo COMPLIB: **chỉ 2 counter persist**. PID/timer/interlock không persist qua mất điện. RUNTIME_MODEL §6 đã chỉnh thành "node có cờ persist". |
| GAP-02 | **Format `state.snap` chưa định nghĩa** | RUNTIME_MODEL §6 chỉ nói path + chu kỳ + atomic rename. | JSON 1 file, schema ở §4. Parse fail/version lạ → bỏ snapshot, init default + WARN, không fail-fast. |
| GAP-03 | **"Graph rev khớp" chưa định nghĩa** | graph.json không có field rev; hash toàn graph sẽ làm mất counter khi sửa setpoint. | Restore theo **node id + type**. Node trùng id+type → restore; khác → init default. KHÔNG dùng graph hash. |
| GAP-04 | **Engine chỉ có 1 output port `out`** | RuntimeCounter có `hours`+`alarm`, Interlock có `out`+`tripped`. | Engine thêm multi-output `map port -> value`. Không đổi GRAPH_SCHEMA. |
| GAP-05 | **Cycle qua stateful node** | RUN-002 cũ cho phép cycle delay-1; engine hiện reject mọi cycle. | **Giữ acyclic ở Rev A.1**. Delay-1 cycle lùi Rev B. Interlock latch tự giữ state nội bộ, không cần wire ngược. |
| GAP-06 | **PulseCounter tần số xung** | Đếm cạnh `pulse:b` ở scan 1s chỉ phù hợp logic chậm. | 2 mode: `channel` 1-8 đọc delta `di_counter[]`; không có `channel` đếm cạnh port `pulse` ở scan rate. Không đổi SHM. |
| GAP-07 | **Snapshot ↔ SIGHUP reload/deploy** | Reset toàn bộ state khi graph đổi sẽ mất counter. | Trước swap ghi snapshot; sau swap restore counter theo id+type. Node không-persist reset như COR-008. |
| GAP-08 | **Thư mục `/data/mkddc` + flash wear** | Path chưa tạo; ghi 60s liên tục tốn flash. | `StateDirectory=mkddc` + install tạo `/data/mkddc`; ghi 60s chỉ khi dirty + shutdown + trước graph swap. |

**Không gap (spec đủ, code thẳng):** `ManualAuto` (stateless, COMPLIB §3),
`AlarmHigh`/`AlarmLow` (= Compare + hysteresis, COMPLIB §7), `SafeState` (stateless, §6).

---

## 3. Spec bổ sung chốt (phần COMPLIB chưa nói rõ)

> Chỉ liệt kê phần **bổ sung/chi tiết hóa** — port/param gốc theo COMPLIB §3-§7, không đổi.

### 3.1 OnDelay / OffDelay
- `delay_s`: float giây thực, validate `0 ≤ delay_s ≤ 86400`; sai dải → load fail (như channel).
- Tích lũy theo **dt scan thật** (`effective_scan_ms`/1000 — nguồn sự thật COR scan loop);
  độ phân giải = 1 scan (1s Rev A) — ghi rõ trong 07, không hứa chính xác sub-scan.
- OnDelay: `in=true` → acc += dt, `out=true` khi acc ≥ delay_s; `in=false` → acc=0, out=false **ngay**.
- OffDelay: `in=true` → out=true ngay, acc=0; `in=false` → acc += dt, `out=false` khi acc ≥ delay_s.
- Không persist (GAP-01). Power-on/reload: acc=0, out=false (OnDelay) / out theo in (OffDelay).

### 3.2 Interlock (truth table chốt semantics "manual reset")
| permit | request | latch | tripped(prev) | → out | → tripped |
|--------|---------|-------|----------------|-------|-----------|
| true | x | x | false | request | false |
| false | x | x | x | **false** | **true** |
| true | x | false | true | request | false (tự clear) |
| true | true | true | true | **false** | **true** (giữ trip) |
| true | false | true | true | false | **false** (clear khi request rút về false) |

- `latch=false`: tripped phản ánh tức thời `!permit`.
- `latch=true`: trip giữ tới khi **request=false VÀ permit=true** (user phải rút lệnh — đó là "manual reset" trong COMPLIB).
- State persist: KHÔNG (an toàn hơn: sau reboot, trip đánh giá lại từ permit thật).

### 3.3 ManualAuto
- `out = sel ? manual : auto`. Stateless, không persist. (COMPLIB đủ — đưa vào đây cho trọn batch.)

### 3.4 RuntimeCounter `[S][persist]`
- State: `run_seconds:double`. `hours = run_seconds/3600` (output float).
- `run=true` → run_seconds += dt. `reset` cạnh lên → run_seconds=0.
- `alarm = (maint_hours > 0) && (hours ≥ maint_hours)`.
- 2 output port: `hours`, `alarm` (cần GAP-04).

### 3.5 PulseCounter `[S][persist]`
- State: `count_raw:uint64`, `prev_pulse:bool`, `last_di_counter:uint32`.
- Mode theo GAP-06: có `channel` → delta di_counter (wrap-safe; delta < 0 → bỏ mẫu, log 1 lần);
  không có → cạnh lên port `pulse` ở scan rate.
- `count = count_raw × scale` (scale default 1.0). `rollover > 0` → count_raw wrap khi
  `count ≥ rollover` (theo giá trị scaled, khớp đồng hồ cơ). `reset` cạnh lên → count_raw=0.

### 3.6 AlarmHigh / AlarmLow / AlarmDelay / SafeState
- AlarmHigh/Low: như Compare_GT/LT với 1 input + `limit` param, cùng hysteresis logic đã có.
- AlarmDelay: ghép OnDelay(`on_delay_s`) + OffDelay(`off_delay_s`, default 0). Không persist.
- SafeState: `out = good ? in : safe_value`. Stateless.

---

## 4. Format `state.snap` chốt (GAP-02)

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
- Path `/data/mkddc/state.snap`; ghi file tạm `.tmp` cùng thư mục + `rename()` (RUN-004).
- Chỉ chứa node persist (GAP-01). Restore: match `id`+`type` (GAP-03); thiếu/lệch → init 0 + WARN.
- Ghi: mỗi 60s **nếu dirty** + shutdown sạch (SIGTERM) + trước graph swap (GAP-07).
- Parse fail/version lạ → bỏ qua + WARN, KHÔNG fail-fast.

---

## 5. Task chính thức

| Task | Nội dung | Phụ thuộc | Effort |
|------|----------|-----------|--------|
| COR-009 | Engine: multi-output port (GAP-04) + 10 component §3 + test từng type (bảng chân lý/timing giả lập dt) | COR-006 | ~2-3 ngày |
| COR-010 | `state_snapshot` module: format §4, ghi 60s dirty + shutdown + trước swap, restore match id+type; wiring COR-008; `StateDirectory` + install.sh (GAP-08); test power-loss (kill -9 → restore) | COR-009 | ~1-1.5 ngày |

Tổng ~3-4.5 ngày, khớp ước lượng "vừa" trong 21 §S7. COR-009 làm trước COR-010.
Không bắt đầu COR-010 khi multi-output và 10 component chưa pass unit test.

---
**Rev** 1.2 | 2026-06-13 — DONE: COR-009/010 implemented, 97/97 test pass · 1.1 | 2026-06-13 — APPROVED · 1.0 | 2026-06-13 — Active · 0.1 | 2026-06-12 — Draft
