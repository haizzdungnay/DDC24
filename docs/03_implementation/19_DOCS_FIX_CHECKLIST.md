# 19 — Docs Fix Checklist
## MK-DDC-24 — Checklist cập nhật tài liệu SOM / IOP / Core / Web

> **Document ID:** IMPL-DOCS-CHECKLIST-MK-DDC-24-VI
> **Ngày tạo:** 2026-06-11
> **Nguồn tổng hợp:** [18_DOCS_AUDIT_SOM_IMPLEMENTATION.md](/home/chuong/Desktop/DDC-PROJECT/docs/03_implementation/18_DOCS_AUDIT_SOM_IMPLEMENTATION.md:1)
> **Mục tiêu:** danh sách ngắn để tick khi sửa docs, hoặc copy từng dòng vào tracker.

---

## Cách dùng

- Mỗi mục là 1 issue nhỏ.
- Khi làm tracker, dùng `ID + tiêu đề` làm title.
- Khi xử xong, tick checkbox và ghi link commit/PR bên dưới.

---

## Critical

- [x] `DOC-CRIT-01` ✔ 2026-06-11 (Contract Freeze batch — single-writer + ngoại lệ core (ao_setpoint/do_cmd atomic) chốt tại mkddc_shm.h + 06 §5 + 07 §7.2) — Chốt mô hình đồng bộ cho `kx_io_shm_t`
  Output cần có: tài liệu nói rõ `single-writer` hay `multi-writer`; nếu nhiều writer thì định nghĩa cơ chế mới, không dùng mô tả seqlock cũ mơ hồ.
  File chạm: `shared/kinexus_shm.h`, `06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md`, `01_SYSTEM_IMPLEMENTATION_OVERVIEW.md`, `00_IMPLEMENTATION_README.md`.

- [x] `DOC-CRIT-02` ✔ 2026-06-11 (Contract Freeze batch — bảng bit0–6 + set/clear/sticky chốt tại iop_protocol.h + SWFW §4.3.1 + 05 §6.8 + 15_CONTRACT_FREEZE §3) — Freeze `FAULT_FLAGS` thành 1 bảng bitmask duy nhất
  Output cần có: bit `0..15`, tên, ý nghĩa, sticky/non-sticky, rule set/clear giống nhau giữa header/spec/guide/test.
  File chạm: `shared/iop_protocol.h`, `SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md`, `05_IOP_UART_IMPLEMENTATION_GUIDE.md`, `11_INTEGRATION_TEST_PLAN.md`.

---

## High

- [x] `DOC-HIGH-01` ✔ 2026-06-11 (Contract Freeze batch — enum IOP_RESET_REASON_* 0x00–0x05 tại header + SWFW §4.11 + 05 §6.9) — Freeze `RESET_IO reason` enum
  Output cần có: enum chuẩn trong header + bảng reason code trong spec/guide/test.
  File chạm: `shared/iop_protocol.h`, `SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md`, `05_IOP_UART_IMPLEMENTATION_GUIDE.md`.

- [x] `DOC-HIGH-02` ✔ 2026-06-11 (Contract Freeze batch — rename mkddc_shm.h + path /dev/shm/mkddc_* + giữ kx_/magic — 15_CONTRACT_FREEZE §6) — Chốt SHM naming/path `kinexus` vs `mkddc`
  Output cần có: 1 path runtime duy nhất cho Rev A; ghi rõ rename policy cho file name, macro, struct, magic, shm path.
  File chạm: `shared/kinexus_shm.h`, `00_IMPLEMENTATION_README.md`, `01_SYSTEM_IMPLEMENTATION_OVERVIEW.md`, `06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md`, `13_BRINGUP_GUIDE.md`.

- [x] `DOC-HIGH-03` ✔ 2026-06-11 (batch 2 — banner LEGACY + sửa nội dung trực tiếp: SW_REQ §2.2 (SHM layout legacy → mkddc_shm.h), SW_ARCH (freeze banner + §1.1/§1.2), SW_IODRIVER (reference-only banner)) — Gắn nhãn hoặc cập nhật lại spec cũ đang mâu thuẫn kiến trúc mới
  Output cần có: banner `legacy/reference-only` hoặc nội dung đã update theo `mkddc-*`, `graph runtime`, SHM layout mới.
  File chạm: `SW_REQUIREMENTS_MK-DDC-24_VI.md`, `SW_ARCH_SPEC_MK-DDC-24_VI.md`, `SW_IODRIVER_DESIGN_MK-DDC-24_VI.md`.

