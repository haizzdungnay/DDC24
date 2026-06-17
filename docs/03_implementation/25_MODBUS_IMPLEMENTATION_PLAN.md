# 25 — Modbus Implementation Plan (S7 #6)
## MK-DDC-24 — Modbus RTU master + device profile + ext cache

> **Document ID:** IMPL-MODBUS-PLAN-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-16
> **Trạng thái:** Active — lấp gap S7 #6, đủ để tách issue/code task
> **Owner:** Dev 2 (iobus) + Protocol Lead
> **Đọc cùng:** [SW_FIELDBUS_DESIGN](../02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md) ·
> [MODBUS_REGISTER_MAP](../02_design/interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md) ·
> [CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) ·
> [06_IOBUS](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) · [15_CONTRACT_FREEZE](15_CONTRACT_FREEZE.md)

---

## 1. Quyết định chốt cho Rev A

| Chủ đề | Quyết định |
|--------|------------|
| Vai trò | MK-DDC-24 là Modbus RTU **master** trên RS-485; không làm Modbus slave northbound. |
| Library | Dùng `libmodbus` C/C++ wrapper trong `mkddc-iobus`; không dùng Python runtime production. |
| Process boundary | Modbus chạy trong `mkddc-iobus`, priority thường, không SCHED_FIFO. |
| Config | `fieldbus.conf` + profile JSON; thêm device bằng profile, không hard-code. |
| Data model | Slave data vào ext cache trong iobus; core đọc snapshot ở ranh giới scan. |
| Write path | Core/BACnet/Web set ext write request; iobus ghi xuống slave vòng poll kế. |
| Quality | Timeout/retry lỗi -> điểm ext `STALE/BAD`, alarm E302/E303. |
| Scope Rev A | RTU master một bus, FC01/02/03/04 read, FC05/06/15/16 write, 16 slave smoke. |

---

## 2. Kiến trúc triển khai

```text
RS-485 Modbus RTU slaves
        |
mkddc-iobus/fieldbus_master
        | poll/decode/write
        v
Ext cache snapshot  ---- read ----> mkddc-core point table / graph
        ^                              |
        | pending writes                | output/command resolve
        +--------- write request -------+
```

Rule:
- Modbus không điều khiển DO/AO vật lý trực tiếp.
- Ext input từ slave mang `value + quality + timestamp + slave_id`.
- Ext output/write xuống slave chỉ xuất phát từ core-resolved command hoặc config test tool có audit.

---

## 3. Ext cache contract Rev A

Nếu `shared/mkddc_shm.h` chưa có vùng ext chính thức, triển khai Rev A dùng cache nội bộ iobus + IPC/read API cho core. Chỉ thêm shared contract khi cần expose đa process bền vững.

```cpp
struct ExtPointValue {
    char id[32];
    float value;
    uint8_t type;      // bool/int/float enum
    uint8_t quality;   // GOOD/STALE/BAD
    uint16_t slave_addr;
    uint64_t ts_ns;
};

struct ExtWriteRequest {
    char id[32];
    float value;
    uint8_t pending;
    uint8_t result;    // OK/TIMEOUT/EXCEPTION/REJECTED
};
```

Contract rule:
- `id` format: `EXT-<slave-name>.<point-name>[index]`, ví dụ `EXT-1.DI[0]`.
- Cache update atomic theo slave poll result; không nửa block.
- Core thấy stale nếu `now - ts_ns > max(3*poll_ms, 5s)` hoặc quality BAD.

---

## 4. Profile parser

Profile JSON tối thiểu:

```json
{
  "profile_id": "generic-power-meter",
  "default_baud": 19200,
  "points": [
    {"name":"kWh", "count":1, "fc":4, "addr":1000,
     "type":"float32", "scale":1.0, "offset":0.0,
     "byte_order":"ABCD", "map_to":"ext.ai"}
  ]
}
```

Validate fail-fast khi:
- `fc` không thuộc 1/2/3/4/5/6/15/16.
- `addr/count` ngoài 0..65535 hoặc block quá 125 register / 2000 coil.
- `type` không khớp `count`.
- `byte_order` thiếu cho 32-bit.
- `writable=true` nhưng FC không ghi được.

---

## 5. Module/file cần có

```text
services/iobus/fieldbus/
├── modbus_master.{hpp,cpp}       # libmodbus context, RS-485 open/close
├── fieldbus_config.{hpp,cpp}     # fieldbus.conf loader/reload
├── device_profile.{hpp,cpp}      # JSON profile parser/validator
├── poll_scheduler.{hpp,cpp}      # poll timing, retry, offline detect
├── register_codec.{hpp,cpp}      # endian/type/scale encode/decode
├── ext_cache.{hpp,cpp}           # value cache + quality + pending writes
├── fieldbus_metrics.{hpp,cpp}    # per slave counters/status
└── tests/
    ├── test_device_profile.cpp
    ├── test_register_codec.cpp
    ├── test_poll_scheduler.cpp
    ├── test_ext_cache.cpp
    └── test_modbus_master_fake.cpp
```

