/**
 * @file  st_retain.hpp
 * @brief Bản ghi RETAIN cho Program Instance, theo
 *        PROGRAM_TASK_SCHEDULER_SPEC §8 và ST_SUBSET_SPEC §7.
 *
 *        Ba bất biến quyết định thiết kế file này:
 *
 *        1. Bản ghi sai KHÔNG BAO GIỜ là lý do để không khởi động chương
 *           trình. Từ chối bản ghi -> cold start + chẩn đoán, không phải
 *           dừng máy.
 *        2. Ghi phải ATOMIC. Mất điện giữa lúc ghi không được để lại file
 *           nửa vời mà lần sau đọc vào tưởng là hợp lệ.
 *        3. Đổi layout biến RETAIN = mất giá trị retain, và điều đó phải
 *           HIỆN RA (mã chẩn đoán) chứ không âm thầm đọc bytes của layout cũ.
 */
#ifndef CORE_ST_RETAIN_HPP
#define CORE_ST_RETAIN_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "st/st_loader.hpp"

namespace core {

/* Lý do một bản ghi retain bị từ chối (SPEC §8). */
namespace st_retain_error {
constexpr const char* kBadMagicOrVersion = "RT-RETAIN-001";
constexpr const char* kBadCrc            = "RT-RETAIN-002";
constexpr const char* kLayoutMismatch    = "RT-RETAIN-003";
constexpr const char* kBadRecordSize     = "RT-RETAIN-004";
} // namespace st_retain_error

namespace st_retain {
constexpr uint32_t kMagic = 0x54524B4Du;   /* "MKRT" little-endian */
constexpr uint16_t kVersion = 1;
/* Giãn cách ghi tối thiểu. Với eMMC >= 3000 chu kỳ P/E và wear-leveling,
 * ~1440 lần ghi/ngày/instance để lại biên rất lớn (SPEC §8). */
constexpr uint64_t kMinWriteIntervalNs = 60ull * 1000000000ull;
} // namespace st_retain

struct StRetainResult {
    bool        restored = false;
    const char* reject_code = nullptr;   /* nullptr khi restored hoặc khi chưa có file */
    std::string message;
};

class StRetainStore {
public:
    /* `path` là file của RIÊNG instance này. */
    explicit StRetainStore(std::string path) : path_(std::move(path)) {}

    /* Đọc bản ghi và nạp vào slot của `prog`. Không có file -> cold start
     * lặng lẽ (restored=false, reject_code=nullptr) vì lần chạy đầu tiên là
     * bình thường, không phải lỗi. */
    StRetainResult restore(StLoadedProgram* prog) const;

    /* Ghi nếu (a) giá trị RETAIN đã đổi so với lần ghi trước, VÀ (b) đã qua
     * kMinWriteIntervalNs. `force` bỏ qua (b) — dùng khi shutdown sạch.
     * Trả true nếu thực sự có ghi ra đĩa. */
    bool save_if_needed(const StLoadedProgram& prog, uint64_t now_ns, bool force = false);

    uint32_t write_count() const { return write_count_; }
    uint64_t last_write_ns() const { return last_write_ns_; }

    /* Xoá bản ghi — dùng khi cố ý cold-start. */
    bool erase() const;

private:
    std::string          path_;
    std::vector<uint8_t> last_written_payload_;
    uint64_t             last_write_ns_ = 0;
    uint32_t             write_count_ = 0;

    bool write_atomic(const std::vector<uint8_t>& bytes) const;
};

} // namespace core

#endif /* CORE_ST_RETAIN_HPP */
