# UX Design — HMI local MK-DDC-24
## Five-surface limited operator interface on 320×240

**Document ID:** KX-DDC24-UX-HMI-001
**Revision:** 3.1 — 2026-07-22
**Status:** Controlled target; network commissioning not implemented
**Owner:** UX Lead
**Decision:** ADR-016, ADR-017
**Use cases:** [KX-DDC24-UC-HMI-001](KX-DDC24-UC-HMI-001_VI.md)

## 1. Hardware envelope

| Item | Value |
|---|---|
| Panel | KD024QVFIA073-02-C021B, JD9852 |
| Resolution | 240×320 rotated to 320×240 landscape |
| Touch | FT5436 capacitive touch through evdev |
| Hard keys | UP/DOWN/LEFT/RIGHT/ENTER/ESC |
| Font | Noto Sans with Vietnamese glyphs |
| Render/data | ≥10 FPS; telemetry refresh ≤1 s |

The small display is not a full Web HMI/SCADA. It is optimized for glance, point
inspection, limited command, alarm response, service diagnostics and a narrow
Ethernet IPv4 commissioning/recovery workflow for a physically present Service user.

## 2. UX acceptance targets

- Body text: minimum 14 px.
- Page title/value emphasis: 16–18 px.
- Touch action target: minimum 40×40 px; otherwise a complete hard-key equivalent is
  mandatory.
- A first touch/key after dim only wakes the screen.
- Every focused element has a visible outline/marker.
- Telemetry age/quality and command source/priority are always visible where relevant.
- Normal uses neutral styling; saturated color is reserved for abnormal attention,
  energized state when necessary and explicit override.
- No state is communicated by color alone.

These are product design targets to verify on the actual panel, not IEC certification
claims.

## 3. Information architecture

```text
Home ↔ Points ↔ Control ↔ Alarms ↔ Service
```

| Surface | Primary question |
|---|---|
| Home | Is the controller operating normally and what needs attention? |
| Points | What is the current value, quality and age of each point? |
| Control | Which approved points can I operate and what source currently wins? |
| Alarms | What is abnormal, what response is expected and is it acknowledged? |
| Service | What communication/system detail explains the issue? |

The legacy Communication and System pages are consolidated into Home and Service.

## 4. Global frame

```text
┌────────────────────────────────────────┐
│ ◀  HOME       DDC-001       10:42  ●A2 │  32 px header
├────────────────────────────────────────┤
│                                        │
│             page content               │  164 px body
│                                        │
├────────────────────────────────────────┤
│ ◀▶ Page   ▲▼ Focus   ENTER   ESC       │  44 px action/help area
└────────────────────────────────────────┘
```

- Header shows one page title, not five narrow touch tabs.
- LEFT/RIGHT changes surface; a page chooser opened from the title provides direct
  touch navigation with five large targets.
- Alarm indicator shows priority/count with text/symbol.
- Broker unavailable adds a persistent `READ ONLY` badge on Control/Alarms/Service.

## 5. Home

```text
STATE     RUNNING          DATA  0.3 s
ALARM     P1:0  P2:2       UNACK 1
I/O       GOOD 22  BAD 1   STALE 1
CONTROL   AUTO 3  OVERRIDE 1
SERVICES  CORE OK  IOBUS OK  BROKER OK
COMM      ETH OK  BACnet 12 s  MBUS WARN
```

Rules:

- The highest-priority unacknowledged alarm is above resource metrics.
- `GOOD` is not inferred when telemetry is absent.
- BACnet shows traffic age/state, not a fictitious session connection.
- CPU/RAM/temp/version details move to Service.
- Selecting ALARM, I/O, CONTROL or SERVICE navigates to the corresponding surface.

## 6. Points

```text
Filter [ALL]  Page 1/6
UI1  Supply Temp       12.4 °C  GOOD  0.2s
UI2  Return Temp       18.1 °C  GOOD  0.2s
AO1  Cooling Valve     45.0 %   OVR   0.2s
DO1  Supply Fan        ON       GOOD  0.2s
```

