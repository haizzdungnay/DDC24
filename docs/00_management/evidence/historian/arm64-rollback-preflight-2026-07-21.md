# Historian ARM64 rollback preflight - 2026-07-21

Status: **historical preflight evidence; superseded by the bounded GREEN cutover recorded in [board-cutover-2026-07-21.md](board-cutover-2026-07-21.md)**.

## Scope

- Target: Orange Pi 5B, Linux `aarch64`, kernel `6.1.43-rockchip-rk3588`.
- Service observed read-only: `mkddc-web-pi`, `mkddc-core`, and `mkddc-iobus` active/enabled.
- No service stop/restart, deployed-binary replacement, activation, maintenance cutover, prune, or production database mutation was performed.

## ARM64 package evidence

Two separately named binaries were cross-built from the current backend with:

```text
GOOS=linux GOARCH=arm64 CGO_ENABLED=0
go build -trimpath -buildvcs=false
```

The final binaries (including legacy single-writer, prebuilt-package support and binary-file hardening) were `ELF 64-bit LSB executable, ARM aarch64`, statically linked, size `16,878,111` bytes, and had the same SHA-256:

```text
440aae2b3377e3fa65373663d59aecc5abfaf1fd28aa3cc4eb51bfee0835a39c
```

The binaries were copied only to `/tmp`, executed, and removed. Earlier pairs (`1e81fb1c...`, `97158917...`, `1675d744...`) are superseded by this final pair.

## Frozen board fixture

The running board database was copied coherently with the Python SQLite backup API to `/tmp/historian-v2-schema1-frozen.sqlite`. The frozen copy had:

```text
PRAGMA user_version = 1
PRAGMA quick_check = ok
SHA-256 = ae5dc945b3ddaf8283cfa3604719123921b949fe29dac6390db4fb58b6aa0097
```

Both ARM64 binaries rejected the fixture with exit code `1`:

```text
rollback binary supports historian schema 5, fixture is 1
```

The frozen fixture SHA-256 was identical after both verifier executions. Temporary binaries and fixture were removed with explicit paths.

## Native schema-v5 package gate

Schema-v5 legacy and active fixtures were generated from the current code in an isolated temporary directory and copied to board `/tmp`. The ARM64 `prebuilt-native` package mode ran both binaries against both fixtures plus archive/evidence artifacts and wrote the native manifest:

- Manifest: [historian-rollback-package-arm64-2026-07-21.json](historian-rollback-package-arm64-2026-07-21.json)
- Manifest SHA-256: `047470cd6c67efb855a09e37b2e8f103b436d35d2e500cf0023804b3c84e0578`
- Current/candidate SHA-256: `440aae2b3377e3fa65373663d59aecc5abfaf1fd28aa3cc4eb51bfee0835a39c` (both, `16,878,111` bytes).
- Legacy and active outputs: schema `5`, `quickCheck=ok`, exact expected authority matrix.
- All four fixture/archive/evidence artifacts: before/after SHA and size identical.

This closes native ARM64 package parity for frozen fixtures. It does not authorize deploying the binary or mutating the live board schema-v1 database.

## Isolated ARM64 runtime canary

The final ARM64 binary was started on port `18081` with a dedicated `/tmp` config directory, copied read-only core socket access, isolated TrendStore, and the frozen schema-v5 active fixture. Production service/config/database paths were not used.

- Process reached the HTTP listen state and exited cleanly on `SIGTERM`.
- `/login` returned `200`; unauthenticated `/api/v1/system/status` returned the expected `401`.
- The schema-v5 fixture SHA was unchanged before/after startup.
- Startup logged `historian_v2 policy mirror pending` because the intentionally minimal canary `historian.conf` did not match the active fixture policy. The canary therefore proves safe boot/fail-closed behavior, not production authority readiness.
- All `/tmp` canary artifacts were removed after the run.

## Gate result

The live-board schema-v1 check is valid fail-closed evidence, while the isolated schema-v5 ARM64 package gate is GREEN. Production activation remains prohibited: the running board still has no migrated schema-v5 authority, repeated legacy `SQLITE_BUSY`, no completed physical power-cut/browser/manual E2E, and no owner-approved eMMC write-amplification/endurance thresholds.

## Board storage baseline (read-only)

At `2026-07-21T15:40:48+08:00`, the root/data filesystem reported `29,303,762,944` bytes total, `13,693,939,712` used and `15,266,123,776` available (`48%`). This exceeds the historian minimum free-space reserve of `512 MiB`, but is not a capacity/endurance benchmark. Current historian files measured `77,824` bytes DB, `40,960` bytes WAL and `32,768` bytes SHM; archive directory was absent/empty at the inspected depth. Web RSS was `30,872 KiB` and core RSS `5,336 KiB`.

`mmc` is installed but returned no `DEVICE_LIFE_TIME_EST_TYP_*` or `PRE_EOL` telemetry, so true NAND write amplification/endurance cannot be established. No `fio` workload was run against live storage.

The service smoke checks returned `/login=200`, unauthenticated system status `401`, and all three core services remained active. The web journal concurrently showed repeated legacy `SQLITE_BUSY` warnings from `virtual_points.sample` and `trend.sample`; storage health therefore remains non-GREEN and no historian cutover is authorized.

The existing board time/service soak completed at `2026-07-21T02:40:45Z` with services continuously active, NTP normal and disk fixed at `48%`. Its final two-minute windows still reported approximately `167..199` `SQLITE_BUSY` events. This supports service/time stability only; it fails historian storage health and does not measure historian RAM, queue, query latency, archive retention or eMMC endurance.
