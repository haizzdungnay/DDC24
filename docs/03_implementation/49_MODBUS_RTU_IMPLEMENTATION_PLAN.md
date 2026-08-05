# 49 — Modbus RTU Implementation Plan (FE + BE + FW-SOM)

> **Document ID:** PLAN-MBRTU-IMPL-001
> **Phiên bản:** 0.2 | 2026-08-04
> **Trạng thái:** **Track A APPROVED và ĐANG TRIỂN KHAI** (PM/CTO 2026-08-04);
> Track B `CONDITIONAL`, chưa được bắt đầu. Xem
> [Biên bản phê duyệt](../07_records/reviews/MODBUS_RTU_APPROVAL_RECORD_2026-08-04.md)
> và tiến độ ở §10.
> **Owner đề xuất:** Fieldbus Lead (FW-SOM) · SOM Backend Lead (BE) · FE Lead (FE)
> **Target:** board production **Foxlinx SOM-DDC-24** (`SOM-DDC-24-foxlinx`, MCU
> STM32 thật) là nơi nghiệm thu; board lab Orange Pi 5B chỉ dùng cho regression
> nhanh. Xem §4.
> **Đọc cùng:** [Code Review 2026-08-04](../07_records/reviews/MODBUS_RTU_CODE_REVIEW_2026-08-04.md) ·
> [Khảo sát UART board production](../07_records/test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md) ·
> [Docs Sync Report](../07_records/reviews/MODBUS_RTU_DOCS_SYNC_REPORT.md) ·
> [Open Decisions](../00_governance/MODBUS_RTU_OPEN_DECISIONS.md)
>
> **Số hiệu 48 đã bị `PLAN_FIX_DEBUG_AND_BOARD_DEPLOY.md` sử dụng**; plan này dùng 49.

---

## 1. Chiến lược: hai track tách biệt

Phát hiện quan trọng nhất của lần review: **không phải mọi việc đều bị chặn bởi
ADR-024.** Có một nhóm defect đang gây rủi ro thật trên board, sửa được mà không
đụng tới contract, không đổi ABI và không cần quyết định Product.

| Track | Nội dung | Điều kiện bắt đầu | Đổi contract? |
|---|---|---|---|
| **Track A — Vá an toàn** | 8 defect ở review §2 | **Không chờ gì cả** — chỉ cần PM duyệt plan này | Không |
| **Track B — Contract v2** | Redesign theo bộ thiết kế mới | ADR-024 Accepted + 5 OD P0 được ký | Có, ABI + REST |

Track A không tạo nợ kỹ thuật cho Track B: mọi thứ sửa ở Track A đều nằm trong
phần logic mà Track B giữ lại (codec, scheduler, metrics, FE presentation).

**Không làm Track B trước Track A.** Lý do: Track B mất 6–9 tuần; để board chạy
với D-01/D-03 suốt thời gian đó là không chấp nhận được.

---

## 2. Cổng vào (Entry gate)

| Cổng | Điều kiện | Chặn track nào |
|---|---|---|
| G-A | PM duyệt Plan 49 | Track A | ✅ **ĐÓNG 2026-08-04** |
| G-B1 | `OD-MBRTU-001` quyết định số bus RS485 thật | Track B toàn bộ |
| G-B2 | ADR-024 `Proposed → Accepted` | Track B toàn bộ |
| G-B3 | `OD-MBRTU-002/005/009/015` được ký | Track B giai đoạn tương ứng |
| G-B4 | `OD-MBRTU-016` (quality 5 mức), `R-03` (poll theo Point) đóng | B2, B3 |
| G-C | Có slave RS485 thật + thiết bị đo (`OD-MBRTU-EXT-02`) | Giai đoạn nghiệm thu |
| G-D | Xác định cơ chế điều khiển hướng RS-485 (auto / RTS / GPIO) | B101, B403 |

`OD-MBRTU-001` là cổng cứng nhất: **không viết một dòng code hai-bus nào trước
khi biết phần cứng có mấy đường RS485.**

### 2.1 Bằng chứng mới thu được trên board production (2026-08-04)

Khảo sát read-only trên `SOM-DDC-24-foxlinx`
([evidence](../07_records/test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md))
đã thu hẹp đáng kể `OD-MBRTU-001`:

| Quan sát | Hệ quả cho plan |
|---|---|
| Chỉ **2 UART** enable trong device tree: `ttyS2` (MCU IOP, đang có traffic) và `ttyS5` (rảnh) | Với provisioning hiện tại chỉ chạy được **một** Modbus master. `G-B1` nghiêng mạnh về phương án một bus. |
| 6 UART khác của SoC ở trạng thái `disabled` | Về SoC có thể mở thêm, nhưng phải có transceiver RS-485 thật — câu hỏi cho phần cứng |
| **Không có cấu hình `rs485-*` nào trong device tree** | Điều khiển hướng truyền half-duplex chưa được thiết lập ⇒ sinh ra cổng mới **G-D** |
| Source không gọi `modbus_rtu_set_serial_mode()` | Đang ngầm giả định transceiver auto-direction; giả định chưa kiểm chứng |
| Board là **Forlinx OK1126B-S / RV1126B**, không phải Radxa CM3/RK3566 như `PRODUCT.md` | Ngoài phạm vi Modbus; cần finding riêng cho Product/HW |
| FE mặc định `/dev/ttyS3` — **không tồn tại** trên board này | Defect nhỏ, gộp vào MBR-A506 |

---

## 2b. Chiến lược board: dùng board nào cho việc gì

| Board | Vai trò trong plan này | Dùng cho |
|---|---|---|
| **Foxlinx SOM-DDC-24** (`SOM-DDC-24-foxlinx`, port 2223, MCU STM32 thật) | **Board nghiệm thu chính** | Toàn bộ `TC-MBRTU-T-*` và `TC-MBRTU-H-*`; đo tài nguyên; kiểm tra không chặn IOP với MCU thật; nghiệm thu RS-485 vật lý |
| **Orange Pi 5B** (`SOM-DDC-24`, port 2222, fake MCU) | Board regression nhanh | Smoke test sau mỗi task; kiểm thử tình huống fake MCU; **không** dùng để đóng gate nào |

**Quy tắc:** mọi gate có chữ "target" hoặc "HIL" chỉ được đóng bằng evidence trên
**Foxlinx**. Kết quả trên Orange Pi là supporting evidence, phải ghi rõ board trong
mọi record.

**Lưu ý vận hành khi deploy lên Foxlinx:**

