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
