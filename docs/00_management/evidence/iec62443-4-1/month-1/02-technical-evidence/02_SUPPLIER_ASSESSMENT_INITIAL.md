# Technical Evidence: Supplier Security Assessment — Initial

> **Document ID:** IEC62443-M1-SUP-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Initial assessment — template ready, formal assessment pending procurement
> **Owner:** Tech Lead + Procurement
> **Chuẩn:** IEC 62443-4-1 SM-9
> **Template:** [KX-DDC24-SEC-RPT-004](../../../../security_process_templates/KX-DDC24-SEC-RPT-004_VI.md)

---

## 1. Supplier Identification

| Supplier | Component | Risk | Type | Source |
|----------|-----------|:----:|------|--------|
| Radxa | CM3 SOM (Rockchip RK3566) | 🔴 Cao | Hardware | Single-source, extended-temp unknown (HW-Q-002) |
| Texas Instruments (TI) | ADS131M08, DAC8554, ISO3088 | 🟡 Trung bình | Hardware | Single-source ADC, DAC có fallback |
| Maxim Integrated | MAX13487E, DS3231SN | 🟢 Thấp | Hardware | Multiple sources |
| Debian Project | OS base image | 🟢 Thấp | OSS | Mature, active maintenance |
| Various OSS | Libraries (Python, Node.js, etc.) | 🟡 Trung bình | OSS | Covers multiple packages |
| OTA hosting (TBD) | OTA server + CDN | 🟡 Trung bình | Cloud | Not yet selected |

## 2. Hardware Supplier Assessment

### Radxa CM3 (Single-source critical)

| Criteria | Assessment | Evidence | Status |
|----------|-----------|----------|:------:|
| Secure boot capability | Rockchip RK3566 supports secure boot | Datasheet | ✅ |
| Lifecycle commitment (min 5yr) | Not yet confirmed | Need formal RFQ | ⏳ |
| EOL notification policy | Not yet confirmed | Need formal RFQ | ⏳ |
| Extended temp availability | HW-Q-002 — not confirmed | Radxa inquiry pending | 🔴 |
| Known CVEs | No public CVEs on CM3 itself | NVD search | ✅ |

**Risk:** 🔴 Cao — single source, extended temp uncertainty, no formal RFQ yet
**Mitigation:** Đánh giá SOM thay thế (ROC RK3588, NXP i.MX8M) trước GA

### Texas Instruments (TI)

| Criteria | Assessment | Evidence | Status |
|----------|-----------|----------|:------:|
| Secure boot capability | N/A (components, not SoC) | — | N/A |
| Lifecycle commitment | TI standard: min 10yr for industrial | TI policy | ✅ |
| Known CVEs | ADS131M08: 0, DAC8554: 0 | NVD search | ✅ |
| Supply risk | Single-source ADC, medium | Datasheet | 🟡 |

**Risk:** 🟡 Trung bình — single source ADC (ADS131M08), but DAC có fallback

## 3. OSS / Dependency Assessment

| Criteria | Assessment | Evidence | Status |
|----------|-----------|----------|:------:|
| SBOM generation | Infrastructure in place (gen-sbom) | CI pipeline design | ✅ |
| License compliance | OSS libraries standard licenses | PRD/SRS review | ✅ |
| CVE tracking | CI scan configured (trivy/grype) | CI security.yml | ✅ |
| Dependency provenance | GitHub/GitLab source, signed tags where available | Repo audit | 🟡 |

## 4. Cloud Service Provider (TBD)

Chưa chọn OTA hosting provider. Assessment sẽ được thực hiện trong Month 2 sau khi chọn vendor.

## 5. Overall Risk Summary

| Supplier | Risk Rating | Key Issue | Action Required | Deadline |
|----------|:-----------:|-----------|-----------------|---------|
| Radxa CM3 | 🔴 Cao | Extended temp (HW-Q-002), single source, no formal RFQ | Confirm extended temp, formal RFQ | Month 2 |
| TI | 🟡 Trung bình | Single source ADC | Volume commitment, buffer stock | Month 2 |
| OTA provider | 🟡 Trung bình | Not selected | Define requirements, evaluate vendors | Month 2 |
| Debian/OSS | 🟢 Thấp | Standard OSS risk | SBOM + CVE monitoring | Ongoing |

## 6. References

- Supplier template: [`KX-DDC24-SEC-RPT-004`](../../../../security_process_templates/KX-DDC24-SEC-RPT-004_VI.md)
- Supply chain risk: [`KX-DDC24-PM-MARKET-001 §5`](../../../../KX-DDC24-PM-MARKET-001_VI.md)
- BOM/RFQ evidence: [`docs/00_management/evidence/bom-rfq/`](../../bom-rfq/)
- HW-Q-002: [`spec/OPEN_ISSUES_MK-DDC-24_VI.md`](../../../../../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md)
