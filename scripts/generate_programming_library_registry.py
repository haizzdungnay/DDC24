#!/usr/bin/env python3
"""Sinh registry C++/Go/TypeScript từ authority POU/Control Library.

Vì sao cần: trước đây danh sách entry tồn tại **ba** bản chép tay —
`st_fbd_model.cpp` (allowlist FBD của Core), `palette.ts` (palette FE) và
`coreLibrary.functions` trong profile. Ba bản đó đã trôi khỏi nhau thật:
Core cho phép `SCALE`/`DEADBAND`/`CTU`/`PI` mà compiler không có, đồng thời
**từ chối** `SQRT` và bốn conversion mà FE vẫn chào người dùng.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from typing import Any
import unicodedata

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "contracts/programming/pou_library_registry_v1.json"
SCHEMA = ROOT / "contracts/programming/pou_library_registry_v1.schema.json"
PROFILE = ROOT / "contracts/programming/product_profile_v2.json"
G1_JOIN = ROOT / "contracts/programming/g1_contract_join_v1.json"
# `ISS-STED-17` — nguồn DUY NHẤT của danh sách mở rộng nhà sản xuất.
#
# `ADR-054` điểm 3: IEC cho phép mở rộng nhà sản xuất miễn là ĐÁNH DẤU RÕ. Danh
# sách bốn khối đó (`PID`, `HYSTERESIS`, `SCALE`, `DEADBAND`) đã sống ở hồ sơ
# ngôn ngữ curated kèm lý do từng mục; đọc lại từ đó thay vì gõ một cột thứ hai
# vào registry. Một cột chép tay sẽ trôi khỏi hồ sơ đúng vào ngày ai đó thêm
# khối mở rộng thứ năm.
LANGUAGE_PROFILE_CURATED = ROOT / "contracts/programming/st_language_profile_v1.curated.json"
CPP_OUTPUT = ROOT / "apps/core/application/st/st_library_registry_generated.hpp"
TS_OUTPUT = ROOT / "apps/web-ui/src/features/programming/api/generated/library_registry.ts"
GO_OUTPUT = ROOT / "apps/web-api/internal/programming/domain/library_registry_generated.go"


# `T61-102` / `D61-09` — HAI TẬP FIELD TÁCH BẠCH, và đây là trọng tâm của lát này.
#
# `contentSha256` là danh tính THỰC THI: nó nói "gọi khối này thì máy làm gì".
# Nó đi vào artifact, vào chữ ký và vào pin của Revision. Nếu sửa một dòng mô tả
# hay gắn thêm một cái thẻ mà nó đổi, thì mọi artifact và pin đã ký thành lỗi
# thời chỉ vì một lần sửa chính tả — và hậu quả thật không phải "phải build lại",
# mà là người ta sẽ thôi không sửa tài liệu nữa.
#
# Trước lát này, generator băm TOÀN BỘ entry vào `ContentSHA256Hex`, nên
# `labelVi`, `labelEn` và `category` — ba thứ thuần trình bày — đang nằm trong
# danh tính thực thi. Chính comment của hàm ấy đã tự nhận "hash này ghim
# signature/port/category/dispatch, KHÔNG phải hash executable", nhưng tên trường
# nó gán vào lại là `ContentSHA256Hex`, và hợp đồng public gọi trường đó là
# "danh tính THỰC THI". Hai câu ấy không thể cùng đúng.
EXECUTABLE_FIELDS = (
    "id", "kind", "dispatch", "polymorphic", "allowedTypes",
    "defaultType", "typedPortNames", "ports", "featureState",
)
PRESENTATION_FIELDS = (
    "category", "labelVi", "labelEn", "description", "tags", "warningVi", "warningEn",
)

# Trần thẻ, khớp `LOCK-PGM04-CONTRACT-001` §2.1 và schema. Ba nơi giữ cùng con
# số một cách CÓ CHỦ Ý: schema chặn payload, hằng này chặn logic, và test khoá
# bằng số tuyệt đối. Một hằng dùng chung sẽ làm test tự so với chính nó.
MAX_TAGS = 8
MAX_TAG_LENGTH = 24
MAX_DESCRIPTION_LENGTH = 512


def canonical_subset(entry: dict[str, Any], fields: tuple[str, ...]) -> str:
    """JSON canonical của một TẬP CON field. Khoá sắp xếp, không khoảng trắng thừa.

    Field vắng mặt thì KHÔNG chèn giá trị rỗng thay thế: một entry không có
    `description` phải cho ra hash khác một entry có `description: ""`, vì hai
    thứ đó là hai câu khác nhau.
    """
    subset = {key: entry[key] for key in fields if key in entry}
    return json.dumps(subset, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def q(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def load() -> tuple[dict[str, Any], str, bytes]:
    raw = REGISTRY.read_bytes()
    registry = json.loads(raw)
    schema = json.loads(SCHEMA.read_bytes())
    Draft202012Validator.check_schema(schema)
    problems = sorted(
        Draft202012Validator(schema).iter_errors(registry),
        key=lambda item: list(item.absolute_path),
    )
    if problems:
        joined = "; ".join(
            f"{'/'.join(str(part) for part in item.absolute_path) or '<root>'}: {item.message}"
            for item in problems
        )
        raise ValueError(f"registry không khớp schema: {joined}")
    registry_hash = hashlib.sha256(raw).hexdigest()
    validate(registry, registry_hash)
    return registry, registry_hash, raw


def validate(
    registry: dict[str, Any],
    registry_hash: str,
    join_override: dict[str, Any] | None = None,
) -> None:
    entries = registry["entries"]
    identifiers = [item["id"] for item in entries]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("id entry bị trùng")

    categories = {item["id"] for item in registry["categoryOrder"]}
    for entry in entries:
        identity = entry["id"]
        if entry["category"] not in categories:
            raise ValueError(f"{identity}: category ngoài categoryOrder")

        # `T61-102` — metadata TRÌNH BÀY phải đã CANONICAL trong chính tệp nguồn.
        #
        # Generator KIỂM chứ không tự chuẩn hoá. Registry là tệp người viết tay
        # và được review; tự sửa nó lúc sinh sẽ làm bản đã review khác bản đã
        # sinh, và không ai nhìn thấy khác biệt đó. Fail closed, nói rõ chỗ sai.
        description = entry.get("description")
        if description is not None:
            if description != unicodedata.normalize("NFC", description):
                raise ValueError(f"{identity}: description chưa chuẩn hoá NFC")
            if description != description.strip():
                raise ValueError(f"{identity}: description thừa khoảng trắng ở hai đầu")
            if len(description) > MAX_DESCRIPTION_LENGTH:
                raise ValueError(
                    f"{identity}: description vượt {MAX_DESCRIPTION_LENGTH} ký tự"
                )
        tags = entry.get("tags")
        if tags is not None:
            if len(tags) > MAX_TAGS:
                raise ValueError(f"{identity}: vượt {MAX_TAGS} thẻ")
            for tag in tags:
                if tag != unicodedata.normalize("NFC", tag):
                    raise ValueError(f"{identity}: thẻ {tag!r} chưa chuẩn hoá NFC")
                if tag != tag.lower():
                    raise ValueError(f"{identity}: thẻ {tag!r} phải viết thường")
                if tag != " ".join(tag.split()):
                    raise ValueError(f"{identity}: thẻ {tag!r} có khoảng trắng thừa")
                if len(tag) > MAX_TAG_LENGTH:
                    raise ValueError(
                        f"{identity}: thẻ {tag!r} vượt {MAX_TAG_LENGTH} ký tự"
                    )
            if len(set(tags)) != len(tags):
                raise ValueError(f"{identity}: thẻ bị trùng")
            # Sắp tăng dần là bắt buộc, không phải thẩm mỹ: một tập hợp không có
            # thứ tự nội tại, nên giữ thứ tự người gõ sẽ làm hai tệp cùng nghĩa
            # cho hai `presentationSha256` khác nhau.
            if list(tags) != sorted(tags):
                raise ValueError(f"{identity}: thẻ phải sắp tăng dần")

        names = [port["name"] for port in entry["ports"]]
        if len(set(names)) != len(names):
            raise ValueError(f"{identity}: tên port bị trùng")
        outputs = [port for port in entry["ports"] if port["direction"] == "OUTPUT"]
        if not outputs:
            raise ValueError(f"{identity}: entry phải có ít nhất một port OUTPUT")
        if entry["kind"] != "FUNCTION_BLOCK" and len(outputs) != 1:
            raise ValueError(f"{identity}: FUNCTION/CONVERSION phải có đúng một OUTPUT")

        unknown = set(entry["typedPortNames"]) - set(names)
        if unknown:
            raise ValueError(f"{identity}: typedPortNames trỏ port không tồn tại: {sorted(unknown)}")
        if entry["polymorphic"]:
            if not entry["typedPortNames"]:
                raise ValueError(f"{identity}: entry đa hình phải khai typedPortNames")
            if len(entry["allowedTypes"]) < 2:
                raise ValueError(f"{identity}: entry đa hình phải cho phép >= 2 kiểu")
        elif entry["typedPortNames"]:
            raise ValueError(f"{identity}: entry không đa hình không được có typedPortNames")

        if entry["allowedTypes"] and entry["defaultType"] not in entry["allowedTypes"]:
            raise ValueError(f"{identity}: defaultType nằm ngoài allowedTypes")

        if entry["kind"] == "CONVERSION":
            source = next(port for port in entry["ports"] if port["direction"] == "INPUT")
            if source["dataType"] == outputs[0]["dataType"]:
                raise ValueError(f"{identity}: conversion không được cùng kiểu vào/ra")
            expected = f"{source['dataType']}_TO_{outputs[0]['dataType']}"
            if identity != expected:
                raise ValueError(f"{identity}: tên conversion phải là {expected}")

    profile = json.loads(PROFILE.read_bytes())
    if registry["libraryVersion"] != profile["coreLibrary"]["version"]:
        raise ValueError(
            "libraryVersion registry lệch profile: "
            f"{registry['libraryVersion']} vs {profile['coreLibrary']['version']}"
        )

    # G1 pin là sổ version->content được review. Nếu nội dung SYSTEM đổi mà
    # libraryVersion không đổi, generator phải dừng trước khi tạo ba consumer
    # cùng mang một version nhưng semantics khác nhau.
    join = join_override or json.loads(G1_JOIN.read_bytes())
    pin = next(
        (item for item in join["contracts"] if item.get("name") == "library-registry"),
        None,
    )
    if pin is None or pin.get("path") != str(REGISTRY.relative_to(ROOT)):
        raise ValueError("G1 thiếu pin library-registry đúng authority")
    if pin.get("libraryVersion") != registry["libraryVersion"]:
        raise ValueError("libraryVersion registry lệch G1 pin")
    if pin.get("sha256") != registry_hash:
        raise ValueError(
            "nội dung SYSTEM library đổi nhưng version/pin chưa được bump có kiểm soát"
        )
    history = pin.get("versionHistory")
    if not isinstance(history, list) or not history:
        raise ValueError("G1 thiếu lịch sử immutable version->content của SYSTEM library")
    versions = [item.get("libraryVersion") for item in history]
    if len(versions) != len(set(versions)):
        raise ValueError("G1 versionHistory có libraryVersion trùng")
    historical = next(
        (item for item in history if item.get("libraryVersion") == registry["libraryVersion"]),
        None,
    )
    if historical is None or historical.get("sha256") != registry_hash:
        raise ValueError(
            "semantic SYSTEM library đổi nhưng libraryVersion cũ vẫn được tái sử dụng"
        )


def vendor_extension_names() -> set[str]:
    """Tên khối KHÔNG thuộc thư viện chuẩn IEC 61131-3."""
    curated = json.loads(LANGUAGE_PROFILE_CURATED.read_text(encoding="utf-8"))
    return {item["name"] for item in curated["vendorExtensions"]}


def iec_classification(entry_id: str, vendor: set[str]) -> str:
    """`ISS-STED-17` — phân loại từng entry, SUY RA chứ không khai tay.

    Hai giá trị, không có giá trị thứ ba và không có `null`: mỗi khối trong
    thư viện hoặc thuộc IEC 61131-3, hoặc là mở rộng của nhà sản xuất. Để trống
    một entry là để người dùng đoán, mà đoán sai ở đây nghĩa là họ tin một khối
    Mekong tự định nghĩa sẽ chạy trên PLC của hãng khác.
    """
    return "MANUFACTURER_EXTENSION" if entry_id in vendor else "IEC_STANDARD"


def by_dispatch(registry: dict[str, Any], dispatch: str) -> list[dict[str, Any]]:
    return [item for item in registry["entries"] if item["dispatch"] == dispatch]


def by_kind(registry: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [item for item in registry["entries"] if item["kind"] == kind]


def cpp_list(values: list[str]) -> str:
    if not values:
        return "{}"
    body = ",\n    ".join(q(value) for value in values)
    return "{\n    " + body + ",\n}"


def render_cpp(registry: dict[str, Any], registry_hash: str) -> str:
    operators = [item["id"] for item in by_dispatch(registry, "OPERATOR")]
    func_table = [item["id"] for item in by_dispatch(registry, "FUNC_TABLE")]
    fb_types = [item["id"] for item in by_dispatch(registry, "FB_TYPE")]
    expansions = [item["id"] for item in by_dispatch(registry, "EXPANSION")]
    pure = [item["id"] for item in registry["entries"] if item["kind"] == "FUNCTION"]
    conversions = [item["id"] for item in by_kind(registry, "CONVERSION")]
    review = [
        item["id"] for item in registry["entries"]
        if item["featureState"] == "REVIEW_REQUIRED"
    ]
    return f"""// GENERATED bởi scripts/generate_programming_library_registry.py; không sửa tay.
