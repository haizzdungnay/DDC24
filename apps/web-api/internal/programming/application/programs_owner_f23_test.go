package application

import (
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"mkddc-web/internal/programming/coreipc"
	programmingstore "mkddc-web/internal/programming/store"
)

// F23 (EV-PROG-FBD-ST-MB-20260925): bảng Program của Core không gắn Project.
// Dòng "chỉ Core biết" chỉ thuộc Project SỞ HỮU Revision đang chạy. Trên bo,
// lúc soak lần 3 chạy, trang của Project AHU hiện cả 8 Program `SOAK_*` là
// `RUNNING CORE_LIVE`, và sau khi trả về thì trang của `SOAK-ADR061` hiện
// Program của AHU.

const (
	programsOtherProjectID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee"
	programsOtherDraftID   = "ffffffff-6666-4666-8666-ffffffffffff"
	programsActiveRevision = "abababab-7777-4777-8777-abababababab"
	programsOtherIntentID  = "prog-other-known"
)

// sealProgramsRevision niêm phong một Revision thô cho `programsProjectID`, để
// STATUS giả của Core có một Active mà DB Web phân giải được về Project chủ.
func sealProgramsRevision(t *testing.T, store *programmingstore.Store, revisionID string) {
	t.Helper()
	if _, err := store.CreateRevision(context.Background(), programmingstore.CreateRevisionParams{
		RevisionID: revisionID, ProjectID: programsProjectID, DraftID: programsDraftID,
		ExpectedDraftETag: 1, ManifestJSON: []byte(`{"schemaVersion":1}`),
		Objects: []programmingstore.RevisionObjectInput{{
			ObjectID: "abababab-8888-4888-8888-abababababab", Kind: "PROGRAM",
			PayloadJSON: []byte(`{"language":"ST","source":"X:=1;"}`),
		}},
		ActorID: "admin", Role: "admin", AuditID: "abababab-9999-4999-8999-abababababab",
		CorrelationID: "programs-test-00003", At: programsFixedNow,
		IdempotencyKeySHA256: sha256.Sum256([]byte("programs-revision-key-" + revisionID)),
		RequestSHA256:        sha256.Sum256([]byte("programs-revision-request-" + revisionID)),
	}); err != nil {
		t.Fatalf("CreateRevision: %v", err)
	}
}

// seedOtherProject tạo Project thứ hai có một intent riêng, không có Revision.
func seedOtherProject(t *testing.T, store *programmingstore.Store) {
	t.Helper()
	ctx := context.Background()
	if _, _, err := store.CreateProject(ctx, programmingstore.CreateProjectParams{
		ProjectID: programsOtherProjectID, DraftID: programsOtherDraftID, Name: "SOAK-ADR061",
		ContentJSON: []byte(`{"schemaVersion":1}`), ActorID: "admin", Role: "admin",
		AuditID: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee", CorrelationID: "programs-test-00004",
		At: programsFixedNow, IdempotencyKeySHA256: sha256.Sum256([]byte("programs-other-project-key")),
		RequestSHA256: sha256.Sum256([]byte("programs-other-project-request")),
	}); err != nil {
		t.Fatalf("CreateProject (other): %v", err)
	}
	if _, err := store.SetProgramEnableIntent(ctx, programmingstore.ProgramIntentIdentity{
		ProjectID: programsOtherProjectID, ActorID: "admin", Role: "admin",
		AuditID: "eeeeeeee-2222-4222-8222-eeeeeeeeeeee", CorrelationID: "programs-test-00005",
		At: programsFixedNow, IdempotencyKeySHA256: sha256.Sum256([]byte("programs-other-intent-key")),
		RequestSHA256: sha256.Sum256([]byte("programs-other-intent-request")),
	}, programsOtherIntentID, false); err != nil {
		t.Fatalf("SetProgramEnableIntent (other): %v", err)
	}
}

func newProgramsServiceWithStatus(t *testing.T, store *programmingstore.Store, monitor MonitorSnapshotProvider,
	status *fakeRuntimeStatusReader) *RuntimeService {
	t.Helper()
	service, err := NewRuntimeService(RuntimeServiceOptions{
		Runtime: status, Store: store, Monitor: monitor, ControllerID: "controller-local",
		Now: func() time.Time { return programsFixedNow },
	})
	if err != nil {
		t.Fatalf("NewRuntimeService: %v", err)
	}
	return service
}

func pageHas(page ProgramsPageView, programID string) bool {
	for _, item := range page.Items {
		if item.ProgramID == programID {
			return true
		}
	}
	return false
}

