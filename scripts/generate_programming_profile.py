#!/usr/bin/env python3
"""Sinh hằng profile Programming cho C++, Go và TypeScript từ một nguồn.

Profile machine-readable là source of truth duy nhất cho capacity sản phẩm.
Trước đây chỉ C++ được sinh, còn Go/TS chép tay `profileId`, `profileSha256` và
giới hạn — nên mỗi lần profile đổi, ba lớp trôi khỏi nhau mà không gate nào bắt.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from typing import Any

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "contracts/programming/product_profile_v2.json"
SCHEMA = ROOT / "contracts/programming/product_profile_v2.schema.json"
CPP_OUTPUT = ROOT / "apps/core/application/st/st_profile_generated.hpp"
GO_OUTPUT = ROOT / "apps/web-api/internal/programming/domain/profile_generated.go"
TS_OUTPUT = ROOT / "apps/web-ui/src/features/programming/api/generated/profile.ts"

TYPE_ORDER = ["BOOL", "INT", "DINT", "UINT", "REAL", "TIME"]

REGISTRY = ROOT / "contracts/programming/pou_library_registry_v1.json"

# Miền của token phê duyệt Controls/Safety. Nó cố ý gắn `libraryVersion`: một
# lần đổi semantics của entry (kể cả khi giữ nguyên tên) phải làm token cũ mất
# hiệu lực, nếu không phê duyệt cho bản cũ sẽ âm thầm áp cho bản mới.
APPROVAL_TOKEN_DOMAIN = "mkddc-controls-safety-approval:v1"


def approval_token(feature_id: str, library_version: str, evidence_ref: str) -> str:
    payload = ":".join([APPROVAL_TOKEN_DOMAIN, feature_id, library_version, evidence_ref])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load() -> tuple[dict[str, Any], str]:
    raw = PROFILE.read_bytes()
    profile = json.loads(raw)
    schema = json.loads(SCHEMA.read_bytes())
    problems = sorted(
        Draft202012Validator(schema).iter_errors(profile),
        key=lambda item: list(item.absolute_path),
    )
    if problems:
        joined = "; ".join(
            f"{'/'.join(str(part) for part in item.absolute_path) or '<root>'}: {item.message}"
            for item in problems
        )
        raise ValueError(f"profile không khớp schema: {joined}")
    validate(profile)
    return profile, hashlib.sha256(raw).hexdigest()


def validate(profile: dict[str, Any]) -> None:
    """Bất biến không thể diễn đạt bằng JSON Schema thuần."""
    capacity = profile["capacity"]
    scheduler = profile["scheduler"]
    resources = profile["resources"]

    if profile["version"]["major"] != 2:
        raise ValueError("profile phải là major 2")
    if capacity["maxProgramsEnabled"] > capacity["maxProgramsTotal"]:
        raise ValueError("maxProgramsEnabled không được lớn hơn maxProgramsTotal")
    if scheduler["maxProgramsTotal"] != capacity["maxProgramsTotal"]:
        raise ValueError("scheduler.maxProgramsTotal phải bằng capacity.maxProgramsTotal")
    if scheduler["maxProgramsPerTask"] > capacity["maxProgramsTotal"]:
        raise ValueError("maxProgramsPerTask không được lớn hơn tổng Program")
    if scheduler["maxTasks"] != len(scheduler["allowedPeriodMs"]):
        raise ValueError("maxTasks phải bằng số lớp chu kỳ trong allowedPeriodMs")
    if sorted(set(scheduler["allowedPeriodMs"])) != scheduler["allowedPeriodMs"]:
        raise ValueError("allowedPeriodMs phải tăng dần và không trùng")
    if resources["maxBindings"] > capacity["maxBindings"]:
        raise ValueError("trần binding của một Program vượt trần package")
    if resources["maxWritableSlots"] > resources["maxSlots"]:
        raise ValueError("maxWritableSlots vượt maxSlots")
    names = [item["name"] for item in profile["types"]]
    if names != TYPE_ORDER:
        raise ValueError(f"thứ tự type phải là {TYPE_ORDER}")
    if len({item["wireCode"] for item in profile["types"]}) != len(names):
        raise ValueError("wireCode bị trùng")
    validate_review_gated(profile)


def validate_review_gated(profile: dict[str, Any]) -> None:
    """Feature REVIEW_REQUIRED và token phê duyệt phải khớp registry, không tự khai.

    Ba luật này không diễn đạt được bằng JSON Schema vì chúng nối hai contract:
    profile và registry POU/Control Library.
    """
    registry = json.loads(REGISTRY.read_bytes())
    library_version = registry["libraryVersion"]
    if library_version != profile["coreLibrary"]["version"]:
        raise ValueError("libraryVersion của registry lệch profile")
    review_required = {
        entry["id"] for entry in registry["entries"]
        if entry.get("featureState") == "REVIEW_REQUIRED"
    }
    declared = {item["featureId"] for item in profile["reviewGatedFeatures"]}
    if len(declared) != len(profile["reviewGatedFeatures"]):
        raise ValueError("reviewGatedFeatures có featureId trùng")
    # Hai chiều: entry REVIEW_REQUIRED phải được khai, và feature đã khai phải
    # thật sự là REVIEW_REQUIRED. Bỏ một chiều thì hoặc feature mới lọt qua gate
    # không ai chặn, hoặc một feature đã được duyệt vẫn bị chặn vĩnh viễn.
    if declared != review_required:
        raise ValueError(
            f"reviewGatedFeatures={sorted(declared)} lệch registry REVIEW_REQUIRED={sorted(review_required)}"
        )
    for item in profile["reviewGatedFeatures"]:
        if item["registryEntryId"] != item["featureId"]:
            raise ValueError(f"{item['featureId']}: registryEntryId phải trỏ đúng entry")
        has_ref = item["approvalEvidenceRef"] is not None
        has_token = item["approvalToken"] is not None
        if has_ref != has_token:
            raise ValueError(
                f"{item['featureId']}: approvalEvidenceRef và approvalToken phải cùng có hoặc cùng rỗng"
            )
        if not has_token:
            continue
        expected = approval_token(item["featureId"], library_version, item["approvalEvidenceRef"])
        if item["approvalToken"] != expected:
            raise ValueError(
                f"{item['featureId']}: approvalToken không suy ra từ contract "
                f"(kỳ vọng {expected})"
            )


def review_gated_cpp(profile: dict[str, Any]) -> str:
    rows = []
    for item in profile["reviewGatedFeatures"]:
        approved = "true" if item["approvalToken"] else "false"
        token = item["approvalToken"] or ""
        rows.append(
            f'    ReviewGatedFeature{{"{item["featureId"]}", {approved}, "{token}"}},'
        )
    return "\n".join(rows)


def render_cpp(profile: dict[str, Any], profile_hash: str) -> str:
    scheduler = profile["scheduler"]
    capacity = profile["capacity"]
    resource = profile["resources"]
    types = {item["name"]: item for item in profile["types"]}
    periods = ", ".join(f"{value}u" for value in scheduler["allowedPeriodMs"])
    return f"""// GENERATED bởi scripts/generate_programming_profile.py; không sửa tay.
