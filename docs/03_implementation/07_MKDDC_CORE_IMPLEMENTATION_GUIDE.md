# 07 — mkddc-core Implementation Guide
## MK-DDC-24 — Point table + scan loop + priority/safe-state

> **Document ID:** IMPL-CORE-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Owner:** Dev 2 (SOM)
> **Nguồn-chuẩn:** [ADR-005](../adr/ADR-005-three-process-architecture.md) ·
> [PRODUCT_DEFINITION §10,§13](../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md) ·
> [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) ·
> [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) · [`shared/kinexus_shm.h`](../../shared/kinexus_shm.h)

> 🎯 Vai trò: **bộ não quyết định**. Core đọc IO (qua shm iobus ghi), chạy graph, **resolve
> priority**, áp safe-state, và **quyết output cuối cùng**. Mọi DO/AO PHẢI đi qua đây.

---

## 1. Cây module đề xuất

```
services/core/
├── main.cpp             — init, SCHED_FIFO, sd_notify, vòng đời, signal
├── scan_loop.cpp        — vòng quét tuyệt-đối-thời-gian (clock_nanosleep ABSTIME), 1s
├── point_table.cpp      — 24 IO + virtual point (AV/BV/MSV), value+quality+ts
├── point_quality.cpp    — tính quality (good/uncertain/bad) từ fault/stale
├── graph_runtime.cpp    — nạp graph.json, thực thi component theo thứ tự topo
├── priority_resolver.cpp— 6 mức priority → 1 output cuối/kênh
├── safe_state.cpp       — fallback khi IO fault / stale / chưa có graph hợp lệ
├── iobus_reader.cpp     — đọc kx_io_shm (seqlock reader), ext cache
├── output_writer.cpp    — ghi ao_setpoint[]/do_cmd[] vào kx_io_shm
├── bacnet_objtable.cpp  — kx_plc_shm (object table cho iobus BACnet/IP)
├── web_ipc.cpp          — nhận command/setpoint từ web; trả read snapshot
└── core_metrics.cpp     — scan_count, scan_overrun, timing
```

---

## 2. Scan loop (chu kỳ runtime — PRODUCT_DEFINITION §10)

```
1. Read IO state        : iobus_reader đọc kx_io_shm (seqlock) → point_table (UI/DI/DO_fb).
2. Update point table   : cập nhật value + ts; point_quality tính quality.
3. Read Modbus(cache)   : đọc ext cache {value,quality,ts} → virtual point.
4. Read BACnet/web cmd  : web_ipc + BACnet command → command queue (KHÔNG ghi thẳng IO).
5. Execute graph        : graph_runtime chạy component (PID/timer/alarm/schedule/logic).
6. Resolve priority     : priority_resolver gộp các nguồn ghi → 1 output/kênh.
7. Apply safe-state     : safe_state ghi đè nếu IO fault/stale/no-graph.
8. Write output command : output_writer ghi ao_setpoint[]/do_cmd[] vào kx_io_shm.
9. Update BACnet object : bacnet_objtable ghi kx_plc_shm.
10. Update metrics       : scan_count++, đo thời gian, phát hiện overrun.
11. Sleep tới scan kế    : clock_nanosleep(TIMER_ABSTIME) tới mốc tiếp theo (1s).
```
> Scan mặc định **1s** (Rev A). sd_notify READY=1 sau scan đầu tiên hoàn tất.

---

## 3. Point table

| Nhóm | Số | Nguồn (đọc) | Đích (ghi) |
|------|----|----|----|
| AI (UI scaled) | 8 | kx_io_shm.ui_value/ui_quality | — (read-only IO) |
| BI (DI) | 8 | kx_io_shm.di_state | — |
| AO | 4 | (feedback) | kx_io_shm.ao_setpoint (qua priority) |
| BO (DO) | 4 | kx_io_shm.do_feedback | kx_io_shm.do_cmd (qua priority) |
| AV virtual | 32 | graph / web / BACnet | — |
| BV virtual | 16 | graph / web / BACnet | — |
| ext (Modbus) | 64 | ext cache | ext setpoint (dirty) |

Mỗi point: `{value, quality, timestamp, source}`. Quality: GOOD / UNCERTAIN / BAD.

---

## 4. Priority resolver (PRODUCT_DEFINITION §13 — BẮT BUỘC)

