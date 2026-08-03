Đúng. **Trình tự phải là:**

```text
1. Viết Product Spec Programming
2. Đồng bộ toàn bộ tài liệu theo Product Spec
3. Sửa lỗi và hoàn thiện SRC nền DDC hiện tại
4. Review readiness
5. Sau đó mới lập Design và Plan implement Programming
```

Audit cho thấy Modbus mới có engine/protocol nhưng đường point quản lý end-to-end chưa được chứng minh đầy đủ; point metadata còn phân tán, CI đang đỏ, config chưa atomic, STM32 firmware vẫn placeholder và hệ thống thực tế đang chạy fake MCU.

# I. PRODUCT SPEC — DDC-24 PROGRAMMING

**Document ID:** `DDC24-PROGRAMMING-PRODUCT-SPEC-001`
**Version:** `0.1 DRAFT`
**Phạm vi:** Định nghĩa sản phẩm Programming phải làm được gì.
**Không bao gồm:** kiến trúc phần mềm, API chi tiết, database schema hoặc implementation plan.

## 1. Mục tiêu sản phẩm

Programming cho phép kỹ sư BMS tạo và vận hành logic điều khiển trực tiếp trên DDC-24 mà không phải sửa firmware.

Ứng dụng chính:

* AHU, FCU, PAU.
* Bơm, quạt, van và damper.
* Lead/Lag và Duty/Standby.
* Điều khiển nhiệt độ, áp suất, độ ẩm.
* Interlock và sequence.
* Alarm logic.
* Schedule và occupancy.
* Logic kết hợp Local I/O, Modbus và BACnet.

Đây là **DDC Programming cho HVAC/BMS**, không định vị là motion PLC hoặc safety PLC.

---

## 2. Đối tượng người dùng

| Vai trò       | Quyền                                         |
| ------------- | --------------------------------------------- |
| Viewer        | Xem chương trình và trạng thái runtime        |
| Operator      | Theo dõi biến, ACK alarm, force theo quyền    |
| Engineer      | Tạo, sửa, validate và deploy chương trình     |
| Administrator | Activate, rollback, quản lý quyền và thư viện |

---

## 3. Mô hình sản phẩm

```text
Programming Project
├── Project Information
├── Point & Variable Library
├── I/O and External Point Mapping
├── Programs
│   ├── Program_AHU
│   ├── Program_Pump
│   └── Program_Alarm
├── Function Block Library
├── Validation Result
└── Deployment Versions
```

### 3.1 Project

Mỗi Project phải có:

* Project ID.
* Tên và mô tả.
* Controller model.
* Người tạo và người sửa.
* Revision.
* Trạng thái.
* Ngày tạo và ngày cập nhật.
* Danh sách Program.
* Point mapping.
* Phiên bản đang Active.

### 3.2 Program

Mỗi Program phải có:

* Tên duy nhất.
* Mô tả.
* Ngôn ngữ ST hoặc FBD.
* Enable/Disable.
* Cycle time.
* Execution order.
* Watchdog.
* Startup mode.
* Trạng thái runtime.
* Danh sách input/output được sử dụng.

Cycle time Rev A:

```text
1 second
5 seconds
30 seconds
```

Chu kỳ dưới 1 giây không thuộc Rev A, chỉ mở sau khi có kiểm chứng timing.

### 3.3 Trạng thái Program

```text
DRAFT
VALID
BUILD_FAILED
READY_TO_DEPLOY
DEPLOYED
ACTIVE
STOPPED
FAULT
ROLLED_BACK
ARCHIVED
```

---

## 4. Ngôn ngữ lập trình

### Rev A bắt buộc

* Structured Text — ST.
* Function Block Diagram — FBD.

ST và FBD phải sử dụng chung:

* Point.
* Variable.
* Function block.
* Runtime.
* Validation.
* Deployment lifecycle.

### Ngoài Rev A

