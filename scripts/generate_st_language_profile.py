#!/usr/bin/env python3
"""Sinh ST Language Profile phiên bản hoá từ CHÍNH compiler (`ISS-STED-06`).

`F-STED-005`/`F-STED-007` — gate `G1` FAIL vì không có hồ sơ ngôn ngữ nào khớp
code đang phát hành, và hai tài liệu ngôn ngữ sai theo hai hướng NGƯỢC NHAU:

  * `DDD-LANG-PROG-001` §4.1 tuyên bố *"`CASE` … ngoài subset; parser reject
    rõ"* trong khi `st_parser.cpp` `parse_case()` chấp nhận đầy đủ;
  * `ST_SUBSET_SPEC` §11 tuyên bố parser phủ **40%** grammar và ghim ở một
    commit từ lâu, trong khi `INT`, `TIME`, `ELSIF`, `XOR`, số học, gọi FB,
    truy cập thành viên và chú thích đều đã có.

Một bảng đối chiếu sai 100% nguy hiểm hơn không có bảng, vì nó trông như bằng
chứng. Script này thay bảng chép tay bằng một hồ sơ SINH RA, cộng một cổng
`--check` làm đỏ ngay khi code trôi khỏi hồ sơ.

Kiến trúc — ba nguồn, một hợp đồng:

  1. `mkddc-st-profile-dump` (C++, link thẳng `st_compiler_lib`) nói *sự thật
     đang phát hành*: kiểu + miền giá trị, storage class, POU kind, giới hạn,
     chữ ký FB chuẩn, arity hàm chuẩn, và — quan trọng nhất — câu lệnh/toán tử
     nào compiler THẬT SỰ nhận, xác định bằng cách parse thử chứ không bằng
     cách đọc tên hàm `parse_*`.
  2. `st_parser.cpp` `kKeywords[]` và `st_program.cpp` `kFuncs[]` cho danh sách
     TÊN ứng viên. Chúng chỉ là đầu vào; binary mới là trọng tài.
  3. `st_language_profile_v1.curated.json` giữ phần code không tự nói được:
     LÝ DO loại trừ và nhãn "mở rộng nhà sản xuất" (ADR-054).

Cổng quan trọng nhất không phải "hồ sơ có mới không" mà là **đối chiếu hai
phía**: mọi mục trong `deliberateExclusions` phải THẬT SỰ bị compiler từ chối.
Một mục nói "loại trừ" mà parser vẫn chấp nhận làm build ĐỎ — đó đúng là
`F-STED-005`, và cổng này khiến nó không thể tái diễn trong im lặng.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
PARSER_SOURCE = ROOT / "apps/core/application/st/st_parser.cpp"
PROGRAM_SOURCE = ROOT / "apps/core/application/st/st_program.cpp"
DIAGNOSTIC_SOURCE = ROOT / "apps/core/application/st/st_diagnostic.hpp"
CURATED = ROOT / "contracts/programming/st_language_profile_v1.curated.json"
PROFILE_OUTPUT = ROOT / "contracts/programming/st_language_profile_v1.json"
SCHEMA_OUTPUT = ROOT / "contracts/programming/st_language_profile_v1.schema.json"
DOC_OUTPUT = ROOT / "docs/02_design/software/ST_LANGUAGE_PROFILE.generated.md"
# ISS-STED-18 — phiên bản hồ sơ đi kèm TỪNG diagnostic để FE biết kết quả Check
# có còn nói về ngôn ngữ đang chạy hay không. Sinh hằng số cho Go và TS từ cùng
# một nguồn: chép tay hai chỗ thì sớm muộn một chỗ trôi, và khi đó "so khớp
# phiên bản" biến thành một phép so luôn đúng — tệ hơn không so.
GO_OUTPUT = ROOT / "apps/web-api/internal/programming/domain/stprofile_generated.go"
TS_OUTPUT = ROOT / "apps/web-ui/src/features/programming/api/generated/stLanguageProfile.ts"

KEYWORD_TABLE = re.compile(r"static const char\* kKeywords\[\] = \{(.*?)\};", re.S)
KEYWORD = re.compile(r'"([A-Z_0-9]+)"')
FUNC_TABLE = re.compile(r"const FuncSpec kFuncs\[\] = \{(.*?)\};", re.S)
FUNC_NAME = re.compile(r'\{"([A-Z_0-9]+)"')
DIAG_CODE = re.compile(r'"(ST-[A-Z]+-[0-9]{3})"')


def die(message: str) -> None:
    raise SystemExit(f"generate_st_language_profile: {message}")


def keywords() -> list[str]:
    table = KEYWORD_TABLE.search(PARSER_SOURCE.read_text(encoding="utf-8"))
    if table is None:
        die(
            f"không tìm thấy kKeywords[] trong {PARSER_SOURCE.relative_to(ROOT)}. "
            "Bảng đổi tên/cấu trúc thì cổng này phải ĐỎ, không được âm thầm sinh "
            "danh sách rỗng — danh sách rỗng làm mọi đối chiếu đều 'đúng' và cổng tự tắt."
        )
    words = KEYWORD.findall(table.group(1))
    if len(words) < 40:
        die(f"chỉ đọc được {len(words)} từ khoá — nghi ngờ trích sai, dừng lại")
    return words


def function_names() -> list[str]:
    table = FUNC_TABLE.search(PROGRAM_SOURCE.read_text(encoding="utf-8"))
    if table is None:
        die(f"không tìm thấy kFuncs[] trong {PROGRAM_SOURCE.relative_to(ROOT)}")
    names = FUNC_NAME.findall(table.group(1))
    if len(names) < 10:
        die(f"chỉ đọc được {len(names)} hàm chuẩn — nghi ngờ trích sai, dừng lại")
    return names


def diagnostic_codes() -> list[str]:
    codes = sorted(set(DIAG_CODE.findall(DIAGNOSTIC_SOURCE.read_text(encoding="utf-8"))))
    if len(codes) < 30:
        die(f"chỉ đọc được {len(codes)} mã diagnostic — nghi ngờ trích sai, dừng lại")
    return codes


def dump_from_compiler(binary: Path, candidates: list[str]) -> dict[str, Any]:
    if not binary.exists():
        die(
            f"không thấy {binary}. Hồ sơ PHẢI sinh từ binary compiler, không chép tay: "
            "build target `mkddc-st-profile-dump` trước."
        )
    result = subprocess.run(
        [str(binary), *candidates], capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        die(f"mkddc-st-profile-dump thoát {result.returncode}: {result.stderr.strip()}")
    return json.loads(result.stdout)


def cross_check(dumped: dict[str, Any], curated: dict[str, Any], candidates: list[str]) -> None:
    """Đối chiếu hai phía giữa hồ sơ con người và hành vi compiler.

    Đây là phần có giá trị nhất của script. Ba câu hỏi, mỗi câu là một chế độ
    hỏng đã từng xảy ra thật:
      1. Có mục nào tuyên bố "loại trừ" mà compiler vẫn nhận? (`F-STED-005`)
      2. Có cấu trúc nào compiler nhận mà hồ sơ không hề nhắc tới?
      3. Tên "mở rộng nhà sản xuất" có thật sự tồn tại trong thư viện không?
    """
    accepted: set[str] = set()
    rejected: set[str] = set()
    for item in dumped["statements"]:
        (accepted if item["accepted"] else rejected).add(item["name"])
    for item in dumped["operators"]:
        (accepted if item["accepted"] else rejected).add(item["symbol"])

    problems: list[str] = []

    excluded = {item["construct"] for item in curated["deliberateExclusions"]}
    for item in curated["deliberateExclusions"]:
        name = item["construct"]
        if name in accepted:
            problems.append(
                f"'{name}' được khai là LOẠI TRỪ nhưng compiler CHẤP NHẬN nó. "
                "Đây đúng là chế độ hỏng F-STED-005: tài liệu nói một đằng, parser làm một nẻo. "
                "Sửa hồ sơ hoặc sửa parser — không được để cả hai cùng tồn tại."
            )

    # Chiều thứ hai: compiler TỪ CHỐI một thứ mà không ai ghi lý do. Đây là
    # cách "loại trừ im lặng" ra đời — người dùng gặp ST-SYN-001 cho một cấu
    # trúc IEC hợp lệ và không có chỗ nào nói vì sao. ADR-054 phán quyết (3)
    # bắt buộc loại trừ phải CÔNG BỐ KÈM LÝ DO, nên thiếu lý do là lỗi hợp đồng
    # chứ không phải thiếu sót tài liệu.
    for name in sorted(rejected):
        if name not in excluded:
            problems.append(
                f"compiler TỪ CHỐI '{name}' nhưng hồ sơ không ghi lý do loại trừ. "
                "ADR-054 buộc mọi loại trừ phải công bố kèm lý do — thêm mục vào "
                "`deliberateExclusions` của tệp curated."
            )

    library = {entry["name"] for entry in dumped["standardFunctions"]} | {
        entry["name"] for entry in dumped["standardFunctionBlocks"]
    }

    # Chiều thứ ba (`ISS-STED-08`): loại trừ ở tầng THƯ VIỆN và HỆ KIỂU.
    #
    # Hai vòng lặp phía trên chỉ phủ statement và operator, vì chỉ hai nhóm đó
    # được dumper đo bằng cách cho parser nuốt thật một mẫu. Nhưng `F-STED-005`
    # không phân biệt tầng: một mục khai "không có `SIN`" trong khi compiler đã
    # có `SIN` sai đúng y như một mục khai "không có `CASE`" trong khi đã có
    # `CASE`. Trước cổng này, mọi tuyên bố loại trừ về hàm/FB/kiểu là lời nói
    # suông — và tệ hơn, nó sẽ vẫn xanh vào đúng ngày ai đó hiện thực hoá chúng.
    scalar_type_names = {entry["name"] for entry in dumped["scalarTypes"]}
    for item in curated["deliberateExclusions"]:
        name = item["construct"]
        kind = item["kind"]
        if kind in ("function", "functionBlock") and name in library:
            problems.append(
                f"'{name}' được khai là LOẠI TRỪ nhưng thư viện chuẩn của compiler CÓ nó. "
                "Tuyên bố loại trừ phải đúng ở mọi tầng, không riêng statement/operator."
            )
        if kind == "type" and name in scalar_type_names:
            problems.append(
                f"kiểu '{name}' được khai là LOẠI TRỪ nhưng compiler nhận nó như một kiểu cơ sở. "
                "Sửa hồ sơ hoặc sửa compiler — không được để cả hai cùng tồn tại."
            )

    # Một mục `plannedAdditions` đã được hiện thực hoá thì không còn là "dự
    # kiến": để nguyên sẽ khiến tài liệu hứa hẹn một thứ đã giao, và người đọc
    # đi tìm nó trong tương lai thay vì dùng ngay.
    for item in curated["plannedAdditions"]:
        name = item["construct"]
        if name in library or name in scalar_type_names or name in accepted:
            problems.append(
                f"'{name}' nằm ở `plannedAdditions` nhưng compiler ĐÃ CÓ nó. "
                "Chuyển nó ra khỏi danh sách dự kiến — tài liệu đang hứa một thứ đã giao."
            )
    for item in curated["vendorExtensions"]:
        if item["name"] not in library:
            problems.append(
                f"'{item['name']}' được đánh dấu là mở rộng nhà sản xuất nhưng thư viện chuẩn "
                "của compiler không có nó. Nhãn trỏ vào khoảng không."
            )

    missing_funcs = sorted(
        set(candidates) - {entry["name"] for entry in dumped["standardFunctions"]}
    )
    if missing_funcs:
        problems.append(
            f"kFuncs[] khai {missing_funcs} nhưng st_func_from_name() không phân giải được. "
            "Bảng tên và bộ phân giải đã trôi khỏi nhau."
        )

    if problems:
        die("hồ sơ mâu thuẫn với compiler:\n  - " + "\n  - ".join(problems))


def build_profile(dumped: dict[str, Any], curated: dict[str, Any],
                  reserved: list[str], codes: list[str]) -> dict[str, Any]:
    vendor_names = {item["name"] for item in curated["vendorExtensions"]}

    def mark(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Đánh dấu mở rộng nhà sản xuất ngay trên từng mục thư viện.

        ADR-054 phán quyết (2): IEC cho phép mở rộng miễn là CÔNG BỐ RÕ. Công
        bố ở một mục riêng cuối tài liệu thì người đọc bảng thư viện không thấy;
        nhãn phải nằm ngay cạnh cái tên."""
        for entry in entries:
            entry["vendorExtension"] = entry["name"] in vendor_names
        return entries

    profile: dict[str, Any] = {
        "schemaVersion": 1,
        "profileVersion": curated["profileVersion"],
        "iecBaseline": curated["iecBaseline"],
        "conformanceClaim": curated["conformanceClaim"],
        "compilerVersion": dumped["compilerVersion"],
        "targetProfileId": dumped["targetProfileId"],
        "targetAbi": dumped["targetAbi"],
        "grammar": curated["grammar"],
        "scalarTypes": dumped["scalarTypes"],
        "storageClasses": dumped["storageClasses"],
        "pouKinds": dumped["pouKinds"],
        "statements": dumped["statements"],
        "operators": dumped["operators"],
        "standardFunctions": mark(dumped["standardFunctions"]),
        "standardFunctionBlocks": mark(dumped["standardFunctionBlocks"]),
        "reservedWords": reserved,
        "limits": dumped["limits"],
        "diagnosticCodes": codes,
        "deliberateExclusions": curated["deliberateExclusions"],
        "plannedAdditions": curated["plannedAdditions"],
        "vendorExtensions": curated["vendorExtensions"],
    }
    body = json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    profile["sha256"] = hashlib.sha256(body.encode("utf-8")).hexdigest()
    return profile


