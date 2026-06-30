# 19 — Docs Audit
## MK-DDC-24 — Audit tài liệu implement SOM / IOP / Core / Web

> **Document ID:** IMPL-DOCS-AUDIT-MK-DDC-24-VI
> **Ngày audit:** 2026-06-11
> **Trạng thái:** Historical — 16 findings resolved 2026-06-11
> **Phạm vi:** `shared/`, `docs/01_specs/`, `docs/02_design/`, `docs/03_implementation/`
> **Mục tiêu:** chỉ ra chỗ mâu thuẫn, thiếu rõ, hoặc còn mang kiến trúc cũ làm dev mới dễ code sai.

> ✅ **CẬP NHẬT 2026-06-11 (cùng ngày):** toàn bộ 16 finding đã được xử lý trong 2 đợt
> "Contract Freeze" — xem Status dưới từng finding và [20_DOCS_FIX_CHECKLIST](20_DOCS_FIX_CHECKLIST.md)
> (16/16 tick). Bản chốt hợp đồng: [16_CONTRACT_FREEZE](16_CONTRACT_FREEZE.md).
> ⚠️ Các link "bằng chứng" bên dưới trỏ **line number tại thời điểm audit** — nhiều file đã
> sửa nên line/nội dung không còn khớp (đặc biệt `kinexus_shm.h` giờ chỉ là shim deprecated).
> Đọc file này như HỒ SƠ audit lịch sử, không phải trạng thái hiện tại.

---

## 1. Kết luận nhanh

~~Tài liệu hiện **đủ để bắt đầu scaffold và viết protocol lib mức đầu**, nhưng **chưa đủ để implement an toàn end-to-end** nếu không tự suy diễn thêm.~~ → **Đã giải quyết 2026-06-11**: contract freeze + 16/16 finding fixed (xem Status từng mục).

4 nhóm rủi ro lớn nhất:

1. **Contract chưa freeze**: `FAULT_FLAGS`, `RESET_IO reason`, SHM naming/path còn lệch.
2. **Concurrency model chưa đúng**: cùng `kx_io_shm_t` nhưng docs gán nhiều writer trên seqlock kiểu single-writer.
3. **Spec cũ và implement mới đang lẫn nhau**: `kinexus-*` / `mkddc-*`, `PLC engine` / `graph runtime`, `scan 100ms` / `scan 1s`.
4. **Web/Core/API/config chưa khớp nhau hoàn toàn**: RBAC, priority, IPC, config error policy.

---

## 2. Findings ưu tiên rất cao

### F-01 — `kx_io_shm_t` đang là multi-writer nhưng docs mô tả single-writer seqlock

> **Status: ✅ FIXED** (2026-06-11) — single-writer + ngoại lệ core ghi ao_setpoint/do_cmd bằng atomic store (mkddc_shm.h, 06 §5, 07 §7.2).

**Mức độ:** Critical

**Bằng chứng**
- Header ghi rõ seqlock helper là **single-writer / multi-reader**: [shared/kinexus_shm.h](/home/chuong/Desktop/DDC-PROJECT/shared/kinexus_shm.h:102)
- `ao_setpoint[]` được mô tả là “PLC ghi vào”: [shared/kinexus_shm.h](/home/chuong/Desktop/DDC-PROJECT/shared/kinexus_shm.h:47)
- Guide `iobus` lại ghi vừa “Single-writer (iobus)”: [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md:265)
- Nhưng cùng guide gán `ao_setpoint[]` và `do_cmd[]` cho `core`: [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md:275), [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md:277)
- Overview cũng xác nhận `core -> iobus` qua **cùng SHM**: [01_SYSTEM_IMPLEMENTATION_OVERVIEW.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/01_SYSTEM_IMPLEMENTATION_OVERVIEW.md:109)

