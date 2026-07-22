# Historian board cutover - 2026-07-21

Status: **production activation GREEN for the bounded historian cutover; release remains open**.

## Board and release artifacts

- Target: Orange Pi 5B, `aarch64`, kernel `6.1.43-rockchip-rk3588`.
- Maintenance window: `historian-cutover-20260721T082943Z`.
- Final backend after the restart-gap and atomic-owner fixes: ARM64 SHA-256 `dcd171d35bfb3ccfedf4087726b0d1fe11b18b0ece90f1a7b7ce405cc8ffa52a`, size `16,880,280` bytes.
- Previous deployed forward-compatible backend is retained in the cutover evidence directory with SHA-256 `440aae2b3377e3fa65373663d59aecc5abfaf1fd28aa3cc4eb51bfee0835a39c`.
- Final ARM64 package manifest SHA-256: `47cbfcb0b6fea44aff4ede381f9608ea95157311260a0df483a8180189b81f88`.

## Migration and authority

- Emergency coherent backups were created before mutation; legacy and historian snapshots were `quick_check=ok` and their hashes are recorded in the companion JSON evidence.
- Final source coverage: `596,284` legacy rows, `596,284` accepted, `0` rejected, `0` migration gaps; final native backup `quick_check=ok`.
- Historian database is schema `5`; migration run is `verified`; quiesce epoch `1` is `consumed`; activation is `active`, writer/query authority is `v2`, `legacyWriterAllowed=false`, and `prune_enabled=false`.
- `historian-rollback-verify` on the live database returned `schemaVersion=5`, `quickCheck=ok`, `state=active`, `writerV2=true`, `queryV2=true`, `legacyWriterAllowed=false`, `evidenceBound=true`.
- Legacy `samples` row count stayed constant during post-cutover checks; v2 hot rows advanced (`+2` and later `+4` in 20-second windows).

## Gap evidence and restart check

- The original maintenance pause exceeded the 30-second target. A read-only keyspace check found no hot rows in the missing windows, then an immutable checkpoint was taken and two explicit `restart` gaps were recorded:
  - `AO-01` generation `1`: `[1784622795000,1784623560000)` UTC milliseconds.
  - `UI-01` generation `1`: `[1784622785000,1784623545000)` UTC milliseconds.
- The final binary was restarted with a controlled outage of at least 20 seconds. Runtime startup produced two `scheduler_restart_no_backfill` gaps, proving the first active scheduler cycle now prepares restart gaps instead of silently starting a new frontier.
- The gap ranges and checkpoint hash are in [board-gap-reconciliation-2026-07-21.json](board-gap-reconciliation-2026-07-21.json).

## Runtime smoke

- `mkddc-web-pi`, `mkddc-core`, and `mkddc-iobus` remained active; web `NRestarts=0` after the final rollout.
- `/login` returned `200`; unauthenticated `/api/v1/system/status` returned `401`.
- Authenticated `/api/v1/trends/config` returned `200`. An aligned explicit `[from,to)` `/api/v1/history` query returned `200`, `complete=true`, `effectiveResolution=15s`, six samples, and zero gaps.
- The final rollback verifier remained evidence-bound after the controlled restart. No legacy TrendStore writes resumed.
- Residual runtime source health is not GREEN: a five-minute sample recorded 19 UI and 15 AO hot buckets plus 15 UI/5 AO `snapshot/read_failed` gaps (75 seconds missing for each identity). The web journal also reports recurring `alarms_read degraded err=core unavailable` while `mkddc-core` remains active. The historian preserves this loss as gaps, but the core IPC/runtime-source issue blocks full E2E and long-soak acceptance.

## Follow-up conflict recovery - 2026-07-22

- A wall-clock discontinuity left a divergent UI-01 aggregate in RAM behind the already durable frontier. Immutable `InsertHotBatch` correctly rejected it, but the scheduler retried the poison row indefinitely, stalled all newer hot batches and emitted `pending_hot_overflow` gaps.
- The scheduler now drops late RAM aggregates at or behind the per-identity durable frontier before batching. SQLite rows remain immutable and no historical backfill occurs. A production-shaped regression failed with the observed conflict before the fix and passes with the durable row preserved and the newer frontier committed.
- Window `historian-conflictfix-20260722T023931Z` captured an online SQLite checkpoint, current binary/config copies and hashes before rollout. ARM64 legacy/active schema-v5 package parity passed with eight immutable artifact families; isolated canary advanced AO-01/UI-01 frontiers without a hot-sample conflict.
- Web rollout took about eight seconds and deployed SHA-256 `8d756f593eda7978072673b911c37a984956537c245078cc73348192b2b9136e`, size `16,881,392` bytes. Automatic restart gaps cover the stalled interval. A post-rollout 30-second sample had `hotDelta=+4`, `gapDelta=0`, `legacyDelta=0`; authenticated unified history returned `200`, `complete=true`, three samples and zero gaps.
- Post-rollout services remained active with zero restarts; rollback verification stayed evidence-bound; no `hot sample conflict`, `pending_hot_overflow`, `alarms_read degraded`, `core unavailable`, or `SQLITE_BUSY` appeared in the bounded journal window. Core WSL tests pass `212/212`, including client-slot reclamation, half-close and per-scan budget regressions. Long-soak source stability remains an open release gate.
- Evidence: [board-conflictfix-predeploy-2026-07-22.json](board-conflictfix-predeploy-2026-07-22.json), [historian-rollback-package-arm64-conflictfix-2026-07-22.json](historian-rollback-package-arm64-conflictfix-2026-07-22.json), and [board-conflictfix-postdeploy-2026-07-22.json](board-conflictfix-postdeploy-2026-07-22.json).

## Gates still open

- Physical power-cut/fault testing, browser/manual accessibility, 48-hour hot/archive boundary acceptance, full UI/AO/DO/VP E2E, target eMMC write amplification/endurance, and long-duration historian soak are not claimed GREEN.
- Production prune remains disabled. Legacy files, range adapter, and sampler code remain in place until those rollout gates are GREEN.
