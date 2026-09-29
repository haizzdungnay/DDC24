package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/* T63-108 (PERF-API-03) — `ListFiltered` giữ `limit` sự kiện cuối bằng vòng
 * đệm. Đây là thay đổi hiệu năng thuần: kết quả phải y hệt bản cũ (cùng các sự
 * kiện, cùng thứ tự tệp). Các ca dưới khoá đúng ngữ nghĩa đó ở mọi chỗ vòng đệm
 * có thể sai: chưa đầy, đầy đúng biên, quay nhiều vòng, có bộ lọc, `limit < 0`. */

func writeAlarmHistoryFixture(t testing.TB, n int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "alarm-history.jsonl")
	var b strings.Builder
	for i := 0; i < n; i++ {
		event := AlarmHistoryEvent{
			EventID:  fmt.Sprintf("E%06d", i),
			Time:     fmt.Sprintf("2026-09-28T10:%02d:%02dZ", (i/60)%60, i%60),
			Event:    []string{"started", "acked", "ended"}[i%3],
			AlarmID:  fmt.Sprintf("ALM-%d", i%7),
			Severity: "high",
			Status:   "active",
			Message:  fmt.Sprintf("Alarm %d", i%7),
			Source:   "UI-01",
		}
		line, err := json.Marshal(event)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		b.Write(line)
		b.WriteByte('\n')
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return path
}

func eventIDs(events []AlarmHistoryEvent) []string {
	out := make([]string, len(events))
	for i, event := range events {
		out[i] = event.EventID
	}
	return out
}

func wantIDs(from, to int, keep func(int) bool) []string {
	out := []string{}
	for i := from; i < to; i++ {
		if keep == nil || keep(i) {
			out = append(out, fmt.Sprintf("E%06d", i))
		}
	}
	return out
}

func TestAlarmHistoryListKeepsTheLastEventsInFileOrder(t *testing.T) {
	store := NewAlarmHistoryStore(writeAlarmHistoryFixture(t, 2500))
	ctx := context.Background()
	cases := []struct {
		name  string
		limit int
		want  []string
	}{
		{"limit vượt trần bị kẹp về 1000", 3000, wantIDs(1500, 2500, nil)},
		{"quay nhiều vòng", 1000, wantIDs(1500, 2500, nil)},
		{"đúng biên", 2500 / 5, wantIDs(2000, 2500, nil)},
		{"một phần tử", 1, wantIDs(2499, 2500, nil)},
		{"tất cả", -1, wantIDs(0, 2500, nil)},
	}
	for _, tc := range cases {
		got, err := store.ListFiltered(ctx, tc.limit, AlarmHistoryFilter{})
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if strings.Join(eventIDs(got), ",") != strings.Join(tc.want, ",") {
			t.Fatalf("%s: got %d events [%s … %s]; want %d [%s … %s]", tc.name,
				len(got), first(eventIDs(got)), last(eventIDs(got)), len(tc.want), first(tc.want), last(tc.want))
		}
	}

	small := NewAlarmHistoryStore(writeAlarmHistoryFixture(t, 40))
	got, err := small.ListFiltered(ctx, 100, AlarmHistoryFilter{})
	if err != nil || strings.Join(eventIDs(got), ",") != strings.Join(wantIDs(0, 40, nil), ",") {
		t.Fatalf("tệp ngắn hơn limit phải trả đủ theo thứ tự; got %v err %v", eventIDs(got), err)
	}
}

func TestAlarmHistoryListFilterAppliesBeforeTheWindow(t *testing.T) {
	store := NewAlarmHistoryStore(writeAlarmHistoryFixture(t, 2500))
	got, err := store.ListFiltered(context.Background(), 100, AlarmHistoryFilter{Alarm: "ALM-3"})
	if err != nil {
		t.Fatal(err)
	}
	all := wantIDs(0, 2500, func(i int) bool { return i%7 == 3 })
	want := all[len(all)-100:]
	if strings.Join(eventIDs(got), ",") != strings.Join(want, ",") {
		t.Fatalf("got [%s … %s] (%d); want [%s … %s] (%d)", first(eventIDs(got)), last(eventIDs(got)), len(got), first(want), last(want), len(want))
	}
}

func first(ids []string) string {
	if len(ids) == 0 {
		return ""
	}
	return ids[0]
}

func last(ids []string) string {
	if len(ids) == 0 {
		return ""
	}
	return ids[len(ids)-1]
}

// BenchmarkAlarmHistoryListLarge đo đúng lượt đọc mà `/alarms` (Core im),
// `/alarms/metrics` và trang lịch sử làm: 1000 sự kiện cuối của tệp 20 000 dòng.
func BenchmarkAlarmHistoryListLarge(b *testing.B) {
	store := NewAlarmHistoryStore(writeAlarmHistoryFixture(b, 20000))
	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := store.ListFiltered(ctx, alarmHistoryMaxLimit, AlarmHistoryFilter{}); err != nil {
			b.Fatal(err)
		}
	}
}
