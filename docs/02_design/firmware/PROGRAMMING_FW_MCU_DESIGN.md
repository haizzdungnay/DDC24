# Thiết kế FW MCU phục vụ Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-FWMCU-PROG-001` |
| Phiên bản | 0.5 |
| Trạng thái | **M3 — Review Ready** — DD-01..13 đủ; HIL vật lý vẫn RED |
| Ngày | 2026-08-09 |
| Chủ quản | Firmware MCU Lead |
| Người review | Core Lead, Hardware Lead, Safety Lead, Verification Lead |
| Người phê duyệt | Firmware MCU Lead + System Architect |
| Nguồn | Kinexus-IOP contract, `DDD-CTRL-PROG-001`, `DDD-HW-PROG-001` |
| Requirement | `FW-REQ-PROG-MCU-101..104` |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và HIL evidence chưa có vẫn thực hiện trong task.

> ⚠️ **Tham khảo, không ràng buộc team MCU (2026-09-30).** Firmware MCU do một team riêng thiết kế và thực hiện. Ràng buộc với team đó chỉ gồm [Yêu cầu FW MCU `FW-REQ-MK-DDC-24-VI` v3.1](../../01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md) và [ICD SOM ↔ MCU `IOP-SPEC-MK-DDC-24-VI` v3.0](../../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) (cả hai đang Draft, chờ ký). Nội dung dưới đây là ý đồ thiết kế cũ của dự án; khi khác hai tài liệu trên thì hai tài liệu đó thắng.
> Các yêu cầu hành vi của file này (liên tục IOP khi Commission, frame lặp, 199/200/201 ms, ACK sau khi ghi phần cứng, trường chẩn đoán) đã được đưa vào ICD `ICD-R-01..09`, §6.9 và FW-REQ v3.1. Phần tổ chức main-loop/ISR/buffer (§9, §12, §15) là gợi ý.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **firmware STM32 phải làm gì để Programming an toàn**: giữ IOP không đứt trong lúc Commission, tự vào trạng thái an toàn khi mất lệnh, không thực thi output hai lần khi frame lặp, và báo chẩn đoán. |
| 2. Ai phải đọc file này? | FW MCU Lead (chủ quản); Core đọc §4 (IOP không đứt khi Commission); HW đọc §10 và cùng ký ngân sách thời gian; QA dựng bài HIL từ §8 và §14. |
| 3. Hệ thống hiện tại đang có gì? | Đã có mã thật: `firmware/stm32/src/iop/iop_link.*` và `src/app/ddc24_runtime.*` với parser, CRC, xử lý frame trùng sequence, safe-state lúc khởi động, callback actuation và timeout truyền thông `IOP_SAFE_TIMEOUT_MS=200 ms`. **Nhưng** `Core/Src/main.c` vẫn đi qua weak HAL; `.ioc`, pin/peripheral, BSP production và HIL vật lý **chưa đủ**. |
| 4. Thiết kế mới thay đổi điều gì? | Không đổi vai trò MCU — MCU **vẫn không biết** ST, FBD, Project hay Revision. Việc cần làm là hoàn thiện BSP thật và chứng minh bằng đo đạc rằng khi SOM tráo chương trình, MCU **không** rơi vào safe-timeout. |
| 5. Team phải sửa module/contract nào? | §13. Hoàn thiện `.ioc`/pin/clock/DMA, thay weak HAL bằng BSP thật, và bổ sung ánh xạ chẩn đoán ở §11. |
| 6. Điều gì còn bị chặn? | Toàn bộ bằng chứng điện: cần board có BSP thật cộng thiết bị đo đã hiệu chuẩn. Phụ thuộc `HW-AUTH-001`/`HW-AUTH-002` trong [HW Design](../../04_design/hardware/PROGRAMMING_HW_DESIGN.md) §7. Gate HIL đang `RED`. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §8 và §14: `VS-PROG-014` và `VS-PROG-030` trên HIL — đo bằng logic analyzer và dạng sóng AO/DO, kiểm mốc `199/200/201 ms` ở §10, chèn lỗi mất frame, brownout và reset. **Host test không chứng minh được ADC/DAC/relay/UART trên target.** |