// TestListProgramsCoreOnlyRowsBelongOnlyToActiveOwner — Project chủ của Active
// vẫn thấy dòng "chỉ Core biết"; Project khác thì không, nhưng dòng intent của
// chính nó vẫn đủ và trang vẫn là `CORE_LIVE` (Core có trả lời).
func TestListProgramsCoreOnlyRowsBelongOnlyToActiveOwner(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store, programsIntentSeed{programID: "prog-known", desiredEnabled: true})
	sealProgramsRevision(t, store, programsActiveRevision)
	seedOtherProject(t, store)
	active := programsActiveRevision
	service := newProgramsServiceWithStatus(t, store, &fakeMonitorProvider{snapshot: liveProgramsSnapshot(
		ProgramMetricsView{InstanceID: "prog-known", State: "RUNNING", Enabled: true, PeriodMS: 1000,
			LastRunMonoNS: 8_900_000_000},
		ProgramMetricsView{InstanceID: "prog-orphan", State: "RUNNING", Enabled: true, PeriodMS: 5000,
			LastRunMonoNS: 8_700_000_000},
	)}, &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: &active})

	owner, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms (chủ): %v", err)
	}
	if !pageHas(owner, "prog-known") || !pageHas(owner, "prog-orphan") || len(owner.Items) != 2 {
		t.Fatalf("Project chủ phải thấy cả dòng intent lẫn dòng chỉ Core biết: %+v", owner.Items)
	}

	other, err := service.ListPrograms(context.Background(), programsOtherProjectID)
	if err != nil {
		t.Fatalf("ListPrograms (Project khác): %v", err)
	}
	if other.RuntimeStateSource != ProgramSourceCoreLive {
		t.Fatalf("Core có trả lời thì trang vẫn là CORE_LIVE, nhận %q", other.RuntimeStateSource)
	}
	if pageHas(other, "prog-known") || pageHas(other, "prog-orphan") {
		t.Fatalf("Project khác KHÔNG được thấy Program của Active: %+v", other.Items)
	}
	if len(other.Items) != 1 || other.Items[0].ProgramID != programsOtherIntentID {
		t.Fatalf("Project khác chỉ còn dòng intent của chính nó: %+v", other.Items)
	}
	item := other.Items[0]
	if item.DesiredEnabled == nil || *item.DesiredEnabled || item.RuntimeStateSource == ProgramSourceCoreLive {
		t.Fatalf("dòng intent của Project khác giữ ý định, không được dán CORE_LIVE: %+v", item)
	}
}

// TestListProgramsCoreOnlyRowsHiddenWhenOwnerUnknown — không phân giải được chủ
// (Core không trả STATUS, chưa có Active, hoặc DB Web không có Revision đó) thì
// không Project nào nhận dòng "chỉ Core biết". Dòng intent vẫn đọc số sống.
func TestListProgramsCoreOnlyRowsHiddenWhenOwnerUnknown(t *testing.T) {
	unknownRevision := "cdcdcdcd-1111-4111-8111-cdcdcdcdcdcd"
	for _, scenario := range []struct {
		name   string
		status *fakeRuntimeStatusReader
	}{
		{"STATUS hỏng", &fakeRuntimeStatusReader{failCall: true}},
		{"chưa có Active", &fakeRuntimeStatusReader{producerMode: "GRAPH_ONLY"}},
		{"Revision lạ với DB Web", &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: &unknownRevision}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			store := openProgramsTestStore(t)
			seedProgramsProject(t, store, programsIntentSeed{programID: "prog-known", desiredEnabled: true})
			service := newProgramsServiceWithStatus(t, store, &fakeMonitorProvider{snapshot: liveProgramsSnapshot(
				ProgramMetricsView{InstanceID: "prog-known", State: "RUNNING", Enabled: true, PeriodMS: 1000,
					LastRunMonoNS: 8_900_000_000},
				ProgramMetricsView{InstanceID: "prog-orphan", State: "RUNNING", Enabled: true, PeriodMS: 5000,
					LastRunMonoNS: 8_700_000_000},
			)}, scenario.status)
			page, err := service.ListPrograms(context.Background(), programsProjectID)
			if err != nil {
				t.Fatalf("ListPrograms: %v", err)
			}
			if pageHas(page, "prog-orphan") {
				t.Fatalf("chủ không xác định thì không được gán dòng chỉ Core biết: %+v", page.Items)
			}
			known := itemByID(t, page, "prog-known")
			if known.RuntimeStateSource != ProgramSourceCoreLive || known.RuntimeState != "RUNNING" {
				t.Fatalf("dòng intent vẫn phải đọc số sống: %+v", known)
			}
		})
	}
}

// TestListProgramsSkipsStatusWhenNoCoreOnlyRows — trang của Project đang chạy
// (mọi Program đều có intent) không được tốn thêm một lần STATUS mỗi lần poll.
func TestListProgramsSkipsStatusWhenNoCoreOnlyRows(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store, programsIntentSeed{programID: "prog-known", desiredEnabled: true})
	status := &countingStatusReader{fakeRuntimeStatusReader: fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"}}
	service, err := NewRuntimeService(RuntimeServiceOptions{
		Runtime: status, Store: store, ControllerID: "controller-local",
		Monitor: &fakeMonitorProvider{snapshot: liveProgramsSnapshot(
			ProgramMetricsView{InstanceID: "prog-known", State: "RUNNING", Enabled: true, PeriodMS: 1000,
				LastRunMonoNS: 8_900_000_000})},
		Now: func() time.Time { return programsFixedNow },
	})
	if err != nil {
		t.Fatalf("NewRuntimeService: %v", err)
	}
	if _, err := service.ListPrograms(context.Background(), programsProjectID); err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	if status.calls != 0 {
		t.Fatalf("không có dòng chỉ Core biết thì không được gọi STATUS, đã gọi %d lần", status.calls)
	}
}

// countingStatusReader đếm số lần web-api hỏi STATUS của Core.
type countingStatusReader struct {
	fakeRuntimeStatusReader
	calls int
}

func (c *countingStatusReader) Call(ctx context.Context, request coreipc.Request) (coreipc.Response, error) {
	c.calls++
	return c.fakeRuntimeStatusReader.Call(ctx, request)
}
