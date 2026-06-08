# Design System — MK-DDC-24
## Hệ thống thiết kế giao diện (tokens + components)

> **Document ID:** KX-DDC24-UX-SYSTEM-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Draft · **Owner:** UX Lead
> **Chuẩn:** WCAG 2.1 AA (tiếp cận), Material-ish / industrial HMI guideline
> 📘 [docs/README](../README.md) · Dùng cho: web Rev A (form/JSON — [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md)), [HMI](KX-DDC24-UX-HMI-001_VI.md) *(deferred Rev B)*

> 🎯 Đây là "nguồn-chuẩn hình ảnh": màu, chữ, khoảng cách, component dùng chung cho **web engineering (FE, React)** để nhất quán. FE dev lấy token này set CSS/theme. *(2026-06-08: web Rev A là React + form/JSON, không Svelte/FBD.)*

---

## 1. Nguyên tắc thiết kế
1. **Rõ ràng > đẹp:** đây là thiết bị công nghiệp, ưu tiên đọc nhanh, ít hiểu lầm.
2. **Trạng thái phải thấy ngay:** good/uncertain/fault/alarm có màu + icon rõ.
3. **An toàn:** hành động nguy hiểm (force I/O, restart, OTA) phải có xác nhận.
4. **Tiếp cận:** tương phản ≥ 4.5:1, không chỉ dùng màu để truyền nghĩa (kèm icon/chữ).
5. **Nhất quán:** cùng 1 ý nghĩa → cùng 1 màu/icon ở Web và HMI.

## 2. Design Tokens — Màu
| Token | Hex | Dùng cho |
|-------|-----|----------|
| `--c-bg` | #0E1116 | nền tối (HMI + IDE dark) |
| `--c-surface` | #1A1F27 | thẻ/panel |
| `--c-text` | #E6E9EF | chữ chính |
| `--c-text-dim` | #9AA4B2 | chữ phụ |
| `--c-primary` | #2D7FF9 | hành động chính, link |
| `--c-good` | #2FBF71 | quality good / online / OK |
| `--c-warn` | #E0A106 | uncertain / cảnh báo |
| `--c-fault` | #E5484D | fault / alarm / offline |
| `--c-info` | #5B8DEF | thông tin |
| `--c-force` | #9B5DE5 | giá trị đang bị Force |
| `--c-border` | #2A313C | viền |

> Trạng thái LUÔN kèm icon: ✓ good, ⚠ warn, ✕ fault, 🔒 force.

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
| **StatusBadge** | chip trạng thái | good/warn/fault/force/online |
| **DataTable** | watch table, point list | sort, filter, realtime cell flash |
| **Modal** | xác nhận hành động | confirm/cancel, danger variant |
| **Toast** | thông báo | info/success/warn/error |
| **NavRail** | điều hướng theo role | active item |
| **AlarmRow** | 1 dòng alarm | severity, time, ack |

### 5.1 PointCard — quy ước hiển thị (dùng cả Web + HMI)
```
┌──────────────────────────┐
│ UI1  Nhiệt độ phòng    ✓ │   ← tên + StatusBadge
│  23.5 °C                  │   ← giá trị lớn (mono)
│  NTC10k · good · 10:42    │   ← loại sensor · quality · time
└──────────────────────────┘
quality good → viền xanh; uncertain → vàng; fault → đỏ + "✕ FAULT"
đang force → viền tím + badge "🔒 FORCED"
```

## 6. Iconography
Outline 24px (web) / 16px (HMI): home, io, alarm, network, settings, user, play, stop, upload, download, force, lock, refresh.

## 7. Tiếp cận (WCAG 2.1 AA)
- Tương phản chữ ≥ 4.5:1, chữ lớn ≥ 3:1.
- Focus ring rõ; điều hướng được bằng bàn phím (web) / 6 nút (HMI).
- Không truyền nghĩa chỉ bằng màu.

## 8. Handoff cho FE
- Token export `tokens.json` / `theme.css` (FE import).
- Mỗi component có: props, state, ví dụ dùng → FE map sang Svelte component.

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | UX Lead | Phát hành đầu — tokens, typography, components |
