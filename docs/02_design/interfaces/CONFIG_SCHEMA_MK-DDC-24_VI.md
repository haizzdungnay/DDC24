# Config File Schema — MK-DDC-24
## D-5 — cấu hình `/data/config/*.conf` (JSON)

> **Document ID:** ICD-CONFIG-MK-DDC-24-VI
> **Phiên bản:** 1.2 | 2026-06-17 (§5: bacnet.conf thêm `bind_interface`; §5b: fieldbus.conf thêm `rs485.device` bắt buộc + table đầy đủ) · 1.1 | 2026-06-11 · 📘 [README](../../01_specs/README.md)
> **Trace:** `SW_ARCH §5`, `SW-IDE-010..015`, `IDE-020..025`

> Tất cả file cấu hình là **JSON**, nằm ở `/data/config/`, do `mkddc-web` ghi, các service đọc. Mỗi file có **JSON Schema** (validate khi ghi). Dưới đây: schema rút gọn + **ví dụ thật**.

**Owner / reader / reload từng file (chuẩn duy nhất):**

| File | Writer | Reader (service) | Reload khi đổi |
|------|--------|------------------|-----------------|
| `device.conf` | mkddc-web | mkddc-iobus (BACnet), mkddc-core | SIGHUP iobus |
| `network.conf` | mkddc-web | mkddc-web (áp hệ thống) | apply ngay (netplan/networkd) |
| `io_config.conf` | mkddc-web | **mkddc-iobus** (scale + SET_AO_CFG) | SIGHUP iobus (re-handshake AO cfg) |
| `io_safe_state.conf` | mkddc-web | **mkddc-core** (relinquish default + safe-state) | SIGHUP core |
| `bacnet.conf` | mkddc-web | mkddc-iobus | restart iobus |
| `fieldbus.conf` | mkddc-web | mkddc-iobus | restart iobus |
| `mqtt.conf` | mkddc-web | (Rev B+ agent) | — |
| `users.conf` | mkddc-web | mkddc-web | apply ngay |
| `iobus.conf` (xem [06 §4](../../03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md)) | dev/provisioning | mkddc-iobus | restart iobus |

> ⚠️ **RECONCILE (2026-06-08).** Phần **logic điều khiển** (component nodes/links) nay nằm ở
> [`graph.json`](GRAPH_SCHEMA_MK-DDC-24_VI.md) (nguồn-chuẩn) thay cho program FBD/ST. File config
> ở đây giữ vai trò device/IO/BACnet/Modbus/system; "Web IDE ghi" nay là `mkddc-web` (Go, form/JSON).
> Khi io_map/modbus trùng lặp giữa hai tài liệu, **nguồn-chuẩn cấu trúc = GRAPH_SCHEMA**.

---

## 1. `device.conf` — danh tính BACnet
**Schema (rút gọn):**
```json
{
  "type": "object",
  "required": ["device_id", "device_name"],
  "properties": {
    "device_id":   {"type":"integer","minimum":1,"maximum":4194302},
    "device_name": {"type":"string","maxLength":64},
    "description": {"type":"string"},
    "location":    {"type":"string"}
  }
}
```
**Ví dụ:**
```json
{ "device_id": 1001, "device_name": "FCU-Zone-3F-A", "location": "Tang 3 - khu A" }
```
> Nếu file không tồn tại → dùng DIP SW1–SW7 (1–127) đọc qua CM3 GPIO (SW-BAC-006).

## 2. `network.conf` — mạng (Ethernet + WiFi, northbound IP)
```json
{ "eth": {
    "mode": "dhcp",            // "dhcp" | "static"
    "ip": "192.168.1.50", "netmask": "255.255.255.0",
    "gateway": "192.168.1.1", "dns": ["8.8.8.8"] },
  "wifi": {
    "enabled": false,
    "ssid": "", "psk": "",     // WPA2/WPA3
    "mode": "dhcp" },
  "hostname": "mk-ddc-24-fcu3a" }
```
> Lên BMS/cloud (BACnet/IP, MQTT, REST) đi qua Ethernet hoặc WiFi (đều là IP).