def render_json(profile: dict[str, Any]) -> str:
    return json.dumps(profile, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://mekong-hcm.vn/contracts/programming/st_language_profile_v1.schema.json",
    "title": "ST Language Profile v1",
    "description": (
        "Hồ sơ ngôn ngữ ST phiên bản hoá, SINH TỰ ĐỘNG từ compiler bởi "
        "scripts/generate_st_language_profile.py. Không sửa tay."
    ),
    "type": "object",
    "required": [
        "schemaVersion", "profileVersion", "sha256", "iecBaseline", "conformanceClaim",
        "compilerVersion", "targetProfileId", "targetAbi", "grammar", "scalarTypes",
        "storageClasses", "pouKinds", "statements", "operators", "standardFunctions",
        "standardFunctionBlocks", "reservedWords", "limits", "diagnosticCodes",
        "deliberateExclusions", "plannedAdditions", "vendorExtensions",
    ],
    "additionalProperties": False,
    "properties": {
        "schemaVersion": {"const": 1},
        "profileVersion": {"type": "string", "pattern": r"^\d+\.\d+\.\d+$"},
        "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        "iecBaseline": {"type": "string", "minLength": 1},
        "conformanceClaim": {"type": "string", "minLength": 1},
        "compilerVersion": {"type": "string", "minLength": 1},
        "targetProfileId": {"type": "string", "minLength": 1},
        "targetAbi": {"type": "integer"},
        "grammar": {
            "type": "object",
            "required": ["notation", "rules"],
            "additionalProperties": False,
            "properties": {
                "notation": {"type": "string"},
                "rules": {"type": "array", "minItems": 1, "items": {"type": "string"}},
            },
        },
        "scalarTypes": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object",
                "required": ["name", "wireCode", "isInteger"],
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"}, "wireCode": {"type": "integer"},
                    "isInteger": {"type": "boolean"}, "isSigned": {"type": "boolean"},
                    "min": {"type": "integer"}, "max": {"type": "integer"},
                },
            },
        },
        "storageClasses": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object", "required": ["name", "wireCode"],
                "additionalProperties": False,
                "properties": {"name": {"type": "string"}, "wireCode": {"type": "integer"}},
            },
        },
        "pouKinds": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object", "required": ["name", "wireCode"],
                "additionalProperties": False,
                "properties": {"name": {"type": "string"}, "wireCode": {"type": "integer"}},
            },
        },
        "statements": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object", "required": ["name", "accepted"],
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"}, "accepted": {"type": "boolean"},
                    "rejectedWith": {"type": "string"},
                },
            },
        },
        "operators": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object", "required": ["symbol", "accepted"],
                "additionalProperties": False,
                "properties": {
                    "symbol": {"type": "string"}, "accepted": {"type": "boolean"},
                    "rejectedWith": {"type": "string"},
                },
            },
        },
        "standardFunctions": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object", "required": ["name", "arity", "vendorExtension"],
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"}, "arity": {"type": "integer"},
                    "vendorExtension": {"type": "boolean"},
                },
            },
        },
        "standardFunctionBlocks": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object",
                "required": ["name", "wireCode", "inputs", "outputs", "vendorExtension"],
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"}, "wireCode": {"type": "integer"},
                    "vendorExtension": {"type": "boolean"},
                    "inputs": {"$ref": "#/$defs/ports"},
                    "outputs": {"$ref": "#/$defs/ports"},
                },
            },
        },
        "reservedWords": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        "limits": {"type": "object", "additionalProperties": {"type": "integer"}},
        "diagnosticCodes": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        "deliberateExclusions": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object",
                "required": ["construct", "kind", "inIec", "reason", "authority"],
                "additionalProperties": False,
                "properties": {
                    "construct": {"type": "string"}, "kind": {"type": "string"},
                    "inIec": {"type": "boolean"},
                    "reason": {"type": "string", "minLength": 20},
                    "authority": {"type": "string", "minLength": 1},
                },
            },
        },
        "plannedAdditions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["construct", "wave", "note", "authority", "issue"],
                "additionalProperties": False,
                "properties": {
                    "construct": {"type": "string"}, "wave": {"type": "string"},
                    "note": {"type": "string"}, "authority": {"type": "string"},
                    "issue": {"type": ["integer", "null"]},
                },
            },
        },
        "vendorExtensions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name", "kind", "reason", "authority"],
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"}, "kind": {"type": "string"},
                    "reason": {"type": "string", "minLength": 20},
                    "authority": {"type": "string"},
                },
            },
        },
    },
    "$defs": {
        "ports": {
            "type": "array",
            "items": {
                "type": "object", "required": ["name", "type"],
                "additionalProperties": False,
                "properties": {"name": {"type": "string"}, "type": {"type": "string"}},
            },
        },
    },
}


