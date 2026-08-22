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
	ErrLeaseLost           = errors.New("Check worker đã mất lease")
	ErrCheckTerminal       = errors.New("Check đã ở trạng thái terminal")
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

type ImportProjectParams struct {
	ProjectID            string
	DraftID              string
	Name                 string
	Description          string
	ContentJSON          []byte
	BundleSHA256         string
	SourceProjectID      string
	SourceRevisionID     string
	LibraryRevisionID    string
	LibraryVersion       string
	LibraryEntries       []LibraryEntryImport
	ActorID              string
	Role                 string
	AuditID              string
	CorrelationID        string
	At                   time.Time
	IdempotencyKeySHA256 [32]byte
	RequestSHA256        [32]byte
}

type RecordBundleExportParams struct {
	BundleSHA256         string
	RevisionIDs          []string
	ByteSize             int64
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

// POUObjectInput là phần canonical tối thiểu để seal POU + library usage
// cùng Revision v2. Mô hình Project đa Program đầy đủ thuộc T59-301;
// store chỉ bảo đảm snapshot/pin nguyên tử tại đây.
type POUObjectInput struct {
	ObjectID      string
	Kind          string
	Name          string
	Language      string
	InterfaceJSON []byte
	SourceBlob    []byte
	Dependencies  []LibraryDependency
}

// LibraryEntryImport là entry PROJECT Library đến từ bundle NGUỒN. Nó không
// mang content hash của bên gửi: hash được tính lại từ nội dung canonical ở phía
// nhận, nên một bundle khai hash sai không thể "hợp thức hoá" nội dung của nó.
type LibraryEntryImport struct {
	EntryID       string
	Kind          string
	Name          string
	Language      string
	FeatureState  string
	Source        []byte
	InterfaceJSON []byte
	Dependencies  []LibraryDependency
	StateLayout   LibraryStateLayout
}

type CreateRevisionParams struct {
	RevisionID            string
	ProjectID             string
	DraftID               string
	ExpectedDraftETag     int64
	ParentRevisionID      string
	ManifestJSON          []byte
	Objects               []RevisionObjectInput
	DocumentSchemaVersion int
	ProgramCount          int
	LibraryRevisionID     string
	// PublishLibraryRevisionID buộc library DRAFT chuyển sang PUBLISHED trong
	// cùng transaction, trước khi Revision pin nó.
	PublishLibraryRevisionID string
	POUObjects               []POUObjectInput
	ActorID                  string
	Role                     string
	AuditID                  string
	CorrelationID            string
	At                       time.Time
	IdempotencyKeySHA256     [32]byte
	RequestSHA256            [32]byte
}

type Revision struct {
	RevisionID            string
	ProjectID             string
	ParentRevisionID      string
	Sequence              int64
	DocumentSchemaVersion int
	ProgramCount          int
	LibraryRevisionID     string
	ManifestJSON          []byte
	ManifestSHA256        [32]byte
	CreatedBy             string
	CreatedAtUTCMS        int64
	DraftETag             int64
	AuditID               string
	Replay                bool
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

type EnqueueCheckParams struct {
	CheckID              string
	RevisionID           string
	TargetID             string
	InputSHA256          [32]byte
	Profile              string
	CompilerVersion      string
	ActorID              string
	Role                 string
	AuditID              string
	CorrelationID        string
	At                   time.Time
	IdempotencyKeySHA256 [32]byte
	RequestSHA256        [32]byte
}

type Check struct {
	CheckID             string
	RevisionID          string
	TargetID            string
	State               string
	InputSHA256         [32]byte
	Profile             string
	CompilerVersion     string
	CreatedAtUTCMS      int64
	StartedAtUTCMS      *int64
	CompletedAtUTCMS    *int64
	AttemptCount        int
	LeaseOwner          string
	LeaseExpiresAtUTCMS *int64
	ResultJSON          []byte
	ResultSHA256        [32]byte
	Replay              bool
	Artifact            *Artifact
}

type Artifact struct {
	ArtifactID      string
	RevisionID      string
	CheckID         string
	SchemaVersion   int
	Profile         string
	TargetABI       int64
	CompilerVersion string
	LibraryVersion  string
	ByteSize        int64
	SHA256          [32]byte
	RelativePath    string
	IntegrityMode   string
	CreatedAtUTCMS  int64
}

type CompleteCheckParams struct {
	CheckID    string
	LeaseOwner string
	State      string
	ResultJSON []byte
	Artifact   *Artifact
	AuditID    string
	At         time.Time
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
	RequestSHA256            [32]byte
	ContextJSON              []byte
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
	ResultCode               string
	DetailCode               string
	KeepsRunningRevision     *bool
	PreviousActiveRevisionID string
	ActualActiveRevisionID   string
	ContextJSON              []byte
	CoreResultJSON           []byte
	AttemptCount             int
	LeaseOwner               string
	LeaseExpiresAtUTCMS      *int64
	LeaseGeneration          int64
}

type ClaimOperationParams struct {
	Owner string
	At    time.Time
	Lease time.Duration
}

type UpdateOperationParams struct {
	OperationID          string
	LeaseOwner           string
	LeaseGeneration      int64
	State                string
	Step                 string
	ResultCode           string
	DetailCode           string
	KeepsRunningRevision *bool
	PreviousActive       string
	ActualActive         string
	CoreResultJSON       []byte
	At                   time.Time
	ReleaseLease         bool
	AuditID              string
	AuditAction          string
	AuditRole            string
	CommissionRecord     *CommissionRecordInput
}

// CommissionRecordInput được ghi cùng transaction terminal của Operation.
// PreviousRevisionID rỗng chỉ hợp lệ cho lần Commission đầu tiên.
type CommissionRecordInput struct {
	PreviousRevisionID      string
	NewRevisionID           string
	ArtifactSHA256          [32]byte
	RuntimeReadbackJSON     []byte
	ImpactJSON              []byte
	OverrideInventorySHA256 [32]byte
	Result                  string
}

type CommissionRecord struct {
	OperationID             string
	PreviousRevisionID      string
	NewRevisionID           string
	ArtifactSHA256          [32]byte
	RuntimeReadbackJSON     []byte
	ImpactJSON              []byte
	OverrideInventorySHA256 [32]byte
	Result                  string
	ClosedAtUTCMS           int64
}
