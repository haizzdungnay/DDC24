# Implementation Plan — MK-DDC-24
## Kế hoạch Hiện thực: Phase → Task → Microtask → Checklist I/O

> **Document ID:** KX-DDC24-PM-IMPLPLAN-001
> **Phiên bản:** 1.1 | 2026-06-08 · **Trạng thái:** Active · **Owner:** PM + Tech Leads
> **Chuẩn:** ISO/IEC/IEEE 12207 (vòng đời), V-Model, Scrum/Kanban
> 📘 [docs/README](../README.md) · Thiết kế: [README](../02_design/README.md) ·
> Nguồn-chuẩn scope: [REVA_SCOPE_ROADMAP](../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md), [ADR-008](../adr/ADR-008-bms-edge-positioning-and-revA-component-set.md)

> 🎯 **Tài liệu này để làm gì:** một dev (FW/BE/FE/UX) mở ra là biết **làm gì trước, làm gì sau, mỗi việc bắt đầu cần gì (INPUT) và xong nghĩa là gì (OUTPUT/Definition of Done)**. Mỗi microtask là 1 checkbox tick được.

---

## 1. Cách đọc plan này

- **Phase (P0–P7):** mốc lớn, có *cổng vào (Entry)* và *cổng ra (Exit/Gate)*.
- **Task (T-xx-NN):** một hạng mục công việc, gắn 1 discipline (FW/BE/FE/UX/INT).
- **Microtask:** việc nhỏ tick `[ ]` được trong 0.5–2 ngày.
- **INPUT checklist:** thứ phải có TRƯỚC khi bắt đầu (tài liệu, phần cứng, quyết định).
- **OUTPUT / DoD:** bằng chứng việc đã XONG (code + test + doc).
- **Trace:** REQ ID liên quan (để truy vết PRD→…→Test).

**Ký hiệu discipline:** `FW`=Firmware · `BE`=Backend · `FE`=Frontend · `UX`=UI/UX · `INT`=Integration/QA · `OPS`=DevOps.

---

## 2. Phương pháp & nhịp
- **Sprint 2 tuần**, Kanban cho bug. Mỗi sprint: planning → daily → review → retro.
- **Definition of Ready (DoR)** cho task: có INPUT đủ + ước lượng + acceptance criteria.
- **Definition of Done (DoD) chung** (mọi task):
  - [ ] Code theo coding standard ([FW](../02_design/firmware/FW_CODING_STANDARD_MK-DDC-24_VI.md) / [SW](../02_design/software/SW_CODING_STANDARD_MK-DDC-24_VI.md)).
  - [ ] Unit test viết + pass; coverage core ≥ 80%.
  - [ ] Static analysis (cppcheck/MISRA · ruff/mypy · eslint/tsc) 0 lỗi.
  - [ ] PR có **REQ ID** + **design unit**, ≥1 reviewer duyệt.
  - [ ] Tài liệu/CHANGELOG cập nhật nếu đổi interface/behaviour.
  - [ ] Trace matrix cập nhật.

---

## 3. Bản đồ Phase & đường găng (critical path)

> ℹ️ **Kế hoạch Rev A.0 chính thức là §3.0 ngay dưới** (canonical, khớp
> [Decision Log](../00_governance/DECISIONS.md) + [REVA_SCOPE_ROADMAP](../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) + [ADR-008](../adr/ADR-008-bms-edge-positioning-and-revA-component-set.md)).
> §3.1 phía dưới là **plan cũ P0–P7 viết trước pivot** (đường găng PLC→Web IDE→HMI→OTA→BTL) —
> giữ làm **tham chiếu lịch sử**. PLC/FBD/OTA/MQTT/BTL của plan cũ vẫn deferred;
> HMI local hiện là feature-gated Rev A theo ADR-016 và chỉ theo task HOP-000..077.

### 3.0 Rev A.0 Phase Plan (canonical — 90 ngày, demo/lab-grade)

