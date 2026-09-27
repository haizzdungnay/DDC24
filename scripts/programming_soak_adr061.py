#!/usr/bin/env python3
"""Soak 24 h lần 3 cho ADR-061 (C1–C4) và `VS-PROG-009` — revision thử 8 Program.

Chủ sở hữu chốt 2026-09-27: soak lần 3 chạy một revision thử có đúng 8 Program
ST, mỗi Program một chu kỳ của tập ADR-061 {10, 50, 100, 500, 1000, 5000, 10000,
50000} ms, THAY Active hiện tại trong 24 h, rồi trả về. Mỗi Program chỉ đếm số
lần chạy (`cnt := cnt + 1;`), không có binding nào, nên revision thử không ghi
DO/AO cục bộ hay Modbus nào.

Bốn lệnh con, chạy tuần tự từ một máy có đường HTTP tới web-api của bo:

  prepare  tạo/cập nhật Project riêng `SOAK-ADR061`, niêm phong, Check, in
           revisionId đã PASSED. KHÔNG đổi runtime.
  start    đọc trạng thái sống NGAY trước khi đổi (Active, intent, bộ đếm C2–C4,
           đầu ra) vào file state; với `--outputs safe` (mặc định) tắt intent các
           Program đang chạy của Active để đầu ra về trạng thái an toàn; bật intent
           8 Program thử; Commission sang revision thử; ghi mốc bắt đầu.
  report   đọc bộ đếm Task và từng Program, tính theo cửa sổ từ lúc `start`, in
           bảng PASS/FAIL cho C1–C4 và `VS-PROG-009` từng chu kỳ. `--journal-file`
           đọc bản xuất `journalctl -u mkddc-core` để có lệch nhịp tối đa theo phút
           và số dòng `core.base_step_missed`.
  stop     đọc lại Active ngay trước khi trả. CHỈ Restore về Active đã lưu khi
           Active vẫn là revision thử (`expectedActiveRevisionId`); người khác đã
           đổi thì dừng, không ghi đè.

Credential lấy từ tham số hoặc biến môi trường `MKDDC_WEB_URL`, `MKDDC_WEB_USER`,
`MKDDC_WEB_PASSWORD`. Mật khẩu và token không bao giờ được ghi vào state, log hay
output. Mọi idempotency key và ID mới là UUIDv4 sinh MỚI mỗi lần chạy: bộ đếm
theo tiến trình từng làm e2e đọc lại bản ghi của lần chạy trước.

Runbook: `docs/07_records/test-evidence/programming/2026-09-25-fbd-st-modbus-do-audit.md`
mục "Soak lần 3".
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

# --- Hằng số profile ---------------------------------------------------------
# Khớp `contracts/programming/product_profile_v2.json` (test canh để hai nơi
# không trôi khỏi nhau) và mô hình ngân sách ADR-061 mục 4.3.
PERIODS_MS: tuple[int, ...] = (10, 50, 100, 500, 1000, 5000, 10000, 50000)
BASE_STEP_MS = 10
MAX_TASK_BUDGET_PERCENT = 20
STEP_BUDGET_US = BASE_STEP_MS * 1000 * MAX_TASK_BUDGET_PERCENT // 100  # 2000 µs
MAX_TASKS = 8
MAX_PROGRAMS_TOTAL = 32
MAX_PROGRAMS_ENABLED = 16

# --- Tiêu chí ----------------------------------------------------------------
JITTER_LIMIT_US = 100                 # C4
SOAK_SECONDS = 24 * 60 * 60           # cổng ghi spec (ADR-061 "Hệ quả")
VS_PROG_009_CYCLES = 10_000           # chu kỳ ≤ 5000 ms (VVP-PROG-001 v2.3)
VS_PROG_009_SHORT_MAX_MS = 5000

PROJECT_NAME_DEFAULT = "SOAK-ADR061"
PROGRAM_PREFIX = "SOAK_P"
TARGET_PROFILE = "MK-DDC-24-REV-A"
STATE_SCHEMA = "mkddc.programming-soak-adr061/1"
EVIDENCE_ID = "EV-PROG-FBD-ST-MB-20260925"

IMPACT_KEYS: tuple[str, ...] = (
    "retain", "activeOverrides", "cutover", "outputMappingChanges", "publishedSignals",
    "controlLibrary", "programSet", "enableIntent", "physicalMappingChanges",
    "virtualPointChanges", "modbusMappingChanges", "writableOutputsAffected",
)
OPERATION_TERMINAL = frozenset({"SUCCEEDED", "FAILED", "ROLLED_BACK"})
CHECK_TERMINAL = frozenset({"PASSED", "FAILED", "TIMED_OUT"})
ACK_MODBUS_SLOT_MISMATCH = "modbus-slot-mismatch-override"

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_ERROR = 2
EXIT_REFUSED = 3


class SoakError(Exception):
    """Lỗi dừng lệnh con; thông điệp đã là tiếng Việt cho người vận hành."""


# =============================================================================
# Phần thuần: revision thử, ngân sách, ngưỡng, đánh giá cửa sổ, journal.
# =============================================================================

def program_name(period_ms: int) -> str:
    return f"{PROGRAM_PREFIX}{period_ms:05d}"


def program_source(period_ms: int) -> str:
    """Mã ST của một Program soak: chỉ đếm số lần chạy, không có output.

    `cnt` là biến cục bộ `VAR` (không phải `VAR_OUTPUT`), nên compiler không
    sinh cổng nào để bind và Program không giữ proposal mức 5 trên đầu ra nào.
    DINT ở 10 ms tràn sau khoảng 248 ngày, xa ngoài cửa sổ 24 h.
    """
    name = program_name(period_ms)
    return (
        f"PROGRAM {name}\n"
        "VAR\n"
        "    cnt : DINT;\n"
        "END_VAR\n"
        f"(* {EVIDENCE_ID} soak lan 3, chu ky {period_ms} ms: chi dem so lan chay, khong co output. *)\n"
        "cnt := cnt + 1;\n"
        "END_PROGRAM\n"
    )


def program_budget_us(program_count: int) -> int:
    """Phần chia ngân sách một base step theo kịch bản xấu nhất (ADR-061 4.3).

    Cùng công thức với `programBudgetUs` của Check: tổng phải NHỎ HƠN
    `STEP_BUDGET_US` nên chia từ `STEP_BUDGET_US - 1`.
    """
    if program_count <= 0:
        return 0
    return (STEP_BUDGET_US - 1) // program_count


def budget_plan(periods: Sequence[int]) -> dict[str, Any]:
    """Kiểm trần profile cho tập Program thử và trả bảng ngân sách."""
    count = len(periods)
    share = program_budget_us(count)
    worst = share * count
    allowed = set(PERIODS_MS)
    checks = {
        "periodsInSet": all(period in allowed for period in periods),
        "distinctPeriods": len(set(periods)) == count,
        "periodClassesWithinMaxTasks": len(set(periods)) <= MAX_TASKS,
        "programsWithinTotal": count <= MAX_PROGRAMS_TOTAL,
        "programsWithinEnabled": count <= MAX_PROGRAMS_ENABLED,
        "worstCaseBelowStepBudget": worst < STEP_BUDGET_US,
    }
    return {
        "programCount": count,
        "baseStepMs": BASE_STEP_MS,
        "stepBudgetUs": STEP_BUDGET_US,
        "programBudgetUs": share,
        "worstCaseStepUs": worst,
        "limits": {"maxTasks": MAX_TASKS, "maxProgramsTotal": MAX_PROGRAMS_TOTAL,
                   "maxProgramsEnabled": MAX_PROGRAMS_ENABLED},
        "checks": checks,
        "ok": all(checks.values()),
    }


def required_cycles(period_ms: int) -> int:
    """Ngưỡng `VS-PROG-009` v2.3 cho một chu kỳ.

    Chu kỳ ≤ 5 s cần 10 000 chu kỳ; 10 s và 50 s chạy trọn soak 24 h
    (8 640 và 1 728 chu kỳ) vì 10 000 chu kỳ 50 s mất 5,8 ngày.
    """
    if period_ms <= VS_PROG_009_SHORT_MAX_MS:
        return VS_PROG_009_CYCLES
    return SOAK_SECONDS * 1000 // period_ms


def required_seconds(period_ms: int) -> float:
    return required_cycles(period_ms) * period_ms / 1000.0


def draft_program_plan(draft: Mapping[str, Any] | None,
                       new_id: Callable[[], str]) -> list[dict[str, Any]]:
    """Chọn objectId/programId cho 8 Program: tái dùng theo TÊN nếu Draft đã có.

    Tái dùng giữ danh tính instance ổn định giữa các lần `prepare`, nên intent
    đã lưu và lịch sử audit của từng Program không bị đứt.
    """
    objects = list((draft or {}).get("objects") or [])
    programs = list((draft or {}).get("programs") or [])
    by_name = {str(item.get("name", "")).upper(): item for item in objects}
    program_by_object = {item.get("objectId"): item for item in programs}
    plan = []
    for period in PERIODS_MS:
        name = program_name(period)
        existing = by_name.get(name.upper())
        if existing is not None:
            object_id = str(existing["objectId"])
            program_id = str((program_by_object.get(object_id) or {}).get("programId") or object_id)
        else:
            object_id = new_id()
            program_id = object_id
        plan.append({"periodMs": period, "name": name, "objectId": object_id, "programId": program_id})
    return plan


def unexpected_draft_content(draft: Mapping[str, Any] | None) -> list[str]:
    """Nội dung Draft KHÔNG thuộc revision thử: POU lạ, binding, signal.

    Revision thử phải có đúng 8 Program và 0 binding. Script không tự xoá thứ
    của người khác; gặp nội dung lạ thì dừng và nói rõ.
    """
    if not draft:
        return []
    managed = {program_name(period).upper() for period in PERIODS_MS}
    problems = []
    for item in draft.get("objects") or []:
        if str(item.get("name", "")).upper() not in managed:
            problems.append(f"POU lạ: {item.get('name')} ({item.get('kind')})")
        elif item.get("kind") != "PROGRAM":
            problems.append(f"POU {item.get('name')} không phải PROGRAM mà là {item.get('kind')}")
    for item in draft.get("bindings") or []:
        problems.append(f"binding: {item.get('bindingId')}")
    for item in draft.get("signals") or []:
        problems.append(f"Published Signal: {item.get('name')}")
    return problems


def build_draft_operations(plan: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Lô PATCH Draft: `upsertObject` + `upsertProgram` cho từng Program.

    Không có `upsertBinding`: không Program nào có output vật lý.
    """
    operations: list[dict[str, Any]] = []
    for item in plan:
        operations.append({"op": "upsertObject", "object": {
            "objectId": item["objectId"], "kind": "PROGRAM", "name": item["name"],
            "language": "ST", "source": program_source(int(item["periodMs"])),
            "interface": {"inputs": [], "outputs": []},
        }})
        operations.append({"op": "upsertProgram", "program": {
            "programId": item["programId"], "objectId": item["objectId"],
            "periodMs": int(item["periodMs"]),
        }})
    return operations


