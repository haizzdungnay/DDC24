# Plan 42: Realtime cache, SQLite historian và unified Trends

> **Trạng thái:** Approved - WEB-HIST-001..005, activation, maintenance CLI, ARM64 parity, bounded board cutover, durable-frontier recovery, Trends cache/database source routing, Core status-probe pressure, all-point preset-cache sampling, 1-second realtime table `Current`, and the transient 1-second preset chart tail are deployed. Board API evidence returns UI-01/UI-02/UI-06 from cache while the same recent database range remains UI-01-only; a replacement 24-hour soak is running. Target eMMC, physical fault/power-cut, manual/physical E2E, soak completion, prune enablement and legacy removal remain open. Plan 42 is not release-Done.
> **Phiên bản:** 1.26 | **Ngày:** 2026-07-22
> **Owner:** Dev SOM + Dev Web + Tester
> **Nguồn quyết định:** [ADR-018](../adr/ADR-018-sqlite-block-historian.md)
> **Phạm vi task:** `COR-HIST-001`, `WEB-HIST-001..005`, `E2E-HIST-001`

## 1. Mục tiêu và giới hạn

Xây historian backend-owned cho UI-01..16, AO-01..04, DO-01..04 và VP numeric/boolean:

- policy riêng từng point, 11 interval, bắt đầu ngay hoặc UTC tương lai;
- bounded realtime RAM: raw tail 10 phút + presentation cache aggregate 15 giây trong 24 giờ, hot SQLite 48 giờ, rolling archive retention theo interval;
- dữ liệu từ một coherent core scan, không sample authoring value;
- query UTC thống nhất, backend merge tier, CSV cùng dữ liệu JSON;
- migrate historian cũ không mất dữ liệu;
- live/control tiếp tục khi historian lỗi.

Ngoài phạm vi: DI database logging, cloud historian, replication, user-defined interval và nén codec thứ hai. Chỉ thêm sau benchmark hoặc product requirement mới.

## 2. Trạng thái hiện tại

| Thành phần | Hiện có | Khoảng cách đến target |
|---|---|---|
| Core | `point_snapshot` phát 24-row coherent UI/AO/DO snapshot | COR-HIST-001 Done; backend reader/policy pipeline đang triển khai |
| Physical sampler | `Sampler`, interval chung 10..300s | Không per-point, không monotonic boundary, không generation |
| SQLite | WAL, row/sample, prune theo record | Không 48h/archive/block/watermark/recovery |
| VP | diagnostic sampler + RAM ring 10 phút | Phải tách khỏi database policy; không sample authoring value |
| Query | `range=30m|1h|6h|24h` | Chưa explicit UTC, tier merge, gap, CSV, budget |
| FE | legacy Trends + live buffer | Chưa shared Logging Control; không được merge browser history |

Pipeline cũ chỉ bị xóa sau khi pipeline mới và frontend đạt GREEN.

## 3. Kiến trúc và ownership

```text
MCU/iobus -> core scan -> priority/safe-state -> coherent snapshot
                                                   |
                                                   v
                                       web historian scheduler
                                        /        |         \
                               RAM tail      hot SQLite    archive blocks
                                        \        |         /
                                         unified query iterator -> REST/CSV -> FE
```

| Unit | Trách nhiệm | Không được làm |
|---|---|---|
| Core snapshot | Xuất một bounded snapshot từ cùng scan | Ghi DB, chờ web/storage, cấp wall-clock schedule |
| Policy service | Validate và activate atomic revision | Empty-list auto-all, sửa VP diagnostic policy |
| Scheduler | Tính due boundary bằng monotonic clock | Backfill, hold-last, sample trước start |
| RAM tail | Giữ 1/3/5s samples trong bounded memory | Trở thành nguồn persisted |
| Hot store | Giữ normalized 15s buckets trong 48h | Prune trước archive watermark |
| Archive | Ghi immutable verified blocks trong rolling retention đã chọn | Sửa block đã commit |
| Query | Merge/dedupe/budget/gap/CSV | Để frontend chọn hoặc merge tier |
| FE | Policy control và render unified response | Browser historian hoặc tier fallback riêng |

## 4. `COR-HIST-001`: coherent runtime snapshot

Core thêm read-only request/response trên IPC hiện có. Response bounded gồm:

```json
{
      "snapshotId": 42,
      "snapshotObservedAtUtc": "2026-07-16T02:00:00.015Z",
      "capturedMonotonicNs": 123456789,
  "points": [
    {
      "id": "AO-01",
      "generation": 1,
      "value": 7.5,
      "quality": "GOOD",
      "source": "schedule",
      "role": "resolved_setpoint",
      "unit": "V",
      "updatedAtMonotonicNs": 123450000
    }
  ]
}
```

Rules:

- UI dùng engineering value + quality.
- AO dùng resolved setpoint sau winner/safe-state.
- DO dùng feedback, không dùng requested command.
- Optional DI capability được giữ trong contract nhưng ngoài logging scope.
- Snapshot copy từ một scan; không giữ lock hoặc block scan khi client chậm.
- Point identity dùng canonical ID + persisted generation authority.
- `snapshotObservedAtUtc` là wall-clock observation của cùng snapshot và là anchor UTC duy nhất để scheduler map monotonic boundary sang UTC bucket. `capturedMonotonicNs` dùng đo age/drift; web không tự gắn một wall clock khác cho từng row.

