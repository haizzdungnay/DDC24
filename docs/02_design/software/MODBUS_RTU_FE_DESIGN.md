# Modbus RTU — Frontend Design DDC-24 Rev A

**ID:** DDD-FE-MBRTU-001
**Phiên bản:** 0.2
**Trạng thái:** In Review
**Ngày:** 2026-08-05 (bản 0.1: 2026-08-04)
**Chủ quản đề xuất:** FE Lead
**Quyết định đã ký áp dụng:** Đ-01, Đ-04, Đ-05, Đ-06
**Đối chiếu source tại:** `feat/modbus-rtu-track-a` / `eade4e5`
**Trace ngược:** [UX-WEB-MBRTU-001](../../04_uiux/MODBUS_RTU_UI_UX_DESIGN.md),
[DDD-DM-MBRTU-001](MODBUS_RTU_DATA_MODEL.md)
**Trace API:** [ICD-API-MBRTU-001](../interfaces/MODBUS_RTU_API_SPEC.md)

> Tài liệu này mô tả **thiết kế FE mục tiêu**. Nó không mô tả FE hiện tại; sai khác
> được liệt kê ở §8. Không sửa source trong nhiệm vụ này.

## 1. Vị trí trong cây source

```text
apps/web-ui/src/features/modbus-rtu/
├── index.ts                       # public feature API — chỉ export route element
├── ModbusRtuLayout.tsx            # khung + tab + banner cấu hình
├── pages/
│   ├── OverviewPage.tsx
│   ├── DevicesPage.tsx
│   ├── PointsPage.tsx
│   ├── MappingPage.tsx
│   └── DiagnosticsPage.tsx
├── components/
│   ├── ConfigStateBanner.tsx      # active/candidate/apply state
│   ├── BusCard.tsx
│   ├── DeviceForm.tsx
│   ├── PointForm.tsx
│   ├── RegisterPreview.tsx        # dải register + overlap + quy đổi mẫu
│   ├── QualityBadge.tsx
│   ├── ConnectionStatusBadge.tsx
│   ├── TestConnectionDialog.tsx
│   ├── ReadTestDialog.tsx
│   ├── WriteTestDialog.tsx        # hai bước
│   ├── ImportPreviewDialog.tsx
│   └── ConfirmDeleteDialog.tsx
├── model/
│   ├── candidate.ts               # reducer candidate + diff
│   ├── validation.ts              # mirror validator server
│   ├── csv.ts                     # parse/serialize CSV
│   └── selectors.ts
└── hooks/
    ├── useModbusConfig.ts
    ├── useModbusRuntime.ts        # value/quality/timestamp từ point stream
    └── useModbusDiagnostics.ts
```

Ràng buộc kiến trúc theo ADR-025: các feature khác **chỉ** được import từ
`features/modbus-rtu/index.ts`; không import sâu vào `pages/` hay `model/`.

## 2. Mô hình state

FE có đúng **ba** nguồn state, không trộn lẫn:

| Nguồn | Nội dung | Lifetime | Ghi chú |
|---|---|---|---|
| Server config state | `active`, `candidate`, `revision`, `checksum`, `apply_state` | fetch theo request | authority tuyệt đối |
| Server runtime state | `value`, `quality`, `quality_reason`, `timestamp`, `connection_status`, counters | streaming/polling | không cache lâu; có `staleAt` |
| Client draft state | form đang gõ, bộ lọc, cột, phân trang | in-memory + `localStorage` cho preference | **không** chứa field nghiệp vụ |

```text
useModbusConfig()
  ├─ data.active     : ModbusConfig      (đang chạy)
  ├─ data.candidate  : ModbusConfig|null (đang soạn, server-side)
  ├─ data.diff       : ConfigDiff        (tính ở FE từ active vs candidate)
  ├─ state           : 'idle'|'loading'|'saving'|'applying'|'error'
  └─ actions         : saveCandidate(), apply(), rollback(), discard()
```

`saveCandidate()` gửi **toàn bộ** candidate kèm `base_revision` + `operation_id`.
FE không gửi patch từng field: patch làm mất khả năng validate chéo (overlap,
tag unique, capacity) trong một lần.

### 2.1 Quy tắc cấm

1. Không lưu `value`, `quality`, `unit`, `tag_name` hay bất kỳ metadata Point nào
   vào `localStorage` như authority. `localStorage` chỉ giữ `{columns, filters, pageSize}`.
