# Program / Task Scheduler Specification — MK-DDC-24 FW SOM

> **Document ID:** SW-SCHED-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-07-28
> **Workstream:** C0.7 (MS-03)
> **Trạng thái:** Supporting As-Built — source hiện tại tại `apps/core/application/st/`; không phải Target authority Programming v2.2
> **Nguồn quyết định:** ADR-020; `PROGRAM_SOM_FW_DRAFT_DESIGN` §7.3, §7.4, §10; quyết định mô hình scheduler 2026-07-28
> **Tài liệu liên quan:** [`ST_SUBSET_SPEC`](ST_SUBSET_SPEC_MK-DDC-24_VI.md),
> [`TYPED_IR_ARTIFACT_SPEC`](TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md)

> **Thông báo supersede Target (2026-08-09):** mô hình multi-task và các đoạn
> gắn Task overrun với plant-wide safe-state/watchdog trong bản cũ không còn là
> Target Rev A. Target một Task `1/5/30 s`, base-step độc lập, fault/hold-last,
> priority 5 và cutover thuộc
> [`DDD-CTRL-PROG-001`](PROGRAMMING_CONTROL_SEMANTICS.md) và
> [`DDD-LIFE-PROG-001`](PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md).

---

## 1. Mô hình thực thi

**Fixed-priority, non-preemptive tại task boundary.**

Mô hình này được chọn thay vì preemptive vì ba lý do, theo thứ tự quan trọng:

1. **Nhất quán process image.** Một Program đọc snapshot đầu vào và ghi output staging.
   Nếu bị cắt ngang giữa chừng, một Task khác có thể nhìn thấy trạng thái nửa vời. Không
   preempt làm cho "process image không đổi trong một lần thực thi Program" thành bất
   biến cấu trúc, không phải quy ước cần kỷ luật.
2. **Không cần khoá.** Không preempt nghĩa là không có tranh chấp dữ liệu giữa các Task,
   nên không có mutex trong đường điều khiển, nên không có priority inversion và không có
   biến động thời gian do khoá.
3. **WCET cộng được.** Thời gian xấu nhất của một tick bằng tổng WCET các Task chạy trong
   tick đó — tính được bằng cộng, không cần phân tích lịch biểu phức tạp.

Giá phải trả: một Task chu kỳ dài có thể làm trễ Task chu kỳ ngắn tới đúng bằng WCET của
nó. Giá này được kiểm soát bằng **per-task budget** (§6) và được đo bằng jitter (§10).

---

## 2. Mô hình đối tượng

```text
Resource  (đúng 1 trên mỗi mkddc-core)
   │
   ├── Task[0..7]                  ── chu kỳ, ưu tiên, budget
   │      └── ProgramInstance[0..15]  ── thứ tự cố định trong Task
   │              └── Artifact         ── gói IR đã load
   │
   └── ProcessImage                ── ảnh vào/ra dùng chung
```

| Khái niệm | Định nghĩa | Giới hạn |
|---|---|---|
| **Resource** | Toàn bộ ngữ cảnh thực thi trong một `mkddc-core`. Sở hữu process image, bảng Task, đồng hồ. | Đúng 1 |
| **Task** | Đơn vị lập lịch. Có chu kỳ, ưu tiên, budget riêng. | ≤ 8 |
| **Program Instance** | Một lần "đặt" artifact vào một Task. Có trạng thái riêng (biến `VAR`, `VAR RETAIN`, state FB). | ≤ 16 mỗi Task, ≤ 32 toàn Resource |
| **Artifact** | Gói IR bất biến. Một artifact có thể được nhiều instance dùng chung. | ≤ 32 đã load |

**Instance khác artifact.** Hai instance của cùng artifact có **trạng thái hoàn toàn tách
biệt** — hai timer đếm độc lập. Điều này cho phép cùng một logic AHU chạy cho hai AHU khác
nhau mà không phải compile hai lần.

---

## 3. Cấu hình Task

