# Catalog scenario kiểm chứng Programming

| Thuộc tính | Giá trị |
|---|---|
| Tập ID | `VS-PROG-001..030` |
| Phiên bản | 1.0 |
| Trạng thái | `CONTROLLED CATALOG / RESULTS RED` |
| Nguồn | Product v2.2 §29; UX v2.2 §44/46 |
| Quy tắc | Catalog duy nhất; không có E2E list song song |

## Mục lục

1. Quy tắc kết quả
2. Scenario 001..030
3. Board/HIL bắt buộc
4. Coverage
5. Thuật ngữ
6. Lịch sử và phê duyệt

## 1. Quy tắc kết quả

Mọi scenario hiện `NOT RUN / RED`. PASS phải dẫn raw evidence và VR record.
`Board/HIL = BẮT BUỘC` không được thay bằng host/browser-only.

## 2. Scenario 001..030

| ID | PRG/UX/UC được chứng minh | VR | Phương pháp và tiêu chí đạt | Target | Kết quả |
|---|---|---|---|---|---|
| VS-PROG-001 | PRG-BACS-001, PRG-BACS-002; UX-REQ-003; UC-02/15 | VR-PROG-002 | Inspection + Revision round-trip giữ tag/reference, không entity mới; thiếu tag không chặn Rev A/PDF. | Integration | RED |
| VS-PROG-002 | PRG-BACS-003; UX-REQ-001, UX-REQ-002; UC-01/03/08 | VR-PROG-001, VR-PROG-007, VR-PROG-008 | Browser E2E Engineering→Check→Đưa vào vận hành→Run; Draft/Active không nhập nhằng. | Browser+integration | RED |
| VS-PROG-003 | PRG-BACS-004; UX-REQ-023; UC-04/14 | VR-PROG-001, VR-PROG-004, VR-PROG-005, VR-PROG-013 | Contract: Core Library đúng subset/version; BACS Library nâng cao không lộ Rev A. | Integration | RED |
| VS-PROG-004 | PRG-BACS-005; UX-REQ-003; UC-01/08 | VR-PROG-007, VR-PROG-010, VR-PROG-011 | Active record có version/target/mapping/actor/time từ authority. | Integration | RED |
| VS-PROG-005 | PRG-IEC-001; UX-REQ-004, UX-REQ-005; UC-03/04 | VR-PROG-004, VR-PROG-005 | Golden ST và structured FBD tạo cùng typed meaning/output. | Board/HIL | RED |
| VS-PROG-006 | PRG-IEC-004, PRG-IEC-005; UX-REQ-004, UX-REQ-005, UX-REQ-008; UC-03/04/06 | VR-PROG-004, VR-PROG-005 | Syntax/type/wire/unsupported trả diagnostic/source location ổn định, không crash. | Target integration | RED |
| VS-PROG-007 | PRG-IEC-002; UX-REQ-023; UC-04 | VR-PROG-004, VR-PROG-005, VR-PROG-013 | User FB cục bộ có state instance độc lập; global/package/binary import bị từ chối. | Target integration | RED |
| VS-PROG-008 | Limit acceptance proposal | VR-PROG-004, VR-PROG-005, VR-PROG-006, VR-PROG-012 | Boundary + one-over source/FBD/binding/artifact reject bounded, không crash/OOM. | Production target | RED |
| VS-PROG-009 | PRG-IEC-003/RT-001; UX-REQ-007; UC-07 | VR-PROG-006 | Một Task, coherent snapshot, deterministic order; UI không Add Task. | Board/HIL | RED |
| VS-PROG-010 | PRG-RT-002, PRG-RT-007; UX-REQ-011; UC-08/12 | VR-PROG-003, VR-PROG-006, VR-PROG-012 | Mức 5 thắng+saturate back-calc; thua 1–4 freeze, không track actual; đủ bốn field. | Board/HIL BẮT BUỘC | RED |
| VS-PROG-011 | PRG-RT-003, PRG-RT-004, COM-004; UX-REQ-009, UX-REQ-015, UX-REQ-020; UC-09/11 | VR-PROG-007, VR-PROG-008, VR-PROG-011 | Commission/Restore reject giữ LKG; read-back/audit đúng; timeout Unknown→reconcile. | Board/HIL BẮT BUỘC | RED |
| VS-PROG-012 | PRG-RT-005 | VR-PROG-006, VR-PROG-012 | Instrument RT path: không heap/filesystem/DB/HTTP/DNS; 10000 cycle không vi phạm bound. | Board/HIL BẮT BUỘC | RED |
| VS-PROG-013 | PRG-RT-006; UX-REQ-014, UX-REQ-022; UC-12/16 | VR-PROG-006, VR-PROG-012 | Worst-case Check: ba overrun chỉ fault Task, không nuisance plant safe-state; alarm authority không duplicate. | Board/HIL BẮT BUỘC | RED |
| VS-PROG-014 | PRG-RT-008; UX-REQ-011; UC-08/11 | VR-PROG-008, VR-PROG-012 | First program_value bằng mức 5 trước; poll gap `<200 ms`, mục tiêu `<=100 ms`; không MCU safe timeout. | Board/HIL BẮT BUỘC | RED |
| VS-PROG-015 | PRG-RT-009; UX-REQ-009; UC-08/16 | VR-PROG-006, VR-PROG-008, VR-PROG-012, VR-PROG-013 | 1/5/30 s: dual-run reject; step không chờ 30 s; watchdog formula đạt, không restart loop. | Board/HIL BẮT BUỘC | RED |
| VS-PROG-016 | PRG-RT-010; UC-12 | VR-PROG-006, VR-PROG-012 | RTC/NTP/DST jump không làm elapsed timer nhảy; Schedule xử lý wall clock. | Board/HIL BẮT BUỘC | RED |
| VS-PROG-017 | PRG-PT-001, PRG-PT-002, PRG-PT-004; UX-REQ-006; UC-05 | VR-PROG-003, VR-PROG-013 | Toàn ma trận identity/type/direction/allowlist; TCP/BACnet/ID phẳng reject. | Board/HIL BẮT BUỘC | RED |
| VS-PROG-018 | PRG-PT-003; UX-REQ-013, UX-REQ-019; UC-05/10 | VR-PROG-003, VR-PROG-010, VR-PROG-012 | Missing/offline/stale hiện quality + `—`, không valid zero. | Board/HIL+browser | RED |
| VS-PROG-019 | PRG-COM-001, PRG-COM-002, PRG-COM-003; UX-REQ-008, UX-REQ-009; UC-06/08 | VR-PROG-007, VR-PROG-008 | Check đủ layer, p95≤2 s/timeout 5 s proposal; manifest đúng; success sau read-back. | Production target+browser | RED |
| VS-PROG-020 | PRG-COM-005; UX-REQ-010; UC-08 | VR-PROG-003, VR-PROG-010, VR-PROG-011, VR-PROG-012 | Danh sách mọi override active đủ source/actor/value/priority/TTL và link Chạy thử. | Board/HIL+browser BẮT BUỘC | RED |
| VS-PROG-021 | PRG-COM-006; UX-REQ-021; UC-17 | VR-PROG-002, VR-PROG-007, VR-PROG-008, VR-PROG-013 | Source-only import tạo Draft/build target; artifact/IR/native/corrupt/wrong target reject; không auto-active. | Target integration | RED |
| VS-PROG-022 | PRG-SEC-001, PRG-SEC-003, PRG-UX-004; UX-REQ-016; mọi mutation | VR-PROG-011 | Role matrix + audit đủ actor/action/target/revision/time/result/correlation. | Security integration | RED |
| VS-PROG-023 | PRG-SEC-002, PRG-SEC-004; UC-08/17 | VR-PROG-007, VR-PROG-008, VR-PROG-011, VR-PROG-013 | Hash/corrupt/native/external artifact reject + audit; không claim trusted-origin signature. | Target security | RED |
| VS-PROG-024 | PRG-SEC-005; UX-REQ-020; UC-06/08 | VR-PROG-002, VR-PROG-007, VR-PROG-011 | Two-client: base cũ trả conflict trong 1 s proposal, không overwrite/mất Draft. | Integration/browser | RED |
| VS-PROG-025 | PRG-UX-001; UX-REQ-001, UX-REQ-017 | VR-PROG-001, VR-PROG-010 | i18n scan + browser: key VI/EN, Việt mặc định, không Deploy/Compiler primary copy. | Browser | RED |
| VS-PROG-026 | PRG-UX-002, PRG-UX-003, PRG-UX-006; UX-REQ-003, UX-REQ-012, UX-REQ-013, UX-REQ-019; UC-01/09/10 | VR-PROG-010, VR-PROG-012 | Draft/Active đúng; core chỉ RUNNING/DEGRADED/UNREACHABLE; Unknown/Stale không giả Live/0. | Integration/browser | RED |
| VS-PROG-027 | UX-REQ-014; UC-12 | VR-PROG-006, VR-PROG-010, VR-PROG-012 | Monitor 1 Hz/stale 3 kỳ/trace 10000 sample hoặc 10 phút proposal; bounded và có reason. | Board/soak BẮT BUỘC | RED |
| VS-PROG-028 | PRG-UX-005; UX-REQ-005, UX-REQ-018, UX-REQ-024 | VR-PROG-001, VR-PROG-005, VR-PROG-013 | Desktop/mobile keyboard/focus/text+icon; structured FBD không mouse-only; HMI không authoring route. | Browser+HMI inspection | RED |
| VS-PROG-029 | PRG-COM-002, PRG-COM-004; UX-REQ-009; UC-13 | VR-PROG-008, VR-PROG-009 | RETAIN compatible giữ; incompatible hiện impact và chỉ reset sau confirmation/audit. | Board/HIL BẮT BUỘC | RED |
| VS-PROG-030 | UX-REQ-012; UC-09/10 | VR-PROG-010, VR-PROG-012 | FE/BE down không dừng Active; reconnect không replay; browser cache không Draft authority. | Board/HIL BẮT BUỘC | RED |

## 3. Board/HIL bắt buộc

Tối thiểu `VS-PROG-005`, `009..018`, `020`, `027`, `029`, `030` cần target/
board/HIL ở mức ghi trong bảng. Đặc biệt không thay arbitration, bumpless, IOP
poll, watchdog/base step, cutover và concurrent Check bằng host test.

## 4. Coverage

| Đối tượng | Coverage |
|---|---:|
| VS unique | 30/30 |
| Có VR | 30/30 |
| 41 PRG có VS | 41/41 |
| 24 UX-REQ có VS | 24/24 |
| 17 UC có VS | 17/17 |
| VR PASS | 0/13 |

## 5. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 6. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-09 | Hợp nhất Product/UX thành catalog scenario duy nhất và map VR/target. |

Sign-off: Verification Lead `PENDING`; Product `PENDING`; Architecture `PENDING`; Controls/Safety `PENDING`; UX `PENDING`.