Filters: All, Bad, Stale, Overridden. Rows show point ID/name, value, unit, quality and
age. Inputs and feedback are read-only. Selecting a commandable row opens the same
point on Control; selecting a read-only row opens a detail overlay without commands.

## 7. Control

### 7.1 Commandable point list

Only authoritative commandable points appear:

```text
CONTROL   [READ ONLY when authority unavailable]
SP1  Room Setpoint     22.0 °C   AUTO
AO1  Cooling Valve     45.0 %    OVR  12m
DO1  Supply Fan        ON        AUTO
```

### 7.2 Point faceplate

```text
Cooling Valve                         AO1
Effective       45.0 %       GOOD · 0.2s
Feedback        44.2 %
Mode            MANUAL
Source          HMI_OPERATOR · P8
Expires         12 min

[ Setpoint ]   [ Mode ]
[ Override ]   [ Release ]
```

Disabled actions remain visible only when the reason helps the operator; otherwise
they are omitted. The reason must be available on focus/tap.

### 7.3 Edit and confirm

```text
SETPOINT
Current          22.0 °C
New              [ 23.0 ] °C
Allowed          18.0 … 26.0 °C

[ Cancel ]       [ Confirm ]
```

Override additionally requires reason and TTL selected within policy. There is no
indefinite default.

### 7.4 Command states

| State | Presentation |
|---|---|
| Editing | Local input only; no changed process value |
| Pending | Spinner/text `PENDING`; edit actions disabled |
| Accepted | Show authoritative effective value/source/priority |
| Rejected | Preserve prior state; show stable reason in plain language |
| Timeout | Show `UNKNOWN — checking authority`; no blind retry |
| Active override | Distinct border/badge + `OVERRIDE`, source and expiry |
| Expired/released | Show current automatic/priority winner, not assumed value |

## 8. Alarms

```text
P1  ACTIVE UNACK   10:41  IOP communication
    Source: IOP    Response: Check MCU link

P2  ACTIVE ACK     10:38  Supply temperature high
    Source: UI1    Response: Inspect airflow

[ Filter ]                       [ ACK ]
```

- Priority, lifecycle state, time, source, message and response are mandatory.
- ACK is at least 40×40 px and available through ENTER.
- ACK changes to Pending, then Acked only after authority accepts it.
- Alarm flood keeps the highest priority visible and offers deterministic filtering.
- ACK does not remove an active alarm.

## 9. Service

Service uses sections rather than five tiny action buttons:

```text
COMMUNICATION  >
SYSTEM         >
CONFIG STATUS  >
MAINTENANCE    >   [LOCKED]
```

Communication detail includes Ethernet/IP, BACnet traffic/error state and Modbus
port/slave/error state. System includes firmware, uptime, CPU/RAM/storage/temp,
process/watchdog and last fault.

Maintenance is hidden or locked without a Service session. An action appears only
when an authoritative implementation exists. Reboot/restart/restore must not be
executed directly by the HMI process.

### 9.1 Ethernet commissioning

Network is a section inside Service, not a sixth surface:

```text
ETHERNET
Link       UP
Active     192.168.1.50 /24
Mode       STATIC
Gateway    192.168.1.1
Pending    NONE

[ Configure ]
```

After Service authentication, Configure offers only `DHCP` or `STATIC`. Static input
contains IPv4, subnet/prefix and gateway. Confirmation shows old/new values, warns
that Web/BACnet communication may reconnect, and requires explicit hold/confirm.

```text
APPLYING NETWORK
New IP       192.168.1.80 /24
Old IP       192.168.1.50 /24
Rollback in  01:42

[ Confirm new IP ]   [ Roll back ]
```

