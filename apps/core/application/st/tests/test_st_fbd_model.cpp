#include <gtest/gtest.h>

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>

#include <nlohmann/json.hpp>

#include "st/st_fbd_model.hpp"

namespace core {
namespace {

using json = nlohmann::json;

std::string read_golden()
{
    std::ifstream input(std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) +
                        "/fbd/golden/ahu_fan_enable.json");
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

bool has_issue(const FbdValidationResult& result, const std::string& code)
{
    return std::any_of(result.issues.begin(), result.issues.end(), [&](const FbdIssue& issue) {
        return issue.code == code;
    });
}

TEST(StFbdModel, GoldenIsValidAndCanonicalByteStable)
{
    const auto first = validate_and_canonicalize_fbd(read_golden());
    ASSERT_TRUE(first.ok);
    ASSERT_TRUE(first.issues.empty());
    ASSERT_EQ(first.document.networks.size(), 1u);
    EXPECT_EQ(first.document.networks[0].nodes.size(), 4u);
    EXPECT_EQ(first.document.networks[0].wires.size(), 3u);
    const auto variable = first.document.networks[0].nodes[0].parameters.find("variable");
    ASSERT_NE(variable, first.document.networks[0].nodes[0].parameters.end());
    ASSERT_NE(std::get_if<std::string>(&variable->second), nullptr);
    EXPECT_EQ(*std::get_if<std::string>(&variable->second), "OCCUPIED");

    json reordered = json::parse(read_golden());
    std::reverse(reordered["networks"][0]["nodes"].begin(),
                 reordered["networks"][0]["nodes"].end());
    std::reverse(reordered["networks"][0]["wires"].begin(),
                 reordered["networks"][0]["wires"].end());
    for (auto& node : reordered["networks"][0]["nodes"]) {
        std::reverse(node["ports"].begin(), node["ports"].end());
    }
    const auto second = validate_and_canonicalize_fbd(reordered.dump(2));
    ASSERT_TRUE(second.ok);
    EXPECT_EQ(first.canonical_json, second.canonical_json);
}

TEST(StFbdModel, RejectsUnknownRootAndWrongProfile)
{
    json source = json::parse(read_golden());
    source["hostPath"] = "/tmp/source";
    auto result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SCHEMA-ROOT-001"));

    source = json::parse(read_golden());
    source["profileId"] = "attacker-profile";
    result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SCHEMA-ROOT-001"));
}

TEST(StFbdModel, RejectsDanglingWrongDirectionTypeAndDuplicateDriver)
{
    json source = json::parse(read_golden());
    source["networks"][0]["wires"][0]["from"]["portId"] =
        "ffffffff-ffff-4fff-8fff-ffffffffffff";
    auto result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-WIRE-001"));

    source = json::parse(read_golden());
    source["networks"][0]["nodes"][2]["ports"][0]["dataType"] = "REAL";
    result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-WIRE-001"));

    source = json::parse(read_golden());
    json duplicate = source["networks"][0]["wires"][0];
    duplicate["id"] = "50000000-0000-4000-8000-000000000004";
    duplicate["from"] = source["networks"][0]["wires"][1]["from"];
    source["networks"][0]["wires"].push_back(duplicate);
    result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-WIRE-001"));
}

TEST(StFbdModel, RejectsDuplicateOrderAndBackwardCombinationalEdge)
{
    json source = json::parse(read_golden());
    source["networks"][0]["nodes"][1]["executionOrder"] = 0;
    auto result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-NODE-001"));

    source = json::parse(read_golden());
    source["networks"][0]["nodes"][2]["executionOrder"] = 3;
    source["networks"][0]["nodes"][3]["executionOrder"] = 2;
    result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-ORDER-001"));
}

TEST(StFbdModel, RejectsKindTypeRefAndPortShapeMismatch)
{
    json source = json::parse(read_golden());
    source["networks"][0]["nodes"][2]["typeRef"] = "TON";
    auto result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-TYPE-REF-001"));

    source = json::parse(read_golden());
    source["networks"][0]["nodes"][0]["ports"][0]["direction"] = "INPUT";
    result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-PORT-SHAPE-001"));
}

TEST(StFbdModel, RejectsDuplicateJsonObjectKey)
{
    std::string source = read_golden();
    const std::string needle = "\"schemaVersion\": 1,";
    const auto position = source.find(needle);
    ASSERT_NE(position, std::string::npos);
    source.insert(position + needle.size(), " \"schemaVersion\": 1,");
    const auto result = validate_and_canonicalize_fbd(source);
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SCHEMA-JSON-DUP-001"));
}

TEST(StFbdModel, RejectsLimitAndNonCanonicalUuid)
{
    json source = json::parse(read_golden());
    source["graphId"] = "10000000-0000-4000-8000-00000000000A";
    auto result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SCHEMA-ROOT-001"));

    source = json::parse(read_golden());
    const json base_node = source["networks"][0]["nodes"][0];
    source["networks"][0]["nodes"] = json::array();
    for (std::size_t index = 0; index < 257; ++index) {
        json node = base_node;
        char id[37];
        std::snprintf(id, sizeof(id), "3%07zx-0000-4000-8000-%012zx", index, index);
        char port_id[37];
        std::snprintf(port_id, sizeof(port_id), "4%07zx-0000-4000-8000-%012zx", index, index);
        node["id"] = id;
        node["executionOrder"] = index % 256;
        node["ports"][0]["id"] = port_id;
        source["networks"][0]["nodes"].push_back(node);
    }
    source["networks"][0]["wires"] = json::array();
    result = validate_and_canonicalize_fbd(source.dump());
    EXPECT_FALSE(result.ok);
    // JSON tối thiểu của 257 block có thể chạm trần source 64 KiB trước trần
    // block; cả hai đều là reject fail-closed hợp lệ và không dựng document.
    EXPECT_TRUE(has_issue(result, "FBD-LIMIT-BLOCK-001") ||
                has_issue(result, "FBD-SCHEMA-SIZE-001"));
}

TEST(StFbdModel, RejectsOversizeBeforeJsonParsing)
{
    const std::string oversized(65537, ' ');
    const auto result = validate_and_canonicalize_fbd(oversized);
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SCHEMA-SIZE-001"));
}

} // namespace
} // namespace core