def impact_acknowledgements(impact: Mapping[str, Any]) -> list[str]:
    """Nhóm impact `PRESENT` phải được xác nhận khi Commission (không thừa, không thiếu)."""
    return [key for key in IMPACT_KEYS
            if isinstance(impact.get(key), Mapping) and impact[key].get("status") == "PRESENT"]


def parse_utc(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    # Python < 3.11 không đọc được phần thập phân dài hơn 6 chữ số.
    match = re.match(r"^(.*T\d{2}:\d{2}:\d{2})(\.\d+)?(.*)$", text)
    if match and match.group(2) and len(match.group(2)) > 7:
        text = match.group(1) + match.group(2)[:7] + match.group(3)
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def format_duration(seconds: float | None) -> str:
    if seconds is None:
        return "—"
    seconds = max(0.0, float(seconds))
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours} h {minutes:02d} ph {secs:02d} s"


def _delta(start: Mapping[str, Any], now: Mapping[str, Any], key: str) -> int | None:
    before, after = start.get(key), now.get(key)
    if before is None or after is None:
        return None
    return int(after) - int(before)


def signed(value: int | float | None) -> str:
    """`+3`, `+0`, hoặc `—` khi không đọc được (không in `+None`, không đoán `0`)."""
    return "—" if value is None else f"{value:+}"


def _verdict(violations: int | None, *, fail: bool = False) -> str:
    if fail:
        return "FAIL"
    if violations is None:
        return "KHÔNG ĐỌC ĐƯỢC"
    return "PASS" if violations == 0 else "FAIL"


def evaluate_window(baseline: Mapping[str, Any], current: Mapping[str, Any],
                    programs: Sequence[Mapping[str, Any]], soak_revision_id: str) -> dict[str, Any]:
    """Đánh giá C1–C4 và `VS-PROG-009` trên cửa sổ [baseline, current].

    `baseline`/`current` là ảnh chụp do `capture_snapshot` dựng (runtime, Task,
    Program). Mọi phép đo là HIỆU hai bộ đếm tích luỹ của Core trong cùng một đời
    tiến trình; bộ đếm giảm nghĩa là Core đã khởi động lại và soak phải bắt đầu
    lại (audit lượt 3: "Core restart giữa chừng thì soak phải bắt đầu lại").

    Số chu kỳ của từng Program suy từ số base step Core ĐÃ CHẠY (`runCount` của
    Task `main`, chạy mỗi base step) nhân chu kỳ Task, chia chu kỳ Program. API
    không công bố bộ đếm lần chạy riêng từng Program; con số này chỉ có nghĩa
    khi `missedReleaseCount` của Program không tăng, nên hai điều kiện luôn đi
    cùng nhau trong kết luận.
    """
    task0 = baseline.get("task") or {}
    task1 = current.get("task") or {}
    t0 = parse_utc(baseline.get("observedAt"))
    t1 = parse_utc(current.get("observedAt"))
    window_s = (t1 - t0).total_seconds() if t0 and t1 else None

    counters = ("runCount", "missedReleaseCount", "overrunCount", "jitterViolationCount",
                "missedBaseStepCount")
    deltas = {key: _delta(task0, task1, key) for key in counters}
    restarted = any(value is not None and value < 0 for value in deltas.values())
    task_period_ms = task1.get("periodMs") or task0.get("periodMs")
    base_steps = deltas["runCount"]

    active_ok = current.get("activeRevisionId") == soak_revision_id
    notes: list[str] = []
    if restarted:
        notes.append("Bộ đếm Core giảm so với lúc start: Core đã khởi động lại, soak phải bắt đầu lại")
    if not active_ok:
        notes.append(f"Active hiện tại {current.get('activeRevisionId')} không phải revision thử "
                     f"{soak_revision_id}: soak bị gián đoạn")

    # C1 — base step và tập chu kỳ.
    caps = sorted(int(value) for value in (current.get("taskPeriodsMs") or []))
    base_step_us = task1.get("baseStepUs")
    c1_detail = []
    c1_fail = False
    if caps != sorted(PERIODS_MS):
        c1_fail = True
        c1_detail.append(f"taskPeriodsMs={caps}")
    if base_step_us is None:
        c1_detail.append("baseStepUs không có")
    elif int(base_step_us) != BASE_STEP_MS * 1000:
        c1_fail = True
        c1_detail.append(f"baseStepUs={base_step_us}")

    # Từng Program.
    rows = []
    not_running: list[str] = []
    missed_programs_total = 0
    now_programs = current.get("programs") or {}
    start_programs = baseline.get("programs") or {}
    for spec in programs:
        program_id = spec["programId"]
        period = int(spec["periodMs"])
        live = now_programs.get(program_id) or {}
        first = start_programs.get(program_id) or {}
        missed = _delta(first, live, "missedReleaseCount")
        faults = _delta(first, live, "faultCount")
        running = live.get("runtimeState") == "RUNNING" and live.get("enabled") is True
        if live and live.get("periodMs") != period:
            c1_fail = True
            c1_detail.append(f"{spec['name']} periodMs={live.get('periodMs')}")
        if not running:
            # Program không chạy thì mọi release của nó đều lỡ: tính vào C3.
            not_running.append(spec["name"])
        cycles = None
        if base_steps is not None and base_steps >= 0 and task_period_ms:
            cycles = base_steps * int(task_period_ms) // period
        needed = required_cycles(period)
        broken = (not running or missed is None or missed != 0
                  or (faults is not None and faults != 0) or restarted or not active_ok)
        if broken:
            status = "FAIL"
        elif cycles is not None and cycles >= needed:
            status = "ĐẠT"
        else:
            status = "CHƯA ĐỦ"
        if missed:
            missed_programs_total += max(0, missed)
        remaining_s = None
        if status == "CHƯA ĐỦ" and cycles is not None:
            remaining_s = (needed - cycles) * period / 1000.0
        rows.append({
            "name": spec["name"], "programId": program_id, "periodMs": period,
            "runtimeState": live.get("runtimeState"), "enabled": live.get("enabled"),
            "reportedPeriodMs": live.get("periodMs"), "cycles": cycles, "requiredCycles": needed,
            "missedReleaseDelta": missed, "faultDelta": faults, "maxExecNs": live.get("maxExecNs"),
            "lastRunAgeMs": live.get("lastRunAgeMs"), "status": status,
            "remainingSeconds": remaining_s,
        })

    c3_values = [deltas["missedReleaseCount"], deltas["missedBaseStepCount"]]
    if any(value is None for value in c3_values):
        c3_violations = None
    else:
        c3_violations = sum(max(0, int(value)) for value in c3_values) + missed_programs_total
    c3_detail = (f"missed release Task {signed(deltas['missedReleaseCount'])}, Program {signed(missed_programs_total)}, "
                 f"missed base step {signed(deltas['missedBaseStepCount'])}")
    if not_running:
        c3_detail += "; không RUNNING: " + ", ".join(not_running)
    criteria = {
        "C1": {"verdict": "FAIL" if c1_fail else ("PASS" if base_step_us is not None else "KHÔNG ĐỌC ĐƯỢC"),
               "detail": ", ".join(c1_detail) or f"base step {BASE_STEP_MS} ms, tập chu kỳ đúng"},
        "C2": {"verdict": _verdict(deltas["overrunCount"], fail=restarted),
               "detail": f"overrun {signed(deltas['overrunCount'])}; maxExecNs Task {task1.get('maxExecNs')} "
                         f"(ngân sách {task1.get('budgetUs')} µs)"},
        "C3": {"verdict": _verdict(c3_violations, fail=restarted or bool(not_running)),
               "detail": c3_detail},
        "C4": {"verdict": _verdict(deltas["jitterViolationCount"], fail=restarted),
               "detail": f"lệch > {JITTER_LIMIT_US} µs {signed(deltas['jitterViolationCount'])}; "
                         f"jitterMaxUs 60 s gần nhất {task1.get('jitterMaxUs')}"},
    }
    verdicts = {item["verdict"] for item in criteria.values()}
    soak_complete = window_s is not None and window_s >= SOAK_SECONDS
    if "FAIL" in verdicts or not active_ok or restarted:
        overall = "HỎNG"
    elif verdicts != {"PASS"}:
        overall = "KHÔNG KẾT LUẬN"
    elif soak_complete and all(row["status"] == "ĐẠT" for row in rows):
        overall = "ĐẠT"
    else:
        overall = "ĐANG CHẠY"
    return {
        "windowSeconds": window_s,
        "soakComplete": soak_complete,
        "baseSteps": base_steps,
        "taskPeriodMs": task_period_ms,
        "expectedBaseSteps": (int(window_s * 1000 // int(task_period_ms))
                              if window_s is not None and task_period_ms else None),
        "deltas": deltas,
        "restarted": restarted,
        "activeOk": active_ok,
        "criteria": criteria,
        "programs": rows,
        "overall": overall,
        "notes": notes,
    }


# --- Journal ------------------------------------------------------------------

_MONTHS = {name: index for index, name in enumerate(
    ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), start=1)}
