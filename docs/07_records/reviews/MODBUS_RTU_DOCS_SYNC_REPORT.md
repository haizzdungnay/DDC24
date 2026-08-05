# Modbus RTU — Docs Sync Report

**ID:** DDC24-MBRTU-DOCS-SYNC-2026-08-05 (bản 2.0; bản 1.0 = `…-2026-08-04`)
**Ngày:** 2026-08-05, múi giờ Asia/Ho_Chi_Minh
**Repository:** `Mekong-HCM/MK-DDC-24`
**Nhánh/commit tại thời điểm audit:** `feat/modbus-rtu-track-a` / `eade4e5`
**Baseline lần đồng bộ trước:** `agent/rst205-closure` / `554b861` (2026-08-04)
**Phạm vi:** Modbus RTU, RS485, Modbus RTU Device, Modbus RTU Point,
đọc/ghi/giám sát/diagnostics
**Ngoài phạm vi:** Modbus TCP, BACnet/IP, Programming ST/FBD, sửa source

> Đây là **record** của một lần đồng bộ tài liệu. Nó không phải Design, không phê
> duyệt thiết kế và **không thay đổi bất kỳ source nào trong phiên này**.

---

## 1. Vì sao có bản 2.0

Bản 1.0 được viết tại `554b861`. Sau đó có **13 commit**, trong đó **7 commit sửa
source Modbus RTU** (Track A) và **2 commit là quyết định/tiến độ**. Bộ 12 tài liệu
tạo ngày 2026-08-04 **chưa hề được cập nhật** theo ba sự kiện lớn:

| Sự kiện | Ảnh hưởng lên tài liệu |
|---|---|
| **Phê duyệt PM/CTO 2026-08-04** — 11 quyết định Đ-01..Đ-11 | Bộ 12 tài liệu vẫn mô tả **hai bus** và **bốn vai trò**, trái với Đ-01 và Đ-04 đã ký |
| **Track A hoàn tất phần code** — 12/14 defect đóng | Mọi bảng gap trong 12 tài liệu vẫn liệt kê các defect **đã sửa** như thể còn tồn tại |
| **Nghiệm thu board Foxlinx 2026-08-05** | Chưa tài liệu verification nào ghi nhận |

Biên bản phê duyệt §5 liệt kê "Đồng bộ tài liệu theo §3.1" là **việc còn chặn
Track B**, giao Engineering. **Phiên này thực hiện đúng việc đó**, cộng thêm một
vòng đối chiếu source đầy đủ.

---

## 2. Việc đã làm

Đối chiếu đồng thời: Product Spec, requirements, architecture, interfaces,
verification, traceability, decision log, document control; source FE
(`apps/web-ui`), BE (`apps/web-api`), FW-SOM (`apps/iobus`, `apps/core`); contract
(`contracts/shm/mkddc_shm.h`, `contracts/openapi/openapi.yaml`); cấu hình/persistence;
biên bản phê duyệt PM/CTO; Plan 49; và evidence nghiệm thu board 2026-08-05.

**Không chạy test trong phiên này** vì nhiệm vụ là tài liệu và cấm sửa source. Số đo
dẫn trong báo cáo này là **trích dẫn có nguồn** từ Track A và từ evidence board, kèm
giới hạn hiệu lực; chúng **không** được dùng làm bằng chứng mới cho bất kỳ gate nào.

---

## 3. Tài liệu đã cập nhật trong phiên này

### 3.1 Bộ 12 tài liệu Modbus RTU

