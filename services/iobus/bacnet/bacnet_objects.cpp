/**
 * @file  bacnet_objects.cpp
 * @brief BAC-003 + BAC-005 implementation.
 */
#include "bacnet_objects.hpp"
#include "mkddc_shm.h"

#include <cstdio>
#include <cstring>
#include <cmath>

namespace iobus::bacnet {

const std::string BacnetObjects::kEmpty;

BacnetObjects::BacnetObjects()
{
    /* Default object names per PICS §4.3 */
    for (int i = 0; i < N_AI;  i++) ai_names_[i]  = "AI"  + std::to_string(i+1);
    for (int i = 0; i < N_BI;  i++) bi_names_[i]  = "BI"  + std::to_string(i+1);
    for (int i = 0; i < N_AO;  i++) ao_names_[i]  = "AO"  + std::to_string(i+1);
    for (int i = 0; i < N_BO;  i++) bo_names_[i]  = "BO"  + std::to_string(i+1);
    for (int i = 0; i < N_AV;  i++) av_names_[i]  = "AV"  + std::to_string(i+1);
    for (int i = 0; i < N_BV;  i++) bv_names_[i]  = "BV"  + std::to_string(i+1);
    for (int i = 0; i < N_MSV; i++) msv_names_[i] = "MSV" + std::to_string(i+1);

    for (int i = 0; i < N_AI; i++) ai_units_[i] = "no-units";
    for (int i = 0; i < N_AO; i++) ao_unit_str_[i] = "volt";
}

void BacnetObjects::update_ai_units(const char units[KX_N_UI][8])
{
    for (int i = 0; i < N_AI; i++)
        ai_units_[i] = units[i];
}

/* ADR-012: units_str → BACnet Engineering_Units enum integer (ASHRAE 135-2020 Appendix B). */
static uint16_t units_str_to_bacnet(const std::string& s)
{
    if (s == "percent")     return 98;
    if (s == "volt")        return 5;
    if (s == "milliampere") return 2;
    if (s == "degC")        return 62;
    if (s == "Pa")          return 53;
    if (s == "RPM")         return 104;
    if (s == "ppm")         return 96;
    return 95;  /* no_units */
}

void BacnetObjects::update_ao_config(const AoChannelConfig ao_channels[KX_N_AO])
{
    for (int i = 0; i < N_AO; i++) {
        ao_names_[i]        = ao_channels[i].name.empty()
                              ? "AO" + std::to_string(i + 1)
                              : ao_channels[i].name;
        ao_unit_str_[i]     = ao_channels[i].units_str;
        ao_bacnet_units_[i] = units_str_to_bacnet(ao_channels[i].units_str);
        ao_min_pv_[i]       = ao_channels[i].min_pv;
        ao_max_pv_[i]       = ao_channels[i].max_pv;
    }
}

const std::string& BacnetObjects::ao_unit_str(uint32_t instance) const
{
    if (instance < 1 || instance > N_AO) return kEmpty;
    return ao_unit_str_[instance - 1];
}

uint16_t BacnetObjects::ao_bacnet_units(uint32_t instance) const
{
    if (instance < 1 || instance > N_AO) return 95;
    return ao_bacnet_units_[instance - 1];
}

float BacnetObjects::ao_min_pv(uint32_t instance) const
{
    if (instance < 1 || instance > N_AO) return 0.0f;
    return ao_min_pv_[instance - 1];
}

float BacnetObjects::ao_max_pv(uint32_t instance) const
{
    if (instance < 1 || instance > N_AO) return 10.0f;
    return ao_max_pv_[instance - 1];
}

void BacnetObjects::init(const BacnetConfig& cfg)
{
    cfg_ = cfg;
}

/* -------- seqlock safe read helper -------- */
static uint32_t shm_read_seq(const volatile uint32_t* sp)
{
    uint32_t v;
    __atomic_load(sp, &v, __ATOMIC_ACQUIRE);
    return v;
}

/* -------- AI -------- */
bool BacnetObjects::read_ai(uint32_t instance, float* value, uint8_t* status_flags,
                              uint8_t* reliability, const kx_plc_shm_t* shm) const
{
    if (instance < 1 || instance > N_AI || !shm) return false;
    const int idx = static_cast<int>(instance) - 1;

    uint32_t seq1, seq2;
    float   v;
    uint8_t kx_rel;
    do {
        seq1   = shm_read_seq(&shm->seq);
        if (seq1 & 1u) continue;
        v      = shm->ai[idx].value;
        kx_rel = shm->ai[idx].reliability;
        seq2   = shm_read_seq(&shm->seq);
    } while (seq1 != seq2 || (seq1 & 1u));

    *value = v;
    /* ADR-011: use per-channel reliability from plc_shm (set by core from io_shm.ui_reliability[]).
     * No longer re-compute from quality with fault_flags=0 (that path lost the fault cause). */
    const BacnetReliability rel = kx_reliability_to_bacnet(
        static_cast<kx_reliability_t>(kx_rel));
    *reliability = static_cast<uint8_t>(rel);
    const bool oos = ai_oos_[idx];
    const BacnetStatusFlags sf = compute_status_flags(rel, false, false, oos);
    *status_flags = sf.to_bits();
    return true;
}

/* -------- BI -------- */
bool BacnetObjects::read_bi(uint32_t instance, float* value, uint8_t* status_flags,
                              uint8_t* reliability, const kx_plc_shm_t* shm) const
{
    if (instance < 1 || instance > N_BI || !shm) return false;
    const int idx = static_cast<int>(instance) - 1;

    uint32_t seq1, seq2;
    float    v;
    uint8_t  q;
    do {
        seq1 = shm_read_seq(&shm->seq);
        if (seq1 & 1u) continue;
        v = shm->bi[idx].value;
        q = shm->bi[idx].quality;
        seq2 = shm_read_seq(&shm->seq);
    } while (seq1 != seq2 || (seq1 & 1u));

    *value = v;
    const kx_quality_t kq = static_cast<kx_quality_t>(q);
    const BacnetReliability rel = compute_reliability(kq, 0, -1);
    *reliability = static_cast<uint8_t>(rel);
    const bool oos = bi_oos_[idx];
    const BacnetStatusFlags sf = compute_status_flags(rel, false, false, oos);
    *status_flags = sf.to_bits();
    return true;
}

/* -------- AO -------- */
bool BacnetObjects::read_ao(uint32_t instance, float* value, uint8_t* status_flags,
                              uint8_t* reliability, const kx_plc_shm_t* shm) const
{
    if (instance < 1 || instance > N_AO || !shm) return false;
    const int idx = static_cast<int>(instance) - 1;

    uint32_t seq1, seq2;
    float    v;
    uint8_t  q;
    do {
        seq1 = shm_read_seq(&shm->seq);
        if (seq1 & 1u) continue;
        v = shm->ao[idx].value;
        q = shm->ao[idx].quality;
        seq2 = shm_read_seq(&shm->seq);
    } while (seq1 != seq2 || (seq1 & 1u));

    /* Present_Value for commandable: use applied_value (from Priority winner or core override) */
    *value = priority_.applied_value(CmdObjectType::AO, instance);
    (void)v;  /* shm.ao[idx].value is what core applied; read both */
    const kx_quality_t kq = static_cast<kx_quality_t>(q);
    const BacnetReliability rel = compute_reliability(kq, 0, -1);
    *reliability = static_cast<uint8_t>(rel);
    const BacnetStatusFlags sf = compute_status_flags(rel, false, false, false);
    *status_flags = sf.to_bits();
    return true;
}

/* -------- BO -------- */
bool BacnetObjects::read_bo(uint32_t instance, float* value, uint8_t* status_flags,
                              uint8_t* reliability, const kx_plc_shm_t* shm) const
{
    if (instance < 1 || instance > N_BO || !shm) return false;
    const int idx = static_cast<int>(instance) - 1;

    uint32_t seq1, seq2;
    float    v;
    uint8_t  q;
    do {
        seq1 = shm_read_seq(&shm->seq);
        if (seq1 & 1u) continue;
        v = shm->bo[idx].value;
        q = shm->bo[idx].quality;
        seq2 = shm_read_seq(&shm->seq);
    } while (seq1 != seq2 || (seq1 & 1u));

    *value = priority_.applied_value(CmdObjectType::BO, instance);
    (void)v;
    const kx_quality_t kq = static_cast<kx_quality_t>(q);
    const BacnetReliability rel = compute_reliability(kq, 0, -1);
    *reliability = static_cast<uint8_t>(rel);
    const BacnetStatusFlags sf = compute_status_flags(rel, false, false, false);
    *status_flags = sf.to_bits();
    return true;
}

/* -------- AV -------- */
bool BacnetObjects::read_av(uint32_t instance, float* value, uint8_t* status_flags,
                              const kx_plc_shm_t* shm) const
{
    if (instance < 1 || instance > N_AV || !shm) return false;
    const int idx = static_cast<int>(instance) - 1;

    uint32_t seq1, seq2;
    float    v;
    uint8_t  q;
    do {
        seq1 = shm_read_seq(&shm->seq);
        if (seq1 & 1u) continue;
        v = shm->av[idx].value;
        q = shm->av[idx].quality;
        seq2 = shm_read_seq(&shm->seq);
    } while (seq1 != seq2 || (seq1 & 1u));

    *value = v;
    const kx_quality_t kq = static_cast<kx_quality_t>(q);
    const BacnetReliability rel = compute_reliability(kq, 0, -1);
    const BacnetStatusFlags sf = compute_status_flags(rel, false, false, false);
    *status_flags = sf.to_bits();
    return true;
}

/* -------- BV -------- */
bool BacnetObjects::read_bv(uint32_t instance, float* value, uint8_t* status_flags,
                              const kx_plc_shm_t* shm) const
{
    if (instance < 1 || instance > N_BV || !shm) return false;
    const int idx = static_cast<int>(instance) - 1;

    uint32_t seq1, seq2;
    float    v;
    uint8_t  q;
    do {
        seq1 = shm_read_seq(&shm->seq);
        if (seq1 & 1u) continue;
        v = shm->bv[idx].value;
        q = shm->bv[idx].quality;
        seq2 = shm_read_seq(&shm->seq);
    } while (seq1 != seq2 || (seq1 & 1u));

    *value = v;
    const kx_quality_t kq = static_cast<kx_quality_t>(q);
    const BacnetReliability rel = compute_reliability(kq, 0, -1);
    const BacnetStatusFlags sf = compute_status_flags(rel, false, false, false);
    *status_flags = sf.to_bits();
    return true;
}

/* -------- MSV -------- */
bool BacnetObjects::read_msv(uint32_t instance, float* value, uint8_t* status_flags,
                               const kx_plc_shm_t* shm) const
{
    if (instance < 1 || instance > N_MSV || !shm) return false;
    const int idx = static_cast<int>(instance) - 1;

    uint32_t seq1, seq2;
    float    v;
    uint8_t  q;
    do {
        seq1 = shm_read_seq(&shm->seq);
        if (seq1 & 1u) continue;
        v = shm->msv[idx].value;
        q = shm->msv[idx].quality;
        seq2 = shm_read_seq(&shm->seq);
    } while (seq1 != seq2 || (seq1 & 1u));

    *value = v;
    const kx_quality_t kq = static_cast<kx_quality_t>(q);
    const BacnetReliability rel = compute_reliability(kq, 0, -1);
    const BacnetStatusFlags sf = compute_status_flags(rel, false, false, false);
    *status_flags = sf.to_bits();
    return true;
}

/* -------- Write (commandable via Priority_Array) -------- */
bool BacnetObjects::write_ao(uint32_t instance, uint8_t prio, float value,
                              const std::string& user, const CoreWriteFn& fn)
{
    if (instance < 1 || instance > N_AO) return false;
    const bool changed = priority_.write(CmdObjectType::AO, instance, prio, value);
    if (!changed) return true;
    const PriorityArray* arr = priority_.get_array(CmdObjectType::AO, instance);
    if (!arr) return false;
    const float winner = arr->winner();
    const bool accepted = fn(arr->is_empty() ? "release_ao" : "ao_setpoint",
                             instance - 1, winner, user, 3);
    if (!accepted)
        priority_.on_overridden(CmdObjectType::AO, instance, winner);
    return accepted;
}

bool BacnetObjects::write_bo(uint32_t instance, uint8_t prio, float value,
                              const std::string& user, const CoreWriteFn& fn)
{
    if (instance < 1 || instance > N_BO) return false;
    const bool changed = priority_.write(CmdObjectType::BO, instance, prio, value);
    if (!changed) return true;
    const PriorityArray* arr = priority_.get_array(CmdObjectType::BO, instance);
    if (!arr) return false;
    const float winner = arr->winner();
    const bool accepted = fn(arr->is_empty() ? "release_bo" : "do_cmd",
                             instance - 1, winner, user, 3);
    if (!accepted)
        priority_.on_overridden(CmdObjectType::BO, instance, winner);
    return accepted;
}

bool BacnetObjects::write_av(uint32_t instance, float value,
                              const std::string& user, const CoreWriteFn& fn)
{
    if (instance < 1 || instance > N_AV) return false;
    const bool accepted = fn("av_setpoint", instance - 1, value, user, 3);
    if (!accepted)
        priority_.on_overridden(CmdObjectType::AV, instance, value);
    else
        priority_.write(CmdObjectType::AV, instance, 16, value);
    return accepted;
}

bool BacnetObjects::write_bv(uint32_t instance, float value,
                              const std::string& user, const CoreWriteFn& fn)
{
    if (instance < 1 || instance > N_BV) return false;
    const bool accepted = fn("bv_setpoint", instance - 1, value, user, 3);
    if (!accepted)
        priority_.on_overridden(CmdObjectType::BV, instance, value);
    else
        priority_.write(CmdObjectType::BV, instance, 16, value);
    return accepted;
}

bool BacnetObjects::write_msv(uint32_t instance, float value,
                               const std::string& user, const CoreWriteFn& fn)
{
    if (instance < 1 || instance > N_MSV) return false;
    const bool accepted = fn("msv_setpoint", instance - 1, value, user, 3);
    if (!accepted)
        priority_.on_overridden(CmdObjectType::MSV, instance, value);
    else
        priority_.write(CmdObjectType::MSV, instance, 16, value);
    return accepted;
}

bool BacnetObjects::relinquish_ao(uint32_t instance, uint8_t prio,
                                   const std::string& user, const CoreWriteFn& fn)
{
    if (instance < 1 || instance > N_AO) return false;
    const bool changed = priority_.relinquish(CmdObjectType::AO, instance, prio);
    if (!changed) return true;
    const PriorityArray* arr = priority_.get_array(CmdObjectType::AO, instance);
    if (!arr) return false;
    const float winner = arr->winner();
    const bool accepted = fn(arr->is_empty() ? "release_ao" : "ao_setpoint",
                             instance - 1, winner, user, 3);
    if (!accepted) priority_.on_overridden(CmdObjectType::AO, instance, winner);
    return accepted;
}

bool BacnetObjects::relinquish_bo(uint32_t instance, uint8_t prio,
                                   const std::string& user, const CoreWriteFn& fn)
{
    if (instance < 1 || instance > N_BO) return false;
    const bool changed = priority_.relinquish(CmdObjectType::BO, instance, prio);
    if (!changed) return true;
    const PriorityArray* arr = priority_.get_array(CmdObjectType::BO, instance);
    if (!arr) return false;
    const float winner = arr->winner();
    const bool accepted = fn(arr->is_empty() ? "release_bo" : "do_cmd",
                             instance - 1, winner, user, 3);
    if (!accepted) priority_.on_overridden(CmdObjectType::BO, instance, winner);
    return accepted;
}

/* -------- Out_Of_Service -------- */
void BacnetObjects::set_oos_ai(uint32_t instance, bool oos)
{
    if (instance >= 1 && instance <= N_AI) ai_oos_[instance-1] = oos;
}
void BacnetObjects::set_oos_bi(uint32_t instance, bool oos)
{
    if (instance >= 1 && instance <= N_BI) bi_oos_[instance-1] = oos;
}
bool BacnetObjects::oos_ai(uint32_t instance) const
{
    return (instance >= 1 && instance <= N_AI) ? ai_oos_[instance-1] : false;
}
bool BacnetObjects::oos_bi(uint32_t instance) const
{
    return (instance >= 1 && instance <= N_BI) ? bi_oos_[instance-1] : false;
}

/* -------- Names / units -------- */
const std::string& BacnetObjects::ai_name(uint32_t i)  const { return (i>=1&&i<=N_AI)  ? ai_names_[i-1]  : kEmpty; }
const std::string& BacnetObjects::bi_name(uint32_t i)  const { return (i>=1&&i<=N_BI)  ? bi_names_[i-1]  : kEmpty; }
const std::string& BacnetObjects::ao_name(uint32_t i)  const { return (i>=1&&i<=N_AO)  ? ao_names_[i-1]  : kEmpty; }
const std::string& BacnetObjects::bo_name(uint32_t i)  const { return (i>=1&&i<=N_BO)  ? bo_names_[i-1]  : kEmpty; }
const std::string& BacnetObjects::av_name(uint32_t i)  const { return (i>=1&&i<=N_AV)  ? av_names_[i-1]  : kEmpty; }
const std::string& BacnetObjects::bv_name(uint32_t i)  const { return (i>=1&&i<=N_BV)  ? bv_names_[i-1]  : kEmpty; }
const std::string& BacnetObjects::msv_name(uint32_t i) const { return (i>=1&&i<=N_MSV) ? msv_names_[i-1] : kEmpty; }
const std::string& BacnetObjects::ai_unit(uint32_t i)  const { return (i>=1&&i<=N_AI)  ? ai_units_[i-1]  : kEmpty; }

/* -------- COV_Increment -------- */
void BacnetObjects::set_cov_increment_ai(uint32_t instance, float v)
{
    cov_.set_cov_increment(BacnetObjectType::ANALOG_INPUT, instance, v);
}
void BacnetObjects::set_cov_increment_ao(uint32_t instance, float v)
{
    cov_.set_cov_increment(BacnetObjectType::ANALOG_OUTPUT, instance, v);
}
void BacnetObjects::set_cov_increment_av(uint32_t instance, float v)
{
    cov_.set_cov_increment(BacnetObjectType::ANALOG_VALUE, instance, v);
}

} // namespace iobus::bacnet