- Board đang chạy `root` + password. Deploy hàng ngày nên qua user riêng + key —
  xem khuyến nghị hardening trong
  [Runbook §2a](27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md).
- Đây là board **có MCU thật**: restart `mkddc-iobus` làm gián đoạn IOP thật, không
  phải fake. Mọi task chạm tới service phải làm trong cửa sổ bảo trì đã thoả thuận.
- Backup `/data/config` trước mỗi lần deploy (lệnh có sẵn trong runbook §2a).

---

## 3. TRACK A — Vá an toàn (không chờ quyết định)

**Mục tiêu:** loại bỏ khả năng ghi giá trị sai xuống thiết bị hiện trường và
loại bỏ báo động giả trên UI. **Ước lượng: 13,25 người-ngày** (đã gồm A0) — con số duy nhất, chốt theo phê duyệt PM 2026-08-04.

### A0 · Khảo sát phần cứng và baseline board production — 2 ngày

Làm **trước tiên**, vì kết quả có thể đổi phạm vi Track B.

| Task | Nội dung |
|---|---|
| MBR-A001 | ✅ **ĐÃ XONG 2026-08-04** — khảo sát read-only UART/DT trên Foxlinx; kết quả tại [evidence](../07_records/test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md) |
| MBR-A002 | Đối chiếu schematic bo Foxlinx SOM-DDC-24: có mấy transceiver RS-485, nối UART nào, chân điều khiển hướng là gì → **đóng `G-B1` và `G-D`** |
| MBR-A003 | Xác minh `ttyS5` có thực sự ra chân A/B của connector RS-485 (đo bằng đồng hồ hoặc loopback) |
| MBR-A004 | Deploy baseline hiện tại lên Foxlinx và ghi nhận điểm xuất phát: service, tài nguyên, jitter IOP với **MCU thật** |
| MBR-A005 | Nếu cần: bật `rs485-*` trong device tree hoặc xác nhận transceiver auto-direction |

**MBR-A002 là task có giá trị đòn bẩy cao nhất trong toàn plan** — nó đóng cổng
chặn cứng `G-B1` mà mọi thứ ở Track B đang chờ, và chỉ cần đọc một bản vẽ.

### A1 · FW-SOM · Chặn encode ngoài dải và `scale = 0` — 2 ngày

| Task | Nội dung | File |
|---|---|---|
| MBR-A101 | `encode_register` kiểm `isfinite(raw)` và biên kiểu đích **trước** ép kiểu; ngoài dải ⇒ `return false` | `register_codec.cpp` |
| MBR-A102 | `scale == 0` hoặc không finite ⇒ `return false` thay vì ghi 0 | `register_codec.cpp` |
| MBR-A103 | `load_device_profile` thêm luật `scale != 0 && isfinite(scale)`; vi phạm ⇒ skip point + ERROR | `device_profile.cpp` |
| MBR-A104 | Test: mỗi kiểu × {dưới biên, trên biên, NaN, +Inf, −Inf, scale=0} ⇒ `false` | `tests/test_register_codec.cpp` |

**Acceptance:** không tổ hợp đầu vào nào của `encode_register` dẫn tới ép kiểu UB;
`flush_pending` bỏ request và log ERROR khi encode thất bại. Đóng **D-01, D-02**.

### A2 · FW-SOM · Giới hạn vòng đời write, chấm dứt replay — 2 ngày

| Task | Nội dung | File |
|---|---|---|
| MBR-A201 | Thêm `attempts` và `expires_at_ms` vào `PendingWrite` | `modbus_master.hpp` |
| MBR-A202 | `flush_pending` tăng `attempts`; vượt `max_write_attempts` (mặc định 3) hoặc quá hạn ⇒ bỏ request, log ERROR có `slave/fc/addr/value` | `modbus_master.cpp` |
| MBR-A203 | Thêm counter `write_failed` / `write_dropped` vào metrics và publish qua diagnostics | `fieldbus_metrics.*`, `modbus_rtu.go` |
| MBR-A204 | Test: write fail 3 lần ⇒ request biến mất; slave online lại **không** ghi lại giá trị cũ | `tests/test_modbus_master_fake.cpp` |

**Acceptance:** không có đường nào để một write cũ được phát sau khi thiết bị
reconnect. Đóng **D-03**. Đây là bước chuẩn bị trực tiếp cho write-result ở Track B.

### A3 · FW-SOM · Sửa lịch poll khi thiết bị lỗi — 2 ngày

| Task | Nội dung | File |
|---|---|---|
| MBR-A301 | `on_poll_error` cập nhật `last_poll_ms` | `poll_scheduler.cpp` |
| MBR-A302 | Thêm `offline_probe_ms` vào `Rs485Config` (mặc định 5000); `is_due`/`next_due_ms` dùng giá trị này khi `online == false` | `fieldbus_config.*`, `poll_scheduler.*` |
| MBR-A303 | `poll_once` duyệt slave theo deadline sớm nhất thay vì theo index | `modbus_master.cpp` |
| MBR-A304 | Test: 1 slave chết + 1 slave tốt ⇒ slave tốt vẫn đạt deadline; slave chết được thử ở nhịp probe | `tests/test_poll_scheduler.cpp` |

**Acceptance:** với 8 slave chết và 1 slave tốt `poll_ms=1000`, slave tốt trượt
deadline < 10% số vòng. Đóng **D-04**.

### A4 · Toàn stack · Thống nhất ngữ nghĩa "retry" — 1,5 ngày

**Quyết định cần PM chọn — xem Q-04 ở báo cáo.** Hai phương án loại trừ nhau:

- **Phương án 1 (rẻ, 0,5 ngày):** đổi nhãn. FE `Retry` → `Số lỗi trước khi OFFLINE`;
  API giữ tên `retry_count` nhưng mô tả lại; bỏ cột "Retry" trùng lặp khỏi bảng
  diagnostics.
- **Phương án 2 (đúng kỳ vọng người dùng, 1,5 ngày):** implement retry thật —
  `read_slave` phát lại chính block lỗi tối đa `retry` lần trước khi tính là lỗi
  poll; `retry_attempts` đếm số lần phát lại thật.

| Task | Nội dung |
|---|---|
| MBR-A401 | Thực hiện phương án được chọn ở `read_slave` hoặc ở FE/API |
| MBR-A402 | `retry_attempts` phải khác `total_errors` (hoặc bỏ cột) |
| MBR-A403 | Test khẳng định hai counter không đồng nhất |

Đóng **D-05, D-06**.

### A5 · FE · Không suy diễn, không báo động giả — 2 ngày