**Tác động**
- Nếu dev implement đúng theo seqlock single-writer hiện tại, `core` và `iobus` sẽ race trên cùng `seq`.
- Nếu dev tự thêm mutex hay tách vùng nhớ mà docs không nói, contract runtime giữa service sẽ bị fork ngầm.

**Cần chốt**
- Chọn 1 trong 2 hướng:
  - Tách thành **2 SHM segment** hoặc **2 seqlock region** riêng.
  - Hoặc định nghĩa rõ **multi-writer protocol** mới, không gọi nó là single-writer seqlock nữa.

---

### F-02 — `FAULT_FLAGS` mâu thuẫn giữa header, spec, guide, test

> **Status: ✅ FIXED** (2026-06-11) — bảng bit0–6 frozen (iop_protocol.h + SWFW §4.3.1 + 05 §6.8 + 15_FREEZE §3); evidence dưới đây trỏ header CŨ — đã stale.

**Mức độ:** Critical

**Bằng chứng**
- Header map bit tại [shared/iop_protocol.h](/home/chuong/Desktop/DDC-PROJECT/shared/iop_protocol.h:78)
- Spec map bit khác tại [SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md:187)
- Guide IOP lặp lại mapping kiểu spec tại [05_IOP_UART_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/05_IOP_UART_IMPLEMENTATION_GUIDE.md:171)
- Test plan kiểm watchdog bằng `FAULT bit5`: [12_INTEGRATION_TEST_PLAN.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/12_INTEGRATION_TEST_PLAN.md:75)

**Điểm lệch chính**
- Header có `VDD`, spec/guide không có.
- Header đặt `RELAY_STUCK` ở bit2, spec/guide đặt ở bit3.
- Header đặt `WDG_RESET` ở bit5, spec/guide đặt watchdog ở bit4.

**Tác động**
- `iobus` parse sai fault.
- `core` propagate quality sai.
- Web hiển thị alarm sai loại.

**Cần chốt**
- Freeze 1 bảng bitmask duy nhất trong `shared/iop_protocol.h` rồi cập nhật spec, guide, test theo đó.

---

### F-03 — `RESET_IO reason` chưa có enum chuẩn thống nhất

> **Status: ✅ FIXED** (2026-06-11) — IOP_RESET_REASON_* 0x00–0x05 trong header + SWFW §4.11 + 05 §6.9.

**Mức độ:** High

**Bằng chứng**
- Header chỉ có `0x00 NORMAL` và `0x04 OTA`: [shared/iop_protocol.h](/home/chuong/Desktop/DDC-PROJECT/shared/iop_protocol.h:60)
- Spec định nghĩa `0x01 PLC watchdog`, `0x02 BMS timeout`, `0x03 operator`, `0x04 OTA reboot`: [SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md:332)
- Guide API dùng `iop_reset_io(uint8_t reason)` nhưng không có enum triển khai tương ứng trong header: [05_IOP_UART_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/05_IOP_UART_IMPLEMENTATION_GUIDE.md:264)

**Tác động**
- FW và SOM dễ hardcode reason khác nhau.
- Log/audit/fault handling sẽ không nhất quán.

**Cần chốt**
- Định nghĩa enum reason đầy đủ trong header, rồi reference lại từ spec/guide/test.

---

### F-04 — SHM naming/path `kinexus` vs `mkddc` chưa thống nhất

> **Status: ✅ FIXED** (2026-06-11) — rename mkddc_shm.h, path /dev/shm/mkddc_*, giữ kx_/magic (15_FREEZE §6); kinexus_shm.h chỉ còn shim — line ref dưới đây stale.

**Mức độ:** High

