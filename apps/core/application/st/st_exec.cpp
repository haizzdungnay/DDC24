#include "st/st_exec.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "st/st_diagnostic.hpp"
#include "st/st_signal_bus.hpp"

namespace core {
namespace {

/* Ngưỡng phát hiện override cho PID anti-windup: lệch giữa ACTUAL (đã áp)
 * và OUT (đề xuất cycle trước) vượt tỉ lệ này của dải out_min..out_max thì
 * coi là nguồn ưu tiên cao hơn đang thắng, freeze integrator. Giá trị cụ
 * thể là default kỹ thuật hợp lý — "transition envelope đã duyệt" theo
 * DDD-CTRL-PROG-001 §7 vẫn TARGET-PENDING, cần Controls+Safety review trước
 * khi khoá số cho field. */
constexpr float kPidOverrideDetectFraction = 0.01f;

/* Tất cả integer được giữ trong int32 ở slot, nhưng miền hợp lệ phụ thuộc
 * type target (INT16/DINT32/UINT16). Tính trên int64 rồi kiểm miền trước khi
 * ghi để không có wrap/underflow im lặng. */
inline bool store_integer(StType type, int64_t value, int32_t* out)
{
    if (!st_type_is_integer(type) || value < st_integer_min(type) ||
        value > st_integer_max(type))
        return false;
    *out = static_cast<int32_t>(value);
    return true;
}
inline bool add_ovf64(int64_t a, int64_t b, int64_t* r)
{
    return __builtin_add_overflow(a, b, r);
}
inline bool sub_ovf64(int64_t a, int64_t b, int64_t* r)
{
    return __builtin_sub_overflow(a, b, r);
}

} // namespace

bool execute_st_program(StLoadedProgram* prog, int64_t now_ns, StExecFault* fault)
{
    StCell* S = prog->slots.data();
    const StInstr* code = prog->code.data();
    const uint32_t n = static_cast<uint32_t>(prog->code.size());

    uint32_t pc = 0;
    const char* fault_code = nullptr;
    bool waiting = false;

/* Thoát fault: ghi mã + pc, tra vị trí ST rồi trả false. Dùng macro để không
 * phải nhân bản 20 lần cùng một khối thoát trong vòng thực thi. */
#define ST_FAULT(codestr)  do { fault_code = (codestr); goto faulted; } while (0)
#define ST_WAIT(codestr)   do { waiting = true; fault_code = (codestr); goto faulted; } while (0)

    while (pc < n) {
        const StInstr& in = code[pc];
        switch (in.op) {

        case StOp::NOP: pc++; break;
        case StOp::HALT: goto done;

        case StOp::JMP: pc = in.imm; break;
        case StOp::JMP_IF_FALSE:
            pc = S[in.a].b ? pc + 1 : in.imm;
            break;

        case StOp::MOV:
            /* Sao chép nguyên ô 8 byte: đúng với mọi kiểu, một lệnh. */
            S[in.dst] = S[in.a];
            pc++;
            break;

        case StOp::SIGNAL_READ: {
            const StIrSignalRef& ref = prog->signal_refs[in.aux];
            if (prog->signal_bus == nullptr || ref.runtime_index < 0)
                ST_FAULT(st_diag_code::kRtSignalPublish);
            const StSignalRead read =
                prog->signal_bus->read(ref.runtime_index, static_cast<uint64_t>(now_ns));
            if (read.state == StSignalReadState::UNAVAILABLE)
                ST_WAIT(st_diag_code::kRtSignalWait);
            if (read.state == StSignalReadState::NOT_DECLARED)
                ST_FAULT(st_diag_code::kRtSignalContract);
            /* HOLD_PRIVATE: stale giữ nguyên biến đích. Compiler bảo đảm
             * SIGNAL_READ chỉ xuất hiện ở RHS trực tiếp và dst chính là biến
             * người dùng, không phải temp bị MOV tiếp sau đó. */
            if (read.state != StSignalReadState::STALE_HELD)
                S[in.dst] = read.value;
            pc++;
            break;
        }

        case StOp::SIGNAL_PUBLISH:
            if (in.aux >= prog->pending_signal_values.size() ||
                in.aux >= prog->pending_signal_writes.size() ||
                in.aux >= prog->pending_signal_pc.size())
                ST_FAULT(st_diag_code::kRtSignalPublish);
            prog->pending_signal_values[in.aux] = S[in.a];
            prog->pending_signal_writes[in.aux] = 1;
            prog->pending_signal_pc[in.aux] = pc;
            pc++;
            break;

        case StOp::ADD:
            switch (in.type) {
            case StType::INT:
            case StType::DINT:
            case StType::UINT:
                if (!store_integer(in.type,
                                   static_cast<int64_t>(S[in.a].i) + S[in.b].i,
                                   &S[in.dst].i))
                    ST_FAULT(st_diag_code::kRtIntOverflow);
                break;
            case StType::REAL:
                S[in.dst].r = S[in.a].r + S[in.b].r;
                if (!std::isfinite(S[in.dst].r)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
                break;
            case StType::TIME:
                if (add_ovf64(S[in.a].t, S[in.b].t, &S[in.dst].t))
                    ST_FAULT(st_diag_code::kRtIntOverflow);
                if (S[in.dst].t < 0) ST_FAULT(st_diag_code::kRtNegativeTime);
                break;
            default: break;
            }
            pc++;
            break;

        case StOp::SUB:
            switch (in.type) {
            case StType::INT:
            case StType::DINT:
            case StType::UINT:
                if (!store_integer(in.type,
                                   static_cast<int64_t>(S[in.a].i) - S[in.b].i,
                                   &S[in.dst].i))
                    ST_FAULT(st_diag_code::kRtIntOverflow);
                break;
            case StType::REAL:
                S[in.dst].r = S[in.a].r - S[in.b].r;
                if (!std::isfinite(S[in.dst].r)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
                break;
            case StType::TIME:
                if (sub_ovf64(S[in.a].t, S[in.b].t, &S[in.dst].t))
                    ST_FAULT(st_diag_code::kRtIntOverflow);
                /* TIME không âm (SPEC §3.1) — trừ ra âm là fault, không kẹp 0
                 * im lặng, vì kẹp sẽ giấu lỗi logic của người viết chương trình. */
                if (S[in.dst].t < 0) ST_FAULT(st_diag_code::kRtNegativeTime);
                break;
            default: break;
            }
            pc++;
            break;

        case StOp::MUL:
            if (st_type_is_integer(in.type)) {
                if (!store_integer(in.type,
                                   static_cast<int64_t>(S[in.a].i) * S[in.b].i,
                                   &S[in.dst].i))
                    ST_FAULT(st_diag_code::kRtIntOverflow);
            } else {
                S[in.dst].r = S[in.a].r * S[in.b].r;
                if (!std::isfinite(S[in.dst].r)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
            }
            pc++;
            break;

        case StOp::DIV:
            if (st_type_is_integer(in.type)) {
                if (S[in.b].i == 0) ST_FAULT(st_diag_code::kRtDivByZero);
                const int64_t result =
                    static_cast<int64_t>(S[in.a].i) / static_cast<int64_t>(S[in.b].i);
                if (!store_integer(in.type, result, &S[in.dst].i))
                    ST_FAULT(st_diag_code::kRtIntOverflow);
            } else {
                if (S[in.b].r == 0.0f) ST_FAULT(st_diag_code::kRtDivByZero);
                S[in.dst].r = S[in.a].r / S[in.b].r;
                if (!std::isfinite(S[in.dst].r)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
            }
            pc++;
            break;

        case StOp::MOD:
            if (S[in.b].i == 0) ST_FAULT(st_diag_code::kRtDivByZero);
            if (!store_integer(in.type,
                               static_cast<int64_t>(S[in.a].i) % S[in.b].i,
                               &S[in.dst].i))
                ST_FAULT(st_diag_code::kRtIntOverflow);
            pc++;
            break;

        case StOp::NEG:
            if (st_type_is_signed_integer(in.type)) {
                if (!store_integer(in.type, -static_cast<int64_t>(S[in.a].i),
                                   &S[in.dst].i))
                    ST_FAULT(st_diag_code::kRtIntOverflow);
            } else {
                S[in.dst].r = -S[in.a].r;
            }
            pc++;
            break;

#define ST_CMP(OPCODE, CPPOP)                                                   \
        case OPCODE:                                                            \
            switch (in.type) {                                                  \
            case StType::INT:                                                      \
            case StType::DINT:                                                     \
            case StType::UINT: S[in.dst].b = (S[in.a].i CPPOP S[in.b].i); break;  \
            case StType::REAL: S[in.dst].b = (S[in.a].r CPPOP S[in.b].r); break; \
            case StType::TIME: S[in.dst].b = (S[in.a].t CPPOP S[in.b].t); break; \
            case StType::BOOL: S[in.dst].b = (S[in.a].b CPPOP S[in.b].b); break; \
            }                                                                   \
            pc++;                                                               \
            break;

        ST_CMP(StOp::LT, <)
        ST_CMP(StOp::LE, <=)
        ST_CMP(StOp::GT, >)
        ST_CMP(StOp::GE, >=)
        ST_CMP(StOp::EQ, ==)
        ST_CMP(StOp::NE, !=)
#undef ST_CMP

        /* AND/OR/XOR đánh giá đầy đủ, không rút gọn (SPEC §4.4): thời gian
         * thực thi không được phụ thuộc dữ liệu, nếu không WCET vô nghĩa. */
        case StOp::AND: S[in.dst].b = S[in.a].b && S[in.b].b; pc++; break;
        case StOp::OR:  S[in.dst].b = S[in.a].b || S[in.b].b; pc++; break;
        case StOp::XOR: S[in.dst].b = S[in.a].b != S[in.b].b; pc++; break;
        case StOp::NOT: S[in.dst].b = !S[in.a].b; pc++; break;

        case StOp::ABS:
            if (st_type_is_integer(in.type)) {
                const int64_t value = S[in.a].i < 0
                                          ? -static_cast<int64_t>(S[in.a].i)
                                          : static_cast<int64_t>(S[in.a].i);
                if (!store_integer(in.type, value, &S[in.dst].i))
                    ST_FAULT(st_diag_code::kRtIntOverflow);
            } else {
                S[in.dst].r = std::fabs(S[in.a].r);
            }
            pc++;
            break;

        case StOp::MIN:
            switch (in.type) {
            case StType::INT:
            case StType::DINT:
            case StType::UINT: S[in.dst].i = S[in.a].i < S[in.b].i ? S[in.a].i : S[in.b].i; break;
            case StType::REAL: S[in.dst].r = S[in.a].r < S[in.b].r ? S[in.a].r : S[in.b].r; break;
            case StType::TIME: S[in.dst].t = S[in.a].t < S[in.b].t ? S[in.a].t : S[in.b].t; break;
            default: break;
            }
            pc++;
            break;

        case StOp::MAX:
            switch (in.type) {
            case StType::INT:
            case StType::DINT:
            case StType::UINT: S[in.dst].i = S[in.a].i > S[in.b].i ? S[in.a].i : S[in.b].i; break;
            case StType::REAL: S[in.dst].r = S[in.a].r > S[in.b].r ? S[in.a].r : S[in.b].r; break;
            case StType::TIME: S[in.dst].t = S[in.a].t > S[in.b].t ? S[in.a].t : S[in.b].t; break;
            default: break;
            }
            pc++;
            break;

        case StOp::LIMIT:
            /* a=MN, b=IN, c=MX. MN > MX là lỗi của chương trình, không phải
             * trường hợp cần "sửa hộ" — kẹp theo thứ tự sai sẽ cho kết quả vô
             * nghĩa mà không ai biết. */
            switch (in.type) {
            case StType::INT:
            case StType::DINT:
            case StType::UINT: {
                if (S[in.a].i > S[in.c].i) ST_FAULT(st_diag_code::kRtLimitMinMax);
                int32_t v = S[in.b].i;
                if (v < S[in.a].i) v = S[in.a].i;
                if (v > S[in.c].i) v = S[in.c].i;
                S[in.dst].i = v;
                break;
            }
            case StType::REAL: {
                if (S[in.a].r > S[in.c].r) ST_FAULT(st_diag_code::kRtLimitMinMax);
                float v = S[in.b].r;
                if (v < S[in.a].r) v = S[in.a].r;
                if (v > S[in.c].r) v = S[in.c].r;
                S[in.dst].r = v;
                break;
            }
            case StType::TIME: {
                if (S[in.a].t > S[in.c].t) ST_FAULT(st_diag_code::kRtLimitMinMax);
                int64_t v = S[in.b].t;
                if (v < S[in.a].t) v = S[in.a].t;
                if (v > S[in.c].t) v = S[in.c].t;
                S[in.dst].t = v;
                break;
            }
            default: break;
            }
            pc++;
            break;

        case StOp::SEL:
            /* a=G (BOOL), b=IN0, c=IN1. Cả hai nhánh đều đã được đánh giá từ
             * trước bởi compiler — nhất quán với chính sách không rút gọn. */
            S[in.dst] = S[in.a].b ? S[in.c] : S[in.b];
            pc++;
            break;

        case StOp::SQRT:
            if (S[in.a].r < 0.0f) ST_FAULT(st_diag_code::kRtSqrtNegative);
            S[in.dst].r = std::sqrt(S[in.a].r);
            if (!std::isfinite(S[in.dst].r)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
            pc++;
            break;

        case StOp::CVT_I2R:
            S[in.dst].r = static_cast<float>(S[in.a].i);
            pc++;
            break;

        case StOp::CVT_R2I: {
            const float v = S[in.a].r;
            if (!std::isfinite(v)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
            /* Làm tròn nửa ra xa 0 (SPEC §3.5). Kiểm biên TRƯỚC khi ép kiểu:
             * ép một float ngoài miền int32 sang int32 là UB. */
            const float rounded = std::round(v);
            if (rounded > static_cast<float>(st_integer_max(StType::INT)) ||
                rounded < static_cast<float>(st_integer_min(StType::INT)) ||
                !store_integer(StType::INT, static_cast<int64_t>(rounded), &S[in.dst].i))
                ST_FAULT(st_diag_code::kRtConvOutOfRange);
            pc++;
            break;
        }

        case StOp::CVT_T2R:
            S[in.dst].r = static_cast<float>(static_cast<double>(S[in.a].t) / 1e9);
            if (!std::isfinite(S[in.dst].r)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
            pc++;
            break;

        case StOp::CVT_R2T: {
            const float v = S[in.a].r;
            if (!std::isfinite(v)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
            if (v < 0.0f) ST_FAULT(st_diag_code::kRtNegativeTime);
            const double ns = static_cast<double>(v) * 1e9;
            if (ns > 9.2e18) ST_FAULT(st_diag_code::kRtConvOutOfRange);
            S[in.dst].t = static_cast<int64_t>(ns);
            pc++;
            break;
        }

        case StOp::CVT_I2D:
        case StOp::CVT_U2D:
            S[in.dst].i = S[in.a].i;
            pc++;
            break;

        case StOp::CVT_I2U:
            if (!store_integer(StType::UINT, S[in.a].i, &S[in.dst].i))
                ST_FAULT(st_diag_code::kRtConvOutOfRange);
            pc++;
            break;

        case StOp::CVT_D2I:
        case StOp::CVT_U2I:
            if (!store_integer(StType::INT, S[in.a].i, &S[in.dst].i))
                ST_FAULT(st_diag_code::kRtConvOutOfRange);
            pc++;
            break;

        case StOp::CVT_D2U:
            if (!store_integer(StType::UINT, S[in.a].i, &S[in.dst].i))
                ST_FAULT(st_diag_code::kRtConvOutOfRange);
            pc++;
            break;

        case StOp::CVT_D2R:
        case StOp::CVT_U2R:
            S[in.dst].r = static_cast<float>(S[in.a].i);
            pc++;
            break;

        case StOp::CVT_R2D:
        case StOp::CVT_R2U: {
            const float value = S[in.a].r;
            if (!std::isfinite(value)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
            const float rounded = std::round(value);
            const StType target = in.op == StOp::CVT_R2D ? StType::DINT : StType::UINT;
            if (rounded > static_cast<float>(st_integer_max(target)) ||
                rounded < static_cast<float>(st_integer_min(target)) ||
                !store_integer(target, static_cast<int64_t>(rounded), &S[in.dst].i))
                ST_FAULT(st_diag_code::kRtConvOutOfRange);
            pc++;
            break;
        }

        case StOp::FB_CALL: {
            const StIrFbInstance& fb = prog->fb_instances[in.aux];
            StFbState& st = prog->fb_states[in.aux];
            StCell* ins = &S[fb.input_slot_base];
            StCell* outs = &S[fb.output_slot_base];

            switch (fb.fb_type) {
            case StFbType::TON: {
                const bool input = ins[0].b;
                const int64_t pt = ins[1].t;
                if (!input) {
                    st.timing = false;
                    outs[0].b = false;
                    outs[1].t = 0;
                } else {
                    if (!st.timing) { st.timing = true; st.start_ns = now_ns; }
                    int64_t elapsed = now_ns - st.start_ns;
                    if (elapsed < 0) elapsed = 0;
                    /* ET bão hoà tại PT, không vượt (SPEC §6.2). */
                    outs[1].t = elapsed < pt ? elapsed : pt;
                    outs[0].b = elapsed >= pt;
                }
                break;
            }
            case StFbType::TOF: {
                const bool input = ins[0].b;
                const int64_t pt = ins[1].t;
                if (input) {
                    st.timing = false;
                    outs[0].b = true;
                    outs[1].t = 0;
                } else {
                    if (!st.timing) { st.timing = true; st.start_ns = now_ns; }
                    int64_t elapsed = now_ns - st.start_ns;
                    if (elapsed < 0) elapsed = 0;
                    outs[1].t = elapsed < pt ? elapsed : pt;
                    outs[0].b = elapsed < pt;
                }
                break;
            }
            case StFbType::R_TRIG: {
                const bool clk = ins[0].b;
                outs[0].b = clk && !st.prev_clk;
                st.prev_clk = clk;
                break;
            }
            case StFbType::F_TRIG: {
                const bool clk = ins[0].b;
                outs[0].b = !clk && st.prev_clk;
                st.prev_clk = clk;
                break;
            }
            case StFbType::TP: {
                /* Xung có độ dài BIẾT TRƯỚC (§7A.2): sườn lên khởi động, và
                 * sườn lên giữa xung bị BỎ QUA — đó là toàn bộ khác biệt so với
                 * TON. Cho retrigger nghĩa là xung dài ra theo tín hiệu, tức là
                 * đúng thứ người dùng chọn TP để tránh. */
                const bool input = ins[0].b;
                const int64_t pt = ins[1].t;
                if (!st.timing && input && !st.prev_in) {
                    st.timing = true;
                    st.start_ns = now_ns;
                }
                if (st.timing) {
                    int64_t elapsed = now_ns - st.start_ns;
                    if (elapsed < 0) elapsed = 0;
                    if (elapsed >= pt) {
                        st.timing = false;
                        outs[0].b = false;
                        /* ET giữ PT chừng nào IN còn TRUE rồi mới về 0: nhảy về
                         * 0 ngay khi hết xung làm logic đọc ET không phân biệt
                         * được "chưa chạy" với "vừa chạy xong". */
                        outs[1].t = input ? pt : 0;
                    } else {
                        outs[0].b = true;
                        outs[1].t = elapsed;
                    }
                } else {
                    outs[0].b = false;
                    outs[1].t = input ? pt : 0;
                }
                st.prev_in = input;
                st.q = outs[0].b;
                break;
            }
            case StFbType::CTU: {
                /* §7A.3 — RESET thắng sườn đếm trong cùng cycle, và CV BÃO HOÀ
                 * chứ không quấn vòng: quấn vòng biến một bộ đếm giờ chạy thành
                 * số âm sau 32767 lần mà không ai thấy. */
                const bool clk = ins[0].b;
                const bool reset = ins[1].b;
                const int32_t preset = ins[2].i;
                if (reset) {
                    st.counter = 0;
                } else if (clk && !st.prev_clk && st.counter < INT16_MAX) {
                    st.counter += 1;
                }
                st.prev_clk = clk;
                outs[1].i = st.counter;
                outs[0].b = st.counter >= preset;
                st.q = outs[0].b;
                break;
            }
            case StFbType::CTD: {
                const bool clk = ins[0].b;
                const bool load = ins[1].b;
                const int32_t preset = ins[2].i;
                if (load) {
                    st.counter = preset;
                } else if (clk && !st.prev_clk && st.counter > INT16_MIN) {
                    st.counter -= 1;
                }
                st.prev_clk = clk;
                outs[1].i = st.counter;
                outs[0].b = st.counter <= 0;
                st.q = outs[0].b;
                break;
            }
            case StFbType::HYSTERESIS: {
                /* §7A.7 — trong dải LOW..HIGH thì GIỮ NGUYÊN chu kỳ trước; đó
                 * là toàn bộ lý do nó là FB chứ không phải hàm thuần. */
                const float value = ins[0].r;
                const float high = ins[1].r;
                const float low = ins[2].r;
                if (!std::isfinite(value) || !std::isfinite(high) || !std::isfinite(low))
                    ST_FAULT(st_diag_code::kRtNonFiniteReal);
                /* Dải trễ đảo ngược không có nghĩa vật lý; đoán ý người khai sẽ
                 * tạo ra một bộ điều khiển bật/tắt liên tục ở đúng ngưỡng. */
                if (!(low < high)) ST_FAULT(st_diag_code::kRtLimitMinMax);
                if (value >= high) st.q = true;
                else if (value <= low) st.q = false;
                outs[0].b = st.q;
                break;
            }
            case StFbType::PID: {
                /* DDD-CTRL-PROG-001 §7. ins[]: SP,PV,KP,KI,KD,OUT_MIN,
                 * OUT_MAX,ACTUAL. Không publish (fault huỷ cả cycle) nếu
                 * input non-finite hoặc dải output vô nghĩa — NaN/Inf không
                 * được lan tới output analog (ST_SUBSET_SPEC §6.3). */
                const float sp = ins[0].r, pv = ins[1].r;
                const float kp = ins[2].r, ki = ins[3].r, kd = ins[4].r;
                const float out_min = ins[5].r, out_max = ins[6].r;
                const float actual = ins[7].r;
                if (!std::isfinite(sp) || !std::isfinite(pv) || !std::isfinite(kp) ||
                    !std::isfinite(ki) || !std::isfinite(kd) || !std::isfinite(out_min) ||
                    !std::isfinite(out_max) || !std::isfinite(actual))
                    ST_FAULT(st_diag_code::kRtNonFiniteReal);
                if (!(out_min < out_max)) ST_FAULT(st_diag_code::kRtLimitMinMax);

                double dt = 0.0;
                if (!st.pid_first) {
                    if (now_ns <= st.pid_prev_call_ns) ST_FAULT(st_diag_code::kRtPidInvalidDt);
                    dt = static_cast<double>(now_ns - st.pid_prev_call_ns) / 1e9;
                }

                const float error = sp - pv;
                const float p_term = kp * error;
                const float i_candidate = std::clamp(
                    st.pid_integral + ki * error * static_cast<float>(dt), out_min, out_max);
                /* Derivative-on-measurement để tránh derivative kick khi setpoint
                 * đổi bậc thang; dt=0 ở lần gọi đầu nên không có prev_pv hợp lệ. */
                const float d_term = (st.pid_first || dt <= 0.0)
                    ? 0.0f
                    : kd * (pv - st.pid_prev_pv) / static_cast<float>(dt);
                const float u_raw = p_term + i_candidate - d_term;
                if (!std::isfinite(u_raw)) ST_FAULT(st_diag_code::kRtNonFiniteReal);
                const float u_limit = std::clamp(u_raw, out_min, out_max);

                /* Override: ACTUAL (đã publish/áp thật) lệch khỏi đề xuất cycle
                 * trước quá ngưỡng — nguồn ưu tiên cao hơn đang thắng. Freeze
                 * integrator, không back-calculate và không chép ACTUAL ngoại
                 * lai vào state (§7: "không được chép actual ngoại lai vào
                 * integrator để giả thành state của Program"). */
                const bool overridden = !st.pid_first &&
                    std::abs(actual - st.pid_prev_output) >
                        (out_max - out_min) * kPidOverrideDetectFraction;

                st.pid_integral = overridden ? st.pid_integral : (i_candidate - (u_raw - u_limit));
                st.pid_prev_pv = pv;
                st.pid_prev_output = u_limit;
                st.pid_prev_call_ns = now_ns;
                st.pid_first = false;

                outs[0].r = u_limit;
                outs[1].b = overridden;
                break;
            }
            case StFbType::NONE: break;
            }
            pc++;
            break;
        }
        }
    }

done:
    if (fault) *fault = StExecFault{};
    return true;

faulted:
    if (fault) {
        fault->faulted = !waiting;
        fault->waiting = waiting;
        fault->code = fault_code;
        fault->pc = pc;
        prog->source_position(pc, &fault->line, &fault->column);
    }
    return false;

#undef ST_FAULT
#undef ST_WAIT
}

} // namespace core
