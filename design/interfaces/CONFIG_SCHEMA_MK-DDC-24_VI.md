# Config File Schema — MK-DDC-24
## D-5 — cấu hình `/data/config/*.conf` (JSON)

> **Document ID:** ICD-CONFIG-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30 · 📘 [spec/README](../../spec/README.md)
> **Trace:** `SW_ARCH §5`, `SW-IDE-010..015`, `IDE-020..025`

> Tất cả file cấu hình là **JSON**, nằm ở `/data/config/`, do Web IDE ghi, các service đọc. Mỗi file có **JSON Schema** (validate khi ghi). Dưới đây: schema rút gọn + **ví dụ thật**.

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

## 2. `network.conf` — mạng
```json
{ "mode": "dhcp",            // "dhcp" | "static"
  "ip": "192.168.1.50", "netmask": "255.255.255.0",
  "gateway": "192.168.1.1", "dns": ["8.8.8.8"],
  "hostname": "mk-ddc-24-fcu3a" }
```

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

## 5. `bacnet.conf` — BACnet + Modbus RS-485
```json
{
  "bip": { "enabled": true, "udp_port": 47808, "bbmd": null },
  "mstp": { "enabled": true, "mac": 12, "baud": 38400, "max_master": 127 },
  "rs485_mode": "bacnet-mstp",     // "bacnet-mstp" | "modbus-rtu"
  "modbus_unit_id": 12             // dùng khi rs485_mode = modbus-rtu (1..247)
}
```
> `rs485_mode` đổi cần reboot (RTU-002). MS/TP và Modbus RTU không chạy đồng thời.

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
