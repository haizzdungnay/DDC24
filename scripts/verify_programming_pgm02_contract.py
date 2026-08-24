#!/usr/bin/env python3
"""Kiểm hợp đồng target PGM-02 trước khi consumer FE/BE/Core được sửa."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import pathlib
import sys
from typing import Any, Callable

from jsonschema import Draft202012Validator

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contracts/programming/pgm02_workspace_v1.json"
SCHEMA = ROOT / "contracts/programming/pgm02_workspace_v1.schema.json"
PIN_PATHS = {
    "productProfileSha256": ROOT / "contracts/programming/product_profile_v2.json",
    "libraryRegistrySha256": ROOT / "contracts/programming/pou_library_registry_v1.json",
    "openapiSha256": ROOT / "contracts/openapi/openapi.yaml",
    "programmingIpcSha256": ROOT / "contracts/ipc/programming_v1/schema.json",
}


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: pathlib.Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_semantics(contract: dict[str, Any], *, check_pins: bool = True) -> list[str]:
    errors: list[str] = []
    authority = contract["authority"]
    route = contract["route"]
    identity = contract["identity"]
    modes = contract["modes"]
    quick_library = contract["quickLibrary"]
    edit = contract["edit"]
    simulation = contract["simulation"]
    nfr = contract["nfr"]

    if authority["architectDisposition"] != "PENDING_EXACT_REVISION_PIN":
        errors.append("WP-00 candidate không được tự nhận Architect đã pin")
    if set(authority["implementReady"].values()) != {"NO_GO"}:
        errors.append("R1/R2/R3 phải giữ NO-GO trước exact revision pin")
    if set(modes["allowed"]) != {"EDIT", "LIVE", "SIMULATE"}:
        errors.append("mode set phải đúng EDIT/LIVE/SIMULATE")
    if set(quick_library["signatureStates"]) != {"READY", "REVIEW_REQUIRED", "UNAVAILABLE"}:
        errors.append("Quick Library phải phân biệt READY/REVIEW_REQUIRED/UNAVAILABLE")
    if quick_library["unavailableFallback"]:
        errors.append("Quick Library không được suy đoán signature khi authority UNAVAILABLE")
    expected_operations = {
        "setFunctionalTags", "replaceProgramSource", "upsertObject", "removeObject",
        "renameObject", "duplicateObject", "upsertProgram", "removeProgram",
        "upsertSignal", "removeSignal", "upsertBinding", "upsertVariable",
        "removeVariable", "setTask", "removeBinding",
    }
    if set(edit["draft"]["operations"]) != expected_operations:
        errors.append("typed Draft phải phủ đúng 15 operation v1/v2 hiện hành")
    if set(edit["draft"]["contentSchemaVersions"]) != {1, 2}:
        errors.append("typed Draft phải giữ tương thích content schema v1/v2")
    required_typed_schemas = {
        "ProgrammingDraftDocumentV1", "ProgrammingDraftDocumentV2",
        "ProgrammingPouObjectV2", "ProgrammingProgramConfigV2",
    }
    if set(edit["draft"]["typedSchemas"]) != required_typed_schemas:
        errors.append("OpenAPI Draft thiếu typed schema bắt buộc")
    if set(edit["pouRefactor"]["stableErrors"]) != {
        "PRG-ERR-POU-REFERENCED-001", "PRG-ERR-POU-REFACTOR-UNAVAILABLE-001",
    }:
        errors.append("semantic refactor thiếu mã lỗi ổn định")
    if set(edit["references"]["states"]) != {"READY", "UNAVAILABLE"}:
        errors.append("reference query phải fail-closed READY/UNAVAILABLE")
    if edit["references"]["mutationEndpoint"]:
        errors.append("reference preflight không được tạo mutation endpoint thứ hai")
    if set(edit["diagnostics"]["locationKinds"]) != {"SOURCE", "FBD", "POU", "GLOBAL"}:
        errors.append("diagnostic location union thiếu kind")
    if modes["LIVE"]["mutableRoles"]:
        errors.append("LIVE phải read-only cho mọi role")
    if modes["SIMULATE"]["mutableRoles"] != ["admin"]:
        errors.append("Simulation v1 mutation phải admin-only")
    if any(mode["physicalOutputAuthority"] for mode in (modes["EDIT"], modes["LIVE"], modes["SIMULATE"])):
        errors.append("không mode PGM-02 nào có physical output authority")
    if simulation["mutationRoles"] != ["admin"]:
        errors.append("worker action phải admin-only")
    if set(simulation["readRoles"]) != {"viewer", "operator", "admin"}:
        errors.append("viewer/operator/admin phải đọc được session snapshot")
    required_actions = {"RUN", "PAUSE", "STEP_CYCLE", "RESET", "SET_SPEED", "SET_INPUT", "STOP"}
    if set(simulation["actions"]) != required_actions:
        errors.append("action Simulation v1 lệch bộ đã khóa")
    if simulation["virtualTime"]["speeds"] != [1, 10, 60]:
        errors.append("speed phải đúng thứ tự 1x/10x/60x")
    if simulation["limits"]["idleTtlSeconds"] >= simulation["limits"]["hardTtlSeconds"]:
        errors.append("idle TTL phải nhỏ hơn hard TTL")
    if set(identity["documentTuple"]) != {"projectId", "revisionId", "objectId", "contentHash"}:
        errors.append("document identity tuple thiếu hoặc thừa field")
    value_required = {"controllerId", "activeRevisionId", "programId", "observationId", "snapshotSequence", "observedAt", "quality"}
    if set(identity["valueTuple"]) != value_required:
        errors.append("value identity tuple thiếu hoặc thừa field")
    if route["projectQuery"] not in route["preserveQuery"]:
        # project được nâng từ path legacy vào query, không bắt buộc nằm trong
        # preserveQuery. Kiểm này chỉ chạy khi ai đổi tên query mà quên route.
        if route["projectQuery"] != "project":
            errors.append("project query phải canonical là project")
    viewport = nfr["viewport"]
    if not (
        viewport["mobileReadOnlyBelowPx"]
        == viewport["authoringMinWidthPx"]
        == viewport["drawerMinWidthPx"]
        < viewport["compactDockMinWidthPx"]
        < viewport["fullShellMinWidthPx"]
    ):
        errors.append("breakpoint/read-only policy không tăng đơn điệu")
    frontend = nfr["frontend"]
    if not (
        frontend["baselineProgrammingChunkGzipKiB"]
        < frontend["r1ProgrammingChunkGzipBudgetKiB"]
        < frontend["r2ProgrammingChunkGzipBudgetKiB"]
        < frontend["r3ProgrammingChunkGzipBudgetKiB"]
    ):
        errors.append("bundle budget R1/R2/R3 phải tăng đơn điệu từ baseline")
    if check_pins:
        for key, path in PIN_PATHS.items():
            if contract["pins"][key] != digest(path):
                errors.append(f"pin drift: {key} != SHA-256 {path.relative_to(ROOT)}")
    return errors


def validate(contract: dict[str, Any], schema: dict[str, Any], *, check_pins: bool = True) -> list[str]:
    errors = [
        f"schema {error.json_path}: {error.message}"
        for error in sorted(Draft202012Validator(schema).iter_errors(contract), key=lambda item: item.json_path)
    ]
    if not errors:
        errors.extend(validate_semantics(contract, check_pins=check_pins))
    return errors


def self_test(contract: dict[str, Any], schema: dict[str, Any]) -> int:
    mutations: list[tuple[str, Callable[[dict[str, Any]], None]]] = [
        ("route", lambda item: item["route"].__setitem__("primary", "/eng/programming/design")),
        ("authority", lambda item: item["authority"].__setitem__("architectDisposition", "APPROVED")),
        ("live-write", lambda item: item["modes"]["LIVE"]["mutableRoles"].append("admin")),
        ("library-fallback", lambda item: item["quickLibrary"].__setitem__("unavailableFallback", True)),
        ("draft-op", lambda item: item["edit"]["draft"]["operations"].remove("renameObject")),
        ("refactor-error", lambda item: item["edit"]["pouRefactor"]["stableErrors"].remove("PRG-ERR-POU-REFERENCED-001")),
        ("reference-mutation", lambda item: item["edit"]["references"].__setitem__("mutationEndpoint", True)),
        ("diagnostic-kind", lambda item: item["edit"]["diagnostics"]["locationKinds"].remove("FBD")),
        ("sim-operator", lambda item: item["simulation"]["mutationRoles"].append("operator")),
        ("physical-output", lambda item: item["modes"]["SIMULATE"].__setitem__("physicalOutputAuthority", True)),
        ("step-program", lambda item: item["simulation"]["virtualTime"].__setitem__("stepProgram", True)),
        ("speed", lambda item: item["simulation"]["virtualTime"]["speeds"].append(100)),
        ("ttl", lambda item: item["simulation"]["limits"].__setitem__("idleTtlSeconds", 7200)),
        ("identity", lambda item: item["identity"]["valueTuple"].remove("activeRevisionId")),
        ("breakpoint", lambda item: item["nfr"]["viewport"].__setitem__("authoringMinWidthPx", 390)),
        ("bundle", lambda item: item["nfr"]["frontend"].__setitem__("r2ProgrammingChunkGzipBudgetKiB", 100)),
    ]
    for name, mutate in mutations:
        candidate = copy.deepcopy(contract)
        mutate(candidate)
        if not validate(candidate, schema, check_pins=False):
            raise AssertionError(f"self-test {name} không bị từ chối")
    print(f"PASS self-test: {len(mutations)}/{len(mutations)} mutation PGM-02 bị từ chối fail-closed")
    return len(mutations)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_json(CONTRACT)
        schema = load_json(SCHEMA)
        errors = validate(contract, schema)
        if errors:
            for error in errors:
                print(f"FAIL: {error}", file=sys.stderr)
            return 1
        if args.self_test:
            self_test(contract, schema)
    except (OSError, ValueError, json.JSONDecodeError, AssertionError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: hợp đồng PGM-02 route/identity/EDIT/library/LIVE/Simulation/NFR khớp pin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