**Bằng chứng**
- Header chốt `KX_SHM_IO_PATH="/dev/shm/kinexus_io_shm"`: [shared/kinexus_shm.h](/home/chuong/Desktop/DDC-PROJECT/shared/kinexus_shm.h:15)
- Overview dùng `/dev/shm/mkddc_io_shm`: [01_SYSTEM_IMPLEMENTATION_OVERVIEW.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/01_SYSTEM_IMPLEMENTATION_OVERVIEW.md:108)
- Guide `iobus` dùng `/dev/shm/mkddc_io_shm`: [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md:264)
- Bring-up hướng dẫn đọc `/dev/shm/mkddc_io_shm`: [14_BRINGUP_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/14_BRINGUP_GUIDE.md:107)
- README nói “giữ nguyên contract, chỉ rename header”: [00_IMPLEMENTATION_README.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/00_IMPLEMENTATION_README.md:69)

**Tác động**
- Dev mới sẽ attach sai path.
- Tool debug / bring-up / test harness không đọc cùng segment.

**Cần chốt**
- Chọn **1 path runtime duy nhất** cho Rev A.
- Ghi rõ rename policy: file name, macro, path runtime, struct name, magic.

---

## 3. Findings ưu tiên cao

### F-05 — `SW_REQUIREMENTS` và `SW_ARCH_SPEC` vẫn chứa layout SHM và process boundary cũ

> **Status: ✅ FIXED** (2026-06-11) — SW_REQ §2.2 gắn LEGACY + trỏ mkddc_shm.h; SW_ARCH thêm freeze banner; SW_IODRIVER banner reference-only.

**Mức độ:** High

**Bằng chứng**
- `SW_REQUIREMENTS` mô tả `kinexus_io_shm_t` cũ với `timestamp_ms`, `ui_type[8]`, `ui_fault[8]`, `di_mask`, `do_mask`, `iop_fault`, `safe_state_active`: [SW_REQUIREMENTS_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/01_specs/SW_REQUIREMENTS_MK-DDC-24_VI.md:64)
- Header thật dùng `ts_ns`, `ui_quality[]`, `ui_unit[][]`, `di_state[]`, `di_counter[]`, `do_feedback[]`, metrics: [shared/kinexus_shm.h](/home/chuong/Desktop/DDC-PROJECT/shared/kinexus_shm.h:34)
- `SW_ARCH_SPEC` vẫn nói `mkddc-core` gộp `io-driver + component graph engine`: [SW_ARCH_SPEC_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md:34)
- Nhưng implementation README nói `mkddc-iobus` sở hữu UART/IOP và ghi snapshot IO: [00_IMPLEMENTATION_README.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/00_IMPLEMENTATION_README.md:65)

**Tác động**
- Dev đọc spec nền sẽ code sai service boundary và sai SHM layout.

**Cần chốt**
- Gắn nhãn thật rõ file nào là **legacy/reference only**.
- Thêm banner đầu file: “không dùng để code Rev A nếu khác `shared/*` + docs/03_implementation”.

---

### F-06 — Startup order mâu thuẫn giữa architecture spec và bring-up guide

> **Status: ✅ FIXED** (2026-06-11) — SW_ARCH §1.1/§1.2 sửa theo freeze: iobus (creator SHM) chạy trước, core After=mkddc-iobus, Wants không Requires.

**Mức độ:** High

**Bằng chứng**
- `SW_ARCH_SPEC` ghi dependency `mkddc-iobus -> mkddc-core`: [SW_ARCH_SPEC_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md:30)
- `SW_ARCH_SPEC` startup order: `mkddc-core` trước `mkddc-iobus`: [SW_ARCH_SPEC_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md:38)
- Bring-up guide lại cho start `mkddc-iobus` trước rồi mới start `mkddc-core`: [14_BRINGUP_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/14_BRINGUP_GUIDE.md:97), [14_BRINGUP_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/14_BRINGUP_GUIDE.md:116)

**Tác động**
- Systemd dependency, readiness, và bring-up script dễ lệch nhau.

**Cần chốt**
- Xác nhận service nào có thể boot độc lập.
- Nếu `iobus` không phụ thuộc `core` để tạo SHM/config, đổi dependency.
- Nếu có phụ thuộc, sửa bring-up guide.

