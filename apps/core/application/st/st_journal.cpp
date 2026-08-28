#include "st/st_journal.hpp"

#include <cstring>
#include <vector>

#include <fcntl.h>
#include <unistd.h>

namespace core {
namespace {

/* Cùng đa thức với StRetainStore (07 §8) — không có lý do dùng CRC khác nhau
 * giữa hai component bền vững trong cùng runtime. */
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
void put_u64(std::vector<uint8_t>* v, uint64_t x)
{
    for (int i = 0; i < 8; i++) v->push_back(static_cast<uint8_t>((x >> (8 * i)) & 0xFF));
}
void put_field(std::vector<uint8_t>* v, const std::string& s)
{
    /* Cố định kStJournalFieldMax byte, phần thừa null-pad — record fixed-size
     * để đọc lại không cần parse độ dài biến thiên (đơn giản, và một record
     * luôn chiếm đúng kRecordSize byte nên phát hiện "đuôi bị cắt cụt" chỉ
     * cần so kích thước còn lại với kRecordSize). */
    for (std::size_t i = 0; i < kStJournalFieldMax; i++)
        v->push_back(i < s.size() ? static_cast<uint8_t>(s[i]) : 0);
}
uint16_t rd_u16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
uint32_t rd_u32(const uint8_t* p)
{
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}
uint64_t rd_u64(const uint8_t* p)
{
    uint64_t v = 0;
    for (int i = 7; i >= 0; i--) v = (v << 8) | p[i];
    return v;
}
std::string rd_field(const uint8_t* p)
{
    const void* nul = std::memchr(p, 0, kStJournalFieldMax);
    const std::size_t len =
        nul ? static_cast<std::size_t>(static_cast<const uint8_t*>(nul) - p) : kStJournalFieldMax;
    return std::string(reinterpret_cast<const char*>(p), len);
}

/* magic(4) version(2) phase(1) reserved(1) timestamp_ns(8) + 4 field*64 +
 * crc32(4). CRC tính trên MỌI byte trước nó trong cùng record — đủ để phát
 * hiện bit lỗi hoặc ghi nửa vời ở BẤT KỲ đâu trong record, không chỉ payload. */
constexpr uint32_t kMagic = 0x4C4A4B4Du; /* "MKJL" little-endian */
constexpr uint16_t kVersion = 1;
constexpr std::size_t kHeaderSize = 16; /* magic+version+phase+reserved+timestamp */
constexpr std::size_t kFieldsSize = kStJournalFieldMax * 4;
constexpr std::size_t kRecordSize = kHeaderSize + kFieldsSize + 4;

bool valid_phase(uint8_t raw)
{
    /* T59-702 — trần là phase CAO NHẤT hiện có, không phải `COMMITTED`.
     *
     * Viết cứng `COMMITTED` làm mọi phase thêm sau đó bị đọc thành "record
     * hỏng": journal ghi thành công nhưng lần đọc kế tiếp lại bỏ qua nó và giữ
     * mốc cũ — một dạng mất dữ liệu im lặng, và nó đã cắn ngay ở bản ghi
     * `RECOVERY_RESET` đầu tiên. Reader CŨ gặp phase mới vẫn fail-closed đúng
     * như thiết kế; đó là chuyện của bản cũ, không phải lý do để bản mới tự
     * làm hỏng bản ghi của chính nó. */
    return raw <= static_cast<uint8_t>(StJournalPhase::RECOVERY_RESET);
}

} // namespace

const char* st_journal_phase_name(StJournalPhase phase)
{
    switch (phase) {
    case StJournalPhase::PREPARED:         return "PREPARED";
    case StJournalPhase::COMMIT_INTENT:    return "COMMIT_INTENT";
    case StJournalPhase::ACTIVE_CANDIDATE: return "ACTIVE_CANDIDATE";
    case StJournalPhase::FIRST_CYCLE_OK:   return "FIRST_CYCLE_OK";
    case StJournalPhase::COMMITTED:        return "COMMITTED";
    case StJournalPhase::RECOVERY_RESET:   return "RECOVERY_RESET";
    }
    return "?";
}

bool StJournal::append(const StJournalRecord& record)
{
    if (record.operation_id.size() > kStJournalFieldMax ||
        record.old_active_hash.size() > kStJournalFieldMax ||
        record.candidate_hash.size() > kStJournalFieldMax ||
        record.plan_hash.size() > kStJournalFieldMax)
        return false;

    std::vector<uint8_t> bytes;
    bytes.reserve(kRecordSize);
    put_u32(&bytes, kMagic);
    put_u16(&bytes, kVersion);
    bytes.push_back(static_cast<uint8_t>(record.phase));
    bytes.push_back(0); /* reserved */
    put_u64(&bytes, record.timestamp_ns);
    put_field(&bytes, record.operation_id);
    put_field(&bytes, record.old_active_hash);
    put_field(&bytes, record.candidate_hash);
    put_field(&bytes, record.plan_hash);
    put_u32(&bytes, crc32(bytes.data(), bytes.size()));

    /* O_APPEND: kernel bảo đảm mỗi write() nối vào ĐÚNG cuối file, kể cả nếu
     * có tiến trình khác (không xảy ra ở đây, nhưng không dựa vào giả định
     * đơn tiến trình). Một write() duy nhất cho toàn bộ record — không có
     * cách nào để lại NỬA record trừ khi crash giữa lúc kernel ghi, và đó
     * đúng là tình huống read_last() phải xử lý êm bằng cách phát hiện đuôi
     * ngắn hơn kRecordSize. */
    const int fd = ::open(path_.c_str(), O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0640);
    if (fd < 0) return false;

    std::size_t written = 0;
    while (written < bytes.size()) {
        const ssize_t n = ::write(fd, bytes.data() + written, bytes.size() - written);
        if (n <= 0) { ::close(fd); return false; }
        written += static_cast<std::size_t>(n);
    }
    if (::fsync(fd) != 0) { ::close(fd); return false; }
    ::close(fd);

    const std::size_t slash = path_.find_last_of('/');
    const std::string dir = (slash == std::string::npos) ? "." : path_.substr(0, slash);
    const int dfd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) { ::fsync(dfd); ::close(dfd); }
    return true;
}

