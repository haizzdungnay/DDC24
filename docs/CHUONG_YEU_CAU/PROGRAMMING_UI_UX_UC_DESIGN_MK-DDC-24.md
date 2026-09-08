# UI / UX / USE CASE DESIGN SPECIFICATION — PROGRAMMING — MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| Document ID | `DDC24-PRG-UX-DESIGN-001` |
| Product | MK-DDC-24 |
| Module | Engineering → Programming |
| Design family | PA3 — Adaptive Hybrid Control Workspace |
| Revision | **v2.3 — cập nhật authority trực quan ngày 2026-09-08** |
| Status | **REFERENCE — requirement/use-case companion; composition PGM-01..06 theo gói FE Handoff** |
| Date | 2026-08-09 |
| Companion document | `PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md` v2.2 |
| Primary principle | **DDC/BACS task workflow trên UI; compiler/version/safety complexity nằm dưới hệ thống** |
| Release scope | ST + FBD, one controller context, no online change |

**Quan hệ quyền tài liệu:** Đây là đề xuất UX hiện thực `PROD-PROG-001` và gói
amendment v2.2; không supersede Product/Requirement/Verification Active, không
tạo API authority và không chứng minh implementation. Chỉ được nâng thành Design
baseline sau khi `OD-PROG-015` cùng các quyết định type/task/FBD/RETAIN/monitor/
cutover liên quan được đóng và traceability được cập nhật.

> **Quyết định chủ sở hữu 2026-09-08 — `AUTH-UX-PROG-2026-09-08-01`.** Gói
> [`KX_DDC24_Programming_FE_Handoff_v2_1`](../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/README_FE_HANDOFF.md)
> là authority cho bố cục, thứ bậc thông tin và interaction target của
> PGM-01..06. [`UX-WEB-PROG-001`](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) giữ
> requirement, safety, contract, state, RBAC và acceptance companion. Nội dung
> lịch sử bên dưới không được dùng phục hồi bộ SVG Programming đã loại hoặc ghi
> đè các PNG/HTML trong gói handoff. Asset không phải bằng chứng As-Built/runtime.

> **Ghi chú kiểm soát 2026-08-09 — IA trong tài liệu này đã bị đề xuất thay
> thế.** Tài liệu mô tả **sáu** navigation entry và 17 use case. Ngày
> 2026-08-09, nhóm liên chức năng đề xuất rút xuống **bốn workspace** `PGM-01..04`
> và **tám user journey** `UJ-PROG-01..08`, giữ nguyên toàn bộ hành vi an toàn.
> Đề xuất nằm ở [Product Spec §8–§9](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md)
> và đã được triển khai vào
> [`UX-WEB-PROG-001`](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) để review.
>
> Phê duyệt theo dõi tại [`OD-PROG-016`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md).
> Khi đọc §4 (IA), §7–§12 (sáu trang) và §21 (catalog 17 use case) của tài liệu
> này, hãy đối chiếu ma trận migration tại UI/UX Design §6.1 — 12 use case
> `MERGED`, 3 thành `SCENARIO`, 2 chuyển `ROADMAP`. Nếu `OD-PROG-016` bị từ chối
> thì IA sáu trang trong tài liệu này là phương án quay lui.
>
> **Phạm vi còn normative của tài liệu này.** Để tránh hai UX authority song
> song, bố cục chi tiết trong tài liệu này chỉ là lịch sử/reference. Bản
> composition normative nằm trong gói FE Handoff; requirement/state/safety
> normative nằm ở `UX-WEB-PROG-001`. Các mục nguyên tắc UX §3, mô hình dữ
> liệu/trạng thái §25–§26, accessibility §30, responsive §31 và copy VI/EN
> §37.1 vẫn là đầu vào hợp lệ nếu không xung đột hai authority trên.

## Mục lục

- §0–6: cách đọc, chuẩn UX, persona, nguyên tắc, IA, journey và shell.
- §7–12: sáu navigation entry và ba subroute Runtime/Bảo trì.
- §13–20: chi tiết editor/mapping/task/check/commission và cách trình bày alarm.
- §21–24: UC, ưu tiên, persona mapping và permission UX.
- §25–43: state, accessibility, responsive, component/state/API và triển khai.
- §44–50: UX requirement, DoD, traceability, decision ownership, lịch sử và phê duyệt.

## Thuật ngữ UX

| Thuật ngữ | Copy/semantics chuẩn |
|---|---|
| **Check** | `Kiểm tra`; không dùng Compile/Build làm primary action. |
| **Đưa vào vận hành** | Primary label của Commission; chỉ hiện thành công sau authoritative read-back. |
| **Draft / Đang sửa** | Revision đang sửa; có thể cùng tồn tại với Revision đang vận hành. |
| **Đang vận hành** | Runtime truth do core cung cấp; không suy ra từ HTTP 2xx của web. |
| **Functional tag/view** | Tag/view tùy chọn trên Program/Point; không gọi là Application Function entity. |
| **`program_value`** | Đóng góp Local logic mức 5; label mặc định `Giá trị Program`. |
| **`actual_value`** | Giá trị thực tế sau resolver; có thể đang do mức 1–4 giữ. |
| **Core không kết nối được** | `UNREACHABLE`; không dùng `Offline` như Programming/core state. |
| **Cutover** | Chuyển `GRAPH_ONLY` ↔ `PROGRAM_ONLY`; semantics do Product §14.6 sở hữu. |
| **Candidate** | Trạng thái kỹ thuật ẩn trong flow; không đồng nghĩa Active. |

---

## 0. Đọc trước — UX v2.2 thay đổi gì

Phiên bản trước đúng về safety/versioning nhưng hơi mang mental model PLC/DevOps:

```text
Draft → Validate → Build → Candidate → Compare → Activate → Runtime
```

v2.2 giữ user mental model BACS/DDC và sửa các conflict/traceability còn lại:

```text
DESIGN
→ ENGINEERING
→ CHECK
→ ĐƯA VÀO VẬN HÀNH
→ RUN
→ SERVICE
```

Backend/runtime vẫn giữ đầy đủ:

```text
Validate → Compile → Typed IR → Artifact → Verify Integrity
→ Stage → Atomic Activate → LKG / Rollback
```

User **không cần hiểu Typed IR, ABI, artifact hash, retain schema** để commissioning một logic HVAC/BMS bình thường.

---

## 1. Standards-driven UX Baseline

Product §2 là chủ quản duy nhất của standards baseline và claim guardrail. UX
không lặp danh mục/edition. Tài liệu này chỉ hiện thực ba hệ quả kiểm chứng được:

1. UI phải hỗ trợ ST/structured FBD mà không biến compiler internals thành IA.
2. Task flow phải tự mô tả, keyboard-accessible, có recovery rõ và không dùng
   màu làm tín hiệu duy nhất.
3. Engineering Diagnostics phải tách khỏi operational Alarm; role chỉ được dùng
   để trình bày quyền do server authorize.

---

## 2. Personas ≠ Roles

### 2.1 Personas

#### BMS Operator
Cần:
- xem logic nào đang chạy;
- context của point/alarm;
- runtime status;
- không cần build details.

#### Commissioning Engineer
Cần:
- map point;
- test/check;
- xem change impact;
- commission;
- verify runtime.

#### Controls Engineer
Cần:
- ST/FBD;
- Function Block;
- Task;
- library;
- variable/point model;
- check.

#### Service Technician
Cần:
- runtime;
- online monitor;
- trace;
- task/quality fault;
- restore previous;
- recommission.

### 2.2 Roles

```text
viewer < operator < admin
```

Role quyết định permission; Persona quyết định UX/task.

---

## 3. UX Principles

### P-01 — DDC-first terminology

Normal UX dùng:

- Check.
- Sẵn sàng đưa vào vận hành.
- Đưa thay đổi vào vận hành.
- Running.
- Khôi phục bản trước.

Không dùng làm primary terminology:

- artifact ABI;
- IR schema;
- deployment manifest;
- immutable package.

### P-02 — Active truth luôn tách Draft

User phải luôn phân biệt:

```text
Editing / Draft
vs
Running / Active
```

### P-03 — Point-centric + functional tag/view

Không chỉ:

`Program → Variable`

mà:

`Nhóm chức năng (tag/view) → Program → Point → Runtime`.

Nhóm chức năng không phải entity lưu trữ thứ tư trong Rev A; UI dựng view từ
metadata/reference của Revision.

### P-04 — “Đưa vào vận hành” thay cho “Deploy” trong normal workflow

“Deploy/Activate” chỉ xuất hiện trong Advanced technical details nếu cần.

### P-05 — No Save & Run

Edit không thay active control.

### P-06 — Unknown hợp lệ

Không producer → `—`.

### P-07 — Error recovery rõ

Build/check/commission fail không làm user mất context và không làm Active cũ biến mất.

### P-08 — Progressive disclosure

