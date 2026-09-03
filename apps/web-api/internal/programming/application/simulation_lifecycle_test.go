package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingstore "mkddc-web/internal/programming/store"
)

/*
`T59-816` / `PGM02-V22-WP-10-R3` — vòng đời TÀI NGUYÊN của phiên mô phỏng.

Bộ này chạy với TIẾN TRÌNH THẬT, không với `Spawn` giả. Lý do là thứ đang kiểm
chỉ tồn tại ở mức hệ điều hành: một worker bị bỏ quên vẫn ăn RAM và CPU của
chính tủ điều khiển, và một worker đã chết mà chưa `Wait()` vẫn là zombie chiếm
slot trong bảng tiến trình. Một `Spawn` giả đồng ý với mọi thứ supervisor làm,
kể cả khi supervisor quên thu hồi.

Worker ở đây là stub tối giản đúng giao thức `ADR-053` §5 chứ không phải
`mkddc-programming-sim-worker` thật: phần ngữ nghĩa ST của worker thật đã có
cổng riêng (`scripts/verify_programming_sim_worker.py`), còn thứ cần ở đây là
điều khiển được HÀNH VI xấu — treo, chết giữa chừng, không chào tạm biệt.
*/

const stubWorkerSource = `#!/usr/bin/python3
import json, os, sys, time

# Kịch bản hành vi do test chọn qua môi trường: mỗi biến thể tái hiện một cách
# worker có thể hỏng trong thực tế.
BEHAVIOUR = os.environ.get("STUB_BEHAVIOUR") or "normal"
BASE_TICK_MS = int(os.environ.get("STUB_BASE_TICK_MS") or "1000")
# Nhật ký lệnh: bằng chứng cho câu "speed KHÔNG đi tới worker". Không thể kết
# luận điều đó từ kết quả — hai tốc độ cho cùng kết quả vẫn có thể vì worker
# nhận speed rồi tình cờ xử lý giống nhau.
LOG = os.environ.get("STUB_COMMAND_LOG") or ""

# ĐỌC nhị phân toàn bộ: PREPARE gửi artifact thô ngay sau dòng JSON trên cùng
# một ống. Trộn readline() văn bản với đọc buffer làm mất byte vì lớp văn bản
# đọc trước (buffer ahead) — worker thật cũng phải đọc một mạch như thế.
IN = sys.stdin.buffer
OUT = sys.stdout.buffer

def reply(payload):
    OUT.write(json.dumps(payload).encode() + b"\n")
    OUT.flush()

token = os.environ.get("MKDDC_SIM_SESSION_TOKEN", "")
tick = 0
virtual = 0
while True:
    line = IN.readline()
    if not line:
        break
    try:
        request = json.loads(line.decode())
    except Exception:
        break
    command = request.get("cmd")
    command_id = request.get("commandId", "")
    if LOG:
        with open(LOG, "a") as handle:
            keys = sorted(k for k in request.keys() if k not in ("commandId", "token"))
            handle.write(json.dumps([command, keys]) + "\n")
    if command == "HELLO":
        if request.get("token") != token or request.get("protocolVersion") != 1:
            reply({"commandId": command_id, "ok": False, "errorCode": "SIM-E-001"})
            sys.exit(3)
        reply({"commandId": command_id, "ok": True, "workerVersion": "stub-1",
               "protocolVersion": 1})
        continue
    if command == "PREPARE":
        remaining = int(request.get("artifactBytes", 0))
        while remaining > 0:
            chunk = IN.read(remaining)
            if not chunk:
                break
            remaining -= len(chunk)
        reply({"commandId": command_id, "ok": True, "baseTickMs": BASE_TICK_MS,
               "programs": [{"programId": "Fast", "periodMs": 1000, "order": 0}],
               "simulationInputs": [{"observationId": "Fast.Setpoint", "programId": "Fast",
                                     "variable": "Setpoint", "sourceKind": "VAR_INPUT",
                                     "dataType": "REAL", "unit": None, "min": None, "max": None,
                                     "simulationWritable": True}],
               "observations": []})
        continue
    if command == "STEP":
        tick += 1
        virtual += BASE_TICK_MS
        if BEHAVIOUR == "crash-on-second-step" and tick >= 2:
            # Chết KHÔNG chào: supervisor phải phát hiện qua ống đóng chứ không
            # phải chờ hết TTL.
            sys.exit(9)
        reply({"commandId": command_id, "ok": True, "virtualTimeMs": virtual,
               "snapshotSequence": tick, "resetEpoch": 0,
               "observations": [{"observationId": "Fast.Runs", "programId": "Fast",
                                 "variable": "Runs", "kind": "VAR", "dataType": "DINT",
                                 "quality": "GOOD", "value": tick}]})
        continue
    if command == "SET_INPUT":
        reply({"commandId": command_id, "ok": True})
        continue
    if command == "STOP":
        reply({"commandId": command_id, "ok": True, "stopped": True})
        if BEHAVIOUR == "hang-after-goodbye":
            # Chào tạm biệt rồi treo mãi: đúng lớp lỗi mà luật "Stop luôn kèm
            # Kill" tồn tại để chặn.
            while True:
                time.sleep(3600)
        sys.exit(0)
    reply({"commandId": command_id, "ok": False, "errorCode": "SIM-E-004"})
`