```
Phase 0  Documentation reconciliation            (đã làm phần lớn)
Phase 1  mkddc-core skeleton                      (scan loop, plan rỗng, IO simulator)
Phase 2  Component model + graph.json             (engine + validator v1)
Phase 3  mkddc-iobus protocol integration         (IOP/MCU + Modbus RTU/TCP + BACnet/IP)
Phase 4  mkddc-web CRUD + import/export JSON       (REST + form config + deploy graph)
Phase 5  Fixed component library (28 type)        (đủ bộ Rev A gồm Interlock/AlarmDelay/
                                                    RuntimeCounter/PulseCounter + priority/
                                                    safe-state + snapshot — ADR-008)
Phase 6  3-domain demo + test report              (HVAC mini · Pump/Water · Energy/Gateway —
                                                    REVA_SCOPE §6, examples/ + commissioning report)
```

ĐƯỜNG GĂNG Rev A.0: `graph.json spec → mkddc-core engine → mkddc-iobus (BACnet+Modbus) → 3-domain demo`.

**KHÔNG thuộc Rev A.0:** IEC 61131-3 PLC runtime · Web IDE FBD/ST canvas · HMI · OTA ·
MQTT/cloud · BTL certification. (Xem REVA_SCOPE §3.)

---

### 3.1 Plan cũ P0–P7 *(pre-pivot — tham chiếu / Deferred)*

```
P0 Setup ─► P1 Skeleton ─► P2 I/O Path ─► P3 Protocols ─► P4 Control+UI ─► P5 Sec+OTA ─► P6 Integration+Cert ─► P7 Release
```

| Phase | Tên | Exit Gate | Rev A.0? |
|-------|-----|-----------|:--------:|
| **P0** | Setup & Hạ tầng | repo+CI, board bring-up | ✅ (rút gọn) |
| **P1** | Skeleton/Khung | MCU↔SOM handshake IOP | ✅ |
| **P2** | I/O Path | đọc 16 UI + ghi AO/DO; no base-SKU DI | ✅ |
| **P3** | Protocols | BACnet/IP + RTU master *(MQTT → Rev B)* | ✅ một phần |
| **P4** | Control + UI | component graph + web form/JSON; local HMI included by 2026-06-27 Rev A amendment | ✅ updated |
| **P5** | ~~Security + OTA~~ | TLS/JWT/audit ✅; **OTA → Rev B** | ⚠️ một phần |
| **P6** | ~~Integration + **BTL cert**~~ | FAT/SAT demo ✅; **BTL → không thuộc Rev A.0** | ⚠️ một phần |
| **P7** | Release (GA) | → Rev A.1+ | ❌ |

> Mốc tương đối (Sprint). Bảng này là **legacy mapping**; nguồn-chuẩn là §3.0.

---

## 4. PHASE P0 — Setup & Hạ tầng

### T-OPS-01 — Khởi tạo repo & quy ước (OPS)
**INPUT:** [ ] DOC_CONTROL chuẩn · [ ] danh sách thành viên/quyền.
**Microtasks:**
- [ ] Tạo mono-repo: `fw/`, `services/`, `webide/`, `infra/`, `docs/` (symlink/quy chiếu).
- [ ] Bật branch protection, mẫu PR (REQ ID + design unit), CODEOWNERS.
- [ ] Thiết lập commit convention (Conventional Commits).
**OUTPUT/DoD:** [ ] repo có cấu trúc + README mỗi thư mục · [ ] PR template hoạt động.
**Trace:** doc-control.

### T-OPS-02 — CI/CD pipeline (OPS)
**INPUT:** [ ] toolchain list (design plan §8).
**Microtasks:**
- [ ] CI FW: build arm-gcc `-Werror` + cppcheck/MISRA + Unity test (host).
- [ ] CI BE: ruff + mypy + pytest + coverage gate 80%.
- [ ] CI FE: eslint + tsc + vitest.
- [ ] CI Security: trivy/grype dependency scan + SBOM.
- [ ] Artifact: ảnh rootfs + firmware bin + `.kxpkg`.
**OUTPUT/DoD:** [ ] mọi push chạy CI xanh · [ ] coverage report tự đăng PR.
**Trace:** SEC-001/002, TEST-001.

