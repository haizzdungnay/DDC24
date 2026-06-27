# 06 — ACTION PLAN SAU REVIEW — MK-DDC-24

> **Ngày tạo:** 2026-06-19
> **Owner:** PM
> **Cập nhật tiếp theo:** Sau Sprint 0 completion

---

## 1. Danh sách việc cần làm

| ID | Việc cần làm | Loại việc | Ưu tiên | Owner | Deadline | Acceptance Criteria |
|:--:|-------------|:---------:|:-------:|-------|:--------:|-------------------|
| ACT-001 | Reconcile PRD — xóa/sửa nội dung IEC 61131-3, FBD/ST, PLC thành component graph | Docs Update | **P0** | Tech Writer + Architect | Sprint 0 | Không còn banner RECONCILE; nội dung khớp CANONICAL_DECISIONS |
| ACT-002 | Reconcile SRS — sửa §11 KinexusET IDE → mkddc-web form/JSON; sửa tech stack | Docs Update | **P0** | Tech Writer + Architect | Sprint 0 | Không còn banner RECONCILE |
| ACT-003 | Reconcile SW Requirements — sửa Python/FastAPI/Svelte → Go/React | Docs Update | **P0** | Tech Writer + SW Lead | Sprint 0 | Không còn banner RECONCILE |
| ACT-004 | Reconcile SW Architecture — sửa 7-service kinexus-* → 3-process mkddc-* | Docs Update | **P0** | Architect | Sprint 0 | Không còn banner RECONCILE |
| ACT-005 | Reconcile System Handbook — cập nhật sơ đồ + mô tả theo component graph | Docs Update | **P0** | Architect | Sprint 0 | Không còn banner RECONCILE; new team members không bị confuse |
| ACT-006 | Reconcile SW DDD — sửa PLC engine references | Docs Update | **P0** | SW Lead | Sprint 0 | Không còn banner RECONCILE |
| ACT-007 | Reconcile Config Schema — cập nhật theo implementation thực tế | Docs Update | **P0** | SW Lead | Sprint 0 | Config doc khớp config code |
| ACT-008 | Reconcile Project Overview — cập nhật theo kiến trúc mới | Docs Update | **P1** | PMO | Sprint 0 | First-read doc khớp reality |
| ACT-009 | Reconcile BE Developer Guide — sửa Python/FastAPI → Go | Docs Update | **P1** | SW Lead | Sprint 0 | Dev guide khớp tech stack |
| ACT-010 | Reconcile FE Developer Guide — sửa Svelte → React | Docs Update | **P1** | Web Lead | Sprint 0 | Dev guide khớp tech stack |
| ACT-011 | **Scaffold mkddc-web (Go backend)** — go.mod, main.go, healthz, cors, basic router | Code Fix | **P0** | Dev Web | Sprint 0 | `go build` pass, `curl /healthz` → 200 |
| ACT-012 | **Scaffold mkddc-web (React frontend)** — create-react-app, basic layout, build | Code Fix | **P0** | Dev Web | Sprint 0 | `npm run build` pass, trang trống hiển thị |
| ACT-013 | **Setup CubeMX project (STM32G0B1RB)** — .ioc, blink LED, USART2 debug | Code Fix | **P0** | Dev FW | Sprint 0 | Firmware build sạch, nạp ST-Link, LED blink |
| ACT-014 | **Thay JSON parser tự chế** bằng nlohmann/json hoặc RapidJSON | Code Fix | **P1** | Dev SOM | Sprint 1 | Tất cả config/command parse dùng thư viện chuẩn; test pass |
| ACT-015 | **Fix SHM race condition** khi iobus re-attach | Code Fix | **P1** | Dev SOM | Sprint 1 | Core output không bị lost khi iobus restart; test concurrency pass |
| ACT-016 | **Fix IopPort EAGAIN semantics** — phân biệt EAGAIN vs NOT_OPEN | Code Fix | **P1** | Dev SOM | Sprint 1 | Recovery path không reconnect sai; test case mới pass |
| ACT-017 | Xóa hoặc redirect `shared/kinexus_shm.h` legacy alias | Code Fix | **P2** | Dev SOM | Sprint 1 | File legacy không còn gây nhầm |
| ACT-018 | Thêm `build*/` vào `.gitignore` | Code Fix | **P2** | Dev SOM | Sprint 0 | Build artifacts không commit vào repo |
| ACT-019 | **Tạo wireframe cho 5 trang web chính** (Login, Points, Config, Alarm, Graph) | Architecture Update | **P1** | UX + Web Lead | Sprint 0 | Wireframe approved trước khi dev React |
| ACT-020 | **Viết Release Note template** cho Rev A | Docs Update | **P1** | PM | Sprint 1 | Template sẵn, fill khi feature done |
| ACT-021 | **Viết Production Deployment Guide** | Docs Update | **P1** | DevOps + SW Lead | Sprint 2 | Guide đủ để deploy trên target board thật |
| ACT-022 | **Cập nhật CI** — build 4 components (core, iobus, web, fw) | Deployment Fix | **P1** | DevOps | Sprint 0 | CI build 4 job xanh |
| ACT-023 | **Implement FW Phase 1** — gpio_drv, do_control, io_sample, ao_output, watchdog | Code Fix | **P0** | Dev FW | Sprint 1 | MCU IO thật chạy, task FW-001..004 done |
| ACT-024 | **Implement FW Phase 2** — IOP protocol MCU side | Code Fix | **P0** | Dev FW | Sprint 2 | HANDSHAKE + GET_IO + SET_* pass, task IOP-001..006 done |
| ACT-025 | **Implement Web Phase 5** — Login, Points, Config, Alarm, Graph | Code Fix | **P1** | Dev Web | Sprint 2-3 | 8 web features chạy, task WEB-001..005 done |
| ACT-026 | **E2E integration test trên board thật** — TC-E2E-01..06 | Test Update | **P1** | All + Tester | Sprint 3 | 6 E2E test pass on hardware |
| ACT-027 | **Long-run 24h stability test** | Test Update | **P2** | Tester | Sprint 3 | 24h không treo/leak/overrun |
| ACT-028 | **Viết Operation Guide** | Docs Update | **P2** | PM + Tech Writer | Sprint 3 | NOC/O&M có thể vận hành |
| ACT-029 | **Security audit** — JWT, TLS, input validation | Security Fix | **P1** | Security Lead | Sprint 2-3 | IEC 62443 compliance evidence |
| ACT-030 | **BTL pretest** — BACnet conformance | Test Update | **P2** | QA + Dev SOM | Sprint 3 | B-ASC pretest pass |

