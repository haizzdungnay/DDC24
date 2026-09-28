/**
 * @file  test_coil_write_batch.cpp
 * @brief U-07 (REC-DDC-FIELD-USE-20260927) — gom lệnh ghi coil liền kề thành FC15.
 *
 * Triệu chứng đo trên bo Foxlinx: Program đổi 16 DO trên hai module CK-508 thì
 * bus phát 16 giao dịch FC05, trải 0,43–0,46 s. Gốc: `flush_pending` phát mỗi
 * mục hàng đợi thành một giao dịch; `enqueue_write` chỉ gộp lệnh chờ của CÙNG
 * một coil.
 *
 * Ba lớp test:
 *  1. `plan_write_transactions` — hàm thuần, không cần libmodbus.
 *  2. Profile: `max_coils_per_write` đọc đúng, mặc định TẮT, kẹp trần.
 *  3. Dây thật trên PTY: một slave RTU giả VIẾT TAY (không dùng libmodbus phía
 *     slave) để trả lời NHIỀU địa chỉ trên cùng một dây, ghi sổ từng khung yêu
 *     cầu (FC, địa chỉ, số lượng, byte dữ liệu) và giả được slave câm hoặc slave
 *     từ chối FC15. Sổ của slave là bằng chứng — không dựa vào bộ đếm của chính
 *     master, vì đó là thứ đang bị kiểm.
 */
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <poll.h>
#include <set>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

#include <gtest/gtest.h>

#include "bus_worker.hpp"
#include "coil_write_batch.hpp"
#include "device_profile.hpp"
#include "ext_cache.hpp"
#include "fieldbus_metrics.hpp"
#include "fieldbus_time.hpp"
#include "modbus_master.hpp"

using namespace iobus::fieldbus;
using Clock = std::chrono::steady_clock;

namespace {

WritePlanItem coil(uint16_t addr, bool groupable = true)
{
    WritePlanItem it;
    it.fc        = 5;
    it.addr      = addr;
    it.groupable = groupable;
    return it;
}

WritePlanItem reg(uint16_t addr)
{
    WritePlanItem it;
    it.fc   = 6;
    it.addr = addr;
    return it;
}

std::string batch_profile(const std::string& tag, const std::string& json)
{
    const std::string path = "/tmp/mkddc_fc15_" + tag + "_" + std::to_string(::getpid()) + ".json";
    std::ofstream f(path);
    f << json;
    return path;
}

} // namespace

/* ---- 1. Kế hoạch giao dịch — hàm thuần ---------------------------------- */

TEST(CoilWritePlan, TatThiMoiMucMotGiaoDichDungThuTuHangDoi)
{
    const std::vector<WritePlanItem> items = {coil(3), coil(0), coil(1), reg(10), coil(2)};
    for (uint16_t max : {0, 1}) {
        const auto plan = plan_write_transactions(items, max);
        ASSERT_EQ(plan.size(), items.size()) << "max=" << max;
        for (size_t i = 0; i < plan.size(); i++) {
            ASSERT_EQ(plan[i].items.size(), 1u);
            EXPECT_EQ(plan[i].items[0], i) << "tắt gom thì không được đảo thứ tự hàng đợi";
            EXPECT_FALSE(plan[i].multi_coil());
        }
    }
}

TEST(CoilWritePlan, TamCoilLienKeThanhMotGiaoDichSapTheoDiaChi)
{
    /* Thứ tự hàng đợi là thứ tự điểm trong profile (sắp theo TÊN), không phải
     * theo địa chỉ — kế hoạch phải tự sắp. */
    const std::vector<WritePlanItem> items = {coil(5), coil(0), coil(7), coil(1),
                                              coil(6), coil(2), coil(4), coil(3)};
    const auto plan = plan_write_transactions(items, 8);
    ASSERT_EQ(plan.size(), 1u);
    EXPECT_TRUE(plan[0].multi_coil());
    EXPECT_EQ(plan[0].start_addr, 0u);
    ASSERT_EQ(plan[0].items.size(), 8u);
    for (size_t k = 0; k < 8; k++)
        EXPECT_EQ(items[plan[0].items[k]].addr, k) << "bit " << k << " phải là coil " << k;
}

TEST(CoilWritePlan, KhoangTrongChiaNhomKhongGhiQuaCoilKhongKhaiBao)
{
    const auto plan = plan_write_transactions({coil(0), coil(1), coil(2), coil(5), coil(6)}, 16);
    ASSERT_EQ(plan.size(), 2u);
    EXPECT_EQ(plan[0].start_addr, 0u);
    EXPECT_EQ(plan[0].items.size(), 3u);
    EXPECT_EQ(plan[1].start_addr, 5u);
    EXPECT_EQ(plan[1].items.size(), 2u);
}

