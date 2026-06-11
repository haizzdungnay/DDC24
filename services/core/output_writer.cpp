#include "output_writer.hpp"

namespace core {

void OutputWriter::write(const OutputCmd& out)
{
    if (!shm_) return;
    for (int ch = 0; ch < KX_N_AO; ch++) {
        if (!out.ao_valid[ch]) continue;
        float cur;
        __atomic_load(&shm_->ao_setpoint[ch], &cur, __ATOMIC_ACQUIRE);
        if (cur != out.ao[ch])
            __atomic_store(&shm_->ao_setpoint[ch], const_cast<float*>(&out.ao[ch]), __ATOMIC_RELEASE);
    }
    for (int ch = 0; ch < KX_N_DO; ch++) {
        if (!out.do_valid[ch]) continue;
        const uint8_t v = out.dout[ch] ? 1 : 0;
        if (__atomic_load_n(&shm_->do_cmd[ch], __ATOMIC_ACQUIRE) != v)
            __atomic_store_n(&shm_->do_cmd[ch], v, __ATOMIC_RELEASE);
    }
}

} // namespace core
