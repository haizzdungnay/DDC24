# Review triển khai G2 Programming — TASK-PROG-200

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-G2-IMPLEMENTATION-REVIEW-2026-08-11` |
| Task | `TASK-PROG-200` |
| Ngày | 2026-08-11 |
| Trạng thái task | **DONE** |
| Trạng thái pha | **P2 IN_PROGRESS — 1/8; G2 IN_PROGRESS** |
| Source commit | `8d58efa`, `a638470` |
| Evidence hỗ trợ | [`EV-PROG-G2-200`](programming-g2/raw/EV-PROG-G2-200.txt) |
| Test Result chính thức | **2/32 record BLOCKED; 0/32 PASS — không đổi** |
| Next action | `TASK-PROG-201` — FBD canonical model và keyboard command contract |

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
