# Kế hoạch Thiết kế Phần mềm & Firmware — MK-DDC-24
## Software/Firmware Design Plan (SDP)

> **Document ID:** SDP-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30
> **Trạng thái:** Approved (Owner 2026-06-08)
> 📘 **Đọc cùng:** [README](README.md) · [REVIEW](DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md)

---

## 1. Mục đích & Phạm vi

Tài liệu này định nghĩa **cách** đội SW/FW chuyển từ *yêu cầu + kiến trúc* (bộ `spec/`) sang **bộ hồ sơ thiết kế chi tiết** đủ để code, test và chứng nhận. Nó quy định:

- Bộ tài liệu thiết kế phải có (deliverables D-1…D-11+) và template.
- Tiêu chuẩn áp dụng (thiết kế, coding, an toàn, bảo mật).
- Phân kỳ, milestone, review gate, ownership.
- Quy tắc truy vết (requirement → design → code → test).

**Trong phạm vi:** Firmware MCU (STM32G0B1/FreeRTOS) + Software SOM (Debian/userspace).
**Ngoài phạm vi:** Thiết kế phần cứng schematic/PCB (thuộc `hardware-design/`), cơ khí vỏ.

---

## 2. Tiêu chuẩn áp dụng

### 2.1 Tiêu chuẩn tài liệu thiết kế
| Tiêu chuẩn | Áp dụng cho |
|-----------|-------------|
| **IEEE 1016-2009** (Software Design Descriptions) | Cấu trúc SDD/DDD (SW & FW) |
| **ISO/IEC/IEEE 12207** | Vòng đời phần mềm (process) |
| **ISO/IEC/IEEE 29148** | Chất lượng requirement & truy vết |
| **arc42 / C4 model** | Diễn đạt kiến trúc (đã dùng ở SW/FW_ARCH) |

### 2.2 Tiêu chuẩn kỹ thuật sản phẩm (đã cam kết)
| Tiêu chuẩn | Áp dụng |
|-----------|---------|
| **IEC 61131-3** | Soft PLC (FBD, ST) |
| **IEC 62443-4-1** | Quy trình phát triển bảo mật (SDLC) |
| **IEC 62443-4-2** | Yêu cầu bảo mật component (roadmap Ver 1.2) |
| **ASHRAE 135 (BACnet) + BTL** | Stack BACnet + conformance |
| **Modbus Application Protocol v1.1b3** | Modbus TCP/RTU slave |

### 2.3 Coding standard
| Domain | Chuẩn |
|--------|-------|
| **Firmware (C)** | **MISRA C:2012** (tập con bắt buộc, xem `design/firmware/FW_CODING_STANDARD`), C11, không dynamic alloc sau RTOS start |
| **Soft PLC runtime (C++)** | C++17, RAII, no exception trên hot-path, Google C++ style (rút gọn) |
| **Backend/Agent (Python)** | PEP 8 + type hints, ruff/mypy, FastAPI |
| **Web IDE (TS)** | TypeScript strict, ESLint, Svelte |
| **HMI (C/LVGL)** | MISRA-friendly C subset |
| **Shell/DevOps** | shellcheck, set -euo pipefail |

### 2.4 Static analysis & chất lượng (bắt buộc CI — trace SEC-001/002)
`cppcheck`, `clang-tidy`, MISRA checker (FW); `ruff`+`mypy` (Py); `eslint`+`tsc` (TS); `trivy`/`grype` (deps); coverage ≥ 80% core (TEST-001).

---

## 3. Cấu trúc thư mục thiết kế

