#include "output_writer.hpp"

namespace core {

void OutputWriter::write(const OutputCmd& out)
{
    kx_io_shm_t* shm = reader_.shm();
    if (!shm || __atomic_load_n(&shm->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC) return;
    for (int ch = 0; ch < KX_N_AO; ch++) {
        if (!out.ao_valid[ch]) continue;
        float cur;
        __atomic_load(&shm->ao_setpoint[ch], &cur, __ATOMIC_ACQUIRE);
        if (cur != out.ao[ch])
            __atomic_store(&shm->ao_setpoint[ch], const_cast<float*>(&out.ao[ch]), __ATOMIC_RELEASE);
    }
    for (int ch = 0; ch < KX_N_DO; ch++) {
        if (!out.do_valid[ch]) continue;
        const uint8_t v = out.dout[ch] ? 1 : 0;
        if (__atomic_load_n(&shm->do_cmd[ch], __ATOMIC_ACQUIRE) != v)
            __atomic_store_n(&shm->do_cmd[ch], v, __ATOMIC_RELEASE);
    }
}

} // namespace core
