# Month 1 Internal Audit Evidence Package — IEC 62443-4-1

> **Package ID:** IEC62443-M1-EVIDENCE-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Draft — sẵn sàng cho internal audit review
> **Owner:** DeveloperTeam
> **Issue:** IOT-5492
> **Chuẩn:** IEC 62443-4-1 (SM-1..SM-13)
> **Ref:** [PM-MARKET-001 §6.2](../../../KX-DDC24-PM-MARKET-001_VI.md)

---

## Tổng quan

Evidence package này tập hợp bằng chứng cho **Month 1** của quá trình setup IEC 62443-4-1 SDLC process, phục vụ internal audit theo yêu cầu PM-MARKET-001 §6.2.

**Phạm vi Month 1 (2026-06-02):** Gap analysis, process templates, security requirements baseline, training brief, và kế hoạch Month 2.

## Cấu trúc thư mục

```
month-1/
├── README.md                                          ← Index + cross-reference (file này)
├── 01-process-evidence/
│   ├── 01_GAP_ANALYSIS.md                             ← KX-DDC24-SEC-GAP-001
│   ├── 02_TEMPLATES_INVENTORY.md                      ← Danh sách templates đã tạo
│   └── 03_SECURITY_REQUIREMENTS_BASELINE.md           ← SM-1 baseline
├── 02-technical-evidence/
│   ├── 01_THREAT_MODEL_INITIAL.md                     ← SM-2 initial scoping
│   ├── 02_SUPPLIER_ASSESSMENT_INITIAL.md              ← SM-9 initial assessment
│   └── 03_SECURITY_DESIGN_EVIDENCE.md                 ← SM-3 design evidence
├── 03-training-evidence/
│   ├── 01_TRAINING_RECORD.md                          ← SM-12 training record
│   └── 02_TRAINING_MATERIALS.md                       ← Training materials
└── 04-progress-report/
    ├── 01_PROGRESS_REPORT.md                          ← Month 1 completed vs planned
    ├── 02_RISK_REGISTER.md                            ← Risk register
    └── 03_MONTH2_PLAN.md                              ← Month 2 plan
```

## Cross-reference Matrix

