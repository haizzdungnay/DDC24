# BACnet Rev A — Implementation Plan (Work Packages & Issues)

> **Document ID:** PLAN-BACNET-REVA-001
> **Phiên bản:** 1.0 | 2026-09-10
> **Trạng thái:** **PROPOSED — chờ Owner duyệt.** Chưa được tạo Issue, chưa được implement.
> **Đầu vào:** [As-Built Review](../05_verification/BACNET_REV_A_ASBUILT_REVIEW.md) (REV-BACNET-ASBUILT-001)
> **Đọc cùng:** [Quyết định còn mở](../00_governance/BACNET_OPEN_DECISIONS.md) ·
> [Plan doc→code→E2E Forlinx](BACNET_DOC_TO_CODE_E2E_PLAN.md) (`PLAN-BACNET-D2C-001`,
> chi tiết hoá plan này xuống mức task thi hành được)

---

## 1. Product Decision đề xuất cuối

Chủ sở hữu đã khoá: **BACnet/IP Server — Northbound to BMS**. Kế hoạch này không đề xuất
thay đổi quyết định đó. Nó đề xuất **thu hẹp phạm vi công bố** cho khớp thứ sẽ thực sự
được verify trong Rev A.

### 1.1 Rev A — MUST (giữ nguyên theo đề bài)

BACnet/IP server · UDP transport thật · Device Object · Who-Is/I-Am · ReadProperty ·
ReadPropertyMultiple · WriteProperty · AO/BO Priority_Array[16] · Relinquish_Default ·
Units · Reliability · Status_Flags · Out_Of_Service · COV subscription · COV notification
thật qua mạng · Stable Object Identity · Runtime diagnostics · Config + runtime read-back ·
RBAC/audit cho mutation · Target/HIL verification.

### 1.2 Đề xuất chuyển sang **V1.1** — kèm sửa PICS

Cả bốn nhóm dưới đây đều thiếu ít nhất một trong: SOURCE / RUNTIME WIRING /
NETWORK IMPLEMENTATION / TARGET TEST. Theo quy tắc §2 của đề bài, chúng phải chuyển V1.1.

| Nhóm | Thiếu gì | PICS phải sửa thành |
|---|---|---|
| Alarm/Event (AE-N-I-B, AE-ACK-B) | network implementation (placeholder) + runtime wiring (`open()`/`add_target()` không caller) + target test | ❌ Không hỗ trợ ở Rev A |
| Schedule / Calendar (SCHED-I-B) | runtime wiring (không register vào stack) + network + target test | ❌ Không hỗ trợ ở Rev A |
| Trend Log (T-VMT-I-B) | **source** (không có mã) | ❌ Không hỗ trợ ở Rev A |
| BBMD / Foreign Device | parse config + network + target test | ❌ Không hỗ trợ ở Rev A |
| Who-Has/I-Have (DM-DOB-B) | handler | ❌ Không hỗ trợ ở Rev A |
| WritePropertyMultiple (DS-WPM-B) | handler | ❌ Không hỗ trợ ở Rev A |
| TimeSync | không có caller; và mã hiện tại là TS-A (gửi) không phải TS-B (nhận) | ❌ hoặc khai đúng TS-A sau khi nối — cần Owner quyết (OD-BAC-005) |

### 1.3 OUT OF SCOPE (khẳng định lại, không đổi)

BACnet MS/TP · BACnet client/master · BACnet/IP Point làm Programming input ·
Modbus RTU Point → BACnet object ở Rev A · BTL certification claim · Safety PLC · Motion.

---

## 2. Tài liệu cần tạo / sửa

Bộ authority mục tiêu, theo đúng thứ tự phụ thuộc:

```
PRODUCT.md  (sửa: nêu rõ BACnet/IP Server scope Rev A)
    ↓
PROD-BACNET-001  (TẠO MỚI — docs/01_product/BACNET_PRODUCT_REQUIREMENTS.md)
    ↓
BACNET_REQUIREMENTS  (TẠO MỚI — bổ sung SYS-REQ-BAC-* vào docs/02_requirements/REQUIREMENTS.md)
    ↓
BACNET_PICS_EPICS  (SỬA NẶNG — 9/14 BIBB sai; xem §1.2)
    ↓
BACNET_ARCHITECTURE_DESIGN  (TẠO MỚI — docs/03_architecture/)
    ├── BACNET_FW_SOM_DESIGN        (SỬA — SW_BACNET_DESIGN §3-4 hiện đúng, cần bổ sung Export Registry)
    ├── BACNET_API_DATA_CONTRACT    (TẠO MỚI — desired/active/runtime + OpenAPI)
    └── BACNET_FE_FUNCTIONAL_SPEC   (TẠO MỚI)
    ↓
BACNET_VV_ACCEPTANCE_SPEC  (TẠO MỚI — docs/05_verification/, gồm T1..T9 của HIL gate)
    ↓
TRACEABILITY  (TẠO MỚI — docs/07_records/BACNET_TRACEABILITY_MATRIX.md, theo mẫu Modbus)
```

**Sửa kèm (lỗi nhỏ đã phát hiện, gộp vào WP tương ứng):**