* LD.
* SFC.
* C/C++ user code.
* Script Python.
* Motion language.
* Safety programming.

Không tuyên bố full IEC 61131-3 certification trong Rev A.

---

## 5. Point và Variable

### 5.1 Nguồn dữ liệu

Program phải sử dụng được:

* Local physical I/O.
* Virtual Point.
* Modbus RTU Point.
* Modbus TCP Point.
* BACnet/IP Point.
* Schedule state.
* Alarm state.
* System Point.
* Internal Program Variable.

### 5.2 Data type

Rev A hỗ trợ:

* `BOOL`
* `INT`
* `DINT`
* `REAL`
* `TIME`

Mỗi Point phải có:

* Point ID bất biến.
* Tag name duy nhất.
* Display name.
* Data type.
* Unit.
* Giá trị hiện tại.
* Quality.
* Timestamp.
* Read/Write.
* Retain.
* Default value.
* Safe value.
* Source.
* Device reference.

### 5.3 Quality

```text
GOOD
UNCERTAIN
BAD
STALE
OFFLINE
CONFIG_ERROR
```

Program không được coi Point `BAD`, `STALE` hoặc `OFFLINE` là dữ liệu bình thường.

---

## 6. External Point Management

### 6.1 Modbus RTU Point

Người dùng phải có thể:

* Tạo Modbus RTU device.
* Chọn RS485-1 hoặc RS485-2.
* Cấu hình baud rate, parity, stop bit và slave ID.
* Khai báo Point.
* Import/export danh sách Point.
* Test đọc/ghi trực tiếp.
* Xem trạng thái online/offline.
* Xem timeout, retry và lỗi CRC.
* Map Point vào Program Variable.

Loại thanh ghi:

* Coil.
* Discrete Input.
* Input Register.
* Holding Register.

Kiểu dữ liệu:

* Bit.
* UInt16/Int16.
* UInt32/Int32.
* Float32.
* Word order và byte order.
* Scale, offset, min và max.

### 6.2 Modbus TCP Point

Dùng chung Point Model với Modbus RTU, chỉ khác connection:

* IP address.
* Port.
* Unit ID.
* Connection timeout.
* Reconnect policy.

### 6.3 BACnet Point

Hỗ trợ tối thiểu:

* AI, AO.
* BI, BO.
* AV, BV.
* MSV.

Cho phép:

* Discover device.
* Discover object.
* Import Point.
* Map Point.
* COV hoặc polling.
* Read/Write theo permission.

---

## 7. Function Block Library

### 7.1 IEC cơ bản

* AND, OR, NOT, XOR.
* ADD, SUB, MUL, DIV.
* MIN, MAX, LIMIT.
* Compare.
* SEL, MUX.
* TON, TOF, TP.
* R_TRIG, F_TRIG.
* CTU, CTD.
* SR, RS.
* PID.

### 7.2 DDC/HVAC

* Analog Scaling.
* Deadband.
* Hysteresis.
* Sensor Filter.
* Alarm Delay.
* Minimum ON Time.
* Minimum OFF Time.
* Runtime Counter.
* Lead/Lag.
* Duty/Standby.
* Pump Sequence.
* Fan Interlock.
* Heating/Cooling Sequence.
* Damper Control.
* Valve Control.
* Occupancy Mode.
* Schedule Enable.
* Freeze Protection.
* Sensor Failure Handling.

---

## 8. Workflow người dùng

```text
Create Project
→ Configure/Import Points
→ Create Variables
→ Map Points
→ Create Program
→ Write ST or FBD
→ Validate
→ Simulate/Test
→ Create Revision
→ Deploy
→ Activate
→ Online Monitor
→ Rollback khi cần
```

Không cho sửa trực tiếp revision đang Active.

Mọi thay đổi phải tạo revision mới.

---

## 9. Runtime Behavior

Mỗi cycle phải thực hiện:

