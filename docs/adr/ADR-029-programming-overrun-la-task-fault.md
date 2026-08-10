# ADR-029: Overrun của Program là fault của Task, không phải safe-state toàn trạm

- Date: 2026-08-10
- Owner: System Architect + Safety Reviewer (phê duyệt) · Controls Lead (đề xuất)
- Status: **Proposed** — chờ ký; chưa ký thì `ARCH-CONF-PROG-004` còn mở
- Đóng xung đột: `ARCH-CONF-PROG-004` tại [`ARCH-PROG-001`](../03_architecture/PROGRAMMING_ARCHITECTURE.md) §11
- Related: [`DDD-CTRL-PROG-001`](../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md) §2, §7, §9 ·
  [`OD-PROG-012`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) ·
  [ADR-028](ADR-028-programming-cong-thuc-watchdog-theo-base-step.md)

## Vấn đề (1 câu)

Component scheduler hiện có cờ `any_force_safe` cho phép **một** Program lỗi kéo
**cả trạm** về safe-state, trong khi thiết kế Target quy định lỗi Program chỉ làm
Task đó FAULT và chỉ SafetyManager mới được quyết định safe-state toàn trạm.

## Bối cảnh As-Built

```text
apps/core/application/st/st_scheduler.hpp:133   bool any_force_safe = false;   /* trong TickResult */
apps/core/application/st/st_scheduler.hpp:166   bool any_force_safe() const;
apps/core/application/st/st_scheduler.cpp:351   result.any_force_safe = any_force_safe();
apps/core/application/st/st_control_api.cpp:192 p["anyForcingSafeState"] = sched->any_force_safe();
```

Cờ này đã lộ ra ngoài qua control API dưới tên `anyForcingSafeState`. Hiện chưa có
consumer production nào đọc nó, nên đây là thời điểm rẻ nhất để sửa nghĩa.

Vì sao mô hình cũ nguy hiểm ở một DDC HVAC: một biểu thức chia cho 0 trong logic
điều khiển đèn có thể ép quạt và van về safe-state. Bán kính ảnh hưởng của lỗi
lớn hơn nhiều so với bán kính của nguyên nhân, và người vận hành không có cách
nào đọc ra “vì sao cả trạm dừng”.

## Quyết định

1. **Lỗi runtime của Program làm Task đó chuyển `FAULT` và hủy toàn bộ staging của
   chính chu kỳ đó.** Các Task khác, IOP, safety service và mọi nguồn ưu tiên
   `1..4` tiếp tục chạy bình thường.
2. **Đầu ra do Task lỗi giữ ở mức 5 là `hold-last`**, không phải `0` và không phải
   safe value. `PriorityResolver` vẫn là chủ sở hữu duy nhất của present value;
   nguồn ưu tiên cao hơn vẫn thắng như thường.
3. **`any_force_safe` bị gỡ khỏi hợp đồng scheduler.** Thay bằng trường chẩn đoán
   `taskFault{taskId, reason, sinceCycle, sourceMapRef}`. Trường
   `anyForcingSafeState` ở `st_control_api` được đánh dấu deprecated trong một
   release rồi xóa; không đổi nghĩa tại chỗ để tránh consumer cũ hiểu sai.
4. **Điều kiện safe-state toàn trạm thuộc SafetyManager và độc lập**, gồm: mất IOP
   quá ngưỡng, watchdog, interlock an toàn. Program **không** có đường nào đẩy hệ
   thống vào safe-state; đây là ranh giới không thương lượng.
5. **Ngưỡng chuyển FAULT** là `3` chu kỳ overrun liên tiếp theo
   `DDD-CTRL-PROG-001` §9; lần overrun thứ nhất và thứ hai là cảnh báo có đếm.
   Con số cuối cùng chốt theo `OD-PROG-012`.

## Phương án bị loại

| Phương án | Vì sao loại |
|---|---|
| Giữ `any_force_safe` nhưng chỉ dùng nội bộ | Đã lộ qua control API; “chỉ dùng nội bộ” không phải ranh giới kiểm chứng được |
| Overrun → dừng cả Programming runtime | Vẫn mở rộng bán kính lỗi ra ngoài Task gây lỗi |
| Overrun → đặt đầu ra Task lỗi về `0` | `0` là một lệnh điều khiển hợp lệ; đóng van hay mở van hết cỡ đều có thể là `0` tùy binding |

## Hệ quả

- `PROG-302/303` phải đổi `StSchedulerTickResult` và mọi test đang khẳng định
  `any_force_safe`.
- `IFSPEC-PROG-001` §12 `STATUS` trả `taskFault` thay vì cờ toàn cục.
- UI Runtime hiển thị fault ở **cấp Task** kèm vị trí source; không hiện banner
  “trạm ở safe-state” khi chỉ một Task lỗi.
- Rủi ro `RSK-PROG-004` (nhầm quyền điều khiển) giảm về mặt thiết kế, nhưng **chỉ
  hạ residual sau khi `VS-PROG-013` PASS trên target**.

## Điều kiện xác minh trước khi chuyển `Accepted`

| Điều kiện | Bằng chứng |
|---|---|
| `OD-PROG-012` ký ngưỡng overrun và hành vi fault | decision record |
| Task lỗi FAULT mà trạm **không** vào safe-state | `VS-PROG-013` Test Result trên target |
| Đầu ra Task lỗi giữ giá trị cũ, không nhảy `0` | `VS-PROG-014` waveform AO/DO |
| Ưu tiên `1..4` vẫn thắng trong lúc Task FAULT | `VS-PROG-010` |

## Chữ ký

| Vai trò | Trạng thái | Ngày |
|---|---|---|
| System Architect | **PENDING** | — |
| Safety Reviewer | **PENDING** | — |
| Controls Lead | Đề xuất | 2026-08-10 |
