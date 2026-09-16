# BACnet Rev A — Open Decisions

**ID:** OD-BAC-SET-001
**Trạng thái:** Active (danh mục vấn đề mở, không phải Design)
**Ngày:** 2026-09-16 (cập nhật sau chữ ký chủ sở hữu cho `OD-BAC-009`)
**Chủ quản:** Project Engineering

> **CẬP NHẬT 2026-09-16 — `OD-BAC-009` ĐÃ KÝ, chọn phương án (a) vendor vào nguồn nội bộ.**
> 9/11 quyết định đã đóng; còn 2 mã `PENDING-HUMAN` là `OD-BAC-007` và `OD-BAC-008`.
> Xem §4.2 để biết phạm vi thi hành chính xác.

> **CẬP NHẬT 2026-09-10 — 8/11 quyết định đã được CTO ký; 3 quyết định KHÔNG thuộc
> thẩm quyền kỹ thuật.** Xem [Biên bản phê duyệt](../07_records/reviews/BACNET_REV_A_APPROVAL_RECORD_2026-09-10.md).
>
> `OD-BAC-001` **CLOSED (sửa PICS xuống đúng thực trạng)** · `-002` **CLOSED (chấp nhận
> breaking change một lần ở Rev A)** · `-003` **CLOSED (nối AV/BV/MSV vào core, prio 3)** ·
> `-004` **CLOSED (N = 90 s, ba trạng thái, ngưỡng trong config)** · `-005` **CLOSED (bỏ
> TimeSync khỏi Rev A)** · `-006` **CLOSED (mở lại `/bacnet/objects` chỉ đọc)** ·
> `-010` **CLOSED (test host KHÔNG là bằng chứng BACnet)** · `-011` **CLOSED (4 năng lực
> chuyển V1.1)**.
>
> **Còn chặn — cần chữ ký người thật, không phải quyết định kỹ thuật:**
> `OD-BAC-007` (cấp thiết bị HIL + chỉ định người chạy T1..T9) ·
> `OD-BAC-008` (nộp đơn ASHRAE lấy `Vendor_Identifier`).
> ~~`OD-BAC-009`~~ **đã ký 2026-09-16** — xem §4.2.
> Hai mục còn lại là **cam kết nguồn lực và thẩm quyền tổ chức**; CTO ghi khuyến nghị nhưng
> **không** ký thay. Không có chúng thì Rev A **không thể** đánh `DONE` (xem §4).

**Đọc cùng:** [As-Built Review](../05_verification/BACNET_REV_A_ASBUILT_REVIEW.md) ·
[Implementation Plan](../03_implementation/BACNET_REV_A_IMPLEMENTATION_PLAN.md) ·
[Plan doc→code→E2E Forlinx](../03_implementation/BACNET_DOC_TO_CODE_E2E_PLAN.md) ·
[ADR-057…ADR-060](DECISIONS.md)

> Tài liệu này liệt kê **quyết định còn thiếu authority**. Nó không tự quyết định thay
> Product/CTO. Không được coi khuyến nghị ở đây là quyết định đã duyệt.
>
> **Ràng buộc thi hành:** WP-BAC-01 nay đã được gỡ chặn (`OD-BAC-001` CLOSED).
> Các WP còn lại phụ thuộc từng quyết định như ghi ở cột "Chặn WP". Sau chữ ký
> `OD-BAC-009` ngày 2026-09-16, WP-09/WP-10 **chỉ còn bị chặn cứng bởi `OD-BAC-007`**
> (thiết bị HIL và người vận hành). `OD-BAC-008` chặn phát hành, không chặn verify.

---

## 1. Bảng quyết định

