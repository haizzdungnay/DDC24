# Rà soát tình trạng as-built vs spec — MK-DDC-24

> **Ngày:** 2026-08-07 · **HEAD:** `630a20c` · **Phạm vi:** FW SOM (`apps/core`, `apps/iobus`),
> FW MCU (`firmware/stm32`), BE (`apps/web-api`), FE (`apps/web-ui`), HMI (`apps/hmi`), netcfg
> **Phương pháp:** đọc source thực tế + chạy lại toàn bộ test tại HEAD. Không dẫn lại số cũ.

---

## 1. Số đo kiểm chứng chạy trong phiên

| Bộ test | Lệnh | Kết quả |
|---|---|---|
| C++ (core + iobus + hmi + netcfg + fw) | `cmake -S . -B build/audit2 -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` → `ctest` | **849/849 pass** (14,96 s) |
| Go BE | `go vet ./...` + `go test ./... -count=1` | **vet sạch, 11/11 package pass** |
| FE unit | `npx vitest --run --environment jsdom src` | **436/436 pass, 50 file** |

### 1.1 Bẫy đã gặp — số đo giả

Lần chạy đầu tôi dùng lại `build/audit-fw` có sẵn. CMakeCache của nó trỏ
`CMAKE_HOME_DIRECTORY=.../services` — **cây nguồn đã đổi tên thành `apps/` từ đợt restructure**.
Configure hỏng (`cmake=1`), build hỏng (`build=2`), nhưng `ctest` vẫn chạy **binary cũ** và báo
"744/744 pass". Một số đo hoàn toàn vô nghĩa nhưng trông như thật.

**Hệ quả cho quy trình:** `CLAUDE.md`/`AGENTS.md` vẫn ghi lệnh chuẩn là
`cmake -S services -B build/fw`. Thư mục `services/` không còn tồn tại. Ai làm theo hướng dẫn
sẽ hoặc gặp lỗi, hoặc — tệ hơn — chạy trúng một build dir cũ và nhận số đo của cây nguồn đã chết.
→ **F-00**, xem §5.

---

## 2. Bức tranh tổng thể

| Lớp | LOC (không tính test) | Trạng thái |
|---|---:|---|
| `apps/core` (C++17) | 14.871 | Chạy thật, trừ nhánh ST |
| `apps/iobus` (C++17/C) | 10.555 | Chạy thật, trừ COV/alarm BACnet |
| `apps/web-api` (Go) | 29.195 | Chạy thật, 71 endpoint |
| `apps/web-ui` (React/TS) | 24.262 | Chạy thật, trừ Programming |
| `apps/hmi` (LVGL) | 4.853 | Build + unit test; **service disabled trên bo** |
| `apps/netcfg` | 1.706 | Chạy thật |
| `firmware/stm32` | **565** | **Chỉ khung giao thức, không có driver** |

---

## 3. Đối chiếu theo từng khối

### 3.1 Component graph — ĐỒNG BỘ

`REVA_SCOPE §2` chốt "bộ component cố định Rev A = 28 type".
`apps/core/domain/graph/graph_runtime.cpp:41-57` đăng ký **đúng 28 type**, khớp 1-1 tên với
`SW_COMPONENT_LIBRARY`:

```
AI_Input DI_Input Setpoint | AND OR NOT Compare_GT Compare_LT | Scale Limit PID
AO_Output DO_Output | ManualAuto OnDelay OffDelay | Interlock RuntimeCounter PulseCounter
SafeState AlarmHigh AlarmLow AlarmDelay | Modbus_RTU_Read Modbus_RTU_Write Modbus_TCP_Read
BACnet_AV BACnet_BV
```

Priority resolver (`priority_resolver.hpp:15-21`) đúng 6 mức theo `PRODUCT_DEFINITION §13`.

### 3.2 Modbus RTU/TCP master — ĐỒNG BỘ, VƯỢT YÊU CẦU

`SW-MOD-003/004` yêu cầu FC03/04 đọc, FC06/16 ghi. Code hỗ trợ **đọc FC01/02/03/04**
(`device_profile.cpp:67`) và **ghi FC05/06/16** (`modbus_master.cpp:266-271`) — rộng hơn spec.
Baud/parity, địa chỉ slave 1–247, device profile, ext_cache stale/fallback: đủ.

