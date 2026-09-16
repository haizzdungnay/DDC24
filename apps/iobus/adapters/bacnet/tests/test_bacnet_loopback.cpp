/**
 * @file  test_bacnet_loopback.cpp
 * @brief T-BAC-013 — tầng test `LOOPBACK`: UDP THẬT trên `127.0.0.1`.
 *
 * Vì sao tầng này tồn tại (ADR-060, `PLAN-BACNET-D2C-001` Wave W1):
 *
 * Bộ test `HOST` gọi thẳng vào lớp C++ và không mở socket nào. Nó không nhìn
 * thấy thứ nằm giữa `bacnet_server.cpp` và dây mạng: bảng handler của
 * bacnet-stack. Một service khai trong PICS mà quên `apdu_set_confirmed_handler`
 * vẫn để toàn bộ `HOST` xanh, trong khi một BMS thật nhận về Reject.
 *
 * Tầng `LOOPBACK` khẳng định trên **gói nhận được**, không trên trạng thái nội
 * bộ: dựng `BacnetServer` thật, mở socket UDP thật, gửi khung BACnet/IP thật từ
 * một socket client riêng, rồi giải mã đúng byte quay về.
 *
 * Thang bằng chứng: `LOOPBACK` PASS ghi là **`VERIFIED-LOOPBACK`**, KHÔNG ghi
 * `VERIFIED` — nó chứng minh đường mã tới datalink, không chứng minh khả năng
 * liên thông với thiết bị thật trên bo (ADR-060). Xem
 * `docs/05_verification/EVIDENCE_LEVELS.md`.
 *
 * Cổng UDP: xin cổng rảnh lúc chạy (bind `0.0.0.0:0` rồi đọc `getsockname`),
 * KHÔNG ghim 47808 — hai lần `ctest` song song và một `mkddc-iobus` đang chạy
 * trên máy dev phải không đụng nhau.
 *
 * Không cần `sudo`, không cần capability mạng, không cần bo.
 */
#include <gtest/gtest.h>

#ifdef MKDDC_ENABLE_BACNET

#include <gtest/gtest-spi.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cstring>
#include <string>
#include <vector>

#include "bacnet_objects.hpp"
#include "bacnet_server.hpp"
#include "mkddc_shm.h"

#include <bacnet/bacdef.h>
#include <bacnet/bacapp.h>
#include <bacnet/bacenum.h>
#include <bacnet/bacdcode.h>
#include <bacnet/cov.h>
#include <bacnet/iam.h>
#include <bacnet/npdu.h>
#include <bacnet/rp.h>
#include <bacnet/whois.h>
#include <bacnet/wp.h>
#include <bacnet/datalink/bip.h>
#include <bacnet/datalink/bvlc.h>
#include <bacnet/datalink/datalink.h>

using namespace iobus::bacnet;

namespace {

/* Mọi ca có timeout hữu hạn: test không bao giờ treo khi không nhận được gói.
 * 3000 ms là trần tổng cho một lượt gửi/nhận trên loopback — đường đi thực tế
 * dưới 20 ms; trần rộng để không lật vì máy CI bận, vẫn đủ nhỏ để một handler
 * thiếu hiện ra thành FAIL trong vài giây chứ không thành job treo. */
constexpr unsigned kExchangeTimeoutMs = 3000;

constexpr uint32_t kDeviceId = 4194002;

/* AI1 = 23.5 °C: giá trị không phải 0 và không phải mặc định của stack, nên một
 * ACK trả về đúng số này chỉ có thể tới từ `plc_shm`. */
constexpr float kAi1Value = 23.5f;
constexpr float kAo1Write = 5.5f;
constexpr uint8_t kAo1Priority = 8;

/** Xin một cổng UDP rảnh lúc chạy.
 *
 * Bind `INADDR_ANY:0` để kernel cấp cổng, đọc lại bằng `getsockname`, rồi đóng.
 * Cổng rảnh trên `0.0.0.0` thì cũng rảnh trên `127.0.0.1` lẫn địa chỉ broadcast
 * của `lo` — `bip_init()` bind CẢ HAI, nên không được chỉ kiểm mỗi `127.0.0.1`.
 *
 * Có cửa sổ tranh chấp giữa lúc đóng và lúc `bip_init` bind lại; đó là đánh đổi
 * chấp nhận được so với việc ghim cứng một cổng, vì cổng ghim cứng thì hỏng
 * CHẮC CHẮN khi chạy song song, còn cửa sổ này thì gần như không bao giờ trúng.
 */
uint16_t acquire_free_udp_port()
{
    const int fd = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (fd < 0) return 0;
    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port        = 0;
    uint16_t port = 0;
    if (::bind(fd, reinterpret_cast<const sockaddr*>(&addr), sizeof(addr)) == 0) {
        socklen_t len = sizeof(addr);
        if (::getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &len) == 0)
            port = ntohs(addr.sin_port);
    }
    ::close(fd);
    return port;
}

