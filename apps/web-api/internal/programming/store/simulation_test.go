package store

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"
)

// Các bất biến ở file này được thi hành bởi SCHEMA, không bởi lớp Go. Test vì
// vậy cố ý đi thẳng qua store: nếu chúng chỉ đúng nhờ một phép kiểm trong Go
// thì một handler khác quên gọi phép kiểm đó sẽ phá được bất biến mà không có
// gì đỏ.

var simulationUUIDCounter int

// UUID v4 hợp lệ và duy nhất trong một test. Store validate hình dạng UUID, nên
// không dùng chuỗi tuỳ ý được.
func simulationUUID(t *testing.T) string {
	t.Helper()
	simulationUUIDCounter++
	return fmt.Sprintf("9%07d-0000-4000-8000-%012d", simulationUUIDCounter, simulationUUIDCounter)
}

func simulationSessionParams(t *testing.T, store *Store, controllerID, label string, at time.Time) CreateSimulationSessionParams {
	t.Helper()
	createProjectFixture(t, store)
	key, request := mutationIdentity("simulation-" + label)
	var content [sha256.Size]byte
	content[0] = 0x11
	return CreateSimulationSessionParams{
		SimulationSession: SimulationSession{
			SessionID:             simulationUUID(t),
			ControllerID:          controllerID,
			ProjectID:             projectID,
			SourceDraftRevisionID: simulationUUID(t),
			SourceContentSHA256:   content,
			IdleExpiresAtUTCMS:    at.UnixMilli() + 900_000,
			HardExpiresAtUTCMS:    at.UnixMilli() + 3_600_000,
			CreatedBy:             actorID,
		},
		ActorID:              actorID,
		Role:                 role,
		AuditID:              simulationUUID(t),
		CorrelationID:        correlationID,
		At:                   at,
		IdempotencyKeySHA256: key,
		RequestSHA256:        request,
		AuditDetailsJSON:     []byte(`{"scope":"simulation"}`),
	}
}

func TestSimulationSessionOneLivePerController(t *testing.T) {
	store := openTestStore(t)
	at := time.Unix(1_800_000_000, 0).UTC()

	first := simulationSessionParams(t, store, "ddc-01", "a", at)
	if _, err := store.CreateSimulationSession(context.Background(), first); err != nil {
		t.Fatalf("phiên đầu phải tạo được: %v", err)
	}

	second := simulationSessionParams(t, store, "ddc-01", "b", at)
	_, err := store.CreateSimulationSession(context.Background(), second)
	if !errors.Is(err, ErrSimulationSessionLive) {
		t.Fatalf("controller đã có phiên sống phải bị từ chối, nhận: %v", err)
	}

	// Controller KHÁC vẫn tạo được: trần là "một phiên mỗi controller", không
	// phải "một phiên mỗi hệ thống".
	other := simulationSessionParams(t, store, "ddc-02", "b", at)
	if _, err := store.CreateSimulationSession(context.Background(), other); err != nil {
		t.Fatalf("controller khác phải tạo được phiên: %v", err)
	}
}

func TestSimulationSessionTerminalFreesTheController(t *testing.T) {
	store := openTestStore(t)
	at := time.Unix(1_800_000_000, 0).UTC()

	first := simulationSessionParams(t, store, "ddc-01", "a", at)
	session, err := store.CreateSimulationSession(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateSimulationSession(context.Background(), UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: 0, State: SimStateStopped,
		Speed: 1, At: at.Add(time.Minute), ActorID: "admin", Role: "admin",
		AuditID: simulationUUID(t), Action: ActionSimulationStop, ResultCode: "STOPPED",
		CorrelationID: "corr-simulation-0002", AuditDetailsJSON: []byte(`{}`),
	}); err != nil {
		t.Fatalf("STOP phải commit được: %v", err)
	}

	next := simulationSessionParams(t, store, "ddc-01", "c", at.Add(2*time.Minute))
	if _, err := store.CreateSimulationSession(context.Background(), next); err != nil {
		t.Fatalf("sau khi phiên cũ terminal, controller phải nhận phiên mới: %v", err)
	}
}

func TestSimulationSessionTerminalIsFinal(t *testing.T) {
	store := openTestStore(t)
	at := time.Unix(1_800_000_000, 0).UTC()
	session, err := store.CreateSimulationSession(context.Background(),
		simulationSessionParams(t, store, "ddc-01", "a", at))
	if err != nil {
		t.Fatal(err)
	}
	stopped, err := store.UpdateSimulationSession(context.Background(), UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: 0, State: SimStateFailed,
		Speed: 1, FailureCode: "SIM-SUP-CRASH", At: at.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	// Hồi sinh một phiên đã terminal là điều DUY NHẤT bị cấm tuyệt đối ở đây:
	// client cũ vẫn giữ ETag của nó, và một phiên sống lại sẽ nhận lệnh cũ.
	_, err = store.UpdateSimulationSession(context.Background(), UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: stopped.SessionSequence,
		State: SimStateRunning, Speed: 1, At: at.Add(2 * time.Minute),
	})
	if err == nil {
		t.Fatal("phiên terminal không được quay lại trạng thái sống")
	}
}

