# 00 — Implementation README (đọc đầu tiên)
## MK-DDC-24 — Bộ tài liệu triển khai lập trình thật

> **Document ID:** IMPL-README-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Trạng thái:** Active — tài liệu khởi động giai đoạn implement
> **Đối tượng đọc:** Dev FW_MCU · Dev SOM (iobus/core) · Dev Web/BE · Tester · PM/Lead

---

## 0. Đây là gì

Đây là **file đọc đầu tiên** của thư mục `docs/03_implementation/`. Bộ tài liệu này
**không phải là spec mới**. Nó **chuyển toàn bộ spec hiện có thành hướng dẫn triển khai
thật**: dev đọc vào biết bắt đầu từ file nào, viết module nào, input/output là gì, test ra sao.

Nếu bạn chỉ có 5 phút: đọc §1 → §5 → §6 → §7 của file này, rồi mở
[02_TEAM_WORK_SPLIT](02_TEAM_WORK_SPLIT.md) cho phần việc của bạn.

---

## 1. Dự án đang ở giai đoạn nào

```
[Hardware Rev A] ──► [Spec/Design DONE] ──► ★ BẠN ĐANG Ở ĐÂY: IMPLEMENT THẬT ★ ──► [Bring-up] ──► [Handover]
```

- Phần cứng Rev A đã chốt (`hardware-design/`, `HW_SPEC`).
- Spec & design đã Approved (`docs/01_specs/`, `docs/02_design/`).
- **Mục tiêu giai đoạn này: đưa thiết bị chạy THẬT** — relay thật đóng/mở, AO thật ra
  điện áp/dòng, sensor thật lên web. **Không phải demo, không phải mock.**

> ⚠️ Bất kỳ đường code nào "giả lập IO", "trả số random", "bỏ qua MCU" chỉ được phép tồn
> tại sau cờ `#ifdef MOCK` và **phải bị gỡ trước handover** (xem
> [14_RELEASE_HANDOVER_CHECKLIST](14_RELEASE_HANDOVER_CHECKLIST.md)).

---

## 2. Mục tiêu là chạy thật, không phải demo

| Tiêu chí | Demo (KHÔNG chấp nhận) | Thật (mục tiêu) |
|----------|------------------------|------------------|
| Đọc DI | trả mảng giả | đọc opto PC817 → GPIO MCU → IOP → web |
| Bật DO | log "DO1 ON" | ULN2003 đóng relay vật lý, có DO feedback |
| AO | in giá trị | DAC8554 ra 0–10V/4–20mA đo được bằng đồng hồ |
| Lỗi MCU | bỏ qua | timeout → safe-state → alarm hiển thị trên web |
| Web → IO | gọi thẳng UART | đi qua `mkddc-core` → `mkddc-iobus` → IOP → MCU |

---

## 3. Bốn phần code chính

| Phần | Chạy ở | Ngôn ngữ | Thư mục code | Vai trò 1 dòng |
|------|--------|----------|--------------|----------------|
| **FW_MCU** | STM32G0B1RBT6 / FreeRTOS | C11 | `fw/` | Đọc/ghi IO vật lý real-time, slave IOP |
| **mkddc-iobus** | SOM Debian | C++17 / C | `services/iobus/` | **Master UART/IOP** tới MCU + Modbus/BACnet network |
| **mkddc-core** | SOM Debian (SCHED_FIFO) | C++17 | `services/core/` | Point table + scan loop + graph + priority/safe-state |
| **mkddc-web** | SOM Debian | Go + React | `web/` | REST API + Web UI + config + validator + commissioning |

Nguồn-chuẩn kiến trúc service: [ADR-005](../adr/ADR-005-three-process-architecture.md) ·
[PRODUCT_DEFINITION §6](../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md).

> 📌 **Reconcile quan trọng (đọc kỹ).** ADR-005 mô tả "IO image trong core". Trong bộ
> tài liệu implement này, **`mkddc-iobus` là tiến trình sở hữu cổng UART/IOP tới MCU** và
> **ghi snapshot IO vào shared memory** (`kx_io_shm_t`, hợp đồng `shared/mkddc_shm.h`);
> `mkddc-core` **đọc** snapshot đó. Đây chính là vai trò "io-driver" cũ được gộp vào
> `mkddc-iobus` (ADR-005 ghi rõ "core gộp io-driver + engine" ở mức service, nhưng cổng
> UART vật lý do iobus quản để cô lập I/O chậm/lỗi khỏi vòng real-time của core). Hợp đồng
> seqlock/SHM **giữ nguyên**. Rename `kinexus_shm.h → mkddc_shm.h` **đã thực hiện 2026-06-11**
> (struct/magic giữ nguyên — phạm vi rename chốt tại [15_CONTRACT_FREEZE §6](15_CONTRACT_FREEZE.md)).

---

## 4. Ba nhóm dev

