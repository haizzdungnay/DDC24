package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"mkddc-web/internal/auth"
	programmingartifact "mkddc-web/internal/programming/artifact"
	"mkddc-web/internal/programming/domain"
	"mkddc-web/internal/programming/simworker"
	programmingstore "mkddc-web/internal/programming/store"
)

// Trần v1, pin trong `contracts/programming/pgm02_workspace_v1.json` §limits.
// Chúng nằm ở đây dưới dạng hằng vì server là AUTHORITY của trần — FE đọc chúng
// qua capability chứ không được tự khai một bộ trần riêng.
const (
	SimulationMaxSessionsPerController = 1
	SimulationIdleTTL                  = 900 * time.Second
	SimulationHardTTL                  = 3600 * time.Second
	SimulationMaxActionsPerSecond      = 10
	SimulationMaxTraceSamples          = 10000
	SimulationMaxVirtualInputs         = 256
	SimulationWorkerCommandTimeout     = 2000 * time.Millisecond
	SimulationMaxRSSMiB                = 64
	SimulationMaxCPUPercentOneCore     = 25
)

// SimulationActions là tập hành động sản phẩm. `SET_INPUT` và `STOP` được
// materialize bằng resource riêng (PUT input, DELETE session) để có identity và
// idempotency rõ ràng, nên chúng KHÔNG được nhận qua endpoint action.
var simulationActionEndpointAllowed = map[string]struct{}{
	"RUN": {}, "PAUSE": {}, "STEP_CYCLE": {}, "RESET": {}, "SET_SPEED": {}, "SET_BASE_TICK": {},
}

var simulationSpeeds = map[int64]struct{}{
	1: {}, 2: {}, 3: {}, 5: {}, 10: {}, 20: {}, 60: {},
}

func mapDbSpeed(speed int64) int64 {
	switch {
	case speed >= 40:
		return 60
	case speed >= 6:
		return 10
	default:
		return 1
	}
}

// SimulationOptions gom mọi phụ thuộc bên ngoài. `WorkerBinaryPath` rỗng nghĩa
// là capability TẮT — không có đường nào bật một nửa.
type SimulationOptions struct {
	Store        *programmingstore.Store
	Artifacts    *programmingartifact.Store
	WorkerBinary string
	// TrustedKeyPaths phải trùng tập khoá Core tin. Xem `simworker.Options`.
	TrustedKeyPaths []string
	ControllerID    string
	Now             func() time.Time
	NewID           func() string
	Spawn           func(context.Context, simworker.Options) (*simworker.Client, string, string, error)
	/* Môi trường truyền cho worker. Rỗng là mặc định và là lựa chọn ĐÚNG cho
	   production (`simworker.Spawn` không kế thừa môi trường của `mkddc-web`);
	   trường này tồn tại để bộ kiểm vòng đời chọn được kịch bản hành vi của một
	   worker stub. */
	Env []string
}

// SimulationService là supervisor phiên: RBAC, quota, TTL, audit và vòng đời
// tiến trình. Nó KHÔNG diễn giải ngữ nghĩa ST — đó là việc của worker.
type SimulationService struct {
	store           *programmingstore.Store
	artifacts       *programmingartifact.Store
	workerBinary    string
	trustedKeyPaths []string
	controllerID    string
	now             func() time.Time
	newID           func() string
	spawn           func(context.Context, simworker.Options) (*simworker.Client, string, string, error)
	workerEnv       []string

	mu sync.Mutex
	// Worker sống theo phiên và CHỈ tồn tại trong tiến trình này. Sau khi
	// `mkddc-web` khởi động lại, map rỗng — và đó là lý do mọi phiên chưa
	// terminal phải bị đóng lúc khởi động thay vì attach lại theo PID.
	workers      map[string]*simworker.Client
	manifests    map[string]simworker.Manifest
	actionWindow map[string][]time.Time
	// Vòng chạy tự động của phiên đang RUNNING. Đóng kênh = yêu cầu dừng ở
	// RANH GIỚI giữa hai tick, không phải cắt ngang một tick đang chạy.
	runLoops     map[string]chan struct{}
	activeSpeed  map[string]int64
	activeTickMs map[string]int64
	latestFrames map[string]simworker.Frame
}

func NewSimulationService(options SimulationOptions) *SimulationService {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	spawn := options.Spawn
	if spawn == nil {
		spawn = simworker.Spawn
	}
	controller := options.ControllerID
	if controller == "" {
		controller = "local"
	}
	return &SimulationService{
		store: options.Store, artifacts: options.Artifacts,
		workerBinary: options.WorkerBinary, trustedKeyPaths: options.TrustedKeyPaths,
		controllerID: controller,
		now:          now, newID: options.NewID, spawn: spawn, workerEnv: options.Env,
		workers:      make(map[string]*simworker.Client),
		manifests:    make(map[string]simworker.Manifest),
		actionWindow: make(map[string][]time.Time),
		runLoops:     make(map[string]chan struct{}),
		activeSpeed:  make(map[string]int64),
		activeTickMs: make(map[string]int64),
		latestFrames: make(map[string]simworker.Frame),
	}
}

// SimulationCapability là thứ FE đọc để quyết định hiện hay ẩn SIMULATE. Thiếu
// bất kỳ mảnh nào thì `Supported=false`; không có trạng thái "bật một nửa".
type SimulationCapability struct {
	Supported     bool             `json:"supported"`
	WorkerVersion *string          `json:"workerVersion"`
	MutationRoles []string         `json:"mutationRoles"`
	Limits        SimulationLimits `json:"limits"`
}

type SimulationLimits struct {
	MaxConcurrentSessionsPerController int   `json:"maxConcurrentSessionsPerController"`
	IdleTTLSeconds                     int   `json:"idleTtlSeconds"`
	HardTTLSeconds                     int   `json:"hardTtlSeconds"`
	MaxRSSMiB                          int   `json:"maxRssMiB"`
	MaxCPUPercentOneCore               int   `json:"maxCpuPercentOneCore"`
	MaxActionsPerSecond                int   `json:"maxActionsPerSecond"`
	MaxTraceSamples                    int   `json:"maxTraceSamples"`
	MaxVirtualInputs                   int   `json:"maxVirtualInputs"`
	WorkerCommandTimeoutMs             int64 `json:"workerCommandTimeoutMs"`
}

