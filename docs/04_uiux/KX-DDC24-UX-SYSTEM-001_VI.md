# Design System — MK-DDC-24
## Hệ thống thiết kế giao diện (tokens + components)

> **Document ID:** KX-DDC24-UX-SYSTEM-001
> **Phiên bản:** 1.4 | 2026-06-16 · **Trạng thái:** Approved (Owner 2026-06-16) · **Owner:** UX Lead
> **Chuẩn:** ISA-101-based HMI Level B hybrid (web), WCAG 2.1 AA (tiếp cận), industrial HMI guideline
> 📘 [docs/README](../README.md) · Dùng cho: web Rev A (form/JSON — [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md)), [HMI](KX-DDC24-UX-HMI-001_VI.md) *(deferred Rev B)*

> 🎯 Đây là "nguồn-chuẩn hình ảnh": màu, chữ, khoảng cách, component dùng chung cho **web engineering (FE, React)** để nhất quán. FE dev lấy token này set CSS/theme. *(2026-06-08: web Rev A là React + form/JSON, không Svelte/FBD.)*

---

## 1. Nguyên tắc thiết kế
1. **Rõ ràng > đẹp:** đây là thiết bị công nghiệp, ưu tiên đọc nhanh, ít hiểu lầm.
2. **Trạng thái phải thấy ngay:** normal/online/off/warn/fault/alarm có chữ + icon rõ; màu theo convention SCADA nhưng không đứng một mình.
3. **An toàn:** hành động nguy hiểm (force I/O, restart, OTA) phải có xác nhận.
4. **Tiếp cận:** tương phản ≥ 4.5:1, không chỉ dùng màu để truyền nghĩa (kèm icon/chữ/shape).
5. **Nhất quán:** cùng 1 ý nghĩa → cùng 1 chữ/icon/hình trong cùng surface (Web Rev A trước; HMI TFT deferred Rev B).
6. **ISA-101-based, Level B hybrid:** khoảng 90% màn hình vẫn trung tính (xám/đen-trắng), giữ nền xám sáng + cấu trúc HMI high-performance; màu trạng thái dùng convention SCADA truyền thống.
7. **Ngữ nghĩa màu SCADA:** green = online/ON/normal, gray = off/stopped, yellow = warning/lỗi nhỏ, red = fault/sự cố nặng, magenta = highest-priority/safety.
8. **Không dùng màu là nghĩa duy nhất:** mọi trạng thái phải kèm chữ, biểu tượng, shape/pattern hoặc dấu hiệu phi-màu tương đương.
9. **Điều hướng 3 nhóm:** Overview, Settings, Engineering theo mục "Phân cấp điều hướng (ISA-101)" bên dưới.
10. **Nguồn-chuẩn:** [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md) là quyết định canonical cho ISA-101-based Level B hybrid và navigation 3 nhóm của web UI.
## 2. Design Tokens — Màu
| Token | Giá trị | Vai trò |
|-------|---------|---------|
| `--bg` | #C8CCD0 | nền (giữ) |
| `--surface` | #D8DBDE | panel (giữ) |
| `--surface-2` | #BCC0C4 | nền phụ (giữ) |
| `--border` | #9AA0A6 | divider (giữ) |
| `--text` | #1C1F23 | chữ chính (giữ) |
| `--text-dim` | #4A4F55 | chữ phụ (giữ) |
| `--good` | #2FA45A | NỀN/dot/badge: online/ON/normal (xanh lá) |
| `--good-fg` | #1E7A3D | CHỮ/icon xanh lá trên nền sáng (phải kiểm/tối chỉnh để đạt AA) |
| `--off` | #6B7280 | off/stopped (xám trung tính) |
| `--warn` | #E8B500 | NỀN cảnh báo (vàng) — chữ đè phải đậm |
| `--warn-fg` | #6B5400 | CHỮ/đường cảnh báo trên nền sáng (amber sẫm, ~4.5:1) |
| `--alarm` / `--fault` | #D5202A | NỀN sự cố nặng (đỏ) |
| `--fault-fg` | #B01219 | CHỮ/đường đỏ trên nền sáng |
| `--critical` | #B0179C | ưu tiên cao nhất/safety |
| `--force` | #8A4FBF | forced/override |
| `--interact` | #2A5C8A | focus/link/primary (giữ) |

