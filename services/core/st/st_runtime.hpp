/**
 * @file  st_runtime.hpp
 * @brief FW SOM IEC programming foundation: chạy 1 ST program đã compile
 *        (typed IR) trên SOM host runtime substrate. KHÔNG parse source
 *        trong execute() (parse chỉ ở activate(), ngoài scan path) — package
 *        đã pre-resolve trước khi active. Atomic activation: parse+typecheck
 *        vào candidate riêng, chỉ swap vào active_ khi cả 2 pass; fail → giữ
 *        package cũ (last-known-good), giống pattern GraphRuntime::reload()
 *        (xem graph_runtime.hpp).
 */
#ifndef CORE_ST_RUNTIME_HPP
#define CORE_ST_RUNTIME_HPP

#include <cstdint>
#include <memory>
#include <string>

#include "st/st_diagnostic.hpp"
#include "st/st_program.hpp"

namespace core {

struct StExecResult {
    bool        ok = false;
    std::string error;   /* rỗng khi ok=true */
};

class StProgramRuntime {
public:
    /* Parse + typecheck source vào candidate; chỉ activate khi CẢ HAI pass.
     * Fail (syntax hoặc semantic) → active_ giữ nguyên, trả false + *diag. */
    bool activate(const std::string& source, StDiagnostic* diag = nullptr);

    bool loaded() const { return static_cast<bool>(active_); }

    /* 1 lần "scan" của ST program: input image → (execute IR đã compile sẵn)
     * → output image. Không parse source ở đây.
     *   - Thiếu/sai kiểu input đã khai báo, hoặc REAL input NaN/Inf → reject,
     *     *outputs KHÔNG bị đụng (giữ giá trị cũ, không silent-GOOD).
     *   - Lỗi runtime giữa chừng (không nên xảy ra sau typecheck, nhưng vẫn
     *     defensive-check) → *outputs KHÔNG bị đụng (staged rồi mới commit). */
    StExecResult execute(const StIoImage& inputs, StIoImage* outputs);

    uint32_t activation_count() const { return activation_count_; }
    uint32_t activation_fail_count() const { return activation_fail_count_; }
    uint32_t fault_count() const { return fault_count_; }

    const StProgram* active_program_for_test() const { return active_.get(); }

private:
    std::unique_ptr<StProgram> active_;
    uint32_t activation_count_ = 0;
    uint32_t activation_fail_count_ = 0;
    uint32_t fault_count_ = 0;
};

} // namespace core

#endif /* CORE_ST_RUNTIME_HPP */
