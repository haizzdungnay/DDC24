#!/usr/bin/env python3
"""Manifest provenance theo từng artifact và read-back sha256 trên bo (Plan 63 T63-002).

Authority: docs/03_implementation/63_FORLINX_PERFORMANCE_REMEDIATION_PLAN.md
§4.1 T63-002 (finding ``PERF-PROV-01``); quy trình deploy ở
docs/03_implementation/DEPLOY_FOXLINX.md.

Vì sao cần: ``provenance.json`` ghi MỘT commit cho cả gói và chỉ sinh khi dựng
gói release (``build-release.sh``). Từ lần deploy một phần đầu tiên (chỉ web,
chỉ tool ST) nó mô tả một bản không còn chạy trên bo, và câu hỏi "bo đang chạy
đúng bản nào" chỉ trả lời được bằng cách đọc tay ``/proc/<MainPID>/exe``.

``artifact-manifest.json`` ghi riêng từng artifact: tên, sha256, commit, tree
dirty, thời điểm build, toolchain và đường dẫn cài trên bo. Lệnh con:

``record``         ghi/cập nhật mục vào một manifest cục bộ (``build-release.sh``
                   gọi với ``--fresh``).
``deploy-record``  ghi mục của artifact VỪA deploy vào manifest trên bo, giữ
                   nguyên các mục khác (deploy một phần).
``readback``       chỉ đọc: so sha256 ``/proc/<MainPID>/exe`` của năm unit (core,
                   iobus, web và hai helper chạy chung binary web) và
                   ``index.html`` đang phục vụ với manifest trên bo.
``selftest``       kiểm logic trên host (mức bằng chứng HOST).

Ba quy tắc không được nới:

1. **Mục manifest chỉ sinh từ file build cục bộ có nguồn build xác định được**
   (T63-002 AC4). Commit lấy từ chính binary khi binary tự mang nó (Go buildinfo
   ``vcs.revision``; C++ ``MKDDC_GIT_COMMIT`` của ``BuildProvenance.cmake``).
   Artifact không tự mang commit (FE, tool ST) chỉ được ghi khi nằm trong build
   dir của chính worktree này. KHÔNG có lệnh nào đọc sha256 trên bo rồi ghi
   ngược vào manifest: làm vậy thì read-back luôn "0 lệch" mà không chứng minh gì.
2. **Deploy một phần chỉ thay mục của artifact được deploy**; mục khác giữ nguyên.
3. **Read-back chỉ đọc**: không ghi file, không restart service trên bo.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import importlib.util
import json
import os
import posixpath
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

SCHEMA = "mkddc.artifact-manifest/1"
# Cạnh provenance.json/checksums.sha256 mà install.sh cài vào $SHAREDIR.
REMOTE_MANIFEST = "/usr/share/mkddc/artifact-manifest.json"
NO_MANIFEST = "@NO_MANIFEST"
HERE = os.path.dirname(os.path.abspath(__file__))


class ManifestError(RuntimeError):
    """Lỗi làm lệnh dừng mà KHÔNG ghi gì, cả manifest cục bộ lẫn trên bo."""


@dataclass(frozen=True)
class Spec:
    kind: str  # "go" | "cpp" | "web-ui"
    install_path: str  # đường dẫn trên bo
    units: Tuple[str, ...] = ()
    # C++ gọi mkddc_apply_provenance() (platform/cmake/BuildProvenance.cmake) thì
    # binary mang chuỗi MKDDC_GIT_COMMIT; tool ST hiện KHÔNG gọi.
    embeds_commit: bool = False


# Hai helper chạy CHUNG binary web (DEPLOY_FOXLINX bước 6, U-21 của
# REC-DDC-FIELD-USE-20260927): restart mỗi mkddc-web-pi thì chúng vẫn chạy bản cũ.
WEB_UNITS = ("mkddc-web-pi", "mkddc-reload-helper", "mkddc-time-helper")

REGISTRY: Dict[str, Spec] = {
    "mkddc-core": Spec("cpp", "/usr/sbin/mkddc-core", ("mkddc-core",), True),
    "mkddc-iobus": Spec("cpp", "/usr/sbin/mkddc-iobus", ("mkddc-iobus",), True),
    "mkddc-netcfg": Spec("cpp", "/usr/sbin/mkddc-netcfg", (), True),
    "mkddc-st-compile": Spec("cpp", "/usr/sbin/mkddc-st-compile"),
    "mkddc-st-package": Spec("cpp", "/usr/sbin/mkddc-st-package"),
    "mkddc-st-validate": Spec("cpp", "/usr/sbin/mkddc-st-validate"),
    "mkddc-schedule-sim": Spec("cpp", "/opt/mkddc-web/mkddc-schedule-sim", (), True),
    "mkddc-programming-sim-worker": Spec("cpp", "/opt/mkddc-web/mkddc-programming-sim-worker", (), True),
    "mkddc-web": Spec("go", "/opt/mkddc-web/mkddc-web", WEB_UNITS),
    "web-ui": Spec("web-ui", "/opt/mkddc-web/dist/index.html"),
}
# Một manifest dựng mới (--fresh) phải phủ đủ những gì read-back so.
REQUIRED = ("mkddc-core", "mkddc-iobus", "mkddc-web", "web-ui")
# Cùng tập và cùng thứ tự với UNITS của scripts/forlinx_perf_probe.py (selftest khoá).
READBACK_UNITS = ("mkddc-core", "mkddc-iobus", "mkddc-web-pi", "mkddc-reload-helper", "mkddc-time-helper")
UNIT_ARTIFACT = {unit: name for name, spec in REGISTRY.items() for unit in spec.units}
DEFAULT_WEB_PORT = "8081"  # mặc định PORT của mkddc-web (apps/web-api/internal/app/config.go)


def utc_iso(epoch: Optional[float] = None) -> str:
    moment = _dt.datetime.fromtimestamp(time.time() if epoch is None else epoch, _dt.timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Nguồn build
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RepoState:
    root: str
    head: str
    head_time: int  # committer time của HEAD, epoch giây
    dirty: bool


def read_repo_state(repo: str) -> RepoState:
    def git(*args: str) -> str:
        try:
            proc = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
        except OSError as err:
            raise ManifestError(f"không chạy được git: {err}; không có nguồn build để ghi manifest") from err
        if proc.returncode != 0:
            raise ManifestError(f"git {' '.join(args)} ở {repo} lỗi: {proc.stderr.strip()[:200]}; "
                                "không có nguồn build để ghi manifest")
        return proc.stdout.strip()

    root = os.path.realpath(git("rev-parse", "--show-toplevel"))
    head = git("rev-parse", "HEAD")
    head_time = int(git("show", "-s", "--format=%ct", "HEAD"))
    # Cùng quy ước với build-release.sh và BuildProvenance.cmake: file untracked cũng là dirty.
    dirty = bool(git("status", "--porcelain", "--untracked-files=normal"))
    return RepoState(root, head, head_time, dirty)


GO_VERSION_RE = re.compile(r":\s+(go\S+)\s*$")


def parse_go_buildinfo(text: str) -> Dict[str, Any]:
    """Đọc output ``go version -m <binary>``: commit/dirty do CHÍNH binary mang."""
    lines = text.splitlines()
    match = GO_VERSION_RE.search(lines[0]) if lines else None
    if not match:
        raise ManifestError(f"không đọc được phiên bản Go từ buildinfo: {lines[:1]!r}")
    settings: Dict[str, str] = {}
    for line in lines[1:]:
        parts = line.strip().split("\t")
        if len(parts) >= 2 and parts[0] == "build" and "=" in parts[1]:
            key, _, value = parts[1].partition("=")
            settings[key] = value
    revision = settings.get("vcs.revision", "")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ManifestError("binary Go không mang vcs.revision (dựng ngoài git hoặc -buildvcs=false): "
                            "không có nguồn build")
    modified = settings.get("vcs.modified")
    if modified not in ("true", "false"):
        raise ManifestError("binary Go không mang vcs.modified: không biết tree có dirty hay không")
    goos, goarch = settings.get("GOOS"), settings.get("GOARCH")
    return {
        "git_commit": revision,
        "dirty": modified == "true",
        "commit_source": "go-buildinfo",
        "toolchain": match.group(1),
        "target": f"{goos}/{goarch}" if goos and goarch else "unknown",
    }


ELF_MACHINE = {0x03: "x86", 0x28: "arm", 0x3E: "x86_64", 0xB7: "aarch64"}
EMBEDDED_COMMIT_RE = re.compile(rb"(?<![0-9a-f])([0-9a-f]{40})(-dirty)?(?![0-9A-Za-z])")
TOOLCHAIN_RE = re.compile(rb"GCC: \([^\x00\n]{1,200}\) [^\x00\n]{1,80}|clang version [^\x00\n]{1,160}")


def elf_identity(data: bytes) -> Tuple[str, str]:
    """Kiến trúc (e_machine) và dấu compiler trong section ``.comment`` của ELF."""
    if len(data) < 20 or data[:4] != b"\x7fELF":
        raise ManifestError("không phải file ELF")
    order = "little" if data[5] == 1 else "big"
    machine = int.from_bytes(data[18:20], order)
    marks = sorted({m.decode("utf-8", "replace") for m in TOOLCHAIN_RE.findall(data)})
    if not marks:
        raise ManifestError("ELF không còn dấu toolchain (.comment đã bị strip): không ghi được toolchain")
    return ELF_MACHINE.get(machine, f"elf-machine-0x{machine:x}"), " | ".join(marks)


def embedded_commit(data: bytes, head: str) -> Tuple[str, bool]:
    """Commit ``MKDDC_GIT_COMMIT`` mà binary C++ tự mang (40 hex, tuỳ chọn ``-dirty``)."""
    found: Dict[str, set] = {}
    for match in EMBEDDED_COMMIT_RE.finditer(data):
        found.setdefault(match.group(1).decode(), set()).add(match.group(2) is not None)
    if not found:
        raise ManifestError("binary không mang MKDDC_GIT_COMMIT (dựng ngoài git thì chuỗi là "
                            "'unknown'): không có nguồn build")
    if head in found:
        commit = head
    elif len(found) == 1:
        commit = next(iter(found))  # dựng từ commit khác HEAD: ghi đúng commit binary mang
    else:
        raise ManifestError(f"binary mang {len(found)} commit ứng viên, không cái nào là HEAD "
                            f"{head[:12]}: không xác định được nguồn build")
    flags = found[commit]
    if len(flags) != 1:
        raise ManifestError(f"binary mang cả {commit[:12]} lẫn {commit[:12]}-dirty")
    return commit, flags.pop()


def cmake_home_of(path: str, repo_root: str) -> Optional[str]:
    """``CMAKE_HOME_DIRECTORY`` của build dir gần nhất chứa artifact (đi lên tới gốc repo)."""
    cur = os.path.dirname(path)
    while True:
        cache = os.path.join(cur, "CMakeCache.txt")
        if os.path.isfile(cache):
            with open(cache, encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    if line.startswith("CMAKE_HOME_DIRECTORY:"):
                        return line.split("=", 1)[1].strip()
            return ""
        if cur == repo_root or cur == os.path.dirname(cur):
            return None
        cur = os.path.dirname(cur)


def worktree_source(path: str, spec: Spec, repo: RepoState, mtime: float) -> Dict[str, Any]:
    """Nguồn build cho artifact KHÔNG tự mang commit (FE, tool ST).

    Chỉ chấp nhận khi chứng minh được artifact là output build của chính worktree
    này; một file chép từ bo về máy build không bao giờ qua được.
    """
    real = os.path.realpath(path)
    if os.path.commonpath([real, repo.root]) != repo.root:
        raise ManifestError(f"{path} nằm ngoài worktree {repo.root} và không tự mang commit: "
                            "không có nguồn build")
    if spec.kind == "cpp":
        # Build dir cũ còn CMAKE_HOME_DIRECTORY trỏ nguồn khác (sự cố `services/`
        # 2026-08-07) cho ra binary KHÔNG dựng từ worktree này.
        home = cmake_home_of(real, repo.root)
        if not home or os.path.realpath(home) != repo.root:
            raise ManifestError(f"{path}: build dir có CMAKE_HOME_DIRECTORY={home!r}, không phải "
                                f"{repo.root}: không chứng minh được nguồn build")
    elif mtime < repo.head_time:
        # Vite dựng lại toàn bộ dist (emptyOutDir) nên index.html dựng từ HEAD luôn
        # mới hơn commit HEAD. Cũ hơn ⇒ dist dựng từ commit trước đó.
        raise ManifestError(f"{path} dựng lúc {utc_iso(mtime)}, trước commit HEAD "
                            f"({utc_iso(repo.head_time)}): dựng lại FE rồi ghi")
    return {"git_commit": repo.head, "dirty": repo.dirty, "commit_source": "git-worktree"}


class Recorder:
    """Sinh mục manifest từ file build cục bộ. Selftest thay hai hàm dò toolchain."""

    def __init__(self, repo_dir: str, origin: str):
        self.repo = read_repo_state(repo_dir)
        self.origin = origin

    def go_buildinfo(self, path: str) -> str:
        try:
            proc = subprocess.run(["go", "version", "-m", path], capture_output=True, text=True)
        except OSError as err:
            raise ManifestError(f"cần lệnh `go` để đọc buildinfo của {path}: {err}") from err
        if proc.returncode != 0:
            raise ManifestError(f"`go version -m {path}` lỗi: {proc.stderr.strip()[:200]}")
        return proc.stdout

    def web_toolchain(self) -> str:
        try:
            node = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
        except OSError as err:
            raise ManifestError(f"cần `node` để ghi toolchain FE: {err}") from err
        vite_pkg = os.path.join(self.repo.root, "apps/web-ui/node_modules/vite/package.json")
        try:
            with open(vite_pkg, encoding="utf-8") as handle:
                vite = json.load(handle)["version"]
        except (OSError, ValueError, KeyError) as err:
            raise ManifestError(f"không đọc được phiên bản vite ở {vite_pkg}: {err}") from err
        if not node:
            raise ManifestError("`node --version` không trả gì")
        return f"node-{node} vite-{vite}"

    def entry(self, name: str, path: str) -> Dict[str, Any]:
        spec = REGISTRY.get(name)
        if spec is None:
            raise ManifestError(f"artifact lạ {name!r}; hợp lệ: {', '.join(sorted(REGISTRY))}")
        if not os.path.isfile(path):
            raise ManifestError(f"{name}: không thấy file {path}")
        with open(path, "rb") as handle:
            data = handle.read()
        mtime = os.stat(path).st_mtime
        if spec.kind == "go":
            info = parse_go_buildinfo(self.go_buildinfo(path))
        elif spec.kind == "cpp":
            target, toolchain = elf_identity(data)
            if spec.embeds_commit:
                commit, dirty = embedded_commit(data, self.repo.head)
                info = {"git_commit": commit, "dirty": dirty, "commit_source": "embedded"}
            else:
                info = worktree_source(path, spec, self.repo, mtime)
            info.update(target=target, toolchain=toolchain)
        else:
            info = worktree_source(path, spec, self.repo, mtime)
            info.update(target="browser", toolchain=self.web_toolchain())
        real = os.path.realpath(path)
        inside = os.path.commonpath([real, self.repo.root]) == self.repo.root
        return {
            "install_path": spec.install_path,
            "sha256": hashlib.sha256(data).hexdigest(),
            "size_bytes": len(data),
            **info,
            "build_time": utc_iso(mtime),
            "source_file": os.path.relpath(real, self.repo.root) if inside else real,
            "origin": self.origin,
            "recorded_at": utc_iso(),
        }


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def new_manifest() -> Dict[str, Any]:
    return {"schema": SCHEMA, "updated_at": None, "artifacts": {}}


def parse_manifest(text: str, where: str) -> Dict[str, Any]:
    try:
        doc = json.loads(text)
    except ValueError as err:
        raise ManifestError(f"{where}: manifest không phải JSON ({err}); không ghi đè") from err
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA or not isinstance(doc.get("artifacts"), dict):
        raise ManifestError(f"{where}: không phải {SCHEMA}; không ghi đè")
    return doc


def dump_manifest(doc: Dict[str, Any]) -> str:
    return json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def upsert(doc: Dict[str, Any], entries: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Thay ĐÚNG mục của artifact vừa ghi; mục khác giữ nguyên (T63-002 AC2)."""
    out = json.loads(json.dumps(doc))
    out["artifacts"].update(entries)
    out["updated_at"] = utc_iso()
    return out


