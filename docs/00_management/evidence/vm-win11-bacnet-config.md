# win11-bacnet VM Configuration

> **Issue:** IOT-5756 | **Owner:** DeveloperTeam | **Date:** 2026-06-03
> **Verified by:** TechLead (**approved** 2026-06-03)

---

## VM Identity

| Field | Value |
|-------|-------|
| Name | `win11-bacnet` |
| Image | WinDev2407Eval.qcow2 (Win 11 Dev Eval) |
| UUID | `378b5770-72a3-45ad-a577-6a12d5b5fd4f` |
| State | `running` |
| CPU | 4 vCPU |
| RAM | 8 GB |
| UEFI | + Secure Boot |

## Network

| Field | Value |
|-------|-------|
| Interface type | `bridge` |
| Source bridge | `br0` |
| Model | `e1000` |
| MAC | `52:54:00:25:77:80` |
| VM IP | `192.168.1.201/24` (static) |
| Host IP | `192.168.1.200/24` (on br0) |
| VLAN | same broadcast domain (direct L2) |

## Access

| Method | Port | Credentials |
|--------|------|-----------|
| RDP | `192.168.1.201:3389` | `User` / `P@ssw0rd!` |
| RDP (Admin) | same | `Administrator` / `P@ssw0rd!` |
| VNC | `127.0.0.1:5902` (via SSH tunnel from 5901) | No auth |

**RDP command:**
```
xfreerdp /v:192.168.1.201 /u:User /p:P@ssw0rd! /cert:ignore -sec-nla +fonts /drive:share,/tmp/rdp-share
```

**VNC tunnel (from remote):**
```
ssh -L 5902:localhost:5901 user@192.168.1.200
```

## VNC Helper Scripts (on host)

All at `/tmp/`:

| Script | Purpose |
|--------|---------|
| `vnc-login3.py` | CAD + password `P@ssw0rd!` via VNC |
| `vnc-rdp-fix3.py` | Run PowerShell commands via VNC |
| `vnc-cap.py` | Framebuffer capture (Pillow PNG) |

## RDP Config Applied

| Setting | Value |
|---------|-------|
| NLA (UserAuthentication) | `0` (disabled) |
| Windows Firewall | RDP allowed (default) |
| Administrator | Enabled, password set |
| `User` account | Added to `Remote Desktop Users` group |

## Tool Installation

| Tool | Status | Path |
|------|--------|------|
| Wireshark | Installed | `C:\Program Files\Wireshark\tshark.exe` |
| Wireshark installer | On host | `/tmp/rdp-share/Wireshark-latest-x64.exe` |
| BTS BACnet Test Suite | Not yet | Trial requires email at `bac-test.com` |

## Verified Configuration (via registry read — 2026-06-03)

| Setting | Value | Source |
|---------|-------|--------|
| Hostname | `win11-bacnet` | SYSTEM hive — `1win11-bacnet:378b5770-...` |
| IP assignment | **Static** (EnableDHCP=0) | `\ControlSet001\Services\Tcpip\Parameters\Interfaces\{...}` |
| IP address | 192.168.1.201 | hex(7) UTF-16LE in registry |
| Subnet mask | 255.255.255.0 | same key |
| Default gateway | 192.168.1.1 | same key |
| DNS servers | 192.168.1.1, 8.8.8.8 | same key |
| Host IP (br0) | 192.168.1.200/24 | host `ip addr` |

**Verification method:** VM stopped, qcow2 mounted read-only via `qemu-nbd` + `ntfs3`. Registry SYSTEM hive queried with `reged`. See IOT-5756.

## Known Issues

- VM lock screen not dismissable via VNC reliably -- use RDP instead
- VM auto-shutdowns periodically (Win 11 Dev Eval idle timeout)
- BTS trial requires direct web download from bac-test.com (not automated)
- RDP remote-app (`/app:` flag) fails with `LOGON_FAILED_OTHER` — full desktop session works; `+auth-only` passes for both User and Administrator
- QEMU guest agent not installed — `virsh domifaddr` and `qemu-agent-command` unavailable

## Restart Procedure

```bash
# Check state
sudo virsh domstate win11-bacnet

# If stale process holds disk
sudo fuser -k /var/lib/libvirt/images/WinDev2407Eval.qcow2

# Start
sudo virsh start win11-bacnet

# Wait for boot + ping
until ping -c1 -W1 192.168.1.201 >/dev/null 2>&1; do sleep 2; done
```
