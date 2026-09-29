#!/usr/bin/env python3
"""T63-108 — kiểm đỏ: bỏ từng bản sửa (trong bản sao scratch) rồi chạy test canh nó.

Mỗi đột biến phải làm ÍT NHẤT một test đích đỏ; sau đó khôi phục file và chạy lại
để chắc bản sao sạch vẫn xanh."""
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(HERE, 'red')
UI = os.path.join(R, 'apps/web-ui')
API = os.path.join(R, 'apps/web-api')
SRC_UI = '/home/user/MK-DDC-24/apps/web-ui'
SRC_API = '/home/user/MK-DDC-24/apps/web-api'
HEADS = os.path.join(R, 'heads')


def replace(rel, old, new, root=UI):
    path = os.path.join(root, rel)
    s = open(path).read()
    if old not in s:
        raise SystemExit(f'mutation anchor missing in {rel}: {old[:60]!r}')
    open(path, 'w').write(s.replace(old, new, 1))


def use_head(rel, name, root=UI):
    shutil.copy(os.path.join(HEADS, name), os.path.join(root, rel))


def restore(rel, root=UI, src=SRC_UI):
    shutil.copy(os.path.join(src, rel), os.path.join(root, rel))


def vitest(files):
    proc = subprocess.run(['npx', 'vitest', '--run', '--environment', 'jsdom', *files], cwd=UI,
                          capture_output=True, text=True, timeout=600)
    out = proc.stdout + proc.stderr
    m = re.search(r'Tests\s+(.*?)\n', out)
    failed = re.findall(r'(?:×|FAIL)\s+(.*)', out)
    return proc.returncode, (m.group(1).strip() if m else '?'), failed


def gotest(pattern):
    proc = subprocess.run(['go', 'test', './internal/app/', '-run', pattern, '-count=1'], cwd=API,
                          capture_output=True, text=True, timeout=600)
    out = proc.stdout + proc.stderr
    failed = re.findall(r'--- FAIL: (\S+)', out)
    return proc.returncode, ('FAIL' if proc.returncode else 'ok'), failed


