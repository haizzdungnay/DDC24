package app

import (
	"context"
	"sync/atomic"
	"testing"
)

// ADR-061 mục 4.9 — tên khoá metric C2–C4 trong `task` của `point_snapshot` là
// HỢP ĐỒNG với Core (Track B): `budgetUs`, `baseStepUs`, `jitterMaxUs`,
// `jitterViolationCount`, `missedBaseStepCount`. Test khoá chúng từ JSON thô tới
// tận `MonitorTruthSnapshot`, và khoá luôn nhánh Core đời cũ (khoá vắng ⇒ nil,
// không phải 0).
func TestCorePointSnapshotForwardsTaskCycleMetrics(t *testing.T) {
	atomic.StoreUint64(&webCommandID, 940)
	path, _ := fakeCoreSocket(t, `{"id":941,"result":"accepted","snapshotId":11,`+
		`"snapshotObservedAtUtc":"2026-09-26T08:00:00.010Z","capturedMonotonicNs":10000000,`+
		`"task":{"taskId":"main","periodMs":10,"budgetMs":1,"state":"RUNNING","runCount":6000,`+
		`"missedReleaseCount":0,"lastExecNs":350000,"maxExecNs":910000,"overrunCount":0,"consecutiveOverruns":0,`+
		`"budgetUs":1999,"baseStepUs":10000,"jitterMaxUs":87,"jitterViolationCount":2,"missedBaseStepCount":1},`+
		`"points":[]}`)
	snapshot, err := (&CoreClient{SockPath: path}).ReadPointSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	task := snapshot.Task
	if task == nil || task.BudgetUS == nil || *task.BudgetUS != 1999 || task.BaseStepUS == nil ||
		*task.BaseStepUS != 10000 || task.JitterMaxUS == nil || *task.JitterMaxUS != 87 ||
		task.JitterViolationCount == nil || *task.JitterViolationCount != 2 ||
		task.MissedBaseStepCount == nil || *task.MissedBaseStepCount != 1 {
		t.Fatalf("metric C4 không decode đúng khoá Core: %+v", task)
	}

	app, _ := newTestAppWithAdmin(t)
	app.core = &programmingMonitorCore{pointsCore: &pointsCore{}, snapshot: snapshot}
	truth, err := app.programmingPointCatalog().ReadProgrammingMonitorSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	forwarded := truth.Task
	if forwarded == nil || forwarded.BudgetUS == nil || *forwarded.BudgetUS != 1999 ||
		forwarded.BaseStepUS == nil || *forwarded.BaseStepUS != 10000 ||
		forwarded.JitterMaxUS == nil || *forwarded.JitterMaxUS != 87 ||
		forwarded.JitterViolationCount == nil || *forwarded.JitterViolationCount != 2 ||
		forwarded.MissedBaseStepCount == nil || *forwarded.MissedBaseStepCount != 1 ||
		forwarded.PeriodMS != 10 || forwarded.BudgetMS != 1 {
		t.Fatalf("adapter không chuyển nguyên metric C4: %+v", forwarded)
	}

	atomic.StoreUint64(&webCommandID, 950)
	path, _ = fakeCoreSocket(t, `{"id":951,"result":"accepted","snapshotId":12,`+
		`"snapshotObservedAtUtc":"2026-09-26T08:00:01.000Z","capturedMonotonicNs":20000000,`+
		`"task":{"taskId":"main","periodMs":1000,"budgetMs":199,"state":"RUNNING","runCount":1,`+
		`"missedReleaseCount":0,"lastExecNs":1,"maxExecNs":1,"overrunCount":0,"consecutiveOverruns":0},"points":[]}`)
	legacy, err := (&CoreClient{SockPath: path}).ReadPointSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Task == nil || legacy.Task.BudgetUS != nil || legacy.Task.BaseStepUS != nil ||
		legacy.Task.JitterMaxUS != nil || legacy.Task.JitterViolationCount != nil ||
		legacy.Task.MissedBaseStepCount != nil {
		t.Fatalf("Core đời cũ: metric C4 phải là nil, nhận %+v", legacy.Task)
	}
}
