#include <gtest/gtest.h>

#include "input/gpio_buttons.hpp"
#include "input/evdev_touch.hpp"
#include "drm/lv_drm_display.hpp"

namespace hmi {
namespace {

TEST(KeyQueueTest, PreservesOrderAndState)
{
    KeyQueue queue;
    EXPECT_TRUE(queue.empty());
    EXPECT_TRUE(queue.push({LV_KEY_LEFT, LV_INDEV_STATE_PRESSED}));
    EXPECT_TRUE(queue.push({LV_KEY_LEFT, LV_INDEV_STATE_RELEASED}));

    KeyEvent event{};
    ASSERT_TRUE(queue.pop(&event));
    EXPECT_EQ(event.key, LV_KEY_LEFT);
    EXPECT_EQ(event.state, LV_INDEV_STATE_PRESSED);
    ASSERT_TRUE(queue.pop(&event));
    EXPECT_EQ(event.state, LV_INDEV_STATE_RELEASED);
    EXPECT_TRUE(queue.empty());
    EXPECT_FALSE(queue.pop(&event));
}

TEST(KeyQueueTest, RejectsPushWhenFull)
{
    KeyQueue queue;
    for (size_t i = 0; i < KeyQueue::CAP; ++i)
        ASSERT_TRUE(queue.push({LV_KEY_UP, LV_INDEV_STATE_PRESSED}));
    EXPECT_FALSE(queue.push({LV_KEY_DOWN, LV_INDEV_STATE_PRESSED}));
}

TEST(EvdevTouchTest, MapsPortraitAbsRangeToLandscapeCorners)
{
    const lv_point_t top_right = EvdevTouch::map_portrait_point(
        0, 4095, 0, 4095, 0, 4095, 320, 240);
    EXPECT_EQ(top_right.x, 319);
    EXPECT_EQ(top_right.y, 239);

    const lv_point_t bottom_left = EvdevTouch::map_portrait_point(
        4095, 0, 0, 4095, 0, 4095, 320, 240);
    EXPECT_EQ(bottom_left.x, 0);
    EXPECT_EQ(bottom_left.y, 0);
}

TEST(DrmDisplayTest, LandscapeMappingIsInverseOfTouchRotation)
{
    for (int32_t physical_x : {0, 47, 239}) {
        for (int32_t physical_y : {0, 123, 319}) {
            const lv_point_t logical = EvdevTouch::map_portrait_point(
                physical_x, physical_y, 0, 239, 0, 319, 320, 240);
            const lv_point_t physical = drm_landscape_to_native(
                logical.x, logical.y, 240, 320);
            EXPECT_EQ(physical.x, physical_x);
            EXPECT_EQ(physical.y, physical_y);
        }
    }
}

} // namespace
} // namespace hmi
