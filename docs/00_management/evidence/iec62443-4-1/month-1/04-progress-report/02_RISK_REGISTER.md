# Risk Register — IEC 62443-4-1 Month 1

> **Document ID:** IEC62443-M1-RISK-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Initial
> **Owner:** DeveloperTeam + Tech Lead

---

| # | Risk | Category | Likelihood | Impact | Severity | Mitigation | Owner | Status |
|---|------|----------|:----------:|:------:|:--------:|------------|-------|:------:|
| R-001 | Key store decision (SW-Q-004) kéo dài, ảnh hưởng secure design P5 | Technical | High | High | 🔴 Critical | Chốt trước P5 gate, Tech Lead escalate lên CTO | Solution Architect | Open |
| R-002 | OTA endpoint decision (SW-Q-005) kéo dài, ảnh hưởng OTA design | Technical | High | High | 🔴 Critical | Chốt trước P5 gate, Tech Lead escalate lên CTO | Solution Architect | Open |
| R-003 | Extended-temp CM3 (HW-Q-002) unavailable — cần đổi SOM | Supply chain | Medium | High | 🔴 High | Đánh giá SOM thay thế trước GA, formal RFQ | Procurement | Open |
| R-004 | OTA provider not selected — không có hosting cho OTA test | Supply chain | Medium | High | 🔴 High | Define requirements, evaluate vendors Month 2 | Tech Lead | Open |
| R-005 | Security implementation bắt đầu trước khi threat model done | Process | Medium | High | 🟡 High | Gap analysis recommends: không start P5 before Month 1 actions | Tech Lead | Monitoring |
| R-006 | Team chưa có formal security training (secure coding, threat modeling) | Training | Medium | Medium | 🟡 Medium | Month 2 training plan: workshop sessions | PMO | Open |
| R-007 | Supplier assessment còn sơ sài, chưa có formal RFQ | Supply chain | Medium | Medium | 🟡 Medium | Formal supplier assessment Month 2 sau RFQ | Procurement | Open |
| R-008 | CVE scan pipeline chưa có code để scan | Technical | Low | Medium | 🟢 Low | CI pipeline designed, ready khi code available | DevOps | Monitoring |
| R-009 | IEC 62443-4-2 (component) ngoài scope v1.0, có thể bị audit hỏi | Compliance | Medium | Low | 🟢 Low | Document clear: v1.0 chỉ 4-1 process, 4-2 roadmap v1.2→2.0 | PM | Mitigated |
| R-010 | Budget overrun cho certification (USD 4,600–8,900) | Budget | Low | Medium | 🟢 Low | Budget tracker active, escalation triggers defined | PMO | Monitoring |

## Risk Trend

| Period | Critical | High | Medium | Low | Total |
|--------|:--------:|:----:|:------:|:---:|:-----:|
| Month 1 Start | 2 | 2 | 2 | 4 | 10 |
| Month 1 End | 2 | 2 | 2 | 4 | 10 |

No change — risks identified in Month 1 remain open pending decisions and deeper assessment in Month 2.

## Top 3 Risks Requiring Escalation

1. **R-001 (SW-Q-004)** — Blocks secure design completion. Cần CTO decision trước P5.
2. **R-002 (SW-Q-005)** — Blocks OTA design completion. Cần CTO decision trước P5.
3. **R-003 (HW-Q-002)** — SOM extended temp. Cần Radxa confirmation hoặc fallback plan.
