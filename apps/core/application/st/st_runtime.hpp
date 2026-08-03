/**
 * @file  st_runtime.hpp
 * @brief Vòng đời một chương trình ST trên runtime: activate artifact đã
 *        verify, chạy từng chu kỳ, giữ last-known-good.
 *
 *        KHÁC BIỆT CỐT LÕI so với bản trước 2026-07-28: `activate()` nhận
 *        BYTE ARTIFACT, không nhận source ST. Runtime không còn liên kết tới
 *        parser/semantic — đúng PROGRAM_SOM_FW_DRAFT_DESIGN §4.
 */
#ifndef CORE_ST_RUNTIME_HPP
#define CORE_ST_RUNTIME_HPP

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "st/st_exec.hpp"
#include "st/st_loader.hpp"

namespace core {

struct StExecResult {
    bool        ok = false;
    std::string error;        /* rỗng khi ok */
    const char* fault_code = nullptr;
    uint32_t    fault_pc = 0;
    int         fault_line = 0;
    int         fault_column = 0;
};

class StProgramRuntime {
public:
    /* Verify + load artifact vào candidate; chỉ swap sang active khi TOÀN BỘ
     * 22 bước verify pass. Fail → active_ giữ nguyên (last-known-good) và
     * *err mang mã IR-E-* ổn định cho BE. */
    bool activate(const uint8_t* artifact, std::size_t size, StLoadError* err = nullptr,
                  const StLoaderOptions* opts = nullptr);

    bool loaded() const { return static_cast<bool>(active_); }

    /* Một chu kỳ. `now_ns` là mốc đơn điệu chụp một lần ở đầu tick.
     *
     * Bảo đảm KHÔNG COMMIT NỬA CHỪNG: trạng thái mọi slot và mọi FB được
     * chụp trước khi chạy; nếu chu kỳ fault thì khôi phục nguyên vẹn, nên
     * chương trình lỗi không bao giờ để lại trạng thái nửa vời.
     *
     * Không cấp phát: mọi bộ đệm đã cấp lúc load. */
    StExecResult execute(int64_t now_ns);

    /* Truy cập theo TÊN — chỉ dùng ngoài đường scan (test, truy vấn BE).
     * Đường scan thật dùng io_bindings theo chỉ số, xem ACTION 10. */
    bool set_variable(const std::string& name, const StValue& v);
    bool get_variable(const std::string& name, StValue* out) const;

    const StLoadedProgram* program() const { return active_.get(); }

    uint32_t activation_count() const { return activation_count_; }
    uint32_t activation_fail_count() const { return activation_fail_count_; }
    uint32_t fault_count() const { return fault_count_; }
    uint32_t cycle_count() const { return cycle_count_; }

private:
    std::unique_ptr<StLoadedProgram> active_;
    /* Ảnh chụp trạng thái đầu chu kỳ — cấp phát MỘT LẦN lúc activate. */
    std::vector<StCell>    shadow_slots_;
    std::vector<StFbState> shadow_fb_;

    uint32_t activation_count_ = 0;
    uint32_t activation_fail_count_ = 0;
    uint32_t fault_count_ = 0;
    uint32_t cycle_count_ = 0;
};

} // namespace core

#endif /* CORE_ST_RUNTIME_HPP */