TEST(CoilWritePlan, CatTheoTranMaxCoilsVaKepVe16)
{
    std::vector<WritePlanItem> ten;
    for (uint16_t a = 0; a < 10; a++) ten.push_back(coil(a));
    const auto by4 = plan_write_transactions(ten, 4);
    ASSERT_EQ(by4.size(), 3u);
    EXPECT_EQ(by4[0].items.size(), 4u);
    EXPECT_EQ(by4[1].items.size(), 4u);
    EXPECT_EQ(by4[2].items.size(), 2u);
    EXPECT_EQ(by4[1].start_addr, 4u);

    std::vector<WritePlanItem> twenty;
    for (uint16_t a = 0; a < 20; a++) twenty.push_back(coil(a));
    const auto clamped = plan_write_transactions(twenty, 100);
    ASSERT_EQ(clamped.size(), 2u);
    EXPECT_EQ(clamped[0].items.size(), kMaxCoilsPerWrite);
    EXPECT_EQ(clamped[1].items.size(), 4u);
}

TEST(CoilWritePlan, DiaChiTrungKhongGomVaGiuThuTuCuMoi)
{
    /* Hai lệnh cho coil 2: gom vào một khung thì chỉ MỘT giá trị lên dây, và
     * thứ tự cũ → mới (`MBA-FW-04`) mất. */
    const std::vector<WritePlanItem> items = {coil(1), coil(2), coil(3), coil(2)};
    const auto plan = plan_write_transactions(items, 16);
    /* coil 1 | coil 2 (cũ) | coil 3 | coil 2 (mới) — hai mục trùng là rào. */
    ASSERT_EQ(plan.size(), 4u);
    std::vector<size_t> order;
    for (const auto& tx : plan) {
        ASSERT_EQ(tx.items.size(), 1u);
        order.push_back(tx.items[0]);
    }
    EXPECT_EQ(order, (std::vector<size_t>{0, 1, 2, 3}));
}

TEST(CoilWritePlan, MucKhongGomDuocLaRaoGiuThuTuVoiLenhThanhGhi)
{
    /* coil0 coil1 | FC06 reg 10 | coil2 coil3 | readback coil4 | coil5 */
    const std::vector<WritePlanItem> items = {coil(0), coil(1), reg(10), coil(2), coil(3),
                                              coil(4, /*groupable=*/false), coil(5)};
    const auto plan = plan_write_transactions(items, 16);
    ASSERT_EQ(plan.size(), 5u);
    EXPECT_EQ(plan[0].items, (std::vector<size_t>{0, 1}));
    EXPECT_EQ(plan[1].items, (std::vector<size_t>{2}));
    EXPECT_EQ(plan[2].items, (std::vector<size_t>{3, 4}));
    EXPECT_EQ(plan[3].items, (std::vector<size_t>{5})) << "mục cần readback đi riêng";
    EXPECT_EQ(plan[4].items, (std::vector<size_t>{6}));
}

TEST(CoilWritePlan, DaiChuaLenhCuNhatDiTruoc)
{
    /* Hàng đợi: coil 9 (cũ nhất) rồi coil 0, coil 1. Dải {0,1} có địa chỉ thấp
     * hơn nhưng không được chen lên trước lệnh đã chờ lâu hơn (G7(c)). */
    const auto plan = plan_write_transactions({coil(9), coil(0), coil(1)}, 16);
    ASSERT_EQ(plan.size(), 2u);
    EXPECT_EQ(plan[0].items, (std::vector<size_t>{0}));
    EXPECT_EQ(plan[1].items, (std::vector<size_t>{1, 2}));
}

/* ---- 2. Profile ----------------------------------------------------------- */

TEST(CoilWriteProfile, MacDinhTatVaDocDungGiaTriKhai)
{
    const struct { const char* json; uint16_t expect; } cases[] = {
        {R"json({"points":[{"name":"d","fc":1,"addr":0,"count":1,"type":"bool","writable":true}]})json", 1},
        {R"json({"max_coils_per_write":8,"points":[{"name":"d","fc":1,"addr":0,"count":1,"type":"bool"}]})json", 8},
        {R"json({"max_coils_per_write":99,"points":[{"name":"d","fc":1,"addr":0,"count":1,"type":"bool"}]})json", 16},
        {R"json({"max_coils_per_write":0,"points":[{"name":"d","fc":1,"addr":0,"count":1,"type":"bool"}]})json", 1},
        {R"json({"max_coils_per_write":-3,"points":[{"name":"d","fc":1,"addr":0,"count":1,"type":"bool"}]})json", 1},
    };
    int n = 0;
    for (const auto& c : cases) {
        const std::string path = batch_profile("prof" + std::to_string(n++), c.json);
        DeviceProfile prof;
        ASSERT_TRUE(load_device_profile(path, &prof));
        EXPECT_EQ(prof.max_coils_per_write, c.expect) << c.json;
        ::unlink(path.c_str());
    }
}

/* `enqueue_writes` — cờ nhận/từ chối đúng THỨ TỰ đầu vào khi hàng đợi đầy
 * giữa loạt; lệnh bị từ chối nhận `write_queue_full`, lệnh trùng coil chờ vẫn
 * coalesce như `enqueue_write`. */
