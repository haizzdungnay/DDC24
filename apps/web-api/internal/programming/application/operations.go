package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/google/uuid"

	programmingartifact "mkddc-web/internal/programming/artifact"
	"mkddc-web/internal/programming/coreipc"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

const operationCallTimeout = 3 * time.Second

type OperationRuntime interface {
	Call(context.Context, coreipc.Request) (coreipc.Response, error)
	Reconcile(context.Context, coreipc.Request) (coreipc.Response, error)
}

type OperationServiceOptions struct {
	Store        *programmingstore.Store
	Projects     *ProjectService
	Artifacts    *programmingartifact.Store
	Runtime      OperationRuntime
	ControllerID string
	StagingRoot  string
	Lease        time.Duration
	Now          func() time.Time
	NewID        func() string
	// ModbusSlots — nguồn phân giải slot `ext` để đối chiếu LẠI trước khi
	// activate (`ISS-PIO-31`/`AC-PIO-ID-02`). Nil ⇒ không đối chiếu được, và
	// Commission một package có binding MB_RTU sẽ bị CHẶN.
	ModbusSlots ModbusSlotProvider
}

type OperationService struct {
	store        *programmingstore.Store
	projects     *ProjectService
	artifacts    *programmingartifact.Store
	runtime      OperationRuntime
	controllerID string
	stagingRoot  string
	lease        time.Duration
	now          func() time.Time
	newID        func() string
	modbusSlots  ModbusSlotProvider
	workerID     string
	wake         chan struct{}
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	mu           sync.Mutex
	beginMu      sync.Mutex
}

type OperationCommand struct {
	SchemaVersion            string
	RevisionID               string
	ExpectedActiveRevisionID string
	CheckID                  string
	ImpactRef                string
	Acknowledgements         []string
	Cutover                  string
	GraphBackupID            string
	Reason                   string
	IdempotencyKey           string
	CorrelationID            string
}

type OperationAccepted struct {
	OperationID   string `json:"operationId"`
	StatusURL     string `json:"statusUrl"`
	State         string `json:"state"`
	RequestHash   string `json:"requestHash"`
	AcceptedAt    string `json:"acceptedAt"`
	CorrelationID string `json:"correlationId"`
	Replay        bool   `json:"-"`
}

type OperationView struct {
	OperationID              string  `json:"operationId"`
	Kind                     string  `json:"kind,omitempty"`
	State                    string  `json:"state"`
	Step                     string  `json:"step"`
	RequestedRevisionID      *string `json:"requestedRevisionId"`
	PreviousActiveRevisionID *string `json:"previousActiveRevisionId"`
	ActualActiveRevisionID   *string `json:"actualActiveRevisionId"`
	KeepsRunningRevision     bool    `json:"keepsRunningRevision"`
	StartedAt                string  `json:"startedAt"`
	UpdatedAt                string  `json:"updatedAt"`
}

type OperationPublicError struct{ Public domain.PublicError }

func (e *OperationPublicError) Error() string { return string(e.Public.Code) }

type operationContext struct {
	SchemaVersion           string          `json:"schemaVersion"`
	CheckID                 string          `json:"checkId,omitempty"`
	ArtifactRelative        string          `json:"artifactRelative"`
	ArtifactLocator         string          `json:"artifactLocator"`
	ArtifactSHA256          string          `json:"artifactSha256"`
	ArtifactBytes           int64           `json:"artifactBytes"`
	ImpactRef               string          `json:"impactRef,omitempty"`
	Impact                  *RevisionImpact `json:"impact,omitempty"`
	OverrideInventorySHA256 string          `json:"overrideInventorySha256,omitempty"`
	Acknowledgements        []string        `json:"acknowledgements,omitempty"`
	Cutover                 string          `json:"cutover"`
	GraphBackupID           string          `json:"graphBackupId,omitempty"`
	Reason                  string          `json:"reason,omitempty"`
	Role                    string          `json:"role"`
}

type stagePayload struct {
	_          struct{} `cbor:",toarray"`
	RevisionID string
	InstanceID string
	Locator    string
	ByteSize   uint64
	SHA256     []byte
	PlanHash   string
}

type activatePayload struct {
	_              struct{} `cbor:",toarray"`
	ExpectedActive *string
	StagedToken    string
	Cutover        string
	PlanHash       string
}

type runtimeImpactPayload struct {
	_                 struct{} `cbor:",toarray"`
	ProducerMode      string
	ActiveRevisionID  *string
	LKGRevisionID     *string
	ActiveOverrideIDs []string
	Signals           []runtimeSignalPayload
}

// runtimeSignalPayload là ảnh chỉ-đọc do Core chụp từ StSignalBus. `Valid`
// tách khỏi `Value`: null/0/false đều là giá trị hợp lệ tuỳ type; chỉ `Valid`
// mới trả lời được có phép đo hay không.
type runtimeSignalPayload struct {
	_                 struct{} `cbor:",toarray"`
	Name              string
	ProducerProgramID string
	DataType          string
	Value             any
	Valid             bool
	Quality           string
	Freshness         string
	StalePolicy       string
	FreshnessMS       uint32
	PublishedAtMonoNS uint64
	Generation        uint64
}

