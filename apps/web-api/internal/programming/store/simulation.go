package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Action idempotency của R3. Enum này khớp CHECK constraint trong migration
// `0013`; mở ở lớp Go mà đóng ở lớp SQL sẽ làm lỗi hiện ra dưới dạng
// "constraint failed" thay vì một câu nói được cho người gọi.
const (
	ActionSimulationCreate   = "SIMULATION_CREATE"
	ActionSimulationAction   = "SIMULATION_ACTION"
	ActionSimulationSetInput = "SIMULATION_SET_INPUT"
	ActionSimulationStop     = "SIMULATION_STOP"
)

// Trạng thái phiên. Bốn trạng thái cuối là TERMINAL và trigger trong migration
// chặn mọi đường quay lại — `sessionId` không bao giờ được tái sinh, vì client
// cũ vẫn có thể đang giữ ETag của phiên đó.
const (
	SimStatePreparing = "PREPARING"
	SimStatePaused    = "PAUSED"
	SimStateRunning   = "RUNNING"
	SimStateCompleted = "COMPLETED"
	SimStateFailed    = "FAILED"
	SimStateExpired   = "EXPIRED"
	SimStateStopped   = "STOPPED"
)

// ErrSimulationSessionLive báo rằng controller đã có một phiên chưa terminal.
// Đây là bản dịch của lỗi UNIQUE index sang một câu mà lớp trên hiểu được.
var ErrSimulationSessionLive = errors.New("controller đã có phiên Simulation đang sống")

// ErrSimulationSessionNotFound tách khỏi lỗi SQL để lớp application không phải
// đoán ý nghĩa của `sql.ErrNoRows`.
var ErrSimulationSessionNotFound = errors.New("phiên Simulation không tồn tại")

// ErrSimulationSequenceConflict là `If-Match` trượt. Tách khỏi `ErrETagConflict`
// của Draft vì hai thứ có cách sửa khác nhau: Draft thì rebase, còn phiên thì
// GET đọc lại rồi gửi lệnh với sequence mới.
var ErrSimulationSequenceConflict = errors.New("sequence phiên Simulation đã cũ")

// simulationSessionLiveConflict nhận diện đúng UNIQUE index "một phiên trên mỗi
// controller". SQLite nêu CỘT chứ không nêu tên index trong thông điệp lỗi, và
// `controller_id` chỉ có duy nhất index đó — nên khớp theo cột là chính xác.
// Không nuốt mọi lỗi UNIQUE thành "đã có phiên": làm vậy sẽ giấu mất một lần
// ghi trùng `session_id`, vốn là lỗi hoàn toàn khác.
func simulationSessionLiveConflict(err error) bool {
	return err != nil &&
		strings.Contains(err.Error(), "UNIQUE constraint failed: simulation_sessions.controller_id")
}

func SimStateIsTerminal(state string) bool {
	switch state {
	case SimStateCompleted, SimStateFailed, SimStateExpired, SimStateStopped:
		return true
	}
	return false
}

// SimulationSession là TOÀN BỘ thứ được persist về một phiên.
//
// Cố ý không có PID, không có đường dẫn socket và không có ảnh process: chúng
// không phải danh tính công khai, và một PID được lưu lại sẽ bị dùng để kill
// nhầm một tiến trình khác sau khi PID được cấp lại.
type SimulationSession struct {
	SessionID             string
	ControllerID          string
	ProjectID             string
	SourceDraftRevisionID string
	SourceContentSHA256   [sha256.Size]byte
	SnapshotID            string
	ArtifactSHA256        []byte
	State                 string
	SessionSequence       int64
	BaseTickMS            int64
	VirtualTimeMS         int64
	Speed                 int64
	ObservationSequence   int64
	ResetEpoch            int64
	CreatedAtUTCMS        int64
	LastActivityAtUTCMS   int64
	IdleExpiresAtUTCMS    int64
	HardExpiresAtUTCMS    int64
	FailureCode           string
	CreatedBy             string
	WorkerVersion         string
}

