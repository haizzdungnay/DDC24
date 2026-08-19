# UI/UX Spec — Web · Lịch vận hành (`/eng/scheduler/*`)

> **Document ID:** KX-DDC24-UX-WEB-SCHEDULER-001-VI
> **Trạng thái:** Active | **Phiên bản:** 1.0 | **Ngày lập:** 2026-08-07
> **Chủ quản:** Product Owner + SW Lead
> **Phạm vi:** Đặc tả trình bày và tương tác cho họ trang `/eng/scheduler/*`.
> **Không bao gồm:** hợp đồng dữ liệu (thuộc [`schedule_v3_1.schema.json`](../../contracts/config/schedule_v3_1.schema.json)),
> panel lịch HMI cục bộ, BACnet Schedule Object (P4).
> **Tài liệu liên quan:** [ADR-023](../adr/ADR-023-scheduler-v3-1-priority-transport-va-pham-vi.md) ·
> [UC-WEB-SCHEDULER-001](KX-DDC24-UC-WEB-SCHEDULER-001_VI.md) ·
> [UX-SYSTEM-001](KX-DDC24-UX-SYSTEM-001_VI.md) (token & component) ·
> [Plan 50](../03_implementation/archive/50_SCHEDULER_V3_1_IMPLEMENTATION_PLAN.md)

---

## 1. Vì sao tài liệu này tồn tại

Trang lịch cũ là **một tập tin 756 dòng gánh cả 11 màn hình** mà đặc tả đòi, và hiển thị nhãn
thanh ghi `TSx 0`…`TSx 11` cho người dùng cuối. Tài liệu này là **authority về trình bày** cho
họ trang mới. Hợp đồng dữ liệu vẫn thuộc JSON Schema và OpenAPI theo thứ tự thẩm quyền ở
`docs/00_governance/CONTROL.md`.

## 2. Nguyên tắc bắt buộc

| # | Nguyên tắc | Vì sao |
|---|---|---|
| S1 | **Không nhắc `TSx`** ở nhãn, tooltip, tên trường, hằng số, test | Đặc tả §23 và acceptance #20 |
| S2 | **Ý định và sự thật luôn tách khối.** Cấu hình một bên, `runtime` của controller một bên | FE-DIAG-01 (review 2026-08-06): trang bịa dữ liệu vì trộn hai nguồn |
| S3 | **Thiếu số liệu thì `—`.** Không `0`, không `OK`, không `online` | Kế thừa P1 của UX-WEB-NETWORK-001 |
| S4 | **Phép biên dịch Start/End → Time-Value luôn nhìn thấy được** | Không thấy thì không hiểu mô hình, và sẽ dựng sai lịch |
| S5 | **Thao tác ghi ra thiết bị phải xác nhận, nêu đích danh target và giá trị sau thao tác** | Tắt một lịch là ra lệnh thật cho quạt và van |
| S6 | **Lỗi mang mã đặc tả §11**, bấm được để nhảy tới ô sai | Kỹ thuật viên hiện trường không có log |
| S7 | **Kéo thả luôn có đường bàn phím tương đương** | Tủ điện dùng màn hình chạm nhỏ; commissioning cần thao tác nhanh |
| S8 | **Màu không bao giờ là kênh thông tin duy nhất** | Đọc được khi in đen trắng và khi người dùng mù màu |

## 3. Kiến trúc thông tin

Đặc tả §17 liệt kê 11 màn hình. Dựng 11 route rời là sai — người dùng mất dấu bối cảnh giữa
"lịch nào" và "màn nào". Gom thành **4 route + tab con**, theo khuôn `ModbusRtuLayout` đã chạy
thật trong dự án.

