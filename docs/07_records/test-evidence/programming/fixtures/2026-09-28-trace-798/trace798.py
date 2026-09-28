"""Issue #798 — kiểm Trace trên bo: releaseSeq, cặp vào/ra, readback DO Modbus."""
import json, sys, time, uuid, collections
import board

VARS = json.load(open('vars.json'))
def vid(name): return VARS[name][0]

def run_trace(names, sample_ms, duration_ms, tag):
    board.login()
    body = {"schemaVersion": "1.0", "variableIds": [vid(n) for n in names],
            "durationMs": duration_ms, "samplePeriodMs": sample_ms, "sampleMode": "EVERY_SAMPLE"}
    st, acc = board.post('/api/v1/programming/runtime/traces', body)
    print(tag, 'create', st, json.dumps(acc)[:300], flush=True)
    tid = acc['traceId']
    t0 = time.time()
    while True:
        time.sleep(5)
        st, tr = board.get(f'/api/v1/programming/runtime/traces/{tid}')
        if not isinstance(tr, dict):
            print(tag, 'poll', st, str(tr)[:200]); continue
        if tr['state'] != 'RUNNING' or time.time() - t0 > duration_ms / 1000 + 60:
            break
    json.dump(tr, open(f'trace_{tag}.json', 'w'))
    return tr