StJournalReadResult StJournal::read_last() const
{
    StJournalReadResult result;

    const int fd = ::open(path_.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd < 0) { result.status = StJournalReadStatus::EMPTY; return result; }

    std::vector<uint8_t> data;
    uint8_t buf[4096];
    for (;;) {
        const ssize_t n = ::read(fd, buf, sizeof(buf));
        if (n < 0) { ::close(fd); result.status = StJournalReadStatus::CORRUPT; return result; }
        if (n == 0) break;
        data.insert(data.end(), buf, buf + n);
    }
    ::close(fd);

    if (data.empty()) { result.status = StJournalReadStatus::EMPTY; return result; }

    std::size_t offset = 0;
    bool have_valid = false;
    StJournalRecord last;
    while (offset + kRecordSize <= data.size()) {
        const uint8_t* p = data.data() + offset;
        const bool ok = rd_u32(p) == kMagic && rd_u16(p + 4) == kVersion &&
                        valid_phase(p[6]) && p[7] == 0 &&
                        rd_u32(p + kRecordSize - 4) == crc32(p, kRecordSize - 4);
        if (!ok) {
            /* Record giữa file hỏng (không phải đuôi bị cắt cụt — đủ byte
             * nhưng CRC/magic sai) là dữ liệu KHÔNG tin được từ điểm này trở
             * đi; record trước đó (nếu có) vẫn là mốc hợp lệ cuối cùng. Nếu
             * đây là record ĐẦU TIÊN thì không có mốc nào cả -> CORRUPT. */
            if (!have_valid) { result.status = StJournalReadStatus::CORRUPT; return result; }
            break;
        }
        last.phase = static_cast<StJournalPhase>(p[6]);
        last.timestamp_ns = rd_u64(p + 8);
        last.operation_id = rd_field(p + kHeaderSize);
        last.old_active_hash = rd_field(p + kHeaderSize + kStJournalFieldMax);
        last.candidate_hash = rd_field(p + kHeaderSize + kStJournalFieldMax * 2);
        last.plan_hash = rd_field(p + kHeaderSize + kStJournalFieldMax * 3);
        have_valid = true;
        result.valid_record_count++;
        offset += kRecordSize;
    }

    result.truncated_tail_bytes = static_cast<uint64_t>(data.size() - offset);
    if (!have_valid) {
        /* Có byte trong file nhưng chưa đủ MỘT record hoàn chỉnh — đây vẫn
         * là "chưa từng commit gì", không phải hỏng: crash giữa lúc ghi
         * record ĐẦU TIÊN trông giống hệt chưa từng ghi. */
        result.status = StJournalReadStatus::EMPTY;
        return result;
    }
    result.status = StJournalReadStatus::OK;
    result.record = last;
    return result;
}

bool StJournal::erase() const
{
    return ::unlink(path_.c_str()) == 0 || errno == ENOENT;
}

StJournalBootAction st_journal_decide_boot_action(const StJournalReadResult& read)
{
    if (read.status == StJournalReadStatus::CORRUPT)
        return StJournalBootAction::NO_VALID_RECORD_RAISE_INCIDENT;
    if (read.status == StJournalReadStatus::EMPTY)
        return StJournalBootAction::KEEP_OLD_ACTIVE_DISCARD_CANDIDATE;

    switch (read.record.phase) {
    case StJournalPhase::PREPARED:
        return StJournalBootAction::KEEP_OLD_ACTIVE_DISCARD_CANDIDATE;
    case StJournalPhase::COMMIT_INTENT:
        return StJournalBootAction::KEEP_OLD_ACTIVE_MARK_OPERATION_FAILED;
    case StJournalPhase::ACTIVE_CANDIDATE:
        return StJournalBootAction::USE_LKG_CANDIDATE_NOT_AUTO_PUBLISHED;
    case StJournalPhase::FIRST_CYCLE_OK:
        return StJournalBootAction::VERIFY_ACTIVE_THEN_FINISH_OR_LKG;
    case StJournalPhase::COMMITTED:
        return StJournalBootAction::USE_COMMITTED_ACTIVE;
    case StJournalPhase::RECOVERY_RESET:
        return StJournalBootAction::COLD_START_AFTER_RECOVERY_RESET;
    }
    return StJournalBootAction::NO_VALID_RECORD_RAISE_INCIDENT;
}

} // namespace core
