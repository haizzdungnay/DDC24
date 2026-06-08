# Service Design — `kinexus-agent` (SW)
## MQTT + REST API — code-ready

> **Document ID:** DDD-SWSVC-AGENT-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
> 📘 [README](../../01_specs/README.md) · **Trace:** `SW-MQ/API/MOD-*` · Python 3.11

> Service northbound: đẩy MQTT lên cloud + REST cho app. Đọc/ghi qua `kinexus_plc_shm`.
> ⚠ **ARCH-R010:** Modbus **không** thuộc agent nữa. DDC không là Modbus slave. Vai trò Modbus = **RTU master xuống thiết bị phụ**, nằm ở service riêng [`kinexus-fieldbus`](SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md).

---

## 1. Cấu trúc process
```
kinexus-agent (asyncio)
├── rest_api      (FastAPI, HTTPS 8443)   → D-4 openapi.yaml
├── mqtt_client   (paho, TLS 8883)
│   (Modbus đã tách sang kinexus-fieldbus — RTU master, không phải slave)
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

## 4. ~~Modbus slave~~ → chuyển sang `kinexus-fieldbus` (RTU master)
> DDC **không** phục vụ Modbus về phía BMS. Modbus RTU **master** poll thiết bị phụ → xem [SW_FIELDBUS_DESIGN](SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md) + [D-2](../interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md). Phần này gỡ khỏi agent.
- INT16 ×100 (KHÔNG float). Response ≤100ms.

## 5. Write arbitration
REST/MQTT ghi point → đi qua cùng cơ chế priority như BACnet (D-6 §7). Không ghi thẳng MCU.

## 6. Bảo mật
- TLS 1.3 mọi mặt; secret từ key store (D-11). Audit log mọi ghi (SW-SEC-006).
- Validate mọi input (range/type) trước khi tác động I/O.

## 7. Test
- TLS1.3 (`openssl s_client`) T-SW-070; rate-limit 429 T-SW-077; Modbus đọc/ghi T-SW-120..129; MQTT COV T-SW-060.

## 8. Trace REQ
`SW-MQ-001..007`, `SW-API-001..010`, `SW-MOD-001..010`, `FR-022/023/024/025`.

---
**Rev** 1.0 | 2026-05-30