// ETag của phiên gắn với sequence. Client dùng `If-Match` trên giá trị này, nên
// nó phải đổi cùng nhịp với mọi mutation đã commit.
func (s SimulationSession) ETag() string {
	return fmt.Sprintf("\"%s:%d\"", s.SessionID, s.SessionSequence)
}

type CreateSimulationSessionParams struct {
	SimulationSession
	ActorID              string
	Role                 string
	AuditID              string
	CorrelationID        string
	At                   time.Time
	IdempotencyKeySHA256 [sha256.Size]byte
	RequestSHA256        [sha256.Size]byte
	AuditDetailsJSON     []byte
}

// CreateSimulationSession ghi phiên PREPARING, biên nhận idempotency và audit
// trong CÙNG một transaction.
//
// Vì sao cùng transaction: nếu phiên được ghi trước rồi audit hỏng, hệ thống có
// một phiên không ai giải thích được nguồn gốc; nếu biên nhận được ghi trước
// rồi phiên hỏng, một lần retry cùng key sẽ "replay" một phiên chưa từng tồn
// tại. Cả hai đều là mutation không có kiểm toán.
func (s *Store) CreateSimulationSession(ctx context.Context, params CreateSimulationSessionParams) (SimulationSession, error) {
	if s == nil || s.db == nil {
		return SimulationSession{}, fmt.Errorf("Programming store chưa mở")
	}
	if err := validateUUIDs(params.SessionID, params.ProjectID, params.AuditID); err != nil {
		return SimulationSession{}, err
	}
	if err := validateMutationIdentity(params.IdempotencyKeySHA256, params.RequestSHA256); err != nil {
		return SimulationSession{}, err
	}
	at := params.At.UTC().UnixMilli()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SimulationSession{}, err
	}
	defer tx.Rollback()

	if _, replayed, err := readMutationReceiptTx(ctx, tx, params.ActorID, ActionSimulationCreate,
		params.ProjectID, params.IdempotencyKeySHA256, params.RequestSHA256, at); err != nil {
		return SimulationSession{}, err
	} else if replayed {
		return SimulationSession{}, ErrIdempotencyConflict
	}

	session := params.SimulationSession
	session.State = SimStatePreparing
	session.SessionSequence = 0
	session.Speed = 1
	session.CreatedAtUTCMS = at
	session.LastActivityAtUTCMS = at

	if _, err := tx.ExecContext(ctx, `INSERT INTO simulation_sessions(
		session_id,controller_id,project_id,source_draft_revision_id,source_content_sha256,
		snapshot_id,artifact_sha256,state,session_sequence,base_tick_ms,virtual_time_ms,speed,
		observation_sequence,reset_epoch,created_at_utc_ms,last_activity_at_utc_ms,
		idle_expires_at_utc_ms,hard_expires_at_utc_ms,failure_code,created_by,worker_version)
		VALUES(?,?,?,?,?,NULL,NULL,?,0,NULL,0,1,0,0,?,?,?,?,NULL,?,NULL)`,
		session.SessionID, session.ControllerID, session.ProjectID, session.SourceDraftRevisionID,
		session.SourceContentSHA256[:], session.State, at, at,
		session.IdleExpiresAtUTCMS, session.HardExpiresAtUTCMS, session.CreatedBy); err != nil {
		if simulationSessionLiveConflict(err) {
			return SimulationSession{}, ErrSimulationSessionLive
		}
		return SimulationSession{}, fmt.Errorf("ghi phiên Simulation: %w", err)
	}

	if _, err := appendAuditTx(ctx, tx, AuditInput{
		AuditID: params.AuditID, ActorID: params.ActorID, Role: params.Role,
		Action: ActionSimulationCreate, TargetType: "SIMULATION_SESSION", TargetID: session.SessionID,
		OccurredAtUTCMS: at, ResultCode: "ACCEPTED", CorrelationID: params.CorrelationID,
		DetailsJSON: params.AuditDetailsJSON,
	}); err != nil {
		return SimulationSession{}, err
	}

	if err := writeMutationReceiptTx(ctx, tx, params.ActorID, ActionSimulationCreate, params.ProjectID,
		params.IdempotencyKeySHA256, params.RequestSHA256,
		mutationReceiptResult{ProjectID: session.ProjectID, SessionID: session.SessionID,
			ETag: session.SessionSequence, AuditID: params.AuditID}, at); err != nil {
		return SimulationSession{}, err
	}
	if err := tx.Commit(); err != nil {
		return SimulationSession{}, err
	}
	return session, nil
}