### 3.3 BACnet/IP — LỆCH NẶNG

`REVA_SCOPE §2` chốt: "BACnet/IP server: AI/AO/BI/BO/AV/BV + ghi setpoint (interop demo)".

**Có thật:** BACnet/IP UDP/47808, Who-Is/I-Am, ReadProperty, ReadPropertyMultiple,
WriteProperty, ReinitializeDevice, TimeSync master. Object được tạo đủ số lượng
(`bacnet_server.cpp:214-226`): AI×16, BI×8, AO×4, BO×4, AV×32, BV×16, MSV×8.

**Lệch:** `sync_stack_inputs()` (`bacnet_server.cpp:229-254`) chỉ đẩy giá trị runtime từ SHM vào
**AI và BI**. Toàn repo **không có một lệnh `Analog_Value_Present_Value_Set` /
`Binary_Value_Present_Value_Set` / `Multistate_Value_Present_Value_Set` /
`Analog_Output_Present_Value_Set` / `Binary_Output_Present_Value_Set` nào**.

Nghĩa là với một client BACnet:
- AI/BI: đọc đúng giá trị thật ✅
- AO/BO: chỉ phản ánh giá trị **do chính BACnet ghi xuống**. Khi graph logic (mức ưu tiên 5)
  đổi AO, object BACnet không đổi theo → BMS đọc lại thấy sai.
- AV/BV/MSV: **luôn trả 0**. Mà AV chính là chỗ spec định nghĩa cho Setpoint
  (`PRODUCT_DEFINITION §11`: `Setpoint→AV · Command→BV/BO/AO`).

Đường ghi (BMS → core) thì chạy: `handle_output_write()` gửi xuống core qua `core.sock` ở
priority 3 kèm dòng AUDIT. Chỉ đường **đọc ngược** là thiếu.

→ **F-01**

### 3.4 BACnet COV và Alarm — CODE CHẾT

`SRS BAC-005` (Subscribe/Unsubscribe-COV) và `BAC-006` (Confirmed-Event-Notification).

- `bacnet_cov.cpp` (104 dòng) hiện thực đầy đủ bảng subscription + phát hiện thay đổi theo
  COV_Increment. Nhưng **không có `apdu_set_confirmed_handler(SERVICE_CONFIRMED_SUBSCRIBE_COV, …)`**
  → không client nào đăng ký được, bảng luôn rỗng.
- `dispatch_cov()` (`bacnet_server.cpp:279-330`) duyệt hết AI/BI/AO/BO/AV/BV/MSV, gọi
  `check_and_update()`, rồi với mỗi subscriber chỉ `fprintf(stderr, "INFO bacnet_cov.notify …")`.
  Comment ngay tại chỗ: `/* bacnet-stack: Send_COV_Subscribe_Unconfirmed or confirmed COV notification */`.
  **Không có gói nào ra dây.**
- `bacnet_alarm.cpp:88-100` `dispatch_event()` y hệt: vòng lặp qua `targets_`, thân vòng lặp là
  `(void)tgt;` và một comment `/* bacnet-stack: Send_CEvent_Notify / ucix_send_event — */`.
- `bacnet_schedule.cpp` (110 dòng) được biên dịch nhưng **không nơi nào trong repo tham chiếu tới
  `BacnetSchedule`** — code chết hoàn toàn.

Ngoài ra `dispatch_cov` quét AI/BI tới instance 8 trong khi `sync_stack_inputs` quét tới 16 —
AI9..AI16 không bao giờ được xét COV. Không gây hại vì COV vốn không hoạt động, nhưng là dấu
hiệu hai vòng lặp được viết lệch nhau.

Cũng thiếu so với SRS: `BAC-002` BBMD/Foreign-Device (chỉ có field config `bbmd_addr`,
không có lệnh đăng ký), `BAC-004` Write-Property-Multiple, `BAC-009` Segmentation.

→ **F-02**

### 3.5 FW MCU (STM32G0) — KHÔNG TRIỂN KHAI ĐƯỢC LÊN BO

565 dòng, chia làm: `iop_link.c` (176) + `ddc24_runtime.c` (153) + `main.c` (36).

