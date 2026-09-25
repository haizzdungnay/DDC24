# Modbus RTU — Finding, gap, logic tìm lỗi và hai phương án cải tiến theo thực hành công nghiệp

**ID:** REC-MBA-GAP-001
**Phiên bản:** 1.0
**Trạng thái:** Record + đề xuất chờ chủ sở hữu chọn phương án (§6, §8)
**Ngày:** 2026-09-25
**Baseline:** `main` @ `36c1a863`; bản sửa trên nhánh `fix/modbus-audit-20260925` (`42d1199c` … `efb3e4ae`)
**Bộ hồ sơ audit:** [Hiện trạng mã nguồn](MODBUS_AUDIT_2026-09-25_SOURCE_STATUS.md) · [Hoạt động trên bo Forlinx](MODBUS_AUDIT_2026-09-25_BOARD_OPERATION_REPORT.md) · báo cáo này

---

## 1. Tóm tắt điều hành

| | Số lượng | Ghi chú |
|---|---:|---|
| Lỗi đã tái hiện và **đã sửa trong phiên** | **10** | Mỗi lỗi có test đỏ trên mã cũ và xanh sau khi sửa; 4 lỗi đã kiểm chứng trên bo |
| Lỗi còn mở cần **quyết định sản phẩm** | **1** (P0) | `MBA-FW-08`: vòng tạo lại lệnh ghi sau khi bỏ ⇒ ghi mù khi thiết bị có điện lại |
| Gap kiến trúc / vận hành | **9** | 2 × P0, 4 × P1, 3 × P2/P3 |
| Cổng kiểm chứng sau sửa | C++ **1501/1501**; Go: 2 package nhận sửa xanh, toàn repo còn **4 test đỏ có sẵn trên `main`** (Programming, ngoài phạm vi) | §9 |

Ba rủi ro lớn nhất còn lại đều nằm ở **đường ghi**:
1. lệnh không có danh tính nên không thể vừa "không phát lại" vừa "gửi lại được cùng giá trị";
2. không có kết quả ghi thật từ thiết bị về tới người vận hành;
3. chương trình ST/graph ghi theo **số thứ tự slot**, nên nếu cấu hình đổi sau Commission, lệnh có thể rơi vào điểm khác.

**Khuyến nghị:** chọn **Phương án A** (tiến hoá tại chỗ, 5–7 tuần-người) cho Rev A, vì nó
đóng cả ba rủi ro mà không đổi mô hình tiến trình. Thiết kế hợp đồng lệnh của A theo cách
để sau này nâng lên **Phương án B** (dịch vụ fieldbus độc lập) mà không phải bỏ đi.

## 2. Logic tìm lỗi — cách audit này tìm ra các finding

Phần này là **quy trình dùng lại được**: cho lần audit sau, và cho kỹ sư hiện trường
khi Modbus "không chạy".

### 2.1 Sáu phép kiểm theo đường dữ liệu

Mỗi đường (đọc, ghi, cấu hình, quan sát) đi qua nhiều chặng. Ở **mỗi chặng** đặt đúng
sáu câu hỏi:

| # | Câu hỏi | Finding tìm được nhờ câu hỏi này |
|---|---|---|
| Q1 | **Danh tính**: thứ đi qua chặng này được nhận diện bằng gì? Nhận diện đó còn đúng sau khi đổi cấu hình hoặc restart không? | `MBA-FW-02` (slot đổi chủ), `MBA-GAP-02` (ST ghi theo index), `MBA-FW-07` (ghi theo địa chỉ, bỏ `bus_id`) |
| Q2 | **Vòng đời**: khi nào nó bắt đầu, khi nào kết thúc, ai kết thúc nó? | `MBA-FW-08` (lệnh bỏ xong được tạo lại), `MBA-FW-02` (phát lại khi restart) |
| Q3 | **Phản hồi**: người phát có biết kết quả không? | `MBA-GAP-01` (sink kết quả không nối, `write-test` báo thành công trước khi thiết bị xác nhận) |
| Q4 | **Nhãn và thực thi**: cấu hình / UI hứa gì, runtime có làm đúng không? | `MBA-FW-09` (`bit_index`, `min/max` bị bỏ qua), `MBA-FW-01` (chú thích "không SCHED_FIFO" nhưng thực tế là FIFO) |
| Q5 | **Đồng thời**: đối tượng nào được nhiều thread chạm cùng lúc? Có khoá không? | `MBA-FW-03` (metrics không khoá, heap hỏng), `MBA-FW-04` (lệnh chen giữa giao dịch bị nuốt) |
| Q6 | **Đối chiếu chéo tầng**: cùng một con số đọc ở hai tầng có khớp nhau không? | `MBA-BE-01` (SHM 41/12, API 0/0) |

