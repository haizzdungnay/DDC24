# Đặc tả sản phẩm ứng dụng AHU hiệu suất cao MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `PROD-AHUHP-001` |
| Phiên bản | 0.1 |
| Trạng thái | **M3 — REVIEW READY / PROPOSED**; chưa thuộc baseline sản phẩm |
| Ngày | 2026-08-13 |
| Chủ quản | Product Owner + System Engineering |
| Người review | HVAC Lead, Controls Lead, FW-SOM Lead, FW-MCU Lead, FE/BE Lead, QA/HIL Lead |
| Người phê duyệt | CTO + Product Owner |
| Nguồn | Yêu cầu người dùng 2026-08-13; `PROD-BASE-001`; ASHRAE Guideline 36-2024 dùng làm guidance |
| Phạm vi | Ứng dụng điều khiển AHU hai quạt, hai coil nước và bốn đường gió điều biến FA/RA/SA/EA; simulator vòng kín phục vụ phát triển và kiểm chứng |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Sản phẩm mới là gì? | Một gói ứng dụng AHU có control sequence, point profile, dashboard, chẩn đoán lỗi và môi trường giả lập vòng kín; cùng logic có thể chuyển từ simulator sang I/O thật sau khi HIL đạt. |
| Vì sao không chỉ mở rộng `fake_mcu`? | `fake_mcu` là emulator lớp IOP/điện. Mô hình nhiệt–khí động phải do một AHU plant simulator riêng sở hữu để đầu vào phản ứng theo đầu ra và test tái lập được. |
| Cấu hình mục tiêu? | Hai quạt (mặc định quạt cấp và quạt hồi/xả), coil nước lạnh, coil nước nóng, bốn damper/lưu lượng FA, RA, SA, EA. |
| Ràng buộc phần cứng? | Rev A có 16 UI, 4 AO, 4 DO; bốn VAV dùng Modbus RTU Point mở rộng, không đổi IOP v2 hay SHM ABI chỉ để giả lập. |
| “Hiệu suất cao” nghĩa gì? | Điều khiển ổn định, reset setpoint theo nhu cầu, economizer/DCV, phối hợp cân bằng gió, tránh heating/cooling ngoài ý muốn, trend KPI và FDD thời gian thực. |
| Trạng thái hiện tại? | Hồ sơ đề xuất để CTO review; chưa phê duyệt, chưa implement, chưa có Test Result, target/HIL hay release evidence. |

## 1. Vấn đề và outcome

Hiện tại repository có emulator MCU IOP và mẫu ST điều khiển một quạt, nhưng
chưa có mô hình AHU vòng kín để kiểm tra quạt, coil, damper và tải tòa nhà tác
động lẫn nhau. Điều này làm unit test có thể đúng trong khi sequence tổng thể
vẫn hunting, vi phạm cân bằng lưu lượng hoặc xử lý sai sự cố.

Outcome sản phẩm:

1. Kỹ sư Controls có thể thiết kế, chạy, quan sát và tái lập một AHU hoàn chỉnh
   mà không cần MCU/VFD/actuator thật trong giai đoạn đầu.
2. Cùng artifact và I/O binding của ứng dụng được chuyển sang Foxlinx lab, sau
   đó sang HIL vật lý mà không đổi thuật toán cốt lõi.
3. Operator nhìn được mode, chất lượng điểm, luồng năng lượng, yêu cầu VAV,
   trạng thái override và nguyên nhân fault thay vì chỉ thấy giá trị tức thời.
4. QA có scenario định lượng và fault injection để phân biệt host simulation,
   target-with-fake-MCU và HIL thật.

## 2. Actor và use case

| ID | Actor | Use case | Kết quả quan sát được |
|---|---|---|---|
| `UC-AHUHP-001` | Controls Engineer | Chọn profile AHU và kiểm point binding | Hệ thống từ chối thiếu/sai type/unit/writable trước activation, không ghi một phần |
| `UC-AHUHP-002` | Controls Engineer | Chạy ngày hè thiết kế | SAT, airflow và áp suất đạt band cấu hình; không heating/cooling ngoài ý muốn |
| `UC-AHUHP-003` | Controls Engineer | Chạy ngày đông/warm-up | Freeze protection và trình tự quạt/coil đúng guard |
| `UC-AHUHP-004` | Commissioning Engineer | Step tải/VAV request | Static-pressure reset và fan loop ổn định, không hunting kéo dài |
| `UC-AHUHP-005` | Commissioning Engineer | Inject fan/damper/valve/sensor fault | Fault được phát hiện, output/state xác định, recovery có hysteresis |
| `UC-AHUHP-006` | QA | Chạy lại scenario cùng seed | Trace số bằng nhau trong tolerance đã khóa |
| `UC-AHUHP-007` | Operator | Theo dõi mimic AHU | Phân biệt GOOD/STALE/BAD/OFFLINE, source, override và mode |
| `UC-AHUHP-008` | Admin | Nạp/start/pause/reset scenario lab | Có xác nhận, RBAC, audit và read-back authoritative |
| `UC-AHUHP-009` | QA/HIL | Chuyển binding từ simulator sang I/O thật | Không thay control sequence; chỉ thay profile/binding đã review |
| `UC-AHUHP-010` | Release Lead | Đối chiếu evidence | Không dùng simulator để đóng timing điện, watchdog, actuator hay HIL gate |