```text
1. Chốt Input Snapshot
2. Cập nhật External Points
3. Chạy Program được Enable
4. Kiểm tra lỗi dữ liệu
5. Resolve output ownership
6. Áp dụng interlock và safe-state
7. Commit Output một lần
8. Cập nhật runtime diagnostics
```

Yêu cầu:

* Một cycle dùng cùng một snapshot.
* Không commit output giữa chừng.
* Một Program lỗi không được làm dừng toàn bộ controller.
* Program timeout phải bị dừng và tạo alarm.
* Output phải về trạng thái an toàn khi mất runtime.
* Không cho hai engine cùng sở hữu một output.

---

## 10. Output Priority

Thứ tự ưu tiên:

```text
Safety
→ Manual Emergency Override
→ Authorized Manual Force
→ BACnet Priority Command
→ Schedule
→ Active Program
→ Default Value
```

Một output chỉ được map tới **một logic owner Active**.

Nếu legacy graph và Program cùng ghi một output, validation phải từ chối activation.

---

## 11. Deployment và Rollback

* Validate trước khi build.
* Artifact phải có version và checksum.
* Deploy không làm ảnh hưởng Program đang Active.
* Activate chỉ thực hiện tại ranh giới cycle.
* Activation phải atomic.
* Activation lỗi phải giữ phiên bản cũ.
* Lưu tối thiểu 10 revision gần nhất.
* Có nút rollback về Last Known Good.
* Reboot phải tự chạy lại phiên bản Active gần nhất.
* Không được mất RETAIN khi warm restart hợp lệ.

---

## 12. Online Monitoring

Người dùng phải xem được:

* Program Running/Stopped/Fault.
* Cycle count.
* Cycle execution time.
* Last run time.
* Watchdog và overrun.
* Giá trị variable.
* Point quality và timestamp.
* Function block state.
* Output owner.
* Lý do output bị override.
* Active revision.

Force phải hiển thị rõ:

* Người force.
* Giá trị.
* Thời gian bắt đầu.
* Thời gian hết hạn.
* Audit record.

---

## 13. UI bắt buộc

| Page                 | Chức năng                                |
| -------------------- | ---------------------------------------- |
| Programming Overview | Project, Active revision, runtime status |
| Point Manager        | Local, Virtual, Modbus, BACnet Point     |
| Device Manager       | Modbus/BACnet device                     |
| Variable Manager     | Khai báo và quản lý Variable             |
| I/O Mapping          | Map Point với Variable                   |
| Program List         | Program, enable, cycle, status           |
| ST Editor            | Soạn thảo ST                             |
| FBD Editor           | Vẽ block diagram                         |
| Function Library     | Tìm và xem Function Block                |
| Validation           | Error, warning và vị trí lỗi             |
| Deployment           | Build, deploy, activate, rollback        |
| Online Monitor       | Variable, block state, timing            |
| Audit & Versions     | Revision và lịch sử thao tác             |

---

## 14. Giới hạn tối thiểu Rev A

| Hạng mục                    |           Yêu cầu |
| --------------------------- | ----------------: |
| Program trong một Project   |                16 |
| Program chạy đồng thời      |                16 |
| Tổng Variable               |             1.000 |
| External Point              |               500 |
| Field device                |                64 |
| Function block mỗi Program  |               100 |
| Revision lưu giữ            |                10 |
| Cycle nhỏ nhất được bảo đảm |            1 giây |
| Online refresh              |  Không quá 1 giây |
| Thời gian activate          |  Không quá 5 giây |
| Rollback                    | Không quá 10 giây |

Các giới hạn chỉ được tăng sau performance test trên SOM thật.

---

## 15. Bảo mật

* Source chỉ Engineer/Admin được xem.
* Viewer không sửa chương trình.
* Operator không deploy.
* Engineer được tạo revision và deploy.
* Admin mới được activate/rollback.
* Artifact có thể deploy mà không chứa source.
* Export Project phải có checksum.
* Ghi audit cho create, edit, validate, deploy, activate, stop, force và rollback.