### 2.2 Kỹ thuật thực hiện

1. **So khoá cấu hình giữa bên sinh và bên tiêu thụ.** Liệt kê mọi khoá BE ghi vào
   `fieldbus.conf`/profile (`persistence.go`), rồi `grep` từng khoá trong parser iobus.
   Khoá không có consumer là một tính năng chỉ tồn tại trên giấy. `bit_index`,
   `min_value`, `max_value` đều cho 0 kết quả.
2. **Kiểm bất biến thiết kế trên target, không tin chú thích.** Đọc
   `/proc/<pid>/task/*/stat` (trường 40 rtprio, 41 policy) cho từng thread.
3. **Đọc thẳng SHM** bằng `od` theo offset trong hợp đồng, rồi so với API. Một con số
   khác nhau giữa hai tầng là một lỗi ánh xạ.
4. **Phân bố log theo thời gian và theo boot**, không đọc log tuần tự. 171 sự kiện dồn vào
   3 phút đầu sau khởi động là dấu hiệu phát lại; khoảng 3.000 lần `write_fail` mỗi giờ
   khi thiết bị offline suốt là dấu hiệu lệnh sống vô hạn.
5. **Dựng lại kịch bản bằng slave thật trên PTY** (libmodbus `modbus_reply`) và chen hành
   động vào đúng giữa giao dịch bằng callback của slave. Nhờ đó các lỗi race tất định hoá được.
6. **Đỏ trước, xanh sau.** Mỗi test mới được chạy trên worktree của mã cũ (`36c1a863`) để
   chứng minh nó bắt đúng lỗi, rồi mới tin kết quả xanh.
7. **Kiểm chứng deploy bằng `sha256sum /proc/<MainPID>/exe`**, không bằng
   `systemctl is-active`.

### 2.3 Cây chẩn đoán hiện trường (dùng với build sau phiên này)

```text
Thiết bị OFFLINE?
├─ /modbus/buses: bus PORT_ERROR hoặc port_reopens tăng ─► cổng/driver: ls -l /dev/rs485-*, dmesg, /proc/tty/driver/serial
├─ Frame Monitor reason = "timeout" ở mọi slave trên dây ─► dây, nguồn, baud/parity, đầu cuối 120 Ω, A/B đảo
├─ reason = "timeout" chỉ ở một slave ─► địa chỉ slave, nguồn thiết bị, timeout_ms quá ngắn
├─ reason = "crc" hoặc /proc/tty fe, pe tăng ─► nhiễu, thiếu termination/bias, baud lệch, stop bit
└─ reason = "exception" ─► KHÔNG phải mất liên lạc: địa chỉ/FC sai trong profile (log modbus.block_exception)

Giá trị sai nhưng GOOD?
├─ byte_order / word_order (ABCD/BADC/CDAB/DCBA), scale/offset
├─ Point bit đọc ra số > 1 ─► bản iobus cũ không đọc bit_index (sửa ở MBA-FW-09)
└─ số vô lý ─► khai min_value/max_value để quality thành BAD/OUT_OF_RANGE

Lệnh ghi "thành công" mà thiết bị không đổi?
├─ /modbus/diagnostics write_failed / write_dropped tăng? (trước MBA-BE-01 luôn = 0)
├─ Frame Monitor có FC05/06/16 cho slave đó không? (trước MBA-FW-06 không thấy lệnh ghi)
├─ journal: modbus.write_fail / write_dropped_* / write_identity_mismatch
├─ Point có verify_after_write? readback_mismatch ⇒ thiết bị ACK rồi bỏ qua (tham số bị khoá)
└─ vừa đổi cấu hình? ⇒ slot đã dịch, binding ST cần Check lại (MBA-GAP-02)
```

## 3. Finding đã sửa trong phiên

Mức: **P0** = sai thiết bị / an toàn / mất lệnh; **P1** = sai dữ liệu hoặc mất khả năng
quan sát; **P2** = tiềm ẩn.

