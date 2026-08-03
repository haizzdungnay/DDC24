#ifndef CORE_RUNTIME_POINT_SNAPSHOT_HPP
#define CORE_RUNTIME_POINT_SNAPSHOT_HPP

#include <array>
#include <cstdint>
#include <string>

#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"

namespace core {

constexpr std::size_t KX_HIST_PHYSICAL_COUNT = KX_N_UI + KX_N_AO + KX_N_DO;
constexpr std::size_t KX_POINT_SNAPSHOT_MAX_PAYLOAD = 64u * 1024u;

enum class SnapshotPointKind : uint8_t { UI, AO, DO };
enum class SnapshotSource : uint8_t { IO, SAFETY, MANUAL, BACNET, SCHEDULE, LOGIC, DEFAULT };
enum class SnapshotRole : uint8_t { ENGINEERING_VALUE, RESOLVED_SETPOINT, HARDWARE_FEEDBACK };

struct RuntimePointSnapshotRow {
    std::array<char, 6> id{};
    SnapshotPointKind kind = SnapshotPointKind::UI;
    float value = 0.0f;
    kx_quality_t quality = KX_Q_BAD;
    SnapshotSource source = SnapshotSource::DEFAULT;
    SnapshotRole role = SnapshotRole::ENGINEERING_VALUE;
    std::array<char, 9> unit{};
    uint64_t updated_at_monotonic_ns = 0;
    uint32_t generation = 1;
};

struct RuntimePointSnapshot {
    uint64_t snapshot_id = 0;
    uint64_t observed_utc_ms = 0;
    uint64_t captured_monotonic_ns = 0;
    std::array<RuntimePointSnapshotRow, KX_HIST_PHYSICAL_COUNT> rows{};
};

std::string serialize_runtime_point_snapshot(const RuntimePointSnapshot& snapshot);
bool serialize_runtime_point_snapshot(const RuntimePointSnapshot& snapshot, char* output,
                                      std::size_t capacity, std::size_t* length) noexcept;

class RuntimePointSnapshotPublisher {
public:
    RuntimePointSnapshot build(uint64_t snapshot_id, uint64_t observed_utc_ms,
                               uint64_t captured_monotonic_ns, const PointTable& table,
                               const IoSnapshot& io, const OutputCmd& resolved,
                               const PriorityResolver& resolver, bool safe_state_active);

private:
    std::array<float, KX_N_AO> previous_ao_value_{};
    std::array<SnapshotSource, KX_N_AO> previous_ao_source_{};
    std::array<kx_quality_t, KX_N_AO> previous_ao_quality_{};
    std::array<bool, KX_N_AO> previous_ao_current_mode_{};
    std::array<uint64_t, KX_N_AO> ao_updated_at_{};
    std::array<bool, KX_N_AO> ao_seen_{};
};

} // namespace core

#endif /* CORE_RUNTIME_POINT_SNAPSHOT_HPP */