```
design/
├── README.md                         ← index + trạng thái deliverable
├── interfaces/                       ← hợp đồng dùng chung SW↔FW↔BMS
│   ├── MODBUS_REGISTER_MAP…          (D-2)
│   ├── BACNET_PICS_EPICS…            (D-3)
│   ├── REST_OPENAPI…                 (D-4, + openapi.yaml)
│   └── CONFIG_JSON_SCHEMA…           (D-5)
├── firmware/                         ← thiết kế MCU
│   ├── FW_PINOUT_MASTER…             (D-1)
│   ├── FW_CODING_STANDARD…
│   ├── FW_DDD…                       (detailed design, IEEE 1016)
│   ├── FW_MODULE_<name>…             (mỗi task/driver 1 file khi cần)
│   └── FW_BOOTLOADER_OTA…            (D-7 phần MCU)
├── software/                         ← thiết kế SOM
│   ├── SW_CODING_STANDARD…
│   ├── SW_DDD…                        (detailed design tổng)
│   ├── SW_RUNTIME_EXECUTION_MODEL…   (D-6, thay SW_PLC_ENGINE_DESIGN đã gỡ)
│   ├── SW_COMPONENT_LIBRARY…         (D-6, bộ component Rev A)
│   ├── SW_BACNET_DESIGN…
│   ├── SW_IODRIVER_DESIGN…           (gộp vào mkddc-core)
│   ├── SW_AGENT_DESIGN…              (MQTT/REST/Modbus — deferred Rev B)
│   ├── (SW_WEBIDE_DESIGN đã gỡ → web Rev A: ADR-006/007)
│   ├── SW_HMI_DESIGN…                (feature-gated Rev A, ADR-016 limited-operator)
│   ├── SW_SECURITY_KEYSTORE…         (D-11)
│   └── SW_OTA_DESIGN…                (D-7 phần SOM, A/B)
└── _templates/
    ├── TEMPLATE_DDD.md               (IEEE 1016)
    └── TEMPLATE_MODULE_DESIGN.md
```

---

## 4. Danh mục Deliverable thiết kế

> Ưu tiên: **P0** = nền/hợp đồng (làm trước, khóa interface); **P1** = thiết kế module chính; **P2** = bổ trợ.

| ID | Tài liệu | Domain | Ưu tiên | Đóng gap REVIEW | Owner |
|----|----------|:------:|:------:|:----------------:|-------|
| D-1 | FW Pinout Master | FW/HW | **P0** | D-1 | FW+HW |
| D-2 | Modbus Register Map | IF | **P0** | D-2 | SW |
| — | FW Coding Standard | FW | **P0** | — | FW Lead |
| — | SW Coding Standard | SW | **P0** | — | SW Lead |
| — | FW_DDD (IEEE 1016) | FW | **P0** | — | FW Lead |
| — | SW_DDD (IEEE 1016) | SW | **P0** | — | SW Lead |
| D-3 | BACnet PICS/EPICS | IF | P1 | D-3 | SW (Protocol) |
| D-4 | REST OpenAPI (+yaml) | IF | P1 | D-4 | SW (Backend) |
| D-5 | Config JSON Schema | IF | P1 | D-5 | SW |
| D-6 | PLC Engine Design | SW | P1 | D-6 | SW (PLC) |
| D-7 | OTA combined sequence (SOM+MCU) | SW/FW | P1 | D-7 | DevOps+FW |
| D-11 | Key Management / Secure Storage | SW | P1 | D-11 | Security |
| — | FW module designs (io_sample, iop_comm, ao/do, diag, wdg) | FW | P1 | — | FW |
| — | SW service designs (iodriver, bacnet, agent, webide, hmi) | SW | P1 | — | SW |
| D-8 | Enclosure/Mechanical | HW | P2 | D-8 | HW |
| D-9 | Schematic/PCB (KiCad) | HW | P2 | D-9 | HW |
| D-10 | Thermal derating report | HW | P2 | D-10 | HW |

> D-8/D-9/D-10 thuộc HW track — liệt kê ở đây để truy vết, thực hiện trong `hardware-design/`.

---

## 5. Nội dung tối thiểu mỗi loại tài liệu (theo IEEE 1016)