H = 'src/shared/hooks/'
UI_MUTATIONS = [
    ('M1 useApi: bỏ dừng-khi-ẩn + đọc bù', [H + 'useApi.ts'], lambda: (
        replace(H + 'useApi.ts', '      if (pageHidden()) return\n      void fetchNow(false)', '      void fetchNow(false)'),
        replace(H + 'useApi.ts', "    document.addEventListener('visibilitychange', catchUpWhenVisible)\n", '')),
     [H + 'useApi.test.tsx']),
    ('M2 useApi: bỏ khử request nền đang bay', [H + 'useApi.ts'], lambda: (
        replace(H + 'useApi.ts', '    if (!showLoading && inFlight.current > 0) return\n', ''),),
     [H + 'useApi.test.tsx']),
    ('M3 OverviewProvider: nhịp 1 s → 2 s', ['src/shared/overview/OverviewProvider.tsx'], lambda: (
        replace('src/shared/overview/OverviewProvider.tsx', 'export const DEFAULT_OVERVIEW_REFRESH_MS = 1000', 'export const DEFAULT_OVERVIEW_REFRESH_MS = 2000'),),
     ['src/shared/overview/OverviewProvider.test.tsx']),
    ('M4 OverviewProvider: bỏ dừng-khi-ẩn', ['src/shared/overview/OverviewProvider.tsx'], lambda: (
        replace('src/shared/overview/OverviewProvider.tsx', '{ if (!pageHidden()) void load() }', '{ void load() }'),),
     ['src/shared/overview/OverviewProvider.test.tsx']),
    ('M5 useSharedPoll: bỏ khử trùng request đang bay', [H + 'useSharedPoll.ts'], lambda: (
        replace(H + 'useSharedPoll.ts', '  if (entry.inFlight) return entry.inFlight\n', ''),),
     [H + 'useSharedPoll.test.tsx']),
    ('M6 useSharedPoll: bỏ dừng-khi-ẩn', [H + 'useSharedPoll.ts'], lambda: (
        replace(H + 'useSharedPoll.ts', '    if (!pageHidden()) void run(entry)\n  }, shortest)', '    void run(entry)\n  }, shortest)'),),
     [H + 'useSharedPoll.test.tsx']),
    ('M7 useSharedPoll: bỏ đọc bù khi hiện lại', [H + 'useSharedPoll.ts'], lambda: (
        replace(H + 'useSharedPoll.ts', '    if (dueNow(entry)) void run(entry)\n  }\n}', '  }\n}'),),
     [H + 'useSharedPoll.test.tsx']),
    ('M8 useSharedPoll: bỏ đọc ngay khi nhịp ngắn lại', [H + 'useSharedPoll.ts'], lambda: (
        replace(H + 'useSharedPoll.ts', '  if (shrinking && entry.lastAttemptAt > 0 && !pageHidden() && dueNow(entry)) void run(entry)\n', ''),),
     [H + 'useSharedPoll.test.tsx']),
    ('M9 useLivePoints: bỏ lùi nhịp khi kênh sống tươi', [H + 'useLivePoints.ts'], lambda: (
        replace(H + 'useLivePoints.ts', 'live ? Math.max(pollMs, POINTS_BACKSTOP_MS) : pollMs', 'pollMs'),),
     [H + 'useLivePoints.test.tsx', 'src/features/dashboard/DashboardPage.polling.test.tsx']),
    ('M10 useLivePoints: bỏ hẹn giờ hết hạn kênh sống', [H + 'useLivePoints.ts'], lambda: (
        replace(H + 'useLivePoints.ts', '    const timer = window.setTimeout(rerender, Math.max(0, remaining) + 1)\n    return () => window.clearTimeout(timer)', '    void remaining\n    return undefined'),),
     [H + 'useLivePoints.test.tsx']),
    ('M11 useLivePoints: bỏ điều kiện socket connected', [H + 'useLivePoints.ts'], lambda: (
        replace(H + 'useLivePoints.ts', "realtime.connectionState === 'connected'\n    && ", ''),),
     [H + 'useLivePoints.test.tsx']),
    ('M12 useShellAlarms: tin overview cả khi degraded alarms', ['src/shared/alarms/useShellAlarms.ts'], lambda: (
        replace('src/shared/alarms/useShellAlarms.ts', " && !overview.data.degraded.includes('alarms')", ''),),
     ['src/shared/alarms/useShellAlarms.test.tsx', 'src/shared/components/AppShell.polling.test.tsx']),
    ('M13 useShellAlarms: rơi về 0 khi chờ /alarms', ['src/shared/alarms/useShellAlarms.ts'], lambda: (
        replace('src/shared/alarms/useShellAlarms.ts', 'counts = lastTrusted.current ?? { total: 0, unacked: 0 }', 'counts = { total: 0, unacked: 0 }'),),
     ['src/shared/alarms/useShellAlarms.test.tsx']),
    ('M14 AppShell: bản HEAD (poll /alarms 1 s, /system/status 5 s)', ['src/shared/components/AppShell.tsx'], lambda: (
        use_head('src/shared/components/AppShell.tsx', 'AppShell.tsx'),),
     ['src/shared/components/AppShell.polling.test.tsx']),
    ('M15 DashboardPage: bản HEAD (3 vòng /points, 2 vòng /activity)', ['src/features/dashboard/DashboardPage.tsx'], lambda: (
        use_head('src/features/dashboard/DashboardPage.tsx', 'DashboardPage.tsx'),),
     ['src/features/dashboard/DashboardPage.polling.test.tsx']),
    ('M16 visibleInterval: bỏ dừng-khi-ẩn', [H + 'visibleInterval.ts'], lambda: (
        replace(H + 'visibleInterval.ts', '    if (pageHidden()) return\n    lastRunAt', '    lastRunAt'),),
     [H + 'visibleInterval.test.ts']),
    ('M17 queries.ts: bản HEAD (setInterval trần)', ['src/features/programming/api/queries.ts'], lambda: (
        use_head('src/features/programming/api/queries.ts', 'queries.ts'),),
     ['src/features/programming/api/queries.test.tsx']),
    ('M18 FrameMonitor: bản HEAD', ['src/features/modbus-rtu/components/FrameMonitor.tsx'], lambda: (
        use_head('src/features/modbus-rtu/components/FrameMonitor.tsx', 'FrameMonitor.tsx'),),
     ['src/features/modbus-rtu/components/FrameMonitor.test.tsx']),
    ('M19 WatchTab: bản HEAD', ['src/features/programming/runtime/WatchTab.tsx'], lambda: (
        use_head('src/features/programming/runtime/WatchTab.tsx', 'WatchTab.tsx'),),
     ['src/features/programming/runtime/WatchTab.test.tsx']),
]