#ifndef CORE_ST_PROFILE_GENERATED_HPP
#define CORE_ST_PROFILE_GENERATED_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace core::st_profile_generated {{
inline constexpr const char* kProfileId = \"{profile['profileId']}\";
inline constexpr uint16_t kProfileCode = {profile['profileCode']}u;
inline constexpr uint32_t kTargetAbi = {profile['targetAbi']}u;
inline constexpr uint16_t kProfileMajor = {profile['version']['major']}u;
inline constexpr uint16_t kProfileMinor = {profile['version']['minor']}u;
inline constexpr const char* kProfileSha256 = \"{profile_hash}\";
inline constexpr const char* kLibraryVersion = \"{profile['coreLibrary']['version']}\";
inline constexpr const char* kIntegrityMode = \"{profile['integrityMode']}\";
inline constexpr uint8_t kBoolWireCode = {types['BOOL']['wireCode']}u;
inline constexpr uint8_t kIntWireCode = {types['INT']['wireCode']}u;
inline constexpr uint8_t kDintWireCode = {types['DINT']['wireCode']}u;
inline constexpr uint8_t kUintWireCode = {types['UINT']['wireCode']}u;
inline constexpr uint8_t kRealWireCode = {types['REAL']['wireCode']}u;
inline constexpr uint8_t kTimeWireCode = {types['TIME']['wireCode']}u;
inline constexpr uint8_t kBoolWidthBits = {types['BOOL']['widthBits']}u;
inline constexpr uint8_t kIntWidthBits = {types['INT']['widthBits']}u;
inline constexpr uint8_t kDintWidthBits = {types['DINT']['widthBits']}u;
inline constexpr uint8_t kUintWidthBits = {types['UINT']['widthBits']}u;
inline constexpr uint8_t kRealWidthBits = {types['REAL']['widthBits']}u;
inline constexpr uint8_t kTimeWidthBits = {types['TIME']['widthBits']}u;
inline constexpr std::size_t kMaxTasks = {scheduler['maxTasks']}u;
inline constexpr std::size_t kMaxProgramsPerTask = {scheduler['maxProgramsPerTask']}u;
inline constexpr std::size_t kMaxProgramsTotal = {scheduler['maxProgramsTotal']}u;
inline constexpr uint32_t kMaxTaskBudgetPercent = {scheduler['maxTaskBudgetPercent']}u;
inline constexpr std::array<uint32_t, {len(scheduler['allowedPeriodMs'])}> kAllowedPeriodMs = {{{periods}}};
inline constexpr std::size_t kMaxObjects = {capacity['maxObjects']}u;
inline constexpr std::size_t kMaxProgramsEnabled = {capacity['maxProgramsEnabled']}u;
inline constexpr std::size_t kMaxUserPou = {capacity['maxUserPou']}u;
inline constexpr std::size_t kMaxFunctionBlockInstances = {capacity['maxFunctionBlockInstances']}u;
inline constexpr std::size_t kMaxSignals = {capacity['maxSignals']}u;
inline constexpr std::size_t kMaxPackageBindings = {capacity['maxBindings']}u;
inline constexpr std::size_t kMaxSourceBytes = {resource['maxSourceBytes']}u;
inline constexpr std::size_t kMaxVariables = {resource['maxVariables']}u;
inline constexpr std::size_t kMaxStatements = {resource['maxStatements']}u;
inline constexpr std::size_t kMaxFbdBlocks = {resource['maxFbdBlocks']}u;
inline constexpr std::size_t kMaxFbdConnections = {resource['maxFbdConnections']}u;
inline constexpr std::size_t kMaxArtifactBytes = {resource['maxArtifactBytes']}u;
inline constexpr std::size_t kMaxInstructions = {resource['maxInstructions']}u;
inline constexpr std::size_t kMaxSlots = {resource['maxSlots']}u;
inline constexpr std::size_t kMaxWritableSlots = {resource['maxWritableSlots']}u;
inline constexpr std::size_t kMaxConstants = {resource['maxConstants']}u;
inline constexpr std::size_t kMaxFunctionBlocks = {resource['maxFunctionBlocks']}u;
inline constexpr std::size_t kMaxBindings = {resource['maxBindings']}u;
inline constexpr std::size_t kMaxRetainVariables = {resource['maxRetainVariables']}u;
inline constexpr std::size_t kMaxRetainBytes = {resource['maxRetainBytes']}u;
inline constexpr std::size_t kMaxSections = {resource['maxSections']}u;

