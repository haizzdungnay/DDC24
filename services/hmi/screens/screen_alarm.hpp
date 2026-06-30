#ifndef HMI_SCREEN_ALARM_HPP
#define HMI_SCREEN_ALARM_HPP

#include "screens/screen_base.hpp"

#include <vector>

namespace hmi {

class ScreenAlarm final : public ScreenBase {
public:
    explicit ScreenAlarm(AlarmModel* model) : model_(model) {}
    void build(lv_obj_t* root, const Locale& l, const PointDb& db) override;
    void on_data_update(const DataCache& c, const PointDb& db, const Locale& l) override;
    void rebuild_labels(const Locale& l) override;
    void on_key(uint32_t key, lv_indev_state_t state) override;

private:
    enum class Filter { ACTIVE, ALL, UNACKED };
    AlarmModel* model_ = nullptr;
    const Locale* locale_ = nullptr;
    lv_obj_t* title_ = nullptr;
    lv_obj_t* summary_ = nullptr;
    static constexpr int VISIBLE_ROWS = 4;
    lv_obj_t* rows_[VISIBLE_ROWS]{};
    lv_obj_t* ack_btn_ = nullptr;
    lv_obj_t* ack_label_ = nullptr;
    lv_obj_t* filter_btn_ = nullptr;
    lv_obj_t* filter_label_ = nullptr;
    int selected_ = 0;
    Filter filter_ = Filter::ACTIVE;

    std::vector<int> visible_indices(const std::array<AlarmEntry, AlarmModel::RING>& snap) const;
    void render();
    void ack_selected();
    void cycle_filter();
    static void ack_cb(lv_event_t* e);
    static void filter_cb(lv_event_t* e);
};

} // namespace hmi
#endif
