#!/usr/bin/env python3
"""Kiểm contract provenance/hash/profile/source-map của artifact ST và FBD."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
from typing import Any

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "contracts/programming"
SCHEMA_PATH = BASE / "artifact_build_manifest_v1.schema.json"
PROFILE_PATH = BASE / "rev_a_profile_v1.json"
ST_SOURCE_PATH = ROOT / "apps/core/application/st/samples/ahu_fan_control.st"
FBD_SOURCE_PATH = BASE / "fbd/golden/ahu_fan_enable.json"
CASES = {
    "ST": (
        BASE / "golden/build_manifest_st_v1.json",
        BASE / "golden/rev_a_ahu_fan_control.mkir",
        ST_SOURCE_PATH,
    ),
    "FBD": (
        BASE / "golden/build_manifest_fbd_v1.json",
        BASE / "golden/rev_a_ahu_fan_enable_fbd.mkir",
        FBD_SOURCE_PATH,
    ),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_fbd(raw: bytes) -> bytes:
    value = json.loads(raw)
    value["networks"].sort(key=lambda item: (item["order"], item["id"]))
    for network in value["networks"]:
        network["nodes"].sort(key=lambda item: (item["executionOrder"], item["id"]))
        for node in network["nodes"]:
            node["ports"].sort(key=lambda item: (item["order"], item["id"]))
        network["wires"].sort(key=lambda item: item["id"])
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def build_key(manifest: dict[str, Any]) -> str:
    value = {
        "schemaVersion": 1,
        "source": manifest["source"],
        "compiler": manifest["compiler"],
        "profile": manifest["profile"],
        "target": manifest["target"],
    }
    return sha256(json.dumps(value, separators=(",", ":"), sort_keys=True).encode())


def artifact_integrity_hash(artifact: bytes) -> str:
    if len(artifact) < 128:
        return ""
    normalized = bytearray(artifact)
    normalized[32:128] = b"\0" * 96
    return sha256(bytes(normalized))


def artifact_source_map(artifact: bytes) -> list[tuple[int, int, int]]:
    if len(artifact) < 128 or artifact[:8] != b"MKDDCIR1":
        raise ValueError("artifact header không hợp lệ")
    section_count = struct.unpack_from("<H", artifact, 24)[0]
    entries: list[tuple[int, int, int]] = []
    for index in range(section_count):
        row = 128 + index * 16
        section_type, flags, offset, size, item_count = struct.unpack_from(
            "<HHIII", artifact, row
        )
        if flags != 0 or offset + size > len(artifact):
            raise ValueError("section table không hợp lệ")
        if section_type != 0x0008:
            continue
        if size != item_count * 8:
            raise ValueError("source-map stride không hợp lệ")
        for item in range(item_count):
            entries.append(struct.unpack_from("<IHH", artifact, offset + item * 8))
    return entries


def validate_case(language: str, manifest: dict[str, Any], artifact: bytes,
                  source_raw: bytes, profile_raw: bytes) -> list[str]:
    errors: list[str] = []
    canonical = source_raw if language == "ST" else canonical_fbd(source_raw)
    source = manifest["source"]
    artifact_meta = manifest["artifact"]
    if source["language"] != language:
        errors.append("language drift")
    if source["canonicalBytes"] != len(canonical) or source["canonicalSha256"] != sha256(canonical):
        errors.append("canonical source hash/size drift")
    if manifest["profile"]["sha256"] != sha256(profile_raw):
        errors.append("profile hash drift")
    if artifact_meta["bytes"] != len(artifact) or artifact_meta["fileSha256"] != sha256(artifact):
        errors.append("artifact file hash/size drift")
    if artifact_meta["integritySha256"] != artifact_integrity_hash(artifact):
        errors.append("artifact integrity hash drift")
    if manifest["buildKeySha256"] != build_key(manifest):
        errors.append("build key drift")

    binary_map = artifact_source_map(artifact)
    manifest_map = manifest["sourceMap"]["entries"]
    compact = [(item["pc"], item["encodedLine"], item["encodedColumn"])
               for item in manifest_map]
    if compact != binary_map:
        errors.append("source-map manifest/binary drift")
    if language == "ST":
        if any(item["textLocation"] is None or item["fbdLocation"] is not None
               for item in manifest_map):
            errors.append("ST source-map shape sai")
    else:
        if any(item["textLocation"] is not None or item["fbdLocation"] is None
               for item in manifest_map):
            errors.append("FBD source-map shape sai")
        canonical_ids = {
            identity
            for network in json.loads(canonical)["networks"]
            for node in network["nodes"]
            for identity in (network["id"], node["id"], *(port["id"] for port in node["ports"]))
        }
        for item in manifest_map:
            location = item["fbdLocation"]
            if not {location["networkId"], location["nodeId"], location["portId"]} <= canonical_ids:
                errors.append("FBD source-map UUID không thuộc source canonical")
                break
    return errors


def load_and_validate() -> tuple[dict[str, dict[str, Any]], list[str]]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    profile_raw = PROFILE_PATH.read_bytes()
    manifests: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    for language, (manifest_path, artifact_path, source_path) in CASES.items():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifests[language] = manifest
        errors.extend(
            f"{language} schema {item.json_path}: {item.message}"
            for item in validator.iter_errors(manifest)
        )
        errors.extend(
            f"{language}: {item}"
            for item in validate_case(
                language, manifest, artifact_path.read_bytes(), source_path.read_bytes(), profile_raw
            )
        )
    return manifests, errors


def self_test(manifests: dict[str, dict[str, Any]]) -> None:
    base = manifests["ST"]
    mutations: list[tuple[str, dict[str, Any]]] = []
    candidate = copy.deepcopy(base); candidate["manifestVersion"] = 2; mutations.append(("version", candidate))
    candidate = copy.deepcopy(base); candidate["profile"]["id"] = "unknown"; mutations.append(("profile", candidate))
    candidate = copy.deepcopy(base); candidate["source"]["canonicalSha256"] = "0" * 64; mutations.append(("source", candidate))
    candidate = copy.deepcopy(base); candidate["artifact"]["fileSha256"] = "0" * 64; mutations.append(("artifact", candidate))
    candidate = copy.deepcopy(base); candidate["buildKeySha256"] = "0" * 64; mutations.append(("build-key", candidate))
    candidate = copy.deepcopy(base); candidate["sourceMap"]["entries"][0]["pc"] = 4095; mutations.append(("source-map", candidate))
    candidate = copy.deepcopy(base); candidate["unexpected"] = True; mutations.append(("unknown-field", candidate))
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    rejected = 0
    artifact = CASES["ST"][1].read_bytes()
    source = CASES["ST"][2].read_bytes()
    profile = PROFILE_PATH.read_bytes()
    for _, candidate in mutations:
        if list(validator.iter_errors(candidate)) or validate_case("ST", candidate, artifact, source, profile):
            rejected += 1
    if rejected != len(mutations):
        raise RuntimeError(f"self-test chỉ reject {rejected}/{len(mutations)} mutation")
    print(f"PASS self-test: {rejected}/{len(mutations)} mutation manifest bị reject")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        manifests, errors = load_and_validate()
        if errors:
            for error in errors:
                print(f"FAIL: {error}", file=sys.stderr)
            return 1
        if args.self_test:
            self_test(manifests)
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, RuntimeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: artifact manifest ST/FBD khớp schema, source/profile/hash/build-key/source-map")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
