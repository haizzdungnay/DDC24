"""Negative test cho boundary Core/Iobus/Go/Web UI."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools/restructure/verify_repository.py"
SPEC = importlib.util.spec_from_file_location("verify_repository_dependency", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class DependencyGuardTest(unittest.TestCase):
    def assert_rejected(self, relative: str, content: str) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path = root / relative
            path.parent.mkdir(parents=True)
            path.write_text(content, encoding="utf-8")
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                VERIFY.validate_dependency_boundaries(root)

    def test_core_domain_khong_duoc_import_ipc_adapter(self) -> None:
        self.assert_rejected(
            "apps/core/domain/bad.cpp", '#include "ipc/iobus_reader.hpp"\n'
        )

    def test_iobus_domain_khong_duoc_import_modbus_adapter(self) -> None:
        self.assert_rejected(
            "apps/iobus/domain/bad.cpp", '#include "modbus_rtu/modbus_master.hpp"\n'
        )

    def test_package_main_ngoai_cmd_bi_tu_choi(self) -> None:
        self.assert_rejected("apps/web-api/internal/bad.go", "package main\n")

    def test_frontend_import_sau_feature_khac_bi_tu_choi(self) -> None:
        self.assert_rejected(
            "apps/web-ui/src/features/points/bad.ts",
            "import { useAuth } from '../auth/AuthProvider'\n",
        )

    def test_build_artifact_trong_source_bi_tu_choi(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            artifact = root / "firmware/stm32/build/firmware.elf"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b"not-a-real-firmware")
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                VERIFY.validate_build_artifact_isolation(root)


if __name__ == "__main__":
    unittest.main()