| # | Tài liệu | ID | Bản | Thay đổi chính |
|---|---|---|---|---|
| 1 | `01_product/MODBUS_RTU_PRODUCT_REQUIREMENTS.md` | PROD-MBRTU-001 | 0.1→**0.2** | Rev A một bus; ba vai trò; import/export bắt buộc; §7 liệt kê 4 yêu cầu chưa đáp ứng |
| 2 | `04_uiux/MODBUS_RTU_UI_UX_DESIGN.md` | UX-WEB-MBRTU-001 | 0.1→**0.2** | Bỏ wireframe hai bus; nhãn "Retry"→"Số lần phát lại"; ma trận quyền 4→3 vai trò; đóng G-UX-08/09 |
| 3 | `02_design/software/MODBUS_RTU_FE_DESIGN.md` | DDD-FE-MBRTU-001 | 0.1→**0.2** | Đóng F-FE-03/04/05/11; thêm F-FE-14/15; gắn TF-MBRTU với 6 test thật |
| 4 | `02_design/software/MODBUS_RTU_BE_DESIGN.md` | DDD-BE-MBRTU-001 | 0.1→**0.2** | Đóng F-BE-16; hạ F-BE-07/08/14; **thêm F-BE-19/20/21** |
| 5 | `02_design/software/MODBUS_RTU_FW_SOM_DESIGN.md` | DDD-FW-MBRTU-001 | 0.1→**0.2** | Một BusWorker; §4.1a tách retry/offline; vòng đời write hữu hạn; 7 nhóm gap đóng; thêm F-FW-17..20 |
| 6 | `02_design/software/MODBUS_RTU_DATA_MODEL.md` | DDD-DM-MBRTU-001 | 0.1→**0.2** | Bus 1 instance; `offline_after_errors` mới; `direction_control` mới; capacity ≥256; luật encode fail-closed |
| 7 | `02_design/interfaces/MODBUS_RTU_API_SPEC.md` | ICD-API-MBRTU-001 | 0.1→**0.2** | Liệt kê đủ 9 route As-Built + quyền thật; thêm F-API-13/14 |
| 8 | `02_design/interfaces/MODBUS_RTU_INTERFACE_SPEC.md` | ICD-IF-MBRTU-001 | 0.1→**0.2** | Sơ đồ nét đứt cho bus 2; hạ F-IF-05/09; thêm F-IF-10/11 |
| 9 | `05_verification/MODBUS_RTU_VERIFICATION_PLAN.md` | VVP-MBRTU-001 | 0.1→**0.2** | Hoãn S-10/H-06; thêm H-16; §10 số đo host + kết quả board + giới hạn |
| 10 | `07_records/MODBUS_RTU_TRACEABILITY_MATRIX.md` | TRACE-MBRTU-001 | 1.0→**1.1** | Nâng SYS-001/SWR-004 lên PARTIAL; hạ NFR-001 xuống RED |
| 11 | `00_governance/MODBUS_RTU_OPEN_DECISIONS.md` | OD-MBRTU-SET-001 | 1.0→**1.1** | Đóng 6 OD; thêm OD-017/018/019/EXT-04; §5 bảng tổng hợp |
| 12 | `07_records/reviews/MODBUS_RTU_DOCS_SYNC_REPORT.md` | tài liệu này | 1.0→**2.0** | — |

### 3.2 Tài liệu chung và plan

| Tài liệu | Thay đổi |
|---|---|
| `04_design/SOFTWARE.md` | Đóng P0 blocker "hai master" bằng Đ-01; ghi blocker HW còn lại (điều hướng RS-485); ghi Track A đã đổi As-Built |
| `04_design/INTERFACES.md` | **Ghi nhận lệch contract**: OpenAPI mô tả sai ngữ nghĩa `retry` sau Đ-05 → `OD-MBRTU-018` |
| `05_verification/VERIFICATION.md` | VR-MBRTU-001/002/004/011 cập nhật theo Đ-01/Đ-06/Đ-07/Đ-08; VR-004 RED→PARTIAL |
| `07_records/TRACEABILITY.md` | SYS-REQ-MBRTU-001 RED→PARTIAL; ghi Track A vào SWR-001..009 |
| `00_governance/CONTROL.md` | Register cập nhật số bản 0.2/1.1/2.0; đăng ký biên bản phê duyệt và Plan 49; ghi **ngoại lệ authority** cho Track A |
| `03_implementation/49_MODBUS_RTU_IMPLEMENTATION_PLAN.md` | **Sửa lỗi đánh số mục** (hai mục cùng số 7, không có §9); thêm §10.4 ba gap mới |
| `CHANGELOG.md` | Entry `[Unreleased]` |

`PRODUCT.md`, `REQUIREMENTS.md` và `DECISIONS.md` **đã** được đồng bộ Đ-01/Đ-04/Đ-07
ở commit `05c6b0c` — phiên này kiểm tra lại và xác nhận đúng, không sửa thêm.

---

## 4. Kết quả audit hiện trạng tại `eade4e5`

