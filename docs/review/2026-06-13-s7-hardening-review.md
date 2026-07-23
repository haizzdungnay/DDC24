# 23 — Code Review Report: S7 Hardening Cluster 1+2+3
## MK-DDC-24 — Findings từ code review PR #13 (commit `adedeeb`)

> **Document ID:** CR-S7-CLUSTER123-MK-DDC-24
> **Phiên bản:** 1.0 | 2026-06-13
> **Scope commit:** `adedeeb` — feat: S7 hardening cụm 1+2+3
> **Nội dung PR:** web_ipc overridden+audit (COR-007), SIGHUP reload (COR-008), packaging/systemd (SKEL-005)
> **Reviewer:** Claude Code (high-effort — 7 angles × multi-agent verify)
> **Đọc cùng:** [11_TASK_CHECKLIST](../03_implementation/11_TASK_CHECKLIST.md) · [07_MKDDC_CORE_IMPLEMENTATION_GUIDE](../03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md)

---

## Tổng quan

| Severity | Số lượng | Trạng thái |
|----------|----------|------------|
| HIGH (fix ngay trước merge tiếp theo) | 2 | ✅ ✅ |
| MEDIUM (fix trong sprint này) | 3 | ✅ ✅ ✅ |
| LOW / Cleanup | 5 | ✅ ✅ ✅ ✅ ✅ |
| **Tổng** | **10** | |

---

## HIGH — Phải fix trước khi merge PR tiếp theo

---

### CR-001 — Log injection qua `point_name` không sanitize

**File:** `services/core/web_ipc.cpp` — `handle_line()` ~line 192, `audit()` ~line 139
**Severity:** HIGH — Security (audit log forgery)

**Vấn đề:**
`cmd.user` được sanitize qua `sanitize_user()` (allowlist `[A-Za-z0-9_.@-]`, max 32 ký tự).
Nhưng `cmd.point_name` được gán thẳng từ JSON input **không qua bất kỳ sanitize nào**, rồi
in trực tiếp vào `fprintf(stderr, "AUDIT ... point=%s ...")`.

```cpp
// handle_line() — KHÔNG sanitize:
if (jget_string(line, "point", &point))
    cmd.point_name = point;   // ← raw, bất kỳ ký tự nào đều qua

// audit() — in verbatim:
std::fprintf(stderr,
    "AUDIT web_cmd id=%llu user=%s point=%s ...\n",
    ..., cmd.point_name.c_str(), ...);   // ← \n trong point_name = inject log line
```

**Kịch bản tấn công:**
```json
{"id":1,"op":"write","point":"DO1\nAUDIT web_cmd id=999 user=admin point=DO1 op=write value=1 result=accepted active_source=manual","source":"manual","user":"t"}
```
→ journald nhận 2 dòng log: dòng thật + dòng giả mạo. Ngay cả `rejected` path cũng in `point_name` vì `respond_rejected` gọi `audit()`.

**Fix:**
```cpp
// Thêm helper (giống sanitize_user):
static std::string sanitize_point_name(const std::string& s)
{
    std::string out;
    out.reserve(8);
    for (const char c : s) {
        if (std::isalnum(static_cast<unsigned char>(c)))
            out += c;
        if (out.size() >= 8) break;   // "DO1".."MSV8" max 8 ký tự
    }
    return out.empty() ? "-" : out;
}

// handle_line():
if (jget_string(line, "point", &point))
    cmd.point_name = sanitize_point_name(point);   // ← thêm dòng này
```

**Test cần thêm:** `WebIpc, AuditLogInjectionBlocked` — gửi point có `\n`, xác nhận log chỉ có 1 dòng.

- [x] Fix code — `sanitize_point_name()` thêm vào `web_ipc.cpp`; áp dụng trong `handle_line()` 2026-06-13
- [ ] Thêm test — `WebIpc, AuditLogInjectionBlocked` (backlog)
- [x] Code review fix — 115/115 pass

---

### CR-002 — Hash collision trong `graph_runtime.reload()` âm thầm bỏ qua graph update

**File:** `services/core/graph_runtime.cpp` — `reload()` ~line 250, `load_string()` ~line 226
**Severity:** HIGH — Correctness/Safety (graph update bị drop silently)

**Vấn đề:**
`reload()` dùng `std::hash<std::string>{}` để phát hiện nội dung không đổi:

```cpp
// load_string():
src_hash_ = std::hash<std::string>{}(src);    // lưu hash lúc load

// reload():
if (loaded_ && std::hash<std::string>{}(src) == src_hash_) {
    fprintf(stderr, "INFO  graph.reload_unchanged ...\n");
    return true;   // ← BỎ QUA reload — không swap
}
```

`std::hash<std::string>` là general-purpose hash, **không có collision-resistance guarantee**.
Hai graph JSON khác nhau có thể cho cùng hash → reload trả về "unchanged" → graph mới
**không bao giờ được áp dụng** cho đến khi restart process.

**Hệ quả:** Operator thay đổi PID tuning hoặc đổi wiring DO, gửi SIGHUP, log báo "reload_unchanged",
hệ thống chạy tiếp theo config cũ. Không có error — hoàn toàn silent.

**Fix:**
```cpp
// graph_runtime.hpp — thêm field:
std::string src_cached_;   // thay src_hash_ = 0 (size_t)

// load_string() — lưu source thay vì hash:
src_cached_ = src;         // thay src_hash_ = std::hash...

// reload() — so sánh string trực tiếp:
if (loaded_ && src == src_cached_) {   // O(n) nhưng reload chỉ xảy ra khi SIGHUP
    fprintf(stderr, "INFO  graph.reload_unchanged ...\n");
    return true;
}
```

String compare O(n) là hoàn toàn chấp nhận được — reload xảy ra tối đa vài lần/giờ, không phải mỗi scan.

**Test cần thêm:** `GraphReload, HashCollisionEdgeCase` — nếu bao giờ thêm.
Hiện tại `GraphReload, UnchangedContentIsNoOp` đã có nhưng không test collision.

- [x] Fix code — `src_hash_` (size_t) → `src_cached_` (std::string) trong `graph_runtime.hpp` + `.cpp`; string compare trong `reload()` 2026-06-13
- [x] Code review fix — 115/115 pass, `GraphReload.UnchangedContentIsNoOp` vẫn xanh

---

## MEDIUM — Fix trong sprint hiện tại

---

### CR-003 — `respond_rejected()` đưa error code vào field `active_source` của audit log

**File:** `services/core/web_ipc.cpp` — `respond_rejected()` ~line 176
**Severity:** MEDIUM — Protocol/Audit format violation

**Vấn đề:**
```cpp
void WebIpc::respond_rejected(const WebCommand& cmd, const char* error)
{
    // ...
    audit(cmd, "rejected", error, cmd.value);
    //                     ^^^^^ ← error="bad_request"/"unknown_point"/... dùng làm active_source
}
```

`audit()` format: `AUDIT web_cmd ... result=%s active_source=%s`.
Với rejected commands: `active_source=bad_request` hoặc `active_source=unknown_point`.
Contract 07 §8 định nghĩa `active_source` là priority source name: `safety/manual/bacnet/schedule/logic/default`.
→ Audit log không nhất quán, bất kỳ parser/grep nào validate `active_source` đều mismatch.

**Fix:**
```cpp
void WebIpc::respond_rejected(const WebCommand& cmd, const char* error)
{
    char buf[128];
    std::snprintf(buf, sizeof(buf), "{\"id\":%llu,\"result\":\"rejected\",\"error\":\"%s\"}",
                  static_cast<unsigned long long>(cmd.id), error);
    respond(cmd.client_fd, buf);
    audit(cmd, "rejected", "-", cmd.value);   // ← dùng "-" thay vì error
}
```

- [x] Fix — `audit(cmd, "rejected", "-", cmd.value)` trong `respond_rejected()` 2026-06-13
- [x] Verify — format khớp 07 §8: `active_source="-"` cho rejected

---

### CR-004 — Virtual point `release` audit ghi `active_source="manual"` sai (phải là `"default"`)

**File:** `services/core/scan_loop.cpp` — step 7b, ~line 96
**Severity:** MEDIUM — Protocol violation (audit trail sai)

**Vấn đề:**
```cpp
// step 7b — virtual point branch:
} else {
    d_.web->respond_accepted(cmd, d_.table->get(cmd.point).value);
    // ↑ không truyền active_source → default "manual" trong respond_accepted signature
}
```

Sau `release_virtual()`, `PointSource` của point là `DEFAULT`.
Nhưng response và audit log đều ghi `active_source="manual"`.
Với `write` virtual point thì "manual" là đúng. Với `release` thì phải là "default".

