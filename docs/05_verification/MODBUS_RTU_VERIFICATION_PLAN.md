# Modbus RTU — Verification Plan DDC-24 Rev A

**ID:** VVP-MBRTU-001
**Phiên bản:** 0.2
**Trạng thái:** Active (Phê duyệt 2026-08-05 theo Tờ trình `DDC24-MBRTU-REQ-APPROVE-2026-08-05`)
**Ngày:** 2026-08-05
**Chủ quản đề xuất:** QA/Verification Lead
**Quyết định đã ký áp dụng:** Đ-01 (1 bus), Đ-04 (3 vai trò), Đ-07 (≥256 Point), Đ-08 (cấp thiết bị thật)
**Đối chiếu source tại:** `feat/modbus-rtu-track-a` / `eade4e5`
**Trace:** `VR-MBRTU-001..014` trong [VERIFICATION.md](VERIFICATION.md)
**Design nguồn:** [DDD-SW-MBRTU-POINT-001](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md),
[DDD-DM-MBRTU-001](../02_design/software/MODBUS_RTU_DATA_MODEL.md),
[DDD-BE-MBRTU-001](../02_design/software/MODBUS_RTU_BE_DESIGN.md),
[DDD-FW-MBRTU-001](../02_design/software/MODBUS_RTU_FW_SOM_DESIGN.md)

> Tài liệu này định nghĩa **test specification**. Nó không tuyên bố test đã pass.
> Mọi ô `Trạng thái` là gate hiện tại, cập nhật bằng evidence có review.

## 1. Phân tầng test

| Tầng | Mã | Môi trường | Chứng minh được gì | **Không** chứng minh được gì |
|---|---|---|---|---|
| Unit | `TC-MBRTU-U-xx` | host, không I/O thật | logic thuần: codec, validator, state machine, scheduler | phần cứng, timing thật, tích hợp |
| Integration | `TC-MBRTU-I-xx` | host, nhiều process/module thật | hợp đồng giữa module, transaction, RBAC, IPC | dây RS-485, timing target |
| Simulator | `TC-MBRTU-S-xx` | host + PTY/Modbus simulator | giao thức đầu-cuối, fault injection lặp lại được | transceiver, nhiễu, termination, half-duplex thật |
| Target SOM | `TC-MBRTU-T-xx` | **Foxlinx SOM-DDC-24** là board nghiệm thu; Orange Pi 5B chỉ regression nhanh. ⚠️ Foxlinx **đang chạy fake MCU**, không phải STM32 thật — mọi phép đo jitter IOP phải ghi rõ điều này | deploy, systemd, tài nguyên, khởi động lại, đúng kiến trúc aarch64 | slave RS-485 thật; hành vi với MCU thật |
| Physical RS485 | `TC-MBRTU-H-xx` | target + transceiver + slave thật | dây, CRC vật lý, timing, wiring fault | môi trường lắp đặt cuối |
| Production acceptance | `TC-MBRTU-P-xx` | release candidate + hồ sơ | sẵn sàng phát hành | — |

**Quy tắc bất di dịch:** simulator và host pass **không** đóng gate phần cứng.
Không được dùng `TC-MBRTU-U/I/S` để chuyển `VR-MBRTU-001/004/011/012` sang PASS.

## 2. Unit test

