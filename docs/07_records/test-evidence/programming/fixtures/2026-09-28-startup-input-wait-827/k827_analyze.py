#!/usr/bin/env python3
"""Phân tích một lần đo T1/T2/T3 của Issue #827 (dữ liệu kéo về từ bo).

Dùng: k827_analyze.py <thư mục> [--t0-key restart_cmd_ns] [--run-key ...]
Mốc t0 lấy từ times.txt (khoá mặc định restart_cmd_ns).
"""
import json
import sys
from datetime import datetime, timezone


def iso_ms(s):
    if not s:
        return None
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)


def hms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%H:%M:%S.%f")[:-3]


def main():
    d = sys.argv[1]
    t0_key = "restart_cmd_ns"
    for i, a in enumerate(sys.argv):
        if a == "--t0-key":
            t0_key = sys.argv[i + 1]
    times = {}
    for line in open(f"{d}/times.txt"):
        if "=" in line and line.split("=", 1)[0].endswith("_ns"):
            k, v = line.strip().split("=", 1)
            times[k] = int(v) // 1_000_000
    t0 = times[t0_key]
    rows = [json.loads(x) for x in open(f"{d}/samples.jsonl") if x.strip()]
    print(f"t0 ({t0_key}) = {hms(t0)}Z; mẫu = {len(rows)}")
    for k, v in times.items():
        print(f"  {k}: {hms(v)}Z (t0{v - t0:+d} ms)")

    # Trạng thái trước t0
    before = [r for r in rows if r["t"] < t0 and r.get("prog")]
    fc_before = before[-1]["prog"][0]["faultCount"] if before else None
    act_before = before[-1]["rt"]["activeRevisionId"] if before and before[-1].get("rt") else None
    print(f"trước t0: {len(before)} mẫu, faultCount={fc_before}, Active={act_before}")

    # Chuỗi trạng thái sau t0 (gộp các mẫu liên tiếp giống nhau)
    seq = []
    for r in rows:
        if r["t"] < t0:
            continue
        p = r.get("prog", [{}])[0] if r.get("prog") else {}
        key = (p.get("runtimeState"), p.get("coreState"), p.get("waitingReason"),
               p.get("faultCount"), p.get("lastFaultCode"), p.get("desiredEnabled"),
               r.get("progHttp"))
        if seq and seq[-1]["key"] == key:
            seq[-1]["n"] += 1
            seq[-1]["last"] = r["t"]
        else:
            seq.append({"key": key, "n": 1, "first": r["t"], "last": r["t"]})
    print("chuỗi trạng thái sau t0 (runtimeState, coreState, waitingReason, faultCount, lastFaultCode, desiredEnabled, http):")
    for s in seq:
        print(f"  {s['first'] - t0:+7d} … {s['last'] - t0:+7d} ms  n={s['n']:3d}  {s['key']}")

    # RUNNING thật sự: mẫu RUNNING đầu tiên có lastRunAtUtc sau t0
    t_run = None
    for r in rows:
        if r["t"] < t0 or not r.get("prog"):
            continue
        p = r["prog"][0]
        lr = iso_ms(p.get("lastRunAtUtc"))
        if p.get("runtimeState") == "RUNNING" and lr and lr > t0:
            t_run = r["t"]
            print(f"RUNNING đầu tiên sau t0: mẫu {hms(r['t'])}Z = t0{r['t'] - t0:+d} ms; lastRunAtUtc={p.get('lastRunAtUtc')} (t0{lr - t0:+d} ms)")
            break
    after = [r for r in rows if r["t"] >= t0 and r.get("prog")]
    waiting = [r for r in after if (t_run is None or r["t"] < t_run) and r["prog"][0].get("coreState") == "WAITING"]
    reasons = sorted({str(r["prog"][0].get("waitingReason")) for r in waiting})
    print(f"mẫu WAITING trước RUNNING: {len(waiting)}; waitingReason={reasons}")
    if waiting:
        print(f"  WAITING đầu tiên t0{waiting[0]['t'] - t0:+d} ms, cuối cùng t0{waiting[-1]['t'] - t0:+d} ms")
    fc_after = after[-1]["prog"][0]["faultCount"] if after else None
    lfc_after = after[-1]["prog"][0]["lastFaultCode"] if after else None
    print(f"cuối lượt: faultCount={fc_after} (trước {fc_before}), lastFaultCode={lfc_after}, state={after[-1]['prog'][0]['runtimeState'] if after else None}")
    faulted = [r for r in after if r["prog"][0].get("runtimeState") == "FAULTED" or r["prog"][0].get("coreState") == "FAULTED"]
    print(f"mẫu FAULTED sau t0: {len(faulted)}")

    # Active / producerState / health
    acts = sorted({str((r.get("rt") or {}).get("activeRevisionId")) for r in rows if r.get("rt")})
    prods = {}
    for r in rows:
        if r.get("rt"):
            prods[r["rt"].get("producerState")] = prods.get(r["rt"].get("producerState"), 0) + 1
    print(f"Active quan sát: {acts}; producerState: {prods}")
    hbad = [(r["t"] - t0, r["health"]["bad"]) for r in rows if r.get("health") and r["health"]["bad"]]
    hmiss = [r["t"] - t0 for r in rows if not r.get("health")]
    hok = sum(1 for r in rows if r.get("health") and not r["health"]["bad"] and r["health"]["n"] == 6)
    print(f"health 6/6 ok: {hok}/{len(rows)} mẫu; mẫu có check không ok: {len(hbad)}; mẫu không đọc được health: {len(hmiss)}")
    if hbad:
        print(f"  check không ok: t0{hbad[0][0]:+d} … t0{hbad[-1][0]:+d} ms, {sorted({c for _, b in hbad for c in b})}")

    # Mốc: Core mới sẵn sàng (systemctl trả về sau READY=1) và mẫu cuối chưa RUNNING
    t_ready = times.get("restart_ret_ns", t0)
    t_run_prev = None
    if t_run:
        prevs = [r["t"] for r in rows if t0 <= r["t"] < t_run]
        t_run_prev = prevs[-1] if prevs else t0
    end = t_run_prev if t_run_prev else rows[-1]["t"]
    print(f"khoảng chờ tính cho DO/khung ghi: Core mới sẵn sàng t0{t_ready - t0:+d} ms … mẫu cuối chưa RUNNING t0{end - t0:+d} ms")

    # DO đọc về (coil FC01, theo mốc mẫu của iobus)
    samples = {}
    for r in rows:
        for k, v in (r.get("do") or {}).items():
            ts = iso_ms(v[2])
            if ts:
                samples[(k, ts)] = v[0]
    by_ch = {}
    for (k, ts), v in sorted(samples.items(), key=lambda x: x[0][1]):
        by_ch.setdefault(k, []).append((ts, v))
    pre_on = sorted(k for k, lst in by_ch.items() if [v for ts, v in lst if ts < t0] and [v for ts, v in lst if ts < t0][-1])
    print(f"DO đóng ở mẫu coil cuối trước t0: {len(pre_on)} kênh {pre_on}")
    rises = []
    win_on = {}
    for k, lst in by_ch.items():
        prevv = None
        for ts, v in lst:
            if t_ready <= ts <= end:
                win_on.setdefault(ts, 0)
                if v:
                    win_on[ts] += 1
                if v and prevv == 0:
                    rises.append((ts - t0, k))
            prevv = v
    closed_in_win = sorted({k for k, lst in by_ch.items() for ts, v in lst if t_ready <= ts <= end and v})
    print(f"mẫu coil trong khoảng chờ: {sum(1 for k, lst in by_ch.items() for ts, v in lst if t_ready <= ts <= end)} (16 kênh x số lần poll); kênh đóng trong khoảng chờ: {closed_in_win if closed_in_win else 'không có'}")
    print(f"DO chuyển 0→1 trong khoảng chờ (theo mốc mẫu coil): {sorted(rises) if rises else 'không có'}")
    after_run = sorted({k for k, lst in by_ch.items() for ts, v in lst if t_run and t_run <= ts <= t_run + 3000 and v})
    print(f"kênh đóng trong 3 s đầu sau RUNNING: {after_run if after_run else 'không có'}")

    # Khung Modbus: gộp khung sampler kéo về và frames.json
    fr = set()
    for r in rows:
        for f in r.get("fr") or []:
            fr.add(tuple(f[:6]))
    try:
        for f in json.load(open(f"{d}/frames.json"))["frames"]:
            fr.add((f["at"], f["slave"], f["fc"], f["addr"], f["count"], 1 if f["ok"] else 0))
    except Exception:  # noqa: BLE001
        pass
    fr = sorted(fr)
    if not fr:
        print("frames: không có")
        return
    print(f"frames: {len(fr)} khung, t0{fr[0][0] - t0:+d} … t0{fr[-1][0] - t0:+d} ms")
    polls = [f for f in fr if f[2] == 1]
    gap = [b[0] - a[0] for a, b in zip(polls, polls[1:])]
    if gap:
        print(f"  khoảng cách hai khung FC01 liên tiếp lớn nhất: {max(gap)} ms (liên tục nếu ≲ 1 000 ms)")
    writes = [f for f in fr if f[2] in (5, 6, 15, 16)]
    tail = [f for f in writes if t0 <= f[0] < t_ready]
    win = [f for f in writes if t_ready <= f[0] <= end]
    print(f"khung ghi t0 … Core mới sẵn sàng (đuôi lệnh của Core cũ): {len(tail)}")
    print(f"khung ghi trong khoảng chờ của Core mới: {len(win)}")
    for f in win:
        print(f"  t0{f[0] - t0:+d} ms slave={f[1]} fc={f[2]} addr={f[3]} count={f[4]} ok={f[5]}")
    post = [f for f in writes if f[0] > end]
    if post:
        print(f"khung ghi đầu tiên sau khoảng chờ: t0{post[0][0] - t0:+d} ms slave={post[0][1]} fc={post[0][2]} addr={post[0][3]} count={post[0][4]}")
    pre = [f for f in writes if f[0] < t0]
    if pre:
        print(f"khung ghi cuối trước t0: t0{pre[-1][0] - t0:+d} ms")
    print(f"khung lỗi: {sum(1 for f in fr if not f[5])}")

if __name__ == "__main__":
    main()