Gate: `test_web_ipc.cpp` và `test_runtime_point_snapshot.cpp` pass; malformed/bounds/escaping pass; benchmark không làm scan vượt budget hiện hành.

## 5. `WEB-HIST-001`: policy và capacity API

### 5.1 Policy model

Mỗi point có:

- `pointId`, `generation`;
- `enabled`;
- `interval`: một giá trị trong `HistorianInterval` đã freeze tại OpenAPI;
- `startMode`: `immediate` hoặc `futureUtc`;
- `startUtc` khi hẹn giờ;
- computed state: `off`, `scheduled`, `recording`;
- computed health độc lập: `healthy`, `degraded`, `error`;
- `lastError`, `lastSampleUtc`, `nextBoundaryUtc` chỉ đọc.

`GET /trends/config` trả `revision`, `serverNowUtc`, capacity/free-space và toàn bộ policy. Viewer/operator/admin được đọc. `PUT` chỉ admin và bắt buộc `baseRevision`.

### 5.2 Atomic validation

Backend validate toàn batch trước commit:

- canonical ID thuộc UI/AO/DO/VP cho phép;
- VP tồn tại, enabled và numeric/boolean;
- generation và namespace revision còn đúng;
- interval thuộc fixed enum;
- future start không trước `serverNowUtc`;
- estimated RAM/hot/archive capacity và free-space đạt budget;
- không có duplicate point identity.

Rev A bắt buộc `hotCacheEnabled=true` và `hotCacheHours=48` cho policy đang bật. Hai field vẫn nằm trong contract để phản ánh persisted policy/capacity, nhưng `false` hoặc giá trị khác 48 bị `400` cho đến khi direct-to-archive mode có thiết kế riêng.

Bất kỳ lỗi nào giữ nguyên revision cũ. Revision/generation conflict trả `409`; capacity/storage thiếu trả `507`; input sai trả `400`. Disable không xóa history. `points[]` là atomic patch set: point bị omit giữ nguyên policy; point chỉ tắt khi patch explicit `dbLoggingEnabled=false`.

## 6. `WEB-HIST-002`: schema, archive, migration, recovery

### 6.1 SQLite settings và logical schema

Hot database dùng WAL, `synchronous=FULL`, `busy_timeout` bounded và owner-only file permission.

| Table | Mục đích | Khóa chính/unique |
|---|---|---|
| `historian_meta` | schema version và active migration | singleton/key |
| `policy_revisions` | immutable policy revision + checksum | revision |
| `point_policies` | policy snapshot theo revision | revision, point_id, generation |
| `hot_samples` | normalized 15s buckets | point_id, generation, bucket_utc_ms |
| `history_gaps` | downtime/overflow/storage/snapshot gaps | gap_id |
| `archive_blocks` | block metadata, range, codec, checksum, state | block_id |
| `archive_watermarks` | contiguous durable frontier theo identity | point_id, generation |

Sample/block metadata phải mang `value` cuối bucket, `min`, `max`, `sum`, `count`, worst quality, source và UTC bucket/generation. Source giữ giá trị duy nhất nếu mọi sample cùng source, ngược lại là `mixed`. Retry dùng `INSERT ... ON CONFLICT DO NOTHING`; historian không thay sample đã durable. Hot và archive lưu aggregate 15 giây; RAM giữ raw 1/3/5 giây trong 10 phút. Vì vậy query 1/3/5 giây ngoài RAM tail trả `resolution_unavailable`; query 15 giây trở lên dùng hot/archive. Boolean vẫn dùng `value` cuối bucket để vẽ stepped line; aggregate fields chỉ phục vụ thống kê.

Archive block state: `building`, `verified`, `committed`. Chỉ `committed` được query và nâng watermark. Codec Rev A dùng một format versioned; không thêm codec plugin.

### 6.2 Migration historian cũ

State machine persisted:

```text
detected -> backed_up -> copying -> verified -> activated
```

1. Detect legacy `samples`/`trend_config`; không có legacy thì tạo schema mới.
2. Freeze một migration manifest gồm source database identity, namespace revision và ánh xạ `{legacyStorageId -> canonicalPointId, generation}`. Generation lấy đúng một lần từ generation authority tại `detected`; nếu authority chưa có thì gán migration generation `1` trong manifest và không đổi giữa các lần resume.
3. Dùng SQLite backup API tạo rehearsal snapshot trước mọi mutation; copy snapshot theo chunk, lưu cursor/checkpoint; chạy lại tiếp tục.
4. Timestamp dương `< 1_000_000_000_000` được chuẩn hóa từ giây sang mili-giây; timestamp khác giữ mili-giây.
5. Canonicalize legacy aliases theo frozen manifest. Nếu nhiều legacy ID va cùng unique bucket: canonical spelling thắng, nếu không thì storage ID lexical nhỏ nhất thắng; row giống hệt được dedupe, row khác giá trị được giữ trong rejected-row manifest và tạo migration gap/conflict evidence.
6. Legacy empty point list không tạo auto-all policy.
7. Verify row outcome, range, rejected-row manifest và checksum.
8. Trước activation, quiesce legacy writer trong bounded maintenance window và tạo **final full SQLite backup**. Final backup là migration source authority; không dùng timestamp/rowid high-water vì legacy `INSERT OR REPLACE` có thể đổi row cũ. Rebuild/reconcile target từ toàn bộ final snapshot bằng frozen manifest, rồi verify full keyspace/count/range/checksum trước activation. Không drop legacy tables/file trong release này.

