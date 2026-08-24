#!/usr/bin/env python3
"""Harness target 24 giờ cho T59-702/VS-PROG-U05 (MCU FAKE được phép).

Harness này cố ý fail-closed. Nó không biến một lượt chạy ngắn, một health
snapshot, hay khoảng cách poll HTTP thành bằng chứng IOP. Lệnh ``verify`` chỉ
PASS khi raw evidence đủ 24 giờ monotonic, provenance sạch, fixture 10 Program
đúng contract, fault isolation/signal stale-recovery/restart đều được quan sát,
và target công bố metric ``maxPollGapMs`` của IOP nhỏ hơn 200 ms.

Credential chỉ nhận từ biến môi trường hoặc file secret 0600; token/password
không bao giờ được ghi vào state/evidence. Setup và các fault action dùng khóa
idempotency ổn định, checkpoint atomically và không xóa Project/Revision cũ.

Ví dụ (chạy trên board):

  export MKDDC_SOAK_PASSWORD='...'
  python3 scripts/target_soak_10program.py --base http://127.0.0.1:8082 \
    setup --signal-adapter /data/qa/st-signal-adapter.json
  python3 scripts/target_soak_10program.py --base http://127.0.0.1:8082 commission \
    --allow-replace-active
  python3 scripts/target_soak_10program.py --base http://127.0.0.1:8082 soak \
    --restart-hook /data/qa/restart-web-controlled
  python3 scripts/target_soak_10program.py --base http://127.0.0.1:8082 verify

``st-signal-adapter.json`` là adapter tạm thời bắt buộc vì authority hiện hành
khóa opcode/slot nhưng chưa khóa cú pháp ST authoring của signal. Schema:

  {"schemaVersion":1,"adapterId":"...",
   "publishStatement":"SIGNAL_PUBLISH({signal}, {value});",
   "readExpression":"SIGNAL_READ({signal})"}

Không có adapter hoặc thiếu placeholder bắt buộc thì dừng TRƯỚC network call.
Restart hook nhận ``MKDDC_SOAK_RUN_ID``/``MKDDC_SOAK_ACTION_ID`` qua env và
phải stdout đúng một JSON attestation, không in log/secret:

  {"schemaVersion":1,"service":"mkddc-web-pi",
   "before":{"mainPid":101,"nRestarts":0},
   "after":{"mainPid":202,"nRestarts":0,"activeState":"active"}}
"""

from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import dataclasses
import fcntl
import hashlib
import json
import os
import re
import ssl
import stat
import string
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Protocol


SCHEMA_VERSION = "2.0"
PROGRAM_COUNT = 10
PERIOD_PLAN = ((1000, 4), (5000, 3), (30000, 3))
CREATION_PERMUTATION = (7, 0, 9, 2, 5, 1, 8, 3, 6, 4)
FAULT_PROGRAM_INDEX = 3
FAULT_AFTER_RELEASES = 5
PRODUCER_INDEX = 0
CONSUMER_INDEX = 1
SIGNAL_FRESHNESS_MS = 2000
MIN_SOAK_SECONDS = 24 * 60 * 60
DEFAULT_INTERVAL_SECONDS = 0.1
DEFAULT_DETAIL_INTERVAL_SECONDS = 1.0
MAX_IOP_POLL_GAP_MS = 200.0
SIGNAL_FRESHNESS_STATES = frozenset({
    "FRESH", "STALE_HELD", "STALE_FALLBACK", "UNAVAILABLE", "NOT_DECLARED",
})
DEFAULT_SIGNAL_FAULT_AT_SECONDS = 5 * 60.0
DEFAULT_SIGNAL_FAULT_DURATION_SECONDS = 8.0
DEFAULT_RESTART_AT_SECONDS = 10 * 60.0
DEFAULT_CHECKPOINT_SECONDS = 10.0
DEFAULT_RECOVERY_SECONDS = 120.0
PROGRAM_NAMESPACE = uuid.UUID("0d762eeb-c7ee-4fdc-b6de-c89351d23a84")
SIGNAL_NAMESPACE = uuid.UUID("6fa79940-0458-43cc-9df5-a453467c8ac6")
MUTATION_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})
PROVENANCE_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_SAMPLE_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=6,
                                                          thread_name_prefix="t59-soak-http")


class HarnessError(RuntimeError):
    """Lỗi fail-closed có thể in ra mà không chứa credential."""


class BoundedFailures(set[str]):
    """Deduplicate/cap lỗi để verifier 24 h không tự làm cạn RAM khi target hỏng."""

    def append(self, value: str) -> None:
        if len(self) < 256:
            self.add(value)
        else:
            self.add("EVIDENCE_FAILURES_TRUNCATED")


class Clock(Protocol):
    def wall_ns(self) -> int: ...

    def monotonic_ns(self) -> int: ...

    def sleep(self, seconds: float) -> None: ...


class SystemClock:
    def wall_ns(self) -> int:
        return time.time_ns()

    def monotonic_ns(self) -> int:
        return time.monotonic_ns()

    def sleep(self, seconds: float) -> None:
        time.sleep(max(0.0, seconds))


def wall_iso(wall_ns: int) -> str:
    seconds, nanos = divmod(wall_ns, 1_000_000_000)
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(seconds)) + f".{nanos:09d}Z"


def boot_id() -> str:
    path = Path("/proc/sys/kernel/random/boot_id")
    try:
        value = path.read_text(encoding="ascii").strip()
    except OSError:
        return "UNAVAILABLE"
    return value if value else "UNAVAILABLE"


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def deterministic_uuid4(namespace: uuid.UUID, name: str) -> str:
    """Identity lặp lại được nhưng vẫn đúng rào backend: UUID version 4 + RFC variant."""
    raw = bytearray(hashlib.sha256(namespace.bytes + name.encode("utf-8")).digest()[:16])
    raw[6] = (raw[6] & 0x0F) | 0x40
    raw[8] = (raw[8] & 0x3F) | 0x80
    return str(uuid.UUID(bytes=bytes(raw)))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_all(descriptor: int, payload: bytes) -> None:
    offset = 0
    while offset < len(payload):
        written = os.write(descriptor, payload[offset:])
        if written <= 0:
            raise OSError("short write")
        offset += written


