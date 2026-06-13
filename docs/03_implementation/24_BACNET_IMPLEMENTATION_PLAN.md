# 24 — BACnet Implementation Plan (S7 #5)
## MK-DDC-24 — BACnet/IP object table + command path + BTL-ready tests

> **Document ID:** IMPL-BACNET-PLAN-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-13
> **Trạng thái:** Active — lấp gap S7 #5, đủ để tách issue/code task
> **Owner:** Dev 2 (core/iobus) + Protocol Lead
> **Đọc cùng:** [SW_BACNET_DESIGN](../02_design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md) ·
> [BACNET_PICS_EPICS](../02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md) ·
> [CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) ·
> [07_CORE](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md) · [15_CONTRACT_FREEZE](15_CONTRACT_FREEZE.md)

---

## 1. Quyết định chốt cho Rev A

| Chủ đề | Quyết định |
|--------|------------|
| Stack | Dùng `bacnet-stack` C làm BACnet/IP server; không tự viết protocol stack. |
| Process boundary | BACnet datalink/callback chạy trong `mkddc-iobus`; core publish `mkddc_plc_shm`. |
| Command path | BACnet WriteProperty không ghi IO trực tiếp; ghi command request vào core ở mức `PRIO_BACNET` (mức 3). |
| Priority bridge | BACnet `Priority_Array[1..16]` giữ đầy đủ ở BACnet side; giá trị thắng theo BACnet được đưa vào core mức 3. |
| Release | BACnet NULL ở priority N = release priority N; khi array rỗng dùng `Relinquish_Default`, rồi core resolve 6 mức. |
| Object source | AI/BI/AO/BO vật lý auto từ 24 IO; AV/BV/MSV từ virtual point/config; ext Modbus expose qua cấu hình. |
| Security | BACnet/IP plaintext theo ASHRAE 135; chỉ bind trusted interface/VLAN, firewall allow UDP 47808 nội bộ. |
| BTL scope | Target B-ASC Rev A; B-BC/schedule/trend nâng cao chỉ khi object/service đầy đủ. |

---

## 2. Kiến trúc triển khai

```text
BACnet/IP UDP 47808
        |
mkddc-iobus/bacnet_server
        |  read object values / write priority array
        v
/dev/shm/mkddc_plc_shm  <----- publish ----- mkddc-core/bacnet_objtable
        |                                      |
        | WriteProperty command                | point values, quality, reliability
        v                                      v
/run/mkddc/core.sock  ---- PRIO_BACNET ----> priority_resolver ----> output_writer
```

Rule:
- `mkddc-core` là nguồn publish giá trị/quality/reliability sang `mkddc_plc_shm`.
- `mkddc-iobus` là endpoint BACnet/IP, xử lý APDU, COV, priority array và alarm event.
- Mọi AO/BO write cuối cùng vẫn đi qua core; không có đường BACnet -> SHM IO trực tiếp.

---

## 3. Object map Rev A

| Object | Count | Read source | Writable | Write path | Reliability |
|--------|------:|-------------|----------|------------|-------------|
| Device | 1 | `device.conf`, runtime version | một số prop | config/admin only | n/a |
| AI1-8 | 8 | UI scaled value từ core | Out_Of_Service | local object flag | UI fault map |
| BI1-8 | 8 | DI state từ core | Out_Of_Service | local object flag | IOP/stale map |
| AO1-4 | 4 | resolved AO + feedback | Present_Value commandable | BACnet array -> core mức 3 | output/state fault |
| BO1-4 | 4 | DO feedback/resolved cmd | Present_Value commandable | BACnet array -> core mức 3 | relay/stale fault |
| AV1-32 | 32 | virtual float points | Present_Value | core virtual/BACnet mức 3 | quality map |
| BV1-16 | 16 | virtual bool points | Present_Value | core virtual/BACnet mức 3 | quality map |
| MSV1-8 | 8 | virtual enum points | Present_Value | core virtual/BACnet mức 3 | quality map |
| Trend Log | 8 | ring buffer/trend config | config | Rev A basic | n/a |
| Notification Class | 4 | alarm bus | Ack | alarm ack path | n/a |

---

## 4. Priority mapping

BACnet priority resolution xảy ra trước, trong BACnet server:

```text
BACnet Priority_Array[1..16]
        -> chọn slot thấp nhất đang non-NULL
        -> nếu không có: Relinquish_Default
        -> gửi value/release vào core với source=bacnet, level=PRIO_BACNET
        -> core so với safety/manual/schedule/logic/default
```

Mapping audit:

| BACnet action | Core action | Audit result |
|---------------|-------------|--------------|
| Write AO/BO/AV/BV/MSV value at priority N | set level 3, kênh/object tương ứng | accepted/overridden/rejected từ core |
| Write NULL at priority N, còn priority khác active | recompute BACnet winner, set level 3 | accepted/overridden |
| Write NULL làm array rỗng | release level 3 | accepted/released |
| Out_Of_Service true | object local override; không bypass safety | audit config/object |
| ReinitializeDevice | restart service/reboot theo quyền | audit admin action |

---

## 5. Module/file cần có

