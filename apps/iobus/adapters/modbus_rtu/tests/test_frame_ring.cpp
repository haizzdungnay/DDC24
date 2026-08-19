#include <gtest/gtest.h>

#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "modbus_rtu/frame_ring.hpp"

using iobus::fieldbus::FrameRecord;
using iobus::fieldbus::FrameRing;
using iobus::fieldbus::kFrameRingCapacity;

/* `T57-3.9` — vòng nhớ giao dịch Modbus RTU.
 *
 * Vòng nhớ này là thứ người kỹ thuật đứng trước tủ đọc để quyết định có tháo dây
 * ra đo hay không. Các test dưới đây khoá đúng những tính chất mà một kết luận
 * sai sẽ dẫn tới một buổi chiều tháo dây nhầm chỗ. */

namespace {

FrameRecord make(uint8_t bus, uint8_t slave, uint64_t at_ms, bool ok, const char* reason)
{
    FrameRecord record;
    record.at_ms = at_ms;
    record.bus = bus;
    record.slave = slave;
    record.fc = 3;
    record.addr = 100;
    record.count = 2;
    record.elapsed_us = 1500;
    record.attempt = 1;
    record.ok = ok;
    std::snprintf(record.reason, sizeof(record.reason), "%s", reason);
    return record;
}

/* Đếm số object trong mảng JSON — vòng nhớ tự sinh JSON bằng snprintf nên test
 * đọc lại bằng cách đếm dấu mở ngoặc, không kéo thêm thư viện parse. */
size_t count_items(const std::string& json)
{
    size_t total = 0;
    for (char ch : json) {
        if (ch == '{') total++;
    }
    return total;
}

} // namespace

TEST(FrameRing, RongThiTraMangRong)
{
    FrameRing ring;
    EXPECT_EQ(ring.size(), 0u);
    EXPECT_EQ(ring.to_json(0, 50), "[]");
}

TEST(FrameRing, MoiNhatDungTruoc)
{
    FrameRing ring;
    ring.record(make(1, 11, 1000, true, "ok"));
    ring.record(make(1, 22, 2000, true, "ok"));
    ring.record(make(1, 33, 3000, true, "ok"));

    const std::string json = ring.to_json(0, 50);
    /* Thứ tự KHÔNG phải chuyện thẩm mỹ: người đọc nhìn dòng đầu để biết bus vừa
     * làm gì. Xếp cũ-trước sẽ khiến họ kết luận theo một khung đã lỗi thời. */
    const size_t pos_33 = json.find("\"slave\":33");
    const size_t pos_22 = json.find("\"slave\":22");
    const size_t pos_11 = json.find("\"slave\":11");
    ASSERT_NE(pos_33, std::string::npos);
    ASSERT_NE(pos_22, std::string::npos);
    ASSERT_NE(pos_11, std::string::npos);
    EXPECT_LT(pos_33, pos_22);
    EXPECT_LT(pos_22, pos_11);
}

TEST(FrameRing, QuaSucChuaThiDayCaiCuRaKhongPhaiChanCaiMoi)
{
    FrameRing ring;
    for (size_t i = 0; i < kFrameRingCapacity + 25; i++) {
        ring.record(make(1, static_cast<uint8_t>(i % 200), 1000 + i, true, "ok"));
    }

    EXPECT_EQ(ring.size(), kFrameRingCapacity);
    const std::string json = ring.to_json(0, static_cast<int>(kFrameRingCapacity));
    EXPECT_EQ(count_items(json), kFrameRingCapacity);
    /* Khung mới nhất (`at` lớn nhất) phải còn; nếu vòng nhớ đầy rồi CHẶN ghi mới
     * thì cửa sổ quan sát đóng băng đúng lúc sự cố đang diễn ra. */
    EXPECT_NE(json.find("\"at\":1224"), std::string::npos);
    EXPECT_EQ(json.find("\"at\":1000"), std::string::npos);
}