#ifndef CORE_ST_LIBRARY_REGISTRY_GENERATED_HPP
#define CORE_ST_LIBRARY_REGISTRY_GENERATED_HPP

#include <array>
#include <cstddef>
#include <string_view>

namespace core::st_library_registry_generated {{

inline constexpr std::string_view kRegistrySha256 = {q(registry_hash)};
inline constexpr std::string_view kLibraryVersion = {q(registry['libraryVersion'])};

/* Entry compiler nhận diện qua binop/unop trong st_fbd_compile.cpp. */
inline constexpr std::array<std::string_view, {len(operators)}> kOperators = {cpp_list(operators)};

/* Entry compiler nhận diện qua kFuncs[] (st_func_from_name). */
inline constexpr std::array<std::string_view, {len(func_table)}> kFuncTable = {cpp_list(func_table)};

/* Entry compiler KHAI TRIỂN thành chuỗi lệnh đã có (không có opcode riêng);
 * `st_func_from_name` vẫn nhận diện chúng — xem `DDD-CTRL-PROG-001` §7A.6. */
inline constexpr std::array<std::string_view, {len(expansions)}> kExpansionFunctions = {cpp_list(expansions)};

/* Entry compiler nhận diện qua st_fb_type_from_name. */
inline constexpr std::array<std::string_view, {len(fb_types)}> kFbTypes = {cpp_list(fb_types)};

/* Allowlist FBD theo node kind. */
inline constexpr std::array<std::string_view, {len(pure)}> kPureFunctions = {cpp_list(pure)};
inline constexpr std::array<std::string_view, {len(conversions)}> kExplicitConversions = {cpp_list(conversions)};

/* Entry chưa được Controls/Safety duyệt; Commission phải chặn nếu thiếu token. */
inline constexpr std::array<std::string_view, {len(review)}> kReviewRequired = {cpp_list(review)};

}} // namespace core::st_library_registry_generated