| ID | Mức | Tầng | Lỗi | Bằng chứng trước sửa | Commit | Kiểm chứng |
|---|---|---|---|---|---|---|
| MBA-FW-02 | **P0** | FW+core | Restart iobus phát lại mọi setpoint cũ (`dirty` là cờ mức); Point mới thừa hưởng lệnh của Point cũ khi slot đổi chủ; iobus không kiểm tên slot trước khi ghi | Bo 24/09: 171 sự kiện ghi trong 3 phút đầu; SHM 32/32 slot `dirty=1` | `c5336ca0` | 3 test đỏ→xanh; **bo**: `write_baseline seeded=32`, 0 lần ghi (so với 171) |
| MBA-FW-04 | **P0** | FW | Lệnh ghi mới cho cùng register, chen vào lúc lệnh cũ đang phát, bị đánh "đã gửi" và xoá. Giá trị cuối của một chuỗi ramp biến mất | Test: coil ở thiết bị kẹt = 1 | `58ebd09e` | `MbaWriteQueue.*` đỏ→xanh |
| MBA-FW-09 | **P0** | FW+BE | `bit_index`, `min/max` bị iobus bỏ qua; BE cho khai `read_write` với Point bit, nên lệnh ghi FC06 đè **cả** register | `grep` iobus = 0 kết quả; test: bit 1 của 0x0005 ra 5 | `efb3e4ae` | 3 test đỏ→xanh (bo không có Point bit) |
| MBA-BE-02 | **P0** | BE | `PUT /api/v1/points/{id}` không ghi được Point Modbus (409); `point_id` dạng `DO3` sẽ ghi vào **ngõ ra cục bộ** DO3 | Bo 09:45:32: `point=CK50804D … rejected` | `7e0d3c36` | 4 test đỏ→xanh; **bo**: HTTP 200, `point=EXT1 accepted` |
| MBA-FW-03 | P1 | FW | `FieldbusMetrics` không có khoá giữa 3 thread: data race trên `vector`/`string` | Test trên mã cũ **abort 3/3 lần** (`malloc(): corrupted top size`) | `c14e2022` | test xanh ổn định |
| MBA-FW-05 | P1 | FW | Exception của **một** block kéo **cả** thiết bị OFFLINE, Point tốt mất giá trị | Test: coil tốt thành BAD, thiết bị OFFLINE | `58ebd09e` | đỏ→xanh |
| MBA-FW-01 | P1 | FW+core | Thread Modbus/publish/control chạy SCHED_FIFO 70 (cùng mức IOP); IPC Programming và RETAIN ở FIFO 80 (trên IOP) | **bo** `/proc`: 5/5 và 3/3 thread là FIFO | `54395289` | **bo**: thread phụ là OTHER, chỉ vòng IOP/scan còn FIFO |
| MBA-BE-01 | P1 | BE | `/modbus/diagnostics` luôn trả `write_failed`, `write_dropped`, `last_exception` = 0 | **bo**: SHM 41/12, API 0/0 | `42d1199c` | test đỏ→xanh; **bo**: API 41/12 |
| MBA-FW-06 | P2 | FW | Frame Monitor không thấy lệnh ghi; exception bị gộp vào `error` | đọc mã | `58ebd09e` | test host xanh (trên bo chưa có lệnh ghi lên dây sau deploy) |
| MBA-FW-07 | P2 | FW | Op `write` bỏ `bus_id`: cùng `slave_id` trên hai dây ⇒ ghi sang dây kia | đọc mã (BE chưa gọi op này) | `bc5f54ca` | `MbaWriteRouting.*` |

Mọi bản sửa đều **fail-closed**. Không cái nào đổi layout SHM hay `KX_SHM_MAGIC`, nên
không cần deploy đồng bộ 3 tiến trình.

## 4. Lỗi còn mở cần quyết định

### MBA-FW-08 — P0 — Lệnh ghi bị bỏ được tạo lại vô hạn (ghi mù khi thiết bị có điện lại)

- **Triệu chứng.** Bo, boot −4..−1: khoảng 3.000 `write_fail`/giờ trong khi 4 thiết bị offline
  suốt. Tổng 309.672 `write_fail`, 128.586 lệnh bị bỏ.
