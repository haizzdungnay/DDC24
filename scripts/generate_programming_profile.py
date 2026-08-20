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
"""
    # gofmt là authority định dạng Go: sinh thô rồi format, để `--check` không
    # bao giờ đối đầu với `gofmt -l` trong gate.
    return subprocess.run(
        ["gofmt"], input=source, text=True, capture_output=True, check=True
    ).stdout


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
"""


def outputs() -> list[tuple[Path, str]]:
    profile, profile_hash = load()
    return [
        (CPP_OUTPUT, render_cpp(profile, profile_hash)),
        (GO_OUTPUT, render_go(profile, profile_hash)),
        (TS_OUTPUT, render_ts(profile, profile_hash)),
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
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