Nguồn: `/data/config/program_tasks.conf` (JSON), nạp lúc khởi động và tại SIGHUP.

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "FAST",
      "priority": 0,
      "period_ms": 100,
      "budget_ms": 20,
      "enabled": true,
      "overrun_threshold": 5,
      "programs": [
        { "instance": "ahu1_ctrl", "artifact": "ahu_fan_v3.mkir", "order": 0, "enabled": true }
      ]
    },
    {
      "id": "NORMAL",
      "priority": 1,
      "period_ms": 1000,
      "budget_ms": 200,
      "enabled": true,
      "overrun_threshold": 3,
      "programs": [
        { "instance": "ahu2_ctrl", "artifact": "ahu_fan_v3.mkir", "order": 0, "enabled": true },
        { "instance": "reheat",    "artifact": "reheat_v1.mkir",  "order": 1, "enabled": true }
      ]
    }
  ]
}
```

| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `id` | chuỗi | `[A-Za-z0-9_]{1,16}`, duy nhất |
| `priority` | số nguyên | 0..7; **0 là cao nhất**; duy nhất trong Resource |
| `period_ms` | số nguyên | 50..60000; **phải là bội số của tick cơ sở** (§4) |
| `budget_ms` | số nguyên | 1..`period_ms`; xem §6 |
| `overrun_threshold` | số nguyên | 1..100 |
| `programs[].order` | số nguyên | 0..15, duy nhất trong Task |

Cấu hình sai ràng buộc → **fail-fast lúc boot**, giữ cấu hình cũ lúc SIGHUP
(cùng chính sách với `io_safe_state.conf` hiện có).

---

## 4. Tick cơ sở và lập lịch

Resource chạy một vòng lặp tick chu kỳ cố định. **Tick cơ sở = 50 ms.**

Mỗi tick:

```text
1. Chụp đồng hồ đơn điệu MỘT LẦN  -> now_ns  (mọi Task, mọi FB dùng chung mốc này)
2. Chụp process image đầu vào     -> input snapshot nhất quán
3. Áp mọi activation đang chờ     (§7 — CHỈ tại đây)
4. Với mỗi Task theo thứ tự PRIORITY tăng dần (0 trước):
       nếu Task enabled VÀ (now_ns - last_run_ns) >= period_ns:
           chạy Task  (§5)
           last_run_ns = mốc lý thuyết kế tiếp (không trôi)
5. Trọng tài ưu tiên + safe-state override
6. Commit output MỘT LẦN
7. Publish metrics / alarm / trace
8. Kick watchdog   (§9 — CHỈ khi các bước trên hoàn tất)
9. Ngủ tới tick kế theo mốc TUYỆT ĐỐI
```

**Vì sao chụp đồng hồ một lần cho cả tick:** hai timer khởi động trong cùng một tick phải
hết hạn trong cùng một tick. Nếu mỗi FB tự đọc đồng hồ, kết quả phụ thuộc thứ tự thực thi
và thời gian chạy của các Program trước nó — hành vi không tất định, không tái lập được
khi điều tra sự cố.

**Bù trôi:** `last_run_ns` cộng theo mốc lý thuyết, không theo thời điểm chạy thực. Task
100 ms chạy đúng 10 lần mỗi giây kể cả khi có tick bị trễ.

**Bỏ tick, không dồn:** nếu một Task bị lỡ nhiều chu kỳ (do tick trước quá dài), nó chỉ
chạy **một lần** ở tick kế, không chạy bù nhiều lần. Chạy bù sẽ làm timer nhảy và làm
tình trạng quá tải nặng thêm.

---

## 5. Thực thi một Task

```text
task_start = đồng hồ đơn điệu
staging    = bản sao output hiện tại của Task
với mỗi ProgramInstance theo `order` tăng dần:
    nếu instance disabled -> bỏ qua
    nạp input từ input snapshot vào slot theo IO_BINDING
    thực thi IR tới HALT hoặc fault
    nếu fault:
        huỷ TOÀN BỘ staging của Task
        ghi fault, thoát Task ngay (các Program sau KHÔNG chạy)