Vì sao ngưỡng `200 ms` quan trọng: MCU tự bảo vệ độc lập với SOM. Nếu việc tráo
chương trình làm gián đoạn IOP quá `200 ms`, MCU sẽ ép output về trạng thái an
toàn ngay giữa lúc vận hành bình thường — đó là `RSK-PROG-003`, mức 20.

## 1. Ranh giới

Programming không thêm ST/FBD/IR/Project/Revision vào STM32. MCU tiếp tục là
I/O controller độc lập: sample UI, áp AO/DO, xử lý Kinexus-IOP, diagnostics và
safe behavior. Mọi logic Program chạy trên SOM/Core và chỉ tác động MCU qua
output command hiện hữu sau priority/interlock/safe-state.

## 2. As-Built và khoảng trống

`firmware/stm32/src/iop/iop_link.*` và `src/app/ddc24_runtime.*` đã có parser,
CRC, sequence duplicate handling, startup safe-state, actuation callback và
communication timeout `IOP_SAFE_TIMEOUT_MS=200 ms`. `Core/Src/main.c` còn qua
weak HAL; `.ioc`/pin/peripheral/BSP production và HIL vật lý chưa đủ. Host test
không chứng minh ADC/DAC/relay/UART target.

## 3. State machine

```text
BOOT → SAFE
  └─ handshake hợp lệ → SESSION
       ├─ frame mới hợp lệ → execute + response, cập nhật last_rx
       ├─ duplicate SEQ → resend response, không execute lại
       ├─ CRC/LEN/CMD lỗi → NACK + counter, không actuation
       └─ no valid frame >=200 ms → SAFE
```

`GET_IO` không tự xóa safe state theo cách che lỗi actuation; trạng thái/diagnostic
phải phản ánh lần vào safe, reset reason, UART/CRC/SEQ và fault ADC/DAC/relay.

## 4. IOP continuity khi Commission/Restore

- MCU không nhận lệnh “activate revision”; nó chỉ thấy cadence IOP liên tục.
- Core/iobus phải giữ poll gap `<200 ms`, mục tiêu `<=100 ms` khi swap.
- Nếu gap chạm timeout, MCU phải vào safe behavior dù SOM cho rằng activation
  thành công; Core/BE phải đọc fault/safe counter và Commission không được PASS.
- Duplicate/retry quanh activation không được double actuation.
- `CMD_SET_AO_CFG` phải ACK mode trước lệnh AO theo mode mới; command sai version/
  capability bị từ chối theo IOP contract.

## 5. Safe output

| Condition | AO | DO | Bằng chứng yêu cầu |
|---|---|---|---|
| boot/reset | giá trị safe được HW/FW phê duyệt | de-energized/safe policy | waveform boot |
| no valid IOP 200 ms | safe | safe | timestamp + physical measurement |
| bad CRC/LEN/unknown command | giữ command hợp lệ gần nhất cho tới timeout; không execute lỗi | tương tự | negative protocol test |
| DAC/relay callback fail | set fault, không báo ACK thành công sai | set fault | injected HAL failure |
| brownout/watchdog | safe theo HW reset/default | safe | power-fault HIL |

Giá trị safe cụ thể theo mode/channel phải lấy từ Hardware/Safety baseline; không
hard-code giả định khác với circuit/policy được phê duyệt.

## 6. Timing và concurrency

- UART RX DMA/IRQ + IDLE line đưa byte vào parser bounded; không block main loop.
- Tick kiểm timeout dùng wrap-safe elapsed arithmetic.
- Sampling/actuation và response phải đạt IOP response budget từ contract.
- Diagnostics không làm chậm poll/actuation.
- Không cấp phát động; buffer/frame có size compile-time và validate length.

## 7. Diagnostics contract