### 4.1 Phần đã có và hoạt động

| Hạng mục | Bằng chứng source | Mới sau Track A? |
|---|---|---|
| Modbus RTU master một bus qua libmodbus | `modbus_master.cpp` | — |
| Codec 6 kiểu dữ liệu × 4 thứ tự byte/word | `register_codec.*` | — |
| **Encode fail-closed**: `scale=0`, NaN/±Inf, ngoài dải kiểu ⇒ từ chối, không ghi byte nào | `register_codec.cpp`, 8 test âm tính | ✅ **mới** (D-01/D-02) |
| **Vòng đời write hữu hạn**: 3 lần phát hoặc TTL 30 s ⇒ bỏ + log + `write_dropped` | `modbus_master.cpp`, 3 test | ✅ **mới** (D-03) |
| **Scheduler EDF + offline probe**: device chết không bỏ đói device sống | `poll_scheduler.cpp`, `modbus_master.cpp`, 4 test | ✅ **mới** (D-04) |
| **Retry thật**: phát lại đúng block lỗi; `retry_attempts ≠ total_errors`; ngưỡng OFFLINE tách riêng | `read_slave()`, `fieldbus_config.hpp`, `domain.go` | ✅ **mới** (D-05/D-06) |
| **E303 cửa sổ trượt**, hết latch vĩnh viễn | `fieldbus_metrics.*` | ✅ **mới** (D-12) |
| Fail-closed khi thiếu profile/hết slot (không báo ONLINE giả) | `modbus_master.cpp` `slave_config_error_` | — |
| Device/Point CRUD + validate + tag namespace | `domain.go` | — |
| Persist `fieldbus.conf` + profile + revision + checksum + rollback | `persistence.go` | — |
| REST 9 endpoint + RBAC route | `http.go` | — |
| **FE: Viewer xem được, control mutation disable kèm lý do** | `roles.ts`, `ModbusRtuPage.tsx` | ✅ **mới** (D-07) |
| **FE: xoá phải xác nhận**, dialog nêu đích danh và số Point ảnh hưởng | `ModbusRtuPage.tsx` | ✅ **mới** (D-08) |
| **FE: thiếu dữ liệu hiện `—`**, không bịa `BAD`/`STALE` | `deviceLinkLabel()`, `NO_DATA` | ✅ **mới** (D-07) |
| **FE: không mặc định cổng serial không tồn tại** | `emptyDevice.rs485_port = ''` | ✅ **mới** (D-14) |

### 4.2 Có source nhưng **chưa nối end-to-end** — phát hiện mới

| Hạng mục | Vì sao chưa nối | Mã |
|---|---|---|
| `offline_after_errors` | `fieldbus_config.cpp` **đọc được** từ `fieldbus.conf`, nhưng `Persister.Apply` **không bao giờ ghi** field này vào map `slaves` ⇒ luôn ở mặc định `2`, không có đường cấu hình từ UI/API | **F-BE-19** |
| `offline_probe_ms` | Như trên: iobus đọc `rs485.offline_probe_ms`, BE chỉ ghi `device/baud/parity/stop` ⇒ luôn 5000 ms | **F-BE-20** |
| Write path Modbus | `drain_ext_writes()` đọc `plc_shm.ext[].dirty/setpoint`, nhưng không endpoint hay UI nào đặt được cờ này; chỉ node graph `Modbus_RTU_Write` làm được | F-FW-06 |
| `expose_bacnet` trong profile | iobus đọc được, `BuildProfile()` không bao giờ sinh field | OD-MBRTU-014 |
| Điều khiển hướng RS-485 | Source **không gọi** `modbus_rtu_set_serial_mode()`; device tree Foxlinx không có `rs485-*` ⇒ đang chạy trên giả định auto-direction chưa kiểm chứng | **F-IF-10** / D-13 |

> **F-BE-19/F-BE-20 là lớp lỗi đáng chú ý.** Track A thêm hai tham số điều khiển
> hành vi bus vào FW và vào định dạng file, nhưng **không ai ghi chúng ra file**.
> Đọc code iobus sẽ tưởng tham số đã cấu hình được. Không sai hành vi mặc định, nên
> không phải defect an toàn — nhưng chặn việc chỉnh chính sách offline theo hiện trường.
>
> **Vì sao không test nào bắt được:** mỗi tầng test đúng phần của mình — test C++ đặt
> struct trực tiếp, test Go kiểm validator chứ không kiểm **nội dung file sinh ra**.
> Khắc phục: `TB-MBRTU-17`.

