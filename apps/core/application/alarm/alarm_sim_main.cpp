/**
 * @file  alarm_sim_main.cpp
 * @brief mkddc-alarm-sim — mô phỏng luật cảnh báo bằng ĐÚNG engine của controller.
 *
 * `T57-2.13`/`T57-3.13` và `ADR-048`: "mô phỏng phải dùng chung engine đánh giá
 * với controller". Đây là bản song sinh của `mkddc-schedule-sim` (Plan 50
 * SCHD-133) cho phía cảnh báo.
 *
 * VÌ SAO KHÔNG CÀI LẠI THUẬT TOÁN TRONG BACKEND
 *
 * Ngữ nghĩa luật cảnh báo — thứ tự HH/H/L/LL, vùng trễ (hysteresis), trễ kích
 * hoạt, chế độ latched, cách chọn mức nghiêm trọng theo `severityRules` — nằm ở
 * `alarm_runtime.cpp`. Một bản cài lại trong Go sẽ đúng cho tới ngày hai bản
 * lệch nhau, và ngày đó **không ai biết**: người dùng chỉ thấy "mô phỏng bảo sẽ
 * báo động mà thiết bị thì không". Với một màn hình dùng để ĐẶT NGƯỠNG AN TOÀN,
 * sai lệch âm thầm là loại lỗi tệ nhất có thể có.
 *
 * Binary này vì thế chỉ là một cái vỏ mỏng: nạp luật qua `parse_alarm_config_json`
 * (đúng bộ phân tích + ràng buộc của controller), bơm mẫu vào `PointTable`, gọi
 * `AlarmRuntime::evaluate` từng bước, rồi ghi lại các lần CHUYỂN TRẠNG THÁI.
 *
 * Dùng:
 *   mkddc-alarm-sim --stdin-json      (đọc JSON ở stdin)
 *
 * Vào (stdin):
 *   { "setting": { …đúng schema một phần tử của alarms.json… },
 *     "samples": [ {"t":"2026-08-19T10:00:00Z","value":72.5}, … ] }
 *
 * Ra (stdout) — một mảng JSON, không bọc thêm:
 *   [ {"at":"…","event":"raised","severity":"high","value":72.5,
 *      "reason":"vượt ngưỡng H = 70"}, … ]
 *
 * Mã thoát: 0 thành công, 1 tham số sai, 2 stdin không phải JSON hợp lệ,
 *           3 luật không hợp lệ (thông điệp chi tiết ở stderr).
 *
 * MỘT DIỄN GIẢI PHẢI NÓI RÕ: khi luật có NHIỀU nguồn, yêu cầu chỉ mang MỘT chuỗi
 * mẫu, nên chuỗi đó được bơm vào **mọi** nguồn. Cách khác — chỉ bơm vào nguồn
 * đầu — sẽ để các nguồn còn lại đứng ở 0.0 và có thể tự kích hoạt nhánh LOW, tức
 * là bịa ra một cảnh báo không đến từ dữ liệu người dùng đưa vào.
 */
#include <nlohmann/json.hpp>

#include <cstdio>
#include <cstring>
#include <ctime>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "alarm/alarm_runtime.hpp"
#include "graph/clock_snapshot.hpp"
#include "graph/point_table.hpp"
#include "ports/io_snapshot.hpp"

using namespace core;

namespace {

/* Đọc mốc thời gian ISO-8601 UTC. Trả false khi không đọc được — KHÔNG rơi về
 * "bây giờ": khoảng cách giữa các mẫu chính là thứ quyết định trễ kích hoạt có
 * đạt hay không, nên một mốc đoán bừa sẽ đổi hẳn kết quả mô phỏng. */
bool parse_iso_utc(const std::string& text, int64_t* out_epoch_ms)
{
    int year = 0, month = 0, day = 0, hour = 0, minute = 0;
    double second = 0.0;
    if (std::sscanf(text.c_str(), "%d-%d-%dT%d:%d:%lf",
                    &year, &month, &day, &hour, &minute, &second) < 5) {
        return false;
    }
    std::tm tm{};
    tm.tm_year = year - 1900;
    tm.tm_mon = month - 1;
    tm.tm_mday = day;
    tm.tm_hour = hour;
    tm.tm_min = minute;
    tm.tm_sec = static_cast<int>(second);
    const time_t seconds = timegm(&tm);
    if (seconds == static_cast<time_t>(-1)) return false;
    *out_epoch_ms = static_cast<int64_t>(seconds) * 1000 +
                    static_cast<int64_t>((second - static_cast<int>(second)) * 1000.0);
    return true;
}

std::string iso_utc(int64_t epoch_ms)
{
    const std::time_t seconds = static_cast<std::time_t>(epoch_ms / 1000);
    std::tm tm{};
    gmtime_r(&seconds, &tm);
    char buf[32];
    if (std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm) == 0) {
        return "1970-01-01T00:00:00Z";
    }
    return buf;
}

