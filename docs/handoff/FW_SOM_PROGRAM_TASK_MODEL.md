# FW SOM — Mô hình Program và Task

> **Document ID:** HANDOFF-TASKMODEL-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-07-28
> **Đặc tả đầy đủ:** [`PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md`](../02_design/software/PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md)

## Bốn khái niệm

```
Resource (1 trên mỗi mkddc-core)
   └── Task[0..7]                    chu kỳ · ưu tiên · budget
          └── ProgramInstance[0..15]  trạng thái riêng, thứ tự cố định
                 └── Artifact          gói IR bất biến, dùng chung được
```

| | Định nghĩa | Giới hạn |
|---|---|---|
| **Resource** | Toàn bộ ngữ cảnh thực thi trong một `mkddc-core` | 1 |
| **Task** | Đơn vị lập lịch | ≤ 8, ưu tiên **duy nhất** |
| **ProgramInstance** | Một lần "đặt" artifact vào Task; có trạng thái riêng | ≤ 16/task, ≤ 32 toàn hệ |
| **Artifact** | Gói IR bất biến | ≤ 32 đã load |

**Instance ≠ artifact.** Hai instance của cùng một artifact có **trạng thái
hoàn toàn tách biệt** — hai timer đếm độc lập. Nhờ vậy cùng một logic AHU chạy
cho hai AHU khác nhau mà không phải compile hai lần.

## Mô hình lập lịch

**Fixed-priority, non-preemptive tại task boundary.**

Không preempt vì ba lý do, theo thứ tự quan trọng:

1. **Nhất quán process image.** Một Program đọc snapshot đầu vào và ghi output
   staging. Bị cắt ngang giữa chừng thì Task khác có thể thấy trạng thái nửa
   vời. Không preempt biến "process image không đổi trong một lần thực thi" từ
   quy ước cần kỷ luật thành **bất biến cấu trúc**.
2. **Không cần khoá** → không có priority inversion, không có biến động thời
   gian do khoá.
3. **WCET cộng được** — thời gian xấu nhất một tick bằng tổng WCET các Task
   chạy trong tick đó.

Giá phải trả: Task chu kỳ dài có thể làm trễ Task chu kỳ ngắn tối đa bằng WCET
của nó. Kiểm soát bằng **per-task budget**.

## Tick

Tick cơ sở **50 ms**. `period_ms` phải là **bội số của 50** — nếu không, Task
trôi so với chính chu kỳ khai báo và WCET cộng dồn mất ý nghĩa.

Mỗi tick:

```
1. Chụp đồng hồ MỘT LẦN                  -> mọi Task, mọi FB dùng chung
2. Chụp process image đầu vào
3. Áp mọi activation đang chờ            <- CHỈ tại đây, cho MỌI task
4. Chạy Task theo ưu tiên tăng dần
5. Trọng tài ưu tiên + safe-state
6. Commit output MỘT LẦN
7. Publish metrics/alarm
8. Kick watchdog                          <- CHỈ sau khi 1-7 xong
```

**Chụp đồng hồ một lần** là chi tiết quan trọng: hai timer khởi động cùng tick
sẽ hết hạn cùng tick. Nếu mỗi FB tự đọc đồng hồ thì kết quả phụ thuộc thứ tự
thực thi — không tất định, không tái lập được khi điều tra sự cố.

**Bù trôi, không chạy bù.** `last_run` cộng theo mốc lý thuyết nên Task 100 ms
chạy đúng 10 lần/giây kể cả khi có tick trễ. Nhưng nếu đã lỡ nhiều chu kỳ thì
**bỏ**, chỉ chạy một lần — chạy bù làm timer nhảy và làm quá tải nặng thêm.

## Thực thi một Task

```
với mỗi Program theo `order` tăng dần:
    nạp input từ snapshot vào slot
    thực thi IR
    nếu fault: HUỶ TOÀN BỘ staging của Task, thoát ngay
commit staging
báo exec_ns cho OverrunMonitor
```

**Fault của một Program huỷ staging của cả Task.** Các Program trong một Task
thường phối hợp (Program 0 tính setpoint, Program 1 dùng nó); commit một phần
sẽ đẩy đầu ra vào tổ hợp chưa từng được thiết kế.

## Overrun và safe-state

| Sự kiện | Hành động |
|---|---|
| Overrun lần đầu | Log + metric + alarm `E410` (warning) |
| Dưới ngưỡng | Cập nhật số đếm |
| **Đạt ngưỡng liên tiếp** | **Safe-state** + alarm `E411` (critical) |
| Chạy trong budget | Reset số đếm liên tiếp |
| Đang safe, đủ N lần tốt liên tiếp | Rời safe-state |

**Bất đối xứng có chủ ý:** vào safe sau N lần hỏng, nhưng ra cũng cần N lần
tốt. Ra ngay sau một lần tốt sẽ gây dao động vào/ra safe-state khi tải dao
động quanh ngưỡng — trạng thái tệ hơn cả ở yên trong safe.

**Safe-state luôn thắng đầu ra của Program.** Không có cấu hình nào cho phép
Program ghi đè safe-state.

## Đầu ra đi đâu

```
Program ST  ->  PriorityResolver (mức PRIO_LOCAL_LOGIC = 5)
                       |
            manual (2) / BACnet (3) / schedule (4) cùng tranh
                       v
                  safe-state override
                       v
                   OutputWriter -> MCU
```

Chương trình ST **không có đường tắt** ra thẳng phần cứng. Nó không thể vượt
mặt manual/BACnet/safety — bất biến này là **cấu trúc**, không phải kỷ luật.

## Cấu hình

Xem [`program_tasks.example.conf`](../../services/core/st/samples/program_tasks.example.conf).

Ràng buộc **fail-fast lúc boot** (cấu hình sai **không** chạy với "phần hợp lệ",
vì như vậy hệ chạy khác điều engineer nghĩ mà không ai biết):

- `id` duy nhất, 1..16 ký tự
- `priority` 0..7, **duy nhất** trong Resource (0 = cao nhất)
- `period_ms` 50..60000, **bội số của 50**
- `budget_ms` trong 1..`period_ms`
- `overrun_threshold` 1..100
- `order` duy nhất trong mỗi Task

## RETAIN

Biến `VAR RETAIN` giữ giá trị qua restart. Bản ghi có CRC-32 + `layout_hash`,
ghi atomic, giãn cách tối thiểu 60 s và chỉ ghi khi **giá trị đã đổi**.

**Đổi tên hoặc đổi kiểu biến RETAIN = mất giá trị retain.** Điều này **hiện ra**
bằng mã `RT-RETAIN-003`, không âm thầm đọc bytes của layout cũ. Cần ghi rõ cho
người vận hành khi triển khai phiên bản chương trình mới có sửa vùng RETAIN.
