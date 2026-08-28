# Bằng chứng HOST — ba block chuẩn `TP`/`CTU`/`CTD` (`T59-804`, phần 3)

| Thuộc tính | Giá trị |
|---|---|
| Ngày | 2026-08-26 |
| Nhánh | `feat/t59-804-timer-counter-blocks` |
| Phạm vi | `T59-804` / `PGM02-V22-WP-03` — phần "bổ sung block target" |
| Authority | `AUTH-PROG-2026-08-24-05`; `DDD-CTRL-PROG-001` §7A (pin TRƯỚC khi code) |
| Lớp bằng chứng | **HOST/LOCAL** — không phải target/HIL |

## 1. Vì sao ba block này, và vì sao chỉ ba

Plan `WP-03` liệt kê `TP`/`CTU`/`CTD`/`SCALE`/`Deadband`/`Hysteresis`. Ba block
đầu là Function Block chuẩn IEC 61131-3 đi qua **đúng một cơ chế đã có**
(`FB_CALL` + `StFbType`), nên chúng chỉ thêm giá trị wire mới chứ không thêm
opcode mới. Ba block còn lại cần opcode IR mới (`SCALE`/`DEADBAND`) hoặc một FB
có ngữ nghĩa chưa được Controls chốt (`Hysteresis`) — chúng ở lại danh sách ma
cho tới khi có cùng bộ evidence, và verify script vẫn chặn nếu chúng lọt vào
registry trước.

## 2. Ngữ nghĩa đã pin trước khi code

`DDD-CTRL-PROG-001` §7A khoá chữ ký, giá trị wire, layout RETAIN và ba quyết
định dễ sai: `TP` không retrigger giữa xung; `RESET`/`LOAD` thắng sườn đếm trong
cùng cycle; `CV` bão hoà chứ không quấn vòng.

## 3. Cổng đã đo

| Cổng | Kết quả |
|---|---|
| CMake Release + CTest | **1297/1297 PASS** |
| Conformance ST↔FBD cycle-by-cycle | 8/8 stateTrace PASS (thêm `FB-006 TP`, `FB-007 CTU`, `FB-008 CTD`) |
| `go vet` + `go test ./... -count=1` | PASS |
| FE vitest | **143 file / 1568 test PASS** |
| FE lint + build | PASS; chunk Programming **103,93 KiB gzip** |
| E2E mock | **31 PASS / 5 skip / 0 fail** |
| E2E real-backend | **1/1 PASS**; parity catalog BE↔registry vẫn khớp ở 43 entry |
| `verify_programming_g1_contracts.py` | PASS (self-test **36/36**, thêm ca `versionHistory` đảo thứ tự) |
| `verify_programming_fbd_contract.py` / `pgm02` / `artifact_manifest` | PASS |
| `verify-project.sh --component layout` | PASS |

## 4. Ba lỗi thật do chính đợt này phơi ra

1. **Loader chặn cứng `fb_type > 5`.** Một artifact hợp lệ mang FB mới bị từ
   chối với "invalid FB type". Đã đổi ngưỡng theo chính enum, và giữ nguyên
   nguyên tắc: loader phải từ chối fb_type mà binary này chưa biết cách chạy.
2. **Cursor thư viện chấp nhận token đã bị sửa.** Test chống giả mạo đổi ký tự
   cuối của chữ ký; base64 raw **không strict** decode nó về đúng 32 byte cũ nên
   HMAC vẫn khớp. Test xanh chỉ vì may — bump registry làm ký tự cuối rơi vào
   đúng trường hợp đó và lộ ra. Đã siết `Strict()` khi decode và bổ sung ca kiểm
   "đổi bit thừa".
3. **Self-test `versionHistory` mất tác dụng khi lịch sử có nhiều hàng.** Nó sửa
   hàng `[0]`, vốn chỉ trùng version hiện hành khi lịch sử có đúng một hàng. Đã
   chuyển sang hàng cuối và thêm ràng buộc **append-only** cùng ca self-test đảo
   thứ tự.

## 5. Điều SẼ hỏng — tương thích nguồn

`TP`, `CTU`, `CTD` nay là **từ khoá**, nên Draft đang dùng ba tên đó làm tên biến
sẽ báo lỗi Check sau khi nâng cấp (§7A.5). Lựa chọn có chủ ý: một token hai
nghĩa là nguồn lỗi tệ hơn một lần đổi tên biến.

Artifact cũ KHÔNG hỏng: giá trị wire 1..5 giữ nguyên, chỉ thêm 6..8.

## 6. Còn thiếu

- Chưa đo trên bo: chưa chạy một Program dùng `TP`/`CTU`/`CTD` trên Forlinx.
- `SCALE`/`Deadband`/`Hysteresis` chưa có; `PID` vẫn `REVIEW_REQUIRED`.
- `VS-PROG-U13` chưa chạy; `RELEASE_READY` NO-GO.
