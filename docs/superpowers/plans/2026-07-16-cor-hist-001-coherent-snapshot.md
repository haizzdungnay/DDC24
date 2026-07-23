# COR-HIST-001 Coherent Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded read-only core IPC operation returning one immutable UI/AO/DO historian snapshot captured after priority resolution and safe-state.

**Architecture:** A stateful fixed-size `RuntimePointSnapshotPublisher` builds one snapshot after resolve/safe-state, tracks source-age timestamps and publishes one pre-serialized immutable payload to `WebIpc`. `WebIpc` serves the latest completed payload on `point_snapshot` with strict parsing and bounded per-scan socket work; requests never trigger point-by-point runtime reads or database work. Physical point generation is fixed at `1` for Rev A; VP generation remains backend-owned and outside core.

**Tech Stack:** C++17, Unix stream socket, existing core runtime classes, nlohmann/json already linked by `core_lib`, GoogleTest, CMake/CTest.

**Source Spec:** `docs/03_implementation/42_HISTORIAN_FE_PROTOTYPE_PLAN.md` §4, `docs/02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md` §11b, `docs/03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md` §8.1.

---

## File Map

| File | Responsibility |
|---|---|
| `services/core/runtime_point_snapshot.hpp/.cpp` | Fixed-size model, stateful publisher and bounded serializer |
| `services/core/web_ipc.hpp/.cpp` | Parse `point_snapshot`, retain latest completed snapshot, send response |
| `services/core/scan_loop.cpp` | Publish snapshot after resolve + safe-state |
| `services/core/tests/test_runtime_point_snapshot.cpp` | Value/source/role/quality/unit/generation/coherence tests |
| `services/core/tests/test_web_ipc.cpp` | Real-socket request, malformed request and response-bound tests |
| `services/core/CMakeLists.txt` | Register implementation and test source |
| `docs/03_implementation/{07_MKDDC_CORE_IMPLEMENTATION_GUIDE,11_TASK_CHECKLIST,22_SOM_SRC_IMPLEMENTATION_PLAN}.md` | Record actual status/evidence |
| `CHANGELOG.md` | Record product change and verification |

No changes to `shared/mkddc_shm.h`, web backend, SQLite, tag/name metadata or frontend.

### Task 1: Fixed Runtime Snapshot Model

**Files:**
- Create: `services/core/runtime_point_snapshot.hpp`
- Create: `services/core/runtime_point_snapshot.cpp`
- Create: `services/core/tests/test_runtime_point_snapshot.cpp`
- Modify: `services/core/CMakeLists.txt:16-20,37-44`
- Modify if unit copy is missing: `services/core/iobus_reader.hpp`, `services/core/iobus_reader.cpp`

- [ ] **Step 1: Write failing model tests**

Construct `PointTable`, `IoSnapshot`, `OutputCmd` and `PriorityResolver`, then assert fixed ordering and metadata:

```cpp
RuntimePointSnapshotPublisher publisher;
const RuntimePointSnapshot snapshot = publisher.build(
    7, observed_utc_ms, captured_monotonic_ns, table, io, resolved,
    resolver, safe_state_active);

ASSERT_EQ(snapshot.count, KX_N_UI + KX_N_AO + KX_N_DO);
EXPECT_EQ(snapshot.snapshot_id, 7u);
EXPECT_STREQ(snapshot.rows[0].id, "UI-01");
EXPECT_STREQ(snapshot.rows[KX_N_UI].id, "AO-01");
EXPECT_STREQ(snapshot.rows[KX_N_UI + KX_N_AO].id, "DO-01");
EXPECT_EQ(snapshot.rows[0].generation, 1u);
```

Also assert UI engineering value/quality/unit, AO resolved value/source/role and DO feedback/role.

- [ ] **Step 2: Register tests and verify RED**

Run:

```bash
cmake -S services/core -B build/core -DCMAKE_BUILD_TYPE=Debug
cmake --build build/core --parallel
```

Expected: build fails because runtime snapshot symbols do not exist.

- [ ] **Step 3: Add minimal fixed-size model**

Use no heap allocation while building:

```cpp
constexpr std::size_t KX_HIST_PHYSICAL_COUNT = KX_N_UI + KX_N_AO + KX_N_DO;

struct RuntimePointSnapshotRow {
    char id[8] = {};
    char kind[3] = {};
    float value = 0.0f;
    kx_quality_t quality = KX_Q_BAD;
    SnapshotSource source = SnapshotSource::DEFAULT;
    const char* role = "";
    char unit[8] = {};
    uint64_t updated_at_monotonic_ns = 0;
    uint64_t generation = 1;
};
```

Builder rules:

- UI: `PointTable` engineering value/quality; unit from same `IoSnapshot.ui_unit`; update time from `io.ts_ns`, not `PointTable::update_inputs()` time.
- AO: post-safe `OutputCmd`; dedicated snapshot source from `safety` or `prio_source_name(winning level)`; role `resolved_setpoint`; unit `mA` for AO mode 1, otherwise `V`.
- DO: hardware feedback from `PointTable`, source `io`, role `hardware_feedback`; update time from `io.ts_ns`; never substitute command output.
- Physical generation: `1` until physical generation authority exists.

Use a dedicated `SnapshotSource` enum/string mapping (`io|safety|manual|bacnet|schedule|logic|default`); do not extend or reinterpret `PointSource`. `RuntimePointSnapshotPublisher` stores prior AO value/source and changes AO `updatedAtMonotonicNs` only when either changes; first publish uses capture monotonic time. UI/DO use producer `io.ts_ns`, so reuse after seqlock failure preserves age. Carry `ui_unit` in `IoSnapshot` if absent. Never reread live SHM during build.

`ScanLoop` owns one `RuntimePointSnapshotPublisher snapshot_publisher_` member. Each `step()` calls `snapshot_publisher_.build(...)`; no stateless free builder exists. Tests use same publisher instance across consecutive builds.

Rev A response is exactly 24 UI/AO/DO rows. Optional DI remains outside this slice until a real SKU capability authority exists.

- [ ] **Step 4: Run focused model tests**

```bash
cmake --build build/core --parallel
ctest --test-dir build/core --output-on-failure -R RuntimePointSnapshot
```

Expected: all `RuntimePointSnapshot.*` tests pass.

- [ ] **Step 5: Commit boundary if requested**

```bash
git add services/core/runtime_point_snapshot.hpp services/core/runtime_point_snapshot.cpp services/core/tests/test_runtime_point_snapshot.cpp services/core/CMakeLists.txt services/core/iobus_reader.hpp services/core/iobus_reader.cpp
git commit -m "feat(core): add historian snapshot model"
```

### Task 2: Publish One Completed Snapshot Per Scan

**Files:**
- Modify: `services/core/web_ipc.hpp/.cpp`
- Modify: `services/core/scan_loop.hpp`
- Modify: `services/core/scan_loop.cpp:121-168`
- Test: `services/core/tests/test_runtime_point_snapshot.cpp`
- Test: `services/core/tests/test_scan_loop.cpp`

- [ ] **Step 1: Write failing scan coherence tests**

Run two scans with changed UI, AO winner and DO feedback. Assert:

- snapshot ID increments once per completed scan;
- rows never mix scans;
- AO equals `out` after `SafeState::apply`;
- DO equals hardware feedback, not `out.dout`;
- unchanged AO keeps prior update timestamp; changed AO value/source advances it;
- reused `last_io_` keeps UI/DO producer timestamp;
- snapshot unavailable before first completed scan.

- [ ] **Step 2: Run RED test**

```bash
cmake --build build/core --parallel
ctest --test-dir build/core --output-on-failure -R "RuntimePointSnapshot|ScanLoop"
```

Expected: fail because `WebIpc` has no publication API.

- [ ] **Step 3: Publish latest completed value**

Add `WebIpc::publish_point_snapshot(const RuntimePointSnapshot&)`. Serialize once during publish into a bounded cached points payload; requests only wrap it with request `id`. Scan and socket handling share scan thread, so no lock needed.

Under `CORE_BUILD_TESTS` only, expose read-only `snapshot_cache_state_for_test()` and `snapshot_for_test()` accessors. Task 2 scan tests use these accessors before Task 3 adds socket request handling; production build exports no observation API.

Build/publish immediately after `SafeState::apply(last_io_, *table, &out)` and before responses/output publication. Capture `CLOCK_REALTIME` and `CLOCK_MONOTONIC` once per snapshot, not per row.

- [ ] **Step 4: Run focused regressions**

```bash
cmake --build build/core --parallel
ctest --test-dir build/core --output-on-failure -R "RuntimePointSnapshot|ScanLoop|WebIpc"
```

