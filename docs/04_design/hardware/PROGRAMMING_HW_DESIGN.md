# Thiết kế phần cứng phục vụ Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-HW-PROG-001` |
| Phiên bản | 0.4 |
| Trạng thái | **M3 — Review Ready** — DD-01..13 đủ; thẩm quyền phần cứng vẫn NO-GO |
| Ngày | 2026-08-09 |
| Chủ quản | Hardware Lead |
| Người review | Firmware MCU Lead, Core Lead, Safety Lead, Verification Lead |
| Người phê duyệt | Hardware Lead + System Architect |
| Nguồn | Board schematic/PCB/BOM authority còn chờ cung cấp; `DDD-FWMCU-PROG-001` |
| Requirement | `HW-REQ-PROG-101..103` |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **phần cứng phải cung cấp gì để chứng minh được các tuyên bố của Programming**: đường IOP/UART, nguồn, reset, watchdog, và **điểm đo** để gắn que đo thật. Không có điểm đo thì mọi con số về thời gian và an toàn chỉ là lời nói. |
| 2. Ai phải đọc file này? | HW Lead (chủ quản); FW MCU đối chiếu pin và ngân sách thời gian; Safety ký hành vi an toàn của output; QA dùng §10 để dựng đồ gá HIL. |
| 3. Hệ thống hiện tại đang có gì? | **Rất ít thứ được chốt.** §7 có tám mục `HW-AUTH-001..008`; năm mục đang `BLOCKED` hoàn toàn (schematic/PCB/BOM, pin/peripheral/clock/DMA, nguồn/brownout/reset/watchdog, eMMC). Ba mục có giá trị mục tiêu nhưng chưa đo: UART 921600 baud, AO 0–10 V / 4–20 mA, DO 4 kênh, UI 16 kênh qua ADS131M08. |
| 4. Thiết kế mới thay đổi điều gì? | Không thiết kế mạch mới cho Programming. Việc cần làm là **phát hành baseline có kiểm soát** cho schematic/BOM/pin, rồi bổ sung điểm đo đủ để đo khoảng trống poll, thời điểm timeout, tính liên tục của output và thời điểm MCU vào trạng thái an toàn. |
| 5. Team phải sửa module/contract nào? | §12. HW phát hành baseline có kiểm soát, cập nhật bản đồ điểm đo, và mở yêu cầu dựng đồ gá HIL trước G6. |
| 6. Điều gì còn bị chặn? | §6: schematic/PCB/BOM production và BSP/pin mapping **chưa đủ để đóng gate**. Thẩm quyền HW là `NO-GO`. Điều kiện mở: HW Lead review tài liệu carrier/IO/MCU hiện hành, xác nhận điểm đo, và phát hành yêu cầu dựng HIL. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §5, §10 và §13: `VS-PROG-014` và `VS-PROG-030` với dạng sóng và thiết bị đã hiệu chuẩn; §13 định nghĩa khi nào một Test Result bị coi là **không hợp lệ**. Chưa có kết quả nào. |

Quy tắc cứng của hồ sơ này: **không điền số giả** khi schematic/BOM chưa có
baseline. Ô nào chưa biết thì ghi `BLOCKED` kèm owner và điều kiện mở, chứ không
điền giá trị ước lượng. Và simulator hay host test **không** được dùng để tuyên
bố tính liên tục điện, trạng thái an toàn, EMC, nhiệt hay khả năng sản xuất.

## 1. Phạm vi

Programming không yêu cầu mạch “PLC” mới. Tài liệu này xác định các ràng buộc
điện và khả năng đo kiểm để chứng minh Program → Core → iobus → MCU → 16 UI/4
AO/4 DO không phá safety/continuity hiện hữu. Modbus RTU dùng thiết kế riêng.

## 2. Ranh giới phần cứng liên quan

