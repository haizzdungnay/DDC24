#include "io/io_cache.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

#include "diagnostics/iobus_metrics.hpp"

namespace iobus {

/* KX_SHM_IO_PATH là path /dev/shm/...; shm_open cần tên không prefix */
static const char* shm_name()
{
    const char* p = KX_SHM_IO_PATH;
    const char* base = std::strrchr(p, '/');
    return base ? base : p;   /* "/mkddc_io_shm" */
}

IoCache::~IoCache()
{
    detach();
}

bool IoCache::attach()
{
    const int fd = shm_open(shm_name(), O_CREAT | O_RDWR, 0664);
    if (fd < 0) {
        std::fprintf(stderr, "ERROR io_cache.attach_fail shm_open errno=%d\n", errno);
        return false;
    }
    if (ftruncate(fd, sizeof(kx_io_shm_t)) != 0) {
        std::fprintf(stderr, "ERROR io_cache.attach_fail ftruncate errno=%d\n", errno);
        ::close(fd);
        return false;
    }
    void* mem = mmap(nullptr, sizeof(kx_io_shm_t), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    ::close(fd);
    if (mem == MAP_FAILED) {
        std::fprintf(stderr, "ERROR io_cache.attach_fail mmap errno=%d\n", errno);
        return false;
    }
    shm_ = static_cast<kx_io_shm_t*>(mem);

    /* Init default TRƯỚC khi set magic — lúc này chưa ai đọc (06 §5) */
    std::memset(shm_, 0, sizeof(kx_io_shm_t));
    for (int i = 0; i < KX_N_UI; i++) shm_->ui_quality[i] = KX_Q_BAD;   /* chưa có mẫu */
    for (int i = 0; i < KX_N_AO; i++) shm_->ao_setpoint[i] = 0.0f;      /* safe 0V/4mA */
    shm_->iop_status = KX_IOP_FAULT;                                    /* chưa handshake */
    __atomic_store_n(&shm_->magic, KX_SHM_MAGIC, __ATOMIC_RELEASE);     /* magic CUỐI CÙNG */

    std::fprintf(stderr, "INFO  io_cache.attached path=%s size=%zu\n",
                 KX_SHM_IO_PATH, sizeof(kx_io_shm_t));
    return true;
}

void IoCache::detach()
{
    if (shm_) {
        munmap(shm_, sizeof(kx_io_shm_t));
        shm_ = nullptr;
    }
}

void IoCache::write_io(const IoSnapshot& s, const IobusMetrics& m)
{
    if (!shm_) return;
    for (int i = 0; i < KX_N_DI; i++) {
        if (s.di_state[i] && !prev_di_[i]) di_counter_[i]++;   /* cạnh lên */
        prev_di_[i] = s.di_state[i];
    }

    KX_WRITE_BEGIN(shm_);
    shm_->ts_ns = s.ts_ns;
    for (int i = 0; i < KX_N_UI; i++) {
        shm_->ui_value[i]   = s.ui_value[i];
        shm_->ui_quality[i] = s.ui_quality[i];
    }
    for (int i = 0; i < KX_N_DI; i++) {
        shm_->di_state[i]   = s.di_state[i];
        shm_->di_counter[i] = di_counter_[i];
    }
    for (int i = 0; i < KX_N_DO; i++)
        shm_->do_feedback[i] = s.do_feedback[i];
    shm_->fault_flags  = s.fault_flags;
    shm_->iop_status   = s.iop_status;
    shm_->mcu_temp_x10 = s.mcu_temp_x10;
    shm_->iop_rx       = m.rx_count.load(std::memory_order_relaxed);
    shm_->iop_crc_err  = m.crc_error_count.load(std::memory_order_relaxed);
    shm_->iop_timeout  = m.timeout_count.load(std::memory_order_relaxed);
    shm_->iop_seq_err  = m.seq_error_count.load(std::memory_order_relaxed);
    KX_WRITE_END(shm_);
}

void IoCache::write_ao_mode(const uint8_t mode[KX_N_AO])
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    for (int i = 0; i < KX_N_AO; i++)
        shm_->ao_mode[i] = mode[i];
    KX_WRITE_END(shm_);
}

void IoCache::write_ui_units(const char units[KX_N_UI][8])
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    for (int i = 0; i < KX_N_UI; i++) {
        std::strncpy(shm_->ui_unit[i], units[i], sizeof(shm_->ui_unit[i]) - 1);
        shm_->ui_unit[i][sizeof(shm_->ui_unit[i]) - 1] = '\0';
    }
    KX_WRITE_END(shm_);
}

void IoCache::write_status(uint8_t iop_status, const IobusMetrics& m)
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    shm_->iop_status  = iop_status;
    shm_->iop_rx      = m.rx_count.load(std::memory_order_relaxed);
    shm_->iop_crc_err = m.crc_error_count.load(std::memory_order_relaxed);
    shm_->iop_timeout = m.timeout_count.load(std::memory_order_relaxed);
    shm_->iop_seq_err = m.seq_error_count.load(std::memory_order_relaxed);
    KX_WRITE_END(shm_);
}

} // namespace iobus
