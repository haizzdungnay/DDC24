# ADR-010: EasySet Parity Config Surfaces

- Date: 2026-06-23
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
