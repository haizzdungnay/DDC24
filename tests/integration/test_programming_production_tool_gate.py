"""Negative test cho cổng compiler/packager production của Plan 59.

Cổng Go bắt buộc phải đỏ trên clean checkout chưa dựng C++, và cũng phải đỏ
khi có binary nhưng provenance profile đã cũ. Hai trường hợp này trước đây bị
`t.Skip`, làm Wave nhìn xanh dù integration thật không hề chạy.
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
VERIFY = ROOT / "scripts" / "verify-project.sh"


class ProgrammingProductionToolGateTest(unittest.TestCase):
    def run_gate(self, build_root: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(VERIFY), "--component", "go", "--build-root", str(build_root)],
            cwd=ROOT,
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


if __name__ == "__main__":
    unittest.main()