---

### F-07 — Priority model chưa khớp giữa core guide, DoD, OpenAPI, web guide

> **Status: ✅ FIXED** (2026-06-11) — web LUÔN mức 2 manual; REST bỏ priority 1..16 (openapi PUT /points); BACnet array → mức 3; DoD thêm manual; 08 §1.2.

**Mức độ:** High

**Bằng chứng**
- Core guide định nghĩa **6 mức**: `Fire/Safety`, `Local manual`, `BACnet command`, `Schedule`, `Local logic`, `Default`: [07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md:72)
- DoD rút gọn thành `safety > BMS > schedule > logic > default`, bỏ `Local manual`: [13_DEFINITION_OF_DONE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/13_DEFINITION_OF_DONE.md:73)
- Web guide nói commissioning test đi vào **Local manual prio 2**: [09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md:27)
- OpenAPI `PUT /points/{id}` lại cho client truyền `priority` từ **1..16** kiểu BACnet array: [openapi.yaml](/home/chuong/Desktop/DDC-PROJECT/docs/02_design/interfaces/openapi.yaml:59)

**Tác động**
- Web/client không biết có được chọn priority hay không.
- Core không rõ map `priority` REST vào 1..6 hay 1..16.
- Audit/result “overridden-by-priority” dễ sai nghĩa.

**Cần chốt**
- Nếu core dùng **6 nguồn logic**, REST không nên expose `priority 1..16` trực tiếp trừ khi có mapping rõ.
- Phải định nghĩa commissioning/manual override nằm ở nguồn nào, field nào, timeout bao lâu.

---

### F-08 — RBAC/role model chưa nhất quán giữa OpenAPI và web guide

> **Status: ✅ FIXED** (2026-06-11) — freeze admin/operator/viewer + ma trận 08 §1.1; users.conf + openapi đồng bộ; bỏ engineer.

**Mức độ:** Medium-High

**Bằng chứng**
- Web guide dùng role `admin/engineer/operator`: [09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md:16)
- OpenAPI login response chỉ enum `admin, operator, viewer`: [openapi.yaml](/home/chuong/Desktop/DDC-PROJECT/docs/02_design/interfaces/openapi.yaml:31)
- `users.conf` example chỉ có `admin`, `operator`: [CONFIG_SCHEMA_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md:118)

**Tác động**
- Không rõ ai được commissioning, ai được deploy graph, ai chỉ xem.

**Cần chốt**
- Freeze role matrix và cập nhật web guide, OpenAPI, config example cùng lúc.

---

## 4. Findings mức trung bình

### F-09 — Chính sách lỗi config không thống nhất

> **Status: ✅ FIXED** (2026-06-11) — CONFIG_SCHEMA §8 bảng policy 5 case khớp 06 §4 (JSON hỏng = fail-fast vì ghi atomic).

**Mức độ:** Medium

**Bằng chứng**
- Guide `iobus` nói JSON sai cú pháp thì **service fail-fast**: [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md:250)
- Config schema lại nói service validate khi load, lỗi thì **dùng default + log + alarm, không crash**: [CONFIG_SCHEMA_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md:125)

**Tác động**
- Cùng 1 file config nhưng mỗi service có thể xử lý khác nhau ngoài ý muốn.

**Cần chốt**
- Tách rõ 3 trường hợp:
  - thiếu file
  - JSON syntax invalid
  - field invalid / unknown enum
- Mỗi file config cần policy riêng, không để câu chung chung.

---

### F-10 — Scan period và runtime model cũ/mới chưa được gắn nhãn đủ rõ

> **Status: ✅ FIXED** (2026-06-11) — SW-PLC-010 gạch bỏ 100ms, ghi rõ Rev A = 1000ms.

**Mức độ:** Medium

