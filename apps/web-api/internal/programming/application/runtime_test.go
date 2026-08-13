package application

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"mkddc-web/internal/programming/coreipc"
	programmingstore "mkddc-web/internal/programming/store"
)

type fakeRuntimeStatusReader struct {
	failCall     bool
	producerMode string
	active       *string
	lkg          *string
}

func (f *fakeRuntimeStatusReader) Call(_ context.Context, request coreipc.Request) (coreipc.Response, error) {
	if f.failCall {
		return coreipc.Response{}, errors.New("core unavailable trong test")
	}
	payload, err := coreipc.EncodePayload(runtimeImpactPayload{
		ProducerMode: f.producerMode, ActiveRevisionID: f.active, LKGRevisionID: f.lkg, ActiveOverrideIDs: []string{},
	})
	if err != nil {
		return coreipc.Response{}, err
	}
	response := coreipc.ResponseFor(request, coreipc.ResultOK, "", "core.programming.ipc", payload)
	return response, nil
}

func newRuntimeService(t *testing.T, reader RuntimeStatusReader) *RuntimeService {
	t.Helper()
	service, err := NewRuntimeService(RuntimeServiceOptions{Runtime: reader, ControllerID: "controller-local"})
	if err != nil {
		t.Fatalf("NewRuntimeService: %v", err)
	}
	return service
}

func TestRuntimeServiceCapabilitiesReadyWhenCoreReachable(t *testing.T) {
	service := newRuntimeService(t, &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"})
	capabilities, err := service.GetCapabilities(context.Background())
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	if capabilities.TargetState != "READY" {
		t.Fatalf("targetState = %q, muốn READY", capabilities.TargetState)
	}
	if capabilities.Profile != "MK-DDC-24-REV-A" || capabilities.SchemaVersion != "1.0" {
		t.Fatalf("profile/schemaVersion sai: %+v", capabilities)
	}
	if capabilities.Limits.ProjectsPerController != 1 || capabilities.Limits.Tasks != 1 {
		t.Fatalf("limits Rev A sai: %+v", capabilities.Limits)
	}
}

func TestRuntimeServiceCapabilitiesUnavailableWhenCoreUnreachable(t *testing.T) {
	service := newRuntimeService(t, &fakeRuntimeStatusReader{failCall: true})
	capabilities, err := service.GetCapabilities(context.Background())
	if err != nil {
		t.Fatalf("GetCapabilities không được trả lỗi HTTP khi Core mất kết nối: %v", err)
	}
	if capabilities.TargetState != "UNAVAILABLE" {
		t.Fatalf("targetState = %q, muốn UNAVAILABLE khi Core mất kết nối", capabilities.TargetState)
	}
}

func TestRuntimeServiceGetRuntimeReflectsCoreState(t *testing.T) {
	active := "11111111-1111-4111-8111-111111111111"
	lkg := "22222222-2222-4222-8222-222222222222"
	service := newRuntimeService(t, &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: &active, lkg: &lkg})
	view, err := service.GetRuntime(context.Background())
	if err != nil {
		t.Fatalf("GetRuntime: %v", err)
	}
	if view.ProducerState != "READY" || view.TaskState != "RUNNING" {
		t.Fatalf("producerState/taskState sai: %+v", view)
	}
	if view.ActiveRevisionID == nil || *view.ActiveRevisionID != active {
		t.Fatalf("activeRevisionId sai: %+v", view.ActiveRevisionID)
	}
	if view.LKGRevisionID == nil || *view.LKGRevisionID != lkg {
		t.Fatalf("lkgRevisionId sai: %+v", view.LKGRevisionID)
	}
	if view.ObservedAt == "" {
		t.Fatalf("observedAt phải luôn có giá trị")
	}
}

// Core mất kết nối phải trả UNAVAILABLE/UNKNOWN thật, không được bịa RUNNING
// hay safeState=true để "trông ổn" (RSK-PROG-010, D-07).
func TestRuntimeServiceGetRuntimeUnavailableWhenCoreUnreachable(t *testing.T) {
	service := newRuntimeService(t, &fakeRuntimeStatusReader{failCall: true})
	view, err := service.GetRuntime(context.Background())
	if err != nil {
		t.Fatalf("GetRuntime không được trả lỗi HTTP khi Core mất kết nối: %v", err)
	}
	if view.ProducerState != "UNAVAILABLE" {
		t.Fatalf("producerState = %q, muốn UNAVAILABLE", view.ProducerState)
	}
	if view.TaskState != "UNKNOWN" {
		t.Fatalf("taskState = %q, muốn UNKNOWN", view.TaskState)
	}
	if view.ActiveRevisionID != nil || view.LKGRevisionID != nil {
		t.Fatalf("không được bịa activeRevisionId/lkgRevisionId khi Core mất kết nối: %+v", view)
	}
}

