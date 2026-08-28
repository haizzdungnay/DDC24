> [!NOTE]
> **HỒ SƠ LỊCH SỬ — giữ nguyên văn, đọc theo đúng ngày 2026-06-30.**
>
> Đưa vào `main` ngày 2026-08-28 từ nhánh `docs/update-2026-06-30` (nhánh đó còn
> 52 file `services/hmi/` thuộc cây thư mục đã bị `PLAN-ARCH-RESTRUCT-002` xoá,
> nên KHÔNG merge cả nhánh — chỉ lấy đúng tài liệu này).
>
> Vì vậy mọi đường dẫn trong bài (`services/iobus`, `services/core`,
> `services/hmi`, `web/backend`) là layout **thời điểm đó**; nay chúng nằm ở
> `apps/iobus`, `apps/core`, `apps/hmi`, `apps/web-api`, `apps/web-ui`. Mọi con
> số tiến độ, gap và khuyến nghị cũng là ảnh chụp của ngày đó — đừng đọc như
> hiện trạng.

# CEO Strategic Review — MK-DDC-24
## Toàn bộ thiết kế dự án & 3 Option thay đổi Goal

> **Document ID:** RPT-CEO-STRATEGIC-2026-06-30
> **Ngày:** 2026-06-30
> **Author:** CEO (Agent 7f5d1e06)
> **Request:** IOT-8362 — "review toàn bộ thiết kế dự án và đề xuất lại goal với 3 option"
> **Status:** Final — Trình Owner duyệt

---

## Executive Summary (Tiếng Việt)

MK-DDC-24 đã đạt **~85% completion của Rev A.0 source code** (services/iobus + services/core + services/hmi source done, web frontend ISA-101 done, web backend ~60%). Test coverage tốt (122/122 core, 140/140 iobus, 38+ HMI unit test pass). Tuy nhiên dự án đang đối mặt với **3 vấn đề chiến lược nghiêm trọng**:

1. **Goal mâu thuẫn**: Rev A.0 scope là "demo-grade" nhưng đang bị scope-creep thành production-grade (HMI kéo vào, BACnet/Modbus implement đầy đủ, validator 6 check). Không rõ đây là lab demo hay sản phẩm thương mại.
2. **BTL certification path bế tắc**: 20 gaps (2 Critical) chưa resolved. ASHRAE Vendor ID chưa đăng ký. BACnet International membership chưa có. Không có timeline BTL pass rõ ràng.
3. **No-board gap nghiêm trọng**: Toàn bộ test chạy trên fake MCU + simulator. Chưa có cross-test trên board thật Orange Pi 5B với MCU STM32. HW bring-up chưa verified. Phase 1-2 (MCU bring-up + IOP UART) chỉ mới test trên fake_mcu — chưa có bằng chứng board thật.

**Khuyến nghị CEO:** Chọn Option B — "Platform-First Pivot" (tập trung hoàn thiện board bring-up + demo 3-domain trước, lùi BTL certification sang Rev A.1).

---

## Phần 1: Hiện trạng dự án (Factual Assessment)

### 1.1 Code completion

| Module | Status | Test | Ghi chú |
|--------|--------|------|---------|
| `mkddc-core` | ✅ DONE | 122/122 pass | Graph engine, priority, safe-state, COR-011 Protocol nodes, web_ipc, SIGHUP, state_snapshot |
| `mkddc-iobus` | ✅ DONE | 140/140 pass (2 skip SHM cleanup) | IOP v2, io_cache, BACnet/IP server, Modbus RTU/TCP master, BAC-001..011, MOD-001..013 |
| `mkddc-hmi` | ✅ Source DONE | 8/8 unit test pass | 6 screens LVGL DRM/KMS, touch, GPIO button. Chưa verify trên TFT thật |
| `mkddc-web` BE | 🟡 ~60% | Go test pass | REST API, JWT, core IPC, point list, alarm API. Trends/Scheduler/Network/Validator chưa connected |
| `mkddc-web` FE | 🟡 ISA-101 DONE | typecheck pass | 3-group nav (Overview/Settings/Engineering). 4 pages demo-only UI shell |
| `fw/` MCU | 🟡 Source DONE | Chưa cross-test | STM32G0B1 firmware IOP slave. Chỉ test logic, chưa verify trên board thật |
| `tools/` | ✅ DONE | — | fake_mcu (v2 frames), shm_dump_io, E2E scripts, soak test |