Tối thiểu expose firmware version, uptime/reset reason, rx/crc/len/seq counters,
safe entry count/current safe state, ADC/DAC/relay fault và sample count. Nếu cần
thêm `last_valid_rx_age_ms`/`max_gap_ms` để đóng HIL, phải version IOP payload và
cập nhật cả producer/consumer/test; không đọc offset tự phát.

## 8. Test bắt buộc

- Host unit: byte split/IDLE recovery, CRC/LEN/CMD, duplicate sequence, wrap-around
  timeout, callbacks fail, safe state idempotent.
- Cross-build Cortex-M0+ warnings-as-errors và map/stack review.
- Target: UART 921600, DMA/IDLE, handshake/capability, poll load, reset/brownout.
- HIL: cắt IOP 199/200/201 ms; core restart; concurrent Commission; retry/loss;
  AO 0–10 V/4–20 mA; relay; waveform và diagnostic correlation.

Chỉ target/HIL evidence có firmware hash, board revision, instrument, procedure
và result mới được dùng đóng `VS-PROG-014/015/030`.

## 9. Module, ISR/DMA và buffer ownership

| Module/context | API/state | Buffer/concurrency |
|---|---|---|
| `iop_link.c/.h` | parser state, SEQ, CRC/counter, last valid tick | fixed RX frame ≤`IOP_MAX_FRAME`; feed byte/chunk từ owner duy nhất |
| `ddc24_runtime.c/.h` | safe/session/output config/callback | main-loop state; callback result quyết ACK/NACK |
| UART RX DMA + IDLE ISR | snapshot DMA write index, signal work | ISR không parse/actuate/log; copy/advance bounded ring |
| timer/SysTick | monotonic ms tick | atomic width hoặc critical section bounded; wrap-safe subtract |
| ADC/DAC/relay HAL/BSP | sample/apply/read-back/fault | DMA buffers double-buffer nếu BSP chọn; no heap |

ISR chỉ clear flag, capture length/tick và enqueue flag; parser/run-loop tiêu thụ.
Một owner cập nhật `last_valid_rx_ms` chỉ sau frame CRC/LEN/CMD/sequence hợp lệ và
actuation policy thành công theo command. Bad frame không nuôi watchdog liên lạc.

## 10. Timing contract 199/200/201 ms

```text
elapsed = (uint32_t)(now_ms - last_valid_rx_ms)
if session_established && elapsed >= IOP_SAFE_TIMEOUT_MS:
    enter_safe_once(REASON_COMM_TIMEOUT)
```

| Stimulus | Expected state/output |
|---|---|
| last valid age 199 ms | chưa timeout; giữ command hợp lệ/winner trước |
| age đúng 200 ms | vào SAFE trong lần service timeout đầu tiên |
| age 201 ms | đã SAFE; counter không tăng lặp mỗi tick |
| tick wrap `UINT32_MAX→0` | behavior giống elapsed thật |
| valid duplicate SEQ | resend cached response, không re-actuate; policy có/không refresh watchdog phải theo IOP authority |

Service interval MCU phải ≤1 ms hoặc giá trị BSP được HW/FW phê duyệt; do đó safe
entry physical deadline là `200 ms + service jitter`. Con số jitter/tolerance
cuối phải đo HIL, không suy từ host unit.

## 11. Command, read-back và fault mapping

| Command class | Guard/action | Response/fault |
|---|---|---|
| handshake/capability | protocol/version/board identity | unsupported NACK, no state mutation |
| GET_IO/diagnostic | coherent sample snapshot | quality/fault/counters + sequence |
| SET_AO_CFG | validate channel/mode/range → HAL configure → read-back | ACK chỉ sau success; fail keeps safe/previous config |
| SET_OUTPUT | validate mode/range/session/safe policy → apply batch | no partial ACK; HAL failure fault + safe policy |
| duplicate | same SEQ + request digest | cached exact response; body khác reject protocol |

Core phải map MCU diagnostic thành Point quality/Commission read-back; không biến
callback fail thành ACK success. Nếu IOP protocol hiện chưa mang đủ batch/read-back
atomic fields, thay đổi phải version contract trước firmware.

