#include "st/st_fbd_compile.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_semantic.hpp"

namespace core {
namespace {

void add_issue(std::vector<FbdIssue>* issues, const char* code, const std::string& path)
{
    if (issues->size() < 64) issues->push_back({code, path});
}

std::string node_path(const FbdNetwork& network, const FbdNode& node)
{
    return "$.networks[" + network.id + "].nodes[" + node.id + "]";
}

const std::string* string_parameter(const FbdNode& node, const char* name)
{
    const auto found = node.parameters.find(name);
    if (found == node.parameters.end()) return nullptr;
    return std::get_if<std::string>(&found->second);
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

std::vector<const FbdPort*> ports_with_direction(const FbdNode& node, FbdPortDirection direction)
{
    std::vector<const FbdPort*> ports;
    for (const auto& port : node.ports) {
        if (port.direction == direction) ports.push_back(&port);
    }
    std::sort(ports.begin(), ports.end(), [](const FbdPort* lhs, const FbdPort* rhs) {
        return std::pair{lhs->order, lhs->id} < std::pair{rhs->order, rhs->id};
    });
    return ports;
}

std::unique_ptr<StExpr> variable_expr(const std::string& name)
{
    auto expression = std::make_unique<StExpr>();
    expression->kind = StExpr::Kind::VAR;
    expression->var_name = name;
    return expression;
}

std::unique_ptr<StExpr> member_expr(const std::string& instance, const std::string& output)
{
    auto expression = std::make_unique<StExpr>();
    expression->kind = StExpr::Kind::MEMBER;
    expression->member_object = instance;
    expression->member_field = output;
    return expression;
}

bool parameter_to_literal(const FbdNode& node, StType type, StValue* value)
{
    const auto found = node.parameters.find("value");
    if (found == node.parameters.end()) return false;
    const FbdParameterValue& parameter = found->second;
    switch (type) {
    case StType::BOOL: {
        const bool* candidate = std::get_if<bool>(&parameter);
        if (!candidate) return false;
        *value = StValue::make_bool(*candidate);
        return true;
    }
    case StType::INT:
    case StType::DINT:
    case StType::UINT: {
        const int64_t* candidate = std::get_if<int64_t>(&parameter);
        if (!candidate || *candidate < st_integer_min(type) || *candidate > st_integer_max(type)) {
            return false;
        }
        *value = StValue::make_integer(type, static_cast<int32_t>(*candidate));
        return true;
    }
    case StType::REAL: {
        double candidate = 0.0;
        if (const auto* number = std::get_if<double>(&parameter)) candidate = *number;
        else if (const auto* integer = std::get_if<int64_t>(&parameter)) {
            candidate = static_cast<double>(*integer);
        } else {
            return false;
        }
        const float narrowed = static_cast<float>(candidate);
        if (!std::isfinite(candidate) || !std::isfinite(narrowed)) return false;
        *value = StValue::make_real(narrowed);
        return true;
    }
    case StType::TIME: {
        const int64_t* candidate = std::get_if<int64_t>(&parameter);
        if (!candidate || *candidate < 0 || *candidate > 86400000000000LL) return false;
        *value = StValue::make_time(*candidate);
        return true;
    }
    }
    return false;
}

bool binop_from_type_ref(const std::string& type_ref, StBinOp* operation)
{
    static const std::map<std::string, StBinOp> operations{
        {"AND", StBinOp::AND}, {"OR", StBinOp::OR},   {"XOR", StBinOp::XOR},
        {"EQ", StBinOp::EQ},   {"NE", StBinOp::NE},   {"LT", StBinOp::LT},
        {"LE", StBinOp::LE},   {"GT", StBinOp::GT},   {"GE", StBinOp::GE},
        {"ADD", StBinOp::ADD}, {"SUB", StBinOp::SUB}, {"MUL", StBinOp::MUL},
        {"DIV", StBinOp::DIV}, {"MOD", StBinOp::MOD},
    };
    const auto found = operations.find(type_ref);
    if (found == operations.end()) return false;
    *operation = found->second;
    return true;
}

class Lowerer {
public:
    explicit Lowerer(const FbdDocument& document) : document_(document) {}

    bool run(StProgram* program)
    {
        program_ = program;
        program_->name = document_.name;
        if (!index_document()) return false;
        if (!declare_variables()) return false;
        if (!declare_function_blocks()) return false;
        if (!validate_all_producer_nodes()) return false;
        return emit_body();
    }

    const std::vector<FbdIssue>& issues() const { return issues_; }
    const std::vector<FbdSourceAnchor>& source_anchors() const { return source_anchors_; }

private:
    struct NodeRef {
        const FbdNetwork* network = nullptr;
        const FbdNode* node = nullptr;
    };

    struct PortRef {
        const FbdNetwork* network = nullptr;
        const FbdNode* node = nullptr;
        const FbdPort* port = nullptr;
    };

    const FbdDocument& document_;
    StProgram* program_ = nullptr;
    std::vector<FbdIssue> issues_;
    std::unordered_map<std::string, NodeRef> nodes_;
    std::unordered_map<std::string, PortRef> ports_;
    std::unordered_map<std::string, std::size_t> anchor_by_port_;
    std::unordered_map<std::string, FbdEndpoint> incoming_;
    std::unordered_map<std::string, std::string> fb_instance_;
    std::unordered_map<std::string, StVarDecl> variables_;
    std::unordered_set<std::string> output_writers_;
    std::unordered_set<std::string> visiting_;
    std::vector<FbdSourceAnchor> source_anchors_;

    bool fail(const char* code, const std::string& path)
    {
        add_issue(&issues_, code, path);
        return false;
    }

    bool index_document()
    {
        for (std::size_t network_index = 0; network_index < document_.networks.size();
             ++network_index) {
            const auto& network = document_.networks[network_index];
            uint32_t anchor_column = 1;
            for (const auto& node : network.nodes) {
                nodes_.emplace(node.id, NodeRef{&network, &node});
                for (const auto& port : node.ports) {
                    if (anchor_column > std::numeric_limits<uint16_t>::max())
                        return fail("FBD-LIMIT-SOURCEMAP-001", node_path(network, node));
                    ports_.emplace(port.id, PortRef{&network, &node, &port});
                    FbdSourceAnchor anchor;
                    anchor.line = static_cast<uint16_t>(network_index + 1u);
                    anchor.column = static_cast<uint16_t>(anchor_column++);
                    anchor.network_id = network.id;
                    anchor.node_id = node.id;
                    anchor.port_id = port.id;
                    anchor.unit = port.unit;
                    anchor.has_unit = port.has_unit;
                    anchor_by_port_.emplace(port.id, source_anchors_.size());
                    source_anchors_.push_back(std::move(anchor));
                }
            }
            for (const auto& wire : network.wires) incoming_.emplace(wire.to.port_id, wire.from);
        }
        return true;
    }

    const FbdSourceAnchor* anchor_for_port(const FbdPort& port) const
    {
        const auto found = anchor_by_port_.find(port.id);
        return found == anchor_by_port_.end() ? nullptr : &source_anchors_[found->second];
    }

    void locate_expression(StExpr* expression, const FbdPort& port) const
    {
        const FbdSourceAnchor* anchor = anchor_for_port(port);
        if (!expression || !anchor) return;
        expression->line = anchor->line;
        expression->column = anchor->column;
        expression->length = 1;
    }

    bool declare_one_variable(const FbdNetwork& network, const FbdNode& node,
                              StStorage storage)
    {
        if (node.parameters.size() != 1) {
            return fail("FBD-SEM-PARAM-001", node_path(network, node) + ".parameters");
        }
        const std::string* name = string_parameter(node, "variable");
        if (!name || !is_identifier(*name)) {
            return fail("FBD-SEM-PARAM-001", node_path(network, node) + ".parameters");
        }
        const auto expected_ports = ports_with_direction(
            node, storage == StStorage::VAR_INPUT ? FbdPortDirection::OUTPUT
                                                  : FbdPortDirection::INPUT);
        if (expected_ports.size() != 1 ||
            node.type_ref != st_type_name(expected_ports[0]->data_type)) {
            return fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
        }
        if (storage == StStorage::VAR_OUTPUT && !output_writers_.emplace(*name).second) {
            return fail("FBD-SEM-VARIABLE-001", node_path(network, node) + ".parameters.variable");
        }
        const FbdSourceAnchor* anchor = anchor_for_port(*expected_ports[0]);
        if (!anchor) return fail("FBD-LIMIT-SOURCEMAP-001", node_path(network, node));
        const StVarDecl declaration{*name, expected_ports[0]->data_type, storage,
                                    anchor->line, anchor->column, 1};
        const auto existing = variables_.find(*name);
        if (existing != variables_.end()) {
            if (existing->second.type != declaration.type || existing->second.storage != storage) {
                return fail("FBD-SEM-VARIABLE-001",
                            node_path(network, node) + ".parameters.variable");
            }
            return true;
        }
        variables_.emplace(*name, declaration);
        program_->vars.push_back(declaration);
        return true;
    }

    bool declare_variables()
    {
        // Giống layout ST: toàn bộ VAR_INPUT trước VAR_OUTPUT, không phụ thuộc
        // thứ tự node giữa các network.
        for (const FbdNodeKind kind : {FbdNodeKind::INPUT, FbdNodeKind::OUTPUT}) {
            for (const auto& network : document_.networks) {
                for (const auto& node : network.nodes) {
                    if (node.kind != kind) continue;
                    const StStorage storage = kind == FbdNodeKind::INPUT
                                                  ? StStorage::VAR_INPUT
                                                  : StStorage::VAR_OUTPUT;
                    if (!declare_one_variable(network, node, storage)) return false;
                }
            }
        }
        return true;
    }

    bool validate_fb_ports(const FbdNetwork& network, const FbdNode& node, StFbType type)
    {
        const auto inputs = ports_with_direction(node, FbdPortDirection::INPUT);
        const auto outputs = ports_with_direction(node, FbdPortDirection::OUTPUT);
        if (inputs.size() != static_cast<std::size_t>(st_fb_input_count(type)) ||
            outputs.size() != static_cast<std::size_t>(st_fb_output_count(type))) {
            return fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
        }
        for (std::size_t index = 0; index < inputs.size(); ++index) {
            const char* name = st_fb_input_name(type, static_cast<int>(index));
            if (!name || inputs[index]->name != name ||
                inputs[index]->data_type != st_fb_input_type(type, static_cast<int>(index))) {
                return fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
            }
        }
        for (std::size_t index = 0; index < outputs.size(); ++index) {
            const char* name = st_fb_output_name(type, static_cast<int>(index));
            if (!name || outputs[index]->name != name ||
                outputs[index]->data_type != st_fb_output_type(type, static_cast<int>(index))) {
                return fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
            }
        }
        return true;
    }

    bool declare_function_blocks()
    {
        for (const auto& network : document_.networks) {
            for (const auto& node : network.nodes) {
                if (node.kind != FbdNodeKind::FUNCTION_BLOCK) continue;
                const StFbType type = st_fb_type_from_name(node.type_ref);
                if (type == StFbType::NONE && !node.user_type_ref) {
                    return fail("FBD-SEM-LIBRARY-UNSUPPORTED-001",
                                node_path(network, node) + ".typeRef");
                }
                /* Với FB người dùng, chữ ký nằm ở POU chứ không ở bảng dựng sẵn,
                 * nên `validate_fb_ports` không có gì để đối chiếu. Việc kiểm
                 * cổng thuộc `st_pou_registry` — lớp duy nhất giữ interface. Bỏ
                 * qua ở đây là chuyển đúng trách nhiệm, không phải bỏ kiểm. */
                if (!node.user_type_ref && !validate_fb_ports(network, node, type)) return false;
                if (node.parameters.size() > 2) {
                    return fail("FBD-SEM-PARAM-001", node_path(network, node) + ".parameters");
                }
                std::string instance = "FB_" + std::to_string(network.order) + "_" +
                                       std::to_string(node.execution_order);
                for (const auto& parameter : node.parameters) {
                    if (parameter.first != "instance" && parameter.first != "retained") {
                        return fail("FBD-SEM-PARAM-001",
                                    node_path(network, node) + ".parameters." + parameter.first);
                    }
                }
                const auto instance_parameter = node.parameters.find("instance");
                if (instance_parameter != node.parameters.end()) {
                    const std::string* explicit_name =
                        std::get_if<std::string>(&instance_parameter->second);
                    if (!explicit_name) {
                        return fail("FBD-SEM-PARAM-001",
                                    node_path(network, node) + ".parameters.instance");
                    }
                    instance = *explicit_name;
                }
                if (!is_identifier(instance)) {
                    return fail("FBD-SEM-PARAM-001",
                                node_path(network, node) + ".parameters.instance");
                }
                bool retained = false;
                const auto retained_parameter = node.parameters.find("retained");
                if (retained_parameter != node.parameters.end()) {
                    const bool* value = std::get_if<bool>(&retained_parameter->second);
                    if (!value) {
                        return fail("FBD-SEM-PARAM-001",
                                    node_path(network, node) + ".parameters.retained");
                    }
                    retained = *value;
                }
                if (variables_.count(instance) ||
                    std::any_of(program_->fbs.begin(), program_->fbs.end(),
                                [&](const StFbDecl& item) { return item.name == instance; })) {
                    return fail("FBD-SEM-VARIABLE-001",
                                node_path(network, node) + ".parameters.instance");
                }
                const auto outputs = ports_with_direction(node, FbdPortDirection::OUTPUT);
                const auto inputs = ports_with_direction(node, FbdPortDirection::INPUT);
                const FbdPort* location_port = !outputs.empty() ? outputs.front()
                                               : (!inputs.empty() ? inputs.front() : nullptr);
                const FbdSourceAnchor* anchor =
                    location_port ? anchor_for_port(*location_port) : nullptr;
                if (!anchor) return fail("FBD-LIMIT-SOURCEMAP-001", node_path(network, node));
                fb_instance_.emplace(node.id, instance);
                /* Khởi tạo theo tên trường: `StFbDecl` có thêm hai trường cho
                 * instance FB người dùng (T59-104), và initializer theo vị trí sẽ
                 * âm thầm gán sai khi struct đổi. */
                StFbDecl decl;
                decl.name = instance;
                decl.fb_type = type;
                decl.is_user_type = node.user_type_ref;
                if (node.user_type_ref) decl.user_type_name = node.type_ref;
                decl.retained = retained;
                decl.line = anchor->line;
                decl.column = anchor->column;
                decl.length = 1;
                program_->fbs.push_back(std::move(decl));
            }
        }
        return true;
    }

    std::unique_ptr<StExpr> source_for_input(const FbdNetwork& network, const FbdNode& node,
                                             const FbdPort& input)
    {
        const auto incoming = incoming_.find(input.id);
        if (incoming == incoming_.end()) {
            fail("FBD-SEM-UNCONNECTED-001", node_path(network, node) + ".ports[" + input.id + "]");
            return nullptr;
        }
        const auto source_node = nodes_.find(incoming->second.node_id);
        const auto source_port = ports_.find(incoming->second.port_id);
        if (source_node == nodes_.end() || source_port == ports_.end() ||
            source_node->second.network != &network || source_port->second.network != &network) {
            fail("FBD-SEM-WIRE-001", node_path(network, node) + ".ports[" + input.id + "]");
            return nullptr;
        }
        return expression_for_output(*source_node->second.network, *source_node->second.node,
                                     *source_port->second.port);
    }

    std::unique_ptr<StExpr> function_expression(const FbdNetwork& network, const FbdNode& node,
                                                const FbdPort& output)
    {
        if (!node.parameters.empty()) {
            fail("FBD-SEM-PARAM-001", node_path(network, node) + ".parameters");
            return nullptr;
        }
        const auto outputs = ports_with_direction(node, FbdPortDirection::OUTPUT);
        const auto inputs = ports_with_direction(node, FbdPortDirection::INPUT);
        if (outputs.size() != 1 || outputs[0]->id != output.id) {
            fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
            return nullptr;
        }
        std::vector<std::unique_ptr<StExpr>> arguments;
        arguments.reserve(inputs.size());
        for (const FbdPort* input : inputs) {
            auto argument = source_for_input(network, node, *input);
            if (!argument) return nullptr;
            arguments.push_back(std::move(argument));
        }

        StBinOp binary;
        if (binop_from_type_ref(node.type_ref, &binary)) {
            if (arguments.size() != 2) {
                fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
                return nullptr;
            }
            auto expression = std::make_unique<StExpr>();
            expression->kind = StExpr::Kind::BINOP;
            expression->bin_op = binary;
            expression->lhs = std::move(arguments[0]);
            expression->rhs = std::move(arguments[1]);
            return expression;
        }
        if (node.type_ref == "NOT") {
            if (arguments.size() != 1) {
                fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
                return nullptr;
            }
            auto expression = std::make_unique<StExpr>();
            expression->kind = StExpr::Kind::UNOP;
            expression->un_op = StUnOp::NOT;
            expression->operand = std::move(arguments[0]);
            return expression;
        }

        if (node.user_type_ref) {
            /* T59-105: node FBD gọi FUNCTION người dùng lower thành ĐÚNG cùng một
             * nút IR mà ST sinh ra (`USER_CALL`). Đây chính là nghĩa cụ thể của
             * "ST và FBD dùng chung typed IR": không có hai đường lowering, nên
             * không có hai bộ ngữ nghĩa để trôi khỏi nhau. Số đối số và kiểu do
             * `st_pou_registry` kiểm, vì chỉ nó biết chữ ký POU. */
            auto expression = std::make_unique<StExpr>();
            expression->kind = StExpr::Kind::USER_CALL;
            expression->user_call_name = node.type_ref;
            expression->args = std::move(arguments);
            return expression;
        }
        StFunc function;
        if (!st_func_from_name(node.type_ref, &function)) {
            fail("FBD-SEM-LIBRARY-UNSUPPORTED-001", node_path(network, node) + ".typeRef");
            return nullptr;
        }
        if (arguments.size() != static_cast<std::size_t>(st_func_arity(function))) {
            fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
            return nullptr;
        }
        auto expression = std::make_unique<StExpr>();
        expression->kind = StExpr::Kind::CALL;
        expression->func = function;
        expression->args = std::move(arguments);
        return expression;
    }

    std::unique_ptr<StExpr> conversion_expression(const FbdNetwork& network,
                                                  const FbdNode& node,
                                                  const FbdPort& output)
    {
        if (!node.parameters.empty()) {
            fail("FBD-SEM-PARAM-001", node_path(network, node) + ".parameters");
            return nullptr;
        }
        const auto inputs = ports_with_direction(node, FbdPortDirection::INPUT);
        const auto outputs = ports_with_direction(node, FbdPortDirection::OUTPUT);
        StFunc function;
        if (inputs.size() != 1 || outputs.size() != 1 || outputs[0]->id != output.id ||
            !st_func_from_name(node.type_ref, &function) || st_func_arity(function) != 1) {
            fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
            return nullptr;
        }
        auto argument = source_for_input(network, node, *inputs[0]);
        if (!argument) return nullptr;
        auto expression = std::make_unique<StExpr>();
        expression->kind = StExpr::Kind::CALL;
        expression->func = function;
        expression->args.push_back(std::move(argument));
        return expression;
    }

    std::unique_ptr<StExpr> expression_for_output(const FbdNetwork& network,
                                                  const FbdNode& node,
                                                  const FbdPort& output)
    {
        if (!visiting_.emplace(node.id).second) {
            fail("FBD-SEM-CYCLE-001", node_path(network, node));
            return nullptr;
        }
        std::unique_ptr<StExpr> result;
        switch (node.kind) {
        case FbdNodeKind::INPUT: {
            const std::string* name = string_parameter(node, "variable");
            if (!name) fail("FBD-SEM-PARAM-001", node_path(network, node) + ".parameters");
            else result = variable_expr(*name);
            break;
        }
        case FbdNodeKind::CONSTANT: {
            if (node.parameters.size() != 1) {
                fail("FBD-SEM-PARAM-001", node_path(network, node) + ".parameters");
                break;
            }
            StValue value;
            if (!parameter_to_literal(node, output.data_type, &value) ||
                node.type_ref != st_type_name(output.data_type)) {
                fail("FBD-SEM-PARAM-001", node_path(network, node) + ".parameters.value");
                break;
            }
            result = std::make_unique<StExpr>();
            result->kind = StExpr::Kind::LITERAL;
            result->literal = value;
            result->literal_polymorphic = false;
            break;
        }
        case FbdNodeKind::FUNCTION:
            result = function_expression(network, node, output);
            break;
        case FbdNodeKind::CONVERSION:
            result = conversion_expression(network, node, output);
            break;
        case FbdNodeKind::FUNCTION_BLOCK: {
            const auto found = fb_instance_.find(node.id);
            if (found == fb_instance_.end()) {
                fail("FBD-SEM-LIBRARY-UNSUPPORTED-001", node_path(network, node) + ".typeRef");
            } else {
                result = member_expr(found->second, output.name);
            }
            break;
        }
        case FbdNodeKind::OUTPUT:
            fail("FBD-SEM-PORT-SPEC-001", node_path(network, node) + ".ports");
            break;
        }
        visiting_.erase(node.id);
        locate_expression(result.get(), output);
        return result;
    }

    bool emit_fb_call(const FbdNetwork& network, const FbdNode& node)
    {
        const auto instance = fb_instance_.find(node.id);
        if (instance == fb_instance_.end()) {
            return fail("FBD-SEM-LIBRARY-UNSUPPORTED-001", node_path(network, node));
        }
        StStmt statement;
        statement.kind = StStmt::Kind::FB_CALL;
        statement.fb_instance = instance->second;
        const auto outputs = ports_with_direction(node, FbdPortDirection::OUTPUT);
        const auto inputs = ports_with_direction(node, FbdPortDirection::INPUT);
        const FbdPort* location_port = !outputs.empty() ? outputs.front()
                                       : (!inputs.empty() ? inputs.front() : nullptr);
        const FbdSourceAnchor* anchor =
            location_port ? anchor_for_port(*location_port) : nullptr;
        if (!anchor) return fail("FBD-LIMIT-SOURCEMAP-001", node_path(network, node));
        statement.fb_line = anchor->line;
        statement.fb_column = anchor->column;
        statement.fb_length = 1;
        for (const FbdPort* input : inputs) {
            auto value = source_for_input(network, node, *input);
            if (!value) return false;
            StFbArg argument;
            argument.name = input->name;
            argument.value = std::move(value);
            statement.fb_args.push_back(std::move(argument));
        }
        program_->body.push_back(std::move(statement));
        return true;
    }

    bool emit_output_assignment(const FbdNetwork& network, const FbdNode& node)
    {
        const std::string* variable = string_parameter(node, "variable");
        const auto inputs = ports_with_direction(node, FbdPortDirection::INPUT);
        if (!variable || inputs.size() != 1) {
            return fail("FBD-SEM-PORT-SPEC-001", node_path(network, node));
        }
        auto expression = source_for_input(network, node, *inputs[0]);
        if (!expression) return false;
        StStmt statement;
        statement.kind = StStmt::Kind::ASSIGN;
        statement.assign_target = *variable;
        const FbdSourceAnchor* anchor = anchor_for_port(*inputs[0]);
        if (!anchor) return fail("FBD-LIMIT-SOURCEMAP-001", node_path(network, node));
        statement.assign_target_line = anchor->line;
        statement.assign_target_column = anchor->column;
        statement.assign_target_length = 1;
        statement.assign_expr = std::move(expression);
        program_->body.push_back(std::move(statement));
        return true;
    }

    bool emit_body()
    {
        for (const auto& network : document_.networks) {
            for (const auto& node : network.nodes) {
                if (node.kind == FbdNodeKind::FUNCTION_BLOCK) {
                    if (!emit_fb_call(network, node)) return false;
                } else if (node.kind == FbdNodeKind::OUTPUT) {
                    if (!emit_output_assignment(network, node)) return false;
                }
            }
        }
        return true;
    }

    bool validate_all_producer_nodes()
    {
        for (const auto& network : document_.networks) {
            for (const auto& node : network.nodes) {
                if (node.kind == FbdNodeKind::OUTPUT) continue;
                const auto outputs = ports_with_direction(node, FbdPortDirection::OUTPUT);
                for (const FbdPort* output : outputs) {
                    if (!expression_for_output(network, node, *output)) return false;
                }
            }
        }
        return true;
    }
};

} // namespace

FbdLowerResult lower_fbd_source_to_program(std::string_view source)
{
    FbdLowerResult result;
    const FbdValidationResult validated = validate_and_canonicalize_fbd(source);
    if (!validated.ok) {
        result.issues = validated.issues;
        return result;
    }
    Lowerer lowerer(validated.document);
    if (!lowerer.run(&result.program)) {
        result.issues = lowerer.issues();
        return result;
    }
    result.ok = true;
    return result;
}

FbdCompileResult compile_fbd_source(std::string_view source)
{
    FbdCompileResult result;
    const FbdValidationResult validated = validate_and_canonicalize_fbd(source);
    if (!validated.ok) {
        result.issues = validated.issues;
        return result;
    }

    StProgram program;
    Lowerer lowerer(validated.document);
    if (!lowerer.run(&program)) {
        result.issues = lowerer.issues();
        return result;
    }

    StDiagnostic diagnostic;
    if (!typecheck_st_program(&program, &diagnostic)) {
        add_issue(&result.issues, "FBD-SEM-LOWER-001", "$.lowering." + diagnostic.code);
        return result;
    }

    StIrModule candidate;
    if (!compile_st_to_ir(program, validated.canonical_json, &candidate, &diagnostic)) {
        add_issue(&result.issues, "FBD-LIMIT-IR-001", "$.lowering." + diagnostic.code);
        return result;
    }
    result.module = std::move(candidate);
    result.canonical_source = validated.canonical_json;
    result.source_anchors = lowerer.source_anchors();
    result.ok = true;
    return result;
}

void normalize_ir_for_semantic_equivalence(StIrModule* module)
{
    if (!module) return;
    module->source_hash = 0;
    module->build_timestamp = 0;
    module->source_map.clear();
}

bool fbd_ir_semantically_equivalent(const StIrModule& lhs, const StIrModule& rhs,
                                    std::string* reason)
{
    StIrModule normalized_lhs = lhs;
    StIrModule normalized_rhs = rhs;
    normalize_ir_for_semantic_equivalence(&normalized_lhs);
    normalize_ir_for_semantic_equivalence(&normalized_rhs);
    std::vector<uint8_t> lhs_bytes;
    std::vector<uint8_t> rhs_bytes;
    std::string serialization_error;
    if (!serialize_st_ir(normalized_lhs, &lhs_bytes, &serialization_error) ||
        !serialize_st_ir(normalized_rhs, &rhs_bytes, &serialization_error)) {
        if (reason) *reason = "FBD-EQUIV-SERIALIZE-001";
        return false;
    }
    if (lhs_bytes != rhs_bytes) {
        if (reason) *reason = "FBD-EQUIV-BYTES-001";
        return false;
    }
    if (reason) reason->clear();
    return true;
}

} // namespace core
