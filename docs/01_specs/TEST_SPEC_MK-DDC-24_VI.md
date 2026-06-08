# Test Specification & Traceability Matrix — MK-DDC-24
## Software + Firmware + System

> **Document ID:** TEST-SPEC-MK-DDC-24-VI  
> **Phiên bản:** 1.0 | 2026-05-28  
> **Trạng thái:** Draft — Pending QA Lead review  
> 📘 **Đọc cùng:** [README](README.md) — hướng dẫn + glossary · Đã đồng bộ **2026-05-30** (xem [REVIEW](DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md))  
> **Tác giả:** KINEXUS Technologies — QA / Test Team

---

## 1. Test Strategy

### 1.1 Test Levels

| Level | Phạm vi | Owner | Automation |
|-------|---------|-------|-----------|
| **L1 — Unit Test** | Module đơn lẻ (hàm, class, task) | Dev (FW/SW) | 100% (CI/CD) |
| **L2 — Integration Test** | Service-to-service, IOP protocol, BACnet stack | SW + FW | 80% (CI/CD) |
| **L3 — HIL Test** | Hardware-in-the-Loop: thật MCU + thật SOM | Test Team | 60% (CI/CD) |
| **L4 — System Test** | End-to-end full system (I/O → BACnet → MQTT) | Test Team | 40% |
| **L5 — FAT/SAT** | Factory Acceptance Test / Site Acceptance Test | Test Team + SI | Manual |
| **L6 — Stress / Soak** | 72h+ continuous, memory leak, watchdog recovery | Test Team | Automated |

### 1.2 Tools & Infrastructure

| Tool | Mô tả |
|------|-------|
| **Unity** | C unit test framework — MCU firmware (cross-compile on host) |
| **pytest** | Python test framework — SW services |
| **bacnet-stack test tool** | BACnet BTL conformance test (ASHRAE) |
| **Modpoll / mbpoll** | Modbus TCP/RTU test client |
| **Mosquitto client** | MQTT publish/subscribe test |
| **curl / httpie** | REST API test |
| **nmap / nikto** | Security surface scan (pre-pentest) |
| **valgrind / AddressSanitizer** | Memory leak detection (SW) |
| **ST-Link + STM32CubeMonitor** | MCU debug + fault injection |
| **HIL rig** | Radxa CM3 SOM + STM32G0B1 MCU + real I/O signals |

---

## 2. Firmware Test Cases

### 2.1 IOP Protocol (MCU side)

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-FW-IOP-001 | IOP-FW-007, FW-IOP-004 | Gửi GET_IO frame hợp lệ → đo thời gian từ frame end đến byte đầu IO_RESP | ≤ 5 ms | L2 |
| T-FW-IOP-002 | IOP-FW-007, FW-IOP-004 | Gửi GET_IO với CRC sai → MCU trả NACK 0xFE + ERR_CRC_FAIL | NACK đúng format, ERR_CODE=0x03 | L2 |
| T-FW-IOP-003 | IOP-FW-008 | Gửi CMD unknown (0x99) → MCU trả NACK + ERR_UNKNOWN_CMD | NACK, ERR_CODE=0x01 | L2 |
| T-FW-IOP-004 | IOP-FW-006 | Ngừng gửi GET_IO 200ms → MCU apply safe state (AO=0, DO=open) | AO≈0V, relay open, FAULT_FLAGS set | L3 |
| T-FW-IOP-005 | IOP-FW-002 | Gửi 10.000 GET_IO liên tiếp → không có buffer overflow, DMA error | 0 errors trong 10k frames | L3 |
| T-FW-IOP-006 | FW-IOP-006 | IOP watchdog: measure safe state latency sau 200ms no-comm | AO/DO safe within 5ms | L3 |