def parse_artifact_args(values: Sequence[str]) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for raw in values:
        name, sep, path = raw.partition("=")
        if not sep or not name or not path:
            raise ManifestError(f"--artifact phải có dạng TÊN=FILE: {raw!r}")
        if any(name == seen for seen, _ in pairs):
            raise ManifestError(f"--artifact {name} xuất hiện hai lần")
        pairs.append((name, path))
    if not pairs:
        raise ManifestError("cần ít nhất một --artifact TÊN=FILE")
    return pairs


def collect_entries(recorder: Recorder, pairs: Sequence[Tuple[str, str]]) -> Dict[str, Dict[str, Any]]:
    # Kiểm hết rồi mới ghi: một artifact thiếu nguồn build thì không mục nào được ghi.
    return {name: recorder.entry(name, path) for name, path in pairs}


def write_local(path: str, doc: Dict[str, Any]) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".artifact-manifest.", dir=directory)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(dump_manifest(doc))
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def report_record(before: Optional[Dict[str, Any]], entries: Dict[str, Dict[str, Any]]) -> None:
    for name, entry in sorted(entries.items()):
        print(f"RECORD {name} sha256={entry['sha256'][:16]} commit={entry['git_commit'][:12]} "
              f"dirty={str(entry['dirty']).lower()} source={entry['commit_source']} "
              f"toolchain={entry['toolchain']!r}")
    kept = sorted(set((before or {}).get("artifacts", {})) - set(entries))
    if kept:
        print(f"KEPT {' '.join(kept)}")


