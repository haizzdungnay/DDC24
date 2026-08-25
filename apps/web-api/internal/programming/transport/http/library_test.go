package programminghttp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mkddc-web/internal/auth"
	programmingapplication "mkddc-web/internal/programming/application"
	programmingstore "mkddc-web/internal/programming/store"
	webrouter "mkddc-web/internal/router"
)

const libraryTestEntry = "66666666-6666-4666-8666-666666666661"

// roleRecordingAuthorizer thi hành RBAC thật thay vì cho qua tất cả. Test RBAC
// trên một authorizer allow-all chỉ chứng minh handler chạy, không chứng minh
// route được bảo vệ.
type roleRecordingAuthorizer struct {
	actual        auth.Role
	withPrincipal bool
}

func (a *roleRecordingAuthorizer) Require(role auth.Role, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !roleSatisfies(a.actual, role) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":{"code":"PRG-ERR-REQ-001"}}`))
			return
		}
		// Middleware auth thật gắn principal vào context; handler lấy actor từ
		// đó để ghi audit. Test bỏ bước này sẽ chạy trên một actor rỗng và
		// không kiểm được đường audit thật.
		if !a.withPrincipal {
			next(w, r)
			return
		}
		principal := &auth.Principal{Username: "admin-operator", Role: a.actual}
		next(w, r.WithContext(auth.ContextWithPrincipal(r.Context(), principal)))
	})
}

// Actor rỗng (middleware auth chưa chạy) phải cho lỗi REQUEST, không phải 503
// "retryable" — bảo client thử lại một thứ không bao giờ thành công.
func TestLibraryMutationWithoutPrincipalIsRequestError(t *testing.T) {
	mux, projectID, etag := newLibraryTestMuxWithoutPrincipal(t)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, libraryRequest(t, http.MethodPost,
		"/api/v1/programming/projects/"+projectID+"/library/entries", libraryEntryBody("SCALE_LIN"),
		etag, "20000000-0000-4000-8000-0000000000e1"))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status=%d; want 400 body=%s", recorder.Code, recorder.Body.String())
	}
}

func roleSatisfies(actual, required auth.Role) bool {
	rank := map[auth.Role]int{auth.RoleViewer: 1, auth.RoleOperator: 2, auth.RoleAdmin: 3}
	return rank[actual] >= rank[required]
}

func newLibraryTestMux(t *testing.T, actual auth.Role) (http.Handler, string, string) {
	t.Helper()
	return newLibraryTestMuxWith(t, actual, true)
}

func newLibraryTestMuxWithoutPrincipal(t *testing.T) (http.Handler, string, string) {
	t.Helper()
	return newLibraryTestMuxWith(t, auth.RoleAdmin, false)
}

func newLibraryTestMuxWith(t *testing.T, actual auth.Role, withPrincipal bool) (http.Handler, string, string) {
	t.Helper()
	mux, projectID, etag, _ := newLibraryTestMuxWithStore(t, actual, withPrincipal)
	return mux, projectID, etag
}

func newLibraryTestMuxWithStore(t *testing.T, actual auth.Role, withPrincipal bool) (http.Handler, string, string, *programmingstore.Store) {
	t.Helper()
	fixedNow := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(t.TempDir(), "programming-v1.sqlite"),
		Now:  func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	projects, err := programmingapplication.NewProjectService(store, []byte("cursor-secret-t59-202-http"))
	if err != nil {
		t.Fatal(err)
	}
	created, err := projects.CreateProject(context.Background(),
		programmingapplication.Actor{ID: "admin", Role: "admin"},
		programmingapplication.CreateProjectCommand{SchemaVersion: "1.0", Name: "AHU HTTP",
			IdempotencyKey: "10000000-0000-4000-8000-00000000000a", CorrelationID: "t59-202-http-000001"})
	if err != nil {
		t.Fatal(err)
	}
	library, err := programmingapplication.NewLibraryService(store, []byte("cursor-secret-t59-202-http"))
	if err != nil {
		t.Fatal(err)
	}
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true, Services{Library: library, Projects: projects})
	mux, err := webrouter.New(&roleRecordingAuthorizer{actual: actual, withPrincipal: withPrincipal}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	return mux, created.Resource["projectId"].(string), created.ETag, store
}