Row không migrate được tạo explicit migration gap/manifest; không im lặng bỏ dữ liệu.

### 6.3 Recovery và prune

- Interrupted migration tiếp tục từ checkpoint.
- Open/power-cut chạy integrity check tối thiểu trước writer activation.
- Corruption: đóng DB, tạo timestamped damaged copy, thử native recovery/backup sang file mới; không auto-delete.
- Storage lỗi: live/control tiếp tục; scheduler coalesce một bounded gap marker theo identity/reason. Nếu process/power mất marker, startup reconstruct gap từ last durable bucket đến boundary phục hồi theo active policy; gap có thể rộng hơn outage thật nhưng không được che mất dữ liệu thiếu.
- Archive watermark là contiguous durable frontier riêng cho mỗi `{pointId,generation}`. Commit block và advance watermark chạy cùng transaction; block out-of-order hoặc hole không được đẩy frontier. Hot prune chỉ xóa bucket `< now-48h` và `<=` frontier tương ứng.
- Policy chọn `retentionDays` từ 1 ngày tới maximum Rev A theo interval: `1s=30`, `3s=60`, `5s=90`, `15s=180`, `30s=365`, `1m=730`, `3m=1095`, `5m=1460`, `15m=1825`, `30m=2555`, `60m=3650`. Omitted patch giữ selection còn hợp lệ hoặc mặc định về maximum của interval.
- Dữ liệu cũ hơn cửa sổ trở thành eligible cho safe prune, không overwrite block đang active. Physical archive rolling-prune engine đã code-local GREEN nhưng activation guard giữ inactive; chỉ enable sau activation/cutover reconciliation và target benchmark. Shadow/readiness mode trả deferred và không xóa gì.
- Fine samples `1s|3s|5s` chỉ nằm trong bounded RAM tail; hot/archive dài hạn lưu 15-second aggregate. UI và docs không được diễn giải `1s + 30d` thành raw 1-second retention suốt 30 ngày.

### 6.4 Activation authority và crash reconciliation

`historian.conf` vẫn là policy authority. Activation dùng prepare/commit hai bước với một commit point rõ:

1. SQLite tạo/migrate schema, ghi policy revision ở trạng thái `prepared` và chạy FULL WAL checkpoint; prepared policy + metadata được persist riêng để boot reconcile.
2. Backend fsync strict temporary policy, atomic rename thành `historian.conf`, rồi fsync parent directory. Rename này là commit point.
3. Writer chỉ chạy revision được `historian.conf` active tham chiếu. Sau commit, SQLite đổi mirror state thành `active`; bước này có thể retry.
4. Boot reconciliation: config trỏ prepared revision thì hoàn tất activation; SQLite có prepared revision không được config trỏ thì giữ inactive để cleanup sau; config trỏ revision/schema không tồn tại thì historian fail closed, live/control tiếp tục và báo recovery error.

Không có transaction giả giữa filesystem và SQLite; test power-cut tại từng bước bắt buộc.

> Trạng thái 2026-07-21: coordinator và CLI đã chạy trong Orange Pi window `historian-cutover-20260721T082943Z`. Final backup/migration verified `596,284/596,284` rows, schema-v5 marker is evidence-bound, legacy writer is quiesced, and the final ARM64 binary has native package parity. Atomic config writes preserve service ownership; active startup prepares explicit restart gaps. Prune, physical power-cut, target eMMC, browser/manual E2E, long soak and legacy removal remain open.

### 6.5 WEB-HIST-002 readiness-only implementation boundary

Local implementation mở riêng `historian-v2.sqlite` bằng một connection, WAL `synchronous=FULL`, immutable policy mirrors, generation-aware hot rows, explicit gaps, archive metadata/watermarks, migration and recovery evidence. Local defaults retain rollback-safe legacy paths; the board active marker now grants v2 writer/query authority. `TrendStore`, legacy `Sampler`, VP diagnostic sampler and the legacy range adapter remain in source until rollout gates permit removal.

Archive codec duy nhất là deterministic `mkhab-v1`: magic `MKHABLK\0`, 15-second slots, tối đa 24 giờ/5.760 rows/64-byte point ID/255 sources/320 KiB. Filename lấy lowercase SHA-256. Block dùng `building -> verified -> committed`; chỉ committed block góp vào exclusive watermark `covered_until_utc_ms`. Hot prune chỉ xóa bucket `< floor15s(now-48h)` và `< covered_until_utc_ms` khi watermark trỏ đúng committed frontier block cùng identity.

