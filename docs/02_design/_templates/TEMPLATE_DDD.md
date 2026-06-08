# <Tên Module/Service> — Detailed Design
## <Component> — MK-DDC-24

> **Document ID:** DDD-<COMP>-MK-DDC-24-VI
> **Phiên bản:** 0.1 | YYYY-MM-DD
> **Trạng thái:** Approved (Owner 2026-06-08)
> **Owner:** <team/người>
> **Theo:** IEEE 1016 · 📘 [README](../../01_specs/README.md)

---

## 1. Mục đích & Phạm vi
Module này làm gì, không làm gì. Trace tới REQ: `<REQ-IDs>`.

## 2. Bối cảnh & Ràng buộc
HW/OS/real-time/bộ nhớ/ngôn ngữ. Phụ thuộc upstream/downstream.

## 3. Phân rã (Decomposition)
```
<sơ đồ khối: sub-module / hàm chính>
```
| Sub-unit | Trách nhiệm | Trace REQ |
|----------|-------------|-----------|

## 4. Thiết kế chi tiết từng unit
### 4.x <unit>
- **Interface:** chữ ký hàm / IPC / topic / endpoint.
- **Dữ liệu:** struct / schema / hằng số.
- **Thuật toán / luồng:** mô tả + pseudo-code/sequence.
- **Lỗi & safe-state:** điều kiện lỗi → hành động.
- **Tài nguyên:** stack/heap/CPU/timing budget.
- **Trace REQ / Test:** `<REQ-ID>` / `<T-ID>`.

## 5. Concurrency & Timing
Task/thread/lock, thứ tự, deadline, tránh deadlock/priority inversion.

## 6. Xử lý lỗi & phục hồi
Fault tree → hành động → log/alarm.

## 7. Ma trận truy vết
| REQ ID | Design unit (§) | Test ID |
|--------|-----------------|---------|

## 8. Open points
| ID | Vấn đề | Owner | Hạn |
|----|--------|-------|-----|

---
**Rev** 0.1 | YYYY-MM-DD
