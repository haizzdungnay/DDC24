package application

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"

	"mkddc-web/internal/programming/coreipc"
	programmingstore "mkddc-web/internal/programming/store"
)

// RuntimeStatusReader chỉ cần Call — đường đọc capabilities/runtime không bao
// giờ retry mù bằng Reconcile (đó là hành vi riêng của operation lifecycle).
type RuntimeStatusReader interface {
	Call(context.Context, coreipc.Request) (coreipc.Response, error)
}

type RuntimeServiceOptions struct {
	Runtime      RuntimeStatusReader
	Store        *programmingstore.Store
	Catalog      PointCatalogProvider
	Monitor      MonitorSnapshotProvider
	Overrides    OverrideProvider
	ControllerID string
	CursorSecret []byte
	Now          func() time.Time
	NewID        func() string
	// WorkspaceModes được TIÊM vào chứ không tự dựng: capability Simulation
	// thuộc supervisor R3, và RuntimeService không có việc gì biết về worker.
	WorkspaceModes func() WorkspaceModesView
}

// RuntimeService chiếu trạng thái authoritative của Core (CAPABILITIES/STATUS)
// thành hai view chỉ-đọc cho FE. Nó không giữ state và không suy đoán: mất kết
// nối Core luôn trả `UNAVAILABLE`/`UNKNOWN`, không bao giờ mặc định coi là an
// toàn hoặc đang chạy (RSK-PROG-010).
type RuntimeService struct {
	runtime      RuntimeStatusReader
	store        *programmingstore.Store
	catalog      PointCatalogProvider
	monitor      MonitorSnapshotProvider
	overrides    OverrideProvider
	controllerID string
	cursorSecret []byte
	now          func() time.Time
	newID        func() string
	traces       *runtimeTraceStore

	workspaceModesFn func() WorkspaceModesView
}