- **Nguyên nhân gốc.** Hai quyết định đúng khi xét riêng nhưng mâu thuẫn khi đi cùng
  nhau trên một cờ mức:
  1. OD-MBRTU-005: lệnh sống tối đa 3 lần phát / 30 s, rồi bị bỏ;
  2. bản vá `87f71676`: bỏ lệnh thì xoá dấu chống trùng, để lệnh MỚI cùng giá trị vẫn gửi được.

  Vì `dirty` vẫn là 1 và không mang danh tính lệnh, iobus không phân biệt được "lệnh cũ
  còn đó" với "lệnh mới cùng giá trị". Lượt drain kế tiếp (100 ms) tạo lại chính lệnh cũ.
  Hệ quả là lệnh đặt lúc 09:00 cho một thiết bị mất điện sẽ được ghi lúc 14:00 khi thiết
  bị có điện lại, đúng kịch bản thiết kế cấm (§4.3, §8.2).
- **Vì sao không vá tạm trong phiên.** Với ABI hiện tại chỉ có thể chọn **một** trong hai
  kiểu hỏng: (a) giữ như hiện nay, tức ghi mù khi thiết bị có điện lại; hoặc (b) hoàn lại
  `87f71676`, tức lệnh mới cùng giá trị sau một lần bỏ bị nuốt im lặng. Cả hai đều vi phạm
  một quyết định sản phẩm đã ký. Sửa đúng cần **danh tính lệnh**, tức đổi hợp đồng SHM.
  Đây là nội dung của cả hai phương án (§6).

## 5. Gap kiến trúc và vận hành

| ID | Mức | Gap | Hiện trạng / bằng chứng | Hướng xử lý |
|---|---|---|---|---|
| MBA-GAP-01 | **P0** | Không có kết quả ghi đầu–cuối | Op `write` có `request_id` nhưng BE không gọi; `set_write_result_sink` không được nối nên readback `applied/unverified` bị bỏ; `write-test` báo "thành công" khi core **nhận** lệnh | A: kết quả theo `cmd_seq` qua snapshot. B: kênh lệnh/kết quả |
| MBA-GAP-02 | **P0** | Runtime ST/graph ghi EXT theo **index slot** | Check phân giải `extIndex` (ISS-PIO-31), nhưng runtime không đối chiếu danh tính. Đổi cấu hình Modbus sau Commission làm slot dịch ⇒ chương trình ghi sang Point khác. Chốt chặn `MBA-FW-02` chỉ bắt được lệch tên trong khoảng chuyển generation | Binding theo `(device_id, point_id)`; core kiểm tên slot trước mỗi lệnh; lệch ⇒ chặn + chẩn đoán |
| MBA-GAP-03 | P1 | Cảnh báo mất liên lạc không vào hệ cảnh báo | E302/E303 chỉ in ra stderr; `alarm.sock` chỉ có HMI nghe (HMI không chạy ⇒ `alarm.drop errno=2`); `/modbus/events` nằm trong RAM, mất khi web restart; không log khi thiết bị ONLINE trở lại | Alarm tích hợp sẵn theo thiết bị/bus; nhật ký sự kiện bền; log chuyển trạng thái hai chiều |
| MBA-GAP-04 | P1 | Kiểm soát tải bus và đo thời hạn | Ước lượng BE giả định mọi điểm liền kề, 2 B/điểm, bỏ thời gian slave (bo: ước 20,17 %, đo 15,88 %; profile rời rạc sẽ ước **thấp**); chưa có `deadline_miss`/`poll_duration` (F-FW-17); bo đặt `offline_probe_ms=1000` = `poll_ms`, nên probe chậm (D-04) không còn tác dụng | Mô hình đúng số block/byte + turnaround đo được + trường hợp xấu nhất khi thiết bị chết; bộ đếm deadline; cảnh báo cấu hình probe ≤ poll |
| MBA-GAP-05 | P1 | Áp cấu hình | Hai đường song song (CRUD áp ngay / candidate→apply); mỗi lần áp dừng **mọi** worker và huỷ lệnh ghi đang chờ; thời gian dừng không có trần trong khi BE chờ ACK 5 s ⇒ BE có thể khôi phục file cũ khi iobus đã chạy bản mới; kênh điều khiển một thread (probe 3 s chặn `status`) | Chỉ còn candidate→apply; áp theo bus/thiết bị; hợp nhất trạng thái qua `status.config_revision` |
| MBA-GAP-06 | P1 | Bus 2 không có trên bo | `/dev/ttyS1` không tồn tại, dù OD-MBRTU-001 chốt 2 cổng | Hardware owner: overlay UART1 (`ENABLE_TTYS1_RS485_2.md`) |
| MBA-GAP-07 | P2 | Độ chính xác và danh tính phụ | Đường ghi dùng `float` (số nguyên 32-bit > 2²⁴ bị làm tròn); Point mảng mang tên ghép cắt 23 ký tự; ghi bit (FC22/RMW) chưa có | `double` xuyên suốt; cấm mảng hoặc định danh mảng tường minh; FC22 theo năng lực thiết bị |
| MBA-GAP-08 | P2 | Kiểm chứng | Chưa có HIL (bo chạy Fake MCU), chưa soak có tiêm lỗi (rút cáp, nhiễu, mất điện thiết bị), chưa có TSan trong cổng iobus, A/B jitter chưa đo có kiểm soát | Lane HIL + soak 72 h + TSan job |
| MBA-GAP-09 | P3 | Hiệu năng phụ | Publisher `mmap/munmap plc_shm` mỗi 100 ms (257 s CPU hệ thống/27 h); Modbus TCP (ẩn) poll trong thread publish | Giữ mapping, kiểm inode/magic định kỳ; TCP có thread riêng khi mở |

