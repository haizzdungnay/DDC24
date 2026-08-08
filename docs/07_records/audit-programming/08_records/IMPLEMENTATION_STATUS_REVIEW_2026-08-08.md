# Báo cáo trạng thái implement Programming — FE, BE, FW SOM

**Mã:** `AUDIT-PROGRAMMING-IMPL-2026-08-08`

**Ngày review:** 2026-08-08

**Commit nền:** `1b02d415f9bb2eb9e69f94bb772fe4402c32cfa8` (`main`)

**Loại review:** source-first, đối chiếu requirement/design, build/test và browser local.

**Phân loại:** RECORD tại ngày chụp; không thay Requirement/Design/Verification
baseline và không tự cập nhật theo source sau ngày 2026-08-08.

**Quyết định:** **NOT IMPLEMENTED end-to-end / NO-GO production**.

## 1. Kết luận điều hành

Không có Product Capability `PC-PROG-001..012` nào đạt mức **production complete**.
Mã hiện tại gồm ba mảnh không nối thành một sản phẩm:

1. FE có legacy `graph.json` demo, bị khóa khỏi live build và tự validate/simulate trong
   browser.
2. BE không có Programming authority/API/persistence; OpenAPI còn hai endpoint graph
   không có handler.
3. FW SOM có ST component host-only tương đối sâu, nhưng production bootstrap truyền
   `st_sched = nullptr`; không có FBD, không có Programming transport và I/O Mapping
   chưa có Modbus RTU Point.

Vì vậy, không được dùng 220 test ST/IR/component hoặc màn hình demo PASS để tuyên bố
Programming đã implement. Authority verification vẫn ghi `VR-PROG-001..013 = RED`.

## 2. Phạm vi và phương pháp

### Phạm vi source

| Layer | Source chính đã review |
|---|---|
| FE | `apps/web-ui/src/app`, `features/dashboard/ProgrammingPage.tsx`, `UnavailableFeaturePage.tsx`, `shared/config.ts`, `shared/api/client.ts`, `shared/demo/simulator.ts`, types/tests/navigation |
| BE | `apps/web-api/internal/app`, router, auth/audit, config/persistence; đối chiếu `contracts/openapi/openapi.yaml` |
| FW SOM | `apps/core/bootstrap`, `application/st`, `application/runtime`, `domain/graph`, CMake và test |
| Biên phụ thuộc | Point Table/Modbus runtime trong Core/IOBus ở mức cần thiết để xác nhận I/O Mapping Programming |

Không review MCU STM32 như một implementation Programming riêng; MCU/HIL vẫn là dependency
release bên ngoài đường Programming của SOM.

### Thang trạng thái

| Trạng thái | Nghĩa |
|---|---|
| COMPLETE | Có luồng production end-to-end, authority rõ và bằng chứng VR tương ứng |
| PARTIAL COMPONENT | Có code/test tái sử dụng được nhưng chưa nối hoặc chưa đạt contract Product |
| DEMO ONLY | Chỉ chạy mock/local, không tác động authority/runtime thiết bị |
| NOT IMPLEMENTED | Không có luồng source đáp ứng requirement |
| SAFE-DISABLED | Capability production bị chặn rõ, không giả là đang hoạt động |

## 3. Ma trận Product Capability

| Capability | FE | BE | FW SOM | Kết luận production |
|---|---|---|---|---|
| PC-PROG-001 Project/Program | Không có model/editor | Không API/store | Chỉ có `ProgramInstance`, không Project/Revision persistence | NOT IMPLEMENTED |
| PC-PROG-002 Point/Variable/I/O Mapping | Legacy graph form | Không contract Programming | ST I/O map component chỉ một phần | PARTIAL COMPONENT, chưa end-to-end |
| PC-PROG-003 Local Physical I/O | Demo UI/AO | Không Programming mapping API | Có UI/DI/AO/DO bridge component | PARTIAL COMPONENT |
| PC-PROG-004 Virtual Point | Không Programming UX | Có API Virtual Point product-wide, không phải Programming mapping | IR/process image có AV/BV/MSV nhưng authoring validator lệch | PARTIAL COMPONENT |
| PC-PROG-005 Modbus RTU Point | Demo `Modbus_Read` legacy | Có Modbus product-wide, không có Programming mapping | ST IR không có RTU Point kind/binding | NOT IMPLEMENTED |
| PC-PROG-006 ST | Không editor/diagnostic production | Không gọi CLI/compiler | Parser/semantic/compiler/IR/loader/executor có host component | PARTIAL COMPONENT |
| PC-PROG-007 FBD | Không canvas/semantic FBD | Không model/compiler API | Không có FBD → IR compiler | NOT IMPLEMENTED |
| PC-PROG-008 cycle 1/5/30 s | Không chọn/hiển thị production | Không lifecycle/config | Scheduler nhận mọi bội 50 ms trong 50..60000 ms | PARTIAL COMPONENT, lệch allowlist |
| PC-PROG-009 Revision/Deploy/Activate/Rollback | Nút simulate chỉ toast | Không authority/store/API | Có pending activation/LKG/rollback trong RAM của component | PARTIAL COMPONENT, chưa production |
| PC-PROG-010 RETAIN | Không policy/UX | Không persistence Programming | `StRetainStore` có code/test nhưng không được production gọi | PARTIAL COMPONENT |
| PC-PROG-011 Online Monitor | Không Programming monitor | Không endpoint/stream Programming | `program_status` trả JSON trong pure handler chưa có transport | PARTIAL COMPONENT |
| PC-PROG-012 negative scope | Live route bị khóa; demo validator vẫn duyệt nhánh Modbus TCP | Không Programming API để enforce | ST map không có TCP/BACnet nhưng contract allowlist cũng chưa hoàn chỉnh | SAFE-DISABLED một phần, chưa có proof end-to-end |

