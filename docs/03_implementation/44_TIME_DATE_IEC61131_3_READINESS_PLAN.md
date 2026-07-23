# Plan 44: Time/Date production slice và IEC 61131-3 readiness

> **Trạng thái:** In progress - TIME-002/004/005 local complete; board/recovery/Rev C gates open
> **Phiên bản:** 1.0 | **Ngày:** 2026-07-18
> **Owner đề xuất:** Dev Web + Dev SOM/Core + Tester
> **Phạm vi:** `/settings/time`, `time.conf`, Linux time service, RTC, clock semantics runtime
> **Nguồn quyết định:** `CANONICAL_DECISIONS`, `PRODUCT_DEFINITION`, ADR-004, ADR-009
> **Chuẩn tham chiếu:** IEC 61131-3:2013 cho kiểu dữ liệu/thời gian và timer PLC; RFC 5905 cho NTP

## 1. Quyết định phạm vi

MK-DDC-24 Rev A là component-based BMS Edge Automation Controller, không phải PLC IEC
61131-3. Vì vậy `/settings/time` không được gắn nhãn "IEC 61131-3 compliant" và kế hoạch
này không thêm FBD, ST, compiler hoặc soft-PLC runtime vào Rev A.

Kế hoạch triển khai Time/Date production-grade theo hai lớp:

1. **Rev A:** dịch vụ thời gian hệ thống an toàn cho NTP, timezone, RTC, lịch, alarm,
   historian và UI.
2. **Rev C readiness:** clock contract đủ rõ để runtime IEC 61131-3 sau này ánh xạ
   `DATE`, `TIME_OF_DAY`, `DATE_AND_TIME`, `TIME`, `TON`, `TOF`, `TP` mà không phụ thuộc
   trực tiếp vào Linux wall clock.

Không tuyên bố IEC 61131-3 conformance trước khi Rev C có runtime, language test suite,
traceability và assessment riêng.

## 2. Capability và tiêu chí thành công

Admin xem được giờ controller, nguồn đồng bộ, timezone, RTC và trạng thái NTP; có thể lưu
cấu hình NTP hoặc đặt giờ thủ công có xác nhận. Thay đổi wall clock không làm scan loop,
delay, debounce, alarm delay, runtime counter hoặc timer tương lai chạy nhanh, chạy lùi hay
kích hoạt hai lần.

Tiêu chí thành công:

- `GET /api/v1/system/time/status` trả thời gian UTC hiện tại, local time, timezone, mode,
  sync state, NTP source, offset, last sync và RTC state từ controller.
- `GET/PUT /api/v1/system/config/time` đọc/lưu cấu hình thật; reload trang không mất dữ liệu.
- NTP mode và manual mode loại trừ nhau. Manual set bị từ chối khi NTP đang bật.
- Mọi persisted/event timestamp dùng RFC3339 UTC; timezone không đổi dữ liệu lịch sử.
- Scan cadence và duration dùng monotonic clock. Wall-clock jump không đổi elapsed duration.
- Weekly schedule dùng local civil time theo timezone đã cấu hình và có policy DST rõ.
- Mọi thay đổi thời gian có admin RBAC, audit và kết quả apply có kiểm chứng.
- Mất mạng/reboot phục hồi từ RTC; NTP hội tụ lại mà control loop vẫn chạy.

## 3. Clock contract

| Clock/domain | Nguồn | Dùng cho | Cấm dùng cho |
|---|---|---|---|
| Monotonic | `CLOCK_MONOTONIC` | scan cadence, timeout, delay, debounce, elapsed timer, runtime counter | timestamp hiển thị, lịch địa phương |
| UTC wall clock | `CLOCK_REALTIME` sau OS sync | alarm/event/history timestamp, API `nowUtc`, audit | đo duration hoặc scan period |
| Local civil time | UTC + IANA timezone | weekly schedule, UI local time | persisted historian identity, elapsed timer |
| RTC | DS3231 qua kernel RTC | seed wall clock khi boot/mất mạng | scan cadence, nguồn timestamp sau khi OS đã chạy |

### 3.1 IEC 61131-3 readiness

- `TIME` là kiểu duration thuần; literal, arithmetic và conversion không đọc clock. `ET` và
  elapsed measurement của `TON`, `TOF`, `TP` lấy từ monotonic duration.
