#!/usr/bin/env python3
"""Phân tích NDJSON khung Modbus: gom khung ghi thành loạt, đo loạt 16 DO.

Loạt = các khung ghi (FC05/06/15/16) nằm trong cùng một "đợt bận" của dây: đợt
bận kết thúc khi dây rảnh (không khung nào, kể cả khung đọc) quá GAP_MS. Program
chạy mỗi 100 ms nên hai lần đổi đầu ra liên tiếp cách nhau một khoảng rảnh; khi
dây còn bận (ghi tuần tự từng coil) thì cả chuỗi là một loạt. Loạt 16 DO = loạt ghi đủ 8 coil của slave 4
và 8 coil của slave 5.

Dùng: 2026-09-27-fc15-analyze_frames.py <file.ndjson[.gz]> [nhãn]
      FROM_UTC=2026-09-27T15:57:59.568Z ... (tuỳ chọn: bỏ khung bắt đầu trước mốc)

Hồ sơ: EV-MB-FC15-20260927 (../2026-09-27-fc15-coil-batch-target.md).
"""
import datetime
import gzip
import json
import os
import statistics
import sys

GAP_MS = float(os.environ.get("GAP_MS", "15"))
RELAY_SLAVES = (4, 5)


def load(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as fh:
        frames = [json.loads(line) for line in fh if line.strip()]
    for fr in frames:
        fr["end"] = float(fr["at"])
        fr["start"] = fr["end"] - fr["elapsedUs"] / 1000.0
    cut = os.environ.get("FROM_UTC")
    if cut:
        cut_ms = datetime.datetime.fromisoformat(cut.replace("Z", "+00:00")).timestamp() * 1000.0
        frames = [fr for fr in frames if fr["start"] >= cut_ms]
    frames.sort(key=lambda fr: fr["start"])
    return frames


def coils_of(fr):
    if fr["fc"] == 5:
        return [(fr["slave"], fr["addr"])]
    if fr["fc"] == 15:
        return [(fr["slave"], fr["addr"] + k) for k in range(fr["count"])]
    return []


def bursts(frames):
    out, cur, busy_end = [], [], None
    for fr in frames:
        if busy_end is not None and fr["start"] - busy_end > GAP_MS:
            if cur:
                out.append(cur)
            cur = []
        busy_end = fr["end"] if busy_end is None else max(busy_end, fr["end"])
        if fr["fc"] in (5, 6, 15, 16):
            cur.append(fr)
    if cur:
        out.append(cur)
    return out


def main():
    path = sys.argv[1]
    label = sys.argv[2] if len(sys.argv) > 2 else path
    frames = load(path)
    writes = [fr for fr in frames if fr["fc"] in (5, 6, 15, 16)]
    reads = [fr for fr in frames if fr["fc"] in (1, 2, 3, 4)]
    span_s = (frames[-1]["end"] - frames[0]["start"]) / 1000.0 if frames else 0.0
    print(f"== {label}: {len(frames)} khung trong {span_s:.1f} s "
          f"(ghi {len(writes)}, đọc {len(reads)}, lỗi {sum(1 for f in frames if not f['ok'])})")
    by_fc = {}
    for fr in writes:
        by_fc[(fr["fc"], fr["count"])] = by_fc.get((fr["fc"], fr["count"]), 0) + 1
    print("   khung ghi theo (fc, count):", dict(sorted(by_fc.items())))

    full = []
    for b in bursts(frames):
        coils = set()
        for fr in b:
            coils.update(coils_of(fr))
        per_slave = {s: {a for (sl, a) in coils if sl == s} for s in RELAY_SLAVES}
        if all(len(per_slave[s]) == 8 for s in RELAY_SLAVES):
            full.append(b)
    print(f"   loạt 16 DO: {len(full)}")
    if not full:
        return
    txs, spans, skews, gaps = [], [], [], []
    for b in full:
        relay_writes = [fr for fr in b if fr["slave"] in RELAY_SLAVES]
        txs.append(len(relay_writes))
        spans.append(max(fr["end"] for fr in relay_writes) - min(fr["start"] for fr in relay_writes))
        end4 = max(fr["end"] for fr in relay_writes if fr["slave"] == 4)
        end5 = max(fr["end"] for fr in relay_writes if fr["slave"] == 5)
        skews.append(abs(end5 - end4))
    starts = [min(fr["start"] for fr in b) for b in full]
    for a, b in zip(starts, starts[1:]):
        gaps.append(b - a)

    def stat(xs, unit="ms"):
        return (f"min {min(xs):.1f} / trung vị {statistics.median(xs):.1f} / "
                f"max {max(xs):.1f} {unit}")
    print("   số giao dịch ghi mỗi loạt:", stat(txs, "gd"), "| phân bố:",
          {n: txs.count(n) for n in sorted(set(txs))})
    print("   thời gian loạt (đầu khung ghi đầu → cuối khung ghi cuối):", stat(spans))
    print("   lệch kết thúc giữa hai module:", stat(skews))
    if gaps:
        print("   khoảng cách giữa hai loạt:", stat(gaps))
    # Độ chiếm dây trong 1 s kể từ đầu mỗi loạt 16 DO (nhịp BLINK 1 s): tổng
    # thời lượng mọi khung bắt đầu trong cửa sổ, chia 1000 ms.
    occ_all, occ_w = [], []
    for st in starts:
        win = [fr for fr in frames if st <= fr["start"] < st + 1000.0]
        occ_all.append(sum(fr["elapsedUs"] for fr in win) / 1000.0 / 10.0)
        occ_w.append(sum(fr["elapsedUs"] for fr in win if fr["fc"] in (5, 6, 15, 16)) / 1000.0 / 10.0)
    print("   chiếm dây 1 s từ đầu loạt — mọi khung:", stat(occ_all, "%"))
    print("   chiếm dây 1 s từ đầu loạt — chỉ khung ghi:", stat(occ_w, "%"))
    el = [fr["elapsedUs"] / 1000.0 for b in full for fr in b if fr["slave"] in RELAY_SLAVES]
    print("   thời lượng một khung ghi:", stat(el))
    sample = full[len(full) // 2]
    print("   loạt mẫu:")
    t0 = min(fr["start"] for fr in sample)
    for fr in sample:
        vals = fr.get("values")
        print(f"     +{fr['start'] - t0:7.1f} ms slave {fr['slave']} fc {fr['fc']:2d} addr {fr['addr']} "
              f"count {fr['count']} {fr['elapsedUs'] / 1000:.1f} ms ok={fr['ok']}"
              + (f" values={vals}" if vals is not None else ""))


if __name__ == "__main__":
    main()