/* Feature giữ nhãn REVIEW_REQUIRED trong registry POU/Control Library.
 * `approved=false` nghĩa là Check PHẢI từ chối mọi Program dùng feature này.
 * Token không đến từ payload hay UI: nó suy ra từ chính contract profile và
 * generator từ chối mọi token không suy ra đúng. */
struct ReviewGatedFeature {{
    std::string_view feature_id;
    bool approved;
    std::string_view approval_token;
}};
inline constexpr std::array<ReviewGatedFeature, {len(profile['reviewGatedFeatures'])}> kReviewGatedFeatures = {{{{
{review_gated_cpp(profile)}
}}}};

/* Trả true khi feature bị chặn Check. Tên không có trong bảng là feature không
 * bị gate — mặc định KHÔNG chặn, vì chặn một thứ chưa ai khai là chặn mù. */
inline constexpr bool review_gate_blocks(std::string_view feature_id)
{{
    for (const ReviewGatedFeature& item : kReviewGatedFeatures)
        if (item.feature_id == feature_id) return !item.approved;
    return false;
}}
}} // namespace core::st_profile_generated

#endif // CORE_ST_PROFILE_GENERATED_HPP
"""


def render_go(profile: dict[str, Any], profile_hash: str) -> str:
    scheduler = profile["scheduler"]
    capacity = profile["capacity"]
    resource = profile["resources"]
    periods = ", ".join(str(value) for value in scheduler["allowedPeriodMs"])
    source = f"""// Code generated by scripts/generate_programming_profile.py; DO NOT EDIT.
