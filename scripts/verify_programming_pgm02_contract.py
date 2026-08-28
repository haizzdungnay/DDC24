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
APPROVED_CANDIDATE_COMMIT = "413a043748dce3b44d2c5076412de761760ba17a"
APPROVED_AUTHORITY = "AUTH-PROG-2026-08-24-05"


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

    if contract["approvedCandidateCommit"] != APPROVED_CANDIDATE_COMMIT:
        errors.append("contract không ghim đúng candidate commit đã được AUTH phê duyệt")
    if authority["authorization"] != APPROVED_AUTHORITY:
        errors.append("contract không trỏ đúng authority record đã mở implementation")
    if authority["architectDisposition"] != "APPROVED_EXACT_REVISION_PIN":
        errors.append("System Architect disposition phải khớp AUTH exact pin")
    if authority["planReady"] != "PASS":
        errors.append("PLAN_READY phải PASS sau AUTH toàn plan")
    if set(authority["implementReady"].values()) != {"GO"}:
        errors.append("AUTH toàn plan phải mở R1/R2/R3; runner vẫn kiểm dependency tuần tự")
    if set(modes["allowed"]) != {"EDIT", "LIVE", "SIMULATE"}:
        errors.append("mode set phải đúng EDIT/LIVE/SIMULATE")
    if set(quick_library["featureStates"]) != {"READY", "REVIEW_REQUIRED", "UNSUPPORTED", "DEPRECATED"}:
        errors.append("Quick Library phải phân biệt feature state với signature authority")
    if set(quick_library["signatureStates"]) != {"VERIFIED", "DECLARED", "UNAVAILABLE"}:
        errors.append("Quick Library signature phải phân biệt VERIFIED/DECLARED/UNAVAILABLE")
    if set(quick_library["signatureAuthorities"]) != {"SYSTEM_REGISTRY", "PROJECT_INTERFACE"}:
        errors.append("Quick Library signature thiếu producer authority")
    required_library_fields = {
        "entryId", "name", "kind", "version", "libraryVersion", "scope",
        "category", "descriptionKey", "labelVi", "labelEn", "aliases",
        "signatureAuthority", "signatureState", "featureState", "warningCode",
        "ports", "stateful", "stateLayout", "supportedLanguages", "contentSha256",
    }
    if set(quick_library["publicFields"]) != required_library_fields:
        errors.append("Quick Library public projection thiếu normalized signature hoặc compatibility alias")
    if quick_library["unavailableFallback"]:
        errors.append("Quick Library không được suy đoán signature khi authority UNAVAILABLE")
    expected_unscheduled = {
        "unscheduledProgramPouPolicy": "DRAFT_ALLOWED_CHECK_PACKAGE_FAIL_CLOSED",
        "publicError": "PRG-ERR-CHECK-001",
        "detailCode": "ST-POU-005",
        "synthesizedPeriodMs": False,
    }
    if edit["check"] != expected_unscheduled:
        errors.append("PROGRAM POU chưa schedule phải được giữ ở Draft nhưng Check/Package fail-closed, không tự đặt chu kỳ")
    # `annotateObject` (`DEV-PROG-004`, hợp đồng 1.2): chú thích POU phải VÁ TẠI
    # CHỖ. Nếu sửa mô tả phải đi qua `upsertObject` thì client buộc gửi kèm
    # `source`, và một buffer cũ trong trình duyệt sẽ ghi đè mã nguồn của phiên
    # khác — chính lớp lỗi mà tách operation này ra để chặn.
    expected_operations = {
        "setFunctionalTags", "replaceProgramSource", "upsertObject", "removeObject",
        "renameObject", "annotateObject", "duplicateObject", "upsertProgram", "removeProgram",
        "upsertSignal", "removeSignal", "upsertBinding", "upsertVariable",
        "removeVariable", "setTask", "removeBinding",
    }
    if set(edit["draft"]["operations"]) != expected_operations:
        errors.append("typed Draft phải phủ đúng 16 operation v1/v2 hiện hành")
    if set(edit["draft"]["contentSchemaVersions"]) != {1, 2}:
        errors.append("typed Draft phải giữ tương thích content schema v1/v2")
    required_typed_schemas = {
        "ProgrammingDraftDocumentV1", "ProgrammingDraftDocumentV2",
        "ProgrammingPouObjectV2", "ProgrammingProgramConfigV2",
    }
    if set(edit["draft"]["typedSchemas"]) != required_typed_schemas:
        errors.append("OpenAPI Draft thiếu typed schema bắt buộc")
    if edit["draft"]["sourceRepresentation"] != {"ST": "STRING", "FBD": "CANONICAL_OBJECT"}:
        errors.append("Draft source phải là typed union ST string/FBD canonical object")
    if set(edit["draft"]["programConfigFields"]) != {"objectId", "programId", "periodMs"}:
        errors.append("Program config không được trộn runtime enable intent vào Draft")
    if not edit["draft"]["runtimeEnableIntentSeparate"]:
        errors.append("Enable/Disable phải là runtime intent riêng")
    if edit["draft"]["replaceProgramSourceIdentity"] != "objectId":
        errors.append("replaceProgramSource phải resolve POU bằng objectId")
    if (edit["draft"]["malformedRequestStatus"], edit["draft"]["semanticValidationStatus"]) != (400, 422):
        errors.append("malformed request 400 và semantic validation 422 phải tách biệt")
    if edit["draft"]["idempotencyReplay"] != "FULL_TYPED_READ_BACK":
        errors.append("idempotency replay phải trả lại full typed read-back")
    if set(edit["pouRefactor"]["stableErrors"]) != {
        "PRG-ERR-POU-REFERENCED-001", "PRG-ERR-POU-REFACTOR-UNAVAILABLE-001",
    }:
        errors.append("semantic refactor thiếu mã lỗi ổn định")
    if set(edit["references"]["states"]) != {"READY", "UNAVAILABLE"}:
        errors.append("reference query phải fail-closed READY/UNAVAILABLE")
    expected_reference_queries = {
        "targetObjectId", "targetEntryId", "targetVersion", "targetSignalId", "cursor", "limit",
    }
    if set(edit["references"]["queryFields"]) != expected_reference_queries:
        errors.append("reference query thiếu identity POU/library/signal")
    if set(edit["references"]["targetIdentities"]) != {
        "targetObjectId", "targetEntryId+targetVersion", "targetSignalId",
    }:
        errors.append("reference response thiếu target identity POU/library/signal")
    if edit["references"]["targetIdentityRule"] != "EXACTLY_ONE_TARGET_IDENTITY":
        errors.append("reference item phải có đúng một target identity")
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
        ("authority", lambda item: item["authority"].__setitem__("architectDisposition", "PENDING_EXACT_REVISION_PIN")),
        ("authority-id", lambda item: item["authority"].__setitem__("authorization", "AUTH-PROG-INVALID")),
        ("candidate-commit", lambda item: item.__setitem__("approvedCandidateCommit", "0" * 40)),
        ("live-write", lambda item: item["modes"]["LIVE"]["mutableRoles"].append("admin")),
        ("library-fallback", lambda item: item["quickLibrary"].__setitem__("unavailableFallback", True)),
        ("signature-state", lambda item: item["quickLibrary"]["signatureStates"].append("READY")),
        ("ghost-pou", lambda item: item["edit"]["check"].__setitem__("synthesizedPeriodMs", 1000)),
        ("draft-op", lambda item: item["edit"]["draft"]["operations"].remove("renameObject")),
        ("draft-source", lambda item: item["edit"]["draft"]["sourceRepresentation"].__setitem__("FBD", "STRING")),
        ("draft-replay", lambda item: item["edit"]["draft"].__setitem__("idempotencyReplay", "IDS_ONLY")),
        ("refactor-error", lambda item: item["edit"]["pouRefactor"]["stableErrors"].remove("PRG-ERR-POU-REFERENCED-001")),
        ("reference-mutation", lambda item: item["edit"]["references"].__setitem__("mutationEndpoint", True)),
        ("reference-identity", lambda item: item["edit"]["references"]["queryFields"].remove("targetSignalId")),
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