```
| Priority | Nguồn          |
|---------:|----------------|
| 1        | Fire / Safety  |  ← cao nhất
| 2        | Local manual   |
| 3        | BACnet command |
| 4        | Schedule       |
| 5        | Local logic    |
| 6        | Default        |  ← thấp nhất
```
**Rule:**
```
- Mọi DO/AO output đi qua priority_resolver, không ghi thẳng kx_io_shm.
- BMS/BACnet/Modbus/Web KHÔNG ghi thẳng IO — chỉ ghi command/setpoint vào 1 mức priority.
- Resolver chọn nguồn priority cao nhất đang active → giá trị output cuối.
- Không nguồn nào active → relinquish default (mức 6).
```
**Module format:**
```
Mục tiêu : gộp nhiều nguồn ghi → 1 output/kênh theo priority.
Input    : command từ web/BACnet/schedule/logic/safety (mỗi nguồn gắn mức).
Output   : 1 giá trị output cuối/kênh DO/AO.
Lỗi      : 2 nguồn cùng mức ghi 1 kênh → log conflict, lấy nguồn ghi sau / theo policy.
Test     : web (mức3) + safety (mức1) cùng ghi DO1 → safety thắng.
Done khi : output cuối luôn theo nguồn priority cao nhất active; không bypass.
```

---

## 5. Safe-state resolver

```
Mục tiêu : đảm bảo output an toàn khi IO không tin cậy.
Trigger  : iop_status=FAULT/SAFE; ui_quality=BAD; ext stale; chưa có graph hợp lệ.
Hành vi  : AO → safe (0V/4mA theo mode); DO → open; quality điểm = BAD.
Test     : rút UART → iobus FAULT → core ghi safe output → relay mở, AO 0V/4mA.
Done khi : mọi điều kiện fault dẫn tới output an toàn trong ≤1 scan.
```

---

## 6. Quality propagation

```
- iop_status=FAULT hoặc fault_flags.ADC_FAULT → UI quality = BAD.
- ts_ns trong shm không tăng > 3 chu kỳ → stale → quality = UNCERTAIN→BAD.
- ext (Modbus) online=0 → quality = BAD.
- Graph component đọc point BAD → áp fallback (SW_RUNTIME_EXECUTION_MODEL).
Done khi: IO fault làm point quality bad và graph/web thấy được.
```

---

## 7. IPC với web (web_ipc)

```
- Web KHÔNG ghi thẳng kx_io_shm. Web gửi command/setpoint qua web_ipc (Unix socket
  /run/mkddc/core.sock hoặc shared command ring), kèm {point_id, value, priority_source, user}.
- Core đưa command vào command queue (bước 4 scan loop) → priority_resolver.
- Web đọc snapshot point qua web_ipc (read) hoặc core publish read-cache.
- Audit: core trả kết quả apply (accepted/overridden-by-priority) để web ghi audit log.
```

---

## 8. systemd

```
# /etc/systemd/system/mkddc-core.service
[Service]
ExecStart=/usr/sbin/mkddc-core
User=mkddc
Restart=always
WatchdogSec=3
CPUSchedulingPolicy=fifo
CPUSchedulingPriority=80
LimitMEMLOCK=infinity
[Install]
WantedBy=multi-user.target
```
> mlockall() để tránh page fault trong scan; SCHED_FIFO 80 (cao hơn iobus 70).

---

## 9. Quy tắc bắt buộc

```
1. Mọi DO/AO qua priority_resolver. KHÔNG có đường ghi tắt.
2. Core KHÔNG mở UART, KHÔNG nói chuyện MCU (đó là iobus).
3. Scan loop tuyệt-đối-thời-gian; không sleep tương đối (tránh drift).
4. Đọc shm bằng seqlock reader (retry khi seq lẻ); không block iobus.
5. IO fault → quality bad → safe-state; không giả "good".
```

---

## 10. Trace

| Chủ đề | Module | Test |
|--------|--------|------|
| Scan 1s | scan_loop | group 4 |
| Point table 24 IO | point_table | group 4 |
| Priority 6 mức | priority_resolver | group 4 + group 6 (E2E) |
| Safe-state | safe_state | group 7 (fault inject) |
| Quality bad | point_quality | group 7 |

---
**Rev** 1.0 | 2026-06-10 · DoD: [12_DEFINITION_OF_DONE §4](12_DEFINITION_OF_DONE.md)