### 4.3 Mock/placeholder

Không có mock trong đường Modbus RTU của BE/FW-SOM. Đường chạy dùng libmodbus thật;
test dùng PTY thật.

**Nhưng board nghiệm thu đang chạy `mkddc-fakemcu`, không phải STM32 thật, và
không có `fieldbus.conf`.** Nghĩa là ở trạng thái hiện tại trên board, fieldbus
thread không được tạo và **code Modbus không chạy dòng nào**. Điều này phải được
nêu cùng mọi trích dẫn kết quả nghiệm thu (§7).

---

## 5. Mâu thuẫn đã xử lý trong phiên này

| # | Mâu thuẫn | Xử lý |
|---|---|---|
| C-11 | 12 tài liệu mô tả **hai bus** `RS485-1`/`RS485-2`; `PRODUCT.md` + `SYS-REQ-MBRTU-001` (đã sửa theo Đ-01) mô tả **một bus** | Viết lại toàn bộ 12 tài liệu theo Đ-01: Rev A một instance Bus, **giữ** entity Bus và `bus_id` để mở cổng thứ hai không phải đổi ABI lần nữa. Wireframe/sơ đồ vẽ bus thứ hai bằng **nét đứt** |
| C-12 | 12 tài liệu mô tả **bốn vai trò** có `Engineer`; ADR-021 + Đ-04 chỉ có **ba** | Bỏ `Engineer` khỏi mọi ma trận quyền, gộp vào `Admin`. Ghi rõ hệ quả: `PR-MBRTU-012` (tách quyền cấu hình khỏi quyền ghi register) **không đạt** ở Rev A — Đ-04 chấp nhận rủi ro tường minh; theo dõi tại `OD-MBRTU-009R` |
| C-13 | Bảng gap của 12 tài liệu liệt kê defect **đã sửa** như còn tồn tại | Đối chiếu lại từng dòng với source tại `eade4e5`; tách mỗi bảng thành "gap còn lại" và "đã đóng bằng Track A" kèm commit |
| C-14 | Nhãn `Retry` trên UI/API vs ngữ nghĩa mới của Đ-05 | Đổi nhãn thành "Số lần phát lại"; tách trường "Chuyển OFFLINE sau N lượt poll lỗi"; cột bảng `Poll/TO/Retry` → `Poll/TO/Phát lại` |
| C-15 | `OD-MBRTU-001/009/011/012/015/EXT-02` vẫn ghi `OPEN` dù đã có quyết định ký | Đóng theo đúng quy tắc §4.3 của chính tài liệu: đổi `Trạng thái` thành `CLOSED <ngày> — <link>`, **không xoá dòng** |
| C-16 | Capacity: Đ-07 yêu cầu ≥256 Point; mọi tài liệu và source vẫn ghi 64 | Ghi mục tiêu ≥256 là `PROPOSED` kèm bảng tác động ABI (~2,6 KB → ~10,3 KB datagram); ghi As-Built 64 là gap `G-DM-12`/`F-FW-20`/`F-BE-21`. **Không** tuyên bố đã đạt |
| C-17 | `contracts/openapi/openapi.yaml` mô tả `retry` theo ngữ nghĩa **cũ** sau khi Đ-05 đã đổi ở FW/BE/FE | **Không tự sửa contract** (bị `INTERFACES.md` cấm trước ADR-024). Ghi vào `INTERFACES.md` và nâng thành `OD-MBRTU-018`; đây là lý do gate interface **không** thể là YES |
| C-18 | Plan 49 có hai mục cùng đánh số 7 và không có mục 9 | Sửa "Definition of Done" thành §9 |
| C-19 | FW design ghi ngân sách CPU "một core RK3566"; board thật là Forlinx OK1126B-S / RV1126B | Bỏ tham chiếu sai board, ghi rõ số liệu **chưa đo** (Đ-10) |

