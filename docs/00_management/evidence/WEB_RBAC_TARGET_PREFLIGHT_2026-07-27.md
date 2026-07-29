# Web RBAC target preflight — 2026-07-27

**Scope:** read-only preflight for `RBAC-ROLLOUT-001`
**Observed at:** 2026-07-27T15:30:47+07:00
**Mutation:** none; no service stop/restart, file write, deploy, login or account change was performed.

## Target identity

- Host: `orangepi5b`
- Architecture/kernel: `aarch64`, `6.1.43-rockchip-rk3588`
- Web unit: `mkddc-web-pi.service`, loaded/active/running
- Runtime identity: `mkddc:mkddc`
- Executable: `/opt/mkddc-web/mkddc-web`
- Observed executable SHA-256: `125b49066afb9c8676957dacb49111b266611c73a10e79c6db1487b145abe052`

## User store shape

- Path: `/data/config/users.conf`
- Metadata: mode `0600`, owner `mkddc:mkddc`, size 193 bytes
- Schema: `1.0`
- Accounts: 1
- Role distribution: one `admin`
- Persisted `session_version`: absent

Only schema/count/role/session-version shape was emitted. No username, bcrypt hash, password, JWT or service secret was included in the evidence.

## Decision

Target migration is **not executed** in this preflight. Safe completion requires:

1. an approved maintenance window for stopping `mkddc-web-pi.service`;
2. deployment and hash verification of the compatible backend/OpenAPI before the new FE;
3. a unique backup path and execution of `rbac-users-migrate` while the service is stopped;
4. approved credentials for four temporary or controlled `viewer|operator|engineer|admin` smoke accounts;
5. four-account target smoke, rollback decision and independent reviewer approval.

Until those inputs exist, `WEB-RBAC-001` remains RED/Partial and the existing target file/service must remain unchanged.

## Read-only readiness recheck

Observed at `2026-07-27T16:14:38+07:00` without mutation:

- SSH still reached `orangepi5b`.
- `mkddc-web-pi.service` remained `active/running` with executable `/opt/mkddc-web/mkddc-web`.
- The service listener was confirmed on `*:8081`.

This confirms the documented loopback smoke origin `http://127.0.0.1:8081`. No environment secret, credential, JWT, username or user-store content was read during the recheck.
