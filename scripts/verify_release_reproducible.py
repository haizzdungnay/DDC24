#!/usr/bin/env python3
"""Kiểm tính tái lập của binary phát hành (T59-606).

Cùng một mã nguồn phải cho ra cùng một binary. Nếu không, "hash trong
`checksums.sha256` khớp" chỉ chứng minh file không đổi SAU khi build — nó không
chứng minh được file đó đến từ đúng mã nguồn ấy, và bên thứ ba không thể tự dựng
lại để đối chiếu.

Script build HAI LẦN vào hai thư mục khác nhau với đầu vào cố định
(`version`/`commit`/`build_time` ghim, `SOURCE_DATE_EPOCH` cố định) rồi so
SHA-256 từng artifact. Khác biệt KHÔNG bị coi là lỗi mặc định: nó được in kèm
nguồn gây khác biệt để người đọc quyết định, đúng như acceptance của T59-606
("reproducible hashes **or explained variance**").
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXED_EPOCH = "1750000000"
FIXED_VERSION = "0.0.0-repro"
FIXED_COMMIT = "0000000000000000000000000000000000000000"
FIXED_TIME = "2026-01-01T00:00:00Z"

CPP_TARGETS = [
    "core/mkddc-core",
    "core/mkddc-st-compile",
    "core/mkddc-st-package",
    "core/mkddc-schedule-sim",
    "iobus/mkddc-iobus",
    "netcfg/mkddc-netcfg",
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_cpp(build_dir: Path) -> None:
    env = dict(os.environ, SOURCE_DATE_EPOCH=FIXED_EPOCH)
    subprocess.run(
        ["cmake", "--fresh", "-S", str(ROOT), "-B", str(build_dir),
         "-DCMAKE_BUILD_TYPE=Release", f"-DMKDDC_VERSION={FIXED_VERSION}",
         "-DMKDDC_ENABLE_MODBUS=ON", "-DMKDDC_ENABLE_BACNET=ON",
         "-DMKDDC_ENABLE_HMI=OFF", "-DCORE_BUILD_TESTS=OFF", "-DIOBUS_BUILD_TESTS=OFF"],
        check=True, env=env, stdout=subprocess.DEVNULL)
    subprocess.run(["cmake", "--build", str(build_dir), "--parallel"],
                   check=True, env=env, stdout=subprocess.DEVNULL)


def build_go(output: Path) -> None:
    ldflags = (f"-s -w -X mkddc-web/internal/app.buildVersion={FIXED_VERSION} "
               f"-X mkddc-web/internal/app.buildGitCommit={FIXED_COMMIT} "
               f"-X mkddc-web/internal/app.buildTime={FIXED_TIME}")
    subprocess.run(
        ["go", "build", "-trimpath", "-ldflags", ldflags, "-o", str(output), "./cmd/mkddc-web"],
        cwd=ROOT / "apps/web-api", check=True,
        env=dict(os.environ, SOURCE_DATE_EPOCH=FIXED_EPOCH, GOFLAGS="-mod=readonly"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-cpp", action="store_true",
                        help="chỉ kiểm Go (nhanh); C++ build hai lần rất lâu")
    parser.add_argument("--keep", action="store_true", help="giữ lại thư mục build")
    args = parser.parse_args()

    workspace = ROOT / "build/repro"
    if workspace.exists() and not args.keep:
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True, exist_ok=True)

    rows: list[tuple[str, str, str]] = []

    for run in ("a", "b"):
        build_go(workspace / f"mkddc-web-{run}")
    rows.append(("mkddc-web (go)",
                 digest(workspace / "mkddc-web-a"),
                 digest(workspace / "mkddc-web-b")))

    if not args.skip_cpp:
        for run in ("a", "b"):
            build_cpp(workspace / f"cpp-{run}")
        for target in CPP_TARGETS:
            rows.append((f"{target} (c++)",
                         digest(workspace / "cpp-a" / target),
                         digest(workspace / "cpp-b" / target)))

    identical = 0
    print(f"{'artifact':32s} {'kết quả':10s} sha256(run A)")
    for name, first, second in rows:
        same = first == second
        identical += 1 if same else 0
        print(f"{name:32s} {'KHỚP' if same else 'KHÁC':10s} {first[:16]}")

    print(f"\ntái lập: {identical}/{len(rows)} artifact")
    if identical != len(rows):
        print("\nKhác biệt KHÔNG tự động là lỗi — nhưng phải giải thích được nguồn:")
        print("  - macro thời gian/đường dẫn nhúng lúc biên dịch (__DATE__/__FILE__)")
        print("  - thứ tự link hoặc tên file tạm phụ thuộc hệ thống")
        print("  - build id sinh ngẫu nhiên (--build-id=none để loại)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
