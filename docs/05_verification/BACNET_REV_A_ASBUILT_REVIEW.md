# BACnet Rev A — As-Built Review & Gap Matrix

> **Document ID:** REV-BACNET-ASBUILT-001
> **Phiên bản:** 1.0 | 2026-09-10
> **Trạng thái:** Review đã hoàn tất — **chờ Owner duyệt** trước khi implement
> **Vai trò soạn:** BACnet Product/Software Architecture Review Lead
> **Đọc cùng:** [Kế hoạch triển khai](../03_implementation/BACNET_REV_A_IMPLEMENTATION_PLAN.md) ·
> [Quyết định còn mở](../00_governance/BACNET_OPEN_DECISIONS.md) ·
> [PICS/EPICS](../02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md) ·
> [SW BACnet Design](../02_design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md)

---

## 0. Kết luận điều hành

**`BACNET_REV_A = NOT READY`.**

Mục tiêu sản phẩm đã khoá là: *BMS ngoài → BACnet/IP → board DDC-24 thật → đọc dữ liệu
THẬT từ Physical I/O*. Rà soát mã nguồn cho thấy chuỗi này **đứt ở lớp iobus ↔ bacnet-stack**,
không phải ở lớp phần cứng hay SHM.

Ba phát biểu ngắn gọn nhất về hiện trạng:

1. **Đường đọc AI/BI là THẬT và chạy được.** Physical I/O → IOP → `io_shm` → core →
   `kx_plc_shm_t` → `sync_stack_inputs()` → bacnet-stack. Đây là phần duy nhất của
   Rev A đạt mức IMPLEMENTED end-to-end trong mã nguồn.
2. **SubscribeCOV không tồn tại trên mạng.** Không có handler nào được đăng ký cho
   `SERVICE_CONFIRMED_SUBSCRIBE_COV`. BMS gửi SubscribeCOV sẽ rơi vào
   `handler_unrecognized_service` và nhận Reject. Toàn bộ `BacnetCov` là engine dò
   thay đổi nội bộ, chỉ được gọi từ unit test.
3. **64 trong 88 object đăng ký với bacnet-stack không bao giờ được nạp dữ liệu.**
   `sync_stack_inputs()` chỉ đẩy AI và BI. AV×32, BV×16, MSV×8 vĩnh viễn trả `0.0`;
   AO×4/BO×4 trả giá trị mà BACnet đã ghi, **không phải** giá trị core thực sự áp dụng.

Điểm nguy hiểm nhất không phải là thiếu tính năng, mà là **bằng chứng giả**: bộ test
host 1440/1440 PASS, hồ sơ pre-test 14/14 PASS, và đèn `bmsLink` báo `online` — cả ba
đều xanh trong khi ba phát biểu trên đồng thời đúng. §5 giải thích từng cơ chế.

---

## 1. Phạm vi rà soát và phương pháp

Đã đọc trực tiếp mã nguồn, không suy luận từ tên file:

| Lớp | File đã đọc |
|---|---|
| Product | `docs/01_product/PRODUCT.md`, `docs/01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md` |
| Requirements | `docs/02_requirements/REQUIREMENTS.md` |
| PICS/Design | `BACNET_PICS_EPICS_MK-DDC-24_VI.md`, `SW_BACNET_DESIGN_MK-DDC-24_VI.md`, `25_BACNET_IMPLEMENTATION_PLAN.md`, `33_BACNET_OBJECT_ALIGNMENT_PLAN.md`, `ADR-011` |
| iobus/BACnet | `bacnet_server.*`, `bacnet_objects.*`, `bacnet_cov.*`, `bacnet_alarm.*`, `bacnet_schedule.*`, `bacnet_priority.*`, `bacnet_reliability.*`, `bacnet_config.*` |
| Composition | `apps/iobus/bootstrap/main.cpp`, `apps/iobus/CMakeLists.txt` |
| Core/SHM | `apps/core/adapters/bacnet/bacnet_objtable.*`, `contracts/shm/mkddc_shm.h` |
| BE | `apps/web-api/internal/app/networkapi.go`, `overview.go`, `http.go`, `contracts/openapi/openapi.yaml` |
| FE | `apps/web-ui/src/features/network/NetworkPage.tsx`, `shared/types.ts`, `ControllerDiagram.tsx` |
| Evidence | `docs/07_records/evidence/bacnet-pretest/`, `docs/07_records/TRACEABILITY.md`, `tools/bacnet_pretest/` |

**Số đo build/test thật đo trong phiên này** — xem §5.1.

