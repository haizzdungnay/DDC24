#include "programming/program_candidate_registry.hpp"

namespace core::programming {

const char* candidate_withdraw_reason_name(CandidateWithdrawReason reason)
{
    switch (reason) {
    case CandidateWithdrawReason::NONE: return "NONE";
    case CandidateWithdrawReason::OPERATOR_DISABLE: return "OPERATOR_DISABLE";
    case CandidateWithdrawReason::FAULT_TTL_EXPIRED: return "FAULT_TTL_EXPIRED";
    case CandidateWithdrawReason::PACKAGE_REPLACED: return "PACKAGE_REPLACED";
    case CandidateWithdrawReason::SIGNAL_BLOCKED: return "SIGNAL_BLOCKED";
    }
    return "?";
}

int ProgramCandidateRegistry::index_of(PointKind kind, uint16_t index) const
{
    for (std::size_t slot = 0; slot < count_; ++slot)
        if (claims_[slot].kind == kind && claims_[slot].index == index)
            return static_cast<int>(slot);
    return -1;
}

bool ProgramCandidateRegistry::claim(const std::string& instance_id, PointKind kind,
                                     uint16_t index, uint64_t generation, std::string* error)
{
    if (instance_id.empty()) {
        if (error) *error = "claim không có instance id";
        return false;
    }
    const int slot = index_of(kind, index);
    if (slot >= 0) {
        CandidateClaim& existing = claims_[static_cast<std::size_t>(slot)];
        if (existing.instance_id != instance_id) {
            /* Hai Program cùng giữ một output vật lý là hai nguồn sự thật cho
             * cùng một van. Check đã chặn ở lớp trước, nhưng gói có thể tới từ
             * bundle import hoặc writer khác phiên bản — runtime không được tin
             * lớp trước ở một bất biến an toàn. */
            if (error)
                *error = "điểm đã thuộc Program '" + existing.instance_id + "'";
            return false;
        }
        /* Cùng Program claim lại: hồi phục sau khi bị rút. */
        existing.active = true;
        existing.withdraw_reason = CandidateWithdrawReason::NONE;
        existing.generation = generation;
        return true;
    }
    if (count_ >= kMaxCandidateClaims) {
        if (error) *error = "vượt trần claim candidate";
        return false;
    }
    CandidateClaim& fresh = claims_[count_++];
    fresh.instance_id = instance_id;
    fresh.kind = kind;
    fresh.index = index;
    fresh.active = true;
    fresh.withdraw_reason = CandidateWithdrawReason::NONE;
    fresh.generation = generation;
    return true;
}

uint32_t ProgramCandidateRegistry::withdraw_instance(const std::string& instance_id,
                                                     CandidateWithdrawReason reason,
                                                     uint64_t generation)
{
    uint32_t withdrawn = 0;
    for (std::size_t slot = 0; slot < count_; ++slot) {
        CandidateClaim& claim = claims_[slot];
        if (claim.instance_id != instance_id || !claim.active) continue;
        /* KHÔNG xoá bản ghi, chỉ đánh dấu. Xoá sẽ làm câu hỏi "vì sao van này
         * về default" mất câu trả lời đúng vào lúc cần nó nhất. */
        claim.active = false;
        claim.withdraw_reason = reason;
        claim.generation = generation;
        ++withdrawn;
    }
    return withdrawn;
}

void ProgramCandidateRegistry::clear() { count_ = 0; }

const std::string& ProgramCandidateRegistry::owner_of(PointKind kind, uint16_t index) const
{
    const int slot = index_of(kind, index);
    if (slot < 0) return empty_;
    const CandidateClaim& claim = claims_[static_cast<std::size_t>(slot)];
    return claim.active ? claim.instance_id : empty_;
}

const CandidateClaim* ProgramCandidateRegistry::find(PointKind kind, uint16_t index) const
{
    const int slot = index_of(kind, index);
    return slot < 0 ? nullptr : &claims_[static_cast<std::size_t>(slot)];
}

uint32_t ProgramCandidateRegistry::active_count() const
{
    uint32_t active = 0;
    for (std::size_t slot = 0; slot < count_; ++slot)
        if (claims_[slot].active) ++active;
    return active;
}

} // namespace core::programming
