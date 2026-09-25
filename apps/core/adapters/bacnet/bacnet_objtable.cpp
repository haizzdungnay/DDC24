/**
 * @file  bacnet_objtable.cpp
 * @brief BAC-004 + MOD-009: core publish kx_plc_shm + ext snapshot read.
 */
#include "bacnet/bacnet_objtable.hpp"

#include <cerrno>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <unistd.h>

#include "iop_protocol.h"

namespace core {

/* Tên segment PLC SHM.
 *
 * Mặc định là contract runtime `KX_SHM_PLC_PATH`. Biến môi trường
 * `MKDDC_SHM_PLC_NAME` cho phép ghi đè để **cô lập test**: `attach()` mở bằng
 * `O_CREAT|O_RDWR` rồi `memset` toàn bộ segment, nên test chạy trên máy đang có
 * service production sẽ xoá sạch SHM đang sống nếu dùng chung tên. Trước đây
 * test chỉ "may mắn" không phá được vì chạy dưới user khác và bị EACCES.
 *
 * Production không đặt biến này; systemd unit không truyền nó xuống service.
 */
static const char* plc_shm_name()
{
    const char* p = std::getenv("MKDDC_SHM_PLC_NAME");
    if (p == nullptr || *p == '\0') p = KX_SHM_PLC_PATH;
    const char* base = std::strrchr(p, '/');
    return base ? base : p;
}

static uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

BacnetObjTable::~BacnetObjTable()
{
    detach();
}

bool BacnetObjTable::attach()
{
    const int fd = shm_open(plc_shm_name(), O_CREAT | O_RDWR, 0664);
    if (fd < 0) {
        std::fprintf(stderr, "ERROR plc_shm.attach_fail shm_open errno=%d\n", errno);
        return false;
    }
    if (ftruncate(fd, sizeof(kx_plc_shm_t)) != 0) {
        std::fprintf(stderr, "ERROR plc_shm.attach_fail ftruncate errno=%d\n", errno);
        ::close(fd);
        return false;
    }
    void* mem = mmap(nullptr, sizeof(kx_plc_shm_t), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    ::close(fd);
    if (mem == MAP_FAILED) {
        std::fprintf(stderr, "ERROR plc_shm.attach_fail mmap errno=%d\n", errno);
        return false;
    }
    shm_ = static_cast<kx_plc_shm_t*>(mem);
    std::memset(shm_, 0, sizeof(kx_plc_shm_t));
    /* magic set CUỐI cùng — reader thấy magic hợp lệ chỉ khi memset xong */
    __atomic_store_n(&shm_->magic, KX_SHM_MAGIC, __ATOMIC_RELEASE);
    std::fprintf(stderr, "INFO  plc_shm.attached path=%s size=%zu\n",
                 plc_shm_name(), sizeof(kx_plc_shm_t));
    return true;
}

void BacnetObjTable::detach()
{
    if (shm_) {
        munmap(shm_, sizeof(kx_plc_shm_t));
        shm_ = nullptr;
    }
}

/* BAC-008: map quality + fault → BACnet Reliability (SW_BACNET_DESIGN §6).
 * ch_mask_bit: reserved for future per-channel diagnostics (unused in IOP v2). */
uint8_t quality_to_reliability(kx_quality_t q, uint16_t fault_flags, int ch_mask_bit)
{
    if (fault_flags & (IOP_FAULT_ADC1 | IOP_FAULT_ADC2)) return 5;   /* COMM_FAILURE */
    /* IOP v2 (ADR-010): FAULT_FLAGS bits 8-15 reserved/always-0.
     * Aggregate IOP_FAULT_UI_OV covers all 16 channels — no per-channel bit lookup. */
    (void)ch_mask_bit;
    if (fault_flags & IOP_FAULT_UI_OV)
        return 1;   /* OVER_RANGE */
    switch (q) {
        case KX_Q_GOOD:      return 0;   /* NO_FAULT_DETECTED */
        case KX_Q_UNCERTAIN: return 5;   /* COMM_FAILURE (stale) */
        case KX_Q_BAD:       return 5;   /* COMM_FAILURE */
        default:             return 0;
    }
}

static void fill_point(kx_point_t* dst, const Point& p,
                        uint16_t fault_flags, int ch_mask_bit)
{
    dst->value   = p.value;
    dst->quality = static_cast<uint8_t>(p.quality);
    dst->reliability = quality_to_reliability(p.quality, fault_flags, ch_mask_bit);
    /* priority[16] + relinquish_default: BACnet server (iobus) bảo trì riêng.
     * core không ghi các field này — để BACnet server tự đọc từ bộ nhớ nội bộ. */
}

void BacnetObjTable::publish(const PointTable& table,
                              uint32_t scan_count, uint32_t scan_overrun,
                              uint16_t fault_flags, uint8_t /*iop_status*/,
                              const uint8_t ui_reliability[KX_N_UI])
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    shm_->ts_ns = now_ns();
    for (int i = 0; i < KX_N_UI; i++) {
        fill_point(&shm_->ai[i], table.get({PointKind::AI, i}), fault_flags, i);
        /* ADR-011: override AI reliability with per-channel value from io_shm.ui_reliability[] */
        shm_->ai[i].reliability = ui_reliability[i];
    }
    for (int i = 0; i < KX_N_DI; i++)
        fill_point(&shm_->bi[i],  table.get({PointKind::BI,  i}), 0, 0);
    for (int i = 0; i < KX_N_AO; i++)
        fill_point(&shm_->ao[i],  table.get({PointKind::AO,  i}), fault_flags, 0);
    for (int i = 0; i < KX_N_DO; i++)
        fill_point(&shm_->bo[i],  table.get({PointKind::BO,  i}), 0, 0);
    for (int i = 0; i < KX_N_AV; i++)
        fill_point(&shm_->av[i],  table.get({PointKind::AV,  i}), 0, 0);
    for (int i = 0; i < KX_N_BV; i++)
        fill_point(&shm_->bv[i],  table.get({PointKind::BV,  i}), 0, 0);
    for (int i = 0; i < KX_N_MSV; i++)
        fill_point(&shm_->msv[i], table.get({PointKind::MSV, i}), 0, 0);
    shm_->plc_running  = 1;
    shm_->scan_count   = scan_count;
    shm_->scan_overrun = scan_overrun;
    shm_->rt_sched_policy = rt_.sched_policy;
    shm_->rt_sched_priority = rt_.sched_priority;
    shm_->rt_mlock_ok = rt_.mlock_ok ? 1u : 0u;
    shm_->rt_degraded = rt_.degraded ? 1u : 0u;
    KX_WRITE_END(shm_);
}

/* MOD-009: nhận ext snapshot từ fieldbus.sock SOCK_DGRAM.
 * Nếu không có datagram → dùng ext[] cũ (core giữ nguyên, stale theo ts_ns).
 * setpoint/dirty GIỮ NGUYÊN trong ext[] (core đã ghi ở bước trước). */
void BacnetObjTable::read_ext(int sockfd)
{
    if (!shm_ || sockfd < 0) return;

    /* `ISS-MBW-03`: VÉT HẾT QUEUE, APPLY BẢN MỚI NHẤT — KHÔNG recv một bản.
     *
     * `iobus` publish ext snapshot mỗi 100 ms; Core scan mỗi 1000 ms. Chỉ `recv`
     * MỘT datagram mỗi scan là consumer chậm hơn producer 10 lần: queue cứ dài
     * ra, feedback lùi hàng chục giây và snapshot generation mới sau hot-apply
     * không bao giờ đuổi kịp phần queue cũ. Vét tối đa 64 datagram và chỉ apply
     * bản hợp lệ MỚI NHẤT. Trần 64 giữ WCET hữu hạn; với payload hiện tại nó
     * lớn hơn nhiều sức chứa socket receive buffer trên target.
     *
     * Đo trên bo Foxlinx, A/B hai binary core:
     *   - chỉ recv một bản : độ cũ mẫu 10 s → 32 s → 50 s rồi bão hoà;
     *   - vét queue        : `drained=10`/scan, độ cũ ổn định ~1 s.
     * Người vận hành bấm nút thì relay đáp dưới 1 giây trong cả hai ca — thứ
     * hỏng là CON SỐ trên màn hình, nên lỗi này đọc ra thành "lệnh không ăn". */
    static constexpr int kMaxDrainPerScan = 64;
    kx_ext_snapshot_v2_t newest{};
    bool have_newest = false;
    uint64_t observed_seq = last_seq_;

    for (int drained = 0; drained < kMaxDrainPerScan; ++drained) {
        kx_ext_snapshot_v2_t candidate{};
        const ssize_t n = ::recv(sockfd, &candidate, sizeof(candidate), MSG_DONTWAIT);
        if (n < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) break;
            std::fprintf(stderr, "WARN  ext_snap.recv_fail errno=%d\n", errno);
            break;
        }
        if (n < static_cast<ssize_t>(offsetof(kx_ext_snapshot_v2_t, samples)))
            continue;

        /* MBR-B005 / Đ-03: từ chối RÕ RÀNG thay vì đọc theo layout đoán được.
         * Kịch bản thật: nâng cấp iobus nhưng core còn bản cũ (hoặc ngược lại).
         * Nếu ở đây "cố đọc tạm", mỗi phần tử lệch 16 byte và core publish giá trị
         * của Point khác với nhãn GOOD — sai lặng lẽ, không ai phát hiện. */
        if (candidate.magic != KX_EXT_SNAP_V2_MAGIC) {
            if (candidate.magic == KX_EXT_SNAP_MAGIC) {
                std::fprintf(stderr,
                             "ERROR ext_snap.version_mismatch producer=v1 consumer=v2"
                             " — iobus và core lệch phiên bản, TỪ CHỐI snapshot."
                             " Hai service phải deploy cùng gói (Đ-03)\n");
            } else {
                std::fprintf(stderr, "WARN  ext_snap.bad_magic got=0x%08x\n",
                             candidate.magic);
            }
            continue;
        }
        if (candidate.schema_version != KX_EXT_SNAP_SCHEMA_VER) {
            std::fprintf(stderr,
                         "ERROR ext_snap.schema_mismatch got=%u want=%u — TỪ CHỐI snapshot\n",
                         candidate.schema_version,
                         static_cast<unsigned>(KX_EXT_SNAP_SCHEMA_VER));
            continue;
        }

        /* Kiểm sequence trên từng datagram ĐÃ NHẬN, không so bản đầu chu kỳ với
         * bản cuối: các bản ở giữa được bỏ apply CÓ CHỦ ĐÍCH, không phải packet
         * loss. So hai đầu sẽ báo "rớt 9 gói" mỗi scan trong khi bus hoàn toàn
         * lành — một cảnh báo sai lặp lại đủ đều để người vận hành thôi đọc nó. */
        if (observed_seq != 0 && candidate.sequence != observed_seq + 1) {
            seq_gaps_++;
            std::fprintf(stderr, "WARN  ext_snap.sequence_gap prev=%llu got=%llu\n",
                         static_cast<unsigned long long>(observed_seq),
                         static_cast<unsigned long long>(candidate.sequence));
        }
        observed_seq = candidate.sequence;
        newest = candidate;
        have_newest = true;
    }

