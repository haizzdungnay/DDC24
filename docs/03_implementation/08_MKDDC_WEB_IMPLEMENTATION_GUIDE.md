# 08 — mkddc-web Implementation Guide
## MK-DDC-24 — REST API + Web UI + Config + Validator

> **Document ID:** IMPL-WEB-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-11 (Contract Freeze: RBAC 3 role, web luôn vào mức manual, IPC contract 07 §8, SystemStatus versions)
> **Owner:** Dev 3 (Web/BE)
> **Nguồn-chuẩn:** [REST_API_OPENAPI](../02_design/interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) ·
> [CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) ·
> [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) · [ADR-007](../adr/ADR-007-web-stack-go.md)

> 🎯 Vai trò: giao diện người dùng + API. **Web KHÔNG mở UART, KHÔNG gọi MCU, KHÔNG ghi
> thẳng IO.** Web gửi command/setpoint cho **core** qua IPC; core quyết định. Mọi command
> ghi **audit log**.

---

## 1. Backend module (Go)

```
web/backend/
├── main.go            — HTTP/HTTPS server, router, TLS 1.3, middleware
├── auth.go            — POST login (JWT), bcrypt, RBAC (admin/operator/viewer — bảng §1.1)
├── points.go          — GET/PUT points → IPC tới core (đọc snapshot, gửi command)
├── system.go          — GET/PUT system status/config (IOP metrics, sensor type, network)
├── alarms.go          — GET alarms, POST ack (đọc alarm bus / eventlog)
├── commissioning.go   — POST test point → command tới core (nguồn manual — mức 2; role operator+)
├── graph.go           — POST validate (validator lib), POST deploy (ghi graph.json)
├── core_client.go     — IPC client tới mkddc-core (/run/mkddc/core.sock — contract đầy đủ: 07 §8)
├── audit.go           — ghi audit log mọi command/deploy (user, ts, action, result)
└── store.go           — SQLite (config.sqlite, eventlog.sqlite) WAL
```

### 1.1 RBAC matrix (CHỐT Rev A — 3 role, khớp openapi.yaml + users.conf)

| Quyền | viewer | operator | admin |
|-------|--------|----------|-------|
| Login / xem points, status, alarms | ✅ | ✅ | ✅ |
| PUT points (manual override) + release | — | ✅ | ✅ |
| Commissioning test DO/AO | — | ✅ | ✅ |
| Ack alarm | — | ✅ | ✅ |
| Graph validate (read-only check) | — | ✅ | ✅ |
| Graph **deploy** | — | — | ✅ |
| Config (io/network/device/safe-state) | — | — | ✅ |
| Users, OTA, download logs | — | — | ✅ |

> Role cũ "engineer" trong bản trước = operator (commissioning) hoặc admin (deploy) theo bảng
> trên — KHÔNG còn là role riêng. `users.conf` enum: `admin|operator|viewer`.

### 1.2 Priority: web map vào đâu (CHỐT — khớp core 6 mức, PRODUCT_DEFINITION §13)

```
- Web/commissioning command  → nguồn "Local manual"  = mức 2. Client KHÔNG chọn priority.
- BACnet write               → priority array BACnet 1..16 (kx_plc_shm), resolve riêng,
                               kết quả vào core ở mức 3. REST không expose 1..16.
- release=true               → nhả manual (relinquish mức 2); core rơi về nguồn kế.
- Response của core {result, applied_value, active_source} → ghi audit + hiển thị
  "Lệnh bị ghi đè bởi <nguồn>" nếu overridden.
```

```
web/frontend/ (React)
├── Login
├── PointList      — bảng 24 IO: value, unit, quality, fault
├── PointDetail    — 1 point + trend nhẹ + nút test (commissioning)
├── SystemStatus   — CPU/RAM/IOP metrics/version
├── Config         — sensor type per UI, network, safe-state, AO mode
├── Alarms         — list + ack
└── GraphDeploy    — upload graph.json → validate → deploy

web/validator/    — Go library (KHÔNG service): kiểm graph.json trước deploy
web/storage/      — schema SQLite, migration
```

---

## 2. API list (tối thiểu — khớp REST_API_OPENAPI)

| Method | Endpoint | Auth | Đi tới | Mô tả |
|--------|----------|------|--------|-------|
| POST | `/api/v1/auth/login` | none | — | Login, trả JWT + role (admin/operator/viewer) |
| GET | `/api/v1/points` | Bearer | core (read) | Danh sách 24 IO |
| GET | `/api/v1/points/{id}` | Bearer | core (read) | 1 point {value,quality,ts} |
| PUT | `/api/v1/points/{id}` | Bearer operator+ | core (command) | Ghi giá trị → nguồn manual mức 2 (§1.2); body {value} hoặc {release:true} |
| GET | `/api/v1/system/status` | Bearer | core/iobus metrics | CPU/RAM/IOP |
| GET | `/api/v1/system/config` | Bearer admin | store | Đọc config |
| PUT | `/api/v1/system/config` | Bearer admin | store + core reload | Cập nhật config |
| GET | `/api/v1/alarms` | Bearer | eventlog/alarm bus | Alarm active |
| POST | `/api/v1/alarms/{id}/ack` | Bearer | eventlog | Ack alarm |
| POST | `/api/v1/commissioning/points/{id}/test` | Bearer operator+ | core (manual mức 2) | Test DO/AO thật |
| POST | `/api/v1/graph/validate` | Bearer operator+ | validator lib | Kiểm graph.json |
| POST | `/api/v1/graph/deploy` | Bearer **admin** | validator+core | Deploy nếu pass |

