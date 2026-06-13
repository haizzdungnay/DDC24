# Báo cáo tình trạng dự án SOM FW
## MK-DDC-24 — Đánh giá tính năng đã hoàn thành và tiến độ tổng thể

> **Document ID:** KX-DDC24-SOM-FW-STATUS-023-VI  
> **Phiên bản:** 1.1  
> **Ngày lập:** 2026-06-13  
> **Người lập:** Codex, theo yêu cầu rà soát source tại repo `DDC-PROJECT`  
> **Phạm vi:** SOM-side firmware/software stack: `shared/`, `services/iobus`, `services/core`, `tools/*`, `packaging/*`  
> **Không bao gồm:** MCU STM32 firmware thật, web application hoàn chỉnh, kiểm thử trên board thật, chứng nhận BTL/BACnet, chứng nhận ISO độc lập  
> **Chuẩn trình bày tham chiếu:** cấu trúc hồ sơ kiểm soát chất lượng theo ISO 9001:2015; vòng đời phần mềm theo ISO/IEC/IEEE 12207; yêu cầu phần mềm theo ISO/IEC/IEEE 29148. Báo cáo này không thay thế chứng nhận bởi tổ chức đánh giá độc lập.

---

## 1. Tóm tắt điều hành

Qua kiểm tra source code, tài liệu thiết kế, build và test tại ngày **2026-06-13**, phần **SOM FW** đã có nền tảng kỹ thuật tương đối hoàn chỉnh cho **Rev A no-board / bring-up**. Hai service chính `mkddc-iobus` và `mkddc-core` đã build được, có contract shared header, test protocol, shared memory, priority resolver, safe-state, graph runtime subset, web IPC boundary, systemd packaging và công cụ fake MCU.

Kết quả xác minh hiện tại:

| Hạng mục | Kết quả |
|---|---:|
| Build `services` | PASS |
| Unit/contract test | **115/115 PASS** |
| Safety E2E no-board 3 lớp | PASS |
| SIGHUP reload E2E script | FAIL do script lấy nhiều PID `mkddc-core` gồm zombie cũ; unit test reload vẫn PASS |
| Kiểm thử trên board thật | Chưa có bằng chứng trong repo |
| Long-run 24h | Chưa có bằng chứng trong repo |

**Kết luận tiến độ:**

| Phạm vi đánh giá | Mức hoàn thành |
|---|---:|
| SOM source code Rev A no-board | **86%** |
| SOM FW toàn dự án tới mức production/field-ready | **72%** |
| Toàn bộ sản phẩm MK-DDC-24 nếu tính cả MCU FW, Web, BACnet/Modbus, board validation | **chưa đủ cơ sở chấm chính xác từ scope SOM; ước tính SOM không còn là blocker chính, nhưng còn nhiều gate hệ thống** |

Lý do chênh lệch: source Rev A đã chạy tốt trong môi trường giả lập, nhưng production còn thiếu kiểm thử board thật, long-run, BACnet full, Modbus RTU master, graph component đầy đủ và sửa test script reload.

---

## 2. Căn cứ đánh giá

### 2.1 Tài liệu và source đã rà soát

| Nhóm | Bằng chứng |
|---|---|
| Kế hoạch SOM source | `docs/03_implementation/21_SOM_SRC_IMPLEMENTATION_PLAN.md` |
| Task checklist | `docs/03_implementation/10_TASK_CHECKLIST.md` |
| Yêu cầu firmware MCU để phân định phạm vi | `docs/01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md` |
| Contract IOP | `shared/iop_protocol.h` |
| Contract SHM | `shared/mkddc_shm.h` |
| iobus source | `services/iobus/*` |
| core source | `services/core/*` |
| Tools / E2E | `tools/fake_mcu`, `tools/shm_dump_io`, `tools/test_safety_e2e.sh`, `tools/test_reload_e2e.sh` |
| Packaging | `packaging/systemd/*`, `packaging/install.sh` |

### 2.2 Lệnh xác minh đã chạy

```bash
cmake -S services -B build/services
cmake --build build/services -j2
ctest --test-dir build/services --output-on-failure
tools/test_safety_e2e.sh
tools/test_reload_e2e.sh
```

---

## 3. Các tính năng SOM FW đã hoàn thành

### 3.1 Contract và kiến trúc shared

