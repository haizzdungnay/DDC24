/**
 * @file  bacnet_priority.hpp
 * @brief BAC-006: BACnet Priority_Array[16] + Relinquish_Default per commandable object.
 *        Maintain full Priority_Array; resolve winner; send to core.sock source=bacnet.
 *        Không depend on bacnet-stack — pure logic, compile mà không cần library.
 */
#ifndef IOBUS_BACNET_PRIORITY_HPP
#define IOBUS_BACNET_PRIORITY_HPP

#include <cstdint>
#include <cstring>
#include <limits>
#include <string>

namespace iobus::bacnet {

/* NULL priority slot = NaN */
static inline bool prio_is_null(float v)
{
    return v != v;   /* NaN check */
}
static inline float prio_null() { return std::numeric_limits<float>::quiet_NaN(); }

struct PriorityArray {
    float  slots[16];          /* slots[0] = priority 1 (highest) */
    float  relinquish_default = 0.0f;

    PriorityArray() { for (int i = 0; i < 16; i++) slots[i] = prio_null(); }

    /* Set slot (prio 1..16). */
    void set(uint8_t prio, float value)
    {
        if (prio < 1 || prio > 16) return;
        slots[prio - 1] = value;
    }

    /* Clear slot (write NULL). */
    void clear(uint8_t prio)
    {
        if (prio < 1 || prio > 16) return;
        slots[prio - 1] = prio_null();
    }

    /* Trả true nếu tất cả slots đều NULL. */
    bool is_empty() const
    {
        for (int i = 0; i < 16; i++)
            if (!prio_is_null(slots[i])) return false;
        return true;
    }

    /* Winning value: lowest priority slot non-NULL; nếu empty → relinquish_default. */
    float winner() const
    {
        for (int i = 0; i < 16; i++)
            if (!prio_is_null(slots[i])) return slots[i];
        return relinquish_default;
    }

    /* Index của winning slot (0-based, 0..15); -1 nếu empty → relinquish_default. */
    int winning_slot() const
    {
        for (int i = 0; i < 16; i++)
            if (!prio_is_null(slots[i])) return i;
        return -1;
    }
};

/* Object types cần Priority_Array (commandable). */
enum class CmdObjectType { AO, BO, AV, BV, MSV };

/**
 * BAC-006: manager cho Priority_Array của tất cả commandable objects.
 * Objects: AO×4, BO×4, AV×32, BV×16, MSV×8.
 * Instance 1-based (AO1..AO4 → idx 0..3).
 */
class BacnetPriority {
public:
    BacnetPriority();

    /* Set slot N tại priority prio (1..16) cho object type/instance.
     * Sau đó: resolve winner → gọi core_sock_write hoặc core_sock_release.
     * Trả true nếu cần gửi mới (winner thay đổi). */
    bool write(CmdObjectType type, uint32_t instance, uint8_t prio, float value);

    /* Xóa slot N.
     * Nếu array còn slot khác: resolve winner mới → write.
     * Nếu array rỗng sau khi xóa → release.
     * Trả true nếu cần gửi mới. */
    bool relinquish(CmdObjectType type, uint32_t instance, uint8_t prio);

    /* Đọc Priority_Array (BACnet ReadProperty). */
    const PriorityArray* get_array(CmdObjectType type, uint32_t instance) const;

    /* Set Relinquish_Default. */
    void set_relinquish_default(CmdObjectType type, uint32_t instance, float v);

    /* Sau khi core trả overridden: BACnet giữ array nguyên, applied_value = từ core. */
    void on_overridden(CmdObjectType type, uint32_t instance, float applied_value);

    /* Applied value (Present_Value thực tế = core applied_value hoặc winner khi accepted). */
    float applied_value(CmdObjectType type, uint32_t instance) const;

private:
    static constexpr int N_AO  = 4;
    static constexpr int N_BO  = 4;
    static constexpr int N_AV  = 32;
    static constexpr int N_BV  = 16;
    static constexpr int N_MSV = 8;

    PriorityArray ao_[N_AO];
    PriorityArray bo_[N_BO];
    PriorityArray av_[N_AV];
    PriorityArray bv_[N_BV];
    PriorityArray msv_[N_MSV];

    float ao_applied_[N_AO]   = {};
    float bo_applied_[N_BO]   = {};
    float av_applied_[N_AV]   = {};
    float bv_applied_[N_BV]   = {};
    float msv_applied_[N_MSV] = {};

    PriorityArray* get_array_rw(CmdObjectType type, uint32_t instance);
    float* get_applied(CmdObjectType type, uint32_t instance);
    int max_count(CmdObjectType type) const;
};

} // namespace iobus::bacnet

#endif /* IOBUS_BACNET_PRIORITY_HPP */
