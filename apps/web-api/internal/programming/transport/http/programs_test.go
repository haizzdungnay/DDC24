package programminghttp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	programmingapplication "mkddc-web/internal/programming/application"
	programmingstore "mkddc-web/internal/programming/store"
)

const (
	programsHTTPProjectID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
	programsHTTPDraftID   = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
	programsHTTPPath      = "/api/v1/programming/projects/" + programsHTTPProjectID + "/programs"
)

var programsHTTPNow = time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC)

// stubProgramMonitor đóng vai Core: hoặc trả một bảng Program sống, hoặc im.
type stubProgramMonitor struct {
	snapshot programmingapplication.MonitorTruthSnapshot
	err      error
}

func (s stubProgramMonitor) ReadProgrammingMonitorSnapshot(context.Context) (programmingapplication.MonitorTruthSnapshot, error) {
	return s.snapshot, s.err
}

// newProgramsHTTPService dựng service thật trên store thật. `Options.Now` của
// store và `Now` của service dùng CHUNG một đồng hồ — lệch hai cái này sẽ để TTL
// idempotency chạy theo đồng hồ tường và hỏng muộn.
func newProgramsHTTPService(t *testing.T, monitor programmingapplication.MonitorSnapshotProvider) *programmingapplication.RuntimeService {
	t.Helper()
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(t.TempDir(), "programming.sqlite"),
		Now:  func() time.Time { return programsHTTPNow },
	})
	if err != nil {
		t.Fatalf("OpenProgrammingStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	key := sha256.Sum256([]byte("programs-http-project-key"))
	request := sha256.Sum256([]byte("programs-http-project-request"))
	if _, _, err := store.CreateProject(context.Background(), programmingstore.CreateProjectParams{
		ProjectID: programsHTTPProjectID, DraftID: programsHTTPDraftID, Name: "AHU-01",
		ContentJSON: []byte(`{"schemaVersion":1}`), ActorID: "admin", Role: "admin",
		AuditID: "cccccccc-3333-4333-8333-cccccccccccc", CorrelationID: "programs-http-00001",
		At: programsHTTPNow, IdempotencyKeySHA256: key, RequestSHA256: request,
	}); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	for index, seed := range []struct {
		programID string
		enabled   bool
		lastKnown string
	}{
		{"prog-ahu-supply", true, "RUNNING"},
		{"prog-ahu-return", false, "DISABLED"},
	} {
		intentKey := sha256.Sum256([]byte("programs-http-intent-key-" + seed.programID))
		intentRequest := sha256.Sum256([]byte("programs-http-intent-request-" + seed.programID))
		if _, err := store.SetProgramEnableIntent(context.Background(), programmingstore.ProgramIntentIdentity{
			ProjectID: programsHTTPProjectID, ActorID: "admin", Role: "admin",
			AuditID:       [...]string{"dddddddd-4444-4444-8444-000000000001", "dddddddd-4444-4444-8444-000000000002"}[index],
			CorrelationID: "programs-http-00002", At: programsHTTPNow,
			IdempotencyKeySHA256: intentKey, RequestSHA256: intentRequest,
		}, seed.programID, seed.enabled); err != nil {
			t.Fatalf("SetProgramEnableIntent(%s): %v", seed.programID, err)
		}
		if err := store.RecordProgramRuntimeState(context.Background(), programsHTTPProjectID,
			seed.programID, seed.lastKnown, programsHTTPNow); err != nil {
			t.Fatalf("RecordProgramRuntimeState(%s): %v", seed.programID, err)
		}
	}

	service, err := programmingapplication.NewRuntimeService(programmingapplication.RuntimeServiceOptions{
		Runtime: stubStatusReader{}, Store: store, Monitor: monitor,
		ControllerID: "controller-local", Now: func() time.Time { return programsHTTPNow },
	})
	if err != nil {
		t.Fatalf("NewRuntimeService: %v", err)
	}
	return service
}

// serveProgramsRequest gọi THẲNG handler qua một mux cục bộ của test.
//
// Không đi qua `RegisterProgrammingRoutes`: route `.../programs` hiện vẫn do
// `handleProgramIntentRequest` phục vụ, và việc đổi người phục vụ nằm ở
// `router.go` — file đang có thay đổi chưa commit của phiên khác. Mux cục bộ
// dựng đúng pattern thật nên `r.PathValue("projectId")` được điền y như khi
// chạy trong router thật.
func serveProgramsRequest(t *testing.T, service *programmingapplication.RuntimeService,
	method, path string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/programming/projects/{projectId}/programs",
		func(w http.ResponseWriter, r *http.Request) {
			if !handleProgramsRequest(w, r, "programs-http-000001", service) {
				w.WriteHeader(http.StatusNotFound)
			}
		})
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(method, path, nil))
	return recorder
}

