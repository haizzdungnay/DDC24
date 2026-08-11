# Review triển khai G1 Programming — TASK-PROG-100/101/102/103

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-G1-IMPLEMENTATION-REVIEW-2026-08-11` |
| Task | `TASK-PROG-100`, `TASK-PROG-101`, `TASK-PROG-102`, `TASK-PROG-103` |
| Ngày | 2026-08-11 |
| Trạng thái task | **DONE — 4 contract foundation task** |
| Trạng thái pha | **P1 IN_PROGRESS — 4/6** |
| Source commit | Task 100: `9917e3b`, `81080f8`, `efbed2d`; Task 101: `51fe515`, `e9707b4`; Task 102: `95585e7`; Task 103: `4a1e9f5` |
| PR / merge | Task 100: [PR #127](https://github.com/Mekong-HCM/MK-DDC-24/pull/127) / `7109bae`; Task 101: [PR #129](https://github.com/Mekong-HCM/MK-DDC-24/pull/129) / `adcefed`; Task 102: [PR #131](https://github.com/Mekong-HCM/MK-DDC-24/pull/131) / `16d3e40`; Task 103: [PR #133](https://github.com/Mekong-HCM/MK-DDC-24/pull/133) / `1c74b9f` |
| Test Result chính thức | **0/32 — không đổi** |
| Evidence hỗ trợ | [`EV-PROG-G1-100`](programming-g1/raw/EV-PROG-G1-100.txt), [`EV-PROG-G1-101`](programming-g1/raw/EV-PROG-G1-101.txt), [`EV-PROG-G1-102`](programming-g1/raw/EV-PROG-G1-102.txt), [`EV-PROG-G1-103`](programming-g1/raw/EV-PROG-G1-103.txt) |

## 1. Kết quả triển khai

- OpenAPI `1.15.0` khai báo 23 path, 25 operation `/api/v1/programming`, RBAC,
  idempotency, `If-Match`, giới hạn mutation 1 MiB và error envelope ổn định.
- Go mount cùng 25 route qua `RegisterProgrammingRoutes`; flag
  `PROGRAMMING_REV_A` mặc định `OFF`, nên binary bình thường vẫn trả `404`.
- Khi flag bật, skeleton chỉ kiểm auth/header/body/schema major và trả
  `503 PRG-ERR-UNAVAILABLE-001`; không giữ state, không gọi Core, không có side
  effect Commission.
- `ValidateImpactAcknowledgements` fail-closed cho `NONE/PRESENT/UNAVAILABLE`,
  acknowledgement thiếu/thừa/trùng và `impactRef` stale.
- Client TypeScript được sinh từ OpenAPI; golden impact payload được Go và FE
  cùng đọc; build FE chạy phép kiểm drift trước
  `tsc`/Vite. FE không tự khai báo danh sách route hoặc error enum thứ hai.

## 2. Kiểm chứng trong phiên

| Làn | Lệnh/kết quả |
|---|---|
| OpenAPI | YAML parse PASS; 605 local `$ref`, thiếu 0; 25 operation; operationId trùng 0 |
| Go targeted | `go test ./internal/programming/... ./internal/app -count=1` PASS |
| Go toàn repo | `go vet ./...` PASS; `go test ./... -count=1` PASS, 12 package có test + 2 package không có test |
| FE contract | generator/check PASS 25 operation; test client/golden 4/4 PASS |
| FE toàn repo | Vitest 54/54 file, 473/473 test PASS; lint PASS; TypeScript/Vite build PASS |
| C++ regression | Release với Modbus + BACnet + HMI build PASS; CTest 860/860 PASS |
| Tài liệu | candidate pin, trace hai chiều, docs ISO harness và `git diff --check` chạy lại trước commit tài liệu |

Không chạy Chrome DevTools: task chỉ thêm contract, router bị flag `OFF` và
client sinh tự động; không thêm route/component/layout hiển thị. Không deploy
target/HIL vì thẻ task ghi rõ không áp dụng ở lát cắt contract-only này.

## 3. Truy vết và ranh giới kết luận

- `BE-110` được nâng riêng `I=Y` sau khi source merge, dẫn đúng commit/file/symbol.
- `FE-110` giữ `I=N`: client đã có nhưng Draft reducer và flow conflict chưa làm.
- `NFR-106` giữ `I=N`: transaction/audit và đo conflict `<=1 s` thuộc task sau.
- Không tạo `TR-PROG-*`; `T/P/R` của toàn bộ 60 requirement vẫn `N`.
- `RELEASE_READY` tiếp tục `BLOCKED`; feature flag không được bật production.

## 4. Next action theo dependency

`TASK-PROG-100..103` đã `DONE`. Next action là `TASK-PROG-104` (schema SQLite,
migration và backup); `TASK-PROG-105` là review join cuối P1 sau khi 104 đạt DoD.

Remote branch `feat/programming-contract-foundation-20260811` đã xóa sau merge.

## 5. Kết quả `TASK-PROG-101`

- Contract `programming_v1` dùng frame `uint32 little-endian` + canonical CBOR,
  protocol `1.0`, request/operation/correlation ID, monotonic deadline, SHA-256
  payload, active/LKG, `keepsRunning` và component detail.
- Core C++ có codec và `ProgramIpcServer::HandleFrame`; skeleton chỉ trả
  capability. Mutation chưa được nối và trả `UNAVAILABLE/IPC-CONTRACT-ONLY`,
  không stage/swap/reset hoặc chạm ScanLoop.
- Backend Go có `Client.Call` qua Unix domain socket, kiểm `SO_PEERCRED`, bounded
  read/write/deadline/correlation; `Client.Reconcile` chỉ gửi
  `OPERATION_STATUS`, không replay mutation sau timeout/restart.
- Ba golden frame có SHA-256 trong manifest; C++ và Go decode/encode lại
  byte-identical. Schema hash cũng được test để drift làm build fail.

### 5.1 Finding phát hiện và đã đóng trước commit

| ID | Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|---|
| `F-G1-101-01` | P1 | Decoder ban đầu chấp nhận CBOR indefinite/non-minimal dù contract yêu cầu canonical | Decode rồi canonical re-encode và so byte ở cả C++/Go; payload action cũng phải canonical; thêm ca âm | **CLOSED** |
| `F-G1-101-02` | P1 | `net.Conn.Write` có thể short-write nhưng client ban đầu xem một lần gọi là hoàn tất frame | Thêm `writeAll`, fail khi zero-byte write; fake Core dùng cùng helper | **CLOSED** |
| `F-G1-101-03` | P1 | JSON schema dùng chung kiểu UUID nullable khiến `requestId` vô tình cho phép `null` | Tách `uuidBytes` bắt buộc và `nullableUuidBytes` chỉ cho `operationId` | **CLOSED** |
| `F-G1-101-04` | P2 | `.gitignore` toàn repo bỏ qua `*.hex`, có nguy cơ merge manifest nhưng thiếu golden corpus | Force-add đúng ba fixture đã ghim và kiểm `git ls-files` trước commit | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi Task 101. Review security xác nhận peer
credential, giới hạn frame/queue/deadline, hash/canonical validation, duplicate
request và no-replay đều fail-closed. Socket listener/runtime operation worker là
output của task sau, không được giả là đã có.

## 6. Kiểm chứng `TASK-PROG-101` và truy vết

| Làn | Kết quả đo trong phiên |
|---|---|
| C++ targeted | `ProgramIpc*` 7/7 PASS: round-trip, malformed/oversize/version/canonical, peer/deadline/queue, duplicate, golden |
| Go targeted | codec/client/golden/manifest PASS; `go test ... -race -count=1` PASS |
| C++ toàn repo | Release Modbus+BACnet+HMI build PASS; CTest 867/867 PASS |
| Go toàn repo | `go vet ./...` PASS; `go test ./... -count=1` PASS |
| FE regression | Vitest 54/54 file, 473/473 test; lint/build PASS; generated Programming API vẫn 25 operation |
| Tài liệu | candidate pin, trace hai chiều, docs ISO harness và `git diff --check` chạy lại trước commit tài liệu |

Trace giữ đúng **1/60** requirement `I=Y`: `BE-110` được bổ sung source IPC.
`SYS-104`, `BE-106` và `NFR-105` chỉ có phần client/no-replay/skeleton nên vẫn
`I=N` cho tới khi có operation worker, durable transaction, runtime integration
và target fault injection. Không tạo `TR-PROG-*`; mọi `T/P/R=N`, Test Result
giữ `0/32`, feature flag giữ `OFF` và `RELEASE_READY` vẫn `BLOCKED`.

Không chạy Chrome DevTools vì task không đổi UI component/route/layout. Không
deploy target/HIL vì task này khóa contract và skeleton không mutation; target
continuity là acceptance của gate sau, không được suy từ host test.

Tại thời điểm đóng Task 101, next action theo dependency là `TASK-PROG-102` và
`TASK-PROG-104`; Task 102 nay đã hoàn tất, vì vậy `TASK-PROG-103` đã được mở và
`TASK-PROG-105` vẫn là review join cuối P1.

Remote branch `feat/programming-ipc-v1-20260811` đã xóa sau merge PR #129.

## 7. Kết quả `TASK-PROG-102`

- Thêm `contracts/programming/rev_a_profile_v1.json` và hai JSON Schema khóa
  profile `revA-1t-1-5-30`, Task `1/5/30 s`, capacity, type/width/wire code,
  ST/FBD, Point allowlist, Core Library `rev-a.1` và `HASH_ONLY`.
- Generator tạo `st_profile_generated.hpp`; test SHA-256 và từng field làm build
  fail khi profile và hằng C++ drift. `ValidateRevAProfile` được serializer và
  loader gọi lại; boundary test phủ `limit-1/limit/limit+1` của 15 resource.
- Thay `allow_unsigned` bằng `StIntegrityMode`; mặc định Rev A luôn kiểm SHA-256,
  không yêu cầu chữ ký, còn `SIGNATURE_OPTIONAL` bị từ chối. CLI không tự ký bằng
  khóa test; timestamp layout khóa về `0`.
- API `EncodeArtifactDeterministic`, `VerifyArtifact`, `LoadArtifact` dựng
  candidate tạm và chỉ publish output sau khi toàn bộ bước pass. Artifact lỗi
  không xóa/ghi đè object Active giả lập của caller.
- Ghim golden `MKDDCIR1` 1.760 byte cùng provenance/hash và corpus âm
  machine-readable. 100 lần compile cùng input cho byte giống hệt.

### 7.1 Finding phát hiện và đóng trong phiên

| ID | Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|---|
| `F-G1-102-01` | P1 | Decision `HASH_ONLY` đã Accepted nhưng source vẫn dùng `allow_unsigned` và CLI luôn ký khóa test | Thay bằng enum policy; default HASH_ONLY; cấm optional; thêm test unsigned/signed/bad-signature | **CLOSED** |
| `F-G1-102-02` | P1 | `load_st_artifact` xóa output caller trước verify, trái bất biến Active/LKG không đổi khi reject | Load vào candidate cục bộ, move sang output chỉ sau success; thêm test sentinel no-mutation | **CLOSED** |
| `F-G1-102-03` | P1 | `SOURCE_DATE_EPOCH` làm cùng source có thể sinh byte khác giữa môi trường, trái deterministic contract | Khóa build timestamp về 0; thời gian tạo chuyển sang DB/audit; test lặp 100 lần | **CLOSED** |
| `F-G1-102-04` | P2 | Chạy libFuzzer trực tiếp trên thư mục golden làm sinh corpus thu nhỏ cạnh fixture normative | Xóa đúng các file hash phát sinh; evidence sau dùng corpus tạm, chỉ commit ba golden file có manifest | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi Task 102. Profile đã khóa hệ kiểu target,
nhưng compiler/runtime As-Built chưa emit/execute `INT16/UINT16` và chưa có FBD
producer. Phần đó thuộc `TASK-PROG-200`; không tạo test equivalence giả ở P1.

## 8. Kiểm chứng `TASK-PROG-102` và truy vết

| Làn | Kết quả đo trong phiên |
|---|---|
| JSON Schema/profile | 2 schema hợp lệ; profile instance + golden manifest validate PASS; generated constants `--check` PASS |
| C++ targeted | `StProfile*` + `StIr*` 32/32 PASS; golden byte-exact, negative corpus, no-mutation, 100 build deterministic |
| Fuzz loader | clang/libFuzzer 10.000 runs, không crash/hang/OOB |
| C++ toàn repo | Release Modbus+BACnet+HMI build PASS; CTest 875/875 PASS |
| Go toàn repo | `go vet ./...` PASS; `go test ./... -count=1` PASS |
| FE regression | Vitest 54/54 file, 473/473 test; lint PASS; generated client 25 operation và Vite build PASS |
| Tài liệu | candidate pin 22/22, trace 60/60 + 32/32, docs ISO harness và `git diff --check` PASS |

Trace nâng riêng `CORE-101 I=Y`: source đã verify magic/schema/target/profile/
size/hash/section/control-flow/resource, không parse source ở RT path và có
unit/fuzz reject. `SYS-101` và `NFR-101` giữ `I=N` vì môi trường Programming đầy
đủ, FBD/type target, Check/BE/FE và target acceptance chưa có. Không tạo
`TR-PROG-*`; mọi `T/P/R=N`, Test Result giữ `0/32`, feature flag giữ `OFF` và
`RELEASE_READY` vẫn `BLOCKED`.

Next action: `TASK-PROG-103` đã được mở vì `100..102 DONE` và được chạy song song
với `TASK-PROG-104`; `TASK-PROG-105` chờ hai task này.

Remote branch `feat/programming-profile-artifact-v1-20260811` đã xóa sau merge
PR #131; candidate v2.11 xuất hiện trên `main` tại tree `a0add512`.

## 9. Kết quả `TASK-PROG-103`

- Thêm `contracts/programming/error_catalog_v1.json`, JSON Schema và manifest
  làm nguồn máy đọc duy nhất cho **19** mã công khai và **77** ánh xạ
  component/detail. Catalog SHA-256 là
  `2315add30a8e5880dbf09574371ed662726004c0e04372d16c88164d182571d4`.
- Generator sinh cùng metadata/hàm `MapComponentError`, `IsRetryable` và
  `messageKey` cho Core C++, backend Go, frontend TypeScript; `--check` và build
  FE fail khi source/generated/OpenAPI lệch.
- OpenAPI nâng `1.16.0` và công bố đủ 19 mã. Backend canonicalize mã,
  `messageKey`, HTTP/retry; allowlist `args/field` và loại path/source/stack/
  secret, nested value, số không hữu hạn và control character.
- FE xác thực HTTP/code, correlation ID, metadata và args trước khi dựng
  `ProgrammingApiError`; mã/detail/HTTP lạ rơi về
  `PRG-ERR-UNAVAILABLE-001` và không được suy `keepsRunningRevision=true`.

### 9.1 Finding phát hiện và đóng trong phiên

| ID | Mức | Finding | Cách đóng | Trạng thái |
|---|---|---|---|---|
| `F-G1-103-01` | P1 | Header C++ sinh ban đầu có brace thừa nên không compile | Sửa tại generator, sinh lại và thêm hai CTest catalog/mapping | **CLOSED** |
| `F-G1-103-02` | P0 | FE có thể giữ `keepsRunningRevision=true` từ envelope mang mã lạ | Chỉ tin flag khi code được biết và HTTP thuộc catalog; fallback mặc định false; thêm test hostile | **CLOSED** |
| `F-G1-103-03` | P1 | OpenAPI chỉ có 8/19 mã authority | Nâng 1.16.0, đủ 19 enum và generator so tập hai chiều | **CLOSED** |
| `F-G1-103-04` | P1 | BE nhận messageKey/args/HTTP tự do, có thể lộ detail hoặc cho consumer rẽ nhánh sai | Canonicalize ở writer, allowlist key/value/field, mismatch HTTP về default và thêm test leak | **CLOSED** |
| `F-G1-103-05` | P2 | Fallback C++ ban đầu phụ thuộc vị trí phần tử cuối catalog | Generator tính index fallback theo `unknownFallbackCode`, không phụ thuộc thứ tự | **CLOSED** |

Không còn finding P0/P1 mở trong phạm vi Task 103. Catalog khóa contract lỗi,
không đồng nghĩa operation worker, Commission lifecycle hoặc FE Draft reducer
đã hoàn tất.

## 10. Kiểm chứng `TASK-PROG-103` và truy vết

| Làn | Kết quả đo trong phiên |
|---|---|
| Catalog/schema | JSON Schema PASS; generator `--check` PASS 19 public/77 detail; negative generator 6/6 |
| C++ targeted | `ProgramErrorCatalog*` 2/2 PASS; unknown detail fail-safe |
| Go targeted | domain + transport HTTP PASS; canonical metadata/status và no-sensitive-args |
| FE targeted | generated catalog/client 10/10 PASS; TypeScript PASS |
| C++ toàn repo | Release Modbus+BACnet+HMI build PASS; CTest 877/877 PASS |
| Go toàn repo | `go vet ./...` và `go test ./... -count=1` PASS |
| FE toàn repo | Vitest 55/55 file, 479/479 test; lint và build PASS |

Trace chỉ bổ sung source Task 103 cho `BE-110` và phần đã có của
`SYS-103/105`, `FE-110`. Tổng `I=Y` giữ **2/60** vì lifecycle/ScanLoop/Draft
reducer chưa end-to-end. Không tạo `TR-PROG-*`; mọi `T/P/R=N`, Test Result giữ
`0/32`, feature flag giữ `OFF` và `RELEASE_READY` vẫn `BLOCKED`.

Không chạy Chrome DevTools vì task không đổi component/route/layout hiển thị.
Không deploy target/HIL vì đây là contract foundation và production mutation
vẫn bị chặn fail-safe.

Remote branch `feat/programming-error-catalog-v1-20260811` đã xóa sau merge
PR #133; candidate v2.12 xuất hiện trên `main` tại tree `db5e225f`.