## 6. Hai phương án cải tiến

### 6.1 Tiêu chí theo thực hành công nghiệp

Hai phương án được chấm theo cùng một bộ tiêu chí. Mỗi tiêu chí tham chiếu một thực
hành phổ biến trong hệ BMS/SCADA, **không** phải tuyên bố chứng nhận.

| # | Tiêu chí | Tham chiếu thực hành |
|---|---|---|
| C1 | Lệnh có danh tính, vòng đời hữu hạn, **không ghi mù** sau khi mất liên lạc; chính sách gửi lại khai **theo điểm** | Gateway công nghiệp: `write on change` / `cyclic write`; mô hình priority array của BACnet |
| C2 | Kết quả ghi đầu–cuối: accepted → applied / unverified / timeout / rejected, kèm readback | Mô hình command/feedback của DCS |
| C3 | Danh tính điểm bền qua mọi thay đổi cấu hình; index chỉ là handle nội bộ | Tag/NodeId bền (OPC UA) |
| C4 | Quality + timestamp nguồn theo từng điểm; không publish số vô lý với nhãn tốt | Status code của OPC UA |
| C5 | Tách thời gian thực: fieldbus không chạy trên vòng I/O, không chung thread/heap với vòng tất định | Tách lớp tất định / không tất định |
| C6 | Cảnh báo mất liên lạc theo quản lý cảnh báo (ưu tiên, ack, lịch sử bền) | ISA-18.2 / IEC 62682 |
| C7 | Cấu hình theo giao dịch (nháp → kiểm → áp → xác nhận → rollback), áp cục bộ, không làm rơi lệnh | Quy trình quản lý thay đổi |
| C8 | Kiểm soát tải bus bằng ngân sách xấu nhất, có đo trễ hạn | Lập lịch có admission control |
| C9 | Truy vết: ai ra lệnh, giá trị nào, thiết bị xác nhận gì | Yêu cầu audit trong IEC 62443-3-3 |
| C10 | Kiểm chứng: HIL, tiêm lỗi, soak, kiểm tra đồng thời tự động | V&V của dự án |

### 6.2 Phương án A — Tiến hoá tại chỗ (giữ 3 tiến trình và SHM)

**Ý tưởng.** Giữ nguyên mô hình `iobus`/`core`/`web` và kênh SHM, sửa **hợp đồng lệnh**
và bổ sung những gì còn thiếu quanh nó.

