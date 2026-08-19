# ĐẶC TẢ YÊU CẦU UX — MK-DDC-24

**Mã tài liệu:** UX-REQ-MKDDC24-PA3-001
**Sản phẩm:** MK-DDC-24 — BMS Edge Automation Controller
**Phương án được chọn:** PA3 — Adaptive Hybrid Control Workspace
**Trạng thái:** Draft for Review
**Ngày:** 2026-08-08
**Baseline nguồn:** UX-INPUT-001, commit `18bd295`

> Đây là đầu vào yêu cầu PA3 được giữ nguyên nội dung nghiệp vụ để truy xuất.
> Hồ sơ triển khai và bằng chứng hiện hành nằm tại
> `docs/03_implementation/archive/52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md` và
> `docs/07_records/test-evidence/fw-som/2026-08-08-web-pa3-dashboard.md`.

1. Mục tiêu

Thiết kế lại toàn bộ Web HMI của MK-DDC-24 theo mô hình Adaptive Hybrid Control Workspace nhằm đồng thời đáp ứng hai nhóm công việc:

Operation: người vận hành nhận biết tình trạng hệ thống, alarm và bất thường trong 3–5 giây.

Engineering: người cấu hình/commissioning có thể đi sâu từ point → device → bus → configuration/diagnostics mà không biến Dashboard thành màn debug.

Hệ thống phải giữ bản chất programmable generic DDC / BMS Edge Automation Controller, không khóa UX theo AHU, FCU hay một application domain cụ thể.

2. Phạm vi Release 1

2.1 Trong phạm vi

Landing/Dashboard

Monitor / Point Explorer

Point Detail / Context Drawer

Alarm Log / Alarm History / Alarm Detail

Trends

Scheduler operation surface

Commissioning

Inputs / Outputs configuration

Virtual Points

Modbus RTU workspace

Alarm Settings

Controller / Device diagnostics

Network

Time/Date

Device settings

Users / account

Shared navigation, search, filters, status, permissions, confirmation flows

2.2 Ngoài phạm vi Release 1

ST/FBD Programming workspace đang C0 / feature-gated

OTA firmware

Reboot device

Restart service

Log download

BACnet object browser chưa có backend as-built

BACnet MS/TP

RS-485 port thứ 2 trên Rev A

Các alarm type backend đang deferred

Không được thiết kế chức năng production cho endpoint chỉ tồn tại trong OpenAPI nhưng chưa có implementation thực tế.

3. Tiêu chuẩn và nguyên tắc UX

3.1 Chuẩn áp dụng

ISA-101: hierarchy HMI, situational awareness, navigation, abnormal-state emphasis.

ISA-18.2: alarm lifecycle, severity, operator response.

IEC 62443: role-based access, secure configuration changes, auditability, separation giữa observe và mutate.

WCAG 2.2 AA: contrast, keyboard/focus, target size, không dùng màu là dấu hiệu duy nhất.

BACnet semantics: quality/reliability/status được biểu diễn đúng bản chất dữ liệu, không biến UI thành register viewer.

3.2 Luật sản phẩm bắt buộc

Không bịa dữ liệu.

Không hard-code số đo giả.

Thiếu dữ liệu phải hiển thị — hoặc Unknown.

Không suy diễn 0 = OK.

Không suy diễn quality khi producer không trả về.

Frontend không được cấp quyền rộng hơn backend.

Viewer vẫn được quan sát các page cần thiết; mutation control bị disable theo role thay vì ẩn cả page.

Tiếng Việt là locale chính; mọi nhãn qua hệ thống i18n.

4. Baseline hệ thống phải phản ánh đúng

4.1 Role

Chỉ dùng 3 role hiện có:

viewer

operator

admin

Thứ tự quyền: viewer < operator < admin.

4.2 I/O Rev A base SKU

16 × UI

4 × AO

4 × DO

0 × DI công nghiệp riêng trên base SKU

DI chỉ được hiển thị khi capability thực tế của board/SKU báo có.

4.3 Point scale

UI phải scale được ít nhất:

16 physical UI

4 AO

4 DO

464 Virtual Points

256 Modbus RTU Points

Thiết kế không được dựa trên giả định chỉ có vài chục point.

4.4 Protocol Rev A

Ethernet / IPv4: có

Modbus RTU master: có

Modbus TCP client: có

BACnet/IP server: feature-gated OFF mặc định

BACnet MS/TP: không có

RS-485 thứ 2: không có trên Rev A

5. UX Hierarchy

L1 — Overview