def analyse(tr, names, program_period_ms, tag):
    idx = {vid(n): n for n in names}
    order = [idx[v] for v in tr['variableIds']]
    samples = tr['samples']
    rep = collections.OrderedDict()
    rep['tag'] = tag
    rep['state'] = tr['state']; rep['stopReason'] = tr['stopReason']; rep['source'] = tr.get('source')
    rep['samplePeriodMs'] = tr['samplePeriodMs']; rep['effectiveSamplePeriodMs'] = tr.get('effectiveSamplePeriodMs')
    rep['droppedSamples'] = tr['droppedSamples']; rep['samples'] = len(samples)
    rep['startedAt'] = tr['startedAt']; rep['updatedAt'] = tr['updatedAt']
    # 1. releaseSeq trong mẫu và giữa mẫu
    mixed = 0; not_released = 0; unresolved = 0; seqs = []
    for s in samples:
        rs = {v.get('releaseSeq') for v in s['values'] if v.get('releaseSeq') is not None}
        not_released += sum(1 for v in s['values'] if v.get('unavailableReason') == 'NOT_RELEASED')
        unresolved += sum(1 for v in s['values'] if v.get('unavailableReason') == 'UNRESOLVED')
        if len(rs) > 1: mixed += 1
        seqs.append(min(rs) if rs else None)
    deltas = collections.Counter()
    gaps = []
    for a, b, sa, sb in zip(seqs, seqs[1:], samples, samples[1:]):
        if a is None or b is None: deltas['none'] += 1; continue
        d = b - a; deltas[d] += 1
        if d != round(rep['effectiveSamplePeriodMs'] or tr['samplePeriodMs']) // program_period_ms:
            gaps.append((sa['sequence'], sb['sequence'], a, b, d, sa['observedAt'], sb['observedAt']))
    rep['samplesWithMixedReleaseSeq'] = mixed
    rep['notReleasedCells'] = not_released; rep['unresolvedCells'] = unresolved
    rep['releaseSeqFirstLast'] = (seqs[0], seqs[-1]) if seqs else None
    rep['releaseSeqDeltaHistogram'] = dict(sorted(((str(k), v) for k, v in deltas.items())))
    rep['releaseSeqUnexpectedGaps'] = gaps[:20]; rep['releaseSeqUnexpectedGapCount'] = len(gaps)
    # 2. bất biến vào/ra cùng mẫu (không nới luật)
    def val(s, name):
        for v, n in zip(s['values'], order):
            if n == name: return v
    violations = collections.Counter(); examples = []
    dos = [f'DO{i:02d}' for i in range(1, 17)]
    for s in samples:
        cells = {n: v for v, n in zip(s['values'], order)}
        if any(cells[n].get('unavailableReason') for n in cells): continue
        pv = {n: cells[n]['programValue'] for n in cells}
        if all(d in pv for d in dos) and 'StsOnCount' in pv:
            on = sum(1 for d in dos if pv[d] in (True, 1))
            if round(float(pv['StsOnCount'])) != on:
                violations['StsOnCount!=so_kenh_dong'] += 1; examples.append((s['sequence'], 'on', on, pv['StsOnCount']))
        if 'CmdLockMask' in pv and all(d in pv for d in dos):
            mask = int(round(float(pv['CmdLockMask'])))
            for i, d in enumerate(dos):
                if (mask >> i) & 1 and pv[d] in (True, 1):
                    violations['kenh_khoa_dang_dong'] += 1; examples.append((s['sequence'], 'lock', d))
        if 'InPermit' in pv and pv['InPermit'] in (False, 0) and all(d in pv for d in dos):
            if any(pv[d] in (True, 1) for d in dos) or ('StsMode' in pv and pv['StsMode'] != 9):
                violations['mat_cho_phep_ma_con_dong'] += 1; examples.append((s['sequence'], 'permit'))
        if 'StsMode' in pv and pv['StsMode'] in (0, 8) and all(d in pv for d in dos):
            if any(pv[d] in (True, 1) for d in dos):
                violations['StsMode_nghi_ma_con_dong'] += 1; examples.append((s['sequence'], 'rest', pv['StsMode']))
    rep['invariantViolations'] = dict(violations); rep['invariantExamples'] = examples[:10]
    # 3. readback DO Modbus
    rb = collections.OrderedDict()
    actual_mismatch = 0; rb_ne_cmd = 0; rb_cells = 0; ages = []
    lags = []; age_resets = 0; age_increases = 0
    for d in [n for n in order if n.startswith('DO')]:
        prev_cmd = None; pending = None; prev_age = None
        for s in samples:
            c = [v for v, n in zip(s['values'], order) if n == d][0]
            if c.get('unavailableReason'): continue
            cmd, back, age, act = c.get('commandedValue'), c.get('readbackValue'), c.get('readbackAgeMs'), c.get('actualValue')
            if act != back: actual_mismatch += 1
            if back is not None:
                rb_cells += 1
                if back != cmd: rb_ne_cmd += 1
            if age is not None:
                ages.append(age)
                if prev_age is not None:
                    if age > prev_age: age_increases += 1
                    elif age < prev_age: age_resets += 1
                prev_age = age
            t = s['observedAt']
            if prev_cmd is not None and cmd != prev_cmd:
                pending = (t, cmd, s['sequence'], back)
            if pending and back == pending[1]:
                lags.append((d, pending[2], s['sequence'], pending[0], t))
                pending = None
            prev_cmd = cmd
    rep['actualValueNotEqualReadback'] = actual_mismatch
    rep['readbackCells'] = rb_cells; rep['readbackNotEqualCommanded'] = rb_ne_cmd
    rep['readbackAgeMs'] = (min(ages), max(ages)) if ages else None
    rep['readbackAgeIncreases'] = age_increases; rep['readbackAgeResets'] = age_resets
    from datetime import datetime
    def ts(x): return datetime.fromisoformat(x.replace('Z', '+00:00')).timestamp()
    lag_ms = sorted(round((ts(b) - ts(a)) * 1000) for _, _, _, a, b in lags)
    rep['commandChangesCaughtUp'] = len(lag_ms)
    if lag_ms:
        rep['readbackLagMs_min_median_max'] = (lag_ms[0], lag_ms[len(lag_ms)//2], lag_ms[-1])
    rep['lagExamples'] = lags[:6]
    return rep

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'coarse':
        names = ['CmdMode', 'InPermit', 'CmdLockMask', 'CmdManualMask'] + [f'DO{i:02d}' for i in range(1, 17)] + ['StsMode', 'StsOnCount']
        tr = run_trace(names, 100, 45000, 'coarse100')
        rep = analyse(tr, names, 10, 'coarse100')
    else:
        names = ['CmdMode', 'InPermit', 'CmdLockMask', 'DO01', 'DO02', 'StsOnCount']
        tr = run_trace(names, 10, 15000, 'fine10')
        rep = analyse(tr, names, 10, 'fine10')
    json.dump(rep, open(f'report_{rep["tag"]}.json', 'w'), indent=1, ensure_ascii=False, default=str)
    print(json.dumps(rep, indent=1, ensure_ascii=False, default=str))