commit staging vào output của Task
exec_ns = đồng hồ đơn điệu - task_start
báo exec_ns cho OverrunMonitor  (§6)
```

**Fault của một Program huỷ staging của cả Task**, không chỉ riêng Program đó. Lý do: các
Program trong một Task thường phối hợp (Program 0 tính setpoint, Program 1 dùng nó).
Commit một phần sẽ đẩy đầu ra vào tổ hợp chưa từng được thiết kế.

---

## 6. Overrun và sức khoẻ Task

### 6.1 Phân tách trách nhiệm — bắt buộc

Bốn thành phần, **không được gộp**:

| Thành phần | Vị trí | Trách nhiệm | KHÔNG được làm |
|---|---|---|---|
| `CoreMetrics` | `diagnostics/` | Đếm và đo thuần tuý. Publish số liệu. | **Không** giữ ngưỡng an toàn, **không** có nhánh điều khiển nào |
| `OverrunMonitor` | `safety/` | So `exec_ns` với budget, đếm overrun tổng và liên tiếp, trả `should_force_safe()` | Không tự ép output |
| `SafetyManager` | `safety/` | Tổng hợp mọi nguồn nguy hiểm (IOP fault, SHM stale, input BAD, no controller, overrun) và quyết định vào/ra safe-state | Không đo thời gian |
| `AlarmRuntime` | `alarm/` | Tạo, ack, clear alarm | Không quyết định safe-state |

Lý do phân tách: `CoreMetrics` là thứ có thể tắt, lấy mẫu thưa, hoặc lỗi mà hệ vẫn phải
điều khiển đúng. Đặt quyết định an toàn vào đó khiến một thành phần **không thiết yếu**
nắm quyền **thiết yếu**, và làm chính sách an toàn không test được độc lập với bộ đếm.

### 6.2 Định nghĩa

- **Overrun** của Task: `exec_ns > budget_ns`.
- **Overrun liên tiếp**: số lần overrun không bị ngắt quãng bởi một lần chạy trong budget.

### 6.3 Chính sách

| Sự kiện | Hành động |
|---|---|
| Overrun lần đầu (`consecutive = 1`) | Log `WARN`; `CoreMetrics` tăng `total_overrun`; alarm `E410` mức *warning* |
| `1 < consecutive < threshold` | Cập nhật số đếm; giữ alarm `E410` |
| `consecutive >= threshold` | `OverrunMonitor::should_force_safe()` trả true → `SafetyManager` vào safe-state; alarm `E411` mức *critical* |
| Một lần chạy trong budget | `consecutive = 0`; alarm `E410` tự clear |
| Đang safe-state do overrun, và có **`threshold` lần liên tiếp** chạy trong budget | Rời safe-state; `E411` clear |

**Vào nhanh, ra chậm (bất đối xứng có chủ ý):** vào safe-state sau `threshold` lần hỏng,
nhưng ra khỏi safe-state cũng cần `threshold` lần tốt. Ra ngay sau một lần tốt sẽ gây dao
động vào/ra safe-state khi tải dao động quanh ngưỡng — trạng thái tệ hơn cả ở yên safe.

### 6.4 Safe-state do overrun

Áp dụng đúng cơ chế safe-state hiện có (`safety/safe_state.cpp`): AO về giá trị an toàn
theo mode (0 V hoặc 4 mA), DO mở. Overrun là **một trigger ngang hàng** với `fault`,
`stale`, `graph_input_bad`, `no_controller` — không phải đường riêng.

**Safe-state luôn thắng đầu ra của Program.** Không có cấu hình nào cho phép Program ghi
đè safe-state.

---

## 7. Vòng đời Program Instance

### 7.1 Máy trạng thái

```text
        upload/stage
 EMPTY ─────────────► STAGED
                        │ validate
                        ▼
                    VALIDATED
                        │ load (§6 C0.6)
              ┌─────────┼─────────┐
         reject         │ ok      │
              ▼         ▼         │
          REJECTED    READY       │
                        │ activate│
                        ▼         │
                     ACTIVE ──────┘
                        │ start
                        ▼
                    RUNNING ◄──┐
                     │  │      │ start
              stop   │  │ fault│
                     ▼  ▼      │
                 STOPPED  FAULTED
                     │
              disable│
                     ▼
                  DISABLED

  ROLLED_BACK: đạt được từ ACTIVE/RUNNING/FAULTED khi rollback về
               package tốt gần nhất
