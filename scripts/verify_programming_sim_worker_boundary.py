#!/usr/bin/env python3
"""Chặn worker mô phỏng có bất kỳ cạnh nào dẫn tới đường điều khiển production.

`ADR-053` §4 nói worker "không được link hoặc mở production SHM, device,
iobus/output writer, Core lifecycle IPC, singleton runtime state hay RETAIN
writer". Câu đó chỉ có giá trị khi có một cổng đọc **binary thật sau link**,
không suy từ cây thư mục hay từ danh sách nguồn trong CMake: một `target_link_libraries`
thêm vào lúc sửa build sẽ không làm review nào đỏ, nhưng làm binary đỏ ở đây.

Ba phép kiểm, mỗi phép trả lời một câu hỏi khác nhau:

1. Symbol ĐÃ ĐỊNH NGHĨA không được chứa lớp điều khiển/thiết bị production.
2. Symbol runtime bắt buộc PHẢI có mặt — nếu vắng thì worker đang chạy một bộ
   ngữ nghĩa khác với bộ đang chạy trên tủ, và tất cả bằng chứng tất định sau đó
   nói về một chương trình khác.
3. Thư viện động `NEEDED` phải nằm trong allowlist — một dependency mới kéo theo
   cả một bề mặt syscall mới mà sandbox chưa từng được kiểm với nó.

Exit `0` khi cả ba đạt, `1` khi vi phạm, `2` khi không đọc được binary.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

# Lớp điều khiển/thiết bị production. Không dùng tiền tố quá rộng như "core::"
# vì worker CÓ dùng loader/executor cùng namespace — cấm cả namespace nghĩa là
# cấm luôn thứ bắt buộc phải có.
FORBIDDEN_SYMBOLS = (
    "core::PointTable",
    "core::PointWriter",
    "core::PriorityResolver",
    "core::GraphRuntime",
    "core::RuntimePointSnapshot",
    "core::SafeState",
    "core::OverrunMonitor",
    "core::StScheduler",
    "core::st_apply_outputs",
    "core::st_apply_all_outputs",
    "core::st_load_inputs",
    "core::st_register_instance_candidates",
    "core::programming::ProgrammingRuntimeCoordinator",
    "core::programming::ProgramCandidateRegistry",
    "core::programming::ProgramIpcServer",
    "IopMaster",
    "ModbusRtu",
    "BacnetServer",
    "IoCache",
    "WebIpc",
)

REQUIRED_SYMBOLS = (
    "core::LoadArtifact(",
    "core::execute_st_program(",
    "core::StProgramRuntime::prepare(",
    "core::UnpackPackageV2(",
    "core::programming::sim::SimSession::step(",
    "core::programming::sim::apply_sandbox(",
)

ALLOWED_NEEDED = {
    "libsodium.so",
    "libstdc++.so",
    "libm.so",
    "libgcc_s.so",
    "libc.so",
    "libpthread.so",
    "librt.so",
    "ld-linux",
}


def read_symbols(binary: Path, nm: str) -> str:
    result = subprocess.run(
        [nm, "-C", "--defined-only", str(binary)],
        check=False, capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"FAIL: {nm} không đọc được {binary}: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(2)
    return result.stdout


def read_needed(binary: Path, readelf: str) -> list[str]:
    result = subprocess.run(
        [readelf, "-d", str(binary)],
        check=False, capture_output=True, text=True,
    )
    if result.returncode != 0:
        # Binary tĩnh hoàn toàn không có section động — đó là trạng thái HẸP HƠN
        # yêu cầu, nên không phải lỗi.
        return []
    return re.findall(r"Shared library: \[([^\]]+)\]", result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--nm", default="nm")
    parser.add_argument("--readelf", default="readelf")
    args = parser.parse_args()

    if not args.binary.is_file():
        print(f"FAIL: không tìm thấy binary: {args.binary}", file=sys.stderr)
        return 2

    symbols = read_symbols(args.binary, args.nm)

    violations = [name for name in FORBIDDEN_SYMBOLS if name in symbols]
    missing = [name for name in REQUIRED_SYMBOLS if name not in symbols]

    needed = read_needed(args.binary, args.readelf)
    unexpected = [
        library for library in needed
        if not any(library.startswith(prefix) for prefix in ALLOWED_NEEDED)
    ]

    if violations:
        print("FAIL: worker mô phỏng link lớp điều khiển/thiết bị production:", file=sys.stderr)
        for name in violations:
            print(f"  - {name}", file=sys.stderr)
        return 1
    if missing:
        print("FAIL: worker thiếu symbol runtime bắt buộc — nó không dùng đúng bộ ngữ nghĩa production:",
              file=sys.stderr)
        for name in missing:
            print(f"  - {name}", file=sys.stderr)
        return 1
    if unexpected:
        print("FAIL: dependency động ngoài allowlist:", file=sys.stderr)
        for library in unexpected:
            print(f"  - {library}", file=sys.stderr)
        return 1

    print(f"PASS: sim worker sạch — {len(FORBIDDEN_SYMBOLS)} nhóm symbol production vắng mặt, "
          f"{len(REQUIRED_SYMBOLS)} symbol runtime có mặt, {len(needed)} thư viện động đều trong allowlist")
    return 0


if __name__ == "__main__":
    sys.exit(main())