func writeStubWorker(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "stub-sim-worker")
	if err := os.WriteFile(path, []byte(stubWorkerSource), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat("/usr/bin/python3"); err != nil {
		t.Skip("cần /usr/bin/python3 cho worker stub")
	}
	return path
}

// processAlive phân biệt "còn sống" với "đã chết nhưng chưa reap". Zombie mới
// là thứ phải chứng minh không còn: `Signal(0)` vẫn thành công với zombie.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	entry, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return false
	}
	fields := strings.Fields(string(entry))
	return len(fields) > 2 && fields[2] != "Z"
}

// simulationScenario dựng đủ đường đi tới một phiên chạy được: Project →
// Revision đã seal → Check PASSED → artifact trên đĩa.
type simulationScenario struct {
	service    *SimulationService
	store      *programmingstore.Store
	projectID  string
	revisionID string
	contentSHA string
	request    SimulationRequest
}

func newSimulationScenario(t *testing.T, behaviour string, extraEnv ...string) *simulationScenario {
	t.Helper()
	binary := writeStubWorker(t)
	directory := t.TempDir()
	at := time.Unix(1_800_000_000, 0).UTC()

	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(directory, "programming-v1.sqlite"),
		Now:  func() time.Time { return at },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	artifacts, err := programmingartifact.NewStore(filepath.Join(directory, "artifacts"))
	if err != nil {
		t.Fatal(err)
	}

	projectID := "11111111-1111-4111-8111-111111111111"
	draftID := "22222222-2222-4222-8222-222222222222"
	if _, _, err := store.CreateProject(context.Background(), programmingstore.CreateProjectParams{
		ProjectID: projectID, DraftID: draftID,
		Name: "AHU mô phỏng", Description: "fixture vòng đời",
		ContentJSON: []byte(`{"schemaVersion":1,"programs":[]}`),
		ActorID:     "admin", Role: "admin",
		AuditID: "11111111-1111-4111-8111-111111111112", CorrelationID: "corr-lifecycle-seed",
		At:                   at,
		IdempotencyKeySHA256: sha256.Sum256([]byte("key-lifecycle-seed")),
		RequestSHA256:        sha256.Sum256([]byte("request-lifecycle-seed")),
	}); err != nil {
		t.Fatal(err)
	}

	revisionID := "33333333-3333-4333-8333-333333333333"
	revision, err := store.CreateRevision(context.Background(), programmingstore.CreateRevisionParams{
		RevisionID: revisionID, ProjectID: projectID, DraftID: draftID,
		ExpectedDraftETag: 1,
		ManifestJSON:      []byte(`{"schemaVersion":1,"programCount":1}`),
		Objects: []programmingstore.RevisionObjectInput{{
			ObjectID: "44444444-4444-4444-8444-444444444444", Kind: "PROGRAM",
			PayloadJSON: []byte(`{"name":"Fast","language":"ST"}`),
		}},
		DocumentSchemaVersion: 2, ProgramCount: 1,
		ActorID: "admin", Role: "admin",
		AuditID: "55555555-5555-4555-8555-555555555555", CorrelationID: "corr-lifecycle-revision",
		At:                   at,
		IdempotencyKeySHA256: sha256.Sum256([]byte("key-lifecycle-revision")),
		RequestSHA256:        sha256.Sum256([]byte("request-lifecycle-revision")),
	})
	if err != nil {
		t.Fatal(err)
	}

	artifactBytes := []byte("artifact-mo-phong-fixture")
	artifactDigest := sha256.Sum256(artifactBytes)
	relative, err := artifacts.Put(artifactDigest, artifactBytes)
	if err != nil {
		t.Fatal(err)
	}

	checkID := "66666666-6666-4666-8666-666666666666"
	if _, err := store.EnqueueCheck(context.Background(), programmingstore.EnqueueCheckParams{
		CheckID: checkID, RevisionID: revisionID, TargetID: "ddc-test",
		InputSHA256: artifactDigest, Profile: "st-v1", CompilerVersion: "test-1",
		ActorID: "admin", Role: "admin",
		AuditID: "77777777-7777-4777-8777-777777777777", CorrelationID: "corr-lifecycle-check",
		At:                   at,
		IdempotencyKeySHA256: sha256.Sum256([]byte("key-lifecycle-check")),
		RequestSHA256:        sha256.Sum256([]byte("request-lifecycle-check")),
	}); err != nil {
		t.Fatal(err)
	}
	claimed, ok, err := store.ClaimCheck(context.Background(), "worker-test", at, time.Minute)
	if err != nil || !ok {
		t.Fatalf("không claim được Check: ok=%v err=%v", ok, err)
	}
	if _, err := store.CompleteCheck(context.Background(), programmingstore.CompleteCheckParams{
		CheckID: claimed.CheckID, LeaseOwner: "worker-test", State: "PASSED",
		ResultJSON: []byte(`{"schemaVersion":1,"diagnostics":[]}`),
		Artifact: &programmingstore.Artifact{
			ArtifactID: "88888888-8888-4888-8888-888888888888", RevisionID: revisionID,
			CheckID: claimed.CheckID, SchemaVersion: 1, Profile: "st-v1", TargetABI: 1,
			CompilerVersion: "test-1", LibraryVersion: "test-1",
			ByteSize: int64(len(artifactBytes)), SHA256: artifactDigest,
			RelativePath: relative, IntegrityMode: "HASH_ONLY",
		},
		AuditID: "99999999-9999-4999-8999-999999999999", At: at,
	}); err != nil {
		t.Fatal(err)
	}

	identifier := 100
	service := NewSimulationService(SimulationOptions{
		Store: store, Artifacts: artifacts, WorkerBinary: binary,
		ControllerID: "ddc-test",
		Now:          func() time.Time { return time.Now().UTC() },
		NewID: func() string {
			identifier++
			return uuidFor(identifier)
		},
		Env: append([]string{"STUB_BEHAVIOUR=" + behaviour}, extraEnv...),
	})

	request := SimulationRequest{ActorID: "admin", Role: "admin", CorrelationID: "corr-lifecycle-000001"}
	request.Idempotency = sha256.Sum256([]byte("key-lifecycle-create"))
	request.RequestHash = sha256.Sum256([]byte("request-lifecycle-create"))

	return &simulationScenario{
		service: service, store: store, projectID: projectID, revisionID: revisionID,
		contentSHA: fmt.Sprintf("%x", revision.ManifestSHA256), request: request,
	}
}