### T-FW-01 — Board bring-up MCU (FW)
**INPUT:** [ ] board mẫu/EVB · [ ] [D-1 Pinout](../02_design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) · [ ] ST-Link.
**Microtasks:**
- [ ] Tạo project CubeMX theo D-1 (clock 64MHz HSE, GPIO, USART1/SPI1/SPI3, DMA).
- [ ] Blink MCU_LED (PD6) + log USART2 115200.
- [ ] Verify pinmux không xung đột (so D-1 §3).
**OUTPUT/DoD:** [ ] nạp chạy, LED nhấp nháy, log ra UART · [ ] `.ioc` commit.
**Trace:** D-1, FW-BOOT.

### T-OPS-03 — SOM bring-up Debian (OPS/BE)
**INPUT:** [ ] CM3 + carrier · [ ] image Debian 12.
**Microtasks:**
- [ ] Flash Debian + kernel PREEMPT_RT; verify `uname -a` có RT.
- [ ] Cấu hình OverlayFS read-only rootfs + `/data` ghi.
- [ ] UART map MCU (`/dev/ttySx`) + quyền.
**OUTPUT/DoD:** [ ] SSH (2222) vào được · [ ] `/dev/ttySx` tồn tại · [ ] rootfs RO xác nhận.
**Trace:** OS-001..004.

**🚪 P0 Gate:** repo+CI xanh, MCU blink, SOM boot RT, UART thông.

---

## 5. PHASE P1 — Skeleton / Khung chạy được

### T-FW-02 — Khung FreeRTOS + task rỗng (FW)
**INPUT:** [ ] T-FW-01 · [ ] [FW_DDD §3](../02_design/firmware/FW_DDD_MK-DDC-24_VI.md).
**Microtasks:**
- [ ] Tạo 6 task rỗng (io_sample, iop_comm, ao_output, do_control, diagnostics, watchdog) đúng priority/period FW_ARCH §2.
- [ ] Heartbeat flag mỗi task; IWDG kick ở watchdog_task.
- [ ] Đo stack high-water-mark.
**OUTPUT/DoD:** [ ] 6 task chạy, watchdog kick, không reset · [ ] stack report.
**Trace:** FW_ARCH §2, FW-WDG.

### T-FW-03 — IOP slave: handshake + CRC (FW) ⭐ đường găng
**INPUT:** [ ] [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) · [ ] [FW_MOD_IOP_COMM](../02_design/firmware/FW_MOD_IOP_COMM_MK-DDC-24_VI.md).
**Microtasks:**
- [ ] `crc16_modbus()` + pass 10 test vector (khớp BE).
- [ ] RX UART IDLE+DMA → parse frame → verify CRC/SEQ.
- [ ] Xử lý HANDSHAKE → HANDSHAKE_RESP (version).
- [ ] TX DMA build frame.
**OUTPUT/DoD:** [ ] PC test gửi HANDSHAKE → nhận RESP đúng CRC · [ ] unit test parse pass.
**Trace:** IOP-FW-001..010.

### T-BE-01 — IOP master: handshake + CRC (BE) ⭐ đường găng
**INPUT:** [ ] [SW_IODRIVER_DESIGN](../02_design/software/SW_IODRIVER_DESIGN_MK-DDC-24_VI.md) · [ ] cùng CRC test vector.
**Microtasks:**
- [ ] Mở UART 921600, `crc16` khớp FW.
- [ ] Gửi HANDSHAKE, nhận RESP, kiểm version.
- [ ] Khung vòng lặp SCHED_FIFO 70 (chưa GET_IO).
**OUTPUT/DoD:** [ ] handshake với MCU thật thành công · [ ] log version 2 bên khớp.
**Trace:** SW-IOP-001..003.

