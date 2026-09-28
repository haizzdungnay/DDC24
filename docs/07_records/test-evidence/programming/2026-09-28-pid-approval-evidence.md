# Hồ sơ bằng chứng duyệt khối `PID` (Controls/Safety)

**ID:** EV-PROG-PID-APPROVAL-20260928
**Ngày:** 2026-09-28
**Issue:** [#802](https://github.com/Mekong-HCM/MK-DDC-24/issues/802) (finding U-13 của [`REC-DDC-FIELD-USE-20260927`](../../reviews/DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md))
**Phiếu quyết định:** [`REC-PID-DECISION-REQUEST-20260928`](../../reviews/PID_REVIEW_DECISION_REQUEST_2026-09-28.md) bản 0.2
**Lớp bằng chứng:** **HOST**. Runtime ST thật (artifact đã ký, `StProgramRuntime`) nối với mô hình đối tượng mô phỏng. **Chưa chạy vòng kín với AO thật trên bo — NOT RUN.**
**Mốc mã nguồn:** nhánh `feat/pid-approval-802` tạo từ `main@ed07861b`; runtime PID không đổi so với `main` (chỉ thêm test).
**Máy chạy:** x86_64, Intel Xeon E5-2680 v4, g++ 13.3.0, build `Release` với `MKDDC_ENABLE_MODBUS/BACNET/HMI=ON` (`cmake --fresh`).

## 1. Quyết định

Chủ dự án — với vai Controls/Safety Lead và Product Owner của repo — **chấp thuận phương án 1** của phiếu quyết định ngày 2026-09-28:

| Mục duyệt | Nội dung được duyệt |
|---|---|
| Ngưỡng override-detect | 1 % dải `OUT_MIN..OUT_MAX` (`kPidOverrideDetectFraction = 0.01f`, `apps/core/application/st/st_exec.cpp`) |
| Biên tích phân | `iMin/iMax` dùng chung biên output (`OUT_MIN..OUT_MAX`) |
| Hành vi fault | `dt` sai (đồng hồ không tăng), NaN/Inf ở input hay ở `u_raw`, dải output vô nghĩa, quality bad ở biên process image: fault, **không publish** output của chu kỳ |
| Hành vi override | Freeze tích phân khi `ACTUAL` lệch OUT chu kỳ trước quá ngưỡng, báo `TRACKING = TRUE`, không chép `ACTUAL` ngoại lai vào tích phân; nhả override thì OUT nối tiếp từ tích phân đã freeze — đúng As-Built `TASK-PROG-303` |
| `approvalEvidenceRef` | `EV-PROG-PID-APPROVAL-20260928` (hồ sơ này) |

Token sinh bằng `approval_token("PID", "rev-a.6", "EV-PROG-PID-APPROVAL-20260928")` của `scripts/generate_programming_profile.py`:

```
3c52721944a630d54d3111bc38aab4c0c63c7a8f29ea784d27f2c0cb2e6cc0d6
```

Token gắn `libraryVersion = rev-a.6`. Bump thư viện SYSTEM (kể cả chỉ đổi semantics PID như ngưỡng 1 %) làm token mất hiệu lực và generator từ chối profile cho tới khi ký lại.

Gains, bộ lọc và transition envelope của từng vòng cụ thể vẫn là **quyết định hiện trường** (`DDD-CTRL-PROG-001` §7), không thuộc phạm vi duyệt này.

## 2. Bằng chứng trước khi ký

Chạy trên build `cmake --fresh` (configure exit 0, build exit 0), **trước** khi đổi profile.

### 2.1 Harness PID

`ctest --test-dir build/fw -R "StExec.*Pid|TwoPid|StIntegration.Pid|StLang.Pid|StPidClosedLoop"` → **15/15 PASS** (exit 0).

| Test | Kiểm gì | Kết quả |
|---|---|---|
| `StLang.PidDeclarationAndCallAccepted` | Ngôn ngữ hiểu `PID` (khai báo + gọi) | PASS |
| `StLang.PidUnknownParameterRejected` | Tham số lạ bị từ chối | PASS |
| `StExec.PidProportionalTracksErrorOnFirstCycle` | P thuần, chu kỳ đầu không báo override | PASS |
| `StExec.PidIntegralAccumulatesWithConstantError` | Tích phân theo `dt` thật của Task | PASS |
| `StExec.PidLeavesSaturationImmediatelyWhenErrorReversesSign` | Anti-windup back-calculation | PASS |
| `StExec.PidFreezesIntegratorAndReportsTrackingWhenOverridden` | Freeze khi override, `TRACKING` | PASS |
| `StExec.PidOverflowingOutputIsFault` | `u_raw` Inf → fault `kRtNonFiniteReal` | PASS |
| `StExec.PidInvertedOutputRangeIsFault` | `OUT_MIN ≥ OUT_MAX` → fault | PASS |
| `StExec.PidNonMonotonicTimeIsFault` | `dt ≤ 0` → fault `kRtPidInvalidDt` | PASS |
| `StExec.TwoPidInstancesAreIndependent` | Hai instance không chung state | PASS |
| `StIntegration.PidActualFeedbackDetectsPriorityOverride` | `ACTUAL` bind vào AO qua Point Table, override ưu tiên cao được phát hiện | PASS |
| `StPidClosedLoop.*` (4 test, §2.2) | Vòng kín | PASS |

Hành vi fault ở biên process image (không riêng PID): `StIntegration.NonFiniteInputIsBlockedAtBoundary`, `StIntegration.InputSnapshotRejectsWholeBatchAndDoesNotReusePartialValues` (quality `BAD` → cả lô input bị từ chối, không dùng lại giá trị cũ), `StIntegration.FaultingProgramDoesNotCrashAndDoesNotEmitOutput` → **3/3 PASS**.

### 2.2 Vòng kín — `test_st_pid_closed_loop.cpp`

Đối tượng quán tính bậc một rời rạc hoá ZOH `y[k+1] = a·y[k] + (1 − a)·K·u[k]`, `a = exp(−Ts/τ)`, τ = 5 s, **K = 1**, Ts = 100 ms. PID: KP = 2, KI = 0,5, KD = 0, OUT 0..100. `ACTUAL` của chu kỳ k là giá trị đã áp thật cho đối tượng ở chu kỳ k − 1. Review gate tắt như mọi harness PID (bằng chứng phải dựng được độc lập với trạng thái token). Số đo in từ dòng `[PID-EVIDENCE]` của `core_tests --gtest_filter='StPidClosedLoop.*'`.

| Phép kiểm | Tiêu chí | Số đo | Kết quả |
|---|---|---|---|
| (a) Bậc thang 0 → SP 40, 60 s | Vào dải ±2 % và ở lại; sai số xác lập ≈ 0 | Vào dải ±2 % sau **7,0 s**; đỉnh 40,5002 (vọt lố 1,251 %); sai số cuối **0,000015**; 0 chu kỳ báo `TRACKING` giả | PASS |
| (b) SP 150 (không với tới) 60 s → SP 50, 90 s | Rời bão hoà ngay; vọt lố ≤ 5 % | OUT = 100 suốt 600/600 chu kỳ bão hoà; chu kỳ đầu sau khi hạ SP OUT = **0,0** (0 chu kỳ còn kẹt ở OUT_MAX); PV thấp nhất 49,3747 → vọt lố **1,251 %** SP (1,251 % biên độ bước); PV cuối 50,0000 | PASS |
| (c) SP 30 hội tụ 60 s, override giữ đối tượng ở 10 trong 30 s, nhả 60 s | `TRACKING` = TRUE; tích phân không bị nạp; nhả không nhảy lên biên | `TRACKING` **300/300** chu kỳ thấy `ACTUAL` = 10, 0 chu kỳ trước/sau; tích phân trước override 30,0000, trôi tối đa **0,000009**; OUT lúc nhả **70,8983** (bước nhảy 0,0020), OUT lớn nhất sau nhả 68,4283 < 100; PV cuối 30,0000 | PASS |
| (c) phản chứng | Cùng kịch bản nhưng `ACTUAL` báo sai rằng OUT đã được áp | OUT lúc nhả = **100,0000** (wind tới biên), `TRACKING` = 0 → phép kiểm (c) phân biệt được freeze đúng/sai | PASS |
| (d) Biên ngưỡng 1 % | Lệch 0,9 (< 1 % dải 0..100) không phải override; lệch 1,1 là override | 0,9 → `TRACKING` 0; 1,1 → `TRACKING` 1 | PASS |

Ghi chú tinh chỉnh (không phải tiêu chí duyệt): tiêu chí (b) đo với K = 1 theo đề bài. Mô hình Python cùng thuật toán (float32) cho thấy với K = 0,5 và SP không với tới rồi hạ về giá trị với tới được, vọt lố sau bão hoà lên khoảng 19 % — do back-calculation ghim tích phân ở `OUT_MAX − KP·e` khi sai số lớn kéo dài. Đây là đặc tính của anti-windup đã duyệt, xử lý bằng chỉnh gains/SP ramp ở hiện trường.

### 2.3 Sau khi ký

| Cổng | Kết quả |
|---|---|
| `generate_programming_profile.py --check` | PASS 3/3 tệp sinh khớp profile |
| `generate_programming_profile.py --self-test` | PASS 8/8 mutation bị từ chối đúng lý do + 1/1 token hợp lệ được nhận |
| `StReviewGate.PidApprovalTokenIsDerivedFromContract` (C++), `TestPidApprovedWithTokenDerivedFromContract` (Go) | Token trong contract = `sha256` của công thức, gắn `rev-a.6` |
| `StReviewGate.ApprovedPidPassesCheckOnProductionPath`, `StLibraryConformance.FbdEntryPointEnforcesReviewGateAndAcceptsApprovedPid` | PID qua Check trên đường production ST và FBD |
| Test cơ chế cổng (bảng giả chặn PID) | Vẫn chặn đúng mã `ST-PID-001`, đúng dòng, trên ST/FBD/RETAIN/AST dựng tay |

Số đo đầy đủ của các cổng C++/Go/FE ở PR đóng Issue #802.

## 3. Giới hạn

- **HOST**: đối tượng là mô hình số, không phải van/damper thật. Chưa chạy vòng kín với AO thật trên bo lab — **NOT RUN**. Không có phép đo điện ở đầu ra analog.
- Không đánh giá KD ≠ 0 trong vòng kín (derivative-on-measurement có test đơn vị, chưa có kịch bản nhiễu đo).
- Không đánh giá tương tác nhiều vòng PID (cascade, chia dải).

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-28 | Bản đầu: quyết định duyệt PID (phương án 1), 15/15 harness PID + 3/3 fault biên, 4 phép kiểm vòng kín kèm phản chứng, token `3c527219…` cho `rev-a.6` |