func (s *simulationScenario) create(t *testing.T, label string) SimulationSessionView {
	t.Helper()
	request := s.request
	request.Idempotency = sha256.Sum256([]byte("key-create-" + label))
	request.RequestHash = sha256.Sum256([]byte("request-create-" + label))
	view, public := s.service.CreateSession(context.Background(), request,
		CreateSimulationSessionInput{
			ProjectID: s.projectID, SourceDraftRevisionID: s.revisionID,
			SourceContentSHA256: s.contentSHA,
		})
	if public != nil {
		t.Fatalf("mở phiên thất bại: %s %v", public.Code, public.Args)
	}
	return view
}

func TestSimulationStopReapsTheWorkerEvenWhenItHangsAfterGoodbye(t *testing.T) {
	scenario := newSimulationScenario(t, "hang-after-goodbye")
	view := scenario.create(t, "hang")

	pid := scenario.service.workerPIDForTest(view.SessionID)
	if !processAlive(pid) {
		t.Fatalf("worker %d phải đang sống sau khi mở phiên", pid)
	}

	request := scenario.request
	request.Idempotency = sha256.Sum256([]byte("key-stop"))
	request.RequestHash = sha256.Sum256([]byte("request-stop"))
	if _, public := scenario.service.StopSession(context.Background(), request, view.SessionID); public != nil {
		t.Fatalf("dừng phiên: %s", public.Code)
	}

	// Worker này TRẢ LỜI stop rồi treo. Supervisor không được tin lời chào tạm
	// biệt: nếu nó chỉ gửi STOP rồi buông, tiến trình treo sẽ sống mãi và giữ
	// nguyên slot quota của tủ.
	if processAlive(pid) {
		t.Fatalf("worker %d còn sống sau STOP — supervisor tin lời chào tạm biệt", pid)
	}
}