Expected: focused suites and existing command/alarm tests pass.

- [ ] **Step 5: Commit boundary if requested**

```bash
git add services/core/web_ipc.hpp services/core/web_ipc.cpp services/core/scan_loop.hpp services/core/scan_loop.cpp services/core/tests/test_runtime_point_snapshot.cpp services/core/tests/test_scan_loop.cpp
git commit -m "feat(core): publish coherent scan snapshots"
```

### Task 3: Read-Only `point_snapshot` IPC

**Files:**
- Modify: `services/core/web_ipc.hpp`
- Modify: `services/core/web_ipc.cpp:313-423`
- Modify: `services/core/tests/test_web_ipc.cpp`

- [ ] **Step 1: Write failing real-socket tests**

Request:

```json
{"id":21,"op":"point_snapshot","user":"web"}
```

Assert accepted response has `snapshotId`, `snapshotObservedAtUtc`, `capturedMonotonicNs` and exactly 24 default UI/AO/DO rows. Also assert:

- before first scan: `snapshot_unavailable`;
- missing user: `bad_request`;
- malformed JSON, wrong/fractional/negative/overflow ID, wrong field types and duplicate keys: `bad_request`;
- extra write/value fields cannot mutate output;
- response `<=64 KiB`;
- quote/backslash/control bytes in copied unit remain valid escaped JSON;
- forced partial write/EAGAIN later completes one valid framed JSON line;
- slow/disconnected client cannot change cached snapshot or exceed per-scan budget.

- [ ] **Step 2: Run RED test**

```bash
cmake --build build/core --parallel
ctest --test-dir build/core --output-on-failure -R WebIpc
```

Expected: new tests fail with `bad_request` or missing response.

- [ ] **Step 3: Implement bounded operation**

Do not enqueue `PointSnapshot` into `ScanLoop` command/alarm queues. Handle it inside bounded `WebIpc::drain()` using latest snapshot completed by previous scan; before first publish return `snapshot_unavailable`. Parse this operation with `nlohmann::json` strict parsing, require top-level object, unsigned integer `id`, exact string `op`, and non-empty string `user`; reject duplicate keys with parser callback. Existing command parser stays unchanged in this slice.

Wire quality as uppercase `GOOD|UNCERTAIN|BAD`, matching core guide §8.1 and downstream `HistorySample`; update Plan 42 example casing during evidence reconciliation. Convert UTC milliseconds to RFC3339 with millisecond precision and `Z`. Reject `snapshot_too_large`; never truncate JSON. No DB/config/tag/name/VP reads.

Bound socket work:

- maximum 4 connected clients; close extra accepts immediately;
- maximum 4 `accept4()` attempts per scan, then stop until next scan even if backlog refills;
- maximum 64 KiB read and 64 lines parsed per scan;
- maximum one accepted snapshot request per scan; extra requests return `busy` if output budget remains;
- maximum 64 KiB outbound buffer per client and 64 KiB snapshot bytes flushed per scan;
- retain per-client output buffers; retry `EINTR`, continue later scan on `EAGAIN`, and remove only bytes actually sent;
- peer close discards only its buffer; never block or emit truncated JSON.

Before removing a complete request line from client input, reserve room for its full worst-case framed response. If reservation fails, leave line buffered for next scan. If one line can never fit per-client ceiling, queue bounded `response_too_large` and close after flush; never silently drop a consumed request.

Snapshot cache has explicit `unavailable|ready|too_large` state. A publish over 64 KiB replaces prior ready state with `too_large`; subsequent request returns `snapshot_too_large`, never stale snapshot ID.

Keep existing small command response behavior unchanged unless tests require a shared buffered path; avoid unrelated refactor.

- [ ] **Step 4: Run focused IPC tests**

```bash
cmake --build build/core --parallel
ctest --test-dir build/core --output-on-failure -R WebIpc
```

Expected: all WebIpc tests pass.

- [ ] **Step 5: Commit boundary if requested**

```bash
git add services/core/web_ipc.hpp services/core/web_ipc.cpp services/core/tests/test_web_ipc.cpp
git commit -m "feat(core): expose historian snapshot IPC"
```

### Task 4: Bounds, Timestamp and Latency Gates

