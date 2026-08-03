/**
 * @file  iobus_reader.hpp
 * @brief Seqlock reader kx_io_shm → IoSnapshot nhất quán (07 §7.1).
 *        Core KHÔNG tạo shm (iobus là creator) — attach không O_CREAT, retry magic.
 */
#ifndef CORE_IOBUS_READER_HPP
#define CORE_IOBUS_READER_HPP

#include <cstdint>

#include "mkddc_shm.h"
#include "ports/io_snapshot_reader.hpp"

namespace core {

class IobusReader final : public IoSnapshotReaderPort {
public:
    ~IobusReader() override;

    /* Attach KX_SHM_IO_PATH (O_RDWR — core ghi 2 field nó sở hữu, KHÔNG O_CREAT).
     * Trả false nếu shm chưa tồn tại / magic sai → caller retry 1s. */
    bool attach() override;
    void detach() override;
    bool attached() const override { return shm_ != nullptr; }
    bool contract_valid() const override;

    /* Seqlock read tối đa 5 lần thử; fail → false (dùng snapshot cũ + metric). */
    bool read(IoSnapshot* out) const override;

    /* Đọc trực tiếp từ struct (cho unit test, không cần shm thật). */
    static bool read_from(const kx_io_shm_t* shm, IoSnapshot* out);

    /* Test hook: dùng buffer ngoài thay vì mmap (KHÔNG munmap khi detach). */
    void attach_external(kx_io_shm_t* s) { shm_ = s; external_ = true; }

    /* Mapping RW dùng chung cho output_writer (2 field core sở hữu). */
    kx_io_shm_t* shm() { return shm_; }

private:
    kx_io_shm_t* shm_ = nullptr;
    bool external_ = false;
};

} // namespace core

#endif /* CORE_IOBUS_READER_HPP */