/* Bơm một giá trị vào PointTable theo đúng loại điểm của nguồn.
 *
 * `IoSnapshot` được giữ giữa các bước vì `update_inputs` ghi lại TOÀN BỘ khối
 * vào bảng; dựng snapshot mới mỗi bước sẽ xoá giá trị của các nguồn khác. */
void apply_value(PointTable* table, IoSnapshot* io, const PointId& point, double value,
                 int64_t epoch_ms)
{
    io->ts_ns = static_cast<uint64_t>(epoch_ms) * 1000000ull;
    switch (point.kind) {
    case PointKind::AI:
        if (point.idx >= 0 && point.idx < KX_N_UI) {
            io->ui_value[point.idx] = static_cast<float>(value);
            io->ui_quality[point.idx] = KX_Q_GOOD;
        }
        table->update_inputs(*io);
        break;
    case PointKind::AO:
        if (point.idx >= 0 && point.idx < KX_N_AO) {
            io->ao_setpoint[point.idx] = static_cast<float>(value);
        }
        table->update_inputs(*io);
        break;
    case PointKind::BO:
        if (point.idx >= 0 && point.idx < KX_N_DO) {
            io->do_feedback[point.idx] = value != 0.0 ? 1 : 0;
        }
        table->update_inputs(*io);
        break;
    default:
        /* AV/BV/MSV — nguồn ảo. Nguồn ghi là WEB vì trong mô phỏng, giá trị đến
         * từ chuỗi mà người dùng đưa vào chứ không phải từ graph. */
        table->set_virtual(point, static_cast<float>(value), PointSource::WEB);
        break;
    }
}

/* Câu giải thích đi kèm mỗi sự kiện. Nói THEO NGƯỠNG NÀO bị vượt, vì "raised"
 * trần trụi không giúp gì cho người đang chỉnh chính cái ngưỡng đó. */
std::string reason_for(const std::string& level, double threshold)
{
    if (level == "HH") return "vượt ngưỡng HH = " + nlohmann::json(threshold).dump();
    if (level == "H")  return "vượt ngưỡng H = " + nlohmann::json(threshold).dump();
    if (level == "L")  return "xuống dưới ngưỡng L = " + nlohmann::json(threshold).dump();
    if (level == "LL") return "xuống dưới ngưỡng LL = " + nlohmann::json(threshold).dump();
    if (level == "RUNTIME") return "đạt giờ chạy bảo trì = " + nlohmann::json(threshold).dump();
    return {};
}

struct Snapshot {
    bool active = false;
    uint64_t occurrence = 0;
};

} // namespace

