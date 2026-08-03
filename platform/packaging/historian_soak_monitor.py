#!/usr/bin/env python3
"""Bounded, read-only historian soak monitor for the production board."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import time
from typing import Any


SERVICES = ("mkddc-web-pi", "mkddc-core", "mkddc-iobus")
STORAGE_WARNINGS = ("hot sample conflict", "queue gap", "SQLITE_BUSY")
CORE_WARNINGS = ("core unavailable", "alarms_read degraded")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--expected-hash", required=True)
    parser.add_argument("--duration-seconds", type=int, default=24 * 60 * 60)
    parser.add_argument("--interval-seconds", type=int, default=60)
    parser.add_argument("--integrity-every", type=int, default=60)
    parser.add_argument("--binary", default="/opt/mkddc-web/mkddc-web")
    parser.add_argument("--historian-db", default="/data/config/historian-v2.sqlite")
    parser.add_argument("--legacy-db", default="/opt/mkddc-web/trend.sqlite")
    parser.add_argument("--storage-path", default="/data/config")
    args = parser.parse_args()
    if args.duration_seconds < 1 or args.interval_seconds < 1 or args.integrity_every < 1:
        parser.error("duration, interval, and integrity cadence must be positive")
    if len(args.expected_hash) != 64 or any(ch not in "0123456789abcdef" for ch in args.expected_hash.lower()):
        parser.error("expected hash must be lowercase SHA-256")
    return args


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_json_exclusive(path: Path, value: dict[str, Any]) -> None:
    payload = (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command(*args: str) -> str:
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=15).stdout.strip()


def service_state(unit: str) -> dict[str, Any]:
    raw = command("systemctl", "show", unit, "-p", "ActiveState", "-p", "SubState", "-p", "NRestarts", "-p", "MainPID")
    state = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
    return {
        "active": state.get("ActiveState"),
        "sub": state.get("SubState"),
        "restarts": int(state.get("NRestarts", "-1")),
        "pid": int(state.get("MainPID", "0")),
    }


def rss_kib(pid: int) -> int | None:
    if pid <= 0:
        return None
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except (FileNotFoundError, PermissionError, ValueError):
        return None
    return None


def open_readonly(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    connection.execute("PRAGMA query_only=ON")
    return connection


def database_sample(historian_db: Path, legacy_db: Path, integrity: bool) -> dict[str, Any]:
    with open_readonly(historian_db) as db:
        activation = db.execute(
            "SELECT state,writer_authority,legacy_quiesced,migration_verified,prune_enabled "
            "FROM historian_activation WHERE singleton=1"
        ).fetchone()
        frontiers = db.execute(
            "SELECT point_id,generation,COUNT(*),MIN(bucket_utc_ms),MAX(bucket_utc_ms) "
            "FROM hot_samples GROUP BY point_id,generation ORDER BY point_id,generation"
        ).fetchall()
        result = {
            "hotCount": db.execute("SELECT COUNT(*) FROM hot_samples").fetchone()[0],
            "gapCount": db.execute("SELECT COUNT(*) FROM history_gaps").fetchone()[0],
            "activation": activation,
            "frontiers": frontiers,
            "quickCheck": db.execute("PRAGMA quick_check").fetchone()[0] if integrity else None,
        }
    with open_readonly(legacy_db) as db:
        result["legacyCount"] = db.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
    return result


def journal_counts(since_epoch: float, until_epoch: float) -> dict[str, int]:
    raw = command(
        "journalctl", "-u", "mkddc-web-pi", f"--since=@{since_epoch:.3f}",
        f"--until=@{until_epoch:.3f}", "--no-pager", "-o", "cat",
    )
    return {
        "storage": sum(raw.count(pattern) for pattern in STORAGE_WARNINGS),
        "core": sum(raw.count(pattern) for pattern in CORE_WARNINGS),
    }


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve(strict=True)
    if not output_dir.is_dir() or output_dir.is_symlink():
        raise SystemExit("output-dir must be an existing non-symlink directory")
    samples_path = output_dir / "samples.jsonl"
    metadata_path = output_dir / "metadata.json"
    summary_path = output_dir / "summary.json"
    for path in (samples_path, metadata_path, summary_path):
        if path.exists() or path.is_symlink():
            raise SystemExit(f"refusing existing output {path}")

    binary = Path(args.binary).resolve(strict=True)
    historian_db = Path(args.historian_db).resolve(strict=True)
    legacy_db = Path(args.legacy_db).resolve(strict=True)
    storage_path = Path(args.storage_path).resolve(strict=True)
    started_wall = time.time()
    started_mono = time.monotonic()
    stop_requested = False

    def request_stop(_signum: int, _frame: Any) -> None:
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    write_json_exclusive(metadata_path, {
        "kind": "historian-24h-soak",
        "startedAtUtc": utc_now(),
        "durationSeconds": args.duration_seconds,
        "intervalSeconds": args.interval_seconds,
        "integrityEverySamples": args.integrity_every,
        "expectedBinarySha256": args.expected_hash,
        "binary": str(binary),
        "historianDb": str(historian_db),
        "legacyDb": str(legacy_db),
        "storagePath": str(storage_path),
    })

    aggregates = {
        "samples": 0, "sampleErrors": 0, "serviceFailures": 0, "restartViolations": 0,
        "hashMismatches": 0, "integrityErrors": 0, "authorityViolations": 0,
        "storageWarnings": 0, "coreWarnings": 0, "maxWebRssKiB": 0,
        "minFreeBytes": None, "initial": None, "final": None,
    }
    last_wall = started_wall - 1
    with samples_path.open("x", encoding="ascii", buffering=1) as samples:
        while True:
            sample_started = time.time()
            index = aggregates["samples"]
            sample: dict[str, Any] = {"index": index, "atUtc": utc_now(), "errors": []}
            try:
                services = {unit: service_state(unit) for unit in SERVICES}
                sample["services"] = services
                web = services["mkddc-web-pi"]
                sample["webRssKiB"] = rss_kib(web["pid"])
                sample["binarySha256"] = sha256_file(binary)
                disk = shutil.disk_usage(storage_path)
                sample["disk"] = {"totalBytes": disk.total, "usedBytes": disk.used, "freeBytes": disk.free}
                sample["database"] = database_sample(historian_db, legacy_db, index % args.integrity_every == 0)
                sample["journal"] = journal_counts(last_wall, sample_started)

                if any(state["active"] != "active" or state["sub"] != "running" for state in services.values()):
                    aggregates["serviceFailures"] += 1
                if any(state["restarts"] != 0 for state in services.values()):
                    aggregates["restartViolations"] += 1
                if sample["binarySha256"] != args.expected_hash:
                    aggregates["hashMismatches"] += 1
                activation = sample["database"]["activation"]
                if activation != ["active", "v2", 1, 1, 0] and tuple(activation or ()) != ("active", "v2", 1, 1, 0):
                    aggregates["authorityViolations"] += 1
                if sample["database"]["quickCheck"] not in (None, "ok"):
                    aggregates["integrityErrors"] += 1
                aggregates["storageWarnings"] += sample["journal"]["storage"]
                aggregates["coreWarnings"] += sample["journal"]["core"]
                if sample["webRssKiB"] is not None:
                    aggregates["maxWebRssKiB"] = max(aggregates["maxWebRssKiB"], sample["webRssKiB"])
                free = sample["disk"]["freeBytes"]
                aggregates["minFreeBytes"] = free if aggregates["minFreeBytes"] is None else min(aggregates["minFreeBytes"], free)
                counts = {key: sample["database"][key] for key in ("hotCount", "gapCount", "legacyCount")}
                if aggregates["initial"] is None:
                    aggregates["initial"] = counts
                aggregates["final"] = counts
            except Exception as error:  # Keep monitoring after a bounded sample failure.
                sample["errors"].append(f"{type(error).__name__}: {error}")
                aggregates["sampleErrors"] += 1

            samples.write(json.dumps(sample, ensure_ascii=True, separators=(",", ":")) + "\n")
            samples.flush()
            os.fsync(samples.fileno())
            aggregates["samples"] += 1
            last_wall = sample_started
            elapsed = time.monotonic() - started_mono
            if stop_requested or elapsed >= args.duration_seconds:
                break
            deadline = started_mono + aggregates["samples"] * args.interval_seconds
            time.sleep(max(0.0, min(deadline - time.monotonic(), args.interval_seconds)))

    elapsed = time.monotonic() - started_mono
    initial = aggregates["initial"] or {}
    final = aggregates["final"] or {}
    deltas = {key: final.get(key, 0) - initial.get(key, 0) for key in ("hotCount", "gapCount", "legacyCount")}
    summary = {
        **aggregates,
        "kind": "historian-24h-soak-summary",
        "finishedAtUtc": utc_now(),
        "elapsedSeconds": round(elapsed, 3),
        "complete": elapsed >= args.duration_seconds and not stop_requested,
        "deltas": deltas,
        "pass": (
            elapsed >= args.duration_seconds and not stop_requested and aggregates["sampleErrors"] == 0
            and aggregates["serviceFailures"] == 0 and aggregates["restartViolations"] == 0
            and aggregates["hashMismatches"] == 0 and aggregates["integrityErrors"] == 0
            and aggregates["authorityViolations"] == 0 and aggregates["storageWarnings"] == 0
            and deltas["legacyCount"] == 0
        ),
    }
    write_json_exclusive(summary_path, summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