### 1.2 Build & CI

- ✅ CI build-and-test.yml: 4 matrix variants (baseline/modbus/bacnet/modbus+bacnet) all green
- ✅ security.yml: trivy/grype/gitleaks/codeql all green
- ✅ packaging/systemd: mkddc-core.service, mkddc-iobus.service, mkddc-hmi.service, install.sh

### 1.3 Documentation status

| Doc | Rev | Status | Issues |
|-----|-----|--------|--------|
| PRODUCT_DEFINITION | 2.0 | Accepted | Clean |
| REVA_SCOPE_ROADMAP | 1.3 | Accepted | 90-day timeline ambiguous |
| CANONICAL_DECISIONS | — | Canonical | Clean |
| PHASE_PLAN | 1.8 | Active | Phase 5.5 added, Phase 6 chưa bắt đầu |
| TASK_CHECKLIST | 1.21 | Active | ~85% tasks DONE |
| SW_COMPONENT_LIBRARY | 1.2 | Draft amendment | Protocol node chapter pending approval |
| GRAPH_SCHEMA | 1.1 | Draft amendment | Protocol node chapter pending approval |
| SW_RUNTIME_EXECUTION_MODEL | 1.1 | Approved | Clean |
| CONFIG_SCHEMA | 1.3 | Active | Clean |
| REST_API_OPENAPI | 1.0/1.1 | Active | Header/footer version mismatch |
| BACNET_PICS_EPICS | 1.0/1.1 | Implied Approved | Vendor_Identifier=9999 placeholder |
| 06_IOBUS_GUIDE | 1.4/1.5 | Active | Header/footer mismatch |
| 07_CORE_GUIDE | 1.5/1.9 | Active | Header/footer mismatch significant |
| 09_WEB_GUIDE | 1.10/1.11 | Active | Frontend demo status unclear |
| BTL GAP ANALYSIS | 1.0 | Active | 20 gaps (2 Critical) unresolved |

### 1.4 BTL Certification Readiness

- **20 gaps total**: 2 Critical, 9 High, 7 Medium, 2 Low
- **Critical blockers:**
  - GAP-BIBB-08: ASHRAE Vendor ID = 9999 (chưa đăng ký). Cần CEO ký thư xin ID.
  - GAP-PRE-01: BOTS tool chưa mua ($2K/yr). Cần Windows VM chạy BTL Test Package.
- **9 High gaps:** AE-ACK-B handler, Schedule engine, Trend Log buffer, Event Enrollment params, BTL Functionality Checklist, IUT Special Test Instructions, RBTO not selected, BACnet Intl membership
- **Budget ước tính:** $10K-$20K cho lab + $2K-$3K/yr BACnet Intl Silver + $2K/yr BOTS
- **Timeline:** Lab lead time 4-6 tuần sau khi chốt. BTL test 2-3 ngày tại lab.

### 1.5 Phase Gate Status

| Gate | Status | Blocker |
|------|--------|---------|
| P0→P1 | ✅ Pass | |
| P1→P2 | 🟡 Pending | Chưa cross-test IOP trên board thật |
| P2→P3 | 🟡 Pending | IOP cross-test chưa verified |
| P3→P4 | 🟡 Pending | iobus service chưa chạy 1h trên board |
| P4→P5 | 🟡 Pending | BACnet/Modbus chưa verify trên board |
| P5→P5.5 | 🟡 Pending | HMI source done nhưng chưa render trên TFT thật |
| P5.5→P6 | ❌ Not started | |
| P6→Release | ❌ Not started | |