| ID | Mục tiêu | Pass criteria | Trace |
|---|---|---|---|
| TC-MBRTU-U-01 | Codec đọc: mọi `(data_type × byte_order × word_order)` | khớp golden vector, gồm giá trị âm, 0, biên, và `uint32 > 2^24` không mất chính xác | `SWR-REQ-MBRTU-003` |
| TC-MBRTU-U-02 | Codec ghi: quy đổi ngược | round-trip đúng; làm tròn nearest-ties-away; sai số > 0,5 LSB ⇒ reject | `SWR-REQ-MBRTU-003` |
| TC-MBRTU-U-03 | Codec âm tính | NaN, ±Inf, `scale=0`, count sai, addr > 65535, type/FC không hợp lệ đều bị từ chối có mã | `SWR-REQ-MBRTU-003` |
| TC-MBRTU-U-04 | `bit_index` | trích đúng bit 0..15; `bit_index` với kiểu không phải bool ⇒ reject | `SWR-REQ-MBRTU-003` |
| TC-MBRTU-U-05 | Scale/offset | `engineering = raw×scale+offset` và ngược lại; ngoài `min/max` ⇒ `OUT_OF_RANGE` | `SWR-REQ-MBRTU-003` |
| TC-MBRTU-U-06 | Validator cấu trúc | mỗi mã lỗi ở BE design §4.2 có ≥1 case dương và ≥1 case âm | `SWR-REQ-MBRTU-002` |
| TC-MBRTU-U-07 | Duplicate slave ID | trùng trong cùng bus ⇒ `SLAVE_ID_DUPLICATE`; trùng khác bus ⇒ hợp lệ | `SWR-REQ-MBRTU-002` |
| TC-MBRTU-U-08 | Invalid register / overlap | 5 trường hợp bảng data model §5.5 | `SWR-REQ-MBRTU-003` |
| TC-MBRTU-U-09 | Tag namespace | trùng với Local I/O, Virtual Point và trong nội bộ Modbus ⇒ `TAG_DUPLICATE` | `SWR-REQ-MBRTU-001` |
| TC-MBRTU-U-10 | Capacity | > 16 device/bus và vượt giới hạn Point hiện hành ⇒ `CAPACITY_EXCEEDED`, không truncate. **Giới hạn mục tiêu ≥256 Point (Đ-07); As-Built còn 64** — test phải đọc hằng số, không hardcode | `NFR-REQ-MBRTU-001` |
| TC-MBRTU-U-11 | Admission tải bus | > 70 % ⇒ reject; 50–70 % ⇒ warning; txn + retry không vừa `poll_ms` ⇒ reject | `SWR-REQ-MBRTU-004` |
| TC-MBRTU-U-12 | Scheduler EDF | không đói device khi 1 device timeout liên tục; deadline mới tính từ `now` | `SWR-REQ-MBRTU-004` |
| TC-MBRTU-U-13 | Retry/offline probe | hết retry ⇒ nhường bus ngay; OFFLINE ⇒ nhịp `offline_probe_ms` | `SWR-REQ-MBRTU-004` |
| TC-MBRTU-U-14 | Quality state machine | fake clock chạy đủ 6 chuyển trạng thái ở FW design §6.1 | `SWR-REQ-MBRTU-005` |
| TC-MBRTU-U-15 | Timestamp | không đổi khi chỉ quality xấu đi; `null` khi chưa có mẫu | `SWR-REQ-MBRTU-005` |
| TC-MBRTU-U-16 | Canonical JSON/checksum | hai lần serialize cùng input ⇒ cùng checksum; đổi 1 field ⇒ đổi checksum | `SWR-REQ-MBRTU-007` |
| TC-MBRTU-U-17 | CSV round-trip | export → import → export cho file giống hệt; ô rỗng ⇒ `null` | `SWR-REQ-MBRTU-008` |
| TC-MBRTU-U-18 | Point ID bất biến | payload cố đổi `point_id`/`device_id` ⇒ `ID_IMMUTABLE` | `SWR-REQ-MBRTU-001` |
| TC-MBRTU-U-19 | FE `RegisterPreview` | footprint và overlap khớp kết quả validator server | `SWR-REQ-MBRTU-008` |
| TC-MBRTU-U-20 | FE `QualityBadge` | thiếu `quality` ⇒ render `—`, không mặc định `BAD`/`GOOD` | `IF-REQ-MBRTU-003` |

## 3. Integration test (host)