| Lỗi | Vị trí | Gộp vào |
|---|---|---|
| Trỏ `services/core/...` (thư mục đã xoá) | PICS §4.1, §4.2 | WP-BAC-01 |
| Ghi sai đường AO property population | `33_BACNET_OBJECT_ALIGNMENT_PLAN.md §2` | WP-BAC-01 |
| Mâu thuẫn AO writable/không-writable | PICS §4 vs §4.1 | WP-BAC-01 |
| `EVIDENCE_DIR` trỏ `docs/00_management/...` trong khi hồ sơ ở `docs/07_records/...` | `tools/bacnet_pretest/bacnet_pretest.sh:23` | WP-BAC-09 |

**Nguyên tắc bất di bất dịch:** PICS chỉ được claim thứ **IMPLEMENTED + VERIFIED**.
PICS không phải bằng chứng — khi PICS lệch implementation thì **sửa PICS**.

---

## 3. Work Packages

Mỗi WP dưới đây ghi: Scope · Source files · Dependency · Acceptance Criteria · Tests ·
Evidence · Risk · Out-of-scope · Definition of Done.

---

### WP-BAC-01 — Product / PICS / Requirement reconciliation

- **Scope:** Đưa tài liệu về khớp mã nguồn *trước khi* sửa mã, để mọi WP sau có một
  baseline đúng để đối chiếu. Sửa 9 BIBB khai sai, tách requirement BACnet ra khỏi PICS.
- **Source files:** `docs/02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md`,
  `docs/01_product/PRODUCT.md`, `docs/02_requirements/REQUIREMENTS.md`,
  `docs/01_product/BACNET_PRODUCT_REQUIREMENTS.md` (mới),
  `docs/03_implementation/33_BACNET_OBJECT_ALIGNMENT_PLAN.md`.
- **Dependency:** — (WP gốc)
- **Acceptance Criteria:**
  1. Mỗi dòng BIBB trong PICS có cột **Evidence** trỏ `file:line` hoặc mã test; dòng nào
     không có evidence thì phải là ❌.
  2. Bảng §4 Object Types khớp số object mà mã thực sự phục vụ dữ liệu thật.
  3. Không còn đường dẫn `services/` trong bất kỳ tài liệu BACnet nào.
  4. Mâu thuẫn AO writable được giải quyết một chiều.
  5. Tồn tại `PROD-BACNET-001` và tập `SYS-REQ-BAC-*` phủ hết 19 mục MUST ở §1.1.
- **Tests:** `python3 scripts/verify_docs_links.py` (hoặc cổng link hiện hành) PASS;
  `pytest`/gate tài liệu PASS.
- **Evidence:** diff tài liệu + log cổng link.
- **Risk:** Thấp về kỹ thuật, cao về chính trị — WP này công khai thừa nhận PICS đã sai.
  Cần Owner ký (OD-BAC-001).
- **Out-of-scope:** Không sửa mã nguồn ở WP này.
- **DoD:** PICS không còn dòng nào claim thứ chưa verify; requirement spec tồn tại và
  được review.

---

### WP-BAC-02 — Stable Object Registry + Capability-aware export

- **Scope:** Tạo `BacnetExportRegistry` làm lớp trung gian duy nhất giữa Canonical Point
  và bacnet-stack. Cấp `objectInstance` bền vững từ `pointStableId`. Cổng capability
  theo `board_cap_map` để không tạo object phần cứng giả.
- **Source files:** `apps/iobus/adapters/bacnet/bacnet_export_registry.{hpp,cpp}` (mới),
  `apps/iobus/adapters/bacnet/bacnet_server.cpp` (`register_objects()`),
  `apps/iobus/bootstrap/main.cpp` (truyền `board_cap_map`),
  `contracts/config/` (schema lưu bền mapping instance).
- **Dependency:** WP-BAC-01 (cần chốt object set trong PICS trước).
- **Acceptance Criteria:**
  1. Mỗi export có đủ 8 trường: `pointStableId`, `objectType`, `objectInstance`,
     `objectName`, `units`, `access`, `covIncrement`, `runtimeState`.
  2. Base SKU (`board_cap_map` không báo isolated-DI) **không** tạo BI object nào — sửa
     `bacnet_server.cpp:219`.
  3. `objectInstance` không đổi qua: restart service, power-cycle, đổi `objectName`,
     đổi cấu hình không liên quan.
  4. Đổi UI mode làm đổi Object Type ⇒ validate chặn + cảnh báo + yêu cầu apply tường minh.
  5. Không dùng chỉ số mảng runtime làm business identity ở bất kỳ đâu.
- **Tests:** unit test instance-stability (ghi registry → mô phỏng restart → so khớp);
  unit test capability gate cho 3 cấu hình `board_cap_map`; HIL **T8**.
- **Evidence:** log registry lúc boot; HIL T8.
- **Risk:** Đổi object set là **breaking change** với BMS đã tích hợp. Cần OD-BAC-002.
- **Out-of-scope:** Chưa nối dữ liệu (đó là WP-BAC-03).
- **DoD:** AC 1-5 PASS; T8 PASS trên board.

---

### WP-BAC-03 — Live data path: Physical I/O → Core → SHM → IOBUS → Present_Value

- **Scope:** Sửa gap nặng nhất (G-01). Mọi object đã export phải đọc giá trị thật từ
  `kx_plc_shm_t`, theo đúng `SW_BACNET_DESIGN §4`.
