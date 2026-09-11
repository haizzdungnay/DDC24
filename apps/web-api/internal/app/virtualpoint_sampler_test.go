package app

import (
	"bytes"
	"context"
	"errors"
	"log"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// virtualPointPrunerStub ghi lại đúng thứ tự các lời gọi `PruneBefore` và cho
// phép ép hỏng theo từng Point, để kiểm được rằng một item hỏng không cắt hạn
// lưu của item còn lại.
type virtualPointPrunerStub struct {
	calls  []string
	errFor map[string]error
}

func (p *virtualPointPrunerStub) PruneBefore(_ context.Context, pointID string, _ int64) error {
	p.calls = append(p.calls, pointID)
	return p.errFor[pointID]
}

func TestVirtualPointRetentionLogsPruneFailureAndKeepsGoing(t *testing.T) {
	pruneErr := errors.New("prune down")
	pruner := &virtualPointPrunerStub{errFor: map[string]error{"VP1": pruneErr, "VP2": pruneErr}}
	var logs bytes.Buffer
	logger := log.New(&logs, "", 0)
	items := []VirtualPoint{
		{ID: "VP1", RetentionS: 60},
		{ID: "VP2", RetentionS: 120},
		{ID: "VP3", RetentionS: 30},
		{ID: "VP4", RetentionS: 0},
	}

	pruneVirtualPointRetention(context.Background(), pruner, logger, items, 10_000_000)

	// Item hỏng đầu tiên không được làm hỏng hạn lưu của các item phía sau;
	// item không khai hạn lưu vẫn bị bỏ qua như trước.
	want := []string{"VP1", "VP2", "VP3"}
	if strings.Join(pruner.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("calls=%v want=%v", pruner.calls, want)
	}
	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("mỗi lần hỏng phải đúng một dòng log: %q", logs.String())
	}
	for i, line := range lines {
		if line != "WARN virtual_points.prune err=prune down" {
			t.Fatalf("dòng %d sai định dạng: %q", i, line)
		}
	}
}

func TestVirtualPointRetentionStaysSilentWhenPruneSucceeds(t *testing.T) {
	pruner := &virtualPointPrunerStub{}
	var logs bytes.Buffer

	pruneVirtualPointRetention(context.Background(), pruner, log.New(&logs, "", 0), []VirtualPoint{{ID: "VP1", RetentionS: 60}}, 10_000_000)

	if len(pruner.calls) != 1 || logs.Len() != 0 {
		t.Fatalf("calls=%v logs=%q", pruner.calls, logs.String())
	}
}

// Chứng minh đường thi hành hạn lưu vẫn nối đúng vào bộ lấy mẫu: mẫu cũ hơn
// hạn lưu bị xoá còn mẫu vừa ghi được giữ.
func TestSampleVirtualPointsAppliesRetentionThroughTrendStore(t *testing.T) {
	store := openTrendStoreForSamplerTest(t)
	var logs bytes.Buffer
	app := &App{trends: store, logger: log.New(&logs, "", 0)}
	now := time.Date(2026, 9, 11, 8, 0, 0, 0, time.UTC)
	nowMs := now.UTC().UnixMilli()
	if err := store.InsertBatch(context.Background(), []Sample{{TS: nowMs - 600_000, PointID: "VP1", Value: 1.0, Quality: 0}}); err != nil {
		t.Fatal(err)
	}
	interval := 1000
	items := []VirtualPoint{{ID: "VP1", Enabled: true, LogEnabled: true, LogIntervalMs: &interval, RetentionS: 60, SignalType: virtualPointSignalFloat, Value: 42.0}}

	app.sampleVirtualPoints(context.Background(), items, now, map[string]int64{})

	rows, err := store.Query(context.Background(), []string{"VP1"}, 0, nowMs)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].TS != nowMs {
		t.Fatalf("hạn lưu không được thi hành: rows=%+v", rows)
	}
	if logs.Len() != 0 {
		t.Fatalf("logs=%q", logs.String())
	}
}

func openTrendStoreForSamplerTest(t *testing.T) *TrendStore {
	t.Helper()
	store, err := OpenTrendStore(filepath.Join(t.TempDir(), "trend.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}