| ID | Mục tiêu | Pass criteria | Trace |
|---|---|---|---|
| TC-MBRTU-I-01 | Device CRUD | tạo/sửa/xoá vào candidate; xoá device còn point ⇒ chặn có lý do | `SWR-REQ-MBRTU-008` |
| TC-MBRTU-I-02 | Point CRUD | như trên; rename tag không đổi `point_id` | `SWR-REQ-MBRTU-001` |
| TC-MBRTU-I-03 | Enable/disable | device disabled không vào lịch poll; có audit | `SWR-REQ-MBRTU-008` |
| TC-MBRTU-I-04 | Import/export | 1 dòng lỗi ⇒ 0 dòng được nạp; import chỉ vào candidate | `SWR-REQ-MBRTU-008` |
| TC-MBRTU-I-05 | Apply — ACK | ACK khớp checksum ⇒ commit, revision +1, LKG cập nhật | `SWR-REQ-MBRTU-007` |
| TC-MBRTU-I-06 | Apply — REJECT | giữ active cũ, không đổi file active, candidate đánh `failed` | `SWR-REQ-MBRTU-007` |
| TC-MBRTU-I-07 | Apply — TIMEOUT | `apply_state=unknown`; không tăng revision; reconcile bằng `GetStatus` | `SWR-REQ-MBRTU-007` |
| TC-MBRTU-I-08 | Config rollback | rollback về LKG thành công; rollback tới revision khác LKG ⇒ reject | `SWR-REQ-MBRTU-007` |
| TC-MBRTU-I-09 | Crash points | kill giữa `begin`/`stage`/`ACK`/`commit`; sau restart chỉ có N hoặc N+1, không lai | `SWR-REQ-MBRTU-007` |
| TC-MBRTU-I-10 | Idempotency | cùng `operation_id` không apply hai lần; khác payload ⇒ `ID_CONFLICT` | `IF-REQ-MBRTU-002` |
| TC-MBRTU-I-11 | Optimistic concurrency | `base_revision` cũ ⇒ 409, không ghi file | `SWR-REQ-MBRTU-007` |
| TC-MBRTU-I-12 | RBAC | ma trận BE design §7.1 đầy đủ positive/negative cho **3 vai trò** (Đ-04: viewer/operator/admin) | `SEC-REQ-MBRTU-001` |
| TC-MBRTU-I-13 | Read/write permission | Viewer không read-test; Operator không write-test; Admin được cả hai | `SEC-REQ-MBRTU-001` |
| TC-MBRTU-I-14 | Audit | mỗi mutation/write có actor, target, old/new, correlation, result | `SEC-REQ-MBRTU-001` |
| TC-MBRTU-I-15 | Write path — reject | read-only, quality ≠ GOOD, ngoài `min/max`, revision cũ, queue đầy đều bị từ chối đúng mã | `SWR-REQ-MBRTU-006` |
| TC-MBRTU-I-16 | Write path — no replay | restart iobus/core/web sau write ⇒ không byte nào được phát lại | `SWR-REQ-MBRTU-006` |
| TC-MBRTU-I-17 | Không tự ghi safe/default | mất liên lạc rồi phục hồi ⇒ không có write tự phát | `SWR-REQ-MBRTU-006` |
| TC-MBRTU-I-18 | ABI snapshot v2 | layout/magic/version/size static assertion; fixture cross-language C++ ↔ Go ↔ TS | `IF-REQ-MBRTU-001` |
| TC-MBRTU-I-19 | Sequence/generation | drop và reorder datagram bị phát hiện và đếm | `IF-REQ-MBRTU-002` |
| TC-MBRTU-I-20 | Point Catalog | REST/WS trả đúng canonical model, `source=modbus_rtu`, revision khớp | `IF-REQ-MBRTU-003` |
| TC-MBRTU-I-21 | WebSocket update | thay đổi giá trị ⇒ event trong ≤1 chu kỳ; reconnect lấy snapshot trước delta | `IF-REQ-MBRTU-003` |
| TC-MBRTU-I-22 | Diagnostics | thiếu telemetry ⇒ `null/unknown`, không `0`; ghép đúng `(bus, slave)` | `SWR-REQ-MBRTU-009` |
| TC-MBRTU-I-23 | FE validation | mọi lỗi server có `path` map đúng field; lỗi không map ⇒ hiện ở banner | `IF-REQ-MBRTU-003` |
| TC-MBRTU-I-24 | FE mapping gate | còn lỗi ⇒ không lưu được candidate | `SWR-REQ-MBRTU-008` |
| TC-MBRTU-I-25 | Zero-based address | API/persistence luôn zero-based; UI reference không đổi giá trị lưu | `IF-REQ-MBRTU-004` |

## 4. Simulator test

Simulator là **Modbus slave độc lập** (PTY hoặc TCP-to-RTU bridge) hỗ trợ
FC01/02/03/04/05/06/16, exception response và fault injection.