| Task | Nội dung | File |
|---|---|---|
| MBR-A501 | Bỏ biểu thức suy diễn quality ở bảng diagnostics; hiển thị `connection_status` từ API, thiếu ⇒ `—` | `ModbusRtuPage.tsx` |
| MBR-A502 | `runtimeQuality[id] ?? 'bad'` → `?? null` và render `—` | `ModbusRtuPage.tsx` |
| MBR-A503 | Thêm dialog xác nhận cho xoá Device/Point, nêu đích danh đối tượng và số Point bị ảnh hưởng | `ModbusRtuPage.tsx` |
| MBR-A504 | Hạ `ROUTE_MIN_ROLE['/eng/modbus-rtu']` xuống `viewer`; disable mọi control mutation kèm lý do quyền | `roles.ts`, `ModbusRtuPage.tsx` |
| MBR-A505 | Test: telemetry vắng ⇒ `—` chứ không `BAD`/`0`; Viewer xem được nhưng không mutate được; xoá cần xác nhận | `ModbusRtuPage.test.tsx` |
| MBR-A506 | Bỏ mặc định `/dev/ttyS3` (không tồn tại trên board production); để trống và bắt người dùng chọn từ danh sách cổng hợp lệ | `ModbusRtuPage.tsx` |

**Acceptance:** không ô nào trên trang hiển thị trạng thái không do server cấp.
Đóng **D-07, D-08**, và mở khoá `PR-MBRTU-001` cho Viewer.

> MBR-A504 phụ thuộc `OD-MBRTU-009` **chỉ ở phần "có thêm vai trò Engineer hay
> không"**. Việc hạ route xuống `viewer` không cần chờ — server đã chặn mutation.

### A6 · FW-SOM · Dọn nợ nhỏ — 1 ngày

| Task | Nội dung |
|---|---|
| MBR-A601 | `push_snapshot` dùng `offsetof(kx_ext_snapshot_msg_t, points)` + `static_assert` (D-11) |
| MBR-A602 | E303 dùng cửa sổ trượt thay vì tỷ lệ tích luỹ; bỏ latch vĩnh viễn (D-12) |
| MBR-A603 | Point chưa có mẫu publish `online=0` để BE map thành trạng thái "chưa khởi tạo" thay vì STALE-giá-trị-0 (D-10) |

### Cổng ra Track A

```text
Host:
  ctest --test-dir build/fw (Modbus+BACnet+HMI ON)   → PASS, không skip
  go vet ./... && go test ./... -count=1             → PASS
  npx vitest --run --environment jsdom src           → PASS
  npm run lint && npm run build                      → PASS

Board Foxlinx (SOM-DDC-24-foxlinx, MCU STM32 thật) — bắt buộc:
  T-A1  ghi giá trị ngoài dải bị TỪ CHỐI, không có byte nào lên dây
  T-A2  slave chết không làm slave tốt trượt deadline (đo qua log poll)
  T-A3  UI không hiện BAD/0 khi mất telemetry
  T-A4  jitter IOP với MCU thật không xấu đi so với baseline A004
  T-A5  restart mkddc-iobus: không có write cũ nào được phát lại
```

Số đo phải ghi kèm: board, commit, thời điểm, và lệnh đã chạy. Kết quả trên
Orange Pi **không** thay thế được các mục T-A1..T-A5.

---

## 4. TRACK B — Contract v2 và tính năng mới

**Chỉ bắt đầu sau G-B1..G-B4.** Thứ tự bắt buộc: contract trước, FW-SOM trước BE,
BE trước FE. **Ước lượng: 40–51 người-ngày**, chưa gồm nghiệm thu phần cứng.

### B0 · Contract — nền của mọi thứ còn lại — 4–5 ngày

Phải xong và freeze trước khi ba team làm song song.

| Task | Nội dung | Owner |
|---|---|---|
| MBR-B001 | Định nghĩa `kx_ext_snapshot_v2_t` trong `contracts/shm/`: magic mới, `schema_version`, `sequence`, `generation`, `config_revision/checksum`, `producer_boot_id`, sample typed `double` + `quality` 5 mức + `quality_reason` + `sample_mono_ns/utc_ms` | Fieldbus + Core |
| MBR-B002 | Định nghĩa schema IPC control (`ApplyConfig`/`ACK`, `WriteRequest`/`WriteResult`, `Commission*`) trong `contracts/config/` | Core + BE |
| MBR-B003 | Cập nhật `contracts/openapi/openapi.yaml` theo `ICD-API-MBRTU-001` | BE |
| MBR-B004 | Test cross-language so khớp field canonical ↔ OpenAPI ↔ TS ↔ C++; lệch ⇒ fail | QA |
| MBR-B005 | `static_assert` layout + test negative version mismatch | Fieldbus |

**Rủi ro:** đây là ABI change đồng bộ 3 binary. Bắt buộc có kịch bản deploy lệch
version trong nghiệm thu (`OD-MBRTU-015`).

### B1 · FW-SOM — 12–15 ngày

| Task | Nội dung | Phụ thuộc |
|---|---|---|
| MBR-B101 | Tách `BusWorker` khỏi `ModbusMaster`; một worker một bus, một thread | B0, `OD-MBRTU-001` |
| MBR-B102 | Vòng đời worker `CLOSED→OPENING→RUNNING→DRAINING→SWAPPING`, backoff khi `PORT_ERROR` | B101 |
| MBR-B103 | Quality 5 mức + 10 reason code ở producer; timestamp sample thật (mono + utc) | B0 |
| MBR-B104 | Publish snapshot v2 có `sequence`/`generation`/`revision` | B0, B103 |
| MBR-B105 | Kênh control UDS SOCK_STREAM: `ApplyConfig`/`ACK`, peer credential, bounded frame | B0 |
| MBR-B106 | Config reload tại ranh giới giữa hai transaction; lỗi ⇒ giữ generation cũ | B102, B105 |
| MBR-B107 | Write request/result có `request_id`, deadline, readback tuỳ chọn; hàng đợi bounded | B105, **A2** |
| MBR-B108 | Commissioning: test-connection / read / write ad-hoc | B105 |
| MBR-B109 | Gộp block đọc liền kề; `bit_index` nếu `OD-MBRTU-003` duyệt | B101 |
| MBR-B110 | Counter uint64 + `producer_boot_id` + `counters_since` | B0 |
| MBR-B111 | Bộ test theo `VVP-MBRTU-001 §TW-MBRTU-01..17` | tất cả |

### B2 · BE — 10–13 ngày