#endif // CORE_ST_LIBRARY_REGISTRY_GENERATED_HPP
"""


def render_ts(registry: dict[str, Any], registry_hash: str) -> str:
    vendor = vendor_extension_names()

    def entry_line(entry: dict[str, Any]) -> str:
        ports = ", ".join(
            "{ name: %s, direction: %s, dataType: %s }"
            % (q(port["name"]), q(port["direction"]), q(port["dataType"]))
            for port in entry["ports"]
        )
        fields = [
            f"id: {q(entry['id'])}",
            f"kind: {q(entry['kind'])}",
            f"dispatch: {q(entry['dispatch'])}",
            f"category: {q(entry['category'])}",
            f"labelVi: {q(entry['labelVi'])}",
            f"labelEn: {q(entry['labelEn'])}",
            f"polymorphic: {'true' if entry['polymorphic'] else 'false'}",
            "allowedTypes: [%s]" % ", ".join(q(item) for item in entry["allowedTypes"]),
            f"defaultType: {q(entry['defaultType'])}",
            "typedPortNames: [%s]" % ", ".join(q(item) for item in entry["typedPortNames"]),
            f"ports: [{ports}]",
            f"featureState: {q(entry['featureState'])}",
            f"iecClassification: {q(iec_classification(entry['id'], vendor))}",
        ]
        # `T61-102` — metadata TRÌNH BÀY. Chỉ phát ra khi registry thật sự có,
        # để trường VẮNG ở TS mang đúng nghĩa "chưa ai điền" thay vì "đã điền
        # rỗng". Đó là cùng một luật mà `ProgrammingLibraryEntry` đã khoá.
        if "description" in entry:
            fields.append(f"description: {q(entry['description'])}")
        if "tags" in entry:
            fields.append("tags: [%s]" % ", ".join(q(t) for t in entry["tags"]))
        if "warningVi" in entry:
            fields.append(
                "warning: { vi: %s, en: %s }" % (q(entry["warningVi"]), q(entry["warningEn"]))
            )
        return "  { " + ", ".join(fields) + " },"

    categories = "\n".join(
        "  { id: %s, labelVi: %s, labelEn: %s },"
        % (q(item["id"]), q(item["labelVi"]), q(item["labelEn"]))
        for item in registry["categoryOrder"]
    )
    entries = "\n".join(entry_line(item) for item in registry["entries"])
    # Union category sinh TỪ hợp đồng, không viết tay trong template: chép tay
    # danh sách này chính là kiểu lỗi mà file sinh tự động sinh ra để tránh —
    # thêm một nhóm mới sẽ làm TS đỏ ở nơi không ai ngờ.
    category_union = "\n".join(
        f"  | {q(item['id'])}" for item in registry["categoryOrder"]
    )
    return f"""// Tệp sinh tự động bởi scripts/generate_programming_library_registry.py. Không sửa bằng tay.
