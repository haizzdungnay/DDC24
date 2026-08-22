#!/usr/bin/env python3
"""Kiểm mọi action IPC khai trong contract có đúng trạng thái handler thật.

Vì sao cần: `TRACE_START` nằm trong enum wire, trong codec C++ và trong codec Go,
nhưng Core không có nhánh dispatch nào — nó rơi vào `else` và trả
`IPC-ACTION-NOT-IMPLEMENTED`. Đó là "action ma": contract hứa một hành động mà
sản phẩm không làm, và không gate nào phát hiện.

Script kiểm HAI CHIỀU nên cả hai lỗi đều bị chặn:
  - action khai IMPLEMENTED mà không có nhánh dispatch;
  - action khai NOT_IMPLEMENTED mà thực ra đã có nhánh (khai thấp hơn sự thật,
    khiến người đọc contract tưởng tính năng chưa có).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "contracts/ipc/programming_v1/schema.json"
CORE_SERVER = ROOT / "apps/core/application/programming/program_ipc_server.cpp"
CORE_HEADER = ROOT / "apps/core/application/programming/program_ipc_server.hpp"
GO_CODEC = ROOT / "apps/web-api/internal/programming/coreipc/codec.go"

# Tên enum C++ tương ứng mỗi action, lấy từ chính bảng `action_name()`.
ACTION_ENUM = re.compile(r'case ProgramAction::(\w+): return "([A-Z_]+)";')
DISPATCH = re.compile(r"request\.action == ProgramAction::(\w+)")
GO_ACTION = re.compile(r'Action\w+\s+Action = "([A-Z_]+)"')


def load() -> dict[str, Any]:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    meta = schema.get("x-mkddc-actions")
    if not meta:
        raise ValueError("schema IPC thiếu khối x-mkddc-actions")
    return schema


def enum_actions(schema: dict[str, Any]) -> list[str]:
    for item in schema["$defs"]["request"]["prefixItems"]:
        if item.get("title") == "action":
            return list(item["enum"])
    raise ValueError("không tìm thấy trường action trong schema request")


def validate(schema: dict[str, Any], server_override: str | None = None) -> list[str]:
    """`server_override` chỉ dùng cho self-test.

    Mutation trên schema KHÔNG mô phỏng được ca "khai IMPLEMENTED nhưng Core
    không có nhánh dispatch" — muốn dựng ca đó phải bỏ một nhánh khỏi mã nguồn
    Core, mà mã nguồn thì mutation không chạm được. Cho phép tiêm nội dung nguồn
    là cách duy nhất để self-test kiểm chính phép kiểm đó thay vì kiểm một ca
    khác rồi tưởng là đã phủ.
    """
    problems: list[str] = []
    meta = schema["x-mkddc-actions"]
    declared = {item["action"]: item for item in meta["entries"]}
    wire = enum_actions(schema)

    missing = sorted(set(wire) - set(declared))
    if missing:
        problems.append(f"action trong enum wire nhưng chưa khai trạng thái: {missing}")
    extra = sorted(set(declared) - set(wire))
    if extra:
        problems.append(f"action khai trạng thái nhưng không có trong enum wire: {extra}")

    server = server_override if server_override is not None else CORE_SERVER.read_text(encoding="utf-8")
    enum_by_action = {name: enum for enum, name in ACTION_ENUM.findall(server)}
    dispatched = set(DISPATCH.findall(server))

    go_actions = set(GO_ACTION.findall(GO_CODEC.read_text(encoding="utf-8")))
    go_missing = sorted(set(wire) - go_actions)
    if go_missing:
        problems.append(f"codec Go thiếu hằng cho action: {go_missing}")

    for action in wire:
        entry = declared.get(action)
        if entry is None:
            continue
        status = entry["handlerStatus"]
        # Luật "NOT_IMPLEMENTED phải ghi task sẽ hiện thực" thuần schema — kiểm
        # TRƯỚC khi tra codec C++. Đặt sau sẽ làm một action bịa (chưa có enum
        # C++) thoát khỏi luật này chỉ vì nó thoát sớm ở phép kiểm khác.
        if status == "NOT_IMPLEMENTED" and not entry.get("implementedBy"):
            problems.append(f"{action}: NOT_IMPLEMENTED phải ghi task sẽ hiện thực")
        enum_name = enum_by_action.get(action)
        if enum_name is None:
            problems.append(f"{action}: codec C++ không khai enum tương ứng")
            continue
        has_branch = enum_name in dispatched
        if status == "IMPLEMENTED" and not has_branch:
            problems.append(f"{action}: khai IMPLEMENTED nhưng Core không có nhánh dispatch")
        if status == "NOT_IMPLEMENTED" and has_branch:
            problems.append(
                f"{action}: khai NOT_IMPLEMENTED nhưng Core đã có nhánh dispatch"
            )

    detail = meta.get("notImplementedDetailCode")
    if not detail or detail not in server:
        problems.append(
            f"Core không trả detail code {detail!r} cho action chưa hiện thực"
        )

    catalog = json.loads((ROOT / "contracts/programming/error_catalog_v1.json").read_text())
    mapped = {item["detailCode"] for item in catalog["componentDetails"]}
    if detail and detail not in mapped:
        problems.append(f"{detail} chưa được map trong error catalog")
    return problems


def run_self_test(schema: dict[str, Any]) -> int:
    import copy

    # Các mutation KHÔNG được bám vào một action cụ thể đang NOT_IMPLEMENTED.
    # Bản trước dùng `TRACE_START` làm ví dụ, nên khi `T59-408` hiện thực nó thì
    # hai mutation trở thành no-op và self-test xanh mà không kiểm gì — đúng lớp
    # lỗi mà self-test sinh ra để chặn. Nay mutation TỰ TIÊM một action giả.
    def add_wire_action(schema: dict[str, Any], name: str) -> None:
        """Thêm `name` vào enum wire của cả request lẫn response."""
        for prefix in ("request", "response"):
            for item in schema["$defs"][prefix]["prefixItems"]:
                if item.get("title") == "action":
                    item["enum"].append(name)

    def ghost_action(schema: dict[str, Any], status: str, owner_task: bool) -> None:
        add_wire_action(schema, "GHOST_ACTION")
        entry = {"action": "GHOST_ACTION", "handlerStatus": status,
                 "mutation": False, "owner": "Core"}
        if owner_task:
            entry["implementedBy"] = "T99-999"
        schema["x-mkddc-actions"]["entries"].append(entry)

    mutations = [
        # Action bịa: không có ở codec nào, phải bị chặn vì chính lý do đó.
        ("ghost-action-not-in-codec", "codec C++ không khai enum tương ứng",
         lambda s: ghost_action(s, "IMPLEMENTED", False), None),
        # Ca "IMPLEMENTED nhưng không có nhánh": tiêm nguồn Core đã bị bỏ nhánh
        # `STATUS` — schema giữ nguyên.
        ("implemented-without-handler", "khai IMPLEMENTED nhưng Core không có nhánh dispatch",
         lambda s: None,
         lambda text: text.replace("request.action == ProgramAction::Status", "false")),
        ("not-implemented-with-handler", "khai NOT_IMPLEMENTED nhưng Core đã có nhánh dispatch",
         lambda s: next(item for item in s["x-mkddc-actions"]["entries"]
                        if item["action"] == "STATUS").__setitem__("handlerStatus", "NOT_IMPLEMENTED"),
         None),
        ("missing-owner-task", "phải ghi task sẽ hiện thực",
         lambda s: ghost_action(s, "NOT_IMPLEMENTED", False), None),
        ("undeclared-wire-action", "chưa khai trạng thái",
         lambda s: s["x-mkddc-actions"]["entries"].pop(), None),
    ]
    for name, expected, mutate, mutate_server in mutations:
        candidate = copy.deepcopy(schema)
        mutate(candidate)
        server_text = None
        if mutate_server is not None:
            server_text = mutate_server(CORE_SERVER.read_text(encoding="utf-8"))
        problems = validate(candidate, server_text)
        if not any(expected in problem for problem in problems):
            raise RuntimeError(f"self-test {name} không bị reject đúng lý do: {problems}")
    return len(mutations)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        schema = load()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    problems = validate(schema)
    if problems:
        for problem in problems:
            print(f"FAIL: {problem}", file=sys.stderr)
        return 1
    if args.self_test:
        count = run_self_test(schema)
        print(f"PASS self-test: {count}/{count} mutation action bị reject đúng lý do")
    meta = schema["x-mkddc-actions"]["entries"]
    implemented = sum(1 for item in meta if item["handlerStatus"] == "IMPLEMENTED")
    print(
        f"PASS: {len(meta)} action IPC khai đúng trạng thái handler "
        f"({implemented} IMPLEMENTED, {len(meta) - implemented} NOT_IMPLEMENTED có chủ)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