// UpdateSimulationSessionParams mô tả MỘT lần chuyển trạng thái đã commit.
//
// `ExpectedSequence` là điều kiện lạc quan: người gọi phải nói mình tin phiên
// đang ở sequence nào. Không có nó thì hai lệnh song song cùng ghi đè nhau và
// read-back trả về một trạng thái không lệnh nào tạo ra.
type UpdateSimulationSessionParams struct {
	SessionID           string
	ExpectedSequence    int64
	State               string
	VirtualTimeMS       int64
	Speed               int64
	ObservationSequence int64
	ResetEpoch          int64
	BaseTickMS          int64
	SnapshotID          string
	ArtifactSHA256      []byte
	WorkerVersion       string
	FailureCode         string
	At                  time.Time
	IdleExpiresAtUTCMS  int64

	ActorID          string
	Role             string
	AuditID          string
	Action           string
	ResultCode       string
	CorrelationID    string
	AuditDetailsJSON []byte
}

// UpdateSimulationSession tăng sequence đúng MỘT lần và ghi audit cùng
// transaction. Trả `ErrConflict` khi sequence không khớp — lúc đó tuyệt đối
// không có lệnh nào được gửi cho worker.
func (s *Store) UpdateSimulationSession(ctx context.Context, params UpdateSimulationSessionParams) (SimulationSession, error) {
	if s == nil || s.db == nil {
		return SimulationSession{}, fmt.Errorf("Programming store chưa mở")
	}
	at := params.At.UTC().UnixMilli()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SimulationSession{}, err
	}
	defer tx.Rollback()

	current, err := readSimulationSessionTx(ctx, tx, params.SessionID)
	if err != nil {
		return SimulationSession{}, err
	}
	if current.SessionSequence != params.ExpectedSequence {
		return SimulationSession{}, ErrSimulationSequenceConflict
	}

	next := current
	next.SessionSequence = current.SessionSequence + 1
	next.State = params.State
	next.VirtualTimeMS = params.VirtualTimeMS
	next.ObservationSequence = params.ObservationSequence
	next.ResetEpoch = params.ResetEpoch
	next.LastActivityAtUTCMS = at
	if params.Speed > 0 {
		next.Speed = params.Speed
	}
	if params.BaseTickMS > 0 {
		next.BaseTickMS = params.BaseTickMS
	}
	if params.SnapshotID != "" {
		next.SnapshotID = params.SnapshotID
	}
	if len(params.ArtifactSHA256) == sha256.Size {
		next.ArtifactSHA256 = params.ArtifactSHA256
	}
	if params.WorkerVersion != "" {
		next.WorkerVersion = params.WorkerVersion
	}
	next.FailureCode = params.FailureCode
	if params.IdleExpiresAtUTCMS > 0 {
		// Idle TTL được làm mới theo hoạt động nhưng KHÔNG bao giờ vượt hard TTL:
		// một phiên bận rộn cũng không được sống mãi.
		next.IdleExpiresAtUTCMS = params.IdleExpiresAtUTCMS
		if next.IdleExpiresAtUTCMS > next.HardExpiresAtUTCMS {
			next.IdleExpiresAtUTCMS = next.HardExpiresAtUTCMS
		}
	}

	if err := writeSimulationSessionTx(ctx, tx, next); err != nil {
		return SimulationSession{}, err
	}
	if params.AuditID != "" {
		if _, err := appendAuditTx(ctx, tx, AuditInput{
			AuditID: params.AuditID, ActorID: params.ActorID, Role: params.Role,
			Action: params.Action, TargetType: "SIMULATION_SESSION", TargetID: params.SessionID,
			OccurredAtUTCMS: at, ResultCode: params.ResultCode, CorrelationID: params.CorrelationID,
			DetailsJSON: params.AuditDetailsJSON,
		}); err != nil {
			return SimulationSession{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return SimulationSession{}, err
	}
	return next, nil
}

func (s *Store) GetSimulationSession(ctx context.Context, sessionID string) (SimulationSession, error) {
	if s == nil || s.db == nil {
		return SimulationSession{}, fmt.Errorf("Programming store chưa mở")
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return SimulationSession{}, err
	}
	defer tx.Rollback()
	return readSimulationSessionTx(ctx, tx, sessionID)
}

// ListLiveSimulationSessions trả các phiên chưa terminal. Dùng cho quota và cho
// bước reconcile lúc khởi động.
func (s *Store) ListLiveSimulationSessions(ctx context.Context) ([]SimulationSession, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("Programming store chưa mở")
	}
	rows, err := s.db.QueryContext(ctx, simulationSelectColumns+
		` FROM simulation_sessions WHERE state IN ('PREPARING','PAUSED','RUNNING') ORDER BY created_at_utc_ms`)
	if err != nil {
		return nil, fmt.Errorf("đọc phiên Simulation đang sống: %w", err)
	}
	defer rows.Close()
	var sessions []SimulationSession
	for rows.Next() {
		session, err := scanSimulationSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

// TerminateLiveSimulationSessions đóng mọi phiên chưa terminal bằng một mã lỗi
// tường minh.
//
// Dùng ở đúng hai chỗ, và cả hai đều là "không thể chứng minh worker còn sống":
// lúc `mkddc-web` khởi động lại, và lúc quét TTL. Không attach lại worker cũ —
// một tiến trình không chứng minh được token/protocol của phiên thì nó không
// phải worker của phiên đó, dù PID có trùng.
func (s *Store) TerminateLiveSimulationSessions(ctx context.Context, state, failureCode string, at time.Time) ([]string, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("Programming store chưa mở")
	}
	if !SimStateIsTerminal(state) {
		return nil, fmt.Errorf("state kết thúc không hợp lệ: %s", state)
	}
	live, err := s.ListLiveSimulationSessions(ctx)
	if err != nil {
		return nil, err
	}
	closed := make([]string, 0, len(live))
	for _, session := range live {
		if _, err := s.UpdateSimulationSession(ctx, UpdateSimulationSessionParams{
			SessionID: session.SessionID, ExpectedSequence: session.SessionSequence,
			State: state, VirtualTimeMS: session.VirtualTimeMS, Speed: session.Speed,
			ObservationSequence: session.ObservationSequence, ResetEpoch: session.ResetEpoch,
			FailureCode: failureCode, At: at,
		}); err != nil {
			return closed, err
		}
		closed = append(closed, session.SessionID)
	}
	return closed, nil
}

// ExpireSimulationSessions đóng phiên quá idle TTL hoặc hard TTL. Trả danh sách
// ID đã đóng để supervisor kill/reap đúng những tiến trình đó.
func (s *Store) ExpireSimulationSessions(ctx context.Context, at time.Time) ([]string, error) {
	live, err := s.ListLiveSimulationSessions(ctx)
	if err != nil {
		return nil, err
	}
	now := at.UTC().UnixMilli()
	expired := make([]string, 0, len(live))
	for _, session := range live {
		if now < session.IdleExpiresAtUTCMS && now < session.HardExpiresAtUTCMS {
			continue
		}
		failure := "SIM-SUP-EXPIRED"
		if _, err := s.UpdateSimulationSession(ctx, UpdateSimulationSessionParams{
			SessionID: session.SessionID, ExpectedSequence: session.SessionSequence,
			State: SimStateExpired, VirtualTimeMS: session.VirtualTimeMS, Speed: session.Speed,
			ObservationSequence: session.ObservationSequence, ResetEpoch: session.ResetEpoch,
			FailureCode: failure, At: at,
		}); err != nil {
			return expired, err
		}
		expired = append(expired, session.SessionID)
	}
	return expired, nil
}

const simulationSelectColumns = `SELECT session_id,controller_id,project_id,source_draft_revision_id,
	source_content_sha256,snapshot_id,artifact_sha256,state,session_sequence,base_tick_ms,
	virtual_time_ms,speed,observation_sequence,reset_epoch,created_at_utc_ms,last_activity_at_utc_ms,
	idle_expires_at_utc_ms,hard_expires_at_utc_ms,failure_code,created_by,worker_version`

func scanSimulationSession(scanner rowScanner) (SimulationSession, error) {
	var session SimulationSession
	var contentHash []byte
	var snapshotID, failureCode, workerVersion sql.NullString
	var artifactHash []byte
	var baseTick sql.NullInt64
	if err := scanner.Scan(&session.SessionID, &session.ControllerID, &session.ProjectID,
		&session.SourceDraftRevisionID, &contentHash, &snapshotID, &artifactHash, &session.State,
		&session.SessionSequence, &baseTick, &session.VirtualTimeMS, &session.Speed,
		&session.ObservationSequence, &session.ResetEpoch, &session.CreatedAtUTCMS,
		&session.LastActivityAtUTCMS, &session.IdleExpiresAtUTCMS, &session.HardExpiresAtUTCMS,
		&failureCode, &session.CreatedBy, &workerVersion); err != nil {
		return SimulationSession{}, err
	}
	if len(contentHash) != sha256.Size {
		return SimulationSession{}, fmt.Errorf("hash nguồn của phiên Simulation hỏng")
	}
	copy(session.SourceContentSHA256[:], contentHash)
	session.SnapshotID = snapshotID.String
	session.FailureCode = failureCode.String
	session.WorkerVersion = workerVersion.String
	session.BaseTickMS = baseTick.Int64
	if len(artifactHash) == sha256.Size {
		session.ArtifactSHA256 = artifactHash
	}
	return session, nil
}

func readSimulationSessionTx(ctx context.Context, tx *sql.Tx, sessionID string) (SimulationSession, error) {
	row := tx.QueryRowContext(ctx, simulationSelectColumns+` FROM simulation_sessions WHERE session_id=?`, sessionID)
	session, err := scanSimulationSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return SimulationSession{}, ErrSimulationSessionNotFound
	}
	if err != nil {
		return SimulationSession{}, fmt.Errorf("đọc phiên Simulation: %w", err)
	}
	return session, nil
}