---

## 2. Feature / GAP Matrix

Phân loại: `IMPLEMENTED` · `PARTIAL` · `PLACEHOLDER` · `CONFIG-ONLY` · `TEST-ONLY` ·
`NOT IMPLEMENTED` · `VERIFIED-HOST` · `VERIFIED-TARGET`.

### 2.1 Capability MUST của Rev A

| # | Capability | Trạng thái | Evidence (file:line) | Ghi chú |
|---|---|---|---|---|
| M-01 | BACnet/IP server, UDP transport thật | **IMPLEMENTED** / VERIFIED-HOST | `bacnet_server.cpp:104-111` `bip_init()` | Chưa có bằng chứng board thật |
| M-02 | Device Object | **PARTIAL** | `bacnet_server.cpp:90-100` | `Vendor_Identifier=9999` placeholder (`:98`) |
| M-03 | Who-Is / I-Am | **IMPLEMENTED** / VERIFIED-HOST | `bacnet_server.cpp:127`, `:130` | Có unicast handler; chưa đo trên board |
| M-04 | ReadProperty | **PARTIAL** | `bacnet_server.cpp:117` | Handler thật, nhưng chỉ AI/BI có dữ liệu thật (M-12) |
| M-05 | ReadPropertyMultiple | **PARTIAL** | `bacnet_server.cpp:119` | Cùng lý do M-04 |
| M-06 | WriteProperty | **PARTIAL** | `bacnet_server.cpp:121`, `:141-152` | Chỉ AO/BO có callback; AV/BV/MSV không tới core (G-03) |
| M-07 | AO/BO Priority_Array[16] | **PARTIAL** | `bacnet_server.cpp:47-60` | Dùng array nội bộ của bacnet-stack; `BacnetPriority` của dự án bị bỏ qua (G-02) |
| M-08 | Relinquish_Default | **PARTIAL** | `bacnet_priority.cpp:96` | Có logic nhưng nằm trên đường chết (G-02) |
| M-09 | Units | **IMPLEMENTED** (AI/AO) | `bacnet_server.cpp:155-181` | AI/AO có; BI/AV/BV/MSV không đẩy Units |
| M-10 | Reliability | **IMPLEMENTED** (AI/BI) | `bacnet_objects.cpp:120-131`, `bacnet_objtable.cpp:125-127` | ADR-011 đúng; AO/BO/AV… không sync (G-01) |
| M-11 | Status_Flags / Out_Of_Service | **PARTIAL** | `bacnet_server.cpp:236-238`, `:245-247` | Chỉ AI/BI được đẩy sang stack |
| M-12 | **Present_Value thật cho mọi object** | **NOT IMPLEMENTED** (AV/BV/MSV), **PARTIAL** (AO/BO) | `bacnet_server.cpp:228-256` | **G-01 — gap nặng nhất** |
| M-13 | COV subscription qua mạng | **NOT IMPLEMENTED** | không có `SERVICE_CONFIRMED_SUBSCRIBE_COV` trong `bacnet_server.cpp:116-127` | **G-04** |
| M-14 | COV notification thật qua mạng | **PLACEHOLDER** | `bacnet_server.cpp:288-292` chỉ `fprintf` | **G-05** |
| M-15 | Stable BACnet Object Identity | **PARTIAL** | `bacnet_server.cpp:214-226` | Instance cố định = index+1 (ổn định), nhưng không capability-gate (G-06) |
| M-16 | Runtime diagnostics | **PARTIAL** | `mkddc_shm.h:210-211` chỉ 2 trường | **G-08** — chỉ có `bacnet_bound` + `bacnet_udp_port` |
| M-17 | Configuration + runtime read-back | **PARTIAL** | `networkapi.go:190-192` `activeBacnetPort` | Chỉ port có read-back; Device ID/Name không |
| M-18 | RBAC / audit với mutation | **IMPLEMENTED** (Web), **PARTIAL** (BACnet) | `http.go:286-287`, `bacnet_server.cpp:149-151` | Ghi qua BACnet có dòng AUDIT nhưng không vào audit store |
| M-19 | Target/HIL verification | **NOT IMPLEMENTED** | `docs/07_records/evidence/bacnet-pretest/…/bacnet.conf` | Bằng chứng chạy trên `docker0` / `172.17.0.1`, **không phải board** |

### 2.2 Capability KHÔNG mặc định coi là DONE (theo yêu cầu §2 của đề bài)

