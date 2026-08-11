#!/usr/bin/env python3
"""Sinh hằng C++ từ profile Programming Rev A machine-readable."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "contracts/programming/rev_a_profile_v1.json"
OUTPUT = ROOT / "apps/core/application/st/st_profile_generated.hpp"


def render() -> str:
    raw = PROFILE.read_bytes()
    profile = json.loads(raw)
    task = profile["task"]
    resource = profile["resources"]
    types = {item["name"]: item for item in profile["types"]}
    periods = ", ".join(f"{value}u" for value in task["allowedPeriodMs"])
    profile_hash = hashlib.sha256(raw).hexdigest()
    return f"""// GENERATED bởi scripts/generate_programming_profile.py; không sửa tay.
#ifndef CORE_ST_PROFILE_GENERATED_HPP
#define CORE_ST_PROFILE_GENERATED_HPP

#include <array>
#include <cstddef>
#include <cstdint>

namespace core::st_profile_generated {{
inline constexpr const char* kProfileId = \"{profile['profileId']}\";
inline constexpr uint16_t kProfileCode = {profile['profileCode']}u;
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
inline constexpr std::size_t kMaxTasks = {task['maxTasks']}u;
inline constexpr std::size_t kMaxProgramsPerTask = {task['maxProgramsPerTask']}u;
inline constexpr std::size_t kMaxProgramsTotal = {task['maxProgramsTotal']}u;
inline constexpr std::array<uint32_t, 3> kAllowedPeriodMs = {{{periods}}};
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generated = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != generated:
            print(f"DRIFT: {OUTPUT.relative_to(ROOT)} không khớp profile", file=sys.stderr)
            return 1
        print("PASS: hằng C++ khớp profile Rev A")
        return 0
    OUTPUT.write_text(generated)
    print(OUTPUT.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
