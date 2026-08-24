# Contract lock Plan 59 — POU, Published Signal và prepared-state

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN59-CONTRACT-LOCK-2026-08-24` |
| Phiên bản | 1.0 |
| Trạng thái | Active — khoá trước khi code |
| Base commit | `44448ea` (main, clean) |
| Authority | `ADR-050`; `DDD-SW-PROG-UNIFIED-001` §4.2/§4.4/§4.5/§5.3/§6/§7 |
| Lý do | Ba finding P0 chạm cùng một tập file IR/package/scheduler. Không khoá một
  hợp đồng duy nhất thì mỗi lane sẽ tự chế một hợp đồng và ba bản sẽ trôi khỏi nhau. |

## 0. Baseline đo thật tại `44448ea`

| Hạng mục | Số đo |
|---|---|
| `ctest` (Release, MODBUS+BACNET+HMI=ON) | 1243/1243 PASS |
| Task `T59-*` unique trong Plan 59 | 52 |
| Worktree `DDC-W6` | sạch, 0 commit ahead `main` |
| Nhánh làm việc | `feat/plan59-pou-signal-atomic` từ `main@44448ea` |

## 1. `CT-1` — Thi hành user FUNCTION / FUNCTION_BLOCK

### 1.1 Cơ chế: inline lowering, KHÔNG call frame

Chọn inline vì bốn ràng buộc đã có hiệu lực và không được đánh đổi:

1. `st_exec` cấm cấp phát và cấm cấu trúc động trong đường quét SCHED_FIFO;
   một ngăn xếp lời gọi là cấu trúc động có độ sâu phụ thuộc dữ liệu.
2. `st_loader` chứng minh **mọi** slot và mọi đích nhảy nằm trong biên trước khi
   chạy. Inline giữ nguyên tính chất đó; call frame buộc phải kiểm biên lúc chạy.
3. Đệ quy đã bị `st_build_pou_registry` chặn (`ST-POU-003`), nên đồ thị gọi là
   DAG hữu hạn và inline luôn kết thúc.
4. WCET phải có chặn trên tĩnh. Inline cho chặn trên là tổng số lệnh sau khi mở.

Bùng nổ kích thước mã được chặn bằng trần `kMaxInstructions` của profile: vượt
trần là lỗi Check (`ST-POU-004`), không phải hành vi lúc chạy.

### 1.2 Ngữ nghĩa

| Kind | State | Được gọi | Được chạm I/O | RETAIN |
|---|---|---|---|---|
| `FUNCTION` | không | `FUNCTION` thuần | không | không |
| `FUNCTION_BLOCK` | riêng từng instance | `FUNCTION`, FB chứa trong | không | có, nếu khai |
| `PROGRAM` | riêng | cả hai | có | có |

- `FUNCTION`: mỗi call site cấp một khối slot tạm riêng, khởi tạo lại ở **mỗi**
  lần gọi. Không giữ giá trị giữa hai lần gọi — đó là định nghĩa của thuần.
- `FUNCTION_BLOCK`: mỗi **instance** cấp một khối slot bền trong không gian slot
  của Program chủ. Slot biến sống qua chu kỳ (đúng cơ chế đang dùng cho biến
  Program và FB dựng sẵn), nên state từng instance có được mà không thêm máy móc.
- Tham số vào gán vào slot vào của khối trước khi thân chạy; `FUNCTION` ghi kết
  quả vào slot trả về; đọc output FB qua `MEMBER`.

### 1.3 Mã lỗi ổn định

| Mã | Nghĩa |
|---|---|
| `ST-POU-001` | tên/kind/chữ ký sai (đã có) |
| `ST-POU-002` | `FUNCTION` không thuần (đã có) |
| `ST-POU-003` | đệ quy trực tiếp/gián tiếp (đã có) |
| `ST-POU-004` | **mới** — mở inline vượt trần lệnh/slot của profile |
| `ST-POU-005` | **mới** — kiểu đối số/kiểu trả về không khớp chữ ký |
| `ST-LIB-001` | gọi tên không phân giải được (đã có) |
| `ST-LIB-002` | lệch version library đã pin (đã có) |

### 1.4 `CT-1a` — Hợp đồng CLI compiler (biên Go ↔ C++)

`mkddc-st-compile` giữ nguyên mọi cờ hiện có. Thêm **hai cờ tuỳ chọn**:

```
--pou-manifest <path>   JSON, tập POU phụ thuộc để link
--library-lock <path>   JSON, khoá version SYSTEM/PROJECT library
```

`pou-manifest` schema 1:

```json
{
  "schemaVersion": 1,
  "pous": [
    { "name": "SCALE_LIN", "kind": "FUNCTION", "language": "ST", "path": "pou-00.src",
      "contentSha256": "<hex64>" }
  ]
}
```

- `path` **phải** nằm trong cùng thư mục job; đường dẫn tuyệt đối, `..` và
  symlink bị từ chối (`ST-CLI-POU-PATH`).
- `kind` chỉ nhận `FUNCTION` hoặc `FUNCTION_BLOCK`. `PROGRAM` trong manifest là
  lỗi: entry PROGRAM đi qua `--source` như cũ.
- Thiếu file, sai `contentSha256`, hoặc trùng `name` (case-folded) là lỗi
  `ST-CLI-POU-MANIFEST`.

`library-lock` schema 1:

```json
{
  "schemaVersion": 1,
  "systemVersion": "1.0.0",
  "projectRevisionId": "<uuid|empty>",
  "entries": [ { "name": "TON", "kind": "FUNCTION_BLOCK", "version": "1.0.0" } ]
}
```

Envelope kết quả compile thêm mảng **`linkedPous`** (sắp theo `name` case-folded):

```json
"linkedPous": [ { "name": "SCALE_LIN", "kind": "FUNCTION", "contentSha256": "<hex64>",
                  "instructionCount": 12, "fromLibrary": false } ]