| Task | Nội dung | Phụ thuộc |
|---|---|---|
| MBR-B201 | Tách `validate.go` thuần khỏi handler; đủ mã lỗi ổn định | B0 |
| MBR-B202 | Bus thành entity; serial format thuộc Bus, Device kế thừa read-only | `OD-MBRTU-002` |
| MBR-B203 | Candidate store bền vững + diff + `operation_id` idempotency | B201 |
| MBR-B204 | Transaction apply: stage → journal → gửi iobus → ACK → commit; reconcile sau crash | B105, B203 |
| MBR-B205 | `base_revision`/`If-Match` optimistic concurrency | B203 |
| MBR-B206 | Canonical JSON + checksum ổn định (bỏ `map[string]any` không thứ tự) | B201 |
| MBR-B207 | Admission control tải bus (ngưỡng theo `OD-MBRTU-006`) | B201 |
| MBR-B208 | Commissioning proxy + rate limit + audit đầy đủ (actor/target/old/new/correlation) | B108 |
| MBR-B209 | Import/export CSV + JSON, all-or-nothing vào candidate | B203, `OD-MBRTU-012` |
| MBR-B210 | Endpoint mới: `/config*`, `/buses`, `/mapping`, `/overview`, `/events`, `/devices/{id}/enabled`, `/devices/{id}/test-connection` | B0 |
| MBR-B211 | Allowlist `rs485_port` theo capability manifest; bỏ chuỗi tự do | `OD-MBRTU-001` |
| MBR-B212 | Bỏ `dispatchReload(reloadRestartIobus)` khỏi đường CRUD | B204 |
| MBR-B213 | Bộ test `TB-MBRTU-01..15` | tất cả |

### B3 · FE — 8–10 ngày

| Task | Nội dung | Phụ thuộc |
|---|---|---|
| MBR-B301 | Tách feature thành 5 page + layout + tab | — |
| MBR-B302 | `useModbusConfig` với 3 nguồn state tách bạch; `ConfigStateBanner` | B210 |
| MBR-B303 | Vòng đời candidate: save → dirty → apply → clean; khoá mutation khi `APPLYING` | B204 |
| MBR-B304 | `RegisterPreview` (footprint + overlap + quy đổi mẫu) dùng chung với import | B201 |
| MBR-B305 | Overview + BusCard + event feed | B210 |
| MBR-B306 | Mapping page, chặn lưu khi còn lỗi | B210 |
| MBR-B307 | Test connection / read test / write test 2 bước | B208 |
| MBR-B308 | Import preview + export | B209 |
| MBR-B309 | Diagnostics đầy đủ field, `unknown` khi thiếu | B110 |
| MBR-B310 | `useModbusRuntime` qua WS, reconnect lấy snapshot trước delta | B0 |
| MBR-B311 | Bộ test `TF-MBRTU-01..12` | tất cả |

### B4 · Nghiệm thu — 6–8 ngày + phụ thuộc phần cứng

| Task | Nội dung | Cổng |
|---|---|---|
| MBR-B401 | `TC-MBRTU-S-01..12` trên simulator hai bus | — |
| MBR-B402 | `TC-MBRTU-T-01..09` trên board | — |
| MBR-B403 | `TC-MBRTU-H-01..15` với slave RS485 thật | **G-C** |
| MBR-B404 | Soak 24 h + reboot ×10 + cắt nguồn ×10 | G-C |
| MBR-B405 | Cập nhật `VERIFICATION.md`, `TRACEABILITY.md`, chuyển tài liệu sang `Active` | tất cả |

---

## 5. Phân vai trò

### 5.1 Mã vai trò

| Mã | Vai trò | Kỹ năng | Số người đề xuất |
|---|---|---|---|
| `FW` | Fieldbus/FW-SOM Developer | C++17, libmodbus, RS-485, đa luồng, IPC Unix | 1 (Track A) → 1–2 (Track B) |
| `BE` | SOM Backend Developer | Go, transaction/journal, REST, RBAC | 1 |
| `FE` | Frontend Developer | React 18, TypeScript, Vitest | 1 |
| `ARCH` | System/Software Architect | contract ABI/IPC, quyết định kiến trúc | 0,5 (part-time) |
| `QA` | QA/Verification Engineer | test spec, simulator, nghiệm thu target/HIL | 0,5 → 1 (giai đoạn B4) |
| `TL` | Tech Lead | review, gác cổng, ký kết quả | 0,25 (part-time) |

**Nhân sự tối thiểu để chạy Track A:** 1 `FW` + 1 `FE` + 0,25 `TL` — làm song song
được, xong trong ~2 tuần lịch.
**Nhân sự để chạy Track B đúng đường găng:** 2 `FW` + 1 `BE` + 1 `FE` + 0,5 `ARCH`
+ 1 `QA` + 0,25 `TL`.

> `FW` và `QA` hiện **chưa có tên người** — đây là `OD-MBRTU-EXT-01`/Q-06. Mọi
> ngày công dưới đây là ước lượng chưa chốt cho tới khi có owner.

### 5.2 Ma trận RACI theo giai đoạn

`R` = làm · `A` = chịu trách nhiệm cuối · `C` = được hỏi ý kiến · `I` = được thông báo

| Giai đoạn | FW | BE | FE | ARCH | QA | TL | PM/CTO |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| A1 Encode an toàn | **R/A** | I | I | C | C | A | I |
| A2 Vòng đời write | **R/A** | C | I | C | C | A | I |
| A3 Lịch poll | **R/A** | I | I | C | C | A | I |
| A4 Ngữ nghĩa retry | R | R | R | C | C | A | **C** (chọn phương án) |
| A5 FE không suy diễn | I | C | **R/A** | I | C | A | I |
| A6 Dọn nợ nhỏ | **R/A** | I | I | C | I | A | I |
| B0 Contract | R | R | C | **R/A** | C | A | **C** (Q-02) |
| B1 FW-SOM | **R/A** | C | I | C | C | A | I |
| B2 BE | C | **R/A** | C | C | C | A | I |
| B3 FE | I | C | **R/A** | I | C | A | I |
| B4 Nghiệm thu | C | C | C | C | **R/A** | A | **I** |
| Quyết định Q-01..Q-09 | C | C | C | C | C | C | **R/A** |

Điểm cần chú ý: **PM/CTO là `R/A` cho toàn bộ 9 câu hỏi.** Kỹ thuật chỉ khuyến
nghị, không tự quyết — đó là lý do Track B chưa khởi động được.

---

## 6. Bảng task tổng hợp

68 task. Cột `Sau` là task phải xong trước. `—` nghĩa là không phụ thuộc task nào
(chỉ phụ thuộc cổng của giai đoạn).