**Mâu thuẫn C-01..C-10 của bản 1.0**: C-01 đã đóng bằng Đ-01; C-02 không còn áp
dụng ở Rev A; C-06/C-07 chuyển thành `OD-MBRTU-016`/Đ-04; C-03/C-04/C-05 (banner
SUPERSEDED) và C-08/C-09/C-10 giữ nguyên trạng thái bản 1.0.

---

## 6. Danh sách gap giữa thiết kế và source tại `eade4e5`

### 6.1 Đã đóng bằng Track A (không còn là gap)

| Defect | Nội dung | Commit |
|---|---|---|
| D-01, D-02 | encode fail-closed: `scale=0`, NaN/±Inf, ngoài dải kiểu đích ⇒ `false`, không ghi byte nào (chặn UB `static_cast`) | `1e3e2bc` |
| D-03 | vòng đời write hữu hạn; chấm dứt replay vô thời hạn trong một process | `a6fba4c` |
| D-04 | `on_poll_error` cập nhật `last_poll_ms`; EDF; `offline_probe_ms` | `c4036dd` |
| D-05, D-06 | retry đúng nghĩa; `retry_attempts ≠ total_errors`; ngưỡng OFFLINE tách riêng | `0f0fe71` |
| D-07, D-08, D-14 | FE thôi suy diễn trạng thái; xoá phải xác nhận; Viewer xem được; bỏ cổng mặc định không tồn tại | `dfef8ab` |
| D-10, D-11, D-12 | point chưa có mẫu không báo STALE; `offsetof` + `static_assert`; E303 cửa sổ trượt | `9168cba` |

Gap tương ứng đã đóng: `F-FW-08`, `F-BE-16`, `F-FE-03/04/05/11`, `G-UX-08/09`,
`G-DM-14/15/16`.

### 6.2 P0 còn lại (12)

`F-FW-02`/`G-DM-02` quality 3 mức không reason · `F-FW-03`/`F-BE-15`/`F-IF-08`/`G-DM-03`
timestamp do BE gán · `F-FW-04`/`G-DM-04` value là `float` · `F-FW-05`/`F-IF-01`
snapshot không sequence/generation/revision · `F-FW-06`/`F-IF-02` write không có
request/result · `F-BE-01`/`F-FW-10`/`F-IF-03` apply = restart iobus · `F-BE-02`/`F-API-02`/`G-UX-02`
mỗi CRUD tự apply · `F-BE-03`/`G-DM-07` không có journal/LKG bền vững · `F-BE-05`/`F-API-04`
không idempotency · `F-BE-06`/`F-API-03` không optimistic concurrency ·
`F-BE-10`/`F-API-07`/`G-UX-05`/`F-FE-08` không commissioning · **`F-IF-10`/`F-FW-19`
chưa set chế độ RS-485** · **`F-FW-20`/`F-BE-21`/`G-DM-12` capacity 64 vs Đ-07 ≥256**

### 6.3 P1 còn lại (18)

`G-DM-05` checksum không canonical · `G-DM-06` thiếu `bit_index`/min-max/poll theo point ·
`G-DM-09` identity đổi với profile `count>1` · `G-DM-10`/`F-BE-11`/`F-API-08`/`G-UX-06`/`F-FE-09`
không import/export (**bắt buộc theo Đ-06**) · `G-DM-11` connection_status thiếu trạng thái ·
`F-BE-04` không `fsync` thư mục · `F-BE-09` checksum phụ thuộc thứ tự map ·
`F-BE-13` không admission control · `F-BE-18` audit thiếu target/old/new ·
**`F-BE-19`/`F-BE-20`/`F-API-13`/`G-UX-11`/`F-FE-14` hai tham số offline đứt end-to-end** ·
**`F-API-14`/`F-IF-11` OpenAPI lệch ngữ nghĩa `retry`** · `F-FW-07` write còn phát lại
sau restart iobus · `F-FW-09` không tính utilization · `F-FW-11` `ext_point_name` đổi
identity · `F-FW-13` counter uint32 không boot id · `F-FW-15` không readback ·
**`F-FW-17` thiếu counter `deadline_miss`/`poll_duration`** · **`F-FW-18` hàng đợi
write không bounded** · `F-IF-06`/`F-IF-07` tên field lệch, không test cross-language ·
`F-IF-09`/`F-FE-06`/`G-UX-12` cổng serial còn là chuỗi tự do · `F-API-09/10/11/12` ·
`F-FE-01`/`G-UX-01` một page thay vì năm · `F-FE-10`/`G-UX-07` state theo vùng ·
`F-FE-12` không refresh/stream · `G-UX-04` không có Mapping page

