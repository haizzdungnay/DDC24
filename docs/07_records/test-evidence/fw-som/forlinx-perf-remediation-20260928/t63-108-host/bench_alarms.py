#!/usr/bin/env python3
"""T63-108 — chi phí server của GET /alarms khi kho lịch sử lớn (20 000 sự kiện, 4,1 MB).
Đo 300 lượt tuần tự trên một kết nối keep-alive; CPU tiến trình server từ /proc."""
import http.client, json, os, statistics, subprocess, sys, time
port, label, n, binary = int(sys.argv[1]), sys.argv[2], int(sys.argv[3]), sys.argv[4]
pids = []
for d in os.listdir('/proc'):
    if d.isdigit():
        try:
            if os.path.basename(os.readlink(f'/proc/{d}/exe')) == binary:
                pids.append(d)
        except OSError:
            pass
assert len(pids) == 1, pids
pid = pids[0]
def ticks():
    f = open(f'/proc/{pid}/stat').read().split()
    return int(f[13]) + int(f[14])
c = http.client.HTTPConnection('127.0.0.1', port)
c.request('POST', '/api/v1/auth/login', json.dumps({'username': os.environ.get('MKDDC_WEB_USER', 'admin'), 'password': os.environ['MKDDC_WEB_PASSWORD']}), {'Content-Type': 'application/json'})
tok = json.loads(c.getresponse().read())['token']
h = {'Authorization': 'Bearer ' + tok}
for path in ['/api/v1/alarms', '/api/v1/overview']:
    c.request('GET', path, headers=h); c.getresponse().read()  # hâm nóng
    lat = []
    t0 = ticks()
    for _ in range(n):
        s = time.perf_counter()
        c.request('GET', path, headers=h)
        r = c.getresponse(); body = r.read()
        lat.append((time.perf_counter() - s) * 1000)
    cpu = (ticks() - t0) / 100
    lat.sort()
    print(json.dumps({'label': label, 'path': path, 'n': n, 'status': r.status, 'bytes': len(body),
                      'p50_ms': round(statistics.median(lat), 2), 'p95_ms': round(lat[int(0.95 * n)], 2),
                      'server_cpu_s': cpu, 'cpu_ms_per_req': round(cpu * 1000 / n, 2)}, ensure_ascii=False))
