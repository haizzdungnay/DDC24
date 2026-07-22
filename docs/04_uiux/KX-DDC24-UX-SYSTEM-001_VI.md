# Design System — MK-DDC-24
## Hệ thống thiết kế giao diện (tokens + components)

> **Document ID:** KX-DDC24-UX-SYSTEM-001
> **Phiên bản:** 1.7 | 2026-07-22 · **Trạng thái:** Approved design guidance; target validation pending · **Owner:** UX Lead
> **Chuẩn:** ISA-101-based design guidance, IEC 60073 coding review, WCAG 2.1 AA; không phải tuyên bố certification
> 📘 [docs/README](../README.md) · Dùng cho: web Rev A (form/JSON — [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md)) và local limited-operator [HMI](KX-DDC24-UX-HMI-001_VI.md) feature-gated theo ADR-016

> 🎯 Đây là "nguồn-chuẩn hình ảnh": màu, chữ, khoảng cách, component dùng chung cho **web engineering (FE, React)** để nhất quán. FE dev lấy token này set CSS/theme. *(2026-06-08: web Rev A là React + form/JSON, không Svelte/FBD.)*

---

## 1. Nguyên tắc thiết kế
1. **Rõ ràng > đẹp:** đây là thiết bị công nghiệp, ưu tiên đọc nhanh, ít hiểu lầm.
2. **Trạng thái phải thấy ngay:** normal/online/off/warn/fault/alarm có chữ + icon rõ; màu theo convention SCADA nhưng không đứng một mình.
3. **An toàn:** hành động nguy hiểm (force I/O, restart, OTA) phải có xác nhận.
4. **Tiếp cận:** tương phản ≥ 4.5:1, không chỉ dùng màu để truyền nghĩa (kèm icon/chữ/shape).
5. **Nhất quán:** cùng một ý nghĩa → cùng chữ/icon/hình; Web và HMI local dùng chung semantic state dù layout khác nhau.
6. **High-performance hierarchy:** phần lớn màn hình và trạng thái bình thường trung tính; màu bão hòa dành cho abnormal, attention, override hoặc energized state cần phân biệt.
7. **Ngữ nghĩa màu có kiểm soát:** neutral = normal/available/unknown theo label; green chỉ cho confirmed running/energized/success, gray = off/stopped/unavailable, yellow = warning, red = fault/danger. Magenta không tự động gán `safety` nếu chưa có safety analysis/philosophy.
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
| `--good` | #2FA45A | NỀN/dot/badge: confirmed running/energized/success; không dùng làm nền normal tổng quát |
| `--good-fg` | #1E7A3D | CHỮ/icon xanh lá trên nền sáng (phải kiểm/tối chỉnh để đạt AA) |
| `--off` | #6B7280 | off/stopped (xám trung tính) |
| `--warn` | #E8B500 | NỀN cảnh báo (vàng) — chữ đè phải đậm |
| `--warn-fg` | #6B5400 | CHỮ/đường cảnh báo trên nền sáng (amber sẫm, ~4.5:1) |
| `--alarm` / `--fault` | #D5202A | NỀN sự cố nặng (đỏ) |
| `--fault-fg` | #B01219 | CHỮ/đường đỏ trên nền sáng |
| `--critical` | #B0179C | priority cao nhất khi alarm philosophy quy định; không đồng nghĩa safety certification |
| `--force` | #8A4FBF | forced/override |
| `--interact` | #2A5C8A | focus/link/primary (giữ) |

> Quy ước Level B hybrid: nền, panel, divider và active navigation vẫn trung tính; màu trạng thái theo SCADA. Vàng (`--warn`) và đỏ (`--alarm`) là màu NỀN; chữ/đường mảnh trên nền sáng phải dùng `--warn-fg`/`--fault-fg`/`--good-fg`. Cảnh báo nên là chip/badge nền màu + chữ đậm, không phải chữ màu mảnh.
> Trạng thái LUÔN kèm dấu hiệu phi-màu: chữ/badge, icon, shape/pattern hoặc symbol.