**Tất cả gate từ P1→P2 trở đi đều blocked vì chưa có board bring-up thật.**

---

## Phần 2: Critical Findings

### CF-01: Goal Mâu Thuẫn — Demo-grade vs Production-grade (P0)

**Hiện tượng:** CANONICAL_DECISIONS + REVA_SCOPE nói Rev A.0 = "demo-grade / lab-grade". Nhưng thực tế code đang implement như production-grade:
- 28 component types đầy đủ (gồm Protocol nodes COR-011)
- BACnet/IP server đầy đủ với COV, alarm, priority array
- Modbus RTU x2 + TCP client đầy đủ
- Validator 6 checks (không chỉ 4 như scope)
- HMI kéo vào Rev A (amendment 2026-06-27)
- State snapshot, SIGHUP reload, audit log

**Root cause:** Không có ai enforce scope boundary. Mỗi lần một tính năng "gần xong" là kéo vào Rev A.

**Impact:** Không biết khi nào "done". Demo-grade có thể ship trong 2 tuần. Production-grade còn 3-6 tháng.

### CF-02: No-Board Gap — Toàn bộ test trên simulator (P0)

**Hiện tượng:** 262+ unit test pass nhưng tất cả chạy trên fake_mcu/simulator. Chưa có:
- Cross-test IOP UART trên board Orange Pi 5B ↔ MCU STM32G0B1 thật
- Verify ADC giá trị thật từ ADS131M08
- Verify DO relay đóng/mở thật
- Verify AO DAC8554 ra voltage thật
- Verify TFT display render thật với DRM/KMS

**Root cause:** Phase 1-2 chỉ làm logic. HW bring-up chưa thực hiện.

**Impact:** Không thể claim "done" bất kỳ phase nào. P0 risk rằng IOP protocol không chạy trên UART thật (timing, jitter, ADUM1201 isolation).

### CF-03: Design Doc Approval Gap (P1)

**Hiện tượng:** SW_COMPONENT_LIBRARY và GRAPH_SCHEMA đều có Chapter 8/10 (Protocol nodes) ở trạng thái "Draft amendment — pending owner approval". Nhưng COR-011 (Protocol graph nodes) đã được implement và claim DONE trong 07_CORE.

**Vi phạm:** CLAUDE.md Luật Số 1 — "KHÔNG ĐƯỢC implement khi chưa có plan được duyệt".

**Impact:** Audit trail yếu cho BTL certification. Không có doc approved làm bằng chứng design review.

### CF-04: BTL Certification Path Không Rõ Ràng (P1)

**Hiện tượng:** PICS nói B-ASC profile với 13 object types. Nhưng:
- REVA_SCOPE nói "KHÔNG đặt mục tiêu BTL pass trong 90 ngày"
- CANONICAL_DECISIONS nói "No BTL certification target in Rev A.0"
- Nhưng code đã implement gần đầy đủ BACnet stack
- Chưa có timeline BTL pass

**Impact:** Team implement BACnet đầy đủ nhưng không biết khi nào cần BTL certified. Lãng phí effort nếu BTL không phải ưu tiên. Ngược lại, nếu BTL là ưu tiên thì còn nhiều gap cần fill.

### CF-05: Web Backend Chưa Connected (P2)

**Hiện tượng:** 4 pages quan trọng (Trends, Scheduler, Network, Validator) vẫn là "demo UI client-side with simulator, NOT yet connected to backend" (tính đến 2026-06-16).

**Impact:** Web UI đẹp nhưng chưa functional end-to-end. Demo 3-domain sẽ không có UI thật để cấu hình.

### CF-06: HW Risk — SOM Sourcing & Thermal (P2)

**Hiện tượng:** OPEN_ISSUES ghi nhận:
- HW-Q-002 (P0): Radxa CM3 extended temp variant (-20~+80°C) chưa confirm availability. Consumer grade chỉ 0~50°C.
- HW-Q-001 (P1): Thermal derating report chưa hoàn thành. Validated range 0~55°C, target -20~+65°C.

