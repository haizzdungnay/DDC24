# HMI TFT UI — MK-DDC-24
## Thiết kế giao diện màn hình tại chỗ (2.4" TFT)

> **Document ID:** KX-DDC24-UX-HMI-001
> **Phiên bản:** 2.0 | 2026-06-26 · **Trạng thái:** Draft · **Owner:** UX Lead
> [docs/README](../README.md) · [SW_HMI_DESIGN Rev 2.1](../02_design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md) · Use Cases [KX-DDC24-UC-HMI-001 Rev 2.1](KX-DDC24-UC-HMI-001_VI.md)
> **Trace:** `HMI-001..022`, `SW-HMI-001..008`

---

## 1. Ràng buộc phần cứng

| Thông số | Giá trị |
|---------|--------|
| Module | KD024QVFIA073-02-C021B (Startek) |
| Display controller | JD9852, MIPI DSI 1-lane |
| Resolution | 240×320 → xoay landscape **320×240** |
| Display driver (Linux) | DRM/KMS `/dev/dri/card0` (không dùng fbdev) |
| Touch controller | FT5436, I2C 0x38, 5-point capacitive |
| Touch driver (Linux) | `ft5x06_ts` → `/dev/input/touchscreen0` |
| Nút cứng | 6 nút GPIO: UP/DOWN/LEFT/RIGHT/ENTER/ESC |
| Font | NotoSans (hỗ trợ tiếng Việt) |
| FPS | ≥ 10 FPS |
| Refresh dữ liệu | ≤ 1s (đọc shared memory, không mạng) |

---

## 2. Input Methods

| Hành động | Touch (primary) | 6 nút cứng (fallback) |
|-----------|----------------|----------------------|
| Chuyển page | Vuốt trái / phải | LEFT / RIGHT |
| Cuộn | Vuốt lên / xuống | UP / DOWN |
| Chọn item | Tap vào row | UP/DOWN focus → ENTER |
| Xác nhận nguy hiểm | Tap + hold 3s | ENTER giữ 3s |
| Huỷ | Tap [X] | ESC |
| Wake screen saver | Chạm bất kỳ | Nhấn bất kỳ nút |

---

## 3. Mô hình điều hướng

```
Home ↔ I/O Monitor ↔ Alarm/Event ↔ Communication ↔ System/Diagnostics ↔ Service/Config ↔ Home
 [1]       [2]            [3]             [4]               [5]                 [6]
```

- Tab strip trên cùng luôn hiển thị, highlight tab đang active.
- Vuốt / LEFT/RIGHT vòng tuần hoàn.
- Tap trực tiếp vào tab để nhảy page.

---

## 4. Khung chung

```
┌──────────────────────────────────────────────────┐
│ Home  I/O  Alarm  Net  Sys  Svc      10:42:33    │  ← tab strip + giờ
├──────────────────────────────────────────────────┤
│                                                  │
│                 [ Nội dung page ]                 │
│                                                  │
├──────────────────────────────────────────────────┤
│ ◄ ►: page   ▲▼: chọn   ⏎: OK   ⎋: thoát         │  ← gợi ý phím
└──────────────────────────────────────────────────┘
```

**Overlay bắt buộc khi I/O FAULT:**
```
┌──────────────────────────────────────────────────┐
│ ██████████████  I/O FAULT  ████████████████████  │  ← banner đỏ full width
│ Home  I/O  Alarm  Net  Sys  Svc      10:42:33    │
...
```

---

## 5. Page 1 — Home / Controller Health

Màn mặc định sau boot. Kỹ sư nhìn trong 30 giây phải biết DDC bình thường hay không.

```
MK-DDC-24-001                              RUNNING
2026-06-26  18:30:05
──────────────────────────────────────────────────
ALARM
Active: 0          Unacked: 0          Critical: 0

CONTROLLER HEALTH
CPU: 18%           RAM: 312/2048 MB    Storage: 12/64 GB
Temp: 52.3 °C      Uptime: 3d 14h      Health: NORMAL

I/O HEALTH
UI: 8 OK / 0 BAD / 0 STALE
DI: 8 OK / 0 BAD / 0 STALE
AO: 4 OK / 0 BAD / 0 STALE
DO: 4 OK / 0 BAD / 0 STALE

COMMUNICATION
Ethernet: OK       IP: 192.168.1.18
BACnet: OK         Device ID: 1001      Last req: 12s ago
Modbus RTU-1: OK   Modbus RTU-2: DISABLED

CONFIG
Profile: GENERIC_DDC    Config Rev: 24    Checksum: OK
```