---

## 6. Task breakdown

| Task | Nội dung | Output | Test |
|------|----------|--------|------|
| MOD-001 | CMake/link `libmodbus`, option `MKDDC_ENABLE_MODBUS` | build sạch | build smoke |
| MOD-002 | `fieldbus.conf` loader/reload | rs485/slaves/poll config | config tests |
| MOD-003 | `device_profile` parser/validator | profiles chuẩn + custom | parser tests |
| MOD-004 | `register_codec` | bool/int/uint/float32 scale/endian | codec vectors |
| MOD-005 | `poll_scheduler` | due-time, retry, offline | scheduler unit |
| MOD-006 | RTU master read blocks FC01/02/03/04 | ext cache update | fake slave integration |
| MOD-007 | Write FC05/06/15/16 | pending write result | fake slave write tests |
| MOD-008 | Metrics/alarm E302/E303 | REST/status source + alarm | fault injection |
| MOD-009 | Core ext point read path qua `fieldbus.sock` (UNIX datagram) | core nhận snapshot → `plc_shm.ext[]`; graph đọc ext BAD → fallback | core integration; TC-10-08 |
| MOD-010 | BACnet expose ext points theo `expose_bacnet/bacnet_object_type/bacnet_instance` trong profile | AV/BV/AI tạo đúng instance; conflict log ERROR+skip | object map test; D-2 §3 |
| MOD-011 | 16-slave timing smoke | stable poll budget | group 10 PASS |

---

## 7. Test plan bổ sung

| Test ID | Mục tiêu | Pass criteria |
|---------|----------|---------------|
| TC-10-01 | Profile parser | valid profile load; invalid fc/type/count reject rõ lỗi |
| TC-10-02 | Register codec | endian/scale vectors đúng |
| TC-10-03 | RTU read FC01/02/03/04 | fake slave data -> ext cache đúng |
| TC-10-04 | RTU write FC05/06/15/16 | pending write -> slave value đổi + result OK |
| TC-10-05 | Timeout/retry/offline | retry 2, offline, quality BAD, alarm E302 |
| TC-10-06 | Bus error rate | lỗi >10% -> E303, service không crash |
| TC-10-07 | 16 slave poll | poll đúng lịch, không starve slave chậm |
| TC-10-08 | Core graph đọc ext | ext BAD -> graph safe/fallback |
| TC-10-09 | Config reload | SIGHUP không đổi baud reload hot; đổi baud yêu cầu restart rõ log |
| TC-10-10 | Board RS-485 smoke | thiết bị thật đọc/ghi ổn định 1h |

---

## 8. Definition of Done S7 #6

```
[ ] `MKDDC_ENABLE_MODBUS=ON` build sạch với `libmodbus`.
[ ] `fieldbus.conf` load/reject/reload đúng.
[ ] Profile JSON validate đầy đủ; không crash khi profile lỗi.
[ ] FC01/02/03/04 read pass với fake slave và ít nhất 1 slave thật.
[ ] FC05/06/15/16 write pass với fake slave và thiết bị thật nếu có writable point.
[ ] Ext cache cập nhật value/quality/timestamp atomic.
[ ] Timeout/retry/offline -> quality BAD + alarm E302; bus error rate -> E303.
[ ] Core đọc ext point được; graph fallback khi ext BAD.
[ ] 16 slave poll smoke pass; 1h không crash.
[ ] Không có đường Modbus write bypass core/priority cho output nội bộ.
```

---

## 9. Rủi ro và kiểm soát

| Rủi ro | Mức | Kiểm soát |
|--------|-----|-----------|
| Slave chậm làm trễ iobus hot path | Cao | fieldbus loop priority thường, timeout budget, không chặn IOP 100Hz |
| Profile sai gây decode sai | Trung bình | parser strict + profile unit tests |
| RS-485 nhiễu/termination lỗi | Trung bình | E303 + bench 1h + wiring guide |
| Ext contract đổi SHM | Trung bình | Rev A cache nội bộ; chỉ bump `mkddc_shm.h` khi cần shared ext stable |

---
**Rev**
1.1 | 2026-06-16 — close FB-Q-001 (libmodbus confirmed) + FB-Q-002 (expose_bacnet per-profile); cập nhật MOD-009 (fieldbus.sock → plc_shm ext IPC API) + MOD-010 (3 field profile BACnet) theo SW_FIELDBUS_DESIGN Rev 1.2 + D-2 Rev 2.1
1.0 | 2026-06-13 — tạo plan S7 #6 code-ready