| Evidence Item | Document ID | SM | Status | Location |
|--------------|-------------|:--:|:------:|----------|
| Gap Analysis — IEC 62443-4-1 | KX-DDC24-SEC-GAP-001 | All | ✅ Done | [`../../../KX-DDC24-SEC-GAP-001_VI.md`](../../../KX-DDC24-SEC-GAP-001_VI.md) |
| Security Requirements Spec | KX-DDC24-SEC-SPEC-001 | SM-1 | ✅ Template | [`../../../security_process_templates/KX-DDC24-SEC-SPEC-001_VI.md`](../../../security_process_templates/KX-DDC24-SEC-SPEC-001_VI.md) |
| Threat Modeling Report | KX-DDC24-SEC-RPT-001 | SM-2 | ✅ Template | [`../../../security_process_templates/KX-DDC24-SEC-RPT-001_VI.md`](../../../security_process_templates/KX-DDC24-SEC-RPT-001_VI.md) |
| Secure Design Review Checklist | KX-DDC24-SEC-RPT-002 | SM-3 | ✅ Template | [`../../../security_process_templates/KX-DDC24-SEC-RPT-002_VI.md`](../../../security_process_templates/KX-DDC24-SEC-RPT-002_VI.md) |
| Secure Coding Compliance Report | KX-DDC24-SEC-RPT-003 | SM-4 | ✅ Template | [`../../../security_process_templates/KX-DDC24-SEC-RPT-003_VI.md`](../../../security_process_templates/KX-DDC24-SEC-RPT-003_VI.md) |
| Security Test Plan | KX-DDC24-TST-PLAN-001 | SM-5 | ✅ Template | [`../../../security_process_templates/KX-DDC24-TST-PLAN-001_VI.md`](../../../security_process_templates/KX-DDC24-TST-PLAN-001_VI.md) |
| Vulnerability & Patch Mgmt Procedure | KX-DDC24-SEC-PLAN-001 | SM-6/7 | ✅ Template | [`../../../security_process_templates/KX-DDC24-SEC-PLAN-001_VI.md`](../../../security_process_templates/KX-DDC24-SEC-PLAN-001_VI.md) |
| Security Guideline | KX-DDC24-SEC-STD-001 | SM-8 | ✅ Template | [`../../../security_process_templates/KX-DDC24-SEC-STD-001_VI.md`](../../../security_process_templates/KX-DDC24-SEC-STD-001_VI.md) |
| Supplier Security Assessment | KX-DDC24-SEC-RPT-004 | SM-9 | ✅ Template | [`../../../security_process_templates/KX-DDC24-SEC-RPT-004_VI.md`](../../../security_process_templates/KX-DDC24-SEC-RPT-004_VI.md) |
| Internal Security Audit Checklist | KX-DDC24-SEC-RPT-005 | SM-10 | ✅ Template | [`../../../security_process_templates/KX-DDC24-SEC-RPT-005_VI.md`](../../../security_process_templates/KX-DDC24-SEC-RPT-005_VI.md) |
| Secure Decommissioning Procedure | (template) | SM-11 | ✅ Template | [`../../../security_process_templates/`](../../security_process_templates/) |
| Security Training Matrix | (template) | SM-12 | ⏳ Month 2 | `03-training-evidence/` |
| Configuration Management Plan | KX-DDC24-SEC-PLAN-002 | SM-13 | ✅ Template | [`../../../security_process_templates/KX-DDC24-SEC-PLAN-002_VI.md`](../../../security_process_templates/KX-DDC24-SEC-PLAN-002_VI.md) |
| Security Requirements Baseline | IEC62443-M1-SRB-001 | SM-1 | ✅ Done | `01-process-evidence/03_SECURITY_REQUIREMENTS_BASELINE.md` |
| Threat Model — Initial Scoping | IEC62443-M1-TM-001 | SM-2 | ✅ Scoped | `02-technical-evidence/01_THREAT_MODEL_INITIAL.md` |
| Supplier Assessment — Initial | IEC62443-M1-SUP-001 | SM-9 | ✅ Initial | `02-technical-evidence/02_SUPPLIER_ASSESSMENT_INITIAL.md` |
| Security Design Evidence | IEC62443-M1-DESIGN-001 | SM-3 | ✅ Compiled | `02-technical-evidence/03_SECURITY_DESIGN_EVIDENCE.md` |
| Training Record | IEC62443-M1-TRAIN-001 | SM-12 | ✅ Done | `03-training-evidence/01_TRAINING_RECORD.md` |
| Training Materials | IEC62443-M1-TRAIN-002 | SM-12 | ✅ Done | `03-training-evidence/02_TRAINING_MATERIALS.md` |
| Progress Report Month 1 | IEC62443-M1-PROGRESS-001 | All | ✅ Done | `04-progress-report/01_PROGRESS_REPORT.md` |
| Risk Register | IEC62443-M1-RISK-001 | All | ✅ Done | `04-progress-report/02_RISK_REGISTER.md` |
| Month 2 Plan | IEC62443-M1-PLAN-001 | All | ✅ Done | `04-progress-report/03_MONTH2_PLAN.md` |

## Tài liệu tham khảo

| Document | Location |
|----------|----------|
| PRD — Product Requirements | [`../../../../PRD_MK-DDC-24_VI.md`](../../../../01_specs/PRD_MK-DDC-24_VI.md) |
| SRS — System Requirements | [`../../../../SRS_MK-DDC-24_VI.md`](../../../../01_specs/SRS_MK-DDC-24_VI.md) |
| Implementation Plan | [`../../../KX-DDC24-PM-IMPLPLAN-001_VI.md`](../../../KX-DDC24-PM-IMPLPLAN-001_VI.md) |
| Trace Matrix | [`../../../KX-DDC24-QA-TRACE-001_VI.md`](../../../KX-DDC24-QA-TRACE-001_VI.md) |
| QA Register | [`../../../KX-DDC24-QA-REGISTER-001_VI.md`](../../../KX-DDC24-QA-REGISTER-001_VI.md) |
| Project Goals | [`../../../KX-DDC24-PM-GOAL-001_VI.md`](../../../KX-DDC24-PM-GOAL-001_VI.md) |
| PM Market Analysis | [`../../../KX-DDC24-PM-MARKET-001_VI.md`](../../../KX-DDC24-PM-MARKET-001_VI.md) |
| Security Design | [`../../../../design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md`](../../../../02_design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md) |
| OTA Design | [`../../../../design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md`](../../../../02_design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md) |
| Open Issues | [`../../../../spec/OPEN_ISSUES_MK-DDC-24_VI.md`](../../../../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md) |

---

*Prepared for internal audit — IEC 62443-4-1 Month 1 review.*