## 12. Memory, stack và defensive behavior

- Static assert `IOP_MAX_FRAME=258` theo contract; length reject trước copy/CRC.
- RX ring/frame/response/cache/callback context static, size ghi trong map review;
  no malloc/free/printf blocking trong ISR/main control path.
- Integer conversion/channel index/range checked; invalid enum never reaches HAL.
- Watchdog/brownout/reset cause latched trước clear và đưa diagnostic. Safe routine
  idempotent, không phụ thuộc communication response.
- Diagnostics counter saturating hoặc documented wrap; snapshot coherent, không
  đọc torn multi-byte field giữa ISR/main.

## 13. Repository/build/config mapping

| Path | Sửa/tạo Target |
|---|---|
| `firmware/stm32/src/iop/iop_link.*` | protocol negative/duplicate/timeout diagnostic nếu thiếu |
| `firmware/stm32/src/app/ddc24_runtime.*` | batch apply/read-back/safe reason/idempotency |
| `firmware/stm32/Core/Src/main.c` | thay weak HAL bằng production BSP wiring có generated boundary |
| `.ioc`/BSP/board config | UART 921600 DMA+IDLE, ADC/DAC/relay/reset/watchdog/pin authority |
| `firmware/stm32/tests/` | limit/wrap/fault/duplicate tests |
| `firmware/stm32/hostcheck/CMakeLists.txt` | warnings/sanitizer host gate; không thay cross-build |

## 14. Verification, rollout và rollback

| Test ID | Fixture | PASS/evidence |
|---|---|---|
| `MCU-T-001` | host corpus split/concatenate/CRC/LEN/CMD/SEQ | exact ACK/NACK/counter; no OOB |
| `MCU-T-002` | 199/200/201/wrap tick | transition/counter/output đúng bảng §10 |
| `MCU-T-003` | HAL fail từng AO/DO/config/read-back | no false ACK/partial actuation; fault visible |
| `MCU-T-004` | cross-build/map/stack | warnings zero; stack/RAM within approved margin |
| `MCU-T-005` | target UART DMA/IDLE under max poll | zero overrun/lost frame ngoài criterion |
| `MCU-T-006` | HIL AO/DO/ADC/reset/brownout/core swap | electrical/timing/diagnostic correlation PASS |

Deploy MCU protocol-compatible trước Core feature; capability gates command mới.
Rollback không downgrade qua protocol major hoặc safe policy incompatible; restore
known compatible Core/MCU pair. Firmware update failure phải boot known-good và
physical outputs safe theo platform OTA contract.

## 15. ISR/main-loop ownership và atomic apply

| Dữ liệu | Writer | Reader | Đồng bộ |
|---|---|---|---|
| RX DMA buffer/index | DMA + UART IDLE ISR | protocol parser main loop | volatile index/snapshot; parser không đọc vùng DMA đang ghi |
| decoded command | parser main loop | command executor | single-owner queue/static slot |
| ADC sample bank | ADC DMA ISR | coherent sample publisher | double buffer + generation |
| desired output batch | command executor | HAL apply | validate toàn batch trước critical section |
| actual/read-back | HAL callback/main loop | response builder/diagnostic | snapshot generation; no torn field |
| last valid frame/tick | parser main loop | timeout/safety tick | wrap-safe unsigned delta |
| fault/reset counters | ISR/HAL/main loop theo loại | diagnostic snapshot | saturating atomic/critical section ngắn |

Atomic output batch:

```text
decode → validate length/CRC/SEQ/session/channel/type/range
→ build desired batch in inactive buffer
→ enter bounded critical section → HAL apply all supported channels
→ read back/latch actual + generation → leave critical section
→ ACK only when every required apply/read-back succeeds
```

Nếu phần cứng không hỗ trợ rollback toàn batch, preflight phải bảo đảm mọi channel
hợp lệ trước apply và lỗi giữa batch phải kích safe routine + NACK/diagnostic;
không ACK partial success. Exact critical-section WCET thuộc cross-build/HIL.