export const PROGRAMMING_LIBRARY_REGISTRY_SHA256 = {q(registry_hash)} as const;
export const PROGRAMMING_LIBRARY_VERSION = {q(registry['libraryVersion'])} as const;

export type LibraryEntryKind = "FUNCTION" | "FUNCTION_BLOCK" | "CONVERSION";
export type LibraryDispatch = "OPERATOR" | "FUNC_TABLE" | "FB_TYPE" | "EXPANSION";
export type LibraryFeatureState = "AVAILABLE" | "REVIEW_REQUIRED";
/** `ISS-STED-17` / `ADR-054` điểm 3 — khối này thuộc IEC 61131-3 hay là mở rộng
 *  của Mekong. IEC cho phép mở rộng nhà sản xuất MIỄN LÀ đánh dấu rõ, nên nhãn
 *  phải đi tới tận nơi người dùng CHỌN khối, không dừng ở tài liệu. */
export type LibraryIecClassification = "IEC_STANDARD" | "MANUFACTURER_EXTENSION";
export type LibraryCategory =
{category_union};

export interface LibraryPort {{
  readonly name: string;
  readonly direction: "INPUT" | "OUTPUT";
  readonly dataType: "BOOL" | "INT" | "DINT" | "UINT" | "REAL" | "TIME";
}}