**Quy tắc:**
- Không hardcode "Room Temp", "Fan", "Power", "Energy", "AHU".
- Không hiển thị IOP/core/HMI service process (debug only).
- `Active: N` không giảm khi alarm chỉ được ACK mà vẫn còn active.
- BACnet hiển thị `Last req: Xs ago` thay vì "Đang kết nối".

---

## 6. Page 2 — I/O Monitor

```
I/O MONITOR                                Page 1/3

POINT   NAME    TYPE   VALUE    UNIT   QUALITY   AGE
UI1     UI1     UI     23.5     °C     GOOD      120ms
UI2     UI2     UI     7.8      V      GOOD      120ms
UI3     UI3     UI     12.3     mA     GOOD      130ms
UI4     UI4     UI     ---      ---    BAD       2.3s
UI5     UI5     UI     45.0     %      GOOD      120ms
UI6     UI6     UI     ---      ---    STALE     8.1s

──────────────────────────────────────────────────
Filter: ALL / BAD / STALE          [Page 2] [Page 3]
```

**Phân page:**
- Page 1: UI1–UI8 + DI1–DI8
- Page 2: AO1–AO4 + DO1–DO4
- Page 3: Tổng hợp hoặc filter BAD/STALE

**Quality legend:**
- `GOOD` — dữ liệu hợp lệ, trong ngưỡng
- `BAD` — lỗi tín hiệu / đứt cảm biến / out of range
- `STALE` — dữ liệu cũ quá ngưỡng cấu hình (thiếu cập nhật từ IOP/Modbus)
- `UNCERTAIN` — tín hiệu nghi ngờ nhưng chưa kết luận lỗi

**Quy tắc:**
- Tên point lấy từ `display_name` trong point database; nếu chưa có thì dùng mã kỹ thuật (UI1, DI1...).
- `AGE` hiển thị thời gian kể từ lần cập nhật cuối từ SHM.
- Không hiển thị point thiếu `point_id`, `io_type`, `unit` (analog), `quality`.

---

## 7. Page 3 — Alarm / Event

```
ALARM / EVENT

SUMMARY
Active: 2          Unacked: 1          Critical: 1

TIME        CODE   SEV     POINT   MESSAGE               STATE
10:30:05    E302   FAULT   MB1     Modbus timeout        ACTIVE_UNACK
09:12:41    E303   WARN    RS485   Bus error high        ACTIVE_ACK
08:55:00    E001   FAULT   IO      I/O fault cleared     CLEARED_ACK

──────────────────────────────────────────────────
[Ack Selected]    [Filter: Active]    [Event Log]
```

**State model — bắt buộc:**

| State | Ý nghĩa |
|-------|---------|
| `ACTIVE_UNACK` | Lỗi đang tồn tại, chưa xác nhận |
| `ACTIVE_ACK` | Lỗi đang tồn tại, đã xác nhận |
| `CLEARED_UNACK` | Lỗi đã hết, chưa xác nhận lịch sử |
| `CLEARED_ACK` | Lỗi đã hết và đã xác nhận |

**Quy tắc:**
- ACK không xóa lỗi active — chỉ đổi UNACK → ACK.
- `Active: N` trên Home không giảm khi chỉ ACK.
- Severity FAULT = đỏ, WARN = vàng, INFO = xám.
- INFO không có nút ACK.

---

## 8. Page 4 — Communication

```
COMMUNICATION

ETHERNET
Link         UP
IP           192.168.1.18
Mask         255.255.255.0
Gateway      192.168.1.1
MAC          b8:13:32:73:3e:4e

BACnet/IP
Enabled      YES
Device ID    1001
Port         47808
Status       OK
Last Request 12s ago

Modbus RTU-1
Port         RS485-1
Baudrate     9600
Parity       NONE
Slaves       8
Status       OK
Timeouts     0

Modbus RTU-2
Port         RS485-2
Status       DISABLED

Modbus TCP
Enabled      YES
Port         502
Status       OK
```

**Status chuẩn (không dùng "Đang kết nối"):**

| Status | Ý nghĩa |
|--------|---------|
| `OK` | Hoạt động bình thường |
| `DISABLED` | Đã tắt trong cấu hình |
| `NO_TRAFFIC` | Không có traffic |
| `TIMEOUT` | Có timeout |
| `CONFIG_ERROR` | Sai cấu hình |
| `DUPLICATE_ID` | Trùng BACnet Device ID |
| `LINK_DOWN` | Ethernet mất link |

