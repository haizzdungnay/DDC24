# CHANGELOG — MK-DDC-24

> Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), version theo [SemVer](https://semver.org/lang/vi/).
> Đây là changelog **toàn dự án** (tài liệu + sản phẩm). Mỗi tài liệu còn có Revision History riêng ở cuối file.
> Loại thay đổi: `Added` (thêm), `Changed` (sửa), `Fixed` (vá), `Deprecated`, `Removed`, `Security`.

---

## [Unreleased]
### Changed - Historian Trends source routing (2026-07-22)
- web/backend(historian): added a durable-seeded, in-memory 15-second presentation cache retained for 24 hours. `source=cache` reads only this cache (no SQLite read-through); `source=database` reads hot SQLite/archive only; source-less callers keep the existing unified compatibility merge. Startup warmup uses the last 24 hours of durable hot rows, while live cache sampling now also consumes coherent runtime snapshots independently of database logging policy.
- frontend(Trends): `Auto`, `30 min`, `1 hour`, `6 hours`, and `24 hours` send `source=cache`; `Custom` sends `source=database`. Live builds use v2 by default after activation while demo remains legacy-generated and `VITE_HISTORIAN_V2_TRENDS=0` remains an explicit rollback switch. OpenAPI, ADR-018, Plan 42 v1.20, web guide and task checklist now document the split and rollout state.
- resource budget: reserved 16 MiB for raw RAM tail plus 48 MiB for the presentation cache, preserving the 64 MiB historian RAM ceiling.
- Verification (code-local so far): focused backend query/cache tests pass, including warmup/no-read-through, durable-sink ordering, source routing and 64 MiB budget; focused frontend Vitest `15/15` passes. Full backend/FE gates and board rollout/24-hour soak remain pending.
- Verification (2026-07-22 continuation): backend `go test -count=1 ./...` (`55.447s`), `go vet ./...`, `go build ./...`, frontend Vitest `56/56`, lint, typecheck and production build pass; OpenAPI parses as 3.1.0/version 1.8.0 with 42 paths and `source` parameters. Windows race-focused run remains blocked by the installed 32-bit MinGW C compiler; WSL has no Go toolchain.
- deploy(board): created coherent schema-v5 checkpoint window `historian-trendscache-20260722T034500Z` (checkpoint SHA `91404dbe...`), ARM64 native package parity (8 unchanged artifacts, manifest SHA `520f02ea...`), and isolated cache/database canary. Atomic web+dist rollout succeeded on retry after correcting the unit's actual `PORT=8081`; first wrong-port probe rolled back cleanly. Candidate SHA `319236d0...`, `login=200`, unauthenticated status `401`, all services active with `NRestarts=0`, 30-second `hotDelta=+4/gapDelta=0/legacyDelta=0`, RSS `31,524 KiB`, and no storage conflict/overflow/SQLITE_BUSY warnings.
- soak(board): the initial read-only `mkddc-historian-soak-trendscache.service` ran from `2026-07-22T04:01:50Z` to `06:49:50Z` and was stopped cleanly for the owner-approved all-point cache rollout. Its immutable summary records `complete=false`, 169 samples, zero service/restart/hash/integrity/authority/storage violations, `legacyDelta=0`, and 310 known Core warnings; it is incomplete evidence, not a passed 24-hour gate.
- test(frontend/browser): added a Chrome Playwright live-mode fixture that selects `UI-01`, `AO-01`, `DO-01`, and `VP1`; proves `30 min`/`1 hour`/`6 hours`/`24 hours`/`Auto` use `source=cache`, `Custom` uses `source=database`, and checks cache gap/partial plus database-complete rendering. This closes the automated browser slice only; it does not claim the non-UI-01 physical channels ran on the board.
- frontend(a11y/responsive): modal dialogs now trap Tab/Shift+Tab, close on Escape, and restore focus through an explicit opener ref; the mobile TopBar hides secondary controls and prevents horizontal overflow at 390 px. Added `test:e2e` while keeping Vitest scoped to `src/` so the runners do not collect each other's suites.
- Verification (browser continuation): Playwright Chrome `1.61.1` `2/2` passes (`56.2s`), including UI/AO/DO/VP, source routing, gap/partial, keyboard/focus and mobile viewport checks. Vitest remains `56/56`; lint, typecheck and production build pass; full frontend `npm audit --audit-level=high` reports zero vulnerabilities after updating transitive `brace-expansion` to `5.0.7`; `git diff --check` passes with only the pre-existing `PointCard.tsx` CRLF warning. No board service, historian authority or soak process was changed.

### Fixed - Trends preset cache all-point visibility (2026-07-22)
- web/backend(historian-cache): decoupled the live 24-hour presentation cache from database logging policy. The existing scheduler snapshot now samples every valid numeric/boolean UI/AO/DO/VP into 15-second cache buckets, so selected points such as UI-02/UI-06 no longer disappear merely because only UI-01 has a database policy. The same coherent snapshot is reused, avoiding another Core IPC client; `source=database` remains cache-free.
- web/backend(query): cache-source identity discovery now includes runtime-only cache identities for the requested range while database/source-less identity discovery remains durable/RAM-owned. Cache rows preserve generation, quality, source, aggregation and the existing 48 MiB eviction ceiling.
- test(backend): added RED/GREEN coverage with a database policy for UI-01 only and runtime snapshots for UI-01/UI-02/UI-06, plus a scheduler case proving the cache samples all three when the database policy is not due and database source excludes the runtime-only identities. Focused tests pass; final full `go test -count=1 ./...` passes (`53.653s`), with `go vet ./...` and `go build ./...` also passing.
- Verification (frontend continuation): Vitest `56/56`, lint, typecheck and production build pass; Playwright Chrome `1.61.1` `2/2` passes (`1.6m`) with the UI/AO/DO/VP cache/database routing contract still green. The Vite `ECONNABORTED` messages occur only while the test web server closes proxy sockets after passing cases.
- deploy(board): window `historian-trendscache-allpoints-20260722T065257Z` captured an online schema-v5 checkpoint (`quick_check=ok`, SHA `222234b4...`) and forward-compatible rollback binary (`319236d0...`). Candidate `f666b3cb...` passed native Linux/ARM64 legacy+active schema-v5 parity with five immutable artifact families and an isolated `:18081` canary (`login=200`, unauthenticated status `401`) before the backend-only rollout.
- verification(board): the approximately nine-second `mkddc-web-pi` rollout completed without invoking automatic rollback; web/core/iobus are active with zero restarts, authority remains `active/v2`, prune remains disabled, legacy rows remain `596,284`, and the bounded postdeploy journal has zero snapshot/Core/SQLite conflict warnings. Authenticated `source=cache` returned `UI-01/UI-02/UI-06` with `19/13/13` recent samples and cache-only tiers; the same recent `source=database` query returned only persisted `UI-01` with a hot tier, preserving Custom database ownership.
- soak(board): started replacement unit `mkddc-historian-soak-allpoints-20260722t065257z.service` at `2026-07-22T07:07:02Z` for 24 hours at 60-second cadence. Its first sample has candidate SHA `f666b3cb...`, all services active with zero restarts, `quick_check=ok`, `legacyCount=596284`, and zero storage/Core warnings. The soak remains running, so the 24-hour, physical I/O, power-cut, eMMC/endurance and full E2E gates remain open.
- docs/evidence: added the incomplete prior-soak summary, ARM64 package manifest, postdeploy source-routing JSON and replacement-soak start record under `docs/00_management/evidence/historian/`; no prune, migration rerun, legacy deletion or schema downgrade occurred.
- frontend(Trends): realtime preset tables now use the live runtime point value for `Current`, refreshed by the existing 1-second point poll/WebSocket merge, while `Average`, `Minimum`, `Maximum`, and sample counts remain historian-cache aggregates. Custom tables continue to use database samples only.
- Verification (2026-07-22): added a regression proving realtime `Current` advances to the live point value while Custom retains the latest database sample; Vitest `57/57`, lint, typecheck, and production build pass.
- deploy(board/frontend): window `frontend-trends-table-1s-20260722T072257Z` checkpointed the previous eight-file dist tree (`87fc2980...`), atomically published candidate tree `3163d407...`, and retained a matching rollback tree. `/login` and `assets/index-Xej4g6MM.js` returned `200` with asset SHA `4e344029...`; backend/Core/I/O and the historian soak kept their existing PIDs with zero restarts.
- docs/evidence: Plan 42 v1.25 records the 1-second live `Current` cadence separately from the 15-second cache aggregation contract; board postdeploy evidence is persisted in `docs/00_management/evidence/historian/frontend-trends-table-1s-postdeploy-2026-07-22.json`.
- frontend(Trends live-tail): preset/Auto chart data now appends a transient runtime sample on every 1-second point refresh, so the visible trend table/chart advances between 15-second cache buckets without persisting browser-owned history. Custom remains database-only; cache Average/Minimum/Maximum/sample counts remain 15-second aggregates.
- frontend(HTTP): `/api/v1/points` polling now requests `cache: no-store` so browser/proxy freshness cannot mask the one-second runtime cadence.
- Verification (2026-07-22): Vitest `58/58`, lint, typecheck, production build, and Chrome Playwright `2/2` pass, including the live-tail/cache-vs-database regression. Fresh Chrome against the board loaded `assets/index-WSSWDfxC.js`; live history timestamps advanced at approximately 1-second intervals (`702, 1806, 2791, 3787, 4789 ms`) and the Custom table contained no live tier.
- deploy(board/frontend): atomic window `frontend-trends-live-tail-20260722T074700Z` published the eight-file dist tree (`e57347d1...`) with asset SHA `8003863505693bf8dd336a69f112a99d9ce40bcd28ac105e3ad78bcd5881dea4`; `/login=200`, asset `200`, served SHA matched, rollback tree matched checkpoint (`5f9e234b...`), and web/Core/I/O plus the all-point soak kept their existing PIDs with `NRestarts=0`.
- docs/evidence: postdeploy behavior, runtime API trace, browser tick capture, service invariants, checkpoint and rollback paths are recorded in `docs/00_management/evidence/historian/frontend-trends-live-tail-postdeploy-2026-07-22.json`.

### Fixed - Frontend CI lockfile synchronization (2026-07-22)
- frontend(ci): regenerated npm 10 lock metadata so `npm ci` resolves the required `@emnapi/core` and `@emnapi/runtime` peer/optional packages; transitive `brace-expansion` remains patched at `5.0.7`. Verification: `npx --yes npm@10.9.8 ci --ignore-scripts --dry-run` passes.

### Fixed - Core IPC status-probe pressure (2026-07-22)
- web/backend(core-status): `ReadStatus` now treats valid PLC shared-memory scan state as primary Core liveness evidence and only opens `core.sock` as a fallback when that evidence is unavailable. This removes a dial-only client from each health poll while retaining the existing socket fallback and IOP/scan error semantics.
- test(backend): added a regression with valid PLC/IO shared memory and a listening Unix socket. It failed before the fix because status probed the socket, and now proves `CoreAvailable=true`, the scan counter is read, and the socket receives no connection. Focused RED/GREEN passes; full `go test -count=1 ./...` passes (`54.471s`), with `go vet ./...` and `go build ./...` also passing.
- evidence(board): a pre-rollout bounded sample found `27` `alarms_read degraded` warnings in 30 minutes and, over five minutes, `360` accepted IPC connections including `300` `alarm_list` calls. The shared-memory-first status fix shipped in candidate `f666b3cb...`; the bounded postdeploy journal through the all-point cache verification has zero `alarms_read degraded`/`core unavailable` warnings. This short window is encouraging but does not close runtime-source stability until the replacement 24-hour soak completes.

### Fixed - Historian durable-frontier conflict recovery (2026-07-22)
- web/backend(historian-scheduler): prevent a late RAM aggregate at or behind an identity's durable frontier from poisoning every subsequent immutable hot-store batch. Durable SQLite rows remain unchanged, no historical backfill is attempted, and newer buckets can continue after clock-discontinuity/retry state leaves a divergent stale aggregate in `pendingHot`.
- test(backend/core): added a production-shaped scheduler regression with an existing durable bucket, a divergent in-memory copy and a newer due cycle. It failed before the fix with `hot sample conflict` and now preserves the durable row, commits the new frontier and removes the poison row. Backend `go test -count=1 ./...` passes (`63.630s`), `go vet ./...` and `go build ./...` pass; WSL Core build and `212/212` tests pass, including WebIpc slot-reclamation, half-close and budget coverage.
- board(baseline/package): read-only evidence found schema v5 `quick_check=ok`, evidence-bound `active/v2`, prune disabled and legacy count `596,284`; the stuck writer emitted conflict every five seconds and overflow gaps while hot frontiers lagged by about 16 hours. Window `historian-conflictfix-20260722T023931Z` captured an online checkpoint and binary/config hashes before mutation. ARM64 current/rollback SHA-256 `8d756f593eda7978072673b911c37a984956537c245078cc73348192b2b9136e` passed native legacy+active schema-v5 parity with eight immutable artifact families; package manifest SHA-256 is `3c85ae4f9de7a54d7f75d6d0c9f3f2f6108e6745498047f9dec335d76a49b030`.
- board(rollout/verification): isolated canary advanced AO-01/UI-01 without conflict, then an approximately eight-second atomic web rollout deployed the candidate while retaining forward-compatible SHA `dcd171d3...` in the checkpoint. Post-rollout services are active with zero restarts; rollback verification remains evidence-bound; a 30-second sample produced `hotDelta=+4`, `gapDelta=0`, `legacyDelta=0`; authenticated history returned `200`, `complete=true`, three samples and zero gaps. The bounded journal contained no historian conflict/overflow, `alarms_read degraded`, `core unavailable`, `SQLITE_BUSY`, but long soak and remaining physical/E2E gates stay open.
- docs/evidence: added predeploy checkpoint, ARM64 package and postdeploy JSON evidence with matching board/repo hashes `1c5974dd...`, `3c85ae4f...`, and `a3609d04...`; reconciled the board cutover record and Plan 42 v1.18 without marking the release Done.

### Changed - Historian board activation and restart-gap hardening (2026-07-21)
- board/historian: completed the bounded production cutover on Orange Pi window `historian-cutover-20260721T082943Z`: coherent emergency/final backups, schema `1 -> 5`, frozen 77-ID mapping, `596,284/596,284` accepted rows, zero rejections, consumed quiesce proof, evidence-bound `active/v2` writer/query authority, and legacy writer quiescence. Prune remains disabled and no legacy file/code was removed.
- web/backend(config): atomic config replacement now preserves an existing Unix owner/group when invoked as root. This prevents offline activation from replacing `mkddc:mkddc` `historian.conf` with an unreadable root-owned mode-0600 file. Added a Linux root regression; Windows full test/vet/build and Linux root-specific execution pass.
- web/backend(runtime): active startup now prepares `scheduler_restart_no_backfill` evidence before the first historian cycle and retries fail-closed if the gap write is unavailable. Added runtime-wiring coverage beyond the existing scheduler-unit test.
- board/gap: reconciled the maintenance outage only after a coherent pre-change checkpoint and zero-overlap hot-row proof, recording explicit UI-01/AO-01 generation-1 `[from,to)` restart gaps. A later controlled 20-second restart produced two automatic scheduler restart gaps on the final binary.
- board/package: final ARM64 current/rollback binaries are byte-identical at SHA-256 `dcd171d35bfb3ccfedf4087726b0d1fe11b18b0ece90f1a7b7ce405cc8ffa52a`; native legacy/active schema-v5 package gate and six immutable artifact families pass, manifest SHA-256 `47cbfcb0b6fea44aff4ede381f9608ea95157311260a0df483a8180189b81f88`.
- verification: final board services are active with web `NRestarts=0`; legacy rows remain fixed while v2 hot rows advance; live schema-v5 rollback verification is evidence-bound; `/login=200`, unauthenticated status `401`, authenticated Trends config `200`, and an aligned unified history window is `complete=true`. A later five-minute sample still showed recurring core IPC degradation and explicit `snapshot/read_failed` gaps, so physical power-cut, runtime-source stability, browser/manual E2E, 48-hour boundary, eMMC endurance/write-amplification and long soak remain open; Plan 42 is not release-Done.

### Added - ARM64 rollback preflight and activation fault coverage (2026-07-21)
- test(board/historian): cross-built separately named Linux/ARM64 current and rollback binaries (`CGO_ENABLED=0`), executed both on Orange Pi `/tmp` against a coherent frozen copy of the live historian DB, and captured [arm64-rollback-preflight-2026-07-21.md](docs/00_management/evidence/historian/arm64-rollback-preflight-2026-07-21.md). Both binaries rejected the board's schema-v1 fixture with exit code `1` because schema v5 is required; fixture SHA stayed unchanged. This is fail-closed preflight evidence, not a GREEN parity/cutover result; no service or persistent board data was changed.
- test(backend/activation): added restart-forward coverage for injected faults after prepare and after SQLite active; prepared state remains pending until explicit forward commit, while post-active recovery keeps v2 writer/query authority and forbids legacy writer. Verification: focused activation/fault/archive/migration/recovery/scheduler matrix `count=10` passes (`41.847s`); frontend Vitest `52/52`, lint, typecheck and production build pass.
- docs(historian): reconciled Plan 42 v1.16, phase plan v1.22, web guide v1.31, checklist v1.46 and ADR-018 v1.11 with ARM64 schema-v1 fail-closed evidence, frozen schema-v5 package parity GREEN, native manifest, and remaining live-board blockers. Physical power-cut, target eMMC/endurance, browser/manual E2E and production cutover remain open.
- test(board/storage): captured a read-only Orange Pi baseline (`29.3 GB` filesystem, `15.27 GB` free, historian DB/WAL/SHM `77,824/40,960/32,768` bytes, web RSS `30,872 KiB`, core RSS `5,336 KiB`). `mmc extcsd` exposed no life/pre-EOL telemetry and no live `fio` workload was run; this is not an eMMC capacity/write-amplification/endurance GREEN result.
- test(board/smoke): read-only board smoke returned `/login=200`, unauthenticated `/api/v1/system/status=401`, and active core/iobus/web services, but the journal showed repeated legacy `SQLITE_BUSY` writes from `virtual_points.sample` and `trend.sample`; storage health remains non-GREEN and cutover is blocked.
- test(board/soak-audit): confirmed the existing 24-hour time/service soak completed at `2026-07-21T02:40:45Z` with all services active, NTP normal and disk at `48%`; final windows still reported roughly `167..199 SQLITE_BUSY/2m`. This is supporting service/time evidence only and fails historian storage-health acceptance.
- web/backend(legacy-storage): serialized all legacy TrendStore mutations behind the existing authority fence so physical/VP samplers, prune and config writes cannot open competing SQLite write transactions. Added a 64-writer regression alongside quiesce/resume coverage; focused TrendStore suite `count=10` passes (`8.360s`). The fix is code/local only and has not been deployed to the board, so observed board `SQLITE_BUSY` remains an open rollout gate.
- test(board/arm64): rebuilt the intermediate post-serialization pair for ARM64; both binaries rejected the board schema-v1 frozen fixture with exit code `1`, and its SHA stayed unchanged. This pair is superseded by the final prebuilt-package pair recorded next.
- web/backend(packaging): added `--current-binary` + `--rollback-binary` prebuilt-native mode so a board without Go can verify packaged artifacts and emit its own manifest. Final ARM64 board run over isolated schema-v5 legacy/active fixtures is GREEN: both binaries SHA-256 `440aae2b3377e3fa65373663d59aecc5abfaf1fd28aa3cc4eb51bfee0835a39c`, 4 artifact families unchanged, manifest SHA-256 `047470cd6c67efb855a09e37b2e8f103b436d35d2e500cf0023804b3c84e0578`. Final focused package suite passes (`29.144s`); final backend `go test -count=1 ./...` passes (`62.241s`), `go vet ./...` and `go build ./...` pass. Live board schema-v1 fail-closed and `SQLITE_BUSY` blockers remain.
- test(board/canary): started the final ARM64 binary in an isolated `/tmp` runtime on port `18081` with separate config/TrendStore and a frozen schema-v5 active fixture. It listened successfully, returned `/login=200` and unauthenticated status `401`, preserved fixture SHA, exited cleanly on `SIGTERM`, and removed all temporary files. The expected `policy mirror pending` warning from the deliberately mismatched minimal policy keeps authority fail closed; production service and data were untouched.

### Added - Native historian rollback package parity gate (2026-07-21)
- web/backend(packaging): added `historian-rollback-package` to independently build native current and rollback-candidate binaries with deterministic flags, require byte/build-target parity, record SHA-256/size/Go toolchain and build settings, and atomically publish `historian-rollback-package-evidence.json` without overwriting existing release evidence.
- web/backend(rollback-safety): the package gate executes both binaries against repeatable schema-v5 fixtures, snapshots the complete SQLite sidecar family plus supplied archive/evidence files before and after, rejects symlinks/file-set changes/mutations, bounds verifier output and refuses non-native target claims. Frozen rollback fixtures now open with SQLite `immutable=1` in addition to read-only/query-only controls so verification creates no WAL/SHM evidence side effects.
- test/docs(historian): added a real subprocess gate covering separately built binaries, legacy and active schema-v5 authority, frozen WAL-sidecar and archive/evidence immutability, plus required-input rejection; reconciled ADR-018 v1.9, Plan 42 v1.14, phase plan v1.20, web guide v1.29 and checklist v1.44. Verification: focused package gate passes (`28.161s`); full backend `go test -count=1 ./...` passes (`56.295s`), `go vet ./...` and `go build ./...` pass. ARM64/board package execution, power-cut rehearsal, production cutover, automatic prune scheduling, target eMMC and E2E remain open.

### Added - Schema-v5 rollback compatibility verifier (2026-07-21)
- web/backend(rollback): added a strictly read-only `VerifyHistorianRollbackCompatibility` gate and `historian-rollback-verify --db <fixture>` subcommand. It requires schema v5, `quick_check=ok`, the activation/evidence/quiesce tables and exact active marker → migration/policy/backup/quiesce evidence joins; it never calls migrations or activation reconciliation.
- test(backend): added legacy, safely active, future-schema and bounded-JSON command fixtures. Active fixtures keep legacy writer forbidden, legacy fixtures remain resumable, unsupported schema fails closed, and before/after SHA-256 proves verifier access does not mutate the DB. Verification: focused rollback/maintenance CLI suite `count=10` passes (`8.749s`); full `go test -count=1 ./...` passes (`24.209s`), `go vet ./...` and `go build ./...` pass. Packaged rollback-binary hash/parity and board rehearsal remain open.

### Added - Offline historian maintenance operator CLI (2026-07-21)
- web/backend(cli): added `historian-maintenance` as a manual-only binary subcommand with required immutable manifest template, separate final-manifest output, final backup, stable UTC, matching window ID and exact `ACTIVATE-HISTORIAN-V2` confirmation. It emits a bounded JSON result and never exposes an HTTP route or enables prune scheduling.
- web/backend(cli-safety): normal server mode now publishes an owner-only `mkddc-web.running` presence file. Offline cutover refuses while that file exists, restricts backup/final-manifest writes to `historian-v2-migration`, requires a fresh legacy authority state and rejects manifest/window mismatch, invalid UTC, unknown args and unsafe timeouts.
- test(backend): added RED/GREEN parser and offline preflight coverage for confirmation, UTC, timeout, service-presence cleanup, path containment and operation identity. Verification: focused CLI/maintenance/write-fence suite `count=10` passes (`9.577s`); full `go test -count=1 ./...` passes (`33.658s`), `go vet ./...` and `go build ./...` pass. CLI has not been invoked on the board; rollback-binary compatibility, power-cut rehearsal, target eMMC and E2E remain open.

### Added - Maintenance-only historian cutover orchestration (2026-07-21)
- web/backend(historian-maintenance): added an explicit operator-only sequence that write-fences the legacy TrendStore, stops and waits both physical and Virtual Point legacy samplers, creates/reuses a verified final native backup, freezes the migration manifest from that backup, migrates the complete source snapshot, records quiesce-bound durable evidence, writes generation-aware maintenance gaps, then runs activation prepare/commit. No startup or public HTTP path invokes it.
- web/backend(lifecycle): added durable schema-v5 quiesce epoch/token state, tracked sampler cancellation/wait, WAL checkpoint fencing and a separate `LegacyWriterAllowed` authority gate so degraded post-activation state cannot restart legacy writers. Backup failure resumes legacy and abandons the proof; after prepare/commit begins, recovery remains forward-only.
- test(backend): added maintenance happy-path ordering/authority/gap assertions, invalid-backup rollback/resume coverage, stale-proof invalidation and TrendStore write-fence tests. Verification: focused maintenance/lifecycle/migration suite `count=10` passes (`24.770s`); full `go test -count=1 ./...` passes (`25.981s`), `go vet ./...` and `go build ./...` pass. Production invocation, board maintenance cutover, legacy removal, automatic prune scheduling, target eMMC/power-cut and `E2E-HIST-001` remain open.

### Changed - Evidence-bound historian activation (2026-07-21)
- web/backend(historian-activation): added schema-v4 `historian_cutover_evidence` with immutable migration/manifest/policy bindings, native-backup SHA/schema/quick-check/size evidence, deterministic full-keyspace source digest, migration outcome digest and accepted/rejected coverage counts.
- web/backend(historian-activation): activation preparation and reconciliation now revalidate the durable evidence row, migration phase, manifest checksum and verified policy mirror; caller-supplied `MigrationVerified` no longer grants authority. Backup publication fsyncs the completed file before hard-link commit, and active config checksum/revision is rechecked before runtime writer/query authority.
- test(backend): added RED/GREEN coverage for missing evidence, caller-boolean bypass, migration-phase mutation, idempotent evidence recording, active-config corruption and authority fail-closed behavior. Verification: focused evidence/activation suite `count=10` passes (`10.638s`); full `go test -count=1 ./...` passes (`25.056s`), `go vet ./...` and `go build ./...` pass. Production final backup/quiesce invocation, prune scheduling, legacy removal, target eMMC/power-cut and E2E gates remain open.

### Added - Historian activation transaction and boot reconciliation (2026-07-21)
- web/backend(historian-activation): added a TDD `Prepare -> filesystem commit -> SQLite active -> boot reconcile` coordinator. Preparation validates the verified policy revision/digest, persists SQLite `prepared`, checkpoints WAL, writes owner-only prepared policy plus metadata, and keeps legacy authority while uncommitted.
- web/backend(historian-activation): the exact policy bytes are published through a strict fsync-temp/atomic-rename/parent-sync commit point. A crash after filesystem commit leaves durable metadata; restart verifies revision/checksum and idempotently promotes SQLite to `active`. Mismatch or an uncommitted prepared policy remains fail-closed with `ErrHistorianActivationPending`.
- web/backend(authority): startup now reconciles activation before recording immutable runtime authority. Legacy sampling is suppressed only when an active v2 writer marker is present, and unified v2 query construction now requires active query authority instead of readiness alone. No activation marker is created by default, so existing deployments remain legacy/shadow.
- test(backend): added activation commit, post-rename fault recovery and uncommitted-prepared fail-closed tests. Verification: full `go test -count=1 ./...` passes (`27.675s`), `go vet ./...`, `go build ./...`, and `gofmt` pass; `git diff --check` remains clean apart from the existing unrelated `PointCard.tsx` line-ending warning. Production activation invocation, durable final-backup/full-migration evidence binding, target eMMC/power-cut testing, prune scheduling and legacy removal remain open.

### Changed - Physical historian rolling-prune engine (2026-07-21)
- web/backend(historian-retention): implemented a bounded physical rolling-prune engine behind a durable activation proof. It uses a SQLite prune queue, transactionally hides only committed archive prefixes, rebases/removes exhausted watermarks, validates archive checksum/codec before deletion, fsyncs the archive directory, and retries idempotently after an interrupted unlink or metadata phase.
- web/backend(historian-retention): expires hot samples and fully expired history gaps with the same identity/cutoff lease, preserves exact `[cutoff,...)` boundaries and generation isolation, and uses the latest persisted retention lease for deleted/recreated generations. A persisted stable UTC horizon rejects backward movement; readiness/shadow without reconciled `v2` authority returns `ErrHistorianRetentionDeferred` and deletes nothing.
- test(backend): added TDD coverage for activation guard, prefix/frontier rebase, all-tier expiry, bounded retry after metadata fault, backward stable UTC, corrupt archive fail-closed behavior, cancellation and v2→v3 migration. Verification: focused retention/migration suite `count=10` and full `go test -count=1 ./...` (`25.592s`), `go vet ./...` and `go build ./...` pass; `git diff --check` exits clean apart from an existing unrelated `PointCard.tsx` line-ending warning.
- docs(historian): physical prune engine is now DONE code/local, while execution remains inactive until filesystem activation/cutover reconciliation, final migration/legacy quiesce, target eMMC capacity/write-amplification/endurance benchmark and E2E gates are GREEN.

### Changed - Historian interval-bounded rolling retention amendment (2026-07-20)
- web/backend(historian-policy): added optional per-point `retentionDays`, deterministic Rev A maximums (`1s=30d`, `3s=60d`, `5s=90d`, `15s=180d`, `30s=365d`, `1m=730d`, `3m=1095d`, `5m=1460d`, `15m=1825d`, `30m=2555d`, `60m=3650d`), selected/maximum fields in policy snapshots, top-level `retentionMaxDaysByInterval`, atomic `historian_retention_invalid` rejection and retention-scaled capacity reserve projection.
- web/backend(historian-store): migrated the readiness store from schema v1 to v2 so mirrored policies accept any positive selected retention, preserve existing 180-day rows and retain a `1s/30d` policy across restart. Physical archive retention prune remains an explicit activation hook: readiness/shadow mode returns `ErrHistorianRetentionDeferred` and deletes nothing.
- fe(logging-control): added retention presets plus custom-day input, interval-aware maximum/fallback validation, read-only/control summaries, structured field focus/ARIA alerts and explicit copy that old data is only eligible for safe prune after v2 activation. Fine `1s|3s|5s` raw detail remains bounded to the RAM tail; current long-term archive data is folded to 15-second aggregates.
- docs(historian): reconciled OpenAPI 1.7.0, config schema Rev 2.1, ADR-018 v1.2, Plan 42 v1.7 and phase/guide/checklist status. The fixed maximum table is a product cap, not measured storage proof; target eMMC capacity, write amplification/endurance, physical prune, activation/cutover and full E2E remain open.
- Verification: frontend Vitest `52/52`, lint, typecheck, default build and `VITE_HISTORIAN_V2_TRENDS=1` build pass; backend `go test -count=1 ./...` passes (`28.408s`), `go vet ./...` and `go build ./...` pass; OpenAPI parses as 1.7.0 with 42 paths and retention/error contracts present; repository `git diff --check` exits clean.

### Added - WEB-HIST-005 shared Logging Control and feature-gated unified Trends (2026-07-20)
- fe(logging-control): added one reusable UI/AO/DO/VP database logging control with textual `off|scheduled|recording|error` status, 11 intervals, admin-only two-step immediate/future UTC activation, viewer/operator read-only behavior, revisioned policy updates, capacity/storage/conflict/field alerts, VP diagnostic-log separation, focus trap/Escape/focus restore and screen-reader alerts.
- fe(history): added explicit UTC `[from,to)` history client, generation-aware response normalization, structured 400/413/503 errors, CSV query parity, partial/gap/unavailable/no-history state banner, BAD/missing gap line breaks, boolean stepped lines and stale-response suppression. Trends can use v2 unified response without browser tier merge when `VITE_HISTORIAN_V2_TRENDS=1`; default `0` preserves legacy range/query authority until activation/cutover.
- Verification: frontend Vitest `50/50`, `npm run lint`, `npm run typecheck`, default and `VITE_HISTORIAN_V2_TRENDS=1` production builds pass; backend regression `go test -count=1 ./...` passes (`20.790s`), with `go vet ./...` and `go build ./...` GREEN. Browser/manual accessibility, activation/cutover, target eMMC and `E2E-HIST-001` remain open; legacy code/query removal is deferred.
### Added - WEB-HIST-004 unified UTC history query (2026-07-20)
- web/backend(historian-v2): added a generation-aware unified query engine for 1..8 canonical UI/AO/DO/VP IDs over explicit half-open UTC `[from,to)` ranges. The engine supports all 11 fixed resolutions plus `auto`, enforces `maxPoints<=5000` per series without silent truncation, merges RAM > hot > committed archive at 15-second base buckets, re-aggregates deterministically, preserves value/min/max/sum/count/worst-quality/source/tier semantics, returns empty generation series only after all tiers finish, and emits explicit partial gaps when a tier is unavailable or corrupt.
- web/backend(historian-query-store): added bounded, cancellable RAM/hot/archive readers with common per-request RAM coverage, hot/gap half-open reads, enabled-policy identity discovery, contiguous archive-watermark enforcement, committed-block checksum/codec/identity verification, safe local regular-file reads, generation isolation, typed partial archive errors and hard row/block/identity limits.
- web/backend(history-api): explicit `from`/`to` requests now use the v2 query engine; `/history/export.csv` streams the same iterator as JSON with RFC 4180 rows, metadata/gap comments and exact field parity. Legacy `range=30m|1h|6h|24h` requests still use the legacy adapter for rollback and frontend compatibility; query authority cutover and legacy removal remain deferred. Verification: final Windows full `go test -count=1 ./...` (`24.745s`), focused query/integration `count=10`, `go vet ./...` and `go build ./...` pass; supported Linux/amd64 ext4 `go test -race -count=1 -timeout 10m ./...` passes (`103.031s`; wall `122.69s`). Final formatting, stale-status search and scoped diff checks pass.

### Added - WEB-HIST-003 monotonic scheduler (2026-07-20)
- web/backend(historian-v2): completed the WEB-HIST-003 shadow code/local slice with deterministic per-point due schedules for all 11 fixed intervals, one coherent physical snapshot fan-out, generation-aware VP runtime union, 10-minute/64-MiB-accounted raw RAM tail, scheduled-UTC bucket identity, deterministic 15-second fold, due-identity queue overflow gaps, explicit snapshot/clock/queue/restart/storage evidence, durable per-identity backward-clock suspension, bounded retry-safe pending hot rows, policy-mirror retry before revision activation, and shutdown worker wait. Storage/snapshot failures no longer silently consume data: captured rows remain retryable and unrecoverable boundaries become explicit gaps. Legacy `TrendStore`, `Sampler`, VP diagnostic sampler and `/history` remain authoritative; WEB-HIST-004/005, activation/cutover, target eMMC and full E2E remain open. Verification: focused RED/GREEN slices, Windows `go test -count=1 ./...`, `go vet ./...`, `go build ./...`, focused Linux/amd64 race and full Linux/amd64 ext4 `go test -race -count=1 -timeout 10m ./...` pass with Go 1.26.4; scoped `git diff --check` pass. Windows race remains locally blocked by MinGW `cc1.exe: sorry, unimplemented: 64-bit mode not compiled in`.
- test(backend): changed the remaining alarm-settings multi-user fixture from bcrypt cost 12 to `bcrypt.MinCost`, matching the existing auth test fixture policy while leaving production hashing unchanged; this removes an unrelated full-race timeout.

### Added - Production Time/Date vertical slice (2026-07-18)
- core(time): captures one monotonic/UTC/civil `ClockSnapshot` per scan for schedule, alarm and runtime snapshot publication; alarm elapsed delay uses monotonic delta while alarm timestamps use injected UTC. Verification: focused Schedule/Alarm/ScanLoop `15/15`, Schedule+Alarm `41/41`, full WSL core `211/211` pass.
- web(time): adds revisioned strict Time config API, viewer-readable controller time status, apply-before-commit behavior, one-shot manual time persistence, audit-correlated operation IDs, fixed-argv bounded Linux Chrony/timezone/RTC adapter, and fail-safe backend tests. Durable operation-ID dedupe and recovery-required journal blocking are implemented; board RTC write and authenticated mutation gates remain open.
- fe(time): replaces `/settings/time` simulator-only toast behavior with config/status API integration, controller-time rendering, independent status refresh/degrade, dirty/save state, RFC3339-offset manual input and confirmation, plus demo parity. Verification: Vitest `3/3`, typecheck, lint and production build pass.
- docs(time): updates OpenAPI, config ownership/schema and Plan 44 implementation status. Rev A remains component-based; no IEC 61131-3 compliance claim.
- web/time follow-up: replaced target-mismatched timesyncd apply with Chrony status/config support and a root-only fail-closed helper invoked through a narrow sudoers command. Added durable owner-only operation journal states, restart-safe operation-ID dedupe, payload-conflict rejection and recovery-required blocking. Full backend `go test -count=1 ./...`, `go vet ./...`, Windows build and Linux ARM64 test-binary/build gates pass.
- deploy(orange-pi/time): deployed current FE dist and final backend SHA-256 `838f15ae4f9caeb6e736ce97e0e8dfe4cda38029d98efa1860d4a39429fd2964` with binary/dist backups. Replaced sudo, which is incompatible with web `NoNewPrivileges=true`, by `mkddc-time-helper.service`: root helper, bounded capabilities, fail-closed parser and `/run/mkddc/time-helper.sock` mode `0660 root:mkddc`; obsolete sudoers removed. Authenticated NTP PUT succeeded and idempotent retry did not reapply: revision `1→2`, config/OS timezone `Asia/Shanghai`, Chrony synchronized/healthy. RTC is HYM8563 `/dev/rtc0` but remains unreadable through `hwclock`; no manual clock mutation was run. Pre-existing `SQLITE_BUSY` VP sampler warnings remain.
- deploy(orange-pi/core-time): overlaid only Time clock-source files onto the last deployed COR-HIST source, built natively on ARM64, passed core `211/211`, backed up `/usr/sbin/mkddc-core`, and deployed SHA-256 `2fbb08881c0b5c312ee36bfe40fc83103abab61e101a7d4f3cffb422fcbff627` at stamp `20260718_124545`. Readiness required active service plus `/run/mkddc/core.sock`; no wall-clock mutation was performed.
- security(board/docs): removed stale plaintext SSH password guidance, kept key-only operator instructions, and rotated the Orange Pi web JWT secret at stamp `20260718_124940` out of the systemd unit into root-owned `/etc/mkddc-web.env` mode `0600`, with unit/environment backups and readiness rollback. Existing sessions are intentionally invalidated; user password hashes were not read or changed.
- fixed(board/time): authenticated manual `+120s` test exposed UTC text being parsed as `Asia/Shanghai` local time, producing an unintended `-8h` jump. NTP recovery restored system time; RTC was immediately resynced. Fixed helper conversion to format the requested instant in configured civil timezone before `timedatectl set-time`, then reran manual/NTP restore successfully: observed target delta matched the 5-second hold, final config revision `6`, Chrony synchronized, and RTC/system delta `0s`.
- deploy(board/time-helper): replaced the failed sudo path under `NoNewPrivileges=true` with enabled `mkddc-time-helper.service`, bounded capabilities and Unix socket `/run/mkddc/time-helper.sock` mode `0660 root:mkddc`. Final backend SHA-256 is `42deec2bdcfbc13d76bea819bd0c3b23a6b9d82bd2a9f89f6dfb9d1dffbd991d`. Authenticated NTP PUT plus idempotent retry passed with revision `1→2`; manual/NTP maintenance flow later reached revision `6`.
- test(board/time-soak): started a non-root 24-hour monitor at `2026-07-20T02:40:36Z`, PID `273443`, log `/home/orangepi/time-soak-20260720_104036.log`, sampling every 60 seconds. First sample: all five services active, NTP synchronized, Chrony leap normal, RTC aligned, disk 48%. Gate remains RUNNING until 24-hour completion; first sample also records pre-existing VP sampler `SQLITE_BUSY=123/2m`, so storage health is not GREEN.

### Added - Time/Date production and IEC 61131-3 readiness plan (2026-07-18)
- docs(time): added Plan 44 for production `/settings/time`, strict NTP/timezone/manual-time contracts, Linux/RTC ownership, UTC-versus-monotonic clock separation, DST/clock-jump safety, crash-recoverable apply journaling, revision/idempotency controls, backend/frontend/board gates, and a deferred Rev C adapter for IEC 61131-3 date/time semantics and timers. Manual clock mutation stays disabled until runtime clock-jump hardening passes. Rev A remains component-based and makes no IEC 61131-3 compliance claim. Verification: plan reconciled against canonical scope, ADR-004/009, current OpenAPI/config handlers, core scan/schedule/alarm clocks and existing frontend demo behavior; independent adversarial review findings on mutation ordering, partial apply, DST identity, audit ordering and reboot semantics were incorporated; implementation remains open.

### Added - WEB-HIST-001 backend policy slice (2026-07-17)
- web/backend(historian): completed WEB-HIST-001 code/local slice with persisted Virtual Point generation/namespace revision authority, coherent core `point_snapshot` reader, and independent file-backed `historian.conf` per-point policy/capacity API. Contract includes optimistic policy and namespace revisions, generation reconciliation after VP recreate, 11 fixed intervals, backend UTC start, required-field checks, machine-readable `400`/`409`/`507` reasons, reservation/free-space validation and viewer-read/admin-write RBAC. Policy responses remain degraded while writer is inactive. Legacy `TrendStore`, `Sampler`, SQLite samples and `/history` adapter remain running and untouched by policy commits. TDD covers all four point kinds x intervals, immediate/future/past, mixed-batch atomicity, restart, revision/generation/namespace conflicts, concurrent same-revision commits, capacity/storage, cross-file namespace-write recovery, disable-preserves-history, no auto-all, RBAC and core response identity. Verification: focused suite, `go test -count=1 ./...` (`22.705s`), `go vet ./...`, `go build ./...`, Linux/amd64 CGO-disabled cross-build, `git diff --check`, and supported Linux/amd64 `go test -race -count=1 -timeout 10m ./...` (`266.998s`) pass. Capacity Rev A deliberately uses a conservative fixed per-enabled-point ceiling; measured codec/tier projection remains WEB-HIST-002 scope.
- docs(historian): reconciled Plan 42 core status and uppercase quality example, recorded current WEB-HIST/WEB-NAME partial status, and added focused implementation plan. No WEB-HIST-002..005, frontend or full historian Done claim.
- test(backend): reduced test-fixture bcrypt hashing to `bcrypt.MinCost`; production password hashing remains unchanged. This removes repeated cost-12 hashing from race-instrumented backend tests so supported Linux race verification can complete within bounded time.
- docs(historian): added the WEB-HIST-002 TDD implementation plan for a separate FULL-sync WAL v2 store, immutable policy mirror/hot aggregates/gaps, deterministic stdlib archive codec, contiguous watermark-gated prune, native SQLite backups, frozen-manifest resumable migration, damaged-copy recovery, and readiness-only wiring. Plan explicitly keeps legacy writer/query authority and defers scheduler, activation, cutover, frontend, and legacy removal.
- web/backend(historian-v2): continued WEB-HIST-002 with a separate, unwired `HistorianStore`: one-connection modernc SQLite, replacement-connection `_pragma` enforcement, FULL-sync WAL, foreign keys, bounded busy timeout, trusted schema off, owner-only file mode created before SQLite open, escaped SQLite URI paths, and schema v1 evidence tables. Task 2 adds copied exact-byte committed policy snapshots including canonical revision zero, post-filesystem-commit best-effort mirror callbacks outside the policy lock, immutable revision/checksum conflict detection with atomic child rollback, bounded generation-aware hot batches with exact-retry verification and conflicting-duplicate rejection, plus idempotent half-open gaps preserving reason/detail identity. Task 3 adds deterministic stdlib `mkhab-v1` archive encoding with a frozen golden SHA-256, fixed bounded header/body/trailer, sorted rows and UTF-8 source dictionary, negative-zero normalization, finite aggregate validation, 24-hour/5,760-row/64-byte point/255-source/320-KiB limits, and checksum-first bounded decoding that rejects noncanonical UTF-8/floats, corruption, truncation, trailing bytes, unsupported flags/version, duplicate slots, and metadata mismatch. Task 4 adds canonical explicit-gap payload evidence, exact per-slot day coverage validation, stable-cutoff requirement, durable `building -> verified -> committed` transitions, no-overwrite hard-link publication with regular-file checks and deterministic crash hooks, independent post-publication decode/metadata verification, per-identity contiguous origin/watermarks, generation isolation, idempotent lost-ack retry, and fail-closed 48-hour prune requiring a matching committed frontier block. Task 5 adds bounded native modernc SQLite online backups kept inside `Conn.Raw`, unconditional `Finish`, bounded BUSY/LOCKED retries, cancellation checks, unique retained partial evidence, fail-if-exists hard-link publication, independent read-only quick-check/schema/file-checksum verification before and after publication, and one-connection-pool safety. Frozen manifests checksum canonical content, sort copied mappings, validate source identity/SHA-256/rule versions/generations, publish without overwrite, allow exact idempotent retry, and reject changed source/schema resume. Task 6 adds checked seconds/milliseconds normalization, frozen `legacy-trend-v1` source and rule versions, finite/negative-zero-safe aggregation, quality validation, collision resolution before aggregation, exact-duplicate dedupe, deterministic tie/rejection ordering, migration gap evidence, 15-second epoch buckets, and transactional staging where raw rows/cursor commit atomically and final hot rows/rejections/gaps/staging cleanup/verified phase share one transaction. Frozen source row count prevents premature finalization; manifest checksum and exact hot-row checks make changed/replayed chunks fail closed or idempotent. Task 7 derives independent v2 DB/archive/migration paths from `ConfigDir`, runs read-only integrity preflight before writable v2 open, preserves DB/WAL/SHM into unique owner-only fsynced evidence directories without changing originals, and disables only v2 on corruption. A separately verified recovery candidate can be published via no-overwrite hard link only after original-family evidence and quarantine directory sync; second startup verifies clean. `NewApp` opens v2 readiness independently, mirrors current exact policy best-effort, starts no v2 scheduler/writer, keeps legacy `TrendStore`, sampler and `/history` authoritative on v2 failure, and closes legacy/v2 handles independently with joined errors. Verification (2026-07-18): focused recovery/readiness/history tests pass; full backend test/vet/build and scoped `git diff --check` rerun after Task 7. Focused Windows race remains blocked by local GCC; supported Linux race gate remains required.
- web/backend(historian-v2 recovery verification): preflight now opens only a scratch copy of the coherent DB/WAL/SHM family, so SQLite cannot mutate original evidence before preservation or recovery selection. Verification (2026-07-18): focused recovery/readiness/history tests pass; `go test -count=1 ./...` passes (`37.543s`), `go vet ./...`, `go build ./...`, and scoped `git diff --check` pass. Supported Linux race gate remains Task 8.
- docs/test(historian-v2): recorded WEB-HIST-002 readiness-only boundary, `mkhab-v1` limits, exclusive watermark semantics, backup restart behavior, damaged-family rules and deferred cutover. Verification (2026-07-18): fresh `go test -count=1 ./...` pass (`23.918s`), `go vet ./...` pass, `go build ./...` pass, focused archive/migration/recovery/readiness suite `count=10` pass (`5.498s`), and `codegraph sync .` synced 39 changed files. Linux race remains blocked because WSL ext4 has no Go and no Docker daemon/cached Linux toolchain is available; WEB-HIST-002 remains IN PROGRESS, not Done.
- test(time): isolated the Linux RTC status fixture from a host `/sys/class/rtc/rtc0` device by using a non-system fake RTC basename, so the test consistently exercises its mocked `hwclock` response on WSL/board-like hosts. Production time code is unchanged. Verification: focused Linux race rerun and full backend Linux race gate recorded with WEB-HIST-002 evidence.
- test/docs(historian-v2): completed WEB-HIST-002 code/local gate. Bootstrap verified Go 1.26.4 Linux/amd64 in WSL user-local via Ubuntu package extraction plus checksum-verified Go toolchain download; copied backend to ext4-compatible WSL path with historian source SHA-256 parity; Linux `go test -race -count=1 -timeout 10m ./...` passed in `287.407s`. Windows full test/vet/build, fault suite `count=10`, docs/checklist reconciliation, `git diff --check`, and `codegraph sync .` also pass. WEB-HIST-002 code/local is Done; target eMMC, full E2E and WEB-HIST-003..005 remain open.

### Added - Core historian snapshot model and scan publication (2026-07-17)
- core(COR-HIST-001): completed and locally verified the fixed 24-row UI/AO/DO coherent runtime snapshot after priority resolve and safe-state. Physical output is written before snapshot publication; a bounded fixed-buffer serializer/cache removes heap allocation from zero-client per-scan publication while preserving uppercase quality, actual source semantics, generation `1`, UTF-8 replacement/JSON escaping and non-finite `null`/`BAD` wire values. IPC remains strictly parsed, read-only, cached and budgeted. Allocation probe passes zero allocations across 1,000 warmed model builds plus publications, and ordering observer proves output write precedes serialization. Clean WSL/Ninja Release `CORE_BUILD_TESTS=ON` passes 209/209; focused RuntimePointSnapshot/WebIpc/ScanLoop passes 64/64; clean production `CORE_BUILD_TESTS=OFF` build passes; synthetic worst-width stress fixture measures 6,427 bytes including newline under the 65,536-byte cap; `git diff --check` passes. No SQLite, SHM ABI, backend or frontend change. DI remains deferred pending capability authority; `WEB-HIST-001..005` remain planned and `E2E-HIST-001` retains target board jitter/eMMC/recovery/release gates.
- deploy(orange-pi): native ARM64 core build and `209/209` tests passed on Orange Pi 5B; backed up and deployed `/usr/sbin/mkddc-core` plus the current Go backend with backup timestamp `20260717_144250`, then restarted `mkddc-core` and `mkddc-web-pi`. Deployed SHA-256: core `44fc88a866438cc1a376ab2d470a4aa0d6938be9bffea67def3a1bd9672fc863`, backend `d23e2ad250040a7c57455074060010a8876ac7f618643af18d44a6eab640f8e6`. Verification: both services active; authenticated system status reports core/iobus/web/IOP `ok`, IOP `normal`, scan overrun `0`; direct Unix-socket `point_snapshot` returned `accepted` with 24 rows (`UI=16`, `AO=4`, `DO=4`); observed runtime jitter windows remained below `307 us` maximum with zero overruns. Existing warnings remain: invalid `schedule.conf`, no-FIFO degraded scheduling and legacy historian `SQLITE_BUSY`; database writer work is still open.

### Changed - Inputs Live Data raw cell merge (2026-07-17)
- web/fe(inputs,outputs,virtual-points,demo): merged separate Raw (V) and Raw (mA) cells into single Raw cell showing value with unit inline. Added Raw data read-only field to ChannelBasics and OutputBasics config tables. Added Raw column to historical data table in TrendChart (Inputs, Outputs). Added Live Trend chart with stats (min/max/avg) to Virtual Points Summary view. Added raw/rawUnit to demo AO points with jitter-based values. Output rawUnit falls back to config mode (0-10V/4-20mA) when point.rawUnit unavailable. Verification: `npm run typecheck`, `npm run lint`, `npm run build` pass.

### Added - Output engineering units (2026-07-16)
- web/fe(outputs): added AO engineering unit and minimum/maximum present-value controls to Wizard and Advanced views. Values round-trip through `io_config.conf` (`units`, `min_pv`, `max_pv`), already validated by backend and consumed by core BACnet AO mapping. `/points` now exposes SOM `ao_setpoint[]` as AO `raw` with `V`/`mA` unit from `ao_mode[]`; Output Summary displays it. Verification: `go test ./...`, `go vet ./...`, `go build ./...`, frontend `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` pass.

### Changed - Virtual Point tag-only display (2026-07-16)
- web/fe(virtual-points): removed Virtual Point Label from active validation, normalization, API output and authoring UI; VP Tag is now the sole user-facing name across Virtual Points, Monitoring, Trends, Dashboard cards, Scheduler targets and Alarm source selectors. Canonical `VPn` IDs remain internal keys for runtime/history/API stability and are no longer rendered on those VP-facing surfaces when a custom Tag exists. Verification: backend regression asserts `VP1` + `doraemon` projects as `name=doraemon`; full Go tests/vet/build and frontend lint/typecheck/build pass; `git diff --check` pass.
- deploy(orange-pi): deployed Linux ARM64 backend SHA-256 `b340652a07f11aac3772dd8e5a135545fe13abc1e9be3137655607e409771fed` and frontend asset `assets/index-TGVsaHyw.js`, with backups `/opt/mkddc-web/mkddc-web.bak.20260716_153743` and `/opt/mkddc-web/dist.bak.20260716_153743`. Verification: `mkddc-web-pi` active; VP API emits zero `label` fields; channel 25 lookup returns internal `VP1` with equal `tag` and `name`; `/monitor` and `/trends` return 200.

### Added - COR-HIST-001 implementation plan (2026-07-16)
- docs(core/historian): added a TDD implementation plan for coherent read-only UI/AO/DO runtime snapshots, including stateful source-age tracking, post-safe-state scan publication with a test-only observation seam, strict `point_snapshot` parsing, cached serialization, bounded client/read/write budgets, partial-write recovery, source/unit/generation semantics, edge-case tests, regression gates and evidence reconciliation. Verification: plan mapped against current `PointTable`, `ScanLoop`, `WebIpc`, CMake tests, Runtime Model and Plan 42; three review rounds resolved implementation blockers; implementation not started.

### Changed - Global point channels and fixed physical tags (2026-07-16)
- web/fe(point identity): added unique global programming channels (`UI=1..16`, `AO=17..20`, `DO=21..24`, `VPn=24+n`), numeric-channel point lookup, deterministic VP channel reuse through the lowest free `VPn`, immutable canonical physical tags, and editable globally unique VP tags. Inputs Config, Outputs Config, and Virtual Points now show `Tag | Channel | Label`; fixed physical fields and all channels are read-only. Verification: targeted and full Go tests pass; `go vet ./...`, `go build ./...`, frontend lint/typecheck/build and `git diff --check` pass. Frontend `npm run test` reports no test files and exits 1.
- deploy(orange-pi): built and tested the backend natively as Linux ARM64 on Orange Pi, deployed backend SHA-256 `68a50db3198f4ba0ed3257d2ebde46721e7d7dd885c8adef3534438509a46dc6` plus frontend asset `assets/index-B8D5zl-t.js`, and restarted `mkddc-web-pi`. Backups: `/opt/mkddc-web/mkddc-web.bak.20260716_144741` and `/opt/mkddc-web/dist.bak.20260716_144741`. Verification: service active on port 8081; authenticated status `overall=ok`; 24 physical tags canonical with zero duplicate physical channels; VP API returned channels 25..28; numeric lookup channel 25 returned `VP1`; `/eng/virtual-points` and `/login` returned 200. Runtime journal still reports intermittent pre-existing `SQLITE_BUSY` sampler warnings.

### Changed - Historian implementation plan completion (2026-07-16)
- docs(historian): restored accepted `ADR-018` and completed Plan 42 with coherent core snapshot ownership, required per-point policy/health diagnostics, bounded RAM/48-hour hot/>=180-day archive tiers, frozen-manifest final-snapshot legacy migration, filesystem-authoritative crash-safe activation, corruption recovery, monotonic/clock-jump scheduling, deterministic aggregation/watermarks/gaps, unified query/CSV contract, frontend controls, vertical-slice dependencies, measurable test gates and tested forward-compatible rollback. Rev A requires the 48-hour hot tier rather than accepting an undefined direct-to-archive mode. Verification: document links and implementation status reviewed against current `TrendStore`, `Sampler`, Runtime Model, OpenAPI, config schema and master task checklist; three independent spec review rounds resolved data-safety and contract findings; product implementation remains open.

### Fixed - Frontend Tailwind dependency install (2026-07-16)
- fe(tooling): restored the npm-managed frontend dependency tree after mixed package-manager state left `tailwindcss/index.css` missing and blocked Vite. No frontend source or configuration changed. Verification: `npm ci` and `npm run build` pass in `src/frontend`.

### Changed - Orange Pi FE/BE rebuild (2026-07-16)
- deploy(build): rebuilt the local frontend and built the current backend tree natively for ARM64 on Orange Pi in `~/work/mkddc-web-build-20260716`. Verification: `npm run build` pass; backend ARM64 static binary SHA-256 `1bdf765042fb3d03f80154f07db38f454ce37f07ccd44f0898653974db8d7cf8`; backend test gate failed at `TestValidateConfigIORejectsInvalidAoBacnetProperties/long_name`, so `mkddc-web-pi` was not replaced or restarted and remains active with the previous binary.

### Fixed - Frontend point-name control validation (2026-07-15)
- fe(point metadata): reject control characters before whitespace normalization so names containing newline/tab cannot pass client validation. Verification: `npm --prefix src/frontend test -- src/api/pointTags.test.ts` pass; `npm --prefix src/frontend test` pass.

### Changed - Point historian scheduling and unique display-name contracts (2026-07-15)
- docs(ADR-018/Plan 42): owner-approved one backend-owned per-point database logging policy for UI-01..16, AO-01..04, DO-01..04 and numeric/boolean VP, with 11 intervals, immediate server-time or future UTC start, persistent off/scheduled/recording states, restart gaps/no backfill, 48-hour hot cache, >=180-day archive and unified backend Trends merge.
- docs(ADR-019/Plan 43): owner-approved independent global display-name namespace alongside existing technical tags; blank legacy names migrate to canonical IDs, content-duplicate legacy names stay readable but block unrelated mutations until conflict-reducing rename, and rename/delete preserve historian identity by canonical ID + generation.
- docs(contracts/plans): bumped CONFIG_SCHEMA Rev 1.9, Runtime Model Rev 1.3, REST MD Rev 1.3/OpenAPI 1.6.0, guides 07/09, phase/checklist/SOM plans and indexes. Added PLANNED `COR-HIST-001`, `WEB-HIST-001..005`, `WEB-NAME-001`, `E2E-HIST-001`; no product completion claim.

### Changed - Trends filters restored (2026-07-15)
- fe(trends): restore Add Trend modal with ID/name search and point-kind filters, plus custom From/To filtering over the deployed legacy 24-hour historian window. Keep quick ranges, 1-second live display buffer, latest-five timestamp table, and no Historian policy panel.

### Fixed - Live Trends legacy historian compatibility (2026-07-15)
- fe(trends): removed the stale ADR-018 frontend prototype from the active source tree, restoring the deployed `GET /history?point=...&range=30m|1h|6h|24h` flow and the existing 1-second live display buffer. Trends no longer renders the unsupported Historian policy panel. Verification handed to owner; local frontend lint/typecheck/build pass.

### Fixed - Trivy PR scan scope (2026-07-10)
- ci(security): stopped the Trivy PR workflow from generating and scanning the GitHub runner Debian package list, kept the scan focused on repository dependency manifests, disabled stale Trivy DB cache restore, limited Trivy to vulnerability scanning, and made SARIF output honor the configured `CRITICAL,HIGH` severity gate so UNKNOWN advisories do not fail the PR gate. Verification: local `trivy fs --scanners vuln --severity CRITICAL,HIGH --format table --exit-code 1 .` reported 0 npm/go vulnerabilities on the PR #50 merge tree; local all-severity scan reproduced `GO-2026-5932` as UNKNOWN; GitHub PR #50 rerun pending.

### Fixed - Virtual Point PR CI call-site sync (2026-07-10)
- web/fe(virtual-points): completed the remaining Virtual I/O to Virtual Point call-site migration for PR #49 so backend config, alarm, point, trend, scheduler, websocket, and frontend API/page paths compile against `virtual_points.conf`, `/api/v1/virtual-points`, and canonical `VP` IDs. Verification: `go test -count=1 -run TestVirtualPoint .` pass; `go test -count=1 ./...` pass in `web/backend`; `go build ./...` pass in `web/backend`; `npm run lint` pass; `npm run typecheck` pass; `npm run build` pass; `npx vite build --emptyOutDir=false` pass; `git diff --check` pass.

### Fixed - Virtual Point EasySet wizard metadata (2026-07-09)
- web/fe/docs(virtual-points): restored the Inputs/Outputs-style `Summary / Wizard / Advanced` authoring flow on `/eng/virtual-points`, added `u0..u7` Wizard steps for VP signal type, display min/max, range multiplier, fixed Units dropdown, filter samples, sensor calibration, and math function, and persisted those fields through `virtual_points.conf` instead of dropping them on save. Units are normalized to the fixed EasySet list (`""`, `percent`, `degC`, `Pa`, `ppm`) rather than free text. Verification: `go test -count=1 -run TestVirtualPoint .` pass; `go test -count=1 ./...` pass in `web/backend`; `go build ./...` pass in `web/backend`; `npm run lint` pass; `npm run typecheck` pass; `npx vite build --emptyOutDir=false` pass. `npm run build` was blocked by the active local Vite/dev process holding `src/frontend/dist/assets` (`EPERM`), so the no-empty build was used without stopping the user's running UI.

### Changed - Orange Pi DDNS VP deployment (2026-07-09)
- deploy(board): deployed the current VP backend and frontend bundle to the Orange Pi over DDNS (`orangepi@mekong-fac.ddns.net:2222`) for off-LAN testing, replacing `/opt/mkddc-web/mkddc-web` with the linux/arm64 build and syncing `src/frontend/dist` to `/opt/mkddc-web/dist`. Backups kept at `/opt/mkddc-web/mkddc-web.bak.20260709230819` and `/opt/mkddc-web/dist.bak.20260709231113`. Verification: `mkddc-web-pi` restarted active on port `8081`; authenticated `/api/v1/system/status`, `/api/v1/virtual-points`, and `/api/v1/system/config/virtual-points` returned `200`; `/eng/virtual-points` returned `200` from the board-served SPA.

### Changed - Virtual Point VP-only pivot (2026-07-09)
- web/core/fe/docs(virtual-points): replaced the VI/VO model with backend-owned created Virtual Points (`virtual_points.conf`, `VP1..VP464`) carrying `boolean|integer|float|string|datetime` signal types, writable flags, and log tiers (256 non-logged, 128 at 1s, 64 at 100ms, 16 at 10ms diagnostic). `/points`, Monitoring, Trends, and history now depend on created VP metadata instead of raw core AV/BV/MSV slots; Trends only charts created logged numeric-compatible VP, and `/trends/config` rejects uncreated raw AV/BV/MSV virtual slots. Alarm settings now accepts created numeric-compatible VP sources, backend alarm listing evaluates high/low Virtual Point alarms, Scheduler validates created writable integer/float VP targets including controller operation mode, and the backend virtual scheduler writes VP values while core skips backend-only VP schedule/alarm rows. Legacy `AV` IDs remain accepted as aliases for VP references, but API/UI responses now use canonical `VP1` IDs; core `kind=AV` stays internal BACnet Analog Value and old VI/VO alarm sources are rejected. Multi-agent review follow-up removed stale MSV/BV scheduler targets, made Monitor/Trends cross-check `/virtual-points`, made VP alarm sources integer/float-only, moved 10ms Virtual Point samples to an in-memory history ring, fixed VP scheduler/alarm canonical output, preserved internal AV C++ schedule/alarm behavior, hardened C++ integer parsing, prevented backend-only VP schedules from masking internal AV winners, and made alarm history polling include Virtual Point alarms. Verification: `go test -count=1 ./...` pass in `web/backend`; `go build ./...` pass in `web/backend`; `npm run lint` pass; `npm run build` pass; WSL `cmake --build build/services -j2` pass; WSL `ctest --test-dir build/services --output-on-failure` 332/332 pass.

### Changed - Orange Pi live run refresh (2026-07-09)
- deploy/runbook: rebuilt `mkddc-web` for linux/arm64 from the current local backend tree, copied the backend binary and `users.conf` to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and started the local Vite frontend as a detached Windows process on port `5173` with `VITE_PROXY_TARGET=http://192.168.1.18:8081`. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `21868`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.
- deploy/build: rebuilt the current local backend and frontend code, cross-compiled `mkddc-web` for linux/arm64, redeployed it to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and restarted the detached local Vite frontend on port `5173`. Verification: `go build ./...` pass in `web/backend`; `npm run build` pass in `src/frontend`; WSL `cmake --build build/services -j2` pass (`ninja: no work to do`); board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `20752`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.
- deploy/runbook: LAN access to `192.168.1.18:22/8081` was unavailable, so the backend was rebuilt for linux/arm64 and redeployed through WAN SSH `mekongfactory.ddns.net:2222`; `mkddc-web-pi` was restarted on board port `8081`, a detached Plink tunnel was opened at local `18081`, and the local Vite frontend was restarted on port `5173` with `VITE_PROXY_TARGET=http://127.0.0.1:18081`. Verification: board `ss` showed `*:8081` listening; Plink tunnel listened on `127.0.0.1:18081` under PID `21036`; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `16888`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.

### Changed - Virtual I/O alarm and scheduler integration (2026-07-08)
- core/web/fe/docs(virtual-io): fixed FE backing-point canonicalization for dashed `AV/BV/MSV` aliases, stopped live `/points` from applying demo metadata, normalized demo virtual backing allocation, and allowed alarms/schedules to use VI/VO metadata through fixed AV/BV/MSV backing points. Scheduler now accepts VO analog backing `AV17..32` for `analog_output_value` and VO binary backing `BV9..16` for DO/fan schedules; alarm settings now accepts `VI`/`VO` sources backed by valid `AV/BV/MSV` pools, with OpenAPI channel bounds aligned to 64 virtual metadata slots. Follow-up review fixes preserve canonical `AV17/BV9` schedule IDs, bind VI/VO alarm sources to `virtual_io.conf`, default omitted `enabled` to true, clean stale demo virtual points, keep VO scheduler presets, and reject overflowed C++ virtual point IDs. Verification: targeted Go virtual/schedule/alarm tests pass; `go test -count=1 ./...` pass; `go build ./...` pass; `npm run build` pass; `npm run lint` pass; WSL `cmake --build build/services -j2` pass; WSL `ctest --test-dir build/services --output-on-failure` 327/327 pass.

### Added - Virtual I/O authoring (2026-07-08)
- web/fe/docs(virtual-io): added persisted `virtual_io.conf` CRUD APIs, OpenAPI contract, `/eng/virtual-io` page, demo data, nav wiring, and core ID alias normalization so VI/VO metadata allocate fixed AV/BV/MSV backing slots without expanding core shared-memory counts; tightened `/points` boolean value docs, command validation, point ID lookup aliases, config schema requirements, and demo fixed-pool behavior. Verification: `go test -count=1 -run "TestHandlePoint|TestForcePoint|TestVirtualIO|TestCoreCommandPointID|TestCanonicalPointID" .` pass; `go test -count=1 ./...` pass; `go build ./...` pass; `npm run build` pass; `npm run lint` pass.

### Changed - Orange Pi live run refresh (2026-07-08)
- deploy/runbook: rebuilt `mkddc-web` for linux/arm64 from the current local backend tree, copied the backend binary and `users.conf` to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and started the local Vite frontend as a detached Windows process on port `5173` with `VITE_PROXY_TARGET=http://192.168.1.18:8081`. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `452`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.
- deploy/runbook: reran the OrangePi backend refresh from the current local backend tree and restarted the detached local Vite frontend. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `33424`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.

### Changed - Scheduler intervals and holiday priority (2026-07-07)
- core/web/fe/docs(scheduler): changed schedules from single `timeOfDay` events to `startTime`/`endTime` intervals, added `holiday_period` MM-DD override suppression above weekly schedules, and labeled scheduler capabilities as `WIRED`, `VIRTUAL`, `OVERRIDE`, or `STORED` without adding unsupported UI input targets. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; WSL services CMake build pass; `ctest --test-dir build/services --output-on-failure` 322/322 pass.

### Changed - Scheduler wizard navigation (2026-07-07)
- fe(scheduler): changed the Scheduler edit tab to a real Wizard flow with progress, step buttons, and Previous/Next/Finish controls matching the Inputs wizard pattern. Added save confirmation popup. Verification: `npm run build` pass; `npm run lint` pass.

### Fixed - Scheduler live fallback and contract validation (2026-07-07)
- fe/docs(scheduler): removed live-mode demo fallback for health/points API failures, aligned frontend executable schedule validation with backend/core even when rows are disabled, and documented OpenAPI executable rows as requiring `target` and `value` while `not_active`/`holiday_period` remain stored-only. Verification: `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Added - EasySet-style scheduler config and runtime execution (2026-07-07)
- core/web/fe/docs(scheduler): replaced the demo weekly grid with EasySet-style schedules (`timeOfDay`, weekdays, `scheduleType`, target, value), connected `/eng/scheduler` to real `/api/v1/schedules`, enforced a 64-schedule limit, persisted `schedule.conf`, and added core execution at priority level 4 (`schedule`) for AO/DO plus AV/MSV virtual schedule writes. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; WSL services CMake/Ninja build pass; `ctest --test-dir build/services --output-on-failure` 320/320 pass.

### Changed - Orange Pi live run refresh (2026-07-07)
- deploy/runbook: rebuilt `mkddc-web` for linux/arm64, copied the backend binary and `users.conf` to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and started the local Vite frontend as a detached Windows process on port `5173` with `VITE_PROXY_TARGET=http://192.168.1.18:8081`. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; port `5173` listened under PID `19368`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.

### Fixed - Alarm action body validation (2026-07-07)
- web/backend(alarms): reject unknown Ack/Off JSON fields and reject empty Off bodies so suppress cannot silently become a permanent hide. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `go vet ./...` pass; `npm run build` pass; `npm run lint` pass; WSL services CMake/Ninja build pass; `ctest --test-dir build/services` 311/311 pass.

### Changed - Alarm manual clear, timed ack/off, and flexible priority (2026-07-06)
- core/web/fe/docs(alarm): added `clearMode=auto|manual` alarm settings, flexible priority `params.severityRules`, timed/permanent Ack payloads, new Off/Suppress alarm action with duration dialog, `/api/v1/alarms/{id}/suppress`, and OpenAPI coverage. Manual-clear alarms stay visible after the signal returns normal until Off is confirmed. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; WSL services CMake/Ninja build pass; `ctest --test-dir build/services --output-on-failure` 311/311 pass.

### Fixed - Alarm history repeated END rows (2026-07-06)
- web/backend(alarms): record a new `started` event when an existing alarm id transitions from cleared/unack back to active, so recurring alarms no longer produce repeated `ended` rows without a matching `started`. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; linux/arm64 backend build pass; Orange Pi `mkddc-web-pi` restart pass; authenticated `/api/v1/alarms` smoke returned 200 JSON.

### Changed - Alarm history page filters (2026-07-06)
- fe(alarms): moved full alarm history to `/alarms/history` instead of expanding inside Alarm log, changed Alarm/Name history filters from free-text inputs to dropdown selectors populated from alarm settings and history rows, and made the history filter Clear control a full bordered button. Verification: `npm run build` pass; `npm run lint` pass.

### Changed - Orange Pi live run refresh (2026-07-06)
- deploy/runbook: rebuilt `mkddc-web` for linux/arm64, copied the backend binary and `users.conf` to OrangePi `192.168.1.18`, restarted `mkddc-web-pi` on port `8081`, and started the local Vite frontend on port `5173` with `VITE_PROXY_TARGET=http://192.168.1.18:8081`. Verification: SSH reached `orangepi5b` aarch64; board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned board CPU/RAM/temp/uptime fields.
- deploy/runbook: reran the OrangePi backend refresh and local Vite startup. Verification: board `ss` showed `*:8081` listening; Vite ready at `http://localhost:5173/`; smoke login returned role `admin`, `/api/v1/me` returned `admin`, and `/api/v1/system/status` returned `overall=ok`, `device_ip=192.168.1.18`, CPU/RAM/temp/uptime fields.
- deploy/runbook: restarted the local Vite frontend as a detached Windows process instead of a Codex-owned PTY process, so closing Codex does not stop `localhost:5173`. Verification: Vite log showed ready at `http://localhost:5173/`; port `5173` listened under PID `26828`; smoke login and `/api/v1/system/status` through the Vite proxy returned `overall=ok` from `192.168.1.18`.

### Changed - Alarm ACK return and full history filters (2026-07-06)
- core/web/fe(alarms): kept ACKed active alarms visible in the `acked` view, added `alarm_return`/Return to reactivate ACKed alarms, exposed real status/history filters with full-history mode, persisted alarm lifecycle/settings records in JSONL across backend restarts, served the frontend SPA from the Go backend, and made history-only fallback rows read-only so stale alarms cannot send ACK/Return to core. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; WSL CMake/Ninja core build pass; `ctest --test-dir build/services` 300/300 pass.

### Changed - Local secret and backend artifact ignores (2026-07-06)
- repo: ignored `RUN_PROJECT.md`, frontend `.env` files, and local `web/backend/mkddc-web-*` binaries so secrets and deploy artifacts stay out of commits. Verification: `git status --short --untracked-files=all` excluded those local files from the staged set.

### Added - Alarm history log and ack count refresh (2026-07-03)
- web/fe(alarms): added persistent JSONL alarm history at `/api/v1/alarm-history` for start/ack/end and alarm-setting create/change/delete records, background-polled core alarm snapshots, changed sidebar/topbar badges to count only `active`/`unack`, and refreshed the badge immediately after ACK. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `go vet ./...` pass; `npm run build` pass; `npm run lint` pass; Chrome headless UI smoke pass (`2 -> 1` badge after ACK, history panel visible).
- deploy(orange-pi): fixed `/data/config/alarm_history.jsonl` ownership/permissions and installed `mkddc-web-pi.service` to run the web backend as `mkddc`, preventing alarm history read permission errors after restart. Verification: Orange Pi `mkddc-web-pi`/core/iobus/ssh active; `/api/v1/alarm-history?limit=5` returned 5 records; `/api/v1/alarms` returned 2 active alarms.

### Fixed - Web alarm settings config path (2026-07-03)
- web/backend(alarm-settings): made the default alarm settings file match the core runtime path `/data/config/alarm_settings.conf`, while keeping `ALARM_SETTINGS_CONF` as an explicit override, and writes alarm settings group-readable/writable for the `mkddc` service group. This keeps `/eng/alarm-settings` populated when `CONFIG_DIR` points at a web runtime directory. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; ARM64 build pass; Orange Pi `mkddc-web-pi` restarted and `/api/v1/alarm-settings` smoke returned 2 configured alarms.

### Fixed - C++ CI alarm runtime portability (2026-07-03)
- services/core(test): replaced fixed-buffer alarm point ID formatting with string composition to avoid GCC 11 `-Wformat-truncation` under CI, and yielded the concurrent iobus-reader test writer so the seqlock test reliably observes valid snapshots. Verification: WSL `cmake --build build/codex-services-sync -j2` pass; WSL `ctest --test-dir build/codex-services-sync --output-on-failure` 301/301 pass.

### Fixed - SHM v4 iobus layout guard after main merge (2026-07-03)
- services/iobus(test): aligned `test_io_cache` layout asserts with SHM v4 `ui_reliability[]` placement, so `ui_unit` offset `176` and `ui_raw_unit` offset `304` match the shared contract and web reader offsets after merging latest `main`. Verification: WSL `cmake --build build/codex-services-sync -j2` pass; WSL `ctest --test-dir build/codex-services-sync --output-on-failure` 301/301 pass.

### Changed - ALARM-3b trigger threshold visibility (2026-07-03)
- core/web/fe(alarm): carried the tripped threshold bucket (`HH`/`H`/`L`/`LL`/`RUNTIME`) from core alarm evaluation through web_ipc and the Go alarm DTO, then surfaced it as a visible alarm-row trip badge with threshold detail. Verification: full services WSL `ctest` 290/290 pass; `go build ./...` pass; `go test -count=1 ./...` pass; `npm run build` pass; `npm run lint` pass; Chrome UI smoke against Orange Pi live API pass.

### Changed - ALARM-3b live alarm ack closure (2026-07-02)
- docs/web/fe(alarm): aligned public AlarmEvent schema with the backend AlarmDTO, surfaced normalized alarm values in the live alarm row, and added handler regressions for alarm list degrade, ack success/refetch, unknown ack, RBAC, and empty IDs. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `go vet ./...` pass; `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Changed - ALARM-01B frontend alarm entity settings (2026-07-02)
- fe(alarm-settings): replaced the demo per-point alarm settings page with ADR-013 alarm entities backed by `/api/v1/alarm-settings`, including add/remove alarms, multi-source source rows, active-type validation, BACnet publish caps, and demo data updated to the entity model. Verification: `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Changed - ALARM-01B backend alarm entity model (2026-07-02)
- web/backend(alarm-settings): replaced legacy per-point alarm settings with ADR-013 alarm entities, added validation caps/type/source/params checks, and added safe legacy JSON migration on load without rewriting files. Verification: `go build ./...` pass; `go test -count=1 ./...` pass; `go vet ./...` pass; `git diff --check` pass.

### Fixed - Orange Pi demo DO live toggle data (2026-07-02)
- tools/fe/deploy: added a small Orange Pi demo graph that drives DO-01..DO-04 from UI-12/UI-13 dry-contact states, and made frontend demo DO points follow the same changing logic instead of staying static. Verification: Orange Pi SHM dump shows DO command/feedback changing together; `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Fixed - Orange Pi fake MCU live UI/AO sample data (2026-07-02)
- tools/fe/deploy: corrected fake MCU raw simulation and Orange Pi IO config so UI-09..UI-15 produce plausible GOOD values instead of configuration-error `0.0`, added ppm unit mapping for CO2, and seeded AO demo setpoints through the live core socket. Verification: Orange Pi `mkddc-fakemcu --self-test` pass; SHM dump shows UI-09..UI-15 GOOD and AO setpoints nonzero; `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Fixed - Inputs UI live chart real samples (2026-07-02)
- fe(inputs): removed seeded UI live chart history from stored point trends so the Inputs page chart starts empty and only plots fresh `/points` samples. Verification: `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Changed - Outputs DO real-only controls (2026-07-01)
- fe(outputs): simplified DO output configuration to real wired controls only (safe state and manual force), removing EasySet-only demo rows without backend/core/iobus hooks. Verification: `npm run build` pass; `npm run lint` pass; `git diff --check` pass.

### Fixed - ADR-011/012 BACnet alignment integration review (2026-07-01)
- shm/consumers: restored the v3 `ui_raw[]`/`ui_raw_unit[][]` fields alongside `ui_reliability[]`, bumped the combined SHM contract to `0x4B584404` (v4), and synchronized web offsets/size; this prevents stale-layout web reads and restores `shm_dump_io` compilation.
- iobus/reliability: preserved ADS131M08 divider/shunt scaling and per-channel calibration on the runtime reliability path; transient poll failures now publish `UNRELIABLE_OTHER`, IOP/ADC failures publish `COMMUNICATION_FAILURE`, and raw live values remain published.
- BACnet/AO: corrected AI V/mA Units to BACnet 5/2, Pa to 53, and the documented CONFIGURATION_ERROR enum to 10; kept AO Object_Name storage alive for bacnet-stack, made directed Who-Is return unicast I-Am, refreshed engineering conversion on metadata-only reloads, and validated AO name/units/min/max in both iobus and web config paths.
- hmi/build: checked GPIO/backlight sysfs writes and proc/sysfs reads so the SHM v4 consumer build remains clean under fortified GCC `-Werror`.
- Verification: clean `MKDDC_ENABLE_BACNET=ON` build including `mkddc-iobus`/`shm_dump_io`; iobus CTest 159/159; core CTest 123/123; HMI CTest 23/23; `go test ./...` pass; frontend build/lint pass; real UDP/47808 local BTL smoke 14/14 (Who-Is/I-Am, reads, AV/AO writes, AO property readback/relinquish), with AO1 50% confirmed as DAC raw 32768 through fake MCU.

### Changed - Outputs AO real-only controls (2026-07-01)
- fe(outputs): restricted AO wizard/advanced/summary to wired signal type, physical safe value, and integer 0..100 manual command; removed AO EasySet demo rows/badges from the page. Min/Max stays out of Outputs because the only current source is graph `AO_Output.limit_lo`/`limit_hi`, not IO config. Verification: `npm run build` pass; `npm run lint` pass.

### Changed - Controller Diagram terminal layout (2026-07-01)
- fe(diagram): swapped AO/DO terminals to the top and UI terminals to the bottom, aligned the I/O Summary CPU/Memory/Temp dials on one row, and removed detailed RAM MB text from the Memory dial. Verification: `npm run build` pass; `npm run lint` pass; Chrome headless smoke at `http://127.0.0.1:5175/` confirmed AO/DO render before UI and no RAM MB detail remains in the SVG.

### Changed - Controller Diagram navigation entry (2026-07-01)
- fe(nav): hid the Engineering sidebar `Controller Diagram` entry while keeping `/eng/diagram` available from the dashboard `Open` button. Verification: `npm run build` pass; `npm run lint` pass; Chrome headless smoke at `http://127.0.0.1:5175/` confirmed the sidebar link is hidden and the dashboard `Open` button still routes to `/eng/diagram`.

### Changed - Dashboard CPU and IOP metrics cards (2026-07-01)
- web/fe(dashboard): removed CPU/RAM tiles from IOP / Scan Metrics, added exact CPU percent plus optional CPU clock detail under CPU Load, and exposed Linux cpufreq as `cpu_clock_mhz`/`cpuClockMhz` when available. Verification: `npm run build` pass; `npm run lint` pass; `go test -count=1 ./...` pass in `web/backend`; Chrome headless smoke at `http://127.0.0.1:5175/` confirmed IOP metrics only show Overall/IOP latency and CPU Load shows exact percent plus clock detail when available.

### Changed - FE dashboard controller diagram layout (2026-07-01)
- fe(dashboard): replaced the I/O overview card with the reusable Controller Diagram, tightened dashboard grids/padding, and reused the same diagram component on the engineering diagram page. Verification: `npm run build` pass; `npm run lint` pass; Chrome headless smoke at `http://127.0.0.1:5175/` confirmed dashboard renders `Controller Diagram` SVG.

### Fixed - SHM v4 raw/reliability contract reconciliation (2026-07-01)
- shared/iobus/core/web: reconciled UI raw live-data fields with `ui_reliability[]`, bumped `KX_SHM_MAGIC` to `0x4B584404`, updated Go SHM offsets from `offsetof`, and added layout/status regressions. Verification: `go test -count=1 ./...` pass in `web/backend`; C++ CMake not run locally because Windows PATH lacks `cmake` and WSL lacks `cmake`/`g++`.

### Changed — Hardware documentation closure and ADR-010 baseline reconciliation (2026-06-30)
- Reconciled canonical product, Rev A scope, HW/PRD/SRS/DS, firmware/software design, implementation, HMI, manuals and certification-prep documents to **16 UI + 4 AO + 4 DO**, no base-SKU industrial DI, and IOP v2 **2ms/500Hz**.
- Marked the IOP v1 interface/freeze documents superseded; current authority is ADR-010 plus `shared/iop_protocol.h`.
- Removed unsupported power, EMC, thermal and manufacturing release claims; evidence gates remain RED in `hardware-design/hw_design_review/HW_DOC_REVIEW_CLOSURE_PLAN.md`.
- Expanded the deterministic hardware-doc harness to catch stale 10ms timing and 8 UI + 8 DI baseline regressions.

### Fixed - UI Inputs signal type 2 current variant (2026-06-30)
- fe(inputs): added a type-2-only Volt/Current selector so `2-10V` and `4-20mA` round-trip without forcing current channels back to voltage; Summary now shows separate `Raw (V)` and `Raw (mA)` cells and hides raw cells for dry-contact booleans. Verification: `npm run build` pass; `npm run lint` pass.

### Changed - UI hardware scaling reconciliation (2026-06-30)
- docs/iobus: aligned UI current shunt documentation to 49.9Ω and documented ADS131M08-based transfer formulas plus per-channel two-point calibration hook.
- iobus: recalibrated UI raw/engineering scaling for ADS131M08 VREF=2.44V, 100k/12.1k voltage divider, and 49.9Ω current shunt; AO scaling, SHM layout, IOP contract, and FE files are unchanged in this scope. Verification: Orange Pi `cmake --build` pass, full `ctest` 148/148 with 2 IoCache skips due live SHM, `ctest -R IoScaling` 19/19 pass.

### Added - UI Inputs raw live data pipeline (2026-06-30)
- docs/contract: accepted ADR-011, extended `kx_io_shm_t` with `ui_raw[]` + `ui_raw_unit[][]`, and bumped `KX_SHM_MAGIC` `0x4B584402` → `0x4B584403`; deploy requires rebuilding iobus/core/web together.
- iobus/tools: `mkddc-iobus` now computes raw electrical V/mA from IOP ADC samples, writes `ui_raw[]`/`ui_raw_unit[][]`, and `shm_dump_io` includes raw values.
- web/fe: `/points` exposes `raw`/`rawUnit`; Inputs Summary shows Raw for analog channels and treats dry-contact channels as ON/OFF without raw/min/max/avg numeric stats.

### Fixed - UI input config save deployment (2026-06-29)
- deploy(web): rebuilt and restarted Orange Pi `mkddc-web-pi` with the 16-channel UI config validator so `/system/config/io` accepts `ui[].ch` values `1..16`; smoke verified `ch=16` no longer returns the old `1..8` range error.

### Fixed - Fake MCU trend waveform cadence (2026-06-29)
- tools(fake_mcu): slowed simulated UI wave periods so the 10s backend historian no longer aliases 0-10V/4-20mA inputs into dense sawtooth trend charts.

### Fixed - Live point demo metadata fallback (2026-06-29)
- fe(points): live REST/WS point updates now reuse original demo names, units, sensor types, and trend buffers when backend points only carry generic IDs like `UI-01`/`DO-01`.
- fe(realtime): merging live point updates now preserves existing metadata instead of replacing the whole point object. Verification: `npm run build` pass.

### Fixed - Fake MCU binary cadence regression (2026-06-29)
- tools(fake_mcu): restored UI13/UI14 dry-contact toggle cadence to the original visible cycle; DO feedback remains command-driven by core `SET_DO`. Verification: built on Orange Pi, installed `/usr/local/bin/mkddc-fakemcu`, restarted `mkddc-fakemcu` + `mkddc-iobus`, and smoke verified `/points` UI13/UI14 toggling.

### Changed - Fake MCU simulation values restored (2026-06-29)
- tools(fake_mcu): restored original fake MCU waveform constants so code fixes no longer alter the baseline simulated data. Verification: rebuilt/reinstalled on Orange Pi and smoke verified `/points` UI13/UI14 still toggles.

### Fixed - EasySet UI u0-u7 FE/BE/FW sync (2026-06-29)
- fe(inputs): removed unused `u8`/`u9` wizard and advanced registers; `u0..u7` remain visible and saved.
- fe/backend: AI input save payload now preserves `scale_lo`, `scale_hi`, `range_mult`, `unit`, `filter_samples`, `sensor_cal`, and `math_func`; backend accepts UI channels `1..16`.
- fw(iobus): `mkddc-iobus` now reads web `io_config.conf`, consumes EasySet UI `u0..u7`, applies range scaling, moving average filter, sensor calibration, dry-contact invert, and math average/min/max before writing SHM/BACnet units.
- docs/deploy: updated `io_config.conf` schema note and systemd `mkddc-iobus` config path. Verification: `go test ./...` pass; `npm run build` pass; modified C++ config/scaling sources compile with `g++ -Werror`; full CMake unavailable in local PATH/WSL.

### Fixed - Trend chart time-axis rendering (2026-06-29)
- fe(trends): fixed distorted trend rendering by preserving numeric timestamps from `/history`, sorting/deduping samples by time, appending only live samples newer than the latest historian point, and drawing linear chart segments instead of smoothed monotone curves.

### Fixed - Live historian, realtime points, and UI config sync (2026-06-29)
- web: fixed `/points` on Orange Pi by decoding SHM v2 magic `0x4B584402` and the 16-UI layout; `/points` now returns 16 UI, 4 AO, 4 DO plus virtual BACnet points.
- web: enabled persistent trend history from backend runtime via SQLite `TrendStore`; default historian cadence is 10s with 8640 records per point (about 24h).
- web: normalized point IDs to FE-facing `UI-01..UI-16`, `AO-01`, `DO-01`; `/history` still reads older `AI1`/`AI-01`/`DI1`/`AO1` rows through aliases and returns canonical keys.
- fe(trends): chart now merges backend `/history` with the live 1s display tail, so refresh/logout no longer resets visible trend history to the browser session.
- fe(points): normalized legacy point IDs from REST/WS/history and kept selected trend preferences in local storage.
- fe(monitoring): added double-click point details modal with editable point name/unit, unit dropdown, force output/release flow, and local fallback for unsupported point config endpoint.
- deploy: rebuilt and restarted `mkddc-web-pi` on Orange Pi `192.168.1.18:8081`; smoke verified `/points`, `/history`, core, and IOP.

### Changed - Agent workflow rule (2026-06-29)
- Added root `AGENTS.md` rule: every code, config, deployment, or documentation change must update `CHANGELOG.md` in the same work session unless explicitly told not to.

### Added — ADR-010 EasySet Parity Config Surfaces
- fe(outputs): thêm `/eng/outputs` cho 4 AO + 4 DO, Summary/Wizard/Advanced; wire AO mode, AO/DO safe-state, manual force; field graph-level demo-local.
- web: io config validate chấp nhận đủ AI signal type (`none`/`potentiometer`/`light`/`pulse`) + `filter_samples`/`sensor_cal`/`math_func`.
- web: io config `ui[]` chấp nhận field `note` (ghi chú per-AI).
- fe(AI inputs): full register u0-u9 + Signal Type 0-8 đúng EasySet, Range Multiplier/Math Function/Units full labels.
- fe(AI inputs): wizard dùng dropdown + nhảy bước, fix nút Hoàn tất, popup OK/Cancel khi lưu → chuyển Advanced.
- fe(AI inputs): Advanced luôn hiển thị đủ u0-u9 và Wizard đi đủ bước trước khi Hoàn tất.
- fe(AI inputs): Wizard bỏ cụm lựa chọn dạng card/trắc nghiệm; nhảy bước bằng dropdown gọn.
- fe(AI inputs): Wizard đủ tab u0-u9 để chuyển nhanh từng thanh ghi đã cấu hình.
- fe(AI inputs): thêm tab Summary (Live Data + Reset, biểu đồ live, Notes riêng từng AI).
- fe(AI inputs): Summary nhận live point `AI1`/`AI-01`, ưu tiên dữ liệu OrangePi và chỉ fallback demo khi thiếu live.
- fe: thêm trang User Parameters (mock demo-only kiểu EasySet, chưa nối backend).
- Added Alarm Wizard/Advanced parity.
- Added AI/DI Inputs configuration surface.
- Added Controller Diagram read-only commissioning view.
- Added Auxiliary Functions node-compose wizard.
- Kept backend REST/WS unchanged under Rev A demo-local scope.

### Fixed — FE i18n VI dấu + English mode thật (2026-06-17)
- Chuẩn hóa text tiếng Việt có dấu trên shell và 12 trang frontend ADR-009; bỏ các chuỗi không dấu kiểu `Binh thuong`, `Da luu`, `Mat khau`.
- Bổ sung helper i18n để các nhãn/nút/toast chính đổi theo VI/EN; không đổi REST/WebSocket contract.
### Fixed — FE Monitor binary ON/OFF colors (2026-06-17)
- Monitor I/O hiển thị ON/active bằng xanh lá (`--c-good`/`--c-good-fg`) và OFF/inactive bằng xám (`--c-off`); không tô đỏ trạng thái nhị phân chỉ vì DI-01 đang ON.
- Không đổi REST/WebSocket contract.
### Changed — FE áp bộ màu Level B hybrid (vàng-làm-nền/warn-fg, green normal, gray off, trend amber) (2026-06-16)
- Thêm token `--c-good-fg`/`--c-off`/`--c-warn-fg`/`--c-fault-fg`; tách `statusColor()` cho chữ/đường và `statusFill()` cho dot/nền/arc.
- Dashboard/StatusBadge/Gauge/TrendChart/Trends dùng green normal, gray off, amber sẫm cho trend/cảnh báo và không còn chữ vàng mảnh khó đọc; không đổi REST/WebSocket contract.
### Changed — ADR-009 amend Level A→B + UX-SYSTEM bộ màu trạng thái SCADA (2026-06-16)
- ADR-009 giữ Accepted nhưng chuyển triết lý màu từ Level A pure sang Level B hybrid: nền xám sáng + nav 3 nhóm, normal/online dùng xanh SCADA.
- UX-SYSTEM cập nhật token trạng thái `--good`/`--off`/`--warn`/`--alarm`/`--critical`/`--force` và `*-fg` cho chữ/đường trên nền sáng; không đổi code hoặc REST/WebSocket contract.

### Changed — FE sticky top status bar/NavRail (2026-06-16)
- `TopBar` cố định khi cuộn; reconnect banner bám dưới top bar để trạng thái kết nối luôn thấy.
- `NavRail` cố định bên trái với vùng nav tự cuộn; không đổi REST/WebSocket contract.

### Changed — Dashboard dynamic metrics normal xanh, warn/fault theo ngưỡng (2026-06-16)
- Online/OK/uptime/metric trong ngưỡng bình thường dùng xanh lá; CPU/RAM/nhiệt/scan vượt ngưỡng chuyển cam hoặc đỏ theo chuẩn owner adjustment ISA-101.
- Cập nhật ADR-009/UX-SYSTEM/08_WEB/10_TASK_CHECKLIST; không đổi REST/WebSocket contract.

### Changed — FE indicator dot OK/ONLINE xanh, OFF xám (2026-06-16)
- Bổ sung token --c-indicator-ok/--c-indicator-off; chấm/icon nhỏ OK/ONLINE/ON/GOOD dùng xanh lá, OFF/OFFLINE/unknown dùng xám; fault/warn/force giữ màu cảnh báo.
- Cập nhật ADR-009/UX-SYSTEM/08_WEB ghi ngoại lệ compact indicator; không đổi REST/WebSocket contract.

### Changed/Added — FE hoàn tất tái cấu trúc ISA-101 (P3/3) (2026-06-16)
- Thay stub P2 bằng trang thật `/me`, `/settings/display`, `/settings/time`, `/eng/alarm-settings`; nâng `/settings/device`, gộp `/health` vào Dashboard và bỏ route riêng.
- Đổi `/eng/programming` sang ProgrammingPage với thư viện component + `graph.json` validate/deploy demo; dọn nền tối còn sót theo token Level A, không đổi REST/WebSocket contract.

### Changed — FE điều hướng 3 nhóm + routing mới (P2/3) (2026-06-16)
- NavRail gom 3 nhóm Overview/Settings/Engineering theo ADR-009, có thu gọn và active state trung tính.
- Routing frontend chuyển sang path mới, thêm stub P3 và redirect path cũ; không đổi REST/WebSocket contract.

### Changed — FE áp design tokens ISA-101 Level A (P1/3) (2026-06-16)
- Frontend đổi `--c-*` sang Level A nền xám sáng, bỏ dark/cyan glow và chuyển `color-scheme: light`.
- `statusColor`/`StatusBadge` áp normal trung tính + warn/fault/force/critical đúng chuẩn; badge luôn có icon+chữ, không đổi REST/WebSocket contract.

### Changed — UX-SYSTEM áp ISA-101 Level A + ADR-009 Accepted (2026-06-16)
- ADR-009 chuyển `Accepted` theo owner duyệt ngày 2026-06-16.
- UX-SYSTEM cập nhật tokens Level A nền xám sáng, nguyên tắc HMI high-performance và phân cấp điều hướng 3 nhóm Overview/Settings/Engineering.

### Added — ADR-009 (2026-06-16): áp ISA-101 Level A + tái cấu trúc IA 3 nhóm web UI (Status: Accepted)
- Thêm `docs/adr/ADR-009-isa101-hmi-and-nav-restructure.md` để ghi quyết định về high-performance HMI Level A, điều hướng 3 nhóm Overview/Settings/Engineering, tách Alarm log/Alarm settings, gộp System Health vào Dashboard và đổi Validator thành Programming. Không đổi code, UX-SYSTEM hay REST/WebSocket contract.

### Changed — Docs sync theo 4 trang frontend (2026-06-16)
- **`08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md`** (Rev 1.1 → 1.2): cập nhật danh sách trang frontend Rev A thực tế (§1, 12 trang) + ghi chú trạng thái demo 4 trang Trends/Scheduler/Network/Validator khớp spec; làm rõ **KHÔNG** đổi REST/WebSocket contract §2.
- **`KX-DDC24-FE-DEVGUIDE-001_VI.md`** (Rev 1.0 → 1.1): thêm block "Trạng thái triển khai Rev A (2026-06-16)" + trỏ chéo 08_WEB/CHANGELOG; thêm dòng Revision History.

### Changed — Frontend Rev A: chỉnh 4 trang theo spec (2026-06-16, demo UI client-side)
- **Trends:** thêm filter object-list (chọn điểm AI/AO) + time-range 30m/1h/6h/24h; biểu đồ + bảng thống kê (current/avg/min/max) cập nhật động; bỏ các nút tĩnh không hoạt động. `getTrendSamples(pointIds, rangeMinutes)` sinh dữ liệu theo lựa chọn. Phản ánh mô hình BACnet Trend Log do kỹ sư cấu hình (SRS IDE-024/025).
- **Scheduler:** bỏ chế độ "Tháng" (không có trong spec); chuyển sang template **BACnet Weekly_Schedule** 7 ngày (CN–T7) tự lặp hằng tuần; sửa ô lịch qua modal (state local, demo); thêm placeholder khu Exception_Schedule/holiday. Khớp PRD FR-004 / DS "ngày/tuần/exception".
- **Network:** bỏ mô hình cây "controller quản lý DDC con" (sai kiến trúc). Dựng lại theo ARCH-R010: **Northbound** BACnet/IP server lên BMS (IP/DHCP/WiFi/Device ID/port + trạng thái BMS link) + **Southbound** Modbus RTU master với bảng slave (addr/profile/baud/poll-state/error-rate). Các DDC-24 là peer độc lập, không quản lý lẫn nhau.
- **Validator:** thay textarea JSON ad-hoc bằng kiểm tra `graph.json` có cấu trúc theo GRAPH_SCHEMA với **4 check Rev A** (input chưa nối · output nhiều nguồn ghi · AO thiếu limit · Modbus/sensor thiếu fallback); list lỗi theo severity; nút Deploy (demo) chỉ bật khi pass. Không IEC 61131-3 (theo ADR-004 → Rev C).

### Added — Frontend Rev A: types + simulator cho 4 trang (2026-06-16)
- Thêm types graph (`Graph`/`GraphNode`/`GraphLink`/`io_map`/`GraphValidationResult`) và network (`NetworkConfig`/`ModbusSlave`/`NetworkData`/`PollState`) trong `src/frontend/src/types.ts`.
- Cập nhật `src/frontend/src/demo/simulator.ts`: `validateGraphLocal()` parse graph + 4 check; `getDemoNetwork()` trả north/southbound; `getDemoSchedule()` dùng nhãn tuần chung (CN–T7); `getTrendSamples()` nhận `(pointIds, rangeMinutes)`.
- Phạm vi: chỉ UI + simulator client-side — **KHÔNG** đổi REST/WebSocket contract, không nối backend. Verification: code đã soát khớp 4 mục tiêu; cần chạy `npm run typecheck`/`npm run build` local để xác nhận xanh.

### Added — Frontend Rev A demo/live UI (2026-06-16)
- Thêm `src/frontend/` React 18 + TypeScript strict + Vite 5 + Tailwind CSS v4 cho web cấu hình local MK-DDC-24.
- Hoàn thiện app shell industrial dark theo mockup `viduUI/`: Login, Dashboard, Monitor I/O, Alarms, Trends, Scheduler, Network, Users, Settings, System Health, Commissioning, Validator.
- Tích hợp contract REST `/api/v1` và WebSocket `/ws/v1/events`; có demo mode chạy không cần board và live mode qua `VITE_DDC_MODE=live` / `VITE_PROXY_TARGET`.
- Thêm auth abstraction mock/JWT/X-API-Key, lưu token in-memory; không dùng localStorage/sessionStorage.
- Thêm simulator 24 I/O realtime, health, alarm, trend, schedule, network và user data để kiểm thử UI Rev A.
- Verification: `npm run build` pass; `npm audit --omit=dev` sạch. Dev audit còn advisory Vite 5/esbuild, không force-upgrade vì stack Rev A đang khóa Vite 5.

### Fixed — Audit code↔docs (2026-06-15): reconcile 3 frozen specs theo kinexus→mkddc rename
- **`SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md` (HIGH):**
  - §8 Startup Sequence bước 1: `kinexus-io-driver.service start` → `mkddc-iobus.service start`
  - §9.1 IOP-SW-001: `kinexus-io-driver` → `mkddc-iobus` (C++17)
  - §9.1 IOP-SW-004: `/kinexus/io_data` → `/dev/shm/mkddc_io_shm`
    (format `kx_io_shm_t` trong `shared/mkddc_shm.h`)
  - Bump rev 1.1 → 1.2 · thêm Revision History
  - Lưu ý: tên giao thức "Kinexus-IOP v1.1" được canonical chấp nhận (xref ADR-0008)
    — chỉ đổi tên service + SHM path. Header files trong `shared/` vẫn là nguồn-chuẩn.
- **`SW_REQUIREMENTS_MK-DDC-24_VI.md` (HIGH):**
  - §2.2 wrap inline struct cũ `kinexus_io_shm_t` trong `<details>` để tránh nhầm với
    struct thật `kx_io_shm_t` trong `shared/mkddc_shm.h`. Bump rev 1.0 → 1.1-DRAFT
    (note cho SW Lead review).
- **`SW_ARCH_SPEC_MK-DDC-24_VI.md` (HIGH):**
  - Wrap cả §2 (IPC Architecture 7 service `kinexus-*` + path cũ
    `/dev/shm/kinexus_*_shm`) trong `<details>`. Giờ chỉ Rev A 3-process `mkddc-*`
    visible. Kèm link trỏ tới `shared/mkddc_shm.h` + ADR-005.

Không có thay đổi về giá trị thực thi (opcode, payload, CRC, FAULT bit, RESET reason).
Spec chỉ được điều chỉnh để khớp code đã triển khai. Audit report đầy đủ: xem chat
audit 2026-06-15.

### Changed — Doc restructure ISO (2026-06-08, branch `chore/doc-restructure`)
- **Tái cấu trúc thư mục tài liệu về 1 cây** (đóng ISO 9001 §7.5 nonconformity G1/G3):
  root `PRD/SRS/DS/HW_SPEC` + `spec/*` → `docs/01_specs/`; `design/*` → `docs/02_design/`
  (software/firmware/interfaces/_templates). Root chỉ còn `README.md` + `CHANGELOG.md`.
  Di chuyển 45 file bằng `git mv` (giữ history); **tính lại toàn bộ link** (79 file) — broken-link = 0.
- **Master Register cover 100%** (đóng G2): thêm PRODUCT_DEFINITION, REVA_SCOPE, GRAPH_SCHEMA,
  ISOGAP + section ADR-001..007.
- Thêm [QA-ISOGAP-001](docs/00_management/KX-DDC24-QA-ISOGAP-001_VI.md) — gap assessment theo §7.5 + kế hoạch.
### Changed — ⚠ BREAKING (PIVOT-2026-06-08): Component-based DDC + 3-process + Go web
- **Mô hình điều khiển:** chuyển từ **IEC 61131-3 soft-PLC (FBD/ST)** sang **component-based
  graph runtime**. Artifact deploy = `graph.json`. IEC 61131-3 → Rev C. ([ADR-004](docs/adr/ADR-004-component-based-runtime.md))
- **Kiến trúc SOM:** 7 service `kinexus-*` → **3 process `mkddc-*`** (`mkddc-core` C++ real-time,
  `mkddc-iobus` C++, `mkddc-web` Go), chia theo real-time boundary. HMI/agent/OTA/cloud → deferred
  Rev B+. Watchdog = systemd + HW. ([ADR-005](docs/adr/ADR-005-three-process-architecture.md))
- **Web/UI:** backend Python/FastAPI → **Go**; frontend Svelte → **React**; Rev A UI = **form +
  import `graph.json`**, bỏ FBD drag-drop (canvas → Rev B); validator = **Go library** (bỏ Rust
  service). ([ADR-006](docs/adr/ADR-006-rev-a-ui-form-json.md), [ADR-007](docs/adr/ADR-007-web-stack-go.md))
- **Naming:** retire codename `kinexus-*` → brand `mkddc-*` (rename `kinexus_shm.h`→`mkddc_shm.h`
  là task implementation riêng; hợp đồng shm/IOP với MCU giữ nguyên).
### Added — PIVOT-2026-06-08
- **Nguồn-chuẩn mới:** [PRODUCT_DEFINITION](docs/01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md),
  [REVA_SCOPE_ROADMAP](docs/01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) (Rev A.0 + lịch 90 ngày).
- **Thiết kế lõi:** [interfaces/GRAPH_SCHEMA](docs/02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md),
  [software/SW_RUNTIME_EXECUTION_MODEL](docs/02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md),
  [software/SW_COMPONENT_LIBRARY](docs/02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md).
- **ADR-004..007** ghi 4 quyết định pivot.
### Removed — PIVOT-2026-06-08
- **Đã xóa** `design/software/SW_PLC_ENGINE_DESIGN_MK-DDC-24_VI.md`,
  `design/software/SW_WEBIDE_DESIGN_MK-DDC-24_VI.md`,
  `docs/04_uiux/KX-DDC24-UX-WEBIDE-001_VI.md` (nội dung cũ mâu thuẫn; còn trong git history).
  Thay bằng: SW_RUNTIME_EXECUTION_MODEL + SW_COMPONENT_LIBRARY (engine); ADR-006/007 (web Rev A).
  Mọi link trỏ tới 3 file (design/README, GETTING_STARTED, BE/FE-DEVGUIDE, PM-REPO, PM-IMPLPLAN,
  QA-REGISTER, docs/README, UX-SYSTEM, SYS-ARCH, ADR-004/006/007) đã được redirect.
### Changed — RECONCILE PIVOT-2026-06-08
- PRD/SRS/DS/README/SW_ARCH/SW_REQ/SW_DDD/manuals/dev-guides/SYS-ARCH/PM-OVERVIEW/GETTING_STARTED/
  CONFIG_SCHEMA: gắn banner **RECONCILE** + sửa thẳng các câu/bảng mâu thuẫn (61131-3/kinexus-*/FBD/
  Python/Svelte) sang component-graph / `mkddc-*` / Go.

### Changed — ⚠ BREAKING (ARCH-R010, 2026-05-30): Kiến trúc kết nối
- **Northbound (lên BMS/cloud) chỉ qua IP (Ethernet/WiFi):** BACnet/IP + MQTT + REST. **Bỏ BACnet MS/TP. Bỏ Modbus TCP/RTU slave.**
- **Southbound (RS-485) = Modbus RTU MASTER:** DDC poll thiết bị phụ (module mở rộng I/O, màn hình phụ, thiết bị bên thứ 3) theo **device profile** (khung mở). Đảo ngược RTU-006 cũ.
- Tài liệu cập nhật: SRS (§5/§6.2/§6.3, BAC/MB/RTU, E302/E303), SW_REQ §10, PRD (FR-020/024/025, UC-06), DS §1/§3.3, HW_SPEC §9, SW_ARCH; D-2 viết lại (Modbus RTU Master/Expansion v2.0), D-3 (BACnet IP-only), D-5 (fieldbus.conf + WiFi, bỏ mstp/rs485_mode); SW_DDD/SW_AGENT/SW_BACNET/SW_PLC; System Handbook (sơ đồ north/south + expansion); Implementation Plan (T-BE-05/06); Traceability; Register; nftables (bỏ 502).
### Added
- **Developer Kit (`docs/05_implementation/` + `shared/`)** — lớp tài liệu để dev gõ code:
  - Repository, Build & CI (mono-repo layout, build mỗi nghề, CI, git workflow).
  - FW / BE / FE Developer Guide & Backlog: walking skeleton + backlog cỡ ticket (mục tiêu/file/acceptance/test/trace).
  - **Hợp đồng code thật:** `shared/iop_protocol.h` (FW↔BE), `shared/kinexus_shm.h` (shared memory struct).
  - FE: hợp đồng WebSocket realtime (monitor/force).
- **`kinexus-fieldbus`** service + [SW_FIELDBUS_DESIGN](docs/02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md) (Modbus RTU master, device profile engine).
- Decision record **ARCH-R010** trong OPEN_ISSUES.
- **KX-DDC24-SYS-ARCH-001 — System Handbook** ("Hiểu hệ thống từ số 0"): tài liệu giải thích toàn bộ sản phẩm cho người **không chuyên** — kể chuyện, sơ đồ Mermaid, ví von, đi theo chân 1 con số/1 mệnh lệnh xuyên hệ thống, từ điển thuật ngữ, FAQ. Đặt làm điểm bắt đầu số 1 ở mọi cổng (root README, docs/README, Overview).
- `git init` + `.gitignore` + baseline commit lịch sử dự án.

### Đang làm
- Implement code theo [Implementation Plan](docs/00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md) (Phase P1+).
- Cần chốt: DEC-001 (PLC engine), SW-Q-004 (key store), SW-Q-005 (OTA endpoint).

---

## [0.3.0] — 2026-05-30 — "ISO Documentation Baseline"
Bổ sung lớp **quản lý tài liệu theo ISO** + **thiết kế giao diện** + **kế hoạch implement chi tiết**.

### Added
- **Document Hub** `docs/` — cổng điều hướng ISO-aligned ([docs/README](docs/README.md)).
- **KX-DDC24-QA-DOCCTRL-001** — Chuẩn Kiểm soát & Đặt tên tài liệu (ISO 9001 §7.5 / 12207): Document ID scheme, status lifecycle, versioning, cấu trúc thư mục.
- **KX-DDC24-PM-IMPLPLAN-001** — Implementation Plan: phase → task → microtask → checklist input/output cho FW / BE / FE / UI-design.
- **KX-DDC24-PM-OVERVIEW-001** — Project Overview (tổng quan cho người mới).
- **KX-DDC24-QA-REGISTER-001** — Master Document Register (danh mục toàn bộ tài liệu + ID + version + owner).
- **KX-DDC24-QA-TRACE-001** — Traceability Matrix (REQ → design → code → test).
- **UI/UX (04_uiux):** Design System (tokens/components), Web IDE UI/UX (FE), HMI TFT UI.
- **CHANGELOG.md** (file này).

### Changed
- `spec/README` và `design/README` trỏ về `docs/` làm cổng ISO.

---

## [0.2.0] — 2026-05-30 — "Detailed Design Dossier (SW/FW)"
Tạo bộ hồ sơ thiết kế chi tiết để team FW/SW vào code.

### Added
- `design/` — 27 tài liệu thiết kế (~2.150 dòng), gồm:
  - **DP-0 Foundation:** FW_DDD, SW_DDD, FW/SW Coding Standard, D-1 Pinout Master, D-2 Modbus Register Map, template DDD, GETTING_STARTED_DEV.
  - **DP-1 Interfaces:** D-3 BACnet PICS/EPICS, D-4 REST OpenAPI (+`openapi.yaml`), D-5 Config JSON Schema, D-7 OTA (SOM+MCU).
  - **DP-2 Module/Service:** D-6 PLC Engine, D-11 Security/Key-store, 4 FW module designs (iop_comm, io_sample, ao_do, diag_wdg), 5 SW service designs (io-driver, bacnet, agent, webide, hmi).
- `spec/DESIGN_PLAN_SWFW` — kế hoạch thiết kế (tiêu chuẩn, deliverable, gate DR-1..DR-4).
- `spec/README` — cổng đọc cho dev: thứ tự đọc theo vai trò, bản đồ tài liệu, glossary, bảng nguồn-chuẩn.

### Changed
- Thêm banner "📘 Đọc cùng" + trạng thái đồng bộ vào 7 file spec.

### Fixed
- Đồng bộ các điểm từng mâu thuẫn (P0/P1/P2) qua Design-Readiness Review:
  - Kiến trúc ADC: chốt **MCU đọc ADS131M08 (SPI3)**, CM3 không nối ADC.
  - Modbus format: chốt **INT16 ×100, 1 register/điểm**.
  - Chọn MCU **STM32G0B1RBT6** (3×SPI, 2×DMA) thay vì G071.
  - Pinout MCU thống nhất một nguồn-chuẩn (`MCU_STM32G0_SPEC §3`).

### Security
- Sửa chính sách port: **MQTT 1883 plaintext chặn mặc định**, chỉ 8883 TLS.

---

## [0.1.0] — 2026-05-28 — "Requirements & Architecture Baseline"
### Added
- Tài liệu yêu cầu: PRD, SRS, DS (datasheet, Modbus map §4.1), HW_SPEC.
- Tài liệu kiến trúc & yêu cầu chi tiết: SW_ARCH, FW_ARCH, SW_REQUIREMENTS, FW_REQUIREMENTS, SWFW_INTERFACE_SPEC (IOP), TEST_SPEC.
- OPEN_ISSUES (decision log), DESIGN_READINESS_REVIEW.
- `hardware-design/` — SOM (Radxa CM3), carrier board, I/O subsystem (DI/DO/UI/AO), power, MCU/IO, BOM, EMC/thermal.

---

## Quy tắc cập nhật changelog
- Mỗi PR có thay đổi đáng kể → thêm dòng vào `[Unreleased]`.
- Khi phát hành → đổi `[Unreleased]` thành `[X.Y.Z] — YYYY-MM-DD — "tên"`.
- Tham chiếu Document ID / REQ ID khi liên quan.