---

## 3. Data model (Point response — SW_ARCH §6.2)

```json
{
  "id": "UI1", "type": "AI", "value": 23.5, "unit": "°C",
  "quality": "good", "timestamp": "2026-06-10T10:00:00.123Z",
  "sensor_type": "NTC10k", "fault": false
}
```
System status (versions tách từng thành phần — Contract Freeze; nguồn metrics ghi rõ):
```json
{ "cpu_percent": 12.5, "ram_percent": 35.2, "uptime_s": 86400,
  "versions": { "mcu_fw": "1.0", "iobus": "1.2.0", "core": "1.1.0", "web": "1.0.0" },
  "iop":  { "status": "normal", "crc_errors": 0, "timeouts": 0, "seq_errors": 0,
            "last_io_resp_ms": 12 },
  "scan": { "count": 86400, "overrun": 0 } }
```
> Nguồn: `iop.*` + `versions.mcu_fw/iobus` từ `kx_io_shm` (iobus ghi); `scan.*` +
> `versions.core` từ `kx_plc_shm` (core ghi); web đọc read-only, KHÔNG tự đo lại.

---

## 4. Config model (CONFIG_SCHEMA)

| File | Nội dung |
|------|----------|
| `/data/config/io_config.conf` | sensor type per UI (0-10V/4-20mA/PT100/NTC10k/dry...), AO mode per kênh |
| `/data/config/io_safe_state.conf` | safe-state value per kênh |
| `/data/config/network.conf` | IP/DHCP/DNS |
| `/data/config/device.conf` | BACnet device ID/name |
| `/data/config/users.conf` | user accounts (bcrypt) |

> Web validate input theo schema trước khi ghi; config IO → core/iobus reload (qua signal/IPC).

---

## 5. Validator rule (PRODUCT_DEFINITION §14 — Rev A: 4 check cốt lõi)

```
Rev A (bắt buộc):
1. Output có nhiều nguồn ghi mà chưa qua priority → FAIL.
2. AO chưa có limit (min/max) → FAIL.
3. Sensor/IO lỗi chưa có safe-state fallback → FAIL.
4. Input component chưa nối (dangling) → FAIL.
(Đầy đủ: sai kiểu/unit, vòng lặp nguy hiểm, Modbus mất kết nối chưa fallback, graph quá scan
 budget → roadmap.)
Không pass → KHÔNG deploy.
```
**Module format:**
```
Mục tiêu : kiểm graph.json an toàn trước deploy.
Input    : graph.json (GRAPH_SCHEMA).
Output   : {pass: bool, errors: [...]}.
Test     : graph thiếu limit AO → validate FAIL, deploy bị chặn.
Done khi : 4 check chạy đúng; deploy chỉ khi pass.
```

---

## 6. Audit log

```
- Mọi PUT /points, commissioning test, config change, graph deploy → ghi audit:
  {ts, user, action, target, old, new, result, source_ip}.
- result phản ánh kết quả core (accepted / overridden-by-priority / rejected).
- Lưu eventlog.sqlite; không xoá được từ UI thường.
```

---

## 7. Quy tắc bắt buộc (KHÔNG vi phạm)

```
1. Web KHÔNG mở /dev/ttyS2 (không import serial, không gọi IOP).
2. Web KHÔNG gọi thẳng MCU.
3. Web gửi command cho core (qua core_client IPC), core quyết output.
4. Output command phải có audit log.
5. Lỗi hiển thị bằng ngôn ngữ dễ hiểu ("Mất kết nối MCU" thay vì "IOP_FAULT 0x05").
6. Validate mọi input mạng; TLS 1.3; không hardcode secret; JWT hết hạn.
```

---

## 8. Hiển thị lỗi (mapping kỹ thuật → người dùng)

| Kỹ thuật | Hiển thị web |
|----------|--------------|
| iop_status=FAULT | "Mất kết nối với bộ điều khiển IO (MCU)" |
| ui_quality=BAD | "Cảm biến lỗi / mất tín hiệu" |
| RELAY_STUCK | "Relay không phản hồi đúng lệnh" |
| overridden-by-priority | "Lệnh bị ghi đè bởi mức ưu tiên cao hơn (an toàn/fire)" |
| validator FAIL | liệt kê từng lỗi graph bằng tiếng Việt |

---

## 9. Trace

| Chủ đề | Module | Test |
|--------|--------|------|
| Login/JWT | auth.go | group 5 |
| Point list/detail | points.go | group 5 |
| Commissioning test | commissioning.go | group 5 + group 6 |
| Validator | web/validator | group 5 |
| Không bypass core | core_client.go | group 6 (kiểm không có serial) |

---
**Rev** 1.0 | 2026-06-10 · DoD: [12_DEFINITION_OF_DONE §5](12_DEFINITION_OF_DONE.md)
