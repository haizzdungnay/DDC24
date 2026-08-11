# Review triển khai G2 Programming — TASK-PROG-200..205

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-G2-IMPLEMENTATION-REVIEW-2026-08-11` |
| Task | `TASK-PROG-200`, `TASK-PROG-201`, `TASK-PROG-202`, `TASK-PROG-203`, `TASK-PROG-204`, `TASK-PROG-205`, `TASK-PROG-206` |
| Ngày | 2026-08-11 |
| Trạng thái task | **DONE** |
| Trạng thái pha | **P2 IN_PROGRESS — 7/8; G2 IN_PROGRESS** |
| Source commit | Task 200: `8d58efa`, `a638470`; Task 201: `52dfb57`; Task 202: `4819901`; Task 203: `2c2bfb4`; Task 204: `66848a1`; Task 205: `e8c289e`; Task 206: `95b9388` |
| PR / merge | Task 200: [PR #139](https://github.com/Mekong-HCM/MK-DDC-24/pull/139) / `288aa37`; Task 201: [PR #141](https://github.com/Mekong-HCM/MK-DDC-24/pull/141) / `207cd90`; Task 202: [PR #143](https://github.com/Mekong-HCM/MK-DDC-24/pull/143) / `7d424bc`; Task 203: [PR #145](https://github.com/Mekong-HCM/MK-DDC-24/pull/145) / `2899d02`, tree `cdef0e77`; Task 204: [PR #147](https://github.com/Mekong-HCM/MK-DDC-24/pull/147) / `27a06e1`, tree `4e4e4d24`; Task 205: [PR #149](https://github.com/Mekong-HCM/MK-DDC-24/pull/149) / `3c8b4c3`, tree `aa7e13a9`; remote feature branch đã xóa |
| Evidence hỗ trợ | [`EV-PROG-G2-200`](programming-g2/raw/EV-PROG-G2-200.txt), [`EV-PROG-G2-201`](programming-g2/raw/EV-PROG-G2-201.txt), [`EV-PROG-G2-202`](programming-g2/raw/EV-PROG-G2-202.txt), [`EV-PROG-G2-203`](programming-g2/raw/EV-PROG-G2-203.txt), [`EV-PROG-G2-204`](programming-g2/raw/EV-PROG-G2-204.txt), [`EV-PROG-G2-205`](programming-g2/raw/EV-PROG-G2-205.txt) |
| Test Result chính thức | **2/32 record BLOCKED; 0/32 PASS — không đổi** |
| Next action | `TASK-PROG-207` — timeout/OOM/fuzz/traversal/zip bomb/audit-secret assurance |

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

## 14. Ranh giới và bàn giao từ `TASK-PROG-202`

- `CORE-101` vẫn là một trong `2/60 I=Y`; Task 202 bổ sung source/evidence chứ
  không tạo requirement end-to-end mới. `SYS-101/NFR-101` vẫn partial do artifact
  provenance, Check worker, route và target còn thiếu.
- `RSK-PROG-006` giữ `15 Open`; evidence host không thay independent Test Result
  `VS-PROG-006/023`. Tổng giữ 2 record BLOCKED, 0/32 PASS, mọi `T/P/R=N`.
- Task 203 phải đóng deterministic artifact/hash/profile/manifest/source map cho
  cả ST/FBD, bảo toàn unit/location provenance mà không thay executable semantic.
  Unknown version/hash/profile hoặc source-map lỗi phải fail-closed; không stage
  hay đổi Active/LKG trong task compiler này.

## 15. Kết quả `TASK-PROG-203`

- Thay định danh FNV placeholder bằng SHA-256 canonical. Field metadata 64-bit
  legacy của `MKDDCIR1` chỉ giữ prefix digest; authority đầy đủ nằm trong
  manifest ngoài artifact. `fileSha256` và `integritySha256` có tên/nghĩa riêng.
- Thêm `artifact_build_manifest_v1.schema.json`, golden ST/FBD và producer/
  verifier `st_artifact_manifest.*`. Manifest khóa source, compiler/lowerer,
  profile/library/ABI, build key, artifact và source map; không chứa timestamp,
  random hoặc path host.
- `mkddc-st-compile` nhận `--language ST|FBD`, `--source-id` và
  `--manifest-out`. Diagnostic ST giữ vị trí; đường `--key` verify bằng public
  half của đúng khóa cung cấp.
- Source map ST giữ line/column/length. FBD dùng key compact trong artifact và
  ánh xạ về UUID network/node/port cùng unit trong manifest; reorder JSON/node/
  wire không đổi canonical source, artifact hay manifest.
- Unknown version/profile/library/ABI/hash/build key/source/source map và
  source ID giống host path đều reject fail-closed, không sửa output caller.

## 16. Finding `TASK-PROG-203` đã đóng

| ID | Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|---|
| `F-G2-203-01` | P1 | CLI mới làm mất line/column diagnostic ST khi đi qua API build manifest | Mở rộng `StManifestError`, giữ sourceId/span trong JSON và thêm test tiến trình thật | **CLOSED** |
| `F-G2-203-02` | P1 | `--key` tái tạo manifest bằng khóa nhúng thay vì public half của khóa caller, làm khóa ngoài bị reject | Truyền public key đúng vào verify khi tạo manifest; test khóa Ed25519 deterministic không trùng khóa nhúng | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi `TASK-PROG-203`.

## 17. Kiểm chứng `TASK-PROG-203` đo trong phiên

| Làn | Kết quả |
|---|---|
| Determinism/CLI/source map | targeted CTest `35/35` PASS; build lặp ST 100 lần và reorder FBD byte-identical |
| Contract manifest | schema/golden/profile/hash/build-key/source-map PASS; mutation `7/7` bị reject |
| Contract FBD/G1 | FBD mutation `10/10`; repository contract `2/2`, dependency `5/5`, error catalog `6/6` PASS |
| Clang AddressSanitizer | targeted `35/35` PASS trong 2,15 s; 0 crash/ASan/leak fault |
| C++ toàn repository | Release bật Modbus + BACnet + HMI; CTest `927/927` PASS trong 13,97 s |
| Go toàn repository | `go vet ./...` và `go test ./... -count=1` PASS |
| FE regression | Vitest `58/58` file, `494/494` test; lint/typecheck/build PASS |

Không chạy Chrome DevTools vì Task 203 không đổi route, component, layout hoặc
hành vi FE runtime. Không deploy target/HIL/production; feature flag giữ `OFF`,
không stage/activate và Active/LKG không đổi.

`tools/restructure/verify_repository.py` còn FAIL tại vi phạm baseline ngoài
task: `apps/web-ui/src/features/scheduler/shared.ts` chạm contract C/SHM/IOP.
Ba integration guard chạy độc lập đều PASS; finding này không bị tính thành PASS
và không được sửa lẫn vào commit Programming compiler.

## 18. Ranh giới và bàn giao `TASK-PROG-204`

- `CORE-101` vẫn thuộc tổng `2/60 I=Y`; `SYS-101/NFR-101` chỉ có thêm source
  partial. Không tạo Test Result: 2 record vẫn `BLOCKED`, 0/32 PASS và mọi
  `T/P/R=N`.
- `RSK-PROG-006` giữ residual `15 Open`: worker sandbox, immutable DB linkage,
  no-parser runtime target và independent evidence còn thiếu.
- Task 204 phải nối Project/Draft/Revision store hiện hữu với model Programming,
  giữ Revision immutable, Draft ETag/CAS và idempotency; không được dùng metadata
  placeholder thay manifest/hash authority vừa khóa.

## 19. Kết quả `TASK-PROG-204`

- `mkddc-web` chỉ mở `${CONFIG_DIR}/programming/programming-v1.sqlite` khi
  `PROGRAMMING_REV_A=true`, inject `application.ProjectService` vào router và
  đóng store trong lifecycle. Flag mặc định `OFF` không tạo DB hay side effect.
- Sáu operation `GET/POST projects`, `GET project`, `PATCH draft`, `POST
  revision`, `GET revision` chạy thật. 19 route Check/runtime/operation/bundle/
  audit còn trả `503` có mã ổn định; capabilities vẫn contract-only.
- Project create tạo Draft document canonical đầy đủ; list dùng cursor HMAC hạn
  15 phút và limit `1..100`. Draft hỗ trợ batch functional tag, program source/
  aggregate, variable, binding và Task; toàn batch validate rồi CAS bằng ETag
  mạnh `\"draftId:generation\"` trong một transaction.