Tầng giao thức IOP **đầy đủ và khớp contract**: cả SOM lẫn MCU cùng hiện thực đúng 12 lệnh
(`CMD_GET_IO`, `IO_RESP`, `SET_AO`, `SET_DO`, `ACK`, `SET_AO_CFG`, `GET_DIAG`, `DIAG_RESP`,
`HANDSHAKE`, `HANDSHAKE_RESP`, `RESET_IO`, `NACK`) theo `contracts/iop/iop_protocol.h`.

Nhưng toàn bộ tầng phần cứng là stub rỗng (`main.c:14-21`):

```c
__attribute__((weak)) bool fw_sample_inputs(...) { …; return false; }
__attribute__((weak)) bool fw_apply_ao(const uint16_t ao[4], uint8_t modes) { …; return false; }
__attribute__((weak)) bool fw_apply_do(uint8_t mask) { …; return false; }
```

Không có: HAL STM32, FreeRTOS (spec `SRS §2` yêu cầu), driver ADS131M08, driver DAC8554, GPIO
relay, watchdog phần cứng, DMA UART. `Makefile` không có `-T` linker script.

Trên bo, `mkddc-fakemcu.service` mô phỏng MCU qua cặp PTY (`/tmp/mkddc-iop-a`) và
`mkddc-iobus-nomcu.conf` trỏ iobus vào đó. `deploy_board.sh:14-15` khởi động
`mkddc-netcfg → mkddc-iobus → mkddc-core → mkddc-reload-helper → mkddc-web-pi`.

**Kết luận:** chưa có bất kỳ bằng chứng I/O vật lý nào. Mọi số đo timing/safety/power-recovery
đều đo trên MCU giả. Yêu cầu `IOP-005` (MCU mất GET_IO 200 ms → safe-state) chưa được chứng minh
trên silicon thật.

→ **F-03** (đã là G-01 trong audit 2026-08-03, **vẫn nguyên**)

### 3.6 ST / Program Runtime (ADR-020) — THƯ VIỆN, KHÔNG CHẠY

`apps/core/application/st/` có **6.606 dòng**: parser, semantic, IR, compiler, loader, exec,
process image, retain, scheduler, control API, trace, cộng 2 fuzz target và ký artifact.

Nhưng:
- `ScanLoop::Deps` (`scan_loop.hpp:52`) khai báo `StScheduler* st_sched = nullptr;`
- `apps/core/bootstrap/main.cpp` **không gán trường này** — grep `st_`/`Program` trong main.cpp
  trả về rỗng. Daemon production chạy với `st_sched == nullptr` vĩnh viễn.
- Chỉ hai CLI dùng tới compiler: `mkddc-st-validate`, `mkddc-st-compile`.
- BE Go: không có endpoint nào cho program/project/revision/artifact/io_map.
- FE: `/eng/programming` chỉ hiện khi `LEGACY_GRAPH_DEMO_ENABLED`
  (`config.ts:6-9` — chỉ bật ở `demo` mode + biến môi trường `VITE_ENABLE_LEGACY_GRAPH_DEMO=1`).
  Ở `live` mode render `UnavailableFeaturePage`.

→ **F-04** (G-02/G-03/G-04 cũ, **vẫn nguyên**)

### 3.7 Graph deploy + Validator v1 — THIẾU HẲN ĐƯỜNG SẢN PHẨM

`REVA_SCOPE §2` chốt là hạng mục **GIỮ** trong Rev A.0:
"Validator v1 (4 check an toàn cốt lõi)" và "Config qua FORM + import/export graph.json".

Thực tế:
- `contracts/openapi/openapi.yaml` **có khai báo** `/graph/deploy` và `/graph/validate`.
- Go BE **không hiện thực** cả hai (xem §4).
- Cái duy nhất tồn tại là `validateGraphLocal()` trong
  `apps/web-ui/src/shared/demo/simulator.ts` — chạy **trong trình duyệt**, trên một
  `sampleGraph` hard-code sẵn trong `ProgrammingPage.tsx:21`, và chỉ ở demo mode.
- `mkddc-core` đọc graph từ file `/data/config/graph.json` (`main.cpp:72`). Không có API nào
  ghi được file đó.