| ID | Vấn đề | Ảnh hưởng nếu chưa quyết | Owner cần ký | Khuyến nghị kỹ thuật | Chặn WP | Trạng thái |
|---|---|---|---|---|---|---|
| **OD-BAC-001** | **Chấp nhận sửa PICS xuống đúng thực trạng?** 9/14 BIBB đang khai ✅ nhưng chưa implement hoặc chỉ là placeholder. | Nếu giữ nguyên: hồ sơ tích hợp nói dối BMS engineer, và bài test BTL sẽ phơi ra sai lệch PICS — lỗi nặng hơn khai thiếu. Nếu sửa: phải thông báo cho bên đã nhận PICS bản cũ. | Product + CTO | **Sửa PICS.** Chính PICS §4 đã tự viết nguyên tắc này ngày 2026-08-07: *"với hồ sơ chứng nhận thì khai sai nguy hiểm hơn khai thiếu"*. Áp nguyên tắc đó cho 9 dòng còn lại. | 01 (chặn toàn bộ) | **CLOSED 2026-09-10 — Sửa PICS xuống đúng thực trạng.** Hồ sơ chứng nhận là cam kết với bên thứ ba; PICS §4 dòng 70 đã tự viết luật này. Kiểm bằng mã: không có handler cho `SUBSCRIBE_COV`, `ACKNOWLEDGE_ALARM`, `WRITE_PROP_MULTIPLE`, `WHO_HAS`. Thêm cột Evidence `file:line` bắt buộc. Phải thông báo lại cho bên đã nhận PICS bản cũ. |
| **OD-BAC-002** | **Đổi object set có được chấp nhận là breaking change không?** Bỏ 8 BI ở base SKU (WP-02) và cấp lại `objectInstance` từ `pointStableId` sẽ làm hỏng cấu hình BMS đã tích hợp. | Chưa quyết ⇒ hoặc giữ object giả mãi mãi, hoặc đổi âm thầm và làm hỏng site đang chạy. | Product + Field Service | Chấp nhận breaking **một lần** ở Rev A, kèm ghi chú release rõ ràng và công cụ xuất bảng object mới. Rev A chưa GA nên chi phí thấp nhất là bây giờ. | 02 | **CLOSED 2026-09-10 — Chấp nhận breaking change MỘT LẦN ở Rev A** (ADR-058). Rev A chưa GA nên cửa sổ rẻ nhất là bây giờ. Bắt buộc kèm release note và công cụ xuất bảng object mới (CSV) cho field service. Mở lại nếu tới lúc thi hành đã có site nhận bàn giao chính thức. |
| **OD-BAC-003** | **AV/BV/MSV có được ghi qua BACnet không?** Hiện WriteProperty được nhận, readback trả đúng, nhưng **không tới core** — tức là báo thành công sai. | Chưa quyết ⇒ lỗi im lặng tiếp diễn. Đây là lỗi báo-thành-công-sai, nguy hiểm hơn từ chối thẳng. | Product + Controls | **Nối vào core** với `PRIO_BACNET=3`, đi qua arbitration như AO/BO. Nếu Product không muốn cho BMS ghi biến PLC thì phải trả `WRITE_ACCESS_DENIED` — tuyệt đối không nhận rồi bỏ. | 04 | **CLOSED 2026-09-10 — Nối AV/BV/MSV vào core, `PRIO_BACNET=3`, qua arbitration như AO/BO.** Đo được: `bacnet_objects.cpp:342-375` ĐÃ gọi `fn(...,3)`; chỗ đứt là `bacnet_server.cpp:110-111` chỉ đăng ký callback AO/BO. Chi phí nối thấp hơn chi phí viết nhánh từ chối. **Không merge** phần nối nếu chưa có test `LOOPBACK` chứng minh giá trị tới core. |
| **OD-BAC-004** | **Định nghĩa `bmsLink = online` là gì?** Hiện `bip_init()` thành công ⇒ `online`, kể cả khi không có BMS nào trên mạng. | Vận hành tin vào đèn xanh sai. Không phát hiện được BMS rớt. | Product + UX + Ops | `online` khi có `lastRx` từ một BACnet peer trong cửa sổ **N giây**; `unknown` khi thiếu số đo. Đề xuất N = 90 s (3× chu kỳ poll BMS điển hình 30 s) — **phải đo lại** trên site thật trước khi chốt. | 06 | **CLOSED 2026-09-10 — `N = 90 s`, ba trạng thái `online`/`offline`/`unknown`; ngưỡng nằm trong config, không hardcode.** `online` chỉ khi có `lastRx` từ một BACnet peer trong 90 s; `unknown` khi iobus chưa publish `lastRx` (tuyệt đối không quy về `offline`). Chốt số để implement được ngay. **Điều kiện đo lại:** sau `T-BAC-064` (HIL), nếu chu kỳ poll BMS thật > 30 s thì đặt `N = 3×` chu kỳ đo được và ghi vào release record. |
| **OD-BAC-005** | **TimeSync: bỏ hay nối?** PICS khai `DM-TS-B` (nhận time sync), nhưng mã hiện có là `Send_TimeSync_Device()` = vai trò **master/TS-A**, và hàm đó **không có caller nào**. | PICS sai theo hai chiều cùng lúc: khai sai vai trò, và khai tính năng chưa chạy. | Product + Controls | **Bỏ khỏi Rev A** (khai ❌). DDC làm time master trên mạng BMS thường là điều BMS **không** mong muốn. Nếu cần đồng bộ giờ thì dùng NTP. | 01 | **CLOSED 2026-09-10 — Bỏ TimeSync khỏi Rev A, PICS khai ❌; xoá luôn mã chết.** `send_time_sync()` (`bacnet_server.cpp:334`) không có caller và gửi `Send_TimeSync_Device()` = vai master (TS-A), ngược với `DM-TS-B` đang khai. DDC làm time master trên mạng BMS là thứ tích hợp viên thường cấm. Đồng hồ dùng NTP. |
| **OD-BAC-006** | **`/bacnet/objects` (object catalog) mở lại ở Rev A hay giữ Rev B?** Endpoint này đã bị **gỡ khỏi contract Rev A** theo quyết định 2026-08-20 (xem `contract_routes_test.go:48`). Nhưng yêu cầu WP-BAC-08 của Owner lại đòi "FE object catalog". | Hai nguồn authority mâu thuẫn. Chưa quyết ⇒ WP-BAC-08 không biết làm theo cái nào. | Product | **Mở lại ở Rev A, chỉ đọc.** Sau WP-BAC-02, registry đã có sẵn đủ 8 trường; phơi ra một endpoint đọc là chi phí thấp và là công cụ chẩn đoán tích hợp có giá trị cao. Không mở đường ghi. | 08 | **CLOSED 2026-09-10 — Mở lại `/bacnet/objects` ở Rev A, CHỈ ĐỌC, RBAC như endpoint đọc khác** (ADR-059, đảo quyết định 2026-08-20). Bối cảnh đã đổi: nay đã biết 64/88 object không có dữ liệu thật, và catalog đọc là cách rẻ nhất để tích hợp viên tự phát hiện điều đó trước khi ra site. **Ràng buộc:** phải phơi cả **nguồn dữ liệu** từng object (có/không nối core) — một catalog nói dối tệ hơn không có. Không mở đường ghi. |
| **OD-BAC-007** | **Cấp tài nguyên HIL.** Cần: board DDC-24 thật, BMS hoặc BACnet test client, nguồn tín hiệu vật lý cho UI1, thiết bị đo đầu ra AO/BO, LAN. | **Không có thì Rev A không thể đánh DONE** — theo định nghĩa của chính Owner, simulator/mock không được tính là bằng chứng. | Product + Lab/QA | Cấp thiết bị và chỉ định owner chạy T1..T9. Đây là hạng mục có lead time dài nhất trong kế hoạch — nên khởi động **song song** với WP-01, không đợi đến WP-09. | 09 (chặn DoD) | **PENDING-HUMAN — ngoài thẩm quyền CTO.** Đây là chi tiêu và phân công người thật, không phải phán đoán kỹ thuật. **Cần ký:** Product Owner (ngân sách) + Trưởng Lab/QA (chỉ định người chạy T1..T9). **Cần gì để mở:** 1 board DDC-24 Rev A + STM32G0B1 trên `/dev/ttyS2`; 1 BMS hoặc BACnet test client; nguồn tín hiệu vật lý cho UI1; thiết bị đo đầu ra AO/BO; LAN dùng chung; tên người + cửa sổ thời gian bo. **Hệ quả nếu không duyệt:** Rev A đóng ở mức `TARGET-FAKE` và **phải ghi NOT READY** — không hạ tiêu chí. *Khuyến nghị CTO: cấp ngay, lead time dài nhất toàn kế hoạch; khởi động song song WP-01, không đợi WP-09.* |
| **OD-BAC-008** | **`Vendor_Identifier = 9999` đi tiếp tới đâu?** Là placeholder chờ ASHRAE cấp số. | Ra site với `9999` thì hai thiết bị khác hãng có thể trùng vendor id. | Product + CTO | Nộp đơn ASHRAE **ngay** (lead time nhiều tuần). Nếu Rev A phát hành trước khi có số, ghi rõ trong release record là hạn chế đã biết. | 10 | **PENDING-HUMAN — ngoài thẩm quyền CTO.** Nộp đơn ASHRAE là hành vi pháp lý/hành chính với bên thứ ba. **Cần ký:** Product Owner + đại diện pháp nhân công ty (đơn ASHRAE yêu cầu pháp nhân, không phải cá nhân kỹ thuật). **Cần gì để mở:** tên pháp nhân, địa chỉ, đầu mối liên hệ, phí đăng ký, người ký đơn. **Hệ quả nếu không duyệt:** ra site với `Vendor_Identifier = 9999` (`bacnet_server.cpp:98`) — hai thiết bị khác hãng có thể trùng vendor id. *Khuyến nghị CTO: nộp ngay (lead time nhiều tuần); nếu Rev A phát hành trước khi có số thì ghi `9999` là hạn chế đã biết trong release record, không giấu.* |
| **OD-BAC-009** | **Đường lấy bacnet-stack 1.3.8 cho build và CI.** Build `BACNET=ON` hiện **hỏng** trong môi trường agent: FetchContent tải tarball từ `github.com` bị egress policy chặn (HTTP 403). | Không dựng được bản có BACnet ⇒ không test được, không phát hành được. Đồng thời điều này đang che giấu vấn đề: bộ test host vẫn PASS 1440/1440 với `BACNET=OFF`. | Platform + Security | Vendor bacnet-stack 1.3.8 vào artifact nội bộ hoặc mirror, và **thêm một gate CI dựng `BACNET=ON`**. Không được để cấu hình `OFF` là đường build mặc định duy nhất được kiểm. | 09, 10 | **CLOSED 2026-09-16 — chọn phương án (a): vendor `bacnet-stack 1.3.8` vào nguồn nội bộ, bỏ `FetchContent` từ `github.com`.** Ký bởi chủ sở hữu (kimlam2010). Lý do chọn (a) thay vì (b)/(c): (b) mở egress `github.com` là đổi một rủi ro dựng lấy một rủi ro bảo mật và vẫn phụ thuộc chính sách của bên khác; (c) pkg-config không ghim được **đúng** 1.3.8. **Phạm vi bắt buộc — cả hai, không chỉ bacnet-stack:** `apps/iobus/CMakeLists.txt:37` (bacnet-stack) **và** `:183` (googletest). Xác minh lại 2026-09-16 tại `main@2e63a99`: `grep -n 'github.com' apps/iobus/CMakeLists.txt` → **2 dòng**, cả hai còn nguyên. googletest hiện chỉ sống nhờ fallback `find_package(GTest QUIET)`; máy sạch thì cả hai đứt. **Ràng buộc:** giữ nguyên từng byte bản 1.3.8 (patch phải tách commit riêng có lý do); ghim bằng sha/checksum, không `latest`, không nhánh; `BACNET=OFF` vẫn phải dựng và test được như trước. Thi hành ở #625. |
| **OD-BAC-010** | **Bộ test host có được tính là bằng chứng BACnet không?** 67 test tên BACnet đang PASS với `MKDDC_ENABLE_BACNET=OFF` — không test nào gửi/nhận một gói UDP. | Chưa quyết ⇒ tiếp tục dùng "1440/1440 PASS" như thể nó chứng minh BACnet chạy. | QA + CTO | **Không.** Đặt quy tắc: capability BACnet chỉ được đánh VERIFIED khi có bằng chứng **target**. Bổ sung một tầng test tích hợp loopback UDP (chạy được trên CI) làm bước trung gian, nhưng nó vẫn không thay thế HIL. | 09, 10 | **CLOSED 2026-09-10 — KHÔNG. Test host không phải bằng chứng BACnet** (ADR-060). Số CTO tự đo 2026-09-10: `1440/1440 PASS` với `MKDDC_ENABLE_BACNET=OFF`, trong đó **81** test mang tên BACnet nhưng **chỉ 1** test chạm `BacnetServer` (`#151 BacnetServer.OutputCallbackMapsWriteAndReleaseToCore`); không test nào mở socket. Luật chốt: capability BACnet chỉ `VERIFIED` khi có bằng chứng `TARGET`; thêm tầng `LOOPBACK` (UDP thật, cùng máy) làm cổng bắt buộc cho mọi PR chạm `adapters/bacnet/**`; `LOOPBACK` PASS ghi là `VERIFIED-LOOPBACK`, **không** được ghi `VERIFIED`. |
| **OD-BAC-011** | **Alarm/Event, Schedule, Calendar, Trend Log chuyển V1.1 — xác nhận?** Cả bốn đều thiếu ít nhất một trong: source / runtime wiring / network / target test. | Nếu giữ trong Rev A thì scope phình ~3× và ngày phát hành trượt. | Product | **Chuyển V1.1** và sửa PICS thành ❌. Trend Log thậm chí không có dòng mã nào trong repo — giữ nó trong Rev A là không thực tế. | 01 | **CLOSED 2026-09-10 — Alarm/Event, Schedule, Calendar, Trend Log chuyển V1.1; PICS khai ❌** (ADR-057). Trend Log không có một dòng mã nào trong repo; Schedule/Calendar có object nhưng `register_objects()` (`bacnet_server.cpp:214-226`) không tạo cái nào; Alarm là placeholder với `targets_` rỗng. Giữ trong Rev A làm scope phình ~3× mà không đổi được sự thật là chúng chưa tồn tại. |