**Fix:**
```cpp
} else {
    const char* src = cmd.is_write ? "manual" : "default";
    d_.web->respond_accepted(cmd, d_.table->get(cmd.point).value, src);
}
```

- [x] Fix — `const char* vsrc = cmd.is_write ? "manual" : "default"` trong step 7b `scan_loop.cpp` 2026-06-13
- [ ] Thêm assert `active_source` vào test `ReleaseVirtualKeepsValue` (backlog)

---

### CR-005 — `release` command khi safe-state active nhận `"overridden"` thay vì `"accepted"`

**File:** `services/core/scan_loop.cpp` — step 7b, ~line 83–84
**Severity:** MEDIUM — Semantic (protocol confusing, no test coverage)

**Vấn đề:**
```cpp
if (d_.safe->active()) {
    d_.web->respond_overridden(cmd, applied, "safety");
    // ↑ CÙNG response cho cả write VÀ release
}
```

`release` DO1 khi safe-state active: lệnh release đã được apply vào resolver (mức 2 dropped),
nhưng response vẫn là `overridden`. Theo 07 §8, `overridden` = "nguồn nhận lệnh nhưng nguồn cao
hơn đang thắng" — release không phải lệnh bị block, nó đã thực thi.
Web UI nhận `overridden` có thể retry release không cần thiết.

**Fix:**
```cpp
if (d_.safe->active()) {
    if (cmd.is_write)
        d_.web->respond_overridden(cmd, applied, "safety");
    else
        d_.web->respond_accepted(cmd, applied, "safety");   // release: accepted nhưng note nguồn thắng
}
```

**Test cần thêm:** `WebIpc, ReleaseAcceptedDuringSafeState`.

- [x] Semantic đã chốt: release trong safe-state → `accepted` (lệnh release thực thi thành công, safe-state là nguồn thắng không phải block)
- [x] Fix — if/else trên `cmd.is_write` trong safe-state branch `scan_loop.cpp` 2026-06-13
- [ ] Thêm test — `WebIpc, ReleaseAcceptedDuringSafeState` (backlog)

---

## LOW / Cleanup — Xử lý khi có thời gian

---

### CR-006 — `sync_actual_scan_ms()` sau reload: fragile ordering, không có assertion

**File:** `services/core/scan_loop.cpp` — `run()` ~line 127
**Severity:** LOW — Fragile dependency (không phải active bug)

`reload()` reset `scan_ms_` về `declared_scan_ms_`. `scan_loop.cpp` gọi
`sync_actual_scan_ms(actual_ms)` ngay sau → correct cho scan tiếp theo.
Nhưng nếu ai đó bỏ hoặc reorder dòng đó, graph chạy với dt sai suốt 1 scan.

**Fix đề xuất:** Hoặc thêm comment `/* BẮT BUỘC: gọi ngay sau reload để đồng bộ dt */`,
hoặc để `reload()` nhận `actual_ms` làm parameter và tự sync bên trong.

- [x] Thêm comment 3 dòng giải thích ràng buộc thứ tự trong `scan_loop.cpp::run()` 2026-06-13

---

### CR-007 — `std::vector<PendingResp>` local heap alloc trong SCHED_FIFO-80 `step()`

**File:** `services/core/scan_loop.cpp` — `step()` ~line 43
**Severity:** LOW — Real-time concern (scan period 1s = thực tế không overrun)

`pending` vector tạo/hủy mỗi scan; với N commands thì N string copy.
Không nguy hiểm ở 1s period nhưng là antipattern trong SCHED_FIFO context.

**Fix đề xuất:** Chuyển `pending` thành member của `ScanLoop` (pre-allocated, `clear()` đầu step).

```cpp
// scan_loop.hpp:
std::vector<ScanLoop::PendingResp> pending_;   // member, không phải local

// step():
pending_.clear();   // thay vì khai báo local
```

- [x] Chuyển `struct PendingResp` + `pending_` thành member của `ScanLoop` trong `scan_loop.hpp`; `step()` gọi `pending_.clear()` 2026-06-13

---

### CR-008 — File-read boilerplate nhân đôi giữa `load()` và `reload()`

**File:** `services/core/graph_runtime.cpp` — `load()` ~line 50, `reload()` ~line 234
**Severity:** LOW — Maintenance (3 dòng trùng)

