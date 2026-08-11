#ifndef CORE_ST_FBD_MODEL_HPP
#define CORE_ST_FBD_MODEL_HPP

#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "st/st_program.hpp"

namespace core {

enum class FbdNodeKind : uint8_t {
    INPUT,
    OUTPUT,
    CONSTANT,
    FUNCTION,
    FUNCTION_BLOCK,
    CONVERSION,
};

enum class FbdPortDirection : uint8_t { INPUT, OUTPUT };

using FbdParameterValue = std::variant<bool, int64_t, double, std::string>;

struct FbdPort {
    std::string id;
    std::string name;
    FbdPortDirection direction = FbdPortDirection::INPUT;
    StType data_type = StType::BOOL;
    std::string unit;
    bool has_unit = false;
    uint8_t order = 0;
};

struct FbdNode {
    std::string id;
    FbdNodeKind kind = FbdNodeKind::FUNCTION;
    std::string type_ref;
    uint16_t execution_order = 0;
    std::map<std::string, FbdParameterValue> parameters;
    std::vector<FbdPort> ports;
};

struct FbdEndpoint {
    std::string node_id;
    std::string port_id;
};

struct FbdWire {
    std::string id;
    FbdEndpoint from;
    FbdEndpoint to;
};

struct FbdNetwork {
    std::string id;
    std::string name;
    uint16_t order = 0;
    std::vector<FbdNode> nodes;
    std::vector<FbdWire> wires;
};

struct FbdDocument {
    std::string graph_id;
    std::string name;
    std::vector<FbdNetwork> networks;
};

struct FbdIssue {
    std::string code;
    std::string path;
};

struct FbdValidationResult {
    bool ok = false;
    FbdDocument document;
    std::string canonical_json;
    std::vector<FbdIssue> issues;
};

// Parser/validator FBD chỉ nằm trong st_compiler_lib (non-RT). Hàm luôn dựng
// kết quả tạm; khi có bất kỳ issue nào thì document/canonical_json không được
// consumer dùng làm Revision canonical.
FbdValidationResult validate_and_canonicalize_fbd(std::string_view source);

} // namespace core

#endif // CORE_ST_FBD_MODEL_HPP
