# ADR-062 — Intent Enable đã lưu đi cùng lệnh ACTIVATE, áp dụng tại chính safe boundary kích hoạt gói

**Trạng thái:** Accepted. Mục tiêu "về 0 ms" do chủ sở hữu chốt; chọn phương án và các quyết định kỹ thuật ở mục 3–6 là quyết định triển khai theo ủy quyền của chủ sở hữu.
**Ngày:** 2026-09-26
**Người quyết định:** Phạm Đình Chương — Product Owner/CTO. Câu chốt ngày 2026-09-26: "Sửa về 0 ms".
**Không supersede:** `T59-305` (Program mới luôn Disabled), `T59-405` (Enable/Disable là action riêng), `F-P59-ENABLE-BOUNDARY-001`, boot fail-closed của `load_active_checkpoint`. ADR này chỉ thêm một đường mang intent **đã có** tới biên kích hoạt.
**Nguồn:** `docs/07_records/test-evidence/programming/2026-09-25-fbd-st-modbus-do-audit.md` (finding F13, lượt 3, số đo 05:03:15 và 05:37:34)

## Bối cảnh

Khi Commission hoặc Restore sang một Revision có Program chưa chạy trong gói cũ, Core dựng Program đó ở Disabled (`stage_impl`: `entry.enabled = live && live->enabled`). Đây là cơ chế fail-closed theo T59-305/405. Intent Enable của người vận hành nằm trong `program_runtime_intents` của web và chỉ tới Core qua `SET_PROGRAM_ENABLED` do `RuntimeIntentService` replay.

Trong khoảng giữa safe boundary kích hoạt gói và lúc intent tới, không Program nào giữ proposal mức 5. `SafeState` vào trigger T7 `no_ctrl` và ép mọi AO về 0 V/4 mA, mọi DO về mở.

| Lần đo trên Foxlinx | Khoảng `no_ctrl` | Nguyên nhân |
|---|---|---|
| Lượt 3, 05:03:15 | 1,38 s | Chờ tick reconcile 2 s kế tiếp (F04) |
| Sau `1de5373c` (`Nudge`), 05:37:34,488 → 05:37:34,558 | 70 ms | Một vòng IPC: `OPERATION_STATUS` SUCCEEDED → `Nudge` → `SET_PROGRAM_ENABLED` → boundary kế |

Còn 70 ms là vì intent tới **sau** boundary. Không tối ưu IPC nào xoá được khoảng này. Muốn về 0 thì intent phải có mặt ngay tại boundary kích hoạt.

## Hai phương án

| Tiêu chí | (a) Mang intent trong lệnh ACTIVATE qua IPC | (b) Ghi `desiredEnabled` vào gói |
|---|---|---|
| Authority của intent | Giữ nguyên ở store web, có audit riêng (T59-405). ACTIVATE chỉ mang ảnh chụp tại lúc kích hoạt | Gói là artifact bất biến, băm lúc Check. Intent đổi sau Check thì gói đã lạc hậu |
| Restore về Revision cũ | Dùng intent **hiện tại** của người vận hành | Dùng intent chụp lúc Check của Revision cũ, có thể đã bị tắt từ lâu |
| T59-305 "package không tự bật" | Giữ nguyên: gói vẫn mang `desiredEnabled=false` | Vi phạm: gói tự bật Program của chính nó |
| Boot sau mất điện | Không đổi: checkpoint không có intent, boot Disabled, web replay | Boot nạp lại gói từ checkpoint thì gói tự bật Program, phá boot fail-closed |
| Phạm vi đổi hợp đồng | Một phần tử tuỳ chọn trong payload ACTIVATE và một phần tử trong CAPABILITIES | Định dạng package v2, loader, writer, manifest Check, pin artifact |

**Chọn (a).** (b) sai ngữ nghĩa ở chỗ quan trọng nhất: nó đông cứng một quyết định vận hành vào một artifact bất biến, nên Restore sẽ làm sống lại một intent cũ.

## Quyết định

### 1. Dạng trên dây

Payload ACTIVATE có thêm phần tử thứ năm **tuỳ chọn** là `programIntents`:

```text
[expectedActive (text|null), stagedToken, cutover, planHash, programIntents?]
programIntents = [[instanceId (text 1..64), desiredEnabled (bool)], ...]   // tối đa 32 phần tử
```

Payload 4 phần tử giữ nguyên nghĩa cũ. Payload 5 phần tử với mảng rỗng nghĩa là "web mới, không có intent nào cho các Program này", tương đương 4 phần tử.

### 2. Đàm phán phiên bản bằng capability, không nâng `protocolMinor`

