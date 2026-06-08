# BACnet Pre-Test Tool Acquisition — Shortlist & Execution Inputs

> **Issue:** IOT-5475 | **Taxonomy:** QA-CONF-BACNET-PRETEST
> **Owner:** DeveloperTeam | **Date:** 2026-06-02
> **Input:** PM-MARKET-001 v1.1, SW-REQ v1.1, OPEN-ISSUES v1.0
> **Ref:** btl-lab-candidate-analysis.md (IOT-5465) · SW-Q-001 · ASM-006 · DEC-006
> **Output scope:** Pre-test tool shortlist, acquisition path, bacnet-stack repo reference, lab config assumptions

---

## 1. BTL Pre-Test Tool Landscape

### 1.1 Official BTL Test Package

The BTL Working Group publishes the **BTL Test Package** (current: v26.1-v2, Nov 2025) at `btl.org/testing-documentation/`. This contains:

| Document | Purpose |
|----------|---------|
| BTL Functionality Checklist | Self-assessment identifying which BACnet features the IUT implements |
| BTL Test Plan | Maps checklist items to executable tests |
| BTL Manual Testing | Manual procedures where automation does not apply |
| BTL Specified Tests | Additional tests beyond ASHRAE 135.1 |
| BTL Testing Guide | Walkthrough for applying the test suite |
| IUT Special Test Instructions | Form to explain device setup to the tester |

**Important:** The BTL Test Package is documentation + procedures, **not** an automated test execution tool. To actually run the tests automatically, you need either:
- A commercial pre-test tool (BTS, BOTS, BTF) — for internal development pre-test
- An RBTO's test tool (CTT) — only at accredited labs during formal testing

The **official BTL CTT (Conformance Test Tool)** is proprietary to the BTL program and distributed to RBTOs only. Manufacturers cannot directly purchase or download it.

### 1.2 Shortlisted Pre-Test Tools

