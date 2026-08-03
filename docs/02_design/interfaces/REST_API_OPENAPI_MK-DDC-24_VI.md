# REST API Design — MK-DDC-24
## D-4 (đi kèm `openapi.yaml`)

> **Document ID:** ICD-REST-MK-DDC-24-VI
> **Phiên bản:** 1.5 | 2026-08-03 (Point Model canonical, Modbus RTU CRUD/diagnostics, I/O bundle atomic, health) · 1.4 | 2026-07-28 (ADR-017 Network DNS/capability/management contract) · 📘 [README](../../01_specs/README.md)
> **Nguồn-chuẩn máy đọc:** [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1) · **Trace:** `SW-API-001..010`, `SRS §6.4`, `SW_ARCH §6`

> File `.md` này giải thích cách dùng; **`openapi.yaml` là hợp đồng chính thức** (import vào Swagger/Postman, generate client).

---

## 1. Nguyên tắc
- HTTPS **TLS 1.3**, cổng **8443**. Không phục vụ HTTP plaintext (trừ redirect 8080→8443).
- Auth: **Bearer JWT** (HS256, exp 1h). Secret từ key store (D-11), không hardcode.
- Mọi response JSON, `Content-Type: application/json`.
- Lỗi: `{"error","code","request_id","details?"}` (SW-API-010). Tag/name sai trả `400`; trùng namespace/revision/generation trả `409` với `details[]` gồm `path`, `reason`, `pointId`, `conflictPointId` và `tag|name`. Historian thiếu budget/free-space trả `507`; toàn bộ history tier unavailable trả `503`.
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

# 3. Ghi AO (cần auth + range check) — LUÔN vào mức Local manual, client KHÔNG chọn priority
#    (Contract Freeze 2026-06-11 — xem openapi.yaml PUT /points/{id} + 08 §1.2)
curl -k -X PUT https://<ip>:8443/api/v1/points/AO1 \
  -H 'Authorization: Bearer eyJ...' -H 'Content-Type: application/json' \
  -d '{"value":5.0}'
