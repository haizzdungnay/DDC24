# Windows 11 KVM VM for BACnet BTS Testing

## VM Summary

| Property | Value |
|----------|-------|
| **Name** | `win11-bacnet-test` |
| **Host** | Ubuntu 24.04 Linux workstation (KVM/QEMU) |
| **Purpose** | BACnet Test Server (BTS) for BTL conformance pre-test |
| **Status** | Running |

## VM Configuration

| Resource | Allocation |
|----------|-----------|
| vCPUs | 4 (host-passthrough) |
| RAM | 8 GB |
| Disk | 60 GB qcow2 (SATA) |
| Boot | UEFI + Secure Boot (OVMF) |
| TPM | 2.0 (emulated via swtpm) |
| Display | VNC port 5901 |

## Network

- **Type**: macvtap (direct bridge on `eno1`)
- **NIC model**: Intel e1000e
- **MAC address**: `52:54:00:a3:29:96`
- **IP address**: `192.168.1.201/24` (static)
- **Gateway**: `192.168.1.1`
- **DUT address**: `192.168.1.200`

### Network topology

```
[Windows VM] --macvtap--> [eno1] --physical--> [BACnet test switch] -- [DUT 192.168.1.200]
    192.168.1.201                                           |
                                                        [Gateway 192.168.1.1]
```

## Credentials

| User | Password | Role |
|------|----------|------|
| `bactest` | `BacnetTest2026!` | Local admin |
| `Administrator` | `BacnetTest2026!` | Built-in admin |

## VM Management

### Start / Stop

```bash
sudo virsh -c qemu:///system start win11-bacnet-test
sudo virsh -c qemu:///system shutdown win11-bacnet-test
sudo virsh -c qemu:///system destroy win11-bacnet-test  # force-off
```

### VNC Console

```bash
# Display :1 = port 5901
virt-viewer --connect qemu:///system win11-bacnet-test
```

### RDP

From any machine on the 192.168.1.x subnet:
- **Address**: `192.168.1.201`
- **Port**: `3389`
- **User**: `bactest`

## Storage

| File | Path | Size |
|------|------|------|
| Disk image | `/var/lib/libvirt/images/win11-bacnet-test.qcow2` | 60 GB |
| Windows ISO | `/var/lib/libvirt/images/win11-enterprise-eval.iso` | 6.7 GB |
| virtio drivers | `/var/lib/libvirt/images/virtio-win.iso` | 699 MB |
| Answer file | `/var/lib/libvirt/images/autounattend.iso` | 374 KB |

## Pre-installed Software

- [ ] Windows 11 Enterprise Evaluation 25H2
- [ ] Wireshark (install via winget)
- [ ] BTS trial (download from bac-test.com)

## Post-Install Steps (if not automated)

1. Configure static IP: `192.168.1.201/24`
2. Enable RDP
3. Install Wireshark
4. Download and install BTS trial from [bac-test.com](https://bac-test.com)
5. Verify BACnet/IP capture on UDP 47808

## Notes

- Windows 11 Enterprise Evaluation runs for 90 days before requiring rearm.
- The VM uses macvtap (direct) networking — it appears as a separate device on the physical network with its own MAC/IP.
- Secure Boot is enabled via Microsoft UEFI keys (OVMF_CODE_4M.ms.fd).
- The virtio-win.iso is available for optional virtio driver installation.
- Host SSH/RDP: not directly accessible; use VNC or RDP.