```
/eng/scheduler                     ← Grid 64 lịch (Mode 2) + đo dung lượng
/eng/scheduler/runtime             ← Logic Cards (Mode 3), giám sát trực tiếp
/eng/scheduler/exceptions          ← Thư viện ngày lễ / nhóm ngoại lệ dùng chung
/eng/scheduler/:id                 ← Editor một lịch, 6 tab:
        ├── (index) Tuần           ← Weekly Calendar (Mode 1)
        ├── ngoai-le               ← Exception Manager của lịch này
        ├── target                 ← Target Mapping
        ├── mo-phong               ← Simulation Preview
        ├── revision               ← Revision History + Rollback
        └── audit                  ← Audit Log của lịch này
```

**Publish Review là modal toàn màn hình, không phải route** — nó là một khoảnh khắc quyết định,
không phải một nơi để lui tới.

| Màn hình đặc tả §17 | Ở đâu |
|---|---|
| Schedule List | `/eng/scheduler` |
| Schedule Editor | `/eng/scheduler/:id` |
| Weekly Calendar | tab **Tuần** |
| Exception Manager | tab **Ngoại lệ** + `/eng/scheduler/exceptions` |
| Target Mapping | tab **Target** |
| Simulation Preview | tab **Mô phỏng** |
| Publish Review | modal diff |
| Runtime Monitor | `/eng/scheduler/runtime` |
| Revision History | tab **Revision** |
| Audit Log | tab **Audit** |
| Diagnostics | dải cảnh báo trên `/eng/scheduler/runtime` + huy hiệu lỗi trên từng thẻ |

---

## 4. `/eng/scheduler` — Grid 64 lịch

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Lịch vận hành                          [12/64 lịch] [7/64 điểm ghi] [2 lệch]   │
│ Weekly Schedule · Ngoại lệ · Publish có kiểm chứng                             │
│                              [Tải lại] [Nhập] [Xuất] [+ Lịch mới] [Publish 3 ▾]│
├────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ 4 lịch đã chuyển từ định dạng cũ — kiểm tra rồi publish lại.    [Xem] [Ẩn]  │
├────────────────────────────────────────────────────────────────────────────────┤
│ [Tìm…]  Trạng thái ▾  Kiểu giá trị ▾  Target ▾  ☐ Chỉ lịch lệch revision       │
├──┬────────┬──────────────┬─────────┬──────────┬───────────┬─────┬────────┬─────┤
│☐ │ ID     │ Tên          │ Trạng   │ Tuần     │ Ngoại lệ  │ Tgt │ Hiện tại│Kế  │
├──┼────────┼──────────────┼─────────┼──────────┼───────────┼─────┼────────┼─────┤
│☐ │SCH-001 │HVAC Văn phòng│●PUBLISH │T2-T6 08-18│ 2         │ 3   │ BẬT    │18:00│
│☐ │SCH-002 │Đèn hành lang │●ACTIVE  │T2-CN 06-22│ 1         │ 2   │ BẬT    │22:00│
│☐ │SCH-003 │Setpoint AHU  │◐DRAFT   │T2-T6 07-19│ —         │ 1   │ —      │ —   │
│☐ │SCH-004 │Bơm nước      │▲OUT_SYNC│T2-T7 05-21│ 3         │ 2   │ TẮT    │05:00│
│  │        │              │  rev 7≠5│           │           │     │        │     │
└──┴────────┴──────────────┴─────────┴──────────┴───────────┴─────┴────────┴─────┘
   ↑ cột ID + Tên đóng băng khi cuộn ngang · ảo hoá hàng · chọn nhiều để publish/bật/tắt hàng loạt