> Quy ước Level B hybrid: nền, panel, divider và active navigation vẫn trung tính; màu trạng thái theo SCADA. Vàng (`--warn`) và đỏ (`--alarm`) là màu NỀN; chữ/đường mảnh trên nền sáng phải dùng `--warn-fg`/`--fault-fg`/`--good-fg`. Cảnh báo nên là chip/badge nền màu + chữ đậm, không phải chữ màu mảnh.
> Trạng thái LUÔN kèm dấu hiệu phi-màu: chữ/badge, icon, shape/pattern hoặc symbol.

### 2.1 Ngữ nghĩa màu trạng thái
| Trạng thái | Token | Ý nghĩa |
|------------|-------|---------|
| Online/ON/Normal | `--good` | chạy, OK |
| Off/Stopped | `--off` | không hoạt động |
| Warning/lỗi nhỏ | `--warn` (+ `--warn-fg`) | cần chú ý |
| Fault/sự cố nặng | `--alarm` (+ `--fault-fg`) | nghiêm trọng |
| Highest/Safety | `--critical` | ưu tiên cao nhất |
| Forced | `--force` | đang override |
## 3. Typography
| Token | Giá trị | Dùng |
|-------|---------|------|
| Font UI | Inter / Roboto | Web IDE |
| Font HMI | NotoSans (có dấu VI) | TFT |
| `--fs-h1` | 24/20px | tiêu đề trang |
| `--fs-h2` | 18px | tiêu đề mục |
| `--fs-body` | 14px | nội dung |
| `--fs-mono` | 13px JetBrains Mono | giá trị số, ST code |

## 4. Spacing & layout
- Grid base **8px** (4/8/16/24/32).
- Bo góc `--radius`: 6px (web), 4px (HMI).
- Web breakpoint: ≥1280 desktop (chính), ≥768 tablet (commissioning).
- HMI cố định 320×240 (landscape).

## 5. Component dùng chung (spec props)
| Component | Mô tả | State |
|-----------|-------|-------|
| **Button** | primary/secondary/danger | default/hover/disabled/loading |
| **PointCard** | hiện 1 I/O point | value, unit, quality, fault, force |
| **Gauge** | arc gauge (nhiệt/áp/%) | min,max,value,zones |
| **StatusBadge** | chip trạng thái | good/off/warn/fault/force/online |
| **DataTable** | watch table, point list | sort, filter, realtime cell flash |
| **Modal** | xác nhận hành động | confirm/cancel, danger variant |
| **Toast** | thông báo | info/success/warn/error |
| **NavRail** | điều hướng theo role | active item |
| **AlarmRow** | 1 dòng alarm | severity, time, ack |

> Lưu ý Level B hybrid: normal/online/ON = xanh lá (`--good`), off/stopped = xám (`--off`), warn = vàng dạng chip/badge/bar, fault = đỏ, critical/safety = magenta, force = tím. Mọi trạng thái vẫn phải đi kèm chữ/icon/label; không dùng màu đơn độc.

