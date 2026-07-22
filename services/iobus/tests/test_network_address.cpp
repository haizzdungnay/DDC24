#include <gtest/gtest.h>

#include "platform/network_address.hpp"

namespace iobus {

TEST(NetworkAddressTest, SignatureIsStableAndIncludesAllAddresses)
{
    const auto first = canonical_ipv4_signature({
        {"eth0", "192.168.10.20"}, {"eth0", "192.168.1.18"}});
    const auto reordered = canonical_ipv4_signature({
        {"eth0", "192.168.1.18"}, {"eth0", "192.168.10.20"}});
    EXPECT_EQ(first, reordered);
    EXPECT_EQ(first, "eth0=192.168.1.18;eth0=192.168.10.20");
}

TEST(NetworkAddressTest, SignatureChangesWhenAddressChanges)
{
    EXPECT_NE(canonical_ipv4_signature({{"eth0", "192.168.1.18"}}),
              canonical_ipv4_signature({{"eth0", "192.168.1.19"}}));
}

} // namespace iobus
