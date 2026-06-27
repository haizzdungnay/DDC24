# 20 — Virtual COM Decision for No-Board Dev
## MK-DDC-24 — Chốt cách giả lập UART/IOP khi chưa có hardware thật

> **Document ID:** IMPL-VCOM-DECISION-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-11
> **Trạng thái:** Active — dùng ngay cho dev SOM khi chưa có board
> **Đối tượng đọc:** Dev 2 (`mkddc-iobus`, `mkddc-core`), Tester, Lead

---

## 1. Kết luận ngắn

**Có. Dùng `socat` + PTY. Không dùng `tty0tty` làm mặc định cho dự án.**

Mục tiêu hiện tại:
- chưa có hardware thật
- vẫn phải test được `mkddc-iobus`
- vẫn phải đi đúng flow dự án: `fake_mcu <-> UART/IOP <-> mkddc-iobus <-> SHM <-> mkddc-core`

Giải pháp đúng nhất cho giai đoạn này:
- tạo **2 cổng serial ảo kiểu PTY**
- bridge chúng với nhau bằng `socat`
- cho `mkddc-iobus` mở 1 đầu
- cho `fake_mcu` hoặc tool test mở đầu còn lại

---

## 2. Vì sao chốt `socat`

### 2.1 Khớp roadmap docs hiện tại

Docs đã chốt flow dev không có board bằng **fake MCU qua PTY**:
- [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) §11 / checklist §11.1
- [16_QUICK_START_SOM_DEV.md](16_QUICK_START_SOM_DEV.md) §5
- [03_PHASE_PLAN.md](03_PHASE_PLAN.md) Phase 2

Nói ngắn:
- dự án đang chuẩn hóa trên **PTY**
- không chuẩn hóa trên `/dev/tnt*`

### 2.2 Khớp cách `mkddc-iobus` làm việc thật

IOP của dự án là UART raw:
- `921600`
- `8N1`
- `termios raw`
- `O_RDWR | O_NOCTTY | O_NONBLOCK`

Nguồn-chuẩn:
- [05_IOP_UART_IMPLEMENTATION_GUIDE.md](05_IOP_UART_IMPLEMENTATION_GUIDE.md) §1
- [shared/iop_protocol.h](../../shared/iop_protocol.h)

PTY do `socat` tạo ra đủ gần với cách mở `/dev/ttyS2` để test protocol/frame/timeout/retry/CRC.

### 2.3 Có sẵn trên máy dev Linux, nhẹ, không cần kernel module

Ưu điểm:
- cài rất dễ
- không phụ thuộc kernel module ngoài cây chính
- không phải rebuild sau kernel update
- hợp CI/local dev hơn `tty0tty`

### 2.4 Dễ script hóa

Có thể viết script kiểu:
- tạo 2 PTY cố định
- in ra đường dẫn
- start `fake_mcu`
- start `mkddc-iobus`

Dev mới nhìn 1 command là chạy được.

---

## 3. Vì sao KHÔNG chọn `tty0tty` làm mặc định

`tty0tty` không bị cấm. Nhưng **không phải lựa chọn mặc định** cho repo này.

Lý do:
- docs hiện tại không dùng nó làm flow chuẩn
- phải build/load kernel module
- tăng rủi ro setup máy dev
- không cần thiết cho phase no-board hiện tại

Chỉ cân nhắc `tty0tty` khi:
- có tool legacy bắt buộc cần cặp port kiểu cố định `/dev/tnt0`, `/dev/tnt1`
- PTY không đủ cho case test cụ thể
- lead chấp thuận mở thêm support path

Nếu không có 3 điều trên: **không dùng `tty0tty`.**

---

## 4. Mô hình chuẩn dev không có board

```text
[fake_mcu hoặc test tool]
          ^
          | PTY B
          |
      [socat bridge]
          |
          | PTY A
          v
[mkddc-iobus] -> /dev/shm/mkddc_io_shm -> [mkddc-core] -> core.sock -> [mkddc-web]
```

Quy tắc:
- `mkddc-iobus` chỉ mở **1 đầu serial ảo**
- `fake_mcu` chỉ mở **đầu còn lại**
- web **không** mở serial
- core **không** mở serial

---

## 5. Cách chạy chuẩn bằng `socat`

### 5.1 Tạo 2 COM ảo

```bash
socat -d -d \
  PTY,raw,echo=0,link=/tmp/mkddc-iop-a \
  PTY,raw,echo=0,link=/tmp/mkddc-iop-b
```