package domain

// ProfileID, ProfileCode và ProfileSHA256 là token phân biệt profile mà compiler
// CLI trả về; consumer phải so đúng các hằng này thay vì chép chuỗi.
const (
\tProfileID        = "{profile['profileId']}"
\tProfileCode      = {profile['profileCode']}
\tProfileTargetABI = {profile['targetAbi']}
\tProfileMajor     = {profile['version']['major']}
\tProfileMinor     = {profile['version']['minor']}
\tProfileSHA256    = "{profile_hash}"
\tProfileLibraryVersion = "{profile['coreLibrary']['version']}"
\tProfileIntegrityMode  = "{profile['integrityMode']}"
)

// Trần cấp package/Revision.
const (
\tMaxObjects                = {capacity['maxObjects']}
\tMaxProgramsTotal          = {capacity['maxProgramsTotal']}
\tMaxProgramsEnabled        = {capacity['maxProgramsEnabled']}
\tMaxUserPou                = {capacity['maxUserPou']}
\tMaxFunctionBlockInstances = {capacity['maxFunctionBlockInstances']}
\tMaxSignals                = {capacity['maxSignals']}
\tMaxPackageBindings        = {capacity['maxBindings']}
)

// Trần cấp một Program/artifact.
const (
\tMaxSourceBytes     = {resource['maxSourceBytes']}
\tMaxVariables       = {resource['maxVariables']}
\tMaxStatements      = {resource['maxStatements']}
\tMaxFbdBlocks       = {resource['maxFbdBlocks']}
\tMaxFbdConnections  = {resource['maxFbdConnections']}
\tMaxProfileArtifactBytes = {resource['maxArtifactBytes']}
\tMaxInstructions    = {resource['maxInstructions']}
\tMaxSlots           = {resource['maxSlots']}
\tMaxWritableSlots   = {resource['maxWritableSlots']}
\tMaxConstants       = {resource['maxConstants']}
\tMaxFunctionBlocks  = {resource['maxFunctionBlocks']}
\tMaxProgramBindings = {resource['maxBindings']}
\tMaxRetainVariables = {resource['maxRetainVariables']}
\tMaxRetainBytes     = {resource['maxRetainBytes']}
\tMaxSections        = {resource['maxSections']}
)

// Trần scheduler.
const (
\tMaxTasks             = {scheduler['maxTasks']}
\tMaxProgramsPerTask   = {scheduler['maxProgramsPerTask']}
\tMaxTaskBudgetPercent = {scheduler['maxTaskBudgetPercent']}
)