| Nhóm | Người | Sở hữu | Tài liệu chính |
|------|-------|--------|----------------|
| **Dev 1 — FW_MCU** | Dev firmware | `fw/` | [04_FW_MCU](04_FW_MCU_IMPLEMENTATION_GUIDE.md), [05_IOP_UART](05_IOP_UART_IMPLEMENTATION_GUIDE.md) |
| **Dev 2 — SOM/Core/Iobus** | Dev SOM | `services/iobus/`, `services/core/`, `shared/` | [06_IOBUS](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md), [07_CORE](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md), [05_IOP_UART](05_IOP_UART_IMPLEMENTATION_GUIDE.md) |
| **Dev 3 — Web/BE** | Dev web | `web/` | [08_WEB](08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md) |

Phân việc chi tiết: [02_TEAM_WORK_SPLIT](02_TEAM_WORK_SPLIT.md).
Tester & PM: [10_TASK_CHECKLIST](10_TASK_CHECKLIST.md), [11_INTEGRATION_TEST_PLAN](11_INTEGRATION_TEST_PLAN.md),
[12_DEFINITION_OF_DONE](12_DEFINITION_OF_DONE.md).

---

## 5. Đường dữ liệu chuẩn — TỪ WEB XUỐNG IO THẬT (command)

```
[User / BMS bấm "DO1 ON"]
      ↓ REST PUT /api/v1/points/DO1  (hoặc commissioning test)
[mkddc-web]            → ghi command request (KHÔNG ghi thẳng IO)
      ↓ IPC (command/setpoint vào core)
[mkddc-core]          → priority resolver → safe-state check → quyết output cuối
      ↓ ghi ao_setpoint[]/do_cmd[] vào kx_io_shm (seqlock)
[mkddc-iobus]         → đọc do_cmd/ao_setpoint → build SET_DO/SET_AO
      ↓ UART 921600 8N1 + IOP frame + CRC16
[FW_MCU]              → iop_comm dispatch → do_control / ao_output
      ↓ GPIO PC0..PC3 (ULN2003) / SPI1 DAC8554
[Relay / AO hardware THẬT]
```

## 6. Đường dữ liệu chuẩn — TỪ IO THẬT LÊN WEB (telemetry)

```
[Sensor / DI contact / relay feedback THẬT]
      ↑ ADS131M08 (SPI3) / GPIO DI / DO feedback
[FW_MCU io_sample]    → io_data_buf (1ms)
      ↑ MCU trả IO_RESP (34 byte) khi nhận GET_IO
[mkddc-iobus]         → parse IO_RESP → scale raw→engineering → ghi kx_io_shm (seqlock)
      ↑ core đọc seqlock
[mkddc-core]          → point table update + quality + BACnet object table (plc_shm)
      ↑ IPC / REST read
[mkddc-web]           → GET /api/v1/points → JSON {value, quality, ts}
      ↑
[Web UI hiển thị 24 IO]
```

---

## 7. ⛔ NHỮNG VIỆC KHÔNG ĐƯỢC LÀM

```
❌ Web → UART → MCU            (web mở /dev/ttyS2, nói chuyện thẳng MCU)
❌ Web → MCU                   (web gọi IOP frame trực tiếp)
❌ iobus tự quyết định relay   (iobus tự bật DO theo logic riêng)
❌ MCU chạy logic điều khiển   (MCU tự PID/interlock/schedule hệ thống)
❌ Bỏ qua priority resolver    (ghi thẳng ao_setpoint/do_cmd không qua core)
❌ Để mock/random IO trong build release
```

**ĐÚNG, bắt buộc:**

```
✅ Web → mkddc-core → mkddc-iobus → UART/IOP → MCU → IO thật
✅ Mọi DO/AO đi qua priority resolver trong mkddc-core
✅ MCU chỉ đọc/ghi IO + safe-state, KHÔNG chạy logic hệ thống
✅ iobus chỉ là người đưa thư UART: poll, parse, gửi lệnh, báo lỗi
```

> Lý do: cô lập real-time boundary (ADR-005), an toàn (priority/safe-state tập trung ở core),
> và để BACnet/Modbus/Web đều đi chung một đường quyết định output → không xung đột relay.

---

## 8. Thứ tự đọc bộ tài liệu