## 3. Product capability

| ID | Capability | Acceptance cấp sản phẩm |
|---|---|---|
| `PC-AHUHP-001` | AHU closed-loop application | Hai quạt, hai coil và bốn đường gió cùng tham gia một mô hình cân bằng khối lượng/năng lượng |
| `PC-AHUHP-002` | High-performance sequence | Có mode lifecycle, trim-and-respond/reset, ventilation/economizer, split-range coil và anti-windup |
| `PC-AHUHP-003` | Deterministic digital twin | Scenario + parameter + seed tạo trace tái lập; hỗ trợ real-time và accelerated time |
| `PC-AHUHP-004` | Layer-faithful hardware simulation | IOP v2/PTY, raw electrical conversion, DO feedback và Modbus RTU VAV đi qua production adapters |
| `PC-AHUHP-005` | Fault detection and diagnostics | Có detection, stable code, delay, severity, recovery và evidence cho fault chính |
| `PC-AHUHP-006` | Operator and simulation UX | Dashboard responsive và Simulation Lab tách quyền; không trình bày dữ liệu minh họa như runtime evidence |

## 4. Product requirement

| ID | Phát biểu bắt buộc | Lý do | Priority | Verification/acceptance |
|---|---|---|---|---|
| `PR-AHUHP-001` | Sản phẩm **phải** điều khiển cấu hình hai quạt, coil lạnh, coil nóng và FA/RA/SA/EA điều biến. | Đúng bài toán đầu vào | Must | Demo scenario `SCN-AHUHP-NOMINAL-*` có đủ 8 actuator logical và feedback |
| `PR-AHUHP-002` | Sản phẩm **phải** giữ IOP v2 và physical I/O Rev A không đổi trong lát cắt simulator. | Tránh tạo SKU/ABI giả | Must | Contract diff bằng 0 cho `iop_protocol.h` và `mkddc_shm.h` |
| `PR-AHUHP-003` | Bốn VAV **phải** là Modbus RTU Point mở rộng hoặc thiết bị tương đương đã được CTO duyệt; không giả thành AO vật lý không tồn tại. | Trung thực phần cứng | Must | Point catalog/binding cho thấy bốn writable EXT riêng |
| `PR-AHUHP-004` | Control authority **phải** ở Core/Programming; Web và simulator không được ghi thẳng physical output bỏ qua priority/safety. | Local-first và safety boundary | Must | Negative test bypass bị từ chối; Web loss không dừng control |
| `PR-AHUHP-005` | FA/RA/SA/EA **phải** được điều phối theo cân bằng lưu lượng và áp suất, không triển khai bốn PID độc lập cạnh tranh. | Tránh hunting/sai mass balance | Must | Residual mass-balance trong band cấu hình và không có sustained oscillation |
| `PR-AHUHP-006` | Sequence **phải** có ventilation minimum, demand-control ventilation khi có CO2/occupancy, economizer, SAT control và static/building-pressure reset. | Hiệu suất và IAQ | Must | Scenario mùa hè/đông/tải bước đạt `VR-AHUHP-*` |
| `PR-AHUHP-007` | Heating và cooling ngoài ý muốn **không được** đồng thời; dehumidification là mode tường minh có guard. | Giảm lãng phí và fault ẩn | Must | Overlap ngoài mode cho phép bằng 0 sau delay |
| `PR-AHUHP-008` | Simulator **phải** có fault injection và trace tái lập, nhưng **không được** gọi là HIL hay release evidence vật lý. | Trung thực verification | Must | Nhãn evidence level xuất hiện trong UI/report và traceability |
| `PR-AHUHP-009` | Dashboard **phải** phơi quality/source/age/override/mode cùng KPI nhiệt, gió và năng lượng. | Operator cần biết độ tin cậy | Should | Desktop/mobile inspection + browser E2E |
| `PR-AHUHP-010` | Mọi mutation Simulation Lab **phải** có feature flag lab, RBAC, confirmation, audit và authoritative read-back. | Ngăn bật nhầm trên site | Must | API/RBAC/negative UI tests |
| `PR-AHUHP-011` | Cấu hình và scenario **phải** versioned, fail-closed, bounded và rollback được về LKG. | Tránh config lỗi làm control sai | Must | Hostile corpus + restart/power-loss test |
| `PR-AHUHP-012` | Chỉ được chuyển sang I/O thật sau khi target/HIL và residual risk được ký; simulator PASS không tự mở `RELEASE_READY`. | Cổng assurance độc lập | Must | Release checklist có Test Result và phê duyệt đúng thẩm quyền |