Cả `load()` và `reload()` đều:
```cpp
std::ifstream f(path);
std::stringstream ss;
ss << f.rdbuf();
const std::string src = ss.str();
```

**Fix đề xuất:**
```cpp
static std::string read_file(const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) return "";
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}
```

- [x] Extract `read_file_content(path, &out) → bool` vào anonymous namespace của `graph_runtime.cpp`; `load()` và `reload()` dùng chung 2026-06-13

---

### CR-009 — `prio_source_name()` switch có `default:` che giấu level mới bị bỏ sót

**File:** `services/core/priority_resolver.cpp` ~line 93
**Severity:** LOW — Maintenance/Future-proofing

```cpp
const char* prio_source_name(int level) {
    switch (level) {
    case PRIO_FIRE_SAFETY:  return "safety";
    case PRIO_LOCAL_MANUAL: return "manual";
    case PRIO_BACNET:       return "bacnet";
    case PRIO_SCHEDULE:     return "schedule";
    case PRIO_LOCAL_LOGIC:  return "logic";
    default:                return "default";   // ← mask level mới
    }
}
```

Nếu thêm level mới (vd `PRIO_REMOTE=7`) mà quên update hàm này → audit log ghi `active_source="default"` sai.

**Fix đề xuất:** Xóa `default:`, để compiler warn `-Wswitch` khi có unhandled case.
Hoặc thêm `static_assert(PRIO_LEVELS == 6, "update prio_source_name");`.

- [x] Xóa `default:`, thêm `case PRIO_DEFAULT: return "default"` + `static_assert(PRIO_LEVELS == 6)` trong `priority_resolver.cpp` 2026-06-13

---

### CR-010 — `set_ao`/`set_do` trả `void`, `ok` flag không bao giờ false cho AO/DO

**File:** `services/core/scan_loop.cpp` — step 4 ~line 46
**Severity:** LOW — Design brittleness (không phải active bug)

```cpp
bool ok = true;
if (cmd.point.kind == PointKind::AO) {
    if (cmd.is_write) d_.resolver->set_ao(PRIO_LOCAL_MANUAL, idx, v);   // void
    else              d_.resolver->release_ao(PRIO_LOCAL_MANUAL, idx);  // void
    // ok không bao giờ false vì không có return value
}
```

Nếu `parse_point_name` validate đúng thì idx luôn in-range → không issue hiện tại.
Nhưng nếu `KX_N_AO` trong point_table và resolver lệch nhau → silent drop + respond_accepted sai.

**Fix đề xuất:** `set_ao`/`set_do`/`release_ao`/`release_do` trả `bool`, set `ok` ở scan_loop.

- [x] `set_ao/set_do/release_ao/release_do` đổi `void → bool` trong `priority_resolver.hpp` + `.cpp`; `scan_loop.cpp` dùng return value cho `ok` 2026-06-13

---

## Fix Tracking

| ID | Priority | Assignee | Status | Commit |
|----|----------|----------|--------|--------|
| CR-001 | HIGH | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |
| CR-002 | HIGH | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |
| CR-003 | MEDIUM | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |
| CR-004 | MEDIUM | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |
| CR-005 | MEDIUM | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |
| CR-006 | LOW | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |
| CR-007 | LOW | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |
| CR-008 | LOW | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |
| CR-009 | LOW | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |
| CR-010 | LOW | Dev SOM | ✅ Fixed 2026-06-13 | pending commit |

**Annotation format khi fix:** `Trạng thái: ĐÃ fix YYYY-MM-DD — [commit hash]` trong bảng trên.

---

## Scope không có trong review này

PR #13 review chỉ cover **code correctness + design**. Những thứ KHÔNG nằm trong scope:
- Test coverage % tổng thể (có CI check riêng)
- Performance benchmark (chưa có board)
- BACnet/Modbus (S7 #5/#6 — chưa implement)
- Stateful component / state.snap (S7 #4 — xem [23_GRAPH_STATEFUL_COMPONENTS_PLAN](../03_implementation/23_GRAPH_STATEFUL_COMPONENTS_PLAN.md))

---

**Rev** 1.2 | 2026-06-13 — CR-006..010 (LOW) fixed; 10/10 findings closed; 115/115 test pass · 1.1 | 2026-06-13 — CR-001/002 (HIGH) + CR-003/004/005 (MEDIUM) fixed · 1.0 | 2026-06-13 — khởi tạo từ code review PR #13 (adedeeb), 10 findings
