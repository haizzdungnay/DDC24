/**
 * @file  test_output_writer.cpp
 * @brief Output staging/commit boundary (07 §7.2): OutputWriter là writer DUY NHẤT
 *        của ao_setpoint[]/do_cmd[] — chỉ ghi kênh *_valid, giữ nguyên kênh không hợp
 *        lệ, và no-op an toàn khi chưa attach / magic sai (I/O image ownership boundary).
 */
#include <gtest/gtest.h>

#include <cstring>

#include "ipc/iobus_reader.hpp"
#include "ipc/output_writer.hpp"

using namespace core;

namespace {

kx_io_shm_t make_shm()
{
    kx_io_shm_t s;
    std::memset(&s, 0, sizeof(s));
    s.magic = KX_SHM_MAGIC;
    return s;
}

OutputCmd make_cmd()
{
    OutputCmd out;
    for (int ch = 0; ch < KX_N_AO; ch++) { out.ao[ch] = 0.0f; out.ao_valid[ch] = false; }
    for (int ch = 0; ch < KX_N_DO; ch++) { out.dout[ch] = 0; out.do_valid[ch] = false; }
    return out;
}

} // namespace

TEST(OutputWriter, NoOpWhenNotAttached)
{
    IobusReader reader;   /* attach() chưa gọi -> shm() == nullptr */
    OutputWriter writer(reader);
    OutputCmd out = make_cmd();
    out.ao_valid[0] = true;
    out.ao[0] = 5.0f;
    writer.write(out);   /* không crash, không có shm để ghi */
    SUCCEED();
}

TEST(OutputWriter, NoOpWhenMagicInvalid)
{
    kx_io_shm_t shm = make_shm();
    shm.magic = 0xDEADBEEF;
    shm.ao_setpoint[0] = 1.25f;
    IobusReader reader;
    reader.attach_external(&shm);
    OutputWriter writer(reader);

    OutputCmd out = make_cmd();
    out.ao_valid[0] = true;
    out.ao[0] = 9.0f;
    writer.write(out);

    EXPECT_FLOAT_EQ(shm.ao_setpoint[0], 1.25f) << "magic sai -> writer không được đụng shm";
}

TEST(OutputWriter, WritesOnlyValidAoChannels)
{
    kx_io_shm_t shm = make_shm();
    for (int ch = 0; ch < KX_N_AO; ch++) shm.ao_setpoint[ch] = -1.0f;   /* sentinel */
    IobusReader reader;
    reader.attach_external(&shm);
    OutputWriter writer(reader);

    OutputCmd out = make_cmd();
    out.ao_valid[1] = true;
    out.ao[1] = 6.5f;
    writer.write(out);

    EXPECT_FLOAT_EQ(shm.ao_setpoint[1], 6.5f) << "kênh valid phải được ghi";
    for (int ch = 0; ch < KX_N_AO; ch++) {
        if (ch == 1) continue;
        EXPECT_FLOAT_EQ(shm.ao_setpoint[ch], -1.0f) << "kênh không valid phải giữ nguyên, ch=" << ch;
    }
}

TEST(OutputWriter, WritesOnlyValidDoChannels)
{
    kx_io_shm_t shm = make_shm();
    for (int ch = 0; ch < KX_N_DO; ch++) shm.do_cmd[ch] = 9;   /* sentinel khác 0/1 */
    IobusReader reader;
    reader.attach_external(&shm);
    OutputWriter writer(reader);

    OutputCmd out = make_cmd();
    out.do_valid[0] = true;
    out.dout[0] = 1;
    writer.write(out);

    EXPECT_EQ(shm.do_cmd[0], 1u) << "kênh valid phải được ghi";
    for (int ch = 1; ch < KX_N_DO; ch++)
        EXPECT_EQ(shm.do_cmd[ch], 9u) << "kênh không valid phải giữ nguyên, ch=" << ch;
}

TEST(OutputWriter, OverwritesWhenValueDiffers)
{
    kx_io_shm_t shm = make_shm();
    shm.ao_setpoint[2] = 1.0f;
    IobusReader reader;
    reader.attach_external(&shm);
    OutputWriter writer(reader);

    OutputCmd out = make_cmd();
    out.ao_valid[2] = true;
    out.ao[2] = 8.0f;
    writer.write(out);

    EXPECT_FLOAT_EQ(shm.ao_setpoint[2], 8.0f);
}

TEST(OutputWriter, LeavesValueUnchangedWhenAlreadyEqual)
{
    /* Chỉ ghi khi giá trị đổi (comment output_writer.hpp) — verify idempotent,
     * không có side effect quan sát được khi gọi lại với cùng giá trị. */
    kx_io_shm_t shm = make_shm();
    shm.ao_setpoint[3] = 4.0f;
    IobusReader reader;
    reader.attach_external(&shm);
    OutputWriter writer(reader);

    OutputCmd out = make_cmd();
    out.ao_valid[3] = true;
    out.ao[3] = 4.0f;
    writer.write(out);
    writer.write(out);

    EXPECT_FLOAT_EQ(shm.ao_setpoint[3], 4.0f);
}

TEST(OutputWriter, DoCmdCoercesNonzeroToOne)
{
    kx_io_shm_t shm = make_shm();
    IobusReader reader;
    reader.attach_external(&shm);
    OutputWriter writer(reader);

    OutputCmd out = make_cmd();
    out.do_valid[1] = true;
    out.dout[1] = 5;   /* bất kỳ giá trị khác 0 -> phải coi là "on" (1), không copy raw */
    writer.write(out);

    EXPECT_EQ(shm.do_cmd[1], 1u);
}

TEST(OutputWriter, WritesAllAoAndDoChannelsWhenAllValid)
{
    kx_io_shm_t shm = make_shm();
    IobusReader reader;
    reader.attach_external(&shm);
    OutputWriter writer(reader);

    OutputCmd out = make_cmd();
    for (int ch = 0; ch < KX_N_AO; ch++) { out.ao_valid[ch] = true; out.ao[ch] = static_cast<float>(ch) + 0.5f; }
    for (int ch = 0; ch < KX_N_DO; ch++) { out.do_valid[ch] = true; out.dout[ch] = (ch % 2); }
    writer.write(out);

    for (int ch = 0; ch < KX_N_AO; ch++)
        EXPECT_FLOAT_EQ(shm.ao_setpoint[ch], static_cast<float>(ch) + 0.5f) << "ch=" << ch;
    for (int ch = 0; ch < KX_N_DO; ch++)
        EXPECT_EQ(shm.do_cmd[ch], static_cast<unsigned>(ch % 2)) << "ch=" << ch;
}