uint64_t monotonic_ms()
{
    using namespace std::chrono;
    return static_cast<uint64_t>(
        duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count());
}

struct CoreCall {
    std::string op;
    uint32_t    point_idx = 0;
    float       value     = 0.0f;
    std::string user;
    int         prio      = 0;
};

/**
 * Fixture: một `BacnetServer` thật bind trên `lo`, một socket client thật.
 *
 * Client là socket UDP trần — KHÔNG dùng lớp client của bacnet-stack (TSM,
 * `Send_*_Request`) vì những hàm đó chia sẻ trạng thái toàn cục với server
 * trong cùng tiến trình. Chỉ dùng hàm *encode/decode* (thuần, không trạng thái)
 * để dựng và đọc khung, còn việc gửi/nhận là `sendto`/`recvfrom` trực tiếp.
 */
class BacnetLoopback : public ::testing::Test {
protected:
    void SetUp() override
    {
        port_ = acquire_free_udp_port();
        ASSERT_NE(port_, 0u) << "không xin được cổng UDP rảnh";

        cfg_.device.device_id   = kDeviceId;
        cfg_.device.device_name = "MK-DDC-24-LOOPBACK";
        cfg_.bip.bind_interface = "lo";
        cfg_.bip.udp_port       = port_;

        objects_.init(cfg_);

        auto core_fn = [this](const std::string& op, uint32_t idx, float value,
                              const std::string& user, int prio) {
            core_calls_.push_back(CoreCall{op, idx, value, user, prio});
            return true;
        };
        ASSERT_TRUE(server_.init(cfg_, &objects_, core_fn, [](bool) {}));
        ASSERT_TRUE(server_.start())
            << "bip_init thất bại trên lo:" << port_;

        ASSERT_TRUE(open_client());
        reset_shm();
    }

    void TearDown() override
    {
        if (client_fd_ >= 0) {
            ::close(client_fd_);
            client_fd_ = -1;
        }
        server_.stop();
    }

    /* ---- plc_shm giả lập: core là writer duy nhất, test đóng vai core ---- */
    void reset_shm()
    {
        std::memset(&shm_, 0, sizeof(shm_));
        shm_.magic = KX_SHM_MAGIC;
        shm_.seq   = 2;                     /* chẵn = không có writer đang ghi */
        for (int i = 0; i < KX_N_UI; ++i)
            shm_.ai[i].reliability = KX_REL_RELIABLE;
        shm_.ai[0].value = kAi1Value;
    }

    bool open_client()
    {
        client_fd_ = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (client_fd_ < 0) return false;
        sockaddr_in bind_addr{};
        bind_addr.sin_family      = AF_INET;
        bind_addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        bind_addr.sin_port        = 0;      /* cổng nguồn tuỳ kernel cấp */
        if (::bind(client_fd_, reinterpret_cast<const sockaddr*>(&bind_addr),
                   sizeof(bind_addr)) != 0)
            return false;

        std::memset(&server_addr_, 0, sizeof(server_addr_));
        server_addr_.sin_family      = AF_INET;
        server_addr_.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        server_addr_.sin_port        = htons(port_);
        return true;
    }