### 6.1 Track A — 29 task, 13,25 người-ngày

| ID | Task | Vai trò | Ngày | Sau | Cổng | Đóng |
|---|---|:--:|--:|---|---|---|
| MBR-A001 | Khảo sát UART/DT board production — **XONG** | FW | 0,25 | — | — | — |
| MBR-A002 | Đối chiếu schematic: số transceiver RS-485, UART nào, chân điều hướng | FW+HW | 0,5 | A001 | **mở G-B1, G-D** | — |
| MBR-A003 | Xác minh `ttyS5` ra chân A/B connector | FW+HW | 0,5 | A002 | — | — |
| MBR-A004 | Deploy baseline lên Foxlinx, ghi điểm xuất phát (service/tài nguyên/jitter IOP với MCU thật) | FW | 0,5 | — | — | — |
| MBR-A005 | Bật `rs485-*` trong DT hoặc xác nhận auto-direction | FW | 0,25 | A002 | G-D | — |
| MBR-A101 | Kiểm `isfinite` + biên kiểu trước ép kiểu trong `encode_register` | FW | 0,75 | — | G-A | D-01 |
| MBR-A102 | `scale=0`/không finite ⇒ `return false` | FW | 0,25 | — | G-A | D-02 |
| MBR-A103 | Validator profile thêm luật `scale != 0` | FW | 0,5 | — | G-A | D-02 |
| MBR-A104 | Test encode âm tính: mỗi kiểu × {dưới/trên biên, NaN, ±Inf, scale=0} | FW | 0,5 | A101–A103 | G-A | — |
| MBR-A201 | Thêm `attempts`, `expires_at_ms` vào `PendingWrite` | FW | 0,25 | — | G-A | D-03 |
| MBR-A202 | Hết attempt/deadline ⇒ bỏ request + log ERROR | FW | 0,75 | A201 | G-A | D-03 |
| MBR-A203 | Counter `write_failed`/`write_dropped` + publish diagnostics | FW+BE | 0,5 | A202 | G-A | — |
| MBR-A204 | Test: fail 3 lần ⇒ request biến mất; reconnect không ghi lại | FW | 0,5 | A202 | G-A | — |
| MBR-A301 | `on_poll_error` cập nhật `last_poll_ms` | FW | 0,25 | — | G-A | D-04 |
| MBR-A302 | `offline_probe_ms` trong `Rs485Config`; dùng khi `online=false` | FW | 0,75 | A301 | G-A | D-04 |
| MBR-A303 | `poll_once` duyệt theo deadline sớm nhất thay vì index | FW | 0,5 | A302 | G-A | D-04 |
| MBR-A304 | Test: 1 slave chết không làm slave tốt trượt deadline | FW | 0,5 | A303 | G-A | — |
| MBR-A401 | Thực hiện phương án retry được PM chọn | FW/FE | 1,0 | **Q-04** | G-A | D-05 |
| MBR-A402 | `retry_attempts` khác `total_errors`, hoặc bỏ cột | FW+FE | 0,25 | A401 | G-A | D-06 |
| MBR-A403 | Test khẳng định hai counter không đồng nhất | FW | 0,25 | A402 | G-A | — |
| MBR-A501 | Bỏ suy diễn quality ở bảng diagnostics; thiếu ⇒ `—` | FE | 0,5 | — | G-A | D-07 |
| MBR-A502 | `?? 'bad'` → `?? null`, render `—` | FE | 0,25 | — | G-A | D-07 |
| MBR-A503 | Dialog xác nhận xoá Device/Point | FE | 0,5 | — | G-A | D-08 |
| MBR-A504 | Hạ route xuống `viewer`; disable mutation kèm lý do quyền | FE | 0,25 | — | G-A | — |
| MBR-A505 | Test FE: telemetry vắng, quyền Viewer, xác nhận xoá | FE | 0,5 | A501–A504 | G-A | — |
| MBR-A506 | Bỏ mặc định `/dev/ttyS3` không tồn tại; chọn từ danh sách cổng hợp lệ | FE | 0,25 | — | G-A | — |
| MBR-A601 | `push_snapshot` dùng `offsetof` + `static_assert` | FW | 0,25 | — | G-A | D-11 |
| MBR-A602 | E303 cửa sổ trượt, bỏ latch vĩnh viễn | FW | 0,5 | — | G-A | D-12 |
| MBR-A603 | Point chưa có mẫu publish `online=0` | FW | 0,25 | — | G-A | D-10 |

**Tải theo vai trò ở Track A:** `FW` 10,0 ngày · `FE` 2,5 ngày · `HW` 0,5 ngày
(hỗ trợ đọc schematic) · dùng chung 0,25.

### 6.2 Track B — 45 task, 40–51 người-ngày