**Impact:** Nếu CM3 extended temp không có sẵn → cần đổi SOM → redesign major.

---

## Phần 3: 3 Option Thay Đổi Goal

### Option A — "BTL-First: Chứng nhận BACnet trước, bán gateway trước"

**Goal mới:** MK-DDC-24 launch như **BACnet B-ASC Certified Gateway** (Modbus↔BACnet). DDC controller là value-add secondary.

**Thay đổi so với hiện tại:**
- Cắt DDC runtime khỏi Rev A launch scope. `mkddc-core` graph engine giữ lại làm internal engine, không expose ra ngoài launch.
- Launch feature chính: BACnet/IP B-ASC certified gateway với Modbus RTU/TCP southbound.
- PRD viết lại: "MK-DDC-24 là BACnet B-ASC Certified Protocol Gateway + Edge IO".
- BTL certification là #1 priority (P0). Dành toàn bộ resource cho BTL pass.

**Lợi ích:**
- BACnet certification là moat cạnh tranh (ít thiết bị VN có BTL)
- Gateway dễ bán hơn DDC (thị trường rộng hơn, ít cần domain knowledge)
- Revenue sớm hơn (6-9 tháng vs 12-18 tháng cho DDC đầy đủ)
- Tận dụng được code BACnet/Modbus đã implement

**Rủi ro:**
- BTL certification timeline không chắc chắn (còn 20 gaps)
- Cần đầu tư $15K-$25K cho certification (lab + membership + tool)
- Gateway market cạnh tranh giá (HMS, Moxa, Advantech)
- Cắt DDC làm giảm differentiation dài hạn

**Timeline ước tính:** 4-6 tháng tới BTL pass (nếu bắt đầu vendor ID ngay).

---

### Option B — "Platform-First: Board bring-up → Demo 3-domain → Gọi vốn/đối tác"

**Goal mới:** MK-DDC-24 tập trung hoàn thiện **platform kỹ thuật** (board bring-up, 3-domain demo end-to-end) để gọi vốn hoặc tìm đối tác phân phối. BTL certification lùi sang giai đoạn sau khi có vốn.

**Thay đổi so với hiện tại:**
- Dừng implement feature mới. Tập trung 100% vào board bring-up + integration.
- Hoàn thiện 3-domain demo (HVAC mini, Pump/Water, Energy/Gateway) chạy ổn định 24h trên board thật.
- Đóng băng scope Rev A.0 ở hiện tại (28 component types, BACnet interop demo, HMI 6 screens).
- Goal kinh doanh: có demo để show investor/partner → gọi vốn Seed/Series A.

**Lợi ích:**
- Tận dụng được toàn bộ code đã viết (85% done)
- Giảm rủi ro kỹ thuật (board bring-up là unknown lớn nhất)
- Demo thuyết phục hơn slide deck khi gọi vốn
- Không cần chi $15K-$25K ngay cho BTL certification
- Cho phép pivot sau khi có feedback từ investor/partner

**Rủi ro:**
- Chưa có revenue ngắn hạn
- Board bring-up có thể gặp vấn đề HW (layout, component sourcing)
- Investor có thể không hiểu BMS/DDC market
- Cần timeline rõ ràng để không bị "demo vĩnh viễn"

**Timeline ước tính:** 6-8 tuần cho board bring-up + 3-domain demo ổn định.

---

### Option C — "DDC-First: Cắt gateway, tập trung DDC controller thuần"

**Goal mới:** MK-DDC-24 launch như **Standalone DDC Controller** cho HVAC/pump/lighting. Bỏ BACnet gateway, bỏ BTL certification. BACnet/IP chỉ là optional add-on sau này.

