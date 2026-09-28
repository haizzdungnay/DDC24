# Đặc tả đề xuất: khối DDC cho thư viện SYSTEM — `RELAY_GUARD`, `STAGER`, `PULSE_GEN`, `WORD_TO_BITS`

> **Document ID:** SW-SYSTEM-DDC-BLOCKS-MK-DDC-24-VI
> **Phiên bản:** 0.1
> **Trạng thái:** Proposed — chờ Controls Lead duyệt đặc tả từng khối trước khi
> bump registry; **chưa code**
> **Issue:** [#801](https://github.com/Mekong-HCM/MK-DDC-24/issues/801) (finding **U-12** của
> [`REC-DDC-FIELD-USE-20260927`](../../07_records/reviews/DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md))
> **Mốc mã nguồn đối chiếu:** `main@9910b88` (2026-09-28)

## 0. Vì sao có tài liệu này trước khi có code

Registry khối được ghim:
[`pou_library_registry_v1.json`](../../../contracts/programming/pou_library_registry_v1.json)
`libraryVersion = rev-a.4`, 46 mục. `DDD-CTRL-PROG-001`
([`PROGRAMMING_CONTROL_SEMANTICS.md`](PROGRAMMING_CONTROL_SEMANTICS.md)) §7A đặt
luật: ngữ nghĩa của khối có trạng thái được **chốt trước khi code**, vì mỗi khối
thêm một giá trị wire `StFbType` và một layout RETAIN — hai thứ không sửa lại được
sau khi artifact chạy trên bo. Tài liệu này là bản đặc tả để Controls Lead duyệt.

## 1. Bằng chứng hiện trường

Chương trình 16 DO Modbus
([`PROGRAMMING_ST_DO16_MODBUS_GUIDE.md`](../../06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md)
§4) phải tự viết `FB_DO_CHANNEL`, `FB_STAGER`, `FB_BLINK`, `FB_STEP_TIMER`,
`FB_MASK_SPLIT`, và **mắc 4 lỗi hành vi** trong chính các khối đó; cả 4 chỉ lộ ra
qua mô phỏng hoặc kiểm từng chu kỳ trên bo:

| # | Lỗi | Khối đề xuất chặn lỗi này |
|---|---|---|
| 1 | Nhịp trôi 1,0 → 1,2 s do `TON` tự nạp lại (`IN := NOT Q`) | `PULSE_GEN` |
| 2 | STAGGER đóng dồn 7 relay | `STAGER` (chỉ tăng bậc khi đầu ra đã theo kịp) |
| 3 | STAGING nhả relay tạo "lỗ" và dồn nhau | `STAGER` (nhả LIFO) |
| 4 | Relay bị giữ 10 s khi đổi sang chế độ tải | `RELAY_GUARD` (`FORCE_OFF` bỏ qua đóng tối thiểu) |

Mã tham chiếu đã kiểm trên bo nằm ở guide §4.7–§4.10; các đặc tả dưới đây là
dạng chuẩn hoá của đúng hành vi đó.

## 2. Nguyên tắc chung

- **Mọi thời gian đo bằng đồng hồ Core** (thời điểm release của Program), không
  đếm số lần gọi — đổi chu kỳ Program không đổi hành vi.
