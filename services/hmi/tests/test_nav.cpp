#include <gtest/gtest.h>

#include "ui/nav_controller.hpp"

namespace hmi {
namespace {

TEST(NavControllerTest, SixPageRingWrapsInBothDirections)
{
    EXPECT_EQ(NavController::left_of(ScreenId::SCR_HOME), ScreenId::SCR_SERVICE);
    EXPECT_EQ(NavController::right_of(ScreenId::SCR_SERVICE), ScreenId::SCR_HOME);
    EXPECT_EQ(NavController::right_of(ScreenId::SCR_HOME), ScreenId::SCR_IO);
    EXPECT_EQ(NavController::left_of(ScreenId::SCR_SYSTEM), ScreenId::SCR_COMM);
}

} // namespace
} // namespace hmi