**Tổng:** `0/12 COMPLETE`; có supporting component nhưng không có capability production.

## 4. Frontend

### 4.1 Phần đã làm đúng

- `isLegacyGraphDemoEnabled()` chỉ trả true khi `mode === 'demo'` và cờ
  `VITE_ENABLE_LEGACY_GRAPH_DEMO === '1'`; live build không thể bật nhầm bằng riêng cờ.
- Navigation lọc mục Programming khi cờ tắt.
- Deep link `/eng/programming` dùng trang giải thích thay vì chuyển hướng im lặng.
- Trang demo có banner rõ: local simulation only, không validate/deploy tới device.
- Hai test config/navigation liên quan gate đạt `17/17`.

Đây là fail-closed presentation tốt, nhưng chỉ chứng minh capability **không bị quảng cáo
nhầm trong live**, không chứng minh Programming đã có.

### 4.2 Phần chỉ là demo

`ProgrammingPage.tsx`:

- hard-code `sampleGraph` và thư viện 13 node legacy;
- chỉ là textarea `graph.json`, không có Project/Program/Revision;
- không có ST editor hoặc diagnostic từ compiler;
- không có FBD canvas, block contract, type-check hoặc FBD → typed IR;
- `validate()` gọi thẳng `validateGraphLocal(text)` đồng bộ;
- `deployDemo()` chỉ đẩy toast “Đã deploy (demo)”; không gọi API;
- không có cycle selector, immutable Revision, authority status, rollback, RETAIN policy
  hoặc Online Monitor.

Browser local với cờ demo xác nhận: sample chuyển `NOT TESTED → PASS`; bấm Simulate hiện
toast `Deployed (demo)`; danh sách Network không có request `fetch/xhr` cho hai thao tác.

### 4.3 Finding FE

| ID | Mức | Finding | Dẫn chứng |
|---|---|---|---|
| AP-FE-001 | P0 | Trang unavailable nói FBD canvas thuộc Rev B, trái ADR-023/Product Spec hiện hành: FBD thuộc Rev A. | `App.tsx:131-140` |
| AP-FE-002 | P0 | FE demo không đáp ứng bất kỳ workflow Product Programming nào ngoài edit/validate graph legacy cục bộ. | `ProgrammingPage.tsx:21-199` |
| AP-FE-003 | P1 | `api.validateGraph()` là dead/drift path: thử `/graphs/{id}/validate`, catch mọi lỗi rồi fallback `/graph/validate`; trang Programming không gọi hàm này. | `client.ts:1498-1507` |
| AP-FE-004 | P1 | Demo graph type/validator mang `modbus.tcp` và kiểm cả `rtu`,`tcp`, trái negative scope nếu tái dùng làm Programming. | `types.ts:693-709`, `simulator.ts:591-599` |
| AP-FE-005 | P1 | Không có test interaction/contract/E2E cho Product Programming; chỉ có test feature gate/navigation. | inventory test dưới `apps/web-ui/src` và `e2e` |

## 5. Backend

### 5.1 Trạng thái route và authority

Route table `App.Router()` đăng ký health/auth/points/virtual-points/Modbus/alarm/
commissioning/config/history/scheduler và các domain khác, nhưng không có:

- Project/Program/Revision;
- ST/FBD validation/build;
- I/O Mapping Programming;
- Deployment/Activation/Rollback;
- Online Monitor Programming;
- transport tới `StScheduler`/`st_handle_control_request`.

Không tìm thấy handler production gọi `mkddc-st-validate` hoặc `mkddc-st-compile`.
BE hiện không sở hữu DB/schema hoặc store cho immutable Revision/artifact/lifecycle.

### 5.2 Contract drift

`contracts/openapi/openapi.yaml` vẫn công bố:

- `POST /graph/validate`;
- `POST /graph/deploy`.