| # | Capability | PICS claim | Trạng thái thật | Evidence |
|---|---|---|---|---|
| O-01 | Alarm/Event Notification (AE-N-I-B) | ✅ | **PLACEHOLDER** | `bacnet_alarm.cpp:93-101` — comment ghi rõ *"Placeholder: log the dispatch"*; thêm nữa `targets_` rỗng vì `add_target()` không có caller ⇒ vòng lặp không chạy lần nào; và `open()` cũng không có caller ⇒ `sockfd_ = -1` ⇒ `drain()` thoát ngay |
| O-02 | Alarm Acknowledge (AE-ACK-B) | ✅ | **NOT IMPLEMENTED** | Không có handler `SERVICE_CONFIRMED_ACKNOWLEDGE_ALARM` |
| O-03 | Schedule (SCHED-I-B, khai 64 object) | ✅ | **TEST-ONLY** | `BacnetScheduleObjects` không có caller nào ngoài `bacnet_schedule.*` và `test_bacnet_schedule.cpp`; không object nào được tạo trong `register_objects()` |
| O-04 | Calendar (khai 16 object) | ✅ | **TEST-ONLY** | Như O-03 |
| O-05 | Trend Log (T-VMT-I-B, khai 8 object) | ✅ | **NOT IMPLEMENTED** | Không tồn tại module Trend Log nào trong repo |
| O-06 | Notification Class (khai 4) / Event Enrollment (khai 8) | ✅ | **NOT IMPLEMENTED** | Không có object nào được tạo |
| O-07 | BBMD / Foreign Device | ✅ | **CONFIG-ONLY (dead)** | `bacnet_config.hpp:19-22` có `bbmd_addr`/`bbmd_port`/`fd_addr`/`fd_ttl`, nhưng `bacnet_config.cpp` **không parse** field nào trong số đó và `bacnet_server.cpp` không gọi BVLC register. Đúng cảnh báo *"không gọi capability chỉ vì config struct có field"* |
| O-08 | Who-Has / I-Have (DM-DOB-B) | ✅ | **NOT IMPLEMENTED** | Không đăng ký `SERVICE_UNCONFIRMED_WHO_HAS` |
| O-09 | TimeSync (DM-TS-B) | ✅ | **PARTIAL, không nối** | `send_time_sync()` tồn tại (`bacnet_server.cpp:335-343`) nhưng **không có caller nào**; ngoài ra nó *gửi* TimeSync = vai trò master (TS-A), không phải TS-B (nhận) |
| O-10 | ReinitializeDevice (DM-RD-B) | ✅ | **PARTIAL** | Handler stock được đăng ký (`:123`) nhưng `reinit_fn_` chỉ được gán (`:77`) và không bao giờ gọi; `check_reinit_password()` không có caller ⇒ warm/cold restart thật không xảy ra |
| O-11 | WritePropertyMultiple (DS-WPM-B) | ✅ | **NOT IMPLEMENTED** | Không đăng ký `SERVICE_CONFIRMED_WRITE_PROP_MULTIPLE` |
| O-12 | Segmentation `segmented-both` | ✅ | **CHƯA XÁC MINH** | Không có cấu hình segmentation nào trong mã; phụ thuộc mặc định của bacnet-stack |

**Tổng kết PICS:** trong 14 BIBB được khai ✅, có **1** đúng hoàn toàn (DM-DDB-B),
**4** đúng một phần (DS-RP-B, DS-RPM-B, DS-WP-B, DM-RD-B), và **9** sai. PICS đang được
dùng như wishlist — đúng như đề bài cảnh báo.

---

## 3. Findings chi tiết

### G-01 — 64/88 object không bao giờ được nạp dữ liệu · **P0 · Chặn Rev A**

**Evidence:** `apps/iobus/adapters/bacnet/bacnet_server.cpp:214-256`

`register_objects()` tạo 88 object: AI×16, BI×8, AO×4, BO×4, AV×32, BV×16, MSV×8.
`sync_stack_inputs()` — hàm duy nhất đẩy dữ liệu SHM sang bacnet-stack — **chỉ lặp AI và BI**.

Hệ quả đo được từ phía BMS:

| Object | BMS đọc được gì |
|---|---|
| AI1–16 | Giá trị thật từ Physical I/O ✅ |
| BI1–8 | Giá trị thật từ `shm->bi[]` ✅ (nhưng xem G-06) |
| AO1–4, BO1–4 | Giá trị **BACnet đã ghi**, không phải giá trị core áp dụng ⚠️ |
| AV1–32, BV1–16, MSV1–8 | `0.0` vĩnh viễn ❌ |