- Seal snapshot manifest/object SHA-256 bất biến và tiến base Draft/ETag cùng
  transaction; Active/LKG không đổi. Read Project/Revision kiểm checksum trước
  response; UUID/reference/capacity và JSON duplicate/trailing/unknown field
  đều fail-closed.
- Migration v2 thêm receipt idempotency 24 giờ theo actor/action/target/key và
  semantic request hash. Replay cùng request giữ Project/Draft/Revision/ETag/
  audit identity kể cả sau restart; cùng key khác request trả conflict.
- Đường v1→v2 tạo backup đã `quick_check`; `VerifyBackup` đóng connection và dọn
  sidecar `-wal/-shm`, nên backup set chỉ có database + manifest đã kiểm.

## 20. Finding `TASK-PROG-204` đã đóng

| ID | Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|---|
| `F-G2-204-01` | P1 | Kiểm backup migration có thể để lại `-wal/-shm` sau khi mở DB read-only, làm tập backup không còn đúng hai artifact đã khai báo | Đóng DB trước khi hash/return và xóa sidecar chỉ trong thư mục backup đã resolve; thêm test nâng v1→v2 xác nhận đúng database + manifest | **CLOSED** |
| `F-G2-204-02` | P1 | UUID chỉ parse được nhưng chưa bắt dạng canonical, có thể tạo identity khác nhau giữa API/store/manifest | So sánh chuỗi parse lại với input lowercase canonical và thêm ca âm | **CLOSED** |
| `F-G2-204-03` | P1 | JSON chuẩn của Go có thể chấp nhận duplicate key và trailing document ở biên HTTP | Thêm scanner duplicate-key + EOF strict trước decode typed; kiểm contract âm/RBAC/no-side-effect | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi `TASK-PROG-204`.