def atomic_write_json(path: Path, value: Any) -> None:
    """Ghi state/summary kiểu write+fsync+replace; không xóa dữ liệu đích cũ."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp.{os.getpid()}.{uuid.uuid4().hex}")
    descriptor: int | None = None
    try:
        # O_EXCL chỉ mở temp đúng MỘT lần. Mở lại cùng tên trước replace luôn
        # trả EEXIST và làm checkpoint/summary hỏng dù payload hoàn toàn hợp lệ.
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        payload = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
        _write_all(descriptor, payload)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.replace(temporary, path)
        os.chmod(path, 0o600)
        _fsync_directory(path.parent)
    except BaseException:
        if descriptor is not None:
            with contextlib.suppress(OSError):
                os.close(descriptor)
        with contextlib.suppress(OSError):
            temporary.unlink()
        raise


class StateStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock_path = path.with_suffix(path.suffix + ".lock")

    @contextlib.contextmanager
    def locked(self):
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(self.lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            os.close(descriptor)
            raise HarnessError(f"state đang được tiến trình khác giữ: {self.path}") from error
        try:
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def load(self) -> dict[str, Any] | None:
        if not self.path.exists():
            return None
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise HarnessError(f"state không đọc được, không tự ghi đè: {self.path}") from error
        if not isinstance(value, dict) or value.get("schemaVersion") != SCHEMA_VERSION:
            raise HarnessError(f"state sai schema, không tự migrate/ghi đè: {self.path}")
        return value

    def save(self, state: dict[str, Any], clock: Clock) -> None:
        state["updatedWallTime"] = wall_iso(clock.wall_ns())
        atomic_write_json(self.path, state)


def load_secret(password_env: str | None, password_file: Path | None,
                environ: Mapping[str, str] | None = None) -> str:
    environ = os.environ if environ is None else environ
    env_value = environ.get(password_env, "") if password_env else ""
    if env_value and password_file is not None:
        raise HarnessError("chỉ chọn một nguồn password: env hoặc secret file")
    if password_file is not None:
        try:
            descriptor = os.open(password_file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        except OSError as error:
            raise HarnessError(f"không đọc được secret file: {password_file}") from error
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
                raise HarnessError("secret file phải là regular file mode 0600, không symlink")
            raw = os.read(descriptor, 4097)
            value = raw.decode("utf-8").rstrip("\r\n")
        except (OSError, UnicodeDecodeError) as error:
            raise HarnessError(f"không đọc được secret file: {password_file}") from error
        finally:
            os.close(descriptor)
    else:
        value = env_value
    if not value:
        source = password_env or "MKDDC_SOAK_PASSWORD"
        raise HarnessError(f"thiếu password: đặt env {source} hoặc dùng --password-file FILE_0600")
    if "\x00" in value or len(value) > 4096:
        raise HarnessError("password secret không hợp lệ")
    return value


@dataclasses.dataclass(frozen=True)
class SignalSyntaxAdapter:
    adapter_id: str
    publish_statement: str
    read_expression: str
    sha256: str

    @staticmethod
    def _fields(template: str) -> list[str]:
        try:
            return [field for _, field, _, _ in string.Formatter().parse(template) if field is not None]
        except ValueError as error:
            raise HarnessError("template signal adapter không parse được") from error

    @classmethod
    def load(cls, path: Path) -> "SignalSyntaxAdapter":
        try:
            raw = path.read_bytes()
            value = json.loads(raw)
        except (OSError, json.JSONDecodeError) as error:
            raise HarnessError(f"không đọc được signal adapter: {path}") from error
        expected = {"schemaVersion", "adapterId", "publishStatement", "readExpression"}
        if not isinstance(value, dict) or set(value) != expected or value.get("schemaVersion") != 1:
            raise HarnessError("signal adapter phải đúng schema 1 và không có field lạ")
        adapter_id = value.get("adapterId")
        publish = value.get("publishStatement")
        read = value.get("readExpression")
        if not all(isinstance(item, str) and 1 <= len(item) <= 512 for item in (adapter_id, publish, read)):
            raise HarnessError("signal adapter có field rỗng hoặc quá dài")
        if sorted(cls._fields(publish)) != ["signal", "value"]:
            raise HarnessError("publishStatement phải có đúng {signal} và {value}")
        if cls._fields(read) != ["signal"]:
            raise HarnessError("readExpression phải có đúng một {signal}")
        rendered_publish = publish.format(signal="SOAK_SIGNAL", value="SoakValue")
        rendered_read = read.format(signal="SOAK_SIGNAL")
        if "\n" in rendered_read or not rendered_publish.rstrip().endswith(";"):
            raise HarnessError("readExpression phải một dòng; publishStatement phải kết thúc bằng ';'")
        return cls(adapter_id=adapter_id, publish_statement=publish, read_expression=read,
                   sha256=hashlib.sha256(raw).hexdigest())

    def publish(self, signal: str, value: str) -> str:
        return self.publish_statement.format(signal=signal, value=value)

    def read(self, signal: str) -> str:
        return self.read_expression.format(signal=signal)


def source_for(index: int, adapter: SignalSyntaxAdapter) -> str:
    """Nguồn deterministic; fault Program chỉ lỗi sau barrier Commission."""
    name = f"SOAK_{index:02d}"
    lines = [f"PROGRAM {name}"]
    if index == FAULT_PROGRAM_INDEX:
        lines.extend([
            "VAR FaultCounter : DINT; Divisor : DINT; END_VAR",
            "FaultCounter := FaultCounter + 1;",
            "Divisor := 1;",
            f"IF FaultCounter > {FAULT_AFTER_RELEASES} THEN Divisor := 0; END_IF;",
            "FaultCounter := FaultCounter / Divisor;",
        ])
    elif index == PRODUCER_INDEX:
        lines.extend([
            "VAR PublishedValue : REAL; END_VAR",
            "PublishedValue := PublishedValue + 1.0;",
            adapter.publish("SOAK_SOURCE", "PublishedValue"),
        ])
    elif index == CONSUMER_INDEX:
        lines.extend([
            "VAR ConsumedValue : REAL; END_VAR",
            f"ConsumedValue := {adapter.read('SOAK_SOURCE')};",
            adapter.publish("SOAK_CONSUMED", "ConsumedValue"),
        ])
    else:
        lines.extend(["VAR Counter : DINT; END_VAR", "Counter := Counter + 1;"])
    lines.append("END_PROGRAM")
    return "\n".join(lines) + "\n"


def _periods_for_programs(program_ids: list[str]) -> dict[str, int]:
    periods: dict[str, int] = {}
    cursor = 0
    for period, count in PERIOD_PLAN:
        for program_id in program_ids[cursor:cursor + count]:
            periods[program_id] = period
        cursor += count
    return periods


def load_provenance(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        raise HarnessError(f"không đọc được provenance target: {path}") from error
    if not isinstance(value, dict):
        raise HarnessError("provenance target không phải JSON object")
    commit = value.get("git_commit")
    if not isinstance(commit, str) or not PROVENANCE_COMMIT_RE.fullmatch(commit):
        raise HarnessError("provenance thiếu git_commit 40-hex")
    return {"sha256": hashlib.sha256(raw).hexdigest(), "document": value}


def new_state(project_name: str, adapter: SignalSyntaxAdapter, provenance: dict[str, Any],
              clock: Clock, current_boot_id: str) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    program_ids = [deterministic_uuid4(PROGRAM_NAMESPACE, f"{run_id}:program:{index}")
                   for index in range(PROGRAM_COUNT)]
    signal_ids = {
        "SOAK_SOURCE": deterministic_uuid4(SIGNAL_NAMESPACE, f"{run_id}:signal:source"),
        "SOAK_CONSUMED": deterministic_uuid4(SIGNAL_NAMESPACE, f"{run_id}:signal:consumed"),
    }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "runId": run_id,
        "createdWallTime": wall_iso(clock.wall_ns()),
        "bootId": current_boot_id,
        "projectName": project_name,
        "programIds": program_ids,
        "creationOrderProgramIds": [program_ids[index] for index in CREATION_PERMUTATION],
        "periodsMs": _periods_for_programs(program_ids),
        "faultProgramId": program_ids[FAULT_PROGRAM_INDEX],
        "producerProgramId": program_ids[PRODUCER_INDEX],
        "consumerProgramId": program_ids[CONSUMER_INDEX],
        "signalIds": signal_ids,
        "signalAdapter": {"adapterId": adapter.adapter_id, "sha256": adapter.sha256},
        "provenance": provenance,
        "idempotencyKeys": {
            "createProject": deterministic_uuid4(uuid.UUID(run_id), "create-project"),
            "savePrograms": deterministic_uuid4(uuid.UUID(run_id), "save-programs"),
            "sealRevision": deterministic_uuid4(uuid.UUID(run_id), "seal-revision"),
            "check": deterministic_uuid4(uuid.UUID(run_id), "check"),
            "commission": deterministic_uuid4(uuid.UUID(run_id), "commission"),
            "signalFaultDisable": deterministic_uuid4(uuid.UUID(run_id), "signal-fault-disable"),
            "signalFaultRecover": deterministic_uuid4(uuid.UUID(run_id), "signal-fault-recover"),
            **{f"task:{period}": deterministic_uuid4(uuid.UUID(run_id), f"task:{period}")
               for period, _ in PERIOD_PLAN},
            **{f"enable:{program_id}": deterministic_uuid4(uuid.UUID(run_id), f"enable:{program_id}")
               for program_id in program_ids},
        },
        "setup": {"tasksSaved": [], "enabledProgramIds": []},
        "soak": {"actions": {}},
    }


@dataclasses.dataclass(frozen=True)
class CallResult:
    status: int
    body: Any
    latency_ms: float
    started_wall_ns: int
    started_monotonic_ns: int
    ended_monotonic_ns: int
    error: str | None = None

    def evidence(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "latencyMs": round(self.latency_ms, 3),
            "startedWallTime": wall_iso(self.started_wall_ns),
            "startedMonotonicNs": self.started_monotonic_ns,
            "endedMonotonicNs": self.ended_monotonic_ns,
            "error": self.error,
            "body": self.body,
        }


class APIClient(Protocol):
    def call(self, method: str, path: str, data: Any = None,
             headers: Mapping[str, str] | None = None, timeout: float = 30.0,
             idempotency_key: str | None = None) -> CallResult: ...


class HTTPClient:
    def __init__(self, base: str, username: str, password: str, clock: Clock,
                 insecure_tls: bool = False) -> None:
        self.base = base.rstrip("/")
        self.username = username
        self._password = password
        self.clock = clock
        self.token = ""
        self._refresh_at_ns = 0
        self._login_lock = threading.Lock()
        self._ssl_context = ssl._create_unverified_context() if insecure_tls else ssl.create_default_context()

    def login(self) -> None:
        result = self._call_once("POST", "/api/v1/auth/login",
                                 {"username": self.username, "password": self._password},
                                 timeout=30.0, include_token=False)
        if result.status != 200 or not isinstance(result.body, dict) or not isinstance(result.body.get("token"), str):
            raise HarnessError(f"đăng nhập thất bại: HTTP {result.status}")
        self.token = result.body["token"]
        expires = result.body.get("expires_in", 3600)
        if not isinstance(expires, (int, float)) or expires <= 0:
            expires = 3600
        self._refresh_at_ns = self.clock.monotonic_ns() + int(max(60.0, float(expires) - 300.0) * 1e9)

    def _ensure_login(self) -> None:
        if not self.token or self.clock.monotonic_ns() >= self._refresh_at_ns:
            with self._login_lock:
                if not self.token or self.clock.monotonic_ns() >= self._refresh_at_ns:
                    self.login()

    def _call_once(self, method: str, path: str, data: Any, timeout: float,
                   include_token: bool, headers: Mapping[str, str] | None = None,
                   idempotency_key: str | None = None) -> CallResult:
        body = json.dumps(data).encode("utf-8") if data is not None else None
        request = urllib.request.Request(self.base + path, data=body, method=method)
        request.add_header("Content-Type", "application/json")
        if include_token and self.token:
            request.add_header("Authorization", "Bearer " + self.token)
        if idempotency_key:
            request.add_header("X-Idempotency-Key", idempotency_key)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        started_wall = self.clock.wall_ns()
        started_mono = self.clock.monotonic_ns()
        status = 0
        response_body: Any = {}
        error_code: str | None = None
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=self._ssl_context) as response:
                raw = response.read().decode("utf-8", errors="replace")
                status = response.status
                response_body = json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read().decode("utf-8", errors="replace")
            try:
                response_body = json.loads(raw or "{}")
            except json.JSONDecodeError:
                response_body = {"raw": raw[:400]}
            error_code = "http_error"
        except (urllib.error.URLError, TimeoutError, OSError):
            status, response_body, error_code = 0, {}, "transport_error"
        ended_mono = self.clock.monotonic_ns()
        return CallResult(status, response_body, (ended_mono - started_mono) / 1e6,
                          started_wall, started_mono, ended_mono, error_code)

    def call(self, method: str, path: str, data: Any = None,
             headers: Mapping[str, str] | None = None, timeout: float = 30.0,
             idempotency_key: str | None = None) -> CallResult:
        method = method.upper()
        if method in MUTATION_METHODS and path != "/api/v1/auth/login" and not idempotency_key:
            raise HarnessError(f"mutation thiếu idempotency key: {method} {path}")
        self._ensure_login()
        result = self._call_once(method, path, data, timeout, True, headers, idempotency_key)
        if result.status == 401:
            with self._login_lock:
                self.login()
            result = self._call_once(method, path, data, timeout, True, headers, idempotency_key)
        return result


def expect(result: CallResult, wanted: Iterable[int], label: str) -> dict[str, Any]:
    wanted_set = set(wanted)
    if result.status not in wanted_set or not isinstance(result.body, dict):
        raise HarnessError(f"{label}: HTTP {result.status}, mong đợi {sorted(wanted_set)}")
    return result.body


def _fixture_operations(state: dict[str, Any], adapter: SignalSyntaxAdapter) -> list[dict[str, Any]]:
    operations: list[dict[str, Any]] = []
    index_by_id = {program_id: index for index, program_id in enumerate(state["programIds"])}
    for program_id in state["creationOrderProgramIds"]:
        index = index_by_id[program_id]
        operations.append({
            "op": "upsertProgram",
            "program": {"programId": program_id, "name": f"SOAK_{index:02d}",
                        "kind": "PROGRAM", "language": "ST", "document": source_for(index, adapter)},
        })
    operations.extend([
        {"op": "upsertSignal", "signal": {
            "signalId": state["signalIds"]["SOAK_SOURCE"], "name": "SOAK_SOURCE", "type": "REAL",
            "unit": "count", "publisherProgramId": state["producerProgramId"],
            "freshnessMs": SIGNAL_FRESHNESS_MS, "stalePolicy": "WAIT",
        }},
        {"op": "upsertSignal", "signal": {
            "signalId": state["signalIds"]["SOAK_CONSUMED"], "name": "SOAK_CONSUMED", "type": "REAL",
            "unit": "count", "publisherProgramId": state["consumerProgramId"],
            "freshnessMs": SIGNAL_FRESHNESS_MS, "stalePolicy": "HOLD_LAST",
        }},
    ])
    return operations


def setup_fixture(client: APIClient, store: StateStore, state: dict[str, Any],
                  adapter: SignalSyntaxAdapter, clock: Clock) -> None:
    setup_state = state["setup"]
    keys = state["idempotencyKeys"]
    if not setup_state.get("projectId"):
        result = client.call("POST", "/api/v1/programming/projects", {
            "schemaVersion": "1.0", "name": state["projectName"],
            "description": "T59-702 target soak 10 Program/3 chu kỳ/Published Signal/fault isolation",
        }, idempotency_key=keys["createProject"])
        created = expect(result, {201}, "tạo Project")
        resource = created.get("resource", {})
        setup_state.update({"projectId": resource.get("projectId"),
                            "draftRevisionId": resource.get("draftRevisionId"),
                            "etag": created.get("etag")})
        if not all(setup_state.get(key) for key in ("projectId", "draftRevisionId", "etag")):
            raise HarnessError("phản hồi tạo Project thiếu identity/ETag")
        store.save(state, clock)

    project_id = setup_state["projectId"]
    draft_id = setup_state["draftRevisionId"]
    if not setup_state.get("programsSaved"):
        result = client.call("PATCH", f"/api/v1/programming/projects/{project_id}/draft", {
            "schemaVersion": "1.0", "baseRevisionId": draft_id,
            "operations": _fixture_operations(state, adapter),
        }, {"if-match": setup_state["etag"]}, idempotency_key=keys["savePrograms"])
        saved = expect(result, {200}, "lưu Program và Published Signal")
        setup_state["etag"] = saved.get("etag", setup_state["etag"])
        setup_state["programsSaved"] = True
        store.save(state, clock)

    cursor = 0
    saved_tasks = set(setup_state.get("tasksSaved", []))
    for period, count in PERIOD_PLAN:
        program_order = state["programIds"][cursor:cursor + count]
        cursor += count
        if period in saved_tasks:
            continue
        result = client.call("PATCH", f"/api/v1/programming/projects/{project_id}/draft", {
            "schemaVersion": "1.0", "baseRevisionId": draft_id,
            "operations": [{"op": "setTask", "task": {"taskId": f"task-{period}",
                                                           "periodMs": period,
                                                           "programOrder": program_order}}],
        }, {"if-match": setup_state["etag"]}, idempotency_key=keys[f"task:{period}"])
        saved = expect(result, {200}, f"setTask {period} ms")
        setup_state["etag"] = saved.get("etag", setup_state["etag"])
        setup_state.setdefault("tasksSaved", []).append(period)
        store.save(state, clock)

    if not setup_state.get("revisionId"):
        result = client.call("POST", f"/api/v1/programming/projects/{project_id}/draft/revisions", {
            "schemaVersion": "1.0", "baseRevisionId": draft_id,
            "label": "T59-702-soak-10p", "comment": "Target MCU FAKE; 24h evidence required",
        }, {"if-match": setup_state["etag"]}, idempotency_key=keys["sealRevision"])
        sealed = expect(result, {201}, "seal Revision")
        resource = sealed.get("resource", {})
        setup_state["revisionId"] = resource.get("revisionId")
        setup_state["etag"] = sealed.get("etag", setup_state["etag"])
        if not setup_state["revisionId"]:
            raise HarnessError("phản hồi seal thiếu revisionId")
        store.save(state, clock)

    if not setup_state.get("checkId"):
        result = client.call("POST", f"/api/v1/programming/revisions/{setup_state['revisionId']}/checks", {
            "schemaVersion": "1.0", "targetProfile": "MK-DDC-24-REV-A",
        }, idempotency_key=keys["check"])
        accepted = expect(result, {202}, "chạy Check")
        setup_state["checkId"] = accepted.get("checkId")
        if not setup_state["checkId"]:
            raise HarnessError("phản hồi Check thiếu checkId")
        store.save(state, clock)

    if setup_state.get("checkState") != "PASSED":
        deadline = clock.monotonic_ns() + int(300e9)
        while clock.monotonic_ns() < deadline:
            result = client.call("GET", f"/api/v1/programming/checks/{setup_state['checkId']}")
            check = expect(result, {200}, "đọc Check")
            check_state = check.get("state")
            if check_state == "PASSED":
                artifact = check.get("artifact")
                if not isinstance(artifact, dict) or not re.fullmatch(r"[0-9a-f]{64}", str(artifact.get("sha256", ""))):
                    raise HarnessError("Check PASSED nhưng thiếu artifact SHA-256")
                setup_state["checkState"] = "PASSED"
                setup_state["artifact"] = artifact
                store.save(state, clock)
                break
            if check_state in {"FAILED", "TIMED_OUT"}:
                diagnostics = check.get("diagnostics", [])
                codes = [item.get("code") for item in diagnostics if isinstance(item, dict)]
                raise HarnessError(f"Check {check_state}; diagnostic codes={codes[:20]}")
            clock.sleep(1.0)
        else:
            raise HarnessError("Check không kết thúc trong 300 giây")


def _poll_operation(client: APIClient, operation_id: str, clock: Clock) -> dict[str, Any]:
    deadline = clock.monotonic_ns() + int(300e9)
    while clock.monotonic_ns() < deadline:
        result = client.call("GET", f"/api/v1/programming/operations/{operation_id}")
        operation = expect(result, {200}, "đọc operation")
        state = operation.get("state")
        if state == "SUCCEEDED":
            return operation
        if state in {"FAILED", "ROLLED_BACK"}:
            raise HarnessError(f"operation {operation_id} kết thúc {state}")
        clock.sleep(1.0)
    raise HarnessError(f"operation {operation_id} không kết thúc trong 300 giây")


def commission_and_enable(client: APIClient, store: StateStore, state: dict[str, Any],
                          clock: Clock, allow_replace_active: bool) -> None:
    setup_state = state["setup"]
    if setup_state.get("checkState") != "PASSED":
        raise HarnessError("phải setup và Check PASSED trước Commission")
    revision_id = setup_state["revisionId"]
    runtime = expect(client.call("GET", "/api/v1/programming/runtime"), {200}, "đọc Active Revision")
    active = runtime.get("activeRevisionId")
    if active and active != revision_id and not allow_replace_active:
        raise HarnessError("target đã có Active Revision khác; dùng --allow-replace-active sau backup/read-back")
    if setup_state.get("commissionState") == "SUCCEEDED" and active != revision_id:
        raise HarnessError("fixture từng Commission nhưng không còn là Active Revision; không Enable nhầm package")
    if active == revision_id:
        setup_state["commissionState"] = "SUCCEEDED"
    elif setup_state.get("commissionState") != "SUCCEEDED":
        baseline = active or "none"
        changes = expect(client.call("GET", f"/api/v1/programming/revisions/{baseline}/changes/{revision_id}"),
                         {200}, "đọc impact")
        impact = changes.get("impact")
        if not isinstance(impact, dict) or not impact.get("impactRef"):
            raise HarnessError("impact thiếu impactRef")
        groups = ("retain", "activeOverrides", "cutover", "outputMappingChanges",
                  "publishedSignals", "controlLibrary", "programSet", "enableIntent")
        acknowledgements: list[str] = []
        for group in groups:
            group_value = impact.get(group)
            status = group_value.get("status") if isinstance(group_value, dict) else None
            if status in {None, "UNAVAILABLE"}:
                raise HarnessError(f"impact.{group} = {status or 'MISSING'}; không ack mù")
            if status == "PRESENT":
                acknowledgements.append(group)
        if setup_state.get("commissionOperationId"):
            operation_id = setup_state["commissionOperationId"]
        else:
            accepted = expect(client.call("POST", "/api/v1/programming/operations/commission", {
                "schemaVersion": "1.0", "revisionId": revision_id,
                "expectedActiveRevisionId": active, "checkId": setup_state["checkId"],
                "impactRef": impact["impactRef"], "acknowledgements": acknowledgements,
                "cutover": {"requested": "PROGRAM_ONLY"},
            }, idempotency_key=state["idempotencyKeys"]["commission"]), {202}, "Commission")
            operation_id = accepted.get("operationId")
            if not operation_id:
                raise HarnessError("Commission thiếu operationId")
            setup_state["commissionOperationId"] = operation_id
            setup_state["replacedActiveRevisionId"] = active
            setup_state["impactAcknowledgements"] = acknowledgements
            store.save(state, clock)
        _poll_operation(client, operation_id, clock)
        setup_state["commissionState"] = "SUCCEEDED"
        store.save(state, clock)

    enabled = set(setup_state.get("enabledProgramIds", []))
    for program_id in state["programIds"]:
        if program_id in enabled:
            continue
        result = client.call("PUT", f"/api/v1/programming/projects/{setup_state['projectId']}/programs/{program_id}/runtime-intent",
                             {"schemaVersion": "1.0", "desiredEnabled": True},
                             idempotency_key=state["idempotencyKeys"][f"enable:{program_id}"])
        expect(result, {200}, f"Enable {program_id}")
        setup_state.setdefault("enabledProgramIds", []).append(program_id)
        store.save(state, clock)
    setup_state["fixtureReady"] = True
    store.save(state, clock)


class EvidenceWriter:
    def __init__(self, path: Path, run_id: str):
        self.path = path
        self.run_id = run_id
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.sequence = 0
        self.complete = False
        self.has_start = False
        if self.path.exists():
            with self.path.open("rb") as source:
                for line_number, raw in enumerate(source, 1):
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError as error:
                        raise HarnessError(f"evidence hỏng ở dòng {line_number}; không tự truncate/xóa") from error
                    if event.get("runId") != run_id:
                        raise HarnessError("evidence hiện có thuộc runId khác; không ghi nối")
                    self.sequence = max(self.sequence, int(event.get("sequence", 0)))
                    self.has_start = self.has_start or event.get("event") == "run_start"
                    self.complete = self.complete or event.get("event") == "run_complete"
        self._fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)

    def append(self, event: str, clock: Clock, **payload: Any) -> dict[str, Any]:
        self.sequence += 1
        wall_now = clock.wall_ns()
        record = {
            "schemaVersion": SCHEMA_VERSION, "runId": self.run_id,
            "sequence": self.sequence, "event": event,
            "wallTime": wall_iso(wall_now), "wallUnixNs": wall_now,
            "monotonicNs": clock.monotonic_ns(), **payload,
        }
        raw = canonical_json(record) + b"\n"
        try:
            _write_all(self._fd, raw)
        except OSError as error:
            raise HarnessError("không ghi đủ một evidence record") from error
        if event == "run_complete":
            self.complete = True
        return record

    def checkpoint(self) -> None:
        os.fsync(self._fd)

    def close(self) -> None:
        os.fsync(self._fd)
        os.close(self._fd)

    def __enter__(self) -> "EvidenceWriter":
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()


def _sample_endpoints(state: dict[str, Any]) -> dict[str, str]:
    project_id = state["setup"]["projectId"]
    return {
        "runtime": "/api/v1/programming/runtime",
        "monitor": "/api/v1/programming/runtime/monitor",
        "programs": f"/api/v1/programming/projects/{project_id}/programs",
        "signals": "/api/v1/programming/runtime/signals",
        "health": "/api/v1/health",
        "system": "/api/v1/system/status",
    }


def _explicit_iop_gap_ms(system_body: Any) -> float | None:
    """Chỉ nhận field có nghĩa *poll gap* tường minh; không đổi tên latency/age."""
    if not isinstance(system_body, dict):
        return None
    candidates = []
    iop = system_body.get("iop")
    if isinstance(iop, dict):
        candidates.extend(iop.get(key) for key in ("maxPollGapMs", "max_poll_gap_ms"))
    metrics = system_body.get("metrics")
    if isinstance(metrics, dict):
        candidates.extend(metrics.get(key) for key in ("maxIopPollGapMs", "max_iop_poll_gap_ms"))
    for value in candidates:
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            return float(value)
    return None


def _derived_metrics(requests: dict[str, CallResult], state: dict[str, Any]) -> dict[str, Any]:
    runtime = requests["runtime"].body if requests["runtime"].status == 200 else {}
    programs = requests["programs"].body if requests["programs"].status == 200 else {}
    signals = requests["signals"].body if requests["signals"].status == 200 else {}
    task = runtime.get("task") if isinstance(runtime, dict) else None
    program_items = programs.get("items", []) if isinstance(programs, dict) else []
    signal_items = signals.get("items", []) if isinstance(signals, dict) else []
    by_state: dict[str, int] = {}
    for item in program_items if isinstance(program_items, list) else []:
        if isinstance(item, dict):
            key = str(item.get("runtimeState", "MISSING"))
            by_state[key] = by_state.get(key, 0) + 1
    by_freshness: dict[str, int] = {}
    for item in signal_items if isinstance(signal_items, list) else []:
        if isinstance(item, dict):
            key = str(item.get("freshness", "MISSING"))
            by_freshness[key] = by_freshness.get(key, 0) + 1
    return {
        "activeRevisionId": runtime.get("activeRevisionId") if isinstance(runtime, dict) else None,
        "task": task,
        "programCount": len(program_items) if isinstance(program_items, list) else None,
        "programStates": by_state,
        "signalCount": len(signal_items) if isinstance(signal_items, list) else None,
        "signalFreshness": by_freshness,
        "maxIopPollGapMs": _explicit_iop_gap_ms(requests["system"].body),
        "expectedRevisionId": state["setup"]["revisionId"],
    }


def collect_sample(client: APIClient, state: dict[str, Any], parallel: bool = True) -> tuple[dict[str, Any], dict[str, CallResult]]:
    endpoints = _sample_endpoints(state)
    if parallel:
        futures = {label: _SAMPLE_EXECUTOR.submit(client.call, "GET", path, None, None, 20.0, None)
                   for label, path in endpoints.items()}
        results = {label: future.result() for label, future in futures.items()}
    else:
        results = {label: client.call("GET", path, timeout=20.0) for label, path in endpoints.items()}
    return ({label: result.evidence() for label, result in results.items()}, results)


def collect_iop_sample(client: APIClient) -> tuple[dict[str, Any], float | None]:
    """Fast lane chỉ đọc system/IOP; full Programming snapshots đi lane 1 Hz."""
    result = client.call("GET", "/api/v1/system/status", timeout=20.0)
    return result.evidence(), (_explicit_iop_gap_ms(result.body) if result.status == 200 else None)


def _intent_action(client: APIClient, store: StateStore, state: dict[str, Any], clock: Clock,
                   writer: EvidenceWriter, action: str, enabled: bool) -> None:
    actions = state["soak"].setdefault("actions", {})
    action_state = actions.setdefault(action, {})
    if action_state.get("state") == "SUCCEEDED":
        return
    action_state.update({"state": "REQUESTED", "requestedMonotonicNs": clock.monotonic_ns()})
    store.save(state, clock)
    writer.append(action + "_requested", clock, programId=state["producerProgramId"],
                  desiredEnabled=enabled)
    key_name = "signalFaultRecover" if enabled else "signalFaultDisable"
    result = client.call("PUT", f"/api/v1/programming/projects/{state['setup']['projectId']}/programs/{state['producerProgramId']}/runtime-intent",
                         {"schemaVersion": "1.0", "desiredEnabled": enabled},
                         idempotency_key=state["idempotencyKeys"][key_name])
    writer.append(action + "_result", clock, request=result.evidence())
    expect(result, {200}, action)
    action_state.update({"state": "SUCCEEDED", "completedMonotonicNs": clock.monotonic_ns()})
    store.save(state, clock)


def validate_restart_attestation(value: Any) -> dict[str, Any]:
    expected = {"schemaVersion", "service", "before", "after"}
    if not isinstance(value, dict) or set(value) != expected or value.get("schemaVersion") != 1:
        raise HarnessError("restart hook phải stdout đúng một JSON attestation schema 1")
    if not isinstance(value.get("service"), str) or not value["service"].strip():
        raise HarnessError("restart attestation thiếu service")
    before, after = value.get("before"), value.get("after")
    if (not isinstance(before, dict) or set(before) != {"mainPid", "nRestarts"} or
            not isinstance(after, dict) or set(after) != {"mainPid", "nRestarts", "activeState"}):
        raise HarnessError("restart attestation sai field before/after")
    numbers = (before.get("mainPid"), before.get("nRestarts"),
               after.get("mainPid"), after.get("nRestarts"))
    if any(not isinstance(item, int) or isinstance(item, bool) or item < 0 for item in numbers):
        raise HarnessError("restart attestation PID/NRestarts phải là số nguyên không âm")
    if before["mainPid"] <= 0 or after["mainPid"] <= 0 or before["mainPid"] == after["mainPid"]:
        raise HarnessError("restart hook không chứng minh MainPID đã đổi")
    if after["nRestarts"] < before["nRestarts"] or after.get("activeState") != "active":
        raise HarnessError("service sau restart không active hoặc NRestarts đi lùi")
    return value


def execute_restart_hook(path: Path, run_id: str, action_id: str) -> tuple[int, float, dict[str, Any]]:
    try:
        info = path.lstat()
    except OSError as error:
        raise HarnessError(f"không đọc được restart hook: {path}") from error
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or not os.access(path, os.X_OK):
        raise HarnessError("restart hook phải là regular executable, không symlink")
    env = dict(os.environ)
    env.update({"MKDDC_SOAK_RUN_ID": run_id, "MKDDC_SOAK_ACTION_ID": action_id})
    started = time.monotonic_ns()
    try:
        completed = subprocess.run([str(path)], env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   timeout=120, check=False)
    except subprocess.TimeoutExpired as error:
        raise HarnessError("restart hook vượt timeout 120 giây") from error
    latency_ms = (time.monotonic_ns() - started) / 1e6
    if completed.returncode != 0:
        return completed.returncode, latency_ms, {}
    if len(completed.stdout) > 8192:
        raise HarnessError("restart hook stdout vượt 8 KiB")
    try:
        attestation = validate_restart_attestation(json.loads(completed.stdout))
    except json.JSONDecodeError as error:
        raise HarnessError("restart hook stdout không phải JSON") from error
    return completed.returncode, latency_ms, attestation


@dataclasses.dataclass(frozen=True)
class SoakConfig:
    duration_seconds: float = MIN_SOAK_SECONDS
    interval_seconds: float = DEFAULT_INTERVAL_SECONDS
    detail_interval_seconds: float = DEFAULT_DETAIL_INTERVAL_SECONDS
    checkpoint_seconds: float = DEFAULT_CHECKPOINT_SECONDS
    signal_fault_at_seconds: float = DEFAULT_SIGNAL_FAULT_AT_SECONDS
    signal_fault_duration_seconds: float = DEFAULT_SIGNAL_FAULT_DURATION_SECONDS
    restart_at_seconds: float = DEFAULT_RESTART_AT_SECONDS
    restart_hook: Callable[[str, str], tuple[int, float, dict[str, Any]]] | None = None
    accept_ambiguous_restart: bool = False
    parallel_requests: bool = True


def run_soak(client: APIClient, store: StateStore, state: dict[str, Any], evidence_path: Path,
             clock: Clock, config: SoakConfig) -> None:
    if not state.get("setup", {}).get("fixtureReady"):
        raise HarnessError("phải Commission + Enable fixture trước soak")
    if not (0 < config.interval_seconds < MAX_IOP_POLL_GAP_MS / 1000.0):
        raise HarnessError("interval phải >0 và <0.2 giây để không che gap 200 ms")
    if not (config.interval_seconds <= config.detail_interval_seconds <= 5.0):
        raise HarnessError("detail interval phải từ fast interval đến 5 giây")
    if config.duration_seconds <= 0 or config.signal_fault_duration_seconds <= SIGNAL_FRESHNESS_MS / 1000.0:
        raise HarnessError("duration phải dương; signal fault phải dài hơn freshness")
    if config.restart_hook is None:
        raise HarnessError("T59-702 cần --restart-hook có kiểm soát; không bắt đầu lượt 24h thiếu restart")
    current_boot = boot_id()
    soak = state["soak"]
    if soak.get("bootId") and soak["bootId"] != current_boot:
        raise HarnessError("boot_id đổi giữa soak; monotonic continuity mất, evidence không được nối")
    evidence_identity = str(evidence_path.resolve())
    requested_config = {
        "durationSeconds": config.duration_seconds,
        "intervalSeconds": config.interval_seconds,
        "detailIntervalSeconds": config.detail_interval_seconds,
        "checkpointSeconds": config.checkpoint_seconds,
        "signalFaultAtSeconds": config.signal_fault_at_seconds,
        "signalFaultDurationSeconds": config.signal_fault_duration_seconds,
        "restartAtSeconds": config.restart_at_seconds,
    }
    if soak.get("evidencePath") and soak["evidencePath"] != evidence_identity:
        raise HarnessError("không được đổi evidence path khi resume cùng runId")
    if soak.get("config") and soak["config"] != requested_config:
        raise HarnessError("không được đổi duration/interval/fault/restart schedule khi resume")

    with EvidenceWriter(evidence_path, state["runId"]) as writer:
        if writer.complete:
            soak["complete"] = True
            store.save(state, clock)
            return
        if "startMonotonicNs" not in soak:
            soak.update({"startMonotonicNs": clock.monotonic_ns(), "startWallNs": clock.wall_ns(),
                         "bootId": current_boot, "evidencePath": evidence_identity,
                         "config": requested_config})
            store.save(state, clock)
        if not writer.has_start:
            if writer.sequence != 0:
                raise HarnessError("evidence có record nhưng thiếu run_start; không tự vá/xóa")
            writer.append("run_start", clock, bootId=current_boot,
                          startMonotonicNs=soak["startMonotonicNs"],
                          startWallNs=soak["startWallNs"],
                          durationSeconds=config.duration_seconds,
                          intervalSeconds=config.interval_seconds,
                          detailIntervalSeconds=config.detail_interval_seconds,
                          provenance=state["provenance"], artifact=state["setup"]["artifact"],
                          revisionId=state["setup"]["revisionId"],
                          fixture={"programIds": state["programIds"], "periodsMs": state["periodsMs"],
                                   "creationOrderProgramIds": state["creationOrderProgramIds"],
                                   "faultProgramId": state["faultProgramId"],
                                   "producerProgramId": state["producerProgramId"],
                                   "consumerProgramId": state["consumerProgramId"],
                                   "signalIds": state["signalIds"], "signalAdapter": state["signalAdapter"]})
            writer.checkpoint()
            soak["evidenceStarted"] = True
            store.save(state, clock)
        else:
            writer.append("run_resume", clock, bootId=current_boot)

        restart_action = soak.setdefault("actions", {}).setdefault("webRestart", {})
        if restart_action.get("state") == "STARTED":
            if not config.accept_ambiguous_restart:
                raise HarnessError("restart hook trước bị ngắt ở trạng thái STARTED; inspect target rồi dùng --accept-ambiguous-restart")
            restart_action.update({"state": "ACKNOWLEDGED", "acknowledgedMonotonicNs": clock.monotonic_ns()})
            writer.append("web_restart_ambiguous_acknowledged", clock)
            store.save(state, clock)

        start_ns = int(soak["startMonotonicNs"])
        deadline_ns = start_ns + int(config.duration_seconds * 1e9)
        last_checkpoint_ns = clock.monotonic_ns()
        next_detail_ns = clock.monotonic_ns()
        while clock.monotonic_ns() < deadline_ns:
            loop_started_ns = clock.monotonic_ns()
            elapsed = (loop_started_ns - start_ns) / 1e9

            if elapsed >= config.signal_fault_at_seconds:
                _intent_action(client, store, state, clock, writer, "signal_fault_disable", False)
            if elapsed >= config.signal_fault_at_seconds + config.signal_fault_duration_seconds:
                _intent_action(client, store, state, clock, writer, "signal_fault_recover", True)

            if elapsed >= config.restart_at_seconds and restart_action.get("state") not in {"SUCCEEDED", "ACKNOWLEDGED"}:
                action_id = deterministic_uuid4(uuid.UUID(state["runId"]), "web-restart")
                restart_action.update({"state": "STARTED", "actionId": action_id,
                                       "startedMonotonicNs": clock.monotonic_ns()})
                store.save(state, clock)
                writer.append("web_restart_start", clock, actionId=action_id)
                writer.checkpoint()
                code, latency_ms, attestation = config.restart_hook(state["runId"], action_id)
                writer.append("web_restart_result", clock, actionId=action_id,
                              returnCode=code, latencyMs=round(latency_ms, 3),
                              attestation=attestation)
                if code != 0:
                    restart_action.update({"state": "FAILED", "returnCode": code})
                    store.save(state, clock)
                    raise HarnessError(f"restart hook thất bại, exit={code}")
                restart_action.update({"state": "SUCCEEDED", "returnCode": 0,
                                       "completedMonotonicNs": clock.monotonic_ns()})
                store.save(state, clock)

            if clock.monotonic_ns() >= next_detail_ns:
                raw_requests, results = collect_sample(client, state, config.parallel_requests)
                writer.append("sample", clock, elapsedSeconds=round(elapsed, 6),
                              requests=raw_requests, metrics=_derived_metrics(results, state))
                detail_step_ns = int(config.detail_interval_seconds * 1e9)
                while next_detail_ns <= clock.monotonic_ns():
                    next_detail_ns += detail_step_ns
            else:
                iop_request, iop_gap = collect_iop_sample(client)
                writer.append("iop_sample", clock, elapsedSeconds=round(elapsed, 6),
                              request=iop_request, maxIopPollGapMs=iop_gap)

            now_ns = clock.monotonic_ns()
            if now_ns - last_checkpoint_ns >= int(config.checkpoint_seconds * 1e9):
                writer.checkpoint()
                soak.update({"lastSequence": writer.sequence, "lastMonotonicNs": now_ns})
                store.save(state, clock)
                last_checkpoint_ns = now_ns
            next_ns = loop_started_ns + int(config.interval_seconds * 1e9)
            clock.sleep(max(0.0, (next_ns - clock.monotonic_ns()) / 1e9))

        writer.append("run_complete", clock, bootId=current_boot,
                      elapsedSeconds=(clock.monotonic_ns() - start_ns) / 1e9)
        writer.checkpoint()
        soak.update({"complete": True, "completedMonotonicNs": clock.monotonic_ns(),
                     "lastSequence": writer.sequence})
        store.save(state, clock)


def _as_items(request: dict[str, Any], label: str) -> list[dict[str, Any]] | None:
    endpoint = request.get(label)
    if not isinstance(endpoint, dict) or endpoint.get("status") != 200:
        return None
    body = endpoint.get("body")
    items = body.get("items") if isinstance(body, dict) else None
    if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
        return None
    return items


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) - 1) * percentile)))
    return ordered[index]


def verify_evidence(evidence_path: Path, state: dict[str, Any], summary_path: Path,
                    minimum_seconds: float = MIN_SOAK_SECONDS,
                    recovery_seconds: float = DEFAULT_RECOVERY_SECONDS,
                    warmup_seconds: float = 60.0) -> dict[str, Any]:
    """Stream-verify raw JSONL. ``minimum_seconds`` chỉ dành cho unit test."""
    failures = BoundedFailures()
    counts = {"samples": 0, "iopSamples": 0, "requestFailures": 0, "faultSamples": 0,
              "faultTransitions": 0,
              "signalStaleSamples": 0, "signalFreshSamples": 0,
              "consumerWaitingSamples": 0}
    expected_ids = set(state["programIds"])
    expected_period_counts = {period: count for period, count in PERIOD_PLAN}
    fault_id = state["faultProgramId"]
    producer_id = state["producerProgramId"]
    consumer_id = state["consumerProgramId"]
    revision_id = state["setup"]["revisionId"]
    first_mono: int | None = None
    complete_mono: int | None = None
    previous_sequence = 0
    previous_sample_mono: int | None = None
    previous_iop_sample_mono: int | None = None
    max_collector_gap_ms = 0.0
    max_iop_collector_gap_ms = 0.0
    max_iop_gap_ms: float | None = None
    max_request_latency: dict[str, float] = {}
    latencies: dict[str, list[float]] = {}
    initial_task_run: int | None = None
    final_task_run: int | None = None
    previous_task_run: int | None = None
    signal_generations: dict[str, tuple[int, int]] = {}
    fault_seen = False
    signal_fault_active = False
    signal_stale_seen = False
    signal_source_unavailable_seen = False
    signal_consumer_held_seen = False
    signal_recovered_after_fault = False
    consumer_waiting_seen = False
    restart_started_mono: int | None = None
    restart_succeeded_mono: int | None = None
    successful_sample_after_restart = False
    last_sample_mono: int | None = None
    raw_digest = hashlib.sha256()
    run_boot_id: str | None = None
    declared_interval_seconds = DEFAULT_INTERVAL_SECONDS
    previous_event_mono: int | None = None
    first_wall_ns: int | None = None
    last_wall_ns: int | None = None
    signal_recovery_started_mono: int | None = None
    unplanned_request_failure = False
    malformed = False

    try:
        source = evidence_path.open("rb")
    except OSError as error:
        raise HarnessError(f"không đọc được evidence: {evidence_path}") from error
    with source:
        for line_number, raw in enumerate(source, 1):
            raw_digest.update(raw)
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                failures.append(f"JSONL_INVALID_LINE:{line_number}")
                malformed = True
                continue
            if malformed:
                failures.append("JSONL_DATA_AFTER_INVALID_LINE")
                malformed = False
            if event.get("schemaVersion") != SCHEMA_VERSION or event.get("runId") != state["runId"]:
                failures.append(f"IDENTITY_MISMATCH_LINE:{line_number}")
                continue
            sequence = event.get("sequence")
            if not isinstance(sequence, int) or sequence != previous_sequence + 1:
                failures.append(f"SEQUENCE_GAP_LINE:{line_number}")
            if isinstance(sequence, int):
                previous_sequence = sequence
            mono = event.get("monotonicNs")
            if not isinstance(mono, int):
                failures.append(f"MONOTONIC_MISSING_LINE:{line_number}")
                continue
            if previous_event_mono is not None and mono < previous_event_mono:
                failures.append(f"MONOTONIC_WENT_BACKWARD_LINE:{line_number}")
            previous_event_mono = mono
            event_wall_ns = event.get("wallUnixNs")
            if not isinstance(event_wall_ns, int) or not isinstance(event.get("wallTime"), str):
                failures.append(f"WALL_TIMESTAMP_MISSING_LINE:{line_number}")
            else:
                first_wall_ns = event_wall_ns if first_wall_ns is None else first_wall_ns
                last_wall_ns = event_wall_ns
            kind = event.get("event")
            if kind == "run_start":
                if first_mono is not None:
                    failures.append("MULTIPLE_RUN_START")
                declared_start = event.get("startMonotonicNs", mono)
                if not isinstance(declared_start, int) or declared_start > mono:
                    failures.append("RUN_START_MONOTONIC_INVALID")
                    declared_start = mono
                first_mono = declared_start
                run_boot_id = event.get("bootId")
                interval_value = event.get("intervalSeconds")
                if (not isinstance(interval_value, (int, float)) or isinstance(interval_value, bool) or
                        not 0 < float(interval_value) < MAX_IOP_POLL_GAP_MS / 1000.0):
                    failures.append("EVIDENCE_INTERVAL_NOT_SUB_200MS")
                else:
                    declared_interval_seconds = float(interval_value)
                if run_boot_id in {None, "", "UNAVAILABLE"}:
                    failures.append("BOOT_ID_UNAVAILABLE")
                provenance = event.get("provenance", {}).get("document", {})
                if provenance.get("dirty") is not False or not PROVENANCE_COMMIT_RE.fullmatch(str(provenance.get("git_commit", ""))):
                    failures.append("PROVENANCE_NOT_CLEAN_IMMUTABLE")
                if event.get("provenance", {}).get("sha256") != state.get("provenance", {}).get("sha256"):
                    failures.append("PROVENANCE_STATE_EVIDENCE_MISMATCH")
                artifact = event.get("artifact", {})
                if not re.fullmatch(r"[0-9a-f]{64}", str(artifact.get("sha256", ""))):
                    failures.append("ARTIFACT_SHA256_MISSING")
                if artifact.get("sha256") != state.get("setup", {}).get("artifact", {}).get("sha256"):
                    failures.append("ARTIFACT_STATE_EVIDENCE_MISMATCH")
                fixture = event.get("fixture", {})
                if (fixture.get("programIds") != state["programIds"] or
                        fixture.get("creationOrderProgramIds") != state["creationOrderProgramIds"] or
                        fixture.get("periodsMs") != state["periodsMs"] or
                        fixture.get("signalIds") != state["signalIds"] or
                        fixture.get("signalAdapter") != state["signalAdapter"]):
                    failures.append("FIXTURE_STATE_EVIDENCE_MISMATCH")
            elif kind == "run_resume" and event.get("bootId") != run_boot_id:
                failures.append("BOOT_ID_CHANGED")
            elif kind == "signal_fault_disable_result":
                signal_fault_active = event.get("request", {}).get("status") == 200
            elif kind == "signal_fault_recover_result":
                if event.get("request", {}).get("status") == 200:
                    signal_fault_active = False
                    signal_recovery_started_mono = mono
            elif kind == "web_restart_start":
                restart_started_mono = mono
                previous_iop_sample_mono = None
            elif kind == "web_restart_result":
                if event.get("returnCode") == 0:
                    try:
                        validate_restart_attestation(event.get("attestation"))
                    except HarnessError:
                        failures.append("WEB_RESTART_ATTESTATION_INVALID")
                    else:
                        restart_succeeded_mono = mono
                else:
                    failures.append("WEB_RESTART_HOOK_FAILED")
            elif kind == "web_restart_ambiguous_acknowledged":
                failures.append("WEB_RESTART_AMBIGUOUS")
            elif kind == "run_complete":
                complete_mono = mono
            elif kind == "iop_sample":
                counts["iopSamples"] += 1
                if previous_iop_sample_mono is not None:
                    max_iop_collector_gap_ms = max(max_iop_collector_gap_ms,
                                                   (mono - previous_iop_sample_mono) / 1e6)
                previous_iop_sample_mono = mono
                request = event.get("request")
                if not isinstance(request, dict):
                    failures.append(f"IOP_REQUEST_MISSING:{line_number}")
                    continue
                latency = request.get("latencyMs")
                if isinstance(latency, (int, float)) and latency >= 0:
                    latencies.setdefault("system", []).append(float(latency))
                    max_request_latency["system"] = max(max_request_latency.get("system", 0.0),
                                                        float(latency))
                else:
                    failures.append(f"REQUEST_LATENCY_MISSING:system:{line_number}")
                if request.get("status") != 200:
                    counts["requestFailures"] += 1
                    within_restart_recovery = (restart_started_mono is not None and
                                               (restart_succeeded_mono is None or
                                                mono <= restart_succeeded_mono + int(recovery_seconds * 1e9)))
                    if not within_restart_recovery:
                        unplanned_request_failure = True
                        failures.append(f"UNPLANNED_REQUEST_FAILURE:system:{line_number}")
                else:
                    iop_elapsed = (mono - first_mono) / 1e9 if first_mono is not None else 0.0
                    restart_grace = (restart_succeeded_mono is not None and
                                     mono <= restart_succeeded_mono + int(recovery_seconds * 1e9))
                    body = request.get("body", {})
                    iop = body.get("iop", {}) if isinstance(body, dict) else {}
                    if iop_elapsed >= warmup_seconds and not restart_grace and (
                            body.get("overall") != "ok" or iop.get("status") != "normal"):
                        failures.append(f"SYSTEM_OR_IOP_NOT_OK:{line_number}")
                gap = event.get("maxIopPollGapMs")
                if isinstance(gap, (int, float)):
                    max_iop_gap_ms = max(float(gap), max_iop_gap_ms or 0.0)
                    if float(gap) >= MAX_IOP_POLL_GAP_MS:
                        failures.append(f"IOP_POLL_GAP_GE_200MS:{line_number}")
                continue
            elif kind != "sample":
                continue

            if kind != "sample":
                continue
            counts["samples"] += 1
            last_sample_mono = mono
            if previous_sample_mono is not None:
                max_collector_gap_ms = max(max_collector_gap_ms, (mono - previous_sample_mono) / 1e6)
            previous_sample_mono = mono
            if previous_iop_sample_mono is not None:
                max_iop_collector_gap_ms = max(max_iop_collector_gap_ms,
                                               (mono - previous_iop_sample_mono) / 1e6)
            previous_iop_sample_mono = mono
            requests = event.get("requests")
            if not isinstance(requests, dict):
                failures.append(f"REQUESTS_MISSING_LINE:{line_number}")
                continue
            all_success = True
            for label in _sample_endpoints(state):
                request = requests.get(label)
                if not isinstance(request, dict):
                    failures.append(f"REQUEST_MISSING:{label}:{line_number}")
                    all_success = False
                    continue
                status = request.get("status")
                latency = request.get("latencyMs")
                if status != 200:
                    counts["requestFailures"] += 1
                    all_success = False
                    within_restart_recovery = (restart_started_mono is not None and
                                               (restart_succeeded_mono is None or
                                                mono <= restart_succeeded_mono + int(recovery_seconds * 1e9)))
                    if not within_restart_recovery:
                        unplanned_request_failure = True
                        failures.append(f"UNPLANNED_REQUEST_FAILURE:{label}:{line_number}")
                if isinstance(latency, (int, float)) and latency >= 0:
                    latencies.setdefault(label, []).append(float(latency))
                    max_request_latency[label] = max(max_request_latency.get(label, 0.0), float(latency))
                else:
                    failures.append(f"REQUEST_LATENCY_MISSING:{label}:{line_number}")
            if restart_succeeded_mono is not None and mono > restart_succeeded_mono and all_success:
                successful_sample_after_restart = True
            runtime_request = requests.get("runtime", {})
            runtime_body = runtime_request.get("body", {}) if runtime_request.get("status") == 200 else {}
            sample_elapsed = (mono - first_mono) / 1e9 if first_mono is not None else 0.0
            if isinstance(runtime_body, dict) and sample_elapsed >= warmup_seconds:
                if runtime_body.get("activeRevisionId") != revision_id:
                    failures.append(f"ACTIVE_REVISION_MISMATCH:{line_number}")
                if runtime_body.get("producerState") != "READY":
                    failures.append(f"RUNTIME_PRODUCER_NOT_READY:{line_number}")
            task = runtime_body.get("task") if isinstance(runtime_body, dict) else None
            if isinstance(task, dict):
                run_count = task.get("runCount")
                if isinstance(run_count, int):
                    initial_task_run = run_count if initial_task_run is None else initial_task_run
                    if previous_task_run is not None and run_count < previous_task_run:
                        failures.append(f"CORE_TASK_RUN_COUNT_RESET:{line_number}")
                    previous_task_run = run_count
                    final_task_run = run_count
                if int(task.get("consecutiveOverruns", 0)) >= 3:
                    failures.append(f"TASK_3_CONSECUTIVE_OVERRUN:{line_number}")

            metrics = event.get("metrics", {})
            gap = metrics.get("maxIopPollGapMs") if isinstance(metrics, dict) else None
            if isinstance(gap, (int, float)):
                max_iop_gap_ms = max(float(gap), max_iop_gap_ms or 0.0)
                if float(gap) >= MAX_IOP_POLL_GAP_MS:
                    failures.append(f"IOP_POLL_GAP_GE_200MS:{line_number}")

            restart_grace = (restart_succeeded_mono is not None and
                             mono <= restart_succeeded_mono + int(recovery_seconds * 1e9))
            if sample_elapsed >= warmup_seconds and not restart_grace:
                health_body = requests.get("health", {}).get("body", {})
                if not isinstance(health_body, dict) or health_body.get("status") != "ok":
                    failures.append(f"HEALTH_NOT_OK:{line_number}")
                system_body = requests.get("system", {}).get("body", {})
                system_iop = system_body.get("iop", {}) if isinstance(system_body, dict) else {}
                if system_body.get("overall") != "ok" or system_iop.get("status") != "normal":
                    failures.append(f"SYSTEM_OR_IOP_NOT_OK:{line_number}")

            elapsed = sample_elapsed
            program_items = _as_items(requests, "programs")
            programs_by_id: dict[str, dict[str, Any]] = {}
            if program_items is not None and elapsed >= warmup_seconds:
                programs_body = requests["programs"].get("body", {})
                if programs_body.get("runtimeStateSource") != "CORE_LIVE":
                    failures.append(f"PROGRAM_SOURCE_NOT_CORE_LIVE:{line_number}")
                if programs_body.get("programsTruncated") is not False:
                    failures.append(f"PROGRAMS_TRUNCATED_OR_UNKNOWN:{line_number}")
                ids = {item.get("programId") for item in program_items}
                if ids != expected_ids:
                    failures.append(f"PROGRAM_SET_MISMATCH:{line_number}")
                period_counts: dict[int, int] = {}
                for item in program_items:
                    period = item.get("periodMs")
                    if isinstance(period, int):
                        period_counts[period] = period_counts.get(period, 0) + 1
                    if int(item.get("consecutiveMissedRelease") or 0) >= 3:
                        failures.append(f"PROGRAM_3_CONSECUTIVE_MISS:{item.get('programId')}:{line_number}")
                    max_exec = item.get("maxExecNs")
                    if isinstance(period, int) and period > 0 and isinstance(max_exec, int) and max_exec > period * 1_000_000 * 0.8:
                        failures.append(f"PROGRAM_WCET_OVER_80_PERCENT:{item.get('programId')}:{line_number}")
                if period_counts != expected_period_counts:
                    failures.append(f"PROGRAM_PERIOD_DISTRIBUTION:{line_number}")
                programs_by_id = {item.get("programId"): item for item in program_items}
                fault = programs_by_id.get(fault_id, {})
                if fault.get("runtimeState") == "FAULTED":
                    if not fault_seen:
                        counts["faultTransitions"] += 1
                    fault_seen = True
                    counts["faultSamples"] += 1
                elif fault_seen:
                    failures.append(f"FAULT_PROGRAM_LEFT_FAULTED_STATE:{line_number}")
                signal_transition_allowed = (signal_fault_active or
                                             (signal_recovery_started_mono is not None and
                                              mono <= signal_recovery_started_mono + int(recovery_seconds * 1e9)))
                for program_id, item in programs_by_id.items():
                    if program_id == fault_id:
                        continue
                    allowed = {"RUNNING"}
                    if signal_transition_allowed and program_id in {producer_id, consumer_id}:
                        allowed.update({"DISABLED", "WAITING"})
                    if item.get("runtimeState") not in allowed:
                        failures.append(f"INDEPENDENT_PROGRAM_NOT_RUNNING:{program_id}:{line_number}")

            signal_items = _as_items(requests, "signals")
            if signal_items is not None and elapsed >= warmup_seconds:
                signals_body = requests["signals"].get("body", {})
                if signals_body.get("producerState") != "READY":
                    failures.append(f"SIGNAL_PRODUCER_NOT_READY:{line_number}")
                by_name = {item.get("name"): item for item in signal_items}
                if set(by_name) != {"SOAK_SOURCE", "SOAK_CONSUMED"}:
                    failures.append(f"SIGNAL_SET_MISMATCH:{line_number}")
                all_fresh = True
                for name, item in by_name.items():
                    expected_publisher = producer_id if name == "SOAK_SOURCE" else consumer_id
                    expected_policy = "WAIT" if name == "SOAK_SOURCE" else "HOLD_LAST"
                    if (item.get("signalId") != state["signalIds"].get(name) or
                            item.get("producerProgramId") != expected_publisher or
                            item.get("dataType") != "REAL" or
                            item.get("stalePolicy") != expected_policy or
                            item.get("freshnessMs") != SIGNAL_FRESHNESS_MS):
                        failures.append(f"SIGNAL_RUNTIME_IDENTITY_MISMATCH:{name}:{line_number}")
                    if item.get("definitionState") != "MATCHED":
                        failures.append(f"SIGNAL_DEFINITION_NOT_MATCHED:{name}:{line_number}")
                    generation_raw = item.get("generation")
                    try:
                        generation = int(generation_raw)
                    except (TypeError, ValueError):
                        generation = -1
                    first, previous_generation = signal_generations.get(name, (generation, generation))
                    if generation < previous_generation:
                        failures.append(f"SIGNAL_GENERATION_WENT_BACKWARD:{name}:{line_number}")
                    signal_generations[name] = (first, generation)
                    freshness = item.get("freshness")
                    valid = item.get("valid")
                    quality = item.get("quality")
                    value = item.get("value")
                    if freshness not in SIGNAL_FRESHNESS_STATES:
                        failures.append(f"SIGNAL_FRESHNESS_INVALID:{name}:{line_number}")
                    elif freshness == "NOT_DECLARED":
                        failures.append(f"SIGNAL_NOT_DECLARED:{name}:{line_number}")
                    if freshness == "FRESH":
                        expected_valid, expected_quality = True, "GOOD"
                    elif freshness in {"STALE_HELD", "STALE_FALLBACK"}:
                        expected_valid, expected_quality = True, "UNCERTAIN"
                    else:
                        expected_valid, expected_quality = False, "BAD"
                    if (valid is not expected_valid or quality != expected_quality or
                            (expected_valid and value is None) or
                            (not expected_valid and value is not None)):
                        failures.append(f"SIGNAL_VALUE_QUALITY_INCONSISTENT:{name}:{line_number}")

                    fresh = freshness == "FRESH" and valid is True
                    all_fresh = all_fresh and fresh
                    if signal_fault_active and freshness in {
                            "STALE_HELD", "STALE_FALLBACK", "UNAVAILABLE"}:
                        signal_stale_seen = True
                        counts["signalStaleSamples"] += 1
                    if signal_fault_active and name == "SOAK_SOURCE" and freshness == "UNAVAILABLE":
                        signal_source_unavailable_seen = True
                        consumer = programs_by_id.get(consumer_id, {})
                        if consumer.get("runtimeState") == "WAITING":
                            consumer_waiting_seen = True
                            counts["consumerWaitingSamples"] += 1
                    if signal_fault_active and name == "SOAK_CONSUMED" and freshness == "STALE_HELD":
                        signal_consumer_held_seen = True
                    transition_allowed = (signal_fault_active or
                                          (signal_recovery_started_mono is not None and
                                           mono <= signal_recovery_started_mono + int(recovery_seconds * 1e9)))
                    if not fresh and not transition_allowed:
                        failures.append(f"SIGNAL_NOT_FRESH:{name}:{line_number}")
                if all_fresh:
                    counts["signalFreshSamples"] += 1
                    if signal_stale_seen and not signal_fault_active:
                        signal_recovered_after_fault = True

    if first_mono is None:
        failures.append("RUN_START_MISSING")
    if complete_mono is None:
        failures.append("RUN_COMPLETE_MISSING")
    elapsed_seconds = ((complete_mono - first_mono) / 1e9
                       if complete_mono is not None and first_mono is not None else 0.0)
    if elapsed_seconds < minimum_seconds:
        failures.append(f"ELAPSED_LT_REQUIRED:{elapsed_seconds:.3f}<{minimum_seconds:.3f}")
    if counts["samples"] < 2:
        failures.append("TOO_FEW_SAMPLES")
    expected_iop_measurements = int(elapsed_seconds / declared_interval_seconds) if declared_interval_seconds > 0 else 0
    actual_iop_measurements = counts["samples"] + counts["iopSamples"]
    if expected_iop_measurements > 0 and actual_iop_measurements < expected_iop_measurements * 0.95:
        failures.append(f"IOP_SAMPLE_COVERAGE_LT_95_PERCENT:{actual_iop_measurements}/{expected_iop_measurements}")
    if max_iop_gap_ms is None:
        failures.append("IOP_POLL_GAP_METRIC_MISSING")
    if not fault_seen:
        failures.append("DELIBERATE_FAULT_NOT_OBSERVED")
    if not signal_stale_seen:
        failures.append("SIGNAL_STALE_NOT_OBSERVED")
    if not signal_source_unavailable_seen:
        failures.append("SIGNAL_WAIT_UNAVAILABLE_NOT_OBSERVED")
    if not signal_consumer_held_seen:
        failures.append("SIGNAL_HOLD_LAST_NOT_OBSERVED")
    if not consumer_waiting_seen:
        failures.append("BLOCK_PROGRAM_CONSUMER_WAITING_NOT_OBSERVED")
    if not signal_recovered_after_fault:
        failures.append("SIGNAL_RECOVERY_NOT_OBSERVED")
    for name, (first, last) in signal_generations.items():
        if first < 0 or last <= first:
            failures.append(f"SIGNAL_GENERATION_NOT_ADVANCED:{name}")
    if restart_started_mono is None or restart_succeeded_mono is None:
        failures.append("WEB_RESTART_NOT_PROVEN")
    elif not successful_sample_after_restart:
        failures.append("WEB_NOT_RECOVERED_AFTER_RESTART")
    elif last_sample_mono is not None and (last_sample_mono - restart_succeeded_mono) / 1e9 < min(recovery_seconds, minimum_seconds / 10):
        failures.append("POST_RESTART_OBSERVATION_TOO_SHORT")
    if initial_task_run is None or final_task_run is None or final_task_run <= initial_task_run:
        failures.append("TASK_RUN_COUNT_NOT_ADVANCED")

    summary = {
        "schemaVersion": SCHEMA_VERSION,
        "runId": state["runId"],
        "verdict": "PASS" if not failures else "FAIL",
        "requiredElapsedSeconds": minimum_seconds,
        "elapsedSeconds": round(elapsed_seconds, 6),
        "maxIopPollGapMs": max_iop_gap_ms,
        "maxCollectorSampleGapMs": round(max_collector_gap_ms, 3),
        "maxIopCollectorGapMs": round(max_iop_collector_gap_ms, 3),
        "iopSampleCoverage": {"actual": actual_iop_measurements,
                              "expectedFromInterval": expected_iop_measurements},
        "wallClock": {"startUnixNs": first_wall_ns, "endUnixNs": last_wall_ns,
                      "deltaSeconds": ((last_wall_ns - first_wall_ns) / 1e9
                                       if first_wall_ns is not None and last_wall_ns is not None else None)},
        "requestLatencyMs": {label: {"max": round(max_request_latency.get(label, 0.0), 3),
                                      "p95": _percentile(values, 0.95)}
                             for label, values in sorted(latencies.items())},
        "counts": counts,
        "unplannedRequestFailure": unplanned_request_failure,
        "faultProgramId": fault_id,
        "signalGenerations": {name: {"first": first, "last": last}
                              for name, (first, last) in sorted(signal_generations.items())},
        "provenance": state["provenance"],
        "artifact": state["setup"].get("artifact"),
        "revisionId": revision_id,
        "rawEvidence": {"path": str(evidence_path), "sha256": raw_digest.hexdigest(),
                        "bytes": evidence_path.stat().st_size},
        "failures": sorted(set(failures)),
    }
    atomic_write_json(summary_path, summary)
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8082")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password-env", default="MKDDC_SOAK_PASSWORD")
    parser.add_argument("--password-file", type=Path)
    parser.add_argument("--state", type=Path, default=Path("build/soak/state.json"))
    parser.add_argument("--evidence", type=Path, default=Path("build/soak/samples.jsonl"))
    parser.add_argument("--summary", type=Path, default=Path("build/soak/summary.json"))
    parser.add_argument("--provenance-file", type=Path,
                        default=Path("/usr/share/mkddc/provenance.json"))
    parser.add_argument("--insecure-tls", action="store_true",
                        help="chỉ dùng mạng lab tin cậy; vẫn không log credential")
    subparsers = parser.add_subparsers(dest="command", required=True)
    setup_parser = subparsers.add_parser("setup")
    setup_parser.add_argument("--name")
    setup_parser.add_argument("--signal-adapter", type=Path, required=True)
    commission_parser = subparsers.add_parser("commission")
    commission_parser.add_argument("--allow-replace-active", action="store_true")
    soak_parser = subparsers.add_parser("soak")
    soak_parser.add_argument("--duration-hours", type=float, default=24.0,
                             help="có thể chạy ngắn để debug nhưng verify luôn đòi đủ 24 h")
    soak_parser.add_argument("--interval", type=float, default=DEFAULT_INTERVAL_SECONDS)
    soak_parser.add_argument("--detail-interval", type=float, default=DEFAULT_DETAIL_INTERVAL_SECONDS)
    soak_parser.add_argument("--checkpoint-seconds", type=float, default=DEFAULT_CHECKPOINT_SECONDS)
    soak_parser.add_argument("--signal-fault-at-seconds", type=float,
                             default=DEFAULT_SIGNAL_FAULT_AT_SECONDS)
    soak_parser.add_argument("--signal-fault-duration-seconds", type=float,
                             default=DEFAULT_SIGNAL_FAULT_DURATION_SECONDS)
    soak_parser.add_argument("--restart-at-seconds", type=float, default=DEFAULT_RESTART_AT_SECONDS)
    soak_parser.add_argument("--restart-hook", type=Path, required=True)
    soak_parser.add_argument("--accept-ambiguous-restart", action="store_true")
    subparsers.add_parser("verify")
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    clock = SystemClock()
    store = StateStore(arguments.state)
    try:
        with store.locked():
            if arguments.command == "verify":
                state = store.load()
                if state is None:
                    raise HarnessError(f"state chưa tồn tại: {arguments.state}")
                summary = verify_evidence(arguments.evidence, state, arguments.summary)
                print(json.dumps({"verdict": summary["verdict"],
                                  "elapsedSeconds": summary["elapsedSeconds"],
                                  "rawSha256": summary["rawEvidence"]["sha256"],
                                  "failures": summary["failures"]}, ensure_ascii=False, indent=2))
                return 0 if summary["verdict"] == "PASS" else 2

            state = store.load()
            adapter: SignalSyntaxAdapter | None = None
            created_state = False
            if arguments.command == "setup":
                adapter = SignalSyntaxAdapter.load(arguments.signal_adapter)
                provenance = load_provenance(arguments.provenance_file)
                if state is None:
                    name = arguments.name or f"SOAK-10P-{time.strftime('%Y%m%d-%H%M%S')}"
                    state = new_state(name, adapter, provenance, clock, boot_id())
                    created_state = True
                elif state.get("signalAdapter", {}).get("sha256") != adapter.sha256:
                    raise HarnessError("state đã khóa signal adapter khác; không đổi fixture giữa chừng")
                elif state.get("provenance", {}).get("sha256") != provenance["sha256"]:
                    raise HarnessError("provenance target đổi giữa setup; tạo state/evidence mới sau khi đối soát")
            elif state is None:
                raise HarnessError(f"state chưa tồn tại: {arguments.state}")

            # Mọi fixture/adapter/provenance validation ở trên chạy trước login,
            # nên input contract sai không tạo dù chỉ một network request.
            password = load_secret(arguments.password_env, arguments.password_file)
            if created_state:
                store.save(state, clock)
            client = HTTPClient(arguments.base, arguments.user, password, clock, arguments.insecure_tls)
            client.login()
            if arguments.command == "setup":
                assert adapter is not None
                setup_fixture(client, store, state, adapter, clock)
                print(json.dumps({"runId": state["runId"], "projectId": state["setup"]["projectId"],
                                  "revisionId": state["setup"]["revisionId"],
                                  "checkId": state["setup"]["checkId"],
                                  "artifactSha256": state["setup"]["artifact"]["sha256"]}, indent=2))
                return 0
            if arguments.command == "commission":
                commission_and_enable(client, store, state, clock, arguments.allow_replace_active)
                print(json.dumps({"revisionId": state["setup"]["revisionId"],
                                  "commissionState": state["setup"]["commissionState"],
                                  "enabledPrograms": len(state["setup"]["enabledProgramIds"])}, indent=2))
                return 0
            hook_path = arguments.restart_hook
            config = SoakConfig(
                duration_seconds=arguments.duration_hours * 3600,
                interval_seconds=arguments.interval,
                detail_interval_seconds=arguments.detail_interval,
                checkpoint_seconds=arguments.checkpoint_seconds,
                signal_fault_at_seconds=arguments.signal_fault_at_seconds,
                signal_fault_duration_seconds=arguments.signal_fault_duration_seconds,
                restart_at_seconds=arguments.restart_at_seconds,
                restart_hook=lambda run_id, action_id: execute_restart_hook(hook_path, run_id, action_id),
                accept_ambiguous_restart=arguments.accept_ambiguous_restart,
            )
            run_soak(client, store, state, arguments.evidence, clock, config)
            print(json.dumps({"runId": state["runId"], "complete": state["soak"].get("complete", False),
                              "evidence": str(arguments.evidence)}, indent=2))
            return 0
    except HarnessError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
