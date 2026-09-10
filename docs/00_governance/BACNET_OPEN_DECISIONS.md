# BACnet Rev A — Open Decisions

**ID:** OD-BAC-SET-001
**Trạng thái:** Active (danh mục vấn đề mở, không phải Design)
**Ngày:** 2026-09-10
**Chủ quản:** Project Engineering
**Đọc cùng:** [As-Built Review](../05_verification/BACNET_REV_A_ASBUILT_REVIEW.md) ·
[Implementation Plan](../03_implementation/BACNET_REV_A_IMPLEMENTATION_PLAN.md)

> Tài liệu này liệt kê **quyết định còn thiếu authority**. Nó không tự quyết định thay
> Product/CTO. Không được coi khuyến nghị ở đây là quyết định đã duyệt.
>
> **Ràng buộc thi hành:** WP-BAC-01 không khởi động trước khi `OD-BAC-001` được ký.
> Các WP còn lại phụ thuộc từng quyết định như ghi ở cột "Chặn WP".

---

## 1. Bảng quyết định

| ID | Vấn đề | Ảnh hưởng nếu chưa quyết | Owner cần ký | Khuyến nghị kỹ thuật | Chặn WP | Trạng thái |
|---|---|---|---|---|---|---|
| **OD-BAC-001** | **Chấp nhận sửa PICS xuống đúng thực trạng?** 9/14 BIBB đang khai ✅ nhưng chưa implement hoặc chỉ là placeholder. | Nếu giữ nguyên: hồ sơ tích hợp nói dối BMS engineer, và bài test BTL sẽ phơi ra sai lệch PICS — lỗi nặng hơn khai thiếu. Nếu sửa: phải thông báo cho bên đã nhận PICS bản cũ. | Product + CTO | **Sửa PICS.** Chính PICS §4 đã tự viết nguyên tắc này ngày 2026-08-07: *"với hồ sơ chứng nhận thì khai sai nguy hiểm hơn khai thiếu"*. Áp nguyên tắc đó cho 9 dòng còn lại. | 01 (chặn toàn bộ) | **OPEN — P0** |
| **OD-BAC-002** | **Đổi object set có được chấp nhận là breaking change không?** Bỏ 8 BI ở base SKU (WP-02) và cấp lại `objectInstance` từ `pointStableId` sẽ làm hỏng cấu hình BMS đã tích hợp. | Chưa quyết ⇒ hoặc giữ object giả mãi mãi, hoặc đổi âm thầm và làm hỏng site đang chạy. | Product + Field Service | Chấp nhận breaking **một lần** ở Rev A, kèm ghi chú release rõ ràng và công cụ xuất bảng object mới. Rev A chưa GA nên chi phí thấp nhất là bây giờ. | 02 | **OPEN — P0** |
| **OD-BAC-003** | **AV/BV/MSV có được ghi qua BACnet không?** Hiện WriteProperty được nhận, readback trả đúng, nhưng **không tới core** — tức là báo thành công sai. | Chưa quyết ⇒ lỗi im lặng tiếp diễn. Đây là lỗi báo-thành-công-sai, nguy hiểm hơn từ chối thẳng. | Product + Controls | **Nối vào core** với `PRIO_BACNET=3`, đi qua arbitration như AO/BO. Nếu Product không muốn cho BMS ghi biến PLC thì phải trả `WRITE_ACCESS_DENIED` — tuyệt đối không nhận rồi bỏ. | 04 | **OPEN — P0** |
| **OD-BAC-004** | **Định nghĩa `bmsLink = online` là gì?** Hiện `bip_init()` thành công ⇒ `online`, kể cả khi không có BMS nào trên mạng. | Vận hành tin vào đèn xanh sai. Không phát hiện được BMS rớt. | Product + UX + Ops | `online` khi có `lastRx` từ một BACnet peer trong cửa sổ **N giây**; `unknown` khi thiếu số đo. Đề xuất N = 90 s (3× chu kỳ poll BMS điển hình 30 s) — **phải đo lại** trên site thật trước khi chốt. | 06 | **OPEN — P1** |
| **OD-BAC-005** | **TimeSync: bỏ hay nối?** PICS khai `DM-TS-B` (nhận time sync), nhưng mã hiện có là `Send_TimeSync_Device()` = vai trò **master/TS-A**, và hàm đó **không có caller nào**. | PICS sai theo hai chiều cùng lúc: khai sai vai trò, và khai tính năng chưa chạy. | Product + Controls | **Bỏ khỏi Rev A** (khai ❌). DDC làm time master trên mạng BMS thường là điều BMS **không** mong muốn. Nếu cần đồng bộ giờ thì dùng NTP. | 01 | **OPEN — P1** |
| **OD-BAC-006** | **`/bacnet/objects` (object catalog) mở lại ở Rev A hay giữ Rev B?** Endpoint này đã bị **gỡ khỏi contract Rev A** theo quyết định 2026-08-20 (xem `contract_routes_test.go:48`). Nhưng yêu cầu WP-BAC-08 của Owner lại đòi "FE object catalog". | Hai nguồn authority mâu thuẫn. Chưa quyết ⇒ WP-BAC-08 không biết làm theo cái nào. | Product | **Mở lại ở Rev A, chỉ đọc.** Sau WP-BAC-02, registry đã có sẵn đủ 8 trường; phơi ra một endpoint đọc là chi phí thấp và là công cụ chẩn đoán tích hợp có giá trị cao. Không mở đường ghi. | 08 | **OPEN — P1** |
| **OD-BAC-007** | **Cấp tài nguyên HIL.** Cần: board DDC-24 thật, BMS hoặc BACnet test client, nguồn tín hiệu vật lý cho UI1, thiết bị đo đầu ra AO/BO, LAN. | **Không có thì Rev A không thể đánh DONE** — theo định nghĩa của chính Owner, simulator/mock không được tính là bằng chứng. | Product + Lab/QA | Cấp thiết bị và chỉ định owner chạy T1..T9. Đây là hạng mục có lead time dài nhất trong kế hoạch — nên khởi động **song song** với WP-01, không đợi đến WP-09. | 09 (chặn DoD) | **OPEN — P0** |
| **OD-BAC-008** | **`Vendor_Identifier = 9999` đi tiếp tới đâu?** Là placeholder chờ ASHRAE cấp số. | Ra site với `9999` thì hai thiết bị khác hãng có thể trùng vendor id. | Product + CTO | Nộp đơn ASHRAE **ngay** (lead time nhiều tuần). Nếu Rev A phát hành trước khi có số, ghi rõ trong release record là hạn chế đã biết. | 10 | **OPEN — P1** |
| **OD-BAC-009** | **Đường lấy bacnet-stack 1.3.8 cho build và CI.** Build `BACNET=ON` hiện **hỏng** trong môi trường agent: FetchContent tải tarball từ `github.com` bị egress policy chặn (HTTP 403). | Không dựng được bản có BACnet ⇒ không test được, không phát hành được. Đồng thời điều này đang che giấu vấn đề: bộ test host vẫn PASS 1440/1440 với `BACNET=OFF`. | Platform + Security | Vendor bacnet-stack 1.3.8 vào artifact nội bộ hoặc mirror, và **thêm một gate CI dựng `BACNET=ON`**. Không được để cấu hình `OFF` là đường build mặc định duy nhất được kiểm. | 09, 10 | **OPEN — P0** |
| **OD-BAC-010** | **Bộ test host có được tính là bằng chứng BACnet không?** 67 test tên BACnet đang PASS với `MKDDC_ENABLE_BACNET=OFF` — không test nào gửi/nhận một gói UDP. | Chưa quyết ⇒ tiếp tục dùng "1440/1440 PASS" như thể nó chứng minh BACnet chạy. | QA + CTO | **Không.** Đặt quy tắc: capability BACnet chỉ được đánh VERIFIED khi có bằng chứng **target**. Bổ sung một tầng test tích hợp loopback UDP (chạy được trên CI) làm bước trung gian, nhưng nó vẫn không thay thế HIL. | 09, 10 | **OPEN — P0** |
| **OD-BAC-011** | **Alarm/Event, Schedule, Calendar, Trend Log chuyển V1.1 — xác nhận?** Cả bốn đều thiếu ít nhất một trong: source / runtime wiring / network / target test. | Nếu giữ trong Rev A thì scope phình ~3× và ngày phát hành trượt. | Product | **Chuyển V1.1** và sửa PICS thành ❌. Trend Log thậm chí không có dòng mã nào trong repo — giữ nó trong Rev A là không thực tế. | 01 | **OPEN — P1** |