- `DATE`, `TIME_OF_DAY`, `DATE_AND_TIME` là kiểu giá trị thuần. Dịch vụ clock chỉ tạo giá trị
  current-time từ snapshot UTC wall clock; function block không gọi `std::time()` rải rác.
- Một scan dùng một `ClockSnapshot { monotonicNs, utcEpochMs }`; mọi node trong scan thấy
  cùng một thời điểm.
- Runtime adapter Rev C dùng kiểu nội bộ có range/precision được freeze trước implementation;
  conversion overflow phải báo lỗi, không wrap.
- DST overlap/gap và wall-clock step không được tác động elapsed timers. Leap-second policy
  phải được freeze theo daemon/OS target: step, smear hoặc unsupported-degraded; không claim
  behavior chưa được target chứng minh.

## 4. Contract API và dữ liệu

### 4.1 Persisted config `time.conf`

Giữ tên field public hiện có, nhưng freeze invariant:

```json
{
  "timezone": "Asia/Ho_Chi_Minh",
  "ntp_enabled": true,
  "ntp_servers": ["pool.ntp.org"],
  "system_time": ""
}
```

- `timezone`: IANA timezone tồn tại trên target; không nhận abbreviation như `ICT`.
- `ntp_servers`: 1..4 hostname hoặc IP hợp lệ khi `ntp_enabled=true`; trim, unique, mỗi giá
  trị tối đa 253 byte.
- `system_time`: command one-shot, chỉ nhận RFC3339 có offset khi `ntp_enabled=false`.
- Backend không persist `system_time` sau apply thành công; tránh reboot đặt lại giờ cũ.
- Không nhận field lạ. Toàn request validate trước khi ghi/apply.

### 4.2 Runtime status mới

`GET /api/v1/system/time/status`, viewer được đọc:

```json
{
  "nowUtc": "2026-07-18T03:00:00Z",
  "nowLocal": "2026-07-18T10:00:00+07:00",
  "timezone": "Asia/Ho_Chi_Minh",
  "mode": "ntp",
  "synchronized": true,
  "source": "pool.ntp.org",
  "offsetMs": 1.8,
  "lastSyncUtc": "2026-07-18T02:58:31Z",
  "rtcPresent": true,
  "rtcUtc": "2026-07-18T02:59:59Z",
  "health": "healthy",
  "warnings": []
}
```

Status là observation, không ghi vào `time.conf`. Field không đo được dùng `null` và warning,
không dựng dữ liệu giả.

### 4.3 Apply result

`PUT /system/config/time` tiếp tục trả `ConfigPutResult`, bổ sung warning/reason đủ để FE
phân biệt `saved_not_applied`, `ntp_not_converged`, `rtc_write_failed`, `invalid_timezone`.
Không trả success nếu chỉ ghi file nhưng system apply thất bại.

Mọi mutation nhận `baseRevision`; revision stale trả `409`. Manual-time command nhận
`operationId` idempotent để retry sau HTTP timeout không set clock lần hai. Backend persist
revision và bounded operation outcome qua restart.

### 4.4 Apply state machine và commit point

Không coi OS clock, daemon, timezone, RTC và file config là một transaction rollback được.
Mỗi operation persist journal state và pre/post observation:

```text
validated -> staged -> os_applied -> verified -> config_committed -> completed
                                  \-> partially_applied
```

- NTP/timezone: stage file, apply OS, verify, rồi atomic commit sanitized `time.conf`.
- Manual: stage intent, disable NTP, set clock, verify read-back, best-effort write RTC, rồi
  commit sanitized config không chứa `system_time`.
- Trước `os_applied`, failure được compensation về config/daemon cũ.
- Sau wall-clock mutation, không tự đặt clock lùi để rollback. Backend commit observed mode/time,
  ghi `partially_applied` nếu RTC/config durability lỗi và chặn mutation mới cho tới recovery.
- Recovery sau restart đọc journal + OS observation để finish commit hoặc đưa trạng thái
  `recovery_required`; không đoán success từ `time.conf` riêng.

## 5. Ownership và trust boundary

| Thành phần | Trách nhiệm |
|---|---|
| React FE | render status, validate cơ bản, xác nhận manual set, không tự tính device truth |
| Go backend | RBAC, strict validation, atomic config, gọi time service qua interface, audit |
| Time service adapter | áp timezone/NTP/manual time, đọc sync/RTC status bằng bounded OS calls |
| systemd/OS | quyền đổi clock, NTP daemon, timezone symlink/database |
| RTC/kernel | giữ UTC qua mất điện |
| Core | monotonic scan/duration, clock snapshot UTC cho event/schedule |