```text
services/iobus/bacnet/
├── bacnet_server.{hpp,cpp}       # init stack, event loop, socket/bind
├── bacnet_config.{hpp,cpp}       # bacnet.conf + device.conf loader
├── bacnet_objects.{hpp,cpp}      # object registry, read/write callbacks
├── bacnet_priority.{hpp,cpp}     # priority[16], relinquish_default
├── bacnet_cov.{hpp,cpp}          # COV subscriptions + change detect
├── bacnet_alarm.{hpp,cpp}        # Notification Class bridge
├── bacnet_reliability.{hpp,cpp}  # quality/fault -> BACnet Reliability/Status_Flags
└── tests/
    ├── test_bacnet_priority.cpp
    ├── test_bacnet_reliability.cpp
    ├── test_bacnet_object_map.cpp
    └── test_bacnet_cov.cpp

services/core/
├── bacnet_objtable.{hpp,cpp}     # publish point values/quality to plc_shm
└── tests/test_bacnet_objtable.cpp
```

---

## 6. Task breakdown

| Task | Nội dung | Output | Test |
|------|----------|--------|------|
| BAC-001 | Chốt build/link `bacnet-stack`, CMake option `MKDDC_ENABLE_BACNET` | target link sạch, version log | build + smoke |
| BAC-002 | `bacnet_config`: `device.conf` + `bacnet.conf` loader | device id/name/port/interface | bad config reject |
| BAC-003 | Object registry AI/BI/AO/BO/AV/BV/MSV | object count/name/instance đúng D-3 | object map test |
| BAC-004 | `bacnet_objtable` publish từ core sang `mkddc_plc_shm` | values, quality, ts, reliability | unit + shm reader |
| BAC-005 | ReadProperty/ReadPropertyMultiple callbacks | BMS đọc values/status | `bacrp`/BTL smoke |
| BAC-006 | WriteProperty commandable + priority[16] | array/relinquish đúng | priority unit + core IPC fake |
| BAC-007 | COV subscribe/change detection | COV notify đúng threshold | COV unit/smoke |
| BAC-008 | Reliability/Status_Flags map | fault -> BACnet flags | reliability table test |
| BAC-009 | Alarm/Notification Class bridge | alarm bus -> BACnet event | fake alarm smoke |
| BAC-010 | TimeSync/ReinitializeDevice policy | time sync guarded, restart safe | integration smoke |
| BAC-011 | BTL pretest script + checklist | repeatable B-ASC pretest | group 9 PASS |

---

## 7. Test plan bổ sung

| Test ID | Mục tiêu | Pass criteria |
|---------|----------|---------------|
| TC-9-01 | Who-Is/I-Am | I-Am phản hồi <=100ms, device instance đúng |
| TC-9-02 | ReadProperty AI/BI/AO/BO | value/unit/status khớp core snapshot |
| TC-9-03 | ReadPropertyMultiple | nhiều object trả đúng, không timeout |
| TC-9-04 | WriteProperty AO/BO priority | BACnet write -> core mức 3 -> output resolved |
| TC-9-05 | Priority release | write NULL -> priority thấp hơn/default active đúng |
| TC-9-06 | Manual/safety override | BACnet write bị manual/safety đè -> audit `overridden` |
| TC-9-07 | Reliability map | UI open/short/stale -> Reliability + Status_Flags đúng |
| TC-9-08 | COV | đổi value vượt increment -> notify; dưới increment -> không spam |
| TC-9-09 | Alarm event | alarm bus event -> Notification Class event |
| TC-9-10 | BTL pretest | B-ASC smoke pass; log lưu vào evidence |

---

## 8. Definition of Done S7 #5

```
[ ] `MKDDC_ENABLE_BACNET=ON` build sạch.
[ ] BACnet/IP bind đúng interface/port từ config; không bind WAN nếu không cấu hình.
[ ] Who-Is/I-Am, ReadProperty, ReadPropertyMultiple PASS.
[ ] AI/BI/AO/BO/AV/BV/MSV map đúng object count + instance + name.
[ ] AO/BO/AV/BV/MSV commandable dùng Priority_Array[16] + Relinquish_Default.
[ ] BACnet write đi vào core mức 3; safety/manual cao hơn vẫn thắng.
[ ] Reliability/Status_Flags map từ quality/fault đúng.
[ ] COV hoạt động, không spam quá ngưỡng.
[ ] Alarm bridge hoạt động tối thiểu với Notification Class.
[ ] BTL pretest log lưu trong `docs/00_management/evidence/`.
```

---

## 9. Rủi ro và kiểm soát

| Rủi ro | Mức | Kiểm soát |
|--------|-----|-----------|
| Stack API khác version | Trung bình | pin version trong build docs, smoke test `bacrp/bacwp` |
| Priority 16 mức lệch core 6 mức | Cao | unit test BAC-006 + audit overridden |
| BACnet plaintext LAN | Trung bình | firewall/VLAN, bind interface, docs security residual risk |
| BTL scope quá rộng | Cao | Rev A target B-ASC; trend/schedule nâng cao chỉ khi code đủ |

---
**Rev** 1.0 | 2026-06-13 — tạo plan S7 #5 code-ready