Native SQLite backup copy theo bounded pages. Backup page stepping cancellable nhưng không crash-resumable: interruption giữ unique `.partial-*` evidence; retry bắt đầu page zero vào partial mới. Chỉ snapshot đã `Finish`, `quick_check`, schema fingerprint và file SHA-256 GREEN mới được hard-link publish fail-if-exists. Frozen manifest giữ source identity/checksum, namespace/policy revision, target schema, rule versions, source row count và `{legacyStorageId,canonicalPointId,generation}`.

Recovery preflight kiểm tra scratch copy của coherent DB/WAL/SHM family trước writable open, nên original evidence không bị SQLite mutate. Corrupt family được copy vào unique owner-only fsynced damaged directory và v2 fail closed. Candidate chỉ được publish sau independent verification và evidence/quarantine sync; không có verified candidate thì không đoán hoặc auto-delete. Recovery failure chỉ disable v2 readiness; live/control và legacy historian tiếp tục.

Measured gates: Windows full Go test/vet/build and prior Linux race suites are GREEN; Unix owner preservation and first-cycle restart-gap wiring have dedicated regressions. Board evidence is in `docs/00_management/evidence/historian/board-cutover-2026-07-21.md`. Plan 42 remains open because target eMMC, physical fault/power-cut, browser/manual accessibility, long soak, prune scheduling and full `E2E-HIST-001` remain downstream.

## 7. `WEB-HIST-003`: monotonic scheduler và cache

Scheduler duy trì immutable active policy revision. UTC quyết định start; monotonic clock quyết định due boundary sau activation.

Rules:

- Immediate bắt đầu tại boundary kế tiếp dùng server time trả về cùng revision.
- Future không sample trước `startUtc`.
- Restart tính boundary kế tiếp; downtime thành gap, không backfill.
- Scheduler theo dõi offset giữa `snapshotObservedAtUtc` và monotonic expectation. Sai lệch tuyệt đối >2 giây là clock discontinuity. Jump tiến đóng gap `clock`, re-anchor tại boundary UTC kế tiếp. Jump lùi suspend persisted sampling đến khi observed UTC vượt bucket durable cuối của từng identity, coalesce gap `clock`, rồi re-anchor; không overwrite/replay bucket cũ. Raw RAM samples trong khoảng clock invalid không được trả như persisted UTC history.
- Mỗi due cycle đọc đúng một coherent core snapshot rồi fan-out cho các policy đến hạn.
- RAM tail chỉ giữ raw interval 1/3/5s trong 10 phút, tối đa 64 MiB; capacity validation từ chối policy làm vượt ceiling.
- Hot fold tạo aggregate 15s bằng rule tại §6.1; sparse interval chậm chỉ ghi slot đến hạn.
- Queue tối đa 4096 due-point records. Overflow coalesce gap reason `queue` với detail `queue_overflow`; không block producer.
- BAD/missing giữ quality/gap đúng contract; không dùng giá trị cuối thay sample thiếu.
- AO/DO lấy resolved/feedback từ snapshot. VP lấy runtime value; không lấy config authoring value.

Empty-list auto-all bị loại khỏi policy mới. `Sampler` cũ chỉ bị xóa sau khi scheduler, unified query, FE, activation/cutover và rollout gates đều GREEN.

Trạng thái 2026-07-21: scheduler code/local GREEN cho 11 interval; board v2 runtime advances hot rows and emits explicit snapshot/restart gaps. First-active-cycle restart gap wiring is TDD-covered. Legacy paths remain in source for rollback; target eMMC, physical fault/power-cut, long soak and E2E remain open nên Plan 42 chưa Done.

Status 2026-07-22: a late divergent RAM aggregate behind the durable frontier was reproduced and fixed without weakening immutable hot-row storage or backfilling old UTC buckets. The ARM64 candidate passed active/legacy schema-v5 parity and an isolated canary, then restored live board progress (`hotDelta=+4`, `gapDelta=0`, `legacyDelta=0` over 30 seconds). The bounded post-rollout journal had no historian conflict, overflow, Core IPC degradation or SQLite busy warning, and authenticated unified history was complete. This closes the immediate production stall only; 24-hour soak and the remaining release gates are still open.

## 8. `WEB-HIST-004`: unified query và CSV

`GET /history` nhận 1..8 canonical IDs, `from`, `to` UTC half-open `[from,to)`, fixed `resolution`, `maxPoints<=5000`.

Query iterator:

1. Validate identity/range/resolution/output budget.
2. Dùng UTC Unix epoch làm bucket origin cho mọi resolution.
3. Với resolution 1/3/5 giây, chỉ query raw RAM và yêu cầu toàn range nằm trong RAM tail.
4. Với resolution >=15 giây, query archive đến archive frontier, hot sau archive frontier đến hot durable frontier, rồi fold RAM chỉ cho 15s base buckets sau hot frontier. Tier không đóng góp chồng cùng base bucket.
5. Re-aggregate base buckets lên requested bucket: `min=min(min)`, `max=max(max)`, `sum=sum(sum)`, `count=sum(count)`, `value` từ sample có UTC mới nhất, quality lấy worst, source giữ nguyên khi đồng nhất nếu không `mixed`; tier là tier mới nhất có contribution và `tiersUsed` giữ toàn bộ tier nguồn.
6. Merge/dedupe `{pointId,generation,requestedBucketUtc}`; generation khác là series khác.
7. Giữ explicit gaps và enforce max points trên từng series.

