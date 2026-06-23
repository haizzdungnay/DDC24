# CVE Monitoring & Vulnerability Response Process — MK-DDC-24
## IEC 62443-4-1 SM-6: Vulnerability Management Procedure

> **Document ID:** KX-DDC24-SEC-PROC-001
> **Phiên bản:** 1.2 | 2026-06-23
> **Trạng thái:** Approved
> **Owner:** Tech Lead + DevOps
> **Chuẩn tham chiếu:** IEC 62443-4-1 SM-6, IEC 62443-4-2 CR 1.14, ISO/IEC 30111, NIST SP 800-40
> **Ref:** [SEC-SUP-001 §6](KX-DDC24-SEC-SUP-001_VI.md) | [SEC-GAP-001 SM-6](KX-DDC24-SEC-GAP-001_VI.md) | [SEC-PLAN-001](security_process_templates/KX-DDC24-SEC-PLAN-001_VI.md) | [PM-REPO-001](../05_implementation/KX-DDC24-PM-REPO-001_VI.md)
> **Issue:** [IOT-5575](../../../../../../IOT/issues/IOT-5575)

---

## 1. Scope

This document defines the CVE monitoring cadence, tooling, triage workflow, and vulnerability response SLA for MK-DDC-24. It covers:

- **SOM software stack:** Debian 12 OS, Python services (FastAPI, paho-mqtt, pymodbus), C/C++ services (io-driver, bacnet, fieldbus, hmi), OTA agent
- **MCU firmware stack:** FreeRTOS kernel, STM32 HAL, IOP protocol
- **Frontend:** Web IDE Svelte/TypeScript + npm dependencies
- **Hardware:** SOM (Radxa CM3), MCU (STM32G0B1), ICs (ADC, DAC, etc.)
- **Build toolchain:** arm-none-eabi-gcc, CMake, Python 3.11, Node.js 22

Out of scope: third-party cloud services, customer network infrastructure, physical security.

---

## 2. CVE Monitoring Cadence

| Layer | Cadence | Tool / Method | Owner | Trigger |
|-------|---------|---------------|-------|---------|
| **Python dependencies** | Continuous (CI) | `trivy` + `grype` in `security.yml`; Dependabot alerts | DevOps | Each PR + daily scheduled scan |
| **npm dependencies** | Continuous (CI) | `npm audit` + `trivy` in `security.yml`; Dependabot alerts | Frontend Lead | Each PR + daily scheduled scan |
| **Debian 12 (OS + packages)** | Continuous (CI) | `trivy` Debian DB scan on rootfs | DevOps | Each image build + daily |
| **All OSS dependencies** | Monthly | Manual NVD cross-check + `trivy` full report | DevOps + SW Lead | 1st Monday of month |
| **bacnet-stack** | Monthly | GitHub releases + NVD + GitHub Advisory DB | SW Lead | 1st Monday of month |
| **FreeRTOS kernel** | Quarterly | Amazon FreeRTOS GitHub + NVD (filter: kernel-only) | FW Lead | 1st of quarter |
| **libmodbus / pymodbus** | Quarterly | GitHub releases + NVD | SW Lead | 1st of quarter |
| **Hardware ICs** (Radxa, TI, ST, etc.) | Quarterly | NVD CVE search by part number | Procurement | 1st of quarter |
| **Build toolchain** | Quarterly | Distro CVE tracker + NVD | DevOps | 1st of quarter |

### 2.1 Monitoring Triggers

| Trigger | Action |
|---------|--------|
| CI scan in PR | Block merge if CVE >= 7.0 (High/Critical); warn if < 7.0 |
| Scheduled CI scan (daily) | Generate report; create issues for new CVEs >= 7.0 |
| Dependabot alert | Auto-create PR for fix; tag Tech Lead for review |
| Debian Security Advisory (DSA) email | Evaluate impact on frozen Debian 12 package list |
| Manual monthly review | Cross-check all layers; update vulnerability register |
| External disclosure (email, PSIRT) | Log as incoming in issue tracker; triage within 24h |