### 2.2 ADC Sampling

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-FW-001 | FW-IO-001 | Đo chu kỳ sampling thực tế với oscilloscope (SPI CS toggle) | ≤ 1ms, ≥ 1000 sps | L3 |
| T-FW-002 | FW-IO-002 | Inject noise spike vào UI1 → verify moving average filter smooths output | Spike < 2% residual after 8 samples | L3 |
| T-FW-006 | FW-IO-006 | Ngắt kết nối ADS131M08 (hardware) → verify FAULT_FLAGS.ADC_FAULT=1 trong ≤ 5ms | ADC_FAULT set, reported via IOP | L3 |
| T-FW-012 | FW-IO-012 | Kết nối lần lượt PT100, NTC10k, 0-10V, 4-20mA → verify auto-detect đúng | Sensor type detected correctly ≥ 95% | L3 |

### 2.3 AO/DO Control

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-FW-030 | FW-AO-001 | Gửi SET_AO raw=32767 (50%) → đo điện áp AO1 | 5.0V ±0.1V | L3 |
| T-FW-033 | FW-AO-004 | Trigger RESET_IO → đo AO1 within 5ms | AO1 = 0V (0-10V mode) | L3 |
| T-FW-040 | FW-DO-001 | Gửi SET_DO mask=0x01 value=0x01 → relay DO1 đóng | DO_FB_MASK bit0=1, relay continuity confirmed | L3 |
| T-FW-042 | FW-DO-003 | Block relay coil physically → verify RELAY_STUCK flag | FAULT_FLAGS.RELAY_STUCK=1 sau 20ms | L3 |

### 2.4 Watchdog

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-FW-050 | FW-WDG-001 | Block `watchdog_task` (suspend task) → IWDG không được kick → MCU reset | MCU resets within 1s | L3 |
| T-FW-054 | FW-WDG-005 | No GET_IO 200ms → safe state, then restore IOP → normal operation resume | Safe within 200ms, resume on next HANDSHAKE | L3 |
| T-FW-055 | FW-WDG-006 | Gây watchdog reset → kiểm tra FAULT_FLAGS.MCU_WATCHDOG_RESET=1 sau boot | Flag set, cleared only when SOM reads | L3 |

### 2.5 Boot & Initialization

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-FW-070 | FW-BOOT-001 | Power-on → measure time to first valid IO_RESP | ≤ 500ms | L3 |
| T-FW-073 | FW-BOOT-004 | Disconnect internal ref → verify self-test fail + safe state | FAULT flag, no AO/DO output | L3 |

---

## 3. Software Test Cases

### 3.1 IOP Driver (SOM side)

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-SW-001 | SW-IOP-001 | CRC16 unit test: 20 test vectors (SW và FW PHẢI match) | 100% pass | L1 |
| T-SW-002 | SW-IOP-002 | Measure actual GET_IO poll period | 10ms ±1ms | L2 |
| T-SW-004 | SW-IOP-004 | Block MCU responses → verify retry 3 lần → IOP_FAULT | 3 retries → fault state | L2 |
| T-SW-005 | SW-IOP-005 | Read kinexus_io_shm từ separate process concurrently | No data corruption (seqlock verify) | L2 |
| T-SW-008 | SW-IOP-008 | Trigger IOP_FAULT → verify state machine → SAFE_STATE | RESET_IO sent, alarm bus event | L2 |
| T-SW-010 | SW-IOP-010 | Verify process scheduler priority | `chrt -p $(pidof kinexus-iod)` → SCHED_FIFO 70 | L2 |

### 3.2 Soft PLC

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-SW-020 | SW-PLC-001 | Upload 16 FBD programs, run simultaneously | All 16 execute, no crash | L4 |
| T-SW-022 | SW-PLC-003 | Test PID_COMPACT: step response với Kp=2, Ti=10s | Settles within ±2% in ≤ 30s | L4 |
| T-SW-031 | SW-PLC-011 | Measure scan jitter 1 giờ liên tục (100ms scan) | Jitter ≤ 5ms (p99) | L4 |
| T-SW-033 | SW-PLC-013 | Force scan overrun 3× → verify safe state + service restart | Output safe, service restarts | L4 |

