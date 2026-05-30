# MK-DDC-24 — Bộ tài liệu SW/FW Spec (`spec/`)
## Hướng dẫn đọc cho đội Phát triển

> 🧭 Đây là cổng **kỹ thuật** (yêu cầu + kiến trúc). Cổng **quản lý theo ISO** (plan, register, UI/UX, changelog) ở [docs/README](../docs/README.md). Thiết kế chi tiết ở [design/README](../design/README.md).

> **Phiên bản:** 1.0 | 2026-05-30
> **Trạng thái:** Đã đồng bộ sau Design-Readiness Review (P0+P1+P2 closed)
> **Đối tượng:** Kỹ sư Firmware (MCU), Software (SOM/Debian), QA, System Architect

---

## 1. Bắt đầu từ đâu? (thứ tự đọc đề xuất)

### 👉 Ai cũng đọc trước (30 phút)
1. **[../README.md](../README.md)** — tổng quan sản phẩm + kiến trúc dual-layer.
2. **[DESIGN_READINESS_REVIEW…](DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md)** — *các quyết định kiến trúc đã chốt* + những điểm từng mâu thuẫn (đọc để không lặp lại hiểu lầm cũ).
3. **[OPEN_ISSUES…](OPEN_ISSUES_MK-DDC-24_VI.md)** §7 *Resolved* + §5 *Decisions* — chốt gì, vì sao.

