# Repository, Build & CI — MK-DDC-24
## Cấu trúc mã nguồn + cách build + CI + git workflow

> **Document ID:** KX-DDC24-PM-REPO-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Approved · **Owner:** Tech Lead + DevOps
> 📘 [docs/README](../README.md) · Theo [Implementation Plan](../00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md), [Coding Standards](../../design/)

> 🎯 Tài liệu đầu tiên đọc trước khi gõ dòng code đầu tiên. Trả lời: code để ở đâu, build bằng gì, chạy CI ra sao, commit thế nào.

---

## 1. Mono-repo layout (nguồn-chuẩn cấu trúc code)

```
mk-ddc-24/                      # mono-repo
├── README.md
├── shared/                     # ⭐ HỢP ĐỒNG CODE dùng chung (đừng fork!)
│   ├── iop_protocol.h          # frame/CMD/CRC IOP — FW & BE include CHUNG
│   ├── kinexus_shm.h           # struct shared memory — các service BE include CHUNG
│   └── version.h               # số version build
├── fw/                         # FIRMWARE (MCU STM32G0B1) — C/FreeRTOS
│   ├── CMakeLists.txt
│   ├── Core/                   # CubeMX sinh (main, clock, gpio init)
│   ├── drivers/                # adc_drv, dac_drv, iop_drv, gpio_drv
│   ├── app/                    # io_sample, iop_comm, ao_output, do_control, diagnostics, watchdog
│   ├── common/                 # crc16, fault.h  (+ symlink ../shared/iop_protocol.h)
│   └── test/                   # Unity unit test (chạy trên host)
├── services/                   # BACKEND (SOM Debian) — C/C++/Python
│   ├── io-driver/              # C   — IOP master, scaling, ghi shm
│   ├── plc/                    # C++ — IEC 61131-3 engine
│   ├── bacnet/                 # C   — BACnet/IP (bacnet-stack)
│   ├── fieldbus/               # C/Py— Modbus RTU master (libmodbus)
│   ├── agent/                  # Py  — MQTT + REST (FastAPI)
│   ├── hmi/                    # C   — LVGL
│   ├── ota/                    # Py  — A/B update
│   └── libkinexus/             # lib chung BE: shm helper, log, config loader
├── webide/                     # FRONTEND — Svelte + TypeScript
│   ├── package.json
│   ├── src/
│   └── vite.config.ts
├── profiles/                   # device profile Modbus RTU (JSON) — field bus
├── infra/                      # build hệ thống
│   ├── debian-image/           # build rootfs (A/B), systemd units
│   ├── ci/                     # GitHub Actions workflows
│   └── scripts/                # flash, deploy, gen-sbom
└── docs/  spec/  design/  hardware-design/   (tài liệu — quy chiếu repo này)
```

> ⭐ **`shared/` là thiêng liêng.** FW và BE **include cùng** `iop_protocol.h` để frame/CRC khớp tuyệt đối. Không copy-paste, không sửa 1 bên. Đổi → bump version + cập nhật cả 2 bên + test cross.

## 2. Map: tài liệu thiết kế → thư mục code
| Thiết kế | Code |
|----------|------|
| [FW_MOD_IOP_COMM](../02_design/firmware/FW_MOD_IOP_COMM_MK-DDC-24_VI.md) | `fw/app/iop_comm.c` |
| [FW_MOD_IO_SAMPLE](../02_design/firmware/FW_MOD_IO_SAMPLE_MK-DDC-24_VI.md) | `fw/app/io_sample.c` |
| [SW_IODRIVER](../02_design/software/SW_IODRIVER_DESIGN_MK-DDC-24_VI.md) (gộp vào core) | `services/core/` |
| [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) · [SW_COMPONENT_LIBRARY](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md) | `services/core/` (mkddc-core) |
| [SW_FIELDBUS](../02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md) | `services/iobus/` (mkddc-iobus) |
| web Rev A: [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md)/[ADR-007](../adr/ADR-007-web-stack-go.md) (thay SW_WEBIDE, đã gỡ) | `web/` (Go, mkddc-web) |

## 3. Build nhanh (mỗi nghề)
```bash
# FW (host build + unit test)
cd fw && cmake -B build -DCMAKE_TOOLCHAIN_FILE=infra/arm-none-eabi.cmake && cmake --build build
cd fw && cmake -B build-test -DUNIT_TEST=ON && ctest --test-dir build-test   # test trên host

# BE service (vd io-driver C)
cd services/io-driver && cmake -B build && cmake --build build && ctest --test-dir build

# BE agent (Python)
cd services/agent && python -m venv .venv && . .venv/bin/activate && pip install -e . && pytest

# FE
cd webide && npm install && npm run dev      # dev server
cd webide && npm run build && npm run test    # build + vitest
```

## 4. CI/CD (GitHub Actions — `infra/ci/`)
| Workflow | Chạy gì | Chặn merge nếu |
|----------|---------|----------------|
| `fw.yml` | arm-gcc build `-Werror` + cppcheck/MISRA + Unity | build fail / MISRA error / test fail |
| `be.yml` | C: cmake+ctest+clang-tidy · Py: ruff+mypy+pytest (cov≥80%) | lint/type/test fail / cov<80% |
| `fe.yml` | eslint + tsc + vitest + build | lint/type/test fail |
| `security.yml` | trivy/grype deps + gitleaks (secret) + SBOM | CVE≥7 / secret lộ |
| `openapi.yml` | so khớp `webide` client ↔ `design/interfaces/openapi.yaml` | lệch contract |

## 5. Git workflow
- Branch: `main` (bảo vệ) ← PR từ `feat/<TASK-ID>-mô-tả`, `fix/...`.
- **Commit**: Conventional Commits — `feat(fw): IOP handshake (T-FW-03, IOP-FW-004)`. Ghi **REQ ID + Task ID**.
- PR: cần CI xanh + 1 reviewer; đổi `shared/` hoặc interface → cần cả FW Lead + SW Lead.
- Mỗi PR đóng task → cập nhật [Traceability](../00_management/KX-DDC24-QA-TRACE-001_VI.md) (cột Test) + CHANGELOG nếu đổi behaviour.

## 6. Versioning & release
- SemVer cho sản phẩm; `shared/version.h` = nguồn. OTA package `.kxpkg` theo [D-7](../02_design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md).

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | Tech Lead + DevOps | Phát hành đầu — repo layout, build, CI, git |