| Hạng mục | Thay đổi | Đóng |
|---|---|---|
| A1. Danh tính lệnh | Thêm vào `kx_ext_point_t`: `uint32 cmd_seq` (core tăng mỗi **lệnh**), `uint32 cmd_origin` (web/schedule/ST/graph); snapshot v3 trả `done_seq`, `result` (applied/unverified/timeout/rejected/superseded), `readback`. Bỏ ngữ nghĩa cờ mức `dirty`. Bump `KX_SHM_MAGIC` v7 và schema snapshot 3, deploy đồng bộ 3 binary | MBA-FW-08, GAP-01, C1, C2 |
| A2. Chính sách ghi theo điểm | Trường profile `write_policy`: `on_change` (mặc định, không gửi lại), `reassert_on_reconnect` (gửi lại giá trị **đang được ra lệnh** khi thiết bị ONLINE trở lại, không phải lệnh cũ đã hết hạn), `cyclic(N s)` | C1 |
| A3. Danh tính slot ở runtime | Binding ST/graph lưu `(device_id, point_id)`; core kiểm `ext[i].name` trước mỗi lệnh; lệch ⇒ chặn lệnh + chẩn đoán chương trình (hành vi chờ quyết định §8) | GAP-02, C3 |
| A4. Kết quả lên UI | BE đọc `result/readback` qua SHM, trả về `write-test`/`PUT points` (chờ tới deadline) và đẩy qua WS; UI phân biệt "đã gửi" / "thiết bị đã nhận" / "chưa xác nhận" | GAP-01, C9 |
| A5. Cảnh báo | Core sinh sẵn alarm `MODBUS_DEVICE_COMM_LOSS` / `MODBUS_BUS_DOWN` từ quality và bus state (không cần người dùng tự khai rule); log `slave_online`; `/modbus/events` ghi SQLite vòng (ví dụ 10.000 dòng) | GAP-03, C6 |
| A6. Kiểm soát tải và đo | BE ước lượng theo đúng luật gộp block của iobus + turnaround mặc định 10 ms (bo đo ≈11 ms) + trường hợp tất cả thiết bị chết; iobus thêm `deadline_miss`, `poll_duration_p95`; validator cảnh báo `offline_probe_ms ≤ poll_ms` | GAP-04, C8 |
| A7. Áp cấu hình | FE chỉ dùng candidate→apply; iobus chỉ dựng lại worker của bus bị đổi; BE chờ ACK theo ngân sách tính được và đối soát bằng `status.config_revision` thay vì khôi phục mù | GAP-05, C7 |
| A8. Độ chính xác | `double` cho `PendingWrite`/`last_written_`; FC22 cho Point bit khi profile khai `supports_mask_write` | GAP-07 |
| A9. Kiểm chứng | TSan job cho `iobus_tests`; soak 72 h có tiêm lỗi (rút cáp, tắt nguồn thiết bị, nhiễu); A/B jitter có kiểm soát | GAP-08, C10 |

- **Công sức:** khoảng **5–7 tuần-người** (A1–A4: 3 tuần; A5–A7: 2 tuần; A8–A9: 1–2 tuần).
- **Rủi ro:** trung bình-thấp. Chỗ nhạy nhất là bump ABI (A1): phải deploy iobus + core + web
  cùng lượt, có cổng magic đã có sẵn chặn lệch phiên bản.
- **Giới hạn:** Modbus vẫn chạy chung tiến trình với vòng IOP. Một lỗi bộ nhớ ở fieldbus
  vẫn có thể kéo IOP xuống. Đã giảm xác suất (khoá, test đồng thời) nhưng không cách ly.

### 6.3 Phương án B — Dịch vụ fieldbus độc lập, mô hình lệnh/kết quả

**Ý tưởng.** Tách Modbus khỏi `mkddc-iobus` thành tiến trình riêng `mkddc-fieldbusd`, và
thay SHM cờ mức bằng một kênh lệnh/kết quả tin cậy do core điều phối.

| Hạng mục | Thay đổi | Đóng |
|---|---|---|
| B1. Cách ly lỗi | `mkddc-fieldbusd` (SCHED_OTHER, cgroup giới hạn CPU/RAM, watchdog systemd, restart độc lập); `mkddc-iobus` chỉ còn IOP. Sập fieldbus không chạm vòng I/O | C5 |
| B2. Kênh lệnh | UDS `SOCK_SEQPACKET` core → fieldbusd: `WriteRequest{request_id, point_id, generation, value(double), deadline, origin, priority}` → `WriteResult{request_id, status, exception, readback, t_applied}`. Core là **cửa duy nhất**: priority array 16 mức cho Point EXT, tương tự BACnet | MBA-FW-08, GAP-01, C1, C2 |
| B3. Danh tính | Toàn hệ dùng `(device_id, point_id)`; fieldbusd tự giữ bảng `point_id → slot` theo generation; ST/graph/web không bao giờ thấy index | GAP-02, C3 |
| B4. Dữ liệu điểm | Status code 3 mức + mã con (kiểu OPC UA), source timestamp + server timestamp, cờ "đang bị ghi đè tay" | C4 |
| B5. Cảnh báo và lịch sử | Sự kiện liên lạc là alarm hạng nhất (ưu tiên, ack, shelving), lịch sử bền; KPI khả dụng theo thiết bị | GAP-03, C6 |
| B6. Cấu hình | Áp hai pha theo thiết bị (prepare → commit), version vector, diff, rollback tự động khi thiết bị không lên sau N chu kỳ | GAP-05, C7 |
| B7. Lập lịch | EDF có ngân sách theo bus, admission control lúc áp, t3.5/turnaround cấu hình được, FC22/FC23, broadcast có kiểm soát | GAP-04, C8 |
| B8. Truy vết và bảo mật | Audit lệnh ghi (ai, giá trị ra lệnh, giá trị thiết bị xác nhận); quyền ghi theo điểm; giới hạn tần suất theo điểm; fieldbusd là tiến trình duy nhất thuộc nhóm `dialout` | C9 |
| B9. Kiểm chứng | Bộ mô phỏng slave nhiều thiết bị (PTY/`socat`) chạy trong CI; HIL; soak có tiêm lỗi | C10 |