```

Không có `--pou-manifest` ⇒ `linkedPous` là mảng rỗng và mọi `USER_CALL` chưa
phân giải bị từ chối bằng `ST-LIB-001`. Đây là đường tương thích ngược: golden và
fuzz T59-106 hiện hữu không đổi byte.

### 1.5 `CT-1b` — Package v2 mang POU thật

`SEC_POU_TABLE` (0x0001) mang **đủ** bản ghi cho mọi POU đã link, không chỉ
PROGRAM. Mỗi bản ghi: `name`, `kind`, `from_library`, chữ ký (kiểu đối số + kiểu
trả về), `body_sha256` (32 byte, canonical của thân đã lower) và
`instruction_count`. Thân đã inline nằm trong `SEC_CODE_IR` của Program chủ —
không nhân bản thân POU thành một bản thứ hai để trôi khỏi bản đang chạy.

`SEC_LIBRARY_LOCK` (0x000A) bắt buộc có mặt khi có bất kỳ POU `from_library=true`.
Loader từ chối package có POU library mà thiếu lock (`PKG-E-011`).

## 2. `CT-2` — Published Signal có producer/consumer thật

### 2.1 Opcode mới

| Opcode | Giá trị | Trường | Nghĩa |
|---|---|---|---|
| `SIG_PUB` | `0x82` | `aux`=chỉ số signal ref, `a`=slot giá trị, `type` | Publish vào write buffer |
| `SIG_READ` | `0x83` | `aux`=chỉ số signal ref, `dst`=slot đích, `type` | Đọc committed snapshot |

`aux` là chỉ số vào bảng `signal_refs` của **chính artifact**, không phải tên.
Tra tên trong đường quét là thứ `st_exec` cấm.

### 2.2 Bảng `signal_refs` trong IR

Bảng mới trong artifact IR v1, schema tăng lên 2 (loader giữ đường đọc schema 1):

| Field | Kiểu | Ràng buộc |
|---|---|---|
| `name` | chuỗi 1..64 | identifier, case-folded unique trong artifact |
| `type` | `StType` | phải khớp khai báo signal trong package |
| `is_producer` | bool | true = Program này publish; đúng một producer/signal |

Phân giải tên → chỉ số bus xảy ra **một lần lúc prepare**, kết quả nằm ở
`StLoadedProgram::signal_slots` (vector chỉ số `int32`, `-1` = chưa phân giải).

### 2.3 Ngữ nghĩa lúc chạy

- `SIG_PUB` ghi vào **write buffer**. Consumer không thấy cho tới boundary kế.
- `SIG_READ` đọc **committed snapshot** — bản đã swap ở đầu base step. Trong một
  chu kỳ, mọi consumer thấy cùng một ảnh bất kể lane nào chạy trước.
- Ba chính sách theo DDD §7.3, ánh xạ 1-1 sang enum runtime đang có:

| DDD | `StStalePolicy` | Kết quả `SIG_READ` |
|---|---|---|
| `HOLD_PRIVATE` | `HOLD_LAST` | giữ nguyên slot đích, trạng thái `STALE_HELD`, chạy tiếp |
| `USE_FALLBACK` | `USE_FALLBACK` | nạp fallback đã khai, `STALE_FALLBACK`, chạy tiếp |
| `BLOCK_PROGRAM` | `WAIT` | **dừng chu kỳ**, Program → `WAITING`, rút candidate |

- Signal chưa từng publish, hoặc bus chưa phân giải: xử như quá hạn theo đúng ba
  chính sách trên. **Không** thay bằng 0.
- Signal đọc mà `NOT_DECLARED` là lỗi prepare, không phải hành vi lúc chạy.

### 2.4 Kết quả thực thi

`execute_st_program` giữ nguyên chữ ký. Thêm `execute_st_program_ex` trả

```cpp
enum class StExecOutcome : uint8_t { OK = 0, FAULT = 1, BLOCKED = 2 };
```

`BLOCKED` **không phải** fault: không tăng bộ đếm fault, không rollback package,
không đổi Active. Nó rút candidate của đúng Program đó và đặt `WAITING`.

## 3. `CT-3` — Prepared-state và safe-boundary handoff

### 3.1 Bất biến

> Mọi thất bại **trước** khi `PREPARED` được fsync phải để lại **0 mutation** trên
> live state.

Live state được liệt kê đóng — đây chính là tập mà test fault phải chụp và so:

1. tập instance và `period_ms` của scheduler;
2. `active_revision_id`, `artifact_hash`, `operation_id`;
3. khai báo signal và committed snapshot của bus;
4. candidate registry và output winner;
5. enable intent;
6. bộ đếm run/fault và output của Revision đang chạy.

### 3.2 Thứ tự mới của `stage_impl`

```text
1. validate identity/payload            (không mutation)
2. đọc artifact + split package         (không mutation)
3. validate topology dry-run            (không mutation)  ← MỚI
4. dựng prepared bus rời                (không mutation)  ← MỚI
5. prepare ảnh IR từng Program vào staging của scheduler
6. append_phase(PREPARED) + fsync                          ← ĐIỂM KHÔNG QUAY LẠI
7. handoff: ensure_topology, cài prepared bus, rút candidate, cập nhật field
```

Bước 5 dùng `stage_activation`, vốn đã là đường **không** chạm ảnh đang chạy
(`p->runtime.prepare()` dựng ảnh mới, `apply_pending_*` mới hoán đổi). Bước 5 lỗi
⇒ abort staging đã dựng, live nguyên vẹn. Bước 5 vẫn cần instance tồn tại, nên
`ensure_topology` cho instance **mới** phải chạy trước — nhưng thêm một instance
chưa có Program nào là mutation. Giải: bước 3 tính trước danh sách
`instances_to_add` và `periods_to_change`, bước 5 thêm instance ở trạng thái
`EMPTY` qua `add_program`, và mọi lỗi từ bước 5 trở đi **hoàn tác** đúng danh
sách đó (`remove_program` + trả `period_ms` cũ). Không đổi period trước bước 7.

### 3.3 Prepared bus

`StSignalBus` nhận hai API mới:

```cpp
bool validate(const std::vector<StSignalDefinition>&, std::string* error) const; // dry-run
void adopt(StSignalBus&& prepared);   // hoán đổi nguyên khối tại boundary
```

`rebuild_signal_bus` **không còn** được gọi trước `PREPARED`. Đường lỗi cũ
`bus->clear()` bị bỏ: xoá bus sống để báo một gói mới hỏng là đúng thứ bất biến
§3.1 cấm.

## 4. Sở hữu file trong đợt này

| Lane | Đường dẫn | Chủ |
|---|---|---|
| Core | `apps/core/application/st/**`, `apps/core/application/programming/**` | Integration Lead |
| Backend | `apps/web-api/internal/programming/**` | Backend/Contract Agent |
| FE | `apps/web-ui/src/features/programming/{library,design,model,api}/**` | FE/Verification Agent |
| Gate/harness | `scripts/**`, `CMakeLists.txt` | Integration Lead |
| Hồ sơ | `docs/**`, `CHANGELOG.md` | Integration Lead |

`apps/web-ui/src/features/programming/{overview,runtime}` **không** thuộc đợt này
— đó là vùng Plan 60.

## 5. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-24 | Khoá `CT-1`/`CT-2`/`CT-3` trước khi sửa code. |