Response còn ít nhất một tier: `200`, `complete=false` khi partial. Mọi tier unavailable: `503 historian_unavailable`. Resolution 1/3/5 giây yêu cầu range nằm trọn trong RAM tail, nếu không trả `400 resolution_unavailable`; `auto` duyệt interval từ mịn đến thô và chọn interval mịn nhất vừa tier availability vừa giữ mỗi `{pointId,generation}` series `<=maxPoints`. Nếu không interval nào đạt output budget thì trả `413`.

`GET /history/export.csv` dùng cùng iterator và filter. CSV data row gồm `pointId,generation,time,value,min,max,sum,count,quality,source,tier`; comment header đầu file ghi `from,to,complete,tiersUsed`, còn gaps là comment rows `# gap,...`. Test JSON/CSV parity so sánh data rows, metadata và gaps sau decode.

Legacy `range=30m|1h|6h|24h` chỉ tồn tại trong migration window. Xóa route/adapter ngay khi FE mới, unified query và rollback checkpoint đạt GREEN.

Trạng thái 2026-07-21: unified query/CSV code/local GREEN với canonical validation, explicit `[from,to)`, 11 resolution + `auto`, generation-aware RAM/hot/archive merge, bounded partial-gap/error handling and shared JSON/CSV iteration. Board explicit query authority is v2; an authenticated aligned window returned `complete=true`. Legacy range adapter remains for rollback; target/eMMC, physical fault/power-cut and E2E remain open.

## 9. `WEB-HIST-005`: Logging Control và Trends

Một component/control dùng chung trên Inputs, Outputs và Virtual Points:

- badge `off`, `scheduled`, `recording`, `error`;
- viewer/operator xem; admin chỉnh;
- modal hai bước: chọn interval, rồi immediate/future UTC;
- chọn rolling data retention nhỏ hơn hoặc bằng maximum do backend trả cho interval;
- hiển thị server time, capacity error, structured validation và 403 session behavior;
- focus trap, Escape, focus restore, keyboard và screen-reader alert.

Trends:

- `Auto`, `30 min`, `1 hour`, `6 hours`, `24 hours` chỉ đọc presentation cache RAM 24 giờ; không fallback/read-through SQLite khi người dùng chọn preset;
- cache live lấy coherent UI/AO/DO/VP runtime snapshot theo nhịp 15 giây cho mọi numeric/boolean point hợp lệ, độc lập việc point có bật database logging hay không; durable hot warmup chỉ khôi phục được các point đã persist sau restart;
- với preset/Auto, cột `Current` trong bảng thống kê dùng live runtime point từ WebSocket/poll 1 giây; chart thêm một live-tail tạm thời ở đầu mút mỗi poll để hiển thị nhịp 1 giây, còn lịch sử chart và `Average`/`Minimum`/`Maximum`/sample count vẫn dùng cache aggregate 15 giây. Live-tail không ghi vào cache/database. Custom không trộn live point và tiếp tục database-only;
- `Custom` chỉ đọc historian database (hot SQLite + archive), không ghép cache RAM;
- frontend gửi `source=cache|database` vào cùng history contract và không merge tier; request không có `source` giữ unified compatibility behavior cho client cũ;
- live display buffer/tail chỉ phục vụ giá trị tức thời và không nhập vào history range, cache hoặc database;
- boolean/DO dùng stepped line; missing/BAD ngắt line;
- gaps và partial state hiển thị rõ;
- chart giữ toàn bộ samples backend trả trong range; `auto` resolution giữ mỗi series trong `maxPoints`, không paging/truncation im lặng; bảng chỉ render 5 timestamp mới nhất;
- VP diagnostic logging không hiển thị như database Logging Control.

Trạng thái 2026-07-22: source-routed Trends đã qua full local gates, ARM64 parity, isolated canary và bounded board rollout. Live build dùng v2 theo mặc định sau activation; `VITE_HISTORIAN_V2_TRENDS=0` chỉ còn là explicit rollback switch, còn demo vẫn dùng generated legacy data. Chrome Playwright `2/2` dùng live-mode API fixture đã xác minh UI/AO/DO/VP selection, preset/Auto cache-only, Custom database-only, gap/partial, focus trap/Escape/focus restore và viewport 390 px. Follow-up từ màn hình board tái hiện UI-01 có database policy còn UI-02/UI-06 chỉ được chọn: cache cũ làm rơi hai identity không có policy. Fix all-point đã qua checkpoint schema-v5, ARM64 legacy/active package parity, isolated canary và rollout backend candidate `f666b3cb...`. Authenticated board query gần nhất trả UI-01/UI-02/UI-06 từ cache với 19/13/13 samples, trong khi database query cùng range chỉ trả UI-01; authority vẫn active/v2, prune tắt và legacy không đổi. Soak cũ đóng graceful với `complete=false` do owner-approved rollout; replacement unit `mkddc-historian-soak-allpoints-20260722t065257z.service` chạy từ `2026-07-22T07:07:02Z`. Đây là API/runtime evidence, không phải physical-board actuation evidence cho các channel ngoài UI-01. Physical prune, manual screen-reader/physical I/O, target eMMC, soak completion và full E2E còn open.

