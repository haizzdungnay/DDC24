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

## 5. Mô phỏng fake MCU và chỉnh định trực tiếp (bổ sung 2026-08-28)

### 5.1 Fake MCU đã mô phỏng đúng vật lý — không cần sửa

`tools/fake_mcu/fake_mcu.cpp` đã mô hình AHU khép kín: `UI-12` (Proof of Flow)
là **tiếp điểm khô bám theo `DO-01`** với trễ khởi động `SIM_FAN_SPINUP_S = 2 s`,
`UI-09` Filter DP bẩn dần theo giờ quạt chạy, `UI-10` Freeze Stat trip khi
MAT < 3 °C, và van lạnh mở làm SAT tụt thật. Không phải mô phỏng tĩnh.

Việc mất proof trước đó **không phải lỗi mô phỏng**: chuỗi an toàn latch fault,
lệnh quạt về 0, nên tiếp điểm cũng về 0 — đúng vật lý. Gỡ bằng cách xung
`ResetCmd` **giữ qua vài chu kỳ quét**: `rtReset` là `R_TRIG`, một xung
true→false trong cùng một chu kỳ 1 s sẽ không sinh cạnh nào.

### 5.2 Bảy Virtual Point tham số chỉnh định

Hệ số PI và các mức tối thiểu chuyển từ **hằng số trong mã nguồn** thành
`VAR_INPUT` đọc từ VP: `VP_FAN_KP` (AV-12), `VP_FAN_KI` (AV-06),
`VP_MIN_FAN_PCT` (AV-07), `VP_MIN_OA_PCT` (AV-08), `VP_COOL_KP` (AV-09),
`VP_COOL_KI` (AV-10), `VP_PROOF_S` (AV-11, chưa nối vì cần đổi REAL→TIME).

Lý do không phải tiện tay: bắt người vận hành sửa mã rồi Check + Commission lại
chỉ để đổi một hệ số là bắt họ dùng cả một chu trình phát hành cho một nút vặn.

### 5.3 Chỉnh định LÚC ĐANG CHẠY đã dập được dao động thật

Với hệ số đề xuất ban đầu (`CoolKp=12`, `CoolKi=0.20`) hệ **hunting bang-bang**:

```
02:15:25  SAT=10.8  CHW=10V  HW=0
02:15:26  SAT=24.9  CHW=0    HW=6.96V
02:15:27  SAT=11.1  CHW=10V  HW=0     ← đảo mỗi chu kỳ
```

Hạ xuống `CoolKp=1.5`, `CoolKi=0.05` **qua VP, không biên dịch lại**:

```
02:17:01  Fan=True AO1=4.38V DSP= 89 Pa  SAT=24.23  CHW=1.35V  HW=0
02:17:05  Fan=True AO1=5.44V DSP=138 Pa  SAT=24.30  CHW=1.49V  HW=0
02:17:09  Fan=True AO1=6.12V DSP=176 Pa  SAT=23.76  CHW=1.58V  HW=0
02:17:13  Fan=True AO1=6.57V DSP=203 Pa  SAT=23.91  CHW=1.72V  HW=0
```

Quạt ramp đơn điệu về SP 250 Pa, van lạnh mở dần theo sai lệch, van nóng đóng,
economizer khoá (OAT nóng hơn RA), không báo động. **Nhánh làm lạnh cơ khí nay
đã quan sát được** — mục còn nợ ở §5 bản trước.

## 6. Hai lỗi sản phẩm phát hiện thêm

### 6.1 Check PASSED nhưng Core từ chối artifact lúc nạp

Ràng buộc ngõ ra chương trình vào `DO-03`/`DO-04` (hai relay dự phòng) cho
**Check PASSED và Commission SUCCEEDED**, nhưng Core báo `FAULTED` với
`lastExecNs = 0` — hỏng ngay lúc nạp, chưa chạy được một chu kỳ nào. Gỡ đúng hai
binding đó thì chương trình chạy lại tức thì (`RUNNING`, 21 µs).

Đây là **lỗ hổng của cổng tiền kiểm**: Check là thứ người vận hành dựa vào để
quyết định có nạp xuống thiết bị hay không, mà nó lại nói PASS cho một gói Core
sẽ từ chối. Hệ quả thực tế: người dùng Commission thành công rồi ngồi nhìn một
chương trình không bao giờ chạy, không có thông điệp nào giải thích.

### 6.2 Giá trị Virtual Point biến mất sau khi Core khởi động lại

`syncBoundVirtualPointsToCore` chỉ chạy lúc **web-api** khởi động. Khi **Core**
khởi động lại, `av_[]`/`bv_[]` trở về 0 và không có gì đẩy lại — nên mọi VP đã
bind bỗng đọc thành `0`/`false` trong chương trình, **im lặng**. Quan sát được:
sau khi restart Core, `VP_OCCUPIED` đọc thành false nên AHU không rời trạng thái
OFF; restart web-api thì giá trị trở lại và hệ chạy.

Cùng họ với lỗi 6.1 và với lỗi VP `writable=false` ở §2.2: một giá trị sai được
đưa vào vòng điều khiển mà không có dấu hiệu nào.

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
