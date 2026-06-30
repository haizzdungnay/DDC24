# Firmware Architecture Specification — MK-DDC-24
## MCU STM32G0B1RBT6 / FreeRTOS

> **Document ID:** FW-ARCH-MK-DDC-24-VI  
> **Phiên bản:** 2.0 | 2026-06-30
> **Trạng thái:** In-Review — aligned to ADR-010
> 📘 **Đọc cùng:** [README](README.md) — hướng dẫn + glossary · Đã đồng bộ **2026-05-30** (xem [REVIEW](DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md))  
> **Tác giả:** KINEXUS Technologies — Firmware Team

---

## 1. Tổng quan Kiến trúc

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STM32G0B1RBT6 — FreeRTOS                         │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Application Tasks                         │   │
│  │                                                              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │   │
│  │  │ iop_comm     │  │ ao_output    │  │ do_control        │  │   │
│  │  │ task         │  │ task         │  │ task              │  │   │
│  │  │ Pri=6 T=10ms │  │ Pri=6 T=10ms │  │ Pri=6 T=10ms      │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │   │
│  │         │                 │                    │             │   │
│  │  ┌──────▼───────────────────────────────────────▼──────────┐ │   │
│  │  │              io_sample_task                              │ │   │
│  │  │              Pri=7, T=1ms (highest)                      │ │   │
│  │  └──────────────────────────────────────────────────────────┘ │   │
│  │                                                              │   │
│  │  ┌────────────────────┐  ┌──────────────────────────────┐   │   │
│  │  │ diagnostics_task   │  │ watchdog_task                │   │   │
│  │  │ Pri=2, T=1000ms    │  │ Pri=1, T=500ms               │   │   │
│  │  └────────────────────┘  └──────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Driver / HAL Layer                        │   │
│  │  uart_dma_drv │ spi_adc_drv │ spi_dac_drv │ gpio_drv        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    STM32 HAL / LL                            │   │
│  │  USART1-DMA │ SPI1-DMA(DAC) │ SPI3-DMA(ADC) │ TIM2 │ IWDG   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
          │                    │                    │
       UART2               SPI3-DMA            SPI1-DMA
      ADUM1201            ADS131M08            DAC8554
     (IOP → SOM)         (ADC 24-bit)         (DAC 16-bit)