### T-BE-02 — Shared memory + systemd skeleton (BE)
**INPUT:** [ ] [SW_ARCH §2](../01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md).
**Microtasks:**
- [ ] Định nghĩa `kinexus_io_shm_t`, `kinexus_plc_shm_t` (header chung).
- [ ] Seqlock write/read helper + test reader đồng thời.
- [ ] systemd unit cho từng service (skeleton) + `sd_notify`.
**OUTPUT/DoD:** [ ] shm tạo, reader/writer không corrupt · [ ] `systemctl status` xanh.
**Trace:** SW-IOP-006, OS-005.

**🚪 P1 Gate:** **MCU↔SOM handshake IOP OK** (đường găng mở), shm chạy, services khởi động.

---

## 6. PHASE P2 — I/O Path (đọc cảm biến → ghi đầu ra)

### T-FW-04 — Đọc ADS131M08 + DI (FW)
**INPUT:** [ ] [FW_MOD_IO_SAMPLE](../02_design/firmware/FW_MOD_IO_SAMPLE_MK-DDC-24_VI.md) · [ ] D-1.
**Microtasks:**
- [ ] Init 2× ADS131M08 (SPI3, CS/DRDY độc lập), đọc 16 kênh DMA 1ms.
- [ ] Sign-extend 16×s24; moving-average/status per ADC; auxiliary dry-contact debounce theo mode.
- [ ] Ghi `io_data_buf` (mutex).
**OUTPUT/DoD:** [ ] chu kỳ ≤1ms (scope CS) · [ ] giá trị raw hợp lý khi đổi input · [ ] ADC_FAULT khi rút cáp.
**Trace:** FW-IO-001..024.

### T-FW-05 — GET_IO → IO_RESP (FW)
**INPUT:** [ ] T-FW-03, T-FW-04.
**Microtasks:**
- [ ] Build IO_RESP v2 payload 74 byte từ snapshot.
- [ ] Đáp GET_IO trong response timeout 3ms; IOP watchdog 200ms → safe-state.
**OUTPUT/DoD:** [ ] BE đọc được 16 UI signed + ADC status, no base DI_MASK · [ ] latency distribution đo được.
**Trace:** IOP-FW, FW-WDG-005.

### T-FW-06 — SET_AO / SET_DO + safe-state (FW)
**INPUT:** [ ] [FW_MOD_AO_DO](../02_design/firmware/FW_MOD_AO_DO_MK-DDC-24_VI.md).
**Microtasks:**
- [ ] Ghi DAC8554 (SPI1) + LDAC; validate range.
- [ ] Relay ULN2003 + feedback + stuck-detect + rate-limit.
- [ ] RESET_IO → AO 0V/4mA, DO open.
**OUTPUT/DoD:** [ ] đặt AO 5V đo đúng ±0.1V · [ ] relay đóng/mở + feedback · [ ] safe-state đúng.
**Trace:** FW-AO, FW-DO.

### T-BE-03 — GET_IO loop + scaling (BE) ⭐
**INPUT:** [ ] T-BE-01, T-FW-05 · [ ] [SW_ARCH §4 scaling].
**Microtasks:**
- [ ] Poll GET_IO 2ms/500Hz, parse, retry×3 → fault FSM theo shared constants.
- [ ] Scale raw→eng: 0-10V, 4-20mA, NTC, auxiliary dry contact; không expose PT100/PT1000 Rev A.
- [ ] Ghi `kinexus_io_shm`; metrics crc/timeout.
**OUTPUT/DoD:** [ ] shm có giá trị °C/V đúng (so chuẩn) · [ ] mất MCU → IOP_FAULT→SAFE_STATE.
**Trace:** SW-IOP-004..011.