```

**Quyết định trình bày:**

- **Cột `Tuần` là chữ tóm tắt, không phải mini-chart.** `T2-T6 08-18` đọc được ngay; một biểu đồ
  7 ô rộng 4 mm thì không. Nhiều khoảng trong ngày hiển thị `T2-T6 08-12, 13-18`, cắt bằng `…`
  kèm tooltip đầy đủ.
- **`Hiện tại` và `Kế tiếp` đến từ khối `runtime`** (S2). Chưa publish ⇒ `—`, không phải giá trị
  tính ở trình duyệt.
- **`OUT_OF_SYNC` chiếm hai dòng.** Nó là trạng thái duy nhất người dùng phải hành động ngay;
  nén bằng kích cỡ với các trạng thái khác là giấu nó đi.
- **Đồng hồ dung lượng ở header là bắt buộc** (ADR-023 QĐ-3): trần đặc tả là 32 target/lịch nhưng
  bo chỉ có 64 điểm ghi nội bộ. Cảnh báo màu khi ≥ 80%, chặn khi đạt 100%.
- **Sửa tại chỗ chỉ mở cho Tên, Bật/Tắt, Priority.** Sửa `weekly_schedule` trong một ô bảng là
  mời gọi lỗi.

---

## 5. Tab **Tuần** — Weekly Calendar

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ← SCH-001 · HVAC Văn phòng                    ●PUBLISHED rev 5  [Bật ●] [Lưu]  │
│ [Tuần] [Ngoại lệ 2] [Target 3] [Mô phỏng] [Revision] [Audit]                   │
├────────────────────────────────────────────────────────────────────────────────┤
│ Kiểu giá trị BINARY 🔒   Mặc định: TẮT   Hiệu lực: 01/01/2026 → không kết thúc  │
│ Priority ghi: 16  (mức schedule của controller)   Múi giờ: Asia/Ho_Chi_Minh     │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬────────────────────────┤
│      │  T2  │  T3  │  T4  │  T5  │  T6  │  T7  │  CN  │  Cặp Time-Value  (S4)  │
│ 00 ──┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤  ┌──────────────────┐  │
│ 06 ──┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤  │ T2               │  │
│ 08 ──┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼──────┼──────┤  │ 08:00:00 = BẬT   │  │
│ 10 ──┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼──────┼──────┤  │ 12:00:00 = TẮT   │  │
│ 12 ──┼─░░░░─┼─░░░░─┼─░░░░─┼─░░░░─┼─░░░░─┼──────┼──────┤  │ 13:00:00 = BẬT   │  │
│ 13 ──┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼──────┼──────┤  │ 18:00:00 = TẮT   │  │
│ 16 ━━┿━▓▓▓▓━┿━━━━━━┿━━━━━━┿━━━━━━┿━━━━━━┿━━━━━━┿━━━━━━┥   ← bây giờ 16:24      │
│ 18 ──┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤  [Sao chép T2 sang…]   │
│ 24 ──┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘  [+ Thêm khoảng]       │
│      ▓ BẬT   ░ TẮT (mặc định)   ▒ ngoại lệ ghi đè                              │
├────────────────────────────────────────────────────────────────────────────────┤
│ Đang hiệu lực: BẬT · nguồn: Lịch tuần · chuyển kế tiếp 18:00 hôm nay (còn 1h36) │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Quyết định trình bày:**

- **Bảng Time-Value nằm ngay cạnh lịch, không giấu sau tab.** Đây là hiện thân của S4: vẽ khối bên
  trái, cặp giá trị hiện bên phải theo thời gian thực. Người dùng phải **thấy được** vì sao một
  khoảng `08:00 → 18:00` lại sinh ra **hai** sự kiện chứ không phải một. Đây là điểm dạy nghề
  quan trọng nhất của toàn bộ trang.
- **`Kiểu giá trị BINARY 🔒`** — ổ khoá nói rằng đã có target thì không đổi được nữa. Bấm vào khoá
  giải thích tại sao và cách đổi.
- **Dải runtime dưới cùng luôn hiện diện ở mọi tab** — người dùng không bao giờ sửa lịch mà không
  thấy lịch đang làm gì.
- **Đường "bây giờ" theo `timezone` của lịch**, không theo TZ trình duyệt.

**Bàn phím (S7):**

| Phím | Hành động |
|---|---|
| `Tab` | Chuyển khối |
| `←` `→` | Dời khối 5 phút |
| `Shift` + `←` `→` | Đổi thời lượng 5 phút |
| `Enter` | Mở ô nhập giờ chính xác |
| `Delete` | Xoá khối |
| `Ctrl` + `D` | Sao chép ngày đang chọn |

---

## 6. Tab **Ngoại lệ** — Exception Manager

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Ngoại lệ của SCH-001            Ghi đè lịch tuần khi ngày khớp   [+ Thêm]       │
├────────────────────────────────────────────────────────────────────────────────┤
│ ⛔ SCH-CONFIG-003 — EXC-002 và EXC-003 cùng rơi vào 02/09/2026 và cùng          │
│    event_priority = 5. Hệ thống KHÔNG tự chọn. Hãy đổi priority một trong hai.  │
│    [Tới EXC-002]  [Tới EXC-003]                                                │
├─────┬─────────────────┬──────────────────┬──────────┬──────────────────────────┤
│ Ưu  │ Tên             │ Quy tắc ngày     │ Sự kiện  │ 12 tháng tới rơi vào     │
├─────┼─────────────────┼──────────────────┼──────────┼──────────────────────────┤
│  1  │ Quốc khánh      │ NGÀY 02/09/2026  │00:00 TẮT │ 02/09/2026               │
│  3  │ Tết Nguyên đán  │ KHOẢNG 14→20/02  │00:00 TẮT │ 14,15,16,17,18,19,20/02  │
│  5  │ Bảo trì thứ 2   │ TUẦN N T2 đầu th.│06:00 BẬT │ 07/09, 05/10, 02/11 …    │
│  5  │ Nhóm lễ công ty │ NHÓM "Lễ công ty"│00:00 TẮT │ 02/09 ⚠, 24/12, 31/12    │
└─────┴─────────────────┴──────────────────┴──────────┴──────────────────────────┘
```