# → {"result":"accepted","applied_value":5.0,"active_source":"manual"}
# Nhả manual override:
#  -d '{"release":true}'
```

## 3. Bảng endpoint (tóm tắt — chi tiết ở yaml)
| Method | Path | Quyền | Mô tả |
|--------|------|-------|-------|
| POST | /auth/login | — | trả JWT |
| POST | /auth/logout | bearer | huỷ token |
| GET | /points | bearer | tất cả point |
| GET | /points/{id} | bearer | 1 point |
| PUT | /points/{id} | bearer operator+ | ghi giá trị point bằng canonical ID |
| PUT | /points/{id}/config | bearer admin | đổi technical tag/display metadata bằng canonical ID; không nhận tag trong path |
| GET/POST | /virtual-points | bearer viewer/admin | list/create VP; create validate global tag namespace |
| PUT/DELETE | /virtual-points/{id} | bearer admin | update/delete VP bằng canonical ID |
| GET/PUT | /system/config/io | bearer admin | UI/AO/DO metadata; validate tag cùng VP |
| GET/PUT | /system/config/io-bundle | bearer admin | validate/apply I/O + safe-state cùng revision/checksum; lỗi thì rollback cả hai |
| GET/PUT | /system/config/virtual-points | bearer admin | replace VP config; validate tag/name cùng physical points |
| GET/POST | /modbus/devices | bearer viewer/admin | list/create Modbus RTU Device; RS485, baud, parity, stop bit, slave ID, poll/timeout/retry |
| PUT/DELETE | /modbus/devices/{id} | bearer admin | update/delete Device; ID ổn định |
| GET/POST | /modbus/points | bearer viewer/admin | list/create Modbus RTU Point; tag unique xuyên namespace |
| PUT/DELETE | /modbus/points/{id} | bearer admin | update/delete Point; rename không đổi Point ID |
| GET | /modbus/diagnostics | bearer viewer+ | telemetry poll/timeout/retry/CRC thật từ iobus SHM |
| GET | /health | — | health web/core/iobus/io_shm/plc_shm/MCU connection |
| GET/PUT | /trends/config | bearer viewer/admin | viewer đọc trạng thái; admin atomic-update per-point DB logging policy, interval và start UTC |
| GET | /history | bearer viewer+ | unified UTC range query; backend merge RAM/hot 48h/archive, trả quality/source/tier/gap |
| GET | /system/status | bearer | CPU/RAM/IOP/ver |
| GET/PUT | /system/config | admin | cấu hình |
| GET | /network/transaction | bearer viewer+ | status active/configured/pending, capability và management hostname read-only |
| POST | /network/transaction/{action} | bearer admin | validate/stage/apply/confirm/rollback Ethernet IPv4 + optional DNS |
| POST | /ota/upload, /ota/apply | admin | OTA |
| GET | /ota/status | bearer | tiến độ OTA |
| GET | /logs/download | admin | log gzip |
| GET | /bacnet/objects | bearer | object BACnet |
| GET | /alarms, POST /alarms/{id}/ack | bearer | alarm |
Network status GET cho viewer+, còn mọi POST transaction chỉ dành cho Admin.
Candidate DNS chỉ hợp lệ khi status-preflight công bố capability `dns` và chính response
`validate`/`stage` vẫn công bố capability, echo đúng pending DNS/candidate; management hostname chỉ
đọc và không được gửi trong candidate.

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
- Đọc/ghi point đi qua `mkddc-core`/`mkddc_plc_shm` contract (không truy cập trực tiếp BACnet/MCU).

## 4a. Global point tag Phase A (ADR-019)

- `Point` luôn trả `id`, `tag`, `name`: `id` là canonical runtime identity ổn định; `tag` là alias kỹ thuật mutable; `name` là nhãn hiển thị/BACnet name tùy kind.
- Một namespace trong controller gồm UI/AO/DO/mọi VP kể cả disabled VP. Backend trim/collapse ASCII spaces, so sánh ASCII lowercase, giới hạn 1..64 byte theo `^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$` và reserve canonical/legacy point-ID syntax cho owner tương ứng.
- Backend aggregate validator là authority cho mọi API writer. Frontend validation chỉ early feedback. `PUT /points/{id}/config` và mọi point path chỉ nhận canonical ID, không resolve tag trong URL.
- Tag sai grammar/reserved sai owner trả `400`; duplicate trả `409 point_tag_conflict`. `details[]` phải giữ field path và cả canonical ID đang sửa/xung đột để UI focus đúng field.
- Legacy migration deterministic: existing valid tag; rồi unique valid display `name`/`label`; nếu blank/invalid/duplicate/reserved thì canonical ID. Mọi member của duplicate group cùng fallback canonical ID; không first-wins, không suffix; validate toàn candidate trước atomic write.
- Flat-file phase bảo vệ approved API writers bằng mutex chung nhưng chưa bảo vệ direct filesystem edits/cross-file crash atomicity. Generation root validation theo ADR-015 là release gate authority cuối.
- Phase A không đổi graph/core runtime. Programming tag alias thuộc Phase B: resolve tĩnh lúc validate/deploy thành canonical ID; không dynamic lookup trong scan loop.

## 4b. Global display-name namespace Phase A (ADR-019 v1.1)

- `Point.name` là display name/label canonical, required sau migration và unique độc lập với `Point.tag` trên UI/AO/DO/mọi created VP kể cả disabled.
- Backend trim/collapse whitespace, giới hạn 1..64 Unicode code point, cấm control character và so sánh Unicode lowercase. Frontend chỉ early feedback.
- `400 point_name_invalid`; `409 point_name_conflict`; legacy duplicate có nội dung trả `409 point_namespace_conflicted` cho mọi point mutation ngoài rename làm giảm conflict.
- Blank legacy name được gán canonical ID. Duplicate có nội dung không auto-suffix/first-wins và không fail runtime/read.
- Rename không đổi canonical ID, historian generation hoặc deployed graph binding. Delete VP giữ history theo ID+generation tới hết retention.

## 4c. Per-point database historian (ADR-018 v1.1)

- `GET /trends/config` cho viewer+ trả `revision`, `serverNowUtc`, capacity, policies và state `off|scheduled|recording` cùng health. `PUT` admin-only nhận atomic batch `{baseRevision, points[]}`.
- Mỗi patch có `pointId`, `generation`, `dbLoggingEnabled`, `dbInterval`, `startAtUtc`. `startAtUtc=null` nghĩa là backend dùng server time khi commit; explicit value phải RFC3339 UTC `Z` và không ở quá khứ tại commit.
- Interval wire canonical: `1s|3s|5s|15s|30s|1m|3m|5m|15m|30m|60m`; UI hiển thị `60m` là `1h`.
- Disable không xóa history. Policy sống qua restart. Restart/clock/queue/storage gap không được backfill giả.
- `GET /history` nhận 1..8 canonical IDs, `from/to` UTC half-open, `resolution`, `maxPoints<=5000`; backend merge RAM > hot SQLite > archive và dedupe theo `{pointId,generation,bucketUtc}`. Hot cache mặc định 48h; frontend không merge browser buffer.
- Query partial trả `200 complete=false` + gaps khi còn ít nhất một tier. Mọi tier unavailable trả `503 historian_unavailable`; fine resolution ngoài RAM tail trả `400 resolution_unavailable`; output budget trả `413`.
- UI/AO/DO/VP dùng cùng policy API. VP `logEnabled/logIntervalMs` là diagnostic-only, không phải database policy.

## 5. Bảo mật bắt buộc
- Validate `value` theo range/quality trước khi ghi (SW-API-005).
- Audit log mọi `PUT/POST` (user, point, giá trị, thời gian) (SW-SEC-006).
- JWT verify chữ ký + exp mỗi request; logout → token vào blocklist.

## 6. Trace REQ
`SW-API-001..010`, `API-001..009`, `FR-023`, `T-SW-070..079`.

---
**Rev** 1.4 | 2026-07-28 — khóa ADR-017 strict Network v1: GET status cho viewer+, POST transaction Admin-only, optional DNS auto/manual theo capability và management hostname read-only. Overall target/HIL gate vẫn RED. · **Rev** 1.3 | 2026-07-15 — ADR-018/019 amendments: unique display-name namespace, structured name conflicts/migration, atomic per-point historian policy with immediate/future UTC start, 11 intervals, 48-hour hot-cache/backend merge and explicit gap/error behavior. · **Rev** 1.2 | 2026-07-15 — ADR-019 Phase A: `Point.id + tag + name`, canonical-ID-only point paths, global UI/AO/DO/VP tag validation, structured 400/409 details, deterministic migration and generation authority caveat. · 1.1 | 2026-06-13 · 1.0 | 2026-05-30

Trạng thái: Web Network adapter/FE migration code-local DONE; target mDNS/dummy transaction pass, còn IP handoff thật, security review và release approval chưa hoàn tất.