TEST(CoilWriteQueue, EnqueueWritesBaoNhanTuChoiTheoThuTu)
{
    BusWorker worker;
    std::vector<WriteResult> results;
    worker.set_write_result_sink([&](const WriteResult& r) { results.push_back(r); });
    auto cmd = [](uint16_t reg, const std::string& id) {
        PendingWrite w{};
        w.slave_addr = 1;
        w.fc         = 5;
        w.reg_addr   = reg;
        w.value      = 1.0f;
        w.request_id = id;
        return w;
    };
    for (size_t k = 0; k + 2 < kMaxPendingWrites; k++)
        ASSERT_TRUE(worker.enqueue_write(cmd(static_cast<uint16_t>(100 + k), "")));
    const std::vector<bool> accepted =
        worker.enqueue_writes({cmd(0, "a"), cmd(100, "b"), cmd(1, "c"), cmd(2, "d"), cmd(3, "e")});
    /* a vào chỗ trống thứ nhất; b coalesce vào lệnh chờ của coil 100 (không tốn
     * chỗ); c vào chỗ trống cuối; d, e bị từ chối vì hàng đợi đầy. */
    EXPECT_EQ(accepted, (std::vector<bool>{true, true, true, false, false}));
    EXPECT_EQ(worker.pending_write_count(), kMaxPendingWrites);
    ASSERT_EQ(results.size(), 2u);
    EXPECT_EQ(results[0].request_id, "d");
    EXPECT_EQ(results[0].reason, "write_queue_full");
    EXPECT_EQ(results[1].request_id, "e");
}

/* ---- 3. Dây thật trên PTY ------------------------------------------------ */
#ifdef MKDDC_ENABLE_MODBUS
namespace {

uint16_t crc16(const uint8_t* data, size_t len)
{
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int b = 0; b < 8; b++) crc = (crc & 1u) ? static_cast<uint16_t>((crc >> 1) ^ 0xA001u)
                                                     : static_cast<uint16_t>(crc >> 1);
    }
    return crc;
}

/* Slave RTU giả cho NHIỀU địa chỉ trên một dây. Chỉ hiểu đúng những FC mà test
 * dùng; khung khác CRC thì bỏ một byte và đồng bộ lại. */
class FakeRtuBus {
public:
    enum class Mode { Reply, Silent, RejectFc15 };
    struct Request {
        uint8_t  slave = 0;
        uint8_t  fc    = 0;
        uint16_t addr  = 0;
        uint16_t qty   = 0;
        std::vector<uint8_t> data;   /* byte dữ liệu của FC15/16; giá trị của FC05/06 */
        Clock::time_point at;
    };

    void start(int fd, std::set<uint8_t> slaves)
    {
        fd_ = fd;
        slaves_ = std::move(slaves);
        thread_ = std::thread([this]() { loop(); });
    }
    void stop()
    {
        stop_.store(true);
        if (thread_.joinable()) thread_.join();
    }
    ~FakeRtuBus() { stop(); }

    void set_mode(Mode m) { mode_.store(m); }
    std::vector<Request> log()
    {
        std::lock_guard<std::mutex> lock(mu_);
        return log_;
    }
    void clear()
    {
        std::lock_guard<std::mutex> lock(mu_);
        log_.clear();
    }
    uint8_t coil(uint8_t slave, uint16_t addr)
    {
        std::lock_guard<std::mutex> lock(mu_);
        return coils_[slave][addr];
    }
    /* Chờ tới khi tổng số coil đã được lệnh ghi (FC05 tính 1, FC15 tính `qty`)
     * đạt `n` — đo "lệnh đã lên dây" mà không giả định nó lên dây ở dạng nào. */
    bool wait_coils_written(size_t n, std::chrono::milliseconds limit)
    {
        std::unique_lock<std::mutex> lock(mu_);
        return cv_.wait_for(lock, limit, [&]() {
            size_t coils = 0;
            for (const auto& r : log_) {
                if (r.fc == 5) coils += 1;
                else if (r.fc == 15) coils += r.qty;
            }
            return coils >= n;
        });
    }
    /* Chờ tới khi sổ có ít nhất `n` khung thoả `pred`. */
    template <typename Pred>
    bool wait_for(size_t n, std::chrono::milliseconds limit, Pred pred)
    {
        std::unique_lock<std::mutex> lock(mu_);
        return cv_.wait_for(lock, limit, [&]() {
            return static_cast<size_t>(std::count_if(log_.begin(), log_.end(), pred)) >= n;
        });
    }

private:
    void loop()
    {
        std::vector<uint8_t> buf;
        while (!stop_.load()) {
            struct pollfd pfd {fd_, POLLIN, 0};
            if (::poll(&pfd, 1, 20) <= 0) continue;
            uint8_t chunk[256];
            const ssize_t n = ::read(fd_, chunk, sizeof(chunk));
            if (n <= 0) continue;
            buf.insert(buf.end(), chunk, chunk + n);
            while (consume(buf)) {}
        }
    }

