# Báo cáo review đồng bộ HW/FW/SOM/HMI — MK-DDC-24

**Document ID:** KX-DDC24-REV-HW-FW-SOM-HMI-20260722
**Ngày:** 2026-07-22
**Trạng thái:** Review complete; corrective documentation/config applied; release gates open
**Quyết định:** **HW manufacturing NO-GO; MCU FW NO-GO; HMI production NO-GO**

## 1. Kết luận điều hành

Kiến trúc sản phẩm đã được đưa về một baseline nhất quán:

- Base SKU: **16 UI + 4 AO + 4 DO**; true isolated DI chỉ là optional capability.
- SOM: Radxa CM3/RK3566 chạy core/iobus/web và optional `mkddc-hmi`.
- MCU: STM32G0B1 là I/O owner; STM32 là SPI master duy nhất của 2× ADS131M08.
- SOM–MCU: Kinexus-IOP v2, 921600 baud, poll 2 ms, 3 ms response timeout,
  20 ms fault threshold và 200 ms MCU safe timeout.
- HMI: KD024QVFIA073-02-C021B/JD9852 qua MIPI DSI một lane, FT5436 qua I2C,
  DRM/KMS `/dev/dri/card0`; ILI9341/SPI/fbdev bị loại khỏi baseline.

Tuy nhiên, repository chưa có KiCad schematic/PCB, BOM sản xuất, power/EMC/thermal
evidence hoặc firmware STM32 thực. Vì vậy tài liệu hiện tại là **controlled target
design**, không phải bằng chứng thiết bị đã an toàn, đạt IEC hoặc sẵn sàng sản xuất.

HMI 2.4 inch được chốt theo ADR-016 là **local limited-operator HMI**: monitoring,
alarm ACK và setpoint/mode/override/release cho point được authority whitelist.
Nó không phải full Web HMI/SCADA hoặc engineering station. So với Siemens, Rockwell và
Honeywell, khoảng trống cạnh tranh chính không nằm ở hiệu ứng đồ họa mà ở alarm
authority/historian, identity/RBAC, audit trail, telemetry thật, usability validation,
library/style governance và lifecycle engineering.

## 2. Phạm vi và authority đã đối chiếu

Review bao phủ toàn bộ 23 design files dưới `docs/04_design/hardware`, HW spec,
FW/SOM source, shared ABI/protocol, HMI requirements/UC/UX/design/implementation và
`services/hmi`.

Thứ tự authority sử dụng:

1. `shared/iop_protocol.h`, `shared/mkddc_shm.h` và tested SOM consumers;
2. architecture decisions và controlled requirements;
3. detailed design;
4. implementation guides và historical review records.

`fw/Core/Src/main.c` và `fw/mkddc-fw.ioc` được kiểm tra trực tiếp. Chúng hiện là
placeholder, do đó không được dùng tài liệu để suy diễn firmware đã tồn tại.

## 3. Findings HW/FW/SOM

| ID | Mức | Finding | Trạng thái / hành động bắt buộc |
|---|---|---|---|
| HW-DOC-001/002/003/005 | Blocker/High | 5 V, 3.3 V, surge và 15 V chưa khóa | Giữ `BLOCKED_HW`; chọn linh kiện, tính stress/Tj/margin và đo prototype |
| HW-DOC-010/011 | High | DO contact protection và inductive suppression chưa release | Chốt theo AC/DC load class, schematic/BOM và switching/EMC test |
| HW-DOC-012 | High | AO current compliance chưa có margin/evidence | Release target chỉ 0–500 Ω; sweep low rail/high temp/full load |
| HW-DOC-014 | High | Chưa có port-by-port EMC evidence | Hoàn tất pre-compliance và recovery/safe-state record |
| HW-DOC-017/024/025 | High | Không có KiCad/manufacturing BOM/alternates | Không phát Gerber/CPL/stencil hoặc production claim |
| HW-DOC-048 | High | HMI trước đây không nằm trong carrier/power baseline | Đã thêm design boundary; vẫn cần schematic, DT, power, FPC, ESD và target test |
| HW-DOC-049 | Blocker | STM32 firmware + CubeMX là placeholder | Implement IOP/ADC/AO/DO/watchdog/safe timeout và HIL |
| HW-DOC-050 | High | Relay/driver chưa chứng minh worst-case compatibility | Chốt một MPN/driver; kiểm VOH/VIH/drop/pick-up/release/thermal; bỏ “10k pull-up fixes logic” |

### 3.1 Mâu thuẫn đã sửa

- Loại ILI9341/SPI0 khỏi SOM mapping; thêm JD9852 MIPI DSI + FT5436 I2C.
- Sửa ranh giới Ethernet: CM3 có PHY onboard; carrier nối MDI tới magnetics/RJ-45
  theo reference design, không mô tả RGMII trực tiếp tới magnetics.