func NewRuntimeService(options RuntimeServiceOptions) (*RuntimeService, error) {
	if options.Runtime == nil {
		return nil, fmt.Errorf("Programming runtime service cần RuntimeStatusReader")
	}
	if options.ControllerID == "" {
		return nil, fmt.Errorf("Programming runtime service cần controllerId")
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	newID := options.NewID
	if newID == nil {
		newID = func() string { return uuid.NewString() }
	}
	return &RuntimeService{
		runtime: options.Runtime, store: options.Store, catalog: options.Catalog, monitor: options.Monitor, overrides: options.Overrides,
		controllerID: options.ControllerID, cursorSecret: options.CursorSecret, now: now, newID: newID,
		traces: newRuntimeTraceStore(), workspaceModesFn: options.WorkspaceModes,
	}, nil
}

const runtimeCallTimeout = 2 * time.Second

// CapabilitiesView khớp field-for-field schema `ProgrammingCapabilities` của
// OpenAPI (contracts/openapi/openapi.yaml) — Rev A limits là hằng số profile,
// không đọc từ request hay suy từ browser.
type CapabilitiesView struct {
	SchemaVersion string             `json:"schemaVersion"`
	Profile       string             `json:"profile"`
	TargetState   string             `json:"targetState"`
	Languages     []string           `json:"languages"`
	Types         []string           `json:"types"`
	TaskPeriodsMs []int              `json:"taskPeriodsMs"`
	Limits        CapabilitiesLimits `json:"limits"`
	// WorkspaceModes là bổ sung ADDITIVE của PGM-02 (`DDD-SW-PGM02-WORKSPACE-001`
	// §5.5). Vắng mặt nghĩa là server đời cũ, và FE phải coi mọi mode mới là
	// UNAVAILABLE thay vì đoán — đó là lý do nó dùng con trỏ chứ không phải
	// struct rỗng.
	WorkspaceModes *WorkspaceModesView `json:"workspaceModes,omitempty"`
}

// WorkspaceModesView nói CHÍNH XÁC những gì controller này làm được, không nói
// increment nào đang chạy. FE đọc nó để quyết định hiện hay ẩn từng chế độ.
type WorkspaceModesView struct {
	ContractVersion string               `json:"contractVersion"`
	Edit            WorkspaceModeSupport `json:"edit"`
	Live            WorkspaceModeSupport `json:"live"`
	Simulation      SimulationCapability `json:"simulation"`
}

type WorkspaceModeSupport struct {
	Supported bool `json:"supported"`
}

type CapabilitiesLimits struct {
	ProjectsPerController int `json:"projectsPerController"`
	Tasks                 int `json:"tasks"`
	StSourceBytes         int `json:"stSourceBytes"`
	Variables             int `json:"variables"`
	Statements            int `json:"statements"`
	FbdBlocks             int `json:"fbdBlocks"`
	FbdConnections        int `json:"fbdConnections"`
	ArtifactBytes         int `json:"artifactBytes"`
	Bindings              int `json:"bindings"`
}

// RuntimeView khớp schema `ProgrammingRuntime`. SafeState và Task lấy từ cùng
// snapshot cuối-scan do Core công bố; khi nguồn monitor lỗi, trạng thái phải hạ
// về UNAVAILABLE/UNKNOWN thay vì suy đoán hệ thống đang khỏe.
type RuntimeView struct {
	SchemaVersion    string  `json:"schemaVersion"`
	ControllerID     string  `json:"controllerId"`
	ProducerState    string  `json:"producerState"`
	ActiveRevisionID *string `json:"activeRevisionId"`
	LKGRevisionID    *string `json:"lkgRevisionId"`
	TaskState        string  `json:"taskState"`
	SafeState        bool    `json:"safeState"`
	// SafeStateNoControllerOnly: true khi SafeState chỉ do chưa có Program
	// nào đang thật sự điều khiển output (trigger T7 đơn độc ở Core), không
	// có lỗi I/O/stale/overrun thật đi kèm — Commission một Program có output
	// sẽ tự giải quyết, không phải một fault cần khắc phục trước khi Commission.
	SafeStateNoControllerOnly bool             `json:"safeStateNoControllerOnly"`
	ObservedAt                string           `json:"observedAt"`
	Task                      *TaskMetricsView `json:"task"`
}

func (s *RuntimeService) GetCapabilities(ctx context.Context) (CapabilitiesView, error) {
	target := "READY"
	if _, err := s.callStatus(ctx); err != nil {
		target = "UNAVAILABLE"
	}
	return CapabilitiesView{
		SchemaVersion: "1.0",
		Profile:       "MK-DDC-24-REV-A",
		TargetState:   target,
		Languages:     []string{"ST", "FBD"},
		Types:         []string{"BOOL", "INT", "DINT", "UINT", "REAL", "TIME"},
		TaskPeriodsMs: []int{1000, 5000, 30000},
		Limits: CapabilitiesLimits{
			ProjectsPerController: 1, Tasks: 1, StSourceBytes: 65536, Variables: 512,
			Statements: 4096, FbdBlocks: 256, FbdConnections: 512, ArtifactBytes: 1048576, Bindings: 256,
		},
		WorkspaceModes: s.workspaceModes(),
	}, nil
}

// workspaceModes trả nil khi chưa được tiêm, để phản hồi giữ nguyên hình dạng
// cũ thay vì công bố một capability rỗng mà FE có thể đọc nhầm thành "đã hỏi và
// câu trả lời là không".
func (s *RuntimeService) workspaceModes() *WorkspaceModesView {
	if s == nil || s.workspaceModesFn == nil {
		return nil
	}
	view := s.workspaceModesFn()
	return &view
}

func (s *RuntimeService) GetRuntime(ctx context.Context) (RuntimeView, error) {
	observedAt := s.now().UTC().Format(time.RFC3339Nano)
	response, err := s.callStatus(ctx)
	if err != nil {
		return RuntimeView{
			SchemaVersion: "1.0", ControllerID: s.controllerID, ProducerState: "UNAVAILABLE", TaskState: "UNKNOWN",
			SafeState: false, ObservedAt: observedAt,
		}, nil
	}
	taskState := "UNKNOWN"
	var payload runtimeImpactPayload
	if decodeErr := coreipc.DecodePayload(response.Payload, &payload); decodeErr == nil {
		if payload.ProducerMode == "PROGRAM_ONLY" {
			taskState = "RUNNING"
		} else {
			taskState = "STOPPED"
		}
	}
	producerState := "READY"
	safeState := false
	safeStateNoControllerOnly := false
	var task *TaskMetricsView
	if s.monitor != nil {
		truth, monitorErr := s.monitor.ReadProgrammingMonitorSnapshot(ctx)
		if monitorErr != nil {
			producerState = "DEGRADED"
		} else {
			safeState = truth.SafeState
			safeStateNoControllerOnly = truth.SafeStateNoControllerOnly
			task = truth.Task
			if task != nil {
				taskState = task.State
			}
			if truth.ObservedAt != "" {
				observedAt = truth.ObservedAt
			}
		}
	}
	return RuntimeView{
		SchemaVersion:             "1.0",
		ControllerID:              s.controllerID,
		ProducerState:             producerState,
		ActiveRevisionID:          firstNonNil(payload.ActiveRevisionID, response.ActiveRevisionID),
		LKGRevisionID:             firstNonNil(payload.LKGRevisionID, response.LKGRevisionID),
		TaskState:                 taskState,
		SafeState:                 safeState,
		SafeStateNoControllerOnly: safeStateNoControllerOnly,
		ObservedAt:                observedAt,
		Task:                      task,
	}, nil
}

type RuntimeSignalView struct {
	SignalID          *string `json:"signalId"`
	Name              string  `json:"name"`
	ProducerProgramID string  `json:"producerProgramId"`
	DataType          string  `json:"dataType"`
	Unit              *string `json:"unit"`
	Value             any     `json:"value"`
	Valid             bool    `json:"valid"`
	Quality           string  `json:"quality"`
	Freshness         string  `json:"freshness"`
	StalePolicy       string  `json:"stalePolicy"`
	FreshnessMS       uint32  `json:"freshnessMs"`
	// Chuỗi thập phân giữ nguyên uint64 qua JSON/JavaScript. Monotonic ns
	// vượt Number.MAX_SAFE_INTEGER sau khoảng 104 ngày uptime.
	PublishedAtMonoNS string `json:"publishedAtMonoNs"`
	Generation        string `json:"generation"`
	DefinitionState   string `json:"definitionState"`
}

type RuntimeSignalPage struct {
	SchemaVersion    string              `json:"schemaVersion"`
	ProducerState    string              `json:"producerState"`
	ActiveRevisionID *string             `json:"activeRevisionId"`
	ObservedAt       string              `json:"observedAt"`
	Items            []RuntimeSignalView `json:"items"`
}

type revisionSignalDefinition struct {
	SignalID           string  `json:"signalId"`
	Name               string  `json:"name"`
	Type               string  `json:"type"`
	Unit               *string `json:"unit"`
	PublisherProgramID string  `json:"publisherProgramId"`
	FreshnessMS        uint32  `json:"freshnessMs"`
	StalePolicy        string  `json:"stalePolicy"`
}

// GetSignals ghép identity bền vững từ Revision với value/quality/freshness
// authoritative của Core. Hai nguồn lệch nhau không được che bằng cách bỏ dòng:
// dòng vẫn hiện nhưng `valid=false` + `definitionState=MISMATCH/CORE_ONLY`.
func (s *RuntimeService) GetSignals(ctx context.Context) (RuntimeSignalPage, error) {
	observedAt := s.now().UTC().Format(time.RFC3339Nano)
	response, err := s.callStatus(ctx)
	if err != nil {
		return RuntimeSignalPage{SchemaVersion: "1.0", ProducerState: "UNAVAILABLE",
			ObservedAt: observedAt, Items: []RuntimeSignalView{}}, nil
	}
	var payload runtimeImpactPayload
	if err := coreipc.DecodePayload(response.Payload, &payload); err != nil {
		return RuntimeSignalPage{}, err
	}
	activeRevisionID := firstNonNil(payload.ActiveRevisionID, response.ActiveRevisionID)
	producerState := "READY"
	// Core minor 2 vẫn cho phép BE đọc bốn field STATUS nền, nhưng
	// không hề có snapshot signal. Gọi nó READY sẽ đánh đồng "không
	// có signal" với "không đọc được signal".
	if response.ProtocolMinor < 3 {
		producerState = "DEGRADED"
	}
	page := RuntimeSignalPage{SchemaVersion: "1.0", ProducerState: producerState,
		ActiveRevisionID: activeRevisionID, ObservedAt: observedAt, Items: []RuntimeSignalView{}}
	if activeRevisionID == nil || s.store == nil {
		return page, nil
	}
	revision, err := s.store.GetRevision(ctx, *activeRevisionID)
	if err != nil {
		return RuntimeSignalPage{}, err
	}
	definitions := make(map[string]revisionSignalDefinition)
	for _, object := range revision.Objects {
		if object.Kind != "SIGNAL" {
			continue
		}
		var definition revisionSignalDefinition
		if err := json.Unmarshal(object.PayloadJSON, &definition); err != nil {
			return RuntimeSignalPage{}, fmt.Errorf("decode Published Signal runtime: %w", err)
		}
		definitions[definition.Name] = definition
	}
	seen := make(map[string]struct{}, len(payload.Signals))
	for _, signal := range payload.Signals {
		definition, matched := definitions[signal.Name]
		view := RuntimeSignalView{Name: signal.Name, ProducerProgramID: signal.ProducerProgramID,
			DataType: signal.DataType, Value: signal.Value, Valid: signal.Valid,
			Quality: signal.Quality, Freshness: signal.Freshness, StalePolicy: signal.StalePolicy,
			FreshnessMS: signal.FreshnessMS, PublishedAtMonoNS: strconv.FormatUint(signal.PublishedAtMonoNS, 10),
			Generation: strconv.FormatUint(signal.Generation, 10), DefinitionState: "CORE_ONLY"}
		if matched {
			id := definition.SignalID
			view.SignalID = &id
			view.Unit = definition.Unit
			view.DefinitionState = "MATCHED"
			if definition.PublisherProgramID != signal.ProducerProgramID || definition.Type != signal.DataType ||
				definition.FreshnessMS != signal.FreshnessMS || definition.StalePolicy != signal.StalePolicy {
				view.DefinitionState = "MISMATCH"
				view.Valid, view.Value, view.Quality, view.Freshness = false, nil, "BAD", "UNAVAILABLE"
			}
		}
		if !signal.Valid {
			view.Value = nil
		}
		page.Items = append(page.Items, view)
		seen[signal.Name] = struct{}{}
	}
	for name, definition := range definitions {
		if _, ok := seen[name]; ok {
			continue
		}
		id := definition.SignalID
		page.Items = append(page.Items, RuntimeSignalView{SignalID: &id, Name: name,
			ProducerProgramID: definition.PublisherProgramID, DataType: definition.Type,
			Unit: definition.Unit, Value: nil, Valid: false, Quality: "BAD", Freshness: "UNAVAILABLE",
			StalePolicy: definition.StalePolicy, FreshnessMS: definition.FreshnessMS,
			PublishedAtMonoNS: "0", Generation: "0", DefinitionState: "REVISION_ONLY"})
	}
	sort.Slice(page.Items, func(left, right int) bool { return page.Items[left].Name < page.Items[right].Name })
	return page, nil
}

func firstNonNil(preferred, fallback *string) *string {
	if preferred != nil {
		return preferred
	}
	return fallback
}

// AuditView chiếu một `AuditRecord` đã sanitize cho FE — không lộ
// `details_json` thô (có thể chứa allowlist field nội bộ chưa được duyệt hiển
// thị); Rev A chỉ lộ trường định danh/kết quả theo đúng UX §16.1.4
// `RecentEngineeringTimeline`.
type AuditView struct {
	AuditID       string `json:"auditId"`
	Sequence      int64  `json:"sequence"`
	ActorID       string `json:"actorId"`
	Role          string `json:"role"`
	Action        string `json:"action"`
	TargetType    string `json:"targetType"`
	TargetID      string `json:"targetId"`
	RevisionID    string `json:"revisionId,omitempty"`
	OperationID   string `json:"operationId,omitempty"`
	OccurredAt    string `json:"occurredAt"`
	ResultCode    string `json:"resultCode"`
	CorrelationID string `json:"correlationId"`
}

type AuditPage struct {
	Items      []AuditView `json:"items"`
	NextCursor *string     `json:"nextCursor,omitempty"`
}

// ListAudit trả trang audit mới nhất trước. Cursor opaque HMAC theo cùng mẫu
// `ProjectService.encodeCursor` — không phải OFFSET, tránh trôi trang khi có
// ghi audit mới xen giữa hai lần gọi (đúng bất biến IFSPEC-PROG-001 §11.1).
func (s *RuntimeService) ListAudit(ctx context.Context, encodedCursor string, limit int) (AuditPage, error) {
	if s.store == nil {
		return AuditPage{Items: []AuditView{}}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var before int64
	if encodedCursor != "" {
		decoded, err := s.decodeAuditCursor(encodedCursor)
		if err != nil {
			return AuditPage{}, err
		}
		before = decoded
	}
	records, err := s.store.ListAuditRecords(ctx, before, limit)
	if err != nil {
		return AuditPage{}, err
	}
	page := AuditPage{Items: make([]AuditView, 0, len(records))}
	for _, record := range records {
		page.Items = append(page.Items, AuditView{
			AuditID: record.AuditID, Sequence: record.Sequence, ActorID: record.ActorID, Role: record.Role,
			Action: record.Action, TargetType: record.TargetType, TargetID: record.TargetID,
			RevisionID: record.RevisionID, OperationID: record.OperationID,
			OccurredAt: time.UnixMilli(record.OccurredAtUTCMS).UTC().Format(time.RFC3339Nano),
			ResultCode: record.ResultCode, CorrelationID: record.CorrelationID,
		})
	}
	if len(records) == limit {
		last := records[len(records)-1]
		encoded := s.encodeAuditCursor(last.Sequence)
		page.NextCursor = &encoded
	}
	return page, nil
}

func (s *RuntimeService) encodeAuditCursor(beforeSequence int64) string {
	var raw [8]byte
	binary.BigEndian.PutUint64(raw[:], uint64(beforeSequence))
	mac := hmac.New(sha256.New, s.cursorSecret)
	mac.Write(raw[:])
	signed := append(raw[:], mac.Sum(nil)...)
	return base64.RawURLEncoding.EncodeToString(signed)
}

func (s *RuntimeService) decodeAuditCursor(encoded string) (int64, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(raw) != 8+sha256.Size {
		return 0, ErrInvalidCursor
	}
	mac := hmac.New(sha256.New, s.cursorSecret)
	mac.Write(raw[:8])
	if !hmac.Equal(raw[8:], mac.Sum(nil)) {
		return 0, ErrInvalidCursor
	}
	return int64(binary.BigEndian.Uint64(raw[:8])), nil
}

type OperationPage struct {
	Items      []OperationView `json:"items"`
	NextCursor *string         `json:"nextCursor,omitempty"`
}

// ListOperations — TASK-PROG-505, tab "Phiên bản & Bảo trì" của PGM-04. Mọi
// state (kể cả terminal), mới nhất trước; cursor HMAC cùng mẫu `ListAudit`.
// Dùng lại `operationView()`/`programmingstore.Operation` (cùng package) —
// không tạo state machine hiển thị thứ hai cho operation.
func (s *RuntimeService) ListOperations(ctx context.Context, encodedCursor string, limit int) (OperationPage, error) {
	if s.store == nil {
		return OperationPage{Items: []OperationView{}}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var beforeAt int64
	var beforeID string
	if encodedCursor != "" {
		decoded, id, err := s.decodeOperationCursor(encodedCursor)
		if err != nil {
			return OperationPage{}, err
		}
		beforeAt, beforeID = decoded, id
	}
	operations, err := s.store.ListOperations(ctx, beforeAt, beforeID, limit)
	if err != nil {
		return OperationPage{}, err
	}
	page := OperationPage{Items: make([]OperationView, 0, len(operations))}
	for _, operation := range operations {
		page.Items = append(page.Items, operationView(operation))
	}
	if len(operations) == limit {
		last := operations[len(operations)-1]
		encoded := s.encodeOperationCursor(last.UpdatedAtUTCMS, last.OperationID)
		page.NextCursor = &encoded
	}
	return page, nil
}

func (s *RuntimeService) encodeOperationCursor(beforeUpdatedAtUTCMS int64, beforeOperationID string) string {
	payload := fmt.Sprintf("%d\x00%s", beforeUpdatedAtUTCMS, beforeOperationID)
	mac := hmac.New(sha256.New, s.cursorSecret)
	mac.Write([]byte(payload))
	signed := append([]byte(payload), mac.Sum(nil)...)
	return base64.RawURLEncoding.EncodeToString(signed)
}

func (s *RuntimeService) decodeOperationCursor(encoded string) (int64, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(raw) <= sha256.Size {
		return 0, "", ErrInvalidCursor
	}
	payload, signature := raw[:len(raw)-sha256.Size], raw[len(raw)-sha256.Size:]
	mac := hmac.New(sha256.New, s.cursorSecret)
	mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return 0, "", ErrInvalidCursor
	}
	parts := bytesSplitOnce(payload, 0x00)
	if parts == nil {
		return 0, "", ErrInvalidCursor
	}
	updatedAt, convErr := strconv.ParseInt(string(parts[0]), 10, 64)
	if convErr != nil {
		return 0, "", ErrInvalidCursor
	}
	return updatedAt, string(parts[1]), nil
}

func bytesSplitOnce(input []byte, separator byte) [][]byte {
	for index, value := range input {
		if value == separator {
			return [][]byte{input[:index], input[index+1:]}
		}
	}
	return nil
}

func (s *RuntimeService) callStatus(ctx context.Context) (coreipc.Response, error) {
	callCtx, cancel := context.WithTimeout(ctx, runtimeCallTimeout)
	defer cancel()
	request := coreipc.NewRequest(coreipc.ActionStatus, uuidBytes(s.newID()), nil, s.controllerID, "",
		s.newID(), coreipc.FutureDeadline(runtimeCallTimeout), coreipc.EmptyPayload())
	response, err := s.runtime.Call(callCtx, request)
	if err != nil {
		return coreipc.Response{}, err
	}
	if response.Result != coreipc.ResultOK {
		return coreipc.Response{}, fmt.Errorf("core status result=%s", response.Result)
	}
	return response, nil
}