    /* Tách MỘT khung ở đầu `buf`; trả false nếu chưa đủ byte. */
    bool consume(std::vector<uint8_t>& buf)
    {
        if (buf.size() < 2) return false;
        const uint8_t fc = buf[1];
        size_t len = 8;
        if (fc == 15 || fc == 16) {
            if (buf.size() < 7) return false;
            len = 9u + buf[6];
        }
        if (buf.size() < len) return false;
        const uint16_t want = static_cast<uint16_t>(buf[len - 2] | (buf[len - 1] << 8));
        if (crc16(buf.data(), len - 2) != want) {
            buf.erase(buf.begin());
            return true;
        }
        std::vector<uint8_t> frame(buf.begin(), buf.begin() + static_cast<long>(len));
        buf.erase(buf.begin(), buf.begin() + static_cast<long>(len));
        handle(frame);
        return true;
    }

    void send(std::vector<uint8_t> out)
    {
        const uint16_t c = crc16(out.data(), out.size());
        out.push_back(static_cast<uint8_t>(c & 0xFF));
        out.push_back(static_cast<uint8_t>(c >> 8));
        (void)!::write(fd_, out.data(), out.size());
    }

    void handle(const std::vector<uint8_t>& f)
    {
        const uint8_t slave = f[0];
        if (!slaves_.count(slave)) return;
        Request req;
        req.slave = slave;
        req.fc    = f[1];
        req.addr  = static_cast<uint16_t>((f[2] << 8) | f[3]);
        req.qty   = static_cast<uint16_t>((f[4] << 8) | f[5]);
        req.at    = Clock::now();
        if (req.fc == 5 || req.fc == 6) {
            req.data = {f[4], f[5]};
            req.qty  = 1;
        } else if (req.fc == 15 || req.fc == 16) {
            req.data.assign(f.begin() + 7, f.end() - 2);
        }
        const Mode mode = mode_.load();
        std::vector<uint8_t> reply;
        {
            std::lock_guard<std::mutex> lock(mu_);
            log_.push_back(req);
            if (mode == Mode::Reply || (mode == Mode::RejectFc15 && req.fc != 15)) {
                auto& coils = coils_[slave];
                if (req.fc == 1) {
                    const uint8_t bytes = static_cast<uint8_t>((req.qty + 7) / 8);
                    reply = {slave, 1, bytes};
                    for (uint8_t b = 0; b < bytes; b++) {
                        uint8_t v = 0;
                        for (int k = 0; k < 8; k++)
                            if (coils[static_cast<uint16_t>(req.addr + b * 8 + k)]) v |= (1u << k);
                        reply.push_back(v);
                    }
                } else if (req.fc == 5) {
                    coils[req.addr] = (f[4] == 0xFF) ? 1 : 0;
                    reply.assign(f.begin(), f.end() - 2);
                } else if (req.fc == 15) {
                    for (uint16_t k = 0; k < req.qty; k++)
                        coils[static_cast<uint16_t>(req.addr + k)] = (req.data[k / 8] >> (k % 8)) & 1u;
                    reply.assign(f.begin(), f.begin() + 6);
                } else if (req.fc == 6) {
                    reply.assign(f.begin(), f.end() - 2);
                } else if (req.fc == 16) {
                    reply.assign(f.begin(), f.begin() + 6);
                } else if (req.fc == 3 || req.fc == 4) {
                    reply = {slave, req.fc, static_cast<uint8_t>(req.qty * 2)};
                    reply.resize(3u + req.qty * 2u, 0);
                }
            } else if (mode == Mode::RejectFc15) {
                reply = {slave, static_cast<uint8_t>(0x80 | 15), 0x01};   /* ILLEGAL FUNCTION */
            }
        }
        cv_.notify_all();
        if (!reply.empty()) send(std::move(reply));
    }

    int fd_ = -1;
    std::set<uint8_t> slaves_;
    std::atomic<bool> stop_{false};
    std::atomic<Mode> mode_{Mode::Reply};
    std::thread thread_;
    std::mutex mu_;
    std::condition_variable cv_;
    std::vector<Request> log_;
    std::map<uint8_t, std::map<uint16_t, uint8_t>> coils_;
};

/* Profile 8 coil `do0..do7` ở địa chỉ 0..7. `extra` chèn khoá cấp thiết bị;
 * `verify_addr` ≥ 0 bật `verify_after_write` cho đúng coil đó. */
std::string ck508_profile(const std::string& tag, const std::string& extra, int verify_addr = -1)
{
    std::string json = "{" + extra + (extra.empty() ? "" : ",") + "\"points\":[";
    for (int a = 0; a < 8; a++) {
        json += std::string(a ? "," : "") + "{\"name\":\"" + tag + "_do" + std::to_string(a) +
                "\",\"fc\":1,\"addr\":" + std::to_string(a) +
                ",\"count\":1,\"type\":\"bool\",\"writable\":true" +
                (a == verify_addr ? ",\"verify_after_write\":true" : "") + "}";
    }
    json += "]}";
    return batch_profile(tag, json);
}