```

| Trạng thái | Nghĩa |
|---|---|
| `EMPTY` | Chưa có artifact |
| `STAGED` | Đã nhận bytes, chưa validate |
| `VALIDATED` | Header/hash/chữ ký PASS, chưa load vào runtime |
| `READY` | Đã load, bộ nhớ đã cấp, chưa chạy |
| `ACTIVE` | Là package hiện hành của instance |
| `RUNNING` | Đang được Task thực thi mỗi chu kỳ |
| `STOPPED` | Đã load, tạm dừng thực thi, giữ nguyên trạng thái biến |
| `DISABLED` | Bị loại khỏi lịch bởi cấu hình hoặc lệnh |
| `FAULTED` | Runtime fault; không thực thi cho tới khi có can thiệp |
| `ROLLED_BACK` | Đã quay về package tốt gần nhất |
| `REJECTED` | Loader từ chối; **package cũ vẫn chạy** |

### 7.2 Activation chỉ tại ranh giới tick

Yêu cầu activation được **xếp hàng** và áp dụng ở bước 3 của tick (§4), **không bao giờ**
giữa lúc một Program đang thực thi.

Bất biến activation:

- Activation thất bại → **package cũ tiếp tục chạy**, không có khoảng trống điều khiển.
- Package cũ chỉ được giải phóng **sau khi** package mới đã load xong và cấp phát xong.
- Instance mới bắt đầu ở trạng thái biến khởi tạo, **trừ** biến `RETAIN` khớp
  `layout_hash` (§8).
- Mỗi instance giữ **last-known-good**: package cuối cùng chạy được ≥ 1 tick không fault.

### 7.3 Lệnh điều khiển

| Lệnh | Từ trạng thái | Tới trạng thái | Ghi chú |
|---|---|---|---|
| `stage` | `EMPTY`, bất kỳ | `STAGED` | Không ảnh hưởng package đang chạy |
| `validate` | `STAGED` | `VALIDATED` / `REJECTED` | Không nạp vào runtime |
| `activate` | `VALIDATED` | `ACTIVE` / `REJECTED` | Áp tại ranh giới tick |
| `start` | `ACTIVE`, `STOPPED` | `RUNNING` | |
| `stop` | `RUNNING` | `STOPPED` | Đầu ra giữ giá trị cuối; **không** về safe-state |
| `disable` | bất kỳ | `DISABLED` | Loại khỏi lịch |
| `enable` | `DISABLED` | `STOPPED` | |
| `rollback` | `ACTIVE`,`RUNNING`,`FAULTED` | `ROLLED_BACK` → `RUNNING` | Về last-known-good |
| `reset` | `FAULTED` | `STOPPED` | Xoá fault, giữ trạng thái RETAIN |

**`stop` không đưa đầu ra về safe-state.** `stop` là hành động vận hành có chủ ý của
người có quyền; nếu cần đầu ra an toàn thì dùng safe-state hoặc lệnh ghi tường minh. Gộp
hai ý nghĩa sẽ làm người vận hành không biết mình đang yêu cầu điều gì.

Khi **mọi** instance đều `STOPPED`/`DISABLED`/`EMPTY`, `SafetyManager` xem như
`no_controller` và áp safe-state theo logic sẵn có — đây mới là chỗ "không ai điều khiển"
được xử lý, ở tầng Resource chứ không ở tầng lệnh.

---

## 8. RETAIN

| Khía cạnh | Quy định |
|---|---|
| Vị trí | `/var/lib/mkddc/retain/<instance_id>.bin` |
| Định dạng | header (magic `MKRT`, version u16, `layout_hash` u32, `record_size` u32, CRC-32 u32) + dữ liệu |
| Ghi | Atomic: ghi `.tmp` → `fsync` → `rename` → `fsync` thư mục |
| Nhịp ghi | Chỉ khi **có thay đổi** và **cách lần ghi trước ≥ 60 s**; cộng một lần khi shutdown sạch |
| Wear | Ghi tối đa ~1 440 lần/ngày/instance. Với eMMC ≥ 3 000 chu kỳ P/E và wear-leveling, biên an toàn rất lớn |
| Khôi phục | Chấp nhận **chỉ khi** magic đúng, version đúng, CRC đúng, `layout_hash` khớp artifact đang load |
| Từ chối | Cold start với giá trị khởi tạo + diagnostic `RT-RETAIN-001..004`; **không** chặn khởi động |

| Mã | Lý do từ chối |
|---|---|
| `RT-RETAIN-001` | Magic hoặc version sai |
| `RT-RETAIN-002` | CRC sai (nghi mất điện khi đang ghi) |
| `RT-RETAIN-003` | `layout_hash` khác (chương trình đã đổi biến RETAIN) |
| `RT-RETAIN-004` | `record_size` không khớp |

Không có nâng cấp bản ghi retain giữa các layout ở Rev A.0. Đổi biến RETAIN = mất giá
trị retain, và điều này phải được ghi rõ cho người vận hành trong tài liệu bàn giao.

---

## 9. Watchdog

| Quy tắc | Nội dung |
|---|---|
| Kick khi nào | **Chỉ sau khi hoàn tất trọn vẹn một tick** — hết bước 7 của §4 |
| Cấm | **Không** kick ở giữa tick, không kick từ thread phụ, không kick theo bộ đếm thời gian độc lập |
| Lý do | Watchdog phải chứng minh *chu kỳ điều khiển hoàn tất*, không phải *process còn sống*. Kick giữa tick khiến một tick treo vĩnh viễn vẫn kick đều và systemd không bao giờ khởi động lại — đúng loại lỗi watchdog sinh ra để bắt (`PROGRAM_SOM_FW_DRAFT_DESIGN` §9.2) |

Công thức chọn `WatchdogSec`:

```text
WatchdogSec  >=  2 × (chu kỳ Task lớn nhất)  +  WCET đo trên target  +  biên hồi phục 1 s
```

Giá trị **phải chốt từ số đo trên SOM target** (aarch64), không từ đo trên host dev.
Cho tới khi có số đo, giữ giá trị hiện hành và ghi rõ là tạm.

Khi systemd khởi động lại `mkddc-core`: trong khoảng process chưa chạy, MCU tự áp safe
timeout 200 ms (`IOP_SAFE_TIMEOUT_MS`) và ép AO/DO về an toàn. Đây là lớp bảo vệ **độc
lập với SOM** và là lý do việc restart chấp nhận được.

---

## 10. Metrics và alarm

### 10.1 Mỗi Task

| Metric | Nguồn |
|---|---|
| `exec_ns` lần cuối, lớn nhất, trung bình | `CoreMetrics` |
| `run_count`, `skip_count` | `CoreMetrics` |
| `overrun_total`, `overrun_consecutive` | `OverrunMonitor` |
| `fault_count`, mã fault cuối, `pc` cuối | `OverrunMonitor` |
| jitter tick (min/max/avg) | `CoreMetrics` |

### 10.2 Alarm

| Mã | Mức | Điều kiện | Tự clear |
|---|---|---|---|
| `E410` | warning | Task overrun ≥ 1 lần liên tiếp | ✅ khi chạy trong budget |
| `E411` | critical | Overrun liên tiếp ≥ threshold → safe-state | ✅ sau `threshold` lần tốt |
| `E412` | critical | Program runtime fault (`ST-RT-*`) | ❌ cần `reset` |
| `E413` | warning | Activation bị reject (`IR-E-*`) | ✅ khi activate thành công |
| `E414` | warning | Bản ghi RETAIN bị từ chối (`RT-RETAIN-*`) | ✅ lần ghi retain kế |

---

## 11. Yêu cầu verification

| Nhóm | Test bắt buộc |
|---|---|
| Thứ tự | Task chạy đúng thứ tự ưu tiên; Program chạy đúng `order` |
| Chu kỳ | Task FAST/NORMAL/SLOW chạy đúng số lần trong N giây; không trôi |
| Đồng thời | Nhiều Task đến hạn cùng tick → chạy đủ, đúng thứ tự ưu tiên |
| Bỏ tick | Task lỡ nhiều chu kỳ → chạy đúng **một** lần, không chạy bù |
| Fault | Program lỗi giữa Task → toàn bộ staging Task bị huỷ, Program sau không chạy |
| Overrun | 0 lần / 1 lần / dưới ngưỡng / đạt ngưỡng → safe-state / hồi phục bất đối xứng |
| Phân tách | Test khẳng định `CoreMetrics` không có API nào ảnh hưởng đầu ra |
| Vòng đời | Mọi chuyển trạng thái hợp lệ ở §7.3; mọi chuyển không hợp lệ bị từ chối ổn định |
| Activation | Activation lỗi giữ package cũ; áp đúng tại ranh giới tick |
| RETAIN | Cold start, warm restart, CRC sai, đổi layout, mất điện khi đang ghi |
| Watchdog (target) | Chu kỳ 100 ms / 1 s / 2 s; tick treo → systemd restart; overrun nhưng hồi phục → không restart |
| Instance | Hai instance cùng artifact có timer độc lập |

---

## 12. Revision history

| Rev | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-07-28 | Tạo mới. Đóng workstream C0.7 (MS-03). Chốt mô hình fixed-priority non-preemptive với 3 lý do; mô hình đối tượng Resource/Task/ProgramInstance/Artifact; tick cơ sở 50 ms, bù trôi, bỏ tick không dồn; đồng hồ chụp một lần mỗi tick; phân tách bắt buộc `CoreMetrics` / `OverrunMonitor` / `SafetyManager` / `AlarmRuntime`; chính sách overrun bất đối xứng vào nhanh ra chậm; máy trạng thái 11 trạng thái + 9 lệnh; RETAIN với wear-control 60 s; quy tắc watchdog chỉ kick sau tick hoàn tất kèm công thức `WatchdogSec`; 5 mã alarm; 12 nhóm test bắt buộc. |
