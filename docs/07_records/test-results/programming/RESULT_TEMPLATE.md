# Mẫu Test Result Programming

> Đây là **template**, không phải Test Result và không được dùng mở gate. Khi
> chạy test, sao chép file này thành `<TR-ID>/result.md`, thay toàn bộ placeholder
> và thêm raw evidence cùng `SHA256SUMS`.

| Trường | Giá trị |
|---|---|
| Test Result ID | `TR-PROG-<VS>-<YYYYMMDD>-<SEQ>` |
| Scenario | `VS-PROG-<NNN>` |
| Requirement | `<ID + section>` |
| Trạng thái | `RUNNING` |
| Thời gian bắt đầu | `<ISO-8601 + timezone>` |
| Thời gian kết thúc | `<ISO-8601 + timezone>` |
| Người thực hiện | `<vai trò + định danh>` |
| Independent reviewer | `<vai trò + định danh hoặc PENDING>` |

## 1. Baseline bất biến

| Đối tượng | Revision/hash |
|---|---|
| Product/Requirement | `<ID, version, section>` |
| Architecture/Design | `<ID, version, section>` |
| Contract/schema | `<path, version, SHA-256>` |
| Source commit/tree | `<full Git commit + tree>` |
| Build/package/artifact | `<ID, SHA-256, provenance>` |
| Config/feature flag | `<path/revision/hash + effective value>` |

## 2. Môi trường và fixture

| Trường | Giá trị |
|---|---|
| Cấp test | `H` host / `B` browser / `T` target / `L` HIL |
| Host/OS/tool version | `<giá trị>` |
| Board serial/BOM/revision | `<giá trị hoặc N/A có lý do>` |
| Firmware/service version | `<giá trị>` |
| Instrument/calibration | `<ID, range, uncertainty, calibration expiry>` |
| Test data/seed | `<ID/hash>` |
| Precondition | `<state/config/health>` |
| Quyền thực hiện | `<role/RBAC>` |
| Rollback/stop trigger | `<điều kiện + người quan sát>` |

## 3. Expected đã duyệt trước execution

| Acceptance | Expected định lượng | Authority/revision |
|---|---|---|
| `<AC-01>` | `<limit/state/error/timing>` | `<người + record>` |

Không sửa Expected sau khi nhìn Actual. Nếu expected sai hoặc thiếu, verdict là
`BLOCKED`; sửa baseline rồi chạy lại bằng `TR-ID` mới.

## 4. Procedure và fault injection

| Bước | Lệnh/thao tác | Fault/đầu vào | Expected tại bước |
|---:|---|---|---|
| 1 | `<command/action>` | `<normal/fault>` | `<observable result>` |

## 5. Actual

| Acceptance | Actual metric/state/error | Raw evidence | Kết luận |
|---|---|---|---|
| `<AC-01>` | `<min/max/p95/count/transition>` | `raw/<file>` | `PASS/FAIL/BLOCKED` |

Ghi lại mọi retry, timeout, crash, recovery, warning, deviation và dữ liệu bị
loại. Không thay `UNKNOWN/stale/offline` bằng zero hoặc giá trị giả.

## 6. Verdict

| Trường | Giá trị |
|---|---|
| Verdict tổng | `PASS` / `FAIL` / `BLOCKED` / `INVALIDATED` |
| Rationale | `<đối chiếu từng acceptance>` |
| Known limitation | `<owner, impact, gate, unlock>` |
| Deviation | `<ID/authority/expiry hoặc NONE>` |
| Risk impact | `<RSK-PROG-* + residual không tự giảm>` |
| Trace update | `<TRACE row + D/I/T/P/R dự kiến>` |

## 7. Integrity và review

| Trường | Giá trị |
|---|---|
| Raw evidence path | `raw/` |
| Checksum manifest | `SHA256SUMS` |
| `sha256sum --check` | `<PASS + timestamp>` |
| Executor kết luận | `<người/ngày/revision>` |
| Independent review | `PENDING` / `ACCEPT` / `REQUEST_CHANGE` / `REJECT` |
| Review record | `<link/ID>` |

Một verdict kỹ thuật chưa có independent review không được dùng mở G1..G6 hay
đổi residual risk. Approval phải ghi đúng `TR-ID`, source commit và checksum.