### T-BE-04 — Ghi AO/DO từ shm (BE)
**INPUT:** [ ] T-BE-03, T-FW-06.
**Microtasks:**
- [ ] Đọc setpoint shm, eng→raw, gửi SET_AO/SET_DO khi đổi.
- [ ] Gửi SET_AO_CFG theo `io_config.conf`.
**OUTPUT/DoD:** [ ] ghi AO qua shm → đầu ra đổi đúng · [ ] mode V/mA chuyển đúng.
**Trace:** SW-IOP, FW-AO-007.

### T-UX-01 — Per-channel sensor-mode UX flow (UX, song song)
**INPUT:** [ ] FW-IO-010 mode contract.
**Microtasks:**
- [ ] Flow cấu hình/confirm mode riêng cho UI1-UI16.
- [ ] Wireframe trạng thái good/uncertain/fault.
**OUTPUT/DoD:** [ ] wireframe duyệt bởi PO (đưa vào UX_WEBIDE).
**Trace:** FW-IO-010..012.

**🚪 P2 Gate:** **đọc 16 UI (đúng đơn vị) + ghi AO/DO end-to-end qua shm**; capability map và safe-state hoạt động.

---

## 7. PHASE P3 — Protocols (BACnet/IP · REST/MQTT · Fieldbus RTU master)

### T-BE-05 — Modbus RTU **master** / field bus (BE)
**INPUT:** [ ] [D-2 RTU Master/Expansion](../02_design/interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md) · [ ] [SW_FIELDBUS_DESIGN](../02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md) · [ ] slave giả lập (diagslave).
**Microtasks:**
- [ ] libmodbus master mở RS-485; poll scheduler theo `fieldbus.conf`.
- [ ] Device-profile engine (decode type/scale/byte_order) → ghi shm vùng ext.
- [ ] Ghi xuống slave (FC06/16); phát hiện offline → bad quality + E302/E303.
**OUTPUT/DoD:** [ ] poll module mở rộng giả lập → điểm vào shm/PLC · [ ] rút slave → offline+alarm · [ ] ghi DO module đổi đầu ra. *(DDC KHÔNG là Modbus slave.)*
**Trace:** SW-MOD-001..011, RTU-001..008.

### T-BE-06 — BACnet/IP objects + COV (BE) ⭐ đường găng (cert)
**INPUT:** [ ] [D-3 PICS](../02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md) · [ ] bacnet-stack.
**Microtasks:**
- [ ] Đăng ký AI8/AO4/AV32/BI8/BO4/BV16/MSV8 + Device object.
- [ ] Read/Write-Property(-Multiple) ↔ plc_shm (priority array).
- [ ] COV subscribe/notify; Who-Is/I-Am <100ms.
- [ ] **BACnet/IP** 47808 (Ethernet/WiFi) + BBMD/FD; Reliability map fault. *(MS/TP bỏ.)*
**OUTPUT/DoD:** [ ] YABE đọc/ghi object đúng · [ ] COV nhận ≤200ms · [ ] Who-Is trả I-Am.
**Trace:** SW-BAC-001..008.

### T-BE-07 — REST API (BE)
**INPUT:** [ ] [D-4 OpenAPI](../02_design/interfaces/openapi.yaml).
**Microtasks:**
- [ ] FastAPI theo openapi.yaml: /auth, /points, /system, /alarms.
- [ ] Đọc/ghi point qua shm + validate range.
- [ ] Error `{error,code,request_id}`, rate-limit 100/s→429.
**OUTPUT/DoD:** [ ] Swagger `/docs` khớp openapi.yaml (CI diff) · [ ] curl đọc/ghi point OK.
**Trace:** SW-API-001..010.

### T-BE-08 — MQTT agent (BE) ⛔ *Deferred Rev B — MQTT/cloud KHÔNG thuộc Rev A.0*
**INPUT:** [ ] [SW_AGENT_DESIGN](../02_design/software/SW_AGENT_DESIGN_MK-DDC-24_VI.md), `mqtt.conf`.
**Microtasks:**
- [ ] Kết nối TLS 8883, LWT, reconnect backoff.
- [ ] Publish COV topic `kinexus/{id}/io/{point}`.
**OUTPUT/DoD:** [ ] broker thấy giá trị cập nhật theo COV · [ ] mất mạng → reconnect.
**Trace:** SW-MQ-001..007.