Go router không đăng ký hai route này. Nội dung là graph legacy, không phải Project/ST/FBD
Programming hiện hành; mô tả tiếng Việt còn bị mojibake. Đây là contract mồ côi và có thể
làm đội FE/UX hoặc integrator thiết kế theo API không tồn tại.

### 5.3 Finding BE

| ID | Mức | Finding | Dẫn chứng |
|---|---|---|---|
| AP-BE-001 | P0 | Programming API, persistence và lifecycle authority chưa implement. | `http.go:161+`, không có route/handler Program |
| AP-BE-002 | P0 | OpenAPI graph validate/deploy không khớp Go As-Built. | `openapi.yaml:1535-1572`; không có route tương ứng |
| AP-BE-003 | P0 | Không có đường BE → compiler/runtime; không thể chứng minh validate-before-deploy hoặc authoritative ACK. | không có call CLI/IPC Programming trong `apps/web-api` |
| AP-BE-004 | P0 | Chưa có RBAC/audit theo từng lifecycle mutation vì chính mutation chưa tồn tại. | PR-PROG-013/SWR-REQ-PROG-011 gap |
| AP-BE-005 | P1 | Generic Point/Virtual/Modbus APIs hiện hữu là nền product-wide, không tự trở thành I/O Mapping Programming. | route table và domain stores riêng |

## 6. FW SOM (`apps/core`)

### 6.1 Supporting component đã implement

| Component | Source | Trạng thái |
|---|---|---|
| ST lexer/parser/semantic | `application/st/st_*` | Có code và host test |
| ST → typed IR compiler | `st_ir_compiler`, compile CLI | Có |
| Artifact serialize/verify/load | `st_artifact`, `st_loader`, Ed25519/libsodium | Có |
| IR executor/FB/state | `st_exec`, runtime | Có |
| Cyclic/task scheduler | `st_scheduler` | Có state, priority/order, overrun, activation/LKG/rollback trong RAM |
| Process image bridge | `st_process_image` | Có Local/Virtual subset và output qua `PriorityResolver` |
| RETAIN store | `st_retain` | Có atomic file logic và host test |
| Control handler | `st_control_api` | Có pure JSON handler/status/action và host test |
| Validation/compile CLI | `mkddc-st-validate`, `mkddc-st-compile` | Build thành công |

CMake root build với Modbus/BACnet/HMI bật đã build các component này và full CTest đạt
`860/860`; `ctest -N -R '^(St|Ir|Artifact)'` liệt kê `220` test liên quan.

### 6.2 Không nằm trên production control path

`ScanLoop` chỉ chạy ST khi `d_.st_sched != nullptr`. Production bootstrap tạo `ScanLoop`
với 13 dependency đến `&schedules` và bỏ dependency cuối, nên aggregate initialization
dùng mặc định `st_sched = nullptr`. Không có config loader dựng task/program/artifact.

Hệ quả: binary có link ST component nhưng mỗi scan production bỏ qua toàn bộ block
`st_load_all_inputs → tick → st_apply_all_outputs`.

### 6.3 I/O Mapping chưa đạt Product contract

- Validator point ID chỉ nhận prefix `{UI,DI,AO,DO}`.
- IR `StPointKind` có `UI,DI,AO,DO,AV,BV,MSV`; không có Modbus RTU/EXT identity.
- Process image bridge có Local/Virtual component nhưng không mang contract đầy đủ về
  stable Point identity/category, quality, timestamp, access hoặc Modbus RTU mapping.
- `DI` còn xuất hiện trong candidate dù base SKU hiện tại không có DI; Product Design
  phải khóa theo hardware/Point Catalog thay vì prefix string.

### 6.4 Finding FW SOM

| ID | Mức | Finding | Dẫn chứng |
|---|---|---|---|
| AP-FW-001 | P0 | ST scheduler không được bootstrap production dựng/nạp; runtime thực tế disabled. | `main.cpp:270-271`, `scan_loop.hpp:50-52`, `scan_loop.cpp:155-171` |
| AP-FW-002 | P0 | Không có FBD model/compiler → shared typed IR. | không có source FBD trong `application/st`/bootstrap |
| AP-FW-003 | P0 | Không có transport production cho `st_handle_control_request`; hàm chỉ được gọi trong test. | `st_control_api.cpp:148+`, search callsite |
| AP-FW-004 | P0 | I/O Mapping ST không hỗ trợ Modbus RTU Point và chưa đạt IF-REQ-PROG-001. | `st_io_map.cpp:42-55`, `st_ir.hpp:140-149` |
| AP-FW-005 | P1 | Scheduler nhận 50..60000 ms theo bội 50, thay vì allowlist 1000/5000/30000 ms. | `st_scheduler.hpp:48-56`, `st_scheduler.cpp:73-80` |
| AP-FW-006 | P1 | `StRetainStore` không có production callsite; policy compatibility/restart vẫn OPEN. | chỉ definition/implementation và test |
| AP-FW-007 | P1 | `program_status` là pure handler chưa transport/persistence, nên không phải Online Monitor authority. | `st_control_api.cpp:173-193` |
| AP-FW-008 | P1 | Legacy `GraphRuntime` vẫn là control path production và có node RTU/TCP; nó không phải FBD và không được tính là Programming. | `domain/graph/graph_runtime.*`, `SOFTWARE.md` §Component graph |

