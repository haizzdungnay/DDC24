/**
 * @file write_verify.cpp
 * @brief `ISS-PIO-23` — so sánh giá trị đọc lại; xem write_verify.hpp.
 */
#include "write_verify.hpp"

namespace iobus::fieldbus {

double default_readback_tolerance(double scale)
{
    const double step = std::fabs(scale);
    /* `scale` không hợp lệ (0, NaN) thì không suy được bước lượng tử. Rơi về
     * một dung sai rất nhỏ thay vì 0: so bằng tuyệt đối trên `double` sẽ báo
     * lệch vì chính phép nhân/chia của `encode`/`decode`. */
    if (!(step > 0.0) || !std::isfinite(step)) return 1e-9;
    return step / 2.0;
}

bool readback_matches(double written, double read_back, double scale, double tolerance)
{
    if (!std::isfinite(written) || !std::isfinite(read_back)) return false;
    const double allowed = (tolerance > 0.0 && std::isfinite(tolerance))
                               ? tolerance
                               : default_readback_tolerance(scale);
    return std::fabs(written - read_back) <= allowed;
}

VerifyOutcome verify_write_outcome(bool read_ok, double written, double read_back,
                                   double scale, double tolerance)
{
    if (!read_ok) return {"unverified", "readback_failed"};
    if (!readback_matches(written, read_back, scale, tolerance))
        return {"unverified", "readback_mismatch"};
    return {"applied", ""};
}

} // namespace iobus::fieldbus
