# Bàn giao cổng RS-485 #1 cho team phần mềm — Foxlinx SOM-DDC-24

> **ID:** HW-FOXLINX-RS485-HANDOVER-001
> **Ngày:** 2026-08-18
> **Trạng thái:** Lớp phần cứng + OS **ĐÃ XONG**. Cấu hình ứng dụng: **việc của team SW**.
> **Bằng chứng đo:** [EVID-MBRTU-FOXLINX-P16-2026-08-18](../../07_records/test-evidence/fw-som/2026-08-18-foxlinx-rs485-p16-verification.md)

---

## 1. Team SW cần biết đúng ba điều

1. Cổng là **`/dev/rs485-1`** (đừng dùng `/dev/ttyS5` trực tiếp — xem §3).
2. Modbus RTU master **đã bật sẵn** trong `mkddc-iobus`; kênh điều khiển đang
   nghe ở `/run/mkddc/modbus-control.sock`. Cổng sẽ **tự mở** ngay khi có slave
   đầu tiên được cấu hình. Không cần đụng gì tới systemd nữa.
3. Chỉ còn **hai cái bẫy** làm slave "cấu hình xong mà không chạy": thiếu
   **profile** (§5) và **bus 2 chưa có phần cứng** (§6). Đọc kỹ hai mục đó.

---

## 2. Trạng thái đã kiểm chứng của lớp phần cứng

| Hạng mục | Trạng thái | Cách đã kiểm |
|---|---|---|
| Device tree `uart5` (`serial@211a0000`) | `status = "okay"` | đọc `/proc/device-tree` |
| Pin mux ra Header P16 | `pin 134 (gpio4-6)` = **chân 8 TX**, `pin 135 (gpio4-7)` = **chân 10 RX**, nhóm `uart5m0-xfer-pins` | `debugfs pinmux-pins` |
| SoC có lái được chân thật không | **CÓ** — chân 8 dao động 20/40 mẫu khi truyền `0x55` | lấy mẫu `GPIO_EXT_PORT` bank GPIO4 |
| Đấu nối vật lý | module RS-485 nối **chân 8 (TXD) + chân 10 (RXD)** | sơ đồ mạch P16 + xác nhận hardware owner |
| Symlink `/dev/rs485-1 → ttyS5` | có, **bền qua reboot** (udev rule trên `/`, ext4) | `99-mkddc-rs485.rules` |
| Quyền truy cập | `ttyS5` thuộc group `dialout`; user `mkddc` có trong `dialout` | `id mkddc` |
| Điều khiển hướng half-duplex | `mode=auto`, **không** dùng `TIOCSRS485`, **không** RTS | log `bus_worker.rs485_direction` |
| Modbus RTU master trong `mkddc-iobus` | **đã bật** (2026-08-18) | §4 |
| Cổng mở được khi có slave | **CÓ** — đã chứng minh bằng slave thử rồi hoàn tác | log `bus_worker.open bus=1 device=/dev/rs485-1 9600N81` |

> [!NOTE]
> **Chưa có slave nào đấu vào bus A/B.** Vì vậy `rx: 0` hiện nay là kết quả
> **đúng**, không phải lỗi — không có ai để trả lời thì không có gì để nhận.
> Phép thử end-to-end cuối cùng chỉ chạy được sau khi có thiết bị thật trên bus.

---

## 3. Dùng `/dev/rs485-1`, không dùng `/dev/ttyS5`

`fieldbus.conf` trỏ `/dev/rs485-1` là **có chủ đích**: số hiệu `ttyS*` phụ thuộc
thứ tự enable trong device tree và sẽ đổi khi đổi bo, còn `rs485-1` là **vai trò**
trong sản phẩm. Hard-code `ttyS5` là tự đặt bom hẹn giờ cho lần đổi BSP kế tiếp.