Tệ hơn: `sampleGraph` demo dùng type `UI_Input` và `Modbus_Read` — **hai tên không tồn tại**
trong registry của core (core dùng `AI_Input` và `Modbus_RTU_Read`). Nên ngay cả graph mà
validator demo báo "hợp lệ" cũng sẽ bị `GraphRuntime::load()` từ chối.

→ **F-05**

### 3.8 HMI — ĐỦ CODE, CHƯA CHẠY TRÊN PANEL

`SRS HMI-011` / `SW-HMI-007` yêu cầu đúng 5 surface. Code có đủ:
`screen_home.cpp`, `screen_io.cpp`, `screen_control.cpp`, `screen_alarm.cpp`,
`screen_service.cpp`. Test `NavControllerTest.FiveSurfaceRingWrapsInBothDirections` pass.
Có `hmi_api_client.cpp` đi qua broker có auth (đúng `SW-HMI-013`), `locale.cpp` EN/VI,
`screen_saver.cpp`, `evdev_touch.cpp` + `gpio_buttons.cpp`.

Nhưng `platform/packaging/install.sh:213-215` cài binary rồi **giữ service ở trạng thái
disabled**, kèm ghi chú "Bật thủ công khi board có panel". `deploy_board.sh` không có
`mkddc-hmi` trong `UNITS_START`. → `SW-HMI-012` (usability test trên panel thật) chưa chạy được.

### 3.9 Bảo mật web — LỆCH SO VỚI SRS

`SRS API-001` / `IDE-034` / `SW-API-001`: REST + Web IDE phải HTTPS TLS 1.3 trên 8443,
HTTP 8080 redirect sang HTTPS ở production build.

`apps/web-api/internal/app/main.go:284` dùng `server.ListenAndServe()` — **HTTP thuần**.
Không có `ListenAndServeTLS`, không có `TLSConfig`, không có logic redirect.

Phần đã đạt: RBAC 3 vai trò (`viewer`/`operator`/`admin`) bọc trên **từng** route qua
`router.Protected(...)`, đúng Amendment 2026-08-01 của REVA_SCOPE. Audit log có. Guard
last-admin có.

### 3.10 Scheduler v3.1 — CODE VƯỢT TRƯỚC TÀI LIỆU

`REVA_SCOPE §3` vẫn liệt kê "✗ WeeklySchedule / HolidaySchedule → Rev B".

Thực tế đã hiện thực xong và merge: `WeeklySchedule`, `ExceptionEntry`, `HolidayGroup`,
`DateRuleType{Date, DateRange, WeekNDay, CalendarReference, HolidayGroup}`, múi giờ theo từng
lịch, phát hiện nhảy giờ, 14 endpoint REST, 3 route FE + Editor 6 tab, revision/rollback/audit.

Đây là **lệch theo chiều ngược lại**: sản phẩm đi trước, `REVA_SCOPE` chưa được cập nhật.
Tương tự với historian/trend (`apps/web-api/internal/historian/`, `/history`,
`/history/export.csv`, `/trends/config`) — không nằm trong danh sách GIỮ của Rev A.0 nhưng đã
chạy thật.

→ **F-06**

---

## 4. Đồng bộ hợp đồng OpenAPI ↔ code

71 endpoint hiện thực trong `internal/app/http.go` vs 76 path khai báo trong
`contracts/openapi/openapi.yaml`.

**Khai báo trong OpenAPI nhưng KHÔNG có code (7):**

| Path | Ghi chú |
|---|---|
| `/graph/deploy` | **Rev A scope** — xem F-05 |
| `/graph/validate` | **Rev A scope** — xem F-05 |
| `/bacnet/objects` | Không có handler |
| `/logs/download` | `SRS LOG-005` / `SW-LOG-005` |
| `/ota/apply` `/ota/status` `/ota/upload` | OTA đã hoãn Rev B nhưng vẫn nằm trong hợp đồng |

**Có code nhưng KHÔNG khai báo trong OpenAPI (2):** `/modbus/write-test`, `/ws/monitor`.

→ **F-07**

---

## 5. Danh sách finding