## 3. `io_config.conf` — loại sensor mỗi kênh UI + mode AO
```json
{
  "ui": [
    {"ch":1, "type":"NTC10k",   "unit":"degC"},
    {"ch":2, "type":"PT1000",   "unit":"degC"},
    {"ch":3, "type":"dry",      "unit":"bool"},
    {"ch":4, "type":"4-20mA",   "unit":"percent", "scale_lo":0, "scale_hi":100},
    {"ch":5, "type":"0-10V",    "unit":"ppm",     "scale_lo":0, "scale_hi":2000}
  ],
  "ao": [
    {"ch":1, "mode":"0-10V"},
    {"ch":2, "mode":"4-20mA"}
  ]
}
```
- `type` ∈ `0-10V|4-20mA|PT100|PT1000|NTC10k|NTC20k|dry`.
- `ao.mode` ∈ `0-10V|4-20mA` → **mkddc-iobus** gửi `SET_AO_CFG` xuống MCU (mode đã áp dụng ghi vào `kx_io_shm.ao_mode[]`).

## 4. `io_safe_state.conf` — giá trị an toàn khi lỗi
```json
{
  "ao": [ {"ch":1,"safe":0.0}, {"ch":2,"safe":4.0} ],   // V hoặc mA tùy mode
  "do": [ {"ch":1,"safe":"open"}, {"ch":2,"safe":"open"} ]
}
```
> Không cấu hình → mặc định AO 0V/4mA, DO open (IOP-SPEC §6.3).
> **Quan hệ chốt (2026-06-12):** file này cấu hình **relinquish default mức 6** của
> priority resolver (07 §4). Safety ACTION khi fault/stale (07 §5.3) CỐ ĐỊNH 0V/4mA/open
> ở cả 3 lớp (MCU/iobus/core), KHÔNG đổi theo file này — config sai không thể làm
> hệ mất đường về safe. Loader: `services/core/safe_state_config.*` (fail-fast khi JSON hỏng).

## 5. `bacnet.conf` — BACnet/IP (chỉ IP — ARCH-R010)
```json
{
  "bip": {
    "enabled": true,
    "udp_port": 47808,
    "bind_interface": "eth0",
    "bbmd": null,
    "foreign_device": null
  }
}
```
| Field | Bắt buộc | Mặc định | Ý nghĩa |
|-------|----------|----------|---------|
| `bip.enabled` | ✅ | — | `true`/`false` — bật/tắt BACnet/IP stack |
| `bip.udp_port` | không | 47808 | UDP port; thường giữ nguyên 47808 |
| `bip.bind_interface` | không | `""` (all) | Tên NIC cụ thể để bind (vd `"eth0"`, `"wlan0"`). Chuỗi rỗng = bind all interfaces. **Khuyến nghị đặt tường minh** để tránh listen WAN. |
| `bip.bbmd` | không | null | BBMD address table (khi DDC trong mạng khác BMS); `null` = không dùng BBMD |
| `bip.foreign_device` | không | null | FD registration BBMD IP+TTL; `null` = không đăng ký |

> ⚠ Đã **bỏ `mstp` và `rs485_mode`** (MS/TP loại bỏ). BACnet chỉ chạy BACnet/IP qua Ethernet/WiFi. RS-485 cấu hình ở `fieldbus.conf` (§5b).
> Thêm `bind_interface` 2026-06-17: bắt buộc chỉ rõ interface theo yêu cầu security (plan 24 §1).

## 5b. `fieldbus.conf` — RS-485 Modbus RTU **master** (thiết bị phụ)
```json
{
  "rs485": { "device": "/dev/ttyS3", "baud": 19200, "parity": "N", "stop": 1 },
  "poll_default_ms": 1000,
  "slaves": [
    { "addr": 10, "profile": "kinexus-io-ext-8di8do", "poll_ms": 500,  "name": "EXT-1" },
    { "addr": 11, "profile": "kinexus-remote-hmi",     "poll_ms": 1000, "name": "HMI-2" },
    { "addr": 20, "profile": "generic-power-meter",    "poll_ms": 2000, "name": "Meter-A" }
  ]
}
```
| Field | Bắt buộc | Mặc định | Ý nghĩa |
|-------|----------|----------|---------|
| `rs485.device` | ✅ | — | Đường dẫn serial port RS-485 (vd `/dev/ttyS3`, `/dev/ttyUSB0`). **Bắt buộc** — không hardcode trong code. |
| `rs485.baud` | ✅ | — | Baud rate: 9600/19200/38400/57600/115200 |
| `rs485.parity` | không | `"N"` | `"N"` / `"E"` / `"O"` |
| `rs485.stop` | không | 1 | 1 hoặc 2 stop bits |
| `poll_default_ms` | không | 1000 | Poll interval mặc định cho slave không khai báo `poll_ms` |
| `slaves[].addr` | ✅ | — | Địa chỉ Modbus slave (1–247) |
| `slaves[].profile` | ✅ | — | Profile ID (tìm trong `/usr/share/kinexus/profiles/` hoặc `/data/config/profiles/`) |
| `slaves[].poll_ms` | không | `poll_default_ms` | Poll interval riêng cho slave này |
| `slaves[].name` | ✅ | — | Tên slave; dùng làm prefix trong ext point name (`EXT-<name>.<point>`) |