/*
Danh sách vai được điều khiển mô phỏng, DẪN XUẤT từ ma trận quyền.

FE dùng danh sách này để quyết định hiện thanh điều khiển ở dạng bấm được hay
chỉ-đọc. Trước `T59-816` nó là hằng `[]string{"admin"}` chép tay — một bản sao
thứ ba của cùng một ranh giới, bên cạnh bảng route và cổng application. Bản sao
chép tay là cách FE mọc ra một nút mà server từ chối.
*/
func simulationMutationRoles() []string {
	roles := auth.RolesWithPermission(auth.PermissionSimulationRun)
	names := make([]string, 0, len(roles))
	for _, role := range roles {
		names = append(names, string(role))
	}
	return names
}

func (s *SimulationService) Capability() SimulationCapability {
	capability := SimulationCapability{
		MutationRoles: simulationMutationRoles(),
		Limits: SimulationLimits{
			MaxConcurrentSessionsPerController: SimulationMaxSessionsPerController,
			IdleTTLSeconds:                     int(SimulationIdleTTL / time.Second),
			HardTTLSeconds:                     int(SimulationHardTTL / time.Second),
			MaxRSSMiB:                          SimulationMaxRSSMiB,
			MaxCPUPercentOneCore:               SimulationMaxCPUPercentOneCore,
			MaxActionsPerSecond:                SimulationMaxActionsPerSecond,
			MaxTraceSamples:                    SimulationMaxTraceSamples,
			MaxVirtualInputs:                   SimulationMaxVirtualInputs,
			WorkerCommandTimeoutMs:             SimulationWorkerCommandTimeout.Milliseconds(),
		},
	}
	if s == nil || s.store == nil || s.artifacts == nil || s.workerBinary == "" {
		return capability
	}
	capability.Supported = true
	return capability
}

// SimulationSessionView là read-back công khai của một phiên.
//
// Không có PID, không có đường dẫn, không có token. Chúng không phải danh tính
// công khai và một PID lộ ra sẽ được dùng để kill nhầm tiến trình khác.
type SimulationSessionView struct {
	SessionID             string                      `json:"sessionId"`
	ControllerID          string                      `json:"controllerId"`
	ProjectID             string                      `json:"projectId"`
	SourceDraftRevisionID string                      `json:"sourceDraftRevisionId"`
	SourceContentSHA256   string                      `json:"sourceContentSha256"`
	State                 string                      `json:"state"`
	SessionSequence       string                      `json:"sessionSequence"`
	ETag                  string                      `json:"etag"`
	BaseTickMS            *int64                      `json:"baseTickMs"`
	VirtualTimeMS         string                      `json:"virtualTimeMs"`
	Speed                 int64                       `json:"speed"`
	ObservationSequence   string                      `json:"observationSequence"`
	ResetEpoch            string                      `json:"resetEpoch"`
	CreatedAt             string                      `json:"createdAt"`
	LastActivityAt        string                      `json:"lastActivityAt"`
	IdleExpiresAt         string                      `json:"idleExpiresAt"`
	HardExpiresAt         string                      `json:"hardExpiresAt"`
	FailureCode           *string                     `json:"failureCode"`
	WorkerVersion         *string                     `json:"workerVersion"`
	SimulationInputs      []simworker.InputDescriptor `json:"simulationInputs,omitempty"`
	AuditID               string                      `json:"auditId,omitempty"`
}

func simulationView(session programmingstore.SimulationSession) SimulationSessionView {
	view := SimulationSessionView{
		SessionID: session.SessionID, ControllerID: session.ControllerID,
		ProjectID: session.ProjectID, SourceDraftRevisionID: session.SourceDraftRevisionID,
		SourceContentSHA256: fmt.Sprintf("%x", session.SourceContentSHA256),
		State:               session.State,
		SessionSequence:     fmt.Sprintf("%d", session.SessionSequence),
		ETag:                session.ETag(),
		VirtualTimeMS:       fmt.Sprintf("%d", session.VirtualTimeMS),
		Speed:               session.Speed,
		ObservationSequence: fmt.Sprintf("%d", session.ObservationSequence),
		ResetEpoch:          fmt.Sprintf("%d", session.ResetEpoch),
		CreatedAt:           millisToRFC3339(session.CreatedAtUTCMS),
		LastActivityAt:      millisToRFC3339(session.LastActivityAtUTCMS),
		IdleExpiresAt:       millisToRFC3339(session.IdleExpiresAtUTCMS),
		HardExpiresAt:       millisToRFC3339(session.HardExpiresAtUTCMS),
	}
	if session.BaseTickMS > 0 {
		baseTick := session.BaseTickMS
		view.BaseTickMS = &baseTick
	}
	if session.FailureCode != "" {
		failure := session.FailureCode
		view.FailureCode = &failure
	}
	if session.WorkerVersion != "" {
		version := session.WorkerVersion
		view.WorkerVersion = &version
	}
	return view
}

func millisToRFC3339(value int64) string {
	return time.UnixMilli(value).UTC().Format(time.RFC3339Nano)
}

// SimulationRequest là danh tính của một lần gọi. Role đến từ middleware auth,
// không từ body: một client tự khai vai của mình thì RBAC không còn là RBAC.
type SimulationRequest struct {
	ActorID       string
	Role          string
	CorrelationID string
	Idempotency   [sha256.Size]byte
	RequestHash   [sha256.Size]byte
	IfMatch       string
}

type CreateSimulationSessionInput struct {
	ProjectID             string
	SourceDraftRevisionID string
	SourceContentSHA256   string
}

// requireSimulationControl là cổng RBAC DUY NHẤT của mọi mutation R3.
//
// Nó cố tình đứng trước mọi thứ khác — trước cả khi đọc store — để một vai
// không đủ quyền không tạo ra bất kỳ side effect nào, kể cả một lần đọc có thể
// làm lộ sự tồn tại của phiên.
//
// `T59-816` — trước lát này hàm so chuỗi `"admin"`. Việc thêm vai `engineer`
// (`WEB-RBAC-001`) biến phép so đó thành một mâu thuẫn im lặng: router khai
// `program.edit`, mà engineer CÓ `program.edit`, nên engineer đi qua được lớp
// ngoài rồi mới bị lớp trong từ chối bằng `PRG-SIM-FORBIDDEN`. Hai lớp nói hai
// điều khác nhau về cùng một ranh giới là trạng thái tệ nhất: bảng route —
// thứ người ta đọc để biết hệ thống chặn ai — nói sai.
//
// Nay cả hai lớp hỏi CÙNG một câu hỏi (`simulation.run`), nên chúng không thể
// trôi khỏi nhau nữa. Ranh giới thì KHÔNG đổi: `simulation.run` chỉ admin có,
// đúng như `ADR-053` đặt ra.
func (s *SimulationService) enrichView(view SimulationSessionView) SimulationSessionView {
	s.mu.Lock()
	defer s.mu.Unlock()
	if spd, ok := s.activeSpeed[view.SessionID]; ok {
		view.Speed = spd
	}
	if tick, ok := s.activeTickMs[view.SessionID]; ok {
		view.BaseTickMS = &tick
	}
	return view
}

