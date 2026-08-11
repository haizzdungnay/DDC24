# Review triển khai G2 Programming — TASK-PROG-200..202

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-G2-IMPLEMENTATION-REVIEW-2026-08-11` |
| Task | `TASK-PROG-200`, `TASK-PROG-201`, `TASK-PROG-202` |
| Ngày | 2026-08-11 |
| Trạng thái task | **DONE** |
| Trạng thái pha | **P2 IN_PROGRESS — 3/8; G2 IN_PROGRESS** |
| Source commit | Task 200: `8d58efa`, `a638470`; Task 201: `52dfb57`; Task 202: `4819901` |
| PR / merge | Task 200: [PR #139](https://github.com/Mekong-HCM/MK-DDC-24/pull/139) / `288aa37`; Task 201: [PR #141](https://github.com/Mekong-HCM/MK-DDC-24/pull/141) / `207cd90`; Task 202: `PENDING` trên nhánh `feat/programming-fbd-ir-equivalence-20260811` |
| Evidence hỗ trợ | [`EV-PROG-G2-200`](programming-g2/raw/EV-PROG-G2-200.txt), [`EV-PROG-G2-201`](programming-g2/raw/EV-PROG-G2-201.txt), [`EV-PROG-G2-202`](programming-g2/raw/EV-PROG-G2-202.txt) |
| Test Result chính thức | **2/32 record BLOCKED; 0/32 PASS — không đổi** |
| Next action | `TASK-PROG-203` — deterministic artifact/hash/profile/manifest/source map |

## 1. Kết quả đã triển khai

- Parser khóa toàn bộ source: tối đa 64 KiB, UTF-8 hợp lệ, không byte NUL, phải
  consume hết sau `END_PROGRAM`; keyword loop/global/native ngoài Rev A bị reject.
- Diagnostic dùng exact token span và `sourceId`; source map trong artifact chỉ
  hợp lệ khi flag/section đối xứng, PC tăng, vị trí khác 0 và không trùng.
- Hệ kiểu Rev A chạy xuyên parser/semantic/typed IR/loader/executor/process
  image/RETAIN: `BOOL`, `INT` 16-bit, `DINT` 32-bit, `UINT` 16-bit, `REAL`
  32-bit và `TIME` 64-bit. Không conversion ngầm; overflow, underflow,
  non-finite, narrowing ngoài miền và encoding artifact không canonical đều fault.
- Golden artifact được sinh lại từ compiler mới; G1 join được cập nhật để hash
  drift tiếp tục làm build fail.
- Parser fuzzer chạy toàn pipeline compile → serialize → load; loader fuzzer
  dùng golden mới và mutation section/type/value/source-map.

## 2. Finding phát hiện và đã đóng trong task

| ID | Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|---|
| `F-G2-200-01` | P1 | Lượt đầu mới khóa subset/source map nhưng chưa triển khai đủ `INT16/UINT16` theo profile/OD-PROG-002, nên không đủ DoD của Task 200 | Triển khai đủ sáu type và conversion/range xuyên compiler→runtime; thêm golden/unit/fault test; commit `a638470` | **CLOSED** |
| `F-G2-200-02` | P1 | Sinh lại golden làm hash manifest artifact lệch G1 join | Cập nhật `goldenManifestSha256`; `verify_programming_g1_contracts.py --self-test` PASS 6/6 | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi `TASK-PROG-200`.

## 3. Kiểm chứng đo trong phiên

| Làn | Kết quả |
|---|---|
| Fuzz hồi quy | `10.000/10.000` mutation PASS |
| Parser libFuzzer ASan/UBSan | `10.000.000` input / 135 s / 74.074 exec/s / RSS đỉnh 432 MiB / 0 crash-timeout |
| Loader libFuzzer ASan/UBSan | `10.000.000` input / 190 s / 52.631 exec/s / RSS đỉnh 462 MiB / 0 crash-timeout |
| Profile + join | generated profile PASS; mutation 5/5; order âm 5/5; join 6/6 PASS |
| C++ toàn repository | Release bật Modbus + BACnet + HMI; CTest `898/898` PASS |
| Go toàn repository | `go vet ./...` và `go test ./... -count=1` PASS |
| FE regression | Vitest `55/55` file, `479/479` test; lint/build PASS |

Không chạy Chrome DevTools vì task không đổi route, component, layout hoặc hành
vi FE runtime. Không deploy target/HIL/production; feature flag giữ `OFF` và
không có Commission side effect.

## 4. Ranh giới truy vết và quyết định

- `CORE-101` đã `I=Y` từ Task 102; Task 200 bổ sung source/evidence cùng dòng,
  không làm phát sinh requirement end-to-end mới để tăng tổng. Tổng giữ `2/60 I=Y`.
- `NFR-101` vẫn `I=N`: FBD validator, BE sandbox/Check và target OOM acceptance
  chưa hoàn tất.
- `RSK-PROG-006` giữ `15 Open`: control source đã mạnh hơn nhưng chưa có FBD,
  worker, no-parser-RT target và Test Result độc lập.
- Không tạo hoặc nâng `TR-PROG-*`; mọi `T/P/R=N`, 0/32 PASS và
  `RELEASE_READY BLOCKED`.

## 5. Bàn giao cho TASK-PROG-201

Task 201 phải dùng chính type/wire code/source-map contract đã khóa ở Task 200,
tạo FBD canonical model machine-readable và keyboard command deterministic.
Không tạo semantic authority thứ hai ở FE; FBD chỉ được hạ về common typed IR
trong Task 202. Mọi thay đổi type/artifact breaking phải tăng profile/schema và
chạy lại G1 join trước khi merge.

## 6. Kết quả `TASK-PROG-201`

- Contract FBD v1 machine-readable gồm schema, golden document, manifest hash và
  registry 11 lệnh bàn phím. Schema khóa profile, capacity, UUID canonical,
  block/port/connection, type, unit, execution order và tham số.
- `mkddc-core` có parser/validator/canonicalizer non-RT. Biên tin cậy reject
  duplicate key, unknown field, UUID/type/kind/port/param sai, endpoint không tồn
  tại, type/unit mismatch, multiple driver, cạnh combinational ngược thứ tự và
  capacity vượt profile; lỗi không tạo model được dùng cho runtime.
- FE dùng typed model và reducer cùng contract; history bị chặn ở 50 bước,
  read-only chặn mutation, registry command là authority duy nhất cho shortcut,
  editor có focus/status live-region và thao tác nối block hoàn toàn bằng bàn
  phím. Component chưa mount route production để không dựng UI authority thứ hai
  trước `TASK-PROG-500/502`.
- FBD chưa hạ sang common IR ở task này. `TASK-PROG-202` sở hữu lowering,
  deterministic artifact và equivalence với ST; không có compiler thứ hai ở FE.

## 7. Finding `TASK-PROG-201` đã đóng

| ID | Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|---|
| `F-G2-201-01` | P1 | Mô hình block ban đầu chưa giữ parameter có kiểu, nên timer/PID/scaling không thể round-trip canonical | Thêm `ParameterValue` variant, schema ràng buộc theo block kind và test round-trip/negative | **CLOSED** |
| `F-G2-201-02` | P1 | Payload JSON có thể chứa duplicate key và làm producer/consumer diễn giải khác nhau | Parser C++ bật callback phát hiện duplicate key; mutation self-test chứng minh reject fail-closed | **CLOSED** |
| `F-G2-201-03` | P1 | Đồng bộ document từ parent có thể tạo echo history hoặc UUID trùng trong mutation FE | Tách replace external khỏi command history, thêm identity guard và test controlled-update/read-only | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi `TASK-PROG-201`.

## 8. Kiểm chứng `TASK-PROG-201` đo trong phiên

| Làn | Kết quả |
|---|---|
| Contract mutation | `10/10` mutation bị từ chối đúng, golden/manifest khớp |
| Core FBD targeted | `8/8` test validator/canonicalizer PASS |
| FE FBD targeted | `15/15` test model/reducer/component PASS |
| Fuzzer C++ ASan/UBSan | `50.000` input / 24 s / 2.083 exec/s / RSS đỉnh 448 MiB / 0 crash-timeout |
| C++ toàn repository | Release bật Modbus + BACnet + HMI; CTest `906/906` PASS |
| Go toàn repository | `go vet ./...` và `go test ./... -count=1` PASS |
| FE regression | Vitest `58/58` file, `494/494` test; lint/typecheck/build PASS |

Không chạy Chrome DevTools vì FBD component chưa mount vào route/runtime; browser
không thể chứng minh hành vi production ở task foundation này. Không deploy
target/HIL/production; feature flag giữ `OFF`, không có Commission side effect.

## 9. Ranh giới truy vết sau `TASK-PROG-201`

- `SYS-101`, `FE-104`, `CORE-101` và `NFR-101` có thêm source partial, nhưng chỉ
  `CORE-101` thuộc tổng `2/60 I=Y` hiện hành. FBD chưa có lowering/Check/worker/
  target hoặc route/API/E2E nên không nâng dòng partial thành complete.
- `RSK-PROG-006` có treatment source mới nhưng giữ `Open`: artifact execution,
  equivalence, worker sandbox, target timing và independent Test Result còn thiếu.
- Không tạo hoặc nâng `TR-PROG-*`; 2 record vẫn `BLOCKED`, 0/32 PASS, mọi
  `T/P/R=N` và `RELEASE_READY BLOCKED`.

## 10. Bàn giao cho `TASK-PROG-202`

Task 202 phải nhận duy nhất FBD canonical v1, resolve block/port/type/unit bằng
registry dùng chung rồi hạ về typed IR Task 200 với ordering tất định. Cùng một
logic biểu diễn bằng ST và FBD phải tạo IR/artifact tương đương theo contract;
mọi graph cycle, ambiguity, unsupported block hoặc conversion ngầm phải fail
trước artifact. Evidence Task 202 phải gồm golden ST↔FBD, negative/fault,
determinism và regression/fuzz; chưa được gọi kết quả host là target/HIL.

## 11. Kết quả `TASK-PROG-202`

- Thêm lowerer non-RT `fwsom-fbd-1.0.0` tại `st_fbd_compile.*`. Input duy nhất
  là FBD canonical v1; lowerer dựng `StProgram` typed, chạy
  `typecheck_st_program()` và `compile_st_to_ir()` hiện hữu. Không tạo VM,
  opcode, runtime hoặc semantic authority thứ hai.
- Hỗ trợ INPUT/OUTPUT/CONSTANT, 20 operator logic/compare/math/select/limit,
  10 conversion tường minh và `TON/TOF/R_TRIG/F_TRIG`. Corpus
  `fbd/equivalence_v1.json` ghim đúng 20 cặp và SHA-256 trong manifest.
- Fail-closed khi parameter/port/arity sai, input chưa nối, identifier hostile,
  writer trùng, cycle, unit chưa thể giữ trong artifact hoặc library chưa có
  semantic runtime chung. `SCALE/DEADBAND/CTU/PI/PID` không bị diễn giải tạm;
  module lỗi luôn rỗng, không publish partial IR.
- Equivalence loại riêng provenance theo ngôn ngữ nguồn (`source_hash`,
  `source_map`, build timestamp), sau đó yêu cầu executable IR serialize
  byte-identical; runtime output và state trace vẫn được đo độc lập.

## 12. Finding `TASK-PROG-202` đã đóng

| ID | Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|---|
| `F-G2-202-01` | P1 | `parameters.instance` của FB sai kiểu có thể rơi về tên mặc định, trái fail-closed | Kiểm presence/type tường minh trước fallback; thêm regression xác nhận module rỗng | **CLOSED** |
| `F-G2-202-02` | P1 | FBD có unit nhưng artifact hiện tại chưa giữ provenance unit, có nguy cơ semantic drift | Reject bằng `FBD-SEM-UNIT-IR-001`; chuyển source-map/unit artifact sang Task 203 | **CLOSED** |
| `F-G2-202-03` | P1 | Library profile có block chưa có runtime semantic chung | Allowlist đúng semantic hiện hữu; reject ổn định `FBD-SEM-LIBRARY-UNSUPPORTED-001` thay vì dựng behavior thứ hai | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi `TASK-PROG-202`.

## 13. Kiểm chứng `TASK-PROG-202` đo trong phiên

| Làn | Kết quả |
|---|---|
| Corpus equivalence | `20/20` cặp tạo executable IR tương đương và cùng output |
| Core FBD targeted | `17/17` model/lowerer/state/fault test PASS |
| Contract mutation | `10/10` mutation bị reject; schema/golden/profile/keyboard/equivalence/manifest khớp |
| Fuzzer C++ Clang/ASan | `100.000` input / 17 s / 5.882 exec/s / RSS đỉnh 462 MiB / 0 crash-timeout-ASan fault |
| C++ toàn repository | Release bật Modbus + BACnet + HMI; CTest `915/915` PASS |
| Go toàn repository | `go vet ./...` và `go test ./... -count=1` PASS |
| FE regression | Vitest `58/58` file, `494/494` test; lint/typecheck/build PASS |

Không chạy Chrome DevTools vì Task 202 không đổi route, component, layout hoặc
hành vi FE runtime. Không deploy target/HIL/production; feature flag giữ `OFF`,
không stage/activate artifact và không có Commission side effect.

## 14. Ranh giới và bàn giao `TASK-PROG-203`

- `CORE-101` vẫn là một trong `2/60 I=Y`; Task 202 bổ sung source/evidence chứ
  không tạo requirement end-to-end mới. `SYS-101/NFR-101` vẫn partial do artifact
  provenance, Check worker, route và target còn thiếu.
- `RSK-PROG-006` giữ `15 Open`; evidence host không thay independent Test Result
  `VS-PROG-006/023`. Tổng giữ 2 record BLOCKED, 0/32 PASS, mọi `T/P/R=N`.
- Task 203 phải đóng deterministic artifact/hash/profile/manifest/source map cho
  cả ST/FBD, bảo toàn unit/location provenance mà không thay executable semantic.
  Unknown version/hash/profile hoặc source-map lỗi phải fail-closed; không stage
  hay đổi Active/LKG trong task compiler này.
