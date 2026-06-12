# mkddc-core

**Bộ não quyết định** — đọc IO qua `kx_io_shm` (seqlock reader), resolve priority 6 mức,
áp safe-state, ghi `ao_setpoint[]/do_cmd[]` (writer duy nhất 2 field này). Mọi DO/AO
PHẢI đi qua priority resolver. **KHÔNG mở UART, KHÔNG scale raw, KHÔNG serve HTTP.**

- Contract: [`shared/mkddc_shm.h`](../../shared/mkddc_shm.h) ·
  [15_CONTRACT_FREEZE](../../docs/03_implementation/15_CONTRACT_FREEZE.md)
- Guide: [07_MKDDC_CORE](../../docs/03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md)

Rev A: `graph_runtime` đã implement (subset: AI/DI/Setpoint/AND/OR/NOT/Compare_GT/LT/
Scale/Limit/PID/AO/DO — load/validate/topo/execute → resolver mức 5). `web_ipc` /
`bacnet_objtable` còn là **stub có interface thật** (07 §0) — thay implementation sau,
không đổi API.

Safety: trigger matrix 07 §5.2 đủ T1/T2/T3/T6/T7. `io_safe_state.conf` cấu hình
**default mức 6** (safe_state_config); safety action khi fault CỐ ĐỊNH 0V/4mA/open.
E2E 3 lớp safety no-board: `./tools/test_safety_e2e.sh`.

## Build + test

```bash
cmake -S services/core -B build/core -DCMAKE_BUILD_TYPE=Release
cmake --build build/core -j
ctest --test-dir build/core --output-on-failure
```

## Chạy dev (sau khi iobus + fake MCU đã chạy — xem iobus/README.md)

```bash
./build/core/mkddc-core --log-level debug --sock /tmp/mkddc-core.sock
# point table phản ánh UI ramp của fake MCU; ghi DO qua web_ipc:
# echo '{"id":1,"op":"write","point":"DO1","value":1,"source":"manual","user":"dev"}' | nc -U /tmp/mkddc-core.sock
```
