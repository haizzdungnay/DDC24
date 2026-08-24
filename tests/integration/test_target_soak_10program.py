"""Unit/integration không network cho harness target T59-702.

Fake client và fake clock ở đây có chủ đích: test phải kiểm được 24 h gate,
checkpoint/resume, restart/fault timeline và metric fail-closed trong vài giây,
không được chạm target hoặc tự restart service thật.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from typing import Any, Mapping
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "target_soak_10program.py"
SPEC = importlib.util.spec_from_file_location("target_soak_10program", SCRIPT)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - lỗi môi trường import
    raise RuntimeError(f"không import được {SCRIPT}")
soak = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = soak
SPEC.loader.exec_module(soak)


class FakeClock:
    def __init__(self) -> None:
        self._mono = 10_000_000_000
        self._wall = 1_777_000_000_000_000_000

    def wall_ns(self) -> int:
        return self._wall

    def monotonic_ns(self) -> int:
        return self._mono

    def sleep(self, seconds: float) -> None:
        self.advance(seconds)

    def advance(self, seconds: float) -> None:
        delta = int(max(0.0, seconds) * 1e9)
        self._mono += delta
        self._wall += delta


def result(clock: FakeClock, status: int, body: Any, latency_ms: float = 1.0):
    started_mono = clock.monotonic_ns()
    started_wall = clock.wall_ns()
    clock.advance(latency_ms / 1000.0)
    return soak.CallResult(status, body, latency_ms, started_wall, started_mono,
                           clock.monotonic_ns(), None if status < 400 else "http_error")


def write_adapter(path: Path) -> soak.SignalSyntaxAdapter:
    path.write_text(json.dumps({
        "schemaVersion": 1,
        "adapterId": "test-signal-v1",
        "publishStatement": "SIGNAL_PUBLISH({signal}, {value});",
        "readExpression": "SIGNAL_READ({signal})",
    }), encoding="utf-8")
    return soak.SignalSyntaxAdapter.load(path)


def clean_provenance() -> dict[str, Any]:
    return {"sha256": "b" * 64, "document": {
        "version": "test", "git_commit": "a" * 40, "dirty": False,
        "mcu_firmware": "not-included",
    }}


class SetupClient:
    def __init__(self, clock: FakeClock):
        self.clock = clock
        self.calls: list[tuple[str, str, str | None]] = []
        self.etag = 1

    def call(self, method: str, path: str, data: Any = None,
             headers: Mapping[str, str] | None = None, timeout: float = 30.0,
             idempotency_key: str | None = None):
        del data, headers, timeout
        self.calls.append((method, path, idempotency_key))
        if method == "POST" and path == "/api/v1/programming/projects":
            return result(self.clock, 201, {"resource": {
                "projectId": "11111111-1111-4111-8111-111111111111",
                "draftRevisionId": "22222222-2222-4222-8222-222222222222",
            }, "etag": '"etag-1"'})
        if method == "PATCH":
            self.etag += 1
            return result(self.clock, 200, {"etag": f'"etag-{self.etag}"'})
        if method == "POST" and path.endswith("/draft/revisions"):
            return result(self.clock, 201, {"resource": {
                "revisionId": "33333333-3333-4333-8333-333333333333",
            }, "etag": '"etag-sealed"'})
        if method == "POST" and path.endswith("/checks"):
            return result(self.clock, 202, {"checkId": "44444444-4444-4444-8444-444444444444"})
        if method == "GET" and "/checks/" in path:
            return result(self.clock, 200, {"state": "PASSED", "artifact": {
                "artifactId": "55555555-5555-4555-8555-555555555555",
                "sha256": "c" * 64, "byteSize": 4096,
            }})
        raise AssertionError(f"API giả không biết {method} {path}")


class RuntimeClient:
    def __init__(self, clock: FakeClock, state: dict[str, Any], with_iop_gap: bool = True):
        self.clock = clock
        self.state = state
        self.with_iop_gap = with_iop_gap
        self.producer_enabled = True
        self.producer_disabled_at_ns: int | None = None
        self.last_publish_ns = clock.monotonic_ns()
        self.task_run_count = 100
        self.generation = 10
        self.mutation_keys: list[str | None] = []
        self.call_count = 0
        self.interrupt_once_at: int | None = None

    def call(self, method: str, path: str, data: Any = None,
             headers: Mapping[str, str] | None = None, timeout: float = 30.0,
             idempotency_key: str | None = None):
        del headers, timeout
        self.call_count += 1
        if self.interrupt_once_at is not None and self.call_count >= self.interrupt_once_at:
            self.interrupt_once_at = None
            raise soak.HarnessError("ngắt collector có chủ đích trong test")
        if method == "PUT" and path.endswith("/runtime-intent"):
            enabled = bool(data["desiredEnabled"])
            if not enabled and self.producer_enabled:
                self.producer_disabled_at_ns = self.clock.monotonic_ns()
            elif enabled:
                self.producer_disabled_at_ns = None
            self.producer_enabled = enabled
            self.mutation_keys.append(idempotency_key)
            return result(self.clock, 200, {"desiredEnabled": self.producer_enabled})
        if path == "/api/v1/programming/runtime":
            self.task_run_count += 1
            return result(self.clock, 200, {
                "activeRevisionId": self.state["setup"]["revisionId"],
                "producerState": "READY", "taskState": "RUNNING",
                "task": {"taskId": "main", "periodMs": 1000, "budgetMs": 800,
                         "state": "RUNNING", "runCount": self.task_run_count,
                         "missedReleaseCount": 0, "lastExecNs": 20_000,
                         "maxExecNs": 40_000, "overrunCount": 0,
                         "consecutiveOverruns": 0},
            })
        if path == "/api/v1/programming/runtime/monitor":
            return result(self.clock, 200, {"activeRevisionId": self.state["setup"]["revisionId"],
                                            "safeState": False, "items": []})
        if path.endswith("/programs"):
            items = []
            for program_id in self.state["programIds"]:
                runtime_state = "RUNNING"
                enabled = True
                if program_id == self.state["faultProgramId"]:
                    runtime_state = "FAULTED"
                elif not self.producer_enabled and program_id == self.state["producerProgramId"]:
                    runtime_state, enabled = "DISABLED", False
                elif (not self.producer_enabled and program_id == self.state["consumerProgramId"] and
                      self.producer_disabled_at_ns is not None and
                      self.clock.monotonic_ns() - self.producer_disabled_at_ns >
                      soak.SIGNAL_FRESHNESS_MS * 1_000_000):
                    runtime_state = "WAITING"
                period = self.state["periodsMs"][program_id]
                items.append({
                    "programId": program_id, "runtimeState": runtime_state,
                    "runtimeStateSource": "CORE_LIVE", "enabled": enabled,
                    "periodMs": period, "lastExecNs": 10_000, "maxExecNs": 20_000,
                    "missedReleaseCount": 0, "consecutiveMissedRelease": 0,
                    "lastRunAgeMs": 5, "lane": 0,
                })
            return result(self.clock, 200, {"runtimeStateSource": "CORE_LIVE",
                                            "programsTruncated": False, "items": items})
        if path == "/api/v1/programming/runtime/signals":
            if self.producer_enabled:
                self.generation += 1
                self.last_publish_ns = self.clock.monotonic_ns()
            stale = (not self.producer_enabled and self.producer_disabled_at_ns is not None and
                     self.clock.monotonic_ns() - self.producer_disabled_at_ns >
                     soak.SIGNAL_FRESHNESS_MS * 1_000_000)
            items = []
            for name, publisher in (("SOAK_SOURCE", self.state["producerProgramId"]),
                                    ("SOAK_CONSUMED", self.state["consumerProgramId"])):
                if not stale:
                    freshness, valid, quality = "FRESH", True, "GOOD"
                elif name == "SOAK_SOURCE":
                    freshness, valid, quality = "UNAVAILABLE", False, "BAD"
                else:
                    freshness, valid, quality = "STALE_HELD", True, "UNCERTAIN"
                items.append({
                    "signalId": self.state["signalIds"][name], "name": name,
                    "producerProgramId": publisher, "dataType": "REAL", "unit": "count",
                    "value": float(self.generation) if valid else None, "valid": valid,
                    "quality": quality, "freshness": freshness,
                    "stalePolicy": "WAIT" if name == "SOAK_SOURCE" else "HOLD_LAST",
                    "freshnessMs": soak.SIGNAL_FRESHNESS_MS,
                    "publishedAtMonoNs": str(self.last_publish_ns),
                    "generation": str(self.generation), "definitionState": "MATCHED",
                })
            return result(self.clock, 200, {"producerState": "READY", "items": items})
        if path == "/api/v1/health":
            return result(self.clock, 200, {"status": "ok", "checks": {
                "web": {"status": "ok"}, "core": {"status": "ok"},
                "iobus": {"status": "ok"}, "mcu_connection": {"status": "ok"},
            }})
        if path == "/api/v1/system/status":
            iop = {"status": "normal", "last_io_resp_ms": 5}
            if self.with_iop_gap:
                iop["maxPollGapMs"] = 40
            return result(self.clock, 200, {"overall": "ok", "iop": iop,
                                            "scan": {"count": self.task_run_count, "overrun": 0}})
        raise AssertionError(f"API giả không biết {method} {path}")


class TargetSoakHarnessTest(unittest.TestCase):
    def test_atomic_write_opens_one_exclusive_temp_and_replaces_repeatedly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "state.json"
            fixed_uuid = uuid.UUID("11111111-1111-4111-8111-111111111111")
            with mock.patch.object(soak.uuid, "uuid4", return_value=fixed_uuid):
                soak.atomic_write_json(target, {"generation": 1})
                soak.atomic_write_json(target, {"generation": 2})
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"generation": 2})
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(root.glob(".state.json.tmp.*")), [])

    def test_password_has_no_default_and_secret_file_must_be_0600(self) -> None:
        with self.assertRaises(soak.HarnessError):
            soak.load_secret("MKDDC_SOAK_PASSWORD", None, {})
        self.assertEqual(soak.load_secret("SOAK_SECRET", None, {"SOAK_SECRET": "khong-in-ra"}),
                         "khong-in-ra")
        with tempfile.TemporaryDirectory() as directory:
            secret = Path(directory) / "password"
            secret.write_text("secret-file\n", encoding="utf-8")
            secret.chmod(0o644)
            with self.assertRaisesRegex(soak.HarnessError, "0600"):
                soak.load_secret(None, secret, {})
            secret.chmod(0o600)
            self.assertEqual(soak.load_secret(None, secret, {}), "secret-file")

    def test_signal_adapter_is_required_and_fixture_contains_real_chain_and_delayed_fault(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            invalid = Path(directory) / "invalid.json"
            invalid.write_text(json.dumps({"schemaVersion": 1, "adapterId": "x",
                                           "publishStatement": "P({signal});",
                                           "readExpression": "R({signal})"}), encoding="utf-8")
            with self.assertRaisesRegex(soak.HarnessError, "publishStatement"):
                soak.SignalSyntaxAdapter.load(invalid)
            adapter = write_adapter(Path(directory) / "adapter.json")
            producer = soak.source_for(soak.PRODUCER_INDEX, adapter)
            consumer = soak.source_for(soak.CONSUMER_INDEX, adapter)
            fault = soak.source_for(soak.FAULT_PROGRAM_INDEX, adapter)
        self.assertIn("SIGNAL_PUBLISH(SOAK_SOURCE, PublishedValue);", producer)
        self.assertIn("ConsumedValue := SIGNAL_READ(SOAK_SOURCE);", consumer)
        self.assertIn("SIGNAL_PUBLISH(SOAK_CONSUMED, ConsumedValue);", consumer)
        self.assertIn(f"FaultCounter > {soak.FAULT_AFTER_RELEASES}", fault)
        self.assertIn("FaultCounter := FaultCounter / Divisor;", fault)

    def test_setup_is_resumable_and_does_not_repeat_completed_mutations(self) -> None:
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            adapter = write_adapter(root / "adapter.json")
            store = soak.StateStore(root / "state.json")
            state = soak.new_state("SOAK-TEST", adapter, clean_provenance(), clock, "boot-test")
            self.assertNotEqual(state["creationOrderProgramIds"], state["programIds"])
            self.assertEqual(set(state["creationOrderProgramIds"]), set(state["programIds"]))
            for identity in [*state["programIds"], *state["signalIds"].values(),
                             *state["idempotencyKeys"].values()]:
                self.assertEqual(uuid.UUID(identity).version, 4, identity)
            store.save(state, clock)
            client = SetupClient(clock)
            soak.setup_fixture(client, store, state, adapter, clock)
            call_count = len(client.calls)
            first_keys = [key for method, _path, key in client.calls if method in soak.MUTATION_METHODS]
            soak.setup_fixture(client, store, state, adapter, clock)
            persisted = store.load()
        self.assertEqual(len(client.calls), call_count)
        self.assertTrue(all(first_keys))
        self.assertEqual(len(first_keys), len(set(first_keys)))
        self.assertEqual(persisted["setup"]["checkState"], "PASSED")
        self.assertEqual(len(persisted["setup"]["tasksSaved"]), 3)

    def _ready_state(self, root: Path, clock: FakeClock):
        adapter = write_adapter(root / "adapter.json")
        state = soak.new_state("SOAK-RUNTIME", adapter, clean_provenance(), clock, "boot-test")
        state["setup"].update({
            "projectId": "11111111-1111-4111-8111-111111111111",
            "revisionId": "33333333-3333-4333-8333-333333333333",
            "artifact": {"sha256": "c" * 64, "artifactId": "artifact-test"},
            "fixtureReady": True,
        })
        return state

    def test_collector_records_fault_signal_restart_and_verifier_passes_only_full_duration(self) -> None:
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = self._ready_state(root, clock)
            store = soak.StateStore(root / "state.json")
            store.save(state, clock)
            client = RuntimeClient(clock, state)
            restart_calls: list[tuple[str, str]] = []

            def restart(run_id: str, action_id: str):
                restart_calls.append((run_id, action_id))
                clock.advance(0.05)
                return 0, 50.0, {
                    "schemaVersion": 1, "service": "mkddc-web-pi",
                    "before": {"mainPid": 101, "nRestarts": 0},
                    "after": {"mainPid": 202, "nRestarts": 0, "activeState": "active"},
                }

            evidence = root / "raw.jsonl"
            config = soak.SoakConfig(
                duration_seconds=3.5, interval_seconds=0.05, detail_interval_seconds=0.1,
                checkpoint_seconds=0.2,
                signal_fault_at_seconds=0.2, signal_fault_duration_seconds=2.1,
                restart_at_seconds=0.4, restart_hook=restart, parallel_requests=False,
            )
            client.interrupt_once_at = 18
            with self.assertRaisesRegex(soak.HarnessError, "ngắt collector"):
                soak.run_soak(client, store, state, evidence, clock, config)
            soak.run_soak(client, store, state, evidence, clock, config)
            # Resume sau complete là no-op, không chạy lại restart hay fault action.
            soak.run_soak(client, store, state, evidence, clock, config)
            passing = soak.verify_evidence(evidence, state, root / "pass.json",
                                            minimum_seconds=3.5, recovery_seconds=0,
                                            warmup_seconds=0)
            missing_gap = root / "missing-gap.jsonl"
            with missing_gap.open("w", encoding="utf-8") as sink:
                for raw_line in evidence.read_text(encoding="utf-8").splitlines():
                    event = json.loads(raw_line)
                    if event.get("event") == "iop_sample":
                        event["maxIopPollGapMs"] = None
                        event.get("request", {}).get("body", {}).get("iop", {}).pop("maxPollGapMs", None)
                    elif event.get("event") == "sample":
                        event.get("metrics", {})["maxIopPollGapMs"] = None
                        event.get("requests", {}).get("system", {}).get("body", {}).get("iop", {}).pop(
                            "maxPollGapMs", None)
                    sink.write(json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
            missing_metric = soak.verify_evidence(missing_gap, state, root / "missing-gap.json",
                                                   minimum_seconds=3.5, recovery_seconds=0,
                                                   warmup_seconds=0)
            legacy_freshness = root / "legacy-freshness.jsonl"
            freshness_changed = False
            with legacy_freshness.open("w", encoding="utf-8") as sink:
                for raw_line in evidence.read_text(encoding="utf-8").splitlines():
                    event = json.loads(raw_line)
                    if event.get("event") == "sample" and not freshness_changed:
                        items = event.get("requests", {}).get("signals", {}).get("body", {}).get("items", [])
                        for item in items:
                            if item.get("freshness") == "FRESH":
                                item["freshness"] = "LIVE"
                                freshness_changed = True
                                break
                    sink.write(json.dumps(event, ensure_ascii=False, sort_keys=True,
                                          separators=(",", ":")) + "\n")
            legacy_result = soak.verify_evidence(legacy_freshness, state, root / "legacy.json",
                                                  minimum_seconds=3.5, recovery_seconds=0,
                                                  warmup_seconds=0)

            no_waiting = root / "no-waiting.jsonl"
            with no_waiting.open("w", encoding="utf-8") as sink:
                for raw_line in evidence.read_text(encoding="utf-8").splitlines():
                    event = json.loads(raw_line)
                    if event.get("event") == "sample":
                        items = event.get("requests", {}).get("programs", {}).get("body", {}).get("items", [])
                        for item in items:
                            if (item.get("programId") == state["consumerProgramId"] and
                                    item.get("runtimeState") == "WAITING"):
                                item["runtimeState"] = "RUNNING"
                    sink.write(json.dumps(event, ensure_ascii=False, sort_keys=True,
                                          separators=(",", ":")) + "\n")
            no_waiting_result = soak.verify_evidence(no_waiting, state, root / "no-waiting.json",
                                                      minimum_seconds=3.5, recovery_seconds=0,
                                                      warmup_seconds=0)
            production_gate = soak.verify_evidence(evidence, state, root / "production.json",
                                                    recovery_seconds=0, warmup_seconds=0)
            raw_text = evidence.read_text(encoding="utf-8")
        self.assertEqual(passing["verdict"], "PASS", passing["failures"])
        self.assertEqual(production_gate["verdict"], "FAIL")
        self.assertIn("IOP_POLL_GAP_METRIC_MISSING", missing_metric["failures"])
        self.assertTrue(any(item.startswith("SIGNAL_FRESHNESS_INVALID")
                            for item in legacy_result["failures"]), legacy_result["failures"])
        self.assertIn("BLOCK_PROGRAM_CONSUMER_WAITING_NOT_OBSERVED",
                      no_waiting_result["failures"])
        self.assertTrue(any(item.startswith("ELAPSED_LT_REQUIRED")
                            for item in production_gate["failures"]))
        self.assertEqual(len(restart_calls), 1)
        self.assertEqual(len(client.mutation_keys), 2)
        self.assertTrue(all(client.mutation_keys))
        self.assertIn('"event":"web_restart_start"', raw_text)
        self.assertIn('"event":"signal_fault_disable_result"', raw_text)
        self.assertIn('"event":"signal_fault_recover_result"', raw_text)
        self.assertIn('"latencyMs"', raw_text)
        self.assertGreater(passing["counts"]["consumerWaitingSamples"], 0)

    def test_iop_last_response_is_not_mislabeled_as_poll_gap(self) -> None:
        self.assertIsNone(soak._explicit_iop_gap_ms({"iop": {"last_io_resp_ms": 5}}))
        self.assertEqual(soak._explicit_iop_gap_ms({"iop": {"maxPollGapMs": 42}}), 42.0)

    def test_parser_defaults_to_sub_200ms_interval_and_has_no_password_argument(self) -> None:
        parser = soak.build_parser()
        args = parser.parse_args(["soak", "--restart-hook", "/tmp/hook"])
        self.assertLess(args.interval, 0.2)
        self.assertFalse(hasattr(args, "password"))
        self.assertEqual(args.duration_hours, 24.0)


if __name__ == "__main__":
    unittest.main()