`mkddc-web` không chạy shell command ghép chuỗi từ input. Adapter dùng argv cố định hoặc native
DBus/systemd API; timeout mọi OS operation. Production privilege giới hạn qua helper/polkit
hoặc service chuyên trách, không cấp shell/root rộng cho web process.

## 6. Các bước triển khai

### TIME-001 - Freeze spec và contract

**Phụ thuộc:** không.
**Files dự kiến:** OpenAPI, CONFIG_SCHEMA, runtime model, security plan, task checklist.

1. Bổ sung `time.conf` vào bảng owner/reader/reload của CONFIG_SCHEMA.
2. Freeze validation, one-shot `system_time`, status response và error reasons.
3. Freeze DST policy và occurrence model:
   - giờ không tồn tại khi spring-forward: bỏ occurrence và ghi event;
   - schedule interval là level semantics; occurrence key
     `{scheduleId, localDate, startLocalTime, foldPolicy}` được persist đủ qua overlap/reload/reboot;
   - giờ lặp khi fall-back: cùng occurrence key không kích hoạt lần hai;
   - đổi timezone: tính lịch kế tiếp từ timezone mới, không backfill.
4. Freeze `baseRevision`, `operationId`, audit sequence và apply state machine §4.4.
5. Trace Rev A requirement `TIME-*`; ghi rõ IEC adapter là Rev C, chưa compliance.

**Gate:** OpenAPI lint/parse đạt; không còn mâu thuẫn `reloadSystem` mơ hồ; owner duyệt DST,
manual-time và privilege model.

### TIME-002 - Backend config và status, chưa chạm OS

**Phụ thuộc:** TIME-001.
**Files dự kiến:** `web/backend/dto.go`, `configapi.go`, `http.go`, test tương ứng.

1. Strict validate IANA timezone, NTP server count/format, mode exclusivity, RFC3339.
2. Tách `TimeService` interface: `Status`, `ApplyNTP`, `SetManualTime`, `SetTimezone`,
   `SyncRTC`. Fake test implementation, một production implementation ở TIME-003.
3. Thêm status handler viewer-read; giữ config PUT admin-only.
4. Implement journal/state machine §4.4; config chỉ commit sau OS verify. Không hứa rollback
   wall clock. Expose `partially_applied`/`recovery_required` rõ khi hậu mutation lỗi.
5. Dùng persisted optimistic revision và idempotent operation ID; mutex chỉ bảo vệ critical
   section trong process, không thay conflict detection.
6. Audit có immutable sequence/event ID, actor/request/operation ID, `beforeUtc`, `afterUtc`,
   monotonic observation và outcome để vẫn dựng đúng thứ tự khi UTC lùi.

**Gate:** Go tests gồm malformed JSON, unknown field, invalid zone/server/time, RBAC, stale
revision, idempotent retry qua timeout/restart, apply/compensation/partial failure, concurrent PUT,
audit order khi UTC lùi và status degrade.

### TIME-003 - Linux NTP, timezone và RTC adapter

**Phụ thuộc:** TIME-002.
**Target:** Debian trên Orange Pi 5B.

1. Chọn đúng một NTP authority đã có trên image. Orange Pi target đã xác nhận dùng Chrony;
   không cài daemon thứ hai.
2. Ghi Chrony source file bằng atomic write vào `/etc/chrony/sources.d`, restart bounded, rồi
   đọc lại status bằng `chronyc tracking`.
3. Apply timezone bằng IANA zone có trên target; verify `/etc/localtime`/timedate service.
4. Manual flow theo state machine §4.4: disable NTP, set UTC instant, verify read-back tolerance,
   best-effort ghi system time xuống RTC UTC. Manual mutation bị build/runtime flag khóa cho tới
   khi TIME-005 đạt toàn bộ clock-jump gate.
5. NTP flow: enable daemon, không block HTTP chờ hội tụ dài; trả `applied=true` cùng
   `synchronized=false` warning cho đến khi status xác nhận sync. Sau sync, cập nhật RTC.
6. Boot flow: kernel/systemd lấy RTC; service health báo `unsynchronized` cho tới NTP sync,
   nhưng core control vẫn chạy.

