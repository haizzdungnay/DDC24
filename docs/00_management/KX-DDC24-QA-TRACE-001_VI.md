# Traceability Matrix — MK-DDC-24
## Ma trận truy vết: Yêu cầu → Thiết kế → Code → Test

> **Document ID:** KX-DDC24-QA-TRACE-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Draft (cập nhật theo sprint) · **Owner:** QA
> **Chuẩn:** ISO/IEC/IEEE 29148 §5.2.8 (bidirectional traceability)
> 📘 [docs/README](../README.md)

> 🎯 Mỗi yêu cầu phải truy được tới **thiết kế nào hiện thực nó, task nào code nó, test nào chứng minh nó chạy**. Đọc dọc một hàng = vòng đời 1 tính năng. Khi thêm REQ/design → thêm hàng.
> Nguồn REQ ID: PRD/SRS (`../../`), [FW_REQ](../../spec/FW_REQUIREMENTS_MK-DDC-24_VI.md), [SW_REQ](../../spec/SW_REQUIREMENTS_MK-DDC-24_VI.md). Task ID: [Implementation Plan](KX-DDC24-PM-IMPLPLAN-001_VI.md).

---

## 1. Giao tiếp SOM ↔ MCU (IOP)
| REQ | Thiết kế (design) | Task code | Test |
|-----|-------------------|-----------|------|
| IOP-FW-001..010 | FW_MOD_IOP_COMM, IF-ICD-001 | T-FW-03 | T-FW-IOP-001..006 |
| SW-IOP-001..011 | BE-DDD-001 (io-driver) | T-BE-01, T-BE-03 | T-SW-001..011 |
| FW-WDG-005 (IOP timeout safe) | FW_MOD_DIAG_WDG | T-FW-02, T-FW-05 | T-FW-054 |

## 2. Đọc cảm biến (UI) + DI
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| FW-IO-001..009 (ADC) | FW_MOD_IO_SAMPLE, FW-DDD-002 (pinout) | T-FW-04 | T-FW-001..012 |
| FW-IO-020..024 (DI) | FW_MOD_IO_SAMPLE | T-FW-04 | T-FW-020..025 |
| FW-IO-010..012 (auto-detect) | FW_MOD_IO_SAMPLE, UX_WEBIDE §4.3 | T-FW-04, T-UX-01, T-FE-02 | T-FW-013 |
| Scaling raw→eng | SW_ARCH §4, BE-DDD-001 | T-BE-03 | T-SW-006..009 |

## 3. Đầu ra AO/DO
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| FW-AO-001..009 | FW_MOD_AO_DO | T-FW-06 | T-FW-030..039 |
| FW-DO-001..006 | FW_MOD_AO_DO | T-FW-06 | T-FW-040..045 |
| Safe-state | FW_MOD_AO_DO, IF-ICD-001 §6 | T-FW-06, T-BE-03 | T-FW-033, T-SW-004 |

## 4. Modbus
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| SW-MOD-001..010, MB-001..010 | IF-ICD-002 (D-2) | T-BE-05 | T-SW-120..129 |
| RTU-001..006 | IF-ICD-002, IF-ICD-005 (rs485_mode) | T-BE-05 | T-SW-125 |

## 5. BACnet
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| SW-BAC-001..008, BAC-001..011 | IF-ICD-003 (D-3), BE-DDD-003 | T-BE-06 | T-SW-050..058 |
| NFR-009 (BTL) | IF-ICD-003 §9 | T-INT-03 | T-SW-056 (BTL) |

## 6. REST / MQTT
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| SW-API-001..010 | IF-ICD-004 (openapi.yaml), BE-DDD-004 | T-BE-07 | T-SW-070..079 |
| SW-MQ-001..007 | BE-DDD-004 (agent) | T-BE-08 | T-SW-060..066 |

## 7. PLC / Điều khiển
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| SW-PLC-001..022, PLC-001..023 | BE-DDD-002 (D-6) | T-BE-09 | T-SW-020..035 |
| Write arbitration | BE-DDD-002 §7 | T-BE-10 | T-SW-036 |
| Alarm bus | SRS §13, BE-DDD-002 | T-BE-10 | T-SW-040 |

## 8. Web IDE (FE) + UI/UX
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| SW-IDE-001..009 (program) | UX-WEBIDE-001 §4.2, FE-DDD-001 | T-UX-02, T-FE-01, T-FE-03 | T-SW-130..139 |
| SW-IDE-010..015 (config/monitor/force) | UX-WEBIDE-001 §4.3-4.4, IF-ICD-005 | T-FE-02 | T-SW-140..149 |
| SW-IDE-020..023 (auth/role) | SEC-DDD-001, UX-WEBIDE §1 | T-FE-01, T-BE-12 | T-SW-080..086 |

## 9. HMI
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| SW-HMI-001..008, HMI-001..022 | UX-HMI-001, BE-DDD-005 | T-FW/BE-11 | T-SW-100..107 |

## 10. Bảo mật
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| SEC-020..025, SW-SEC-001..008 | SEC-DDD-001 (D-11) | T-BE-12 | T-SEC-001..010 |
| TLS 1.3 / JWT | SEC-DDD-001, IF-ICD-004 | T-BE-07, T-BE-12 | T-SW-070, T-SW-084 |

## 11. OTA
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| OTA-001..008, SW-OTA-001..008 | OPS-DDD-002 (D-7) | T-OPS-04 | T-SW-090..097 |
| FW-OTA-001..005 | OPS-DDD-001 (FW bootloader) | T-OPS-04 | T-FW-080..084 |

## 12. Hệ thống / OS / Reliability
| REQ | Thiết kế | Task | Test |
|-----|----------|------|------|
| OS-001..005 | SW_ARCH, IMPL P0 | T-OPS-03, T-BE-02 | T-SW-110..115 |
| NFR reliability (soak 72h) | SW_ARCH §6, FW_ARCH §7 | T-INT-04 | soak report |

---
## 13. Quy tắc duy trì
- Thêm REQ mới → thêm hàng + trỏ thiết kế/task/test (kể cả còn trống, đánh "TBD").
- Mỗi PR đóng task → đánh dấu test pass ở cột Test.
- Review trước mỗi gate (DR/Phase): không hàng nào thiếu cột Thiết kế hoặc Test cho REQ "MUST".

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | QA | Phát hành đầu — ma trận REQ→design→task→test theo 12 nhóm tính năng |