// UnmarshalCBOR nhận cả STATUS minor 2 (4 phần tử, chưa có signal) và minor 3
// (5 phần tử). Nâng minor phải tương thích ngược trong cửa sổ partial deploy;
// ép đúng 5 phần tử sẽ làm BE mới coi Core cũ là payload hỏng dù bốn field nền
// vẫn hoàn toàn dùng được.
func (p *runtimeImpactPayload) UnmarshalCBOR(data []byte) error {
	var fields []cbor.RawMessage
	if err := cbor.Unmarshal(data, &fields); err != nil {
		return err
	}
	if len(fields) != 4 && len(fields) != 5 {
		return fmt.Errorf("STATUS payload cần 4 hoặc 5 phần tử, nhận %d", len(fields))
	}
	if err := cbor.Unmarshal(fields[0], &p.ProducerMode); err != nil {
		return err
	}
	if err := cbor.Unmarshal(fields[1], &p.ActiveRevisionID); err != nil {
		return err
	}
	if err := cbor.Unmarshal(fields[2], &p.LKGRevisionID); err != nil {
		return err
	}
	if err := cbor.Unmarshal(fields[3], &p.ActiveOverrideIDs); err != nil {
		return err
	}
	p.Signals = []runtimeSignalPayload{}
	if len(fields) == 5 {
		if err := cbor.Unmarshal(fields[4], &p.Signals); err != nil {
			return err
		}
	}
	return nil
}

// retainResetPayload là CBOR array 2 phần tử khớp `parse_retain_reset_payload`
// phía Core (`program_ipc_server.cpp`): [expected_active_revision_id, instance_id].
// `operation_id` đi theo envelope Request chung, không lặp lại trong payload.
type retainResetPayload struct {
	_              struct{} `cbor:",toarray"`
	ExpectedActive *string
	InstanceID     string
}

type retainResetContext struct {
	SchemaVersion string `json:"schemaVersion"`
	InstanceID    string `json:"instanceId"`
	Reason        string `json:"reason"`
	Role          string `json:"role"`
}

// Rev A chỉ có một Program instance; field vẫn đi qua wire (Core lẫn context
// audit) để Multi-Program sau này không cần đổi shape API (WP-12 §9).
const retainResetInstanceID = "program-main"

func NewOperationService(options OperationServiceOptions) (*OperationService, error) {
	if options.Store == nil || options.Projects == nil || options.Artifacts == nil || options.Runtime == nil ||
		!validText(options.ControllerID, 1, 64) || options.StagingRoot == "" {
		return nil, fmt.Errorf("Programming Operation dependencies không đầy đủ")
	}
	if options.Lease == 0 {
		options.Lease = 30 * time.Second
	}
	if options.Lease < time.Second || options.Lease > 10*time.Minute {
		return nil, fmt.Errorf("Operation lease không hợp lệ")
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.NewID == nil {
		options.NewID = uuid.NewString
	}
	service := &OperationService{store: options.Store, projects: options.Projects,
		artifacts: options.Artifacts, runtime: options.Runtime, controllerID: options.ControllerID,
		stagingRoot: options.StagingRoot, lease: options.Lease, now: options.Now,
		newID: options.NewID, modbusSlots: options.ModbusSlots, wake: make(chan struct{}, 1)}
	service.workerID = "operation-worker-" + service.newID()
	options.Projects.SetRuntimeImpactProvider(service)
	return service, nil
}

func (s *OperationService) CurrentRuntimeImpact(ctx context.Context) (RuntimeImpactSnapshot, error) {
	operationID := []byte(nil)
	request := coreipc.NewRequest(coreipc.ActionStatus, uuidBytes(s.newID()), operationID,
		s.controllerID, "", "runtime-impact-"+s.newID(),
		coreipc.FutureDeadline(operationCallTimeout), coreipc.EmptyPayload())
	callCtx, cancel := context.WithTimeout(ctx, operationCallTimeout)
	defer cancel()
	response, err := s.runtime.Call(callCtx, request)
	if err != nil || response.Result != coreipc.ResultOK {
		return RuntimeImpactSnapshot{}, fmt.Errorf("Core runtime impact unavailable")
	}
	var payload runtimeImpactPayload
	if err := coreipc.DecodePayload(response.Payload, &payload); err != nil ||
		(payload.ProducerMode != "GRAPH_ONLY" && payload.ProducerMode != "PROGRAM_ONLY") {
		return RuntimeImpactSnapshot{}, fmt.Errorf("Core runtime impact payload không hợp lệ")
	}
	active := ""
	if payload.ActiveRevisionID != nil {
		active = *payload.ActiveRevisionID
	}
	return RuntimeImpactSnapshot{ProducerMode: payload.ProducerMode,
		ActiveRevisionID: active, ActiveOverrideIDs: append([]string(nil), payload.ActiveOverrideIDs...)}, nil
}

func (s *OperationService) Start(parent context.Context) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	s.cancel = cancel
	s.wg.Add(1)
	go func() { defer s.wg.Done(); s.run(ctx) }()
}

func (s *OperationService) Close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		s.wg.Wait()
	}
}

func (s *OperationService) Commission(ctx context.Context, actor Actor, command OperationCommand) (OperationAccepted, error) {
	return s.begin(ctx, actor, "COMMISSION", command)
}

func (s *OperationService) Restore(ctx context.Context, actor Actor, command OperationCommand) (OperationAccepted, error) {
	return s.begin(ctx, actor, "RESTORE", command)
}