def render_go(profile: dict[str, Any]) -> str:
    return f"""// Code generated by scripts/generate_st_language_profile.py; DO NOT EDIT.
package domain

// STLanguageProfileVersion là phiên bản hồ sơ ngôn ngữ ST mà backend đang chạy.
//
// Đi kèm TỪNG diagnostic (ISS-STED-18): một kết quả Check sinh ra dưới hồ sơ cũ
// có thể nói về một ngôn ngữ khác với ngôn ngữ người dùng đang gõ, và người đọc
// không có cách nào tự biết điều đó.
const STLanguageProfileVersion = {json.dumps(profile["profileVersion"])}

// STLanguageProfileSHA256 nhận diện chính xác nội dung hồ sơ. Phiên bản có thể
// giữ nguyên qua một lần sinh lại (ví dụ compiler đổi mà profileVersion chưa
// nâng); hash thì không.
const STLanguageProfileSHA256 = {json.dumps(profile["sha256"])}
"""


def render_ts(profile: dict[str, Any]) -> str:
    return f"""/* SINH TỰ ĐỘNG bởi `scripts/generate_st_language_profile.py` — KHÔNG sửa tay.
 * Nguồn: `contracts/programming/st_language_profile_v1.json`.
 *
 * `ISS-STED-18` — FE so phiên bản này với `stLanguageProfileVersion` của từng
 * diagnostic để biết kết quả Check có còn nói về ngôn ngữ đang chạy không.
 * Chép tay giá trị này ở hai nơi sẽ biến phép so thành một phép so luôn đúng.
 */
export const ST_LANGUAGE_PROFILE_VERSION = {json.dumps(profile["profileVersion"])}
export const ST_LANGUAGE_PROFILE_SHA256 = {json.dumps(profile["sha256"])}
"""


