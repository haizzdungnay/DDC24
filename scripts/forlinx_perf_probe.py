#!/usr/bin/env python3
"""Probe đọc-chỉ đo hiệu năng bo Forlinx theo giao thức Plan 63 §6.

Authority: docs/03_implementation/63_FORLINX_PERFORMANCE_REMEDIATION_PLAN.md
(§4.1 T63-001, §6). Script chạy TRÊN HOST, nói chuyện với bo qua hai kênh:

* HTTP tới web API của bo (tải chuẩn §6.2 + snapshot API đầu/cuối cửa sổ);
* một lệnh SSH do người chạy truyền vào (``--ssh``) để đọc ``/proc``, ``/sys``
  và — CHỈ SAU cửa sổ đo — ``journalctl --since/--until``.

Ba quy tắc không được nới:

1. **Đọc-chỉ.** Không ghi file trên bo, không đổi Program/output, không restart
   service. Mọi request HTTP là GET, trừ POST ``/auth/login`` để lấy token.
2. **Không quét journal trong cửa sổ đo** (Plan 63 §3.2, §6.1). Mọi lệnh gửi lên
   bo được ghi vào ``commands.log`` kèm dấu thời gian UTC và pha
   (``pre``/``window``/``post``); ``summary.json`` đếm lại số lệnh journal rơi
   vào pha ``window`` và phải bằng 0.
3. **Không ghi bí mật vào evidence.** Mật khẩu web đọc từ biến môi trường
   ``MKDDC_PROBE_PASSWORD``; token chỉ nằm trong bộ nhớ. Lệnh SSH ghi vào
   ``commands.log`` đã bỏ đường dẫn key.

Lệnh con:

``run``        đo N lượt (mặc định 2 × 30 phút, nghỉ 5 phút) và ghi thư mục evidence.
``summarize``  tính lại ``summary.json`` từ dữ liệu thô đã ghi (không cần bo).
``selftest``   kiểm các bộ parse/tính toán bằng fixture trong file (chạy trên host).
``emmc``       T63-110: đo 24 giờ nguồn ghi eMMC (``/proc/diskstats`` + ``write_bytes``
               từng tiến trình), định danh chip/``life_time``, cấu hình journald.
``summarize-emmc`` tính lại ``emmc-summary.json`` (tuỳ chọn ``--endurance-tbw`` theo datasheet).

Mức bằng chứng: số đo do ``run`` sinh ra là TARGET (bo thật, Fake MCU hay MCU
thật ghi ở ``provenance.iobus_mode``); ``selftest`` chỉ là HOST.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple

PROBE_VERSION = "1.0"

# Unit được theo dõi. Hai helper chạy chung binary với web (DEPLOY_FOXLINX bước 6).
UNITS = (
    "mkddc-core",
    "mkddc-iobus",
    "mkddc-web-pi",
    "mkddc-reload-helper",
    "mkddc-time-helper",
)
# Unit có log phút được parse sau cửa sổ.
LOG_UNITS = ("mkddc-core", "mkddc-iobus", "mkddc-web-pi")

SAMPLE_PERIOD_S = 5  # Plan 63 §6.3: CPU/RSS, MemAvailable mỗi 5 s.
CLK_TCK = 100  # Buildroot aarch64: sysconf(_SC_CLK_TCK) = 100.
PAGE_KB = 4  # trang 4 KiB trên RV1126B.
SECTOR_BYTES = 512
DEFAULT_DISK = "mmcblk0"

# Tải chuẩn §6.2.
LOAD_ROUTES = (
    ("/api/v1/points", 5.0),
    ("/api/v1/system/status", 1.0),
)

# Khoá log phút được coi là bộ đếm TÍCH LUỸ (lấy last-first), còn lại coi là
# giá trị theo phút (lấy max/sum). Danh sách khớp định dạng tại main@2e53d4a0
# (core.jitter, iobus.jitter) và trường mới của T63-004/T63-005.
CUMULATIVE_KEYS = {
    ("core.jitter", "overruns"),
    ("core.jitter", "violations"),
    ("core.jitter", "missed_steps"),
    ("core.jitter", "seqlock_fail"),
    ("iobus.jitter", "overruns"),
}


# ---------------------------------------------------------------------------
# Tiện ích chung
# ---------------------------------------------------------------------------


def utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def percentile(values: List[float], pct: float) -> Optional[float]:
    """Percentile nearest-rank, cùng quy ước với audit 28/09."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, int(-(-pct * len(ordered) // 100)))  # ceil(pct/100 * n)
    return ordered[min(rank, len(ordered)) - 1]


KV_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=([^\s,]+)")