- **Source files:** `apps/iobus/adapters/bacnet/bacnet_server.cpp`
  (`sync_stack_inputs()` → `sync_all_objects()`),
  `apps/iobus/adapters/bacnet/bacnet_objects.cpp` (đường đọc AO/BO),
  `bacnet_export_registry.cpp`.
- **Dependency:** **WP-BAC-02**
- **Acceptance Criteria:**
  1. AV×32, BV×16, MSV×8 trả giá trị thật từ `plc_shm.av/bv/msv` — không còn `0.0` giả.
  2. AO/BO `Present_Value` đọc từ `plc_shm.ao/bo` (**giá trị core đã áp**), không từ
     priority array nội bộ của bacnet-stack.
  3. Units/Reliability/Status_Flags/Out_Of_Service được đẩy cho **mọi** loại object, không
     chỉ AI/BI.
  4. `Object_Name` do người dùng cấu hình tới được BMS cho AI/BI/AV/BV/MSV (sửa G-07).
  5. Đường dò thay đổi quét đủ 16 UI, không phải 8 (sửa `bacnet_server.cpp:295`).
  6. Fault ở nguồn I/O phải hiện lên đúng ở Reliability/Status_Flags — **không được**
     biến UNKNOWN/BAD thành GOOD.
- **Tests:** unit test cho từng bank object đọc từ SHM giả lập; HIL **T2**, **T3**, **T4**.
- **Evidence:** capture Wireshark của RPM trả đúng giá trị runtime; ảnh/số đo thiết bị đo
  ở T2; log inject fault ở T4.
- **Risk:** AC-2 đổi ngữ nghĩa read-back mà BMS đang thấy. Đây là sửa lỗi đúng hướng
  nhưng cần thông báo tích hợp.
- **Out-of-scope:** Đường ghi (WP-BAC-04).
- **DoD:** AC 1-6 PASS; T2/T3/T4 PASS trên board với tín hiệu vật lý thật.

---

### WP-BAC-04 — WriteProperty + Priority + Relinquish + authoritative read-back

- **Scope:** Sửa G-02 và G-03. Đưa đường ghi mạng đi qua `BacnetExportRegistry` +
  `BacnetPriority` của dự án, khôi phục kiểm biên và quy đổi đơn vị.
- **Source files:** `bacnet_server.cpp:44-60` (callback), `:141-152`
  (`handle_output_write()`), `bacnet_objects.cpp:293-395`, `bacnet_priority.cpp`.
- **Dependency:** **WP-BAC-03**
- **Acceptance Criteria:**
  1. Callback AO/BO gọi `BacnetObjects::write_ao()/write_bo()` thay vì gọi thẳng
     `core_fn_` — `BacnetPriority` không còn là mã chết.
  2. `min_pv`/`max_pv` được kiểm trên đường mạng thật; ghi ngoài biên trả
     `VALUE_OUT_OF_RANGE`, không nhận im lặng.
  3. `ao_engineering_to_physical()` chạy trên đường mạng thật — không còn gửi giá trị
     engineering vào core như thể là đơn vị vật lý.
  4. WriteProperty AV/BV/MSV có callback và tới được core; nếu Owner quyết không hỗ trợ
     thì trả `WRITE_ACCESS_DENIED`, **không** nhận rồi bỏ (OD-BAC-003).
  5. Relinquish trả đúng owner kế tiếp hoặc `Relinquish_Default`.
  6. Khi core override, `Present_Value` phản ánh giá trị core áp và
     `Status_Flags.OVERRIDDEN` được bật.
  7. Mọi mutation qua BACnet vào audit store, không chỉ dòng `AUDIT` trên stderr.
- **Tests:** unit test toàn bộ ma trận priority; HIL **T6**, **T7**.
- **Evidence:** số đo **đầu ra vật lý thật** (đồng hồ ở AO1, tiếp điểm ở BO1) ở T6;
  bảng priority winner ở T7; bản ghi audit.
- **Risk:** **Cao — chạm đường điều khiển ra thiết bị.** Phải test trên board có tải giả
  trước khi chạy trên hệ thống thật.
- **Out-of-scope:** COV (WP-BAC-05).
- **DoD:** AC 1-7 PASS; T6/T7 PASS với số đo vật lý thật.

---

### WP-BAC-05 — SubscribeCOV + lifetime + unsubscribe + COV notification thật

- **Scope:** Sửa G-04 và G-05 — capability MUST hiện đang hoàn toàn không tồn tại trên mạng.
- **Source files:** `bacnet_server.cpp:116-127` (đăng ký handler), `:280-333`
  (`dispatch_cov()`), `bacnet_cov.{hpp,cpp}`.
- **Dependency:** **WP-BAC-03** (cần dữ liệu thật để có gì mà notify)
- **Acceptance Criteria:**
  1. Đăng ký `SERVICE_CONFIRMED_SUBSCRIBE_COV`; BMS SubscribeCOV **không còn bị Reject**.
  2. Handler nối vào `BacnetCov::subscribe()` — không còn TEST-ONLY.
  3. `dispatch_cov()` gửi **gói tin thật** (`Send_COV_Notification_*`), không `fprintf`.
  4. Confirmed và Unconfirmed COV đều hoạt động; confirmed có retry/timeout theo TSM.
  5. `lifetime` hết hạn ⇒ tự huỷ subscription; `lifetime=0` trong request ⇒ cancel.
  6. Recipient address được lưu và dùng đúng (`recipient_tag` hiện là "opaque tag" chưa
     được giải nghĩa).
  7. COV_Increment cho AI/AO/AV lấy từ cấu hình, không hard-code `0.1f`.
