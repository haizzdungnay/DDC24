#ifndef HMI_SCREEN_IO_HPP
#define HMI_SCREEN_IO_HPP

#include "screens/screen_base.hpp"

#include <vector>

namespace hmi {

class ScreenIo final : public ScreenBase {
public:
    void build(lv_obj_t* root, const Locale& l, const PointDb& db) override;
    void on_data_update(const DataCache& c, const PointDb& db, const Locale& l) override;
    void rebuild_labels(const Locale& l) override;
    void on_key(uint32_t key, lv_indev_state_t state) override;

private:
    enum class Filter { ALL, BAD, STALE };
    struct Row {
        std::string id, name, type, unit;
        float value = 0.0f;
        uint8_t quality = KX_Q_GOOD;
        bool stale = false;
    };
    lv_obj_t* title_ = nullptr;
    lv_obj_t* header_ = nullptr;
    static constexpr int VISIBLE_ROWS = 5;
    lv_obj_t* row_labels_[VISIBLE_ROWS]{};
    lv_obj_t* filter_btn_ = nullptr;
    lv_obj_t* filter_label_ = nullptr;
    lv_obj_t* page_label_ = nullptr;
    DataCache cache_{};
    const PointDb* db_ = nullptr;
    const Locale* locale_ = nullptr;
    Filter filter_ = Filter::ALL;
    size_t offset_ = 0;

    std::vector<Row> rows() const;
    void render();
    void cycle_filter();
    static void filter_cb(lv_event_t* e);
};

} // namespace hmi
#endif
