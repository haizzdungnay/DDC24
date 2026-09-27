/**
 * @file  test_rt_exchange.cpp
 * @brief ADR-061 4.10 bước 2 (X19) — primitive trao đổi giữa luồng quét và luồng
 *        không-RT: hàng đợi SPSC, bộ đệm "bản mới nhất" (triple buffer), và chính
 *        sách dời thread phụ khỏi CPU của vòng quét.
 *
 * Các test đồng thời được viết để chạy cả dưới ThreadSanitizer
 * (`-DMKDDC_SANITIZE=thread`): chúng không chỉ kiểm kết quả mà còn tạo đúng kiểu
 * truy cập chéo luồng mà production có.
 */
#include <gtest/gtest.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <thread>
#include <vector>

#include <pthread.h>
#include <sched.h>

#include "runtime/latest_value_buffer.hpp"
#include "runtime/spsc_ring.hpp"
#include "runtime/thread_policy.hpp"
#include "tests/allocation_probe.hpp"

using namespace core;

/* Đầy thì từ chối, KHÔNG ghi đè: dữ liệu cũ nhất vẫn còn nguyên và ra đúng thứ tự. */
TEST(SpscRing, FullRingRejectsPushWithoutOverwritingAndKeepsFifo)
{
    SpscRing<uint32_t, 8> ring;
    for (uint32_t value = 1; value <= 8; ++value) EXPECT_TRUE(ring.try_push(value)) << value;
    EXPECT_FALSE(ring.try_push(99)) << "ring đầy phải báo false";
    EXPECT_EQ(ring.size_approx(), 8u);
    uint32_t out = 0;
    for (uint32_t expected = 1; expected <= 8; ++expected) {
        ASSERT_TRUE(ring.try_pop(&out));
        EXPECT_EQ(out, expected) << "FIFO bị đảo hoặc phần tử bị ghi đè";
    }
    EXPECT_FALSE(ring.try_pop(&out)) << "ring rỗng phải báo false";
    EXPECT_EQ(out, 8u) << "try_pop thất bại không được đổi *out";
}

/* Chỉ số quấn vòng nhiều lần vẫn giữ thứ tự và sức chứa. */
TEST(SpscRing, WrapsAroundManyTimesWithoutLosingOrder)
{
    SpscRing<uint64_t, 4> ring;
    uint64_t next_push = 0;
    uint64_t next_pop = 0;
    for (int round = 0; round < 1000; ++round) {
        while (ring.try_push(next_push)) ++next_push;
        uint64_t value = 0;
        for (int take = 0; take < 3 && ring.try_pop(&value); ++take) {
            EXPECT_EQ(value, next_pop);
            ++next_pop;
        }
    }
    EXPECT_LE(next_push - next_pop, 4u);
}

/* Một luồng ghi, một luồng đọc, 200 000 phần tử: không mất, không lặp, đúng thứ
 * tự. Luồng ghi gặp đầy thì thử lại — đúng cách phía IPC xử lý (không bỏ). */
TEST(SpscRing, ConcurrentProducerConsumerNeverLosesOrDuplicates)
{
    constexpr uint64_t kItems = 200000;
    SpscRing<uint64_t, 64> ring;
    std::atomic<bool> producer_done{false};
    uint64_t full_retries = 0;
    std::thread producer([&] {
        for (uint64_t value = 0; value < kItems; ++value) {
            while (!ring.try_push(value)) {
                ++full_retries;
                std::this_thread::yield();
            }
        }
        producer_done.store(true, std::memory_order_release);
    });
    uint64_t expected = 0;
    uint64_t value = 0;
    while (expected < kItems) {
        if (ring.try_pop(&value)) {
            ASSERT_EQ(value, expected) << "mất hoặc lặp phần tử";
            ++expected;
        } else {
            std::this_thread::yield();
        }
    }
    producer.join();
    EXPECT_TRUE(producer_done.load());
    EXPECT_FALSE(ring.try_pop(&value));
}