**Cột "12 tháng tới rơi vào" là bắt buộc, không phải tuỳ chọn.** `WEEK_N_DAY` và `HOLIDAY_GROUP`
là hai kiểu quy tắc con người **không** tính nhẩm được — không có cột này thì người dùng publish
một quy tắc mà không biết nó sẽ nổ vào ngày nào. Ngày đụng độ mang dấu ⚠ và liên kết tới đúng
dòng cảnh báo phía trên.

---

## 7. Tab **Target** — Target Mapping

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Target của SCH-001 · kiểu BINARY · priority ghi 16          [+ Thêm target]     │
│ Chỉ điểm ghi được và tương thích BINARY mới hiện trong danh sách.               │
├───┬──────────┬────────────┬──────────┬───────────────┬─────────────────────────┤
│   │ Điểm     │ Loại       │ Ghi được │ Giá trị thật   │ Kết quả ghi lần cuối    │
├───┼──────────┼────────────┼──────────┼───────────────┼─────────────────────────┤
│ ⣿ │ DO-01    │ Nội bộ / BO│ ✓        │ BẬT           │ OK · 16:00:00           │
│ ⣿ │ DO-02    │ Nội bộ / BO│ ✓        │ BẬT           │ OK · 16:00:00           │
│ ⣿ │ BV-03    │ Nội bộ / BV│ ✓        │ TẮT ⚠         │ SCH-WRITE-002 timeout   │
│   │          │            │          │               │ 3 lần · [Chi tiết]      │
├───┴──────────┴────────────┴──────────┴───────────────┴─────────────────────────┤
│ ℹ Một target lỗi không chặn các target khác (đặc tả §11). SCH-001 vẫn đang chạy.│
└────────────────────────────────────────────────────────────────────────────────┘
```

Danh sách chọn target **lọc sẵn** theo `value_type` và cờ ghi được, thay vì cho chọn tự do rồi
báo `SCH-TARGET-002`/`003` sau — chặn sớm tại chỗ nhập.

Ô `priority_for_writing` đặt cạnh bảng này, luôn kèm câu giải thích:

> Priority **16** phân xử giữa các lịch cùng ghi một điểm. Mọi lịch đều ở **mức 4** của controller,
> nên lệnh tay tại chỗ (mức 2) vẫn thắng — kể cả khi bạn đặt priority 1.

---

## 8. Tab **Mô phỏng** — Simulation

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Mô phỏng   ( • 7 ngày   ○ 30 ngày   ○ Ngày cụ thể [__/__/____] )   [Chạy lại]  │
├────────────────────────────────────────────────────────────────────────────────┤
│  T2 07/08 ░░░░░░░░▓▓▓▓▓▓▓▓░░░░▓▓▓▓▓▓▓▓░░░░░░  Tuần                             │
│  T3 08/08 ░░░░░░░░▓▓▓▓▓▓▓▓░░░░▓▓▓▓▓▓▓▓░░░░░░  Tuần                             │
│  T7 12/08 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Mặc định                          │
│  CN 13/08 ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  Ngoại lệ EXC-001                 │
│           0    4    8   12   16   20   24                                       │
├────────────────────────────────────────────────────────────────────────────────┤
│ 12 lần chuyển trạng thái · 0 khoảng trống · 0 xung đột                         │
│                                                                                 │
│ 07/08/2026 08:00  Tuần(T2)      → BẬT   → DO-01, DO-02, BV-03   prio 16        │
│ 07/08/2026 12:00  Tuần(T2)      → TẮT   → DO-01, DO-02, BV-03   prio 16        │
│ 13/08/2026 00:00  EXC-001       → TẮT   → DO-01, DO-02, BV-03   prio 16        │
└────────────────────────────────────────────────────────────────────────────────┘
```

