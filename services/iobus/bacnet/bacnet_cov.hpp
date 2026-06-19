/**
 * @file  bacnet_cov.hpp
 * @brief BAC-007: COV subscription table + change detection.
 *        AI/AO/AV: value change >= COV_Increment triggers notification.
 *        BI/BO/BV/MSV: any state change triggers notification.
 *        Pure logic — no bacnet-stack dependency.
 */
#ifndef IOBUS_BACNET_COV_HPP
#define IOBUS_BACNET_COV_HPP

#include <cstdint>
#include <vector>
#include <limits>

namespace iobus::bacnet {

/** BACnet object type codes used in COV. */
enum class BacnetObjectType : uint16_t {
    ANALOG_INPUT    = 0,
    ANALOG_OUTPUT   = 1,
    ANALOG_VALUE    = 2,
    BINARY_INPUT    = 3,
    BINARY_OUTPUT   = 4,
    BINARY_VALUE    = 5,
    MULTI_STATE_VALUE = 19,
};

struct CovSubscription {
    uint32_t        subscriber_process_id  = 0;
    uint32_t        recipient_device_id    = 0;
    /* recipient network/MAC stored as opaque tag for caller */
    uint8_t         recipient_tag[18]      = {};
    BacnetObjectType obj_type              = BacnetObjectType::ANALOG_INPUT;
    uint32_t        obj_instance           = 0;
    uint32_t        lifetime_sec           = 0;   /* 0 = indefinite per BAC-007 spec */
    uint64_t        expiry_ms              = 0;   /* 0 = never expire */
    bool            issue_confirmed        = false;
    bool            active                 = true;
};

struct ObjectCovState {
    BacnetObjectType obj_type = BacnetObjectType::ANALOG_INPUT;
    uint32_t         obj_instance = 0;
    float            last_reported_value   = std::numeric_limits<float>::quiet_NaN();
    uint8_t          last_reported_status  = 0;   /* Status_Flags bits */
    float            cov_increment         = 0.1f; /* default for analog */
};

/**
 * BAC-007: COV manager.
 * Max 64 concurrent subscriptions (PICS §3).
 */
class BacnetCov {
public:
    static constexpr int MAX_SUBS = 64;

    /**
     * Subscribe. Trả true nếu thành công.
     * Nếu đã có subscription với cùng subscriber_process_id + obj_type/instance → update.
     * Quá MAX_SUBS → trả false.
     */
    bool subscribe(const CovSubscription& sub);

    /**
     * Unsubscribe (lifetime == 0 trong SubscribeCOV request → cancel).
     * Trả true nếu tìm thấy và hủy.
     */
    bool unsubscribe(uint32_t subscriber_process_id,
                     BacnetObjectType obj_type,
                     uint32_t obj_instance);

    /**
     * Xóa subscriptions hết hạn (expiry_ms > 0 && now_ms >= expiry_ms).
     */
    void expire_subs(uint64_t now_ms);

    /**
     * Kiểm tra xem object có COV chưa dựa trên new_value + new_status.
     * Nếu có: update ObjectCovState và trả list subscriptions cần notify.
     * Nếu không: list rỗng.
     *
     * Analog (AI/AO/AV): |new_value - last_reported| >= cov_increment
     * Digital/MSV (BI/BO/BV/MSV): new_status != last_reported hoặc value != last_reported
     */
    std::vector<const CovSubscription*> check_and_update(
        BacnetObjectType obj_type,
        uint32_t obj_instance,
        float new_value,
        uint8_t new_status);

    /**
     * Lấy hoặc tạo ObjectCovState cho object.
     */
    ObjectCovState& get_state(BacnetObjectType obj_type, uint32_t obj_instance);

    /**
     * Set COV_Increment cho một object (default = 0.1).
     */
    void set_cov_increment(BacnetObjectType obj_type, uint32_t obj_instance, float increment);

    size_t sub_count() const { return subs_.size(); }

private:
    std::vector<CovSubscription>  subs_;
    std::vector<ObjectCovState>   states_;

    static bool is_analog(BacnetObjectType t)
    {
        return t == BacnetObjectType::ANALOG_INPUT
            || t == BacnetObjectType::ANALOG_OUTPUT
            || t == BacnetObjectType::ANALOG_VALUE;
    }
};

} // namespace iobus::bacnet

#endif /* IOBUS_BACNET_COV_HPP */
