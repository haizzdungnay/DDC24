# 05 — FEASIBILITY & PROGRAMMING READINESS REPORT — MK-DDC-24

> **Ngày review:** 2026-06-19
> **Reviewer:** PM + QA/QC (AI-assisted)

---

## 1. Đánh giá tiêu chí sẵn sàng lập trình

| # | Tiêu chí | Đạt/Không đạt | Ghi chú |
|:-:|---------|:-------------:|---------|
| 1 | **Requirement rõ ràng** | ✅ Đạt | PRD (FR/NFR/UC), SRS, FW_REQ, SW_REQ đầy đủ. REVA_SCOPE chốt scope Rev A. Product Definition là canonical source. |
| 2 | **Kiến trúc rõ ràng** | ✅ Đạt | ADR-004..008 chốt decisions. 3-process model rõ. Dual-layer (SOM+MCU). System Handbook giải thích. SW_ARCH + FW_ARCH có sơ đồ. |
| 3 | **Database rõ ràng** | ✅ Đạt | Không dùng DB truyền thống. SHM contract (`mkddc_shm.h`) frozen, ownership bảng chi tiết. Config JSON schema có. |
| 4 | **API rõ ràng** | ✅ Đạt | `openapi.yaml` + REST_API_OPENAPI doc. BACnet PICS/EPICS. Modbus Register Map. IOP protocol spec 25 KB. Graph Schema. |
| 5 | **UI flow rõ ràng** | ⚠️ Đạt một phần | ADR-006 chốt form/JSON (không wiresheet). Design System có. Nhưng **chi tiết UI mockup/wireframe chưa có** (UI spec cho mkddc-web Rev A). |
| 6 | **Module boundary rõ ràng** | ✅ Đạt | 3-process boundary sạch. SHM contract frozen. Core↔Web qua UNIX socket. Iobus↔Core qua SHM. Fieldbus→Core qua datagram. |
| 7 | **Build/run được** | ⚠️ Đạt một phần | SOM services build + test pass (115/115). Nhưng **web + firmware chưa có code → chưa build được toàn bộ**. |
| 8 | **Có test plan** | ✅ Đạt | TEST_SPEC (L1-L6), Integration Test Plan (group 0-10), DoD per phase. Unit test framework (GTest) đã setup. |
| 9 | **Có deployment guide** | ⚠️ Đạt một phần | Systemd units có. Install script có. SOM no-MCU runbook có. Nhưng **production deployment guide chưa đầy đủ**. |
| 10 | **Có owner từng module** | ✅ Đạt | Team Work Split doc: FW=Dev1, SOM=Dev2, Web=Dev3. Task checklist có owner. Phase plan có owner. |

### Tóm tắt: **7/10 đạt, 3/10 đạt một phần**

---

## 2. Phân tích chi tiết từng phần chưa đạt

### 2.1 UI flow — cần bổ sung wireframe/mockup cho mkddc-web Rev A

**Hiện trạng:**
- ADR-006 chốt approach: form-based config + graph.json import/export
- Design System (tokens, colors, typography) có
- Nhưng chưa có wireframe/mockup cụ thể cho các trang: Login, Point List, Config, Alarm, Graph Deploy

**Ảnh hưởng:**
- Dev Web phải tự quyết định layout → rủi ro redesign
- QA khó validate UI behavior

**Đề xuất:**
- Tạo wireframe/mockup cho 5 trang chính trước khi bắt đầu Phase 5 (Web)
- Có thể dùng đơn giản (Figma/Excalidraw), không cần high-fidelity

### 2.2 Build — cần scaffold web + firmware

**Hiện trạng:**
- SOM C++ services: build sạch, test pass
- Web (Go+React): 0 code, chưa có `go.mod`, `package.json`
- Firmware (STM32): 0 code, chưa có CubeMX project

**Ảnh hưởng:**
- Không thể chạy E2E
- CI chỉ build 2/4 components

**Đề xuất:**
- Scaffold ngay trong Sprint 1: `npx create-react-app` + Go module init
- FW: CubeMX generate + blink LED skeleton

### 2.3 Deployment — cần production guide

