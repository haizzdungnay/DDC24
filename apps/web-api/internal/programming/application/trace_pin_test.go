package application

import (
	"context"
	"testing"
	"time"
)

// T59-810 — Trace pin.
//
// Một phiên Trace kéo dài qua một lần cutover sẽ ghép mẫu của HAI chương trình
// khác nhau vào cùng một đồ thị, và người đọc không có cách nào nhìn ra chỗ
// nối. `traceTupleDrifted` là phép so quyết định phiên có được lấy mẫu tiếp
// hay không, nên mọi nhánh của nó phải đúng.
func TestTraceTupleDrifted(t *testing.T) {
	revA := "11111111-1111-4111-8111-111111111111"
	revB := "22222222-2222-4222-8222-222222222222"

	pin := func(revision *string, ns string) TracePinView {
		return TracePinView{RevisionID: revision, Producer: ProducerStampView{CapturedMonotonicNs: ns}}
	}
	page := func(revision *string, ns string) MonitorPageView {
		return MonitorPageView{ActiveRevisionID: revision, Producer: ProducerStampView{CapturedMonotonicNs: ns}}
	}

	cases := []struct {
		name    string
		pin     TracePinView
		current MonitorPageView
		drifted bool
	}{
		{"cùng Revision, mốc tiến ⇒ không trôi", pin(&revA, "100"), page(&revA, "200"), false},
		{"cùng Revision, mốc đứng yên ⇒ không trôi", pin(&revA, "100"), page(&revA, "100"), false},
		{"đổi Revision ⇒ trôi", pin(&revA, "100"), page(&revB, "200"), true},
		{"mốc LÙI ⇒ Core restart ⇒ trôi", pin(&revA, "500"), page(&revA, "100"), true},
		{"pin có Revision, hiện tại không ⇒ trôi", pin(&revA, "100"), page(nil, "100"), true},
		{"pin không có Revision, hiện tại có ⇒ trôi", pin(nil, "100"), page(&revA, "100"), true},
		{"dấu hiện tại hỏng ⇒ trôi (không chứng minh được vẫn cùng tuple)", pin(&revA, "100"), page(&revA, "x"), true},
		{"dấu đã neo hỏng ⇒ trôi", pin(&revA, ""), page(&revA, "100"), true},
	}

	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			if got := traceTupleDrifted(item.pin, item.current); got != item.drifted {
				t.Fatalf("traceTupleDrifted = %v, muốn %v", got, item.drifted)
			}
		})
	}
}

// Mốc vượt 2^53 phải so đúng: `strconv.ParseUint` giữ nguyên độ chính xác, còn
// một lần đi vòng qua float64 sẽ gộp hai giá trị liền kề làm một và phép so
// "mốc lùi" im lặng sai đúng lúc thiết bị chạy lâu nhất.
func TestTraceTupleDriftedBeyondFloatPrecision(t *testing.T) {
	revision := "11111111-1111-4111-8111-111111111111"
	pin := TracePinView{RevisionID: &revision, Producer: ProducerStampView{CapturedMonotonicNs: "9007199254740993"}}
	older := MonitorPageView{ActiveRevisionID: &revision, Producer: ProducerStampView{CapturedMonotonicNs: "9007199254740992"}}
	newer := MonitorPageView{ActiveRevisionID: &revision, Producer: ProducerStampView{CapturedMonotonicNs: "9007199254740994"}}

	if float64(9007199254740993) != float64(9007199254740992) {
		t.Skip("nền tảng này phân biệt được hai giá trị qua float64; test mất ý nghĩa")
	}
	if !traceTupleDrifted(pin, older) {
		t.Fatal("mốc lùi ở dải vượt 2^53 phải bị coi là trôi")
	}
	if traceTupleDrifted(pin, newer) {
		t.Fatal("mốc tiến ở dải vượt 2^53 không được coi là trôi")
	}
}