// AllowedPeriodMs giữ đúng thứ tự tăng dần trong profile.
var AllowedPeriodMs = [{len(scheduler['allowedPeriodMs'])}]int64{{{periods}}}

// ProfileLanguages và ProfilePointKinds giữ đúng thứ tự canonical.
var (
\tProfileLanguages  = {go_string_array(profile['languages'])}
\tProfilePointKinds = {go_string_array(profile['pointKinds'])}
)

// ReviewGatedFeature là feature giữ nhãn REVIEW_REQUIRED trong registry.
// Approved=false nghĩa là Check phải từ chối mọi Program dùng nó. Token không
// đến từ payload hay UI — nó suy ra từ chính contract profile.
type ReviewGatedFeature struct {{
\tFeatureID     string
\tApproved      bool
\tApprovalToken string
}}

var ReviewGatedFeatures = [{len(profile['reviewGatedFeatures'])}]ReviewGatedFeature{{
{review_gated_go(profile)}
}}

// ReviewGateBlocks trả true khi feature bị chặn Check. Tên không có trong bảng
// là feature không bị gate — chặn một thứ chưa ai khai là chặn mù.
func ReviewGateBlocks(featureID string) bool {{
\tfor _, item := range ReviewGatedFeatures {{
\t\tif item.FeatureID == featureID {{
\t\t\treturn !item.Approved
\t\t}}
\t}}
\treturn false
}}
"""
    # gofmt là authority định dạng Go: sinh thô rồi format, để `--check` không
    # bao giờ đối đầu với `gofmt -l` trong gate.
    return subprocess.run(
        ["gofmt"], input=source, text=True, capture_output=True, check=True
    ).stdout


def review_gated_go(profile: dict[str, Any]) -> str:
    rows = []
    for item in profile["reviewGatedFeatures"]:
        approved = "true" if item["approvalToken"] else "false"
        token = json.dumps(item["approvalToken"] or "")
        rows.append(f'\t{{FeatureID: {json.dumps(item["featureId"])}, Approved: {approved}, ApprovalToken: {token}}},')
    return "\n".join(rows)


def go_string_array(values: list[str]) -> str:
    body = ", ".join(json.dumps(value) for value in values)
    return f"[{len(values)}]string{{{body}}}"


def render_ts(profile: dict[str, Any], profile_hash: str) -> str:
    scheduler = profile["scheduler"]
    capacity = profile["capacity"]
    resource = profile["resources"]
    periods = ", ".join(str(value) for value in scheduler["allowedPeriodMs"])
    languages = ", ".join(json.dumps(value) for value in profile["languages"])
    kinds = ", ".join(json.dumps(value) for value in profile["pointKinds"])
    types = "\n".join(
        f"  {{ name: {json.dumps(item['name'])}, widthBits: {item['widthBits']}, "
        f"wireCode: {item['wireCode']} }},"
        for item in profile["types"]
    )
    return f"""// Tệp sinh tự động bởi scripts/generate_programming_profile.py. Không sửa bằng tay.
export const PROGRAMMING_PROFILE_ID = {json.dumps(profile['profileId'])} as const;
export const PROGRAMMING_PROFILE_CODE = {profile['profileCode']} as const;
export const PROGRAMMING_TARGET_ABI = {profile['targetAbi']} as const;
export const PROGRAMMING_PROFILE_MAJOR = {profile['version']['major']} as const;
export const PROGRAMMING_PROFILE_MINOR = {profile['version']['minor']} as const;
export const PROGRAMMING_PROFILE_SHA256 = {json.dumps(profile_hash)} as const;
export const PROGRAMMING_LIBRARY_VERSION = {json.dumps(profile['coreLibrary']['version'])} as const;