| ID | Task | Vai trò | Ngày | Sau | Cổng |
|---|---|:--:|--:|---|---|
| MBR-B001 | Định nghĩa `kx_ext_snapshot_v2_t` | ARCH+FW | 1,5 | — | G-B2, G-B4 |
| MBR-B002 | Schema IPC control (`ApplyConfig`/`ACK`/`Write*`/`Commission*`) | ARCH+BE | 1,0 | — | G-B2 |
| MBR-B003 | Cập nhật `openapi.yaml` theo `ICD-API-MBRTU-001` | BE | 1,0 | B002 | G-B2 |
| MBR-B004 | Test cross-language so khớp field 4 lớp | QA | 1,0 | B001–B003 | G-B2 |
| MBR-B005 | `static_assert` layout + test negative version mismatch | FW | 0,5 | B001 | G-B2 |
| MBR-B101 | Tách `BusWorker` khỏi `ModbusMaster`, 1 worker/1 bus/1 thread | FW | 3,0 | B001 | **G-B1** |
| MBR-B102 | Vòng đời worker + backoff `PORT_ERROR` | FW | 1,5 | B101 | G-B1 |
| MBR-B103 | Quality 5 mức + 10 reason code + timestamp sample thật | FW | 2,0 | B001 | G-B4 |
| MBR-B104 | Publish snapshot v2 có `sequence`/`generation`/`revision` | FW | 1,0 | B103 | — |
| MBR-B105 | Kênh control UDS stream + peer credential + bounded frame | FW | 2,0 | B002 | — |
| MBR-B106 | Reload tại ranh giới transaction; lỗi giữ generation cũ | FW | 1,5 | B102, B105 | — |
| MBR-B107 | Write request/result + readback + queue bounded | FW | 2,0 | B105, **A2** | G-B3 (Q-05 ưu tiên) |
| MBR-B108 | Commissioning ad-hoc: test-connection / read / write | FW | 1,5 | B105 | — |
| MBR-B109 | Gộp block đọc liền kề; `bit_index` nếu duyệt | FW | 1,5 | B101 | `OD-MBRTU-003` |
| MBR-B110 | Counter uint64 + `producer_boot_id` + `counters_since` | FW | 0,5 | B001 | — |
| MBR-B111 | Bộ test `TW-MBRTU-01..17` | FW+QA | 3,0 | B101–B110 | — |
| MBR-B201 | Tách `validate.go` thuần + mã lỗi ổn định | BE | 2,0 | B002 | — |
| MBR-B202 | Bus thành entity; serial thuộc Bus, Device kế thừa | BE | 1,0 | B201 | `OD-MBRTU-002` |
| MBR-B203 | Candidate store bền vững + diff + `operation_id` | BE | 2,0 | B201 | — |
| MBR-B204 | Transaction apply stage→journal→ACK→commit + reconcile crash | BE | 3,0 | B203, B105 | — |
| MBR-B205 | `base_revision`/`If-Match` optimistic concurrency | BE | 0,5 | B203 | — |
| MBR-B206 | Canonical JSON + checksum ổn định | BE | 1,0 | B201 | — |
| MBR-B207 | Admission control tải bus | BE | 1,5 | B201 | `OD-MBRTU-006` |
| MBR-B208 | Commissioning proxy + rate limit + audit đầy đủ | BE | 2,0 | B108, B203 | Q-07 |
| MBR-B209 | Import/export CSV + JSON all-or-nothing | BE | 2,0 | B203 | Q-08 |
| MBR-B210 | 7 nhóm endpoint mới | BE | 2,5 | B203, B204 | — |
| MBR-B211 | Allowlist `rs485_port` theo capability manifest | BE | 1,0 | B202 | **G-B1** |
| MBR-B212 | Bỏ `restart-iobus` khỏi đường CRUD | BE | 0,5 | B204 | — |
| MBR-B213 | Bộ test `TB-MBRTU-01..15` | BE+QA | 3,0 | B201–B212 | — |
| MBR-B301 | Tách feature thành 5 page + layout + tab | FE | 1,5 | — | — |
| MBR-B302 | `useModbusConfig` 3 nguồn state + `ConfigStateBanner` | FE | 1,5 | B210 | — |
| MBR-B303 | Vòng đời candidate + khoá mutation khi `APPLYING` | FE | 1,5 | B302, B204 | — |
| MBR-B304 | `RegisterPreview` dùng chung với import | FE | 1,0 | B301 | — |
| MBR-B305 | Overview + BusCard + event feed | FE | 1,0 | B210 | — |
| MBR-B306 | Mapping page, chặn lưu khi còn lỗi | FE | 1,0 | B210 | — |
| MBR-B307 | Test connection / read test / write test 2 bước | FE | 1,5 | B208 | Q-07 |
| MBR-B308 | Import preview + export | FE | 1,0 | B209 | Q-08 |
| MBR-B309 | Diagnostics đầy đủ field, `unknown` khi thiếu | FE | 1,0 | B110, B210 | — |
| MBR-B310 | `useModbusRuntime` qua WS, reconnect lấy snapshot trước delta | FE | 1,0 | B104 | — |
| MBR-B311 | Bộ test `TF-MBRTU-01..12` | FE+QA | 2,0 | B301–B310 | — |
| MBR-B401 | `TC-MBRTU-S-01..12` trên simulator | QA | 2,5 | B111, B213, B311 | — |
| MBR-B402 | `TC-MBRTU-T-01..09` trên **Foxlinx** (MCU thật): deploy, provenance, restart, reboot, không chặn IOP | QA+FW | 2,0 | B401 | — |
| MBR-B403 | `TC-MBRTU-H-01..15` với slave RS485 thật trên **Foxlinx** | QA+FW | 2,5 | B402 | **G-C / G-D / Q-05** |
| MBR-B404 | Soak 24 h + reboot ×10 + cắt nguồn ×10 trên **Foxlinx** | QA | 1,5 | B403 | G-C |
| MBR-B405 | Cập nhật VERIFICATION/TRACEABILITY; chuyển tài liệu sang `Active` | TL+QA | 1,0 | B404 | — |

**Tải theo vai trò ở Track B:** `FW` ~21 ngày · `BE` ~22 ngày · `FE` ~14 ngày ·
`QA` ~13 ngày · `ARCH` ~2,5 ngày · `TL` ~1 ngày.

---

## 7. Sơ đồ tiến độ

### 7.1 Swimlane theo vai trò (đơn vị: tuần lịch)

```text
          T1   T2   T3   T4   T5   T6   T7   T8   T9  T10  T11  T12  T13
        ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
HW      │A002│                                                           │  ← đọc schematic
        │A003│                                                           │     mở G-B1 + G-D
        │              │    │                                            │
ARCH    │              │B0██│                                            │
        │              │    │                                            │
FW      │A0██│A1██│A2██│B0▓▓│B101████│B102██│B103██│B105██│B106│B107██│  │
        │    │A3██│A4▓▓│    │        │      │B109██│      │B108│B111███│ │
        │    │A6██│    │    │        │      │      │B110│ │    │       │ │
        │              │    │                                            │
BE      │              │B0▓▓│B201████│B203██│B206│B207██│B204████│B210██│ │
        │              │    │        │      │B202│      │B205│B211│B212│ │
        │              │    │        │      │    │      │B208██│B209██│  │
        │              │    │        │      │    │      │      │B213███│ │
        │              │    │        │      │    │      │      │       │ │
FE      │A5██│A5██│    │    │B301██│ │B304██│      │B302██│B303██│B305██│ │
        │    │    │    │    │      │ │      │      │B306██│B309██│B310██│ │
        │    │    │    │    │      │ │      │      │      │B307██│B308██│ │
        │    │    │    │    │      │ │      │      │      │      │B311██│ │
        │              │    │                                            │
QA      │              │B004│                              │B401████│B402│
        │              │    │                              │B403*│B404│  │
        │              │    │                              │B405 │     │  │
        └──────────────┴────┴────────────────────────────────────────────┘
         ├── TRACK A ──────┤├─ chờ ─┤├────────── TRACK B ────────────────┤
                             Q-01/Q-02
         └─ nghiệm thu Foxlinx ─┘              └─ nghiệm thu Foxlinx ─────┘

██ = thực hiện   ▓▓ = tham gia cùng vai trò khác   * = treo chờ thiết bị thật (Q-05)
```