Kết quả:
- `/tmp/mkddc-iop-a`
- `/tmp/mkddc-iop-b`

Hai port này nối với nhau như cáp null-modem ảo.

### 5.2 Nối service dự án vào 1 đầu

```bash
./build/iobus/mkddc-iobus --uart /tmp/mkddc-iop-a --log-level debug
```

### 5.3 Nối emulator/test tool vào đầu còn lại

Ví dụ:

```bash
./build/iobus/fake_mcu --uart /tmp/mkddc-iop-b
```

Nếu `fake_mcu` chỉ hỗ trợ `--pty` riêng, vẫn được phép dùng flow docs cũ:

```bash
./build/iobus/fake_mcu --pty
./build/iobus/mkddc-iobus --uart /dev/pts/N --log-level debug
```

Nhưng cho dev mới, ưu tiên **2 đường dẫn cố định `/tmp/mkddc-iop-*`** vì dễ đọc, dễ script, dễ debug hơn.

---

## 6. Kỳ vọng tối thiểu khi chạy đúng

Sau khi nối đúng, dev phải thấy được ít nhất các mốc này:

1. `HANDSHAKE` pass
2. `GET_IO -> IO_RESP` lặp ổn định
3. `kx_io_shm` có `magic`, `seq`, `ts_ns` thay đổi
4. ghi `do_cmd[0]=1` từ core/test → `mkddc-iobus` gửi `SET_DO`
5. `fake_mcu` trả `ACK`
6. `DO_FB` phản ánh lại ở `IO_RESP`

Checklist gốc:
- [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) §11.1

---

## 7. Những thứ dev mới hay hiểu sai

### Sai 1 — “cần phần mềm COM ảo kiểu Windows”

Không.

Trên Linux, thứ cần là:
- `PTY`
- `tty`
- `termios raw`

Không cần cố bắt Linux phải giống `COM1/COM2` của Windows.

### Sai 2 — “web hoặc core cũng có thể mở port serial”

Sai.

Luồng đúng:
- chỉ `mkddc-iobus` mở UART/serial
- `mkddc-core` đọc/ghi SHM
- `mkddc-web` nói chuyện qua IPC/API

Nguồn-chuẩn:
- [00_IMPLEMENTATION_README.md](00_IMPLEMENTATION_README.md) §5, §6, §7

### Sai 3 — “dùng `tty0tty` chắc chuyên nghiệp hơn”

Không hẳn.

Trong dự án này, “đúng” quan trọng hơn “trông có vẻ xịn”.
Roadmap docs đang bám PTY + fake MCU, nên `socat` mới là lựa chọn đúng mặc định.

---

## 8. Khi nào được phép đổi quyết định này

Chỉ đổi khỏi `socat` khi có bằng chứng cụ thể:

1. PTY không tái hiện được bug/protocol behavior cần test
2. Có tool bắt buộc dùng `tty0tty` hoặc thiết bị serial class khác
3. Lead cập nhật docs chuẩn và test plan tương ứng

Nếu chưa có 3 điều đó: **giữ `socat`.**

---

## 9. Quyết định chính thức

**Rev A, giai đoạn chưa có hardware thật:**

- mặc định dùng `socat` để tạo bridge giữa 2 serial ảo kiểu PTY
- `mkddc-iobus` nối 1 đầu
- `fake_mcu` hoặc test tool nối đầu còn lại
- `tty0tty` không phải đường chuẩn của dự án

Đây là lựa chọn dev/test chính thức cho:
- local development
- no-board bring-up
- fake MCU integration test

---

## 10. Lệnh copy-paste cho dev

```bash
# Terminal 1: tạo cặp serial ảo
socat -d -d \
  PTY,raw,echo=0,link=/tmp/mkddc-iop-a \
  PTY,raw,echo=0,link=/tmp/mkddc-iop-b

# Terminal 2: chạy iobus
./build/iobus/mkddc-iobus --uart /tmp/mkddc-iop-a --log-level debug

# Terminal 3: chạy fake MCU hoặc tool test
./build/iobus/fake_mcu --uart /tmp/mkddc-iop-b
```

Nếu chưa có `fake_mcu` thật trong repo, task kế tiếp là tạo `tools/fake_mcu/` theo contract ở
[06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) §11.

---

**Rev** 1.0 | 2026-06-11