Không nâng `protocolMinor` 4 → 5, vì lý do kỹ thuật sau. `coreipc.ValidateResponse` ở web từ chối mọi response có `protocolMinor` cao hơn hằng của chính nó. Nếu nâng minor ở Core, web cũ sẽ từ chối **mọi** response của Core mới, tức mất trọn Programming chứ không chỉ mất tính năng này.

Thay vào đó, CAPABILITIES của Core mới thêm phần tử thứ năm `features`, một mảng tên tính năng, trong đó có `"ACTIVATE_PROGRAM_INTENTS"`. Trước mỗi ACTIVATE, web mới gọi CAPABILITIES:

- Có tính năng: gửi payload 5 phần tử.
- Không có, CAPABILITIES lỗi, hoặc payload không đọc được: gửi payload 4 phần tử như cũ.

Web cũ không gọi CAPABILITIES qua IPC, nên việc thêm phần tử không ảnh hưởng nó.

### 3. Ngữ nghĩa ở Core

Core áp intent ngay trong `ProgrammingRuntimeCoordinator::activate()`, trên tập Program **shadow** đã chuẩn bị ở STAGE. Thời điểm là sau khi `COMMIT_INTENT` đã fsync và trước `arm_prepared_program_set`. Luồng RT chưa chạm shadow trước khi arm, nên sửa `enabled` ở đây không tạo race. Tại boundary, `swap_prepared_program_set_at_boundary` dựng Program ở `RUNNING` nếu `enabled`, cùng một boundary với việc đổi gói. Scan đó chạy Program và publish output luôn, nên T7 không bật.

Luật áp theo thứ tự:

1. Intent `false` đưa Program về Disabled. Đây là hướng fail-closed và không tính vào trần.
2. Intent `true` bật Program theo thứ tự trong gói, miễn tổng số Enabled chưa chạm `maxProgramsEnabled` (16, sinh từ profile). Program vượt trần giữ Disabled và Core log `WARN programming.activate_intent_limit`. Kích hoạt **không** bị từ chối vì trần, để Restore không bao giờ bị chặn. Sau đó vòng reconcile sẽ nhận `REJECTED_LIMIT` như trước.
3. Program không có phần tử nào trong `programIntents` giữ đúng luật T59-305/405: cùng identity thì giữ enable của bản đang chạy, Program mới thì Disabled.
4. Phần tử cho instance không có trong gói bị bỏ qua, vì intent có thể nói về Program đã rời gói (F07).
5. Payload sai kiểu, quá 32 phần tử, `instanceId` sai định dạng hoặc trùng thì trả `REJECTED/IPC-PAYLOAD` **trước** mọi thay đổi trạng thái, cùng lớp lỗi với mọi payload hỏng khác.

Mỗi lần áp, Core log một dòng `INFO  programming.activate_intents operation=… enabled=… disabled=… dropped_limit=… ignored=…` ngoài luồng RT, làm mốc đo trên target.

### 4. Ngữ nghĩa ở web

Khi Commission hoặc Restore (`activateStaged`, gồm cả nhánh reconcile gặp `STAGED`), web đọc `program_runtime_intents` của Project chứa Revision. Chỉ giữ các dòng có `programId` trùng một object `PROGRAM` của Revision, vì đó là tên instance trong `PROGRAM_TABLE` (`programPackageName`). Web gửi cả intent `true` lẫn `false`, sắp theo `programId`.

Đọc store lỗi, hoặc số dòng vượt 32, thì gửi payload 4 phần tử và log `WARN`. Lưới an toàn reconcile lo phần còn lại. Không lỗi nào ở bước này được làm hỏng Commission hay chặn Restore.

### 5. Điều không đổi

- **Boot và recovery:** checkpoint không mang intent. Boot luôn Disabled, `RuntimeIntentService.Start` replay như cũ.
- **Rollback:** intent chỉ chạm shadow của gói **mới**. `previous_program_set_` được khôi phục nguyên trạng khi chu kỳ đầu hỏng (FAULTED → ROLLING_BACK → ROLLED_BACK), nên rollback không bật lại gì.
- **Barrier chu kỳ đầu (T59-501):** Program bật bằng intent tham gia barrier như mọi Program đang chạy. Nếu nó FAULTED ở chu kỳ đầu thì **cả gói** quay về LKG. Trước ADR này nó được bật sau khi gói đã COMMITTED, nên lỗi của nó không kéo gói về. Đây là thay đổi có chủ ý theo hướng an toàn hơn.
- **T59-405:** `SET_PROGRAM_ENABLED` vẫn là đường duy nhất để bật/tắt ở trạng thái ổn định. ACTIVATE không ghi intent và không tạo audit PROGRAM_ENABLE. Nó chỉ mang intent đã có audit tới boundary.
- **Lưới an toàn F04/F07 và `Nudge`:** giữ nguyên. Nếu intent đổi giữa lúc web đọc store và lúc boundary chạy, hoặc gặp Core cũ, vòng reconcile theo mức vẫn kéo trạng thái về intent. Khi ACTIVATE đã mang đúng intent, vòng đó chỉ thấy không có lệch và không gửi lệnh nào.
- **Tiêu chí C1–C4 của ADR-061:** không đổi. Việc áp intent chạy trên luồng IPC, không thêm việc nào vào luồng quét.

