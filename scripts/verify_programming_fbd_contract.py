#!/usr/bin/env python3
"""Kiểm schema, canonical semantics và keyboard registry của FBD Rev A."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "contracts/programming"
SCHEMA_PATH = BASE / "fbd_v1.schema.json"
GOLDEN_PATH = BASE / "fbd/golden/ahu_fan_enable.json"
KEYBOARD_PATH = BASE / "fbd_keyboard_commands_v1.json"
PROFILE_PATH = BASE / "rev_a_profile_v1.json"
MANIFEST_PATH = BASE / "fbd/manifest.json"
EQUIVALENCE_PATH = BASE / "fbd/equivalence_v1.json"

SCALAR_TYPES = {"BOOL", "INT", "DINT", "UINT", "REAL", "TIME"}
PURE_FUNCTIONS = {
    "AND", "OR", "XOR", "NOT", "EQ", "NE", "LT", "LE", "GT", "GE",
    "ADD", "SUB", "MUL", "DIV", "MOD", "ABS", "MIN", "MAX", "LIMIT",
    "SEL", "SCALE", "DEADBAND",
}
STATEFUL_FUNCTIONS = {"TON", "TOF", "R_TRIG", "F_TRIG", "CTU", "PI", "PID"}
CONVERSIONS = {
    "INT_TO_DINT", "INT_TO_UINT", "DINT_TO_INT", "DINT_TO_UINT",
    "UINT_TO_INT", "UINT_TO_DINT", "DINT_TO_REAL", "UINT_TO_REAL",
    "REAL_TO_DINT", "REAL_TO_UINT",
}
EXPECTED_COMMANDS = {
    "ADD_NETWORK": "Control+Shift+n",
    "ADD_BLOCK": "Insert",
    "SELECT_NEXT_PORT": "ArrowDown",
    "SELECT_PREVIOUS_PORT": "ArrowUp",
    "BEGIN_OR_COMMIT_CONNECTION": "Enter",
    "CANCEL_CONNECTION": "Escape",
    "DELETE_SELECTION": "Delete",
    "MOVE_NODE_UP": "Alt+ArrowUp",
    "MOVE_NODE_DOWN": "Alt+ArrowDown",
    "UNDO": "Control+z",
    "REDO": "Control+y",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"khóa JSON trùng: {key}")
        result[key] = value
    return result


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=strict_object)
    if not isinstance(value, dict):
        raise ValueError(f"{path.relative_to(ROOT)} phải là object")
    return value


def canonical_bytes(value: dict[str, Any]) -> bytes:
    candidate = copy.deepcopy(value)
    candidate["networks"].sort(key=lambda item: (item["order"], item["id"]))
    for network in candidate["networks"]:
        network["nodes"].sort(key=lambda item: (item["executionOrder"], item["id"]))
        for node in network["nodes"]:
            node["ports"].sort(key=lambda item: (item["order"], item["id"]))
        network["wires"].sort(key=lambda item: item["id"])
    return json.dumps(candidate, ensure_ascii=False, separators=(",", ":")).encode()


def validate_graph(
    graph: dict[str, Any], schema: dict[str, Any], profile: dict[str, Any]
) -> list[str]:
    errors = [f"schema: {item.json_path}: {item.message}"
              for item in Draft202012Validator(schema).iter_errors(graph)]
    if errors:
        return errors

    limits = profile["resources"]
    ids = {graph["graphId"]}
    network_orders: set[int] = set()
    total_nodes = 0
    total_wires = 0
    for network in graph["networks"]:
        if network["id"] in ids:
            errors.append(f"id trùng: {network['id']}")
        ids.add(network["id"])
        if network["order"] in network_orders:
            errors.append(f"network order trùng: {network['order']}")
        network_orders.add(network["order"])
        total_nodes += len(network["nodes"])
        total_wires += len(network["wires"])
        execution_orders: set[int] = set()
        ports: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
        nodes: dict[str, dict[str, Any]] = {}
        for node in network["nodes"]:
            if node["id"] in ids:
                errors.append(f"id trùng: {node['id']}")
            ids.add(node["id"])
            nodes[node["id"]] = node
            if node["executionOrder"] in execution_orders:
                errors.append(f"executionOrder trùng: {node['executionOrder']}")
            execution_orders.add(node["executionOrder"])
            kind = node["kind"]
            type_ref = node["typeRef"]
            allowed = (
                SCALAR_TYPES if kind in {"INPUT", "OUTPUT", "CONSTANT"}
                else PURE_FUNCTIONS if kind == "FUNCTION"
                else STATEFUL_FUNCTIONS if kind == "FUNCTION_BLOCK"
                else CONVERSIONS
            )
            if type_ref not in allowed:
                errors.append(f"kind/typeRef không hợp lệ: {kind}/{type_ref}")
            input_count = sum(port["direction"] == "INPUT" for port in node["ports"])
            output_count = sum(port["direction"] == "OUTPUT" for port in node["ports"])
            if kind in {"INPUT", "CONSTANT"} and (input_count or not output_count):
                errors.append(f"port shape không hợp lệ: {node['id']}")
            if kind == "OUTPUT" and (not input_count or output_count):
                errors.append(f"port shape không hợp lệ: {node['id']}")
            if kind in {"FUNCTION", "FUNCTION_BLOCK", "CONVERSION"} and (
                not input_count or not output_count
            ):
                errors.append(f"port shape không hợp lệ: {node['id']}")
            port_orders: set[int] = set()
            port_names: set[str] = set()
            for port in node["ports"]:
                if port["id"] in ids:
                    errors.append(f"id trùng: {port['id']}")
                ids.add(port["id"])
                if port["order"] in port_orders or port["name"] in port_names:
                    errors.append(f"port order/name trùng: {node['id']}")
                port_orders.add(port["order"])
                port_names.add(port["name"])
                ports[port["id"]] = (node, port)

        driven: set[str] = set()
        for wire in network["wires"]:
            if wire["id"] in ids:
                errors.append(f"id trùng: {wire['id']}")
            ids.add(wire["id"])
            source = ports.get(wire["from"]["portId"])
            target = ports.get(wire["to"]["portId"])
            if not source or not target:
                errors.append(f"endpoint không tồn tại: {wire['id']}")
                continue
            if source[0]["id"] != wire["from"]["nodeId"] or target[0]["id"] != wire["to"]["nodeId"]:
                errors.append(f"node/port endpoint không khớp: {wire['id']}")
                continue
            if source[1]["direction"] != "OUTPUT" or target[1]["direction"] != "INPUT":
                errors.append(f"hướng wire không hợp lệ: {wire['id']}")
            if source[1]["dataType"] != target[1]["dataType"] or source[1]["unit"] != target[1]["unit"]:
                errors.append(f"type/unit wire không khớp: {wire['id']}")
            if target[1]["id"] in driven:
                errors.append(f"input có nhiều driver: {target[1]['id']}")
            driven.add(target[1]["id"])
            if source[0]["kind"] != "FUNCTION_BLOCK" and target[0]["kind"] != "FUNCTION_BLOCK":
                if source[0]["executionOrder"] >= target[0]["executionOrder"]:
                    errors.append(f"thứ tự combinational ngược: {wire['id']}")
    if total_nodes > limits["maxFbdBlocks"]:
        errors.append("vượt maxFbdBlocks")
    if total_wires > limits["maxFbdConnections"]:
        errors.append("vượt maxFbdConnections")
    if len(canonical_bytes(graph)) > limits["maxSourceBytes"]:
        errors.append("canonical FBD vượt maxSourceBytes")
    return errors


def validate_keyboard(registry: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if registry.get("contractId") != "PROGRAMMING-FBD-KEYBOARD-V1" or registry.get("version") != 1:
        errors.append("keyboard contract/version sai")
    if registry.get("historyLimit") != 50:
        errors.append("historyLimit phải là 50")
    commands = registry.get("commands", [])
    by_id = {item.get("id"): item.get("key") for item in commands}
    if len(by_id) != len(commands):
        errors.append("command id trùng")
    if len({item.get("key") for item in commands}) != len(commands):
        errors.append("keyboard shortcut trùng")
    if by_id != EXPECTED_COMMANDS:
        errors.append("tập command/shortcut drift")
    for item in commands:
        if set(item) != {"id", "key", "mutatesDraft", "requiresSelection", "messageKey"}:
            errors.append(f"field command sai: {item.get('id')}")
    return errors


def validate_equivalence(equivalence: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if equivalence.get("contractId") != "PROGRAMMING-FBD-EQUIVALENCE-V1":
        errors.append("equivalence contractId sai")
    if equivalence.get("version") != 1 or equivalence.get("profileId") != "revA-1t-1-5-30":
        errors.append("equivalence version/profile sai")
    pairs = equivalence.get("pairs")
    if not isinstance(pairs, list) or len(pairs) != 20:
        return errors + ["equivalence phải có đúng 20 cặp"]
    ids = [item.get("id") for item in pairs if isinstance(item, dict)]
    type_refs = [item.get("typeRef") for item in pairs if isinstance(item, dict)]
    if ids != [f"EQ-{index:03d}" for index in range(1, 21)]:
        errors.append("equivalence id/order drift")
    if len(set(type_refs)) != 20:
        errors.append("equivalence typeRef phải unique 20/20")
    for item in pairs:
        if not isinstance(item, dict) or set(item) != {
            "id", "typeRef", "inputs", "outputType", "stExpression", "vector"
        }:
            errors.append("equivalence pair field drift")
            continue
        if item["typeRef"] not in PURE_FUNCTIONS - {"SCALE", "DEADBAND"}:
            errors.append(f"equivalence typeRef không thuộc common IR: {item['typeRef']}")
        if not isinstance(item["inputs"], list) or not item["inputs"]:
            errors.append(f"equivalence inputs rỗng: {item['id']}")
        if item["outputType"] not in SCALAR_TYPES:
            errors.append(f"equivalence output type sai: {item['id']}")
        vector = item.get("vector")
        if not isinstance(vector, dict) or set(vector) != {"values", "expected"}:
            errors.append(f"equivalence vector sai: {item['id']}")
    return errors


def validate_manifest(
    manifest: dict[str, Any], graph: dict[str, Any], keyboard: dict[str, Any],
    equivalence: dict[str, Any]
) -> list[str]:
    expected = {
        "contractId": "PROGRAMMING-FBD-V1",
        "version": 1,
        "lowererVersion": "fwsom-fbd-1.0.0",
        "profileId": "revA-1t-1-5-30",
        "schemaSha256": digest(SCHEMA_PATH),
        "keyboardSha256": digest(KEYBOARD_PATH),
        "goldenSha256": digest(GOLDEN_PATH),
        "equivalenceSha256": digest(EQUIVALENCE_PATH),
        "profileSha256": digest(PROFILE_PATH),
        "goldenNetworkCount": len(graph["networks"]),
        "goldenNodeCount": sum(len(item["nodes"]) for item in graph["networks"]),
        "goldenWireCount": sum(len(item["wires"]) for item in graph["networks"]),
        "keyboardCommandCount": len(keyboard["commands"]),
        "equivalencePairCount": len(equivalence["pairs"]),
    }
    return [] if manifest == expected else ["manifest/hash/count drift"]


def validate_all(
    graph: dict[str, Any], schema: dict[str, Any], profile: dict[str, Any],
    keyboard: dict[str, Any], manifest: dict[str, Any], equivalence: dict[str, Any]
) -> list[str]:
    errors: list[str] = []
    try:
        Draft202012Validator.check_schema(schema)
    except Exception as error:  # jsonschema phân loại exception theo version.
        errors.append(f"schema FBD không hợp lệ: {error}")
    errors.extend(validate_graph(graph, schema, profile))
    errors.extend(validate_keyboard(keyboard))
    errors.extend(validate_equivalence(equivalence))
    errors.extend(validate_manifest(manifest, graph, keyboard, equivalence))
    return errors


def run_self_test(
    graph: dict[str, Any], schema: dict[str, Any], profile: dict[str, Any],
    keyboard: dict[str, Any], manifest: dict[str, Any], equivalence: dict[str, Any]
) -> None:
    mutations: list[tuple[str, dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    candidate = copy.deepcopy(graph); candidate["profileId"] = "attacker"; mutations.append(("profile", candidate, keyboard, manifest))
    candidate = copy.deepcopy(graph); candidate["networks"][0]["nodes"][1]["id"] = candidate["networks"][0]["nodes"][0]["id"]; mutations.append(("id", candidate, keyboard, manifest))
    candidate = copy.deepcopy(graph); candidate["networks"][0]["nodes"][1]["executionOrder"] = 0; mutations.append(("order", candidate, keyboard, manifest))
    candidate = copy.deepcopy(graph); candidate["networks"][0]["wires"][0]["to"]["portId"] = "ffffffff-ffff-4fff-8fff-ffffffffffff"; mutations.append(("dangling", candidate, keyboard, manifest))
    candidate = copy.deepcopy(graph); candidate["networks"][0]["nodes"][2]["ports"][0]["dataType"] = "REAL"; mutations.append(("type", candidate, keyboard, manifest))
    candidate = copy.deepcopy(graph); candidate["networks"][0]["nodes"][2]["typeRef"] = "TON"; mutations.append(("type-ref", candidate, keyboard, manifest))
    candidate = copy.deepcopy(graph); candidate["networks"][0]["wires"].append(copy.deepcopy(candidate["networks"][0]["wires"][0])); candidate["networks"][0]["wires"][-1]["id"] = "50000000-0000-4000-8000-000000000004"; mutations.append(("driver", candidate, keyboard, manifest))
    keyboard_candidate = copy.deepcopy(keyboard); keyboard_candidate["commands"][0]["key"] = "Insert"; mutations.append(("shortcut", graph, keyboard_candidate, manifest))
    keyboard_candidate = copy.deepcopy(keyboard); keyboard_candidate["historyLimit"] = 49; mutations.append(("history", graph, keyboard_candidate, manifest))
    manifest_candidate = copy.deepcopy(manifest); manifest_candidate["schemaSha256"] = "0" * 64; mutations.append(("hash", graph, keyboard, manifest_candidate))
    for name, graph_candidate, keyboard_candidate, manifest_candidate in mutations:
        if not validate_all(
            graph_candidate, schema, profile, keyboard_candidate, manifest_candidate, equivalence
        ):
            raise RuntimeError(f"mutation {name} không bị reject")
    print(f"PASS self-test: {len(mutations)}/{len(mutations)} mutation bị reject fail-closed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        schema = read_json(SCHEMA_PATH)
        graph = read_json(GOLDEN_PATH)
        keyboard = read_json(KEYBOARD_PATH)
        profile = read_json(PROFILE_PATH)
        manifest = read_json(MANIFEST_PATH)
        equivalence = read_json(EQUIVALENCE_PATH)
        errors = validate_all(graph, schema, profile, keyboard, manifest, equivalence)
        if errors:
            for error in errors:
                print(f"FAIL: {error}", file=sys.stderr)
            return 1
        if args.self_test:
            run_self_test(graph, schema, profile, keyboard, manifest, equivalence)
    except (OSError, ValueError, json.JSONDecodeError, RuntimeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: FBD schema/golden/profile/keyboard/equivalence/manifest khớp; canonical semantics hợp lệ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
