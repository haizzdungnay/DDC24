package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

const (
	checkTargetProfile   = "MK-DDC-24-REV-A"
	checkStoreProfile    = "MKDDC24_REVA"
	checkCompilerVersion = "fwsom-st-1.2.0"
)

type RequestCheckCommand struct {
	RevisionID     string
	SchemaVersion  string
	TargetProfile  string
	IdempotencyKey string
	CorrelationID  string
}

type CheckAccepted struct {
	CheckID       string
	State         string
	StatusURL     string
	RequestHash   string
	AcceptedAt    string
	CorrelationID string
	Replay        bool
}

type DiagnosticView struct {
	Code       string         `json:"code"`
	DetailCode string         `json:"detailCode"`
	Severity   string         `json:"severity"`
	MessageKey string         `json:"messageKey"`
	Location   map[string]any `json:"location"`
	Args       map[string]any `json:"args,omitempty"`
}

type ArtifactView struct {
	ArtifactID      string `json:"artifactId"`
	SHA256          string `json:"sha256"`
	ByteSize        int64  `json:"byteSize"`
	Profile         string `json:"profile"`
	TargetABI       int64  `json:"targetAbi"`
	CompilerVersion string `json:"compilerVersion"`
	LibraryVersion  string `json:"libraryVersion"`
}

type CheckView struct {
	CheckID      string           `json:"checkId"`
	RevisionID   string           `json:"revisionId"`
	State        string           `json:"state"`
	Diagnostics  []DiagnosticView `json:"diagnostics"`
	Artifact     *ArtifactView    `json:"artifact,omitempty"`
	CreatedAt    string           `json:"createdAt"`
	StartedAt    *string          `json:"startedAt,omitempty"`
	CompletedAt  *string          `json:"completedAt,omitempty"`
	AttemptCount int              `json:"attemptCount"`
}

type checkResultDocument struct {
	SchemaVersion string           `json:"schemaVersion"`
	Diagnostics   []DiagnosticView `json:"diagnostics"`
	Manifest      json.RawMessage  `json:"manifest,omitempty"`
}

type CheckServiceOptions struct {
	Store         *programmingstore.Store
	Runner        programmingcompiler.Runner
	Artifacts     *programmingartifact.Store
	TargetID      string
	LeaseDuration time.Duration
	Now           func() time.Time
	NewID         func() string
}

type CheckService struct {
	store         *programmingstore.Store
	runner        programmingcompiler.Runner
	artifacts     *programmingartifact.Store
	targetID      string
	leaseDuration time.Duration
	now           func() time.Time
	newID         func() string
	workerID      string
	wake          chan struct{}
	cancel        context.CancelFunc
	wg            sync.WaitGroup
	mu            sync.Mutex
}

