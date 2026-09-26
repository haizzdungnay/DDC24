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

    def test_sim_worker_duoc_cai_canh_mkddc_web(self) -> None:
        """`mkddc-web` sinh worker mô phỏng bằng đường dẫn tuyệt đối.

        Hai bất biến, và bất biến thứ hai mới là cái khó thấy:

        1. Binary phải được CÀI, nếu không thì capability SIMULATE tắt vĩnh viễn
           trên mọi bo cài bằng script này.
        2. Nó phải nằm CẠNH `mkddc-web`, không phải trong `/usr/sbin`. Service
           chạy `User=mkddc` với PATH systemd mặc định (không có `/usr/sbin`),
           và unit trỏ `PROGRAMMING_SIM_WORKER` vào `/opt/mkddc-web/...` — cài
           sai chỗ thì mọi lần tạo phiên trả `PRG-SIM-UNSUPPORTED` mà không có
           lỗi nào sớm hơn để bắt.
        """
        install = _uncommented_lines(self.INSTALL_SCRIPT.read_text(encoding="utf-8"))
        installs = [
            l for l in install
            if "mkddc-programming-sim-worker" in l and l.strip().split()[0] in ("install", "inst")
        ]
        self.assertTrue(
            installs,
            "install.sh phải cài mkddc-programming-sim-worker — thiếu nó thì "
            "capability SIMULATE tắt trên mọi bo cài bằng script này",
        )
        self.assertTrue(
            any('"$WEBDIR/mkddc-programming-sim-worker"' in l or
                "/opt/mkddc-web/mkddc-programming-sim-worker" in l for l in installs),
            f"worker mô phỏng phải nằm cạnh mkddc-web, không vào sbin: {installs}",
        )

        unit = (ROOT / "platform/systemd/mkddc-web-pi.service").read_text(encoding="utf-8")
        self.assertIn(
            "Environment=PROGRAMMING_SIM_WORKER=/opt/mkddc-web/mkddc-programming-sim-worker",
            unit,
            "unit mkddc-web phải trỏ PROGRAMMING_SIM_WORKER tới đúng nơi install.sh đặt",
        )
        # Worker là EPHEMERAL theo ADR-053: không unit riêng, không auto-restart.
        # Một unit systemd cho nó sẽ làm phiên sống qua reboot, nằm ngoài quota
        # và TTL của supervisor.
        self.assertFalse(
            (ROOT / "platform/systemd/mkddc-programming-sim-worker.service").exists(),
            "worker mô phỏng KHÔNG được có unit systemd riêng (ADR-053 §1)",
        )

    def test_cpu_vong_quet_doc_quyen_duoc_cai_du(self) -> None:
        """ADR-061 4.11 (F14/F15): CPU3 dành riêng cho vòng quét 10 ms.

        Ba mảnh phải khớp nhau, thiếu mảnh nào cũng "hỏng im lặng" — core vẫn
        chạy, chỉ là lệch nhịp vượt C4 mà không có lỗi build hay test nào đỏ:

        1. unit core gọi `/usr/libexec/mkddc/rt-housekeeping` (workqueue +
           kernel thread không gắn CPU sang CPU0–2) và install.sh cài đúng
           file đó vào đúng chỗ;
        2. drop-in `system.conf.d/mkddc-rt.conf` (`CPUAffinity=0-2`) được cài;
        3. unit core khai `CPUAffinity=3`.
        """
        unit = (ROOT / "platform/systemd/mkddc-core.service").read_text(encoding="utf-8")
        unit_lines = _uncommented_lines(unit)
        self.assertIn("CPUAffinity=3", unit_lines)
        self.assertIn("ExecStartPre=-+/usr/libexec/mkddc/rt-housekeeping 0-2 7", unit_lines)

        install = _uncommented_lines(self.INSTALL_SCRIPT.read_text(encoding="utf-8"))
        self.assertTrue(
            any("rt-housekeeping.sh" in l and '"$LIBEXECDIR/rt-housekeeping"' in l for l in install),
            "install.sh phải cài rt-housekeeping.sh vào $LIBEXECDIR/rt-housekeeping — đúng đường dẫn unit gọi",
        )
        self.assertTrue(
            any("system-mkddc-rt.conf" in l and "system.conf.d/mkddc-rt.conf" in l for l in install),
            "install.sh phải cài drop-in system.conf.d/mkddc-rt.conf (CPUAffinity=0-2)",
        )
        script = ROOT / "platform/packaging/rt-housekeeping.sh"
        self.assertTrue(script.exists() and script.stat().st_mode & 0o111, "rt-housekeeping.sh phải tồn tại và executable")
        dropin = (ROOT / "platform/systemd/system-mkddc-rt.conf").read_text(encoding="utf-8")
        self.assertIn("CPUAffinity=0-2", _uncommented_lines(dropin))

    def test_cum_cpu_vong_quet_giu_tan_so_co_dinh(self) -> None:
        """ADR-061 4.11 / F17: cụm CPU chứa CPU3 giữ governor `performance`.

        RV1126B có một policy cpufreq cho cả 4 lõi; `schedutil` đổi tần số theo
        tải ở CPU0–2 làm cả cụm khựng và vòng quét thức dậy trễ quá 100 µs. Unit
        core phải `hold` lúc start, `release` lúc dừng, và install.sh phải cài
        script vào đúng đường dẫn unit gọi — thiếu mảnh nào cũng hỏng im lặng.
        """
        unit_lines = _uncommented_lines(
            (ROOT / "platform/systemd/mkddc-core.service").read_text(encoding="utf-8"))
        self.assertIn("ExecStartPre=-+/usr/libexec/mkddc/rt-cpufreq hold 3", unit_lines)
        self.assertIn("ExecStopPost=-+/usr/libexec/mkddc/rt-cpufreq release 3", unit_lines)
        install = _uncommented_lines(self.INSTALL_SCRIPT.read_text(encoding="utf-8"))
        self.assertTrue(
            any("rt-cpufreq.sh" in l and '"$LIBEXECDIR/rt-cpufreq"' in l for l in install),
            "install.sh phải cài rt-cpufreq.sh vào $LIBEXECDIR/rt-cpufreq — đúng đường dẫn unit gọi",
        )
        script = ROOT / "platform/packaging/rt-cpufreq.sh"
        self.assertTrue(script.exists() and script.stat().st_mode & 0o111,
                        "rt-cpufreq.sh phải tồn tại và executable")

    def test_unit_core_khong_co_lenh_chay_song_song_voi_vong_quet(self) -> None:
        """F16: mọi `Exec*` của unit nhận `CPUAffinity=3` + SCHED_FIFO 80 của core.

        `ExecStartPost` chạy ngay sau READY=1, tức SONG SONG với vòng quét, trên
        cùng CPU và cùng mức ưu tiên: một `/bin/sh -c "echo $MAINPID > …"` từng
        làm vòng quét thức dậy trễ 4–12 ms và lỡ base step ở 3/5 lần khởi động
        trên Foxlinx. Pidfile do core tự ghi.
        """
        unit_lines = _uncommented_lines(
            (ROOT / "platform/systemd/mkddc-core.service").read_text(encoding="utf-8"))
        self.assertFalse(
            [l for l in unit_lines if l.strip().startswith("ExecStartPost")],
            "unit mkddc-core không được có ExecStartPost (chạy FIFO 80 trên CPU vòng quét)",
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