- **Tests:** unit test lifetime/expiry/cancel; test tích hợp loopback UDP; HIL **T5**.
- **Evidence:** capture Wireshark cho thấy COV notification tự phát sau khi tín hiệu vật
  lý đổi, **không có** request poll nào xen giữa.
- **Risk:** Trung bình. Rủi ro chính là bão notification khi tín hiệu nhiễu — cần
  COV_Increment hợp lý và test với tín hiệu thật.
- **Out-of-scope:** Event/Alarm notification (đã chuyển V1.1).
- **DoD:** AC 1-7 PASS; T5 PASS trên board.

---

### WP-BAC-06 — Runtime telemetry / diagnostics

- **Scope:** Sửa G-08. Thay "bind thành công = online" bằng telemetry thật.
- **Source files:** `contracts/shm/mkddc_shm.h` (thêm block telemetry — **ABI change**),
  `apps/iobus/domain/io/io_cache.{hpp,cpp}`, `bacnet_server.cpp`,
  `apps/web-api/internal/app/networkapi.go`.
- **Dependency:** WP-BAC-02 (cần `covSubscriptions` từ registry)
- **Acceptance Criteria:**
  1. Publish đủ 9 trường: `serviceState`, `boundInterface`, `activePort`, `lastRx`,
     `lastWhoIs`, `rxPackets`, `txPackets`, `covSubscriptions`, `protocolErrors`.
  2. `bmsLink` **không** còn suy ra từ `bip_init()`. Đề xuất: `online` khi có
     `lastRx` trong cửa sổ thời gian đã định; `unknown` khi thiếu số đo — không bao giờ
     đoán (OD-BAC-004 chốt cửa sổ).
  3. Phân biệt rõ ba trạng thái: **socket bound** ≠ **có traffic BACnet** ≠ **BMS đã
     discover mình**.
  4. Đổi ABI SHM đi kèm bump magic để reader cũ fail rõ ràng, không đọc rác.
- **Tests:** Go unit test `bmsLinkStatus` cho mọi tổ hợp; C++ test ABI offset;
  `contract_sync_test.go` PASS.
- **Evidence:** JSON `/api/v1/network/config` trên board với BMS bật/tắt cho hai kết quả
  khác nhau.
- **Risk:** ABI change — phải recompile và deploy đồng bộ iobus + core + web-api.
- **Out-of-scope:** FE hiển thị (WP-BAC-08).
- **DoD:** AC 1-4 PASS; tắt BMS thì `bmsLink` chuyển khỏi `online` trong cửa sổ đã chốt.

---

### WP-BAC-07 — BE desired/active/runtime contract + atomic config + read-back + audit

- **Scope:** Yêu cầu số 9 của Owner: Web/BE phải phân biệt **DESIRED CONFIG** /
  **ACTIVE CONFIG** / **RUNTIME STATE**.
- **Source files:** `apps/web-api/internal/app/networkapi.go`, `configapi.go`,
  `overview.go`, `contracts/openapi/openapi.yaml`.
- **Dependency:** **WP-BAC-06**
- **Acceptance Criteria:**
  1. API trả ba khối tách bạch cho BACnet: `desired` (file), `active` (iobus đang chạy),
     `runtime` (telemetry). Hiện chỉ `activeBacnetPort` có read-back.
  2. Device ID và Device Name có read-back runtime, không chỉ port.
  3. `overview.go:317-342` `bacnetIpEnabled` đọc từ **runtime**, không từ file cấu hình.
  4. Apply là atomic: hoặc cả ba file (`network`/`device`/`bacnet`) cùng có hiệu lực,
     hoặc rollback trọn vẹn.
  5. **Không báo SUCCESS chỉ vì file đã ghi** — phải xác nhận từ runtime authority.
  6. Mutation có RBAC + audit entry với user, giá trị cũ/mới, kết quả.
- **Tests:** Go test cho ba khối; `TestRouteTableMatchesOpenAPI` PASS; HIL **T9**.
- **Evidence:** T9 — đổi Device ID/Name/Port rồi đọc runtime xác nhận.
- **Risk:** Đổi shape response ⇒ breaking cho FE; phải làm cùng WP-BAC-08.
- **Out-of-scope:** `/bacnet/objects` (xem OD-BAC-006).
- **DoD:** AC 1-6 PASS; T9 PASS.

---

### WP-BAC-08 — FE BACnet configuration + runtime diagnostics + object catalog

- **Scope:** Trang mạng hiển thị đúng ba trạng thái và không suy diễn.
- **Source files:** `apps/web-ui/src/features/network/NetworkPage.tsx`,
  `shared/types.ts`, `shared/api/client.ts`, `shared/components/ControllerDiagram.tsx`.