func NewCheckService(options CheckServiceOptions) (*CheckService, error) {
	if options.Store == nil || options.Runner == nil || options.Artifacts == nil || !validText(options.TargetID, 1, 128) {
		return nil, fmt.Errorf("Programming Check dependencies/target là bắt buộc")
	}
	if options.LeaseDuration == 0 {
		options.LeaseDuration = 30 * time.Second
	}
	if options.LeaseDuration < time.Second || options.LeaseDuration > 10*time.Minute {
		return nil, fmt.Errorf("Check lease không hợp lệ")
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.NewID == nil {
		options.NewID = uuid.NewString
	}
	return &CheckService{store: options.Store, runner: options.Runner, artifacts: options.Artifacts,
		targetID: options.TargetID, leaseDuration: options.LeaseDuration, now: options.Now, newID: options.NewID,
		workerID: "check-worker-" + options.NewID(), wake: make(chan struct{}, 1)}, nil
}

func (s *CheckService) Start(parent context.Context) {
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

func (s *CheckService) Close() {
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

func (s *CheckService) RequestCheck(ctx context.Context, actor Actor, command RequestCheckCommand) (CheckAccepted, error) {
	if command.SchemaVersion != "1.0" || command.TargetProfile != checkTargetProfile || !isUUID(command.RevisionID) {
		return CheckAccepted{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return CheckAccepted{}, err
	}
	requestHash, err := semanticHash(map[string]any{"revisionId": command.RevisionID, "schemaVersion": command.SchemaVersion,
		"targetProfile": command.TargetProfile, "targetId": s.targetID})
	if err != nil {
		return CheckAccepted{}, err
	}
	revision, err := s.store.GetRevision(ctx, command.RevisionID)
	if err != nil {
		return CheckAccepted{}, err
	}
	inputHash := checkInputHash(revision, s.targetID)
	now := s.now().UTC()
	check, err := s.store.EnqueueCheck(ctx, programmingstore.EnqueueCheckParams{CheckID: s.newID(), RevisionID: command.RevisionID,
		TargetID: s.targetID, InputSHA256: inputHash, Profile: checkStoreProfile, CompilerVersion: checkCompilerVersion,
		ActorID: actor.ID, Role: actor.Role, AuditID: s.newID(), CorrelationID: command.CorrelationID, At: now,
		IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash})
	if err != nil {
		return CheckAccepted{}, err
	}
	select {
	case s.wake <- struct{}{}:
	default:
	}
	return CheckAccepted{CheckID: check.CheckID, State: check.State, StatusURL: "/api/v1/programming/checks/" + check.CheckID,
		RequestHash: hex.EncodeToString(requestHash[:]), AcceptedAt: formatTime(check.CreatedAtUTCMS),
		CorrelationID: command.CorrelationID, Replay: check.Replay}, nil
}

func (s *CheckService) GetCheck(ctx context.Context, checkID string) (CheckView, error) {
	if !isUUID(checkID) {
		return CheckView{}, ErrInvalidRequest
	}
	check, err := s.store.GetCheck(ctx, checkID)
	if err != nil {
		return CheckView{}, err
	}
	return checkView(check)
}

func (s *CheckService) ProcessNext(ctx context.Context) (bool, error) {
	failedResult, _ := json.Marshal(checkResultDocument{SchemaVersion: "1.0", Diagnostics: []DiagnosticView{workerDiagnostic("ST-WORKER-CRASH")}})
	if _, err := s.store.FailExhaustedChecks(ctx, s.now(), s.newID, failedResult); err != nil {
		return false, err
	}
	check, claimed, err := s.store.ClaimCheck(ctx, s.workerID, s.now(), s.leaseDuration)
	if err != nil || !claimed {
		return claimed, err
	}
	revision, err := s.store.GetRevision(ctx, check.RevisionID)
	if err != nil {
		return true, err
	}
	input, scopeDiagnostic := compilerInput(revision)
	if scopeDiagnostic != nil {
		return true, s.complete(ctx, check, "FAILED", []DiagnosticView{*scopeDiagnostic}, nil)
	}
	result, err := s.runner.Compile(ctx, input)
	if errors.Is(err, programmingcompiler.ErrTimeout) {
		return true, s.complete(ctx, check, "TIMED_OUT", []DiagnosticView{workerDiagnostic("ST-WORKER-TIMEOUT")}, nil)
	}
	if err != nil {
		// Crash/output lỗi giữ RUNNING cho tới lease expiry để cùng input được
		// thử đúng một lần nữa. Lần hai vẫn chết sẽ được FailExhaustedChecks đóng.
		return true, err
	}
	if !result.OK {
		diagnostics := make([]DiagnosticView, 0, len(result.Diagnostics))
		for _, item := range result.Diagnostics {
			diagnostics = append(diagnostics, compilerDiagnostic(item))
		}
		if len(diagnostics) == 0 {
			diagnostics = append(diagnostics, workerDiagnostic("ST-CLI-IO"))
		}
		return true, s.complete(ctx, check, "FAILED", diagnostics, nil)
	}
	relative, err := s.artifacts.Put(result.ArtifactSHA256, result.Artifact)
	if err != nil {
		return true, err
	}
	if err := s.artifacts.Verify(relative, result.ArtifactSHA256, int64(len(result.Artifact))); err != nil {
		return true, err
	}
	artifact := &programmingstore.Artifact{ArtifactID: s.newID(), RevisionID: check.RevisionID, CheckID: check.CheckID,
		SchemaVersion: result.ArtifactSchemaVersion, Profile: checkStoreProfile, TargetABI: result.TargetABI,
		CompilerVersion: result.CompilerVersion, LibraryVersion: result.LibraryVersion, ByteSize: int64(len(result.Artifact)),
		SHA256: result.ArtifactSHA256, RelativePath: relative, IntegrityMode: result.IntegrityMode}
	return true, s.complete(ctx, check, "PASSED", []DiagnosticView{}, &completion{artifact: artifact, manifest: result.Manifest})
}

type completion struct {
	artifact *programmingstore.Artifact
	manifest json.RawMessage
}

func (s *CheckService) complete(ctx context.Context, check programmingstore.Check, state string, diagnostics []DiagnosticView, success *completion) error {
	result := checkResultDocument{SchemaVersion: "1.0", Diagnostics: diagnostics}
	var artifact *programmingstore.Artifact
	if success != nil {
		result.Manifest = success.manifest
		artifact = success.artifact
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = s.store.CompleteCheck(ctx, programmingstore.CompleteCheckParams{CheckID: check.CheckID, LeaseOwner: s.workerID,
		State: state, ResultJSON: raw, Artifact: artifact, AuditID: s.newID(), At: s.now()})
	return err
}

func (s *CheckService) run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		for {
			processed, _ := s.ProcessNext(ctx)
			if !processed || ctx.Err() != nil {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		case <-ticker.C:
		}
	}
}

func checkInputHash(revision programmingstore.RevisionSnapshot, targetID string) [32]byte {
	digest := sha256.New()
	_, _ = digest.Write(revision.Revision.ManifestSHA256[:])
	for _, object := range revision.Objects {
		_, _ = digest.Write(object.PayloadSHA256[:])
	}
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write([]byte(targetID + "\x00" + checkStoreProfile + "\x00" + checkCompilerVersion))
	var output [32]byte
	copy(output[:], digest.Sum(nil))
	return output
}

func compilerInput(revision programmingstore.RevisionSnapshot) (programmingcompiler.Input, *DiagnosticView) {
	var programs []programmingstore.RevisionObject
	for _, object := range revision.Objects {
		switch object.Kind {
		case "PROGRAM":
			programs = append(programs, object)
		case "FUNCTION", "FUNCTION_BLOCK":
			// User POU chưa được compiler nhận: T59-101..105 mở lane này.
			diagnostic := scopeDiagnostic(object.ObjectID, domain.MaxUserPou)
			return programmingcompiler.Input{}, &diagnostic
		}
	}
	// Trần capacity sản phẩm lấy từ profile, không phải hằng viết trong code.
	// DDD §5.2 dành riêng `PRG-ERR-PROGRAM-LIMIT-001` cho vi phạm trần package —
	// không gộp vào `PRG-ERR-SCOPE-001` như trước.
	if len(programs) == 0 || len(programs) > domain.MaxProgramsTotal {
		diagnostic := programLimitDiagnostic(len(programs), domain.MaxProgramsTotal)
		return programmingcompiler.Input{}, &diagnostic
	}
	// Trong trần capacity nhưng pipeline compiler hiện chỉ dựng được một Program
	// mỗi lần chạy; multi-Program package là T59-302/T59-305. Đây là giới hạn
	// giai đoạn của pipeline, KHÔNG phải capacity sản phẩm — nên nó được báo
	// riêng và không ghi đè con số 32 ở nhánh trên.
	if len(programs) != 1 {
		diagnostic := scopeDiagnostic("", 1)
		return programmingcompiler.Input{}, &diagnostic
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(programs[0].PayloadJSON, &payload); err != nil {
		diagnostic := scopeDiagnostic(programs[0].ObjectID, 0)
		return programmingcompiler.Input{}, &diagnostic
	}
	// Document v2 (T59-301) đặt identity ở `objectId` và mã nguồn ở `source`;
	// v1 dùng `programId`/`document`. Đọc cả hai tên là điều kiện để một Revision
	// đã seal TRƯỚC khi nâng model vẫn Check lại được — bỏ đường v1 là làm mất
	// khả năng kiểm lại lịch sử của chính mình.
	var programID, language string
	identity := payload["objectId"]
	if len(identity) == 0 {
		identity = payload["programId"]
	}
	document := payload["source"]
	if len(document) == 0 {
		document = payload["document"]
	}
	if json.Unmarshal(identity, &programID) != nil || json.Unmarshal(payload["language"], &language) != nil ||
		programID != programs[0].ObjectID || (language != "ST" && language != "FBD") || len(document) == 0 {
		diagnostic := scopeDiagnostic(programs[0].ObjectID, 0)
		return programmingcompiler.Input{}, &diagnostic
	}
	var source []byte
	var text string
	if json.Unmarshal(document, &text) == nil {
		source = []byte(text)
	} else if language == "FBD" {
		var value any
		if json.Unmarshal(document, &value) != nil {
			diagnostic := scopeDiagnostic(programID, 0)
			return programmingcompiler.Input{}, &diagnostic
		}
		source, _ = json.Marshal(value)
	} else {
		diagnostic := scopeDiagnostic(programID, 0)
		return programmingcompiler.Input{}, &diagnostic
	}
	if len(source) == 0 || len(source) > domain.MaxSourceBytes {
		diagnostic := scopeDiagnostic(programID, domain.MaxSourceBytes)
		return programmingcompiler.Input{}, &diagnostic
	}
	ioMap, diagnostic := ioMapFromRevision(revision, programID)
	if diagnostic != nil {
		return programmingcompiler.Input{}, diagnostic
	}
	return programmingcompiler.Input{SourceID: programID, Language: language, Source: source, IoMap: ioMap}, nil
}

// ioMapFromRevision dựng Binding Manifest (F-PROG-ASBUILT-013/D-07,
// REV-PROG-ASBUILT-GAP-2026-08-14 §4) từ các RevisionObject kind VARIABLE/
// BINDING của revision đã seal — đây là dữ liệu Mapping tab đã ghi qua
// upsertVariable/upsertBinding (draft.go), KHÔNG phải nguồn mới. Trước bản vá
// này compilerInput() chưa từng đọc hai collection này nên io_bindings luôn
// rỗng trong artifact bất kể Mapping tab cấu hình đúng đến đâu (F-013).
//
// Chỉ biến class INPUT/OUTPUT mới tham gia io_map (khớp VAR_INPUT/VAR_OUTPUT
// ST) — biến class khác nhưng vẫn có binding là dữ liệu hỏng (không lẽ xảy ra
// qua Mapping tab UI hiện tại, nhưng payload Draft không có schema validation
// chặt cho field này ở draft.go nên vẫn phải tự kiểm ở đây, fail-closed thay
// vì gửi io_map sai lặng lẽ cho compiler). category/writable/pointId gửi
// nguyên trạng cho compiler tự reject (VP/MB_RTU, sai kiểu, trùng...) — không
// lặp logic validate ở BE, `resolve_io_bindings()` là authority duy nhất.
func ioMapFromRevision(revision programmingstore.RevisionSnapshot, programID string) ([]programmingcompiler.IoMapEntry, *DiagnosticView) {
	type variableInfo struct {
		name      string
		programID string
		class     string
		dataType  string
	}
	// Document v2 (T59-301) đặt biến vào `locals` của chính POU thay vì một
	// Revision object kind VARIABLE riêng. Đọc từ POU giữ ĐÚNG MỘT nguồn: nhân
	// bản biến ra object thứ hai chỉ để lớp này đọc được là cách hai bản trôi
	// khỏi nhau ngay lần sửa sau.
	variables := make(map[string]variableInfo)
	for _, object := range revision.Objects {
		if object.Kind != "PROGRAM" && object.Kind != "FUNCTION" && object.Kind != "FUNCTION_BLOCK" {
			continue
		}
		var payload struct {
			ObjectID string `json:"objectId"`
			Locals   []struct {
				VariableID string `json:"variableId"`
				ProgramID  string `json:"programId"`
				Name       string `json:"name"`
				Type       string `json:"type"`
				Class      string `json:"class"`
			} `json:"locals"`
		}
		if err := json.Unmarshal(object.PayloadJSON, &payload); err != nil {
			diagnostic := scopeDiagnostic(programID, 0)
			return nil, &diagnostic
		}
		for _, local := range payload.Locals {
			if local.VariableID == "" || local.Name == "" || local.Type == "" {
				diagnostic := scopeDiagnostic(programID, 0)
				return nil, &diagnostic
			}
			owner := local.ProgramID
			if owner == "" {
				owner = object.ObjectID
			}
			variables[local.VariableID] = variableInfo{name: local.Name, programID: owner,
				class: local.Class, dataType: local.Type}
		}
	}
	var entries []programmingcompiler.IoMapEntry
	for _, object := range revision.Objects {
		if object.Kind != "BINDING" {
			continue
		}
		var payload struct {
			BindingID  string `json:"bindingId"`
			VariableID string `json:"variableId"`
			Point      struct {
				Category string `json:"category"`
				PointID  string `json:"pointId"`
				DeviceID string `json:"deviceId"`
			} `json:"point"`
			DataType string `json:"dataType"`
			Unit     string `json:"unit"`
			Writable bool   `json:"writable"`
		}
		if err := json.Unmarshal(object.PayloadJSON, &payload); err != nil || payload.BindingID != object.ObjectID ||
			payload.Point.PointID == "" || payload.Point.Category == "" || payload.DataType == "" {
			diagnostic := scopeDiagnostic(programID, 0)
			return nil, &diagnostic
		}
		variable, found := variables[payload.VariableID]
		if !found || variable.programID != programID {
			diagnostic := scopeDiagnostic(programID, 0)
			return nil, &diagnostic
		}
		var direction string
		switch variable.class {
		case "INPUT":
			direction = "input"
		case "OUTPUT":
			direction = "output"
		default:
			diagnostic := scopeDiagnostic(programID, 0)
			return nil, &diagnostic
		}
		entries = append(entries, programmingcompiler.IoMapEntry{
			Variable: variable.name, Direction: direction, PointID: payload.Point.PointID,
			Type: variable.dataType, Unit: payload.Unit, Category: payload.Point.Category,
			DeviceID: payload.Point.DeviceID, Writable: payload.Writable,
		})
	}
	return entries, nil
}

func compilerDiagnostic(item programmingcompiler.Diagnostic) DiagnosticView {
	code := domain.MapComponentError("compiler", item.Code)
	public := domain.NewPublicError(code)
	location := map[string]any{"programId": item.SourceID, "line": item.Line, "column": item.Column, "length": item.Length}
	args := map[string]any(nil)
	if code == domain.ErrCheck {
		args = map[string]any{"line": item.Line, "column": item.Column, "length": item.Length}
	}
	return DiagnosticView{Code: string(code), DetailCode: item.Code, Severity: "ERROR", MessageKey: public.MessageKey, Location: location, Args: domain.SanitizeErrorArgs(code, args)}
}

// scopeDiagnostic báo vi phạm capacity. `limit` phải là trần thật bị vượt, lấy
// từ profile machine-readable — literal `1` cũ nói sai capacity sản phẩm (32).
// `limit <= 0` nghĩa là từ chối không do trần (payload sai dạng): khi đó bỏ hẳn
// arg `limit` thay vì bịa một con số cho người đọc lỗi.
// programLimitDiagnostic báo vượt trần capacity cấp PACKAGE. `ST-LIM-009` là
// detail code riêng cho trần này, tách khỏi `ST-CLI-LIMIT` vốn là trần cấp một
// Program, để người đọc log phân biệt được hai loại "quá lớn" khác nhau.
func programLimitDiagnostic(actual, limit int) DiagnosticView {
	public := domain.NewPublicError(domain.ErrProgramLimit)
	return DiagnosticView{Code: string(domain.ErrProgramLimit), DetailCode: "ST-LIM-009", Severity: "ERROR",
		MessageKey: public.MessageKey, Location: map[string]any{},
		Args: map[string]any{"profile": checkTargetProfile, "limit": limit, "actual": actual}}
}

func scopeDiagnostic(programID string, limit int) DiagnosticView {
	public := domain.NewPublicError(domain.ErrScope)
	args := map[string]any{"profile": checkTargetProfile}
	if limit > 0 {
		args["limit"] = limit
	}
	return DiagnosticView{Code: string(domain.ErrScope), DetailCode: "ST-CLI-LIMIT", Severity: "ERROR", MessageKey: public.MessageKey,
		Location: map[string]any{"programId": programID}, Args: args}
}

func workerDiagnostic(detail string) DiagnosticView {
	code := domain.MapComponentError("compiler", detail)
	public := domain.NewPublicError(code)
	return DiagnosticView{Code: string(code), DetailCode: detail, Severity: "ERROR", MessageKey: public.MessageKey, Location: map[string]any{}}
}

func checkView(check programmingstore.Check) (CheckView, error) {
	view := CheckView{CheckID: check.CheckID, RevisionID: check.RevisionID, State: check.State, Diagnostics: []DiagnosticView{},
		CreatedAt: formatTime(check.CreatedAtUTCMS), AttemptCount: check.AttemptCount}
	if check.StartedAtUTCMS != nil {
		value := formatTime(*check.StartedAtUTCMS)
		view.StartedAt = &value
	}
	if check.CompletedAtUTCMS != nil {
		value := formatTime(*check.CompletedAtUTCMS)
		view.CompletedAt = &value
	}
	if len(check.ResultJSON) > 0 {
		var result checkResultDocument
		if err := decodeStrict(check.ResultJSON, &result); err != nil || result.SchemaVersion != "1.0" {
			return CheckView{}, fmt.Errorf("decode Check result: %w", err)
		}
		view.Diagnostics = result.Diagnostics
	}
	if check.Artifact != nil {
		a := check.Artifact
		view.Artifact = &ArtifactView{ArtifactID: a.ArtifactID, SHA256: hex.EncodeToString(a.SHA256[:]), ByteSize: a.ByteSize, Profile: a.Profile,
			TargetABI: a.TargetABI, CompilerVersion: a.CompilerVersion, LibraryVersion: a.LibraryVersion}
	}
	return view, nil
}