Điểm nghiêm trọng nhất là AO/BO: `read_ao()` (`bacnet_objects.cpp:170-186`) trả
`priority_.applied_value(...)` từ `BacnetPriority` nội bộ — mà array này không bao giờ
được ghi từ đường mạng (xem G-02) — và kết quả đó **cũng không được đẩy sang stack**.
Do đó ReadProperty AO1.Present_Value trả về giá trị trong `ao.c` của bacnet-stack.
Khi core từ chối lệnh (safe-state, interlock, HMI local, arbitration), **BMS vẫn thấy
giá trị nó đã ghi** và tin rằng lệnh có hiệu lực. Đây là sai lệch liên quan an toàn,
không chỉ là thiếu tính năng.

Thiết kế `SW_BACNET_DESIGN §4` đã đặc tả **đúng** mô hình cần có (Read_Property callback
đọc `plc_shm.ao/bo/av/bv/msv`). Mã nguồn không theo thiết kế đó. Đây là gap
implementation-vs-design, không phải gap thiết kế.

### G-02 — Priority_Array + Relinquish của dự án là mã chết · **P0**

**Evidence:** `bacnet_server.cpp:44-60` và `:141-152` so với `bacnet_objects.cpp:293-345`

Đường ghi thật là:

```
bacnet-stack WriteProperty → ao_write_callback() → handle_output_write() → core_fn_() → core.sock
```

Đường này **bỏ qua hoàn toàn** `BacnetObjects::write_ao()`. Ba thứ bị mất theo:

1. **`BacnetPriority`** — toàn bộ `bacnet_priority.cpp` (119 dòng) không có caller sản
   phẩm. Priority thực tế do `ao.c` của bacnet-stack phục vụ.
2. **Kiểm tra biên `min_pv`/`max_pv`** — `bacnet_objects.cpp:296-298` không chạy trên
   đường thật.
3. **Quy đổi engineering → physical** — `ao_engineering_to_physical()`
   (`bacnet_objects.cpp:67-77`) không chạy. `handle_output_write()` gửi thẳng giá trị
   engineering (ví dụ `%`) vào core với op `ao_setpoint`. Nếu core hiểu tham số là đơn vị
   vật lý (V/mA) thì đây là sai đơn vị âm thầm trên đường ra vật lý.

Nghịch lý cần nêu rõ: `BacnetObjects.EngineeringPercentConvertsToPhysicalCurrent` là một
test PASS, nhưng nó kiểm một hàm mà sản phẩm không gọi.

### G-03 — AV/BV/MSV nhận WriteProperty nhưng không tới core · **P1**

**Evidence:** `bacnet_server.cpp:113-115` chỉ đăng ký callback cho AO và BO.

`write_av()`/`write_bv()`/`write_msv()` (`bacnet_objects.cpp:329-361`) tồn tại nhưng
không có caller. BMS ghi AV1 → bacnet-stack cập nhật giá trị nội bộ → readback trả đúng
giá trị vừa ghi → **BMS kết luận thành công** → core không hề biết. Đây chính xác là
kịch bản mà bài test T5 trong hồ sơ pre-test đã "PASS" (xem §5.2).

### G-04 — SubscribeCOV không được đăng ký · **P0 · MUST của Rev A**

**Evidence:** `bacnet_server.cpp:116-127` — danh sách handler đầy đủ, không có
`SERVICE_CONFIRMED_SUBSCRIBE_COV`.

BMS gửi SubscribeCOV → `handler_unrecognized_service` → Reject. `BacnetCov::subscribe()`
chỉ có caller trong `test_bacnet_cov.cpp`. Phân loại: **TEST-ONLY**.

### G-05 — COV notification là `fprintf`, không phải gói tin · **P0 · MUST của Rev A**

**Evidence:** `bacnet_server.cpp:286-293`

```cpp
/* bacnet-stack: Send_COV_Subscribe_Unconfirmed or confirmed COV notification */
std::fprintf(stderr, "INFO  bacnet_cov.notify obj_type=%u inst=%u ...");
```

Comment mô tả việc cần làm; mã chỉ ghi log. Không byte nào rời card mạng. Ngoài ra
`dispatch_cov()` quét AI/BI chỉ từ 1..8 (`:295`) trong khi thiết bị có 16 UI — AI9–16
không được dò thay đổi kể cả khi COV được nối đúng.

### G-06 — Đăng ký 8 BI mà base SKU không có phần cứng · **P1**

