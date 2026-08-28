#!/usr/bin/env python3
"""Kiểm `mkddc-programming-sim-worker` ở mức BINARY THẬT.

Vì sao không chỉ unit test: giá trị của worker nằm ở chỗ nó là đúng tiến trình
mà supervisor Go sẽ sinh ra — với đúng hàng rào, đúng bắt tay và đúng khung
lệnh. Một unit test gọi thẳng `SimSession` bỏ lọt toàn bộ phần đó, và phần đó
chính là biên an toàn của `ADR-053`.

Bốn nhóm phép kiểm:

1. **Hàng rào** — chạy `--sandbox-probe`: mọi đường tới SHM/thiết bị/RETAIN/
   socket production phải trả `EACCES`/`EPERM`.
2. **Bắt tay** — lệnh trước `HELLO`, sai token, sai protocol version đều bị từ
   chối và tiến trình thoát khác 0. Đây là phần chống một tiến trình khác cắm
   vào ống.
3. **Ngữ nghĩa lệnh** — dùng gói ST ký THẬT dựng bằng chính CLI production:
   manifest allowlist, từ chối ghi biến ra, từ chối sai kiểu, và một `STEP`
   chạy đúng một base tick.
4. **Tất định** — hai tiến trình worker độc lập, cùng gói và cùng chuỗi input,
   phải cho chuỗi quan sát giống hệt nhau.

Exit `0` khi tất cả đạt, `1` khi có vi phạm, `2` khi thiếu công cụ/đầu vào.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST_KEY_HEADER = ROOT / "apps/core/application/st/st_test_key.hpp"

FAST_SOURCE = """PROGRAM Fast
VAR_INPUT  Setpoint : REAL; END_VAR
VAR_OUTPUT Runs : DINT; Doubled : REAL; END_VAR
    Runs := Runs + 1;
    Doubled := Setpoint * 2.0;
