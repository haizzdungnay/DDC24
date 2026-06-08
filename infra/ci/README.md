# CI/CD — MK-DDC-24

> CI workflows + branch protection rules.
> Cập nhật tài liệu gốc tại [docs/05_implementation/KX-DDC24-PM-REPO-001_VI.md](../../docs/05_implementation/KX-DDC24-PM-REPO-001_VI.md).

## Workflows

| Workflow | File | Trigger | Required for merge |
|----------|------|---------|-------------------|
| Build + Test | `fw.yml`, `be.yml`, `fe.yml` | PR to main | ✅ |
| Security Scan | `security.yml` | PR to main | ✅ |
| OpenAPI Contract | `openapi.yml` | PR to main | ✅ |

## Branch Protection Rules (main)

Applied via `infra/scripts/branch-protection.sh` *(script gỡ khỏi repo doc-phase 2026-06-08 — xem backup/triển khai khi vào implement)*.

### Required Status Checks

All 3 security jobs must pass:

| Job name | Tool | What it catches |
|----------|------|----------------|
| `trivy-scan` | Trivy | CVE >= 7.0 in dependencies |
| `grype-scan` | Grype | Second-opinion vulnerability scan |
| `gitleaks-scan` | Gitleaks | Secrets / credentials in code |

### Additional Rules

| Rule | Value |
|------|-------|
| Pull request reviews required | ≥ 1 approver |
| Dismiss stale reviews | Yes (new pushes dismiss approval) |
| Strict status checks | Yes (branch must be up-to-date) |
| Admin bypass | No (enforce on admins too) |
| Force push | Blocked |
| Deletion | Blocked |

## Applying the Rules

```bash
# Prerequisites: gh CLI authenticated with repo:admin scope
export GH_TOKEN=ghp_...

# Apply to production repo
./infra/scripts/branch-protection.sh kinexus-iot/mk-ddc-24

# Verify current state (read-only)
gh api repos/kinexus-iot/mk-ddc-24/branches/main/protection
```

## Verification Checklist

- [ ] PR with failing `trivy-scan` — merge blocked
- [ ] PR with failing `gitleaks-scan` — merge blocked
- [ ] PR with no reviewer — merge blocked
- [ ] PR after new push — approval dismissed, re-review required