func (s *SimulationService) getSpeed(sessionID string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	if spd, ok := s.activeSpeed[sessionID]; ok && spd > 0 {
		return spd
	}
	return 1
}

func (s *SimulationService) getTick(sessionID string) (int64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tick, ok := s.activeTickMs[sessionID]
	return tick, ok
}

func (s *SimulationService) requireSimulationControl(role string) *domain.PublicError {
	if auth.RoleHasPermission(auth.Role(strings.ToLower(strings.TrimSpace(role))),
		auth.PermissionSimulationRun) {
		return nil
	}
	public := domain.NewPublicError(domain.ErrSimForbidden)
	public.Args = map[string]any{"requiredPermission": string(auth.PermissionSimulationRun)}
	return &public
}

func (s *SimulationService) requireCapability() *domain.PublicError {
	if s.Capability().Supported {
		return nil
	}
	public := domain.NewPublicError(domain.ErrSimUnsupported)
	return &public
}

// ReconcileOnStart đóng mọi phiên chưa terminal còn sót từ lần chạy trước.
//
// Không attach lại: một tiến trình không chứng minh được token/protocol của
// phiên thì nó không phải worker của phiên đó, dù PID có trùng. Đây cũng là
// điểm khác biệt giữa "khôi phục" và "nhận vơ".
func (s *SimulationService) ReconcileOnStart(ctx context.Context) (int, error) {
	if s == nil || s.store == nil {
		return 0, nil
	}
	closed, err := s.store.TerminateLiveSimulationSessions(ctx,
		programmingstore.SimStateFailed, simworker.DetailCrash, s.now())
	return len(closed), err
}

// SweepExpired đóng phiên quá TTL và kill/reap worker tương ứng.
func (s *SimulationService) SweepExpired(ctx context.Context) (int, error) {
	if s == nil || s.store == nil {
		return 0, nil
	}
	expired, err := s.store.ExpireSimulationSessions(ctx, s.now())
	for _, sessionID := range expired {
		s.releaseWorker(sessionID)
	}
	return len(expired), err
}

func (s *SimulationService) releaseWorker(sessionID string) {
	s.stopRunLoop(sessionID)
	s.mu.Lock()
	client := s.workers[sessionID]
	delete(s.workers, sessionID)
	delete(s.manifests, sessionID)
	delete(s.actionWindow, sessionID)
	s.mu.Unlock()
	if client != nil {
		client.Kill()
	}
}

// stopRunLoop yêu cầu vòng chạy dừng và KHÔNG chờ nó kết thúc.
//
// Không chờ là có chủ ý: vòng chạy có thể đang nằm trong một lệnh `STEP` với
// trần 2 s, và giữ khoá HTTP handler suốt thời gian đó là biến một lệnh dừng
// thành một lần treo. Tick cuối cùng nếu có sẽ bị `AdvanceSimulationRuntime`
// bỏ qua vì phiên không còn ở trạng thái RUNNING.
func (s *SimulationService) stopRunLoop(sessionID string) {
	s.mu.Lock()
	stop, found := s.runLoops[sessionID]
	if found {
		delete(s.runLoops, sessionID)
		delete(s.activeSpeed, sessionID)
		delete(s.activeTickMs, sessionID)
		delete(s.latestFrames, sessionID)
	}
	s.mu.Unlock()
	if found {
		close(stop)
	}
}

// startRunLoop chạy tick tự động cho một phiên RUNNING.
//
// Đây là phần làm `RUN` khác `PAUSE` về HÀNH VI, không chỉ về nhãn. Trước lát
// này `RUN` chỉ đổi một chuỗi trong DB: đồng hồ ảo đứng yên, và giao diện sẽ
// hiện "đang chạy" cho một phiên không chạy gì cả.
//
// Speed CHỈ đổi khoảng chờ giữa hai tick. Không bỏ tick, không đổi ngữ nghĩa
// timer, không đổi thứ tự — nên cùng một chuỗi input cho cùng một kết quả ở
// 1×, 10× và 60×.
func (s *SimulationService) startRunLoop(sessionID string, baseTickMS, speed int64) {
	if customTick, ok := s.getTick(sessionID); ok && customTick > 0 {
		baseTickMS = customTick
	}
	if baseTickMS <= 0 {
		return
	}
	if speed <= 0 {
		speed = 1
	}
	s.stopRunLoop(sessionID)

	stop := make(chan struct{})
	s.mu.Lock()
	s.runLoops[sessionID] = stop
	s.mu.Unlock()

	rawInterval := time.Duration(baseTickMS/speed) * time.Millisecond
	var interval time.Duration
	var stepsPerTick int

	if rawInterval >= 20*time.Millisecond {
		interval = rawInterval
		stepsPerTick = 1
	} else {
		interval = 20 * time.Millisecond
		stepsPerTick = int((int64(20) * speed) / baseTickMS)
		if stepsPerTick < 1 {
			stepsPerTick = 1
		}
		if stepsPerTick > 200 {
			stepsPerTick = 200
		}
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		lastDbSync := time.Now()
		var latestFrame simworker.Frame
		defer func() {
			if latestFrame.VirtualTimeMS > 0 {
				_, _ = s.store.AdvanceSimulationRuntime(context.Background(), sessionID,
					latestFrame.VirtualTimeMS, latestFrame.SnapshotSequence, s.now())
			}
		}()

		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				client, _, found := s.worker(sessionID)
				if !found || client == nil {
					return
				}
				var stepErr error
				ctx, cancel := context.WithTimeout(context.Background(), SimulationWorkerCommandTimeout)
				for i := 0; i < stepsPerTick; i++ {
					latestFrame, stepErr = client.Step(ctx)
					if stepErr != nil {
						break
					}
				}
				cancel()
				if stepErr == nil {
					s.mu.Lock()
					s.latestFrames[sessionID] = latestFrame
					s.mu.Unlock()
				}
				if stepErr != nil {
					// Tick hỏng là hỏng CỦA PHIÊN. Đưa phiên về FAILED rồi thoát;
					// chạy tiếp sau một tick lỗi là tích luỹ trạng thái không ai
					// giải thích được.
					s.failRunningSession(sessionID, simulationDetailOf(stepErr, client))
					return
				}
				if time.Since(lastDbSync) >= time.Second {
					lastDbSync = time.Now()
					if _, err := s.store.AdvanceSimulationRuntime(context.Background(), sessionID,
						latestFrame.VirtualTimeMS, latestFrame.SnapshotSequence, s.now()); err != nil {
						return
					}
				}
			}
		}
	}()
}

