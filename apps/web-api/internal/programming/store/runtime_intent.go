package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const (
	actionProgramEnable  = "PROGRAM_ENABLE"
	actionProgramDisable = "PROGRAM_DISABLE"
)

// Trạng thái runtime mà Core báo về. Danh sách này phải khớp CHECK constraint
// của `program_runtime_intents.last_known_runtime_state` — enum mở ở lớp Go và
// đóng ở lớp SQL sẽ làm lỗi hiện ra dưới dạng "constraint failed" thay vì dưới
// dạng một câu nói được cho người gọi.
var runtimeStates = map[string]struct{}{
	"DISABLED": {}, "STARTING": {}, "RUNNING": {}, "WAITING": {},
	"STOPPING": {}, "FAULTED": {}, "UNKNOWN": {},
}

// ProgramRuntimeIntent là ý định vận hành cho MỘT Program, cộng với trạng thái
// runtime lần cuối Core báo về.
//
// Intent và trạng thái là hai thứ KHÁC nhau và cố ý nằm cạnh nhau: "đã bật" là
// điều người vận hành muốn, "đang chạy" là điều thiết bị đang làm. Gộp chúng
// thành một trường sẽ làm một Program bật-nhưng-FAULTED trông y hệt một Program
// chưa ai bật.
type ProgramRuntimeIntent struct {
	ProjectID      string
	ProgramID      string
	DesiredEnabled bool
	Generation     int64
	RuntimeState   string
	UpdatedBy      string
	UpdatedAtUTCMS int64
}

// ProgramIntentIdentity mang danh tính và khoá idempotency của một lần đổi
// intent. Giống `LibraryMutationIdentity` nhưng KHÔNG có `ExpectedDraftETag`:
// intent không thuộc Draft, nó thuộc Project đang chạy — ràng buộc nó vào ETag
// của Draft sẽ làm mọi lần bật/tắt Program đòi Draft phải đứng yên.
type ProgramIntentIdentity struct {
	ProjectID            string
	ActorID              string
	Role                 string
	AuditID              string
	CorrelationID        string
	At                   time.Time
	IdempotencyKeySHA256 [sha256.Size]byte
	RequestSHA256        [sha256.Size]byte
}

// ProgramIntentMutation là kết quả một lần đổi intent.
type ProgramIntentMutation struct {
	Intent  ProgramRuntimeIntent
	AuditID string
	Replay  bool
}

func validateProgramIntentIdentity(identity ProgramIntentIdentity) error {
	if identity.ActorID == "" || len(identity.ActorID) > 128 {
		return fmt.Errorf("actor không hợp lệ")
	}
	if identity.Role == "" {
		return fmt.Errorf("role không hợp lệ")
	}
	if err := validateUUIDs(identity.ProjectID, identity.AuditID); err != nil {
		return err
	}
	if identity.At.IsZero() {
		return fmt.Errorf("thời điểm không hợp lệ")
	}
	return nil
}

