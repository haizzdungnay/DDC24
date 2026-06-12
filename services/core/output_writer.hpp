/**
 * @file  output_writer.hpp
 * @brief Ghi ao_setpoint[]/do_cmd[] vào kx_io_shm (07 §7.2) — core là writer DUY NHẤT
 *        2 field này. KHÔNG dùng seqlock của io_shm (seq do iobus sở hữu) —
 *        atomic store per-field. Chỉ ghi khi giá trị đổi.
 *        Lấy mapping ĐỘNG từ IobusReader mỗi lần ghi — core attach shm muộn
 *        (iobus lên sau 30s) vẫn tự ghi được khi reader re-attach.
 */
#ifndef CORE_OUTPUT_WRITER_HPP
#define CORE_OUTPUT_WRITER_HPP

#include "iobus_reader.hpp"
#include "priority_resolver.hpp"

namespace core {

class OutputWriter {
public:
    explicit OutputWriter(IobusReader& reader) : reader_(reader) {}

    /* ao = ENGINEERING value (V/mA theo ao_mode); iobus convert eng→raw.
     * Chưa attach shm → no-op (safe-state phía MCU tự lo). */
    void write(const OutputCmd& out);

private:
    IobusReader& reader_;
};

} // namespace core

#endif /* CORE_OUTPUT_WRITER_HPP */