| ID | Mục tiêu | Pass criteria | Trace |
|---|---|---|---|
| TC-MBRTU-S-01 | Đọc bốn register type | giá trị đúng cho mọi data type | `SWR-REQ-MBRTU-003` |
| TC-MBRTU-S-02 | Ghi Coil/Holding 16 và 32-bit | FC05/06/16 đúng, readback khớp | `SWR-REQ-MBRTU-006` |
| TC-MBRTU-S-03 | Timeout | không phản hồi ⇒ retry đúng số lần rồi STALE → OFFLINE đúng ngưỡng | `SWR-REQ-MBRTU-005` |
| TC-MBRTU-S-04 | CRC error | frame CRC hỏng ⇒ `crc_errors` tăng, quality không thành GOOD | `SWR-REQ-MBRTU-009` |
| TC-MBRTU-S-05 | Exception response | 01/02/03/04/06 ⇒ `DEVICE_EXCEPTION` kèm mã, **không** là sample GOOD | `SWR-REQ-MBRTU-005` |
| TC-MBRTU-S-06 | Offline/reconnect | slave tắt rồi bật ⇒ OFFLINE → ONLINE, `reconnect_count` tăng, không replay write | `SWR-REQ-MBRTU-006` |
| TC-MBRTU-S-07 | Sai baud/parity | khung rác ⇒ CRC/timeout, không sinh giá trị sai kiểu GOOD | `SWR-REQ-MBRTU-005` |
| TC-MBRTU-S-08 | Sai slave ID | không phản hồi ⇒ OFFLINE có reason đúng | `SWR-REQ-MBRTU-005` |
| TC-MBRTU-S-09 | Nhiều slave | 16 slave mô phỏng, không starvation, đo poll duration | `SWR-REQ-MBRTU-004` |
| TC-MBRTU-S-10 | Hai bus mô phỏng | ✅ **KÍCH HOẠT**: Mô phỏng 2 bus RS485 song song (`/dev/rs485-1` và `/dev/rs485-2`), kiểm thử 2 BusWorker độc lập không starvation | `SYS-REQ-MBRTU-001` |
| TC-MBRTU-S-11 | Commissioning | test-connection/read/write trả kết quả thật của simulator | `PR-MBRTU-003`, `PR-MBRTU-005` |
| TC-MBRTU-S-12 | Stress | 16 device × giới hạn Point hiện hành ở poll nhỏ nhất được duyệt, 1 h, không crash, không rò bộ nhớ. Sau Đ-07 phải chạy lại ở 256 Point và **đo kích thước datagram + thời gian copy snapshot** | `NFR-REQ-MBRTU-001` |

Simulator **phải được ghi nhãn rõ ràng là không phải production evidence** trong
mọi report. Không dùng kết quả simulator để tuyên bố hỗ trợ thiết bị thật.

## 5. Target SOM test

| ID | Mục tiêu | Pass criteria | Trace |
|---|---|---|---|
| TC-MBRTU-T-01 | Deploy | binary/config trên target truy được commit/toolchain/checksum | `NFR-REQ-MBRTU-003` |
| TC-MBRTU-T-02 | Bus capability | Bus resolve từ manifest và link cứng (`/dev/rs485-1` → `ttyS5`, `/dev/rs485-2` → `ttyS1`). Case âm bắt buộc: cấu hình trỏ cổng không tồn tại (ví dụ `/dev/ttyS3` trên Foxlinx) phải bị từ chối ở tầng cấu hình | `SYS-REQ-MBRTU-001` |
| TC-MBRTU-T-03 | Service restart | `systemctl restart mkddc-iobus` ⇒ phục hồi, không write phát lại | `SWR-REQ-MBRTU-006` |
| TC-MBRTU-T-04 | Reboot | sau reboot, cấu hình đúng revision, service tự start, quality khởi tạo đúng | `NFR-REQ-MBRTU-002` |
| TC-MBRTU-T-05 | Cách ly lỗi | kill iobus ⇒ core/web tiếp tục; kill web ⇒ poll tiếp tục | `PR-MBRTU-011` |
| TC-MBRTU-T-06 | Tài nguyên | CPU/RAM của fieldbus trong ngân sách đề xuất; đo bằng `systemd-cgtop`/`ps` | `NFR-REQ-MBRTU-004` |
| TC-MBRTU-T-07 | Không chặn IOP | jitter IOP 2 ms không xấu đi khi Modbus tải nặng | `SWR-REQ-MBRTU-004` |
| TC-MBRTU-T-08 | Config rollback trên target | crash/power-cut giữa apply ⇒ chỉ N hoặc N+1 | `SWR-REQ-MBRTU-007` |
| TC-MBRTU-T-09 | Provenance mismatch | binary/ABI lệch version ⇒ fail rõ, không chạy tiếp âm thầm | `NFR-REQ-MBRTU-003` |