### 3.3 BACnet Stack

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-SW-050 | SW-BAC-001 | Who-Is broadcast → I-Am response | Response < 100ms | L4 |
| T-SW-052 | SW-BAC-003 | Read-Property-Multiple cho tất cả objects | All objects return valid values | L4 |
| T-SW-053 | SW-BAC-004 | Subscribe-COV AI1 threshold=0.5 → inject temperature change | COV notification sent ≤ 200ms | L4 |
| T-SW-056 | SW-BAC-007 | BACnet BTL test suite (ASHRAE reference stack) | 100% pass (blocking for GA) | L4 |
| T-SW-057 | SW-BAC-008 | Kill BMS connection 30s → verify PLC standalone mode | PLC continues, BACnet alarm generated | L4 |

### 3.4 REST API

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-SW-070 | SW-API-001 | HTTPS TLS 1.3 connection | `openssl s_client` shows TLSv1.3 | L2 |
| T-SW-071 | SW-API-002 | POST /auth/login với sai password → 401; đúng password → JWT | 401 / 200 + token | L2 |
| T-SW-074 | SW-API-005 | PUT /points/AO1 value=5.0 → AO1 output 5V | Measured 5.0V ±0.1V | L4 |
| T-SW-077 | SW-API-008 | 200 requests/s từ single IP → verify HTTP 429 sau 100/s | 429 returned | L2 |

### 3.5 Security

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-SW-080 | SW-SEC-001 | Corrupt kernel signature → U-Boot rejects boot | Rollback to previous partition | L4 |
| T-SW-081 | SW-SEC-002 | AppArmor: try file access outside profile → denied | `aa-status` shows enforced; denied logged | L2 |
| T-SW-083 | SW-SEC-004 | SSH: connect on port 22 → refused; port 2222 → key auth only | Port 22 closed, 2222 requires key | L2 |
| T-SW-086 | SW-SEC-007 | Brute force web login: 6 attempts → lockout 15min | Account locked, log entry written | L2 |
| T-SEC-001 | SEC-004 | Penetration test (external consultant) | 0 critical / high CVEs unresolved | L6 |

### 3.6 OTA Update

| Test ID | Yêu cầu Trace | Mô tả | Pass Criteria | Level |
|---------|--------------|-------|---------------|-------|
| T-SW-092 | SW-OTA-003 | Upload package với bad GPG signature → rejected | OTA aborted, error log | L4 |
| T-SW-094 | SW-OTA-005 | OTA to known-bad firmware (boot fails 2×) → rollback | Auto rollback to previous, alarm | L4 |
| T-SW-095 | SW-OTA-006 | Attempt downgrade to version with known CVE | OTA rejected, log entry | L4 |
| T-SW-096 | SW-OTA-007 | Normal OTA: measure apply + reboot time | ≤ 60 seconds | L4 |

---

## 4. System-Level (FAT/SAT) Test Cases

| Test ID | Mô tả | Pass Criteria | Thực hiện |
|---------|-------|---------------|---------|
| FAT-001 | Cold boot: power on → PLC ready | ≤ 30 giây | Tại nhà máy |
| FAT-002 | All 8 UI channels: inject known value, read via BACnet AI | Error ≤ 0.5% FS per kênh | HIL rig |
| FAT-003 | All 8 DI channels: open/close contact, read via BACnet BI | Debounce correct (20ms) | HIL rig |
| FAT-004 | All 4 AO channels: command 0V/5V/10V, measure with DMM | ±0.1% FS | HIL rig |
| FAT-005 | All 4 DO relay: command ON/OFF, verify coil continuity | Correct per command | HIL rig |
| FAT-006 | BACnet Who-Is / Read-Property / Write-Property | Per T-SW-050..054 | BACnet tool |
| FAT-007 | MQTT COV publish all AI/AO/BI/BO | All published within 500ms of change | Mosquitto subscriber |
| FAT-008 | OTA update end-to-end | Success ≤ 60s downtime | Full OTA test |
| FAT-009 | Auth: 5 wrong passwords → lockout | Locked 15min | Web UI |
| FAT-010 | 72-hour soak: continuous I/O cycling, BACnet polling | 0 crashes, 0 memory leaks | Automated |
| FAT-011 | HMI display: all screens, all buttons | Correct navigation, values match | Manual |
| FAT-012 | IEC 61131-3 FCU program: temperature control PID | Settles ±0.5°C | HIL simulation |
| FAT-013 | Commissioning workflow per DS §6.2 | < 2 hours for one zone | Timed manual |