func TestSimulationStopFreesTheQuotaSlotForTheNextSession(t *testing.T) {
	scenario := newSimulationScenario(t, "normal")
	first := scenario.create(t, "first")
	firstPID := scenario.service.workerPIDForTest(first.SessionID)

	request := scenario.request
	request.Idempotency = sha256.Sum256([]byte("key-stop-quota"))
	request.RequestHash = sha256.Sum256([]byte("request-stop-quota"))
	if _, public := scenario.service.StopSession(context.Background(), request, first.SessionID); public != nil {
		t.Fatalf("dừng phiên: %s", public.Code)
	}
	if processAlive(firstPID) {
		t.Fatalf("worker %d còn sống sau STOP", firstPID)
	}

	// Trần là MỘT phiên/controller. Nếu STOP quên nhả slot thì phiên thứ hai
	// nhận `PRG-SIM-QUOTA` mãi mãi và người dùng phải khởi động lại dịch vụ —
	// đúng kiểu rò rỉ chỉ lộ ra ở lần dùng thứ hai.
	second := scenario.create(t, "second")
	if second.SessionID == first.SessionID {
		t.Fatal("phiên thứ hai trùng ID phiên đã đóng")
	}
	if !processAlive(scenario.service.workerPIDForTest(second.SessionID)) {
		t.Fatal("phiên thứ hai không có worker sống")
	}
}

