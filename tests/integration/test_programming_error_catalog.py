import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "generate_programming_errors",
    ROOT / "scripts/generate_programming_errors.py",
)
GENERATOR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(GENERATOR)


class ProgrammingErrorCatalogGeneratorTest(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads(
            (ROOT / "contracts/programming/error_catalog_v1.json").read_text()
        )

    def assert_rejected(self, mutate):
        candidate = copy.deepcopy(self.catalog)
        mutate(candidate)
        original = GENERATOR.CATALOG
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "error_catalog_v1.json"
            path.write_text(json.dumps(candidate))
            GENERATOR.CATALOG = path
            try:
                with self.assertRaises(ValueError):
                    GENERATOR.load_and_validate()
            finally:
                GENERATOR.CATALOG = original

    def test_current_catalog_is_complete(self):
        catalog, raw, schema_raw = GENERATOR.load_and_validate()
        self.assertEqual(len(catalog["publicErrors"]), 19)
        self.assertEqual(len(catalog["componentDetails"]), 77)
        self.assertEqual(len(GENERATOR.sha256(raw)), 64)
        self.assertEqual(len(GENERATOR.sha256(schema_raw)), 64)

    def test_rejects_unknown_major(self):
        self.assert_rejected(lambda catalog: catalog.__setitem__("catalogVersion", "2.0.0"))

    def test_rejects_missing_message_key(self):
        self.assert_rejected(lambda catalog: catalog["publicErrors"][0].pop("messageKey"))

    def test_rejects_duplicate_public_code(self):
        self.assert_rejected(
            lambda catalog: catalog["publicErrors"][1].__setitem__(
                "code", catalog["publicErrors"][0]["code"]
            )
        )

    def test_rejects_sensitive_public_arg(self):
        self.assert_rejected(
            lambda catalog: catalog["publicErrors"][0]["allowedArgs"].append("Password")
        )

    def test_rejects_missing_loader_mapping(self):
        self.assert_rejected(
            lambda catalog: catalog.__setitem__(
                "componentDetails",
                [
                    item
                    for item in catalog["componentDetails"]
                    if not (
                        item["component"] == "artifact-loader"
                        and item["detailCode"] == "IR-E-015"
                    )
                ],
            )
        )


if __name__ == "__main__":
    unittest.main()