| ID | Mức | Nội dung | Vị trí |
|---|---|---|---|
| F-00 | Cao | `CLAUDE.md`/`AGENTS.md` còn ghi `cmake -S services`; `services/` đã thành `apps/`. Build dir cũ khiến ctest chạy binary chết mà vẫn báo pass | `CLAUDE.md`, `AGENTS.md` |
| F-01 | Cao | BACnet không đẩy giá trị runtime vào AO/BO/AV/BV/MSV — AV/BV/MSV luôn đọc ra 0, AO/BO không phản ánh graph logic | `bacnet_server.cpp:229-254` |
| F-02 | Cao | COV và Confirmed-Event-Notification là stub `fprintf`/`(void)tgt`; không đăng ký handler SubscribeCOV; `bacnet_schedule.cpp` là code chết | `bacnet_cov.cpp`, `bacnet_alarm.cpp:88`, `bacnet_server.cpp:279` |
| F-03 | Chặn | FW MCU chỉ có tầng giao thức; toàn bộ HAL là stub weak trả `false`. Không FreeRTOS/ADC/DAC/relay/watchdog. Bo chạy fake MCU qua PTY | `firmware/stm32/Core/Src/main.c:14-21` |
| F-04 | Chặn | 6.606 dòng ST runtime không được `main.cpp` nối vào; `st_sched` mãi `nullptr`. Không có API BE, FE ẩn sau feature flag demo | `scan_loop.hpp:52`, `bootstrap/main.cpp` |
| F-05 | Cao | Graph deploy + Validator v1 (hạng mục GIỮ của Rev A.0) không có ở BE. Validator duy nhất chạy trong browser ở demo mode, và dùng tên type sai so với core | `simulator.ts`, `ProgrammingPage.tsx:21` |
| F-06 | Trung bình | `REVA_SCOPE` vẫn ghi WeeklySchedule/HolidaySchedule là Rev B trong khi Scheduler v3.1 đã merge và deploy; historian/trend cũng không có trong scope | `REVA_SCOPE_ROADMAP §3` |
| F-07 | Trung bình | OpenAPI lệch code: 7 path khai báo không có handler, 2 handler không khai báo | `contracts/openapi/openapi.yaml` |
| F-08 | Trung bình | Web chạy HTTP thuần, không TLS/redirect như `API-001`/`IDE-034` | `internal/app/main.go:284` |
| F-09 | Thấp | HMI đủ 5 surface + test nhưng service để disabled; chưa có usability test trên panel thật (`SW-HMI-012`) | `install.sh:213`, `deploy_board.sh:14` |
| F-10 | Thấp | Thiếu `BAC-002` BBMD/Foreign-Device (chỉ có field config), `BAC-004` WPM, `BAC-009` segmentation | `bacnet_server.cpp:117-127` |

---

## 6. Kết luận ngắn

Cái **chạy thật và khớp spec**: component graph 28 type, priority resolver 6 mức, safe-state,
snapshot, Modbus RTU/TCP master (vượt yêu cầu FC), IOP contract hai phía, RBAC 3 vai trò,
scheduler v3.1, historian/trend, netcfg. Ba bộ test đều xanh tại HEAD.

Cái **có code nhưng không chạy**: ST runtime (6.606 dòng), BACnet COV/alarm/schedule, HMI
(disabled), graph validator (chỉ trong browser demo).

Cái **chưa có**: driver MCU thật, đường deploy graph từ web, TLS, OTA, MQTT.

Khoảng cách lớn nhất giữa "spec nói" và "code làm" không nằm ở tính năng thiếu, mà ở chỗ
**có ba khối code lớn đã viết xong nhưng chưa được nối vào đường chạy sản phẩm** (ST, COV/alarm
BACnet, validator) — và ở chỗ **không có phần cứng thật nào từng chạy** (F-03), khiến mọi số đo
timing/safety hiện tại chỉ có giá trị trên MCU giả lập.

So với audit 2026-08-03: G-01 (fake MCU), G-02/03/04 (ST không wired) **vẫn nguyên**. G-07
(CI đỏ) đã xử lý — CI nay gọi `scripts/verify-project.sh` chạy thật ctest/go test/vitest/lint/
build/playwright. Bổ sung mới trong phiên này: F-00, F-01, F-02, F-05 (mismatch tên type), F-07.