export interface LibraryEntry {{
  readonly id: string;
  readonly kind: LibraryEntryKind;
  readonly dispatch: LibraryDispatch;
  readonly category: LibraryCategory;
  readonly labelVi: string;
  readonly labelEn: string;
  readonly polymorphic: boolean;
  readonly allowedTypes: readonly LibraryPort["dataType"][];
  readonly defaultType: LibraryPort["dataType"];
  readonly typedPortNames: readonly string[];
  readonly ports: readonly LibraryPort[];
  readonly featureState: LibraryFeatureState;
  readonly iecClassification: LibraryIecClassification;
  /** `T61-102` — metadata TRÌNH BÀY. Optional vì trường VẮNG nghĩa là "chưa ai
   *  điền", khác chuỗi rỗng nghĩa là "đã điền rỗng có chủ đích". Sửa hai trường
   *  này KHÔNG đổi danh tính thực thi của khối (`D61-09`). Thẻ đã ở dạng chuẩn
   *  hoá (chữ thường, sắp tăng dần) ngay trong registry — đừng sắp lại. */
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly warning?: {{ readonly vi: string; readonly en: string }};
}}

export const PROGRAMMING_LIBRARY_CATEGORY_ORDER: readonly {{
  id: LibraryCategory;
  labelVi: string;
  labelEn: string;
}}[] = [
{categories}
];

