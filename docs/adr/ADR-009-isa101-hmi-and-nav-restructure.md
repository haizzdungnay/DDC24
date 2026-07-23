# ADR-009: Adopt ISA-101 high-performance HMI (Level B hybrid) + restructure web UI navigation into 3 groups

- Date: 2026-06-16
- Owner: Product Owner / FE Lead
- Status: Accepted
- Accepted: 2026-06-16 (owner)
- Builds on: [ADR-004](ADR-004-component-based-runtime.md) (component-based runtime;
  **superseded 2026-07-23 by [ADR-018](ADR-018-mekong-owned-iec-aligned-program-runtime.md)**
  for the "no IEC 61131-3 in Rev A" part only — this ADR's HMI/nav decision is unaffected),
  [ADR-006](ADR-006-rev-a-ui-form-json.md)
  (Rev A form/JSON engineering UI),
  [ADR-008](ADR-008-bms-edge-positioning-and-revA-component-set.md)
  (BMS edge positioning)
- Canonical references: [UX-SYSTEM](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md),
  [08_MKDDC_WEB](../03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md)

## Context

The Rev A frontend currently exposes a flat sidebar with many peer-level items:
Dashboard, Monitor, Alarms, Trends, Scheduler, Network, Users, Settings, System Health,
Commissioning and Validator. This is difficult to scan and does not express a clear HMI
information architecture.

The initial handoff UI uses a dark-navy theme with bright cyan accents and inconsistent status
color semantics. That is visually strong but conflicts with high-performance HMI practice:
neutral structure should dominate so alarms, deviations and faults stand out.

The owner has since chosen a Level B hybrid color convention for web Rev A: keep the
high-performance HMI structure and light-gray neutral field, but use the familiar SCADA status
color language where green means online/ON/normal, gray means off/stopped, yellow means warning,
red means fault, and magenta means highest-priority/safety. Color still cannot be the only carrier
of meaning.

The current "Validator" label is also ambiguous. It can be misread as a programming IDE.
Rev A programming (2026-06-16, at time of this decision) was configuring predefined
components, importing/exporting `graph.json`, validating the graph, testing and deploying
(ADR-004/ADR-006) — not IEC 61131-3 FBD/ST. **Note (2026-07-23):** ADR-018 has since
added a separate, Mekong-owned IEC 61131-3-aligned Program Runtime (ST+FBD) to the Rev
A.0 roadmap (in C0, not yet released). This ADR's "Programming" label decision below
still stands for the legacy component-graph surface; it does not itself cover the new
Program Runtime editor.

Recent demo UI work on Trends, Scheduler, Network and Validator, recorded in the 2026-06-16
Unreleased changelog, fits under this broader information-architecture decision.

## Decision

1. **Adopt ISA-101-based high-performance HMI structure with a Level B hybrid status palette for the web UI.**
   Around 90% of the screen should stay grayscale/neutral: classic light-gray background,
   neutral panels, restrained lines, and a clear three-group navigation hierarchy. Status color
   uses the traditional SCADA convention: green = online/ON/normal; gray = off/stopped;
   yellow = warning/minor fault; red = critical/major fault; magenta = highest-priority/safety.
   Color must never be the only carrier of meaning; every state also needs text, shape, icon,
   pattern, or another non-color cue. Yellow/red should preferentially appear as colored
   backgrounds (chip/dot/bar) with bold text. When colored text or thin lines are needed on the
   light-gray background, use darker `*-fg` variables to meet WCAG AA contrast.

2. **Restructure navigation into three groups.**
   - **Overview:** Dashboard with embedded System Health CPU/RAM/IOP, Monitoring `/monitor`,
     Alarm log `/alarms`, Trends `/trends`, User info `/me`.
   - **Settings:** Display `/settings/display`, Users `/settings/users`, Network
     `/settings/network`, Time/Date `/settings/time`, Device `/settings/device`.
   - **Engineering:** Scheduler `/eng/scheduler`, Commissioning `/eng/commissioning`,
     Programming/Validator `/eng/programming`, Alarm settings `/eng/alarm-settings`.

3. **Split alarms into two surfaces.** Alarm log remains in Overview for viewing and acking
   alarms. Alarm settings move to Engineering for thresholds, delays and priorities, as a new
   page.

4. **Fold System Health into Dashboard.** Remove the standalone `/health` page from the web
   information architecture and show CPU/RAM/IOP/version health on Dashboard.

5. **Split user surfaces.** `/me` is a read-only Overview page for the current user. Users
   management remains under Settings.

6. **Rename Validator to Programming.** Programming is the Rev A component-library assembly
   surface with validate/test actions, the four Rev A graph checks and demo deploy. It is not a
   drag-and-drop canvas. Editable wiresheet/canvas for the legacy component graph remains
   Rev B scope. *(Note 2026-07-23: a separate Program Runtime ST/FBD editor is now on the
   Rev A.0 roadmap per ADR-018, tracked outside this page's original scope.)*

7. **Define `/me` as the RBAC self-service page.** It should show identity, role, permission
   summary, session information such as login time, auto-logout and IP address, plus Change
   Password and Logout actions.

### Color tokens (Level B hybrid)

| Token | Direction | Notes |
|-------|-----------|-------|
| `--bg` | light neutral gray `#C8CCD0` | Main HMI field; keep structure calm and non-saturated. |
| `--surface` | light neutral panel `#D8DBDE` | Panels/cards one step above background. |
| `--surface-2` | secondary neutral `#BCC0C4` | Secondary fills and selected neutral surfaces. |
| `--border` / `--line` | neutral divider `#9AA0A6` | Structure, not state. |
| `--text` | near-black `#1C1F23` | Primary text/value carrier. |
| `--text-dim` | neutral secondary text `#4A4F55` | Secondary labels. |
| `--normal` | green `#2FA45A` | Online/ON/normal/good status background, dot or badge. |
| `--good-fg` | dark green `#1E7A3D` | Green text/icon/line on light surfaces; may be darkened in code if contrast check requires. |
| `--off` | neutral gray `#6B7280` | Off/stopped/idle without fault. |
| `--warn` | yellow `#E8B500` | Warning, minor fault, H/L; prefer as chip/dot/bar background. |
| `--warn-fg` | dark amber `#6B5400` | Warning text/icon/thin line on light surfaces. |
| `--alarm` / `--fault` | red `#D5202A` | Critical/major fault/HH/LL; prefer as chip/dot/bar background. |
| `--fault-fg` | dark red `#B01219` | Fault text/icon/thin line on light surfaces. |
| `--critical` | magenta `#B0179C` | Highest-priority or safety-critical state. |
| `--force` | muted purple `#8A4FBF` | Forced/override/manual intervention. |
| `--interact` | low-saturation deep blue `#2A5C8A` | Focus, links and primary actions; use sparingly. |

UX-SYSTEM owns exact token names and contrast validation. This ADR requires UX-SYSTEM and code
(`statusColor`, badges, PointCard, Dashboard metrics and charts) to implement the Level B hybrid
palette, keep non-color cues, and avoid saturated decorative glow.

## Rejected alternatives

1. **Level A pure: no green for normal status.** Superseded by owner amendment on 2026-06-16.
   It is stricter to high-performance HMI doctrine, but the owner chose the familiar SCADA
   convention for demo usability and operator recognition.
2. **Level C: group the menu but keep the vivid cyan/dark-navy color system.** Rejected. It does
   not meet the high-performance HMI goal because decorative color would still compete with
   abnormal state signaling.
3. **Keep the flat 12-item menu.** Rejected. It is difficult to scan, does not separate operator,
   configuration and engineering tasks, and leaves role boundaries unclear.

## Consequences

- UX-SYSTEM in `docs/04_uiux` must use the Level B hybrid token set: neutral light-gray HMI
  structure plus SCADA status colors (`normal/good`, `off`, `warn`, `alarm/fault`, `critical`,
  `force`) and darker `*-fg` tokens for colored text/lines on light surfaces.
- Frontend code (`styles.css`, `statusColor`, `statusIndicatorColor`, `StatusBadge`, PointCard,
  Dashboard metrics, chart palettes and related components) must use the Level B hybrid semantics
  after this amendment. Green is normal/OK/online; gray is off/stopped; yellow/red/magenta remain
  abnormal/severity colors.
- Color cannot be the only cue. Status UI must pair color with text, icon, symbol, shape, chip,
  bar, or another non-color cue.
- 08_MKDDC_WEB section 1 must keep the three-group page tree: `/me`, `/settings/time`,
  `/eng/alarm-settings`; removal of `/health`; split Settings routes.
- Rev A remains demo UI scope. This decision does not change REST or WebSocket contracts.
- The vivid original handoff theme and the old UX-SYSTEM color tokens are superseded for the web
  UI. The on-device TFT HMI is a separate surface and is outside this ADR's scope.

## Amendment (2026-06-16) — Level A → Level B hybrid

Lý do: vàng/đường mảnh làm CHỮ trên nền sáng không đạt tương phản; và owner chọn convention SCADA
(green=normal). Giữ cấu trúc HMI + nav 3 nhóm của bản gốc; chỉ đổi triết lý màu trạng thái sang
Level B hybrid. Supersedes điểm "Level A pure / no green" ở bản gốc.