- **Dependency:** **WP-BAC-07**
- **Acceptance Criteria:**
  1. Phân biệt trực quan desired vs active; cấu hình đã lưu nhưng chưa có hiệu lực phải
     hiện rõ là "chờ áp dụng", không hiện như đã chạy.
  2. Bảng diagnostics hiện 9 trường của WP-BAC-06; thiếu số đo hiện `—`, không đoán.
  3. Đèn `bmsLink` phản ánh traffic thật; `unknown` là trạng thái hợp lệ và được hiển thị.
  4. Object catalog (nếu Owner mở OD-BAC-006): liệt kê object đã export kèm
     `pointStableId`/`objectType`/`objectInstance`/`units`/`access`/`runtimeState`.
  5. Cảnh báo breaking khi đổi UI mode làm đổi Object Type (nối AC-4 của WP-BAC-02).
- **Tests:** `npx vitest --run --environment jsdom src`, `npm run lint`, `npm run build`,
  `npx playwright test e2e/network-qa.spec.ts`.
- **Evidence:** ảnh chụp trang mạng ở ba trạng thái (chưa apply / đã apply / BMS offline).
- **Risk:** Thấp.
- **Out-of-scope:** Thay đổi backend contract (đã ở WP-BAC-07).
- **DoD:** AC 1-5 PASS; bộ test FE PASS với số đo thật.

---

### WP-BAC-09 — Target / HIL / BMS interoperability verification

- **Scope:** Chạy trọn T1..T9 của Hard Release Gate trên board DDC-24 thật với BMS thật.
  Đây là WP **không thể thay thế bằng bất cứ thứ gì khác**.
- **Source files:** `tools/bacnet_pretest/bacnet_pretest.sh` (viết lại),
  `docs/05_verification/BACNET_VV_ACCEPTANCE_SPEC.md` (mới),
  `docs/07_records/evidence/bacnet-hil/` (mới).
- **Dependency:** **WP-BAC-03, 04, 05, 06** (T2/T3/T4 cần 03; T6/T7 cần 04; T5 cần 05;
  T9 cần 06+07)
- **Acceptance Criteria:**
  1. T1..T9 PASS trên board thật, BMS thật, tín hiệu vật lý thật.
  2. Script pre-test **không** dùng readback từ chính bacnet-stack làm bằng chứng cho
     đường ghi — phải đối chiếu với authority hoặc thiết bị đo (sửa lỗi §5.2 của review).
  3. Sửa `EVIDENCE_DIR` về `docs/07_records/evidence/`.
  4. Mỗi bộ evidence có: capture Wireshark, log iobus, số đo thiết bị, serial board,
     firmware version, IP, Device ID.
  5. Build `BACNET=ON` chạy được trong CI hoặc trên runner có bacnet-stack.
- **Tests:** chính nó.
- **Evidence:** `docs/07_records/evidence/bacnet-hil/<UTC>/`.
- **Risk:** **Chặn bởi tài nguyên vật lý** — cần board, BMS/test client, thiết bị đo,
  nguồn tín hiệu. Xem OD-BAC-007.
- **Out-of-scope:** BTL certification (đã OUT OF SCOPE).
- **DoD:** 9/9 test PASS, evidence lưu đầy đủ.

---

### WP-BAC-10 — PICS final reconciliation + release evidence

- **Scope:** Sau khi WP-01..09 xong, đối chiếu PICS lần cuối với thứ **đã được verify trên
  board**, rồi khoá release.
- **Source files:** PICS, `docs/07_records/BACNET_TRACEABILITY_MATRIX.md`,
  `docs/07_records/BACNET_RELEASE_RECORD_<date>.md`.
- **Dependency:** **WP-BAC-09**
- **Acceptance Criteria:**
  1. Mỗi dòng PICS ✅ có evidence trỏ tới một test đã PASS trên **board**, không phải host.
  2. Ma trận traceability phủ: requirement → design → source → test → evidence.
  3. Checklist 15 điều kiện Definition of Done (§8 của review) đạt đủ 15/15.
  4. `Vendor_Identifier` — hoặc đã có số ASHRAE thật, hoặc placeholder `9999` được ghi rõ
     trong release record là hạn chế đã biết (OD-BAC-008).
- **Tests:** cổng tài liệu + link PASS.
- **Evidence:** release record.
- **Risk:** Thấp.
- **Out-of-scope:** —
- **DoD:** `BACNET_REV_A = READY` được ký.

---

## 4. Dependency graph

```
WP-BAC-01  Product/PICS/Requirement reconciliation
    │
    ▼
WP-BAC-02  Stable Object Registry + capability gate
    │
    ▼
WP-BAC-03  Live data path (Present_Value thật cho mọi object)
    │
    ├──────────────┬──────────────┐
    ▼              ▼              ▼
WP-BAC-04      WP-BAC-05      WP-BAC-06
Write/Priority  COV thật      Runtime telemetry
/Relinquish                       │
    │              │              ▼
    │              │          WP-BAC-07  BE desired/active/runtime
    │              │              │
    │              │              ▼
    │              │          WP-BAC-08  FE config + diagnostics
    │              │              │
    └──────────────┴──────────────┘
                   │
                   ▼
             WP-BAC-09  Target/HIL/BMS verification
                   │
                   ▼
             WP-BAC-10  PICS final + release evidence
```

**Đường găng:** `01 → 02 → 03 → 04 → 09 → 10`.
WP-05 và chuỗi 06→07→08 chạy song song được sau khi 03 xong, nhưng cả ba đều hội tụ ở 09.