    if (!have_newest) return;
    const kx_ext_snapshot_v2_t& msg = newest;
    last_seq_      = msg.sequence;
    last_revision_ = msg.config_revision;

    /* Generation đổi ⇒ ánh xạ slot cũ VÔ HIỆU. Không được trộn nửa ảnh cũ với
     * nửa ảnh mới: slot 5 của generation N và của generation N+1 có thể là hai
     * Point khác nhau hoàn toàn. */
    const bool generation_changed = (last_generation_ != 0 && msg.generation != last_generation_);
    if (generation_changed) {
        std::fprintf(stderr, "INFO  ext_snap.generation_swap prev=%llu got=%llu revision=%llu\n",
                     static_cast<unsigned long long>(last_generation_),
                     static_cast<unsigned long long>(msg.generation),
                     static_cast<unsigned long long>(msg.config_revision));
    }
    last_generation_ = msg.generation;

    const uint16_t cnt = (msg.count < KX_N_EXT) ? msg.count : static_cast<uint16_t>(KX_N_EXT);
    KX_WRITE_BEGIN(shm_);
    if (generation_changed) {
        /* Slot ngoài dải mới phải trở về "chưa khởi tạo", không giữ giá trị của
         * Point đã bị xoá khỏi cấu hình. */
        for (uint16_t i = cnt; i < KX_N_EXT; i++) {
            shm_->ext[i] = kx_ext_point_t{};
            shm_->ext_cmd_seq[i] = 0;
            shm_->ext[i].quality        = KX_EXTQ_BAD;
            shm_->ext[i].quality_reason = KX_EXTR_NOT_INITIALIZED;
        }
    }
    shm_->ext_count = cnt;
    for (uint16_t i = 0; i < cnt; i++) {
        /* `MBA-FW-02` (audit Modbus 2026-09-25): slot đổi DANH TÍNH ⇒ lệnh ghi
         * đang treo ở slot đó là của Point CŨ. Trước bản này setpoint/dirty được
         * giữ nguyên qua generation swap, nên Point mới thừa hưởng setpoint của
         * Point cũ và chỉ cần iobus khởi động lại (hoặc dedup bị xoá) là giá trị
         * đó được phát xuống register của Point mới — sai thiết bị. Xoá ngay
         * trong cùng vùng ghi với lúc đổi tên, để không consumer nào thấy tên
         * mới đi cùng lệnh cũ. */
        if (std::strncmp(shm_->ext[i].name, msg.samples[i].point_id, sizeof(shm_->ext[i].name)) != 0) {
            shm_->ext[i].setpoint = 0.0;
            shm_->ext[i].dirty    = 0;
            shm_->ext_cmd_seq[i]  = 0;
        }
        shm_->ext[i].value          = msg.samples[i].value;
        shm_->ext[i].quality        = msg.samples[i].quality;
        shm_->ext[i].quality_reason = msg.samples[i].quality_reason;
        shm_->ext[i].exception_code = msg.samples[i].exception_code;
        shm_->ext[i].online         = msg.samples[i].online;
        shm_->ext[i].slave_addr     = msg.samples[i].slave_addr;
        shm_->ext[i].bus_id         = msg.samples[i].bus_id;
        shm_->ext[i].writable       = msg.samples[i].writable;
        shm_->ext[i].sample_utc_ms  = msg.samples[i].sample_utc_ms;
        shm_->ext[i].sample_mono_ns = msg.samples[i].sample_mono_ns;
        std::memcpy(shm_->ext[i].name, msg.samples[i].point_id, 24);
        /* setpoint/dirty GIỮ NGUYÊN — core là writer duy nhất của 2 field này */
    }
    KX_WRITE_END(shm_);
}

} // namespace core
