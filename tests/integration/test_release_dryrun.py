"""Diễn tập CÀI MỚI → NÂNG CẤP → ROLLBACK trên cây giả (T59-606).

Vì sao phải có file này: ba thao tác cuối cùng của một bản phát hành — cài lên
bo trắng, nâng cấp bo đang chạy, và lùi lại khi bản mới hỏng — trước đây chỉ
được kiểm bằng cách ĐỌC `install.sh`/`rollback.sh` rồi tin. Mọi lỗi ở lớp này
đều thuộc loại chỉ lộ ra trên bo thật, đúng vào lúc không có đường lùi:
`T59-605` đã bắt được `mkddc-st-package` build-mà-không-cài theo đúng kiểu đó.

`MKDDC_INSTALL_ROOT=DIR` cho phép hai script ghi vào một cây giả và bỏ các thao
tác cần quyền hệ thống (user/group, systemctl). Nhờ vậy ba kịch bản chạy được
trong test, trên máy thường, không sudo, không chạm hệ thống thật.

Điều kiện chạy: cần `build/release` đã dựng (`platform/packaging/build-release.sh`).
Thiếu thì test SKIP — cổng release riêng đã canh việc dựng gói.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INSTALL = ROOT / "platform/packaging/install.sh"
ROLLBACK = ROOT / "platform/packaging/rollback.sh"
RELEASE = ROOT / "build/release"

# Binary bắt buộc có mặt sau khi cài. Danh sách này là hợp đồng của gói: một
# binary được build mà không có ở đây thì không ai phát hiện lúc nó bị bỏ quên.
INSTALLED_BINARIES = [
    "usr/sbin/mkddc-core",
    "usr/sbin/mkddc-iobus",
    "usr/sbin/mkddc-netcfg",
    "usr/sbin/mkddc-st-compile",
    "usr/sbin/mkddc-st-package",
    "opt/mkddc-web/mkddc-web",
    "opt/mkddc-web/mkddc-schedule-sim",
]

# Binary phải được ROLLBACK khôi phục. Thiếu một dòng ở đây nghĩa là sau khi lùi,
# bo chạy lẫn hai phiên bản của cùng một tính năng.
ROLLED_BACK_BINARIES = INSTALLED_BINARIES


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def release_ready() -> bool:
    return (RELEASE / "checksums.sha256").is_file() and (
        RELEASE / "cpp/core/mkddc-core"
    ).is_file()


@unittest.skipUnless(release_ready(), "chưa dựng build/release (chạy build-release.sh)")
class ReleaseDryRunTest(unittest.TestCase):
    """Ba kịch bản chạy TUẦN TỰ trên cùng một cây giả, đúng thứ tự đời thật."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.mkdtemp(prefix="mkddc-dryrun-")
        cls.root = Path(cls._tmp) / "target"
        cls.root.mkdir(parents=True)
        cls.fresh_log = cls._install()

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls._tmp, ignore_errors=True)

    @classmethod
    def _run(cls, script: Path, *args: str) -> str:
        env = dict(os.environ, MKDDC_INSTALL_ROOT=str(cls.root))
        done = subprocess.run(
            ["bash", str(script), *args],
            cwd=ROOT, env=env, capture_output=True, text=True,
        )
        if done.returncode != 0:
            raise AssertionError(
                f"{script.name} thoát {done.returncode}\n"
                f"--- stdout ---\n{done.stdout}\n--- stderr ---\n{done.stderr}"
            )
        return done.stdout + done.stderr

    @classmethod
    def _install(cls) -> str:
        return cls._run(INSTALL, "--no-enable")

    # ---- 1. Cài mới lên bo trắng ------------------------------------------

    def test_1_cai_moi_dat_du_binary_va_metadata(self) -> None:
        for rel in INSTALLED_BINARIES:
            self.assertTrue((self.root / rel).is_file(), f"cài mới thiếu {rel}")
        self.assertTrue((self.root / "opt/mkddc-web/dist/index.html").is_file(),
                        "cài mới thiếu FE dist")
        for rel in ("usr/share/mkddc/provenance.json",
                    "usr/share/mkddc/checksums.sha256",
                    "usr/share/mkddc/runtime-checksums.sha256"):
            self.assertTrue((self.root / rel).is_file(), f"cài mới thiếu {rel}")

    def test_1_cai_moi_bat_programming_ca_hai_nua(self) -> None:
        env = (self.root / "etc/mkddc-web.env").read_text(encoding="utf-8")
        self.assertIn("PROGRAMMING_REV_A=1", env,
                      "BE không được bật Programming: bo sẽ hiện workspace mà endpoint trả 404")
        self.assertIn("JWT_SECRET=", env)

    def test_1_runtime_checksums_khop_file_that(self) -> None:
        """Hồ sơ checksum phải nói đúng về chính các file vừa cài."""
        recorded = (self.root / "usr/share/mkddc/runtime-checksums.sha256").read_text(
            encoding="utf-8"
        )
        for line in recorded.strip().splitlines():
            digest, path = line.split()
            actual = sha256(Path(path))
            self.assertEqual(digest, actual, f"checksum sai cho {path}")

    def test_1_khong_tao_snapshot_khi_chua_co_ban_truoc(self) -> None:
        backups = self.root / "var/backups/mkddc"
        self.assertFalse(backups.exists() and any(backups.iterdir()),
                         "cài mới không được sinh snapshot rollback")

    # ---- 2. Nâng cấp bo đang chạy -----------------------------------------

    def test_2_nang_cap_giu_du_lieu_va_chup_snapshot(self) -> None:
        root = self.root
        # Dấu vết của một bo đang vận hành: cấu hình đã sửa, dữ liệu đã sinh,
        # bí mật đã cấp. Nâng cấp không được chạm bất kỳ thứ nào.
        io_conf = root / "data/config/io_config.conf"
        io_conf.write_text("# nguoi van hanh da sua\nAI0=CUSTOM\n", encoding="utf-8")
        artifact = root / "data/mkddc/programming/artifacts/keep.bin"
        artifact.write_bytes(b"artifact cua khach")
        env_path = root / "etc/mkddc-web.env"
        secret_before = [l for l in env_path.read_text(encoding="utf-8").splitlines()
                         if l.startswith("JWT_SECRET=")][0]

        # Đánh dấu "bản đang chạy" để phân biệt với bản sắp cài đè: chỉ có cách
        # này mới kiểm được rollback có thực sự khôi phục ĐÚNG file cũ hay không.
        for rel in ROLLED_BACK_BINARIES:
            path = root / rel
            path.write_bytes(path.read_bytes() + b"\n# BAN-CU\n")
        old_digests = {rel: sha256(root / rel) for rel in ROLLED_BACK_BINARIES}
        type(self).old_digests = old_digests

        self._install()

        snapshot = root / "var/backups/mkddc/previous"
        self.assertTrue(snapshot.is_dir(), "nâng cấp không chụp snapshot bản đang chạy")
        for rel in ROLLED_BACK_BINARIES:
            name = Path(rel).name
            self.assertTrue((snapshot / name).is_file(), f"snapshot thiếu {name}")
            self.assertEqual(sha256(snapshot / name), old_digests[rel],
                             f"snapshot {name} không phải bản đang chạy")

        self.assertEqual(io_conf.read_text(encoding="utf-8"),
                         "# nguoi van hanh da sua\nAI0=CUSTOM\n",
                         "nâng cấp ghi đè cấu hình người vận hành")
        self.assertEqual(artifact.read_bytes(), b"artifact cua khach",
                         "nâng cấp làm mất artifact đã commission")
        env_after = env_path.read_text(encoding="utf-8")
        self.assertIn(secret_before, env_after, "nâng cấp cấp lại JWT_SECRET — mọi phiên đăng nhập chết")
        self.assertEqual(env_after.count("PROGRAMMING_REV_A="), 1,
                         "nâng cấp nhân đôi dòng cờ trong file env")
        # Bản mới thật sự được ghi đè lên bản đánh dấu.
        for rel in ROLLED_BACK_BINARIES:
            self.assertNotEqual(sha256(root / rel), old_digests[rel],
                                f"nâng cấp không thay {rel}")

    # ---- 3. Lùi về bản trước ----------------------------------------------

    def test_3_rollback_khoi_phuc_du_binary_va_giu_du_lieu(self) -> None:
        root = self.root
        self.test_2_nang_cap_giu_du_lieu_va_chup_snapshot()  # bảo đảm đã có snapshot
        old = type(self).old_digests

        self._run(ROLLBACK)

        for rel in ROLLED_BACK_BINARIES:
            self.assertEqual(
                sha256(root / rel), old[rel],
                f"rollback KHÔNG khôi phục {rel} — bo lùi nửa vời, hai phiên bản chạy lẫn nhau",
            )
        self.assertEqual((root / "data/config/io_config.conf").read_text(encoding="utf-8"),
                         "# nguoi van hanh da sua\nAI0=CUSTOM\n",
                         "rollback làm mất cấu hình")
        self.assertEqual((root / "data/mkddc/programming/artifacts/keep.bin").read_bytes(),
                         b"artifact cua khach", "rollback làm mất artifact")
        pre = list((root / "var/backups/mkddc").glob("pre-rollback-*"))
        self.assertTrue(pre, "rollback không chụp lại bản hiện tại — lùi xong hết đường tiến")


if __name__ == "__main__":
    unittest.main()
