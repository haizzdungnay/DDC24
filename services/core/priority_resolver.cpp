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

void PriorityResolver::set_ao(int level, int ch, float v)
{
    if (!valid_level(level) || ch < 0 || ch >= KX_N_AO) return;
    Slot& s = ao_[level - 1][ch];
    if (s.active && s.value != v)
        std::fprintf(stderr, "WARN  priority.conflict ao ch=%d level=%d old=%.3f new=%.3f (nguồn sau thắng)\n",
                     ch, level, static_cast<double>(s.value), static_cast<double>(v));
    s.active = true;
    s.value = v;
}

void PriorityResolver::release_ao(int level, int ch)
{
    if (!valid_level(level) || level == PRIO_DEFAULT || ch < 0 || ch >= KX_N_AO) return;
    ao_[level - 1][ch].active = false;
}

void PriorityResolver::set_do(int level, int ch, bool on)
{
    if (!valid_level(level) || ch < 0 || ch >= KX_N_DO) return;
    Slot& s = do_[level - 1][ch];
    if (s.active && (s.value != 0.0f) != on)
        std::fprintf(stderr, "WARN  priority.conflict do ch=%d level=%d old=%d new=%d (nguồn sau thắng)\n",
                     ch, level, s.value != 0.0f, on);
    s.active = true;
    s.value = on ? 1.0f : 0.0f;
}

void PriorityResolver::release_do(int level, int ch)
{
    if (!valid_level(level) || level == PRIO_DEFAULT || ch < 0 || ch >= KX_N_DO) return;
    do_[level - 1][ch].active = false;
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