### 6.4 P2 còn lại (9)

`F-BE-07` Bus chưa là entity · `F-BE-08` slave ID unique toàn cục · `F-BE-12` enable/disable
không tách audit · `F-BE-14` diagnostics ghép theo slave · `F-BE-17` poll min 10 ms ·
`F-FE-13` ép `Number()` cho `bool` · `F-FE-15`/`G-UX-13` chưa tách quyền Operator ·
`F-FW-01` chưa tách `BusWorker` · `F-FW-16` slot base dịch khi device lỗi ·
`G-DM-01`/`G-DM-08` · `G-UX-10` address không có nhãn convention

> **Bốn gap được hạ mức nhờ Đ-01**, không phải nhờ sửa code: `F-FW-01`, `F-BE-07`,
> `F-BE-08`, `F-BE-14` — với một bus, hành vi As-Built **đúng**; phần còn lại là nợ
> cấu trúc, sẽ nâng lại P0/P1 nếu mở cổng thứ hai.

---

## 7. Trạng thái kiểm chứng — và giới hạn của nó

### 7.1 Số đo host Track A (2026-08-04)

| Gate | Kết quả |
|---|---|
| `ctest --test-dir build/fw` (Modbus+BACnet+HMI ON) | 769/769 PASS (trước Track A: 759) |
| `go vet ./...` + `go test ./... -count=1` | PASS, 11 package `ok` |
| `npx vitest --run --environment jsdom src` | 304/304 PASS, 35 file (trước: 3 FAIL) |
| `npm run lint` / `npm run build` | PASS / PASS |

### 7.2 Nghiệm thu board Foxlinx (2026-08-05)

`T-A1..T-A5`: 4 PASS + 1 PARTIAL (T-A3, phần FE chưa kiểm trên browser).
`iobus_tests` aarch64 **trên chính board**, trong lúc service production đang chạy:
208 PASS / 6 SKIP / 0 FAIL; nhóm Track A 23/23 PASS. Jitter IOP không hồi quy
(15,36–15,65 µs so với 18,15–20,10 µs). Evidence:
[EVID-MBRTU-TRACKA-FOXLINX-2026-08-05](../test-evidence/fw-som/2026-08-05-foxlinx-track-a-acceptance.md).

### 7.3 Ba giới hạn bắt buộc đọc kèm

1. Board chạy **fake MCU**, không phải STM32 thật ⇒ `T-A4` không phải phép đo với
   MCU thật như câu chữ gốc của cổng ra.
2. Board **không có `fieldbus.conf`** và **không có thiết bị RS-485 nào đấu vào**
   ⇒ code Modbus **không chạy dòng nào** ở trạng thái vận hành. Hồ sơ chứng minh
   code đúng trên kiến trúc/kernel/libmodbus của target, **không** chứng minh giao
   tiếp RS-485 vật lý.
3. `T-A2` đo gián tiếp qua log vì chưa có counter `deadline_miss`/`poll_duration`
   (`F-FW-17`).

```text
TRACK_A_BOARD_ACCEPTANCE = PASS WITH LIMITS
VR-MBRTU-011 (real RS485/HIL) = RED    ← không đổi
```

---

## 8. Open decision cần CTO/Product phê duyệt

**Đã đóng bằng quyết định có ký (6):** `OD-MBRTU-001` (Đ-01 một cổng) ·
`-009` (Đ-04 ba vai trò) · `-011` (Đ-07 ≥256 Point) · `-012` (Đ-06 CSV+JSON) ·
`-015` (Đ-03 chấp thuận đổi ABI) · `-EXT-02` (Đ-08 cấp thiết bị).
**Không áp dụng ở Rev A (1):** `-002`.

**Còn mở và CHẶN GATE (3):**