| # | File | Cho ai | Khi nào đọc |
|---|------|--------|-------------|
| 00 | README (file này) | tất cả | đầu tiên |
| 01 | [SYSTEM_IMPLEMENTATION_OVERVIEW](01_SYSTEM_IMPLEMENTATION_OVERVIEW.md) | tất cả | hiểu hệ thống mức implement |
| 02 | [TEAM_WORK_SPLIT](02_TEAM_WORK_SPLIT.md) | tất cả | biết phần việc của mình |
| 03 | [PHASE_PLAN](03_PHASE_PLAN.md) | PM + tất cả | biết làm gì trước/sau |
| 04 | [FW_MCU_IMPLEMENTATION_GUIDE](04_FW_MCU_IMPLEMENTATION_GUIDE.md) | Dev 1 | trước khi code FW |
| 05 | [IOP_UART_IMPLEMENTATION_GUIDE](05_IOP_UART_IMPLEMENTATION_GUIDE.md) | Dev 1 + Dev 2 | hợp đồng UART chung |
| 06 | [MKDDC_IOBUS_IMPLEMENTATION_GUIDE](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) | Dev 2 | trước khi code iobus |
| 07 | [MKDDC_CORE_IMPLEMENTATION_GUIDE](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md) | Dev 2 | trước khi code core |
| 08 | [MKDDC_WEB_IMPLEMENTATION_GUIDE](08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md) | Dev 3 | trước khi code web |
| 09 | [END_TO_END_DATA_FLOW](09_END_TO_END_DATA_FLOW.md) | tất cả | hiểu flow để debug |
| 10 | [TASK_CHECKLIST](10_TASK_CHECKLIST.md) | PM + dev | tạo Jira/GitHub issue |
| 11 | [INTEGRATION_TEST_PLAN](11_INTEGRATION_TEST_PLAN.md) | Tester | test trên board |
| 12 | [DEFINITION_OF_DONE](12_DEFINITION_OF_DONE.md) | tất cả | biết khi nào xong |
| 13 | [BRINGUP_GUIDE](13_BRINGUP_GUIDE.md) | KS bring-up | dựng board lần đầu |
| 14 | [RELEASE_HANDOVER_CHECKLIST](14_RELEASE_HANDOVER_CHECKLIST.md) | PM/Lead | trước bàn giao |
| 15 | [CONTRACT_FREEZE](15_CONTRACT_FREEZE.md) | tất cả | **trước khi code** — bản chốt hợp đồng, hết tranh cãi |
| 16 | [QUICK_START_SOM_DEV](16_QUICK_START_SOM_DEV.md) | Dev 2 (mới) | ngày đầu tiên vào dự án |
| 17 | [WEEK1_SOM_BRINGUP_CHECKLIST](17_WEEK1_SOM_BRINGUP_CHECKLIST.md) | Dev 2 | tuần đầu trên SOM |
| 18 | [DOCS_AUDIT_SOM_IMPLEMENTATION](18_DOCS_AUDIT_SOM_IMPLEMENTATION.md) | Lead/PM | audit docs 2026-06-11 (meta) |
| 19 | [DOCS_FIX_CHECKLIST](19_DOCS_FIX_CHECKLIST.md) | Lead/PM | tracker sửa docs theo audit (meta) |
| 20 | [VIRTUAL_COM_DECISION](20_VIRTUAL_COM_DECISION.md) | Dev 2 + Tester | khi chưa có board, cần bridge serial ảo đúng chuẩn |
| 21 | [SOM_SRC_IMPLEMENTATION_PLAN](21_SOM_SRC_IMPLEMENTATION_PLAN.md) | Dev 2 + Lead | khi cần plan cực chi tiết để dựng source SOM từ cây trống |

---

## 9. Nguồn-chuẩn (khi mâu thuẫn theo thứ tự này)

> ⚠️ **Rule số 1 (Contract Freeze):** với mọi GIÁ TRỊ thực thi — opcode, payload, enum, FAULT
> bit, RESET reason, CRC, hằng số, SHM layout/path/ownership — **header trong `shared/` là
> chuẩn CUỐI CÙNG**. Docs (kể cả spec 01_specs) chỉ là diễn giải: docs lệch header → header
> thắng → sửa docs. Chi tiết + quy trình đổi hợp đồng: [15_CONTRACT_FREEZE](15_CONTRACT_FREEZE.md).

| Chủ đề | Nguồn-chuẩn |
|--------|-------------|
| **Giá trị protocol UART/IOP** (opcode/payload/fault/reason/CRC/timing) | [`shared/iop_protocol.h`](../../shared/iop_protocol.h) — **cuối cùng** |
| **SHM layout/magic/path/ownership** | [`shared/mkddc_shm.h`](../../shared/mkddc_shm.h) — **cuối cùng** |
| Giao thức UART/IOP (diễn giải, hành vi, timing chart) | [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) + [05_IOP_UART](05_IOP_UART_IMPLEMENTATION_GUIDE.md) |
| Kiến trúc service / process | [PRODUCT_DEFINITION](../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md) + [ADR-005](../adr/ADR-005-three-process-architecture.md) + [CANONICAL_DECISIONS](../CANONICAL_DECISIONS.md) |
| Firmware STM32 | [FW_DDD](../02_design/firmware/FW_DDD_MK-DDC-24_VI.md) |
| Chân MCU | [FW_PINOUT_MASTER](../02_design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) |
| SHM/IPC SOM (diễn giải, ownership chi tiết) | [06_IOBUS §5](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) + [SW_ARCH_SPEC §2](../01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md) |
| Graph/Config/REST | [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) · [CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) · [REST_API_OPENAPI](../02_design/interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) |

---
**Rev** 1.1 | 2026-06-11 (Contract Freeze: rule header-thắng, thêm docs 15/16/17, mkddc_shm.h) ·
Liên quan: [GETTING_STARTED_DEV](../02_design/GETTING_STARTED_DEV.md)