// ResetRetain (WP-12, DDD-RETAIN-RESET-PROG-001) không đi qua `begin()`:
// Commission/Restore luôn gắn với một artifact PASSED phải stage trước khi
// activate (`resolveArtifact`/`MaterializeStaging`), còn RETAIN reset không
// có artifact — Core coi đây là một hành động vận hành trên Program ĐANG
// COMMITTED, không phải một candidate mới. Idempotency/audit vẫn dùng chung
// hạ tầng Operation (`store.BeginOperation`/`UpdateOperation`) để không lặp
// lại logic đã kiểm chứng.
func (s *OperationService) ResetRetain(ctx context.Context, actor Actor, command OperationCommand) (OperationAccepted, error) {
	if command.SchemaVersion != "1.0" || !isUUID(command.ExpectedActiveRevisionID) ||
		!validText(command.Reason, 1, 500) {
		return OperationAccepted{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return OperationAccepted{}, err
	}
	requestHash, err := semanticHash(map[string]any{"kind": "RESET_RETAIN", "controllerId": s.controllerID,
		"expectedActiveRevisionId": command.ExpectedActiveRevisionID, "instanceId": retainResetInstanceID,
		"reason": command.Reason})
	if err != nil {
		return OperationAccepted{}, err
	}
	s.beginMu.Lock()
	defer s.beginMu.Unlock()
	if existing, found, lookupErr := s.store.LookupOperationByIdempotency(ctx, actor.ID,
		"RESET_RETAIN", s.controllerID, keyHash, requestHash); lookupErr != nil {
		return OperationAccepted{}, lookupErr
	} else if found {
		return acceptedOperation(existing, requestHash, command.CorrelationID, true), nil
	}
	contextValue := retainResetContext{SchemaVersion: "1.0", InstanceID: retainResetInstanceID,
		Reason: command.Reason, Role: actor.Role}
	contextJSON, _ := json.Marshal(contextValue)
	operation, err := s.store.BeginOperation(ctx, programmingstore.BeginOperationParams{
		OperationID: s.newID(), Kind: "RESET_RETAIN", ControllerID: s.controllerID,
		RequestedRevisionID: command.ExpectedActiveRevisionID, ExpectedActiveRevisionID: command.ExpectedActiveRevisionID,
		IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash, ContextJSON: contextJSON,
		CorrelationID: command.CorrelationID, ActorID: actor.ID, Role: actor.Role,
		AuditID: s.newID(), At: s.now(),
	})
	if err != nil {
		return OperationAccepted{}, err
	}
	signalWake(s.wake)
	return acceptedOperation(operation, requestHash, command.CorrelationID, operation.Replay), nil
}

func (s *OperationService) begin(ctx context.Context, actor Actor, kind string, command OperationCommand) (OperationAccepted, error) {
	if command.SchemaVersion != "1.0" || !isUUID(command.RevisionID) ||
		(command.ExpectedActiveRevisionID != "" && !isUUID(command.ExpectedActiveRevisionID)) ||
		(kind == "COMMISSION" && (!isUUID(command.CheckID) || command.ImpactRef == "" || command.Cutover != "PROGRAM_ONLY")) ||
		(kind == "RESTORE" && (!validText(command.Reason, 1, 500) || command.Cutover != "PROGRAM_ONLY")) {
		return OperationAccepted{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return OperationAccepted{}, err
	}
	requestHash, err := semanticHash(map[string]any{"kind": kind, "controllerId": s.controllerID,
		"revisionId": command.RevisionID, "expectedActiveRevisionId": command.ExpectedActiveRevisionID,
		"checkId": command.CheckID, "impactRef": command.ImpactRef,
		"acknowledgements": command.Acknowledgements, "cutover": command.Cutover,
		"graphBackupId": command.GraphBackupID, "reason": command.Reason})
	if err != nil {
		return OperationAccepted{}, err
	}
	/* Tuần tự hoá reserve theo idempotency trong một process. Unique index DB
	 * vẫn là authority giữa nhiều process; lock này ngăn hai goroutine cùng
	 * tạo locator trước khi một bên kịp commit receipt. */
	s.beginMu.Lock()
	defer s.beginMu.Unlock()
	if existing, found, lookupErr := s.store.LookupOperationByIdempotency(ctx, actor.ID,
		kind, s.controllerID, keyHash, requestHash); lookupErr != nil {
		return OperationAccepted{}, lookupErr
	} else if found {
		return acceptedOperation(existing, requestHash, command.CorrelationID, true), nil
	}

	check, err := s.resolveArtifact(ctx, kind, command)
	if err != nil {
		return OperationAccepted{}, err
	}
	if kind == "COMMISSION" {
		/* `AC-PIO-ID-02` — đối chiếu LẠI ngay trước activation.
		 *
		 * Check đã phân giải slot theo danh tính bền, nhưng giữa lúc Check xanh
		 * và lúc bấm Commission, cấu hình fieldbus vẫn có thể đổi: tắt một
		 * thiết bị, đổi tên một điểm, thêm một điểm. Package đã PASSED không
		 * chứng minh được điều gì về cấu hình HIỆN TẠI — và đúng khoảng trống
		 * đó là nơi lỗi ghi sai thanh ghi đi qua. */
		if err := s.verifyModbusSlots(ctx, check); err != nil {
			return OperationAccepted{}, err
		}
	}
	var commissionImpact *RevisionImpact
	var overrideInventorySHA [32]byte
	if kind == "COMMISSION" {
		from := command.ExpectedActiveRevisionID
		if from == "" {
			from = "none"
		}
		impact, err := s.projects.GetRevisionChanges(ctx, from, command.RevisionID)
		if err != nil {
			return OperationAccepted{}, err
		}
		if public := validateApplicationImpact(impact.Impact, command.ImpactRef, command.Acknowledgements); public != nil {
			return OperationAccepted{}, &OperationPublicError{Public: *public}
		}
		commissionImpact = &impact.Impact
		overrideInventorySHA, err = semanticHash(impact.Impact.ActiveOverrides)
		if err != nil {
			return OperationAccepted{}, err
		}
	}
	operationID := s.newID()
	locator, err := s.artifacts.MaterializeStaging(s.stagingRoot, operationID,
		check.Artifact.RelativePath, check.Artifact.SHA256, check.Artifact.ByteSize)
	if err != nil {
		return OperationAccepted{}, publicOperationError(domain.ErrArtifact, true)
	}
	contextValue := operationContext{SchemaVersion: "1.0", CheckID: command.CheckID,
		ArtifactRelative: check.Artifact.RelativePath, ArtifactLocator: locator,
		ArtifactSHA256: hex.EncodeToString(check.Artifact.SHA256[:]), ArtifactBytes: check.Artifact.ByteSize,
		ImpactRef: command.ImpactRef, Impact: commissionImpact,
		OverrideInventorySHA256: hex.EncodeToString(overrideInventorySHA[:]),
		Acknowledgements:        append([]string(nil), command.Acknowledgements...),
		Cutover:                 command.Cutover, GraphBackupID: command.GraphBackupID, Reason: command.Reason, Role: actor.Role}
	contextJSON, _ := json.Marshal(contextValue)
	operation, err := s.store.BeginOperation(ctx, programmingstore.BeginOperationParams{
		OperationID: operationID, Kind: kind, ControllerID: s.controllerID,
		RequestedRevisionID: command.RevisionID, ExpectedActiveRevisionID: command.ExpectedActiveRevisionID,
		IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash, ContextJSON: contextJSON,
		CorrelationID: command.CorrelationID, ActorID: actor.ID, Role: actor.Role,
		AuditID: s.newID(), At: s.now(),
	})
	if err != nil {
		_ = s.artifacts.RemoveStaging(s.stagingRoot, operationID)
		return OperationAccepted{}, err
	}
	if operation.Replay && operation.OperationID != operationID {
		_ = s.artifacts.RemoveStaging(s.stagingRoot, operationID)
	}
	signalWake(s.wake)
	return acceptedOperation(operation, requestHash, command.CorrelationID, operation.Replay), nil
}

func (s *OperationService) resolveArtifact(ctx context.Context, kind string, command OperationCommand) (programmingstore.Check, error) {
	if kind == "COMMISSION" {
		check, err := s.store.GetCheck(ctx, command.CheckID)
		if err != nil {
			return programmingstore.Check{}, err
		}
		if check.State != "PASSED" || check.RevisionID != command.RevisionID || check.Artifact == nil {
			return programmingstore.Check{}, publicOperationError(domain.ErrCheck, true)
		}
		return check, nil
	}
	// Restore không bypass loader: chỉ dùng artifact PASSED mới nhất của đúng
	// Revision. Store lookup cố định theo completed/check ID để deterministic.
	check, err := s.store.GetPassedCheckForRevision(ctx, command.RevisionID)
	if err != nil {
		return programmingstore.Check{}, err
	}
	if check.Artifact == nil {
		return programmingstore.Check{}, publicOperationError(domain.ErrRestore, true)
	}
	return check, nil
}

func (s *OperationService) GetOperation(ctx context.Context, operationID string) (OperationView, error) {
	operation, err := s.store.GetOperation(ctx, operationID)
	if err != nil {
		return OperationView{}, err
	}
	return operationView(operation), nil
}

func (s *OperationService) ProcessNext(ctx context.Context) (bool, error) {
	operation, claimed, err := s.store.ClaimOperation(ctx, programmingstore.ClaimOperationParams{
		Owner: s.workerID, At: s.now(), Lease: s.lease})
	if err != nil || !claimed {
		return claimed, err
	}
	if operation.State != "PENDING" && operation.State != "VALIDATING" {
		return true, s.reconcile(ctx, operation)
	}
	return true, s.execute(ctx, operation)
}

func (s *OperationService) execute(ctx context.Context, operation programmingstore.Operation) error {
	if operation.Kind == "RESET_RETAIN" {
		return s.executeRetainReset(ctx, operation)
	}
	contextValue, err := decodeOperationContext(operation.ContextJSON)
	if err != nil {
		return s.fail(operation, "CONTEXT_INVALID", err.Error())
	}
	operation, err = s.transition(operation, "VALIDATING", "PREFLIGHT", "", "", nil, "", nil, false)
	if err != nil {
		return err
	}
	status, err := s.call(ctx, operation, coreipc.ActionStatus, coreipc.EmptyPayload())
	if err != nil {
		return s.markUnknown(operation, "PREFLIGHT_STATUS", err)
	}
	if operation.ExpectedActiveRevisionID != responseRevision(status) {
		return s.fail(operation, "EXPECTED_ACTIVE_MISMATCH", "Core active revision đã đổi")
	}
	instanceID, err := s.runtimeInstanceIDForRevision(ctx, operation.RequestedRevisionID)
	if err != nil {
		return s.fail(operation, "RUNTIME_INSTANCE", err.Error())
	}
	stage, err := coreipc.EncodePayload(stagePayload{RevisionID: operation.RequestedRevisionID,
		InstanceID: instanceID, Locator: contextValue.ArtifactLocator,
		ByteSize: uint64(contextValue.ArtifactBytes), SHA256: mustDecodeHex(contextValue.ArtifactSHA256),
		PlanHash: operationPlanHash(operation.ContextJSON)})
	if err != nil {
		return s.fail(operation, "STAGE_PAYLOAD", err.Error())
	}
	operation, err = s.transition(operation, "STAGING", "STAGE", "", "", nil, responseRevision(status), nil, false)
	if err != nil {
		return err
	}
	action := coreipc.ActionStage
	if operation.Kind == "RESTORE" {
		action = coreipc.ActionRestore
	}
	stageResponse, err := s.call(ctx, operation, action, stage)
	if err != nil {
		return s.markUnknown(operation, "STAGE", err)
	}
	if stageResponse.Result != coreipc.ResultStaged && stageResponse.Result != coreipc.ResultAccepted && stageResponse.Result != coreipc.ResultOK {
		return s.failResponse(operation, "STAGE_REJECTED", stageResponse)
	}
	if operation.Kind == "RESTORE" && stageResponse.Result != coreipc.ResultStaged {
		operation, err = s.transition(operation, "VERIFYING", "READ_BACK", "", "", nil, responseRevision(status), &stageResponse, true)
		if err != nil {
			return err
		}
		signalWake(s.wake)
		return nil
	}
	return s.activateStaged(ctx, operation, contextValue, responseRevision(status), stageResponse)
}

// runtimeInstanceIDForRevision cấp fallback identity cho artifact v1. Package
// v2 mang identity trong PROGRAM_TABLE nên Core bỏ qua field này, nhưng dù
// ở shape nào identity nhìn từ API intent vẫn phải là Program ID đã
// seal. Hard-code `program-main` làm Enable/Disable không thể chạm Program.
func (s *OperationService) runtimeInstanceIDForRevision(ctx context.Context, revisionID string) (string, error) {
	revision, err := s.store.GetRevision(ctx, revisionID)
	if err != nil {
		return "", err
	}
	for _, object := range revision.Objects {
		if object.Kind == "PROGRAM" && isUUID(object.ObjectID) {
			return object.ObjectID, nil
		}
	}
	return "", fmt.Errorf("Revision không có Program runtime hợp lệ")
}

func (s *OperationService) activateStaged(ctx context.Context, operation programmingstore.Operation,
	contextValue operationContext, previous string, stageResponse coreipc.Response) error {
	expected := nullableRevision(operation.ExpectedActiveRevisionID)
	activate, err := coreipc.EncodePayload(activatePayload{ExpectedActive: expected,
		StagedToken: operation.OperationID, Cutover: contextValue.Cutover,
		PlanHash: operationPlanHash(operation.ContextJSON)})
	if err != nil {
		return s.fail(operation, "ACTIVATE_PAYLOAD", err.Error())
	}
	operation, err = s.transition(operation, "ACTIVATING", "ACTIVATE", "", "", nil, previous, &stageResponse, false)
	if err != nil {
		return err
	}
	activateResponse, err := s.call(ctx, operation, coreipc.ActionActivate, activate)
	if err != nil {
		return s.markUnknown(operation, "ACTIVATE", err)
	}
	if activateResponse.Result != coreipc.ResultAccepted && activateResponse.Result != coreipc.ResultOK {
		return s.failResponse(operation, "ACTIVATE_REJECTED", activateResponse)
	}
	_, err = s.transition(operation, "VERIFYING", "READ_BACK", "", "", nil,
		previous, &activateResponse, true)
	if err == nil {
		signalWake(s.wake)
	}
	return err
}

// executeRetainReset (WP-12). Không có STAGE/ACTIVATE hai pha thật sự — vẫn
// đi qua state STAGING/ACTIVATING để tái dùng nguyên `validOperationTransition`
// đã kiểm chứng (không thêm state mới vào store), chỉ khác tên `step` cho
// đúng ngữ nghĩa. Preflight STATUS trước khi gọi RETAIN_RESET để bắt sớm
// TC-RETAIN-05 (Active Revision đổi giữa chừng) mà không cần chạm Core.
func (s *OperationService) executeRetainReset(ctx context.Context, operation programmingstore.Operation) error {
	operation, err := s.transition(operation, "VALIDATING", "PREFLIGHT", "", "", nil, "", nil, false)
	if err != nil {
		return err
	}
	status, err := s.call(ctx, operation, coreipc.ActionStatus, coreipc.EmptyPayload())
	if err != nil {
		return s.markUnknown(operation, "PREFLIGHT_STATUS", err)
	}
	previous := responseRevision(status)
	if operation.ExpectedActiveRevisionID != previous {
		return s.fail(operation, "EXPECTED_ACTIVE_MISMATCH", "Core active revision đã đổi")
	}
	operation, err = s.transition(operation, "STAGING", "RETAIN_RESET_PREFLIGHT_OK", "", "", nil, previous, nil, false)
	if err != nil {
		return err
	}
	operation, err = s.transition(operation, "ACTIVATING", "RETAIN_RESET", "", "", nil, previous, nil, false)
	if err != nil {
		return err
	}
	return s.callRetainReset(ctx, operation, previous)
}

// reconcileRetainReset chạy khi một attempt trước đó rơi vào UNKNOWN (Core
// TIMED_OUT hoặc lỗi transport). KHÔNG dùng `s.runtime.Reconcile` — hàm đó bị
// khoá cứng chỉ gọi OPERATION_STATUS (`coreipc/client.go`) và Core cũng không
// theo dõi operation_id của RETAIN_RESET qua cơ chế journal như Stage/Activate.
// Gọi lại đúng RETAIN_RESET là an toàn vì bản chất idempotent (reset lần hai
// cho cùng kết quả) — đúng quyết định đã ghi trong comment
// `programming_runtime_coordinator.cpp: reset_retain()`.
func (s *OperationService) reconcileRetainReset(ctx context.Context, operation programmingstore.Operation) error {
	status, err := s.call(ctx, operation, coreipc.ActionStatus, coreipc.EmptyPayload())
	if err != nil {
		_, updateErr := s.transition(operation, "UNKNOWN", "RECONCILE_STATUS", "", "IPC_UNAVAILABLE", nil,
			operation.PreviousActiveRevisionID, nil, true)
		return updateErr
	}
	previous := responseRevision(status)
	if operation.ExpectedActiveRevisionID != previous {
		return s.fail(operation, "EXPECTED_ACTIVE_MISMATCH", "Core active revision đã đổi")
	}
	return s.callRetainReset(ctx, operation, previous)
}

// callRetainReset. Khác Stage/Activate: RETAIN_RESET là MỘT round-trip đã tự
// chờ safe boundary bên trong Core (bounded ~1.5s,
// `programming_runtime_coordinator.cpp: reset_retain`) — Result trả về đã là
// câu trả lời chung cuộc, không cần bước read-back OPERATION_STATUS riêng như
// Activate. Result BUSY nghĩa là Core tự thấy TIMED_OUT ở boundary/flush —
// không phải lỗi transport — nên map sang UNKNOWN (không phải FAILED, không
// phải SUCCEEDED) để lần ProcessNext kế tiếp gọi lại (§7 "không giả định
// thành công khi timeout").
func (s *OperationService) callRetainReset(ctx context.Context, operation programmingstore.Operation, previous string) error {
	expected := nullableRevision(operation.ExpectedActiveRevisionID)
	payload, err := coreipc.EncodePayload(retainResetPayload{ExpectedActive: expected, InstanceID: retainResetInstanceID})
	if err != nil {
		return s.fail(operation, "RETAIN_RESET_PAYLOAD", err.Error())
	}
	response, err := s.call(ctx, operation, coreipc.ActionRetainReset, payload)
	if err != nil {
		return s.markUnknown(operation, "RETAIN_RESET", err)
	}
	switch response.Result {
	case coreipc.ResultOK:
		operation, err = s.transition(operation, "VERIFYING", "RETAIN_RESET_APPLIED", "", "", nil, previous, &response, false)
		if err != nil {
			return err
		}
		keeps := true
		_, err = s.transition(operation, "SUCCEEDED", "COMMITTED", "COMMITTED", "", &keeps, previous, &response, true)
		return err
	case coreipc.ResultBusy:
		detail := "IPC-RETAIN-RESET-TIMEOUT"
		if response.DetailCode != nil {
			detail = *response.DetailCode
		}
		_, err = s.transition(operation, "UNKNOWN", "RETAIN_RESET_TIMEOUT", "", detail, nil, previous, &response, true)
		return err
	default:
		return s.failResponse(operation, "RETAIN_RESET_REJECTED", response)
	}
}

func (s *OperationService) reconcile(ctx context.Context, operation programmingstore.Operation) error {
	if operation.Kind == "RESET_RETAIN" {
		return s.reconcileRetainReset(ctx, operation)
	}
	response, err := s.reconcileCall(ctx, operation)
	if err != nil {
		_, updateErr := s.transition(operation, "UNKNOWN", "RECONCILE", "", "IPC_UNAVAILABLE", nil,
			operation.PreviousActiveRevisionID, nil, true)
		return updateErr
	}
	active := responseRevision(response)
	if active == operation.RequestedRevisionID && response.Result == coreipc.ResultOK {
		keeps := true
		_, err = s.transition(operation, "SUCCEEDED", "COMMITTED", "COMMITTED", "", &keeps,
			operation.PreviousActiveRevisionID, &response, true)
		return err
	}
	if response.Result == coreipc.ResultStaged {
		contextValue, decodeErr := decodeOperationContext(operation.ContextJSON)
		if decodeErr != nil {
			return s.fail(operation, "CONTEXT_INVALID", decodeErr.Error())
		}
		return s.activateStaged(ctx, operation, contextValue,
			operation.PreviousActiveRevisionID, response)
	}
	if response.Result == coreipc.ResultAccepted ||
		(response.Result == coreipc.ResultOK && active == "") {
		_, err = s.transition(operation, "VERIFYING", "READ_BACK", "", "", nil,
			operation.PreviousActiveRevisionID, &response, true)
		return err
	}
	return s.failResponse(operation, "RECONCILE_REJECTED", response)
}

func (s *OperationService) call(ctx context.Context, operation programmingstore.Operation, action coreipc.Action, payload []byte) (coreipc.Response, error) {
	requestID := uuidBytes(s.newID())
	operationID := uuidBytes(operation.OperationID)
	request := coreipc.NewRequest(action, requestID, operationID, operation.ControllerID,
		operation.ActorID, operation.CorrelationID, coreipc.FutureDeadline(operationCallTimeout), payload)
	callCtx, cancel := context.WithTimeout(ctx, operationCallTimeout)
	defer cancel()
	return s.runtime.Call(callCtx, request)
}

func (s *OperationService) reconcileCall(ctx context.Context, operation programmingstore.Operation) (coreipc.Response, error) {
	request := coreipc.NewRequest(coreipc.ActionOperationStatus, uuidBytes(s.newID()), uuidBytes(operation.OperationID),
		operation.ControllerID, "", operation.CorrelationID, coreipc.FutureDeadline(operationCallTimeout), coreipc.EmptyPayload())
	callCtx, cancel := context.WithTimeout(ctx, operationCallTimeout)
	defer cancel()
	return s.runtime.Reconcile(callCtx, request)
}

func (s *OperationService) transition(operation programmingstore.Operation, state, step, result, detail string,
	keeps *bool, previous string, response *coreipc.Response, release bool) (programmingstore.Operation, error) {
	var coreJSON []byte
	actual := ""
	if response != nil {
		coreJSON, _ = json.Marshal(map[string]any{"result": response.Result, "activeRevisionId": response.ActiveRevisionID,
			"lkgRevisionId": response.LKGRevisionID, "detailCode": response.DetailCode,
			"keepsRunning": response.KeepsRunning})
		actual = responseRevision(*response)
	}
	terminal := state == "SUCCEEDED" || state == "FAILED" || state == "CANCELLED"
	auditID, action, role := "", "", ""
	var commissionRecord *programmingstore.CommissionRecordInput
	if terminal {
		auditID, action = s.newID(), "OPERATION_COMPLETE"
		// RESET_RETAIN dùng `retainResetContext` (không có field artifact) —
		// `decodeOperationContext` áp DisallowUnknownFields nên luôn lỗi trên
		// context đó; phải đọc role đúng shape theo Kind, không suy luận từ giá
		// trị zero của một decode thất bại (đó là bug: role rỗng làm audit fail).
		var contextValue operationContext
		var contextErr error
		if operation.Kind == "RESET_RETAIN" {
			var retainContext retainResetContext
			contextErr = decodeStrict(operation.ContextJSON, &retainContext)
			role = retainContext.Role
		} else {
			contextValue, contextErr = decodeOperationContext(operation.ContextJSON)
			role = contextValue.Role
		}
		if operation.Kind == "COMMISSION" && contextErr == nil && contextValue.Impact != nil {
			artifactSHA, artifactErr := decodeSHA256(contextValue.ArtifactSHA256)
			overrideSHA, overrideErr := decodeSHA256(contextValue.OverrideInventorySHA256)
			impactJSON, impactErr := json.Marshal(contextValue.Impact)
			if artifactErr == nil && overrideErr == nil && impactErr == nil {
				readback := coreJSON
				if len(readback) == 0 {
					readback = []byte(`{}`)
				}
				commissionRecord = &programmingstore.CommissionRecordInput{
					PreviousRevisionID: operation.PreviousActiveRevisionID,
					NewRevisionID:      operation.RequestedRevisionID, ArtifactSHA256: artifactSHA,
					RuntimeReadbackJSON: readback, ImpactJSON: impactJSON,
					OverrideInventorySHA256: overrideSHA, Result: result,
				}
			}
		}
	}
	return s.store.UpdateOperation(context.Background(), programmingstore.UpdateOperationParams{
		OperationID: operation.OperationID, LeaseOwner: operation.LeaseOwner,
		LeaseGeneration: operation.LeaseGeneration, State: state, Step: step,
		ResultCode: result, DetailCode: detail, KeepsRunningRevision: keeps,
		PreviousActive: previous, ActualActive: actual, CoreResultJSON: coreJSON,
		At: s.now(), ReleaseLease: release || terminal, AuditID: auditID,
		AuditAction: action, AuditRole: role, CommissionRecord: commissionRecord,
	})
}

func decodeSHA256(value string) ([32]byte, error) {
	raw, err := hex.DecodeString(value)
	if err != nil || len(raw) != sha256.Size {
		return [32]byte{}, fmt.Errorf("SHA-256 không hợp lệ")
	}
	var result [32]byte
	copy(result[:], raw)
	return result, nil
}

func (s *OperationService) fail(operation programmingstore.Operation, code, detail string) error {
	keeps := true
	_, err := s.transition(operation, "FAILED", "FAILED", code, detail, &keeps,
		operation.PreviousActiveRevisionID, nil, true)
	return err
}

func (s *OperationService) failResponse(operation programmingstore.Operation, code string, response coreipc.Response) error {
	detail := code
	if response.DetailCode != nil {
		detail = *response.DetailCode
	}
	keeps := response.KeepsRunning
	_, err := s.transition(operation, "FAILED", "FAILED", code, detail, &keeps,
		operation.PreviousActiveRevisionID, &response, true)
	return err
}

func (s *OperationService) markUnknown(operation programmingstore.Operation, step string, cause error) error {
	_, err := s.transition(operation, "UNKNOWN", step, "", "IPC_AMBIGUOUS", nil,
		operation.PreviousActiveRevisionID, nil, true)
	if err != nil {
		return err
	}
	_ = cause
	return nil
}

func (s *OperationService) run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		case <-ticker.C:
		}
		/* Tối đa một transition mỗi wake/tick. VERIFYING/UNKNOWN phải poll có
		 * nhịp, không được busy-loop ăn CPU khi Core vẫn đang chờ boundary. */
		_, _ = s.ProcessNext(ctx)
	}
}