**Đọc sơ đồ:** Track A (tuần 1–3) chỉ cần `FW` + `FE` + `HW` hỗ trợ nửa ngày,
chạy được **ngay**. `A002` (đọc schematic) nằm ở tuần 1 vì nó mở khoá `G-B1` —
nếu xong sớm thì khoảng chờ ở tuần 4 biến mất và tổng lịch rút xuống ~12 tuần.

**Cả hai đầu của lịch đều kết thúc bằng nghiệm thu trên Foxlinx:** cuối Track A
xác nhận các bản vá an toàn chạy đúng trên board có MCU thật; cuối Track B là
nghiệm thu đầy đủ với RS-485 vật lý.

### 7.2 Đồ thị phụ thuộc — đường găng

```text
        ┌─────────┐
        │  Q-01   │ số cổng RS485 ── CỔNG CHẶN CỨNG
        │  Q-02   │ đổi ABI
        └────┬────┘
             ▼
        ┌─────────┐
        │   B0    │ contract v2            ◄── freeze trước khi 3 team tách nhánh
        └────┬────┘
             ├──────────────┬───────────────┐
             ▼              ▼               ▼
        ┌─────────┐   ┌──────────┐   ┌───────────┐
        │  B101   │   │   B201   │   │   B301    │  ← FE/BE khởi động sớm được
        │BusWorker│   │validator │   │ tách page │     (không chờ FW)
        └────┬────┘   └────┬─────┘   └─────┬─────┘
             ▼             │               │
        ┌─────────┐        │               │
        │  B105   │────────┤               │
        │control  │        ▼               │
        └────┬────┘   ┌──────────┐         │
             │        │   B204   │         │
             │        │  apply   │         │
             ▼        └────┬─────┘         │
        ┌─────────┐        ├───────────────┤
        │  B107   │        ▼               ▼
        │  write  │   ┌──────────┐   ┌───────────┐
        └────┬────┘   │   B210   │──▶│   B303    │
             │        │ endpoint │   │ candidate │
             └────────┴────┬─────┘   └─────┬─────┘
                           ▼               │
                      ┌──────────┐         │
                      │   B401   │◄────────┘
                      │simulator │
                      └────┬─────┘
                           ▼
                      ┌──────────┐
                      │   B403   │ ◄── TREO nếu chưa có thiết bị thật (Q-05)
                      │ RS485 HIL│
                      └────┬─────┘
                           ▼
                      ┌──────────┐
                      │ B404/405 │
                      └──────────┘

ĐƯỜNG GĂNG: Q-01 → B0 → B101 → B105 → B204 → B303 → B401 → B403 → B405
            ≈ 10 tuần lịch sau khi câu hỏi được trả lời
```

### 7.3 Mốc kiểm soát

| Mốc | Thời điểm | Điều kiện đạt | Người ký |
|---|---|---|---|
| M0 — Đóng G-B1/G-D | cuối T1 | A002/A003 xong: biết chắc số transceiver RS-485 và cơ chế điều hướng | TL + HW |
| M1 — Track A xong | cuối T3 | 12 defect đóng; 4 bộ gate PASS; nghiệm thu **trên Foxlinx** 3 kịch bản | TL |
| M2 — Contract freeze | cuối T4 | B0 xong; test cross-language PASS; không đổi contract sau mốc này | ARCH + TL |
| M3 — FW-SOM xong | cuối T9 | B111 PASS; hai bus cách ly được kiểm chứng trên simulator | TL |
| M4 — BE xong | cuối T11 | B213 PASS; crash-recovery apply kiểm chứng | TL |
| M5 — FE xong | cuối T13 | B311 PASS; luồng Engineer và Viewer chạy end-to-end | TL |
| M6 — Nghiệm thu simulator | +1 tuần sau M5 | B401, B402 PASS | QA |
| M7 — Nghiệm thu phần cứng | phụ thuộc Q-05 | B403, B404 PASS | QA + TL |
| M8 — `MODBUS_RTU_POINT_READY = YES` | sau M7 | VR-MBRTU-001..014 đủ evidence | TL + CTO |

**M1 không phụ thuộc bất kỳ câu hỏi nào ngoài Q-04** (và Q-04 chỉ ảnh hưởng 1 task).
M2 trở đi phụ thuộc Q-01/Q-02.

---

## 8. Rủi ro

| Rủi ro | Mức | Kiểm soát |
|---|---|---|
| `OD-MBRTU-001` quyết định "một bus" sau khi đã code hai bus | Cao | **Không bắt đầu B101 trước G-B1.** Đây là lý do B1 nằm sau cổng cứng |
| ABI v1→v2 deploy lệch giữa 3 binary | Cao | Magic mới + reject rõ; đóng gói một package; nghiệm thu kịch bản lệch version (MBR-B005) |
| Không có slave RS485 thật đúng hạn | Cao | B4 tách riêng; A và B1–B3 vẫn đóng được bằng simulator; ghi rõ B403 là gate treo |
| Track A tạo xung đột merge với Track B | Trung bình | Track A không đụng contract; B giữ nguyên module A đã sửa |
| Ước lượng lệch do chưa có Fieldbus Lead | Trung bình | Ước lượng là **khoảng**, chốt lại sau khi có owner (`OD-MBRTU-EXT-01`) |
| Restart iobus trong lúc vận hành (D-09) còn tồn tại suốt Track A | Trung bình | Ghi vào runbook: không sửa cấu hình Modbus trong giờ vận hành cho tới khi B212 xong |

## 7. Definition of Done

**Track A:**

```text
[ ] D-01..D-08, D-10..D-12 đóng bằng source + test
[ ] 4 bộ gate (ctest / go / vitest / lint+build) PASS, số đo thật
[ ] Nghiệm thu board: 3 kịch bản ở cổng ra §3
[ ] CHANGELOG + Code Review report cập nhật trạng thái từng finding
```

**Track B:**

```text
[ ] MBR-B001..B405 hoàn tất
[ ] VR-MBRTU-001..014 có evidence được review
[ ] 12 tài liệu Modbus RTU chuyển In Review → Active
[ ] MODBUS_RTU_POINT_READY = YES
```

## 10. Tiến độ thực hiện

**Cập nhật:** 2026-08-04 · **Nhánh:** `feat/modbus-rtu-track-a`

### 10.1 Track A — 12/14 defect đã đóng bằng source + test

