#include "st/st_fbd_model.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_library_registry_generated.hpp"
#include "st/st_limits.hpp"
#include "st/st_profile_generated.hpp"

namespace core {
namespace {

using json = nlohmann::json;

constexpr std::size_t kMaxNetworks = 256;
constexpr std::size_t kMaxPortsPerNode = 16;

void add_issue(FbdValidationResult* result, const char* code, std::string path)
{
    if (result->issues.size() < 64) {
        result->issues.push_back({code, std::move(path)});
    }
}

bool is_canonical_uuid(const std::string& value)
{
    if (value.size() != 36) return false;
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (index == 8 || index == 13 || index == 18 || index == 23) {
            if (value[index] != '-') return false;
            continue;
        }
        const unsigned char ch = static_cast<unsigned char>(value[index]);
        if (!std::isdigit(ch) && !(ch >= 'a' && ch <= 'f')) return false;
    }
    return true;
}

bool is_identifier(const std::string& value)
{
    if (value.empty() || value.size() > 64) return false;
    const auto first = static_cast<unsigned char>(value.front());
    if (!std::isalpha(first) && value.front() != '_') return false;
    return std::all_of(value.begin() + 1, value.end(), [](char raw) {
        const auto ch = static_cast<unsigned char>(raw);
        return std::isalnum(ch) || raw == '_';
    });
}

bool has_only_keys(const json& object, std::initializer_list<const char*> allowed)
{
    if (!object.is_object()) return false;
    std::unordered_set<std::string> keys;
    for (const char* key : allowed) keys.emplace(key);
    for (auto item = object.cbegin(); item != object.cend(); ++item) {
        if (keys.count(item.key()) == 0) return false;
    }
    return true;
}

bool has_string(const json& object, const char* key)
{
    return object.contains(key) && object[key].is_string();
}

bool has_unsigned_in_range(const json& object, const char* key, uint64_t maximum)
{
    return object.contains(key) && object[key].is_number_unsigned() &&
           object[key].get<uint64_t>() <= maximum;
}

bool parse_type(const std::string& value, StType* out)
{
    static const std::array<std::pair<const char*, StType>, 6> types{{
        {"BOOL", StType::BOOL}, {"INT", StType::INT}, {"DINT", StType::DINT},
        {"UINT", StType::UINT}, {"REAL", StType::REAL}, {"TIME", StType::TIME},
    }};
    for (const auto& item : types) {
        if (value == item.first) {
            *out = item.second;
            return true;
        }
    }
    return false;
}

bool parse_kind(const std::string& value, FbdNodeKind* out)
{
    static const std::array<std::pair<const char*, FbdNodeKind>, 8> kinds{{
        {"INPUT", FbdNodeKind::INPUT}, {"OUTPUT", FbdNodeKind::OUTPUT},
        {"CONSTANT", FbdNodeKind::CONSTANT}, {"FUNCTION", FbdNodeKind::FUNCTION},
        {"FUNCTION_BLOCK", FbdNodeKind::FUNCTION_BLOCK},
        {"CONVERSION", FbdNodeKind::CONVERSION},
        {"SIGNAL_READ", FbdNodeKind::SIGNAL_READ},
        {"SIGNAL_PUBLISH", FbdNodeKind::SIGNAL_PUBLISH},
    }};
    for (const auto& item : kinds) {
        if (value == item.first) {
            *out = item.second;
            return true;
        }
    }
    return false;
}

const std::unordered_set<std::string>& scalar_types()
{
    static const std::unordered_set<std::string> values{
        "BOOL", "INT", "DINT", "UINT", "REAL", "TIME",
    };
    return values;
}

/* Ba allowlist dưới đây từng được chép tay và đã trôi khỏi compiler thật:
 * `SCALE`/`DEADBAND`/`CTU`/`PI` được cho phép dù compiler không có, trong khi
 * `SQRT` và bốn conversion INT_TO_REAL/REAL_TO_INT/TIME_TO_REAL/REAL_TO_TIME bị
 * từ chối dù FE vẫn chào người dùng. Nay chúng sinh từ registry machine-readable
 * và có test chứng minh mọi entry giải được ở compiler. */
template <std::size_t N>
std::unordered_set<std::string> to_set(const std::array<std::string_view, N>& generated)
{
    std::unordered_set<std::string> values;
    values.reserve(N);
    for (std::string_view item : generated) values.emplace(item);
    return values;
}

const std::unordered_set<std::string>& pure_functions()
{
    static const std::unordered_set<std::string> values =
        to_set(st_library_registry_generated::kPureFunctions);
    return values;
}

const std::unordered_set<std::string>& stateful_functions()
{
    static const std::unordered_set<std::string> values =
        to_set(st_library_registry_generated::kFbTypes);
    return values;
}

const std::unordered_set<std::string>& explicit_conversions()
{
    static const std::unordered_set<std::string> values =
        to_set(st_library_registry_generated::kExplicitConversions);
    return values;
}

/* Tên có mặt ở BẤT KỲ bảng registry nào. Dùng để phân biệt "sai kind" với "POU
 * người dùng": hai thứ này có hai cách sửa khác nhau. */
bool known_to_registry(const std::string& type_ref)
{
    return scalar_types().count(type_ref) != 0 || pure_functions().count(type_ref) != 0 ||
           stateful_functions().count(type_ref) != 0 ||
           explicit_conversions().count(type_ref) != 0 || type_ref == "SIGNAL_READ" ||
           type_ref == "SIGNAL_PUBLISH";
}

/* Trả false nếu `type_ref` chắc chắn sai. Với FUNCTION/FUNCTION_BLOCK, một
 * identifier không thuộc registry dựng sẵn CHƯA chắc sai — nó có thể là POU của
 * Project hoặc Control Library. Lớp model không biết tập POU nên nó đánh dấu
 * `user_type_ref` và để lớp compile phân giải; ở đó mã lỗi mới nói được "chưa có
 * POU" khác "sai kind" khác "vòng gọi".
 *
 * Đánh đổi được ghi rõ: một typo như `ADDD` nay lọt qua lớp model và chết ở lớp
 * compile. Đó là cùng đánh đổi đã chọn cho `USER_CALL` ở ST, và nó đúng vì lớp
 * model KHÔNG có dữ liệu để phán — báo sai lý do còn tệ hơn báo muộn một lớp. */
bool node_type_ref_matches_kind(FbdNode* node)
{
    switch (node->kind) {
    case FbdNodeKind::INPUT:
    case FbdNodeKind::OUTPUT:
    case FbdNodeKind::CONSTANT:
        return scalar_types().count(node->type_ref) != 0;
    case FbdNodeKind::FUNCTION:
        if (pure_functions().count(node->type_ref) != 0) return true;
        /* Tên CÓ trong registry nhưng thuộc kind khác là SAI KIND, không phải POU
         * người dùng — `TON` trên node FUNCTION phải chết ngay ở lớp model. Chỉ
         * tên registry hoàn toàn không biết mới được coi là POU người dùng. */
        if (known_to_registry(node->type_ref)) return false;
        node->user_type_ref = true;
        return true;
    case FbdNodeKind::FUNCTION_BLOCK:
        if (stateful_functions().count(node->type_ref) != 0) return true;
        if (known_to_registry(node->type_ref)) return false;
        node->user_type_ref = true;
        return true;
    case FbdNodeKind::CONVERSION:
        return explicit_conversions().count(node->type_ref) != 0;
    case FbdNodeKind::SIGNAL_READ:
        return node->type_ref == "SIGNAL_READ";
    case FbdNodeKind::SIGNAL_PUBLISH:
        return node->type_ref == "SIGNAL_PUBLISH";
    }
    return false;
}

bool node_port_shape_matches_kind(const FbdNode& node)
{
    std::size_t input_count = 0;
    std::size_t output_count = 0;
    for (const auto& port : node.ports) {
        if (port.direction == FbdPortDirection::INPUT) ++input_count;
        else ++output_count;
    }
    switch (node.kind) {
    case FbdNodeKind::INPUT:
    case FbdNodeKind::CONSTANT:
        return input_count == 0 && output_count > 0;
    case FbdNodeKind::OUTPUT:
        return input_count > 0 && output_count == 0;
    case FbdNodeKind::FUNCTION:
    case FbdNodeKind::FUNCTION_BLOCK:
    case FbdNodeKind::CONVERSION:
        return input_count > 0 && output_count > 0;
    case FbdNodeKind::SIGNAL_READ:
        return node.ports.size() == 1 && input_count == 0 && output_count == 1 &&
               node.ports[0].name == "OUT" && node.ports[0].order == 0;
    case FbdNodeKind::SIGNAL_PUBLISH:
        return node.ports.size() == 1 && input_count == 1 && output_count == 0 &&
               node.ports[0].name == "IN" && node.ports[0].order == 0;
    }
    return false;
}

bool is_stateful(const FbdNode& node)
{
    return node.kind == FbdNodeKind::FUNCTION_BLOCK;
}

bool signal_parameters_match_kind(const FbdNode& node)
{
    if (node.kind != FbdNodeKind::SIGNAL_READ &&
        node.kind != FbdNodeKind::SIGNAL_PUBLISH)
        return true;
    if (node.parameters.size() != 1) return false;
    const auto found = node.parameters.find("signal");
    if (found == node.parameters.end()) return false;
    const auto* signal = std::get_if<std::string>(&found->second);
    return signal != nullptr && is_identifier(*signal);
}

bool parameters_are_bounded(const json& value)
{
    if (!value.is_object() || value.size() > 32) return false;
    for (const auto& item : value.items()) {
        if (!is_identifier(item.key())) return false;
        const json& parameter = item.value();
        if (parameter.is_boolean()) {
            continue;
        }
        if (parameter.is_number_unsigned()) {
            if (parameter.get<uint64_t>() <= 2147483647ULL) continue;
            return false;
        }
        if (parameter.is_number_integer()) {
            const int64_t number = parameter.get<int64_t>();
            if (number >= -2147483648LL && number <= 2147483647LL) continue;
            return false;
        }
        if (parameter.is_number_float()) {
            const double number = parameter.get<double>();
            if (std::isfinite(number)) continue;
            return false;
        }
        if (parameter.is_string() && parameter.get_ref<const std::string&>().size() <= 128) {
            continue;
        }
        return false;
    }
    return true;
}

struct PortRef {
    const FbdNode* node = nullptr;
    const FbdPort* port = nullptr;
};

bool combinational_order_is_valid(const FbdNetwork& network)
{
    std::unordered_map<std::string, const FbdNode*> nodes;
    for (const auto& node : network.nodes) nodes.emplace(node.id, &node);
    for (const auto& wire : network.wires) {
        const auto source = nodes.find(wire.from.node_id);
        const auto target = nodes.find(wire.to.node_id);
        if (source == nodes.end() || target == nodes.end()) continue;
        if (is_stateful(*source->second) || is_stateful(*target->second)) continue;
        if (source->second->execution_order >= target->second->execution_order) return false;
    }
    return true;
}

void sort_canonical(json* root)
{
    auto& networks = (*root)["networks"];
    std::sort(networks.begin(), networks.end(), [](const json& lhs, const json& rhs) {
        return std::pair{lhs["order"].get<uint64_t>(), lhs["id"].get<std::string>()} <
               std::pair{rhs["order"].get<uint64_t>(), rhs["id"].get<std::string>()};
    });
    for (auto& network : networks) {
        auto& nodes = network["nodes"];
        std::sort(nodes.begin(), nodes.end(), [](const json& lhs, const json& rhs) {
            return std::pair{lhs["executionOrder"].get<uint64_t>(), lhs["id"].get<std::string>()} <
                   std::pair{rhs["executionOrder"].get<uint64_t>(), rhs["id"].get<std::string>()};
        });
        for (auto& node : nodes) {
            auto& ports = node["ports"];
            std::sort(ports.begin(), ports.end(), [](const json& lhs, const json& rhs) {
                return std::pair{lhs["order"].get<uint64_t>(), lhs["id"].get<std::string>()} <
                       std::pair{rhs["order"].get<uint64_t>(), rhs["id"].get<std::string>()};
            });
        }
        auto& wires = network["wires"];
        std::sort(wires.begin(), wires.end(), [](const json& lhs, const json& rhs) {
            return lhs["id"].get<std::string>() < rhs["id"].get<std::string>();
        });
    }
}

void sort_document(FbdDocument* document)
{
    std::sort(document->networks.begin(), document->networks.end(),
              [](const FbdNetwork& lhs, const FbdNetwork& rhs) {
        return std::pair{lhs.order, lhs.id} < std::pair{rhs.order, rhs.id};
    });
    for (auto& network : document->networks) {
        std::sort(network.nodes.begin(), network.nodes.end(),
                  [](const FbdNode& lhs, const FbdNode& rhs) {
            return std::pair{lhs.execution_order, lhs.id} <
                   std::pair{rhs.execution_order, rhs.id};
        });
        for (auto& node : network.nodes) {
            std::sort(node.ports.begin(), node.ports.end(),
                      [](const FbdPort& lhs, const FbdPort& rhs) {
                return std::pair{lhs.order, lhs.id} < std::pair{rhs.order, rhs.id};
            });
        }
        std::sort(network.wires.begin(), network.wires.end(),
                  [](const FbdWire& lhs, const FbdWire& rhs) {
            return lhs.id < rhs.id;
        });
    }
}

} // namespace