func libraryEntryBody(name string) string {
	source := "FUNCTION " + name + " : REAL\nVAR_INPUT X : REAL; END_VAR\n" + name + " := X;\nEND_FUNCTION\n"
	return fmt.Sprintf(`{"schemaVersion":"1.0","entryId":%q,"kind":"FUNCTION","name":%q,"language":"ST","source":%q,"interface":{"inputs":[{"name":"X","type":"REAL"}],"returnType":"REAL"}}`,
		libraryTestEntry, name, source)
}

func libraryRequest(t *testing.T, method, path, body, etag, key string) *http.Request {
	t.Helper()
	var request *http.Request
	if body == "" {
		request = httptest.NewRequest(method, path, nil)
	} else {
		request = httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("X-Correlation-ID", "t59-202-http-000002")
	if etag != "" {
		request.Header.Set("If-Match", etag)
	}
	if key != "" {
		request.Header.Set("X-Idempotency-Key", key)
	}
	return request
}

// Admin đi hết vòng đời entry qua HTTP thật: tạo, tìm, xoá.
func TestLibraryRoutesAdminRoundTrip(t *testing.T) {
	mux, projectID, etag := newLibraryTestMux(t, auth.RoleAdmin)

	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, libraryRequest(t, http.MethodPost,
		"/api/v1/programming/projects/"+projectID+"/library/entries", libraryEntryBody("SCALE_LIN"),
		etag, "20000000-0000-4000-8000-0000000000a1"))
	if recorder.Code != http.StatusOK {
		t.Fatalf("upsert status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var mutation mutationResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &mutation); err != nil {
		t.Fatal(err)
	}
	if mutation.ETag == etag || mutation.AuditID == "" {
		t.Fatalf("mutation=%+v", mutation)
	}
	if recorder.Header().Get("ETag") != mutation.ETag {
		t.Fatalf("header ETag=%q body=%q", recorder.Header().Get("ETag"), mutation.ETag)
	}

	search := httptest.NewRecorder()
	mux.ServeHTTP(search, libraryRequest(t, http.MethodGet,
		"/api/v1/programming/libraries?projectId="+projectID+"&scope=PROJECT&q=SCALE", "", "", ""))
	if search.Code != http.StatusOK {
		t.Fatalf("search status=%d body=%s", search.Code, search.Body.String())
	}
	var page libraryPageResponse
	if err := json.Unmarshal(search.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Name != "SCALE_LIN" || page.Items[0].Scope != "PROJECT" {
		t.Fatalf("page=%+v", page)
	}
	if page.Items[0].LibraryState != "DRAFT" || !page.Items[0].StateLayoutKnown {
		t.Fatalf("entry FUNCTION phải là DRAFT có state authoritative: %+v", page.Items[0])
	}

	remove := httptest.NewRecorder()
	mux.ServeHTTP(remove, libraryRequest(t, http.MethodDelete,
		"/api/v1/programming/projects/"+projectID+"/library/entries/"+libraryTestEntry, "",
		mutation.ETag, "20000000-0000-4000-8000-0000000000a2"))
	if remove.Code != http.StatusOK {
		t.Fatalf("delete status=%d body=%s", remove.Code, remove.Body.String())
	}
}

func TestLibraryDeprecateRouteAdminRoundTripAndReadBack(t *testing.T) {
	mux, projectID, etag, store := newLibraryTestMuxWithStore(t, auth.RoleAdmin, true)

	upsertRecorder := httptest.NewRecorder()
	mux.ServeHTTP(upsertRecorder, libraryRequest(t, http.MethodPost,
		"/api/v1/programming/projects/"+projectID+"/library/entries", libraryEntryBody("SCALE_LIN"),
		etag, "20000000-0000-4000-8000-0000000000a3"))
	if upsertRecorder.Code != http.StatusOK {
		t.Fatalf("upsert status=%d body=%s", upsertRecorder.Code, upsertRecorder.Body.String())
	}
	var upsert mutationResponse
	if err := json.Unmarshal(upsertRecorder.Body.Bytes(), &upsert); err != nil {
		t.Fatal(err)
	}
	libraryRevisionID, _ := upsert.Resource["libraryRevisionId"].(string)
	if _, err := store.PublishProjectLibrary(context.Background(), libraryRevisionID); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/programming/projects/" + projectID + "/library/revisions/" + libraryRevisionID + "/deprecate"
	requestBody := `{"schemaVersion":"1.0"}`
	deprecate := httptest.NewRecorder()
	mux.ServeHTTP(deprecate, libraryRequest(t, http.MethodPost, path, requestBody,
		upsert.ETag, "20000000-0000-4000-8000-0000000000a4"))
	if deprecate.Code != http.StatusOK {
		t.Fatalf("deprecate status=%d body=%s", deprecate.Code, deprecate.Body.String())
	}
	var result mutationResponse
	if err := json.Unmarshal(deprecate.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Resource["libraryState"] != programmingstore.LibraryStateDeprecated ||
		result.Resource["libraryRevisionId"] != libraryRevisionID || result.ETag == upsert.ETag || result.AuditID == "" {
		t.Fatalf("deprecate result=%+v", result)
	}
	replay := httptest.NewRecorder()
	mux.ServeHTTP(replay, libraryRequest(t, http.MethodPost, path, requestBody,
		upsert.ETag, "20000000-0000-4000-8000-0000000000a4"))
	if replay.Code != http.StatusOK || replay.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay status=%d header=%q body=%s", replay.Code,
			replay.Header().Get("Idempotency-Replayed"), replay.Body.String())
	}

	search := httptest.NewRecorder()
	mux.ServeHTTP(search, libraryRequest(t, http.MethodGet,
		"/api/v1/programming/libraries?projectId="+projectID+"&scope=PROJECT&q=SCALE_LIN", "", "", ""))
	if search.Code != http.StatusOK {
		t.Fatalf("read-back status=%d body=%s", search.Code, search.Body.String())
	}
	var page libraryPageResponse
	if err := json.Unmarshal(search.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].LibraryRevisionID != libraryRevisionID ||
		page.Items[0].LibraryState != programmingstore.LibraryStateDeprecated {
		t.Fatalf("read-back chưa PUBLISHED->DEPRECATED: %+v", page.Items)
	}
}

// Viewer và operator đọc được, nhưng KHÔNG mutate được. Kiểm bằng authorizer
// thật để chứng minh chính route bị chặn, không phải handler tự từ chối.
func TestLibraryRoutesRBAC(t *testing.T) {
	for _, testCase := range []struct {
		role       auth.Role
		wantSearch int
		wantWrite  int
	}{
		{auth.RoleViewer, http.StatusOK, http.StatusForbidden},
		{auth.RoleOperator, http.StatusOK, http.StatusForbidden},
		{auth.RoleAdmin, http.StatusOK, http.StatusOK},
	} {
		t.Run(string(testCase.role), func(t *testing.T) {
			mux, projectID, etag := newLibraryTestMux(t, testCase.role)

			search := httptest.NewRecorder()
			mux.ServeHTTP(search, libraryRequest(t, http.MethodGet, "/api/v1/programming/libraries?q=TON", "", "", ""))
			if search.Code != testCase.wantSearch {
				t.Fatalf("search status=%d; want %d", search.Code, testCase.wantSearch)
			}
			write := httptest.NewRecorder()
			mux.ServeHTTP(write, libraryRequest(t, http.MethodPost,
				"/api/v1/programming/projects/"+projectID+"/library/entries", libraryEntryBody("SCALE_LIN"),
				etag, "20000000-0000-4000-8000-0000000000b1"))
			if write.Code != testCase.wantWrite {
				t.Fatalf("write status=%d; want %d body=%s", write.Code, testCase.wantWrite, write.Body.String())
			}
			del := httptest.NewRecorder()
			mux.ServeHTTP(del, libraryRequest(t, http.MethodDelete,
				"/api/v1/programming/projects/"+projectID+"/library/entries/"+libraryTestEntry, "",
				etag, "20000000-0000-4000-8000-0000000000b2"))
			if testCase.role != auth.RoleAdmin && del.Code != http.StatusForbidden {
				t.Fatalf("delete status=%d; want 403", del.Code)
			}
		})
	}
}

// Header bắt buộc là contract, không phải khuyến nghị: thiếu chúng thì request
// bị từ chối TRƯỚC khi chạm store, nên không có mutation nào xảy ra.
func TestLibraryMutationRequiresIdempotencyAndIfMatch(t *testing.T) {
	mux, projectID, etag := newLibraryTestMux(t, auth.RoleAdmin)
	path := "/api/v1/programming/projects/" + projectID + "/library/entries"

	for name, request := range map[string]*http.Request{
		"thiếu idempotency": libraryRequest(t, http.MethodPost, path, libraryEntryBody("SCALE_LIN"), etag, ""),
		"thiếu If-Match":    libraryRequest(t, http.MethodPost, path, libraryEntryBody("SCALE_LIN"), "", "20000000-0000-4000-8000-0000000000c1"),
		"thiếu body":        libraryRequest(t, http.MethodPost, path, "", etag, "20000000-0000-4000-8000-0000000000c2"),
	} {
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, request)
		if recorder.Code == http.StatusOK {
			t.Fatalf("%s vẫn được chấp nhận: %s", name, recorder.Body.String())
		}
	}

	// DELETE cũng phải chịu đúng hai header đó — nó cũng là mutation.
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, libraryRequest(t, http.MethodDelete,
		path+"/"+libraryTestEntry, "", "", "20000000-0000-4000-8000-0000000000c3"))
	if recorder.Code == http.StatusOK {
		t.Fatalf("DELETE thiếu If-Match vẫn chạy: %s", recorder.Body.String())
	}

	deprecatePath := "/api/v1/programming/projects/" + projectID +
		"/library/revisions/55555555-5555-4555-8555-555555555551/deprecate"
	for name, testCase := range map[string]struct {
		request *http.Request
		status  int
	}{
		"deprecate thiếu idempotency": {libraryRequest(t, http.MethodPost, deprecatePath,
			`{"schemaVersion":"1.0"}`, etag, ""), http.StatusBadRequest},
		"deprecate thiếu If-Match": {libraryRequest(t, http.MethodPost, deprecatePath,
			`{"schemaVersion":"1.0"}`, "", "20000000-0000-4000-8000-0000000000c4"), http.StatusPreconditionRequired},
		"deprecate thiếu body": {libraryRequest(t, http.MethodPost, deprecatePath,
			"", etag, "20000000-0000-4000-8000-0000000000c5"), http.StatusBadRequest},
	} {
		blocked := httptest.NewRecorder()
		mux.ServeHTTP(blocked, testCase.request)
		if blocked.Code != testCase.status {
			t.Fatalf("%s status=%d want=%d body=%s", name, blocked.Code, testCase.status, blocked.Body.String())
		}
	}

	search := httptest.NewRecorder()
	mux.ServeHTTP(search, libraryRequest(t, http.MethodGet,
		"/api/v1/programming/libraries?projectId="+projectID+"&scope=PROJECT", "", "", ""))
	var page libraryPageResponse
	if err := json.Unmarshal(search.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 0 {
		t.Fatalf("request bị từ chối vẫn tạo entry: %+v", page.Items)
	}
}