// failRunningSession đóng một phiên hỏng giữa lúc đang chạy tự động.
//
// Nó đọc lại sequence hiện tại thay vì dùng giá trị đã cầm: vòng chạy sống song
// song với HTTP handler, và một lệnh của người dùng có thể vừa commit xong.
func (s *SimulationService) failRunningSession(sessionID, detail string) {
	ctx := context.Background()
	session, err := s.store.GetSimulationSession(ctx, sessionID)
	if err != nil || programmingstore.SimStateIsTerminal(session.State) {
		return
	}
	details, _ := json.Marshal(map[string]any{"failure": "run-loop"})
	_, _ = s.store.UpdateSimulationSession(ctx, programmingstore.UpdateSimulationSessionParams{
		SessionID: sessionID, ExpectedSequence: session.SessionSequence,
		State: programmingstore.SimStateFailed, VirtualTimeMS: session.VirtualTimeMS,
		Speed: session.Speed, ObservationSequence: session.ObservationSequence,
		ResetEpoch: session.ResetEpoch, FailureCode: detail, At: s.now(),
		ActorID: session.CreatedBy, Role: "admin", AuditID: s.newID(),
		Action: programmingstore.ActionSimulationAction, ResultCode: detail,
		CorrelationID: "simulation-run-loop", AuditDetailsJSON: details,
	})
	s.releaseWorker(sessionID)
}

func (s *SimulationService) worker(sessionID string) (*simworker.Client, simworker.Manifest, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	client, found := s.workers[sessionID]
	return client, s.manifests[sessionID], found
}

// allowAction thi hành trần tốc độ 10 action/s cho mỗi phiên.
func (s *SimulationService) allowAction(sessionID string, at time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	window := s.actionWindow[sessionID]
	cutoff := at.Add(-time.Second)
	kept := window[:0]
	for _, stamp := range window {
		if stamp.After(cutoff) {
			kept = append(kept, stamp)
		}
	}
	if len(kept) >= SimulationMaxActionsPerSecond {
		s.actionWindow[sessionID] = kept
		return false
	}
	s.actionWindow[sessionID] = append(kept, at)
	return true
}