---

## 16. Ngoài phạm vi Rev A

* Safety PLC certification.
* Motion và servo.
* EtherCAT motion.
* Chu kỳ dưới 1 giây.
* Online patch trực tiếp Program đang chạy.
* LD và SFC.
* Multi-controller distributed programming.
* User C/C++ library.
* Full IEC 61131-3 certification.

---

## 17. Acceptance cấp sản phẩm

Programming Rev A chỉ được nghiệm thu khi:

1. Tạo được Project và Program.
2. ST và FBD dùng chung Point Model.
3. Local, Virtual, Modbus RTU/TCP và BACnet Point map được vào Program.
4. Validate phát hiện lỗi type, mapping và output conflict.
5. Deploy không làm dừng revision Active.
6. Activate atomic.
7. Rollback hoạt động.
8. Program lỗi không làm dừng controller.
9. Safe-state hoạt động khi runtime lỗi.
10. Reboot khôi phục Active revision và RETAIN đúng.
11. Online Monitor phản ánh dữ liệu thật.
12. RBAC và audit hoạt động đầy đủ.

---

# II. PROMPT ĐỒNG BỘ TÀI LIỆU DOCS

```text
NHIỆM VỤ: CẬP NHẬT VÀ ĐỒNG BỘ TOÀN BỘ DOCS THEO
DDC24-PROGRAMMING-PRODUCT-SPEC-001

Mục tiêu:
Đưa Product Spec Programming đã được cung cấp thành nguồn yêu cầu sản phẩm
chính thức của DDC-24. Đây là công việc tài liệu, chưa được implement code.

BẮT BUỘC:

1. Đọc toàn bộ repository docs và source hiện tại để xác định:
   - Tài liệu nào đang mô tả Programming.
   - Nội dung nào trùng lặp.
   - Nội dung nào mâu thuẫn.
   - Nội dung nào là thiết kế cũ hoặc chỉ là proposal.
   - Nội dung nào mô tả code đã có nhưng chưa chạy production.

2. Tạo tài liệu chính:
   docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md

3. Cập nhật tối thiểu:
   - docs/01_product/PRODUCT.md
   - docs/02_requirements/REQUIREMENTS.md
   - docs/04_design/SOFTWARE.md
   - docs/04_design/INTERFACES.md
   - docs/05_verification/VERIFICATION.md
   - docs/07_records/TRACEABILITY.md
   - docs/00_governance/DECISIONS.md
   - CONTROL.md hoặc document index tương ứng

4. Phân biệt rõ bốn lớp:
   - Product Requirement: sản phẩm phải làm được gì.
   - System Requirement: FE, BE, FW-SOM, MCU phải đáp ứng gì.
   - Design: kiến trúc và interface dự kiến.
   - As-Built: source hiện tại thực sự đã làm được gì.

5. Không được:
   - Ghi Product Spec là đã implement.
   - Ghi ST/FBD runtime production là đang hoạt động.
   - Dùng host unit test làm bằng chứng end-to-end.
   - Tự tạo API, schema hoặc kiến trúc chưa được phê duyệt.
   - Lập implementation plan trong nhiệm vụ này.
   - Sửa source code.

6. Chuẩn hóa thuật ngữ:
   Project
   Program
   Program Revision
   Point
   Variable
   External Point
   I/O Mapping
   Function Block
   Deployment
   Activation
   Active Revision
   Last Known Good
   RETAIN
   Online Monitor

7. Làm rõ Program và Task:
   - Người dùng làm việc chủ yếu với Program.
   - Mỗi Program có Enable, Cycle Time và Execution Order.
   - Task/runtime scheduling là thiết kế nội bộ, chưa tự quyết định trong Product Spec.

8. Tạo traceability:
   PRODUCT CAPABILITY
       → PRODUCT REQUIREMENT
       → SYSTEM REQUIREMENT
       → DESIGN ITEM
       → VERIFICATION ITEM

9. Mỗi yêu cầu phải có:
   - Requirement ID.
   - Nội dung.
   - Mức bắt buộc.
   - Owner layer.
   - Verification method.
   - Trạng thái hiện tại.

10. Các quyết định chưa có authority phải đưa vào:
    PROGRAMMING_OPEN_DECISIONS.md

11. Đánh dấu rõ tài liệu:
    - ACTIVE
    - SUPERSEDED
    - RECORD_ONLY
    - DRAFT

12. Không xóa lịch sử quyết định.
    Tài liệu cũ bị thay thế phải ghi rõ tài liệu thay thế.

ĐẦU RA:

1. DDC24_PROGRAMMING_PRODUCT_SPEC.md
2. PROGRAMMING_DOCS_SYNC_REPORT.md
3. PROGRAMMING_TRACEABILITY_MATRIX.md
4. PROGRAMMING_OPEN_DECISIONS.md
5. Danh sách file đã sửa.
6. Danh sách mâu thuẫn đã xử lý.
7. Danh sách nội dung còn chưa đủ authority.

KẾT LUẬN BẮT BUỘC:

PRODUCT_SPEC_DOCUMENTED = YES/NO
DOCS_SYNCHRONIZED = YES/NO
DESIGN_READY_TO_START = YES/CONDITIONAL/NO

Chỉ được kết luận YES khi không còn tài liệu Active mâu thuẫn với Product Spec.
Không implement Programming trong nhiệm vụ này.
```