## 6. Physical RS485 test (HIL)

Kế thừa `MBRTU-HIL-01..12` từ [DDD-SW-MBRTU-POINT-001 §16.2](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md)
và bổ sung ba kịch bản mới do đề bài yêu cầu:

| ID | Kịch bản | Acceptance |
|---|---|---|
| TC-MBRTU-H-01..12 | = `MBRTU-HIL-01..12` | theo bảng gốc, không thay đổi |
| TC-MBRTU-H-13 | Test connection / read test / write test trên slave thật | kết quả khớp phép đo độc lập (đồng hồ/analyzer); write có readback đúng |
| TC-MBRTU-H-14 | Import/export trên target với slave thật | round-trip giữ nguyên hành vi đọc/ghi sau khi import |
| TC-MBRTU-H-15 | Termination/bias và độ dài dây | test ở cấu hình dây ngắn và dây dài nhất công bố, có/không termination; ghi lại tỷ lệ CRC error |
| **TC-MBRTU-H-16** | **Điều khiển hướng RS-485 half-duplex** | xác minh transceiver đổi hướng đúng: không mất byte đầu của response, không collision khi master vừa phát xong. Bắt buộc vì source **không gọi** `modbus_rtu_set_serial_mode()` và device tree không có `rs485-*` — giả định auto-direction **chưa được kiểm chứng** (Đ-02/`G-D`, F-IF-10) |

`TC-MBRTU-H-06` (hai bus đồng thời) ⏸ **HOÃN** theo Đ-01, cùng lý do với
`TC-MBRTU-S-10`.

Thiết bị nghiệm thu đã được duyệt cấp theo Đ-08 (tối thiểu một đồng hồ điện và một
biến tần Modbus RTU); `OD-MBRTU-EXT-02` CLOSED. Gate `G-C` chỉ còn chờ thiết bị về.

Mỗi record HIL phải ghi: hardware revision, sơ đồ đấu dây, termination/bias, model
và firmware của slave, binary identity, config revision/checksum, thiết bị đo,
kích thích, raw log, acceptance limit, kết quả, người thực hiện, người review và
SHA-256 của artifact.

## 7. Production acceptance test

| ID | Mục tiêu | Acceptance |
|---|---|---|
| TC-MBRTU-P-01 | Toàn bộ `VR-MBRTU-001..014` có evidence được review | không mục nào RED, không waiver không ký |
| TC-MBRTU-P-02 | Soak 24 h ở tải được duyệt trên bus thật (Rev A: 1 bus) | 0 crash, 0 đổi identity Point, 0 write không kiểm soát, thống kê poll kèm raw log |
| TC-MBRTU-P-03 | Reboot × 10 và cắt nguồn × 10 | cấu hình và Point identity giữ nguyên; không cấu hình lai |
| TC-MBRTU-P-04 | Security review | không có endpoint arbitrary FC; RBAC/audit đầy đủ; không secret trong export |
| TC-MBRTU-P-05 | Provenance release | version/commit/build time/checksum/toolchain truy được trên target |

## 8. Ma trận test ↔ Verification Requirement