2. Không suy diễn `quality`. `QualityBadge` nhận `quality` + `quality_reason`
   và **từ chối render** (hiện `—`) nếu thiếu `quality`.
3. Không tự retry mutation sau khi mất kết nối. Reconnect ⇒ fetch lại config,
   so `revision`; nếu đổi thì cảnh báo người dùng, không replay.
4. Không hiển thị `0` thay cho dữ liệu vắng. Dùng `—` hoặc `unknown`.

## 3. Vòng đời candidate

```text
                  ┌──────────────┐
   fetch config → │ CLEAN        │ (không có candidate)
                  └──────┬───────┘
        user sửa form    │ saveCandidate(base_revision=N)
                  ┌──────▼───────┐
                  │ DIRTY rev N+1│ ← banner "3 thay đổi chưa apply"
                  └──┬────────┬──┘
          discard()   │        │ apply(operation_id)
                  ┌───▼──┐  ┌──▼───────────┐
                  │ CLEAN│  │ APPLYING     │ ← nút khoá, spinner
                  └──────┘  └──┬────────┬──┘
                     ACK       │        │ REJECT/TIMEOUT
                  ┌────────────▼─┐  ┌───▼──────────────┐
                  │ CLEAN rev N+1│  │ APPLY_FAILED     │
                  └──────────────┘  │ active vẫn rev N │
                                    └──────────────────┘
```

Trong `APPLYING`, FE khoá toàn bộ mutation control của cả năm page (không chỉ page
hiện tại) để tránh hai apply chồng nhau. Timeout client là 30 s; hết timeout FE
**không** kết luận thất bại mà chuyển sang `UNKNOWN` và bắt buộc fetch lại
`apply_state` từ server.

## 4. Validation client

`model/validation.ts` phản chiếu validator server ở §4 của
[MODBUS_RTU_BE_DESIGN](MODBUS_RTU_BE_DESIGN.md). Nguyên tắc:

- Client validate để **phản hồi nhanh**, không để thay server.
- Mọi lỗi server trả về đều phải map được về field qua `path` (`devices[2].slave_id`).
- Lỗi không map được field hiện ở banner form, không bị nuốt.
- Client **không** tự sửa giá trị người dùng (không auto-clamp); chỉ báo lỗi.

Kiểm tra chỉ có ở client (không có tương đương server) là **không hợp lệ**: nếu một
luật đáng chặn thì server phải chặn.

### 4.1 `RegisterPreview`

Component thuần, không gọi API:

```ts
computeRegisterFootprint(point): { start, end, registers, bits }
detectOverlap(point, allPointsOfSameDeviceAndType): OverlapResult
previewConversion(rawSample, scale, offset, dataType): string
```

Được dùng trong `PointForm` và trong `ImportPreviewDialog` để chạy cùng một luật.

## 5. Runtime data

### 5.1 Nguồn

| Dữ liệu | Nguồn | Cadence |
|---|---|---|
| `value`/`quality`/`timestamp` của Point | WebSocket point stream đang có (`/ws/monitor`), lọc `kind === 'modbus_rtu'` | đẩy khi đổi |
| `connection_status` Device | `GET /modbus/devices` (runtime fields) | 5 s |
| Diagnostics counters | `GET /modbus/diagnostics` | 5 s |
| Overview KPI | `GET /modbus/overview` | 5 s |

Chu kỳ refresh mặc định **5 s**, cấu hình được trong UI (`2 s / 5 s / 15 s / tắt`),
và **dừng khi tab ẩn** (`document.visibilityState`). Đây là số PROPOSED — xem
`NFR-REQ-MBRTU-004` và `OD-MBRTU-007`.

### 5.2 Ghép runtime vào bảng cấu hình

`useModbusRuntime()` trả `Map<point_id, RuntimeSample>`. Ghép bằng `point_id`,
**không** ghép bằng tag, index hàng hay địa chỉ register.

Nếu một `point_id` có trong config mà không có trong runtime map:
`quality = 'CONFIG_ERROR'` khi Device ở `CONFIG_ERROR`, ngược lại hiện `—` với nhãn
`chưa có mẫu`. Không mặc định `BAD`.

### 5.3 Reconnect

Khi WebSocket reconnect: FE **xoá** runtime map, lấy snapshot mới, rồi mới nhận delta.
Không merge delta lên map cũ vì đã có khoảng trống không xác định.

## 6. Xác nhận và hành động nguy hiểm

