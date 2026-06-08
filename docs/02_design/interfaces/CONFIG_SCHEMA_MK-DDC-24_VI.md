# Config File Schema — MK-DDC-24
## D-5 — cấu hình `/data/config/*.conf` (JSON)

> **Document ID:** ICD-CONFIG-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30 · 📘 [README](../../01_specs/README.md)
> **Trace:** `SW_ARCH §5`, `SW-IDE-010..015`, `IDE-020..025`

> Tất cả file cấu hình là **JSON**, nằm ở `/data/config/`, do Web IDE ghi, các service đọc. Mỗi file có **JSON Schema** (validate khi ghi). Dưới đây: schema rút gọn + **ví dụ thật**.

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
- `ao.mode` ∈ `0-10V|4-20mA` → io-driver gửi `SET_AO_CFG` xuống MCU.

## 4. `io_safe_state.conf` — giá trị an toàn khi lỗi
```json
{
  "ao": [ {"ch":1,"safe":0.0}, {"ch":2,"safe":4.0} ],   // V hoặc mA tùy mode
  "do": [ {"ch":1,"safe":"open"}, {"ch":2,"safe":"open"} ]
}
```
> Không cấu hình → mặc định AO 0V/4mA, DO open (IOP-SPEC §6.3).

## 5. `bacnet.conf` — BACnet/IP (chỉ IP — ARCH-R010)
```json
{
  "bip": { "enabled": true, "udp_port": 47808, "bbmd": null, "foreign_device": null }
}
```
> ⚠ Đã **bỏ `mstp` và `rs485_mode`** (MS/TP loại bỏ). BACnet chỉ chạy BACnet/IP qua Ethernet/WiFi. RS-485 cấu hình ở `fieldbus.conf` (§5b).

## 5b. `fieldbus.conf` — RS-485 Modbus RTU **master** (thiết bị phụ)
```json
{
  "rs485": { "baud": 19200, "parity": "N", "stop": 1 },
  "poll_default_ms": 1000,
  "slaves": [
    { "addr": 10, "profile": "kinexus-io-ext-8di8do", "poll_ms": 500,  "name": "EXT-1" },
    { "addr": 11, "profile": "kinexus-remote-hmi",     "poll_ms": 1000, "name": "HMI-2" },
    { "addr": 20, "profile": "generic-power-meter",    "poll_ms": 2000, "name": "Meter-A" }
  ]
}
```
> `profile` trỏ tới template register-map (xem [D-2 §3](MODBUS_REGISTER_MAP_MK-DDC-24_VI.md)). Thêm slave = thêm 1 phần tử; đổi baud cần reboot field-bus service.

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
    {"username":"tech","role":"operator","pw_bcrypt":"$2b$12$...."}
  ]
}
```
> **KHÔNG** lưu mật khẩu plaintext (SW-IDE-021). Hash bcrypt cost ≥ 12.

## 8. Quy tắc chung
- Mọi file UTF-8, có khoá `"_schema_version"` để migrate.
- Service validate JSON Schema khi load; lỗi → dùng default + log + alarm, không crash.
- Ghi atomic (ghi `*.tmp` rồi `rename`) tránh hỏng khi mất điện.
- File nhạy cảm (`users.conf`, `certs/`) quyền 600, owner đúng service.

## 9. Trace REQ
`SW_ARCH §5`, `IDE-020..025`, `SW-IDE-010..015`, `RTU-002`, `MB-010`.

---
**Rev** 1.0 | 2026-05-30