---

## 3. Tool Configuration

### 3.1 CI Scanning (`security.yml`)

Configured in `infra/ci/security.yml` (see PM-REPO-001 §4). Each run:

```yaml
# Conceptual workflow:
# 1. trivy fs --severity CRITICAL,HIGH --exit-code 1 <path>
# 2. grype dir:<rootfs> --fail-on=High -o cyclonedx > sbom.cdx.json
# 3. gitleaks detect --verbose --no-git
```

### 3.2 Dependabot Configuration

Dependabot should be enabled for the mono-repo (`mk-ddc-24`) with these ecosystems:

| Ecosystem | Directory | Schedule | Reviewers |
|-----------|-----------|----------|-----------|
| `github-actions` | `/` | weekly | Tech Lead |
| `pip` | `/services/agent/` | weekly | SW Lead |
| `npm` | `/webide/` | weekly | Frontend Lead |
| `docker` | `/infra/debian-image/` (if Dockerfile) | weekly | DevOps |

Group minor/patch updates into single PRs to reduce noise.

### 3.3 Debian Security Tracker

- Subscribe to DSA mailing list: https://security-tracker.debian.org/mailinglist
- Subscribe to `debian-security-announce@lists.debian.org`
- Monitor: https://security-tracker.debian.org/tracker/ for kernel 6.1 LTS

---

## 4. Vulnerability Response SLA

Per SRS NFR-006 and SEC-GAP-001 SM-6. Vulnerability severity is determined by CVSS v3.1 score.

| Severity | CVSS Range | Fix SLA | Notification | Evidence |
|----------|:----------:|---------|:------------:|----------|
| **Critical** | >= 9.0 | 7 calendar days | Customer notification + patch release | Patch release notes + scan report |
| **High** | 7.0 – 8.9 | Before GA / 14 days | Patch within next release | Fix PR + scan pass |
| **Medium** | 4.0 – 6.9 | 30 days | Include in next regular OTA | Fix PR + vulnerability register update |
| **Low** | < 4.0 | Next major release | Track in vulnerability register | Register entry + next major release notes |

### 4.1 SLA Exceptions

| Condition | Exception |
|-----------|-----------|
| CVE not applicable (component unused, e.g. FreeRTOS+TCP CVEs) | Document rationale in vulnerability register; no fix required |
| No fix available upstream | Document in register; implement defensive mitigation (firewall, rate limit) |
| Debian package — fix via `apt update` | Apply in next image build; no separate patch unless requested by customer |
| CVE in dev-only dependency (pytest, ruff, mypy) | Document as dev-only; no fix SLA applies |

---

## 5. Vulnerability Triage Workflow

### 5.1 Workflow Steps

```
Intake → Triage → Assign → Fix → Verify → Close
```

| Step | Owner | Actions | Output |
|------|-------|---------|--------|
| **1. Intake** | DevOps (automated) | CI scan alert, Dependabot PR, DSA email, external report → create issue in tracker | Issue with CVE ID, CVSS, affected component, source |
| **2. Triage** | Tech Lead | < 24h: verify applicability, confirm severity, determine if exploitable in target deployment | Triage verdict: applicable / not-applicable / needs-mitigation |
| **3. Assign** | Tech Lead | Assign to appropriate lead (SW/FW/Frontend/DevOps) based on affected component; set SLA deadline | Issue assigned with due date |
| **4. Fix** | DeveloperTeam | Root cause analysis, create fix, unit test, CI pass, update trace matrix | PR with fix + test evidence |
| **5. Verify** | QA | Verify fix, regression test, confirm scan pass, update evidence | Test report + scan pass |
| **6. Close** | Tech Lead | Confirm verification, update vulnerability register, close issue | Register entry + issue closed |

### 5.2 Emergency Patch Criteria

A patch qualifies as emergency (out-of-band OTA) when ALL of:
1. CVE severity >= Critical (CVSS >= 9.0)
2. Exploitable remotely via BACnet/IP or MQTT (no physical access required)
3. No firewall rule or configuration workaround exists
4. Fix is available and verified