func liveProgramsTruth() programmingapplication.MonitorTruthSnapshot {
	return programmingapplication.MonitorTruthSnapshot{
		ObservedAt: "2026-08-23T10:00:02.500Z", CapturedMonotonicNs: 9_000_000_000,
		Programs: []programmingapplication.ProgramMetricsView{
			{InstanceID: "prog-ahu-supply", State: "RUNNING", Enabled: true, PeriodMS: 1000,
				LastExecNS: 12_000_000, MaxExecNS: 41_500_000, MissedReleaseCount: 3,
				ConsecutiveMissedRelease: 0, LastRunMonoNS: 8_500_000_000, Lane: 0},
			{InstanceID: "prog-ahu-return", State: "DISABLED", Enabled: false, PeriodMS: 5000,
				LastRunMonoNS: 0, Lane: 1},
		},
		Points: []programmingapplication.MonitorPointTruth{},
	}
}

// TestHandleProgramsRequestCoreLive — mốc M2 (a): Core sống ⇒ `CORE_LIVE` kèm số
// đo. Response nguyên văn được in ra làm bằng chứng nghiệm thu.
func TestHandleProgramsRequestCoreLive(t *testing.T) {
	service := newProgramsHTTPService(t, stubProgramMonitor{snapshot: liveProgramsTruth()})
	recorder := serveProgramsRequest(t, service, http.MethodGet, programsHTTPPath)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200, body=%s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get(correlationHeader); got != "programs-http-000001" {
		t.Fatalf("correlation header = %q", got)
	}
	var page programmingapplication.ProgramsPageView
	if err := json.Unmarshal(recorder.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if page.RuntimeStateSource != programmingapplication.ProgramSourceCoreLive {
		t.Fatalf("runtimeStateSource = %q; want CORE_LIVE", page.RuntimeStateSource)
	}
	supply := page.Items[1]
	if supply.ProgramID != "prog-ahu-supply" || supply.RuntimeState != "RUNNING" ||
		supply.Health == nil || *supply.Health != "HEALTHY" || supply.LastRunAgeMS == nil {
		t.Fatalf("dòng đang chạy sai: %+v", supply)
	}
	t.Logf("EVIDENCE M2 (a) Core sống — HTTP %d\n%s", recorder.Code, indentJSON(t, recorder.Body.Bytes()))
}

// TestHandleProgramsRequestCoreSilent — mốc M2 (b): Core im ⇒ `UNKNOWN` +
// `UNAVAILABLE`, và KHÔNG một số đo cũ nào được trả ra như thể đang sống, dù
// store vẫn còn nhớ `RUNNING`/`DISABLED` từ lần đẩy intent gần nhất.
func TestHandleProgramsRequestCoreSilent(t *testing.T) {
	service := newProgramsHTTPService(t, stubProgramMonitor{err: errors.New("core unavailable trong test")})
	recorder := serveProgramsRequest(t, service, http.MethodGet, programsHTTPPath)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200, body=%s", recorder.Code, recorder.Body.String())
	}
	var page programmingapplication.ProgramsPageView
	if err := json.Unmarshal(recorder.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if page.RuntimeStateSource != programmingapplication.ProgramSourceUnavailable ||
		page.ObservedAt != nil || page.ProgramsTruncated != nil {
		t.Fatalf("trang phải UNAVAILABLE và trống mọi mốc: %+v", page)
	}
	for _, item := range page.Items {
		if item.RuntimeState != "UNKNOWN" ||
			item.RuntimeStateSource != programmingapplication.ProgramSourceUnavailable {
			t.Fatalf("%s: %s/%s; want UNKNOWN/UNAVAILABLE",
				item.ProgramID, item.RuntimeState, item.RuntimeStateSource)
		}
		if item.LastExecNS != nil || item.MaxExecNS != nil || item.PeriodMS != nil ||
			item.LastRunAtUTC != nil || item.CoreState != nil {
			t.Fatalf("%s: số đo cũ bị trả ra khi Core im: %+v", item.ProgramID, item)
		}
	}
	t.Logf("EVIDENCE M2 (b) Core im — HTTP %d\n%s", recorder.Code, indentJSON(t, recorder.Body.Bytes()))
}

// TestHandleProgramsRequestIgnoresOtherRoutes — handler chỉ nhận đúng đường dẫn
// và đúng method của mình; mọi thứ khác phải trả về false để chuỗi dispatch đi
// tiếp, không được nuốt route của module khác.
func TestHandleProgramsRequestIgnoresOtherRoutes(t *testing.T) {
	service := newProgramsHTTPService(t, stubProgramMonitor{snapshot: liveProgramsTruth()})
	if recorder := serveProgramsRequest(t, service, http.MethodPost, programsHTTPPath); recorder.Code != http.StatusNotFound {
		t.Fatalf("POST phải đi tiếp chuỗi dispatch, nhận %d", recorder.Code)
	}
}

func indentJSON(t *testing.T, raw []byte) string {
	t.Helper()
	var buffer bytes.Buffer
	if err := json.Indent(&buffer, raw, "", "  "); err != nil {
		t.Fatalf("indent: %v", err)
	}
	return buffer.String()
}

// TestRuntimeRouterReachesProgramsHandler — khoá ĐƯỜNG NỐI, không phải handler.
//
// `handleProgramsRequest` được nối vào cuối `handleRuntimeRequest`
// (`runtime.go`) chứ không vào `router.go`. Lý do và hệ quả đều cần một case
// riêng: `handleProgrammingRequest` gọi `handleRuntimeRequest` TRƯỚC
// `handleProgramIntentRequest`, nên chỉ khi đường nối này còn sống thì
// `GET .../programs` mới đi tới read-back sống thay vì rơi xuống nhánh cũ
// trong `runtime_intent.go` (nhánh đó chỉ trả ý định lưu trong DB, không có
// `runtimeStateSource`). Nếu ai đó gỡ đường nối, các test gọi thẳng
// `handleProgramsRequest` vẫn xanh trong khi endpoint thật đã thoái hoá về
// hành vi cũ — đúng loại hồi quy im lặng mà case này chặn.
func TestRuntimeRouterReachesProgramsHandler(t *testing.T) {
	service := newProgramsHTTPService(t, stubProgramMonitor{snapshot: liveProgramsTruth()})
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/programming/projects/{projectId}/programs",
		func(w http.ResponseWriter, r *http.Request) {
			if !handleRuntimeRequest(w, r, "programs-http-000002", service) {
				w.WriteHeader(http.StatusNotFound)
			}
		})
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, programsHTTPPath, nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("đường nối runtime → programs đứt: mã %d, thân %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		RuntimeStateSource string `json:"runtimeStateSource"`
		Items              []struct {
			ProgramID string `json:"programId"`
		} `json:"items"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("thân phản hồi không phải JSON hợp lệ: %v", err)
	}
	// `runtimeStateSource` là thứ nhánh cũ KHÔNG có, nên nó là dấu hiệu phân
	// biệt chắc chắn giữa đường mới và đường cũ.
	if payload.RuntimeStateSource != "CORE_LIVE" {
		t.Fatalf("runtimeStateSource = %q, muốn CORE_LIVE — request có thể đã rơi xuống nhánh intent cũ",
			payload.RuntimeStateSource)
	}
	if len(payload.Items) != 2 {
		t.Fatalf("số Program = %d, muốn 2", len(payload.Items))
	}
}
