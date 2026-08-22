"""Guard cho gói phát hành: đúng biến thể FE, và không phát hành firmware giả.

Hai bất biến ở đây đều thuộc loại "hỏng im lặng": không có lỗi build, không có
test đỏ, triệu chứng chỉ lộ ra sau khi đã cài lên board.

1. `build-release.sh` phải build FE bằng `build:release`. Gọi `npm run build`
   trần sẽ để `VITE_PROGRAMMING_REV_A` rỗng, và toàn bộ bốn workspace
   Programming biến mất khỏi gói phát hành. Đã tái diễn hai lần
   (2026-08-14, 2026-08-17).

2. `firmware.elf` không được nằm trong `checksums.sha256`. Firmware STM32 hiện
   chưa có BSP: không linker script, không startup, mọi HAL là stub `weak`. ELF
   sinh ra không có bảng vector và không boot được. Băm nó vào release là phát
   hành provenance cho một artifact không tồn tại thật.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RELEASE_SCRIPT = ROOT / "platform/packaging/build-release.sh"
WEB_UI_PACKAGE = ROOT / "apps/web-ui/package.json"


def _uncommented_lines(text: str) -> list[str]:
    """Bỏ dòng comment để guard không tự bắt chính phần giải thích của nó."""
    out = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        out.append(line)
    return out


class ReleaseFrontendVariantTest(unittest.TestCase):
    def test_release_script_dung_cong_thuc_build_release(self) -> None:
        lines = _uncommented_lines(RELEASE_SCRIPT.read_text(encoding="utf-8"))
        npm_builds = [l.strip() for l in lines if re.search(r"\bnpm run build", l)]
        self.assertTrue(npm_builds, "build-release.sh không còn bước build FE nào")
        for command in npm_builds:
            self.assertNotRegex(
                command,
                r"npm run build\s*$",
                "build-release.sh gọi `npm run build` trần. Công thức phát hành phải là "
                "`npm run build:release` (đặt VITE_PROGRAMMING_REV_A=1), nếu không gói "
                "phát hành sẽ thiếu toàn bộ workspace Programming mà không có lỗi build.",
            )
        self.assertTrue(
            any("npm run build:release" in c for c in npm_builds),
            "build-release.sh phải build FE bằng `npm run build:release`",
        )

    def test_cong_thuc_build_release_bat_co_programming(self) -> None:
        scripts = json.loads(WEB_UI_PACKAGE.read_text(encoding="utf-8"))["scripts"]
        self.assertIn("build:release", scripts, "thiếu script `build:release`")
        self.assertIn(
            "VITE_PROGRAMMING_REV_A=1",
            scripts["build:release"],
            "`build:release` phải đặt VITE_PROGRAMMING_REV_A=1 — đó là toàn bộ lý do "
            "công thức này tồn tại tách khỏi `build`.",
        )


class ReleaseFirmwareProvenanceTest(unittest.TestCase):
    def test_firmware_elf_khong_nam_trong_checksums(self) -> None:
        lines = _uncommented_lines(RELEASE_SCRIPT.read_text(encoding="utf-8"))
        body = "\n".join(lines)
        self.assertNotIn(
            "MKDDC_FW_BINARY_REL",
            body,
            "build-release.sh lại băm firmware.elf vào release. Firmware STM32 chưa có "
            "BSP (không linker script/startup, HAL toàn stub weak, ELF không có bảng "
            "vector) nên không boot được trên STM32G0B1RBT6. Chỉ thêm lại khi có BSP "
            "thật, và thêm cả `make` lẫn dòng checksum trong cùng một commit.",
        )
        self.assertNotIn(
            "firmware.elf",
            body,
            "build-release.sh tham chiếu firmware.elf như một release artifact",
        )


if __name__ == "__main__":
    unittest.main()


class ProgrammingRuntimePackagingTest(unittest.TestCase):
    """T59-605 — hai nửa của Programming phải cùng ra bo trong một gói.

    Cả hai bất biến dưới đây cũng thuộc loại "hỏng im lặng": build xanh, test
    xanh, và triệu chứng chỉ lộ ra ở đúng thao tác cuối của người vận hành trên
    board.
    """

    INSTALL_SCRIPT = ROOT / "platform/packaging/install.sh"

    def test_packager_binary_duoc_cai_dat(self) -> None:
        """BE gọi `/usr/sbin/mkddc-st-package` ở bước Commission.

        Binary này được build và có test riêng, nhưng trước T59-605 KHÔNG được
        cài. Trên bo mới cài, Commission gọi vào một đường dẫn không tồn tại —
        không có lỗi nào sớm hơn để bắt.
        """
        install = _uncommented_lines(self.INSTALL_SCRIPT.read_text(encoding="utf-8"))
        # `inst` là wrapper của `install` do chế độ diễn tập T59-606 thêm vào; đích
        # ghi là "$SBIN/..." thay cho đường tuyệt đối. Guard đọc CẢ HAI dạng: nó
        # canh bất biến "packager được cài", không canh cách viết đường dẫn — buộc
        # một cách viết cố định sẽ làm guard đỏ mỗi lần script được dọn, và một
        # guard hay đỏ vì lý do sai là guard sắp bị tắt.
        installs = [
            l for l in install
            if "mkddc-st-package" in l and l.strip().split()[0] in ("install", "inst")
        ]
        self.assertTrue(
            installs,
            "install.sh phải cài mkddc-st-package — BE mặc định gọi "
            "/usr/sbin/mkddc-st-package (config.go ProgrammingPackagerPath)",
        )
        # Đích phải là thư mục sbin mà BE trỏ tới, dù viết trực tiếp hay qua biến.
        self.assertTrue(
            any("/usr/sbin/mkddc-st-package" in l or '"$SBIN/mkddc-st-package"' in l
                for l in installs),
            f"packager được cài nhưng không vào sbin: {installs}",
        )

        release = _uncommented_lines(RELEASE_SCRIPT.read_text(encoding="utf-8"))
        self.assertTrue(
            any("mkddc-st-package" in line for line in release),
            "checksums.sha256 phải phủ mkddc-st-package: provenance thiếu đúng "
            "binary sinh ra artifact là provenance không đầy đủ",
        )

    def test_programming_bat_mac_dinh_o_ca_hai_phia(self) -> None:
        """FE bật lúc build, BE bật bằng env — thiếu một nửa là 404 im lặng.

        Bo cài xong hiện đủ bốn workspace Programming (FE có cờ) nhưng mọi
        endpoint phía sau trả 404 vì `PROGRAMMING_REV_A` không có trong
        `/etc/mkddc-web.env`. Triệu chứng giống hệt "backend hỏng".
        """
        install = _uncommented_lines(self.INSTALL_SCRIPT.read_text(encoding="utf-8"))
        self.assertTrue(
            any("PROGRAMMING_REV_A=1" in line for line in install),
            "install.sh phải ghi PROGRAMMING_REV_A=1 vào /etc/mkddc-web.env",
        )
        # Nâng cấp KHÔNG được bỏ sót: file env đã tồn tại từ bản trước nên khối
        # khởi tạo lần đầu không chạy.
        text = self.INSTALL_SCRIPT.read_text(encoding="utf-8")
        self.assertIn(
            "grep -q '^PROGRAMMING_REV_A='",
            text,
            "phải có nhánh bổ sung cờ cho bo NÂNG CẤP, không chỉ cho bo cài mới",
        )


class ReleaseSigningKeyGateTest(unittest.TestCase):
    """T59-602 — khoá TEST không được lặng lẽ đi ra bản phát hành."""

    def test_release_script_chan_khoa_test(self) -> None:
        text = RELEASE_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("--st-key-info", text, "build-release.sh phải hỏi binary đang nhúng khoá nào")
        self.assertIn(
            "MKDDC_ALLOW_TEST_KEY",
            text,
            "phải có escape hatch TƯỜNG MINH cho bản lab, thay vì im lặng cho qua",
        )
        lines = _uncommented_lines(text)
        self.assertTrue(
            any("exit 1" in line for line in lines),
            "gate phải THOÁT khi gặp khoá TEST, không chỉ cảnh báo",
        )


class ReleaseSbomTest(unittest.TestCase):
    """T59-606 — gói phát hành phải nói được nó CHỨA gì, không chỉ build từ đâu."""

    SBOM_SCRIPT = ROOT / "scripts/generate_release_sbom.py"

    def test_build_release_sinh_sbom(self) -> None:
        lines = _uncommented_lines(RELEASE_SCRIPT.read_text(encoding="utf-8"))
        self.assertTrue(
            any("generate_release_sbom.py" in line for line in lines),
            "build-release.sh phải sinh sbom.json cùng gói",
        )

    def test_sbom_phu_ba_he_sinh_thai(self) -> None:
        text = self.SBOM_SCRIPT.read_text(encoding="utf-8")
        for marker in ("go list -m all", "npm ls", "FetchContent_Declare"):
            self.assertIn(marker, text, f"SBOM bỏ sót nguồn phụ thuộc: {marker}")

    def test_sbom_khong_noi_doi_ve_thu_vien_he_thong(self) -> None:
        """Phiên bản libsodium/libmodbus đọc trên MÁY BUILD, không phải trên board.

        Buildroot của board có bản khác. Một SBOM ghi số của máy build như thể là
        số của thiết bị còn tệ hơn không có SBOM — nên nguồn số phải được ghi rõ.
        """
        text = self.SBOM_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("resolvedFrom", text)
        self.assertIn("MÁY BUILD", text)