```text
SOM/RK3566
  ├─ CPU/RAM/eMMC: compiler + Revision/artifact storage
  ├─ UART cách ly Kinexus-IOP
  └─ reset/watchdog/power status
          │
STM32G0B1
  ├─ 2 × ADS131M08 → 16 UI
  ├─ DAC8554 + driver → 4 AO (0–10 V / 4–20 mA)
  ├─ relay driver/feedback → 4 DO
  └─ independent communication safe timeout
```

## 3. Design constraint

| ID | Ràng buộc |
|---|---|
| `HW-PROG-C-001` | UART/isolator/clock/level phải giữ Kinexus-IOP 921600 baud với margin trên temperature/supply/load đã xác định. |
| `HW-PROG-C-002` | MCU reset/power-on/brownout phải đưa AO/DO về state điện an toàn, không phụ thuộc SOM/Web/Core. |
| `HW-PROG-C-003` | SOM compiler load không được làm sụt rail/reset MCU hoặc tăng nhiễu ADC/AO ngoài tolerance. |
| `HW-PROG-C-004` | AO mode switching và enable/reset phải không tạo xung vượt envelope; mode ACK phải khớp path vật lý. |
| `HW-PROG-C-005` | Relay output phải có suppression/derating/feedback phù hợp để test repeated Commission/Restore không che welded/stuck fault. |
| `HW-PROG-C-006` | eMMC/rail phải chịu write policy Revision/artifact/RETAIN đã phân tích; mất điện không làm phần cứng vào trạng thái output không xác định. |

## 4. Test point và đo kiểm bắt buộc

| Điểm đo | Mục tiêu |
|---|---|
| IOP TX/RX hoặc trace header an toàn | đo `max_iop_poll_gap`, frame retry/timeout |
| MCU reset/watchdog/brownout indication | correlate reset với Core/Commission operation |
| AO1..AO4 test point/terminal | waveform hold-last, transition, safe timeout, mode V/mA |
| DO1..DO4 terminal + feedback | pulse/dropout/double actuation/weld detection |
| 24 V và rail SOM/MCU/analog | compiler load, activation, power-loss profile |
| ADC input/reference | jitter/noise dưới concurrent load và output transition |

Schematic/PCB/BOM phải gán reference designator, connector/pin, voltage range,
probe ground và instrument safety; prose này không thay schematic.

## 5. Acceptance HIL

- Poll gap trong Commission/Restore `<200 ms`, mục tiêu `<=100 ms`.
- Không có MCU safe entry khi activation bình thường; có safe entry đúng hạn khi
  cố ý cắt IOP.
- First Program contribution transition nằm trong tolerance/độ phân giải được
  phê duyệt; actual output vẫn theo priority/interlock.
- AO/DO về safe behavior khi SOM hang/reset, MCU reset và brownout.
- Compiler worst-case không gây reset/rail droop/EMI/noise vượt yêu cầu.
- Mọi phép đo ghi board/PCB/BOM revision, firmware/SOM artifact hash, instrument,
  sample rate, raw artifact và người phê duyệt.

## 6. Gap và gate

Schematic/PCB/BOM production và BSP/pin mapping hiện chưa đủ để đóng gate. HW
Lead phải review carrier/IO/MCU docs hiện hành, xác nhận test point và issue HIL
setup trước G6. Không dùng simulator/host test để claim electrical continuity,
safe-state, EMC, thermal hoặc manufacturing readiness.

## 7. Electrical authority register

Không điền số giả khi schematic/BOM chưa được baseline. Mỗi ô `BLOCKED` dưới đây
là gate bắt buộc. Vòng nội dung có thể hoàn tất khi đã có owner/impact/unlock,
nhưng việc nâng M3 vẫn cần HW/FW/Safety/QA peer review.

