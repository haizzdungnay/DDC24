#!/usr/bin/env python3
"""Phân tích dữ liệu đọc thẳng từ Core/SHM/iobus (k827_direct.pl) cho T2/T3."""
import json
import sys
from datetime import datetime, timezone


def hms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%H:%M:%S.%f")[:-3]


def main():
    d = sys.argv[1]
    t0_key = sys.argv[2] if len(sys.argv) > 2 else "restart_cmd_ns"
    times = {}
    for line in open(f"{d}/times.txt"):
        if "=" in line:
            k, v = line.strip().split("=", 1)
            if k.endswith("_ns"):
                times[k] = int(v) // 1_000_000
    t0 = times[t0_key]
    print(f"t0 ({t0_key}) = {hms(t0)}Z")
    for k, v in times.items():
        print(f"  {k:18s} {hms(v)}Z  t0{v - t0:+8d} ms")
    rows = [json.loads(x) for x in open(f"{d}/direct.jsonl") if x.strip()]
    print(f"mẫu trực tiếp: {len(rows)}, {hms(rows[0]['t'])}Z … {hms(rows[-1]['t'])}Z")

    # Chuỗi trạng thái Program ở Core
    seq = []
    for r in rows:
        p = (r.get("prog") or [{}])[0] if r.get("prog") else {}
        key = (r.get("core"), p.get("state"), p.get("enabled"), p.get("waitingReason") or None,
               p.get("faultCount"), p.get("lastFaultCode") or None, tuple(r.get("safe") or ()))
        if seq and seq[-1]["key"] == key:
            seq[-1]["n"] += 1
            seq[-1]["last"] = r["t"]
        else:
            seq.append({"key": key, "n": 1, "first": r["t"], "last": r["t"]})
    print("chuỗi (core, state, enabled, waitingReason, faultCount, lastFaultCode, [safeState, noCtrlOnly]):")
    for s in seq:
        print(f"  t0{s['first'] - t0:+8d} … t0{s['last'] - t0:+8d} ms  n={s['n']:4d}  {s['key']}")

    # Chạy thật: lastRunMonoNs tăng
    first_run = None
    prev_mono = None
    for r in rows:
        if r["t"] < t0 or not r.get("prog"):
            continue
        p = r["prog"][0]
        if p.get("state") == "RUNNING" and p.get("lastRunMonoNs") and prev_mono is not None and p["lastRunMonoNs"] != prev_mono:
            first_run = r["t"]
            break
        prev_mono = p.get("lastRunMonoNs")
    if first_run:
        print(f"lần chạy đầu sau t0 (lastRunMonoNs đổi): mẫu t0{first_run - t0:+d} ms")
        for k in ("web_start_cmd_ns", "web_login_ok_ns"):
            if k in times:
                print(f"  tính từ {k}: {first_run - times[k]:+d} ms")

    # DO trong các pha
    phases = [("web dừng, Core cũ còn chạy", times.get("web_stop_ret_ns"), times.get("restart_cmd_ns")),
              ("Core mới, web dừng", times.get("restart_ret_ns"), times.get("web_start_cmd_ns")),
              ("web đang khởi động → RUNNING", times.get("web_start_cmd_ns"), first_run or rows[-1]["t"])]
    samples = {}
    for r in rows:
        for k, v in (r.get("do") or {}).items():
            samples[(k, v[2])] = (v[0], v[1])
    by_ch = {}
    for (k, ts), (v, q) in sorted(samples.items(), key=lambda x: x[0][1]):
        by_ch.setdefault(k, []).append((ts, v, q))
    for name, a, b in phases:
        if a is None or b is None:
            continue
        on = sorted({k for k, lst in by_ch.items() for ts, v, q in lst if a <= ts <= b and v})
        rises = []
        for k, lst in by_ch.items():
            pv = None
            for ts, v, q in lst:
                if a <= ts <= b and v and pv == 0:
                    rises.append((ts - t0, k))
                pv = v
        n = sum(1 for k, lst in by_ch.items() for ts, v, q in lst if a <= ts <= b)
        bad = sum(1 for k, lst in by_ch.items() for ts, v, q in lst if a <= ts <= b and q != 0)
        print(f"DO [{name}] t0{a - t0:+d} … t0{b - t0:+d} ms: {n} mẫu coil, chất lượng≠GOOD {bad}; kênh đóng: {on if on else 'không'}; 0→1: {sorted(rises) if rises else 'không'}")

    # Khung Modbus
    fr = {}
    for r in rows:
        if isinstance(r.get("fr"), list):
            for f in r["fr"]:
                fr[tuple(f[:6])] = f[6] if len(f) > 6 else None
    try:
        for f in json.load(open(f"{d}/frames.json"))["frames"]:
            fr[(f["at"], f["slave"], f["fc"], f["addr"], f["count"], 1 if f["ok"] else 0)] = f.get("values")
    except Exception:  # noqa: BLE001
        pass
    keys = sorted(fr)
    print(f"khung: {len(keys)}, t0{keys[0][0] - t0:+d} … t0{keys[-1][0] - t0:+d} ms; lỗi: {sum(1 for k in keys if not k[5])}")
    polls = [k for k in keys if k[2] == 1]
    gap = [b[0] - a[0] for a, b in zip(polls, polls[1:])]
    print(f"  FC01: {len(polls)} khung, khoảng hở lớn nhất {max(gap) if gap else '-'} ms")
    writes = [k for k in keys if k[2] in (5, 6, 15, 16)]
    for name, a, b in phases:
        if a is None or b is None:
            continue
        w = [k for k in writes if a <= k[0] <= b]
        ones = [k for k in w if fr.get(k) and any(fr[k])]
        print(f"  ghi [{name}]: {len(w)} khung; khung có bit 1: {len(ones)}")
        for k in w[:20]:
            print(f"    t0{k[0] - t0:+d} ms slave={k[1]} fc={k[2]} addr={k[3]} count={k[4]} values={fr.get(k)}")
    if first_run:
        post = [k for k in writes if k[0] > first_run - 1000]
        if post:
            k = post[0]
            print(f"  khung ghi đầu tiên quanh/sau lần chạy đầu: t0{k[0] - t0:+d} ms slave={k[1]} fc={k[2]} values={fr.get(k)}")
    pre = [k for k in writes if k[0] < (times.get("restart_cmd_ns") or t0)]
    if pre:
        print(f"  khung ghi cuối trước restart Core: t0{pre[-1][0] - t0:+d} ms")
    rej = [r["t"] - t0 for r in rows if r.get("core") not in ("ok",)]
    print(f"mẫu Core không trả snapshot: {len(rej)}" + (f" (t0{rej[0]:+d} … t0{rej[-1]:+d} ms)" if rej else ""))
    kinds = {}
    for r in rows:
        kinds[r.get("core")] = kinds.get(r.get("core"), 0) + 1
    print(f"  phân loại: {kinds}")


if __name__ == "__main__":
    main()