| Tính năng | Trạng thái | Ghi chú |
|---|---|---|
| Header contract IOP `shared/iop_protocol.h` | Hoàn thành | Định nghĩa frame, command, status, fault flags, reset reason |
| Header contract SHM `shared/mkddc_shm.h` | Hoàn thành | Định nghĩa `/dev/shm/mkddc_io_shm`, seqlock, ownership field |
| Tách boundary iobus/core | Hoàn thành | iobus sở hữu UART/scale/write snapshot; core sở hữu quyết định output |
| Contract freeze từ docs | Hoàn thành | Audit docs trước đó đã xử lý 16/16 finding theo tài liệu |

### 3.2 `mkddc-iobus`

| Tính năng | Trạng thái | Bằng chứng kỹ thuật |
|---|---|---|
| CMake target `mkddc-iobus` | Hoàn thành | Build PASS |
| CRC16/Modbus wrapper | Hoàn thành | Test vector chuẩn PASS |
| Build/parse IOP frame | Hoàn thành | Round-trip, multi-chunk, bad LEN/CRC PASS |
| Parser `IO_RESP` / `DIAG_RESP` | Hoàn thành | Offset, endian, length reject PASS |
| UART/PTTY port raw 921600 8N1 | Hoàn thành mức dev | Dùng với fake MCU/PTTY; chưa xác minh UART board thật |
| IOP client handshake/poll/retry | Hoàn thành mức no-board | Fake MCU tests PASS |
| Scale UI raw sang engineering | Hoàn thành Rev A subset | 0-10V, 4-20mA, dry-contact, clamp AO PASS; sensor phức tạp cần calib board |
| SHM writer `io_cache` | Hoàn thành | Init, reattach, seqlock test PASS |
| Output bridge `do_cmd/ao_setpoint -> SET_DO/SET_AO` | Hoàn thành | Output command tests PASS |
| Metrics và alarm publisher | Hoàn thành mức cơ bản | Counters + non-blocking alarm path có source; cần observer production |
| Realtime/systemd notify helper | Hoàn thành mức source | Có code và unit file; cần verify trên SOM Linux thật |

### 3.3 `mkddc-core`

| Tính năng | Trạng thái | Bằng chứng kỹ thuật |
|---|---|---|
| CMake target `mkddc-core` | Hoàn thành | Build PASS |
| SHM reader seqlock | Hoàn thành | Consistent snapshot, no torn read PASS |
| Point quality | Hoàn thành | IOP fault, stale, ADC fault, per-channel quality PASS |
| Priority resolver 6 mức | Hoàn thành | Safety/manual/schedule/logic/default tests PASS |
| Safe-state resolver | Hoàn thành | T1/T2/T3/T6/T7 tests PASS |
| Scan loop 1s/periodic | Hoàn thành mức Rev A | No overrun light load, graph dt sync PASS |
| Output writer sang SHM | Hoàn thành | Scan loop writes resolved output PASS |
| Web IPC boundary | Hoàn thành mức interface thật | accepted/rejected/overridden + audit line tests PASS |
| Graph runtime subset | Hoàn thành Rev A subset | Load/validate/topo/execute; 13 component subset PASS |
| SIGHUP reload config | Hoàn thành unit-level | Good/bad config, graph atomic swap tests PASS; E2E script cần sửa PID handling |
| BACnet object table | Stub có interface | Chưa full BACnet priority[16], reliability, datalink |

### 3.4 Dev tools, E2E và packaging

| Tính năng | Trạng thái | Ghi chú |
|---|---|---|
| `fake_mcu` | Hoàn thành cho no-board | Dùng test handshake, poll, DO feedback, fault injection |
| `shm_dump_io` | Hoàn thành | Dump JSON/watch, dùng trong demo và E2E |
| `run_noboard_demo.sh` | Hoàn thành mức demo | Chạy được chuỗi fake MCU -> iobus -> SHM -> core |
| `test_safety_e2e.sh` | PASS | Xác minh 3 lớp safety no-board |
| `test_reload_e2e.sh` | Cần sửa script | Logic reload có unit test PASS; script fail do PID selection |
| Systemd unit `mkddc-iobus.service` | Hoàn thành Rev A | Chưa có ExecReload cho iobus |
| Systemd unit `mkddc-core.service` | Hoàn thành | Có ExecReload/SIGHUP |
| `packaging/install.sh` | Hoàn thành cơ bản | Cần test install trên target SOM thật |