| ID | Vấn đề | Chặn gì | Cần ai |
|---|---|---|---|
| `OD-MBRTU-018` | OpenAPI mô tả `retry` theo ngữ nghĩa cũ sau Đ-05 | `MODBUS_RTU_INTERFACES_SYNCHRONIZED` | Architect + Product |
| `OD-MBRTU-EXT-01` | Chưa chỉ định tên Fieldbus Lead và QA/HIL Lead (Đ-09) | toàn bộ Track B | PM |
| `OD-MBRTU-EXT-04` | Cơ chế điều khiển hướng RS-485 + số chân + schematic (Đ-02/`G-D`) | `MBR-B101`, `MBR-B403`, `TC-MBRTU-H-16` | Hardware Lead |

**Còn mở, không chặn gate hiện tại (13):** `-003` `bit_index` · `-004` alias ·
`-005` ưu tiên commissioning write · `-006` ngưỡng tải bus · `-007` refresh/write rate ·
`-008` reset counter · `-010` `read_write` vs `access_mode` · `-013` cascade xoá ·
`-014` `expose_bacnet` · `-016` quality 5 mức · **`-017` mức quyền export (mới)** ·
**`-019` hai tham số offline (mới)** · `-EXT-03` ADR-022 provenance.

---

## 9. Điều đã **không** làm (và vì sao)

| Việc | Lý do |
|---|---|
| Sửa source FE/BE/FW-SOM | quy tắc nhiệm vụ: không sửa source, không implement |
| Sửa `contracts/openapi/openapi.yaml` để khớp ngữ nghĩa `retry` mới | `INTERFACES.md` cấm sửa contract machine-readable trước ADR-024 Accepted. Đây chính là lý do gate interface không thể YES — đã nâng thành `OD-MBRTU-018` thay vì tự quyết |
| Đổi ADR-024 sang Accepted | không tự tuyên bố thiết kế đã được phê duyệt |
| Chuyển 9 tài liệu `In Review` sang `Active` | cần chữ ký reviewer theo `CONTROL.md`; ngoài thẩm quyền phiên này |
| Nâng `KX_N_EXT` lên 256 theo Đ-07 | là thay đổi source + ABI, thuộc Track B |
| Xoá các dòng `OD-MBRTU-*` đã đóng | quy tắc §4.3: giữ nguyên nội dung, chỉ đổi trạng thái |
| Chạy lại test | không sửa source nên không có gì mới để kiểm chứng; số cũ chỉ được trích dẫn kèm nguồn và giới hạn |
| Tuyên bố Track A đã đóng hoàn toàn | `T-A3` mới PARTIAL, và board chạy fake MCU không có `fieldbus.conf` |

---

## 10. Kết luận bắt buộc

```text
MODBUS_RTU_REQUIREMENTS_COMPLETE   = YES
MODBUS_RTU_UI_UX_DESIGN_COMPLETE   = YES
MODBUS_RTU_BE_DESIGN_COMPLETE      = YES
MODBUS_RTU_FW_SOM_DESIGN_COMPLETE  = YES
MODBUS_RTU_INTERFACES_SYNCHRONIZED = NO
MODBUS_RTU_VERIFICATION_DEFINED    = YES

READY_FOR_MODBUS_RTU_IMPLEMENTATION = CONDITIONAL
```

### 10.1 Vì sao bốn `*_COMPLETE` là `YES`

Bộ requirement phủ đủ mọi use case đề bài và nay **nhất quán với các quyết định đã
ký**. UI/UX có đủ năm page với mục tiêu, role, workflow, wireframe, component,
field/validation, bốn state, confirmation, API và acceptance criteria. BE có
transaction, validator, admission, commissioning, RBAC/audit. FW-SOM có ownership,
thread model, scheduler, codec, quality, write path, reload, capacity,
startup/shutdown/recovery.

`YES` ở đây nói về **tài liệu đã đầy đủ và tự nhất quán**, không nói source đã
conform — source chưa conform, xem §6.

### 10.2 Vì sao `MODBUS_RTU_INTERFACES_SYNCHRONIZED` đổi từ `YES` (bản 1.0) thành `NO`

Bản 1.0 kết luận `YES` vì khi đó **không tài liệu Active nào mô tả một mô hình
Modbus Point khác**. Điều đó vẫn đúng. Nhưng từ Track A, một sự thật mới xuất hiện:

> Quyết định Đ-05 đã đổi ngữ nghĩa trường `retry` và việc này **đã được thực hiện
> trong FW, BE và FE**, trong khi `contracts/openapi/openapi.yaml` — một tài liệu
> **Active** — vẫn mô tả ngữ nghĩa cũ.