**Bằng chứng**
- Core implementation guide chốt scan loop **1s**: [07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md:31)
- Runtime model cũng nói `device.scan_ms`, mặc định **1000ms**: [SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md:24)
- Nhưng `SW_REQUIREMENTS` cũ vẫn ghi mặc định **100ms**, cấu hình `50ms–2000ms`: [SW_REQUIREMENTS_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/01_specs/SW_REQUIREMENTS_MK-DDC-24_VI.md:102)

**Tác động**
- Test/benchmark/doD dễ dùng sai threshold.

**Cần chốt**
- Gắn banner “legacy PLC timing” ở `SW_REQUIREMENTS` hoặc cập nhật requirement mới theo graph runtime Rev A.

---

### F-11 — `web_ipc` chưa đủ contract để code client/server độc lập

> **Status: ✅ FIXED** (2026-06-11) — IPC contract đầy đủ 07 §8 (schema, correlation id, timeout 3s, result/error codes, audit).

**Mức độ:** Medium

**Bằng chứng**
- Core guide nói web IPC là Unix socket `/run/mkddc/core.sock` hoặc shared command ring: [07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md:63)
- Web guide chỉ nói `core_client.go` nói chuyện IPC tới `/run/mkddc/core.sock`: [09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md:17)
- Không có contract message cụ thể: request schema, response schema, timeout, idempotency, error code, override result.

**Tác động**
- Dev core và dev web không thể code song song chắc chắn.

**Cần chốt**
- Tạo 1 IPC contract riêng với:
  - message type
  - payload
  - result code
  - timeout
  - correlation/request id
  - audit result mapping

---

### F-12 — `SystemStatus` chưa đủ rõ version và source metrics

> **Status: ✅ FIXED** (2026-06-11) — SystemStatus versions{mcu_fw,iobus,core,web} + scan{} + nguồn metrics (openapi + 08 §3).

**Mức độ:** Medium

**Bằng chứng**
- Web guide trả `fw_version`: [09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md:40)
- OpenAPI `SystemStatus` cũng chỉ có `fw_version`: [openapi.yaml](/home/chuong/Desktop/DDC-PROJECT/docs/02_design/interfaces/openapi.yaml:167)
- Nhưng thực tế hệ thống có ít nhất 3 version đáng phân biệt: MCU FW, `mkddc-iobus`, `mkddc-core`, có thể cả web.

**Tác động**
- Debug field deployment khó.

**Cần chốt**
- Tách rõ `mcu_fw_version`, `iobus_version`, `core_version`, `web_version` nếu có.

---

## 5. Findings về testability / bring-up

### F-13 — Bring-up guide phụ thuộc công cụ shm chưa được chỉ định

> **Status: ✅ FIXED** (2026-06-11) — tool tools/shm_dump_io spec tại 06 §11; 13 §10 + 17 mốc 6 dùng nó.

**Mức độ:** Medium

**Bằng chứng**
- Bring-up nói “`cat /dev/shm/mkddc_io_shm | xxd | head` (hoặc tool đọc)”: [14_BRINGUP_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/14_BRINGUP_GUIDE.md:107)

**Vấn đề**
- Với struct nhị phân + seqlock, `cat|xxd` không đủ để xác nhận field cụ thể.
- Không có tool reader chuẩn được mô tả ở đâu.

**Cần bổ sung**
- 1 tool tối thiểu: `tools/shm_dump_io` hoặc mô tả output mong đợi.

---

### F-14 — Chưa có quick path test không cần board cho dev SOM

> **Status: ✅ FIXED** (2026-06-11) — checklist no-board 10 bước 06 §11.1 + 03 P2 + 16 §5.

**Mức độ:** Medium

**Bằng chứng**
- Guide `iobus` có nhắc `fake_mcu` ở cây thư mục và test, nhưng chưa có flow chạy cụ thể end-to-end trong bring-up/phase docs: [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md:70)

