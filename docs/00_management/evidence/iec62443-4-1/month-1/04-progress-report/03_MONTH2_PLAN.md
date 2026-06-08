# Month 2 Plan — IEC 62443-4-1 Setup

> **Document ID:** IEC62443-M1-PLAN-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Approved (Owner 2026-06-08)
> **Owner:** DeveloperTeam + Tech Lead

---

## 1. Month 2 Objectives

1. **Deepen technical evidence** — formal threat modeling session, supplier security RFQ, CVE scan pipeline
2. **Close open decisions** — SW-Q-004 (key store), SW-Q-005 (OTA endpoint)
3. **Build on process evidence** — vulnerability management SOP, patch management SOP
4. **Advance training** — secure coding workshop, CVE triage drill

## 2. Deliverables

| # | Deliverable | SM | Priority | Owner | Target Date | Dependencies |
|---|-------------|:--:|:--------:|-------|:-----------:|-------------|
| 1 | Formal Threat Modeling Session + Report | SM-2 | P0 | Tech Lead + Solution Architect | Month 2 W1 | SW-Q-004 decision |
| 2 | Vulnerability Management SOP (finalize) | SM-6 | P1 | DevOps + Tech Lead | Month 2 W2 | Template done (SEC-PLAN-001) |
| 3 | Patch Management SOP (finalize) | SM-7 | P1 | DevOps + Release | Month 2 W2 | Template done (SEC-PLAN-001) |
| 4 | Security Test Plan (threat-based) | SM-5 | P1 | QA + Tech Lead | Month 2 W3 | Threat model done |
| 5 | Supplier Security RFQ (Radxa + TI) | SM-9 | P1 | Tech Lead + Procurement | Month 2 W3 | Supplier list |
| 6 | SW-Q-004 Decision — Key store | SM-3 | P0 | Solution Architect + CTO | Month 2 W1 | — |
| 7 | SW-Q-005 Decision — OTA endpoint | SM-3 | P0 | Solution Architect + CTO | Month 2 W1 | — |
| 8 | Secure Coding Workshop (Dev team) | SM-12 | P2 | Tech Lead | Month 2 W2 | Training materials |
| 9 | CVE Triage Drill | SM-12 | P2 | DevOps + Tech Lead | Month 2 W3 | Vulnerability SOP |
| 10 | OTA Provider Evaluation | SM-9 | P2 | Tech Lead | Month 2 W3 | Requirements defined |
| 11 | Secure Decommissioning Template | SM-11 | P2 | QA + Tech Lead | Month 2 W4 | — |
| 12 | Security Training Matrix (formal) | SM-12 | P2 | PMO + Tech Lead | Month 2 W4 | Training record |
| 13 | Trace Matrix Update (SEC/OTA/API/MQTT) | SM-1 | P1 | QA | Month 2 W4 | SR baseline done |

## 3. Dependency Graph

```
SW-Q-004 ──► Threat Model ──► Security Test Plan
SW-Q-005 ──► OTA Provider Evaluation ──► Patch SOP
                        │
Secure Coding Workshop ─┼──► CVE Triage Drill
                        │
SR Baseline (done) ────┘──► Trace Update
```

## 4. Resource Estimate

| Role | Estimated Effort (days) |
|------|:-----------------------:|
| Tech Lead | 5-7 |
| Solution Architect | 2-3 |
| DevOps | 3-4 |
| QA | 3-4 |
| DeveloperTeam | 2-3 |
| Procurement | 1-2 |
| PMO | 1 |

## 5. Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| SW-Q-004 and SW-Q-005 decided | Open issues updated with DEC, owner, date |
| Threat model done | Report signed off by Solution Architect |
| Vulnerability SOP finalized | Document reviewed and approved |
| OTA provider shortlist | At least 2 candidates evaluated |
| Team training completion | 80%+ technical team attended secure coding workshop |

## 6. Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| SW-Q-004/SW-Q-005 decisions delayed | Escalate to CTO in W1, highlight schedule impact on P5 gate |
| Threat modeling session scheduling conflict | Pre-schedule in W1, involve Solution Architect early |
| OTA provider evaluation incomplete | Define lightweight criteria first, detailed eval in Month 3 |
| Training attendance low | Make workshop mandatory for PR approval access |