---

## 2. Ghi chú về hai quyết định đã có, không mở lại

| ID | Quyết định | Nguồn | Trạng thái |
|---|---|---|---|
| ARCH-R010 | BACnet MS/TP bị bỏ; RS-485 dành cho Modbus RTU master | PICS §5, 2026-05-30 | **CLOSED** — không mở lại |
| OD-MBRTU-014 | Modbus RTU Point **không** expose qua BACnet ở Rev A | `MODBUS_RTU_OPEN_DECISIONS.md`, 2026-08-20 | **CLOSED** — khớp với OUT OF SCOPE của Rev A |

---

## 3. Thứ tự xin chữ ký — trạng thái sau vòng CTO 2026-09-10

| Bậc | Mã | Trạng thái |
|---|---|---|
| **Ngay** | `OD-BAC-009` | ✅ **CLOSED 2026-09-16** — phương án (a), vendor nội bộ |
| **Ngay** | `OD-BAC-007` | ❌ **CÒN CHỜ NGƯỜI** — xem §4.1 |
| Trước WP-01 | `OD-BAC-001`, `OD-BAC-011`, `OD-BAC-005`, `OD-BAC-010` | ✅ CLOSED 2026-09-10 |
| Trước WP-02 | `OD-BAC-002` | ✅ CLOSED 2026-09-10 |
| Trước WP-04 | `OD-BAC-003` | ✅ CLOSED 2026-09-10 |
| Trước WP-06/08 | `OD-BAC-004`, `OD-BAC-006` | ✅ CLOSED 2026-09-10 |
| Trước phát hành | `OD-BAC-008` | ❌ **CÒN CHỜ NGƯỜI** — xem §4 |

