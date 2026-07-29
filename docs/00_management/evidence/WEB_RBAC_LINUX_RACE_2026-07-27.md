# Web RBAC native Linux race evidence - 2026-07-27

**Scope:** full Go backend race-detector regression after RBAC implementation, target-smoke tooling and offline smoke-account provision/cleanup
**Target mutation:** none; execution was local in WSL2 and did not connect to the Orange Pi.

## Environment

- Distribution: Ubuntu 24.04.3 LTS under WSL2
- Kernel/architecture: Linux `6.18.33.2-microsoft-standard-WSL2`, `x86_64`
- Go: `go1.26.4 linux/amd64`
- GCC: `13.3.0`
- Go archive: official `go1.26.4.linux-amd64.tar.gz` from `go.dev`
- Verified archive SHA-256: `1153d3d50e0ac764b447adfe05c2bcf08e889d42a02e0fe0259bd47f6733ad7f`
- Toolchain/module/build caches: ignored workspace paths under `build/`; no system installation.

## Command

```bash
cd /mnt/e/TuanDuong/INTERN/MK-DDC-24/web/backend
env \
  GOTOOLCHAIN=local \
  GOCACHE=/mnt/e/TuanDuong/INTERN/MK-DDC-24/build/cache/go-build-linux-race \
  GOMODCACHE=/mnt/e/TuanDuong/INTERN/MK-DDC-24/build/cache/go-mod-linux \
  /mnt/e/TuanDuong/INTERN/MK-DDC-24/build/toolchains/go1.26.4-linux-amd64/bin/go \
  test -race -count=1 ./...
```

## Result

```text
ok  mkddc-web  188.043s
```

- Exit code: `0`
- Race findings: none
- Harness wall time: `370.6s`, including first-run Linux module download and compilation.

After adding credential-file and failure-cleanup regressions, the targeted native-Linux race rerun also passed:

```text
go test -race -count=1 -run RBACTargetSmoke ./...
ok  mkddc-web  12.746s
```

This closes the missing local native-Linux race execution evidence for the current worktree. A successful clean-checkout CI run remains required for release provenance and immutable artifact review.

After adding offline four-role account provision/cleanup, exact-store ownership verification and its real-router lifecycle tests, the full current-worktree race suite was rerun:

```text
go test -race -count=1 ./...
ok  mkddc-web  154.503s
```

- Exit code: `0`
- Harness wall time: `175.2s`
- Race findings: none

The scoped staged source tree was then materialized as a separate clean Git worktree, excluding unrelated local Network/Timezone/Historian changes, and the full race suite passed again:

```text
go test -race -count=1 ./...
ok  mkddc-web  166.838s
```

- Exit code: `0`
- Harness wall time: `209.4s`
- Race findings: none
- Scope: exact staged backend source; the later evidence-count edits are documentation-only.