- Thêm HMI panel/backlight/touch vào power budget và mở lại tổng 5 V.
- Thêm HMI connector/routing/ESD/DT gates vào carrier design.
- Gắn nhãn STM32 task/pinout/FreeRTOS/IOP là target design vì source chưa triển khai.
- Đồng bộ cross-reference hardware sang cây `docs/04_design/hardware` hiện hành.

### 3.2 Contract đã khớp source SOM

| Contract | Baseline |
|---|---|
| IOP | v2.0; 921600; GET_IO 2 ms; response 3 ms; retry 3; fault 20 ms |
| IO response | payload 74 B; frame 80 B; 16× signed raw `int32` |
| Capability Rev A | `0x000D` = UI16 + AO4 + DO4 |
| SHM | v4 magic `0x4B584404`; UI16; optional DI8 reserved; AO4; DO4 |
| AO boundary | V/mA physical at core/iobus; convert to DAC raw exactly once |
| HMI data | read-only seqlock from IO/PLC SHM; 1 s display refresh target |

## 4. Review UC/UX/UI HMI

### 4.1 Application fit — decision addendum ADR-016

Owner đã chọn năm surface **Home / Points / Control / Alarms / Service**. Communication
và System được gộp vào Home/Service, không xoá diagnostics. Control chỉ hiển thị point
được authoritative policy whitelist. Với 320×240, engineering graph, schedule editor,
alarm configuration, calibration và user administration không thuộc HMI local.

Home phải trả lời trong khoảng 30 giây: controller có control được không, alarm quan
trọng nhất là gì, dữ liệu có stale không, I/O/communication nào cần xử lý. Normal dùng
visual trung tính; màu bão hòa dành cho abnormal/attention hoặc energized state thật.

### 4.2 Source-aligned gaps

| ID | Mức | Gap trong `services/hmi` | Required closure |
|---|---|---|---|
| HMI-AUTH-001 | P0 | ACK chỉ đổi local volatile ring; không gửi upstream, không historian/audit | Alarm command/result contract, durable state, identity/time/result audit |
| HMI-RBAC-001 | P0 | Quyền dựa vào PIN/service switch/local role string; không unlock expiry | Authoritative identity/RBAC, fail-closed unknown role, timeout và audit |
| HMI-CTRL-001 | P0 | Chưa có Control surface, point policy projection hoặc setpoint/mode/override/release authority path | Implement HOP-001..027 then HOP-030..046; broker/core loss must degrade read-only |
| HMI-PRIV-001 | P0 | HMI còn direct signal/reboot và `CAP_SYS_BOOT` trong packaging | Remove via HOP-060..063 before production enablement |
| HMI-IA-001 | P1 | Source còn six-screen tab navigation và action target 22–29 px | Refactor five surfaces, body ≥14 px, action ≥40×40 px or hard-key equivalent |
| HMI-TEL-001 | P1 | BACnet/Modbus/system fields thiếu contract; default có thể trông như dữ liệu thật | Telemetry schema + explicit unknown/unavailable/stale |
| HMI-FUNC-001 | P1 | Backup/restore buttons hiện hữu nhưng callbacks trả false | Ẩn/disable với reason hoặc implement integrity/rollback tests |
| HMI-HW-001 | P0 | Chưa có schematic/DT/panel integration evidence | Freeze pin/power/driver and run DRM/touch/button/backlight tests |
| HMI-UX-001 | P1 | Chưa có operator scenario/usability record | Test glove/light/alarm flood/stale/loss/recovery/localization |
| HMI-DATA-001 | P1 | Example DB từng dùng UI8+DI8 | **Đã sửa** thành UI16 + AO4 + DO4; cần regression/capability test |

### 4.3 Alarm và thao tác vận hành

- ACK không phải clear và chỉ được hiển thị `ACKED` sau authoritative response.
- Alarm cần priority, state, time, source, response text và diagnostic route; ring RAM
  mười dòng không thay alarm/event historian.
- Alarm flood phải giữ priority cao nhất nhìn thấy và cho sort/filter có thể dự đoán.
- Reboot/restart/reload cần impact summary, role, hold-to-confirm khi phù hợp và audit.
- HMI không được báo `OK` khi telemetry chưa tồn tại; dùng `UNKNOWN`, `STALE`,
  `UNAVAILABLE`, `DISABLED` với text/symbol ngoài màu.

## 5. Chuẩn và benchmark thị trường

Đây là design guidance, không phải chứng nhận:

- [IEC 60073:2002](https://webstore.iec.ch/en/publication/587) quy định nguyên tắc
  coding cho indicators/actuators; vì vậy màu không được là dấu hiệu duy nhất.
- [IEC 62682:2022](https://webstore.iec.ch/en/publication/65543) bao phủ alarm lifecycle,
  operator presentation, event log/historian và performance management.
- [IEC 62443-3-3](https://webstore.iec.ch/en/publication/7033) là nền cho identity,
  use control và system security; project chưa có conformance evidence.
- [ISO 9241-210:2019](https://www.iso.org/standard/77520.html) yêu cầu human-centred
  activities suốt lifecycle; peer review tài liệu không thay operator validation.
- [ISA-101 series](https://www.isa.org/standards-and-publications/isa-standards/isa-101-standards)
  cung cấp lifecycle/style/navigation/usability guidance cho HMI process automation.

Benchmark chính thức:

| Vendor | Capability đáng học | MK-DDC-24 gap/positioning |
|---|---|---|
| [Siemens WinCC Unified](https://www.siemens.com/en-us/products/simatic-hmi/wincc-unified/) | standardized interfaces/libraries, roles/access, alarms/events, archives, audit, multi-platform scaling | Local panel nên dùng component/state model nhất quán với Web; cần audit/history và library governance |
| [Rockwell FactoryTalk Optix](https://www.rockwellautomation.com/en-us/products/software/factorytalk/optix.html) | alarm widgets, roles/auth, versioning, responsive deployment | Cần alarm manager semantics, RBAC và change/audit trail; tránh local-only ACK |
| [Rockwell audit/event logger](https://www.rockwellautomation.com/en-us/docs/factorytalk-optix/1-03/contents-ditamap/using-the-software/logger/event-logger.html) | audit user writes, methods, login/logout và alarm ACK/confirm | MK-DDC-24 chưa có authoritative HMI audit contract |
| [Honeywell Experion HMI](https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pas/experion-pks/operations/operator-stations/pmt-hps-pin-experion-hmi.pdf) | alarm-flood handling, suppression visibility, context for upset diagnosis | Màn local chỉ nên triage; alarm lifecycle/flood analytics nằm ở Web/SCADA authority |

Không nên sao chép toàn bộ feature của các platform lớn lên TFT 2.4 inch. Lợi thế cạnh
tranh khả thi là boot nhanh, trạng thái local độc lập mạng, I/O diagnostics rõ,
fail-safe service actions và cùng một semantic model giữa panel/Web/BACnet.

## 6. Tệp đã cập nhật

- Controlled requirements/specs: SRS, SW requirements, HW spec, requirements,
  verification, traceability và decisions.
- HW design: hardware/firmware baseline, SOM, carrier block/schematic notes, power,
  MCU, DO relay/driver và closure register.
- HMI: UC, UX, design system, service design, implementation guide và packaged point DB.

Không sửa control/core/iobus/frontend logic ngoài packaged HMI example config.

## 7. Release plan đề nghị

1. **Freeze schematic:** chọn converter, relay/driver, HMI pin/rail/FPC; tạo KiCad và
   chạy ERC/DRC/SI/power/thermal reviews.
2. **Implement MCU FW:** CubeMX + drivers + IOP + safety; unit then HIL fault injection.
3. **Implement ADR-016 HMI:** thực hiện microtask HOP-000..077 theo contract → broker →
   core TTL/release → HMI model/UI → privilege removal; first slice là login → one
   whitelisted setpoint → core result → audit → authoritative render.
4. **Target integration:** DT overlay, DRM mode/rotation, FT5436, six buttons,
   backlight, systemd permissions and cold/recovery tests.
5. **Operator validation:** controlled scenarios and alarm-flood/usability evidence.
6. **Release evidence:** signed requirements trace, artifact hashes, target/toolchain,
   EMC/thermal/manufacturing packages. Chỉ sau đó mới xem xét đổi NO-GO thành GO.

## 7.1 Kế hoạch source được phê duyệt sau review

- Authority plan: [08 HMI implementation guide](../../03_implementation/08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md).
- Phạm vi: 54 microtask `HOP-000..077`; không bao gồm Web UI/frontend.
- Không đổi SHM ABI trong plan; telemetry vẫn read-only SHM.
- `mkddc-web` chỉ cung cấp local Unix auth/audit broker, không cung cấp browser surface
  cho HMI local.
- HMI production gate vẫn RED cho đến khi alarm authority, control path, session/RBAC,
  privilege removal và target usability có evidence.

## 8. Verification record

| Check | Kết quả |
|---|---|
| `python3 hardware-design/hw_design_review/check_hw_doc_closure.py` | 18/18 PASS |
| HMI Debug configure/build, `MKDDC_ENABLE_HMI=ON` | PASS |
| Direct `hmi_tests` | 23/23 PASS |
| Packaged point DB JSON + UI16/DI0/AO4/DO4 assertion | PASS |
| ADR-016 changed-document Markdown links | 337 checked across 38 files, 0 broken |
| HOP headings | 54 unique microtasks |
| Active HMI scope conflict scan | PASS; legacy six-screen block is explicitly historical |
| `git diff --check` | PASS |

Aggregate temporary CTest discovered 25 entries but two core/iobus targets were not
built in that HMI-only build; 23 HMI tests passed. Báo cáo chỉ claim direct HMI suite,
không claim full-repository CTest. Host tests hoặc documentation harness không phải
HIL, EMC, safety, IEC conformity hoặc manufacturing release evidence.