- **Mốc cộng dồn, không nạp lại.** Bộ nhịp giữ mốc kế tiếp `next := next + period`,
  nên sai số không tích luỹ theo chu kỳ quét (bài học lỗi #1).
- **Không tràn im lặng.** Bộ đếm bão hoà ở trần kiểu (giống `CTU`, §7A.3); tham số
  sai là FAULT có mã (giống `HYSTERESIS` `HIGH <= LOW` → `ST-RT-006`).
- **Trạng thái ban đầu an toàn:** đầu ra `FALSE`/0 sau cold start.
- **RETAIN:** nêu rõ từng trường; mặc định không RETAIN thời gian đang chạy dở.

## 3. Đặc tả từng khối

### 3.1 `RELAY_GUARD` — bảo vệ một relay

| Cổng | Kiểu | Ý nghĩa |
|---|---|---|
| `CMD` (vào) | `BOOL` | Yêu cầu bật |
| `ENABLE` (vào) | `BOOL` | `FALSE` = cưỡng bức tắt **ngay**, bỏ qua `MIN_ON` |
| `MIN_ON` (vào) | `TIME` | Thời gian đóng tối thiểu |
| `MIN_OFF` (vào) | `TIME` | Thời gian nghỉ tối thiểu |
| `Q` (ra) | `BOOL` | Lệnh relay đã qua bảo vệ |
| `WAITING` (ra) | `BOOL` | `ENABLE AND (CMD XOR Q)` — lệnh chưa được thi hành vì đang chờ |
| `STARTS` (ra) | `DINT` | Số lần đóng, bão hoà ở 2 147 483 647 |

```text
nếu NOT ENABLE:                        Q := FALSE
nếu CMD AND NOT Q AND off_elapsed >= MIN_OFF:  Q := TRUE; STARTS := sat(STARTS + 1)
nếu NOT CMD AND Q AND on_elapsed >= MIN_ON:    Q := FALSE
```

- Sau cold start, `off_elapsed` bắt đầu từ 0: relay phải nghỉ đủ `MIN_OFF` mới
  đóng lần đầu (chống đóng dồn sau mất điện/Commission).
- `MIN_ON`/`MIN_OFF` âm không tồn tại (`TIME` không âm); không cần mã lỗi mới.
- RETAIN đề xuất: `STARTS`. Không RETAIN `Q`: sau mất điện relay phải đi lại
  đường nghỉ tối thiểu.

### 3.2 `STAGER` — bậc tải theo nhu cầu

| Cổng | Kiểu | Ý nghĩa |
|---|---|---|
| `RUN` (vào) | `BOOL` | `FALSE` = về 0 bậc ngay |
| `DEMAND` (vào) | `REAL` | Nhu cầu 0…100 %, ngoài dải bị kẹp |
| `MAX_STAGES` (vào) | `INT` | 1…16; ngoài dải → FAULT `ST-RT-006` |
| `STAGE_DELAY` (vào) | `TIME` | Khoảng tối thiểu giữa hai lần đổi bậc |
| `HOLD` (vào) | `BOOL` | Còn đầu ra chưa theo kịp (nối từ `WAITING` của `RELAY_GUARD`) ⇒ không đổi bậc |
| `STAGES` (ra) | `INT` | Số bậc hiện hành |
| `TARGET` (ra) | `INT` | Số bậc mục tiêu từ `DEMAND` |
| `MASK` (ra) | `UINT` | Bit 0…`STAGES`−1 bật — bậc đóng trước nằm ở bit thấp, nên giảm bậc nhả bit cao nhất trước (**LIFO**, không "lỗ") |

- `TARGET := round(DEMAND × MAX_STAGES / 100)`, làm tròn nửa ra xa 0.
- Mỗi lần chỉ đổi **một** bậc; hai lần đổi thật cách nhau ít nhất `STAGE_DELAY`;
  `HOLD = TRUE` chặn cả tăng lẫn giảm (bài học lỗi #2 và #3).
- Câu hỏi Q2: có đưa `MASK` vào khối không, hay để người dùng ghép với
  `WORD_TO_BITS`.

### 3.3 `PULSE_GEN` — bộ nhịp và xung vuông không trôi

| Cổng | Kiểu | Ý nghĩa |
|---|---|---|
| `RUN` (vào) | `BOOL` | `FALSE` ⇒ `Q := FALSE`, `TICK := FALSE`, mốc về 0 |
| `T_ON` (vào) | `TIME` | Thời gian `Q` bật |
| `T_OFF` (vào) | `TIME` | Thời gian `Q` tắt |
| `Q` (ra) | `BOOL` | Xung vuông |
| `TICK` (ra) | `BOOL` | `TRUE` đúng **một** lần release mỗi chu kỳ (`T_ON + T_OFF`) — thay cho `FB_STEP_TIMER` |
| `COUNT` (ra) | `DINT` | Số chu kỳ hoàn tất, bão hoà |

- Mốc cộng dồn theo đồng hồ Core; không dùng `TON` chạy tự do 12 h như bản tự
  viết (bản đó lệch một lần mỗi 12 h).
- `T_ON + T_OFF = T#0s` → FAULT `ST-RT-006` (một bộ nhịp chu kỳ 0 sẽ bật mọi lần
  release, không có nghĩa vật lý).
- Nếu cần tên IEC quen thuộc, `BLINK` là bí danh của `PULSE_GEN` với `TICK`/`COUNT`
  bỏ qua (Q3).

### 3.4 `WORD_TO_BITS` / `BITS_TO_WORD`

| Khối | Loại | Chữ ký |
|---|---|---|
| `WORD_TO_BITS` | FUNCTION_BLOCK (nhiều đầu ra) | `IN : UINT` → `B00 … B15 : BOOL` |
| `BITS_TO_WORD` | FUNCTION | `B00 … B15 : BOOL` → `UINT` |

- Không trạng thái; là FB chỉ vì cần 16 đầu ra.
- **Phụ thuộc #800:** nếu toán tử bit trên `UINT` được duyệt, khối này có thể cài
  bằng khai triển toán tử bit (giống `SCALE`/`DEADBAND`, §7A.6); nếu chưa, cài
  trong Core bằng một `StFbType` mới. Thứ tự đề xuất: chờ quyết định #800 để
  không phải đổi cách cài sau.

### 3.5 Thời gian đơn điệu / bộ đếm chu kỳ

Guide phải dùng `TON` chạy tự do 12 h để có đồng hồ. Đề xuất một FUNCTION không
tham số `UPTIME() : TIME` trả thời gian Core kể từ khi Program vào RUNNING, bão
hoà ở trần `TIME`. Đây là hàm **có phụ thuộc thời gian** — cần Controls Lead xác
nhận nó không phá tính thuần của FUNCTION người dùng (`ST-POU-002`): đề xuất chỉ
cho gọi trong PROGRAM/FUNCTION_BLOCK, không trong FUNCTION (Q4).

## 4. Ảnh hưởng registry và hợp đồng

| Mặt | Thay đổi |
|---|---|
| `pou_library_registry_v1.json` | +5 mục (`RELAY_GUARD`, `STAGER`, `PULSE_GEN`, `WORD_TO_BITS`, `BITS_TO_WORD`), +`UPTIME` nếu Q4 chấp thuận; `libraryVersion` `rev-a.4` → `rev-a.5`; re-pin `g1_contract_join_v1.json` |
| `StFbType` wire | Giá trị mới tiếp sau `HYSTERESIS = 9`; giá trị cũ giữ nguyên để artifact cũ byte-compatible |
| RETAIN layout | `RELAY_GUARD.STARTS`, `PULSE_GEN.COUNT` (nếu duyệt RETAIN) |
| Palette FE / Quick Library | Registry sinh sẵn; test parity `T59-804` phải xanh |
| `DDD-CTRL-PROG-001` | Thêm mục §7B cho bốn khối |
| `GUIDE-PROG-ST-DO16-001` | Thay `FB_DO_CHANNEL`/`FB_STAGER`/`FB_BLINK`/`FB_STEP_TIMER` bằng khối SYSTEM |

## 5. Test conformance (điều kiện đóng Issue)

| Mã | Test |
|---|---|
| T-801-1 | `RELAY_GUARD`: `MIN_ON`/`MIN_OFF` đúng tới một chu kỳ; `ENABLE=FALSE` tắt ngay kể cả trong `MIN_ON`; cold start chờ `MIN_OFF`; `STARTS` bão hoà |
| T-801-2 | `STAGER`: không bao giờ đổi quá một bậc giữa hai lần cách nhau < `STAGE_DELAY`; `HOLD` chặn cả hai chiều; `MASK` giảm theo LIFO; `MAX_STAGES` ngoài 1…16 → FAULT |
| T-801-3 | `PULSE_GEN`: sau 10 000 chu kỳ Program 100 ms, sai số pha tích luỹ = 0 (so với mốc lý thuyết); `TICK` đúng một lần mỗi chu kỳ; chu kỳ 0 → FAULT |
| T-801-4 | `WORD_TO_BITS` ∘ `BITS_TO_WORD` = đồng nhất trên 65 536 giá trị |
| T-801-5 | Tái hiện 4 lỗi hiện trường bằng bản tự viết cũ và chứng minh khối SYSTEM không mắc (differential) |
| T-801-6 | Parity registry ↔ palette FE (`T59-804`); `g1_contract_join_v1.json` re-pin |

## 6. Câu hỏi cần Controls Lead trả lời

| # | Câu hỏi | Đề xuất |
|---|---|---|
| Q1 | Chấp thuận ngữ nghĩa §3.1–§3.3 (thời gian theo đồng hồ Core, mốc cộng dồn, FAULT cho tham số vô nghĩa) | Có |
| Q2 | `STAGER` có đầu ra `MASK` LIFO | Có |
| Q3 | Thêm bí danh `BLINK` | Không; một tên cho một khối |
| Q4 | Thêm `UPTIME()` và giới hạn nơi gọi | Có, chỉ trong PROGRAM/FUNCTION_BLOCK |
| Q5 | RETAIN `STARTS`/`COUNT` | Có |

Tài liệu này **không** thay chữ ký cho Q1–Q5 và không tự bump registry.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-09-28 | Bản đặc tả đề xuất đầu tiên cho Issue #801 (U-12): bằng chứng 4 lỗi hiện trường, đặc tả `RELAY_GUARD`, `STAGER`, `PULSE_GEN`, `WORD_TO_BITS`/`BITS_TO_WORD`, `UPTIME`; ảnh hưởng registry `rev-a.4`, test conformance, câu hỏi duyệt |
