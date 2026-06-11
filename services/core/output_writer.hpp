/**
 * @file  output_writer.hpp
 * @brief Ghi ao_setpoint[]/do_cmd[] vào kx_io_shm (07 §7.2) — core là writer DUY NHẤT
 *        2 field này. KHÔNG dùng seqlock của io_shm (seq do iobus sở hữu) —
 *        atomic store per-field. Chỉ ghi khi giá trị đổi.
 */
#ifndef CORE_OUTPUT_WRITER_HPP
#define CORE_OUTPUT_WRITER_HPP

#include "mkddc_shm.h"
#include "priority_resolver.hpp"

namespace core {

class OutputWriter {
public:
    explicit OutputWriter(kx_io_shm_t* shm) : shm_(shm) {}

    /* ao = ENGINEERING value (V/mA theo ao_mode); iobus convert eng→raw. */
    void write(const OutputCmd& out);

private:
    kx_io_shm_t* shm_;
};

} // namespace core

#endif /* CORE_OUTPUT_WRITER_HPP */