| ID | Authority cần khóa | Giá trị hiện biết | Owner / điều kiện mở |
|---|---|---|---|
| `HW-AUTH-001` | carrier + IO board schematic/PCB/BOM revision | `BLOCKED` | HW Lead phát hành controlled baseline |
| `HW-AUTH-002` | STM32 pin/peripheral/clock/DMA mapping | `BLOCKED` | HW+MCU đối chiếu `.ioc`, schematic, bring-up |
| `HW-AUTH-003` | UART isolator/level/termination/clock tolerance | 921600 baud target | tính margin + scope/BERT temperature/supply |
| `HW-AUTH-004` | AO voltage/current range, accuracy, compliance, slew | 0–10 V / 4–20 mA functional target | schematic/BOM/calibration spec + measurement |
| `HW-AUTH-005` | DO rating/default/de-energized/feedback | 4 channel target | relay/driver/load/derating/suppression baseline |
| `HW-AUTH-006` | UI range/reference/filter/noise/accuracy | 16 channel target | ADS131M08 path + calibration/measurement baseline |
| `HW-AUTH-007` | rail nominal/tolerance/brownout/reset/watchdog | `BLOCKED` | power-tree analysis + fault injection |
| `HW-AUTH-008` | eMMC endurance/capacity/power-loss | `BLOCKED` | storage part + workload/endurance/power-cut test |

## 8. Interface/net/pin/test-point template

Controlled board baseline phải điền bảng sau cho từng revision trước HIL:

| Signal/path | Connector/pin | Net/reference | Electrical limit | Test point/probe | Safe/default |
|---|---|---|---|---|---|
| SOM↔MCU UART TX/RX | `BLOCKED` | `BLOCKED` | level/baud/timing TBD owner HW | TP + isolated probe TBD | no false frame |
| MCU reset/watchdog/brownout | `BLOCKED` | `BLOCKED` | thresholds/tolerance TBD | reset/rail probe TBD | outputs safe |
| AO1..4 V/mA | `BLOCKED` | DAC8554/driver refs TBD | range/accuracy/load TBD | terminal + scope/DMM/shunt | per channel policy |
| DO1..4 | `BLOCKED` | relay/driver/feedback refs TBD | voltage/current/load TBD | terminal/current/feedback | de-energized/policy |
| UI1..16 | `BLOCKED` | ADS131M08 path refs TBD | input/common-mode/noise TBD | input/ref TP | quality invalid on fault |
| SOM/MCU/analog rails | `BLOCKED` | power tree TBD | nominal/ripple/droop TBD | rail TP + current probe | reset sequence safe |

HW Lead phải thay `BLOCKED` bằng drawing/BOM section và revision, không chỉ prose.
Probe ground/isolation/category phải được safety review trước đo trên field power.

## 9. Analysis và acceptance định lượng

| Analysis | Input | Output/pass authority |
|---|---|---|
| UART timing/error budget | oscillator, isolator delay, baud tolerance, temperature/supply | sampling margin + error rate; HW/MCU sign |
| power transient | compiler CPU/eMMC load, MCU/AO/relay load, brownout | rail min/max/ripple/reset count trong part limits |
| AO transition | mode switch, full-scale step, load/open/short | overshoot/settling/accuracy/compliance trong approved envelope |
| DO reliability | load/inrush/suppression/repeat transition | no weld/chatter/double pulse; feedback detect |
| UI noise | concurrent compiler/eMMC/AO/relay activity | RMS/peak/accuracy không vượt calibration spec |
| storage endurance | Revision/artifact/audit/RETAIN daily write model | lifetime + reserve ≥ product target; power-cut integrity |
| thermal/EMC | worst CPU/I/O/load/environment | no reset/error/out-of-limit; formal test plan authority |

Target numbers chưa có controlled schematic/product electrical baseline giữ
`BLOCKED`; QA không được tự chọn tolerance sau khi đo.

## 10. HIL fixture và procedure

Fixture cần: programmable DC source/power interrupter, isolated logic analyzer/
scope, calibrated DMM, current shunt/source/load cho AO, relay loads/feedback,
UI precision source, temperature condition nếu scope yêu cầu, serial frame capture
và synchronized operation markers.

