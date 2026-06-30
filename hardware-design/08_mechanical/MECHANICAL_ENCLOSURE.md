# MECHANICAL ENCLOSURE — DIN-Rail Mounting

> **Document:** ME-MECH-01 | Rev 1.2 | Status: Draft | 2026-06-30
> **Sản phẩm:** MK-DDC-24 DIN-rail Enclosure
> **Phiên bản:** HW-MECH v1.2 | 2026-06-30
> **Trạng thái:** Draft for Review
> **Tổ chức:** MK-DDC Project — Mechanical Team

---

## 1. Tổng quan

Enclosure DIN-rail MK-DDC-24 được thiết kế cho ứng dụng công nghiệp, lắp đặt dễ dàng trên DIN-rail tiêu chuẩn 35mm. Thiết kế tối ưu cho:
- Làm mờ tự nhiên (convection cooling)
- Truy cập dễ dàng cho đấu nối và bảo trì
- Bảo vệ IP20 theo IEC 60529
- Chống rung cơ học theo IEC 60068-2-6

### 1.1 Yêu cầu Đầu vào

| Parameter | Giá trị | Ghi chú |
|-----------|---------|---------|
| Kích thước PCB carrier | 100×80mm (Radxa CM3 + STM32) | Cộng connector 120×90mm |
| Weight carrier board | ~150g | Không bao gồm terminal blocks |
| Operating temperature | -20°C to +60°C | Công nghiệp |
| Mounting | DIN-rail 35mm TS 35 | IEC 60715 |
| IP Rating | IP20 | Không bụi, không nước |

---

## 2. Thiết kế Vỏ

### 2.1 Kích thước Tổng thể

```
        ┌─────────────────────────────────────┐
        │              TOP COVER               │
        │                                     │
        │  ┌─────────────────────────────┐    │
        │  │       PCB MOUNTING         │    │
        │  │        AREA                │    │
        │  │                           │    │
        │  │    ┌─────────────────────┐ │    │
        │  │    │    RADXA CM3 +       │ │    │
        │  │    │    STM32G0B1RB      │ │    │
        │  │    │                     │ │    │
        │  │    │                     │ │    │
        │  │    └─────────────────────┘ │    │
        │  │                           │    │
        │  └─────────────────────────────┘    │
        │                                     │
        │ ┌─────────────────────────────────┐ │
        │ │      TERMINAL BLOCKS           │ │
        │ │ (20-pin UI + 10-pin AO/DO/RS485)│ │
        │ └─────────────────────────────────┘ │
        └─────────────────────────────────────┘
```

| Dimension | mm | Description |
|-----------|----|-------------|
| W | 180 | Width (including terminal blocks) |
| H | 120 | Height (including DIN-rail clip) |
| D | 85 | Depth (front to back) |
| DIN-rail cutout | 35×7mm | Standard TS 35 profile |

### 2.2 Vật liệu

| Component | Material | Thickness | Coating | Notes |
|-----------|----------|-----------|---------|-------|
| Case body | ABS Plastic | 2.0mm | Gray RAL 7035 | UL94-V0 flame retardant |
| Front panel | ABS Plastic | 3.0mm | Dark Gray RAL 7021 | Laser engraved labels |
| DIN-rail clip | Stainless Steel | 1.5mm | Passivated | M4 mounting screws |
| Terminal block cover | Polycarbonate | 1.0mm | Transparent | IP20 rating |

### 2.3 Chi tiết Cơ khí

#### 2.3.1 Lắp đặt PCB

- 4 vị trí mounting holes Ø3.2mm
- PCB mount height: 15mm (từ vỏ đến mặt sau PCB)
- Heat dissipation pads dưới PCB
- No direct contact between PCB and metal parts

#### 2.3.2 Terminal Blocks

- Front-mounted terminal blocks
- UI inputs: 20-pin Phoenix Contact PTMC 5.08mm
- AO/DO/RS485: 10-pin Phoenix Contact PTMC 5.08mm
- Terminal covers included (removable)
- Wire gauge: 0.5mm² - 2.5mm²

#### 2.3.3 Vents & Cooling

- Front vents: 2× slots 100×3mm
- Side vents: 4× slots 50×2mm
- Top vents: 2× slots 150×2mm
- Natural convection: >5 CFM airflow
- Max temp rise: <15°C above ambient

#### 2.3.4 Service/debug access and cable management

- Provide factory access to the 5-pin SWD header (PA13/PA14/NRST/3V3/GND) and debug UART without removing the PCB from the DIN-rail base.
- The production enclosure must cover or tamper-seal debug access; no externally accessible opening may defeat IP20 or the production debug-disable policy.
- Reserve probe/cable clearance around SWD, UART, USB-C, RS-485, power, UI, AO, and DO connectors in the 2D drawing and STEP model.
- Rev A uses front pluggable terminal blocks in an IP20 cabinet and therefore does not require sealed cable glands. Installation drawings must specify wire duct clearance, bend radius, ferrules, strain relief, and terminal-cover retention. Any variant claiming a higher IP rating requires separately specified glands/grommets and a new ingress test.

---

## 3. Kết nối Cơ học

### 3.1 DIN-rail Mounting

- Spring-loaded DIN-rail clip
- Secure retention force: >100N
- Anti-vibration stops
- Quick-release feature for maintenance

### 3.2 Mounting Screws

- M4×20mm stainless steel screws
- Thread depth: 8mm minimum
- Torque: 4-6 Nm
- Anti-loosen washers included

---

## 4. Khắc Nhãn