**DDD (FW_DDD / SW_DDD) phải có:**
1. Mục đích, phạm vi, tham chiếu (trace tới REQ ID).
2. Bối cảnh & ràng buộc (HW, OS, real-time, bộ nhớ).
3. Phân rã module (decomposition) — sơ đồ + trách nhiệm từng module.
4. Mỗi module: **interface** (hàm/IPC/topic), **dữ liệu** (struct/schema), **thuật toán/luồng**, **lỗi & safe-state**, **tài nguyên** (stack/heap/CPU), **REQ trace**, **test hook**.
5. Concurrency (task/thread/lock), timing budget.
6. Lỗi & phục hồi (fault tree → hành động).
7. Bảng truy vết REQ → design unit → test.

**Interface doc (D-2/D-3/D-4/D-5):** bảng địa chỉ/endpoint/field đầy đủ, kiểu dữ liệu, scale, ví dụ request/response, mã lỗi, version.

---

## 6. Phân kỳ & Milestone

| Giai đoạn | Nội dung | Cổng ra (gate) | Mốc |
|-----------|----------|----------------|-----|
| **DP-0 Foundation** | D-1, D-2, 2× Coding Std, FW_DDD/SW_DDD skeleton | **DR-1: Interfaces frozen** | Sprint 1 |
| **DP-1 Interface detail** | D-3, D-4, D-5, D-7 | **DR-2: ICD review** | Sprint 2 |
| **DP-2 Module design** | FW modules, SW services, D-6, D-11 | **DR-3: Detailed Design Review** | Sprint 3 |
| **DP-3 Baseline** | Hợp nhất, traceability đầy đủ, đồng bộ spec | **DR-4: Design Baseline** (vào code) | Sprint 4 |

**Design Review (DR) gate — điều kiện qua:**
- Mọi REQ MUST có ≥ 1 design unit ánh xạ.
- Không P0/P1 open issue về interface.
- Static-analysis ruleset đã chốt; template tuân thủ IEEE 1016.
- Lead ký (FW/SW/Arch/QA).

---

## 7. Truy vết (Traceability)

Chuỗi bắt buộc: **PRD FR/NFR → SRS/SW-REQ/FW-REQ → Design unit → Code (PR) → Test case**.

- Mỗi design unit ghi cột "Trace REQ".
- Mỗi PR ghi REQ ID + design unit.
- `TEST_SPEC §5` là ma trận tổng; cập nhật khi thêm design unit.

---

## 8. Công cụ

| Hạng mục | Công cụ |
|----------|---------|
| FW build/debug | STM32CubeIDE 1.15+ / CMake + arm-none-eabi-gcc 12, ST-Link V3 |
| FW RTOS | FreeRTOS 10.5.1 |
| SW build | Debian 12 toolchain, CMake, Python 3.11, Node 20 |
| BACnet | bacnet-stack 1.3.x |
| Modbus | libmodbus 3.1.10 |
| API | FastAPI + OpenAPI 3.1 (openapi.yaml là nguồn-chuẩn D-4) |
| Diagram | Mermaid/PlantUML (text-based, versioned) |
| CI | GitHub Actions: lint + static + unit + coverage |
| Doc | Markdown trong repo, review qua PR |

---

## 9. Rủi ro thiết kế cần theo dõi (liên kết OPEN_ISSUES)
- **DEC-001** IEC 61131-3 engine build vs OpenPLC → quyết định trước DP-2 (ảnh hưởng D-6).
- **HW-Q-002** CM3 extended-temp → ảnh hưởng dải nhiệt (không chặn SW/FW design).
- **SW-Q-004** key storage (OP-TEE/TPM/encrypted FS) → quyết định trong D-11.
- **SW-Q-005** OTA server endpoint → ảnh hưởng D-7 (cert pinning).

---

## 10. Bước thực thi (Bước 3 của kế hoạch tổng)

1. **DP-0 ngay:** tạo `design/` + index, D-1, D-2, 2× coding standard, FW_DDD + SW_DDD (skeleton có decomposition).
2. **DP-1:** điền interface docs (D-3/D-4/D-5/D-7).
3. **DP-2:** thiết kế từng module/service (D-6, D-11, FW/SW modules).
4. **DP-3:** hợp nhất + traceability + DR-4 baseline.

---

**Document ID:** SDP-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
**Phê duyệt:** SW Lead · FW Lead · System Architect · QA Lead