Emergency patch requires CTO approval before release.

---

## 6. Vulnerability Register

All CVEs and vulnerabilities are tracked in the project's issue tracker with these fields:

| Field | Description |
|-------|-------------|
| CVE ID | CVE-YYYY-NNNNN or internal tracking ID |
| Component | Affected component (service/library/HW) |
| Version | Affected version |
| CVSS v3.1 | Base score |
| Severity | Critical / High / Medium / Low / None |
| Applicability | Applicable / Not applicable (with rationale) |
| Source | CI scan / Dependabot / DSA / Manual / External |
| Status | Open / In triage / Assigned / Fixing / Verifying / Closed / Deferred |
| Owner | Person responsible |
| SLA deadline | Date based on severity + discovery date |
| Fix version | Version containing fix |
| Verification evidence | Link to scan report, test result |

### 6.1 Current Response Evidence

| Date | Source | Finding | Component | Resolution | Verification |
|------|--------|---------|-----------|------------|--------------|
| 2026-06-23 | Security Scan PR gate | CVE-2025-22869; GO-2026-5020 family | `golang.org/x/crypto`, `golang.org/x/sys` | `web/backend/go.mod` upgraded to `golang.org/x/crypto v0.53.0` and `golang.org/x/sys v0.46.0` | `govulncheck ./...` plus local Trivy/Grype clean archive scan; remote CI re-run pending |
| 2026-06-23 | npm audit / Grype gate | GHSA-fx2h-pf6j-xcff and related Vite advisories | `vite` frontend dev toolchain | Upgraded to `vite@8.0.16` and `@vitejs/plugin-react@6.0.2`; Node 22 CI | `npm audit --audit-level=high`, `npm run build`, `npm run lint` pass locally |

---

## 7. Roles & Responsibilities

| Role | CVE Responsibility |
|------|-------------------|
| **Tech Lead** | Triage severity, assign owner, approve fix plan, manage emergency patch, maintain register |
| **DevOps** | Maintain CI scan pipeline (trivy/grype/gitleaks), SBOM generation, DSA subscription, Dependabot config |
| **SW Lead** | Monthly review of Python/C services and bacnet-stack CVEs |
| **FW Lead** | Quarterly review of FreeRTOS kernel, libmodbus CVEs |
| **Frontend Lead** | npm audit findings triage |
| **Procurement** | Quarterly hardware IC CVE search |
| **QA** | Verify fix evidence, regression test, confirm scan pass |
| **CTO** | Approve emergency patch, approve customer notification |

---

## 8. Related Documents

| Document | Relationship |
|----------|-------------|
| [SEC-SUP-001 §6](KX-DDC24-SEC-SUP-001_VI.md) | Baseline CVE monitoring proposal and component inventory |
| [SEC-GAP-001 SM-6](KX-DDC24-SEC-GAP-001_VI.md) | Gap analysis: vulnerability management maturity requirements |
| [SEC-PLAN-001](security_process_templates/KX-DDC24-SEC-PLAN-001_VI.md) | Vulnerability and patch management procedure template |
| [PM-REPO-001](../05_implementation/KX-DDC24-PM-REPO-001_VI.md) | CI pipeline design including security.yml |
| [SRS NFR-006](../01_specs/SRS_MK-DDC-24_VI.md) | Vulnerability response SLA (non-functional requirement) |
| [PM-GOAL-001 OBJ-10](KX-DDC24-PM-GOAL-001_VI.md) | Security objective: no CVE >= 7.0 in production |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.2 | 2026-06-23 | Dev Web + DevOps | Nâng Go security deps lên `x/crypto v0.53.0`, `x/sys v0.46.0`; cập nhật evidence Trivy/Grype high gate. |
| 1.1 | 2026-06-23 | Dev Web + DevOps | Ghi evidence response cho CVE-2025-22869 và Vite GHSA high gate; liên kết verification npm/go. |
| 1.0 | 2026-06-02 | Tech Lead | Phát hành CVE monitoring process cho IOT-5575. |
