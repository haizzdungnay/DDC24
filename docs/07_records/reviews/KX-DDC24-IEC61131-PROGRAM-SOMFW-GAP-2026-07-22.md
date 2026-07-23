# Báo cáo đánh giá Program và FW SOM theo IEC 61131-3

**Document ID:** KX-DDC24-REV-IEC61131-001  
**Loại hồ sơ:** Review record / gap assessment  
**Trạng thái:** Open — không đủ cơ sở tuyên bố conformity  
**Ngày đánh giá:** 2026-07-22  
**Baseline source:** `main` tại `18ee583c80e5b171f5db592d125774395c3fe548`  
**Đối tượng:** trang Web `Programming`, validator/deploy contract, `mkddc-core`, SOM services và firmware STM32  
**Chuẩn mục tiêu dùng để sàng lọc:** IEC 61131-3:2025, Edition 4.0

> **Cập nhật 2026-07-23:** cùng ngày với báo cáo này, một corrective design
> ([`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`](../../02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md))
> được viết theo hướng **ngược lại** khuyến nghị ở §8.1 dưới đây — bắt buộc IEC 61131-3
> ngay trong Rev A.0 thay vì hoãn sang Rev C. Directive làm căn cứ cho tài liệu đó chưa
> có decision record truy vết được trong `DECISIONS.md`. Đây là mâu thuẫn governance mở
> (DOC-REV-001), xem chi tiết tại
> [`KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md`](KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md).
> Không coi báo cáo này là superseded chỉ vì tài liệu kia tự nhận supersede — cần quyết
> định RD-IEC-001 chính thức trước.

## 1. Kết luận điều hành

**MK-DDC-24 Rev A.0 hiện không đạt và không được tuyên bố phù hợp IEC 61131-3.** Đây
không phải lỗi lệch nhỏ so với tiêu chuẩn: baseline đã chủ động chọn component graph
proprietary và loại IEC 61131-3/FBD/ST khỏi Rev A theo ADR-004. Nếu đánh giá hệ thống
hiện tại như một Program Support Environment (PSE) IEC 61131-3 thì kết quả là
**không đủ điều kiện đánh giá conformity** vì chưa có ngôn ngữ IEC, type system, POU,
configuration/resource/task model, standard function-block semantics hoặc bộ test
conformance.

Kết quả theo từng phần:

| Phần | Kết luận | Căn cứ chính |
|---|---|---|
| Product/design Rev A | **IEC 61131-3 không áp dụng cho claim Rev A** | `PRODUCT.md`, `DECISIONS.md`, ADR-004 và `SOFTWARE.md` đều loại IEC 61131-3 khỏi baseline |
| Trang Web `Programming` | **P0 — demo, chưa deploy thật và chưa khớp Core** | validate cục bộ; `deployDemo()` chỉ hiện toast; sample/type/port khác contract C++ |
| SOM `mkddc-core` | **Runtime graph proprietary, không phải IEC PSE** | tải `graph.json`, 28 node cố định, topo-sort và scan; không có ST/LD/FBD/SFC hoặc POU |
| SOM build/test | **PASS cho baseline proprietary; không phải evidence IEC** | build sạch và 344/344 CTest pass trên host |
| Firmware STM32 | **Skeleton only; chưa có target/HIL evidence** | Makefile chỉ build `main.c`; `.ioc` placeholder; chưa có IOP/ADC/AO/DO/watchdog/FreeRTOS implementation |
| Certification | **Không có** | không có conformity statement, PLCopen test report hoặc certificate |

Do đó chỉ được mô tả sản phẩm hiện tại là **component-based BMS Edge Automation
Controller**. Không dùng các cụm “IEC 61131-3 compliant”, “FBD/ST PLC” hoặc logo/chứng
nhận liên quan trong datasheet, UI, hồ sơ thầu hay release note của Rev A.

## 2. Phạm vi và giới hạn đánh giá

Đã rà soát:

- baseline và quyết định: `docs/01_product/PRODUCT.md`,
  `docs/00_governance/DECISIONS.md`, ADR-004;
- thiết kế runtime/graph: `docs/04_design/SOFTWARE.md`,
  `docs/02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md`,
  `docs/02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md`;
- Program UI: `src/frontend/src/pages/ProgrammingPage.tsx`, validator demo và API client;
- runtime: `services/core/graph_runtime.*`, scan loop và các unit test liên quan;
- firmware: `docs/04_design/FIRMWARE.md`, detailed design, `fw/Makefile`,
  `fw/Core/Src/main.c` và `fw/mkddc-fw.ioc`;
- verification/traceability hiện hành.