Simple first; advanced details on demand.

### P-09 — Normal state không chiếm màu mạnh

Abnormal/attention mới nổi bật.

---

## 4. Information Architecture — sáu navigation entry đề xuất

### 4.1 Page map đề xuất

Sáu entry là phương án điều hướng để review, không phải mục tiêu sản phẩm hoặc
Release Gate. PGM-06 dùng ba tab/subroute để tránh gộp quá nhiều task.

| ID | Page | Mục tiêu quyết định | UC chính |
|---|---|---|---|
| **PGM-01** | **Tổng quan** | Cái gì đang chạy? Có gì cần chú ý? | UC-01, 09, 10, 12 |
| **PGM-02** | **Chương trình** | Thiết kế/sửa ST/FBD và Check logic | UC-02, 03, 04, 06, 09 |
| **PGM-03** | **Điểm & Ánh xạ** | Logic dùng Point nào, mapping hợp lệ chưa? | UC-05, 06, 15 |
| **PGM-04** | **Tác vụ & Thư viện lõi** | Logic chạy lúc nào và dùng control blocks nào? | UC-04, 07, 12, 14 |
| **PGM-05** | **Đưa vào vận hành** | Thay đổi đã an toàn để nạp vào runtime chưa? | UC-08, 09, 13, 17 |
| **PGM-06** | **Runtime & Bảo trì** | Active logic có chạy đúng không, xử lý fault/service/replacement thế nào? | UC-01, 10, 11, 12, 16, 17 |

Không còn primary page riêng:

- Projects.
- Project Overview.
- Builds & Deployment.
- History.

Các chức năng này được đưa vào context/tab/drawer.

### 4.2 Global Programming nav

```text
PROGRAMMING
├── Tổng quan
├── Chương trình
├── Điểm & Ánh xạ
├── Tác vụ & Thư viện lõi
├── Đưa vào vận hành
└── Runtime & Bảo trì
```

### 4.3 Context utility

Global utility, không primary page:

- Project selector.
- Revision history.
- Audit.
- Diagnostics.
- Advanced build details.

---

## 5. Primary User Journey

### 5.1 Engineer tạo/sửa logic

```text
Overview
→ Programs
→ Points & Mapping
→ Tasks & Library
→ Check
→ Đưa vào vận hành
→ Runtime
```

### 5.2 Sửa nhanh một logic

```text
Point / Alarm context
→ Open in Programs
→ Edit
→ Check
→ Đưa vào vận hành
```

Không bắt user đi qua 8 page.

### 5.3 Service fault

```text
Runtime & Bảo trì
→ Fault / Task / Point
→ Open Related Logic
→ Edit Draft
→ Check
→ Đưa vào vận hành
→ Verify Runtime
```

### 5.4 Restore

```text
Phiên bản & Bảo trì
→ Phiên bản trước
→ Review
→ Khôi phục bản trước
→ Verify Runtime
```

---

## 6. Global Shell

Giữ PA3 shell.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ MK-DDC-24 │ DDC-24-01 │ CORE RUNNING │ Cảnh báo │ Người dùng       │
├───────────────┬─────────────────────────────────────────────────────┤
│ Main Nav      │ Programming                                        │
│               │ Project selector / Editing vs Running context       │
│               │                                                     │
│               │ Page content                                        │
└───────────────┴─────────────────────────────────────────────────────┘
```

### 6.1 Persistent Programming Context Bar

```text
Plant-A Controls

ĐANG SỬA
Bản nháp r17 • Chưa lưu

ĐANG VẬN HÀNH
r15 • Đưa vào vận hành lúc 14:22

Core
DDC-24-01 • RUNNING
```

Đây là component quan trọng nhất để tránh nhầm Draft/Active.

---

# TRANG 1 — TỔNG QUAN

## 7. PGM-01 — Programming Overview

### 7.1 User questions

Trong ~5 giây:

1. Core `RUNNING`, `DEGRADED` hay `UNREACHABLE`?
2. Logic/application nào đang chạy?
3. Runtime normal hay attention?
4. Có draft/change chưa commissioned?
5. Có check/commission lỗi?
6. Đi đâu tiếp?

### 7.2 Wireframe

```text
┌─────────────────────────────────────────────────────────────────────┐
│ LẬP TRÌNH — DDC-24-01                        CORE RUNNING           │
├─────────────────────────────────────────────────────────────────────┤
│ ỨNG DỤNG ĐANG VẬN HÀNH                                              │
│ Plant-A Controls                                                     │
│ r15 • Đưa vào vận hành 14:22 • Safe-State BÌNH THƯỜNG              │
│ [Mở Runtime] [Mở Chương trình]                                      │
├─────────────────────────────────────────────────────────────────────┤
│ CẦN CHÚ Ý                                                           │
│ ⚠ Bản nháp r17 có thay đổi chưa đưa vào vận hành                   │
│ ✕ Kiểm tra: 1 lỗi ánh xạ Point                                     │
│ ⚠ Ghi nhận quá thời gian ở Control_Main                            │
│ [Xem lại]                                                           │
├──────────────────────────────────┬──────────────────────────────────┤
│ NHÓM CHỨC NĂNG                    │ HOẠT ĐỘNG KỸ THUẬT GẦN ĐÂY       │
│ Nhiệt độ gió cấp    Đang chạy    │ 14:22 r15 đã đưa vào vận hành   │
│ Logic hiện diện     Đang chạy    │ 13:58 r17 kiểm tra lỗi          │
├──────────────────────────────────┴──────────────────────────────────┤
│ THAO TÁC NHANH                                                      │
│ [Tiếp tục sửa] [Kiểm tra] [Đưa vào vận hành] [Runtime]             │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.3 Không đặt

- CPU/RAM.
- artifact hash.
- compiler profile.
- Project Health %.
- Activate button.

### 7.4 UC

- UC-01 — Xem ứng dụng đang vận hành.
- UC-09 — Check/Đưa vào vận hành lỗi nhưng logic đang chạy không đổi.
- UC-10 — Core suy giảm/không kết nối được.
- UC-12 — Cần chú ý tại runtime.

---

# TRANG 2 — CHƯƠNG TRÌNH

## 8. PGM-02 — Programs Workspace

### 8.1 Mục tiêu

Một page duy nhất cho:

- Functional tag/view tree.
- ST editor.
- FBD editor.
- Program/FB/Function.
- diagnostics.
- Check selected/full.

### 8.2 Layout

```text
┌───────────────────┬────────────────────────────────────┬──────────────┐
│ CÂY CHỨC NĂNG     │ TRÌNH SOẠN THẢO                   │ THUỘC TÍNH  │
│                   │                                    │              │
│ Nhiệt độ gió cấp  │ HVAC_Main [ST/FBD]                 │ Chức năng    │
│ ├─ Program        │                                    │ Program      │
│ ├─ FBs            │ code/canvas                        │ Variables    │
│ └─ Points         │                                    │ References   │
│                   │                                    │              │
│ Điều khiển bơm    │                                    │              │
├───────────────────┴────────────────────────────────────┴──────────────┤
│ LỖI / KIỂM TRA           1 Lỗi • 2 Cảnh báo           [Kiểm tra]    │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.3 Project management

Project list không cần page riêng. Dùng project selector:

```text
Plant-A Controls ▾
  Project đang dùng
  Project nháp
  + Project mới
```

### 8.4 Cây functional view

```text
Nhóm chức năng (tag/view)
├── Logic
│   ├── PROGRAM
│   ├── FUNCTION_BLOCK
│   └── FUNCTION
├── Points
├── Parameters
├── Alarm references
├── Schedule references
└── Documentation
```

### 8.5 ST Editor

Required:

- syntax highlight;
- line number;
- autocomplete;
- symbol/type;
- error underline;
- go to reference;
- find;
- format;
- source-map error;
- keyboard-first.

### 8.6 FBD Editor Rev A

Required:

- thêm typed block từ palette/tree bằng chuột hoặc bàn phím;
- typed ports/connections;
- deterministic execution order;
- block search;
- inspector;
- immediate incompatible-wire rejection;
- no decorative animation.

Rev A không yêu cầu full free-form React Flow canvas, snap grid/zoom hay
mouse-only wiring. Các tính năng wiresheet đó thuộc Rev B theo roadmap hiện hành.

### 8.7 Check UX

Normal primary action:

```text
[Kiểm tra]
```

Không bắt user hiểu “Compile/Build” ở bước thường.

Result:

```text
KẾT QUẢ KIỂM TRA

Logic       ✓
Kiểu dữ liệu ✓
Tác vụ      ✓
Point       ✕ 1
Thư viện    ✓
Core        RUNNING