# III. CÁC PHẦN SRC CẦN SỬA TRƯỚC PROGRAMMING

Ngoài **Modbus RTU Point**, audit cho thấy cần xử lý:

| Nhóm            | Phần thiếu/lỗi                                                      |
| --------------- | ------------------------------------------------------------------- |
| Modbus RTU      | Chưa có quản lý Point end-to-end được chứng minh trên thiết bị thật |
| Modbus TCP      | Cần dùng chung External Point Model                                 |
| BACnet Point    | Cần xác minh import, mapping, quality và write end-to-end           |
| Point metadata  | Unit và `trendEnabled` còn có phần lưu localStorage                 |
| Point authority | Chưa có một source of truth thống nhất                              |
| Output config   | IO config và safe-state đang lưu bằng hai request                   |
| CI              | GCC 11 fail và Playwright login fail                                |
| Health          | Thiếu `/health` hoặc `/healthz` cho deployment                      |
| Network         | False 503, duplicate profile và autoconnect chưa ổn                 |
| Mock page       | User Parameters và Auxiliary Functions chưa có backend thật         |
| Deployment      | Binary chưa map chắc chắn tới Git commit                            |
| Packaging       | Installer chưa tái tạo đầy đủ service web đang chạy                 |
| MCU firmware    | STM32 target vẫn placeholder                                        |
| HIL             | Chưa có physical I/O, watchdog và safe timeout test                 |
| Historian       | Nhiều DB path và authority chưa thống nhất                          |
| Auth/Audit      | Token revoke và audit durability chưa hoàn chỉnh                    |

---

# IV. PROMPT FIX SRC NỀN TRƯỚC PROGRAMMING