    /** Bọc APDU vào NPDU + BVLL Original-Unicast rồi bắn thẳng ra socket. */
    bool send_apdu(const uint8_t* apdu, uint16_t apdu_len, bool expect_reply)
    {
        uint8_t npdu[MAX_MPDU] = {};
        BACNET_NPDU_DATA npdu_data{};
        npdu_encode_npdu_data(&npdu_data, expect_reply, MESSAGE_PRIORITY_NORMAL);
        const int npdu_len = bacnet_npdu_encode_pdu(
            &npdu[0], sizeof(npdu), nullptr, nullptr, &npdu_data);
        if (npdu_len <= 0 || npdu_len + apdu_len > static_cast<int>(sizeof(npdu)))
            return false;
        std::memcpy(&npdu[npdu_len], apdu, apdu_len);

        uint8_t pdu[MAX_MPDU] = {};
        const int pdu_len = bvlc_encode_original_unicast(
            &pdu[0], sizeof(pdu), &npdu[0],
            static_cast<uint16_t>(npdu_len + apdu_len));
        if (pdu_len <= 0) return false;

        const ssize_t sent = ::sendto(
            client_fd_, pdu, static_cast<size_t>(pdu_len), 0,
            reinterpret_cast<const sockaddr*>(&server_addr_), sizeof(server_addr_));
        return sent == pdu_len;
    }

    /**
     * Bơm server và chờ đúng một gói quay về client.
     *
     * Một tiến trình, một luồng: `tick()` đọc gói client vừa gửi, xử lý, và gửi
     * đáp ứng ngay trong lời gọi đó. Sau mỗi `tick` thử đọc không chặn. Vòng lặp
     * có deadline cứng nên không có đường nào treo vô hạn.
     *
     * @return độ dài APDU giải mã được, 0 nếu hết thời gian chờ.
     */
    int exchange(uint8_t* apdu_out, size_t apdu_size)
    {
        const uint64_t deadline = monotonic_ms() + kExchangeTimeoutMs;
        while (monotonic_ms() < deadline) {
            /* `tick()` chặn 5 ms trong `datalink_receive`, nên vòng chờ này có
             * nhịp sẵn và không quay không tải. */
            server_.tick(monotonic_ms(), &shm_);

            uint8_t pdu[MAX_MPDU] = {};
            const ssize_t n = ::recvfrom(client_fd_, pdu, sizeof(pdu),
                                         MSG_DONTWAIT, nullptr, nullptr);
            if (n <= 0) continue;
            return decode_pdu(pdu, static_cast<int>(n), apdu_out, apdu_size);
        }
        return 0;
    }

    /** Bóc BVLL + NPDU, trả về phần APDU. 0 nếu khung không hợp lệ. */
    static int decode_pdu(const uint8_t* pdu, int pdu_len,
                          uint8_t* apdu_out, size_t apdu_size)
    {
        if (pdu_len < 4) return 0;
        if (pdu[0] != BVLL_TYPE_BACNET_IP) return 0;
        const int bvlc_len = (pdu[2] << 8) | pdu[3];
        if (bvlc_len != pdu_len) return 0;

        BACNET_ADDRESS dest{};
        BACNET_ADDRESS src{};
        BACNET_NPDU_DATA npdu_data{};
        const int npdu_len = bacnet_npdu_decode(
            const_cast<uint8_t*>(&pdu[4]), static_cast<uint16_t>(pdu_len - 4),
            &dest, &src, &npdu_data);
        if (npdu_len <= 0) return 0;

        const int apdu_len = pdu_len - 4 - npdu_len;
        if (apdu_len <= 0 || static_cast<size_t>(apdu_len) > apdu_size) return 0;
        std::memcpy(apdu_out, &pdu[4 + npdu_len], static_cast<size_t>(apdu_len));
        return apdu_len;
    }

    /** Gửi một confirmed request rồi trả về APDU đáp ứng. */
    int request(const uint8_t* apdu, uint16_t apdu_len,
                uint8_t* reply, size_t reply_size)
    {
        if (!send_apdu(apdu, apdu_len, /*expect_reply=*/true)) return 0;
        return exchange(reply, reply_size);
    }

    uint16_t            port_ = 0;
    int                 client_fd_ = -1;
    sockaddr_in         server_addr_{};
    BacnetConfig        cfg_;
    BacnetObjects       objects_;
    BacnetServer        server_;
    kx_plc_shm_t        shm_{};
    std::vector<CoreCall> core_calls_;
};

