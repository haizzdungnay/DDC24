#ifndef MKDDC_FW_DDC24_RUNTIME_H
#define MKDDC_FW_DDC24_RUNTIME_H

#include <stdbool.h>
#include <stdint.h>
#include "iop_link.h"

typedef struct {
    bool (*sample_inputs)(int32_t ui_raw[16], uint8_t *adc1_stat, uint8_t *adc2_stat,
                          int16_t *mcu_temp_x10, uint16_t *fault_flags,
                          uint8_t *do_feedback);
    bool (*apply_ao)(const uint16_t ao_raw[4], uint8_t mode_mask);
    bool (*apply_do)(uint8_t command_mask);
    void (*uart_tx)(const uint8_t *data, uint16_t len);
} ddc24_hal_t;

typedef struct {
    ddc24_hal_t hal;
    iop_rx_t rx;
    iop_session_t session;
    uint16_t ao_raw[4];
    uint8_t ao_mode_mask;
    uint8_t do_command;
    uint16_t sample_count;
    uint16_t fault_flags;
    uint32_t boot_ms;
    uint32_t rx_count;
    uint32_t crc_errors;
    uint32_t seq_errors;
    uint32_t safe_entries;
    bool safe_active;
    uint8_t last_tx[IOP_MAX_FRAME];
    uint16_t last_tx_len;
} ddc24_runtime_t;

void ddc24_runtime_init(ddc24_runtime_t *runtime, const ddc24_hal_t *hal, uint32_t now_ms);
void ddc24_runtime_rx_byte(ddc24_runtime_t *runtime, uint8_t byte, uint32_t now_ms);
void ddc24_runtime_line_idle(ddc24_runtime_t *runtime);
void ddc24_runtime_tick(ddc24_runtime_t *runtime, uint32_t now_ms);
void ddc24_runtime_enter_safe_state(ddc24_runtime_t *runtime);

#endif
