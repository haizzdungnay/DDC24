/**
 * @file  plc_shm_isolation.cpp
 * @brief Cô lập PLC SHM của `core_tests` THEO TIẾN TRÌNH.
 *
 * Triệu chứng: `WebIpc.ExtPointWriteCommandAccepted` đỏ ngắt quãng dưới
 * `ctest -j8` (lệnh ghi EXT1 bị `bad_request`, `ext[0].setpoint` = 0) nhưng
 * xanh 5/5 khi chạy riêng.
 *
 * Nguyên nhân gốc: `gtest_discover_tests` chạy MỖI test trong một tiến trình
 * riêng, song song, nhưng CMake đặt cùng một `MKDDC_SHM_PLC_NAME` cho tất cả.
 * `BacnetObjTable::attach()` mở `O_CREAT|O_RDWR` rồi `memset` TOÀN BỘ segment,
 * nên một test khác khởi động đúng lúc sẽ xoá `ext_count`/`ext[]` của test đang
 * chạy. Base step 10 ms (ADR-061) và bộ test dài hơn làm cửa sổ va chạm dễ lộ
 * hơn, nhưng lỗi có từ khi segment test được đặt tên tĩnh.
 *
 * Cách sửa: trước test đầu tiên, nối PID vào tên segment (tiến trình con thừa
 * hưởng biến môi trường nên vẫn thấy cùng tên), và `shm_unlink` khi kết thúc để
 * không để lại rác trong `/dev/shm`. Không đổi gì ở code production.
 */
#include <gtest/gtest.h>

#include <cstdlib>
#include <string>

#include <sys/mman.h>
#include <unistd.h>

namespace {

class PlcShmIsolation : public ::testing::Environment {
public:
    void SetUp() override
    {
        const char* base = std::getenv("MKDDC_SHM_PLC_NAME");
        name_ = std::string(base != nullptr && *base != '\0' ? base : "/mkddc_plc_shm_coretest") +
                "_" + std::to_string(static_cast<long>(::getpid()));
        ::setenv("MKDDC_SHM_PLC_NAME", name_.c_str(), 1);
    }

    void TearDown() override
    {
        if (!name_.empty()) ::shm_unlink(name_.c_str());
    }

private:
    std::string name_;
};

[[maybe_unused]] ::testing::Environment* const kPlcShmIsolation =
    ::testing::AddGlobalTestEnvironment(new PlcShmIsolation);

} // namespace
