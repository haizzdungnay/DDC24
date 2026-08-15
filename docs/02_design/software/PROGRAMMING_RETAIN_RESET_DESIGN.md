# RETAIN Reset — Design (WP-12)

**Document ID:** DDD-RETAIN-RESET-PROG-001
**Phiên bản:** 2.1
**Trạng thái:** **DONE** — Core C++ + BE Go + FE đã triển khai, kiểm chứng
đầy đủ và deploy board Foxlinx (§11, PR #185, `EV-PROG-WP12-001`)
**Tác giả:** System Engineering, theo Lệnh CTO/Owner 2026-08-15 §VI (WP-12)
**Phạm vi:** `POST /api/v1/programming/retain/reset` — route đã nối Core
thật qua `RETAIN_RESET` IPC action (không còn rơi vào nhánh `503` mặc định
mô tả ở Rev 2.0; xem §11 cho bằng chứng implement).

---

## 0. Đính chính Rev 1.0 — IPC layer THẬT SỰ đã nối runtime cho STAGE/ACTIVATE/RESTORE

Rev 1.0 tài liệu này (Draft) viết sai: *"IPC protocol layer chưa nối runtime
thật cho bất kỳ action nào"*. Kết luận đó dựa trên một lượt grep không đủ
sâu (`grep -rln "ProgramAction::Stage" apps/core/` chỉ khớp
`program_ipc_server.cpp`, bỏ sót rằng dispatch thật nằm trong
`ProgramIpcServer::HandleFrame` — cùng file, khác hàm — và endpoint chạy
thật ở `apps/core/adapters/ipc/program_ipc_unix.cpp`, không phải một file
tên gần giống). Đọc lại đầy đủ xác nhận:

- `apps/core/bootstrap/main.cpp:319-330` dựng `ProgramIpcServer` thật, gắn
  `ProgrammingRuntimeCoordinator*` thật, và chạy một thread
  `ProgramIpcUnixEndpoint::run()` — `poll()`/`accept4()` thật trên
  `/run/mkddc/programming-v1.sock`.
- Go BE (`apps/web-api/internal/programming/application/operations.go`)
  gọi đúng socket này qua `coreipc.Client.Call` cho `ActionStage`/
  `ActionActivate`/`ActionRestore` — đây chính là luồng Commission đã xác
  nhận chạy thật trên board Foxlinx nhiều lần trong phiên này.
- `ProgramIpcServer::HandleFrame` (`program_ipc_server.cpp:564-672`)
  dispatch `Stage`/`Restore`/`Activate` sang
  `ProgrammingRuntimeCoordinator::stage/restore/activate(...)` — coordinator
  thật, gắn `StScheduler` thật.

**Chỉ `RetainReset` (và `TraceStart`, ngoài phạm vi WP-12) rơi vào nhánh
mặc định trả `ProgramResult::Unavailable`/`"IPC-ACTION-NOT-IMPLEMENTED"`**
(`program_ipc_server.cpp:660-663`). Đây mới là khoảng thiếu thật — nhỏ và
cụ thể hơn Rev 1.0 mô tả, nhưng cơ chế cần thêm (đồng bộ với RT scan thread)
vẫn là công việc runtime engine thật, không phải một PATCH Go mỏng.

## 1. Business semantics — QUYẾT ĐỊNH: Phương án B (runtime-coordinated)

CTO/Owner chốt: **`Reset Retained State` là một runtime transaction, không
phải filesystem command.** Flow bắt buộc:

```text
Admin Request
     ↓
Validate Active Revision / Target
     ↓
Scheduler marks RESET_PENDING
     ↓
Controlled execution boundary (safe boundary — cùng điểm STAGE/ACTIVATE dùng)
     ↓
Reset in-memory retained values (slots + fb_states) cho instance đang chạy
     ↓
Force-flush persisted retain image (bỏ qua cửa sổ 60s autosave)
     ↓
Increment retain generation
     ↓
Resume Program (không dừng scan — chỉ 1 boundary bị chiếm dụng)
     ↓
Runtime read-back xác nhận giá trị đã reset
     ↓
Audit
```

**Mục tiêu bắt buộc:** sau khi API trả `SUCCEEDED`, autosave (worker 1s
poll, `StRetainService::worker_loop()`) không bao giờ được phục hồi lại giá
trị retained trước reset — đạt được bằng cách reset xảy ra ở tầng RT SLOTS
trước, worker chỉ publish/ghi những gì slots đang có (tự nhiên phản ánh giá
trị đã reset, không cần "chặn" worker).

## 2. Permission

Đã đúng: `router.go:55` khai `role: auth.RoleAdmin`. Không đổi.

## 3. Điểm mở rộng cụ thể (đọc trực tiếp source, không suy đoán)

| Lớp | File | Thay đổi |
|---|---|---|
| RT mutation (nơi thật sự ghi 0 vào slots) | `apps/core/application/st/st_scheduler.hpp/.cpp` | Thêm `pending_retain_reset` (atomic bool, mẫu giống `pending_commit_requested`) vào `StProgramInstance`; thêm `StScheduler::request_retain_reset(instance_id)` (non-RT, set cờ) và áp dụng trong `apply_pending_activations()` (hoặc hàm boundary riêng gọi cùng chỗ) — lặp `program.retain_entries` ghi `StCell` về 0, lặp `program.fb_instances` có `retained=true` ghi lại `StFbState` cold-init default. Cần `StLoadedProgram*` **mutable** (khác `StProgramRuntime::program()` hiện tại chỉ trả `const*`) — thêm accessor non-const dùng riêng cho đường boundary này, giữ nguyên bất biến "RT không cấp phát/không throw". |
| Bridge non-RT → RT | `apps/core/application/programming/programming_runtime_coordinator.hpp/.cpp` | Thêm `reset_retain(const RetainResetCommand&, std::string* detail_code, std::string* error)` — gọi `scheduler_->request_retain_reset(...)`, đợi xác nhận đã áp dụng ở boundary kế tiếp (poll ngắn có timeout, cùng mẫu `flush_progress()` đã có), rồi gọi `scheduler_->retain_service()->flush(true)` (đã có sẵn, dùng ở shutdown — tái dùng, không viết mới) để bỏ qua cửa sổ 60s trước khi trả `Ok`. |
| Dispatch IPC | `apps/core/application/programming/program_ipc_server.cpp` | Thêm nhánh `RetainReset` trong `HandleFrame` (cạnh `Stage`/`Activate`, dòng ~636-659) + hàm `parse_retain_reset_payload` (mẫu `parse_activate_payload`). |
| Go caller (CHƯA có, phải tạo mới) | `apps/web-api/internal/programming/application/operations.go` (hoặc file mới `retain.go` cùng package) | Chưa có bất kỳ call site nào cho `ActionRetainReset` — phải viết luồng operation mới (không phải sửa luồng Stage/Activate có sẵn), gọi `coreipc.ActionRetainReset` qua `runtime.Call`. |
| HTTP handler thật | `apps/web-api/internal/programming/transport/http/*.go` | Thay nhánh 503 mặc định bằng handler thật cho `POST /retain/reset` — tính impact list (§5), gọi operation ở trên, ghi audit. |

`StRetainStore`/`StRetainMailbox` (file `st_retain.hpp/.cpp`) **không cần
sửa** — cơ chế generation/coalescing sẵn có tự nhiên phản ánh đúng giá trị
mới nếu RT-side reset xảy ra trước lần publish kế tiếp (đúng nguyên tắc
"reset ở slots trước, mailbox/worker chỉ đọc lại state hiện tại").

## 4. Business rules (CTO/Owner §9)

- Chỉ `RoleAdmin`.
- Xác nhận mạnh (§5).
- Hiện target controller + Active Revision + Program/Retain scope trước khi
  cho xác nhận.
- Hiện số lượng retained variable bị ảnh hưởng (đếm `program.retain_entries`
  + FB instance có `retained=true` từ artifact đang active).
- Audit bắt buộc (§6).
- Idempotency bắt buộc (`router.go` đã khai `idempotencyRequired: true`).
- FE **không** tự nhận thành công lạc quan — chỉ hiện SUCCEEDED sau khi BE
  xác nhận qua read-back.
- Timeout ở bước chờ boundary/flush → `UNKNOWN`/cần reconcile, không giả
  định thành công.
- Runtime offline (Core không kết nối) → không giả success, trả lỗi rõ.
- Không reset retained state của Revision **không còn active** — kiểm
  `expected_active_revision_id` giống `ActivateCommand` đã làm.
- Multi-Program tương lai: payload phải mang được `instance_id`/Program
  Stable ID thay vì mặc định `"program-main"` — không chặn implementation
  hiện tại (Rev A vẫn 1 Program), nhưng field phải có sẵn trong payload để
  không phải đổi wire format khi Multi-Program tới.

## 5. Safety confirmation — tái dùng hạ tầng Impact/Acknowledgement đã có

Không phát minh UX mới — tái dùng đúng pattern `ImpactRetain`/
`AcknowledgementChecklist` (`transport/http/models.go`) đã dùng cho
Commission:
1. BE tính impact list: liệt kê FB instance có `retained=true` trong
   Revision đang ACTIVE (đọc `parameters.retained` — field Inspector WP-07
   cho gắn qua UI), kèm `typeRef`/`instance`, cộng số biến `RETAIN` (ST) từ
   artifact.
2. FE hiện danh sách trước khi cho bấm Reset.
3. Xác nhận mạnh: gõ lại tên Project (mẫu `CommissionDialog`).
4. Nút Reset chỉ enable khi impact list load thành công.

## 6. Audit

Ghi vào audit hash chain hiện có (cùng cơ chế Stage/Activate/Restore) —
tối thiểu: actor, thời điểm, `projectId`/`revisionId` active, danh sách FB
instance bị ảnh hưởng, kết quả từng bước (boundary applied, force-flush
outcome).

## 7. Error behavior

| `coreipc.Result` | HTTP | Khi nào |
|---|---|---|
| `ResultOK` | 200 | Reset áp dụng + force-flush thành công |
| `ResultRejected` | 409 | Program không ở trạng thái cho phép (đang STAGE dở dang, hoặc `expected_active_revision_id` không khớp) |
| `ResultBusy` | 503 + `Retry-After` | IPC queue đầy |
| `ResultUnavailable` | 503 | Core không kết nối |
| Chờ boundary/flush quá timeout | 200 với trạng thái `UNKNOWN`, không phải lỗi cứng | Đúng mẫu `OperationService.reconcile()` đã có cho Commission |

## 8. Test bắt buộc (CTO/Owner §10) — TC-RETAIN-01..05

| ID | Kịch bản | Lớp |
|---|---|---|
| TC-RETAIN-01 | Runtime có retain value `X` → Reset → chờ qua mốc giả lập > 60s (dùng `set_wall_clock_for_test`/clock tiêm sẵn của `StScheduler` — **không sleep thật**) → value cũ không trở lại | C++ (`st_scheduler`) |
| TC-RETAIN-02 | Reset → nạp lại instance (mô phỏng warm start qua `StRetainStore::restore()`) → retained state vẫn là state đã reset | C++ (`st_retain` + `st_scheduler`) |
| TC-RETAIN-03 | Reset lỗi giữa transaction (ví dụ force-flush fail) → runtime có state xác định (không half-reset im lặng) — trả lỗi rõ, không đổi `retain_generation` | C++/Go |
| TC-RETAIN-04 | Role khác Admin gọi → reject | Go (`transport/http`) |
| TC-RETAIN-05 | Active Revision đổi giữa lúc gửi request → reject/reconcile theo `expected_active_revision_id` | Go (`application`) |

Không dùng `sleep()` thật cho TC-RETAIN-01 — `StScheduler` đã có
`set_wall_clock_for_test(std::function<uint64_t()>)` chính xác cho mục
đích này (đã dùng ở test WCET/overrun hiện có).

## 9. Việc CHƯA làm ở tài liệu này (chuyển sang implementation)

Tài liệu này khoá đủ semantics để implement — phần còn lại (code C++/Go/FE
thật, test TC-RETAIN-01..05) thực hiện trực tiếp trong Sprint D, không cần
thêm vòng thiết kế.

## 11. Bằng chứng implement (Rev 2.1)

**Core C++** — `apps/core/application/st/{st_loader.hpp,.cpp,st_runtime.hpp,st_scheduler.hpp,.cpp}`:
`StLoadedProgram::reset_retained_state()` (đặt lại VAR RETAIN + FB state về
giá trị init từ IR), `StScheduler::request_retain_reset()`/
`apply_pending_retain_resets_at_boundary()` (cờ pending/ack atomic, cùng mẫu
`apply_pending_activations`). `apps/core/application/programming/
programming_runtime_coordinator.{hpp,cpp}`: `reset_retain()` — guard state
COMMITTED (`IPC-RETAIN-RESET-STATE`), guard `expected_active_revision_id`
(`IPC-EXPECTED-ACTIVE`), arm qua scheduler, bounded-poll boundary (≤1500ms,
`IPC-RETAIN-RESET-TIMEOUT` nếu quá hạn — không giả định thành công), rồi
force-flush `StRetainService::flush(true)`. `program_ipc_server.cpp` map
outcome APPLIED/REJECTED/TIMED_OUT → `ProgramResult::Ok/Rejected/Busy`.
6 test: `TC_RETAIN_01/02` (`tests/test_st_retain.cpp`),
`TC_RETAIN_03a/03b/03c` + happy-path end-to-end
(`tests/test_programming_runtime_coordinator.cpp`) — `ctest` 1030/1030.

**BE Go** — `apps/web-api/internal/programming/application/operations.go`:
`OperationService.ResetRetain()` bỏ qua hoàn toàn `resolveArtifact`/staging
(không có artifact cho RETAIN reset) — có luồng riêng
`executeRetainReset`/`reconcileRetainReset`/`callRetainReset` tái dùng
transition/audit/idempotency infra sẵn có. Quyết định quan trọng: BUSY
(Core TIMED_OUT) → `UNKNOWN`, và lần `ProcessNext` kế tiếp **gọi lại chính
`RETAIN_RESET`** (không dùng `Reconcile`/`OPERATION_STATUS` như
Stage/Activate — Core không track operation_id theo journal cho hành động
này, và reset vốn idempotent nên gọi lại an toàn). HTTP handler tại
`transport/http/operations.go` (route đã có sẵn ở `router.go:55`). Impact
list tái dùng nguyên `GET /revisions/none/changes/{activeRevisionId}`
(`ProjectService.GetRevisionChanges`) — không có endpoint mới. 8 test Go:
4 ở `application/operations_test.go` (apply/mismatch-no-half-reset/
timeout-retry-idempotent/idempotency-replay-conflict) + 1 role-403 ở
`app/programming_routes_test.go` (TC-RETAIN-04) — `go test ./...` xanh
toàn bộ.

**FE** — `apps/web-ui/src/features/programming/runtime/{useRetainResetWorkflow.ts,DangerZone.tsx}`:
thay stub khoá cứng bằng flow thật (impact list PRESENT/NONE/UNAVAILABLE
fail-closed, checkbox xác nhận, lý do, re-auth, poll operation, không tự
POST lại khi `UNKNOWN_RECONCILING`) — cùng mẫu `useRestoreWorkflow.ts`.
Error catalog: 4 detail code Core mới (`IPC-RETAIN-RESET-ARM/-INSTANCE/
-STATE/-TIMEOUT`) đăng ký vào `contracts/programming/error_catalog_v1.json`
→ regenerate Go/C++/TS qua `scripts/generate_programming_errors.py`.
12 test RTL (`RuntimeServicePage.test.tsx`, thay test stub khoá cứng cũ) +
E2E Playwright thật trong journey `UJ-PROG-08` (`e2e/programming.spec.ts`)
— `npx vitest` 643/643, `npm run lint`/`build` sạch, `npx playwright test`
10/10.

Đã commit/PR (#185, merge `158ba8b`)/deploy board Foxlinx + xác nhận board
thật — xem `docs/07_records/test-evidence/fw-som/2026-08-15-foxlinx-wp12-retain-reset-deploy.md`
(`EV-PROG-WP12-001`). WP-12 `DONE`.

## 10. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-15 | Tạo mới cho WP-12. Phát hiện `StRetainStore::erase()` có sẵn nhưng dùng riêng lẻ sẽ bị autosave (60s) ghi đè ngược nếu Program đang chạy — nêu 2 phương án semantics, khuyến nghị tái dùng hạ tầng `ImpactRetain`/`AcknowledgementChecklist` đã có ở Commission. Chưa implement — đúng gate tự đặt. **Có 1 kết luận sai** (§0 Rev 2.0 đính chính). |
| 2.0 | 2026-08-15 | CTO/Owner chốt Phương án B. Đính chính kết luận sai của Rev 1.0 (IPC layer THẬT SỰ đã nối cho Stage/Activate/Restore, chỉ RetainReset/TraceStart chưa). Đọc sâu `st_scheduler.hpp/.cpp`, `programming_runtime_coordinator.hpp/.cpp`, `program_ipc_server.cpp` xác định chính xác điểm mở rộng (§3), business rules (§4), 5 test bắt buộc (§8). `APPROVED TO IMPLEMENT`. |
| 2.1 | 2026-08-15 | Implement xong Core C++ + BE Go + FE (§11), 1030 ctest + toàn bộ Go test + 643 vitest + 10 Playwright xanh. `IMPLEMENTED`, chờ commit/PR/deploy board. |
