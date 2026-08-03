"""Negative test cho guard chống hai nguồn contract authority."""

from __future__ import annotations

import importlib.util
import contextlib
import io
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools/restructure/verify_repository.py"
SPEC = importlib.util.spec_from_file_location("verify_repository", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class ContractAuthorityGuardTest(unittest.TestCase):
    def test_forwarder_hop_le(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            authority = root / "contracts/iop/iop_protocol.h"
            compatibility = root / "shared/iop_protocol.h"
            authority.parent.mkdir(parents=True)
            compatibility.parent.mkdir(parents=True)
            authority.write_text("#define IOP_VERSION 2\n", encoding="utf-8")
            compatibility.write_text(
                '#include "../contracts/iop/iop_protocol.h"\n', encoding="utf-8"
            )
            VERIFY.validate_contracts(
                {
                    "contracts": [
                        {
                            "name": "iop-v2",
                            "to": "contracts/iop/iop_protocol.h",
                            "compatibility": "shared/iop_protocol.h",
                        }
                    ]
                },
                root,
            )

    def test_ban_sao_khac_authority_bi_tu_choi(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            authority = root / "contracts/iop/iop_protocol.h"
            compatibility = root / "shared/iop_protocol.h"
            authority.parent.mkdir(parents=True)
            compatibility.parent.mkdir(parents=True)
            authority.write_text("#define IOP_VERSION 2\n", encoding="utf-8")
            compatibility.write_text("#define IOP_VERSION 1\n", encoding="utf-8")
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                VERIFY.validate_contracts(
                    {
                        "contracts": [
                            {
                                "name": "iop-v2",
                                "to": "contracts/iop/iop_protocol.h",
                                "compatibility": "shared/iop_protocol.h",
                            }
                        ]
                    },
                    root,
                )


if __name__ == "__main__":
    unittest.main()