TEST(SpscRing, PushAndPopDoNotAllocate)
{
    SpscRing<uint8_t, 64> ring;
    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        uint8_t value = 0;
        for (int i = 0; i < 1000; ++i) {
            (void)ring.try_push(static_cast<uint8_t>(i));
            (void)ring.try_pop(&value);
        }
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u);
}

namespace {

/* Mọi trường mang CÙNG một số thứ tự: đọc ra hai giá trị khác nhau trong một
 * bản nghĩa là bản bị rách (một phần của lần ghi này, một phần của lần khác). */
struct Stamped {
    uint64_t sequence = 0;
    std::array<uint64_t, 512> body{};
};

} // namespace

TEST(LatestValueBuffer, ReaderSeesNothingBeforeFirstPublishThenOnlyTheNewest)
{
    LatestValueBuffer<Stamped> buffer;
    EXPECT_FALSE(buffer.acquire_latest());
    EXPECT_FALSE(buffer.has_value());
    for (uint64_t sequence = 1; sequence <= 3; ++sequence) {
        Stamped& slot = buffer.write_slot();
        slot.sequence = sequence;
        slot.body.fill(sequence);
        buffer.publish();
    }
    ASSERT_TRUE(buffer.acquire_latest());
    EXPECT_TRUE(buffer.has_value());
    EXPECT_EQ(buffer.read_slot().sequence, 3u) << "reader phải nhận bản MỚI NHẤT, không phải bản đầu";
    EXPECT_FALSE(buffer.acquire_latest()) << "không có bản mới thì báo false";
    EXPECT_EQ(buffer.read_slot().sequence, 3u) << "vùng đọc giữ nguyên bản đã lấy";
    EXPECT_EQ(buffer.published_count(), 3u);
}

/* Luồng ghi công bố liên tục, luồng đọc lấy liên tục: mọi bản đọc ra phải trọn
 * vẹn (không rách) và số thứ tự không bao giờ lùi. */
TEST(LatestValueBuffer, ConcurrentPublishNeverTearsAndNeverGoesBackwards)
{
    constexpr uint64_t kPublishes = 50000;
    LatestValueBuffer<Stamped> buffer;
    std::atomic<bool> done{false};
    std::thread writer([&] {
        for (uint64_t sequence = 1; sequence <= kPublishes; ++sequence) {
            Stamped& slot = buffer.write_slot();
            slot.sequence = sequence;
            slot.body.fill(sequence);
            buffer.publish();
        }
        done.store(true, std::memory_order_release);
    });
    uint64_t last = 0;
    uint64_t reads = 0;
    auto check = [&] {
        const Stamped& snapshot = buffer.read_slot();
        for (const uint64_t word : snapshot.body)
            ASSERT_EQ(word, snapshot.sequence) << "bản đọc ra bị rách";
        ASSERT_GE(snapshot.sequence, last) << "bản đọc ra lùi về bản cũ hơn";
        last = snapshot.sequence;
        ++reads;
    };
    while (!done.load(std::memory_order_acquire)) {
        if (buffer.acquire_latest()) check();
    }
    writer.join();
    if (buffer.acquire_latest()) check();
    EXPECT_EQ(last, kPublishes) << "bản cuối cùng phải tới được reader";
    EXPECT_GT(reads, 0u);
}

TEST(LatestValueBuffer, PublishDoesNotAllocate)
{
    LatestValueBuffer<Stamped> buffer;
    Stamped value;
    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (uint64_t sequence = 0; sequence < 1000; ++sequence) {
            value.sequence = sequence;
            buffer.publish(value);
        }
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u);
}

