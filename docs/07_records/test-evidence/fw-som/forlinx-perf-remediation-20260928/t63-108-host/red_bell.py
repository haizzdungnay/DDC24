#!/usr/bin/env python3
"""T63-108 bổ sung — kiểm đỏ cho activeOrUnacked (chỉ đổi nguồn chuông, không đổi ngữ nghĩa)."""
import json, os, re, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
UI = os.path.join(HERE, 'red/apps/web-ui'); API = os.path.join(HERE, 'red/apps/web-api')
SRC = {'ui': '/home/user/MK-DDC-24/apps/web-ui', 'api': '/home/user/MK-DDC-24/apps/web-api'}


def mutate(root, rel, old, new):
    p = os.path.join(root, rel); s = open(p).read()
    assert old in s, (rel, old[:70]); open(p, 'w').write(s.replace(old, new, 1))


def restore(kind, rel):
    shutil.copy(os.path.join(SRC[kind], rel), os.path.join(UI if kind == 'ui' else API, rel))


def vitest(files):
    p = subprocess.run(['npx', 'vitest', '--run', '--environment', 'jsdom', *files], cwd=UI, capture_output=True, text=True, timeout=600)
    o = p.stdout + p.stderr
    m = re.search(r'Tests\s+(.*?)\n', o)
    return p.returncode, m.group(1).strip() if m else '?', sorted(set(re.findall(r'×\s+(.*?)\s+\d+ms', o)))


def gotest(pattern):
    p = subprocess.run(['go', 'test', './internal/app/', '-run', pattern, '-count=1'], cwd=API, capture_output=True, text=True, timeout=600)
    o = p.stdout + p.stderr
    return p.returncode, 'FAIL' if p.returncode else 'ok', sorted(set(re.findall(r'--- FAIL: (\S+)', o)))


HOOK = 'src/shared/alarms/useShellAlarms.ts'
UI_TESTS = ['src/shared/alarms/useShellAlarms.test.tsx', 'src/shared/components/AppShell.polling.test.tsx']
OV = 'internal/app/overview.go'
GO_TESTS = 'TestShellBell|TestOverviewActiveOrUnacked'
cases = [
    ('F1 hook đọc total thay activeOrUnacked', 'ui', HOOK,
     'counts = { total: snapshotAlarms.activeOrUnacked, unacked: snapshotAlarms.unacked }',
     'counts = { total: snapshotAlarms.total, unacked: snapshotAlarms.unacked }', UI_TESTS),
    ('F2 hook tin snapshot thiếu activeOrUnacked (lấy total thế)', 'ui', HOOK,
     '    bellCount(overview.data.alarms.activeOrUnacked) &&\n', '', UI_TESTS),
    ('G4 overview dùng total làm activeOrUnacked', 'api', OV,
     'out.Alarms.ActiveOrUnacked = countShellBellAlarms(a.mergeAlarmHistoryRows(ctx, alarms, false))',
     'out.Alarms.ActiveOrUnacked = out.Alarms.Total', GO_TESTS),
    ('G5 quy tắc "Active || unack" (bỏ nhánh status khi active vắng trên dây)', 'api', OV,
     '\tif alarm.Active {\n\t\treturn true\n\t}\n\tswitch shellBellStatus(alarm.Status) {\n\tcase "active", "acked", "unack":\n\t\treturn true\n\t}\n\treturn false',
     '\treturn alarm.Active || shellBellStatus(alarm.Status) == "unack"', GO_TESTS),
    ('G6 đếm trên danh sách thô, không theo góc nhìn /alarms', 'api', OV,
     'countShellBellAlarms(a.mergeAlarmHistoryRows(ctx, alarms, false))', 'countShellBellAlarms(alarms)', GO_TESTS),
]
out = []
for name, kind, rel, old, new, tests in cases:
    mutate(UI if kind == 'ui' else API, rel, old, new)
    rc, summary, failed = vitest(tests) if kind == 'ui' else gotest(tests)
    restore(kind, rel)
    out.append({'mutation': name, 'exit': rc, 'summary': summary, 'failed': failed, 'red': rc != 0})
    print(json.dumps(out[-1], ensure_ascii=False), flush=True)
rc1, s1, _ = vitest(UI_TESTS); rc2, s2, _ = gotest(GO_TESTS)
print(json.dumps({'restored_ui': [rc1, s1], 'restored_go': [rc2, s2]}, ensure_ascii=False))
json.dump(out, open(os.path.join(HERE, 'evidence-t63-108-host/red-results-bell.json'), 'w'), ensure_ascii=False, indent=2)
print('RED', sum(r['red'] for r in out), '/', len(out))
