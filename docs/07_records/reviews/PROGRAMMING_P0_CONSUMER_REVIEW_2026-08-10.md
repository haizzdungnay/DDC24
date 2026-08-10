# Consumer review liên chức năng — candidate P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-CONSUMER-REVIEW-2026-08-10` |
| Loại | Biên bản consumer review; hồ sơ hỗ trợ, không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 1.0 |
| Ngày | 2026-08-10 |
| Phạm vi | 22 hồ sơ baseline tại candidate `e3e9fb2`; điều kiện “consumer review liên chức năng” của `PLAN_READY` |
| Chủ quản | Dev Lead (tổ chức review) |
| Người review | FE, BE, Core/Compiler, FW MCU, HW, Security, Ops, QA — với tư cách **bên tiêu thụ contract** |
| Trạng thái | **ĐÃ THỰC HIỆN VÒNG KỸ THUẬT — 9 finding, 9 đã sửa; `M4` và `PLAN_READY` vẫn `BLOCKED`** |
| Candidate được review | commit `e3e9fb26f61b39df8f805916333fc03b51f07f5f`, tree `54eb519ec9e18639b0eeb8a4a0c5c3381e9b32de` |
| Gói chủ quản | [`PROG-P0-GATE-2026-08-10`](PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md) |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để làm gì? | Ghi lại **vòng review từ phía bên tiêu thụ contract**: mỗi consumer đọc hồ sơ của producer mình phụ thuộc, tìm chỗ không implement được, và ghi finding kèm cách đóng. |
| 2. Ai phải đọc? | Document Control và Verification Lead (để biết `M4` còn thiếu gì); từng discipline lead (để xác nhận finding thuộc phần mình); authority ký `PLAN_READY`. |
| 3. Đã làm gì? | Đọc 22 hồ sơ theo **cặp producer → consumer**, đối chiếu As-Built với source thật, chạy kiểm máy truy vết hai chiều, và mở 9 finding. Cả 9 đã được sửa trong cùng phiên. |
| 4. Chưa làm gì? | **Chưa có chữ ký người thật cho từng vai trò.** Theo [`DOC-GOV-001`](../../00_governance/DOC_GOVERNANCE.md) §3, `M4` đòi reviewer là **con người** — vòng kỹ thuật này không thay được điều đó. |
| 5. Kết quả với gate? | `PLAN_READY` **vẫn `BLOCKED`**. Việc sửa 9 finding làm nội dung candidate đổi, nên phải phát hành **candidate mới** và ghim lại hash (§7). |
| 6. Điều gì nguy hiểm nhất trong 9 finding? | `F-CR-02`: BE ghi staging artifact dưới `${CONFIG_DIR}` còn Core chỉ mở locator dưới gốc khác — mọi Commission sẽ fail ở bước `STAGE` ngay lần chạy đầu. |
| 7. Bằng chứng? | §2 có lệnh chạy lại được và số đo thật; §3 dẫn `file:line` cho từng finding. |

## 1. Phạm vi và cách làm

### 1.1 Nguyên tắc

Consumer review **không** phải đọc lại toàn văn để bắt lỗi chính tả. Câu hỏi duy
nhất mỗi consumer phải trả lời là:

> “Với đúng những gì hồ sơ này viết, tôi có implement được phần của tôi mà không
> phải đoán, và không tạo ra hành vi khác với bên kia không?”

Vì vậy trọng tâm đặt vào **ranh giới**: chỗ hai hồ sơ cùng nói về một thứ, và chỗ
hồ sơ khẳng định một As-Built mà source phải xác nhận.

### 1.2 Cặp producer → consumer đã review