GO_MUTATIONS = [
    ('G1 alarms.go: bản HEAD (writeJSON, không ETag)', ['internal/app/alarms.go'], lambda: (
        use_head('internal/app/alarms.go', 'alarms.go', root=API),),
     'TestAlarmsAnswer304OnlyWhileTheBodyIsUnchanged|TestAlarmsETagChangesWhenCoreBecomesUnreadable'),
    ('G2 users.go: bản HEAD (writeJSON, không ETag)', ['internal/app/users.go'], lambda: (
        use_head('internal/app/users.go', 'users.go', root=API),),
     'TestMeAnswers304PerUserAndNeverAcrossUsers'),
    ('G3 alarmhistory.go: bản HEAD (quét lịch sử mọi lượt /alarms)', ['internal/app/alarmhistory.go'], lambda: (
        use_head('internal/app/alarmhistory.go', 'alarmhistory.go', root=API),),
     'TestAlarmsDoNotReadHistoryWhileCoreIsReadable'),
]

results = []
only = set(sys.argv[1:])
for name, files, mutate, tests in UI_MUTATIONS:
    if only and name.split()[0] not in only:
        continue
    mutate()
    rc, summary, failed = vitest(tests)
    for rel in files:
        restore(rel)
    results.append({'mutation': name, 'tests': tests, 'exit': rc, 'summary': summary, 'failed': failed[:6], 'red': rc != 0})
    print(json.dumps(results[-1], ensure_ascii=False), flush=True)
for name, files, mutate, pattern in GO_MUTATIONS:
    if only and name.split()[0] not in only:
        continue
    mutate()
    rc, summary, failed = gotest(pattern)
    for rel in files:
        restore(rel, root=API, src=SRC_API)
    results.append({'mutation': name, 'tests': pattern, 'exit': rc, 'summary': summary, 'failed': failed, 'red': rc != 0})
    print(json.dumps(results[-1], ensure_ascii=False), flush=True)

# Bản sao đã khôi phục phải xanh lại.
all_ui = sorted({t for *_, tests in UI_MUTATIONS for t in tests})
rc, summary, failed = vitest(all_ui)
grc, gsummary, gfailed = gotest('TestAlarmsAnswer304|TestAlarmsETagChanges|TestMeAnswers304|TestIfNoneMatchHits|TestVirtualPointsNeverAnswer304|TestAlarmsDoNotReadHistory|TestHandleAlarms')
restored = {'restored_ui_exit': rc, 'restored_ui': summary, 'restored_go_exit': grc}
print(json.dumps(restored, ensure_ascii=False))
json.dump({'results': results, 'restored': restored}, open(os.path.join(HERE, 'red-results.json'), 'w'), ensure_ascii=False, indent=2)
print('ALL RED:', all(r['red'] for r in results), f'{sum(r["red"] for r in results)}/{len(results)}')