func TestRuntimeServiceGetRuntimeStoppedWhenGraphOnly(t *testing.T) {
	service := newRuntimeService(t, &fakeRuntimeStatusReader{producerMode: "GRAPH_ONLY"})
	view, err := service.GetRuntime(context.Background())
	if err != nil {
		t.Fatalf("GetRuntime: %v", err)
	}
	if view.TaskState != "STOPPED" {
		t.Fatalf("taskState = %q, muốn STOPPED khi Core còn ở GRAPH_ONLY", view.TaskState)
	}
}

func TestNewRuntimeServiceRejectsMissingDependency(t *testing.T) {
	if _, err := NewRuntimeService(RuntimeServiceOptions{ControllerID: "controller-local"}); err == nil {
		t.Fatalf("thiếu RuntimeStatusReader phải lỗi")
	}
	if _, err := NewRuntimeService(RuntimeServiceOptions{Runtime: &fakeRuntimeStatusReader{}}); err == nil {
		t.Fatalf("thiếu controllerId phải lỗi")
	}
}

func openAuditTestStore(t *testing.T) *programmingstore.Store {
	t.Helper()
	dir := t.TempDir()
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(dir, "programming.sqlite"),
	})
	if err != nil {
		t.Fatalf("OpenProgrammingStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestRuntimeServiceListAuditNewestFirstAndPaginates(t *testing.T) {
	store := openAuditTestStore(t)
	for i := 0; i < 3; i++ {
		_, err := store.CommitAudit(context.Background(), programmingstore.AuditInput{
			AuditID: uuidBytesToString(t, i), ActorID: "actor-1", Role: "admin", Action: "draft.updated",
			TargetType: "project", TargetID: "11111111-1111-4111-8111-111111111111",
			OccurredAtUTCMS: int64(1_700_000_000_000 + i), ResultCode: "OK", CorrelationID: "corr-000000000001",
			DetailsJSON: []byte("{}"),
		})
		if err != nil {
			t.Fatalf("CommitAudit[%d]: %v", i, err)
		}
	}
	service, err := NewRuntimeService(RuntimeServiceOptions{
		Runtime: &fakeRuntimeStatusReader{}, Store: store, ControllerID: "controller-local",
		CursorSecret: []byte("test-secret"),
	})
	if err != nil {
		t.Fatalf("NewRuntimeService: %v", err)
	}
	first, err := service.ListAudit(context.Background(), "", 2)
	if err != nil {
		t.Fatalf("ListAudit page1: %v", err)
	}
	if len(first.Items) != 2 || first.Items[0].Sequence != 3 || first.Items[1].Sequence != 2 {
		t.Fatalf("page1 sai thứ tự newest-first: %+v", first.Items)
	}
	if first.NextCursor == nil {
		t.Fatalf("page1 phải có nextCursor vì còn bản ghi")
	}
	second, err := service.ListAudit(context.Background(), *first.NextCursor, 2)
	if err != nil {
		t.Fatalf("ListAudit page2: %v", err)
	}
	if len(second.Items) != 1 || second.Items[0].Sequence != 1 {
		t.Fatalf("page2 sai: %+v", second.Items)
	}
	if second.NextCursor != nil {
		t.Fatalf("page2 không được còn nextCursor: %+v", second.NextCursor)
	}
}

func TestRuntimeServiceListAuditRejectsTamperedCursor(t *testing.T) {
	store := openAuditTestStore(t)
	service, err := NewRuntimeService(RuntimeServiceOptions{
		Runtime: &fakeRuntimeStatusReader{}, Store: store, ControllerID: "controller-local",
		CursorSecret: []byte("test-secret"),
	})
	if err != nil {
		t.Fatalf("NewRuntimeService: %v", err)
	}
	if _, err := service.ListAudit(context.Background(), "not-a-real-cursor", 10); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("cursor giả phải trả ErrInvalidCursor, got %v", err)
	}
}

func uuidBytesToString(t *testing.T, seed int) string {
	t.Helper()
	return "00000000-0000-4000-8000-00000000000" + string(rune('1'+seed))
}