```text
NHIỆM VỤ: ỔN ĐỊNH VÀ HOÀN THIỆN SRC NỀN DDC-24
TRƯỚC KHI IMPLEMENT PROGRAMMING

Mục tiêu:
Sửa các lỗi và hoàn thiện các chức năng nền hiện tại của FE, BE, FW-SOM
và MCU. Chưa implement tính năng Programming, ST/FBD editor, Program API,
Program deployment hoặc production StScheduler.

Nguồn bắt buộc:
- DDC24_FE_BE_FW_SOM_AS_BUILT_STATUS_AUDIT.md
- Product Spec hiện hành của DDC-24
- Source code tại HEAD
- CI logs
- Runtime target SOM
- Các tài liệu Interface và Verification đang Active

NGUYÊN TẮC:

1. Không dựa vào báo cáo cũ nếu source hoặc runtime chứng minh khác.
2. Không coi mock, fake MCU hoặc host unit test là production evidence.
3. Mỗi lỗi phải được reproduce trước khi sửa.
4. Mỗi sửa đổi phải có test chống regression.
5. Không mở scope Programming trong nhiệm vụ này.
6. Không sửa Product Spec để hợp thức hóa source thiếu.
7. Không bỏ test hoặc giảm tiêu chí để làm CI xanh.

PHẠM VI P0 — BẮT BUỘC:

A. Làm CI xanh
- Sửa lỗi GCC 11 dangling-else.
- Sửa Playwright locator Password bị match cả input và nút Show Password.
- Chạy lại toàn bộ C++, Go, FE, firmware, sanitizer và E2E.
- Không chấp nhận skip.

B. Hoàn thiện External Point Model
Tạo một Point Model thống nhất cho:
- Local I/O.
- Virtual Point.
- Modbus RTU.
- Modbus TCP.
- BACnet/IP.

Mỗi Point phải có:
point_id, tag_name, display_name, source, device_id, data_type, unit,
read_write, value, quality, timestamp, scale, offset, min, max,
poll_interval, timeout, retain, default_value và safe_value.

C. Hoàn thiện Modbus RTU Point end-to-end
- Device CRUD.
- Point CRUD.
- RS485 port selection.
- Baud, parity, stop bit, slave ID.
- Coil, Discrete Input, Input Register, Holding Register.
- UInt16, Int16, UInt32, Int32, Float32.
- Byte order và word order.
- Scale và offset.
- Poll scheduler.
- Read/write permission.
- Timeout, retry, reconnect.
- CRC error và communication diagnostics.
- Quality GOOD/STALE/OFFLINE/BAD.
- Persistence.
- REST API.
- FE Device Manager và Point Manager.
- Map Point vào core Point Table.
- WebSocket update.
- Integration test với Modbus slave simulator.
- Test trên RS485 thật trước khi VERIFIED.

D. Đồng bộ Modbus TCP
- Dùng chung Point Model và register codec với Modbus RTU.
- Không tạo hai implementation mapping khác nhau.
- Thêm IP, port, Unit ID và connection state.
- Test disconnect/reconnect.

E. Xác minh và hoàn thiện BACnet Point
- Device discovery.
- Object discovery/import.
- AI, AO, BI, BO, AV, BV và MSV.
- Read/write.
- COV hoặc polling.
- Quality và timestamp.
- Point mapping.
- Không ghi VERIFIED nếu chưa test trên BACnet device hoặc simulator độc lập.

F. Sửa Point Metadata Authority
- Không lưu unit, trendEnabled hoặc metadata thiết bị chỉ trong localStorage.
- BE/Core phải là source of truth.
- FE reload hoặc browser khác phải thấy cùng dữ liệu.
- Point ID không được đổi khi đổi display name hoặc tag name.
- Có uniqueness validation cho tag name.

G. Sửa Config Transaction
- Output configuration và safe-state phải lưu bằng một transaction atomic.
- Có revision hoặc ETag.
- Validate toàn bộ trước apply.
- Apply lỗi phải giữ cấu hình cũ.
- Không tồn tại trạng thái apply một nửa.

H. Hoàn thiện Health và Recovery
- Thêm endpoint health ổn định cho deployment.
- Health phải phản ánh web, core, iobus, SHM và MCU/IOP connection.
- Thêm watchdog phù hợp cho web/netcfg hoặc ghi quyết định rõ nếu không dùng.
- Test process crash và restart.

I. Sửa Network Findings
- False 503 do deadline.
- Duplicate NetworkManager profile.
- Autoconnect persistence.
- Test apply, confirm, rollback và reboot.

J. Hoàn thiện Deployment Provenance
- Mọi binary phải có:
  git_commit, build_time, toolchain, version, checksum và config revision.
- Tạo manifest trên target.
- Packaging phải cài được đầy đủ core, iobus, web, netcfg và service files.
- Một lệnh clean install phải tái tạo đúng deployment.

K. Xử lý Mock/Local-only Page
- User Parameters và Auxiliary Functions:
  hoặc nối backend/core thật,
  hoặc ẩn khỏi production navigation và ghi rõ DEMO.
- Không để giao diện tạo cảm giác đã lưu vào controller khi chỉ lưu local.

L. Hoàn thiện STM32 Firmware nền
- Clock và HAL init.
- UART IOP v2.
- Input sampling.
- Output command apply.
- ADC/DAC/relay path.
- Communication watchdog.
- 200 ms hardware safe timeout.
- Startup safe-state.
- CRC/frame validation.
- Fault reporting.
- Không dùng vòng lặp placeholder.

M. HIL và physical I/O
- Kết nối SOM với STM32 thật.
- Test DI, UI, AI, DO và AO.
- Test mất UART.
- Test frame lỗi.
- Test mất SOM.
- Test MCU reset.
- Test safe-state.
- Test reboot và power-cycle.
- Fake MCU chỉ giữ làm test tool.

PHẠM VI P1:

- Hợp nhất authority các legacy historian DB.
- Giải thích và test history gap.
- Durable token revocation.
- Durable/queryable audit log.
- Giảm core IPC connection churn và log noise.
- Accessibility issue của logout button.
- Đồng bộ alarm count trong dữ liệu demo.

CẤM TRONG NHIỆM VỤ NÀY:

- Không tạo Program Project API.
- Không tạo ST/FBD Editor.
- Không nối StScheduler vào production.
- Không tạo Program Artifact Registry.
- Không tạo Program Deploy/Activate.
- Không thay đổi scope Product Spec Programming.
- Không tuyên bố Programming Ready.

QUY TRÌNH:

1. Lập bảng issue từ audit và source.
2. Reproduce từng lỗi.
3. Phân loại P0/P1.
4. Sửa từng nhóm nhỏ.
5. Thêm unit/integration/E2E/HIL test.
6. Chạy clean build.
7. Deploy lên target.
8. Kiểm chứng runtime.
9. Cập nhật As-Built và Verification.
10. Báo cáo phần còn BLOCKED.

ĐẦU RA:

1. DDC24_BASELINE_SRC_REMEDIATION_PLAN.md
2. DDC24_BASELINE_SRC_FIX_REPORT.md
3. EXTERNAL_POINT_MODEL_SPEC.md
4. MODBUS_RTU_POINT_AS_BUILT_REPORT.md
5. PHYSICAL_IO_HIL_REPORT.md
6. DEPLOYMENT_PROVENANCE_REPORT.md
7. Test evidence và CI link.
8. Danh sách commit đã thực hiện.

KẾT LUẬN BẮT BUỘC:

CI_BASELINE_GREEN = YES/NO
EXTERNAL_POINT_MODEL_READY = YES/NO
MODBUS_RTU_POINT_READY = YES/NO
PHYSICAL_IO_BASELINE_READY = YES/NO
CONFIG_BASELINE_READY = YES/NO
DEPLOYMENT_BASELINE_READY = YES/NO
READY_FOR_PROGRAMMING_DESIGN = YES/CONDITIONAL/NO

Chỉ được kết luận READY_FOR_PROGRAMMING_DESIGN = YES khi:
- Product Spec và docs đã đồng bộ.
- CI xanh.
- Point Model có một authority.
- Modbus RTU Point chạy end-to-end.
- Config apply atomic.
- Physical I/O và safe-state có HIL evidence.
- Deployment truy được về đúng source commit.

Sau đó mới được bắt đầu Technical Design và Implementation Plan cho Programming.
```