// CreateSession seal phiên từ một Revision ĐÃ Check và spawn worker.
//
// `ADR-053` §3: worker chỉ nhận artifact bất biến sinh từ Saved Draft snapshot
// đã Check. Vì vậy ở đây KHÔNG có đường biên dịch riêng — dùng lại đúng bytes
// artifact mà pipeline Check production đã sinh ra. Một đường biên dịch thứ hai
// là một bộ ngữ nghĩa thứ hai để trôi khỏi bộ đang chạy trên tủ.
func (s *SimulationService) CreateSession(ctx context.Context, request SimulationRequest,
	input CreateSimulationSessionInput) (SimulationSessionView, *domain.PublicError) {

	if public := s.requireSimulationControl(request.Role); public != nil {
		return SimulationSessionView{}, public
	}
	if public := s.requireCapability(); public != nil {
		return SimulationSessionView{}, public
	}

	revision, err := s.store.GetRevisionHeader(ctx, input.SourceDraftRevisionID)
	if err != nil {
		public := domain.NewPublicError(domain.ErrNotFound)
		return SimulationSessionView{}, &public
	}
	if revision.ProjectID != input.ProjectID {
		public := domain.NewPublicError(domain.ErrScope)
		return SimulationSessionView{}, &public
	}

	// Hash client gửi phải khớp hash canonical của Revision đã lưu. Đây là chỗ
	// duy nhất phân biệt "mô phỏng thứ tôi vừa lưu" với "mô phỏng thứ gì đó".
	declared := strings.ToLower(strings.TrimSpace(input.SourceContentSHA256))
	actual := fmt.Sprintf("%x", revision.ManifestSHA256)
	if declared != actual {
		public := domain.NewPublicError(domain.ErrSimSaveRequired)
		public.Args = map[string]any{"expected": actual, "actual": declared}
		return SimulationSessionView{}, &public
	}

	check, err := s.store.GetPassedCheckForRevision(ctx, input.SourceDraftRevisionID)
	if err != nil || check.Artifact == nil {
		// Chưa Check thì chưa có artifact bất biến nào để chạy. Không tự biên
		// dịch ở đây: cách sửa của người dùng là chạy Check, và nói đúng điều đó
		// tốt hơn là âm thầm dựng một artifact thứ hai.
		public := domain.NewPublicError(domain.ErrSimSaveRequired)
		public.Args = map[string]any{"expected": "PASSED", "actual": "NO_CHECK"}
		return SimulationSessionView{}, &public
	}
	artifactBytes, err := s.artifacts.Read(check.Artifact.RelativePath, check.Artifact.SHA256,
		check.Artifact.ByteSize)
	if err != nil {
		public := domain.NewPublicError(domain.ErrArtifact)
		return SimulationSessionView{}, &public
	}

	at := s.now()
	_, _ = s.SweepExpired(ctx)

	if live, err := s.store.ListLiveSimulationSessions(ctx); err == nil && len(live) > 0 {
		for _, sess := range live {
			if client, _, found := s.worker(sess.SessionID); found && client != nil {
				_ = client.Stop(ctx)
			}
			s.releaseWorker(sess.SessionID)
			stopDetails, _ := json.Marshal(map[string]any{"reason": "replaced_by_new_session"})
			_, _ = s.store.UpdateSimulationSession(ctx, programmingstore.UpdateSimulationSessionParams{
				SessionID: sess.SessionID, ExpectedSequence: sess.SessionSequence,
				State: programmingstore.SimStateStopped, VirtualTimeMS: sess.VirtualTimeMS,
				Speed: sess.Speed, ObservationSequence: sess.ObservationSequence,
				ResetEpoch: sess.ResetEpoch, At: at,
				ActorID: request.ActorID, Role: request.Role, AuditID: s.newID(),
				Action: programmingstore.ActionSimulationStop, ResultCode: "STOPPED",
				CorrelationID: request.CorrelationID, AuditDetailsJSON: stopDetails,
			})
		}
	}

	var contentHash [sha256.Size]byte
	copy(contentHash[:], revision.ManifestSHA256[:])

	sessionID := s.newID()
	auditID := s.newID()
	details, _ := json.Marshal(map[string]any{
		"sourceDraftRevisionId": input.SourceDraftRevisionID,
		"sourceContentSha256":   actual,
		"artifactSha256":        fmt.Sprintf("%x", check.Artifact.SHA256),
	})

	session, err := s.store.CreateSimulationSession(ctx, programmingstore.CreateSimulationSessionParams{
		SimulationSession: programmingstore.SimulationSession{
			SessionID: sessionID, ControllerID: s.controllerID, ProjectID: input.ProjectID,
			SourceDraftRevisionID: input.SourceDraftRevisionID, SourceContentSHA256: contentHash,
			IdleExpiresAtUTCMS: at.Add(SimulationIdleTTL).UTC().UnixMilli(),
			HardExpiresAtUTCMS: at.Add(SimulationHardTTL).UTC().UnixMilli(),
			CreatedBy:          request.ActorID,
		},
		ActorID: request.ActorID, Role: request.Role, AuditID: auditID,
		CorrelationID: request.CorrelationID, At: at,
		IdempotencyKeySHA256: request.Idempotency, RequestSHA256: request.RequestHash,
		AuditDetailsJSON: details,
	})
	if err != nil {
		if errors.Is(err, programmingstore.ErrSimulationSessionLive) {
			public := domain.NewPublicError(domain.ErrSimQuota)
			public.Args = map[string]any{"limit": SimulationMaxSessionsPerController,
				"retryAfterSeconds": 5}
			return SimulationSessionView{}, &public
		}
		if errors.Is(err, programmingstore.ErrIdempotencyConflict) {
			public := domain.NewPublicError(domain.ErrConflict)
			return SimulationSessionView{}, &public
		}
		public := domain.NewPublicError(domain.ErrUnavailable)
		return SimulationSessionView{}, &public
	}

	// Từ đây trở đi mọi lỗi phải KILL worker và đóng phiên: một phiên PREPARING
	// không có worker là một slot quota bị giữ mãi mãi.
	client, workerVersion, detail, err := s.spawn(ctx, simworker.Options{
		BinaryPath: s.workerBinary, CommandTimeout: SimulationWorkerCommandTimeout,
		TrustedKeyPaths: s.trustedKeyPaths, Env: s.workerEnv,
	})
	if err != nil {
		return s.failSession(ctx, request, session, detail, at)
	}

	manifest, err := client.Prepare(ctx, artifactBytes)
	if err != nil {
		client.Kill()
		return s.failSession(ctx, request, session, simulationDetailOf(err, client), at)
	}
	if len(manifest.SimulationInputs) > SimulationMaxVirtualInputs {
		client.Kill()
		return s.failSession(ctx, request, session, simworker.DetailQuota, at)
	}

	s.mu.Lock()
	s.workers[session.SessionID] = client
	s.manifests[session.SessionID] = manifest
	s.mu.Unlock()

	artifactHash := make([]byte, sha256.Size)
	copy(artifactHash, check.Artifact.SHA256[:])
	prepared, err := s.store.UpdateSimulationSession(ctx, programmingstore.UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: session.SessionSequence,
		State: programmingstore.SimStatePaused, VirtualTimeMS: 0, Speed: 1,
		ObservationSequence: 0, ResetEpoch: 0, BaseTickMS: manifest.BaseTickMS,
		SnapshotID: check.CheckID, ArtifactSHA256: artifactHash, WorkerVersion: workerVersion,
		At: at, IdleExpiresAtUTCMS: at.Add(SimulationIdleTTL).UTC().UnixMilli(),
		ActorID: request.ActorID, Role: request.Role, AuditID: s.newID(),
		Action: programmingstore.ActionSimulationCreate, ResultCode: "PREPARED",
		CorrelationID: request.CorrelationID, AuditDetailsJSON: details,
	})
	if err != nil {
		s.releaseWorker(session.SessionID)
		public := domain.NewPublicError(domain.ErrUnavailable)
		return SimulationSessionView{}, &public
	}

	view := simulationView(prepared)
	view.SimulationInputs = manifest.SimulationInputs
	view.AuditID = auditID
	return view, nil
}

// failSession đưa phiên về FAILED kèm lý do và trả public error tương ứng.
func (s *SimulationService) failSession(ctx context.Context, request SimulationRequest,
	session programmingstore.SimulationSession, detail string, at time.Time) (SimulationSessionView, *domain.PublicError) {

	s.releaseWorker(session.SessionID)
	if detail == "" {
		detail = simworker.DetailCrash
	}
	failed, err := s.store.UpdateSimulationSession(ctx, programmingstore.UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: session.SessionSequence,
		State: programmingstore.SimStateFailed, VirtualTimeMS: session.VirtualTimeMS,
		Speed: session.Speed, ObservationSequence: session.ObservationSequence,
		ResetEpoch: session.ResetEpoch, FailureCode: detail, At: at,
		ActorID: request.ActorID, Role: request.Role, AuditID: s.newID(),
		Action: programmingstore.ActionSimulationCreate, ResultCode: detail,
		CorrelationID: request.CorrelationID, AuditDetailsJSON: []byte(`{"failure":"worker"}`),
	})
	public := simulationPublicForDetail(detail)
	if err != nil {
		return SimulationSessionView{}, &public
	}
	view := simulationView(failed)
	return view, &public
}

func simulationDetailOf(err error, client *simworker.Client) string {
	var commandError *simworker.CommandError
	if errors.As(err, &commandError) {
		return commandError.DetailCode
	}
	if client != nil {
		if detail := client.BrokenDetail(); detail != "" {
			return detail
		}
	}
	if errors.Is(err, simworker.ErrTimeout) {
		return simworker.DetailTimeout
	}
	return simworker.DetailCrash
}

// simulationPublicForDetail ánh xạ mã chi tiết sang public code theo ĐÚNG bảng
// trong catalog. Không tự chế ánh xạ tại chỗ: catalog là nguồn duy nhất, và
// generator sẽ đỏ nếu một mã chi tiết mới chưa được ánh xạ.
func simulationPublicForDetail(detail string) domain.PublicError {
	switch detail {
	case "SIM-E-005", "SIM-E-006":
		return domain.NewPublicError(domain.ErrSimInputNotAllowed)
	case "SIM-E-007":
		return domain.NewPublicError(domain.ErrSimStaleSession)
	case "SIM-E-008", simworker.DetailQuota:
		return domain.NewPublicError(domain.ErrSimQuota)
	case simworker.DetailExpired:
		return domain.NewPublicError(domain.ErrSimExpired)
	case simworker.DetailCapability, simworker.DetailHandshake:
		return domain.NewPublicError(domain.ErrSimUnsupported)
	default:
		return domain.NewPublicError(domain.ErrSimWorkerFailed)
	}
}

