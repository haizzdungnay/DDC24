# 02 — Tính năng lập trình điều khiển, theo mã nguồn

Commit `8754a8e` · đo 2026-08-09

## 1. Phát hiện trung tâm

Dự án có **hai** hệ lập trình điều khiển tách rời nhau, và **không hệ nào tới được
người dùng cuối qua giao diện**:

| | Hệ A — engine ST/IEC | Hệ B — graph runtime |
|---|---|---|
| Vị trí | `apps/core/application/st/` | `apps/core/domain/graph/graph_runtime.cpp` |
| Quy mô | 6.606 dòng, 220 test | 989 dòng, 27 test |
| Mức hoàn thiện kỹ thuật | Rất cao — lexer, parser, semantic, IR nhị phân đã ký, VM, scheduler, retain, trace | Cao — 28 loại node, topo sort, trạng thái bền |
| Được `mkddc-core` gọi lúc chạy? | **Không** | **Có** |
| Nạp chương trình được từ giao diện? | **Không** | **Không** |
| Đường nạp duy nhất hiện có | không có | sửa tay `/data/config/graph.json` rồi SIGHUP |

Nói gọn: **hệ mạnh hơn thì không chạy; hệ đang chạy thì không lập trình được từ
giao diện.** Cách duy nhất để đưa logic điều khiển vào thiết bị hiện nay là SSH
vào máy, sửa tệp JSON bằng tay, rồi gửi tín hiệu SIGHUP — không qua phân quyền,
không ghi audit, không validate, không rollback.

## 2. Chuỗi bằng chứng

Đây là suy luận quan trọng nhất của bộ báo cáo, nên viết đủ để người đọc kiểm lại.

### 2.1 Engine ST không có điểm gọi lúc chạy

**Bước 1 — mã có được biên dịch vào nhị phân không?** Có.
[apps/core/CMakeLists.txt](../../../apps/core/CMakeLists.txt) đưa
`st_program.cpp`, `st_runtime.cpp`, `st_cyclic_runtime.cpp`, `st_scheduler.cpp`,
`st_control_api.cpp`, `st_retain.cpp`, `st_loader.cpp`, `st_exec.cpp` … vào
`core_application`, và `mkddc-core` link `core_lib` (bao gồm `core_application`).

**Bước 2 — có ai gọi không?** Không.

```bash
grep -nE '#include' apps/core/bootstrap/main.cpp   # không có header st/ nào
grep -rn 'StCyclicRuntime\|StControlApi\|st::' \
     apps/core/bootstrap apps/core/application/runtime \
     apps/core/adapters apps/core/domain apps/iobus   # rỗng
```

`main.cpp` include `graph_runtime`, `scan_loop`, `schedule_runtime`,
`safe_state_config`, `state_snapshot`, `bacnet_objtable`, `config_reload`,
`iobus_reader`, `output_writer` — không có `st/`. Vòng scan
([apps/core/application/runtime/scan_loop.cpp](../../../apps/core/application/runtime/scan_loop.cpp))
cũng không tham chiếu ST.

Kết luận: mã được **link vào** nhưng không được **gọi**. Nó chiếm chỗ trong nhị
phân và không làm gì.

**Bước 3 — có đường vào qua IPC không?** Không.
`st_handle_control_request()` là hợp đồng JSON hoàn chỉnh cho BE điều khiển
Program Runtime (7 mã lỗi `API-E-001…007`, cờ `keepsRunningPackage`, 34 test).
Nhưng bộ điều phối IPC thật
([apps/core/adapters/ipc/web_ipc.cpp](../../../apps/core/adapters/ipc/web_ipc.cpp))
chỉ nhận 8 lệnh: `write`, `release`, `query`, `point_snapshot`, `schedule_state`,
`alarm_list`, `alarm_ack`, `alarm_suppress`, `alarm_return`. Không có lệnh nào
định tuyến tới `st_control_api`.

Phía Go cũng vậy — toàn bộ `apps/web-api` **không có một lần khớp nào** với
`st_program`, `structured text`, `st_control`, `iec 61131` hay `/api/program`.

**Bước 4 — có công cụ dòng lệnh không?** Có, nhưng không ai gọi.
`mkddc-st-validate` và `mkddc-st-compile` được build và có thiết kế rõ ràng là
"cổng cho BE gọi" (argv cố định, nguồn luôn qua đường tệp, không shell-eval).
Nhưng:

- Không tệp `.go`/`.ts`/`.service` nào gọi hai binary này.
- `platform/packaging/install.sh` — bản cài chính thức — **không cài** chúng.
- Chỉ `tools/deploy/deploy_board.sh` (kịch bản dev) copy chúng lên bo lab.
- Kịch bản `apps/core/application/st/samples/be_integration_test.sh` mô phỏng
  luồng BE gọi, nhưng không CI job nào chạy nó.

### 2.2 Trang Lập trình của FE không tới được ở bản live

[apps/web-ui/src/shared/config.ts:6-9](../../../apps/web-ui/src/shared/config.ts#L6-L9):

```ts
export function isLegacyGraphDemoEnabled(mode: DdcMode, flag: string | undefined): boolean {
  return mode === 'demo' && flag === '1'
}
```

Cờ đòi **đồng thời** `VITE_DDC_MODE !== 'live'` và `VITE_ENABLE_LEGACY_GRAPH_DEMO === '1'`.
Ở bản dựng live, `LEGACY_GRAPH_DEMO_ENABLED` luôn `false`, nên
[App.tsx:136-147](../../../apps/web-ui/src/app/App.tsx#L136-L147) render
`UnavailableFeaturePage` thay cho `ProgrammingPage`, và
[NavRail.tsx:108](../../../apps/web-ui/src/shared/components/NavRail.tsx#L108) ẩn
luôn mục menu.

Trang `UnavailableFeaturePage` nói thẳng với người dùng rằng canvas lập trình khối
thuộc phạm vi Rev B. Cách xử lý này đúng — thà nói rõ còn hơn đá người dùng về
Dashboard không kèm lý do (bình luận WEB-UX-007 trong `App.tsx` ghi lại chính
lý do đó).

Ngay cả khi bật cờ demo, `ProgrammingPage` cũng chỉ là mô phỏng cục bộ:
`validate()` gọi `validateGraphLocal()` từ `shared/demo/simulator`, và
`deployDemo()` chỉ hiện toast `'Đã deploy (demo)'` — không có lệnh mạng nào.
Banner đầu trang tự khai báo điều này.

### 2.3 Hợp đồng API hứa hai endpoint không tồn tại

`contracts/openapi/openapi.yaml` tự nhận là "nguồn-chuẩn cho endpoint (D-4)" và
khai `POST /graph/validate` (operator+) cùng `POST /graph/deploy` (admin), kèm
lược đồ `Graph`, `GraphValidationResult`, `GraphDeployResult`.

Đối chiếu bảng định tuyến thật trong
[apps/web-api/internal/app/http.go](../../../apps/web-api/internal/app/http.go):
**không có handler nào cho hai đường dẫn này.** Toàn bộ `apps/web-api` cũng không
có một lần khớp nào với chuỗi `graph`.

Đây là mảnh ghép cuối: FE mô phỏng cục bộ vì BE không có endpoint để gọi; BE
không có endpoint vì chưa ai hiện thực; và hợp đồng vẫn hứa hẹn như thể đã có.

Đã xử lý trong phiên này — xem SRC-F-02 ở
[07_PHAT_HIEN_VA_KHUYEN_NGHI.md](07_PHAT_HIEN_VA_KHUYEN_NGHI.md).

### 2.4 `graph.json` nằm ngoài mọi cơ chế quản lý cấu hình

`mkddc-core` nạp chương trình từ `/data/config/graph.json`
([main.cpp:72](../../../apps/core/bootstrap/main.cpp#L72), đổi được bằng `--graph`),
và nạp lại được ở ranh giới scan qua `config_reload` mà không cần restart.

Nhưng BE quản lý đúng 8 nhóm cấu hình
([configapi.go:38-45](../../../apps/web-api/internal/app/configapi.go#L38-L45)):
`device.conf`, `network.conf`, `io_config.conf`, `io_safe_state.conf`,
`virtual_points.conf`, `bacnet.conf`, `fieldbus.conf`, `time.conf`.

`graph.json` — tệp định nghĩa **logic điều khiển của toàn thiết bị** — không nằm
trong danh sách. Hệ quả trực tiếp: nó không có RBAC, không có audit, không có bản
ghi phiên bản, không có rollback, và không có validate phía máy chủ. Mọi cơ chế
quản trị thay đổi mà dự án đã xây cẩn thận cho 8 nhóm kia đều không áp cho nó.

## 3. Hệ A — engine ST/IEC: cái gì đã có thật

Phần này ghi nhận công sức kỹ thuật đã bỏ ra. Mã ở đây chất lượng cao; vấn đề
thuần tuý là nó chưa được nối vào hệ thống.

### 3.1 Kiến trúc

```
source .st ──[st_parser]──> AST ──[st_semantic]──> AST đã gán kiểu
                                        │
                                  [st_compile]
                                        ↓
                              StIrModule (st_ir)
                                        │
                            serialize + SHA-256 + ký Ed25519
                                        ↓
                             artifact .mkir (nhị phân)
                                        │
      ═══════ RANH GIỚI: runtime không bao giờ thấy mã nguồn ═══════
                                        │
                                  [st_loader] verify
                                        ↓
                    StProgramRuntime → StCyclicRuntime → StScheduler
```

Ranh giới giữa compiler và runtime là **ràng buộc lúc link**, không phải quy ước:
`st_compiler_lib` (parser + semantic + compile + ir) là target riêng, và
`mkddc-core` không link nó. CI kiểm lại bằng `nm -C` trên nhị phân đã build.

### 3.2 Tập con ngôn ngữ ST đã hiện thực

Trích từ [st_program.hpp](../../../apps/core/application/st/st_program.hpp) và
danh sách từ khoá trong [st_parser.cpp](../../../apps/core/application/st/st_parser.cpp):

| Hạng mục | Đã có | Chưa có |
|---|---|---|
| Kiểu dữ liệu | `BOOL`, `INT`, `REAL`, `TIME` (ns, không âm) | `STRING`, `WORD`/`DWORD`, `LINT`, mảng, struct, kiểu người dùng |
| Lớp lưu trữ | `VAR_INPUT`, `VAR_OUTPUT`, `VAR`, `VAR ... RETAIN` | `VAR_GLOBAL`, `VAR_IN_OUT`, `VAR_TEMP`, `VAR_EXTERNAL` |
| Câu lệnh | gán, `IF`/`ELSIF`/`ELSE`/`END_IF`, gọi FB | `CASE`, `FOR`, `WHILE`, `REPEAT`, `EXIT`, `RETURN` |
| Đơn vị tổ chức | `PROGRAM`/`END_PROGRAM` | `FUNCTION`, `FUNCTION_BLOCK` do người dùng định nghĩa |
| Function Block chuẩn | `TON`, `TOF`, `R_TRIG`, `F_TRIG` | `CTU`, `CTD`, `CTUD`, `SR`, `RS`, `TP` |
| Hàm chuẩn | `ABS`, `MIN`, `MAX`, `LIMIT`, `SEL`, `SQRT`, `INT_TO_REAL`, `REAL_TO_INT`, `TIME_TO_REAL`, `REAL_TO_TIME` | phần lớn thư viện hàm IEC còn lại |
| Toán tử | `+ - * / MOD`, `< <= > >= = <>`, `AND OR XOR NOT`, đảo dấu | `**`, thao tác bit |

Đây là **tập con có kỷ luật**, không phải bản cài dở. Việc bỏ vòng lặp là lựa
chọn có chủ đích và đúng cho bộ điều khiển chu kỳ: không có vòng lặp thì thời gian
thực thi chặn trên được theo số lệnh, nên "một chương trình sai không thể treo
vòng scan" trở thành tính chất cấu trúc thay vì thứ phải canh bằng watchdog.

### 3.3 Giới hạn tài nguyên

[st_limits.hpp](../../../apps/core/application/st/st_limits.hpp) là **một nguồn sự
thật duy nhất** cho cả parser, CLI validate và loader:

| Giới hạn | Giá trị | Lý do ghi trong mã |
|---|---:|---|
| Kích thước nguồn | 64 KiB | |
| Token | 32.768 | Đặt **cao hơn** ngưỡng cấu trúc có chủ ý, để input lồng sâu nhận đúng chẩn đoán `ST-SYN-002` ("lồng quá sâu") thay vì `ST-LIM-002` ("quá nhiều token" — không giúp gì cho người dùng) |
| Độ sâu biểu thức | 32 | ~6 stack frame/cấp trong recursive descent ⇒ ~200 frame, an toàn với stack 8 MB |
| Độ sâu câu lệnh | 16 | logic HVAC thật hiếm khi vượt 5 |
| Biến | 512 | |
| Câu lệnh | 4.096 | |
| Instance FB | 64 | |
| Biến RETAIN | 128 | |

Lý do tệp này tồn tại được ghi thẳng trong header: parser là recursive descent,
không giới hạn độ sâu thì biểu thức lồng sâu làm tràn stack và tiến trình chết
bằng `SIGSEGV` — không chẩn đoán, không JSON, không gì cho BE xử lý. Giới hạn phải
nằm ở tầng ngôn ngữ để trả về chẩn đoán, không phải ở tầng hệ điều hành.

### 3.4 Định dạng artifact Typed IR

[st_ir.hpp](../../../apps/core/application/st/st_ir.hpp): magic `MKDDCIR1`, header
128 byte, 8 loại section, lệnh cố định 16 byte, tối đa 1 MiB.

- **Máy thanh ghi** trên mảng ô phẳng: `[0, var_slot_count)` ghi được,
  `[var_slot_count, slot_count)` là hằng chỉ đọc. Loader kiểm mọi `dst <
  var_slot_count`, nên "hằng không ghi đè được" là bất biến **kiểm được**.
- **32 opcode**: điều khiển luồng (`JMP`, `JMP_IF_FALSE`, `HALT`), số học, so
  sánh, logic, `ABS/MIN/MAX/LIMIT/SEL/SQRT`, 4 lệnh chuyển kiểu, `FB_CALL`.
- **Trường không dùng phải bằng 0** — loader từ chối nếu khác, để chặn kênh dữ
  liệu ẩn và bắt lỗi sinh mã sớm.
- **Toàn vẹn**: SHA-256 + chữ ký Ed25519 qua libsodium. Chọn libsodium thay vì GPG
  vì việc verify phải chạy **in-process** trong vòng `SCHED_FIFO`:
  `crypto_sign_verify_detached` không cấp phát, không I/O, thời gian ổn định.

### 3.5 Vòng đời và scheduler

[st_scheduler.hpp](../../../apps/core/application/st/st_scheduler.hpp): ưu tiên cố
định, **không preempt** tại ranh giới task. Tối đa 8 task, 32 program, chu kỳ
50–60.000 ms, tick cơ sở 50 ms.

Không preempt làm cho "process image không đổi trong một lần thực thi Program"
thành bất biến cấu trúc, đồng thời loại khoá khỏi đường điều khiển — nên không có
priority inversion và không có biến động thời gian do khoá. Đồng hồ do caller
truyền vào và chụp **một lần** cho cả tick, nhờ vậy hai timer khởi động cùng tick
sẽ hết hạn cùng tick, và test dùng được đồng hồ giả (không sleep, không flaky).

11 trạng thái vòng đời: `EMPTY → STAGED → VALIDATED → READY → ACTIVE → RUNNING`,
cùng `STOPPED`, `DISABLED`, `FAULTED`, `ROLLED_BACK`, `REJECTED`.

Cơ chế last-known-good giữ **byte artifact** chứ không giữ đối tượng đã nạp, để
rollback luôn đi lại đúng đường verify — rollback không được phép là cửa sau bỏ
qua kiểm tra. Activation chỉ áp ở **ranh giới đầu chu kỳ kế tiếp**, không bao giờ
giữa lúc `execute()` đang chạy.

### 3.6 Hệ mã chẩn đoán

42 mã ổn định, chia họ theo tầng để BE biết lỗi đến từ đâu mà không phải phân
tích chuỗi thông báo:

| Họ | Số mã | Tầng |
|---|---:|---|
| `ST-LEX-*` | 3 | từ vựng |
| `ST-SYN-*` | 2 | cú pháp |
| `ST-SEM-*` | 14 | ngữ nghĩa/kiểu |
| `ST-LIM-*` | 8 | vượt giới hạn tài nguyên |
| `ST-IOMAP-*` | 7 | ánh xạ I/O |
| `ST-RT-*` | 8 | lỗi lúc chạy |
| `API-E-*` | 7 | tầng giao tiếp với BE |
| `IR-E-*` | — | loader artifact |

### 3.7 Độ phủ test của engine ST

220 test trên 13 bộ, tất cả pass:

| Bộ | Test | | Bộ | Test |
|---|---:|---|---|---:|
| `StLang` | 45 | | `StValidateCli` | 14 |
| `StScheduler` | 30 | | `StRetain` | 12 |
| `StExec` | 20 | | `StIoMap` | 12 |
| `StIr` | 19 | | `StCyclicRuntime` | 10 |
| `StLimits` | 19 | | `StIntegration` | 9 |
| `StControlApi` | 17 | | `StIrSecurity` | 5 |
| `StateSnapshot` | 8 | | | |

Kèm 2 harness fuzz (`fuzz_st_parser`, `fuzz_st_loader`) chạy trong CI mỗi PR.

`StValidateCli` đặc biệt đáng ghi nhận: nó `fork`+`execv` nhị phân **thật** với
đường dẫn tuyệt đối sinh bởi generator expression của CMake, nên test kiểm đúng
thứ sẽ chạy trên thiết bị chứ không kiểm một bản dựng lại trong test.

## 4. Hệ B — graph runtime: cái đang thật sự chạy

[apps/core/domain/graph/graph_runtime.cpp](../../../apps/core/domain/graph/graph_runtime.cpp)
(989 dòng cả header) là engine **đang chạy** trong `mkddc-core`: nạp `graph.json`
→ validate → sắp xếp topo → thực thi mỗi scan.

**28 loại node:**

| Nhóm | Loại |
|---|---|
| Vào/ra (5) | `AI_INPUT`, `DI_INPUT`, `SETPOINT`, `AO_OUTPUT`, `DO_OUTPUT` |
| Logic/so sánh (5) | `AND`, `OR`, `NOT`, `CMP_GT`, `CMP_LT` |
| Xử lý tín hiệu (3) | `SCALE`, `LIMIT`, `PID` |
| Điều khiển/định thời (6) | `MANUAL_AUTO`, `ON_DELAY`, `OFF_DELAY`, `INTERLOCK`, `RUNTIME_COUNTER`, `PULSE_COUNTER` |
| An toàn/cảnh báo (4) | `SAFE_STATE`, `ALARM_HIGH`, `ALARM_LOW`, `ALARM_DELAY` |
| Giao thức (5) | `MODBUS_RTU_READ`, `MODBUS_RTU_WRITE`, `MODBUS_TCP_READ`, `BACNET_AV`, `BACNET_BV` |

Có trạng thái bền qua mất điện cho `RUNTIME_COUNTER` và `PULSE_COUNTER` (giờ chạy
và số xung không được reset khi khởi động lại — đúng yêu cầu bảo trì thiết bị),
PID giữ tích phân, các node so sánh/cảnh báo có trễ (hysteresis).

So với hệ A, hệ B yếu hơn về biểu đạt (không biến, không kiểu, không FB người dùng)
nhưng **nó chạy thật**. Với phần lớn logic HVAC thường gặp, 28 node này là đủ.

## 5. Đối chiếu với những gì FE trưng ra

`ProgrammingPage` có thư viện 13 component. Đối chiếu với 28 node của
`graph_runtime`:

| Component ở FE | Có node tương ứng trong core? |
|---|---|
| `UI_Input`, `Setpoint`, `PID`, `AO_Output` | Có (`AI_INPUT`, `SETPOINT`, `PID`, `AO_OUTPUT`) |
| `AND`, `OR` | Có |
| `OnDelay`, `OffDelay` | Có |
| `Interlock`, `AlarmDelay` | Có |
| `RuntimeCounter`, `PulseCounter` | Có |
| `Modbus_Read` | Có (`MODBUS_RTU_READ`) |

13/13 có node tương ứng — thư viện FE là tập con hợp lệ. Nhưng validator chạy ở
FE là bản cài lại trong TypeScript (`shared/demo/simulator.ts`), độc lập hoàn
toàn với validator C++ trong `graph_runtime`. Hai bản cài của cùng một quy tắc,
không có test nào ràng chúng phải khớp — dạng lệch sẽ đúng cho tới ngày nó sai và
không ai biết.

Dự án đã nhận ra và tránh đúng cái bẫy này ở chỗ khác: BE gọi binary
`mkddc-schedule-sim` để mô phỏng lịch bằng **đúng engine C++ của controller**, thay
vì cài lại thuật toán trong Go. Bình luận trong `apps/core/CMakeLists.txt` ghi rõ
lý do — "bản cài lại sẽ đúng cho tới ngày nó lệch khỏi bản C++, và ngày đó không
ai biết". Cùng nguyên tắc đó chưa được áp cho validator graph.

## 6. Đánh giá theo IEC 61131-3

Nếu mục tiêu là tuyên bố tuân thủ IEC 61131-3, trạng thái hiện tại là:

| Tiêu chí | Trạng thái |
|---|---|
| Ngôn ngữ ST — tập con | Có, có kỷ luật, thiếu `CASE`/`FOR`/`WHILE`/`REPEAT` và FUNCTION/FB người dùng |
| Ngôn ngữ FBD | Không có ngôn ngữ FBD theo chuẩn; `graph.json` là định dạng riêng |
| Ngôn ngữ LD, IL, SFC | Không có |
| Kiểu dữ liệu chuẩn | 4/nhiều — thiếu `STRING`, kiểu bit, mảng, struct |
| FB chuẩn | 4/nhiều — thiếu nhóm đếm (`CTU`/`CTD`/`CTUD`) và bistable (`SR`/`RS`) |
| Mô hình thực thi task | Có, và làm tốt — ưu tiên cố định, không preempt, ngân sách + giám sát overrun |
| Biến RETAIN | Có, kèm băm bố cục và kiểm bản ghi |
| Công cụ lập trình cho người dùng | **Không có** |

Chưa đủ để tuyên bố tuân thủ IEC 61131-3. Rào cản lớn nhất không phải phần ngôn
ngữ còn thiếu — mà là **không có công cụ nào cho người dùng viết, nạp, và gỡ lỗi
chương trình**. Chuẩn định nghĩa môi trường lập trình, không chỉ định nghĩa cú pháp.

## 7. Việc cần làm để nối được đầu này với đầu kia

Xếp theo thứ tự phụ thuộc, không phải theo độ khó:

1. **Đưa `graph.json` vào nhóm cấu hình BE quản lý.** Nhóm thứ 9 trong
   `configapi.go`, dùng lại nguyên bộ máy đã có: RBAC, audit, ghi nguyên tử,
   SIGHUP core. Đây là bước rẻ nhất và mở khoá được nhiều nhất — nó biến việc
   sửa tay qua SSH thành thao tác có kiểm soát.
2. **Hiện thực `POST /graph/validate`.** Gọi binary C++ như cách
   `mkddc-schedule-sim` đang được gọi, thay vì cài lại validator trong Go. Cần
   thêm một CLI mỏng bọc `GraphRuntime::validate`.
3. **Hiện thực `POST /graph/deploy`** dựa trên (1) và (2).
4. **Nối FE vào endpoint thật** — bỏ `validateGraphLocal`, gỡ cờ
   `LEGACY_GRAPH_DEMO_ENABLED`.
5. **Quyết định số phận engine ST.** Ba lựa chọn, cần chốt rõ:
   - *Nối vào*: thêm `StScheduler` vào vòng scan, định tuyến `st_control_api`
     qua `web_ipc`, cài `mkddc-st-compile`/`mkddc-st-validate` trong `install.sh`,
     thêm endpoint BE. Đây là khối lượng lớn nhưng phần khó nhất đã xong.
   - *Đóng băng*: ghi rõ là tài sản Rev B, giữ test chạy để không mục, và ghi
     nhận chi phí bảo trì đang trả cho mã chưa dùng.
   - *Gỡ bỏ*: thu hồi 6.606 dòng và 220 test khỏi chi phí bảo trì.

   Điều **không** nên làm là để nguyên tình trạng hiện tại — mã sống trong nhị
   phân, được test đầy đủ, và không ai gọi. Trạng thái đó tốn chi phí của cả
   phương án giữ lẫn phương án bỏ mà không cho lợi ích của phương án nào.
