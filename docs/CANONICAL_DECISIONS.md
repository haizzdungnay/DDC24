# Canonical Decisions — MK-DDC-24

> **Trạng thái:** Canonical · **Cập nhật:** 2026-06-08
> Đây là bản chốt 1 trang. Khi bất kỳ tài liệu nào nói khác → **theo file này** và
> [PRODUCT_DEFINITION](01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md). Nguồn chi tiết:
> [REVA_SCOPE_ROADMAP](01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md),
> [BMS_EDGE_STRATEGY](01_specs/BMS_EDGE_STRATEGY_MK-DDC-24_VI.md), [ADR-004..008](adr/).

## Product Direction
MK-DDC-24 là **Component-Based BMS Edge Automation Controller** (ADR-008) — runtime điều
khiển component, local-first, kiêm vai trò gateway Modbus↔BACnet. **HVAC là use-case đầu
tiên, không phải giới hạn sản phẩm** (domain: HVAC, pump/water, lighting, energy, environment,
alarm/interlock, gateway, data acquisition). Rev A **không** phải IEC 61131-3 PLC.

## Runtime Architecture
Rev A runtime contains **three processes** (ADR-005):
- `mkddc-core` — graph execution, component scheduler, priority/safe-state, BACnet object table
- `mkddc-iobus` — STM32/IO (IOP) protocol, DI/DO/UI/AO scan, Modbus RTU/TCP, BACnet/IP datalink
- `mkddc-web` — REST API, configuration UI (form/JSON), import/export `graph.json`, validator (library)

## Rev A Scope (Rev A.0 = demo-grade / lab-grade)
- Fixed component set = **28 types** (ADR-008: +Interlock, AlarmDelay, RuntimeCounter, PulseCounter).
- Acceptance = **3-domain demo** (HVAC mini · Pump/Water · Energy/Gateway), each local-first + stale/fallback.
- **No** BTL certification target in Rev A.0.
- **No** IEC 61131-3 runtime in Rev A.0.
- **No** full Web IDE canvas (wiresheet) in Rev A.0 — config is form + `graph.json` import/export.
- **No** HMI panel, OTA, MQTT/cloud agent in Rev A.0.

## Superseded Terms
Các thuật ngữ sau là **legacy** trừ khi được đánh dấu rõ Rev B/Rev C:
- `kinexus-plc`, `kinexus-agent`, `kinexus-webide`, `kinexus-hmi`, `kinexus-ota`
- IEC 61131-3 PLC runtime
- FBD/ST Web IDE
- BACnet MS/TP, Modbus slave (đã bỏ theo ARCH-R010)

## Naming
Service Rev A: `mkddc-core` / `mkddc-iobus` / `mkddc-web`.
Header `shared/kinexus_shm.h` → `mkddc_shm.h` là task code riêng (ADR-005); hợp đồng IOP với MCU giữ nguyên.

## Conflict Rule
Nếu hai tài liệu mâu thuẫn về hướng sản phẩm/kiến trúc/scope → **Product Definition + file này thắng**.
Mọi PR tài liệu phải qua [PR checklist](../.github/pull_request_template.md).
