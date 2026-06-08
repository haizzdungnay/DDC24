# REST API Design — MK-DDC-24
## D-4 (đi kèm `openapi.yaml`)

> **Document ID:** ICD-REST-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30 · 📘 [README](../../01_specs/README.md)
> **Nguồn-chuẩn máy đọc:** [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1) · **Trace:** `SW-API-001..010`, `SRS §6.4`, `SW_ARCH §6`

> File `.md` này giải thích cách dùng; **`openapi.yaml` là hợp đồng chính thức** (import vào Swagger/Postman, generate client).

---

## 1. Nguyên tắc
- HTTPS **TLS 1.3**, cổng **8443**. Không phục vụ HTTP plaintext (trừ redirect 8080→8443).
- Auth: **Bearer JWT** (HS256, exp 1h). Secret từ key store (D-11), không hardcode.
- Mọi response JSON, `Content-Type: application/json`.
- Lỗi: `{"error","code","request_id"}` (SW-API-010).
- Rate limit **100 req/s/IP** → vượt trả **429** (SW-API-008/009).
- Phân quyền: `admin` (full), `operator` (xem + force I/O), `viewer` (chỉ xem).

## 2. Luồng auth (ví dụ thực tế)
```bash
# 1. Login lấy token
curl -k -X POST https://<ip>:8443/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"***"}'
# → {"token":"eyJ...","role":"admin","expires_in":3600}

# 2. Dùng token đọc point
curl -k https://<ip>:8443/api/v1/points/UI1 \
  -H 'Authorization: Bearer eyJ...'
# → {"id":"UI1","type":"AI","value":23.5,"unit":"°C","quality":"good",...}

# 3. Ghi AO (cần auth + range check)
curl -k -X PUT https://<ip>:8443/api/v1/points/AO1 \
  -H 'Authorization: Bearer eyJ...' -H 'Content-Type: application/json' \
  -d '{"value":5.0,"priority":8}'
```

## 3. Bảng endpoint (tóm tắt — chi tiết ở yaml)
| Method | Path | Quyền | Mô tả |
|--------|------|-------|-------|
| POST | /auth/login | — | trả JWT |
| POST | /auth/logout | bearer | huỷ token |
| GET | /points | bearer | tất cả point |
| GET | /points/{id} | bearer | 1 point |
| PUT | /points/{id} | bearer | ghi point |
| GET | /system/status | bearer | CPU/RAM/IOP/ver |
| GET/PUT | /system/config | admin | cấu hình |
| POST | /ota/upload, /ota/apply | admin | OTA |
| GET | /ota/status | bearer | tiến độ OTA |
| GET | /logs/download | admin | log gzip |
| GET | /bacnet/objects | bearer | object BACnet |
| GET | /alarms, POST /alarms/{id}/ack | bearer | alarm |

## 4. Triển khai (gợi ý FastAPI)
```python
from fastapi import FastAPI, Depends, HTTPException
app = FastAPI(title="MK-DDC-24 REST API", version="1.0.0")

@app.get("/api/v1/points/{point_id}")
async def get_point(point_id: str, user=Depends(auth_bearer)):
    p = plc_shm.read_point(point_id)        # đọc shared memory
    if p is None:
        raise HTTPException(404, detail={"error":"not found","code":404})
    return p.to_json()
```
- FastAPI tự sinh `/docs` (Swagger) từ code; **giữ đồng bộ với `openapi.yaml`** (CI so khớp).
- Đọc/ghi point đi qua `kinexus_plc_shm` (không truy cập trực tiếp BACnet/MCU).

## 5. Bảo mật bắt buộc
- Validate `value` theo range/quality trước khi ghi (SW-API-005).
- Audit log mọi `PUT/POST` (user, point, giá trị, thời gian) (SW-SEC-006).
- JWT verify chữ ký + exp mỗi request; logout → token vào blocklist.

## 6. Trace REQ
`SW-API-001..010`, `API-001..009`, `FR-023`, `T-SW-070..079`.

---
**Rev** 1.0 | 2026-05-30
