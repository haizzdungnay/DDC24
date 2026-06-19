# 01 — PROJECT STATUS SNAPSHOT — MK-DDC-24

> **Ngày review:** 2026-06-19
> **Reviewer:** PM + QA/QC (AI-assisted)
> **Branch:** `docs/cor-009-010-board-deploy-runbook-update`
> **Commit:** `01fcb25`

---

## 1. Bảng trạng thái tổng thể

| Hạng mục | Trạng thái | Ghi chú |
|----------|:----------:|---------|
| **Source code** | 🟡 Yellow | 2/3 service SOM (core + iobus) implemented, 115 test pass. **mkddc-web (Go+React) = 0 dòng code. Firmware MCU = 0 dòng code.** |
| **Build/run** | 🟡 Yellow | `mkddc-core` và `mkddc-iobus` build + chạy local được. Web và FW chưa có để build. Không có Docker. |
| **Core features** | 🟡 Yellow | IOP protocol, graph runtime 23 component, priority resolver, safe-state, BACnet logic, Modbus logic — đã implement ở SOM. Nhưng web UI, firmware, E2E = 0%. Ước tính **~45-50%** tổng effort. |
| **Documents** | 🟡 Yellow | 197 file markdown, ~37.270 dòng. Bộ specs/design rất mạnh. **7 tài liệu cần reconciliation** (legacy content). Thiếu Release Note, User Manual production, Operation Guide. |
| **API spec** | 🟡 Yellow | OpenAPI spec có (`openapi.yaml`), REST API doc có. Nhưng **chưa có backend thực tế (Go)** nên chưa kiểm tra được API thật vs spec. |
| **Database design** | 🟢 Green | Không dùng database truyền thống. Dùng shared memory (SHM) + config file JSON. SHM contract (`mkddc_shm.h`) chốt, frozen, có doc đầy đủ. |
| **Test plan** | 🟡 Yellow | TEST_SPEC có. Integration test plan 11 có. 115 unit test pass. Nhưng **chưa có E2E test trên board thật**, chưa có long-run 24h test. |
| **Deployment guide** | 🟡 Yellow | Có runbook SOM no-MCU deploy (doc 26), systemd unit files, install script. Nhưng **chưa có deployment guide production đầy đủ**, chưa có Docker. |
| **Security** | 🟡 Yellow | Có security requirements (IEC 62443), GPG key ceremony, key rotation policy, nftables rules trong docs. Code có audit log, TLS port policy. Nhưng **JWT/auth chưa implement** (web chưa có). JSON parser tự chế = rủi ro bảo mật. |
| **Feasibility** | 🟢 Green | Kiến trúc rõ ràng (3-process, ADR chốt), tài liệu đầy đủ, code SOM chất lượng tốt. **Có thể tiếp tục phát triển** nếu bổ sung web + FW + reconcile docs. |

---

## 2. Bằng chứng

### Source code
- Binary `mkddc-core`: [build/core/mkddc-core](file:///home/chuong/Desktop/DDC-PROJECT/build/core/mkddc-core) — 1.5 MB, build 2026-06-13
- Binary `mkddc-iobus`: [build/iobus/mkddc-iobus](file:///home/chuong/Desktop/DDC-PROJECT/build/iobus/mkddc-iobus) — 365 KB, build 2026-06-13
- Source files: 116 C/C++ files, 13.458 dòng code trong `services/`
- Không tìm thấy `web/` directory, `fw/` directory, `.go` files, `.ts/.tsx/.js` files

### Build/test
- Kết quả test: [build/Testing/Temporary/LastTest.log](file:///home/chuong/Desktop/DDC-PROJECT/build/Testing/Temporary/LastTest.log)
- 115/115 test passed, 0 failed (ngày 2026-06-13)
- CI: [build-and-test.yml](file:///home/chuong/Desktop/DDC-PROJECT/.github/workflows/build-and-test.yml), [security.yml](file:///home/chuong/Desktop/DDC-PROJECT/.github/workflows/security.yml)

### Documents
- 197 markdown files trong `docs/`, ~37.270 dòng
- Master Register: [KX-DDC24-QA-REGISTER-001](file:///home/chuong/Desktop/DDC-PROJECT/docs/00_management/KX-DDC24-QA-REGISTER-001_VI.md)
- Traceability Matrix: [KX-DDC24-QA-TRACE-001](file:///home/chuong/Desktop/DDC-PROJECT/docs/00_management/KX-DDC24-QA-TRACE-001_VI.md)

---

## 3. Kết luận

### **Status B — Có thể tiếp tục phát triển nhưng phải bổ sung tài liệu/code trước.**

**Lý do:**
1. Code SOM (core + iobus) chất lượng tốt, kiến trúc sạch, test coverage mạnh — **dùng tiếp được**.
2. Bộ tài liệu specs/design rất đầy đủ cho industrial embedded product — **đủ để dev lập trình**.
3. Nhưng **2 phần chính chưa có code** (web + firmware) = không thể chạy E2E.
4. **7 tài liệu cần reconciliation** để tránh nhầm lẫn cho dev/QA mới.
5. **Thiếu Release Note, Production Deployment Guide, User Manual** cho milestone tiếp theo.

**Hành động trước khi tiếp tục:**
- Reconcile 7 tài liệu legacy → Active
- Scaffold web service (Go + React) theo ADR-006/007
- Setup firmware project (CubeMX + STM32G0B1RB)
- Fix P1 code issues (JSON parser, SHM race)