- **Công sức:** khoảng **12–16 tuần-người** (tách tiến trình + hợp đồng mới 4–5 tuần;
  chuyển Programming/graph/web sang danh tính và kênh mới 4–5 tuần; cảnh báo, cấu hình hai
  pha, lập lịch 3–4 tuần; V&V 2 tuần).
- **Rủi ro:** cao. Đổi hợp đồng giữa 4 tiến trình, phải chuyển đổi binding Programming đã
  Commission, phải chạy lại toàn bộ V&V Point & I/O (ISS-PIO) và Programming.
- **Lợi ích riêng:** cách ly lỗi thật; ngữ nghĩa lệnh sạch, dễ lập hồ sơ chứng nhận và dễ
  mở rộng (Modbus TCP, BACnet MS/TP sau này dùng chung khung).

### 6.4 So sánh

| Tiêu chí | Hiện trạng (sau phiên) | Phương án A | Phương án B |
|---|---|---|---|
| C1 không ghi mù + gửi lại có chủ đích | ✗ (`MBA-FW-08`) | ✅ | ✅ |
| C2 kết quả ghi đầu–cuối | ✗ | ✅ qua snapshot, trễ ≤ 1 chu kỳ publish | ✅ đồng bộ theo `request_id` |
| C3 danh tính bền | ◐ (chặn khi lệch tên) | ✅ | ✅ (index biến mất khỏi API) |
| C4 quality/timestamp | ✅ (đã có, thêm OUT_OF_RANGE) | ✅ | ✅ + status con |
| C5 tách thời gian thực | ◐ (thread OTHER, chung tiến trình) | ◐ | ✅ tách tiến trình |
| C6 quản lý cảnh báo | ✗ | ✅ cơ bản | ✅ đầy đủ |
| C7 cấu hình giao dịch | ◐ | ✅ áp theo bus | ✅ hai pha theo thiết bị |
| C8 kiểm soát tải | ◐ | ✅ | ✅ + ngân sách EDF |
| C9 truy vết | ◐ | ✅ | ✅ + quyền theo điểm |
| C10 kiểm chứng | ◐ | ✅ | ✅ |
| Công sức | — | 5–7 tuần-người | 12–16 tuần-người |
| Rủi ro chuyển đổi | — | trung bình-thấp | cao |
| Deploy | — | 1 lượt đồng bộ 3 binary | thêm unit mới + chuyển đổi dữ liệu binding |

### 6.5 Khuyến nghị

**Chọn A cho Rev A**, và thiết kế A1 sao cho `cmd_seq`/`result` chính là bản rút gọn của
`WriteRequest`/`WriteResult` trong B2 (cùng tên trường, cùng tập trạng thái). Khi cần B
(Rev B, hoặc khi mở thêm giao thức), việc tách tiến trình chỉ còn là đổi kênh vận chuyển,
không đổi ngữ nghĩa. Thứ tự đề xuất: **A1 → A3 → A4** (đóng hai P0 và `MBA-FW-08`), rồi
**A5 → A7 → A6**, cuối cùng **A8, A9**.

## 7. Tiêu chí nghiệm thu đo được (cho phương án được chọn)