| VR | Test đóng gate | Test hỗ trợ |
|---|---|---|
| VR-MBRTU-001 (scope/hardware) | TC-MBRTU-T-02, H-01 | — |
| VR-MBRTU-002 (config) | TC-MBRTU-I-01..04, I-11 | U-06..U-10 |
| VR-MBRTU-003 (codec) | TC-MBRTU-H-03 | U-01..U-05, S-01 |
| VR-MBRTU-004 (scheduler/isolation) | TC-MBRTU-H-06, H-07, T-07 | U-11..U-13, S-09, S-10 |
| VR-MBRTU-005 (quality/timestamp) | TC-MBRTU-H-05 | U-14, U-15, S-03..S-08 |
| VR-MBRTU-006 (typed runtime/catalog) | TC-MBRTU-H-10 | I-18..I-20 |
| VR-MBRTU-007 (atomic apply) | TC-MBRTU-T-08, H-09 | I-05..I-11 |
| VR-MBRTU-008 (write path) | TC-MBRTU-H-04 | I-15..I-17, S-02 |
| VR-MBRTU-009 (diagnostics) | TC-MBRTU-H-05, H-15 | I-22, S-04, S-05 |
| VR-MBRTU-010 (RBAC/API/FE) | TC-MBRTU-P-04 | I-12..I-14, I-23, I-24, U-19, U-20 |
| VR-MBRTU-011 (real RS485/HIL) | TC-MBRTU-H-01..15 | S-* (chỉ hỗ trợ) |
| VR-MBRTU-012 (provenance) | TC-MBRTU-T-01, T-09, P-05 | — |
| VR-MBRTU-013 (commissioning/import-export) | TC-MBRTU-H-13, H-14 | I-04, S-11 |
| VR-MBRTU-014 (capacity/performance) | TC-MBRTU-P-02 | U-10, U-11, S-12, T-06 |

## 9. Điều kiện vào và ra

**Điều kiện vào (entry) cho tầng Target/HIL/Acceptance:** ADR-024 Accepted; bộ tài
liệu thiết kế Modbus RTU ở trạng thái Active; source đã conform contract v2.
`OD-MBRTU-001` **đã đóng** bằng Đ-01 nên không còn là điều kiện chặn.

Các tầng Unit/Integration/Simulator **không** bị chặn bởi các điều kiện trên và đã
chạy được trong Track A — xem §10.

**Điều kiện ra (exit) để `MODBUS_RTU_POINT_READY = YES`:** mọi `VR-MBRTU-001..014`
PASS bằng evidence hiện hành có review; không waiver chưa ký; commit sạch; target
provenance truy được.

## 10. Gate hiện tại

```text
MODBUS_RTU_TEST_SPEC_DEFINED   = YES
MODBUS_RTU_UNIT_TEST           = PARTIAL   (codec/scheduler/write-lifecycle/metrics đã có; validator v2 chưa)
MODBUS_RTU_INTEGRATION_TEST    = PARTIAL   (CRUD/rollback Go đã có; transaction v2 chưa)
MODBUS_RTU_SIMULATOR_TEST      = PARTIAL   (PTY read/write/timeout đã có; exception code/CRC chưa)
MODBUS_RTU_TARGET_TEST         = PARTIAL   (Track A T-A1..T-A5 PASS trên Foxlinx 2026-08-05,
                                            nhưng fake MCU + không có fieldbus.conf ⇒ code Modbus
                                            chưa chạy dòng nào ở trạng thái vận hành)
MODBUS_RTU_PHYSICAL_RS485_TEST = NO        (chưa có slave RS485 thật đấu vào)
MODBUS_RTU_ACCEPTANCE_TEST     = NO
```

### 10.1 Số đo host của Track A (2026-08-04, commit `eade4e5`)

| Gate | Kết quả | Trước Track A |
|---|---|---|
| `ctest --test-dir build/fw` (Modbus+BACnet+HMI ON) | 769/769 PASS | 759 |
| `go vet ./...` + `go test ./... -count=1` | PASS, 11 package `ok` | — |
| `npx vitest --run --environment jsdom src` | 304/304 PASS, 35 file | 3 FAIL |
| `npm run lint` / `npm run build` | PASS / PASS | — |

**Số đo này chứng minh cái gì:** logic đã sửa của D-01..D-08, D-10..D-12, D-14
hoạt động đúng trên host.

**Số đo này KHÔNG chứng minh cái gì** — và không được trích dẫn như thể có:

- không đóng bất kỳ `VR-MBRTU-*` nào cần bằng chứng target hoặc HIL;
- không nói gì về jitter IOP với MCU thật, về dây RS-485, về half-duplex direction;
- không phải bằng chứng cho `TC-MBRTU-T-*`, `TC-MBRTU-H-*`, `TC-MBRTU-P-*`.

