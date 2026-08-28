package application

import (
	"context"
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"mkddc-web/internal/auth"
	programmingartifact "mkddc-web/internal/programming/artifact"
	"mkddc-web/internal/programming/domain"
	"mkddc-web/internal/programming/simworker"
	programmingstore "mkddc-web/internal/programming/store"
)

// Bất biến trung tâm của file này: một lần gọi bị TỪ CHỐI không được để lại dấu
// vết nào. Không phiên trong DB, và trên hết KHÔNG tiến trình worker nào được
// sinh ra. Vì vậy mọi test đều đếm số lần spawn — nếu chỉ kiểm mã lỗi thì một
// bản sửa sau này có thể spawn trước rồi mới từ chối, và test vẫn xanh.

type spawnCounter struct {
	calls atomic.Int64
}

func (s *spawnCounter) spawn(context.Context, simworker.Options) (*simworker.Client, string, string, error) {
	s.calls.Add(1)
	return nil, "", simworker.DetailSpawn, simworker.ErrWorkerUnavailable
}

func newSimulationFixture(t *testing.T, workerBinary string) (*SimulationService, *spawnCounter, *programmingstore.Store) {
	t.Helper()
	directory := t.TempDir()
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(directory, "programming-v1.sqlite"),
		Now:  func() time.Time { return time.Unix(1_800_000_000, 0).UTC() },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	artifacts, err := programmingartifact.NewStore(filepath.Join(directory, "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	counter := &spawnCounter{}
	identifier := 0
	service := NewSimulationService(SimulationOptions{
		Store: store, Artifacts: artifacts, WorkerBinary: workerBinary,
		ControllerID: "ddc-test",
		Now:          func() time.Time { return time.Unix(1_800_000_000, 0).UTC() },
		NewID: func() string {
			identifier++
			return uuidFor(identifier)
		},
		Spawn: counter.spawn,
	})
	return service, counter, store
}

func uuidFor(index int) string {
	return fmt.Sprintf("8%07d-0000-4000-8000-%012d", index, index)
}

// seedProjectForSimulation tạo Project tối thiểu để khoá ngoại của phiên có
// đích. Test này không quan tâm nội dung Draft — nó chỉ cần một Project tồn tại.
func seedProjectForSimulation(t *testing.T, store *programmingstore.Store) {
	t.Helper()
	at := time.Unix(1_800_000_000, 0).UTC()
	if _, _, err := store.CreateProject(context.Background(), programmingstore.CreateProjectParams{
		ProjectID: "11111111-1111-4111-8111-111111111111",
		DraftID:   "22222222-2222-4222-8222-222222222222",
		Name:      "AHU mô phỏng", Description: "fixture",
		ContentJSON: []byte(`{"schemaVersion":1,"programs":[]}`),
		ActorID:     "admin", Role: "admin",
		AuditID: "11111111-1111-4111-8111-111111111112", CorrelationID: "corr-simulation-seed",
		At:                   at,
		IdempotencyKeySHA256: sha256.Sum256([]byte("key-seed")),
		RequestSHA256:        sha256.Sum256([]byte("request-seed")),
	}); err != nil {
		t.Fatal(err)
	}
}

/*
`T59-816` — ranh giới điều khiển mô phỏng phải là MỘT câu trả lời.

Trước lát này có ba bản sao của cùng ranh giới: bảng route khai `program.edit`,
cổng application so chuỗi `"admin"`, và capability trả hằng `["admin"]`. Ba bản
sao đồng ý với nhau chỉ vì chưa có vai nào rơi vào giữa. Vai `engineer`
(`WEB-RBAC-001`) rơi đúng vào giữa: nó CÓ `program.edit`, nên nó qua được router
rồi mới bị application từ chối — bảng route, thứ người ta đọc để biết ai bị
chặn, nói sai.

Bộ này quét TOÀN BỘ `auth.AllRoles()` chứ không phải ba vai chép tay, nên một vai
mới thêm vào mà quên xếp chỗ sẽ đỏ ở đây thay vì lộ ra trên tủ.
*/
func TestSimulationControlBoundaryIsOneAnswerForEveryRole(t *testing.T) {
	service, counter, store := newSimulationFixture(t, "/bin/true")

	allowed := map[string]bool{}
	for _, role := range service.Capability().MutationRoles {
		allowed[role] = true
	}

	for _, role := range auth.AllRoles() {
		name := string(role)
		want := auth.RoleHasPermission(role, auth.PermissionSimulationRun)
		if allowed[name] != want {
			t.Errorf("capability.mutationRoles nói %q=%v; ma trận nói %v", name, allowed[name], want)
		}
		if want {
			// Vai được phép không kiểm ở đây (nó cần fixture đầy đủ); phần
			// happy-path do các test khác của lát R3 phủ.
			continue
		}
		request := SimulationRequest{ActorID: "u1", Role: name, CorrelationID: "corr-simulation-matrix"}
		request.Idempotency = sha256.Sum256([]byte("key-matrix-" + name))
		request.RequestHash = sha256.Sum256([]byte("request-matrix-" + name))
		if _, public := service.CreateSession(context.Background(), request,
			CreateSimulationSessionInput{ProjectID: "p", SourceDraftRevisionID: "r"}); public == nil ||
			public.Code != domain.ErrSimForbidden {
			t.Errorf("vai %q tạo được phiên dù ma trận từ chối: public=%v", name, public)
		}
	}

	if counter.calls.Load() != 0 {
		t.Fatalf("vai không đủ quyền đã làm sinh %d worker", counter.calls.Load())
	}
	live, err := store.ListLiveSimulationSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(live) != 0 {
		t.Fatalf("vai không đủ quyền đã tạo %d phiên trong DB", len(live))
	}
}

func TestSimulationMutationsRequireAdminAndSpawnNothing(t *testing.T) {
	service, counter, store := newSimulationFixture(t, "/bin/true")

	/* `engineer` nằm trong danh sách này một cách CÓ CHỦ Ý: nó có `program.edit`
	   nhưng không có `simulation.run`, nên nó là vai duy nhất mà một mâu thuẫn
	   giữa hai lớp uỷ quyền lộ ra được. */
	for _, role := range []string{"viewer", "operator", "engineer", ""} {
		request := SimulationRequest{ActorID: "u1", Role: role, CorrelationID: "corr-simulation-role"}
		request.Idempotency = sha256.Sum256([]byte("key-" + role))
		request.RequestHash = sha256.Sum256([]byte("request-" + role))

		if _, public := service.CreateSession(context.Background(), request,
			CreateSimulationSessionInput{ProjectID: "p", SourceDraftRevisionID: "r"}); public == nil ||
			public.Code != domain.ErrSimForbidden {
			t.Fatalf("vai %q tạo phiên: public=%v; want PRG-SIM-FORBIDDEN", role, public)
		}
		if _, public := service.Action(context.Background(), request, "s", "RUN", 0); public == nil ||
			public.Code != domain.ErrSimForbidden {
			t.Fatalf("vai %q gọi action: public=%v; want PRG-SIM-FORBIDDEN", role, public)
		}
		if _, public := service.SetInput(context.Background(), request, "s", "o", "REAL", 1.0); public == nil ||
			public.Code != domain.ErrSimForbidden {
			t.Fatalf("vai %q ghi input: public=%v; want PRG-SIM-FORBIDDEN", role, public)
		}
		if _, public := service.StopSession(context.Background(), request, "s"); public == nil ||
			public.Code != domain.ErrSimForbidden {
			t.Fatalf("vai %q dừng phiên: public=%v; want PRG-SIM-FORBIDDEN", role, public)
		}
	}

	if counter.calls.Load() != 0 {
		t.Fatalf("vai không đủ quyền đã làm sinh %d worker", counter.calls.Load())
	}
	live, err := store.ListLiveSimulationSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(live) != 0 {
		t.Fatalf("vai không đủ quyền đã tạo %d phiên trong DB", len(live))
	}
}

func TestSimulationCapabilityOffRejectsBeforeTouchingAnything(t *testing.T) {
	service, counter, store := newSimulationFixture(t, "")

	capability := service.Capability()
	if capability.Supported {
		t.Fatal("thiếu worker binary thì capability phải TẮT")
	}
	// Trần vẫn phải công bố đầy đủ kể cả khi tắt: FE đọc trần từ server chứ
	// không được hardcode một bộ trần riêng.
	if capability.Limits.MaxConcurrentSessionsPerController != 1 ||
		capability.Limits.IdleTTLSeconds != 900 || capability.Limits.HardTTLSeconds != 3600 ||
		capability.Limits.WorkerCommandTimeoutMs != 2000 {
		t.Fatalf("trần công bố sai: %+v", capability.Limits)
	}
	if len(capability.MutationRoles) != 1 || capability.MutationRoles[0] != "admin" {
		t.Fatalf("v1 phải khai mutationRoles = [admin], nhận %v", capability.MutationRoles)
	}

	request := SimulationRequest{ActorID: "admin", Role: "admin", CorrelationID: "corr-simulation-cap"}
	request.Idempotency = sha256.Sum256([]byte("key-cap"))
	request.RequestHash = sha256.Sum256([]byte("request-cap"))
	_, public := service.CreateSession(context.Background(), request,
		CreateSimulationSessionInput{ProjectID: "p", SourceDraftRevisionID: "r"})
	if public == nil || public.Code != domain.ErrSimUnsupported {
		t.Fatalf("capability tắt: public=%v; want PRG-SIM-UNSUPPORTED", public)
	}
	if counter.calls.Load() != 0 {
		t.Fatal("capability tắt mà vẫn sinh worker")
	}
	live, _ := store.ListLiveSimulationSessions(context.Background())
	if len(live) != 0 {
		t.Fatal("capability tắt mà vẫn ghi phiên")
	}
}

func TestSimulationCreateRejectsUnknownRevisionWithoutSpawning(t *testing.T) {
	service, counter, _ := newSimulationFixture(t, "/bin/true")
	request := SimulationRequest{ActorID: "admin", Role: "admin", CorrelationID: "corr-simulation-miss"}
	request.Idempotency = sha256.Sum256([]byte("key-miss"))
	request.RequestHash = sha256.Sum256([]byte("request-miss"))

	_, public := service.CreateSession(context.Background(), request, CreateSimulationSessionInput{
		ProjectID:             "11111111-1111-4111-8111-111111111111",
		SourceDraftRevisionID: "33333333-3333-4333-8333-333333333333",
		SourceContentSHA256:   "00",
	})
	if public == nil || public.Code != domain.ErrNotFound {
		t.Fatalf("Revision không tồn tại: public=%v; want PRG-ERR-NOT-FOUND-001", public)
	}
	if counter.calls.Load() != 0 {
		t.Fatal("Revision không tồn tại mà vẫn sinh worker")
	}
}

func TestSimulationActionEndpointRefusesSetInputAndStop(t *testing.T) {
	service, counter, _ := newSimulationFixture(t, "/bin/true")
	request := SimulationRequest{ActorID: "admin", Role: "admin", CorrelationID: "corr-simulation-act"}

	// `SET_INPUT` và `STOP` có resource riêng. Nhận chúng ở endpoint action nữa
	// sẽ tạo hai đường vào cho cùng một mutation, mỗi đường một kiểu idempotency.
	for _, action := range []string{"SET_INPUT", "STOP", "KHONG_TON_TAI"} {
		_, public := service.Action(context.Background(), request, "s", action, 0)
		if public == nil || public.Code != domain.ErrRequest {
			t.Fatalf("action %q: public=%v; want PRG-ERR-REQ-001", action, public)
		}
	}
	if counter.calls.Load() != 0 {
		t.Fatal("action không hợp lệ mà vẫn sinh worker")
	}
}

func TestSimulationReconcileOnStartClosesOrphansWithoutAttaching(t *testing.T) {
	service, counter, store := newSimulationFixture(t, "/bin/true")

	// Giả lập phiên còn sót từ tiến trình `mkddc-web` trước: có trong DB, nhưng
	// không có worker nào trong tiến trình hiện tại.
	seedProjectForSimulation(t, store)
	var content [sha256.Size]byte
	at := time.Unix(1_800_000_000, 0).UTC()
	if _, err := store.CreateSimulationSession(context.Background(), programmingstore.CreateSimulationSessionParams{
		SimulationSession: programmingstore.SimulationSession{
			SessionID:             "88888888-0000-4000-8000-000000000088",
			ControllerID:          "ddc-test",
			ProjectID:             "11111111-1111-4111-8111-111111111111",
			SourceDraftRevisionID: "33333333-3333-4333-8333-333333333333",
			SourceContentSHA256:   content,
			IdleExpiresAtUTCMS:    at.UnixMilli() + 900_000,
			HardExpiresAtUTCMS:    at.UnixMilli() + 3_600_000,
			CreatedBy:             "admin",
		},
		ActorID: "admin", Role: "admin", AuditID: "88888888-0000-4000-8000-000000000089",
		CorrelationID: "corr-simulation-orphan", At: at,
		IdempotencyKeySHA256: sha256.Sum256([]byte("key-orphan")),
		RequestSHA256:        sha256.Sum256([]byte("request-orphan")),
		AuditDetailsJSON:     []byte(`{}`),
	}); err != nil {
		t.Fatal(err)
	}

	closed, err := service.ReconcileOnStart(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if closed != 1 {
		t.Fatalf("phải đóng đúng 1 phiên mồ côi, nhận %d", closed)
	}
	live, _ := store.ListLiveSimulationSessions(context.Background())
	if len(live) != 0 {
		t.Fatalf("sau reconcile không được còn phiên sống, nhận %d", len(live))
	}
	if counter.calls.Load() != 0 {
		t.Fatal("reconcile KHÔNG được attach hay sinh lại worker")
	}
}