/* ------------------------------------------------------------------------- */

/** Socket UDP thật đã mở — đối chứng cho toàn bộ tầng này.
 *
 * `HOST` không có dòng nào tương đương: `bip_get_socket()` ở đó luôn là -1 vì
 * `bip_init` chưa từng chạy. */
TEST_F(BacnetLoopback, ServerOpensRealUdpSocketOnLoopback)
{
    const int fd = bip_get_socket();
    ASSERT_GE(fd, 0) << "bip_init không mở được socket";

    sockaddr_in bound{};
    socklen_t len = sizeof(bound);
    ASSERT_EQ(::getsockname(fd, reinterpret_cast<sockaddr*>(&bound), &len), 0);
    EXPECT_EQ(bound.sin_family, AF_INET);
    EXPECT_EQ(ntohs(bound.sin_port), port_);
    EXPECT_EQ(ntohl(bound.sin_addr.s_addr), INADDR_LOOPBACK);
    EXPECT_NE(port_, 47808u) << "cổng phải xin lúc chạy, không ghim mặc định";
}

/** Who-Is → I-Am mang đúng `device_id` đã cấu hình. */
TEST_F(BacnetLoopback, WhoIsAnswersWithIAmCarryingConfiguredDeviceId)
{
    uint8_t apdu[MAX_APDU] = {};
    const int apdu_len = whois_encode_apdu(&apdu[0], -1, -1);
    ASSERT_GT(apdu_len, 0);
    ASSERT_TRUE(send_apdu(apdu, static_cast<uint16_t>(apdu_len),
                          /*expect_reply=*/false));

    uint8_t reply[MAX_APDU] = {};
    const int reply_len = exchange(reply, sizeof(reply));
    ASSERT_GT(reply_len, 2) << "không nhận được I-Am trong "
                            << kExchangeTimeoutMs << " ms";
    ASSERT_EQ(reply[0], PDU_TYPE_UNCONFIRMED_SERVICE_REQUEST);
    ASSERT_EQ(reply[1], SERVICE_UNCONFIRMED_I_AM);

    uint32_t device_id  = 0;
    unsigned max_apdu   = 0;
    int      segmentation = 0;
    uint16_t vendor_id  = 0;
    ASSERT_GT(iam_decode_service_request(&reply[2], &device_id, &max_apdu,
                                         &segmentation, &vendor_id), 0);
    EXPECT_EQ(device_id, kDeviceId);
}

/** ReadProperty AI1 Present_Value → đúng giá trị đã ghi vào `plc_shm`. */
TEST_F(BacnetLoopback, ReadPropertyAnalogInputReturnsValueFromSharedMemory)
{
    BACNET_READ_PROPERTY_DATA rpdata{};
    rpdata.object_type     = OBJECT_ANALOG_INPUT;
    rpdata.object_instance = 1;
    rpdata.object_property = PROP_PRESENT_VALUE;
    rpdata.array_index     = BACNET_ARRAY_ALL;

    uint8_t apdu[MAX_APDU] = {};
    const int apdu_len = rp_encode_apdu(&apdu[0], /*invoke_id=*/1, &rpdata);
    ASSERT_GT(apdu_len, 0);

    uint8_t reply[MAX_APDU] = {};
    const int reply_len = request(apdu, static_cast<uint16_t>(apdu_len),
                                  reply, sizeof(reply));
    ASSERT_GT(reply_len, 3) << "không nhận được đáp ứng ReadProperty trong "
                            << kExchangeTimeoutMs << " ms";
    ASSERT_EQ(reply[0], PDU_TYPE_COMPLEX_ACK)
        << "PDU type nhận được = 0x" << std::hex << static_cast<int>(reply[0]);
    ASSERT_EQ(reply[1], 1);                       /* invoke_id dội lại */
    ASSERT_EQ(reply[2], SERVICE_CONFIRMED_READ_PROPERTY);

    BACNET_READ_PROPERTY_DATA ack{};
    ASSERT_GT(rp_ack_decode_service_request(&reply[3], reply_len - 3, &ack), 0);
    EXPECT_EQ(ack.object_type, OBJECT_ANALOG_INPUT);
    EXPECT_EQ(ack.object_instance, 1u);
    EXPECT_EQ(ack.object_property, PROP_PRESENT_VALUE);

    BACNET_APPLICATION_DATA_VALUE value{};
    ASSERT_GT(bacapp_decode_application_data(ack.application_data,
                                             static_cast<unsigned>(ack.application_data_len),
                                             &value), 0);
    ASSERT_EQ(value.tag, BACNET_APPLICATION_TAG_REAL);
    EXPECT_FLOAT_EQ(value.type.Real, kAi1Value);
}