namespace {

bool first_allowed_cpu(int* cpu)
{
    cpu_set_t set;
    CPU_ZERO(&set);
    if (::sched_getaffinity(0, sizeof(set), &set) != 0) return false;
    if (CPU_COUNT(&set) < 2) return false;
    for (int candidate = 0; candidate < CPU_SETSIZE; ++candidate) {
        if (CPU_ISSET(candidate, &set)) {
            *cpu = candidate;
            return true;
        }
    }
    return false;
}

bool thread_allowed_on(int cpu)
{
    cpu_set_t set;
    CPU_ZERO(&set);
    if (::pthread_getaffinity_np(::pthread_self(), sizeof(set), &set) != 0) return true;
    return CPU_ISSET(cpu, &set);
}

} // namespace

/* Thread phụ tự rời CPU của vòng quét và log INFO xác nhận. */
TEST(ThreadPolicy, MoveOffCpusLeavesTheScanCpu)
{
    int scan_cpu = -1;
    if (!first_allowed_cpu(&scan_cpu)) GTEST_SKIP() << "máy chỉ cho chạy trên 1 CPU";
    bool moved = false;
    bool still_on_scan_cpu = true;
    testing::internal::CaptureStderr();
    std::thread worker([&] {
        cpu_set_t scan;
        CPU_ZERO(&scan);
        CPU_SET(scan_cpu, &scan);
        moved = move_off_cpus(scan, "x19-test");
        still_on_scan_cpu = thread_allowed_on(scan_cpu);
    });
    worker.join();
    const std::string log = testing::internal::GetCapturedStderr();
    EXPECT_TRUE(moved) << log;
    EXPECT_FALSE(still_on_scan_cpu);
    EXPECT_NE(log.find("INFO  rt.thread_off_scan_cpu name=x19-test"), std::string::npos) << log;
}

/* Không còn CPU nào khác để đi thì phải NÓI RA (WARN), không im lặng coi là xong. */
TEST(ThreadPolicy, NoOtherCpuIsReportedAsWarning)
{
    cpu_set_t every;
    CPU_ZERO(&every);
    for (int cpu = 0; cpu < CPU_SETSIZE; ++cpu) CPU_SET(cpu, &every);
    bool moved = true;
    testing::internal::CaptureStderr();
    std::thread worker([&] { moved = move_off_cpus(every, "x19-test"); });
    worker.join();
    const std::string log = testing::internal::GetCapturedStderr();
    EXPECT_FALSE(moved);
    EXPECT_NE(log.find("WARN  rt.thread_on_scan_cpu name=x19-test"), std::string::npos) << log;
    EXPECT_NE(log.find("reason=no_other_cpu"), std::string::npos) << log;
}

/* Mô phỏng unit `CPUAffinity=3`: luồng "quét" bị ghim vào MỘT CPU, thread phụ
 * nó tạo thừa hưởng affinity đó. `demote_to_normal_sched` (đường suy từ affinity
 * thừa hưởng, không có `remember_scan_cpus`) phải đưa thread phụ ra CPU khác. */
TEST(ThreadPolicy, DemotedHelperLeavesTheInheritedScanCpu)
{
    int scan_cpu = -1;
    if (!first_allowed_cpu(&scan_cpu)) GTEST_SKIP() << "máy chỉ cho chạy trên 1 CPU";
    bool demoted = false;
    bool helper_on_scan_cpu = true;
    testing::internal::CaptureStderr();
    std::thread scan_like([&] {
        cpu_set_t pinned;
        CPU_ZERO(&pinned);
        CPU_SET(scan_cpu, &pinned);
        ASSERT_EQ(::pthread_setaffinity_np(::pthread_self(), sizeof(pinned), &pinned), 0);
        std::thread helper([&] {
            demoted = demote_to_normal_sched("x19-helper");
            helper_on_scan_cpu = thread_allowed_on(scan_cpu);
        });
        helper.join();
    });
    scan_like.join();
    const std::string log = testing::internal::GetCapturedStderr();
    EXPECT_TRUE(demoted) << log;
    EXPECT_FALSE(helper_on_scan_cpu) << log;
}
