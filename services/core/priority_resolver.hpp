/**
 * @file  priority_resolver.hpp
 * @brief 6 mức priority → 1 output/kênh (07 §4, PRODUCT_DEFINITION §13).
 *        1=Fire/Safety .. 6=Default. Mọi DO/AO PHẢI đi qua đây.
 */
#ifndef CORE_PRIORITY_RESOLVER_HPP
#define CORE_PRIORITY_RESOLVER_HPP

#include <cstdint>

#include "mkddc_shm.h"

namespace core {

constexpr int PRIO_FIRE_SAFETY = 1;
constexpr int PRIO_LOCAL_MANUAL = 2;
constexpr int PRIO_BACNET = 3;
constexpr int PRIO_SCHEDULE = 4;
constexpr int PRIO_LOCAL_LOGIC = 5;
constexpr int PRIO_DEFAULT = 6;
constexpr int PRIO_LEVELS = 6;

struct OutputCmd {
    float   ao[KX_N_AO] = {};
    bool    ao_valid[KX_N_AO] = {};
    uint8_t dout[KX_N_DO] = {};
    bool    do_valid[KX_N_DO] = {};
};

class PriorityResolver {
public:
    PriorityResolver();

    /* nguồn ghi: level 1..6 */
    void set_ao(int level, int ch, float v);
    void release_ao(int level, int ch);
    void set_do(int level, int ch, bool on);
    void release_do(int level, int ch);

    /* default (mức 6) từ config io_safe_state — luôn active */
    void set_default_ao(int ch, float v);
    void set_default_do(int ch, bool on);

    /* Mức active cao nhất thắng; không ai active → default mức 6. */
    OutputCmd resolve() const;

    /* Có nguồn nào (mức 1..5) đang active không — đầu vào safety trigger T7 (07 §5.2). */
    bool any_active_above_default() const;

    /* Mức đang thắng (1..6) của kênh — web_ipc dùng trả overridden/active_source
     * (07 §8). Kênh sai → PRIO_DEFAULT. */
    int winning_ao_level(int ch) const;
    int winning_do_level(int ch) const;

private:
    struct Slot {
        bool  active = false;
        float value = 0.0f;
    };
    Slot ao_[PRIO_LEVELS][KX_N_AO];   /* [level-1][ch] */
    Slot do_[PRIO_LEVELS][KX_N_DO];

    static bool valid_level(int level) { return level >= 1 && level <= PRIO_LEVELS; }
};

/* Tên nguồn theo mức cho response/audit (07 §8): 1=safety 2=manual 3=bacnet
 * 4=schedule 5=logic 6=default. */
const char* prio_source_name(int level);

} // namespace core

#endif /* CORE_PRIORITY_RESOLVER_HPP */
