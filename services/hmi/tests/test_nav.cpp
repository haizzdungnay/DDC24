#include <gtest/gtest.h>

#include "ui/nav_controller.hpp"

namespace hmi {
namespace {

TEST(NavControllerTest, FiveSurfaceRingWrapsInBothDirections)
{
    EXPECT_EQ(NavController::left_of(ScreenId::SCR_HOME), ScreenId::SCR_SERVICE);
    EXPECT_EQ(NavController::right_of(ScreenId::SCR_SERVICE), ScreenId::SCR_HOME);
    EXPECT_EQ(NavController::right_of(ScreenId::SCR_HOME), ScreenId::SCR_POINTS);
    EXPECT_EQ(NavController::left_of(ScreenId::SCR_ALARM), ScreenId::SCR_CONTROL);
}

} // namespace
} // namespace hmi
