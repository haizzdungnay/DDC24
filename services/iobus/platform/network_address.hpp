#ifndef IOBUS_NETWORK_ADDRESS_HPP
#define IOBUS_NETWORK_ADDRESS_HPP

#include <string>
#include <utility>
#include <vector>

namespace iobus {

std::string canonical_ipv4_signature(
    std::vector<std::pair<std::string, std::string>> addresses);
std::string ipv4_address_signature(const std::string& interface);

} // namespace iobus

#endif
