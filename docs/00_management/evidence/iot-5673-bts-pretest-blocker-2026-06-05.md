# IOT-5673 BTS Pre-Test Blocker Evidence — 2026-06-05

> Issue: IOT-5673  
> Owner: QAReviewer  
> Result: Blocked

## Objective

Install BTS pre-test tooling on the provisioned Windows host and verify BACnet/IP Who-Is/I-Am round-trip against the Linux DUT host.

## Acceptance Criteria Status

| Criterion | Status | Evidence |
|---|---|---|
| BTS trial installed and launches on Windows | Blocked | Windows host not reachable over `192.168.1.201`; BTS also still documented as `Not yet` in `docs/00_management/evidence/vm-win11-bacnet-config.md`. |
| BTS Who-Is discovers Linux bacnet-stack server | Blocked | Cannot access Windows host to install/run BTS. |
| Wireshark capture shows complete BACnet/IP round-trip | Blocked | Wireshark installed per VM config, but host unreachable; no `.pcapng` evidence found under `docs/00_management/evidence/`. |
| Packet capture archived in evidence folder | Blocked | `find docs/00_management/evidence -maxdepth 2 -iname '*.pcapng'` returned no files. |

## Verification Run

Commands run from `/home/chuong/Desktop/DDC-PROJECT` on 2026-06-05:

```text
$ ping -c 2 -W 2 192.168.1.201
2 packets transmitted, 0 received, 100% packet loss

$ timeout 5 bash -lc 'cat < /dev/null > /dev/tcp/192.168.1.201/3389'
bash: connect: No route to host

$ ip neigh show 192.168.1.201
192.168.1.201 dev br0 FAILED

$ virsh domstate win11-bacnet
running

$ virsh domiflist win11-bacnet
Interface   Type     Source   Model   MAC
vnet0       bridge   br0      e1000   52:54:00:25:77:80

$ ip route get 192.168.1.201
192.168.1.201 dev br0 src 192.168.1.200 uid 1001

$ bridge link
eno1: master br0 state forwarding
vnet0: master br0 state forwarding
```

## Conclusion

Windows VM exists and libvirt reports it as `running`, but the expected static IP `192.168.1.201` is not reachable from the Linux DUT host `192.168.1.200`. ARP/neighbour resolution fails, and RDP cannot connect.

## Required Unblock

Owner: DeveloperTeam / Windows host provisioner.

Action: restore `win11-bacnet` network and RDP reachability, then provide readback evidence that:

- `ping 192.168.1.200` works from Windows
- `ping 192.168.1.201` or RDP `192.168.1.201:3389` works from Linux host
- Wireshark still launches on Windows
- BTS installer/trial access is available or email/trial approval is provided