| Producer | Consumer đọc | Kết luận kỹ thuật |
|---|---|---|
| `IFSPEC-PROG-001` | FE, BE, Core, QA | `REQUEST_CHANGE` → đã sửa (`F-CR-02`) |
| `DM-PROG-001` | BE, FE, Core, Ops | `ACCEPT` — không có finding |
| `IFSPEC-ART-PROG-001` | Core, Security | `ACCEPT` — giới hạn khớp source tuyệt đối (§2.2) |
| `DDD-LANG-PROG-001` | Compiler, Core | `ACCEPT` — không có finding |
| `DDD-CTRL-PROG-001` | Core, Controls, Safety | `ACCEPT` — supersede của hồ sơ cũ đã ghi đúng chỗ |
| `DDD-LIFE-PROG-001` | BE, Ops | `ACCEPT` — không có finding |
| `DDD-SEC-PROG-001` | BE, Core, Platform | `REQUEST_CHANGE` → đã sửa (`F-CR-02`) |
| `DDD-BE-PROG-001` | Core, Ops, QA | `REQUEST_CHANGE` → đã sửa (`F-CR-02`, `F-CR-05`) |
| `DDD-FE-PROG-001` | FE, UX, QA | `REQUEST_CHANGE` → đã sửa (`F-CR-01`) |
| `UX-WEB-PROG-001` | FE, QA, Product | `REQUEST_CHANGE` → đã sửa (`F-CR-04`) |
| `DDD-FWSOM-PROG-001` | Core, Ops | `ACCEPT` — không có finding |
| `DDD-FWMCU-PROG-001` | FW MCU, HW, QA | `ACCEPT` — `IOP_SAFE_TIMEOUT_MS` khớp contract (§2.3) |
| `DDD-HW-PROG-001` | HW, QA | `ACCEPT` — không có finding |
| `ARCH-PROG-001` | mọi discipline | `REQUEST_CHANGE` → đã sửa (`F-CR-06`) |
| `TRACE-PROG-001` | QA, Document Control | `REQUEST_CHANGE` → đã sửa (`F-CR-03`, `F-CR-07`, `F-CR-08`) |
| `VVP-PROG-001` | QA, mọi discipline | `ACCEPT` — không có finding |
| `RSK-PROG-001` | QA, Product | `ACCEPT` — không có finding |
| `OPS-PROG-001` | Ops, QA | `ACCEPT` — không có finding |
| `SRS-PROG-001` | mọi discipline | `ACCEPT` — 60/60 giải được về ID canonical |
| `PROG-OD-001` | Product, mọi discipline | `ACCEPT` — 17/17 có owner và gate |
| `PROG-DOCSET-001` | mọi discipline | `ACCEPT` — register khớp đường dẫn thật |
| `PLAN-PROG-053` | mọi discipline | `ACCEPT` — phân bổ `32/32` kịch bản vào `G1..G6` cộng đúng (§2.4) |

### 1.3 Điều review này **không** làm

- Không ký thay Product, Architect, Verification, Safety hay Release.
- Không chạy test sản phẩm — `0/32` Test Result không đổi.
- Không đóng `OD-PROG-*`; không tự chuyển `ARCH-CONF-PROG-*` sang đóng.
- Không nâng hồ sơ nào từ `M3` lên `M4`.

## 2. Kiểm máy — số đo thật, chạy lại được

### 2.1 Truy vết hai chiều

```bash
python3 scripts/trace_bidirectional_check.py
```

| Thời điểm | Kết quả |
|---|---|
| Tại candidate `e3e9fb2` | **FAIL** — `kịch bản được §6 phủ: 30`; mồ côi `VS-PROG-008`, `VS-PROG-032` |
| Sau khi đóng `F-CR-03` | **PASS** — `60/60` alias giải được, `32/32` kịch bản có đường về requirement |

Cách tái kiểm trạng thái cũ:

```bash
git show e3e9fb2:docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md > /tmp/trace-old.md
```

### 2.2 As-Built khai trong hồ sơ ↔ source thật

Mọi khẳng định As-Built được kiểm bằng cách mở đúng file, không suy từ tài liệu:

| Khẳng định trong hồ sơ | Vị trí source | Kết quả |
|---|---|---|
| Giới hạn artifact `1 MiB` / `16` section | `apps/core/application/st/st_ir.hpp:36,66` | **KHỚP** |
| `slot / writable slot = 1024 / 512` | `st_ir.hpp:59,60` | **KHỚP** |
| `constants / FB / binding = 512 / 64 / 256` | `st_ir.hpp:61,62,63` | **KHỚP** |
| `RETAIN ≤ 128 biến, ≤ 4096 byte` | `st_ir.hpp:64,65`; `st_limits.hpp` | **KHỚP** |
| ST source `64 KiB`, `512` biến, `4096` statement | `st_limits.hpp` | **KHỚP** |
| `IR-E-001..015` tồn tại | `st_loader.hpp:28-42` | **KHỚP** — đủ 15 mã |
| `allow_unsigned=false` mặc định | `st_loader.hpp:96` | **KHỚP** |
| Schema artifact `= 1` | `st_artifact.hpp:22` | **KHỚP** |
| FE As-Built: `App.tsx`, `ProgrammingPage.tsx`, `ValidatorPage.tsx`, `client.ts`, `useWebSocket.ts`, `i18n.tsx`, cờ `LEGACY_GRAPH_DEMO_ENABLED` | `apps/web-ui/src/...`; cờ tại `App.tsx:31` | **KHỚP** — 6/6 file tồn tại |
| BE As-Built: `internal/app` chưa có Programming; `modernc.org/sqlite` là dependency | `apps/web-api/internal/app/`; `go.mod:14` | **KHỚP** |
| `kMaxTasks=8`, `50..60000 ms` (xung đột `ARCH-CONF-PROG-001`) | `st_scheduler.hpp:50-55` | **KHỚP** — xung đột có thật |
| `st_sched = nullptr` (xung đột `ARCH-CONF-PROG-002`) | `apps/core/application/runtime/scan_loop.hpp:52` | **KHỚP** — xung đột có thật |
| `any_force_safe` (xung đột `ARCH-CONF-PROG-004`) | `st_scheduler.cpp:351,355`; lộ ra API tại `st_control_api.cpp:192` | **KHỚP** — xung đột có thật |

Không tìm thấy khẳng định As-Built nào sai. Đây là kết quả đáng ghi nhận: hồ sơ
mô tả đúng những gì source có, kể cả những chỗ bất lợi cho chính hồ sơ.

### 2.3 Ranh giới an toàn MCU

| Khẳng định | Nguồn | Kết quả |
|---|---|---|
| `IOP_SAFE_TIMEOUT_MS = 200` | `contracts/iop/iop_protocol.h:54` | **KHỚP** |
| MCU vào SAFE khi không có frame hợp lệ `≥200 ms`; requirement giữ `max_iop_poll_gap < 200 ms` | `DDD-FWMCU-PROG-001` §4; `NFR-REQ-PROG-108` | **NHẤT QUÁN** — bất đẳng thức ngặt ở cả hai phía, mốc HIL `199/200/201 ms` phủ đúng biên |

### 2.4 Phân bổ kịch bản theo gate

Tự cộng lại bảng `PLAN-PROG-053` §5.2: hợp của `G1..G6` cho đúng
`VS-PROG-001..032`, không kịch bản nào mồ côi và không kịch bản nào ngoài dải.
Ghi chú “cộng cột ra 33 vì `VS-019` đếm hai lần” trong §5.5 là **đúng** và đã
được giải thích trong chính hồ sơ.

### 2.5 Harness tài liệu

```bash
python3 scripts/docs_iso_harness.py --expect
```

`PASS`; `EXPECT` khớp toàn bộ ngưỡng sau khi đồng bộ `svg_assets: 6 → 7` trong
cùng commit thêm asset (`F-CR-04`).

## 3. Sổ finding

Mức: `P0` chặn implement và có hậu quả runtime · `P1` làm hai bên implement lệch
nhau hoặc vi phạm quy tắc tài liệu bắt buộc · `P2` gây hiểu nhầm, không đổi hành vi.