```text
record board/BOM/firmware/Core/artifact/config hashes
→ calibrate instrument + record uncertainty/sample rate
→ establish GRAPH/PROGRAM active and actual output baseline
→ run Check/Commission/Restore/compiler load/fault matrix
→ inject IOP 199/200/201 ms, Core/MCU reset, brownout, load faults
→ capture raw waveform/frame/counter/operation/read-back
→ compare pre-approved limits; reviewer signs immutable Test Result
```

## 11. Fault/safe/recovery matrix

| Fault | Physical expectation | Digital correlation | Recovery |
|---|---|---|---|
| SOM/Core hang | MCU enters safe by deadline | last age/safe counter/reset cause | restore IOP, explicit recovery policy |
| UART corrupt/loss | no false/double actuation | CRC/LEN/SEQ counters | retry then timeout safe |
| MCU reset/brownout | AO/DO default safe, no unsafe pulse | reset reason/power waveform | handshake/config/read-back |
| DAC/driver/relay fault | no false ACK; output/feedback mismatch | channel fault/quality | service/isolate channel |
| compiler/eMMC load | no rail reset/UI/AO out of tolerance | Core op + rail/noise trace | throttle/block mutation |
| power loss during state write | physical safe and boot LKG | journal/RETAIN/storage integrity | deterministic restore |

## 12. Repository/evidence mapping, rollout và rollback

| Artifact | Authority/path | Evidence |
|---|---|---|
| schematic/PCB/BOM | controlled HW repository/release package `BLOCKED` | revision/export/hash/reviewer |
| MCU board config | `.ioc`, BSP/pin map in `firmware/stm32/` | cross-build + pin review + target capture |
| IOP contract | `contracts/iop/iop_protocol.h` | protocol/baud/timeout cross-test |
| test procedure/results | `docs/05_verification` / controlled records | raw waveform/log/CSV/photo/instrument calibration |
| risk/trace | `RSK-PROG-003/013`, VS-014/015/030 | links to approved Test Result only |

Programming deploy không yêu cầu HW spin nếu current board passes. Nếu fail do
margin/circuit, software throttle không được dùng để che safety defect; ECO có
impact/verification/revision. Rollback software/firmware phải giữ compatible IOP
và physical safe default; hardware rollback theo controlled BOM/ECO.

## 13. Test Result record và tiêu chí invalid

Mỗi phép đo HIL phải có record độc lập hoặc bundle bất biến chứa:

| Nhóm field | Nội dung bắt buộc |
|---|---|
| Identity | Test ID, board serial, schematic/PCB/BOM rev, firmware/Core/artifact/config hash |
| Instrument | model/serial, calibration due date, probe/load, sample rate/bandwidth, uncertainty |
| Setup | net/pin/test point, wiring ảnh/sơ đồ, ambient/supply/load, fixture version |
| Stimulus | command/fault/timestamp sequence, số lần lặp, precondition và safe baseline |
| Raw result | waveform/CSV/frame/log không chỉnh sửa, time synchronization và checksum |
| Evaluation | limit authority, measured min/max/p95 nếu áp dụng, uncertainty, PASS/FAIL |
| Review | operator, witness/reviewer, date, deviation/incident/change link |

Result `INVALID` khi instrument quá hạn, board/BOM không định danh, mất raw data,
timebase không correlate digital/physical, limit chưa được phê duyệt hoặc setup
khác procedure mà không có deviation. `INVALID` không được tính PASS/FAIL và
không làm giảm residual risk.

## 14. Verification, blocker, lịch sử và ký

| Test ID | PASS authority |
|---|---|
| `HW-T-001` UART margin/load/temp | bit/frame error và timing trong approved limit |
| `HW-T-002` AO V/mA modes/fault/transition | range/accuracy/overshoot/settle/safe envelope PASS |
| `HW-T-003` DO load/feedback/repeat/reset | rating/pulse/weld/chatter/safe PASS |
| `HW-T-004` UI noise/accuracy concurrent load | calibration/noise limit PASS |
| `HW-T-005` rails/brownout/compiler/eMMC | no unintended reset/droop; intended safe reset PASS |
| `HW-T-006` 199/200/201 ms/power cut | physical output + digital evidence correlate PASS |

