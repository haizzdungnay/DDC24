# Web RBAC completion audit - 2026-07-27

**Objective:** complete `RBAC-TEST-001` and the approved four-role Web RBAC plan
**Method:** requirement-by-requirement inspection of current code, tests, CI, artifacts, documentation and read-only target state
**Decision:** code-local implementation and test packages are complete; full RBAC plan completion is not yet proven because target rollout, clean artifact provenance and independent approval remain open. Seven business authorities still returning `501` are explicitly tracked by separate finding `WEB-FEATURE-AUTH-001`; their authorization behavior remains in RBAC scope, but feature availability is not an RBAC closure condition.

## Requirement audit

| Requirement / gate | Current evidence | Decision |
|---|---|---|
| Canonical roles and boundaries | `viewer|operator|engineer|admin` are aligned in ADR-022, requirements, OpenAPI, backend and FE. Schedule/Alarm Settings remain Engineer+, Users and database mutation remain Admin-only. | **Proven code-local** |
| Capability authorization | Backend uses deny-by-default `RequirePermission`; exact role/rank authorization was removed from Web protected routes. Unknown role/permission tests fail closed. | **Proven code-local** |
| Exact endpoint ownership | Real router contains exactly 61 protected operations; OpenAPI v1.11.0 contains the same 61 protected operations plus public login with matching role sets. | **Proven code-local** |
| Four-role API security matrix | Every protected operation is tested unauthenticated and for all four roles; denial is `401/403` before handler/side effect and allowed roles do not receive an authorization denial. | **Proven code-local** |
| Session safety | Persisted `session_version`, unique cryptographic JWT `jti`, role/password/delete invalidation, restart persistence and persist-failure behavior have regressions. | **Proven code-local** |
| User invariants | Self-delete, last-admin delete/demotion and concurrent demote/delete are guarded in the same persistence boundary and return stable conflicts. | **Proven code-local** |
| FE route/navigation/action/query policy | Central permission map, direct-route guard, hidden-query suppression, read-only presentation and real Admin Users CRUD are covered by clean staged 27 files / 137 tests and source guard. | **Proven code-local** |
| Live local E2E | Playwright with Go `App.Router()`, Vite live/JWT and four schema-2.0 accounts passes 5/5 scenarios, including stale JWT and Users/database boundaries. | **Proven local system** |
| Race/concurrency execution | Full `go test -race -count=1 ./...` passes native Linux with no finding. | **Proven local native Linux** |
| User-store migration/rollback | `rbac-users-migrate`/`rbac-users-rollback` provide exclusive durable backup, schema/account/hash/session validation, restore-on-failure and exact-byte rollback tests. | **Proven code-local** |
| Four-account target smoke tooling | Offline provision/cleanup generates four cryptographic controlled accounts only on stopped canonical schema 2.0, writes exclusive durable 0600 credential/receipt files, verifies exact ownership/original SHA before cleanup, and composes with credential-safe full `rbac-target-smoke`. | **Tool + real-router lifecycle proven local; target run missing** |
| ARM64 package | Local static `linux/arm64` candidate metadata and SHA-256 are verified. | **Packaging preflight only** — embedded `vcs.modified=true` |
| Clean CI provenance | Workflow requires exact CI revision, `vcs.modified=false`, checksum verification and artifact upload. | **Configured, not executed for current changes** |
| Target migration/deploy | Read-only preflight confirms active service on port 8081 and legacy schema 1.0 with one Admin. | **Missing** — no approved stop/deploy/migration/smoke window |
| Seven authority-pending APIs | BACnet objects, Graph validate/deploy, OTA upload/apply/status and log download are permission-gated and audited but return `501` to allowed roles. | **Separated** — RBAC authorization evidence is proven; missing business authority remains RED under `WEB-FEATURE-AUTH-001` and cannot be claimed available |
| Dependency/security acceptance | React Router RSC advisory is documented as not reachable by the client-only architecture; no safe upstream resolution is available in the current registry state. | **Residual requires independent acceptance** |
| Independent implementation review | The two attached reports reviewed the pre-code plan and their findings are resolved, but they do not review the completed implementation/artifact/target evidence. | **Missing** |

## Verification evidence

- Go: unit/integration, vet, build, module verification and native Linux race pass.
- FE: clean staged tree 27 test files / 137 tests, lint, typecheck, production build and RBAC source guard pass; 9 unrelated Network/Timezone tests remain outside the scoped commit.
- Live local RBAC E2E: 5/5 Playwright scenarios pass.
- ARM64: static ELF aarch64 inspection, build metadata, manifest and checksum pass.
- Workflow: YAML parse and extracted verification-shell syntax pass.
- Target: read-only identity/service/listener/user-store-shape preflight only; no deployment mutation.

Detailed evidence:

- [`WEB_RBAC_ARM64_CANDIDATE_2026-07-27.md`](WEB_RBAC_ARM64_CANDIDATE_2026-07-27.md)
- [`WEB_RBAC_LINUX_RACE_2026-07-27.md`](WEB_RBAC_LINUX_RACE_2026-07-27.md)
- [`WEB_RBAC_TARGET_PREFLIGHT_2026-07-27.md`](WEB_RBAC_TARGET_PREFLIGHT_2026-07-27.md)

## Remaining actions to finish RBAC

1. Owner authorization for stop/deploy/start and controlled maintenance actions is granted; execute it only with a reviewed clean-checkout artifact for the approved commit, not the local dirty-tree candidate.
2. Target backup, schema migration, offline four-account provision, full `rbac-target-smoke`, FE-last deployment, exact controlled-account cleanup and keep/rollback decision evidence.
3. Independent security reviewer approval of the completed implementation, target evidence and dependency residual.

The seven authority-pending feature routes are already separated into `WEB-FEATURE-AUTH-001`; closing that feature gate is outside the RBAC completion claim and must not be inferred from an RBAC approval.

The ready-to-send implementation review prompt is [`WEB_RBAC_INDEPENDENT_REVIEW_REQUEST_2026-07-27.md`](../WEB_RBAC_INDEPENDENT_REVIEW_REQUEST_2026-07-27.md).

Until all required closure evidence exists, `RBAC-TEST-001` remains complete code-local but the full `RBAC-ROLLOUT-001` / `WEB-RBAC-001` plan must remain active and RED/Partial.