func (s *OperationService) PendingAtStartup(ctx context.Context) ([]OperationView, error) {
	items, err := s.store.ListRecoverableOperations(ctx, 100)
	if err != nil {
		return nil, err
	}
	result := make([]OperationView, 0, len(items))
	for _, item := range items {
		result = append(result, operationView(item))
	}
	return result, nil
}

func operationView(operation programmingstore.Operation) OperationView {
	requested := operation.RequestedRevisionID
	view := OperationView{OperationID: operation.OperationID, Kind: operation.Kind, State: publicOperationState(operation.State),
		Step: operation.Step, RequestedRevisionID: &requested, KeepsRunningRevision: true,
		StartedAt: formatTime(operation.CreatedAtUTCMS), UpdatedAt: formatTime(operation.UpdatedAtUTCMS)}
	if operation.PreviousActiveRevisionID != "" {
		value := operation.PreviousActiveRevisionID
		view.PreviousActiveRevisionID = &value
	}
	if operation.ActualActiveRevisionID != "" {
		value := operation.ActualActiveRevisionID
		view.ActualActiveRevisionID = &value
	}
	if operation.KeepsRunningRevision != nil {
		view.KeepsRunningRevision = *operation.KeepsRunningRevision
	}
	return view
}

func publicOperationState(state string) string {
	switch state {
	case "PENDING":
		return "QUEUED"
	case "VALIDATING":
		return "PREFLIGHT"
	case "STAGING":
		return "STAGING"
	case "ACTIVATING":
		return "APPLYING"
	case "VERIFYING":
		return "VERIFYING"
	case "SUCCEEDED":
		return "SUCCEEDED"
	case "FAILED", "CANCELLED":
		return "FAILED"
	case "UNKNOWN":
		return "UNKNOWN_RECONCILING"
	}
	return "UNKNOWN_RECONCILING"
}