Core IPC continuation 2026-07-22: [read-only board evidence](../00_management/evidence/historian/board-core-ipc-diagnosis-2026-07-22.md) found `27` `alarms_read degraded` warnings trong 30 phút và `360` accepted WebIpc connections/5 phút, gồm `300` `alarm_list`; alarm history, browser polling, historian snapshots và dial-only health probes cùng chia sẻ giới hạn bốn client. TDD đã đổi `ReadStatus` sang PLC shared-memory liveness trước, chỉ probe socket khi SHM không hợp lệ; fix được rollout trong candidate `f666b3cb...`. Bounded postdeploy journal đến hết all-point cache verification có zero `alarms_read degraded`/`core unavailable`, nhưng runtime-source stability chỉ đóng sau replacement 24-hour soak.

## 10. Dependency và thứ tự triển khai

```text
DOC-HIST-001
   |
COR-HIST-001 ---- WEB-NAME-001
   |                 |
   +------ WEB-HIST-001
                 |
             WEB-HIST-002
                 |
             WEB-HIST-003
                 |
             WEB-HIST-004
                 |
             WEB-HIST-005
                 |
             E2E-HIST-001
```

| Slice | Code chính | Gate trước slice sau |
|---|---|---|
| 1 | Core snapshot + web reader | C++ coherence/bounds/latency GREEN |
| 2 | Policy/config/capacity | Go atomic/revision/race GREEN |
| 3 | New schema/migration/recovery | Migration/power-cut/corruption GREEN |
| 4 | Scheduler/RAM/hot/archive | Boundary/clock/overflow/48h GREEN |
| 5 | Query/CSV | Tier boundary/dedupe/partial/parity GREEN |
| 6 | Shared FE controls/Trends | FE test/lint/typecheck/build/a11y GREEN |
| 7 | Cutover/remove legacy | E2E + target benchmark GREEN |

Không làm big-bang. Mỗi slice phải merge được mà không phá live/control.

## 11. Test matrix và acceptance

| ID | Bắt buộc chứng minh |
|---|---|
| COR-HIST | One-scan coherence, AO winner, DO feedback, UI quality, bounds, escaping, generation, no DB in core |
| POL-01 | 4 point kinds x 11 interval; retention 1..max; immediate/future/past; atomic revision; restart persistence |
| POL-02 | Namespace/generation conflict; capacity/free-space; `507`; disable preserves history; no auto-all |
| STO-01 | Codec/checksum; unique retry; FULL WAL reopen; archive watermark trước prune |
| MIG-01 | Legacy seconds/milliseconds; empty list; aliases; interrupted resume; verify before activate |
| REC-01 | Power-cut reopen; corruption damaged copy; storage unavailable/recovery gap |
| SCH-01 | 11 boundaries/no drift; restart; clock forward/back; overflow; no backfill/hold-last |
| QRY-01 | 48h boundary; tier overlap/dedupe; generation rename/delete/recreate; partial/all-tier failure |
| QRY-02 | 1..8 IDs; half-open UTC; max 5000/series; resolution/budget; JSON/CSV parity |
| FE-01 | Shared controls, RBAC, keyboard/focus/a11y, stepped boolean, gaps, latest-five |
| E2E-HIST-001 | Full UI/AO/DO/VP, restart/clock/disk/corruption, migration, 48h/archive, eMMC benchmark |

Các case migration bắt buộc thêm: config/generation đổi giữa các lần resume không đổi frozen mapping; alias collision theo deterministic winner; legacy writer delta trong maintenance cutover; archive block out-of-order/hole không advance watermark; power loss khi storage down reconstruct explicit gap.

Release gate:

- C++ unit/integration tests pass.
- `go test -race ./...` pass trên supported 64-bit Linux target; coverage đạt project gate.
- FE unit test, lint, typecheck và production build pass.
- Browser keyboard/a11y pass.
- Orange Pi/eMMC 24h soak có evidence: RAM historian <=64 MiB; queue không vượt 4096; hot retention đủ 48h; selected archive window nằm trong `historian_budget_bytes`; rolling prune không xóa dữ liệu trong window; free space không thấp hơn `required_free_space_bytes`; 8 series/24h/`auto` query p95 <=1s và p99 <=2s; không có SQLite integrity error.
- Live/control vẫn đạt realtime/safety gate khi historian bị fault injection.
- Core scan vẫn đạt project NFR jitter <=5ms; snapshot response <=64 KiB và không chờ storage/web client.

## 12. Rollout, rollback và quan sát

Rollout theo vertical slice:

1. Deploy binary mới và packaged rollback binary; cả hai phải hiểu schema/activation marker mới nhưng chưa activate writer.
2. Backup DB cũ và chạy migration/check verification.
3. Shadow-write bounded window; so sánh sample count/range/value/quality. Legacy writer vẫn là authority trước cutover.
4. Quiesce legacy writer, tạo/migrate/verify final full backup theo §6.2, rồi activate policy revision + writer mới theo §6.4. Maintenance pause target <=30 giây; thời gian pause thành explicit migration gap nếu vượt một due boundary.
5. Chuyển unified query và FE.
6. Theo dõi gap rate, queue depth, DB latency, WAL/archive size, free-space và query p95.
7. Sau E2E/soak GREEN, xóa `Sampler`, legacy config/query adapter và record-count prune.

