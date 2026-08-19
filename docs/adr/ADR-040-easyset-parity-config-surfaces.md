# ADR-040: EasySet Parity Config Surfaces
> ## ⚠ ĐỔI SỐ — 2026-08-19
>
> Hồ sơ này **phát hành nhầm số `ADR-010`**, trùng với [ADR-010 — IOP V2 Poll + Capability Map](ADR-010-iop-v2-poll-capability-map.md), vốn được viện dẫn ở `contracts/shm/mkddc_shm.h` và `firmware/stm32/src/iop/iop_link.h`. Số mới cấp phát là
> **`ADR-040`** theo đúng luật ở [Decision Log](../00_governance/DECISIONS.md) ("lấy số cao
> nhất đã cấp phát rồi cộng một").
>
> Decision Log bản 2026-07-22 từng chuẩn hoá hồ sơ này thành `ADR-013`, nhưng **số đó đã bị
> chiếm** từ 2026-07-02 bởi [ADR-013 — Alarm Entity Model](../02_design/adr/ADR-013-alarm-entity-model.md) và **đang được viện dẫn trong hợp đồng
> canonical** `contracts/openapi/openapi.yaml`. Theo quy tắc "hợp đồng thắng tài liệu",
> `ADR-013` giữ nguyên nghĩa cũ và hồ sơ này nhận `ADR-040`.


- Date: 2026-06-22
- Owner: Solution Architect
- Status: Accepted
- Related: ADR-006 (Rev A UI Form JSON), ADR-008, ADR-009

## Context
Bổ sung 5 màn config kiểu EasySet (Alarm/AI/DI/Diagram/Aux) trên surface form Rev A (kế thừa ADR-006).

## Decision
1. Giữ mô hình graph. Các màn config mới là lớp form phủ lên graph/io_map, KHÔNG thay bằng parameter-based đóng khung kiểu EasySet. Wizard chỉ sinh/đọc graph.json + io_config.
2. Pattern demo-local Rev A. Như AlarmSettingsPage: state local + simulator.ts cấp data, nút "Lưu" toast demo. KHÔNG đổi REST/WS contract.
3. Auxiliary Functions = COMPOSE từ node Rev A sẵn có (Compare_GT/LT, PID, AND/OR/NOT, ManualAuto, Interlock, Setpoint, AO/DO_Output...). KHÔNG tạo component runtime mới (Economizer/Occupancy là Rev B). Aux UI chỉ sinh ra cụm node + link rồi ghi vào graph.json, sau đó chạy validateGraphLocal.
4. Doc-first: mỗi phần §A-§F phải cập nhật doc liên quan trước khi/song song khi code.
5. Redo AI = Universal Input, signal type subset 0-4, wire qua `/system/config/io`; defer Presets Load/Save, advanced params u5-u7, DI, VI.

## Consequences
- Aux Economizer/Occupancy thật vẫn defer Rev B; màn này chỉ compose từ node Rev A (có partial cho Economizer).
