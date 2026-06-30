#include <gtest/gtest.h>

#include "screens/screen_service.hpp"

namespace hmi {
namespace {

TEST(ServiceScreenTest, StartsLockedAndRequiresValidPin)
{
    ScreenService screen;
    screen.set_access_policy("2468", false, "View Only");
    EXPECT_FALSE(screen.unlocked());
    EXPECT_FALSE(screen.try_unlock("0000"));
    EXPECT_TRUE(screen.try_unlock("2468"));
    screen.lock();
    EXPECT_FALSE(screen.unlocked());
}

TEST(ServiceScreenTest, RoleOrPhysicalSwitchGrantsAndRevokesAccess)
{
    ScreenService screen;
    screen.set_access_policy("2468", false, "Engineer");
    EXPECT_TRUE(screen.unlocked());
    screen.set_access_policy("2468", false, "View Only");
    EXPECT_FALSE(screen.unlocked());
    screen.set_access_policy("2468", true, "View Only");
    EXPECT_TRUE(screen.unlocked());
    screen.set_access_policy("2468", false, "View Only");
    EXPECT_FALSE(screen.unlocked());
}

TEST(ServiceScreenTest, RebootConfirmationRequiresThreeSeconds)
{
    EXPECT_FALSE(ScreenService::held_long_enough(1000, 3999));
    EXPECT_TRUE(ScreenService::held_long_enough(1000, 4000));
    EXPECT_TRUE(ScreenService::held_long_enough(0xfffffff0u, 0x00000ba8u));
}

TEST(ServiceScreenTest, OnlyApprovedRolesGrantServiceAccess)
{
    EXPECT_TRUE(ScreenService::role_allows_service("Engineer"));
    EXPECT_TRUE(ScreenService::role_allows_service("Service"));
    EXPECT_TRUE(ScreenService::role_allows_service("admin"));
    EXPECT_FALSE(ScreenService::role_allows_service("View Only"));
    EXPECT_FALSE(ScreenService::role_allows_service("engineer"));
}

} // namespace
} // namespace hmi
