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
4. Danh sách target của `--sandbox-probe` trong SOURCE phải lấy đường dẫn SHM từ
   hợp đồng, không chép tay. Xem `REQUIRED_SOURCE_TOKENS` bên dưới về lý do phép
   kiểm này phải nằm ở lớp source chứ không ở lớp errno.

Ba phép đầu cần binary sau link; phép thứ tư chỉ cần cây source, nên `--binary`
là TUỲ CHỌN: bỏ trống thì chạy riêng cổng tĩnh (lượt kiểm nhanh trên cây chưa
build). `ctest` luôn truyền `--binary`, nên đường chạy chính thức không mất cổng
nhị phân nào.

Exit `0` khi mọi phép chạy được đều đạt, `1` khi vi phạm, `2` khi không đọc được
binary.
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

# `#605` / `T59-817` — cổng tĩnh chặn TÁI PHÁT hằng số đường dẫn chép tay.
#
# `--sandbox-probe` chỉ là bằng chứng khi nó dò ĐÚNG đường dẫn sản phẩm. Hàng rào
# (Landlock/seccomp) từ chối ở lớp syscall TRƯỚC khi phân giải đường dẫn, nên một
# đường dẫn KHÔNG TỒN TẠI vẫn trả `EACCES` y hệt một đường dẫn tồn tại. Vì vậy
# phép đo `9/9 denied (errno 13)` ngày 2026-08-28 vẫn "xanh" trong khi năm trong
# tám target đã trôi khỏi nguồn chuẩn — nó chứng minh hàng rào chặn được năm cái
# tên không tồn tại, KHÔNG chứng minh worker không mở được SHM/IPC/RETAIN thật.
#
# Cổng errno trong `verify_programming_sim_worker.py` không bắt được lớp lỗi này:
# nó kiểm `denied` và `errno` của đúng cái danh sách được đưa cho nó, và một
# đường dẫn sai vẫn thoả cả hai. Nên chỗ duy nhất canh được sự trôi là SOURCE,
# nơi sự trôi thực sự xảy ra.
DEFAULT_WORKER_SOURCE = (
    Path(__file__).resolve().parent.parent
    / "apps/core/application/programming/programming_sim_worker_main.cpp"
)

# Hai target SHM phải đến từ `contracts/shm/mkddc_shm.h`, không phải chuỗi ký tự.
REQUIRED_SOURCE_TOKENS = (
    "KX_SHM_IO_PATH",
    "KX_SHM_PLC_PATH",
)

# Năm chuỗi đã trôi, giữ nguyên văn để cổng nói được TÊN SAI là gì chứ không chỉ
# báo "có gì đó sai". `"/dev/shm/mkddc_plc"` để cả hai dấu nháy: thiếu dấu đóng
# thì nó khớp luôn `"/dev/shm/mkddc_plc_shm"` là đường dẫn ĐÚNG, và cổng sẽ đỏ
# vĩnh viễn ngay sau khi bản sửa vào.
FORBIDDEN_SOURCE_TOKENS = (
    "mkddc_io_cache",
    '"/dev/shm/mkddc_plc"',
    "program_ipc.sock",
    "retain.bin",
    "journal.bin",
)

# Runtime của sanitizer. KHÔNG nằm trong allowlist mặc định: một binary phát
# hành mà kéo theo `libasan` là một binary sai, và cổng này phải nói ra.
# CMake chỉ bật `--allow-sanitizer-runtime` khi `MKDDC_SANITIZE` khác rỗng, nên
# lane phát hành giữ nguyên danh sách hẹp còn lane ASan/UBSan không đỏ vì một
# thư viện mà chính cấu hình build vừa yêu cầu.
SANITIZER_NEEDED = {
    "libasan.so",
    "libubsan.so",
    "libtsan.so",
    "liblsan.so",
    "libhwasan.so",
    "libclang_rt.",
}


def check_worker_source(source: Path) -> list[str]:
    """Danh sách vi phạm ở lớp source; rỗng nghĩa là đạt."""
    if not source.is_file():
        return [f"không đọc được source worker: {source}"]

    text = source.read_text(encoding="utf-8")
    problems: list[str] = []
    for token in REQUIRED_SOURCE_TOKENS:
        if token not in text:
            problems.append(
                f"thiếu hằng số hợp đồng `{token}` — target SHM đang là chuỗi chép tay"
            )
    for token in FORBIDDEN_SOURCE_TOKENS:
        if token in text:
            problems.append(
                f"còn đường dẫn đã trôi khỏi nguồn chuẩn của sản phẩm: `{token}`"
            )
    return problems


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
    # `--binary` TUỲ CHỌN: cổng tĩnh (phép kiểm 4) đọc source nên chạy được trên
    # cây chưa build. `ctest` vẫn luôn truyền `--binary`, nên ba cổng nhị phân
    # không bị bỏ qua ở đường chạy chính thức.
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--worker-source", type=Path, default=DEFAULT_WORKER_SOURCE,
                        help="source của worker mô phỏng cho cổng tĩnh đường dẫn probe")
    parser.add_argument("--nm", default="nm")
    parser.add_argument("--readelf", default="readelf")
    parser.add_argument("--allow-sanitizer-runtime", action="store_true",
                        help="cho phép libasan/libubsan/... — chỉ dùng cho build có -fsanitize")
    args = parser.parse_args()

    allowed = set(ALLOWED_NEEDED)
    if args.allow_sanitizer_runtime:
        allowed |= SANITIZER_NEEDED

    # Cổng tĩnh chạy TRƯỚC và luôn chạy: nó không cần binary, và nó là thứ duy
    # nhất bắt được đường dẫn probe trôi khỏi nguồn chuẩn.
    source_problems = check_worker_source(args.worker_source)
    if source_problems:
        print("FAIL: danh sách target `--sandbox-probe` đã trôi khỏi đường dẫn sản phẩm thật:",
              file=sys.stderr)
        for problem in source_problems:
            print(f"  - {problem}", file=sys.stderr)
        print("  Hàng rào chặn ở lớp syscall trước khi phân giải đường dẫn, nên một đường dẫn",
              file=sys.stderr)
        print("  sai vẫn trả EACCES: cổng errno KHÔNG bắt được lớp lỗi này. Xem `#605`.",
              file=sys.stderr)
        return 1

    if args.binary is None:
        print(f"PASS: cổng tĩnh đạt — {len(REQUIRED_SOURCE_TOKENS)} hằng số hợp đồng có mặt, "
              f"{len(FORBIDDEN_SOURCE_TOKENS)} đường dẫn đã trôi đều vắng mặt "
              f"({args.worker_source.name}). Ba cổng nhị phân: BỎ QUA (không có --binary).")
        return 0

    if not args.binary.is_file():
        print(f"FAIL: không tìm thấy binary: {args.binary}", file=sys.stderr)
        return 2

    symbols = read_symbols(args.binary, args.nm)

    violations = [name for name in FORBIDDEN_SYMBOLS if name in symbols]
    missing = [name for name in REQUIRED_SYMBOLS if name not in symbols]

    needed = read_needed(args.binary, args.readelf)
    unexpected = [
        library for library in needed
        if not any(library.startswith(prefix) for prefix in allowed)
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
          f"{len(REQUIRED_SYMBOLS)} symbol runtime có mặt, {len(needed)} thư viện động đều trong allowlist, "
          f"{len(REQUIRED_SOURCE_TOKENS)} hằng số đường dẫn lấy từ hợp đồng")
    return 0


if __name__ == "__main__":
    sys.exit(main())