func decodeOperationContext(raw []byte) (operationContext, error) {
	var value operationContext
	if err := decodeStrict(raw, &value); err != nil || value.SchemaVersion != "1.0" ||
		value.ArtifactLocator == "" || value.ArtifactSHA256 == "" || value.ArtifactBytes < 1 || value.Role == "" {
		return operationContext{}, fmt.Errorf("operation context không hợp lệ")
	}
	return value, nil
}

// impactAckKeys là enum ĐÓNG của khoá acknowledgement. Giữ ở một chỗ để thêm
// nhóm impact không thể quên cập nhật phép kiểm — bản trước liệt kê bốn khoá
// bằng bốn phép so `!=` nối nhau, đúng dạng dễ thêm nhóm mà quên sửa.
var impactAckKeys = map[string]bool{
	"retain": true, "activeOverrides": true, "cutover": true, "outputMappingChanges": true,
	"publishedSignals": true, "controlLibrary": true, "programSet": true, "enableIntent": true,
}

func validateApplicationImpact(current RevisionImpact, ref string, acknowledgements []string) *domain.PublicError {
	if current.ImpactRef == "" || current.ImpactRef != ref {
		value := domain.NewPublicError(domain.ErrImpactStale)
		value.Args = map[string]any{"expected": current.ImpactRef, "actual": ref}
		return &value
	}
	provided := make(map[string]bool, len(acknowledgements))
	for _, key := range acknowledgements {
		if provided[key] || !impactAckKeys[key] {
			value := domain.NewPublicError(domain.ErrAckUnexpected)
			value.Args = map[string]any{"key": key}
			return &value
		}
		provided[key] = true
	}
	groups := map[string]RevisionImpactGroup{"retain": current.Retain, "activeOverrides": current.ActiveOverrides,
		"cutover": current.Cutover, "outputMappingChanges": current.OutputMappingChanges,
		"publishedSignals": current.PublishedSignals, "controlLibrary": current.ControlLibrary,
		"programSet": current.ProgramSet, "enableIntent": current.EnableIntent}
	missing, unexpected := make([]string, 0), make([]string, 0)
	for key, group := range groups {
		switch group.Status {
		case "PRESENT":
			if len(group.Items) == 0 {
				value := domain.NewPublicError(domain.ErrImpactUnavailable)
				value.Args = map[string]any{"key": key}
				return &value
			}
			if !provided[key] {
				missing = append(missing, key)
			}
		case "NONE":
			if provided[key] {
				unexpected = append(unexpected, key)
			}
		default:
			value := domain.NewPublicError(domain.ErrImpactUnavailable)
			value.Args = map[string]any{"key": key}
			return &value
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		value := domain.NewPublicError(domain.ErrAckMissing)
		value.Args = map[string]any{"keys": missing}
		return &value
	}
	if len(unexpected) > 0 {
		sort.Strings(unexpected)
		value := domain.NewPublicError(domain.ErrAckUnexpected)
		value.Args = map[string]any{"keys": unexpected}
		return &value
	}
	return nil
}

func acceptedOperation(operation programmingstore.Operation, requestHash [32]byte,
	correlationID string, replay bool) OperationAccepted {
	return OperationAccepted{OperationID: operation.OperationID,
		StatusURL: "/api/v1/programming/operations/" + operation.OperationID, State: "QUEUED",
		RequestHash: hex.EncodeToString(requestHash[:]), AcceptedAt: formatTime(operation.CreatedAtUTCMS),
		CorrelationID: correlationID, Replay: replay}
}

func publicOperationError(code domain.ErrorCode, keeps bool) error {
	value := domain.NewPublicError(code)
	value.KeepsRunningRevision = keeps
	return &OperationPublicError{Public: value}
}

func responseRevision(response coreipc.Response) string {
	if response.ActiveRevisionID == nil {
		return ""
	}
	return *response.ActiveRevisionID
}

func nullableRevision(value string) *string {
	if value == "" {
		return nil
	}
	copy := value
	return &copy
}
func uuidBytes(value string) []byte {
	parsed, err := uuid.Parse(value)
	if err != nil {
		return nil
	}
	return append([]byte(nil), parsed[:]...)
}
func mustDecodeHex(value string) []byte { decoded, _ := hex.DecodeString(value); return decoded }
func operationPlanHash(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}
func signalWake(channel chan struct{}) {
	select {
	case channel <- struct{}{}:
	default:
	}
}