// SetProgramEnableIntent đặt ý định Enable/Disable cho một Program.
//
// Biên nhận idempotency, audit và bản ghi intent đi trong CÙNG một transaction:
// một trong ba thứ đó ghi được mà hai thứ kia không sẽ để lại một thiết bị đã
// đổi hành vi nhưng không có dấu vết ai đổi, hoặc một dấu vết cho một thay đổi
// chưa từng xảy ra.
func (s *Store) SetProgramEnableIntent(ctx context.Context, identity ProgramIntentIdentity,
	programID string, enabled bool) (ProgramIntentMutation, error) {
	if err := validateProgramIntentIdentity(identity); err != nil {
		return ProgramIntentMutation{}, err
	}
	if programID == "" || len(programID) > 64 {
		return ProgramIntentMutation{}, fmt.Errorf("programId không hợp lệ")
	}
	// Hai action RIÊNG cho hai chiều. Biên nhận khoá theo
	// (actor, action, target, key), nên gộp hai chiều vào một action sẽ làm một
	// lần "bật" và một lần "tắt" cùng idempotency key trở thành cùng một ô — và
	// lần thứ hai replay kết quả của lần thứ nhất thay vì đổi trạng thái.
	action := actionProgramDisable
	if enabled {
		action = actionProgramEnable
	}
	at := identity.At.UTC().UnixMilli()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ProgramIntentMutation{}, err
	}
	defer tx.Rollback()

	receipt, found, err := readMutationReceiptTx(ctx, tx, identity.ActorID, action, programID,
		identity.IdempotencyKeySHA256, identity.RequestSHA256, at)
	if err != nil {
		return ProgramIntentMutation{}, err
	}
	if found {
		stored, err := readProgramIntentTx(ctx, tx, identity.ProjectID, programID)
		if err != nil {
			return ProgramIntentMutation{}, err
		}
		if err := tx.Commit(); err != nil {
			return ProgramIntentMutation{}, err
		}
		return ProgramIntentMutation{Intent: stored, AuditID: receipt.AuditID, Replay: true}, nil
	}

	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM projects WHERE project_id=?`,
		identity.ProjectID).Scan(&exists); err != nil {
		return ProgramIntentMutation{}, err
	}
	if exists == 0 {
		return ProgramIntentMutation{}, ErrNotFound
	}

	desired := 0
	if enabled {
		desired = 1
	}
	// `generation` chỉ tăng, không bao giờ lùi (trigger ở migration v6 ép điều
	// đó). Nó là thứ Core dùng để biết intent nào mới hơn mà KHÔNG phải tin đồng
	// hồ tường của hai máy khác nhau.
	if _, err := tx.ExecContext(ctx, `INSERT INTO program_runtime_intents(
		project_id,program_id,desired_enabled,generation,updated_by,updated_at_utc_ms)
		VALUES(?,?,?,1,?,?)
		ON CONFLICT(project_id,program_id) DO UPDATE SET
		desired_enabled=excluded.desired_enabled,
		generation=program_runtime_intents.generation+1,
		updated_by=excluded.updated_by,
		updated_at_utc_ms=excluded.updated_at_utc_ms`,
		identity.ProjectID, programID, desired, identity.ActorID, at); err != nil {
		return ProgramIntentMutation{}, fmt.Errorf("ghi intent: %w", err)
	}
	stored, err := readProgramIntentTx(ctx, tx, identity.ProjectID, programID)
	if err != nil {
		return ProgramIntentMutation{}, err
	}
	details, _ := json.Marshal(map[string]any{"programId": programID, "desiredEnabled": enabled,
		"generation": stored.Generation})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: identity.AuditID, ActorID: identity.ActorID,
		Role: identity.Role, Action: action, TargetType: "PROGRAM", TargetID: programID,
		OccurredAtUTCMS: at, ResultCode: "OK", CorrelationID: identity.CorrelationID,
		DetailsJSON: details}); err != nil {
		return ProgramIntentMutation{}, err
	}
	if err := writeMutationReceiptTx(ctx, tx, identity.ActorID, action, programID,
		identity.IdempotencyKeySHA256, identity.RequestSHA256,
		mutationReceiptResult{ProjectID: identity.ProjectID, AuditID: identity.AuditID}, at); err != nil {
		return ProgramIntentMutation{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProgramIntentMutation{}, err
	}
	return ProgramIntentMutation{Intent: stored, AuditID: identity.AuditID}, nil
}

// RecordProgramRuntimeState ghi lại trạng thái Core vừa báo về. Nó KHÔNG đụng
// tới `desired_enabled` và KHÔNG tăng `generation`: read-back là quan sát, không
// phải ý định. Để nó ghi đè intent sẽ biến một Program đang FAULTED thành một
// Program "người vận hành đã tắt".
func (s *Store) RecordProgramRuntimeState(ctx context.Context, projectID, programID, state string,
	at time.Time) error {
	if _, ok := runtimeStates[state]; !ok {
		return fmt.Errorf("trạng thái runtime không hợp lệ: %q", state)
	}
	result, err := s.db.ExecContext(ctx, `UPDATE program_runtime_intents
		SET last_known_runtime_state=?, updated_at_utc_ms=?
		WHERE project_id=? AND program_id=?`, state, at.UTC().UnixMilli(), projectID, programID)
	if err != nil {
		return fmt.Errorf("ghi trạng thái runtime: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		// Không tự tạo dòng: một trạng thái runtime cho Program chưa có intent
		// nghĩa là Core đang báo về một Program mà Project này chưa từng khai —
		// im lặng tạo dòng sẽ giấu đúng sự lệch đó đi.
		return ErrNotFound
	}
	return nil
}

// ListProgramRuntimeIntents trả toàn bộ intent của một Project, sắp theo
// `program_id` để hai lần đọc cho cùng một thứ tự.
func (s *Store) ListProgramRuntimeIntents(ctx context.Context, projectID string) ([]ProgramRuntimeIntent, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT project_id,program_id,desired_enabled,generation,
		last_known_runtime_state,updated_by,updated_at_utc_ms
		FROM program_runtime_intents WHERE project_id=? ORDER BY program_id`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	intents := make([]ProgramRuntimeIntent, 0)
	for rows.Next() {
		intent, err := scanProgramIntent(rows)
		if err != nil {
			return nil, err
		}
		intents = append(intents, intent)
	}
	return intents, rows.Err()
}

