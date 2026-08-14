# Các quyết định mở — ứng dụng AHU hiệu suất cao

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `OD-AHUHP-001` |
| Phiên bản | 0.1 |
| Trạng thái | **M3 — REVIEW READY; 13 OPEN / 0 DECIDED / 0 CLOSED** |
| Ngày | 2026-08-13 |
| Chủ quản | System Architect |
| Người review | CTO, Product Owner, HVAC Lead, Controls/FW/FE/BE/QA Leads |
| Người phê duyệt | Ghi theo từng dòng; authority tổng thể: CTO + Product Owner + System Architect |
| Nguồn | `PROD-AHUHP-001`; bộ thiết kế `DES-INDEX-AHUHP-001` |

## 0. Quy tắc

- `OPEN`: có phương án khuyến nghị nhưng chưa có authority.
- `DECIDED`: có record người có thẩm quyền, ngày, candidate revision/hash và
  hậu quả downstream; chưa đồng nghĩa implementation/test.
- `CLOSED`: mọi tài liệu downstream đã đồng bộ và finding liên quan đã đóng.
- Trao đổi miệng, nội dung plan hoặc tự kiểm không đổi trạng thái.

## 1. Decision register

| ID | Câu hỏi | Các lựa chọn và trade-off | Phương án khuyến nghị | Authority | Gate/deadline | Trạng thái |
|---|---|---|---|---|---|---|
| `OD-AHUHP-001` | Có đưa AHU High Performance thành Product Capability Rev A.x không? | A: Product capability; B: tool nội bộ; C: demo không kiểm soát. A tái sử dụng được nhưng cần V&V/HIL. | A, phát hành theo feature flag và gate riêng | CTO + Product Owner | Trước `PLAN_READY` | OPEN |
| `OD-AHUHP-002` | Hai fan là cặp nào? | A: supply + return; B: supply + exhaust; C: topology cấu hình. | C, candidate mặc định supply + return/exhaust và HVAC Lead chốt profile site | HVAC Lead + Product | Trước freeze topology | OPEN |
| `OD-AHUHP-003` | Tám actuator logical ánh xạ I/O ra sao? | A: mở rộng IOP/MCU lên 8 AO; B: 4 AO local + 4 VAV Modbus; C: toàn bộ Modbus. | B; giữ fan/coil local và VAV trên Modbus EXT | CTO + HW/FW/System | Trước contract P1 | OPEN |
| `OD-AHUHP-004` | Sequence tham chiếu nào? | A: custom; B: ASHRAE Guideline 36-2024 guidance; C: vendor sequence. | B + project-specific constraints; không claim compliance | CTO + HVAC Lead | Trước Control Design M5 | OPEN |
| `OD-AHUHP-005` | Cadence điều khiển? | A: custom C++ 100 ms; B: Programming Rev A một Task 1 s; C: đổi profile. | B; safety nhanh ở MCU/Core, plant step 100 ms, Program Task 1 s | System Architect + Controls Lead | Trước implementation control | OPEN |
| `OD-AHUHP-006` | Độ trung thực plant model? | A: first-order bounded; B: Modelica/FMU; C: CFD. | A cho Rev A; giao diện giữ đường nâng cấp FMU sau | CTO + HVAC/QA | Trước P2 estimate | OPEN |
| `OD-AHUHP-007` | Contract plant coupling? | A: shared memory mới; B: UDS `SOCK_SEQPACKET` JSON v1; C: TCP. | B, local lab, bounded message, peer credential | System Architect + Security | Trước machine-readable contract | OPEN |
| `OD-AHUHP-008` | UI được phơi ở đâu? | A: route runtime + Simulation Lab; B: chỉ CLI; C: gộp vào Programming. | A: `/ahu/:id` viewer/operator và `/eng/simulation/ahu/:id` admin/operator, lab flag | Product + UX + Security | Trước FE implementation | OPEN |
| `OD-AHUHP-009` | Chốt KPI định lượng nào? | A: target trong Product §6; B: HVAC Lead cung cấp profile khác. | Dùng §6 làm default, cho phép profile siết hơn nhưng không nới release limit nếu chưa review | HVAC Lead + QA + Product | Trước VVP M5 | OPEN |
| `OD-AHUHP-010` | Target lab chính? | A: host only; B: Foxlinx + fake MCU; C: MCU thật ngay. | B sau host; C là HIL độc lập | CTO + Platform + QA | Trước P5 | OPEN |
| `OD-AHUHP-011` | HIL exit gồm thiết bị gì? | A: MCU + tải giả; B: thêm hai VFD, hai actuator valve, bốn VAV/actuator; C: site AHU. | B là product HIL; C là validation/site acceptance riêng | QA/HIL + HVAC + Release | Trước `RELEASE_READY` | OPEN |
| `OD-AHUHP-012` | Cách dùng tên/logic Guideline 36? | A: guidance + trace nội bộ; B: claim compliant; C: sao chép nguyên văn. | A; B/C bị cấm nếu chưa license/review độc lập | CTO + Legal/Product | Trước public claim | OPEN |
| `OD-AHUHP-013` | Output giữ bao lâu khi Program/input fault? | A: hold vô hạn; B: local contribution TTL 3 base-step và VAV watchdog <=10 s; C: về safe ngay. | B làm candidate; Safety/HVAC Lead chốt per-output safe action và TTL trước code | Safety + Controls + HVAC | Trước `IMPLEMENT_READY[P3]` | OPEN |

## 2. Hậu quả khi chấp thuận phương án khuyến nghị

1. Thêm `ADR-032` ở trạng thái `Accepted` và ghim revision/hash của 15 hồ sơ
   baseline AHUHP.
2. Mở `PLAN_READY`; chỉ mở `IMPLEMENT_READY[Px]` khi contract machine-readable
   và dependency của đúng pha đã có.
3. Không đổi IOP/SHM/hardware Rev A trong P1–P5.
4. Mọi Test Result bắt đầu `MISSING`; fake MCU/host/target/HIL giữ lane riêng.

## 3. Blocker

| Blocker | Owner | Ảnh hưởng | Gate | Điều kiện mở khóa |
|---|---|---|---|---|
| 13 decision chưa có authority | CTO/Product/System/HVAC/Safety theo bảng | Không được coi candidate là baseline implement | `PLAN_READY` | Authority record có ngày, phạm vi, revision và hash |
| Chưa có consumer review | Leads tiêu thụ contract | Chưa đạt M4 | M4 | Review từng discipline, đóng finding P0/P1 |

## 4. Lịch sử và phê duyệt

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo 12 quyết định cho gói CTO review |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| CTO | Chưa ký | Chọn/điều chỉnh `OD-AHUHP-001..013` |
| Product Owner | Chưa ký | Xác nhận scope, actor, KPI và release intent |
| System Architect | Chưa ký | Xác nhận boundary/contract/deploy |
| HVAC Lead | Chưa ký | Xác nhận topology, sequence, KPI/HIL |
