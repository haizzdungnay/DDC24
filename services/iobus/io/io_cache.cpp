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

    const bool reattach =
        __atomic_load_n(&shm_->magic, __ATOMIC_ACQUIRE) == KX_SHM_MAGIC;

    if (!reattach) {
        /* Boot sạch: memset toàn struct TRƯỚC khi set magic — chưa ai đọc (06 §5) */
        __atomic_store_n(&shm_->magic, 0, __ATOMIC_RELEASE);
        std::memset(shm_, 0, sizeof(kx_io_shm_t));
        for (int i = 0; i < KX_N_UI; i++) {
            shm_->ui_raw[i]         = 0.0f;
            shm_->ui_quality[i]     = KX_Q_BAD;
            shm_->ui_reliability[i] = KX_REL_COMMUNICATION_FAILURE;
            std::memset(shm_->ui_unit[i], 0, sizeof(shm_->ui_unit[i]));
            std::memset(shm_->ui_raw_unit[i], 0, sizeof(shm_->ui_raw_unit[i]));
        }
        for (int i = 0; i < KX_N_AO; i++) shm_->ao_setpoint[i] = 0.0f;      /* safe 0V/4mA */
        shm_->iop_status = KX_IOP_FAULT;                                    /* chưa handshake */
        __atomic_store_n(&shm_->magic, KX_SHM_MAGIC, __ATOMIC_RELEASE);     /* magic CUỐI CÙNG */
    } else {
        /* iobus RESTART, core có thể ĐANG ghi ao_setpoint/do_cmd đồng thời:
         * KHÔNG memset (race save/restore — risk A analysis report). Chỉ re-init
         * từng field Writer=iobus; field của core không bao giờ bị chạm. */
        uint32_t seq = __atomic_load_n(&shm_->seq, __ATOMIC_ACQUIRE);
        if (seq & 1u)   /* iobus cũ chết giữa KX_WRITE_BEGIN/END → trả seq về chẵn */
            __atomic_add_fetch(&shm_->seq, 1, __ATOMIC_RELEASE);

        KX_WRITE_BEGIN(shm_);
        shm_->ts_ns = 0;
        for (int i = 0; i < KX_N_UI; i++) {
            shm_->ui_value[i]       = 0.0f;
            shm_->ui_raw[i]         = 0.0f;
            shm_->ui_quality[i]     = KX_Q_BAD;
            shm_->ui_reliability[i] = KX_REL_COMMUNICATION_FAILURE;
            std::memset(shm_->ui_unit[i], 0, sizeof(shm_->ui_unit[i]));
            std::memset(shm_->ui_raw_unit[i], 0, sizeof(shm_->ui_raw_unit[i]));
        }
        for (int i = 0; i < KX_N_DI; i++) {
            shm_->di_state[i] = 0;
            shm_->di_counter[i] = 0;
        }
        for (int i = 0; i < KX_N_AO; i++) shm_->ao_mode[i] = 0;
        for (int i = 0; i < KX_N_DO; i++) shm_->do_feedback[i] = 0;
        shm_->fault_flags = 0;
        shm_->iop_status = KX_IOP_FAULT;
        shm_->mcu_temp_x10 = 0;
        shm_->iop_rx = shm_->iop_crc_err = shm_->iop_timeout = shm_->iop_seq_err = 0;
        KX_WRITE_END(shm_);
        std::fprintf(stderr, "INFO  io_cache.reattach giữ ao_setpoint/do_cmd của core\n");
    }

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
        shm_->ui_value[i]       = s.ui_value[i];
        shm_->ui_raw[i]         = s.ui_raw[i];
        shm_->ui_quality[i]     = s.ui_quality[i];
        shm_->ui_reliability[i] = s.ui_reliability[i];
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

void IoCache::write_ui_units(const char units[KX_N_UI][8], const char raw_units[KX_N_UI][8])
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    for (int i = 0; i < KX_N_UI; i++) {
        std::memset(shm_->ui_unit[i], 0, sizeof(shm_->ui_unit[i]));
        std::strncpy(shm_->ui_unit[i], units[i], sizeof(shm_->ui_unit[i]) - 1);
        shm_->ui_unit[i][sizeof(shm_->ui_unit[i]) - 1] = '\0';
        std::memset(shm_->ui_raw_unit[i], 0, sizeof(shm_->ui_raw_unit[i]));
        std::strncpy(shm_->ui_raw_unit[i], raw_units[i], sizeof(shm_->ui_raw_unit[i]) - 1);
        shm_->ui_raw_unit[i][sizeof(shm_->ui_raw_unit[i]) - 1] = '\0';
    }
    KX_WRITE_END(shm_);
}

void IoCache::write_status(uint8_t iop_status, const IobusMetrics& m)
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    shm_->iop_status  = iop_status;
    if (iop_status != KX_IOP_NORMAL) {
        for (int i = 0; i < KX_N_UI; i++) {
            shm_->ui_quality[i] = KX_Q_BAD;
            shm_->ui_reliability[i] = KX_REL_COMMUNICATION_FAILURE;
        }
    }
    shm_->iop_rx      = m.rx_count.load(std::memory_order_relaxed);
    shm_->iop_crc_err = m.crc_error_count.load(std::memory_order_relaxed);
    shm_->iop_timeout = m.timeout_count.load(std::memory_order_relaxed);
    shm_->iop_seq_err = m.seq_error_count.load(std::memory_order_relaxed);
    KX_WRITE_END(shm_);
}

void IoCache::mark_inputs_unreliable()
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    for (int i = 0; i < KX_N_UI; i++) {
        shm_->ui_quality[i] = KX_Q_UNCERTAIN;
        shm_->ui_reliability[i] = KX_REL_UNRELIABLE_OTHER;
    }
    KX_WRITE_END(shm_);
}

void IoCache::write_fieldbus_metrics(const kx_slave_metrics_t* slaves, size_t count)
{
    if (!shm_) return;
    if (count > KX_N_FB_SLAVE) count = KX_N_FB_SLAVE;

    KX_WRITE_BEGIN(shm_);
    for (size_t i = 0; i < count; i++)
        shm_->fb_slave[i] = slaves[i];
    /* Xoá phần đuôi để reader không đọc lại số liệu của slave đã bị gỡ khỏi config. */
    for (size_t i = count; i < KX_N_FB_SLAVE; i++)
        shm_->fb_slave[i] = kx_slave_metrics_t{};
    shm_->fb_slave_count = static_cast<uint8_t>(count);
    /* Tăng SAU khi dữ liệu đã vào chỗ: seq==0 luôn có nghĩa "chưa publish lần nào". */
    shm_->fb_publish_seq++;
    if (shm_->fb_publish_seq == 0) shm_->fb_publish_seq = 1;   /* tránh quay vòng về 0 */
    KX_WRITE_END(shm_);
}

void IoCache::write_bacnet_bind(bool bound, uint16_t udp_port)
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    shm_->bacnet_bound    = bound ? 1u : 0u;
    shm_->bacnet_udp_port = bound ? udp_port : 0u;
    KX_WRITE_END(shm_);
}

} // namespace iobus
