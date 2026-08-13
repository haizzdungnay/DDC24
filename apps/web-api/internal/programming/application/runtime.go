package application

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
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
	ControllerID string
	CursorSecret []byte
	Now          func() time.Time
	NewID        func() string
}

// RuntimeService chiếu trạng thái authoritative của Core (CAPABILITIES/STATUS)
// thành hai view chỉ-đọc cho FE. Nó không giữ state và không suy đoán: mất kết
// nối Core luôn trả `UNAVAILABLE`/`UNKNOWN`, không bao giờ mặc định coi là an
// toàn hoặc đang chạy (RSK-PROG-010).
type RuntimeService struct {
	runtime      RuntimeStatusReader
	store        *programmingstore.Store
	catalog      PointCatalogProvider
	controllerID string
	cursorSecret []byte
	now          func() time.Time
	newID        func() string
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
		runtime: options.Runtime, store: options.Store, catalog: options.Catalog, controllerID: options.ControllerID,
		cursorSecret: options.CursorSecret, now: now, newID: newID,
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

// RuntimeView khớp schema `ProgrammingRuntime`. `SafeState` mặc định `false`
// chỉ khi Core xác nhận kết nối OK (không có tín hiệu safe-state riêng trong
// STATUS payload v1 hiện tại — theo dõi ở CHANGELOG như một giới hạn đã biết,
// không phải suy đoán an toàn). Khi Core UNAVAILABLE thì toàn bộ trường suy ra
// từ authority đều về trạng thái chưa biết, không phải giá trị "khỏe mạnh" giả.
type RuntimeView struct {
	SchemaVersion    string  `json:"schemaVersion"`
	ProducerState    string  `json:"producerState"`
	ActiveRevisionID *string `json:"activeRevisionId"`
	LKGRevisionID    *string `json:"lkgRevisionId"`
	TaskState        string  `json:"taskState"`
	SafeState        bool    `json:"safeState"`
	ObservedAt       string  `json:"observedAt"`
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
	}, nil
}

func (s *RuntimeService) GetRuntime(ctx context.Context) (RuntimeView, error) {
	observedAt := s.now().UTC().Format(time.RFC3339Nano)
	response, err := s.callStatus(ctx)
	if err != nil {
		return RuntimeView{
			SchemaVersion: "1.0", ProducerState: "UNAVAILABLE", TaskState: "UNKNOWN",
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
	return RuntimeView{
		SchemaVersion:    "1.0",
		ProducerState:    "READY",
		ActiveRevisionID: firstNonNil(payload.ActiveRevisionID, response.ActiveRevisionID),
		LKGRevisionID:    firstNonNil(payload.LKGRevisionID, response.LKGRevisionID),
		TaskState:        taskState,
		SafeState:        false,
		ObservedAt:       observedAt,
	}, nil
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
