# QA Verification: Windows 10/11 Test Host for Isolated BACnet LAN

**Issue:** IOT-5675  
**Depends on:** IOT-5674 (provision VM)  
**Prepared:** 2026-06-02  

---

## Prerequisites

Before running this verification, IOT-5674 must be complete with:
- Windows VM deployed on KVM/QEMU with bridge/macvtap networking
- VM reachable via RDP from lab management network
- Handover doc with VM name, IP, admin credentials, bridge config

## Test Environment

| Parameter | Expected |
|-----------|----------|
| Test LAN subnet | 192.168.1.0/24 |
| Linux DUT IP | 192.168.1.200 |
| Windows VM IP | 192.168.1.201 |
| BACnet port | UDP 47808 |
| VM hypervisor | KVM/QEMU on Ubuntu 24.04 |

---

## AC1: RDP Accessibility

**From lab management network:**

```bash
# Option A: Direct RDP (if management network has route)
remmina --new 'rdp://<WINDOWS_VM_IP>:3389'

# Option B: SSH tunnel (if behind NAT/gateway)
ssh -L 13389:<WINDOWS_VM_IP>:3389 <lab-gateway>
# Then connect to localhost:13389 via RDP client
```

**Expected:** RDP session establishes, Windows desktop visible.

**Evidence:** Screenshot of successful RDP session showing Windows desktop + network icon showing connected status.

---

## AC2: Ping to Linux DUT

**From Windows VM (Command Prompt or PowerShell):**

```cmd
ping 192.168.1.200 -n 10
```

**Expected:** 0% loss, latency < 5ms (same switch).

**Evidence:** Copy of ping output showing 10/10 replies.

---

## AC3: Wireshark BACnet/IP Capture

**Steps:**

1. Install Wireshark (if not already present)
2. Select the test LAN interface (the one with IP 192.168.1.201)
3. Apply capture filter: `udp port 47808`
4. Start capture
5. From DUT side, trigger BACnet traffic:
   ```bash
   # On the Linux DUT (192.168.1.200), send Who-Is broadcast
   echo "Who-Is" | nc -u 192.168.1.255 47808
   ```
6. Stop capture after 10 seconds

**Expected:** Packets visible with BACnet/IP protocol dissection.

**Evidence:** Wireshark screenshot showing at least one BACnet packet decoded (fields: BVLC type, NPDU, APDU).

---

## AC4: BTS Trial Installer

**Check:**

```powershell
# On Windows VM
Test-Path "$env:USERPROFILE\Desktop\BTS_*.exe"
# OR
Get-ChildItem "$env:USERPROFILE\Desktop" -Filter "*.exe"
```

**Alternative locations:** `Downloads\`, `C:\BTS\`

**Expected:** BTS trial installer `.exe` found on desktop.

**Evidence:** `dir` output or PowerShell `ls` showing the installer file with size and date.

---

## AC5: Network Isolation — No DHCP Conflicts

**From Windows VM:**

```powershell
# Verify static IP, no DHCP server on test LAN
ipconfig /all
# Check ARP table for unexpected IPs
arp -a
```

**From Linux host:**

```bash
# Verify no DHCP server on test LAN interface
sudo nmap --script broadcast-dhcp-discover -e <test-LAN-interface>
# Check bridge config
ip addr show br0  # if bridge was created
ip addr show <test-LAN-interface>
```

**Expected:**
- Windows VM has static IP 192.168.1.201/24 (no DHCP enabled)
- No unexpected DHCP OFFER responses on test LAN
- Only expected IPs in ARP table (DUT 192.168.1.200, Windows VM 192.168.1.201)

**Evidence:** `ipconfig /all` output + bridge config + ARP table.

---

## AC6: Handover Documentation Quality

**Checklist:**

| Item | Required | Found? |
|------|----------|--------|
| VM name | Matches hypervisor convention | |
| VM IP | 192.168.1.201/24 | |
| Admin username | Documented | |
| Admin password | Documented (change on first login) | |
| Bridge/macvtap config | br0 or macvtap details | |
| Resource allocation | vCPU, RAM, disk | |
| Hypervisor host | Which lab machine | |
| Network topology | ASCII or diagram | |

**Expected:** All fields populated in handover doc.

---

## Sign-off

All 6 AC items must pass for approval. Any failure must be documented with exact error.

**QA Verdict:** Changes requested (AC4 blocks approval)

---

## Changelog

| Date | Verdict | Tester |
|------|---------|--------|
| 2026-06-03 | Changes requested (AC4: BTS installer missing) | QAReviewer |
| 2026-06-02 | Prepared (blocked) | QAReviewer |
