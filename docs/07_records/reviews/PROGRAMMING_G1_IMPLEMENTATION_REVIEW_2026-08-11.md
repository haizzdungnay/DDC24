# Review triển khai G1 Programming — TASK-PROG-100/101/102

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-G1-IMPLEMENTATION-REVIEW-2026-08-11` |
| Task | `TASK-PROG-100`, `TASK-PROG-101`, `TASK-PROG-102` |
| Ngày | 2026-08-11 |
| Trạng thái task | **DONE — 3 contract foundation task** |
| Trạng thái pha | **P1 IN_PROGRESS — 3/6** |
| Source commit | Task 100: `9917e3b`, `81080f8`, `efbed2d`; Task 101: `51fe515`, `e9707b4`; Task 102: `95585e7` |
| PR / merge | Task 100: [PR #127](https://github.com/Mekong-HCM/MK-DDC-24/pull/127) / `7109bae`; Task 101: [PR #129](https://github.com/Mekong-HCM/MK-DDC-24/pull/129) / `adcefed`; Task 102: branch `feat/programming-profile-artifact-v1-20260811`, chờ merge |
| Test Result chính thức | **0/32 — không đổi** |
| Evidence hỗ trợ | [`EV-PROG-G1-100`](programming-g1/raw/EV-PROG-G1-100.txt), [`EV-PROG-G1-101`](programming-g1/raw/EV-PROG-G1-101.txt), [`EV-PROG-G1-102`](programming-g1/raw/EV-PROG-G1-102.txt) |

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

`TASK-PROG-101`, `TASK-PROG-102` và `TASK-PROG-104` được chạy song song. Sau
khi `100..102` đều `DONE`, bắt đầu `TASK-PROG-103`; `TASK-PROG-105` là review
join cuối P1.

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
