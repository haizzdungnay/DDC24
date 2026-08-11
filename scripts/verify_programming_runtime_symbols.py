#!/usr/bin/env python3
"""Chặn parser/compiler lọt vào artifact runtime Programming.

Đây là gate cấu trúc cho TASK-PROG-300. Nó không suy từ source tree mà đọc
symbol thật của binary/archive sau link bằng nm -C.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


FORBIDDEN = (
    "parse_st_source",
    "compile_st_source",
    "semantic_check_st",
    "BuildStArtifact",
    "BuildFbdArtifact",
    "compile_fbd_program",
    "StParser",
)

REQUIRED_RUNTIME = (
    "core::LoadArtifact(",
    "core::execute_st_program(",
    "core::StProgramRuntime::prepare(",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--nm", default="nm")
    parser.add_argument("--require-runtime", action="store_true")
    args = parser.parse_args()

    if not args.binary.is_file():
        print(f"FAIL: không tìm thấy artifact: {args.binary}", file=sys.stderr)
        return 2

    result = subprocess.run(
        [args.nm, "-C", "--defined-only", str(args.binary)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        return result.returncode

    symbols = result.stdout
    leaked = [name for name in FORBIDDEN if name in symbols]
    if leaked:
        print("FAIL: runtime artifact chứa parser/compiler symbol:", file=sys.stderr)
        for name in leaked:
            print(f"- {name}", file=sys.stderr)
        return 1

    if args.require_runtime:
        missing = [name for name in REQUIRED_RUNTIME if name not in symbols]
        if missing:
            print("FAIL: artifact kiểm tra không chứa runtime symbols bắt buộc:", file=sys.stderr)
            for name in missing:
                print(f"- {name}", file=sys.stderr)
            return 1

    print(f"PASS: không có parser/compiler symbol trong {args.binary.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