Symlink do **udev** tạo (`/etc/udev/rules.d/99-mkddc-rs485.rules`), không phải
`ln -s` thủ công — `/dev` là devtmpfs, dựng lại từ đầu mỗi lần boot, nên symlink
tạo tay sẽ biến mất sau reboot và bus im lặng vĩnh viễn (đã từng xảy ra 2026-08-06).

---

## 4. Modbus RTU master: đã bật, đây là thứ đã đổi

Trước 2026-08-18, **cả unit gốc lẫn drop-in đều không truyền `--fieldbus-config`**,
nên `ModbusMaster` chưa bao giờ khởi động — log không có một dòng bus nào và
`/run/mkddc/modbus-control.sock` không tồn tại. Đã sửa trong
`/etc/systemd/system/mkddc-iobus.service.d/nomcu.conf`:

```ini
[Service]
ExecStart=
ExecStart=/usr/sbin/mkddc-iobus --uart /tmp/mkddc-iop-a \
  --fieldbus-config /data/config/fieldbus.conf \
  --fieldbus-sock /run/mkddc/fieldbus.sock \
  --fieldbus-control-sock /run/mkddc/modbus-control.sock
```

Bản cũ lưu tại `/root/nomcu.conf.bak-20260818T120015Z`.

Xác nhận sau khi bật (`NRestarts=0`, 0 dòng ERROR trong 30 s):

```text
INFO  fieldbus_config.loaded path=/data/config/fieldbus.conf buses=2 slaves=0 revision=35
INFO  fieldbus_config.bus id=1 name=Loop-1 device=/dev/rs485-1 9600N81 probe=1000ms enabled=1
INFO  control_channel.listening path=/run/mkddc/modbus-control.sock
```

**Cổng chưa mở lúc này là đúng thiết kế.** Điều kiện trong
`apps/iobus/bootstrap/main.cpp:349` là:

```cpp
const bool rtu_configured = fieldbus_cfg.loaded && !fieldbus_cfg.slaves.empty();
```

Không có slave ⇒ không mở cổng. Thêm slave đầu tiên ⇒ worker mở cổng ngay, không
cần restart (kênh điều khiển `apply_config` dựng lại worker lúc đang chạy).

---

## 5. BẪY 1 — `profile` phải có thật, nếu không slave im lặng

Đây là bẫy **nguy hiểm nhất** vì mọi thứ nhìn từ ngoài đều "xanh". Khi thử một
slave với `profile` không tồn tại, kết quả là:

```text
ERROR bus_worker.profile_not_found bus=1 slave=PROBE_TEST profile=generic — slave KHÔNG được poll
INFO  bus_worker.open bus=1 device=/dev/rs485-1 9600N81 slaves=1 ext=[0..0)
INFO  modbus_master.workers_started count=2
ALARM E302 modbus.slave_config_error bus=1 slave=PROBE_TEST addr=1
```

Chú ý: **cổng vẫn mở**, worker vẫn chạy, service vẫn `active` — nhưng
`ext=[0..0)` (không cấp ô dữ liệu nào) và **`tx` không hề tăng**. Bus hoàn toàn
im lặng mà không có gì gợi ý là do cấu hình.

Profile được tìm theo thứ tự (`device_profile.cpp:299 find_profile_path`) —
**ba** ứng viên, không phải hai:

1. **`<profile>` dùng nguyên văn như một đường dẫn** — nhánh này bản 1.0 của hồ
   sơ bỏ sót, và nó là nhánh mà **backend Go thực tế dùng**.
2. `/data/config/profiles/<id>.json` — của người dùng
3. `/usr/share/kinexus/profiles/<id>.json` — dựng sẵn (**hiện chưa có thư mục này**)

