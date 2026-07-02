#include <cstddef>

#include <gtest/gtest.h>

#include "mkddc_shm.h"

TEST(ShmLayout, IoShmV4OffsetsMatchWebAndTools)
{
    EXPECT_EQ(KX_SHM_MAGIC, 0x4B584404u);
    EXPECT_EQ(offsetof(kx_io_shm_t, ui_raw), static_cast<std::size_t>(80));
    EXPECT_EQ(offsetof(kx_io_shm_t, ui_reliability), static_cast<std::size_t>(160));
    EXPECT_EQ(offsetof(kx_io_shm_t, ui_raw_unit), static_cast<std::size_t>(304));
    EXPECT_EQ(offsetof(kx_io_shm_t, iop_status), static_cast<std::size_t>(502));
    EXPECT_EQ(offsetof(kx_io_shm_t, iop_rx), static_cast<std::size_t>(508));
    EXPECT_EQ(sizeof(kx_io_shm_t), static_cast<std::size_t>(528));
}
