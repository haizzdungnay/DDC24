# Báo cáo Physical I/O và HIL

**ID:** DDC24-PHYSICAL-IO-HIL-2026-08-03
**Ngày:** 2026-08-03
**Nguyên tắc bằng chứng:** host unit test/fake MCU không được ghi thành HIL hoặc safe-state vật lý

## As-Built source firmware

Firmware có runtime IOP portable tại `fw/src/app/ddc24_runtime.*` và được nối vào `fw/Core/Src/main.c` qua HAL boundary:

- UART receive/feed frame IOP;
- input sampling DI/UI/AI;
- output apply DAC/AO và relay/DO;
- CRC/length/duplicate frame diagnostics;
- communication watchdog;
- startup safe-state;
- safe timeout **200 ms**;
- fault bits/counter reporting.

HAL hiện là weak hook để platform STM32 override. Repository chưa có BSP production chứng minh ADC/DAC/GPIO/UART thật đã được bind đúng pin/peripheral của board DDC-24.

## Test source đã thực hiện

| Test | Loại | Kết quả |
|---|---|---|
| IOP frame/CRC/parser | host unit | PASS |
| startup safe-state | host unit | PASS |
| sample input và apply output callback | host unit | PASS |
| watchdog 200 ms từ frame SET hợp lệ gần nhất | host unit | PASS |
| bad CRC/duplicate/fault diagnostics | host unit | PASS |
| build Cortex-M0+ bằng `arm-none-eabi-gcc` | cross-build | PASS |
| iobus ↔ fake MCU | simulator/SOM hiện hữu | PASS ở baseline cũ; không phải HIL |

## Ma trận HIL bắt buộc

| Kịch bản | Thiết bị đo/cơ cấu thật | Kết quả | Gate |
|---|---|---|---|
| DI đóng/mở | Chưa nối | Chưa chạy | OPEN |
| UI resistance/voltage mode | Chưa nối | Chưa chạy | OPEN |
| AI sampling/ADC range | Chưa nối | Chưa chạy | OPEN |
| DO relay đóng/cắt và feedback | Chưa nối | Chưa chạy | OPEN |
| AO DAC 0–10 V/4–20 mA | Chưa nối | Chưa chạy | OPEN |
| Mất UART | Target đang dùng pseudo-TTY fake MCU | Chưa chạy trên UART thật | OPEN |
| SOM mất kết nối | Chưa nối MCU thật | Chưa chạy | OPEN |
| MCU reset | Chưa flash/điều khiển reset MCU thật | Chưa chạy | OPEN |
| Frame CRC lỗi trên dây | Chỉ có host injection | Chưa chạy vật lý | OPEN |
| Reboot SOM | Service recovery đã đo; output vật lý chưa đo | Một phần | OPEN |
| Power-cycle toàn bộ | Chưa có phiên điều khiển nguồn | Chưa chạy | OPEN |
| Safe-state thật ≤200 ms | Chỉ có host timing logic | Chưa đo oscilloscope/DAQ | OPEN |

## Hiện trạng target

- `mkddc-iobus` dùng endpoint fake MCU `/tmp/mkddc-iop-a` qua systemd drop-in.
- `/dev/ttyS9` tồn tại nhưng không phải bằng chứng iobus đang nói chuyện với STM32.
- `io_shm` trên target có layout 1304 byte của binary cũ; source mới dùng layout mở rộng 1816 byte.
- Không flash firmware mới lên MCU và không deploy dirty build lên SOM để tránh tạo deployment không truy được về commit sạch.

## Recovery service đã đo

`SIGKILL` có kiểm soát cho core/iobus/web đều được systemd restart, thời gian quan sát 1.6–1.8 giây và service trở lại active. Kết quả này đóng phần process recovery, không đóng safe-state vật lý: không có relay/DAC thật được quan sát trong lúc process hoặc UART mất.

## Điều kiện đóng HIL

- bind weak HAL vào STM32 BSP/pinmap được review;
- có fixture DI/UI/AI/DO/AO và thiết bị đo đã hiệu chuẩn;
- capture UART/logic analyzer cùng timestamp output;
- chạy đủ ma trận trên ít nhất một board DDC-24 thật;
- đo safe-state ≤200 ms và trạng thái sau reboot/power-cycle;
- lưu firmware hash, SOM binary hash, config revision/checksum và raw log vào test evidence.

```text
FIRMWARE_HOST_BASELINE = YES
FIRMWARE_ARM_BUILD = YES
PHYSICAL_IO_HIL_COMPLETE = NO
PHYSICAL_IO_READY = NO
```
