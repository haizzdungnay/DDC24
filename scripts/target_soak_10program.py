#!/usr/bin/env python3
"""Dựng fixture 10-Program/3-chu-kỳ trên target rồi chạy soak — `T59-702`/`VS-PROG-U05`.

Vì sao là một script chứ không phải thao tác tay: soak 24 h chỉ có giá trị nếu
lần chạy sau lặp lại được đúng lần chạy trước. Toàn bộ fixture (tên Program, chu
kỳ, thứ tự) sinh tất định từ hằng trong file này.

Script KHÔNG tự kết luận PASS. Nó ghi số đo thô ra JSONL; kết luận nằm ở người
đọc bản ghi evidence.

  python3 scripts/target_soak_10program.py --base http://host:8082 setup
  python3 scripts/target_soak_10program.py --base http://host:8082 soak --hours 24
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

PROGRAM_COUNT = 10
# Ba chu kỳ hợp lệ của profile. Chia 4/3/3 để mỗi chu kỳ có nhiều hơn một
# Program — một chu kỳ chỉ có một Program không kiểm được thứ tự trong task.
PERIOD_PLAN = [(1000, 4), (5000, 3), (30000, 3)]


def source_for(index: int) -> str:
    """Mỗi Program có thân khác nhau để loại khả năng compiler gộp/nhớ kết quả."""
    return (
        f"PROGRAM SOAK_{index:02d}\n"
        "VAR_INPUT SupplyTemp : REAL; END_VAR\n"
        "VAR_OUTPUT Stage : BOOL; END_VAR\n"
        "VAR Counter : DINT; END_VAR\n"
        "Counter := Counter + 1;\n"
        f"Stage := SupplyTemp > {18.0 + index:.1f};\n"
        "END_PROGRAM\n"
    )


class Client:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.token = ""

    def call(self, method: str, path: str, data=None, headers=None, timeout=30):
        body = json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(self.base + path, data=body, method=method)
        request.add_header("Content-Type", "application/json")
        if self.token:
            request.add_header("Authorization", "Bearer " + self.token)
        if method in ("POST", "PATCH", "PUT", "DELETE"):
            request.add_header("X-Idempotency-Key", str(uuid.uuid4()))
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode()
                return response.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            try:
                return error.code, json.loads(raw or "{}")
            except json.JSONDecodeError:
                return error.code, {"raw": raw[:400]}

    def login(self, username: str, password: str) -> None:
        status, body = self.call("POST", "/api/v1/auth/login",
                                 {"username": username, "password": password})
        if status != 200 or "token" not in body:
            raise SystemExit(f"đăng nhập hỏng: {status} {body}")
        self.token = body["token"]


def expect(status: int, want: int, label: str, body) -> dict:
    if status != want:
        raise SystemExit(f"{label}: HTTP {status} (mong đợi {want})\n{json.dumps(body, ensure_ascii=False)[:600]}")
    return body


def setup(client: Client, project_name: str) -> dict:
    status, created = client.call("POST", "/api/v1/programming/projects",
                                  {"schemaVersion": "1.0", "name": project_name,
                                   "description": "T59-702 soak 10-Program/3 chu kỳ"})
    expect(status, 201, "tạo Project", created)
    project_id = created["resource"]["projectId"]
    draft_id = created["resource"]["draftRevisionId"]
    etag = created["etag"]

    # UUID v4 hợp lệ nhưng TẤT ĐỊNH: version nibble `4` và variant `8` phải đúng,
    # nếu không backend từ chối ở tầng validate và lỗi chỉ nói "request không hợp lệ".
    program_ids = [f"5111{index:04d}-1111-4111-8111-111111111111" for index in range(PROGRAM_COUNT)]
    operations = []
    for index, program_id in enumerate(program_ids):
        operations.append({
            "op": "upsertProgram",
            "program": {"programId": program_id, "name": f"SOAK_{index:02d}",
                        "kind": "PROGRAM", "language": "ST", "document": source_for(index)},
        })
    status, saved = client.call("PATCH", f"/api/v1/programming/projects/{project_id}/draft",
                                {"schemaVersion": "1.0", "baseRevisionId": draft_id,
                                 "operations": operations}, {"if-match": etag})
    expect(status, 200, "PATCH 10 Program", saved)
    etag = saved.get("etag", etag)

    cursor = 0
    for period, count in PERIOD_PLAN:
        chunk = program_ids[cursor:cursor + count]
        cursor += count
        status, saved = client.call("PATCH", f"/api/v1/programming/projects/{project_id}/draft",
                                    {"schemaVersion": "1.0", "baseRevisionId": draft_id,
                                     "operations": [{"op": "setTask",
                                                     "task": {"taskId": f"task-{period}",
                                                              "periodMs": period,
                                                              "programOrder": chunk}}]},
                                    {"if-match": etag})
        expect(status, 200, f"setTask {period} ms", saved)
        etag = saved.get("etag", etag)

    status, sealed = client.call("POST", f"/api/v1/programming/projects/{project_id}/draft/revisions",
                                 {"schemaVersion": "1.0", "baseRevisionId": draft_id,
                                  "label": "soak-10p", "comment": "T59-702"},
                                 {"if-match": etag})
    expect(status, 201, "seal Revision", sealed)
    revision_id = sealed["resource"]["revisionId"]
    etag = sealed["etag"]

    status, accepted = client.call("POST", f"/api/v1/programming/revisions/{revision_id}/checks",
                                   {"schemaVersion": "1.0", "targetProfile": "MK-DDC-24-REV-A"})
    expect(status, 202, "chạy Check", accepted)
    check_id = accepted["checkId"]
    started = time.time()
    while time.time() - started < 300:
        status, check = client.call("GET", f"/api/v1/programming/checks/{check_id}")
        state = check.get("state")
        if state == "PASSED":
            break
        if state in ("FAILED", "TIMED_OUT"):
            raise SystemExit(f"Check {state}: {json.dumps(check, ensure_ascii=False)[:900]}")
        time.sleep(1)
    else:
        raise SystemExit(f"Check không kết thúc trong 300 s: {json.dumps(check, ensure_ascii=False)[:400]}")
    print(f"Check PASSED sau {time.time() - started:.1f}s")

    return {"projectId": project_id, "revisionId": revision_id, "checkId": check_id,
            "etag": etag, "programIds": program_ids}


def commission_and_enable(client: Client, state: dict) -> dict:
    """Commission gói rồi bật đủ 10 Program.

    Ack impact được suy TỪ CHÍNH phản hồi `changes` chứ không viết cứng: nhóm nào
    `PRESENT` thì ack nhóm đó. Nhóm `UNAVAILABLE` là fail-closed — dừng ngay, vì
    ack một nhóm mình không đọc được nghĩa là ký vào chỗ trống.
    """
    project_id = state["projectId"]
    revision_id = state["revisionId"]
    status, changes = client.call(
        "GET", f"/api/v1/programming/revisions/none/changes/{revision_id}")
    expect(status, 200, "đọc impact", changes)
    impact = changes["impact"]
    groups = ["retain", "activeOverrides", "cutover", "outputMappingChanges",
              "publishedSignals", "controlLibrary", "programSet", "enableIntent"]
    acknowledgements = []
    for key in groups:
        group_status = impact.get(key, {}).get("status")
        if group_status == "UNAVAILABLE":
            raise SystemExit(f"impact.{key} = UNAVAILABLE — không ack một nhóm không đọc được")
        if group_status == "PRESENT":
            acknowledgements.append(key)

    status, accepted = client.call("POST", "/api/v1/programming/operations/commission",
                                   {"schemaVersion": "1.0", "revisionId": revision_id,
                                    "expectedActiveRevisionId": None, "checkId": state["checkId"],
                                    "impactRef": impact["impactRef"],
                                    "acknowledgements": acknowledgements,
                                    "cutover": {"requested": "PROGRAM_ONLY"}})
    expect(status, 202, "Commission", accepted)
    operation_id = accepted["operationId"]
    started = time.time()
    while time.time() - started < 300:
        status, operation = client.call("GET", f"/api/v1/programming/operations/{operation_id}")
        if operation.get("state") == "SUCCEEDED":
            break
        if operation.get("state") in ("FAILED", "ROLLED_BACK"):
            raise SystemExit(f"Commission {operation['state']}: {json.dumps(operation, ensure_ascii=False)[:800]}")
        time.sleep(1)
    else:
        raise SystemExit("Commission không kết thúc trong 300 s")
    print(f"Commission SUCCEEDED sau {time.time() - started:.1f}s; ack={acknowledgements}")

    enabled = []
    for program_id in state["programIds"]:
        status, body = client.call(
            "PUT", f"/api/v1/programming/projects/{project_id}/programs/{program_id}/runtime-intent",
            {"schemaVersion": "1.0", "desiredEnabled": True})
        expect(status, 200, f"Enable {program_id}", body)
        enabled.append(program_id)
    print(f"đã bật {len(enabled)}/{len(state['programIds'])} Program")
    return {"operationId": operation_id, "acknowledgements": acknowledgements, "enabled": enabled}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default="admin123")
    parser.add_argument("--state", default="build/soak/state.json")
    parser.add_argument("--name", default=None)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("setup")
    subparsers.add_parser("commission")
    soak_parser = subparsers.add_parser("soak")
    soak_parser.add_argument("--hours", type=float, default=24.0)
    soak_parser.add_argument("--interval", type=float, default=60.0)
    soak_parser.add_argument("--out", default="build/soak/samples.jsonl")
    arguments = parser.parse_args()

    client = Client(arguments.base)
    client.login(arguments.user, arguments.password)

    state_path = Path(arguments.state)
    if arguments.command == "setup":
        name = arguments.name or f"SOAK-10P-{time.strftime('%Y%m%d-%H%M%S')}"
        state = setup(client, name)
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
        print(json.dumps({k: v for k, v in state.items() if k != "programIds"}, indent=2))
        return 0

    state = json.loads(state_path.read_text(encoding="utf-8"))
    if arguments.command == "commission":
        result = commission_and_enable(client, state)
        state.update(result)
        state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
        return 0

    out_path = Path(arguments.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + arguments.hours * 3600
    with out_path.open("a", encoding="utf-8") as sink:
        while time.time() < deadline:
            sample = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            for label, path in (("runtime", "/api/v1/programming/runtime"),
                                ("monitor", "/api/v1/programming/runtime/monitor"),
                                ("health", "/api/v1/health")):
                status, body = client.call("GET", path, timeout=20)
                sample[label] = {"status": status, "body": body}
            sink.write(json.dumps(sample, ensure_ascii=False) + "\n")
            sink.flush()
            time.sleep(arguments.interval)
    return 0


if __name__ == "__main__":
    sys.exit(main())