## 21. Kiểm chứng `TASK-PROG-204` đo trong phiên

| Làn | Kết quả |
|---|---|
| Go Programming targeted | application/store/transport/lifecycle PASS cho create/list/get, Draft batch/ETag, Revision seal/read/checksum, idempotency restart, RBAC và migration v1→v2 |
| Go race detector | `go test -race ./internal/programming/application ./internal/programming/store ./internal/programming/transport/http -count=1` PASS |
| Go toàn repository | `go vet ./...` và `go test ./... -count=1` PASS |
| G1/contract | join `6/6`, self-test `5/5`, deploy-order âm `5/5`, error catalog `20 public/77 detail`, FBD mutation `10/10` PASS |
| C++ toàn repository | Release bật Modbus + BACnet + HMI; CTest `927/927` PASS trong 14,04 s |
| FE regression | Vitest `58/58` file, `494/494` test; lint/typecheck/build PASS |

Không chạy Chrome DevTools vì Task 204 chỉ đổi backend và consumer TypeScript
sinh tự động, không mount route/component hoặc đổi hành vi FE runtime. Không
deploy target/HIL/production, không bật feature và không có Core/Commission side
effect. `tools/restructure/verify_repository.py` vẫn chỉ FAIL ở baseline ngoài
task `apps/web-ui/src/features/scheduler/shared.ts` chạm contract C/SHM/IOP.

## 22. Ranh giới và bàn giao `TASK-PROG-205`

- Tổng giữ `2/60 I=Y`; các dòng SYS-102/106, BE-101/102/105 và NFR-106 chỉ có
  source partial. Hai record vẫn `BLOCKED`, 0/32 PASS và mọi `T/P/R=N`.
- `RSK-PROG-007/008/014` có treatment host mạnh hơn nhưng residual không giảm:
  chưa có compiler/Check worker, operation/Core read-back, target hoặc reviewer
  Test Result độc lập.
- Task 205 phải nhận immutable Revision + manifest/hash authority Task 203/204,
  chạy compiler subprocess không đặc quyền với timeout/memory/file/process/no-
  network limit, persist Check/diagnostic/artifact atomically và không stage/
  activate. Timeout/OOM/crash/hostile source phải kết thúc Check fail-closed,
  reap cả process group và giữ Active/LKG không đổi.

## 23. Kết quả `TASK-PROG-205`

- SQLite v3 thêm `check_requests` TTL 24 giờ, `attempt_count`, lease owner/expiry,
  state-transition/lease trigger và queue index. Claim dùng CAS; expired attempt
  được reclaim đúng một lần, attempt thứ hai hết lease chuyển `FAILED`.
- Hai operation `POST revision/checks` và `GET checks/{id}` chạy thật qua
  `application.CheckService`. Request/audit/Check `QUEUED` commit atomic; replay
  cùng actor/revision/target/key/request hash trả cùng `checkId` qua restart.
