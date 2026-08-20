#!/usr/bin/env python3
"""Sinh catalog lỗi Programming cho Go, C++ và TypeScript từ một nguồn."""

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
CATALOG = ROOT / "contracts/programming/error_catalog_v1.json"
SCHEMA = ROOT / "contracts/programming/error_catalog_v1.schema.json"
MANIFEST = ROOT / "contracts/programming/error_catalog_v1.manifest.json"
GO_OUTPUT = ROOT / "apps/web-api/internal/programming/domain/errors_generated.go"
CPP_OUTPUT = ROOT / "apps/core/application/programming/program_error_generated.hpp"
TS_OUTPUT = ROOT / "apps/web-ui/src/features/programming/api/generated/errors.ts"
INTERFACE_SPEC = ROOT / "docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md"

PUBLIC_CODE = re.compile(r"^PRG-ERR-[A-Z0-9-]+$")
MESSAGE_KEY = re.compile(r"^programming\.[A-Za-z0-9_.-]+$")
SYMBOL = re.compile(r"^Err[A-Za-z0-9]+$")
SAFE_ARG = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,31}$")
FORBIDDEN_ARGS = {
    "path", "source", "sourceCode", "secret", "token", "password", "privateKey",
    "stack", "uid", "hostPath", "publicKey", "artifactBytes",
}
FORBIDDEN_ARGS_LOWER = {value.lower() for value in FORBIDDEN_ARGS}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def q(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def load_and_validate() -> tuple[dict[str, Any], bytes, bytes]:
    raw = CATALOG.read_bytes()
    schema_raw = SCHEMA.read_bytes()
    catalog = json.loads(raw)
    # Trước T59-004 schema chỉ được BĂM chứ không được thi hành, nên nó đã trôi
    # khỏi catalog thật (`NOT_FOUND` bị dùng mà thiếu trong enum) suốt nhiều
    # revision mà không gate nào bắt.
    schema = json.loads(schema_raw)
    Draft202012Validator.check_schema(schema)
    schema_problems = sorted(
        Draft202012Validator(schema).iter_errors(catalog),
        key=lambda item: list(item.absolute_path),
    )
    if schema_problems:
        joined = "; ".join(
            f"{'/'.join(str(part) for part in item.absolute_path) or '<root>'}: {item.message}"
            for item in schema_problems
        )
        raise ValueError(f"catalog không khớp schema: {joined}")
    if catalog.get("schemaVersion") != 1:
        raise ValueError("schemaVersion catalog phải bằng 1")
    if not re.fullmatch(r"1\.[0-9]+\.[0-9]+", str(catalog.get("catalogVersion", ""))):
        raise ValueError("catalogVersion phải thuộc major 1")

    entries = catalog.get("publicErrors")
    details = catalog.get("componentDetails")
    if not isinstance(entries, list) or not entries or not isinstance(details, list):
        raise ValueError("publicErrors/componentDetails phải là mảng không rỗng")

    codes: set[str] = set()
    symbols: set[str] = set()
    messages: set[str] = set()
    for entry in entries:
        code = entry.get("code", "")
        symbol = entry.get("symbol", "")
        message = entry.get("messageKey", "")
        statuses = entry.get("httpStatuses")
        allowed_args = entry.get("allowedArgs")
        if not PUBLIC_CODE.fullmatch(code) or code in codes:
            raise ValueError(f"public code sai hoặc trùng: {code}")
        if not SYMBOL.fullmatch(symbol) or symbol in symbols:
            raise ValueError(f"symbol sai hoặc trùng: {symbol}")
        if not MESSAGE_KEY.fullmatch(message) or message in messages:
            raise ValueError(f"messageKey sai hoặc trùng: {message}")
        if not isinstance(statuses, list) or not statuses or len(set(statuses)) != len(statuses):
            raise ValueError(f"httpStatuses thiếu/trùng: {code}")
        if any(not isinstance(status, int) or status < 400 or status > 599 for status in statuses):
            raise ValueError(f"HTTP status ngoài 4xx/5xx: {code}")
        if not isinstance(entry.get("retryable"), bool) or not isinstance(entry.get("keepsRunningRevision"), bool):
            raise ValueError(f"retryable/keepsRunningRevision phải là boolean: {code}")
        if not isinstance(allowed_args, list) or len(set(allowed_args)) != len(allowed_args):
            raise ValueError(f"allowedArgs sai/trùng: {code}")
        for arg in allowed_args:
            if not SAFE_ARG.fullmatch(arg) or arg.lower() in FORBIDDEN_ARGS_LOWER:
                raise ValueError(f"public arg bị cấm: {code}/{arg}")
        codes.add(code)
        symbols.add(symbol)
        messages.add(message)

    fallback = catalog.get("unknownFallbackCode")
    if fallback not in codes:
        raise ValueError("unknownFallbackCode không tồn tại trong publicErrors")

    detail_keys: set[tuple[str, str]] = set()
    for mapping in details:
        key = (mapping.get("component", ""), mapping.get("detailCode", ""))
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", key[0]) or key in detail_keys:
            raise ValueError(f"component/detail sai hoặc trùng: {key}")
        if not re.fullmatch(r"[A-Z][A-Z0-9-]{2,127}", key[1]):
            raise ValueError(f"detailCode sai: {key}")
        if mapping.get("publicCode") not in codes:
            raise ValueError(f"detail trỏ public code không tồn tại: {key}")
        detail_keys.add(key)

    # §9 là authority con người đọc; catalog không được âm thầm bỏ/thêm mã.
    spec = INTERFACE_SPEC.read_text()
    section9 = spec.split("## 9.", 1)[1].split("## 10.", 1)[0]
    # CHỈ đọc dòng đầu của bảng authority. Trước đây quét toàn bộ §9 nên một câu
    # văn xuôi nhắc tên mã đã gỡ cũng làm gate đỏ, và ngược lại một mã chỉ được
    # nhắc trong văn xuôi vẫn "thỏa" gate mà không hề có dòng authority nào.
    spec_codes = set(re.findall(r"^\|\s*`(PRG-ERR-[A-Z0-9-]+)`\s*\|", section9, re.M))
    if codes != spec_codes:
        raise ValueError(
            "catalog lệch IFSPEC §9: thiếu=" + str(sorted(spec_codes - codes)) +
            " thừa=" + str(sorted(codes - spec_codes))
        )

    expected_details: dict[str, set[str]] = {
        "st-control-api": set(re.findall(r"API-E-[0-9]{3}", (ROOT / "apps/core/application/st/st_control_api.hpp").read_text())),
        "artifact-loader": set(re.findall(r"IR-E-[0-9]{3}", (ROOT / "apps/core/application/st/st_loader.hpp").read_text())),
        "retain": set(re.findall(r"RT-RETAIN-[0-9]{3}", (ROOT / "apps/core/application/st/st_retain.hpp").read_text())),
        "core-ipc": set(re.findall(
            r"IPC-[A-Z0-9-]+",
            (ROOT / "apps/core/application/programming/program_ipc_server.cpp").read_text()
            + (ROOT / "apps/core/application/programming/programming_runtime_coordinator.cpp").read_text(),
        )),
    }
    diagnostic_source = (ROOT / "apps/core/application/st/st_diagnostic.hpp").read_text()
    expected_details["compiler"] = set(re.findall(
        r"ST-(?:LEX|SYN|SEM|LIM|IOMAP|POU|LIB|SIG|OWN|PID)-[0-9]{3}", diagnostic_source))
    for source in ("st_compile_main.cpp", "st_validate_main.cpp"):
        expected_details["compiler"].update(re.findall(r"ST-CLI-[A-Z0-9-]+", (ROOT / "apps/core/application/st" / source).read_text()))
    # Một phần detail code do BE Go phát (`ST-CLI-LIMIT`, `ST-WORKER-*`). Trước
    # đây chúng không được quét nên guard chỉ đúng một nửa: mã Go thêm mới mà
    # quên map sẽ không làm build đỏ.
    go_source = (ROOT / "apps/web-api/internal/programming/application/checks.go").read_text()
    expected_details["compiler"].update(re.findall(r"ST-(?:CLI|WORKER)-[A-Z0-9-]+", go_source))
    expected_details["runtime"] = set(re.findall(r"ST-RT-[0-9]{3}", diagnostic_source))

    contract_only = {
        (item["component"], item["detailCode"])
        for item in details if item.get("contractOnly")
    }
    for component, expected in expected_details.items():
        mapped = {detail for mapped_component, detail in detail_keys if mapped_component == component}
        missing = expected - mapped
        if missing:
            raise ValueError(f"detail source chưa map cho {component}: {sorted(missing)}")
        # Chiều ngược lại: ánh xạ không có emitter nào khai là mapping ma. Chỉ
        # được miễn khi đánh dấu `contractOnly` tường minh trong catalog.
        orphan = sorted(
            detail for detail in mapped - expected
            if (component, detail) not in contract_only
        )
        if orphan:
            raise ValueError(
                f"detail map cho {component} nhưng không source nào khai: {orphan}"
            )

    return catalog, raw, schema_raw


def render_go(catalog: dict[str, Any], catalog_hash: str) -> str:
    entries = catalog["publicErrors"]
    details = catalog["componentDetails"]
    fallback_symbol = next(item["symbol"] for item in entries if item["code"] == catalog["unknownFallbackCode"])
    consts = "\n".join(f'\t{item["symbol"]} ErrorCode = {q(item["code"])}' for item in entries)
    metadata = "\n".join(
        f'\t{item["symbol"]}: {{OwnerComponent: {q(item["ownerComponent"])}, StatusClass: {q(item["statusClass"])}, '
        f'DefaultHTTPStatus: {item["httpStatuses"][0]}, Retryable: {str(item["retryable"]).lower()}, '
        f'KeepsRunningRevision: {str(item["keepsRunningRevision"]).lower()}, MessageKey: {q(item["messageKey"])}}},'
        for item in entries
    )
    statuses = "\n".join(
        f'\t{item["symbol"]}: {{{", ".join(str(status) for status in item["httpStatuses"])}}},'
        for item in entries
    )
    allowed = "\n".join(
        f'\t{item["symbol"]}: {{{", ".join(q(arg) + ": {}" for arg in item["allowedArgs"])}}},'
        for item in entries
    )
    by_component: dict[str, list[dict[str, str]]] = {}
    for mapping in details:
        by_component.setdefault(mapping["component"], []).append(mapping)
    detail_lines = []
    code_to_symbol = {item["code"]: item["symbol"] for item in entries}
    for component in sorted(by_component):
        inner = ", ".join(
            f'{q(item["detailCode"])}: {code_to_symbol[item["publicCode"]]}'
            for item in sorted(by_component[component], key=lambda value: value["detailCode"])
        )
        detail_lines.append(f'\t{q(component)}: {{{inner}}},')
    source = f'''// Code generated by scripts/generate_programming_errors.py; DO NOT EDIT.
package domain

const ErrorCatalogSHA256 = {q(catalog_hash)}
const ErrorCatalogVersion = {q(catalog["catalogVersion"])}

const (
{consts}
)

type ErrorMetadata struct {{
\tOwnerComponent       string
\tStatusClass          string
\tDefaultHTTPStatus    int
\tRetryable            bool
\tKeepsRunningRevision bool
\tMessageKey           string
}}

var errorMetadataByCode = map[ErrorCode]ErrorMetadata{{
{metadata}
}}

var httpStatusesByCode = map[ErrorCode][]int{{
{statuses}
}}

var allowedArgsByCode = map[ErrorCode]map[string]struct{{}}{{
{allowed}
}}

var publicCodeByComponentDetail = map[string]map[string]ErrorCode{{
{chr(10).join(detail_lines)}
}}

func ErrorMetadataFor(code ErrorCode) (ErrorMetadata, bool) {{
\tmetadata, ok := errorMetadataByCode[code]
\treturn metadata, ok
}}

func MapComponentError(component, detailCode string) ErrorCode {{
\tif componentDetails, ok := publicCodeByComponentDetail[component]; ok {{
\t\tif code, found := componentDetails[detailCode]; found {{
\t\t\treturn code
\t\t}}
\t}}
\treturn {fallback_symbol}
}}

func IsRetryable(code ErrorCode) bool {{
\tmetadata, ok := ErrorMetadataFor(code)
\treturn ok && metadata.Retryable
}}

func MessageKeyFor(code ErrorCode) string {{
\tmetadata, ok := ErrorMetadataFor(code)
\tif !ok {{
\t\treturn errorMetadataByCode[{fallback_symbol}].MessageKey
\t}}
\treturn metadata.MessageKey
}}

func DefaultHTTPStatus(code ErrorCode) int {{
\tmetadata, ok := ErrorMetadataFor(code)
\tif !ok {{
\t\treturn errorMetadataByCode[{fallback_symbol}].DefaultHTTPStatus
\t}}
\treturn metadata.DefaultHTTPStatus
}}

func HTTPStatusAllowed(code ErrorCode, status int) bool {{
\tfor _, allowed := range httpStatusesByCode[code] {{
\t\tif status == allowed {{
\t\t\treturn true
\t\t}}
\t}}
\treturn false
}}

func SanitizeErrorArgs(code ErrorCode, args map[string]any) map[string]any {{
\tallowed := allowedArgsByCode[code]
\tif len(allowed) == 0 || len(args) == 0 {{
\t\treturn nil
\t}}
\toutput := make(map[string]any)
\tfor key, value := range args {{
\t\tif _, ok := allowed[key]; !ok {{
\t\t\tcontinue
\t\t}}
\t\tif sanitized, ok := sanitizePublicArgValue(value); ok {{
\t\t\toutput[key] = sanitized
\t\t}}
\t}}
\tif len(output) == 0 {{
\t\treturn nil
\t}}
\treturn output
}}
'''
    result = subprocess.run(["gofmt"], input=source, text=True, capture_output=True, check=True)
    return result.stdout


def cpp_name(symbol: str) -> str:
    return symbol[3:]


def render_cpp(catalog: dict[str, Any], catalog_hash: str) -> str:
    entries = catalog["publicErrors"]
    details = catalog["componentDetails"]
    code_to_name = {item["code"]: cpp_name(item["symbol"]) for item in entries}
    fallback = code_to_name[catalog["unknownFallbackCode"]]
    fallback_index = next(
        index for index, item in enumerate(entries)
        if item["code"] == catalog["unknownFallbackCode"]
    )
    enum_lines = "\n".join(f"    {cpp_name(item['symbol'])}," for item in entries)
    metadata_lines = "\n".join(
        f'    {{ProgramPublicError::{cpp_name(item["symbol"])}, {q(item["code"])}, {q(item["ownerComponent"])}, '
        f'{q(item["statusClass"])}, {item["httpStatuses"][0]}, {str(item["retryable"]).lower()}, '
        f'{str(item["keepsRunningRevision"]).lower()}, {q(item["messageKey"])} }},'
        for item in entries
    )
    mapping_lines = "\n".join(
        f'    {{{q(item["component"])}, {q(item["detailCode"])}, ProgramPublicError::{code_to_name[item["publicCode"]]} }},'
        for item in sorted(details, key=lambda value: (value["component"], value["detailCode"]))
    )
    return f'''// GENERATED bởi scripts/generate_programming_errors.py; không sửa tay.
#ifndef CORE_PROGRAM_ERROR_GENERATED_HPP
#define CORE_PROGRAM_ERROR_GENERATED_HPP

#include <array>
#include <cstdint>
#include <string_view>

namespace core::programming {{
inline constexpr std::string_view kProgramErrorCatalogSha256 = {q(catalog_hash)};
inline constexpr std::string_view kProgramErrorCatalogVersion = {q(catalog["catalogVersion"])};

enum class ProgramPublicError : uint8_t {{
{enum_lines}
}};

struct ProgramErrorMetadata {{
    ProgramPublicError code;
    std::string_view public_code;
    std::string_view owner_component;
    std::string_view status_class;
    int default_http_status;
    bool retryable;
    bool keeps_running_revision;
    std::string_view message_key;
}};

inline constexpr std::array<ProgramErrorMetadata, {len(entries)}> kProgramErrorMetadata = {{{{
{metadata_lines}
}}}};

struct ComponentErrorMapping {{
    std::string_view component;
    std::string_view detail_code;
    ProgramPublicError public_code;
}};

inline constexpr std::array<ComponentErrorMapping, {len(details)}> kComponentErrorMappings = {{{{
{mapping_lines}
}}}};

constexpr ProgramPublicError MapComponentError(std::string_view component,
                                                std::string_view detail_code)
{{
    for (const auto& mapping : kComponentErrorMappings) {{
        if (mapping.component == component && mapping.detail_code == detail_code)
            return mapping.public_code;
    }}
    return ProgramPublicError::{fallback};
}}

constexpr const ProgramErrorMetadata& ProgramErrorMetadataFor(ProgramPublicError code)
{{
    for (const auto& metadata : kProgramErrorMetadata) {{
        if (metadata.code == code) return metadata;
    }}
    return kProgramErrorMetadata[{fallback_index}];
}}

constexpr bool IsRetryable(ProgramPublicError code)
{{
    return ProgramErrorMetadataFor(code).retryable;
}}

constexpr std::string_view MessageKeyFor(ProgramPublicError code)
{{
    return ProgramErrorMetadataFor(code).message_key;
}}
}} // namespace core::programming

#endif // CORE_PROGRAM_ERROR_GENERATED_HPP
'''


def render_ts(catalog: dict[str, Any], catalog_hash: str) -> str:
    entries = catalog["publicErrors"]
    details = catalog["componentDetails"]
    metadata_lines = "\n".join(
        f'  {q(item["code"])}: {{ ownerComponent: {q(item["ownerComponent"])}, statusClass: {q(item["statusClass"])}, '
        f'httpStatuses: {json.dumps(item["httpStatuses"])}, retryable: {str(item["retryable"]).lower()}, '
        f'keepsRunningRevision: {str(item["keepsRunningRevision"]).lower()}, messageKey: {q(item["messageKey"])}, '
        f'allowedArgs: {json.dumps(item["allowedArgs"])} }},'
        for item in entries
    )
    mapping_lines = "\n".join(
        f'  {q(item["component"] + chr(0) + item["detailCode"])}: {q(item["publicCode"])},'
        for item in sorted(details, key=lambda value: (value["component"], value["detailCode"]))
    )
    fallback = q(catalog["unknownFallbackCode"])
    return f'''// Tệp sinh tự động bởi scripts/generate_programming_errors.py. Không sửa bằng tay.
export const PROGRAMMING_ERROR_CATALOG_SHA256 = {q(catalog_hash)} as const;
export const PROGRAMMING_ERROR_CATALOG_VERSION = {q(catalog["catalogVersion"])} as const;

export const PROGRAMMING_ERROR_CATALOG = {{
{metadata_lines}
}} as const;

export type ProgrammingErrorCode = keyof typeof PROGRAMMING_ERROR_CATALOG;

const COMPONENT_ERROR_MAP: Readonly<Record<string, ProgrammingErrorCode>> = {{
{mapping_lines}
}};

export function mapComponentError(component: string, detailCode: string): ProgrammingErrorCode {{
  return COMPONENT_ERROR_MAP[`${{component}}\\u0000${{detailCode}}`] ?? {fallback};
}}

export function isRetryable(code: ProgrammingErrorCode): boolean {{
  return PROGRAMMING_ERROR_CATALOG[code].retryable;
}}

export function messageKeyFor(code: ProgrammingErrorCode): string {{
  return PROGRAMMING_ERROR_CATALOG[code].messageKey;
}}

function hasControlCharacter(value: string): boolean {{
  for (let index = 0; index < value.length; index += 1) {{
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }}
  return false;
}}

function sanitizeValue(value: unknown): unknown | undefined {{
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.length <= 128 && !hasControlCharacter(value) ? value : undefined;
  if (Array.isArray(value) && value.length <= 16 && value.every(
    (item) => typeof item === "string" && item.length <= 128 && !hasControlCharacter(item),
  )) return value;
  return undefined;
}}

export function sanitizeProgrammingErrorArgs(
  code: ProgrammingErrorCode,
  args: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {{
  if (!args) return undefined;
  const allowed = new Set<string>(PROGRAMMING_ERROR_CATALOG[code].allowedArgs);
  const sanitized: Record<string, unknown> = {{}};
  for (const [key, value] of Object.entries(args)) {{
    if (!allowed.has(key)) continue;
    const safe = sanitizeValue(value);
    if (safe !== undefined) sanitized[key] = safe;
  }}
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}}
'''


def render_manifest(catalog: dict[str, Any], catalog_hash: str, schema_hash: str) -> str:
    value = {
        "schemaVersion": 1,
        "catalogVersion": catalog["catalogVersion"],
        "catalogSha256": catalog_hash,
        "schemaSha256": schema_hash,
        "publicErrorCount": len(catalog["publicErrors"]),
        "componentDetailCount": len(catalog["componentDetails"]),
        "generatedConsumers": [
            str(GO_OUTPUT.relative_to(ROOT)),
            str(CPP_OUTPUT.relative_to(ROOT)),
            str(TS_OUTPUT.relative_to(ROOT)),
        ],
    }
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        catalog, raw, schema_raw = load_and_validate()
        catalog_hash = sha256(raw)
        outputs = {
            GO_OUTPUT: render_go(catalog, catalog_hash),
            CPP_OUTPUT: render_cpp(catalog, catalog_hash),
            TS_OUTPUT: render_ts(catalog, catalog_hash),
            MANIFEST: render_manifest(catalog, catalog_hash, sha256(schema_raw)),
        }
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    if args.check:
        drift = [path for path, content in outputs.items() if not path.exists() or path.read_text() != content]
        if drift:
            for path in drift:
                print(f"DRIFT: {path.relative_to(ROOT)}", file=sys.stderr)
            return 1
        print(
            f"PASS: error catalog {len(catalog['publicErrors'])} public / "
            f"{len(catalog['componentDetails'])} detail / SHA-256 {catalog_hash}"
        )
        return 0

    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