> `profile` trỏ tới template register-map (xem [D-2 §3](MODBUS_REGISTER_MAP_MK-DDC-24_VI.md)). Thêm slave = thêm 1 phần tử; đổi baud hoặc device cần restart `mkddc-iobus`.
> Field `device` thêm 2026-06-17: bắt buộc chỉ rõ serial port để không hardcode trong code (plan 25 §4 gap closed).

## 6. `mqtt.conf`
```json
{
  "enabled": true,
  "broker": "tls://broker.example.com:8883",
  "client_id": "mk-ddc-24-1001",
  "topic_prefix": "kinexus/1001",
  "tls": { "ca":"/data/certs/ca.pem", "cert":null, "key":null, "insecure": false },
  "qos": 1, "retain_last_value": true
}
```
> Chỉ chấp nhận `tls://` (8883). `mqtt://` (1883) bị từ chối trừ khi admin bật cờ tin cậy nội bộ (SEC-020).

## 7. `users.conf` — tài khoản (mật khẩu hash bcrypt)
```json
{
  "users": [
    {"username":"admin","role":"admin","pw_bcrypt":"$2b$12$...."},
    {"username":"tech","role":"operator","pw_bcrypt":"$2b$12$...."},
    {"username":"guest","role":"viewer","pw_bcrypt":"$2b$12$...."}
  ]
}
```
> `role` ∈ `admin|operator|viewer` (CHỐT Rev A — ma trận quyền:
> [08 §1.1](../../03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md); role "engineer"
> cũ không còn). **KHÔNG** lưu mật khẩu plaintext (SW-IDE-021). Hash bcrypt cost ≥ 12.

## 8. Quy tắc chung
- Mọi file UTF-8, có khoá `"_schema_version"` để migrate.
- Ghi atomic (ghi `*.tmp` rồi `rename`) tránh hỏng khi mất điện — vì vậy file tồn tại
  nhưng JSON hỏng = deploy/đĩa lỗi thật, KHÔNG phải trạng thái bình thường.
- File nhạy cảm (`users.conf`, `certs/`) quyền 600, owner đúng service.

**Policy lỗi config (chuẩn duy nhất — khớp [06 §4](../../03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md); thay câu cũ "lỗi → default, không crash"):**

| Tình huống | Hành vi service đọc | Lý do |
|------------|---------------------|-------|
| Thiếu file | dùng default built-in toàn bộ; log WARN | thiết bị mới chưa provision là bình thường |
| JSON sai cú pháp | **fail-fast** (exit ≠ 0, systemd restart) + log ERROR + alarm | file được ghi atomic nên hỏng = sự cố thật; không đoán mò config |
| Thiếu field lẻ | default field đó; log WARN `field=..` | schema mở rộng dần |
| Field sai kiểu / unknown enum (vd `sensor_type` lạ) | **disable đơn vị liên quan** (kênh đó quality=BAD / slave đó bỏ qua) + log ERROR + alarm; service VẪN chạy | lỗi cục bộ không được hạ cả service |
| Giá trị ngoài range | clamp về biên + log WARN | vận hành tiếp an toàn |

## 9. Trace REQ
`SW_ARCH §5`, `IDE-020..025`, `SW-IDE-010..015`, `RTU-002`, `MB-010`.

---
**Rev** 1.0 | 2026-05-30