- `compiler.ProcessRunner` dùng argv cố định, scratch `0700`, output/file bounded,
  deadline `1..60 s` và giết cả process group. CLI `--sandbox` áp rlimit,
  `NO_NEW_PRIVS` và seccomp sau khi mở input/output; chặn network/socket, mở path
  mới, fork/clone/exec, mount và ptrace.
- Worker chỉ chấp nhận output khi artifact/manifest/profile/compiler/library/ABI,
  source ID, build key và SHA-256 khớp. `artifact.Store` ghi temp, `fsync`,
  hard-link publish, directory `fsync` và read-back; cấm traversal/symlink.
- `PASSED` commit terminal result + Artifact row + audit trong một transaction;
  `FAILED/TIMED_OUT` không có Artifact. Migration bỏ unique content hash sai để
  hai Check deterministic có row evidence riêng nhưng dùng chung blob SHA-256.
- OpenAPI v1.18, catalog v1.2.0 `20 public/80 detail`, Go/C++/TypeScript generated,
  CORS concurrency header và packaging compiler/install/rollback cùng thay đổi.
  Feature flag mặc định `OFF`; không có stage/activate/Core/Active/LKG side effect.

## 24. Finding `TASK-PROG-205` đã đóng

| Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|
| P1 | Schema v1 đặt unique trên Artifact content hash, làm Check thứ hai của cùng deterministic bytes không thể giữ row evidence riêng | Migration v3 thay unique constraint bằng index content, giữ unique `check_id`; filesystem vẫn dedup theo SHA-256 và test hai Check cùng bytes | **CLOSED** |
| P1 | Compiler CLI trước task có thể mở tài nguyên/process ngoài scratch nếu nhận source hostile | Mở ba file cố định trước sandbox; thêm rlimit/no-new-privs/seccomp, argv/env cố định, process-group kill và test version/sandbox/timeout | **CLOSED** |
| P1 | Check crash/restart chưa có identity/lease terminal bền vững | Receipt 24 giờ + lease/CAS tối đa hai attempt + terminal trigger/audit; test restart, expiry, lost lease và exhausted attempt | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi `TASK-PROG-205`.

## 25. Kiểm chứng `TASK-PROG-205` đo trong phiên

| Làn | Kết quả |
|---|---|
| Go Programming targeted | API `202→terminal`, restart/idempotency, lease/CAS/exhaustion, compiler thật, timeout process-group và artifact atomic/dedup/read-back/traversal/symlink PASS |
| Go race/toàn repository | Programming `-race` PASS; `go vet ./...` và `go test ./... -count=1` PASS |
| G1/contract | join `6/6`, deploy-order âm `5/5`, catalog `20 public/80 detail`, artifact manifest `7/7`, FBD mutation `10/10` PASS |
| C++ toàn repository | Release bật Modbus + BACnet + HMI; CTest `929/929` PASS |
| FE regression | Vitest `58/58` file, `494/494` test; lint/typecheck/build PASS |
| Packaging shell | `bash -n` và ShellCheck cho release/install/rollback PASS |

Không chạy Chrome DevTools vì Task 205 chỉ đổi backend, compiler CLI, packaging
và consumer TypeScript sinh tự động; không đổi component/layout/hành vi FE được
mount. Không deploy target/HIL/production trong source slice; flag giữ `OFF`.

## 26. Ranh giới và bàn giao `TASK-PROG-206`

- Tổng giữ `2/60 I=Y`; source Check làm rõ phần partial của SYS-101/102/106,
  BE-101..105 và NFR-101/102/106 nhưng chưa đủ end-to-end bundle/operation/Core/
  target. Hai record vẫn `BLOCKED`, 0/32 PASS và mọi `T/P/R=N`.
- `RSK-PROG-005/006/007/008/014` có treatment source mạnh hơn nhưng 16/16 risk
  vẫn Open: chưa đo cgroup/priority/IOP trên Forlinx, chưa stage/activate và chưa
  có Test Result độc lập.
- Task 206 phải tạo change manifest deterministic giữa hai Revision và bundle
  **source-only** có manifest/hash; import phải quarantine/validate rồi chỉ tạo
  Project/Draft atomic. Cấm Artifact/IR/native/cache/secret/symlink/hardlink/
  traversal/zip bomb và tuyệt đối không auto-Check/Commission/Active.

## 27. Kết quả `TASK-PROG-206`

- `ProjectService.GetRevisionChanges` so hai immutable Revision cùng Project,
  sort change theo category/kind/object ID, phân loại source/mapping/output/task/
  library/RETAIN và tạo `impactRef` SHA-256. `activeOverrides/cutover` thiếu Core
  authority là `UNAVAILABLE`, không suy thành `NONE`.