### 6. Đối chiếu tiêu chí bắt buộc

| Tiêu chí | Cách đạt | Test khoá |
|---|---|---|
| Program có intent Enable RUNNING ngay trong cùng safe boundary, không scan nào chạy với output bị rút | Shadow `enabled=true` trước arm; boundary dựng `RUNNING` và scan đó publish output | `ProgrammingActivateIntent.ScanLoopNeverEntersNoControllerAcrossRestoreWithEnableIntent` |
| Không có intent Enable (hoặc FAULTED/ROLLED_BACK) vẫn fail-closed | Luật 3 giữ T59-305/405; rollback không đụng; boot không đổi | `…ProgramWithoutIntentStaysDisabled`, `…DisableIntentWinsOverLiveEnabled`, `…FirstCycleFaultStillRollsBackWholePackage` |
| Restore về Revision cũ đã PASSED không bị chặn | Trần không từ chối; web lỗi đọc thì về payload cũ | `…LimitOverflowStaysDisabledWithoutBlockingActivation`, test Go Restore |
| Tương thích ngược xác định | Mục 2 và bảng dưới | Test Go với Core giả không có tính năng; test Core với payload 4 phần tử |
| Reconcile F04/F07 giữ làm lưới an toàn | Không sửa `RuntimeIntentService` | Test sẵn có của `runtime_intent_test.go` |

### 7. Tương thích giữa các phiên bản

| Web | Core | Hành vi |
|---|---|---|
| mới | mới | CAPABILITIES có tính năng, ACTIVATE 5 phần tử, Program có intent Enable chạy ngay tại boundary (0 ms `no_ctrl`) |
| mới | cũ | CAPABILITIES 4 phần tử, web gửi ACTIVATE 4 phần tử, hành vi y như hiện nay (khoảng một vòng IPC nhờ `Nudge`) |
| cũ | mới | Web gửi ACTIVATE 4 phần tử, Core dùng luật cũ; web cũ không gọi CAPABILITIES nên không thấy phần tử mới |
| cũ | cũ | Không đổi |

Thứ tự deploy không quan trọng. Rollback một phía bất kỳ đều về một dòng hợp lệ của bảng trên.

## Hệ quả

- Hợp đồng `contracts/ipc/programming_v1/schema.json` mô tả payload ACTIVATE và CAPABILITIES. Golden corpus có thêm một frame ACTIVATE mang intent, để Go và C++ khoá cùng một chuỗi byte. `protocolMinor` giữ 4. Sha schema đổi nên phải re-pin golden manifest, G1 join và `pgm02_workspace_v1.json` trong cùng PR với validator.
- OpenAPI không đổi: đây là hợp đồng nội bộ BE ↔ Core.
- F13 đóng ở mức source/host. Chỉ được ghi PASS target sau khi deploy cả Core lẫn web và đo lại (mục 8).

## 8. Cách đo trên target

1. Deploy Core và web cùng commit. Kiểm `/proc/<MainPID>/exe` của `mkddc-core` và `mkddc-web-pi` khớp sha bản build.
2. Có một Program P có intent Enable nhưng không thuộc Active hiện tại. Restore sang Revision chứa P, như cặp #52 → #63 của lượt 3.
3. Đọc `journalctl -u mkddc-core -o short-precise` quanh lúc Restore:
   - Phải có `INFO  programming.activate_intents … enabled=1`.
   - **Không** có `ERROR safe_state.enter … no_ctrl=1` nào giữa dòng đó và lúc operation SUCCEEDED.
   - Web không gửi `SET_PROGRAM_ENABLED` nào cho P sau SUCCEEDED, vì reconcile không thấy lệch.
4. Lặp lại với Core cũ, hoặc web cũ, để xác nhận hàng tương ứng của bảng mục 7.

## Rollback quyết định

Chỉ Product Owner supersede được ADR này. Nếu hỏng trên target, deploy lại web bản trước: theo bảng mục 7, hệ về hành vi `Nudge` 70 ms mà không cần hạ Core.