Toàn bộ nhánh tài liệu và nhánh mã (WP-01…WP-08) nay **không còn bị chặn bởi quyết định
kỹ thuật**. Sau 2026-09-16, còn **hai** cam kết tổ chức ở §4: `OD-BAC-007` (chặn DoD) và
`OD-BAC-008` (chặn phát hành).

---

## 4. Việc chỉ người thật làm được — xếp theo lead time, dài nhất trước

Các mục này **không** phải quyết định kỹ thuật. CTO không ký thay được; ghi ở đây để
người có thẩm quyền thấy chính xác cần gì. `OD-BAC-009` đã được ký ngày 2026-09-16 và
giữ lại ở §4.2 làm hồ sơ quyết định, không còn là mục chờ.

### 4.1 `OD-BAC-007` — Cấp tài nguyên HIL · lead time DÀI NHẤT

- **Ai ký:** Product Owner (ngân sách) + Trưởng Lab/QA (chỉ định người chạy T1..T9).
- **Cần gì:** 1 board DDC-24 Rev A còn sống; STM32G0B1 thật trên `/dev/ttyS2` (hiện bo
  chạy `MCU_MODE=FAKE`, MCU thật **chưa từng được nghiệm thu**); 1 BMS hoặc BACnet test
  client; nguồn tín hiệu vật lý cho UI1; thiết bị đo đầu ra AO/BO; LAN dùng chung; tên
  người + cửa sổ thời gian giữ bo.