PendingWrite coil_cmd(uint8_t slave, uint16_t addr, float value, const std::string& id,
                      uint16_t ext_idx)
{
    PendingWrite w{};
    w.ext_idx    = ext_idx;
    w.slave_addr = slave;
    w.fc         = 5;
    w.reg_addr   = addr;
    w.value      = value;
    w.type       = PointType::Bool;
    w.byte_order = ByteOrder::AB;
    w.scale      = 1.0f;
    w.request_id = id;
    return w;
}

/* Một dây PTY, một hoặc hai slave CK-508, master đơn luồng (poll_once). Slave
 * có `poll_ms` một giờ: sau lượt đọc mốc, mọi giao dịch trên dây là lệnh ghi. */
struct WireRig {
    int pty = -1;
    std::string dev;
    FakeRtuBus bus;
    std::vector<std::string> profiles;
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    std::mutex results_mu;
    std::vector<WriteResult> results;

    void start(const std::vector<std::pair<uint8_t, std::string>>& slaves)
    {
        pty = ::posix_openpt(O_RDWR | O_NOCTTY);
        ASSERT_GE(pty, 0);
        ASSERT_EQ(::grantpt(pty), 0);
        ASSERT_EQ(::unlockpt(pty), 0);
        dev = ::ptsname(pty);
        std::set<uint8_t> addrs;
        FieldbusConfig cfg;
        cfg.rs485.device = dev;
        cfg.rs485.baud   = 19200;
        for (const auto& [addr, profile] : slaves) {
            addrs.insert(addr);
            profiles.push_back(profile);
            SlaveConfig sl;
            sl.addr       = addr;
            sl.bus_id     = 1;
            sl.profile    = profile;
            sl.name       = "ck508_" + std::to_string(addr);
            sl.poll_ms    = 3600000;
            sl.timeout_ms = 40;
            sl.retry      = 0;
            cfg.slaves.push_back(sl);
        }
        bus.start(pty, addrs);
        master.set_write_result_sink([this](const WriteResult& r) {
            std::lock_guard<std::mutex> lock(results_mu);
            results.push_back(r);
        });
        ASSERT_TRUE(master.open(cfg, cache, metrics));
        master.poll_once(1000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");   /* lượt đọc mốc */
        bus.clear();
    }
    void poll(uint64_t now_ms) { master.poll_once(now_ms, cache, metrics, "/tmp/mkddc-no-fieldbus.sock"); }
    std::map<std::string, WriteResult> results_by_id()
    {
        std::lock_guard<std::mutex> lock(results_mu);
        std::map<std::string, WriteResult> out;
        for (const auto& r : results) out[r.request_id] = r;
        return out;
    }
    ~WireRig()
    {
        master.close();
        bus.stop();
        if (pty >= 0) ::close(pty);
        for (const auto& p : profiles) ::unlink(p.c_str());
    }
};

const float kPattern[8] = {1, 0, 1, 1, 0, 0, 1, 0};   /* bit0 = coil 0 ⇒ 0x4D */

} // namespace

/* Kịch bản của U-07: tám coil đổi cùng lúc, thiết bị bật gom ⇒ MỘT FC15. */
TEST(CoilBatchWire, TamCoilLienKeLenDayThanhMotFc15)
{
    WireRig rig;
    rig.start({{4, ck508_profile("a", "\"max_coils_per_write\":8")}});
    if (HasFatalFailure()) return;
    const uint64_t tx_before = rig.metrics.bus(0).total_transactions;

    /* Thứ tự xếp hàng xáo trộn — như thứ tự điểm theo tên trong profile. */
    for (uint16_t a : {5, 0, 7, 1, 6, 2, 4, 3})
        ASSERT_TRUE(rig.master.submit_write(coil_cmd(4, a, kPattern[a], "r" + std::to_string(a), a)));
    rig.poll(2000);

    const auto log = rig.bus.log();
    ASSERT_EQ(log.size(), 1u) << "tám coil liền kề phải lên dây thành đúng MỘT giao dịch";
    EXPECT_EQ(log[0].fc, 15);
    EXPECT_EQ(log[0].addr, 0u);
    EXPECT_EQ(log[0].qty, 8u);
    ASSERT_EQ(log[0].data.size(), 1u);
    EXPECT_EQ(log[0].data[0], 0x4D);
    for (uint16_t a = 0; a < 8; a++)
        EXPECT_EQ(rig.bus.coil(4, a), kPattern[a] != 0.0f ? 1 : 0) << "coil " << a;

    /* Mỗi request_id nhận ĐÚNG kết quả của nó. */
    const auto results = rig.results_by_id();
    ASSERT_EQ(results.size(), 8u);
    for (uint16_t a = 0; a < 8; a++) {
        const auto it = results.find("r" + std::to_string(a));
        ASSERT_NE(it, results.end()) << "thiếu kết quả r" << a;
        EXPECT_EQ(it->second.status, "applied");
    }
    /* Một giao dịch trên dây ⇒ MỘT mẫu chiếm dây, không phải tám. */
    EXPECT_EQ(rig.metrics.bus(0).total_transactions - tx_before, 1u);
    EXPECT_EQ(rig.master.bus_by_id(1)->pending_write_count(), 0u);

    /* U-18: khung ghi mang giá trị đã phát, từng bit. */
    const std::string frames = rig.metrics.frames().to_json(0, 1);
    EXPECT_NE(frames.find("\"fc\":15,\"addr\":0,\"count\":8"), std::string::npos) << frames;
    EXPECT_NE(frames.find("\"values\":[1,0,1,1,0,0,1,0]"), std::string::npos) << frames;
}