---

## 2. Ghi chú về hai quyết định đã có, không mở lại

| ID | Quyết định | Nguồn | Trạng thái |
|---|---|---|---|
| ARCH-R010 | BACnet MS/TP bị bỏ; RS-485 dành cho Modbus RTU master | PICS §5, 2026-05-30 | **CLOSED** — không mở lại |
| OD-MBRTU-014 | Modbus RTU Point **không** expose qua BACnet ở Rev A | `MODBUS_RTU_OPEN_DECISIONS.md`, 2026-08-20 | **CLOSED** — khớp với OUT OF SCOPE của Rev A |

---

## 3. Thứ tự xin chữ ký đề xuất

1. **Ngay:** `OD-BAC-007` (lead time thiết bị dài nhất) và `OD-BAC-009` (chặn mọi verify).
2. **Trước WP-01:** `OD-BAC-001`, `OD-BAC-011`, `OD-BAC-005`, `OD-BAC-010`.
3. **Trước WP-02:** `OD-BAC-002`.
4. **Trước WP-04:** `OD-BAC-003`.
5. **Trước WP-06/08:** `OD-BAC-004`, `OD-BAC-006`.
6. **Trước phát hành:** `OD-BAC-008`.

---
**Rev** 1.0 | 2026-09-10 — Danh mục đầu tiên. Ký: ___
