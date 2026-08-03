#include "platform/network_address.hpp"

#include <algorithm>
#include <arpa/inet.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <sys/socket.h>

namespace iobus {

std::string canonical_ipv4_signature(
    std::vector<std::pair<std::string, std::string>> addresses)
{
    std::sort(addresses.begin(), addresses.end());
    std::string result;
    for (const auto& address : addresses) {
        if (!result.empty()) result += ';';
        result += address.first + '=' + address.second;
    }
    return result;
}

std::string ipv4_address_signature(const std::string& interface)
{
    struct ifaddrs* list = nullptr;
    if (::getifaddrs(&list) != 0) return {};
    std::vector<std::pair<std::string, std::string>> addresses;
    for (const struct ifaddrs* item = list; item; item = item->ifa_next) {
        if (!item->ifa_addr || item->ifa_addr->sa_family != AF_INET ||
            (item->ifa_flags & IFF_LOOPBACK) != 0) continue;
        if (!interface.empty() && interface != item->ifa_name) continue;
        char ip[INET_ADDRSTRLEN]{};
        const auto* in = reinterpret_cast<const struct sockaddr_in*>(item->ifa_addr);
        if (::inet_ntop(AF_INET, &in->sin_addr, ip, sizeof(ip)))
            addresses.emplace_back(item->ifa_name, ip);
    }
    ::freeifaddrs(list);
    return canonical_ipv4_signature(std::move(addresses));
}

} // namespace iobus
