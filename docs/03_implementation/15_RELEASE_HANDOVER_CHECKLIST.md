# 15 — Release Handover Checklist
## MK-DDC-24 — Trước khi bàn giao

> **Document ID:** IMPL-HANDOVER-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Trạng thái:** Draft — chưa đến giai đoạn release
> **Owner:** PM/Lead. Bàn giao chỉ khi MỌI ô tick + ký.

---

## 1. Build & version

```
[ ] Build clean từ repo CLONE MỚI (không dùng workspace cũ) — cả 4 phần:
      fw/ · services/iobus · services/core · web/
[ ] Firmware version rõ (DIAG_RESP FW_VERSION khớp tag git).
[ ] SOM service version rõ (mkddc-core/iobus/web --version khớp tag).
[ ] IOP version đúng (IOP_VER_MAJOR.MINOR = 1.1) khớp 2 phía.
[ ] shared/iop_protocol.h + mkddc_shm.h không bị fork (1 nguồn).
```

## 2. Cấu hình & triển khai

```
[ ] Config mặc định có sẵn (io_config, network, device, safe_state, users).
[ ] systemd 3 service (mkddc-core, mkddc-iobus, mkddc-web) enable được.
[ ] Sau reboot: 3 service tự lên đúng thứ tự (core → iobus → web).
[ ] WatchdogSec + hardware watchdog hoạt động.
[ ] Quyền user đúng (mkddc / mkddcweb), không chạy root thừa.
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
```

## 4. Sạch demo/bypass (BẮT BUỘC)

```
[ ] KHÔNG còn mock/demo path (grep MOCK/FAKE/random IO = 0 trong build release).
[ ] KHÔNG còn bypass Web → UART (lsof mkddc-web: 0 fd /dev/ttyS2).
[ ] Web KHÔNG gọi thẳng MCU (không import serial/IOP trong web).
[ ] Mọi DO/AO đi qua priority resolver (core) — không đường ghi tắt.
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
**Rev** 1.0 | 2026-06-10 · Liên quan: [13_DEFINITION_OF_DONE](13_DEFINITION_OF_DONE.md) · [12_INTEGRATION_TEST_PLAN](12_INTEGRATION_TEST_PLAN.md)