| Tool | Vendor | Type | Price | BTL Relevance | Recommendation |
|------|--------|------|-------|---------------|:--------------:|
| **BACnet Test Suite (BTS)** | [bac-test.com](https://bac-test.com) | Commercial (subscription) | $195/mo or $2,300/yr | Direct pre-test use, "catch issues before BTL submission" | **🥇 Primary** |
| **BACnet OEM Test Shell (BOTS)** | [PolarSoft](https://polarsoft.com/bots.asp) | Commercial (annual) | $2,000/yr single user | Regression tests based on 135.1 + BTL additional tests; 35% discount for BACnet Intl members | **🥈 Secondary** |
| **BACnet Test Framework (BTF)** | [MBS Solutions](https://mbs-solutions.de/btf) | Commercial (rental) | Quote; some editions free/discounted for BACnet Intl members | Used by all accredited labs since 2005; 370+ API functions; has LE/SE/PR editions | **🥉 Tertiary** |
| **Visual Test Shell (VTS)** | SourceForge | Open source | Free | Legacy tool, no longer maintained; basic testing only | ❌ Not recommended |

### 1.3 Free / Open Source Tools (For Basic Verification Only)

| Tool | URL | Purpose | Limitation |
|------|-----|---------|------------|
| **YABE** | sourceforge.net (Yet Another BACnet Explorer) | Browse/read BACnet devices | No conformance testing |
| **Wireshark** | wireshark.org | BACnet/IP packet capture and analysis | Manual only, no automated test |
| **CAS BACnet examples** | github.com/chipkin | Server/client example code | Development reference, not test tool |
| **BACnet Stack unit tests** | Built into bacnet-stack | `make test` — basic stack unit tests | Covers low-level protocol only, not BTL conformance |
| **PicoScope 2204** | picotech.com | Oscilloscope for MS/TP timing (not needed for IP-only) | Hardware purchase |

> **Filtered out:** BACbeat, BACeye, BACnet Explorer XML, BOSS Explorer, CAS BACnet Explorer — these are client/explorer tools, not conformance test tools. They can verify basic BACnet communication but cannot replace a BTL pre-test tool.

---

## 2. Detailed Candidate Profiles

### 2.1 BACnet Test Suite (BTS) — 🥇 Primary Recommendation

| Attribute | Detail |
|-----------|--------|
| **Vendor** | BACnet Interoperability Testing Services, Inc. — bac-test.com |
| **Description** | Automated BACnet device test tool covering all objects, properties, services |
| **BTL relevance** | Explicitly positioned for pre-BTL validation |
| **License model** | Single-seat subscription |
| **Pricing** | **$195/month** or **$2,300/year** |
| **Free trial** | 3-week demo available |
| **Contact** | `info@bac-test.com` · (650) 305-1395 (Edward Hague) |
| **Platform** | Windows (setup-and-run) |
| **Discount available** | 50% off if BACnet International member (per BTL WG page) |
| **Covers B-BC profile?** | Yes — all BACnet objects, properties, services included |
| **Vendor track record** | Strong; Edward Hague is contributor to BTL WG |

**Advantages:**
- Low entry cost ($195) with monthly option; no long-term commitment
- 3-week free trial to evaluate before purchase
- 50% BACnet International member discount (if enrolled)
- Designed for pre-BTL use — helps catch issues before formal submission
- Simplest setup among all candidates (subscription, no custom scripting required)

**Disadvantages:**
- Single-user license — only one engineer can test at a time
- Windows-only (VMs or Wine needed for Linux environment)
- Unknown coverage depth vs BTL test package (not a certified replacement for RBTO)

### 2.2 BACnet OEM Test Shell (BOTS) — 🥈 Secondary Recommendation

| Attribute | Detail |
|-----------|--------|
| **Vendor** | PolarSoft Inc., Pittsburgh, PA USA |
| **Description** | Automated BACnet regression testing tool for Windows |
| **BTL relevance** | Tests based on 135.1 + BTL additional tests + PolarSoft own tests |
| **License model** | Single-user annual subscription or site license |
| **Pricing** | **$2,000/year** single user (site license available) |
| **Contact** | `info@polarsoft.com` · +1 412 683 2018 |
| **Discount available** | 35% off for BACnet International members; "Special Pricing" agreements with large companies |
| **Platform** | Windows 7/10/11, Server 2012, 32/64-bit |
| **Target user** | OEM/device manufacturers doing regression testing during development |

**Advantages:**
- BTL-specific test coverage (135.1 + BTL additional tests)
- Lower annual cost than BTS annual ($2,000 vs $2,300)
- Site license available for teams
- 35% BACnet International member discount

**Disadvantages:**
- Higher upfront ($2,000/yr) vs BTS monthly ($195/mo)
- No free trial mentioned
- Windows only; no monthly subscription option
- Fewer pricing details publicly available

### 2.3 BACnet Test Framework (BTF) — 🥉 Tertiary Recommendation

| Attribute | Detail |
|-----------|--------|
| **Vendor** | MBS GmbH, Krefeld, Germany (also an accredited RBTO) |
| **Description** | Script-based automated pre-certification test tool; used by all RBTOs since 2005 |
| **BTL relevance** | **Highest** — this is the tool used internally by RBTOs; test scripts map directly to BTL requirements |
| **License model** | Monthly rental (editions: Light LE, Standard SE, Premium PR) |
| **Pricing** | Quote required; complimentary/discounted for BACnet Intl corporate members |
| **Contact** | `vertrieb@mbs-software.de` · `testlabor@mbs-solutions.de` · +49 2151 7294-0 |
| **Platform** | Windows + Python scripting (370+ API functions) |
| **CI support** | Yes — can integrate with continuous integration pipelines |

**Advantages:**
- **Used by RBTOs** — test scripts are the same ones used in formal certification
- Most comprehensive (370+ BACnet API functions, custom script creation)
- Pay-per-use rental model (cost only when actively testing)
- Python-based scripting for custom tests
- CI/CD integration possible

**Disadvantages:**
- No public pricing — must request quote
- Requires Python scripting skills — not turnkey
- Overkill for initial development pre-test phases
- MBS is also an RBTO (potential conflict of interest perception)
- German vendor — support in English available but timezones (+6h from VN)

---

## 3. Tool Selection Matrix

| Criteria | BTS | BOTS | BTF |
|----------|:---:|:----:|:---:|
| BTL pre-test relevance | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Entry cost | ⭐⭐⭐⭐⭐ ($195/mo) | ⭐⭐⭐ ($2k/yr) | ⭐⭐ (quote) |
| Ease of setup | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| BACnet Intl discount | 50% | 35% | Complimentary tiers |
| Custom scripting | ❌ | ✅ | ✅ (Python) |
| CI integration | ❌ | ❌ | ✅ |
| Free trial | ✅ 3 weeks | ❌ | ❌ |
| Regression testing | Basic | ✅ | ✅ |

### Recommendation Phasing

| Phase | Tool | Rationale |
|:-----:|------|-----------|
| **Sprint 1** | **BTS** | Start with 3-week free trial + 1 month $195. Validate B-BC basic conformance. Low risk/commitment. |
| **Sprint 2–3** | **BOTS or BTS annual** | After BACnet Intl membership (for discount) + initial BTS validation. BOTS $1,300/yr (after 35% discount) or BTS $1,150/yr (after 50% discount). |
| **Pre-certification** | **BTF** | If custom test scenarios needed or insufficient coverage from BTS/BOTS. Request quote Sprint 2 to evaluate. |

---

## 4. bacnet-stack Repository Reference

| Item | Detail |
|------|--------|
| **Upstream URL** | [https://github.com/bacnet-stack/bacnet-stack](https://github.com/bacnet-stack/bacnet-stack) |
| **Version** | 1.3.x (per SW_ARCH §7, SW_BACNET_DESIGN §2) |
| **Local clone** | ❌ Not yet cloned in workspace. Clone path per BE-DEVGUIDE: `git clone https://github.com/bacnet-stack/bacnet-stack` |
| **Local target** | `repo/bacnet/` (per REPO-001 directory tree) |
| **Unit tests** | `make test` or `cmake + ctest` — basic protocol unit tests |
| **BTL history** | Stack has been used in BTL-certified products (per SourceForge discussion) |
| **Assumption risk** | ASM-006: "bacnet-stack 1.3.x pass BTL cho device profile này" — BTL fail risk exists, conformance pre-test required |
| **SW design doc** | `design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md` |
| **PICS/EPICS** | `design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md` |
| **Author** | Steve Karg (`skarg@users.sourceforge.net`) — active in BTL community |

**Action:** Clone `bacnet-stack` v1.3.x into `repo/bacnet/` and run `make test` to verify baseline. Also fork or mirror to Kinexus-controlled GitHub for build reproducibility.

---

## 5. Lab Configuration Assumptions for Pre-Testing

For running BACnet pre-tests (with BTS or BOTS), the following lab config is assumed:

### 5.1 Hardware Setup

| Component | Requirement | Note |
|-----------|-------------|------|
| **DDC device under test** | 1× MK-DDC-24 prototype (or dev board with same BACnet stack) | Running `kinexus-bacnet` service with B-BC profile |
| **Test host PC** | Windows 10/11 (for BTS/BOTS) | VM acceptable if dedicated NIC |
| **Network** | Dedicated Ethernet switch (managed or unmanaged) | Isolated LAN; no DHCP conflicts |
| **BACnet client tool** | BTS or BOTS on test host | Connects to DDC via BACnet/IP UDP/47808 |
| **Packet capture** | Wireshark on test host or mirror port | For manual debug of failing tests |
| **Optional: 2nd BACnet device** | Any BACnet/IP device or simulator | For interop testing (Who-Is/I-Am, COV) |

### 5.2 Network Configuration

| Parameter | Value | Note |
|-----------|-------|------|
| BACnet/IP port | UDP/47808 | Standard BACnet/IP (SW-BAC-001) |
| BBMD | Not required for direct LAN testing | Only needed when crossing IP subnets |
| Foreign Device | Not required for direct LAN testing | Only needed when behind NAT/firewall |
| DDC IP | Static 192.168.x.x | No DHCP for test stability |
| Test host IP | Same subnet | Must be reachable via UDP |

### 5.3 DDC Configuration Under Test

| Config | Expected | Verification |
|--------|----------|-------------|
| Device Object instance | 1–127 (DIP bootstrap) or custom per device.conf | SW-BAC-006 |
| BACnet objects | Per PICS/EPICS (AI×8, AO×4, AV×32, BI×8, BO×4, BV×16, MSV×8, TL×8, SC×8) | SW-BAC-003 |
| BIBBs | DM-DDB, DM-DOB, DM-DOC, DS-RP-A, DS-WP-A, DS-COV-A, AE-N-A, SCHED-I-A, TLOG-I-A | Per D-3 PICS |
| COV increment | Configured per AI/AO/AV | SW-BAC-004 |
| Who-Is response | ≤ 100ms | SW-BAC-005 |
| Protocol revision | PR 18 (BTL minimum through 2026) | btl.org |

### 5.4 Pre-Test Checklist Before Tool Purchase

1. ❏ Clone bacnet-stack 1.3.x, run `make test` — confirm basic stack health
2. ❏ Build `kinexus-bacnet` service, bring up on prototype
3. ❏ Verify DDC responds to Who-Is (use YABE or Wireshark)
4. ❏ Verify Read-Property for AI, AO, AV, BI, BO, BV from external BACnet client
5. ❏ **Then** subscribe BTS/BOTS and run BTL pre-test suite
6. ❏ Document failures per BTL B-BC profile
7. ❏ Resolve failures in stack/IUT, iterate pre-test
8. ❏ Submit to RBTO for formal certification

---

## 6. Acquisition Next Actions

| # | Action | Owner | Deadline | Est. Cost |
|---|--------|-------|----------|:---------:|
| 1 | Clone bacnet-stack 1.3.x into `repo/bacnet/` | SW Lead | Sprint 1 | $0 |
| 2 | Verify basic BACnet/IP communication with YABE/free tools | SW Lead | Sprint 1 | $0 |
| 3 | **Download BTS 3-week free trial** from bac-test.com | SW Lead + QA | Sprint 1 | $0 |
| 4 | Run BTS trial against prototype B-BC profile; record pass/fail | QA | Sprint 1 | $0 |
| 5 | Evaluate trial results — decide BTS monthly vs BOTS annual | SW Lead + PM | Sprint 2 start | $0 |
| 6 | Enroll BACnet International Silver Corporate membership (for tool discounts) | CEO | Sprint 1 | ~$2,000–3,000/yr |
| 7 | Purchase pre-test tool license (BTS $195/mo or BOTS $2,000/yr minus 35-50% discount) | PM | Sprint 2 | ~$100–2,000/yr |
| 8 | Download BTL Test Package 26.1-v2 from btl.org/testing-documentation/ | QA | Sprint 1 | $0 |
| 9 | Register on TBI Community Forum (bacnet.mycrowdwisdom.com) for developer Q&A | SW Lead | Sprint 1 | $0 |

### Current Blocker

> **Blocker:** bacnet-stack 1.3.x has not been cloned, built, or tested in the Kinexus workspace. Until basic stack functionality is verified and the BTS trial is run, the pre-test tool acquisition decision remains assumption-based. Specifically:
> - ASM-006 ("bacnet-stack 1.3.x pass BTL cho device profile này") is unvalidated
> - No `kinexus-bacnet` service exists yet to test against
> - BTS 3-week trial cannot produce meaningful results without a working IUT
>
> **Unblock action:** Complete SW implementation of `kinexus-bacnet` service (per SW_BACNET_DESIGN), then proceed with BTS trial.

---

## 7. Evidence Links

| Source | URL / Path |
|--------|------------|
| BTS product & pricing | `https://bac-test.com` |
| BTS pricing page | `https://www.bac-test.com/bts-pricing/` |
| BOTS product | `https://polarsoft.com/bots.asp` |
| BTF product (MBS GmbH) | `https://mbs-solutions.de/btf` |
| BTL Test Package v26.1-v2 | `https://btl.org/testing-documentation/` |
| BTL Pre-Testing Tools index | `https://btl.org/pre-testing-tools/` |
| BTL Device Testing process | `https://btl.org/device-testing/` |
| bacnet-stack upstream | `https://github.com/bacnet-stack/bacnet-stack` |
| bacnet-stack BTL discussion | `https://sourceforge.net/p/bacnet/discussion/402140/` |
| TBI Community Forum | `https://bacnet.mycrowdwisdom.com` |
| BTL Lab candidate analysis (existing) | `docs/00_management/evidence/certification/btl-lab-candidate-analysis.md` |
| BACnet design doc | `design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md` |
| PICS/EPICS | `design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md` |

---

## 8. Decisions Required

| # | Decision | Owner | Deadline | Impact |
|---|----------|-------|----------|--------|
| D1 | Approve BTS 3-week trial download + evaluation | SW Lead | Sprint 1 | Tool selection evidence |
| D2 | Authorize $195 BTS monthly subscription (if trial passes) | PM | Sprint 2 | Pre-test capability |
| D3 | Evaluate BOTS $2,000/yr as BTS alternative for long-term regression | SW Lead + PM | Sprint 2 | Budget optimization |
| D4 | Clone + fork bacnet-stack to Kinexus GitHub org | SW Lead | Sprint 1 | Build baseline |

---

## Appendix A: Summary of Free Options (No Budget Needed Now)

| Tool | What It Provides | Limitation |
|------|-----------------|------------|
| **BTL Test Package** | Full BTL test documentation, checklists, procedures | Manual process; no automation |
| **YABE** | Read/write BACnet objects, browse device | Functional test only; no conformance |
| **Wireshark** | Packet-level debug of BACnet/IP | Manual analysis; no pass/fail |
| **bacnet-stack `make test`** | Stack unit tests | Protocol level only |
| **TBI Community Forum** | Expert Q&A from BTL community | Not a tool |

---

> **Revision:** 1.0 | 2026-06-02
> **Next action:** SW Lead clones bacnet-stack. QA downloads BTS trial. Evaluate then purchase by Sprint 2.
