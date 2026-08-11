#include <gtest/gtest.h>

#include <algorithm>
#include <fstream>
#include <iterator>
#include <string>

#include <nlohmann/json.hpp>

#include "st/st_artifact.hpp"
#include "st/st_artifact_manifest.hpp"

namespace core {
namespace {

using json = nlohmann::json;

std::string read_text(const std::string& path)
{
    std::ifstream input(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(input),
                       std::istreambuf_iterator<char>());
}

std::string fbd_golden()
{
    return read_text(std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) +
                     "/fbd/golden/ahu_fan_enable.json");
}

const char* kStSource = R"ST(PROGRAM MANIFEST_CASE
VAR_INPUT ENABLE : BOOL; END_VAR
VAR_OUTPUT COMMAND : BOOL; END_VAR
COMMAND := ENABLE;
END_PROGRAM
)ST";

void expect_verify(const StArtifactBuildResult& build, const char* source_id)
{
    StManifestVerificationSummary summary;
    StManifestError error;
    ASSERT_TRUE(VerifyArtifactManifest(build.manifest_json, build.canonical_source,
                                       build.artifact.data(), build.artifact.size(),
                                       &summary, &error))
        << error.code << ": " << error.message;
    EXPECT_EQ(summary.source_id, source_id);
    EXPECT_EQ(summary.canonical_source_sha256, build.canonical_source_sha256);
    EXPECT_EQ(summary.artifact_file_sha256, build.artifact_file_sha256);
    EXPECT_EQ(summary.build_key_sha256, build.build_key_sha256);
    EXPECT_EQ(summary.source_map_entries, build.module.source_map.size());
}

void expect_manifest_reject(const StArtifactBuildResult& build, json manifest,
                            const char* expected_code)
{
    StManifestVerificationSummary summary;
    summary.source_id = "khong-duoc-doi";
    StManifestError error;
    EXPECT_FALSE(VerifyArtifactManifest(manifest.dump(), build.canonical_source,
                                        build.artifact.data(), build.artifact.size(),
                                        &summary, &error));
    EXPECT_EQ(error.code, expected_code);
    EXPECT_EQ(summary.source_id, "khong-duoc-doi")
        << "verifier reject không được sửa output caller";
}

} // namespace

TEST(StArtifactManifest, StructuredTextBuildIsByteAndManifestDeterministic)
{
    StArtifactBuildResult expected;
    StManifestError error;
    ASSERT_TRUE(BuildStArtifact("program-main", kStSource, &expected, &error))
        << error.code << ": " << error.message;
    ASSERT_EQ(expected.canonical_source_sha256.size(), 64u);
    ASSERT_EQ(expected.artifact_file_sha256.size(), 64u);
    ASSERT_EQ(expected.artifact_integrity_sha256.size(), 64u);
    ASSERT_EQ(expected.build_key_sha256.size(), 64u);
    EXPECT_NE(expected.artifact_file_sha256, expected.artifact_integrity_sha256)
        << "hash file và digest integrity phải có tên/nghĩa tách biệt";

    for (int iteration = 0; iteration < 100; ++iteration) {
        StArtifactBuildResult actual;
        ASSERT_TRUE(BuildStArtifact("program-main", kStSource, &actual, &error));
        EXPECT_EQ(actual.artifact, expected.artifact) << iteration;
        EXPECT_EQ(actual.manifest_json, expected.manifest_json) << iteration;
    }
    expect_verify(expected, "program-main");
}