**Quy tắc thi hành:** không implement Issue N+1 nếu dependency N chưa đạt acceptance
criteria cần thiết. Cụ thể: **không WP nào sau WP-BAC-03 được đánh DONE trước khi
WP-BAC-03 có bằng chứng T2 trên board thật** — vì mọi thứ khác đều đứng trên giả định
"dữ liệu là thật".

---

## 5. Danh sách Issue đề xuất

18 Issue, mỗi Issue một concern. **Chưa tạo** — chờ Owner duyệt.

Ký hiệu: `P0` chặn Rev A · `P1` cần cho Rev A · `P2` nên có.

| # | Tiêu đề | WP | Prio | Finding | Dependency |
|---|---|---|---|---|---|
| I-01 | PICS: sửa 9 BIBB khai sai, thêm cột Evidence | 01 | P0 | G-09 | — |
| I-02 | PICS: gỡ đường dẫn `services/` và giải quyết mâu thuẫn AO writable | 01 | P1 | G-09 | — |
| I-03 | Tạo `PROD-BACNET-001` + tập `SYS-REQ-BAC-*` | 01 | P1 | G-10 | — |
| I-04 | Tạo `BacnetExportRegistry` với 8 trường bắt buộc | 02 | P0 | G-01 | I-01 |
| I-05 | Object Instance bền vững qua restart/rename/đổi cấu hình | 02 | P0 | M-15 | I-04 |
| I-06 | Capability gate: không tạo BI khi base SKU không có isolated-DI | 02 | P1 | G-06 | I-04 |
| I-07 | Cảnh báo breaking khi đổi UI mode làm đổi Object Type | 02 | P2 | §6 AC-4 | I-04 |
| I-08 | Nạp Present_Value thật cho AV/BV/MSV từ `plc_shm` | 03 | P0 | G-01 | I-04 |
| I-09 | AO/BO Present_Value đọc từ authority, không từ priority array nội bộ | 03 | P0 | G-01 | I-04 |
| I-10 | Đẩy Units/Reliability/Status_Flags/OOS cho mọi loại object | 03 | P1 | M-09..M-11 | I-08 |
| I-11 | `Object_Name` cấu hình tới được BMS cho AI/BI/AV/BV/MSV | 03 | P2 | G-07 | I-08 |
| I-12 | Đường ghi mạng đi qua `BacnetPriority` + kiểm biên + quy đổi đơn vị | 04 | P0 | G-02 | I-09 |
| I-13 | WriteProperty AV/BV/MSV: nối core hoặc trả `WRITE_ACCESS_DENIED` | 04 | P1 | G-03 | I-12 |
| I-14 | Đăng ký handler SubscribeCOV và nối vào `BacnetCov` | 05 | P0 | G-04 | I-08 |
| I-15 | Gửi COV notification thật (confirmed + unconfirmed) qua mạng | 05 | P0 | G-05 | I-14 |
| I-16 | Publish 9 trường telemetry runtime; `bmsLink` thôi suy diễn từ bind | 06 | P1 | G-08 | I-04 |
| I-17 | BE: tách desired / active / runtime; read-back Device ID + Name | 07 | P1 | M-17 | I-16 |
| I-18 | HIL: chạy T1..T9 trên board thật + viết lại script pre-test | 09 | P0 | G-11 | I-12, I-15, I-17 |

---

## 6. Acceptance Criteria từng Issue

Dưới đây là AC đo được cho từng Issue. Mỗi Issue khi tạo phải mang đủ các mục:
**Finding · Evidence file:line · Current behavior · Target behavior · Architecture
boundary · Files allowed to touch · Acceptance criteria · Test required ·
Target/HIL requirement · Dependency · Priority.**

### I-01 — PICS: sửa 9 BIBB khai sai
- **Evidence:** `BACNET_PICS_EPICS_MK-DDC-24_VI.md:19-34`
- **Current:** 14 BIBB khai ✅; chỉ DM-DDB-B đúng hoàn toàn.
- **Target:** DS-COV-B, DS-COVU-B, AE-N-I-B, AE-ACK-B, SCHED-I-B, T-VMT-I-B, DM-DOB-B,
  DS-WPM-B → ❌ Rev A. DM-TS-B → theo OD-BAC-005.
- **AC:** mọi dòng ✅ có cột Evidence trỏ `file:line`; số dòng ✅ giảm từ 14 xuống ≤5.
- **Test:** cổng link tài liệu PASS. **HIL:** không. **Files:** chỉ tài liệu.

### I-02 — PICS: đường dẫn chết + mâu thuẫn AO
- **Evidence:** PICS §4.1, §4.2 (`services/core/bacnet_objtable.cpp`); PICS §4 vs §4.1;
  `33_BACNET_OBJECT_ALIGNMENT_PLAN.md:38-41`
- **AC:** `grep -rn "services/" docs/**/*BACNET*` trả rỗng; mô tả AO writable nhất quán
  một chiều trong toàn tài liệu.
- **Test:** grep + cổng link. **Files:** chỉ tài liệu.

