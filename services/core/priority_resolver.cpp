#include "priority_resolver.hpp"

#include <cstdio>

namespace core {

PriorityResolver::PriorityResolver()
{
    /* mức 6 Default luôn active: AO safe 0 (0V/4mA), DO open */
    for (int ch = 0; ch < KX_N_AO; ch++) {
        ao_[PRIO_DEFAULT - 1][ch].active = true;
        ao_[PRIO_DEFAULT - 1][ch].value = 0.0f;
    }
    for (int ch = 0; ch < KX_N_DO; ch++) {
        do_[PRIO_DEFAULT - 1][ch].active = true;
        do_[PRIO_DEFAULT - 1][ch].value = 0.0f;
    }
}

bool PriorityResolver::set_ao(int level, int ch, float v)
{
    if (!valid_level(level) || ch < 0 || ch >= KX_N_AO) return false;
    Slot& s = ao_[level - 1][ch];
    if (s.active && s.value != v)
        std::fprintf(stderr, "WARN  priority.conflict ao ch=%d level=%d old=%.3f new=%.3f (nguồn sau thắng)\n",
                     ch, level, static_cast<double>(s.value), static_cast<double>(v));
    s.active = true;
    s.value = v;
    return true;
}

bool PriorityResolver::release_ao(int level, int ch)
{
    if (!valid_level(level) || level == PRIO_DEFAULT || ch < 0 || ch >= KX_N_AO) return false;
    ao_[level - 1][ch].active = false;
    return true;
}

bool PriorityResolver::set_do(int level, int ch, bool on)
{
    if (!valid_level(level) || ch < 0 || ch >= KX_N_DO) return false;
    Slot& s = do_[level - 1][ch];
    if (s.active && (s.value != 0.0f) != on)
        std::fprintf(stderr, "WARN  priority.conflict do ch=%d level=%d old=%d new=%d (nguồn sau thắng)\n",
                     ch, level, s.value != 0.0f, on);
    s.active = true;
    s.value = on ? 1.0f : 0.0f;
    return true;
}

bool PriorityResolver::release_do(int level, int ch)
{
    if (!valid_level(level) || level == PRIO_DEFAULT || ch < 0 || ch >= KX_N_DO) return false;
    do_[level - 1][ch].active = false;
    return true;
}

void PriorityResolver::set_default_ao(int ch, float v)
{
    if (ch < 0 || ch >= KX_N_AO) return;
    ao_[PRIO_DEFAULT - 1][ch].value = v;
}

void PriorityResolver::set_default_do(int ch, bool on)
{
    if (ch < 0 || ch >= KX_N_DO) return;
    do_[PRIO_DEFAULT - 1][ch].value = on ? 1.0f : 0.0f;
}

bool PriorityResolver::any_active_above_default() const
{
    for (int lv = 0; lv < PRIO_DEFAULT - 1; lv++) {
        for (int ch = 0; ch < KX_N_AO; ch++)
            if (ao_[lv][ch].active) return true;
        for (int ch = 0; ch < KX_N_DO; ch++)
            if (do_[lv][ch].active) return true;
    }
    return false;
}

int PriorityResolver::winning_ao_level(int ch) const
{
    if (ch < 0 || ch >= KX_N_AO) return PRIO_DEFAULT;
    for (int lv = 0; lv < PRIO_LEVELS; lv++)
        if (ao_[lv][ch].active) return lv + 1;
    return PRIO_DEFAULT;
}

int PriorityResolver::winning_do_level(int ch) const
{
    if (ch < 0 || ch >= KX_N_DO) return PRIO_DEFAULT;
    for (int lv = 0; lv < PRIO_LEVELS; lv++)
        if (do_[lv][ch].active) return lv + 1;
    return PRIO_DEFAULT;
}

const char* prio_source_name(int level)
{
    /* Khi thêm level mới: (1) thêm PRIO_XXX trong .hpp, (2) bump PRIO_LEVELS,
     * (3) thêm case ở đây → static_assert bắt ngay lúc build nếu quên bước này. */
    static_assert(PRIO_LEVELS == 6, "prio_source_name: thêm case mới khi PRIO_LEVELS thay đổi");
    switch (level) {
    case PRIO_FIRE_SAFETY:  return "safety";
    case PRIO_LOCAL_MANUAL: return "manual";
    case PRIO_BACNET:       return "bacnet";
    case PRIO_SCHEDULE:     return "schedule";
    case PRIO_LOCAL_LOGIC:  return "logic";
    case PRIO_DEFAULT:      return "default";
    }
    return "default";   /* out-of-range: an toàn, không thể xảy ra với level hợp lệ */
}

OutputCmd PriorityResolver::resolve() const
{
    OutputCmd out;
    for (int ch = 0; ch < KX_N_AO; ch++) {
        for (int lv = 0; lv < PRIO_LEVELS; lv++) {
            if (ao_[lv][ch].active) {
                out.ao[ch] = ao_[lv][ch].value;
                out.ao_valid[ch] = true;
                break;   /* mức cao nhất (số nhỏ nhất) thắng */
            }
        }
    }
    for (int ch = 0; ch < KX_N_DO; ch++) {
        for (int lv = 0; lv < PRIO_LEVELS; lv++) {
            if (do_[lv][ch].active) {
                out.dout[ch] = do_[lv][ch].value != 0.0f ? 1 : 0;
                out.do_valid[ch] = true;
                break;
            }
        }
    }
    return out;
}

} // namespace core