### 10.2 Nghiệm thu Track A trên board — ĐÃ CHẠY 2026-08-05, PASS WITH LIMITS

Năm kịch bản cổng ra của Track A (Plan 49 §3) đã chạy trên board Foxlinx
(`SOM-DDC-24-foxlinx`, Forlinx OK1126B-S / RV1126B, Linux 6.1.141 aarch64) tại
commit `eade4e5`. Evidence:
[EVID-MBRTU-TRACKA-FOXLINX-2026-08-05](../07_records/test-evidence/fw-som/2026-08-05-foxlinx-track-a-acceptance.md).

| ID | Kịch bản | Kết quả |
|---|---|---|
| T-A1 | ghi giá trị ngoài dải bị TỪ CHỐI, không byte nào lên dây | **PASS** |
| T-A2 | slave chết không làm slave tốt trượt deadline | **PASS** |
| T-A3 | UI không hiện `BAD`/`0` khi mất telemetry | **PARTIAL** — producer + API PASS trên board; FE chưa kiểm trên browser |
| T-A4 | jitter IOP không hồi quy so với baseline | **PASS** — binary mới 15,36–15,65 µs vs cũ 18,15–20,10 µs, cùng điều kiện |
| T-A5 | restart `mkddc-iobus`: không write cũ nào được phát lại | **PASS** |

`iobus_tests` aarch64 chạy **trên chính board trong lúc service production đang
chạy**: 208 PASS / 6 SKIP / 0 FAIL; sáu skip đều là `IoCache.*` (cần độc quyền SHM
production). Riêng nhóm Track A: 23/23 PASS. Sau deploy: 0 ERROR, `NRestarts=0`.

**Giới hạn bắt buộc đọc cùng kết quả — không được trích dẫn tách rời:**

1. Board chạy **fake MCU** (`mkddc-fakemcu.service`), **không** phải STM32 thật.
   Điều này làm điều kiện "cửa sổ bảo trì" biến mất, nhưng cũng làm `T-A4` **không**
   phải phép đo với MCU thật như câu chữ gốc của cổng ra yêu cầu.
2. Board **không có `fieldbus.conf`** và **không có thiết bị RS-485 nào đấu vào**,
   nên fieldbus thread không được tạo và code Modbus **không chạy dòng nào** ở
   trạng thái vận hành. Hồ sơ chứng minh code đúng trên kiến trúc/kernel/libmodbus
   của target — **không** chứng minh giao tiếp RS-485 vật lý.
3. `T-A2` vẫn đo gián tiếp qua log vì chưa có counter `deadline_miss`/`poll_duration`
   (F-FW-17).

```text
TRACK_A_BOARD_ACCEPTANCE = PASS WITH LIMITS
VR-MBRTU-011 (real RS485/HIL) = RED    ← không đổi
```

**Track A đóng được phần "code đúng trên target"; KHÔNG đóng bất kỳ gate HIL nào.**

### 10.2b Trạng thái gate sau Track B — cập nhật 2026-08-06

Bằng chứng: [nghiệm thu Track B 2026-08-06](../07_records/test-evidence/fw-som/2026-08-06-foxlinx-track-b-acceptance.md)
và [soi giao diện từng trang](../07_records/reviews/FE_BOARD_PAGE_AUDIT_2026-08-06.md).