/** WriteProperty AO1 ở priority 8 → đúng một lệnh xuống core, prio nội bộ 3. */
TEST_F(BacnetLoopback, WritePropertyAnalogOutputReachesCoreExactlyOnce)
{
    BACNET_WRITE_PROPERTY_DATA wpdata{};
    wpdata.object_type     = OBJECT_ANALOG_OUTPUT;
    wpdata.object_instance = 1;
    wpdata.object_property = PROP_PRESENT_VALUE;
    wpdata.array_index     = BACNET_ARRAY_ALL;
    wpdata.priority        = kAo1Priority;

    BACNET_APPLICATION_DATA_VALUE value{};
    value.tag       = BACNET_APPLICATION_TAG_REAL;
    value.type.Real = kAo1Write;
    wpdata.application_data_len = bacapp_encode_application_data(
        &wpdata.application_data[0], &value);
    ASSERT_GT(wpdata.application_data_len, 0);

    uint8_t apdu[MAX_APDU] = {};
    const int apdu_len = wp_encode_apdu(&apdu[0], /*invoke_id=*/2, &wpdata);
    ASSERT_GT(apdu_len, 0);

    uint8_t reply[MAX_APDU] = {};
    const int reply_len = request(apdu, static_cast<uint16_t>(apdu_len),
                                  reply, sizeof(reply));
    ASSERT_GE(reply_len, 3) << "không nhận được đáp ứng WriteProperty trong "
                            << kExchangeTimeoutMs << " ms";
    ASSERT_EQ(reply[0], PDU_TYPE_SIMPLE_ACK)
        << "PDU type nhận được = 0x" << std::hex << static_cast<int>(reply[0]);
    EXPECT_EQ(reply[1], 2);
    EXPECT_EQ(reply[2], SERVICE_CONFIRMED_WRITE_PROPERTY);

    ASSERT_EQ(core_calls_.size(), 1u) << "lệnh xuống core phải đúng một lần";
    EXPECT_EQ(core_calls_[0].op, "ao_setpoint");
    EXPECT_EQ(core_calls_[0].point_idx, 0u);      /* AO1 → index 0 */
    EXPECT_FLOAT_EQ(core_calls_[0].value, kAo1Write);
    EXPECT_EQ(core_calls_[0].prio, 3);            /* PRIO_BACNET nội bộ */
}

/** Service không hỗ trợ → Reject đúng chuẩn, không treo, không crash. */
TEST_F(BacnetLoopback, UnsupportedServiceIsRejectedNotDropped)
{
    /* AtomicReadFile: chưa bao giờ đăng ký handler và PICS cũng không khai. */
    uint8_t apdu[MAX_APDU] = {};
    apdu[0] = PDU_TYPE_CONFIRMED_SERVICE_REQUEST;
    apdu[1] = 0;                                  /* max segments / max APDU */
    apdu[2] = 7;                                  /* invoke_id */
    apdu[3] = SERVICE_CONFIRMED_ATOMIC_READ_FILE;

    uint8_t reply[MAX_APDU] = {};
    const int reply_len = request(apdu, 4, reply, sizeof(reply));
    ASSERT_GE(reply_len, 3) << "service lạ không được phép nuốt im lặng";
    EXPECT_EQ(reply[0], PDU_TYPE_REJECT);
    EXPECT_EQ(reply[1], 7);
    EXPECT_EQ(reply[2], REJECT_REASON_UNRECOGNIZED_SERVICE);
}