> [!IMPORTANT]
> **Thiết bị tạo qua API/UI KHÔNG dính bẫy này.** `persistence.go:272` ghi
> `profile` là **đường dẫn tuyệt đối** (`/data/config/profiles/<device_id>.json`)
> và `BuildProfile()` sinh sẵn file đó trong cùng thao tác apply, nên nó khớp
> ứng viên 1. Bẫy chỉ áp dụng cho slave khai **bằng tay** trong `fieldbus.conf`
> với một `profile` là id trần không có file tương ứng.
>
> Đọc bản 1.0 (chỉ liệt kê hai ứng viên theo id) rất dễ kết luận nhầm rằng mọi
> thiết bị tạo qua UI đều hỏng — kết luận đó **sai**.

**Trên board hiện chỉ có đúng một profile:** `mtr-1` (`/data/config/profiles/mtr-1.json`).
Muốn đấu thiết bị khác thì phải thêm file profile trước, rồi mới khai slave.

### Schema slave (đọc từ `fieldbus_config.cpp:129 parse_slave`)

| Trường | Bắt buộc | Ràng buộc |
|---|:---:|---|
| `addr` | ✅ | 1..247 — địa chỉ Modbus |
| `profile` | ✅ | phải khớp tên file profile, **không có thì bỏ qua slave** |
| `name` | ✅ | không rỗng |
| `bus_id` | — | 1..255, vắng ⇒ 1 |
| `poll_ms` | — | > 0, vắng ⇒ `poll_default_ms` |
| `timeout_ms` | — | 20..10000 |
| `retry` | — | 0..3 — **số lần phát lại một giao dịch**, > 3 bị clamp về 3 |
| `offline_after_errors` | — | 1..10 — ngưỡng offline, **khác** `retry` |

> [!WARNING]
> `retry` và `offline_after_errors` là hai khái niệm khác nhau (D-05). `retry` là
> số lần phát lại **trong một** giao dịch và chiếm dây; `offline_after_errors` là
> số lượt poll hỏng liên tiếp trước khi đánh dấu thiết bị offline. Đặt `retry=10`
> nghĩa là 10 × 300 ms = 3 giây giữ dây cho **một** block — không chấp nhận được
> trên bus dùng chung, nên code clamp về 3 và ghi WARN.

---

## 6. BẪY 2 — bus 2 chưa có phần cứng, phải tắt trước khi thêm slave

`fieldbus.conf` hiện khai **hai** bus, và `rs485-2` đang `enabled: true` trong khi
`/dev/rs485-2` **không tồn tại** (device tree `uart1` vẫn `disabled`). Ngay khi có
slave đầu tiên được cấu hình, worker bus 2 khởi động và spam liên tục:

```text
ERROR bus_worker.connect_fail bus=2 device=/dev/rs485-2 err=No such file or directory
```

Đo được **~5 dòng/phút** với backoff. Hiện tại chưa spam **chỉ vì** chưa có slave nào.

**Việc team SW cần làm:** đặt `buses[1].enabled = false` **qua API/UI cấu hình
RS-485**, không sửa tay file. Lý do: backend Go tính **checksum canonical**
(`MBR-B206`, `apps/web-api/internal/modbusrtu/canonical.go`) và quản lý `revision`;
hand-edit sẽ làm checksum lệch với nội dung và gây lệch trạng thái khó truy.

Bật lại bus 2 sau khi device tree được vá — quy trình ở
[ENABLE_TTYS1_RS485_2.md](ENABLE_TTYS1_RS485_2.md). **Lưu ý bản vá đó cần hai thay
đổi** (`status` **và** `pinctrl-0` sang `uart1m1_xfer`), không phải một.

---

## 7. Thông số cổng RS-485 #1

| Thông số | Giá trị hiện tại | Ghi chú |
|---|---|---|
| Device | `/dev/rs485-1` → `ttyS5` | |
| Baud | 9600 | đổi được qua cấu hình |
| Khung | 8N1 (`data_bits=8`, `parity=N`, `stop_bits=1`) | |
| `direction` | `auto` | transceiver tự chuyển hướng |
| `offline_probe_ms` | 1000 | |
| Response timeout | 300 ms | `modbus_set_response_timeout` |
| Byte timeout | 50 ms | `modbus_set_byte_timeout` |
| DE/RE | **không có** | kernel không lái; đừng đặt `rs485-*` trong DT |