def render_schema() -> str:
    return json.dumps(SCHEMA, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def render_doc(profile: dict[str, Any]) -> str:
    def yesno(value: bool) -> str:
        return "có" if value else "**không**"

    types = "\n".join(
        f"| `{item['name']}` | {item['wireCode']} | "
        + (f"`{item['min']}` … `{item['max']}`" if "min" in item else "—")
        + " |"
        for item in profile["scalarTypes"]
    )
    statements = "\n".join(
        f"| `{item['name']}` | {yesno(item['accepted'])} | "
        + (f"`{item['rejectedWith']}`" if not item["accepted"] else "—")
        + " |"
        for item in profile["statements"]
    )
    operators = "\n".join(
        f"| `{item['symbol']}` | {yesno(item['accepted'])} |" for item in profile["operators"]
    )
    functions = "\n".join(
        f"| `{item['name']}` | {item['arity']} | "
        + ("**mở rộng nhà sản xuất**" if item["vendorExtension"] else "IEC")
        + " |"
        for item in profile["standardFunctions"]
    )
    blocks = "\n".join(
        "| `{name}` | {ins} | {outs} | {tag} |".format(
            name=item["name"],
            ins=", ".join(f"`{p['name']}`:{p['type']}" for p in item["inputs"]) or "—",
            outs=", ".join(f"`{p['name']}`:{p['type']}" for p in item["outputs"]) or "—",
            tag="**mở rộng nhà sản xuất**" if item["vendorExtension"] else "IEC",
        )
        for item in profile["standardFunctionBlocks"]
    )
    limits = "\n".join(f"| `{key}` | {value} |" for key, value in sorted(profile["limits"].items()))
    exclusions = "\n".join(
        f"| `{item['construct']}` | {item['kind']} | {yesno(item['inIec'])} | "
        f"{item['reason']} | {item['authority']} |"
        for item in profile["deliberateExclusions"]
    )
    planned = "\n".join(
        "| `{c}` | {w} | {n} | {a} | {i} |".format(
            c=item["construct"], w=item["wave"], n=item["note"], a=item["authority"],
            i=f"#{item['issue']}" if item["issue"] else "—",
        )
        for item in profile["plannedAdditions"]
    )
    grammar = "\n".join(profile["grammar"]["rules"])

    return f"""# ST Language Profile — MK-DDC-24

> **SINH TỰ ĐỘNG** bởi `scripts/generate_st_language_profile.py` từ chính
> compiler. **Không sửa tay** — mọi sửa tay sẽ bị `--check` trong `ctest` xoá bỏ.
>
> Tài liệu này thay thế `ST_SUBSET_SPEC` §10 (EBNF) và §11 (bảng đối chiếu
> parser). Lý do thay: §11 tuyên bố parser phủ *40%* grammar và ghim ở một
> commit từ lâu, trong khi thực tế khác hẳn. **Một bảng đối chiếu sai 100%
> nguy hiểm hơn không có bảng, vì nó trông như bằng chứng** (`F-STED-007`).

| Trường | Giá trị |
|---|---|
| Phiên bản hồ sơ | `{profile['profileVersion']}` |
| `sha256` | `{profile['sha256']}` |
| Phiên bản compiler | `{profile['compilerVersion']}` |
| Target profile | `{profile['targetProfileId']}` (ABI `{profile['targetAbi']}`) |
| Chuẩn nền | {profile['iecBaseline']} |
| Tuyên bố phù hợp | {profile['conformanceClaim']} |

## 1. Kiểu vô hướng

| Kiểu | Mã wire | Miền giá trị |
|---|---|---|
{types}

## 2. Câu lệnh

Cột "chấp nhận" đo bằng cách **parse thật** một mẫu tối thiểu cho mỗi dạng,
không bằng cách đọc tên hàm `parse_*` trong source. Chỉ phép thử thật mới phân
biệt được *tài liệu nói gì* với *code làm gì* — đúng chỗ `DDD-LANG-PROG-001`
§4.1 từng sai về `CASE` (`F-STED-005`).

| Câu lệnh | Chấp nhận | Mã từ chối |
|---|---|---|
{statements}

## 3. Toán tử

| Toán tử | Chấp nhận |
|---|---|
{operators}

## 4. Hàm chuẩn

| Hàm | Arity | Nguồn gốc |
|---|---|---|
{functions}

## 5. Function Block chuẩn

| FB | Đầu vào | Đầu ra | Nguồn gốc |
|---|---|---|---|
{blocks}

## 6. Giới hạn tài nguyên

| Giới hạn | Giá trị |
|---|---|
{limits}

## 7. Cố ý không có, kèm lý do

`ADR-054` phán quyết: nguyên tắc *"làm chuẩn theo IEC: có thì giữ, không có thì
bỏ"* áp cho **cú pháp/ngữ nghĩa ngôn ngữ**. Loại trừ một thứ IEC **có** thì phải
**công bố kèm lý do** — đó là nội dung bảng này.

| Cấu trúc | Loại | IEC có? | Lý do loại trừ | Thẩm quyền |
|---|---|---|---|---|
{exclusions}

## 8. Lộ trình bổ sung

| Cấu trúc | Đợt | Ghi chú | Thẩm quyền | Issue |
|---|---|---|---|---|
{planned}

## 9. Văn phạm (EBNF)

```ebnf
{grammar}
```

## 10. Mã diagnostic

{", ".join(f"`{code}`" for code in profile["diagnosticCodes"])}

## 11. Từ khoá giữ chỗ

{", ".join(f"`{word}`" for word in profile["reservedWords"])}
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="chỉ so, không ghi")
    parser.add_argument(
        "--dump-binary",
        default=str(ROOT / "build/fw/core/mkddc-st-profile-dump"),
        help="đường dẫn mkddc-st-profile-dump",
    )
    parser.add_argument(
        "--curated",
        default=str(CURATED),
        # `ISS-STED-08`: chỉ để KIỂM CHÍNH CỔNG. Một cổng chưa bao giờ được
        # thấy nổ đỏ thì không ai biết nó còn nổ hay không — và một cổng hỏng
        # im lặng còn tệ hơn không có cổng, vì nó phát ra tín hiệu "đã kiểm".
        # `verify_st_profile_gate.py` tiêm hồ sơ sai qua tuỳ chọn này và đòi
        # generator phải thoát khác 0.
        help="hồ sơ curated thay thế (chỉ dùng để tự kiểm cổng)",
    )
    parser.add_argument(
        "--cross-check-only",
        action="store_true",
        help="chỉ chạy đối chiếu hai chiều rồi thoát (dùng để tự kiểm cổng)",
    )
    args = parser.parse_args()

    candidates = function_names()
    dumped = dump_from_compiler(Path(args.dump_binary), candidates)
    curated = json.loads(Path(args.curated).read_text(encoding="utf-8"))
    cross_check(dumped, curated, candidates)
    if args.cross_check_only:
        print("OK: hồ sơ curated không mâu thuẫn với compiler.")
        return 0

    profile = build_profile(dumped, curated, keywords(), diagnostic_codes())

    # Thi hành schema NGAY TẠI ĐÂY, không chỉ băm nó. Trước T59-004 catalog lỗi
    # chỉ băm schema chứ không thi hành, và schema đã trôi khỏi dữ liệu suốt
    # nhiều revision mà không cổng nào bắt. Không lặp lại lối đó.
    Draft202012Validator.check_schema(SCHEMA)
    violations = sorted(
        Draft202012Validator(SCHEMA).iter_errors(profile),
        key=lambda item: list(item.absolute_path),
    )
    if violations:
        die(
            "hồ sơ không khớp schema:\n  - "
            + "\n  - ".join(
                f"{'/'.join(str(part) for part in item.absolute_path) or '<root>'}: {item.message}"
                for item in violations
            )
        )

    rendered_json = render_json(profile)
    rendered_schema = render_schema()
    rendered_doc = render_doc(profile)

    outputs = [
        (PROFILE_OUTPUT, rendered_json),
        (SCHEMA_OUTPUT, rendered_schema),
        (DOC_OUTPUT, rendered_doc),
        (GO_OUTPUT, render_go(profile)),
        (TS_OUTPUT, render_ts(profile)),
    ]

    if args.check:
        stale = [
            path for path, rendered in outputs
            if (path.read_text(encoding="utf-8") if path.exists() else "") != rendered
        ]
        if stale:
            print(
                "LỆCH: code đã trôi khỏi ST Language Profile.\n"
                + "".join(f"  - {path.relative_to(ROOT)}\n" for path in stale)
                + "Chạy `python3 scripts/generate_st_language_profile.py` rồi commit lại.",
                file=sys.stderr,
            )
            return 1
        print(f"OK: ST Language Profile khớp compiler (sha256 {profile['sha256'][:16]}…).")
        return 0

    for path, rendered in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered, encoding="utf-8")
        print(f"Đã ghi {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