- [x] `DOC-HIGH-04` ✔ 2026-06-11 (Contract Freeze batch — iobus tạo SHM chạy trước, core After=mkddc-iobus — systemd đầy đủ 06 §10 + 07 §9) — Chốt startup order và dependency giữa `mkddc-core` và `mkddc-iobus`
  Output cần có: thứ tự boot thống nhất giữa architecture spec, systemd mẫu, bring-up guide.
  File chạm: `SW_ARCH_SPEC_MK-DDC-24_VI.md`, `13_BRINGUP_GUIDE.md`, `03_PHASE_PLAN.md`.

- [x] `DOC-HIGH-05` ✔ 2026-06-11 (batch 2 — chốt: web/commissioning LUÔN vào mức 2 Local manual, REST bỏ priority 1..16, BACnet array → mức 3; sửa openapi PUT /points + 08 §1.2 + 12 DoD) — Chuẩn hóa priority model giữa core/web/OpenAPI/DoD
  Output cần có: bảng priority chính thức, mapping `commissioning/manual/BACnet/web`, rule có cho client tự chọn priority hay không.
  File chạm: `07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md`, `08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md`, `12_DEFINITION_OF_DONE.md`, `openapi.yaml`.

- [x] `DOC-HIGH-06` ✔ 2026-06-11 (batch 2 — freeze 3 role admin/operator/viewer + ma trận quyền 08 §1.1; sửa openapi (đã đúng) + users.conf example + bỏ role engineer) — Freeze RBAC/role matrix
  Output cần có: role list chính thức, quyền từng role cho login/view/config/commissioning/deploy/ack alarm.
  File chạm: `08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md`, `openapi.yaml`, `CONFIG_SCHEMA_MK-DDC-24_VI.md`.

---

## Medium

- [x] `DOC-MED-01` ✔ 2026-06-11 (batch 2 — bảng policy 5 case (thiếu file/JSON hỏng/thiếu field/sai enum/ngoài range) tại CONFIG_SCHEMA §8, khớp 06 §4 — JSON hỏng = fail-fast) — Chuẩn hóa policy lỗi config
  Output cần có: rule riêng cho `missing file`, `invalid JSON`, `invalid field`, `unknown enum`, service fail-fast hay fallback ra sao.
  File chạm: `06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md`, `CONFIG_SCHEMA_MK-DDC-24_VI.md`, các guide service liên quan.

- [x] `DOC-MED-02` ✔ 2026-06-11 (batch 2 — SW-PLC-010 gắn nhãn legacy (100ms gạch bỏ, Rev A = 1000ms theo SW_RUNTIME + 07 §2)) — Chốt scan period Rev A và gắn nhãn timing cũ
  Output cần có: default scan duy nhất cho `mkddc-core` Rev A; tài liệu cũ 100ms được đánh dấu legacy nếu không còn hiệu lực.
  File chạm: `07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md`, `SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md`, `SW_REQUIREMENTS_MK-DDC-24_VI.md`.

- [x] `DOC-MED-03` ✔ 2026-06-11 (batch 2 — contract đầy đủ tại 07 §8: JSON lines /run/mkddc/core.sock, request/response schema, correlation id, timeout 3s, error codes, audit mapping; 08 reference) — Viết IPC contract riêng cho `web <-> core`
  Output cần có: path socket, request/response schema, timeout, error code, correlation id, result mapping cho audit.
  File chạm: `07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md`, `08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md`, file contract mới nếu cần.

- [x] `DOC-MED-04` ✔ 2026-06-11 (batch 2 — SystemStatus tách versions{mcu_fw,iobus,core,web} + scan{count,overrun} + ghi nguồn metrics — openapi + 08 §3) — Mở rộng `SystemStatus` để phân biệt version và source metrics
  Output cần có: fields rõ cho `mcu_fw_version`, `core_version`, `iobus_version`, `web_version` nếu cần; metrics nào từ iobus, metrics nào từ core.
  File chạm: `08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md`, `openapi.yaml`.