### I-03 — PROD-BACNET-001 + SYS-REQ-BAC-*
- **Evidence:** `REQUIREMENTS.md:95` (`SYS-REQ-004` là dòng duy nhất)
- **AC:** mỗi mục trong 19 MUST (§1.1) map tới ít nhất một `SYS-REQ-BAC-*` có tiêu chí
  đo được; ma trận phủ 100%.
- **Test:** cổng tài liệu. **Files:** `docs/01_product/`, `docs/02_requirements/`.

### I-04 — BacnetExportRegistry
- **Evidence:** `bacnet_server.cpp:214-226` (tạo object bằng vòng lặp hằng số)
- **Current:** 88 object tạo cứng theo hằng số biên dịch.
- **Target:** registry sinh export từ Canonical Point + `board_cap_map`.
- **AC:** mỗi export có đủ 8 trường; `register_objects()` không còn hằng số phần cứng;
  unit test dựng registry từ 3 `board_cap_map` khác nhau cho 3 object set khác nhau.
- **Boundary:** registry thuộc `apps/iobus/adapters/bacnet/`; **không** đụng `apps/core`.
- **Files:** `bacnet_export_registry.{hpp,cpp}` (mới), `bacnet_server.cpp`,
  `apps/iobus/CMakeLists.txt`.
- **Test:** unit. **HIL:** không (chuẩn bị cho I-05).

### I-05 — Object Instance bền vững
- **AC:** ghi registry → restart process → mọi `objectInstance` khớp 100%; đổi
  `objectName` không đổi instance; thêm/bớt một point không dịch instance của point khác.
- **Test:** unit + integration restart. **HIL:** **T8** (power-cycle board).

### I-06 — Capability gate BI
- **Evidence:** `bacnet_server.cpp:219`; `PRODUCT.md:84`; `mkddc_shm.h:68`;
  `PRODUCT_DEFINITION §68-70`
- **Current:** `Binary_Input_Create()` chạy 8 lần vô điều kiện.
- **Target:** chỉ tạo BI khi `board_cap_map` báo isolated-DI.
- **AC:** base SKU ⇒ BMS discover **không** thấy BI object nào; SKU có DI ⇒ thấy đúng số
  kênh phần cứng báo.
- **Test:** unit 2 cấu hình. **HIL:** **T1** (discovery liệt kê object).

### I-07 — Cảnh báo đổi Object Type
- **AC:** đổi UI mode dẫn tới đổi Object Type ⇒ API trả cảnh báo breaking + yêu cầu
  `confirm` tường minh; không đổi âm thầm.
- **Test:** Go + FE unit. **HIL:** không.

### I-08 — Present_Value thật cho AV/BV/MSV
- **Evidence:** `bacnet_server.cpp:228-256` (`sync_stack_inputs` chỉ lặp AI/BI)
- **Current:** BMS đọc AV1..32/BV1..16/MSV1..8 luôn nhận `0.0`.
- **Target:** đọc từ `plc_shm.av/bv/msv` — core đã publish sẵn
  (`bacnet_objtable.cpp:136-141`).
- **AC:** ghi giá trị đã biết vào point → BMS ReadProperty trả đúng giá trị đó cho cả 56
  object; không object nào trả `0.0` khi point có giá trị khác `0`.
- **Test:** unit với SHM giả lập. **HIL:** **T3** (RPM đọc nhiều object).

### I-09 — AO/BO read-back authoritative
- **Evidence:** `bacnet_objects.cpp:170-186`; `bacnet_server.cpp:228-256`
- **Current:** ReadProperty AO trả giá trị bacnet-stack nhớ, kể cả khi core đã override.
- **Target:** trả `plc_shm.ao/bo` — giá trị core thực áp; bật `Status_Flags.OVERRIDDEN`
  khi core từ chối.
- **AC:** ép core override (safe-state/interlock) ⇒ BMS đọc thấy giá trị **của core**,
  không phải giá trị BMS đã ghi; `OVERRIDDEN` bật.
- **Test:** integration với core giả lập. **HIL:** **T6**.

### I-10 — Units/Reliability/Status_Flags/OOS cho mọi object
- **AC:** ReadProperty các thuộc tính này trên AV/BV/MSV/AO/BO trả giá trị có nghĩa,
  không phải mặc định của stack; inject fault ⇒ Reliability đúng ADR-011;
  **không** biến BAD/UNKNOWN thành GOOD.
- **Test:** unit ma trận reliability. **HIL:** **T4**.

### I-11 — Object_Name tới BMS
- **Evidence:** chỉ `apply_ao_config()` gọi `Analog_Output_Name_Set`
- **AC:** đổi tên AI1 trên Web UI → ReadProperty AI1.Object_Name trả tên mới sau apply.
- **Test:** integration. **HIL:** **T9** (kèm read-back).

### I-12 — Đường ghi qua BacnetPriority + kiểm biên + quy đổi đơn vị
- **Evidence:** `bacnet_server.cpp:44-60`, `:141-152` vs `bacnet_objects.cpp:293-327`
- **Current:** callback gọi thẳng `core_fn_`; bỏ qua priority array, kiểm biên, và
  `ao_engineering_to_physical()`.