/* Hai module × 8 coil (đúng bố trí trên bo) ⇒ hai giao dịch, mỗi module một. */
TEST(CoilBatchWire, HaiModuleMuoiSauCoilChiHaiGiaoDich)
{
    WireRig rig;
    rig.start({{4, ck508_profile("m4", "\"max_coils_per_write\":8")},
               {5, ck508_profile("m5", "\"max_coils_per_write\":8")}});
    if (HasFatalFailure()) return;
    for (uint16_t a = 0; a < 8; a++) {
        ASSERT_TRUE(rig.master.submit_write(coil_cmd(4, a, 1.0f, "a" + std::to_string(a), a)));
        ASSERT_TRUE(rig.master.submit_write(coil_cmd(5, a, 1.0f, "b" + std::to_string(a),
                                                     static_cast<uint16_t>(8 + a))));
    }
    rig.poll(2000);
    const auto log = rig.bus.log();
    ASSERT_EQ(log.size(), 2u);
    EXPECT_EQ(log[0].slave, 4);
    EXPECT_EQ(log[1].slave, 5);
    for (const auto& r : log) {
        EXPECT_EQ(r.fc, 15);
        EXPECT_EQ(r.qty, 8u);
        EXPECT_EQ(r.data[0], 0xFF);
    }
    EXPECT_EQ(rig.results_by_id().size(), 16u);
}

/* Mặc định (profile không khai) — hành vi CŨ, từng khung một: 8 × FC05 đúng
 * thứ tự xếp hàng, mỗi lượt tối đa `kMaxWritesBeforeRead` giao dịch. */
TEST(CoilBatchWire, TatGomThiGiuNguyenTungFc05)
{
    WireRig rig;
    rig.start({{4, ck508_profile("off", "")}});
    if (HasFatalFailure()) return;
    const std::vector<uint16_t> order = {5, 0, 7, 1, 6, 2, 4, 3};
    for (uint16_t a : order)
        ASSERT_TRUE(rig.master.submit_write(coil_cmd(4, a, kPattern[a], "r" + std::to_string(a), a)));
    rig.poll(2000);
    EXPECT_EQ(rig.bus.log().size(), kMaxWritesBeforeRead) << "trần ghi mỗi lượt giữ nguyên";
    rig.poll(2100);
    const auto log = rig.bus.log();
    ASSERT_EQ(log.size(), 8u);
    for (size_t i = 0; i < log.size(); i++) {
        EXPECT_EQ(log[i].fc, 5);
        EXPECT_EQ(log[i].addr, order[i]);
        EXPECT_EQ(log[i].qty, 1u);
    }
    const std::string frames = rig.metrics.frames().to_json(0, 1);
    EXPECT_NE(frames.find("\"fc\":5"), std::string::npos) << frames;
    EXPECT_NE(frames.find("\"values\":[1]"), std::string::npos) << "coil 3 = 1: " << frames;
}

/* Điểm khai `verify_after_write` KHÔNG được gom: nó phải đọc lại đúng coil của
 * nó ngay sau lệnh ghi của nó. Các coil hai bên vẫn gom được. */
TEST(CoilBatchWire, DiemCanReadbackDiRiengCacCoilConLaiVanGom)
{
    WireRig rig;
    rig.start({{4, ck508_profile("rb", "\"max_coils_per_write\":8", /*verify_addr=*/3)}});
    if (HasFatalFailure()) return;
    for (uint16_t a = 0; a < 8; a++)
        ASSERT_TRUE(rig.master.submit_write(coil_cmd(4, a, 1.0f, "r" + std::to_string(a), a)));
    rig.poll(2000);
    const auto log = rig.bus.log();
    ASSERT_EQ(log.size(), 4u);
    EXPECT_EQ(log[0].fc, 15); EXPECT_EQ(log[0].addr, 0u); EXPECT_EQ(log[0].qty, 3u);
    EXPECT_EQ(log[1].fc, 5);  EXPECT_EQ(log[1].addr, 3u);
    EXPECT_EQ(log[2].fc, 1);  EXPECT_EQ(log[2].addr, 3u) << "readback của coil 3";
    EXPECT_EQ(log[3].fc, 15); EXPECT_EQ(log[3].addr, 4u); EXPECT_EQ(log[3].qty, 4u);
    const auto results = rig.results_by_id();
    ASSERT_EQ(results.size(), 8u);
    EXPECT_TRUE(results.at("r3").has_readback);
    EXPECT_EQ(results.at("r3").status, "applied");
}