**Thay đổi so với hiện tại:**
- Cắt toàn bộ BACnet/IP server khỏi Rev A scope. Giữ BACnet skeleton trong code nhưng không build.
- Cắt Modbus RTU master (không cần expansion/gateway).
- Tập trung vào: IO + graph runtime + HMI local + Web config basic.
- Launch với web config đơn giản (form, không cần validator phức tạp).
- Giá target: $350-$450 USD (cạnh tranh với DDC Trung Quốc).

**Lợi ích:**
- Scope nhỏ nhất → time-to-market ngắn nhất
- Chi phí development thấp nhất
- Thị trường DDC Việt Nam đang thiếu sản phẩm local
- Dễ test, ít dependency (không cần BACnet lab, không cần Modbus slaves)
- Có thể bán cho thầu HVAC ngay

**Rủi ro:**
- Mất differentiation "BACnet certified" — cạnh tranh thuần về giá
- Ít barrier to entry cho đối thủ
- Revenue per unit thấp
- Khó mở rộng ra regional market (cần BACnet cho BMS quốc tế)
- Bỏ phí effort BACnet/Modbus đã implement (rất nhiều code)

**Timeline ước tính:** 4-8 tuần cho launch sản phẩm tối thiểu (sau board bring-up).

---

## Phần 4: So sánh 3 Option

| Tiêu chí | Option A (BTL-First) | Option B (Platform-First) | Option C (DDC-First) |
|----------|---------------------|--------------------------|---------------------|
| **Time-to-market** | 4-6 tháng | 2-3 tháng (demo) | 1-2 tháng |
| **Revenue ngắn hạn** | Thấp (cert chưa xong thì chưa bán được) | 0 (chưa bán) | Có thể (bán DDC basic) |
| **Chi phí tiếp theo** | $15K-$25K | $0-$5K | $0-$2K |
| **Differentiation** | Cao (BTL certified) | Trung bình | Thấp |
| **Rủi ro kỹ thuật** | Trung bình (BTL pass chưa chắc) | Thấp (board bring-up) | Thấp |
| **Rủi ro thị trường** | Trung bình (gateway đông) | Thấp (chưa ra thị trường) | Cao (cạnh tranh giá) |
| **Tận dụng code đã viết** | 90% | 100% | 50% |
| **Scalability dài hạn** | Tốt (có cert → regional) | Tốt (có vốn → làm gì cũng được) | Thấp (local only) |
| **Phù hợp nếu team < 3 dev** | ❌ (cần thêm resource cert) | ✅ | ✅ |

---

## Phần 5: CEO Recommendation

### Chọn **Option B — Platform-First Pivot**.

**Lý do:**
1. Dự án đã 85% code xong. Bỏ phí nếu pivot quá xa.
2. Board bring-up là unknown lớn nhất → phải resolved trước khi quyết định gì khác.
3. Demo 3-domain trên board thật là asset mạnh nhất để gọi vốn hoặc tìm đối tác.
4. Không cần burn $15K-$25K ngay cho BTL certification khi chưa chắc sản phẩm hoạt động trên HW thật.
5. Cho phép quyết định lại sau khi có demo + feedback thị trường.

**Lộ trình đề xuất (90 ngày từ 2026-07-01):**

```
Tháng 7 (2026-07): Board Bring-up Sprint
  - Tuần 1-2: IOP cross-test trên Orange Pi 5B + STM32G0B1 board thật
  - Tuần 3-4: Verify full IO chain (UI→ADC→IOP→iobus→shm→core→output)
  - Gate: Phase 2 & Phase 3 pass trên board thật

Tháng 8 (2026-08): Integration Sprint
  - Tuần 1-2: Core runtime + BACnet/Modbus verify trên board thật
  - Tuần 3-4: HMI render trên TFT thật + Web backend connect 4 pages còn thiếu
  - Gate: Phase 4 & Phase 5.5 pass trên board thật

Tháng 9 (2026-09): Demo Polish Sprint
  - Tuần 1-2: 3-domain demo hoàn chỉnh (HVAC mini, Pump/Water, Energy/Gateway)
  - Tuần 3-4: Soak test 24h, stability fix, packaging hoàn thiện
  - Gate: Demo-ready cho investor/partner
```