def record_local(manifest_path: str, entries: Dict[str, Dict[str, Any]], fresh: bool) -> Dict[str, Any]:
    if fresh:
        missing = [name for name in REQUIRED if name not in entries]
        if missing:
            raise ManifestError(f"--fresh dựng manifest đầy đủ nhưng thiếu {', '.join(missing)}")
        base = new_manifest()
    elif os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as handle:
            base = parse_manifest(handle.read(), manifest_path)
    else:
        base = new_manifest()
    doc = upsert(base, entries)
    write_local(manifest_path, doc)
    report_record(base, entries)
    return doc


# ---------------------------------------------------------------------------
# Kênh bo
# ---------------------------------------------------------------------------


def run_remote(ssh: Sequence[str], script: str, stdin: Optional[str] = None, timeout: float = 90.0) -> str:
    try:
        proc = subprocess.run(list(ssh) + [script], input=stdin, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as err:
        raise ManifestError(f"không chạy được lệnh trên bo: {err}") from err
    if proc.returncode != 0:
        raise ManifestError(f"lệnh trên bo thoát {proc.returncode}: {proc.stderr.strip()[:300]}")
    return proc.stdout


def fetch_remote_manifest(ssh: Sequence[str], remote: str) -> Optional[Dict[str, Any]]:
    q = shlex.quote(remote)
    out = run_remote(ssh, f"if [ -f {q} ]; then cat {q}; else echo {NO_MANIFEST}; fi")
    if out.strip() == NO_MANIFEST:
        return None
    return parse_manifest(out, f"bo:{remote}")


def push_remote_manifest(ssh: Sequence[str], remote: str, doc: Dict[str, Any]) -> None:
    q, tmp = shlex.quote(remote), shlex.quote(remote + ".tmp")
    run_remote(ssh, f'set -e; mkdir -p "$(dirname {q})"; cat > {tmp}; chmod 0644 {tmp}; mv {tmp} {q}',
               stdin=dump_manifest(doc))
    if fetch_remote_manifest(ssh, remote) != doc:
        raise ManifestError(f"đọc lại bo:{remote} không khớp bản vừa ghi")


def deploy_record(ssh: Sequence[str], remote: str, entries: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    base = fetch_remote_manifest(ssh, remote)
    if base is None:
        absent = [name for name in REQUIRED if name not in entries]
        print(f"CẢNH BÁO: bo chưa có {remote}; tạo mới chỉ với artifact vừa deploy. "
              f"Read-back sẽ báo NO_ENTRY cho {', '.join(absent) or '(không)'} tới khi chúng được "
              "deploy/cài lại kèm manifest (không lấy sha256 trên bo điền thay).", file=sys.stderr)
    doc = upsert(base or new_manifest(), entries)
    push_remote_manifest(ssh, remote, doc)
    report_record(base, entries)
    return doc


def runtime_script(file_paths: Sequence[str]) -> str:
    """Script đọc-chỉ chạy trên bo (busybox ash): exe từng unit, index.html đang phục vụ, file."""
    units = " ".join(shlex.quote(u) for u in READBACK_UNITS)
    script = f"""
for u in {units}; do
  p=$(systemctl show -p MainPID --value "$u" 2>/dev/null)
  e=; s=
  if [ -n "$p" ] && [ "$p" != 0 ]; then
    e=$(readlink "/proc/$p/exe" 2>/dev/null)
    s=$(sha256sum "/proc/$p/exe" 2>/dev/null | cut -d' ' -f1)
  fi
  echo "UNIT $u|$p|$e|$s"
done
p=$(systemctl show -p MainPID --value mkddc-web-pi 2>/dev/null)
sd=; port=; cwd=
if [ -n "$p" ] && [ "$p" != 0 ]; then
  sd=$(tr '\\000' '\\n' < "/proc/$p/environ" 2>/dev/null | sed -n 's/^STATIC_DIR=//p' | tail -n 1)
  port=$(tr '\\000' '\\n' < "/proc/$p/environ" 2>/dev/null | sed -n 's/^PORT=//p' | tail -n 1)
  cwd=$(readlink "/proc/$p/cwd" 2>/dev/null)
fi
[ -n "$sd" ] || sd=dist
[ -n "$port" ] || port={DEFAULT_WEB_PORT}
case "$sd" in /*) idx="$sd/index.html" ;; *) idx="$cwd/$sd/index.html" ;; esac
echo "SERVED_FILE $idx|$(sha256sum "$idx" 2>/dev/null | cut -d' ' -f1)"
if wget -q -O /dev/null "http://127.0.0.1:$port/" 2>/dev/null; then
  echo "SERVED_HTTP $port|$(wget -q -O - "http://127.0.0.1:$port/" 2>/dev/null | sha256sum | cut -d' ' -f1)"
else
  echo "SERVED_HTTP $port|"
fi
"""
    if file_paths:
        files = " ".join(shlex.quote(p) for p in file_paths)
        script += f"""for f in {files}; do
  echo "FILE $f|$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)"
done
"""
    return script


def parse_runtime(text: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"units": {}, "served_file": None, "served_http": None, "files": {}}
    for line in text.splitlines():
        tag, _, rest = line.partition(" ")
        if tag == "UNIT":
            unit, pid, exe, sha = (rest.split("|") + [""] * 4)[:4]
            out["units"][unit] = {"pid": pid.strip(), "exe": exe, "sha256": sha.strip()}
        elif tag == "SERVED_FILE":
            path, _, sha = rest.rpartition("|")
            out["served_file"] = {"path": posixpath.normpath(path), "sha256": sha.strip()}
        elif tag == "SERVED_HTTP":
            port, _, sha = rest.partition("|")
            out["served_http"] = {"port": port, "sha256": sha.strip()}
        elif tag == "FILE":
            path, _, sha = rest.rpartition("|")
            out["files"][path] = sha.strip()
    return out


def extra_artifacts(doc: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Mục manifest không so qua /proc hay index.html: so file trên đĩa."""
    unit_names = set(UNIT_ARTIFACT.values()) | {"web-ui"}
    return {name: entry for name, entry in ((doc or {}).get("artifacts") or {}).items()
            if name not in unit_names}


def compare(doc: Optional[Dict[str, Any]], rt: Dict[str, Any], check_http: bool = True) -> List[Dict[str, Any]]:
    arts = (doc or {}).get("artifacts") or {}
    results: List[Dict[str, Any]] = []

    def add(check: str, artifact: str, status: str, expected: str = "", actual: str = "", detail: str = "") -> None:
        results.append({"check": check, "artifact": artifact, "status": status,
                        "expected": expected, "actual": actual, "detail": detail})

    for unit in READBACK_UNITS:
        name = UNIT_ARTIFACT[unit]
        info = rt["units"].get(unit) or {}
        entry = arts.get(name)
        pid, exe, sha = info.get("pid", ""), info.get("exe", ""), info.get("sha256", "")
        expected = (entry or {}).get("sha256", "")
        check = f"unit:{unit}"
        if not pid or pid == "0":
            add(check, name, "NOT_RUNNING", expected, "", "MainPID=0 hoặc unit không tồn tại")
        elif exe.endswith(" (deleted)"):
            add(check, name, "STALE_EXE", expected, sha, f"tiến trình pid {pid} còn chạy binary đã bị thay: {exe}")
        elif not sha:
            add(check, name, "UNREADABLE", expected, "", f"không đọc được /proc/{pid}/exe")
        elif doc is None:
            add(check, name, "NO_MANIFEST", "", sha)
        elif entry is None:
            add(check, name, "NO_ENTRY", "", sha, f"manifest không có mục {name}")
        elif exe != entry.get("install_path"):
            add(check, name, "WRONG_PATH", expected, sha, f"exe={exe} ≠ install_path={entry.get('install_path')}")
        elif sha != expected:
            add(check, name, "SHA_MISMATCH", expected, sha)
        else:
            add(check, name, "OK", expected, sha)

    entry = arts.get("web-ui")
    expected = (entry or {}).get("sha256", "")
    served = rt.get("served_file") or {}
    if doc is None:
        add("served:index.html", "web-ui", "NO_MANIFEST", "", served.get("sha256", ""))
    elif entry is None:
        add("served:index.html", "web-ui", "NO_ENTRY", "", served.get("sha256", ""), "manifest không có mục web-ui")
    elif not served.get("sha256"):
        add("served:index.html", "web-ui", "MISSING_FILE", expected, "", f"không đọc được {served.get('path')}")
    elif served.get("path") != posixpath.normpath(entry.get("install_path", "")):
        add("served:index.html", "web-ui", "WRONG_PATH", expected, served["sha256"],
            f"STATIC_DIR phục vụ {served.get('path')} ≠ install_path={entry.get('install_path')}")
    elif served["sha256"] != expected:
        add("served:index.html", "web-ui", "SHA_MISMATCH", expected, served["sha256"])
    else:
        add("served:index.html", "web-ui", "OK", expected, served["sha256"])
    if check_http:
        http = rt.get("served_http") or {}
        check = f"http:127.0.0.1:{http.get('port', '?')}/"
        if not http.get("sha256"):
            add(check, "web-ui", "HTTP_UNREACHABLE", expected, "", "GET / không trả 200")
        elif entry is None:
            add(check, "web-ui", "NO_MANIFEST" if doc is None else "NO_ENTRY", "", http["sha256"])
        elif http["sha256"] != expected:
            add(check, "web-ui", "HTTP_MISMATCH", expected, http["sha256"])
        else:
            add(check, "web-ui", "OK", expected, http["sha256"])

    for name, entry in sorted(extra_artifacts(doc).items()):
        path = entry.get("install_path", "")
        expected = entry.get("sha256", "")
        actual = rt["files"].get(path, "")
        if name not in REGISTRY:
            add(f"file:{path}", name, "UNKNOWN_ENTRY", expected, actual, "tên không có trong REGISTRY")
        elif not actual:
            add(f"file:{path}", name, "MISSING_FILE", expected, "")
        elif actual != expected:
            add(f"file:{path}", name, "SHA_MISMATCH", expected, actual)
        else:
            add(f"file:{path}", name, "OK", expected, actual)
    return results


def readback(ssh: Sequence[str], remote: str, check_http: bool = True) -> Dict[str, Any]:
    doc = fetch_remote_manifest(ssh, remote)
    paths = sorted({entry.get("install_path", "") for entry in extra_artifacts(doc).values()} - {""})
    rt = parse_runtime(run_remote(ssh, runtime_script(paths)))
    results = compare(doc, rt, check_http)
    return {
        "collected_at": utc_iso(),
        "remote_manifest": remote,
        "manifest_updated_at": (doc or {}).get("updated_at"),
        "manifest_artifacts": {name: {k: e.get(k) for k in ("sha256", "git_commit", "dirty", "build_time",
                                                            "toolchain", "commit_source", "origin")}
                               for name, e in sorted(((doc or {}).get("artifacts") or {}).items())},
        "runtime": rt,
        "results": results,
        "checks": len(results),
        "mismatches": sum(1 for r in results if r["status"] != "OK"),
    }


def print_readback(report: Dict[str, Any]) -> None:
    print(f"READBACK manifest={report['remote_manifest']} updated_at={report['manifest_updated_at']}")
    arts = report["manifest_artifacts"]
    for r in report["results"]:
        meta = arts.get(r["artifact"]) or {}
        prov = (f" commit={str(meta.get('git_commit'))[:12]} dirty={str(meta.get('dirty')).lower()}"
                if meta else "")
        line = f"  {r['status']:<16} {r['check']:<30} {r['artifact']:<28} sha={r['actual'][:16] or '-'}"
        if r["status"] != "OK":
            line += f" manifest={r['expected'][:16] or '-'}"
            if r["detail"]:
                line += f" ({r['detail']})"
        print(line + prov)
    print(f"READBACK: {report['checks']} kiểm, {report['mismatches']} lệch")


# ---------------------------------------------------------------------------
# Selftest (HOST)
# ---------------------------------------------------------------------------

GO_FIXTURE = """/tmp/mkddc-web-foxlinx: go1.26.4
\tpath\tmkddc-web/cmd/mkddc-web
\tmod\tmkddc-web\t(devel)\t
\tbuild\t-buildmode=exe
\tbuild\tDefaultGODEBUG=cryptocustomrand=1,tlssecpmlkem=0
\tbuild\tCGO_ENABLED=0
\tbuild\tGOARCH=arm64
\tbuild\tGOOS=linux
\tbuild\tvcs=git
\tbuild\tvcs.revision={rev}
\tbuild\tvcs.time=2026-09-28T05:46:36Z
\tbuild\tvcs.modified={modified}
"""


def fake_elf(machine: int, payload: bytes) -> bytes:
    header = bytearray(64)
    header[0:4] = b"\x7fELF"
    header[4], header[5], header[6] = 2, 1, 1
    header[18:20] = machine.to_bytes(2, "little")
    return bytes(header) + payload


class _FakeRecorder(Recorder):
    go_text = ""

    def go_buildinfo(self, path: str) -> str:
        return self.go_text

    def web_toolchain(self) -> str:
        return "node-v22.0.0 vite-8.0.0"


def _raises(fn: Any, needle: str = "") -> bool:
    try:
        fn()
    except ManifestError as err:
        return needle in str(err)
    return False


def _git(repo: str, *args: str, env: Optional[Dict[str, str]] = None) -> str:
    base = ["git", "-C", repo, "-c", "user.name=selftest", "-c", "user.email=selftest@invalid",
            "-c", "commit.gpgsign=false"]
    full_env = dict(os.environ, **(env or {}))
    return subprocess.run(base + list(args), capture_output=True, text=True, check=True, env=full_env).stdout.strip()


def selftest() -> int:
    failures: List[str] = []

    def expect(name: str, cond: bool) -> None:
        print(("PASS " if cond else "FAIL ") + name)
        if not cond:
            failures.append(name)

    head = "8d41a5ab25673e09317d0cd26ea9ce0a08981dda"
    other = "2e53d4a0" + "1" * 32

    # --- Nguồn build từ chính binary ---------------------------------------
    go = parse_go_buildinfo(GO_FIXTURE.format(rev=head, modified="true"))
    expect("go: commit từ vcs.revision", go["git_commit"] == head)
    expect("go: dirty từ vcs.modified", go["dirty"] is True)
    expect("go: toolchain go1.26.4", go["toolchain"] == "go1.26.4")
    expect("go: target linux/arm64", go["target"] == "linux/arm64")
    expect("go: thiếu vcs.revision ⇒ từ chối (AC4)",
           _raises(lambda: parse_go_buildinfo(GO_FIXTURE.format(rev="", modified="false")), "vcs.revision"))

    gcc = b"\x00GCC: (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0\x00"
    elf = fake_elf(0xB7, b"\x00version=%s\x00" + head.encode() + b"-dirty\x00" + gcc)
    target, toolchain = elf_identity(elf)
    expect("elf: aarch64", target == "aarch64")
    expect("elf: toolchain từ .comment", toolchain == "GCC: (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0")
    expect("elf: file không phải ELF bị từ chối", _raises(lambda: elf_identity(b"#!/bin/sh\n"), "ELF"))
    expect("elf: .comment bị strip ⇒ từ chối", _raises(lambda: elf_identity(fake_elf(0x3E, b"x")), "toolchain"))
    expect("cpp: commit + dirty nhúng", embedded_commit(elf, head) == (head, True))
    expect("cpp: sha256 64 hex không bị nhận nhầm là commit",
           _raises(lambda: embedded_commit(fake_elf(0x3E, b"\x00" + b"a" * 64 + b"\x00"), head), "MKDDC_GIT_COMMIT"))
    expect("cpp: 'unknown' ⇒ từ chối (AC4)",
           _raises(lambda: embedded_commit(fake_elf(0x3E, b"\x00unknown\x00"), head), "MKDDC_GIT_COMMIT"))
    expect("cpp: một commit khác HEAD ⇒ ghi đúng commit binary mang",
           embedded_commit(fake_elf(0x3E, b"\x00" + other.encode() + b"\x00"), head) == (other, False))
    two = fake_elf(0x3E, b"\x00" + other.encode() + b"\x00" + ("f" * 40).encode() + b"\x00")
    expect("cpp: nhiều commit, không có HEAD ⇒ từ chối", _raises(lambda: embedded_commit(two, head), "ứng viên"))
    expect("cpp: HEAD lẫn trong nhiều ứng viên ⇒ chọn HEAD",
           embedded_commit(two + head.encode() + b"\x00", head) == (head, False))

    # --- Record trên một repo git tạm ------------------------------------
    work = tempfile.mkdtemp(prefix="mkddc-artifact-manifest-")
    procs: List[subprocess.Popen] = []
    try:
        repo = os.path.join(work, "repo")
        os.makedirs(repo)
        _git(repo, "init", "-q")
        with open(os.path.join(repo, ".gitignore"), "w", encoding="utf-8") as handle:
            handle.write("build/\n")
        _git(repo, "add", ".gitignore")
        # Mốc commit tương đối với đồng hồ máy: file build ghi ngay sau đó luôn mới hơn HEAD.
        commit_at = int(time.time()) - 3600
        commit_env = {"GIT_AUTHOR_DATE": f"@{commit_at} +0000", "GIT_COMMITTER_DATE": f"@{commit_at} +0000"}
        _git(repo, "commit", "-q", "-m", "init", env=commit_env)
        repo_head = _git(repo, "rev-parse", "HEAD")
        repo_real = os.path.realpath(repo)

        def put(rel: str, data: bytes, mtime: Optional[float] = None) -> str:
            path = os.path.join(repo, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as handle:
                handle.write(data)
            if mtime is not None:
                os.utime(path, (mtime, mtime))
            return path

        put("build/fw/CMakeCache.txt", f"CMAKE_HOME_DIRECTORY:INTERNAL={repo_real}\n".encode())
        core = put("build/fw/core/mkddc-core", fake_elf(0xB7, b"\x00" + repo_head.encode() + b"\x00" + gcc + b"core"))
        iobus = put("build/fw/iobus/mkddc-iobus", fake_elf(0xB7, b"\x00" + repo_head.encode() + b"\x00" + gcc + b"io"))
        stc = put("build/fw/core/mkddc-st-compile", fake_elf(0xB7, gcc + b"stc"))
        web_bin = os.path.join(work, "mkddc-web-foxlinx")  # ngoài repo như /tmp/mkddc-web-foxlinx
        with open(web_bin, "wb") as handle:
            handle.write(b"go-binary-v1")
        index = put("build/web-ui/dist/index.html", b"<html lang=\"vi\">v1</html>\n")

        rec = _FakeRecorder(repo, "selftest")
        rec.go_text = GO_FIXTURE.format(rev=repo_head, modified="false")
        manifest = os.path.join(work, "out", "artifact-manifest.json")
        pairs = parse_artifact_args([f"mkddc-core={core}", f"mkddc-iobus={iobus}", f"mkddc-web={web_bin}",
                                     f"web-ui={index}", f"mkddc-st-compile={stc}"])
        doc = record_local(manifest, collect_entries(rec, pairs), fresh=True)
        fields = ("install_path", "sha256", "git_commit", "dirty", "build_time", "toolchain", "commit_source")
        expect("AC1: đủ tên + sha256/commit/dirty/build_time/toolchain cho từng artifact",
               sorted(doc["artifacts"]) == ["mkddc-core", "mkddc-iobus", "mkddc-st-compile", "mkddc-web", "web-ui"]
               and all(all(e.get(k) not in (None, "") for k in fields) for e in doc["artifacts"].values()))
        expect("AC1: sha256 là sha của file build",
               doc["artifacts"]["mkddc-web"]["sha256"] == hashlib.sha256(b"go-binary-v1").hexdigest())
        expect("record: tool ST lấy commit từ worktree", doc["artifacts"]["mkddc-st-compile"]["commit_source"] == "git-worktree")
        expect("record: file build ngoài repo ghi đường tuyệt đối",
               doc["artifacts"]["mkddc-web"]["source_file"] == os.path.realpath(web_bin))
        with open(manifest, encoding="utf-8") as handle:
            expect("record: file ghi ra đọc lại được", parse_manifest(handle.read(), manifest) == doc)

        # AC2 — deploy một phần: chỉ web-ui đổi, mục khác giữ nguyên.
        index_v2 = put("build/web-ui/dist/index.html", b"<html lang=\"vi\">v2</html>\n")
        doc2 = record_local(manifest, collect_entries(rec, [("web-ui", index_v2)]), fresh=False)
        expect("AC2: mục web-ui đổi sha", doc2["artifacts"]["web-ui"]["sha256"] != doc["artifacts"]["web-ui"]["sha256"])
        expect("AC2: bốn mục còn lại giữ nguyên",
               all(doc2["artifacts"][n] == doc["artifacts"][n]
                   for n in ("mkddc-core", "mkddc-iobus", "mkddc-web", "mkddc-st-compile")))

        # AC4 — không có nguồn build thì không ghi, và không ghi dở dang.
        stale_index = put("build/web-ui/dist/index.html", b"<html>cu</html>\n", mtime=commit_at - 3600)
        expect("AC4: FE dựng trước commit HEAD ⇒ từ chối",
               _raises(lambda: rec.entry("web-ui", stale_index), "trước commit HEAD"))
        index_v2 = put("build/web-ui/dist/index.html", b"<html lang=\"vi\">v2</html>\n")  # dựng lại
        outside = os.path.join(work, "mkddc-st-compile-tu-bo")
        with open(outside, "wb") as handle:
            handle.write(fake_elf(0xB7, gcc + b"board-copy"))
        expect("AC4: tool ST chép từ bo về (ngoài worktree) ⇒ từ chối",
               _raises(lambda: rec.entry("mkddc-st-compile", outside), "ngoài worktree"))
        put("build/stale/CMakeCache.txt", b"CMAKE_HOME_DIRECTORY:INTERNAL=/home/x/services\n")
        wrong_home = put("build/stale/core/mkddc-st-compile", fake_elf(0xB7, gcc + b"stale"))
        expect("AC4: build dir trỏ nguồn khác ⇒ từ chối",
               _raises(lambda: rec.entry("mkddc-st-compile", wrong_home), "CMAKE_HOME_DIRECTORY"))
        no_commit = put("build/fw/core/mkddc-core-nocommit", fake_elf(0xB7, b"\x00unknown\x00" + gcc))
        with open(manifest, "rb") as handle:
            before = handle.read()
        expect("AC4: một artifact thiếu nguồn ⇒ không mục nào được ghi",
               _raises(lambda: record_local(manifest, collect_entries(
                   rec, [("web-ui", index_v2), ("mkddc-core", no_commit)]), fresh=False), "MKDDC_GIT_COMMIT"))
        with open(manifest, "rb") as handle:
            expect("AC4: manifest không đổi sau lần từ chối", handle.read() == before)
        expect("record: tên artifact lạ bị từ chối", _raises(lambda: rec.entry("mkddc-webx", core), "artifact lạ"))
        expect("record: --fresh thiếu mục bắt buộc bị từ chối",
               _raises(lambda: record_local(manifest, collect_entries(rec, [("web-ui", index_v2)]), fresh=True),
                       "thiếu mkddc-core"))
        expect("record: --artifact trùng tên bị từ chối",
               _raises(lambda: parse_artifact_args(["web-ui=a", "web-ui=b"]), "hai lần"))
        put("untracked.txt", b"x")
        expect("record: file untracked ⇒ dirty=true", _FakeRecorder(repo, "t").repo.dirty is True)
        os.remove(os.path.join(repo, "untracked.txt"))
        expect("record: git lỗi ⇒ từ chối", _raises(lambda: read_repo_state(work), "git"))

        # --- deploy-record trên "bo" giả chạy bằng sh -c ------------------
        board_sh = ["sh", "-c"]
        remote = os.path.join(work, "board", "usr/share/mkddc/artifact-manifest.json")
        d1 = deploy_record(board_sh, remote, collect_entries(rec, [("web-ui", index_v2)]))
        expect("deploy-record: bo chưa có manifest ⇒ tạo mới chỉ với artifact vừa deploy",
               sorted(d1["artifacts"]) == ["web-ui"])
        full = collect_entries(rec, [("mkddc-core", core), ("mkddc-iobus", iobus), ("mkddc-web", web_bin)])
        deploy_record(board_sh, remote, full)
        with open(web_bin, "wb") as handle:
            handle.write(b"go-binary-v2")
        d3 = deploy_record(board_sh, remote, collect_entries(rec, [("mkddc-web", web_bin)]))
        expect("AC2: deploy chỉ web cập nhật đúng mục mkddc-web trên bo",
               d3["artifacts"]["mkddc-web"]["sha256"] == hashlib.sha256(b"go-binary-v2").hexdigest())
        expect("AC2: deploy chỉ web giữ nguyên core/iobus/web-ui trên bo",
               all(d3["artifacts"][n] == (full.get(n) or d1["artifacts"].get(n))
                   for n in ("mkddc-core", "mkddc-iobus", "web-ui")))
        with open(remote, "w", encoding="utf-8") as handle:
            handle.write("{hỏng")
        expect("deploy-record: manifest trên bo hỏng ⇒ từ chối, không ghi đè",
               _raises(lambda: deploy_record(board_sh, remote, full), "không phải JSON"))
        with open(remote, encoding="utf-8") as handle:
            expect("deploy-record: manifest hỏng giữ nguyên", handle.read() == "{hỏng")

        # --- So sánh read-back từ fixture ----------------------------------
        arts = {
            "mkddc-core": {"install_path": "/usr/sbin/mkddc-core", "sha256": "c" * 64},
            "mkddc-iobus": {"install_path": "/usr/sbin/mkddc-iobus", "sha256": "d" * 64},
            "mkddc-web": {"install_path": "/opt/mkddc-web/mkddc-web", "sha256": "e" * 64},
            "web-ui": {"install_path": "/opt/mkddc-web/dist/index.html", "sha256": "f" * 64},
            "mkddc-st-compile": {"install_path": "/usr/sbin/mkddc-st-compile", "sha256": "a" * 64},
        }
        good_doc = {"schema": SCHEMA, "updated_at": "x", "artifacts": arts}

        def runtime(**over: str) -> str:
            rows = {
                "mkddc-core": f"UNIT mkddc-core|101|/usr/sbin/mkddc-core|{'c' * 64}",
                "mkddc-iobus": f"UNIT mkddc-iobus|102|/usr/sbin/mkddc-iobus|{'d' * 64}",
                "mkddc-web-pi": f"UNIT mkddc-web-pi|103|/opt/mkddc-web/mkddc-web|{'e' * 64}",
                "mkddc-reload-helper": f"UNIT mkddc-reload-helper|104|/opt/mkddc-web/mkddc-web|{'e' * 64}",
                "mkddc-time-helper": f"UNIT mkddc-time-helper|105|/opt/mkddc-web/mkddc-web|{'e' * 64}",
                "served": f"SERVED_FILE /opt/mkddc-web//dist/index.html|{'f' * 64}",
                "http": f"SERVED_HTTP 8082|{'f' * 64}",
                "file": f"FILE /usr/sbin/mkddc-st-compile|{'a' * 64}",
            }
            rows.update(over)
            return "\n".join(rows.values()) + "\n"

        def statuses(doc_: Optional[Dict[str, Any]], text: str, http: bool = True) -> Dict[str, str]:
            return {r["check"]: r["status"] for r in compare(doc_, parse_runtime(text), http)}

        ok = statuses(good_doc, runtime())
        expect("readback: 5 unit + index.html + HTTP + file = 8 kiểm, 0 lệch",
               len(ok) == 8 and set(ok.values()) == {"OK"})
        expect("readback: SHA web lệch ⇒ SHA_MISMATCH",
               statuses(good_doc, runtime(**{"mkddc-web-pi": f"UNIT mkddc-web-pi|103|/opt/mkddc-web/mkddc-web|{'9' * 64}"}))
               ["unit:mkddc-web-pi"] == "SHA_MISMATCH")
        expect("readback: helper chạy binary đã bị thay ⇒ STALE_EXE",
               statuses(good_doc, runtime(**{"mkddc-time-helper":
                                             f"UNIT mkddc-time-helper|105|/opt/mkddc-web/mkddc-web (deleted)|{'e' * 64}"}))
               ["unit:mkddc-time-helper"] == "STALE_EXE")
        expect("readback: helper không chạy ⇒ NOT_RUNNING",
               statuses(good_doc, runtime(**{"mkddc-reload-helper": "UNIT mkddc-reload-helper|0||"}))
               ["unit:mkddc-reload-helper"] == "NOT_RUNNING")
        expect("readback: core chạy từ đường dẫn khác ⇒ WRONG_PATH",
               statuses(good_doc, runtime(**{"mkddc-core": f"UNIT mkddc-core|101|/tmp/mkddc-core|{'c' * 64}"}))
               ["unit:mkddc-core"] == "WRONG_PATH")
        no_iobus = json.loads(json.dumps(good_doc))
        del no_iobus["artifacts"]["mkddc-iobus"]
        expect("readback + AC4: manifest thiếu mục ⇒ NO_ENTRY, không tự điền",
               statuses(no_iobus, runtime())["unit:mkddc-iobus"] == "NO_ENTRY")
        expect("readback: bo không có manifest ⇒ mọi kiểm NO_MANIFEST",
               {s for c, s in statuses(None, runtime()).items()} == {"NO_MANIFEST"})
        expect("readback: index.html lệch ⇒ SHA_MISMATCH",
               statuses(good_doc, runtime(served=f"SERVED_FILE /opt/mkddc-web/dist/index.html|{'1' * 64}"))
               ["served:index.html"] == "SHA_MISMATCH")
        expect("readback: STATIC_DIR trỏ dist khác ⇒ WRONG_PATH",
               statuses(good_doc, runtime(served=f"SERVED_FILE /tmp/dist/index.html|{'f' * 64}"))
               ["served:index.html"] == "WRONG_PATH")
        expect("readback: web không trả HTTP ⇒ HTTP_UNREACHABLE",
               statuses(good_doc, runtime(http="SERVED_HTTP 8082|"))["http:127.0.0.1:8082/"] == "HTTP_UNREACHABLE")
        expect("readback: --no-http bỏ kiểm HTTP",
               not any(c.startswith("http:") for c in statuses(good_doc, runtime(http="SERVED_HTTP 8082|"), False)))
        expect("readback: tool ST trên đĩa lệch ⇒ SHA_MISMATCH",
               statuses(good_doc, runtime(file=f"FILE /usr/sbin/mkddc-st-compile|{'2' * 64}"))
               ["file:/usr/sbin/mkddc-st-compile"] == "SHA_MISMATCH")
        expect("readback: tool ST mất ⇒ MISSING_FILE",
               statuses(good_doc, runtime(file="FILE /usr/sbin/mkddc-st-compile|"))
               ["file:/usr/sbin/mkddc-st-compile"] == "MISSING_FILE")

        script = runtime_script(["/usr/sbin/mkddc-st-compile"])
        stripped = script.replace("2>/dev/null", "").replace("-O /dev/null", "")
        expect("readback: script trên bo chỉ đọc (không ghi đè, không restart)",
               ">" not in stripped.replace("< \"/proc", "") and "restart" not in script and " mv " not in script
               and " rm " not in script)

        # --- Read-back đầu-cuối trên /proc thật của host -------------------
        sleep_bin = shutil.which("sleep")
        if not sys.platform.startswith("linux") or not sleep_bin:
            print("SKIP readback e2e: cần Linux /proc và lệnh sleep")
        else:
            board = os.path.join(work, "e2e")
            fake_bin = os.path.join(board, "bin")
            pids_dir = os.path.join(board, "pids")
            dist = os.path.join(board, "opt/mkddc-web/dist")
            for d in (fake_bin, pids_dir, dist):
                os.makedirs(d, exist_ok=True)
            with open(sleep_bin, "rb") as handle:
                sleep_bytes = handle.read()

            def place(path: str, tag: bytes) -> str:
                # Byte thêm sau cuối ELF không ảnh hưởng loader; mỗi "binary" có sha riêng.
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as handle:
                    handle.write(sleep_bytes + tag)
                os.chmod(path, 0o755)
                return path

            e_core = place(os.path.join(board, "usr/sbin/mkddc-core"), b"core")
            e_iobus = place(os.path.join(board, "usr/sbin/mkddc-iobus"), b"iobus")
            e_web = place(os.path.join(board, "opt/mkddc-web/mkddc-web"), b"web-v1")
            e_stc = place(os.path.join(board, "usr/sbin/mkddc-st-compile"), b"stc")
            e_index = os.path.join(dist, "index.html")
            with open(e_index, "w", encoding="utf-8") as handle:
                handle.write("<html lang=\"vi\">e2e</html>\n")
            with open(os.path.join(fake_bin, "systemctl"), "w", encoding="utf-8") as handle:
                handle.write('#!/bin/sh\nfor last; do :; done\ncat "$FAKE_PIDS/$last" 2>/dev/null || echo 0\n')
            with open(os.path.join(fake_bin, "wget"), "w", encoding="utf-8") as handle:
                handle.write('#!/bin/sh\nout=\nwhile [ $# -gt 0 ]; do case "$1" in -O) out=$2; shift 2;; '
                             '*) shift;; esac; done\n[ -f "$FAKE_INDEX" ] || exit 1\n'
                             'if [ "$out" = "-" ]; then cat "$FAKE_INDEX"; else cat "$FAKE_INDEX" > "$out"; fi\n')
            for tool in ("systemctl", "wget"):
                os.chmod(os.path.join(fake_bin, tool), 0o755)

            def spawn(unit: str, exe: str, env: Optional[Dict[str, str]] = None) -> None:
                proc = subprocess.Popen([exe, "60"], env=dict(os.environ, **(env or {})), cwd=board)
                procs.append(proc)
                with open(os.path.join(pids_dir, unit), "w", encoding="utf-8") as handle:
                    handle.write(f"{proc.pid}\n")

            spawn("mkddc-core", e_core)
            spawn("mkddc-iobus", e_iobus)
            spawn("mkddc-web-pi", e_web, {"STATIC_DIR": dist, "PORT": "18082"})
            spawn("mkddc-reload-helper", e_web)
            spawn("mkddc-time-helper", e_web)
            time.sleep(0.2)

            def sha_of(path: str) -> str:
                with open(path, "rb") as handle:
                    return hashlib.sha256(handle.read()).hexdigest()

            e_doc = {"schema": SCHEMA, "updated_at": "x", "artifacts": {
                "mkddc-core": {"install_path": e_core, "sha256": sha_of(e_core)},
                "mkddc-iobus": {"install_path": e_iobus, "sha256": sha_of(e_iobus)},
                "mkddc-web": {"install_path": e_web, "sha256": sha_of(e_web)},
                "web-ui": {"install_path": e_index, "sha256": sha_of(e_index)},
                "mkddc-st-compile": {"install_path": e_stc, "sha256": sha_of(e_stc)},
            }}
            e_remote = os.path.join(board, "usr/share/mkddc/artifact-manifest.json")
            write_local(e_remote, e_doc)
            e_ssh = ["env", f"PATH={fake_bin}:{os.environ.get('PATH', '')}", f"FAKE_PIDS={pids_dir}",
                     f"FAKE_INDEX={e_index}", "sh", "-c"]
            rep = readback(e_ssh, e_remote)
            expect(f"e2e: /proc thật, 8 kiểm, 0 lệch (được {rep['checks']}/{rep['mismatches']})",
                   rep["checks"] == 8 and rep["mismatches"] == 0)
            expect("e2e: STATIC_DIR và PORT đọc từ /proc/<pid>/environ",
                   rep["runtime"]["served_file"]["path"] == e_index and rep["runtime"]["served_http"]["port"] == "18082")
            # Thay binary web trên đĩa mà không restart: ba unit phải báo STALE_EXE.
            os.remove(e_web)
            place(e_web, b"web-v2")
            rep = readback(e_ssh, e_remote)
            got = {r["check"]: r["status"] for r in rep["results"]}
            expect("e2e: thay binary web không restart ⇒ STALE_EXE ở cả web lẫn hai helper",
                   all(got[f"unit:{u}"] == "STALE_EXE" for u in WEB_UNITS) and got["unit:mkddc-core"] == "OK")
    finally:
        for proc in procs:
            proc.kill()
            proc.wait()
        shutil.rmtree(work, ignore_errors=True)

    # --- Cùng tập unit với probe T63-001 -------------------------------------
    probe_path = os.path.join(HERE, "forlinx_perf_probe.py")
    spec_ = importlib.util.spec_from_file_location("forlinx_perf_probe", probe_path)
    if spec_ is None or spec_.loader is None:
        expect("probe T63-001 nạp được", False)
    else:
        probe = importlib.util.module_from_spec(spec_)
        sys.dont_write_bytecode = True  # selftest không để lại __pycache__ trong scripts/
        spec_.loader.exec_module(probe)
        expect("readback dùng đúng 5 unit của forlinx_perf_probe.UNITS", tuple(probe.UNITS) == READBACK_UNITS)
    expect("mọi unit read-back đều ánh xạ tới một artifact", all(u in UNIT_ARTIFACT for u in READBACK_UNITS))

    # --- Dây nối đóng gói: build-release sinh, install cài, rollback giữ đúng --
    root = os.path.dirname(HERE)

    def code_lines(rel: str) -> List[str]:
        with open(os.path.join(root, rel), encoding="utf-8") as handle:
            return [l for l in handle.read().splitlines() if not l.strip().startswith("#")]

    release = "\n".join(code_lines("platform/packaging/build-release.sh"))
    expect("build-release.sh gọi artifact_manifest.py record --fresh",
           "scripts/artifact_manifest.py\" record --fresh" in release)
    expect("build-release.sh ghi đủ artifact bắt buộc",
           all(f"--artifact {n}=" in release for n in REQUIRED))
    install = code_lines("platform/packaging/install.sh")
    expect("install.sh từ chối gói thiếu artifact-manifest.json",
           any("build/release/artifact-manifest.json ]" in l and "exit 1" in l for l in install))
    expect("install.sh cài artifact-manifest.json vào $SHAREDIR",
           any(l.strip().startswith("inst ") and '"$SHAREDIR/artifact-manifest.json"' in l for l in install))
    expect("install.sh chụp artifact-manifest.json vào snapshot rollback",
           any('"$SHAREDIR/artifact-manifest.json"' in l and l.strip().startswith('"$SHAREDIR/provenance.json"')
               for l in install))
    rollback = "\n".join(code_lines("platform/packaging/rollback.sh"))
    expect("rollback.sh khôi phục manifest từ snapshot", '"$SNAP/artifact-manifest.json"' in rollback)
    expect("rollback.sh gỡ manifest khi snapshot không có (không để mô tả bản mới)",
           'rm -f "$SHAREDIR/artifact-manifest.json"' in rollback)
    expect("rollback.sh khôi phục worker mô phỏng mà install.sh chụp (manifest snapshot mới khớp đĩa)",
           'restore mkddc-programming-sim-worker "$WEBDIR/mkddc-programming-sim-worker"' in rollback)

    print(f"selftest: {'FAIL' if failures else 'PASS'} ({len(failures)} lỗi)")
    return 1 if failures else 0


# ---------------------------------------------------------------------------


def default_repo() -> str:
    return os.path.dirname(HERE)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n", 1)[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    rec = sub.add_parser("record", help="ghi/cập nhật mục vào manifest cục bộ")
    rec.add_argument("--manifest", required=True, help="đường dẫn manifest cục bộ")
    rec.add_argument("--artifact", action="append", default=[], metavar="TÊN=FILE",
                     help=f"lặp lại được; TÊN ∈ {{{', '.join(sorted(REGISTRY))}}}")
    rec.add_argument("--fresh", action="store_true", help="dựng manifest mới (gói release đầy đủ)")
    rec.add_argument("--origin", default="record", help="ai ghi (build-release.sh, deploy, ...)")
    rec.add_argument("--repo", default=default_repo(), help="worktree đã build artifact")

    dep = sub.add_parser("deploy-record", help="ghi mục artifact vừa deploy vào manifest trên bo")
    dep.add_argument("--ssh", required=True, help='ví dụ: "ssh -p 22 -i KEY root@192.168.1.16"')
    dep.add_argument("--artifact", action="append", default=[], metavar="TÊN=FILE")
    dep.add_argument("--remote-manifest", default=REMOTE_MANIFEST)
    dep.add_argument("--origin", default="deploy")
    dep.add_argument("--repo", default=default_repo())
    dep.add_argument("--save-local", help="lưu thêm bản manifest vừa ghi lên bo (evidence)")

    rb = sub.add_parser("readback", help="so sha256 đang chạy trên bo với manifest (chỉ đọc)")
    rb.add_argument("--ssh", required=True)
    rb.add_argument("--remote-manifest", default=REMOTE_MANIFEST)
    rb.add_argument("--no-http", action="store_true", help="bỏ kiểm GET / qua HTTP trên bo")
    rb.add_argument("--json", help="ghi báo cáo JSON (evidence)")

    sub.add_parser("selftest", help="kiểm logic trên host")
    args = parser.parse_args(argv)

    try:
        if args.cmd == "selftest":
            return selftest()
        if args.cmd == "record":
            recorder = Recorder(args.repo, args.origin)
            record_local(args.manifest, collect_entries(recorder, parse_artifact_args(args.artifact)), args.fresh)
            return 0
        if args.cmd == "deploy-record":
            recorder = Recorder(args.repo, args.origin)
            entries = collect_entries(recorder, parse_artifact_args(args.artifact))
            doc = deploy_record(shlex.split(args.ssh), args.remote_manifest, entries)
            if args.save_local:
                write_local(args.save_local, doc)
            return 0
        report = readback(shlex.split(args.ssh), args.remote_manifest, not args.no_http)
        print_readback(report)
        if args.json:
            with open(args.json, "w", encoding="utf-8") as handle:
                json.dump(report, handle, ensure_ascii=False, indent=2)
        return 0 if report["mismatches"] == 0 else 1
    except ManifestError as err:
        print(f"LỖI: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
