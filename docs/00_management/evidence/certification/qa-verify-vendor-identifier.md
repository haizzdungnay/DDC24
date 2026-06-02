# QA Verification Report: Vendor_Identifier Consistency

> **Issue:** IOT-5659 | **Taxonomy:** QA-CONF-VENDOR-ID
> **Owner:** QAReviewer | **Date:** 2026-06-02
> **Status:** ❌ BLOCKED
> **Depends on:** IOT-5622 (ASHRAE registration) → IOT-5657 (PICS update) → IOT-5658 (firmware update)

---

## 1. Dependency Chain Status

| Gate | Issue | Description | Status | ETA |
|------|-------|-------------|--------|-----|
| G1 | IOT-5622 | Register ASHRAE BACnet Vendor ID | ❌ BLOCKED — chờ CEO sign + gửi letter | Unknown |
| G2 | IOT-5657 | Cập nhật PICS §7 với Vendor_Identifier | ❌ BLOCKED — depends on IOT-5622 | Unknown |
| G3 | IOT-5658 | Định nghĩa Vendor_ID trong firmware device.c | ❌ BLOCKED — depends on IOT-5622 | Unknown |
| G4 | IOT-5659 | QA verify PICS + firmware build | ❌ BLOCKED — depends on IOT-5657 + IOT-5658 | Unknown |

## 2. Current Baseline (pre-update evidence)

### 2.1 PICS §7 — Device Object Values

Source: `design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md` line 102

| Property | Current Value | Required |
|----------|---------------|----------|
| Vendor_Name | KINEXUS Technologies | OK (correct company name) |
| Vendor_Identifier | `<đăng ký ASHRAE — TBD>` | ❌ TBD — needs real ASHRAE-assigned ID |
| Model_Name | MK-DDC-24 | OK |

### 2.2 Firmware — device.c

Source: `repo/bacnet/src/bacnet/basic/object/device.c` lines 577-579

| Variable | Current Value | File |
|----------|---------------|------|
| `Vendor_Name` | `BACNET_VENDOR_NAME` | device.c:577 |
| `Vendor_Identifier` | `BACNET_VENDOR_ID` (uint16) | device.c:578 |

### 2.3 Firmware — config.h

Source: `repo/bacnet/src/bacnet/config.h` lines 60-61

```c
#if !defined(BACNET_VENDOR_ID)
#define BACNET_VENDOR_ID 260
```

**Note:** Value 260 is the **bacnet-stack default/placeholder**, not a real ASHRAE-assigned ID.

### 2.4 Runtime Verification (server binary)

**Binary:** `repo/bacnet/build/server`
- `strings` output shows no "KINEXUS" string — still using default vendor name "GNU"
- Vendor_Identifier in Device Object response: **not yet verifiable** — server binary would report 260 (placeholder)

## 3. Verification Procedure (ready to execute when unblocked)

### 3.1 Source-level check

| Check | Expected | Acceptance |
|-------|----------|------------|
| PICS §7 Vendor_Identifier | != "TBD" | Actual ASHRAE number |
| `config.h` BACNET_VENDOR_ID | != 260 | Actual ASHRAE number |
| `device.c` Vendor_Name | "KINEXUS Technologies" | Match company legal name |

### 3.2 Build-time check

```bash
# Verify the compiled binary contains the correct Vendor ID
strings build/server | grep "KINEXUS"
# Expected: "KINEXUS Technologies"

# Verify the compiled constant
# Method 1: nm + objdump to check Vendor_Identifier value
# Method 2: Direct BACnet read via YABE
```

### 3.3 Runtime check (YABE / BACnet browser)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start server | Device object responds |
| 2 | Read `Device.Vendor_Identifier` | Matches PICS §7 |
| 3 | Read `Device.Vendor_Name` | "KINEXUS Technologies" |
| 4 | Compare PICS vs runtime | No mismatch |

## 4. QA Sign-off Criteria

- [ ] PICS §7 Vendor_Identifier != TBD
- [ ] `config.h` BACNET_VENDOR_ID != 260
- [ ] `strings build/server` contains "KINEXUS"
- [ ] YABE read matches PICS
- [ ] Zero mismatch between PICS and firmware response

## 5. Recommendation

**QA Status:** ❌ CHANGES REQUESTED (not actionable — dependencies not met)

IOT-5659 is blocked upstream. Recommend:
1. CEO complete IOT-5622: sign and send ASHRAE vendor ID request
2. After IOT-5622 done → TechLead execute IOT-5657 (PICS update)
3. After IOT-5657 done → DeveloperTeam execute IOT-5658 (firmware update)
4. Before IOT-5658 done, reassign IOT-5659 back to QAReviewer for verification

This verification report is prepared with pre-update baseline evidence so that when the issue is unblocked, the delta is clear.

---

## 6. Heartbeat Log

### 2026-06-02T11:11 UTC (Run 2 — liveness continuation)

**Assessment:** Still BLOCKED. No upstream change detected since run 1.

**Baseline re-verified:**
| Check | Result | Detail |
|-------|--------|--------|
| PICS §7 Vendor_Identifier | ❌ TBD | `<đăng ký ASHRAE — TBD>` |
| config.h BACNET_VENDOR_ID | ❌ 260 (placeholder) | Not a real ASHRAE ID |
| device.c Vendor_Name | ❌ `BACNET_VENDOR_NAME` (macro) | Expands to default, not KINEXUS |
| Binary strings KINEXUS | ❌ Not found | server binary still default |

**New artifact:**
- `verify-vendor-id.sh` — automated verification script; run with `bash docs/00_management/evidence/certification/verify-vendor-id.sh`

**Block unchanged:** CEO → IOT-5622 → TechLead → IOT-5657 → DeveloperTeam → IOT-5658 → QAReviewer IOT-5659

---

**Rev** 1.1 | 2026-06-02 · QAReviewer (heartbeat 2)