| ID | Mức | Consumer phát hiện | Hồ sơ | Nội dung | Trạng thái |
|---|---|---|---|---|---|
| `F-CR-01` | P1 | FE | `DDD-FE-PROG-001` | §12 và §16 vẫn mô tả IA **sáu trang** đã bị thay | **ĐÃ ĐÓNG** v0.7 |
| `F-CR-02` | P1 | Core + BE | `IFSPEC-PROG-001`, `DDD-BE-PROG-001`, `DDD-SEC-PROG-001` | Gốc thư mục staging artifact mâu thuẫn giữa producer và consumer | **ĐÃ ĐÓNG** |
| `F-CR-03` | P1 | QA | `TRACE-PROG-001` | `VS-PROG-008` và `VS-PROG-032` không có dòng trace nào dẫn tới | **ĐÃ ĐÓNG** v2.5 |
| `F-CR-04` | P1 | UX + FE | `UX-WEB-PROG-001` | `RetainResetDialog` thiếu bản đặc tả trực quan bắt buộc | **ĐÃ ĐÓNG** v0.7 |
| `F-CR-05` | P2 | BE | `DDD-BE-PROG-001` | Gói tầng biên có hai tên: `http/` và `transport` | **ĐÃ ĐÓNG** v0.6 |
| `F-CR-06` | P1 | mọi discipline | `ARCH-PROG-001` | 6 xung đột §11 không có ADR chủ quản | **ĐÃ ĐÓNG** v0.5 |
| `F-CR-07` | P2 | Document Control | `TRACE-PROG-001` | §8 ghi “55 dòng” trong khi §6 có 60 dòng | **ĐÃ ĐÓNG** v2.5 |
| `F-CR-08` | P2 | Document Control | `TRACE-PROG-001` | Hai mục cùng đánh số `## 10` | **ĐÃ ĐÓNG** v2.5 |
| `F-CR-09` | P2 | Document Control | `ADR-LOG-001` | `docs/adr/` không phản ánh số ADR đã cấp phát | **ĐÃ ĐÓNG** |

### `F-CR-01` — FE còn hai kiến trúc route cùng lúc

**Consumer:** Frontend. **Hồ sơ:** `DDD-FE-PROG-001` v0.6.

Bản v0.6 ghi trong lịch sử là đã “đóng finding P1-01: xóa cây thư mục và tám route
cũ khỏi §2”. Nhưng việc sửa **chỉ áp cho §2**. §12 vẫn còn cây thư mục
`overview/, editor/, fbd/, mapping/, task/, check/, commission/, runtime/, retain/,
bundles/, audit/` và §16 vẫn liệt kê sáu route riêng biệt `.../programs`,
`.../mapping`, `.../task` cùng sáu page container tương ứng.

**Hậu quả nếu implement theo hồ sơ:** lập trình viên FE đọc §16 — bảng cụ thể nhất,
có cột query/mutation — sẽ dựng 6 route và 6 page, trong khi `UX-WEB-PROG-001` §11
và `§0.1` yêu cầu **4 route** với tab ở query parameter. Ràng buộc “đổi tab không
mất nội dung đang gõ” (`VS-PROG-032`) không thể thỏa mãn với kiến trúc 6 route.

**Đã đóng:** §12 bỏ cây trùng, chỉ giữ chi tiết `api/` và `model/`; §16 thay bằng
đúng bốn route kèm ba tab `PGM-02` và ba tab `PGM-04`; bảng layer đổi sang tên
thư mục có thật. Hồ sơ lên v0.7.

### `F-CR-02` — Commission sẽ fail ở bước `STAGE` ngay lần đầu

**Consumer:** Core (bên mở file) và BE (bên ghi file). **Mức P1, hậu quả runtime.**

Ba hồ sơ nói ba kiểu về nơi đặt file staging bàn giao artifact:

| Hồ sơ | Nội dung tại candidate |
|---|---|
| `IFSPEC-PROG-001` §12 | “locator phải nằm dưới `${CONFIG_DIR}/programming/staging/`” |
| `DDD-BE-PROG-001` §14 | artifact ghi dưới `${STATE_DIR}/programming/artifacts/sha256/...` |
| `DDD-FWSOM-PROG-001` §16 | `platform/packaging/` tạo “state/staging/retain/journal dirs” |
| `DDD-SEC-PROG-001` §7 | chỉ nói “root fixed”, không nêu tên gốc |

`OPS-PROG-001` §10 xác nhận ba gốc thật trên target là `/data/config`,
`/data/mkddc` và `/run/mkddc`.

**Hậu quả:** BE ghi file dưới một gốc, Core từ chối mọi locator ngoài gốc kia. Mọi
`POST /operations/commission` fail ở `STAGE`. Lỗi này **không** bị host test bắt
được vì host test thường dùng thư mục tạm chung.

**Đã đóng:** thống nhất `${STATE_DIR}/programming/staging/` — khớp packaging, khớp
Ops, và giữ đúng ngữ nghĩa `CONFIG_DIR` là cấu hình chứ không phải nơi chứa file
churn theo từng Commission. `IFSPEC-PROG-001` §12 thêm bảng ba gốc và quy tắc
reject; `DDD-BE-PROG-001` §14 và `DDD-SEC-PROG-001` §7 trích cùng bảng đó.

> Lưu ý cho authority: việc chọn `STATE_DIR` là **hòa giải kỹ thuật giữa ba hồ sơ
> đang mâu thuẫn**, không phải quyết định kiến trúc mới. System Architect vẫn phải
> xác nhận khi ký; nếu chọn ngược lại thì cả ba hồ sơ và `platform/packaging` phải
> đổi cùng lúc.

### `F-CR-03` — hai kịch bản không có đường về requirement

**Consumer:** QA/Verification. Chi tiết số đo ở §2.1.

`VVP-PROG-001` ánh xạ `VS-PROG-008 → FE-102` và `VS-PROG-032 → FE-101` (chiều
ngược). Nhưng §6 của `TRACE-PROG-001` — bảng máy đọc được, cũng là nơi §5 tuyên bố
coverage — không dòng nào dẫn tới hai kịch bản này (chiều xuôi). Chúng chỉ xuất
hiện trong văn xuôi ở §10.1 và §10.2.

**Hậu quả:** báo cáo coverage dựng từ §6 cho `30/32`; và khi `FE-101`/`FE-102` đổi,
không có tín hiệu nào cho biết hai kịch bản này phải chạy lại.

**Đã đóng:** thêm `032` vào dòng `FE-101`, `008` vào dòng `FE-102`, cộng
`scripts/trace_bidirectional_check.py` để lỗi cùng loại không tái diễn im lặng.

### `F-CR-04` — thao tác không hoàn tác được thiếu đặc tả trực quan

**Consumer:** UX và FE. **Hồ sơ:** `UX-WEB-PROG-001` v0.6.

[`DOC-GOV-001`](../../00_governance/DOC_GOVERNANCE.md) §2.2 yêu cầu **mọi**
modal/drawer chứa quyết định an toàn, hành động không hoàn tác được hoặc thay đổi
runtime phải có bản đặc tả trực quan render được. Bộ asset tại candidate phủ modal
Commission (`PGM-03`) và ngăn kéo Restore (`PGM-04`), nhưng **không** phủ
`RetainResetDialog` — dù hộp thoại này được khai báo ở §22 với “xác nhận mạnh +
xác thực lại”, và `POST /retain/reset` là thao tác xóa vĩnh viễn trạng thái điều
khiển đã lưu. Bảng tự kiểm `DD-08` vẫn ghi `PASS`.

**Đã đóng:** thêm `PGM-04_RETAIN_RESET_DIALOG.svg` (1440 × 1120, ba artboard: đang
mở / đang gửi / bị khóa vì impact `UNAVAILABLE`), thêm §16.4.1 với ba quy tắc
implement, sửa lại `DD-08`. Hồ sơ lên v0.7.