func TestSimulationSweepExpiredKillsReapsAndClosesTheSession(t *testing.T) {
	scenario := newSimulationScenario(t, "normal")
	view := scenario.create(t, "ttl")
	pid := scenario.service.workerPIDForTest(view.SessionID)

	// Đẩy đồng hồ qua hard TTL. Quét TTL là đường DUY NHẤT dọn một phiên mà
	// người dùng bỏ quên — tab đóng, mạng rớt, trình duyệt tắt.
	future := time.Now().UTC().Add(SimulationHardTTL + time.Minute)
	scenario.service.now = func() time.Time { return future }

	closed, err := scenario.service.SweepExpired(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if closed != 1 {
		t.Fatalf("quét TTL đóng %d phiên; want 1", closed)
	}
	if processAlive(pid) {
		t.Fatalf("worker %d sống sót qua quét TTL — TTL chỉ đổi một dòng trong DB", pid)
	}
	live, err := scenario.store.ListLiveSimulationSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(live) != 0 {
		t.Fatalf("còn %d phiên sống sau quét TTL", len(live))
	}
}

func TestSimulationSessionNeverTouchesActiveOrRetainedState(t *testing.T) {
	scenario := newSimulationScenario(t, "normal")
	before := snapshotControlState(t, scenario.store)

	view := scenario.create(t, "no-mutation")
	request := scenario.request
	request.Idempotency = sha256.Sum256([]byte("key-input"))
	request.RequestHash = sha256.Sum256([]byte("request-input"))
	if _, public := scenario.service.SetInput(context.Background(), request, view.SessionID,
		"Fast.Setpoint", "REAL", 4.5); public != nil {
		t.Fatalf("ghi input ảo: %s", public.Code)
	}
	request.Idempotency = sha256.Sum256([]byte("key-step"))
	request.RequestHash = sha256.Sum256([]byte("request-step"))
	if _, public := scenario.service.Action(context.Background(), request, view.SessionID,
		"STEP_CYCLE", 0); public != nil {
		t.Fatalf("STEP_CYCLE: %s", public.Code)
	}
	request.Idempotency = sha256.Sum256([]byte("key-stop-nomut"))
	request.RequestHash = sha256.Sum256([]byte("request-stop-nomut"))
	if _, public := scenario.service.StopSession(context.Background(), request, view.SessionID); public != nil {
		t.Fatalf("dừng phiên: %s", public.Code)
	}

	after := snapshotControlState(t, scenario.store)
	if before != after {
		t.Fatalf("một phiên mô phỏng đã đổi trạng thái điều khiển:\ntrước: %s\nsau:   %s", before, after)
	}
}

// snapshotControlState chụp trạng thái đường điều khiển THẬT mà mô phỏng không
// được chạm: Active revision của Project, Draft đang sửa, hàng đợi operation và
// bảng runtime intent (nơi enable/RETAIN của Program sống). Active revision đi
// theo hàng đợi `operations`: Commission là đường DUY NHẤT đổi nó, nên một
// operation mới xuất hiện là dấu hiệu đủ.
//
// So bằng MỘT chuỗi thay vì kiểm từng trường: phép so này không quan tâm trường
// nào đổi, chỉ quan tâm CÓ đổi hay không — nên nó không lỗi thời khi mô hình
// dữ liệu mọc thêm trường.
func snapshotControlState(t *testing.T, store *programmingstore.Store) string {
	t.Helper()
	project, err := store.GetProject(context.Background(), "11111111-1111-4111-8111-111111111111")
	if err != nil {
		t.Fatal(err)
	}
	draft, err := store.GetDraft(context.Background(), project.Draft.DraftID)
	if err != nil {
		t.Fatal(err)
	}
	operations, err := store.ListOperations(context.Background(), 0, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	intents, err := store.ListAllProgramRuntimeIntents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	state := map[string]any{
		"project":    project.Project,
		"draft":      draft,
		"operations": operations,
		"intents":    intents,
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func TestSimulationWorkerCrashClosesSessionAndFreesEverything(t *testing.T) {
	scenario := newSimulationScenario(t, "crash-on-second-step")
	view := scenario.create(t, "crash")
	pid := scenario.service.workerPIDForTest(view.SessionID)

	request := scenario.request
	request.Idempotency = sha256.Sum256([]byte("key-step-1"))
	request.RequestHash = sha256.Sum256([]byte("request-step-1"))
	first, public := scenario.service.Action(context.Background(), request, view.SessionID, "STEP_CYCLE", 0)
	if public != nil {
		t.Fatalf("STEP_CYCLE đầu tiên: %s", public.Code)
	}

	// Tick thứ hai làm worker chết KHÔNG chào. Supervisor phải kết luận từ ống
	// đóng, không được treo tới hết TTL và không được để phiên ở trạng thái
	// "đang chạy" trong khi không còn gì chạy.
	request.IfMatch = first.ETag
	request.Idempotency = sha256.Sum256([]byte("key-step-2"))
	request.RequestHash = sha256.Sum256([]byte("request-step-2"))
	_, public = scenario.service.Action(context.Background(), request, view.SessionID, "STEP_CYCLE", 0)
	if public == nil {
		t.Fatal("worker chết giữa chừng mà lệnh vẫn báo thành công")
	}

	if processAlive(pid) {
		t.Fatalf("worker %d còn sót sau khi chết — supervisor không thu hồi", pid)
	}
	live, err := scenario.store.ListLiveSimulationSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(live) != 0 {
		t.Fatalf("phiên vẫn 'sống' sau khi worker chết: %d", len(live))
	}

	// Và slot quota phải được nhả: nếu không, một lần worker chết là tủ mất khả
	// năng mô phỏng cho tới lần khởi động lại dịch vụ tiếp theo.
	next := scenario.create(t, "after-crash")
	if !processAlive(scenario.service.workerPIDForTest(next.SessionID)) {
		t.Fatal("không mở được phiên mới sau khi phiên trước chết")
	}
}

func TestSimulationRefusesRevisionFromAnotherProject(t *testing.T) {
	scenario := newSimulationScenario(t, "normal")

	// Project thứ hai, hợp lệ về mọi mặt trừ một điều: Revision được yêu cầu
	// không thuộc về nó. Đây là hình dạng của một lần đọc chéo Project — người
	// gọi cầm một Revision ID thật và ghép với một Project ID thật.
	otherProject := "aaaaaaaa-1111-4111-8111-111111111111"
	at := time.Unix(1_800_000_000, 0).UTC()
	if _, _, err := scenario.store.CreateProject(context.Background(), programmingstore.CreateProjectParams{
		ProjectID: otherProject, DraftID: "bbbbbbbb-2222-4222-8222-222222222222",
		Name: "Project khác", Description: "corpus cross-project",
		ContentJSON: []byte(`{"schemaVersion":1,"programs":[]}`),
		ActorID:     "admin", Role: "admin",
		AuditID: "cccccccc-3333-4333-8333-333333333333", CorrelationID: "corr-cross-project-01",
		At:                   at,
		IdempotencyKeySHA256: sha256.Sum256([]byte("key-cross-project")),
		RequestSHA256:        sha256.Sum256([]byte("request-cross-project")),
	}); err != nil {
		t.Fatal(err)
	}

	request := scenario.request
	request.Idempotency = sha256.Sum256([]byte("key-cross"))
	request.RequestHash = sha256.Sum256([]byte("request-cross"))
	_, public := scenario.service.CreateSession(context.Background(), request,
		CreateSimulationSessionInput{
			ProjectID: otherProject, SourceDraftRevisionID: scenario.revisionID,
			SourceContentSHA256: scenario.contentSHA,
		})
	if public == nil {
		t.Fatal("mở được phiên với Revision của Project khác")
	}
	if public.Code != "PRG-ERR-SCOPE-001" {
		t.Fatalf("mã lỗi = %s; want PRG-ERR-SCOPE-001", public.Code)
	}

	// Và quan trọng không kém: lần từ chối đó không được để lại tiến trình hay
	// phiên nào. Một lần thử chéo Project không được tốn tài nguyên của tủ.
	live, err := scenario.store.ListLiveSimulationSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(live) != 0 {
		t.Fatalf("lần thử chéo Project để lại %d phiên", len(live))
	}
}

/*
`T59-817` / `VS-PROG-U15` — cùng một chuỗi input cho cùng một kết quả ở 1×, 10×
và 60×.

Đây là nửa mà phép kiểm phát-lại của `verify_programming_sim_worker.py` KHÔNG
với tới được: worker không hề có khái niệm tốc độ, nên chạy nó 100 lần chỉ
chứng minh engine tất định. Câu hỏi còn lại thuộc về supervisor — "tốc độ có
lọt vào phần quyết định kết quả không" — và cách trả lời không phải là so kết
quả (hai tốc độ vẫn có thể trùng kết quả một cách tình cờ) mà là đọc CHÍNH
chuỗi lệnh gửi xuống worker.
*/
func TestSimulationSpeedNeverReachesTheWorkerAndNeverChangesTheResult(t *testing.T) {
	type run struct {
		commands []string
		virtual  int64
		sequence int64
	}

	results := map[int64]run{}
	for _, speed := range []int64{1, 10, 60} {
		logPath := filepath.Join(t.TempDir(), "commands.log")
		scenario := newSimulationScenario(t, "normal",
			"STUB_BASE_TICK_MS=100", "STUB_COMMAND_LOG="+logPath)
		view := scenario.create(t, fmt.Sprintf("speed-%d", speed))

		request := scenario.request
		etag := view.ETag
		act := func(action string, speedArg int64, label string) SimulationSessionView {
			t.Helper()
			request.IfMatch = etag
			request.Idempotency = sha256.Sum256([]byte(label))
			request.RequestHash = sha256.Sum256([]byte("request-" + label))
			next, public := scenario.service.Action(context.Background(), request, view.SessionID,
				action, speedArg)
			if public != nil {
				t.Fatalf("%s: %s", action, public.Code)
			}
			etag = next.ETag
			return next
		}

		act("SET_SPEED", speed, fmt.Sprintf("key-speed-%d", speed))
		act("RUN", 0, fmt.Sprintf("key-run-%d", speed))

		// Chờ đúng số tick, không chờ theo đồng hồ: một máy CI tải nặng sẽ làm
		// phép chờ theo thời gian trả về số tick khác nhau ở mỗi tốc độ, và khi
		// đó phép so kết quả không còn nói về tốc độ nữa.
		deadline := time.Now().Add(20 * time.Second)
		var latest programmingstore.SimulationSession
		for {
			live, err := scenario.store.ListLiveSimulationSessions(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if len(live) == 1 && live[0].ObservationSequence >= 3 {
				latest = live[0]
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("tốc độ %d×: không đủ 3 nhịp trong 20 s", speed)
			}
			time.Sleep(5 * time.Millisecond)
		}

		act("PAUSE", 0, fmt.Sprintf("key-pause-%d", speed))

		raw, err := os.ReadFile(logPath)
		if err != nil {
			t.Fatal(err)
		}
		commands := []string{}
		for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
			if line == "" {
				continue
			}
			commands = append(commands, line)
		}
		/* Chỉ giữ ba lệnh đầu sau PREPARE: vòng chạy tự động vẫn có thể chèn
		   thêm một tick giữa lúc đọc và lúc PAUSE, và số tick thừa đó là chuyện
		   của lịch treo tường chứ không phải của phép so này. */
		if len(commands) > 5 {
			commands = commands[:5]
		}
		results[speed] = run{commands: commands, virtual: latest.VirtualTimeMS,
			sequence: latest.ObservationSequence}
	}

	base := results[1]
	for _, speed := range []int64{10, 60} {
		got := results[speed]
		if strings.Join(got.commands, "|") != strings.Join(base.commands, "|") {
			t.Errorf("tốc độ %d× gửi chuỗi lệnh khác 1×:\n1×:  %v\n%d×: %v",
				speed, base.commands, speed, got.commands)
		}
		/* So TIẾN ĐỘ MỖI NHỊP, không so ảnh chụp thô.
		 *
		 * `ObservationSequence` là bộ đếm CHẠY TỰ DO: vòng chờ ở trên dừng ở
		 * mẫu ĐẦU TIÊN thấy `>= 3`, nên dưới tải nó có thể bỏ qua hẳn nhịp 3 và
		 * quan sát được nhịp 4. So thẳng hai ảnh chụp vì thế là một cuộc đua
		 * theo thiết kế — đã đỏ thật với `virtual=400/300 sequence=4/3`, trong
		 * khi bất biến cần kiểm vẫn nguyên vẹn (100 ms ảo mỗi nhịp ở cả hai).
		 *
		 * Bất biến thật của test này là "tốc độ không tới worker và không đổi
		 * kết quả", tức thời gian ảo trôi trên MỖI NHỊP phải như nhau ở mọi
		 * tốc độ. Nhân chéo thay cho phép chia để không phải lo làm tròn.
		 *
		 * Cùng lối nghĩ mà tác giả đã áp cho chuỗi lệnh (cắt còn 5 vì "vòng
		 * chạy tự động vẫn có thể chèn thêm một tick"); ở đây chỉ là áp nốt cho
		 * hai bộ đếm. */
		if got.sequence < 3 || base.sequence < 3 {
			t.Errorf("tốc độ %d×: chưa đủ 3 nhịp để so (got=%d base=%d)",
				speed, got.sequence, base.sequence)
		} else if got.virtual*base.sequence != base.virtual*got.sequence {
			t.Errorf("tốc độ %d× cho tiến độ MỖI NHỊP khác 1×: virtual=%d/%d sequence=%d/%d",
				speed, got.virtual, base.virtual, got.sequence, base.sequence)
		}
	}

	// Và bằng chứng trực tiếp: KHÔNG lệnh nào mang trường `speed` xuống worker.
	for _, command := range base.commands {
		if strings.Contains(command, "speed") {
			t.Fatalf("lệnh gửi worker mang tốc độ: %s", command)
		}
	}
}