1 Lỗi • 2 Cảnh báo
```

Advanced:

`Hiện chi tiết build kỹ thuật`

### 8.8 UC

- UC-02 — Gắn/sửa functional tag/view.
- UC-03 — Lập trình bằng ST.
- UC-04 — Lập trình bằng FBD / User Function Block cục bộ.
- UC-06 — Kiểm tra thay đổi.
- UC-09 — Check/Đưa vào vận hành lỗi nhưng logic đang chạy không đổi.

---

# TRANG 3 — ĐIỂM & ÁNH XẠ

## 9. PGM-03 — Points & Mapping

### 9.1 Mục tiêu

Controls engineer thấy trực tiếp:

> Function/Variable nào đang dùng Point nào, type/quality/source/writable ra sao?

### 9.2 Layout

```text
┌─────────────────────┬────────────────────┬──────────────────────────┐
│ CHỨC NĂNG / BIẾN    │ ÁNH XẠ             │ POINT TRÊN BỘ ĐIỀU KHIỂN │
│                     │                    │                          │
│ RoomTemp REAL       │ ───────────────►   │ UI-01 Room Temp         │
│ ValveCmd REAL       │ ───────────────►   │ AO-01 Valve Cmd         │
│ Occupied BOOL       │ ───────────────►   │ VP-12 Occupied          │
│ PumpStatus BOOL     │ ───────────────►   │ MB-RTU pump-vfd-01 /    │
│                     │                    │ run_status               │
└─────────────────────┴────────────────────┴──────────────────────────┘
```

### 9.3 Point information

- category `LOCAL | VP | MB-RTU`;
- canonical ID cho Local/VP;
- `device_id` + `point_id` cho Modbus RTU;
- tag/name;
- source;
- data type;
- unit;
- value;
- quality;
- writable;
- updated time.

### 9.4 Functional tag/view metadata Rev A

Rev A chỉ hiển thị/sửa tag, tên và mô tả tùy chọn trong inspector Program/Point
hiện có. Không tạo panel tài liệu chức năng chuyên biệt, full functional document
hoặc as-built export; những capability đó là roadmap §29 và ngoài DoD Rev A.

### 9.5 Mapping errors

- type mismatch;
- output→read-only;
- missing point;
- duplicate exclusive binding;
- unit policy warning;
- point offline warning according policy.

### 9.6 UC

- UC-05 — Ánh xạ biến tới Point.
- UC-06 — Kiểm tra thay đổi.
- UC-15 — Metadata chức năng / as-built roadmap.

---

# TRANG 4 — TÁC VỤ & THƯ VIỆN LÕI

## 10. PGM-04 — Tasks & Control Library

### 10.1 Mục tiêu

Giữ IEC Task model nhưng trình bày theo controls engineering.

### 10.2 Task table

| Tác vụ | Chu kỳ | Program | Runtime | Chú ý |
|---|---:|---:|---|---|
| Control_Main | 1 s | 2 | Running | — |

Advanced drawer:

- execution budget;
- base-step/watchdog compatibility (read-only, do runtime tính);
- overrun policy.

Không ép user bình thường nhìn budget/jitter.

### 10.3 Task editor

```text
Control_Main

Cho phép     BẬT
Chu kỳ       [1 s | 5 s | 30 s ▾]
Program
1. HVAC_Main
2. Pump_Logic

Nâng cao ▸
```

Biên Product/API chỉ nhận `1 s | 5 s | 30 s`. Rev A không có action `Thêm Task`
và không hiển thị capacity 8/16/32 cho tới khi `OD-PROG-003/004` đóng.

### 10.4 Control Library

```text
CORE
 Logic
 Math
 Compare
 Timers
 Counters
 Signal
 PID

BACS (Roadmap — không khả dụng ở Rev A)

PROJECT
 User Function Blocks (chỉ trong Project này)
```

Rev A cho phép tạo/dùng User Function Block cục bộ trong cùng Project. UI không
được có publish/share/import binary package, global catalogue hoặc component
upgrade độc lập Revision; các capability đó ngoài Rev A theo Product §5/§9.5.

### 10.5 Library UX

Block card:

- name;
- version;
- purpose;
- input/output summary;
- stateful;
- example/reference.

### 10.6 Standard claim guardrail

Không gắn badge “ISO 16484-4 compliant block” nếu chưa review exact standard semantics.

### 10.7 UC

- UC-04 — Lập trình FBD / User Function Block cục bộ.
- UC-07 — Cấu hình Task Rev A duy nhất.
- UC-12 — Theo dõi / chẩn đoán Task quá thời gian.
- UC-14 — BACS Control Library (roadmap, không Release Critical Rev A).

---

# TRANG 5 — ĐƯA VÀO VẬN HÀNH

## 11. PGM-05 — Đưa vào vận hành (`Commission` nội bộ)

### 11.1 Đây là page quan trọng nhất của redesign

Không còn user flow:

```text
Build → Compare → Activate
```

Mà:

```text
CHECK
  ↓
REVIEW CHANGES
  ↓
ĐƯA THAY ĐỔI VÀO VẬN HÀNH
  ↓
VERIFY RUNNING
```

### 11.2 Câu hỏi trên trang

1. Thay đổi có hợp lệ?
2. Target đúng controller?
3. Những Function/Point/Task nào thay đổi?
4. Physical output mapping có đổi?
5. Retained state có bị ảnh hưởng?
6. Core đang `RUNNING` và sẵn sàng?
7. Active version nào sẽ được thay?
8. Nếu fail thì hệ thống giữ gì?

### 11.3 Wireframe

```text
┌─────────────────────────────────────────────────────────────────────┐
│ ĐƯA VÀO VẬN HÀNH — Plant-A Controls                               │
│ Đích: DDC-24-01 • CORE RUNNING                                     │
├─────────────────────────────────────────────────────────────────────┤
│ MỨC SẴN SÀNG                                                        │
│ Logic        ✓  Point ✓  Task ✓  Thư viện ✓  Core ✓  Integrity ✓  │
├──────────────────────────────────┬──────────────────────────────────┤
│ THAY ĐỔI                         │ ĐANG VẬN HÀNH                    │
│ 2 Program đã sửa                │ r15                              │
│ 1 ánh xạ Point đã đổi           │ Đưa vào vận hành 14:22           │
│ 0 chu kỳ Task đã đổi            │ Runtime RUNNING                  │
│ RETAIN: Tương thích             │ Safe-State BÌNH THƯỜNG           │
├──────────────────────────────────┴──────────────────────────────────┤
│ THAY ĐỔI QUAN TRỌNG                                                 │
│ Ánh xạ AO-01: Valve_1 → Cooling_Valve                              │
│                                                                      │
│ [Hủy]                                 [Đưa vào vận hành]             │
└─────────────────────────────────────────────────────────────────────┘
```

Khối `THAY ĐỔI` là structured Revision change manifest do BE authority tính từ
hai immutable Revision, tối thiểu theo `source | mapping | task | library`.
Frontend không tự diff object cục bộ và không suy diễn “0 thay đổi”. Full
side-by-side source diff không phải requirement Rev A.

### 11.4 Progressive disclosure

`Chi tiết kỹ thuật nâng cao ▸`

Có thể show:

- internal build ID;
- compiler;
- library versions;
- artifact integrity; signature chỉ hiện khi policy ngoài Rev A được bật;
- hash.

### 11.5 Commission progress

```text
Chuẩn bị
→ Xác minh
→ Áp dụng tại ranh giới điều khiển
→ Xác nhận Runtime
→ Đã đưa vào vận hành
```

User-facing, không cần `staging/loader swap`.

### 11.6 Failure

```text
Đưa vào vận hành thất bại.

Phiên bản r15 đang vận hành không đổi và tiếp tục chạy.

Lý do
PRG-ERR-MAP-004 — Ánh xạ AO-01 không tương thích

