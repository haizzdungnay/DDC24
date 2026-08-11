package store

import (
	"errors"
	"regexp"
	"time"
)

var (
	ErrNotFound            = errors.New("Programming object không tồn tại")
	ErrETagConflict        = errors.New("Draft ETag conflict")
	ErrIdempotencyConflict = errors.New("idempotency key đã dùng cho request khác")
	ErrAlreadyExists       = errors.New("Programming object đã tồn tại")
)

var (
	uuidPattern        = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	correlationPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{16,64}$`)
)

type Project struct {
	ProjectID      string
	Name           string
	Description    string
	Archived       bool
	CreatedBy      string
	UpdatedBy      string
	CreatedAtUTCMS int64
	UpdatedAtUTCMS int64
	AuditID        string
	Replay         bool
}

type Draft struct {
	DraftID        string
	ProjectID      string
	BaseRevisionID string
	ETag           int64
	ContentJSON    []byte
	ContentSHA256  [32]byte
	UpdatedBy      string
	UpdatedAtUTCMS int64
	AuditID        string
	Replay         bool
}

type AuditInput struct {
	AuditID         string
	ActorID         string
	Role            string
	Action          string
	TargetType      string
	TargetID        string
	RevisionID      string
	OperationID     string
	OccurredAtUTCMS int64
	ResultCode      string
	CorrelationID   string
	DetailsJSON     []byte
}

type CreateProjectParams struct {
	ProjectID            string
	DraftID              string
	Name                 string
	Description          string
	ContentJSON          []byte
	ActorID              string
	Role                 string
	AuditID              string
	CorrelationID        string
	At                   time.Time
	IdempotencyKeySHA256 [32]byte
	RequestSHA256        [32]byte
}

type SaveDraftParams struct {
	DraftID              string
	ExpectedETag         int64
	ContentJSON          []byte
	ActorID              string
	Role                 string
	AuditID              string
	CorrelationID        string
	At                   time.Time
	IdempotencyKeySHA256 [32]byte
	RequestSHA256        [32]byte
}

type RevisionObjectInput struct {
	ObjectID    string
	Kind        string
	PayloadJSON []byte
}

type CreateRevisionParams struct {
	RevisionID           string
	ProjectID            string
	DraftID              string
	ExpectedDraftETag    int64
	ParentRevisionID     string
	ManifestJSON         []byte
	Objects              []RevisionObjectInput
	ActorID              string
	Role                 string
	AuditID              string
	CorrelationID        string
	At                   time.Time
	IdempotencyKeySHA256 [32]byte
	RequestSHA256        [32]byte
}

type Revision struct {
	RevisionID       string
	ProjectID        string
	ParentRevisionID string
	Sequence         int64
	ManifestJSON     []byte
	ManifestSHA256   [32]byte
	CreatedBy        string
	CreatedAtUTCMS   int64
	DraftETag        int64
	AuditID          string
	Replay           bool
}

type RevisionObject struct {
	ObjectID      string
	Kind          string
	PayloadJSON   []byte
	PayloadSHA256 [32]byte
}

type RevisionSnapshot struct {
	Revision Revision
	Objects  []RevisionObject
}

type ProjectSnapshot struct {
	Project Project
	Draft   Draft
}

type BeginOperationParams struct {
	OperationID              string
	Kind                     string
	ControllerID             string
	RequestedRevisionID      string
	ExpectedActiveRevisionID string
	IdempotencyKeySHA256     [32]byte
	CorrelationID            string
	ActorID                  string
	Role                     string
	AuditID                  string
	At                       time.Time
}

type Operation struct {
	OperationID              string
	Kind                     string
	State                    string
	Step                     string
	ControllerID             string
	RequestedRevisionID      string
	ExpectedActiveRevisionID string
	CorrelationID            string
	ActorID                  string
	CreatedAtUTCMS           int64
	UpdatedAtUTCMS           int64
	Replay                   bool
}