/** Trần cấp package/Revision. */
export const PROGRAMMING_CAPACITY = {{
  maxObjects: {capacity['maxObjects']},
  maxProgramsTotal: {capacity['maxProgramsTotal']},
  maxProgramsEnabled: {capacity['maxProgramsEnabled']},
  maxUserPou: {capacity['maxUserPou']},
  maxFunctionBlockInstances: {capacity['maxFunctionBlockInstances']},
  maxSignals: {capacity['maxSignals']},
  maxBindings: {capacity['maxBindings']},
}} as const;

/** Trần cấp một Program/artifact. */
export const PROGRAMMING_RESOURCES = {{
  maxSourceBytes: {resource['maxSourceBytes']},
  maxVariables: {resource['maxVariables']},
  maxStatements: {resource['maxStatements']},
  maxFbdBlocks: {resource['maxFbdBlocks']},
  maxFbdConnections: {resource['maxFbdConnections']},
  maxArtifactBytes: {resource['maxArtifactBytes']},
  maxInstructions: {resource['maxInstructions']},
  maxSlots: {resource['maxSlots']},
  maxWritableSlots: {resource['maxWritableSlots']},
  maxConstants: {resource['maxConstants']},
  maxFunctionBlocks: {resource['maxFunctionBlocks']},
  maxBindings: {resource['maxBindings']},
  maxRetainVariables: {resource['maxRetainVariables']},
  maxRetainBytes: {resource['maxRetainBytes']},
  maxSections: {resource['maxSections']},
}} as const;

export const PROGRAMMING_SCHEDULER = {{
  maxTasks: {scheduler['maxTasks']},
  maxProgramsPerTask: {scheduler['maxProgramsPerTask']},
  maxProgramsTotal: {scheduler['maxProgramsTotal']},
  maxTaskBudgetPercent: {scheduler['maxTaskBudgetPercent']},
}} as const;

export const PROGRAMMING_ALLOWED_PERIOD_MS = [{periods}] as const;
export const PROGRAMMING_LANGUAGES = [{languages}] as const;
export const PROGRAMMING_POINT_KINDS = [{kinds}] as const;

export const PROGRAMMING_TYPES = [
{types}
] as const;

