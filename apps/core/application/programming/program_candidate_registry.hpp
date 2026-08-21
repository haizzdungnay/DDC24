/**
 * @file  program_candidate_registry.hpp
 * @brief T59-406 — sổ đăng ký candidate output theo Program (kiến trúc §7).
 *
 *        Chuỗi output là:
 *          Program candidate → owner registry → PriorityResolver → Interlock
 *          → SafeState → OutputWriter → iobus/IOP/STM32.
 *
 *        Sổ này là mắt xích "owner registry". Nó KHÔNG tự ghi ra điểm nào và
 *        không thay resolver làm trọng tài — nó trả lời đúng một câu hỏi mà
 *        trước đây không ai trả lời được: **Program nào đang giữ output nào, và
 *        vì sao nó vẫn/không còn giữ**.
 *
 *        Vì sao cần một sổ riêng thay vì đọc ngược `PriorityResolver`: resolver
 *        chỉ biết "mức 5 đang active", không biết mức 5 đó là của Program nào.
 *        Với một Program thì hai câu đó trùng nhau; với 32 Program thì "ai đang
 *        giữ AO-3" trở thành câu hỏi không có nơi nào trả lời — và đó đúng là
 *        câu hỏi đầu tiên người vận hành hỏi khi một van không nghe lệnh.
 */
#ifndef CORE_PROGRAM_CANDIDATE_REGISTRY_HPP
#define CORE_PROGRAM_CANDIDATE_REGISTRY_HPP

#include <array>
#include <cstdint>
#include <string>

#include "graph/point_table.hpp"
#include "st/st_profile_generated.hpp"

namespace core::programming {

/* Vì sao candidate bị rút. Enum ĐÓNG: "đã rút" mà không nói vì sao thì người
 * vận hành phải đoán giữa một lệnh chủ ý và một sự cố — hai thứ cần hai phản
 * ứng khác nhau. */
enum class CandidateWithdrawReason : uint8_t {
    /* Chưa rút. */
    NONE = 0,
    /* Người vận hành Disable/Stop Program. Rút NGAY tại safe boundary. */
    OPERATOR_DISABLE,
    /* Program FAULTED và đã quá TTL hold-last. */
    FAULT_TTL_EXPIRED,
    /* Package mới không còn Program này. */
    PACKAGE_REPLACED,
};

const char* candidate_withdraw_reason_name(CandidateWithdrawReason reason);

/* Một claim: (Program, điểm vật lý). */
struct CandidateClaim {
    std::string instance_id;
    PointKind   kind = PointKind::AO;
    uint16_t    index = 0;
    bool        active = false;
    CandidateWithdrawReason withdraw_reason = CandidateWithdrawReason::NONE;
    /* base step lúc claim được ghi hoặc rút — để chẩn đoán "giữ từ bao giờ". */
    uint64_t    generation = 0;
};

/* Trần claim: bằng trần binding của package (`maxBindings` trong profile). Một
 * điểm chỉ có một owner, nên số claim không bao giờ vượt số binding của cả gói.
 * Cấp phát tĩnh nên không có heap trong đường quét. */
constexpr std::size_t kMaxCandidateClaims = st_profile_generated::kMaxPackageBindings;

class ProgramCandidateRegistry {
public:
    /* Ghi nhận Program `instance_id` đang giữ điểm. Trả false khi vượt trần
     * hoặc khi điểm đã có Program KHÁC giữ.
     *
     * Từ chối claim thứ hai là bất biến của DDD §4.6: mỗi output vật lý có tối
     * đa MỘT Program owner. Check đã ép điều này trước khi biên dịch, nhưng
     * runtime không được tin lớp trước — một package có thể tới từ bundle import
     * hoặc từ một writer khác phiên bản. */
    bool claim(const std::string& instance_id, PointKind kind, uint16_t index,
               uint64_t generation, std::string* error);

    /* Rút toàn bộ claim của một Program, kèm LÝ DO. Trả số claim đã rút. */
    uint32_t withdraw_instance(const std::string& instance_id, CandidateWithdrawReason reason,
                               uint64_t generation);

    /* Xoá sạch — dùng khi nạp package mới. Giữ claim của gói cũ nghĩa là trả lời
     * sai câu "ai đang giữ điểm này". */
    void clear();

    /* Program nào đang giữ điểm; chuỗi rỗng = không ai. */
    const std::string& owner_of(PointKind kind, uint16_t index) const;
    /* Claim đang còn hiệu lực, hoặc nullptr. */
    const CandidateClaim* find(PointKind kind, uint16_t index) const;

    std::size_t size() const { return count_; }
    const CandidateClaim& at(std::size_t index) const { return claims_[index]; }
    uint32_t active_count() const;

private:
    int index_of(PointKind kind, uint16_t index) const;

    std::array<CandidateClaim, kMaxCandidateClaims> claims_{};
    std::size_t count_ = 0;
    std::string empty_;
};

} // namespace core::programming

#endif /* CORE_PROGRAM_CANDIDATE_REGISTRY_HPP */