[Quay lại Ánh xạ]
```

### 11.7 Khôi phục bản trước

Không để trên Commission chính như shortcut vô tình.

Entry:
- Runtime & Bảo trì → Phiên bản trước.
- hoặc Advanced Commission History.

### 11.8 Commission record

Success lưu:

- user;
- time;
- controller;
- commissioned revision;
- previous revision;
- mapping revision;
- library versions;
- result.

### 11.9 UC

- UC-08 — Đưa thay đổi vào vận hành.
- UC-09 — Candidate lỗi / Revision đang vận hành không đổi.
- UC-13 — Trạng thái RETAIN không tương thích.
- UC-17 — Import Project khi thay controller.

---

# TRANG 6 — RUNTIME & BẢO TRÌ

## 12. PGM-06 — Runtime & Bảo trì

### 12.1 Mục tiêu

Một navigation entry với ba tab/subroute độc lập:

- `Runtime`: runtime truth, Task và fault;
- `Theo dõi`: Online Watch/trace;
- `Phiên bản & Bảo trì`: previous versions, audit, replacement.

### 12.2 Wireframe

```text
┌─────────────────────────────────────────────────────────────────────┐
│ RUNTIME — DDC-24-01                       CORE ĐANG CHẠY            │
│ Plant-A Controls • r15 • Đưa vào vận hành lúc 14:22                │
│ Trạng thái an toàn: BÌNH THƯỜNG                                    │
├─────────────────────────────────────────────────────────────────────┤
│ CẦN CHÚ Ý                                                           │
│ ⚠ Control_Main quá thời gian: 2 lần                                │
│ ⚠ Chất lượng VP-12: DỮ LIỆU ĐÃ CŨ                                  │
├─────────────────────────────────────────────────────────────────────┤
│ TÁC VỤ REV A DUY NHẤT                                               │
│ Control_Main   1 s   Đang chạy   Tối đa 42 ms   Quá hạn 2         │
├───────────────────────────────┬─────────────────────────────────────┤
│ THEO DÕI                      │ BẢO TRÌ                            │
│ SAT 24,6°C • TỐT             │ [Truy vết]                         │
│ Giá trị Program 41%           │ [Phiên bản trước]                  │
│ Thực tế 62% • LOCAL_MANUAL giữ • còn 04:32                        │
│ Occupied ĐÚNG • TỐT          │ [Nhật ký]                          │
│                               │ [Mở Chương trình liên quan]        │
└───────────────────────────────┴─────────────────────────────────────┘
```

### 12.3 Online monitor

ST:
- inline values;
- quality;
- read-only.

FBD:
- pin/value overlays;
- quality;
- no wire animation flood.

### 12.4 Service drilldown

```text
Cần chú ý
→ Tác vụ
→ Chương trình liên quan
→ Point liên quan
→ Truy vết
```

### 12.5 Phiên bản trước

Drawer/table:

| Phiên bản | Đưa vào vận hành | Người dùng | Kết quả runtime | Thao tác |
|---|---|---|---|---|
| r15 | 14:22 | admin | Đang vận hành | — |
| r14 | Hôm qua | admin | Bản tốt trước đó | Khôi phục |

Action label:

`Khôi phục bản trước`

Advanced details may call it rollback internally.

### 12.6 Core connectivity state

```text
Core UNREACHABLE
Runtime gần nhất: 22:41:10 — STALE
Web/API vẫn sẵn sàng; khả năng lưu Draft theo Product §22.4; không thể đưa vào vận hành.
```

Nếu cả controller offline thật thì UI do controller phục vụ không tải được;
không thiết kế một banner “Controller offline” trong chính UI one-box. UX chỉ
hiện trạng thái do authority Product §22.4/§23 trả về, không tự quyết storage.

### 12.7 UC

- UC-01 — Xem ứng dụng đang vận hành.
- UC-10 — Core suy giảm/không kết nối được.
- UC-11 — Khôi phục phiên bản trước.
- UC-12 — Theo dõi / quá thời gian / truy vết.
- UC-16 — Runtime fault / trạng thái an toàn.
- UC-17 — Thay controller / đưa lại vào vận hành.

---

## 13. Functional tag/view UX

### 13.1 Vì sao cần

DDC engineer thường quản lý “chức năng điều khiển” hơn là “file source”. Rev A
dùng tag/view trên Program/Point/Revision, không tạo entity có lifecycle riêng.

### 13.2 Example

```text
Điều khiển nhiệt độ gió cấp
├── Program: SAT_Control
├── FB: PID_SAT
├── Points
│   ├── UI-01 SAT
│   ├── VP-21 SAT_SP
│   └── AO-01 Valve
├── Schedule: Occupied
├── Alarm: SAT_High
└── Tài liệu
```

### 13.3 Landing/Overview

Overview có thể nhóm theo functional tag/view thay vì raw POU count.

---

## 14. ST Editor Detail

### Required

- keyboard-first;
- source outline;
- autocomplete;
- diagnostic code;
- unsupported construct message;
- line/column;
- variable/point hover;
- go to definition;
- references;
- formatting.

### Runtime overlay

Read-only toggle:

`Editing | Online`

Online không cho code patch.

---

## 15. FBD Editor Detail

### Block behavior

- typed ports;
- port direction;
- unit/type hints;
- instance state;
- deterministic connection.

### FBD workspace

No:
- gratuitous animation;
- 3D/gradient;
- permanent green wires.

Online:
- selected/attention values only.

### Đường thao tác bàn phím Rev A

1. Focus palette/tree, dùng phím mũi tên và `Enter` để thêm block.
2. `Tab/Shift+Tab` di chuyển block → pin theo execution order; Inspector luôn
   phản ánh selection hiện tại.
3. `Enter` trên output pin bắt đầu kết nối, chọn input pin tương thích rồi
   `Enter` xác nhận; `Esc` hủy.
4. `Delete` xóa block/connection sau confirmation khi có reference.
5. `Alt+Arrow` đổi execution order theo rule; diagnostics đọc được bằng screen reader.

Không có thao tác authoring bắt buộc chỉ dùng chuột. Free-form drag/snap/zoom là
Rev B, nên proposal không claim accessibility cho một canvas chưa nằm trong scope.

---

## 16. Point Mapping UX Detail

Mapping phải luôn có:

```text
Variable
Point
Direction
Type
Unit
Writable
Quality
Source
Giá trị Program (mức 5)
Giá trị thực tế
Nguồn đang giữ
Mức ưu tiên hiệu lực
```

Quality `Offline` không được biến value thành `0`.

---

## 17. Task UX Detail

Normal mode:

```text
Task Name
Enabled
Cycle
Programs
State
```

Cycle chỉ có `1 s | 5 s | 30 s`; Rev A hiển thị một Task, không có Add Task.

Advanced:

```text
Execution Budget
Base Step / Watchdog Compatibility (read-only)
Max Exec
Jitter
Overrun Policy
```

Jitter/budget không nằm Overview khi không abnormal.

---

## 18. Check Model

### 18.1 Check layers

```text
Logic
Types
FBD topology
Tasks
Points / Mapping
Libraries
Controller compatibility
Retained-state compatibility
```

### 18.2 Severity

- Error — blocks Commission.
- Warning — review required according policy.
- Info — informational.

### 18.3 Check ≠ Alarm

Problems drawer không đẩy sang Alarm page.

---

## 19. Commission Safety UX

### 19.1 Strong confirmation

Commission changes là control-affecting action.

Dialog/page phải hiển thị:

- target;
- Running version;
- candidate revision;
- relevant changes;
- physical output binding changes;
- retained-state impact.
- danh sách **mọi** Local manual override còn hiệu lực theo Revision/binding,
  gồm Point, source, actor, requested/actual value, priority, TTL và link
  `Mở Chạy thử`;
- hold-last trên đóng góp mức 5 và cảnh báo khi không chứng minh tương thích;
- graph cutover state.

### 19.2 No optimistic Active

Sau click Commission, FE chờ/read-back authoritative runtime.

### 19.3 Unknown result

Nếu HTTP timeout:

```text
Chưa xác định kết quả.
Đang kiểm tra trạng thái Core…
```

Không tự nói Failed hoặc Success.

### 19.4 Bumpless và arbitration

Semantics do Product §14.4/§16.7 sở hữu. UX phải hiển thị riêng
`previous_program_value/program_value` (đóng góp mức 5) và `actual_value` sau
resolver. Trong activation, nếu Local manual giữ 62% còn Program là 41%, UI phải
hiện Program 41%, thực tế 62% và nguồn giữ; không được nói Revision mới đã commit
62% hoặc PID đang track 62%. Trạng thái `bumpless` chỉ được hiện khi runtime/HIL
evidence xác nhận hold-last mức 5 và IOP poll không chạm 200 ms. Kỹ sư cần kích
output dùng module **Chạy thử** mức Local manual 2, không dùng Online Monitor.

---

## 20. Operational Alarm vs Engineering Diagnostic

Product §21 sở hữu semantics/alarm policy. Bảng này chỉ quy định nơi UX được
phép trình bày hoặc link tới record authoritative.

| Condition | Programming Diagnostics | Operational Alarm | Security audit event |
|---|:---:|:---:|:---:|
| Syntax error | ✅ | ❌ | ❌ |
| FBD invalid connection | ✅ | ❌ | ❌ |
| Mapping error | ✅ | ❌ | ❌ |
| Check/build fail | ✅ | ❌ | ❌ |
| Candidate integrity/signature reject trước active | ✅ | ❌ | ✅ |
| Active runtime fault | ✅ | Theo policy | ❌ |
| Task-level fault do repeated overrun | ✅ | Chỉ khi Alarm authority có record | ❌ |
| Safe-State active | ✅ | Theo system policy | ❌ |
| Critical point quality loss | Linked | Existing alarm policy | ❌ |

Không duplicate alarm truth trong FE.

---

## 21. Catalog use case — v2.2

### UC-01 — Xem ứng dụng đang vận hành
**Actors:** all
**Trang:** Tổng quan / Runtime

User thấy:
- application;
- commissioned version;
- controller;
- runtime state;
- safe-state.

---

### UC-02 — Gắn/sửa functional tag/view
**Actor:** admin
**Trang:** Chương trình

Flow:

1. Gắn tag/view cho Program hoặc group hiện hữu.
2. Nhập name/description/category tùy chọn.
3. Reference Program/FB/Function và Points.
4. Không tạo entity/lifecycle/persistence độc lập.
5. Save Draft.

---

### UC-03 — Lập trình bằng ST
**Actor:** admin
**Trang:** Chương trình

1. Open Program.
2. ST editor.
3. Edit.
4. Inline diagnostics.
5. Check.
6. Fix errors.

---

### UC-04 — Lập trình FBD / User Function Block cục bộ
**Actor:** admin
**Trang:** Chương trình / Tác vụ & Thư viện lõi

1. Add FBD.
2. Thêm typed block bằng palette/tree hoặc bàn phím.
3. Nối typed pin bằng keyboard path hoặc pointer.
4. Configure.
5. Create/use reusable FB.
6. Check.

---

### UC-05 — Ánh xạ biến tới Point
**Actor:** admin
**Trang:** Điểm & Ánh xạ

1. Select Function/Variable.
2. Chọn category `LOCAL | VP | MB-RTU`; với RTU chọn device rồi point.
3. Bind.
4. Validate type/direction.
5. Observe quality/source.

---

### UC-06 — Kiểm tra thay đổi
**Actor:** admin
**Trang:** Chương trình / Điểm & Ánh xạ / Đưa vào vận hành

1. Click Check.
2. Aggregate all check layers.
3. Navigate errors.
4. Repeat until Ready.

No active effect.

---

### UC-07 — Cấu hình Task Rev A duy nhất
**Actor:** admin
**Trang:** Tác vụ & Thư viện lõi

1. Mở Task Rev A duy nhất.
2. Chọn đúng `1 s | 5 s | 30 s`.
3. Assign programs.
4. Advanced settings nếu cần; không expose Add Task/capacity chưa duyệt.
5. Check.

---

### UC-08 — Đưa thay đổi vào vận hành
**Actor:** admin
**Trang:** Đưa vào vận hành

1. Candidate is Ready.
2. Review changes.
3. Review physical mapping/retain impact.
4. Review graph cutover và mọi Local manual override/TTL còn hiệu lực.
5. Confirm.
6. Runtime verify integrity và giữ `program_value` mức 5 theo hold-last; không
   sao chép `actual_value` của nguồn mức 1–4.
7. Atomic apply; first successful cycle mới được commit.
8. Runtime confirms active version và arbitration truth.
9. Audit record created.

---

### UC-09 — Check/Đưa vào vận hành lỗi nhưng logic đang chạy tiếp tục
**Actors:** admin/operator/viewer observe
**Trang:** Tổng quan / Đưa vào vận hành

Required UI:

```text
Thay đổi: THẤT BẠI
Đang vận hành: r15 — RUNNING
```

---

### UC-10 — Core suy giảm/không kết nối được
**Actors:** all
**Trang:** Mọi trang Programming

- `mkddc-web` reachable, core state `DEGRADED` hoặc `UNREACHABLE`;
- online values `STALE/UNAVAILABLE`;
- action đưa vào vận hành bị khóa;
- UI đọc khả năng lưu Draft từ authority Product §22.4/§23, không tự suy diễn từ cache;
- nếu cả controller offline, UI không tải được nên không có banner giả lập.

---

### UC-11 — Khôi phục phiên bản trước
**Actor:** admin
**Trang:** Phiên bản & Bảo trì

1. Previous Versions.
2. Select known-good.
3. Review.
4. Confirm Restore.
5. Atomic restore.
6. Verify runtime.
7. Audit.

---

### UC-12 — Theo dõi / chẩn đoán Task quá thời gian
**Actors:** all read; admin edits
**Trang:** Runtime / Theo dõi

1. Attention indicates overrun.
2. Open Task.
3. See cycle/max/overrun.
4. Với output, xem `program_value/actual_value/overridden_by/effective_priority`.
5. Open related logic/points/trace.
6. Admin creates Draft fix.
7. Check/Đưa vào vận hành.

---

### UC-13 — Trạng thái RETAIN không tương thích
**Actor:** admin
**Trang:** Đưa vào vận hành

User sees business/control consequence:

```text
Trạng thái điều khiển đã lưu không còn tương thích.
Các giá trị RETAIN bị ảnh hưởng sẽ được khởi tạo lại.
```

Not raw schema jargon by default.

---

### UC-14 — Dùng BACS Control Library — roadmap sau Rev A
**Actor:** controls engineer/admin
**Trang:** Tác vụ & Thư viện lõi / Chương trình

1. Search HVAC/Room/etc.
2. Select block.
3. Inspect purpose/I/O.
4. Add instance.
5. Map/configure.
6. Check.

---

### UC-15 — Ghi metadata chức năng / as-built — roadmap ngoài DoD Rev A
**Actor:** admin / commissioning engineer persona
**Trang:** Điểm & Ánh xạ / Đưa vào vận hành

Revision metadata records:
- Functional tag/view.
- Point bindings.
- Task/program references.
- commissioned version.
- controller/time/user.
- commissioning notes.

Full functional/as-built PDF/export không phải Release Critical Rev A.

---

### UC-16 — Lỗi runtime / trạng thái an toàn
**Actors:** all
**Trang:** Runtime

1. Safe-State/runtime fault is authoritative.
2. UI shows reason/code.
3. Link to affected Tasks/Points.
4. Operational alarm link if system alarm policy produced one.
5. Service workflow starts.

---

### UC-17 — Thay controller / recommission
**Actor:** admin / service technician persona
**Trang:** Phiên bản & Bảo trì / Đưa vào vận hành

1. Export Project bundle có Revision, source, mapping, Task, Core Library version
   và integrity hash; không chứa artifact/IR/native binary/cache build.
2. Import lên controller thay thế; bundle có build artifact, corrupt hoặc sai
   target bị từ chối.
3. Hệ thống tạo Draft và build lại bằng toolchain/library trên target; không tự activate.
4. Remap Point khác identity nếu có, Check, xác nhận override/cutover.
5. Đưa vào vận hành, verify runtime và ghi audit.

---

## 22. UC Priority

### Release Critical

- UC-01.
- UC-03.
- UC-04.
- UC-05.
- UC-06.
- UC-07.
- UC-08.
- UC-09.
- UC-10.
- UC-11.
- UC-12.
- UC-13.
- UC-16.
- UC-17.

### Competitive / BACS differentiation

- UC-02 functional tag/view.
- UC-14 BACS Control Library.
- UC-15 Functional/As-built record.

---

## 23. Persona → UC Mapping

| Persona | Primary UC |
|---|---|
| BMS Operator | 01, 10, 12, 16 |
| Commissioning Engineer | 05, 06, 08, 09, 13, 15 |
| Controls Engineer | 02, 03, 04, 05, 06, 07, 08, 14 |
| Service Technician | 01, 10, 11, 12, 16, 17 |

---

## 24. Permission UX

### viewer
- read source;
- runtime;
- online monitor;
- documentation.

### operator
- same read-oriented Programming access by default.

### admin
- edit;
- Check;
- mapping;
- Task;
- Commission;
- Restore.

Disabled action:

`Cần quyền Quản trị viên.` (`programming.permission.admin`)

Không hide system truth.

---

## 25. Data State Design

Required:

- Loading.
- Empty.
- Error.
- Unknown.
- Stale.
- Running.
- Draft.
- Ready.
- Commissioning.
- Commissioned.
- Safe-State.

`Offline` chỉ dùng cho Point/field device hoặc dữ liệu có producer riêng. Với
process one-box, UI dùng core `DEGRADED/UNREACHABLE`, không dùng Controller Offline.

Không dùng only color.

---

## 26. Attention Hierarchy

### Critical operational
- Safe-State.
- active runtime fault.

### Engineering blocking
- Check Error.
- invalid mapping.
- Commission reject.

### Warning
- offline referenced point;
- task overrun below fault policy;
- retain impact;
- draft not commissioned.

### Info
- draft newer than running;
- new library version available.

---

## 27. Advanced Technical Details

Progressive disclosure có thể hiển thị:

- build ID;
- compiler version;
- IR schema;
- target ABI;
- artifact hash;
- signature status chỉ khi future policy ngoài Rev A được bật;
- library manifest.

Default collapsed.

Đây là compromise giữa serviceability và DDC usability.

---

## 28. History & Audit

Không primary page.

Access:
- Overview → Recent Engineering.
- Commission → Commission History.
- Phiên bản & Bảo trì → Nhật ký / Phiên bản trước.

Timeline:

```text
14:22  r15 đã đưa vào vận hành  admin
14:20  Kiểm tra đạt             admin
14:17  Đã đổi ánh xạ Point      admin
11:02  r14 đã đưa vào vận hành  admin
```

---

## 29. Functional tag/view UX

### Panel metadata roadmap ngoài Rev A

Fields:

- Tên chức năng.
- Mục đích/mô tả.
- Thiết bị/nhóm được điều khiển.
- Input/Output.
- Điểm đặt/tham số.
- Reference tới Lịch/Cảnh báo/Logic.
- Ghi chú đưa vào vận hành.

### UX goal roadmap

Khi metadata được dùng, service engineer có thể hiểu **“chức năng này làm gì”**
mà không cần đọc toàn bộ ST/FBD. Panel này và full functional/as-built export
không nằm DoD Rev A.

---

## 30. Accessibility

Target theo ISO 9241 accessibility direction + WCAG-equivalent web practices:

- keyboard navigation;
- visible focus;
- editor accessible labels;
- tree/table semantics;
- icon+text+color;
- suitable contrast;
- no critical hover-only info;
- no mouse-only required action; FBD Rev A tuân theo keyboard path tại mục 15.

Full free-form wiresheet canvas là Rev B. Tài liệu không claim ISO 9241-171 hoặc
WCAG conformance; chỉ nêu acceptance cần được browser/a11y test chứng minh.

---

## 31. Responsive

### >= 1440
full workspace.

### 1024–1439
collapsible tree/inspector.

### <1024
monitor/read/light editing; FBD structured authoring Rev A có desktop recommendation.

Industrial engineering UX không cần ép mobile parity.

### 31.1 HMI cục bộ

Programming authoring, Check, Đưa vào vận hành, trace và replacement **không
hiển thị trên HMI LVGL/DRM Rev A**. HMI chỉ có thể hiển thị runtime/alarm/Point
context đã được module hiện hữu cho phép; Web/HMI không nằm trên control path.

---

## 32. Visual System

### Normal
neutral.

### Attention
amber.

### Critical/unsafe
red.

### Selection/action
blue/cyan.

### Healthy
green dùng tiết chế.

### Programming state

- DRAFT.
- READY.
- RUNNING/COMMISSIONED.
- STALE.
- FAILED.

`OFFLINE` chỉ là Point/field-device quality và không được đưa vào Programming
state machine. Core dùng đúng `RUNNING/DEGRADED/UNREACHABLE`.

State luôn có text.

---

## 33. Danh mục component v2.2

### Shell/context
- `ProgrammingContextBar`
- `ProjectSelector`
- `RunningVsEditingBadge`

### Overview
- `RunningApplicationPanel`
- `ProgrammingAttentionList`
- `RecentEngineeringTimeline`

### Programs
- `ApplicationTree`
- `SourceEditor`
- `StructuredFbdEditor`
- `Inspector`
- `ProblemsDrawer`
- `CheckSummary`

### Points
- `MappingWorkspace`
- `PointPicker`
- `PointQualityBadge`

### Tasks/Library
- `TaskTable`
- `TaskEditor`
- `ControlLibrary`
- `BlockReferencePanel`

### Commission
- `CommissionReadiness`
- `ChangeSummary`
- `CommissionDialog`
- `CommissionProgress`
- `RetainImpactNotice`
- `AdvancedArtifactDetails`

### Runtime
- `RuntimeSummary`
- `TaskRuntimeTable`
- `OnlineWatch`
- `TracePanel`
- `PreviousVersionsDrawer`
- `AuditTimeline`

---

## 34. Frontend State Model

Không dùng `isRunning`.

```text
editing.revision
editing.baseRevision
editing.dirty
editing.saveStatus
check.status

