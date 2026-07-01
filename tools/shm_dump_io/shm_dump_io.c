/**
 * @file  shm_dump_io.c
 * @brief Dump kx_io_shm ra text/JSON (06 §11) — bring-up + debug, thay cho cat|xxd.
 *        Exit code: 0 = NORMAL; 1 = FAULT/SAFE; 2 = chưa attach được.
 */
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>

#include "iop_protocol.h"
#include "mkddc_shm.h"

static uint64_t now_ns(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

/* seqlock reader: snapshot nhất quán, không block writer */
static int read_snapshot(const kx_io_shm_t* shm, kx_io_shm_t* out)
{
    for (int i = 0; i < 16; i++) {
        uint32_t v1 = __atomic_load_n(&shm->seq, __ATOMIC_ACQUIRE);
        if (v1 & 1u) continue;
        memcpy(out, (const void*)shm, sizeof(*out));
        uint32_t v2 = __atomic_load_n(&shm->seq, __ATOMIC_ACQUIRE);
        if (v1 == v2) return 1;
    }
    return 0;
}

static const char* quality_name(uint8_t q)
{
    switch (q) {
    case KX_Q_GOOD:      return "GOOD";
    case KX_Q_UNCERTAIN: return "UNCERTAIN";
    default:             return "BAD";
    }
}

static const char* reliability_name(uint8_t r)
{
    switch (r) {
    case KX_REL_RELIABLE:              return "RELIABLE";
    case KX_REL_OVER_RANGE:            return "OVER_RANGE";
    case KX_REL_UNDER_RANGE:           return "UNDER_RANGE";
    case KX_REL_OPEN_LOOP:             return "OPEN_LOOP";
    case KX_REL_SHORTED_LOOP:          return "SHORTED_LOOP";
    case KX_REL_CONFIGURATION_ERROR:   return "CONFIGURATION_ERROR";
    case KX_REL_COMMUNICATION_FAILURE: return "COMMUNICATION_FAILURE";
    default:                           return "UNRELIABLE_OTHER";
    }
}

static const char* status_name(uint8_t s)
{
    switch (s) {
    case KX_IOP_NORMAL: return "NORMAL";
    case KX_IOP_SAFE:   return "SAFE";
    default:            return "FAULT";
    }
}

static void decode_faults(uint16_t f, char* buf, size_t n)
{
    buf[0] = '\0';
    if (f & IOP_FAULT_ADC1)         strncat(buf, "ADC1 ", n - strlen(buf) - 1);
    if (f & IOP_FAULT_ADC2)         strncat(buf, "ADC2 ", n - strlen(buf) - 1);
    if (f & IOP_FAULT_DAC)          strncat(buf, "DAC ", n - strlen(buf) - 1);
    if (f & IOP_FAULT_UI_OV)        strncat(buf, "UI_OV ", n - strlen(buf) - 1);
    if (f & IOP_FAULT_RELAY_STUCK)  strncat(buf, "RELAY_STUCK ", n - strlen(buf) - 1);
    if (f & IOP_FAULT_WDG_RESET)    strncat(buf, "WDG_RESET ", n - strlen(buf) - 1);
    if (f & IOP_FAULT_MCU_OVERTEMP) strncat(buf, "OVERTEMP ", n - strlen(buf) - 1);
    if (f & IOP_FAULT_VDD)          strncat(buf, "VDD ", n - strlen(buf) - 1);
    if (buf[0] == '\0') strncpy(buf, "none", n - 1);
}

static void print_text(const kx_io_shm_t* s)
{
    const int64_t age_ms = (int64_t)(now_ns() - s->ts_ns) / 1000000;
    char faults[96];
    decode_faults(s->fault_flags, faults, sizeof(faults));

    printf("magic=0x%08X seq=%u ts_ns=%llu (age %lld ms)\n",
           s->magic, s->seq, (unsigned long long)s->ts_ns, (long long)age_ms);
    printf("iop_status=%s fault_flags=0x%04X [%s] mcu_temp=%.1fC\n",
           status_name(s->iop_status), s->fault_flags, faults, s->mcu_temp_x10 / 10.0);
    for (int i = 0; i < KX_N_UI; i++) {
        if (s->ui_raw_unit[i][0] != '\0') {
            printf("  UI%-2d= %10.3f %-5s raw=%8.3f %-3s %s rel=%s\n", i + 1,
                   (double)s->ui_value[i], s->ui_unit[i], (double)s->ui_raw[i],
                   s->ui_raw_unit[i], quality_name(s->ui_quality[i]),
                   reliability_name(s->ui_reliability[i]));
        } else {
            printf("  UI%-2d= %10.3f %-5s %s rel=%s\n", i + 1, (double)s->ui_value[i],
                   s->ui_unit[i], quality_name(s->ui_quality[i]),
                   reliability_name(s->ui_reliability[i]));
        }
    }
    printf("  AO  = sp[%.3f %.3f %.3f %.3f] mode[%u %u %u %u]\n",
           (double)s->ao_setpoint[0], (double)s->ao_setpoint[1],
           (double)s->ao_setpoint[2], (double)s->ao_setpoint[3],
           s->ao_mode[0], s->ao_mode[1], s->ao_mode[2], s->ao_mode[3]);
    printf("  DO  = cmd[%u %u %u %u] fb[%u %u %u %u]\n",
           s->do_cmd[0], s->do_cmd[1], s->do_cmd[2], s->do_cmd[3],
           s->do_feedback[0], s->do_feedback[1], s->do_feedback[2], s->do_feedback[3]);
    printf("  metrics: rx=%u crc_err=%u timeout=%u seq_err=%u\n",
           s->iop_rx, s->iop_crc_err, s->iop_timeout, s->iop_seq_err);
}

static void print_json(const kx_io_shm_t* s)
{
    const int64_t age_ms = (int64_t)(now_ns() - s->ts_ns) / 1000000;
    printf("{\"magic\":%u,\"seq\":%u,\"ts_ns\":%llu,\"age_ms\":%lld,"
           "\"iop_status\":\"%s\",\"fault_flags\":%u,\"mcu_temp_x10\":%d,",
           s->magic, s->seq, (unsigned long long)s->ts_ns, (long long)age_ms,
           status_name(s->iop_status), s->fault_flags, s->mcu_temp_x10);
    printf("\"ui\":[");
    for (int i = 0; i < KX_N_UI; i++)
        printf("%s{\"value\":%.4f,\"quality\":\"%s\",\"reliability\":\"%s\",\"unit\":\"%s\",\"raw\":%.4f,\"rawUnit\":\"%s\"}",
               i ? "," : "", (double)s->ui_value[i], quality_name(s->ui_quality[i]),
               reliability_name(s->ui_reliability[i]), s->ui_unit[i],
               (double)s->ui_raw[i], s->ui_raw_unit[i]);
    printf("],\"di\":[");
    for (int i = 0; i < KX_N_DI; i++) printf("%s%u", i ? "," : "", s->di_state[i]);
    printf("],\"ao_setpoint\":[");
    for (int i = 0; i < KX_N_AO; i++) printf("%s%.4f", i ? "," : "", (double)s->ao_setpoint[i]);
    printf("],\"ao_mode\":[");
    for (int i = 0; i < KX_N_AO; i++) printf("%s%u", i ? "," : "", s->ao_mode[i]);
    printf("],\"do_cmd\":[");
    for (int i = 0; i < KX_N_DO; i++) printf("%s%u", i ? "," : "", s->do_cmd[i]);
    printf("],\"do_feedback\":[");
    for (int i = 0; i < KX_N_DO; i++) printf("%s%u", i ? "," : "", s->do_feedback[i]);
    printf("],\"metrics\":{\"rx\":%u,\"crc_err\":%u,\"timeout\":%u,\"seq_err\":%u}}\n",
           s->iop_rx, s->iop_crc_err, s->iop_timeout, s->iop_seq_err);
}

int main(int argc, char** argv)
{
    int watch = 0, json = 0;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--watch") == 0) watch = 1;
        else if (strcmp(argv[i], "--json") == 0) json = 1;
        else if (strcmp(argv[i], "--help") == 0) {
            printf("usage: shm_dump_io [--watch] [--json]\n");
            return 0;
        }
    }

    const int fd = shm_open("/mkddc_io_shm", O_RDONLY, 0);
    if (fd < 0) {
        fprintf(stderr, "NOT READY (shm_open %s fail)\n", KX_SHM_IO_PATH);
        return 2;
    }
    const kx_io_shm_t* shm = mmap(NULL, sizeof(kx_io_shm_t), PROT_READ, MAP_SHARED, fd, 0);
    close(fd);
    if (shm == MAP_FAILED) {
        fprintf(stderr, "NOT READY (mmap fail)\n");
        return 2;
    }
    if (__atomic_load_n(&shm->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC) {
        fprintf(stderr, "NOT READY (magic=0x%08X, chưa init)\n", shm->magic);
        return 2;
    }

    kx_io_shm_t snap;
    do {
        if (!read_snapshot(shm, &snap)) {
            fprintf(stderr, "WARN: seqlock retry exceeded (writer bận?)\n");
        } else {
            if (json) print_json(&snap);
            else      print_text(&snap);
        }
        if (watch) { fflush(stdout); sleep(1); if (!json) printf("\n"); }
    } while (watch);

    return snap.iop_status == KX_IOP_NORMAL ? 0 : 1;
}
