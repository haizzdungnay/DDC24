# Kho Test Result Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-TR-REPO-001` |
| Trạng thái | **ACTIVE — 2/32 record, 0/32 PASS, 2/32 BLOCKED** |
| Ngày tạo | 2026-08-10 |
| Chủ quản | Verification Lead + Document Control |
| Phạm vi | `VS-PROG-001..032` của `VVP-PROG-001` |
| Mẫu bắt buộc | [`RESULT_TEMPLATE.md`](RESULT_TEMPLATE.md) |

## 1. Mục đích và ranh giới

Thư mục này là nơi lưu Test Result bất biến cho Programming Rev A. Sự tồn tại
của README và template chỉ chứng minh **kho bằng chứng đã được chuẩn bị**; không
chứng minh scenario nào đã PASS. Trạng thái hiện hành sau review G1:

```text
Test Result record  = 2/32
PASS               = 0/32
FAIL               = 0/32
BLOCKED record      = 2/32
```

Không sao chép kết quả host regression, mock UI hoặc báo cáo cũ vào đây để đổi
`VS-PROG-*` thành PASS. Mỗi record phải chạy đúng candidate source/contract,
fixture và ngưỡng đã được phê duyệt của scenario đó.

| Scenario | Record hiện hành | Verdict | Điều kiện mở |
|---|---|---|---|
| `VS-PROG-001` | [`TR-PROG-001-20260811-001`](TR-PROG-001-20260811-001/result.md) | `BLOCKED` | `TASK-PROG-204`: wiring service, functional tag, export/import và restart BE round-trip |
| `VS-PROG-019` | [`TR-PROG-019-20260811-001`](TR-PROG-019-20260811-001/result.md) | `BLOCKED` | Compiler/Check/API/UI ở P2/P5 và independent QA review |

## 2. Cấu trúc bắt buộc

Mỗi lần chạy tạo một thư mục mới, không sửa đè lần chạy trước:

```text
docs/07_records/test-results/programming/
└── TR-PROG-<VS>-<YYYYMMDD>-<SEQ>/
    ├── result.md
    ├── raw/
    │   └── <log, json, csv, pcap, waveform, screenshot hoặc video index>
    └── SHA256SUMS
```

- `<VS>` là ba chữ số, ví dụ `001`.
- `<SEQ>` bắt đầu từ `001` trong ngày và tăng khi rerun.
- `result.md` dùng toàn bộ field trong [`RESULT_TEMPLATE.md`](RESULT_TEMPLATE.md).
- `raw/` giữ output gốc; không chỉ giữ ảnh chụp phần đã chọn.
- `SHA256SUMS` bao phủ `result.md` và mọi file trong `raw/`.

## 3. Trạng thái và vòng đời

Giá trị hợp lệ: `NOT_RUN`, `RUNNING`, `PASS`, `FAIL`, `BLOCKED`, `INVALIDATED`.

```text
PLANNED → READY → RUNNING → PASS | FAIL | BLOCKED
                         PASS/FAIL → INVALIDATED khi baseline chịu ảnh hưởng
```

- Rerun luôn tạo `TR-ID` mới; record cũ giữ nguyên.
- Design/contract/source/fixture/calibration đổi thì impact analysis xác định
  record nào phải `INVALIDATED`; không xóa evidence cũ.
- Chỉ Verification Lead hoặc authority ghi trong scenario mới được chấp nhận
  verdict; người tạo file không tự ký thay reviewer.
- Trace và Risk chỉ cập nhật `P/R/residual` sau khi record được review.

## 4. Quy trình ghi bằng chứng

### Trước khi chạy

1. Ghim requirement/design/contract/source commit và artifact hash.
2. Xác nhận scenario, expected limit, fixture, calibration, quyền thao tác và
   rollback/stop trigger đã được authority chấp thuận.
3. Tạo `TR-ID`, sao chép template thành `result.md`, điền `RUNNING` và thời gian
   bắt đầu có timezone.
4. Không chạy output thật nếu HW/Safety limit còn `TARGET-PENDING`.

### Sau khi chạy

1. Lưu output thô, metric, state transition và fault injection vào `raw/`.
2. Điền Actual/Verdict/limitation; không xóa dữ liệu làm xấu kết quả.
3. Từ trong thư mục `TR-ID`, tạo và kiểm checksum:

```bash
find result.md raw -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
sha256sum --check SHA256SUMS
```

4. Independent reviewer ghi kết luận và revision đã review.
5. Cập nhật `TRACE-PROG-001`, `RSK-PROG-001`, Plan 53/Roadmap và CHANGELOG trong
   cùng thay đổi nếu verdict ảnh hưởng gate.

## 5. Checklist chấp nhận một record

| Mã | Điều kiện | Thiếu thì |
|---|---|---|
| `TR-01` | `TR-ID`, VS và requirement tồn tại, không trùng | `INVALIDATED` |
| `TR-02` | Commit/artifact/config/schema hash đầy đủ | `BLOCKED` |
| `TR-03` | Board/fixture/instrument/calibration xác định được | `BLOCKED` |
| `TR-04` | Expected định lượng được phê duyệt trước execution | `BLOCKED` |
| `TR-05` | Actual có raw metric/state/error, start/end/timezone | `FAIL` hoặc `BLOCKED` theo scenario |
| `TR-06` | Positive/negative/fault path đúng VVP | Không được PASS |
| `TR-07` | `SHA256SUMS` phủ toàn bộ record và kiểm lại PASS | `INVALIDATED` |
| `TR-08` | Executor và independent reviewer xác định được | Chưa được dùng mở gate |
| `TR-09` | Deviation/limitation/risk/trace được đồng bộ | Chưa được dùng mở gate |
| `TR-10` | Record cũ không bị sửa đè | `INVALIDATED` và mở finding cấu hình |

## 6. Kiểm soát truy cập và dữ liệu nhạy cảm

- Không lưu private key, password, cookie, token, secret header hoặc dữ liệu
  người dùng vào raw evidence.
- Log phải che secret nhưng giữ request ID, operation ID, timestamp và error code
  cần cho correlation.
- Video/ảnh usability phải ẩn danh; quyền đồng ý của người tham gia được lưu ở
  hệ thống kiểm soát phù hợp, không đưa thông tin cá nhân vào repository.
- Evidence lớn có thể lưu ở kho controlled khác, nhưng `result.md` phải ghi URI,
  retention, quyền truy cập và checksum bất biến.

## 7. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-10 | Tạo kho và quy tắc Test Result Programming; giữ số thật 0/32 |
| 1.1 | 2026-08-11 | Ghi hai execution record G1 cho `VS-PROG-001/019` với verdict trung thực `BLOCKED`: phần contract/store host đạt nhưng workflow E2E chưa implement; giữ 0/32 PASS |