### 4.1 Front Panel Labels

```
┌─────────────────────────────────────────┐
│                                         │
│     MK-DDC-24                           │
│     VER 1.0                            │
│                                         │
│  ┌─────────┐ ┌─────────┐              │
│  │  UI 1-8  │ │  UI 9-16 │              │
│  │ INPUTS   │ │ INPUTS   │              │
│  └─────────┘ └─────────┘              │
│                                         │
│  ┌─────────┐ ┌─────────┐              │
│  │   AO     │ │   DO     │              │
│  │OUTPUTS   │ │RELAY     │              │
│  └─────────┘ └─────────┘              │
│                                         │
│  ┌─────────┐                          │
│  │  RS485   │                          │
│  │   COM    │                          │
│  └─────────┘                          │
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │   PWR   │ │   STATUS │ │   ERROR │  │
│  │  LED     │ │  LED     │ │  LED    │  │
│  └─────────┘ └─────────┘ └─────────┘  │
└─────────────────────────────────────────┘
```

### 4.2 Side Panel Labels

- Power input: "24VAC/VDC MAX 2A"
- Warning: "HIGH VOLTAGE - DISCONNECT BEFORE OPENING"
- Mounting arrows
- IP20 rating mark

---

## 5. Bảo trì & Thay thế

### 5.1 Access Procedures

1. Loại bỏ DIN-rail clip (release tab)
2. Open top cover (hinged design)
3. Access terminal block covers
4. PCB removal: disconnect cables → unscrews

### 5.2 Maintainable Components

| Component | Lifetime | Replacement |
|-----------|----------|-------------|
| Terminal blocks | 10 years | Field replaceable |
| LED indicators | 50,000 hrs | PCB mounted |
| DIN-rail clip | 20 years | Integrated |

---

## 6. Test & Validation

### 6.1 Environmental Tests

| Test | Standard | Pass Criteria |
|------|----------|---------------|
| Temperature cycling | IEC 60068-2-14 | -40°C to +85°C, 20 cycles |
| Vibration | IEC 60068-2-6 | 5-500Hz, 0.5mm amplitude |
| Drop | IEC 60068-2-32 | 1.2m concrete floor |
| IP Rating | IEC 60529 | IP20 verified |

### 6.2 Mechanical Stress Tests

- Static load: 50kg evenly distributed
- Impact test: 5J impact on corners
- Twist test: 10° twist on DIN-rail mount
- Lid opening force: <30N

### 6.3 Enclosure thermal validation

Test at minimum, nominal, and maximum declared ambient with the final enclosure, vents, CM3 heatsink, and production PCB orientation.

| Operating case | Required measurements |
|---|---|
| Idle | Ambient/inlet/outlet air, CM3, +5V/+3.3V/+15V converters |
| CPU/network load | CM3/PMIC/heatsink, enclosure rise, Ethernet/USB area |
| Full I/O | All 16 UI active, four AO at worst load, four relay coils energized, RS-485/Ethernet active |
| Switching stress | Relay cycling plus CM3 load steps; monitor ADC/reference/UI noise and regulator hot spots |

Pass only when every component remains inside its derated limit, enclosure rise is <=15C, no thermal shutdown/reset occurs, and the report includes thermal images, sensor locations, load configuration, ambient, dwell time, and final temperatures. CFD may guide the design but does not replace prototype measurement.

---

## 7. CAD Files & Manufacturing

### 7.1 CAD Files

- 3D model: SolidWorks 2023 (.sldasm, .sldprt)
- 2D drawings: PDF + DXF
- STEP files for compatibility

### 7.2 Material Specifications

- ABS: ISO 2896, Glow rating UL94-V0
- Polycarbonate: ISO 7391, Impact resistant
- Stainless steel: AISI 304, passivated
- Terminal blocks: IEC 60947-7-1

### 7.3 Bill of Materials (Mechanical)

| Item | Part No. | Description | Qty |
|------|----------|-------------|-----|
| Case Body | MK-ENC-001 | ABS enclosure 180×120×85mm | 1 |
| Top Cover | MK-COV-001 | Hinged cover with vents | 1 |
| DIN-rail Clip | MK-CLIP-001 | Spring-loaded steel clip | 1 |
| Terminal Block Cover | MK-COV-002 | Transparent polycarbonate | 2 |
| Label Kit | MK-LBL-001 | Front panel engraved | 1 |
| Mounting Screws | M4×20SS | Stainless steel with washers | 4 |

---

## 8. Đối chiếu với Yêu cầu

| Requirement | Status | Reference |
|-------------|--------|-----------|
| DIN-rail mounting | ✅ | IEC 60715 TS 35 |
| IP20 protection | ✅ | IEC 60529 |
| Temperature range -20°C to +60°C | ✅ | Natural convection |
| Terminal blocks accessible | ✅ | Front-mounted design |
| Weight <500g | ✅ | Estimated 450g |
| Vibration resistance | ✅ | IEC 60068-2-6 |

---

## Lịch sử Revision

| Ngày | Rev | Thay đổi |
|------|-----|---------|
| 2026-06-23 | v1.1 | Final rev bump Phase 1-2: Verified thermal management for 16ch UI, updated terminal block layout |
| 2026-06-23 | v1.0 | Khởi tạo — thiết kế enclosure DIN-rail MK-DDC-24 |
| 2026-06-30 | v1.2 | Added controlled debug access, cable/strain-relief rules, and objective enclosure thermal validation |

---

_Document ID: ME-MECH-01 | Rev 1.2 | 2026-06-30_