**🚪 P3 Gate (Rev A.0):** **BACnet/IP + REST + Modbus RTU master/TCP hoạt động** (chưa logic điều khiển). *(MQTT → Rev B.)*

---

## 8. PHASE P4 — Control Engine + Giao diện

### T-BE-09 — Component graph scan engine (BE) ⭐ đường găng
**INPUT:** [ ] [D-6 Runtime Execution Model](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) · [ ] [Component Library](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md) (DEC-001 đã chốt: [ADR-004](../adr/ADR-004-component-based-runtime.md)).
**Microtasks:**
- [ ] Build execution plan (topo-sort) + ảnh I/O (snapshot→execute→write).
- [ ] Scan SCHED_FIFO, scan 1s, đo budget + overrun count.
- [ ] Component chuẩn: OnDelay/OffDelay/Compare/Scale/Limit/PID (~24 type, xem Component Library).
- [ ] PID anti-windup; priority resolver + safe-state.
- [ ] State snapshot `/data/mkddc/state.snap` (60s + shutdown) + power-loss recovery.
**OUTPUT/DoD:** [ ] chạy graph nhiều node · [ ] PID step settle ±2% ≤30s · [ ] power-loss recovery OK.
**Trace:** RUN-001..009.

### T-BE-10 — Write arbitration + alarm bus (BE)
**INPUT:** [ ] D-6 §7, SRS §13 fault catalog.
**Microtasks:**
- [ ] Priority array 16 mức (PLC/BMS/force).
- [ ] alarm.sock JSON → fanout BACnet NC/MQTT/HMI.
**OUTPUT/DoD:** [ ] force I/O override đúng ưu tiên · [ ] alarm hiện ở 3 kênh.
**Trace:** SW-PLC-020, SEC.

### T-UX-02 — Web config UX (UX) ⚠️ *Rev A: form/JSON. FBD/ST canvas → Deferred Rev B*
**INPUT:** [ ] [Design System](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) · [ ] requirement IDE.
**Microtasks:**
- [ ] Wireframe + flow: login, FBD editor, ST editor, I/O config, watch table, force I/O, user mgmt.
- [ ] Trạng thái quality/fault/alarm, responsive.
- [ ] Spec component (button, table, gauge, modal) + tokens.
**OUTPUT/DoD:** [ ] bộ wireframe + design tokens duyệt PO · [ ] handoff cho FE (props/state).
**Trace:** IDE-001..034.

### T-FE-01 — Web IDE khung + auth (FE)
**INPUT:** [ ] T-UX-02 · [ ] [D-4 REST] · [ ] [UX_WEBIDE].
**Microtasks:**
- [ ] Svelte SPA, routing, gọi REST, JWT lưu httpOnly.
- [ ] Login + role-based menu (admin/operator/viewer).
- [ ] Layout theo design system.
**OUTPUT/DoD:** [ ] login chạy, menu theo role, gọi /points hiển thị · [ ] eslint/tsc sạch.
**Trace:** SW-IDE-001..005.

### T-FE-02 — I/O config + watch + force (FE)
**INPUT:** [ ] [D-5 Config](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md).
**Microtasks:**
- [ ] Form cấu hình UI sensor/AO mode (validate JSON schema D-5).
- [ ] Watch table realtime (WebSocket), live I/O dashboard ≤1s.
- [ ] Force I/O (admin) + auto-expire 10' + cảnh báo.
**OUTPUT/DoD:** [ ] đổi sensor type lưu file đúng schema · [ ] watch cập nhật realtime · [ ] force expire.
**Trace:** SW-IDE-010..015.