**Cần bổ sung**
- Một mục riêng “No-board bring-up”:
  - tạo PTY pair
  - chạy fake MCU
  - chạy `mkddc-iobus`
  - kiểm handshake, `GET_IO`, SHM write, `SET_DO`

---

## 6. Findings về config / scaling

### F-15 — Config schema còn mang ngôn ngữ service cũ và policy chung quá rộng

> **Status: ✅ FIXED** (2026-06-11) — CONFIG_SCHEMA: bảng owner/reader/reload + đổi tên service mkddc-*.

**Mức độ:** Medium

**Bằng chứng**
- `io_config.conf` vẫn nói “io-driver gửi `SET_AO_CFG` xuống MCU”: [CONFIG_SCHEMA_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md:68)
- `fieldbus.conf` vẫn nhắc “reboot field-bus service”: [CONFIG_SCHEMA_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md:95)

**Cần bổ sung**
- Đổi hết sang tên service thật: `mkddc-iobus`, `mkddc-core`, `mkddc-web`.
- Chỉ rõ file nào service nào đọc, reload bằng signal hay IPC, và service nào là owner.

---

### F-16 — Công thức scaling chưa đủ mức “code theo được” cho mọi sensor type

> **Status: ✅ FIXED** (2026-06-11) — bảng scaling 7 sensor_type + constants + test case 06 §3.6.

**Mức độ:** Medium

**Bằng chứng**
- `iobus` guide nêu API `ui_to_eng` nhưng không có bảng constant đầy đủ cho từng sensor type: [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md:147)
- Legacy `SW_IODRIVER_DESIGN` có ví dụ NTC/PT100 nhưng là doc cũ và không nói mapping raw->R chi tiết: [SW_IODRIVER_DESIGN_MK-DDC-24_VI.md](/home/chuong/Desktop/DDC-PROJECT/docs/02_design/software/SW_IODRIVER_DESIGN_MK-DDC-24_VI.md:36)

**Tác động**
- Hai dev có thể chọn công thức/constant khác nhau cho cùng sensor.

**Cần bổ sung**
- Bảng scaling chuẩn cho từng `sensor_type`:
  - raw encoding
  - công thức
  - constants
  - clamp
  - quality/fault rule
  - unit string ghi SHM

---

## 7. Đề xuất cập nhật docs theo thứ tự

1. **Freeze contract**
   - `shared/iop_protocol.h`
   - `shared/kinexus_shm.h` hoặc `shared/mkddc_shm.h`
   - path runtime SHM
   - fault bits
   - reset reasons

2. **Sửa concurrency model của SHM**
   - single-writer hay multi-writer
   - nếu multi-writer: thiết kế mới phải viết rõ trong header + guide + overview

3. **Dọn legacy spec**
   - `SW_REQUIREMENTS`
   - `SW_ARCH_SPEC`
   - `SW_IODRIVER_DESIGN`
   - gắn nhãn `legacy/reference-only` nơi cần

4. **Chuẩn hóa Web/Core boundary**
   - IPC contract
   - RBAC matrix
   - priority mapping
   - REST request/response semantics

5. **Bổ sung dev workflow**
   - no-board fake MCU test
   - shm dump tool
   - week-1 SOM checklist

---

## 8. Hướng dùng file này

- Dùng làm checklist khi chuyên gia cập nhật docs.
- Khi sửa xong từng finding, nên thêm cột `Status: open/fixed/waived`.
- Sau khi contract freeze xong, nên phát hành thêm 1 file:
  - `CONTRACT_FREEZE_REV_A.md`
  - ghi đúng phiên bản header/path/bitmask/reason đang có hiệu lực.

---

**Kết luận**

Đường bắt đầu `shared contract -> iobus -> core -> web` vẫn là đúng. Nhưng trước khi code sâu vào SHM writer/reader và command path, cần khóa lại **contract + concurrency + naming**. Nếu không, dev vẫn làm được code chạy, nhưng rất dễ chạy trên những giả định khác nhau.
