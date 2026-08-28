#!/usr/bin/env python3
"""Chạy đúng bộ cổng bắt buộc của một Wave Plan 59 bằng MỘT lệnh.

Ba vấn đề mà script này giải, đều là thứ đã cắn thật trong repo:

1. `verify-project.sh` dùng `set -e`, nên cổng đầu tiên hỏng là các cổng sau
   KHÔNG BAO GIỜ chạy. Người sửa thấy một lỗi, sửa xong lại lòi lỗi khác — và có
   lần một test hỏng nằm im rất lâu vì cổng phía trên nó luôn đỏ trước.
2. Không có nơi nào ghi Wave nào cần cổng nào, nên "đủ cổng chưa" là phán đoán.
3. Kết quả cục bộ dễ bị chép vào báo cáo như thể là GitHub CI. Ở đây mỗi dòng
   đều mang MỨC BẰNG CHỨNG, và cổng cần CI/board/instrument thì không có đường
   nào để runner này báo PASS.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
from typing import Any

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "contracts/ci/wave_gate_matrix_v1.json"
SCHEMA = ROOT / "contracts/ci/wave_gate_matrix_v1.schema.json"
RUNNABLE_LEVEL = "HOST"
LOG_DIR = ROOT / "build/wave-gates"


def load() -> dict[str, Any]:
    matrix = json.loads(MATRIX.read_text(encoding="utf-8"))
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    problems = sorted(
        Draft202012Validator(schema).iter_errors(matrix),
        key=lambda item: list(item.absolute_path),
    )
    if problems:
        joined = "; ".join(
            f"{'/'.join(str(part) for part in item.absolute_path) or '<root>'}: {item.message}"
            for item in problems
        )
        raise ValueError(f"ma trận không khớp schema: {joined}")
    validate(matrix)
    return matrix


def validate(matrix: dict[str, Any]) -> None:
    gates = {item["id"]: item for item in matrix["gates"]}
    if len(gates) != len(matrix["gates"]):
        raise ValueError("id cổng bị trùng")
    seen_waves: set[str] = set()
    for wave in matrix["waves"]:
        if wave["wave"] in seen_waves:
            raise ValueError(f"wave {wave['wave']} khai hai lần")
        seen_waves.add(wave["wave"])
        unknown = [gate for gate in wave["gates"] if gate not in gates]
        if unknown:
            raise ValueError(f"{wave['wave']}: cổng không tồn tại {unknown}")
    orphan = sorted(set(gates) - {gate for wave in matrix["waves"] for gate in wave["gates"]})
    if orphan:
        raise ValueError(f"cổng khai nhưng không Wave nào dùng: {orphan}")
    for gate in matrix["gates"]:
        if gate["evidenceLevel"] == RUNNABLE_LEVEL:
            script = gate["command"][0]
            candidate = ROOT / script
            if script not in {"python3"} and not candidate.exists():
                raise ValueError(f"{gate['id']}: lệnh không tồn tại: {script}")


def wave_entry(matrix: dict[str, Any], wave: str) -> dict[str, Any]:
    for item in matrix["waves"]:
        if item["wave"] == wave:
            return item
    raise ValueError(f"wave không có trong ma trận: {wave}")


def run_gate(gate: dict[str, Any], attempt: int = 1) -> tuple[str, float, str]:
    """Trả (trạng thái, giây, ghi chú). KHÔNG BAO GIỜ trả PASS cho cổng ngoài HOST."""
    if gate["evidenceLevel"] != RUNNABLE_LEVEL:
        return (
            "NOT_RUN",
            0.0,
            f"cần {gate['requiresResource']} — runbook {gate['runbook']} (chủ {gate['owner']})",
        )
    command = list(gate["command"])
    if command[0] != "python3":
        command[0] = str(ROOT / command[0])
    started = time.monotonic()
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    elapsed = time.monotonic() - started

    # Giữ TOÀN BỘ output từng cổng. Bản đầu của runner này chỉ giữ một dòng cuối,
    # và ngay lần chạy W7 đầu tiên cổng `cpp` đỏ một lần rồi không tái hiện —
    # không có log thì không có gì để điều tra. Một cổng chập chờn mà không lần
    # ra được còn nguy hiểm hơn một cổng đỏ hẳn.
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    suffix = "" if attempt == 1 else f".{attempt}"
    log_path = LOG_DIR / f"{gate['id']}{suffix}.log"
    log_path.write_text(
        f"$ {' '.join(command)}\nexit={completed.returncode} elapsed={elapsed:.1f}s\n\n"
        f"--- stdout ---\n{completed.stdout}\n--- stderr ---\n{completed.stderr}",
        encoding="utf-8",
    )
    if completed.returncode == 0:
        return "PASS", elapsed, ""
    tail = (completed.stderr or completed.stdout or "").strip().splitlines()
    reason = tail[-1][:120] if tail else f"exit {completed.returncode}"
    return "FAIL", elapsed, f"{reason} [log: {log_path.relative_to(ROOT)}]"


def report(wave: str, title: str, rows: list[tuple[str, str, str, float, str]]) -> int:
    width = max(len(row[0]) for row in rows)
    print(f"\n=== Wave {wave} — {title} ===")
    for gate_id, level, status, elapsed, note in rows:
        duration = f"{elapsed:6.1f}s" if elapsed else "      -"
        line = f"  {gate_id.ljust(width)}  {level:<6}  {status:<7}  {duration}"
        print(line if not note else f"{line}  {note}")

    passed = sum(1 for row in rows if row[2] == "PASS")
    failed = [row[0] for row in rows if row[2] == "FAIL"]
    not_run = [row[0] for row in rows if row[2] == "NOT_RUN"]
    print(
        f"\n  Tổng: {passed} PASS / {len(failed)} FAIL / {len(not_run)} NOT_RUN "
        f"trên {len(rows)} cổng"
    )
    if failed:
        print(f"  FAIL: {', '.join(failed)}")
    if not_run:
        print(f"  NOT_RUN (cần tài nguyên ngoài): {', '.join(not_run)}")
    print(
        "\n  MỨC BẰNG CHỨNG: mọi dòng PASS ở đây là HOST/LOCAL. Đây KHÔNG phải\n"
        "  GitHub CI, KHÔNG phải target, KHÔNG phải HIL. Không được chép kết quả\n"
        "  này vào báo cáo như thể required checks đã xanh."
    )
    return 1 if failed else 0


def run_self_test(matrix: dict[str, Any]) -> int:
    import copy

    checks = 0

    # 1. Cổng ngoài HOST không bao giờ được báo PASS.
    for gate in matrix["gates"]:
        if gate["evidenceLevel"] != RUNNABLE_LEVEL:
            status, _, note = run_gate(gate)
            if status != "NOT_RUN" or not note:
                raise RuntimeError(f"{gate['id']}: cổng ngoài HOST phải NOT_RUN kèm lý do")
            checks += 1
    if checks == 0:
        raise RuntimeError("ma trận phải có ít nhất một cổng cần tài nguyên ngoài")

    # 2. Ma trận sai phải bị từ chối, không im lặng bỏ qua.
    mutations = [
        ("wave-tham-chieu-cong-la", lambda m: m["waves"][0]["gates"].append("khong-ton-tai")),
        ("cong-mo-coi", lambda m: m["gates"].append(
            {"id": "mo-coi", "evidenceLevel": "HOST", "command": ["scripts/verify-project.sh"],
             "description": "không Wave nào dùng"})),
        ("trung-id-cong", lambda m: m["gates"].append(copy.deepcopy(m["gates"][0]))),
        ("lenh-khong-ton-tai", lambda m: m["gates"][0].__setitem__("command", ["scripts/khong-co.sh"])),
    ]
    for name, mutate in mutations:
        candidate = copy.deepcopy(matrix)
        mutate(candidate)
        try:
            validate(candidate)
        except ValueError:
            checks += 1
            continue
        raise RuntimeError(f"self-test {name} không bị từ chối")

    print(f"PASS self-test: {checks}/{checks} phép kiểm ma trận đạt")
    return checks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wave", help="W0..W8")
    parser.add_argument("--list", action="store_true", help="In ma trận rồi thoát")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument(
        "--repeat", type=int, default=1,
        help="Chạy lại mỗi cổng HOST N lần để soi cổng chập chờn; chỉ PASS khi TẤT CẢ lần đều PASS.",
    )
    args = parser.parse_args()

    try:
        matrix = load()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1

    if args.self_test:
        try:
            run_self_test(matrix)
        except RuntimeError as error:
            print(f"FAIL self-test: {error}", file=sys.stderr)
            return 1
        if not args.wave and not args.list:
            return 0

    gates = {item["id"]: item for item in matrix["gates"]}
    if args.list or not args.wave:
        for wave in matrix["waves"]:
            levels = [gates[gate]["evidenceLevel"] for gate in wave["gates"]]
            host = sum(1 for level in levels if level == RUNNABLE_LEVEL)
            print(
                f"{wave['wave']}  {host}/{len(levels)} cổng chạy được cục bộ  "
                f"{wave['title']}\n      {', '.join(wave['gates'])}"
            )
        if not args.wave:
            print("\nDùng --wave W0 để chạy đúng bộ cổng của một Wave.")
            return 0

    try:
        entry = wave_entry(matrix, args.wave)
    except ValueError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1

    if args.repeat < 1:
        print("FAIL: --repeat phải >= 1", file=sys.stderr)
        return 1

    rows: list[tuple[str, str, str, float, str]] = []
    for gate_id in entry["gates"]:
        gate = gates[gate_id]
        status, elapsed, note = run_gate(gate)
        total = elapsed
        # Lặp lại chỉ có nghĩa với cổng HOST; PASS phải đúng ở MỌI lần, vì một
        # cổng đỏ 1/5 lần vẫn là cổng hỏng chứ không phải cổng xanh.
        if status == "PASS" and gate["evidenceLevel"] == RUNNABLE_LEVEL:
            for attempt in range(2, args.repeat + 1):
                again, extra, again_note = run_gate(gate, attempt)
                total += extra
                if again != "PASS":
                    status, note = "FAIL", f"chập chờn: lần {attempt} hỏng — {again_note}"
                    break
        # Chạy hết mọi cổng rồi mới kết luận: dừng ở cổng hỏng đầu tiên chính là
        # lý do những lỗi phía sau nằm im rất lâu.
        rows.append((gate_id, gate["evidenceLevel"], status, total, note))
    return report(entry["wave"], entry["title"], rows)


if __name__ == "__main__":
    raise SystemExit(main())