commission.candidate
commission.status

core.connection = RUNNING | DEGRADED | UNREACHABLE
runtime.activeRevision
runtime.state
runtime.safeState

onlineMonitor.freshness
concurrency.conflict
```

Example:

```text
editing.revision = r17
check.status = failed

runtime.activeRevision = r15
runtime.state = running
core.connection = unreachable
concurrency.conflict = none
```

Cả hai cùng tồn tại.

---

## 35. API Interaction Rules

1. Server/runtime authority.
2. No optimistic Active/Commissioned.
3. Timeout → unknown + re-fetch.
4. Stale realtime explicitly marked.
5. 403 does not become generic network error.
6. Commission response must reconcile actual active revision.
7. Engineering Problems stay separate from Alarm store.
8. Functional documentation uses canonical point/function IDs.
9. Advanced artifact data shown only if producer provides.
10. No fake metric defaults.
11. Mutation gửi `base_revision`/ETag; `409 PRG-ERR-CONFLICT-001` mở merge/reload
    flow, không overwrite.
12. Core state tách khỏi web reachability; UX đọc Draft authority theo Product §22.4/§23.
13. Output read model giữ `program_value/actual_value/overridden_by/effective_priority`.
14. Readiness lấy danh sách override active từ capability Product §23, không
    quét cache từng Point hoặc giả định danh sách rỗng.

---

## 36. Safety Confirmation Matrix

| Action | Confirmation |
|---|---|
| Save Draft | No |
| Check | No |
| Add FBD block | No |
| Change point mapping | Inline warning; final impact at Commission |
| Change Task cycle | Warning if meaningful; final impact at Commission |
| Đưa vào vận hành | Strong |
| Khôi phục bản trước | Strong |
| Reset Retained State | Strong |
| Delete referenced Function/POU | Yes |

---

## 37. Ví dụ Empty / Error / Core / Point quality

### No program
`Chưa có ứng dụng điều khiển nào được đưa vào vận hành.`

### No draft
`Phiên bản đang vận hành đã là bản mới nhất.`

### Check failed
`Thay đổi chưa sẵn sàng để đưa vào vận hành.`

### Core unreachable
`Không kết nối được Core — giá trị runtime đã cũ.`

### Unknown
`—`

Không dùng fake `0 ms`, `0 errors`, `100% healthy`.

### 37.1 Danh mục copy VI/EN bắt buộc

Mọi chuỗi visible phải đi qua i18n key; tiếng Việt là mặc định. Wireframe trong
tài liệu chỉ mô tả semantics, không cấp phép hard-code tiếng Anh.

| i18n key | VI mặc định | EN |
|---|---|---|
| `programming.nav.overview` | Tổng quan | Overview |
| `programming.nav.programs` | Chương trình | Programs |
| `programming.nav.pointsMapping` | Điểm & Ánh xạ | Points & Mapping |
| `programming.nav.tasksLibrary` | Tác vụ & Thư viện lõi | Tasks & Core Library |
| `programming.nav.commission` | Đưa vào vận hành | Commission |
| `programming.nav.runtimeService` | Runtime & Bảo trì | Runtime & Service |
| `programming.state.editing` | Đang sửa | Editing |
| `programming.state.running` | Đang vận hành | Running |
| `programming.state.ready` | Sẵn sàng đưa vào vận hành | Ready to commission |
| `programming.state.stale` | Dữ liệu đã cũ | Stale |
| `programming.core.running` | Core đang chạy | Core running |
| `programming.core.degraded` | Core suy giảm | Core degraded |
| `programming.core.unreachable` | Không kết nối được Core | Core unreachable |
| `programming.action.check` | Kiểm tra | Check |
| `programming.action.commission` | Đưa vào vận hành | Commission changes |
| `programming.action.restore` | Khôi phục bản trước | Restore previous |
| `programming.action.openCommissioning` | Mở Chạy thử | Open Commissioning |
| `programming.action.cancel` | Hủy | Cancel |
| `programming.empty.noActive` | Chưa có ứng dụng điều khiển nào được đưa vào vận hành. | No control application has been commissioned. |
| `programming.info.runningUpToDate` | Phiên bản đang vận hành đã là bản mới nhất. | The running version is up to date. |
| `programming.error.notReady` | Thay đổi chưa sẵn sàng để đưa vào vận hành. | Changes are not ready to commission. |
| `programming.error.coreUnreachable` | Không kết nối được Core — giá trị runtime đã cũ. | Core unreachable — runtime values are stale. |
| `programming.commission.unknown` | Chưa xác định kết quả. Đang kiểm tra trạng thái Core… | Result unknown. Checking Core state… |
| `programming.commission.failed` | Đưa vào vận hành thất bại. Phiên bản đang chạy không đổi. | Commission failed. The running version is unchanged. |
| `programming.arbitration.heldBy` | Giá trị thực tế {actual}; đang bị {source} giữ. | Actual {actual}; held by {source}. |
| `programming.override.remaining` | Override thủ công còn {duration}. | Manual override remaining {duration}. |
| `programming.permission.admin` | Cần quyền Quản trị viên. | Requires Admin permission. |
| `programming.conflict.revision` | Bản nháp đã thay đổi ở phiên khác; hãy tải lại hoặc hợp nhất. | The draft changed in another session; reload or merge. |
| `programming.integrity.rejected` | Gói thay đổi hỏng hoặc không toàn vẹn. | The change package is corrupt or failed integrity verification. |

Các label động (Point, Task, Revision, source arbitration) dùng ID/value từ
authority và format theo locale; không dịch ID kỹ thuật.

---

## 38. Notification Strategy

### Toast
- `Đã lưu bản nháp.`
- `Kiểm tra hoàn tất.`

### Persistent attention
- Core `DEGRADED/UNREACHABLE` hoặc Point quality `OFFLINE` có producer rõ.
- Safe-State.
- running fault.

### Page state
- Commission progress/result.

### Problems drawer
- syntax/type/mapping errors.

Không spam toast cho 50 compiler errors.

---

## 39. Integration với Monitor / Alarm / Trend

### Monitor → Programs/Mapping
`Open related control logic`

### Programs → Monitor/Trend
`Open Point`
`Open Trend`

### Runtime fault → Alarm
Chỉ link nếu alarm producer có record.

Programming không tự tạo duplicate alarm state.

---

## 40. Integration với Scheduler

Scheduler là module riêng.

Programming:

- reference schedule;
- use approved Schedule block/interface;
- open Scheduler from reference.

Không embed full scheduler editor trong FBD.

---

## 41. Integration với Virtual Points

Mapping dùng canonical VP.

Không tạo hidden VP ngầm từ FBD wire nếu product spec chưa cho phép.

---

## 42. Legacy Graph Strategy

Product §14.6 sở hữu state machine, base-step/Task/watchdog và rollback semantics.
UX chỉ phải hiển thị cutover state do Check/runtime trả về, yêu cầu review backup
+ rollback plan, dùng confirmation mạnh và khóa action khi authority trả dual-run
conflict. UX không tự suy ra owner từ `graph.json`, Task period hoặc cache.

---

## 43. Trình tự triển khai

### UX-P0 — DDC-first IA
- sáu navigation entry; PGM-06 có ba subroute `Runtime`, `Theo dõi`,
  `Phiên bản & Bảo trì`; page count không phải release metric.
- context bar.
- role/persona model.
- authoritative Active state.

### UX-P1 — Programs
- functional tag/view tree.
- ST.
- Check/Problems.

### UX-P2 — Points & Mapping
- canonical point picker.
- functional tag/view metadata tối thiểu trong Revision; không có documentation panel/export Rev A.

### UX-P3 — Tasks & Library
- task normal/advanced mode.
- core library.
- BACS taxonomy chỉ placeholder roadmap, không capability Rev A.

### UX-P4 — FBD
- typed structured editor + keyboard path.
- inspector.
- diagnostics.

### UX-P5 — Commission
- readiness.
- change summary.
- advanced technical details.
- atomic commission + readback.

### UX-P6 — Runtime & Bảo trì
- online values.
- task metrics.
- trace.
- previous version.
- audit.

### UX-P7 — Standards/Quality hardening
- accessibility.
- alarm/diagnostic separation.
- HIL/E2E.
- verification trace `UX-REQ-* → VS-PROG-*`; không giao full as-built export Rev A.

---

## 44. UX Requirement Catalog và verification trace

> **Lưu ý 2026-08-09:** `UX-REQ-002` trong bảng dưới đây vẫn phát biểu theo IA
> sáu trang và **không còn normative**. Bản normative là `UX-REQ-002` tại
> [`UX-WEB-PROG-001` §21.1](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md), phát biểu
> theo bốn workspace. Các `UX-REQ-*` còn lại không phụ thuộc IA và vẫn hiệu lực.

Các ID dưới đây là normative cho proposal UX, **trừ `UX-REQ-002`**. Catalog scenario duy nhất nằm tại
[`VVP-PROG-001` §3](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md);
mục này **không** tạo test list song song. Mỗi UX requirement phải
có bằng chứng theo đúng `VS-PROG-*` trước sign-off.

| ID | Yêu cầu UX quy phạm | UC / mục chủ quản | Verification |
|---|---|---|---|
| `UX-REQ-001` | Workflow và primary action phải dùng `Kiểm tra` → `Đưa vào vận hành` → `Đang vận hành`; không dùng Compile/Deploy/Activate làm mental model chính. | UC-03/06/08; §3/§37 | `VS-PROG-002`, `VS-PROG-025` |
| `UX-REQ-002` | IA phải có sáu navigation entry PGM-01..06; PGM-06 phải tách `Runtime`, `Theo dõi`, `Phiên bản & Bảo trì`; page count không phải success metric. | §4/§12/§43 | `VS-PROG-002` + usability review |
| `UX-REQ-003` | Persistent context phải hiển thị controller/project, Draft đang sửa, Revision đang vận hành và dirty/readiness đồng thời; functional tag/view chỉ là metadata tùy chọn. | UC-01/02; §6 | `VS-PROG-001`, `VS-PROG-004`, `VS-PROG-026` |
| `UX-REQ-004` | ST editor phải hỗ trợ keyboard-first, source location, symbol/type, tìm/tham chiếu và diagnostic ổn định; lỗi không được làm mất Draft. | UC-03/06; §8.5/§14 | `VS-PROG-005`, `VS-PROG-006` |
| `UX-REQ-005` | FBD Rev A phải là structured typed editor, có đường add/connect/delete/order bằng bàn phím; không được phụ thuộc free-form canvas/mouse-only. | UC-04; §8.6/§15/§33 | `VS-PROG-005`, `VS-PROG-006`, `VS-PROG-028` |
| `UX-REQ-006` | Mapping UI phải dùng canonical identity/category và lọc type/direction/writable; invalid mapping phải chặn Commission tại đúng field/binding. | UC-05/06; §9/§16 | `VS-PROG-017` |
| `UX-REQ-007` | Rev A phải hiển thị đúng một Task, cycle chỉ `1/5/30 s`, không có `Thêm Task` hoặc Priority giữa nhiều Task; runtime table cũng chỉ có Task đó. | UC-07/12; §10/§12/§17 | `VS-PROG-009` |
| `UX-REQ-008` | Check phải tổng hợp Logic/Type/FBD/Task/Point/Library/Target/RETAIN, có severity và điều hướng source; Check không được thay đổi Active. | UC-06/09; §8.7/§18 | `VS-PROG-006`, `VS-PROG-019` |
| `UX-REQ-009` | Trang Đưa vào vận hành phải hiện manifest/impact/RETAIN/cutover, confirmation mạnh, progress và authoritative read-back; timeout phải thành Unknown rồi reconcile. | UC-08/09/13; §11/§19 | `VS-PROG-011`, `VS-PROG-015`, `VS-PROG-019`, `VS-PROG-029` |
| `UX-REQ-010` | Readiness phải liệt kê mọi override active với Point/source/actor/requested/actual/priority/TTL và link `Mở Chạy thử`; không được suy ra từ cache từng Point. | UC-08; §11/§19 | `VS-PROG-020` |
| `UX-REQ-011` | UI phải tách `program_value` mức 5 khỏi `actual_value`; khi mức 1–4 thắng phải hiện nguồn/priority/TTL và không mô tả PID track actual hoặc activation commit giá trị ngoại lai. | UC-08/12; §12/§19 | `VS-PROG-010`, `VS-PROG-014` |
| `UX-REQ-012` | Core state chỉ được là `RUNNING/DEGRADED/UNREACHABLE`; khi cả controller mất thì UI không tải; UX không được tự chốt storage/Draft authority. | UC-10; §12.6/§34/§35 | `VS-PROG-026`, `VS-PROG-030` |
| `UX-REQ-013` | Missing/Unknown/Stale/Unavailable và Point quality `OFFLINE` phải giữ semantics riêng; không được hiển thị valid zero hoặc dùng Offline làm Programming/core state. | UC-05/10/12; §25/§32/§37 | `VS-PROG-018`, `VS-PROG-026` |
| `UX-REQ-014` | Runtime/Theo dõi phải hiển thị một Task, execution/max/overrun, bounded trace và task-level fault; không được suy diễn ba overrun thành plant safe-state nếu authority không báo. | UC-12/16; §12/§20 | `VS-PROG-013`, `VS-PROG-027` |
| `UX-REQ-015` | Khôi phục phiên bản trước phải có review, confirmation mạnh, progress, authoritative result và audit; UI không được optimistic success. | UC-11; §12.5/§19 | `VS-PROG-011` |
| `UX-REQ-016` | UI phải trình bày viewer/operator/admin theo authorization server; action bị cấm phải disabled với lý do, không hide runtime truth. | mọi UC mutation; §2/§24 | `VS-PROG-022` |
| `UX-REQ-017` | Mọi chuỗi visible phải qua i18n key VI/EN, tiếng Việt mặc định; wireframe/table/action trong spec phải dùng copy Việt đã chốt. | mọi UC; §37.1 | `VS-PROG-025` |
| `UX-REQ-018` | State/action phải có text/icon ngoài màu, focus nhìn thấy, semantics table/tree/editor và không có critical hover-only interaction. | mọi page; §30 | `VS-PROG-028` |
| `UX-REQ-019` | UI không được tạo fake metric/health/runtime state; thiếu producer phải hiện `—/Không xác định` kèm freshness. | UC-01/10/12; §7/§25/§37 | `VS-PROG-018`, `VS-PROG-026` |
| `UX-REQ-020` | Conflict 409, Commission timeout/reject và reconnect phải có recovery rõ; không overwrite, replay mutation hoặc làm mất Draft. | UC-06/09; §34–36 | `VS-PROG-011`, `VS-PROG-024` |
| `UX-REQ-021` | Replacement flow phải ghi rõ source-only bundle, reject artifact/IR/native/corrupt/wrong-target, build lại trên target, tạo Draft và không auto-activate. | UC-17; §11/§21 | `VS-PROG-021`, `VS-PROG-023` |
| `UX-REQ-022` | Syntax/type/mapping/build là Engineering Diagnostic; runtime/task fault chỉ link Alarm khi alarm authority có record; UI không duplicate alarm hoặc tự kích safe-state. | UC-06/12/16; §18/§20/§39 | `VS-PROG-013` |
| `UX-REQ-023` | User Function Block Rev A chỉ được tạo/dùng trong Project; UI không được expose global catalogue, package sharing, binary import hoặc independent upgrade. | UC-04/14; §10.4 | `VS-PROG-003`, `VS-PROG-007` |
| `UX-REQ-024` | Layout phải usable ở desktop và read/light-edit ở <1024; HMI LVGL/DRM không được có authoring/Check/Commission/trace/replacement route Rev A. | §31 | `VS-PROG-028` |

---

## 45. Definition of Done — UX v2.2 proposal

UX Rev A chỉ đạt Done khi đồng thời:

1. Mọi `UX-REQ-001..024` trong §44 có evidence PASS từ controlled scenario catalog;
   không có requirement mồ côi hoặc chỉ được chứng minh bằng inspection prose.
2. Mọi UC Release Critical trong §22 trace tới ít nhất một `UX-REQ-*` và một
   `VS-PROG-*` tại §46; usability review đã ký cho IA/task flow.
3. Browser evidence có desktop/mobile khi layout bị ảnh hưởng, keyboard/a11y,
   Console error và Network failure; Vitest/lint/build/E2E vẫn là gate độc lập.
4. API/source/docs khớp release commit; state không có fake producer và result
   Commission/Restore đều được authoritative read-back.
5. UC-14, UC-15, full functional/as-built panel/export, full FBD canvas, BACS
   Library nâng cao và multi-Task vẫn ngoài DoD Rev A, không xuất hiện như
   capability disabled-but-promised.
6. Product/UX/Verification sign-off §50 hoàn tất và G0 của Product không còn RED.

---

## 46. Traceability UX

Product §30 sở hữu source/standards traceability; Product §25.8 sở hữu mapping
`PRG-* → baseline`; controlled Verification Catalog sở hữu scenario. UX chỉ sở
hữu mapping UC dưới đây.

| UC | UX requirement | Scenario authority |
|---|---|---|
| UC-01 | `UX-REQ-003`, `UX-REQ-012`, `UX-REQ-014`, `UX-REQ-019` | `VS-PROG-004`, `VS-PROG-026`, `VS-PROG-027` |
| UC-02 | `UX-REQ-003` | `VS-PROG-001` |
| UC-03 | `UX-REQ-004`, `UX-REQ-008` | `VS-PROG-005`, `VS-PROG-006`, `VS-PROG-019` |
| UC-04 | `UX-REQ-005`, `UX-REQ-023` | `VS-PROG-005`, `VS-PROG-006`, `VS-PROG-007`, `VS-PROG-028` |
| UC-05 | `UX-REQ-006`, `UX-REQ-013` | `VS-PROG-017`, `VS-PROG-018` |
| UC-06 | `UX-REQ-008`, `UX-REQ-020`, `UX-REQ-022` | `VS-PROG-006`, `VS-PROG-019`, `VS-PROG-024` |
| UC-07 | `UX-REQ-007` | `VS-PROG-009` |
| UC-08 | `UX-REQ-009`, `UX-REQ-010`, `UX-REQ-011` | `VS-PROG-010`, `VS-PROG-014`, `VS-PROG-015`, `VS-PROG-019`, `VS-PROG-020` |
| UC-09 | `UX-REQ-003`, `UX-REQ-009`, `UX-REQ-020` | `VS-PROG-011`, `VS-PROG-019`, `VS-PROG-026` |
| UC-10 | `UX-REQ-012`, `UX-REQ-013`, `UX-REQ-019` | `VS-PROG-018`, `VS-PROG-026`, `VS-PROG-030` |
| UC-11 | `UX-REQ-015` | `VS-PROG-011` |
| UC-12 | `UX-REQ-011`, `UX-REQ-014` | `VS-PROG-010`, `VS-PROG-013`, `VS-PROG-027` |
| UC-13 | `UX-REQ-009` | `VS-PROG-029` |
| UC-14 | `UX-REQ-023` | `VS-PROG-003`; roadmap ngoài Rev A |
| UC-15 | `UX-REQ-003` | `VS-PROG-001`; full export ngoài Rev A |
| UC-16 | `UX-REQ-012`, `UX-REQ-014`, `UX-REQ-022` | `VS-PROG-013`, `VS-PROG-026` |
| UC-17 | `UX-REQ-021` | `VS-PROG-021`, `VS-PROG-023` |

Bảng §4.1 là mapping duy nhất `PGM → UC`; danh sách tại từng trang phải khớp.
Trace tài liệu không đổi trạng thái production evidence đang RED.

---

## 47. Decision ownership

Product §31 và `PROG-OD-001-AUD` là chủ quản duy nhất của Open Decisions. UX
không chốt storage, Task capacity, type, mapping, RETAIN, runtime, cutover hoặc
watchdog. UX chỉ ghi design consequence sau quyết định; primary label PGM-05 là
**Đưa vào vận hành**, khác module **Chạy thử**.

---

## 48. UX direction đề xuất — chưa khóa

### Kiến trúc UI chờ `OD-PROG-015`

```text
Overview
→ Programs
→ Points & Mapping
→ Tasks & Control Library
→ Đưa vào vận hành
→ Runtime & Bảo trì
```

### User mental model

```text
Functional tag/view
→ Logic
→ Points
→ Check
→ Commission
→ Run
→ Service
```

Semantics platform ẩn do Product §§14–18 sở hữu. UX direction chỉ khóa mental
model, IA và interaction; không lặp lại compiler/runtime architecture ở đây.

---

## 49. Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung | Trạng thái |
|---|---|---|---|
| v2.3 | 2026-09-08 | Gắn `AUTH-UX-PROG-2026-09-08-01`: gói FE Handoff là authority trực quan PGM-01..06; UX-WEB giữ requirement/safety/contract; cấm dùng nội dung lịch sử phục hồi bộ SVG Programming sai. | Reference companion; không phải As-Built/runtime evidence. |
| v2.0 | 2026-08-08 | Bản DDC-first/BACS Engineering ban đầu. | Draft; bị phản biện, không baseline. |
| v2.1 | 2026-08-09 | Đồng bộ Product proposal v2.1; sửa IA/UC, core connectivity, arbitration, i18n, accessibility, concurrency, cutover và replacement. | Proposal / In Review. |
| v2.2 | 2026-08-09 | Đóng R2-01..14; thêm `UX-REQ-001..024`, chuyển scenario sang catalog controlled duy nhất, xóa artefact scope cũ, cắt trùng authority và sửa R3-01. | Proposal / In Review; chưa phê duyệt. |

---

## 50. Phê duyệt / sign-off

| Vai trò | Người phê duyệt | Ngày | Quyết định | Bằng chứng/biên bản |
|---|---|---|---|---|
| Product Owner | _Chưa ký_ | — | `PENDING` | Product v2.2 / `OD-PROG-015` |
| UX Lead | _Chưa ký_ | — | `PENDING` | Usability review + `UX-REQ-001..024` |
| Controls/Safety Reviewer | _Chưa ký_ | — | `PENDING` | `VS-PROG-010`, `VS-PROG-013`, `VS-PROG-014`, `VS-PROG-015` |
| Frontend Lead | _Chưa ký_ | — | `PENDING` | Browser/Vitest/lint/build/E2E evidence |
| Verification Lead | _Chưa ký_ | — | `PENDING` | Controlled `VS-PROG-001..030` catalog + UX §46 |

Không được đổi Status sang Approved/Baseline khi còn ô `PENDING`, Product G0
còn RED hoặc bất kỳ UX requirement/Release Critical UC nào chưa có evidence.

---

**END OF UI / UX / USE CASE DESIGN SPECIFICATION — v2.3 REFERENCE COMPANION**
