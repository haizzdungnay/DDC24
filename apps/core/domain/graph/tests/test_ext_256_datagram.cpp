/**
 * @file  test_ext_256_datagram.cpp
 * @brief Benchmark & verification test for 256 Modbus Points datagram & memory copy (Epic B2).
 */

#include <chrono>
#include <cstring>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <gtest/gtest.h>

#include "mkddc_shm.h"

namespace {

struct ExtDatagramPacket {
    uint32_t magic;
    uint32_t count;
    uint64_t timestamp_ms;
    kx_ext_point_t points[KX_N_EXT];
};

TEST(Ext256DatagramTest, VerifyKXNExt256Constant) {
    EXPECT_EQ(KX_N_EXT, 256);
}

TEST(Ext256DatagramTest, SnapshotMemoryCopyPerformance) {
    kx_ext_point_t src[KX_N_EXT] = {};
    kx_ext_point_t dst[KX_N_EXT] = {};

    for (size_t i = 0; i < KX_N_EXT; ++i) {
        std::snprintf(src[i].name, sizeof(src[i].name), "PT_%03zu", i);
        src[i].value = static_cast<float>(i * 1.5f);
        src[i].quality = KX_Q_GOOD;
        src[i].online = 1;
    }

    const auto start = std::chrono::high_resolution_clock::now();
    for (int iter = 0; iter < 100; ++iter) {
        std::memcpy(dst, src, sizeof(src));
    }
    const auto elapsed = std::chrono::high_resolution_clock::now() - start;
    const double avg_us = std::chrono::duration<double, std::micro>(elapsed).count() / 100.0;

    EXPECT_LT(avg_us, 50.0);
    EXPECT_STREQ(dst[255].name, "PT_255");
    EXPECT_FLOAT_EQ(dst[255].value, 255 * 1.5f);
}

TEST(Ext256DatagramTest, UnixDomainSocketDatagramTransmission) {
    int sv[2];
    ASSERT_EQ(socketpair(AF_UNIX, SOCK_DGRAM, 0, sv), 0);

    ExtDatagramPacket tx_packet{};
    tx_packet.magic = KX_SHM_MAGIC;
    tx_packet.count = KX_N_EXT;
    tx_packet.timestamp_ms = 1700000000000ULL;

    for (size_t i = 0; i < KX_N_EXT; ++i) {
        std::snprintf(tx_packet.points[i].name, sizeof(tx_packet.points[i].name), "MTR_P%03zu", i);
        tx_packet.points[i].value = static_cast<float>(i * 10.5f);
        tx_packet.points[i].quality = KX_Q_GOOD;
        tx_packet.points[i].online = 1;
    }

    const ssize_t tx_bytes = send(sv[0], &tx_packet, sizeof(tx_packet), 0);
    ASSERT_EQ(tx_bytes, static_cast<ssize_t>(sizeof(tx_packet)));

    ExtDatagramPacket rx_packet{};
    const ssize_t rx_bytes = recv(sv[1], &rx_packet, sizeof(rx_packet), 0);
    ASSERT_EQ(rx_bytes, static_cast<ssize_t>(sizeof(rx_packet)));

    EXPECT_EQ(rx_packet.magic, KX_SHM_MAGIC);
    EXPECT_EQ(rx_packet.count, 256u);
    EXPECT_EQ(rx_packet.timestamp_ms, 1700000000000ULL);
    EXPECT_STREQ(rx_packet.points[0].name, "MTR_P000");
    EXPECT_FLOAT_EQ(rx_packet.points[0].value, 0.0f);
    EXPECT_STREQ(rx_packet.points[255].name, "MTR_P255");
    EXPECT_FLOAT_EQ(rx_packet.points[255].value, 255 * 10.5f);

    close(sv[0]);
    close(sv[1]);
}

} // namespace