## 16. Blocker, lịch sử và phê duyệt

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| `.ioc`/BSP/pin/peripheral production chưa authority | FW MCU + HW | review board package và cross-build target |
| Safe value/tolerance từng channel chưa ký | Safety + HW | schematic/BOM/safety decision approved |
| HIL vật lý chưa chạy | FW MCU + QA | MCU-T-005/006 và VS result approved |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Boundary/state/continuity/safe/timing/test baseline |
| 0.2 | 2026-08-09 | Bổ sung module/ISR/DMA/buffer, timeout edge, command/read-back, source/deploy/test M3 |
| 0.3 | 2026-08-09 | Bổ sung ISR/DMA/main ownership, coherent snapshot và atomic output batch/fail-safe algorithm; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; gắn blocker vào `HW-AUTH-001/002` |
| 0.5 | 2026-09-30 | Gắn nhãn tham khảo cho team MCU riêng; yêu cầu hành vi chuyển vào ICD `IOP-SPEC-MK-DDC-24-VI` v2.0 và `FW-REQ-MK-DDC-24-VI` v3.0 |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| MCU + Core + HW + Safety + QA | Chờ review | — |
| Firmware MCU Lead + System Architect | **BLOCKED — chưa phê duyệt** | BSP/pin/safe-value/HIL |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §16 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §1 ranh giới: MCU **không biết** ST/FBD/Project/Revision |
| `DD-03` As-Built | PASS | §2 dẫn `firmware/stm32/src/iop/iop_link.*`, `src/app/ddc24_runtime.*`, `IOP_SAFE_TIMEOUT_MS=200 ms`; ghi rõ `Core/Src/main.c` còn qua weak HAL và `.ioc`/pin/BSP/HIL chưa đủ |
| `DD-04` Target ownership | PASS | §9 quyền sở hữu module, ISR/DMA và buffer; §15 phân chia ISR ↔ main loop và áp dụng atomic |
| `DD-05` Data từng field | PASS | §11 command, đọc ngược và ánh xạ fault; byte layout ở `contracts/iop/iop_protocol.h` |
| `DD-06` Interface | PASS | §4 IOP không đứt khi Commission/Restore; §7 hợp đồng chẩn đoán |
| `DD-07` State/algorithm/timing | PASS | §3 state machine; §6 timing và concurrency; §10 hợp đồng thời gian `199/200/201 ms` |
| `DD-08` Operation flow | N/A tại file này | Không có mặt người dùng; quy trình thay thiết bị ở `OPS-PROG-001` §5 |
| `DD-09` Error/safety/security | PASS | §5 safe output; §12 bộ nhớ, stack và hành vi phòng vệ; frame trùng sequence không thực thi output hai lần |
| `DD-10` Repository mapping | PASS | §13 repository, build và config |
| `DD-11` Verification | PASS | §8 và §14 gắn `VS-PROG-014/030` trên HIL với logic analyzer và dạng sóng |
| `DD-12` Compatibility/rollout/rollback | PASS | §14 rollout và rollback firmware |
| `DD-13` Trace/risk/decision/sign-off | **BLOCKED** | Owner: FW MCU Lead + HW Lead + Safety + QA. Ảnh hưởng: **không có BSP production và không có board đo được** thì mọi khẳng định về `200 ms` chỉ là suy luận từ mã nguồn; `RSK-PROG-003` (20 điểm) và `RSK-PROG-013` (20 điểm) không giảm. Gate: `DOC-G5` (HIL). Điều kiện mở: `HW-AUTH-001` và `HW-AUTH-002` được phát hành, hoàn thiện `.ioc`/BSP thật, dựng đồ gá HIL, rồi đo `VS-PROG-014/030` bằng thiết bị đã hiệu chuẩn |

Một `BLOCKED`, đủ bốn trường. Bằng chứng điện/target/HIL vẫn `RED`. **Không được
tuyên bố MCU đã sẵn sàng production.** Host test không chứng minh ADC/DAC/relay/UART.