Mục tiêu: biết hệ thống có ổn không và có gì cần chú ý.

L2 — Operation

Monitor

Alarms

Trends

Schedule Runtime

L3 — Object Detail

Point

Alarm

Modbus Device

Bus

Schedule

L4 — Engineering

Commissioning

I/O configuration

Virtual Points

Modbus configuration

Alarm Settings

Diagnostics

L5 — System

Network

Device

Time

Users

Không trộn L1 và L4 trên Landing Page.

6. Information Architecture đề xuất

OVERVIEW
├── Dashboard
├── Monitor
├── Alarms
└── Trends

OPERATION
├── Schedules
└── Commissioning

ENGINEERING
├── Points / I/O
├── Virtual Points
├── Modbus RTU
├── Alarm Configuration
└── Diagnostics

SYSTEM
├── Network
├── Device
├── Time
└── Users

Programming được reserve trong architecture nhưng không nằm trong Release 1 production navigation.

7. Use Case Catalog

UC-01 — System Overview

Actor: viewer/operator/adminGoal: trong 3–5 giây xác định controller bình thường hay bất thường.Must show: connectivity, controller runtime state, local I/O health, Modbus health, network health, historian/data state, active alarm summary, last update age.

Acceptance: không cần mở page khác để biết có Critical/High alarm hoặc communication failure.

UC-02 — Monitor Points

Actor: viewer+Goal: tìm, lọc, nhóm và quan sát hàng trăm point realtime.

Required filters: kind, source, quality, forced, fault, online/offline, log state, user group/tag.

UC-03 — Point Detail

Actor: viewer+Goal: hiểu trạng thái point trước khi thao tác.

Must show khi có dữ liệu: value, unit, raw/rawUnit, quality, reliability, source, updatedAt, forced, writable, priority owner, logging, fault, Modbus diagnostic metadata.

UC-04 — Manual Override / Release

Actor: operator+Goal: thực hiện Local Manual override an toàn.

Rules:

Không có BACnet priority selector.

Mọi web command ghi Local Manual level 2.

Phải hiển thị current owner / priority source.

Phải có confirmation.

Release phải là action riêng rõ ràng.

Hiển thị thời gian override còn lại nếu backend có.

UC-05 — Alarm Response

Actor: viewer quan sát; operator+ hành động.Goal: hiểu alarm và xử lý Ack/Suppress/Return.

Severity bắt buộc:

critical

high

medium

low

info

State/lifecycle phải phản ánh:

active

unack

acked

shelved

UC-06 — Trend Analysis

Actor: viewer+Goal: so sánh 1–8 point theo thời gian.

Rules:

Không nối đường xuyên data gap.

Tôn trọng complete=false và gaps.

Hỗ trợ min/max band khi dữ liệu aggregate có min/max.

Custom range dùng backend semantics hiện có.

UC-07 — Schedule Operation

Actor: viewer xem/simulate; operator enable/disable; admin CRUD/publish/rollback.

UI phải phân biệt rõ:

Draft/configuration

Runtime state

Simulation

Published revision

Audit/history

UC-08 — Commissioning

Actor: operator+Goal: test một point an toàn và nhìn đồng thời engineering value + raw value + quality.

UC-09 — Modbus Diagnostics

Actor: viewer quan sát; operator test; admin cấu hình.

Hierarchy bắt buộc:

Bus → Device → Point

Baud/parity/stop bits thuộc Bus, không thuộc Device.

UC-10 — Configuration

Actor: adminGoal: cấu hình I/O, Virtual Points, alarms, historian, fieldbus với validation và diff khi có.

UC-11 — Network Change

Actor: adminFlow bắt buộc:

validate → stage → apply → confirm → rollback

UI phải đọc authoritative response body, không chỉ HTTP status.

UC-12 — User/System Administration

Actor: admin; self password cho viewer+.Goal: quản lý user/device/time an toàn, rõ audit impact.

8. Landing Page Requirements — PA3

Landing Page là màn đầu tiên sau login.

8.1 Header

Phải có:

Device name

Overall state

Online/offline

Last update age

Active alarm count theo severity quan trọng

Current user/role

Time

8.2 Health Strip

Tối đa 5–6 health domain:

Controller

Local I/O

Modbus

Network

Historian/Data

Runtime nếu có nguồn dữ liệu thật

Không đưa CPU/RAM/process cards vào khu vực này nếu không liên quan trực tiếp abnormal awareness.

8.3 Attention Panel

Ưu tiên hiển thị:

Critical

High

Medium

Communication/device failures

Uncertain/stale/offline point đáng chú ý