---

## 5. Traceability Matrix

### 5.1 PRD → SRS → SW/FW Spec → Test

> **⚠ Lưu ý ID (sửa P1-5):** Cột "PRD ID" dùng **đúng bộ Functional Requirement của PRD §4** (FR-001…FR-036). Một số hạng mục (HMI, Web IDE, IOP nội bộ) **không có FR riêng trong PRD** — ghi "—" và trỏ tới spec sở hữu. Không tự phát sinh FR ID mới.

| PRD ID | Mô tả | SRS IDs | Spec IDs | Test IDs |
|--------|-----------|---------|---------|---------|
| FR-001, FR-007 | IEC 61131-3 FBD/ST PLC | PLC-001..007 | SW-PLC-001..005 | T-SW-020..024 |
| FR-003 | PID_COMPACT + auto-tuning | PLC-004, PLC-005 | SW-PLC-003, SW-PLC-004 | T-SW-022 |
| FR-020 | BACnet/IP | BAC-002..008 | SW-BAC-001, SW-BAC-003 | T-SW-050..056 |
| FR-020 | BACnet MS/TP | BAC-001 | SW-BAC-002 | T-SW-051 |
| FR-020 | COV notifications | BAC-005 | SW-BAC-004 | T-SW-053 |
| FR-022 | MQTT v3.1.1/v5.0 | MQ-001..007 | SW-MQ-001..007 | T-SW-060..066 |
| FR-010, FR-011 | 8× Universal Input + types | IOP-003 | FW-IO-001..014 | T-FW-001..014 |
| FR-010 | Sensor auto-detect | IOP-003 | FW-IO-010..014 | T-FW-012 |
| FR-012 | 8× Digital Input + debounce | IOP-003 | FW-IO-020..024 | T-FW-020 |
| FR-013 | 4× Analog Output 16-bit | IOP-004 | FW-AO-001..006 | T-FW-030..035 |
| FR-014 | 4× Digital Output relay | IOP-004 | FW-DO-001..006 | T-FW-040..045 |
| FR-023 | REST API HTTPS | API-001..009 | SW-API-001..010 | T-SW-070..079 |
| FR-032, FR-034 | JWT Auth / TLS | API-002 | SW-API-002 | T-SW-071 |
| UC-03, NFR-007 | OTA A/B partition (không có FR riêng) | OTA-001..008 | SW-OTA-001..008 | T-SW-090..097 |
| FR-030, FR-031 | Firmware GPG + Secure boot | SEC-010, SEC-011 | SW-SEC-001 | T-SW-080 |
| FR-033 | Firewall / SSH / port policy | SEC-020..022 | SW-SEC-004 | T-SW-083 |
| — (SRS §12) | HMI TFT display LVGL | HMI-001..015 | SW-HMI-001..008 | T-SW-100..107 |
| FR-015 | IOP v1 + sampling ≤1ms | IOP-001..006 | IOP-SW-001..010, IOP-FW-001..010 | T-FW-IOP-001..006, T-SW-001..011 |
| FR-021 | BACnet Device ID DIP/WebUI | BAC-010 | SW-BAC-006 | T-SW-055 |
| FR-006, FR-016 | Failsafe / safe state | PLC-013 | SW-IOP-008..009, FW-WDG-005 | T-SW-008, T-FW-054 |
| FR-024, FR-025 | Modbus TCP/RTU slave | MB-001..010 | SW-MOD-001..010 | T-SW-120..129 |
| FR-035 | Audit logging | SEC-025 | SW-SEC-006 | T-SW-085 |
| — (SRS §11) | KinexusET Web IDE | IDE-001..034 | SW-IDE-001..023 | T-SW-130+ |
| NFR-005 | Watchdog FreeRTOS + IWDG | — | FW-WDG-001..006 | T-FW-050..055 |
| FR-036 | IEC 62443-4-1 SDLC | SEC-001..006 | SW-SEC-001..008 | Code review |
| — (SRS OS-001) | Boot time ≤ 30s | OS-001..005 | SW-ARCH §1 | FAT-001 |