### T-FE-03 — ~~FBD/ST editor~~ → **Rev A: import/export `graph.json`** ⚠️ *(FBD canvas Deferred Rev B)*
**INPUT:** [ ] [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md).
**Microtasks (Rev A.0):**
- [ ] UI import/export `graph.json`; xem read-only danh sách node/link.
- [ ] Gọi `/graph/validate` + `/graph/deploy` (REST).
**OUTPUT/DoD:** [ ] import graph hợp lệ → validate → deploy → core chạy.
**Trace:** SW-WEB-006..009.
> *FBD drag-drop canvas (wiresheet) → Rev B.*

### T-FW/BE-11 — HMI TFT local limited-operator *(feature-gated Rev A, ADR-016)*
**INPUT:** [ ] [UX_HMI](../04_uiux/KX-DDC24-UX-HMI-001_VI.md) · [ ] [SW_HMI_DESIGN](../02_design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md).
**Microtasks:**
- [ ] Thực hiện HOP-000..077 theo [08 HMI guide](../03_implementation/08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md); không duplicate task tại đây.
- [ ] JD9852 MIPI DSI/DRM + FT5436 + 6 nút; giữ SHM read-only.
- [ ] 5 surface Home/Points/Control/Alarms/Service; command whitelist qua broker/core.
- [ ] Gỡ static role/PIN privilege, direct signal/reboot và CAP_SYS_BOOT.
**OUTPUT/DoD:** [ ] host/integration pass · [ ] target ≥10 FPS/touch/buttons/usability pass · [ ] HMI release gate có evidence.
**Trace:** HMI-001..032, SW-HMI-001..018, ADR-016.

**🚪 P4 Gate (Rev A.0):** component graph + web form/JSON + deploy graph.json; HMI chỉ nằm trong gate của SKU/build enable và không được làm chậm control baseline. *(PLC FBD → Rev C.)*

---

## 9. PHASE P5 — Security + OTA

### T-BE-12 — Security hardening (BE/SEC)
**INPUT:** [ ] [D-11 Security](../02_design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md) · [ ] **chốt SW-Q-004**.
**Microtasks:**
- [ ] TLS 1.3 mọi mặt; JWT secret từ key store (OP-TEE/fallback).
- [ ] nftables policy (1883 chặn), AppArmor, SSH 2222 key-only.
- [ ] bcrypt + lockout 5/15'; audit log.
**OUTPUT/DoD:** [ ] nmap chỉ thấy port cho phép · [ ] brute-force bị khóa · [ ] audit ghi đủ.
**Trace:** SEC-020..025, SW-SEC.

### T-OPS-04 — OTA A/B + rollback (OPS/FW) ⛔ *Deferred Rev B — OTA không thuộc Rev A.0*
**INPUT:** [ ] [D-7 OTA](../02_design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md) + [FW_BOOTLOADER_OTA] · [ ] **chốt SW-Q-005**.
**Microtasks:**
- [ ] Phân vùng A/B + U-Boot env + verified boot.
- [ ] `.kxpkg` verify GPG+sha256, anti-downgrade.
- [ ] Nạp MCU qua bootloader (AN3155) sau safe-state.
- [ ] Health-check + rollback 2 lần fail.
**OUTPUT/DoD:** [ ] OTA thành công downtime ≤60s · [ ] gói hỏng → từ chối · [ ] fail → rollback tự động.
**Trace:** OTA-001..008, FW-OTA-001..005.

**🚪 P5 Gate (Rev A.0):** **bảo mật đạt baseline (TLS/JWT/audit)**. *(OTA A/B → Rev B.)*

---

## 10. PHASE P6 — Integration, V&V, Certification

### T-INT-01 — Integration test toàn hệ (INT)
**INPUT:** [ ] [TEST_SPEC](../01_specs/TEST_SPEC_MK-DDC-24_VI.md) L1–L6.
**Microtasks:**
- [ ] End-to-end: sensor→MCU→SOM→PLC→BACnet/IP/MQTT→BMS; + thiết bị phụ qua RTU master.
- [ ] Fault injection: mất IOP, mất BMS, power-fail retain.
- [ ] Performance: latency, jitter, 5 client Modbus, COV load.
**OUTPUT/DoD:** [ ] tất cả test case L1–L4 pass · [ ] báo cáo kết quả.
**Trace:** TEST_SPEC §all.

