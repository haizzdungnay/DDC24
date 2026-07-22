/**
 * @file  iobus_reader.hpp
 * @brief Seqlock reader kx_io_shm → IoSnapshot nhất quán (07 §7.1).
 *        Core KHÔNG tạo shm (iobus là creator) — attach không O_CREAT, retry magic.
 */
#ifndef CORE_IOBUS_READER_HPP
#define CORE_IOBUS_READER_HPP

#include <cstdint>

#include "mkddc_shm.h"

namespace core {

/* Snapshot phía core — copy các field cần từ kx_io_shm (đÃ scale, eng value) */
struct IoSnapshot {
    uint64_t ts_ns = 0;
    float    ui_value[KX_N_UI] = {};
    uint8_t  ui_quality[KX_N_UI] = {KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD};
    uint8_t  ui_reliability[KX_N_UI] = {KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE};
    char     ui_unit[KX_N_UI][8] = {};
    uint8_t  di_state[KX_N_DI] = {};
    uint32_t di_counter[KX_N_DI] = {};
    uint8_t  do_feedback[KX_N_DO] = {};
    float    ao_setpoint[KX_N_AO] = {};
    uint8_t  ao_mode[KX_N_AO] = {};
    uint16_t fault_flags = 0;
    uint8_t  iop_status = KX_IOP_FAULT;
    int16_t  mcu_temp_x10 = 0;
    bool     valid = false;   /* false = chưa attach được / seqlock fail */
};

class IobusReader {
public:
    ~IobusReader();

    /* Attach KX_SHM_IO_PATH (O_RDWR — core ghi 2 field nó sở hữu, KHÔNG O_CREAT).
     * Trả false nếu shm chưa tồn tại / magic sai → caller retry 1s. */
    bool attach();
    void detach();
    bool attached() const { return shm_ != nullptr; }

    /* Seqlock read tối đa 5 lần thử; fail → false (dùng snapshot cũ + metric). */
    bool read(IoSnapshot* out) const;

    /* Đọc trực tiếp từ struct (cho unit test, không cần shm thật). */
    static bool read_from(const kx_io_shm_t* shm, IoSnapshot* out);

    /* Test hook: dùng buffer ngoài thay vì mmap (KHÔNG munmap khi detach). */
    void attach_external(kx_io_shm_t* s) { shm_ = s; external_ = true; }

    /* Mapping RW dùng chung cho output_writer (2 field core sở hữu). */
    kx_io_shm_t* shm() { return shm_; }

private:
    kx_io_shm_t* shm_ = nullptr;
    bool external_ = false;
};

} // namespace core

#endif /* CORE_IOBUS_READER_HPP */
