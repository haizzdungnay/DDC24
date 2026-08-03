#include <stdbool.h>
#include <stdint.h>
#include "ddc24_runtime.h"
#include "build_info.h"

/* Chuỗi provenance nằm trực tiếp trong ELF để artifact firmware truy được về
 * phiên bản/source state ngay cả trước khi có lệnh diagnostics mở rộng. */
__attribute__((used)) const char mkddc_fw_build_info[] =
    "version=" MKDDC_BUILD_VERSION
    " git_commit=" MKDDC_GIT_COMMIT
    " build_time=" MKDDC_BUILD_TIME
    " toolchain=" MKDDC_TOOLCHAIN;

__attribute__((weak)) uint32_t fw_millis(void) { static uint32_t value; return value++; }
__attribute__((weak)) bool fw_uart_read(uint8_t *byte) { (void)byte; return false; }
__attribute__((weak)) void fw_uart_tx(const uint8_t *data, uint16_t len) { (void)data; (void)len; }
__attribute__((weak)) bool fw_sample_inputs(int32_t ui[16], uint8_t *adc1, uint8_t *adc2,
    int16_t *temp, uint16_t *faults, uint8_t *do_fb)
{ (void)ui; (void)adc1; (void)adc2; (void)temp; (void)faults; (void)do_fb; return false; }
__attribute__((weak)) bool fw_apply_ao(const uint16_t ao[4], uint8_t modes) { (void)ao; (void)modes; return false; }
__attribute__((weak)) bool fw_apply_do(uint8_t mask) { (void)mask; return false; }

int main(void)
{
    const ddc24_hal_t hal = {fw_sample_inputs, fw_apply_ao, fw_apply_do, fw_uart_tx};
    ddc24_runtime_t runtime;
    ddc24_runtime_init(&runtime, &hal, fw_millis());
    while (1) {
        uint8_t byte;
        const uint32_t now = fw_millis();
        while (fw_uart_read(&byte)) ddc24_runtime_rx_byte(&runtime, byte, now);
        ddc24_runtime_tick(&runtime, now);
    }

    return 0;
}