### 5.1 PointCard — quy ước hiển thị (dùng cả Web + HMI)
```
┌──────────────────────────┐
│ UI1  Nhiệt độ phòng    ✓ │   ← tên + StatusBadge
│  23.5 °C                  │   ← giá trị lớn (mono)
│  NTC10k · good · 10:42    │   ← loại sensor · quality · time
└──────────────────────────┘
quality normal/good → xanh lá + "✓ OK"; off/stopped → xám + "OFF"; uncertain/warn → chip vàng + "⚠ WARN"; fault → chip đỏ + "✕ FAULT"
đang force → viền/badge tím + "FORCED"
```
Trạng thái normal của PointCard hiển thị xanh lá theo convention SCADA; off dùng xám; warn dùng vàng dạng chip; fault dùng đỏ. Luôn kèm chữ/icon/label theo ADR-009 amendment.
## 6. Phân cấp điều hướng (ISA-101)
Điều hướng web Rev A chia 3 nhóm để tách tác vụ vận hành, cấu hình và kỹ thuật theo [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md):

| Nhóm | Trang |
|------|-------|
| **Overview** | Dashboard (nhúng System Health), Monitoring, Alarm log, Trends, User info `/me` |
| **Settings** | Display, Users, Network, Time/Date, Device |
| **Engineering** | Scheduler, Commissioning, Programming/Validator, Alarm settings |

Mục đang chọn dùng dấu hiệu trung tính (weight, line, marker, background nhẹ), không glow/bão hòa màu. Nhóm điều hướng có thể thu gọn để giảm tải thị giác.

## 7. Iconography
Outline 24px (web) / 16px (HMI): home, io, alarm, network, settings, user, play, stop, upload, download, force, lock, refresh.

Trạng thái phải có dấu hiệu phi-màu đi kèm: icon/chữ/shape/symbol. Không dùng icon chỉ để trang trí khi icon đang mang nghĩa trạng thái.

## 8. Tiếp cận (WCAG 2.1 AA)
- Tương phản chữ ≥ 4.5:1, chữ lớn ≥ 3:1.
- Focus ring rõ; điều hướng được bằng bàn phím (web) / 6 nút (HMI).
- Không truyền nghĩa chỉ bằng màu.
- Cặp nền/chữ trung tính bắt buộc: `--text`/`--bg`, `--text-dim`/`--bg` đạt AA.
- Cặp chữ/đường màu trên nền sáng phải kiểm và chốt ≥ 4.5:1 trước handoff/code: `--warn-fg`/`--bg`, `--good-fg`/`--bg`, `--fault-fg`/`--bg`. Nếu phép đo thực tế dưới AA do render/theme, tinh chỉnh `*-fg` sẫm hơn nhưng giữ cùng ngữ nghĩa màu.
- Chữ đậm trên nền `--warn`/`--alarm`/`--good` phải đạt ≥ 4.5:1; ưu tiên chữ tối trên nền vàng/xanh và chữ trắng hoặc tối đã kiểm trên nền đỏ tùy trường hợp.
- Trend line vàng phải dùng amber sẫm (`--warn-fg` hoặc màu tương đương) + nét đủ dày; không dùng đường vàng mảnh trên nền xám sáng.
- Warn/alarm/critical luôn có chữ hoặc symbol đi kèm để người dùng không phải phân biệt chỉ bằng màu.
## 9. Handoff cho FE
- Token export `tokens.json` / `theme.css` (FE import).
- Mỗi component có: props, state, ví dụ dùng → FE map sang React component.

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.4 | 2026-06-16 | UX Lead | Đổi sang Level B hybrid — bộ màu trạng thái SCADA + token *-fg cho nền sáng theo ADR-009 amendment |
| 1.3 | 2026-06-16 | UX Lead | Owner adjustment: chữ/icon/chấm/value động normal xanh lá; warn cam, fault đỏ; surface vẫn xám ISA-101 |
| 1.2 | 2026-06-16 | UX Lead | Bổ sung ngoại lệ chấm/icon binary indicator: OK/ONLINE xanh lá, OFF/OFFLINE xám, vẫn kèm chữ/icon |
| 1.1 | 2026-06-16 | UX Lead | Áp ISA-101 Level A nền xám sáng + phân cấp điều hướng 3 nhóm theo ADR-009 |
| 1.0 | 2026-05-30 | UX Lead | Phát hành đầu — tokens, typography, components |