Đây là gap assessment từ nguồn công khai của IEC/PLCopen và source nội bộ, không phải
clause-by-clause audit trên bản IEC có license và không thay thế thử nghiệm của phòng
thử nghiệm được công nhận. IEC công bố Edition 4.0 ngày 2025-05-22; phạm vi gồm ST,
LD, FBD, SFC và configuration elements. Nguồn tham chiếu:

- [IEC 61131-3:2025 — IEC Webstore](https://webstore.iec.ch/en/publication/68533)
- [PLCopen — nhận diện một IEC 61131-3 programming system](https://www.plcopen.org/standards/logic/iec-61131-3/how-to-recognize-iec-61131-3-programming-system/)
- [PLCopen Logic certification](https://www.plcopen.org/certification/logic/)

## 3. Đối chiếu IEC 61131-3

Quy ước: `PASS` = có evidence phù hợp trong phạm vi đã chọn; `PARTIAL` = chỉ tương đồng
khái niệm, không đủ chứng minh semantics; `FAIL` = capability bắt buộc cho claim không
tồn tại; `N/A` = ngoài scope Rev A đã phê duyệt.

| Nhóm đánh giá | Trạng thái | Evidence / khoảng trống |
|---|---|---|
| Phiên bản chuẩn và conformity scope | **FAIL** nếu claim IEC; **N/A** cho Rev A | Hồ sơ nguồn cũ còn tham chiếu IEC 61131-3:2013/FBD/ST, trong khi baseline hiện hành loại capability và chuẩn hiện hành là Edition 4.0:2025 |
| Structured Text (ST) | **FAIL** | Không có lexer/parser, grammar, compiler/interpreter, editor hoặc test syntax/semantics ST |
| Ladder Diagram (LD) | **FAIL** | Không có model, editor hoặc runtime semantics LD |
| Function Block Diagram (FBD) | **FAIL** | `graph.json` có node/link nhưng không triển khai cú pháp và semantics FBD IEC; ADR-004 cấm gọi graph này là FBD dưới tên khác |
| Sequential Function Chart (SFC) | **FAIL** | Không có step/transition/action hoặc execution semantics SFC |
| Standard và derived data types | **FAIL** | Runtime dùng `float`, `double`, `bool` và JSON params nội bộ; không có IEC type declarations, derived types, arrays/structures hoặc type-conformance statement |
| POU: Program/Function/Function Block | **FAIL** | 28 node C++ cố định không phải POU do người dùng khai báo; không có local data, interface POU, instance semantics hoặc reusable POU artifact |
| Standard functions/function blocks | **PARTIAL — không được gọi compliant** | Có AND/OR, timer/counter/PID tương tự về mục đích, nhưng tên, interface, kiểu và semantics chưa được đối chiếu/test theo IEC |
| Configuration/resource/task binding | **FAIL** | `device.scan_ms` và service scheduling không tạo IEC configuration/resource/task model |
| Cyclic execution và state | **PARTIAL — PLC-like** | Có input snapshot, topo execution, stateful node, priority, safe-state và atomic reload; đây là đặc tính runtime riêng, không chứng minh language conformity |
| Programming environment và portability | **FAIL** | Không có IEC project model, standard editor/debugger/monitor, import/export ST hoặc interoperability artifact |
| Conformance verification | **FAIL** | 344 host tests kiểm graph/IO/protocol hiện hành; không có IEC/PLCopen conformance suite, supported-feature declaration hoặc accredited test report |
| Independent certification | **FAIL / chưa thực hiện** | Không có PLCopen Base, Conformity hoặc Reusability certificate |

Không được tính số lượng node, số unit test hoặc việc scan tuần hoàn thành phần trăm IEC
61131-3. Các chỉ số đó chứng minh chất lượng baseline proprietary, không chứng minh cú
pháp/semantics của programming language.

## 4. Finding đối với trang Program

### IEC-PROG-001 — P0 — Program chỉ là demo, không deploy tới runtime

`ProgrammingPage.tsx` gọi trực tiếp `validateGraphLocal(text)`. Hàm `deployDemo()` chỉ
kiểm `result.pass` rồi phát toast “Deployed (demo)”; không gọi backend, không ghi
`graph.json`, không yêu cầu authorization và không có ACK từ Core. Trong source backend
được rà soát không tìm thấy route handler cho `/graph/validate` hoặc
`/graphs/{id}/validate`. `api.validateGraph()` có khai báo ở frontend nhưng trang Program
không sử dụng hàm này.

**Tác động:** PASS trên màn hình chỉ có nghĩa bốn check demo đã qua; không chứng minh graph
có thể load, deploy hoặc chạy. Đây là blocker của chính Rev A component graph, độc lập
với IEC 61131-3.

### IEC-PROG-002 — P0 — Sample/library Web không khớp contract của Core

| Program UI/sample | Core `GraphRuntime` | Kết quả |
|---|---|---|
| `UI_Input` | `AI_Input` | Core reject unknown node type |
| `Modbus_Read` | `Modbus_RTU_Read` hoặc `Modbus_TCP_Read` | Core reject; đồng thời thiếu contract params đầy đủ |
| `Interlock` inputs `cmd`, `safe` | `request`, `permit` | Core reject ports |
| `AlarmDelay.params.delay_s` | `on_delay_s`, `off_delay_s` | Tham số UI không điều khiển delay như dự kiến |
| `PulseCounter.outputs.count` | output `out` | Link dùng tên UI sẽ bị Core reject |

Validator frontend chỉ kiểm nodes/links tồn tại, input chưa nối, nhiều writer, AO limits
và fallback/safe-state. Nó không kiểm registry node/port/param tương đương Core, không
kiểm schema version đầy đủ hoặc cycle/topological validity như runtime. Vì vậy sample có
thể báo PASS cục bộ nhưng fail ngay khi Core parse.

### IEC-PROG-003 — P1 — Nhãn hiện tại đúng về scope nhưng dễ gây hiểu nhầm

Trang đã ghi rõ “No drag-and-drop canvas, no IEC”, phù hợp ADR-004. Tuy nhiên tiêu đề
“Programming”, thư viện có nhãn “Timer TON/TOF” và trạng thái PASS/Deploy có thể bị đọc
như một PSE. Trước khi tích hợp thật, nên đổi trạng thái thành `Demo/Not deployable` rõ
ràng và không dùng tên standard block nếu semantics chưa được khóa/test.

## 5. Finding đối với SOM runtime và firmware

### IEC-RUN-001 — P0 — Runtime proprietary, không có IEC language layer

`GraphRuntime` nhận JSON schema 1.0, map 28 chuỗi node vào C++ enum, topo-sort graph
acyclic rồi thực thi theo scan. Đây là một runtime component tốt cho scope Rev A nhưng
không có frontend ngôn ngữ IEC hoặc IR/POU model. Không thể đổi nhãn `graph.json` thành
FBD để tạo claim; ADR-004 đã bác bỏ chính phương án này.

### IEC-FW-001 — P0 — MCU firmware chưa implement target design

`fw/Makefile` chỉ compile `fw/Core/Src/main.c`. File này in bốn dòng cấu hình rồi chạy
vòng lặp rỗng; `.ioc` chỉ là comment placeholder. Chưa có FreeRTOS task, IOP v2,
ADS131M08, DAC8554, relay, diagnostics, IWDG hoặc communication-loss safe timeout 200 ms.
Firmware compile thành ARM ELF chỉ chứng minh toolchain nhận skeleton, không chứng minh
controller operation, timing hoặc safety.

IEC 61131-3 Part 3 chủ yếu áp dụng cho programming languages/PSE, không phải một coding
standard cho MCU driver. Tuy nhiên firmware thật và HIL vẫn là dependency hệ thống bắt
buộc trước khi có thể chứng minh chương trình điều khiển chạy đúng trên controller.

### IEC-VER-001 — P0 — Không có conformity evidence

Automated suite hiện hành kiểm contract IOP/SHM, graph nodes, protocol, safety logic và
network helper. Không có test vector IEC, conformity statement theo feature, hồ sơ
version/toolchain của PSE hoặc report từ phòng thử nghiệm PLCopen. Vì vậy cả “self-
declared compliant” và “certified” đều chưa có căn cứ.

## 6. Finding đối với tài liệu thiết kế

### IEC-DOC-001 — P1 — Baseline Active nhất quán, corpus phục hồi còn claim cũ

Các tài liệu Active `PRODUCT.md`, `DECISIONS.md` và `SOFTWARE.md` nhất quán rằng Rev A
không có IEC 61131-3. Tuy nhiên các tài liệu `In Review`/nguồn cũ như PRD, DS, SRS,
SW requirements, SW architecture, test spec, design plan và BACnet PICS/EPICS vẫn còn
những câu “IEC 61131-3 compliant”, FBD/ST hoặc requirement/test cũ. Nhiều file có banner
reconcile, nhưng người đọc trích bảng giữa file vẫn có thể tạo claim sai.

**Kiểm soát đề nghị:** gắn watermark `Superseded for IEC claims` tại từng phần cũ hoặc
chuyển hẳn requirement IEC sang hồ sơ roadmap Rev C; không cho tài liệu `In Review` làm
nguồn marketing/release.

### IEC-DOC-002 — P1 — Báo cáo tiến độ SOM cũ không còn đáng tin làm release evidence

`docs/03_implementation/24_SOM_FW_STATUS_REPORT_ISO.md` có các tỷ lệ 100%/85% và nội dung
không đồng nhất giữa phần đầu, bảng gap và revision cuối. Index implementation đã cảnh
báo toàn bộ corpus phục hồi cần đối chiếu lại; vì vậy báo cáo cũ không được dùng làm
evidence IEC hoặc production readiness. `docs/04_design/FIRMWARE.md` và
`docs/05_verification/VERIFICATION.md` mới là baseline đúng: firmware skeleton và gate
hardware/MCU vẫn RED.

## 7. Evidence xác minh trong phiên đánh giá

| Check | Kết quả | Ý nghĩa giới hạn |
|---|---|---|
| Services configure/build với GCC 13.3, `-Wall -Wextra -Werror` | PASS | Source SOM build được; không phải IEC conformity |
| `ctest --test-dir /tmp/mkddc-iec-audit.hgVZ0I --output-on-failure --parallel 4` | **344/344 PASS** | Baseline proprietary pass host tests |
| Frontend `npm run typecheck` | PASS | TypeScript compile check; không kiểm Program deploy behavior |
| Frontend `npm run lint` | PASS | Static style/quality check |
| STM32 skeleton compile riêng trong `/tmp` | PASS; ARM ELF 11,100 B | Có linker warning `nosys` cho syscall stubs; không có peripheral/RTOS/HIL behavior |
| Tìm parser/compiler IEC ngoài docs/build/archive | Không tìm thấy ST/LD/FBD/SFC/POU implementation | Static absence evidence trong baseline source được rà soát |
| GitHub PR context | `main` không có PR hiện hành | Không có review thread để xử lý/resolve trong phiên này |

Các check không chạy: test trên STM32/board thật, IOP timing 2 ms/3 ms, safe timeout
200 ms, ADC/AO/DO, watchdog, IEC conformance suite và PLCopen lab test. Tất cả vẫn là
evidence thiếu, không được suy diễn từ host pass.

## 8. Quyết định và kế hoạch đóng gap

### 8.1 Rev A — hướng được khuyến nghị

1. Giữ claim chính thức: component-based DDC, **không IEC 61131-3**.
2. Đóng `IEC-PROG-001/002`: dùng một schema/registry dùng chung hoặc generated contract
   cho frontend/backend/Core; Program phải gọi validate/deploy thật, yêu cầu auth,
   atomic swap, ACK từ Core và rollback.
3. Thêm integration test bắt sample từ Program UI phải được chính `GraphRuntime` load;
   frontend PASS không được khác Core PASS.
4. Hiển thị rõ `Demo/Not deployable` cho đến khi bước 2–3 hoàn tất.
5. Tiếp tục gate MCU/HIL theo `FIRMWARE.md` và `VERIFICATION.md`; không liên kết host
   graph test với target safety claim.

### 8.2 Nếu Rev C thực sự cần IEC 61131-3

1. Mua và quản lý bản IEC 61131-3:2025 có license; phê duyệt conformity scope cụ thể,
   ví dụ ST trước hoặc FBD trước, không ghi chung “IEC compliant”.
2. Tạo decision/requirements mới cho supported language, data types, POU, standard
   functions/FB, configuration/resource/task, persistence, online change và diagnostics.
3. Chọn kiến trúc PSE/runtime và license: tự phát triển, tích hợp engine hoặc compiler;
   không tái gắn nhãn graph Rev A thành FBD.
4. Tạo feature-conformity statement và test matrix cho syntax, semantics, negative
   cases, portability và target execution.
5. Tích hợp editor → compiler/validator → deploy → runtime → monitor/debug thành một
   contract có version, migration, rollback và security.
6. Chạy compliance testing theo quy trình PLCopen tại lab được công nhận nếu cần claim
   độc lập/certificate; lưu certificate theo đúng version và thời hạn.

## 9. Release disposition

| Claim/gate | Quyết định 2026-07-22 |
|---|---|
| “Rev A hỗ trợ lập trình component graph demo” | Được, nếu ghi rõ demo và không deploy thật |
| “Rev A có component graph runtime” | Được, kèm phạm vi 28 node và evidence host hiện hành |
| “Program page sẵn sàng production” | **NO-GO** |
| “Firmware STM32 sẵn sàng integration/release” | **NO-GO** |
| “IEC 61131-3 compliant/conformant/certified” | **CẤM CLAIM** |
| “Có đặc tính PLC-like” | Chỉ dùng nội bộ, phải kèm câu không phải IEC PSE |

Review này không thay đổi product requirement hoặc ADR. Khi chọn hướng Rev C, phải mở
change riêng qua Product → Requirement → Decision → Design → Implementation →
Verification → Traceability → Release.