**Gate:** integration test trong sandbox/fake command runner; failpoint/crash tại từng boundary
staged/OS-applied/verified/config-rename/directory-fsync; disk full; board test có NTP available,
NTP unavailable, RTC absent, permission denied, timeout và reboot offline. Sau recovery luôn có
một authority hoặc explicit `recovery_required`, không trạng thái mơ hồ.

### TIME-004 - Frontend `/settings/time`

**Phụ thuộc:** TIME-002; status thật đầy đủ sau TIME-003.
**Files dự kiến:** API client/types, `TimeSettingsPage.tsx`, một test nhỏ.

1. Load config và status song song; render skeleton/error/retry.
2. Hiển thị controller time từ status, chỉ tick giữa hai poll bằng elapsed browser time và
   re-anchor định kỳ; không dùng browser clock làm device truth.
3. Save gọi PUT; disable double-submit; field-level validation; dirty-state và apply warnings.
4. Sync gọi status refresh hoặc explicit resync action đã freeze ở TIME-001; không toast giả.
5. Manual set cần dialog xác nhận vì clock jump ảnh hưởng audit/schedule/history timestamp.
6. NTP enabled thì manual field disabled; manual mode thì NTP server không bị mất khỏi draft.
7. Status gồm sync source, offset, last sync, RTC health và `NTP ON`/`MANUAL` có text+icon.

**Gate:** component test load/save/failure/manual-confirm/mode toggle; lint, typecheck, build;
desktop và mobile smoke.

### TIME-005 - Core clock hardening

**Phụ thuộc:** TIME-001; có thể chạy song song TIME-002..004.
**Files dự kiến:** core clock adapter, schedule/alarm/runtime tests.

1. Tạo injectable clock source nhỏ; capture đúng một `ClockSnapshot` ở đầu mỗi scan; scan loop
   tiếp tục `CLOCK_MONOTONIC`. Schedule, alarm, event và historian publication của cùng scan nhận
   cùng snapshot.
2. Alarm/schedule không gọi `std::time()` trực tiếp rải rác; dùng clock snapshot/injected clock.
3. Duration stateful components, alarm delay, debounce và runtime counter nhận monotonic delta
   thật, không cộng configured scan period. Freeze clamp/reset policy khi stall hoặc discontinuity.
4. Schedule dùng timezone explicit từ authority, không dựa vào process-global timezone thay đổi
   không kiểm soát. Áp DST policy TIME-001.
5. Wall-clock jump tạo diagnostic event/gap cho historian; không backfill, không giữ-last giả.

**Gate:** deterministic fake-clock tests cho jump `-1h`, `+1h`, `+24h`, timezone change, DST
gap/overlap, một scan dùng một UTC instant, scan 1s bị stall 5s, process pause/reload và reboot.
Monotonic chỉ continuous trong cùng boot; reboot test theo retained/non-retained policy + boot ID,
không giả định monotonic xuyên reboot. Scan jitter/overrun regression vẫn đạt budget.

### TIME-006 - Rev C IEC 61131-3 adapter, chưa kích hoạt Rev A

**Phụ thuộc:** TIME-005 và quyết định mở Rev C.
**Không merge vào Rev A release branch nếu roadmap chưa mở Rev C.**

1. Freeze binary/internal representation, epoch, range và precision của `DATE`, `TIME_OF_DAY`,
   `DATE_AND_TIME`, `TIME` theo edition IEC được chọn.
2. Adapter lấy một `ClockSnapshot` mỗi PLC task/scan.
3. `TON`, `TOF`, `TP` dùng monotonic elapsed; test reset, wrap/overflow, task pause/restart.
4. Conversion và comparison test tại min/max, leap day, timezone-independent UTC instant.
5. Trace semantic-readiness tests tới IEC requirement matrix. Datatype literals/arithmetic/
   conversion là pure value semantics; current-time adapter và elapsed timer là hai concern riêng.
6. Chỉ gọi là conformance suite và đánh giá mức conformance sau khi có profile, normative clause
   matrix, execution language/runtime, parser/compiler và independent assessment đầy đủ.

**Gate:** datatype/timer semantic-readiness tests, task scheduler tests, trace matrix và independent
review. FBD/ST parser/compiler/IDE vẫn là plan Rev C riêng; chưa có chúng thì không claim
IEC 61131-3 conformance.

## 7. Dependency và lát giao hàng

```text
TIME-001
   |-- TIME-002 -- TIME-003 status/NTP ---- TIME-004 integration/board gate
   |                `-- TIME-005 -- TIME-003 manual-set enable
   `---------------------`-- TIME-006 (Rev C only)