// Feature giữ nhãn REVIEW_REQUIRED trong registry POU/Control Library.
// `approved: false` nghĩa là Check chặn; FE chỉ HIỂN THỊ trạng thái này và
// không được coi một checkbox nào là phê duyệt.
export const PROGRAMMING_REVIEW_GATED_FEATURES = [
{review_gated_ts(profile)}
] as const;
"""


def review_gated_ts(profile: dict[str, Any]) -> str:
    rows = []
    for item in profile["reviewGatedFeatures"]:
        approved = "true" if item["approvalToken"] else "false"
        rows.append(
            f'  {{ featureId: {json.dumps(item["featureId"])}, approved: {approved}, '
            f'approvalToken: {json.dumps(item["approvalToken"] or "")} }},'
        )
    return "\n".join(rows)


def outputs() -> list[tuple[Path, str]]:
    profile, profile_hash = load()
    return [
        (CPP_OUTPUT, render_cpp(profile, profile_hash)),
        (GO_OUTPUT, render_go(profile, profile_hash)),
        (TS_OUTPUT, render_ts(profile, profile_hash)),
    ]


def self_test() -> int:
    """Kiểm rằng luật review-gate từ chối ĐÚNG LÝ DO, không chỉ "có từ chối".

    Một self-test chỉ hỏi "có bị reject không" sẽ vẫn xanh khi validator từ chối
    vì một lý do khác hẳn — và khi đó nó không còn canh thứ nó nghĩ mình đang canh.
    """
    import copy

    base = json.loads(PROFILE.read_bytes())
    schema = json.loads(SCHEMA.read_bytes())
    registry = json.loads(REGISTRY.read_bytes())
    library_version = registry["libraryVersion"]

    def run(candidate: dict[str, Any]) -> str | None:
        problems = sorted(
            Draft202012Validator(schema).iter_errors(candidate),
            key=lambda item: list(item.absolute_path),
        )
        if problems:
            return f"schema: {problems[0].message}"
        try:
            validate(candidate)
        except ValueError as error:
            return str(error)
        return None

    mutations: list[tuple[str, dict[str, Any], str]] = []

    def add(name: str, mutate, fragment: str) -> None:
        candidate = copy.deepcopy(base)
        mutate(candidate)
        mutations.append((name, candidate, fragment))

    add("token-khong-co-evidence",
        lambda c: c["reviewGatedFeatures"][0].update({"approvalToken": "a" * 64}),
        "cùng có hoặc cùng rỗng")
    add("evidence-khong-co-token",
        lambda c: c["reviewGatedFeatures"][0].update({"approvalEvidenceRef": "EV-PROG-U12-0001"}),
        "cùng có hoặc cùng rỗng")
    add("token-bia-dat",
        lambda c: c["reviewGatedFeatures"][0].update(
            {"approvalEvidenceRef": "EV-PROG-U12-0001", "approvalToken": "b" * 64}),
        "không suy ra từ contract")
    add("feature-khong-review-required",
        lambda c: c["reviewGatedFeatures"].append(
            {"featureId": "TON", "registryEntryId": "TON", "policy": "BLOCK_CHECK",
             "approvalEvidenceRef": None, "approvalToken": None}),
        "lệch registry REVIEW_REQUIRED")
    # Bỏ sót một feature REVIEW_REQUIRED: giữ mảng không rỗng để schema không
    # bắt trước, buộc chính luật hai chiều phải là thứ từ chối nó.
    add("bo-sot-feature-review-required",
        lambda c: c["reviewGatedFeatures"].__setitem__(
            0, {"featureId": "TON", "registryEntryId": "TON", "policy": "BLOCK_CHECK",
                "approvalEvidenceRef": None, "approvalToken": None}),
        "lệch registry REVIEW_REQUIRED")
    add("registry-entry-tro-sai-cho",
        lambda c: c["reviewGatedFeatures"][0].update({"registryEntryId": "TON"}),
        "registryEntryId phải trỏ đúng entry")
    add("policy-tu-che",
        lambda c: c["reviewGatedFeatures"][0].update({"policy": "WARN_ONLY"}),
        "was expected")

    failures: list[str] = []
    for name, candidate, fragment in mutations:
        error = run(candidate)
        if error is None:
            failures.append(f"{name}: KHÔNG bị từ chối")
        elif fragment not in error:
            failures.append(f"{name}: bị từ chối SAI lý do ({error})")

    # Chiều khẳng định: token suy ra ĐÚNG phải được chấp nhận. Không có phép
    # kiểm này thì một validator từ chối mọi thứ vẫn "đạt" self-test.
    approved = copy.deepcopy(base)
    evidence = "EV-PROG-U12-0001"
    approved["reviewGatedFeatures"][0].update({
        "approvalEvidenceRef": evidence,
        "approvalToken": approval_token("PID", library_version, evidence),
    })
    if (error := run(approved)) is not None:
        failures.append(f"token suy ra đúng vẫn bị từ chối: {error}")

    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    if failures:
        return 1
    print(f"PASS self-test: {len(mutations)}/{len(mutations)} mutation review-gate bị reject đúng lý do "
          f"+ 1/1 token hợp lệ được chấp nhận")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    try:
        rendered = outputs()
    except (OSError, ValueError, json.JSONDecodeError, KeyError,
            subprocess.CalledProcessError) as error:
        print(f"FAIL: profile không hợp lệ: {error}", file=sys.stderr)
        return 1

    if args.check:
        drift = [
            path for path, content in rendered
            if not path.exists() or path.read_text(encoding="utf-8") != content
        ]
        if drift:
            for path in drift:
                print(f"DRIFT: {path.relative_to(ROOT)} không khớp profile", file=sys.stderr)
            return 1
        print(f"PASS: hằng C++/Go/TS khớp product profile v2 ({len(rendered)}/{len(rendered)} tệp sinh)")
        return 0

    for path, content in rendered:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
