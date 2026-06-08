# GitHub Secret Scanning Enablement — Blocker Analysis

## Issue
IOT-5584 — Enable GitHub native secret scanning on MK-DDC-24 repo.

## Result: BLOCKED

GitHub native secret scanning for **private repositories** requires:
- Owner is an **Organization** (not a User account)
- Organization has **GitHub Advanced Security** (Enterprise plan)

## Account Analysis

| Field | Value |
|-------|-------|
| Account | `Mekong-HCM` |
| Account type | `User` |
| Plan | `Pro` |
| Repo visibility | `private` |

## API Attempts

### `PATCH repos/Mekong-HCM/MK-DDC-24` — secret_scanning
```json
{"message": "Secret scanning is not available for this repository."}
```

### `PATCH repos/Mekong-HCM/MK-DDC-24` — security_and_analysis
```json
{"message": "Invalid security_and_analysis payload."}
```

## Alternatives Considered

| Option | Feasibility |
|--------|-------------|
| Convert account to Organization | Requires CTO/owner action |
| CI-based scanning (gitleaks) | ✅ Already in `.github/workflows/security.yml` |
| Pre-commit hook | Low effort, local only |
| Make repo public | Not suitable for private codebase |

## Recommendation
Use CI-based gitleaks scanning (already configured in security workflow).

## References
- [IOT-5584](https://github.com/Mekong-HCM/MK-DDC-24/issues/1) — parent issue
- [GitHub Secret Scanning docs](https://docs.github.com/en/enterprise-cloud@latest/code-security/secret-scanning)
- `.github/workflows/security.yml` — existing CI security workflow