- Export tạo ZIP `Store` deterministic: path lexical, timestamp 1980 cố định,
  manifest root + từng file có SHA-256/size/kind/Revision/Object identity. Tập
  Revision được normalize theo sequence nên đổi thứ tự request không đổi bytes.
- Import kiểm expected SHA-256, giới hạn ZIP `4 MiB`, `1024` file,
  `256 KiB/file`; chỉ nhận exact path/kind source allowlist, reject compressed,
  encrypted, directory/link, absolute/`..`/backslash/control, duplicate path/JSON,
  sai target/profile/file set/hash/size/Revision manifest.
- Thành công gọi `ImportProject` trong một transaction để tạo đúng Project +
  Draft + audit + receipt; response ghi `DRAFT`, `checkCreated=false`,
  `artifactImported=false`, `commissionStarted=false`. Không tạo Revision,
  Check, Artifact, operation, Active hay LKG.
- SQLite v4 mở rộng receipt `BUNDLE_EXPORT/BUNDLE_IMPORT`; replay 24 giờ giữ
  response identity/audit, không ghi audit thứ hai; cùng key khác semantic
  request conflict. OpenAPI v1.19 sửa contract export `200`/import `201` inline,
  thêm machine schema bundle và nâng G1 join thành `7/7`.

## 28. Finding `TASK-PROG-206` đã đóng

| Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|
| P1 | Contract cũ export chỉ trả operation accepted còn import nhận `uploadRef`, nhưng không có endpoint upload hoặc lấy kết quả nên không thể truyền bundle thật | Chuyển sang contract đồng bộ bounded: export trả ZIP base64/hash/audit `200`, import nhận inline bundle/hash và trả Project/Draft `201`; OpenAPI/client/test cùng commit | **CLOSED** |
| P1 | Import retry ban đầu có nguy cơ trả resource rút gọn, khác safety fields của response lần đầu | Receipt lưu source Revision; replay dựng lại cùng `importedFromRevisionId`, bundle hash và bốn safety fields, test so identity | **CLOSED** |
| P1 | ZIP hợp lệ về hash vẫn có thể smuggle file/Revision ngoài manifest hoặc tạo Draft không deterministic nếu duyệt map | Bắt exact descriptor set theo Revision manifest, reject descriptor ngoài revision set và dựng Draft theo manifest file order đã sort | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi source `TASK-PROG-206`.

## 29. Kiểm chứng `TASK-PROG-206` đo trong phiên

| Làn | Kết quả |
|---|---|
| Go Programming targeted | change/impact deterministic, ZIP byte-exact qua đổi thứ tự Revision, export/import round-trip, hash mismatch zero mutation, receipt replay/conflict, HTTP `200→201`, migration v1→v4 PASS |
| Go race/toàn repository | Programming `-race` PASS; `go vet ./...` và `go test ./... -count=1` PASS |
| G1/contract | join `7/7`, deploy-order âm `5/5`, source bundle schema/hash/store v4/OpenAPI v1.19/client generated PASS |
| C++ toàn repository | Release bật Modbus + BACnet + HMI; CTest `929/929` PASS |
| FE regression | Vitest `58/58` file, `494/494` test; lint/typecheck/build PASS |

Không chạy Chrome DevTools vì Task 206 chỉ đổi backend contract/service/store và
consumer TypeScript sinh tự động; không đổi component/layout/hành vi FE được
mount. Không deploy target/HIL/production trong source slice; flag giữ `OFF`.

## 30. Ranh giới và bàn giao `TASK-PROG-207`

- Tổng giữ `2/60 I=Y`; Task 206 chỉ làm rõ source partial của SYS-102/106/107,
  BE-101/102/105/108/110 và NFR-106. Hai record vẫn `BLOCKED`, 0/32 PASS và mọi
  `T/P/R=N`; 16/16 risk vẫn Open.
- Task 207 phải dùng corpus hostile độc lập để chứng minh timeout/OOM/fuzz,
  traversal, zip bomb/compression, executable/native/cache/artifact smuggling,
  duplicate path/key, one-over limits và audit không lộ source/secret. Mọi reject
  phải zero mutation, không audit/domain partial và Active/LKG không đổi.
- Evidence Task 207 vẫn là host assurance; không được tự nâng target/HIL hoặc
  `RELEASE_READY`. Sau khi P2 8/8 mới chuyển theo dependency sang P3/P4.
