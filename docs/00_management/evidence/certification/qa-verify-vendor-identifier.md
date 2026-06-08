# QA Verification Report: Vendor_Identifier Consistency

> **Issue:** IOT-5659 | **Taxonomy:** QA-CONF-VENDOR-ID
> **Owner:** QAReviewer | **Date:** 2026-06-02
> **Status:** ❌ BLOCKED
> **Depends on:** IOT-5622 (ASHRAE registration) → IOT-5657 (PICS update) → IOT-5658 (firmware update)

---

## 1. Dependency Chain Status

| Gate | Issue | Description | Status | ETA |
|------|-------|-------------|--------|-----|
| G0 | IOT-6049 | CEO gửi thư đăng ký ASHRAE BACnet Vendor ID và cung cấp evidence | ❌ BLOCKED — CEO action required | Unknown |
| G1 | IOT-5622 | Register ASHRAE BACnet Vendor ID | ❌ BLOCKED — depends on IOT-6049 | Unknown |
| G2 | IOT-5657 | Cập nhật PICS §7 với Vendor_Identifier | ❌ BLOCKED — depends on IOT-5622 | Unknown |
| G3 | IOT-5658 | Định nghĩa Vendor_ID trong firmware device.c | ❌ BLOCKED — depends on IOT-5622 | Unknown |
| G4 | IOT-5659 | QA verify PICS + firmware build | ❌ BLOCKED — depends on IOT-5657 + IOT-5658 | Unknown |

## 2. Current Baseline (pre-update evidence)

### 2.1 PICS §7 — Device Object Values

Source: `design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md` line 83

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

**QA Status:** ❌ BLOCKED

IOT-5659 is blocked upstream. Recommend:
1. CEO complete IOT-6049: send ASHRAE BACnet Vendor ID registration request and attach assigned-ID evidence
2. After IOT-6049 done → IOT-5622 can close with assigned Vendor ID evidence
3. After IOT-5622 done → TechLead execute IOT-5657 (PICS update)
4. After IOT-5622 done → DeveloperTeam execute IOT-5658 (firmware update)
5. After IOT-5657 and IOT-5658 done → QAReviewer execute IOT-5659 verification

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

### 2026-06-02T11:14 UTC (Run 3 — liveness continuation)

**Assessment:** Still BLOCKED. No upstream change. Server stack test revealed Bind interface issue (LAN `192.168.1.200` only, not loopback) — runtime YABE verification will require same-subnet client.

**New artifact:**
- `verify-vendor-id-runtime.sh` — runtime script: starts server, sends Who-Is, reads Vendor_Identifier via readprop, compares vs PICS + config.h. Run with `bash docs/00_management/evidence/certification/verify-vendor-id-runtime.sh [timeout_secs]`

**Runtime check result:** Server binary (`build/server`) exits 144 when backgrounded via bash harness, binds to non-loopback interface only. BACnet `readprop` and `whois` tools cannot complete exchange in this environment. Source-level verification complete.

**Block unchanged:** CEO → IOT-5622 → TechLead → IOT-5657 → DeveloperTeam → IOT-5658 → QAReviewer IOT-5659

---

### 2026-06-03T14:50 UTC (Run 4 — stall alert response)

**Assessment:** ≥24h no activity confirmed. Still BLOCKED. No upstream change detected.
- PICS §7: still TBD (line 102)
- config.h: still `BACNET_VENDOR_ID 260` (placeholder)
- No new commits or file changes touching Vendor_Identifier

**Response to auto-stall alert:**
Issue genuinely blocked — no QA action possible until IOT-5622 resolves.
Suggest: close IOT-5659 as `blocked` or escalate IOT-5622 to CEO.

**Block (day 3):** CEO → IOT-5622 → TechLead → IOT-5657 → DeveloperTeam → IOT-5658 → QAReviewer IOT-5659

---

### 2026-06-05T17:45 UTC (Run 5 — auto-stall response)

**Assessment:** Auto-stall acknowledged. QA deliverable remains BLOCKED; no release approval possible.

**Current board evidence:**
| Issue | Status | Evidence |
|-------|--------|----------|
| IOT-6049 | ❌ BLOCKED | Terminal blocker for ASHRAE Vendor ID evidence |
| IOT-5622 | ❌ BLOCKED | Blocks IOT-5657 and IOT-5658; depends on IOT-6049 |
| IOT-5657 | ❌ BLOCKED | PICS update still blocked by IOT-5622 |
| IOT-5658 | ❌ BLOCKED | Firmware update still blocked by IOT-5622 |

**Current repo evidence:**
| Check | Result | Detail |
|-------|--------|--------|
| PICS §7 Vendor_Identifier | ❌ TBD | `design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md:83` = `<đăng ký ASHRAE — TBD>` |
| Firmware compile definition | ❌ 0 placeholder | `fw/bacnet/CMakeLists.txt:63` and `fw/bacnet/CMakeLists.txt:96` set `BACNET_VENDOR_ID=0` |
| Firmware runtime default | ❌ 0 placeholder | `fw/bacnet/include/kinexus/kx_device_config.h:26` sets `KX_VENDOR_ID_DEFAULT 0`; `fw/bacnet/src/kx_device_config.c:16` applies it |

**Unblock owner/action:** CEO / IOT-6049 must provide assigned ASHRAE BACnet Vendor ID evidence. Then IOT-5622, IOT-5657, and IOT-5658 must complete before QA can run PICS-vs-firmware runtime verification.

**QA result:** Blocked.

---

### 2026-06-05T18:36 UTC (Run 6 — timeout recovery)

**Assessment:** Run trước timeout nhưng không có evidence mới bị mất. QA deliverable vẫn BLOCKED; issue state cần chuyển sang `blocked` và gắn `blockedByIssueIds` để Paperclip auto-wake khi upstream xong.

**Dependency readback:**
| Issue | Status | Evidence |
|-------|--------|----------|
| IOT-6049 | ❌ BLOCKED | CEO phải gửi ASHRAE BACnet Vendor ID registration request và cung cấp assigned-ID evidence |
| IOT-5622 | ❌ BLOCKED | Parent gate của IOT-5659; chưa có ASHRAE Vendor ID để PICS/firmware dùng |

**Repo evidence re-verified:**
| Check | Result | Detail |
|-------|--------|--------|
| PICS §7 Vendor_Identifier | ❌ TBD | `design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md:83` = `<đăng ký ASHRAE — TBD>` |
| Firmware compile definition | ❌ 0 placeholder | `fw/bacnet/CMakeLists.txt:63` and `fw/bacnet/CMakeLists.txt:96` set `BACNET_VENDOR_ID=0` |
| Firmware runtime default | ❌ 0 placeholder | `fw/bacnet/include/kinexus/kx_device_config.h:26` sets `KX_VENDOR_ID_DEFAULT 0`; `fw/bacnet/src/kx_device_config.c:16` applies it |

**QA result:** Blocked.

**Unblock owner/action:** CEO completes IOT-6049 with assigned ASHRAE BACnet Vendor ID evidence; assignee for IOT-5622 then closes registration gate and downstream PICS/firmware updates before QA reruns PICS-vs-firmware/YABE verification.

---

**Rev** 1.5 | 2026-06-05 · QAReviewer (timeout recovery)