def parse_kv(text: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, raw in KV_RE.findall(text):
        try:
            out[key] = float(raw) if any(c in raw for c in ".eE") else int(raw)
        except ValueError:
            out[key] = raw
    return out


EVENT_RE = re.compile(r"\b(?:INFO|WARN|ERROR)\s+([a-z_]+\.[a-z_.]+)\b(.*)$")


def parse_log_line(line: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Tách ``<LEVEL>  <event> k=v ...`` từ một dòng journal."""
    match = EVENT_RE.search(line)
    if not match:
        return None
    return match.group(1), parse_kv(match.group(2))


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# Parse dữ liệu /proc do sampler trên bo in ra
# ---------------------------------------------------------------------------


def parse_sampler_stream(text: str) -> List[Dict[str, Any]]:
    """Parse luồng ``@T``/``@CPU``/``@MEM``/``@DISK``/``@PID`` thành từng mẫu."""
    samples: List[Dict[str, Any]] = []
    cur: Optional[Dict[str, Any]] = None
    section = None
    pid = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("@T "):
            parts = line.split()
            cur = {"uptime_s": float(parts[1]), "epoch": int(parts[2]), "cpu": {},
                   "mem": {}, "disk": {}, "pids": {}}
            section = None
            continue
        if cur is None:
            continue
        if line == "@END":
            samples.append(cur)
            cur = None
            continue
        if line in ("@CPU", "@MEM", "@DISK"):
            section = line[1:]
            continue
        if line.startswith("@PID "):
            section = "PID"
            pid = line.split()[1]
            cur["pids"][pid] = {}
            continue
        if section == "CPU" and line.startswith("cpu"):
            fields = line.split()
            cur["cpu"][fields[0]] = [int(x) for x in fields[1:]]
        elif section == "MEM" and ":" in line:
            key, value = line.split(":", 1)
            cur["mem"][key.strip()] = int(value.split()[0])
        elif section == "DISK":
            fields = line.split()
            if len(fields) >= 14:
                cur["disk"][fields[2]] = {
                    "reads": int(fields[3]),
                    "sectors_read": int(fields[5]),
                    "writes": int(fields[7]),
                    "sectors_written": int(fields[9]),
                }
        elif section == "PID" and pid is not None:
            entry = cur["pids"][pid]
            if ")" in line:
                # /proc/<pid>/stat: comm có thể chứa khoảng trắng; tách sau ')'.
                rest = line.rsplit(")", 1)[1].split()
                # rest[0] là state (trường 3); utime/stime là trường 14/15.
                entry["utime"] = int(rest[11])
                entry["stime"] = int(rest[12])
                entry["starttime"] = int(rest[19])
            else:
                fields = line.split()
                if len(fields) >= 2 and fields[0].isdigit():
                    entry["rss_kb"] = int(fields[1]) * PAGE_KB
    return samples


def summarize_samples(samples: List[Dict[str, Any]], pid_units: Dict[str, str],
                      disk: str = DEFAULT_DISK) -> Dict[str, Any]:
    if len(samples) < 2:
        return {"sample_count": len(samples), "note": "không đủ 2 mẫu để tính delta"}
    first, last = samples[0], samples[-1]
    elapsed = last["uptime_s"] - first["uptime_s"]
    out: Dict[str, Any] = {
        "sample_count": len(samples),
        "elapsed_s": round(elapsed, 3),
        "first_epoch": first["epoch"],
        "last_epoch": last["epoch"],
    }
    # CPU hệ thống.
    cpu: Dict[str, Any] = {}
    for name, end in last["cpu"].items():
        start = first["cpu"].get(name)
        if not start:
            continue
        delta = [b - a for a, b in zip(start, end)]
        total = sum(delta[:8]) or 1
        idle = delta[3] + (delta[4] if len(delta) > 4 else 0)
        cpu[name] = {
            "busy_pct": round(100.0 * (total - idle) / total, 3),
            "iowait_pct": round(100.0 * delta[4] / total, 3) if len(delta) > 4 else None,
        }
    out["cpu"] = cpu
    # MemAvailable.
    avail = [s["mem"].get("MemAvailable") for s in samples if s["mem"].get("MemAvailable")]
    out["mem_available_kb"] = {"min": min(avail), "max": max(avail)} if avail else None
    # eMMC.
    d0, d1 = first["disk"].get(disk), last["disk"].get(disk)
    if d0 and d1 and elapsed > 0:
        out["disk"] = {
            "device": disk,
            "write_bytes_per_s": round((d1["sectors_written"] - d0["sectors_written"])
                                       * SECTOR_BYTES / elapsed, 1),
            "write_iops": round((d1["writes"] - d0["writes"]) / elapsed, 3),
            "read_bytes_per_s": round((d1["sectors_read"] - d0["sectors_read"])
                                      * SECTOR_BYTES / elapsed, 1),
        }
    else:
        out["disk"] = None
    # Từng tiến trình.
    procs: Dict[str, Any] = {}
    for pid, unit in pid_units.items():
        rows = [s["pids"].get(pid) for s in samples if s["pids"].get(pid, {}).get("utime") is not None]
        if len(rows) < 2:
            procs[unit] = {"pid": pid, "note": "không đủ mẫu"}
            continue
        restarted = len({r["starttime"] for r in rows}) > 1
        ticks = (rows[-1]["utime"] + rows[-1]["stime"]) - (rows[0]["utime"] + rows[0]["stime"])
        rss = [r["rss_kb"] for r in rows if "rss_kb" in r]
        procs[unit] = {
            "pid": pid,
            "cpu_pct_one_core": round(100.0 * ticks / CLK_TCK / elapsed, 3) if elapsed > 0 else None,
            "rss_first_kb": rss[0] if rss else None,
            "rss_last_kb": rss[-1] if rss else None,
            "rss_max_kb": max(rss) if rss else None,
            "restarted_in_window": restarted,
        }
    out["processes"] = procs
    return out


# ---------------------------------------------------------------------------
# Parse log phút và access log (thu SAU cửa sổ)
# ---------------------------------------------------------------------------


def summarize_minute_logs(lines: Iterable[str]) -> Dict[str, Any]:
    """Gom log phút theo sự kiện: first/last/max/sum từng khoá số."""
    events: Dict[str, Dict[str, List[float]]] = {}
    counts: Dict[str, int] = {}
    for line in lines:
        parsed = parse_log_line(line)
        if not parsed:
            continue
        event, kv = parsed
        if event == "http" or event.startswith("http."):
            continue
        counts[event] = counts.get(event, 0) + 1
        bucket = events.setdefault(event, {})
        for key, value in kv.items():
            if isinstance(value, (int, float)):
                bucket.setdefault(key, []).append(float(value))
    out: Dict[str, Any] = {}
    for event, keys in events.items():
        info: Dict[str, Any] = {"lines": counts[event]}
        for key, values in keys.items():
            entry = {"first": values[0], "last": values[-1], "max": max(values),
                     "sum": round(sum(values), 3)}
            if (event, key) in CUMULATIVE_KEYS:
                entry["delta"] = values[-1] - values[0]
            info[key] = entry
        out[event] = info
    return out


HTTP_RE = re.compile(r"INFO http method=(\S+) path=(\S+) status=(\d+) dur_ms=(\d+)")


def summarize_access_log(lines: Iterable[str]) -> Dict[str, Any]:
    routes: Dict[str, Dict[str, Any]] = {}
    total = 0
    for line in lines:
        match = HTTP_RE.search(line)
        if not match:
            continue
        total += 1
        method, path, status, dur = match.groups()
        key = f"{method} {path}"
        route = routes.setdefault(key, {"statuses": {}, "dur_ms": []})
        route["statuses"][status] = route["statuses"].get(status, 0) + 1
        route["dur_ms"].append(float(dur))
    out: Dict[str, Any] = {"access_lines": total, "routes": {}}
    for key, route in sorted(routes.items(), key=lambda kv: -len(kv[1]["dur_ms"])):
        durs = route["dur_ms"]
        out["routes"][key] = {
            "n": len(durs),
            "statuses": route["statuses"],
            "server_p50_ms": percentile(durs, 50),
            "server_p95_ms": percentile(durs, 95),
            "server_max_ms": max(durs),
        }
    return out


def count_lines_per_hour(lines: List[str], window_s: float, needle: Optional[str] = None) -> Dict[str, Any]:
    n = sum(1 for line in lines if needle is None or needle in line)
    return {"lines": n, "lines_per_hour": round(n * 3600.0 / window_s, 1) if window_s > 0 else None}


# ---------------------------------------------------------------------------
# Snapshot API
# ---------------------------------------------------------------------------


def declared_periods(snapshot: Any) -> Dict[str, Optional[float]]:
    """Chu kỳ khai báo trong Revision: schema v2 ở ``programConfig`` từng
    PROGRAM; schema v1 ở TASK duy nhất (checks_topology.go)."""
    programs: Dict[str, Optional[float]] = {}
    task_period: List[float] = []

    def payload_of(node: Dict[str, Any]) -> Dict[str, Any]:
        payload = node.get("payload", node)
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                return {}
        return payload if isinstance(payload, dict) else {}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            kind = node.get("kind")
            if kind == "PROGRAM":
                payload = payload_of(node)
                config = payload.get("programConfig") or {}
                pid = config.get("programId") or payload.get("objectId") or node.get("objectId")
                if pid:
                    programs[str(pid)] = config.get("periodMs")
            elif kind == "TASK":
                period = payload_of(node).get("periodMs")
                if isinstance(period, (int, float)):
                    task_period.append(float(period))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(snapshot)
    if len(task_period) == 1:
        for pid, period in programs.items():
            if not period:
                programs[pid] = task_period[0]
    return programs


def program_items(programs_doc: Any) -> List[Dict[str, Any]]:
    if isinstance(programs_doc, dict):
        for key in ("items", "programs"):
            if isinstance(programs_doc.get(key), list):
                return programs_doc[key]
    return programs_doc if isinstance(programs_doc, list) else []


def compare_periods(declared: Dict[str, Optional[float]], items: List[Dict[str, Any]]) -> Dict[str, Any]:
    rows = []
    mismatches = 0
    for item in items:
        pid = str(item.get("programId"))
        effective = item.get("periodMs")
        want = declared.get(pid)
        match = want is not None and effective is not None and float(want) == float(effective)
        if not match:
            mismatches += 1
        rows.append({"programId": pid, "declaredPeriodMs": want, "effectivePeriodMs": effective,
                     "enabled": item.get("enabled"), "match": match})
    return {"programs": rows, "mismatches": mismatches, "checked": len(rows)}


def numeric_deltas(start: Any, end: Any, prefix: str = "") -> Dict[str, float]:
    """Delta mọi trường số cùng đường dẫn giữa hai snapshot JSON."""
    out: Dict[str, float] = {}
    if isinstance(start, dict) and isinstance(end, dict):
        for key in end:
            if key in start:
                out.update(numeric_deltas(start[key], end[key], f"{prefix}.{key}" if prefix else key))
    elif isinstance(start, list) and isinstance(end, list) and len(start) == len(end):
        for idx, (a, b) in enumerate(zip(start, end)):
            out.update(numeric_deltas(a, b, f"{prefix}[{idx}]"))
    elif isinstance(start, (int, float)) and isinstance(end, (int, float)) \
            and not isinstance(start, bool) and not isinstance(end, bool):
        out[prefix] = end - start
    return out


def summarize_runtime(pre: Dict[str, Any], post: Dict[str, Any]) -> Dict[str, Any]:
    rt0 = (pre.get("programming_runtime") or {})
    rt1 = (post.get("programming_runtime") or {})
    t0, t1 = rt0.get("task") or {}, rt1.get("task") or {}
    task = {}
    for key in ("missedReleaseCount", "overrunCount", "jitterViolationCount", "missedBaseStepCount", "runCount"):
        a, b = t0.get(key), t1.get(key)
        task[key] = {"pre": a, "post": b, "delta": (b - a) if isinstance(a, int) and isinstance(b, int) else None}
    task["jitterMaxUs_post"] = t1.get("jitterMaxUs")
    task["maxExecNs_post"] = t1.get("maxExecNs")
    task["state_post"] = t1.get("state")
    programs = []
    pre_items = {str(i.get("programId")): i for i in program_items(pre.get("programs"))}
    for item in program_items(post.get("programs")):
        pid = str(item.get("programId"))
        before = pre_items.get(pid, {})
        a, b = before.get("missedReleaseCount"), item.get("missedReleaseCount")
        programs.append({
            "programId": pid,
            "missedRelease_pre": a,
            "missedRelease_post": b,
            "missedRelease_delta": (b - a) if isinstance(a, int) and isinstance(b, int) else None,
            "maxExecNs_post": item.get("maxExecNs"),
        })
    return {
        "activeRevision_pre": rt0.get("activeRevisionId"),
        "activeRevision_post": rt1.get("activeRevisionId"),
        "activeRevision_unchanged": rt0.get("activeRevisionId") == rt1.get("activeRevisionId"),
        "task": task,
        "programs": programs,
    }


# ---------------------------------------------------------------------------
# Kênh bo: SSH + HTTP
# ---------------------------------------------------------------------------


class CommandLog:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()
        self.phase = "pre"

    def write(self, kind: str, text: str) -> None:
        with self.lock, open(self.path, "a", encoding="utf-8") as handle:
            handle.write(f"{utc_now()}\t{self.phase}\t{kind}\t{text}\n")


def redact_ssh(argv: List[str]) -> str:
    out = []
    skip = False
    for tok in argv:
        if skip:
            out.append("<key>")
            skip = False
            continue
        out.append(tok)
        if tok == "-i":
            skip = True
    return " ".join(out)


class Board:
    def __init__(self, ssh: str, base_url: str, log: CommandLog, username: str, password: Optional[str]):
        self.ssh = shlex.split(ssh)
        self.base_url = base_url.rstrip("/")
        self.log = log
        self.username = username
        self.password = password
        self.token: Optional[str] = None
        self.token_at = 0.0

    # --- SSH ---
    def sh(self, script: str, timeout: float = 60.0) -> str:
        if "journalctl" in script and self.log.phase == "window":
            raise RuntimeError("cấm journalctl trong cửa sổ đo (Plan 63 §6.1)")
        self.log.write("ssh", f"{redact_ssh(self.ssh)} {script!r}")
        proc = subprocess.run(self.ssh + [script], capture_output=True, text=True, timeout=timeout)
        if proc.returncode != 0:
            raise RuntimeError(f"ssh exit {proc.returncode}: {proc.stderr.strip()[:300]}")
        return proc.stdout

    def spawn(self, script: str) -> subprocess.Popen:
        self.log.write("ssh-stream", f"{redact_ssh(self.ssh)} {script!r}")
        return subprocess.Popen(self.ssh + [script], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    # --- HTTP ---
    def login(self) -> None:
        if not self.password:
            raise RuntimeError("thiếu MKDDC_PROBE_PASSWORD")
        body = json.dumps({"username": self.username, "password": self.password}).encode()
        req = urllib.request.Request(self.base_url + "/api/v1/auth/login", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        self.log.write("http", "POST /api/v1/auth/login")
        with urllib.request.urlopen(req, timeout=10) as resp:
            self.token = json.loads(resp.read()).get("token")
        self.token_at = time.monotonic()

    def ensure_token(self) -> None:
        # Token sống 3600 s; làm mới sau 40 phút để không rơi giữa cửa sổ.
        if self.token is None or time.monotonic() - self.token_at > 2400:
            self.login()

    def get(self, path: str, timeout: float = 10.0, log: bool = True) -> Tuple[int, float, bytes]:
        if log:
            self.log.write("http", f"GET {path}")
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        req = urllib.request.Request(self.base_url + path, headers=headers)
        start = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                return resp.status, (time.monotonic() - start) * 1000.0, body
        except urllib.error.HTTPError as err:
            return err.code, (time.monotonic() - start) * 1000.0, err.read()
        except (urllib.error.URLError, OSError):
            return 0, (time.monotonic() - start) * 1000.0, b""

    def get_json(self, path: str) -> Any:
        status, _, body = self.get(path)
        if status != 200:
            return {"_status": status}
        try:
            return json.loads(body)
        except ValueError:
            return {"_status": status, "_error": "json"}


PROVENANCE_SCRIPT = r"""
for u in {units}; do
  p=$(systemctl show -p MainPID --value $u 2>/dev/null)
  t=$(systemctl show -p ExecMainStartTimestamp --value $u 2>/dev/null)
  if [ -n "$p" ] && [ "$p" != 0 ]; then
    e=$(readlink /proc/$p/exe); s=$(sha256sum /proc/$p/exe | cut -d' ' -f1)
  else e=; s=; fi
  echo "UNIT $u|$p|$t|$e|$s"
done
echo "INDEX $(sha256sum /opt/mkddc-web/dist/index.html 2>/dev/null | cut -d' ' -f1)"
for z in /sys/class/thermal/thermal_zone*; do echo "TEMP $(cat $z/type 2>/dev/null)|$(cat $z/temp 2>/dev/null)"; done
for c in /sys/devices/system/cpu/cpu[0-9]*; do
  echo "CPUFREQ $(basename $c)|$(cat $c/cpufreq/scaling_governor 2>/dev/null)|$(cat $c/cpufreq/scaling_cur_freq 2>/dev/null)"
done
echo "UPTIME $(cat /proc/uptime)"
echo "KERNEL $(uname -r)"
for f in /data/mkddc/provenance.json /opt/mkddc/provenance.json /usr/share/mkddc/provenance.json \
         /usr/share/mkddc/artifact-manifest.json; do
  [ -f "$f" ] && echo "MANIFEST $f|$(sha256sum $f | cut -d' ' -f1)"
done
echo "IOBUS_DROPINS $(ls /etc/systemd/system/mkddc-iobus.service.d 2>/dev/null | tr '\n' ' ')"
"""


def parse_provenance(text: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"units": {}, "thermal": {}, "cpufreq": {}, "manifests": {}}
    for line in text.splitlines():
        tag, _, rest = line.partition(" ")
        if tag == "UNIT":
            unit, pid, started, exe, sha = (rest.split("|") + [""] * 5)[:5]
            out["units"][unit] = {"main_pid": pid, "started": started, "exe": exe, "exe_sha256": sha}
        elif tag == "INDEX":
            out["index_html_sha256"] = rest.strip() or None
        elif tag == "TEMP":
            name, _, value = rest.partition("|")
            out["thermal"][name] = int(value) / 1000.0 if value.strip().lstrip("-").isdigit() else None
        elif tag == "CPUFREQ":
            cpu, gov, freq = (rest.split("|") + ["", ""])[:3]
            out["cpufreq"][cpu] = {"governor": gov or None, "cur_khz": int(freq) if freq.isdigit() else None}
        elif tag == "UPTIME":
            out["uptime_s"] = float(rest.split()[0])
        elif tag == "KERNEL":
            out["kernel"] = rest.strip()
        elif tag == "MANIFEST":
            path, _, sha = rest.partition("|")
            out["manifests"][path] = sha
        elif tag == "IOBUS_DROPINS":
            names = rest.split()
            out["iobus_dropins"] = names
            out["iobus_mode"] = "FAKE_MCU" if any("nomcu" in n for n in names) else "UNKNOWN"
    return out


def sampler_script(pids: List[str]) -> str:
    pid_list = " ".join(p for p in pids if p and p != "0")
    return (
        f"while :; do echo \"@T $(cut -d' ' -f1 /proc/uptime) $(date +%s)\"; "
        "echo @CPU; sed -n '/^cpu/p' /proc/stat; "
        "echo @MEM; sed -n '/^MemAvailable/p;/^MemFree/p' /proc/meminfo; "
        "echo @DISK; cat /proc/diskstats; "
        f"for p in {pid_list}; do echo \"@PID $p\"; cat /proc/$p/stat 2>/dev/null; cat /proc/$p/statm 2>/dev/null; done; "
        f"echo @END; sleep {SAMPLE_PERIOD_S}; done"
    )


def api_snapshot(board: Board) -> Dict[str, Any]:
    board.ensure_token()
    snap: Dict[str, Any] = {"at": utc_now()}
    snap["programming_runtime"] = board.get_json("/api/v1/programming/runtime")
    snap["system_status"] = board.get_json("/api/v1/system/status")
    snap["modbus_buses"] = board.get_json("/api/v1/modbus/buses")
    projects = board.get_json("/api/v1/programming/projects")
    snap["projects"] = projects
    active = (snap["programming_runtime"] or {}).get("activeRevisionId")
    if active:
        revision = board.get_json(f"/api/v1/programming/revisions/{active}")
        project_id = revision.get("projectId") if isinstance(revision, dict) else None
        snap["active_revision"] = {"revisionId": active, "projectId": project_id,
                                   "state": revision.get("state") if isinstance(revision, dict) else None,
                                   "sequence": revision.get("sequence") if isinstance(revision, dict) else None}
        snap["declared_periods"] = declared_periods(revision.get("snapshot") if isinstance(revision, dict) else None)
        if project_id:
            snap["programs"] = board.get_json(f"/api/v1/programming/projects/{project_id}/programs")
    return snap


class LoadGenerator:
    """Tải chuẩn §6.2: /points 5 GET/s và /system/status 1 GET/s, nhịp cố định."""

    def __init__(self, board: Board, duration_s: float):
        self.board = board
        self.duration_s = duration_s
        self.results: Dict[str, List[Tuple[int, float]]] = {path: [] for path, _ in LOAD_ROUTES}
        self.lock = threading.Lock()

    def _worker(self, path: str, rate: float, stop_at: float) -> None:
        period = 1.0 / rate
        next_at = time.monotonic()
        while next_at < stop_at:
            status, ms, _ = self.board.get(path, log=False)
            if status == 401:
                with self.lock:
                    self.board.login()
            with self.lock:
                self.results[path].append((status, ms))
            next_at += period
            # Lỡ nhịp thì bỏ mốc (không bắn dồn), để tải thật đúng 5/1 GET/s.
            now = time.monotonic()
            if next_at < now:
                next_at = now + period - ((now - next_at) % period)
            time.sleep(max(0.0, next_at - time.monotonic()))

    def run(self) -> None:
        self.board.log.write("load", "start " + ", ".join(f"{p}@{r}/s" for p, r in LOAD_ROUTES))
        stop_at = time.monotonic() + self.duration_s
        threads = [threading.Thread(target=self._worker, args=(p, r, stop_at), daemon=True) for p, r in LOAD_ROUTES]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.board.log.write("load", "stop")

    def summary(self) -> Dict[str, Any]:
        out = {}
        for path, rows in self.results.items():
            statuses: Dict[str, int] = {}
            for status, _ in rows:
                statuses[str(status)] = statuses.get(str(status), 0) + 1
            ok = [ms for status, ms in rows if status == 200]
            out[path] = {"n": len(rows), "statuses": statuses,
                         "client_p50_ms": percentile(ok, 50), "client_p95_ms": percentile(ok, 95),
                         "client_max_ms": max(ok) if ok else None}
        return out


def run_round(board: Board, out_dir: str, index: int, duration_s: float, disk: str) -> Dict[str, Any]:
    rdir = os.path.join(out_dir, f"round-{index}")
    os.makedirs(rdir, exist_ok=True)
    board.log.phase = "pre"
    prov_text = board.sh(PROVENANCE_SCRIPT.format(units=" ".join(UNITS)))
    provenance = parse_provenance(prov_text)
    with open(os.path.join(rdir, "provenance.json"), "w", encoding="utf-8") as handle:
        json.dump(provenance, handle, ensure_ascii=False, indent=2)
    pre = api_snapshot(board)
    with open(os.path.join(rdir, "api-pre.json"), "w", encoding="utf-8") as handle:
        json.dump(pre, handle, ensure_ascii=False, indent=2)
    pid_units = {info["main_pid"]: unit for unit, info in provenance["units"].items()
                 if info["main_pid"] and info["main_pid"] != "0"}

    board.log.phase = "window"
    window_start = int(time.time())
    board.log.write("window", f"start epoch={window_start}")
    sampler = board.spawn(sampler_script(list(pid_units)))
    load = LoadGenerator(board, duration_s)
    load.run()
    sampler.terminate()
    try:
        sampler_out, _ = sampler.communicate(timeout=15)
    except subprocess.TimeoutExpired:
        sampler.kill()
        sampler_out, _ = sampler.communicate()
    window_end = int(time.time())
    board.log.write("window", f"end epoch={window_end}")
    with open(os.path.join(rdir, "proc-samples.txt"), "w", encoding="utf-8") as handle:
        handle.write(sampler_out)
    with open(os.path.join(rdir, "load.json"), "w", encoding="utf-8") as handle:
        json.dump(load.summary(), handle, ensure_ascii=False, indent=2)

    board.log.phase = "post"
    post = api_snapshot(board)
    with open(os.path.join(rdir, "api-post.json"), "w", encoding="utf-8") as handle:
        json.dump(post, handle, ensure_ascii=False, indent=2)
    for unit in LOG_UNITS:
        text = board.sh(f"journalctl -u {unit} --since @{window_start} --until @{window_end} "
                        "-o short-iso --no-pager", timeout=300)
        with open(os.path.join(rdir, f"journal-{unit}.log"), "w", encoding="utf-8") as handle:
            handle.write(text)
    kernel = board.sh(f"journalctl -k --since @{window_start} --until @{window_end} -o short-iso --no-pager",
                      timeout=300)
    with open(os.path.join(rdir, "journal-kernel.log"), "w", encoding="utf-8") as handle:
        handle.write(kernel)
    meta = {"index": index, "window_start_epoch": window_start, "window_end_epoch": window_end,
            "duration_s": window_end - window_start, "disk": disk, "pid_units": pid_units}
    with open(os.path.join(rdir, "round.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    return meta


def summarize_round(rdir: str) -> Dict[str, Any]:
    def load(name: str) -> Any:
        path = os.path.join(rdir, name)
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as handle:
            return json.load(handle) if name.endswith(".json") else handle.read()

    meta = load("round.json") or {}
    window_s = float(meta.get("duration_s") or 0)
    pre, post = load("api-pre.json") or {}, load("api-post.json") or {}
    samples = parse_sampler_stream(load("proc-samples.txt") or "")
    logs: Dict[str, Any] = {}
    for unit in LOG_UNITS:
        lines = (load(f"journal-{unit}.log") or "").splitlines()
        logs[unit] = {"volume": count_lines_per_hour(lines, window_s),
                      "minute": summarize_minute_logs(lines)}
        if unit == "mkddc-web-pi":
            logs[unit]["access"] = summarize_access_log(lines)
    kernel = (load("journal-kernel.log") or "").splitlines()
    logs["kernel"] = {"volume": count_lines_per_hour(kernel, window_s),
                      "rtw": count_lines_per_hour(kernel, window_s, needle="RTW")}
    core_minute = logs["mkddc-core"]["minute"].get("core.jitter", {})
    seqlock = core_minute.get("seqlock_fail")
    declared = post.get("declared_periods") or {}
    return {
        "round": meta.get("index"),
        "window": {k: meta.get(k) for k in ("window_start_epoch", "window_end_epoch", "duration_s")},
        "provenance": load("provenance.json"),
        "load": load("load.json"),
        "runtime": summarize_runtime(pre, post),
        "period_readback": compare_periods(declared, program_items(post.get("programs"))),
        "core_seqlock_fail": ({"delta": seqlock.get("delta"), "last": seqlock.get("last")} if seqlock
                              else "NOT_EXPOSED: binary Core đang chạy không công bố seqlock_fail "
                                   "(log phút core.jitter không có khoá này)"),
        "iop_deltas": numeric_deltas((pre.get("system_status") or {}).get("iop"),
                                     (post.get("system_status") or {}).get("iop")),
        "modbus_deltas": numeric_deltas(pre.get("modbus_buses"), post.get("modbus_buses")),
        "proc": summarize_samples(samples, meta.get("pid_units") or {}, meta.get("disk") or DEFAULT_DISK),
        "logs": logs,
    }


def journal_in_window(commands_log: str) -> int:
    if not os.path.exists(commands_log):
        return 0
    bad = 0
    with open(commands_log, encoding="utf-8") as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 4 and parts[1] == "window" and "journalctl" in parts[3]:
                bad += 1
    return bad


def write_summary(out_dir: str) -> Dict[str, Any]:
    rounds = sorted(d for d in os.listdir(out_dir) if d.startswith("round-"))
    summary = {
        "probe_version": PROBE_VERSION,
        "probe_sha256": sha256_file(os.path.abspath(__file__)),
        "generated_at": utc_now(),
        "protocol": "Plan 63 §6 — 2 × 30 phút, /points 5 GET/s + /system/status 1 GET/s",
        "journal_commands_in_window": journal_in_window(os.path.join(out_dir, "commands.log")),
        "rounds": [summarize_round(os.path.join(out_dir, r)) for r in rounds],
    }
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    lines = []
    for root, _, files in os.walk(out_dir):
        for name in sorted(files):
            if name == "SHA256SUMS":
                continue
            path = os.path.join(root, name)
            lines.append(f"{sha256_file(path)}  {os.path.relpath(path, out_dir)}")
    with open(os.path.join(out_dir, "SHA256SUMS"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(sorted(lines, key=lambda l: l.split("  ", 1)[1])) + "\n")
    return summary


# ---------------------------------------------------------------------------
# T63-110 — định lượng nguồn ghi eMMC (PERF-SYS-06): cửa sổ 24 giờ
# ---------------------------------------------------------------------------

EMMC_INTERVAL_S = 60
EMMC_ID_SCRIPT = r"""
d=/sys/block/{disk}/device
for f in name manfid oemid date type rev fwrev life_time pre_eol_info; do
  [ -r $d/$f ] && echo "ID $f|$(cat $d/$f 2>/dev/null | tr '\n' ' ')"
done
echo "SIZE $(cat /sys/block/{disk}/size 2>/dev/null)"
cat /proc/mounts | while read dev mnt fs opts rest; do
  case "$dev" in /dev/{disk}*) echo "MOUNT $dev|$mnt|$fs|$opts";; esac
done
echo "JOURNAL_PERSISTENT $( [ -d /var/log/journal ] && echo yes || echo no)"
for f in /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*.conf; do
  [ -r "$f" ] && sed -n '/^[A-Za-z]/s/^/JOURNALD_CONF /p' "$f"
done
true
"""


def emmc_sampler_script(disk: str, interval: int) -> str:
    """Mỗi `interval` giây: diskstats + `write_bytes` của MỌI tiến trình.

    `/proc/<pid>/io` gán byte ghi cho tiến trình làm bẩn page cache — đúng thứ
    cần để chia nguồn ghi (journald, SQLite của web, snapshot Core, …). Chỉ đọc.
    """
    return (
        f"while :; do echo \"@T $(cut -d' ' -f1 /proc/uptime) $(date +%s)\"; "
        f"echo @DISK; sed -n '/ {disk}/p' /proc/diskstats; echo @IO; "
        "for p in /proc/[0-9]*; do "
        "w=$(sed -n 's/^write_bytes: //p' $p/io 2>/dev/null); "
        "[ -n \"$w\" ] && echo \"${p#/proc/} $w $(cat $p/comm 2>/dev/null)\"; done; "
        f"echo @END; sleep {interval}; done"
    )


def parse_emmc_stream(text: str) -> List[Dict[str, Any]]:
    samples: List[Dict[str, Any]] = []
    cur: Optional[Dict[str, Any]] = None
    section = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("@T "):
            parts = line.split()
            cur = {"uptime_s": float(parts[1]), "epoch": int(parts[2]), "disk": {}, "io": {}}
            section = None
        elif cur is None:
            continue
        elif line == "@END":
            samples.append(cur)
            cur = None
        elif line in ("@DISK", "@IO"):
            section = line[1:]
        elif section == "DISK":
            f = line.split()
            if len(f) >= 14:
                cur["disk"][f[2]] = {"writes": int(f[7]), "sectors_written": int(f[9])}
        elif section == "IO":
            f = line.split(None, 2)
            if len(f) >= 2 and f[0].isdigit() and f[1].isdigit():
                cur["io"][f[0]] = (int(f[1]), f[2] if len(f) > 2 else "?")
    return samples


# Ánh xạ comm → nguồn ghi theo bảng AC T63-110. `jbd2`/`kworker` là ghi của
# chính hệ thống file (commit journal ext4, writeback) — tách riêng để không
# gán nhầm cho ứng dụng.
EMMC_SOURCES = (
    ("journald", ("systemd-journal",)),
    ("web (SQLite Programming/historian)", ("mkddc-web",)),
    ("core (snapshot)", ("mkddc-core",)),
    ("iobus", ("mkddc-iobus",)),
    ("hệ thống file (jbd2/kworker)", ("jbd2", "kworker")),
)


def classify_comm(comm: str) -> str:
    for source, prefixes in EMMC_SOURCES:
        if any(comm.startswith(prefix) for prefix in prefixes):
            return source
    return "khác"


def summarize_emmc(samples: List[Dict[str, Any]], disk: str = DEFAULT_DISK,
                   endurance_tbw: Optional[float] = None) -> Dict[str, Any]:
    if len(samples) < 2:
        return {"sample_count": len(samples), "note": "không đủ 2 mẫu"}
    first, last = samples[0], samples[-1]
    elapsed = last["uptime_s"] - first["uptime_s"]
    out: Dict[str, Any] = {"sample_count": len(samples), "elapsed_s": round(elapsed, 1),
                           "first_epoch": first["epoch"], "last_epoch": last["epoch"]}
    parts = {}
    for name, end in last["disk"].items():
        start = first["disk"].get(name)
        if start and elapsed > 0:
            parts[name] = {
                "write_bytes_per_s": round((end["sectors_written"] - start["sectors_written"])
                                           * SECTOR_BYTES / elapsed, 1),
                "write_iops": round((end["writes"] - start["writes"]) / elapsed, 3),
            }
    out["partitions"] = parts
    total = (parts.get(disk) or {}).get("write_bytes_per_s")
    out["device_write_bytes_per_s"] = total
    # Byte ghi theo tiến trình: delta giữa lần đầu và lần cuối THẤY pid đó.
    # Tiến trình sống ngắn hơn một khoảng lấy mẫu không được thấy — phần đó
    # nằm trong "chưa quy nguồn" (tổng thiết bị − tổng đã quy).
    seen_first: Dict[str, Tuple[int, str, float]] = {}
    seen_last: Dict[str, Tuple[int, str, float]] = {}
    for sample in samples:
        for pid, (wbytes, comm) in sample["io"].items():
            key = f"{pid}:{comm}"
            seen_first.setdefault(key, (wbytes, comm, sample["uptime_s"]))
            seen_last[key] = (wbytes, comm, sample["uptime_s"])
    by_source: Dict[str, float] = {}
    by_comm: Dict[str, float] = {}
    for key, (w0, comm, _) in seen_first.items():
        w1 = seen_last[key][0]
        delta = max(0, w1 - w0)
        by_comm[comm] = by_comm.get(comm, 0.0) + delta
        source = classify_comm(comm)
        by_source[source] = by_source.get(source, 0.0) + delta
    rate = (lambda b: round(b / elapsed, 1)) if elapsed > 0 else (lambda b: None)
    out["sources_bytes_per_s"] = {k: rate(v) for k, v in sorted(by_source.items(), key=lambda kv: -kv[1])}
    out["top_comm_bytes_per_s"] = {k: rate(v) for k, v in sorted(by_comm.items(), key=lambda kv: -kv[1])[:15]}
    attributed = sum(by_source.values()) / elapsed if elapsed > 0 else 0.0
    out["attributed_bytes_per_s"] = round(attributed, 1)
    if total is not None:
        out["unattributed_bytes_per_s"] = round(total - attributed, 1)
        out["gb_per_day"] = round(total * 86400 / 1e9, 3)
        out["tb_per_year"] = round(total * 86400 * 365 / 1e12, 3)
        if endurance_tbw:
            out["endurance_tbw"] = endurance_tbw
            out["years_to_endurance"] = round(endurance_tbw / (total * 86400 * 365 / 1e12), 1) if total > 0 else None
    return out


def parse_emmc_identity(text: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"id": {}, "mounts": [], "journald_conf": []}
    for line in text.splitlines():
        tag, _, rest = line.partition(" ")
        if tag == "ID":
            key, _, value = rest.partition("|")
            out["id"][key] = value.strip()
        elif tag == "SIZE":
            out["size_bytes"] = int(rest) * SECTOR_BYTES if rest.strip().isdigit() else None
        elif tag == "MOUNT":
            dev, mnt, fs, opts = (rest.split("|") + ["", "", ""])[:4]
            out["mounts"].append({"dev": dev, "mount": mnt, "fs": fs, "opts": opts})
        elif tag == "JOURNAL_PERSISTENT":
            out["journal_persistent_dir"] = rest.strip() == "yes"
        elif tag == "JOURNALD_CONF":
            out["journald_conf"].append(rest.strip())
    # EXT_CSD DEVICE_LIFE_TIME_EST (JEDEC eMMC 5.0): 0x01 = 0–10% đã dùng, …, 0x0B = vượt.
    life = out["id"].get("life_time", "").split()
    if life:
        def pct(v: str) -> Optional[str]:
            try:
                n = int(v, 16)
            except ValueError:
                return None
            return None if n == 0 else ("vượt tuổi thọ" if n >= 0x0B else f"{(n - 1) * 10}–{n * 10}%")
        out["life_time_used"] = [pct(v) for v in life]
    return out


def run_emmc(board: "Board", out_dir: str, duration_s: float, interval: int, disk: str) -> Dict[str, Any]:
    os.makedirs(out_dir, exist_ok=True)
    board.log.phase = "pre"
    ident = board.sh(EMMC_ID_SCRIPT.format(disk=disk))
    with open(os.path.join(out_dir, "emmc-identity.txt"), "w", encoding="utf-8") as handle:
        handle.write(ident)
    usage_pre = board.sh("journalctl --disk-usage 2>&1 || true")
    board.log.phase = "window"
    start = int(time.time())
    board.log.write("window", f"emmc start epoch={start}")
    chunks: List[str] = []
    deadline = time.monotonic() + duration_s
    while time.monotonic() < deadline:
        # Luồng SSH có thể đứt trong 24 giờ: nối lại và ghi khoảng hở; bộ đếm
        # /proc là tích luỹ nên tổng thiết bị không mất, chỉ mất tiến trình
        # sống trọn trong khoảng hở.
        proc = board.spawn(emmc_sampler_script(disk, interval))
        try:
            text, _ = proc.communicate(timeout=max(1.0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            proc.terminate()
            text, _ = proc.communicate()
        chunks.append(text)
        if time.monotonic() < deadline:
            board.log.write("window", "emmc stream đứt — nối lại")
            time.sleep(5)
    end = int(time.time())
    board.log.write("window", f"emmc end epoch={end}")
    board.log.phase = "post"
    usage_post = board.sh("journalctl --disk-usage 2>&1 || true")
    with open(os.path.join(out_dir, "emmc-samples.txt"), "w", encoding="utf-8") as handle:
        handle.write("".join(chunks))
    meta = {"disk": disk, "interval_s": interval, "window_start_epoch": start, "window_end_epoch": end,
            "journal_disk_usage_pre": usage_pre.strip(), "journal_disk_usage_post": usage_post.strip()}
    with open(os.path.join(out_dir, "emmc-window.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    return meta


def write_emmc_summary(out_dir: str, endurance_tbw: Optional[float]) -> Dict[str, Any]:
    with open(os.path.join(out_dir, "emmc-window.json"), encoding="utf-8") as handle:
        meta = json.load(handle)
    with open(os.path.join(out_dir, "emmc-samples.txt"), encoding="utf-8") as handle:
        samples = parse_emmc_stream(handle.read())
    with open(os.path.join(out_dir, "emmc-identity.txt"), encoding="utf-8") as handle:
        ident = parse_emmc_identity(handle.read())
    summary = {"probe_version": PROBE_VERSION, "probe_sha256": sha256_file(os.path.abspath(__file__)),
               "generated_at": utc_now(), "window": meta, "identity": ident,
               "writes": summarize_emmc(samples, meta.get("disk") or DEFAULT_DISK, endurance_tbw)}
    with open(os.path.join(out_dir, "emmc-summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    return summary



# ---------------------------------------------------------------------------
# selftest — fixture đúng định dạng log/proc tại main@2e53d4a0
# ---------------------------------------------------------------------------

FIXTURE_SAMPLER = """@T 100.00 1759030000
@CPU
cpu  1000 0 500 8000 10 0 5 0 0 0
cpu0 250 0 125 2000 3 0 1 0 0 0
@MEM
MemFree:          500000 kB
MemAvailable:     700000 kB
@DISK
 179       0 mmcblk0 100 0 2000 50 1000 0 20000 900 0 0 0 0 0 0 0
@PID 42
42 (mkddc-core) S 1 42 42 0 -1 4194560 0 0 0 0 100 50 0 0 -81 0 5 0 777 0 0
5000 6226 100 1 0 200 0
@END
@T 110.00 1759030010
@CPU
cpu  1100 0 550 8850 10 0 5 0 0 0
cpu0 275 0 137 2212 3 0 1 0 0 0
@MEM
MemFree:          499000 kB
MemAvailable:     690000 kB
@DISK
 179       0 mmcblk0 110 0 2100 55 1100 0 22048 950 0 0 0 0 0 0 0
@PID 42
42 (mkddc-core) S 1 42 42 0 -1 4194560 0 0 0 0 130 70 0 0 -81 0 5 0 777 0 0
5000 6300 100 1 0 200 0
@END
"""

FIXTURE_JOURNAL = """2026-09-28T02:54:11+0000 som mkddc-core[1]: INFO  core.jitter min_us=8.11 max_us=55.06 avg_us=14.13 overruns=0 count=6001 window_max_us=56 violations=9 missed_steps=0 base_step_us=10000 seqlock_fail=0
2026-09-28T02:55:11+0000 som mkddc-core[1]: INFO  core.jitter min_us=8.28 max_us=141.19 avg_us=19.25 overruns=0 count=6000 window_max_us=142 violations=14 missed_steps=0 base_step_us=10000 seqlock_fail=2
2026-09-28T02:55:11+0000 som mkddc-core[1]: INFO  core.wake_hist le25=5000 le50=900 le100=86 le200=10 le500=3 gt500=1 base_step_us=10000
2026-09-28T02:55:11+0000 som mkddc-core[1]: INFO  core.step_wcet io_us=233 ipc_us=6 sched_us=18 logic_us=15 alarm_us=4 ext_us=3 out_us=44 publish_us=100 total_us=315 base_step_us=10000 scans=6000
2026-09-28T02:55:31+0000 som mkddc-iobus[2]: INFO  iobus.jitter min_us=2.62 max_us=8629.30 avg_us=19.68 overruns=58 count=30001
2026-09-28T02:56:31+0000 som mkddc-iobus[2]: INFO  iobus.jitter min_us=6.41 max_us=11594.74 avg_us=28.74 overruns=26344 count=30000
2026-09-28T02:56:31+0000 som mkddc-iobus[2]: INFO  iobus.loop_timing wake_late_max_us=51 work_max_us=16000 io_resp_gap_max_us=16600 late_events=1 catchup_iterations=24 iterations=30000 io_resp_count=29990 period_us=2000
2026-09-28T02:56:32+0000 som mkddc-web[3]: INFO http method=GET path=/api/v1/points status=200 dur_ms=12 remote=10.0.0.2:5000
2026-09-28T02:56:32+0000 som mkddc-web[3]: INFO http method=GET path=/api/v1/points status=503 dur_ms=3 remote=10.0.0.2:5000
2026-09-28T02:56:33+0000 som mkddc-web[3]: INFO http method=GET path=/api/v1/system/status status=200 dur_ms=115 remote=10.0.0.2:5001
"""

FIXTURE_REVISION = {
    "manifest": {"schemaVersion": 2},
    "objects": [
        {"objectId": "o1", "kind": "PROGRAM",
         "payload": {"objectId": "o1", "programConfig": {"programId": "P1", "periodMs": 10}}},
        {"objectId": "o2", "kind": "PROGRAM",
         "payload": {"objectId": "o2", "programConfig": {"programId": "P2", "periodMs": 100}}},
    ],
}


FIXTURE_EMMC = """@T 1000.0 1759030000
@DISK
 179       0 mmcblk0 10 0 20 5 1000 0 100000 900 0 0 0 0 0 0 0
 179       6 mmcblk0p6 5 0 10 2 800 0 80000 700 0 0 0 0 0 0 0
@IO
1 0 systemd
201 5000000 systemd-journal
300 1000000 mkddc-web
400 0 mkddc-core
55 100 jbd2/mmcblk0p6-8
@END
@T 1100.0 1759030100
@DISK
 179       0 mmcblk0 10 0 20 5 1500 0 300000 950 0 0 0 0 0 0 0
 179       6 mmcblk0p6 5 0 10 2 1200 0 240000 750 0 0 0 0 0 0 0
@IO
1 0 systemd
201 6000000 systemd-journal
300 1500000 mkddc-web
400 204800 mkddc-core
55 51300 jbd2/mmcblk0p6-8
@END
"""


def selftest() -> int:
    failures: List[str] = []

    def expect(name: str, cond: bool) -> None:
        print(("PASS " if cond else "FAIL ") + name)
        if not cond:
            failures.append(name)

    samples = parse_sampler_stream(FIXTURE_SAMPLER)
    expect("sampler: 2 mẫu", len(samples) == 2)
    proc = summarize_samples(samples, {"42": "mkddc-core"})
    expect("proc: elapsed 10 s", proc["elapsed_s"] == 10.0)
    # utime+stime 150 → 200 ticks = 50 ticks / 100 Hz / 10 s = 5 %.
    expect("proc: cpu 5 % một core", proc["processes"]["mkddc-core"]["cpu_pct_one_core"] == 5.0)
    expect("proc: rss 6300*4 kB", proc["processes"]["mkddc-core"]["rss_last_kb"] == 25200)
    expect("proc: không restart", proc["processes"]["mkddc-core"]["restarted_in_window"] is False)
    # 2048 sector * 512 B / 10 s = 104857.6 B/s; 100 lần ghi / 10 s = 10 IOPS.
    expect("disk: write B/s", proc["disk"]["write_bytes_per_s"] == 104857.6)
    expect("disk: write IOPS", proc["disk"]["write_iops"] == 10.0)
    expect("mem: MemAvailable min", proc["mem_available_kb"]["min"] == 690000)
    # cpu tổng: delta = 100+50+850 = 1000, idle 850 ⇒ busy 15 %.
    expect("cpu: busy 15 %", proc["cpu"]["cpu"]["busy_pct"] == 15.0)

    lines = FIXTURE_JOURNAL.splitlines()
    minute = summarize_minute_logs(lines)
    expect("log: core.jitter 2 dòng", minute["core.jitter"]["lines"] == 2)
    expect("log: violations delta 5", minute["core.jitter"]["violations"]["delta"] == 5.0)
    expect("log: jitter max 141.19", minute["core.jitter"]["max_us"]["max"] == 141.19)
    expect("log: iobus overruns delta", minute["iobus.jitter"]["overruns"]["delta"] == 26286.0)
    expect("log: step_wcet total", minute["core.step_wcet"]["total_us"]["max"] == 315.0)
    # T63-005: seqlock_fail tích luỹ (delta), wake_hist theo phút (sum).
    expect("log: core.jitter seqlock_fail delta", minute["core.jitter"]["seqlock_fail"]["delta"] == 2.0)
    expect("log: core.wake_hist gt500 sum", minute["core.wake_hist"]["gt500"]["sum"] == 1.0)
    expect("log: wake_hist không coi là tích luỹ", "delta" not in minute["core.wake_hist"]["le200"])
    # T63-004: khoá theo phút — cộng sum cho số đếm, max cho µs, không có delta.
    expect("log: iobus.loop_timing late_events sum", minute["iobus.loop_timing"]["late_events"]["sum"] == 1.0)
    expect("log: iobus.loop_timing work_max", minute["iobus.loop_timing"]["work_max_us"]["max"] == 16000.0)
    expect("log: loop_timing không coi là tích luỹ", "delta" not in minute["iobus.loop_timing"]["late_events"])
    expect("log: bỏ dòng http", "http" not in minute)
    access = summarize_access_log(lines)
    points = access["routes"]["GET /api/v1/points"]
    expect("access: 2 dòng /points", points["n"] == 2)
    expect("access: một 503", points["statuses"].get("503") == 1)
    expect("access: tổng 3 dòng", access["access_lines"] == 3)
    vol = count_lines_per_hour(lines, 1800.0)
    expect("volume: 10 dòng/30 phút = 20/giờ", vol["lines_per_hour"] == 20.0)

    declared = declared_periods(FIXTURE_REVISION)
    expect("period: khai báo P1=10", declared.get("P1") == 10)
    readback = compare_periods(declared, [{"programId": "P1", "periodMs": 10},
                                          {"programId": "P2", "periodMs": 10}])
    expect("period: phát hiện 1 lệch", readback["mismatches"] == 1)
    v1 = declared_periods({"objects": [
        {"kind": "TASK", "payload": {"periodMs": 50}},
        {"kind": "PROGRAM", "payload": {"objectId": "X", "programConfig": {}}}]})
    expect("period: schema v1 lấy chu kỳ TASK", v1.get("X") == 50)

    rt = summarize_runtime(
        {"programming_runtime": {"activeRevisionId": "a", "task": {"missedReleaseCount": 3, "jitterViolationCount": 9}},
         "programs": {"items": [{"programId": "P1", "missedReleaseCount": 0}]}},
        {"programming_runtime": {"activeRevisionId": "a", "task": {"missedReleaseCount": 3, "jitterViolationCount": 14}},
         "programs": {"items": [{"programId": "P1", "missedReleaseCount": 0}]}})
    expect("runtime: Task missed release +0", rt["task"]["missedReleaseCount"]["delta"] == 0)
    expect("runtime: jitter violation +5", rt["task"]["jitterViolationCount"]["delta"] == 5)
    expect("runtime: Program missed release +0", rt["programs"][0]["missedRelease_delta"] == 0)
    expect("runtime: Active không đổi", rt["activeRevision_unchanged"] is True)

    deltas = numeric_deltas({"iop": {"timeouts": 5, "crc_errors": 1}}, {"iop": {"timeouts": 8, "crc_errors": 1}})
    expect("delta: iop.timeouts +3", deltas.get("iop.timeouts") == 3)

    expect("percentile nearest-rank p95 của 1..20 = 19", percentile(list(range(1, 21)), 95) == 19)
    expect("redact key", "<key>" in redact_ssh(["ssh", "-i", "/home/x/.ssh/k", "root@h"]) and
           "/home/x" not in redact_ssh(["ssh", "-i", "/home/x/.ssh/k", "root@h"]))

    prov = parse_provenance("UNIT mkddc-core|42|Mon 2026-09-28|/usr/sbin/mkddc-core|abc\n"
                            "TEMP soc-thermal|45123\nCPUFREQ cpu0|performance|1512000\n"
                            "IOBUS_DROPINS nomcu.conf \n")
    expect("provenance: pid", prov["units"]["mkddc-core"]["main_pid"] == "42")
    expect("provenance: nhiệt độ", prov["thermal"]["soc-thermal"] == 45.123)
    expect("provenance: governor", prov["cpufreq"]["cpu0"]["governor"] == "performance")
    expect("provenance: Fake MCU", prov["iobus_mode"] == "FAKE_MCU")

    # T63-110: nguồn ghi eMMC.
    emmc = summarize_emmc(parse_emmc_stream(FIXTURE_EMMC), endurance_tbw=10.0)
    # 200000 sector × 512 B / 100 s = 1 024 000 B/s.
    expect("emmc: B/s thiết bị", emmc["device_write_bytes_per_s"] == 1024000.0)
    expect("emmc: IOPS thiết bị", emmc["partitions"]["mmcblk0"]["write_iops"] == 5.0)
    expect("emmc: journald 10000 B/s", emmc["sources_bytes_per_s"].get("journald") == 10000.0)
    expect("emmc: web 5000 B/s", emmc["sources_bytes_per_s"].get("web (SQLite Programming/historian)") == 5000.0)
    expect("emmc: core 2048 B/s", emmc["sources_bytes_per_s"].get("core (snapshot)") == 2048.0)
    expect("emmc: jbd2 là hệ thống file", emmc["sources_bytes_per_s"].get("hệ thống file (jbd2/kworker)") == 512.0)
    expect("emmc: phần chưa quy nguồn", emmc["unattributed_bytes_per_s"] == 1024000.0 - 17560.0)
    expect("emmc: GB/ngày", emmc["gb_per_day"] == round(1024000.0 * 86400 / 1e9, 3))
    expect("emmc: năm tới TBW", emmc["years_to_endurance"] == round(10.0 / (1024000.0 * 86400 * 365 / 1e12), 1))
    ident = parse_emmc_identity("ID name|8GTF4R \nID life_time|0x01 0x02 \nSIZE 15269888\n"
                                "MOUNT /dev/mmcblk0p6|/data|ext4|rw,relatime\nJOURNAL_PERSISTENT yes\n"
                                "JOURNALD_CONF Storage=persistent\n")
    expect("emmc: tên chip", ident["id"]["name"] == "8GTF4R")
    expect("emmc: life_time A/B", ident["life_time_used"] == ["0–10%", "10–20%"])
    expect("emmc: journald persistent", ident["journal_persistent_dir"] is True and
           ident["journald_conf"] == ["Storage=persistent"])
    expect("emmc: sampler chỉ đọc", ">" not in emmc_sampler_script("mmcblk0", 60).replace("2>/dev/null", ""))

    # Cấm journalctl trong cửa sổ: Board.sh phải từ chối trước khi gọi ssh.
    log = CommandLog(os.devnull)
    log.phase = "window"
    board = Board("ssh -i k root@h", "http://127.0.0.1:1", log, "u", None)
    try:
        board.sh("journalctl -u mkddc-core")
        refused = False
    except RuntimeError:
        refused = True
    expect("cấm journalctl trong cửa sổ", refused)

    print(f"selftest: {'FAIL' if failures else 'PASS'} ({len(failures)} lỗi)")
    return 1 if failures else 0


# ---------------------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="đo trên bo (TARGET)")
    run.add_argument("--ssh", required=True, help='ví dụ: "ssh foxlinx" hoặc "ssh -p 2223 -i KEY root@HOST"')
    run.add_argument("--base-url", required=True, help="ví dụ: http://mekong-fac.ddns.net:8082")
    run.add_argument("--out", required=True, help="thư mục evidence (tạo mới)")
    run.add_argument("--rounds", type=int, default=2)
    run.add_argument("--duration", type=float, default=1800.0, help="giây mỗi lượt (mặc định 1800)")
    run.add_argument("--rest", type=float, default=300.0, help="giây nghỉ giữa hai lượt")
    run.add_argument("--disk", default=DEFAULT_DISK)
    run.add_argument("--username", default=os.environ.get("MKDDC_PROBE_USER", "admin"))
    summ = sub.add_parser("summarize", help="tính lại summary.json từ dữ liệu thô")
    summ.add_argument("--out", required=True)
    sub.add_parser("selftest", help="kiểm parser trên host")
    em = sub.add_parser("emmc", help="T63-110: đo nguồn ghi eMMC (mặc định 24 giờ, TARGET)")
    em.add_argument("--ssh", required=True)
    em.add_argument("--out", required=True)
    em.add_argument("--duration", type=float, default=86400.0)
    em.add_argument("--interval", type=int, default=EMMC_INTERVAL_S)
    em.add_argument("--disk", default=DEFAULT_DISK)
    em.add_argument("--endurance-tbw", type=float, help="độ bền ghi của chip theo datasheet (TB)")
    ems = sub.add_parser("summarize-emmc", help="tính lại emmc-summary.json từ dữ liệu thô")
    ems.add_argument("--out", required=True)
    ems.add_argument("--endurance-tbw", type=float)
    args = parser.parse_args(argv)

    if args.cmd == "selftest":
        return selftest()
    if args.cmd in ("emmc", "summarize-emmc"):
        if args.cmd == "emmc":
            os.makedirs(args.out, exist_ok=True)
            log = CommandLog(os.path.join(args.out, "commands.log"))
            board = Board(args.ssh, "http://unused", log, "-", None)
            run_emmc(board, args.out, args.duration, args.interval, args.disk)
        summary = write_emmc_summary(args.out, args.endurance_tbw)
        print(json.dumps(summary["writes"].get("sources_bytes_per_s"), ensure_ascii=False))
        return 0
    if args.cmd == "summarize":
        summary = write_summary(args.out)
        print(json.dumps({"rounds": len(summary["rounds"]),
                          "journal_commands_in_window": summary["journal_commands_in_window"]}))
        return 0

    os.makedirs(args.out, exist_ok=True)
    log = CommandLog(os.path.join(args.out, "commands.log"))
    board = Board(args.ssh, args.base_url, log, args.username, os.environ.get("MKDDC_PROBE_PASSWORD"))
    for index in range(1, args.rounds + 1):
        meta = run_round(board, args.out, index, args.duration, args.disk)
        print(f"round {index}: {meta['window_start_epoch']}→{meta['window_end_epoch']}", flush=True)
        if index < args.rounds:
            log.phase = "rest"
            log.write("rest", f"{args.rest:.0f} s")
            time.sleep(args.rest)
    summary = write_summary(args.out)
    print(json.dumps({"rounds": len(summary["rounds"]),
                      "journal_commands_in_window": summary["journal_commands_in_window"]}))
    return 0 if summary["journal_commands_in_window"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