Mỗi item phải drill-down tới object gây lỗi.

8.4 Operating Summary

Tổng hợp point theo:

total

good

uncertain

bad

stale

offline

Không được đếm DI giả trên base SKU.

8.5 My Workspace

Cho phép pin:

Point

User-defined group

Trend

Alarm source

Modbus device

Không hard-code AHU/FCU/chiller templates.

8.6 Trend Preview

Chỉ hiển thị pinned/key points.

Không quá 4 series mặc định trên Landing.

Có link mở full Trends.

Phải thể hiện gap đúng.

8.7 Activity

Tách:

Alarm activity

Operator/configuration activity

Không trộn debug log thô vào Landing.

9. Visual & Interaction Requirements

9.1 Màu

Neutral cho normal state.

Red cho Critical/High abnormal action-required.

Amber cho degraded/warning.

Blue/Cyan cho selection, navigation, action state.

Green dùng hạn chế cho confirmed/healthy state.

Không dùng màu là dấu hiệu duy nhất; luôn có text/icon/state label.

9.2 Density

Desktop-first industrial UI.

Card chỉ dùng để nhóm semantic.

Tránh card-in-card lồng quá mức.

Table dùng cho dữ liệu nhiều hàng.

Drawer dùng cho quick inspection.

Full page dùng cho investigation/configuration sâu.

9.3 Typography

Base 13–14 px desktop.

Primary operating value 24–32 px.

Không dùng text quá nhỏ cho status quan trọng.

9.4 Interaction target

Action target tối thiểu khoảng 40–44 px.

Keyboard focus rõ.

Tab order hợp lý.

10. Permission UX

Viewer

Xem dữ liệu.

Mutation control disable + giải thích quyền cần thiết.

Operator

Override/release point.

Ack/suppress/return alarm.

Commissioning test.

Schedule enable/disable.

Modbus connection/read test.

Admin

Toàn bộ operator quyền.

Cấu hình I/O/VP/alarm/schedule/network/device/users/historian/Modbus.

UI không được giả lập role Engineer/Technician riêng trong Release 1.

11. Data State Requirements

Mỗi component đọc realtime phải có ít nhất các state:

loading

live/good

uncertain

bad

stale

offline

unknown/missing

error fetching

permission denied

Không dùng skeleton/loading để che stale/offline state sau khi dữ liệu đã load.

12. Confirmation & Safety Patterns

Mutation có khả năng ảnh hưởng vận hành phải dùng confirmation phù hợp:

Manual Override

Release Override nếu có side effect quan trọng

Suppress alarm

Commissioning test

Schedule enable/disable

Apply Modbus config

Network apply/confirm/rollback

Destructive config delete

Confirmation phải nói rõ:

Object

Current value/state

New value/state

Scope

Role/action owner

13. Non-functional UX Requirements

Realtime view không animate/re-render vô ích khi fingerprint không đổi.

Hỗ trợ tối thiểu desktop 1280 px; baseline 1440×900.

Responsive tablet/mobile ưu tiên monitoring; cấu hình phức tạp có thể giới hạn desktop nếu cần.

i18n bắt buộc.

Không cache index.html; hashed assets cache immutable theo policy dự án.

Không có widget nào không truy được về field/backend source thực tế.

14. Acceptance Criteria tổng

Thiết kế được xem là đạt khi:

User mở Landing và trong ≤5 giây xác định được Normal/Abnormal.

Critical/High alarm luôn nằm trong vùng nhìn đầu tiên trên desktop.

Viewer có thể monitor đầy đủ nhưng không mutation được.

Operator có thể đi từ abnormal → object detail → action trong tối đa 3 interaction chính.

Unknown, stale, offline, bad phân biệt rõ.

Không có DI giả, RS485-2 giả, OTA/reboot/service restart giả.

Monitor scale được hàng trăm point bằng search/filter/group.

Modbus phản ánh Bus → Device → Point.

Manual Override không có priority selector sai contract.

Trend không nối gap dữ liệu.

Các mutation nguy hiểm có confirmation và feedback rõ.

Dashboard không còn là trang debug CPU/RAM/service/process.

15. Traceability nguồn

Các baseline kỹ thuật và permission của tài liệu này lấy từ UX-INPUT-001 tại commit 18bd295. Khi source thay đổi phải re-check ít nhất:

contracts/shm/mkddc_shm.h

apps/web-api/internal/app/http.go

apps/web-ui/src/app/App.tsx

auth role mapping

PointDTO

Modbus contracts

Alarm contracts