**Hiện trạng:**
- Có: systemd units, install.sh, SOM bringup guide, no-MCU runbook
- Thiếu: Production deployment checklist, firmware flash guide, network config, backup/restore

**Đề xuất:**
- Viết production deployment guide trước Phase 6 (E2E)
- Bao gồm: target board setup, firmware flash, network, certificate install, first-run verification

---

## 3. Đánh giá rủi ro khi tiếp tục phát triển

| # | Rủi ro | Probability | Impact | Mitigation |
|:-:|--------|:-----------:|:------:|-----------|
| 1 | Firmware MCU phát triển chậm (thiếu dev FW, thiếu board) | **Cao** | **Cao** | Prioritize FW bring-up; có fake_mcu cho dev SOM song song |
| 2 | Web service effort bị đánh giá thấp | **Trung bình** | **Trung bình** | Estimate rõ: ~5K-10K LoC Go + React; allocate 4-6 tuần |
| 3 | 7 tài liệu legacy gây nhầm lẫn | **Cao** | **Trung bình** | Reconcile NGAY trước khi onboard dev mới |
| 4 | Integration issues khi ghép 3 service + FW | **Trung bình** | **Cao** | Dùng fake_mcu + PTY trong Phase 2-3; integration test plan có |
| 5 | Performance issues trên target board (Radxa CM3) | **Thấp** | **Trung bình** | PREEMPT_RT kernel, mlockall, absolute-time sleep đã design |
| 6 | Security chưa implement → deadline nghiệm thu | **Trung bình** | **Trung bình** | JWT/TLS ở web layer, design sẵn; implement song song Phase 5 |

---

## 4. Kết luận & Đề xuất

### Dự án có đủ điều kiện lập trình tiếp không?

**CÓ** — với điều kiện bổ sung trước khi phát triển feature mới.

### Đề xuất: **Option 2 — Bổ sung docs/code nền trước rồi mới lập trình tiếp**

**Lý do chọn Option 2 (không phải Option 1 hay 3):**

- **Không phải Option 1** (tiếp tục ngay) vì: 7 tài liệu legacy chưa reconcile, web+FW chưa có skeleton → dev mới sẽ bị confuse, không có E2E path.
- **Không phải Option 3** (dừng refactor) vì: Code SOM hiện tại chất lượng tốt, kiến trúc đúng hướng, 115 test pass. Không cần refactor — chỉ cần bổ sung.

### Kế hoạch thực hiện Option 2

#### Sprint 0 — Foundation Fix (1-2 tuần)
- [ ] Reconcile 7 tài liệu legacy → Active
- [ ] Scaffold mkddc-web: Go module + React app + healthz endpoint
- [ ] Setup CubeMX project: STM32G0B1RB + blink LED + USART2 debug
- [ ] Fix TD-001: thay JSON parser tự chế
- [ ] Tạo wireframe cho 5 trang web chính
- [ ] Cập nhật CI: build 4 components

#### Sprint 1 — MCU + Web Skeleton (2-4 tuần)
- [ ] FW Phase 1: gpio_drv, do_control, io_sample, watchdog
- [ ] Web: login JWT, healthz, point list stub
- [ ] SOM: fix TD-002 (SHM race), fix TD-003 (EAGAIN semantics)

#### Sprint 2+ — Theo Phase Plan đã có
- Phase 2 (IOP UART), Phase 3 (iobus), Phase 4 (core)... đã plan chi tiết trong `03_PHASE_PLAN.md` + `11_TASK_CHECKLIST.md`

### Effort ước tính cho Option 2

| Hạng mục | Effort | Team |
|----------|:------:|------|
| Sprint 0 (Foundation Fix) | 1-2 tuần | All |
| FW MCU (Phase 1-2) | 4-6 tuần | Dev FW |
| Web (Phase 5) | 4-6 tuần | Dev Web |
| Integration (Phase 6) | 2-3 tuần | All |
| **Tổng đến Rev A MVP** | **~12-17 tuần** | 3 dev |

> **Lưu ý:** SOM backend (Phase 3-4) đã gần hoàn thành (~90%), effort chính là FW + Web + Integration.