Mô phỏng **chạy ở backend bằng đúng mã đánh giá của controller**. Cài lại thuật toán trong
JavaScript hay Go là tự nói dối: nó đúng cho tới ngày hai bản lệch nhau, và ngày đó không ai biết.

---

## 9. Publish Review — modal diff

```
┌──────────────────── Publish SCH-001 xuống controller ──────────────────────────┐
│                    ĐANG CHẠY rev 5          →          SẼ CHẠY rev 6           │
│ Lịch tuần T2-T6      08:00 BẬT / 18:00 TẮT     08:00 BẬT / 12:00 TẮT ▲        │
│                                                 13:00 BẬT / 18:00 TẮT ▲        │
│ Ngoại lệ                    1                          2 ▲                     │
│ ⚠ Target                DO-01, DO-02              DO-01, DO-02, BV-03 ▲        │
│ ⚠ Priority ghi              16                         16                      │
│ Mặc định                   TẮT                        TẮT                      │
├────────────────────────────────────────────────────────────────────────────────┤
│ Lý do thay đổi (bắt buộc, vào audit)                                           │
│ [ Bổ sung nghỉ trưa 12:00-13:00 theo yêu cầu BQL___________________________ ]  │
│                                                                                 │
│ Publish sẽ ghi BV-03 lần đầu tiên. Lịch cũ vẫn chạy tới khi controller ACK.     │
│                                             [Huỷ]  [Publish và chờ ACK]        │
└────────────────────────────────────────────────────────────────────────────────┘
```

Chuỗi trạng thái sau khi bấm:

```
Đang gửi…  →  Chờ ACK (đếm ngược 5 s)  →  ✓ Đã ACK, rev 6 đang chạy
                                        ✗ NACK: SCH-PUBLISH-001
                                          → rev 5 vẫn đang chạy, không có gì thay đổi
                                        ⧗ Timeout
                                          → rev 5 vẫn đang chạy, không có gì thay đổi
```

**Dòng cuối của hai nhánh hỏng là bắt buộc.** Người dùng phải biết chắc hệ thống **không** rơi
vào trạng thái nửa vời.

---

## 10. `/eng/scheduler/runtime` — Logic Cards

Mỗi thẻ vẽ đúng chuỗi đặc tả §16.3, đọc từ trái sang phải:

```
┌── SCH-001 · HVAC Văn phòng ────────────────────────── ●ACTIVE rev 6 ───────────┐
│                                                                                 │
│  Lịch tuần T2 ──┐                                                               │
│                 ├──→  BẬT  ──→  prio 16  ──┬──→ DO-01   BẬT   ✓                │
│  Ngoại lệ ──────┘     nguồn: Tuần          ├──→ DO-02   BẬT   ✓                │
│  (không áp dụng)      chuyển 18:00         └──→ BV-03   TẮT   ⚠ SCH-WRITE-002  │
│                                                                                 │
│  ⚠ DO-02 đang bị Local Manual (mức 2) giữ — lệnh lịch không tới được đầu ra.    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Dòng cảnh báo cuối là **lý do trang này tồn tại**: nó trả lời câu hỏi "lịch bật rồi mà sao quạt
không chạy" — câu tốn nhiều thời gian hiện trường nhất, và là câu mà trang cũ hoàn toàn im lặng.

---

## 11. Trạng thái và màu

| Trạng thái | Ký hiệu | Token | Ghi chú |
|---|---|---|---|
| `DRAFT` | ◐ viền đứt, chữ mờ | `--c-text-dim` | Chưa áp dụng |
| `VALIDATED` | ◑ viền liền, chưa tô | `--c-border` | Đã kiểm hợp lệ |
| `PUBLISHED` | ● chấm đặc | `--c-accent` | Đã gửi xuống controller |
| `ACTIVE` | ● chấm đặc + nhịp thở | `--c-good` | Đang chạy và có hiệu lực |
| `INACTIVE` | ○ chấm rỗng | `--c-text-dim` | Ngoài effective period hoặc chưa có event |
| `DISABLED` | ⊘ gạch chéo | `--c-text-dim` | Người dùng đã tắt |
| `ERROR` | ✕ nền cảnh báo | `--c-bad` | Lỗi cấu hình hoặc runtime |
| `OUT_OF_SYNC` | ▲ + hai số revision | `--c-warn` | Backend và controller khác revision |

Mỗi trạng thái có **ký hiệu riêng** (S8). Tương phản chữ/nền của tất cả tám biến thể phải đạt
WCAG AA ở cả theme sáng và tối.

Màu khối trên lịch tuần:

| Khối | Ký hiệu | Ý nghĩa |
|---|---|---|
| `▓` | tô đặc | Giá trị khác mặc định (thường là BẬT) |
| `░` | tô nhạt | Giá trị bằng `schedule_default` |
| `▒` | sọc chéo | Ngoại lệ đang ghi đè lịch tuần |

---

## 12. Trạng thái rỗng, đang tải, lỗi

| Tình huống | Trình bày |
|---|---|
| Chưa có lịch nào | Khối mời tạo lịch đầu tiên, giải thích Schedule Object là gì trong một câu |
| Đang tải | Khung xương, **không** hiện `0` hay `—` như thể đã có dữ liệu |
| Lỗi tải, chưa có gì trong tay | `StateBlock` lỗi + nút thử lại (mẫu FE-DATA-02 đã dùng ở trang cũ) |
| Lỗi tải, đã có dữ liệu cũ | **Giữ bảng**, hiện dải cảnh báo phía trên — không xoá trắng màn hình đang dùng |
| `runtime` rỗng | Mọi ô runtime `—`; dải runtime ghi "controller chưa báo" |
| Không đủ quyền | Nút **làm mờ** + tooltip nêu quyền còn thiếu; không giấu nút |

---

## Revision History

| Phiên bản | Ngày | Người | Nội dung |
|---|---|---|---|
| 1.0 | 2026-08-07 | SW Lead | Bản đầu, tách từ proposal sau khi PM/CTO duyệt ADR-023. 8 nguyên tắc, kiến trúc thông tin 4 route + 6 tab, wireframe 7 màn hình |
