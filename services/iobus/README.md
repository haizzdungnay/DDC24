# mkddc-iobus

**Người đưa thư UART** — master IOP poll MCU 100Hz, scale raw → engineering, ghi
`/dev/shm/mkddc_io_shm` (seqlock writer duy nhất), đọc `ao_setpoint[]/do_cmd[]` do core
ghi và gửi `SET_AO/SET_DO` xuống MCU. **KHÔNG quyết định logic relay/AO.**

- Contract: [`shared/iop_protocol.h`](../../shared/iop_protocol.h) ·
  [`shared/mkddc_shm.h`](../../shared/mkddc_shm.h) ·
  [15_CONTRACT_FREEZE](../../docs/03_implementation/15_CONTRACT_FREEZE.md)
- Guide: [05_IOP_UART](../../docs/03_implementation/05_IOP_UART_IMPLEMENTATION_GUIDE.md) (protocol) ·
  [06_MKDDC_IOBUS](../../docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) (service)

## Build + test

```bash
cmake -S services/iobus -B build/iobus -DCMAKE_BUILD_TYPE=Release
cmake --build build/iobus -j
ctest --test-dir build/iobus --output-on-failure
```

## Chạy không cần board (fake MCU qua PTY — xem 20_VIRTUAL_COM_DECISION)

```bash
# Cách 1: socat 2 PTY cố định
socat -d -d PTY,raw,echo=0,link=/tmp/mkddc-iop-a PTY,raw,echo=0,link=/tmp/mkddc-iop-b &
./build/iobus/fake_mcu --uart /tmp/mkddc-iop-b &
./build/iobus/mkddc-iobus --uart /tmp/mkddc-iop-a --log-level debug

# Cách 2: fake_mcu tự mở PTY
./build/iobus/fake_mcu --pty            # in ra "pty: /dev/pts/N"
./build/iobus/mkddc-iobus --uart /dev/pts/N --log-level debug

# Kiểm tra SHM sống
./build/iobus/shm_dump_io --watch
```

Checklist 10 bước no-board: [06 §11.1](../../docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md).