The panel remains usable when a browser loses the old IP. Success is shown only from
authoritative `confirmed`; saved/staged/applying remain distinct. If broker/helper is
unavailable, Configure is disabled and data is `UNAVAILABLE`, never inferred from
`network.conf`. Wi-Fi credentials, DNS advanced settings, VLAN, routes, firewall and
BACnet Device ID/port remain Web/engineering functions.

## 10. Login and session

- Login is opened only when a mutation is requested or from Service.
- Credential entry supports touch keyboard and hard keys.
- Password/PIN characters are masked and never shown in logs.
- Header displays role and remaining session time while unlocked.
- Idle expiry up to 15 minutes locks mutation but does not hide an active override.
- Unknown role, broker loss or session expiry immediately changes mutation surfaces to
  `READ ONLY`.

## 11. Touch and hard-key mapping

| Input | List | Faceplate/form | Confirmation |
|---|---|---|---|
| LEFT/RIGHT | Previous/next surface | Previous/next field only when editing | No action |
| UP/DOWN | Move focus/scroll | Change selection/value | Move focus |
| ENTER | Open selected item | Edit/apply selected action | Confirm |
| ESC | Back/close | Cancel edit/back | Cancel |
| Tap | Select/open | Focus/edit/action | Confirm/cancel target |
| Swipe | Scroll or surface navigation when not editing | Disabled during value edit | Disabled |

Gestures must never trigger a command without an explicit confirmation.

## 12. Visual semantics

| Meaning | Visual rule |
|---|---|
| Normal/available | Neutral background/text |
| Running/energized | Green only when confirmed and operationally useful, plus text |
| Off/stopped | Neutral gray plus text |
| Warning | Yellow/amber badge plus symbol/text |
| Fault/alarm | Red badge/banner plus symbol/text |
| Override/manual | Distinct purple-style badge/border plus `OVERRIDE/MANUAL` text |
| Stale/unavailable | Gray hatch/badge plus age/reason |
| Pending | Spinner/progress plus `PENDING` |

Colors inherit from [Design System](KX-DDC24-UX-SYSTEM-001_VI.md), but contrast must
be measured on the actual panel/theme.

## 13. Localization

- English default and Vietnamese UTF-8 are mandatory.
- Values, units, point IDs and reason codes remain stable across locale.
- Translated text must be tested for clipping at 14 px.
- A language change rebuilds labels without changing control/session state.

## 14. Current source corrections required

| Current source behavior | UX correction |
|---|---|
| Six always-visible tabs | Five surfaces with single title/page chooser |
| 12 px runtime font | Minimum 14 px body |
| 22–29 px action buttons | Minimum 40×40 px or hard-key equivalent |
| Local alarm ACK | Pending/authoritative ACK lifecycle |
| Static local role/PIN | Broker session with expiry |
| No Control surface | Whitelist list + point faceplate |
| Direct reboot/signal hooks | Remove privilege; brokered or disabled maintenance |
| Communication defaults | Authoritative state or `UNAVAILABLE` |

## 15. Target validation scenarios

1. Thirty-second abnormal-state recognition.
2. All five surfaces reachable by touch and hard keys.
3. Setpoint at min/max and rejection outside range.
4. Auto/Manual command with a higher priority winner.
5. Override reason/TTL, expiry and explicit release.
6. Alarm ACK accepted/rejected/timeout and alarm flood.
7. Broker/core loss during Pending and recovery without replay.
8. Session expiry while override remains active.
9. Stale/corrupt SHM and recovery.
10. Glove/light, font/localization, 40×40 targets and first-input wake suppression.
11. Ethernet static/DHCP apply, old/new display, countdown, confirm and automatic/manual rollback.

## Revision history

| Revision | Date | Change |
|---|---|---|
| 2.1 | 2026-07-22 | Service-panel UX and source-aligned release gaps. |
| 3.0 | 2026-07-22 | ADR-016 five-surface limited operator UX, point faceplate, authoritative command/session states and measurable interaction targets. |
| 3.1 | 2026-07-22 | Added ADR-017 Ethernet IPv4 commissioning flow and rollback countdown under Service. |