## 5. Phạm vi chức năng

### 5.1 Trong phạm vi candidate

- Hai quạt: mặc định `Supply Fan` và `Return/Exhaust Fan`; topology cho phép đổi
  nhãn/chức năng sau quyết định `OD-AHUHP-002` mà không đổi schema.
- Coil nước lạnh và coil nước nóng; topology hỗ trợ thứ tự coil và mode
  dehumidification nhưng không tự suy diễn layout cơ khí.
- Bốn air path FA/RA/SA/EA với command, feedback, airflow, temperature, humidity,
  pressure và quality áp dụng theo từng path.
- Một AHU/Controller trong Rev A; multi-AHU là bản sao profile độc lập, không chạy
  nhiều plant trong cùng control instance nếu chưa có capacity evidence.
- Point mapping local 16 UI/4 AO/4 DO và bốn VAV/CO2/occupancy qua Modbus RTU/VP.
- Web dashboard, Simulation Lab, trend, alarm/FDD và export trace.

### 5.2 Ngoài phạm vi candidate

- Tuyên bố chứng nhận hoặc tuân thủ ASHRAE/IEC/ISO/BTL.
- Safety PLC, smoke control được chứng nhận, life-safety sequence hoặc thay thế
  hardwired fire/freeze interlock.
- CFD, mô phỏng chi tiết 3D, sizing coil/fan/duct hoặc thiết kế cơ khí.
- Thay đổi số kênh MCU, IOP v2, SHM ABI hay hardware Rev A.
- Điều khiển plant nước lạnh/nóng trung tâm ngoài request/interlock AHU.
- Production enablement tại site trước `RELEASE_READY`.

## 6. Chỉ tiêu sản phẩm đề xuất

Các giá trị dưới đây là target candidate chờ CTO/HVAC Lead chốt tại
`OD-AHUHP-009`; chúng không phải evidence đã đạt.

| Chỉ tiêu | Target candidate | Cửa sổ đo |
|---|---:|---|
| Sai số SAT steady-state | `<= ±0,5 °C` | 10 phút sau settle |
| Sai số duct pressure/airflow | `<= ±5 %FS` | 5 phút sau step |
| Residual cân bằng lưu lượng | `abs(SA - FA - RA) <= 5 % SA_design` | mỗi plant step sau settle |
| Building pressure | trong band profile, mặc định `+5..+15 Pa` | 95% thời gian occupied |
| Ventilation | không thấp hơn minimum quá 60 s | occupied, sensor GOOD |
| Heating/cooling overlap ngoài dehumidification | `0 s` sau interlock delay | toàn scenario |
| Determinism | sai khác trace `<= 1e-6` với cùng build/config/seed | hai lần chạy cùng host/toolchain |
| Plant step | 100 ms mặc định, không bỏ quá 1 step real-time | soak 8 h host/target |

## 7. Chuẩn và nguồn tham chiếu

- [ASHRAE Guideline 36-2024 — Titles, Purposes and Scopes](https://www.ashrae.org/technical-resources/standards-and-guidelines/titles-purposes-and-scopes): dùng làm guidance cho high-performance sequence và functional testing; không sao chép nội dung có bản quyền và không claim compliance.
- `PROD-BASE-001`, `ADR-005`, `ADR-010`, `ADR-012`, `ADR-014`, `ADR-020`,
  `ADR-023`, `ADR-024`, `ADR-026..031` là constraint sản phẩm/kiến trúc hiện hành.

## 8. Gate và phê duyệt

| Gate | Trạng thái 2026-08-13 | Điều kiện mở |
|---|---|---|
| Document M3 | **PASS candidate** | Harness/link/ID/checklist của bộ hồ sơ đạt trong cùng worktree |
| M4 Review Closed | **BLOCKED** | Owner: consumer leads; ảnh hưởng: chưa đóng finding; gate: `PLAN_READY`; mở khi review và đóng P0/P1 |
| M5 Approved | **BLOCKED** | Owner: CTO + Product Owner; ảnh hưởng: chưa thành baseline; gate: `PLAN_READY`; mở bằng authority record ghim revision/hash |
| `IMPLEMENT_READY` | **BLOCKED** | Owner: CTO + System Architect; ảnh hưởng: chưa được code production; mở khi các `OD-AHUHP-*` áp dụng được quyết định và contract lát cắt machine-readable |
| `RELEASE_READY` | **BLOCKED** | Owner: QA + Release + Product; ảnh hưởng: không bật site thật; mở khi Test Result target/HIL và residual risk được ký |

## 9. Lịch sử và chữ ký

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo Product Spec candidate cho CTO review |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| Product Owner | Chưa ký | Chấp thuận capability, scope và KPI |
| CTO | Chưa ký | Chấp thuận kiến trúc/I/O/plan và funding |
| System Architect | Chưa ký | Xác nhận không phá topology/contract hiện hành |
| HVAC Lead | Chưa ký | Xác nhận topology, sequence và target vật lý |
