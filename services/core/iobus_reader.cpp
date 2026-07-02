#include "iobus_reader.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

namespace core {

static const char* shm_name()
{
    const char* p = KX_SHM_IO_PATH;
    const char* base = std::strrchr(p, '/');
    return base ? base : p;
}

IobusReader::~IobusReader()
{
    detach();
}

bool IobusReader::attach()
{
    /* KHÔNG O_CREAT — iobus là creator (07 §7.1) */
    const int fd = shm_open(shm_name(), O_RDWR, 0);
    if (fd < 0)
        return false;
    void* mem = mmap(nullptr, sizeof(kx_io_shm_t), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    ::close(fd);
    if (mem == MAP_FAILED)
        return false;
    kx_io_shm_t* s = static_cast<kx_io_shm_t*>(mem);
    if (__atomic_load_n(&s->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC) {
        munmap(mem, sizeof(kx_io_shm_t));
        return false;   /* iobus chưa init xong → retry */
    }
    shm_ = s;
    std::fprintf(stderr, "INFO  iobus_reader.attached path=%s\n", KX_SHM_IO_PATH);
    return true;
}

void IobusReader::detach()
{
    if (shm_) {
        if (!external_)
            munmap(shm_, sizeof(kx_io_shm_t));
        shm_ = nullptr;
        external_ = false;
    }
}

bool IobusReader::read_from(const kx_io_shm_t* s, IoSnapshot* out)
{
    if (__atomic_load_n(&s->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC)
        return false;   /* magic bumped to v4 (0x4B584404): raw-live + reliability */
    for (int i = 0; i < 5; i++) {
        const uint32_t v1 = __atomic_load_n(&s->seq, __ATOMIC_ACQUIRE);
        if (v1 & 1u) continue;                    /* đang ghi → thử lại */
        out->ts_ns = s->ts_ns;
        std::memcpy(out->ui_value, (const void*)s->ui_value, sizeof(out->ui_value));
        std::memcpy(out->ui_quality, (const void*)s->ui_quality, sizeof(out->ui_quality));
        std::memcpy(out->ui_reliability, (const void*)s->ui_reliability, sizeof(out->ui_reliability));
        std::memcpy(out->di_state, (const void*)s->di_state, sizeof(out->di_state));
        std::memcpy(out->di_counter, (const void*)s->di_counter, sizeof(out->di_counter));
        std::memcpy(out->do_feedback, (const void*)s->do_feedback, sizeof(out->do_feedback));
        std::memcpy(out->ao_setpoint, (const void*)s->ao_setpoint, sizeof(out->ao_setpoint));
        std::memcpy(out->ao_mode, (const void*)s->ao_mode, sizeof(out->ao_mode));
        out->fault_flags  = s->fault_flags;
        out->iop_status   = s->iop_status;
        out->mcu_temp_x10 = s->mcu_temp_x10;
        const uint32_t v2 = __atomic_load_n(&s->seq, __ATOMIC_ACQUIRE);
        if (v1 == v2) {
            out->valid = true;
            return true;                          /* snapshot nhất quán */
        }
    }
    return false;                                 /* dùng snapshot cũ + đếm metric */
}

bool IobusReader::read(IoSnapshot* out) const
{
    if (!shm_) return false;
    return read_from(shm_, out);
}

} // namespace core