Rollback:

- Trước activation: dùng binary và DB cũ.
- Sau activation: không được chạy binary legacy. Rollback dùng last-known-good forward-compatible binary đóng gói cùng release, hiểu activation marker/schema mới và có thể disable new writer an toàn; không downgrade schema, không quay lại legacy writer, không xóa archive.
- Nếu storage lỗi: disable historian writer, giữ live/control, giữ file và evidence để recovery.

Audit events bắt buộc: policy revision accepted/rejected, migration phase, activation, recovery, storage unavailable/restored, archive commit/prune và admin export.

Rollback acceptance trước activation: packaged rollback binary phải mở activated schema fixture, reconcile marker/config, giữ archive byte-identical, disable writer, phục vụ live/control và unified history read-only. Hash binary và kết quả test được lưu cùng release evidence.

Code/local parity gate: chạy `go run . historian-rollback-package --source-dir . --output-dir <release-evidence> --fixture <legacy.sqlite> --fixture <active.sqlite> --artifact <archive> --artifact <evidence>`. Gate build hai binary native (`current` và `rollback-candidate`) với `-trimpath -buildvcs=false`, ghi SHA-256/size/Go target/build settings, chạy cả hai binary qua `historian-rollback-verify`, kiểm tra DB family (`-wal/-shm/-journal`) và artifact archive/evidence không đổi, rồi publish `historian-rollback-package-evidence.json` atomic. Đây chỉ chứng minh host-native package; ARM64/board execution, power-cut và production cutover vẫn là gate riêng.

ARM64 preflight 2026-07-21 xác nhận live-board schema-v1 bị từ chối fail-closed và SHA không đổi. Final prebuilt-native mode then verified byte-identical current/candidate ARM64 binaries on frozen legacy+active schema-v5 fixtures and immutable artifacts. Bounded board migration/cutover is now GREEN; physical power-cut, target eMMC, long soak, browser/manual E2E, prune and legacy removal remain open.

## 13. Definition of Done

Plan chỉ Done khi:

- `COR-HIST-001`, `WEB-HIST-001..005`, `WEB-NAME-001` dependency và `E2E-HIST-001` đều Done;
- contract OpenAPI/config/runtime khớp code;
- legacy historian wiring đã xóa;
- migration cũ có backup + verification evidence;
- target benchmark và fault tests đạt gate;
- checklist, guide, changelog và release evidence ghi kết quả thực tế, không chỉ trạng thái planned.

## 14. Deliberate simplifications

- Một archive codec versioned; thêm codec khi benchmark chứng minh cần.
- Local SQLite/archive, không replication; thêm cloud sync khi có product scope.
- Fixed interval enum; thêm custom interval khi capacity model và UX được duyệt.

## 15. Revision history