### 2.1 Ngữ nghĩa màu trạng thái
| Trạng thái | Token | Ý nghĩa |
|------------|-------|---------|
| Confirmed running/energized/success | `--good` | trạng thái động đã xác nhận |
| Normal/available | neutral tokens | trạng thái nền, không cần thu hút chú ý |
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
- HMI body text tối thiểu 14px; action touch target tối thiểu 40×40px hoặc có hard-key equivalent.

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
| **AlarmRow** | 1 dòng alarm | priority, lifecycle state, time, source, response, ack-state |
| **ControlFaceplate** | point được whitelist | effective value, feedback, mode, source, priority, expiry, actions |
| **CommandStatus** | lifecycle command | editing/pending/accepted/rejected/timeout/expired/released |

> Lưu ý: normal/available dùng neutral; `--good` chỉ cho running/energized/success
> cần xác nhận. Off/stopped = xám, warn = vàng, fault = đỏ, priority cao nhất =
> critical khi philosophy quy định, force = tím. Mọi trạng thái luôn có chữ/icon/label.

### 5.1 PointCard — quy ước hiển thị (dùng cả Web + HMI)
```
┌──────────────────────────┐
│ UI1  Nhiệt độ phòng    ✓ │   ← tên + StatusBadge
│  23.5 °C                  │   ← giá trị lớn (mono)
│  NTC10k · good · 10:42    │   ← loại sensor · quality · time
└──────────────────────────┘
quality normal/good → neutral + "✓ GOOD"; confirmed energized/running có thể thêm xanh; off/stopped → xám + "OFF"; uncertain/warn → chip vàng + "⚠ WARN"; fault → chip đỏ + "✕ FAULT"
đang force → viền/badge tím + "FORCED"
```
Trạng thái normal của PointCard dùng neutral để abnormal nổi bật; xanh chỉ dùng cho
energized/running/success khi hữu ích. Luôn kèm chữ/icon/label theo ADR-009.
## 6. Phân cấp điều hướng (ISA-101)
Điều hướng web Rev A chia 3 nhóm để tách tác vụ vận hành, cấu hình và kỹ thuật theo [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md):

| Nhóm | Trang |
|------|-------|
| **Overview** | Dashboard (nhúng System Health), Monitoring, Alarm log, Trends, User info `/me` |
| **Settings** | Display, Users, Network, Time/Date, Device |
| **Engineering** | Scheduler, Commissioning, Programming/Validator, Alarm settings, Inputs Config, Controller Diagram, Auxiliary Functions |

Mục đang chọn dùng dấu hiệu trung tính (weight, line, marker, background nhẹ), không glow/bão hòa màu. Nhóm điều hướng có thể thu gọn để giảm tải thị giác.

### 6.1 Điều hướng HMI local

HMI 320×240 không dùng navigation Web ba nhóm. Nó có đúng năm surface
`Home/Points/Control/Alarms/Service`, một page title lớn và page chooser với target
tối thiểu 40×40px. Communication/System được gộp vào Home/Service. Control chỉ chứa
point authority whitelist; không có schedule, engineering, alarm configuration hoặc
user administration trên panel local.

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
| 1.7 | 2026-07-22 | Tech Lead/UX | Đồng bộ semantic state, typography, touch target và component cho local limited-operator HMI theo ADR-016. |
| 1.5 | 2026-06-23 | UX Lead | Thêm Inputs Config, Controller Diagram, Aux Functions vào Engineering theo ADR-010 |
| 1.6 | 2026-07-22 | Tech Lead/UX | Reserved saturated color for abnormal/confirmed dynamic states; removed blanket green-normal and unsupported magenta=safety semantics; added IEC 60073 review boundary. |
| 1.4 | 2026-06-16 | UX Lead | Đổi sang Level B hybrid — bộ màu trạng thái SCADA + token *-fg cho nền sáng theo ADR-009 amendment |
| 1.3 | 2026-06-16 | UX Lead | Owner adjustment: chữ/icon/chấm/value động normal xanh lá; warn cam, fault đỏ; surface vẫn xám ISA-101 |
| 1.2 | 2026-06-16 | UX Lead | Bổ sung ngoại lệ chấm/icon binary indicator: OK/ONLINE xanh lá, OFF/OFFLINE xám, vẫn kèm chữ/icon |
| 1.1 | 2026-06-16 | UX Lead | Áp ISA-101 Level A nền xám sáng + phân cấp điều hướng 3 nhóm theo ADR-009 |
| 1.0 | 2026-05-30 | UX Lead | Phát hành đầu — tokens, typography, components |