// GetSession là đường đọc cho MỌI vai có object scope.
func (s *SimulationService) GetSession(ctx context.Context, sessionID string) (SimulationSessionView, *domain.PublicError) {
	if public := s.requireCapability(); public != nil {
		return SimulationSessionView{}, public
	}
	if sessionID == "active" || sessionID == "current" {
		live, err := s.store.ListLiveSimulationSessions(ctx)
		if err != nil || len(live) == 0 {
			public := domain.NewPublicError(domain.ErrNotFound)
			return SimulationSessionView{}, &public
		}
		sessionID = live[0].SessionID
	}
	session, err := s.store.GetSimulationSession(ctx, sessionID)
	if err != nil {
		public := domain.NewPublicError(domain.ErrNotFound)
		return SimulationSessionView{}, &public
	}
	view := simulationView(session)
	if _, manifest, found := s.worker(sessionID); found {
		view.SimulationInputs = manifest.SimulationInputs
	}
	return s.enrichView(view), nil
}

// mutableSession gom mọi tiền điều kiện chung của một mutation trên phiên:
// vai, capability, tồn tại, chưa terminal, chưa hết hạn, `If-Match` khớp và
// còn trong trần tốc độ. Gom lại một chỗ vì bỏ sót một điều kiện ở một handler
// là cách một mutation lọt qua mà không ai thấy.
func (s *SimulationService) mutableSession(ctx context.Context, request SimulationRequest, sessionID string) (
	programmingstore.SimulationSession, *simworker.Client, simworker.Manifest, *domain.PublicError) {

	var empty programmingstore.SimulationSession
	if public := s.requireSimulationControl(request.Role); public != nil {
		return empty, nil, simworker.Manifest{}, public
	}
	if public := s.requireCapability(); public != nil {
		return empty, nil, simworker.Manifest{}, public
	}
	session, err := s.store.GetSimulationSession(ctx, sessionID)
	if err != nil {
		public := domain.NewPublicError(domain.ErrNotFound)
		return empty, nil, simworker.Manifest{}, &public
	}
	if programmingstore.SimStateIsTerminal(session.State) {
		public := domain.NewPublicError(domain.ErrSimExpired)
		if session.State != programmingstore.SimStateExpired {
			public = domain.NewPublicError(domain.ErrSimStaleSession)
		}
		return empty, nil, simworker.Manifest{}, &public
	}
	now := s.now()
	if now.UTC().UnixMilli() >= session.IdleExpiresAtUTCMS ||
		now.UTC().UnixMilli() >= session.HardExpiresAtUTCMS {
		// Hết hạn được phát hiện tại điểm dùng, không chỉ ở vòng quét: một lệnh
		// tới đúng lúc TTL vừa qua không được chạy chỉ vì vòng quét chưa kịp.
		_, _ = s.SweepExpired(ctx)
		public := domain.NewPublicError(domain.ErrSimExpired)
		return empty, nil, simworker.Manifest{}, &public
	}
	if request.IfMatch != "" && request.IfMatch != "*" && request.IfMatch != session.ETag() {
		public := domain.NewPublicError(domain.ErrSimStaleSession)
		public.Args = map[string]any{"expected": session.ETag(), "actual": request.IfMatch}
		return empty, nil, simworker.Manifest{}, &public
	}
	client, manifest, found := s.worker(sessionID)
	if !found || client == nil {
		// Phiên có trong DB nhưng worker không còn trong tiến trình này: đúng
		// hình dạng sau một lần restart chưa reconcile. Không đoán, không attach.
		public := domain.NewPublicError(domain.ErrSimWorkerFailed)
		return empty, nil, simworker.Manifest{}, &public
	}
	if !s.allowAction(sessionID, now) {
		public := domain.NewPublicError(domain.ErrSimQuota)
		public.Args = map[string]any{"limit": SimulationMaxActionsPerSecond, "retryAfterSeconds": 1}
		return empty, nil, simworker.Manifest{}, &public
	}
	return session, client, manifest, nil
}