func writeSimulationSessionTx(ctx context.Context, tx *sql.Tx, session SimulationSession) error {
	var snapshotID, failureCode, workerVersion any
	if session.SnapshotID != "" {
		snapshotID = session.SnapshotID
	}
	if session.FailureCode != "" {
		failureCode = session.FailureCode
	}
	if session.WorkerVersion != "" {
		workerVersion = session.WorkerVersion
	}
	var artifact any
	if len(session.ArtifactSHA256) == sha256.Size {
		artifact = session.ArtifactSHA256
	}
	var baseTick any
	if session.BaseTickMS > 0 {
		baseTick = session.BaseTickMS
	}
	if _, err := tx.ExecContext(ctx, `UPDATE simulation_sessions SET
		snapshot_id=?,artifact_sha256=?,state=?,session_sequence=?,base_tick_ms=?,virtual_time_ms=?,
		speed=?,observation_sequence=?,reset_epoch=?,last_activity_at_utc_ms=?,idle_expires_at_utc_ms=?,
		failure_code=?,worker_version=? WHERE session_id=?`,
		snapshotID, artifact, session.State, session.SessionSequence, baseTick, session.VirtualTimeMS,
		session.Speed, session.ObservationSequence, session.ResetEpoch, session.LastActivityAtUTCMS,
		session.IdleExpiresAtUTCMS, failureCode, workerVersion, session.SessionID); err != nil {
		return fmt.Errorf("cập nhật phiên Simulation: %w", err)
	}
	return nil
}
