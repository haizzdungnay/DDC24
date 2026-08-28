#!/usr/bin/env python3
"""Gate cấu trúc repository và path authority, không cần dependency ngoài."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "tools/restructure/repository-path-map.json"


CONTRACT_REFERENCE_PATTERN = re.compile(
    r"(?:contracts/(?:iop|shm)|(?:mkddc|kinexus)_shm\.h|iop_protocol\.h)"
)


def strip_ts_comments(source: str) -> str:
    """Bỏ comment TS/TSX, GIỮ NGUYÊN chuỗi ký tự.

    Vì sao cần: luật "Web UI không chạm contract C/SHM/IOP" trước đây quét thẳng
    toàn văn tệp, nên nó không phân biệt được một phụ thuộc thật với một dòng
    chú thích truy vết. `features/scheduler/shared.ts` chỉ ghi
    `khớp contracts/shm/mkddc_shm.h` để người đọc biết hằng số lấy từ đâu — đúng
    thứ `DOC_GOVERNANCE` khuyến khích — và bị tính là vi phạm.

    Hệ quả là gate `repository-layout` đỏ suốt một thời gian vì một lý do sai,
    và ai cũng học được rằng cách "sửa" là xoá chú thích. Đó là phần thưởng
    ngược: nó làm mã khó truy vết hơn mà không hề an toàn hơn.

    Bỏ comment TRƯỚC khi so khiến luật đo đúng thứ nó tuyên bố đo — phụ thuộc
    trong CODE. Chuỗi ký tự được giữ lại có chủ ý: một đường dẫn contract nằm
    trong string (import động, fetch, worker URL) VẪN là phụ thuộc thật và vẫn
    phải bị bắt.
    """

    out: list[str] = []
    index = 0
    length = len(source)
    while index < length:
        char = source[index]
        if char in "'\"`":
            quote = char
            out.append(char)
            index += 1
            while index < length:
                current = source[index]
                if current == "\\" and index + 1 < length:
                    out.append(source[index : index + 2])
                    index += 2
                    continue
                out.append(current)
                index += 1
                if current == quote:
                    break
            continue
        if char == "/" and index + 1 < length:
            following = source[index + 1]
            if following == "/":
                while index < length and source[index] != "\n":
                    index += 1
                continue
            if following == "*":
                index += 2
                while index + 1 < length and not (
                    source[index] == "*" and source[index + 1] == "/"
                ):
                    index += 1
                index += 2
                continue
        out.append(char)
        index += 1
    return "".join(out)


def fail(message: str) -> None:
    print(f"LỖI: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_paths(paths: list[str], root: Path = ROOT) -> None:
    missing = [path for path in paths if not (root / path).exists()]
    if missing:
        fail("thiếu path bắt buộc: " + ", ".join(missing))


def require_unique(values: list[str], label: str) -> None:
    duplicates = sorted({value for value in values if values.count(value) > 1})
    if duplicates:
        fail(f"{label} bị trùng: " + ", ".join(duplicates))


def validate_contracts(data: dict, root: Path = ROOT) -> None:
    """Bảo đảm mỗi contract chỉ có một authority; path cũ chỉ được làm shim."""

    contracts = data.get("contracts", [])
    require_unique([item["name"] for item in contracts], "contract name")
    require_unique([item["to"] for item in contracts], "contract authority")

    for item in contracts:
        authority = root / item["to"]
        if not authority.is_file():
            fail(f"thiếu contract authority: {item['to']}")

        compatibility_value = item.get("compatibility")
        if compatibility_value is None:
            continue
        compatibility = root / compatibility_value
        if not compatibility.exists():
            fail(f"thiếu shim tương thích: {compatibility_value}")

        if compatibility.is_symlink():
            if compatibility.resolve() != authority.resolve():
                fail(
                    f"shim {compatibility_value} không trỏ đúng authority "
                    f"{item['to']}"
                )
            continue

        if compatibility.stat().st_size > 2048:
            fail(f"shim {compatibility_value} quá lớn, có nguy cơ thành authority thứ hai")
        content = compatibility.read_text(encoding="utf-8")
        includes = []
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("#include \"") and stripped.endswith("\""):
                includes.append(stripped.removeprefix("#include \"").removesuffix("\""))
        resolved = [(compatibility.parent / include).resolve() for include in includes]
        if authority.resolve() not in resolved:
            fail(
                f"shim {compatibility_value} không forward trực tiếp tới "
                f"{item['to']}"
            )


INCLUDE_PATTERN = re.compile(r'^\s*#include\s+["<]([^">]+)[">]', re.MULTILINE)
IMPORT_PATTERN = re.compile(
    r"(?:from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]"
)


def source_files(base: Path, suffixes: set[str]) -> list[Path]:
    if not base.exists():
        return []
    return sorted(
        path
        for path in base.rglob("*")
        if path.is_file()
        and path.suffix in suffixes
        and "tests" not in path.parts
        and not path.name.startswith("test_")
    )


def validate_dependency_boundaries(root: Path = ROOT) -> None:
    """Chặn import sai chiều tại source, độc lập với compiler/linter cụ thể."""

    violations: list[str] = []

    core_forbidden = (
        "ipc/",
        "bacnet/",
        "config/",
        "diagnostics/",
        "persistence/",
        "runtime/",
        "schedule/",
        "st/",
    )
    for path in source_files(root / "apps/core/domain", {".h", ".hpp", ".c", ".cpp"}):
        content = path.read_text(encoding="utf-8", errors="replace")
        for include in INCLUDE_PATTERN.findall(content):
            if include.startswith(core_forbidden):
                violations.append(
                    f"{path.relative_to(root)}: domain Core import lớp ngoài qua {include}"
                )

    iobus_forbidden = (
        "iop/",
        "bacnet/",
        "modbus_rtu/",
        "platform/",
        "bridge/",
        "config/",
    )
    for path in source_files(root / "apps/iobus/domain", {".h", ".hpp", ".c", ".cpp"}):
        content = path.read_text(encoding="utf-8", errors="replace")
        for include in INCLUDE_PATTERN.findall(content):
            if include.startswith(iobus_forbidden):
                violations.append(
                    f"{path.relative_to(root)}: domain Iobus import adapter/application qua {include}"
                )

    for path in source_files(root / "firmware/stm32", {".h", ".hpp", ".c", ".cpp"}):
        content = path.read_text(encoding="utf-8", errors="replace")
        for include in INCLUDE_PATTERN.findall(content):
            if include in {"mkddc_shm.h", "kinexus_shm.h"} or include.startswith("apps/"):
                violations.append(
                    f"{path.relative_to(root)}: firmware phụ thuộc contract Linux/app qua {include}"
                )

    go_root = root / "apps/web-api"
    for path in source_files(go_root, {".go"}):
        content = path.read_text(encoding="utf-8", errors="replace")
        if re.search(r"^package\s+main\s*$", content, re.MULTILINE):
            relative = path.relative_to(go_root)
            if relative.parts[:2] != ("cmd", "mkddc-web"):
                violations.append(
                    f"{path.relative_to(root)}: package main nằm ngoài cmd/mkddc-web"
                )

    ui_source = root / "apps/web-ui/src"
    for path in source_files(ui_source, {".ts", ".tsx"}):
        content = path.read_text(encoding="utf-8", errors="replace")
        # So trên CODE đã bỏ comment: chú thích truy vết không phải phụ thuộc.
        # Chuỗi ký tự vẫn được giữ, nên import động/fetch tới contract vẫn bị bắt.
        if CONTRACT_REFERENCE_PATTERN.search(strip_ts_comments(content)):
            violations.append(
                f"{path.relative_to(root)}: Web UI chạm contract C/SHM/IOP"
            )
        for imported in IMPORT_PATTERN.findall(content):
            if not imported.startswith("."):
                continue
            target = (path.parent / imported).resolve()
            try:
                target_rel = target.relative_to(ui_source.resolve())
                source_rel = path.relative_to(ui_source)
            except ValueError:
                continue
            if len(target_rel.parts) < 2 or target_rel.parts[0] != "features":
                continue
            target_feature = target_rel.parts[1]
            source_feature = (
                source_rel.parts[1]
                if len(source_rel.parts) >= 2 and source_rel.parts[0] == "features"
                else None
            )
            if source_feature == target_feature:
                continue
            # Import chéo chỉ được trỏ đến thư mục feature (index.ts public API).
            if len(target_rel.parts) > 2:
                violations.append(
                    f"{path.relative_to(root)}: import sâu feature {target_feature} qua {imported}"
                )

    if violations:
        fail("vi phạm dependency boundary:\n- " + "\n- ".join(violations))


def validate_cmake_boundaries(root: Path = ROOT) -> None:
    required_targets = {
        "apps/core/CMakeLists.txt": {
            "core_domain",
            "core_application",
            "core_adapters",
            "core_runtime",
        },
        "apps/iobus/CMakeLists.txt": {
            "iobus_domain",
            "iobus_application",
            "iobus_iop_adapter",
            "iobus_modbus_adapter",
            "iobus_bacnet_adapter",
            "iobus_platform_adapter",
        },
    }
    missing: list[str] = []
    for relative, targets in required_targets.items():
        content = (root / relative).read_text(encoding="utf-8")
        for target in targets:
            if not re.search(rf"add_library\(\s*{re.escape(target)}\b", content):
                missing.append(f"{relative}:{target}")
    if missing:
        fail("thiếu CMake boundary target: " + ", ".join(missing))


def validate_build_artifact_isolation(root: Path = ROOT) -> None:
    """Không cho build tree quay lại source authority sau G4."""

    violations: list[str] = []
    for relative in ("apps", "firmware", "contracts"):
        base = root / relative
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if "node_modules" in path.parts:
                continue
            if path.is_dir() and path.name in {"CMakeFiles", "dist", "build"}:
                violations.append(str(path.relative_to(root)))
            elif path.is_file() and (
                path.name == "CMakeCache.txt"
                or path.suffix in {".o", ".obj"}
                or path.name == "firmware.elf"
            ):
                violations.append(str(path.relative_to(root)))
    if violations:
        fail("build artifact nằm trong source tree: " + ", ".join(sorted(violations)))


def main() -> int:
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"không đọc được manifest {MANIFEST}: {exc}")

    if data.get("schema_version") != 1:
        fail("schema_version của path manifest phải bằng 1")

    require_paths(
        [
            "CMakeLists.txt",
            "scripts/verify-project.sh",
            "apps/README.md",
            "firmware/README.md",
            "contracts/README.md",
            "platform/README.md",
            "platform/systemd",
            "tests/README.md",
        ]
    )

    migrations = data.get("migration", [])
    require_unique([item["owner"] for item in migrations], "owner migration")
    require_unique([item["from"] for item in migrations], "source migration")
    require_unique([item["to"] for item in migrations], "target migration")

    phase = data.get("phase")
    if phase in {"g1-indirection", "g2-contracts"}:
        require_paths([item["from"] for item in migrations])
    elif phase in {"g3-source-moved", "g4-modularized", "closed"}:
        require_paths([item["to"] for item in migrations])
    else:
        fail(f"phase manifest không hợp lệ: {phase!r}")

    contracts = data.get("contracts", [])
    validate_contracts(data)

    if phase in {"g4-modularized", "closed"}:
        stale_roots = [item["from"] for item in migrations if (ROOT / item["from"]).exists()]
        if stale_roots:
            fail("source production còn ở path cũ: " + ", ".join(stale_roots))
        require_paths(
            [
                "apps/core/domain",
                "apps/core/application",
                "apps/core/ports",
                "apps/core/adapters",
                "apps/core/bootstrap",
                "apps/iobus/domain",
                "apps/iobus/application",
                "apps/iobus/ports",
                "apps/iobus/adapters",
                "apps/iobus/bootstrap",
                "apps/web-api/cmd/mkddc-web",
                "apps/web-api/internal",
                "apps/web-ui/src/app",
                "apps/web-ui/src/features",
                "apps/web-ui/src/shared",
            ]
        )
        validate_dependency_boundaries()
        validate_cmake_boundaries()
        validate_build_artifact_isolation()

    artifacts = data.get("artifacts", [])
    require_unique([item["name"] for item in artifacts], "artifact name")
    # Nhiều artifact hợp lệ có thể cùng thuộc một unit, ví dụ binary Web và
    # static assets đều được phục vụ bởi mkddc-web-pi.service. Danh sách unit
    # authority riêng mới phải unique.
    require_unique(data.get("systemd_units", []), "systemd unit")

    print(
        "PASS: repository manifest hợp lệ; "
        f"phase={phase}, migration={len(migrations)}, "
        f"contracts={len(contracts)}, artifacts={len(artifacts)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
