---
name: mekong-ddc-review
description: Review chuyên biệt cho DDC, IoT Gateway, SCADA/HMI. Dùng khi kiểm tra protocol, fake MCU, I/O mapping, BACnet, Modbus, runtime, historian, alarm, dashboard và docs.
allowed-tools: Read Grep Glob Bash(git *) Bash(find *) Bash(ls *) Bash(cat *) Bash(sed *) Bash(rg *)
---

# MEKONG DDC / IoT / HMI Review

Luôn trả lời bằng tiếng Việt.

Bối cảnh:
- DDC/IoT phải ưu tiên ổn định công nghiệp.
- Phần cứng chưa xong thì không ép firmware MCU thật.
- Fake MCU/simulator được chấp nhận nếu parser/runtime/test khớp spec.
- Mọi thay đổi protocol phải có versioning/spec/ADR/changelog.
- HMI không được nhầm Active với Connected.
- Runtime phải có timeout, reconnect, safe-state, health và log đủ debug.

Checklist:
1. Protocol / I/O:
   - frame size
   - endian
   - CRC/checksum
   - version
   - channel mapping
   - fault flags
   - AI/AO/DI/DO mapping
   - fake MCU có khớp parser thật không

2. Runtime:
   - polling rate
   - timeout
   - retry
   - reconnect
   - safe-state
   - watchdog/health
   - non-blocking behavior
   - log đủ để debug hiện trường

3. BACnet / Modbus:
   - object mapping
   - reliability/state text
   - unit/scaling
   - offline behavior
   - exception/error handling

4. HMI / Dashboard:
   - online/offline
   - last seen
   - alarm severity
   - API/DB/worker status
   - historian/trend
   - command/audit

5. Docs Governance:
   - docs có khớp code không
   - ADR có tồn tại nếu đổi kiến trúc/protocol
   - changelog có ghi thay đổi behavior không

Output bắt buộc:

## Verdict
PASS / FAIL

## Critical DDC Findings
Lỗi ảnh hưởng protocol/runtime/safety.

## Protocol Findings
Lỗi mapping/frame/version/fault flags.

## Runtime Findings
Lỗi timeout/retry/safe-state/log.

## HMI Findings
Lỗi dashboard/alarm/historian/UX.

## Documentation Findings
Sai lệch docs/spec/ADR.

## Required Tests
Test bắt buộc.

## Next Actions
Việc giao cho DEV/QA/PM.