END_PROGRAM
"""

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


class Worker:
    """Một tiến trình worker + khung lệnh của nó."""

    def __init__(self, binary: Path, token: str = "0123456789abcdef"):
        self.token = token
        environment = dict(os.environ, MKDDC_SIM_SESSION_TOKEN=token)
        self.process = subprocess.Popen(
            [str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            env=environment,
        )

    def send(self, payload: dict, blob: bytes = b"") -> None:
        assert self.process.stdin is not None
        self.process.stdin.write((json.dumps(payload) + "\n").encode())
        if blob:
            self.process.stdin.write(blob)
        self.process.stdin.flush()

    def recv(self) -> dict:
        assert self.process.stdout is not None
        line = self.process.stdout.readline()
        if not line:
            return {}
        return json.loads(line.decode())

    def hello(self, token: str | None = None, version: int = 1) -> dict:
        self.send({"cmd": "HELLO", "commandId": "hello",
                   "token": self.token if token is None else token,
                   "protocolVersion": version})
        return self.recv()

    def close(self) -> int:
        assert self.process.stdin is not None
        try:
            self.process.stdin.close()
        except BrokenPipeError:
            pass
        return self.process.wait(timeout=15)


def test_key_hex() -> str:
    source = TEST_KEY_HEADER.read_text()
    body = source.split("static const uint8_t k[64] = {", 1)[1].split("};", 1)[0]
    values = [int(item, 16) for item in re.findall(r"0x([0-9A-Fa-f]{2})", body)]
    if len(values) != 64:
        print(f"FAIL: khoá test phải đúng 64 byte, đọc được {len(values)}", file=sys.stderr)
        sys.exit(2)
    return bytes(values).hex()


def build_package(compile_cli: Path, package_cli: Path, workdir: Path) -> bytes:
    key_path = workdir / "device.key"
    key_path.write_text(test_key_hex())
    source_path = workdir / "fast.st"
    source_path.write_text(FAST_SOURCE)
    artifact_path = workdir / "fast.mkir"
    package_path = workdir / "fast.mkpkg"

    compiled = subprocess.run(
        [str(compile_cli), "--source", str(source_path), "--out", str(artifact_path),
         "--key", str(key_path)],
        check=False, capture_output=True, text=True,
    )
    report = json.loads(compiled.stdout or "{}")
    if not report.get("ok"):
        print(f"FAIL: không biên dịch được fixture: {report.get('diagnostics')}", file=sys.stderr)
        sys.exit(2)

    packaged = subprocess.run(
        [str(package_cli), "--out", str(package_path), "--program", f"Fast={artifact_path}",
         "--period", "Fast=1000"],
        check=False, capture_output=True, text=True,
    )
    if not json.loads(packaged.stdout or "{}").get("ok"):
        print(f"FAIL: không đóng gói được fixture: {packaged.stdout}", file=sys.stderr)
        sys.exit(2)
    return package_path.read_bytes()


def check_sandbox(binary: Path) -> None:
    result = subprocess.run([str(binary), "--sandbox-probe"], check=False,
                            capture_output=True, text=True)
    try:
        report = json.loads(result.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        failures.append("sandbox-probe không trả JSON đọc được")
        return

    check(report.get("sandboxApplied") is True,
          f"hàng rào không dựng được: {report.get('sandboxError')}")
    check(report.get("fileWritesDenied") is True, "worker vẫn tạo được file")
    check(report.get("closedInheritedFds") is True, "worker không đóng FD thừa kế")
    if sys.platform.startswith("linux"):
        check(report.get("noNewPrivs") is True, "worker không đặt được NO_NEW_PRIVS")
        check(report.get("seccompInstalled") is True, "worker không cài được seccomp")
    for probe in report.get("probes", []):
        check(probe.get("denied") is True,
              f"worker MỞ ĐƯỢC {probe.get('target')} — biên sandbox thủng")
        if probe.get("denied"):
            check(probe.get("errno") in (1, 13),
                  f"{probe.get('target')} bị chặn nhưng errno={probe.get('errno')}, "
                  "kỳ vọng EPERM/EACCES")
    check(result.returncode == 0, f"sandbox-probe thoát {result.returncode}")


def check_handshake(binary: Path) -> None:
    # Lệnh trước HELLO.
    worker = Worker(binary)
    worker.send({"cmd": "STEP", "commandId": "early"})
    response = worker.recv()
    check(response.get("ok") is False and response.get("errorCode") == "SIM-E-001",
          f"lệnh trước HELLO phải bị từ chối, nhận: {response}")
    check(worker.close() != 0, "worker phải thoát khác 0 khi giao thức bị vi phạm")

    # Sai token.
    worker = Worker(binary)
    response = worker.hello(token="sai-token")
    check(response.get("ok") is False and response.get("errorCode") == "SIM-E-001",
          f"token sai phải bị từ chối, nhận: {response}")
    check(worker.close() != 0, "worker phải thoát khác 0 khi token sai")

    # Sai protocol version.
    worker = Worker(binary)
    response = worker.hello(version=99)
    check(response.get("ok") is False and response.get("errorCode") == "SIM-E-001",
          f"protocol version sai phải bị từ chối, nhận: {response}")
    check(worker.close() != 0, "worker phải thoát khác 0 khi protocol version sai")

    # Token rỗng ở môi trường: worker không được chấp nhận bắt tay "trống".
    environment = dict(os.environ)
    environment.pop("MKDDC_SIM_SESSION_TOKEN", None)
    process = subprocess.Popen([str(binary)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, env=environment)
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps(
        {"cmd": "HELLO", "commandId": "h", "token": "", "protocolVersion": 1}).encode() + b"\n")
    process.stdin.flush()
    line = process.stdout.readline()
    payload = json.loads(line.decode()) if line else {}
    check(payload.get("ok") is False,
          "thiếu token trong môi trường vẫn bắt tay được — worker chạy lạc không ai giám sát")
    process.stdin.close()
    process.wait(timeout=15)


def run_session(binary: Path, package: bytes, inputs: list[tuple[str, str, object]],
                steps: int) -> list[dict]:
    worker = Worker(binary)
    hello = worker.hello()
    check(hello.get("ok") is True, f"bắt tay hợp lệ bị từ chối: {hello}")
    worker.send({"cmd": "PREPARE", "commandId": "prepare", "artifactBytes": len(package)}, package)
    prepared = worker.recv()
    check(prepared.get("ok") is True,
          f"PREPARE thất bại: {prepared.get('errorCode')} {prepared.get('detail')}")
    for observation_id, data_type, value in inputs:
        worker.send({"cmd": "SET_INPUT", "commandId": "set", "observationId": observation_id,
                     "dataType": data_type, "value": value})
        worker.recv()
    frames: list[dict] = []
    for _ in range(steps):
        worker.send({"cmd": "STEP", "commandId": "step"})
        frames.append(worker.recv())
    worker.send({"cmd": "STOP", "commandId": "stop"})
    worker.recv()
    check(worker.close() == 0, "worker phải thoát 0 sau STOP")
    return frames


def check_semantics(binary: Path, package: bytes) -> None:
    worker = Worker(binary)
    check(worker.hello().get("ok") is True, "bắt tay hợp lệ bị từ chối")

    worker.send({"cmd": "PREPARE", "commandId": "prepare", "artifactBytes": len(package)}, package)
    prepared = worker.recv()
    check(prepared.get("ok") is True,
          f"PREPARE thất bại: {prepared.get('errorCode')} {prepared.get('detail')}")
    if prepared.get("ok"):
        check(prepared.get("baseTickMs") == 1000,
              f"baseTick phải là GCD chu kỳ (1000), nhận {prepared.get('baseTickMs')}")
        allowlist = [item["observationId"] for item in prepared.get("simulationInputs", [])]
        check(allowlist == ["Fast.Setpoint"],
              f"allowlist phải chỉ gồm VAR_INPUT, nhận {allowlist}")

    # Ghi vào biến ĐẦU RA.
    worker.send({"cmd": "SET_INPUT", "commandId": "deny-output", "observationId": "Fast.Runs",
                 "dataType": "DINT", "value": 7})
    denied = worker.recv()
    check(denied.get("errorCode") == "SIM-E-005",
          f"ghi biến đầu ra phải trả SIM-E-005, nhận {denied}")

    # Sai kiểu.
    worker.send({"cmd": "SET_INPUT", "commandId": "deny-type", "observationId": "Fast.Setpoint",
                 "dataType": "BOOL", "value": True})
    denied = worker.recv()
    check(denied.get("ok") is False,
          f"sai kiểu phải bị từ chối, nhận {denied}")

    worker.send({"cmd": "SET_INPUT", "commandId": "accept", "observationId": "Fast.Setpoint",
                 "dataType": "REAL", "value": 4.5})
    check(worker.recv().get("ok") is True, "ghi input hợp lệ bị từ chối")

    worker.send({"cmd": "STEP", "commandId": "step"})
    stepped = worker.recv()
    check(stepped.get("virtualTimeMs") == 1000,
          f"một STEP phải tiến đúng một base tick, nhận {stepped.get('virtualTimeMs')}")
    values = {item["observationId"]: item["value"] for item in stepped.get("observations", [])}
    check(values.get("Fast.Runs") == 1, f"Program phải chạy đúng một lần, nhận {values}")
    check(values.get("Fast.Doubled") == 9.0,
          f"đầu ra phải dùng input đã commit (4.5*2), nhận {values}")

    worker.send({"cmd": "STOP", "commandId": "stop"})
    check(worker.recv().get("stopped") is True, "STOP không xác nhận")
    check(worker.close() == 0, "worker phải thoát 0 sau STOP")


def check_determinism(binary: Path, package: bytes) -> None:
    inputs = [("Fast.Setpoint", "REAL", 3.25)]
    first = run_session(binary, package, inputs, steps=6)
    second = run_session(binary, package, inputs, steps=6)

    def signature(frames: list[dict]) -> list:
        return [[frame.get("virtualTimeMs"),
                 sorted((item["observationId"], item["value"])
                        for item in frame.get("observations", []))]
                for frame in frames]

    check(signature(first) == signature(second),
          "hai tiến trình worker độc lập cho kết quả khác nhau — phiên không còn tất định")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--compile-cli", required=True, type=Path)
    parser.add_argument("--package-cli", required=True, type=Path)
    args = parser.parse_args()

    for path in (args.binary, args.compile_cli, args.package_cli):
        if not path.is_file():
            print(f"FAIL: không tìm thấy {path}", file=sys.stderr)
            return 2

    check_sandbox(args.binary)
    check_handshake(args.binary)
    with tempfile.TemporaryDirectory() as workdir:
        package = build_package(args.compile_cli, args.package_cli, Path(workdir))
        check_semantics(args.binary, package)
        check_determinism(args.binary, package)

    if failures:
        print("FAIL: sim worker vi phạm hợp đồng:", file=sys.stderr)
        for item in failures:
            print(f"  - {item}", file=sys.stderr)
        return 1
    print("PASS: sim worker — hàng rào chặn mọi probe production, bắt tay fail-closed, "
          "ngữ nghĩa lệnh đúng và hai tiến trình độc lập cho kết quả giống hệt nhau")
    return 0


if __name__ == "__main__":
    sys.exit(main())