func TestSimulationSessionSequenceGuardsConcurrentCommands(t *testing.T) {
	store := openTestStore(t)
	at := time.Unix(1_800_000_000, 0).UTC()
	session, err := store.CreateSimulationSession(context.Background(),
		simulationSessionParams(t, store, "ddc-01", "a", at))
	if err != nil {
		t.Fatal(err)
	}
	advanced, err := store.UpdateSimulationSession(context.Background(), UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: 0, State: SimStatePaused,
		Speed: 1, VirtualTimeMS: 1000, At: at.Add(time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	if advanced.SessionSequence != 1 {
		t.Fatalf("sequence phải tăng đúng 1, nhận %d", advanced.SessionSequence)
	}
	// Lệnh thứ hai mang sequence CŨ: đây đúng là hình dạng của hai tab cùng bấm
	// Step. Nó phải trượt, và trượt TRƯỚC khi có lệnh nào tới worker.
	_, err = store.UpdateSimulationSession(context.Background(), UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: 0, State: SimStatePaused,
		Speed: 1, VirtualTimeMS: 2000, At: at.Add(2 * time.Second),
	})
	if !errors.Is(err, ErrSimulationSequenceConflict) {
		t.Fatalf("sequence cũ phải bị từ chối, nhận: %v", err)
	}
}

func TestSimulationSessionIdleTTLNeverExceedsHardTTL(t *testing.T) {
	store := openTestStore(t)
	at := time.Unix(1_800_000_000, 0).UTC()
	params := simulationSessionParams(t, store, "ddc-01", "a", at)
	session, err := store.CreateSimulationSession(context.Background(), params)
	if err != nil {
		t.Fatal(err)
	}
	// Làm mới idle TTL vượt quá hard TTL: hard TTL không bao giờ được nới, kể
	// cả cho một phiên đang bận rộn.
	refreshed, err := store.UpdateSimulationSession(context.Background(), UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: 0, State: SimStatePaused, Speed: 1,
		At: at.Add(time.Second), IdleExpiresAtUTCMS: session.HardExpiresAtUTCMS + 600_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.IdleExpiresAtUTCMS != session.HardExpiresAtUTCMS {
		t.Fatalf("idle TTL phải bị kẹp bởi hard TTL: idle=%d hard=%d",
			refreshed.IdleExpiresAtUTCMS, session.HardExpiresAtUTCMS)
	}
}

func TestSimulationSessionExpirySweepClosesOnlyDueSessions(t *testing.T) {
	store := openTestStore(t)
	at := time.Unix(1_800_000_000, 0).UTC()
	session, err := store.CreateSimulationSession(context.Background(),
		simulationSessionParams(t, store, "ddc-01", "a", at))
	if err != nil {
		t.Fatal(err)
	}

	expired, err := store.ExpireSimulationSessions(context.Background(), at.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if len(expired) != 0 {
		t.Fatalf("chưa tới hạn thì không được đóng phiên nào, nhận %v", expired)
	}

	expired, err = store.ExpireSimulationSessions(context.Background(), at.Add(16*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if len(expired) != 1 || expired[0] != session.SessionID {
		t.Fatalf("quá idle TTL phải đóng đúng phiên đó, nhận %v", expired)
	}
	stored, err := store.GetSimulationSession(context.Background(), session.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.State != SimStateExpired || stored.FailureCode != "SIM-SUP-EXPIRED" {
		t.Fatalf("phiên hết hạn phải mang state/failure tường minh: %+v", stored)
	}
}

func TestSimulationSessionRestartReconcileClosesEverythingLive(t *testing.T) {
	store := openTestStore(t)
	at := time.Unix(1_800_000_000, 0).UTC()
	first, err := store.CreateSimulationSession(context.Background(),
		simulationSessionParams(t, store, "ddc-01", "a", at))
	if err != nil {
		t.Fatal(err)
	}
	second := simulationSessionParams(t, store, "ddc-02", "b", at)
	if _, err := store.CreateSimulationSession(context.Background(), second); err != nil {
		t.Fatal(err)
	}

	// `mkddc-web` khởi động lại: không tiến trình worker nào chứng minh được
	// token/protocol của các phiên này nữa, nên tất cả phải thành FAILED. Attach
	// lại theo PID là đúng thứ ADR-053 cấm.
	closed, err := store.TerminateLiveSimulationSessions(context.Background(),
		SimStateFailed, "SIM-SUP-CRASH", at.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if len(closed) != 2 {
		t.Fatalf("phải đóng cả hai phiên đang sống, nhận %v", closed)
	}
	live, err := store.ListLiveSimulationSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(live) != 0 {
		t.Fatalf("sau reconcile không được còn phiên sống nào, nhận %d", len(live))
	}
	stored, err := store.GetSimulationSession(context.Background(), first.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.State != SimStateFailed || stored.FailureCode != "SIM-SUP-CRASH" {
		t.Fatalf("phiên mồ côi phải FAILED có lý do: %+v", stored)
	}
}

func TestSimulationSessionCreateReplayIsRejectedNotDuplicated(t *testing.T) {
	store := openTestStore(t)
	at := time.Unix(1_800_000_000, 0).UTC()
	params := simulationSessionParams(t, store, "ddc-01", "a", at)
	if _, err := store.CreateSimulationSession(context.Background(), params); err != nil {
		t.Fatal(err)
	}
	// Cùng actor + cùng key + cùng request: biên nhận đã tồn tại. Store trả
	// xung đột để lớp application quyết định replay, thay vì lặng lẽ tạo phiên
	// thứ hai — đó chính là cách sinh ra hai worker cho một lần bấm.
	_, err := store.CreateSimulationSession(context.Background(), params)
	if err == nil {
		t.Fatal("replay cùng idempotency key không được tạo phiên thứ hai")
	}
}