// Trace pin ở mức tích hợp: Core restart GIỮA phiên phải dừng phiên trước khi
// một mẫu nào của mạch mới lọt vào dãy.
//
// Đây là chỗ mà một lỗi "chỉ một điểm lạ" khó lần nhất: đồ thị vẫn liền mạch về
// hình, nhưng điểm cuối thuộc một lần chạy khác với các điểm trước nó.
func TestTraceStopsBeforeSplicingAcrossProducerRestart(t *testing.T) {
	service, monitorProvider := newMonitorTraceService(t)

	fixed := time.Date(2026, 8, 13, 12, 0, 2, 0, time.UTC)
	programValue := 41.0
	priority := 2
	remaining := int64(272)
	snapshot := func(capturedNs uint64) MonitorTruthSnapshot {
		return MonitorTruthSnapshot{
			ObservedAt: fixed.Format(time.RFC3339Nano), SafeState: false,
			CapturedMonotonicNs: capturedNs,
			Task:                &TaskMetricsView{TaskID: "main", PeriodMS: 1000, BudgetMS: 200, State: "RUNNING", RunCount: 10, LastExecNS: 1200, MaxExecNS: 3000, OverrunCount: 1},
			Points: []MonitorPointTruth{{
				Category: "LOCAL", PointID: "AO-01", ObservedAt: fixed.Format(time.RFC3339Nano),
				ActualValue: 62.0, ProgramValue: &programValue, Source: "manual",
				EffectivePriority: &priority, OverrideActor: "operator-1", OverrideRemainingS: &remaining,
				Quality: "GOOD", Unit: "V",
			}},
		}
	}

	// Neo phiên vào một mốc monotonic THẬT, không phải 0.
	monitorProvider.set(snapshot(5_000_000_000))
	accepted, err := service.CreateTrace(context.Background(), TraceRequest{
		SchemaVersion: "1.0", VariableIDs: []string{monitorVariableID}, DurationMS: 5000, SamplePeriodMS: 100,
	}, Actor{ID: "admin", Role: "admin"}, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "trace-pin-000001")
	if err != nil {
		t.Fatalf("CreateTrace: %v", err)
	}

	pinned, err := service.GetTrace(accepted.TraceID)
	if err != nil {
		t.Fatalf("GetTrace: %v", err)
	}
	if pinned.Pin.Producer.CapturedMonotonicNs != "5000000000" {
		t.Fatalf("phiên phải neo vào mốc thật, nhận %q", pinned.Pin.Producer.CapturedMonotonicNs)
	}
	if pinned.Pin.RevisionID == nil || *pinned.Pin.RevisionID != monitorRevisionID {
		t.Fatalf("phiên phải neo vào Revision active, nhận %+v", pinned.Pin.RevisionID)
	}

	/* Mẫu đã lấy TRƯỚC khi trôi là mẫu hợp lệ của mạch cũ — BE lấy một mẫu ngay
	 * lúc tạo khi Core không nhận phiên ring. Bất biến cần khoá không phải "dãy
	 * rỗng" mà là "dãy KHÔNG DÀI THÊM sau khi tuple trôi": đúng một mẫu của mạch
	 * mới lọt vào là đủ để đồ thị nói dối. */
	beforeDrift := len(pinned.Samples)

	// Core khởi động lại: mốc monotonic LÙI trong khi Revision không đổi.
	monitorProvider.set(snapshot(1_000_000))

	deadline := time.Now().Add(2 * time.Second)
	var view TraceView
	for time.Now().Before(deadline) {
		view, err = service.GetTrace(accepted.TraceID)
		if err == nil && view.State != "RUNNING" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if view.State != "FAILED" || view.StopReason == nil || *view.StopReason != "SOURCE_UNAVAILABLE" {
		t.Fatalf("Core restart giữa phiên phải dừng phiên fail-closed: %+v", view)
	}
	if len(view.Samples) != beforeDrift {
		t.Fatalf("dãy dài thêm sau khi tuple trôi: %d ⇒ %d mẫu", beforeDrift, len(view.Samples))
	}
	// Dừng vì tuple trôi KHÔNG phải là mẫu bị rơi — gộp hai thứ làm số
	// `dropped` mất nghĩa.
	if view.DroppedSamples != 0 {
		t.Fatalf("dừng do tuple trôi không được tính là mẫu rơi, nhận %d", view.DroppedSamples)
	}
}