## 7. Finding xuyên layer theo ưu tiên

| Ưu tiên | Điều phải đóng | Lý do chặn |
|---|---|---|
| P0 | Đóng OD-PROG-001..015 và phê duyệt Programming Design/Interfaces | Không có contract authority ổn định để FE/BE/FW implement thống nhất |
| P0 | Thiết kế/implement Project → Program → immutable Revision → artifact → Deployment → Activation/Rollback | Hiện không có lifecycle end-to-end |
| P0 | FBD authoring + semantic + FBD → cùng typed IR | FBD là Rev A nhưng source bằng 0 |
| P0 | Programming I/O Mapping cho đúng ba Point category | Local/Virtual chỉ partial; RTU chưa vào IR; legacy TCP phải reject |
| P0 | Nối BE authority/IPC với compiler/runtime và bootstrap `StScheduler` | Binary có component nhưng production không chạy |
| P0 | Sửa contract drift OpenAPI và thông điệp FE nói FBD Rev B | Tránh thiết kế/claim sai phạm vi |
| P1 | Khóa cycle allowlist, WCET/overrun policy và đo target | Component hiện cho phép cycle ngoài Product |
| P1 | Nối RETAIN/recovery/power-loss và compatibility policy | Store riêng lẻ không đủ PR-PROG-010 |
| P1 | Online Monitor authority + stale/quality/timestamp | Pure status JSON không đủ |
| P1 | RBAC/audit/idempotency/correlation/fail-closed | Chưa có mutation lifecycle để áp dụng |

## 8. Kết quả kiểm chứng tại cây làm việc ngày audit

| Gate | Kết quả đo mới | Ý nghĩa |
|---|---|---|
| CMake Release, Modbus+BACnet+HMI ON | Build PASS | Source C/C++ compile được với full options |
| `ctest --test-dir build/fw --output-on-failure` | **860/860 PASS** | Supporting components pass host tests; không thay VR target |
| `go vet ./...` + `go test ./... -count=1` | PASS, 11 package test + 1 package no tests | BE hiện tại ổn ở gate Go; không có Programming tests/routes |
| FE focused gate/navigation | **17/17 PASS** | Chứng minh demo flag/navigation fail-closed |
| FE full Vitest | **454/454 PASS** | Gate FE hiện tại đạt; số lượng tăng trong lúc audit do nhánh PA3 đang được chỉnh song song |
| FE lint | PASS, 0 warning | Static gate pass tại lượt đo |
| FE production build | PASS | Vite build xong; cảnh báo chunk `index` > 500 kB |
| Chrome DevTools local demo | UI render; Validate PASS; Simulate toast; 0 fetch/xhr từ hai thao tác | Xác nhận demo cục bộ, không BE/device deploy |
| Chrome Console sau reload ổn định | 0 error/warn; 1 issue form thiếu `id`/`name` ở Login | Không có Programming runtime error; còn accessibility issue chung |

Lưu ý cây làm việc có thay đổi PA3 chưa commit và đã tiếp tục thay đổi trong lúc audit.
Lượt Vitest đầu ghi nhận `444/448` do test Dashboard chưa bọc `OverviewProvider`; người dùng
đã hoàn thiện nhánh đó trong lúc audit, và lượt đo cuối đạt `454/454`. Các số đo cuối bảng
là snapshot mới nhất tại thời điểm đóng hồ sơ, không phải chứng nhận release cho nhánh `main`.

## 9. Quyết định readiness

| Câu hỏi | Kết quả |
|---|---|
| Product Spec đã document? | YES |
| Trace requirement đã đủ? | YES — 12 PC, 14 PR, 19 requirement layer, 13 VR |
| Programming Design production đã approved? | NO |
| FE Programming production đã có? | NO — SAFE-DISABLED, legacy demo only |
| BE Programming authority đã có? | NO |
| FW SOM ST production path đã hoạt động? | NO — component linked nhưng scheduler null |
| FBD đã có? | NO |
| VR-PROG production đạt? | 0/13 |
| Có thể deploy/claim Programming Rev A? | **NO-GO** |

Kết luận cuối: source hiện tại là **nền tảng nghiên cứu/host component cho ST cộng với
legacy graph demo**, chưa phải tính năng Programming Rev A của MK-DDC-24.