| Mã | Tiêu chí | Cách đo |
|---|---|---|
| AC-MBA-01 | 0 lệnh ghi được phát sau khi iobus/fieldbusd restart, qua 10 lần restart có 32 lệnh treo | journal + Frame Monitor (FC05/06/16) |
| AC-MBA-02 | Lệnh bị bỏ (TTL/hết lượt) **không** được phát lại khi thiết bị có điện lại, trừ Point khai `reassert_on_reconnect` | HIL: tắt nguồn slave 10 phút, đặt setpoint, cấp nguồn lại |
| AC-MBA-03 | Lệnh mới cùng giá trị sau một lần bỏ **được** phát | test PTY + HIL |
| AC-MBA-04 | UI hiển thị kết quả `applied/unverified/timeout` ≤ 2 s sau khi thiết bị trả lời | e2e Playwright trên bo |
| AC-MBA-05 | Đổi cấu hình làm dịch slot sau Commission ⇒ 0 lệnh ghi sai Point; chương trình báo chẩn đoán | test tích hợp core + web |
| AC-MBA-06 | Rút cáp một thiết bị ⇒ alarm comm-loss trong ≤ `offline_after_errors × poll_ms + 1 s`, tự xoá khi ONLINE trở lại, còn trong lịch sử sau restart web | HIL |
| AC-MBA-07 | Sai lệch ước lượng tải bus so với đo ≤ ±20 % trên 3 profile (liền kề, rời rạc, có thiết bị chết) | so `/modbus/buses` |
| AC-MBA-08 | Jitter IOP: overrun/phút khi có 16 thiết bị trên 2 bus ≤ mức nền không Modbus + 10 % ở cùng tải web | A/B 30 phút × 2 |
| AC-MBA-09 | TSan sạch cho `iobus_tests`; soak 72 h không leak (RSS ổn định ± 5 %) | CI + bo |

## 8. Quyết định cần chủ sở hữu chốt

| # | Câu hỏi | Lựa chọn | Đề xuất |
|---|---|---|---|
| D1 | Phương án | A / B / A rồi B | **A, thiết kế tương thích B** |
| D2 | Khi thiết bị có điện lại, có gửi lại giá trị đang ra lệnh không? | không (on_change) / có theo điểm / chu kỳ | **Theo điểm**, mặc định `on_change`; actuator quan trọng khai `reassert_on_reconnect` |
| D3 | Runtime ST/graph gặp slot lệch danh tính | chặn lệnh + chẩn đoán / đưa chương trình về fault / giữ lệnh cuối | **Chặn lệnh + chẩn đoán**, không fault cả chương trình |
| D4 | Ghi Point bit | FC22 / read-modify-write / không hỗ trợ | **FC22** khi thiết bị khai hỗ trợ; RMW chỉ khi có khoá theo thiết bị |
| D5 | `offline_probe_ms` trên bo lab đang = 1000 | giữ / 5000 | **5000** (mặc định thiết kế) |
| D6 | Bus 2 | bật UART1 trên bo lab / hoãn | cần Hardware owner xác nhận overlay |

## 9. Kiểm chứng của phiên

| Cổng | Lệnh | Kết quả |
|---|---|---|
| C++ (mốc) | `cmake --fresh … MODBUS=ON BACNET=ON HMI=ON`, build, `ctest` trên `36c1a863` | configure 0 · build 0 · **1489/1490** (đỏ: `iec_claim_policy`, do câu trong spec FBD, sửa ở `2840392f`) |
| C++ (sau sửa) | như trên trên `efb3e4ae` | configure 0 · build 0 · **1501/1501** (2 skip: memlock có sẵn; FIFO cần quyền RT) |
| Đỏ trên mã cũ | worktree `36c1a863` + test mới | 4/4 test hành vi FW đỏ; test đồng thời **abort 3/3**; test core đỏ; 4/4 test BE đỏ |
| Go | `go vet ./...` | exit 0 |
| Go | `go test ./... -count=1` | `app`, `modbusrtu` xanh; 19 package ok; **4 test đỏ trong `programming/application` và `programming/store` — đỏ y hệt trên `main` khi chưa có thay đổi của phiên** (PR #746: publish FB tự gán layout, điều kiện pin library khi seal). Ngoài phạm vi Modbus, cần nhóm Programming quyết định test hay code là đúng |
| FE | — | Không đổi mã FE; trang Chẩn đoán hiển thị sẵn các cột `write_failed`/`write_dropped` nay có số thật |
| Target | deploy + đo trên bo | xem [báo cáo bo §6](MODBUS_AUDIT_2026-09-25_BOARD_OPERATION_REPORT.md) |

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-25 | Tạo mới: 10 finding đã sửa, 1 finding mở, 9 gap, logic tìm lỗi, hai phương án A/B, tiêu chí nghiệm thu, quyết định cần chốt |
