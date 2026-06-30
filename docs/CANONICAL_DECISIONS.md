# Canonical Decisions — MK-DDC-24

> **Trạng thái:** Canonical · **Cập nhật:** 2026-06-30
> Đây là bản chốt 1 trang. Khi bất kỳ tài liệu nào nói khác → **theo file này** và
> [PRODUCT_DEFINITION](01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md). Nguồn chi tiết:
> [REVA_SCOPE_ROADMAP](01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md),
> [BMS_EDGE_STRATEGY](01_specs/BMS_EDGE_STRATEGY_MK-DDC-24_VI.md), [ADR-004..010](adr/).

## Product Direction
MK-DDC-24 là **Component-Based BMS Edge Automation Controller** (ADR-008) — runtime điều
khiển component, local-first, kiêm vai trò gateway Modbus↔BACnet. **HVAC là use-case đầu
tiên, không phải giới hạn sản phẩm** (domain: HVAC, pump/water, lighting, energy, environment,
alarm/interlock, gateway, data acquisition). Rev A **không** phải IEC 61131-3 PLC.

## Runtime Architecture
Rev A runtime contains **three processes** (ADR-005):
- `mkddc-core` — graph execution, component scheduler, priority/safe-state, BACnet object table
- `mkddc-iobus` — STM32/IO (IOP) protocol, UI/DO/AO scan, optional-SKU DI reservation, Modbus RTU/TCP, BACnet/IP datalink
- `mkddc-web` — REST API, configuration UI (form/JSON), import/export `graph.json`, validator (library)

## Rev A Scope (Rev A.0 = demo-grade / lab-grade)
- Fixed component set = **28 types** (ADR-008: +Interlock, AlarmDelay, RuntimeCounter, PulseCounter).
- Acceptance = **3-domain demo** (HVAC mini · Pump/Water · Energy/Gateway), each local-first + stale/fallback.
- **No** BTL certification target in Rev A.0.
- **No** IEC 61131-3 runtime in Rev A.0.
- **No** full Web IDE canvas (wiresheet) in Rev A.0 — config is form + `graph.json` import/export.
- Local HMI is included by the accepted 2026-06-27 Rev A amendment; OTA and MQTT/cloud agent remain deferred.

## Rev A Hardware and IOP Baseline

- Base SKU = **16 UI + 4 AO + 4 DO**; no populated industrial DI channels.
- UI dry-contact mode is auxiliary and non-isolated. Industrial DI requires the optional isolated-DI SKU/module and capability bit.
- ADR-010 is the interface authority: IOP v2 poll model, 2ms/500Hz GET_IO, 74-byte IO_RESP, signed int32 UI raw data, and `BOARD_CAP_MAP=0x000D` for the base SKU.

## Superseded Terms
Các thuật ngữ sau là **legacy** trừ khi được đánh dấu rõ Rev B/Rev C:
- `kinexus-plc`, `kinexus-agent`, `kinexus-webide`, `kinexus-hmi`, `kinexus-ota`
- IEC 61131-3 PLC runtime
- FBD/ST Web IDE
- BACnet MS/TP, Modbus slave (đã bỏ theo ARCH-R010)

## Naming
Service Rev A: `mkddc-core` / `mkddc-iobus` / `mkddc-web`.
Shared-memory storage still reserves DI slots for compatible optional SKUs; base-SKU software must hide or mark them unsupported according to `BOARD_CAP_MAP` (ADR-010).

## Conflict Rule
Nếu hai tài liệu mâu thuẫn về hướng sản phẩm/kiến trúc/scope → **Product Definition + file này thắng**.
Mọi PR tài liệu phải qua [PR checklist](../.github/pull_request_template.md).
