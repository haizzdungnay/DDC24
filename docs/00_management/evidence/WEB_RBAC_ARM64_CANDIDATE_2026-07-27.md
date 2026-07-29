# Web RBAC Linux/ARM64 candidate evidence - 2026-07-27

**Scope:** local packaging preflight for `RBAC-ROLLOUT-001`
**Mutation:** local build output only; no target deploy, service stop/restart, login, migration or account change.

## Candidate identity

- Artifact: `build/deploy/web-rbac-20260727/mkddc-web`
- Size: `17857804` bytes
- SHA-256: `cce38479fa52a5a46e2dc0cc5059eb4c4c105ab48d0553b7f127e5a59285d593`
- Toolchain: `go1.26.4`
- Build metadata: `GOOS=linux`, `GOARCH=arm64`, `CGO_ENABLED=0`, `-trimpath=true`
- Source revision: `8f2f330f37d28f8483aefaa83fa6591984d3386d`
- Source revision time: `2026-07-25T03:29:12Z`
- VCS state embedded by Go: `vcs.modified=true`

`go version -m` lists `modernc.org/sqlite`; the backend does not require a CGO SQLite driver for this build. The checksum is also stored in `build/deploy/web-rbac-20260727/SHA256SUMS`, with machine-readable metadata in `manifest.json`.

## Commands and result

```powershell
$env:CGO_ENABLED='0'
$env:GOOS='linux'
$env:GOARCH='arm64'
go build -trimpath -o ../../build/deploy/web-rbac-20260727/mkddc-web .
go version -m ../../build/deploy/web-rbac-20260727/mkddc-web
Get-FileHash -Algorithm SHA256 ../../build/deploy/web-rbac-20260727/mkddc-web
```

Result: cross-build, architecture metadata inspection and SHA-256 calculation passed locally.

Independent local integrity checks also passed:

- rebuild from the current source produced the same `17857804`-byte artifact and SHA-256;
- WSL `file` identified a statically linked ELF 64-bit ARM aarch64 executable;
- WSL `sha256sum --check SHA256SUMS` returned `mkddc-web: OK`;
- the workflow parsed as YAML and the extracted checksum/metadata shell step passed `bash -n`;
- JSON manifest size/hash and the actual artifact size/hash matched exactly.

## Release decision

This file is a packaging preflight, not a release approval. Because the artifact was built from a modified worktree, it is **not release-eligible** and must not be deployed as the approved production binary.

The CI workflow now builds the same `linux/arm64`, CGO-disabled backend from a clean checkout, requires `vcs.modified=false` and the exact CI revision, verifies its SHA-256, and uploads the binary plus checksum. A successful CI run and review of that immutable artifact are still required.

Target execution remains pending the approved maintenance window, deployment authorization, four controlled smoke credentials, backup/migration/smoke/rollback evidence and independent security approval. The read-only target baseline is recorded in [`WEB_RBAC_TARGET_PREFLIGHT_2026-07-27.md`](WEB_RBAC_TARGET_PREFLIGHT_2026-07-27.md).