### 5.2 NFR Traceability

> **⚠ Sửa P1-5:** Cột NFR ID dùng **đúng PRD §5** (NFR-001…NFR-010). Hạng mục không có NFR trong PRD ghi "—" + spec sở hữu.

| PRD NFR ID | Mô tả (theo PRD §5) | Test IDs |
|-----------|-------|---------|
| NFR-001 | Control loop jitter ≤ 5ms | T-SW-031 |
| NFR-002 | BACnet Who-Is → I-Am < 100ms | T-SW-050 |
| NFR-003 | Uptime ≥ 99.9% / 72h soak 0 crash, no leak | FAT-010 (valgrind) |
| NFR-004 | MTBF ≥ 60.000h @ 40°C | Phân tích IEC 61709 (không test runtime) |
| NFR-005 | Watchdog reboot < 30s | T-FW-050..055 |
| NFR-006 | Không CVE CVSS ≥ 7.0 | T-SEC-001 (pentest) |
| NFR-007 | OTA downtime ≤ 60s | T-SW-096 |
| NFR-008 | Commissioning < 2h | FAT-013 |
| NFR-009 | BACnet BTL certified | T-SW-056 |
| NFR-010 | Hoạt động -20…+65°C (target) | HW thermal derating (HW-Q-001) |
| — (SRS OS-001) | Boot ≤ 30s | FAT-001 |
| — (IOP-002) | IOP 100Hz sustained | T-SW-002 |
| — (SEC-023) | Auth brute-force lockout | T-SW-086 |

---

## 6. HIL Test Setup

### 6.1 Hardware Rig Requirements

```
HIL Test Rig:
  ┌─────────────────────────────────────────────────┐
  │ MK-DDC-24 DUT (Device Under Test)              │
  │  (full board: SOM + MCU + I/O circuits)         │
  └────────────────────┬────────────────────────────┘
                       │ Ethernet
              ┌────────▼──────────────────┐
              │ Test PC (Ubuntu 22.04)    │
              │  - pytest test runner     │
              │  - BACnet test tool       │
              │  - MQTT subscriber        │
              │  - Signal generators      │
              └────────┬──────────────────┘
                       │ USB
              ┌────────▼──────────────────┐
              │ NI USB-6009 or similar    │
              │  - Analog signal inject   │ ── UI1-UI8
              │  - Digital I/O            │ ── DI1-DI8
              │  - Analog measure AO      │ ◄─ AO1-AO4 (DMM)
              │  - Relay state sense      │ ◄─ DO1-DO4 (GPIO)
              └───────────────────────────┘
```

---

## 7. Acceptance Criteria (Release Gate)

Chỉ được release khi TẤT CẢ các điều kiện sau đạt:

| Gate | Tiêu chí | Responsible |
|------|---------|-------------|
| G1 | All L1 unit tests pass (100%) | Dev |
| G2 | All L2 integration tests pass (100%) | Dev |
| G3 | HIL tests pass (≥ 95% — documented exceptions) | Test Team |
| G4 | BACnet BTL conformance: 100% | SW Lead |
| G5 | 72-hour soak: 0 crash, 0 memory leak | Test Team |
| G6 | Security pentest: 0 Critical/High unresolved | Security |
| G7 | All FAT test cases pass | Test Team |
| G8 | Traceability: mọi PRD FR/NFR có ≥ 1 test case | QA Lead |
| G9 | Open Issues: 0 P0 unresolved | PM |

---

**Document ID:** TEST-SPEC-MK-DDC-24-VI  
**Revision:** 1.0 | 2026-05-28  
**Approved by:** QA Lead, SW Lead, FW Lead — KINEXUS Technologies