| Rev | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-07-16 | Khôi phục và hoàn thiện Plan 42: architecture, policy, schema, migration, recovery, scheduler, unified query, FE, dependency, test và rollout/rollback. |
| 1.1 | 2026-07-17 | Reconcile sau COR-HIST-001: core `point_snapshot` đã Done, snapshot example dùng uppercase quality; WEB-HIST downstream vẫn open. |
| 1.2 | 2026-07-18 | Ghi readiness-only boundary WEB-HIST-002, `mkhab-v1` limits, exclusive watermark, backup restart semantics, damaged-family recovery rules và measured local gates; Linux race/cutover/downstream tasks vẫn open. |
| 1.3 | 2026-07-20 | Linux/amd64 ext4 race gate GREEN sau khi cô lập Linux RTC test fixture khỏi host sysfs; WEB-HIST-002 code/local slice Done, downstream/target gates vẫn open. |
| 1.4 | 2026-07-20 | WEB-HIST-003 shadow scheduler code/local GREEN với supported Linux race; legacy authority, unified query/FE, activation/cutover, target eMMC và full E2E vẫn open. |
| 1.5 | 2026-07-20 | WEB-HIST-004 unified query/CSV code-local GREEN với shared JSON/CSV iterator và supported Linux race; legacy authority, WEB-HIST-005, activation/cutover, target eMMC và full E2E vẫn open. |
| 1.6 | 2026-07-20 | WEB-HIST-005 shared Logging Control/unified Trends code-local GREEN với 50 frontend tests, default-off v2 authority gate và explicit accessibility/gap/generation evidence; legacy authority, activation/cutover, target eMMC và full E2E vẫn open. |
| 1.7 | 2026-07-20 | Retention amendment: selectable `retentionDays`, interval maximum map, FE controls/validation và schema/capacity projection code-local; physical rolling prune, target capacity/endurance benchmark và activation/cutover vẫn open. |
| 1.8 | 2026-07-21 | Physical rolling-prune engine code/local GREEN với fail-closed activation guard, SQLite queue/retry, archive checksum validation, all-tier cutoff và frontier rebase; execution inactive, activation/cutover, target benchmark và E2E vẫn open. |
| 1.9 | 2026-07-21 | Activation prepare/commit/reconcile code-local GREEN với strict filesystem commit point, SQLite prepared/active marker, boot idempotence và fail-closed mismatch; production writer/query switch, final migration/backup evidence, target benchmark và E2E vẫn open. |
| 1.10 | 2026-07-21 | Added schema-v4 durable cutover evidence binding for native backup, full migration keyspace/outcome, manifest/policy checks and active-config fail-closed authority; production final backup/quiesce/cutover, target and E2E remain open. |
| 1.11 | 2026-07-21 | Added maintenance-only ordered quiesce/final-backup/full-migration/evidence/gap/activation coordinator, tracked legacy writers and schema-v5 quiesce proof; no production invocation, board cutover, prune schedule or legacy removal. |
| 1.12 | 2026-07-21 | Added offline `historian-maintenance` operator CLI with exact confirmation, service-presence, path containment, UTC/window/manifest and fresh-authority preflight; no board invocation or automatic prune. |
| 1.16 | 2026-07-21 | Added prebuilt-native package mode and closed ARM64 frozen schema-v5 legacy/active parity with native manifest and unchanged DB/archive/evidence hashes; live board migration, SQLITE_BUSY, power-cut, target eMMC and cutover remain open. |
| 1.17 | 2026-07-21 | Completed bounded Orange Pi schema-v5 migration/activation with 596,284-row evidence, final ARM64 owner/restart-gap package parity, explicit maintenance/restart gaps and live v2 query/writer smoke; retained prune, physical fault, target eMMC, long-soak, browser/manual E2E and legacy-removal gates. |
| 1.18 | 2026-07-22 | Recovered a production hot-writer stall by dropping divergent late RAM aggregates behind the durable frontier while preserving immutable SQLite rows and no-backfill semantics; ARM64 parity, isolated canary, bounded board rollout, hot/gap/legacy deltas and unified history passed. Long soak and remaining physical/E2E gates stay open. |
| 1.19 | 2026-07-22 | Split Trends source ownership per product clarification: presets/Auto use a bounded 24-hour RAM presentation cache, Custom uses database-only hot/archive history, source-less clients retain unified compatibility, and live builds default to v2 after activation. Added a fixed 16 MiB raw + 48 MiB presentation-cache budget; board rollout/soak evidence remains pending. |
| 1.20 | 2026-07-22 | Completed local gates, ARM64 schema-v5 parity, isolated source-routing canary and bounded web+dist rollout for the 24-hour cache. Postdeploy hot/gap/legacy delta, RSS, authority and storage checks passed; started the 24-hour/60-second historian soak. Recurring Core degradation and remaining physical/E2E gates stay open. |
| 1.21 | 2026-07-22 | Added Chrome Playwright coverage for UI/AO/DO/VP Trends selection, cache/database source routing, gap/partial, keyboard focus lifecycle and a 390 px viewport; fixed modal focus restore and mobile TopBar overflow. This is local browser-fixture evidence only; physical non-UI-01 channels, manual screen-reader acceptance and full E2E remain open. |
| 1.22 | 2026-07-22 | Diagnosed four-client Core IPC pressure with bounded board evidence and removed the dial-only health probe whenever PLC shared-memory liveness is valid. Local regression and full Go gates pass, but no board rollout/restart occurred during soak; runtime-source stability remains open. |
| 1.23 | 2026-07-22 | Fixed the code-local preset cache to sample all valid runtime UI/AO/DO/VP points every 15 seconds independently of database logging policy, while keeping Custom database-only and reusing the scheduler snapshot to avoid another IPC client. Board deployment remains deferred until the active soak checkpoint. |
| 1.24 | 2026-07-22 | Gracefully closed the superseded soak as incomplete, captured a coherent checkpoint and ARM64 package/canary evidence, deployed the all-point cache plus shared-memory-first status probe, proved UI-01/UI-02/UI-06 cache visibility against database-only UI-01, and started a fresh 24-hour soak without enabling prune or removing legacy data. |
| 1.26 | 2026-07-22 | Added a non-persistent one-second live tail to preset/Auto chart rendering, kept Custom database-only and cache statistics at 15-second resolution, disabled browser caching for the 1-second points poll, and verified an atomic frontend-only board rollout with unchanged backend/Core/I/O/soak PIDs. |
| 1.25 | 2026-07-22 | Decoupled realtime table `Current` from the 15-second historian aggregate: presets/Auto now use the existing WebSocket/1-second point poll, Custom remains database-only, and the frontend-only atomic board rollout preserved all backend/Core/I/O/soak PIDs with zero restarts. |
| 1.15 | 2026-07-21 | Recorded ARM64 preflight: both native binaries execute and fail closed on the board's schema-v1 fixture without mutation. |
| 1.14 | 2026-07-21 | Added native packaged rollback parity gate: builds separately named current/candidate binaries, records SHA-256/size/Go metadata, runs both against legacy+active fixtures, hashes DB families and archive/evidence artifacts before/after, and writes immutable release evidence; board/ARM64 rehearsal remains open. |
| 1.13 | 2026-07-21 | Added read-only schema-v5 rollback verifier/subcommand with legacy/active authority matrix, exact durable-evidence joins, future-schema rejection and no-mutation SHA proof; packaged binary/board rehearsal open. |
