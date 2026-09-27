"""Test không network cho `scripts/programming_soak_adr061.py` (soak lần 3, ADR-061/VS-PROG-009).

Phần lớn là phần tính thuần: revision thử, ngân sách, ngưỡng `VS-PROG-009`,
đánh giá cửa sổ C1–C4 và đọc journal. Phần HTTP chỉ dùng client giả: test
không được chạm bo hay web-api thật.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import unittest.mock
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "programming_soak_adr061.py"
SPEC = importlib.util.spec_from_file_location("programming_soak_adr061", SCRIPT)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - lỗi môi trường import
    raise RuntimeError(f"không import được {SCRIPT}")
soak = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = soak
SPEC.loader.exec_module(soak)

SOAK_REVISION = "11111111-1111-4111-8111-111111111111"
ACTIVE_REVISION = "22222222-2222-4222-8222-222222222222"
SOAK_PROJECT = "33333333-3333-4333-8333-333333333333"
OWNER_PROJECT = "44444444-4444-4444-8444-444444444444"
OWNER_PROGRAM = "55555555-5555-4555-8555-555555555555"


def program_specs() -> list[dict[str, Any]]:
    return [{"periodMs": period, "name": soak.program_name(period),
             "objectId": f"00000000-0000-4000-8000-{period:012d}",
             "programId": f"00000000-0000-4000-8000-{period:012d}"} for period in soak.PERIODS_MS]


def snapshot(observed_at: str, *, run_count: int, jitter: int = 0, missed_step: int = 0,
             overrun: int = 0, task_missed: int = 0, missed: dict[int, int] | None = None,
             states: dict[int, str] | None = None, active: str = SOAK_REVISION,
             base_step_us: int | None = 10000, periods: dict[int, int] | None = None) -> dict[str, Any]:
    missed = missed or {}
    states = states or {}
    periods = periods or {}
    return {
        "observedAt": observed_at, "activeRevisionId": active, "taskPeriodsMs": list(soak.PERIODS_MS),
        "task": {"periodMs": 10, "budgetUs": 1999, "runCount": run_count, "missedReleaseCount": task_missed,
                 "overrunCount": overrun, "jitterViolationCount": jitter, "missedBaseStepCount": missed_step,
                 "baseStepUs": base_step_us, "jitterMaxUs": 60, "maxExecNs": 180000},
        "programs": {spec["programId"]: {
            "runtimeState": states.get(spec["periodMs"], "RUNNING"), "enabled": True,
            "periodMs": periods.get(spec["periodMs"], spec["periodMs"]),
            "missedReleaseCount": missed.get(spec["periodMs"], 0), "faultCount": 0,
            "maxExecNs": 4000, "lastRunAgeMs": 3} for spec in program_specs()},
    }


START = "2026-09-27T10:00:00.000Z"


def at(seconds: float) -> str:
    moment = dt.datetime(2026, 9, 27, 10, 0, 0, tzinfo=dt.timezone.utc) + dt.timedelta(seconds=seconds)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class ProfileAndPlanTests(unittest.TestCase):
    def test_constants_match_product_profile(self) -> None:
        profile = json.loads((ROOT / "contracts" / "programming" / "product_profile_v2.json").read_text("utf-8"))
        scheduler = profile["scheduler"]
        self.assertEqual(list(soak.PERIODS_MS), scheduler["allowedPeriodMs"])
        self.assertEqual(soak.MAX_TASKS, scheduler["maxTasks"])
        self.assertEqual(soak.MAX_TASK_BUDGET_PERCENT, scheduler["maxTaskBudgetPercent"])
        self.assertEqual(soak.MAX_PROGRAMS_TOTAL, profile["capacity"]["maxProgramsTotal"])
        self.assertEqual(soak.MAX_PROGRAMS_ENABLED, profile["capacity"]["maxProgramsEnabled"])
        self.assertEqual(soak.BASE_STEP_MS, min(scheduler["allowedPeriodMs"]))

    def test_budget_for_eight_programs_matches_check_model(self) -> None:
        plan = soak.budget_plan(soak.PERIODS_MS)
        self.assertTrue(plan["ok"], plan["checks"])
        self.assertEqual(plan["stepBudgetUs"], 2000)
        self.assertEqual(plan["programBudgetUs"], 249)   # (2000 - 1) // 8, như programBudgetUs của Check
        self.assertEqual(plan["worstCaseStepUs"], 1992)
        self.assertLess(plan["worstCaseStepUs"], plan["stepBudgetUs"])

    def test_budget_plan_rejects_profile_violations(self) -> None:
        self.assertFalse(soak.budget_plan([10, 10])["checks"]["distinctPeriods"])
        self.assertFalse(soak.budget_plan([10, 30000])["checks"]["periodsInSet"])
        self.assertFalse(soak.budget_plan([10] * 17)["checks"]["programsWithinEnabled"])
        self.assertFalse(soak.budget_plan([10] * 33)["checks"]["programsWithinTotal"])

    def test_vs_prog_009_thresholds(self) -> None:
        # VVP-PROG-001 v2.4: 10 chu kỳ mỗi lớp, như nhau.
        self.assertEqual({period: soak.required_cycles(period) for period in soak.PERIODS_MS},
                         {period: 10 for period in soak.PERIODS_MS})
        self.assertEqual(soak.required_seconds(5000), 50.0)
        self.assertEqual(soak.required_seconds(50000), 500.0)
        self.assertEqual(soak.required_window_seconds(), 500.0)

    def test_program_source_counts_without_output(self) -> None:
        for period in soak.PERIODS_MS:
            source = soak.program_source(period)
            name = soak.program_name(period)
            self.assertRegex(name, r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
            self.assertTrue(source.startswith(f"PROGRAM {name}\n"))
            self.assertIn("cnt := cnt + 1;", source)
            self.assertNotIn("VAR_OUTPUT", source)
            self.assertNotIn("VAR_INPUT", source)
            source.encode("ascii")  # compiler ST nhận ASCII; chú thích không dấu

    def test_draft_operations_have_no_binding(self) -> None:
        operations = soak.build_draft_operations(program_specs())
        self.assertEqual(len(operations), 16)
        self.assertEqual({item["op"] for item in operations}, {"upsertObject", "upsertProgram"})
        periods = sorted(item["program"]["periodMs"] for item in operations if item["op"] == "upsertProgram")
        self.assertEqual(periods, sorted(soak.PERIODS_MS))
        for item in operations:
            if item["op"] == "upsertProgram":
                self.assertEqual(item["program"]["programId"], item["program"]["objectId"])

    def test_draft_plan_reuses_ids_by_name_and_mints_uuid4(self) -> None:
        kept = "66666666-6666-4666-8666-666666666666"
        draft = {"objects": [{"objectId": kept, "name": "soak_p00010", "kind": "PROGRAM"}],
                 "programs": [{"programId": kept, "objectId": kept, "periodMs": 10}]}
        plan = soak.draft_program_plan(draft, lambda: str(uuid.uuid4()))
        self.assertEqual(plan[0]["objectId"], kept)
        minted = [item["objectId"] for item in plan[1:]]
        self.assertEqual(len(set(minted)), len(minted))
        for value in minted:
            self.assertEqual(uuid.UUID(value).version, 4)

    def test_unexpected_draft_content_is_reported_not_deleted(self) -> None:
        draft = {"objects": [{"name": "AHU_MAIN", "kind": "PROGRAM"}, {"name": "SOAK_P00010", "kind": "PROGRAM"}],
                 "bindings": [{"bindingId": "b1"}], "signals": [{"name": "SAT"}]}
        problems = soak.unexpected_draft_content(draft)
        self.assertEqual(len(problems), 3)
        self.assertEqual(soak.unexpected_draft_content({"objects": [{"name": "SOAK_P00050", "kind": "PROGRAM"}],
                                                        "bindings": [], "signals": []}), [])

    def test_impact_acknowledgements_only_present(self) -> None:
        impact = {"impactRef": "ref-12345678", "programSet": {"status": "PRESENT", "items": []},
                  "retain": {"status": "NONE", "items": []}, "cutover": {"status": "UNAVAILABLE", "items": []},
                  "enableIntent": {"status": "PRESENT", "items": []}}
        self.assertEqual(soak.impact_acknowledgements(impact), ["programSet", "enableIntent"])

    def test_commission_source_uses_none_across_projects(self) -> None:
        self.assertEqual(soak.commission_source(None, None, SOAK_PROJECT), "none")
        self.assertEqual(soak.commission_source(ACTIVE_REVISION, OWNER_PROJECT, SOAK_PROJECT), "none")
        self.assertEqual(soak.commission_source(ACTIVE_REVISION, SOAK_PROJECT, SOAK_PROJECT), ACTIVE_REVISION)


class EvaluateWindowTests(unittest.TestCase):
    def evaluate(self, current: dict[str, Any], baseline: dict[str, Any] | None = None) -> dict[str, Any]:
        return soak.evaluate_window(baseline or snapshot(START, run_count=1000), current, program_specs(),
                                    SOAK_REVISION)

    def test_short_clean_window_is_running(self) -> None:
        result = self.evaluate(snapshot(at(300), run_count=1000 + 30000))
        self.assertEqual({key: item["verdict"] for key, item in result["criteria"].items()},
                         {"C1": "PASS", "C2": "PASS", "C3": "PASS", "C4": "PASS"})
        self.assertEqual(result["overall"], "ĐANG CHẠY")
        rows = {row["periodMs"]: row for row in result["programs"]}
        self.assertEqual(rows[10]["cycles"], 30000)
        self.assertEqual(rows[10]["status"], "ĐẠT")
        self.assertEqual(rows[50000]["status"], "CHƯA ĐỦ")    # 6 < 10
        self.assertAlmostEqual(rows[50000]["remainingSeconds"], (10 - 6) * 50.0)
        self.assertEqual(result["expectedBaseSteps"], 30000)

    def test_ten_cycles_per_class_passes(self) -> None:
        # Soak lần 3 trên bo: 608 s, lớp 50 s đạt 12 chu kỳ.
        result = self.evaluate(snapshot(at(608), run_count=1000 + 60800))
        self.assertTrue(result["soakComplete"])
        rows = {row["periodMs"]: row for row in result["programs"]}
        self.assertEqual(rows[50000]["cycles"], 12)
        self.assertEqual({row["status"] for row in result["programs"]}, {"ĐẠT"})
        self.assertEqual(result["overall"], "ĐẠT")

    def test_full_day_clean_window_passes(self) -> None:
        result = self.evaluate(snapshot(at(86400), run_count=1000 + 8640000))
        self.assertTrue(result["soakComplete"])
        self.assertEqual({row["status"] for row in result["programs"]}, {"ĐẠT"})
        self.assertEqual({row["periodMs"]: row["cycles"] for row in result["programs"]}[50000], 1728)
        self.assertEqual(result["overall"], "ĐẠT")

    def test_single_jitter_violation_fails_c4(self) -> None:
        result = self.evaluate(snapshot(at(86400), run_count=1000 + 8640000, jitter=1))
        self.assertEqual(result["criteria"]["C4"]["verdict"], "FAIL")
        self.assertEqual(result["overall"], "HỎNG")

    def test_overrun_fails_c2(self) -> None:
        result = self.evaluate(snapshot(at(60), run_count=1000 + 6000, overrun=1))
        self.assertEqual(result["criteria"]["C2"]["verdict"], "FAIL")

    def test_program_missed_release_fails_c3_and_that_period(self) -> None:
        result = self.evaluate(snapshot(at(60), run_count=1000 + 6000, missed={100: 1}))
        self.assertEqual(result["criteria"]["C3"]["verdict"], "FAIL")
        statuses = {row["periodMs"]: row["status"] for row in result["programs"]}
        self.assertEqual(statuses[100], "FAIL")
        # Lỡ release ở một lớp chỉ làm hỏng lớp đó: 10 ms đã đủ 10 chu kỳ, 50 s thì chưa.
        self.assertEqual(statuses[10], "ĐẠT")
        self.assertEqual(statuses[50000], "CHƯA ĐỦ")

    def test_missed_base_step_fails_c3(self) -> None:
        result = self.evaluate(snapshot(at(60), run_count=1000 + 5999, missed_step=1))
        self.assertEqual(result["criteria"]["C3"]["verdict"], "FAIL")

    def test_program_not_running_fails_c3(self) -> None:
        result = self.evaluate(snapshot(at(60), run_count=1000 + 6000, states={5000: "FAULTED"}))
        self.assertEqual(result["criteria"]["C3"]["verdict"], "FAIL")
        self.assertIn("SOAK_P05000", result["criteria"]["C3"]["detail"])

    def test_core_restart_resets_soak(self) -> None:
        result = self.evaluate(snapshot(at(600), run_count=50))
        self.assertTrue(result["restarted"])
        self.assertEqual(result["overall"], "HỎNG")
        self.assertTrue(any("khởi động lại" in note for note in result["notes"]))

    def test_active_changed_by_someone_else(self) -> None:
        result = self.evaluate(snapshot(at(600), run_count=61000, active=ACTIVE_REVISION))
        self.assertFalse(result["activeOk"])
        self.assertEqual(result["overall"], "HỎNG")

    def test_missing_counters_are_not_zero(self) -> None:
        current = snapshot(at(600), run_count=61000)
        current["task"]["jitterViolationCount"] = None
        result = self.evaluate(current)
        self.assertEqual(result["criteria"]["C4"]["verdict"], "KHÔNG ĐỌC ĐƯỢC")
        self.assertEqual(result["overall"], "KHÔNG KẾT LUẬN")

    def test_c1_detects_wrong_base_step_and_period(self) -> None:
        result = self.evaluate(snapshot(at(60), run_count=7000, base_step_us=1000000))
        self.assertEqual(result["criteria"]["C1"]["verdict"], "FAIL")
        result = self.evaluate(snapshot(at(60), run_count=7000, periods={10000: 30000}))
        self.assertEqual(result["criteria"]["C1"]["verdict"], "FAIL")

    def test_report_prints_dash_for_unknown_delta(self) -> None:
        current = snapshot(at(60), run_count=7000)
        current["programs"][program_specs()[0]["programId"]]["missedReleaseCount"] = None
        stream = io.StringIO()
        soak.print_report(self.evaluate(current), None, None, out=stream)
        self.assertNotIn("+None", stream.getvalue())
        self.assertIn("| — |", stream.getvalue())


def jitter_line(stamp: str, max_us: float, violations: int, missed_steps: int = 0) -> str:
    return (f"{stamp} OK1126B-buildroot mkddc-core[106118]: INFO  core.jitter min_us=0.88 max_us={max_us:.2f} "
            f"avg_us=17.88 overruns=0 count=6000 window_max_us={int(max_us) + 1} violations={violations} "
            f"missed_steps={missed_steps} base_step_us=10000\n")


class JournalTests(unittest.TestCase):
    SINCE = dt.datetime(2026, 9, 27, 10, 0, 0, tzinfo=dt.timezone.utc)

    def test_clean_minutes_pass(self) -> None:
        lines = [jitter_line(f"2026-09-27T10:0{minute}:00.000000+0000", 60 + minute, 0) for minute in range(1, 6)]
        result = soak.parse_journal(lines, since=self.SINCE, baseline_violations=0, baseline_missed_steps=0)
        self.assertEqual(result["verdict"], "PASS")
        self.assertEqual(result["minutes"], 5)
        self.assertEqual(result["maxMinuteUs"], 65.0)
        self.assertEqual(result["coverageSeconds"], 240.0)

    def test_minute_over_limit_fails(self) -> None:
        lines = [jitter_line("2026-09-27T10:01:00.000000+0000", 72.9, 0),
                 jitter_line("2026-09-27T10:02:00.000000+0000", 129.63, 2)]
        result = soak.parse_journal(lines, since=self.SINCE, baseline_violations=0)
        self.assertEqual(result["verdict"], "FAIL")
        self.assertEqual(result["minutesOverLimit"], 1)
        self.assertEqual(result["violationsDelta"], 2)

    def test_baseline_catches_violation_before_first_minute(self) -> None:
        lines = [jitter_line("2026-09-27T10:01:00.000000+0000", 90.0, 4)]
        result = soak.parse_journal(lines, since=self.SINCE, baseline_violations=3)
        self.assertEqual(result["violationsDelta"], 1)
        self.assertEqual(result["verdict"], "FAIL")

    def test_lines_before_window_are_ignored(self) -> None:
        lines = [jitter_line("2026-09-27T09:59:00.000000+0000", 300.0, 9),
                 jitter_line("2026-09-27T10:01:00.000000+0000", 50.0, 9)]
        result = soak.parse_journal(lines, since=self.SINCE, baseline_violations=9)
        self.assertEqual(result["minutes"], 1)
        self.assertEqual(result["verdict"], "PASS")

    def test_base_step_missed_and_restart_fail(self) -> None:
        missed = ("2026-09-27T10:01:30.000000+0000 host mkddc-core[1]: WARN  core.base_step_missed "
                  "cause=wake_late late_us=11592 skipped=1 total=1 (ADR-061 C3)\n")
        restart = "2026-09-27T10:02:30.000000+0000 host mkddc-core[2]: INFO  core.base_step_ms=10 programming_mode=1\n"
        lines = [jitter_line("2026-09-27T10:01:00.000000+0000", 50.0, 0), missed, restart]
        result = soak.parse_journal(lines, since=self.SINCE, baseline_violations=0)
        self.assertEqual(result["baseStepMissedLines"], 1)
        self.assertTrue(result["restarted"])
        self.assertEqual(result["verdict"], "FAIL")

    def test_counter_decrease_means_restart(self) -> None:
        lines = [jitter_line("2026-09-27T10:01:00.000000+0000", 50.0, 5),
                 jitter_line("2026-09-27T10:02:00.000000+0000", 50.0, 0)]
        result = soak.parse_journal(lines, since=self.SINCE, baseline_violations=5)
        self.assertTrue(result["restarted"])
        self.assertEqual(result["verdict"], "FAIL")

    def test_json_and_short_formats(self) -> None:
        micros = int(dt.datetime(2026, 9, 27, 10, 1, tzinfo=dt.timezone.utc).timestamp() * 1e6)
        json_line = json.dumps({"__REALTIME_TIMESTAMP": str(micros),
                                "MESSAGE": "INFO  core.jitter min_us=1 max_us=70.5 avg_us=9 overruns=0 count=6000 "
                                           "window_max_us=71 violations=0 missed_steps=0 base_step_us=10000"}) + "\n"
        short_line = ("Sep 27 10:02:00.123456 OK1126B-buildroot mkddc-core[1]: INFO  core.jitter min_us=1 "
                      "max_us=80.25 avg_us=9 overruns=0 count=6000 window_max_us=81 violations=0 "
                      "missed_steps=0 base_step_us=10000\n")
        result = soak.parse_journal([json_line, short_line], since=self.SINCE, year=2026, baseline_violations=0)
        self.assertEqual(result["minutes"], 2)
        self.assertEqual(result["maxMinuteUs"], 80.25)
        self.assertEqual(result["verdict"], "PASS")

    def test_iso_colon_offset_from_utc_flag(self) -> None:
        # `journalctl --utc -o short-iso-precise` in `+00:00`.
        line = jitter_line("2026-09-27T10:01:00.123456+00:00", 99.99, 0)
        result = soak.parse_journal([line], since=self.SINCE, baseline_violations=0)
        self.assertEqual((result["minutes"], result["verdict"]), (1, "PASS"))

    def test_gap_is_reported(self) -> None:
        lines = [jitter_line("2026-09-27T10:01:00.000000+0000", 50.0, 0),
                 jitter_line("2026-09-27T10:05:00.000000+0000", 50.0, 0)]
        result = soak.parse_journal(lines, since=self.SINCE)
        self.assertEqual(len(result["gaps"]), 1)
        self.assertEqual(result["gaps"][0]["seconds"], 240.0)

    def test_untimed_lines_are_counted(self) -> None:
        line = ("core.jitter min_us=0.88 max_us=76.52 avg_us=17.88 overruns=0 count=6001 window_max_us=77 "
                "violations=0 missed_steps=0 base_step_us=10000\n")
        result = soak.parse_journal([line], since=self.SINCE)
        self.assertEqual(result["untimedLines"], 1)
        self.assertEqual(result["minutes"], 1)

    def test_empty_journal_is_not_a_pass(self) -> None:
        self.assertEqual(soak.parse_journal([], since=self.SINCE)["verdict"], "KHÔNG CÓ DỮ LIỆU")


class FakeResponse:
    def __init__(self, status: int, body: Any):
        self.status = status
        self._raw = json.dumps(body).encode()
        self.headers: dict[str, str] = {}

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *exc: Any) -> None:
        return None


class ClientTests(unittest.TestCase):
    def test_secrets_never_reach_log_and_keys_are_fresh_uuid4(self) -> None:
        seen: list[Any] = []
        state = {"logins": 0}

        def opener(request: Any, timeout: float) -> FakeResponse:
            seen.append(request)
            if request.full_url.endswith("/auth/login"):
                state["logins"] += 1
                return FakeResponse(200, {"token": f"tok-SECRET-{state['logins']}", "role": "admin"})
            if len(seen) == 3:  # token hết hạn đúng một lần
                raise soak.urllib.error.HTTPError(request.full_url, 401, "hết hạn", {}, io.BytesIO(b"{}"))
            return FakeResponse(200, {"resource": {"desiredEnabled": True, "generation": 2}})

        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / "http.jsonl"
            client = soak.Client("http://bo.invalid:8082", "admin", "pw-SECRET", http_log=log, opener=opener)
            for _ in range(2):
                client.call("PUT", "/programming/projects/p/programs/x/runtime-intent",
                            {"schemaVersion": "1.0", "desiredEnabled": True}, mutation=True)
            text = log.read_text("utf-8")
        self.assertNotIn("SECRET", text)
        self.assertEqual(state["logins"], 2)  # đăng nhập lại đúng một lần sau 401
        keys = [request.headers.get("X-idempotency-key") for request in seen
                if not request.full_url.endswith("/auth/login")]
        self.assertEqual(len(keys), 3)
        self.assertEqual(len(set(keys)), 3)
        for key in keys:
            self.assertEqual(uuid.UUID(key).version, 4)
        for request in seen:
            correlation = request.headers.get("X-correlation-id")
            if correlation:
                self.assertRegex(correlation, r"^[A-Za-z0-9._-]{16,64}$")

    def test_state_roundtrip_is_atomic_and_checked(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state.json"
            state = soak.load_state(path)
            state["projectId"] = SOAK_PROJECT
            soak.save_state(path, state)
            self.assertEqual(soak.load_state(path)["projectId"], SOAK_PROJECT)
            self.assertEqual([item.name for item in Path(folder).iterdir()], ["state.json"])
            path.write_text(json.dumps({"schema": "khac"}), "utf-8")
            with self.assertRaises(soak.SoakError):
                soak.load_state(path)

    def test_cli_requires_credentials(self) -> None:
        with self.assertRaises(SystemExit):
            with unittest.mock.patch.dict(soak.os.environ, {}, clear=True):
                with unittest.mock.patch.object(sys, "stderr", io.StringIO()):
                    soak.main(["report"])


class FakeApi:
    """Duck-type của `Client` cho các lệnh con: ghi lại thứ tự mutation."""

    def __init__(self, active: str):
        self.active = active
        self.calls: list[tuple[str, str, Any]] = []
        self.owner_intent = {"desiredEnabled": False, "generation": 7}

    def get(self, path: str) -> Any:
        if path == "/programming/runtime":
            return {"activeRevisionId": self.active, "observedAt": at(90000), "safeState": True,
                    "task": snapshot(at(90000), run_count=1000 + 8640000)["task"]}
        if path == "/programming/capabilities":
            return {"taskPeriodsMs": list(soak.PERIODS_MS)}
        if path == f"/programming/projects/{SOAK_PROJECT}/programs":
            return {"items": [dict(item, programId=pid, runtimeStateSource="CORE_LIVE")
                              for pid, item in snapshot(at(90000), run_count=0)["programs"].items()]}
        if path == f"/programming/projects/{OWNER_PROJECT}/programs":
            return {"items": [dict(self.owner_intent, programId=OWNER_PROGRAM, runtimeState="RUNNING",
                                   runtimeStateSource="CORE_LIVE")]}
        if path.startswith("/programming/operations/"):
            return {"operationId": path.rsplit("/", 1)[1], "state": "SUCCEEDED"}
        if path == "/points":
            return []
        raise AssertionError(f"GET không mong đợi: {path}")

    def call(self, method: str, path: str, body: Any = None, **_: Any) -> tuple[Any, dict]:
        self.calls.append((method, path, body))
        if path.endswith("/runtime-intent"):
            if OWNER_PROGRAM in path:
                self.owner_intent = {"desiredEnabled": body["desiredEnabled"], "generation": 8}
            return {"resource": {"desiredEnabled": body["desiredEnabled"], "generation": 8}}, {}
        if path == "/programming/operations/restore":
            self.active = body["revisionId"]
            return {"operationId": "99999999-9999-4999-8999-999999999999"}, {}
        raise AssertionError(f"{method} không mong đợi: {path}")


def started_state() -> dict[str, Any]:
    return {
        "schema": soak.STATE_SCHEMA, "projectId": SOAK_PROJECT, "programs": program_specs(),
        "prepare": {"revisionId": SOAK_REVISION, "checkId": str(uuid.uuid4()), "checkState": "PASSED"},
        "start": {"activeBefore": ACTIVE_REVISION, "ownerProjectId": OWNER_PROJECT, "outputsMode": "safe",
                  "operation": {"operationId": str(uuid.uuid4()), "state": "SUCCEEDED"},
                  "baseline": snapshot(START, run_count=1000),
                  "ownerIntentsBefore": {OWNER_PROGRAM: {"desiredEnabled": True, "runtimeStateSource": "CORE_LIVE"}},
                  "released": [{"projectId": OWNER_PROJECT, "programId": OWNER_PROGRAM, "desiredEnabled": False,
                                "generation": 7}],
                  "soakIntentsBefore": {}},
    }


def stop_args(**overrides: Any) -> argparse.Namespace:
    values = {"operation_timeout": 5.0, "ack_modbus_slot_mismatch": False, "intents_only": False}
    values.update(overrides)
    return argparse.Namespace(**values)


class StopTests(unittest.TestCase):
    def setUp(self) -> None:
        self._sleep = soak.time.sleep
        soak.time.sleep = lambda _seconds: None

    def tearDown(self) -> None:
        soak.time.sleep = self._sleep

    def test_stop_refuses_when_active_changed(self) -> None:
        api = FakeApi(active="77777777-7777-4777-8777-777777777777")
        state = started_state()
        with unittest.mock.patch.object(sys, "stdout", io.StringIO()):
            code = soak.cmd_stop(api, state, stop_args(), lambda: None)
        self.assertEqual(code, soak.EXIT_REFUSED)
        self.assertEqual(api.calls, [])  # không Restore, không đụng intent
        self.assertEqual(state["stop"]["attempts"][-1]["result"], "REFUSED_ACTIVE_CHANGED")

    def test_stop_reenables_owner_intent_before_restore(self) -> None:
        api = FakeApi(active=SOAK_REVISION)
        state = started_state()
        with unittest.mock.patch.object(sys, "stdout", io.StringIO()):
            code = soak.cmd_stop(api, state, stop_args(), lambda: None)
        self.assertEqual(code, soak.EXIT_OK)
        paths = [path for _, path, _ in api.calls]
        restore_index = paths.index("/programming/operations/restore")
        owner_index = next(index for index, path in enumerate(paths) if OWNER_PROGRAM in path)
        self.assertLess(owner_index, restore_index, "intent Active gốc phải được bật TRƯỚC Restore (ADR-062)")
        restore = api.calls[restore_index][2]
        self.assertEqual(restore["revisionId"], ACTIVE_REVISION)
        self.assertEqual(restore["expectedActiveRevisionId"], SOAK_REVISION)
        self.assertEqual(restore["acknowledgements"], [])
        soak_offs = [body for _, path, body in api.calls[restore_index + 1:] if path.endswith("/runtime-intent")]
        self.assertEqual(len(soak_offs), 8)
        self.assertTrue(all(body["desiredEnabled"] is False for body in soak_offs))
        self.assertEqual(state["stop"]["final"]["overall"], "ĐẠT")

    def test_prepare_refuses_while_soak_is_running(self) -> None:
        api = FakeApi(active=SOAK_REVISION)
        with self.assertRaises(soak.SoakError):
            soak.cmd_prepare(api, started_state(), argparse.Namespace(), lambda: None)
        self.assertEqual(api.calls, [])

    def test_stop_does_not_overwrite_intent_changed_by_someone_else(self) -> None:
        api = FakeApi(active=SOAK_REVISION)
        api.owner_intent = {"desiredEnabled": False, "generation": 9}  # ai đó ghi lại sau lần tắt (gen 7)
        state = started_state()
        with unittest.mock.patch.object(sys, "stdout", io.StringIO()):
            soak.cmd_stop(api, state, stop_args(), lambda: None)
        self.assertFalse(any(OWNER_PROGRAM in path for _, path, _ in api.calls))
        self.assertIn("BỎ QUA", state["stop"]["attempts"][-1]["ownerIntents"][0]["result"])



if __name__ == "__main__":
    unittest.main()