// Payload lạ và field thừa bị từ chối; không có đường "bỏ qua field không biết"
// vì đó là cách một client cũ ghi thiếu nửa nội dung mà không ai báo.
func TestLibraryUpsertRejectsUnknownFieldsAndBadScope(t *testing.T) {
	mux, projectID, etag := newLibraryTestMux(t, auth.RoleAdmin)
	path := "/api/v1/programming/projects/" + projectID + "/library/entries"

	unknown := strings.TrimSuffix(libraryEntryBody("SCALE_LIN"), "}") + `,"featureStatus":"AVAILABLE"}`
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, libraryRequest(t, http.MethodPost, path, unknown, etag, "20000000-0000-4000-8000-0000000000d1"))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("field lạ status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	badScope := httptest.NewRecorder()
	mux.ServeHTTP(badScope, libraryRequest(t, http.MethodGet,
		"/api/v1/programming/libraries?scope=EVERYTHING", "", "", ""))
	if badScope.Code != http.StatusBadRequest {
		t.Fatalf("scope lạ status=%d body=%s", badScope.Code, badScope.Body.String())
	}

	badLimit := httptest.NewRecorder()
	mux.ServeHTTP(badLimit, libraryRequest(t, http.MethodGet,
		"/api/v1/programming/libraries?limit=1000", "", "", ""))
	if badLimit.Code != http.StatusBadRequest {
		t.Fatalf("limit vượt trần status=%d body=%s", badLimit.Code, badLimit.Body.String())
	}
}