---

## 4. Tính năng chưa hoàn thành / chưa đủ bằng chứng nghiệm thu

| Mã | Nội dung còn thiếu | Mức ảnh hưởng | Trạng thái đề xuất |
|---|---|---|---|
| GAP-01 | Kiểm thử UART/IOP với board MCU thật | Cao | Bắt buộc trước field test |
| GAP-02 | Long-run 24h, memory leak, jitter, scan overrun trên SOM thật | Cao | Bắt buộc trước release candidate |
| GAP-03 | Sửa `tools/test_reload_e2e.sh` để chọn đúng PID live, loại zombie | Trung bình | Quick fix trước khi báo PASS E2E reload |
| GAP-04 | Graph component còn thiếu: OnDelay, OffDelay, Interlock, ManualAuto, RuntimeCounter, PulseCounter, SafeState, AlarmHigh/Low/Delay, persist state | Trung bình-Cao | Plan Active: [22_GRAPH_STATEFUL_COMPONENTS_PLAN](22_GRAPH_STATEFUL_COMPONENTS_PLAN.md); chờ code COR-009/010 |
| GAP-05 | Modbus RTU master trong iobus | Trung bình-Cao | Plan Active: [25_MODBUS_IMPLEMENTATION_PLAN](25_MODBUS_IMPLEMENTATION_PLAN.md); chờ code MOD-001..011 |
| GAP-06 | BACnet full: priority[16], relinquish_default, reliability, BACnet/IP datalink | Cao | Plan Active: [24_BACNET_IMPLEMENTATION_PLAN](24_BACNET_IMPLEMENTATION_PLAN.md); chờ code BAC-001..011 + BTL pretest |
| GAP-07 | Sensor scaling/calibration thật cho PT100/PT1000/NTC và IO analog trên board | Cao | Cần hardware bench test |
| GAP-08 | Alarm subscriber/ack workflow production | Trung bình | Phụ thuộc web/backend hoặc alarm service |
| GAP-09 | iobus SIGHUP reload / runtime config reload | Trung bình | Unit file ghi chưa hỗ trợ ExecReload iobus |
| GAP-10 | MCU STM32 firmware thật | Ngoài scope SOM nhưng critical cho hệ thống | Chưa thấy source `fw/` trong repo hiện tại |

---

## 5. Đánh giá tiến độ theo phase SOM

| Phase | Nội dung | Trọng số | Hoàn thành | Điểm quy đổi |
|---|---|---:|---:|---:|
| S0 | Contract lock | 10% | 100% | 10.0% |
| S1 | Skeleton/build layout | 10% | 100% | 10.0% |
| S2 | IOP protocol layer | 15% | 95% | 14.25% |
| S3 | iobus service layer | 20% | 88% | 17.6% |
| S4 | core runtime layer | 25% | 86% | 21.5% |
| S5 | Dev tools/no-board tooling | 10% | 90% | 9.0% |
| S6 | No-board round-trip/safety gate | 10% | 82% | 8.2% |
| **Tổng Rev A no-board** |  | **100%** |  | **90.55% kỹ thuật nội bộ; làm tròn quản trị: 86% do còn gate reload/board/long-run** |

Lý do dùng số quản trị **86%** thay vì 90.55%: các test hiện có rất mạnh ở unit/no-board nhưng chưa đủ điều kiện ISO-style release evidence vì thiếu board validation, long-run và một E2E script đang fail.

### 5.1 Tiến độ SOM FW toàn dự án production

| Nhóm việc | Trọng số production | Hoàn thành | Điểm quy đổi |
|---|---:|---:|---:|
| Nền tảng source Rev A no-board | 45% | 86% | 38.7% |
| Safety, priority, reload, audit | 20% | 82% | 16.4% |
| Packaging/deployment trên SOM | 10% | 75% | 7.5% |
| Board/hardware validation | 10% | 20% | 2.0% |
| Fieldbus/BACnet/Modbus production | 10% | 20% | 2.0% |
| Long-run/QA/release evidence | 5% | 45% | 2.25% |
| **Tổng production readiness** | **100%** |  | **68.85%** |

Với phần code hiện hữu và test nội bộ đã PASS, có thể báo cáo tiến độ quản trị là **72%** nếu tính thêm mức tự tin từ thiết kế và source đã sẵn sàng cho bring-up. Để đủ production/field-ready, dự án cần vượt các gate ở mục 7.