| Hành động | Xác nhận | Nội dung bắt buộc trong hộp thoại |
|---|---|---|
| Xoá Device | 1 bước | tên Device, bus, slave ID, số Point sẽ bị ảnh hưởng |
| Xoá Point | 1 bước | tag, point ID, register |
| Apply cấu hình | 1 bước | số Device/Point thay đổi, `rev N → N+1`, cảnh báo iobus áp dụng cấu hình mới |
| Rollback | 1 bước | revision đích và hệ quả |
| Ghi thử register | **2 bước** | Device/bus/slave, register + reference, giá trị cũ → mới, đơn vị, "được ghi audit" |
| Import | 1 bước sau preview | số dòng thêm/sửa/lỗi |

Nút nguy hiểm **không** là nút mặc định của form; `Enter` không kích hoạt nó.

## 7. Xử lý lỗi

| Mã lỗi server | Hiển thị |
|---|---|
| `REVISION_CONFLICT` | "Cấu hình đã thay đổi bởi người khác (rev N)." + nút `Tải lại và so sánh` |
| `VALIDATION_FAILED` | lỗi inline theo `path` + tổng số lỗi ở banner form |
| `PORT_UNAVAILABLE` | "Cổng \<tên\> không khả dụng trên phần cứng này." — vô hiệu hoá lựa chọn bus đó. Tên cổng lấy từ manifest, **không** hardcode trong FE |
| `IOBUS_REJECTED` | "iobus từ chối cấu hình: <reason>." + giữ `Active rev N` |
| `APPLY_TIMEOUT` | "Chưa xác nhận được kết quả apply." + bắt buộc fetch lại state, không tự kết luận |
| `DEVICE_OFFLINE` | "Thiết bị không phản hồi." (dùng cho test/commission) |
| `WRITE_REJECTED` | lý do cụ thể: read-only / ngoài dải / quality không GOOD / revision cũ |
| `CAPACITY_EXCEEDED` | "Vượt giới hạn 64 Point." kèm số hiện tại |
| HTTP 401/403 | "Bạn không có quyền thực hiện thao tác này." — không ẩn lỗi thành thành công |

FE **không bao giờ** hiển thị toast thành công trước khi nhận response thành công.

## 8. Sai khác so với FE hiện tại

**Đối chiếu lại tại `eade4e5` (2026-08-05), sau Track A nhóm A5.**

### 8.1 Gap còn lại

| ID | Thiết kế | As-Built `ModbusRtuPage.tsx` tại `eade4e5` | Mức |
|---|---|---|---|
| F-FE-01 | 5 page trong layout có tab | 1 page duy nhất, form + 3 bảng | P1 |
| F-FE-02 | candidate/apply tách bạch | mỗi `create/update/delete` gọi API và apply ngay (restart iobus, D-09) | P0 |
| F-FE-06 | port là lựa chọn từ capability manifest | ◐ **không còn mặc định sai** (`rs485_port: ''`, D-14 ✅) nhưng vẫn là input **text tự do** | **P1** (hạ từ P0) |
| F-FE-07 | có `bit_index`, `min/max`, `poll` riêng | không có trong form/type | P1 |
| F-FE-08 | test connection / read / write | không có | P0 — **bắt buộc theo Đ-06** |
| F-FE-09 | import/export CSV/JSON | không có | P1 — **bắt buộc theo Đ-06** |
| F-FE-10 | loading/empty/error/offline theo vùng | một `status` string chung cho cả trang; riêng bảng diagnostics có empty state | P1 |
| F-FE-12 | reconnect lấy snapshot mới | `reload()` gọi một lần trong `useEffect([])`; không refresh định kỳ, không stream | P1 |
| F-FE-13 | `default_value`/`safe_value` theo `data_type` | form ép `Number(...)` kể cả với `bool` | P2 |
| **F-FE-14** | có ô nhập `offline_after_errors` | không có; trường không cấu hình được end-to-end | **P1 mới** — cặp `F-BE-19` |
| **F-FE-15** | Operator có cờ quyền riêng cho commissioning | chỉ có `canEdit = roleAtLeast(role,'admin')`; Operator bị đối xử như Viewer | **P2 mới** — chưa gây sai vì F-FE-08 chưa làm; khi làm phải thêm `canCommission` |

### 8.2 Đã đóng bằng Track A