> [!CAUTION]
> Vì transceiver là loại auto-direction và **chưa đo dạng sóng bằng oscilloscope**,
> baud cao (≥ 19200) cần kiểm chứng thực tế trước khi dùng: mạch auto-direction
> kém có thể cắt bit đầu hoặc bit cuối khung. Ở 9600 rủi ro thấp.

---

## 8. Công cụ kiểm tra: `rs485_check.sh`

Đã cài sẵn trên board tại `/usr/local/bin/rs485_check.sh` (nguồn:
`tools/rs485/rs485_check.sh`). Viết bằng shell thuần vì board Buildroot **không
có** `python3`, `socat`, `mbpoll`.

```bash
# Cổng trỏ đi đâu, mux ra chân nào, có ai đang giữ không
rs485_check.sh info /dev/rs485-1

# Kiểm TX+RX của SoC — nối tắt P16 chân 8 ↔ chân 10 trước khi chạy
rs485_check.sh loopback /dev/rs485-1 9600

# Dò slave thật trên bus A/B
rs485_check.sh scan /dev/rs485-1 9600 1 247
```

`scan` tự tính CRC-16/MODBUS và coi **bất kỳ** khung trả lời nào — kể cả
exception — là bằng chứng cả TX lẫn RX đều thông tới thiết bị thật.

> [!CAUTION]
> `scan` và `loopback` **ghi lên cổng**. Nếu `mkddc-iobus` đang poll bus đó thì
> hai bên tranh dây và cả hai cùng lỗi. Chạy `rs485_check.sh info` trước để xem
> cổng có đang bị giữ không; nếu có, `systemctl stop mkddc-iobus` rồi hãy đo.

---

## 9. Việc còn lại, và ai làm

| # | Việc | Chủ | Chặn bởi |
|---|---|---|---|
| 1 | Đấu slave Modbus RTU thật vào bus A/B; cấp nguồn + mass cho module | **Phần cứng** | cần người tại chỗ |
| 2 | Chạy `rs485_check.sh scan` để chốt end-to-end | Phần cứng | mục 1 |
| 3 | Thêm file profile cho thiết bị sẽ dùng vào `/data/config/profiles/` | **Team SW** | biết thiết bị nào |
| 4 | Khai slave trong cấu hình RS-485 qua API/UI | **Team SW** | mục 3 |
| 5 | Đặt `buses[1].enabled = false` qua API cho tới khi có phần cứng bus 2 | **Team SW** | — |
| 6 | Vá device tree bật `uart1` M1 cho RS-485 #2 | Phần cứng/BSP | cần người tại chỗ, xem `ENABLE_TTYS1_RS485_2.md` |
| 7 | Đo oscilloscope dạng sóng A/B nếu chạy baud ≥ 19200 | Phần cứng | mục 1 |
| 8 | ~~Giao diện phân biệt "chưa từng được poll" với "mất liên lạc"~~ | **Team SW — ĐÃ XONG 2026-08-18** | — |

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.1 | 2026-08-18 | Sửa §5: `find_profile_path` có **ba** ứng viên, ứng viên đầu dùng nguyên `profile` như đường dẫn — đây chính là nhánh backend Go dùng, nên thiết bị tạo qua API/UI không dính bẫy. Bản 1.0 chỉ liệt kê hai ứng viên theo id, dễ dẫn tới kết luận sai rằng mọi thiết bị tạo qua UI đều hỏng. Bổ sung §9 mục 8: giao diện nay phân biệt "chưa từng được poll" với "mất liên lạc" |
| 1.0 | 2026-08-18 | Tạo hồ sơ bàn giao: chốt lớp phần cứng + OS cho RS-485 #1, bật Modbus RTU master trong `mkddc-iobus`, ghi hai bẫy (profile thiếu, bus 2 không có phần cứng) và phân chia việc còn lại |
