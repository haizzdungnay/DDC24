# Programming IPC v1 — BE ↔ Core

| Thuộc tính | Giá trị |
|---|---|
| Contract | `programming_v1` |
| Protocol | major `1`, minor `0`, schema `1.0` |
| Transport | Unix domain socket `${RUNTIME_DIR}/mkddc/programming-v1.sock` |
| Frame | `uint32 little-endian length` + canonical CBOR |
| Giới hạn | payload frame `<= 65536` byte; queue `<= 32` |
| Security | mode `0660`; hai phía kiểm `SO_PEERCRED` |
| Feature flag | `PROGRAMMING_REV_A` mặc định `OFF` |

## 1. Quyền sở hữu và ranh giới

Core là server và authority của active/LKG/read-back. BE là client/coordinator;
BE không suy active state từ database Web. IPC chạy ở worker non-RT, không được
block ScanLoop hoặc làm thay đổi output trong `TASK-PROG-101`.

Frame sai length, quá 64 KiB, CBOR indefinite/tagged, major lạ, deadline hết,
payload hash sai hoặc peer UID sai đều fail-closed trước action. Mất client,
timeout hoặc restart BE không đổi Revision đang chạy. Mutation không được replay;
BE chỉ gọi `OPERATION_STATUS` qua `Client.Reconcile`.

## 2. Request array

CBOR array cố định tránh khác biệt thứ tự key giữa Go và C++:

| Index | Field | Kiểu / giới hạn |
|---:|---|---|
| 0 | `protocolMajor` | `u16`, phải bằng `1` |
| 1 | `protocolMinor` | `u16`, Rev A hỗ trợ `0` |
| 2 | `schemaVersion` | text `1.0` |
| 3 | `requestId` | byte string đúng 16 byte |
| 4 | `operationId` | byte string 16 byte hoặc `null`; bắt buộc cho mutation |
| 5 | `controllerId` | UTF-8 1..64 |
| 6 | `actorId` | UTF-8 0..128; mutation bắt buộc có |
| 7 | `deadlineMonoNs` | `u64 CLOCK_MONOTONIC`, khác zero |
| 8 | `payloadHash` | SHA-256 đúng 32 byte của index 11 |
| 9 | `action` | enum ở §4 |
| 10 | `correlationId` | `[A-Za-z0-9._-]`, 16..64 |
| 11 | `payload` | byte string chứa CBOR action array `<= 32768` byte |

## 3. Response array

| Index | Field | Kiểu / semantics |
|---:|---|---|
| 0..4 | protocol/schema/request/operation | echo theo request đã chấp nhận |
| 5 | `correlationId` | echo nguyên vẹn |
| 6 | `result` | `OK/STAGED/ACCEPTED/REJECTED/UNAVAILABLE/BUSY` |
| 7 | `activeRevisionId` | text hoặc `null`; chỉ read-back thật |
| 8 | `lkgRevisionId` | text hoặc `null`; chỉ read-back thật |
| 9 | `keepsRunning` | `true` khi lỗi IPC không dừng active Revision |
| 10 | `detailCode` | component detail hoặc `null`; BE map sang public code |
| 11 | `component` | producer detail, ví dụ `core.programming.ipc` |
| 12 | `payload` | byte string CBOR action response array |

## 4. Action và operation

`CAPABILITIES`, `STATUS`, `OPERATION_STATUS` là read-only. `STAGE`, `ACTIVATE`,
`RESTORE`, `TRACE_START`, `RETAIN_RESET` là mutation và phải có
`operationId/actorId`. `TASK-PROG-101` chỉ trả capability skeleton; các action
còn lại trả `UNAVAILABLE` với `keepsRunning=true`, không stage/swap/reset.

Duplicate `requestId` cùng frame trả đúng response cache; cùng `requestId` khác
frame trả `REJECTED/IPC-REQUEST-ID-CONFLICT`. Queue đạt 32 trả
`BUSY/IPC-QUEUE-FULL`. Deadline hết trả `REJECTED/IPC-DEADLINE`.

### 4.1 Intent Enable đi cùng ACTIVATE (ADR-062)

Payload ACTIVATE là `[expectedActive, stagedToken, cutover, planHash, programIntents?]`.
Phần tử thứ năm `programIntents = [[instanceId, desiredEnabled], ...]` (≤ 32) là
**tuỳ chọn**. Nó mang intent đã lưu ở `program_runtime_intents` tới đúng safe
boundary kích hoạt gói. Nhờ vậy Program có intent Enable chạy ngay trong boundary
đó, không scan nào rơi vào `no_ctrl` (F13).

Không nâng `protocolMinor`: web cũ từ chối response có minor cao hơn hằng của nó,
nên nâng minor ở Core sẽ cắt đứt web cũ. Core mới công bố tính năng ở phần tử
thứ năm của payload CAPABILITIES: `features` chứa `"ACTIVATE_PROGRAM_INTENTS"`.
Web mới gọi CAPABILITIES trước mỗi ACTIVATE và chỉ gửi 5 phần tử khi thấy tính
năng này. Core mới vẫn nhận payload 4 phần tử của web cũ.

Luật áp ở Core và bảng tương thích bốn tổ hợp phiên bản ở
[`ADR-062`](../../../docs/adr/ADR-062-programming-intent-enable-di-cung-activate.md).
Golden `request_activate_program_intents.hex` khoá chuỗi byte chung của Go và C++.

## 5. Golden corpus và deploy

`golden/*.hex` chứa toàn frame, gồm 4 byte length. Go và C++ phải decode và
encode lại byte-identical. Tệp `.json` chỉ là manifest dễ đọc, không phải wire.

Deploy Core hỗ trợ v1 trước, sau đó BE; chỉ minor được contract test mới chấp
nhận. Rollback BE trước Core. Không hạ Core qua protocol/artifact major đang
active và không xóa operation state. Flag Programming giữ `OFF` ở production.