**Evidence:** `bacnet_server.cpp:219` `for (int i = 0; i < 8; i++) Binary_Input_Create(i + 1);`

Xung đột trực tiếp với ba nguồn authority:
- `PRODUCT.md:84` — "true isolated DI trong base SKU" nằm trong danh sách **không có**.
- `PRODUCT_DEFINITION §68-70` (ADR-010) — "chỉ được expose khi `BOARD_CAP_MAP` báo capability".
- `mkddc_shm.h:68` — `KX_N_DI 8 /* reserved: DI optional SKU; base SKU stays 0 in SHM */`.
- PICS §4 khai **đúng**: "BI 0 base / 8 optional, capability-gated".

Mã nguồn tạo BI vô điều kiện. `board_cap_map` đã có sẵn trong iobus
(`main.cpp:666`), nên cổng capability là khả thi — chỉ là chưa áp dụng. BMS quét base
SKU sẽ thấy 8 BI luôn đọc `0` với quality BAD, tức là quảng bá phần cứng không tồn tại.

### G-07 — Object_Name của AI/BI/AV/BV/MSV không tới BACnet · **P2**

**Evidence:** chỉ `apply_ao_config()` (`bacnet_server.cpp:168-181`) gọi `Analog_Output_Name_Set`.
Không có `Analog_Input_Name_Set` ở bất kỳ đâu. Tên người dùng đặt trên Web UI cho AI
không bao giờ tới BMS; BMS luôn thấy tên mặc định của bacnet-stack.

### G-08 — Không có telemetry runtime; `bmsLink` suy diễn từ bind · **P1**

**Evidence:** `mkddc_shm.h:210-211`, `io_cache.cpp:248-255`, `networkapi.go:300-307`

```go
func bmsLinkStatus(telemetry *FieldbusTelemetry) string {
    if telemetry.BacnetBound { return "online" }
    return "offline"
}
```

`BacnetBound` được ghi bởi `write_bacnet_bind(bacnet_started, …)` với `bacnet_started`
= kết quả `bip_init()`. Nghĩa là **socket UDP mở thành công ⇒ FE hiện đèn xanh
"BMS Link: online"**, kể cả khi không có BMS nào trên mạng. Đây đúng là ngộ nhận mà đề
bài §4.F chỉ ra.

Đáng chú ý: comment ở `networkapi.go:293-299` khẳng định trạng thái này "không suy ra từ
file cấu hình" — điều đó đúng, nhưng nó **suy ra từ cờ bind**, vẫn là suy diễn.

Không có trường nào trong số: `lastRx`, `lastWhoIs`, `rxPackets`, `txPackets`,
`covSubscriptions`, `protocolErrors`, `boundInterface`, `serviceState`.

### G-09 — PICS là wishlist, không phải bằng chứng · **P0 · Rủi ro chứng nhận**

Xem bảng §2.2. 9/14 BIBB khai sai. Thêm ba lỗi nội tại trong PICS:

- **Mâu thuẫn nội bộ:** §4 khai AO "Present_Value (commandable)" và §4.2 khai
  "Priority_Array 16 mức", nhưng §4.1 lại ghi AO "Không writable qua BACnet".
- **Đường dẫn chết:** §4.1 và §4.2 trỏ `services/core/bacnet_objtable.cpp` —
  thư mục `services/` đã bị xoá theo `PLAN-ARCH-RESTRUCT-002`. Đường thật là
  `apps/core/adapters/bacnet/bacnet_objtable.cpp`.
- **`33_BACNET_OBJECT_ALIGNMENT_PLAN.md §2`** ghi AO property population nằm ở
  `apps/core/adapters/bacnet/bacnet_objtable.cpp`; thực tế nằm ở
  `apps/iobus/adapters/bacnet/bacnet_objects.cpp`.

Chính PICS đã tự viết ra nguyên tắc đúng (§4, ghi chú 2026-08-07): *"với hồ sơ chứng nhận
thì khai sai nguy hiểm hơn khai thiếu"*. Nguyên tắc đó cần được áp cho 9 dòng còn lại.

### G-10 — Không có requirement spec cho BACnet · **P1**

`docs/02_requirements/REQUIREMENTS.md` chỉ có `SYS-REQ-004` ("phải hỗ trợ BACnet/IP")
và `SWR-REQ-007` (hot-rebind khi đổi IP). Không có requirement nào cho COV, Priority
Array, discovery, object identity, hay diagnostics. PICS đang gánh vai trò requirement
spec mà nó không được thiết kế để gánh — và đó là một phần lý do nó trở thành wishlist.

