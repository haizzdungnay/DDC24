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
        # Hai con số này là ẢNH CHỤP có chủ ý: chúng bắt việc catalog thay đổi
        # ngoài ý muốn. Khi thêm/bớt mã CÓ CHỦ Ý thì cập nhật ở đây trong cùng
        # commit — đó là điểm dừng để người review nhìn thấy thay đổi.
        #
        # Cập nhật 2026-08-20: 19→20 và 77→104. Catalog đã lớn lên hợp lệ qua
        # `37a9d41` (ST-IOMAP-008, bump 1.4.0→1.5.0) và `d118f7a` (4 detail code
        # IPC RETAIN_RESET) nhưng test không được cập nhật kèm. Lỗi này KHÔNG ai
        # thấy vì `verify_repository.py` fail trước nó trong `run_layout` và
        # `set -e` cắt luôn phần còn lại — nó chỉ lộ ra sau khi 10 vi phạm
        # dependency boundary được sửa.
        #
        # Cập nhật `T59-408`: 122→124 detail. Hai mã core-ipc cho trace giá trị:
        # `IPC-TRACE-UNAVAILABLE` (chưa có bus trace → UNAVAILABLE, tính năng
        # chẩn đoán chưa sẵn sàng chứ không phải request sai) và
        # `IPC-TRACE-REJECTED` (tham số ngoài dải, hoặc thao tác nhầm phiên của
        # người khác). Số public giữ nguyên 30.
        #
        # Cập nhật corrective Plan59 (2026-08-24): 126→134 detail. Bốn mã
        # `ST-CLI-LIBRARY-LOCK`/`ST-CLI-POU-MANIFEST`/`ST-CLI-POU-PATH`/
        # `ST-CLI-SIGNAL-MANIFEST` cho manifest POU/library/signal ở CLI, một
        # mã `ST-SIG-005` cho signal-ref, và ba mã runtime `ST-RT-011..013`.
        # Số public giữ nguyên 30 — cả tám ánh xạ vào public code đã có.
        # Con số ở đây phải sửa CÙNG change-set với catalog: để nó lạc hậu là
        # biến một gate thành cảnh báo giả, và lần sau người đọc sẽ sửa số cho
        # xanh mà không đọc xem thứ gì vừa được thêm.
        #
        # Cập nhật `T59-814` (ADR-053): 30→38 public và 135→151 detail, catalog
        # 1.8.0. Tám public code `PRG-SIM-*` là họ mã MỚI, không gộp vào miền cũ:
        # người vận hành phải phân biệt được "input bị từ chối" với "worker
        # chết" với "phiên hết hạn", và cả ba đều có cách xử lý khác nhau. 16
        # detail đi kèm: tám `SIM-E-*` do worker phát và tám `SIM-SUP-*` do
        # supervisor phát; guard hai chiều đọc chính hai file nguồn đó.
        #
        # F-P59-GHOST-POU-001 (2026-08-24): 134→135 detail, catalog 1.7.2.
        # `ST-POU-005` ánh xạ về `PRG-ERR-CHECK-001` để Check/Package từ chối
        # PROGRAM POU chưa schedule thay vì tự gán chu kỳ 1000 ms. Public code
        # vẫn là 30 vì dùng đúng miền Check hiện hữu.
        #
        # Cập nhật `T59-405`: 120→122 detail. Hai mã core-ipc mới cho intent
        # Enable/Disable: `IPC-UNKNOWN-INSTANCE` (Program không có trong package
        # đang chạy → NOT_FOUND, vì người gọi và thiết bị đang nói về hai gói
        # khác nhau) và `IPC-RUNTIME-STATE` (trạng thái không cho phép hoặc vượt
        # trần chạy đồng thời → CONFLICT, không phải payload hỏng). Số public
        # giữ nguyên 30: hai mã này ánh xạ vào public code đã có.
        #
        # Cập nhật `T59-006`: 26→30 public và 118→120 detail — thay sáu mã gộp
        # mà T59-004 tự đặt bằng đúng mười mã `DDD` §5.2 đã khóa.
        #
        # Cập nhật `T59-004`: 20→26 public và 104→118 detail. Sáu public code mới
        # phủ POU/library/signal/output owner/enable/PID review; 14 detail mapping
        # mới được khai trong `st_diagnostic.hpp` và `st_control_api.hpp` cùng
        # commit, nên guard hai chiều vẫn đóng.
        #
        # Bất biến THẬT (catalog ↔ mã sinh ra khớp nhau) do
        # `generate_programming_errors.py --check` canh, chạy ngay phía trên
        # trong cùng gate.
        catalog, raw, schema_raw = GENERATOR.load_and_validate()
        self.assertEqual(catalog["catalogVersion"], "1.8.0")
        self.assertEqual(len(catalog["publicErrors"]), 38)
        self.assertEqual(len(catalog["componentDetails"]), 151)
        self.assertEqual(len(GENERATOR.sha256(raw)), 64)
        self.assertEqual(len(GENERATOR.sha256(schema_raw)), 64)

    def test_rejects_orphan_detail_mapping(self):
        """Mapping không có emitter nào khai là mapping ma — phải fail-closed.

        Trước T59-004 guard chỉ kiểm một chiều (source -> catalog), nên một ánh xạ
        trỏ detail code không tồn tại vẫn qua gate và FE có thể hiển thị một mã
        không bao giờ xảy ra.
        """
        self.assert_rejected(
            lambda catalog: catalog["componentDetails"].append(
                {
                    "component": "artifact-loader",
                    "detailCode": "IR-E-999",
                    "publicCode": "PRG-ERR-ARTIFACT-001",
                }
            )
        )

    def test_rejects_catalog_violating_its_own_schema(self):
        """Schema từng chỉ được băm chứ không thi hành nên nó đã drift thật."""
        self.assert_rejected(
            lambda catalog: catalog["publicErrors"][0].__setitem__(
                "statusClass", "KHONG_TON_TAI"
            )
        )

    def test_new_domain_codes_are_present_and_mapped(self):
        catalog, _, _ = GENERATOR.load_and_validate()
        codes = {item["code"] for item in catalog["publicErrors"]}
        for code in (
            "PRG-ERR-POU-KIND-001",
            "PRG-ERR-POU-RECURSION-001",
            "PRG-ERR-LIB-VERSION-001",
            "PRG-ERR-PROGRAM-LIMIT-001",
            "PRG-ERR-SIGNAL-PUBLISHER-001",
            "PRG-ERR-SIGNAL-FRESHNESS-001",
            "PRG-ERR-OUTPUT-OWNER-001",
            "PRG-ERR-ENABLE-NOT-COMMISSIONED-001",
            "PRG-ERR-PROGRAM-STATE-001",
            "PRG-ERR-PID-REVIEW-001",
        ):
            self.assertIn(code, codes)
            mapped = [
                item for item in catalog["componentDetails"]
                if item["publicCode"] == code
            ]
            self.assertTrue(mapped, f"{code} không có detail mapping nào")

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
