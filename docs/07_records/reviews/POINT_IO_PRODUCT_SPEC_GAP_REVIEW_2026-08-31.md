# Review GAP — Hệ Point & I/O MK-DDC-24 so với đề bài "POINT & I/O PRODUCT SPEC"

| Thuộc tính | Giá trị |
|---|---|
| ID | `REV-PIO-3SRC-001` |
| Phiên bản | 2.3 |
| Ngày | 2026-08-31 |
| Trạng thái | **APPROVED b2.0 WITH 3 ACCEPTANCE CRITERIA** (chủ sở hữu, 2026-08-31) — kiến trúc `LOCAL/VP/MB_RTU → Canonical Point Catalog → Binding → Program Variable` được chấp thuận, không redesign nền; thứ tự ưu tiên b2.0 được chấp thuận. `AC-PIO-ID-01/02/03` đã ghi vào `ISS-PIO-31` (§8.1.1) và V&V vào `ISS-PIO-36` (§8.2) ⇒ **đã tạo 36 issue trên repo** (#375–#410, nhãn `point-io`) — bảng truy vết + phân công ở §8.10. **Cấm code `ISS-PIO-01/02` trước khi `ISS-PIO-31` đóng** kèm test chứng minh rename / add / disable point / disable device / reboot đều không làm binding đổi nghĩa. Ba quyết định Owner đã chốt ở §9 |
| Baseline | `main` @ `dc1f740` (ADR-054, PR #372) |
| Người thực hiện | Claude Code (review source), theo đề bài "POINT & I/O PRODUCT SPEC" (34 mục + 16 UC) do chủ sở hữu cấp 2026-08-31 |
| Phán quyết | Chủ sở hữu, 2026-08-31 — xem §8.1.1 (ba AC P0), §8.1.2 (thứ tự P0 đã khoá), §9 (ba quyết định) và §12 (nhật ký b1.0 → b2.0 → b2.1) |
| Phạm vi code đã đọc | `apps/web-ui/src/features/points/`, `.../modbus-rtu/`, `.../programming/design/mapping/`, `apps/web-api/internal/{app,points,modbusrtu,programming}/`, `apps/core/application/st/`, `apps/iobus/adapters/modbus_rtu/`, `apps/iobus/bootstrap/`, `contracts/{shm,iop}/` |
| Authority đối chiếu | `ADR-010` (base SKU 16 UI + 4 AO + 4 DO), `DS_MK-DDC-24_VI` §103/§174, `MODBUS_RTU_DATA_MODEL`, `PROGRAMMING_DATA_MODEL` §3.5, `OD-PROG-007` (ba category LOCAL/VP/MB_RTU), `contracts/iop/iop_protocol.h` (BOARD_CAP_MAP) |
| Tài liệu liên quan | [`ST_EDITOR_IEC61131_GAP_REVIEW_2026-08-31`](ST_EDITOR_IEC61131_GAP_REVIEW_2026-08-31.md), [`MODBUS_RTU_POINT_AS_BUILT_REPORT`](MODBUS_RTU_POINT_AS_BUILT_REPORT.md), [`UI_UNIVERSAL_INPUT_FE_GAP_REPORT_2026-08-14`](UI_UNIVERSAL_INPUT_FE_GAP_REPORT_2026-08-14.md) |

---

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. Tài liệu này dùng để làm gì? | Chấm hệ Point & I/O đang có trong `main` theo đề bài 3 nguồn Point (Physical / Virtual / Modbus → Canonical Point Catalog → Binding → Program Variable), ghi finding kèm dẫn chứng `tệp:dòng`, và đề xuất bảng issue để chủ sở hữu duyệt. |
| 2. Kết luận một câu là gì? | **Kiến trúc 3 nguồn ĐÃ TỒN TẠI đúng như đề bài — nhưng đường từ Catalog sang Program bị đứt ở cả ba nguồn**: Modbus bị FE chặn cứng, Virtual Point tạo từ UI không bao giờ map được, và Catalog cắt im lặng ở 500 mục trong khi tự khai là "đã đủ". |
| 3. Mô hình Canonical Point có thật không? | **Có.** `PointCatalogEntry` với ba category `LOCAL`/`VP`/`MB_RTU` là thật, có một authority duy nhất (`programmingPointCatalogAdapter` bọc `App.ReadPoints`), không có model song song. Đây là điểm mạnh nhất của bản dựng hiện tại. |
| 4. Bốn khái niệm (Channel / Point / Variable / Binding) có bị gộp không? | **Không.** Tách đúng: kênh vật lý ở `io_config.conf`, Point ở Catalog, Variable ở `ProgrammingVariable`, Binding ở `ProgrammingBinding` (`bindingId` riêng). Đề bài §2 ĐẠT. |
| 5. IA có đúng đề bài §4 không? | **Gần đúng.** `/eng/inputs`, `/eng/outputs`, `/eng/virtual-points`, `/eng/modbus-rtu/{ports,devices,points,…}`, `/eng/programming/*` (tab Ánh xạ). Khác biệt duy nhất: không có trang DI riêng — **đúng theo `ADR-010`**, không phải lỗi. |
| 6. "UI/UO/DI/DO" của đề bài có khớp sản phẩm không? | **Một phần.** `UO` là cách gọi khác của `AO` (không phải khác biệt kỹ thuật). `DI` thì base SKU Rev A **cố ý bằng 0** (`ADR-010`, `DS` §103) — đề bài giả định 4 nhóm, sản phẩm ký 3 nhóm. Cần chủ sở hữu chốt lại phạm vi ở §9. |
| 7. Bao nhiêu finding? | **29 finding**: **7 Cao**, 19 Trung bình, 3 Thấp. `F-PIO-029` (slot `ext` không ổn định) được bổ sung ở b2.0 sau khi chủ sở hữu chất vấn tính ổn định của `extIndex` — chất vấn đó **đúng**, và nặng hơn mức nghi ngờ ban đầu. Vẫn không finding nào cho **ghi sai I/O vật lý** ở trạng thái hiện tại; nhưng `F-PIO-029` **sẽ tạo ra đúng lớp lỗi đó** nếu `ISS-PIO-01` được làm một mình. |
| 8. Cái gì hỏng nặng nhất với người dùng? | Một kỹ sư tạo Virtual Point `SAT_Setpoint` trên giao diện rồi mở tab Ánh xạ sẽ thấy nó bị đánh dấu **"Core chưa hỗ trợ"** và không map được — vì FE không có bất kỳ ô nào để đặt `boundPointId`, mà thiếu trường đó thì `pointId` ra `VP12` và bị allowlist `AV/BV/MSV` loại (F-PIO-003). |
| 9. Chủ sở hữu đã phán quyết gì? | **b2.1: APPROVED, được phép tạo issue trên repo.** Chấp thuận kiến trúc, thứ tự ưu tiên và ba quyết định (DI = **A**; `AO` giữ trong hợp đồng, `UO` chỉ là nhãn; `Program Disable` = release ownership **khác** `Controller Fault` = hard Safe-State). Kèm **ba acceptance criteria P0 bắt buộc** — `AC-PIO-ID-01/02/03` — ghi vào `ISS-PIO-31`, không mở issue mới. Ràng buộc thi hành: **không code `ISS-PIO-01/02` (#377/#378) trước khi `ISS-PIO-31` (#375) đóng và có test chứng minh binding không đổi nghĩa qua rename/add/disable/reboot.** 36 issue đã tạo — xem §8.10. |
| 10. Đã đo gì thật trong phiên này? | `npx vitest --run --environment jsdom src/features/points src/features/modbus-rtu src/shared/api` → **33 tệp / 304 test PASS** (6,14 s). `.../programming/design/mapping` → **4 tệp / 28 test PASS** (3,45 s). `go test ./internal/app/... ./internal/modbusrtu/... ./internal/points/... -count=1` → **3/3 gói ok** (`internal/app` 32,9 s). **Không dựng lại C++**, nên không dẫn số `ctest` nào. |

---

## 1. Phạm vi, phương pháp, giới hạn

### 1.1 Đã đọc gì

| Tầng | Đường dẫn | Ghi chú |
|---|---|---|
| Hợp đồng phần cứng | `contracts/iop/iop_protocol.h`, `contracts/shm/mkddc_shm.h` | BOARD_CAP_MAP, `kx_point_t`, `kx_ext_point_t` v5 |
| Firmware SOM — I/O | `apps/iobus/bootstrap/main.cpp`, `apps/iobus/domain/io/io_types.hpp` | handshake, cap map, `di_state[]` |
| Firmware SOM — Modbus | `apps/iobus/adapters/modbus_rtu/` (18 tệp) | `register_codec`, `device_profile`, `modbus_master`, `bus_worker` |
| Core — an toàn & binding | `apps/core/domain/safety/`, `apps/core/adapters/config/safe_state_config.*`, `apps/core/application/st/st_io_map.cpp` | trigger matrix, relinquish default, resolve io_map |
| Backend Go — Point | `apps/web-api/internal/app/{core_client,points,virtualpoint,pointconfig,pointcatalog_facade,programming_pointcatalog}.go`, `internal/points/catalog.go` | authority Point |
| Backend Go — Modbus | `apps/web-api/internal/modbusrtu/` (14 tệp) | domain, validate, persistence, BuildProfile |
| Backend Go — Programming | `apps/web-api/internal/programming/application/{pointcatalog,checks,checks_invariants,changes}.go` | catalog page, io_map, ST-OWN-001, impact |
| FE — cấu hình nguồn | `apps/web-ui/src/features/points/` (InputsPage 77 k, OutputsPage 57 k, VirtualIoPage 61 k, MonitorPage 109 k) | |
| FE — Modbus | `apps/web-ui/src/features/modbus-rtu/` (6 trang + 8 component) | |
| FE — Ánh xạ | `apps/web-ui/src/features/programming/design/mapping/` (1.920 dòng) | `mappingViewModel.ts` là nơi quyết định map được hay không |
| FE — chuẩn hoá | `apps/web-ui/src/shared/{types.ts,utils.ts,api/pointNormalizer.ts,api/client.ts}` | |

### 1.2 Phương pháp

Truy nguyên **từng đường dữ liệu end-to-end**, không suy từ tài liệu:

```text
MCU/IOP  →  iobus  →  SHM (io_shm/plc_shm)  →  web-api ReadPoints  →  PointDTO
                                                       ↓
                                          programmingPointCatalogAdapter
                                                       ↓
                                             PointCatalogEntry (REST)
                                                       ↓
                                       mappingViewModel.compatibilityFor()
                                                       ↓
                                   ProgrammingBinding  →  checks.go io_map
                                                       ↓
                                       st_io_map.cpp resolve  →  StPointKind
```

Mỗi finding dưới đây có dẫn chứng `tệp:dòng`. Chỗ nào là suy luận thì ghi rõ là suy luận.

### 1.3 Giới hạn

- **Không dựng lại C++** trong phiên này ⇒ mọi kết luận về `iobus`/`core` là kết luận **đọc mã**.
- **Không chạy trên bo Foxlinx** ⇒ các finding UI là finding cấu trúc mã, không phải quan sát màn hình thật.
- **Không xét BACnet** (đề bài không yêu cầu), chỉ nhắc khi nó chia sẻ cùng bảng Point.
- Không đánh giá chất lượng thẩm mỹ giao diện.

---

## 2. Kết luận điều hành

### 2.1 Chấm theo 3 nguồn Point của đề bài §1

| Nguồn | Trạng thái | Một câu |
|---|---|---|
| **PHYSICAL POINT** (UI/AO/DO) | 🟡 **Đạt phần lớn** | Cấu hình tín hiệu, scale, đơn vị, lọc, hiệu chuẩn offset, safe-state, trọng tài 16 mức ưu tiên đều thật và chạy. Thiếu: capability theo SKU/kênh, deadband, chính sách phát hiện lỗi, ramp/min-ON-OFF. |
| **VIRTUAL POINT** | 🔴 **Đứt đường sang Program** | Có CRUD đầy đủ, có quyền ghi, có ownership `WEB`/`PROGRAM` ở backend. Nhưng **VP tạo từ giao diện không bao giờ map được vào biến chương trình** (F-PIO-003). Thiếu Multistate, retain, giới hạn min/max thật. |
| **MODBUS POINT** | 🟡 **Nguồn mạnh nhất, nhưng bị cô lập** | Ba tầng Port → Device → Point đầy đủ đúng đề bài §17-§22; byte/word order 4 tổ hợp, scale/offset, min/max, bit_index, FC01/02/03/04 đọc + FC05/06/16 ghi. Nhưng **không map được vào Program** (F-PIO-002 + F-PIO-019), **slot `ext` không ổn định** (F-PIO-029), không cảnh báo được, không sửa được metadata qua API Point chung. |
| **CANONICAL POINT CATALOG** | 🟡 **Có thật, thiếu trường và cắt im lặng** | Ba category đúng `OD-PROG-007`, một authority duy nhất, quality 6 mức không đoán về GOOD ở tầng Go. Nhưng thiếu 4 trường bắt buộc của đề bài §5 và **cắt cứng ở 500 mục mà vẫn khai là đã đủ** (F-PIO-004). |

### 2.2 Chấm theo 4 khái niệm của đề bài §2

| Khái niệm | Đại diện trong code | Kết luận |
|---|---|---|
| Physical Channel | `io_config.conf` → `ConfigIO.UI/AO/DO`, `kx_io_shm.ui_*` | ✅ Tách đúng |
| Point | `PointDTO` → `PointCatalogEntry` | ✅ Tách đúng |
| Program Variable | `ProgrammingVariable` (`variableId`, `class`, `type`) | ✅ Tách đúng |
| Binding | `ProgrammingBinding` (`bindingId` riêng, `qualityPolicy`) | ✅ Tách đúng |

**Đề bài §2 ĐẠT.** Đây là nền móng đúng và không cần làm lại. Mọi issue dưới đây là bù trường và nối đường, không phải đập kiến trúc.

### 2.3 Chấm 16 UC nền của đề bài §32

| UC | Nội dung | Kết quả | Finding |
|---|---|---|---|
| PIO-01 | Detect đúng hardware/SKU | ❌ **FAIL** | F-PIO-008 |
| PIO-02 | Configure UI voltage/current | ✅ PASS | — |
| PIO-03 | Configure sensor scaling/unit | 🟡 PARTIAL | F-PIO-010 |
| PIO-04 | Configure AO 0-10V / 4-20mA | ✅ PASS | — |
| PIO-05 | Configure DI logic/debounce | ⚪ **N/A Rev A** | §9 (ADR-010) |
| PIO-06 | Configure DO safe-state | 🟡 PARTIAL | F-PIO-012 |
| PIO-07 | Commission/test I/O vật lý an toàn | 🟡 PARTIAL | F-PIO-011 (không có TTL cho lệnh test) |
| VP-01 | Create Analog Virtual Point | 🟡 PARTIAL | F-PIO-003 (tạo được, không dùng được) |
| VP-02 | Create Boolean/Multistate Point | 🟡 PARTIAL | F-PIO-014 |
| VP-03 | Configure limits/access/retain | ❌ **FAIL** | F-PIO-015, F-PIO-016 |
| VP-04 | Detect conflicting writer/ownership | 🟡 PARTIAL | F-PIO-017 (BE có `ST-OWN-001`, FE không thấy) |
| MB-01 | Configure Modbus port/network | ✅ PASS | — |
| MB-02 | Add Modbus device | ✅ PASS | — |
| MB-03 | Add/read Modbus point | 🟡 PARTIAL | F-PIO-020, F-PIO-021 |
| MB-04 | Writable Modbus point + read-back | 🟡 PARTIAL | F-PIO-022 |
| MAP-01 | Map Physical/Virtual/Modbus → biến ST/FBD | ❌ **FAIL** | F-PIO-002, F-PIO-003, F-PIO-019, F-PIO-029 — **chỉ LOCAL map được**, và nối đường mà không xử `F-PIO-029` trước sẽ tạo ra lỗi nặng hơn hiện trạng |

**5 PASS / 8 PARTIAL / 3 FAIL / 1 N/A.**

`MAP-01` FAIL là kết luận nặng nhất của review này: đề bài đặt Canonical Point Catalog để cả ba nguồn cùng đi vào Program, nhưng **thực tế chỉ nguồn LOCAL đi được**.

---

## 3. Nhóm A — Mô hình Point chuẩn (đề bài §5)

### F-PIO-001 · Cao · FE hạ mọi quality lạ hoặc thiếu về `good`

**Nơi:** [`apps/web-ui/src/shared/utils.ts:60-64`](../../../apps/web-ui/src/shared/utils.ts#L60-L64), [`apps/web-ui/src/shared/api/pointNormalizer.ts:127-135`](../../../apps/web-ui/src/shared/api/pointNormalizer.ts#L127-L135)

```ts
export function normalizeQuality(value: unknown): PointQuality {
  const raw = String(value ?? 'good').toLowerCase()
  if (raw === 'uncertain' || raw === 'bad' || raw === 'stale' || raw === 'offline') return raw
  return 'good'          // ← 'unknown', 'config_error', khoá vắng đều rơi vào đây
}
```

**Kịch bản hỏng cụ thể (đã truy đủ đường):** một Virtual Point có `source = PROGRAM` và
`boundPointId = "AV-3"`, nhưng Core chưa publish slot đó. Backend làm **đúng**:

```go
// apps/web-api/internal/app/points.go:152-156
} else {
    dto.Value = nil
    dto.Quality = "unknown"
}
```

FE nhận `{"value": null, "quality": "unknown"}` → `pointQuality()` không khớp `offline`,
`fault` không `true`, `online` không `false` → rơi xuống `normalizeQuality("unknown")` →
**`good`**. Trang Giám sát vẽ huy hiệu **GOOD** cho một điểm không ai đọc được.

Đường thứ hai: `mapExtQuality()` ([`core_client.go:947-949`](../../../apps/web-api/internal/app/core_client.go#L947-L949))
trả `"UNKNOWN"` khi producer mới hơn consumer — với comment ghi rõ *"không đoán bừa về GOOD"*.
Nguyên tắc đó đúng ở tầng Go rồi bị FE phá ở tầng cuối.

**Vì sao nặng:** đây đúng lớp lỗi mà `D-07`, `PA3-F04` và `RSK-PROG-010` của chính dự án cấm.
Giá trị hiện `—` nhưng nhãn chất lượng nói GOOD — người trực ca không có tín hiệu nào để nghi ngờ.

---

### F-PIO-002 · Cao · Catalog không cấp `extIndex` ⇒ không thể tạo binding Modbus

**Nơi:** [`apps/web-api/internal/programming/application/pointcatalog.go:12-23`](../../../apps/web-api/internal/programming/application/pointcatalog.go#L12-L23), [`apps/web-ui/src/features/programming/model/types.ts:383-387`](../../../apps/web-ui/src/features/programming/model/types.ts#L383-L387)

Ba tầng dưới **đã sẵn sàng nhận** binding Modbus:

| Tầng | Bằng chứng | Trạng thái |
|---|---|---|
| Core C++ | `st_io_map.cpp:107-113` — `category == "MB_RTU"` → `StPointKind::EXT`, kiểm `ext_index ∈ [1, KX_N_EXT]` | ✅ hỗ trợ |
| Backend Go | `checks.go:759-761`, `checks_invariants.go:232-233` — đọc `payload.Point.ExtIndex`, khoá trùng theo `(deviceId, extIndex)` | ✅ hỗ trợ |
| Catalog | `PointCatalogEntry` **không có trường `ExtIndex`** | ❌ đứt |
| FE | `ProgrammingPointIdentity` = `{category, pointId, deviceId}` — **không có `extIndex`** | ❌ đứt |

Nghĩa là kể cả khi gỡ chặn ở F-PIO-019, FE vẫn không có dữ kiện để dựng một binding hợp lệ.
`ext_idx` hiện chỉ được sinh **ngầm theo thứ tự lặp** trong `modbus_master.cpp:270-310`;
không nguồn nào công bố nó ra ngoài. **Và nó không ổn định** — xem `F-PIO-029` ngay dưới,
finding này quyết định `ISS-PIO-01` phải làm thế nào.

---

### F-PIO-029 · Cao · Slot `ext` của điểm Modbus **không ổn định**; ba thao tác cấu hình bình thường làm nó dịch

> Bổ sung ở b2.0 sau chất vấn của chủ sở hữu về `ISS-PIO-31`. Chất vấn đó đúng, và mức độ
> nặng hơn nghi ngờ ban đầu: đây không phải rủi ro lý thuyết mà là hành vi hiện tại của mã.

**Nơi:** [`persistence.go:260-262`](../../../apps/web-api/internal/modbusrtu/persistence.go#L260-L262), [`persistence.go:289-291`](../../../apps/web-api/internal/modbusrtu/persistence.go#L289-L291), [`persistence.go:327`](../../../apps/web-api/internal/modbusrtu/persistence.go#L327), [`bus_worker.cpp:68-83`](../../../apps/iobus/adapters/modbus_rtu/bus_worker.cpp#L68-L83), [`modbus_master.cpp:25,38`](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L25)

Slot `ext` được cấp phát **tuần tự, không có bảng bền**:

```cpp
/* modbus_master.cpp:25 */   ext_cursor_ = 0;
/* modbus_master.cpp:38 */   worker->bind(bus, bus_slaves, global_indices, &ext_cursor_, cache);
/* bus_worker.cpp:83 */      binding.ext_base = *ext_cursor;   /* rồi ++ theo từng điểm */
```

Thứ tự lặp đó do Go quyết định, và **ba thao tác cấu hình hoàn toàn bình thường đều làm nó dịch**:

| # | Thao tác của kỹ sư | Cơ chế | Phạm vi dịch |
|---|---|---|---|
| 1 | Đổi tên một điểm Modbus | `BuildProfile` sắp điểm theo **tên**: `sort.SliceStable(rows, … rows[i]["name"] < rows[j]["name"])` (`persistence.go:327`) | mọi điểm sau nó **trong cùng thiết bị** |
| 2 | Thêm hoặc **tắt** một điểm | `if !point.Enabled … continue` (`persistence.go:289`) — điểm tắt biến mất khỏi profile | mọi điểm sau nó trong cùng thiết bị |
| 3 | **Tắt một thiết bị** | `if !device.Enabled … continue` (`persistence.go:260`) — thiết bị biến mất khỏi `cfg.Slaves` | **mọi điểm của mọi thiết bị đứng sau** |

**Kịch bản hỏng cụ thể.** Tủ có `VFD-01` (12 điểm, `ext` 0-11) và `PUMP-02` (8 điểm, `ext` 12-19).
Binding `AHU_Main.pump_cmd → MB_RTU:PUMP-02#14` đã Commission và đang chạy.
Kỹ sư **tắt `VFD-01`** để bảo trì biến tần — một thao tác vận hành thường ngày, không ai coi là
đụng vào chương trình. `PUMP-02` dịch lên `ext` 0-7. Slot 14 giờ **không còn là thanh ghi cũ**.

Điều làm việc này nguy hiểm chứ không chỉ sai: `st_io_map.cpp:107-113` chỉ kiểm
`ext_index ∈ [1, KX_N_EXT]` — 14 vẫn hợp lệ. Không có checksum, không có tên, không có
đối chiếu thiết bị. Chương trình **tiếp tục chạy**, ghi lệnh bơm vào một thanh ghi khác,
và không tầng nào phát ra một dòng cảnh báo.

**Vì sao đây là finding chặn `ISS-PIO-01`:** nếu chỉ "expose `extIndex`" rồi cho FE lưu số đó vào
Binding, review này sẽ tự tay tạo ra lớp lỗi ghi sai I/O vật lý mà nó vừa xác nhận là **không**
tồn tại ở §0 câu 7. Binding **phải** neo vào định danh bền (`deviceId` + `pointId`/`tagName` do
người dùng đặt), còn `extIndex` chỉ là chi tiết vận chuyển được resolve lại mỗi lần nạp cấu hình,
kèm cổng phát hiện lệch.

**Bổ sung b2.1 — seam quy ước base index, chưa từng chạy thật.** Chủ sở hữu nêu thêm một rủi ro
đi kèm và nó có thật:

| Tầng | Quy ước | Bằng chứng |
|---|---|---|
| Allocator `iobus` | **0-based** | `ext_cursor_ = 0` (`modbus_master.cpp:25`); truy cập `snapshot.ext[ext_idx]` |
| Artifact / io_map | **1-based** | `st_io_map.cpp:112` kiểm `>= 1`; `st_process_image.cpp:24-30` ghi rõ *"Artifact dùng index 1-based; PointTable dùng 0-based"* rồi `point_index - 1` |
| Producer bắc cầu | **KHÔNG TỒN TẠI** | không nguồn nào phát `extIndex` ra ngoài |

Core **tự nó nhất quán**. Điều chưa tồn tại là bên phát. Vì chưa ai tạo được một binding Modbus
nên đường này **chưa từng chạy với dữ liệu thật một lần nào** — không có bằng chứng vận hành,
chỉ có hai quy ước ngồi cạnh nhau. `ISS-PIO-01` phát thẳng `ext_idx` thô sẽ **lệch đúng một
thanh ghi**, hợp lệ với mọi phép kiểm hiện có. Khoá bằng `AC-PIO-ID-03` và kịch bản V&V `5g`.

---

### F-PIO-003 · Cao · Virtual Point tạo từ giao diện không bao giờ map được

**Nơi:** [`apps/web-ui/src/shared/types.ts:1433-1458`](../../../apps/web-ui/src/shared/types.ts#L1433-L1458), [`apps/web-api/internal/app/programming_pointcatalog.go:pointCatalogPointID`](../../../apps/web-api/internal/app/programming_pointcatalog.go), [`mappingViewModel.ts:144-148`](../../../apps/web-ui/src/features/programming/design/mapping/mappingViewModel.ts#L144-L148)

Chuỗi nhân quả:

```text
FE tạo VP  →  không có ô "boundPointId" (trường không tồn tại trong type FE)
           →  BE lưu boundPointId = ""            (virtualpoint.go, không tự gán)
           →  pointCatalogPointID() trả "VP12"    (vì boundPointId rỗng)
           →  supportEligibility(): prefix "VP" ∉ ['AV','BV','MSV']
           →  UNSUPPORTED_IDENTITY  →  hiện "Core chưa hỗ trợ", không map được
```

Kiểm chứng: `grep -rn "boundPointId" apps/web-ui/src` → **0 kết quả**.
`normalizeVirtualPoint()` ([`virtualpoint.go:617-644`](../../../apps/web-api/internal/app/virtualpoint.go#L617-L644))
không tự cấp phát slot AV/BV nào.

**Hệ quả sản phẩm:** UC `VP-01` và `MAP-01` của đề bài không thực hiện được bằng giao diện.
Con đường duy nhất hiện nay là gọi thẳng `PUT /api/v1/virtual-points/{id}` với `boundPointId`
thủ công — tức là một tính năng chỉ dùng được bằng `curl`.

---

### F-PIO-004 · Cao · Catalog cắt cứng ở 500 mục nhưng vẫn khai là "đã đủ"

**Nơi:** [`apps/web-api/internal/programming/application/pointcatalog.go:41-55`](../../../apps/web-api/internal/programming/application/pointcatalog.go#L41-L55), [`MappingTab.tsx:64`](../../../apps/web-ui/src/features/programming/design/mapping/MappingTab.tsx#L64)

```go
if limit <= 0 || limit > 500 { limit = 500 }
...
if len(entries) > limit { entries = entries[:limit] }   // cắt
return PointCatalogPage{Items: entries}, nil            // NextCursor vẫn nil
```

FE suy "đầy đủ" **chỉ từ `nextCursor`**:

```ts
complete: catalog.data?.nextCursor ? false : true,
```

Trần thật của hệ: 24 LOCAL (16 UI + 4 AO + 4 DO — AV/BV/MSV thô bị ẩn ở
`overlayVirtualPoints`) + **464 VP** (`virtualpoint.go:21`) + **256 EXT** (`KX_N_EXT`)
= **744 điểm**. Vượt 500 là cấu hình hợp lệ, không phải trường hợp bệnh lý.

**Kịch bản hỏng:** một công trình có 300 VP và 250 điểm Modbus. Kỹ sư mở tab Ánh xạ, thấy
"Catalog 500" **không kèm dấu `+`**, không có cảnh báo stale, và 44 điểm cuối bảng chữ cái
đơn giản là không tồn tại đối với họ. Cùng lúc `truth.complete === true` nên nút Map vẫn mở —
FE tin rằng nó đang nhìn toàn bộ sự thật.

---

### F-PIO-005 · Trung bình · `dataType` suy từ giá trị runtime, không từ cấu hình

**Nơi:** [`apps/web-api/internal/app/programming_pointcatalog.go:pointCatalogDataType`](../../../apps/web-api/internal/app/programming_pointcatalog.go)

```go
default:
    if _, ok := point.Value.(bool); ok { return "BOOL" }
    return "REAL"
```

Ba hệ quả:

1. Một kênh UI đặt `signalType = 4/5` (tiếp điểm khô) mà **chưa có mẫu** (`Value == nil`)
   được khai là `REAL`. Bind vào `VAR_INPUT : BOOL` sẽ bị báo *"Kiểu dữ liệu không khớp"* —
   sai, và sẽ tự hết sai khi điểm có mẫu. Một lỗi nhấp nháy theo trạng thái hiện trường.
2. `MSV` **không bao giờ** ra `UINT`, trong khi FE khai `PREFIX_TYPE` có `MSV: 'UINT'`
   ([`mappingViewModel.ts:80-83`](../../../apps/web-ui/src/features/programming/design/mapping/mappingViewModel.ts#L80-L83)).
   Nhánh Multistate của đề bài §15 vì thế không có đường chạy.
3. Điểm Modbus `int32`/`uint32`/`float32` đều gộp về `REAL`, mất thông tin dải và dấu.

Nguồn sự thật đúng phải là cấu hình (`AiInputConfig.signalType`, `ModbusRTUPoint.data_type`,
`VirtualPoint.signalType`), không phải giá trị đang đọc được.

---

### F-PIO-006 · Trung bình · Catalog thiếu 4 trường bắt buộc của đề bài §5

`PointCatalogEntry` hiện có 11 trường. Đề bài §5 đòi thêm:

| Trường đề bài | Có? | Ghi chú |
|---|---|---|
| `description` | ❌ | `AiInputConfig.note`, `VirtualPoint.note` có; Modbus Point không có; Catalog không chở |
| `enabled` | ❌ | tồn tại ở cả ba nguồn nhưng không lên Catalog |
| `sourceRef` (UI01 / VP21 / MBDEV01…) | 🟡 | có `deviceId` cho MB_RTU (`bus-N-slave-M`), không có định danh nguồn cho LOCAL/VP |
| `tags/group` (equipment) | ❌ | `PointDTO.Equipment` (`ADR-042`) có thật, không được chiếu lên Catalog |

Thiếu `equipment` là mất mát cụ thể nhất: `ADR-042` đã dựng khái niệm thiết bị công nghệ cho
trang Giám sát, nhưng tab Ánh xạ không lọc theo AHU-01 được.

---

### F-PIO-007 · Trung bình · Mốc thời gian điểm LOCAL là "lúc web đọc SHM"

**Nơi:** [`apps/web-api/internal/app/core_client.go:1005`](../../../apps/web-api/internal/app/core_client.go#L1005)

```go
UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
```

Đối chiếu: đường Modbus **đã làm đúng** ở `core_client.go:1162-1166`, dùng
`sample_utc_ms` của producer và ghi rõ lý do trong comment. Đường LOCAL chưa.

Nguyên nhân gốc nằm ở hợp đồng: `kx_point_t` ([`contracts/shm/mkddc_shm.h:301-307`](../../../contracts/shm/mkddc_shm.h#L301-L307))
**không có trường timestamp** — chỉ có `ts_ns` cấp header của cả bảng. Sửa đúng cách cần
hoặc chở `plc_shm.ts_ns` lên làm mốc chung, hoặc mở rộng `kx_point_t` (đổi ABI, phải bump magic).

---

## 4. Nhóm B — Physical Point (đề bài §6-§10)

### F-PIO-008 · Cao · BOARD_CAP_MAP chết ở `iobus`; số kênh là hằng biên dịch ở cả ba tầng

Đề bài §6.1: *"Hardware capability phải do firmware/backend cấp. FE không được hard-code số
channel hoặc mode."*

Hợp đồng IOP **đã có** bản đồ năng lực:

```c
/* contracts/iop/iop_protocol.h:105-112 */
#define IOP_BOARD_CAP_UI_16   (1u << 0)
#define IOP_BOARD_CAP_DI_8    (1u << 1)   /* optional SKU module */
#define IOP_BOARD_CAP_DO_4    (1u << 2)
#define IOP_BOARD_CAP_AO_4    (1u << 3)
#define IOP_BOARD_CAP_RTD     (1u << 4)
```

`iobus` đọc nó ở handshake, **kiểm rồi vứt**:

```cpp
/* apps/iobus/bootstrap/main.cpp:641-660 */
const uint16_t cap = client.board_cap_map();
if (!(cap & IOP_BOARD_CAP_UI_16)) { ...alarm; return false; }
if ((cap & IOP_BOARD_CAP_REV_A) != IOP_BOARD_CAP_REV_A) { ...warn; }
/* cap không được ghi vào SHM, không đi tiếp đâu cả */
```

`grep -n "board_cap" contracts/shm/mkddc_shm.h` → **0 kết quả**.

Hệ quả là mỗi tầng tự viết lại con số:

| Tầng | Nơi | Giá trị |
|---|---|---|
| Go | `core_client.go:786-789` | `kxNUI=16, kxNDI=8, kxNAO=4, kxNDO=4` |
| Go | `overview.go:266-271` | `DigitalInputs: 0` viết cứng kèm comment *"hằng của SKU"* |
| Go | `internal/points/catalog.go:11-16` | `Limits{UI, AO, DO, VP}` — **không có DI** |
| FE | `shared/utils.ts:3` | `VISIBLE_UI_CHANNELS = 16` |

Bốn nguồn sự thật cho cùng một dữ kiện. `DS_MK-DDC-24_VI` §174 hứa *"chỉ tạo cho optional
isolated-DI SKU **khi capability map xác nhận**"* — cơ chế xác nhận đó không tồn tại trong code.

---

### F-PIO-009 · Trung bình · Không có capability theo từng kênh

Đề bài §6.1 đòi mỗi kênh công bố tập mode nó hỗ trợ, và dropdown chỉ hiện mode có thật.
FE hiện liệt kê cứng `signalType 0..8` cho **mọi** kênh
([`InputsPage.tsx:1240-1290`](../../../apps/web-ui/src/features/points/InputsPage.tsx)), kể cả
`7 = ánh sáng/chuyển động` và `8 = pulse` vốn phụ thuộc mạch. Không có `IOP_BOARD_CAP_RTD`
nào được hỏi trước khi mời người dùng chọn nhiệt trở.

---

### F-PIO-010 · Trung bình · UI thiếu deadband, clamp, phát hiện lỗi và chính sách giá trị khi lỗi

| Đề bài §7 | Có trong `AiInputConfig`? |
|---|---|
| Filter | ✅ `filterSamples` (trung bình động) |
| Deadband | ❌ `grep -rn "deadband"` chỉ trúng `AuxFunctionsPage` (một trang khác) |
| Clamp | ❌ |
| Under/Over range enable | ❌ (có `kx_reliability_t` OVER/UNDER_RANGE ở SHM nhưng không cấu hình được) |
| Open/Short circuit | 🟡 có mã `KX_REL_OPEN_LOOP`/`SHORTED_LOOP` ở firmware, không có ô bật/tắt |
| Failure value (`INVALID` / giữ / giá trị cố định) | ❌ |
| Hiệu chuẩn | 🟡 chỉ 1 điểm (offset) — chính FE tự khai thiếu ở `InputsPage.tsx:946-950` |

---

### F-PIO-011 · Trung bình · AO/DO thiếu ramp và min-ON/OFF; 12 trường FE là **trường chết**

`grep -rn "ramp\|slew\|min_on\|min_off\|dwell"` trên `apps/iobus` + `apps/core` → **0 kết quả thật**.

Tệ hơn, `types.ts` khai một loạt trường không có ai đọc:

```ts
// apps/web-ui/src/shared/types.ts:1370-1425
minHeatOutput, maxHeatOutput, minCoolOutput, maxCoolOutput,
piSeqLowerFan1, fanSpeed2, piSeqUpperFan3, setbackAlarm,
switchOnDelay, switchOffDelay, pwmCycleTime, runtimeAlarmHours
```

Kiểm chứng: `grep -rn "switchOnDelay" apps/web-ui/src apps/web-api apps/core apps/iobus`
→ **đúng một kết quả**, chính là dòng khai báo. Không có form nào ghi, không có backend nào đọc.
Đây là bề mặt hợp đồng hứa một tính năng không tồn tại.

Ngoài ra `POST /api/v1/commissioning/points/{id}/test`
([`commissioning.go:14-44`](../../../apps/web-api/internal/app/commissioning.go#L14-L44))
có RBAC `operator+` và có audit, **nhưng không có tham số TTL/timeout** — đề bài §10 đòi
"permission + confirm + timeout + audit". Đường ép tay thường (`PUT /points/{id}`) thì **có**
TTL (`overrideExpiresInS`), nên đây là chênh lệch giữa hai đường cùng ghi ra một cơ cấu chấp hành.

---

### F-PIO-012 · Trung bình · Safe-state chỉ một mức, không phân biệt ba nguyên nhân

Đề bài §8/§10 đòi ba ô: *Program fault*, *Controller fault*, *Disable* (và *Boot* cho DO).

Thực tế có **hai lớp, cả hai đều không phân biệt nguyên nhân**
([`safe_state_config.hpp:6-15`](../../../apps/core/adapters/config/safe_state_config.hpp#L6-L15)):

1. `io_safe_state.conf` = **relinquish default mức 6** — một giá trị/kênh, có cấu hình được.
2. `SafeState` override = **cứng**: AO → 0V/4mA theo mode, DO → open. Không cấu hình được,
   luôn thắng, kích bởi 5 trigger T1/T2/T3/T6/T7/T8.

Quyết định "override cứng" là **có chủ ý và đúng cho nhánh safety** (để ba lớp MCU/iobus/core
hội tụ cùng một trạng thái).

> **Cập nhật b2.0 — đề xuất của b1.0 đã bị chủ sở hữu BÁC.** b1.0 đề nghị giữ nguyên và chỉ sửa
> phần hiển thị, với lập luận "mọi nguyên nhân dẫn tới cùng một trạng thái". Lập luận đó **sai ở
> một chỗ cụ thể**: nó gộp một *sự cố* với một *thao tác vận hành có chủ ý*. `Program Disable` —
> tắt một chương trình để bảo trì — không phải hỏng hóc, và ép output về hard Safe-State trong
> tình huống đó là hành vi sai; đúng ra phải **trả lại quyền sở hữu** cho mức ưu tiên thấp hơn.
> Xử lý bằng `ISS-PIO-34` (ma trận trạng thái output, phải ký trước khi chạm mã) — xem §9.2.

---

### F-PIO-013 · Thấp · `ConfigIO` là `[]map[string]any`, không có schema ở backend

```go
// apps/web-api/internal/app/dto.go:22-28
type ConfigIO struct {
    Revision uint64           `json:"revision,omitempty"`
    Checksum string           `json:"checksum,omitempty"`
    UI       []map[string]any `json:"ui"`
    AO       []map[string]any `json:"ao"`
    DO       []map[string]any `json:"do"`
}
```

Backend chuyển tiếp nguyên trạng. Nơi duy nhất kiểm dải theo mode là C++
(`load_safe_state_config`), tức lỗi cấu hình chỉ lộ khi `core` khởi động lại.

---

## 5. Nhóm C — Virtual Point (đề bài §11-§16)

### F-PIO-014 · Trung bình · Không có kiểu Multistate ở tầng sản phẩm

`VirtualPointSignalType = 'boolean' | 'integer' | 'float' | 'string' | 'datetime'`.
Core có `msv[KX_N_MSV]` (8 slot) và `SchedulePointKind` đã biết `'MSV'`, nhưng **không có
đường cấu hình danh sách state/label** (`0 = Off, 1 = Auto, 2 = Manual, 3 = Emergency`).
Đề bài §15 không thực hiện được.

### F-PIO-015 · Trung bình · Không có chính sách retain/persistence

Đề bài §13 đòi chọn *Retain last value* / *Initial value* sau khởi động lại.
`VirtualPoint` chỉ có `value` (đóng vai trò giá trị khởi tạo). Không có cờ retain nào ở
`dto.go:89-131`, và `syncVirtualPointToCore` luôn đẩy lại giá trị cấu hình khi khởi động
(`virtualpoint.go:107-117`) — tức hành vi thực tế là **luôn Initial value**, không có lựa chọn.

### F-PIO-016 · Trung bình · Không có giới hạn min/max thật cho VP

`displayMin`/`displayMax` là **thang hiển thị**, không phải biên kỹ thuật. Không có đường nào
từ chối một lệnh ghi 45 °C vào `SAT_Setpoint` khai dải 16–30 °C. Đối chiếu: điểm Modbus **có**
`MinValue`/`MaxValue` với ngữ nghĩa đúng (`modbusrtu/domain.go:90-94`). Hai nguồn Point cùng
hệ, hai mức nghiêm ngặt khác nhau.

### F-PIO-017 · Trung bình · Ownership có ở backend nhưng vô hình trên giao diện

Backend làm **rất tốt** phần này — `VirtualPoint.Source` (`WEB` / `PROGRAM`) tách đúng hai trục
"ai sửa được" và "ai sở hữu", kèm 12 dòng comment giải thích cuộc giằng co im lặng nó ngăn
([`dto.go:118-131`](../../../apps/web-api/internal/app/dto.go#L118-L131)).

Nhưng `source` **không có trong type FE** và không có control nào để đặt. Người kỹ sư không
nhìn thấy khái niệm chủ sở hữu, không đặt được, và không hiểu vì sao một VP lại chỉ đọc.
Đề bài §16 xem đây là mục "rất quan trọng".

### F-PIO-018 · Trung bình · "Ai đang dùng điểm ảo này" không quét Programming

[`virtualpoint_usage.go:8-22`](../../../apps/web-api/internal/app/virtualpoint_usage.go#L8-L22)
nêu đúng động cơ — *"một chương trình ST mất binding"* — và khai `Kind: alarm | schedule | program`.
Nhưng:

```go
Scanned: []string{"alarm-settings", "schedules"},
```

`grep -n "program" virtualpoint_usage.go` → chỉ trúng dòng comment. **Không có nguồn nào sinh
`Kind = "program"`.** Xoá một VP đang được một chương trình bind cho ra danh sách rỗng và
`incomplete = false` — tức một lời khẳng định sai, đúng thứ mà chính comment của tệp cảnh báo.

---

## 6. Nhóm D — Modbus Point (đề bài §17-§27)

Trước hết, phần **đạt** — cần ghi rõ để không đề xuất làm lại:

| Đề bài | Trạng thái | Bằng chứng |
|---|---|---|
| §18 Port/Bus RTU (baud/parity/stop/timeout/retry) | ✅ | `ModbusBus`, `PortsPage.tsx`, `ModbusPortCapability` (cổng thật của bo, không cho gõ tay) |
| §20 Device (slave address, poll, timeout, retry, offline-after) | ✅ | `modbusrtu/domain.go:Device` |
| §21 Bốn vùng dữ liệu + FC01/02/03/04 đọc | ✅ | `BuildProfile` map `coil/discrete_input/holding_register/input_register` → fc 1/2/3/4 |
| §21 FC05/06/16 ghi | ✅ | `modbus_master.cpp:284-290` (coil→FC05, 16-bit→FC06, 32-bit→FC16) |
| §24 Byte order + Word order, 4 tổ hợp | ✅ | `persistence.go:296-311` → `ABCD/BADC/CDAB/DCBA`; `register_codec.cpp:28-41` |
| §24 `bool/int16/uint16/int32/uint32/float32` | ✅ | `device_profile.cpp:128-141`, có chặn `count` lẻ cho 32-bit (F-18) |
| §25 Scale/offset + min/max clamp | ✅ | `Scale`, `Offset`, `MinValue`, `MaxValue`; chặn `scale = 0` fail-closed ở cả BE và profile |
| §27 Quality 5 mức + reason + exception code | ✅ | `kx_ext_point_t` v5, `mapExtQuality`, `mapExtQualityReason` |
| §27 Chuỗi Bus → Device → Point | ✅ | `Diagnostics` per-device, `kx_bus_metrics_t` per-bus |
| §23 `bit_index` (trích bit trong register) | ✅ | vượt đề bài |

**Đây là nguồn Point trưởng thành nhất của sản phẩm.** Các finding dưới đây đều là bù, không phải sửa nền.

### F-PIO-019 · Cao · FE chặn cứng mapping MB_RTU dù Core và Backend đã hỗ trợ

**Nơi:** [`mappingViewModel.ts:142`](../../../apps/web-ui/src/features/programming/design/mapping/mappingViewModel.ts#L142)

```ts
if (entry.category === 'MB_RTU')
  return { eligibility: 'UNSUPPORTED_BY_CORE',
           reasons: ['Core Rev A chưa resolve MB_RTU trong ST io_map'] }
```

Lý do ghi trong mã **đã lạc hậu**: `st_io_map.cpp:107-113` resolve `MB_RTU` → `StPointKind::EXT`
từ trước baseline này, và `checks_invariants.go:229-235` còn có luật chống trùng thanh ghi
riêng cho MB_RTU. Người dùng nhìn thấy chữ *"Core chưa hỗ trợ"* cho một năng lực Core đã có.

Gỡ chặn này **một mình không đủ** — phải đi cùng F-PIO-002 (cấp `extIndex`), nếu không FE sẽ
mời người dùng chọn một binding mà nó không dựng nổi.

### F-PIO-020 · Trung bình · Không có Address Convention (protocol offset vs. 4xxxx)

`grep -rn "convention\|4xxxx\|protocolAddress" apps/web-ui/src/features/modbus-rtu/` → **0 kết quả**.
Người dùng cầm datasheet ghi `40102` phải tự trừ để gõ `101`, không có ô nào ghi lại
họ đã hiểu theo quy ước nào. Đề bài §23 gọi đây là chỗ *"phải xử lý cực kỳ cẩn thận"* — đúng,
vì sai một đơn vị ở đây là đọc nhầm thanh ghi mà mọi thứ vẫn "chạy".

### F-PIO-021 · Trung bình · Không có poll group / poll interval / stale-after theo điểm

`poll_ms` và `timeout_ms` chỉ có ở cấp **Device**. Đề bài §22 muốn nhóm poll Fast/Slow theo điểm
và ngưỡng `Stale after` riêng. Hệ quả thực tế: một điểm cấu hình (đọc 1 lần/phút là đủ) bị poll
cùng nhịp với tần số VFD (500 ms), tiêu băng thông RS-485 vô ích.

### F-PIO-022 · Trung bình · Không có read-back verification sau khi ghi

`grep -rn "read_back\|verify_after_write"` trên toàn bộ Go + C++ → **0 kết quả**.
`modbus_master.cpp:281-303` có `last_written_[]` để tránh ghi lặp, nhưng đó là chống rung,
không phải xác nhận thiết bị đã nhận. Đề bài §26 khuyến nghị read-back cho thanh ghi
actuator/config.

### F-PIO-023 · Trung bình · Điểm Modbus không phải công dân hạng nhất của hệ Point

| Năng lực | LOCAL | VP | MB_RTU |
|---|---|---|---|
| Xuất hiện trong Catalog | ✅ | ✅ | ✅ |
| Đặt cảnh báo | ✅ | ✅ | ❌ `alarmsettingsapi.go:246` chỉ nhận `UI, AO, DO, VP` |
| Sửa tag/tên/đơn vị/trend/equipment qua `PUT /points/{id}/config` | ✅ | ✅ | ❌ `pointconfig.go:229` chỉ canonical hoá `UI/AO/DO/VP` |
| Bind vào Program | ✅ | 🟡 | ❌ |

Một thanh ghi báo lỗi VFD (`Fault Word`) — thứ đáng báo động nhất trong tủ — **không đặt cảnh
báo được**. Đây là hệ quả kiến trúc: Modbus có CRUD riêng dưới `/modbus/*` và chưa được kéo
vào bề mặt Point chung.

### F-PIO-024 · Thấp · Modbus TCP có mã nhưng không có đường cấu hình

`apps/iobus/adapters/modbus_rtu/modbus_tcp.{hpp,cpp}` tồn tại và được `register_codec` dùng
(`modbus_tcp.cpp:246`). Không có route, không có schema, không có trang.
Đề bài §19 nói rõ: *"Nếu Rev A hiện chưa hỗ trợ Modbus TCP thì không hiện tab này"* —
hành vi hiện tại **đúng đề bài**, nhưng cần một dòng trong hồ sơ nói đây là ẩn có chủ ý
chứ không phải mã chết bị bỏ quên.

---

## 7. Nhóm E — Ánh xạ, Kiểm tra, Commission (đề bài §28-§33)

### F-PIO-025 · Trung bình · Bộ lọc Available Points thiếu Access và Status

`MappingToolbar` có: tìm kiếm, Chương trình, **Loại Point** (`ALL/LOCAL/VP/MB_RTU`), **Hướng**,
**Kiểu dữ liệu**. Đề bài §28 đòi thêm `Access (Read/Write)` và `Status (Good/Unmapped/Offline)`.
Nút "Gợi ý (Phase 1A)" đang `disabled` với tooltip *"chỉ bật sau khi capability authority được
công bố"* — nối thẳng vào F-PIO-008.

### F-PIO-026 · Thấp · Hàng Point không hiện định danh theo nguồn

`PointCatalogPane` hiện `category:deviceId:pointId`. Đề bài §29 muốn thấy ngay:

```text
UI-01  Supply Air Temperature      PHYSICAL · UI   0–10 V → 0…50 °C
VP-021 SAT Setpoint                VIRTUAL         RW · RETAIN
MB-014 VFD Frequency               MODBUS · VFD-01 HR 102 · FC03
```

Dòng thứ ba hiện ra `MB_RTU:bus-1-slave-3:VFD_Frequency` — không có thanh ghi, không có FC.

### F-PIO-027 · Trung bình · Commission Impact không tách theo nguồn

[`changes.go:26-42`](../../../apps/web-api/internal/programming/application/changes.go#L26-L42)
có 8 nhóm impact (`retain`, `activeOverrides`, `cutover`, `outputMappingChanges`,
`publishedSignals`, `controlLibrary`, `programSet`, `enableIntent`) — tốt hơn đề bài ở
nhiều mặt, nhưng `outputMappingChanges` **gộp cả ba nguồn**.

Đề bài §33 muốn:

```text
Physical mappings changed     2
Virtual points changed        1
Modbus mappings changed       3
Writable outputs affected     2
```

Khác biệt này có ý nghĩa vận hành thật: đổi 3 mapping Modbus và đổi 3 mapping AO là hai mức
rủi ro rất khác nhau khi bấm Commission.

### F-PIO-028 · Trung bình · `Check` không kiểm phần đặc thù của từng nguồn

`Check` hiện kiểm: cú pháp/kiểu ST, identity/allowlist point, hướng, quyền ghi, đơn vị,
quality policy, chủ sở hữu OUTPUT (`ST-OWN-001`), trùng thanh ghi MB_RTU. **Không kiểm**:

| Đề bài §33 | Trạng thái |
|---|---|
| Physical: capability kênh / scaling / safe-state | ❌ |
| Virtual: type / ownership / range / persistence | ❌ (một phần vì các khái niệm chưa tồn tại — F-PIO-014/015/016) |
| Modbus: device còn tồn tại / address / access / scaling | ❌ — `st_io_map.cpp:107-113` chỉ kiểm `ext_index ∈ [1, 256]`, không kiểm điểm đó có thật |

---

## 8. Bảng issue — b2.0 sau phán quyết chủ sở hữu

> **Trạng thái:** chủ sở hữu **trả lại bảng b1.0** với lý do: 30 issue cũ chỉ "nối đường ống",
> thiếu các vấn đề kiến trúc có thể gây lỗi vận hành. Bản b2.0 này bổ sung `ISS-PIO-31…37`,
> chỉnh scope `ISS-PIO-03/04/05`, và dựng lại Đợt 1. **Vẫn chưa tạo trên repo** — chờ chủ sở hữu
> duyệt chính bảng này.
>
> Ước lượng là ngày-người cho một người quen mã.

### 8.0 Vì sao Đợt 1 phải dựng lại

Bảng b1.0 xếp `ISS-PIO-01` (expose `extIndex`) là P0 mở đường. `F-PIO-029` — phát hiện **sau**
chất vấn của chủ sở hữu — cho thấy làm vậy là **sai thứ tự và nguy hiểm**: lưu một `extIndex`
thô vào Binding trong khi slot đó dịch mỗi lần ai đó tắt một thiết bị Modbus, chính là tự tay
dựng lên lớp lỗi ghi sai I/O vật lý.

Nguyên tắc mới cho Đợt 1, theo đúng chỉ đạo *"Đợt 1 phải gồm cả stable identity + compatibility
authority"*:

```text
       SAI (b1.0)                          ĐÚNG (b2.0)
  ─────────────────────            ────────────────────────────
  expose extIndex                  1. Định danh bền trước
        ↓                             (ISS-PIO-31)
  FE lưu vào Binding                        ↓
        ↓                          2. Một authority quyết định
  reboot / tắt 1 device                compatibility (ISS-PIO-32)
        ↓                                   ↓
  ghi nhầm thanh ghi               3. Mới nối đường (01/02/03)
  KHÔNG ai báo                              ↓
                                   4. Cổng V&V xuyên tầng (36)
```

### 8.1 Đợt 1 — Nền định danh + authority, rồi mới nối đường

| Issue | Tiêu đề | Finding | Ưu tiên | Ước lượng | Phạm vi |
|---|---|---|---|---|---|
| `ISS-PIO-31` | **Stable Point Identity & Slot Allocation** — Binding neo vào `(deviceId, pointId/tagName)` bền, không neo vào `extIndex`; allocator `ext` có bảng bền qua reboot/reorder/enable-disable; phát hiện lệch khi resolve; migration cho binding đã tồn tại. **Ba AC bắt buộc: `AC-PIO-ID-01/02/03` — xem §8.1.1** | F-PIO-029, F-PIO-002 | **P0 chặn** | 5,5 | `bus_worker.cpp`, `modbus_master.cpp`, `persistence.go`, `pointcatalog.go`, `st_io_map.cpp` |
| `ISS-PIO-32` | **Server-authoritative Binding Compatibility** — một authority duy nhất cho `type + direction + writable + unit + ownership + source capability`; FE **chỉ trình bày** kết quả, không tự suy `prefix`/allowlist | F-PIO-019, F-PIO-005 | **P0 chặn** | 3,5 | `programming/application/`, `mappingViewModel.ts` (gỡ logic quyết định) |
| `ISS-PIO-01` | Catalog cấp định danh Modbus đủ để tạo Binding (**sau** `ISS-PIO-31`; chở định danh bền, `extIndex` chỉ là chi tiết vận chuyển) | F-PIO-002 | P0 | 1,5 | `pointcatalog.go`, `programming_pointcatalog.go`, `model/types.ts` |
| `ISS-PIO-02` | Gỡ chặn `UNSUPPORTED_BY_CORE` cho MB_RTU — **thực hiện qua `ISS-PIO-32`**, không sửa điều kiện cứng trong FE | F-PIO-019 | P0 | 1,0 | `mappingViewModel.ts` + test |
| `ISS-PIO-03` | **VP Slot Allocator** (scope đã mở rộng theo yêu cầu): quy tắc cấp phát `AV/BV/MSV`, xử lý **collision**, **delete/reuse** slot đã trả lại, **persistence** qua reboot, và hành vi khi hết slot; phơi `boundPointId` lên FE | F-PIO-003 | P0 | 4,0 | `virtualpoint.go`, `dto.go`, `types.ts`, `VirtualIoPage.tsx` |
| `ISS-PIO-04` | **Stable deterministic pagination** (scope đã mở rộng): cursor ổn định theo khoá sắp xếp bền, **không** chỉ thêm `nextCursor`; kết quả không nhảy/lặp/mất mục khi catalog đổi giữa hai trang; FE tôn trọng `complete=false` | F-PIO-004 | P0 | 2,5 | `pointcatalog.go`, `transport/http/runtime.go`, `queries.ts` |
| `ISS-PIO-35` | **Canonical Quality Contract fail-closed** (thay `ISS-PIO-05` cũ): version hoá enum quality; **mọi giá trị không nhận diện → `UNKNOWN`/`BAD`, tuyệt đối không `GOOD`**; giữ `reason`, `timestamp`, `data-age` xuyên tầng | F-PIO-001 | **P0** | 2,5 | `utils.ts`, `pointNormalizer.ts`, `types.ts`, `StatusBadge`, hợp đồng quality |
| `ISS-PIO-36` | **Point/I/O E2E V&V Gate** — bộ test xuyên tầng bắt buộc (chi tiết §8.2) | toàn bộ Cao | **P0** | 4,0 | `apps/web-ui/e2e`, `internal/app`, `tools/integration_test` |

**Tổng Đợt 1: 24,5 ngày-người** (b1.0 là 8,5 — chênh lệch là phần nền mà bảng cũ bỏ sót;
b2.1 thêm 1,5 cho ba AC ở `ISS-PIO-31`).

Sau Đợt 1: `MAP-01` PASS **và** binding không đổi nghĩa sau reboot/reconfiguration.

### 8.1.1 `ISS-PIO-31` — ba acceptance criteria P0 do chủ sở hữu yêu cầu

> Chủ sở hữu yêu cầu **không mở thêm issue** để giữ bảng gọn; ba AC này nằm trong
> `ISS-PIO-31` và là **điều kiện đóng** của nó.

#### `AC-PIO-ID-01` — `extIndex` **không phải** identity

Binding canonical phải giữ **`pointId` bền của điểm Modbus** (`deviceId` + `tag_name`/`point_id`
do người dùng đặt). `extIndex` chỉ là **runtime slot/handle** được resolve lại mỗi lần nạp cấu
hình. Số `14` không bao giờ được coi là danh tính lâu dài của một điểm.

*Cách kiểm:* đọc schema Binding đã lưu — không được có trường nào mà mất nó thì không xác định
lại được điểm; và `extIndex`, nếu còn xuất hiện, phải nằm ở **lớp runtime**, không ở lớp bền.

#### `AC-PIO-ID-02` — Referential integrity khi Check/Commission

Trước activation phải xác minh trọn chuỗi:

```text
pointId  →  extIndex  →  bus / device / register / datatype / access
```

Nếu **fingerprint hoặc config revision khác** với lúc binding được tạo ⇒ **BLOCK Commission**.
Tuyệt đối không chạy tiếp chỉ vì slot còn nằm trong `1…256`.

Đây chính là lỗ hổng của `F-PIO-029`: `st_io_map.cpp:112` hiện chỉ kiểm
`entry.ext_index >= 1 && entry.ext_index <= KX_N_EXT`. Một slot đã dịch chỗ vẫn thoả điều kiện
đó, nên phép kiểm hiện tại **không** phát hiện được gì. AC này thay một phép kiểm dải bằng một
phép kiểm **danh tính**.

#### `AC-PIO-ID-03` — Migration cho binding legacy

Binding/artifact cũ đang lưu `extIndex` phải có đường migration. Nếu **không chứng minh được**
điểm cũ và điểm mới là cùng một identity ⇒ **giữ LKG**, yêu cầu rebind/recommission.
**Không tự remap** — đoán ở đây là ghi lệnh vào một thanh ghi không ai chọn.

**Bắt buộc test quy ước 0-based vs 1-based.** Chủ sở hữu nêu đúng một seam có thật, và nó
nguy hiểm hơn vẻ ngoài vì **chưa từng chạy với dữ liệu thật** (chưa ai tạo được binding Modbus —
`F-PIO-002`/`F-PIO-019`):

| Tầng | Quy ước | Bằng chứng |
|---|---|---|
| Allocator `iobus` | **0-based** | `ext_cursor_ = 0` (`modbus_master.cpp:25`), truy cập `snapshot.ext[ext_idx]` |
| Artifact / io_map | **1-based** | `st_io_map.cpp:112` kiểm `>= 1`; `st_process_image.cpp:24` ghi rõ *"Artifact dùng index 1-based; PointTable dùng 0-based"* rồi `point_index - 1` |
| Producer bắc cầu hai quy ước | **CHƯA TỒN TẠI** | không nguồn nào phát `extIndex` ra ngoài (`F-PIO-002`) |

Nghĩa là `ISS-PIO-01` nếu phát thẳng `ext_idx` thô sẽ **lệch đúng một thanh ghi** — hợp lệ với
mọi phép kiểm hiện có, và sai im lặng. Test phải khoá cả hai đầu: `ext_idx = 0` của iobus phải
ra `extIndex = 1` trong artifact, và một artifact `extIndex = 1` phải đọc đúng `plc_shm.ext[0]`.

### 8.1.2 Thứ tự P0 — **ĐÃ KHOÁ** (chủ sở hữu, 2026-08-31)

```text
ISS-PIO-31  Stable Point Identity            ← phải ĐÓNG trước, kèm test
      ↓
ISS-PIO-32  Server-authoritative compatibility
      ↓
ISS-PIO-01  Expose runtime extIndex
      ↓
ISS-PIO-02/03  Enable MB + VP mapping
      ↓
ISS-PIO-35  Quality fail-closed
      ↓
ISS-PIO-36  End-to-end V&V gate
```

**Ràng buộc thi hành:** không được code `ISS-PIO-01`/`ISS-PIO-02` trước khi `ISS-PIO-31` đóng
**và** có test chứng minh năm thao tác sau đều **không** làm binding đổi nghĩa:
rename điểm · add điểm · disable điểm · disable device · reboot.

`ISS-PIO-04` (phân trang tất định) không nằm trên đường găng này và chạy song song được.

### 8.2 `ISS-PIO-36` — nội dung bắt buộc của cổng V&V

Lý do issue này ở Đợt 1 chứ không ở cuối: **332 test FE hiện xanh trong khi 7 finding Cao đang
tồn tại**. Không bộ test nào phủ được các đường đó, nên "xanh" hiện không chứng minh gì về
lớp Point.

b2.1 bổ sung nhóm `5a…5g` theo yêu cầu của chủ sở hữu — migration, restart, reorder,
disable-device và quy ước base index đều vào đây thay vì mở issue riêng. Bảy dòng đó là
**bằng chứng đóng `ISS-PIO-31`**, không phải việc để cuối kế hoạch.

| # | Kịch bản bắt buộc | Chặn finding |
|---|---|---|
| 1 | Tạo VP trên giao diện → map → Check → chạy runtime, có giá trị thật | F-PIO-003 |
| 2 | Tạo điểm Modbus → map → Check → chạy runtime | F-PIO-002, F-PIO-019 |
| 3 | Catalog **>500 mục**: không mất mục, phân trang đi hết, `complete` đúng | F-PIO-004 |
| 4 | Quality `UNKNOWN`/giá trị lạ → hiển thị **không** phải GOOD | F-PIO-001 |
| 5 | **Restart** + **tắt một thiết bị Modbus** → binding và định danh **không đổi nghĩa** | F-PIO-029 |
| 5a | **Rename** một điểm Modbus → binding vẫn trỏ đúng thanh ghi | F-PIO-029, `AC-PIO-ID-01` |
| 5b | **Add** một điểm sắp xếp trước điểm đang bind → không dịch nghĩa binding | F-PIO-029, `AC-PIO-ID-01` |
| 5c | **Disable** một điểm ở giữa dải → không dịch nghĩa binding | F-PIO-029, `AC-PIO-ID-01` |
| 5d | **Reorder** bus/thiết bị → không dịch nghĩa binding | F-PIO-029, `AC-PIO-ID-01` |
| 5e | Đổi register/datatype/access của điểm đã bind → **BLOCK Commission**, không chạy tiếp | `AC-PIO-ID-02` |
| 5f | **Migration binding legacy** lưu `extIndex`: chứng minh được identity → migrate; không chứng minh được → **giữ LKG + yêu cầu rebind**, không tự remap | `AC-PIO-ID-03` |
| 5g | **Quy ước 0-based ↔ 1-based**: `ext_idx = 0` của iobus ⇒ `extIndex = 1` trong artifact; artifact `extIndex = 1` đọc đúng `plc_shm.ext[0]` | `AC-PIO-ID-03` |
| 6 | Nhiều SKU capability (mô phỏng cap map khác nhau) → số kênh và mode theo capability | F-PIO-008, F-PIO-009 |
| 7 | Physical config apply → **read-back verify**; apply lỗi → giữ config hợp lệ trước đó | F-PIO-013 |
| 8 | Điểm Modbus writable: ghi → xác nhận → giá trị đúng ở thiết bị | F-PIO-022 |

### 8.3 Đợt 2 — An toàn cấu hình và chính sách trạng thái output

| Issue | Tiêu đề | Finding | Ưu tiên | Ước lượng |
|---|---|---|---|---|
| `ISS-PIO-33` | **Physical I/O Configuration Activation Safety** — lifecycle `Edit → Validate → Apply → Read-back Verify`; đổi `0–10V ↔ 4–20mA`, scaling, AO mode, DO behavior không được áp dụng mơ hồ; lỗi thì **giữ config hợp lệ trước đó / rollback** | F-PIO-013 | **P0** | 4,0 |
| `ISS-PIO-34` | **Output State Policy Matrix** — phân biệt rõ `Program Disable` / `Program Fault` / `Controller-Core Fault` / `Communication Loss` / `Boot`; safety fault giữ hard Safe-State, còn `Program Disable` xử theo **release ownership → relinquish/default policy** | F-PIO-012 | **P0** | 4,0 |
| `ISS-PIO-27` | Typed schema cho `ConfigIO` thay `[]map[string]any`, validate theo capability — **là tiền đề của `ISS-PIO-33`, không thay thế nó** | F-PIO-013 | P1 | 2,5 |
| `ISS-PIO-26` | TTL/timeout cho lệnh test commissioning, ngang với đường ép tay | F-PIO-011 | P1 | 1,0 |
| `ISS-PIO-25` | **Xoá 12 trường chết** ở `AoConfig`/`DoConfig` hoặc hiện thực hoá — chốt một hướng, không để lửng | F-PIO-011 | P1 | 1,0 |

**Tổng Đợt 2: 12,5 ngày-người.**

> **Ghi chú `ISS-PIO-34`:** chủ sở hữu **bác** đề xuất b1.0 (*"mọi nguyên nhân dẫn tới cùng một
> trạng thái"*). Issue này phải bắt đầu bằng một **ma trận trạng thái được ký**, trước khi
> chạm vào mã. Xem §9.2.

### 8.4 Đợt 3 — Chuỗi capability từ MCU lên giao diện

| Issue | Tiêu đề | Finding | Ưu tiên | Ước lượng |
|---|---|---|---|---|
| `ISS-PIO-11` | Chở `BOARD_CAP_MAP` từ IOP handshake vào `io_shm` (đổi ABI, bump `KX_SHM_MAGIC`) | F-PIO-008 | P1 | 2,5 |
| `ISS-PIO-12` | `GET /api/v1/system/capabilities` cấp số kênh + mode hỗ trợ theo kênh; bỏ 4 hằng số trùng lặp | F-PIO-008, F-PIO-009 | P1 | 2,5 |
| `ISS-PIO-13` | FE dựng số kênh và dropdown mode từ capability; bỏ `VISIBLE_UI_CHANNELS` | F-PIO-008, F-PIO-009 | P1 | 2,0 |

**Tổng Đợt 3: 7,0 ngày-người.** Đây cũng là đợt hiện thực hoá lời hứa *capability-gated* của
phương án **A** mà chủ sở hữu đã chốt cho DI (§9.1).

**Ghi chú kỹ thuật:** `ISS-PIO-11` đổi layout SHM ⇒ **bắt buộc** bump magic để binary cũ fail rõ
thay vì đọc lệch trường trong im lặng (đúng tiền lệ `KX_SHM_MAGIC 0x4B584405` v5).

### 8.5 Đợt 4 — Canonical Point Model đủ trường + quản trị thay đổi

| Issue | Tiêu đề | Finding | Ưu tiên | Ước lượng |
|---|---|---|---|---|
| `ISS-PIO-37` | **RBAC / Audit / Revision cho cấu hình Point** — mọi thay đổi Physical/VP/Modbus config và Binding ghi `actor / time / old / new`; chống lost-update bằng revision hoặc ETag; lệnh test output giữ TTL + audit | F-PIO-011 | **P1** | 3,5 |
| `ISS-PIO-06` | `dataType` lấy từ cấu hình, không suy từ giá trị runtime; mở đường `UINT` cho MSV | F-PIO-005 | P1 | 2,0 |
| `ISS-PIO-07` | Bổ sung `description`, `enabled`, `equipment`, `sourceRef` vào `PointCatalogEntry` + bộ lọc theo thiết bị | F-PIO-006 | P1 | 2,0 |
| `ISS-PIO-08` | Mốc thời gian điểm LOCAL lấy từ producer (`plc_shm.ts_ns`), bỏ `time.Now()` | F-PIO-007 | P1 | 1,5 |
| `ISS-PIO-09` | Hàng Point hiện định danh theo nguồn (HR/FC cho Modbus, dải điện–kỹ thuật cho UI, RW·RETAIN cho VP) | F-PIO-026 | P2 | 1,0 |
| `ISS-PIO-10` | Bộ lọc Access + Status ở tab Ánh xạ | F-PIO-025 | P2 | 0,5 |

**Tổng Đợt 4: 10,5 ngày-người.**

### 8.6 Đợt 5 — Virtual Point đủ tính năng

| Issue | Tiêu đề | Finding | Ưu tiên | Ước lượng |
|---|---|---|---|---|
| `ISS-PIO-14` | Chính sách retain/persistence cho VP (Retain last / Initial) | F-PIO-015 | P1 | 2,0 |
| `ISS-PIO-15` | Giới hạn min/max kỹ thuật cho VP, chặn ghi ngoài dải ở API | F-PIO-016 | P1 | 1,5 |
| `ISS-PIO-16` | Phơi `source` (WEB/PROGRAM) lên FE kèm giải thích hệ quả | F-PIO-017 | P1 | 1,5 |
| `ISS-PIO-18` | `virtual-points/{id}/usage` quét cả binding Programming (`Kind = "program"`) | F-PIO-018 | P1 | 1,5 |
| `ISS-PIO-17` | Kiểu Multistate cho VP (danh sách state + label, ánh xạ `msv[]`) | F-PIO-014 | P2 | 3,0 |

**Tổng Đợt 5: 9,5 ngày-người.**

### 8.7 Đợt 6 — Modbus thành công dân hạng nhất

| Issue | Tiêu đề | Finding | Ưu tiên | Ước lượng |
|---|---|---|---|---|
| `ISS-PIO-19` | Cảnh báo cho điểm Modbus (`AlarmSourceKind` nhận `MB_RTU`) | F-PIO-023 | P1 | 2,0 |
| `ISS-PIO-20` | `PUT /points/{id}/config` nhận điểm Modbus (tag/tên/đơn vị/trend/equipment) | F-PIO-023 | P1 | 1,5 |
| `ISS-PIO-21` | Address Convention (protocol offset ↔ vendor 4xxxx), lưu địa chỉ protocol chuẩn hoá | F-PIO-020 | P1 | 2,0 |
| `ISS-PIO-22` | Poll group + poll interval + `stale_after` theo điểm | F-PIO-021 | P2 | 2,5 |
| `ISS-PIO-23` | Read-back verification tuỳ chọn cho điểm ghi được | F-PIO-022 | P2 | 2,0 |

**Tổng Đợt 6: 10,0 ngày-người.**

### 8.8 Đợt 7 — I/O vật lý còn lại và hồ sơ

| Issue | Tiêu đề | Finding | Ưu tiên | Ước lượng |
|---|---|---|---|---|
| `ISS-PIO-28` | `Check` kiểm phần đặc thù nguồn (device Modbus tồn tại, capability kênh, dải scaling) | F-PIO-028 | P1 | 3,0 |
| `ISS-PIO-29` | Commission Impact tách theo nguồn Physical/Virtual/Modbus + số output ghi được bị ảnh hưởng | F-PIO-027 | P1 | 2,0 |
| `ISS-PIO-24` | Deadband + clamp + chính sách giá trị khi lỗi cho UI | F-PIO-010 | P1 | 2,5 |
| `ISS-PIO-30` | Ghi vào hồ sơ: Modbus TCP ẩn có chủ ý (capability-gated), không phải mã chết | F-PIO-024 | P3 | 0,5 |

**Tổng Đợt 7: 8,0 ngày-người.**

### 8.9 Tổng hợp b2.0

| Đợt | Số issue | Ngày-người | Mở khoá điều gì |
|---|---|---|---|
| 1 | 8 | **24,5** | `MAP-01` PASS **và** binding giữ đúng nghĩa sau reboot/reconfiguration; có cổng V&V thật |
| 2 | 5 | 12,5 | Đổi cấu hình I/O vật lý an toàn; ma trận trạng thái output được ký |
| 3 | 3 | 7,0 | `PIO-01` PASS — capability thật từ MCU lên giao diện, hiện thực hoá phương án A cho DI |
| 4 | 6 | 10,5 | Canonical Point Model đủ trường + truy vết được mọi thay đổi |
| 5 | 5 | 9,5 | `VP-02`, `VP-03`, `VP-04` PASS |
| 6 | 5 | 10,0 | Modbus ngang hàng LOCAL/VP trong hệ Point |
| 7 | 4 | 8,0 | `PIO-03`, `PIO-06`, `PIO-07` PASS + cổng kiểm tra đủ |
| **Tổng** | **36** | **82,0** | |

> **Đối chiếu b1.0 → b2.1:** 30 → 36 issue, 54,5 → 82,0 ngày-người (b2.0 là 80,5;
> b2.1 thêm 1,5 cho ba AC ở `ISS-PIO-31`).
> Chênh lệch **26 ngày-người** là phần kiến trúc mà bảng cũ bỏ sót: định danh bền, authority
> compatibility, an toàn kích hoạt cấu hình, ma trận trạng thái output, hợp đồng quality
> có phiên bản, cổng V&V xuyên tầng, và quản trị thay đổi.
>
> **`ISS-PIO-05` không còn tồn tại độc lập** — đã được `ISS-PIO-35` bao trọn và mở rộng.


### 8.10 Truy vết issue trên repo — **ĐÃ TẠO 2026-08-31**

36 issue đã được tạo trên [`Mekong-HCM/MK-DDC-24`](https://github.com/Mekong-HCM/MK-DDC-24/issues),
dải **#375–#410**, nhãn `point-io` + `priority:*`.
Lọc nhanh: [`label:point-io`](https://github.com/Mekong-HCM/MK-DDC-24/issues?q=is%3Aissue+label%3Apoint-io).

**Phân công (chủ sở hữu, 2026-08-31):** 33 issue có phạm vi **FE hoặc BE** gán cho
[`@haizzdungnay`](https://github.com/haizzdungnay) (Dinh Tuan Duong).
Ba issue **không** gán vì nằm ngoài FE/BE:

| Issue | Repo | Vì sao không phải FE/BE |
|---|---|---|
| `ISS-PIO-34` | [#384](https://github.com/Mekong-HCM/MK-DDC-24/issues/384) | Ma trận trạng thái output — quyết định sản phẩm + `apps/core` (C++), phải **ký ma trận trước khi chạm mã** |
| `ISS-PIO-11` | [#388](https://github.com/Mekong-HCM/MK-DDC-24/issues/388) | `apps/iobus` + hợp đồng `contracts/shm` — đổi ABI, bump `KX_SHM_MAGIC` |
| `ISS-PIO-30` | [#410](https://github.com/Mekong-HCM/MK-DDC-24/issues/410) | Chỉ ghi hồ sơ, không có mã |

| Issue | Repo | Người thực hiện |
|---|---|---|
| **Đợt 1 — Nền định danh + authority** | | |
| `ISS-PIO-31` | [#375](https://github.com/Mekong-HCM/MK-DDC-24/issues/375) | `@haizzdungnay` |
| `ISS-PIO-32` | [#376](https://github.com/Mekong-HCM/MK-DDC-24/issues/376) | `@haizzdungnay` |
| `ISS-PIO-01` | [#377](https://github.com/Mekong-HCM/MK-DDC-24/issues/377) | `@haizzdungnay` |
| `ISS-PIO-02` | [#378](https://github.com/Mekong-HCM/MK-DDC-24/issues/378) | `@haizzdungnay` |
| `ISS-PIO-03` | [#379](https://github.com/Mekong-HCM/MK-DDC-24/issues/379) | `@haizzdungnay` |
| `ISS-PIO-04` | [#380](https://github.com/Mekong-HCM/MK-DDC-24/issues/380) | `@haizzdungnay` |
| `ISS-PIO-35` | [#381](https://github.com/Mekong-HCM/MK-DDC-24/issues/381) | `@haizzdungnay` |
| `ISS-PIO-36` | [#382](https://github.com/Mekong-HCM/MK-DDC-24/issues/382) | `@haizzdungnay` |
| **Đợt 2 — An toàn cấu hình & chính sách output** | | |
| `ISS-PIO-33` | [#383](https://github.com/Mekong-HCM/MK-DDC-24/issues/383) | `@haizzdungnay` |
| `ISS-PIO-34` | [#384](https://github.com/Mekong-HCM/MK-DDC-24/issues/384) | — (FW/policy/tài liệu) |
| `ISS-PIO-27` | [#385](https://github.com/Mekong-HCM/MK-DDC-24/issues/385) | `@haizzdungnay` |
| `ISS-PIO-26` | [#386](https://github.com/Mekong-HCM/MK-DDC-24/issues/386) | `@haizzdungnay` |
| `ISS-PIO-25` | [#387](https://github.com/Mekong-HCM/MK-DDC-24/issues/387) | `@haizzdungnay` |
| **Đợt 3 — Chuỗi capability** | | |
| `ISS-PIO-11` | [#388](https://github.com/Mekong-HCM/MK-DDC-24/issues/388) | — (FW/policy/tài liệu) |
| `ISS-PIO-12` | [#389](https://github.com/Mekong-HCM/MK-DDC-24/issues/389) | `@haizzdungnay` |
| `ISS-PIO-13` | [#390](https://github.com/Mekong-HCM/MK-DDC-24/issues/390) | `@haizzdungnay` |
| **Đợt 4 — Canonical model + quản trị thay đổi** | | |
| `ISS-PIO-37` | [#391](https://github.com/Mekong-HCM/MK-DDC-24/issues/391) | `@haizzdungnay` |
| `ISS-PIO-06` | [#392](https://github.com/Mekong-HCM/MK-DDC-24/issues/392) | `@haizzdungnay` |
| `ISS-PIO-07` | [#393](https://github.com/Mekong-HCM/MK-DDC-24/issues/393) | `@haizzdungnay` |
| `ISS-PIO-08` | [#394](https://github.com/Mekong-HCM/MK-DDC-24/issues/394) | `@haizzdungnay` |
| `ISS-PIO-09` | [#395](https://github.com/Mekong-HCM/MK-DDC-24/issues/395) | `@haizzdungnay` |
| `ISS-PIO-10` | [#396](https://github.com/Mekong-HCM/MK-DDC-24/issues/396) | `@haizzdungnay` |
| **Đợt 5 — Virtual Point** | | |
| `ISS-PIO-14` | [#397](https://github.com/Mekong-HCM/MK-DDC-24/issues/397) | `@haizzdungnay` |
| `ISS-PIO-15` | [#398](https://github.com/Mekong-HCM/MK-DDC-24/issues/398) | `@haizzdungnay` |
| `ISS-PIO-16` | [#399](https://github.com/Mekong-HCM/MK-DDC-24/issues/399) | `@haizzdungnay` |
| `ISS-PIO-18` | [#400](https://github.com/Mekong-HCM/MK-DDC-24/issues/400) | `@haizzdungnay` |
| `ISS-PIO-17` | [#401](https://github.com/Mekong-HCM/MK-DDC-24/issues/401) | `@haizzdungnay` |
| **Đợt 6 — Modbus hạng nhất** | | |
| `ISS-PIO-19` | [#402](https://github.com/Mekong-HCM/MK-DDC-24/issues/402) | `@haizzdungnay` |
| `ISS-PIO-20` | [#403](https://github.com/Mekong-HCM/MK-DDC-24/issues/403) | `@haizzdungnay` |
| `ISS-PIO-21` | [#404](https://github.com/Mekong-HCM/MK-DDC-24/issues/404) | `@haizzdungnay` |
| `ISS-PIO-22` | [#405](https://github.com/Mekong-HCM/MK-DDC-24/issues/405) | `@haizzdungnay` |
| `ISS-PIO-23` | [#406](https://github.com/Mekong-HCM/MK-DDC-24/issues/406) | `@haizzdungnay` |
| **Đợt 7 — I/O vật lý còn lại & hồ sơ** | | |
| `ISS-PIO-28` | [#407](https://github.com/Mekong-HCM/MK-DDC-24/issues/407) | `@haizzdungnay` |
| `ISS-PIO-29` | [#408](https://github.com/Mekong-HCM/MK-DDC-24/issues/408) | `@haizzdungnay` |
| `ISS-PIO-24` | [#409](https://github.com/Mekong-HCM/MK-DDC-24/issues/409) | `@haizzdungnay` |
| `ISS-PIO-30` | [#410](https://github.com/Mekong-HCM/MK-DDC-24/issues/410) | — (FW/policy/tài liệu) |

**Đường găng P0 với số thật:**

```text
#375 (ISS-PIO-31)  Stable Point Identity      ← phải ĐÓNG trước, kèm test
      ↓
#376 (ISS-PIO-32)  Compatibility authority
      ↓
#377 (ISS-PIO-01)  Expose runtime extIndex
      ↓
#378 / #379 (ISS-PIO-02/03)  Enable MB + VP mapping
      ↓
#381 (ISS-PIO-35)  Quality fail-closed
      ↓
#382 (ISS-PIO-36)  End-to-end V&V gate
```

`ISS-PIO-04` ([#380](https://github.com/Mekong-HCM/MK-DDC-24/issues/380)) không nằm trên đường găng — chạy song song được.

---

## 9. Ba quyết định của chủ sở hữu — **ĐÃ CHỐT 2026-08-31**

> b1.0 nêu ba câu hỏi. Chủ sở hữu đã phán quyết cả ba. Mục này ghi lại phán quyết,
> **không** còn là câu hỏi mở.

### 9.1 Phạm vi DI — **CHỐT: phương án A**

**Quyết định:** giữ base SKU không có DI riêng; DI là **optional SKU/module và capability-gated**.

Điều này giữ nguyên `ADR-010` và `DS_MK-DDC-24_VI` §103, đồng thời khớp với yêu cầu sản phẩm
rằng **tuỳ phiên bản DDC có thể có UI/UO/DI/DO**: cấu hình phần cứng khác nhau được phân giải
bằng **capability map**, không bằng mã viết cứng theo từng SKU.

**Hệ quả thi hành:** Đợt 3 (`ISS-PIO-11/12/13`) không còn là "cải thiện" mà là **điều kiện cần**
để phương án A có thật. Hiện `DS` §174 hứa *"chỉ tạo cho optional isolated-DI SKU khi capability
map xác nhận"* trong khi cơ chế xác nhận đó không tồn tại (`F-PIO-008`). Sau Đợt 3, khi một SKU
có DI xuất hiện, `IOP_BOARD_CAP_DI_8` sẽ tự mở đúng số kênh mà không phải sửa bốn nơi.

Không mở phương án B (thiết kế mạch cách ly mới) và không dùng phương án C
(dry-contact trên UI làm DI) — `IO_DI_CIRCUIT.md` cấm rõ phương án C.

### 9.2 Safe-state — **CHỐT: BÁC đề xuất b1.0, chờ `ISS-PIO-34`**

**Quyết định:** **không chấp thuận** câu *"mọi nguyên nhân đều dẫn tới cùng một trạng thái"*
cho tới khi có `ISS-PIO-34`. Phải **tách safety fault khỏi Program Disable bình thường**.

Phán quyết này đúng và đề xuất b1.0 sai ở một chỗ cụ thể: nó gộp một **sự cố** với một
**thao tác vận hành có chủ ý**. Tắt một chương trình để bảo trì không phải là hỏng hóc, và
ép output về hard Safe-State trong tình huống đó là hành vi sai — đúng ra phải **trả lại quyền
sở hữu** để mức ưu tiên thấp hơn (BMS, lịch, relinquish default) tiếp quản.

Ma trận `ISS-PIO-34` phải ký, trước khi chạm vào mã:

| Nguyên nhân | Bản chất | Hành vi đề xuất | Ghi chú |
|---|---|---|---|
| `Program Disable` | thao tác có chủ ý | **release ownership** → relinquish/default policy | Không phải safety event |
| `Program Fault` | sự cố phần mềm điều khiển | cần chốt: release hay hard safe | Phụ thuộc mức tin cậy còn lại của Core |
| `Controller/Core Fault` | sự cố hệ thống | **hard Safe-State** (giữ nguyên hiện tại) | Bất biến hội tụ 3 lớp MCU/iobus/core |
| `Communication Loss` | mất liên lạc | **hard Safe-State** (giữ nguyên hiện tại) | T1/T2/T3 hiện có |
| `Boot` | trạng thái khởi tạo | giá trị khởi động per-channel | Đề bài §10 đòi ô riêng |

Ba dòng giữa đã đúng trong mã hôm nay. Hai dòng cần công việc thật là `Program Disable` và
`Boot`. Bất biến **"ba lớp MCU/iobus/core hội tụ cùng một trạng thái an toàn"** phải được giữ
cho nhánh safety — `ISS-PIO-34` tách nhánh không-safety ra khỏi nó, chứ không nới lỏng nó.

### 9.3 Thuật ngữ `AO` / `UO` — **CHỐT: giữ `AO` trong hợp đồng, nhãn giao diện có thể là `UO`**

**Quyết định:** giữ `AO` xuyên suốt code / API / SHM để không phá contract; giao diện được
phép hiển thị **"UO — Universal Output"** nếu sản phẩm muốn.

**Hệ quả thi hành:** đây thuần tuý là lớp nhãn i18n, **không** đụng `io_config.conf`,
`BuildProfile`, `io_map`, `formatPointID`, hay bất kỳ binding nào đang chạy trên bo.
Gộp vào `ISS-PIO-09` (đợt 4) như một mục nhãn, không mở issue riêng.

---

## 10. Số đo kiểm chứng của phiên này

| Bộ | Lệnh | Kết quả | Thời gian |
|---|---|---|---|
| FE — Point + Modbus + chuẩn hoá API | `npx vitest --run --environment jsdom src/features/points src/features/modbus-rtu src/shared/api` | **33 tệp / 304 test PASS** | 6,14 s |
| FE — Ánh xạ Programming | `npx vitest --run --environment jsdom src/features/programming/design/mapping` | **4 tệp / 28 test PASS** | 3,45 s |
| Go — app + modbusrtu + points | `go test ./internal/app/... ./internal/modbusrtu/... ./internal/points/... -count=1` | **3/3 gói ok** | 32,9 s (`internal/app`) |

**Không dựng lại C++ trong phiên này** — không có số `ctest` nào được dẫn trong tài liệu này.

Điều đáng chú ý: **332 test đều xanh trong khi 7 finding Cao đang tồn tại**. Không bộ test
nào hiện có phủ được đường "tạo VP trên giao diện rồi map vào chương trình", "catalog vượt 500
mục", "điểm quality `unknown` hiển thị ra sao", hay "tắt một thiết bị Modbus rồi binding còn
trỏ đúng thanh ghi không".

Đây chính là lý do chủ sở hữu yêu cầu `ISS-PIO-36` (**Point/I/O E2E V&V Gate**) và đặt nó ở
**Đợt 1** thay vì cuối kế hoạch: một bộ test xanh không phủ lớp Point thì "xanh" không chứng
minh điều gì về lớp Point. Xem §8.2 cho 8 kịch bản bắt buộc.

---

## 11. Kết luận (b2.0)

Kiến trúc mà đề bài mô tả — ba nguồn Point hội tụ vào một Canonical Point Catalog rồi mới đi
vào Program — **đã tồn tại trong mã** và **đã được chủ sở hữu chấp thuận**: ba category
`LOCAL`/`VP`/`MB_RTU`, một authority duy nhất, bốn khái niệm tách bạch. Không redesign nền.

Nhưng b1.0 đọc sai **mức độ** của vấn đề. Bản đó kết luận "đường ống chưa thông" và đề nghị nối
lại trong 8,5 ngày-người. Chất vấn của chủ sở hữu về tính ổn định của `extIndex` đã dẫn tới
`F-PIO-029`, và finding đó đảo ngược thứ tự thi hành: **slot `ext` dịch chỗ mỗi khi kỹ sư đổi
tên một điểm, thêm một điểm, hoặc tắt một thiết bị** — ba thao tác vận hành thường ngày. Nối
đường ống mà không dựng định danh bền trước sẽ không chỉ để lại lỗi cũ, mà **tạo ra một lỗi mới
nặng hơn**: chương trình ghi lệnh vào một thanh ghi khác, hợp lệ theo mọi phép kiểm hiện có,
không một dòng cảnh báo.

Bốn điều b1.0 thiếu và b2.0 đã bổ sung, đều theo đúng chất vấn của chủ sở hữu:

1. **Định danh bền trước, nối đường sau** (`ISS-PIO-31`) — nếu không, `ISS-PIO-01` tự tạo lớp
   lỗi ghi sai I/O vật lý mà chính review này xác nhận là chưa tồn tại.
2. **Một authority cho compatibility** (`ISS-PIO-32`) — hôm nay FE và Backend cài cùng bộ luật
   hai lần, và chúng **đã** trôi khỏi nhau: FE báo "Core chưa hỗ trợ" cho năng lực Core đã có.
3. **Tách safety fault khỏi Program Disable** (`ISS-PIO-34`) — đề xuất "cùng một trạng thái"
   của b1.0 gộp một sự cố với một thao tác có chủ ý.
4. **Cổng V&V xuyên tầng ở Đợt 1** (`ISS-PIO-36`) — 332 test xanh hiện không chứng minh gì
   về lớp Point.

Kế hoạch b2.1: **36 issue / 7 đợt / 82,0 ngày-người**. Đợt 1 (8 issue, 24,5 ngày-người) đưa
`MAP-01` từ FAIL sang PASS **và** bảo đảm binding giữ đúng nghĩa sau reboot hoặc thay đổi cấu
hình — hai điều phải đi cùng nhau, không được tách.

b2.1 khoá điều đó thành hợp đồng chứ không còn là ý định: `AC-PIO-ID-01` cấm coi `extIndex` là
danh tính, `AC-PIO-ID-02` thay một phép kiểm **dải** bằng một phép kiểm **danh tính** trước
Commission, `AC-PIO-ID-03` cấm tự remap binding cũ và bắt test cả seam 0-based/1-based —
seam mà **chưa từng chạy với dữ liệu thật lần nào**. Thứ tự P0 đã khoá ở §8.1.2:
`ISS-PIO-31` phải đóng, kèm test qua năm thao tác cấu hình, trước khi `ISS-PIO-01/02` được code.

---

## 12. Nhật ký phán quyết

| Bản | Ngày | Nội dung |
|---|---|---|
| b1.0 | 2026-08-31 | Review lần đầu. 28 finding (6 Cao), 30 issue / 6 đợt / 54,5 ngày-người. Ba câu hỏi mở cho chủ sở hữu. Trạng thái: CHỜ DUYỆT. |
| b2.0 | 2026-08-31 | **Chủ sở hữu phán quyết: APPROVE ARCHITECTURE / NOT APPROVE IMPLEMENTATION PLAN YET.** Kiến trúc và phần lớn finding được chấp thuận; bảng issue bị trả lại vì thiếu các vấn đề kiến trúc. Thay đổi trong bản này: (1) bổ sung `F-PIO-029` — slot `ext` không ổn định, xác minh bằng `persistence.go:260/289/327` + `bus_worker.cpp:83`, nâng số finding Cao lên 7; (2) bổ sung `ISS-PIO-31…37`; (3) mở rộng scope `ISS-PIO-03` (allocator VP đủ collision/reuse/persistence), `ISS-PIO-04` (cursor ổn định tất định), và thay `ISS-PIO-05` bằng `ISS-PIO-35` (hợp đồng quality có phiên bản, fail-closed); (4) dựng lại Đợt 1 gồm cả stable identity + compatibility authority + cổng V&V; (5) ghi ba quyết định Owner ở §9 — DI phương án **A**, `AO` giữ trong hợp đồng với nhãn `UO` tuỳ chọn, safe-state **bác** đề xuất b1.0 chờ `ISS-PIO-34`; (6) đảo ngược khuyến nghị của b1.0 ở `F-PIO-012`. |

| b2.1 | 2026-08-31 | **Chủ sở hữu: APPROVED b2.0 WITH 3 ACCEPTANCE CRITERIA ⇒ được phép tạo issue trên repo.** Chấp thuận hướng kiến trúc, thứ tự ưu tiên, và cả ba quyết định ở §9. Thay đổi trong bản này: (1) ghi `AC-PIO-ID-01` (`extIndex` không phải identity), `AC-PIO-ID-02` (referential integrity `pointId → extIndex → bus/device/register/datatype/access`, lệch fingerprint/revision ⇒ **BLOCK Commission**), `AC-PIO-ID-03` (migration binding legacy, không chứng minh được identity ⇒ giữ LKG + rebind, **không tự remap**) vào `ISS-PIO-31` §8.1.1 — **không mở issue mới** theo yêu cầu giữ bảng gọn; (2) bổ sung bảy kịch bản V&V `5a…5g` vào `ISS-PIO-36` (rename/add/disable điểm, disable device, reorder, đổi register-datatype-access, migration legacy, quy ước 0-based↔1-based); (3) khoá thứ tự P0 ở §8.1.2 kèm ràng buộc **cấm code `ISS-PIO-01/02` trước khi `ISS-PIO-31` đóng**; (4) bổ sung vào `F-PIO-029` bằng chứng seam base index — `iobus` 0-based (`modbus_master.cpp:25`) vs artifact 1-based (`st_io_map.cpp:112`, `st_process_image.cpp:24-30`), **không có producer bắc cầu**, đường này chưa từng chạy với dữ liệu thật; (5) `ISS-PIO-31` 4,0 → 5,5 ngày-người, Đợt 1 23,0 → 24,5, tổng 80,5 → 82,0. |

| b2.2 | 2026-08-31 | **Đã tạo 36 issue trên repo** (#375–#410, nhãn `point-io` + `priority:*`) theo đúng uỷ quyền của chủ sở hữu ở b2.1. Bảng truy vết `ISS-PIO-NN → #số` ở §8.10, kèm đường găng P0 với số issue thật. Cross-reference giữa các issue phụ thuộc đã trỏ bằng số thật (#375 chặn #377/#378/#379; bằng chứng đóng ở #382). Không đổi nội dung finding hay ước lượng. |

| b2.3 | 2026-08-31 | **Phân công theo chỉ đạo chủ sở hữu**: 33 issue có phạm vi FE hoặc BE gán cho `@haizzdungnay` (Dinh Tuan Duong). Ba issue không gán vì ngoài FE/BE — #384 (`ISS-PIO-34`, ma trận trạng thái output: quyết định sản phẩm + `apps/core` C++), #388 (`ISS-PIO-11`, `apps/iobus` + hợp đồng SHM, đổi ABI), #410 (`ISS-PIO-30`, chỉ ghi hồ sơ). Bảng §8.10 đổi cột *Ghi chú* thành *Người thực hiện*. |

### 12.1 Điều review này đã sai ở b1.0

Ghi lại để không lặp: b1.0 kiểm `extIndex` **có tồn tại không** và dừng ở đó, không hỏi tiếp
**nó có ổn định không**. Với một trường sẽ được ghi vào Binding rồi Commission xuống thiết bị
điều khiển, hai câu hỏi đó không tương đương — và câu thứ hai mới là câu quyết định.
Cùng lỗi ấy suýt lặp ở `ISS-PIO-03` (cấp phát slot VP) và `ISS-PIO-04` (phân trang):
cả hai đều là bài toán định danh bền được b1.0 mô tả như bài toán "thêm một trường".