### T-INT-02 — FAT / SAT (INT)
**INPUT:** [ ] checklist FAT/SAT.
**OUTPUT/DoD:** [ ] FAT pass (xưởng) · [ ] SAT pass (hiện trường mẫu).

### T-INT-03 — BTL Certification (INT) ⛔ *KHÔNG thuộc Rev A.0 — Rev A.0 chỉ cần BACnet interop demo*
**INPUT:** [ ] BACnet pass nội bộ · [ ] đăng ký lab (EXT-002).
**Microtasks:**
- [ ] Chạy BTL Test Tool 100% B-ASC.
- [ ] Nộp lab + xử lý finding.
**OUTPUT/DoD:** [ ] **BTL listing đạt** (NFR-009).
**Trace:** BAC, NFR-009.

### T-INT-04 — Soak / Reliability (INT)
**OUTPUT/DoD:** [ ] chạy liên tục **72h** không lỗi/leak/reset (NFR MTBF).

**🚪 P6 Gate (Rev A.0):** **demo §22 (12 điểm) pass + commissioning report + soak power-loss/mất-BMS**. *(BTL pass + soak 72h production → Rev A.1+.)*

---

## 11. PHASE P7 — Release (GA)

### T-OPS-05 — Release & hồ sơ (OPS/QA)
**Microtasks:**
- [ ] SBOM + dependency scan sạch (CVE≥7 vá).
- [ ] Release notes + CHANGELOG bump version.
- [ ] User manual, commissioning guide, datasheet final.
- [ ] Pentest report (SEC-004) + sign-off.
**OUTPUT/DoD:** [ ] hồ sơ release đầy đủ · [ ] **GA sign-off** (PM+QA+Leads).
**Trace:** SEC-003/004, NFR.

---

## 12. Roadmap theo track (tóm tắt ai làm gì khi nào)

| Sprint | FW | BE | FE | UX | OPS/INT |
|--------|----|----|----|----|---------|
| S1 | bring-up, FreeRTOS | — | — | design system | repo, CI |
| S2 | IOP slave, ADC | IOP master, shm | — | Web IDE wireframe | SOM RT |
| S3 | AO/DO, safe-state | scaling, AO/DO | IDE khung+auth | I/O config UX | CI gates |
| S4 | tinh chỉnh I/O | Fieldbus RTU, REST | I/O config+watch | HMI wireframe | — |
| S5 | hỗ trợ HMI | BACnet, MQTT | FBD/ST editor | review | — |
| S6–7 | OTA bootloader | PLC engine | editor hoàn thiện | handoff | — |
| S8 | — | security | HMI screens | — | integration |
| S9 | — | OTA | polish | — | FAT |
| S10–12 | bugfix | bugfix | bugfix | — | SAT, BTL, soak, GA |

---

## 13. Quyết định CHẶN (phải chốt đúng hạn — nếu không trượt đường găng)
| ID | Quyết định | Chặn task | Hạn |
|----|-----------|-----------|-----|
| DEC-001 | PLC engine: tự build vs OpenPLC | T-BE-09 | trước S5 |
| SW-Q-004 | Key store: OP-TEE/TPM/encrypted | T-BE-12 | trước S8 |
| SW-Q-005 | OTA server endpoint + cert pinning | T-OPS-04 | trước S8 |
| EXT-002 | Đặt lịch BTL lab (lead 4–6 tuần) | T-INT-03 | trước S8 |
| HW-Q-002 | CM3 extended-temp | (HW, không chặn SW/FW) | — |

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | PM + Tech Leads | Phát hành đầu — P0–P7, task/microtask/checklist FW/BE/FE/UX |