// Route library KHÔNG được nuốt các route Project khác cũng mang `{projectId}`.
// Bản đầu nhận diện bằng PathValue nên `POST /projects/{id}/draft/revisions` rơi
// vào handler library và trả lỗi request thay vì niêm phong Revision.
func TestLibraryHandlerDoesNotStealOtherProjectRoutes(t *testing.T) {
	mux, projectID, etag := newLibraryTestMux(t, auth.RoleAdmin)
	body := `{"schemaVersion":"1.0","baseRevisionId":"` + projectID + `","label":"Bản 1","comment":"regression"}`
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, libraryRequest(t, http.MethodPost,
		"/api/v1/programming/projects/"+projectID+"/draft/revisions", body,
		etag, "20000000-0000-4000-8000-0000000000f1"))
	// Nội dung baseRevisionId ở đây cố ý sai nên seal sẽ hỏng — điều được khoá là
	// nó hỏng ở LỚP PROJECT (409 ETag/base conflict), chứ không phải bị handler
	// library bắt mất.
	if recorder.Code != http.StatusConflict {
		t.Fatalf("seal đi nhầm handler: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

// F-P59-DELETE-PROGRAM-001 — batch `PATCH .../draft` phải nói RÕ thao tác nào bị
// từ chối.
//
// Một lần bấm "Xóa Program" trên FE gửi 4–5 operation trong MỘT batch, còn API
// trả đúng một mã `PRG-ERR-REQ-001` cho cả mảng. Không có `field`, người vận
// hành (và người debug) không có gì để lần: đúng tình huống đã xảy ra khi
// `setTask.programOrder` mang id của một user FUNCTION và làm hỏng cả lệnh xóa.
func TestSaveDraftBaoDungThaoTacBiTuChoiTrongBatch(t *testing.T) {
	mux, projectID, etag := newLibraryTestMux(t, auth.RoleAdmin)

	// `baseRevisionId` phải đúng bản nền của Draft, nếu không request chết ở
	// lớp validate trước khi chạm tới batch — và test sẽ đo nhầm chỗ.
	readRecorder := httptest.NewRecorder()
	mux.ServeHTTP(readRecorder, libraryRequest(t, http.MethodGet,
		"/api/v1/programming/projects/"+projectID, "", "", ""))
	var project struct {
		DraftRevisionID string `json:"draftRevisionId"`
	}
	if err := json.Unmarshal(readRecorder.Body.Bytes(), &project); err != nil {
		t.Fatalf("đọc project: %v", err)
	}

	body := `{"schemaVersion":"1.0","baseRevisionId":"` + project.DraftRevisionID + `","operations":[` +
		`{"op":"setFunctionalTags","tags":["ahu"]},` +
		`{"op":"removeProgram","programId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}]}`
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, libraryRequest(t, http.MethodPatch,
		"/api/v1/programming/projects/"+projectID+"/draft", body, etag,
		"10000000-0000-4000-8000-0000000000f1"))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, mong đợi 400; body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Error struct {
			Code  string `json:"code"`
			Field string `json:"field"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if response.Error.Code != "PRG-ERR-REQ-001" {
		t.Fatalf("code = %q", response.Error.Code)
	}
	if response.Error.Field != "operations[1].removeProgram" {
		t.Fatalf("field = %q, mong đợi trỏ đúng thao tác thứ hai trong batch", response.Error.Field)
	}
}

// `T59-804` — chữ ký typed công khai. Ba khẳng định: SYSTEM entry phân giải
// được, PROJECT entry hình dạng lạ KHÔNG bị bịa thành chữ ký rỗng, và chữ ký
// thô vẫn đi kèm để consumer cũ không hỏng.
func TestLibrarySignatureIsPublishedOnlyWhenItParses(t *testing.T) {
	canonical := []byte(`{"category":"timer","labelVi":"Trễ bật","labelEn":"On delay",` +
		`"dispatch":"FB_TYPE","polymorphic":false,"allowedTypes":[],"defaultType":"BOOL",` +
		`"typedPortNames":[],"ports":[{"name":"IN","direction":"INPUT","dataType":"BOOL"},` +
		`{"name":"Q","direction":"OUTPUT","dataType":"BOOL"}]}`)
	parsed := parseLibrarySignature(canonical)
	if parsed == nil {
		t.Fatal("chữ ký canonical phải phân giải được")
	}
	if parsed.Dispatch != "FB_TYPE" || len(parsed.Ports) != 2 || parsed.Ports[1].Direction != "OUTPUT" {
		t.Fatalf("chữ ký phân giải sai: %+v", parsed)
	}

	for name, raw := range map[string]string{
		"không phải JSON":  `không-phải-json`,
		"thiếu category":   `{"dispatch":"FB_TYPE","ports":[{"name":"IN","direction":"INPUT","dataType":"BOOL"}]}`,
		"dispatch lạ":      `{"category":"x","dispatch":"MAGIC","ports":[{"name":"IN","direction":"INPUT","dataType":"BOOL"}]}`,
		"cổng thiếu kiểu":  `{"category":"x","dispatch":"FB_TYPE","ports":[{"name":"IN","direction":"INPUT"}]}`,
		"hướng cổng lạ":    `{"category":"x","dispatch":"FB_TYPE","ports":[{"name":"IN","direction":"SIDEWAYS","dataType":"BOOL"}]}`,
		"không có cổng":    `{"category":"x","dispatch":"FB_TYPE","ports":[]}`,
		"kiểu ngoài hồ sơ": `{"category":"x","dispatch":"FB_TYPE","ports":[{"name":"IN","direction":"INPUT","dataType":"STRING"}]}`,
	} {
		if got := parseLibrarySignature([]byte(raw)); got != nil {
			t.Fatalf("%s: phải trả nil thay vì bịa chữ ký: %+v", name, got)
		}
	}

	// Chữ ký thô vẫn có mặt: consumer cũ đọc `interface` không được hỏng vì
	// backend thêm một field mới.
	view := programmingapplication.LibraryEntryView{
		Scope: "SYSTEM", EntryID: "TON", Kind: "FUNCTION_BLOCK", Name: "TON",
		FeatureState: "AVAILABLE", InterfaceJSON: canonical,
	}
	response := toLibraryEntryResponse(view)
	if len(response.Interface) == 0 {
		t.Fatal("chữ ký thô phải đi kèm để consumer cũ không hỏng")
	}
	if response.Signature == nil || response.Signature.Category != "timer" {
		t.Fatalf("chữ ký typed thiếu: %+v", response.Signature)
	}
}