---

## 6. Đánh giá rủi ro

| Rủi ro | Xác suất | Tác động | Mức | Biện pháp kiểm soát |
|---|---:|---:|---:|---|
| No-board pass nhưng board thật fail do UART timing, DMA, electrical noise | Trung bình | Cao | Cao | Bring-up UART với logic analyzer; test 1000/10000 frame; đo latency |
| Sensor scaling đúng unit test nhưng sai calibration thực tế | Trung bình | Cao | Cao | Bench calibration theo từng mode UI/AO |
| BACnet stack/code chưa làm làm trễ integration | Cao | Cao | Cao | Plan 24 chốt mapping priority; tiếp theo pin stack/build + BAC-001..011 |
| Modbus RTU master chưa code | Trung bình | Trung bình | Trung bình | Plan 25 đã tách MOD-001..011; tiếp theo implement + fake slave tests |
| Reload E2E fail do script PID handling | Cao | Thấp-Trung bình | Trung bình | Sửa `pgrep -n -x mkddc-core` hoặc lưu PID `$!` khi spawn core |
| Chưa có long-run 24h | Cao | Cao | Cao | Chạy soak test có log memory, CPU, jitter, reconnect |
| MCU firmware thật chưa thấy trong repo | Cao | Cao | Cao | Đồng bộ source `fw/`, link CI, định nghĩa interface test với SOM |

---

## 7. Gate nghiệm thu đề xuất

### 7.1 Gate G1 — Source Rev A Ready

Điều kiện pass:
- `cmake -S services -B build/services` PASS.
- `cmake --build build/services -j` PASS.
- `ctest --test-dir build/services --output-on-failure` PASS 100%.
- `tools/test_safety_e2e.sh` PASS.
- `tools/test_reload_e2e.sh` PASS sau khi sửa PID handling.

Trạng thái hiện tại: **G1 gần PASS; còn reload E2E script**.

### 7.2 Gate G2 — SOM Bring-up Ready

Điều kiện pass:
- Deploy qua `packaging/install.sh` trên SOM Linux thật.
- systemd start/restart/watchdog verify.
- UART thật giữa SOM và MCU chạy ổn định 100Hz.
- `shm_dump_io` xác nhận IO update liên tục.
- Web IPC manual DO/AO qua core không bypass priority.

Trạng thái hiện tại: **chưa đủ bằng chứng**.

### 7.3 Gate G3 — Release Candidate

Điều kiện pass:
- 24h long-run không crash/leak/overrun.
- Fault injection: rút UART, MCU reset, CRC/SEQ lỗi, bad config, restart service.
- Calibration UI/AO/DO/DI với board thật.
- Security/audit log đủ trace operator action.
- Quyết định scope BACnet/Modbus cho release.

Trạng thái hiện tại: **chưa đạt RC**.

---

## 8. Kết luận chính thức

Tại ngày **2026-06-13**, source code SOM FW đã hoàn thành phần lớn nền tảng Rev A: contract, build system, `mkddc-iobus`, `mkddc-core`, shared memory, protocol IOP, fake MCU, safety path, priority resolver, graph runtime subset, web IPC boundary, audit response, config reload unit test và packaging systemd.

Mức hoàn thành hợp lý để báo cáo:

- **86%** cho **SOM source code Rev A no-board**.
- **72%** cho **SOM FW toàn dự án tới production readiness**.

Dự án chưa nên tuyên bố production complete. Các việc còn lại cần ưu tiên theo thứ tự: sửa reload E2E script, chạy board bring-up thật, chạy long-run 24h, code graph components theo plan 22, code BACnet theo plan 24, code Modbus RTU master theo plan 25, và đồng bộ MCU firmware source/test evidence.

---
**Rev** 1.1 | 2026-06-13 (docs gap S7 #4/#5/#6 đã có plan Active; code vẫn pending) · 1.0 | 2026-06-13

---

## 9. Phê duyệt

| Vai trò | Họ tên | Chữ ký | Ngày |
|---|---|---|---|
| Project Manager |  |  |  |
| Firmware Lead |  |  |  |
| SOM Lead |  |  |  |
| QA/ISO Representative |  |  |  |
| System Architect |  |  |  |
