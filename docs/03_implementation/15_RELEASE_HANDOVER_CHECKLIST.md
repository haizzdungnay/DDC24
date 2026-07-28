# 15 — Release Handover Checklist
## MK-DDC-24 — Trước khi bàn giao

> **Document ID:** IMPL-HANDOVER-MK-DDC-24-VI
> **Phiên bản:** 1.2 | 2026-07-28 (ADR-017 Network release gates)
> **Trạng thái:** Draft — chưa đến giai đoạn release
> **Owner:** PM/Lead. Bàn giao chỉ khi MỌI ô tick + ký.

---

## 1. Build & version

```
[ ] Build clean từ repo CLONE MỚI (không dùng workspace cũ) — cả 4 phần:
      fw/ · services/iobus · services/core · web/
[ ] Firmware version rõ (DIAG_RESP FW_VERSION khớp tag git).
[ ] SOM service version rõ (mkddc-core/iobus/netcfg/web --version khớp tag).
[ ] IOP version đúng (IOP_VER_MAJOR.MINOR = 1.1) khớp 2 phía.
[ ] shared/iop_protocol.h + mkddc_shm.h không bị fork (1 nguồn).
```

## 2. Cấu hình & triển khai

```
[ ] Config mặc định có sẵn (io_config, network, netcfg allowlist, device, safe_state, users).
[ ] systemd core/iobus/netcfg/web enable được; HMI chỉ enable theo SKU/hardware.
[ ] Sau reboot: netcfg sẵn sàng trước Web transaction; systemd dependency verify PASS.
[ ] WatchdogSec + hardware watchdog hoạt động.
[ ] Quyền user/socket đúng; netcfg chỉ giữ capability bắt buộc, HMI không truy cập trực tiếp netcfg.sock.
```

## 3. Chức năng (smoke test trên board thật)

```
[ ] Web login được.
[ ] Point list chạy (24 IO, value/unit/quality).
[ ] DO test pass (web bật/tắt relay THẬT).
[ ] AO test pass (web đặt giá trị, đo V/mA THẬT).
[ ] DI/UI test pass (đổi ngoài → web cập nhật).
[ ] Fault test pass (rút UART → báo lỗi + safe-state → cắm lại recover).
[ ] Commissioning export report nghiệm thu chạy.
[ ] Alarm list + ack chạy.
[ ] Validator chặn graph lỗi; deploy graph hợp lệ pass.
[ ] Nếu HMI SKU enable: 5 surface local hiển thị đúng và target DRM/touch/6 nút pass.
[ ] HMI setpoint/mode/override/release chỉ cho point whitelist; broker/core/audit path pass.
[ ] HMI alarm ACK authoritative; broker loss chuyển read-only; không blind replay.
[ ] HMI không có CAP_SYS_BOOT/direct signal/direct SHM write; maintenance unsupported bị disable.
[ ] Network GET status cho viewer+; mọi POST transaction chỉ Admin.
[ ] Strict protocol v1 từ chối unknown field/version/action; capability exact có dns + management-hostname.
[ ] DNS preserve/auto/manual validate đúng; DNS rollback cùng IPv4, không có writer riêng.
[ ] Management hostname chỉ đọc trong authority; package chỉ cài hostname tool/template, không tự apply.
[ ] HMI surface Service đọc status; mutation Admin-only, Stage double-confirm 5 s và countdown monotonic.
[ ] Physical end1 static/DHCP/DNS, confirm/120 s rollback, reboot/power/disk fault PASS có raw evidence.
[ ] Stable hostname/mDNS IP handoff, REST/WebSocket reconnect, BACnet I-Am packet capture và Modbus reconnect PASS.
[ ] Core/IOP/STM32/output continuity qua đổi IP được đo trên hardware thật.
```

## 4. Sạch demo/bypass (BẮT BUỘC)

```
[ ] KHÔNG còn mock/demo path (grep MOCK/FAKE/random IO = 0 trong build release).
[ ] KHÔNG còn bypass Web → UART (lsof mkddc-web: 0 fd /dev/ttyS2).
[ ] Web KHÔNG gọi thẳng MCU (không import serial/IOP trong web).
[ ] Mọi DO/AO đi qua priority resolver (core) — không đường ghi tắt.
[ ] HMI không ghi SHM/hardware, không kill core/iobus và không tự reboot host.
[ ] iobus không tự quyết logic relay; MCU không chạy logic hệ thống.
```

## 5. Chất lượng & độ ổn định

```
[ ] Long-run 24h pass (group 8): 0 crash, RSS ổn định, scan_overrun=0.
[ ] iop_crc_err/timeout/seq_err trong ngưỡng chấp nhận.
[ ] Không memory leak (valgrind/asan trên core+iobus ở môi trường test).
[ ] Log không spam, mức log hợp lý.
```

## 6. Tài liệu bàn giao

```
[ ] Release note (tính năng, version, ngày).
[ ] Known issues (lỗi còn lại + workaround).
[ ] Bring-up guide ([13](14_BRINGUP_GUIDE.md)) cập nhật khớp thực tế.
[ ] Sơ đồ đấu dây IO + bảng điểm (point list) bàn giao.
[ ] Hướng dẫn vận hành cơ bản cho người dùng cuối.
[ ] Backup config mặc định + script restore.
[ ] Network evidence ghi commit/toolchain/target/artifact hash, old/new/DNS/management path và reviewer.
[ ] Known issues nói rõ Network gate RED nếu còn bất kỳ physical/HIL/security item chưa đóng.
```

## 7. Bảo mật (tối thiểu)

```
[ ] TLS 1.3 bật cho web (prod).
[ ] Không hardcode secret/password trong code/repo.
[ ] User mặc định buộc đổi mật khẩu lần đầu.
[ ] SSH key-only (port 2222), tắt password login.
[ ] Firewall (nftables) chỉ mở port cần thiết.
```

---

## Ký bàn giao

| Vai trò | Tên | Ngày | Ký |
|---------|-----|------|-----|
| FW Lead | | | |
| SW Lead | | | |
| Web Lead | | | |
| Tester | | | |
| PM | | | |

> Chỉ phát hành khi đủ chữ ký + mọi ô §1–§7 tick. Bất kỳ ô §4 chưa tick = **chặn release**.

---
**Rev** 1.2 | 2026-07-28 — thêm strict Network v1, DNS/capability/management hostname, Web/HMI RBAC và physical HIL checklist; mọi ô chưa tick tiếp tục chặn release. · 1.1 | 2026-07-22 (ADR-016 local HMI handover and privilege gates) · 1.0 | 2026-06-10 · Liên quan: [13_DEFINITION_OF_DONE](13_DEFINITION_OF_DONE.md) · [12_INTEGRATION_TEST_PLAN](12_INTEGRATION_TEST_PLAN.md)