- [x] `DOC-MED-05` ✔ 2026-06-11 (batch 2 — spec tool tools/shm_dump_io (seqlock reader, decode field+fault bit, --watch/--json, exit code) tại 06 §11; 13 §10 dùng tool thay cat|xxd) — Bổ sung tool/flow đọc SHM phục vụ bring-up
  Output cần có: tool hoặc format dump chuẩn, không chỉ `cat|xxd`.
  File chạm: `13_BRINGUP_GUIDE.md`, có thể thêm `tools/` hoặc file hướng dẫn riêng.

- [x] `DOC-MED-06` ✔ 2026-06-11 (Contract Freeze batch — fake MCU/PTY checklist 10 bước 06 §11.1 + 03 P2 + 16_QUICK_START §5) — Viết no-board bring-up path cho dev SOM
  Output cần có: fake MCU/PTY flow chạy được `handshake -> GET_IO -> SHM write -> SET_DO` khi chưa có board.
  File chạm: `06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md`, `03_PHASE_PLAN.md`, `13_BRINGUP_GUIDE.md`.

- [x] `DOC-MED-07` ✔ 2026-06-11 (batch 2 — CONFIG_SCHEMA: bảng owner/reader/reload từng file config + đổi hết io-driver/field-bus service → mkddc-iobus) — Chuẩn hóa tên service mới trong config docs
  Output cần có: bỏ cách gọi `io-driver`, `field-bus service` cũ; thay bằng `mkddc-iobus`, `mkddc-core`, `mkddc-web` và nêu rõ service owner từng file config.
  File chạm: `CONFIG_SCHEMA_MK-DDC-24_VI.md`.

- [x] `DOC-MED-08` ✔ 2026-06-11 (Contract Freeze batch — bảng scaling đầy đủ 7 sensor_type + constants + test case 06 §3.6) — Bổ sung bảng scaling implement-level cho mọi `sensor_type`
  Output cần có: raw encoding, công thức, constants, clamp, unit, quality/fault rule cho `0-10V`, `4-20mA`, `PT100`, `PT1000`, `NTC10k`, `NTC20k`, `dry`.
  File chạm: `06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md`, có thể thêm file reference riêng.

---

## Gợi ý thứ tự xử lý

1. `DOC-CRIT-01`
2. `DOC-CRIT-02`
3. `DOC-HIGH-01`
4. `DOC-HIGH-02`
5. `DOC-HIGH-03`
6. `DOC-HIGH-04`
7. `DOC-HIGH-05`
8. `DOC-HIGH-06`
9. Nhóm `DOC-MED-*`

---

## Tracker-ready titles

- `DOC-CRIT-01: Chốt concurrency model cho kx_io_shm_t`
- `DOC-CRIT-02: Freeze FAULT_FLAGS giữa header/spec/guide/test`
- `DOC-HIGH-01: Chuẩn hóa RESET_IO reason enum`
- `DOC-HIGH-02: Chốt SHM naming/path kinexus vs mkddc`
- `DOC-HIGH-03: Gắn nhãn hoặc cập nhật spec cũ mâu thuẫn kiến trúc mới`
- `DOC-HIGH-04: Chuẩn hóa startup order core/iobus`
- `DOC-HIGH-05: Freeze priority model giữa core/web/OpenAPI`
- `DOC-HIGH-06: Freeze RBAC role matrix`
- `DOC-MED-01: Chuẩn hóa config error policy`
- `DOC-MED-02: Chốt scan period Rev A và gắn nhãn timing cũ`
- `DOC-MED-03: Viết IPC contract web-core`
- `DOC-MED-04: Mở rộng SystemStatus version/metrics fields`
- `DOC-MED-05: Bổ sung shm dump workflow cho bring-up`
- `DOC-MED-06: Viết no-board bring-up path cho dev SOM`
- `DOC-MED-07: Chuẩn hóa service naming trong config docs`
- `DOC-MED-08: Bổ sung scaling table implement-level`

