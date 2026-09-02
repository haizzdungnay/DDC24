#!/usr/bin/env python3
"""Kiểm hợp đồng phím của ST editor (`ISS-STED-14` / `F-STED-014`, gate `G16`).

VÌ SAO CẦN
----------
FBD có `fbd_keyboard_commands_v1.json` với validator từ lâu. ST thì không —
dù ST editor mới là nơi có NHIỀU phím tắt hơn. Không có hợp đồng nghĩa là
không có test nào chặn việc một phím bị đổi hoặc mất trong một lần refactor,
và một phím tắt biến mất là loại hồi quy người dùng phát hiện trước CI.

BA CHIỀU KIỂM
-------------
1. **Schema** — hình dạng hợp đồng.
2. **Không đụng độ nội bộ** — hai lệnh cùng phím trong cùng ngữ cảnh là một
   hợp đồng tự mâu thuẫn; chỉ một trong hai chạy được, và không ai biết cái nào.
3. **Đối chiếu với CODE THẬT** — mọi tổ hợp phím hợp đồng khai phải xuất hiện
   trong `ProgramsTab.tsx`. Đây là chiều quan trọng nhất: một hợp đồng không đối
   chiếu với code chỉ là một tài liệu, và tài liệu thì trôi.

`--self-test` tiêm hợp đồng sai một cách đã biết và đòi validator phải nổ đỏ.
Một cổng chưa bao giờ được thấy nổ thì không ai biết nó còn nổ hay không.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import re
import sys
from typing import Any

from jsonschema import Draft202012Validator

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts/programming/st_keyboard_commands_v1.json"
SCHEMA_PATH = ROOT / "contracts/programming/st_keyboard_commands_v1.schema.json"
SOURCE_PATH = ROOT / "apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def key_appears_in_source(key: str, source: str) -> bool:
    """Tổ hợp phím có thật sự được xử lý trong mã nguồn không.

    So ở mức TỪNG THÀNH PHẦN chứ không so nguyên chuỗi: mã nguồn viết
    `event.ctrlKey || event.metaKey` cùng `event.key.toLowerCase() === 'g'`,
    không viết `"Control+g"` ở đâu cả. Đòi khớp nguyên chuỗi sẽ là một cổng
    luôn đỏ, và một cổng luôn đỏ bị tắt ngay trong tuần đầu.
    """
    parts = key.split("+")
    base = parts[-1]
    # Phím tên dài (`Enter`, `Escape`, `ArrowDown`, `F12`, `Tab`) so nguyên văn;
    # phím một ký tự so theo dạng chữ thường mà mã nguồn dùng.
    if len(base) == 1:
        # Ký tự phải escape trong literal JS (`\\`, `'`) xuất hiện ở mã nguồn
        # dưới dạng đã escape. So dạng thô sẽ không bao giờ khớp — và một cổng
        # báo sai về một phím CÓ THẬT còn tệ hơn không có cổng, vì nó dạy người
        # sửa đi xoá dòng hợp đồng đúng.
        escaped = base.replace("\\", "\\\\").replace("'", "\\'")
        candidates = {base.lower(), base, escaped, escaped.lower()}
        patterns = [form for value in candidates
                    for form in (f"=== '{value}'", f'=== "{value}"')]
    else:
        patterns = [f"=== '{base}'", f'=== "{base}"']
    return any(pattern in source for pattern in patterns)


def validate(contract: Any, schema: Any, source: str) -> list[str]:
    errors: list[str] = []

    Draft202012Validator.check_schema(schema)
    for violation in sorted(Draft202012Validator(schema).iter_errors(contract),
                            key=lambda item: list(item.absolute_path)):
        path = "/".join(str(part) for part in violation.absolute_path) or "<root>"
        errors.append(f"schema {path}: {violation.message}")
    if errors:
        return errors

    commands = contract["commands"]
    contexts = contract["contexts"]

    seen_ids: set[str] = set()
    seen_bindings: set[tuple[str, str]] = set()
    for command in commands:
        cid = command["id"]
        if cid in seen_ids:
            errors.append(f"lệnh '{cid}' bị khai hai lần")
        seen_ids.add(cid)

        if command["context"] not in contexts:
            errors.append(
                f"lệnh '{cid}' dùng context '{command['context']}' không có trong bảng `contexts`. "
                "Một ngữ cảnh không định nghĩa thì không ai biết phím có hiệu lực ở đâu."
            )

        binding = (command["key"], command["context"])
        if binding in seen_bindings:
            errors.append(
                f"phím '{command['key']}' bị gán hai lần trong cùng context '{command['context']}'. "
                "Chỉ một trong hai lệnh chạy được, và hợp đồng không nói được là cái nào."
            )
        seen_bindings.add(binding)

        # Phím trình duyệt chiếm trước mà mã nguồn KHÔNG gọi `preventDefault()`
        # nghĩa là cả hai cùng chạy: hộp In mở đè lên bảng lệnh vừa bật. Hợp
        # đồng khai `browserConflict` thì mã nguồn phải thật sự giành lại phím.
        if command.get("browserConflict") and "preventDefault" not in source:
            errors.append(
                f"lệnh '{cid}' khai xung đột với trình duyệt nhưng mã nguồn không gọi "
                "preventDefault() ở đâu cả — phím sẽ chạy cả hai đường."
            )

        if not key_appears_in_source(command["key"], source):
            errors.append(
                f"lệnh '{cid}' khai phím '{command['key']}' nhưng không tìm thấy đường xử lý nào "
                f"trong {SOURCE_PATH.name}. Hợp đồng đang mô tả một phím không tồn tại."
            )

    return errors


def run_self_test(contract: Any, schema: Any, source: str) -> None:
    """Tiêm hợp đồng sai và đòi validator nổ đỏ từng ca."""
    mutations: list[tuple[str, Any]] = []

    duplicate_binding = copy.deepcopy(contract)
    first = duplicate_binding["commands"][0]
    duplicate_binding["commands"].append({**first, "id": f"{first['id']}_COPY"})
    mutations.append(("hai lệnh cùng phím trong cùng context", duplicate_binding))

    unknown_context = copy.deepcopy(contract)
    unknown_context["commands"][0]["context"] = "khong_ton_tai"
    mutations.append(("context không có trong bảng", unknown_context))

    ghost_key = copy.deepcopy(contract)
    ghost_key["commands"][0]["key"] = "Control+Shift+q"
    mutations.append(("phím không có đường xử lý trong mã nguồn", ghost_key))

    duplicate_id = copy.deepcopy(contract)
    duplicate_id["commands"].append(copy.deepcopy(duplicate_id["commands"][1]))
    mutations.append(("lệnh khai trùng id", duplicate_id))

    bad_shape = copy.deepcopy(contract)
    del bad_shape["commands"][0]["description"]
    mutations.append(("thiếu trường bắt buộc", bad_shape))

    for name, mutated in mutations:
        if not validate(mutated, schema, source):
            raise RuntimeError(
                f"self-test hỏng: '{name}' KHÔNG bị bắt. Cổng đã ngừng kiểm chiều này."
            )
    print(f"PASS self-test: {len(mutations)}/{len(mutations)} hợp đồng sai bị reject fail-closed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        contract = read_json(CONTRACT_PATH)
        schema = read_json(SCHEMA_PATH)
        source = SOURCE_PATH.read_text(encoding="utf-8")
        errors = validate(contract, schema, source)
        if errors:
            for error in errors:
                print(f"FAIL: {error}", file=sys.stderr)
            return 1
        if args.self_test:
            run_self_test(contract, schema, source)
    except (OSError, ValueError, json.JSONDecodeError, RuntimeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print(f"PASS: hợp đồng phím ST khớp mã nguồn ({len(contract['commands'])} lệnh, "
          f"{len(contract['contexts'])} ngữ cảnh)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