**Files:**
- Modify: `services/core/tests/test_runtime_point_snapshot.cpp`
- Modify: `services/core/tests/test_web_ipc.cpp`
- Modify: `services/core/tests/test_scan_loop.cpp`

- [ ] **Step 1: Add edge-case tests**

Cover:

- 7-character and non-terminated SHM units truncate safely;
- NaN/Inf serializes `value:null`, forces wire quality `BAD`, and omits numeric aggregate fields; AO comparison treats two non-finite values with same source as unchanged so timestamp does not advance each scan;
- source timestamp remains old when `last_io_` is reused after seqlock failure;
- IDs monotonic across scans;
- UTC epoch/millisecond rollover;
- full 24-row response below 64 KiB.

- [ ] **Step 2: Add non-flaky allocation gate**

Run 1,000 in-memory publisher builds with test allocation counter and assert zero model-construction allocations; serialization may allocate once per publish but requests reuse cached payload. Add socket stress with 4 clients and 64 lines; hard-assert accept/read/parse/write counters stay within limits and one serialization occurs per publish, not per request. Collect host timing as evidence only; target NFR jitter `<=5ms` remains board evidence.

Make partial-write tests deterministic through a test-only injected send adapter owned by `WebIpc` (production default calls `::send`). Adapter scripts `EINTR`, short write, `EAGAIN`, then success; assert retained offsets and one valid final JSON line. Do not depend on host socket buffer size.

- [ ] **Step 3: Run focused tests**

```bash
cmake --build build/core --parallel
ctest --test-dir build/core --output-on-failure -R "RuntimePointSnapshot|WebIpc|ScanLoop"
```

Expected: all focused tests pass.

- [ ] **Step 4: Run full core suite**

```bash
ctest --test-dir build/core --output-on-failure
```

Expected: 100% core tests pass.

- [ ] **Step 5: Commit boundary if requested**

```bash
git add services/core/tests/test_runtime_point_snapshot.cpp services/core/tests/test_web_ipc.cpp services/core/tests/test_scan_loop.cpp
git commit -m "test(core): harden historian snapshot bounds"
```

### Task 5: Evidence and Status Reconciliation

**Files:**
- Modify: `docs/03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md:398-427`
- Modify: `docs/03_implementation/11_TASK_CHECKLIST.md:935-945`
- Modify: `docs/03_implementation/22_SOM_SRC_IMPLEMENTATION_PLAN.md:744-770`
- Modify: `CHANGELOG.md` under `[Unreleased]`

- [ ] **Step 1: Run final verification**

```bash
cmake -S services/core -B build/core -DCMAKE_BUILD_TYPE=Release
cmake --build build/core --parallel
ctest --test-dir build/core --output-on-failure
git status --short
git diff --check
```

Expected: build succeeds, 100% tests pass, diff check clean.

- [ ] **Step 2: Record exact evidence**

Record actual test count, commands and maximum observed response size. Mark `COR-HIST-001` Done only after all gates pass. Keep `WEB-HIST-001..005` planned.

- [ ] **Step 3: Confirm scope**

Inspect `git status --short`, including untracked files, then scoped diffs for every explicit file in File Map. Expected: this task introduces no SHM ABI, backend, frontend or SQLite changes. Existing unrelated dirty files remain untouched.

- [ ] **Step 4: Commit boundary if requested**

```bash
git add services/core/runtime_point_snapshot.hpp services/core/runtime_point_snapshot.cpp services/core/iobus_reader.hpp services/core/iobus_reader.cpp services/core/web_ipc.hpp services/core/web_ipc.cpp services/core/scan_loop.hpp services/core/scan_loop.cpp services/core/tests/test_runtime_point_snapshot.cpp services/core/tests/test_web_ipc.cpp services/core/tests/test_scan_loop.cpp services/core/CMakeLists.txt docs/03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md docs/03_implementation/11_TASK_CHECKLIST.md docs/03_implementation/22_SOM_SRC_IMPLEMENTATION_PLAN.md CHANGELOG.md
git commit -m "docs(core): close COR-HIST-001 evidence"
```

## Execution Notes

- Preserve unrelated dirty FE/backend files; never stage them.
- Do not commit unless owner explicitly requests commits.
- If Windows host cannot build Unix socket code, run commands in existing WSL environment and record environment.
- `point_snapshot` is read-only. DB/config reads or resolver/output mutation fail review.
- `updatedAtMonotonicNs` describes source update age, not request time.