### 👉 Kỹ sư Firmware (MCU STM32G0B1)
| Thứ tự | Tài liệu | Bạn lấy được gì |
|:---:|----------|-----------------|
| 1 | [FW_REQUIREMENTS](FW_REQUIREMENTS_MK-DDC-24_VI.md) | Phải làm gì (requirement có ID, có test ref) |
| 2 | [SWFW_INTERFACE_SPEC](SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | **Hợp đồng giao tiếp với SOM** (IOP) — nguồn chuẩn DUY NHẤT |
| 3 | [FW_ARCH_SPEC](FW_ARCH_SPEC_MK-DDC-24_VI.md) | Task model, ISR, memory map, FSM — làm thế nào |
| 4 | [../hardware-design/05_mcu_io/MCU_STM32G0_SPEC.md](../hardware-design/05_mcu_io/MCU_STM32G0_SPEC.md) | **Pinout MCU chuẩn** + clock + ngoại vi |

### 👉 Kỹ sư Software (SOM/Debian)
| Thứ tự | Tài liệu | Bạn lấy được gì |
|:---:|----------|-----------------|
| 1 | [SW_REQUIREMENTS](SW_REQUIREMENTS_MK-DDC-24_VI.md) | Requirement theo từng module (có owner, ngôn ngữ) |
| 2 | [SW_ARCH_SPEC](SW_ARCH_SPEC_MK-DDC-24_VI.md) | Process model, IPC (shm+seqlock), data flow, REST, config |
| 3 | [SWFW_INTERFACE_SPEC](SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | Cách nói chuyện với MCU |
| 4 | [../SRS…](../SRS_MK-DDC-24_VI.md) | Yêu cầu cấp cao (BACnet PICS, fault codes, HMI, IDE) |

### 👉 QA / Test
[TEST_SPEC](TEST_SPEC_MK-DDC-24_VI.md) → traceability PRD→SRS→Spec→Test + release gates.

---

## 2. Bản đồ tài liệu (file nào nói về cái gì)

```
                 ┌─────────────────────────────────────────────┐
   CẤP YÊU CẦU   │ PRD (mục tiêu, FR/NFR)                       │
   (../)         │ SRS (OS, PLC, BACnet, MQTT, security, HMI)   │
                 │ DS  (datasheet, Modbus map CHUẨN §4.1)       │
                 │ HW_SPEC (phần cứng top-level)                │
                 └───────────────┬─────────────────────────────┘
                                 │ phân rã xuống
        ┌────────────────────────┼─────────────────────────┐
        ▼                        ▼                          ▼
 ┌─────────────┐        ┌────────────────┐         ┌────────────────┐
 │ FW_REQ      │        │ SWFW_INTERFACE │◄───────►│ SW_REQ         │
 │ FW_ARCH     │◄──────►│ (IOP — HỢP ĐỒNG│         │ SW_ARCH        │
 │ (MCU)       │  IOP   │  SOM↔MCU)      │  IOP    │ (SOM)          │
 └─────────────┘        └────────────────┘         └────────────────┘
        └───────────────────────┬─────────────────────────┘
                                ▼
                         ┌──────────────┐
                         │ TEST_SPEC    │  (kiểm chứng tất cả)
                         │ OPEN_ISSUES  │  (rủi ro/quyết định)
                         │ REVIEW       │  (audit chéo)
                         └──────────────┘
```

| File | Vai trò | Nguồn-chuẩn của… |
|------|---------|------------------|
| `SWFW_INTERFACE_SPEC` | Giao thức IOP SOM↔MCU | **Frame, CRC, command, timing, fault FSM** |
| `FW_REQUIREMENTS` | Yêu cầu FW | I/O sampling, AO/DO, watchdog, boot, OTA |
| `FW_ARCH_SPEC` | Kiến trúc FW | **Task model, ISR, memory map, FSM** |
| `SW_REQUIREMENTS` | Yêu cầu SW theo module | 8 service, Modbus, Web IDE |
| `SW_ARCH_SPEC` | Kiến trúc SW | **IPC/shm, data flow, REST endpoints, scaling** |
| `TEST_SPEC` | Test & traceability | L1–L6, FAT/SAT, release gate |
| `OPEN_ISSUES` | Rủi ro/quyết định | Decision log (R001–R009) |
| `DESIGN_READINESS_REVIEW` | Audit chéo | Findings + khoảng trống thiết kế |
| `DESIGN_PLAN_SWFW` | Kế hoạch thiết kế | Deliverables D-1…D-11, tiêu chuẩn, gate |

---

## 3. Nguồn-chuẩn DUY NHẤT (Single Source of Truth)

> ⚠️ Khi hai tài liệu nói khác nhau về cùng một thứ, **luôn theo nguồn-chuẩn dưới đây**. Đừng copy số liệu — hãy trỏ link.

| Chủ đề | Nguồn-chuẩn DUY NHẤT |
|--------|----------------------|
| Giao thức IOP (frame/CRC/CMD/timing) | `SWFW_INTERFACE_SPEC` |
| Pinout MCU STM32G0B1 | `hardware-design/05_mcu_io/MCU_STM32G0_SPEC.md §3` |
| Modbus register map | `DS §4.1` |
| Task model / memory map FW | `FW_ARCH_SPEC §2, §5` |
| Shared-memory layout (shm) | `SW_ARCH_SPEC §2` + `SWFW_INTERFACE` (io_shm) |
| Quyết định kiến trúc | `OPEN_ISSUES §5, §7` |
| Kiến trúc ADC | **MCU đọc ADS131M08 (SPI3)**, CM3 không nối ADC |

---

## 4. Glossary / Từ viết tắt

| Thuật ngữ | Nghĩa |
|-----------|-------|
| **SOM** | System-on-Module — Radxa CM3 (RK3566) chạy Debian 12, lớp application |
| **MCU** | STM32G0B1RBT6 (Cortex-M0+), lớp I/O real-time, FreeRTOS |
| **IOP** | Kinexus-IOP — giao thức UART 921.6k giữa SOM (master) và MCU (slave) |
| **UI** | Universal Input — 8 kênh đa loại (0–10V/4–20mA/PT100/PT1000/NTC/dry) |
| **DI / DO** | Digital Input (8, opto 24V) / Digital Output (4, relay SPDT) |
| **AO** | Analog Output (4, 0–10V hoặc 4–20mA, DAC8554 16-bit) |
| **ADS131M08** | ADC 24-bit 8 kênh (do MCU đọc qua SPI3) |
| **DAC8554** | DAC 16-bit 4 kênh (MCU ghi qua SPI1) |
| **seqlock** | Cơ chế đọc-ghi shared memory không khóa (reader không block writer) |
| **COV** | Change-Of-Value — BACnet notification khi giá trị đổi |
| **BTL** | BACnet Testing Laboratories — chứng nhận conformance |
| **PICS / EPICS** | Protocol Implementation Conformance Statement |
| **A/B partition** | Hai phân vùng OS để OTA + rollback an toàn |
| **PREEMPT_RT** | Patch real-time cho kernel Linux |
| **SCHED_FIFO** | Lớp lập lịch real-time của Linux |
| **CVD** | Callendar-Van Dusen — công thức tuyến tính hóa RTD |
| **DDD / SDD** | Detailed/Software Design Document |
| **D-1…D-11** | Mã các tài liệu thiết kế còn thiếu (xem REVIEW §5 / DESIGN_PLAN) |

---

## 5. Quy ước trong tài liệu

- **MUST / SHOULD / MAY** — mức bắt buộc (RFC 2119). MUST thiếu = release fail.
- Mỗi requirement có **ID** (vd `FW-IO-001`, `SW-PLC-010`) và **Test Ref** (`T-FW-001`). Khi code, ghi ID vào commit/PR để truy vết.
- Khối ⚠ là cảnh báo/nguồn-chuẩn; khối > là ghi chú.
- Ngày tuyệt đối (YYYY-MM-DD). "Q4/Y7", "Sprint N" là mốc tương đối nội bộ.

---

## 6. Trạng thái hiện tại

| Nhóm | Trạng thái |
|------|-----------|
| Yêu cầu (PRD/SRS/FW-REQ/SW-REQ) | ✅ Ổn định, đã đồng bộ 2026-05-30 |
| Kiến trúc (FW_ARCH/SW_ARCH/IOP) | ✅ Ổn định |
| Mâu thuẫn P0/P1/P2 | ✅ Đã đóng (xem REVIEW) |
| Tài liệu thiết kế chi tiết (D-1…D-11) | 🔄 Đang tạo (xem `../design/`) |
| Quyết định cần đầu vào ngoài | ⏳ HW-Q-002 (CM3 ext-temp), BTL lab, EMC lab |

---

**Tài liệu liên quan:** [DESIGN_PLAN_SWFW](DESIGN_PLAN_SWFW_MK-DDC-24_VI.md) · [../design/README.md](../design/README.md)