| Nhóm | Task | Trạng thái | Defect đóng | Commit |
|---|---|---|---|---|
| A0 | MBR-A001 khảo sát UART/DT board production | ✅ XONG | — | `05c6b0c` |
| A0 | MBR-A002/A003 đọc schematic, xác minh chân A/B | ⏳ **CHỜ HARDWARE** | — | — |
| A0 | MBR-A004 deploy baseline lên Foxlinx | ⏳ chờ cửa sổ bảo trì | — | — |
| A0 | MBR-A005 bật `rs485-*` / xác nhận auto-direction | ⏳ phụ thuộc A002 | — | — |
| A1 | MBR-A101..A104 chặn encode ngoài dải, `scale=0` | ✅ XONG | D-01, D-02 | `1e3e2bc` |
| A2 | MBR-A201..A204 vòng đời write, chấm dứt replay | ✅ XONG | D-03 | `a6fba4c` |
| A3 | MBR-A301..A304 lịch poll, offline probe, EDF | ✅ XONG | D-04 | `c4036dd` |
| A4 | MBR-A401..A403 retry thật, tách ngưỡng offline | ✅ XONG | D-05, D-06 | `0f0fe71` |
| A5 | MBR-A501..A506 FE quality/xác nhận xoá/viewer/ttyS3 | ✅ XONG | D-07, D-08, D-14 | `dfef8ab` |
| A6 | MBR-A601..A603 offsetof, E303 cửa sổ trượt, point chưa init | ✅ XONG | D-10, D-11, D-12 | `9168cba` |

**Còn lại của Track A:** `D-09` (mỗi CRUD restart iobus) và `D-13` (không set chế
độ RS-485) — cả hai **có chủ đích** không nằm trong Track A: D-09 gắn với
transaction apply của Track B (MBR-B212), D-13 chờ Hardware trả lời Q-10.

### 10.2 Số đo kiểm chứng (host, 2026-08-04)

| Gate | Kết quả |
|---|---|
| `ctest --test-dir build/fw` (Modbus+BACnet+HMI ON) | **769/769 PASS** (trước Track A: 759) |
| `go vet ./...` + `go test ./... -count=1` | **PASS**, 11 package có test đều `ok` |
| `npx vitest --run --environment jsdom src` | **304/304 PASS**, 35 file (trước: 3 FAIL) |
| `npm run lint` | **PASS**, 0 warning |
| `npm run build` | **PASS** |

Test mới thêm trong Track A: **19** (8 encode guard, 3 vòng đời write, 4 offline
probe, 3 config retry/probe, 1 E303 re-arm) cộng 4 test FE Modbus và 1 test
round-trip giờ địa phương.

### 10.3 Nghiệm thu trên board Foxlinx — ĐÃ CHẠY 2026-08-05

Board xác nhận đang chạy **fake MCU** (`mkddc-fakemcu` active, IOP mở
`/tmp/mkddc-iop-a`), nên restart `mkddc-iobus` không gián đoạn I/O thật và cửa sổ
bảo trì không còn là điều kiện chặn.

| Kịch bản | Kết quả | Cách kiểm chứng |
|---|---|---|
| T-A1 ghi ngoài dải bị từ chối | **PASS** | `iobus_tests` aarch64 chạy trên chính board |
| T-A2 slave chết không bỏ đói slave tốt | **PASS** | như trên |
| T-A3 thiếu telemetry không bị bịa | **PARTIAL** | producer + API PASS trên board; FE chưa kiểm trên browser |
| T-A4 không hồi quy jitter IOP | **PASS** | A/B binary mới vs cũ trong cùng điều kiện |
| T-A5 restart không phát lại write cũ | **PASS** | `ModbusMasterWriteLifecycle.*` trên board |

Số đo chính:

- `iobus_tests` aarch64 trên board, **trong lúc service production đang chạy**:
  **208 PASS / 6 SKIP / 0 FAIL**. Sáu skip đều là `IoCache.*` (cần độc quyền SHM
  production), không kịch bản Track A nào bị skip. Riêng nhóm Track A: **23/23 PASS**.
- Jitter IOP A/B cùng điều kiện: binary mới **15,36–15,65 µs** (overrun +10…+12/phút)
  so với binary cũ **18,15–20,10 µs** (+8…+17). Không hồi quy.
- Sau deploy: **0 ERROR**, `NRestarts=0`, IOP lên đúng
  `INIT → OPEN_UART → HANDSHAKE → NORMAL_POLL`, bốn service còn lại vẫn active.

Chi tiết, giới hạn và số liệu thô:
[evidence 2026-08-05](../07_records/test-evidence/fw-som/2026-08-05-foxlinx-track-a-acceptance.md).

**Giới hạn phải đọc cùng kết quả:** board chạy fake MCU và **không có
`fieldbus.conf`**, nên fieldbus thread không được tạo và code Modbus không chạy
dòng nào ở trạng thái hiện tại. Hồ sơ chứng minh code đúng trên
kiến trúc/kernel/libmodbus của target, **không** chứng minh RS-485 vật lý.
`VR-MBRTU-011` vẫn RED.

```text
TRACK_A_BOARD_ACCEPTANCE = PASS WITH LIMITS
```

### 10.4 Việc ngoài phạm vi đã xử lý cùng phiên

`TrendsPage`: nhãn bộ chọn thời gian đã đổi sang giờ địa phương (BL-008) nhưng
phần tính toán vẫn dùng UTC, làm người dùng UTC+7 truy vấn lệch 7 tiếng. Đã sửa
phần tính toán cho khớp nhãn và cho nhãn lấy tên múi giờ thật của trình duyệt
(`b67580c`). Cùng dạng lỗi "nhãn nói một đằng, code làm một nẻo" với D-05.

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-04 | Tạo plan hai track; Track A không chờ quyết định, Track B sau cổng ADR-024 |
| 0.2 | 2026-08-04 | Đổi số 48→49 (48 đã bị `PLAN_FIX_DEBUG_AND_BOARD_DEPLOY.md` dùng); thêm bảng task 74 mục, ma trận RACI, swimlane và đồ thị phụ thuộc; bổ sung nhóm A0 khảo sát phần cứng; chốt board Foxlinx là target nghiệm thu; **sửa lỗi cộng: Track B là 40–51 ngày, bản 0.1 ghi sai 34–45** |
| 0.3 | 2026-08-04 | Track A được PM/CTO duyệt và triển khai: 6/6 nhóm code xong, 12/14 defect đóng, 769/769 ctest · 304/304 vitest · Go PASS. Thêm §10 tiến độ. Chốt một mức ước lượng duy nhất (Track A 13,25 người-ngày) theo yêu cầu PM |
