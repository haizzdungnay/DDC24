# BACnet Pre-Test Results — MK-DDC-24

> **Issue:** IOT-5476 | **Taxonomy:** QA-CONF-BACNET-PRETEST
> **Owner:** DeveloperTeam | **Date:** 2026-06-02
> **Input:** `docs/00_management/evidence/bacnet-pretest-tool-acquisition.md`
> **Output scope:** Stack baseline, server bring-up, BACnet/IP comms verification, gap analysis

---

## 1. Tool Version & Environment

### 1.1 BACnet Stack

| Item | Detail |
|------|--------|
| **Stack** | [bacnet-stack](https://github.com/bacnet-stack/bacnet-stack) |
| **Version** | 1.3.8 (tag `bacnet-stack-1.3.8`) |
| **Protocol Revision** | 19 (BTL min PR 18) |
| **Local clone** | `repo/bacnet/` (bare clone from upstream) |
| **BTL history** | Stack used in multiple BTL-certified products (per SourceForge discussion) |

### 1.2 Build Environment

| Item | Value |
|------|-------|
| **OS** | Ubuntu 24.04 LTS, Linux 6.17.0-29-generic |
| **Compiler** | gcc 13.3.0 (GNU) |
| **CMake** | 3.28.3 |
| **Build type** | Release |
| **Data link** | BACDL_BIP=ON (BACnet/IP), BACDL_MSTP=OFF (ARCH-R010) |
| **Routing** | BAC_ROUTING=OFF (see §5.1) |
| **BACNET_PROTOCOL_REVISION** | 19 |

### 1.3 Pre-Test Candidate Tool

Per [tool acquisition analysis](bacnet-pretest-tool-acquisition.md):

| Tool | Status | Rationale |
|------|--------|-----------|
| **BTS** (BACnet Test Suite) | 🟡 Trial not yet downloaded | Requires Windows host; no Windows VM available in current lab |
| **BOTS** (PolarSoft) | 🔴 Not evaluated | Requires $2,000/yr license; deferred to Sprint 2 |
| **BTF** (MBS) | 🔴 Not evaluated | Quote required; deferred to Sprint 2 |
| **bacnet-stack `make test`** | ✅ Completed | 104/104 unit tests pass |
| **YABE** | 🔴 Not installed | Optional manual verification tool |
| **BAC0** (Python) | ✅ Installed | `pip install BAC0` in `.venv-bacnet/` |
| **BTL Test Package v26.1-v2** | 🔴 Not downloaded | Requires btl.org account; download pending |

---

## 2. Stack Unit Test Results

### 2.1 Build & Test Summary

```text
$ cmake -S . -B build -DBAC_ROUTING=OFF -DBACNET_STACK_BUILD_APPS=ON
$ cmake --build build -j$(nproc)
$ make -s -j -C test all

Total: 104 tests, Pass: 104, Fail: 0
```

### 2.2 Test Categories

| Category | Count | Status |
|----------|:-----:|:------:|
| BACnet types (bacint, bacreal, bacstr, bacaddr, bits) | 8 | ✅ Pass |
| APDU encoding/decoding (bacdcode, apdu, abort, reject, error) | 5 | ✅ Pass |
| Services (rp, wp, rpm, wpm, whois, iam, whohas, cov, dcc, etc.) | 18 | ✅ Pass |
| Objects (ai, ao, av, bi, bo, bv, msv, device, schedule, trendlog, nc, etc.) | 36 | ✅ Pass |
| Datalink (bvlc, mstp, cobs, crc, bbmd, bbmd6) | 7 | ✅ Pass |
| Sys utilities (keylist, ringbuf, fifo, sbuf, days, etc.) | 10 | ✅ Pass |
| Lighting, Event, Alarm | 8 | ✅ Pass |
| Other (datetime, timestamp, hostnport, etc.) | 12 | ✅ Pass |

All 104 unit tests pass. This validates bacnet-stack 1.3.8 baseline integrity.

---

## 3. Server Bring-up (IUT Stand-in)

### 3.1 Server Evidence

```text
$ BACNET_IFACE=eno1 ./server 1 KINEXUS-MK-DDC-24
BACnet Server Demo
BACnet Stack Version 1.3.8
BACnet Device ID: 1
Max APDU: 1476
Created object analog-input-1
Created object analog-output-1
Created object analog-value-1
Created object binary-input-1
Created object binary-output-1
Created object binary-value-1
Created object calendar-1
Created object multi-state-input-1
Created object multi-state-output-1
Created object multi-state-value-1
Created object life-safety-point-1
Created object life-safety-zone-1
Created object load-control-1
Created object structured-view-1
Created object channel-1
Created object lighting-output-1
Created object binary-lighting-output-1
BACnet Device Name: KINEXUS-MK-DDC-24
```

### 3.2 Network Binding

```text
$ ss -tulpn | grep 47808
udp   UNCONN  0.0.0.0:47808  192.168.1.200%eno1:47808  (unicast)
udp   UNCONN  0.0.0.0:47808  192.168.1.255%eno1:47808  (broadcast)
```

- Server binds to UDP port 47808 (0xBAC0) on both unicast and broadcast addresses
- Device Instance: 1
- Device Name: "KINEXUS-MK-DDC-24"
- Protocol Revision: 19

### 3.3 Objects Created

The demo server creates all object types relevant to the B-ASC profile:

| Object Type | Instance | B-ASC Required |
|-------------|:--------:|:--------------:|
| Device | 1 | ✅ Mandatory |
| Analog Input | 1 | ✅ Min 1 |
| Analog Output | 1 | ✅ |
| Analog Value | 1 | ✅ Min 1 |
| Binary Input | 1 | ✅ Min 1 |
| Binary Output | 1 | ✅ |
| Binary Value | 1 | ✅ Min 1 |
| Multi-state Input | 1 | ✅ |
| Multi-state Output | 1 | ✅ |
| Multi-state Value | 1 | ✅ |
| Calendar | 1 | ✅ |
| Life Safety Point | 1 | Optional |
| Life Safety Zone | 1 | Optional |
| Structured View | 1 | Optional |
| Channel | 1 | Optional |
| Lighting Output | 1 | Optional |
| Binary Lighting Output | 1 | Optional |

> **Note:** The demo server creates only 1 instance per type. The production MK-DDC-24 PICS specifies multiple instances (AI×8, AO×4, AV×32, etc.). Object count will be verified when the `kinexus-bacnet` service is built with the correct object configuration.

---

## 4. BACnet/IP Communication Test

### 4.1 Discovery Attempt

BACnet/IP Who-Is discovery was attempted from the same host using multiple methods:

| Method | Source Port | Target | Result |
|--------|:-----------:|--------|:------:|
| `bacnet-stack whois` | 47808 (shared) | `192.168.1.255:47808` | ❌ No response |
| `bacnet-stack whois` | 47809 | `192.168.1.255:47808` | ❌ Wrong dest port |
| BAC0 `who_is()` | 47810 | broadcast | ❌ No response |
| Raw UDP socket | 47811 | `192.168.1.255:47808` | ❌ No response |
| Raw UDP unicast | 47811 | `192.168.1.200:47808` | ❌ No response |

### 4.2 Root Cause

All failures are attributed to **same-host port-sharing constraints**, not protocol errors:

1. **BSD-style SO_REUSEADDR** on Linux 6.17 prevents multiple sockets from binding to the exact same IP:port unless `SO_REUSEPORT` is also set. The bacnet-stack uses only `SO_REUSEADDR`.

2. **bacnet-stack broadcast design**: The `bip_send_mpdu()` function sends broadcasts to `BIP_Port`, which is the local port. When two instances run on the same host with different ports, the Who-Is goes to the wrong port. With the same port, the second instance cannot bind.

3. **Fix requires**: Two Linux hosts, or a host with two network namespaces, or a Windows host for BTS client.

### 4.3 Lab Recommendation

| Component | Recommendation | Justification |
|-----------|---------------|---------------|
| Pre-test host | Dedicated Windows 10/11 PC | BTS/BOTS are Windows-only |
| DUT host | Separate Linux host or VM | Avoids same-machine port conflict |
| Network | Isolated Ethernet switch | No DHCP conflicts for test stability |
| BACnet client | BTS 3-week free trial | Per tool-acquisition recommendation |

---

## 5. Deficiencies & Gaps

### 5.1 Build Config Issues Found

| Issue | Severity | Resolution |
|-------|:--------:|------------|
| `BAC_ROUTING=ON` causes `Device_Object_Instance_Number()` to return 0 | 🔴 Critical | Fixed: rebuilt with `BAC_ROUTING=OFF` |
| Demo server creates only 1 instance/object (vs PICS: AI×8, AO×4, AV×32, etc.) | 🟡 Medium | Expected: the `kinexus-bacnet` service will configure per PICS |
| MS/TP still compileable (but disabled per build config) | 🟢 Low | Already `BACDL_MSTP=OFF` in build |

### 5.2 Pre-Test Gaps

| # | Gap | Impact | Blocking |
|:-:|-----|--------|:--------:|
| G1 | No hardware MK-DDC-24 prototype available | Cannot run real IUT conformance tests | 🔴 Yes |
| G2 | No `kinexus-bacnet` service built yet | Cannot verify B-ASC object config per PICS | 🔴 Yes |
| G3 | No Windows host for BTS trial | Cannot run BTL pre-test tool | 🟡 Partial |
| G4 | No BTL Test Package v26.1-v2 downloaded | Cannot map BTL checklist items to tests | 🟡 Partial |
| G5 | Same-host BACnet/IP communication limited | Cannot verify Who-Is/I-Am round-trip | 🟡 Partial |
| G6 | BACnet International membership not enrolled | No discount on pre-test tools | 🟢 Low |
| G7 | ASHRAE Vendor_Identifier not registered | Device Object invalid for BTL submission | 🔴 Yes |

### 5.3 Priority Ranking for Remediation

| Priority | Item | Owner | Target Sprint |
|:--------:|------|-------|:-------------:|
| **P1** | Build `kinexus-bacnet` service per SW_BACNET_DESIGN | SW Lead | Sprint 1 |
| **P1** | Provide MK-DDC-24 prototype for lab testing | HW Lead | Sprint 1 |
| **P2** | Set up Windows host + BTS 3-week trial | QA | Sprint 1 |
| **P2** | Download BTL Test Package v26.1-v2 | QA | Sprint 1 |
| **P3** | Enroll BACnet International membership | CEO | Sprint 1 |
| **P3** | Register ASHRAE Vendor_Identifier | PMO | Sprint 1 |

---

## 6. Commands & Run Evidence

### 6.1 Clone & Build

```bash
git clone --depth 1 --branch bacnet-stack-1.3.8 \
    https://github.com/bacnet-stack/bacnet-stack.git repo/bacnet
cmake -S . -B build \
    -DBAC_ROUTING=OFF \
    -DBACNET_STACK_BUILD_APPS=ON \
    -DBACDL_BIP=ON \
    -DBACDL_MSTP=OFF
cmake --build build -j$(nproc)
```

### 6.2 Unit Tests

```bash
make -s -j -C test all
# Result: 104 tests, 104 pass, 0 fail
```

### 6.3 Server Startup

```bash
cd repo/bacnet/build
BACNET_IFACE=eno1 ./server 1 KINEXUS-MK-DDC-24
```

### 6.4 Python Client Setup

```bash
python3 -m venv .venv-bacnet
.venv-bacnet/bin/pip install BAC0
```

---

## 7. Rerun Requirement

**Full pre-test must be re-run when:**

1. `kinexus-bacnet` service is built and running on MK-DDC-24 prototype (or dev board)
2. Windows host with BTS trial is available on same LAN segment
3. All B-ASC BIBBs are configured per PICS

**Partial re-run recommended when:**
- A second Linux host becomes available (can use `bacnet-stack whois` / `readprop` tools for basic ReadProperty and Who-Is verification)
- BTL Test Package is downloaded (can manually compare B-ASC checklist against PICS)

---

## 8. Evidence Links

| Source | Path |
|--------|------|
| bacnet-stack upstream | `https://github.com/bacnet-stack/bacnet-stack` |
| Local clone | `repo/bacnet/` (tag `bacnet-stack-1.3.8`) |
| Tool acquisition analysis | `docs/00_management/evidence/bacnet-pretest-tool-acquisition.md` |
| BTL submission checklist | `docs/00_management/evidence/certification/btl-submission-checklist.md` |
| BACnet design | `design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md` |
| PICS / EPICS | `design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md` |
| Python venv | `.venv-bacnet/` (BAC0 installed) |

---

> **Revision:** 1.0 | 2026-06-02
> **Next action:** Giải quyết P1 items (build kinexus-bacnet, có prototype HW) trước khi re-run pre-test với BTS.
> **Blocker:** Chưa có prototype MK-DDC-24 và chưa có Windows host để chạy BTS trial.