// Action thực hiện một hành động điều khiển phiên.
func (s *SimulationService) Action(ctx context.Context, request SimulationRequest, sessionID, action string,
	speed int64, baseTickMs ...int64) (SimulationSessionView, *domain.PublicError) {
	var customTick int64
	if len(baseTickMs) > 0 {
		customTick = baseTickMs[0]
	}

	if _, allowed := simulationActionEndpointAllowed[action]; !allowed {
		public := domain.NewPublicError(domain.ErrRequest)
		public.Field = "action"
		return SimulationSessionView{}, &public
	}
	session, client, manifest, public := s.mutableSession(ctx, request, sessionID)
	if public != nil {
		return SimulationSessionView{}, public
	}

	at := s.now()
	next := programmingstore.UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: session.SessionSequence,
		State: session.State, VirtualTimeMS: session.VirtualTimeMS, Speed: session.Speed,
		ObservationSequence: session.ObservationSequence, ResetEpoch: session.ResetEpoch,
		At: at, IdleExpiresAtUTCMS: at.Add(SimulationIdleTTL).UTC().UnixMilli(),
		ActorID: request.ActorID, Role: request.Role, AuditID: s.newID(),
		Action: programmingstore.ActionSimulationAction, ResultCode: action,
		CorrelationID: request.CorrelationID,
	}
	next.AuditDetailsJSON, _ = json.Marshal(map[string]any{"action": action, "speed": speed})

	switch action {
	case "RUN":
		next.State = programmingstore.SimStateRunning
	case "PAUSE":
		// Dừng vòng chạy TRƯỚC khi commit: nếu commit trước, một tick đang bay
		// vẫn có thể ghi tiến độ sau khi màn hình đã báo dừng.
		s.stopRunLoop(session.SessionID)
		next.State = programmingstore.SimStatePaused
	case "SET_SPEED":
		if _, ok := simulationSpeeds[speed]; !ok {
			public := domain.NewPublicError(domain.ErrRequest)
			public.Field = "speed"
			return SimulationSessionView{}, &public
		}
		s.mu.Lock()
		s.activeSpeed[session.SessionID] = speed
		s.mu.Unlock()
		next.Speed = mapDbSpeed(speed)
	case "SET_BASE_TICK":
		if customTick <= 0 {
			customTick = 10
		}
		s.mu.Lock()
		s.activeTickMs[session.SessionID] = customTick
		s.mu.Unlock()
		if session.State == programmingstore.SimStateRunning {
			s.startRunLoop(session.SessionID, customTick, s.getSpeed(session.SessionID))
		}
	case "STEP_CYCLE":
		frame, err := client.Step(ctx)
		if err != nil {
			return s.failSession(ctx, request, session, simulationDetailOf(err, client), at)
		}
		s.mu.Lock()
		s.latestFrames[session.SessionID] = frame
		s.mu.Unlock()
		next.State = programmingstore.SimStatePaused
		next.VirtualTimeMS = frame.VirtualTimeMS
		next.ObservationSequence = frame.SnapshotSequence
		next.ResetEpoch = frame.ResetEpoch
	case "RESET":
		frame, err := client.Reset(ctx)
		if err != nil {
			return s.failSession(ctx, request, session, simulationDetailOf(err, client), at)
		}
		s.mu.Lock()
		s.latestFrames[session.SessionID] = frame
		s.mu.Unlock()
		next.State = programmingstore.SimStatePaused
		next.VirtualTimeMS = frame.VirtualTimeMS
		next.ObservationSequence = frame.SnapshotSequence
		next.ResetEpoch = frame.ResetEpoch
	}

	updated, err := s.store.UpdateSimulationSession(ctx, next)
	if err != nil {
		if errors.Is(err, programmingstore.ErrSimulationSequenceConflict) {
			public := domain.NewPublicError(domain.ErrSimStaleSession)
			return SimulationSessionView{}, &public
		}
		public := domain.NewPublicError(domain.ErrUnavailable)
		return SimulationSessionView{}, &public
	}

	// Vòng chạy được (tái) khởi động SAU khi trạng thái đã commit. Bật trước
	// commit sẽ có tick chạy cho một trạng thái chưa ai xác nhận.
	if updated.State == programmingstore.SimStateRunning {
		s.startRunLoop(updated.SessionID, updated.BaseTickMS, speed)
	}

	view := simulationView(updated)
	view.SimulationInputs = manifest.SimulationInputs
	return s.enrichView(view), nil
}

// SetInput ghi một virtual input đã qua allowlist của manifest.
func (s *SimulationService) SetInput(ctx context.Context, request SimulationRequest,
	sessionID, observationID, dataType string, value any) (SimulationSessionView, *domain.PublicError) {

	session, client, manifest, public := s.mutableSession(ctx, request, sessionID)
	if public != nil {
		return SimulationSessionView{}, public
	}

	// Allowlist được kiểm ở CẢ HAI phía. Supervisor kiểm để một `observationId`
	// lạ không bao giờ tới được worker; worker kiểm lại vì nó không được tin
	// rằng phía gọi luôn đúng.
	var descriptor *simworker.InputDescriptor
	for index := range manifest.SimulationInputs {
		if manifest.SimulationInputs[index].ObservationID == observationID {
			descriptor = &manifest.SimulationInputs[index]
			break
		}
	}
	if descriptor == nil || !descriptor.SimulationWritable {
		failure := domain.NewPublicError(domain.ErrSimInputNotAllowed)
		failure.Args = map[string]any{"observationId": observationID}
		s.auditDenied(ctx, request, session, programmingstore.ActionSimulationSetInput,
			string(domain.ErrSimInputNotAllowed))
		return SimulationSessionView{}, &failure
	}
	if !strings.EqualFold(descriptor.DataType, dataType) {
		failure := domain.NewPublicError(domain.ErrSimInputNotAllowed)
		failure.Args = map[string]any{"observationId": observationID,
			"expected": descriptor.DataType, "actual": dataType}
		s.auditDenied(ctx, request, session, programmingstore.ActionSimulationSetInput,
			string(domain.ErrSimInputNotAllowed))
		return SimulationSessionView{}, &failure
	}

	at := s.now()
	if err := client.SetInput(ctx, observationID, descriptor.DataType, value); err != nil {
		var commandError *simworker.CommandError
		if errors.As(err, &commandError) {
			// Worker từ chối là kết quả hợp lệ: giá trị đã commit trước đó còn
			// nguyên và phiên vẫn chạy. Không được biến nó thành FAILED.
			failure := simulationPublicForDetail(commandError.DetailCode)
			failure.Args = map[string]any{"observationId": observationID}
			s.auditDenied(ctx, request, session, programmingstore.ActionSimulationSetInput,
				commandError.DetailCode)
			return SimulationSessionView{}, &failure
		}
		return s.failSession(ctx, request, session, simulationDetailOf(err, client), at)
	}

	s.mu.Lock()
	delete(s.latestFrames, sessionID)
	s.mu.Unlock()

	details, _ := json.Marshal(map[string]any{"observationId": observationID, "dataType": descriptor.DataType})
	updated, err := s.store.UpdateSimulationSession(ctx, programmingstore.UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: session.SessionSequence,
		State: session.State, VirtualTimeMS: session.VirtualTimeMS, Speed: session.Speed,
		ObservationSequence: session.ObservationSequence, ResetEpoch: session.ResetEpoch,
		At: at, IdleExpiresAtUTCMS: at.Add(SimulationIdleTTL).UTC().UnixMilli(),
		ActorID: request.ActorID, Role: request.Role, AuditID: s.newID(),
		Action: programmingstore.ActionSimulationSetInput, ResultCode: "ACCEPTED",
		CorrelationID: request.CorrelationID, AuditDetailsJSON: details,
	})
	if err != nil {
		if errors.Is(err, programmingstore.ErrSimulationSequenceConflict) {
			public := domain.NewPublicError(domain.ErrSimStaleSession)
			return SimulationSessionView{}, &public
		}
		public := domain.NewPublicError(domain.ErrUnavailable)
		return SimulationSessionView{}, &public
	}
	view := simulationView(updated)
	view.SimulationInputs = manifest.SimulationInputs
	return view, nil
}