| ID | Thiết kế | Bằng chứng As-Built | Defect |
|---|---|---|---|
| F-FE-03 | xác nhận trước khi xoá | state `pendingDelete` + modal `role="dialog" aria-modal="true"`, nêu tên đối tượng, số Point bị ảnh hưởng và cảnh báo "áp dụng vào iobus ngay lập tức" | D-08 (`dfef8ab`) |
| F-FE-04 | quality/trạng thái từ authority, không suy diễn | `deviceLinkLabel()` chỉ đọc `online`/`total_polls`/`consecutive_errors` và **không** gọi ra quality của Point; phân biệt "Chưa liên lạc lần nào" với "Mất liên lạc" | D-07 (`dfef8ab`) |
| F-FE-05 | thiếu dữ liệu ⇒ `—` | `runtimeQuality[row.point_id]?.toUpperCase() ?? NO_DATA` với `NO_DATA = '—'` | D-07 (`dfef8ab`) |
| F-FE-11 | Viewer đọc được | `roles.ts`: `'/eng/modbus-rtu': 'viewer'`; trang hiện banner "Chế độ chỉ xem" và disable mọi control mutation kèm `title` giải thích quyền | D-07/Đ-04 (`dfef8ab`) |

## 9. Test FE bắt buộc

Cột **Hiện trạng** đối chiếu với `ModbusRtuPage.test.tsx` tại `eade4e5` (6 test).

| ID | Loại | Nội dung | Hiện trạng |
|---|---|---|---|
| TF-MBRTU-01 | unit | `computeRegisterFootprint` cho 16/32-bit và `bit_index` | ❌ chưa có |
| TF-MBRTU-02 | unit | `detectOverlap` cho 5 trường hợp ở data model §5.5 | ❌ chưa có |
| TF-MBRTU-03 | unit | CSV parse/serialize round-trip, ô rỗng ⇒ `null` | ❌ chưa có — Đ-06 |
| TF-MBRTU-04 | unit | `QualityBadge` không render giá trị khi thiếu `quality` | ✅ "thiếu telemetry hiển thị — chứ không phải BAD" |
| TF-MBRTU-05 | component | candidate reducer: save → dirty → apply → clean; reject giữ active | ❌ chưa có — F-FE-02 |
| TF-MBRTU-06 | component | mọi control mutation bị disable khi role thấp và khi `APPLYING` | ◐ "viewer xem được nhưng mọi control thay đổi bị khoá" phủ phần role; nhánh `APPLYING` chưa có |
| TF-MBRTU-07 | component | xoá Device/Point yêu cầu xác nhận | ✅ "xoá thiết bị yêu cầu xác nhận" |
| TF-MBRTU-08 | component | ghi thử đúng hai bước và bị chặn khi quality ≠ GOOD | ❌ chưa có — F-FE-08 |
| TF-MBRTU-09 | component | lỗi server có `path` map đúng field | ❌ chưa có |
| TF-MBRTU-10 | component | telemetry vắng ⇒ `—`/`unknown`, không `0`, không `BAD` | ✅ hai test: "thiếu telemetry…" và "thiết bị chưa từng liên lạc không bị gọi là dữ liệu cũ" |
| TF-MBRTU-11 | e2e | luồng Admin: thêm Device → thêm Point → apply → thấy quality | ◐ "gửi cấu hình qua Device Manager…" phủ ở mức component, chưa có e2e |
| TF-MBRTU-12 | e2e | luồng Viewer: xem được, không mutate được | ◐ có ở mức component, chưa có e2e |
| **TF-MBRTU-13** | component | không đặt sẵn cổng serial không tồn tại trên phần cứng | ✅ **mới** — "không đặt sẵn cổng không tồn tại" (D-14) |

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo FE design: cấu trúc feature, state model, candidate lifecycle, runtime binding, lỗi và gap As-Built |
| 0.2 | 2026-08-05 | In Review | Đối chiếu lại với `eade4e5`. **Thay thế:** (a) §8 tách 8.1/8.2 — đóng F-FE-03/04/05/11 bằng Track A A5, hạ F-FE-06 xuống P1 (còn input tự do nhưng hết mặc định sai), thêm **F-FE-14** (thiếu ô `offline_after_errors`) và **F-FE-15** (chưa tách quyền Operator); (b) §9 gắn từng TF-MBRTU với 6 test thật trong `ModbusRtuPage.test.tsx`, thêm TF-MBRTU-13; (c) đổi "luồng Engineer" → "luồng Admin" theo Đ-04 |