### `F-CR-05` — gói tầng biên có hai tên

`DDD-BE-PROG-001` §1 khai `http/`, còn §12 khai `transport.Handler` và
`IFSPEC-PROG-001` §16 ghi đường dẫn `{transport,service,store}`. Hai trong ba nơi
dùng `transport`. **Đã đóng:** §1 và §0 đổi sang `transport/`, kèm ghi chú phải
đổi cả ba nơi trong một commit nếu sau này muốn đổi tên.

### `F-CR-06` — sáu xung đột kiến trúc không có chủ

`ARCH-PROG-001` §11 liệt kê `ARCH-CONF-PROG-001..006` kèm “quyết định cần có”,
nhưng không xung đột nào có ADR chủ quản. Điều kiện “không còn authority mâu
thuẫn” của `PLAN_READY` vì vậy không có vật thể nào để ký.

**Đã đóng:** sáu ADR `ADR-026..031` ở trạng thái `Proposed`, mỗi ADR có bối cảnh
As-Built dẫn `file:line`, quyết định, phương án bị loại kèm lý do, hệ quả và điều
kiện xác minh trước khi chuyển `Accepted`. §11 thành bảng có cột ADR và trạng thái.

**Quan trọng:** `Proposed` **không** phải `Accepted`. Xung đột vẫn tính là còn mở.

### `F-CR-07` / `F-CR-08` — số đếm cũ và số mục trùng trong ma trận trace

§8 của `TRACE-PROG-001` viết “trước khi 55 dòng được kiểm lại” trong khi §6 đã có
60 dòng — vi phạm quy tắc trung thực số 7 của `DOC-GOV-001` §6. Cùng hồ sơ có hai
mục đánh số `## 10`, làm trích dẫn “§10” thành nước đôi. **Đã đóng:** sửa thành
`60 dòng`; phụ lục tự kiểm đổi thành `§11`, giữ nguyên `§10` cho phần journey vì
`UX-WEB-PROG-001` đang trích đúng mục đó.

### `F-CR-09` — thư mục `docs/adr/` không cho biết số ADR còn trống

Phát hiện trong lúc đặt số cho sáu ADR mới: `ADR-024` và `ADR-025` **đã được cấp
phát** trong `ADR-LOG-001` (Modbus RTU Point; process-first + bounded modules) mà
không có file riêng trong `docs/adr/`. Người đặt số theo `ls docs/adr/` sẽ chọn
`024` và tạo ID trùng cho hai quyết định khác hẳn nhau — đúng loại lỗi mà
`DOC-GOV-001` §6 quy tắc 6 cấm.

**Đã đóng:** `ADR-LOG-001` ghi rõ nó là authority cấp phát số, liệt kê các ADR chỉ
tồn tại dưới dạng dòng đăng ký, và ghi số cao nhất đã cấp phát. Sáu ADR mới đặt là
`ADR-026..031`.

## 4. Điều kiện `M4` — vì sao vẫn chưa đạt

`DOC-GOV-001` §3 định nghĩa `M4 — REVIEW CLOSED` là “**cần con người**: reviewer
của bên **tiêu thụ** contract đã đọc và đóng finding P0/P1”. Vòng này đã làm phần
kỹ thuật của vế thứ hai — finding P0/P1 đã đóng — nhưng **không** thay được vế thứ
nhất. Tự kiểm của bên soạn, kể cả khi tìm ra lỗi thật, không nâng được mức trưởng
thành.

Vì vậy: **`0/22` `M4` giữ nguyên.** Điều kiện còn lại là chữ ký của người có thẩm
quyền theo bảng §6 của [`PROG-P0-GATE-2026-08-10`](PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md).

## 5. Kết luận theo vai trò

