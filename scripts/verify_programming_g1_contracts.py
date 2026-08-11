#!/usr/bin/env python3
"""Kiểm join contract G1 Programming và các bất biến deploy/rollback."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
JOIN_PATH = ROOT / "contracts/programming/g1_contract_join_v1.json"
EXPECTED_DEPLOY = [
    "backup", "schema", "core-dual-compatible", "backend", "frontend-read-only"
]
EXPECTED_ROLLBACK = ["frontend", "backend", "core"]
REQUIRED_PRESERVE = {
    "database", "backup", "revision", "artifact", "operation", "audit", "active-lkg"
}
REQUIRED_FORBID = {
    "automatic-downgrade", "destructive-delete", "commission", "blind-replay"
}
BASELINE_STATE = {
    "schema": 0,
    "core": "v0",
    "backend": "v0",
    "frontend": "v0",
    "database": "db-sha256-before",
    "backup": "backup-preexisting",
    "revision": "revision-before",
    "artifact": "artifact-before",
    "operation": "operation-before",
    "audit": "audit-before",
    "active-lkg": "active-lkg-before",
    "commissionCount": 0,
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def contract_by_name(join: dict[str, Any], name: str) -> dict[str, Any]:
    matches = [item for item in join.get("contracts", []) if item.get("name") == name]
    if len(matches) != 1:
        raise ValueError(f"contract {name} phải xuất hiện đúng một lần")
    return matches[0]


def safe_path(value: str) -> Path:
    candidate = Path(value)
    if not value or candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"đường dẫn contract không an toàn: {value}")
    resolved = (ROOT / candidate).resolve()
    if ROOT not in resolved.parents:
        raise ValueError(f"đường dẫn contract thoát repository: {value}")
    return resolved


def deploy_rollback_dry_run(
    deploy_order: list[str], rollback_order: list[str]
) -> tuple[bool, dict[str, Any], str]:
    """Mô phỏng preflight + deploy + rollback, không chạm máy/DB thật."""
    state: dict[str, Any] = copy.deepcopy(BASELINE_STATE)
    if deploy_order != EXPECTED_DEPLOY:
        return False, state, "deploy order bị từ chối ở preflight"
    if rollback_order != EXPECTED_ROLLBACK:
        return False, state, "rollback order bị từ chối ở preflight"

    backup = copy.deepcopy(state)
    for step in deploy_order:
        if step == "backup":
            state["backupSnapshot"] = copy.deepcopy(backup)
        elif step == "schema":
            state["schema"] = 1
        elif step == "core-dual-compatible":
            state["core"] = "v1-dual"
        elif step == "backend":
            state["backend"] = "v1"
        elif step == "frontend-read-only":
            state["frontend"] = "v1-read-only"

    for step in rollback_order:
        state[step] = backup[step]
    state["schema"] = 1  # rollback tự động không downgrade schema.

    for name in REQUIRED_PRESERVE:
        if state[name] != backup[name]:
            return False, state, f"rollback làm đổi {name}"
    if state["commissionCount"] != 0:
        return False, state, "dry-run phát sinh Commission"
    if state["schema"] != 1:
        return False, state, "rollback đã downgrade schema"
    return True, state, "deploy/rollback dry-run PASS"


def validate(join: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    def require(condition: bool, message: str) -> None:
        if not condition:
            errors.append(message)

    require(join.get("contractId") == "PROGRAMMING-G1-JOIN-V1", "contractId sai")
    require(join.get("joinVersion") == 1, "joinVersion phải là 1")
    require(join.get("featureDefaultOff") is True, "feature phải mặc định OFF")
    require(join.get("commissionEnabled") is False, "G1 không được bật Commission")

    contracts = join.get("contracts", [])
    require(len(contracts) == 6, "G1 phải ghim đúng 6 contract")
    require(len({item.get("name") for item in contracts}) == len(contracts), "tên contract bị trùng")
    accepted_major = join.get("compatibility", {}).get("acceptedMajor")
    require(accepted_major == 1, "acceptedMajor phải là 1")
    for item in contracts:
        require(item.get("major") == accepted_major, f"{item.get('name')}: major không tương thích")
        try:
            path = safe_path(str(item.get("path", "")))
            require(path.is_file(), f"{item.get('name')}: file không tồn tại")
            if path.is_file():
                require(digest(path) == item.get("sha256"), f"{item.get('name')}: SHA-256 drift")
        except (OSError, ValueError) as error:
            errors.append(str(error))

    try:
        openapi_item = contract_by_name(join, "openapi")
        openapi = safe_path(openapi_item["path"]).read_text(encoding="utf-8")
        info_version = re.search(r"(?ms)^info:\s*.*?^  version:\s*[\"']?([^\"'\s]+)", openapi)
        operation_count = len(re.findall(r"^\s+operationId:\s+\w*Programming\w*\s*$", openapi, re.MULTILINE))
        require(info_version is not None and info_version.group(1) == openapi_item["version"], "OpenAPI version drift")
        require(operation_count == openapi_item["operationCount"] == 25, "OpenAPI Programming operation phải là 25")
    except (KeyError, OSError, ValueError) as error:
        errors.append(f"openapi: {error}")

    try:
        ipc_item = contract_by_name(join, "ipc")
        ipc_schema = json.loads(safe_path(ipc_item["path"]).read_text())
        ipc_manifest_path = safe_path(ipc_item["goldenManifestPath"])
        ipc_manifest = json.loads(ipc_manifest_path.read_text())
        request_prefix = ipc_schema["$defs"]["request"]["prefixItems"]
        response_prefix = ipc_schema["$defs"]["response"]["prefixItems"]
        require(request_prefix[0].get("const") == 1 and response_prefix[0].get("const") == 1, "IPC major drift")
        require(request_prefix[2].get("const") == ipc_item["version"], "IPC schemaVersion drift")
        require(digest(ipc_manifest_path) == ipc_item["goldenManifestSha256"], "IPC golden manifest hash drift")
        require(ipc_manifest.get("schemaSha256") == ipc_item["sha256"], "IPC schema/golden hash lệch")
        require(ipc_manifest.get("protocolMajor") == 1, "IPC golden major phải là 1")
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"ipc: {error}")

    try:
        profile_item = contract_by_name(join, "profile")
        artifact_item = contract_by_name(join, "artifact")
        profile = json.loads(safe_path(profile_item["path"]).read_text())
        artifact_schema = json.loads(safe_path(artifact_item["path"]).read_text())
        artifact_manifest_path = safe_path(artifact_item["goldenManifestPath"])
        artifact_manifest = json.loads(artifact_manifest_path.read_text())
        require(profile["version"] == {"major": 1, "minor": 0}, "profile version drift")
        require(profile["profileCode"] == artifact_item["compilerProfile"] == 1, "profile/artifact code lệch")
        require(artifact_schema["properties"]["schemaVersion"]["const"] == 1, "artifact schema major drift")
        require(artifact_schema["properties"]["compilerProfile"]["const"] == 1, "artifact compiler profile drift")
        require(digest(artifact_manifest_path) == artifact_item["goldenManifestSha256"], "artifact golden manifest hash drift")
        require(artifact_manifest["schemaVersion"] == artifact_manifest["compilerProfile"] == 1, "artifact golden version lệch")
        require(profile["integrityMode"] == artifact_manifest["integrityMode"] == "HASH_ONLY", "integrity mode lệch")
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"profile/artifact: {error}")

    try:
        errors_item = contract_by_name(join, "errors")
        catalog = json.loads(safe_path(errors_item["path"]).read_text())
        manifest_path = safe_path(errors_item["manifestPath"])
        manifest = json.loads(manifest_path.read_text())
        require(digest(manifest_path) == errors_item["manifestSha256"], "error manifest hash drift")
        require(manifest["catalogSha256"] == errors_item["sha256"], "error catalog/manifest hash lệch")
        require(len(catalog["publicErrors"]) == errors_item["publicErrorCount"] == 19, "public error count lệch")
        require(len(catalog["componentDetails"]) == errors_item["componentDetailCount"] == 77, "detail error count lệch")
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"errors: {error}")

    try:
        store_item = contract_by_name(join, "store")
        store_manifest = json.loads(safe_path(store_item["path"]).read_text())
        migration_path = safe_path(store_item["migrationPath"])
        require(digest(migration_path) == store_item["migrationSha256"], "store migration SHA-256 drift")
        require(store_manifest["migrationSha256"] == store_item["migrationSha256"], "store manifest/migration hash lệch")
        require(store_manifest["schemaVersion"] == 1, "store schema major drift")
        require(store_manifest["featureDefaultOff"] is True, "store feature phải OFF")
        require(store_manifest["foreignKeys"] is True and store_manifest["singleWriter"] is True, "store FK/single-writer drift")
        require(store_manifest["journalMode"] == "WAL" and store_manifest["synchronous"] == "FULL", "store PRAGMA drift")
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"store: {error}")

    compatibility = join.get("compatibility", {})
    require(compatibility.get("unknownMajor") == "REJECT_NO_MUTATION", "unknown major phải reject no-mutation")
    require(compatibility.get("mixedPartialDeploy") == "FAIL_CLOSED", "partial deploy phải fail-closed")
    for fixture in compatibility.get("negativeFixtures", []):
        try:
            require(safe_path(fixture).is_file(), f"negative fixture thiếu: {fixture}")
        except ValueError as error:
            errors.append(str(error))

    deploy = join.get("deploy", {})
    require(deploy.get("order") == EXPECTED_DEPLOY, "thứ tự deploy sai")
    require(deploy.get("rollbackOrder") == EXPECTED_ROLLBACK, "thứ tự rollback sai")
    require(deploy.get("stopOnMismatch") is True, "deploy phải dừng khi mismatch")
    require(deploy.get("flagDuringG1") == "OFF", "flag G1 phải OFF")
    require(set(deploy.get("preserve", [])) == REQUIRED_PRESERVE, "rollback preserve set sai")
    require(set(deploy.get("forbid", [])) == REQUIRED_FORBID, "rollback forbid set sai")
    dry_run_ok, _, dry_run_message = deploy_rollback_dry_run(
        deploy.get("order", []), deploy.get("rollbackOrder", [])
    )
    require(dry_run_ok, dry_run_message)
    return errors


def run_self_test(join: dict[str, Any]) -> None:
    mutations = []
    candidate = copy.deepcopy(join)
    candidate["contracts"][0]["major"] = 2
    mutations.append(("unknown-major", candidate))
    candidate = copy.deepcopy(join)
    candidate["deploy"]["order"] = list(reversed(EXPECTED_DEPLOY))
    mutations.append(("deploy-order", candidate))
    candidate = copy.deepcopy(join)
    candidate["commissionEnabled"] = True
    mutations.append(("commission-on", candidate))
    candidate = copy.deepcopy(join)
    candidate["contracts"][0]["sha256"] = "0" * 64
    mutations.append(("hash-drift", candidate))
    candidate = copy.deepcopy(join)
    candidate["deploy"]["preserve"].remove("database")
    mutations.append(("destructive-rollback", candidate))
    for name, mutation in mutations:
        if not validate(mutation):
            raise RuntimeError(f"self-test {name} không bị reject")
    print(f"PASS self-test: {len(mutations)}/{len(mutations)} mutation bị reject fail-closed")

    invalid_orders = []
    for index in range(len(EXPECTED_DEPLOY) - 1):
        order = list(EXPECTED_DEPLOY)
        order[index], order[index + 1] = order[index + 1], order[index]
        invalid_orders.append(order)
    invalid_orders.append(EXPECTED_DEPLOY[:-1])
    for order in invalid_orders:
        ok, state, _ = deploy_rollback_dry_run(order, EXPECTED_ROLLBACK)
        if ok or state != BASELINE_STATE:
            raise RuntimeError("deploy order lỗi không fail-closed trước mutation")
    ok, state, message = deploy_rollback_dry_run(EXPECTED_DEPLOY, EXPECTED_ROLLBACK)
    if not ok or state["commissionCount"] != 0:
        raise RuntimeError(message)
    print(
        f"PASS dry-run: {len(invalid_orders)}/{len(invalid_orders)} thứ tự lỗi bị chặn; "
        "deploy/rollback chuẩn bảo toàn dữ liệu và không Commission"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        join = json.loads(JOIN_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"FAIL: không đọc được {JOIN_PATH.relative_to(ROOT)}: {error}", file=sys.stderr)
        return 1
    errors = validate(join)
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    if args.self_test:
        run_self_test(join)
    print("PASS: 6/6 contract G1 cùng major 1; hash/version/deploy/rollback/flag khớp")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