Modbus RTU đã có bộ `MODBUS_RTU_PRODUCT_REQUIREMENTS.md` + traceability matrix riêng.
BACnet chưa có bộ tương đương.

### G-11 — Bằng chứng "target" thực ra là host · **P0 · Chặn Definition of Done**

Xem §5.2.

---

## 4. Đánh giá lại 6 finding đã biết (đề bài §4)

| Mã | Giả thuyết ban đầu | Kết quả xác minh |
|---|---|---|
| **A. COV** | "Có source, notification network chưa hoàn chỉnh" | **Nặng hơn giả thuyết.** Không chỉ notification thiếu (G-05) mà cả subscription cũng không được đăng ký (G-04). COV = NOT IMPLEMENTED trên mạng, TEST-ONLY trong mã |
| **B. Alarm/Event** | "Kiểm tra có gửi thật hay chỉ log" | **Chỉ log, và còn không log.** Comment ghi rõ "Placeholder"; `targets_` rỗng nên vòng lặp không chạy; `open()` không có caller nên `drain()` thoát ngay. Ba tầng chết chồng nhau |
| **C. BBMD / FD** | "Đừng gọi capability chỉ vì config có field" | **Xác nhận đúng.** 4 field trong struct, 0 field được parse, 0 lệnh gọi BVLC. PICS §5 khai ✅ |
| **D. Schedule/Calendar/Trend** | "Kiểm tra có register vào stack không" | **Không register.** Schedule/Calendar = TEST-ONLY (`BacnetScheduleObjects` không có caller sản phẩm). Trend Log = không tồn tại mã nào |
| **E. Object Registry** | "Không tạo object phần cứng giả" | **Đang tạo.** 8 BI vô điều kiện trái ADR-010/PRODUCT.md (G-06). Base SKU thật: 16 UI + 4 AO + 4 DO |
| **F. BMS Link** | "UDP bind ≠ BMS connected" | **Xác nhận đúng.** `bmsLinkStatus()` map thẳng `bip_init()` success → `online` (G-08) |

---

## 5. Vì sao mọi thứ đang xanh — ba cơ chế tạo bằng chứng giả

### 5.1 Bộ test host PASS mà không cần BACnet

Số đo thật đo trong phiên này (2026-09-10):

| Bước | Lệnh | Kết quả |
|---|---|---|
| Configure | `cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` | **exit 1** — FetchContent bacnet-stack 1.3.8 bị egress policy chặn (HTTP 403 từ `github.com`) |
| Configure | cùng lệnh với `-DMKDDC_ENABLE_BACNET=OFF -DMKDDC_ENABLE_HMI=OFF` | exit 0 |
| Build | `cmake --build build/fw --parallel` | exit 0 |
| Test | `ctest --test-dir build/fw --output-on-failure` | **1440/1440 PASS**, 0 fail, 1 skipped, 23.11s |

Trong 1440 test đó có **67 test mang tên BACnet** (`BacnetCov.*`, `BacnetPriority.*`,
`BacnetObjects.*`, `BacnetReliability.*`, `BacnetScheduleObject.*`, `BacnetObjTable.*`…),
tất cả PASS **với `MKDDC_ENABLE_BACNET=OFF`** — tức là bacnet-stack thậm chí không được
biên dịch vào.

Nguyên nhân cấu trúc: `apps/iobus/CMakeLists.txt:60-68` biên dịch `BACNET_SOURCES` vô
điều kiện và bọc mọi lời gọi bacnet-stack trong `#ifdef MKDDC_ENABLE_BACNET`. Các test
chỉ chạm vào phần logic thuần. **Không một test nào gửi hay nhận một gói UDP.** Vì vậy
"host tests PASS" không nói gì về việc BACnet có chạy hay không — nó chỉ nói rằng các
hàm không được gọi vẫn tính toán đúng.

> **Ghi chú blocker:** không dựng được build `BACNET=ON` trong môi trường phiên này vì
> policy egress chặn tải bacnet-stack. Đây là hạn chế môi trường, **không phải** kết luận
> về mã nguồn. Mọi finding ở trên đọc trực tiếp từ mã, không phụ thuộc build này.
> Cần mở khoá: cho phép `github.com` trong egress policy, hoặc vendor bacnet-stack 1.3.8
> vào repo/artifact nội bộ, hoặc cài `bacnet-stack>=1.3` qua pkg-config trên runner.

