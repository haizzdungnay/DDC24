#!/usr/bin/env python3
"""T63-304 — kiểm đỏ: bỏ từng bản sửa trong bản sao scratch rồi chạy test canh nó."""
import json, os, re, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
API = os.path.join(HERE, 'red/apps/web-api')
SRC = '/home/user/MK-DDC-24/apps/web-api'
RUN = 'internal/programming/compiler/runner.go'
CHK = 'internal/programming/application/checks.go'


def mutate(rel, old, new):
    p = os.path.join(API, rel); s = open(p).read()
    assert old in s, (rel, old[:80]); open(p, 'w').write(s.replace(old, new, 1))


def restore(rel):
    shutil.copy(os.path.join(SRC, rel), os.path.join(API, rel))


def gotest(pkg, pattern):
    p = subprocess.run(['go', 'test', pkg, '-run', pattern, '-count=1', '-timeout', '90s'], cwd=API,
                       capture_output=True, text=True, timeout=900)
    o = p.stdout + p.stderr
    failed = sorted(set(re.findall(r'--- FAIL: (\S+)', o)))
    if not failed and 'panic: test timed out' in o:
        failed = ['<timeout: ' + (re.search(r'running tests:\s*\n\s*(\S+)', o) or [None, '?'])[1] + '>']
    if not failed and 'build failed' in o:
        failed = ['<build failed>']
    return p.returncode, failed


C = './internal/programming/compiler/'
A = './internal/programming/application/'
CT = 'TestCompile|TestWorkerPool|TestCompilerProcess'
AT = 'TestCheckCompilesInParallel|TestCheckParallel'
cases = [
    ('R1 bỏ tra cache', RUN, '\t\tif cached, hit := cache.get(cacheKey); hit {\n\t\t\treturn cached, nil\n\t\t}\n', '', C, CT),
    ('R2 khoá không gồm hash binary compiler', RUN, 'compileCacheKeySchema, hex.EncodeToString(compilerDigest[:]), signingKeyDigest',
     'compileCacheKeySchema, hex.EncodeToString(compilerDigest[:0]), signingKeyDigest', C, CT),
    ('R3 khoá không gồm hash khoá ký', RUN, 'signingKeyDigest = hex.EncodeToString(keyDigest[:])',
     'signingKeyDigest = hex.EncodeToString(keyDigest[:0])', C, CT),
    ('R4 khoá chỉ gồm SourceID+Source', RUN, 'domain.ProfileTargetABI, MaxArtifactBytes, input})',
     'domain.ProfileTargetABI, MaxArtifactBytes, Input{SourceID: input.SourceID, Source: input.Source}})', C, CT),
    ('R5 cache cả kết quả lỗi (Compile + put)', RUN, '\tif err == nil && result.OK && cacheable {', '\tif err == nil && cacheable {', C, CT),
    ('R5b put nhận kết quả lỗi', RUN, '\tif !result.OK || c.maxEntries <= 0 || c.maxBytes <= 0 {', '\tif c.maxEntries <= 0 || c.maxBytes <= 0 {', C, 'TestCompileCacheIsBoundedLRU'),
    ('R6 trả chung vùng nhớ với cache', RUN, '\treturn cloneResult(entry.result), true', '\treturn entry.result, true', C, CT),
    ('R7 bỏ trần LRU', RUN, '\tfor c.order.Len() > c.maxEntries || c.bytes > c.maxBytes {', '\tfor false {', C, CT),
    ('R8 bỏ pool (không giới hạn process)', RUN, '\tcase p.slots <- struct{}{}:\n', '\tdefault:\n', C, CT),
    ('R9 chờ slot vô hạn (bỏ hẹn giờ)', RUN,
     '\tcase <-timer.C:\n\t\tp.busy.Add(1)\n\t\treturn nil, fmt.Errorf("%w: %w: chờ slot compiler quá %s (tối đa %d process)",\n\t\t\tErrTimeout, ErrWorkerPoolBusy, maxWait, cap(p.slots))\n',
     '', C, 'TestWorkerPoolWaitIsBounded'),
    ('R10 bỏ hạ ưu tiên CPU', RUN, 'syscall.Setpriority(syscall.PRIO_PGRP, cmd.Process.Pid, compileWorkerNice)', 'error(nil)', C, CT),
    ('R11 không dừng phát Input sau lỗi', RUN, '\t\t\t\tif err != nil {\n\t\t\t\t\tmu.Lock()\n\t\t\t\t\tstopped = true', '\t\t\t\tif false {\n\t\t\t\t\tmu.Lock()\n\t\t\t\t\tstopped = true', C, CT),
    ('R12 trần song song 1', RUN, 'MaxConcurrentCompiles = 2', 'MaxConcurrentCompiles = 1', A, AT),
    ('R12b trần song song 1 (gói compiler)', RUN, 'MaxConcurrentCompiles = 2', 'MaxConcurrentCompiles = 1', C, CT),
    ('R12c trần song song 3', RUN, 'MaxConcurrentCompiles = 2', 'MaxConcurrentCompiles = 3', C, CT),
    ('R13 checks.go bỏ đường lô (luôn tuần tự)', CHK, '\tif batch, ok := s.runner.(programmingcompiler.BatchRunner); ok {', '\tif batch, ok := s.runner.(programmingcompiler.BatchRunner); ok && false {', A, AT),
    ('R14 gộp kết quả theo thứ tự hoàn thành', RUN,
     '\t\t\t\tresult, err := compile(ctx, inputs[index])\n\t\t\t\toutcomes[index] = CompileOutcome{Result: result, Err: err, Ran: true}',
     '\t\t\t\tresult, err := compile(ctx, inputs[index])\n\t\t\t\tmu.Lock()\n\t\t\t\toutcomes[done] = CompileOutcome{Result: result, Err: err, Ran: true}\n\t\t\t\tdone++\n\t\t\t\tmu.Unlock()', A, AT),
]
out = []
for name, rel, old, new, pkg, pattern in cases:
    mutate(rel, old, new)
    if name.startswith('R5 '):
        mutate(rel, '\tif !result.OK || c.maxEntries <= 0 || c.maxBytes <= 0 {', '\tif c.maxEntries <= 0 || c.maxBytes <= 0 {')
    if name.startswith('R8'):
        mutate(rel, '\t\t\t<-p.slots\n', '\t\t\t_ = p.slots\n')
    if name.startswith('R14'):
        mutate(rel, '\t\tnext    int\n', '\t\tnext    int\n\t\tdone    int\n')
    rc, failed = gotest(pkg, pattern)
    restore(rel)
    out.append({'mutation': name, 'package': pkg, 'exit': rc, 'failed': failed, 'red': rc != 0})
    print(json.dumps(out[-1], ensure_ascii=False), flush=True)
rc1, f1 = gotest(C, CT); rc2, f2 = gotest(A, AT)
print(json.dumps({'restored_compiler': [rc1, f1], 'restored_application': [rc2, f2]}, ensure_ascii=False))
os.makedirs(os.path.join(HERE, 'evidence-t63-304-host'), exist_ok=True)
json.dump(out, open(os.path.join(HERE, 'evidence-t63-304-host/red-results.json'), 'w'), ensure_ascii=False, indent=2)
print('RED', sum(r['red'] for r in out), '/', len(out))
