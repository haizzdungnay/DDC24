"""Negative test cho cổng compiler/packager production của Plan 59.

Cổng Go bắt buộc phải đỏ trên clean checkout chưa dựng C++, và cũng phải đỏ
khi có binary nhưng provenance profile đã cũ. Hai trường hợp này trước đây bị
`t.Skip`, làm Wave nhìn xanh dù integration thật không hề chạy.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
VERIFY = ROOT / "scripts" / "verify-project.sh"


class ProgrammingProductionToolGateTest(unittest.TestCase):
    def run_gate(
        self, build_root: Path, *, env: dict[str, str] | None = None
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(VERIFY), "--component", "go", "--build-root", str(build_root)],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_clean_checkout_without_cpp_binary_fails_before_go(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_gate(Path(directory))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("thiếu production tool từ chính build của cổng cpp", result.stderr)

    def test_stale_profile_binary_fails_before_go(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            core = Path(directory) / "cpp-full" / "core"
            core.mkdir(parents=True)
            for name in ("mkddc-st-compile", "mkddc-st-package"):
                tool = core / name
                tool.write_text(
                    "#!/bin/sh\n"
                    "printf '%s\\n' 'profile_id=stale profile_sha256=" + "0" * 64 + "'\n",
                    encoding="utf-8",
                )
                tool.chmod(0o700)
            result = self.run_gate(Path(directory))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stale/không chứng minh được profile hiện hành", result.stderr)

    def test_relative_build_root_remains_absolute_inside_go_module(self) -> None:
        build_parent = ROOT / "build"
        build_parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=build_parent) as directory:
            build_root = Path(directory)
            core = build_root / "cpp-full" / "core"
            core.mkdir(parents=True)
            expected_profile = hashlib.sha256(
                (ROOT / "contracts/programming/product_profile_v2.json").read_bytes()
            ).hexdigest()
            for name in ("mkddc-st-compile", "mkddc-st-package"):
                tool = core / name
                tool.write_text(
                    "#!/bin/sh\n"
                    f"printf '%s\\n' 'profile_sha256={expected_profile}'\n",
                    encoding="utf-8",
                )
                tool.chmod(0o700)
            worker = core / "mkddc-programming-sim-worker"
            worker.write_text("#!/bin/sh\nprintf '%s\\n' '1.0.0'\n", encoding="utf-8")
            worker.chmod(0o700)

            fake_bin = build_root / "fake-bin"
            fake_bin.mkdir()
            fake_go = fake_bin / "go"
            fake_go.write_text(
                "#!/bin/sh\n"
                "for name in MKDDC_ST_COMPILER_BINARY MKDDC_ST_PACKAGER_BINARY "
                "MKDDC_SIM_WORKER_BINARY; do\n"
                "  eval 'value=$'\"$name\"\n"
                "  case \"$value\" in /*) ;; *) exit 41 ;; esac\n"
                "  test -x \"$value\" || exit 42\n"
                "done\n",
                encoding="utf-8",
            )
            fake_go.chmod(0o700)
            env = os.environ.copy()
            env["PATH"] = f"{fake_bin}:{env['PATH']}"
            relative_build_root = build_root.relative_to(ROOT)
            result = self.run_gate(relative_build_root, env=env)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
