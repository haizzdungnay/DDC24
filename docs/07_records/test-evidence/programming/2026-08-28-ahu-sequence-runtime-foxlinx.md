# AHU VAV sequence — từ soạn thảo tới RUNTIME trên bo Foxlinx

| Thuộc tính | Giá trị |
|---|---|
| Ngày | 2026-08-28 |
| Bo | `SOM-DDC-24-foxlinx` (aarch64, Buildroot), `mkddc-fakemcu` mô phỏng I/O |
| Project | `SOAK-10P-20260824-172521` |
| Revision đưa vào vận hành | `51833815-c394-4b93-9afd-4a1435184ac3` |
| Kết quả | Check **PASSED** → Commission **SUCCEEDED** → Program **RUNNING** |

## 1. Kiến trúc đã nạp

Sáu POU đúng như thiết kế: `FN_ClampReal`, `FN_PctTo10V` (FUNCTION);
`FB_PI`, `FB_FanProof`, `FB_SafetyLatch` (FUNCTION_BLOCK); `AHU_MasterSequence`
(PROGRAM, chu kỳ 1000 ms). 28 binding: 16 `LOCAL:UI`, 6 `VP`, 6 ngõ ra
(`DO-01/02`, `AO-01..04`).

## 2. Bốn rào chắn gặp phải và cách gỡ

### 2.1 `CASE` không có trong compiler — ĐÃ BỔ SUNG

Máy trạng thái của thiết kế viết bằng `CASE`. Compiler từ chối ở đúng từ khoá
đó: `'CASE' is a keyword and cannot start a statement`. `CASE` là câu lệnh
**chuẩn** IEC 61131-3 §7.3.3.2, nên đây là thiếu sót của compiler chứ không phải
của thiết kế. Đã bổ sung (PR #306): 15 test, `ctest` 1327/1327, cross-build
aarch64 và deploy `/usr/sbin/mkddc-st-compile`.

### 2.2 Virtual Point chưa bind vào slot Core — `ST-IOMAP-004`

Catalog phát `VP1..VP7` nhưng compiler đòi định danh `AV-nn`/`BV-nn`. Nguyên
nhân: 7 VP có `boundPointId` **rỗng** — chúng chưa được nối vào slot `av_[]`/
`bv_[]` của Core, nên compiler từ chối là **đúng fail-closed**: một VP không có
slot thì không có gì để đọc/ghi.

Đã bind: `VP1→BV-1`, `VP2→AV-1`, `VP3→AV-2`, `VP4→AV-3`, `VP6→BV-2`,
`VP7→AV-4`. Catalog lập tức phát `BV-01`, `AV-01..04`.

`VP5` (`VP_AHU_STATE`, kiểu integer) **không bind được**: hợp đồng chỉ nhận
`AV-1..AV-32` và `BV-1..BV-16`, không có `MSV`. Vì vậy `AhuState` hiện không
xuất ra VP nào.

### 2.3 Ngõ vào số nằm trên kênh Universal Input — `ST-IOMAP-003`

`UI-09..UI-13` (Filter Dirty, Freeze Stat, Smoke, Fan Status, High Static) được
catalog khai `BOOL`, nhưng compiler đòi `UI` phải là `REAL`. Compiler đúng:
`st_process_image.cpp` ánh xạ `StPointKind::UI → PointKind::AI`, tức Core lưu
mọi Universal Input ở mảng **analog (float)** — một tiếp điểm khô vẫn vào đó
dưới dạng `0.0`/`1.0`.

Cách gỡ giữ đúng mô hình phần cứng: đọc chúng dưới dạng `REAL` rồi **ngưỡng
hoá** ngay đầu chu kỳ, trước mọi logic:

```iecst
FilterDirtyRaw := FilterDirtyRawAi > 0.5;
FreezeStatRaw  := FreezeStatRawAi  > 0.5;
SmokeRaw       := SmokeRawAi       > 0.5;
FanStatusRaw   := FanStatusRawAi   > 0.5;
HighStaticRaw  := HighStaticRawAi  > 0.5;
```

Thân chương trình **không đổi một dòng** vì tên BOOL cũ được giữ nguyên làm biến
cục bộ.

### 2.4 Binding phải trỏ biến có thật trong `locals[]` — `ST-CLI-LIMIT`

`io_map` dựng từ mảng `locals[]` của POU; binding trỏ `variableId` không có ở đó
thì cả Check hỏng. Đã `upsertVariable` cho 5 biến đổi tên và 6 ngõ ra mới trước
khi tạo binding.

## 3. Bằng chứng RUNTIME

```
program 209edf4c…  state=RUNNING  core=RUNNING  enabled=True
                   period=1000ms  lastExec=32,96µs  maxExec=33,84µs  missed=0
task main          state=RUNNING  runCount=44801   overrun=0
```

Lát cắt lúc hệ đang chạy bình thường (quạt có tín hiệu chạy):

| Đầu vào | Giá trị | Ngõ ra | Giá trị | Diễn giải |
|---|---:|---|---:|---|
| `DSP` | 233,9 Pa | `AO-01` quạt | 5,87 → 7,08 V | Dưới SP 250 Pa ⇒ PI **tăng** tốc độ |
| `OAT` / `RAT` | 40,0 / 25,5 °C | `AO-02` economizer | 2,0 V | OA nóng hơn RA ⇒ economizer **không khả dụng**, giữ mức tối thiểu 20% |
| an toàn | không trip | `DO-01` quạt | True | Cho phép chạy |
| — | — | `DO-02` báo động | False | Không có cảnh báo |

Ba hành vi trên khớp đúng thiết kế: PI điều áp suất tĩnh, economizer khoá khi
không khí ngoài không làm mát được, và interlock an toàn cho phép chạy.

## 4. Chuỗi an toàn đã tự chứng minh

Sau đó `UI-12 Fan Status` chuyển **False** (mất tín hiệu quạt chạy). Chương
trình phản ứng đúng chuỗi thiết kế:

```
FanCmdInt=TRUE, Status=FALSE → TON 15 s → FanProofFail latched
→ AhuState = 90 (FAULT) → mọi ngõ ra về 0 → CommonAlarm = TRUE
```

Đo được: `DO-01=False`, `AO-01..04 = 0`, `DO-02=True`. Fault **latch** và chỉ
mở khi có `ResetCmd` **và** điều kiện trip đã hết — đúng `FB_FanProof`.

Đây là bằng chứng mạnh hơn một lát cắt "chạy tốt": hệ đã **phát hiện sự cố và
tự đưa thiết bị về trạng thái an toàn**.

## 5. Điều lát này KHÔNG chứng minh

- **Chưa nghiệm thu I/O vật lý.** `mkddc-fakemcu` đang mô phỏng I/O trên bo này;
  mọi giá trị ở trên là của mạch mô phỏng, không phải cảm biến/actuator thật.
- **Hệ số PI, ngưỡng, thời gian proof là giá trị đề xuất**, chưa tune trên AHU
  thật.
- **Chưa quan sát được nhánh làm lạnh cơ khí** (`AO-03`): trong cửa sổ đo, hệ ở
  trạng thái FAULT do mất fan proof, nên van CHW giữ 0 theo đúng luật an toàn.
  Cần một cửa sổ có fan proof ổn định để nghiệm thu nhánh này.
- `AhuState` **chưa xuất ra VP** (xem §2.2) nên chưa đọc được trạng thái máy từ
  giao diện.
- `RELEASE_READY` giữ **NO-GO**.
