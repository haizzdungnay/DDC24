# FW SOM — Runtime API Contract

> **Document ID:** HANDOFF-APICONTRACT-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-07-28
> **Nguồn thực thi:** `apps/core/application/st/st_control_api.hpp`
> **Schema:** [`contracts/config/st_program_control_v1.schema.json`](../../contracts/config/st_program_control_v1.schema.json)

## Bất biến — đọc trước

1. **Mọi request đều nhận lại JSON đúng shape**, kể cả JSON rác, mảng thay vì
   object, hay thiếu field. BE không phải xử lý hai định dạng lỗi.
2. **Mọi response lỗi đều có `keepsRunningPackage`.** BE không bao giờ phải
   đoán chương trình đang chạy có bị ảnh hưởng không.
3. **`requestId` được phản chiếu nguyên văn**, kể cả khi lỗi.
4. **Mọi lỗi giữ nguyên package đang chạy.** Không lệnh nào làm hệ mất điều
   khiển vì gửi sai.

## Shape chung

Request:
```json
{ "version": 1, "requestId": "r-42", "action": "<action>", "instanceId": "ahu1_ctrl" }
```

Response thành công:
```json
{ "version": 1, "requestId": "r-42", "result": "ok", "state": "RUNNING" }
```

Response lỗi:
```json
{ "version": 1, "requestId": "r-42", "result": "error",
  "errorCode": "API-E-004", "message": "cannot start from state EMPTY",
  "keepsRunningPackage": true }
```

## Action

### `program_capabilities` — hỏi trước khi compile

Không cần `instanceId`. **Gọi cái này trước tiên.** Nó cho BE biết nên compile
với profile/ABI nào, thay vì compile xong mới nhận `IR-E-003`/`IR-E-004`.

```json
{ "result": "ok", "interfaceVersion": 1, "artifactSchemaVersion": 1,
  "compilerProfile": 1, "targetAbi": 3841, "compilerVersion": "fwsom-st-1.0.0",
  "maxArtifactBytes": 1048576, "maxTasks": 8, "maxProgramsPerTask": 16,
  "baseTickMs": 50 }
```

### `program_status` — trạng thái toàn bộ

Không cần `instanceId`. Trả cây `tasks[] → programs[]`.

Ba trường BE nên dùng thường xuyên:

- **`artifactSha256`** — xác minh cái đang chạy **đúng là** cái mình gửi.
  Đừng tin lời runtime, so hash.
- **`lastFault`** — có `code` (`ST-RT-*`), `pc`, và **`line` trong source ST
  gốc**. Đủ để hiển thị cho người viết chương trình mà không cần tra cứu.
- **`forcingSafeState`** / **`anyForcingSafeState`** — task đang ép safe-state
  vì overrun. Đây là tín hiệu cần báo động, không phải thông tin phụ.

### `program_stage` — nạp artifact

```json
{ "action": "program_stage", "instanceId": "ahu1_ctrl", "artifact": "<base64>" }
```

Trả `appliedAt: "next_tick_boundary"`. **BE không được kết luận "đã chạy" khi
stage xong** — activation áp ở ranh giới tick kế. Gọi `program_status` để biết
kết quả thật.

Artifact hỏng vẫn `stage` được; **verify xảy ra lúc activation**, và thất bại
ở đó giữ nguyên package cũ.

### Lệnh vòng đời

| Action | Từ trạng thái | Tới |
|---|---|---|
| `program_start` | `ACTIVE`, `STOPPED`, `ROLLED_BACK` | `RUNNING` |
| `program_stop` | `RUNNING` | `STOPPED` |
| `program_enable` | `DISABLED` | `STOPPED` |
| `program_disable` | bất kỳ | `DISABLED` |
| `program_reset` | `FAULTED` | `STOPPED` |
| `program_rollback` | có last-known-good | `ROLLED_BACK` |

Chuyển trạng thái không hợp lệ → `API-E-004`, **không** crash, **không** đổi gì.

## Ba điều dễ hiểu nhầm

**`stop` KHÔNG đưa đầu ra về safe-state.** Nó là hành động vận hành có chủ ý.
Muốn đầu ra an toàn thì dùng safe-state hoặc lệnh ghi tường minh. Khi **mọi**
instance đều dừng, tầng Resource tự nhận ra "không ai điều khiển" và áp
safe-state — đó mới là chỗ xử lý việc đó.

**`rollback` đi lại đúng đường verify.** Nó không phải cửa sau bỏ qua kiểm tra.
Nếu package tốt trước đây nay không load được (ví dụ đã đổi ABI runtime), lệnh
này **thất bại** và instance chuyển `FAULTED` — thà biết ngay còn hơn chạy một
thứ chưa được kiểm.

**Last-known-good chỉ được ghi nhận sau khi package chạy ≥1 tick không fault.**
Package vừa activate mà chưa chạy lần nào **không** đủ tư cách làm mốc rollback.

## Ví dụ end-to-end

```
1. program_capabilities                    -> profile/ABI để compile
2. mkddc-st-compile --source p.st          -> artifact base64
3. program_stage    (artifact)             -> STAGED, appliedAt=next_tick_boundary
4. program_status                          -> ACTIVE
5. program_start                           -> RUNNING
6. program_status                          -> runCount tăng, artifactSha256 khớp
7. (sự cố) program_status                  -> FAULTED + lastFault.line
8. program_reset                           -> STOPPED
9. program_rollback                        -> ROLLED_BACK
10. program_start                          -> RUNNING
```
