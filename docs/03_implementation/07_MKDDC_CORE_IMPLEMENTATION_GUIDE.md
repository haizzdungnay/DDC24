# 07 — mkddc-core Implementation Guide
## MK-DDC-24 — Point table + scan loop + priority/safe-state

> **Document ID:** IMPL-CORE-MK-DDC-24-VI
> **Phiên bản:** 1.12 | 2026-07-24 (ADR-021 Phase A: §1 cây thư mục cập nhật theo domain subfolder thật) · 1.11 | 2026-07-17 (COR-HIST-001 core/local Done; target historian E2E remains open) · 1.10 | 2026-07-15 (COR-HIST-001 coherent runtime snapshot planned; point-count drift corrected) · 1.9 | 2026-06-27 (COR-011 done) · 1.5 | 2026-06-13 (S7 #4/#5/#6 docs: stateful graph, BACnet, Modbus; fix priority test web=mức 2) ·
> 1.4 | 2026-06-12 (§8: web_ipc đủ overridden + audit COR-007, SIGHUP reload
> COR-008; §9: unit file thật packaging/systemd + ExecReload — SKEL-005) ·
> 1.3 | 2026-06-12 (graph_runtime implemented Rev A subset; T6/T7 implemented;
> io_safe_state.conf loader → default mức 6; quan hệ default/safe-override chốt §5.3) ·
> 1.2 | 2026-06-12 (§5 viết lại thành SAFETY SPEC: lớp safety §5.1, trigger
> matrix implemented/planned §5.2, action §5.3, recovery rule §5.4) · 1.1 | 2026-06-11
> (Contract Freeze: chốt MVP Rev A, module API, build/systemd đầy đủ, seqlock reader mẫu)
> **Owner:** Dev 2 (SOM)
> **Nguồn-chuẩn CUỐI CÙNG:** [`contracts/shm/mkddc_shm.h`](../../contracts/shm/mkddc_shm.h) (SHM) — docs lệch
> header → **header thắng** ([16_CONTRACT_FREEZE](archive/16_CONTRACT_FREEZE.md)). Diễn giải:
> [ADR-005](../adr/ADR-005-three-process-architecture.md) ·
> [PRODUCT_DEFINITION §10,§13](../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md) ·
> [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) ·
> [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md)

> 🎯 Vai trò: **bộ não quyết định**. Core đọc IO (qua shm iobus ghi), chạy graph, **resolve
> priority**, áp safe-state, và **quyết output cuối cùng**. Mọi DO/AO PHẢI đi qua đây.

---

## 0. Mục tiêu / Phạm vi / Không làm (MVP Rev A — chốt)

**Mục tiêu bản đầu tiên (Phase 4):** core đọc được IO thật từ shm, quyết output qua priority +
safe-state, ghi `ao_setpoint[]/do_cmd[]` ngược vào shm — đủ để round-trip
`web → core → iobus → MCU → relay` chạy.

**MVP PHẢI có (theo thứ tự implement):**

| # | Module | Trạng thái Rev A đầu | Trách nhiệm 1 câu |
|---|--------|----------------------|--------------------|
| 1 | `scan_loop` | **đầy đủ** | Vòng quét 1s tuyệt-đối-thời-gian, gọi các bước §2 đúng thứ tự |
| 2 | `iobus_reader` | **đầy đủ** | Seqlock-read `kx_io_shm_t` thành snapshot nhất quán |
| 3 | `point_table` | **đầy đủ** | Giữ 24 IO + virtual point {value, quality, ts, source} |
| 4 | `point_quality` | **đầy đủ** | Tính GOOD/UNCERTAIN/BAD từ fault/stale |
| 5 | `priority_resolver` | **đầy đủ** | Gộp nhiều nguồn ghi → 1 output/kênh theo 6 mức |
| 6 | `safe_state` | **đầy đủ** | Ghi đè output an toàn khi IO không tin cậy |
| 7 | `output_writer` | **đầy đủ** | Ghi `ao_setpoint[]/do_cmd[]` vào shm (writer duy nhất 2 field này) |
| 8 | `core_metrics` | **đầy đủ** | scan_count/scan_overrun/timing |
| 9 | `web_ipc` | **stub được** | Nhận command từ web qua `/run/mkddc/core.sock`; stub = accept + log + đưa vào queue |
| 10 | `graph_runtime` | **implemented (Rev A subset); S7 #4 planned** | Base 13 component đã có; COR-009/010 thêm 10 component stateful + persist theo [22](archive/23_GRAPH_STATEFUL_COMPONENTS_PLAN.md) |
| 11 | `bacnet_objtable` | **stub được; S7 #5 planned** | Stub ghi value/quality; full Priority_Array[16]/Reliability/COV theo [24](25_BACNET_IMPLEMENTATION_PLAN.md) |

**KHÔNG làm trong core (mọi Rev):**
```
- KHÔNG mở UART, KHÔNG nói chuyện MCU trực tiếp (việc của iobus).
- KHÔNG scale raw→engineering (iobus đã scale; core chỉ thấy eng value).
- KHÔNG serve HTTP/REST (việc của web; core chỉ có Unix socket IPC).
- KHÔNG ghi field Writer=iobus trong kx_io_shm (chỉ ghi ao_setpoint/do_cmd).
- KHÔNG tạo /dev/shm/mkddc_io_shm (iobus là creator; core attach + retry).
```

**Dependency:** `shared/mkddc_shm.h` · iobus chạy trước (systemd `After=mkddc-iobus`) ·
config `/data/config/` (đọc qua web deploy).

---

## 1. Cây thư mục chuẩn

> **Đo lại 2026-08-19.** Hai lần restructure chồng lên nhau: ADR-021 Phase A (2026-07-24) chia theo
> domain, rồi `PLAN-ARCH-RESTRUCT-002`/ADR-025 chuyển `services/core/` → `apps/core/` và xếp theo
> **tầng hexagonal** `domain/` ← `application/` ← `adapters/` ← `bootstrap/`, với `ports/` giữ
> interface. Include nội bộ dùng full path từ `apps/core/` root (vd `#include "application/st/st_parser.hpp"`).
> Cây dưới đây là cây thật, không phải cây dự kiến.

```
apps/core/
├── CMakeLists.txt
├── bootstrap/main.cpp     — init, SCHED_FIFO 80, attach shm (retry), sd_notify, signal
├── ports/                 — interface giữa các tầng
│   ├── io_snapshot.hpp · io_snapshot_reader.hpp · output_command.hpp
├── domain/                — thuần nghiệp vụ, không I/O
│   ├── json_min.hpp                 — parser JSON đệ quy tối thiểu (dùng chéo nhiều domain)
│   ├── graph/                       — component graph + point data model
│   │   ├── point_table.{hpp,cpp}        — 24 IO + AV/BV/MSV, value+quality+ts+source
│   │   ├── point_quality.{hpp,cpp}      — quality từ fault/stale
│   │   ├── point_writer.{hpp,cpp}       — đường ghi dùng chung (cấm nguồn tự ghi SHM)
│   │   ├── graph_runtime.{hpp,cpp}      — load/validate/topo/execute graph.json
│   │   ├── runtime_point_snapshot.{hpp,cpp} · clock_snapshot.hpp
│   ├── priority/priority_resolver.{hpp,cpp}  — 6 mức → 1 output cuối/kênh
│   ├── safety/safe_state.{hpp,cpp}           — fallback IO fault/stale/T6/T7 (§5.2)
│   ├── safety/overrun_monitor.{hpp,cpp}      — giám sát quá hạn chu kỳ quét
│   └── alarm/alarm_primitives.hpp
├── application/           — điều phối use case
│   ├── runtime/scan_loop.{hpp,cpp}   — vòng quét clock_nanosleep(ABSTIME)
│   ├── st/                           — ngôn ngữ ST/FBD: parser, semantic, IR, compile, runtime,
│   │                                   artifact/manifest, io_map, retain, journal, trace, scheduler,
│   │                                   process image, control API, fuzz/ (entry st_validate_main.cpp,
│   │                                   st_compile_main.cpp)
│   ├── programming/                  — program_ipc_server, runtime coordinator, cutover
│   ├── schedule/                     — schedule_runtime, schedule_clock, schedule_sim_main
│   └── alarm/alarm_runtime.{hpp,cpp}
├── adapters/              — I/O, hệ điều hành, giao thức
│   ├── ipc/                          — web_ipc (Unix socket /run/mkddc/core.sock, JSON lines §8),
│   │                                   iobus_reader (seqlock reader kx_io_shm),
│   │                                   output_writer (ao_setpoint[]/do_cmd[]),
│   │                                   config_reload (SIGHUP, COR-008), program_ipc_unix
│   ├── bacnet/bacnet_objtable.{hpp,cpp}  — ghi kx_plc_shm (creator plc_shm = core)
│   ├── persistence/state_snapshot.{hpp,cpp}
│   ├── config/safe_state_config.{hpp,cpp} — loader io_safe_state.conf → default mức 6
│   └── diagnostics/core_metrics.{hpp,cpp} — scan_count, overrun, exec time
└── tests/                 — test gộp; một số domain giữ test cạnh source (vd domain/priority/)
```

Test liệt kê ở §5.5/§8 dưới đây tham chiếu theo basename (vd `test_iobus_reader.cpp`) — vị trí
thật là `<domain>/tests/test_*.cpp` theo cây trên, không phải `tests/` phẳng.

---

## 2. Scan loop (chu kỳ runtime — PRODUCT_DEFINITION §10)

```
1. Read IO state        : iobus_reader đọc kx_io_shm (seqlock) → IoSnapshot.
2. Update point table   : value + ts; point_quality tính quality (kể cả stale check ts_ns).
3. Read ext cache       : ext_cache snapshot → cập nhật Protocol node inputs (Modbus_RTU_Read, Modbus_TCP_Read); gọi trước graph_runtime.execute() — xem §12
4. Read web/BACnet cmd  : web_ipc.drain() → command queue (KHÔNG ghi thẳng IO).
5. Execute graph        : graph_runtime.execute() (Rev A.1 graph acyclic — node topo order).
6. Resolve priority     : priority_resolver → 1 output/kênh DO/AO.
7. Apply safe-state     : safe_state ghi đè nếu trigger (§5).
8. Write output command : output_writer ghi ao_setpoint[]/do_cmd[] vào kx_io_shm.
9. Update BACnet object : bacnet_objtable ghi kx_plc_shm (base: value/quality; S7 #5: reliability/priority view).
10. Update metrics      : scan_count++, đo exec time, phát hiện overrun.
11. Sleep tới scan kế   : clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, next).
```
> Base step mặc định **10 ms** (ADR-061 C1; trước đây 1 s). Mốc thứ k = t0 + k × base step, ngủ tới mốc TUYỆT ĐỐI (không drift). Trễ ≥ 1 base step thì BỎ các mốc đã qua và nhảy tới mốc kế tiếp, không chạy dồn; số mốc bị bỏ đếm ở `missedBaseStepCount` (ADR-061 4.9).
> sd_notify READY=1 sau scan đầu tiên hoàn tất. `WATCHDOG=1` tối đa 1 lần/giây, chỉ ngay sau một scan trọn vẹn (ADR-061 4.8, `WatchdogSec=6`).
> CPU của vòng quét (CPU3 trên Foxlinx) phải có ràng buộc `pm_qos_resume_latency_us` ≤ 100 µs, nếu không lần thức dậy sau mỗi base step có thể trễ bằng exit latency của trạng thái nghỉ sâu (RV1126B `cpu-sleep` 370 µs). Unit đặt 20 µs; Core log `rt.cpu_idle_ok` hoặc `ERROR rt.cpu_idle_exposed` lúc khởi động.
> Cụm CPU chứa CPU của vòng quét phải giữ tần số cố định (governor `performance`): RV1126B có MỘT policy cpufreq cho cả 4 lõi, và mỗi lần `schedutil` đổi tần số theo tải ở CPU0–2 thì vòng quét thức dậy trễ 109–163 µs (F17). Unit gọi `/usr/libexec/mkddc/rt-cpufreq hold 3` / `release 3`; Core log `rt.cpufreq_ok` hoặc `ERROR rt.cpufreq_scaling` lúc khởi động.

**Skeleton scan loop (copy được):**
```cpp
// Bản thật: application/runtime/scan_loop.cpp (ScanLoop::run) + base_step_pacer.hpp.
BaseStepPacer pacer;
pacer.start(base_step_ns /* 10 ms */, now_ns());
IntervalGate watchdog{1000000000ull};             // ADR-061 4.8: tối đa 1 lần/giây
while (!g_shutdown) {
    pacer.on_wake(now_ns());                      // C4: lệch so với mốc tuyệt đối
    const uint64_t t0 = now_ns();
    IoSnapshot io;
    if (iobus_reader.read(&io)) point_table.update_inputs(io);
    point_quality.evaluate(point_table, io, t0);  // stale theo THỜI GIAN (4.7)
    auto cmds = web_ipc.drain();                  // stub: queue rỗng
    graph_runtime.execute(point_table, resolver); // graph → resolver mức 5
    auto out = priority_resolver.resolve(point_table, cmds);
    safe_state.apply(io, point_table, &out);      // có thể ghi đè out
    output_writer.write(out);                     // seqlock-an-toàn (xem §7.2)
    bacnet_objtable.publish(point_table);
    core_metrics.end_scan(now_ns() - t0);
    if (watchdog.due(now_ns())) sd_notify(0, "WATCHDOG=1");
    const uint64_t deadline = pacer.advance(now_ns()); // trễ >= 1 step: bỏ, không chạy dồn
    struct timespec next{static_cast<time_t>(deadline / 1000000000ull),
                         static_cast<long>(deadline % 1000000000ull)};
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, nullptr);
}
```

---

## 3. Point table

| Nhóm | Số | Nguồn (đọc) | Đích (ghi) |
|------|----|----|----|
| UI scaled | 16 | kx_io_shm.ui_value/ui_quality | — (read-only IO) |
| DI optional | 8 reserved | kx_io_shm.di_state khi board capability bật | — |
| AO | 4 | post-priority resolved setpoint | kx_io_shm.ao_setpoint (qua priority) |
| DO | 4 | kx_io_shm.do_feedback | kx_io_shm.do_cmd (qua priority) |
| AV virtual | 32 | graph / web / BACnet | — |
| BV virtual | 16 | graph / web / BACnet | — |
| ext (Modbus) | 64 | ext cache (Rev A.1) | ext setpoint (dirty) |

Mỗi point: `{float value; kx_quality_t quality; uint64_t ts_ns; PointSource source;}`.

**Public API tối thiểu:**
```cpp
class PointTable {
public:
    void   update_inputs(const IoSnapshot& io);     // AI/BI/DO_fb từ shm
    Point  get(PointId id) const;
    bool   set_virtual(PointId id, float v, PointSource src);  // AV/BV (web/graph)
    // KHÔNG có set() cho AO/BO — output chỉ đi qua priority_resolver
};
```
**Done khi / Test:** base SKU 24 IO (16 UI + 4 AO + 4 DO) phản ánh đúng shm trong ≤1 scan; optional DI chỉ expose khi capability bật; AV/BV set/get đúng; không có đường ghi AO/DO trực tiếp (compile-time: không tồn tại API).

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
**Public API:**
```cpp
struct OutputCmd { float ao[4]; bool ao_valid[4]; uint8_t dout[4]; bool do_valid[4]; };
class PriorityResolver {
public:
    // nguồn ghi: set(level, channel, value) / release(level, channel)
    void set_ao(int level, int ch, float v);   void release_ao(int level, int ch);
    void set_do(int level, int ch, bool on);   void release_do(int level, int ch);
    OutputCmd resolve();                        // mức active cao nhất; không ai → default (mức 6)
};
```
**Rule:**
```
- Mọi DO/AO output đi qua priority_resolver, không ghi thẳng kx_io_shm.
- Web/BACnet/schedule/logic mỗi nguồn gắn 1 mức cố định; KHÔNG nguồn nào ghi thẳng IO.
- 2 nguồn cùng mức ghi 1 kênh → log WARN conflict, lấy nguồn ghi sau.
- Không nguồn nào active → relinquish default (mức 6, đọc từ /data/config/io_safe_state.conf
  qua safe_state_config — CONFIG_SCHEMA §4). QUAN HỆ CHỐT (quyết định product 2026-06-12):
  io_safe_state.conf CHỈ cấu hình default mức 6; safety action của safe_state (§5.3) CỐ ĐỊNH
  0V/4mA/open, LUÔN thắng default khi trigger. Default mức 6 chỉ có hiệu lực khi hệ có ít
  nhất 1 nguồn điều khiển (graph loaded hoặc manual/BMS active) — không có → T7 ép safe.
```
**Test (test_priority_resolver.cpp):**
```
- web/manual (mức 2) set DO1=1; safety (mức 1) set DO1=0 → resolve = 0 (safety thắng).
- safety release → resolve = 1 (rơi về mức 3).
- tất cả release → resolve = default.
- 2 nguồn mức 3 cùng ghi → nguồn sau thắng + log conflict.
```
**Done khi:** output cuối luôn theo nguồn priority cao nhất active; không bypass.

---

## 5. Safe-state resolver — SAFETY SPEC

> ⚠️ Safety trong hệ này là **nhiều lớp**, core KHÔNG phải lớp duy nhất. §5.1 chốt ai
> phát hiện / ai quyết / ai thực thi. §5.2 chốt trigger nào **ĐÃ implement** vs
> **PLANNED** — tester chỉ viết test case cho phần implemented.

### 5.1 Các lớp safety (defense-in-depth)

| Lớp | Phát hiện lỗi | Quyết định safe | Thực thi safe | Phản ứng |
|-----|---------------|-----------------|---------------|----------|
| **MCU FW** | mất `GET_IO` > `IOP_SAFE_TIMEOUT_MS` (200ms) | MCU tự vào safe-state | AO→raw safe, DO→open trực tiếp trên phần cứng; NACK `ERR_SAFE_STATE` cho mọi `SET_*` | ≤200ms |
| **iobus** | >`IOP_FAULT_TIMEOUT_MS` (100ms) không `IO_RESP` hợp lệ (timeout/CRC/SEQ) | state machine `FAULT → RESET_IO(0x05) → SAFE_STATE` (05 §13) | ghi `iop_status=FAULT/SAFE` vào shm; `output_command` ngừng gửi `SET_*` khi bị NACK safe | ≤100ms + retry |
| **core** (`safe_state`) | `iop_status=FAULT/SAFE` hoặc shm stale (ts_ns không tăng quá max(5 base step, 500 ms), ADR-061 4.7) | ghi đè `OutputCmd` SAU `priority_resolver` | AO→safe (0V/4mA theo `ao_mode`), DO→0 vào `ao_setpoint[]/do_cmd[]` | ≤1 base step (10 ms) sau khi vượt ngưỡng |

**Thứ tự ưu tiên khi nhiều lớp cùng can thiệp: MCU thắng** (lớp cuối chạm phần cứng).
Khi MCU đang safe, mọi `SET_*` từ SOM bị NACK `ERR_SAFE_STATE` — iobus giữ lệnh chờ hết
safe, không spam retry. Core safe-state lúc đó cũng đang ghi giá trị safe nên 3 lớp
hội tụ cùng một trạng thái output, không xung đột giá trị.

### 5.2 Trigger matrix — implemented vs planned

| # | Trigger | Lớp | Trạng thái | Code / Test |
|---|---------|-----|------------|-------------|
| T1 | `iop_status=FAULT` | core | ✅ **implemented** | `safe_state.cpp` · `IopFaultForcesSafeOutputs` |
| T2 | `iop_status=SAFE` | core | ✅ **implemented** | `safe_state.cpp` · `SafeStatusAlsoTriggers` |
| T3 | shm stale theo thời gian (ADR-061 4.7): `ts_ns` không tăng quá max(5 base step, 500 ms) → BAD (`PointQuality::is_stale_bad()`); quá max(3 base step, 250 ms) chỉ UNCERTAIN | core | ✅ **implemented** | `safe_state.cpp` · `StaleShmForcesSafeAfterHalfSecondOnTenMsBaseStep`, `StaleThresholdScalesWithLongBaseStep` |
| T4 | MCU mất `GET_IO` 200ms | MCU FW | ✅ spec chốt (04 §FW — ngoài scope core) | FW + `fake_mcu` |
| T5 | UART >100ms không `IO_RESP` hợp lệ | iobus | ✅ **implemented** | `iobus/main.cpp` · integration `fake_mcu --timeout` |
| T6 | `ui_quality=BAD` trên kênh graph đang dùng | core | ✅ **implemented** | `safe_state.cpp` · `T6GraphInputBadForcesSafe` |
| T7 | chưa có graph hợp lệ VÀ không có lệnh manual/BMS active | core | ✅ **implemented** | `safe_state.cpp` · `T7NoGraphNoManualForcesSafe` |

> T6/T7 implemented 2026-06-12 cùng `graph_runtime` (Rev A subset). E2E đo cả 3 lớp
> trong 1 run: `tools/test_safety_e2e.sh` (lớp 1 fake_mcu 200ms / lớp 2 iobus / lớp 3 core).

### 5.3 Safety action (chốt chung mọi lớp)

```
AO mode 0-10V  → 0V    (MCU: IOP_AO_SAFE_VOLT_RAW = 0)
AO mode 4-20mA → 4mA   (MCU: IOP_AO_SAFE_CURR_RAW = 0 — raw 0 = 4mA theo mapping SET_AO)
DO             → 0     (open / relay nhả)
Log            : ERROR 1 lần/transition (vào và ra), KHÔNG spam mỗi scan.
Quality        : point_quality (§6) tự degrade BAD theo cùng điều kiện — safe_state
                 KHÔNG set quality (tách trách nhiệm).
```

### 5.4 Recovery rule

```
Điều kiện thoát : TẤT CẢ trigger hết (iop_status=NORMAL VÀ ts_ns tăng trở lại).
Hành vi thoát   : safe_state ngừng ghi đè NGAY scan kế tiếp → trả quyền cho
                  priority_resolver (nguồn active mức cao nhất thắng lại).
Hysteresis      : KHÔNG có ở lớp core (Rev A) — vào/ra theo trạng thái tức thời.
                  Chấp nhận vì iobus đã "debounce" bằng state machine: SAFE_STATE →
                  RECONNECT → handshake lại thành công mới trả iop_status=NORMAL.
MCU recovery    : SOM handshake lại + RESET_IO; MCU thoát safe khi nhận GET_IO đều.
Test            : RecoveryReturnsControlToResolver — hết fault → resolver giữ giá trị cũ.
T6 exit         : kênh graph dùng hết BAD. T7 exit: graph load thành công HOẶC có
                  manual/BMS active trở lại.
MCU kẹt safe    : iobus bị NACK ERR_SAFE_STATE >3s → escalate RECONNECT (handshake +
                  RESET_IO + resync output); DO_FB lệch last_sent ≥5 poll → resend SET_DO.
```

### 5.5 API / Test / Done

```
Public API: void apply(const IoSnapshot&, const PointTable&, OutputCmd* inout);
           — gọi SAU priority_resolver.resolve() (scan step 7); bool active() để metrics/log.
Test     : test_safe_state.cpp — T1/T2/T3/T6/T7 + recovery (xem §5.2); E2E 3 lớp: tools/test_safety_e2e.sh.
Done khi : mọi trigger implemented dẫn tới output an toàn trong ≤1 scan;
           thoát safe trả quyền resolver trong ≤1 scan.
```

---

## 6. Quality propagation

```
- iop_status=FAULT/SAFE                  → mọi UI/DI quality = BAD.
- fault_flags & IOP_FAULT_ADC            → mọi UI quality = BAD.
- fault_flags & IOP_FAULT_UI_OV          → kênh vượt dải = BAD (iobus đã set theo kênh).
- kx_io_shm.ts_ns không tăng > 3 scan    → stale → UNCERTAIN (3-5 scan) → BAD (>5 scan).
- ext (Modbus) online=0                  → quality = BAD (Rev A.1).
- Graph component đọc point BAD          → fallback (SW_RUNTIME_EXECUTION_MODEL).
Done khi: rút UART → ≤2 scan tất cả UI/DI BAD; web thấy quality bad; graph thấy stale.
```

---

## 7. SHM: đọc và ghi đúng cách

### 7.1 `iobus_reader` — seqlock reader (copy được)
```cpp
bool IobusReader::read(IoSnapshot* out) {
    const kx_io_shm_t* s = shm_;                 // mmap sẵn từ attach()
    if (s->magic != KX_SHM_MAGIC) return false;  // iobus chưa init
    for (int i = 0; i < 5; i++) {                // tối đa 5 lần thử
        uint32_t v1 = __atomic_load_n(&s->seq, __ATOMIC_ACQUIRE);
        if (v1 & 1u) continue;                   // đang ghi → thử lại
        memcpy(out, /*copy các field cần*/ ..., ...);
        uint32_t v2 = __atomic_load_n(&s->seq, __ATOMIC_ACQUIRE);
        if (v1 == v2) return true;               // snapshot nhất quán
    }
    return false;                                 // dùng snapshot cũ + đếm metric
}
```
`attach()`: mở `KX_SHM_IO_PATH` (KHÔNG O_CREAT — iobus là creator), magic sai → retry 1s,
log WARN mỗi 10s; sau 30s → vẫn chạy scan với toàn bộ quality=BAD (safe-state áp).

### 7.2 `output_writer` — ghi 2 field core sở hữu
```
- core là writer DUY NHẤT của ao_setpoint[] + do_cmd[] (ownership: 06 §5).
- KHÔNG dùng KX_WRITE_BEGIN/END của io_shm (seq do iobus sở hữu).
  Ghi từng field bằng atomic store / aligned write (float/uint8 ghi nguyên tử trên ARM64):
  __atomic_store_n(&shm->do_cmd[ch], v, __ATOMIC_RELEASE);
- ao_setpoint ghi giá trị ENGINEERING (V/mA theo ao_mode); iobus convert eng→raw.
- Chỉ ghi khi giá trị đổi (đỡ cache-line bounce); iobus side cũng chỉ gửi khi CHANGED.
Done khi: ghi do_cmd[0]=1 → iobus phát hiện/gửi SET_DO trong ≤1 chu kỳ poll nominal (2ms), không tính actuator relay time.
```

---

## 8. IPC với web và BACnet (`web_ipc`) — CONTRACT CHUẨN (core là server)

> **BAC-CONFLICT-001 CLOSED 2026-06-17 — Resolution Option A:**
> Phiên bản cũ ghi hạn chế "chỉ `manual` (mức 2), mức khác KHÔNG đi qua socket này".
> Hạn chế đó mâu thuẫn với plan 24 (BAC-006: WriteProperty → core mức 3).
> **Resolution:** mở rộng socket này để nhận thêm `source=bacnet` (mức 3). Không tạo socket mới
> vì reuse đơn giản hơn, audit format giống nhau, và plc_shm single-writer vẫn là core.

**Transport:** Unix stream socket `/run/mkddc/core.sock` (mode 660, group mkddc — web user
và BACnet server (iobus) đều thuộc group). Mỗi message = **1 dòng JSON** (newline-delimited).
Web/BACnet đọc snapshot point qua `kx_io_shm`/`kx_plc_shm` trực tiếp (read-only) —
socket CHỈ dùng cho command write/release.

**Request (client → core):**
```json
{"id": 421, "op": "write",   "point": "DO1", "value": 1,   "source": "manual", "user": "admin"}
{"id": 422, "op": "release", "point": "DO1",               "source": "manual", "user": "admin"}
{"id": 501, "op": "write",   "point": "AO1", "value": 5.0, "source": "bacnet", "user": "bacnet:192.168.1.10"}
{"id": 502, "op": "release", "point": "AO1",               "source": "bacnet", "user": "bacnet"}
```
| Field | Kiểu | Bắt buộc | Ý nghĩa |
|-------|------|----------|---------|
| `id` | uint64 | ✅ | Correlation id, client tự tăng; core echo nguyên xi vào response |
| `op` | `write`/`release` | ✅ | write = set giá trị; release = nhả nguồn (relinquish) |
| `point` | string | ✅ | Point id (DO1/AO2/AV3...) |
| `value` | number | khi op=write | Engineering value |
| `source` | enum | ✅ | `manual` (mức 2, web/HMI operator) · `bacnet` (mức 3, BACnet BMS — BAC-006) |
| `user` | string | ✅ | Cho audit log; BACnet dùng `"bacnet"` hoặc `"bacnet:<client_ip>"` |

**Quy tắc BACnet client (source=bacnet):**
- BACnet server trong `mkddc-iobus` tự resolve `Priority_Array[16]` trước (pick winning slot).
- Gửi winning value đến core.sock với `source="bacnet"`, `op="write"`.
- Khi array trở thành rỗng (tất cả NULL) → gửi `op="release"`, `source="bacnet"`.
- BACnet server mở **1 persistent connection** đến core.sock (tương tự web backend); reconnect với backoff 1s khi core restart.
- Core map `source=bacnet` → `PRIO_BACNET` (mức 3); nếu safety/manual (mức 1/2) đang active → result=`overridden`.

**Response (core → client, cùng connection, đúng 1 dòng/request):**
```json
{"id": 421, "result": "accepted",   "applied_value": 1,   "active_source": "manual"}
{"id": 421, "result": "overridden", "applied_value": 0,   "active_source": "safety"}
{"id": 501, "result": "accepted",   "applied_value": 5.0, "active_source": "bacnet"}
{"id": 501, "result": "overridden", "applied_value": 0,   "active_source": "manual"}
{"id": 423, "result": "rejected",   "error": "unknown_point"}
```
| `result` | Nghĩa | Client hiển thị / log |
|----------|-------|----------------------|
| `accepted` | nguồn đang thắng, giá trị được áp | OK |
| `overridden` | nhận lệnh nhưng nguồn cao hơn đang thắng (`active_source`) | "Bị ghi đè bởi mức ưu tiên cao hơn" |
| `rejected` | lỗi: `unknown_point` / `bad_value` / `readonly_point` / `bad_request` / `unknown_source` | thông báo lỗi |

**Timing/lỗi:**
```
- Core trả lời trong ≤ 2 chu kỳ scan (≤2s Rev A); client timeout 3s → coi là lỗi, KHÔNG retry
  tự động lệnh write (tránh double-actuate) — báo user/BMS thử lại.
- Socket đóng/core restart: client reconnect với backoff 1s; lệnh đang treo = thất bại.
- Core drain command queue ở bước 4 scan loop; queue đầy (>64 lệnh/scan) → rejected "busy".
- Response trả SAU resolve + safe-state (step 7) trong CÙNG scan — applied_value/active_source
  là giá trị THẬT sau khi mọi nguồn tranh chấp xong, không phải giá trị client vừa gửi.
- source không trong enum (manual/bacnet) → rejected "unknown_source" — không mở rộng thêm
  source mới mà không cập nhật doc này + 07 §4 bảng priority.
- Audit core in 1 dòng/lệnh ra stderr→journald, format chuẩn:
    AUDIT cmd id=<id> user=<user> point=<point> op=<op> value=<v> result=<r> active_source=<src>
  (user sanitize [A-Za-z0-9_.@:-], max 48 ký tự — chống log injection; bacnet IP dùng dấu :);
  web ghi {ts, user, point, op, value, result, active_source} vào eventlog.
- ĐÃ implement đủ 3 result 2026-06-12 (COR-007). source=bacnet: thêm vào web_ipc cùng BAC-006.
```

### 8.1 Coherent historian snapshot IPC (`COR-HIST-001`, DONE — core/local)

Core không ghi SQLite. Web historian yêu cầu một snapshot physical bất biến từ cùng scan, sau priority resolve + safe-state.

Request:

```json
{"id":1,"op":"point_snapshot","user":"web"}
```

Response:

```json
{"id":1,"result":"accepted","snapshotId":42,"snapshotObservedAtUtc":"2026-07-15T10:00:00.000Z","capturedMonotonicNs":1200,"points":[{"id":"AO-01","kind":"AO","value":5.0,"quality":"GOOD","source":"manual","role":"resolved_setpoint","unit":"V","updatedAtMonotonicNs":1234,"generation":1}]}
```

Rules:

- one request returns exactly 24 rows: UI-01..16 engineering values, AO-01..04 post-safe resolved setpoints and DO-01..04 hardware feedback from one completed scan;
- DI is deferred until capability authority/SKU contract defines its runtime source; Rev A response does not emit DI rows;
- each point carries `quality/source/role/unit/updatedAtMonotonicNs/generation`;
- wire quality is uppercase `GOOD`/`UNCERTAIN`/`BAD`; non-finite values serialize as JSON `null` with `BAD`;
- UI and DO source is `io`; AO source is actual winner `safety`/`manual`/`bacnet`/`schedule`/`logic`/`default` after priority resolve and safe-state;
- `generation=1` is fixed for Rev A physical rows; canonical ID plus generation remains historian identity;
- core does not read config display name/tag and does not union backend VP;
- web copies VP runtime registry immediately after core response and freezes both producers into one web snapshot;
- no sequential per-point reads; no stale authoring VP value;
- snapshot operation is strictly parsed top-level JSON and read-only; malformed/duplicate/wrong-type requests are rejected and no point/priority state mutates;
- server caps 4 clients, 4 accepts/scan, 64 KiB read/scan, 16 KiB read/client, 64 lines/scan, 16 lines/client, 64 KiB write/scan and 16 KiB write/client with rotating client start; one snapshot is accepted per drain;
- physical AO/DO output is written before nonessential snapshot model serialization/publication;
- cached payload is serialized once per publication into a fixed 65,536-byte buffer with no heap allocation on the zero-client per-scan path, retained over partial writes/half-close, and fatal send/input-cap states close deterministically;
- synthetic worst-width stress fixture produces a 6,427-byte accepted JSON line including newline; its schedule source and max generation are not legal Rev A runtime metadata, so this is bounded host-stress evidence, not a runtime/protocol maximum.

Evidence commands (WSL/Ninja, Release):

```bash
cmake --fresh -S . -B build/core-release-task5-on -G Ninja -DCMAKE_BUILD_TYPE=Release -DCORE_BUILD_TESTS=ON
cmake --build build/core-release-task5-on -j2
ctest --test-dir build/core-release-task5-on --output-on-failure
cmake --fresh -S . -B build/core-release-task5-off -G Ninja -DCMAKE_BUILD_TYPE=Release -DCORE_BUILD_TESTS=OFF
cmake --build build/core-release-task5-off -j2
```

Local result 2026-07-17: full Release CTest 209/209; focused RuntimePointSnapshot/WebIpc/ScanLoop 64/64; production OFF build pass; `git diff --check` pass. Tests cover coherence, output-before-publication ordering, timestamp transitions and bounds, seqlock reuse, strict JSON, UTF-8/units, non-finite values, zero allocations across 1,000 warmed model builds plus zero-client publications, socket quotas and cached serialization.

Trạng thái: **DONE 2026-07-17 cho COR-HIST-001 core/local gates**. Không đổi `shared/mkddc_shm.h`, không SQLite/DB dependency, không backend/FE change. Không claim board jitter hoặc historian release: `WEB-HIST-001..005` và `E2E-HIST-001` vẫn mở; target-board NFR/eMMC/recovery thuộc E2E evidence.

**SIGHUP reload (CONFIG_SCHEMA D-5 — `io_safe_state.conf` → SIGHUP core, ĐÃ implement 2026-06-12, COR-008):**
```
- SIGHUP → reload io_config.conf + io_safe_state.conf + graph.json Ở RANH GIỚI scan
  (trước step kế tiếp — không nuốt config giữa lúc đang resolve).
- Fail bất kỳ phần nào → GIỮ config cũ + WARN (khác boot: boot fail-fast).
- Manual/priority đang active GIỮ NGUYÊN (priority array không reset).
- Graph: GraphRuntime::reload() swap-on-success; nội dung file không đổi → giữ
  nguyên state node (PID integral không reset); đổi nội dung → reset state (chấp nhận Rev A).
- declared scan_ms đổi qua reload KHÔNG đổi chu kỳ đang chạy (cần restart) — graph dt
  được re-sync về chu kỳ thật, lệch → WARN.
- systemd: systemctl reload mkddc-core (ExecReload=kill -HUP, §9).
```

---

## 9. Build / install / run

**`apps/core/CMakeLists.txt` — trích để tham khảo:**

> Sau `PLAN-ARCH-RESTRUCT-002`, `CMakeLists.txt` **ở gốc repo** là entrypoint duy nhất và `apps/core/CMakeLists.txt` được nạp qua `add_subdirectory`. Đoạn dưới là mẫu lịch sử để hiểu cấu trúc target, **không** còn copy ra dùng độc lập được.
```cmake
cmake_minimum_required(VERSION 3.16)
project(mkddc-core CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -Werror)

set(SHARED_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../shared)

add_library(core_lib STATIC
    scan_loop.cpp point_table.cpp point_quality.cpp graph_runtime.cpp
    priority_resolver.cpp safe_state.cpp safe_state_config.cpp
    iobus_reader.cpp output_writer.cpp
    bacnet_objtable.cpp web_ipc.cpp core_metrics.cpp)
target_include_directories(core_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} ${SHARED_DIR})
target_link_libraries(core_lib PUBLIC pthread rt)

add_executable(mkddc-core main.cpp)
target_link_libraries(mkddc-core PRIVATE core_lib)

include(FetchContent)
FetchContent_Declare(googletest
  URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip)
FetchContent_MakeAvailable(googletest)
enable_testing()
add_executable(core_tests
    tests/test_iobus_reader.cpp tests/test_point_quality.cpp
    tests/test_priority_resolver.cpp tests/test_safe_state.cpp tests/test_scan_loop.cpp)
target_link_libraries(core_tests PRIVATE core_lib gtest_main)
include(GoogleTest)
gtest_discover_tests(core_tests)
```
**Build + test local:**

> **Sau `PLAN-ARCH-RESTRUCT-002`:** `CMakeLists.txt` **ở gốc repo** là entrypoint duy nhất; không cấu hình riêng từng service. Giữ `--fresh` để build dir cũ trỏ `services/` không làm ra số đo giả.

```bash
cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release
cmake --build build/fw -j
ctest --test-dir build/fw --output-on-failure
```
**Chạy dev không cần board:** chạy `mkddc-iobus` + fake MCU trước (06 §11.1) →
`./build/core/mkddc-core --log-level debug` → xem point table phản ánh UI ramp của fake MCU.

**systemd unit ĐẦY ĐỦ (file thật: `platform/systemd/mkddc-core.service` — SKEL-005,
install bằng `platform/packaging/install.sh`; bản dưới là trích các dòng cấu hình, chú thích lý do nằm trong file thật):**
```ini
# /etc/systemd/system/mkddc-core.service
[Unit]
Description=MK-DDC-24 core service (point table, priority, safe-state)
# iobus tạo SHM → core chạy sau. Wants (không Requires): iobus restart không kéo core chết.
After=mkddc-iobus.service
Wants=mkddc-iobus.service

[Service]
Type=notify                     # READY=1 sau scan đầu tiên
ExecStart=/usr/sbin/mkddc-core --programming-runtime --st-trusted-key /data/mkddc/keys/device.pub
# ADR-061 C4: CPU3 chỉ được vào WFI (root, "-" = bo không có cpuidle vẫn khởi động)
ExecStartPre=-+/bin/sh -c 'echo 20 > /sys/devices/system/cpu/cpu3/power/pm_qos_resume_latency_us'
ExecStopPost=-+/bin/sh -c 'echo 0 > /sys/devices/system/cpu/cpu3/power/pm_qos_resume_latency_us'
# ADR-061 4.11: workqueue unbound + kthreadd + kernel thread không gắn CPU sang
# CPU0–2; PID 1 + mọi tiến trình khác do /etc/systemd/system.conf.d/mkddc-rt.conf
# (CPUAffinity=0-2) đưa khỏi CPU3
ExecStartPre=-+/usr/libexec/mkddc/rt-housekeeping 0-2 7
# ADR-061 4.11 / F17: governor performance cho cụm CPU chứa CPU3; release trả governor cũ
ExecStartPre=-+/usr/libexec/mkddc/rt-cpufreq hold 3
ExecStopPost=-+/usr/libexec/mkddc/rt-cpufreq release 3
ExecReload=/bin/kill -HUP $MAINPID   # reload config ở ranh giới scan (§8, COR-008)
User=mkddc
Group=mkddc
RuntimeDirectory=mkddc          # /run/mkddc (core.sock)
RuntimeDirectoryMode=0770
RuntimeDirectoryPreserve=yes
StateDirectory=mkddc
Restart=always
RestartSec=2
WatchdogSec=6                   # kick tối đa 1 lần/giây (ADR-061 4.8)
CPUSchedulingPolicy=fifo
CPUSchedulingPriority=80        # cao hơn iobus (70)
CPUAffinity=3                   # ADR-061 4.11: CPU3 dành riêng cho Core
LimitRTPRIO=85
LimitMEMLOCK=infinity           # mlockall() tránh page fault trong scan
AmbientCapabilities=CAP_SYS_NICE CAP_IPC_LOCK
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
```

---

## 10. Quy tắc bắt buộc

```
1. Mọi DO/AO qua priority_resolver. KHÔNG có đường ghi tắt.
2. Core KHÔNG mở UART, KHÔNG nói chuyện MCU (đó là iobus).
3. Scan loop tuyệt-đối-thời-gian (clock_nanosleep ABSTIME); không sleep tương đối.
4. Đọc shm bằng seqlock reader (§7.1); không block iobus; chỉ ghi 2 field core sở hữu (§7.2).
5. IO fault → quality bad → safe-state; không giả "good".
6. Stub (web_ipc/bacnet_objtable) phải có interface THẬT — thay implementation
   sau, KHÔNG đổi API (tránh sửa dây chuyền).
```

---

## 12. Protocol graph nodes — implementation spec (COR-011)

> **Trạng thái:** ĐÃ làm 2026-06-26 — 5 Protocol node type (NT_MRTU_R/W, NT_MTCP_R, NT_BAV, NT_BBV); str_params map; proto_ext_idx từ modbus section graph.json; feed_ext_snapshot + apply_ext_writes; scan_loop step 3a/5a; drain_ext_writes() write bridge (2026-06-27); 12/12 test pass. Task: COR-011 trong 11_TASK_CHECKLIST.
> **Nguồn contract:** [GRAPH_SCHEMA §10](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) + [SW_COMPONENT_LIBRARY §8](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md).

### 12.1 Scan loop step 3 — ext_cache reader

Thay thế stub "Read Modbus(cache): bỏ qua" bằng:

```cpp
// Step 3 — Protocol node input update (trước graph execute)
for (auto& node : graph_runtime.protocol_readers()) {
    if (node.type == NodeType::MODBUS_RTU_READ ||
        node.type == NodeType::MODBUS_TCP_READ) {
        ExtPoint pt;
        if (ext_cache.lookup(node.params, &pt) && pt.quality == GOOD) {
            node.set_output(pt.value * node.scale);
            node.set_quality(Quality::GOOD);
        } else {
            node.set_output(node.fallback);
            node.set_quality(Quality::BAD);
        }
    }
    // BACnet_AV/BV: đọc từ bacnet_objtable (đã có trong BAC-004)
    if (node.type == NodeType::BACNET_AV || node.type == NodeType::BACNET_BV) {
        float pv; Quality q;
        bacnet_objtable.read_av(node.instance, &pv, &q);
        node.set_output(pv);
        node.set_quality(q);
    }
}
```

### 12.2 graph_runtime thay đổi

Cần thêm vào `graph_runtime.cpp`:

1. **NodeType enum**: thêm `MODBUS_RTU_READ`, `MODBUS_RTU_WRITE`, `MODBUS_TCP_READ`, `BACNET_AV`, `BACNET_BV`.
2. **build_plan()**: parse Protocol node type từ JSON, validate params (gọi validator check #4/#5/#6).
3. **protocol_readers()**: iterator trả các node có type thuộc Protocol group.
4. **`Modbus_RTU_Write` tick()**: trong execute(), push `in` value vào `fieldbus_write_queue` nếu thay đổi.
5. **`BACnet_AV/BV` write path**: nếu `in` wired → push setpoint vào `bacnet_objtable` mức 5 (graph).

### 12.3 ext_cache key lookup

```cpp
// RTU: key = (bus, slave, addr, fc)
// TCP: key = (host, port, unit, addr, fc)
bool ExtCache::lookup(const NodeParams& p, ExtPoint* out);
```

`ExtCache` hiện dùng linear scan trên `plc_shm.ext[]`. Cần extend hoặc thêm index cho TCP key.

### 12.4 Unit test checklist COR-011

```
[x] test_graph_protocol.cpp — Modbus_RTU_Read node: output = cached_value × scale khi GOOD
[x] Modbus_RTU_Read node: output = fallback khi cache stale
[x] Modbus_RTU_Write node: in=5.0 → fieldbus_write_queue nhận entry đúng
[x] Modbus_TCP_Read node: output = tcp_cached_value × scale khi GOOD
[x] Modbus_TCP_Read node: output = fallback khi TCP disconnected (quality BAD)
[x] BACnet_AV node (writable=false): out = bacnet_objtable.read_av(instance)
[x] BACnet_AV node (writable=true, in=22.5): bacnet_objtable.pv == 22.5 tại mức 5
[x] BACnet_BV node: in=true → bacnet_objtable active; out=false khi BMS write false
[x] graph validator: Modbus_TCP_Read host không trong modbus.tcp[] → reject
[x] graph validator: Modbus_RTU_Read missing fallback → reject
[x] Topo-sort không thay đổi: Protocol node không tạo cycle
[x] Quality BAD lan downstream: node sau Protocol node BAD cũng BAD (weakest-link)
```

### 12.5 Files cần tạo/sửa

> **Đối chiếu mã 2026-08-19.** Bảng dưới là kế hoạch gốc của `COR-011` (đường dẫn `services/core/`
> thời đó). Chỗ đã làm thật, theo cây `apps/core/` hiện hành:

| File kế hoạch | Hiện trạng trong mã |
|------|---------|
| `services/core/graph_runtime.{cpp,hpp}` — 5 Protocol node type + NodeType enum | `apps/core/domain/graph/graph_runtime.{cpp,hpp}` — **có** |
| `services/core/scan_loop.cpp` — step 3 ext_cache reader loop | `apps/core/application/runtime/scan_loop.cpp` — **có** |
| `services/core/ext_cache_reader.hpp` (mới) | **không tạo** — logic lookup nằm trong `graph_runtime` thay vì tách file riêng |
| `services/core/tests/test_graph_protocol.cpp` (mới) | `apps/core/domain/graph/tests/test_graph_protocol.cpp` — **có** |

---

## 11. Done criteria (Phase 4 đóng) + Trace

| Chủ đề | Module | Done khi | Test |
|--------|--------|----------|------|
| Scan 1s | scan_loop | 1000 scan không overrun, drift=0 | group 4 / test_scan_loop |
| Point table 24 IO | point_table | phản ánh shm ≤1 scan | group 4 |
| Priority 6 mức | priority_resolver | bảng test §4 pass | group 4 + group 6 (E2E) |
| Safe-state | safe_state | fault → output an toàn ≤1 scan | group 7 (fault inject) |
| Quality bad | point_quality | rút UART → BAD ≤2 scan | group 7 |
| Output path | output_writer | do_cmd[0]=1 → relay ≤1 chu kỳ poll | group 6 (E2E) |
| Web command | web_ipc | đủ 3 result §8 (accepted/rejected/overridden) + audit | group 5/6 + test_web_ipc |
| Config reload | config_reload | SIGHUP đổi default mức 6 không restart, manual giữ | test_config_reload |
| Stateful graph | graph_runtime/state_snapshot | COR-009/010 pass theo doc 22 | unit + group 4 |
| BACnet object | bacnet_objtable/BACnet bridge | BAC-001..011 pass theo doc 24 nếu thuộc scope | group 9 |
| Historian snapshot | web_ipc/point_table/scan_loop | one-scan UI/AO/DO snapshot with quality/source/role/generation; core does not write DB | COR-HIST-001 tests |

Trạng thái: ĐÃ làm 2026-06-17 — BAC-004 (bacnet_objtable publish+read_ext), web_ipc source=bacnet mức 3, fieldbus.sock SOCK_DGRAM mở trong main.cpp, scan_loop step 3 ext socket + step 4 cmd.prio routing; 106 core test pass.

---
**Rev** 1.11 | 2026-07-17 — Closed COR-HIST-001 core/local evidence with Release 209/209, output-before-publication ordering, allocation-free fixed-buffer publication and explicit downstream target gates. · **Rev** 1.10 | 2026-07-15 — Corrected point table to frozen 16 UI + optional 8 DI + 4 AO + 4 DO; added owner-approved read-only coherent historian snapshot IPC contract and COR-HIST-001 tests. · **Rev** 1.9 | 2026-06-27 (§12 COR-011 DONE: annotate status, tick T1-T12 test checklist, drain_ext_writes() write bridge documented) · 1.8 | 2026-06-26 (§12 Protocol graph nodes COR-011 — scan loop step 3 spec, graph_runtime extension, unit test checklist; §2 step 3 cập nhật ext_cache reader) ·
1.7 | 2026-06-17 (BAC-004+MOD-009 core: bacnet_objtable.cpp dùng iop_protocol.h, fieldbus.sock mở trong main.cpp, web_ipc source=bacnet mức 3, scan_loop routing — 106 test pass) ·
1.6 | 2026-06-17 (§8: BAC-CONFLICT-001 CLOSED — mở rộng core.sock nhận source=bacnet mức 3,
BACnet client persistent connection, audit format cập nhật, rejected "unknown_source" added) ·
1.5 | 2026-06-13 (S7 #4/#5/#6 docs linked; priority test fixed web/manual=mức 2) ·
1.4 | 2026-06-12 (web_ipc overridden+audit, SIGHUP reload, packaging/systemd) ·
1.3 | 2026-06-12 · Freeze: [16_CONTRACT_FREEZE](archive/16_CONTRACT_FREEZE.md) ·
DoD: [13_DEFINITION_OF_DONE §4](13_DEFINITION_OF_DONE.md)