export const PROGRAMMING_LIBRARY_ENTRIES: readonly LibraryEntry[] = [
{entries}
];
"""


def gofmt(content: str) -> str:
    """Để `--check` so đúng byte với file Go đã qua gofmt."""
    result = subprocess.run(
        ["gofmt"],
        input=content,
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout


def render_go(registry: dict[str, Any], registry_hash: str, raw: bytes) -> str:
    def entry_line(entry: dict[str, Any]) -> str:
        # `SignatureJSON` giữ TOÀN BỘ metadata canonical của registry — FE đọc
        # `category`/`labelVi`/`ports` từ đây, nên nó không được rút gọn.
        #
        # Nhưng HAI HASH thì tính từ hai TẬP CON tách bạch (`D61-09`):
        #   - `ContentSHA256Hex`   <- EXECUTABLE_FIELDS: gọi khối này máy làm gì.
        #   - `PresentationSHA256Hex` <- PRESENTATION_FIELDS: người đọc thấy gì.
        # Băm cả entry vào `ContentSHA256Hex` như bản trước làm cho một lần sửa
        # nhãn tiếng Việt đổi danh tính thực thi của khối.
        signature_json = json.dumps(
            entry, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        executable_json = canonical_subset(entry, EXECUTABLE_FIELDS)
        presentation_json = canonical_subset(entry, PRESENTATION_FIELDS)
        content_hash = hashlib.sha256(executable_json.encode("utf-8")).hexdigest()
        presentation_hash = hashlib.sha256(presentation_json.encode("utf-8")).hexdigest()
        # FUNCTION và CONVERSION thuần/stateless nên 0 là giá trị authoritative.
        # Registry hiện chưa mang layout state của FUNCTION_BLOCK; ghi unknown
        # thay vì đoán. PROJECT FB chỉ được publish sau khi có layout riêng hợp lệ.
        state_size_authoritative = entry["kind"] != "FUNCTION_BLOCK"
        return (
            "\t{"
            f"EntryID: {q(entry['id'])}, Name: {q(entry['id'])}, "
            f"Kind: LibraryEntryKind({q(entry['kind'])}), "
            f"FeatureState: LibraryFeatureState({q(entry['featureState'])}), "
            # `T61-102` — `category` đã có trong registry từ đầu; trước lát này
            # nó không được sinh ra Go nên không endpoint nào trả được nó.
            f"Category: {q(entry['category'])}, "
            f"Description: {q(entry.get('description', ''))}, "
            "Tags: %s, " % ("[]string{%s}" % ", ".join(q(t) for t in entry.get("tags", [])))
            + f"SignatureJSON: {q(signature_json)}, "
            f"ContentSHA256Hex: {q(content_hash)}, "
            f"PresentationSHA256Hex: {q(presentation_hash)}, "
            "StateSizeBytes: 0, "
            f"StateSizeAuthoritative: {'true' if state_size_authoritative else 'false'}"
            "},"
        )

    entries = "\n".join(entry_line(item) for item in registry["entries"])
    # Revision identity phải content-addressed: nếu một thay đổi có kiểm soát
    # tạo snapshot mới, hai manifest không bao giờ dùng chung revisionId.
    revision_id = (
        f"{registry['registryId']}:{registry['libraryVersion']}:{registry_hash}"
    )
    source = f'''// Code generated by scripts/generate_programming_library_registry.py; DO NOT EDIT.
package domain

// Các token này và danh sách entry bên dưới cùng sinh từ
// contracts/programming/pou_library_registry_v1.json. Không chép tay registry ở Go.
const (
\tSystemLibraryRegistryID = {q(registry['registryId'])}
\tSystemLibraryRevisionID = {q(revision_id)}
\tSystemLibraryVersion = {q(registry['libraryVersion'])}
\tSystemLibraryRegistrySHA256 = {q(registry_hash)}
\tSystemLibraryManifestJSON = {q(raw.decode('utf-8'))}
)

var systemLibraryEntryDefinitions = [...]LibraryEntryDefinition{{
{entries}
}}
'''
    return gofmt(source)


def outputs() -> tuple[list[tuple[Path, str]], int]:
    # Chỉ đọc authority đúng một lần; cùng snapshot byte cấp hash, entries và
    # manifest Go. Không có cửa sổ TOCTOU giữa ba consumer sinh ra.
    registry, registry_hash, raw = load()
    return (
        [
            (CPP_OUTPUT, render_cpp(registry, registry_hash)),
            (TS_OUTPUT, render_ts(registry, registry_hash)),
            (GO_OUTPUT, render_go(registry, registry_hash, raw)),
        ],
        len(registry["entries"]),
    )


def self_test() -> None:
    registry, _, _ = load()
    mutated = json.loads(json.dumps(registry))
    mutated["entries"][0]["labelVi"] += " drift"
    mutated_hash = hashlib.sha256(
        json.dumps(mutated, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    repinned_join = json.loads(G1_JOIN.read_bytes())
    repinned = next(
        item for item in repinned_join["contracts"]
        if item.get("name") == "library-registry"
    )
    repinned["sha256"] = mutated_hash
    try:
        validate(mutated, mutated_hash, repinned_join)
    except ValueError as error:
        if "tái sử dụng" not in str(error):
            raise AssertionError(f"fault content trả sai lỗi: {error}") from error
    else:
        raise AssertionError("semantic drift không bump version vẫn được chấp nhận")

    bumped = json.loads(json.dumps(registry))
    bumped["libraryVersion"] = registry["libraryVersion"] + ".1"
    try:
        validate(bumped, hashlib.sha256(b"bumped").hexdigest())
    except ValueError:
        pass
    else:
        raise AssertionError("bump registry mà profile/G1 chưa pin vẫn được chấp nhận")

    # `T61-102` — metadata TRÌNH BÀY phải fail closed, không bỏ field im lặng.
    #
    # Mỗi ca dưới đây hỏng đúng MỘT luật và phải bị `validate` từ chối kèm lý do
    # đọc được. Ca nào đi lọt thì registry có thể mang metadata lệch chuẩn, và
    # hai tệp cùng nghĩa sẽ cho hai `presentationSha256` khác nhau.
    faults: list[tuple[str, Any, str]] = [
        ("thẻ trùng", ["logic", "logic"], "trùng"),
        ("thẻ chưa sắp tăng dần", ["zzz", "aaa"], "sắp tăng dần"),
        ("thẻ viết hoa", ["Logic"], "viết thường"),
        ("thẻ có khoảng trắng thừa", ["vav  box"], "khoảng trắng thừa"),
        ("thẻ quá dài", ["x" * (MAX_TAG_LENGTH + 1)], f"vượt {MAX_TAG_LENGTH}"),
        ("quá số thẻ cho phép", [f"t{index}" for index in range(MAX_TAGS + 1)], f"vượt {MAX_TAGS}"),
        # NFC: "à" dựng từ "a" + U+0300 trông y hệt "à" dựng sẵn nhưng khác byte,
        # nên khác hash. Một tệp trộn hai dạng là một tệp có hai sự thật.
        ("thẻ chưa chuẩn hoá NFC", ["a\u0300"], "NFC"),
    ]
    for label, tags, expected in faults:
        candidate = json.loads(json.dumps(registry))
        candidate["entries"][0]["tags"] = tags
        try:
            validate(candidate, hashlib.sha256(b"probe").hexdigest())
        except ValueError as error:
            if expected not in str(error):
                raise AssertionError(f"{label}: lỗi không nói đúng nguyên nhân: {error}") from error
        else:
            raise AssertionError(f"{label} vẫn được chấp nhận")

    long_description = json.loads(json.dumps(registry))
    long_description["entries"][0]["description"] = "x" * (MAX_DESCRIPTION_LENGTH + 1)
    try:
        validate(long_description, hashlib.sha256(b"probe").hexdigest())
    except ValueError as error:
        if "description" not in str(error):
            raise AssertionError(f"description quá dài trả sai lỗi: {error}") from error
    else:
        raise AssertionError("description vượt trần vẫn được chấp nhận")

    # `D61-09` — TÁCH BIỆT executable/presentation, đo trực tiếp chứ không tin
    # tên biến. Đây là bất biến đắt nhất của lát này: nếu nó hỏng thì một lần
    # sửa chính tả làm mọi artifact và pin Revision đã ký thành lỗi thời.
    base = registry["entries"][0]

    def pair(entry: dict[str, Any]) -> tuple[str, str]:
        return (
            hashlib.sha256(canonical_subset(entry, EXECUTABLE_FIELDS).encode("utf-8")).hexdigest(),
            hashlib.sha256(canonical_subset(entry, PRESENTATION_FIELDS).encode("utf-8")).hexdigest(),
        )

    content, presentation = pair(base)
    for label, mutate in [
        ("description", lambda e: e.update(description=e["description"] + " thêm")),
        ("tags", lambda e: e.update(tags=sorted(set(e["tags"]) | {"zzz"}))),
        ("labelVi", lambda e: e.update(labelVi=e["labelVi"] + " x")),
        ("category", lambda e: e.update(category="control")),
    ]:
        candidate = json.loads(json.dumps(base))
        mutate(candidate)
        changed_content, changed_presentation = pair(candidate)
        if changed_content != content:
            raise AssertionError(f"sửa {label} đã đổi content hash — vi phạm D61-09")
        if changed_presentation == presentation:
            raise AssertionError(f"sửa {label} mà presentation hash không đổi")

    # Vế ngược lại: đổi thứ THỰC THI thì content hash BẮT BUỘC đổi, nếu không
    # hash ấy không canh gì cả.
    for label, mutate in [
        ("ports", lambda e: e.update(ports=e["ports"][:-1])),
        ("dispatch", lambda e: e.update(dispatch="FUNC_TABLE")),
        ("featureState", lambda e: e.update(featureState="REVIEW_REQUIRED")),
    ]:
        candidate = json.loads(json.dumps(base))
        mutate(candidate)
        if pair(candidate)[0] == content:
            raise AssertionError(f"đổi {label} mà content hash không đổi")

    # Field VẮNG khác field RỖNG: hai thứ đó là hai câu khác nhau, nên hai hash.
    absent = json.loads(json.dumps(base))
    absent.pop("description")
    blank = json.loads(json.dumps(base))
    blank["description"] = ""
    if pair(absent)[1] == pair(blank)[1]:
        raise AssertionError("description vắng và description rỗng cho cùng một hash")

    # Canh chính ĐẦU RA của `render_go`, không chỉ canh các hàm nó gọi.
    #
    # Đây là chỗ bộ self-test cũ hụt: mọi khẳng định ở trên đo `canonical_subset`
    # trực tiếp, nên một `render_go` gán nhầm `content_hash = sha256(cả entry)`
    # vẫn đi lọt — đúng cái lỗi mà lát này sinh ra để sửa. Đo trên chuỗi Go thật
    # sự được ghi ra đĩa thì phép tiêm ấy không còn chỗ trốn.
    _, real_hash, real_raw = load()
    rendered = render_go(registry, real_hash, real_raw)
    for entry in registry["entries"]:
        expected_content = hashlib.sha256(
            canonical_subset(entry, EXECUTABLE_FIELDS).encode("utf-8")
        ).hexdigest()
        expected_presentation = hashlib.sha256(
            canonical_subset(entry, PRESENTATION_FIELDS).encode("utf-8")
        ).hexdigest()
        if f'ContentSHA256Hex: "{expected_content}"' not in rendered:
            raise AssertionError(
                f"{entry['id']}: ContentSHA256Hex sinh ra không phải hash của TẬP THỰC THI"
            )
        if f'PresentationSHA256Hex: "{expected_presentation}"' not in rendered:
            raise AssertionError(
                f"{entry['id']}: PresentationSHA256Hex sinh ra không phải hash của TẬP TRÌNH BÀY"
            )
        if expected_content == expected_presentation:
            raise AssertionError(f"{entry['id']}: hai hash trùng nhau — phép tách vô nghĩa")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            self_test()
            print(
                "PASS: 12/12 fault SYSTEM library bị chặn "
                "(2 version/content, 8 metadata trình bày, 2 tách hash executable/presentation)"
            )
            return 0
        rendered, entry_count = outputs()
    except (OSError, ValueError, KeyError, json.JSONDecodeError,
            subprocess.CalledProcessError) as error:
        print(f"FAIL: registry không hợp lệ: {error}", file=sys.stderr)
        return 1

    if args.check:
        drift = [
            path for path, content in rendered
            if not path.exists() or path.read_text(encoding="utf-8") != content
        ]
        if drift:
            for path in drift:
                print(f"DRIFT: {path.relative_to(ROOT)} không khớp registry", file=sys.stderr)
            return 1
        print(
            f"PASS: registry {entry_count} entry khớp hằng C++/Go/TS "
            f"({len(rendered)}/{len(rendered)} tệp sinh)"
        )
        return 0

    for path, content in rendered:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
