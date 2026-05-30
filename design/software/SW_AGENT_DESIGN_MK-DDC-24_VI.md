# Service Design — `kinexus-agent` (SW)
## MQTT + REST API + Modbus TCP/RTU — code-ready

> **Document ID:** DDD-SWSVC-AGENT-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
> 📘 [spec/README](../../spec/README.md) · **Trace:** `SW-MQ/API/MOD-*` · Python 3.11

> Một service gộp 3 mặt: đẩy MQTT lên cloud, REST cho app, Modbus cho SCADA. Tất cả đọc/ghi qua `kinexus_plc_shm`.

---

## 1. Cấu trúc process
```
kinexus-agent (asyncio)
├── rest_api      (FastAPI, HTTPS 8443)   → D-4 openapi.yaml
├── mqtt_client   (paho, TLS 8883)
├── modbus_slave  (pymodbus/libmodbus, TCP 502 + RTU)  → D-2 map
└── shm_bridge    (đọc/ghi plc_shm cho cả 3)
```

## 2. MQTT (SW-MQ-001..007)
```python
client = mqtt.Client(protocol=MQTTv5)
client.tls_set(...)                      # TLS 1.3 bắt buộc, KHÔNG fallback
client.will_set(f"kinexus/{id}/status", '{"online":false}', retain=True)  # LWT
# publish COV: khi point đổi quá ngưỡng
client.publish(f"kinexus/{id}/io/{point}", value, qos=1, retain=True)
# reconnect: backoff 1,2,4,...,300s
```
Topic: `kinexus/{device_id}/io/{point_name}` (MQ-003).

## 3. REST (SW-API-*) → theo [D-4 openapi.yaml]
- FastAPI, JWT auth (exp 1h), rate-limit 100/s→429, error `{error,code,request_id}`.
- Đọc point từ `plc_shm`; ghi point → `plc_shm` (validate range trước).
- `/system/status` lấy IOP metrics từ io-driver (đọc shm/metrics).

## 4. Modbus slave (SW-MOD-001..010) → theo [D-2 map]
```python
# pymodbus datastore map vào plc_shm
# Input Reg 0-7 = AI×100 ; Holding 0-3 = AO ; Coil 0-3 = DO ; Discrete 0-7 = DI
# FC01,02,03,04,05,06,15,16 ; exception 0x01/0x02/0x03/0x04
# TCP 502 (≥5 client) + RTU (nếu rs485_mode=modbus-rtu, unit_id 1-247)
```
- INT16 ×100 (KHÔNG float). Response ≤100ms.

## 5. Write arbitration
REST/MQTT/Modbus ghi point → đi qua cùng cơ chế priority như BACnet (D-6 §7). Không ghi thẳng MCU.

## 6. Bảo mật
- TLS 1.3 mọi mặt; secret từ key store (D-11). Audit log mọi ghi (SW-SEC-006).
- Validate mọi input (range/type) trước khi tác động I/O.

## 7. Test
- TLS1.3 (`openssl s_client`) T-SW-070; rate-limit 429 T-SW-077; Modbus đọc/ghi T-SW-120..129; MQTT COV T-SW-060.

## 8. Trace REQ
`SW-MQ-001..007`, `SW-API-001..010`, `SW-MOD-001..010`, `FR-022/023/024/025`.

---
**Rev** 1.0 | 2026-05-30
