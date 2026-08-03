#ifndef CORE_PORTS_IO_SNAPSHOT_READER_HPP
#define CORE_PORTS_IO_SNAPSHOT_READER_HPP

#include "ports/io_snapshot.hpp"

namespace core {

/** Port đọc snapshot I/O mà application dùng, không để lộ SHM/mmap. */
class IoSnapshotReaderPort {
public:
    virtual ~IoSnapshotReaderPort() = default;
    virtual bool attach() = 0;
    virtual void detach() = 0;
    virtual bool attached() const = 0;
    virtual bool read(IoSnapshot* out) const = 0;
    virtual bool contract_valid() const = 0;
};

} // namespace core

#endif /* CORE_PORTS_IO_SNAPSHOT_READER_HPP */