int main(int argc, char** argv)
{
    bool stdin_json = false;
    for (int i = 1; i < argc; i++) {
        if (std::strcmp(argv[i], "--stdin-json") == 0) stdin_json = true;
    }
    if (!stdin_json) {
        std::fprintf(stderr, "dùng: mkddc-alarm-sim --stdin-json\n");
        return 1;
    }

    std::ostringstream buffer;
    buffer << std::cin.rdbuf();
    const std::string input = buffer.str();

    nlohmann::json payload;
    try {
        payload = nlohmann::json::parse(input);
    } catch (const std::exception& e) {
        std::fprintf(stderr, "ERROR alarm_sim.bad_json (%s)\n", e.what());
        return 2;
    }
    if (!payload.is_object() || !payload.contains("setting") || !payload.contains("samples")) {
        std::fprintf(stderr, "ERROR alarm_sim.bad_payload (cần setting + samples)\n");
        return 2;
    }

    /* Nạp luật bằng ĐÚNG bộ phân tích của controller: mô phỏng phải từ chối
     * chính xác những cấu hình mà thiết bị sẽ từ chối. */
    std::vector<AlarmEntityConfig> entities;
    nlohmann::json as_array = nlohmann::json::array();
    nlohmann::json rule = payload["setting"];
    /* Bật luật TRƯỚC khi phân tích. Bộ nạp của controller loại thẳng luật đang
     * tắt khỏi danh sách — hợp lý với thiết bị đang chạy, nhưng sẽ làm màn hình
     * thử vô dụng đúng lúc nó có ích nhất: người dùng luôn thử ngưỡng trước rồi
     * mới bật. Chỉ cờ `enabled` bị đổi; mọi ràng buộc khác vẫn phải qua đúng bộ
     * kiểm của controller. */
    rule["enabled"] = true;
    as_array.push_back(rule);
    if (!parse_alarm_config_json(as_array.dump(), "stdin", &entities) || entities.empty()) {
        std::fprintf(stderr, "ERROR alarm_sim.bad_setting\n");
        return 3;
    }

    AlarmRuntime runtime;
    /* `configure` nhận theo giá trị, nên `entities` vẫn dùng được sau lời gọi —
     * đó là nơi lấy danh sách nguồn để bơm mẫu. */
    runtime.configure(entities);
    const std::vector<AlarmSourceConfig> sources = entities.front().sources;

    PointTable table;
    IoSnapshot io;
    io.valid = true;
    io.iop_status = KX_IOP_NORMAL;

    nlohmann::json events = nlohmann::json::array();
    std::map<std::string, Snapshot> previous;
    int64_t first_epoch_ms = 0;
    bool have_first = false;

    for (const auto& sample : payload["samples"]) {
        std::string stamp;
        if (sample.contains("t") && sample["t"].is_string()) stamp = sample["t"].get<std::string>();
        int64_t epoch_ms = 0;
        if (!parse_iso_utc(stamp, &epoch_ms)) {
            std::fprintf(stderr, "ERROR alarm_sim.bad_timestamp t=%s\n", stamp.c_str());
            return 2;
        }
        double value = 0.0;
        if (sample.contains("value") && sample["value"].is_number()) {
            value = sample["value"].get<double>();
        }
        if (!have_first) {
            first_epoch_ms = epoch_ms;
            have_first = true;
        }

        for (const AlarmSourceConfig& source : sources) {
            apply_value(&table, &io, source.point, value, epoch_ms);
        }

        ClockSnapshot clock;
        /* Cộng 1 s vào gốc: `evaluate` coi `monotonic_ns == 0` là "chưa có mốc
         * trước" nên dt của bước kế tiếp sẽ bị nuốt mất — và trễ kích hoạt sẽ
         * đếm thiếu đúng một bước. */
        clock.monotonic_ns = 1000000000ull +
                             static_cast<uint64_t>(epoch_ms - first_epoch_ms) * 1000000ull;
        clock.utc_epoch_ms = epoch_ms;
        runtime.evaluate(table, clock);

        std::map<std::string, Snapshot> current;
        for (const AlarmState& state : runtime.active_states()) {
            current[state.alarm_setting_id] = {state.active, state.occurrence};
            const Snapshot before = previous.count(state.alarm_setting_id)
                                        ? previous[state.alarm_setting_id]
                                        : Snapshot{};
            const bool newly_active = state.active && (!before.active || state.occurrence != before.occurrence);
            if (newly_active) {
                events.push_back({{"at", iso_utc(epoch_ms)},
                                  {"event", "raised"},
                                  {"severity", state.priority},
                                  {"value", state.value},
                                  {"reason", reason_for(state.trigger_level, state.threshold)}});
            } else if (!state.active && before.active) {
                events.push_back({{"at", iso_utc(epoch_ms)},
                                  {"event", "cleared"},
                                  {"severity", state.priority},
                                  {"value", value},
                                  {"reason", "điều kiện hết"}});
            }
        }
        /* Ở chế độ `auto` đã ack, luật biến mất hẳn khỏi `active_states()` khi
         * hết điều kiện — biến mất cũng là "hết cảnh báo", không phải là không
         * có gì xảy ra. */
        for (const auto& entry : previous) {
            if (entry.second.active && current.find(entry.first) == current.end()) {
                events.push_back({{"at", iso_utc(epoch_ms)},
                                  {"event", "cleared"},
                                  {"severity", ""},
                                  {"value", value},
                                  {"reason", "điều kiện hết"}});
            }
        }
        previous = current;
    }

    std::printf("%s\n", events.dump().c_str());
    return 0;
}
