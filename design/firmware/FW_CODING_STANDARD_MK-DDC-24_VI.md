# Firmware Coding Standard — MK-DDC-24
## STM32G0B1 / FreeRTOS / C11

> **Document ID:** STD-FW-CODE-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30
> **Áp dụng:** toàn bộ firmware MCU. Vi phạm rule "MUST" = block merge.
> 📘 [spec/README](../../spec/README.md) · Cơ sở: **MISRA C:2012**, `FW_ARCH §9`

---

## 1. Ngôn ngữ & Toolchain
- **C11**, `arm-none-eabi-gcc 12.x`, `-std=c11 -Wall -Wextra -Werror -Wconversion`.
- Build: STM32CubeIDE 1.15+ hoặc CMake. RTOS: FreeRTOS 10.5.1.
- **Cấm** GNU extension không cần thiết; cấm VLA.

## 2. Tập luật MISRA C:2012 (bắt buộc, tập con)
| Rule | Nội dung |
|------|----------|
| Dir 4.1 | Mọi lỗi runtime phải được xử lý (check return) |
| 8.x | Một định nghĩa/khai báo; `static` cho phạm vi file |
| 10.x | Không trộn kiểu/ép kiểu ngầm; ép kiểu tường minh |
| 11.x | Hạn chế con trỏ ↔ số nguyên; không cast bỏ `const`/`volatile` |
| 14.4 | Điều kiện phải là boolean rõ ràng |
| 15.5 | Một điểm `return` mỗi hàm (khuyến nghị; cho phép early-return guard) |
| 17.x | Không đệ quy; tham số kiểm tra |
| 18.x | Không số học con trỏ ngoài mảng; không VLA |
| 21.3 | **Cấm `malloc/free`** sau khi RTOS start |

> Dùng MISRA checker (cppcheck `--addon=misra` hoặc công cụ thương mại). Lệch rule phải có **deviation record** được Lead duyệt.

## 3. Quy ước đặt tên
| Đối tượng | Quy ước | Ví dụ |
|-----------|---------|-------|
| Hàm/biến | `snake_case` | `iop_send_frame()` |
| Hằng/macro | `UPPER_SNAKE` | `IOP_SOF`, `MAX_RETRY` |
| Kiểu | `snake_case_t` | `io_data_t` |
| ISR | `<peri>_IRQHandler` (CMSIS) | `USART1_IRQHandler` |
| Biến file-static | `s_` prefix | `s_seq_counter` |
| Global (hạn chế) | `g_` prefix | `g_fault_flags` |

## 4. Bộ nhớ & RTOS
- **Không dynamic allocation** sau RTOS start (Rule 21.3). Static/pool only.
- Mỗi task có **stack guard**; kích thước theo `FW_ARCH §2` + đo `uxTaskGetStackHighWaterMark`.
- Chia sẻ dữ liệu liên task: chỉ qua **queue/mutex/critical section** đã định ở `FW_ARCH §2.2`. Cấm biến global không bảo vệ.
- Tài nguyên dùng chung với ISR: `volatile` + critical section ngắn.

## 5. ISR (xem FW_ARCH §3.2)
- ISR < 1 µs; **không** business logic, **không** HAL blocking.
- Chỉ dùng `*FromISR` API + `portYIELD_FROM_ISR`.
- NVIC priority ≥ `configMAX_SYSCALL_INTERRUPT_PRIORITY` (=5) cho ISR gọi RTOS API.

## 6. Xử lý lỗi
- Mọi HAL/driver call check status; lỗi → set `fault_flags` + đường safe-state (xem `IOP-SPEC §6`).
- Magic number cấm — dùng `#define`/`enum`.
- `assert_param` chỉ debug build; release dùng xử lý lỗi chủ động.

## 7. An toàn real-time
- Hot-path (`io_sample_task` 1ms) không I/O blocking, không lock dài.
- Dùng DMA cho SPI/UART (FW-IO-007, IOP-FW-002), không polling busy-wait.
- Watchdog: `watchdog_task` kiểm tra liveness các task trước khi kick IWDG (FW-WDG-003).

## 8. Tài liệu & test
- Doxygen header cho mọi hàm public (`@brief @param @return`).
- Mỗi module có unit test (Unity) chạy trên host cho logic thuần (CRC, scale, FSM).
- CI bắt buộc: build `-Werror`, cppcheck `--enable=all --addon=misra` 0 error (FW_ARCH §9), unit test pass.

## 9. Commit/PR
- Ghi **REQ ID** + **design unit** trong PR (vd "FW-IOP-004 / FW_DDD §4.2").
- PR cần 1 reviewer; thay đổi safe-state/IOP cần FW Lead duyệt.

---
**Rev** 1.0 | 2026-05-30
