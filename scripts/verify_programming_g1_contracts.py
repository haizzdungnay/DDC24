#!/usr/bin/env python3
"""Kiểm join contract G1 Programming và các bất biến deploy/rollback."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import struct
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
REQUIRED_CONTRACT_NAMES = {
    "openapi", "ipc", "profile", "artifact", "errors", "store", "source-bundle",
    "library-registry", "artifact-v2", "dual-reader",
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


SECTION_TYPE_NAMES = {
    1: "POU_TABLE", 2: "PROGRAM_TABLE", 3: "TYPE_SIGNATURE_TABLE", 4: "CODE_IR",
    5: "CONSTANTS", 6: "FB_LAYOUT", 7: "SIGNAL_DEFS", 8: "BINDING_MANIFEST",
    9: "SOURCE_MAP", 10: "LIBRARY_LOCK", 11: "RETAIN_LAYOUT", 12: "RESOURCE_BUDGET",
}


def golden_sections(data: bytes) -> list[dict[str, Any]]:
    """Đọc bảng section THẬT từ file package v2 (header 128 byte, entry 16 byte)."""
    if len(data) < 128:
        return []
    count = struct.unpack_from("<H", data, 18)[0]
    sections: list[dict[str, Any]] = []
    for index in range(count):
        base = 128 + index * 16
        if base + 16 > len(data):
            return []
        type_code = struct.unpack_from("<H", data, base)[0]
        offset, size, items = struct.unpack_from("<III", data, base + 4)
        sections.append({
            "type": SECTION_TYPE_NAMES.get(type_code, f"UNKNOWN_{type_code}"),
            "offset": offset,
            "bytes": size,
            "itemCount": items,
        })
    return sections


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


def validate_migration_chain(
    store_item: dict[str, Any], store_manifest: dict[str, Any]
) -> list[str]:
    """Kiểm toàn chuỗi migration store thay vì chỉ tin một hằng schema version.

    Hardcode `schemaVersion == 4` trong validator từng làm gate đỏ mỗi lần thêm
    migration hợp lệ, nên bản thân số không còn là bằng chứng. Bất biến thật là:
    chuỗi liên tục 1..N, mọi file khai báo tồn tại đúng hash, head trùng cả pin
    lẫn manifest, và không có file `.sql` lạ nằm ngoài manifest.
    """
    problems: list[str] = []
    migrations = store_manifest.get("migrations", [])
    if not migrations:
        return ["store manifest không khai migration nào"]

    versions = [entry.get("version") for entry in migrations]
    if versions != list(range(1, len(migrations) + 1)):
        problems.append(f"chuỗi migration không liên tục 1..N: {versions}")
    if versions[-1] != store_manifest.get("schemaVersion"):
        problems.append(
            f"schemaVersion {store_manifest.get('schemaVersion')} không bằng migration cuối {versions[-1]}"
        )

    migration_dir = str(store_item.get("migrationDir", ""))
    if not migration_dir:
        return problems + ["store pin thiếu migrationDir"]

    declared: list[str] = []
    for entry in migrations:
        file_name = str(entry.get("file", ""))
        declared.append(file_name)
        try:
            path = safe_path(f"{migration_dir}/{file_name}")
        except ValueError as error:
            problems.append(str(error))
            continue
        if not path.is_file():
            problems.append(f"migration thiếu file: {file_name}")
        elif digest(path) != entry.get("sha256"):
            problems.append(f"migration SHA-256 drift: {file_name}")

    head = declared[-1]
    if store_item.get("migrationPath") != f"{migration_dir}/{head}":
        problems.append("migrationPath ghim không trỏ migration head")
    if store_manifest.get("migrationFile") != head:
        problems.append("manifest migrationFile không trỏ migration head")

    try:
        on_disk = sorted(item.name for item in safe_path(migration_dir).glob("*.sql"))
    except (OSError, ValueError) as error:
        problems.append(str(error))
        return problems
    if on_disk != sorted(declared):
        problems.append(
            f"thư mục migration lệch manifest: đĩa={on_disk} manifest={sorted(declared)}"
        )
    return problems


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
            state["schema"] = 2
        elif step == "core-dual-compatible":
            state["core"] = "v1-dual"
        elif step == "backend":
            state["backend"] = "v1"
        elif step == "frontend-read-only":
            state["frontend"] = "v1-read-only"

    for step in rollback_order:
        state[step] = backup[step]
    state["schema"] = 2  # rollback tự động không downgrade schema.

    for name in REQUIRED_PRESERVE:
        if state[name] != backup[name]:
            return False, state, f"rollback làm đổi {name}"
    if state["commissionCount"] != 0:
        return False, state, "dry-run phát sinh Commission"
    if state["schema"] != 2:
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
    names = {item.get("name") for item in contracts}
    missing = sorted(REQUIRED_CONTRACT_NAMES - names)
    require(not missing, f"G1 thiếu contract bắt buộc: {missing}")
    require(len(names) == len(contracts), "tên contract bị trùng")
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
        require(
            operation_count == openapi_item["operationCount"],
            f"OpenAPI Programming operation lệch pin: file={operation_count} pin={openapi_item['operationCount']}",
        )
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
        # `major` của entry là thế hệ tương thích của *bộ* contract G1 (phải bằng
        # acceptedMajor); `documentMajor/documentMinor` là revision của chính tài
        # liệu profile. Trộn hai khái niệm này là lý do trước đây version bị viết
        # cứng thành 1.0 trong validator.
        require(
            profile["version"]
            == {"major": profile_item["documentMajor"], "minor": profile_item["documentMinor"]},
            f"profile document version drift: file={profile['version']} "
            f"pin={profile_item['documentMajor']}.{profile_item['documentMinor']}",
        )
        require(
            profile["capacity"]["maxProgramsTotal"] == profile_item["maxProgramsTotal"]
            and profile["capacity"]["maxProgramsEnabled"] == profile_item["maxProgramsEnabled"],
            "profile capacity drift so với pin",
        )
        require(
            digest(safe_path(profile_item["schemaPath"])) == profile_item["schemaSha256"],
            "profile schema SHA-256 drift",
        )
        require(
            profile["profileCode"] == profile_item["profileCode"] == artifact_item["compilerProfile"],
            "profile/artifact code lệch",
        )
        require(profile["targetAbi"] == profile_item["targetAbi"], "profile targetAbi drift")
        require(
            artifact_schema["properties"]["schemaVersion"]["const"] == artifact_item["schemaVersion"],
            "artifact schema major drift",
        )
        require(
            artifact_schema["properties"]["compilerProfile"]["const"] == artifact_item["compilerProfile"],
            "artifact compiler profile drift",
        )
        require(digest(artifact_manifest_path) == artifact_item["goldenManifestSha256"], "artifact golden manifest hash drift")
        require(
            artifact_manifest["schemaVersion"] == artifact_item["schemaVersion"]
            and artifact_manifest["compilerProfile"] == artifact_item["compilerProfile"],
            "artifact golden version lệch",
        )
        require(
            profile["integrityMode"] == artifact_manifest["integrityMode"] == profile_item["integrityMode"],
            "integrity mode lệch",
        )
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"profile/artifact: {error}")

    try:
        errors_item = contract_by_name(join, "errors")
        catalog = json.loads(safe_path(errors_item["path"]).read_text())
        manifest_path = safe_path(errors_item["manifestPath"])
        manifest = json.loads(manifest_path.read_text())
        require(digest(manifest_path) == errors_item["manifestSha256"], "error manifest hash drift")
        require(manifest["catalogSha256"] == errors_item["sha256"], "error catalog/manifest hash lệch")
        require(
            len(catalog["publicErrors"])
            == errors_item["publicErrorCount"]
            == manifest["publicErrorCount"],
            "public error count lệch giữa catalog/manifest/pin",
        )
        require(
            len(catalog["componentDetails"])
            == errors_item["componentDetailCount"]
            == manifest["componentDetailCount"],
            "detail error count lệch giữa catalog/manifest/pin",
        )
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"errors: {error}")

    try:
        store_item = contract_by_name(join, "store")
        store_manifest = json.loads(safe_path(store_item["path"]).read_text())
        migration_path = safe_path(store_item["migrationPath"])
        require(digest(migration_path) == store_item["migrationSha256"], "store migration SHA-256 drift")
        require(store_manifest["migrationSha256"] == store_item["migrationSha256"], "store manifest/migration hash lệch")
        require(
            store_manifest["schemaVersion"] == store_item["schemaVersion"],
            f"store schema version drift: manifest={store_manifest['schemaVersion']} pin={store_item['schemaVersion']}",
        )
        errors.extend(validate_migration_chain(store_item, store_manifest))
        require(store_manifest["featureDefaultOff"] is True, "store feature phải OFF")
        require(store_manifest["foreignKeys"] is True and store_manifest["singleWriter"] is True, "store FK/single-writer drift")
        require(store_manifest["journalMode"] == "WAL" and store_manifest["synchronous"] == "FULL", "store PRAGMA drift")
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"store: {error}")

    try:
        artifact_v2_item = contract_by_name(join, "artifact-v2")
        artifact_v2 = json.loads(safe_path(artifact_v2_item["path"]).read_text())
        policy_item = contract_by_name(join, "dual-reader")
        policy = json.loads(safe_path(policy_item["path"]).read_text())
        require(
            digest(safe_path(policy_item["schemaPath"])) == policy_item["schemaSha256"],
            "dual-reader schema SHA-256 drift",
        )
        require(
            artifact_v2["properties"]["schemaVersion"]["const"] == artifact_v2_item["schemaVersion"],
            "artifact v2 schemaVersion drift",
        )
        require(
            artifact_v2["properties"]["magic"]["const"] == artifact_v2_item["magic"],
            "artifact v2 magic drift",
        )
        artifact_item_v1 = contract_by_name(join, "artifact")
        v1_version = json.loads(safe_path(artifact_item_v1["path"]).read_text())
        readable = policy["readableSchemaVersions"]
        writable = policy["writableSchemaVersions"]
        # Bất biến sống còn của dual-reader: mọi version từng ghi được vẫn phải
        # đọc được, nếu không thì LKG cũ mất hiệu lực ngay khi nâng cấp.
        require(
            v1_version["properties"]["schemaVersion"]["const"] in readable,
            "chính sách dual-reader không còn đọc được artifact v1",
        )
        require(
            artifact_v2["properties"]["schemaVersion"]["const"] in readable,
            "chính sách dual-reader không đọc được artifact v2",
        )
        require(set(writable) <= set(readable), "writable không phải tập con của readable")
        require(len(writable) == 1, "chỉ được đúng một version ghi được")
        require(policy["activePackageCount"] == 1, "không được có package Active hỗn hợp")
        require(policy["downgradeActive"] == "FORBIDDEN", "không được tự hạ cấp package Active")
        require(
            policy["unknownSchemaVersion"] == policy["unknownMagic"] == "REJECT_NO_MUTATION",
            "package lạ phải reject no-mutation",
        )
        require(
            sorted(readable) == sorted(policy_item["readableSchemaVersions"]),
            "readableSchemaVersions lệch pin",
        )

        # Golden v2 do writer production sinh (T59-106). Ghim cả file lẫn manifest:
        # golden mà không ghim thì mọi tuyên bố "byte ổn định" chỉ là lời nói.
        golden_path = safe_path(artifact_v2_item["goldenPath"])
        require(golden_path.is_file(), "golden artifact v2 không tồn tại")
        if golden_path.is_file():
            require(digest(golden_path) == artifact_v2_item["goldenSha256"],
                    "golden artifact v2 SHA-256 drift")
            require(golden_path.stat().st_size == artifact_v2_item["goldenArtifactBytes"],
                    "golden artifact v2 kích thước lệch pin")
        golden_manifest_path = safe_path(artifact_v2_item["goldenManifestPath"])
        require(digest(golden_manifest_path) == artifact_v2_item["goldenManifestSha256"],
                "golden manifest v2 SHA-256 drift")
        golden_manifest = json.loads(golden_manifest_path.read_text())
        require(
            golden_manifest["schemaVersion"] == artifact_v2_item["schemaVersion"]
            and golden_manifest["magic"] == artifact_v2_item["magic"],
            "golden manifest v2 lệch schema/magic đã pin",
        )
        require(
            golden_manifest["artifactBytes"] == artifact_v2_item["goldenArtifactBytes"],
            "golden manifest v2 lệch kích thước artifact",
        )
        require(
            golden_manifest["capacity"]["programCount"]
            == artifact_v2_item["goldenProgramCount"],
            "golden manifest v2 lệch số Program đã pin",
        )
        # Bảng section trong manifest phải khớp BẢNG THẬT trong file golden.
        # Không có phép kiểm này thì manifest chỉ là một mô tả viết tay đi kèm,
        # và một lần đổi bố cục section sẽ để lại manifest mô tả một file không
        # còn tồn tại — trong khi hash vẫn "khớp pin" vì pin cũng vừa được sửa.
        if golden_path.is_file():
            require(
                golden_sections(golden_path.read_bytes()) == [
                    {
                        "type": section["type"],
                        "offset": section["offset"],
                        "bytes": section["bytes"],
                        "itemCount": section["itemCount"],
                    }
                    for section in golden_manifest["sections"]
                ],
                "golden manifest v2 lệch bảng section thật trong file",
            )
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"artifact-v2/dual-reader: {error}")

    try:
        registry_item = contract_by_name(join, "library-registry")
        registry = json.loads(safe_path(registry_item["path"]).read_text())
        profile_item = contract_by_name(join, "profile")
        profile = json.loads(safe_path(profile_item["path"]).read_text())
        require(
            digest(safe_path(registry_item["schemaPath"])) == registry_item["schemaSha256"],
            "library registry schema SHA-256 drift",
        )
        require(
            registry["schemaVersion"] == registry_item["schemaVersion"],
            "library registry schemaVersion drift",
        )
        # Registry là nguồn duy nhất của Control Library SYSTEM; profile chỉ giữ
        # version. Hai bên lệch nghĩa là bản sao danh sách hàm đã quay lại.
        require(
            registry["libraryVersion"] == registry_item["libraryVersion"]
            == profile["coreLibrary"]["version"],
            "libraryVersion lệch giữa registry/pin/profile",
        )
        history = registry_item["versionHistory"]
        require(
            isinstance(history, list) and len(history) > 0,
            "library registry thiếu versionHistory",
        )
        history_versions = [item["libraryVersion"] for item in history]
        require(
            len(history_versions) == len(set(history_versions)),
            "library registry versionHistory trùng version",
        )
        current_history = next(
            (item for item in history
             if item["libraryVersion"] == registry["libraryVersion"]),
            None,
        )
        require(
            current_history is not None
            and current_history["sha256"] == registry_item["sha256"],
            "library registry tái sử dụng version với content hash khác",
        )
        gated = [item["featureId"] for item in profile["reviewGatedFeatures"]]
        approved = [
            item["featureId"] for item in profile["reviewGatedFeatures"]
            if item["approvalToken"] is not None
        ]
        require(
            gated == profile_item["reviewGatedFeatures"],
            f"reviewGatedFeatures lệch pin: profile={gated} pin={profile_item['reviewGatedFeatures']}",
        )
        # Danh sách feature ĐÃ DUYỆT được ghim riêng. Mở một feature
        # REVIEW_REQUIRED là quyết định Controls/Safety, không phải một dòng sửa
        # contract lặng lẽ — nên nó phải làm gate đỏ cho tới khi pin đổi theo.
        require(
            approved == profile_item["approvedReviewGatedFeatures"],
            f"approvedReviewGatedFeatures lệch pin: profile={approved} "
            f"pin={profile_item['approvedReviewGatedFeatures']}",
        )
        require(
            "functions" not in profile["coreLibrary"],
            "profile không được giữ bản sao danh sách hàm; registry là nguồn duy nhất",
        )
        entries = registry["entries"]
        require(len(entries) == registry_item["entryCount"], "số entry registry lệch pin")
        for dispatch, key in (("OPERATOR", "operatorCount"),
                              ("FUNC_TABLE", "funcTableCount"),
                              ("FB_TYPE", "fbTypeCount")):
            actual = sum(1 for item in entries if item["dispatch"] == dispatch)
            require(actual == registry_item[key], f"số entry {dispatch} lệch pin")
        review = sorted(
            item["id"] for item in entries if item["featureState"] == "REVIEW_REQUIRED"
        )
        require(review == registry_item["reviewRequired"], "danh sách REVIEW_REQUIRED lệch pin")
        require("PID" in review, "PID phải giữ REVIEW_REQUIRED tới khi có evidence Controls/Safety")
        ghosts = sorted(
            item["id"] for item in entries
            if item["id"] in {"SCALE", "DEADBAND", "CTU", "PI"}
        )
        require(not ghosts, f"entry ma quay lại registry: {ghosts}")
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"library-registry: {error}")

    try:
        bundle_item = contract_by_name(join, "source-bundle")
        bundle_schema = json.loads(safe_path(bundle_item["path"]).read_text())
        require(digest(safe_path(bundle_item["path"])) == bundle_item["sha256"], "source bundle schema SHA-256 drift")
        require(bundle_schema["properties"]["schemaVersion"]["const"] == bundle_item["schemaVersion"] == "1.0", "source bundle major drift")
        require(bundle_schema["properties"]["bundleType"]["const"] == "MKDDC_PROGRAMMING_SOURCE_ONLY", "source bundle type drift")
        require(bundle_schema["properties"]["targetProfile"]["const"] == "MKDDC24_REVA", "source bundle target drift")
        require(bundle_schema["x-mkddc-invariants"]["maximumArchiveBytes"] == bundle_item["maximumArchiveBytes"], "source bundle size drift")
        require(bundle_schema["x-mkddc-invariants"]["maximumFileDescriptors"] == 1024, "source bundle file count drift")
        require(bundle_schema["x-mkddc-invariants"]["maximumEntryBytes"] == 262144, "source bundle entry size drift")
        require(bundle_schema["x-mkddc-invariants"]["pathNormalization"] == "UTF8_NFC_RELATIVE_FORWARD_SLASH", "source bundle path normalization drift")
        require(bundle_schema["x-mkddc-invariants"]["zipMetadata"] == "REGULAR_NON_EXECUTABLE_NO_COMMENT_FIXED_MTIME_ONLY", "source bundle ZIP metadata drift")
        require(bundle_schema["x-mkddc-invariants"]["importResult"] == "NEW_PROJECT_NEW_DRAFT_ONLY", "source bundle import boundary drift")
        forbidden_bundle = set(bundle_schema["x-mkddc-invariants"]["forbidden"])
        require({"ARTIFACT", "NATIVE", "SECRET", "CREDENTIAL", "EXECUTABLE", "SYMLINK", "HARDLINK", "ZIP_COMPRESSION", "ZIP_ENCRYPTION"} <= forbidden_bundle, "source bundle forbidden corpus drift")
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"source-bundle: {error}")

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


def build_mutations(join: dict[str, Any]) -> list[tuple[str, dict[str, Any], str]]:
    """Mỗi mutation kèm mảnh thông điệp bắt buộc phải xuất hiện.

    Chỉ đòi `validate()` trả về danh sách khác rỗng là không đủ: một mutation có
    thể bị chặn nhờ guard khác trong khi guard đang cần chứng minh đã chết. Do đó
    self-test khoá luôn *lý do* reject.
    """
    mutations: list[tuple[str, dict[str, Any], str]] = []

    def add(name: str, expected: str, mutate) -> None:
        candidate = copy.deepcopy(join)
        mutate(candidate)
        mutations.append((name, candidate, expected))

    def set_major(candidate: dict[str, Any]) -> None:
        candidate["contracts"][0]["major"] = 2

    def reverse_deploy(candidate: dict[str, Any]) -> None:
        candidate["deploy"]["order"] = list(reversed(EXPECTED_DEPLOY))

    def enable_commission(candidate: dict[str, Any]) -> None:
        candidate["commissionEnabled"] = True

    def break_hash(candidate: dict[str, Any]) -> None:
        candidate["contracts"][0]["sha256"] = "0" * 64

    def drop_database_preserve(candidate: dict[str, Any]) -> None:
        candidate["deploy"]["preserve"].remove("database")

    def bump_store_schema(candidate: dict[str, Any]) -> None:
        store = contract_by_name(candidate, "store")
        store["schemaVersion"] += 1

    def point_at_old_migration(candidate: dict[str, Any]) -> None:
        store = contract_by_name(candidate, "store")
        store["migrationPath"] = f"{store['migrationDir']}/0001_programming_v1.sql"

    def drop_migration_dir(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "store").pop("migrationDir")

    def shrink_detail_count(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "errors")["componentDetailCount"] -= 1

    def grow_public_count(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "errors")["publicErrorCount"] += 1

    def grow_operation_count(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "openapi")["operationCount"] += 1

    def break_openapi_version(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "openapi")["version"] = "0.0.0"

    add("unknown-major", "major không tương thích", set_major)
    add("deploy-order", "thứ tự deploy sai", reverse_deploy)
    add("commission-on", "G1 không được bật Commission", enable_commission)
    add("hash-drift", "SHA-256 drift", break_hash)
    add("destructive-rollback", "rollback preserve set sai", drop_database_preserve)
    add("store-schema-version-drift", "store schema version drift", bump_store_schema)
    add("store-migration-head-drift", "migration head", point_at_old_migration)
    add("store-migration-dir-missing", "thiếu migrationDir", drop_migration_dir)
    add("error-detail-count-drift", "detail error count lệch", shrink_detail_count)
    add("public-error-count-drift", "public error count lệch", grow_public_count)
    add("openapi-operation-count-drift", "operation lệch pin", grow_operation_count)
    add("openapi-version-drift", "OpenAPI version drift", break_openapi_version)

    def bump_profile_document_major(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "profile")["documentMajor"] += 1

    def shrink_capacity(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "profile")["maxProgramsTotal"] = 1

    def shrink_enabled(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "profile")["maxProgramsEnabled"] = 1

    def break_profile_schema_hash(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "profile")["schemaSha256"] = "0" * 64

    def break_target_abi(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "profile")["targetAbi"] += 1

    def break_integrity_mode(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "profile")["integrityMode"] = "SIGNED"

    def drop_required_contract(candidate: dict[str, Any]) -> None:
        candidate["contracts"] = [
            item for item in candidate["contracts"] if item.get("name") != "store"
        ]

    def duplicate_contract_name(candidate: dict[str, Any]) -> None:
        clone = copy.deepcopy(contract_by_name(candidate, "profile"))
        candidate["contracts"].append(clone)

    add("profile-document-major-drift", "document version drift", bump_profile_document_major)
    add("profile-capacity-total-drift", "capacity drift", shrink_capacity)
    add("profile-capacity-enabled-drift", "capacity drift", shrink_enabled)
    add("profile-schema-hash-drift", "profile schema SHA-256 drift", break_profile_schema_hash)
    add("profile-target-abi-drift", "targetAbi drift", break_target_abi)
    add("profile-integrity-mode-drift", "integrity mode lệch", break_integrity_mode)
    add("required-contract-missing", "thiếu contract bắt buộc", drop_required_contract)
    add("duplicate-contract-name", "tên contract bị trùng", duplicate_contract_name)

    def break_registry_entry_count(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "library-registry")["entryCount"] += 1

    def break_registry_fb_count(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "library-registry")["fbTypeCount"] -= 1

    def break_registry_library_version(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "library-registry")["libraryVersion"] = "khong-khop"

    def clear_review_required(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "library-registry")["reviewRequired"] = []

    def approve_review_gated_feature(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "profile")["approvedReviewGatedFeatures"] = ["PID"]

    def drop_review_gated_feature(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "profile")["reviewGatedFeatures"] = []

    add("review-gate-approved-drift", "approvedReviewGatedFeatures lệch pin", approve_review_gated_feature)
    add("review-gate-list-drift", "reviewGatedFeatures lệch pin", drop_review_gated_feature)

    def break_registry_schema_hash(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "library-registry")["schemaSha256"] = "0" * 64

    def break_registry_version_history(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "library-registry")["versionHistory"][0]["sha256"] = "0" * 64

    add("registry-entry-count-drift", "số entry registry lệch pin", break_registry_entry_count)
    add("registry-fb-count-drift", "số entry FB_TYPE lệch pin", break_registry_fb_count)
    add("registry-library-version-drift", "libraryVersion lệch", break_registry_library_version)
    add("registry-review-required-cleared", "REVIEW_REQUIRED lệch pin", clear_review_required)
    add("registry-schema-hash-drift", "library registry schema SHA-256 drift", break_registry_schema_hash)
    add("registry-version-history-drift", "tái sử dụng version", break_registry_version_history)

    def drop_v1_readable(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "dual-reader")["readableSchemaVersions"] = [2]

    def break_artifact_v2_pin(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "artifact-v2")["schemaVersion"] = 3

    def break_policy_schema_hash(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "dual-reader")["schemaSha256"] = "0" * 64

    add("dual-reader-drops-v1", "readableSchemaVersions lệch pin", drop_v1_readable)
    add("artifact-v2-schema-version-drift", "artifact v2 schemaVersion drift", break_artifact_v2_pin)
    add("dual-reader-schema-hash-drift", "dual-reader schema SHA-256 drift", break_policy_schema_hash)

    def break_golden_v2_hash(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "artifact-v2")["goldenSha256"] = "0" * 64

    def break_golden_v2_size(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "artifact-v2")["goldenArtifactBytes"] += 1

    def break_golden_v2_program_count(candidate: dict[str, Any]) -> None:
        contract_by_name(candidate, "artifact-v2")["goldenProgramCount"] += 1

    add("golden-v2-hash-drift", "golden artifact v2 SHA-256 drift", break_golden_v2_hash)
    add("golden-v2-size-drift", "kích thước lệch pin", break_golden_v2_size)
    add("golden-v2-program-count-drift", "số Program đã pin", break_golden_v2_program_count)
    return mutations


def run_chain_self_test() -> int:
    """Negative case cho chuỗi migration mà mutation trên join không chạm tới."""
    store_item = {
        "migrationDir": "apps/web-api/internal/programming/store/migrations",
        "migrationPath": "apps/web-api/internal/programming/store/migrations/0001_programming_v1.sql",
    }
    cases: list[tuple[str, dict[str, Any], str]] = [
        ("empty-chain", {"schemaVersion": 1, "migrations": []}, "không khai migration nào"),
        (
            "gap-in-chain",
            {
                "schemaVersion": 2,
                "migrationFile": "0001_programming_v1.sql",
                "migrations": [
                    {"version": 1, "file": "0001_programming_v1.sql", "sha256": "0" * 64},
                    {"version": 3, "file": "0003_check_worker.sql", "sha256": "0" * 64},
                ],
            },
            "không liên tục",
        ),
        (
            "version-vs-head",
            {
                "schemaVersion": 9,
                "migrationFile": "0001_programming_v1.sql",
                "migrations": [
                    {"version": 1, "file": "0001_programming_v1.sql", "sha256": "0" * 64}
                ],
            },
            "không bằng migration cuối",
        ),
        (
            "missing-file",
            {
                "schemaVersion": 1,
                "migrationFile": "9999_khong_ton_tai.sql",
                "migrations": [
                    {"version": 1, "file": "9999_khong_ton_tai.sql", "sha256": "0" * 64}
                ],
            },
            "migration thiếu file",
        ),
        (
            "sha-drift",
            {
                "schemaVersion": 1,
                "migrationFile": "0001_programming_v1.sql",
                "migrations": [
                    {"version": 1, "file": "0001_programming_v1.sql", "sha256": "0" * 64}
                ],
            },
            "migration SHA-256 drift",
        ),
        (
            "path-traversal",
            {
                "schemaVersion": 1,
                "migrationFile": "../../../../etc/passwd",
                "migrations": [
                    {"version": 1, "file": "../../../../etc/passwd", "sha256": "0" * 64}
                ],
            },
            "không an toàn",
        ),
    ]
    for name, manifest, expected in cases:
        problems = validate_migration_chain(store_item, manifest)
        if not any(expected in problem for problem in problems):
            raise RuntimeError(
                f"chain self-test {name} không báo đúng lý do; thực tế: {problems}"
            )
    return len(cases)


def run_golden_section_self_test() -> int:
    """Negative case cho phép so bảng section.

    Không đi qua `build_mutations` được vì bộ đó chỉ đột biến file join, còn bảng
    section nằm trong file manifest. Kiểm thẳng phép so: nó phải KHỚP với file
    golden thật, và phải TỪ CHỐI khi một trường bất kỳ bị xê dịch.
    """
    golden = safe_path("contracts/programming/golden/package_v2_ahu.mkpkg").read_bytes()
    manifest = json.loads(
        safe_path("contracts/programming/golden/package_v2_manifest.json").read_text()
    )
    actual = golden_sections(golden)
    declared = [
        {key: section[key] for key in ("type", "offset", "bytes", "itemCount")}
        for section in manifest["sections"]
    ]
    if actual != declared:
        raise RuntimeError(f"bảng section golden lệch manifest: {actual} != {declared}")
    cases = 0
    for field in ("offset", "bytes", "itemCount"):
        for index in range(len(declared)):
            perturbed = copy.deepcopy(declared)
            perturbed[index][field] += 1
            if actual == perturbed:
                raise RuntimeError(f"phép so bỏ qua sai lệch {field} ở section {index}")
            cases += 1
    perturbed = copy.deepcopy(declared)
    perturbed[0]["type"] = "CONSTANTS"
    if actual == perturbed:
        raise RuntimeError("phép so bỏ qua sai lệch loại section")
    cases += 1
    print(f"PASS bảng section golden: {cases}/{cases} sai lệch bị bắt")
    return cases


def run_self_test(join: dict[str, Any]) -> None:
    mutations = build_mutations(join)
    for name, mutation, expected in mutations:
        problems = validate(mutation)
        if not problems:
            raise RuntimeError(f"self-test {name} không bị reject")
        if not any(expected in problem for problem in problems):
            raise RuntimeError(
                f"self-test {name} bị reject sai lý do; mong đợi {expected!r}, thực tế: {problems}"
            )
    print(f"PASS self-test: {len(mutations)}/{len(mutations)} mutation bị reject fail-closed đúng lý do")

    run_golden_section_self_test()
    chain_cases = run_chain_self_test()
    print(f"PASS chuỗi migration: {chain_cases}/{chain_cases} manifest lỗi bị bắt đúng lý do")

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
    total = len(join.get("contracts", []))
    accepted = join.get("compatibility", {}).get("acceptedMajor")
    print(
        f"PASS: {total}/{total} contract G1 cùng major {accepted}; "
        "hash/version/deploy/rollback/flag khớp"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