### 5.2 Hồ sơ pre-test 14/14 PASS chạy trên host, và kiểm sai thứ

`docs/07_records/evidence/bacnet-pretest/20260701T043258Z/`:

- `bacnet.conf` ghi `"bind_interface": "docker0"`; `summary.txt` ghi
  `Target: 172.17.0.1:47808`. Đây là **container trên máy build**, không phải board DDC-24.
- **T5 "WriteProperty AV1 prio=8 val=42.5 readback=42.500000 PASS"** — theo G-03, AV
  không có callback tới core. Bài test này chỉ chứng minh bacnet-stack nhớ được giá trị
  vừa ghi vào chính nó. Nó **không** chứng minh giá trị tới được core, càng không tới
  được I/O vật lý. Test PASS trong khi tính năng không tồn tại.
- **T6/T7 AO1 write + relinquish PASS** — cùng lỗi: readback đọc từ priority array nội
  bộ của bacnet-stack, không đọc từ authority.
- **T3 AI1 PASS** là bài duy nhất trong bộ này kiểm đúng thứ cần kiểm — và ngay cả nó
  cũng không có tín hiệu vật lý thay đổi để đối chiếu.

Script `tools/bacnet_pretest/bacnet_pretest.sh` còn ghi evidence vào
`docs/00_management/evidence/bacnet-pretest` trong khi hồ sơ thật nằm ở
`docs/07_records/evidence/bacnet-pretest` — hai đường dẫn lệch nhau.

### 5.3 Đèn `bmsLink` xanh khi không có BMS

Xem G-08.

---

## 6. Kiến trúc mục tiêu

Nguyên tắc: **Canonical Point là nguồn chân lý duy nhất; BACnet là một lớp export, không
phải một kho dữ liệu thứ hai.**

```
Physical I/O (16 UI, 4 AO, 4 DO)
      │  IOP/UART
      ▼
  io_shm (ui_value, ui_reliability, board_cap_map)
      │
      ▼
  mkddc-core — authority: arbitration, interlock, safe-state, priority
      │  single writer
      ▼
  kx_plc_shm_t  ← Canonical Point (ai/bi/ao/bo/av/bv/msv, value+quality+reliability)
      │
      ▼
  ┌──────────────────────────────────────────┐
  │  BACnet Export Registry   (MỚI)          │
  │  pointStableId · objectType ·            │
  │  objectInstance · objectName · units ·   │
  │  access · covIncrement · runtimeState    │
  │  ── capability-gated theo board_cap_map ─│
  └──────────────────────────────────────────┘
      │  đọc (Read_Property callback)      ▲  ghi (WriteProperty)
      ▼                                     │
  bacnet-stack objects  ──────────────────  │
      │                                     │
      ▼ UDP/IP                              │
  EXTERNAL BMS                              │
                                            │
  Đường ghi:  BMS → WriteProperty → Export Registry → Priority_Array[16]
              → winner → core.sock (PRIO_BACNET=3) → core authority
              → arbitration → physical output
              → core publish kết quả THẬT về plc_shm
              → Export Registry đọc lại → Present_Value phản ánh
                giá trị core ĐÃ ÁP DỤNG, không phải giá trị BMS đã gửi
```

**Bốn ràng buộc bắt buộc:**

1. **Read-back là authoritative.** `Present_Value` của AO/BO đọc từ `plc_shm.ao/bo` —
   là thứ core thực sự áp — chứ không từ priority array nội bộ. Khi core override,
   BMS phải thấy giá trị bị override, kèm `Status_Flags.OVERRIDDEN`.
2. **Object Instance là business identity, ổn định qua restart/rename/đổi cấu hình không
   liên quan.** Không dùng thứ tự mảng runtime. Instance được cấp từ `pointStableId` và
   lưu bền.
3. **Capability-gated export.** Object chỉ tồn tại khi `board_cap_map` xác nhận phần cứng
   có thật. Base SKU: AI×16 + AO×4 + BO×4 + AV/BV/MSV theo cấu hình. BI chỉ khi SKU có
   isolated-DI.
4. **Đổi UI mode làm đổi BACnet Object Type = breaking integration change.** Phải có
   validate + cảnh báo + apply tường minh, không đổi âm thầm.

---

## 7. Hard Release Gate — BMS Real Data

Chín bài dưới đây chạy trên **board DDC-24 thật**, với **BMS/BACnet test client thật**
trên LAN. Simulator, mock, fixture, host unit test **không** được tính là bằng chứng.