// auditDenied ghi lại một lần TỪ CHỐI. Một mutation bị chặn vẫn là một sự kiện
// bảo mật: nếu chỉ audit khi thành công thì không ai thấy được một loạt lần thử
// bị chặn.
func (s *SimulationService) auditDenied(ctx context.Context, request SimulationRequest,
	session programmingstore.SimulationSession, action, resultCode string) {
	details, _ := json.Marshal(map[string]any{"denied": true})
	_, _ = s.store.CommitAudit(ctx, programmingstore.AuditInput{
		AuditID: s.newID(), ActorID: request.ActorID, Role: request.Role, Action: action,
		TargetType: "SIMULATION_SESSION", TargetID: session.SessionID,
		OccurredAtUTCMS: s.now().UTC().UnixMilli(), ResultCode: resultCode,
		CorrelationID: request.CorrelationID, DetailsJSON: details,
	})
}

// Observations trả ảnh chụp hiện tại. Đường đọc, mọi vai có scope đều gọi được.
func (s *SimulationService) Observations(ctx context.Context, sessionID string) (simworker.Frame, *domain.PublicError) {
	if public := s.requireCapability(); public != nil {
		return simworker.Frame{}, public
	}
	s.mu.Lock()
	sessionRunning := false
	if sess, err := s.store.GetSimulationSession(ctx, sessionID); err == nil && sess.State == programmingstore.SimStateRunning {
		sessionRunning = true
	}
	if sessionRunning {
		if frame, ok := s.latestFrames[sessionID]; ok && frame.SnapshotSequence > 0 {
			s.mu.Unlock()
			return frame, nil
		}
	}
	s.mu.Unlock()

	client, _, found := s.worker(sessionID)
	if !found || client == nil {
		public := domain.NewPublicError(domain.ErrSimWorkerFailed)
		return simworker.Frame{}, &public
	}
	frame, err := client.Read(ctx)
	if err != nil {
		public := simulationPublicForDetail(simulationDetailOf(err, client))
		return simworker.Frame{}, &public
	}
	s.mu.Lock()
	s.latestFrames[sessionID] = frame
	s.mu.Unlock()
	return frame, nil
}

// Trace trả một trang mẫu có biên.
func (s *SimulationService) Trace(ctx context.Context, sessionID string, cursor, limit int64) (simworker.TracePage, *domain.PublicError) {
	if public := s.requireCapability(); public != nil {
		return simworker.TracePage{}, public
	}
	client, _, found := s.worker(sessionID)
	if !found || client == nil {
		public := domain.NewPublicError(domain.ErrSimWorkerFailed)
		return simworker.TracePage{}, &public
	}
	page, err := client.Trace(ctx, cursor, limit)
	if err != nil {
		public := simulationPublicForDetail(simulationDetailOf(err, client))
		return simworker.TracePage{}, &public
	}
	return page, nil
}

// StopSession là đường kết thúc tường minh. Lặp lại STOP trên một phiên đã
// terminal trả về ĐÚNG trạng thái terminal đó, không phải lỗi: dừng một thứ đã
// dừng là một yêu cầu hợp lý.
func (s *SimulationService) StopSession(ctx context.Context, request SimulationRequest, sessionID string) (SimulationSessionView, *domain.PublicError) {
	if public := s.requireSimulationControl(request.Role); public != nil {
		return SimulationSessionView{}, public
	}
	if public := s.requireCapability(); public != nil {
		return SimulationSessionView{}, public
	}
	if sessionID == "active" || sessionID == "current" {
		live, err := s.store.ListLiveSimulationSessions(ctx)
		if err != nil || len(live) == 0 {
			return SimulationSessionView{State: programmingstore.SimStateStopped}, nil
		}
		sessionID = live[0].SessionID
	}
	session, err := s.store.GetSimulationSession(ctx, sessionID)
	if err != nil {
		public := domain.NewPublicError(domain.ErrNotFound)
		return SimulationSessionView{}, &public
	}
	if programmingstore.SimStateIsTerminal(session.State) {
		s.releaseWorker(sessionID)
		return simulationView(session), nil
	}
	if request.IfMatch != "" && request.IfMatch != "*" && request.IfMatch != session.ETag() {
		public := domain.NewPublicError(domain.ErrSimStaleSession)
		public.Args = map[string]any{"expected": session.ETag(), "actual": request.IfMatch}
		return SimulationSessionView{}, &public
	}

	at := s.now()
	if client, _, found := s.worker(sessionID); found && client != nil {
		_ = client.Stop(ctx)
	}
	s.releaseWorker(sessionID)

	details, _ := json.Marshal(map[string]any{"reason": "operator"})
	stopped, err := s.store.UpdateSimulationSession(ctx, programmingstore.UpdateSimulationSessionParams{
		SessionID: session.SessionID, ExpectedSequence: session.SessionSequence,
		State: programmingstore.SimStateStopped, VirtualTimeMS: session.VirtualTimeMS,
		Speed: session.Speed, ObservationSequence: session.ObservationSequence,
		ResetEpoch: session.ResetEpoch, At: at,
		ActorID: request.ActorID, Role: request.Role, AuditID: s.newID(),
		Action: programmingstore.ActionSimulationStop, ResultCode: "STOPPED",
		CorrelationID: request.CorrelationID, AuditDetailsJSON: details,
	})
	if err != nil {
		public := domain.NewPublicError(domain.ErrUnavailable)
		return SimulationSessionView{}, &public
	}
	return simulationView(stopped), nil
}

// Shutdown kill/reap mọi worker còn sống. Gọi lúc `mkddc-web` dừng: bỏ qua bước
// này sẽ để lại đúng những tiến trình mồ côi mà ADR-053 bắt phải chứng minh
// không tồn tại.
func (s *SimulationService) Shutdown() {
	s.mu.Lock()
	clients := make([]*simworker.Client, 0, len(s.workers))
	for sessionID, client := range s.workers {
		clients = append(clients, client)
		delete(s.workers, sessionID)
		delete(s.manifests, sessionID)
	}
	s.mu.Unlock()
	for _, client := range clients {
		client.Kill()
	}
}

/*
workerPIDForTest — PID của worker đang phục vụ một phiên, chỉ dùng cho test.

PID KHÔNG phải danh tính công khai: nó không bao giờ được persist, trả cho FE
hay ghi vào audit, vì một PID lộ ra là một PID có thể bị dùng để kill nhầm tiến
trình khác. Hàm này tồn tại vì bằng chứng "không rò tiến trình" chỉ kiểm được ở
mức hệ điều hành, và `/proc/<pid>` là chỗ duy nhất phân biệt được một tiến trình
đã thu hồi với một zombie.
*/
func (s *SimulationService) workerPIDForTest(sessionID string) int {
	s.mu.Lock()
	client := s.workers[sessionID]
	s.mu.Unlock()
	if client == nil {
		return 0
	}
	return client.PID()
}