FbdValidationResult validate_and_canonicalize_fbd(std::string_view source)
{
    FbdValidationResult result;
    if (source.empty() || source.size() > st_profile_generated::kMaxSourceBytes) {
        add_issue(&result, "FBD-SCHEMA-SIZE-001", "$");
        return result;
    }

    bool duplicate_key = false;
    std::vector<std::unordered_set<std::string>> object_keys;
    const json::parser_callback_t duplicate_guard =
        [&](int depth, json::parse_event_t event, json& parsed) {
            if (event == json::parse_event_t::object_start) {
                const auto key_depth = static_cast<std::size_t>(depth + 1);
                if (object_keys.size() <= key_depth) object_keys.resize(key_depth + 1);
                object_keys[key_depth].clear();
            } else if (event == json::parse_event_t::key) {
                const auto key_depth = static_cast<std::size_t>(depth);
                if (object_keys.size() <= key_depth) object_keys.resize(key_depth + 1);
                if (!object_keys[key_depth].emplace(parsed.get<std::string>()).second) {
                    duplicate_key = true;
                }
            }
            return true;
        };
    json root = json::parse(source, duplicate_guard, false, false);
    if (root.is_discarded() || !root.is_object()) {
        add_issue(&result, "FBD-SCHEMA-JSON-001", "$");
        return result;
    }
    if (duplicate_key) {
        add_issue(&result, "FBD-SCHEMA-JSON-DUP-001", "$");
        return result;
    }
    if (!has_only_keys(root, {"$schema", "schemaVersion", "profileId", "graphId", "name", "networks"}) ||
        !has_string(root, "$schema") || !has_unsigned_in_range(root, "schemaVersion", 1) ||
        root["schemaVersion"].get<uint64_t>() != 1 || !has_string(root, "profileId") ||
        root["profileId"] != st_profile_generated::kProfileId || !has_string(root, "graphId") ||
        !has_string(root, "name") || !root.contains("networks") || !root["networks"].is_array()) {
        add_issue(&result, "FBD-SCHEMA-ROOT-001", "$");
        return result;
    }
    if (root["$schema"] != "../../fbd_v1.schema.json" ||
        !is_canonical_uuid(root["graphId"].get<std::string>()) ||
        !is_identifier(root["name"].get<std::string>())) {
        add_issue(&result, "FBD-SCHEMA-ROOT-001", "$");
    }

    const auto& networks_json = root["networks"];
    if (networks_json.empty() || networks_json.size() > kMaxNetworks) {
        add_issue(&result, "FBD-LIMIT-NETWORK-001", "$.networks");
    }

    std::unordered_set<std::string> ids;
    ids.emplace(root["graphId"].get<std::string>());
    std::set<uint64_t> network_orders;
    std::size_t total_nodes = 0;
    std::size_t total_wires = 0;
    FbdDocument document;
    document.graph_id = root["graphId"].get<std::string>();
    document.name = root["name"].get<std::string>();

    for (std::size_t network_index = 0; network_index < networks_json.size(); ++network_index) {
        const json& network_json = networks_json[network_index];
        const std::string network_path = "$.networks[" + std::to_string(network_index) + "]";
        if (!has_only_keys(network_json, {"id", "name", "order", "nodes", "wires"}) ||
            !has_string(network_json, "id") || !has_string(network_json, "name") ||
            !has_unsigned_in_range(network_json, "order", 255) ||
            !network_json.contains("nodes") || !network_json["nodes"].is_array() ||
            !network_json.contains("wires") || !network_json["wires"].is_array()) {
            add_issue(&result, "FBD-SCHEMA-NETWORK-001", network_path);
            continue;
        }
        const std::string network_id = network_json["id"].get<std::string>();
        const uint64_t network_order = network_json["order"].get<uint64_t>();
        if (!is_canonical_uuid(network_id) || !ids.emplace(network_id).second ||
            !is_identifier(network_json["name"].get<std::string>()) ||
            !network_orders.emplace(network_order).second) {
            add_issue(&result, "FBD-SEM-NETWORK-001", network_path);
        }

        FbdNetwork network;
        network.id = network_id;
        network.name = network_json["name"].get<std::string>();
        network.order = static_cast<uint16_t>(network_order);
        std::set<uint64_t> execution_orders;
        std::unordered_map<std::string, PortRef> ports;

        const auto& nodes_json = network_json["nodes"];
        total_nodes += nodes_json.size();
        if (nodes_json.empty() || total_nodes > st_profile_generated::kMaxFbdBlocks) {
            add_issue(&result, "FBD-LIMIT-BLOCK-001", network_path + ".nodes");
        }
        for (std::size_t node_index = 0; node_index < nodes_json.size(); ++node_index) {
            const json& node_json = nodes_json[node_index];
            const std::string node_path = network_path + ".nodes[" + std::to_string(node_index) + "]";
            if (!has_only_keys(node_json, {"id", "kind", "typeRef", "executionOrder", "parameters", "ports"}) ||
                !has_string(node_json, "id") || !has_string(node_json, "kind") ||
                !has_string(node_json, "typeRef") || !has_unsigned_in_range(node_json, "executionOrder", 255) ||
                !node_json.contains("parameters") || !parameters_are_bounded(node_json["parameters"]) ||
                !node_json.contains("ports") || !node_json["ports"].is_array()) {
                add_issue(&result, "FBD-SCHEMA-NODE-001", node_path);
                continue;
            }
            FbdNode node;
            node.id = node_json["id"].get<std::string>();
            node.type_ref = node_json["typeRef"].get<std::string>();
            node.execution_order = static_cast<uint16_t>(node_json["executionOrder"].get<uint64_t>());
            if (!is_canonical_uuid(node.id) || !ids.emplace(node.id).second ||
                !parse_kind(node_json["kind"].get<std::string>(), &node.kind) ||
                !is_identifier(node.type_ref) || !execution_orders.emplace(node.execution_order).second) {
                add_issue(&result, "FBD-SEM-NODE-001", node_path);
            }
            if (!node_type_ref_matches_kind(&node)) {
                add_issue(&result, "FBD-SEM-TYPE-REF-001", node_path + ".typeRef");
            }
            for (const auto& parameter : node_json["parameters"].items()) {
                const auto& value = parameter.value();
                if (value.is_boolean()) node.parameters.emplace(parameter.key(), value.get<bool>());
                else if (value.is_number_integer() || value.is_number_unsigned()) {
                    node.parameters.emplace(parameter.key(), value.get<int64_t>());
                } else if (value.is_number_float()) {
                    node.parameters.emplace(parameter.key(), value.get<double>());
                } else {
                    node.parameters.emplace(parameter.key(), value.get<std::string>());
                }
            }
            const auto& ports_json = node_json["ports"];
            if (ports_json.empty() || ports_json.size() > kMaxPortsPerNode) {
                add_issue(&result, "FBD-LIMIT-PORT-001", node_path + ".ports");
            }
            std::set<uint64_t> port_orders;
            std::unordered_set<std::string> port_names;
            for (std::size_t port_index = 0; port_index < ports_json.size(); ++port_index) {
                const json& port_json = ports_json[port_index];
                const std::string port_path = node_path + ".ports[" + std::to_string(port_index) + "]";
                if (!has_only_keys(port_json, {"id", "name", "direction", "dataType", "unit", "order"}) ||
                    !has_string(port_json, "id") || !has_string(port_json, "name") ||
                    !has_string(port_json, "direction") || !has_string(port_json, "dataType") ||
                    !port_json.contains("unit") ||
                    !(port_json["unit"].is_null() || port_json["unit"].is_string()) ||
                    !has_unsigned_in_range(port_json, "order", 15)) {
                    add_issue(&result, "FBD-SCHEMA-PORT-001", port_path);
                    continue;
                }
                FbdPort port;
                port.id = port_json["id"].get<std::string>();
                port.name = port_json["name"].get<std::string>();
                port.order = static_cast<uint8_t>(port_json["order"].get<uint64_t>());
                const std::string direction = port_json["direction"].get<std::string>();
                port.direction = direction == "OUTPUT" ? FbdPortDirection::OUTPUT : FbdPortDirection::INPUT;
                if (port_json["unit"].is_string()) {
                    port.unit = port_json["unit"].get<std::string>();
                    port.has_unit = true;
                }
                if (!is_canonical_uuid(port.id) || !ids.emplace(port.id).second ||
                    !is_identifier(port.name) || !port_names.emplace(port.name).second ||
                    (direction != "INPUT" && direction != "OUTPUT") ||
                    !parse_type(port_json["dataType"].get<std::string>(), &port.data_type) ||
                    (port.has_unit && (port.unit.empty() || port.unit.size() > 32)) ||
                    !port_orders.emplace(port.order).second) {
                    add_issue(&result, "FBD-SEM-PORT-001", port_path);
                }
                node.ports.push_back(port);
            }
            if (!node_port_shape_matches_kind(node)) {
                add_issue(&result, "FBD-SEM-PORT-SHAPE-001", node_path + ".ports");
            }
            if (!signal_parameters_match_kind(node)) {
                add_issue(&result, "FBD-SEM-PARAM-001", node_path + ".parameters");
            }
            network.nodes.push_back(std::move(node));
        }

        for (const auto& node : network.nodes) {
            for (const auto& port : node.ports) ports.emplace(port.id, PortRef{&node, &port});
        }

        const auto& wires_json = network_json["wires"];
        total_wires += wires_json.size();
        if (total_wires > st_profile_generated::kMaxFbdConnections) {
            add_issue(&result, "FBD-LIMIT-WIRE-001", network_path + ".wires");
        }
        std::unordered_set<std::string> driven_inputs;
        for (std::size_t wire_index = 0; wire_index < wires_json.size(); ++wire_index) {
            const json& wire_json = wires_json[wire_index];
            const std::string wire_path = network_path + ".wires[" + std::to_string(wire_index) + "]";
            if (!has_only_keys(wire_json, {"id", "from", "to"}) || !has_string(wire_json, "id") ||
                !wire_json.contains("from") || !wire_json.contains("to") ||
                !has_only_keys(wire_json["from"], {"nodeId", "portId"}) ||
                !has_only_keys(wire_json["to"], {"nodeId", "portId"}) ||
                !has_string(wire_json["from"], "nodeId") || !has_string(wire_json["from"], "portId") ||
                !has_string(wire_json["to"], "nodeId") || !has_string(wire_json["to"], "portId")) {
                add_issue(&result, "FBD-SCHEMA-WIRE-001", wire_path);
                continue;
            }
            FbdWire wire;
            wire.id = wire_json["id"].get<std::string>();
            wire.from = {wire_json["from"]["nodeId"].get<std::string>(),
                         wire_json["from"]["portId"].get<std::string>()};
            wire.to = {wire_json["to"]["nodeId"].get<std::string>(),
                       wire_json["to"]["portId"].get<std::string>()};
            const auto from = ports.find(wire.from.port_id);
            const auto to = ports.find(wire.to.port_id);
            const bool endpoints_ok = from != ports.end() && to != ports.end() &&
                from->second.node->id == wire.from.node_id && to->second.node->id == wire.to.node_id;
            const bool compatible = endpoints_ok &&
                from->second.port->direction == FbdPortDirection::OUTPUT &&
                to->second.port->direction == FbdPortDirection::INPUT &&
                from->second.port->data_type == to->second.port->data_type &&
                from->second.port->has_unit == to->second.port->has_unit &&
                (!from->second.port->has_unit || from->second.port->unit == to->second.port->unit) &&
                driven_inputs.emplace(wire.to.port_id).second;
            if (!is_canonical_uuid(wire.id) || !ids.emplace(wire.id).second || !compatible) {
                add_issue(&result, "FBD-SEM-WIRE-001", wire_path);
            }
            network.wires.push_back(std::move(wire));
        }
        if (!combinational_order_is_valid(network)) {
            add_issue(&result, "FBD-SEM-ORDER-001", network_path + ".nodes");
        }
        document.networks.push_back(std::move(network));
    }

    if (!result.issues.empty()) return result;
    sort_canonical(&root);
    sort_document(&document);
    result.canonical_json = root.dump();
    if (result.canonical_json.size() > st_profile_generated::kMaxSourceBytes) {
        result.canonical_json.clear();
        add_issue(&result, "FBD-SCHEMA-SIZE-001", "$");
        return result;
    }
    result.document = std::move(document);
    result.ok = true;
    return result;
}

} // namespace core