```
DDC-24 board ── Ethernet LAN ── PC/BMS/BACnet Test Client
```

| Test | Nội dung | Tiêu chí PASS | Chặn WP |
|---|---|---|---|
| **T1 Discovery** | BMS gửi Who-Is | Nhận I-Am đúng Device ID + Device Name đã cấu hình | WP-01 |
| **T2 Physical Input** | Gắn tín hiệu thật vào UI1, thay đổi mức | ReadProperty AI1.Present_Value đổi tương ứng, sai số trong dung sai đã công bố. **Không simulator** | WP-03 |
| **T3 RPM** | Đọc nhiều object trong một request | Mọi object trả đúng giá trị runtime; không object nào trả `0.0` giả | WP-02, WP-03 |
| **T4 Quality** | Inject fault thật ở nguồn I/O (hở mạch 4-20mA, quá dải, rút cảm biến) | Reliability/Status_Flags đúng theo ADR-011. **Không được biến UNKNOWN/BAD thành GOOD** | WP-03 |
| **T5 COV** | BMS SubscribeCOV AI1, rồi đổi tín hiệu vật lý | BMS nhận COV notification **không cần poll lại**; unsubscribe và hết lifetime đều có hiệu lực | WP-05 |
| **T6 Output** | BMS WriteProperty AO1 và BO1 | Đo **đầu ra vật lý thật** (đồng hồ ở AO1, tiếp điểm ở BO1) đổi đúng. Chuỗi đi qua BACnet → IOBUS → core authority → arbitration | WP-04 |
| **T7 Priority** | Hai lệnh khác mức ưu tiên; rồi release lần lượt | Winner đúng Priority_Array; release trả đúng owner kế tiếp hoặc Relinquish_Default | WP-04 |
| **T8 Restart** | Restart iobus/core, rồi power-cycle board | Object identity không đổi ngoài policy; BMS discover và đọc lại được | WP-02 |
| **T9 Config read-back** | Đổi Device ID / Device Name / UDP port rồi apply | Đọc **runtime authority** xác nhận giá trị mới. Không được báo SUCCESS chỉ vì file đã ghi | WP-07 |

**Bằng chứng phải lưu:** `docs/07_records/evidence/bacnet-hil/<UTC timestamp>/` gồm
capture Wireshark, log iobus, ảnh/số đo thiết bị đo, và `summary.txt` ghi rõ serial board,
firmware version, IP, Device ID.

---

## 8. Definition of Done

`BACNET_REV_A = READY` chỉ khi **đồng thời** đủ 15 điều kiện:

| # | Điều kiện | Hiện tại |
|---|---|---|
| 1 | Product scope frozen | ❌ chờ Owner (xem OD-BAC-*) |
| 2 | PICS khớp implementation | ❌ 9/14 BIBB sai |
| 3 | 0 placeholder trong capability Rev A | ❌ G-05, O-01 |
| 4 | Build production `BACNET=ON` | ⚠️ chặn bởi egress policy (§5.1) |
| 5 | Host tests PASS | ✅ 1440/1440 — **nhưng xem §5.1** |
| 6 | Target board tests PASS | ❌ chưa có |
| 7 | External BMS discovery PASS | ❌ chưa có |
| 8 | Physical Input → BACnet PASS | ❌ chưa có (T2) |
| 9 | COV thật PASS | ❌ tính năng chưa tồn tại (T5) |
| 10 | BACnet Write → Physical Output PASS | ❌ chưa có (T6) |
| 11 | Priority/Relinquish PASS | ❌ chưa có (T7) |
| 12 | Restart/recovery PASS | ❌ chưa có (T8) |
| 13 | Runtime diagnostics PASS | ❌ G-08 |
| 14 | Evidence trong `docs/07_records` | ❌ hồ sơ hiện có là host (§5.2) |
| 15 | Traceability cập nhật | ❌ chưa có ma trận BACnet |

**0/15 đạt trọn vẹn. Kết luận: NOT READY.**

---

## 9. Điều hướng

- Kế hoạch sửa theo Work Package, dependency graph, và danh sách Issue:
  [BACNET_REV_A_IMPLEMENTATION_PLAN.md](../03_implementation/BACNET_REV_A_IMPLEMENTATION_PLAN.md)
- Các điểm cần Owner ký trước khi implement:
  [BACNET_OPEN_DECISIONS.md](../00_governance/BACNET_OPEN_DECISIONS.md)

---
**Rev** 1.0 | 2026-09-10 — As-built review đầu tiên cho BACnet Rev A. Ký: ___