/* Điểm coil khai `count` > 1 kèm `verify_after_write`: mọi coil của nó phải được
 * xác nhận — bản trước chỉ khớp `pt.addr == reg_addr` nên chỉ coil đầu. */
TEST(CoilBatchWire, VerifyAfterWriteApDungChoMoiCoilCuaDiemNhieuCoil)
{
    WireRig rig;
    rig.start({{4, batch_profile("multi",
        R"json({"max_coils_per_write":8,"points":[{"name":"bank","fc":1,"addr":0,"count":4,"type":"bool","writable":true,"verify_after_write":true}]})json")}});
    if (HasFatalFailure()) return;
    ASSERT_TRUE(rig.master.submit_write(coil_cmd(4, 2, 1.0f, "c2", 2)));
    rig.poll(2000);
    const auto log = rig.bus.log();
    ASSERT_EQ(log.size(), 2u);
    EXPECT_EQ(log[0].fc, 5);
    EXPECT_EQ(log[1].fc, 1) << "coil 2 của điểm `bank` phải được đọc lại xác nhận";
    EXPECT_TRUE(rig.results_by_id().at("c2").has_readback);
}

/* Slave câm: MỘT khung FC15 hỏng là một lượt thử hỏng của MỌI coil trong khung.
 * Sau `kMaxWriteAttempts` lượt, từng lệnh bị bỏ với kết quả riêng. */
TEST(CoilBatchWire, LoiGiaoDichMoiMucTangAttemptsVaBoSauBaLan)
{
    WireRig rig;
    rig.start({{4, ck508_profile("silent", "\"max_coils_per_write\":8")}});
    if (HasFatalFailure()) return;
    rig.bus.set_mode(FakeRtuBus::Mode::Silent);
    for (uint16_t a = 0; a < 8; a++)
        ASSERT_TRUE(rig.master.submit_write(coil_cmd(4, a, 1.0f, "r" + std::to_string(a),
                                                     static_cast<uint16_t>(20 + a))));
    for (uint64_t t = 2000; t <= 2400 && rig.master.bus_by_id(1)->pending_write_count() > 0; t += 100)
        rig.poll(t);
    EXPECT_EQ(rig.master.bus_by_id(1)->pending_write_count(), 0u);

    const auto log = rig.bus.log();
    size_t fc15 = 0;
    for (const auto& r : log) {
        EXPECT_NE(r.fc, 5) << "không được rã nhóm thành FC05 khi lỗi";
        if (r.fc == 15) fc15++;
    }
    EXPECT_EQ(fc15, static_cast<size_t>(kMaxWriteAttempts));

    const auto m = rig.metrics.get(0);
    EXPECT_EQ(m.write_failed, 8u * kMaxWriteAttempts) << "lỗi ghi đếm theo TỪNG điểm";
    EXPECT_EQ(m.write_dropped, 8u);
    const auto results = rig.results_by_id();
    ASSERT_EQ(results.size(), 8u);
    for (const auto& [id, r] : results) {
        EXPECT_EQ(r.status, "timeout") << id;
        EXPECT_EQ(r.reason, "write_failed_after_max_attempts") << id;
    }
    std::vector<uint16_t> dropped = rig.master.bus_by_id(1)->take_dropped_write_slots();
    std::sort(dropped.begin(), dropped.end());
    EXPECT_EQ(dropped, (std::vector<uint16_t>{20, 21, 22, 23, 24, 25, 26, 27}));

    /* Khung trong vòng nhớ: ba lượt, `attempt` 1 → 3, đều mang giá trị đã phát. */
    const std::string frames = rig.metrics.frames().to_json(0, 200);
    for (const char* needle : {"\"attempt\":1,\"values\":[1,1,1,1,1,1,1,1]",
                               "\"attempt\":2,\"values\":[1,1,1,1,1,1,1,1]",
                               "\"attempt\":3,\"values\":[1,1,1,1,1,1,1,1]"})
        EXPECT_NE(frames.find(needle), std::string::npos) << needle << "\n" << frames;
}

/* Thiết bị KHÔNG hỗ trợ FC15 mà bị bật gom ⇒ exception ILLEGAL FUNCTION; lệnh
 * bị bỏ với `rejected` + mã exception, không báo `applied` sai. */