```

Lát 1: TIME-001, contract-only.
Lát 2: TIME-002, backend testable không cần board.
Lát 3A: TIME-003, Linux/RTC status + NTP integration; manual set vẫn disabled.
Lát 3B: TIME-004, FE chạy song song sau contract/backend ổn định.
Lát 4: TIME-005, clock-jump safety gate; sau đó mới enable manual set.
Lát 5: TIME-006 chỉ khi Rev C được phê duyệt.

## 8. Test matrix tối thiểu

| ID | Tình huống | Kết quả bắt buộc |
|---|---|---|
| T-TIME-001 | NTP sync bình thường | status synchronized, source/offset thật |
| T-TIME-002 | DNS/NTP mất | config giữ, health degraded, control tiếp tục |
| T-TIME-003 | manual set khi NTP bật | reject 400, không đổi clock/config |
| T-TIME-004 | manual set hợp lệ | OS và RTC read-back trong tolerance, audit có actor |
| T-TIME-005 | timezone không tồn tại | reject trước apply |
| T-TIME-006 | OS apply fail | không báo success; config authority không bị lệch |
| T-TIME-007 | hai PUT đồng thời | một thứ tự/revision rõ, không lost update |
| T-TIME-008 | wall clock lùi 1 giờ | scan/timer không lùi hoặc kéo dài |
| T-TIME-009 | wall clock tiến 24 giờ | không backfill schedule/history |
| T-TIME-010 | DST gap | occurrence bỏ một lần, có event |
| T-TIME-011 | DST overlap | occurrence chạy đúng một lần |
| T-TIME-012 | reboot mất mạng | seed từ RTC, unsynchronized rõ, control chạy |
| T-TIME-013 | RTC absent/write fail | degraded warning, không crash |
| T-TIME-014 | browser timezone khác controller | UI vẫn hiển thị controller timezone đúng |
| T-TIME-015 | timer IEC tương lai qua clock jump | `ET/Q` chỉ theo monotonic elapsed |
| T-TIME-016 | retry manual operation sau timeout/restart | cùng operation ID không set clock lần hai |
| T-TIME-017 | crash tại mỗi apply boundary | recover về authority rõ hoặc `recovery_required` |
| T-TIME-018 | scan period 1s, stall 5s | elapsed policy dùng monotonic delta đã freeze |
| T-TIME-019 | UTC lùi qua audit events | immutable sequence vẫn xác định đúng thứ tự |

Board soak tối thiểu 24 giờ gồm một lần mất mạng, một lần reboot và một wall-clock jump có kiểm
soát. Thu evidence `timedatectl`/daemon status, RTC read-back, audit, core overrun và schedule
occurrence; không dùng thay đổi giờ trên thiết bị production đang điều khiển tải thật.

## 9. Rollout và rollback

1. Ship status read-only trước. Manual set mặc định off cho tới khi privilege review và TIME-005
   clock-jump/DST/runtime gate cùng đạt.
2. Bật config apply trên lab board, rồi canary một controller không nối tải.
3. Backup `time.conf`, daemon drop-in và timezone trước mutation.
4. Rollback phục hồi config/drop-in atomically, reload daemon, verify status; không tự động đặt
   wall clock ngược về giá trị cũ vì có thể làm timestamp lùi lần hai.
5. Feature flag manual set được phép tắt độc lập; NTP/status read-only vẫn hoạt động. Nếu
   operation đã qua `os_applied`, rollback release không đảo clock; recovery theo journal §4.4.

## 10. Non-goals

- Không thêm IEC 61131-3 FBD/ST engine, Web IDE hoặc tuyên bố certification trong Rev A.
- Không viết NTP client riêng; dùng OS daemon.
- Không dùng browser clock làm controller clock.
- Không sửa timestamp lịch sử khi đổi timezone/giờ.
- Không hỗ trợ nhiều NTP daemon đồng thời.
- Không thiết kế PTP, GPS clock hoặc high-availability time source ở Rev A.

## 11. Open decisions trước implementation

1. RTC HYM8563 boot policy và hardware quality cần owner xác nhận; kernel device đã đọc/ghi được.
2. Manual set cho phép mọi admin hay chỉ service mode/local-presence?
3. Chấp nhận DST policy đề xuất ở TIME-001 hay product muốn policy khác?
4. Operation journal lưu ở file owner-only hay SQLite authority nào để durable qua crash?
5. Alarm/runtime counter state nào retained qua reboot; max monotonic delta sau stall là bao nhiêu?
6. NTP target dùng leap step, smear hay chỉ báo degraded khi leap policy không xác định?

## 12. Definition of Done

- [ ] TIME-001 contract và security model được duyệt.
- [ ] TIME-002 backend tests đạt; config/apply không split-brain.
- [ ] TIME-003 board NTP/timezone/RTC matrix đạt; manual set vẫn khóa trước TIME-005.
- [ ] TIME-004 FE không còn demo toast/state giả.
- [ ] TIME-005 clock-jump/DST/runtime regression đạt trước khi enable manual set.
- [ ] OpenAPI, CONFIG_SCHEMA, runtime model, manuals và task checklist đồng bộ.
- [ ] Go test/vet/build, core CTest, FE test/lint/typecheck/build đạt.
- [ ] Board soak/evidence đạt; rollback rehearsal đạt.
- [ ] Không có claim IEC 61131-3 compliance trong Rev A.
- [ ] TIME-006 chỉ Done sau Rev C approval và semantic-readiness review độc lập; mọi claim
  conformance còn cần full language/runtime profile và assessment riêng.

## 13. Implementation status 2026-07-18

- TIME-002 local: backend config/status endpoint, strict input, viewer-read/admin-write RBAC,
  optimistic revision, apply-before-commit, one-shot manual time và failure tests đã implement.
  Durable owner-only operation journal dedupe retry qua restart, reject ID reuse khác payload và
  chặn mutation mới khi operation dở cần recovery.
- TIME-003 partial: target inspection xác nhận authority thật là Chrony, không phải
  `systemd-timesyncd`; adapter đọc `chronyc tracking`, timezone và RTC. Mutation đi qua root helper
  service có bounded capabilities và Unix socket `0660 root:mkddc`; web giữ
  `NoNewPrivileges=true`, sudoers cũ đã bỏ. Authenticated NTP PUT và retry idempotent đạt:
  revision `1→2`, config/OS timezone `Asia/Shanghai`, Chrony synchronized/healthy. RTC node là
  HYM8563 `/dev/rtc0`, không phải DS3231 và `hwclock` chưa truy cập được; manual clock/DST/24h soak
  chưa chạy nên TIME-003 chưa Done.
- Board web JWT secret đã rotate sang root-owned `/etc/mkddc-web.env` mode `0600`; service unit
  không còn inline development secret. Existing sessions bị revoke theo chủ đích.
- TIME-004 local: FE config/status thật, demo parity, refresh, loading/error/save, manual confirm và
  RFC3339-offset validation; test/lint/typecheck/build đạt.
- TIME-005 local: một `ClockSnapshot` mỗi scan cho schedule/alarm/publication; monotonic alarm
  elapsed và injected wall-clock tests đạt 211/211 trong WSL và 211/211 native ARM64. Core canary
  SHA-256 `2fbb08881c0b5c312ee36bfe40fc83103abab61e101a7d4f3cffb422fcbff627`
  đã deploy với service/socket readiness; controlled clock-jump/DST soak vẫn mở.
- TIME-006 chưa bắt đầu; Rev A không có claim IEC 61131-3 compliance.

Board update 2026-07-20:

- RTC HYM8563 đọc được qua sysfs không đặc quyền và root `hwclock`; status API trả `rtcUtc`.
- Manual `+120s` test lần đầu phát hiện lỗi UTC/local conversion, đã khôi phục NTP+RTC ngay và
  thêm regression test. Lần chạy lại đạt: manual target đúng, NTP restore synchronized, RTC/system
  delta `0s`, config revision cuối `6`.
- Root helper chuyển sang systemd service + Unix socket vì sudo không hoạt động dưới
  `NoNewPrivileges=true`; web vẫn giữ sandbox flag.
- Focused native board Schedule/Alarm/ScanLoop đạt `54/54`.
- Soak 24 giờ đang chạy, PID `273443`, log
  `/home/orangepi/time-soak-20260720_104036.log`; chưa được đánh dấu Done trước completion.
- Mẫu soak đầu báo `SQLITE_BUSY=123/2m` từ VP sampler cũ. Đây là blocker storage-health riêng,
  không phải lỗi clock, nhưng khiến overall soak chưa GREEN.
