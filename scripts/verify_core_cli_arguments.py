#!/usr/bin/env python3
"""Kiểm tra tham số sai bị từ chối trước khi Core khởi tạo runtime/socket."""

import pathlib
import subprocess
import sys
import tempfile


def main():
    binary = str(pathlib.Path(sys.argv[1]).resolve())
    invalid = ["--build-info", "--unknown", "unexpected-positional"]
    missing = ["--sock", "--fieldbus-sock", "--graph", "--safe-state-conf",
               "--io-conf", "--alarm-conf", "--schedule-conf", "--scan-ms",
               "--programming-mode", "--programming-sock", "--program-hold-ttl-ms",
               "--st-trusted-key", "--log-level"]
    with tempfile.TemporaryDirectory(prefix="mkddc-cli-guard-") as directory:
        root = pathlib.Path(directory)
        sentinel = root / "core.sock"
        sentinel.write_bytes(b"socket-owned-by-running-core")
        for argument in invalid + missing:
            result = subprocess.run(
                [binary, "--sock", str(sentinel), "--graph", str(root / "absent.json"), argument],
                capture_output=True, text=True, timeout=5, check=False)
            assert result.returncode == 1, (argument, result.returncode)
            assert "core.invalid_argument" in result.stderr, (argument, result.stderr)
            assert "core.start" not in result.stderr, (argument, result.stderr)
            assert sentinel.read_bytes() == b"socket-owned-by-running-core", argument
        for argument in ["--help", "--version", "--st-key-info"]:
            result = subprocess.run([binary, argument], capture_output=True, text=True,
                                    timeout=5, check=False)
            assert result.returncode == 0, (argument, result.stderr)
            assert "core.start" not in result.stderr, (argument, result.stderr)
    print(f"PASS: {len(invalid) + len(missing)} tham số sai; 3 lệnh chẩn đoán; socket giữ nguyên")


if __name__ == "__main__":
    main()