---

## 9. Page 5 — System / Diagnostics

```
SYSTEM / DIAGNOSTICS

FIRMWARE
SOM FW        v1.4.2-89fb37c
MCU FW        v2.0.0
Build ID      2026.06.26-r24
Config Rev    24

RUNTIME
Uptime        3d 14h 22m
Boot Reason   POWER_ON
Last Error    NONE

RESOURCE
CPU           18%
RAM           312 / 2048 MB
Storage       12.3 / 64 GB
CPU Temp      52.3 °C

PROCESS / SERVICE
core          RUNNING
iobus         RUNNING
hmi           RUNNING
bacnet        RUNNING
modbus        RUNNING

WATCHDOG
Status        OK
Last Reset    NONE

LOG
Last Warn     NONE
Last Fault    NONE
```

---

## 10. Page 6 — Service / Config

Trang có khóa quyền. Hiển thị mặc định là LOCKED — mọi action bị disable.

```
SERVICE / CONFIG                          LOCKED

ACCESS
Mode          PIN REQUIRED
Role          VIEW ONLY
Service SW    OFF

PROJECT
Project ID    MK-DDC24-DEMO
Profile       GENERIC_DDC
Config Rev    24
Checksum      OK

POINT DATABASE
Total Points  24
UI: 8    DI: 8    AO: 4    DO: 4

SAFE STATE POLICY
DO            PER_POINT (per point_db safe_state field)
AO            PER_POINT (per point_db safe_state field)
UI/DI         READ_ONLY

ACTIONS
[ Reload Config ]       LOCKED
[ Restart Services ]    LOCKED
[ Reboot System ]       LOCKED
[ Backup Config ]       LOCKED
[ Restore Config ]      LOCKED
```

**Điều kiện unlock (ít nhất 1 trong):**
- Nhập Service PIN hợp lệ
- Physical service switch đang ON
- User role là Engineer/Service (set qua Web UI)

**Reboot — safe state:**
- Không hardcode AO=0V/4mA, DO=OFF cho toàn hệ thống.
- Áp dụng `safe_state` per-point từ point database.

---

## 11. Phản hồi & an toàn

| Tình huống | Hành vi |
|-----------|--------|
| Mất IOP | Banner đỏ "I/O FAULT" phủ toàn width trên mọi page, không tắt được cho đến khi fault clear |
| Data STALE | Label AGE đổi màu vàng; quality hiện STALE; không hiển thị giá trị cũ như giá trị tốt |
| Restart | Phải unlock Service Mode trước; giữ xác nhận 3 giây; safe state per-point trước khi tắt |
| Screen saver | Dim sau 5 phút idle; chạm/nhấn bất kỳ để wake; cử chỉ wake bị nuốt không navigate |
| BACnet status | Không bao giờ hiển thị "Đang kết nối" — chỉ dùng OK / NO_TRAFFIC / CONFIG_ERROR / DUPLICATE_ID |

---

## 12. Localization

EN (mặc định) + VI; đổi qua SIGHUP hoặc Web UI; không reboot.

---

## 13. Handoff (LVGL)

- Mỗi page = 1 `lv_obj` screen; chuyển page = `lv_scr_load_anim(LV_SCR_LOAD_ANIM_MOVE_LEFT/RIGHT)`.
- Display init: `drm_init("/dev/dri/card0")` — không dùng fbdev.
- Touch input: `LV_INDEV_TYPE_POINTER` qua evdev `/dev/input/touchscreen0`.
- Button input: `LV_INDEV_TYPE_KEYPAD` qua GPIO poll thread (20ms debounce).
- Data binding: timer 1s đọc `kx_io_shm_t` + `kx_plc_shm_t` từ `/dev/shm/` cập nhật label/table.
- AGE: tính từ `last_update_ts` trong SHM entry.

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | UX Lead | Phát hành đầu — 5 màn HMI + điều hướng 6 nút |
| 1.1 | 2026-06-26 | UX Lead | Thêm backlink UC doc |
| 2.0 | 2026-06-26 | UX Lead | Viết lại hoàn toàn: sửa hardware (JD9852 MIPI DSI + FT5436 CTP, bỏ ILI9341/SPI), bỏ arc gauge → text tile, 6 page (thêm Service/Config), alarm 4-state model, BACnet status kỹ thuật, safe state per-point, data age mandatory, no-hardcode rule |