- **Không có thì sao:** `T-BAC-063`, `T-BAC-064` không khởi động được ⇒ T2/T4/T6 không có
  đường về đích ⇒ Rev A đóng ở mức `TARGET-FAKE` và **phải ghi `NOT READY`**. Không hạ
  tiêu chí để đóng sổ.
- **Khuyến nghị CTO:** cấp ngay và khởi động song song với WP-01. Đợi tới WP-09 mới xin
  thiết bị là tự đẩy lead time dài nhất vào cuối đường găng.
- **Ghi chú 2026-09-16 — tách hai vế để lead time bắt đầu chạy trước ngân sách.** Chủ sở
  hữu xác nhận chưa chốt được vế ngân sách. Quyết định này có **hai** vế và chỉ một vế
  cần tiền: (1) **ngân sách thiết bị** — còn chờ; (2) **tên người vận hành + cửa sổ giữ
  bo** — không tốn tiền và là vế quyết định lead time. Đề nghị chốt vế (2) trước và ghi
  vào [#624](https://github.com/Mekong-HCM/MK-DDC-24/issues/624), vì bo DDC-24 hiện có
  đang chạy `MCU_MODE=FAKE` và phần lớn công việc bring-up là nạp firmware + dựng đường
  IOP, không phải mua sắm. `state:blocked` của #624 **chỉ được gỡ khi đủ cả hai vế** —
  ghi chú này không gỡ chặn, nó chỉ tách để vế không tốn tiền khỏi bị vế tốn tiền giữ lại.

### 4.2 `OD-BAC-009` — Đường lấy bacnet-stack · ✅ ĐÃ KÝ 2026-09-16

- **Quyết định:** **phương án (a)** — vendor `bacnet-stack 1.3.8` vào nguồn nội bộ, bỏ
  `FetchContent` từ `github.com`.
- **Ai ký:** chủ sở hữu (kimlam2010), 2026-09-16. Khuyến nghị CTO ngày 2026-09-10 cũng là (a).
- **Vì sao không chọn (b) hoặc (c):** (b) mở egress `github.com` đổi một rủi ro dựng lấy
  một rủi ro bảo mật, và vẫn để đường dựng phụ thuộc chính sách của bên khác — tức không
  thật sự đóng được vấn đề. (c) gói qua pkg-config **không ghim được đúng 1.3.8**, nên
  bản dựng trên hai máy có thể khác nhau mà không ai biết.
- **Phạm vi thi hành — hai nguồn, không phải một.** Mô tả ban đầu của quyết định chỉ nói
  bacnet-stack; phạm vi thật rộng hơn và đã đo lại **2026-09-16 tại `main@2e63a99`**:

  ```
  grep -n 'github.com' apps/iobus/CMakeLists.txt
  37:      URL https://github.com/bacnet-stack/bacnet-stack/archive/refs/tags/bacnet-stack-1.3.8.tar.gz
  183:      URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip)
  ```

  googletest hiện **chỉ sống nhờ fallback** `find_package(GTest QUIET)` ở dòng 179 khi máy
  có sẵn `libgtest-dev`. Máy sạch thì cả hai đứt, và một bản vá chỉ xử lý bacnet-stack sẽ
  để nguyên nửa còn lại — nên `grep -n "github.com" apps/iobus/CMakeLists.txt` **phải về 0
  dòng** mới coi là thi hành xong.
- **Ràng buộc kèm theo chữ ký:**
  1. Giữ **nguyên từng byte** bản 1.3.8. Cần patch thì tách commit riêng có ghi lý do, để
     lần nâng version sau còn rebase được.
  2. Ghim bằng **commit sha / checksum / tag cố định** — không `latest`, không nhánh — và
     ghi cách kiểm lại tính toàn vẹn.
  3. `BACNET=OFF` **vẫn phải dựng và test được như trước**; không đánh đổi đường build cũ.
  4. Không đổi contract/API/schema, không đổi hành vi runtime — đây là hạ tầng dựng.
- **Số đo nền 2026-09-10 (CTO tự chạy), giữ để đối chiếu:**
  `cmake --fresh -DMKDDC_ENABLE_BACNET=ON` → **exit 1**; `HTTP/1.1 403 Forbidden` cho
  `bacnet-stack-1.3.8.tar.gz`.
- **Thi hành ở:** [#625](https://github.com/Mekong-HCM/MK-DDC-24/issues/625) (`T-BAC-010`).
  Chữ ký này gỡ `state:blocked` cho #625; #626/#627/#628/#635 vẫn chờ #625 `DONE`.

### 4.3 `OD-BAC-008` — `Vendor_Identifier` từ ASHRAE

- **Ai ký:** Product Owner + đại diện pháp nhân công ty (đơn ASHRAE cấp cho pháp nhân).
- **Cần gì:** tên pháp nhân, địa chỉ, đầu mối liên hệ, phí đăng ký, người ký đơn.
- **Không có thì sao:** ra site với `9999` (`apps/iobus/adapters/bacnet/bacnet_server.cpp:98`);
  hai thiết bị khác hãng có thể trùng vendor id trên cùng mạng BMS.
- **Khuyến nghị CTO:** nộp ngay, lead time nhiều tuần. Nếu Rev A phát hành trước khi có
  số thì ghi `9999` là **hạn chế đã biết** trong release record — không giấu, không tự
  chọn một số khác.

---
**Rev** 1.2 | 2026-09-16 — Chủ sở hữu ký `OD-BAC-009` (phương án (a), vendor nội bộ); 9/11 đóng, còn `-007` và `-008` `PENDING-HUMAN`.
**Rev** 1.1 | 2026-09-10 — CTO chốt 8/11; 3 mã `PENDING-HUMAN`.
Ký (kỹ thuật): CTO, 2026-09-10 — xem [Biên bản phê duyệt](../07_records/reviews/BACNET_REV_A_APPROVAL_RECORD_2026-09-10.md).
Ký (nguồn lực `-009`): chủ sở hữu (kimlam2010), 2026-09-16 — phương án (a); phạm vi gồm cả googletest, xem §4.2.
Ký (nguồn lực `-007`/`-008`): ___
