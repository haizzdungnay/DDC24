#include "st/st_retain.hpp"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>

#include <fcntl.h>
#include <unistd.h>

namespace core {
namespace {

uint32_t crc32(const uint8_t* data, std::size_t n)
{
    uint32_t crc = 0xFFFFFFFFu;
    for (std::size_t i = 0; i < n; i++) {
        crc ^= data[i];
        for (int k = 0; k < 8; k++)
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

void put_u16(std::vector<uint8_t>* v, uint16_t x)
{
    v->push_back(static_cast<uint8_t>(x & 0xFF));
    v->push_back(static_cast<uint8_t>((x >> 8) & 0xFF));
}
void put_u32(std::vector<uint8_t>* v, uint32_t x)
{
    for (int i = 0; i < 4; i++) v->push_back(static_cast<uint8_t>((x >> (8 * i)) & 0xFF));
}
uint16_t rd_u16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
uint32_t rd_u32(const uint8_t* p)
{
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

/* Header 20 byte: magic(4) version(2) pad(2) layout_hash(4) record_size(4) crc(4).
 * CRC tính trên PAYLOAD, không gồm header — nên đổi header mà không đổi payload
 * vẫn bị bắt bởi các trường tường minh, còn payload hỏng thì bị CRC bắt. */
constexpr std::size_t kHeaderSize = 20;

std::size_t type_size(StType t)
{
    switch (t) {
    case StType::BOOL: return 1;
    case StType::INT:
    case StType::UINT: return 2;
    case StType::DINT: return 4;
    case StType::REAL: return 4;
    case StType::TIME: return 8;
    }
    return 8;
}

/* Serialize giá trị các slot RETAIN theo đúng thứ tự trong retain_entries. */
std::vector<uint8_t> build_payload(const StLoadedProgram& prog)
{
    std::vector<uint8_t> out(prog.retain_record_size, 0);
    for (const StIrRetainEntry& e : prog.retain_entries) {
        const StCell& c = prog.slots[e.slot];
        uint8_t* dst = out.data() + e.offset;
        switch (e.type) {
        case StType::BOOL: dst[0] = c.b ? 1 : 0; break;
        case StType::INT:
        case StType::UINT: {
            const uint16_t value = static_cast<uint16_t>(c.i);
            dst[0] = static_cast<uint8_t>(value & 0xFFu);
            dst[1] = static_cast<uint8_t>((value >> 8u) & 0xFFu);
            break;
        }
        case StType::DINT: {
            const uint32_t value = static_cast<uint32_t>(c.i);
            for (int i = 0; i < 4; ++i)
                dst[i] = static_cast<uint8_t>((value >> (8 * i)) & 0xFFu);
            break;
        }
        case StType::REAL: std::memcpy(dst, &c.r, 4); break;
        case StType::TIME: std::memcpy(dst, &c.t, 8); break;
        }
    }
    return out;
}

} // namespace

StRetainResult StRetainStore::restore(StLoadedProgram* prog) const
{
    StRetainResult r;
    if (!prog) return r;
    /* Chương trình không có biến RETAIN thì không có gì để khôi phục. */
    if (prog->retain_entries.empty()) return r;

    std::ifstream f(path_, std::ios::binary);
    if (!f) return r;   /* lần chạy đầu — bình thường, không phải lỗi */

    std::stringstream ss;
    ss << f.rdbuf();
    const std::string blob = ss.str();
    const uint8_t* d = reinterpret_cast<const uint8_t*>(blob.data());

    if (blob.size() < kHeaderSize) {
        r.reject_code = st_retain_error::kBadMagicOrVersion;
        r.message = "retain record shorter than header";
        return r;
    }
    if (rd_u32(d) != st_retain::kMagic || rd_u16(d + 4) != st_retain::kVersion) {
        r.reject_code = st_retain_error::kBadMagicOrVersion;
        r.message = "retain magic or version mismatch";
        return r;
    }
    const uint32_t layout_hash = rd_u32(d + 8);
    const uint32_t record_size = rd_u32(d + 12);
    const uint32_t stored_crc  = rd_u32(d + 16);

    if (blob.size() != kHeaderSize + record_size) {
        r.reject_code = st_retain_error::kBadRecordSize;
        r.message = "retain file size does not match record_size";
        return r;
    }
    /* CRC kiểm TRƯỚC layout_hash: file bị cắt do mất điện khi đang ghi là
     * nguyên nhân thường gặp nhất, và báo đúng nguyên nhân giúp người vận
     * hành phân biệt "mất điện" với "đã đổi chương trình". */
    if (crc32(d + kHeaderSize, record_size) != stored_crc) {
        r.reject_code = st_retain_error::kBadCrc;
        r.message = "retain CRC mismatch (suspect power loss during write)";
        return r;
    }
    if (layout_hash != prog->retain_layout_hash) {
        r.reject_code = st_retain_error::kLayoutMismatch;
        r.message = "retain layout changed; cold start with initial values";
        return r;
    }
    if (record_size != prog->retain_record_size) {
        r.reject_code = st_retain_error::kBadRecordSize;
        r.message = "retain record size differs from program";
        return r;
    }

    const uint8_t* payload = d + kHeaderSize;
    for (const StIrRetainEntry& e : prog->retain_entries) {
        if (e.offset + type_size(e.type) > record_size) {
            r.reject_code = st_retain_error::kBadRecordSize;
            r.message = "retain entry outside record";
            return r;
        }
        StCell& c = prog->slots[e.slot];
        const uint8_t* src = payload + e.offset;
        switch (e.type) {
        case StType::BOOL: c.b = src[0] != 0; break;
        case StType::INT:
            c.i = static_cast<int16_t>(rd_u16(src));
            break;
        case StType::UINT:
            c.i = rd_u16(src);
            break;
        case StType::DINT:
            c.i = static_cast<int32_t>(rd_u32(src));
            break;
        case StType::REAL: std::memcpy(&c.r, src, 4); break;
        case StType::TIME: std::memcpy(&c.t, src, 8); break;
        }
    }
    r.restored = true;
    return r;
}

bool StRetainStore::write_atomic(const std::vector<uint8_t>& bytes) const
{
    /* tmp -> fsync -> rename -> fsync(dir). Thiếu fsync nào cũng để lại khả
     * năng mất điện sinh ra file rỗng hoặc nửa vời mà lần sau đọc vào tưởng
     * hợp lệ — đúng thứ CRC sinh ra để bắt, nhưng chặn từ đầu vẫn tốt hơn. */
    const std::string tmp = path_ + ".tmp";
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0640);
    if (fd < 0) return false;

    std::size_t written = 0;
    while (written < bytes.size()) {
        const ssize_t n = ::write(fd, bytes.data() + written, bytes.size() - written);
        if (n <= 0) { ::close(fd); ::unlink(tmp.c_str()); return false; }
        written += static_cast<std::size_t>(n);
    }
    if (::fsync(fd) != 0) { ::close(fd); ::unlink(tmp.c_str()); return false; }
    ::close(fd);

    if (::rename(tmp.c_str(), path_.c_str()) != 0) { ::unlink(tmp.c_str()); return false; }

    const std::size_t slash = path_.find_last_of('/');
    const std::string dir = (slash == std::string::npos) ? "." : path_.substr(0, slash);
    const int dfd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) { ::fsync(dfd); ::close(dfd); }
    return true;
}

bool StRetainStore::save_if_needed(const StLoadedProgram& prog, uint64_t now_ns, bool force)
{
    if (prog.retain_entries.empty()) return false;

    const std::vector<uint8_t> payload = build_payload(prog);

    /* Không đổi thì không ghi — điều kiện này quan trọng hơn giãn cách thời
     * gian: chương trình có RETAIN nhưng giá trị đứng yên thì không tiêu tốn
     * chu kỳ ghi nào cả. */
    if (payload == last_written_payload_) return false;
    if (!force && last_write_ns_ != 0 && now_ns - last_write_ns_ < st_retain::kMinWriteIntervalNs)
        return false;

    std::vector<uint8_t> file;
    file.reserve(kHeaderSize + payload.size());
    put_u32(&file, st_retain::kMagic);
    put_u16(&file, st_retain::kVersion);
    put_u16(&file, 0);
    put_u32(&file, prog.retain_layout_hash);
    put_u32(&file, static_cast<uint32_t>(payload.size()));
    put_u32(&file, crc32(payload.data(), payload.size()));
    file.insert(file.end(), payload.begin(), payload.end());

    if (!write_atomic(file)) return false;
    last_written_payload_ = payload;
    last_write_ns_ = now_ns;
    write_count_++;
    return true;
}

bool StRetainStore::erase() const
{
    return ::unlink(path_.c_str()) == 0;
}

} // namespace core