_ISO_PREFIX = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s")
_SHORT_PREFIX = re.compile(r"^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?\s")
_KV = re.compile(r"\b([a-z_]+)=([-+]?\d+(?:\.\d+)?)")


def _journal_timestamp(line: str, year: int) -> tuple[dt.datetime | None, str]:
    match = _ISO_PREFIX.match(line)
    if match:
        raw = match.group(1)
        if re.search(r"[+-]\d{4}$", raw):
            raw = raw[:-2] + ":" + raw[-2:]
        return parse_utc(raw), line[match.end():]
    match = _SHORT_PREFIX.match(line)
    if match and match.group(1) in _MONTHS:
        micro = int((match.group(6) or "0").ljust(6, "0"))
        stamp = dt.datetime(year, _MONTHS[match.group(1)], int(match.group(2)), int(match.group(3)),
                            int(match.group(4)), int(match.group(5)), micro, tzinfo=dt.timezone.utc)
        return stamp, line[match.end():]
    return None, line


def _journal_records(lines: Iterable[str], year: int) -> Iterable[tuple[dt.datetime | None, str]]:
    for raw in lines:
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        if line.lstrip().startswith("{"):
            try:
                entry = json.loads(line)
            except ValueError:
                entry = None
            if isinstance(entry, dict) and "MESSAGE" in entry:
                stamp = None
                if "__REALTIME_TIMESTAMP" in entry:
                    micros = int(entry["__REALTIME_TIMESTAMP"])
                    stamp = dt.datetime.fromtimestamp(micros / 1e6, tz=dt.timezone.utc)
                message = entry["MESSAGE"]
                if isinstance(message, list):  # journald xuất bytes thành mảng số
                    message = bytes(message).decode("utf-8", "replace")
                yield stamp, str(message)
                continue
        yield _journal_timestamp(line, year)


def parse_journal(lines: Iterable[str], *, since: dt.datetime | None = None,
                  until: dt.datetime | None = None, year: int | None = None,
                  baseline_violations: int | None = None,
                  baseline_missed_steps: int | None = None) -> dict[str, Any]:
    """Đọc bản xuất `journalctl -u mkddc-core` và đánh giá C4 theo phút.

    Nhận ba dạng: `-o json`, `--utc -o short-iso(-precise)` và `short(-precise)`
    (dạng cuối không có năm và múi giờ: coi là UTC, năm lấy từ `year`). Dòng
    không có mốc thời gian (ví dụ đã `grep` bỏ tiền tố) vẫn được đếm nhưng
    không lọc được theo cửa sổ; kết quả nói rõ điều đó.

    `baseline_*` là bộ đếm tích luỹ đọc qua API lúc `start`. Dùng chúng làm
    mốc thì một vi phạm xảy ra giữa lúc start và dòng `core.jitter` đầu tiên
    vẫn được tính.
    """
    year = year or dt.datetime.now(dt.timezone.utc).year
    minutes: list[dict[str, Any]] = []
    missed_lines: list[str] = []
    safe_enter = 0
    restarts: list[str] = []
    untimed = 0
    for stamp, message in _journal_records(lines, year):
        if stamp is None:
            untimed += 1
        else:
            if since is not None and stamp < since:
                continue
            if until is not None and stamp > until:
                continue
        if "core.jitter" in message:
            values = {key: float(value) for key, value in _KV.findall(message)}
            if "max_us" not in values:
                continue
            minutes.append({"at": stamp.isoformat() if stamp else None, "maxUs": values["max_us"],
                            "violations": int(values["violations"]) if "violations" in values else None,
                            "missedSteps": int(values["missed_steps"]) if "missed_steps" in values else None,
                            "overruns": int(values["overruns"]) if "overruns" in values else None})
        elif "core.base_step_missed" in message:
            missed_lines.append(message.strip())
        elif "safe_state.enter" in message:
            safe_enter += 1
        elif "core.base_step_ms=" in message or "core.ready" in message:
            restarts.append(message.strip())

    def cumulative_delta(field: str, baseline: int | None) -> tuple[int | None, bool]:
        values = [item[field] for item in minutes if item[field] is not None]
        if not values:
            return None, False
        decreased = any(later < earlier for earlier, later in zip(values, values[1:]))
        first = baseline if baseline is not None else values[0]
        if values[0] < first:
            decreased = True
        return values[-1] - first, decreased

    violations, reset_v = cumulative_delta("violations", baseline_violations)
    missed_steps, reset_m = cumulative_delta("missedSteps", baseline_missed_steps)
    over = [item for item in minutes if item["maxUs"] > JITTER_LIMIT_US]
    gaps = []
    stamps = [parse_utc(item["at"]) for item in minutes if item["at"]]
    for earlier, later in zip(stamps, stamps[1:]):
        if earlier and later and (later - earlier).total_seconds() > 90:
            gaps.append({"from": earlier.isoformat(), "to": later.isoformat(),
                         "seconds": (later - earlier).total_seconds()})
    restarted = bool(restarts) or reset_v or reset_m
    if not minutes:
        verdict = "KHÔNG CÓ DỮ LIỆU"
    elif restarted or over or (violations or 0) > 0 or missed_lines or (missed_steps or 0) > 0:
        verdict = "FAIL"
    else:
        verdict = "PASS"
    coverage = (stamps[-1] - stamps[0]).total_seconds() if len(stamps) >= 2 else None
    return {
        "minutes": len(minutes),
        "maxMinuteUs": max((item["maxUs"] for item in minutes), default=None),
        "minutesOverLimit": len(over),
        "overLimit": over[:20],
        "violationsDelta": violations,
        "missedStepsDelta": missed_steps,
        "baseStepMissedLines": len(missed_lines),
        "baseStepMissedSamples": missed_lines[:10],
        "safeStateEnterLines": safe_enter,
        "restartMarkers": restarts[:10],
        "restarted": restarted,
        "gaps": gaps,
        "coverageSeconds": coverage,
        "untimedLines": untimed,
        "verdict": verdict,
    }


# =============================================================================
# State và HTTP.
# =============================================================================

def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema": STATE_SCHEMA, "createdAt": utc_now_iso()}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != STATE_SCHEMA:
        raise SoakError(f"file state {path} không phải của công cụ này (schema={data.get('schema')})")
    return data