```

---

## 2. FreeRTOS Task Model

### 2.1 Task Catalog

| Task Name | Priority | Period | Stack | Deadline | Mô tả |
|-----------|:--------:|:------:|:-----:|:--------:|-------|
| `io_sample_task` | 7 (High) | 1 ms | 512 B | 1 ms | Sample 2× ADC for UI1-UI16 and update status |
| `iop_comm_task` | 6 | Event-driven | 512 B | 3 ms response timeout | IOP v2 UART protocol, TX/RX frame |
| `ao_output_task` | 6 | 10 ms | 256 B | 10 ms | Apply AO values to DAC8554 |
| `do_control_task` | 6 | 10 ms | 256 B | 10 ms | Relay control, feedback check |
| `diagnostics_task` | 2 | 1000 ms | 256 B | 1000 ms | MCU temp, VDD, counters |
| `watchdog_task` | 1 | 500 ms | 128 B | 500 ms | Task health check + IWDG kick |

> **Quy tắc:** Priority PHẢI theo thứ tự trên. Không được assign cùng priority cho io_sample_task và các task khác.

### 2.2 Priority Ceiling & Inheritance

| Resource | Protected By | Tasks có quyền truy cập |
|---------|-------------|------------------------|
| `io_data_buf` (ADC snapshot) | Mutex `xIoDataMutex` | io_sample (W), iop_comm (R) |
| `ao_setpoint[4]` | Queue `xAoQueue` depth=1 | iop_comm (W), ao_output (R) |
| `do_cmd` | Queue `xDoQueue` depth=1 | iop_comm (W), do_control (R) |
| `fault_flags` | Critical section (taskENTER_CRITICAL) | io_sample (W), iop_comm (R+W), diagnostics (R) |
| `diag_counters` | Mutex `xDiagMutex` | iop_comm (W), diagnostics (R+W) |

### 2.3 Scheduling Strategy

- **Preemptive FreeRTOS** với time-slicing tắt cho tasks cùng priority (chỉ preemption)
- `io_sample_task` driven bởi **TIM2 hardware interrupt** (1ms, period timer) — dùng `xTaskNotifyFromISR`
- `iop_comm_task` driven bởi **UART IDLE interrupt + DMA TC interrupt** — wake on received frame
- `ao_output_task` và `do_control_task`: periodic sleep/wake qua `vTaskDelayUntil`

---

## 3. Interrupt Strategy

### 3.1 Interrupt Priority Table (NVIC)

| Interrupt | NVIC Priority | Mô tả |
|-----------|:-------------:|-------|
| `TIM2_IRQn` (1ms timer) | 5 | Trigger io_sample_task |
| `DMA1_Channel2_3_IRQn` (USART1 RX DMA) | 5 | IOP frame reception |
| `DMA1_Channel4_5_6_7_IRQn` (USART1 TX DMA) | 6 | IOP frame transmission complete |
| `DMA1_Channel1_IRQn` (SPI3/ADC RX) | 4 | ADC data ready |
| `WWDG_IRQn` | 0 (Non-maskable) | Window watchdog early warning |
| `USART1_IRQn` (IDLE line) | 5 | Frame end detection |

> **Quy tắc:** Không sử dụng interrupt priority < 5 (0–4 reserved cho safety-critical). FreeRTOS `configMAX_SYSCALL_INTERRUPT_PRIORITY = 5`.

### 3.2 ISR Design Rules

- ISR PHẢI ngắn (< 1 µs). Không có business logic trong ISR.
- ISR chỉ được dùng: `xTaskNotifyFromISR`, `xQueueSendFromISR`, `portYIELD_FROM_ISR`.
- KHÔNG gọi HAL blocking functions từ ISR.

---

## 4. Data Structures

### 4.1 `io_data_buf` — I/O Snapshot Buffer

```c
typedef struct {
    int32_t  ui_raw[16];         // 2× ADS131M08 s24 sign-extended to int32
    uint8_t  adc1_stat;          // ADC #1 status, UI1-UI8
    uint8_t  adc2_stat;          // ADC #2 status, UI9-UI16
    uint8_t  do_fb_mask;         // DO1-DO4 relay feedback bitmask
    int16_t  mcu_temp_x10;       // MCU temp × 10 (°C)
    uint16_t fault_flags;        // FAULT_FLAGS per IOP spec
    uint16_t sample_cnt;         // ADC sample counter (wraps)
    uint32_t timestamp_ms;       // FreeRTOS tick at time of snapshot
} io_data_t;
```

### 4.2 `ao_setpoint` — AO Command

```c
typedef struct {
    uint16_t ao_raw[4];          // AO1-AO4 raw value (0-65535)
    bool     valid;              // false = safe state (output 0/4mA)
    uint32_t timestamp_ms;       // Timestamp when received from SOM
} ao_cmd_t;
```

### 4.3 `do_cmd` — DO Command

```c
typedef struct {
    uint8_t mask;                // DO_MASK: which channels to update
    uint8_t value;               // DO_VALUE: target state
} do_cmd_t;
```

### 4.4 `diag_counters` — Diagnostics

```c
typedef struct {
    uint16_t iop_rx_cnt;         // Total frames received
    uint16_t iop_crc_err;        // CRC errors
    uint16_t iop_seq_err;        // Sequence mismatches
    uint16_t wdg_reset_cnt;      // Watchdog reset counter (SRAM backup)
    uint16_t adc_sample_rate;    // Measured ADC sample rate (Hz)
    int16_t  mcu_temp_max;       // Max MCU temp since boot (× 10)
    uint16_t vdd_mv;             // VDD millivolts
} diag_t;
```

---

## 5. Memory Map

### 5.1 Flash Layout (128 KB)

```
0x08000000 ┌──────────────────────────┐
           │ Vector Table + Bootloader│  4 KB
0x08001000 ├──────────────────────────┤
           │ Application Code         │  88 KB
0x08017000 ├──────────────────────────┤
           │ Configuration (Flash)    │  4 KB  (safe state values, debounce config)
0x08018000 ├──────────────────────────┤
           │ Reserved / Debug         │  32 KB
0x08020000 └──────────────────────────┘ (end of 128 KB)
```

### 5.2 SRAM Layout (144 KB)

```
0x20000000 ┌──────────────────────────┐
           │ FreeRTOS Kernel          │  2 KB
0x20000800 ├──────────────────────────┤
           │ Task Stacks              │  2 KB
0x20001000 ├──────────────────────────┤
           │ io_data_buf              │  64 B
           │ ao_cmd_t                 │  16 B
           │ do_cmd_t queue           │  16 B
           │ diag_t                   │  32 B
           │ IOP TX/RX buffers        │  512 B
           │ Application Data         │  ~6 KB
0x20002C00 ├──────────────────────────┤
           │ SRAM Backup (survive rst)│  256 B  (fault log, counters)
0x20002D00 ├──────────────────────────┤
           │ Reserve / Stack guard    │  ~133 KB (STM32G0B1RB: 144 KB SRAM)
