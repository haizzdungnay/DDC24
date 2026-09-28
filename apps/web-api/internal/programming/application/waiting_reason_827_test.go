package application

import (
	"context"
	"encoding/json"
	"testing"

	coreipc "mkddc-web/internal/programming/coreipc"
)

// Issue #827 — Program dùng Virtual Point chờ đầu vào sau khi Core khởi động.
//
// Core giờ đưa Program có đầu vào REQUIRED chưa GOOD vào WAITING kèm
// `waitingReason = INPUT_NOT_READY` thay vì FAULTED `ST-RT-008` ngay mẫu đầu. Phía
// web phải (1) chuyển lý do tới FE đúng hợp đồng, và (2) KHÔNG coi WAITING là lỗi
// hay là lệch intent: không replay Enable, không ghi FAULTED.

func TestListProgramsExposesWaitingReasonOnlyForLiveWaiting(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store,
		programsIntentSeed{programID: "prog-input", desiredEnabled: true},
		programsIntentSeed{programID: "prog-signal", desiredEnabled: true},
		programsIntentSeed{programID: "prog-legacy", desiredEnabled: true},
		programsIntentSeed{programID: "prog-running", desiredEnabled: true},
		programsIntentSeed{programID: "prog-future", desiredEnabled: true},
		programsIntentSeed{programID: "prog-stopped", desiredEnabled: true},
	)
	zero := uint32(0)
	empty := ""
	service := newProgramsService(t, store, &fakeMonitorProvider{snapshot: liveProgramsSnapshot(
		// Vừa khởi động lại: chưa chạy lần nào, chưa fault.
		ProgramMetricsView{InstanceID: "prog-input", State: "WAITING", Enabled: true, PeriodMS: 10,
			LastFaultCode: &empty, FaultCount: &zero, WaitingReason: stringPointer("INPUT_NOT_READY")},
		ProgramMetricsView{InstanceID: "prog-signal", State: "WAITING", Enabled: true, PeriodMS: 1000,
			LastRunMonoNS: 8_000_000_000, WaitingReason: stringPointer("SIGNAL_NOT_READY")},
		// Core đời cũ: không gửi khoá `waitingReason`.
		ProgramMetricsView{InstanceID: "prog-legacy", State: "WAITING", Enabled: true, PeriodMS: 1000},
		// Lý do cũ còn sót nhưng Program đã RUNNING: không được bày ra.
		ProgramMetricsView{InstanceID: "prog-running", State: "RUNNING", Enabled: true, PeriodMS: 10,
			LastRunMonoNS: 8_900_000_000, WaitingReason: stringPointer("INPUT_NOT_READY")},
		// Core mới hơn web gửi giá trị ngoài enum: `null`, không phá hợp đồng.
		ProgramMetricsView{InstanceID: "prog-future", State: "WAITING", Enabled: true, PeriodMS: 10,
			WaitingReason: stringPointer("SOMETHING_NEW")},
		// STOPPED cũng chiếu về WAITING nhưng Core không cấp lý do.
		ProgramMetricsView{InstanceID: "prog-stopped", State: "STOPPED", Enabled: true, PeriodMS: 10,
			WaitingReason: stringPointer("")},
	)})

	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	expected := map[string]string{
		"prog-input":   "INPUT_NOT_READY",
		"prog-signal":  "SIGNAL_NOT_READY",
		"prog-legacy":  "<null>",
		"prog-running": "<null>",
		"prog-future":  "<null>",
		"prog-stopped": "<null>",
	}
	for programID, want := range expected {
		item := itemByID(t, page, programID)
		got := "<null>"
		if item.WaitingReason != nil {
			got = *item.WaitingReason
		}
		if got != want {
			t.Errorf("%s: waitingReason=%s; want %s", programID, got, want)
		}
	}

	input := itemByID(t, page, "prog-input")
	if input.RuntimeState != "WAITING" || input.Health != nil {
		t.Fatalf("chờ đầu vào phải là WAITING, health null (không FAULT): state=%s health=%s",
			input.RuntimeState, healthOf(input))
	}
	if input.FaultCount == nil || *input.FaultCount != 0 || input.LastFaultCode == nil || *input.LastFaultCode != "" {
		t.Fatalf("chờ đầu vào không được mang dấu fault: %+v / %+v", input.FaultCount, input.LastFaultCode)
	}
	if input.LastRunAtUTC != nil {
		t.Fatalf("chưa chạy lần nào ⇒ lastRunAtUtc null: %v", *input.LastRunAtUTC)
	}

	// Khoá phải CÓ MẶT kể cả khi `null` (hợp đồng: mọi trường required).
	raw, err := json.Marshal(itemByID(t, page, "prog-legacy"))
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if value, present := decoded["waitingReason"]; !present || value != nil {
		t.Fatalf("waitingReason phải có mặt với giá trị null: present=%v value=%v", present, value)
	}
}

// Sau khi Core khởi động lại, Program nằm WAITING (chờ VP) trong khi intent là
// Enable. Đó KHÔNG phải lệch intent: replay Enable là lệnh thừa (Core coi là
// idempotent), và ghi FAULTED là nói sai. Intent Disable thì vẫn phải được đẩy.
func TestReconcileTreatsInputWaitingAsRunningIntent(t *testing.T) {
	service, runtime, projectID := openIntentService(t)
	if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_vp", true, "20000000-0000-4000-8000-000000000827")); err != nil {
		t.Fatal(err)
	}
	service.livePrograms = func(context.Context) (map[string]ProgramMetricsView, bool) {
		return map[string]ProgramMetricsView{"P_vp": {InstanceID: "P_vp", State: "WAITING", Enabled: true,
			WaitingReason: stringPointer("INPUT_NOT_READY")}}, true
	}
	before := len(runtime.calls)
	for round := 0; round < 3; round++ {
		replayed, err := service.ReconcileOnce(context.Background())
		if err != nil || replayed != 0 {
			t.Fatalf("round %d: replayed=%d err=%v", round, replayed, err)
		}
	}
	if len(runtime.calls) != before {
		t.Fatalf("WAITING + intent Enable không được replay: %d lệnh", len(runtime.calls)-before)
	}
	if got := intentStateOf(t, service, projectID, "P_vp"); got == "FAULTED" {
		t.Fatal("Program đang chờ đầu vào bị ghi FAULTED")
	}

	// Intent Disable với Program WAITING: vẫn là lệch thật, phải đẩy xuống.
	if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_vp", false, "20000000-0000-4000-8000-000000000828")); err != nil {
		t.Fatal(err)
	}
	before = len(runtime.calls)
	if replayed, err := service.ReconcileOnce(context.Background()); err != nil || replayed != 1 {
		t.Fatalf("intent Disable trên WAITING phải replay đúng 1 lần: replayed=%d err=%v", replayed, err)
	}
	if len(runtime.calls) != before+1 || runtime.calls[before].Action != coreipc.ActionSetProgramEnabled {
		t.Fatalf("calls=%d", len(runtime.calls)-before)
	}
}