| Vai trò | Kết luận kỹ thuật vòng này | Chữ ký người thật |
|---|---|---|
| FE (consumer của IFSPEC/UX/DM) | `REQUEST_CHANGE` → đã sửa `F-CR-01` | **PENDING** |
| BE (consumer của IFSPEC/DM/LIFE/SEC) | `REQUEST_CHANGE` → đã sửa `F-CR-02`, `F-CR-05` | **PENDING** |
| Core/Compiler (consumer của ART/LANG/CTRL/IFSPEC) | `REQUEST_CHANGE` → đã sửa `F-CR-02` | **PENDING** |
| FW MCU + HW | `ACCEPT` — không có finding | **PENDING** |
| Security/Platform | `REQUEST_CHANGE` → đã sửa `F-CR-02` | **PENDING** |
| Ops | `ACCEPT` — không có finding | **PENDING** |
| QA/Verification | `REQUEST_CHANGE` → đã sửa `F-CR-03` | **PENDING** |
| Document Control | `REQUEST_CHANGE` → đã sửa `F-CR-06..09` | **PENDING** |

Cột phải là cột quyết định `M4`. Cột giữa **không** thay được cột phải.

## 6. Ảnh hưởng tới các gate

| Gate | Trước vòng review | Sau vòng review | Vì sao |
|---|---|---|---|
| Consumer review liên chức năng | `BLOCKED` — chưa thực hiện | `BLOCKED` — **đã thực hiện vòng kỹ thuật**, chờ chữ ký | `M4` đòi con người |
| Không còn authority/xung đột kiến trúc | `BLOCKED` — 6 xung đột vô chủ | `BLOCKED` — 6/6 có ADR `Proposed` | `Proposed` chưa phải `Accepted` |
| Ghim candidate | `PASS` tại `e3e9fb2` | **HẾT HIỆU LỰC** — nội dung đã đổi | §7 |
| `PLAN_READY` | `BLOCKED` | `BLOCKED` | thiếu chữ ký và `OD-PROG-015` |
| `IMPLEMENT_READY[*]` | `BLOCKED` | `BLOCKED` | phụ thuộc `PLAN_READY` |

## 7. Candidate phải được ghim lại

Chín finding đã được sửa, nên `e3e9fb2` **không còn là nội dung sẽ được ký**.
Theo [`PROG-P0-CANDIDATE-MANIFEST-2026-08-10`](PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md)
§1, phải phát hành candidate/hash mới và review lại phần chịu ảnh hưởng.

Bảy hồ sơ trong mẫu số 22 đã đổi: `ARCH-PROG-001`, `IFSPEC-PROG-001`,
`DDD-SEC-PROG-001`, `DDD-BE-PROG-001`, `DDD-FE-PROG-001`, `UX-WEB-PROG-001`,
`TRACE-PROG-001`. Reviewer chỉ cần review lại bảy hồ sơ này; mười lăm hồ sơ còn
lại giữ nguyên hash và **không** cần đọc lại.

## 8. Việc phải làm tiếp, có owner

| Việc | Owner | Điều kiện hoàn tất |
|---|---|---|
| Phát hành manifest candidate mới sau khi merge | Document Control | commit/tree/22 SHA-256 mới |
| Ký `ACCEPT/REQUEST_CHANGE/REJECT` theo từng vai trò §5 | tám vai trò consumer | họ tên, ngày, revision cụ thể |
| Chuyển `ADR-026..031` sang `Accepted` hoặc yêu cầu sửa | System Architect, Safety, Security, Verification | chữ ký trên từng ADR |
| Ký `OD-PROG-015` | Product Owner + QA | decision record |
| Xác nhận lựa chọn `STATE_DIR` ở `F-CR-02` | System Architect | ghi vào biên bản ký |

## 9. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-10 | Thực hiện vòng consumer review kỹ thuật trên candidate `e3e9fb2`: 22 hồ sơ theo cặp producer→consumer, kiểm As-Built với source thật, kiểm truy vết hai chiều bằng máy; mở và đóng 9 finding `F-CR-01..09`; giữ `M4` `0/22` và `PLAN_READY` `BLOCKED` vì chữ ký người thật còn thiếu |