/**
 * SubscribeCOV — CA KỲ VỌNG THẤT BẠI, sẽ do `T-BAC-044` làm cho xanh.
 *
 * PICS khai `DS-COV-B`, nhưng `bacnet_server.cpp` không có dòng
 * `apdu_set_confirmed_handler(SERVICE_CONFIRMED_SUBSCRIBE_COV, …)` nào. Một BMS
 * gửi SubscribeCOV hôm nay nhận về Reject. 1482 test `HOST` không bắt được —
 * đó chính là hố mà tầng `LOOPBACK` sinh ra để lấp.
 *
 * Cách đánh dấu: `EXPECT_NONFATAL_FAILURE` — cơ chế kỳ vọng-thất-bại sẵn có của
 * GoogleTest. KHÔNG `DISABLED_`, KHÔNG `GTEST_SKIP()`, KHÔNG xoá: một ca bị vô
 * hiệu hoá sẽ không ai bật lại, còn ca này vẫn chạy thật, vẫn gửi gói thật, và
 * **tự đỏ ngay khi `T-BAC-044` gắn handler vào** — lúc đó khẳng định bên trong
 * hết thất bại, `EXPECT_NONFATAL_FAILURE` hỏng, và người sửa buộc phải quay lại
 * lật ca này thành khẳng định thẳng. Đó là khác biệt giữa "ghi nợ có hẹn trả"
 * và "giấu nợ".
 */
TEST_F(BacnetLoopback, SubscribeCovIsRejectedToday_ExpectedFailureUntilTBac044)
{
    BACNET_SUBSCRIBE_COV_DATA cov{};
    cov.subscriberProcessIdentifier        = 1;
    cov.monitoredObjectIdentifier.type     = OBJECT_ANALOG_INPUT;
    cov.monitoredObjectIdentifier.instance = 1;
    cov.cancellationRequest                = false;
    cov.issueConfirmedNotifications        = false;
    cov.lifetime                           = 60;

    uint8_t apdu[MAX_APDU] = {};
    const int apdu_len = cov_subscribe_encode_apdu(&apdu[0], sizeof(apdu),
                                                   /*invoke_id=*/3, &cov);
    ASSERT_GT(apdu_len, 0);

    uint8_t reply[MAX_APDU] = {};
    const int reply_len = request(apdu, static_cast<uint16_t>(apdu_len),
                                  reply, sizeof(reply));

    /* Hành vi HÔM NAY, khẳng định thẳng để tài liệu hoá đúng thực tế. */
    ASSERT_GE(reply_len, 3) << "SubscribeCOV không được nuốt im lặng";
    EXPECT_EQ(reply[0], PDU_TYPE_REJECT);
    EXPECT_EQ(reply[2], REJECT_REASON_UNRECOGNIZED_SERVICE);

    /* Hành vi ĐÚNG theo PICS `DS-COV-B`: phải là SimpleACK. Thất bại hôm nay. */
    EXPECT_NONFATAL_FAILURE(
        EXPECT_EQ(reply[0], PDU_TYPE_SIMPLE_ACK),
        "PDU_TYPE_SIMPLE_ACK");
}

}  // namespace

#else  /* !MKDDC_ENABLE_BACNET */

/**
 * `BACNET=OFF`: tầng `LOOPBACK` không có gì để chạy — bacnet-stack không được
 * biên dịch vào, `bip_init` không tồn tại.
 *
 * Ca này vẫn được ĐĂNG KÝ và báo `SKIPPED` trong output `ctest`. `ADR-060` điều
 * (4) cấm để `BACNET=OFF` thành đường build duy nhất được kiểm; một tầng test tự
 * tàng hình khi tắt cờ sẽ tái tạo đúng vấn đề đó — nhìn vào bảng kết quả không
 * ai phân biệt được "đã chạy và xanh" với "chưa từng tồn tại".
 */
TEST(BacnetLoopback, SkippedWhenBacnetStackDisabled)
{
    GTEST_SKIP() << "MKDDC_ENABLE_BACNET=OFF — tầng LOOPBACK cần bacnet-stack "
                    "được biên dịch vào (ADR-060). Dựng lại với "
                    "-DMKDDC_ENABLE_BACNET=ON để chạy tầng này.";
}

#endif /* MKDDC_ENABLE_BACNET */