TEST(StArtifactManifest, FbdCanonicalReorderingKeepsArtifactManifestAndRichLocations)
{
    const std::string source = fbd_golden();
    ASSERT_FALSE(source.empty());
    StArtifactBuildResult expected;
    StManifestError error;
    ASSERT_TRUE(BuildFbdArtifact("fbd-main", source, &expected, &error))
        << error.code << ": " << error.message;
    ASSERT_FALSE(expected.module.source_map.empty());

    json reordered = json::parse(source);
    std::reverse(reordered["networks"][0]["nodes"].begin(),
                 reordered["networks"][0]["nodes"].end());
    std::reverse(reordered["networks"][0]["wires"].begin(),
                 reordered["networks"][0]["wires"].end());
    StArtifactBuildResult actual;
    ASSERT_TRUE(BuildFbdArtifact("fbd-main", reordered.dump(2), &actual, &error))
        << error.code << ": " << error.message;
    EXPECT_EQ(actual.canonical_source, expected.canonical_source);
    EXPECT_EQ(actual.artifact, expected.artifact);
    EXPECT_EQ(actual.manifest_json, expected.manifest_json);

    const json manifest = json::parse(expected.manifest_json);
    const json& entries = manifest.at("sourceMap").at("entries");
    ASSERT_EQ(entries.size(), expected.module.source_map.size());
    for (const json& entry : entries) {
        EXPECT_TRUE(entry.at("textLocation").is_null());
        ASSERT_TRUE(entry.at("fbdLocation").is_object());
        EXPECT_EQ(entry.at("fbdLocation").at("networkId"),
                  "20000000-0000-4000-8000-000000000001");
        EXPECT_FALSE(entry.at("fbdLocation").at("nodeId").get<std::string>().empty());
        EXPECT_FALSE(entry.at("fbdLocation").at("portId").get<std::string>().empty());
    }
    expect_verify(expected, "fbd-main");
}

TEST(StArtifactManifest, FbdUnitAnnotationIsPreservedOutsideExecutableIr)
{
    json graph = json::parse(fbd_golden());
    for (json& node : graph["networks"][0]["nodes"])
        for (json& port : node["ports"]) port["unit"] = "state";

    StArtifactBuildResult with_unit;
    StManifestError error;
    ASSERT_TRUE(BuildFbdArtifact("fbd-unit", graph.dump(), &with_unit, &error))
        << error.code << ": " << error.message;
    const json manifest = json::parse(with_unit.manifest_json);
    ASSERT_FALSE(manifest.at("sourceMap").at("entries").empty());
    for (const json& entry : manifest.at("sourceMap").at("entries"))
        EXPECT_EQ(entry.at("unit"), "state");
    expect_verify(with_unit, "fbd-unit");
}

TEST(StArtifactManifest, RejectsUnknownVersionProfileHashSourceAndSourceMap)
{
    StArtifactBuildResult build;
    StManifestError error;
    ASSERT_TRUE(BuildStArtifact("program-main", kStSource, &build, &error));
    const json valid = json::parse(build.manifest_json);

    json mutation = valid;
    mutation["manifestVersion"] = 2;
    expect_manifest_reject(build, mutation, st_manifest_error::kVersion);

    mutation = valid;
    mutation["profile"]["id"] = "unknown-profile";
    expect_manifest_reject(build, mutation, st_manifest_error::kProfile);

    mutation = valid;
    mutation["artifact"]["fileSha256"] = std::string(64, '0');
    expect_manifest_reject(build, mutation, st_manifest_error::kHash);

    mutation = valid;
    ASSERT_FALSE(mutation["sourceMap"]["entries"].empty());
    mutation["sourceMap"]["entries"][0]["pc"] = 4095;
    expect_manifest_reject(build, mutation, st_manifest_error::kSourceMap);

    StManifestVerificationSummary summary;
    summary.source_id = "giu-nguyen";
    EXPECT_FALSE(VerifyArtifactManifest(build.manifest_json,
                                        build.canonical_source + " ", build.artifact.data(),
                                        build.artifact.size(), &summary, &error));
    EXPECT_EQ(error.code, st_manifest_error::kSource);
    EXPECT_EQ(summary.source_id, "giu-nguyen");
}

TEST(StArtifactManifest, SourceIdRejectsHostPathAndDoesNotPublishPartialOutput)
{
    StArtifactBuildResult output;
    output.canonical_source_sha256 = "giu-nguyen";
    StManifestError error;
    EXPECT_FALSE(BuildStArtifact("../../etc/passwd", kStSource, &output, &error));
    EXPECT_EQ(error.code, st_manifest_error::kRequest);
    EXPECT_EQ(output.canonical_source_sha256, "giu-nguyen");
}

TEST(StArtifactManifest, LegacyValidateHashNameNowReturnsSha256)
{
    const std::string digest = compute_artifact_hash(kStSource);
    EXPECT_EQ(digest.size(), 64u);
    EXPECT_TRUE(std::all_of(digest.begin(), digest.end(), [](char value) {
        return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f');
    }));
    EXPECT_EQ(digest, compute_source_sha256(kStSource));
    EXPECT_STREQ(kStCompilerVersion, st_ir::kCompilerVersion);
    EXPECT_EQ(kStIrSchemaVersion, st_ir::kSchemaVersion);
}

} // namespace core