**Decision gates (CEO quyết định):**

| Gate | Khi nào | Quyết định |
|------|---------|-----------|
| G1 | Sau board bring-up (cuối tháng 7) | Xác nhận HW hoạt động → tiếp tục Option B, hoặc pivot nếu HW fail |
| G2 | Sau demo 3-domain (cuối tháng 9) | Có demo → quyết định gọi vốn / tìm đối tác / quay lại Option A (BTL cert) hoặc Option C (launch DDC) |
| G3 | Sau khi có vốn/đối tác | Scale team → BTL certification + production hardening |

---

## Phần 6: Next Actions (CEO Assignment)

### Action ngay (tuần này):

| # | Action | Owner | Deadline |
|---|--------|-------|----------|
| 1 | CEO quyết định chọn Option A/B/C | CEO (Owner) | 2026-07-01 |
| 2 | Nếu chọn Option B: tạo sprint issue "Board Bring-up Sprint — July 2026" giao CTO | CEO → CTO | 2026-07-01 |
| 3 | Review & approve SW_COMPONENT_LIBRARY + GRAPH_SCHEMA Protocol node chapters (giải quyết CF-03) | CEO (Owner) | 2026-07-03 |
| 4 | Ký thư xin ASHRAE Vendor ID (giải quyết GAP-BIBB-08) | CEO (Owner) | 2026-07-03 |
| 5 | Đóng băng scope Rev A.0 — cập nhật REVA_SCOPE_ROADMAP + CANONICAL_DECISIONS | CEO | 2026-07-03 |

### Actions medium-term (tháng 7-8):

| # | Action | Owner |
|---|--------|-------|
| 6 | Board bring-up: IOP cross-test Orange Pi 5B ↔ STM32G0B1 | CTO → Dev SOM + Dev FW |
| 7 | Resolve 4 web pages chưa connected (Trends/Scheduler/Network/Validator) | CTO → Dev Web |
| 8 | Đánh giá SOM sourcing risk: confirm Radxa CM3 extended temp variant availability | CTO → HW Engineer |
| 9 | Cập nhật TASK_CHECKLIST + PHASE_PLAN reflect board bring-up priority | CTO |

---

## Appendix A: Quick Wins (có thể làm song song)

| # | Quick Win | Effort | Impact |
|---|-----------|--------|--------|
| Q1 | Sửa header/footer version mismatch trong 5 docs (solved CF-03 partial) | 1h | Audit trail sạch |
| Q2 | Đăng ký ASHRAE Vendor ID (gửi thư) | 1 ngày | Unblock GAP-BIBB-08 |
| Q3 | Đăng ký BACnet International Silver membership | 1 ngày | Unblock GAP-SMP-02 |
| Q4 | Cập nhật 07_CORE §0 MVP table reflect trạng thái thật | 30 phút | Sync docs vs code |
| Q5 | Xác nhận `handler_ack_alarm.c` wired trong BACnet server | 2h | Unblock GAP-BIBB-01 |

---

## Appendix B: Risk Register Update

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Board bring-up fail do HW lỗi | P0 | Có backup plan: test từng phần (UART trước, IO sau). Nếu MCU fail → fallback về fake_mcu cho demo |
| Radxa CM3 không có extended temp | P0 | Accept rủi ro cho Rev A.0 demo. Production chọn SOM khác (Variscite DART-MX8M-MINI rank #1 từ IOT-5464) |
| Team < 3 dev → delay | P1 | CTO prioritize board bring-up. Cắt feature không cần thiết cho demo |
| BTL certification cost vượt budget | P2 | Lùi BTL sang giai đoạn sau có vốn. Rev A.0 demo dùng BACnet interop không certified |

---

**Document version:** 1.0 | 2026-06-30
**Next review:** Sau khi Owner chọn Option (dự kiến 2026-07-01)