| Gate | Trạng thái | Căn cứ |
|---|---|---|
| `VR-MBRTU-002` (config) | **GREEN** | Validator thuần + 11 mã lỗi ổn định; candidate/apply/If-Match có test BE; apply chạy thật trên board (`revision=11`) |
| `VR-MBRTU-004` (scheduler/isolation) | **AMBER** | Cách ly hai bus có test (`BusWorkerIsolation.*`) và EDF chạy trên target; **thiếu** đo trên hai dây vật lý vì `ttyS1` chưa enable |
| `VR-MBRTU-005` (quality/timestamp) | **AMBER** | Quality 5 mức + reason + mốc sample có trong contract v2 và test; **thiếu** mẫu từ thiết bị thật |
| `VR-MBRTU-007` (atomic apply) | **GREEN** | stage→journal→ACK→commit + reconcile; ACK thật từ iobus qua UDS trên board |
| `VR-MBRTU-009` (diagnostics) | **AMBER** | Counter uint64 + `producer_boot_id` + bus metrics đo thật (p50/p95/utilization); **thiếu** số từ thiết bị thật |
| `VR-MBRTU-010` (RBAC/API/FE) | **GREEN** | 23 trang soi bằng Chromium thật trên board với JWT + RBAC thật, 0 lỗi |
| `VR-MBRTU-011` (real RS485/HIL) | **RED** | Chưa có slave RS-485 thật. `G-C` còn mở |
| `VR-MBRTU-012` (provenance) | **GREEN** | `sequence`/`generation`/`config_revision`/`producer_boot_id` chạy thật; reboot ×10 giữ nguyên |
| `VR-MBRTU-013` (commissioning/import-export) | **AMBER** | Commissioning chạm dây thật (timeout đúng 300 ms qua ttyS5); import/export all-or-nothing có test; **thiếu** phản hồi từ thiết bị thật |
| `VR-MBRTU-014` (capacity/performance) | **AMBER** | 256 Point trong contract, latency/utilization đo thật; **thiếu** tải thật với nhiều slave |

**Đóng thêm ngoài bảng:** `G-D` / `OD-MBRTU-EXT-04` — phần cứng chỉ có TX/RX,
không có DE/RE ⇒ auto-direction (Hardware owner xác nhận 2026-08-06). Cơ chế nay
là cấu hình tường minh và trạng thái driver được ghi log lúc mở cổng.

**Kịch bản `TC-MBRTU-T-05` (reboot recovery) — PASS 10/10 ngày 2026-08-06**, sau
khi bài kiểm này phát hiện và bịt một lỗi triển khai thật: symlink `/dev/rs485-1`
tạo bằng tay biến mất sau mỗi reboot (devtmpfs), nên bus không bao giờ lên lại
trong khi service vẫn `active` và `NRestarts=0`. Đã bổ sung
`platform/udev/99-mkddc-rs485.rules` và cài trong `deploy_board.sh`.

### 10.3 Kịch bản còn thiếu cho hai gap end-to-end mới

`F-BE-19`/`F-BE-20` (tham số `offline_after_errors`, `offline_probe_ms` không có
đường ghi từ BE) hiện **không có test nào bắt được**, vì mỗi tầng test đúng phần của
mình: test C++ đặt struct trực tiếp, test Go kiểm validator chứ không kiểm nội dung
file sinh ra. Bổ sung `TB-MBRTU-17` (BE design §10) — kiểm nội dung `fieldbus.conf`
sau apply, không chỉ kiểm HTTP status.

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo test specification 6 tầng, 60+ test case và ma trận VR |
| 0.2 | 2026-08-05 | In Review | Áp dụng Đ-01/Đ-04/Đ-07/Đ-08 và đối chiếu với `eade4e5`. **Thay thế:** (a) §1 board nghiệm thu là Foxlinx (MCU thật), Orange Pi chỉ regression; (b) `TC-MBRTU-S-10` và `TC-MBRTU-H-06` (hai bus) chuyển **HOÃN** theo Đ-01; (c) `TC-MBRTU-U-10`/`S-12` capacity theo Đ-07 ≥256 và bắt buộc đo lại datagram/copy time; (d) `TC-MBRTU-I-12` bốn vai trò → **ba** (Đ-04); (e) `TC-MBRTU-T-02` thêm case âm cổng không tồn tại (D-14); (f) `TC-MBRTU-P-02` một bus; (g) thêm **TC-MBRTU-H-16** kiểm điều khiển hướng RS-485 (Đ-02); (h) §9 bỏ `OD-MBRTU-001` khỏi entry condition (đã đóng); (i) §10 thêm 10.1 số đo host Track A kèm giới hạn hiệu lực, 10.2 kết quả nghiệm thu board Foxlinx 2026-08-05 (`PASS WITH LIMITS`) kèm ba giới hạn bắt buộc đọc kèm, 10.3 kịch bản còn thiếu cho F-BE-19/20; `MODBUS_RTU_TARGET_TEST` chuyển `NO → PARTIAL` |