// ListAllProgramRuntimeIntents phục vụ duy nhất vòng reconciliation lúc Web
// API khởi động lại. Sắp theo Project rồi Program để thứ tự replay tất định và
// trần 16 của từng Project không phụ thuộc thứ tự SQLite trả hàng.
func (s *Store) ListAllProgramRuntimeIntents(ctx context.Context) ([]ProgramRuntimeIntent, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT project_id,program_id,desired_enabled,generation,
		last_known_runtime_state,updated_by,updated_at_utc_ms
		FROM program_runtime_intents ORDER BY project_id,program_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	intents := make([]ProgramRuntimeIntent, 0)
	for rows.Next() {
		intent, err := scanProgramIntent(rows)
		if err != nil {
			return nil, err
		}
		intents = append(intents, intent)
	}
	return intents, rows.Err()
}

// MarkAllProgramRuntimeStatesUnknown tách observation cũ khỏi boot mới. Một
// hàng RUNNING trước mất điện không phải bằng chứng Core sau restart đang chạy;
// giữ nó sẽ làm UI nói RUNNING trong khi Core cố ý boot fail-closed Disabled.
// Không đổi desired_enabled/generation/actor vì đây là observation, không phải
// một ý định vận hành mới.
func (s *Store) MarkAllProgramRuntimeStatesUnknown(ctx context.Context, at time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE program_runtime_intents
		SET last_known_runtime_state='UNKNOWN',updated_at_utc_ms=?`, at.UTC().UnixMilli())
	if err != nil {
		return fmt.Errorf("đánh dấu runtime intent cần reconcile: %w", err)
	}
	return nil
}

// CountEnabledPrograms đếm số Program đang có intent Enabled trong Project. Trần
// 16 được ép ở lớp application; store chỉ cung cấp con số đếm được để lớp đó
// không phải tự đếm bằng cách đọc hết rồi lọc.
func (s *Store) CountEnabledPrograms(ctx context.Context, projectID string) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM program_runtime_intents WHERE project_id=? AND desired_enabled=1`,
		projectID).Scan(&count)
	return count, err
}

func readProgramIntentTx(ctx context.Context, tx *sql.Tx, projectID, programID string) (ProgramRuntimeIntent, error) {
	row := tx.QueryRowContext(ctx, `SELECT project_id,program_id,desired_enabled,generation,
		last_known_runtime_state,updated_by,updated_at_utc_ms
		FROM program_runtime_intents WHERE project_id=? AND program_id=?`, projectID, programID)
	intent, err := scanProgramIntent(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ProgramRuntimeIntent{}, ErrNotFound
	}
	return intent, err
}

func scanProgramIntent(scanner rowScanner) (ProgramRuntimeIntent, error) {
	var intent ProgramRuntimeIntent
	var desired int
	if err := scanner.Scan(&intent.ProjectID, &intent.ProgramID, &desired, &intent.Generation,
		&intent.RuntimeState, &intent.UpdatedBy, &intent.UpdatedAtUTCMS); err != nil {
		return ProgramRuntimeIntent{}, err
	}
	intent.DesiredEnabled = desired == 1
	return intent, nil
}