0x20024000 └──────────────────────────┘
```

---

## 6. SPI Driver Design

### 6.1 ADS131M08 (SPI3 — ADC)

| Thông số | Giá trị |
|---------|---------|
| SPI mode | Mode 1 (CPOL=0, CPHA=1) |
| Clock | 4 MHz |
| Transfer | 24-bit per channel, 8 channels = 24 bytes per conversion |
| Trigger | TIM2 1ms interrupt → DMA transfer → DMA TC callback |
| CS | Software CS (GPIO), deassert after all 8 channels |
| Register init | ODR = 1kSPS, gain = 1×, PGA bypass |

### 6.2 DAC8554 (SPI1 — DAC)

| Thông số | Giá trị |
|---------|---------|
| SPI mode | Mode 1 (CPOL=0, CPHA=1) |
| Clock | 8 MHz |
| Transfer | 24-bit per channel (8-bit config + 16-bit data) |
| Channel update | Broadcast update after writing all 4 channels |
| CS | Software CS (GPIO) |

---

## 7. Fault & Safe State Machine

```
State Machine:

    INIT ──► HANDSHAKE ──► NORMAL
                               │
               ┌───────────────┴──────────────────┐
               │ IOP timeout > 200ms               │ WDG trigger
               ▼                                   ▼
           SAFE_STATE ◄──────────────────── IOP_FAULT
               │                                   │
               │ SOM reconnects (HANDSHAKE)         │ 3 retries
               └───────────────────────────────────►┘
                                                    │
                                                PERMANENT_FAULT
                                          (require power cycle)
```

| State | AO | DO | IOP | IWDG |
|-------|----|----|-----|------|
| NORMAL | As commanded | As commanded | Active | Kicked |
| IOP_FAULT | Hold last | Hold last | Retry | Kicked |
| SAFE_STATE | 0V / 4mA | Open | Wait HANDSHAKE | Kicked |
| PERMANENT_FAULT | 0V / 4mA | Open | Stopped | NOT kicked → hardware reset |

> **PERMANENT_FAULT:** Chỉ khi có lỗi hardware nghiêm trọng (VDD out of range, ADC init fail). MCU không kick IWDG → hardware watchdog reset sau 1 giây → bootup lại.

---

## 8. Timing Diagram

```
TIM2 ISR (1ms):
  │
  ├── io_sample_task wakeup
  │     ├── Read ADS131M08 via SPI DMA (start transfer)
  │     ├── Read DI GPIO states
  │     └── Apply debounce logic
  │               (DMA completes ~0.1ms later)
  │               └── DMA TC ISR → update io_data_buf

iop_comm_task (10ms):
  │
  ├── Wait for UART_IDLE or frame received
  ├── Parse frame, verify CRC
  ├── If GET_IO: copy io_data_buf → build IO_RESP → DMA TX
  ├── If SET_AO: send ao_cmd to xAoQueue
  ├── If SET_DO: send do_cmd to xDoQueue
  └── If RESET_IO: set safe_state flag (direct write, critical section)

ao_output_task (10ms):
  ├── Try receive from xAoQueue (no wait if empty)
  ├── If new AO cmd: write all 4 channels to DAC8554 via SPI DMA
  └── If safe_state: write safe AO values

do_control_task (10ms):
  ├── Try receive from xDoQueue
  ├── If new DO cmd: update relay GPIO outputs
  └── Read DO feedback GPIO → update io_data_buf.do_fb_mask
```

---

## 9. Coding Standards

| Quy tắc | Mô tả |
|--------|-------|
| C standard | **C11** (STM32CubeIDE, arm-none-eabi-gcc) |
| Naming | `snake_case` cho variables/functions; `UPPER_CASE` cho constants/macros |
| Headers | `.h` chứa type definitions + function declarations; không có static inline functions |
| ISR naming | `xxxxx_IRQHandler()` per CMSIS convention |
| Magic numbers | PHẢI định nghĩa bằng `#define` hoặc `enum`, không inline |
| Error handling | Mọi HAL function PHẢI check return status |
| No dynamic allocation | KHÔNG dùng `malloc/free` sau RTOS start |
| Static analysis | `cppcheck --enable=all` PHẢI pass 0 errors trước commit |

---

## 10. Build & Debug

| Tool | Version | Mô tả |
|------|---------|-------|
| **Compiler** | `arm-none-eabi-gcc 12.x` | Arm bare-metal toolchain |
| **IDE** | STM32CubeIDE 1.15+ | Hoặc CMake + VSCode |
| **RTOS** | FreeRTOS 10.5.1 | Bundled với STM32Cube |
| **Debug** | ST-Link V3 / SWD | JTAG/SWD via J-TAG header CN1 |
| **Unit Test** | Unity framework | Chạy trên host (PC) cho CRC/logic tests |
| **CI** | Chạy cppcheck + Unity tests trên GitHub Actions | — |

---

**Document ID:** FW-ARCH-MK-DDC-24-VI  
**Revision:** 2.0 | 2026-06-30
**Review required:** Firmware Lead
