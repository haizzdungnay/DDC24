#!/usr/bin/env python3
"""T63-301 — tái hiện cấu hình Programming tối đa ở chu kỳ 10 ms (F-PRG-PERF-001).

Authority: docs/03_implementation/63_FORLINX_PERFORMANCE_REMEDIATION_PLAN.md §4.4.

Kịch bản: một Project thử riêng có ``--programs`` Program ST (mặc định 16 — trần
``maxProgramsEnabled``), mỗi Program gần trần ``maxInstructions`` (4.096) bằng
chuỗi lệnh thẳng, chu kỳ 10 ms. Script đo:

1. Check chấp nhận hay không, và ``budgetUs`` từng Program trong manifest package;
2. sau Commission + Enable: thời gian thực thi Task (``lastExecNs``/``maxExecNs``)
   so với ngân sách base step 2.000 µs, overrun và thời điểm Task chuyển ``FAULT``;
3. **khôi phục Active**: đọc ``activeRevisionId`` ngay trước khi thử, Restore đúng
   bản đó sau khi thử (không ghim cứng revision ID), rồi đọc lại để xác nhận.

Hai chế độ:

``host``   tự dựng stack host: ``mkddc-programming-core-sim`` (scheduler/coordinator
           production, không I/O vật lý) + backend Go production, trong thư mục tạm.
           Mức bằng chứng: HOST (x86, không phải Cortex-A53).
``remote`` chạy trên một backend có sẵn (bo lab). Mức bằng chứng: TARGET. Mật khẩu
           qua biến môi trường ``MKDDC_PROBE_PASSWORD``; không ghi vào output.

Program thử KHÔNG có Binding nên không ghi output nào; Commission vẫn thay gói
đang chạy trong suốt lượt thử — vì vậy bước khôi phục chạy trong ``finally``.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Dict, List, Optional, Tuple

STEP_BUDGET_US = 2000  # 20% × base step 10 ms (ADR-061 §4.3)


def utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def program_source(name: str, statements: int) -> str:
    """ST chuỗi lệnh thẳng: số lệnh thực thi = số lệnh tĩnh (không vòng lặp)."""
    lines = [f"PROGRAM {name}", "VAR", "  Acc : DINT;", "END_VAR"]
    lines += ["Acc := Acc + 1;"] * statements
    lines.append("END_PROGRAM")
    return "\n".join(lines) + "\n"


class Api:
    def __init__(self, base_url: str, log: List[Dict[str, Any]]):
        self.base = base_url.rstrip("/")
        self.token: Optional[str] = None
        self.log = log

    def call(self, method: str, path: str, body: Any = None, headers: Optional[Dict[str, str]] = None,
             expect: Tuple[int, ...] = (200,), timeout: float = 30.0) -> Tuple[int, Dict[str, str], Any]:
        data = json.dumps(body).encode() if body is not None else None
        hdrs = {"x-correlation-id": str(uuid.uuid4())}
        if self.token:
            hdrs["authorization"] = f"Bearer {self.token}"
        if data is not None:
            hdrs["content-type"] = "application/json"
            hdrs["x-idempotency-key"] = str(uuid.uuid4())
        hdrs.update(headers or {})
        req = urllib.request.Request(self.base + path, data=data, headers=hdrs, method=method)
        started = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status, raw, rh = resp.status, resp.read(), dict(resp.headers)
        except urllib.error.HTTPError as err:
            status, raw, rh = err.code, err.read(), dict(err.headers)
        self.log.append({"at": utc_now(), "method": method, "path": path, "status": status,
                         "ms": round((time.monotonic() - started) * 1000, 1)})
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = raw.decode(errors="replace")
        if status not in expect:
            raise RuntimeError(f"{method} {path} → {status}: {str(payload)[:600]}")
        return status, rh, payload

    def login(self, username: str, password: str) -> None:
        _, _, body = self.call("POST", "/api/v1/auth/login", {"username": username, "password": password})
        self.token = body["token"]

    def wait(self, path: str, done: Tuple[str, ...], failed: Tuple[str, ...], timeout_s: float) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout_s
        body: Dict[str, Any] = {}
        while time.monotonic() < deadline:
            _, _, body = self.call("GET", path)
            state = str(body.get("state"))
            if state in done:
                return body
            if state in failed:
                return body
            time.sleep(0.1)
        raise RuntimeError(f"{path} không kết thúc trong {timeout_s} s: {str(body)[:600]}")


def build_project(api: Api, programs: int, statements: int, period_ms: int, label: str) -> Dict[str, Any]:
    _, _, created = api.call("POST", "/api/v1/programming/projects",
                             {"schemaVersion": "1.0", "name": label,
                              "description": "T63-301 tái hiện cấu hình tối đa (F-PRG-PERF-001); không Binding"},
                             expect=(201,))
    resource = created["resource"]
    project_id, draft_id, etag = resource["projectId"], resource["draftRevisionId"], created["etag"]
    ops: List[Dict[str, Any]] = []
    ids: List[str] = []
    for index in range(programs):
        pid = str(uuid.uuid4())  # backend chỉ nhận UUID v4 (projects.go isUUID)
        ids.append(pid)
        name = f"T63_MAX_{index:02d}"
        ops.append({"op": "upsertProgram", "program": {"programId": pid, "name": name, "kind": "PROGRAM",
                                                        "language": "ST",
                                                        "document": program_source(name, statements)}})
        ops.append({"op": "upsertProgram", "program": {"programId": pid, "objectId": pid, "periodMs": period_ms}})
    _, rh, saved = api.call("PATCH", f"/api/v1/programming/projects/{project_id}/draft",
                            {"schemaVersion": "1.0", "baseRevisionId": draft_id, "operations": ops},
                            headers={"if-match": etag})
    return {"projectId": project_id, "draftRevisionId": draft_id, "etag": saved.get("etag") or rh.get("ETag"),
            "programIds": ids}


def seal_and_check(api: Api, project: Dict[str, Any]) -> Dict[str, Any]:
    _, _, sealed = api.call("POST", f"/api/v1/programming/projects/{project['projectId']}/draft/revisions",
                            {"schemaVersion": "1.0", "baseRevisionId": project["draftRevisionId"],
                             "label": "T63-301", "comment": "T63-301 cấu hình tối đa"},
                            headers={"if-match": project["etag"]}, expect=(201,))
    revision_id = sealed["resource"]["revisionId"]
    started = time.monotonic()
    _, _, accepted = api.call("POST", f"/api/v1/programming/revisions/{revision_id}/checks",
                              {"schemaVersion": "1.0", "targetProfile": "MK-DDC-24-REV-A"}, expect=(202,))
    check = api.wait(f"/api/v1/programming/checks/{accepted['checkId']}", ("PASSED",), ("FAILED", "TIMED_OUT"),
                     timeout_s=600)
    return {"revisionId": revision_id, "checkId": accepted["checkId"], "check": check,
            "checkWallMs": round((time.monotonic() - started) * 1000, 1)}


def commission(api: Api, from_revision: Optional[str], revision_id: str, check_id: str) -> Dict[str, Any]:
    # Route HTTP `changes` từ chối hai Revision khác Project (400); đường
    # Commission nội bộ hạ ca đó về `none` (changes.go GetRevisionChanges), nên
    # impact tính từ `none` là đúng impact mà operation sẽ so.
    status, _, changes = api.call("GET", f"/api/v1/programming/revisions/{from_revision or 'none'}/changes/{revision_id}",
                                  expect=(200, 400))
    if status == 400 and from_revision:
        _, _, changes = api.call("GET", f"/api/v1/programming/revisions/none/changes/{revision_id}")
    impact = changes["impact"]
    acks = [key for key, group in impact.items()
            if isinstance(group, dict) and group.get("status") == "PRESENT"]
    _, _, accepted = api.call("POST", "/api/v1/programming/operations/commission",
                              {"schemaVersion": "1.0", "revisionId": revision_id,
                               "expectedActiveRevisionId": from_revision, "checkId": check_id,
                               "impactRef": impact["impactRef"], "acknowledgements": acks,
                               "cutover": {"requested": "PROGRAM_ONLY"}}, expect=(202,))
    return api.wait(f"/api/v1/programming/operations/{accepted['operationId']}", ("SUCCEEDED",),
                    ("FAILED", "ROLLED_BACK"), timeout_s=120)


def restore(api: Api, revision_id: str, expected_active: str) -> Dict[str, Any]:
    _, _, accepted = api.call("POST", "/api/v1/programming/operations/restore",
                              {"schemaVersion": "1.0", "revisionId": revision_id,
                               "expectedActiveRevisionId": expected_active,
                               "reason": "T63-301: khôi phục Active đã đọc trước khi thử"}, expect=(202,))
    return api.wait(f"/api/v1/programming/operations/{accepted['operationId']}", ("SUCCEEDED",),
                    ("FAILED", "ROLLED_BACK"), timeout_s=120)


def set_intent(api: Api, project_id: str, program_id: str, enabled: bool) -> None:
    api.call("PUT", f"/api/v1/programming/projects/{project_id}/programs/{program_id}/runtime-intent",
             {"schemaVersion": "1.0", "desiredEnabled": enabled})


def summarize_manifest(check: Dict[str, Any]) -> Dict[str, Any]:
    manifest = check.get("manifest") or (check.get("artifact") or {}).get("manifest") or {}
    if isinstance(manifest, str):
        try:
            manifest = json.loads(manifest)
        except ValueError:
            manifest = {}
    topology = manifest.get("topology") or []
    return {
        "budget": manifest.get("budget"),
        "budgetUsPerProgram": sorted({t.get("budgetUs") for t in topology if isinstance(t, dict)}),
        "periodsMs": sorted({t.get("periodMs") for t in topology if isinstance(t, dict)}),
        "programCount": manifest.get("programCount"),
    }


def observe(api: Api, seconds: float) -> Dict[str, Any]:
    samples = []
    first_fault_s = None
    start = time.monotonic()
    while time.monotonic() - start < seconds:
        _, _, rt = api.call("GET", "/api/v1/programming/runtime")
        task = rt.get("task") or {}
        elapsed = round(time.monotonic() - start, 2)
        samples.append({"t_s": elapsed, "taskState": rt.get("taskState"), "state": task.get("state"),
                        "lastExecNs": task.get("lastExecNs"), "maxExecNs": task.get("maxExecNs"),
                        "overrunCount": task.get("overrunCount"),
                        "consecutiveOverruns": task.get("consecutiveOverruns"),
                        "runCount": task.get("runCount"), "budgetUs": task.get("budgetUs"),
                        "missedBaseStepCount": task.get("missedBaseStepCount")})
        if first_fault_s is None and (task.get("state") == "FAULT" or rt.get("taskState") == "FAULT"):
            first_fault_s = elapsed
        time.sleep(0.5)
    last_exec = [s["lastExecNs"] for s in samples if isinstance(s["lastExecNs"], int)]
    max_exec = max((s["maxExecNs"] for s in samples if isinstance(s["maxExecNs"], int)), default=None)
    return {
        "seconds": seconds,
        "samples": samples,
        "firstFaultAfterEnableS": first_fault_s,
        "lastExecUsMedian": (sorted(last_exec)[len(last_exec) // 2] / 1000.0) if last_exec else None,
        "maxExecUs": (max_exec / 1000.0) if max_exec is not None else None,
        "stepBudgetUs": STEP_BUDGET_US,
        "overrunCountEnd": samples[-1]["overrunCount"] if samples else None,
        "stateEnd": samples[-1]["state"] if samples else None,
    }


def read_manifest_from_db(db_path: str, check_id: str) -> Dict[str, Any]:
    """Manifest package (topology + budget) chỉ lưu trong ``checks.result_json``;
    API Check không công bố nó. Chế độ host đọc thẳng DB tạm của stack."""
    import sqlite3
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        row = conn.execute("SELECT result_json FROM checks WHERE check_id=?", (check_id,)).fetchone()
    finally:
        conn.close()
    if not row or not row[0]:
        return {}
    raw = row[0].decode() if isinstance(row[0], bytes) else row[0]
    return {"manifest": json.loads(raw).get("manifest") or {}}


def compiler_instruction_count(compiler: str, statements: int) -> Optional[int]:
    """Số instruction do chính compiler production đếm (``usage.instructions``)."""
    with tempfile.NamedTemporaryFile("w", suffix=".st", delete=False) as handle:
        handle.write(program_source("T63_MAX_CAL", statements))
        path = handle.name
    try:
        proc = subprocess.run([compiler, "--source", path, "--check-only"], capture_output=True, text=True)
        usage = json.loads(proc.stdout).get("usage") or {}
        return (usage.get("instructions") or {}).get("used")
    except (ValueError, OSError):
        return None
    finally:
        os.unlink(path)


def run_scenario(api: Api, args: argparse.Namespace, level: str, db_path: Optional[str] = None) -> Dict[str, Any]:
    result: Dict[str, Any] = {"evidenceLevel": level, "startedAt": utc_now(),
                              "programs": args.programs, "statementsPerProgram": args.statements,
                              "periodMs": args.period_ms}
    if args.build_dir:
        result["instructionsPerProgram"] = compiler_instruction_count(
            os.path.join(args.build_dir, "core", "mkddc-st-compile"), args.statements)
    _, _, pre = api.call("GET", "/api/v1/programming/runtime")
    active_before = pre.get("activeRevisionId")
    result["activeBefore"] = active_before
    result["taskStateBefore"] = pre.get("taskState")
    label = f"T63-301 max-config {_dt.datetime.now(_dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    project = build_project(api, args.programs, args.statements, args.period_ms, label)
    result["project"] = {"projectId": project["projectId"], "label": label}
    checked = seal_and_check(api, project)
    check = checked["check"]
    manifest_source = check
    if db_path:
        manifest_source = read_manifest_from_db(db_path, checked["checkId"]) or check
    result["check"] = {"state": check.get("state"), "wallMs": checked["checkWallMs"],
                       "diagnostics": check.get("diagnostics"),
                       "manifestSource": "checks.result_json (DB host)" if db_path else
                       "không đọc được qua API; package tất định nên budgetUs trùng lượt host cùng tham số",
                       **summarize_manifest(manifest_source)}
    if check.get("state") != "PASSED":
        result["verdict"] = "CHECK_REJECTED"
        return result
    committed = False
    try:
        op = commission(api, active_before, checked["revisionId"], checked["checkId"])
        result["commission"] = {"state": op.get("state"), "actualActive": op.get("actualActiveRevisionId")}
        committed = op.get("state") == "SUCCEEDED"
        if committed:
            enable_at = time.monotonic()
            for pid in project["programIds"]:
                set_intent(api, project["projectId"], pid, True)
            result["enableWallMs"] = round((time.monotonic() - enable_at) * 1000, 1)
            result["observe"] = observe(api, args.observe_s)
            for pid in project["programIds"]:
                set_intent(api, project["projectId"], pid, False)
    finally:
        _, _, now = api.call("GET", "/api/v1/programming/runtime")
        current = now.get("activeRevisionId")
        if committed and active_before and current != active_before:
            op = restore(api, active_before, current)
            result["restore"] = {"state": op.get("state"), "requested": active_before}
        elif committed and not active_before:
            result["restore"] = {"state": "NOT_APPLICABLE",
                                 "note": "trước khi thử không có Active; Program thử đã Disable"}
        _, _, post = api.call("GET", "/api/v1/programming/runtime")
        result["activeAfter"] = post.get("activeRevisionId")
        result["activeRestored"] = (post.get("activeRevisionId") == active_before) if active_before else None
    obs = result.get("observe") or {}
    if obs.get("firstFaultAfterEnableS") is not None:
        result["verdict"] = "TASK_FAULTED"
    elif obs.get("maxExecUs") is not None and obs["maxExecUs"] > STEP_BUDGET_US:
        result["verdict"] = "OVERRUN_WITHOUT_FAULT"
    else:
        result["verdict"] = "WITHIN_BUDGET"
    result["finishedAt"] = utc_now()
    return result


def seed_host_active(api: Api) -> str:
    """Host: dựng một Active nền (1 Program nhỏ) để lượt thử phải khôi phục đúng
    nó — cùng đường Restore sẽ chạy trên bo."""
    project = build_project(api, 1, 8, 1000, "T63-301 Active nền (host)")
    checked = seal_and_check(api, project)
    op = commission(api, None, checked["revisionId"], checked["checkId"])
    if op.get("state") != "SUCCEEDED":
        raise RuntimeError(f"seed Active nền thất bại: {op}")
    return checked["revisionId"]


def start_host_stack(build_dir: str, web_bin: str, repo: str, port: int, tick_ms: int) -> Tuple[List[subprocess.Popen], str]:
    root = tempfile.mkdtemp(prefix="t63-301-")
    for sub in ("config", "core/staging", "programming/artifacts", "programming/scratch", "programming/backups", "keys"):
        os.makedirs(os.path.join(root, sub), exist_ok=True)
    core_dir = os.path.join(build_dir, "core")
    subprocess.run([os.path.join(core_dir, "mkddc-st-compile"), "--gen-device-key", os.path.join(root, "keys")],
                   check=True, stdout=subprocess.DEVNULL)
    shutil.copy(os.path.join(repo, "apps/web-api/config/users.conf"), os.path.join(root, "config/users.conf"))
    shutil.copy(os.path.join(repo, "platform/packaging/io_config.conf"), os.path.join(root, "config/io_config.conf"))
    prog_sock, web_sock = os.path.join(root, "programming.sock"), os.path.join(root, "core-status.sock")
    core = subprocess.Popen([os.path.join(core_dir, "mkddc-programming-core-sim"), "--socket", prog_sock,
                             "--web-socket", web_sock, "--state-dir", os.path.join(root, "core"),
                             "--st-trusted-key", os.path.join(root, "keys/device.pub"), "--tick-ms", str(tick_ms)],
                            stdout=open(os.path.join(root, "core.log"), "w"), stderr=subprocess.STDOUT)
    for _ in range(200):
        if os.path.exists(prog_sock) and os.path.exists(web_sock):
            break
        time.sleep(0.05)
    env = dict(os.environ, PORT=str(port), JWT_SECRET="t63-301-host-secret-at-least-32-bytes-long",
               USERS_CONF=os.path.join(root, "config/users.conf"), CONFIG_DIR=os.path.join(root, "config"),
               STATIC_DIR=os.path.join(root, "static"), CORE_PID=os.path.join(root, "missing-core.pid"),
               IOBUS_PID=os.path.join(root, "missing-iobus.pid"), CORE_SOCK=web_sock,
               HMI_SOCK=os.path.join(root, "hmi.sock"), NETCFG_SOCK=os.path.join(root, "netcfg.sock"),
               IOBUS_CONTROL_SOCK=os.path.join(root, "modbus-control.sock"),
               TREND_DB=os.path.join(root, "trend.sqlite"), HMI_AUDIT_FILE=os.path.join(root, "hmi-audit.jsonl"),
               ALARM_HISTORY_FILE=os.path.join(root, "alarm-history.jsonl"), PROGRAMMING_REV_A="1",
               PROGRAMMING_DB=os.path.join(root, "programming/programming.sqlite"),
               PROGRAMMING_BACKUP_DIR=os.path.join(root, "programming/backups"),
               PROGRAMMING_STATE_DIR=os.path.join(root, "programming"),
               PROGRAMMING_ARTIFACT_DIR=os.path.join(root, "programming/artifacts"),
               PROGRAMMING_STAGING_DIR=os.path.join(root, "core/staging"),
               PROGRAMMING_SCRATCH_DIR=os.path.join(root, "programming/scratch"),
               PROGRAMMING_SOCKET=prog_sock, PROGRAMMING_SIGNING_KEY=os.path.join(root, "keys/device.key"),
               PROGRAMMING_COMPILER=os.path.join(core_dir, "mkddc-st-compile"),
               PROGRAMMING_PACKAGER=os.path.join(core_dir, "mkddc-st-package"),
               PROGRAMMING_SIM_WORKER=os.path.join(core_dir, "mkddc-programming-sim-worker"),
               PROGRAMMING_TARGET_ID="host-t63-301")
    web = subprocess.Popen([web_bin], env=env, stdout=open(os.path.join(root, "web.log"), "w"),
                           stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):
        try:
            with urllib.request.urlopen(base + "/api/v1/health", timeout=1):
                break
        except (urllib.error.URLError, OSError):
            time.sleep(0.1)
    return [web, core], root


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="T63-301 tái hiện cấu hình Programming tối đa")
    parser.add_argument("mode", choices=("host", "remote"))
    parser.add_argument("--base-url", help="remote: ví dụ http://<bo>:8082")
    parser.add_argument("--build-dir", help="host: thư mục build C++ (chứa core/mkddc-programming-core-sim)")
    parser.add_argument("--web-bin", help="host: binary mkddc-web")
    parser.add_argument("--port", type=int, default=18431)
    parser.add_argument("--tick-ms", type=int, default=10, help="host: nhịp core-sim (base step 10 ms)")
    parser.add_argument("--programs", type=int, default=16)
    parser.add_argument("--statements", type=int, default=2047,
                        help="lệnh `Acc := Acc + 1;` mỗi Program; 2 instruction/lệnh + 1 ⇒ 2047 lệnh = 4.095 "
                             "instruction (trần 4.096; 2048 lệnh bị ST-POU-004)")
    parser.add_argument("--period-ms", type=int, default=10)
    parser.add_argument("--observe-s", type=float, default=30.0)
    parser.add_argument("--username", default=os.environ.get("MKDDC_PROBE_USER", "admin"))
    parser.add_argument("--out", required=True, help="file JSON kết quả")
    parser.add_argument("--keep-root", action="store_true", help="host: giữ thư mục tạm (log core/web) để điều tra")
    args = parser.parse_args(argv)

    log: List[Dict[str, Any]] = []
    procs: List[subprocess.Popen] = []
    root = None
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        if args.mode == "host":
            procs, root = start_host_stack(args.build_dir, args.web_bin, repo, args.port, args.tick_ms)
            api = Api(f"http://127.0.0.1:{args.port}", log)
            api.login(args.username, "admin123")  # tài khoản mặc định của stack host tạm, không phải bo
            level = "HOST"
            db_path = os.path.join(root, "programming/programming.sqlite")
            seeded = seed_host_active(api)
        else:
            password = os.environ.get("MKDDC_PROBE_PASSWORD")
            if not args.base_url or not password:
                parser.error("remote cần --base-url và MKDDC_PROBE_PASSWORD")
            api = Api(args.base_url, log)
            api.login(args.username, password)
            level = "TARGET"
            db_path = None
        result = run_scenario(api, args, level, db_path)
        if args.mode == "host":
            result["hostSeededActive"] = seeded
    finally:
        for proc in procs:
            proc.send_signal(signal.SIGTERM)
        for proc in procs:
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        if root and not args.keep_root:
            shutil.rmtree(root, ignore_errors=True)
        elif root:
            print(f"giữ thư mục stack host: {root}", file=sys.stderr)
    result["requests"] = len(log)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    summary = {k: result.get(k) for k in ("evidenceLevel", "verdict", "activeRestored")}
    summary["instructionsPerProgram"] = result.get("instructionsPerProgram")
    summary["check"] = {k: result.get("check", {}).get(k) for k in ("state", "budgetUsPerProgram", "wallMs")}
    summary["observe"] = {k: (result.get("observe") or {}).get(k)
                          for k in ("lastExecUsMedian", "maxExecUs", "firstFaultAfterEnableS", "overrunCountEnd")}
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if result.get("activeRestored") in (True, None) else 3


if __name__ == "__main__":
    sys.exit(main())