TEST(CoilBatchWire, ThietBiTuChoiFc15BaoRejectedKemMaException)
{
    WireRig rig;
    rig.start({{4, ck508_profile("rej", "\"max_coils_per_write\":8")}});
    if (HasFatalFailure()) return;
    rig.bus.set_mode(FakeRtuBus::Mode::RejectFc15);
    for (uint16_t a = 0; a < 2; a++)
        ASSERT_TRUE(rig.master.submit_write(coil_cmd(4, a, 1.0f, "r" + std::to_string(a), a)));
    for (uint64_t t = 2000; t <= 2400 && rig.master.bus_by_id(1)->pending_write_count() > 0; t += 100)
        rig.poll(t);
    const auto results = rig.results_by_id();
    ASSERT_EQ(results.size(), 2u);
    for (const auto& [id, r] : results) {
        EXPECT_EQ(r.status, "rejected") << id;
        EXPECT_EQ(r.exception_code, 0x01) << id;
    }
}

/* Đường Core → plc_shm → `drain_ext_writes` với worker chạy THẬT trên thread.
 *
 * Worker được đánh thức ngay ở lệnh đầu (G7). Nếu `drain_ext_writes` xếp từng
 * lệnh một, worker có thể chụp hàng đợi khi mới có một phần của loạt và phát
 * phần đó riêng — 8 coil đổi cùng chu kỳ thành vài giao dịch. Mỗi loạt phải là
 * đúng MỘT FC15 × 8, lặp đủ nhiều lần để một khe hở thời gian lộ ra. */
TEST(CoilBatchDrain, MoiLuotQuetCoreLenDayDungMotFc15)
{
    int pty = ::posix_openpt(O_RDWR | O_NOCTTY);
    ASSERT_GE(pty, 0);
    ASSERT_EQ(::grantpt(pty), 0);
    ASSERT_EQ(::unlockpt(pty), 0);
    const std::string dev = ::ptsname(pty);
    const std::string profile = ck508_profile("drain", "\"max_coils_per_write\":8");
    FakeRtuBus bus;
    bus.start(pty, {4});

    FieldbusConfig cfg;
    cfg.rs485.device = dev;
    cfg.rs485.baud   = 19200;
    SlaveConfig sl;
    sl.addr = 4; sl.bus_id = 1; sl.profile = profile; sl.name = "ck508_4";
    sl.poll_ms = 3600000; sl.timeout_ms = 100; sl.retry = 0;
    cfg.slaves.push_back(sl);
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg, cache, metrics));
    master.start_workers(cache, metrics);
    ASSERT_TRUE(bus.wait_for(1, std::chrono::milliseconds(2000),
                             [](const FakeRtuBus::Request& r) { return r.fc == 1; }))
        << "worker không đọc lần đầu";

    auto shm = std::make_unique<kx_plc_shm_t>();
    std::memset(shm.get(), 0, sizeof(kx_plc_shm_t));
    shm->magic     = KX_SHM_MAGIC;
    shm->seq       = 2;
    shm->ext_count = 8;
    for (int a = 0; a < 8; a++) {
        const std::string name = "drain_do" + std::to_string(a);
        std::strncpy(shm->ext[a].name, name.c_str(), sizeof(shm->ext[a].name) - 1);
    }
    master.drain_ext_writes(shm.get(), monotonic_ms());   /* lượt mốc */

    constexpr int kBursts = 20;
    for (int b = 1; b <= kBursts; b++) {
        for (int a = 0; a < 8; a++) {
            shm->ext[a].setpoint = ((a + b) % 2) ? 1.0 : 0.0;
            shm->ext[a].dirty    = 1;
            shm->ext_cmd_seq[a]  = static_cast<uint32_t>(b);
        }
        master.drain_ext_writes(shm.get(), monotonic_ms());
        /* Chờ đủ 8 coil của loạt này lên dây (dù ở dạng nào), rồi thêm một
         * khoảng để một giao dịch lẻ còn sót kịp lộ ra. */
        ASSERT_TRUE(bus.wait_coils_written(8u * static_cast<size_t>(b), std::chrono::milliseconds(2000)))
            << "loạt " << b << " không lên dây đủ 8 coil trong 2 s";
        std::this_thread::sleep_for(std::chrono::milliseconds(15));
    }
    master.stop_workers();
    const auto log = bus.log();
    bus.stop();
    master.close();
    ::close(pty);
    ::unlink(profile.c_str());

    size_t fc15_full = 0, other_writes = 0;
    for (const auto& r : log) {
        if (r.fc == 15 && r.qty == 8) fc15_full++;
        else if (r.fc == 5 || r.fc == 15) other_writes++;
    }
    EXPECT_EQ(fc15_full, static_cast<size_t>(kBursts))
        << "mỗi lượt quét Core phải là đúng một FC15 × 8";
    EXPECT_EQ(other_writes, 0u) << "có loạt bị xé thành giao dịch lẻ";
    std::printf("[ ĐO       ] %d loạt × 8 coil: FC15×8=%zu, giao dịch ghi lẻ=%zu\n",
                kBursts, fc15_full, other_writes);
}
#endif /* MKDDC_ENABLE_MODBUS */