TEST(FrameRing, LocTheoBus)
{
    FrameRing ring;
    ring.record(make(1, 11, 1000, true, "ok"));
    ring.record(make(2, 22, 2000, true, "ok"));
    ring.record(make(1, 33, 3000, true, "ok"));

    const std::string bus1 = ring.to_json(1, 50);
    EXPECT_EQ(count_items(bus1), 2u);
    EXPECT_EQ(bus1.find("\"slave\":22"), std::string::npos);

    const std::string bus2 = ring.to_json(2, 50);
    EXPECT_EQ(count_items(bus2), 1u);

    // 0 = mọi bus, vì id bus hợp lệ bắt đầu từ 1.
    EXPECT_EQ(count_items(ring.to_json(0, 50)), 3u);
}

TEST(FrameRing, LocTheoBusKhongLamHaoNganSachLimit)
{
    FrameRing ring;
    for (int i = 0; i < 20; i++) {
        ring.record(make(2, 7, 1000 + i, true, "ok"));   // nhiễu, sẽ bị lọc
    }
    for (int i = 0; i < 5; i++) {
        ring.record(make(1, 9, 2000 + i, true, "ok"));
    }

    /* Sai lầm dễ mắc: đếm `limit` trên khung DUYỆT QUA thay vì khung PHÁT RA.
     * Khi đó lọc bus 1 với limit 5 sẽ trả về 0 khung vì 5 khung đầu duyệt qua
     * đều thuộc bus 2 — người dùng kết luận "bus 1 im lặng" trong khi nó vẫn
     * chạy bình thường. */
    EXPECT_EQ(count_items(ring.to_json(1, 5)), 5u);
}

TEST(FrameRing, LimitBiKepVaoDaiHopLe)
{
    FrameRing ring;
    for (size_t i = 0; i < kFrameRingCapacity; i++) {
        ring.record(make(1, 5, 1000 + i, true, "ok"));
    }

    EXPECT_EQ(count_items(ring.to_json(0, 10)), 10u);
    // limit <= 0 và limit quá lớn đều là lỗi caller, không phải lý do trả rỗng.
    EXPECT_EQ(count_items(ring.to_json(0, 0)), kFrameRingCapacity);
    EXPECT_EQ(count_items(ring.to_json(0, -3)), kFrameRingCapacity);
    EXPECT_EQ(count_items(ring.to_json(0, 100000)), kFrameRingCapacity);
}

TEST(FrameRing, GiuNguyenPhanLoaiLoi)
{
    FrameRing ring;
    ring.record(make(1, 4, 1000, false, "timeout"));
    ring.record(make(1, 5, 2000, false, "crc"));

    const std::string json = ring.to_json(0, 50);
    /* `timeout` và `crc` dẫn tới hai hành động sửa chữa KHÁC HẲN nhau (sai địa
     * chỉ/mất nguồn so với nhiễu/điện trở đầu cuối). Gộp thành "lỗi" là xoá đúng
     * phần thông tin có giá trị nhất. */
    EXPECT_NE(json.find("\"reason\":\"timeout\""), std::string::npos);
    EXPECT_NE(json.find("\"reason\":\"crc\""), std::string::npos);
    EXPECT_NE(json.find("\"ok\":false"), std::string::npos);
}

TEST(FrameRing, GhiDongThoiKhongMatBanGhi)
{
    FrameRing ring;
    std::vector<std::thread> workers;
    for (int t = 0; t < 4; t++) {
        workers.emplace_back([&ring, t] {
            for (int i = 0; i < 100; i++) {
                ring.record(make(static_cast<uint8_t>(t + 1), 1, 1000 + i, true, "ok"));
            }
        });
    }
    for (auto& worker : workers) worker.join();

    // Mỗi bus có một luồng poll riêng; vòng nhớ dùng chung phải chịu được điều đó.
    EXPECT_EQ(ring.size(), kFrameRingCapacity);
    EXPECT_EQ(count_items(ring.to_json(0, static_cast<int>(kFrameRingCapacity))), kFrameRingCapacity);
}