- **Target:** callback → `BacnetObjects::write_ao()/write_bo()`.
- **AC:** (a) `bacnet_priority.cpp` có caller sản phẩm — xác minh bằng cách xoá thử hàm
  thì build hỏng; (b) ghi ngoài `[min_pv, max_pv]` trả `VALUE_OUT_OF_RANGE`; (c) ghi
  `50%` vào AO cấu hình 4-20mA cho ra `12 mA` ở đầu ra vật lý, không phải `50`;
  (d) relinquish trả đúng owner kế tiếp hoặc `Relinquish_Default`; (e) mutation vào audit
  store.
- **Boundary:** không đụng `apps/core`; core vẫn là authority.
- **Test:** unit ma trận priority đầy đủ. **HIL:** **T6** (đo đầu ra vật lý), **T7**.
- **Rủi ro:** chạm đường điều khiển ra thiết bị — bắt buộc test có tải giả trước.

### I-13 — WriteProperty AV/BV/MSV
- **Evidence:** `bacnet_server.cpp:113-115` (chỉ AO/BO có callback)
- **Current:** BMS ghi AV1, readback trả đúng, core không biết ⇒ **báo thành công sai**.
- **Target:** theo OD-BAC-003 — hoặc nối core, hoặc trả `WRITE_ACCESS_DENIED`.
- **AC:** không còn trường hợp "ghi thành công nhưng không tới core".
- **Test:** integration. **HIL:** bổ sung vào T6.

### I-14 — Đăng ký SubscribeCOV
- **Evidence:** `bacnet_server.cpp:116-127` thiếu `SERVICE_CONFIRMED_SUBSCRIBE_COV`
- **Current:** BMS SubscribeCOV → `handler_unrecognized_service` → Reject.
- **AC:** SubscribeCOV trả SimpleACK; `BacnetCov::subscribe()` có caller sản phẩm;
  `lifetime` hết hạn tự huỷ; `lifetime=0` cancel; `covSubscriptions` trong telemetry
  phản ánh đúng số subscription đang sống.
- **Test:** unit lifetime + integration loopback UDP. **HIL:** **T5**.

### I-15 — COV notification thật
- **Evidence:** `bacnet_server.cpp:286-293` (`fprintf` thay vì gửi gói)
- **AC:** (a) capture Wireshark cho thấy COV notification rời card mạng sau khi tín hiệu
  vật lý đổi, **không có** poll xen giữa; (b) confirmed COV có retry/timeout theo TSM;
  (c) `dispatch_cov()` quét đủ 16 UI (hiện chỉ 1..8 ở `:295`); (d) COV_Increment lấy từ
  cấu hình, không hard-code `0.1f`.
- **Test:** integration loopback. **HIL:** **T5** — bài quyết định.

### I-16 — Telemetry runtime
- **Evidence:** `mkddc_shm.h:210-211`; `networkapi.go:300-307`
- **Current:** 2 trường; `bip_init()` thành công ⇒ `bmsLink=online`.
- **AC:** 9 trường được publish; tắt BMS ⇒ `bmsLink` rời `online` trong cửa sổ đã chốt
  (OD-BAC-004); thiếu số đo ⇒ `unknown`, không đoán; ABI bump magic.
- **Test:** Go unit mọi tổ hợp + C++ ABI offset test. **HIL:** bật/tắt BMS đối chiếu.

### I-17 — BE desired/active/runtime
- **Evidence:** `networkapi.go:183-192`; `overview.go:317-342`
- **AC:** API trả 3 khối tách bạch; Device ID và Name có read-back runtime;
  `bacnetIpEnabled` đọc từ runtime không từ file; apply atomic hoặc rollback trọn vẹn;
  **không** báo SUCCESS chỉ vì file đã ghi.
- **Test:** Go + `TestRouteTableMatchesOpenAPI`. **HIL:** **T9**.

### I-18 — HIL T1..T9
- **AC:** 9/9 PASS trên board thật với BMS thật và tín hiệu vật lý thật; script pre-test
  không dùng readback từ bacnet-stack làm bằng chứng đường ghi; `EVIDENCE_DIR` trỏ
  `docs/07_records/evidence/`; evidence đủ 5 thành phần (§7 của review).
- **Test:** chính nó. **HIL:** toàn bộ.
- **Chặn bởi:** tài nguyên vật lý (OD-BAC-007) và build `BACNET=ON` (OD-BAC-009).

---

## 7. Ước lượng và thứ tự thực thi

| WP | Issue | Ước lượng | Ghi chú |
|---|---|---|---|
| 01 | I-01..I-03 | ~12h | Chỉ tài liệu; làm được ngay sau khi Owner ký OD-BAC-001 |
| 02 | I-04..I-07 | ~24h | Nền cho mọi thứ sau |
| 03 | I-08..I-11 | ~20h | Gap nặng nhất |
| 04 | I-12, I-13 | ~16h | Rủi ro cao — chạm đường ra thiết bị |
| 05 | I-14, I-15 | ~20h | Capability MUST đang thiếu hoàn toàn |
| 06 | I-16 | ~12h | ABI change |
| 07 | I-17 | ~12h | |
| 08 | — | ~12h | |
| 09 | I-18 | ~16h + lead time thiết bị | **Chặn bởi tài nguyên vật lý** |
| 10 | — | ~6h | |
| | **Tổng** | **~150h** + lead time HIL | |

---
**Rev** 1.0 | 2026-09-10 — PROPOSED, chờ Owner duyệt. Ký: ___