def save_state(path: Path, state: Mapping[str, Any]) -> None:
    """Ghi nguyên tử (tmp + fsync + rename): state là thứ duy nhất nhớ Active cần trả về."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(state, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    handle, temp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    except BaseException:
        if os.path.exists(temp):
            os.unlink(temp)
        raise


class ApiError(SoakError):
    def __init__(self, method: str, path: str, status: int, body: Any):
        self.method, self.path, self.status, self.body = method, path, status, body
        detail = body
        if isinstance(body, Mapping):
            error = body.get("error") if isinstance(body.get("error"), Mapping) else body
            detail = {key: error.get(key) for key in ("code", "detailCode", "field", "message", "args")
                      if key in error}
        text = json.dumps(detail, ensure_ascii=False)[:800] if not isinstance(detail, str) else detail[:800]
        super().__init__(f"{method} {path} → HTTP {status}: {text}")

    @property
    def detail_code(self) -> str | None:
        body = self.body
        if isinstance(body, Mapping):
            error = body.get("error") if isinstance(body.get("error"), Mapping) else body
            value = error.get("detailCode") or error.get("code")
            return str(value) if value else None
        return None


class Client:
    """Client HTTP tối giản cho `/api/v1`. Không bao giờ in/ghi token hay mật khẩu."""

    def __init__(self, base_url: str, user: str, password: str, *, timeout: float = 30.0,
                 run_id: str | None = None, http_log: Path | None = None,
                 opener: Callable[..., Any] | None = None):
        self.base = base_url.rstrip("/")
        self.user = user
        self._password = password
        self.timeout = timeout
        self.run_id = run_id or uuid.uuid4().hex[:12]
        self.http_log = http_log
        self._open = opener or urllib.request.urlopen
        self._token: str | None = None
        self._sequence = 0

    def _correlation(self) -> str:
        self._sequence += 1
        return f"soak3-{self.run_id}-{self._sequence:06d}"

    def _send(self, method: str, path: str, body: Any, headers: Mapping[str, str]) -> tuple[int, Any, dict]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(self.base + "/api/v1" + path, data=data, method=method,
                                         headers=dict(headers))
        if data is not None:
            request.add_header("Content-Type", "application/json")
        started = time.monotonic()
        try:
            with self._open(request, timeout=self.timeout) as response:
                status, raw, response_headers = response.status, response.read(), dict(response.headers)
        except urllib.error.HTTPError as error:
            status, raw, response_headers = error.code, error.read(), dict(error.headers or {})
        except urllib.error.URLError as error:
            raise SoakError(f"{method} {path}: không kết nối được {self.base} ({error.reason})") from None
        elapsed_ms = (time.monotonic() - started) * 1000.0
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = raw.decode("utf-8", "replace")
        if self.http_log is not None and path != "/auth/login":
            record = {"at": utc_now_iso(), "method": method, "path": path, "status": status,
                      "ms": round(elapsed_ms, 1), "request": body,
                      "response": parsed if len(raw or b"") <= 8192 else "(bỏ bớt: > 8 KiB)"}
            with self.http_log.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
        return status, parsed, response_headers

    def login(self) -> None:
        status, body, _ = self._send("POST", "/auth/login",
                                     {"username": self.user, "password": self._password}, {})
        if status != 200 or not isinstance(body, Mapping) or not body.get("token"):
            # Không đưa body vào thông điệp: body đăng nhập có thể mang token.
            raise SoakError(f"đăng nhập {self.base} thất bại: HTTP {status}")
        if body.get("role") not in ("admin", "engineer"):
            raise SoakError(f"tài khoản {self.user} có vai trò {body.get('role')}; cần engineer/admin")
        self._token = str(body["token"])

    def call(self, method: str, path: str, body: Any = None, *, mutation: bool = False,
             if_match: str | None = None, expect: Iterable[int] = (200,)) -> tuple[Any, dict]:
        if self._token is None:
            self.login()
        for attempt in (0, 1):
            headers = {"Authorization": "Bearer " + str(self._token),
                       "X-Correlation-ID": self._correlation()}
            if mutation:
                # UUIDv4 MỚI cho mỗi request: key cố định theo bộ đếm sẽ trùng
                # key của lần chạy trước và backend trả lại bản ghi cũ.
                headers["X-Idempotency-Key"] = str(uuid.uuid4())
            if if_match is not None:
                headers["If-Match"] = if_match
            status, parsed, response_headers = self._send(method, path, body, headers)
            if status == 401 and attempt == 0:
                self.login()
                continue
            if status not in tuple(expect):
                raise ApiError(method, path, status, parsed)
            return parsed, response_headers
        raise SoakError(f"{method} {path}: HTTP 401 sau khi đăng nhập lại")

    def get(self, path: str) -> Any:
        return self.call("GET", path)[0]


def poll(fetch: Callable[[], Any], done: Callable[[Any], bool], *, timeout: float,
         interval: float = 0.5, sleep: Callable[[float], None] = time.sleep,
         clock: Callable[[], float] = time.monotonic) -> tuple[Any, bool]:
    deadline = clock() + timeout
    value = fetch()
    while not done(value):
        if clock() >= deadline:
            return value, False
        sleep(interval)
        value = fetch()
    return value, True


# =============================================================================
# Đọc trạng thái sống.
# =============================================================================

def list_projects(client: Client) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor = None
    for _ in range(100):
        query = "?limit=100" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        page = client.get("/programming/projects" + query)
        items.extend(page.get("items") or [])
        cursor = page.get("nextCursor")
        if not cursor:
            break
    return items


def program_page(client: Client, project_id: str) -> dict[str, dict[str, Any]]:
    page = client.get(f"/programming/projects/{project_id}/programs")
    return {str(item["programId"]): item for item in page.get("items") or []}


def output_points(client: Client) -> dict[str, dict[str, Any]] | None:
    """Ảnh chụp mọi đầu ra ghi được (AO, DO cục bộ, Modbus ghi được): giá trị và mức ưu tiên.

    Đây là bằng chứng hành vi đầu ra của bo trong soak mà không cần SSH. Đọc
    hỏng thì trả `None` (không chặn soak), và báo cáo nói rõ là không đọc được.
    """
    try:
        body = client.get("/points")
    except SoakError:
        return None
    items = body if isinstance(body, list) else (body or {}).get("items") or []
    result = {}
    for item in items:
        kind = item.get("kind")
        writable_ext = kind == "modbus_rtu" and item.get("read_write") == "read_write"
        if kind in ("AO", "DO") or writable_ext:
            result[str(item.get("id"))] = {"kind": kind, "value": item.get("value"),
                                           "priority": item.get("priority"),
                                           "forced": item.get("forced"), "quality": item.get("quality")}
    return result


def capture_snapshot(client: Client, soak_project_id: str | None,
                     with_points: bool = True) -> dict[str, Any]:
    runtime = client.get("/programming/runtime")
    capabilities = client.get("/programming/capabilities")
    task = runtime.get("task") or {}
    snapshot: dict[str, Any] = {
        "capturedAt": utc_now_iso(),
        "observedAt": runtime.get("observedAt"),
        "activeRevisionId": runtime.get("activeRevisionId"),
        "lkgRevisionId": runtime.get("lkgRevisionId"),
        "producerState": runtime.get("producerState"),
        "taskState": runtime.get("taskState"),
        "safeState": runtime.get("safeState"),
        "safeStateNoControllerOnly": runtime.get("safeStateNoControllerOnly"),
        "taskPeriodsMs": capabilities.get("taskPeriodsMs"),
        "task": {key: task.get(key) for key in (
            "taskId", "periodMs", "budgetUs", "state", "runCount", "missedReleaseCount", "lastExecNs",
            "maxExecNs", "overrunCount", "consecutiveOverruns", "baseStepUs", "jitterMaxUs",
            "jitterViolationCount", "missedBaseStepCount", "health", "healthReasons")},
        "programs": {},
    }
    if soak_project_id:
        for program_id, item in program_page(client, soak_project_id).items():
            snapshot["programs"][program_id] = {key: item.get(key) for key in (
                "desiredEnabled", "runtimeState", "runtimeStateSource", "coreState", "enabled", "periodMs",
                "maxExecNs", "missedReleaseCount", "consecutiveMissedRelease", "faultCount",
                "lastFaultCode", "lastRunAgeMs", "health")}
    if with_points:
        snapshot["outputs"] = output_points(client)
    return snapshot


def set_intent(client: Client, project_id: str, program_id: str, enabled: bool) -> dict[str, Any]:
    body, _ = client.call("PUT", f"/programming/projects/{project_id}/programs/{program_id}/runtime-intent",
                          {"schemaVersion": "1.0", "desiredEnabled": enabled}, mutation=True)
    resource = (body or {}).get("resource") or {}
    return {"projectId": project_id, "programId": program_id, "desiredEnabled": resource.get("desiredEnabled"),
            "generation": resource.get("generation"), "at": utc_now_iso()}


def wait_operation(client: Client, operation_id: str, timeout: float) -> dict[str, Any]:
    value, finished = poll(lambda: client.get(f"/programming/operations/{operation_id}"),
                           lambda item: (item or {}).get("state") in OPERATION_TERMINAL, timeout=timeout)
    result = dict(value or {})
    if not finished:
        result["timedOut"] = True
    return result


def wait_program_states(client: Client, project_id: str, program_ids: Iterable[str], want: str,
                        timeout: float) -> tuple[dict[str, Any], bool]:
    wanted = list(program_ids)

    def ready(page: Mapping[str, Any]) -> bool:
        return all((page.get(pid) or {}).get("runtimeState") == want and
                   (page.get(pid) or {}).get("runtimeStateSource") == "CORE_LIVE" for pid in wanted)

    return poll(lambda: program_page(client, project_id), ready, timeout=timeout)


# =============================================================================
# Lệnh con.
# =============================================================================

def require(condition: bool, message: str) -> None:
    if not condition:
        raise SoakError(message)


def cmd_prepare(client: Client, state: dict[str, Any], args: argparse.Namespace,
                save: Callable[[], None]) -> int:
    # Niêm phong revision mới giữa lúc soak đang chạy sẽ đổi `prepare.revisionId`,
    # và `stop` sẽ không còn nhận ra Active là revision thử nữa.
    running = ((state.get("start") or {}).get("operation") or {}).get("state") == "SUCCEEDED"
    require(not (running and not (state.get("stop") or {}).get("at")),
            "soak của file state này đang chạy: `stop` trước, hoặc dùng file state mới")
    capabilities = client.get("/programming/capabilities")
    periods = sorted(int(value) for value in capabilities.get("taskPeriodsMs") or [])
    require(periods == sorted(PERIODS_MS),
            f"capabilities.taskPeriodsMs={periods} khác tập ADR-061 {list(PERIODS_MS)}: web/Core chưa có ADR-061")
    if capabilities.get("targetState") != "READY":
        print(f"CẢNH BÁO: targetState={capabilities.get('targetState')}; Check vẫn chạy nhưng Commission cần READY")
    plan_budget = budget_plan(PERIODS_MS)
    require(plan_budget["ok"], f"tập Program thử vượt trần profile: {plan_budget['checks']}")

    project_id = state.get("projectId") or args.project_id
    if not project_id:
        matches = [item for item in list_projects(client) if item.get("name") == args.project_name]
        require(len(matches) <= 1, f"có {len(matches)} Project tên {args.project_name}; chỉ định --project-id")
        if matches:
            project_id = matches[0]["projectId"]
            print(f"Dùng lại Project {args.project_name} ({project_id})")
    if not project_id:
        body, _ = client.call("POST", "/programming/projects", {
            "schemaVersion": "1.0", "name": args.project_name,
            "description": f"{EVIDENCE_ID} soak lần 3 ADR-061/VS-PROG-009: 8 Program đếm, không output"},
            mutation=True, expect=(201,))
        project_id = body["resource"]["projectId"]
        print(f"Đã tạo Project {args.project_name} ({project_id})")
    state["projectId"] = project_id
    state["projectName"] = args.project_name
    save()

    project = client.get(f"/programming/projects/{project_id}")
    draft = project.get("draft") or {}
    problems = unexpected_draft_content(draft)
    require(not problems, "Draft của Project thử có nội dung không thuộc revision thử — không tự xoá:\n  "
            + "\n  ".join(problems) + "\nDọn tay, hoặc dùng --project-name khác.")
    plan = draft_program_plan(draft, lambda: str(uuid.uuid4()))
    state["programs"] = plan
    save()

    base = project.get("baseRevisionId") or project.get("draftRevisionId")
    client.call("PATCH", f"/programming/projects/{project_id}/draft", {
        "schemaVersion": "1.0", "baseRevisionId": base, "operations": build_draft_operations(plan)},
        mutation=True, if_match=project.get("etag"))
    project = client.get(f"/programming/projects/{project_id}")
    latest = project.get("latestCheck") or {}
    revision_id = None
    check_id = None
    if (project.get("dirty") is False and latest.get("state") == "PASSED"
            and latest.get("revisionId") == project.get("baseRevisionId")):
        revision_id, check_id = latest["revisionId"], latest["checkId"]
        print(f"Draft trùng revision {revision_id} đã Check PASSED; dùng lại, không niêm phong mới")
    elif project.get("dirty") is False and project.get("draftSequence") is not None:
        revision_id = project.get("baseRevisionId")
        print(f"Draft trùng revision {revision_id}; Check lại revision đó")
    else:
        body, _ = client.call("POST", f"/programming/projects/{project_id}/draft/revisions", {
            "schemaVersion": "1.0", "baseRevisionId": project.get("baseRevisionId") or project.get("draftRevisionId"),
            "label": f"SOAK-ADR061 8P {utc_now_iso()[:19]}",
            "comment": f"{EVIDENCE_ID} soak lần 3: 8 Program {list(PERIODS_MS)} ms, không binding"},
            mutation=True, if_match=project.get("etag"), expect=(201,))
        revision_id = body["resource"]["revisionId"]
        print(f"Đã niêm phong revision {revision_id}")

    if check_id is None:
        accepted, _ = client.call("POST", f"/programming/revisions/{revision_id}/checks",
                                  {"schemaVersion": "1.0", "targetProfile": TARGET_PROFILE},
                                  mutation=True, expect=(202,))
        check_id = accepted["checkId"]
        started = time.monotonic()
        check, finished = poll(lambda: client.get(f"/programming/checks/{check_id}"),
                               lambda item: (item or {}).get("state") in CHECK_TERMINAL,
                               timeout=args.check_timeout)
        seconds = round(time.monotonic() - started, 2)
        require(finished, f"Check {check_id} chưa xong sau {args.check_timeout} s (state={check.get('state')})")
        if check.get("state") != "PASSED":
            for diagnostic in check.get("diagnostics") or []:
                print("  " + json.dumps(diagnostic, ensure_ascii=False))
            state["prepare"] = {"revisionId": revision_id, "checkId": check_id, "checkState": check.get("state"),
                                "at": utc_now_iso()}
            save()
            raise SoakError(f"Check {check_id} của revision {revision_id}: {check.get('state')}")
        print(f"Check {check_id} PASSED sau {seconds} s")
    revision = client.get(f"/programming/revisions/{revision_id}")
    state["prepare"] = {"revisionId": revision_id, "checkId": check_id, "checkState": "PASSED",
                        "sequence": revision.get("sequence"), "contentHash": revision.get("contentHash"),
                        "budget": plan_budget, "at": utc_now_iso()}
    save()
    print()
    print("Revision thử (8 Program, không binding):")
    for item in plan:
        print(f"  {item['name']:<12} {item['periodMs']:>6} ms  programId={item['programId']}")
    print(f"Ngân sách (ADR-061 4.3, kịch bản mọi Program cùng release): {plan_budget['programBudgetUs']} µs/Program, "
          f"tổng {plan_budget['worstCaseStepUs']} µs < {plan_budget['stepBudgetUs']} µs")
    print(f"REVISION_ID={revision_id}")
    return EXIT_OK


def _owner_project(projects: Sequence[Mapping[str, Any]], active: str | None) -> Mapping[str, Any] | None:
    if not active:
        return None
    owners = [item for item in projects if item.get("activeRevisionId") == active]
    return owners[0] if len(owners) == 1 else None


def refresh_operation(client: Client, state: dict[str, Any], save: Callable[[], None]) -> None:
    """Operation Commission của start chưa có kết quả cuối (mạng đứt giữa chừng): đọc lại."""
    record = state.get("start") or {}
    operation = record.get("operation") or {}
    if operation.get("operationId") and operation.get("state") not in OPERATION_TERMINAL:
        record["operation"] = client.get(f"/programming/operations/{operation['operationId']}")
        save()


def cmd_start(client: Client, state: dict[str, Any], args: argparse.Namespace,
              save: Callable[[], None]) -> int:
    refresh_operation(client, state, save)
    prepare = state.get("prepare") or {}
    require(prepare.get("checkState") == "PASSED" and prepare.get("revisionId"),
            "chưa có revision thử PASSED trong file state: chạy `prepare` trước")
    previous = state.get("start") or {}
    previous_ok = (previous.get("operation") or {}).get("state") == "SUCCEEDED"
    require(not (previous_ok and not (state.get("stop") or {}).get("at")),
            "file state đã có một lần start thành công chưa stop: chạy `stop` trước, hoặc dùng file state mới")
    require(previous_ok or not (previous.get("released") or previous.get("soakIntents"))
            or previous.get("undone"),
            "lần start trước dừng giữa chừng và còn intent đã sửa chưa trả: chạy `stop --intents-only` trước")
    soak_revision = prepare["revisionId"]
    soak_project = state["projectId"]
    programs = state["programs"]

    check = client.get(f"/programming/checks/{prepare['checkId']}")
    require(check.get("state") == "PASSED" and check.get("revisionId") == soak_revision,
            f"Check {prepare['checkId']} không còn PASSED cho revision thử")

    # 1. Trạng thái sống NGAY trước khi đổi (audit lượt 3, 05:37: không ghim cứng ID).
    before = capture_snapshot(client, soak_project)
    active_before = before["activeRevisionId"]
    require(active_before != soak_revision,
            "Active hiện tại ĐÃ là revision thử: không biết Active gốc để trả về — dừng")
    projects = list_projects(client)
    owner = _owner_project(projects, active_before)
    owner_programs = program_page(client, owner["projectId"]) if owner else {}
    record: dict[str, Any] = {
        "at": utc_now_iso(), "outputsMode": args.outputs, "activeBefore": active_before,
        "lkgBefore": before.get("lkgRevisionId"), "ownerProjectId": owner.get("projectId") if owner else None,
        "ownerProjectName": owner.get("name") if owner else None,
        "ownerIntentsBefore": {pid: {"desiredEnabled": item.get("desiredEnabled"),
                                     "generation": item.get("generation"),
                                     "runtimeState": item.get("runtimeState"),
                                     "runtimeStateSource": item.get("runtimeStateSource")}
                               for pid, item in owner_programs.items()},
        "soakIntentsBefore": {pid: item.get("desiredEnabled") for pid, item in before["programs"].items()},
        "snapshotBefore": before, "released": [],
    }
    state["start"] = record
    state.pop("stop", None)
    save()
    print(f"Active trước soak: {active_before} (Project {record['ownerProjectName'] or '—'})")

    # 2–4 đổi trạng thái thật. Bất kỳ lỗi nào ở giữa (mạng, HTTP, Ctrl-C) đều
    # phải trả intent đã sửa về như cũ; Active chỉ đổi khi Commission SUCCEEDED.
    try:
        operation = _switch_to_soak(client, state, args, save, owner, owner_programs)
    except BaseException:
        if (record.get("operation") or {}).get("operationId"):
            # Commission ĐÃ được nhận: có thể vẫn thành công sau lưng ta. Không
            # tự trả intent; lần chạy sau đọc lại operation rồi mới quyết.
            print("Commission đã được nhận nhưng chưa rõ kết quả; chạy lại `report` hoặc `stop` "
                  "(script đọc lại operation trước khi làm gì)", file=sys.stderr)
        else:
            _undo_start_intents(client, state, save)
        raise
    if operation.get("state") != "SUCCEEDED":
        print(f"Commission KHÔNG thành công: {json.dumps(operation, ensure_ascii=False)[:600]}")
        _undo_start_intents(client, state, save)
        return EXIT_FAIL
    print(f"Commission {operation.get('operationId')} SUCCEEDED; Active = {soak_revision}")

    # 5. Mốc bắt đầu và bộ đếm C2–C4 ban đầu.
    _, running = wait_program_states(client, soak_project, [item["programId"] for item in programs],
                                     "RUNNING", timeout=30)
    if not running:
        print("CẢNH BÁO: chưa đủ 8 Program RUNNING sau 30 s; report sẽ FAIL C3 nếu tình trạng kéo dài")
    baseline = capture_snapshot(client, soak_project)
    record["baseline"] = baseline
    record["startedAt"] = baseline.get("observedAt")
    save()
    print(f"Mốc bắt đầu (Core observedAt) {baseline.get('observedAt')}; safeState={baseline.get('safeState')} "
          f"safeStateNoControllerOnly={baseline.get('safeStateNoControllerOnly')}")
    task = baseline.get("task") or {}
    print(f"Bộ đếm ban đầu: runCount={task.get('runCount')} overrun={task.get('overrunCount')} "
          f"missedRelease={task.get('missedReleaseCount')} missedBaseStep={task.get('missedBaseStepCount')} "
          f"jitterViolation={task.get('jitterViolationCount')}")
    print("Lấy journal cho report: journalctl -u mkddc-core --utc -o short-iso-precise "
          f"--since '{(parse_utc(record['startedAt']) or dt.datetime.now(dt.timezone.utc)).strftime('%Y-%m-%d %H:%M:%S')}'")
    return EXIT_OK


def commission_source(active_before: str | None, owner_project_id: str | None, soak_project_id: str) -> str:
    """`from` cho `GET /revisions/{from}/changes/{to}` trước Commission.

    Active thuộc Project KHÁC Project thử (ca thường của soak): đường HTTP cố ý
    trả 400 cho cặp khác Project (`ISS-PGUI-01`), còn đường Commission hạ ca đó
    về "thay mới toàn bộ" (`ISS-PRG-CTRL-001`) và test khoá hai `impactRef` trùng
    nhau. Vì vậy client phải hỏi `none`, đúng như FE làm.
    """
    if not active_before:
        return "none"
    if owner_project_id is not None and owner_project_id != soak_project_id:
        return "none"
    return active_before


def _switch_to_soak(client: Client, state: dict[str, Any], args: argparse.Namespace,
                    save: Callable[[], None], owner: Mapping[str, Any] | None,
                    owner_programs: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    record = state["start"]
    prepare = state["prepare"]
    soak_project = state["projectId"]
    soak_revision = prepare["revisionId"]
    programs = state["programs"]
    active_before = record["activeBefore"]

    # 2. Đầu ra về trạng thái an toàn trước khi đổi gói (runbook "Hành vi đầu ra").
    #    Core trước F20 KHÔNG rút proposal mức 5 của Program thuộc gói cũ khi đổi
    #    gói; tắt intent thì có (TASK-PROG-401 rút mức 5 cục bộ, F06 nhả EXT về
    #    safe_value). Core có F20 tự rút tại boundary đổi gói, nên bước này thành
    #    thừa nhưng vô hại; giữ nó để kết quả không phụ thuộc bản Core trên bo.
    if args.outputs == "safe" and active_before:
        require(owner is not None,
                "không xác định được Project sở hữu Active; không tắt được Program của nó. "
                "Dùng --outputs hold nếu chấp nhận đổi gói mà không tắt intent trước "
                "(Core trước F20 giữ giá trị cuối của Active cũ)")
        live_enabled = [pid for pid, item in owner_programs.items()
                        if item.get("desiredEnabled") is True and item.get("runtimeStateSource") == "CORE_LIVE"]
        for program_id in live_enabled:
            record["released"].append(set_intent(client, owner["projectId"], program_id, False))
            save()
        if live_enabled:
            _, stopped = wait_program_states(client, owner["projectId"], live_enabled, "DISABLED", timeout=20)
            require(stopped, "Program của Active chưa về DISABLED sau 20 s")
            time.sleep(1.0)
        record["snapshotAfterRelease"] = capture_snapshot(client, soak_project)
        save()
        print(f"Đã tắt intent {len(live_enabled)} Program của Active để đầu ra về trạng thái an toàn; "
              f"safeState={record['snapshotAfterRelease']['safeState']}")

    # 3. Intent Enable cho 8 Program thử, ghi TRƯỚC Commission để ACTIVATE mang
    #    theo (ADR-062): 8 Program RUNNING ngay tại boundary kích hoạt.
    require(len(programs) <= MAX_PROGRAMS_ENABLED,
            f"{len(programs)} Program thử vượt trần {MAX_PROGRAMS_ENABLED} Program bật đồng thời")
    record["soakIntents"] = []
    for item in programs:
        record["soakIntents"].append(set_intent(client, soak_project, item["programId"], True))
        save()

    # 4. Commission sang revision thử, khoá bằng expectedActiveRevisionId.
    source = commission_source(active_before, record.get("ownerProjectId"), soak_project)
    changes = client.get(f"/programming/revisions/{source}/changes/{soak_revision}")
    impact = changes.get("impact") or {}
    acknowledgements = impact_acknowledgements(impact)
    record["impactFrom"] = source
    record["impact"] = {key: (impact.get(key) or {}).get("status") for key in IMPACT_KEYS}
    record["acknowledgements"] = acknowledgements
    save()
    try:
        accepted, _ = client.call("POST", "/programming/operations/commission", {
            "schemaVersion": "1.0", "revisionId": soak_revision, "expectedActiveRevisionId": active_before,
            "checkId": prepare["checkId"], "impactRef": impact.get("impactRef"),
            "acknowledgements": acknowledgements, "cutover": {"requested": "PROGRAM_ONLY"}},
            mutation=True, expect=(202,))
        record["operation"] = {"operationId": accepted.get("operationId"), "state": "QUEUED"}
        save()
        operation = wait_operation(client, accepted["operationId"], timeout=args.operation_timeout)
    except ApiError as error:
        operation = {"state": "REJECTED", "error": str(error)}
    record["operation"] = operation
    save()
    return operation


def _undo_start_intents(client: Client, state: dict[str, Any], save: Callable[[], None]) -> None:
    """Commission không thành: Active không đổi. Trả intent đã sửa về như trước (cố hết từng mục)."""
    record = state["start"]
    failures = []
    for item in record.get("soakIntents") or []:
        before = (record.get("soakIntentsBefore") or {}).get(item["programId"])
        try:
            set_intent(client, item["projectId"], item["programId"], bool(before))
        except SoakError as error:
            failures.append(f"{item['programId']}: {error}")
    for item in record.get("released") or []:
        try:
            set_intent(client, item["projectId"], item["programId"], True)
        except SoakError as error:
            failures.append(f"{item['programId']}: {error}")
    record["undoFailures"] = failures
    if not failures:
        record["undone"] = utc_now_iso()
    save()
    if failures:
        print("CẢNH BÁO: chưa trả được intent:\n  " + "\n  ".join(failures)
              + "\nChạy lại `stop --intents-only` khi web-api trả lời.")
    else:
        print("Đã trả intent của Program thử và của Active về như trước start")


def print_report(evaluation: Mapping[str, Any], journal: Mapping[str, Any] | None,
                 outputs: tuple[Any, Any, Any] | None, out=sys.stdout) -> None:
    write = lambda text="": print(text, file=out)  # noqa: E731
    write(f"Cửa sổ: {format_duration(evaluation['windowSeconds'])} "
          f"({'đủ' if evaluation['soakComplete'] else 'chưa đủ'} 24 h); base step Core đã chạy "
          f"{evaluation['baseSteps']} / kỳ vọng theo đồng hồ {evaluation['expectedBaseSteps']}")
    for note in evaluation["notes"]:
        write(f"LƯU Ý: {note}")
    write()
    write("| Tiêu chí | Kết quả | Chi tiết |")
    write("|---|---|---|")
    for key, item in evaluation["criteria"].items():
        write(f"| {key} | {item['verdict']} | {item['detail']} |")
    if journal is not None:
        write(f"| C4 (journal) | {journal['verdict']} | {journal['minutes']} phút; tối đa theo phút "
              f"{journal['maxMinuteUs']} µs; {journal['minutesOverLimit']} phút > {JITTER_LIMIT_US} µs; "
              f"violations {signed(journal['violationsDelta'])}; "
              f"missed_steps {signed(journal['missedStepsDelta'])}; "
              f"{journal['baseStepMissedLines']} dòng base_step_missed; "
              f"{len(journal['gaps'])} khoảng hụt log |")
    write()
    write("| Program | Chu kỳ | Trạng thái | Chu kỳ đã chạy | Ngưỡng VS-PROG-009 | Missed release | VS-PROG-009 |")
    write("|---|---|---|---|---|---|---|")
    for row in evaluation["programs"]:
        extra = ""
        if row["remainingSeconds"]:
            extra = f" (còn ~{format_duration(row['remainingSeconds'])})"
        write(f"| {row['name']} | {row['periodMs']} ms | {row['runtimeState']} | {row['cycles']} | "
              f"{row['requiredCycles']} | {signed(row['missedReleaseDelta'])} | {row['status']}{extra} |")
    write()
    write(f"KẾT LUẬN SOAK: {evaluation['overall']}")
    if outputs is not None:
        before, after_start, now = outputs
        if now is None:
            write("Đầu ra: không đọc được /api/v1/points")
        else:
            changed = [key for key in sorted(now) if (before or {}).get(key, {}).get("value") != now[key].get("value")]
            write(f"Đầu ra ghi được: {len(now)} điểm; {len(changed)} điểm khác giá trị lúc trước start")
            for key in changed[:40]:
                old = (before or {}).get(key, {})
                mid = (after_start or {}).get(key, {})
                write(f"  {key}: trước {old.get('value')} ({old.get('priority')}) → sau start "
                      f"{mid.get('value')} ({mid.get('priority')}) → hiện {now[key].get('value')} "
                      f"({now[key].get('priority')})")


def cmd_report(client: Client, state: dict[str, Any], args: argparse.Namespace,
               save: Callable[[], None]) -> int:
    refresh_operation(client, state, save)
    record = state.get("start") or {}
    require((record.get("operation") or {}).get("state") == "SUCCEEDED",
            "file state chưa có lần start thành công")
    if record.get("baseline") is None:
        # Commission thành công sau lưng một lần start bị đứt: mốc chụp MUỘN,
        # cửa sổ ngắn hơn thực tế — bảo thủ, không bao giờ cho PASS sớm.
        record["baseline"] = capture_snapshot(client, state["projectId"])
        record["startedAt"] = record["baseline"].get("observedAt")
        record["baselineLate"] = True
        save()
        print("CẢNH BÁO: start không chụp được mốc; mốc bắt đầu lấy từ lần report này")
    baseline = record["baseline"]
    current = capture_snapshot(client, state["projectId"])
    evaluation = evaluate_window(baseline, current, state["programs"], state["prepare"]["revisionId"])
    journal = None
    if args.journal_file:
        since = parse_utc(record.get("startedAt"))
        with open(args.journal_file, encoding="utf-8", errors="replace") as stream:
            journal = parse_journal(stream, since=since, year=(since.year if since else None),
                                    baseline_violations=(baseline.get("task") or {}).get("jitterViolationCount"),
                                    baseline_missed_steps=(baseline.get("task") or {}).get("missedBaseStepCount"))
    outputs = ((record.get("snapshotBefore") or {}).get("outputs"), baseline.get("outputs"), current.get("outputs"))
    print(f"Revision thử {state['prepare']['revisionId']}; Active trước soak {record.get('activeBefore')}; "
          f"chế độ đầu ra {record.get('outputsMode')}; safeState hiện {current.get('safeState')} "
          f"(chỉ T7: {current.get('safeStateNoControllerOnly')})")
    print_report(evaluation, journal, outputs)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps({"evaluation": evaluation, "journal": journal,
                                                   "current": current}, ensure_ascii=False, indent=1) + "\n",
                                       encoding="utf-8")
    failed = evaluation["overall"] == "HỎNG" or (journal is not None and journal["verdict"] == "FAIL")
    return EXIT_FAIL if failed else EXIT_OK


def cmd_stop(client: Client, state: dict[str, Any], args: argparse.Namespace,
             save: Callable[[], None]) -> int:
    refresh_operation(client, state, save)
    record = state.get("start") or {}
    started = (record.get("operation") or {}).get("state") == "SUCCEEDED"
    require(started or args.intents_only,
            "file state chưa có lần start thành công: không có gì để trả về (lần start dở dang: `stop --intents-only`)")
    soak_revision = state["prepare"]["revisionId"]
    soak_project = state["projectId"]
    active_before = record.get("activeBefore")
    stop = state.setdefault("stop", {})
    stop.setdefault("attempts", [])
    attempt: dict[str, Any] = {"at": utc_now_iso(), "intentsOnly": bool(args.intents_only)}
    stop["attempts"].append(attempt)
    if args.intents_only:
        active_now = client.get("/programming/runtime").get("activeRevisionId")
        attempt["activeNow"] = active_now
        require(active_now != soak_revision,
                "revision thử vẫn là Active: dùng `stop` (không --intents-only) để Restore về Active gốc")

    # Số đo cuối trước khi đổi gì, để không mất nếu quên chạy report.
    if not args.intents_only:
        current = capture_snapshot(client, soak_project)
        attempt["activeNow"] = current.get("activeRevisionId")
        if record.get("baseline") and current.get("activeRevisionId") == soak_revision:
            stop["final"] = evaluate_window(record["baseline"], current, state["programs"], soak_revision)
            stop["finalSnapshot"] = current
        save()
        if current.get("activeRevisionId") != soak_revision:
            attempt["result"] = "REFUSED_ACTIVE_CHANGED"
            save()
            print(f"DỪNG: Active hiện tại là {current.get('activeRevisionId')}, không phải revision thử "
                  f"{soak_revision}. Người khác đã đổi Active; KHÔNG Restore, KHÔNG ghi đè.")
            if record.get("released"):
                print("Intent các Program của Active gốc vẫn đang TẮT do start --outputs safe. Khi đã rõ "
                      "chủ Active hiện tại, chạy `stop --intents-only` để bật lại đúng những intent đó.")
            return EXIT_REFUSED
        require(active_before is not None,
                "Không có Active trước soak (thiết bị chưa Commission gói nào): không có gì để Restore về. "
                "Tắt 8 Program thử bằng intent nếu cần.")

    # 1. Bật lại intent của Active gốc mà start đã tắt — chỉ khi chưa ai đổi nó
    #    (generation còn đúng bằng lần tắt). Ghi TRƯỚC Restore để ACTIVATE mang theo.
    owner_project = record.get("ownerProjectId")
    restored_intents = []
    if record.get("released"):
        current_owner = program_page(client, owner_project)
        for item in record["released"]:
            live = current_owner.get(item["programId"]) or {}
            if live.get("desiredEnabled") is True:
                restored_intents.append({"programId": item["programId"], "result": "đã bật sẵn"})
                continue
            if item.get("generation") is not None and live.get("generation") != item.get("generation"):
                restored_intents.append({"programId": item["programId"],
                                         "result": f"BỎ QUA: generation {live.get('generation')} khác lần tắt "
                                                   f"{item.get('generation')} (người khác đã đổi)"})
                continue
            restored_intents.append({"programId": item["programId"],
                                     "result": set_intent(client, owner_project, item["programId"], True)})
        attempt["ownerIntents"] = restored_intents
        save()
    if args.intents_only:
        attempt["soakIntents"] = [set_intent(client, soak_project, item["programId"],
                                             bool((record.get("soakIntentsBefore") or {}).get(item["programId"])))
                                  for item in record.get("soakIntents") or []]
        attempt["result"] = "INTENTS_ONLY"
        record["undone"] = utc_now_iso()
        save()
        for item in restored_intents:
            print(f"  intent Active gốc {item['programId']}: {item['result']}")
        print(f"Đã trả intent {len(attempt['soakIntents'])} Program thử về như trước start")
        return EXIT_OK

    # 2. Restore về Active gốc, khoá bằng expectedActiveRevisionId = revision thử.
    acknowledgements = [ACK_MODBUS_SLOT_MISMATCH] if args.ack_modbus_slot_mismatch else []
    try:
        accepted, _ = client.call("POST", "/programming/operations/restore", {
            "schemaVersion": "1.0", "revisionId": active_before, "expectedActiveRevisionId": soak_revision,
            "reason": f"{EVIDENCE_ID} soak lần 3: trả về Active trước soak", "acknowledgements": acknowledgements},
            mutation=True, expect=(202,))
        operation = wait_operation(client, accepted["operationId"], timeout=args.operation_timeout)
    except ApiError as error:
        attempt["result"] = "RESTORE_REJECTED"
        attempt["error"] = str(error)
        save()
        print(f"Restore bị từ chối: {error}")
        if error.detail_code and "MAP" in error.detail_code.upper():
            print("Bố cục slot Modbus đã đổi từ lúc Commission Active gốc. Đọc cảnh báo lệch slot, rồi nếu "
                  "chấp nhận thì chạy lại `stop --ack-modbus-slot-mismatch` (được ghi vào audit).")
        return EXIT_FAIL
    attempt["operation"] = operation
    save()
    if operation.get("state") != "SUCCEEDED":
        attempt["result"] = "RESTORE_FAILED"
        save()
        print(f"Restore KHÔNG thành công: {json.dumps(operation, ensure_ascii=False)[:600]}")
        return EXIT_FAIL

    # 3. Kiểm đã trả về đúng và Program gốc chạy lại.
    after = capture_snapshot(client, soak_project)
    attempt["snapshotAfter"] = after
    ok = after.get("activeRevisionId") == active_before
    expected_running = [pid for pid, item in (record.get("ownerIntentsBefore") or {}).items()
                        if item.get("desiredEnabled") is True and item.get("runtimeStateSource") == "CORE_LIVE"]
    if owner_project and expected_running:
        page, running = wait_program_states(client, owner_project, expected_running, "RUNNING", timeout=30)
        attempt["ownerRunning"] = running
        if not running:
            print("CẢNH BÁO: Program gốc chưa RUNNING đủ sau 30 s: "
                  + ", ".join(f"{pid}={(page.get(pid) or {}).get('runtimeState')}" for pid in expected_running))

    # 4. Trả intent 8 Program thử về như trước start (thường là chưa có/false).
    attempt["soakIntents"] = [set_intent(client, soak_project, item["programId"],
                                         bool((record.get("soakIntentsBefore") or {}).get(item["programId"])))
                              for item in state["programs"]]
    attempt["result"] = "RESTORED" if ok else "RESTORED_MISMATCH"
    stop["at"] = utc_now_iso()
    save()
    print(f"Restore {operation.get('operationId')} SUCCEEDED; Active = {after.get('activeRevisionId')} "
          f"({'đúng' if ok else 'KHÁC'} Active trước soak {active_before}); safeState={after.get('safeState')}")
    if stop.get("final"):
        print(f"Kết luận soak lúc dừng: {stop['final']['overall']} sau {format_duration(stop['final']['windowSeconds'])}")
    return EXIT_OK if ok else EXIT_FAIL


# =============================================================================
# CLI.
# =============================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Soak 24 h lần 3 ADR-061 / VS-PROG-009: revision thử 8 Program thay Active rồi trả về.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Credential: MKDDC_WEB_URL, MKDDC_WEB_USER, MKDDC_WEB_PASSWORD (ưu tiên hơn --password).")
    parser.add_argument("--base-url", default=os.environ.get("MKDDC_WEB_URL"),
                        help="gốc web-api, ví dụ http://127.0.0.1:8082 (mặc định $MKDDC_WEB_URL)")
    parser.add_argument("--user", default=os.environ.get("MKDDC_WEB_USER"),
                        help="tài khoản engineer/admin (mặc định $MKDDC_WEB_USER)")
    parser.add_argument("--password", default=None,
                        help="mật khẩu; nên dùng $MKDDC_WEB_PASSWORD để không lộ trong lịch sử shell")
    parser.add_argument("--state", default="soak-adr061-state.json",
                        help="file state JSON (không chứa mật khẩu/token)")
    parser.add_argument("--http-log", default=None,
                        help="ghi request/response (không kèm header/token) ra file JSONL")
    parser.add_argument("--timeout", type=float, default=30.0, help="timeout mỗi request HTTP (s)")
    commands = parser.add_subparsers(dest="command", required=True)

    prepare = commands.add_parser("prepare", help="tạo/cập nhật Project thử, niêm phong, Check; không Commission")
    prepare.add_argument("--project-name", default=PROJECT_NAME_DEFAULT)
    prepare.add_argument("--project-id", default=None, help="dùng Project có sẵn thay vì tìm theo tên")
    prepare.add_argument("--check-timeout", type=float, default=180.0)

    start = commands.add_parser("start", help="chụp trạng thái sống, Commission revision thử, ghi mốc bắt đầu")
    start.add_argument("--outputs", choices=("safe", "hold"), default="safe",
                       help="safe: tắt intent Program của Active trước để đầu ra về an toàn (mặc định); "
                            "hold: đổi gói ngay, không tắt intent trước. Core trước F20 giữ giá trị "
                            "cuối của Active cũ; Core có F20 tự rút đầu ra đó tại boundary đổi gói")
    start.add_argument("--operation-timeout", type=float, default=120.0)

    report = commands.add_parser("report", help="bảng PASS/FAIL C1–C4 và VS-PROG-009 theo cửa sổ từ start")
    report.add_argument("--journal-file", default=None,
                        help="bản xuất journalctl -u mkddc-core (--utc -o short-iso-precise hoặc -o json)")
    report.add_argument("--json-out", default=None, help="ghi kết quả đánh giá ra file JSON")

    stop = commands.add_parser("stop", help="Restore về Active trước soak nếu Active vẫn là revision thử")
    stop.add_argument("--operation-timeout", type=float, default=120.0)
    stop.add_argument("--ack-modbus-slot-mismatch", action="store_true",
                      help="xác nhận TƯỜNG MINH đã đọc cảnh báo lệch slot Modbus khi Restore (ghi audit)")
    stop.add_argument("--intents-only", action="store_true",
                      help="chỉ bật lại intent Active gốc mà start đã tắt; không Restore")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.base_url:
        parser.error("thiếu --base-url hoặc $MKDDC_WEB_URL")
    if not args.user:
        parser.error("thiếu --user hoặc $MKDDC_WEB_USER")
    password = args.password or os.environ.get("MKDDC_WEB_PASSWORD")
    if not password:
        if not sys.stdin.isatty():
            parser.error("thiếu $MKDDC_WEB_PASSWORD")
        password = getpass.getpass(f"Mật khẩu {args.user}: ")
    state_path = Path(args.state)
    handlers = {"prepare": cmd_prepare, "start": cmd_start, "report": cmd_report, "stop": cmd_stop}
    try:
        state = load_state(state_path)
        client = Client(args.base_url, args.user, password, timeout=args.timeout,
                        http_log=Path(args.http_log) if args.http_log else None)
        state.setdefault("baseUrl", args.base_url)
        return handlers[args.command](client, state, args, lambda: save_state(state_path, state))
    except SoakError as error:
        print(f"LỖI: {error}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
