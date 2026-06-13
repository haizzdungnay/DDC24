# Software Coding Standard — MK-DDC-24
## SOM / Debian 12 userspace

> **Document ID:** STD-SW-CODE-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-13 (reconcile module names theo ADR-005 mkddc-*) · 1.0 | 2026-05-30
> **Áp dụng:** mọi service trên SOM (C/C++/Python/TypeScript). Rule "MUST" = block merge.
> 📘 [README](../../01_specs/README.md) · Cơ sở: `SW_ARCH §7`, IEC 62443-4-1

---

## 1. Ngôn ngữ theo module (xem SW-REQ §1)
| Module | Ngôn ngữ | Lý do |
|--------|----------|-------|
| `mkddc-iobus` | C/C++17 | IOP hot path, libmodbus, bacnet-stack |
| `mkddc-core` | C++17 | component graph, priority/safe-state, SCHED_FIFO |
| `mkddc-web` backend | Go | REST/config/validator/audit (ADR-007) |
| `mkddc-web` frontend | TypeScript + React | Rev A form/JSON UI |
| Agent/MQTT/HMI/OTA | Python/C/shell | Deferred Rev B+; legacy `kinexus-*` docs are reference-only |

## 2. Chuẩn từng ngôn ngữ
### 2.1 C11 / C++17 (driver, PLC, HMI)
- `-Wall -Wextra -Werror`; C++ dùng RAII, không raw `new`/`delete` (smart pointer).
- Không exception trên hot-path PLC scan; xử lý lỗi bằng status/Expected.
- Concurrency: tuân thủ `SW_ARCH §2` (shm seqlock/rwlock). Reader **không** block writer.
- `clang-tidy` + `clang-format` (Google style rút gọn). AddressSanitizer trong test build.

### 2.2 Python 3.11 (agent, ota, security)
- **PEP 8** + **type hints** bắt buộc; `ruff` (lint) + `mypy --strict` 0 error.
- `async`/FastAPI cho REST; không blocking I/O trong event loop.
- Cấm `eval/exec`, cấm hardcode secret (SW-SEC-005). Dùng `secrets`/HSM key store.
- Test: `pytest`, coverage ≥ 80% core (TEST-001).

### 2.3 TypeScript / Svelte (Web IDE)
- `tsconfig strict: true`; `eslint` + `prettier`; không `any` không lý do.
- Gọi backend qua HTTPS, không lưu token ở localStorage (dùng httpOnly cookie/session).

### 2.4 Shell
- `#!/bin/bash`, `set -euo pipefail`, `shellcheck` 0 warning.

## 3. Đặt tên & cấu trúc
- File/binary theo `SW_ARCH §8` (`/usr/sbin/kinexus-*d`, lib `/usr/lib/kinexus`).
- Config tại `/data/config/*.conf` (JSON, schema D-5). Không hardcode đường dẫn rải rác — dùng hằng/định nghĩa trung tâm.
- API response JSON theo `SW-API-010`: `{"error","code","request_id"}`.

## 4. Bảo mật (IEC 62443-4-1 — bắt buộc)
- Mọi input từ network **validate** (range/type) trước xử lý (SW-API-005).
- TLS 1.3 cho REST/MQTT/OTA; không fallback TLS 1.2 (MQ-002).
- Audit log mọi auth/config/write/OTA (SW-SEC-006).
- Dependency scan mỗi build (`trivy`/`grype`, SEC-002); SBOM mỗi release (SEC-003).
- Secret: JWT/khóa từ secure key store (D-11), không commit, không log.

## 5. Logging
- Structured log (JSON line) vào `/data/log/`; timestamp ISO8601 (SW-LOG-001/004).
- Mức: ERROR/WARN/INFO/DEBUG; production tắt DEBUG.

## 6. Test & CI
- Unit (pytest/gtest) + integration (IOP/BACnet/Modbus). Coverage core ≥ 80%.
- CI: lint + static + type + unit + dependency scan. Fail → block merge.

## 7. Commit/PR
- Ghi **REQ ID** + **design unit** (vd "SW-MOD-003 / D-2"). Reviewer ≥ 1; thay đổi security/interface cần Lead duyệt.

---
**Rev** 1.0 | 2026-05-30
