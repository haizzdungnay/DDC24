# Historian all-point Trends cache rollout and replacement soak - 2026-07-22

Status: **bounded deployment GREEN; replacement 24-hour soak running**.

## Prior soak disposition

- Unit: `mkddc-historian-soak-trendscache.service`.
- Window: `historian-trendscache-20260722T034500Z`.
- Runtime: `2026-07-22T04:01:50Z` to `2026-07-22T06:49:50Z` (`10080.315` seconds, 169 samples).
- The monitor received a graceful systemd stop for the owner-approved all-point cache visibility rollout and wrote `complete=false`, `pass=false`.
- It recorded zero sample, service, restart, hash, integrity, authority, or storage violations; `legacyDelta=0`, `hotDelta=+1322`, `gapDelta=+75`, and 310 known Core warnings.
- The artifacts were preserved. This is incomplete evidence and does not satisfy the 24-hour gate.

## Deployment checkpoint and package

- Window: `historian-trendscache-allpoints-20260722T065257Z`.
- Online schema-v5 checkpoint: `/data/config/historian-v2-migration/historian-trendscache-allpoints-20260722T065257Z/predeploy/historian-v2-predeploy.sqlite`, SHA-256 `222234b44f16ccf1d9614b666ef555cd25c1fde558e0b9266195ea40d747e7f1`, `quick_check=ok`.
- Retained rollback binary: SHA-256 `319236d08c02be8712b0d49680cccb420e78528ea64fb1a619ecc674e21d5dad`.
- ARM64 candidate: SHA-256 `f666b3cb1083a43e59c27e6f4e9709d1d78f37d5536711ceb079ceb7469734b9`, 17,024,886 bytes.
- Native Linux/ARM64 package gate passed byte-identical current/rollback-candidate builds against separate schema-v5 legacy and active fixtures. All five artifact families remained unchanged; manifest SHA-256 is `1faccebcf8c10b890ad2ccc7f5c7f15755f8a8a72bd7aba68a14fa67f8b2e2cf`.
- Isolated port `18081` canary served `/login=200` and unauthenticated system status `401`, then stopped. Production database/config paths were not used by the canary.

## Board rollout verification

- Only `mkddc-web-pi` restarted, from `2026-07-22T07:01:49Z` to readiness at `07:01:58Z`; automatic rollback was armed but not triggered.
- `mkddc-web-pi`, `mkddc-core`, and `mkddc-iobus` are active with zero restarts. `/login=200`; unauthenticated status is `401`.
- Live database remains `quick_check=ok`, `state=active`, writer authority `v2`, legacy quiesced, migration verified, and prune disabled. Legacy row count remains `596284`.
- Recent authenticated cache query returned `UI-01`, `UI-02`, and `UI-06` with 19, 13, and 13 samples, respectively, and `tiersUsed=[cache]`.
- The same recent database query returned only persisted `UI-01` with 18 samples and `tiersUsed=[hot]`, confirming Custom remains database-only.
- The bounded journal since rollout contained zero `SQLITE_BUSY`, hot conflict, overflow, snapshot, `alarms_read degraded`, or `core unavailable` warnings.

## Replacement soak

- Unit: `mkddc-historian-soak-allpoints-20260722t065257z.service`.
- Output: `/data/config/historian-v2-migration/historian-trendscache-allpoints-20260722T065257Z/soak-24h`.
- Started: `2026-07-22T07:07:02Z`; duration `86400` seconds; interval `60` seconds; hourly `quick_check`.
- First sample: all services active with zero restarts, binary SHA matches the candidate, web RSS `26860 KiB`, `quick_check=ok`, hot rows `468726`, gaps `3419`, legacy rows `596284`, and zero storage/Core warnings.
- Completion remains pending. Physical UI/AO/DO/VP operation, power-cut/fault injection, target eMMC endurance, prune enablement, legacy removal, and the full E2E release gate are not claimed GREEN.

## Repository evidence

- [Postdeploy verification](board-trendscache-allpoints-postdeploy-2026-07-22.json)
- [ARM64 package manifest](historian-rollback-package-arm64-allpoints-2026-07-22.json)
- [Incomplete prior-soak summary](board-trendscache-soak-incomplete-2026-07-22.json)