Blocker hiện tại: `HW-AUTH-001..008` và HIL chưa hoàn tất. Owner HW Lead + MCU/
Safety/QA; mở khi controlled board package, pre-approved limits, fixture và Test
Results được ký. Trạng thái phần cứng vẫn NO-GO dù vòng nội dung chi tiết đã hoàn tất.

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Boundary/constraint/test point/HIL baseline |
| 0.2 | 2026-08-09 | Bổ sung authority register, net/pin/test template, analysis, fixture, fault/evidence M3 |
| 0.3 | 2026-08-09 | Bổ sung schema Test Result, instrument/setup/raw evidence/review và tiêu chí INVALID; chuyển Detailed Draft chờ HW/QA review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; ghi `DD-03` là BLOCKED vì chưa có baseline schematic/BOM có kiểm soát |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| HW + MCU + Core + Safety + QA | Chờ review | — |
| Hardware Lead + System Architect | **BLOCKED — chưa phê duyệt** | schematic/BOM/BSP/limits/HIL |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §14 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0, §1 phạm vi và §2 ranh giới phần cứng liên quan tới Programming |
| `DD-03` As-Built | **BLOCKED** | §7: năm trong tám mục `HW-AUTH-*` đang `BLOCKED` hoàn toàn. Owner: HW Lead. Ảnh hưởng: chưa có baseline schematic/PCB/BOM và pin/clock/DMA thì **không tồn tại As-Built có kiểm soát để dẫn chứng**. Gate: `DOC-G5`. Điều kiện mở: HW Lead phát hành baseline có kiểm soát cho `HW-AUTH-001/002/007/008` |
| `DD-04` Target ownership | PASS | §2 và §7 gán owner cho từng mục thẩm quyền điện |
| `DD-05` Data từng field | PASS | §8 mẫu interface/net/pin/test-point; ô chưa biết ghi `BLOCKED` thay vì điền số giả |
| `DD-06` Interface | PASS | §2 đường IOP/UART, nguồn, reset; §8 bảng net và điểm đo |
| `DD-07` Timing/điện | PASS | §3 ràng buộc thiết kế; §9 phân tích và acceptance định lượng |
| `DD-08` Operation flow | PASS | §10 đồ gá HIL và quy trình đo |
| `DD-09` Error/safety | PASS | §11 ma trận fault/safe/recovery cho reset MCU, mất lệnh SOM và chuyển tiếp nguồn |
| `DD-10` Repository mapping | PASS | §12 ánh xạ repository/evidence, rollout và rollback |
| `DD-11` Verification | PASS | §4 điểm đo bắt buộc; §5 acceptance HIL; §13 định nghĩa khi nào Test Result **không hợp lệ** |
| `DD-12` Compatibility/deploy/rollback | PASS | §12 rollout và rollback theo revision phần cứng |
| `DD-13` Trace/risk/decision/sign-off | **BLOCKED** | Owner: HW Lead + FW + Safety + QA. Ảnh hưởng: thẩm quyền HW đang `NO-GO`, nên `RSK-PROG-013` (20 điểm) giữ nguyên và G5/G6 không mở. Gate: `DOC-G5`. Điều kiện mở: phát hành baseline có kiểm soát, xác nhận bản đồ điểm đo, dựng đồ gá HIL, rồi đo `VS-PROG-014/030` bằng thiết bị đã hiệu chuẩn |

Hai `BLOCKED`, mỗi mục đủ bốn trường — đây là phản ánh trung thực tình trạng
phần cứng, không phải thiếu sót tài liệu. **Không** tuyên bố sẵn sàng về điện,
EMC, nhiệt, an toàn hay sản xuất khi chưa có bằng chứng đo thật.