Contract machine-readable hiện **mô tả sai hành vi thật của hệ thống**. Một tích
hợp viên đọc OpenAPI sẽ đặt `retry` với kỳ vọng sai. Đó đúng là định nghĩa của
"interface chưa đồng bộ", nên hạ gate này xuống `NO` là kết luận trung thực duy nhất.

**Đây là hạ cấp có chủ ý và có đường mở khoá rõ ràng**, không phải hồi quy: sửa mô
tả + range của riêng trường `retry` trong OpenAPI (`OD-MBRTU-018`) là đủ để trả gate
về `YES`. Việc đó cần một quyết định cho phép ngoại lệ, không cần code.

### 10.3 Vì sao `READY_FOR_MODBUS_RTU_IMPLEMENTATION = CONDITIONAL`

Điều kiện `YES` đòi hỏi **không còn tài liệu Active mâu thuẫn** *và* **mọi interface
FE–BE–FW-SOM đã được định nghĩa đầy đủ**.

Điều kiện thứ hai đạt. Điều kiện thứ nhất **chưa** đạt vì hai lý do:

1. **`OD-MBRTU-018`** — OpenAPI (Active) mâu thuẫn với hành vi đã ký của Đ-05.
2. **Bộ 12 tài liệu vẫn `In Review` và ADR-024 vẫn `Proposed`.** Theo `CONTROL.md`,
   chỉ tài liệu `Active` mới là baseline.

Ba lý do của bản 1.0 nay **đã hết**: xung đột `PRODUCT.md` ↔ `HW_SPEC` về số bus đã
đóng bằng Đ-01; năm OD P0 đã ký; thiết bị nghiệm thu đã được duyệt cấp.

### 10.4 Điều kiện chính xác để chuyển sang `YES`

| # | Điều kiện | Ai quyết | Cần code? |
|---|---|---|---|
| 1 | `OD-MBRTU-018`: cho phép sửa mô tả `retry` trong OpenAPI | Architect + Product | Không |
| 2 | ADR-024 `Proposed → Accepted` | CTO | Không |
| 3 | 9 tài liệu `In Review → Active` sau review | Product, Architect, Fieldbus, HW, Security, QA | Không |
| 4 | `OD-MBRTU-EXT-01`: chỉ định Fieldbus Lead + QA/HIL Lead (Đ-09) | PM | Không |
| 5 | `OD-MBRTU-EXT-04`: schematic điều hướng RS-485 (Đ-02) | Hardware Lead | Không |

**Năm mục đều là quyết định con người, không mục nào cần viết code hay mua thêm
phần cứng.** Mục 1–3 nằm hoàn toàn trong tầm nội bộ.

**Có thể bắt đầu Track B ngay không?** Không — `G-B2` (ADR-024) và `G-B1`/`G-D`
(schematic) chưa đóng. Việc gần nhất được phép làm là **review và phê duyệt bộ tài
liệu này**. Track A đã hoàn tất phần code và đã có nghiệm thu board `PASS WITH LIMITS`.

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-04 | Tạo record đồng bộ: 12 tài liệu mới, 14 tài liệu cập nhật, 10 mâu thuẫn, 40 gap, 19 open decision. Gate: 6 YES + CONDITIONAL |
| 2.0 | 2026-08-05 | Đồng bộ lần 2 tại `eade4e5`. Áp dụng 11 quyết định PM/CTO vào cả 12 tài liệu (một bus, ba vai trò, retry đúng nghĩa, ≥256 Point, commissioning/import-export bắt buộc). Đối chiếu lại toàn bộ gap với source sau Track A: đóng 13 gap, hạ mức 8 gap, **thêm 12 gap mới** trong đó có hai gap đứt end-to-end (`F-BE-19`/`F-BE-20`). Đóng 6 `OD-MBRTU-*`, thêm 4 mục mới. Ghi nhận nghiệm thu board `PASS WITH LIMITS`. **Hạ `MODBUS_RTU_INTERFACES_SYNCHRONIZED` từ YES xuống NO** vì OpenAPI mô tả sai ngữ nghĩa `retry` sau Đ-05 (`OD-MBRTU-018`) |