---

## 2. Timeline tổng quan

```
Sprint 0 (Tuần 1-2)     Sprint 1 (Tuần 3-4)     Sprint 2 (Tuần 5-8)     Sprint 3 (Tuần 9-12)
├─ ACT-001..010 (Docs)  ├─ ACT-014..016 (Fix)   ├─ ACT-024 (FW P2)      ├─ ACT-026 (E2E)
├─ ACT-011..013 (Skel)  ├─ ACT-020 (Release)    ├─ ACT-025 (Web P5)     ├─ ACT-027 (Long-run)
├─ ACT-018 (.gitignore) ├─ ACT-023 (FW P1)      ├─ ACT-021 (Deploy)     ├─ ACT-028 (Ops Guide)
├─ ACT-019 (Wireframe)  ├─ ACT-017 (Cleanup)    ├─ ACT-029 (Security)   ├─ ACT-030 (BTL)
└─ ACT-022 (CI)         └──────────────────────  └─ ACT-022 (CI update)  └──────────────────
```

---

## 3. Phân bổ theo owner

### PM
- ACT-001..010 (coordinate docs reconciliation)
- ACT-019 (coordinate wireframe)
- ACT-020 (release note template)
- ACT-028 (operation guide)

### Dev SOM (Dev 2)
- ACT-014 (JSON parser replacement)
- ACT-015 (SHM race fix)
- ACT-016 (EAGAIN fix)
- ACT-017, ACT-018 (cleanup)

### Dev FW (Dev 1)
- ACT-013 (CubeMX skeleton)
- ACT-023 (FW Phase 1)
- ACT-024 (FW Phase 2 — IOP MCU side)

### Dev Web (Dev 3)
- ACT-011 (Go backend scaffold)
- ACT-012 (React frontend scaffold)
- ACT-025 (Web Phase 5)

### Architect / Tech Writer
- ACT-001..010 (docs reconciliation content)
- ACT-019 (wireframe content)

### QA / Tester
- ACT-026 (E2E test)
- ACT-027 (long-run test)
- ACT-030 (BTL pretest)

### DevOps
- ACT-021 (deployment guide)
- ACT-022 (CI update)

### Security Lead
- ACT-029 (security audit)

---

## 4. KPI theo dõi

| KPI | Target | Đo khi |
|-----|--------|--------|
| Tài liệu Needs Reconciliation | 0 (hiện: 7) | End of Sprint 0 |
| Build components pass CI | 4/4 (hiện: 2/4) | End of Sprint 0 |
| Unit test coverage (SOM) | Maintain 115+ | Every sprint |
| E2E test pass | 6/6 | End of Sprint 3 |
| Code issues fixed (TD-001..003) | 3/3 | End of Sprint 1 |
| Web features live | 8/8 | End of Sprint 3 |
| FW MCU IO working | Phase 1 done | End of Sprint 1 |

---

## 5. Ghi chú

- Mọi action item có trạng thái tracked trong `11_TASK_CHECKLIST.md` (đã có sẵn task ID map).
- ACT-001..010 có thể làm song song bởi nhiều người nếu chia file.
- ACT-014 (JSON parser) nên làm trước ACT-015 (SHM race) vì JSON parser ảnh hưởng cả config reload path.
- ACT-023 (FW Phase 1) + ACT-011/012 (Web skeleton) có thể làm song song — không phụ thuộc nhau.
- Phase Plan + Task Checklist đã có sẵn và rất chi tiết — chỉ cần follow existing plan sau Sprint 0/1.
